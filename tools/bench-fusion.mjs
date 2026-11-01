// node tools/bench-fusion.mjs [--baseline <saved-source-directory>] [--save <result>] [--compare <result>]
// 单线程、静止模型；分别记录编译、求值、含缝合的收尾，不代表浏览器端延迟。
import { createServer } from 'vite';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { serialize, deserialize } from 'node:v8';
const args = process.argv.slice(2);
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const baseline = option('--baseline');
const reference = option('--compare') ? deserialize(readFileSync(option('--compare'))) : {};
const saved = {};
const server = await createServer({ configFile: false, appType: 'custom', logLevel: 'error',
  plugins: baseline ? [{ name: 'baseline-source', enforce: 'pre', load(id) {
    if (!id.replaceAll('\\', '/').includes('/src/sdf/')) return;
    const path = resolve(baseline, basename(id));
    if (existsSync(path)) return readFileSync(path, 'utf8');
  } }] : [],
  server: { middlewareMode: true, ws: false, hmr: false }, optimizeDeps: { noDiscovery: true } });
try {
  const { defaultSpec } = await server.ssrLoadModule('/src/model/spec.ts');
  const { buildFigure } = await server.ssrLoadModule('/src/geometry/layout.ts');
  const { installAnimeBody } = await server.ssrLoadModule('/src/anime/body.ts');
  const { stageParts } = await server.ssrLoadModule('/src/sdf/fuse.ts');
  const { planBlocks, blocksToEvaluate, evaluateBlocks, keepBlocks } = await server.ssrLoadModule('/src/sdf/surfaceNets.ts');
  const bytes = readFileSync('public/anime/body.bin');
  installAnimeBody(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const cases = [ ['white', 'mannequin', {}], ['complex', 'mannequin', {heads:3,armPairs:3,tails:9,wingPairs:3}],
    ['anime', 'anime', {}], ['fork2', 'anime', {torsos:2}], ['fork3', 'anime', {torsos:3}], ['twin', 'anime', {heads:2,legs:4}] ];
  const median = (rows, k) => rows.map(r=>r[k]).sort((a,b)=>a-b)[1];
  // 预热引擎和缝合路径。
  stageParts(buildFigure(defaultSpec()).parts.filter(p=>p.material!=='eye'), {voxel:0.012,blend:defaultSpec().blend}).finish();
  for (const [name, style, counts] of cases) {
    const spec = defaultSpec(); spec.bodyStyle=style; Object.assign(spec.counts,counts); spec.armLayout='fan';
    if (name==='twin') spec.legLayout='abreast';
    const parts=buildFigure(spec).parts.filter(p=>p.material!=='eye');
    for(const voxel of [0.012,0.006]) {
      const key=`${name}/${voxel}`, rows=[];
      for(let rep=0;rep<3;rep++) {
        const start=performance.now(); const stage=stageParts(parts,{voxel,blend:spec.blend});
        const plan=planBlocks(stage.field,voxel); const blocks=blocksToEvaluate(plan); const t=performance.now();
        const memo=keepBlocks(plan,[evaluateBlocks(stage.field,plan,blocks)]); const sampled=performance.now();
        const mesh=stage.finish(memo); const end=performance.now();
        rows.push({sample:sampled-t,finish:end-sampled,total:end-start}); saved[key]=mesh;
      }
      const out={key,sample:Math.round(median(rows,'sample')),finish:Math.round(median(rows,'finish')),total:Math.round(median(rows,'total')),vertices:saved[key].info.vertices,components:saved[key].info.components};
      if(reference[key]) {
        const a=reference[key],b=saved[key]; let max=0; let same=a.positions.length===b.positions.length;
        for(let i=0;same&&i<a.positions.length;i++) max=Math.max(max,Math.abs(a.positions[i]-b.positions[i]));
        for(const k of ['quads','triangles','tris']) { const x=a[k]??[],y=b[k]??[]; same &&= x.length===y.length && x.every((v,i)=>v===y[i]); }
        out.sameTopology=same;out.maxPositionDelta=max;
        if(!same || max>1e-6) process.exitCode=1;
      }
      console.log(JSON.stringify(out));
    }
  }
  if(option('--save')) writeFileSync(option('--save'),serialize(saved));
} finally {await server.close();}
