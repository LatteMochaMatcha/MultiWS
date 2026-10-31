/**
 * 套现成的姿势时手臂让开：现成的姿势是给普通身材、两条手臂的人做的。套到胯宽、胸大的身体上，
 * 垂着的手插进胯里，抱着的胳膊插进胸里；多出来的手臂跟着原来的那条做同样的动作（见 fit.ts 的 followArms），
 * 又会伸进旁边的身子里、和别的手臂打架。
 *
 * 这里一条一条手臂看：上臂、前臂、手当成几段圆棒，取几个点，量它们插进身体多深（身体是静止姿势下的距离场，
 * 不含手臂：每个点照离它最近的那根身上的骨骼换算回静止姿势里去量）。插得比 GRACE 深的，
 * 整条手臂绕肩关节转一点，让插得最深的那一点沿身体表面的法线退出来，反复几轮。
 * 原来的那对只让开身体，最多转 MAX_TURN（姿势本来就是给它们做的）；跟着动的那几条还要让开别的手臂，
 * 这样推不开的（两个上半身之间，往哪边推都是另一个身子），整条往身前抬一点再推（最多抬 LIFT_MAX），
 * 还碰着就退回静止的样子（静止时本来就摆得开）。
 * 纯函数。
 */
import { type Quat, type V3, add, dot, len, mul, norm, quatBetween, quatConj, quatMul, rotate, sub } from '../geometry/vec';
import type { Limb } from './limbs';
import { quatAngle, quatLimit } from './math';
import type { Posing } from './posing';
import { type Frame, forward, setWorldRot, tailOf } from './rig';
import { type Solver, posingOf, stateOf } from './solver';

/** 静止姿势下身体（不含手臂）的距离：外面是正的，单位和骨架一样（米） */
export type BodyDist = (x: number, y: number, z: number) => number;

/** 上臂、前臂、手当成多粗的圆棒（按标准人台的米，取得比实际细：只管明显插进去的） */
const RADIUS = { upper: 0.032, fore: 0.026, hand: 0.016 };
/** 插进去这么深以内不管：手贴着大腿、胳膊贴着身子本来就是这样 */
const GRACE = 0.006;
/** 退出来以后再离开表面这么远 */
const MARGIN = 0.004;
/** 一轮最多转多少；原来的那对一共最多转多少 */
const STEP_TURN = (14 * Math.PI) / 180;
const MAX_TURN = (40 * Math.PI) / 180;
/** 最多几轮 */
const ROUNDS = 10;
/** 跟着动的手臂：每一档往身前抬多少、最多抬多少；每一档上推开的时候最多转多少 */
const LIFT_STEP = (10 * Math.PI) / 180;
const LIFT_MAX = (30 * Math.PI) / 180;
const NUDGE = (20 * Math.PI) / 180;
/** 量的点：上臂离肩关节近的那一截埋在身子里，从 UPPER_FROM 起取 */
const UPPER_FROM = 0.4;
/** 身上的骨骼：手臂以外、量身体时用来换算的那些 */
const BODY_BONE = /^(?:Hips|Spine|Chest|UpperChest|Neck|Head|UpperLeg|LowerLeg|Foot|Toes|LowerBody|Abdomen)(?:_[LR])?(?:\.\d+)?$/;

interface Rod {
  a: V3;
  b: V3;
  r: number;
}

/**
 * 让开（见文件开头）。scale：骨架比标准人台大多少倍（圆棒跟着粗）；thick：四肢粗细的倍数；
 * followers：跟着原来那条动的手臂（solver.limbs 的下标）。没有要让的就返回原来那份
 */
