// 体块第 4 期：躯干分成两块以后，胸腔（带着头、手臂、胸）和胯（带着腿）也能复制（见 docs/blocks-plan.md）
import { describe, expect, it } from 'vitest';
import { blockNames, cloneRootName, withBlocks } from '../src/geometry/clone';
import { cloneBoneSource } from '../src/geometry/cloneNames';
import { type Figure, type Part, worldTransforms } from '../src/geometry/figure';
import { buildFigure, layoutFigure } from '../src/geometry/layout';
import { isPelvis, isRibcage, pelvisOf } from '../src/geometry/pelvis';
import { type Quat, add, len, mul, quatConj, quatEuler, quatMul, rotate, sub } from '../src/geometry/vec';
import { attachParts, canAttach, detachParts } from '../src/model/attach';
import { addBlock, canCopy, copyShift, removeBlock, setSplitTorso } from '../src/model/blocks';
import { setOverride } from '../src/model/overrides';
import { partLabel } from '../src/model/partLabel';
import { type BodySpec, defaultSpec, normalizeSpec } from '../src/model/spec';
import { emptyPosing } from '../src/pose/posing';
import { isRingRig } from '../src/pose/ring';
import { makeSolver, stateOf } from '../src/pose/solver';
import { writeGlb } from '../src/io/glb';
import { buildSkeleton } from '../src/rig/skeleton';
import { skinVertices } from '../src/rig/skin';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
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
const angle = (a: Quat, b: Quat) => 2 * Math.acos(Math.min(1, Math.abs(quatMul(a, quatConj(b))[3])));
function sameSpot(a: Figure, b: Figure, name: string, slack = 1e-4) {
  const [x, y] = [at(a, name), at(b, name)];
  expect(len(sub(x.pos, y.pos))).toBeLessThan(slack);
  expect(angle(x.quat, y.quat)).toBeLessThan(1e-3);
  expect(x.scale / y.scale).toBeCloseTo(1, 3);
}
/** 胸腔的腰（它转、缩放绕着的那个支点）在世界里离正中多远（米，往角色的左手边是正的） */
const waistX = (figure: Figure, name: string) => {
  const xf = at(figure, name);
  const pivot = part(figure, name).pivot ?? [0, 0, 0];
  return add(xf.pos, mul(rotate(xf.quat, pivot), xf.scale))[0];
};
const boneParents = (figure: Figure) => new Map(figure.parts.flatMap((p) => (p.bones ?? []).map((b) => [b.name, b.parent] as const)));
const boneNames = (figure: Figure) => figure.parts.flatMap((p) => (p.bones ?? []).map((b) => b.name));

describe('复制出来的名字', () => {
  it('没有编号的（胸腔、胯、下身）在左右的后缀前面加上这一块的号', () => {
    expect(cloneRootName('UpperBody', 1)).toBe('UpperBody_101');
    expect(cloneRootName('Torso', 2)).toBe('Torso_201');
    expect(cloneRootName('LowerBody', 1)).toBe('LowerBody_101');
    expect(cloneRootName('Hip_L', 1)).toBe('Hip_101_L');
    // 照复制出来的再复制：换成新那一块的号段
    expect(cloneRootName('UpperBody_101', 3)).toBe('UpperBody_301');
  });
  it('界面上叫「胸腔 加2」「胯和小腹 加1」', () => {
    expect(partLabel('UpperBody_201')).toBe('胸腔 加2');
    expect(partLabel('Torso_101')).toBe('胯和小腹 加1');
  });
  it('复制出来的骨骼是照哪根复制的', () => {
    expect(cloneBoneSource('UpperArm_L.101')).toBe('UpperArm_L');
    expect(cloneBoneSource('Chest.102')).toBe('Chest.002');
    expect(cloneBoneSource('Hips.121')).toBe('Hips');
    expect(cloneBoneSource('Spine.002')).toBeNull();
    expect(cloneBoneSource('Hips')).toBeNull();
  });
});

