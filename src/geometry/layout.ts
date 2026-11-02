/**
 * 摆位：BodySpec → Figure。纯函数，不碰 three.js 和 DOM。
 *
 * 部件都按一个 1.76 m 上下的标准人台来摆（沿用 v1 的骨架尺寸），Figure.scale 再把它缩放到设定身高。
 * 体型是动漫比例的成年女性：躯干有胸腔、腰、骨盆的起伏，四肢带一点肌肉的鼓起。
 */
import { type BodySpec, type Gender, type HandStyle, type LegForm, type PartOverride, BUST_MAX_OTHER, legPlan } from '../model/spec';
import { animeReady } from '../anime/body';
import { FINGER_JOINTS, HAND_ELBOW, HAND_LENGTH, HAND_WRIST, handGraft } from '../anime/hand';
import { layoutAnime } from './animeLayout';
import { FACE_OUT, faceTurns, fanShift, gatherOut, headCluster, headShrink, headTurn, shoulderSpan } from './bodyPlan';
import { type BoneHint, type Figure, type Graft, type Part, type Prim, type Ring, type Side, type Tube, nthName } from './figure';
import { type HeadHair, CRANIUM, HEAD_HALF_HEIGHT, HEAD_HALF_WIDTH, SKULL, makeFace, makeHead } from './head';
import { WING_OUTLINE, sampleTube } from './shapes';
import { ringAt, smoothRings } from './torso';
import { refork, splitTorsos } from './torsos';
import { applyOverrides } from './tweak';
import { wigOf } from './wig';
import {
  type Quat,
  type V3,
  Q_ID,
  UP,
  add,
  cross,
  dot,
  len,
  lerp,
  madd,
  mul,
  norm,
  quatBetween,
  quatEuler,
  rotate,
  sub,
} from './vec';

/** 每多一排手臂或胸，胸腔加长这么多 */
export const GAP = 0.17;
const SHOULDER_Y = 1.42;
const CHEST_TOP = 1.3;
const NECK_LEN = 0.085;
const NECK_TO_HEAD = 0.1;
/** 脖子略微前倾 */
const NECK_LEAN = 0.06;
/** 多个头时：最外面的脖子根离肩膀外沿至少多远 */
const NECK_ROOM = 0.07;
const HIP_Y = 0.9;
export const DEG = Math.PI / 180;
const O: V3 = [0, 0, 0];
const DOWN: V3 = [0, -1, 0];
export const SIDES = [1, -1] as const;
export type LR = (typeof SIDES)[number];

export const pad = (n: number) => String(n).padStart(2, '0');
export const tag = (side: number) => (side > 0 ? 'L' : 'R');

export const ball = (name: string, r: number, center: V3): Prim => ({ kind: 'ellipsoid', name, center, radii: [r, r, r] });
export const blob = (name: string, radii: V3, center: V3, quat?: Quat): Prim =>
  quat ? { kind: 'ellipsoid', name, center, radii, quat } : { kind: 'ellipsoid', name, center, radii };
/** 圆滑地融进同类部件的一团体块（臀、小腿肚、脚跟） */
export const mass = (name: string, radii: V3, center: V3, soft: number): Prim => ({ kind: 'ellipsoid', name, center, radii, soft });

/**
 * 屁股缝：两瓣屁股中间往里挖掉的一道（见 Mass.cut），按体格 1 的人台量的，米。
 * half 缝的半宽、tall 半高、deep 往里的半深；drop 比瓣的中心低多少，inset 比瓣最靠后的那一点往里多少；
 * tilt 绕左右的轴转多少（弧度）：上端往后仰、下端往前收进胯下；soft 缝边倒圆的半径
 */
const CLEFT = { half: 0.010, tall: 0.08, deep: 0.035, drop: 0.012, inset: 0.008, tilt: -0.32, soft: 0.02 };

/** 一瓣屁股的半径：一对腿时的样子，体格 b、胯宽 hips */
export const cheekRadii = (b: number, hips: number): V3 => [0.076 * b * (0.6 + 0.4 * hips), 0.085 * b, 0.066 * b];

/** 屁股缝：at 是缝两边那两瓣的中心（高度、前后），radii 一瓣的半径，b 体格 */
export function cleft(name: string, at: V3, radii: V3, b: number): Prim {
  return {
    kind: 'ellipsoid',
    name,
    center: [at[0], at[1] - CLEFT.drop * b, at[2] - radii[2] + CLEFT.inset * b],
    radii: [CLEFT.half * b, CLEFT.tall * b, CLEFT.deep * b],
    quat: quatEuler(CLEFT.tilt, 0, 0),
    cut: true,
    soft: CLEFT.soft * b,
  };
}

/**
 * 一副胯后面的屁股：这副胯上 count 条腿左右并排（髋关节隔 2 hx，单数时正中一条，和 lowerParts 里排腿一样），
 * 每条腿上面一瓣，相邻两条腿中间（胯下）往上一道缝。一对腿就是平常的两瓣一道缝；只有一条腿的也是两瓣一道缝。
 * center：两瓣中间那一点（瓣的中心高度、前后）；radii：一瓣的半径；spread：两头那一瓣离它里面那道缝多远（一对腿时就是离中线）；
 * soft：瓣融进胯的圆角
 */
export function buttocks(count: number, hx: number, center: V3, radii: V3, spread: number, soft: number, b: number): Prim[] {
  const at = (x: number): V3 => [center[0] + x, center[1], center[2]];
  if (count <= 2) return [mass('Glute_L', radii, at(spread), soft), mass('Glute_R', radii, at(-spread), soft), cleft('Cleft', at(0), radii, b)];
  // 髋关节从右往左（-X 到 +X），每两条中间是一道胯下
  const legs = Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * 2 * hx);
  const crotches = legs.slice(1).map((x, i) => (x + legs[i]) / 2);
  // 中间的瓣正对着腿；两头的照一对腿时那样，离它里面那道缝 spread
  const prims = legs.map((x, i) =>
    mass(`Glute_${pad(i + 1)}`, radii, at(i === 0 ? crotches[0] - spread : i === count - 1 ? crotches[count - 2] + spread : x), soft),
  );
  crotches.forEach((x, i) => prims.push(cleft(`Cleft_${pad(i + 1)}`, at(x), radii, b)));
  return prims;
}
export const cone = (name: string, a: V3, b: V3, ra: number, rb: number): Prim => ({ kind: 'cone', name, a, b, ra, rb });
const tube = (name: string, points: V3[], r0: number, r1: number, bulge: number): Tube => ({
  kind: 'tube',
  name,
  points,
  r0,
  r1,
  bulge,
});

/** 横排多胯：相邻两副胯的正中隔两副的半宽之和的这么多分之二（不到 2：稍微叠着，并成一整块） */
const ABREAST_SPAN = 1.8;

/**
 * 横排多胯：stations 是从右往左每副胯几条腿，half 是两条腿的那副胯的半宽，hx 是一副胯上两条腿的髋关节离它正中多远。
 * 返回每副胯的正中（x）、半宽（一条腿的窄一些），和几副加起来的半宽。
 * 相邻两副胯的正中隔两副的半宽之和的 ABREAST_SPAN / 2 倍（稍微叠着），并且两副里侧的那两条腿之间至少隔 2 hx
 * （和一副胯上两条腿隔得一样远：胯窄、腿粗时不然会碰上）；隔得比两副胯宽的，胯跟着放宽到挨着
 */
export function abreastSpots(stations: readonly number[], half: number, hx: number): { xs: number[]; halves: number[]; wide: number } {
  const own = stations.map((count) => (count === 1 ? half * SINGLE_HIP : half));
  /** 一副胯里侧那条腿离它正中多远 */
  const inner = stations.map((count) => (count === 1 ? 0 : hx));
  const gaps = stations.slice(1).map((_, k) => Math.max(((own[k] + own[k + 1]) / 2) * ABREAST_SPAN, inner[k] + inner[k + 1] + 2 * hx));
  const raw = [0];
  for (const gap of gaps) raw.push(raw[raw.length - 1] + gap);
  const mid = raw[raw.length - 1] / 2;
  const xs = raw.map((x) => x - mid);
  const halves = own.map((w, k) => Math.max(w, ...[gaps[k - 1] ?? 0, gaps[k] ?? 0].map((g) => g * 0.56)));
  return { xs, halves, wide: xs[xs.length - 1] + halves[halves.length - 1] };
}

/** 一节骨骼 */
export const bone = (name: string, head: V3, tail: V3, parent?: string): BoneHint =>
  parent ? { name, parent, head, tail } : { name, head, tail };
/** 一条尾巴分成几节骨骼 */
const TAIL_BONES = 5;
/**
 * 几条尾巴从尾根往两边最多散开多少（弧度）；散得最开的那条往上翘的少翘几成、往外多伸几成
 * （中间那条照旧，介于中间的照离中间多远的平方渐变）
 */
const TAIL_SPREAD = 0.95;
const TAIL_DROOP = 0.5;
const TAIL_REACH = 0.15;

/** 男女体型的差别。骨架（各关节的高度）是同一副，只是各处的宽窄厚薄不同 */
interface Build {
  /** 肩线、腋下、胸、下胸、腰、胯的半宽 */
  shoulder: number;
  armpit: number;
  chest: number;
  ribs: number;
  waist: number;
  hip: number;
  /** 胸、腰、胯的半厚 */
  chestDepth: number;
  waistDepth: number;
  hipDepth: number;
  /** 髋关节离中线的距离 */
  hipJoint: number;
  /** 臀部体块的大小倍率 */
  glute: number;
  /** 脖子根部和顶端的半径 */
  neck: [number, number];
  /** 手臂、腿的粗细倍率 */
  arm: number;
  leg: number;
  /** 胸的形状：各方向的半径倍率（女性是饱满的球，男性是扁平的胸肌），埋进胸腔多深，往下坠多少 */
  breast: V3;
  breastSink: number;
  breastDrop: number;
}

const BUILDS: Record<Gender, Build> = {
  female: {
    shoulder: 0.172,
    armpit: 0.16,
    chest: 0.154,
    ribs: 0.146,
    waist: 0.116,
    hip: 0.178,
    chestDepth: 0.108,
    waistDepth: 0.086,
    hipDepth: 0.124,
    hipJoint: 0.088,
    glute: 1,
    neck: [0.048, 0.042],
    arm: 1,
    leg: 1,
    breast: [1, 0.96, 0.92],
    breastSink: 0.3,
    breastDrop: 0.15,
  },
  // 男性：肩宽、胸厚、腰粗、胯窄，脖子和四肢更粗
  male: {
    shoulder: 0.2,
    armpit: 0.184,
    chest: 0.174,
    ribs: 0.16,
    waist: 0.138,
    hip: 0.16,
    chestDepth: 0.118,
    waistDepth: 0.098,
    hipDepth: 0.114,
    hipJoint: 0.082,
    glute: 0.8,
    neck: [0.058, 0.05],
    arm: 1.14,
    leg: 1.06,
    breast: [1.4, 0.8, 0.28],
    breastSink: 0.19,
    breastDrop: -0.15,
  },
};

