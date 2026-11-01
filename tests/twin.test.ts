// 二次元素体：横排两副胯、一个上半身、两个头时，两个人从肩到胯并成一个宽躯干（animeLayout.ts 的 TWIN，sdf/grids.ts 的 GridUse.twin）
import { describe, expect, it } from 'vitest';
import type { GridShape, Part } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type BodyCounts, type BodySpec, defaultSpec } from '../src/model/spec';
import { castRay, compileField, fieldAt } from '../src/sdf/field';
import { fuseParts } from '../src/sdf/fuse';
import { useAnimeBody } from './animeBody';

const make = (counts: Partial<BodyCounts> = {}, rest: Partial<BodySpec> = {}): BodySpec => ({
  ...defaultSpec(),
  bodyStyle: 'anime',
  legLayout: 'abreast',
  armLayout: 'fan',
  ...rest,
  counts: { ...defaultSpec().counts, heads: 2, legs: 4, armPairs: 3, ...counts },
});
const twinOf = (spec: BodySpec) => {
  const torso = buildFigure(spec).parts.find((p) => p.name === 'Torso')!;
  return (torso.prims[0] as GridShape).twin;
};
/** 躯干自己的距离场（放在原点） */
const torsoField = (torso: Part) => compileField({ scale: 1, parts: [{ ...torso, pos: [0, 0, 0] }] }, { blend: 0 });

