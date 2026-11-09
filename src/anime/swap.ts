/**
 * 手脚互换：手接到腿上、脚接到手臂上时，那块现成的网格怎么摆。纯函数。
 *
 * - 手接在腿上：手心朝下贴地、手指朝前，像倒立时撑地的手。现成的手是手腕伸直的，
 *   这里照它自己的蒙皮权重把手腕往手背那边弯 BEND（对偶四元数混合，手腕那一圈不塌），袖口那一圈不动，
 *   所以还是照原样缝在小腿的切口上；
 * - 脚接在手臂上：不用改形，照腿上那样摆（手臂垂下来时脚底朝下、脚趾朝前），见 geometry 里各自的摆法。
 */
import { skinVerticesDualInPlace } from '../character/pose';
import { type Mat3, type V3, add, cross, dot, len, madd, mat3Apply, mat3Mul, mul, norm, sub } from '../geometry/vec';
import { FINGER_COUNT, type FingerJoints, TOE_COUNT } from './digits';
import { FOOT_ANKLE, footMesh } from './foot';
import type { GraftMesh } from './graftMesh';
import { HAND_ELBOW, HAND_WRIST, handMesh, handShape } from './hand';

/** 手腕往手背那边弯多少（弧度）：前臂竖着时手掌正好放平 */
export const BEND = Math.PI / 2;

export interface BentHand {
  /** 弯好了的手（还写在素体模型的坐标里：手腕的关节没动，手指朝 +Y，手心朝 +X） */
  mesh: GraftMesh;
  /** 每根手指的四个关节，跟着手一起转过去的 */
  fingers: FingerJoints[];
  /** 手心最外面那一点离手腕的关节多远（沿前臂往外的方向）：手接在腿上时手腕离地这么高 */
  sole: number;
  /** 手掌正中（手腕到中指根的中点）弯过去以后在哪：踩地时的支点 */
  palm: V3;
}

/**
 * 拇指往四指那边收：现成的手拇指是张开的（和四指差不多成直角），手接在腿上时两只手的拇指都朝里，
 * 素体两脚挨得近，一张开就戳到对面那只手里。收到和四指只差 THUMB_SPREAD（像大脚趾那样顺着往前）
 */
const THUMB_SPREAD = 0.35;

/** 一个刚体变换：p → R p + t（R 按行） */
interface Rigid {
  r: Mat3;
  t: V3;
}
const apply = (m: Rigid, p: V3): V3 => add(mat3Apply(m.r, p), m.t);
const compose = (outer: Rigid, inner: Rigid): Rigid => ({ r: mat3Mul(outer.r, inner.r), t: apply(outer, inner.t) });
/** 绕过 at 这一点、方向是 axis（单位向量）的轴转 angle */
function about(at: V3, axis: V3, angle: number): Rigid {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const [x, y, z] = axis;
  const k = 1 - c;
  const r: Mat3 = [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k];
  return { r, t: sub(at, mat3Apply(r, at)) };
}

/** 手腕弯过去时，离切口这么远以内的逐渐退回原样（米） */
const CUFF_KEEP = 0.012;

const cache = new Map<number, BentHand>();

