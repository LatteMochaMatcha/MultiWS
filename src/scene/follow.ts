/**
 * 钉住和跟随（见 docs/props-plan.md）：角色照它和道具的连接（model/links.ts）该站在哪、钉着的手脚该在哪。纯函数。
 *
 * - 整个人跟着一件道具的：角色的摆放照道具算（位置、朝向、离地多高），姿势不动。
 * - 手脚钉在道具上的：只有那一条手臂、那一条腿重新摆，末端去钉着的点；够不着就朝它伸直，身体不跟过去。
 *   连接里记着朝向的（见 docs/grab-plan.md），手掌、脚掌照道具现在的朝向转过去。
 *   连接里带着握紧度的手，手指照道具的形状握上（见 grip.ts）。
 * - 抓住、踩住的那一下（grabLink）：手掌先转过去对着道具、脚底贴着面，再记连接。
 * - 拖手脚拖到道具跟前（snapReach）：照同一套落位吸过去。
 * - 道具跟着手的（连接上带着 carry，见 carry.ts）：手不用回到道具上（是道具跟着它）；只有道具自己被挪了的那一下，手才跟过去。
 */
import { type Quat, type V3, add, cross, dot, len, mul, norm, quatBetween, quatConj, quatMul, rotate, sub } from '../geometry/vec';
import { BODY_LINK, type PropLink, carriedProp, linkOf, linkPoint, linkRot, liveLinks, makeLink, ridePlace, withCarry, withGrip } from '../model/links';
import { type SceneProp, propOf } from '../model/props';
import { type Place, clampPlace, placeY } from '../model/scene';
import type { Posing } from '../pose/posing';
import { type Frame, type PoseRig, type PoseState, forward } from '../pose/rig';
import { type Pin, dragReach, limbTwist, reachOnly, twistLower } from '../pose/solve';
import { type Solver, posingOf, stateOf } from '../pose/solver';
import { barOf } from './bar';
import { reject } from '../pose/math';
import { type Seat, type SeatMark, type SeatWay, gripHand, scaleOf, seatFoot, seatHand, thumbSide } from './grip';
import { fromScene, toScene } from './interact';
import { type PropSolid, closestOnSolid, propSolid, solidDistance } from './propTouch';

