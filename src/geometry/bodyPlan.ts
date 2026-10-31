/**
 * 多头、多臂的身体怎么长：三种身体样式（白模人台、二次元素体、成品角色）共用的规矩。
 *
 * 多个头照着二次元里多头角色常见的画法来：
 * - 身体还是一个人的身体，肩膀基本不加宽（脖子根实在排不下才稍微宽一点）；
 * - 头凑成一簇：脸贴着脸、互相压着一点，不是隔开排成一排；
 * - 从上面看这一簇是一道往后弯的弧：中间的头正着、最靠前，两边的往后退、脸稍微朝外、头往外歪一点；
 * - 脖子根并排挤在肩膀中间，脖子从那里斜着伸出去够自己的头，够不着就长一点。
 * 另一种排法是「一个头上几张脸」（佛像里阿修罗的三面）：只有一个头、一根脖子，多出来的脸朝着两边和后面。
 *
 * 多对手臂：
 * - 沿躯干上下排的，每一排有自己的一副肩膀；
 * - 聚在肩部的，多出来的从本来的肩膀后面长出来，前胸是干净的。
 *
 * 纯计算：只管算位置和角度，各样式自己去摆。
 */
import { type Quat, type V3, quatEuler, quatMul } from './vec';
import type { WidenBand } from './figure';

const DEG = Math.PI / 180;

/** 头多了，肩膀最多加宽到本来的几倍（各样式可以另给） */
export const SHOULDER_MAX = 1.3;

/** 2、3、4、5 个头时，相邻两个头的正中隔多远（头宽的几分之几）：头越多挤得越紧 */
const CROWD = [0.88, 0.86, 0.82, 0.78];
/** 相邻两个脖子根隔多远（相邻两个头的间隔的几分之几） */
const ROOT_GAP = 0.5;
/** 从上面看，每往旁边数一个头，脸多朝外转多少；最外面的最多转多少 */
const TURN_STEP = 30 * DEG;
const TURN_MAX = 50 * DEG;
/** 每往旁边数一个头，头多往外歪多少；最外面的最多歪多少 */
const TILT_STEP = 14 * DEG;
const TILT_MAX = 28 * DEG;
/** 脖子最多斜到多少；再够不着就加长 */
const LEAN_MAX = 45 * DEG;
/** 脖子根跟着头往后退：退头的几分之几，最多退多少（再多就到后背外面去了） */
const ROOT_FOLLOW = 0.4;
const ROOT_BACK = 0.035;
/**
 * 脖子最多加长到本来的几倍。照平常的间隔排还要更长的话，头就挤得更紧：
 * 最紧挤到相邻两个头的正中只隔头宽的 CROWD_TIGHTEST，分 CROWD_STEPS 步试过去。
 * 挤到最紧还不够的（头大、肩膀窄的身体上的四五个头），宁可脖子再长一点：再紧的话头就压进隔壁太深了（穿模检查只容压进三成）
 */
const NECK_LONGEST = 1.3;
const CROWD_TIGHTEST = 0.66;
const CROWD_STEPS = 8;

export interface HeadPlace {
  /** 脖子根相对「只有一个头时的脖子根」挪多少：左右（正的朝角色的左手边）、前后（负的是往后） */
  x: number;
  z: number;
  /** 脖子：从脖子根到头的关节（脖子顶端）。只有一个头时是笔直朝上的 */
  neck: V3;
  /** 头往旁边歪多少、脸往旁边转多少（弧度，正的都朝角色的左手边） */
  tilt: number;
  turn: number;
}

/** 一个头的尺寸 */
export interface HeadSize {
  /** 头有多宽：不算耳朵，也不算蓬起来的头发 */
  width: number;
  /** 脖子本来多长：脖子根到头的关节 */
  neck: number;
  /** 头的关节到头的正中有多高 */
  rise: number;
}

/**
 * 头多了，每个头小一圈：四个头时是本来的九成二，五个头时八成六；三个以内不变。
 * 四五个正常大小的头在一副肩膀上实在排不开，外面的脖子得拉得很长。
 */
export const headShrink = (count: number) => [1, 1, 1, 0.92, 0.86][Math.min(Math.max(count, 1), 5) - 1];

