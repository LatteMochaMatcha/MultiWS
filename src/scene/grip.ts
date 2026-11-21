/**
 * 手抓在道具上、脚踩在道具上时怎么摆（docs/grab-plan.md 第 2 期）：
 * - 落位（seatHand / seatFoot）：手掌转过去对着道具表面，手腕落到离表面一个手掌厚的地方；
 *   杆（和道具上细长的那一截）是握在四指根部、四指横着绕过去；四指朝着棱、离棱近的，四指根部落到棱上（手指翻过去扣住）。
 *   脚是脚底贴着面。
 * - 握上（closeHand）：四指从根到梢一节一节往手心弯，弯到碰着道具为止；拇指从另一边合过来。
 *   握紧度（loosen）：1 是握到碰着，往 0 是手指越来越直。
 * 都是纯函数。坐标是角色自己的：道具的网格先换过来（propTouch.ts 的 propSolid(prop, here)）。
 */
import { type Quat, type V3, add, cross, dot, len, madd, mul, norm, quatBasis, quatBetween, quatConj, quatMul, rotate, sub } from '../geometry/vec';
import { GESTURES, type Hand, type HandShape, handTurns, shapeHand } from '../pose/fingers';
import type { Limb } from '../pose/limbs';
import { anyPerp, quatAngle, reject } from '../pose/math';
import { type PoseState, forward } from '../pose/rig';
import type { Solver } from '../pose/solver';
import { type PropSolid, closestOnSolid, edgeAt, insideSolid, nearPart, surfaceAt, thinPart, touchesSolid } from './propTouch';

/** 标准身高（米）：下面的尺寸都是照它写的，别的身高照比例放缩 */
export const STANDARD = 1.7;

/** 这副骨架静止时有多高 */
export function tallOf(solver: Solver): number {
  let top = 0;
  for (const p of solver.rig.head) top = Math.max(top, p[1]);
  for (const p of solver.rig.tail) top = Math.max(top, p[1]);
  return top || STANDARD;
}

/** 这副骨架比标准身高大多少倍 */
export const scaleOf = (solver: Solver): number => tallOf(solver) / STANDARD;

/** 末端那根骨骼（手、脚）该去哪、该朝哪（角色自己的坐标） */
export interface Seat {
  target: V3;
  rot: Quat;
  /** 落在道具的哪：拖动时吸上去，在这里亮一圈 */
  mark: SeatMark;
  /** 这一下是握杆（四指绕过去）：正手、反手能来回换 */
  round?: boolean;
}



/** 亮圈：圆心、朝哪（圈所在平面的法线）、多大（半径，米）。杆上是套着杆的一圈，面上是贴着面的一圈 */
export interface SeatMark {
  at: V3;
  axis: V3;
  radius: number;
}

/** 一根杆（角色自己的坐标）：中线的两头和半径 */
export interface BarLine {
  a: V3;
  b: V3;
  r: number;
}

/** 落位时的另外两种要求（都只对握杆有用） */
export interface SeatWay {
  /** 换成另一种握法（正手 ↔ 反手） */
  flip?: boolean;
  /** 换握法时手腕留在原处、只翻手掌（手腕会折着：挪到杆另一侧的位置手臂够不着时才用） */
  stay?: boolean;
  /**
   * 这只手已经握着这件道具了：手心探到的不是细的一截时（换了握法以后手心对着的可能是旁边的横撑、坐面），
   * 照「杆在四指根部」算杆该在哪，在那里再找一次。没抓着的手不这样找——不然手按在椅面上、旁边有根柱子，就握到柱子上去了
   */
  held?: boolean;
}

/** 手腕的关节离手心那一面多远（标准身高时，米）：撑着、扶着时手腕离表面这么高 */
export const PALM = 0.035;
/** 握杆时杆的表面离四指根部的关节多远 */
const PALM_BAR = 0.015;
/** 手背对着道具（手心离表面的朝向差得比这个多，度）：不帮着转，照原样 */
const PALM_TURN_MAX = 110;
/** 脚底离表面的朝向差得比这个多（度）：不帮着转（脚背、脚尖顶着的） */
const SOLE_TURN_MAX = 60;
/** 四指根部离棱不到这么远（标准身高时，米）、四指又朝着棱外面（差不到 EDGE_TURN 度）：扣在棱上 */
const EDGE = 0.04;
const EDGE_TURN = 60;
/**
 * 不是「杆」的道具上细长的那一截（椅子腿、扶手、栏杆）也当杆握：看手边 BAR_PROBE 远以内的面，
 * 都离中线不到 BAR_THICK 才算（标准身高时，米）；切成 BAR_STEP 大的小块来量
 */