/** 角色朝向（度）写成四元数：角色自己坐标里的朝向 → 场景里的（和 interact.ts 的 toScene 是同一个转法） */
export function yawQuat(deg: number): Quat {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

/** 手、脚在场景里的朝向：rot 是它在角色自己坐标里的朝向（Frame.rot） */
export const sceneRot = (place: Place, rot: Quat): Quat => quatMul(yawQuat(place.yaw), rot);

/**
 * 把场景里的一点连到道具上：记下它相对道具表面的位置。yaw：整个人跟着时角色现在的朝向；
 * rot：手、脚现在在场景里的朝向（给了就连朝向一起记）
 */
export function linkTo(prop: SceneProp, part: string, point: V3, yaw?: number, rot?: Quat): PropLink {
  return makeLink(prop, part, point, closestOnSolid(propSolid(prop), point).point, yaw, rot);
}

/** 整个人跟着这件道具：照角色现在站的地方记 */
export const rideLink = (prop: SceneProp, place: Place): PropLink => linkTo(prop, BODY_LINK, [place.x, placeY(place), place.z], place.yaw);

/** 角色照连接该站在哪：整个人跟着一件道具的照道具算；没有就是原来的 */
export function followPlace(place: Place, links: readonly PropLink[] | undefined, props: readonly SceneProp[]): Place {
  const ride = linkOf(liveLinks(links, props), BODY_LINK);
  const prop = ride && propOf(props, ride.prop);
  return prop ? clampPlace(ridePlace(prop, ride)) : place;
}

export interface HoldTarget {
  /** 哪条肢体（Limb.name） */
  part: string;
  /** 抓着、踩着的是哪件道具 */
  prop: string;
  /** 末端该在哪（角色自己的坐标） */
  target: V3;
  /** 末端那根骨骼（手、脚）该朝哪（角色自己的坐标）；连接里没记朝向的没有 */
  rot?: Quat;
  /** 手指照道具的形状握上：握紧度（0–1），和道具的网格（角色自己的坐标，用到才算）。连接里没有握紧度的没有 */
  grip?: number;
  solid?: () => PropSolid;
  /**
   * 道具跟着这只手的（带着握紧度才有这一条）：手不用挪；要重新握的时候，道具照手那会儿在哪现算。
   * pos、rot 是手在角色自己坐标里的位置和朝向，返回道具的网格（也是角色自己的坐标）
   */
  carried?: (pos: V3, rot: Quat) => PropSolid;
}

/**
 * 钉着的手脚各该在哪：角色站在 place 时，换到它自己的坐标里。
 * 道具跟着手的那几个连接不算（手在哪道具就在哪）；led 里的道具除外——它们刚被挪了（操纵杆、改数、撤销），这一下是手跟着它们
 */
export function holdTargets(place: Place, links: readonly PropLink[] | undefined, props: readonly SceneProp[], led?: ReadonlySet<string>): HoldTarget[] {
  const out: HoldTarget[] = [];
  const solids = new Map<string, PropSolid>();
  for (const link of liveLinks(links, props)) {
    if (link.part === BODY_LINK) continue;
    const prop = propOf(props, link.prop)!;
    if (link.carry && !led?.has(link.prop)) {
      if (!link.grip) continue;
      const turn = yawQuat(place.yaw);
      out.push({
        part: link.part,
        prop: prop.id,
        target: fromScene(place, linkPoint(prop, link)),
        grip: link.grip,
        carried: (pos, rot) => propSolid(carriedProp(prop, link, toScene(place, pos), quatMul(turn, rot)), place),
      });
      continue;
    }
    const rot = linkRot(prop, link);
    const one: HoldTarget = { part: link.part, prop: prop.id, target: fromScene(place, linkPoint(prop, link)) };
    if (rot) one.rot = quatMul(quatConj(yawQuat(place.yaw)), rot);
    if (link.grip) {
      one.grip = link.grip;
      one.solid = () => {
        let solid = solids.get(prop.id);
        if (!solid) solids.set(prop.id, (solid = propSolid(prop, place)));
        return solid;
      };
    }
    out.push(one);
  }
  return out;
}

/** 手离抓着的那一点比这个还远（米）：没够着，手指不握 */
const OFF = 5e-3;
/** 落位的地方手臂够不着、差得比这个还多（标准身高时，米）：不落位 */
const SEAT_MISS = 0.03;

/**
 * 第 limb 条肢体的末端落到这件道具上该去哪、朝哪（角色自己的坐标）：手照 seatHand（杆握住、面贴住、棱扣住），
 * 脚照 seatFoot（脚底贴着面）。solid：道具的网格（角色自己的坐标），不给就现算。落不了（手背对着、不是手也不是脚）返回 null。
 * way：握杆的手换成另一种握法、这只手已经握着（见 grip.ts 的 SeatWay）
 */
export function seatLimb(solver: Solver, state: PoseState, place: Place, prop: SceneProp, limb: number, solid: PropSolid = propSolid(prop, place), way?: SeatWay): Seat | null {
  const one = solver.limbs[limb];
  const hand = solver.hands.find((h) => h.bone === one.end);
  if (hand) {
    const bar = barOf(prop);
    return seatHand(solver, state, hand, solid, scaleOf(solver), bar && { a: fromScene(place, bar.a), b: fromScene(place, bar.b), r: bar.r }, way);
  }
  return one.kind === 'leg' ? seatFoot(solver, state, one, solid) : null;
}

/**
 * 拖手、拖脚拖到道具跟前：吸上去。dragged 是照鼠标拖到的姿势，start、pins 是这次拖动开始时的（和 dragReach 用的一样）；
 * 照 dragged 里手的位置和朝向算落位，再从头拖到落位的地方。返回吸上去以后的姿势、道具上该亮的那一圈（角色自己的坐标）、
 * 和手落位以后的朝向（接着拖时把它带进 dragged，手就不会在杆的两边来回换着握）。
 * 落不了、落位的地方够不着：返回 null（不吸）
 */
export function snapReach(
  solver: Solver,
  start: PoseState,
  limb: number,
  pins: readonly Pin[],
  dragged: PoseState,
  place: Place,
  prop: SceneProp,
  solid?: PropSolid,
): { state: PoseState; mark: SeatMark; rot: Quat } | null {
  const seat = seatLimb(solver, dragged, place, prop, limb, solid);
  if (!seat) return null;
  const state = dragReach(solver, start, limb, seat.target, pins, seat.rot);
  if (len(sub(forward(solver.rig, state).pos[solver.limbs[limb].end], seat.target)) > SEAT_MISS * scaleOf(solver)) return null;
  return { state, mark: seat.mark, rot: seat.rot };
}

/**
 * 手抓住、脚踩住一件道具的那一下：先落位——手掌转过去对着道具（杆是握在四指根部），脚底贴着面——再记下连接。
 * grip：记多少握紧度（带手指的手才记；不给就不记，手指归用户自己摆）。
 * 落位的地方手臂差一点够不着：手伸到够得着的最远处；差得多（SEAT_MISS 以上）：不落位，就在现在的地方抓。
 * 返回落位以后的姿势和连接；手指还没握，交给 holdState。骨架上没有这条肢体返回 null
 */
export function grabLink(solver: Solver, state: PoseState, place: Place, prop: SceneProp, part: string, grip?: number): { state: PoseState; link: PropLink } | null {
  const i = solver.limbs.findIndex((l) => l.name === part);
  if (i < 0) return null;
  const limb = solver.limbs[i];
  const hand = solver.hands.find((h) => h.bone === limb.end);
  const seat = seatLimb(solver, state, place, prop, i);
  let seated = seat ? reachOnly(solver, state, i, seat.target, seat.rot) : state;
  let f = forward(solver.rig, seated);
  if (seat && len(sub(f.pos[limb.end], seat.target)) > SEAT_MISS * scaleOf(solver)) {
    seated = state;
    f = forward(solver.rig, state);
  }
  const link = linkTo(prop, part, toScene(place, f.pos[limb.end]), undefined, sceneRot(place, f.rot[limb.end]));
  return { state: seated, link: hand && grip ? withGrip(link, grip) : link };
}

/** 握杆的两种握法 */
export type GripWay = 'over' | 'under';

/**
 * 握着杆的手是正手还是反手，看拇指朝哪：朝里（另一只手那边）、朝上、朝前算正手——单杠、杠铃的正握（两个拇指相对），
 * 竖着的棍子拇指在上；反过来是反手（单杠的反握、反手握刀）。「里、上、前」照这条手臂所在的上半身自己的朝向算
 * （两个肩膀的连线、胯到肩膀），躺着、倒着也一样。rot：手那根骨骼的朝向（角色自己的坐标），不给就用 f 里现在的
 */
export function gripWayOf(solver: Solver, f: Frame, limb: number, rot?: Quat): GripWay | null {
  const one = solver.limbs[limb];
  const hand = one && solver.hands.find((h) => h.bone === one.end);
  if (!hand) return null;
  const here = f.pos[one.upper];
  const mate = solver.limbs
    .filter((l) => l.kind === one.kind && l.pair === one.pair && l.side === -one.side)
    .sort((a, b) => len(sub(f.pos[a.upper], here)) - len(sub(f.pos[b.upper], here)))[0];
  const side = one.side || 1;
  let left: V3 = [1, 0, 0];
  let mid = here;
  if (mate && len(sub(f.pos[mate.upper], here)) > 1e-6) {
    left = norm(mul(sub(here, f.pos[mate.upper]), side));
    mid = mul(add(here, f.pos[mate.upper]), 0.5);
  }
  const spine = solver.rig.hips >= 0 ? reject(sub(mid, f.pos[solver.rig.hips]), left) : ([0, 0, 0] as V3);
  let up: V3 = len(spine) > 1e-4 ? norm(spine) : norm(reject([0, 1, 0], left));
  if (!Number.isFinite(up[0])) up = [0, 1, 0];
  const front = cross(left, up);
  const want = add(add(mul(left, -side), up), front);
  return dot(thumbSide(rot ?? f.rot[one.end], hand), want) >= 0 ? 'over' : 'under';
}

/**
 * 这只手现在握着这件道具上的杆（或者椅子腿、栏杆这类细的一截）的话，是正手还是反手；不是握着杆（贴着面、扣着棱、是脚）返回 null
 */
export function barGripWay(solver: Solver, state: PoseState, place: Place, prop: SceneProp, part: string, solid?: PropSolid): GripWay | null {
  const i = solver.limbs.findIndex((l) => l.name === part);
  if (i < 0) return null;
  return seatLimb(solver, state, place, prop, i, solid, { held: true })?.round ? gripWayOf(solver, forward(solver.rig, state), i) : null;
}

/**
 * 握着杆的手换成另一种握法（正手 ↔ 反手）：手掌绕着四指的方向翻过去，四指从杆的另一边绕过来，手腕挪到杆的另一侧
 * （不是手腕留在原处硬翻：那样手腕是折着的）。沿杆握在哪、握紧度、道具跟不跟着这只手都照旧，道具不动；换过去再换回来还在原处。
 * 手掌翻了 180°，前臂跟着拧 90°（往哪边：拧完前臂和手腕上拧得都少的那边，所以换回来时正好拧回去）——不然全拧在手腕上，手腕像拧断了。
 * 杆另一侧的位置手臂够不着、或者换过去以后认不出它还握着杆：手腕留在原处，只翻手掌（手腕折着一点）。
 * 返回换好的姿势和连接（手指还没重新握，交给 holdState）；不是握着杆的、换过去以后认不出还握着杆的返回 null
 */
export function flipGrip(solver: Solver, state: PoseState, place: Place, prop: SceneProp, link: PropLink): { state: PoseState; link: PropLink } | null {
  const i = solver.limbs.findIndex((l) => l.name === link.part);
  if (i < 0) return null;
  const end = solver.limbs[i].end;
  const solid = propSolid(prop, place);
  const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
  // 先试手腕挪到杆另一侧的（手掌和前臂顺着）；够不着、或者换过去以后认不出它还握着杆
  // （家具上细的一截是现找的：换一面，旁边的横撑、坐面进了手边就不算细了），再试手腕留在原处只翻手掌的；都不行就不换，不然换不回来
  let turned: PoseState | null = null;
  for (const stay of [false, true]) {
    const seat = seatLimb(solver, state, place, prop, i, solid, { flip: true, held: true, stay });
    if (!seat?.round) return null;
    let tried = reachOnly(solver, state, i, seat.target, seat.rot);
    if (len(sub(forward(solver.rig, tried).pos[end], seat.target)) > SEAT_MISS * scaleOf(solver)) continue;
    const twist = limbTwist(solver, tried, i);
    const cost = (by: number) => wrap(twist.end - by) ** 2 + wrap(twist.lower + by) ** 2;
    tried = twistLower(solver, tried, i, cost(Math.PI / 2) <= cost(-Math.PI / 2) ? Math.PI / 2 : -Math.PI / 2);
    if (!barGripWay(solver, tried, place, prop, link.part, solid)) continue;
    turned = tried;
    break;
  }
  if (!turned) return null;
  const f = forward(solver.rig, turned);
  let next = linkTo(prop, link.part, toScene(place, f.pos[end]), undefined, sceneRot(place, f.rot[end]));
  if (link.grip) next = withGrip(next, link.grip);
  if (link.carry) next = withCarry(next, true);
  return { state: turned, link: next };
}

/** 胸口是哪根骨骼（抱着的道具跟着它走）：离 point（角色自己的坐标）最近的那个上半身的；找不到返回 -1 */
export function chestBone(rig: PoseRig, frame: Frame, point: V3): number {
  for (const pattern of [/^UpperChest/, /^Chest/, /^Spine/]) {
    let best = -1;
    let least = Infinity;
    rig.names.forEach((name, i) => {
      if (!pattern.test(name)) return;
      const d = len(sub(frame.pos[i], point));
      if (d < least) {
        least = d;
        best = i;
      }
    });
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * 两只手拿着一件道具（见 docs/grab-plan.md 第 5 期）：道具跟着主手（carrier），另一只手（other）抓在道具上。
 * 拖另一只手到 target：道具绕着主手抓的那一点转过去——主手的手腕留在原处、手掌跟着道具转，另一只手还抓在道具上原来那一点。
 * 两只手之间的距离是定死的：target 离主手比这个距离远了、近了超过 slack（米），就不算转道具，返回 null（那只手被拖开了）。
 * 转过去以后另一只手够不着了（手臂伸直了还差一截）：只转到它还够得着的地方为止。
 * start 是按下那一刻的姿势，每一下都从它算起
 */
export function swingReach(solver: Solver, start: PoseState, carrier: number, other: number, target: V3, slack: number): PoseState | null {
  const { rig, limbs } = solver;
  const f = forward(rig, start);
  const a = limbs[carrier].end;
  const b = limbs[other].end;
  const pivot = f.pos[a];
  const arm = sub(f.pos[b], pivot);
  const to = sub(target, pivot);
  const span = len(arm);
  if (span < 1e-4 || len(to) < 1e-4 || Math.abs(len(to) - span) > slack) return null;
  const full = quatBetween(norm(arm), norm(to));
  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, full[3])));
  const s = Math.sin(angle / 2);
  const axis: V3 = s > 1e-9 ? [full[0] / s, full[1] / s, full[2] / s] : [0, 1, 0];
  /** 转 t 成（0–1）：摆好的姿势，和另一只手离它该在的那一点还差多少 */
  const at = (t: number) => {
    const h = (angle * t) / 2;
    const turn: Quat = [axis[0] * Math.sin(h), axis[1] * Math.sin(h), axis[2] * Math.sin(h), Math.cos(h)];
    const point = add(pivot, rotate(turn, arm));
    // 主手：手腕不动，手掌跟着道具转；另一只手：到道具上原来那一点现在在的地方
    const held = reachOnly(solver, start, carrier, pivot, quatMul(turn, f.rot[a]));
    const state = reachOnly(solver, held, other, point, quatMul(turn, f.rot[b]));
    return { state, miss: len(sub(forward(rig, state).pos[b], point)) };
  };
  const whole = at(1);
  // 本来就没够着的（按下时手就悬着）不管；够得着就是它
  if (whole.miss <= SWING_MISS || at(0).miss > SWING_MISS) return whole.state;
  // 二分：转到另一只手还够得着的最远处
  let lo = 0;
  let hi = 1;
  let best = start;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const got = at(mid);
    if (got.miss <= SWING_MISS) {
      lo = mid;
      best = got.state;
    } else hi = mid;
  }
  return best;
}
/** 转道具时，另一只手离它该在的那一点差得比这个还多（米）：算够不着 */
const SWING_MISS = 1e-3;

