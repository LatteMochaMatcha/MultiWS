/**
 * 手指：从骨架里找出每只手的五根手指，以及「手势」（每一节弯多少度、张开多少度）和骨骼旋转之间的换算。纯函数。
 *
 * 手指的骨骼照 VRM 的习惯起名：Thumb1_L、Thumb2_L、Thumb3_L（拇指从掌根数起的三节），
 * Index / Middle / Ring / Little 也是 1、2、3 三节；多出来的手臂上的带序号后缀（Index1_L.002）。
 *
 * 和手臂一样，手指也不从这副骨架的静止姿势算起，而是从一个约定的样子算起：
 * 手臂平举（T-pose）、手心朝下、四指并拢朝外伸直，拇指也贴着四指朝外。
 * 所以同一个手势放到静止时手指微张的角色上、手指微弯的骨架上，摆出来是同一个样子。
 */
import { tk, t } from '../i18n';
import { type Quat, type V3, add, cross, len, mul, norm, quatConj, quatMul, rotate, sub } from '../geometry/vec';
import { type Limb, limbFrame } from './limbs';
import { anyPerp, quatUnit, reject } from './math';
import { type Posing, mirrorQuat, roundQuat } from './posing';
import { type PoseRig, type PoseState, cloneState, forward } from './rig';
import type { Solver } from './solver';

export const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const;
export type FingerName = (typeof FINGER_NAMES)[number];
/** 给人看的名字 */
export const FINGER_LABEL: Record<FingerName, string> = { Thumb: t('拇指'), Index: t('食指'), Middle: t('中指'), Ring: t('无名指'), Little: t('小指') };

/** 多出来的手指（anime/digits.ts 照无名指复制的，插在无名指和小指之间），从拇指那边数起 */
export const EXTRA_FINGER_NAMES = ['FingerA', 'FingerB', 'FingerC'] as const;
export type ExtraFingerName = (typeof EXTRA_FINGER_NAMES)[number];

/**
 * 骨骼名是不是手指的一节；是的话给出是哪根手指、第几节。
 * 手脚互换时接在腿上的手，手指前面多一个「Leg」（LegThumb1_L；长在中线上的腿不分左右：LegThumb1）
 */
export function fingerOf(name: string): { finger: FingerName | ExtraFingerName; joint: number } | null {
  const m = /^(?:Leg(Thumb|Index|Middle|Ring|Little|Finger[A-C])(\d)(?:_[LR])?|(Thumb|Index|Middle|Ring|Little|Finger[A-C])(\d)_[LR])(?:\.\d+)?$/.exec(name);
  return m ? { finger: (m[1] ?? m[3]) as FingerName | ExtraFingerName, joint: Number(m[2] ?? m[4]) } : null;
}

/**
 * 多出来的手指在姿势数据里没记的时候跟着哪根骨骼：它是照无名指复制的，就跟着无名指同一节
 * （现成的姿势、手势都只记五根手指）。不是多出来的手指返回 null
 */
export function extraFingerTwin(name: string): string | null {
  const m = /^(Leg)?Finger[A-C](\d(?:_[LR])?(?:\.\d+)?)$/.exec(name);
  return m ? `${m[1] ?? ''}Ring${m[2]}` : null;
}

export interface Hand {
  /** 手那根骨骼（Hand_L、Hand_R.002）和它的名字 */
  bone: number;
  name: string;
  /** 1 是角色的左手，-1 是右手；pair 是第几对手臂（从 0 数） */
  side: 1 | -1;
  pair: number;
  /** 长在哪种肢体上：手臂，或者腿（手脚互换时腿末端接的手；长在中线上的腿上的当作左手） */
  limb: 'arm' | 'leg';
  /** 五根手指（顺序见 FINGER_NAMES）各自的几节骨骼，从根到梢；这只手上没有的那根是空的 */
  fingers: number[][];
  /** 多出来的手指（EXTRA_FINGER_NAMES 的顺序），各自的几节骨骼；手势里它们跟着无名指 */
  extras: number[][];
  /** 手掌静止时相对「T-pose、手心朝下」转了多少 */
  frame: Quat;
}