/**
 * 头身比决定头相对身体放大多少：标准人形（一排手臂、双足）的身高正好是头高的 headRatio 倍。
 * 返回头的缩放倍率，以及这个标准人形在缩放到设定身高之前的高度。
 */
function headProportion(headRatio: number) {
  const ny = 1 / Math.hypot(1, NECK_LEAN);
  const neckTop = SHOULDER_Y + 0.04 + NECK_LEN * ny;
  const hs = neckTop / (2 * HEAD_HALF_HEIGHT * headRatio - NECK_TO_HEAD * ny - HEAD_HALF_HEIGHT);
  return { hs, baseHeight: neckTop + (NECK_TO_HEAD * ny + HEAD_HALF_HEIGHT) * hs };
}

/* ---------------- 四肢 ---------------- */

/** 分指时四根手指的排布：离手掌中线的距离、向两侧张开的程度、长度（食指 → 小指） */
const FINGERS = [
  { name: 'Index', offset: 0.027, splay: 0.26, length: 0.066 },
  { name: 'Middle', offset: 0.009, splay: 0.08, length: 0.074 },
  { name: 'Ring', offset: -0.009, splay: -0.1, length: 0.068 },
  { name: 'Little', offset: -0.027, splay: -0.28, length: 0.054 },
];

/**
 * 手上的尺寸都写在手自己的坐标里：沿前臂的方向（也是手指的方向）、向拇指一侧、向手心一侧。
 * fore 是前臂的方向；拇指一侧朝前，手心朝向身体。
 */
function handFrame(wrist: V3, fore: V3, side: LR) {
  const forward: V3 = [0, 0, 1];
  const flat = sub(forward, mul(fore, dot(forward, fore)));
  const thumbSide = len(flat) < 1e-6 ? UP : norm(flat);
  const palmSide = mul(cross(fore, thumbSide), side);
  /** 手上的一个点：沿手指方向 f，向拇指一侧 t，向手心一侧 n */
  const at = (f: number, t = 0, n = 0): V3 => add(add(madd(wrist, fore, f), mul(thumbSide, t)), mul(palmSide, n));
  return { thumbSide, palmSide, at };
}

/** 拇指那根圆棒的两头 */
const thumbLine = (at: (f: number, t?: number, n?: number) => V3): [V3, V3] => [at(0.028, 0.03), at(0.072, 0.068, 0.01)];

/**
 * 四根手指各自从哪到哪（食指 → 小指）。分指时就是那四根圆棒；
 * 并指时四指是连成一片的，这里给的是那一片里并排的四条线（骨骼照它们排）。
 */
function fingerLines(wrist: V3, fore: V3, side: LR, style: HandStyle): { name: string; a: V3; b: V3 }[] {
  const { thumbSide, palmSide, at } = handFrame(wrist, fore, side);
  return FINGERS.map((f) => {
    if (style === 'mitten') {
      const edge = Math.abs(f.offset) / 0.027;
      return { name: f.name, a: at(0.092, f.offset), b: at(0.166 - edge * 0.014, f.offset * 0.9, 0.01) };
    }
    const base = at(0.094, f.offset);
    const dir = norm(add(add(fore, mul(thumbSide, f.splay)), mul(palmSide, 0.12)));
    return { name: f.name, a: base, b: madd(base, dir, f.length) };
  });
}

/** 分指的手从手腕到中指指尖有多长：现成的那只手照这个长度放大 */
const HAND_REACH = 0.172;

/**
 * 分指的手是现成的网格（见 anime/hand.ts）：摆到手腕上，手指顺着前臂，拇指一侧朝前、手心朝着身体。
 * 手臂粗了手也跟着大一点。返回的是网格自己坐标里的点 → 手臂这个部件里的点。
 */
function handPlace(wrist: V3, fore: V3, side: LR, r: number): Pick<Graft, 'matrix' | 'offset'> {
  const { thumbSide, palmSide } = handFrame(wrist, fore, side);
  const s = (HAND_REACH / HAND_LENGTH) * (1 + 0.3 * (r - 1));
  // 网格里的三个方向：沿前臂、朝拇指一侧（模型的正前方去掉沿前臂的那一点）、朝手心（朝下）
  const f = norm(sub(HAND_WRIST, HAND_ELBOW));
  const t = norm(sub([0, 0, 1], mul(f, f[2])));
  const n = cross(f, t);
  const matrix = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Graft['matrix'];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) matrix[i * 3 + j] = s * (fore[i] * f[j] + thumbSide[i] * t[j] + palmSide[i] * n[j]);
  const at = (p: V3): V3 => [
    matrix[0] * p[0] + matrix[1] * p[1] + matrix[2] * p[2],
    matrix[3] * p[0] + matrix[4] * p[1] + matrix[5] * p[2],
    matrix[6] * p[0] + matrix[7] * p[1] + matrix[8] * p[2],
  ];
  return { matrix, offset: sub(wrist, at(HAND_WRIST)) };
}

/** 手：手掌 + 拇指，再加一整片并拢的四指（手套形）或者四根分开的手指 */
function handPrims(wrist: V3, fore: V3, side: LR, r: number, style: HandStyle): Prim[] {
  const { at } = handFrame(wrist, fore, side);
  // 手掌是三根并排的圆棒拼成的一块厚板（边缘是圆的，不会薄到在体素网格上碎掉）
  const prims: Prim[] = [-1, 0, 1].map((k) =>
    cone(`Palm_${k + 2}`, at(0.014, k * 0.019), at(0.092, k * 0.024), 0.017 * r, 0.0145 * r),
  );
  const [thumbA, thumbB] = thumbLine(at);
  prims.push(cone('Thumb', thumbA, thumbB, 0.0135, 0.0105));
  if (style === 'mitten') {
    // 并拢的四指：接着手掌往前伸的一片，略微朝手心弯。两侧的圆棒圆滑地融进中间那根，连成一整片
    for (const k of [0, -1, 1]) {
      const finger = cone(`Fingers_${k + 2}`, at(0.092, k * 0.022), at(0.16 - Math.abs(k) * 0.012, k * 0.02, 0.01), 0.0135 * r, 0.0115 * r);
      prims.push(k && finger.kind === 'cone' ? { ...finger, soft: 0.016 } : finger);
    }
  } else {
    for (const f of fingerLines(wrist, fore, side, style)) prims.push(cone(f.name, f.a, f.b, 0.0088, 0.0072));
  }
  return prims;
}

/** 一根手指的三节各占全长的多少（从指根数起） */
const FINGER_SPANS = [0, 0.42, 0.72, 1];
/** 拇指的三节：第一节埋在手掌里（掌骨），后两节露在外面 */
const THUMB_SPANS = [0, 0.36, 0.7, 1];

/**
 * 手指的骨骼：拇指和四指各三节，名字是 Thumb1_L、Index2_R.002 这样的，都接在手那根骨骼上。
 * name 把「Index1」换成这条手臂上的全名。
 */
function fingerBones(lines: { name: string; a: V3; b: V3 }[], thumb: [V3, V3], hand: string, name: (base: string) => string): BoneHint[] {
  const out: BoneHint[] = [];
  const chain = (finger: string, a: V3, b: V3, spans: number[]) => {
    for (let k = 0; k < 3; k++) {
      out.push({
        ...bone(name(`${finger}${k + 1}`), lerp(a, b, spans[k]), lerp(a, b, spans[k + 1]), k ? name(`${finger}${k}`) : hand),
        strand: finger,
      });
    }
  };
  chain('Thumb', thumb[0], thumb[1], THUMB_SPANS);
  for (const f of lines) chain(f.name, f.a, f.b, FINGER_SPANS);
  return out;
}

/** 上臂的方向：theta 是离开「垂直向下」的角度，phi 是前后摆开的角度 */
export function armDirection(side: LR, theta: number, phi: number): V3 {
  return norm([
    side * Math.sin(theta) * Math.cos(phi),
    -Math.cos(theta),
    Math.sin(theta) * Math.sin(phi) + 0.15 * Math.sin(phi),
  ]);
}

/**
 * 手臂的关节，肩关节在局部原点，上臂朝 dir 伸出去。
 * straight：T-pose，整条手臂伸直；否则前臂略微向前、向上弯。
 */
function armJoints(dir: V3, straight: boolean) {
  const elbow = mul(dir, 0.28);
  const fore = straight ? dir : norm(add(dir, [0, 0.12, 0.32]));
  return { elbow, fore, wrist: madd(elbow, fore, 0.25) };
}

/** 一条手臂；r 是粗细倍率。分指的手不在这里：它是接上去的现成网格（armGrafts） */
function armPrims(side: LR, dir: V3, r: number, hands: HandStyle, straight: boolean): Prim[] {
  const { elbow, fore, wrist } = armJoints(dir, straight);
  return [
    ball('Shoulder', 0.052 * r, O),
    cone('UpperArm', O, elbow, 0.044 * r, 0.036 * r),
    cone('Forearm', elbow, wrist, 0.036 * r, 0.025 * r),
    ...(hands === 'fingers' ? [] : handPrims(wrist, fore, side, r, hands)),
  ];
}

/** 分指时接在手腕上的那只现成的手 */
function armGrafts(side: LR, dir: V3, r: number, straight: boolean, index: number): Graft[] {
  const { fore, wrist } = armJoints(dir, straight);
  const name = (base: string) => nthName(`${base}_${tag(side)}`, index);
  return [{ ...handGraft(name), ...handPlace(wrist, fore, side, r) }];
}

/**
 * 一条手臂的骨骼：锁骨（从脊柱旁边伸到肩关节）、上臂、前臂、手，再加五根手指各三节。
 * index 是第几对手臂（从 0 数）；inward 是肩关节离躯干中线多远；parent 是锁骨接在躯干的哪节骨骼上。
 */
