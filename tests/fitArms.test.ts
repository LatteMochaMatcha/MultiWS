// 现成的姿势套到不止一对手臂的身体上：每一侧挑方向最接近的那一条去摆（src/pose/fit.ts）
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type BodyCounts, type BodySpec, defaultSpec } from '../src/model/spec';
import { fitArms } from '../src/pose/fit';
import { POSE_LIBRARY } from '../src/pose/library';
import type { Posing } from '../src/pose/posing';
import { forward } from '../src/pose/rig';
import { makeSolver, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { useAnimeBody } from './animeBody';

const make = (counts: Partial<BodyCounts> = {}, rest: Partial<BodySpec> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, ...rest, counts: { ...base.counts, ...counts } };
};
const solverOf = (spec: BodySpec) => makeSolver(buildSkeleton({ parts: buildFigure(spec).parts, scale: 1 }).bones);
const preset = (name: string): Posing => {
  const found = POSE_LIBRARY.find((one) => one.name === name);
  if (!found) throw new Error(`没有叫「${name}」的姿势`);
  return found.posing;
};
type Arm = ReturnType<typeof makeSolver>['limbs'][number];
/**
 * 套上这个姿势以后，同一侧的手臂之间最近有多远（各在手肘、前臂中间、手腕取点；上臂挤在一个肩膀上，本来就挨着）。
 * only：只看这一条和别的几条之间
 */
