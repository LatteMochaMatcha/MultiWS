// 套现成的姿势：多出来的手臂跟着原来的那条动（pose/fit.ts 的 followArms），手臂让开身体（pose/clear.ts），
// 以及工坊自己摆的几个柔和的站姿（tools/build-soft-poses.ts → src/pose/softPoses.json）
import { describe, expect, it } from 'vitest';
import type { Figure } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, quatConj, quatMul } from '../src/geometry/vec';
import { type BodyCounts, type BodySpec, defaultSpec } from '../src/model/spec';
import { clearArms } from '../src/pose/clear';
import { fitArms, followArms } from '../src/pose/fit';
import { POSE_LIBRARY } from '../src/pose/library';
import { quatAngle } from '../src/pose/math';
import type { Posing } from '../src/pose/posing';
import { type Frame, forward } from '../src/pose/rig';
import { type Solver, makeSolver, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { compileField, fieldAt } from '../src/sdf/field';
import { useAnimeBody } from './animeBody';

const make = (counts: Partial<BodyCounts> = {}, rest: Partial<BodySpec> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, bodyStyle: 'anime', ...rest, counts: { ...base.counts, ...counts } };
};
const preset = (name: string): Posing => {
  const found = POSE_LIBRARY.find((one) => one.name === name);
  if (!found) throw new Error(`没有叫「${name}」的姿势`);
  return found.posing;
};
/** 骨架、量身体的距离场（不含手臂，和工坊里一样） */
function kitOf(spec: BodySpec): { figure: Figure; solver: Solver; body: (x: number, y: number, z: number) => number } {
  useAnimeBody();
  const figure = buildFigure(spec);
  const solver = makeSolver(buildSkeleton(figure).bones);
  const kept = new Set<string>();
  const parts = figure.parts.filter((p) => {
    const keep = ['torso', 'lower', 'leg', 'neck', 'head', 'chest'].includes(p.type) && (!p.parent || kept.has(p.parent));
    if (keep) kept.add(p.name);
    return keep;
  });
  const field = compileField({ scale: figure.scale, parts }, { blend: spec.blend });
  return { figure, solver, body: (x, y, z) => fieldAt(field, x, y, z) };
}
/** 两个上半身时脊柱那一串每个上半身都照着摆（和工坊里 fittedTorsos 一样） */
function torsos(posing: Posing): Posing {
  const bones = { ...posing.bones };
  for (const [name, turn] of Object.entries(posing.bones)) {
    const m = /^(Spine|Chest|UpperChest)(\.\d+)?$/.exec(name);
    if (m) for (const side of ['_L', '_R']) bones[`${m[1]}${side}${m[2] ?? ''}`] = turn;
  }
  return { ...posing, bones };
}
/** 手臂（上臂靠下的一半、手肘到手腕、手掌）插进身体最深多深：照最近的那根身上的骨骼换算回静止姿势里量 */
function deepest(kit: ReturnType<typeof kitOf>, posing: Posing, arms: number[]): number {
  const { solver, body } = kit;
  const { rig } = solver;
  const frame: Frame = forward(rig, stateOf(solver, posing));
  const bones = rig.names.map((n, j) => (/^(Hips|Spine|Chest|UpperChest|Neck|Head|UpperLeg|LowerLeg)/.test(n) ? j : -1)).filter((j) => j >= 0);
  const tail = (b: number) => {
    const d = rotateBy(frame.rot[b], [rig.tail[b][0] - rig.head[b][0], rig.tail[b][1] - rig.head[b][1], rig.tail[b][2] - rig.head[b][2]]);
    return [frame.pos[b][0] + d[0], frame.pos[b][1] + d[1], frame.pos[b][2] + d[2]];
  };
  const gapTo = (p: number[], a: number[], b: number[]) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2));
    return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t);
  };
  let worst = -Infinity;
  for (const i of arms) {
    const limb = solver.limbs[i];
    const e = frame.pos[limb.lower];
    const w = frame.pos[limb.end];
    const h = tail(limb.end);
    const s0 = frame.pos[limb.upper];
    const points = [0.5, 0.75].map((t) => [s0[0] + (e[0] - s0[0]) * t, s0[1] + (e[1] - s0[1]) * t, s0[2] + (e[2] - s0[2]) * t]);
    for (const t of [0.25, 0.5, 0.75, 1]) points.push([e[0] + (w[0] - e[0]) * t, e[1] + (w[1] - e[1]) * t, e[2] + (w[2] - e[2]) * t]);
    points.push(h);
    for (const p of points) {
      let best = bones[0];
      let gap = Infinity;
      for (const b of bones) {
        const d = gapTo(p, frame.pos[b], tail(b));
        if (d < gap) [gap, best] = [d, b];
      }
      const q = rotateBy(quatConj(frame.rot[best]), [p[0] - frame.pos[best][0], p[1] - frame.pos[best][1], p[2] - frame.pos[best][2]]);
      worst = Math.max(worst, -body(rig.head[best][0] + q[0], rig.head[best][1] + q[1], rig.head[best][2] + q[2]));
    }
  }
  return worst;
}
/** 手腕外面（顺着前臂）2 cm 那一点离身体多远：照最近的那根身上的骨骼换算回静止姿势里量 */
function stubGap(kit: ReturnType<typeof kitOf>, posing: Posing, i: number): number {
  const { solver, body } = kit;
  const { rig } = solver;
  const frame = forward(rig, stateOf(solver, posing));
  const limb = solver.limbs[i];
  const e = frame.pos[limb.lower];
  const w = frame.pos[limb.end];
  const l = Math.hypot(w[0] - e[0], w[1] - e[1], w[2] - e[2]);
  const p = [0, 1, 2].map((k) => w[k] + ((w[k] - e[k]) / l) * 0.02 * kit.figure.scale);
  let best = -1;
  let gap = Infinity;
  rig.names.forEach((n, b) => {
    if (!/^(Hips|Spine|Chest|UpperChest|Neck|Head|UpperLeg|LowerLeg)/.test(n)) return;
    const a = frame.pos[b];
    const ab = rotateBy(frame.rot[b], [rig.tail[b][0] - rig.head[b][0], rig.tail[b][1] - rig.head[b][1], rig.tail[b][2] - rig.head[b][2]]);
    const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2));
    const d = Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t);
    if (d < gap) [gap, best] = [d, b];
  });
  const q = rotateBy(quatConj(frame.rot[best]), [p[0] - frame.pos[best][0], p[1] - frame.pos[best][1], p[2] - frame.pos[best][2]]);
  return body(rig.head[best][0] + q[0], rig.head[best][1] + q[1], rig.head[best][2] + q[2]);
}
function rotateBy(q: Quat, v: number[]): number[] {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
const armsOf = (solver: Solver, pair?: number) =>
  solver.limbs.map((limb, i) => ({ limb, i })).filter(({ limb }) => limb.kind === 'arm' && (pair === undefined || limb.pair === pair)).map(({ i }) => i);

describe('多出来的手臂跟着原来的那条动', () => {
  it('上下排的几对：相对自己静止时转得和第一对一样多（还是错开着）', () => {
    const { solver } = kitOf(make({ armPairs: 2 }, { armLayout: 'stack' }));
    for (const name of ['张开双臂', '抱着胳膊', '说话']) {
      const { posing, followers } = followArms(solver, fitArms(solver, preset(name)));
      expect(followers.length, name).toBe(2);
      for (const tag of ['L', 'R']) {
        const first = solver.rig.index.get(`UpperArm_${tag}`)!;
        const second = solver.rig.index.get(`UpperArm_${tag}.002`)!;
        const frames = posing.version === 2 ? solver.frames2 : solver.frames;
        const turned = (bone: number, name: string) => quatMul(posing.bones[name] as Quat, quatConj(frames[bone]));
        // 姿势数据只留 5 位小数，四元数不是严格的单位长：逐个分量比
        const [a, b] = [turned(first, `UpperArm_${tag}`), turned(second, `UpperArm_${tag}.002`)];
        a.forEach((v, k) => expect(v, `${name} ${tag}`).toBeCloseTo(b[k], 4));
      }
    }
  });

  it('两个上半身：里侧的手臂照搬另一个上半身外侧那条的朝向，每个上半身各做一整套', () => {
    const { solver } = kitOf(make({ torsos: 2 }));
    const { posing, followers } = followArms(solver, fitArms(solver, torsos(preset('抱着胳膊'))));
    expect(followers.length).toBe(2);
    for (const tag of ['L', 'R']) {
      for (const bone of ['UpperArm', 'LowerArm', 'Hand']) expect(posing.bones[`${bone}_${tag}.002`], `${bone}_${tag}`).toEqual(posing.bones[`${bone}_${tag}`]);
    }
  });

  it('肩部聚拢的不在此列（fitArms 管）；只有一对手臂、姿势里已经写了的，原样返回', () => {
    const fan = kitOf(make({ armPairs: 3 }, { armLayout: 'fan' })).solver;
    expect(followArms(fan, fitArms(fan, preset('抱着胳膊'))).followers).toEqual([]);
    const one = kitOf(make()).solver;
    const posing = preset('说话');
    expect(followArms(one, posing).posing).toBe(posing);
  });
});

describe('手臂让开身体', () => {
  it('胯很宽时「站着」「走」：垂着的手插进胯里，让开到胯外面；原来那对最多转 40°', () => {
    const kit = kitOf(make({}, { shape: { ...defaultSpec().shape, hips: 1.6 } }));
    const arms = armsOf(kit.solver);
    for (const name of ['站着', '走']) {
      const before = preset(name);
      const after = clearArms(kit.solver, before, kit.body, kit.figure.scale, 1);
      expect(deepest(kit, before, arms), name).toBeGreaterThan(0.01);
      expect(deepest(kit, after, arms), name).toBeLessThan(0.006 * kit.figure.scale);
      for (const tag of ['L', 'R']) {
        const turn = quatMul(after.bones[`UpperArm_${tag}`] as Quat, quatConj(before.bones[`UpperArm_${tag}`] as Quat));
        expect(quatAngle(turn), `${name} ${tag}`).toBeLessThan((41 * Math.PI) / 180);
      }
    }
  });

  it('胸很大时「抱着胳膊」：胳膊挤进胸里的，让到胸前', () => {
    // 胸调到最大：大胸的胸型是照现成素体的胸取的，比以前那种拼的窄，1.8 时胳膊只挤进去几毫米
    const kit = kitOf(make({}, { shape: { ...defaultSpec().shape, bust: 2.2 } }));
    const arms = armsOf(kit.solver);
    const before = preset('抱着胳膊');
    expect(deepest(kit, before, arms)).toBeGreaterThan(0.01);
    expect(deepest(kit, clearArms(kit.solver, before, kit.body, kit.figure.scale, 1), arms)).toBeLessThan(0.006 * kit.figure.scale);
  });

  it('身上没东西挡着的姿势原样返回', () => {
    const kit = kitOf(make());
    const posing = preset('张开双臂');
    expect(clearArms(kit.solver, posing, kit.body, kit.figure.scale, 1)).toBe(posing);
  });

  it('两个上半身：跟着动的里侧手臂要么不插进身体，要么退回静止的样子', () => {
    const kit = kitOf(make({ torsos: 2 }));
    const { solver } = kit;
    for (const name of ['站着', '说话', '张开双臂', '抱着胳膊', '跳舞']) {
      const { posing, followers } = followArms(solver, fitArms(solver, torsos(preset(name))));
      const after = clearArms(solver, posing, kit.body, kit.figure.scale, 1, followers);
      const state = stateOf(solver, after);
      for (const i of followers) {
        const limb = solver.limbs[i];
        const atRest = quatAngle(state.local[limb.upper]) < 1e-6;
        if (!atRest) expect(deepest(kit, after, [i]), `${name} ${limb.name}`).toBeLessThan(0.012 * kit.figure.scale);
      }
      if (name === '抱着胳膊') expect(followers.every((i) => quatAngle(state.local[solver.limbs[i].upper]) > 0.1), name).toBe(true);
    }
  });

  it('三个上半身：正中那个身子的两条手臂两边都是别的身子，垂下去、叉腰、坐着、蹲着都不再埋进旁边的身子里（以前转 40° 推不开就那样插着，手掉成单独一块）', () => {
    const kit = kitOf(make({ torsos: 3 }));
    const { solver } = kit;
    const middle = armsOf(solver, 0);
    for (const name of ['自然站立', '叉腰', '坐着', '蹲着']) {
      const { posing, followers } = followArms(solver, fitArms(solver, torsos(preset(name))));
      const after = clearArms(solver, posing, kit.body, kit.figure.scale, 1, followers);
      for (const i of middle) expect(deepest(kit, after, [i]), `${name} ${solver.limbs[i].name}`).toBeLessThan(-0.01 * kit.figure.scale);
    }
  });

  it('叉腰：手腕外面那一截（缝手的地方，前臂的距离场伸出手腕 3 cm）离开胯，手缝得上', () => {
    for (const spec of [make(), make({ torsos: 2, legs: 4 }, { legLayout: 'abreast' })]) {
      const kit = kitOf(spec);
      const { solver } = kit;
      const { posing, followers } = followArms(solver, fitArms(solver, torsos(preset('叉腰'))));
      const after = clearArms(solver, posing, kit.body, kit.figure.scale, 1, followers);
      for (const i of armsOf(solver, 0)) {
        expect(stubGap(kit, posing, i), `${spec.legLayout} ${solver.limbs[i].name} 让开前`).toBeLessThan(0.02 * kit.figure.scale);
        expect(stubGap(kit, after, i), `${spec.legLayout} ${solver.limbs[i].name}`).toBeGreaterThan(0.025 * kit.figure.scale);
      }
    }
  });
});

describe('柔和的站姿', () => {
  const SOFT = ['自然站立', '双手交叠身前', '双手背在身后', '叉腰', '单手叉腰', '挥手', '比耶', '托腮'];

  it('排在现成的姿势最前面', () => {
    expect(POSE_LIBRARY.slice(0, SOFT.length).map((p) => p.name)).toEqual(SOFT);
    expect(POSE_LIBRARY.some((p) => p.name === '优雅地走')).toBe(true);
  });

  it('手放在该放的地方：叉腰在胯两边、背手在身后、交叠在身前、挥手举过头、托腮在下巴底下；两只脚都还踩在地上', () => {
    const { solver } = kitOf(make());
    const { rig } = solver;
    const at = (name: string) => {
      const frame = forward(rig, stateOf(solver, preset(name)));
      const p = (bone: string) => frame.pos[rig.index.get(bone)!];
      return { L: p('Hand_L'), R: p('Hand_R'), hips: p('Hips'), head: p('Head'), feet: [p('Foot_L'), p('Foot_R')] };
    };
    const stand = at('站着');
    for (const name of SOFT) {
      const pose = at(name);
      // 脚还在原来的地方附近（摆的时候钉着）
      for (let k = 0; k < 2; k++) expect(Math.abs(pose.feet[k][1] - stand.feet[k][1]), name).toBeLessThan(0.02);
    }
    const hip = at('叉腰');
    expect(hip.L[0]).toBeGreaterThan(hip.hips[0] + 0.1);
    expect(hip.R[0]).toBeLessThan(hip.hips[0] - 0.1);
    for (const h of [hip.L, hip.R]) expect(Math.abs(h[1] - hip.hips[1] - 0.1)).toBeLessThan(0.08);
    const back = at('双手背在身后');
    for (const h of [back.L, back.R]) expect(h[2]).toBeLessThan(back.hips[2] - 0.05);
    const front = at('双手交叠身前');
    for (const h of [front.L, front.R]) expect(h[2]).toBeGreaterThan(front.hips[2] + 0.05);
    expect(Math.hypot(front.L[0] - front.R[0], front.L[1] - front.R[1])).toBeLessThan(0.1);
    const wave = at('挥手');
    expect(wave.R[1]).toBeGreaterThan(wave.head[1]);
    const chin = at('托腮');
    expect(Math.abs(chin.R[1] - chin.head[1])).toBeLessThan(0.12);
    expect(chin.R[2]).toBeGreaterThan(chin.head[2]);
  });
});
