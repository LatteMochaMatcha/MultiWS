import { describe, expect, it } from 'vitest';
import { blockNames, cloneRootName, withBlocks } from '../src/geometry/clone';
import { type Figure, type Part, worldTransforms } from '../src/geometry/figure';
import { buildFigure, layoutFigure } from '../src/geometry/layout';
import { addBlock, blockRoots, isBlockRoot, removeBlock } from '../src/model/blocks';
import { applyPreset, PRESETS } from '../src/model/presets';
import { type BodySpec, defaultSpec, normalizeSpec, parseSpecJson, serializeSpec } from '../src/model/spec';
import { buildSkeleton } from '../src/rig/skeleton';
import { useAnimeBody } from './animeBody';

useAnimeBody();

const STYLES = ['mannequin', 'anime'] as const;
const specOf = (patch: Partial<BodySpec> = {}): BodySpec => normalizeSpec({ ...defaultSpec(), ...patch });
const part = (figure: Figure, name: string): Part => {
  const found = figure.parts.find((p) => p.name === name);
  if (!found) throw new Error(`没有部件 ${name}`);
  return found;
};
const boneNames = (figure: Figure) => figure.parts.flatMap((p) => (p.bones ?? []).map((b) => b.name));

describe('复制出来的部件叫什么', () => {
  it('最后一个编号换成这一块的号段，左右、后面的字照旧', () => {
    expect(cloneRootName('Arm_01_L', 1)).toBe('Arm_101_L');
    expect(cloneRootName('Arm_02_R', 3)).toBe('Arm_302_R');
    expect(cloneRootName('Leg_01', 2)).toBe('Leg_201');
    expect(cloneRootName('Head_01_Eye_02_L', 1)).toBe('Head_01_Eye_102_L');
    // 照复制出来的再复制：号段换成新的那一块的，不叠上去
    expect(cloneRootName('Arm_101_L', 2)).toBe('Arm_201_L');
  });
  it('名字里没有编号的（躯干、下身）复制不了', () => {
    expect(cloneRootName('Torso', 1)).toBeNull();
    expect(cloneRootName('LowerBody', 1)).toBeNull();
    expect(cloneRootName('UpperBody_L', 1)).toBeNull();
  });
});

