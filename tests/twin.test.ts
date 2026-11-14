// 二次元素体横排两副胯（animeLayout.ts 的 TWIN、PAIR_HIPS，sdf/grids.ts 的 GridUse.twin）：
// 两个上半身（每个一个头）的，两个人从肩到胯并成一个宽躯干（layoutAnime 带 twin 摆好，再切成两个上半身）；
// 一个上半身两个头的，一个人的身子顶两个头，躯干在胯上分成两副
import { describe, expect, it } from 'vitest';
import { layoutAnime } from '../src/geometry/animeLayout';
import type { GridShape, Part } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { rotate, sub } from '../src/geometry/vec';
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
/** 并成一个宽躯干的（两个上半身切开之前） */
const merged = (spec: BodySpec) => layoutAnime(spec, true);
/** 躯干自己的距离场（放在原点） */
const torsoField = (torso: Part) => compileField({ scale: 1, parts: [{ ...torso, pos: [0, 0, 0] }] }, { blend: 0 });

describe('横排两副胯：两个人并成一个宽躯干（C）、一个人的身子分成两副胯（D）', () => {
  it('只在横排两副胯时这样做；一个上半身的（几个头都一样）腰以上不并，两个上半身各一个头的到脖子才分开', () => {
    useAnimeBody();
    expect(twinOf(make())).toBeDefined();
    expect(twinOf(make({}, { armLayout: 'stack' }))).toBeDefined();
    expect(twinOf(make({ legs: 6 }))).toBeUndefined();
    expect(twinOf(make({ legs: 2 }, { legLayout: 'auto' }))).toBeUndefined();
    // 一个上半身（一个头、两个头、三个头、一个头几张脸）：腰以上不再分开，往上拉开的渐渐收到零（一个人的身子）
    const pair = twinOf(make())!;
    for (const spec of [make(), make({ heads: 1 }), make({ heads: 3 }), make({}, { headLayout: 'faces' })]) {
      const t = twinOf(spec)!;
      expect(t.levels![2]).toBeGreaterThan(5);
      expect(t.steps[t.steps.length - 1][1]).toBe(0);
      expect(t.d).toBeCloseTo(pair.d, 9);
    }
    // 两个上半身（每个一个头）：照并成一个宽躯干摆，到脖子又分开，两副胯离得和 D 一样远
    const wide = twinOf(make({ torsos: 2, heads: 1 }))!;
    expect(wide.levels).toEqual((merged(make()).parts.find((p) => p.name === 'Torso')!.prims[0] as GridShape).twin!.levels);
    expect(wide.levels![3]).toBeLessThan(2);
    expect(wide.d).toBeCloseTo(pair.d, 9);
  });

  it('D：一个人的身子顶两个头（成簇、小一圈），胸按一个人贴、不放大，手臂只照设定（不加里侧的），腿在两副胯的原位', () => {
    useAnimeBody();
    const f = buildFigure(make());
    const d = twinOf(make())!.d;
    // 胸那个高度躯干和一个人的一样宽（同样两个头、一对腿的那个）
    const one = buildFigure(make({ legs: 2 }, { legLayout: 'auto' }));
    // 一个头的也一样：没有以前那块横着的胯（LowerBody）
    expect(buildFigure(make({ heads: 1 })).parts.some((p) => p.type === 'lower')).toBe(false);
    const side = (fig: typeof f, y: number) => 0.6 - castRay(torsoField(fig.parts.find((p) => p.name === 'Torso')!), [0.6, y, 0.02], [-1, 0, 0], 0.6);
    for (const y of [1.18, 1.25]) expect(side(f, y), `${y}`).toBeCloseTo(side(one, y), 2);
    // 肚子下面和两副胯一样宽，腰在两者之间
    expect(side(f, 0.96)).toBeGreaterThan(d + 0.1);
    expect(side(f, 1.07)).toBeLessThan(side(f, 0.96) - 0.05);
    expect(side(f, 1.07)).toBeGreaterThan(side(one, 1.07) + 0.01);
    // 头照成簇的画法小一圈：和同样两个头、一对腿的那个一样
    for (const name of ['Head_01', 'Head_02']) {
      const head = f.parts.find((p) => p.name === name)!;
      expect(head.prims, name).toEqual(one.parts.find((p) => p.name === name)!.prims);
    }
    const chests = f.parts.filter((p) => p.type === 'chest');
    expect(chests.map((p) => p.name).sort()).toEqual(['Chest_01_L', 'Chest_01_R']);
    for (const c of chests) {
      expect((c.prims[0] as { wide?: boolean }).wide, c.name).toBeUndefined();
      expect((c.prims[0] as { scale?: number[] }).scale, c.name).toBeUndefined();
    }
    expect(f.parts.filter((p) => p.type === 'arm')).toHaveLength(6);
    const legs = f.parts.filter((p) => p.type === 'leg');
    expect(legs).toHaveLength(4);
    const left = legs.filter((p) => p.name.startsWith('Leg_01')).map((p) => p.pos[0]);
    expect((left[0] + left[1]) / 2).toBeCloseTo(d, 9);
    for (const leg of legs) expect(leg.fuseAs, leg.name).toBe('torso');
  });

  it('D 选了宽躯干（多个头 wide）：并成两个人宽的躯干、胸按一个人摆在正中放大，手臂只在两边外侧，头照原样大；只在横排两副胯时这样', () => {
    useAnimeBody();
    const f = buildFigure(make({}, { headLayout: 'wide' }));
    const torso = f.parts.find((p) => p.name === 'Torso')!.prims[0] as GridShape;
    expect(torso.twin!.levels![3]).toBeLessThan(2);
    const d = torso.twin!.d;
    for (const head of f.parts.filter((p) => p.type === 'head')) expect(head.scale ?? 1).toBeCloseTo(1, 6);
    for (const c of f.parts.filter((p) => p.type === 'chest')) {
      expect((c.prims[0] as { wide?: boolean }).wide, c.name).toBe(true);
      expect((c.prims[0] as { scale?: number[] }).scale, c.name).toEqual([1.3, 1.3, 1.3]);
    }
    const arms = f.parts.filter((p) => p.type === 'arm');
    expect(arms).toHaveLength(6);
    for (const arm of arms) expect(Math.abs(arm.pos[0]), arm.name).toBeGreaterThan(d + 0.05);
    // 和两个上半身那种并成宽躯干的一样，只是不长里侧那两条
    expect(arms.map((p) => p.name).sort()).toEqual(merged(make()).parts.filter((p) => p.type === 'arm' && !p.name.startsWith('Arm_04')).map((p) => p.name).sort());
    // 别的组合选了宽躯干照凑成一簇
    expect(buildFigure(make({ legs: 2 }, { legLayout: 'auto', headLayout: 'wide' }))).toEqual(buildFigure(make({ legs: 2 }, { legLayout: 'auto', headLayout: 'cluster' })));
    expect(buildFigure(make({ heads: 3 }, { headLayout: 'wide' }))).toEqual(buildFigure(make({ heads: 3 }, { headLayout: 'cluster' })));
  });

  it('C：两根脖子、两副胯各在一份底下；胸按一个人算摆在正中、放大；外侧的手臂照设定，里侧各一条往前伸；左右对称', () => {
    useAnimeBody();
    const f = merged(make());
    const d = twinOf(make())!.d;
    expect(d).toBeGreaterThan(0.1);
    expect(d).toBeLessThan(0.16);
    // 脖子根照素体的（素体的脖子不在正中线上，偏了 0.3 毫米）
    const necks = f.parts.filter((p) => p.type === 'neck').map((p) => p.pos[0]);
    expect(Math.min(...necks)).toBeCloseTo(-d, 3);
    expect(Math.max(...necks)).toBeCloseTo(d, 3);
    // 头照原样大（两个人），不像成簇那样小一圈
    for (const head of f.parts.filter((p) => p.type === 'head' && p.parent === 'Torso')) expect(head.scale ?? 1).toBeCloseTo(1, 6);
    // 胸：按一个人算，正中一对（贴在宽躯干外面，见 ChestShape.wide），左右对称，离正中线和一个人的胸一样远
    const chests = f.parts.filter((p) => p.type === 'chest');
    expect(chests.map((p) => p.name).sort()).toEqual(['Chest_01_L', 'Chest_01_R']);
    const at = (name: string) => f.parts.find((p) => p.name === name)!.pos;
    expect(at('Chest_01_L')[0]).toBeGreaterThan(0.03);
    expect(at('Chest_01_L')[0]).toBeLessThan(0.08);
    expect(at('Chest_01_L')[0]).toBeCloseTo(-at('Chest_01_R')[0], 9);
    for (const c of chests) expect((c.prims[0] as { wide?: boolean }).wide, c.name).toBe(true);
    for (const c of chests) expect((c.prims[0] as { scale?: number[] }).scale, c.name).toEqual([1.3, 1.3, 1.3]);
    // 外侧那一份的肩膀上照设定三对（六条），里侧的肩膀（两根脖子中间）每个人一条：排在后面，往前伸、往那个人自己的正中偏
    const arms = f.parts.filter((p) => p.type === 'arm');
    expect(arms).toHaveLength(8);
    const inner = arms.filter((p) => Math.abs(p.pos[0]) < d);
    expect(inner.map((p) => p.name).sort()).toEqual(['Arm_04_L', 'Arm_04_R']);
    for (const arm of arms.filter((p) => !inner.includes(p))) expect(Math.abs(arm.pos[0]), arm.name).toBeGreaterThan(d + 0.05);
    for (const arm of inner) {
      // 长在 -side 那个人身上（左手长在右边那个人的里侧），离正中线不远
      expect(Math.sign(arm.pos[0]), arm.name).toBe(-arm.side);
      const bone = arm.bones!.find((b) => b.name.startsWith('UpperArm'))!;
      const dir = rotate(arm.quat, sub(bone.tail, bone.head));
      expect(dir[2], arm.name).toBeGreaterThan(Math.abs(dir[0]) * 2);
      expect(Math.sign(dir[0]), arm.name).toBe(-arm.side);
      expect(arm.bones!.every((b) => !/_[LR](\.\d+)?$/.test(b.name) || b.name.endsWith('.004')), arm.name).toBe(true);
    }
    // 腿：每副胯两条，在那一份的原位（离它的正中一个髋关节宽），Leg_01 是左边那副
    const legs = f.parts.filter((p) => p.type === 'leg');
    expect(legs).toHaveLength(4);
    const left = legs.filter((p) => p.name.startsWith('Leg_01')).map((p) => p.pos[0]);
    expect(Math.min(...left)).toBeGreaterThan(0);
    expect((left[0] + left[1]) / 2).toBeCloseTo(d, 9);
    for (const leg of legs) expect(leg.fuseAs, leg.name).toBe('torso');
  });

  it('C 是一整块：胸口正中、腰正中前后都是实的（不是两个人中间留一道缝）；腰比胸、胯窄', () => {
    useAnimeBody();
    const f = merged(make());
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
    const step = 0.002;
    let near = 0;
    let far = 0;
    for (const f of [merged(make()), buildFigure(make())]) {
      const field = torsoField(f.parts.find((p) => p.name === 'Torso')!);
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
      make({ breasts: 4 }, { armLayout: 'stack' }),
      make({ heads: 1, tails: 1, wingPairs: 1 }),
    ]) {
      for (const f of [merged(spec), buildFigure(spec)]) {
        const mesh = fuseParts(f.parts.filter((p) => p.material !== 'eye'), { voxel: 0.012, blend: spec.blend });
        expect(mesh.info.components).toBe(1);
        expect(mesh.info.cavities).toBe(0);
      }
    }
  }, 120_000);
});