/** count 个头凑成一簇时，相邻两个头的正中隔多远 */
export const headSpacing = (count: number, width: number) => width * CROWD[Math.min(Math.max(count, 2), 5) - 2];

/** 这个头的朝向：先往旁边歪，再把脸转过去 */
export const headTurn = (place: HeadPlace): Quat =>
  place.tilt || place.turn ? quatMul(quatEuler(0, place.turn, 0), quatEuler(0, 0, -place.tilt)) : [0, 0, 0, 1];

/**
 * 头多了，肩膀要多宽：脖子根并排挤在肩膀中间，最外面的那个离肩关节至少要有 room 那么远。
 * 一般不用加宽；头很多、肩膀又窄的时候才宽一点，最多到 max。
 * 返回肩关节该离中线多远（和 shoulder 量的是同一个地方）。width：头有多宽。
 */
export function shoulderSpan(count: number, width: number, shoulder: number, room: number, max = shoulder * SHOULDER_MAX): number {
  if (count <= 1) return shoulder;
  const outer = ((count - 1) / 2) * ROOT_GAP * headSpacing(count, width);
  return Math.min(Math.max(shoulder, outer + room), Math.max(shoulder, max));
}

/**
 * 多个头怎么摆。先定头：凑成一簇，从上面看是一道往后弯的弧，相邻两个脸贴着脸；
 * 再定脖子：脖子根并排挤在肩膀中间，各自斜着伸到自己的头下面，斜到头了还够不着就加长。
 * 加长也有个限度（NECK_LONGEST）：超过了就把头挤得更紧，互相多压着一些。
 *
 * limitX：最外面的脖子根最远离中线多远（肩关节往里一点）。
 */
export function headCluster(count: number, size: HeadSize, limitX: number): HeadPlace[] {
  if (count <= 1) return [{ x: 0, z: 0, neck: [0, size.neck, 0], tilt: 0, turn: 0 }];
  const loose = headSpacing(count, size.width);
  const tight = Math.min(loose, CROWD_TIGHTEST * size.width);
  const longest = (places: HeadPlace[]) => Math.max(...places.map((p) => Math.hypot(p.neck[0], p.neck[1], p.neck[2])));
  let places = arrange(count, size, limitX, loose);
  // 头大、肩膀窄的身体上，四五个头照平常的间隔排，最外面的脖子要拉得很长：那就把头挤紧一点，一步步试到脖子够短为止
  for (let step = 1; step <= CROWD_STEPS && longest(places) > NECK_LONGEST * size.neck; step++) {
    places = arrange(count, size, limitX, loose + ((tight - loose) * step) / CROWD_STEPS);
  }
  return places;
}

/** 相邻两个头的正中隔 spacing 时怎么摆（见 headCluster） */
function arrange(count: number, size: HeadSize, limitX: number, spacing: number): HeadPlace[] {
  const spread = (count - 1) / 2;
  const gap = Math.min(ROOT_GAP * spacing, limitX / spread);
  const turnStep = Math.min(TURN_STEP, TURN_MAX / spread);
  const tiltStep = Math.min(TILT_STEP, TILT_MAX / spread);
  // 头的正中都在一道圆弧上，相邻两个正好隔 spacing
  const radius = spacing / (2 * Math.sin(turnStep / 2));
  return Array.from({ length: count }, (_, k) => {
    const offset = k - spread;
    const turn = offset * turnStep;
    const tilt = offset * tiltStep;
    const centerX = radius * Math.sin(turn);
    const centerZ = -radius * (1 - Math.cos(turn));
    // 头的关节在头的正中下面（顺着头自己的上下方向）
    const jointX = centerX - size.rise * Math.sin(tilt) * Math.cos(turn);
    const jointZ = centerZ + size.rise * Math.sin(tilt) * Math.sin(turn);
    const x = offset * gap;
    // 正中间的那个原地不动（单独写出来，免得算出一个 -0）
    const z = offset ? Math.max(centerZ * ROOT_FOLLOW, -ROOT_BACK) : 0;
    // 脖子横着要够多远；够得着就保持本来的长度，不然斜到头以后加长
    const across = Math.hypot(jointX - x, jointZ - z);
    const up = Math.max(Math.sqrt(Math.max(size.neck * size.neck - across * across, 0)), across / Math.tan(LEAN_MAX));
    return { x, z, neck: [jointX - x, up, jointZ - z], tilt, turn };
  });
}