describe.each(STYLES)('复制部件（%s）', (bodyStyle) => {
  // 带一对角：两种身体的头上都有长在头上的部件
  const spec = specOf({ bodyStyle, counts: { ...defaultSpec().counts, hornsPerHead: 2 } });
  const plain = layoutFigure(spec);

  it('没有加体块时原样返回', () => {
    expect(withBlocks(plain, [])).toBe(plain);
    expect(withBlocks(plain, undefined)).toBe(plain);
  });

  it('照着的部件不在时这一块不出现', () => {
    expect(withBlocks(plain, [{ id: 1, from: 'Arm_09_L' }])).toBe(plain);
  });

  it('复制一条手臂：多一个部件，形状一样，接在同一个父部件、同一根父骨骼上', () => {
    const figure = withBlocks(plain, [{ id: 1, from: 'Arm_01_L', shift: [0, -0.1, 0] }]);
    expect(figure.parts.length).toBe(plain.parts.length + 1);
    const from = part(figure, 'Arm_01_L');
    const copy = part(figure, 'Arm_101_L');
    expect(copy.parent).toBe(from.parent);
    // 素体本来肩膀上的手臂：复制出来的用根部切掉、垫圆肩头的那一套，不带腋下那圈皮
    expect(copy.prims).toEqual(from.posed?.prims ?? from.prims);
    expect(copy.posed).toBeUndefined();
    expect(copy.pos).toEqual([from.pos[0], from.pos[1] - 0.1, from.pos[2]]);
    // 骨骼一根不少，名字都换了，根上那根接在原来那根的父骨骼上
    expect(copy.bones!.length).toBe(from.bones!.length);
    expect(copy.bones![0].parent).toBe(from.bones![0].parent);
    const own = new Set(copy.bones!.map((b) => b.name));
    for (const b of copy.bones!.slice(1)) expect(own.has(b.parent!)).toBe(true);
    for (const b of from.bones!) expect(own.has(b.name)).toBe(false);
    // 原来的部件一点没动
    expect(figure.parts.slice(0, plain.parts.length)).toEqual(plain.parts);
  });

  it('骨骼名全身唯一，拼得成一副骨架；接上去的手的骨骼也跟着改了名', () => {
    const figure = withBlocks(plain, [
      { id: 1, from: 'Arm_01_L' },
      { id: 1, from: 'Arm_01_R' },
      { id: 2, from: 'Leg_01_L' },
      { id: 3, from: 'Head_01' },
    ]);
    const names = boneNames(figure);
    expect(new Set(names).size).toBe(names.length);
    expect(() => buildSkeleton(figure)).not.toThrow();
    expect(() => worldTransforms(figure)).not.toThrow();
    const copy = part(figure, 'Arm_101_L');
    const own = new Set(copy.bones!.map((b) => b.name));
    for (const graft of copy.grafts ?? []) {
      for (const name of Object.values(graft.bones)) expect(own.has(name)).toBe(true);
      for (const name of graft.rigid) expect(own.has(name)).toBe(true);
    }
  });

  it('复制头：带着脖子和头上长的（角、眼睛）', () => {
    const figure = withBlocks(plain, [{ id: 1, from: 'Head_01' }]);
    const under = plain.parts.filter((p) => p.name.startsWith('Head_01_')).map((p) => p.name);
    expect(under.length).toBeGreaterThan(0);
    expect(blockNames(figure, 'Head_101').sort()).toEqual(['Head_101', 'Neck_101', ...under.map((n) => n.replace('Head_01_', 'Head_101_'))].sort());
    for (const name of under) expect(part(figure, name.replace('Head_01_', 'Head_101_')).parent).toBe('Head_101');
    // 脖子的骨骼接着躯干，头的骨骼接着复制出来的脖子
    const neck = part(figure, 'Neck_101').bones![0];
    expect(neck.parent).toBe(part(figure, 'Neck_01').bones![0].parent);
    expect(part(figure, 'Head_101').bones![0].parent).toBe(neck.name);
  });

  it('照复制出来的再复制', () => {
    const figure = withBlocks(plain, [
      { id: 1, from: 'Arm_01_L' },
      { id: 2, from: 'Arm_101_L' },
    ]);
    expect(part(figure, 'Arm_201_L').prims).toEqual(part(figure, 'Arm_101_L').prims);
    const names = boneNames(figure);
    expect(new Set(names).size).toBe(names.length);
  });

  it('复制出来的胸不贴表面，能照平常的部件挪', () => {
    const figure = withBlocks(plain, [{ id: 1, from: 'Chest_01_L' }]);
    const copy = part(figure, 'Chest_101_L');
    expect(copy.surface ?? false).toBe(false);
    if (bodyStyle === 'anime') {
      // 素体的胸是贴在躯干表面上的一片：复制出来的换成自己成形的圆包，圆滑地融进身体
      expect(part(figure, 'Chest_01_L').surface).toBe(true);
      expect(copy.fuseAs).toBeUndefined();
      expect(copy.prims.map((q) => q.kind)).toEqual(['ellipsoid']);
      // 素体原位的头、脖子、腿也不再当成躯干的一部分直接拼；脖子换成光溜的圆台
      const more = withBlocks(plain, [
        { id: 1, from: 'Head_01', shift: [0.2, 0, 0] },
        { id: 2, from: 'Leg_01_L' },
      ]);
      for (const name of ['Head_101', 'Neck_101', 'Leg_201_L']) expect(part(more, name).fuseAs).toBeUndefined();
      expect(part(more, 'Neck_101').prims.some((q) => q.kind === 'grid')).toBe(false);
      // 头和脖子一起挪开
      expect(part(more, 'Neck_101').pos[0]).toBeCloseTo(part(more, 'Neck_01').pos[0] + 0.2, 9);
      expect(part(more, 'Head_101').pos[0]).toBeCloseTo(part(more, 'Head_01').pos[0] + 0.2, 9);
    }
    // 套上微调：挪了位置的是复制出来的那只，原来那只没动
    const moved = buildFigure({ ...spec, blocks: { added: [{ id: 1, from: 'Chest_01_L' }] }, overrides: { Chest_101_L: { position: [0, -0.2, 0] } } });
    const still = buildFigure(spec);
    expect(part(moved, 'Chest_01_L').pos).toEqual(part(still, 'Chest_01_L').pos);
    expect(part(moved, 'Chest_101_L').pos[1]).toBeCloseTo(part(still, 'Chest_01_L').pos[1] - 0.2, 6);
  });

  it('复制出来的胸自己带一根骨骼，接在离它最近的那节脊柱上；挪到别处以后改接', () => {
    const withBlock: BodySpec = { ...spec, blocks: { added: [{ id: 1, from: 'Chest_01_L' }] } };
    const figure = buildFigure(withBlock);
    const torso = new Set(part(figure, 'Torso').bones!.map((b) => b.name));
    const own = part(figure, 'Chest_101_L').bones!;
    expect(own.length).toBe(1);
    expect(own[0].name).toMatch(/^Bust_L\.\d{3}$/);
    expect(torso.has(own[0].parent!)).toBe(true);
    // 原来的胸还是没有骨骼
    expect(part(figure, 'Chest_01_L').bones).toBeUndefined();
    // 往下挪到胯上：改接到下面的那根
    const low = buildFigure({ ...withBlock, overrides: { Chest_101_L: { position: [0, -0.4, 0] } } });
    const moved = part(low, 'Chest_101_L').bones![0];
    expect(torso.has(moved.parent!)).toBe(true);
    expect(moved.parent).not.toBe(own[0].parent);
    expect(() => buildSkeleton(low)).not.toThrow();
  });

  it('没有体块的设定，摆出来的和以前一样', () => {
    const { blocks: _blocks, ...old } = spec;
    expect(buildFigure(spec)).toEqual(buildFigure(old));
  });
});