function armBones(side: LR, dir: V3, straight: boolean, index: number, inward: number, parent: string, hands: HandStyle, r: number): BoneHint[] {
  const { elbow, fore, wrist } = armJoints(dir, straight);
  const name = (base: string) => nthName(`${base}_${tag(side)}`, index);
  const arm = [
    bone(name('Shoulder'), [-side * Math.max(inward - 0.025, 0.02), 0.012, 0], O, parent),
    bone(name('UpperArm'), O, elbow, name('Shoulder')),
    bone(name('LowerArm'), elbow, wrist, name('UpperArm')),
  ];
  if (hands !== 'fingers') {
    return [
      ...arm,
      bone(name('Hand'), wrist, madd(wrist, fore, 0.095), name('LowerArm')),
      ...fingerBones(fingerLines(wrist, fore, side, hands), thumbLine(handFrame(wrist, fore, side).at), name('Hand'), name),
    ];
  }
  // 分指的手是现成的网格：手指的关节就用它自带的，摆到同一个位置上
  const { matrix, offset } = handPlace(wrist, fore, side, r);
  const at = (p: V3): V3 => [
    offset[0] + matrix[0] * p[0] + matrix[1] * p[1] + matrix[2] * p[2],
    offset[1] + matrix[3] * p[0] + matrix[4] * p[1] + matrix[5] * p[2],
    offset[2] + matrix[6] * p[0] + matrix[7] * p[1] + matrix[8] * p[2],
  ];
  return [
    ...arm,
    // 手这根骨骼还是顺着前臂（和并指的一样）：平举、手心朝下就是它静止的样子，姿势的记法里手掌从这里算起
    bone(name('Hand'), wrist, madd(wrist, fore, 0.095), name('LowerArm')),
    ...FINGER_JOINTS.flatMap(({ finger, joints }) =>
      [0, 1, 2].map((k) => ({
        ...bone(name(`${finger}${k + 1}`), at(joints[k]), at(joints[k + 1]), k ? name(`${finger}${k}`) : name('Hand')),
        strand: finger,
      })),
    ),
  ];
}

/**
 * 一条腿的三节骨骼（大腿、小腿、脚），再加上可选的脚趾。index 是第几对腿（从 0 数）。
 * 长在中线上的腿（side 为 0）不分左右：UpperLeg、UpperLeg.002 …，index 是第几条中线上的腿
 */
export function legBones(side: Side, index: number, parent: string, joints: V3[]): BoneHint[] {
  const names = ['UpperLeg', 'LowerLeg', 'Foot', 'Toes'].map((base) => nthName(side ? `${base}_${tag(side)}` : base, index));
  return joints.slice(1).map((tail, j) => bone(names[j], joints[j], tail, j ? names[j - 1] : parent));
}

/** 人腿的关节：髋（局部原点）、膝、踝。左右腿往里并一点，中线上的腿（side 为 0）笔直 */
/**
 * 人腿的膝盖、脚踝（髋关节在局部原点）。out：腿往外斜（胯部聚拢时散开），脚踝往外多挪这么多，膝盖照高度挪一部分
 */
function humanLegJoints(side: Side, hx: number, out = 0) {
  const lean = (y: number) => (side * out * y) / -0.815;
  // 加 0 是为了把 -0 变成 0
  const knee: V3 = [-side * hx * 0.15 + lean(-0.41) + 0, -0.41, 0.02];
  const ankle: V3 = [-side * hx * 0.2 + lean(-0.815) + 0, -0.815, -0.01];
  return { knee, ankle };
}

/** 人腿的骨骼：大腿、小腿、脚（踝 → 脚掌）、脚趾 */
function humanLegBones(side: Side, hx: number, index: number, parent: string, out = 0): BoneHint[] {
  const { knee, ankle } = humanLegJoints(side, hx, out);
  const sole = 0.025 - HIP_Y;
  return legBones(side, index, parent, [O, knee, ankle, [ankle[0], sole, ankle[2] + 0.1], [ankle[0], sole, ankle[2] + 0.175]]);
}

/** 一条人腿，髋关节在局部原点；hx 是髋关节离中线的距离，out 是往外斜多少（见 humanLegJoints） */
function humanLegPrims(side: Side, hx: number, r: number, out = 0): Prim[] {
  const { knee, ankle } = humanLegJoints(side, hx, out);
  // 脚踝：腿再粗也不粗过脚踝离地的高度（不然会戳到地面以下）
  const ankleR = Math.min(0.033 * r, ANKLE_MAX);
  return [
    cone('Thigh', O, knee, 0.085 * r, 0.052 * r),
    cone('Shin', knee, ankle, 0.048 * r, ankleR),
    // 小腿肚：膝盖往下三分之一处，偏后
    mass('Calf', [0.046 * r, 0.1, 0.05 * r], add(lerp(knee, ankle, 0.3), [0, 0, -0.016]), 0.02),
    blob('Foot', [0.04 * r, 0.03, 0.115], [ankle[0], 0.03 - HIP_Y, ankle[2] + 0.07]),
    mass('Heel', [0.03 * r, 0.03, 0.032], [ankle[0], 0.032 - HIP_Y, ankle[2] - 0.012], 0.012),
    // 腿很细时小腿的下端够不着脚背：接一小截下去
    ...(ankleR < 0.03 ? [cone('Ankle', ankle, [ankle[0], 0.045 - HIP_Y, ankle[2]], ankleR, ankleR * 0.9)] : []),
  ];
}

/** 人腿脚踝最粗多少（脚踝离地 8.5 厘米） */
const ANKLE_MAX = 0.08;

/** 人马：马腿的髋关节离地多高；马身的正中离地多高 */
const HOOF_HIP = 0.9;
export const TAUR_LEVEL = 0.95;
/** 马腿从髋关节往下这么长的一截（到膝盖、飞节）是长在马身里的 */
const HOOF_EMBED = 0.44;
/** 人腿人马：前后两副胯隔多远（横着的那截腰有多长）；那截腰比胯的正中高多少（人弯下腰，后腰比胯高一点） */
export const HUMANTAUR_SPAN = 0.46;
/**
 * 人腿胯部聚拢：和前后串联一样一副胯接一副胯，只是贴得更紧（隔这么远，后面几副的腿根藏在前一副的屁股底下）；
 * 腿往下往外散开：往后每多一副，脚踝多往外挪这么多，正面看是一层层的扇面。两样都按腿的粗细（LowerOptions.legThick）放大，
 * 粗腿也是到膝盖往下就分开
 */
export const GATHER_SPAN = 0.08;
export const GATHER_SPREAD = 0.17;
/** 胯部聚拢的腿之间，离根部这么远（到膝盖）以内挤在一起不算穿模（见 Part.siblingFree） */
const GATHER_LEG_FREE = 0.42;
const HUMANTAUR_RISE = 0.045;
/** 一副胯上只有一条腿时，胯收窄到这么多 */
export const SINGLE_HIP = 0.78;

/** 马腿的关节：髋（局部原点）、膝（后腿是飞节，往后突）、球节、蹄 */
export function hoofLegJoints(side: LR, front: boolean, b: number) {
  const knee: V3 = [side * 0.005 * b, front ? -0.43 : -0.405, front ? 0.02 : -0.085];
  const fetlock: V3 = [side * 0.005 * b, -0.785, front ? 0.005 : -0.03];
  const hoof: V3 = [fetlock[0], 0.045 - HOOF_HIP, fetlock[2] + 0.03];
  return { knee, fetlock, hoof };
}

/**
 * 一条马腿，髋关节在局部原点。上粗下细：上半截是带肌肉的前臂 / 大腿，膝盖以下是一根细的管骨，
 * 球节往下斜着一小段系部接到蹄子上。前腿是直的；后腿的大腿往前鼓、飞节往后突，侧面看是一道折线。
 */
export function hoofLegPrims(side: LR, front: boolean, b: number, r: number): Prim[] {
  const { knee, fetlock, hoof } = hoofLegJoints(side, front, b);
  // 后腿的膝关节（在肚子下沿、靠前）：大腿从髋斜着往前伸到这里，小腿再斜着往后收到飞节
  const stifle: V3 = [knee[0], -0.19, 0.07];
  const upper: Prim[] = front
    ? [
        cone('Upper', O, knee, 0.08 * r, 0.043 * r),
        // 前臂的肌肉：靠上、偏外
        mass('Forearm', [0.056 * r, 0.14, 0.068 * r], [side * 0.012 * r, -0.18, 0.004], 0.03),
      ]
    : [cone('Thigh', O, stifle, 0.108 * r, 0.072 * r), cone('Gaskin', stifle, knee, 0.066 * r, 0.041 * r)];
  /** 地面在这条腿自己的坐标里有多高 */
  const floor = hoof[1] - 0.045;
  return [
    ...upper,
    ball(front ? 'Knee' : 'Hock', 0.044 * r, knee),
    cone('Cannon', knee, fetlock, 0.036 * r, 0.031 * r),
    ball('Fetlock', 0.038 * r, fetlock),
    // 系部：球节和蹄子之间斜着的一小段
    cone('Pastern', fetlock, [hoof[0], hoof[1] + 0.03, hoof[2]], 0.032 * r, 0.035 * r),
    // 蹄子：上窄下宽的一口钟，底下齐着地面削平
    cone('Hoof', [hoof[0], hoof[1] + 0.03, hoof[2]], [hoof[0], hoof[1] - 0.012, hoof[2] + 0.01], 0.037 * r, 0.054 * r),
    { kind: 'ellipsoid', name: 'Ground', center: [hoof[0], floor - 0.6, hoof[2]], radii: [1.5, 0.6, 1.5], cut: true, soft: 0.004 },
  ];
}

/**
 * 蛛腿的关节：基节在局部原点，朝水平方向 angle 伸出去（0 是正侧面，正值偏前）。
 * rise 是膝盖比基节高多少。
 */
export function spiderLegJoints(side: LR, angle: number, rise: number) {
  const u: V3 = [side * Math.cos(angle), 0, Math.sin(angle)];
  const knee = add(mul(u, 0.36), [0, rise, 0]);
  const tip: V3 = [u[0] * 0.88, 0.02 - 0.98, u[2] * 0.88];
  const mid = add(madd(lerp(knee, tip, 0.45), u, 0.06), [0, 0.1, 0]);
  return { knee, mid, tip };
}

/** 蛛形下身第 k 对腿的根在哪（左边那条，世界坐标）、朝哪个方向伸（弧度，正的往前） */
function spiderLegRoot(k: number, pairs: number, b: number): { at: V3; angle: number } {
  const t = pairs > 1 ? k / (pairs - 1) : 0;
  return { at: [0.14 * b, 0.98, 0.2 - t * 0.38], angle: (55 - t * 95) * DEG };
}

/**
 * 蛛形下身时，手臂自然下垂最少要离开「垂直向下」多少度：蛛腿的膝盖在两侧高高拱起，比胯高出一截，
 * 手臂要从它们上面过去。joint 是肩关节（躯干自己的坐标，上半身抬高了 lift），clearance 是手臂自己的粗细加一点余量，
 * limb 是蛛腿的粗细倍率。前后离手臂远的膝盖挡不着，不算
 */