const X: V3 = [1, 0, 0];
const Y: V3 = [0, 1, 0];
/** 四指弯曲的转轴（约定的样子里）：绕它转是往手心收 */
const CURL: V3 = [0, 0, -1];
/** 约定的样子里四指和手掌的朝向：沿 X 伸出去，绕 -Z 弯。拇指的是「没转」：沿 X，绕 +Y 往四指那边收 */
const FLAT: Quat = limbFrame(X, CURL);
const DEG = Math.PI / 180;

const about = (axis: V3, degrees: number): Quat => {
  const half = (degrees * DEG) / 2;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
};

/**
 * 找出每只手和它的手指，算出手掌、每节手指静止时相对约定的样子转了多少（frames：骨骼下标 → 旋转）。
 * 左右手的轴取成镜像的，这样镜像一个手势和镜像手臂一样，只要把四元数的 y、z 反号。
 */
export function findHands(rig: PoseRig, limbs: readonly Limb[]): { hands: Hand[]; frames: Map<number, Quat> } {
  const kids: number[][] = rig.names.map(() => []);
  rig.parent.forEach((p, i) => {
    if (p >= 0) kids[p].push(i);
  });
  const hands: Hand[] = [];
  const frames = new Map<number, Quat>();
  for (const limb of limbs) {
    // 腿上也可能接着手（手脚互换）：手指照样找；中线上的腿当左边的算
    const sign = limb.side || 1;
    const fingers: number[][] = FINGER_NAMES.map(() => []);
    const extras: number[][] = EXTRA_FINGER_NAMES.map(() => []);
    const collect = (bone: number) => {
      for (const kid of kids[bone]) {
        const found = fingerOf(rig.names[kid]);
        if (!found) continue;
        const main = FINGER_NAMES.indexOf(found.finger as FingerName);
        if (main >= 0) fingers[main].push(kid);
        else extras[EXTRA_FINGER_NAMES.indexOf(found.finger as ExtraFingerName)].push(kid);
        collect(kid);
      }
    };
    collect(limb.end);
    if (fingers.every((chain) => chain.length === 0)) continue;
    while (extras.length && !extras[extras.length - 1].length) extras.pop();

    const wrist = rig.head[limb.end];
    // 手心朝哪：手腕、食指根、小指根三点定出手掌的平面。四指不够两根的，照手肘的转轴估（T-pose 时手心朝下）
    const roots = fingers.slice(1).filter((chain) => chain.length).map((chain) => sub(rig.head[chain[0]], wrist));
    let palm = mul(limb.hinge, sign);
    if (roots.length >= 2) {
      const n = cross(roots[roots.length - 1], roots[0]);
      if (len(n) > 1e-12) palm = mul(norm(n), sign);
    }
    // 手掌朝前的方向：手腕到四个指根的正中（一根都没有就用手这根骨骼的方向），掰到手掌的平面里
    const ahead = roots.length ? roots.reduce((sum, root) => add(sum, root)) : sub(rig.tail[limb.end], wrist);
    const flat = reject(ahead, palm);
    const along = mul(len(flat) > 1e-9 ? norm(flat) : anyPerp(palm), sign);
    hands.push({
      bone: limb.end,
      name: limb.name,
      side: sign > 0 ? 1 : -1,
      pair: limb.pair,
      limb: limb.kind,
      fingers,
      extras,
      frame: quatMul(limbFrame(along, cross(along, palm)), quatConj(FLAT)),
    });

    [...fingers, ...extras].forEach((chain, f) => {
      let dir = along;
      chain.forEach((bone, k) => {
        const span = sub(k + 1 < chain.length ? rig.head[chain[k + 1]] : rig.tail[bone], rig.head[bone]);
        // 长度是零的一节（有的骨架末梢没有终点）：照上一节的方向
        if (len(span) > 1e-9) dir = mul(norm(span), sign);
        // 拇指绕着手掌的法线弯（在手掌的平面里往四指那边收），四指绕着手掌平面里和自己垂直的那根轴弯
        frames.set(bone, f === 0 ? limbFrame(dir, mul(palm, -1)) : quatMul(limbFrame(dir, cross(dir, palm)), quatConj(FLAT)));
      });
    });
  }
  return { hands, frames };
}

