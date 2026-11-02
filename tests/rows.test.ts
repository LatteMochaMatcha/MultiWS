// 二次元素体的多排胸（docs/rework-plan.md 第 4 期，照参考图 A-two-rows）：下排和第一排一模一样，排在下面一截往下慢慢收窄的肋骨上
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
          // 大胸几排一样往下垂，小胸不垂
          expect(prims[j].tilt).toEqual(prims[0].tilt);
        }
        if (bust > 2) expect(prims[0].tilt?.[0]).toBeGreaterThan(5);
        else expect(prims[0].tilt).toBeUndefined();
      }
    }
  });

  it('躯干往下收窄时，下排胸照收窄之前的宽度摆，正面看和第一排差不多宽', () => {
    const f = rows(4, 1);
    const torso = f.parts.find((p) => p.name === 'Torso')!;
    expect((torso.prims[0] as { taperX?: unknown }).taperX).toBeDefined();
    const s = f.scale;
    const bare = compileField({ ...f, parts: [torso] }, { blend: 0 });
    const front = (field: ReturnType<typeof compileField>, x: number, y: number) => 0.5 * s - castRay(field, [x, y, 0.5 * s], [0, 0, -1], 0.5 * s);
    /** 一排胸的中心高度上，胸凸出躯干 8 毫米以上的那一段从哪到哪 */
    const span = (p: Part): [number, number] => {
      const field = compileField({ ...f, parts: [torso, p] }, { blend: 0 });
      const y = (torso.pos[1] + p.pos[1]) * s;
      let lo = Infinity;
      let hi = -Infinity;
      for (let x = 0; x < 0.16 * s; x += 0.001 * s) {
        if (front(field, x, y) - front(bare, x, y) < 0.008 * s) continue;
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      return [lo, hi];
    };
    const left = chests(f, 1);
    const [a0, b0] = span(left[0]);
    const [a3, b3] = span(left[3]);
    // 靠中线那边一样；外沿铺到躯干侧面，跟着躯干收一点（不照收窄之前摆的话最下面一排只剩第一排的不到九成宽）
    expect(Math.abs(a3 - a0)).toBeLessThan(0.002 * s);
    expect(b3 - a3).toBeGreaterThan((b0 - a0) * 0.9);
  });

  it('大胸上排胸底压在下排上缘（排距比上排的下半截加下排的上半截短一点），小胸上下排挨着', () => {
    for (const [bust, overlap] of [
      [2.2, true],
      [1, false],
    ] as const) {
      const f = rows(2, bust);
      const [top, below] = chests(f, 1);
      const gap = top.pos[1] - below.pos[1];
      const [up, down] = chestReach(Math.max(1, bust));
      if (overlap) expect(gap).toBeLessThan(up + down - 0.005);
      else expect(gap).toBeGreaterThanOrEqual(up + down);
    }
  });

  it('下排坐的那截肋骨往下慢慢收（小胸收、大胸不收），不比第一排胸那里窄太多，腰在最下面一排下面', () => {
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
        // 第一排那里量到的连着腋下那一块，比肋骨宽
        for (const p of left.slice(1)) expect(half(world(p)), `${n} 排 胸 ${bust} ${p.name}`).toBeGreaterThan(first * 0.8);
        // 第二排往下：小胸一排比一排窄（不是一根直筒），大胸一样宽
        const lower = left.slice(1).map((p) => half(world(p)));
        for (let j = 1; j < lower.length; j++) {
          if (bust > 2) expect(lower[j]).toBeCloseTo(lower[0], 2);
          else expect(lower[j], `${n} 排 胸 ${bust}`).toBeLessThan(lower[j - 1] - 0.002 * s);
        }
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