/** 差得比这个还少就不动（米）：存下来的数是取整过的，来回算会差一点点 */
const SETTLED = 5e-4;

/** 两个朝向差得比这个还少就算一样（四元数点积离 1 多远；约 0.1°） */
const TURNED = 1e-6;
const sameRot = (a: Quat, b: Quat) => 1 - Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) < TURNED;

/**
 * 手指什么时候重新握：'moved' 只有这只手这一回挪了、转了才握（平时）；'always' 都重新握（刚抓上、道具改了尺寸、整个姿势换了）；
 * 'never' 不握（正拖着道具，每一帧都算，握一次太慢）
 */
export interface HoldOptions {
  grip?: 'moved' | 'always' | 'never';
}

/**
 * 把抓着、踩着道具的手脚摆到各自该在的点上、转到该朝的方向（只动那一条肢体）；带握紧度的手，手指照道具的形状握上。
 * 都已经在了返回原来那份
 */
export function holdState(solver: Solver, state: PoseState, targets: readonly HoldTarget[], options: HoldOptions = {}): PoseState {
  const when = options.grip ?? 'moved';
  let out = state;
  for (const { part, target, rot, grip, solid, carried } of targets) {
    const i = solver.limbs.findIndex((l) => l.name === part);
    if (i < 0) continue;
    const end = solver.limbs[i].end;
    const f = forward(solver.rig, out);
    if (carried) {
      // 道具跟着这只手：手不动；只有「都重新握」的时候照道具现在的样子握一遍
      const hand = when === 'always' && grip ? solver.hands.find((h) => h.bone === end) : undefined;
      if (!hand) continue;
      const gripped = gripHand(solver, out, hand, carried(f.pos[end], f.rot[end]), scaleOf(solver), grip!);
      if ([...hand.fingers, ...hand.extras].flat().some((bone) => !sameRot(gripped.local[bone], out.local[bone]))) out = gripped;
      continue;
    }
    const at = f.pos[end];
    const settled = Math.hypot(at[0] - target[0], at[1] - target[1], at[2] - target[2]) < SETTLED && (!rot || sameRot(f.rot[end], rot));
    if (!settled) out = reachOnly(solver, out, i, target, rot);
    if (!grip || !solid || when === 'never' || (settled && when !== 'always')) continue;
    const hand = solver.hands.find((h) => h.bone === end);
    if (!hand) continue;
    // 够不着、手悬在半路：手指不动
    const now = settled ? at : forward(solver.rig, out).pos[end];
    if (Math.hypot(now[0] - target[0], now[1] - target[1], now[2] - target[2]) > OFF) continue;
    const gripped = gripHand(solver, out, hand, solid(), scaleOf(solver), grip);
    // 握出来和现在一样的：不算改了（返回的还是原来那份）
    const bones = [...hand.fingers, ...hand.extras].flat();
    if (bones.some((bone) => !sameRot(gripped.local[bone], out.local[bone]))) out = gripped;
  }
  return out;
}