/**
 * 一节手指绕着弯的那根轴，静止姿势里它朝哪（世界坐标）。frame 是这节骨骼在 findHands 里算出来的那个旋转。
 * 这节骨骼相对父骨骼绕这根轴转正的角度，就是往手心（拇指是往四指那边）弯。
 */
export const fingerHinge = (frame: Quat, side: 1 | -1, thumb: boolean): V3 => mul(rotate(frame, thumb ? Y : CURL), side);

/* ---------------- 手势 ---------------- */

/** 四指里的一根：三节各弯多少度（往手心是正），在手掌平面里往拇指那边偏多少度 */
export interface FingerShape {
  curl: [number, number, number];
  spread: number;
}

/**
 * 拇指。第一节（掌骨）：在手掌的平面里离开四指的方向张开多少度（out），往手心那边压下去多少度（down），
 * 顺着自己的轴往里拧多少度（roll，拇指肚转向四指）；后两节各弯多少度（curl）
 */
export interface ThumbShape {
  out: number;
  down: number;
  roll: number;
  curl: [number, number];
}

/** 一只手的手势。角度都是度，不分左右手 */
export interface HandShape {
  thumb: ThumbShape;
  /** 食指、中指、无名指、小指 */
  fingers: [FingerShape, FingerShape, FingerShape, FingerShape];
}

/**
 * 手势 → 每根手指每一节相对手掌转了多少（在约定的样子里）。
 * 手势本身不分左右；右手的转法是左手的镜像。
 */
