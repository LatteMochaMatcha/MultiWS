// 锁定、冻结：场景里的角色、道具（站的地方、哪一项能改），躯干（摆姿势时不动、冻结时照冻结时的写回去）。
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { add } from '../src/geometry/vec';
import { canMoveProp, copyProp, makeProp, normalizeProps, removeProp, setPropFlag, updateProp } from '../src/model/props';
import { canMoveFigure, normalizeScene, serializeScene, setCurrent, setFigureFlag, singleScene, addFigure, restoreFigure } from '../src/model/scene';
import { defaultSpec, normalizeSpec, serializeSpec } from '../src/model/spec';
import { captureTorso, holdTorso, isTorsoBone, setTorsoHold, torsoLocked } from '../src/model/torsoHold';
import { buildHandles } from '../src/pose/handles';
import { quatAngle } from '../src/pose/math';
import { emptyPosing } from '../src/pose/posing';
import { forward, restState } from '../src/pose/rig';
import { capturePins, dragAim, dragReach } from '../src/pose/solve';
import { type Solver, makeSolver } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';

const twoFigures = () => {
  const s = singleScene(defaultSpec(), '');
  return addFigure(s, { name: '乙', spec: defaultSpec(), text: '', place: { x: 1, z: 0, yaw: 0 } });
};

