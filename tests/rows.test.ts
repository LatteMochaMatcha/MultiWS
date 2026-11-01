// 二次元素体的多排胸（docs/rework-plan.md 第 4 期，照参考图 A-two-rows）：下排和第一排一模一样，排在下面一截和胸下面一样宽的肋骨上
import { describe, expect, it } from 'vitest';
import { chestReach } from '../src/anime/chest';
import type { ChestShape, Figure, Part } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { defaultSpec, normalizeSpec } from '../src/model/spec';
import { castRay, compileField } from '../src/sdf/field';
import { useAnimeBody } from './animeBody';

const rows = (chestPairs: number, bust: number): Figure => {
  const d = defaultSpec();
  return buildFigure(normalizeSpec({ ...d, bodyStyle: 'anime', armLayout: 'stack', counts: { ...d.counts, chestPairs, armPairs: 2 }, shape: { ...d.shape, bust } }));
};
const chests = (f: Figure, side: 1 | -1): Part[] => f.parts.filter((p) => p.type === 'chest' && p.side === side).sort((a, b) => b.pos[1] - a.pos[1]);

describe('二次元素体的多排胸', () => {
  useAnimeBody();

  it('下排和第一排一模一样：一样大、离正中线一样远、一样往外，排距都一样', () => {
    for (const n of [2, 3, 4]) {
      for (const bust of [1, 2.2]) {
        const f = rows(n, bust);
        const left = chests(f, 1);
        expect(left).toHaveLength(n);
        const prims = left.map((p) => p.prims[0] as ChestShape);
        const gaps = left.slice(1).map((p, j) => left[j].pos[1] - p.pos[1]);
        for (let j = 1; j < n; j++) {
          expect(prims[j].size).toBe(prims[0].size);
          expect(left[j].pos[0]).toBeCloseTo(left[0].pos[0], 9);
          expect(prims[0].lift! - prims[j].lift!).toBeCloseTo(gaps.slice(0, j).reduce((a, b) => a + b, 0), 9);
          expect(gaps[j - 1]).toBeCloseTo(gaps[0], 9);
        }
      }
    }
  });

  it('大胸上排胸底压在下排上缘（排距比上排的下半截加下排的上半截短），小胸上下排挨着', () => {
    for (const [bust, overlap] of [
      [2.2, true],
      [1, false],
    ] as const) {
      const f = rows(2, bust);
      const [top, below] = chests(f, 1);
      const gap = top.pos[1] - below.pos[1];
      const [up, down] = chestReach(Math.max(1, bust));
      if (overlap) expect(gap).toBeLessThan(up + down - 0.02);
      else expect(gap).toBeGreaterThanOrEqual(up + down);
    }
  });

  it('下排坐的那截肋骨不比第一排胸那里窄，腰在最下面一排下面', () => {
    for (const n of [2, 4]) {
      for (const bust of [1, 2.2]) {
        const f = rows(n, bust);
        const torso = f.parts.find((p) => p.name === 'Torso')!;
        const field = compileField({ ...f, parts: [torso] }, { blend: 0 });
        const s = f.scale;
        /** 世界坐标高度 y 上躯干往 +X 最远到哪（照前后正中那一线） */
        const half = (y: number) => 0.5 * s - castRay(field, [0.5 * s, y, 0.02 * s], [-1, 0, 0], 0.5 * s);
        const world = (p: Part) => (torso.pos[1] + p.pos[1]) * s;
        const left = chests(f, 1);
        const first = half(world(left[0]));
        for (const p of left.slice(1)) expect(half(world(p)), `${n} 排 胸 ${bust} ${p.name}`).toBeGreaterThan(first * 0.9);
        // 腰（胯以上最细的地方）在最下面一排的中心以下
        let waist = Infinity;
        let waistY = 0;
        for (let y = 0.95 * s; y < world(left[n - 1]); y += 0.005 * s) {
          const w = half(y);
          if (w < waist) [waist, waistY] = [w, y];
        }
        expect(waistY, `${n} 排 胸 ${bust}`).toBeLessThan(world(left[n - 1]) - 0.03 * s);
        expect(waist).toBeLessThan(first * 0.9);
      }
    }
  });
});
