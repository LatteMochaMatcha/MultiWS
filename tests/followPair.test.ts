// 摆姿势时「几对手臂一起动」（pose/follow.ts）：别的几对手臂一直照领头的那一对（最后拖过的那一对）摆
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, quatConj, quatMul } from '../src/geometry/vec';
import { type BodyCounts, type BodySpec, defaultSpec } from '../src/model/spec';
import { armOfBone, armPairCount, followPair } from '../src/pose/follow';
import { quatAngle } from '../src/pose/math';
import { type PoseState, forward, restState } from '../src/pose/rig';
import { type Solver, makeSolver, posingOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { useAnimeBody } from './animeBody';

const make = (counts: Partial<BodyCounts> = {}, rest: Partial<BodySpec> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, bodyStyle: 'anime', ...rest, counts: { ...base.counts, ...counts } };
};
function solverOf(spec: BodySpec): Solver {
  useAnimeBody();
  return makeSolver(buildSkeleton(buildFigure(spec)).bones);
}
/** 绕轴转 angle（弧度） */
const turn = (axis: [number, number, number], angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
/** 把第 pair 对左手臂（side -1 是右手臂）的上臂、前臂各转一下 */
function bend(solver: Solver, state: PoseState, pair: number, side: 1 | -1 = 1): PoseState {
  const out = { local: state.local.slice(), root: state.root };
  const limb = solver.limbs.find((l) => l.kind === 'arm' && l.side === side && l.pair === pair)!;
  out.local[limb.upper] = turn([0, 0, 1], 1.1);
  out.local[limb.lower] = turn([0, 1, 0], -0.9);
  return out;
}
const arm = (solver: Solver, side: 1 | -1, pair: number) => solver.limbs.find((l) => l.kind === 'arm' && l.side === side && l.pair === pair)!;

describe('多出的手臂跟着其中一对', () => {
  it('沿躯干上下排的两对：第二对相对自己静止时转得和第一对一样多（还是错开着）', () => {
    const solver = solverOf(make({ armPairs: 2 }, { armLayout: 'stack' }));
    expect(armPairCount(solver)).toBe(2);
    const state = followPair(solver, bend(solver, restState(solver.rig), 0), 0);
    const frame = forward(solver.rig, state);
    for (const j of ['upper', 'lower'] as const) {
      const a = frame.rot[arm(solver, 1, 0)[j]];
      const b = frame.rot[arm(solver, 1, 1)[j]];
      expect(quatAngle(quatMul(a, quatConj(b)))).toBeLessThan(1e-6);
    }
    // 右边没动的，跟的也没动
    expect(quatAngle(frame.rot[arm(solver, -1, 1).upper])).toBeLessThan(1e-6);
  });

  it('跟着第二对：第一对照第二对摆', () => {
    const solver = solverOf(make({ armPairs: 3 }, { armLayout: 'stack' }));
    const state = followPair(solver, bend(solver, restState(solver.rig), 1), 1);
    const frame = forward(solver.rig, state);
    for (const pair of [0, 2]) expect(quatAngle(quatMul(frame.rot[arm(solver, 1, 1).lower], quatConj(frame.rot[arm(solver, 1, pair).lower])))).toBeLessThan(1e-6);
  });

  it('两个上半身：另一个上半身上的那条照搬姿势数据里记的朝向', () => {
    const solver = solverOf(make({ torsos: 2, armPairs: 1 }));
    expect(armPairCount(solver)).toBe(2);
    const state = followPair(solver, bend(solver, restState(solver.rig), 0), 0);
    const posing = posingOf(solver, state);
    for (const base of ['UpperArm_L', 'LowerArm_L']) {
      const told = posing.bones[base];
      const copied = posing.bones[`${base}.002`];
      expect(told).toBeDefined();
      // 姿势数据留 5 位小数：逐个分量比（转角接近 0 时 acos 会把取整放大）
      for (let k = 0; k < 4; k++) expect(copied[k]).toBeCloseTo(told[k], 4);
    }
  });

  it('只有一对手臂、或者没有选中的那一对：原样返回', () => {
    const one = solverOf(make({ armPairs: 1 }));
    const state = bend(one, restState(one.rig), 0);
    expect(followPair(one, state, 0)).toBe(state);
    const two = solverOf(make({ armPairs: 2 }, { armLayout: 'stack' }));
    const s2 = bend(two, restState(two.rig), 0);
    expect(followPair(two, s2, 3)).toBe(s2);
  });

  it('左右各自领头：左边跟第二对、右边跟第三对', () => {
    const solver = solverOf(make({ armPairs: 3 }, { armLayout: 'stack' }));
    const bent = bend(solver, bend(solver, restState(solver.rig), 1, 1), 2, -1);
    const frame = forward(solver.rig, followPair(solver, bent, { left: 1, right: 2 }));
    const same = (a: number, b: number) => quatAngle(quatMul(frame.rot[a], quatConj(frame.rot[b])));
    for (const pair of [0, 2]) expect(same(arm(solver, 1, 1).lower, arm(solver, 1, pair).lower)).toBeLessThan(1e-6);
    for (const pair of [0, 1]) expect(same(arm(solver, -1, 2).lower, arm(solver, -1, pair).lower)).toBeLessThan(1e-6);
    // 右边领头的那对真的转了，不是都没动
    expect(quatAngle(frame.rot[arm(solver, -1, 0).lower])).toBeGreaterThan(0.5);
  });

  it('认得一根骨骼是哪一对、哪一边手臂上的', () => {
    const solver = solverOf(make({ armPairs: 2 }, { armLayout: 'stack' }));
    expect(armOfBone(solver, arm(solver, 1, 1).lower)).toEqual({ pair: 1, side: 1 });
    expect(armOfBone(solver, arm(solver, -1, 0).upper)).toEqual({ pair: 0, side: -1 });
    const leg = solver.limbs.find((l) => l.kind === 'leg')!;
    expect(armOfBone(solver, leg.upper)).toBeNull();
  });
});
