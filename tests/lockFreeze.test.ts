// 锁定、冻结（见 docs/lock-freeze-plan.md）：
// 锁定 = 不能挪、不能拖（场景里站的地方、道具的位置、摆姿势时的部位）；冻结 = 整个角色、整个道具什么都不能改。
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, add, quatConj, quatMul } from '../src/geometry/vec';
import { holdFrozen, setWholeFreeze } from '../src/model/freeze';
import { boneRegion, isTorsoBone, lockedRegions, setPoseLock } from '../src/model/poseLock';
import { canMoveProp, copyProp, makeProp, normalizeProps, removeProp, setPropFlag, updateProp } from '../src/model/props';
import { addFigure, canMoveFigure, isFrozen, normalizeScene, serializeScene, setCurrent, setFigureLock, singleScene, updateFigure } from '../src/model/scene';
import { type BodySpec, defaultSpec, normalizeSpec, serializeSpec } from '../src/model/spec';
import { guardPosing } from '../src/pose/guard';
import { buildHandles } from '../src/pose/handles';
import { quatAngle } from '../src/pose/math';
import { type Posing, emptyPosing } from '../src/pose/posing';
import { forward, restState } from '../src/pose/rig';
import { capturePins, dragAim, dragReach, turnSpine } from '../src/pose/solve';
import { type Solver, makeSolver, posingOf, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';

const twoFigures = () => {
  const s = singleScene(defaultSpec(), '');
  return addFigure(s, { name: '乙', spec: defaultSpec(), text: '', place: { x: 1, z: 0, yaw: 0 } });
};
const readScene = (text: string) => normalizeScene(JSON.parse(text), (raw) => ({ spec: normalizeSpec(raw), text: '' }))!;
/** 两个旋转差多少（弧度） */
const diff = (a: Quat, b: Quat) => quatAngle(quatMul(quatConj(a), b));

describe('场景里的角色：锁定站的地方，冻结记在它自己的设定里', () => {
  it('锁定的站的地方挪不了；冻结的也挪不了，但切得过去', () => {
    let s = twoFigures();
    s = setFigureLock(s, 'f1', true);
    expect(canMoveFigure(s.figures[0])).toBe(false);
    s = setFigureLock(s, 'f1', false);
    expect(s.figures[0].locked).toBeUndefined();
    s = updateFigure(s, 'f1', { spec: setWholeFreeze(s.figures[0].spec, true) });
    expect(isFrozen(s.figures[0])).toBe(true);
    expect(canMoveFigure(s.figures[0])).toBe(false);
    expect(setCurrent(s, 'f1').current).toBe('f1');
  });

  it('存档读回来照旧；全都冻结了也照旧（冻结的也切得过去，在那里解冻）', () => {
    let s = setFigureLock(twoFigures(), 'f1', true);
    for (const id of ['f1', 'f2']) s = updateFigure(s, id, { spec: setWholeFreeze(s.figures.find((f) => f.id === id)!.spec, true) });
    const back = readScene(serializeScene(s, (spec) => spec));
    expect(back.figures.map((f) => [f.locked, isFrozen(f)])).toEqual([
      [true, true],
      [undefined, true],
    ]);
    expect(back.current).toBe(s.current);
    expect(serializeScene(twoFigures(), (spec) => spec)).not.toMatch(/locked|frozen|wholeFreeze/);
  });

  it('以前的版本把冻结记在角色上（frozen: true）：读成它自己设定里的冻结', () => {
    const raw = JSON.parse(serializeScene(twoFigures(), (spec) => spec));
    raw.figures[1].frozen = true;
    const back = readScene(JSON.stringify(raw));
    expect(isFrozen(back.figures[1])).toBe(true);
    expect(back.figures[1]).not.toHaveProperty('frozen');
  });
});

describe('道具：锁定、冻结', () => {
  const box = makeProp([], 'box', { x: 0, z: 0, yaw: 0 });

  it('锁定的位置、旋转改不了，尺寸、颜色照样能改', () => {
    const list = setPropFlag([box], box.id, 'locked', true);
    expect(canMoveProp(list[0])).toBe(false);
    const next = updateProp(list, box.id, { pos: [1, 0, 1], rot: [0, 90, 0], size: [0.6, 0.6, 0.6], color: '#ff0000' });
    expect(next[0].pos).toEqual(box.pos);
    expect(next[0].rot).toEqual(box.rot);
    expect(next[0].size).toEqual([0.6, 0.6, 0.6]);
    expect(next[0].color).toBe('#ff0000');
  });

  it('冻结的哪一项都改不了、删不掉；复制出来的不带锁定、冻结；开关本身照样能关', () => {
    const list = setPropFlag([box], box.id, 'frozen', true);
    expect(updateProp(list, box.id, { color: '#00ff00', name: '台子' })).toBe(list);
    expect(removeProp(list, box.id)).toBe(list);
    const copied = copyProp(list, box.id, { x: 1, z: 0 });
    expect(copied.props[1].frozen).toBeUndefined();
    expect(setPropFlag(list, box.id, 'frozen', false)[0].frozen).toBeUndefined();
  });

  it('存档读回来照旧', () => {
    const list = setPropFlag(setPropFlag([box], box.id, 'locked', true), box.id, 'frozen', true);
    const back = normalizeProps(JSON.parse(JSON.stringify(list)));
    expect([back[0].locked, back[0].frozen]).toEqual([true, true]);
    expect(normalizeProps(JSON.parse(JSON.stringify([box])))[0]).not.toHaveProperty('locked');
  });
});

describe('整个角色冻结：设定整份照冻结时的', () => {
  it('改了哪一项都换回去；本来就一样的原样返回；解冻以后又能改', () => {
    const frozen = setWholeFreeze(setPoseLock(defaultSpec(), 'torso', true), true);
    expect(holdFrozen(frozen)).toBe(frozen);
    const changed = holdFrozen({ ...frozen, shape: { ...frozen.shape, bust: 2 }, counts: { ...frozen.counts, heads: 3 }, posing: { version: 3, bones: { Head: [0, 0.3, 0, 0.95] } }, hands: 'mitten', poseLock: undefined });
    expect(changed.shape).toBe(frozen.shape);
    expect(changed.counts).toBe(frozen.counts);
    expect(changed.posing).toBe(frozen.posing);
    expect(changed.hands).toBe(frozen.hands);
    expect(changed.poseLock).toEqual(['torso']);
    const thawed = setWholeFreeze(changed, false);
    expect(thawed.wholeFreeze).toBeUndefined();
    expect(holdFrozen({ ...thawed, shape: { ...thawed.shape, bust: 2 } }).shape.bust).toBe(2);
  });

  it('存档读回来照旧', () => {
    const frozen = setWholeFreeze({ ...defaultSpec(), shape: { ...defaultSpec().shape, bust: 1.5 } }, true);
    const back = normalizeSpec(JSON.parse(serializeSpec(frozen)));
    expect(back.wholeFreeze?.spec.shape.bust).toBe(1.5);
    expect(back.shape.bust).toBe(1.5);
    expect(serializeSpec(defaultSpec())).not.toMatch(/poseLock|wholeFreeze/);
  });
});

describe('按部位锁定：记法、读旧存档', () => {
  it('照「头、躯干、左手臂、右手臂、腿」的顺序记，一个都没锁就不写', () => {
    let spec = setPoseLock(defaultSpec(), 'legs', true);
    spec = setPoseLock(spec, 'head', true);
    expect(spec.poseLock).toEqual(['head', 'legs']);
    expect([...lockedRegions(spec)]).toEqual(['head', 'legs']);
    spec = setPoseLock(setPoseLock(spec, 'head', false), 'legs', false);
    expect(spec).not.toHaveProperty('poseLock');
    expect(normalizeSpec(JSON.parse(serializeSpec(setPoseLock(defaultSpec(), 'armR', true)))).poseLock).toEqual(['armR']);
  });

  it('11-28 那两版的躯干锁定、躯干冻结、四肢冻结：读成那几个部位锁定，体型不再定住', () => {
    const raw = JSON.parse(serializeSpec(defaultSpec()));
    expect(normalizeSpec({ ...raw, torsoLock: true }).poseLock).toEqual(['torso']);
    const old = normalizeSpec({ ...raw, torsoFreeze: { bones: {}, shape: { bust: 2 } }, limbFreeze: { bones: {}, shape: { armLength: 2 } } });
    expect(old.poseLock).toEqual(['torso', 'armL', 'armR', 'legs']);
    expect(old.shape.bust).toBe(1);
    expect(old).not.toHaveProperty('torsoFreeze');
    expect(old).not.toHaveProperty('limbFreeze');
    expect(normalizeSpec({ ...raw, poseLock: ['legs', 'nonsense', 'head'] }).poseLock).toEqual(['head', 'legs']);
  });

  it('骨骼归哪个部位：好几对手臂、好几个上半身的也认得；ToeBase 算腿；尾巴不归哪个', () => {
    expect(['Hips', 'Spine_L', 'Chest.002'].every(isTorsoBone)).toBe(true);
    expect(['Neck', 'Head.002'].map(boneRegion)).toEqual(['head', 'head']);
    expect(['Shoulder_L', 'UpperArm_L.002', 'Index2_L'].map(boneRegion)).toEqual(['armL', 'armL', 'armL']);
    expect(['Hand_R', 'Foot_R', 'ToeBase_L', 'LegThumb1_R'].map(boneRegion)).toEqual(['armR', 'legs', 'legs', 'legs']);
    expect(boneRegion('Tail_1_01')).toBeNull();
  });
});

const solverFor = (spec: BodySpec = defaultSpec(), extra: Partial<Solver> = {}): Solver =>
  Object.assign(makeSolver(buildSkeleton(buildFigure(spec)).bones), { lockTorso: lockedRegions(spec).has('torso'), locked: lockedRegions(spec), ...extra });
/** 哪几根骨骼在这个部位里、相对父骨骼转过 */
const regionTurns = (s: Solver, local: readonly Quat[], region: string) =>
  s.rig.names.flatMap((name, i) => (boneRegion(name) === region && quatAngle(local[i]) > 1e-9 ? [name] : []));

describe('摆姿势：锁定的部位拖不动、拖别处时跟着身子走', () => {
  it('躯干锁了：手够不着、脚钉着，脊柱不帮着够、胯不跟过去', () => {
    for (const lock of [false, true]) {
      const s = solverFor(lock ? setPoseLock(defaultSpec(), 'torso', true) : defaultSpec());
      const rest = restState(s.rig);
      const f0 = forward(s.rig, rest);
      const hand = s.limbs.findIndex((l) => l.name === 'Hand_L');
      const pins = capturePins(s, f0, new Set(s.limbs.filter((l) => l.kind === 'leg').map((l) => l.name)));
      const state = dragReach(s, rest, hand, add(f0.pos[s.limbs[hand].upper], [0.9, 0.2, 0.5]), pins);
      if (lock) {
        expect(regionTurns(s, state.local, 'torso')).toEqual([]);
        expect(state.root).toEqual([0, 0, 0]);
      } else expect(regionTurns(s, state.local, 'torso').length).toBeGreaterThan(0);
    }
  });

  it('锁了的部位圆点不给；别的照给', () => {
    const s = solverFor(setPoseLock(setPoseLock(defaultSpec(), 'armL', true), 'legs', true));
    const regions = new Set(buildHandles(s).map((h) => boneRegion(s.rig.names[h.anchor])));
    expect(regions.has('armL') || regions.has('legs')).toBe(false);
    expect(regions.has('armR') && regions.has('torso') && regions.has('head')).toBe(true);
  });

  it('左手臂锁了：转腰时它相对身子不动（跟着胸口转），右手臂照常', () => {
    const s = solverFor(setPoseLock(defaultSpec(), 'armL', true));
    const waist = buildHandles(s).find((h) => h.group === 'torso' && h.kind === 'aim' && h.twist.length > 1)!;
    const state = turnSpine(s, restState(s.rig), waist.turn, waist.twist, [0, 0.38, 0, 0.92], []);
    expect(regionTurns(s, state.local, 'armL')).toEqual([]);
    expect(regionTurns(s, state.local, 'torso').length).toBeGreaterThan(0);
  });

  it('腿锁了：「脚留在原地」不钉腿', () => {
    const s = solverFor(setPoseLock(defaultSpec(), 'legs', true));
    const pins = capturePins(s, forward(s.rig, restState(s.rig)), new Set(s.limbs.map((l) => l.name)));
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.every((p) => s.limbs[p.limb].kind !== 'leg')).toBe(true);
  });

  it('就算给了带锁定骨骼的连接，求解器也不转它', () => {
    const s = solverFor(setPoseLock(defaultSpec(), 'torso', true));
    const shoulder = buildHandles(s).find((h) => h.label.includes('肩') && h.kind === 'aim')!;
    const rest = restState(s.rig);
    const spine = s.rig.index.get('Spine')!;
    const state = dragAim(s, rest, [{ bone: spine, weight: 1 }], { bone: shoulder.anchor, rest: shoulder.rest }, add(forward(s.rig, rest).pos[shoulder.anchor], [0.3, 0, 0.3]), []);
    expect(quatAngle(state.local[spine])).toBe(0);
  });

  it('整个角色冻结：一个圆点都不给，拖了也不动', () => {
    const s = solverFor(defaultSpec(), { lockAll: true });
    expect(buildHandles(s)).toEqual([]);
    const rest = restState(s.rig);
    const hand = s.limbs.findIndex((l) => l.name === 'Hand_L');
    expect(dragReach(s, rest, hand, [1, 1, 1], [])).toEqual(rest);
  });
});