describe('设定里的体块', () => {
  const spec = specOf();

  it('加一块：左右一对用同一个号，原来那个的微调照搬过去', () => {
    const tweaked: BodySpec = { ...spec, overrides: { Arm_01_L: { scale: [1, 1.2, 1] }, Head_01_Eye_01_L: { hidden: true }, Head_01: { rotation: [0, 20, 0] } } };
    const arms = addBlock(tweaked, [
      { from: 'Arm_01_L', shift: [0, -0.1, 0] },
      { from: 'Arm_01_R', shift: [0, -0.1, 0] },
    ]);
    expect(arms.names).toEqual(['Arm_101_L', 'Arm_101_R']);
    expect(arms.spec.blocks!.added.map((b) => b.id)).toEqual([1, 1]);
    expect(arms.spec.overrides.Arm_101_L).toEqual({ scale: [1, 1.2, 1] });
    expect(arms.spec.overrides.Arm_101_R).toBeUndefined();
    // 再加一块用下一个号；头上删掉的眼睛，复制出来的头上也没有
    const head = addBlock(arms.spec, [{ from: 'Head_01' }]);
    expect(head.names).toEqual(['Head_201']);
    expect(head.spec.overrides.Head_201).toEqual({ rotation: [0, 20, 0] });
    expect(head.spec.overrides.Head_201_Eye_01_L).toEqual({ hidden: true });
    expect(isBlockRoot(head.spec, 'Head_201')).toBe(true);
    expect(isBlockRoot(head.spec, 'Head_201_Eye_01_L')).toBe(false);
    expect([...blockRoots(head.spec).keys()]).toEqual(['Arm_101_L', 'Arm_101_R', 'Head_201']);
    expect(buildFigure(head.spec).parts.some((p) => p.name === 'Head_201_Eye_01_L')).toBe(false);
  });

  it('plain：原来那个的微调不照搬', () => {
    const tweaked: BodySpec = { ...spec, overrides: { Chest_01_L: { position: [0.02, 0, 0] } } };
    expect(addBlock(tweaked, [{ from: 'Chest_01_L', plain: true }]).spec.overrides.Chest_101_L).toBeUndefined();
  });

  it('复制不了的原样返回', () => {
    const out = addBlock(spec, [{ from: 'Torso' }]);
    expect(out.names).toEqual([]);
    expect(out.spec).toBe(spec);
  });

  it('拿掉一块：连同照它再复制的、记在它们上面的微调；空出来的号下次接着用', () => {
    let next = addBlock(spec, [{ from: 'Head_01' }]).spec;
    next = addBlock(next, [{ from: 'Head_101' }]).spec;
    next = addBlock(next, [{ from: 'Arm_01_L' }]).spec;
    next = { ...next, overrides: { ...next.overrides, Head_101: { position: [0.2, 0, 0] }, Head_101_Eye_01_L: { hidden: true }, Neck_101: { scale: [1.1, 1.1, 1.1] }, Head_201: { position: [0.4, 0, 0] }, Arm_301_L: { position: [0, -0.1, 0] } } };
    const figure = buildFigure(next);
    const out = removeBlock(next, 'Head_101', blockNames(figure, 'Head_101'));
    expect(out.blocks!.added).toEqual([{ id: 3, from: 'Arm_01_L' }]);
    expect(Object.keys(out.overrides)).toEqual(['Arm_301_L']);
    expect(addBlock(out, [{ from: 'Leg_01_L' }]).names).toEqual(['Leg_101_L']);
    // 不是手工加的部件：不动
    expect(removeBlock(next, 'Arm_01_L')).toBe(next);
  });

  it('存档读回来一样；没有体块时存档里不写这个键；换预设时清掉', () => {
    const withBlock = addBlock(spec, [{ from: 'Arm_01_L', shift: [0, -0.1, 0] }]).spec;
    expect(parseSpecJson(serializeSpec(withBlock)).blocks).toEqual({ added: [{ id: 1, from: 'Arm_01_L', shift: [0, -0.1, 0] }] });
    expect(JSON.parse(serializeSpec(spec))).not.toHaveProperty('blocks');
    expect(parseSpecJson(serializeSpec(spec)).blocks).toEqual({ added: [] });
    expect(normalizeSpec({ blocks: { added: [{ id: 0, from: 'Arm_01_L' }, { id: 1 }, { id: 2, from: 'Leg_01_L', shift: [1, 2] }, 'x'] } }).blocks).toEqual({ added: [{ id: 2, from: 'Leg_01_L' }] });
    expect(applyPreset(withBlock, PRESETS[0]).blocks).toEqual({ added: [] });
  });
});
