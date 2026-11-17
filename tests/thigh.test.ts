// 体型滑块「大腿粗细」：只动大腿（见 src/geometry/thigh.ts），小腿、脚、骨骼照旧
import { describe, expect, it } from 'vitest';
import type { Figure, Part } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { thighen } from '../src/geometry/thigh';
import { type BodySpec, SHAPE_DEF_BY_KEY, defaultSpec, normalizeSpec } from '../src/model/spec';
import { castRay, compileField } from '../src/sdf/field';
import { useAnimeBody } from './animeBody';

useAnimeBody();

const specOf = (bodyStyle: BodySpec['bodyStyle'], shape: Partial<BodySpec['shape']> = {}): BodySpec => {
  const d = defaultSpec();
  return normalizeSpec({ ...d, bodyStyle, shape: { ...d.shape, ...shape } });
};
const leg = (figure: Figure): Part => figure.parts.find((p) => p.type === 'leg' && p.parent === undefined && p.side > 0)!;
/** 一条腿在髋关节往下 down 米的地方左右多宽 */
function wide(part: Part, down: number): number {
  const field = compileField({ scale: 1, parts: [part] }, { blend: 0 });
  const y = part.pos[1] - down;
  const a = castRay(field, [part.pos[0] + 0.6, y, part.pos[2]], [-1, 0, 0], 1.2);
  const b = castRay(field, [part.pos[0] - 0.6, y, part.pos[2]], [1, 0, 0], 1.2);
  return 1.2 - a - b;
}

describe('大腿粗细', () => {
  it('滑块默认是 1，旧存档没有这一项也是 1', () => {
    expect(SHAPE_DEF_BY_KEY.thighs.def).toBe(1);
    const { thighs: _gone, ...old } = defaultSpec().shape;
    expect(normalizeSpec({ ...defaultSpec(), shape: old as BodySpec['shape'] }).shape.thighs).toBe(1);
  });

  for (const style of ['mannequin', 'anime'] as const) {
    it(`${style}：是 1 时和原来一模一样；调大只有大腿变粗，脚踝、骨骼不动`, () => {
      const plain = buildFigure(specOf(style));
      expect(buildFigure(specOf(style, { thighs: 1 }))).toEqual(plain);
      const thick = buildFigure(specOf(style, { thighs: 1.4 }));
      const [a, b] = [leg(plain), leg(thick)];
      expect(b.bones).toEqual(a.bones);
      expect(b.pos).toEqual(a.pos);
      // 大腿中段明显粗了，脚踝上面一点还是原来那么粗
      expect(wide(b, 0.22) / wide(a, 0.22)).toBeGreaterThan(1.2);
      const ankle = Math.hypot(...a.bones!.find((q) => /^Foot/.test(q.name))!.head);
      expect(wide(b, ankle - 0.06) / wide(a, ankle - 0.06)).toBeCloseTo(1, 1);
      // 别的部件都没变
      for (const p of plain.parts) if (p.type !== 'leg') expect(thick.parts.find((q) => q.name === p.name)).toEqual(p);
    });

    it(`${style}：调小大腿变细`, () => {
      const [a, b] = [leg(buildFigure(specOf(style))), leg(buildFigure(specOf(style, { thighs: 0.8 })))];
      expect(wide(b, 0.22) / wide(a, 0.22)).toBeLessThan(0.9);
    });
  }

  it('叠在四肢粗细上面：两个都调时大腿是两个倍数相乘，脚踝那头和只调四肢粗细时一样', () => {
    const base = leg(buildFigure(specOf('anime', { limbs: 1.2 })));
    const both = leg(buildFigure(specOf('anime', { limbs: 1.2, thighs: 1.3 })));
    const k = (p: Part) => (p.prims.find((q) => q.kind === 'grid') as { thicken?: { k: number; end?: number } }).thicken!;
    expect(k(both).k).toBeCloseTo(k(base).k * 1.3, 9);
    expect(k(both).end ?? 1).toBeCloseTo(k(base).end ?? 1, 9);
    // 前后排的下半截用的那种：小腿往下变回四肢粗细设的倍数；加粗过一遍的再加粗，那头不跟着变
    const rows = thighen(base, 1.3, 'thick');
    expect(k(rows).end).toBeCloseTo(k(base).k, 9);
    expect(k(thighen(rows, 1.2)).end).toBeCloseTo(k(base).k, 9);
    expect(k(thighen(rows, 1.2)).k).toBeCloseTo(k(base).k * 1.3 * 1.2, 9);
  });

  it('不是人腿的（没有脚踝骨骼）原样返回', () => {
    const arm = buildFigure(specOf('anime')).parts.find((p) => p.type === 'arm')!;
    expect(thighen(arm, 1.5)).toBe(arm);
  });
});