const armGap = (solver: ReturnType<typeof makeSolver>, posing: Posing, only?: (arm: Arm) => boolean): number => {
  const frame = forward(solver.rig, stateOf(solver, posing));
  const mid = (a: readonly number[], b: readonly number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const along = (arm: Arm) => [frame.pos[arm.lower], mid(frame.pos[arm.lower], frame.pos[arm.end]), frame.pos[arm.end]];
  let least = Infinity;
  const arms = solver.limbs.filter((limb) => limb.kind === 'arm');
  for (const a of arms) {
    for (const b of arms) {
      if (a.side !== b.side || a.pair >= b.pair) continue;
      if (only && !only(a) && !only(b)) continue;
      for (const p of along(a)) for (const q of along(b)) least = Math.min(least, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
    }
  }
  return least;
};

describe('现成的姿势套到不止一对手臂的身体上', () => {
  it('只有一对手臂：原样', () => {
    const solver = solverOf(make());
    const posing = preset('站着');
    expect(fitArms(solver, posing)).toBe(posing);
  });

  it('沿躯干上下排的几对各有各的肩膀：原样，只摆最上面那一对', () => {
    const solver = solverOf(make({ armPairs: 3 }, { armLayout: 'stack' }));
    for (const name of ['站着', '坐着', '走', '朝天举枪']) {
      const posing = preset(name);
      expect(fitArms(solver, posing), name).toBe(posing);
    }
  });

  it('肩部聚拢：有一条正好摆成这个姿势；姿势和静止时差不多的，别的几条跟着转同样多，差得多的只摆那一条', () => {
    useAnimeBody();
    for (const spec of [make({ armPairs: 4 }, { armLayout: 'fan' }), make({ armPairs: 4 }, { armLayout: 'fan', bodyStyle: 'anime' }), make({ armPairs: 2 }, { armLayout: 'fan', bodyStyle: 'anime' })]) {
      const solver = solverOf(spec);
      const { rig, limbs } = solver;
      const label = `${spec.bodyStyle} ${spec.counts.armPairs}`;
      for (const name of ['站着', '坐着', '打电话', '抱着胳膊', '朝天举枪']) {
        const posing = preset(name);
        const fitted = fitArms(solver, posing);
        const plain = forward(rig, stateOf(solver, posing));
        const frame = forward(rig, stateOf(solver, fitted));
        for (const side of [1, -1] as const) {
          const tag = side > 0 ? 'L' : 'R';
          const mine = limbs.filter((limb) => limb.kind === 'arm' && limb.side === side);
          const first = mine.find((limb) => limb.pair === 0)!;
          // 有一条和「只摆第一对」时第一对摆出来的方向一模一样（上臂、前臂都是）
          const dirOf = (f: typeof frame, from: number, to: number) => {
            const d = [f.pos[to][0] - f.pos[from][0], f.pos[to][1] - f.pos[from][1], f.pos[to][2] - f.pos[from][2]];
            const l = Math.hypot(d[0], d[1], d[2]);
            return d.map((v) => v / l);
          };
          const want = [dirOf(plain, first.upper, first.lower), dirOf(plain, first.lower, first.end)];
          const exact = mine.filter((limb) => {
            const got = [dirOf(frame, limb.upper, limb.lower), dirOf(frame, limb.lower, limb.end)];
            return got.every((d, i) => d[0] * want[i][0] + d[1] * want[i][1] + d[2] * want[i][2] > 1 - 1e-9);
          });
          expect(exact.length, `${label} ${name}`).toBe(1);
          // 姿势数据里这一侧记了几条手臂：全部（一起摆），或者只有一条
          const told = mine.filter((limb) => fitted.bones[rig.names[limb.upper]]);
          expect(told.length === mine.length || told.length === 1, `${label} ${name} ${tag}`).toBe(true);
          const turns = mine.map((limb) => frame.rot[limb.upper]);
          const alike = (a: readonly number[], b: readonly number[]) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
          if (told.length === mine.length) {
            // 一起摆：每条手臂的上臂、前臂相对自己静止时转了多少，几条都一样
            for (const key of ['upper', 'lower'] as const) for (const limb of mine) expect(alike(frame.rot[limb[key]], frame.rot[mine[0][key]]), `${label} ${name} ${key}`).toBeCloseTo(1, 9);
          } else {
            // 只摆一条：就是正好摆成这个姿势的那一条；别的跟着胸口，相对它没转
            expect(told[0], `${label} ${name}`).toBe(exact[0]);
            const chest = frame.rot[rig.parent[rig.index.get(`Shoulder_${tag}`) ?? first.upper]];
            mine.forEach((limb, i) => {
              if (limb !== told[0]) expect(alike(turns[i], chest), `${label} ${name} #${limb.pair}`).toBeCloseTo(1, 9);
            });
          }
          // 垂着站着：一起摆；抱着胳膊：只摆一条
          if (name === '站着') expect(told.length, `${label} ${name}`).toBe(mine.length);
          if (name === '抱着胳膊') expect(told.length, `${label} ${name}`).toBe(1);
        }
        // 别的骨骼（脊柱、腿、头）一根没动
        for (const [bone, turn] of Object.entries(posing.bones)) {
          if (/^(Shoulder|UpperArm|LowerArm|Hand|Thumb|Index|Middle|Ring|Little)/.test(bone)) continue;
          expect(fitted.bones[bone], bone).toBe(turn);
        }
      }
    }
  });

  it('每个现成的姿势套到肩部聚拢的四对手臂上：手臂叠在一起的比照原样套（只摆第一对）少得多', () => {
    useAnimeBody();
    const solver = solverOf(make({ armPairs: 4 }, { armLayout: 'fan', bodyStyle: 'anime' }));
    // 什么都不摆的时候，挨着的两条手臂之间本来就这么近；离得不到它的六成算叠在一起
    const apart = armGap(solver, { version: 3, bones: {} });
    let before = 0;
    let after = 0;
    for (const { name, posing } of POSE_LIBRARY) {
      const now = armGap(solver, fitArms(solver, posing));
      expect(Number.isFinite(now), name).toBe(true);
      if (armGap(solver, posing) < apart * 0.6) before++;
      if (now < apart * 0.6) after++;
    }
    expect(before).toBeGreaterThanOrEqual(4);
    expect(after).toBeLessThanOrEqual(before / 2);
  });
});