export function handTurns(shape: HandShape, side: 1 | -1 = 1): Quat[][] {
  const t = shape.thumb;
  const t1 = quatMul(quatMul(about(Y, -t.out), about(CURL, t.down)), about(X, -t.roll));
  const t2 = quatMul(t1, about(Y, t.curl[0]));
  const t3 = quatMul(t2, about(Y, t.curl[1]));
  const out = [[t1, t2, t3]];
  for (const f of shape.fingers) {
    const a = quatMul(about(Y, -f.spread), about(CURL, f.curl[0]));
    const b = quatMul(a, about(CURL, f.curl[1]));
    out.push([a, b, quatMul(b, about(CURL, f.curl[2]))]);
  }
  return side > 0 ? out : out.map((chain) => chain.map(mirrorQuat));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** q 绕 axis 转了多少度（-180 – 180） */
const twist = (q: Quat, axis: V3) => {
  const a = (2 * Math.atan2(q[0] * axis[0] + q[1] * axis[1] + q[2] * axis[2], q[3])) / DEG;
  return a - 360 * Math.round(a / 360);
};
const between = (a: Quat, b: Quat) => quatMul(quatConj(a), b);

/**
 * handTurns 反过来：每根手指每一节相对手掌转了多少 → 手势。turned[f] 是第 f 根手指的各节（没有的手指是空的，照放松的样子算）。
 * 不是纯粹「弯」和「张」的那部分（手指自己拧了一点）量不出来，照没有算。
 */
export function shapeFromTurns(turned: readonly (readonly Quat[])[], side: 1 | -1 = 1): HandShape {
  const own = (chain: readonly Quat[] | undefined) => (side > 0 ? (chain ?? []) : (chain ?? []).map(mirrorQuat));
  const thumb: ThumbShape = { ...RELAXED.thumb, curl: [...RELAXED.thumb.curl] };
  const chain = own(turned[0]);
  if (chain.length) {
    const d = rotate(chain[0], X);
    thumb.down = Math.asin(clamp(-d[1], -1, 1)) / DEG;
    thumb.out = Math.hypot(d[0], d[2]) > 1e-6 ? Math.atan2(d[2], d[0]) / DEG : 0;
    // 朝向对上以后剩下的那一点，就是顺着自己的轴拧了多少
    thumb.roll = -twist(between(quatMul(about(Y, -thumb.out), about(CURL, thumb.down)), chain[0]), X);
    thumb.curl = [chain[1] ? twist(between(chain[0], chain[1]), Y) : 0, chain[2] ? twist(between(chain[1], chain[2]), Y) : 0];
  }
  const fingers = [1, 2, 3, 4].map((f): FingerShape => {
    const q = own(turned[f]);
    if (!q.length) return { curl: [...RELAXED.fingers[f - 1].curl], spread: RELAXED.fingers[f - 1].spread };
    const d = rotate(q[0], X);
    // 弯过了九十度的：手指朝后了，「偏」要反过来看
    const back = d[0] < 0 ? -1 : 1;
    const level = Math.hypot(d[0], d[2]);
    return {
      curl: [
        Math.atan2(-d[1], back * level) / DEG,
        q[1] ? twist(between(q[0], q[1]), CURL) : 0,
        q[2] ? twist(between(q[1], q[2]), CURL) : 0,
      ],
      spread: level > 1e-6 ? Math.atan2(back * d[2], back * d[0]) / DEG : 0,
    };
  });
  return { thumb, fingers: fingers as HandShape['fingers'] };
}

/** 把一只手摆成这个手势；手掌、手臂不动。这只手上没有的手指跳过 */
export function shapeHand(solver: Solver, state: PoseState, hand: Hand, shape: HandShape): PoseState {
  const { rig, frames } = solver;
  const out = cloneState(state);
  const frame = forward(rig, state);
  const palm = quatMul(frame.rot[hand.bone], hand.frame);
  const world = new Map<number, Quat>();
  const turns = handTurns(shape, hand.side);
  // 多出来的手指照无名指摆（它就是照无名指复制的）
  const chains = [...hand.fingers.map((bones, f) => ({ bones, chain: turns[f] })), ...hand.extras.map((bones) => ({ bones, chain: turns[3] }))];
  for (const { bones, chain } of chains) {
    bones.forEach((bone, k) => {
      // 比三节多出来的（少见）：跟着第三节
      const turned = quatUnit(quatMul(quatMul(palm, chain[Math.min(k, chain.length - 1)]), quatConj(frames[bone])));
      world.set(bone, turned);
      const p = rig.parent[bone];
      out.local[bone] = quatUnit(quatMul(quatConj(world.get(p) ?? frame.rot[p]), turned));
    });
  }
  return out;
}

/** 一只手现在是什么手势 */
export function readHand(solver: Solver, state: PoseState, hand: Hand): HandShape {
  const { rig, frames } = solver;
  const frame = forward(rig, state);
  const palm = quatConj(quatMul(frame.rot[hand.bone], hand.frame));
  return shapeFromTurns(
    hand.fingers.map((chain) => chain.map((bone) => quatMul(quatMul(palm, frame.rot[bone]), frames[bone]))),
    hand.side,
  );
}

/* ---- 直接在姿势数据上读、写手势（不用骨架）：数据里手掌和手指记的都是「从约定的样子转了多少」，一除就是相对手掌的 ---- */

/** tag 是骨骼名里手那一段后面的部分：L、R、L.002 … */
const sideOf = (tag: string): 1 | -1 => (tag.startsWith('L') ? 1 : -1);
const jointName = (finger: FingerName, joint: number, tag: string) => `${finger}${joint}_${tag}`;

/** 姿势数据（第 3 版）里一只手的手势。数据里没有这只手掌、或者一根手指都没记，返回 null */
export function posingHand(posing: Posing, tag: string): HandShape | null {
  const palm = posing.bones[`Hand_${tag}`];
  if (!palm || posing.version !== 3) return null;
  const back = quatConj(quatUnit(palm));
  const turned = FINGER_NAMES.map((finger) => {
    const chain: Quat[] = [];
    for (let k = 1; k <= 3; k++) {
      const q = posing.bones[jointName(finger, k, tag)];
      if (!q) break;
      chain.push(quatMul(back, quatUnit(q)));
    }
    return chain;
  });
  return turned.some((chain) => chain.length) ? shapeFromTurns(turned, sideOf(tag)) : null;
}

/** 姿势数据（第 3 版）里把一只手换成这个手势：返回新的 bones。数据里没有这只手掌就原样返回 */
export function withPosingHand(posing: Posing, tag: string, shape: HandShape): Posing {
  const palm = posing.bones[`Hand_${tag}`];
  if (!palm || posing.version !== 3) return posing;
  const bones = { ...posing.bones };
  handTurns(shape, sideOf(tag)).forEach((chain, f) => {
    chain.forEach((turned, k) => {
      bones[jointName(FINGER_NAMES[f], k + 1, tag)] = roundQuat(quatMul(quatUnit(palm), turned));
    });
  });
  return { ...posing, bones };
}

/* ---------------- 滑块 ---------------- */

/** 面板上的六个滑块：五根手指各弯多少（0 伸直，1 握到底），四指张开多少（0 并拢，1 张到最开） */
export interface HandDials {
  /** 拇指、食指、中指、无名指、小指 */
  curl: [number, number, number, number, number];
  spread: number;
}

/** 握到底时四指的三节各弯多少度 */
const FIST: [number, number, number] = [85, 100, 70];
const FIST_SUM = FIST[0] + FIST[1] + FIST[2];
/** 张到最开时四指各往拇指那边偏多少度（食指 → 小指） */
const SPLAY = [16, 4, -8, -20];
/** 拇指伸着的时候：并拢、张到最开各离四指多少度，往手心压多少度 */
const THUMB_OPEN = { near: 22, far: 62, down: 4 };
/** 拇指收到底：压在握起来的四指前面 */
const THUMB_SHUT: ThumbShape = { out: 36, down: 20, roll: 30, curl: [58, 72] };
const THUMB_CURL = THUMB_SHUT.curl[0] + THUMB_SHUT.curl[1];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const thumbOf = (c: number, spread: number): ThumbShape => ({
  out: mix(mix(THUMB_OPEN.near, THUMB_OPEN.far, spread), THUMB_SHUT.out, c),
  down: mix(THUMB_OPEN.down, THUMB_SHUT.down, c),
  roll: THUMB_SHUT.roll * c,
  curl: [THUMB_SHUT.curl[0] * c, THUMB_SHUT.curl[1] * c],
});

/** 滑块 → 手势 */
export function shapeOf(dials: HandDials): HandShape {
  return {
    thumb: thumbOf(dials.curl[0], dials.spread),
    fingers: [0, 1, 2, 3].map((i) => ({
      curl: FIST.map((a) => a * dials.curl[i + 1]) as [number, number, number],
      // 加 0：负数乘 0 是 -0，写进数据里不好看
      spread: SPLAY[i] * dials.spread + 0,
    })) as HandShape['fingers'],
  };
}

/** 手势 → 滑块该摆在哪（现成的手势不一定正好落在滑块能摆出来的样子上，取最接近的） */
export function dialsOf(shape: HandShape): HandDials {
  const fingers = shape.fingers.map((f) => clamp((f.curl[0] + f.curl[1] + f.curl[2]) / FIST_SUM, 0, 1));
  const thumb = clamp((shape.thumb.curl[0] + shape.thumb.curl[1]) / THUMB_CURL, 0, 1);
  // 张开多少：看食指和小指各偏了多少（握起来的手指看不出张没张，不算）
  const seen = [0, 3].filter((i) => shape.fingers[i].curl[0] < 50).map((i) => shape.fingers[i].spread / SPLAY[i]);
  const spread = seen.length
    ? seen.reduce((a, b) => a + b, 0) / seen.length
    : thumb < 0.3
      ? (shape.thumb.out - THUMB_OPEN.near) / (THUMB_OPEN.far - THUMB_OPEN.near)
      : 0;
  return { curl: [thumb, fingers[0], fingers[1], fingers[2], fingers[3]], spread: clamp(spread, 0, 1) };
}

/** 只改一根手指弯多少（finger：0 拇指 … 4 小指），别的手指不动 */
export function withCurl(shape: HandShape, finger: number, curl: number): HandShape {
  const c = clamp(curl, 0, 1);
  if (finger === 0) return { ...shape, thumb: thumbOf(c, dialsOf(shape).spread) };
  const fingers = shape.fingers.map((f, i) =>
    i === finger - 1 ? { curl: FIST.map((a) => a * c) as [number, number, number], spread: f.spread } : f,
  ) as HandShape['fingers'];
  return { ...shape, fingers };
}

/** 只改四指张开多少，各自弯多少不动 */
export function withSpread(shape: HandShape, spread: number): HandShape {
  const s = clamp(spread, 0, 1);
  const thumb = dialsOf(shape).curl[0];
  return {
    thumb: { ...shape.thumb, out: thumbOf(thumb, s).out },
    fingers: shape.fingers.map((f, i) => ({ curl: f.curl, spread: SPLAY[i] * s + 0 })) as HandShape['fingers'],
  };
}

/* ---------------- 现成的手势 ---------------- */

type Four = [number, number, number, number];
type Five = [number, number, number, number, number];
/** 写手势用：拇指是「张开、往手心压、往里拧、后两节各弯多少」，四指每根是「三节各弯多少、往拇指那边偏多少」 */
const hand = (thumb: Five, index: Four, middle: Four, ring: Four, little: Four): HandShape => ({
  thumb: { out: thumb[0], down: thumb[1], roll: thumb[2], curl: [thumb[3], thumb[4]] },
  fingers: [index, middle, ring, little].map((f) => ({ curl: [f[0], f[1], f[2]], spread: f[3] })) as HandShape['fingers'],
});

/** 伸直、握住 */
const UP = (spread = 0): Four => [0, 0, 0, spread];
const DOWN: Four = [...FIST, 0];
/** 拇指压在握起来的手指上 */
const TUCK: Five = [THUMB_SHUT.out, THUMB_SHUT.down, THUMB_SHUT.roll, ...THUMB_SHUT.curl];
/** 拇指竖起来 */
const THUMB_UP: Five = [64, 0, 0, -5, -8];

/** 手自然垂着的样子：手指微微弯着，越靠小指弯得越多。骨架上量不出来的手指也照它算 */
export const RELAXED = hand([40, 16, 10, 8, 14], [14, 22, 12, 5], [20, 28, 15, 1], [26, 32, 18, -3], [32, 36, 20, -8]);

export interface Gesture {
  /** 手势名：中文原文，既是 __oc.pose.gesture() 和工具里按名字找的键，也是译文的键（界面上显示时用 t(name)） */
  name: string;
  shape: HandShape;
}

export const GESTURES: Gesture[] = [
  { name: tk('放松'), shape: RELAXED },
  { name: tk('张开'), shape: hand([THUMB_OPEN.far, THUMB_OPEN.down, 0, 0, 0], UP(SPLAY[0]), UP(SPLAY[1]), UP(SPLAY[2]), UP(SPLAY[3])) },
  { name: tk('并拢'), shape: hand([14, 6, 0, 0, 0], UP(), UP(), UP(), UP()) },
  { name: tk('握拳'), shape: hand(TUCK, DOWN, DOWN, DOWN, DOWN) },
  { name: tk('握着东西'), shape: hand([40, 28, 30, 35, 40], [58, 78, 45, 0], [60, 80, 46, 0], [62, 82, 48, 0], [64, 84, 50, 0]) },
  { name: tk('指'), shape: hand(TUCK, UP(), DOWN, DOWN, DOWN) },
  { name: tk('剪刀手'), shape: hand(TUCK, UP(12), UP(-10), DOWN, DOWN) },
  { name: tk('三'), shape: hand(TUCK, UP(12), UP(1), UP(-11), DOWN) },
  { name: tk('四'), shape: hand([32, 18, 35, 75, 35], UP(9), UP(2), UP(-5), UP(-13)) },
  { name: tk('竖大拇指'), shape: hand(THUMB_UP, DOWN, DOWN, DOWN, DOWN) },
  { name: 'OK', shape: hand([35, 35, 30, 40, 40], [40, 60, 45, 4], [8, 14, 8, 1], [5, 9, 6, -8], [2, 6, 5, -18]) },
  { name: tk('摇滚'), shape: hand(TUCK, UP(8), DOWN, DOWN, UP(-12)) },
  { name: tk('六'), shape: hand(THUMB_UP, DOWN, DOWN, DOWN, UP(-22)) },
  { name: tk('手枪'), shape: hand(THUMB_UP, UP(), DOWN, DOWN, DOWN) },
  { name: tk('爪'), shape: hand([55, 20, 10, 25, 45], [14, 78, 55, 16], [14, 80, 56, 4], [14, 80, 56, -8], [14, 78, 55, -20]) },
  { name: tk('捏'), shape: hand([35, 35, 30, 40, 40], [44, 52, 30, 4], [40, 50, 30, 0], [48, 55, 34, -3], [55, 60, 38, -7]) },
];