describe('两个人并成一个宽躯干', () => {
  it('只在横排两副胯、一个上半身、两个头（成簇）时这样做', () => {
    useAnimeBody();
    expect(twinOf(make())).toBeDefined();
    expect(twinOf(make({}, { armLayout: 'stack' }))).toBeDefined();
    expect(twinOf(make({ heads: 1 }))).toBeUndefined();
    expect(twinOf(make({ heads: 3 }))).toBeUndefined();
    expect(twinOf(make({ legs: 6 }))).toBeUndefined();
    expect(twinOf(make({ legs: 2 }, { legLayout: 'auto' }))).toBeUndefined();
    expect(twinOf(make({}, { headLayout: 'faces' }))).toBeUndefined();
    // 两个上半身时 layoutAnime 照一个上半身摆，再由 torsos.ts 分开：不并。横排两副胯时胯是两份，各在一副胯上，一直不并（没有 levels）
    const seat = twinOf(make({ torsos: 2, heads: 1 }));
    expect(seat?.levels).toBeUndefined();
    expect(seat?.d).toBeCloseTo(twinOf(make())!.d, 9);
  });

  it('两根脖子、两副胯各在一份底下；一排四个胸；手臂都长在两边外侧；左右对称', () => {
    useAnimeBody();
    const f = buildFigure(make());
    const d = twinOf(make())!.d;
    expect(d).toBeGreaterThan(0.1);
    expect(d).toBeLessThan(0.16);
    // 脖子根照素体的（素体的脖子不在正中线上，偏了 0.3 毫米）
    const necks = f.parts.filter((p) => p.type === 'neck').map((p) => p.pos[0]);
    expect(Math.min(...necks)).toBeCloseTo(-d, 3);
    expect(Math.max(...necks)).toBeCloseTo(d, 3);
    // 头照原样大（两个人），不像成簇那样小一圈
    for (const head of f.parts.filter((p) => p.type === 'head' && p.parent === 'Torso')) expect(head.scale ?? 1).toBeCloseTo(1, 6);
    // 胸：外侧那对 Chest_01、里侧那对 Chest_02，一排四个、左右对称
    const chests = f.parts.filter((p) => p.type === 'chest');
    expect(chests.map((p) => p.name).sort()).toEqual(['Chest_01_L', 'Chest_01_R', 'Chest_02_L', 'Chest_02_R']);
    const at = (name: string) => f.parts.find((p) => p.name === name)!.pos;
    expect(at('Chest_01_L')[0]).toBeGreaterThan(at('Chest_02_L')[0]);
    expect(at('Chest_02_L')[0]).toBeGreaterThan(0);
    expect(at('Chest_01_L')[0]).toBeCloseTo(-at('Chest_01_R')[0], 9);
    expect(at('Chest_02_L')[0]).toBeCloseTo(-at('Chest_02_R')[0], 9);
    // 六条手臂都在外侧那一份的肩膀上
    const arms = f.parts.filter((p) => p.type === 'arm');
    expect(arms).toHaveLength(6);
    for (const arm of arms) expect(Math.abs(arm.pos[0]), arm.name).toBeGreaterThan(d + 0.05);
    // 腿：每副胯两条，在那一份的原位（离它的正中一个髋关节宽），Leg_01 是左边那副
    const legs = f.parts.filter((p) => p.type === 'leg');
    expect(legs).toHaveLength(4);
    const left = legs.filter((p) => p.name.startsWith('Leg_01')).map((p) => p.pos[0]);
    expect(Math.min(...left)).toBeGreaterThan(0);
    expect((left[0] + left[1]) / 2).toBeCloseTo(d, 9);
    for (const leg of legs) expect(leg.fuseAs, leg.name).toBe('torso');
  });

  it('是一整块：胸口正中、腰正中前后都是实的（不是两个人中间留一道缝）；腰比胸、胯窄', () => {
    useAnimeBody();
    const f = buildFigure(make());
    const field = torsoField(f.parts.find((p) => p.name === 'Torso')!);
    /** 高度 y、正中线上躯干的前后表面 */
    const front = (y: number) => 0.5 - castRay(field, [0, y, 0.5], [0, 0, -1], 0.5);
    const back = (y: number) => -0.5 + castRay(field, [0, y, -0.5], [0, 0, 1], 0.5);
    const side = (y: number) => 0.6 - castRay(field, [0.6, y, 0.02], [-1, 0, 0], 0.6);
    for (const y of [0.98, 1.04, 1.1, 1.16, 1.22]) {
      expect(front(y) - back(y), `${y}`).toBeGreaterThan(0.12);
    }
    const waist = Math.min(...[1.02, 1.04, 1.06].map(side));
    expect(waist).toBeLessThan(side(1.2) - 0.02);
    expect(waist).toBeLessThan(side(0.9) - 0.04);
    // 两根脖子中间是下凹的（两根脖子，不是一堵墙）
    expect(front(1.3)).toBeLessThan(front(1.2));
  });

  it('距离场在各是各的和一整块之间过渡得平顺：沿竖线走，贴着表面的地方变得不比走的快多少，离得远的也不离谱', () => {
    useAnimeBody();
    const f = buildFigure(make());
    const field = torsoField(f.parts.find((p) => p.name === 'Torso')!);
    const step = 0.002;
    let near = 0;
    let far = 0;
    for (const x of [0, 0.03, 0.08, 0.13, 0.2, 0.26]) {
      for (const z of [-0.05, 0.03, 0.1]) {
        let prev = fieldAt(field, x, 0.82, z);
        for (let y = 0.82 + step; y < 1.36; y += step) {
          const v = fieldAt(field, x, y, z);
          const slope = Math.abs(v - prev) / step;
          if (Math.abs(v) < 0.006) near = Math.max(near, slope);
          far = Math.max(far, slope);
          prev = v;
        }
      }
    }
    // 腰上拉开的那一段宽、胸上窄，往上换得急：离表面远的地方距离已经按换得多急缩过（只会比实际的近，融合时不会漏掉表面），
    // 但缩的倍数也随高度变，离表面几厘米的地方会变得快一些
    expect(near).toBeLessThan(1.25);
    expect(far).toBeLessThan(2);
  });

  it('融合出来是一整块，没有空腔；胸调大、胯调宽、手臂上下排也是', () => {
    useAnimeBody();
    for (const spec of [
      make(),
      make({}, { shape: { ...defaultSpec().shape, bust: 1.6, hips: 1.3 } }),
      make({ chestPairs: 2 }, { armLayout: 'stack' }),
    ]) {
      const f = buildFigure(spec);
      const mesh = fuseParts(f.parts.filter((p) => p.material !== 'eye'), { voxel: 0.012, blend: spec.blend });
      expect(mesh.info.components).toBe(1);
      expect(mesh.info.cavities).toBe(0);
    }
  }, 60_000);
});