export function spiderFloor(joint: V3, pairs: number, b: number, limb: number, lift: V3, clearance: number): number {
  let floor = 45;
  for (let k = 0; k < pairs; k++) {
    const { at, angle } = spiderLegRoot(k, pairs, b);
    const knee = add(add(at, spiderLegJoints(1, angle, 0.18).knee), [-lift[0], -lift[1], -lift[2]]);
    const r = 0.045 * limb;
    if (Math.abs(knee[2] - joint[2]) > 0.15 + r) continue;
    const dx = knee[0] - joint[0];
    const dy = joint[1] - (knee[1] + r + clearance);
    if (dx > 0) floor = Math.max(floor, Math.min(85, Math.atan2(dx, dy) / DEG));
  }
  return floor;
}

/** 一条蛛腿 */
export function spiderLegPrims(side: LR, angle: number, rise: number, r: number): Prim[] {
  const { knee, mid, tip } = spiderLegJoints(side, angle, rise);
  return [
    cone('Femur', O, knee, 0.056 * r, 0.04 * r),
    // 关节略微鼓出来一点，腿才是一节一节的
    ball('Knee', 0.045 * r, knee),
    cone('Tibia', knee, mid, 0.04 * r, 0.03 * r),
    ball('Joint', 0.034 * r, mid),
    cone('Tarsus', mid, tip, 0.03 * r, 0.011),
    ball('Tip', 0.011, tip),
  ];
}

/* ---------------- 整个人 ---------------- */

/** 六翼：上面一对上扬、中间平展、下面下垂 */
export const WING_ELEVATION = [[0.35], [0.5, -0.1], [0.75, 0.2, -0.35]];
/** 翼尖：轮廓上离翼根最远的那个点 */
const WING_TIP = WING_OUTLINE.reduce((far, p) => (p[0] > far[0] ? p : far));

/** 人马 / 蛛形：上半身抬高、前移多少，坐到兽身的前端（lowerParts 摆出来的兽身是配着它的） */
export function beastLift(form: LegForm): V3 {
  return form === 'taur' ? [0, 0.14, 0.14] : form === 'spider' ? [0, 0.3, 0.06] : [0, 0, 0];
}

/** 摆位，再套上手动微调：界面、网格、导出用的都是这个结果 */
export function buildFigure(spec: BodySpec): Figure {
  const figure = layoutFigure(spec);
  // 手动挪过、转过的上半身：从胯上分出去的那一段跟着改（见 torsos.ts）
  const fitted = refork(applyOverrides(figure, limbLength(figure, spec)));
  if (Math.abs(spec.shape.legLength - 1) < 1e-6) return fitted;
  // 腿拉长、缩短以后身高还是设定的那么高（和成品角色一样）：整个人照比例缩放，身体、头跟着变小、变大
  const plain = applyOverrides(figure, spec.overrides);
  const k = plain.metrics.height / fitted.metrics.height;
  const headHeight = fitted.metrics.headHeight * k;
  return {
    ...fitted,
    scale: fitted.scale * k,
    metrics: { ...fitted.metrics, height: plain.metrics.height, headHeight, headRatio: plain.metrics.height / headHeight },
  };
}

/**
 * 「手臂长短」「腿长短」两个滑块：当成每条手臂、每条腿都沿着自己的方向拉长、缩短一点的手动微调，和人手动调的那一份叠在一起
 * （大小相乘）。拉伸、手只跟着手腕挪、脚还踩在地上，都照手动微调的办法来（见 tweak.ts）
 */
function limbLength(figure: Figure, spec: BodySpec): Record<string, PartOverride> {
  const arm = spec.shape.armLength;
  const leg = spec.shape.legLength;
  if (Math.abs(arm - 1) < 1e-6 && Math.abs(leg - 1) < 1e-6) return spec.overrides;
  const out: Record<string, PartOverride> = { ...spec.overrides };
  for (const part of figure.parts) {
    const k = part.type === 'arm' ? arm : part.type === 'leg' ? leg : 1;
    if (Math.abs(k - 1) < 1e-6) continue;
    const own = out[part.name];
    const [x, y, z] = own?.scale ?? [1, 1, 1];
    out[part.name] = { ...own, scale: [x, y * k, z] };
  }
  return out;
}

/** 好几个上半身时胯再宽多少倍（二次元素体两个上半身直立并排的乘 UPRIGHT_HIPS；并成一个宽躯干的照 D 摆、不乘） */
export const MULTI_HIPS = 1.1;
/**
 * 二次元素体两个上半身直立并排站在一副胯、一对腿上（见 torsos.ts 的 UPRIGHT_OVERLAP）时胯再宽多少倍：两个腰并排已经很宽，
 * 照 MULTI_HIPS 的话胯几乎不比腰宽，整个躯干一个长方块；照参考图 B-3 要宽出一截
 */
export const UPRIGHT_HIPS = 1.25;

/** 只按部件数量、排布和体型自动摆位，不管手动微调 */
export function layoutFigure(given: BodySpec): Figure {
  // 好几个上半身站在一副胯上：胯比一个人的宽一点（画里都是这样画的），在「胯宽」滑块的基础上再乘 MULTI_HIPS（直立并排的乘 UPRIGHT_HIPS）
  const plan = legPlan(given);
  const anime = given.bodyStyle === 'anime' && animeReady();
  const upright = anime && given.counts.torsos === 2 && plan.form === 'biped' && plan.total === 2;
  // 二次元素体两个上半身（每个一个头）、横排两副胯：和 D（一个上半身两个头）长一样（并成一个宽躯干，胸按一个人算），
  // 照 D 摆，再由 torsos.ts 切成两个上半身（见 splitWide）
  const wide = anime && given.counts.torsos === 2 && given.counts.heads === 1 && given.headLayout !== 'faces' && plan.form === 'abreast' && plan.stations.length === 2 && plan.stations.every((n) => n === 2);
  if (wide) return splitTorsos(layoutAnime({ ...given, counts: { ...given.counts, torsos: 1, heads: 2 } }), 2);
  const spec = given.counts.torsos > 1 ? { ...given, shape: { ...given.shape, hips: given.shape.hips * (upright ? UPRIGHT_HIPS : MULTI_HIPS) } } : given;
  // 二次元少女素体的数据还没载入时，先按白模摆（数据到了以后界面会重新生成一遍）
  const one = anime ? layoutAnime(spec) : layoutMannequin(spec);
  // 好几个上半身：照一个摆好，再从腰那里切开、复制
  return splitTorsos(one, spec.counts.torsos);
}