/**
 * 一个头上长几张脸（阿修罗的三面、梵天的四面）：都长在同一个头上，共用一根脖子。
 * 返回每张脸绕头的竖轴转多少（弧度，正的朝角色的左手边）。第一张朝正前，是本来的那张；
 * 两张是一前一后，三张是正前、左、右，四张再加一张朝后，五张是绕一圈均匀分开。
 */
export function faceTurns(count: number): number[] {
  if (count <= 1) return [0];
  if (count === 2) return [0, Math.PI];
  if (count <= 4) return [0, Math.PI / 2, -Math.PI / 2, Math.PI].slice(0, count);
  const step = (2 * Math.PI) / count;
  return Array.from({ length: count }, (_, k) => (k ? (k % 2 ? 1 : -1) * Math.ceil(k / 2) * step : 0));
}

/**
 * 多出来的脸顺着它自己朝的方向往外挪多少（头的半宽的几分之几）。
 * 不挪的话它几乎整个埋在正面那个头里，只露出一个鼻尖
 */
export const FACE_OUT = 0.55;

/** 肩部聚拢：多出来的肩关节一对比一对靠后多少；几对加起来最多靠后多少（再多就伸到背后面去了） */
const FAN_BACK = 0.042;
const FAN_DEPTH = 0.095;

/**
 * 肩部扇形聚拢时，第 i 对手臂（i = 0 是本来的那一对）的肩关节相对本来的肩膀挪多少：
 * 多出来的从它后面长出来，一对比一对靠后、稍低、往里收一点。
 * 这样多出来的肩头都藏在肩膀后面，不会从胸前顶出来。返回的是左边的；右边把 x 反过来。
 *
 * depth：几对加起来最多靠后多少。身子薄的（二次元素体）要给一个小的：肩关节排到后背外面去，
 * 肩头就整个悬在背后了。给了小的，往下、往里挪的也按比例收紧，几个肩关节挤成一小簇。
 */
export function fanShift(i: number, pairs: number, depth = FAN_DEPTH): V3 {
  const back = Math.min(FAN_BACK, depth / Math.max(1, pairs - 1));
  const tight = depth < FAN_DEPTH ? back / FAN_BACK : 1;
  return [-i * 0.01 * tight, -i * 0.022 * tight, -i * back];
}

/**
 * 加宽肩膀：躯干上离中线 x、高度 y 的一点往外挪多少（不带正负号）。
 * 从 from 往上逐渐加宽，到 to 加到最宽（amount）；离中线 core 以内的一段是被拉开的，再往外的整个往外挪。
 */
export function widenShift(x: number, y: number, amount: number, from: number, to: number, core: number): number {
  const up = (y - from) / (to - from);
  const out = Math.abs(x) / core;
  const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  return amount * smooth(up) * smooth(out);
}

/** 几段加宽、收窄叠在一起（见 GridShape.widenX）：躯干上离中线 x、高度 y 的一点往外挪多少（不带正负号，负的是往里） */
export function widenBy(x: number, y: number, bands: readonly WidenBand[]): number {
  return bands.reduce((sum, [amount, from, to, core]) => sum + widenShift(x, y, amount, from, to, core), 0);
}

/**
 * 腿胯部聚拢时，从前往后第 k 副胯上的一对腿，脚踝往外挪多少（三种身体样式都照这个）。
 * 相邻两对腿在脚踝处隔 step；越往后的腿斜得越厉害，垂直于腿量的间隔会变小，所以每往后一副，
 * 多挪的那一步按前一对的斜度补回来，相邻两对垂直于腿量总是隔 step。depth 是髋关节到脚踝有多深。
 * odd：单数条（最后那副胯上是正中一条），前面几对都多散开半步，正面看左右对称
 */
export function gatherOut(k: number, step: number, depth: number, odd: boolean): number {
  let out = odd ? step / 2 : 0;
  for (let j = 0; j < k; j++) out += step * Math.hypot(1, out / depth);
  return out;
}
