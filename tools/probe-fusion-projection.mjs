// 离线验证受限零面投影；不改变产品算法。node tools/probe-fusion-projection.mjs <bench-save>
import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
import {deserialize} from 'node:v8';
const old=deserialize(readFileSync(process.argv[2]));
function project(v,x,y,z) {
  const start=[x,y,z];
  for(let step=0;step<2;step++) {
    let f=0,gx=0,gy=0,gz=0;
    for(let q=0;q<8;q++) {
      const a=q&1?x:1-x,b=q&2?y:1-y,c=q&4?z:1-z;
      f+=v[q]*a*b*c;gx+=v[q]*(q&1?1:-1)*b*c;
      gy+=v[q]*a*(q&2?1:-1)*c;gz+=v[q]*a*b*(q&4?1:-1);
    }
    const den=gx*gx+gy*gy+gz*gz;
    if(den<1e-16) break;
    const next=[x-f*gx/den,y-f*gy/den,z-f*gz/den];
    if(next.some(a=>a<0||a>1)||Math.hypot(...next.map((a,i)=>a-start[i]))>0.25) break;
    [x,y,z]=next;
  }
  return [x,y,z];
}
const server=await createServer({configFile:false,logLevel:'error',server:{middlewareMode:true,ws:false,hmr:false},optimizeDeps:{noDiscovery:true},plugins:[{name:'trial-projection',enforce:'pre',load(id){
  if(!id.replaceAll('\\','/').endsWith('/src/sdf/surfaceNets.ts'))return;
  let s=readFileSync(id,'utf8');
  s=s.replace('  const filled =','  const dirty = new Uint8Array(blockCount);\n  const filled =');
  s=s.replace('if (v[at] >= 0) v[at] = filled;', 'if (v[at] >= 0) { v[at] = filled; dirty[b] = 1; }');
  s=s.replace('          pos.push(', '          const projected = dirty[b] ? [sx / crossings, sy / crossings, sz / crossings] : project(corner, sx / crossings, sy / crossings, sz / crossings);\n          pos.push(');
  s=s.replace('(bi * B + i + sx / crossings)', '(bi * B + i + projected[0])').replace('(bj * B + j + sy / crossings)', '(bj * B + j + projected[1])').replace('(bk * B + k + sz / crossings)', '(bk * B + k + projected[2])');
  return s+'\n'+project.toString();
}}]});
try {
 const {defaultSpec}=await server.ssrLoadModule('/src/model/spec.ts');const {buildFigure}=await server.ssrLoadModule('/src/geometry/layout.ts');const {installAnimeBody}=await server.ssrLoadModule('/src/anime/body.ts');const {fuseParts}=await server.ssrLoadModule('/src/sdf/fuse.ts');
 const bytes=readFileSync('public/anime/body.bin');installAnimeBody(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 const cross=(p,a,b,c)=>{const u=[0,1,2].map(k=>p[b*3+k]-p[a*3+k]),v=[0,1,2].map(k=>p[c*3+k]-p[a*3+k]);return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];};
 for(const [name,style,counts] of [['white','mannequin',{}],['anime','anime',{}],['fork3','anime',{torsos:3}],['twin','anime',{heads:2,legs:4}]]) {
  const spec=defaultSpec();spec.bodyStyle=style;spec.armLayout='fan';Object.assign(spec.counts,counts);if(name==='twin')spec.legLayout='abreast';
  const now=fuseParts(buildFigure(spec).parts.filter(p=>p.material!=='eye'),{voxel:0.006,blend:spec.blend}),before=old[name+'/0.006'];
  const same=now.positions.length===before.positions.length&&now.quads.length===before.quads.length&&now.quads.every((v,i)=>v===before.quads[i]) && (now.tris?.length??0)===(before.tris?.length??0) && (now.tris??[]).every((v,i)=>v===before.tris[i]);
  let reversed=0;
  if(same) for(let t=0;t<before.triangles.length;t+=3) {const ids=before.triangles.subarray(t,t+3),a=cross(before.positions,...ids),b=cross(now.positions,...ids);if(a.reduce((n,v,i)=>n+v*b[i],0)<=0)reversed++;}
  console.log(JSON.stringify({name,sameTopology:same,reversedTriangles:same?reversed:null,components:now.info.components,beforeVertices:before.info.vertices,afterVertices:now.info.vertices}));
 }
} finally {await server.close();}