/** 白模：自己用基本体捏出来的人台 */
function layoutMannequin(spec: BodySpec): Figure {
  const c = spec.counts;
  const sh = { ...spec.shape, bust: Math.min(spec.shape.bust, BUST_MAX_OTHER) };
  const b = sh.build;
  const g = BUILDS[spec.gender];
  const limb = b * sh.limbs;
  const armR = limb * g.arm;
  const legR = limb * g.leg;
  const tPose = spec.pose === 'T';
  const plan = legPlan(spec);
  const form = plan.form;
  const onBeast = form === 'taur' || form === 'spider';
  /** 胯（躯干最下面那一截）上并排着几条腿 */
  const front = onBeast ? 2 : plan.stations[0];
  const parts: Part[] = [];
  const proportion = headProportion(sh.headRatio);
  const baseHeight = proportion.baseHeight;
  // 一个头上几张脸：只有一个头、一根脖子，多出来的脸长在这个头的两边和后面
  const faces = spec.headLayout === 'faces' && c.heads > 1;
  const necks = faces ? 1 : c.heads;
  // 头多了每个头小一圈（见 bodyPlan.ts）
  const hs = proportion.hs * headShrink(necks);

  /* ---- 躯干：一摞椭圆截面，从胯底到脖子根 ---- */
  const stacked = spec.armLayout === 'stack';
  const rows = Math.max(stacked ? c.armPairs : 1, c.chestPairs, 1);
  const extra = GAP * (rows - 1);
  const shoulderY = SHOULDER_Y + extra;
  const chestTop = CHEST_TOP + extra;
  // 多个头：凑成一簇，脸贴着脸；脖子根并排挤在肩膀中间，肩膀基本不用加宽（见 bodyPlan.ts）
  const headSize = { width: 2 * HEAD_HALF_WIDTH * hs, neck: NECK_LEN, rise: NECK_TO_HEAD * hs };
  const nativeShoulder = g.shoulder * sh.shoulders * b;
  const shoulderW = shoulderSpan(necks, headSize.width, nativeShoulder, NECK_ROOM);
  const headPlaces = headCluster(necks, headSize, shoulderW - NECK_ROOM);
  /** 最外面的脖子根离中线多远、往后退了多少 */
  const neckSpread = Math.abs(headPlaces[0].x);
  const neckBack = -headPlaces[0].z;
  // 髋关节离中线的距离；腿很粗时往外让，免得两条大腿挤进对方里面
  const hx = Math.max(g.hipJoint * sh.hips, 0.064 * legR);
  // 胯要宽到能盖住最外侧的髋关节（腿左右并排、一副胯上好几条时会很宽）；只有一条腿时收窄
  const hipW = (front === 1 ? SINGLE_HIP : 1) * Math.max(g.hip * sh.hips * b, hx * Math.max(1, front - 1) + 0.07 * legR);

  const keys: Ring[] = [];
  if (onBeast) {
    // 坐在兽身上：没有骨盆，从腰往下直接插进兽身里
    keys.push(
      { y: 0.87, w: 0.11 * b, d: 0.09 * b, z: 0 },
      { y: 0.95, w: 0.13 * b, d: 0.1 * b, z: 0 },
      { y: 1.03, w: 0.134 * b, d: 0.1 * b, z: 0 },
    );
  } else {
    keys.push(
      { y: 0.83, w: 0.055 * sh.hips, d: 0.06, z: -0.005 },
      { y: 0.875, w: hipW * 0.76, d: g.hipDepth * 0.85 * b, z: -0.012 },
      // 胯最宽处，臀部向后
      { y: 0.935, w: hipW, d: g.hipDepth * b, z: -0.02 },
      // 从胯往上一路收到腰，中间不能比胯还宽
      { y: 1.0, w: hipW * 0.96, d: g.hipDepth * 0.92 * b, z: -0.014 },
      { y: 1.06, w: hipW * 0.346 + g.waist * b * sh.waist * 0.64, d: (g.hipDepth * 0.92 + g.waistDepth) * 0.49 * b, z: -0.004 },
    );
  }
  const midRibs = (g.ribs + g.chest) / 2;
  keys.push(
    // 腰最细处，后腰向前凹
    { y: 1.115, w: g.waist * b * sh.waist, d: g.waistDepth * b * (0.6 + 0.4 * sh.waist), z: 0.004 },
    { y: 1.18, w: (g.waist + g.ribs) * 0.49 * b * (0.7 + 0.3 * sh.waist), d: (g.waistDepth + 0.006) * b, z: 0.006 },
    { y: 1.245, w: g.ribs * b, d: (g.chestDepth - 0.006) * b, z: 0.004 },
  );
  // 多排手臂或胸：胸腔每多一排加长一截。这一截上要是长着手臂，就宽到肩膀那么宽，那排手臂才有自己的一副肩膀
  for (let k = 1; k < rows; k++) {
    const armed = stacked && rows - k < c.armPairs;
    keys.push({ y: 1.245 + GAP * k, w: armed ? g.armpit * b * sh.shoulders : midRibs * b, d: (g.chestDepth - 0.003) * b, z: 0.004 });
  }
  keys.push(
    { y: chestTop, w: g.chest * b, d: g.chestDepth * b, z: 0 },
    { y: shoulderY - 0.055, w: g.armpit * b * sh.shoulders + (shoulderW - nativeShoulder) * 0.6, d: (g.chestDepth - 0.006) * b, z: -0.006 },
    // 肩线；头很多的时候肩膀才会稍微宽一点
    { y: shoulderY, w: shoulderW, d: (g.chestDepth - 0.024) * b, z: -0.014 },
    // 脖子根那一片：多个头时几根脖子并排挤在这里，跟着宽一点、厚一点
    { y: shoulderY + 0.035, w: Math.max(0.105, neckSpread * 0.8 + 0.075), d: 0.064 + neckBack / 2, z: -0.016 - neckBack / 2 },
    { y: shoulderY + 0.062, w: neckSpread * 0.8 + 0.05, d: 0.05 + neckBack / 2, z: -0.013 - neckBack / 2 },
  );
  const rings = smoothRings(keys);
  const at = (y: number) => ringAt(rings, y);

  // 人马 / 蛛形：上半身抬高、前移，坐在兽身的前端
  const lift = beastLift(form);
  const TORSO = 'Torso';
  const torso: Prim[] = [{ kind: 'loft', name: 'Torso', rings }];
  if (necks > 1) {
    // 几根脖子的根并在一起：垫一团软的把它们连成一片，像斜方肌那样，不是一根根单独戳在肩膀上
    torso.push(mass('NeckWeb', [neckSpread + 0.03, 0.04, 0.042 + neckBack / 2], [0, shoulderY + 0.058, -0.014 - neckBack / 2], 0.03));
  }
  // 屁股：人腿人马的臀长在最后那副胯上（见 lowerParts）。左右并排时躯干的胯跟着加宽了，每条腿上面一瓣，胯下往上各一道缝。
  // 前后串联、胯部聚拢的这两瓣埋在后面接着的胯里，不挖缝：缝开在最后那副胯上。
  // 横排多胯每副胯各有自己的屁股（见 lowerParts），躯干自己的这两瓣不要（不然夹在两副胯中间，背后正中一块平板）
  if (!onBeast && form !== 'humantaur' && form !== 'abreast') {
    const radii = mul(cheekRadii(b, sh.hips), g.glute);
    const at: V3 = [0, 0.925, -(0.134 - 0.066 * g.glute) * b];
    const seat = buttocks(form === 'row' ? front : 2, hx, at, radii, 0.06 * sh.hips, 0.03, b);
    torso.push(...(form === 'biped' || form === 'row' ? seat : seat.filter((p) => !('cut' in p && p.cut))));
  }
  // 脊柱：Hips → Spine → Chest → …… → UpperChest，沿躯干的中线一节一节往上。
  // 多排手臂或胸让胸腔加长时，每多一排在 Chest 和 UpperChest 之间多一节（Chest.002 最靠上，带着第二排手臂）
  const upperChestY = chestTop - 0.02;
  const levels: [name: string, y: number][] = [
    ['Hips', onBeast ? 0.95 : 0.93],
    ['Spine', onBeast ? 1.04 : 1.03],
    ['Chest', 1.17],
  ];
  for (let i = rows - 1; i >= 1; i--) levels.push([nthName('Chest', i), upperChestY - i * GAP]);
  levels.push(['UpperChest', upperChestY]);
  const spineAt = (y: number): V3 => [0, y, at(y).z];
  const spine = levels.map(([name, y], j) =>
    bone(name, spineAt(y), spineAt(j + 1 < levels.length ? levels[j + 1][1] : shoulderY + 0.04), j ? levels[j - 1][0] : undefined),
  );
  parts.push({
    name: TORSO,
    type: 'torso',
    side: 0,
    pos: lift,
    quat: Q_ID,
    // 手动转动、缩放躯干时，骨盆（坐在兽身上时是腰）留在原地
    pivot: [0, onBeast ? 0.95 : 0.93, 0],
    material: 'clay',
    prims: torso,
    bones: spine,
  });

  /* ---- 脖子和头：多头时头凑成一簇，脖子从肩膀中间斜着伸到各自的头下面 ---- */
  let crown = 0;
  /** 脖子、头都略微前倾：v 是笔直朝上时的样子 */
  const forward = (v: V3): V3 => mul(norm([v[0], v[1], v[2] + NECK_LEAN * len(v)]), len(v));
  // 脖子顶端在头自己的坐标里的位置：头的骨骼从这里开始
  const headAxis = forward(UP);
  const neckTop: V3 = [0, -headAxis[1] * NECK_TO_HEAD, -headAxis[2] * NECK_TO_HEAD];
  // 头发：每个头各戴一副，照白模的颅骨压小一点（见 wig.ts）
  const wig = wigOf(spec.hair);
  const hair: HeadHair | undefined = wig ? { spec: wig, skull: SKULL } : undefined;
  for (let k = 0; k < necks; k++) {
    const place = headPlaces[k];
    const base: V3 = [place.x, shoulderY + 0.04, -0.013 + place.z];
    const neck = forward(place.neck);
    parts.push({
      name: `Neck_${pad(k + 1)}`,
      type: 'neck',
      side: 0,
      parent: TORSO,
      pos: base,
      quat: Q_ID,
      material: 'clay',
      prims: [cone('Neck', O, neck, g.neck[0] * Math.sqrt(b), g.neck[1])],
      bones: [bone(nthName('Neck', k), O, neck, 'UpperChest')],
    });
    const headQuat = headTurn(place);
    const center = sub(add(base, neck), mul(rotate(headQuat, neckTop), hs));
    // 挨着别的头的那一侧不长人耳：夹在两个头中间只会支出一道棱。两边长着脸的时候也一样
    const beside = faces ? { left: c.heads > 2, right: c.heads > 2 } : { left: k < c.heads - 1, right: k > 0 };
    const name = `Head_${pad(k + 1)}`;
    parts.push(...makeHead(name, TORSO, center, headQuat, hs, c, spec.earShape, spec.gender, { index: k, neckTop, beside }, undefined, hair));
    if (faces) {
      // 多出来的脸：长在同一个头上，朝着两边和后面（见 bodyPlan.ts）
      faceTurns(c.heads).forEach((turn, i) => {
        if (i) parts.push(...makeFace(`Head_${pad(i + 1)}`, name, turn, CRANIUM, FACE_OUT * HEAD_HALF_WIDTH, c, spec.earShape, spec.gender, i));
      });
    }
    const top = hs * Math.hypot(HEAD_HALF_WIDTH * Math.sin(place.tilt), HEAD_HALF_HEIGHT * Math.cos(place.tilt));
    crown = Math.max(crown, lift[1] + center[1] + top);
  }

  /* ---- 手臂：肩关节贴在躯干截面的侧面 ---- */
  // 腿左右并排时胯很宽，手臂要抬高一些才不会垂进胯里
  // 横排多胯：几副胯加起来很宽，手臂照左右并排时那样往外张开一些
  const armLift = 6 * Math.max(0, (form === 'abreast' ? plan.total : front) - 2);
  /**
   * 肩部聚拢时，第 i 对手臂的肩关节在哪（左边的）：垂得最直、最贴身的最后一对在本来的肩膀上，
   * 其余的从它后面长出来，张得越开的越靠后、稍低、往里收一点（见 bodyPlan.ts）。
   * 正面看是前面一对自然下垂，后面几对一层层往外张开；前胸是干净的。
   */
  const fanJoint = (i: number): V3 => {
    const shift = fanShift(c.armPairs - 1 - i, c.armPairs);
    const y = shoulderY - 0.035 + shift[1];
    const r = at(y);
    return [r.w - 0.006 + shift[0], y, r.z - 0.004 + shift[2]];
  };
  // 肩部聚拢、自然下垂：最贴身的那一对能垂多直，要看它往下经过的地方有什么挡着（都在躯干自己的坐标里）：
  // 下面几排胸、胯（腿左右并排时很宽）、马身
  const blocks: HangBlock[] = [
    form === 'taur'
      ? { wide: 0.21 * b, level: TAUR_LEVEL - lift[1] }
      : { wide: form === 'abreast' ? abreastSpots(plan.stations, 0.162 * sh.hips * b, hx).wide : hipW + (form === 'row' ? 0.02 * legR : 0), level: 0.935 },
  ];
  for (let j = 0; j < c.chestPairs; j++) {
    const s = 0.056 * sh.bust * (1 - 0.1 * j) * Math.sqrt(b);
    blocks.push({ wide: 0.066 * b + s * (0.3 + g.breast[0]), level: chestTop - 0.02 - j * GAP });
  }
  const inner = fanJoint(c.armPairs - 1);
  const clearance = 0.04 * armR + 0.03;
  /** 肩关节在 joint 时手臂最少要张开多少度：蛛形下身要从两侧拱起的蛛腿上面过去 */
  const floorAt = (joint: V3) => (form === 'spider' ? spiderFloor(joint, plan.stations.length, b, limb, lift, clearance) : 18);
  const hang =
    stacked || tPose
      ? []
      : hangAngles(c.armPairs, Math.max(48 + armLift, form === 'spider' ? floorAt(inner) : 0), { x: inner[0], y: inner[1] }, blocks, floorAt(inner), clearance);
  // 做摆姿势用的网格时手臂先摆开再融合（见 Part.bind）
  const bindTo = bindAngles(c.armPairs, stacked, tPose);

  for (let i = 0; i < c.armPairs; i++) {
    const mid = i - (c.armPairs - 1) / 2;
    let joint: V3;
    let theta: number;
    let phi: number;
    if (stacked) {
      // 沿躯干上下排：越往下越收拢，前后错开。蛛形下身的腿在两侧高高拱起，手臂就少收拢、少前摆一些
      const y = shoulderY - 0.035 - i * GAP;
      const r = at(y);
      joint = [r.w - 0.006, y, r.z - 0.004];
      theta = (form === 'spider' ? Math.max(48 - i * 2 + armLift, floorAt(joint)) : 48 - i * 6 + armLift) * DEG;
      phi = mid * (form === 'spider' ? 0.1 : 0.2);
      // T-pose：每一排都向两侧平举
      if (tPose) {
        theta = 90 * DEG;
        phi = 0;
      }
    } else if (tPose) {
      // 肩部聚拢 + T-pose：从同一片肩膀扇形散开，扇面尽量以水平为中心上下对称；
      // 头多的时候举得低一些，免得碰到外侧的头；举得高的在后面、往后摆，放得低的在前面、往前摆
      const top = 125 - (faces ? 1 : c.heads - 1) * 8;
      const lowest = Math.max(45 + armLift, form === 'spider' ? floorAt(inner) : 0);
      const bottom = Math.max(lowest, Math.min(180 - top, top - 20 * (c.armPairs - 1)));
      joint = fanJoint(i);
      theta = (c.armPairs === 1 ? 90 : top - (i * (top - bottom)) / (c.armPairs - 1)) * DEG;
      phi = mid * 0.35;
    } else {
      // 肩部聚拢，手臂自然下垂：一对比一对垂得直、贴身，前后只错开一点（错得太开，后面那对会像往后甩）
      joint = fanJoint(i);
      theta = hang[i] * DEG;
      phi = mid * 0.18;
    }
    // 上下排的手臂各接在自己那一节胸腔上；聚拢在肩部的都接在最上面一节
    const armParent = stacked && i ? nthName('Chest', i) : 'UpperChest';
    for (const side of SIDES) {
      const dir = armDirection(side, theta, phi);
      parts.push({
        name: `Arm_${pad(i + 1)}_${tag(side)}`,
        type: 'arm',
        side,
        parent: TORSO,
        pos: [side * joint[0], joint[1], joint[2]],
        quat: Q_ID,
        // 手动调长短粗细时，「长」沿着手臂的方向
        axes: quatBetween(DOWN, dir),
        material: 'clay',
        prims: armPrims(side, dir, armR, spec.hands, tPose),
        ...(spec.hands === 'fingers' ? { grafts: armGrafts(side, dir, armR, tPose, i) } : {}),
        bones: armBones(side, dir, tPose, i, joint[0], armParent, spec.hands, armR),
        ...(bindTo[i] ? { bind: quatBetween(dir, armDirection(side, bindTo[i]!.theta, bindTo[i]!.phi)) } : {}),
      });
    }
  }

  /* ---- 胸：贴着胸腔前表面往下排，越往下越小、越往外撇 ---- */
  for (let j = 0; j < c.chestPairs; j++) {
    const y = chestTop - 0.02 - j * GAP;
    const r = at(y);
    const s = 0.056 * sh.bust * (1 - 0.1 * j) * Math.sqrt(b);
    for (const side of SIDES) {
      const x = side * (0.066 * b + s * 0.3);
      const front = r.z + r.d * Math.sqrt(Math.max(0, 1 - (x / r.w) ** 2));
      parts.push({
        name: `Chest_${pad(j + 1)}_${tag(side)}`,
        type: 'chest',
        side,
        parent: TORSO,
        pos: [x, y - s * g.breastDrop, front - s * g.breastSink],
        quat: quatEuler(0, side * (0.22 + 0.05 * j), 0),
        material: 'clay',
        prims: [blob('Breast', mul(g.breast, s), O)],
      });
    }
  }

  /* ---- 翅膀：根部在肩胛，从上往下依次张开，越往下越小 ---- */
  parts.push(
    ...wingParts(c.wingPairs, TORSO, (i, side) => {
      const y = shoulderY - 0.07 - i * 0.13;
      const r = at(y);
      return [side * 0.05, y, r.z - r.d + 0.015];
    }),
  );

  /* ---- 下半身 ---- */
  const lowerBody = lowerParts({
    form,
    stations: plan.stations,
    b,
    hips: sh.hips,
    limb,
    legThick: legR,
    hx,
    hipY: HIP_Y,
    pelvisY: 0.93,
    tailRoot: [0, 0.99, -0.11 * b],
    humanLeg: (side, pair, parent, out) => ({ prims: humanLegPrims(side, hx, legR, out), bones: humanLegBones(side, hx, pair, parent, out) }),
  });
  parts.push(...lowerBody.parts);

  /* ---- 尾巴：从尾骨扇形散开，多于三条时上下交替 ---- */
  parts.push(...tailParts(c.tails, sh, b, lowerBody.tailRoot, lowerBody.tailParent));

  /* ---- 缩放到设定身高 ---- */
  const scale = sh.height / baseHeight;
  const height = crown * scale;
  const headHeight = 2 * HEAD_HALF_HEIGHT * hs * scale;
  return { parts, scale, metrics: { height, headHeight, headRatio: height / headHeight, legForm: form } };
}

