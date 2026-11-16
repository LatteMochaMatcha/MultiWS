// 体块第 3 期：缝合——把一个部件接到另一个部件上（见 docs/blocks-plan.md）
import { describe, expect, it } from 'vitest';
import { type Figure, type Part, worldTransforms } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, type V3, len, quatConj, quatMul, sub } from '../src/geometry/vec';
import { attachParts, attachedTo, canAttach, detachParts } from '../src/model/attach';
import { addBlock, removeBlock, setSplitTorso } from '../src/model/blocks';
import { setOverride } from '../src/model/overrides';
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
const at = (figure: Figure, name: string) => worldTransforms(figure).get(name)!;
/** 两个朝向差多少（弧度） */
const angle = (a: Quat, b: Quat) => 2 * Math.acos(Math.min(1, Math.abs(quatMul(a, quatConj(b))[3])));
/** 一个部件在两副身体里摆得一样（位置差不到 0.1 毫米，朝向、大小一样） */
function sameSpot(a: Figure, b: Figure, name: string, slack = 1e-4) {
  const [x, y] = [at(a, name), at(b, name)];
  expect(len(sub(x.pos, y.pos))).toBeLessThan(slack);
  expect(angle(x.quat, y.quat)).toBeLessThan(1e-3);
  expect(x.scale / y.scale).toBeCloseTo(1, 3);
}
/** 骨骼 → 父骨骼 */
const boneParents = (figure: Figure) => new Map(figure.parts.flatMap((p) => (p.bones ?? []).map((b) => [b.name, b.parent] as const)));
/** 骨骼 → 它在哪个部件里 */
const boneOwners = (figure: Figure) => new Map(figure.parts.flatMap((p) => (p.bones ?? []).map((b) => [b.name, p.name] as const)));