describe.each(STYLES)('复制胸腔、胯（%s）', (bodyStyle) => {
  const whole = specOf({ bodyStyle, counts: { ...defaultSpec().counts, tails: 1 } });
  const spec = setSplitTorso(whole, true);
  const split = buildFigure(spec);

  it('躯干没分开的时候复制不了；分开以后胸腔、胯能复制', () => {
    const plain = buildFigure(whole);
    expect(canCopy(plain.parts, part(plain, 'Torso'))).toBe(false);
    expect(withBlocks(layoutFigure(whole), [{ id: 1, from: 'Torso' }])).toEqual(layoutFigure(whole));
    expect(isRibcage(part(split, 'UpperBody'))).toBe(true);
    expect(isPelvis(part(split, 'Torso'))).toBe(true);
    expect(canCopy(split.parts, part(split, 'UpperBody'))).toBe(true);
    expect(canCopy(split.parts, part(split, 'Torso'))).toBe(true);
    // 胸腔复制出来不用挪开：几个胸腔在胯上自己会并排摆开
    expect(copyShift(part(split, 'UpperBody'))).toBeUndefined();
    expect(copyShift(part(split, 'Torso'))![2]).toBeLessThan(0);
    // 几个上半身的时候不行（它们本来就是分开的另一套）
    const multi = buildFigure(specOf({ bodyStyle, counts: { ...defaultSpec().counts, torsos: 2 } }));
    for (const p of multi.parts.filter((q) => q.type === 'torso')) expect(canCopy(multi.parts, p)).toBe(false);
  });

  it('复制胸腔：带着脖子、头、手臂、胸；骨骼一根不重名，脊柱接在同一根 Hips 上', () => {
    const more = addBlock(spec, [{ from: 'UpperBody' }]).spec;
    const figure = buildFigure(more);
    const under = split.parts.filter((p) => p.parent === 'UpperBody').map((p) => p.name);
    expect(under.length).toBeGreaterThan(4);
    // 这一块里的部件和原来那块胸腔带着的一样多（连同头上长的）
    expect(blockNames(figure, 'UpperBody_101').length).toBe(blockNames(split, 'UpperBody').length);
    expect(blockNames(figure, 'UpperBody_101')).toEqual(expect.arrayContaining(['UpperBody_101', 'Neck_101', 'Head_101', 'Arm_101_L', 'Arm_101_R', 'Chest_101_L', 'Chest_101_R']));
    for (const name of under) expect(part(figure, cloneRootName(name, 1)).parent).toBe('UpperBody_101');
    expect(part(figure, 'UpperBody_101').parent).toBeUndefined();
    expect(isRibcage(part(figure, 'UpperBody_101'))).toBe(true);
    const names = boneNames(figure);
    expect(new Set(names).size).toBe(names.length);
    const parents = boneParents(figure);
    expect(parents.get('Spine.101')).toBe('Hips');
    expect(parents.get('Chest.101')).toBe('Spine.101');
    expect(() => buildSkeleton(figure)).not.toThrow();
    // 两个胸腔在胯上左右并排：原来那个偏右、复制出来的偏左，离正中一样远，各往外歪开
    expect(waistX(figure, 'UpperBody')).toBeCloseTo(-waistX(figure, 'UpperBody_101'), 6);
    expect(waistX(figure, 'UpperBody_101')).toBeGreaterThan(0.03);
    expect(at(figure, 'Head_101').pos[0]).toBeGreaterThan(at(figure, 'UpperBody_101').pos[0]);
    expect(at(figure, 'Head_01').pos[0]).toBeLessThan(at(figure, 'UpperBody').pos[0]);
    // 素体：胯的上半截跟着往两边加宽（多了一段 widenX），各有各的腰
    if (bodyStyle === 'anime') {
      const bands = (f: Figure) => part(f, 'Torso').prims.reduce((n, q) => n + (q.kind === 'grid' ? (q.widenX?.length ?? 0) : 0), 0);
      expect(bands(figure)).toBe(bands(split) + 1);
    }
    // 跟着复制的胸还贴在它自己那块胸腔上（素体），不换成圆包、不带骨骼
    const chest = part(figure, 'Chest_101_L');
    expect(chest.surface ?? false).toBe(part(split, 'Chest_01_L').surface ?? false);
    expect(chest.bones).toBeUndefined();
  });

  it('胸腔上有以前复制出来的手臂时照样能复制：两条手臂的新名字不撞', () => {
    const armed = addBlock(spec, [{ from: 'Arm_01_L' }, { from: 'Arm_01_R' }]).spec;
    const tweaked = setOverride(armed, 'UpperBody', { rotation: [20, 0, 0] });
    const more = addBlock(tweaked, [{ from: 'UpperBody', shift: [0.22, 0, 0] }]).spec;
    // 原来那块胸腔的微调照搬到复制出来的上面；别的复制出来的胸腔的不搬
    expect(more.overrides.UpperBody_201).toEqual({ rotation: [20, 0, 0] });
    expect(Object.keys(more.overrides).filter((k) => /^UpperBody_201_/.test(k))).toEqual([]);
    const figure = buildFigure(more);
    const arms = figure.parts.filter((p) => p.type === 'arm' && p.parent === 'UpperBody_201').map((p) => p.name).sort();
    expect(arms).toEqual(['Arm_201_L', 'Arm_201_R', 'Arm_202_L', 'Arm_202_R']);
    const names = boneNames(figure);
    expect(new Set(names).size).toBe(names.length);
    expect(() => buildSkeleton(figure)).not.toThrow();
    // 再复制一次复制出来的那块，也成
    const again = buildFigure(addBlock(more, [{ from: 'UpperBody_201', shift: [-0.44, 0, 0] }]).spec);
    expect(again.parts.some((p) => p.name === 'UpperBody_301')).toBe(true);
    expect(() => buildSkeleton(again)).not.toThrow();
  });

  it('三个胸腔：原来那个在正中，复制出来的一左一右；拿掉以后剩下的重新摆，全拿掉就和没复制一样', () => {
    const two = addBlock(spec, [{ from: 'UpperBody' }]).spec;
    const three = addBlock(two, [{ from: 'UpperBody' }]).spec;
    const figure = buildFigure(three);
    expect(Math.abs(waistX(figure, 'UpperBody'))).toBeLessThan(1e-6);
    expect(waistX(figure, 'UpperBody_101')).toBeGreaterThan(0.05);
    expect(waistX(figure, 'UpperBody_201')).toBeCloseTo(-waistX(figure, 'UpperBody_101'), 6);
    expect(() => buildSkeleton(figure)).not.toThrow();
    // 里侧的手臂（旁边还有别的胸腔的那一边）改成往前伸：正中那个两边都是，两边的各一条。两种白模都是
    const turned = (name: string) => JSON.stringify(part(figure, name).quat) !== JSON.stringify(part(split, 'Arm_01_' + name.slice(-1)).quat);
    expect(['Arm_01_L', 'Arm_01_R', 'Arm_101_R', 'Arm_201_L'].every(turned)).toBe(true);
    expect(['Arm_101_L', 'Arm_201_R'].some(turned)).toBe(false);
    // 两种白模都是直立并排、各有各的腰（不是从细腰上斜着岔出去）：往两边挪的那一份在胯顶上下一小段里就挪足，往外歪不到 15 度
    const fork = part(figure, 'UpperBody_101')
      .prims.map((q) => (q.kind === 'grid' || q.kind === 'loft' ? q.fork : undefined))
      .find((f) => f !== undefined)!;
    expect(fork.shiftFrom).toBeDefined();
    expect(fork.shiftTo! - fork.shiftFrom!).toBeLessThan(0.2);
    const lean = 2 * Math.acos(Math.min(1, Math.abs(part(figure, 'UpperBody_101').quat[3])));
    expect(lean).toBeGreaterThan(0.05);
    expect(lean).toBeLessThan((15 * Math.PI) / 180);
    // 白模人台的胯是一摞椭圆截面：最上面那一圈跟着加宽，托得住三个腰
    const topRing = (f: Figure) => {
      const loft = part(f, 'Torso').prims.find((q) => q.kind === 'loft');
      return loft?.kind === 'loft' ? loft.rings[loft.rings.length - 1].w : undefined;
    };
    if (topRing(split) !== undefined) expect(topRing(figure)!).toBeGreaterThan(topRing(split)! + 0.05);
    // 拿掉一个：剩下两个重新左右排开
    const back = buildFigure(removeBlock(three, 'UpperBody_201', blockNames(figure, 'UpperBody_201')));
    expect(waistX(back, 'UpperBody')).toBeCloseTo(-waistX(back, 'UpperBody_101'), 6);
    // 全拿掉：和没复制过一样
    const none = removeBlock(removeBlock(three, 'UpperBody_201', blockNames(figure, 'UpperBody_201')), 'UpperBody_101', blockNames(figure, 'UpperBody_101'));
    expect(buildFigure(none)).toEqual(split);
  });

  it('挪、转复制出来的胸腔：它上面的头、手臂跟着，原来的胸腔、胯、腿不动', () => {
    const more = addBlock(spec, [{ from: 'UpperBody', shift: [0.22, 0, 0] }]).spec;
    const still = buildFigure(more);
    const moved = buildFigure(setOverride(more, 'UpperBody_101', { rotation: [0, 0, -25], position: [0.05, 0, 0] }));
    for (const name of ['UpperBody', 'Head_01', 'Arm_01_L', 'Torso', 'Leg_01_L', 'Leg_01_R']) sameSpot(moved, still, name, 1e-9);
    expect(len(sub(at(moved, 'Head_101').pos, at(still, 'Head_101').pos))).toBeGreaterThan(0.05);
    expect(() => buildSkeleton(moved)).not.toThrow();
  });

  it('复制出来的胸腔上的胸也能单独微调', () => {
    const more = addBlock(spec, [{ from: 'UpperBody', shift: [0.22, 0, 0] }]).spec;
    const still = buildFigure(more);
    const moved = buildFigure(setOverride(more, 'Chest_101_L', { position: [0.01, -0.03, 0], scale: [1.3, 1.3, 1.3] }, false));
    const [a, b] = [part(still, 'Chest_101_L'), part(moved, 'Chest_101_L')];
    expect(b.pos[1]).toBeCloseTo(a.pos[1] - 0.03, 6);
    expect(JSON.stringify(b.prims) !== JSON.stringify(a.prims) || (b.scale ?? 1) !== (a.scale ?? 1)).toBe(true);
    // 原来那只没动
    expect(part(moved, 'Chest_01_L')).toEqual(part(still, 'Chest_01_L'));
  });

  it('复制胯：带着跟着它的腿、尾巴，顶上垫圆顶；骨骼接在原来那根 Hips 上', () => {
    const more = addBlock(spec, [{ from: 'Torso', shift: [0, 0, -0.2] }]).spec;
    const figure = buildFigure(more);
    const names = blockNames(figure, 'Torso_101');
    expect(names).toContain('Leg_101_L');
    expect(names).toContain('Leg_101_R');
    expect(names).toContain('Tail_101');
    expect(names.some((n) => /^(Head|Arm|Neck|UpperBody)/.test(n))).toBe(false);
    expect(isPelvis(part(figure, 'Torso_101'))).toBe(true);
    expect(part(figure, 'Torso_101').prims.some((q) => q.name === 'Dome')).toBe(true);
    expect(part(figure, 'Torso').prims.some((q) => q.name === 'Dome')).toBe(false);
    const parents = boneParents(figure);
    expect(parents.get('Hips.101')).toBe('Hips');
    expect(parents.get(part(figure, 'Leg_101_L').bones![0].name)).toBe('Hips.101');
    expect(() => buildSkeleton(figure)).not.toThrow();
    const all = boneNames(figure);
    expect(new Set(all).size).toBe(all.length);
    // 哪些部件跟着哪块胯
    const follows = pelvisOf(figure.parts);
    expect(follows.get('Leg_01_L')).toBe('Torso');
    expect(follows.get('Tail_01')).toBe('Torso');
    expect(follows.get('Leg_101_L')).toBe('Torso_101');
    expect(follows.get('Tail_101')).toBe('Torso_101');
  });

  it('两块胯各带各的腿：挪后面那块，前面的腿不动；挪前面那块，后面的腿不动', () => {
    const more = addBlock(spec, [{ from: 'Torso', shift: [0, 0, -0.2] }]).spec;
    const still = buildFigure(more);
    const rear = buildFigure(setOverride(more, 'Torso_101', { position: [0.15, 0, -0.1] }));
    for (const name of ['Torso', 'Leg_01_L', 'Leg_01_R', 'Tail_01', 'UpperBody', 'Head_01']) sameSpot(rear, still, name, 1e-9);
    for (const name of ['Torso_101', 'Leg_101_L', 'Leg_101_R', 'Tail_101']) {
      const d = sub(at(rear, name).pos, at(still, name).pos);
      expect(d[0] / still.scale).toBeCloseTo(0.15, 6);
      expect(d[2] / still.scale).toBeCloseTo(-0.1, 6);
    }
    const front = buildFigure(setOverride(more, 'Torso', { position: [-0.1, 0, 0] }));
    for (const name of ['Torso_101', 'Leg_101_L', 'Leg_101_R', 'Tail_101', 'UpperBody']) sameSpot(front, still, name, 1e-9);
    expect((at(front, 'Leg_01_L').pos[0] - at(still, 'Leg_01_L').pos[0]) / still.scale).toBeCloseTo(-0.1, 6);
  });

  it('复制出来的胸腔接到另一块胯上：还是从胯上长出来的，换了一块胯，留在原地；挪那块胯它跟着', () => {
    let more = addBlock(spec, [{ from: 'Torso', shift: [0, 0, -0.25] }]).spec;
    more = addBlock(more, [{ from: 'UpperBody', shift: [0, 0, -0.25] }]).spec;
    const before = buildFigure(more);
    expect(canAttach(before.parts, 'UpperBody_201', 'Torso_101')).toBe(true);
    // 原来那块胸腔不能接（它和胯是各自独立的两块）
    expect(canAttach(before.parts, 'UpperBody', 'Torso_101')).toBe(false);
    const joined = attachParts(more, ['UpperBody_201'], 'Torso_101').spec;
    const figure = buildFigure(joined);
    expect(part(figure, 'UpperBody_201').parent).toBe('Torso_101');
    expect(isRibcage(part(figure, 'UpperBody_201'))).toBe(true);
    sameSpot(figure, before, 'UpperBody_201');
    sameSpot(figure, before, 'Head_201');
    expect(boneParents(figure).get('Spine.121')).toBe('Hips.101');
    expect(() => buildSkeleton(figure)).not.toThrow();
    const moved = buildFigure(setOverride(joined, 'Torso_101', { position: [0.2, 0, 0] }));
    expect((at(moved, 'Head_201').pos[0] - at(figure, 'Head_201').pos[0]) / figure.scale).toBeCloseTo(0.2, 4);
    sameSpot(moved, figure, 'Head_01', 1e-9);
    // 解开：回到不挂在别的部件上，还在原地
    const freed = buildFigure(detachParts(joined, ['UpperBody_201']));
    expect(part(freed, 'UpperBody_201').parent).toBeUndefined();
    sameSpot(freed, figure, 'UpperBody_201', 3e-4);
  });

  it('复制出来的胸腔接到别的部件上：不再从胯上长出来，是一整块，底下垫圆顶', () => {
    const more = setOverride(addBlock(spec, [{ from: 'UpperBody', shift: [0.3, 0.1, 0] }]).spec, 'UpperBody_101', { scale: [0.5, 0.5, 0.5] });
    const before = buildFigure(more);
    const joined = attachParts(more, ['UpperBody_101'], 'Arm_01_L').spec;
    const figure = buildFigure(joined);
    const ribs = part(figure, 'UpperBody_101');
    expect(ribs.parent).toBe('Arm_01_L');
    expect(isRibcage(ribs)).toBe(false);
    expect(ribs.prims.some((q) => q.name === 'Dome')).toBe(true);
    // 接出去以后胯上只剩原来那个胸腔，它回到正中（手臂跟着它）；接出去的那个在手臂上的位置没变，它上面的头也是
    const onArm = (f: Figure, name: string) => {
      const [arm, it] = [at(f, 'Arm_01_L'), at(f, name)];
      return { far: len(sub(it.pos, arm.pos)) / arm.scale, turn: quatMul(quatConj(arm.quat), it.quat), scale: it.scale / arm.scale };
    };
    for (const name of ['UpperBody_101', 'Head_101']) {
      expect(onArm(figure, name).far).toBeCloseTo(onArm(before, name).far, 4);
      expect(angle(onArm(figure, name).turn, onArm(before, name).turn)).toBeLessThan(1e-3);
      expect(onArm(figure, name).scale).toBeCloseTo(onArm(before, name).scale, 4);
    }
    expect(Math.abs(waistX(figure, 'UpperBody'))).toBeLessThan(1e-6);
    expect(() => buildSkeleton(figure)).not.toThrow();
    expect(() => worldTransforms(figure)).not.toThrow();
  });

  it('拿掉复制出来的胸腔、胯：连同它们带着的部件', () => {
    let more = addBlock(spec, [{ from: 'UpperBody' }]).spec;
    more = addBlock(more, [{ from: 'Torso' }]).spec;
    const figure = buildFigure(more);
    const gone = removeBlock(removeBlock(more, 'UpperBody_101', blockNames(figure, 'UpperBody_101')), 'Torso_201', blockNames(figure, 'Torso_201'));
    expect(gone.blocks!.added).toEqual([]);
    expect(buildFigure(gone).parts.map((p) => p.name).sort()).toEqual(split.parts.map((p) => p.name).sort());
  });

  it('带骨骼导出：复制出来的胸腔、胯、接到别处的胸都在文件里，骨骼一根接一根、权重加起来是 1', () => {
    let more = addBlock(spec, [{ from: 'UpperBody' }]).spec;
    more = addBlock(more, [{ from: 'Torso', shift: [0, 0, -0.2] }]).spec;
    more = addBlock(more, [{ from: 'Chest_01_L', shift: [0, -0.2, -0.02], plain: bodyStyle === 'anime' }]).spec;
    more = attachParts(more, ['Chest_301_L'], 'Leg_01_L').spec;
    const figure = buildFigure(more);
    const unit = { parts: figure.parts, scale: 1 };
    const fused = fuseParts(unit.parts, { voxel: VOXEL.draft, blend: more.blend });
    const skeleton = buildSkeleton(figure);
    const skin = skinVertices(unit, buildSkeleton(unit), fused.positions);
    const glb = writeGlb(
      [{ name: 'OC_BaseMesh', positions: fused.positions.map((v) => v * figure.scale), normals: fused.normals, indices: fused.triangles, joints: skin.joints, weights: skin.weights }],
      { skeleton, rigName: 'OC_Rig' },
    );
    // 拆开 GLB：JSON 那一块
    const view = new DataView(glb);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, view.getUint32(12, true))));
    const names: string[] = json.skins[0].joints.map((j: number) => json.nodes[j].name);
    expect(names).toHaveLength(skeleton.bones.length);
    expect(new Set(names).size).toBe(names.length);
    for (const name of ['Hips', 'Spine', 'Spine.101', 'UpperChest.101', 'Head.101', 'Hips.121', 'UpperLeg_L.121']) expect(names).toContain(name);
    expect(names.some((n) => /^Bust_L\.\d{3}$/.test(n))).toBe(true);
    // 每根骨骼除了 Hips 都挂在另一根骨骼底下（节点树是一棵树）
    const childOf = new Map<number, number>();
    json.nodes.forEach((node: { children?: number[] }, i: number) => (node.children ?? []).forEach((c) => childOf.set(c, i)));
    const rootless = json.skins[0].joints.filter((j: number) => !childOf.has(j) || !json.skins[0].joints.includes(childOf.get(j)));
    expect(rootless.map((j: number) => json.nodes[j].name)).toEqual(['Hips']);
    // 权重：每个顶点四个加起来是 1，骨骼下标都在范围里
    for (let v = 0; v < skin.weights.length; v += 4) {
      expect(skin.weights[v] + skin.weights[v + 1] + skin.weights[v + 2] + skin.weights[v + 3]).toBeCloseTo(1, 4);
      for (let k = 0; k < 4; k++) expect(skin.joints[v + k]).toBeLessThan(names.length);
    }
  });

  it('套姿势：复制出来的脊柱、胯、腿没记的跟着原来那根；三根脊柱不当成围成一圈', () => {
    let more = addBlock(spec, [{ from: 'UpperBody', shift: [0.22, 0, 0] }]).spec;
    more = addBlock(more, [{ from: 'UpperBody', shift: [-0.22, 0, 0] }]).spec;
    more = addBlock(more, [{ from: 'Torso', shift: [0, 0, -0.2] }]).spec;
    const solver = makeSolver(buildSkeleton(buildFigure(more)).bones);
    const { rig } = solver;
    expect(isRingRig(rig)).toBe(false);
    const bend = quatEuler(0.5, 0, 0);
    const swing = quatEuler(-0.8, 0, 0.2);
    const state = stateOf(solver, { ...emptyPosing(), bones: { Spine: bend, UpperLeg_L: swing } });
    const local = (name: string) => state.local[rig.index.get(name)!];
    for (const name of ['Spine.101', 'Spine.121']) expect(angle(local(name), local('Spine'))).toBeLessThan(1e-6);
    expect(angle(local('Spine'), [0, 0, 0, 1])).toBeGreaterThan(0.3);
    // 后面那块胯自己不转（跟着 Hips），它的腿和前面的腿摆成一样
    expect(angle(local('Hips.141'), [0, 0, 0, 1])).toBeLessThan(1e-6);
    expect(angle(local('UpperLeg_L.141'), local('UpperLeg_L'))).toBeLessThan(1e-6);
    // 单独记了的照记的
    const own = stateOf(solver, { ...emptyPosing(), bones: { Spine: bend, 'Spine.101': [0, 0, 0, 1] } });
    expect(angle(own.local[rig.index.get('Spine.101')!], [0, 0, 0, 1])).toBeLessThan(1e-6);
  });
});