/** 挡着手臂往下垂的东西：外沿离中线多远、在多高的地方 */
export interface HangBlock {
  wide: number;
  level: number;
}

/**
 * 肩部聚拢、自然下垂时，每对手臂离开「垂直向下」多少度（从最上面一对到最下面一对）。
 * 最上面一对张得最开，和只有一对手臂时差不多；往下一对比一对垂得直、贴身。
 * 最贴身的那一对（肩关节在 joint）能垂多直，要看它往下经过的地方有什么挡着（blocks），
 * 要让开手臂自己的粗细再加一点余量（clearance）；floor 是最直也不能小于多少度
 * （蛛腿在两侧高高拱起，手臂垂不下去，只能停在腿的上方）。
 * 只有一对手臂时就是 single。
 */
export function hangAngles(
  n: number,
  single: number,
  joint: { x: number; y: number },
  blocks: HangBlock[],
  floor: number,
  clearance: number,
): number[] {
  if (n < 2) return [single];
  let inner = floor;
  for (const block of blocks) {
    // 和肩关节差不多高的东西挡不着垂下去的手臂
    if (block.level > joint.y - 0.1) continue;
    inner = Math.max(inner, Math.atan2(block.wide + clearance - joint.x, joint.y - block.level) / DEG);
  }
  const outer = Math.max(48, inner + 12 * (n - 1));
  return Array.from({ length: n }, (_, i) => outer - (i * (outer - inner)) / (n - 1));
}

/**
 * 做摆姿势用的网格时，每对手臂先摆成什么样再融合（见 Part.bind）：离开「垂直向下」多少、前后摆多少（弧度）。
 * 不用另摆的那一对是 null（本来就平举着的）。
 *
 * 都是平举：离「垂下来」和「举过头顶」一样远，往哪边摆都不用转太多；腋下是张开的，手臂不贴着躯干。
 * 聚在一个肩膀上的几对在水平面里前后排成一把扇子（肩关节本来就是从前往后排的，i = 0 在最后面）：
 * 这样它们只在肩头那一小段连着，而且每一条往上举、往下放都不用从别的手臂中间穿过去。
 * （试过一高一低错开，分得更开，但低的那条往上举要穿过两边高的那两条之间连着的皮，皮会被搅碎。）
 * 扇面往后偏：最前面那条再往前就贴上前胸了，胸口的皮会跟着它走。
 */
export function bindAngles(pairs: number, stacked: boolean, tPose: boolean): ({ theta: number; phi: number } | null)[] {
  if (stacked || pairs < 2) return Array.from({ length: pairs }, () => (tPose ? null : { theta: 90 * DEG, phi: 0 }));
  const back = pairs > 4 ? -60 : pairs > 3 ? -55 : pairs > 2 ? -45 : -30;
  const front = pairs > 4 ? 40 : pairs > 3 ? 35 : pairs > 2 ? 30 : 20;
  return Array.from({ length: pairs }, (_, i) => ({ theta: 90 * DEG, phi: (back + ((front - back) * i) / (pairs - 1)) * DEG }));
}

/** 翅膀：每对两只，上面一对上扬、下面的下垂，越往下越小。root 给出第 i 对、side 一侧的翼根位置（父部件的坐标） */
export function wingParts(pairs: number, parent: string, root: (i: number, side: LR) => V3): Part[] {
  const parts: Part[] = [];
  const elevation = WING_ELEVATION[Math.max(0, pairs - 1)];
  for (let i = 0; i < pairs; i++) {
    const size = 1 - 0.15 * i;
    for (const side of SIDES) {
      const name = `Wing_${pad(i + 1)}_${tag(side)}`;
      parts.push({
        name,
        type: 'wing',
        side,
        parent,
        pos: root(i, side),
        quat: quatEuler(0, side * 0.55, side * elevation[i]),
        material: 'wing',
        prims: [{ kind: 'wing', name: 'Wing', side, size, thickness: 0.012 }],
        // 一根骨骼，从翼根指向翼尖（停在翼尖里面一点）
        bones: [bone(name, O, [WING_TIP[0] * size * side * 0.9, WING_TIP[1] * size * 0.9, 0], 'UpperChest')],
      });
    }
  }
  return parts;
}