const BAR_PROBE = 0.12;
const BAR_THICK = 0.06;
const BAR_STEP = 0.025;
/** 亮圈在面上多大、在杆上比杆粗多少（标准身高时，米） */
const MARK_FLAT = 0.045;
const MARK_BAR = 0.012;
const RAD = Math.PI / 180;

/** 手腕到四指根部多远（握杆时杆在四指根部那里）；量不出来（没有四指）就照手那根骨骼的长短估 */
export function palmLength(solver: Solver, hand: Hand): number {
  const { rig } = solver;
  const roots = hand.fingers.slice(1).filter((chain) => chain.length).map((chain) => len(sub(rig.head[chain[0]], rig.head[hand.bone])));
  if (roots.length) return roots.reduce((a, b) => a + b, 0) / roots.length;
  return len(sub(rig.tail[hand.bone], rig.head[hand.bone])) * 0.8;
}

/** 手掌现在的朝向：四指朝哪、手心朝哪（都是单位长），和「约定的样子」到现在转了多少 */
function palmOf(solver: Solver, state: PoseState, hand: Hand) {
  const f = forward(solver.rig, state);
  const turn = quatMul(f.rot[hand.bone], hand.frame);
  return { f, turn, wrist: f.pos[hand.bone], fingers: rotate(turn, [hand.side, 0, 0]), palm: rotate(turn, [0, -1, 0]) };
}

/** 拇指那一侧朝哪（单位长）：约定的样子里手心朝下、四指朝外，拇指在前面那一侧，左右手一样 */
export const thumbSide = (rot: Quat, hand: Hand): V3 => rotate(quatMul(rot, hand.frame), [0, 0, 1]);

/** 四指朝 fingers、手背朝 back（互相垂直）时，手那根骨骼该朝哪（约定的样子见 pose/fingers.ts：右手是左手的镜像） */
export function handRot(hand: Hand, fingers: V3, back: V3): Quat {
  const want = hand.side > 0 ? quatBasis(fingers, back, cross(fingers, back)) : quatBasis(mul(fingers, -1), back, cross(fingers, mul(back, -1)));
  return quatMul(want, quatConj(hand.frame));
}

/**
 * 手落到道具上：手掌转过去对着表面（转得最少的转法），手腕落到离表面一个手掌厚的地方。
 * bar：这件道具是根杆的话给出来——杆握在四指根部，手心对着杆的中线，四指横着绕过去；从哪一边绕取离现在的朝向近的。
 * 不是杆的道具，手边那一截细长的（椅子腿、扶手、栏杆）也这样握。
 * 四指朝着一条棱、四指根部离棱不到 EDGE：四指根部落到棱上，手指翻过棱扣到另一面（握上时自己弯过去）。
 * 手背对着道具（要转过 PALM_TURN_MAX 才对得上）返回 null：照原样，不帮着转。
 * way.flip：握杆的手换成另一种握法（正手 ↔ 反手）——手掌绕着四指的方向翻过去，杆换到手掌的另一面，所以手腕挪到杆的另一侧
 * （新旧两个位置照「四指那条线」互为镜像；四指朝哪不变，前臂差不多不动）。换过去再换回来还在原处
 */