describe.each(STYLES)('缝合（%s）', (bodyStyle) => {
  const spec = specOf({ bodyStyle, counts: { ...defaultSpec().counts, tails: 1 } });
  const before = buildFigure(spec);

  it('接上去的那一刻留在原地；挂到了新的父部件上，骨骼也接过去', () => {
    const { spec: next, attached, refused } = attachParts(spec, ['Arm_01_L'], 'Head_01');
    expect(attached).toEqual(['Arm_01_L']);
    expect(refused).toEqual([]);
    expect(attachedTo(next, 'Arm_01_L')).toBe('Head_01');
    const figure = buildFigure(next);
    expect(part(figure, 'Arm_01_L').parent).toBe('Head_01');
    sameSpot(figure, before, 'Arm_01_L');
    // 手臂根上的骨骼接到头的骨骼上，手臂里面的骨骼还是一节接一节
    const arm = part(figure, 'Arm_01_L').bones!;
    expect(boneOwners(figure).get(arm[0].parent!)).toBe('Head_01');
    const own = new Set(arm.map((b) => b.name));
    for (const b of arm.slice(1)) expect(own.has(b.parent!)).toBe(true);
    expect(() => buildSkeleton(figure)).not.toThrow();
    expect(() => worldTransforms(figure)).not.toThrow();
    // 别的部件一点没动
    for (const p of before.parts) if (p.name !== 'Arm_01_L') sameSpot(figure, before, p.name, 1e-9);
  });

  it('挪、转、放大它接的那个部件，它跟着走；挪它自己，那个部件不动', () => {
    const next = attachParts(spec, ['Arm_01_L'], 'Head_01').spec;
    const still = buildFigure(next);
    const moved = buildFigure(setOverride(next, 'Head_01', { position: [0.1, 0.05, 0], rotation: [0, 40, 0], scale: [1.3, 1.3, 1.3] }));
    // 手臂在头自己的坐标里的位置没变
    const local = (f: Figure) => {
      const [head, arm] = [at(f, 'Head_01'), at(f, 'Arm_01_L')];
      return { far: len(sub(arm.pos, head.pos)) / head.scale, turn: quatMul(quatConj(head.quat), arm.quat), scale: arm.scale / head.scale };
    };
    expect(local(moved).far).toBeCloseTo(local(still).far, 6);
    expect(angle(local(moved).turn, local(still).turn)).toBeLessThan(1e-6);
    expect(local(moved).scale).toBeCloseTo(local(still).scale, 6);
    expect(len(sub(at(moved, 'Arm_01_L').pos, at(still, 'Arm_01_L').pos))).toBeGreaterThan(0.05);
    const own = buildFigure(setOverride(next, 'Arm_01_L', { position: [0, 0.1, 0] }));
    sameSpot(own, still, 'Head_01', 1e-9);
    expect(len(sub(at(own, 'Arm_01_L').pos, at(still, 'Arm_01_L').pos))).toBeGreaterThan(0.05);
  });

  it('原来的微调算进接上去的摆放里：挪过、转过、放大过的接上去也不跳', () => {
    const tweaked = setOverride(setOverride(spec, 'Arm_01_L', { position: [0.03, -0.2, 0.05], rotation: [10, 20, -30], scale: [1.2, 1.5, 1.2] }), 'Tail_01', { rotation: [0, 0, 25], scale: [1.1, 1.1, 1.6] });
    const was = buildFigure(tweaked);
    const { spec: next } = attachParts(tweaked, ['Arm_01_L'], 'Tail_01');
    const figure = buildFigure(next);
    sameSpot(figure, was, 'Arm_01_L');
    // 各方向不一样的那部分拉伸还在
    const [now, old] = [part(figure, 'Arm_01_L').resize!, part(was, 'Arm_01_L').resize!];
    for (let k = 0; k < 3; k++) expect(now[k]).toBeCloseTo(old[k], 3);
    // 微调里只剩拉伸（位置、角度、等比的大小都算进接上去的摆放里了）
    expect(Object.keys(next.overrides.Arm_01_L)).toEqual(['scale']);
  });

  it('头带着脖子一起接过去；头的骨骼还接着自己的脖子', () => {
    const { spec: next } = attachParts(spec, ['Head_01'], 'Arm_01_R');
    expect(Object.keys(next.blocks!.attach!).sort()).toEqual(['Head_01', 'Neck_01']);
    const figure = buildFigure(next);
    sameSpot(figure, before, 'Head_01');
    sameSpot(figure, before, 'Neck_01');
    const parents = boneParents(figure);
    const owners = boneOwners(figure);
    expect(owners.get(parents.get(part(figure, 'Neck_01').bones![0].name)!)).toBe('Arm_01_R');
    expect(parents.get(part(figure, 'Head_01').bones![0].name)).toBe(part(figure, 'Neck_01').bones![0].name);
    expect(() => buildSkeleton(figure)).not.toThrow();
  });

  it('腿接到手臂上：不再跟着胯，骨架照样拼得成', () => {
    const { spec: next } = attachParts(spec, ['Leg_01_L'], 'Arm_01_L');
    const figure = buildFigure(next);
    expect(part(figure, 'Leg_01_L').parent).toBe('Arm_01_L');
    expect(part(figure, 'Leg_01_L').fuseAs).toBeUndefined();
    expect(boneOwners(figure).get(part(figure, 'Leg_01_L').bones![0].parent!)).toBe('Arm_01_L');
    expect(() => buildSkeleton(figure)).not.toThrow();
    // 手臂抬起来，腿跟着
    const raised = buildFigure(setOverride(next, 'Arm_01_L', { rotation: [0, 0, 60] }));
    expect(len(sub(at(raised, 'Leg_01_L').pos, at(figure, 'Leg_01_L').pos))).toBeGreaterThan(0.05);
  });

  it('胸接到别处：换成自己成形的圆包、带自己的骨骼', () => {
    const { spec: next } = attachParts(spec, ['Chest_01_L'], 'Leg_01_L');
    const figure = buildFigure(next);
    const chest = part(figure, 'Chest_01_L');
    expect(chest.parent).toBe('Leg_01_L');
    expect(chest.surface ?? false).toBe(false);
    expect(chest.prims.some((q) => q.kind === 'chest')).toBe(false);
    expect(chest.bones?.length).toBe(1);
    expect(boneOwners(figure).get(chest.bones![0].parent!)).toBe('Leg_01_L');
    expect(len(sub(at(figure, 'Chest_01_L').pos, at(before, 'Chest_01_L').pos))).toBeLessThan(1e-4);
    expect(() => buildSkeleton(figure)).not.toThrow();
  });

  it('接不了的：接到自己、长在自己上面的部件、不存在的部件；躯干、脖子不能接', () => {
    expect(canAttach(before.parts, 'Arm_01_L', 'Arm_01_L')).toBe(false);
    expect(canAttach(before.parts, 'Arm_01_L', 'Nothing')).toBe(false);
    expect(canAttach(before.parts, 'Torso', 'Head_01')).toBe(false);
    expect(canAttach(before.parts, 'Neck_01', 'Arm_01_L')).toBe(false);
    expect(canAttach(before.parts, 'Head_01', 'Arm_01_L')).toBe(true);
    const horned = specOf({ bodyStyle, counts: { ...spec.counts, hornsPerHead: 2 } });
    const horn = buildFigure(horned).parts.find((p) => p.type === 'horn')!.name;
    expect(canAttach(buildFigure(horned).parts, 'Head_01', horn)).toBe(false);
    const out = attachParts(horned, ['Head_01', 'Arm_01_L'], horn);
    expect(out.refused).toEqual(['Head_01']);
    expect(out.attached).toEqual(['Arm_01_L']);
    // 两个部件互相接：后接的那条绕成圈，不起作用，部件一个不少
    const loop = attachParts(attachParts(spec, ['Arm_01_L'], 'Arm_01_R').spec, ['Arm_01_R'], 'Head_01').spec;
    const bad: BodySpec = { ...loop, blocks: { ...loop.blocks!, attach: { ...loop.blocks!.attach!, Arm_01_R: { ...loop.blocks!.attach!.Arm_01_R, to: 'Arm_01_L' } } } };
    const figure = buildFigure(bad);
    expect(figure.parts.length).toBe(before.parts.length);
    expect(() => worldTransforms(figure)).not.toThrow();
    expect(() => buildSkeleton(figure)).not.toThrow();
  });

  it('解开：回到原来的父部件上，还留在原地；还原以后回到自动摆位的地方', () => {
    const joined = setOverride(attachParts(spec, ['Arm_01_L'], 'Head_01').spec, 'Head_01', { position: [0.08, 0.04, 0], rotation: [0, 30, 10] });
    const was = buildFigure(joined);
    const freed = detachParts(joined, ['Arm_01_L']);
    expect(attachedTo(freed, 'Arm_01_L')).toBeUndefined();
    expect(freed.blocks!.attach).toBeUndefined();
    const figure = buildFigure(freed);
    expect(part(figure, 'Arm_01_L').parent).toBe(part(before, 'Arm_01_L').parent);
    sameSpot(figure, was, 'Arm_01_L', 2e-4);
    expect(boneParents(figure).get(part(figure, 'Arm_01_L').bones![0].name)).toBe(part(before, 'Arm_01_L').bones![0].parent);
    const { Arm_01_L: _gone, ...rest } = freed.overrides;
    sameSpot(buildFigure({ ...freed, overrides: rest }), buildFigure({ ...spec, overrides: rest }), 'Arm_01_L', 1e-9);
    // 没接过的解开：原样
    expect(detachParts(spec, ['Arm_01_L'])).toBe(spec);
    // 头解开时脖子一起解开
    const head = detachParts(attachParts(spec, ['Head_01'], 'Arm_01_R').spec, ['Head_01']);
    expect(head.blocks!.attach).toBeUndefined();
    sameSpot(buildFigure(head), before, 'Head_01', 2e-4);
  });

  it('复制出来的部件也能接；躯干分成两块以后照样能接', () => {
    const copied = addBlock(spec, [{ from: 'Arm_01_L', shift: [0, -0.2, 0] }]).spec;
    const was = buildFigure(copied);
    const joined = attachParts(copied, ['Arm_101_L'], 'Leg_01_R').spec;
    sameSpot(buildFigure(joined), was, 'Arm_101_L');
    // 拿掉那一块，它的缝合一起去掉
    expect(removeBlock(joined, 'Arm_101_L').blocks!.attach).toBeUndefined();
    const split = setSplitTorso(spec, true);
    const ribbed = attachParts(split, ['Tail_01'], 'UpperBody').spec;
    const figure = buildFigure(ribbed);
    sameSpot(figure, buildFigure(split), 'Tail_01');
    // 尾巴接在胸腔上：转胸腔它跟着，挪胯它不动
    const leaned = buildFigure(setOverride(ribbed, 'UpperBody', { rotation: [30, 0, 0] }));
    expect(len(sub(at(leaned, 'Tail_01').pos, at(figure, 'Tail_01').pos))).toBeGreaterThan(0.02);
    sameSpot(buildFigure(setOverride(ribbed, 'Torso', { position: [0.1, 0, 0] })), figure, 'Tail_01', 1e-9);
    expect(() => buildSkeleton(leaned)).not.toThrow();
  });
});