export interface LowerOptions {
  form: LegForm;
  /** 从前往后每一站几条腿（见 model/spec.ts 的 legPlan）：人马、蛛形每站一对 */
  stations: number[];
  /** 体格、胯宽、四肢粗细的倍率 */
  b: number;
  hips: number;
  limb: number;
  /** 人腿有多粗（倍率，缺省就是 limb）：胯部聚拢时腿调粗了散得更开 */
  legThick?: number;
  /** 髋关节离中线多远、离地多高；骨盆（串联、并排时的下身）中心有多高 */
  hx: number;
  hipY: number;
  pelvisY: number;
  /** 双足时尾根的位置 */
  tailRoot: V3;
  /** 髋关节的前后位置，缺省在正中 */
  hipZ?: number;
  /**
   * 人腿人马用：横着的那截腰的半宽、半厚，后面那副胯的半宽、半高、半厚。
   * 缺省按白模人台的体型算；别的身体（二次元素体）照自己的腰和胯给
   */
  waist?: [wide: number, thick: number];
  pelvis?: V3;
  /**
   * 现成的胯（二次元素体）：胯的宽窄改不了，腿根是切开封了口的。最前面那副胯（就是躯干）上不是正好一对腿时，
   * 在它底下垫一副胯（Pelvis_01），把两个腿根的切口包住。radii 是半宽、半高、半厚，center 是中心相对 (0, pelvisY, hipZ) 的位置。
   * 要比躯干明显大一圈：和躯干的表面贴得太近，两层表面融在一起会起一道道棱
   */
  cover?: { radii: V3; center: V3 };
  /**
   * 腿左右并排时，屁股长在加宽的这副胯上（每条腿上面一瓣，胯下往上各一道缝，见 buttocks）。
   * 二次元素体要：它的躯干没有跟着加宽；白模人台的躯干自己加宽了，屁股长在躯干上
   */
  rowSeat?: boolean;
  /**
   * 横排两副胯、两份素体并成一个宽躯干时（二次元素体，见 animeLayout.ts 的 TWIN）：两副胯就是躯干那两份自己的胯，
   * 正中各离中线这么远。不另外垫胯、屁股，腿照原位接在两副胯上
   */
  twin?: number;
  /**
   * 一条人腿（髋关节在局部原点）：side 一侧、第 pair 对，接在 parent 这节骨骼上。
   * side 为 0 是长在中线上的腿，pair 是第几条中线上的腿。
   * native：腿就在原位时（双足站立；人腿人马最前面那一对），这条腿和躯干直接取并集（见 Part.fuseAs）。
   * part：这条腿的部件另外要改的（中线上的腿转一下）。
   * out：腿往外斜（胯部聚拢时散开），脚踝往外挪这么多；膝盖、脚踝还是水平的，脚平踩在地上。中线上的腿是 0
   */
  humanLeg: (side: Side, pair: number, parent: string, out: number) => { prims: Prim[]; bones: BoneHint[]; native?: boolean; part?: Partial<Part> };
}

/**
 * 下半身：腿，以及多对腿时的兽身 / 加长的骨盆。
 * 返回这些部件，加上尾根的位置、尾巴该接在哪节骨骼上。
 */
export function lowerParts(options: LowerOptions): { parts: Part[]; tailRoot: V3; tailParent: string } {
  const { form, b, hips, limb, hx, hipY, pelvisY, humanLeg, stations } = options;
  /** 几站（几副胯；人马、蛛形是几对腿） */
  const n = stations.length;
  const parts: Part[] = [];
  /** 下身的一块：shape 是一个椭球的三个半径，或者现成的几个基本体 */
  const lower = (name: string, pos: V3, shape: V3 | Prim[], bones?: BoneHint[]) => {
    parts.push({
      name,
      type: 'lower',
      side: 0,
      pos,
      quat: Q_ID,
      material: 'clay',
      prims: typeof shape[0] === 'number' ? [blob(name, shape as V3, O)] : (shape as Prim[]),
      ...(bones?.length ? { bones } : {}),
    });
  };
  const hz = options.hipZ ?? 0;
  const leg = (pair: number, side: Side, pos: V3, prims: Prim[], bones: BoneHint[], extra?: Partial<Part>) => {
    parts.push({
      // 中线上的腿不分左右：Leg_01、Leg_02 …
      name: side ? `Leg_${pad(pair + 1)}_${tag(side)}` : `Leg_${pad(pair + 1)}`,
      type: 'leg',
      side,
      pos,
      quat: Q_ID,
      material: 'clay',
      prims,
      bones,
      ...extra,
    });
  };
  /**
   * 沿着向后延长的下身排一串骨骼：stations 是每对腿所在的位置（世界坐标），center 是下身这个部件的位置。
   * 第 k 节从第 k 对腿走到第 k + 1 对腿；第一对腿直接接在 Hips 上。
   */
  const lowerChain = (stations: V3[], center: V3): BoneHint[] =>
    stations.slice(1).map((to, k) =>
      bone(`LowerBody_${pad(k + 1)}`, sub(stations[k], center), sub(to, center), k ? `LowerBody_${pad(k)}` : 'Hips'),
    );
  /** 第 k 站的腿接在哪节骨骼上 */
  const legParent = (k: number) => (k ? `LowerBody_${pad(k)}` : 'Hips');
  // 人腿的编号：成对的从中线往外、从前往后数（Leg_01_L、Leg_02_L …），中线上的另外数（Leg_01、Leg_02 …）
  let pairs = 0;
  let middles = 0;
  /**
   * 一副胯上左右并排的 count 条人腿：髋关节在前后 z 处，相邻两条隔 2 hx，单数时正中一条（两条时就是本来那一对）。
   * 腿接在 parent 这节骨骼上；out：成对的腿往外斜多少（见 LowerOptions.humanLeg）
   */
  const humanRow = (count: number, z: number, parent: string, out = 0, x0 = 0) => {
    const odd = count % 2;
    const extra = (one: ReturnType<typeof humanLeg>): Partial<Part> => ({
      ...(one.native ? { fuseAs: 'torso' } : {}),
      ...(form === 'gather' ? { siblingFree: GATHER_LEG_FREE } : {}),
      ...one.part,
    });
    if (odd) {
      const one = humanLeg(0, middles, parent, 0);
      leg(middles++, 0, [x0, hipY, z], one.prims, one.bones, extra(one));
    }
    for (let j = 0; j < Math.floor(count / 2); j++) {
      const slot = odd ? 2 * (j + 1) : 2 * j + 1;
      for (const side of SIDES) {
        const one = humanLeg(side, pairs, parent, out);
        leg(pairs, side, [x0 + side * hx * slot, hipY, z], one.prims, one.bones, extra(one));
      }
      pairs++;
    }
  };
  /** 现成的胯上不是正好一对腿时垫的那副胯（见 LowerOptions.cover）：形状 */
  const cover = options.cover && stations[0] !== 2 ? options.cover : null;
  const coverPrim = () => blob('Pelvis_01', cover!.radii, cover!.center);
  /** 一副胯上 count 条腿时，这副胯有多宽（半宽）：base 是一对腿时的半宽 */
  const pelvisWide = (count: number, base: number) => (count === 1 ? base * SINGLE_HIP : Math.max(base, hx * (count - 1) + 0.07 * b));
  let tailRoot: V3;
  /** 尾巴接在哪节骨骼上 */
  let tailParent = 'Hips';

  if (form === 'biped') {
    if (cover) lower('LowerBody', [0, pelvisY, hz], [coverPrim()]);
    humanRow(stations[0], hz, 'Hips');
    tailRoot = options.tailRoot;
  } else if (form === 'gather') {
    // 人腿胯部聚拢：照前面那副胯的样子再垫几副，一副紧贴在前一副后面，后面几对腿的腿根藏在底下；腿往外散开。
    // 单数时最后那副胯上是正中一条，前面几对都多散开半步，正面看左右对称
    // 腿变细了不收紧：腿还是那么长，挨得太近小腿会碰上
    const thick = Math.max(1, options.legThick ?? limb);
    const span = GATHER_SPAN * thick;
    const step = GATHER_SPREAD * thick;
    const odd = stations[n - 1] === 1;
    const pelvis = options.pelvis ?? [0.162 * hips * b, 0.105 * b, 0.118 * b];
    const back = (n - 1) * span;
    const center: V3 = [0, pelvisY, hz - back / 2];
    const chain = Array.from({ length: n }, (_, k): V3 => [0, pelvisY, hz - k * span]);
    const prims = chain.slice(1).map((at, k) => blob(`Pelvis_${pad(k + 2)}`, pelvis, sub(at, center)));
    // 最后那副胯的后面露在外面：是屁股，开缝
    prims.push(...buttocks(stations[n - 1], hx, add(sub(chain[n - 1], center), [0, -0.005, -0.068 * b]), cheekRadii(b, hips), 0.06 * hips, 0.03, b));
    lower('LowerBody', center, prims, lowerChain(chain, center));
    stations.forEach((count, k) => humanRow(count, hz - k * span, legParent(k), gatherOut(k, step, -humanLegJoints(1, hx).ankle[1], odd)));
    tailRoot = [options.tailRoot[0], options.tailRoot[1], -back + options.tailRoot[2]];
    tailParent = legParent(n - 1);
  } else if (form === 'tandem') {
    // 人腿前后串联：骨盆向后延长，每对腿各占一段
    const spacing = 0.26;
    const back = (n - 1) * spacing;
    const center: V3 = [0, pelvisY, -back / 2 - 0.02];
    const chain = Array.from({ length: n }, (_, k): V3 => [0, pelvisY, -k * spacing]);
    // 每副胯上并排着几条：宽到盖得住最外边那条
    const wide = Math.max(0.165 * hips * b, ...stations.map((count) => (count > 2 ? hx * (count - 1) + 0.07 * b : 0)));
    // 最后面是屁股：两瓣（一副胯上三条以上腿时每条腿上面一瓣）稍微鼓出延长的骨盆，胯下往上开缝
    const radii = cheekRadii(b, hips);
    const rear: V3 = [0, -0.005, -(back / 2 + 0.13) - 0.02 + radii[2]];
    lower('LowerBody', center, [blob('LowerBody', [wide, 0.12 * b, back / 2 + 0.13], O), ...buttocks(stations[n - 1], hx, rear, radii, 0.06 * hips, 0.03, b)], lowerChain(chain, center));
    // 单数时最后那副胯只有正中一条
    stations.forEach((count, k) => humanRow(count, hz - k * spacing, legParent(k)));
    tailRoot = [options.tailRoot[0], options.tailRoot[1], -back + options.tailRoot[2]];
    tailParent = legParent(n - 1);
  } else if (form === 'humantaur') {
    // 人腿人马（humantaur）：像人马，但后半截不是马。身后横着一截人的腰，接着又一副人的胯和腿，
    // 像一个人弯腰九十度、上半身并进前面那个人的后腰里。最前面一对腿就是本来的腿；每多一对，往后再接一截
    const [waistW, waistD] = options.waist ?? [0.122 * b, 0.098 * b];
    const pelvis = options.pelvis ?? [0.162 * hips * b, 0.105 * b, 0.118 * b];
    const center: V3 = [0, pelvisY, hz];
    const chain = Array.from({ length: n }, (_, k): V3 => [0, pelvisY, hz - k * HUMANTAUR_SPAN]);
    const prims: Prim[] = cover ? [coverPrim()] : [];
    /** 第 k 副胯的半宽：一副胯上并排着几条腿，就宽到盖得住 */
    const width = (k: number) => pelvisWide(stations[k], pelvis[0]);
    for (let k = 1; k < n; k++) {
      const z = -k * HUMANTAUR_SPAN;
      // 腰两头都比中间宽：前头接着前一副胯，后头是这一副胯，从上面看是两头宽、中间细
      const wide = (width(k - 1) + waistW) / 2;
      const thick = (pelvis[1] + waistD) / 2;
      prims.push(
        // 这一副胯：往前多伸一点，顺着收到腰上
        blob(`Pelvis_${pad(k + 1)}`, [width(k), pelvis[1], pelvis[2] + 0.03], [0, 0, z + 0.02]),
        // 腰：从前一副胯的后腰一直伸进这一副胯里，两头都埋着
        mass(`Waist_${pad(k + 1)}`, [waistW, waistD, HUMANTAUR_SPAN / 2 + 0.05], [0, HUMANTAUR_RISE, z + HUMANTAUR_SPAN / 2], 0.05),
        // 前一副胯的后面：一团软的，把胯顺到腰上（那里本来是臀）
        mass(`Loin_${pad(k + 1)}`, [wide, thick + 0.006, 0.13], [0, HUMANTAUR_RISE * 0.6, z + HUMANTAUR_SPAN - 0.075], 0.06),
      );
    }
    // 最后一副胯的后面是臀：胯宽了、窄了，两瓣跟着分开、并拢；这副胯上三条以上腿时每条腿上面一瓣，胯下往上各一道缝
    const spread = stations[n - 1] > 2 ? 1 : width(n - 1) / pelvis[0];
    prims.push(...buttocks(stations[n - 1], hx, [0, -0.005, -(n - 1) * HUMANTAUR_SPAN - 0.068 * b], cheekRadii(b, hips), 0.06 * hips * spread, 0.03, b));
    lower('LowerBody', center, prims, lowerChain(chain, center));
    stations.forEach((count, k) => humanRow(count, hz - k * HUMANTAUR_SPAN, legParent(k)));
    // 尾根长在最后那副胯的臀上：体格大了臀跟着变大、往后鼓，尾根也往后挪，埋进臀里不超过 2.5 厘米
    const glutesBack = hz - 0.134 * b;
    tailRoot = [options.tailRoot[0], options.tailRoot[1], -(n - 1) * HUMANTAUR_SPAN + Math.min(options.tailRoot[2], glutesBack + 0.025)];
    tailParent = legParent(n - 1);
  } else if (form === 'abreast' && options.twin) {
    // 两份素体并成一个宽躯干：腿接在躯干那两份自己的胯上，左边那副先（和下面一样）
    for (const x of [options.twin, -options.twin]) humanRow(2, hz, 'Hips', 0, x);
    tailRoot = options.tailRoot;
  } else if (form === 'abreast') {
    // 人腿横排多胯：几副完整的胯（各有自己的屁股、胯下）左右并排，稍微叠着并成一整块；每副胯两条腿（单数时正中那副一条）。
    // 上半身还是一个，坐在正中。每副胯上的两条腿是这副胯自己的左右（套现成的姿势时，每副胯的左腿都照左腿摆）
    const pelvis = options.pelvis ?? [0.162 * hips * b, 0.105 * b, 0.118 * b];
    const { xs, halves } = abreastSpots(stations, pelvis[0], hx);
    // 屁股照左右并排时那样：瓣宽到两道缝之间，只比这副胯往后鼓一点点（不然一瓣一瓣像一排球粘在胯上）
    const [cx, cy, cz] = cheekRadii(b, hips);
    const radii: V3 = [Math.max(cx, hx), cy, cz];
    const prims: Prim[] = [];
    xs.forEach((x, k) => {
      const tagged = (p: Prim): Prim => ({ ...p, name: `${p.name}_${pad(k + 1)}` });
      prims.push(blob(`Pelvis_${pad(k + 1)}`, [halves[k], pelvis[1], pelvis[2]], [x, 0, 0]));
      prims.push(...buttocks(stations[k], hx, [x, -0.005, cz - pelvis[2] - 0.006 * b], radii, 0.06 * hips, 0.03, b).map(tagged));
    });
    // 相邻两副胯接上的地方背后也是一道缝（不然两副胯里侧的两瓣并成一大块），挖在最后，几副胯的瓣都挖得到
    for (let k = 1; k < n; k++) prims.push(cleft(`Seam_${pad(k)}`, [(xs[k - 1] + xs[k]) / 2, -0.005, cz - pelvis[2] - 0.006 * b], radii, b));
    lower('LowerBody', [0, pelvisY, hz], prims);
    // 腿从正中往外一副一副排（编号也这么数：正中那副是第一对），左边的先
    const order = xs.map((_, k) => k).sort((a, c) => Math.abs(xs[a]) - Math.abs(xs[c]) || xs[c] - xs[a]);
    for (const k of order) humanRow(stations[k], hz, 'Hips', 0, xs[k]);
    tailRoot = options.tailRoot;
  } else if (form === 'row') {
    // 人腿左右并排：胯加宽，腿一字排开，单数时正中一条
    // 躯干没跟着加宽的（二次元素体）：每条腿上面一瓣屁股长在这副胯上，相邻两条腿中间往上一道缝
    const wide: V3 = [hx * (stations[0] - 1) + 0.07 * b, 0.1 * b, 0.115 * b];
    // 瓣宽到两道缝之间，只比这副胯往后鼓一点点：不然一瓣一瓣像一排球粘在胯上
    const [cx, cy, cz] = cheekRadii(b, hips);
    const radii: V3 = [Math.max(cx, hx), cy, cz];
    const seat = options.rowSeat ? buttocks(stations[0], hx, [0, -0.005, cz - wide[2] - 0.006 * b], radii, 0.06 * hips, 0.03, b) : [];
    lower('LowerBody', [0, pelvisY, -0.005], [blob('LowerBody', wide, O), ...seat]);
    humanRow(stations[0], hz, 'Hips');
    tailRoot = options.tailRoot;
  } else if (form === 'taur') {
    // 人马式：水平的马身，腿沿马身前后排开；每多一对腿马身加长。
    // 马身从前到后是三团：前胸、腰身、后臀。腰身细一圈，肚子往后往上收，背在中间略微塌下去
    const length = 0.8 + (n - 2) * 0.3;
    const front = 0.3;
    const zc = front - length / 2;
    const half = length / 2;
    const center: V3 = [0, TAUR_LEVEL, zc];
    const station = (k: number) => front - 0.13 - ((length - 0.26) * k) / (n - 1);
    lower(
      'LowerBody',
      center,
      [
        blob('Barrel', [0.18 * b, 0.205 * b, half - 0.05], [0, 0, 0]),
        mass('Chest', [0.205 * b, 0.25 * b, 0.2], [0, -0.012, half - 0.2], 0.07),
        mass('Croup', [0.205 * b, 0.24 * b, 0.205], [0, 0.02, 0.205 - half], 0.07),
      ],
      lowerChain(Array.from({ length: n }, (_, k): V3 => [0, TAUR_LEVEL, station(k)]), center),
    );
    for (let k = 0; k < n; k++) {
      for (const side of SIDES) {
        const { knee, fetlock, hoof } = hoofLegJoints(side, k === 0, b);
        leg(
          k,
          side,
          [side * 0.11 * b, HOOF_HIP, station(k)],
          hoofLegPrims(side, k === 0, b, limb),
          legBones(side, k, legParent(k), [O, knee, fetlock, hoof]),
          // 膝盖（飞节）以上那一截是长在马身里的
          { rootFree: HOOF_EMBED },
        );
      }
    }
    tailRoot = [0, TAUR_LEVEL + 0.14, zc - half + 0.035];
    tailParent = legParent(n - 1);
  } else {
    // 蛛形：头胸部向两侧放射出腿，后面拖着腹部。最后一对腿不往正后方伸，免得插进腹部
    // 身材瘦小时头胸部不变矮：顶上一直顶着上半身的胯、两侧一直接着腿根，不然会断开
    lower('Cephalothorax', [0, 1.02, 0.02], [0.19 * b, 0.2 * Math.max(1, b), 0.28]);
    lower('Abdomen', [0, 1.08, -0.6], [0.28 * b, 0.25 * b, 0.38], [bone('Abdomen', [0, -0.04, 0.4], [0, 0, -0.34], 'Hips')]);
    for (let k = 0; k < n; k++) {
      const { at, angle } = spiderLegRoot(k, n, b);
      for (const side of SIDES) {
        const { knee, mid, tip } = spiderLegJoints(side, angle, 0.18);
        leg(
          k,
          side,
          [side * at[0], at[1], at[2]],
          spiderLegPrims(side, angle, 0.18, limb),
          legBones(side, k, 'Hips', [O, knee, mid, tip]),
        );
      }
    }
    tailRoot = [0, 1.14, -0.94];
    tailParent = 'Abdomen';
  }
  return { parts, tailRoot, tailParent };
}