export function seatHand(solver: Solver, state: PoseState, hand: Hand, solid: PropSolid, k: number, bar?: BarLine | null, way: SeatWay = {}): Seat | null {
  const { f, wrist, fingers, palm } = palmOf(solver, state, hand);
  const now = f.rot[hand.bone];
  const reach = palmLength(solver, hand);
  const centre = madd(wrist, fingers, reach * 0.6);
  const at = surfaceAt(solid, centre, mul(palm, -1));
  if (!bar && at) bar = thinPart(solid, at.point, BAR_PROBE * k, BAR_THICK * k, BAR_STEP * k);
  if (!bar && way.held) {
    const core = closestOnSolid(solid, madd(madd(wrist, fingers, reach), palm, (BAR_THICK / 2) * k));
    if (core.dist <= BAR_THICK * k) bar = thinPart(solid, core.point, BAR_PROBE * k, BAR_THICK * k, BAR_STEP * k);
  }
  if (bar) {
    const span = sub(bar.b, bar.a);
    const long = len(span);
    if (long > 1e-6) {
      const u = mul(span, 1 / long);
      // 杆握在四指根部。手腕留在杆的哪一边、沿杆多高都照现在的：手腕到中线上最近的那一点（两头各留半个手掌宽，短的杆握在正中），
      // 从中线朝着手腕的方向不变，只把手腕挪到握得住的远近。四指从哪一边绕过去有两种，取离现在的朝向近的。
      // 照手腕算：已经握好的手再落一次位还在原处；拖着手沿杆滑、绕着杆转，手也只跟着鼠标走，不会自己绕着杆转圈
      const margin = Math.min(long / 2, 0.045 * k);
      const along = Math.max(margin, Math.min(long - margin, dot(sub(wrist, bar.a), u)));
      const on = madd(bar.a, u, along);
      let side = reject(sub(wrist, on), u);
      if (len(side) < 1e-4) side = reject(mul(palm, -1), u);
      side = len(side) < 1e-6 ? anyPerp(u) : norm(side);
      // 四指根部离中线 near，手腕离中线 far；从中线看，四指根部和手腕夹着 angle
      const near = bar.r + PALM_BAR * k;
      const far = Math.hypot(near, reach);
      const angle = Math.atan2(reach, near);
      const lay = (from: V3, sign: number) => {
        const out = add(mul(from, Math.cos(angle)), mul(cross(u, from), sign * Math.sin(angle)));
        const along4 = mul(sub(mul(out, near), mul(from, far)), 1 / reach);
        return { along4, rot: handRot(hand, along4, out) };
      };
      const off = (rot: Quat) => quatAngle(quatMul(quatConj(now), rot));
      let sign = off(lay(side, 1).rot) <= off(lay(side, -1).rot) ? 1 : -1;
      if (way.flip) {
        // 照四指那条线镜像：四指朝哪不变，手背翻到另一面，手腕到杆的另一侧
        const a = lay(side, sign).along4;
        if (!way.stay) side = norm(sub(mul(a, 2 * dot(side, a)), side));
        sign = -sign;
      }
      return { target: madd(on, side, far), rot: lay(side, sign).rot, mark: { at: on, axis: u, radius: bar.r + MARK_BAR * k }, round: true };
    }
  }
  if (!at) return null;
  const facing = mul(at.normal, -1);
  if (dot(palm, facing) < Math.cos(PALM_TURN_MAX * RAD)) return null;
  const flat = quatBetween(palm, facing);
  const high = dot(sub(wrist, at.point), at.normal);
  // 棱：四指（手掌放平以后）朝着棱外面、四指根部又在棱边上
  const ahead = reject(rotate(flat, fingers), at.normal);
  if (len(ahead) > 1e-6) {
    const roots = madd(wrist, norm(ahead), reach);
    const edge = edgeAt(solid, madd(roots, at.normal, -dot(sub(roots, at.point), at.normal)), at.normal, EDGE * k);
    if (edge && dot(norm(ahead), edge.over) >= Math.cos(EDGE_TURN * RAD)) {
      return {
        target: madd(madd(edge.point, at.normal, PALM * k), edge.over, -reach),
        rot: handRot(hand, edge.over, at.normal),
        mark: { at: edge.point, axis: at.normal, radius: MARK_FLAT * k },
      };
    }
  }
  return { target: madd(wrist, at.normal, PALM * k - high), rot: quatMul(flat, now), mark: { at: at.point, axis: at.normal, radius: MARK_FLAT * k } };
}

/**
 * 脚落到道具上：脚底贴着面（脚掌转到和面平行，脚尖朝哪不变），脚踝落到离面「静止时脚踝离地那么高」的地方。
 * 脚背、脚尖顶着道具的（要转过 SOLE_TURN_MAX 才贴得上）返回 null：照原样
 */
export function seatFoot(solver: Solver, state: PoseState, leg: Limb, solid: PropSolid): Seat | null {
  const { rig } = solver;
  const f = forward(rig, state);
  const ankle = f.pos[leg.end];
  const now = f.rot[leg.end];
  // 静止时站在地上、脚是平的：脚底朝下就是骨骼自己的「下」
  const up = rotate(now, [0, 1, 0]);
  const at = surfaceAt(solid, ankle, up);
  if (!at || dot(up, at.normal) < Math.cos(SOLE_TURN_MAX * RAD)) return null;
  const high = dot(sub(ankle, at.point), at.normal);
  return {
    target: madd(ankle, at.normal, Math.max(0, rig.head[leg.end][1]) - high),
    rot: quatMul(quatBetween(up, at.normal), now),
    mark: { at: at.point, axis: at.normal, radius: MARK_FLAT * scaleOf(solver) },
  };
}

