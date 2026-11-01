// 二次元素体的胸往大调时换成大胸的胸型（anime/body.ts 的 BUST_LARGE，tools/build-bust.ts 从 CC0 素体上取下来的；animeLayout.ts 的 LARGE_FROM）
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUST_LARGE, animeCaps, animeGrid } from '../src/anime/body';
import type { GridShape } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type V3, add, cross, mul, norm } from '../src/geometry/vec';
import { defaultSpec } from '../src/model/spec';
import { castRay, compileField, fieldAt } from '../src/sdf/field';
import { fuseParts } from '../src/sdf/fuse';
import { getGrid, gridDist } from '../src/sdf/grids';
import { useAnimeBody } from './animeBody';
import { sag } from '../src/anime/bustSag';

/** 素体的小胸、大胸的胸型，和小胸背面盖子的朝向（n 朝身体里，f 朝前，u 朝上） */
function shapes() {
  useAnimeBody();
  const small = gridDist(getGrid(animeGrid('bust'))).fn;
  const large = gridDist(getGrid(BUST_LARGE)).fn;
  const cap = animeCaps('bust')[0];
  const [x, y, z] = cap.center;
  const e = 0.002;
  const n = norm([small(x + e, y, z) - small(x - e, y, z), small(x, y + e, z) - small(x, y - e, z), small(x, y, z + e) - small(x, y, z - e)]);
  const f = mul(n, -1);
  const u = norm(cross(f, cross([0, 1, 0], f)));
  /** 从 from 沿 dir 走到出了表面多远 */
  const reach = (fn: typeof small, from: V3, dir: V3) => {
    let t = 0;
    while (fn(...add(from, mul(dir, t))) < 0 && t < 0.2) t += 0.0005;
    return t;
  };
  return { small, large, cap, n, f, u, reach };
}

describe('大胸的胸型', () => {
  it('和素体的胸是一样大小的格子（可以逐格混合）；比小胸往前凸得多（存的是那个素体的胸，胸调到 1.76 时原样大）', () => {
    useAnimeBody();
    const a = getGrid(animeGrid('bust'));
    const b = getGrid(BUST_LARGE);
    expect(b.dims).toEqual(a.dims);
    expect(b.cell).toBe(a.cell);
    expect(b.min).toEqual(a.min);
    expect(b.bounds.max[2]).toBeGreaterThan(a.bounds.max[2] * 1.2);
    expect(b.bounds.max[2]).toBeLessThan(a.bounds.max[2] * 2);
    // 不碰格子的边（碰到了就是被格子的边切掉了一截）
    for (let k = 0; k < 3; k++) {
      expect(b.bounds.min[k]).toBeGreaterThan(a.min[k] + a.cell * 1.5);
      expect(b.bounds.max[k]).toBeLessThan(a.min[k] + a.cell * (a.dims[k] - 2.5));
    }
  });

  it('背面贴着躯干：胸调大以后，从胸前往身体里走，穿出这块胸的地方在躯干里面或者离躯干表面不到一厘米（和躯干圆滑地融时填得上）；融合出来是一整块', () => {
    useAnimeBody();
    for (const bust of [1.6, 2.2]) {
      const spec = { ...defaultSpec(), bodyStyle: 'anime' as const, shape: { ...defaultSpec().shape, bust } };
      const figure = buildFigure(spec);
      const torso = figure.parts.find((p) => p.name === 'Torso')!;
      const chest = figure.parts.find((p) => p.name === 'Chest_01_L')!;
      // 胸的位置写在躯干的坐标里：两个都照躯干放在原点量（躯干自己往下挪过一点，见 animeLayout.ts 的 drop）
      const at = (part: typeof torso) => compileField({ scale: 1, parts: [{ ...part, parent: undefined, ...(part === torso ? { pos: [0, 0, 0] as V3 } : {}) }] }, { blend: 0 });
      const body = at(torso);
      const breast = at(chest);
      const s = chest.scale ?? 1;
      // 胸前往里打几条线：正对着胸，和往上下左右偏开一点的（再往外的从大胸外侧、下面悬着的地方穿出去，本来就离胸口有一段）
      for (const [dx, dy] of [[0, 0], [0.015, 0], [-0.015, 0], [0, 0.015], [0, -0.015]]) {
        const from: V3 = [chest.pos[0] + dx * s, chest.pos[1] + dy * s, 0.4];
        let z = from[2];
        while (z > -0.2 && fieldAt(breast, from[0], from[1], z) > 0) z -= 0.001;
        if (z <= -0.2) continue;
        while (fieldAt(breast, from[0], from[1], z) <= 0) z -= 0.001;
        expect(fieldAt(body, from[0], from[1], z), `${bust} ${dx} ${dy}`).toBeLessThan(0.01);
      }
      const mesh = fuseParts(figure.parts.filter((p) => p.material !== 'eye'), { voxel: 0.012, blend: spec.blend });
      expect(mesh.info.components, `${bust}`).toBe(1);
      expect(mesh.info.cavities, `${bust}`).toBe(0);
    }
  }, 60_000);

  it('下半截比上半截饱满（往下坠），不是上下一样厚的尖圆锥', () => {
    const { large, cap } = shapes();
    const r = cap.radius * 0.5;
    /** 高度 y 上，离胸正中不远的几处里最往前凸到哪（从前面往后找第一个在里面的点） */
    const front = (y: number) => {
      let best = -Infinity;
      for (let x = cap.center[0] - 0.02; x <= cap.center[0] + 0.02; x += 0.005) {
        for (let z = 0.12; z > -0.05; z -= 0.0005) {
          if (large(x, y, z) < 0) {
            best = Math.max(best, z);
            break;
          }
        }
      }
      return best;
    };
    expect(front(cap.center[1] - r)).toBeGreaterThan(front(cap.center[1] + r) + 0.008);
  });

  it('胸调到 1.1 以上渐渐换成大胸的胸型，1.6 换足；原样大小、调小的时候不换', () => {
    useAnimeBody();
    const morph = (bust: number) => {
      const spec = { ...defaultSpec(), bodyStyle: 'anime' as const, shape: { ...defaultSpec().shape, bust } };
      const chest = buildFigure(spec).parts.find((p) => p.name === 'Chest_01_L')!;
      return (chest.prims[0] as GridShape).morph;
    };
    expect(morph(0.6)).toBeUndefined();
    expect(morph(1)).toBeUndefined();
    expect(morph(1.35)?.[0]).toBe(BUST_LARGE);
    expect(morph(1.35)?.[1]).toBeCloseTo(0.5, 6);
    expect(morph(1.6)).toEqual([BUST_LARGE, 1]);
    expect(morph(2.2)).toEqual([BUST_LARGE, 1]);
  });

  it('混合的时候占的范围两块都算上（不然大胸多出来的地方在融合时被裁掉）', () => {
    useAnimeBody();
    const plain = gridDist(getGrid(animeGrid('bust')));
    const mixed = gridDist(getGrid(animeGrid('bust')), { morph: [BUST_LARGE, 1] });
    for (let k = 0; k < 3; k++) {
      expect(mixed.min[k]).toBeLessThanOrEqual(plain.min[k]);
      expect(mixed.max[k]).toBeGreaterThanOrEqual(plain.max[k]);
    }
    // 大胸往前凸得多：混合的时候前面那一截也在范围里
    expect(mixed.max[2]).toBeGreaterThan(plain.max[2] + 0.005);
  });
});