/** 尾巴：从尾根扇形散开，越靠外的翘得越低，多于三条时上下交替。root 是尾根的位置，parent 是尾根接在哪节骨骼上 */
export function tailParts(tails: number, sh: BodySpec['shape'], b: number, root: V3, parent: string): Part[] {
  const parts: Part[] = [];
  const tailLen = sh.tailLength;
  for (let i = 0; i < tails; i++) {
    const spread = tails > 1 ? Math.min(TAIL_SPREAD, 0.22 * (tails - 1)) : 0;
    const yaw = tails > 1 ? -spread + (2 * spread * i) / (tails - 1) : 0;
    // 背后看是一把扇面：越靠外的翘得越低、往两边伸得越远（散得最开的那条翘到一半不到）。
    // 不这样的话尾巴多了，外侧几条翘到肩膀那么高，往后摆的手臂会插进去
    const u = (yaw / TAIL_SPREAD) ** 2;
    const rise = 1 - TAIL_DROOP * u;
    const reach = 1 + TAIL_REACH * u;
    const up = (tails > 3 ? (i % 2 ? 0.12 : -0.04) : 0) * rise;
    const dir: V3 = [Math.sin(yaw), 0, -Math.cos(yaw)];
    const along = (d: number, y: number): V3 => [dir[0] * d * tailLen, y * tailLen, dir[2] * d * tailLen];
    const name = `Tail_${pad(i + 1)}`;
    const shape = tube(
      'Tail',
      [O, along(0.12, -0.06), along(0.35, 0.02 + up), along(0.55 * reach, 0.25 * rise + up * 1.5), along(0.58 * reach, 0.45 * rise + up * 2)],
      0.042 * b,
      0.008,
      0.05 * sh.tailFluff,
    );
    // 沿尾巴的中心线均匀分成几节：Tail_01_01 是尾根那一节
    const joints = sampleTube(shape, TAIL_BONES).map((s) => s.point);
    parts.push({
      name,
      type: 'tail',
      side: 0,
      pos: root,
      quat: Q_ID,
      material: 'clay',
      prims: [shape],
      bones: joints.slice(1).map((to, s) => bone(`${name}_${pad(s + 1)}`, joints[s], to, s ? `${name}_${pad(s)}` : parent)),
    });
  }
  return parts;
}
