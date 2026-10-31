// 二次元素体的胸往大调时换成大胸的胸型（anime/body.ts 的 BUST_LARGE，animeLayout.ts 的 LARGE_FROM）
import { describe, expect, it } from 'vitest';
import { BUST_LARGE, animeCaps, animeGrid } from '../src/anime/body';
import type { GridShape } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type V3, add, cross, mul, norm } from '../src/geometry/vec';
import { defaultSpec } from '../src/model/spec';
import { getGrid, gridDist } from '../src/sdf/grids';
import { useAnimeBody } from './animeBody';

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
  it('和素体的胸是一样大小的格子（可以逐格混合）；原样大小时往前凸得差不多一样多', () => {
    const { small, large, cap, f, reach } = shapes();
    const a = getGrid(animeGrid('bust'));
    const b = getGrid(BUST_LARGE);
    expect(b.dims).toEqual(a.dims);
    expect(b.cell).toBe(a.cell);
    expect(b.min).toEqual(a.min);
    const before = reach(small, cap.center, f);
    expect(reach(large, cap.center, f)).toBeGreaterThan(before * 0.8);
    expect(reach(large, cap.center, f)).toBeLessThan(before * 1.3);
  });

  it('背面是实心的：小胸背面盖子后面是空的，大胸那里在里面', () => {
    const { small, large, cap, n } = shapes();
    for (const depth of [0.01, 0.02]) {
      const p = add(cap.center, mul(n, depth));
      expect(small(...p), `${depth}`).toBeGreaterThan(0.005);
      expect(large(...p), `${depth}`).toBeLessThan(-0.003);
    }
  });

  it('下半截比上半截饱满（往下坠），不是上下一样厚的尖圆锥', () => {
    const { large, cap, f, u, reach } = shapes();
    const r = cap.radius * 0.5;
    const lower = reach(large, add(cap.center, mul(u, -r)), f);
    const upper = reach(large, add(cap.center, mul(u, r)), f);
    expect(lower).toBeGreaterThan(upper + 0.008);
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
    expect(mixed.min[2]).toBeLessThan(plain.min[2] - 0.005);
  });
});