export function clearArms(solver: Solver, posing: Posing, body: BodyDist, scale = 1, thick = 1, followers: readonly number[] = []): Posing {
  const { rig, limbs } = solver;
  const arms = limbs.map((limb, i) => ({ limb, i })).filter(({ limb }) => limb.kind === 'arm');
  if (!arms.length) return posing;
  const state = stateOf(solver, posing);
  const bodyBones = rig.names.map((name, j) => (BODY_BONE.test(name) ? j : -1)).filter((j) => j >= 0);
  const k = scale * thick;
  const grace = GRACE * scale;
  const margin = MARGIN * scale;
  const h = 0.004 * scale;
  let frame = forward(rig, state);
  let changed = false;

  /** 一条手臂现在的几段圆棒：上臂、前臂、手（手指尖：有中指就到中指尖，没有就把手掌那一节加长一半） */
  const rods = (limb: Limb, f: Frame): Rod[] => {
    const s = f.pos[limb.upper];
    const e = f.pos[limb.lower];
    const w = f.pos[limb.end];
    const tag = rig.names[limb.end].replace(/^Hand/, '');
    const tip = rig.index.get(`Middle3${tag}`);
    const end = tip !== undefined ? tailOf(rig, f, tip) : add(w, mul(sub(tailOf(rig, f, limb.end), w), 1.5));
    return [
      { a: s, b: e, r: RADIUS.upper * k },
      { a: e, b: w, r: RADIUS.fore * k },
      { a: w, b: end, r: RADIUS.hand * k },
    ];
  };
  /** 量的点（不含上臂靠肩膀的那一截） */
  const samples = (limb: Limb, f: Frame): { p: V3; r: number }[] => {
    const [upper, fore, hand] = rods(limb, f);
    const out: { p: V3; r: number }[] = [];
    for (const t of [UPPER_FROM, 0.6, 0.8, 1]) out.push({ p: lerp3(upper.a, upper.b, t), r: upper.r });
    for (const t of [0.25, 0.5, 0.75, 1]) out.push({ p: lerp3(fore.a, fore.b, t), r: fore.r });
    for (const t of [0.5, 1]) out.push({ p: lerp3(hand.a, hand.b, t), r: hand.r });
    return out;
  };
  /** 一点在身体里多深（负的是在外面）、往外的方向 */
  const intoBody = (p: V3, r: number, f: Frame): { depth: number; out: V3 } => {
    let best = -1;
    let gap = Infinity;
    for (const b of bodyBones) {
      const d = segmentGap(p, f.pos[b], tailOf(rig, f, b));
      if (d < gap) [gap, best] = [d, b];
    }
    if (best < 0) return { depth: -Infinity, out: [0, 1, 0] };
    const back = quatConj(f.rot[best]);
    const q = add(rig.head[best], rotate(back, sub(p, f.pos[best])));
    const d = body(q[0], q[1], q[2]);
    const g: V3 = [
      body(q[0] + h, q[1], q[2]) - body(q[0] - h, q[1], q[2]),
      body(q[0], q[1] + h, q[2]) - body(q[0], q[1] - h, q[2]),
      body(q[0], q[1], q[2] + h) - body(q[0], q[1], q[2] - h),
    ];
    return { depth: r - d, out: len(g) > 1e-12 ? rotate(f.rot[best], norm(g)) : [0, 1, 0] };
  };
  /** 一点插进别的手臂多深、往外的方向 */
  const intoArms = (p: V3, r: number, others: Rod[]): { depth: number; out: V3 } => {
    let depth = -Infinity;
    let out: V3 = [0, 1, 0];
    for (const rod of others) {
      const c = closest(p, rod.a, rod.b);
      const away = sub(p, c);
      const d = r + rod.r - len(away);
      if (d > depth && len(away) > 1e-9) [depth, out] = [d, norm(away)];
    }
    return { depth, out };
  };
  /** 一条手臂插得最深的那一点 */
  const worst = (limb: Limb, others: Rod[] | null): { p: V3; depth: number; out: V3 } => {
    let hit = { p: [0, 0, 0] as V3, depth: -Infinity, out: [0, 1, 0] as V3 };
    for (const { p, r } of samples(limb, frame)) {
      for (const probe of [intoBody(p, r, frame), others ? intoArms(p, r, others) : null]) {
        if (probe && probe.depth > hit.depth) hit = { p, ...probe };
      }
    }
    return hit;
  };
  /** 整条手臂绕肩关节转 turn（世界坐标里的旋转） */
  const swing = (limb: Limb, turn: Quat) => {
    setWorldRot(rig, state, frame, limb.upper, quatMul(turn, frame.rot[limb.upper]));
    frame = forward(rig, state);
  };
  /** 一条手臂让开：返回最后还插着多深 */
  const relieve = (limb: Limb, others: Rod[] | null, limit: number): number => {
    let turned = 0;
    let hit = worst(limb, others);
    for (let round = 0; round < ROUNDS && hit.depth > grace && turned < limit; round++) {
      const s = frame.pos[limb.upper];
      const from = sub(hit.p, s);
      const to = add(from, mul(hit.out, hit.depth + margin));
      if (len(from) < 1e-6 || len(to) < 1e-6) break;
      const turn = quatLimit(quatBetween(norm(from), norm(to)), Math.min(STEP_TURN, limit - turned));
      if (quatAngle(turn) < 1e-4) break;
      swing(limb, turn);
      turned += quatAngle(turn);
      changed = true;
      hit = worst(limb, others);
    }
    return hit.depth;
  };

  const following = new Set(followers);
  // 先是原来的那几条：只让开身体
  for (const { limb, i } of arms) if (!following.has(i)) relieve(limb, null, MAX_TURN);
  // 再是跟着动的：还要让开别的手臂
  for (const { limb, i } of arms) {
    if (!following.has(i)) continue;
    const chain = armChain(solver, limb);
    const start = chain.map((j) => state.local[j]);
    const put = (locals: readonly Quat[] | null) => {
      chain.forEach((j, n) => (state.local[j] = locals ? locals[n] : [0, 0, 0, 1]));
      frame = forward(rig, state);
    };
    const others = () => arms.filter((other) => other.i !== i).flatMap((other) => rods(other.limb, frame));
    const top = rig.parent[chain[0]];
    // 往身前抬：绕这个上半身（手臂长在它上面）现在的左右方向转
    const across = rotate(top >= 0 ? frame.rot[top] : [0, 0, 0, 1], [1, 0, 0]);
    let clear = false;
    for (let lift = 0; lift <= LIFT_MAX + 1e-9 && !clear; lift += LIFT_STEP) {
      put(start);
      if (lift) swing(limb, axisTurn(across, -lift));
      clear = relieve(limb, others(), NUDGE) <= grace;
    }
    // 抬到头还碰着：这条手臂（锁骨往外）退回静止的样子
    if (!clear) put(null);
    changed = true;
  }
  return changed ? posingOf(solver, state, posing) : posing;
}

/** 一条手臂上的骨骼：锁骨（有的话）、上臂，以及它们往下所有的骨骼 */
function armChain(solver: Solver, limb: Limb): number[] {
  const { rig } = solver;
  const top = rig.parent[limb.upper] >= 0 && /^Shoulder/.test(rig.names[rig.parent[limb.upper]]) ? rig.parent[limb.upper] : limb.upper;
  const out = [top];
  for (let j = 0; j < rig.names.length; j++) {
    if (j === top) continue;
    for (let p = rig.parent[j]; p >= 0; p = rig.parent[p]) {
      if (p === top) {
        out.push(j);
        break;
      }
    }
  }
  return out;
}

/** 绕单位向量 axis 转 angle 弧度 */
function axisTurn(axis: V3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 线段 ab 上离 p 最近的点 */
function closest(p: V3, a: V3, b: V3): V3 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return lerp3(a, b, t);
}

const segmentGap = (p: V3, a: V3, b: V3) => len(sub(p, closest(p, a, b)));