describe('缝合的设定', () => {
  const spec = specOf();

  it('存档读回来一样；乱写的丢掉', () => {
    const joined = attachParts(spec, ['Arm_01_L'], 'Head_01').spec;
    const back = parseSpecJson(serializeSpec(joined));
    expect(back.blocks!.attach!.Arm_01_L.to).toBe('Head_01');
    const [a, b] = [buildFigure(back), buildFigure(joined)];
    sameSpot(a, b, 'Arm_01_L', 1e-9);
    const messy = normalizeSpec({ blocks: { attach: { A: { to: 'A', pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: 1 }, B: { to: 'C', pos: [0, 0], quat: [0, 0, 0, 1], scale: 1 }, D: { to: 'E', pos: [1, 2, 3], quat: [0, 0, 0, 2], scale: 2 }, F: { to: 'G', pos: [0, 0, 0], quat: [0, 0, 0, 0], scale: 1 }, H: 'x' } } });
    expect(messy.blocks!.attach).toEqual({ D: { to: 'E', pos: [1, 2, 3], quat: [0, 0, 0, 1], scale: 2 } });
    expect(JSON.parse(serializeSpec(spec))).not.toHaveProperty('blocks');
  });

  it('没有缝合的设定，摆出来的和以前一样', () => {
    const { blocks: _blocks, ...old } = spec;
    expect(buildFigure(spec)).toEqual(buildFigure(old));
    // 两头的部件现在不在（改了数量）的那一条不起作用
    const stale: BodySpec = { ...spec, blocks: { added: [], attach: { Arm_09_L: { to: 'Head_01', pos: [0, 0, 0] as V3, quat: [0, 0, 0, 1], scale: 1 } } } };
    expect(buildFigure(stale)).toEqual(buildFigure(spec));
  });
});