/** 几根手指的手，拇指收拢、手腕往手背那边弯过去（手接到腿上用） */
export function bentHand(count: number = FINGER_COUNT.base): BentHand {
  const n = Math.round(Math.min(FINGER_COUNT.max, Math.max(FINGER_COUNT.min, count)));
  let hit = cache.get(n);
  if (hit) return hit;
  const shaped = handShape(n);
  const base = shaped.mesh;
  const wrist = base.end;
  // 手腕：绕手腕的关节、绕 +Z 轴（拇指那边）转 BEND，+X（手指）转到 +Y（手背那边）
  const bend = about(wrist, [0, 0, 1], BEND);
  // 拇指：绕拇指根、绕手心的法线（-Y）往四指（+X）那边收。手上 +X 朝外、+Z 朝拇指，从 +Z 量起拇指现在偏了多少
  const thumb = shaped.fingers.find((f) => f.finger === 'Thumb')!.joints;
  const way = sub(thumb[3], thumb[0]);
  const now = Math.atan2(way[0], way[2]);
  const tuck = about(thumb[0], [0, 1, 0], Math.max(0, Math.PI / 2 - THUMB_SPREAD - now));
  const moves = { hand: bend, thumb: compose(bend, tuck) };
  // 每根骨骼 12 个数：3×3 的旋转（按行）再跟平移。前臂不动，手和手指都绕手腕转，拇指先收拢再转
  const matrices = new Float64Array(base.bones.length * 12);
  base.bones.forEach((bone, j) => {
    const m = bone === 'LowerArm' ? { r: [1, 0, 0, 0, 1, 0, 0, 0, 1] as Mat3, t: [0, 0, 0] as V3 } : bone.startsWith('Thumb') ? moves.thumb : moves.hand;
    matrices.set([...m.r, ...m.t], j * 12);
  });
  const positions = base.positions.slice();
  const normals = base.normals.slice();
  skinVerticesDualInPlace(positions, normals, base.joints, base.weights, matrices);
  // 袖口那一圈有一点手的权重，弯过去会跟着挪一两毫米：离切口 CUFF_KEEP 以内逐渐退回原样，切口那一圈一点不动（照旧缝得上）
  const along = norm(sub(base.end, base.root));
  const depth = (p: ArrayLike<number>, i: number) => (p[i] - wrist[0]) * along[0] + (p[i + 1] - wrist[1]) * along[1] + (p[i + 2] - wrist[2]) * along[2];
  const cut = Math.max(...base.loop.map((v) => depth(base.positions, v * 3)));
  for (let i = 0; i < positions.length; i += 3) {
    const t = Math.min(1, Math.max(0, (depth(base.positions, i) - cut) / CUFF_KEEP));
    const k = t * t * (3 - 2 * t);
    for (let q = 0; q < 3; q++) {
      positions[i + q] = base.positions[i + q] + k * (positions[i + q] - base.positions[i + q]);
      normals[i + q] = base.normals[i + q] + k * (normals[i + q] - base.normals[i + q]);
    }
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    for (let q = 0; q < 3; q++) normals[i + q] /= l;
  }
  // 手心最外面那一点：沿前臂往外的方向量（前臂不是正好沿 X 的）
  let reach = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    reach = Math.max(reach, (positions[i] - wrist[0]) * along[0] + (positions[i + 1] - wrist[1]) * along[1] + (positions[i + 2] - wrist[2]) * along[2]);
  }
  const middle = shaped.fingers.find((f) => f.finger === 'Middle')!.joints[0];
  const half: V3 = [(wrist[0] + middle[0]) / 2, (wrist[1] + middle[1]) / 2, (wrist[2] + middle[2]) / 2];
  hit = {
    mesh: { ...base, positions, normals },
    fingers: shaped.fingers.map(({ finger, joints }) => ({ finger, joints: joints.map((p) => apply(finger === 'Thumb' ? moves.thumb : moves.hand, p)) })),
    sole: reach,
    palm: apply(bend, half),
  };
  cache.set(n, hit);
  return hit;
}

/* ---- 摆放 ---- */

/** 一块网格的摆法：网格自己坐标里的点 p 摆到 matrix · p + offset（和 Graft 的 matrix、offset 一样） */
export interface Placement {
  matrix: Mat3;
  offset: V3;
}

/** 一节肢体末端的朝向：末端的关节 end、往身体里一节的关节 root（root → end 顺着肢体往外），以及「前面」朝哪 */
export interface LimbTip {
  end: V3;
  root: V3;
  ahead: V3;
}

/** 照 axis、ahead 搭的一组正交的轴（ahead 先掰成和 axis 垂直的；贴着 axis 时换一根） */
function axes(axis: V3, ahead: V3): [V3, V3, V3] {
  const a = norm(axis);
  let f = sub(ahead, mul(a, dot(ahead, a)));
  if (len(f) < 1e-6) f = sub([0, 1, 0], mul(a, a[1]));
  f = norm(f);
  return [a, f, cross(a, f)];
}

/**
 * 把一块网格从一节肢体的末端（from）挪到另一节的末端（to）：末端的关节对上，顺着肢体往外的方向对上，「前面」对上，
 * 再绕末端的关节放大 scale 倍
 */
export function swapPlace(from: LimbTip, to: LimbTip, scale: number): Placement {
  const A = axes(sub(from.end, from.root), from.ahead);
  const B = axes(sub(to.end, to.root), to.ahead);
  const matrix = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) matrix[i * 3 + j] += scale * B[k][i] * A[k][j];
  return { matrix, offset: sub(to.end, mat3Apply(matrix, from.end)) };
}

/** 先摆 inner、再摆 outer */
export const thenPlace = (outer: Placement, inner: Placement): Placement => ({
  matrix: mat3Mul(outer.matrix, inner.matrix),
  offset: add(mat3Apply(outer.matrix, inner.offset), outer.offset),
});

/** 左右翻过来（x 反号）：左边的摆法换成右边的 */
export const mirrorPlace = (p: Placement): Placement => ({
  matrix: [-p.matrix[0], -p.matrix[1], -p.matrix[2], p.matrix[3], p.matrix[4], p.matrix[5], p.matrix[6], p.matrix[7], p.matrix[8]],
  offset: [-p.offset[0], p.offset[1], p.offset[2]],
});