// 独立从原始 OBJ 的三角面求前表面，不拿生成后的格子作为自己的参照。
it('默认胸和大胸分别贴合 DJP 原素材的可见轮廓', () => {
  useAnimeBody();
  const source = (file: string) => {
    const verts: V3[] = [], triangles: number[][] = [];
    const text = new TextDecoder().decode(readFileSync(new URL('../assets/source/djp/'+file, import.meta.url)));
    for (const line of text.split('\n')) {
      if (line.startsWith('v ')) verts.push(line.trim().split(/\s+/).slice(1,4).map(Number) as V3);
      if (line.startsWith('f ')) {
        const ids=line.trim().split(/\s+/).slice(1).map(t=>parseInt(t.split('/')[0],10)-1);
        for(let k=1;k+1<ids.length;k++) triangles.push([ids[0],ids[k],ids[k+1]]);
      }
    }
    return (x: number,y: number) => {
      let front=-Infinity;
      for (const ids of triangles) {
        const [a,b,c]=ids.map(i=>verts[i]);
        const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
        if(Math.abs(den)<1e-12) continue;
        const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den;
        const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;
        if(Math.min(u,v,1-u-v)>=0) front=Math.max(front,u*a[2]+v*b[2]+(1-u-v)*c[2]);
      }
      return front;
    };
  };
  for (const small of [true,false]) {
    const surface=source(small?'DJP Anime Base Sculpt.obj':'DJP CC0 Free Base Mesh 01.obj');
    const spec=defaultSpec(); spec.bodyStyle='anime'; spec.pose='T'; spec.shape.bust=small?1:1.76;
    const parts=buildFigure(spec).parts.filter(p=>p.material!=='eye');
    const field=compileField({parts,scale:1},{blend:spec.blend,minRadius:0.006});
    const torso=parts.find(p=>p.name==='Torso')!;
    const breast=parts.find(p=>p.name==='Chest_01_L')!;
    expect((breast.prims[0] as GridShape).grid).toBe(animeGrid('bustReference'));
    const errors: number[]=[];
    for (const x of small?[0.035,0.052,0.07]:[0.05,0.075,0.1]) for(const y of [1.12,1.14,1.16]) {
      const z=surface(x,y); expect(Number.isFinite(z)).toBe(true);
      const point:V3=small?[x,y+0.03,z-0.006]:[0.086+(x-0.086)*0.85-0.008,1.13+(y-1.13)*0.85+0.03,0.1+(z-0.1)*0.85-0.006];
      // 大胸照原素材摆好以后还往外下方坠了一点（build-bust.ts 的 SAG），照同一套挪过去再比
      if (!small) sag(point, 1);
      const from:V3=[point[0]+torso.pos[0],point[1]+torso.pos[1],0.4+torso.pos[2]];
      const actual=from[2]-castRay(field,from,[0,0,-1],0.6);
      const error=Math.abs(actual-(point[2]+torso.pos[2]));errors.push(error);
      expect(error,`${small?'small':'large'} x=${x} y=${y}`).toBeLessThan(0.012);
    }
    expect(errors.reduce((a,b)=>a+b,0)/errors.length).toBeLessThan(0.006);
  }
});