/* ---------------- 手指握上 ---------------- */

const GRIP: HandShape = GESTURES.find((g) => g.name === '握着东西')!.shape;
/** 手指自己的半粗（标准身高时，米） */
const FINGER_R = 0.009;
/** 四指三节各最多弯多少度；一次试多少度；第一节从往手背翘多少度试起（手压在面上时四指是往后翘的） */
const CURL_MAX = [96, 108, 84] as const;
const CURL_STEP = 6;
const CURL_BACK = -18;
/**
 * 拇指：握的时候在手掌平面里张开多少度；往手心压最多多少度；压一度顺着自己的轴往里拧多少度；后两节各最多弯多少度。
 * 绕着握（握杆）：一上来拇指就横在道具上的，改成先张到 THUMB_WIDE、侧着压到手心下面 THUMB_UNDER，
 * 再往四指那边合过来（最多合到 THUMB_IN），这样拇指是从另一边绕过去的；合过来一路都空着（杆在拇指上面），
 * 就在杆下面往回抬，抬到从下面贴着它
 */
const THUMB_OUT = 46;
const THUMB_DOWN_MAX = 66;
const THUMB_WIDE = 80;
const THUMB_UNDER = 58;
const THUMB_IN = 6;
const THUMB_ROLL = 0.9;
const THUMB_CURL_MAX = [72, 80] as const;
/** 只看离手腕这么近的面（标准身高时，米）：手指够不到更远的 */
const HAND_REACH = 0.3;

/**
 * 一只手握到道具上是什么手势：手掌不动，四指从根到梢一节一节往手心弯，弯到这一节往外的那一截碰着道具为止
 * （先弯根部那节，它停了再弯下一节，所以手指是贴着道具的形状绕过去的）；拇指先往手心压、再弯后两节。
 * 哪一节一路弯到头都没碰着，就照「握着东西」的样子弯。整只手一处都没碰着返回 null（没东西可握）。
 * solid：道具的网格（角色自己的坐标）；k：身高比标准身高
 */