/** 同上，照存下来的姿势算；没动返回原来那份 */
export function holdPosing(solver: Solver, posing: Posing, targets: readonly HoldTarget[], options: HoldOptions = {}): Posing {
  if (!targets.length) return posing;
  const start = stateOf(solver, posing);
  const next = holdState(solver, start, targets, options);
  return next === start ? posing : posingOf(solver, next, posing);
}

/** 离这一点最近的道具，和它的表面离这一点多远（米；在里面是负的）。solids 是场景坐标里的 */
export function nearestSolid(solids: readonly PropSolid[], point: V3): { id: string; dist: number } | null {
  let best: { id: string; dist: number } | null = null;
  for (const solid of solids) {
    const dist = solidDistance(solid, point);
    if (!best || dist < best.dist) best = { id: solid.id, dist };
  }
  return best;
}

/**
 * 竖直往下找：从 (x, from, z) 往下，碰到的最高的道具表面有多高。下面没有道具返回 null（就是地面）。
 * solids 用哪个坐标都行，返回的高度也是那个坐标里的
 */
export function topUnder(solids: readonly PropSolid[], x: number, z: number, from: number): number | null {
  let best: number | null = null;
  for (const { points: p, indices, min, max } of solids) {
    if (x < min[0] || x > max[0] || z < min[2] || z > max[2] || min[1] > from) continue;
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3;
      const b = indices[t + 1] * 3;
      const c = indices[t + 2] * 3;
      // 从上往下看，(x, z) 在不在这个三角形里（重心坐标）
      const d = (p[b + 2] - p[c + 2]) * (p[a] - p[c]) + (p[c] - p[b]) * (p[a + 2] - p[c + 2]);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((p[b + 2] - p[c + 2]) * (x - p[c]) + (p[c] - p[b]) * (z - p[c + 2])) / d;
      const v = ((p[c + 2] - p[a + 2]) * (x - p[c]) + (p[a] - p[c]) * (z - p[c + 2])) / d;
      const w = 1 - u - v;
      if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
      const y = u * p[a + 1] + v * p[b + 1] + w * p[c + 1];
      if (y <= from && (best === null || y > best)) best = y;
    }
  }
  return best;
}