describe('锁定的部位：套姿势、还原这些都不改它（guardPosing）', () => {
  const s = solverFor();
  const posed = (bones: Record<string, Quat>, root?: [number, number, number]): Posing => posingOf(s, stateOf(s, { version: 1, bones, ...(root ? { root } : {}) }));

  it('套了别的姿势：锁了的左手臂相对身子照原来的，别的照新的；躯干锁了整个人的位置也不挪', () => {
    const prev = posed({ UpperArm_L: [0, 0, 0.4, 0.92] });
    const next = posed({ Spine: [0.2, 0, 0, 0.98], UpperArm_L: [0, 0, -0.4, 0.92], UpperArm_R: [0, 0, 0.3, 0.95] }, [0, -0.2, 0]);
    const kept = guardPosing(s, prev, next, new Set(['torso', 'armL'] as const))!;
    expect(kept.touched).toEqual(['torso', 'armL']);
    const a = stateOf(s, prev);
    const b = stateOf(s, kept.posing);
    for (const name of ['UpperArm_L', 'LowerArm_L', 'Spine']) {
      const j = s.rig.index.get(name)!;
      expect(diff(a.local[j], b.local[j])).toBeLessThan(2e-3);
    }
    const right = s.rig.index.get('UpperArm_R')!;
    expect(diff(stateOf(s, next).local[right], b.local[right])).toBeLessThan(2e-3);
    expect(b.root.map((v) => Math.abs(v) < 1e-6)).toEqual([true, true, true]);
  });

  it('还原姿势（空姿势）：锁了的照留；没改到锁了的部位时返回 null', () => {
    const prev = posed({ UpperLeg_L: [0.3, 0, 0, 0.95] });
    const kept = guardPosing(s, prev, emptyPosing(), new Set(['legs'] as const))!;
    expect(kept.touched).toEqual(['legs']);
    const j = s.rig.index.get('UpperLeg_L')!;
    expect(quatAngle(stateOf(s, kept.posing).local[j])).toBeGreaterThan(0.5);
    expect(guardPosing(s, prev, posed({ UpperLeg_L: [0.3, 0, 0, 0.95], Head: [0, 0.3, 0, 0.95] }), new Set(['legs'] as const))).toBeNull();
  });
});
