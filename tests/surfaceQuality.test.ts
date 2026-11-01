import { expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { defaultSpec } from '../src/model/spec';
import { compileField, evalPrims } from '../src/sdf/field';
import { fuseParts } from '../src/sdf/fuse';
import { graftMeshes } from '../src/sdf/graft';
import { meshField, planBlocks } from '../src/sdf/surfaceNets';
import { refineSurface } from '../src/sdf/surfaceQuality';
import { useAnimeBody } from './animeBody';

it('校正二次元素体曲面：误差下降、缝合和权重不变，不翻面、不改拓扑', () => {
  useAnimeBody();
  for (const [torsos,heads,legs] of [[1,1,2],[3,1,2],[1,2,4]]) {
    const spec=defaultSpec(); spec.bodyStyle='anime'; spec.armLayout='fan';
    Object.assign(spec.counts,{torsos,heads,legs}); if(legs===4) spec.legLayout='abreast';
    const parts=buildFigure(spec).parts.filter(p=>p.material!=='eye'), voxel=0.006;
    const field=compileField({parts,scale:1},{blend:spec.blend,minRadius:voxel});
    const raw=graftMeshes(meshField(field,voxel),parts,voxel);
    const before=raw.positions.slice(), quads=raw.quads.slice(), triangles=raw.triangles.slice();
    const bound=raw.bound?.weights.slice();
    const made=refineSurface(raw,field), p=made.positions;
    expect(made.info.components).toBe(1);
    expect(made.quads).toEqual(quads); expect(made.triangles).toEqual(triangles);
    expect(made.bound?.weights).toEqual(bound);
    const locked=new Set(raw.tris??[]);
    for(const v of locked) expect(p.subarray(v*3,v*3+3)).toEqual(before.subarray(v*3,v*3+3));
    if(raw.bound) expect(p.subarray(raw.bound.start*3)).toEqual(before.subarray(raw.bound.start*3));
    const plan=planBlocks(field,voxel);
    let changed=0, oldError=0, newError=0;
    for(let v=0;v<p.length;v+=3) {
      const delta=Math.hypot(p[v]-before[v],p[v+1]-before[v+1],p[v+2]-before[v+2]);
      expect(delta).toBeLessThanOrEqual(voxel*0.2+2e-7);
      if(delta<1e-8) continue;
      changed++;
      const i=Math.floor((before[v]-plan.ox)/(8*voxel)),j=Math.floor((before[v+1]-plan.oy)/(8*voxel)),k=Math.floor((before[v+2]-plan.oz)/(8*voxel));
      const list=plan.lists[i+plan.bx*(j+plan.by*k)]!;
      const a=evalPrims(field,list,list.length,before[v],before[v+1],before[v+2]);
      const b=evalPrims(field,list,list.length,p[v],p[v+1],p[v+2]);
      oldError+=a*a;newError+=b*b;
    }
    expect(changed).toBeGreaterThan(1000);
    expect(newError).toBeLessThan(oldError*0.5);
    const normal=(points:Float32Array,a:number,b:number,c:number) => {
      const ux=points[b]-points[a],uy=points[b+1]-points[a+1],uz=points[b+2]-points[a+2];
      const vx=points[c]-points[a],vy=points[c+1]-points[a+1],vz=points[c+2]-points[a+2];
      return [uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx];
    };
    for(let t=0;t<triangles.length;t+=3) {
      const a=triangles[t]*3,b=triangles[t+1]*3,c=triangles[t+2]*3;
      const x=normal(before,a,b,c),y=normal(p,a,b,c);
      expect(x[0]*y[0]+x[1]*y[1]+x[2]*y[2]).toBeGreaterThanOrEqual(0);
    }
    console.log({torsos,heads,changed,errorRatio:newError/oldError});
  }
});

it('普通白模的融合结果不进入二次元素体校正', () => {
  const spec=defaultSpec(), parts=buildFigure(spec).parts.filter(p=>p.material!=='eye'),voxel=0.012;
  const field=compileField({parts,scale:1},{blend:spec.blend,minRadius:voxel});
  const before=graftMeshes(meshField(field,voxel),parts,voxel);
  const after=fuseParts(parts,{voxel,blend:spec.blend});
  expect(after.positions).toEqual(before.positions);
});