export function closeHand(solver: Solver, state: PoseState, hand: Hand, solid: PropSolid, k: number): HandShape | null {
  const { rig, frames } = solver;
  const f = forward(rig, state);
  const palm = quatMul(f.rot[hand.bone], hand.frame);
  const near = nearPart(solid, f.pos[hand.bone], HAND_REACH * k);
  if (!near.indices.length) return null;
  const rad = FINGER_R * k;
  const shape: HandShape = {
    thumb: { out: THUMB_OUT, down: 0, roll: 0, curl: [0, 0] },
    fingers: [0, 1, 2, 3].map(() => ({ curl: [CURL_BACK, 0, 0], spread: 0 })) as HandShape['fingers'],
  };

  /** 第 finger 根手指（0 是拇指）从第 from 节往外，照现在的 shape 摆好以后身上的几个点（每节三个：三分之一、三分之二、末端） */
  const pointsOf = (finger: number, from: number): V3[] => {
    const bones = hand.fingers[finger];
    const turns = handTurns(shape, hand.side)[finger];
    const out: V3[] = [];
    let at = f.pos[bones[0]];
    bones.forEach((bone, i) => {
      const turned = quatMul(quatMul(palm, turns[Math.min(i, turns.length - 1)]), quatConj(frames[bone]));
      const span = rotate(turned, sub(i + 1 < bones.length ? rig.head[bones[i + 1]] : rig.tail[bone], rig.head[bone]));
      if (i >= from) out.push(madd(at, span, 1 / 3), madd(at, span, 2 / 3), add(at, span));
      at = add(at, span);
    });
    return out;
  };
  /** 这几个点里有没有碰着道具的。deep：连「已经整个在道具里面」也查（只在起点查一次，慢） */
  const hits = (points: V3[], deep: boolean) => points.some((p) => touchesSolid(near, p, rad) || (deep && insideSolid(solid, p)));
  /**
   * 一个角度从 start 一点点加到 max，加到碰着为止，停在碰着之前（再对半细找几次）。
   * 返回碰着了没有；没碰着时角度留在 max，由调用的人改
   */
  const sweep = (start: number, max: number, set: (deg: number) => void, points: () => V3[]): boolean => {
    set(start);
    if (hits(points(), true)) return true;
    let free = start;
    for (let deg = start + CURL_STEP; deg <= max + 1e-9; deg += CURL_STEP) {
      set(deg);
      if (hits(points(), false)) {
        let hi = deg;
        for (let i = 0; i < 4; i++) {
          const mid = (free + hi) / 2;
          set(mid);
          if (hits(points(), false)) hi = mid;
          else free = mid;
        }
        set(free);
        return true;
      }
      free = deg;
    }
    return false;
  };

  let touched = 0;
  shape.fingers.forEach((finger, i) => {
    const bones = hand.fingers[i + 1];
    for (let j = 0; j < 3 && j < bones.length; j++) {
      const hit = sweep(j === 0 ? CURL_BACK : 0, CURL_MAX[j], (deg) => (finger.curl[j] = deg), () => pointsOf(i + 1, j));
      if (hit) touched++;
      else finger.curl[j] = GRIP.fingers[i].curl[j];
    }
    // 这根手指一节都没有（少指的手）：别留着往后翘的起点
    if (!bones.length) finger.curl[0] = 0;
  });
  const thumb = hand.fingers[0];
  if (thumb.length) {
    const down = (deg: number) => {
      shape.thumb.down = deg;
      shape.thumb.roll = deg * THUMB_ROLL;
    };
    const whole = () => pointsOf(0, 0);
    const blocked = (out: number) => {
      shape.thumb.out = out;
      down(0);
      return hits(whole(), true);
    };
    if (!blocked(THUMB_OUT)) {
      // 平常的：往手心压，压到碰着
      if (sweep(0, THUMB_DOWN_MAX, down, whole)) touched++;
      else down(GRIP.thumb.down);
    } else if (blocked(THUMB_WIDE)) {
      // 张到最开也压着：就搭在上面
      shape.thumb.out = THUMB_OUT;
      touched++;
    } else if (sweep(0, THUMB_UNDER, down, whole)) {
      // 侧着压下去就碰着了：停在那
      touched++;
    } else {
      // 压到手心下面了还空着：往四指那边合过来，合到碰着
      down(THUMB_UNDER);
      if (sweep(0, THUMB_WIDE - THUMB_IN, (deg) => (shape.thumb.out = THUMB_WIDE - deg), whole)) touched++;
      else {
        // 合过来也空着：东西在拇指上面（握着杆）——拇指在它下面抬回去，抬到从下面贴着它
        shape.thumb.out = GRIP.thumb.out;
        if (sweep(0, THUMB_UNDER, (deg) => down(THUMB_UNDER - deg), whole)) touched++;
        else down(GRIP.thumb.down);
      }
    }
    for (let j = 0; j < 2 && j + 1 < thumb.length; j++) {
      if (sweep(0, THUMB_CURL_MAX[j], (deg) => (shape.thumb.curl[j] = deg), () => pointsOf(0, j + 1))) touched++;
      else shape.thumb.curl[j] = GRIP.thumb.curl[j];
    }
  }
  return touched ? shape : null;
}

/**
 * 握紧度：tight 是 1 时就是握到碰着的样子，往 0 手指越来越直（0 是张着的手）。
 * 往手背翘的那一点（压在面上的四指）不跟着松：松了手指就插进面里了
 */
export function loosen(shape: HandShape, tight: number): HandShape {
  const t = Math.max(0, Math.min(1, tight));
  const ease = (deg: number) => (deg < 0 ? deg : deg * t);
  return {
    thumb: { out: shape.thumb.out, down: ease(shape.thumb.down), roll: ease(shape.thumb.roll), curl: [ease(shape.thumb.curl[0]), ease(shape.thumb.curl[1])] },
    fingers: shape.fingers.map((finger) => ({ curl: finger.curl.map(ease) as [number, number, number], spread: finger.spread })) as HandShape['fingers'],
  };
}

/** 一只手照握紧度握到道具上；没东西可握（手指一处都碰不着）就原样返回 */
export function gripHand(solver: Solver, state: PoseState, hand: Hand, solid: PropSolid, k: number, tight = 1): PoseState {
  const shape = closeHand(solver, state, hand, solid, k);
  return shape ? shapeHand(solver, state, hand, loosen(shape, tight)) : state;
}