/** 切口那一圈有多长 */
function girth(mesh: GraftMesh): number {
  let total = 0;
  const n = mesh.loop.length;
  for (let i = 0; i < n; i++) {
    const [a, b] = [mesh.loop[i] * 3, mesh.loop[(i + 1) % n] * 3];
    total += Math.hypot(mesh.positions[a] - mesh.positions[b], mesh.positions[a + 1] - mesh.positions[b + 1], mesh.positions[a + 2] - mesh.positions[b + 2]);
  }
  return total;
}

let ratio = 0;
/**
 * 脚踝那一圈比手腕那一圈粗多少倍（现成的脚和手的切口量的）：手接到腿上照它放大、脚接到手臂上照它缩小，
 * 两边切口一样粗，缝的时候开口不用收、也不用撑
 */
export function ankleToWrist(): number {
  ratio ||= girth(footMesh()) / girth(handMesh());
  return ratio;
}

/** 现成的手在它自己坐标里的那一节（前臂往外是 +X；弯过去以后手指朝 +Y，就拿它当「前面」） */
export const BENT_TIP: LimbTip = { end: HAND_WRIST, root: HAND_ELBOW, ahead: [0, 1, 0] };
/** 腿末端接的手往外撇开多少（弧度） */
export const PALM_OUT = 0.3;
/** 腿末端接的手，手指朝哪（左腿的，右腿 x 反号）：往外撇开一点，两只手的拇指离得开些 */
export const PALM_AHEAD: V3 = [Math.sin(PALM_OUT), 0, Math.cos(PALM_OUT)];
/** 现成的手（没弯的）：手臂垂下来时拇指朝前 */
export const HAND_TIP: LimbTip = { end: HAND_WRIST, root: HAND_ELBOW, ahead: [0, 0, 1] };
/** 现成的脚：脚趾朝前（膝盖的关节取在脚踝正上方，网格里的那个有点歪，照它摆脚会歪着） */
export const FOOT_TIP: LimbTip = { end: FOOT_ANKLE, root: add(FOOT_ANKLE, [0, 1, 0]), ahead: [0, 0, 1] };

/** 手接在腿上时手腕离地多高（放大了 scale 倍）：比脚踝矮，整个人要往下落这么多的差 */
export const palmHeight = (count: number, scale: number) => bentHand(count).sole * scale;

/* ---- 接到另一种肢体上时，除了怎么摆以外的那几项（见 Graft） ---- */

/**
 * 脚接在手臂上：骨骼的对应（小腿那一圈袖口跟着前臂，脚和脚趾都跟着手）、手腕在哪、顺着手臂的方向。
 * name 把「Hand」换成这条手臂上的全名（Hand_L.002 这样的）。脚趾不另长骨骼，跟着手一起动
 */
export function footOnArmGraft(name: (base: string) => string, toes: number) {
  const mesh = footMesh(toes);
  return {
    mesh: 'foot' as const,
    ...(toes !== TOE_COUNT.base ? { digits: toes } : {}),
    bones: Object.fromEntries(mesh.bones.map((bone) => [bone, name(bone === 'LowerLeg' ? 'LowerArm' : 'Hand')])),
    pivot: FOOT_TIP.end,
    reach: sub(FOOT_TIP.end, FOOT_TIP.root),
    rigid: [name('Hand')],
  };
}

/** 手接在腿上时，手指的骨骼叫什么：前面加「Leg」，和手臂上的手指分开（LegThumb1_L、LegIndex2_R.002） */
export const LEG_FINGER = 'Leg';

/**
 * 手接在腿上：骨骼的对应（前臂那一圈袖口跟着小腿，手跟着脚那根骨骼，手指是腿上自己的 LegThumb1 …）、
 * 支点（手腕正下方的手心：腿拉伸时手跟着它挪，手心还贴着地）、顺着小腿的方向。
 * name 把「Foot」换成这条腿上的全名（Foot_L.002 这样的）
 */
export function palmGraft(name: (base: string) => string, fingers: number) {
  const { mesh, sole } = bentHand(fingers);
  const full = (bone: string) => name(bone === 'LowerArm' ? 'LowerLeg' : bone === 'Hand' ? 'Foot' : `${LEG_FINGER}${bone}`);
  return {
    mesh: 'palm' as const,
    ...(fingers !== FINGER_COUNT.base ? { digits: fingers } : {}),
    bones: Object.fromEntries(mesh.bones.map((bone) => [bone, full(bone)])),
    pivot: madd(HAND_WRIST, norm(sub(HAND_WRIST, HAND_ELBOW)), sole),
    reach: sub(HAND_WRIST, HAND_ELBOW),
    rigid: mesh.bones.filter((bone) => bone !== 'LowerArm').map(full),
  };
}
