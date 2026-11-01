import { expect, it } from 'vitest';
import type { Fork } from '../src/geometry/figure';
import { quatEuler, rotate, type Quat, type V3 } from '../src/geometry/vec';
import { forkWarp } from '../src/sdf/fork';

// 独立用完整四元数、向量旋转核对优化后的标量分界；跨过转动/平移各自的边界。
it('分界标量计算和完整四元数旋转一致，包括零角度和不同旋转轴', () => {
  const ramp = (a: number, b: number, h: number) => {
    const u = Math.max(0, Math.min(1, (h-a)/(b-a)));
    return u*u*u*(u*(6*u-15)+10);
  };
  for (const quat of [quatEuler(0,0,0), quatEuler(0,0,0.35), quatEuler(0.2,-0.3,0.4)]) {
    const other = { part: 'Other', quat: quatEuler(-0.1,0.2,-0.3), shift: [-0.15,0.01,0.02] as V3, dir: -1 as const };
    const fork: Fork = { pivot:[0.03,0.1,0], quat, shift:[0.16,0.02,0.01], from:0.2, to:0.7, shiftFrom:0.1, shiftTo:0.4, split:[other] };
    const warp=forkWarp(fork), out=new Float64Array(4);
    const mid=(q:Quat,shift:V3,h:number) => {
      const t=ramp(fork.from,fork.to,h), m=ramp(fork.shiftFrom!,fork.shiftTo!,h);
      const half=Math.acos(Math.max(-1,Math.min(1,q[3]))), sine=Math.sin(half);
      const k=sine<1e-9?0:Math.sin(half*t)/sine;
      const turn:Quat=sine<1e-9?[0,0,0,1]:[q[0]*k,q[1]*k,q[2]*k,Math.cos(half*t)];
      return fork.pivot[0]+rotate(turn,[-fork.pivot[0],h-fork.pivot[1],0])[0]+shift[0]*m;
    };
    for(let i=0;i<250;i++) {
      const p:V3=[Math.sin(i)*0.3,-0.2+i*0.005,Math.cos(i)*0.2];
      warp.map(...p,out);
      const cached = new Float64Array(4), fresh = new Float64Array(4);
      warp.map(p[0],p[1],p[2]+0.37,cached);
      const freshLip = forkWarp(fork).map(p[0],p[1],p[2]+0.37,fresh);
      const cachedLip = warp.map(p[0],p[1],p[2]+0.37,cached);
      expect(cachedLip).toBeCloseTo(freshLip,12);
      for(let k=0;k<4;k++) {
        if(Number.isFinite(fresh[k])) expect(cached[k]).toBeCloseTo(fresh[k],12);
        else expect(cached[k]).toBe(fresh[k]);
      }
      const h=out[1];
      const moved=rotate(quat,[p[0]-fork.pivot[0],p[1]-fork.pivot[1],p[2]-fork.pivot[2]]);
      const wx=fork.pivot[0]+moved[0]+fork.shift[0];
      const expected=h<fork.to+0.12 ? other.dir*(wx-(mid(quat,fork.shift,h)+mid(other.quat,other.shift,h))/2) : -Infinity;
      if(Number.isFinite(expected)) expect(out[3]).toBeCloseTo(expected,7);
      else expect(out[3]).toBe(-Infinity);
    }
  }
});