describe('场景里的角色：锁定、冻结', () => {
  it('锁定、冻结的站的地方挪不了；冻结的切不过去', () => {
    let s = twoFigures();
    expect(s.current).toBe('f2');
    s = setFigureFlag(s, 'f1', 'locked', true);
    expect(canMoveFigure(s.figures[0])).toBe(false);
    s = setFigureFlag(s, 'f1', 'frozen', true);
    expect(setCurrent(s, 'f1').current).toBe('f2');
    s = setFigureFlag(s, 'f1', 'frozen', false);
    expect(s.figures[0].frozen).toBeUndefined();
    expect(setCurrent(s, 'f1').current).toBe('f1');
  });

  it('冻结当前角色：换成别的没冻结的；只剩它能改时不冻结', () => {
    let s = twoFigures();
    s = setFigureFlag(s, 'f2', 'frozen', true);
    expect(s.current).toBe('f1');
    expect(setFigureFlag(s, 'f1', 'frozen', true)).toBe(s);
    expect(setFigureFlag(singleScene(defaultSpec(), ''), 'f1', 'frozen', true).figures[0].frozen).toBeUndefined();
  });

  it('冻结的放回去不当当前角色', () => {
    let s = twoFigures();
    s = setFigureFlag(s, 'f1', 'frozen', true);
    const gone = s.figures[0];
    const without = { ...s, figures: [s.figures[1]] };
    expect(restoreFigure(without, gone, 0).current).toBe('f2');
  });

  it('存档读回来照旧；没锁的不写这两项；全都冻结了的第一个解冻', () => {
    let s = setFigureFlag(twoFigures(), 'f1', 'locked', true);
    s = setFigureFlag(s, 'f2', 'frozen', true);
    const text = serializeScene(s, (spec) => spec);
    const back = normalizeScene(JSON.parse(text), (raw) => ({ spec: normalizeSpec(raw), text: '' }))!;
    expect(back.figures.map((f) => [f.locked, f.frozen])).toEqual([
      [true, undefined],
      [undefined, true],
    ]);
    expect(back.current).toBe('f1');
    expect(serializeScene(twoFigures(), (spec) => spec)).not.toMatch(/locked|frozen/);
    const all = JSON.parse(text);
    for (const f of all.figures) f.frozen = true;
    const fixed = normalizeScene(all, (raw) => ({ spec: normalizeSpec(raw), text: '' }))!;
    expect(fixed.figures[0].frozen).toBeUndefined();
    expect(fixed.current).toBe('f1');
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

describe('躯干：冻结时照冻结时的写回去', () => {
  const posed = () => {
    const spec = defaultSpec();
    return {
      ...spec,
      posing: { version: 3 as const, bones: { Hips: [0, 0.2, 0, 0.98] as [number, number, number, number], Spine: [0.1, 0, 0, 0.995] as [number, number, number, number], UpperArm_L: [0, 0, 0.3, 0.95] as [number, number, number, number] }, root: [0, -0.1, 0] as [number, number, number] },
    };
  };

  it('冻结以后套别的姿势、拖体型滑块：躯干的骨骼、整个人的位置、躯干体型、数量照冻结时的，别的照新的', () => {
    const frozen = setTorsoHold(posed(), 'freeze', true);
    expect(torsoLocked(frozen)).toBe(true);
    const changed = holdTorso({
      ...frozen,
      posing: { version: 3, bones: { Chest: [0, 0, 0.2, 0.98], UpperArm_L: [0, 0, -0.3, 0.95] } },
      shape: { ...frozen.shape, bust: 2, waist: 1.4, height: 1.8 },
      counts: { ...frozen.counts, torsos: 2, breasts: 4, heads: 2 },
      chestRow: 3,
    });
    expect(changed.posing.bones.Hips).toEqual([0, 0.2, 0, 0.98]);
    expect(changed.posing.bones.Spine).toEqual([0.1, 0, 0, 0.995]);
    // 冻结时没转的躯干骨骼：去掉（没写和「没转」是一回事）
    expect(changed.posing.bones.Chest).toBeUndefined();
    expect(changed.posing.bones.UpperArm_L).toEqual([0, 0, -0.3, 0.95]);
    expect(changed.posing.root).toEqual([0, -0.1, 0]);
    expect([changed.shape.bust, changed.shape.waist, changed.shape.height]).toEqual([1, 1, 1.8]);
    expect([changed.counts.torsos, changed.counts.breasts, changed.counts.heads]).toEqual([1, 2, 2]);
    expect(changed.chestRow).toBe(frozen.chestRow);
  });

  it('本来就一样的原样返回；没冻结的不动', () => {
    const frozen = setTorsoHold(posed(), 'freeze', true);
    expect(holdTorso(frozen)).toBe(frozen);
    const plain = { ...posed(), posing: emptyPosing() };
    expect(holdTorso(plain)).toBe(plain);
  });

  it('解冻后锁定照旧（单独勾过的话）；存档读回来照旧，没设的不写', () => {
    const both = setTorsoHold(setTorsoHold(posed(), 'lock', true), 'freeze', true);
    const back = normalizeSpec(JSON.parse(serializeSpec(both)));
    expect(back.torsoLock).toBe(true);
    expect(back.torsoFreeze).toEqual(captureTorso(posed()));
    const thawed = setTorsoHold(both, 'freeze', false);
    expect([thawed.torsoLock, thawed.torsoFreeze]).toEqual([true, undefined]);
    expect(serializeSpec(defaultSpec())).not.toMatch(/torsoLock|torsoFreeze/);
  });

  it('读存档时冻结的体型照范围收，照它写回去', () => {
    const raw = JSON.parse(serializeSpec(defaultSpec()));
    raw.torsoFreeze = { bones: {}, shape: { bust: 99 }, counts: { torsos: 9 }, chestRow: 9 };
    const back = normalizeSpec(raw);
    expect(back.shape.bust).toBe(3.4);
    expect(back.counts.torsos).toBe(3);
    expect(back.chestRow).toBe(4);
  });

  it('躯干骨骼认得出来：胯、脊柱、胸，好几个上半身的、复制出来的也算；锁骨、脖子不算', () => {
    expect(['Hips', 'Spine', 'Chest_L', 'UpperChest.002', 'Spine.101'].every(isTorsoBone)).toBe(true);
    expect(['Shoulder_L', 'Neck', 'Head', 'UpperArm_R'].some(isTorsoBone)).toBe(false);
  });
});

describe('躯干：锁定时摆姿势不动', () => {
  const solverOf = (lock: boolean): Solver => {
    const s = makeSolver(buildSkeleton(buildFigure(defaultSpec())).bones);
    s.lockTorso = lock;
    return s;
  };
  const torsoTurns = (s: Solver, local: readonly [number, number, number, number][]) =>
    s.rig.names.flatMap((name, i) => (isTorsoBone(name) && quatAngle(local[i]) > 1e-9 ? [name] : []));

  it('手够不着、脚钉着：没锁时脊柱帮着够、胯跟过去；锁了以后躯干一点不动', () => {
    for (const lock of [false, true]) {
      const s = solverOf(lock);
      const rest = restState(s.rig);
      const f0 = forward(s.rig, rest);
      const hand = s.limbs.findIndex((l) => l.name === 'Hand_L');
      const pins = capturePins(s, f0, new Set(s.limbs.filter((l) => l.kind === 'leg').map((l) => l.name)));
      const target = add(f0.pos[s.limbs[hand].upper], [0.9, 0.2, 0.5]);
      const state = dragReach(s, rest, hand, target, pins);
      if (lock) {
        expect(torsoTurns(s, state.local)).toEqual([]);
        expect(state.root).toEqual([0, 0, 0]);
      } else expect(torsoTurns(s, state.local).length).toBeGreaterThan(0);
    }
  });

  it('锁了以后：胯、腰、胸的圆点不给；拖肩膀只有锁骨转', () => {
    const s = solverOf(true);
    const handles = buildHandles(s);
    expect(handles.some((h) => h.group === 'torso')).toBe(false);
    const shoulder = handles.find((h) => h.label.includes('肩') && h.kind === 'aim')!;
    expect(shoulder.links.every((l) => !isTorsoBone(s.rig.names[l.bone]))).toBe(true);
    // 就算给了带脊柱的连接，求解器也不转脊柱
    const rest = restState(s.rig);
    const spine = s.rig.index.get('Spine')!;
    const state = dragAim(s, rest, [{ bone: spine, weight: 1 }], { bone: shoulder.anchor, rest: shoulder.rest }, add(forward(s.rig, rest).pos[shoulder.anchor], [0.3, 0, 0.3]), []);
    expect(quatAngle(state.local[spine])).toBe(0);
  });
});
