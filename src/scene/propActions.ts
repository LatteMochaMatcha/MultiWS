/**
 * 一键动作（见 docs/props-plan.md）：选中一件道具，点一下，当前角色就坐上去、躺上去、两手撑着台面、一只手扶着、背靠着，
 * 或者吊在横杆上、腿缠在竖杆上；或者把道具拿到身上来——一只手拿着、两手端着、抱着、举过头顶（见 docs/grab-plan.md 第 6 期）。
 *
 * 每个动作做三件事：角色站到哪（位置、朝向、离地多高）、换成什么姿势、摆好以后和道具怎么连着
 * （坐、躺、靠、吊、缠是整个人跟着道具；撑、扶是手抓着道具；拿、端、抱、举是道具跟着手或者胸口，角色站在原地不动，见 model/links.ts）。
 * 坐、躺、撑照道具标的接触面找地方（props/contacts.ts），面有多高从网格上量；扶、靠哪件道具都行，照网格找最近的面。
 * 吊、缠只认杆（杆，或者细长的箱子）：照它的尺寸和朝向算（barOf）。
 * 只管两条腿的人形（手臂、头、上半身几个都行）：别的身体按钮是灰的（actionBlock 说原因）。
 * 都是纯函数：坐标是场景的（米），角色自己的坐标用 Place 换。
 */
import { tk } from '../i18n';
import { type Quat, type V3, lerp, len, madd, mul, quatMul, sub } from '../geometry/vec';
import { BODY_LINK, type PropLink, linkOf, liveLinks, propLocal, putDown, setLink, withCarry, withGrip } from '../model/links';
import { type SceneProp, propPoint } from '../model/props';
import type { Vec3 } from '../model/spec';
import { type Place, clampPlace, placeY } from '../model/scene';
import { fitArms, followArms } from '../pose/fit';
import { armOfBone, followPair } from '../pose/follow';
import { POSE_LIBRARY } from '../pose/library';
import type { Limb } from '../pose/limbs';
import { type Posing, emptyPosing } from '../pose/posing';
import { type PoseState, cloneState, forward, restState, setWorldRot, shiftRoot, tailOf } from '../pose/rig';
import { isRingRig } from '../pose/ring';
import { capturePins, dragBend, dragBody, dragReach, reachOnly } from '../pose/solve';
import { type Solver, posingOf, stateOf } from '../pose/solver';
import { type ContactRect, type PropContacts, type SitSpot, propContacts } from '../props/contacts';
import { type Bar, barOf } from './bar';
import { chestBone, grabLink, holdState, holdTargets, linkTo, rideLink, sceneRot, topUnder } from './follow';
import { PALM, STANDARD, gripHand, handRot, palmLength, tallOf } from './grip';
import { fromScene, toScene } from './interact';
import { type PropSolid, closestOnSolid, insideSolid, propSolid } from './propTouch';

export type PropAction = 'sit' | 'lie' | 'top' | 'hold' | 'lean' | 'hang' | 'wrap' | 'carry' | 'both' | 'hug' | 'lift';

/** 把道具拿到身上来的那四个（道具跟着人走，人站在原地）；别的都是人到道具那里去 */
export type PickAction = 'carry' | 'both' | 'hug' | 'lift';
export const isPickAction = (action: PropAction): action is PickAction => action === 'carry' || action === 'both' || action === 'hug' || action === 'lift';

/** 面板上的那一排按钮：名字和说明 */
export const PROP_ACTIONS: readonly { key: PropAction; name: string; tip: string }[] = [
  { key: 'sit', name: tk('坐上去'), tip: tk('坐到这件道具上：有靠背的朝前坐，没靠背的坐在离角色最近的那一边；脚够得着就踩着地，够不着就垂着。坐好以后整个人跟着它') },
  { key: 'lie', name: tk('躺上去'), tip: tk('仰面躺到这件道具上。躺好以后整个人跟着它') },
  { key: 'top', name: tk('手撑着'), tip: tk('站到离得最近的那一边，两只手撑在台面上。撑好以后两只手留在它上面：挪它、转它，手跟着') },
  { key: 'hold', name: tk('手扶着'), tip: tk('一只手扶（握）在这件道具上：够得着就原地伸手、别的姿势不动，够不着就走过去站好再伸手。头顶的横杆（公交车的拉杆）是站到下面举手握住。扶好以后这只手抓着它：挪它、转它，手跟着；再点一次换另一只手') },
  { key: 'lean', name: tk('背靠着'), tip: tk('走到这件道具跟前，背过身靠在上面。靠好以后整个人跟着它') },
  { key: 'hang', name: tk('吊着'), tip: tk('两只手握着横杆吊在下面：杆够高就整个人悬空，矮一点就屈着膝。吊好以后整个人跟着它。要一根横着的杆（选中杆点「横过来」）') },
  { key: 'wrap', name: tk('腿缠杆'), tip: tk('两只手握着竖杆，身体离地，两条腿一高一低勾在杆上。缠好以后整个人跟着它。要一根竖着的杆') },
  { key: 'carry', name: tk('拿着'), tip: tk('一只手拿着这件道具：杆、棍子是握着，别的是托在手心上。角色站在原地，道具到手上来，之后跟着这只手走；再点一次换另一只手') },
  { key: 'both', name: tk('两手端着'), tip: tk('两只手一左一右端着这件道具，在身前；杆是横着握。角色站在原地，道具到手上来，之后跟着手走') },
  { key: 'hug', name: tk('抱着'), tip: tk('把这件道具抱在胸前，两只手搂着它。之后它跟着胸口走：弯腰、转身、挪角色都带着') },
  { key: 'lift', name: tk('举过头顶'), tip: tk('两只手把这件道具举过头顶；杆是横着举。角色站在原地，道具到手上来，之后跟着手走') },
];

export interface ActionInput {
  /** 角色的骨架（静止姿势） */
  solver: Solver;
  /** 角色现在站在哪、摆着什么姿势、连着什么 */
  place: Place;
  posing: Posing;
  links?: readonly PropLink[];
  /** 对着哪件道具做；props 是场景里全部的道具（脚下、手下还有没有别的东西要看它们） */
  prop: SceneProp;
  props: readonly SceneProp[];
  /** 摆姿势里「几对手臂」开着「一起动」：伸手的那一对摆好以后，多出来的几对照它摆；不开就垂着（照现成姿势的留着） */
  follow?: boolean;
}

export interface ActionResult {
  place: Place;
  posing: Posing;
  links: readonly PropLink[];
  /** 没够着的手有几只（照够得着的摆了） */
  missed: number;
  /** 手扶着：用的是哪只手（Limb.name）；walked：是走过去的 */
  part?: string;
  walked?: boolean;
}
export type ActionOutcome = ActionResult | { error: string };

const RAD = Math.PI / 180;
/** 量身体各处留多少时的标准身高（米）：别的身高照比例（和 interact.ts 的胶囊体一样） */
/** 坐、躺、撑的道具最多能歪多少度：再歪就先摆正 */
const TILT_MAX = 5;
/** 坐着、躺着时胯的关节比坐面高多少（标准身高时，米）：和拖胯停在表面上留的一样（main.ts 的 TOUCH_ROOM.body） */
const RISE = 0.1;
/** 躺着时胯的关节比床面高多少：躺平了背比胯低一点 */
const LIE_RISE = 0.12;
/** 头的半径（和 interact.ts 的胶囊体一样）；躺着时脚踝比垫着它的东西高多少 */
const HEAD_R = 0.095;
const FOOT_ROOM = 0.07;
/** 手腕比扶着、撑着的面高（远）多少 */
/** 坐在有靠背的椅子上，胯的关节离靠背多远 */
const BACK = 0.15;
/** 手撑台面：站在离台子边多远的地方、手撑在台子边往里多少、两只手离正中各多远 */
const STAND = 0.22;
const TOP_IN = 0.14;
const TOP_SPREAD = 0.19;
/** 背靠着：脚离道具多远、胯的关节离道具多远 */
const FEET = 0.3;
const LEAN_GAP = 0.11;
/** 走过去扶：站在离道具多远的地方 */
const HOLD_AT = 0.42;
/** 手离目标差得比这个多算没够着 */
const MISS = 0.06;

const NO_SPOT: Record<'sit' | 'lie' | 'top', string> = {
  sit: tk('这件道具上没有能坐的地方'),
  lie: tk('这件道具上没有能躺的地方'),
  top: tk('这件道具上没有能撑手的台面'),
};
const NO_ARMS = tk('这个角色没有手臂');
const NO_BAR = tk('这个动作要一根杆：放一根「杆」，或者细长的箱子');
const BAR_FLAT = tk('杆要横着才吊得上去：选中它点「横过来」');
const BAR_UPRIGHT = tk('杆要竖着才缠得上去：选中它点「竖起来」（或者「摆正」）');
const BAR_THICK = tk('这根杆太粗，握不住');
const NOT_BIPED = tk('一键动作只管两条腿的人形；这个身体请自己摆（摆好以后可以点「整个人跟着」「抓住」「踩住」）');
const TILTED = tk('这件道具歪着：先点「摆正」');

const wrap = (deg: number) => {
  const w = ((((deg + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
};
const fail = (error: string): ActionOutcome => ({ error });

const legsOf = (solver: Solver): Limb[] => solver.limbs.filter((l) => l.kind === 'leg');
/** 第一对手臂（多出来的几对不伸手） */
const armsOf = (solver: Solver): Limb[] => solver.limbs.filter((l) => l.kind === 'arm' && l.pair === 0);

/** 是不是两条腿的人形（一左一右；围成一圈的、背对背的不算） */
function biped(solver: Solver): boolean {
  const legs = legsOf(solver);
  return !isRingRig(solver.rig) && legs.length === 2 && legs[0].side * legs[1].side === -1;
}

/**
 * 这个动作现在做不了的原因（按钮变灰，原因写在提示里）；能做返回 null。
 * 只查一眼看得出来的（身体、道具有没有那种面、歪没歪）；台面太高太矮这类要量的，点了以后再说
 */
export function actionBlock(action: PropAction, solver: Solver, prop: SceneProp): string | null {
  if (!biped(solver)) return NOT_BIPED;
  if (action !== 'sit' && action !== 'lie' && action !== 'lean' && !armsOf(solver).length) return NO_ARMS;
  if (isPickAction(action)) return pickBlock(action, solver, prop);
  if (action === 'hold' || action === 'lean') return null;
  if (action === 'hang' || action === 'wrap') {
    const bar = barOf(prop);
    if (!bar) return NO_BAR;
    if (bar.r > BAR_R_MAX) return BAR_THICK;
    if (action === 'hang') return bar.pitch > HANG_PITCH ? BAR_FLAT : null;
    return bar.pitch < 90 - TILT_MAX ? BAR_UPRIGHT : null;
  }
  if (!propContacts(prop)[action]) return NO_SPOT[action];
  if (Math.abs(prop.rot[0]) > TILT_MAX || Math.abs(prop.rot[2]) > TILT_MAX) return TILTED;
  return null;
}

/* ---------------- 共用的 ---------------- */

/** 做一个动作要用的东西 */
interface Ctx extends ActionInput {
  /** 身高比标准身高 */
  k: number;
  height: number;
  /** 这件道具、全部道具的网格（场景坐标） */
  solid: PropSolid;
  solids: PropSolid[];
  contacts: PropContacts;
  /** 角色现在站的地方在道具自己的坐标里（左右、前后，米） */
  me: [number, number];
}

/**
 * 接触面上的一套方向（道具自己的坐标，从上往下看）：U 是「朝前」（坐下来脸朝的、躺下来脚朝的那一边），
 * V 是那时角色的左手边；u0–u1、v0–v1 是这块地方在两个方向上从哪到哪（米）
 */
interface Span {
  face: number;
  U: [number, number];
  V: [number, number];
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

function spanOf(rect: ContactRect, size: Vec3, face: number): Span {
  const U: [number, number] = [Math.sin(face * RAD), Math.cos(face * RAD)];
  const V: [number, number] = [Math.cos(face * RAD), -Math.sin(face * RAD)];
  const span: Span = { face, U, V, u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity };
  for (const fx of rect.x) {
    for (const fz of rect.z) {
      const u = fx * size[0] * U[0] + fz * size[2] * U[1];
      const v = fx * size[0] * V[0] + fz * size[2] * V[1];
      span.u0 = Math.min(span.u0, u);
      span.u1 = Math.max(span.u1, u);
      span.v0 = Math.min(span.v0, v);
      span.v1 = Math.max(span.v1, v);
    }
  }
  return span;
}

/** 没有固定朝向的面（箱子、桌子、床沿）：用离角色最近的那一边，脸朝外 */
function nearestSide(rect: ContactRect, size: Vec3, me: [number, number], sides: readonly number[] = [0, 180, 90, -90]): Span {
  let best: Span | null = null;
  let bestOut = -Infinity;
  for (const face of sides) {
    const span = spanOf(rect, size, face);
    const out = me[0] * span.U[0] + me[1] * span.U[1] - span.u1;
    if (out > bestOut + 1e-9) {
      best = span;
      bestOut = out;
    }
  }
  return best!;
}

/** 圆的面（凳子、圆桌、球）：朝角色现在那一边；角色就在正中的话照它现在的朝向 */
function roundSide(rect: ContactRect, c: Ctx): Span {
  const { size } = c.prop;
  const cx = ((rect.x[0] + rect.x[1]) / 2) * size[0];
  const cz = ((rect.z[0] + rect.z[1]) / 2) * size[2];
  const r = Math.min((rect.x[1] - rect.x[0]) * size[0], (rect.z[1] - rect.z[0]) * size[2]) / 2;
  const dx = c.me[0] - cx;
  const dz = c.me[1] - cz;
  const face = Math.hypot(dx, dz) > 0.02 ? Math.atan2(dx, dz) / RAD : c.place.yaw - c.prop.rot[1];
  const span = spanOf(rect, size, face);
  const u = cx * span.U[0] + cz * span.U[1];
  const v = cx * span.V[0] + cz * span.V[1];
  return { ...span, u0: u - r, u1: u + r, v0: v - r, v1: v + r };
}

/** 接触面上的一点（沿 U、V 各多远）在场景里的哪（左右、前后） */
function spot(c: Ctx, span: Span, u: number, v: number): [number, number] {
  const p = propPoint(c.prop, [span.U[0] * u + span.V[0] * v, 0, span.U[1] * u + span.V[1] * v]);
  return [p[0], p[2]];
}

/** 角色现在站的地方沿 V 在哪 */
const sideways = (c: Ctx, span: Span) => c.me[0] * span.V[0] + c.me[1] * span.V[1];

/** value 收进 lo–hi 里、两头各留 margin；地方不够宽就取正中 */
const within = (value: number, lo: number, hi: number, margin: number) =>
  hi - lo < margin * 2 ? (lo + hi) / 2 : Math.max(lo + margin, Math.min(hi - margin, value));

/** 这一点下面的地面有多高：地面是 0，上面有道具的是道具的顶面 */
const floorAt = (c: Ctx, at: [number, number], from: number) => Math.max(0, topUnder(c.solids, at[0], at[1], from) ?? 0);

/** 角色朝 yaw 站着、离地 y，它自己坐标里的 local 这一点（只看左右、前后）落在场景的 at 上：它该站在哪 */
function placeFor(yaw: number, y: number, local: V3, at: [number, number]): Place {
  const cos = Math.cos(yaw * RAD);
  const sin = Math.sin(yaw * RAD);
  return clampPlace({ x: at[0] - (cos * local[0] + sin * local[2]), z: at[1] - (-sin * local[0] + cos * local[2]), yaw, y });
}

/** 一个现成姿势落到这副骨架上（多出来的几对手臂跟着摆，和界面上套现成姿势一样） */
function libraryState(solver: Solver, name: string): PoseState {
  const lib = POSE_LIBRARY.find((p) => p.name === name)?.posing;
  return stateOf(solver, lib ? followArms(solver, fitArms(solver, lib)).posing : emptyPosing());
}

/** 立正站着，手臂（每一对）照一个现成姿势摆 */
function standing(solver: Solver, arms: string): PoseState {
  const want = libraryState(solver, arms);
  const state = restState(solver.rig);
  solver.rig.names.forEach((_, j) => {
    if (armOfBone(solver, j)) state.local[j] = want.local[j];
  });
  return state;
}

const limbIndex = (solver: Solver, limb: Limb) => solver.limbs.indexOf(limb);

/* ---------------- 坐上去 ---------------- */

/** 脚从脚踝到脚尖，从上面看有多长（静止姿势） */
function footReach(solver: Solver, leg: Limb, k: number): number {
  const { rig } = solver;
  const ankle = rig.head[leg.end];
  let reach = 0;
  rig.names.forEach((_, j) => {
    let under = j === leg.end;
    for (let p = rig.parent[j]; p >= 0 && !under; p = rig.parent[p]) under = p === leg.end;
    if (under) reach = Math.max(reach, Math.hypot(rig.tail[j][0] - ankle[0], rig.tail[j][2] - ankle[2]));
  });
  return Math.max(reach, 0.08 * k);
}

function sit(c: Ctx): ActionOutcome {
  if (!c.contacts.sit) return fail(NO_SPOT.sit);
  const { solver, k, prop } = c;
  // 能坐的地方不止一处（野餐桌的两条凳）：坐离角色现在站的地方最近的那一处
  const away = (s: SitSpot) =>
    Math.hypot(((s.rect.x[0] + s.rect.x[1]) / 2) * prop.size[0] - c.me[0], ((s.rect.z[0] + s.rect.z[1]) / 2) * prop.size[2] - c.me[1]);
  const seat = [c.contacts.sit, ...(c.contacts.sit.also ?? [])].reduce((a, b) => (away(b) < away(a) ? b : a));
  const { rig } = solver;
  const legs = legsOf(solver);
  const thigh = Math.max(...legs.map((l) => l.len1));
  const backed = !seat.round && seat.face !== undefined;
  const span = seat.round ? roundSide(seat.rect, c) : backed ? spanOf(seat.rect, prop.size, seat.face!) : nearestSide(seat.rect, prop.size, c.me, seat.sides);
  const depth = span.u1 - span.u0;
  // 膝盖正好伸出前沿一点；有靠背的再往后也不超过靠背，没靠背的坐面不够深就坐在正中
  const reach = thigh - 0.04 * k;
  const hipU = backed ? Math.max(span.u0 + BACK * k, span.u1 - reach) : span.u1 - Math.min(reach, Math.max(depth / 2, depth - BACK * k));
  const hipV = seat.round ? (span.v0 + span.v1) / 2 : within(sideways(c, span), span.v0, span.v1, 0.2 * k);
  const hip = spot(c, span, hipU, hipV);
  const from = seat.under ? prop.pos[1] + prop.size[1] * seat.under : c.solid.max[1] + 0.01;
  const middle = spot(c, span, (span.u0 + span.u1) / 2, (span.v0 + span.v1) / 2);
  let H = topUnder([c.solid], hip[0], hip[1], from) ?? topUnder([c.solid], middle[0], middle[1], from);
  if (H === null) return fail(NO_SPOT.sit);
  // 坐面前头翘起来的（斗形的转椅）：大腿压着的那一段里最高的地方也要让开，不然大腿插在坐垫里
  // （两条大腿各自那一道都量：斗形的坐面两边也是翘的）
  for (const f of [0.35, 0.7, 1]) {
    for (const side of [-0.09, 0, 0.09]) {
      const v = Math.max(span.v0, Math.min(span.v1, hipV + side * k));
      const under = spot(c, span, Math.min(hipU + thigh * 0.85 * f, span.u1 - 0.02 * k), v);
      const y = topUnder([c.solid], under[0], under[1], from);
      if (y !== null && y - 0.01 * k > H) H = y - 0.01 * k;
    }
  }
  const yaw = wrap(prop.rot[1] + span.face);
  // 脚落在哪一层：地面，或者脚下别的道具（椅子放在台子上）
  const foot: [number, number] = [hip[0] + Math.sin(yaw * RAD) * thigh, hip[1] + Math.cos(yaw * RAD) * thigh];
  // 只认比坐面低一大截的：坐面自己的前沿、床帮这类紧挨着坐面的不是踩脚的地方
  const floor = floorAt(c, foot, H - 0.3 * k);

  let state = libraryState(solver, '坐着');
  let f = forward(rig, state);
  const place = placeFor(yaw, floor, f.pos[rig.hips], hip);
  shiftRoot(rig, state, f, sub(fromScene(place, [hip[0], H + RISE * k, hip[1]]), f.pos[rig.hips]));
  f = forward(rig, state);
  // 腿：大腿放平，脚够得着地就踩着（坐得矮膝盖抬起来），够不着就垂着
  const gaps: number[] = [];
  for (const leg of legs) {
    const joint = f.pos[leg.upper];
    const ankle = Math.max(0, rig.head[leg.end][1]);
    const hang = joint[1] - leg.len2 * 0.98;
    gaps.push(hang - ankle);
    state = reachOnly(solver, state, limbIndex(solver, leg), [f.pos[leg.end][0], Math.max(ankle, hang), joint[2] + leg.len1 * 0.98]);
  }
  // 脚够不着地：脚尖往下点（差得不多时脚尖正好点着地）
  f = forward(rig, state);
  legs.forEach((leg, i) => {
    if (gaps[i] <= 0.005) return;
    const pitch = Math.asin(Math.min(0.6, gaps[i] / footReach(solver, leg, k)));
    const turn: Quat = [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)];
    setWorldRot(rig, state, f, leg.end, quatMul(turn, f.rot[leg.end]));
  });
  // 手搭在大腿上
  f = forward(rig, state);
  for (const arm of armsOf(solver)) {
    const leg = legs.find((l) => l.side === arm.side);
    if (!leg) continue;
    const on = lerp(f.pos[leg.upper], f.pos[leg.lower], 0.55);
    state = reachOnly(solver, state, limbIndex(solver, arm), [on[0] + arm.side * 0.01 * k, on[1] + 0.1 * k, on[2]]);
  }
  if (c.follow) state = followPair(solver, state, 0);
  return { place, posing: posingOf(solver, state, c.posing), links: [rideLink(prop, place)], missed: 0 };
}

/* ---------------- 躺上去 ---------------- */

function lie(c: Ctx): ActionOutcome {
  const bed = c.contacts.lie;
  if (!bed) return fail(NO_SPOT.lie);
  const { solver, k, prop } = c;
  const { rig } = solver;
  const state = libraryState(solver, '仰面躺着');
  const f = forward(rig, state);
  // 现成的躺姿头朝后（-Z）：头顶在它自己的前后方向上的哪
  let head = Infinity;
  rig.names.forEach((_, j) => {
    head = Math.min(head, f.pos[j][2], tailOf(rig, f, j)[2]);
  });
  const span = spanOf(bed.rect, prop.size, bed.turn);
  // 头顶挨着这块地方靠头的那一头；左右照角色现在在哪一边，别躺到边上去
  const headU = span.u0 + 0.05 * k;
  const lat = within(sideways(c, span), span.v0, span.v1, 0.3 * k);
  const hips = f.pos[rig.hips];
  const hip = spot(c, span, headU + (hips[2] - head), lat + hips[0]);
  const from = bed.under ? prop.pos[1] + prop.size[1] * bed.under : c.solid.max[1] + 0.01;
  const middle = spot(c, span, (span.u0 + span.u1) / 2, (span.v0 + span.v1) / 2);
  const H = topUnder([c.solid], hip[0], hip[1], from) ?? topUnder([c.solid], middle[0], middle[1], from);
  if (H === null) return fail(NO_SPOT.lie);
  const place = placeFor(wrap(prop.rot[1] + bed.turn), H + LIE_RISE * k - hips[1], hips, hip);
  // 头底下垫着东西（枕头、沙发的扶手）：脖子抬起来，头枕在上面
  let now = forward(rig, state);
  rig.names.forEach((name, j) => {
    if (!/^Head/.test(name)) return;
    const pivot = /^Neck/.test(rig.names[rig.parent[j]] ?? '') ? rig.parent[j] : j;
    const centre = lerp(now.pos[j], tailOf(rig, now, j), 0.5);
    const at = toScene(place, centre);
    const under = topUnder([c.solid], at[0], at[2], from);
    const lift = under === null ? 0 : under + (HEAD_R - 0.02) * k - at[1];
    const arm = len(sub(centre, now.pos[pivot]));
    if (lift < 0.01 || arm < 1e-3) return;
    const angle = Math.asin(Math.min(0.64, lift / arm));
    setWorldRot(rig, state, now, pivot, quatMul([Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)], now.rot[pivot]));
    now = forward(rig, state);
  });
  // 脚底下垫着东西（躺不下、脚伸到了扶手上）：脚搭在上面
  let posed = state;
  for (const leg of legsOf(solver)) {
    const foot = toScene(place, forward(rig, posed).pos[leg.end]);
    const under = topUnder([c.solid], foot[0], foot[2], from);
    if (under !== null && foot[1] < under + FOOT_ROOM * k - 0.01) posed = reachOnly(solver, posed, limbIndex(solver, leg), fromScene(place, [foot[0], under + FOOT_ROOM * k, foot[2]]));
  }
  return { place, posing: posingOf(solver, posed, c.posing), links: [rideLink(prop, place)], missed: 0 };
}

/* ---------------- 手撑着 ---------------- */

function top(c: Ctx): ActionOutcome {
  const table = c.contacts.top;
  if (!table) return fail(NO_SPOT.top);
  const { solver, k, prop } = c;
  const { rig } = solver;
  const arms = armsOf(solver);
  if (!arms.length) return fail(NO_ARMS);
  const span = table.round ? roundSide(table.rect, c) : nearestSide(table.rect, prop.size, c.me);
  const lat = table.round ? (span.v0 + span.v1) / 2 : within(sideways(c, span), span.v0, span.v1, 0.25 * k);
  const inward = Math.min(TOP_IN * k, (span.u1 - span.u0) / 2);
  const spread = Math.max(0.05 * k, Math.min(TOP_SPREAD * k, (span.v1 - span.v0) / 2 - 0.04 * k));
  const from = c.solid.max[1] + 0.01;
  const mid = spot(c, span, span.u1 - inward, lat);
  const H = topUnder([c.solid], mid[0], mid[1], from);
  if (H === null) return fail(NO_SPOT.top);
  const stand = spot(c, span, span.u1 + STAND * k, lat);
  const floor = floorAt(c, stand, H - 0.03);
  if (H - floor < 0.36 * c.height) return fail(tk('台面太矮，撑不着'));
  if (H - floor > 0.8 * c.height) return fail(tk('台面太高，撑不着'));
  // 面朝台子站着
  const place = clampPlace({ x: stand[0], z: stand[1], yaw: wrap(prop.rot[1] + span.face + 180), y: floor });
  let state = standing(solver, '自然站立');
  const held = new Set(legsOf(solver).map((l) => l.name));
  let missed = 0;
  for (const arm of arms) {
    // 角色面朝台子：它的左手边是 -V
    const at = spot(c, span, span.u1 - inward, lat - arm.side * spread);
    const target: V3 = [at[0], (topUnder([c.solid], at[0], at[1], from) ?? H) + PALM * k, at[1]];
    state = dragReach(solver, state, limbIndex(solver, arm), fromScene(place, target), capturePins(solver, forward(rig, state), held));
    held.add(arm.name);
    if (len(sub(toScene(place, forward(rig, state).pos[arm.end]), target)) > MISS * k) missed++;
  }
  if (c.follow) state = followPair(solver, state, 0);
  // 手掌转过去贴着台面，手指照台面握上；连接带着握紧度
  const links: PropLink[] = [];
  for (const arm of arms) {
    const got = grabLink(solver, state, place, prop, arm.name, 1);
    if (!got) continue;
    state = got.state;
    links.push(got.link);
  }
  state = holdState(solver, state, holdTargets(place, links, [prop]), { grip: 'always' });
  return { place, posing: posingOf(solver, state, c.posing), links, missed };
}

/* ---------------- 手扶着 ---------------- */

function hold(c: Ctx): ActionOutcome {
  const { solver, k, prop, solid } = c;
  const { rig } = solver;
  const arms = armsOf(solver);
  if (!arms.length) return fail(NO_ARMS);
  // 头顶的横杆：站到下面举手握住
  const over = holdOverhead(c, arms);
  if (over) return over;
  const live = liveLinks(c.links, c.props);
  const riding = Boolean(linkOf(live, BODY_LINK));
  let place = c.place;
  // 还没摆过姿势的（手臂张着）：先垂下手
  let state = c.posing.root || Object.keys(c.posing.bones).length ? stateOf(solver, c.posing) : standing(solver, '自然站立');
  /** 站在 place 时：用哪只手、手腕去哪、离肩膀有手臂的几成远 */
  const aim = () => {
    const f = forward(rig, state);
    // 道具在角色的哪一边就用哪只手（正前方的用右手）；那只手已经抓着别的了就换另一只
    const chest = mul(arms.map((a) => f.pos[a.upper]).reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]), 1 / arms.length);
    const near = fromScene(place, closestOnSolid(solid, toScene(place, chest)).point);
    const prefer = arms.find((a) => a.side === (near[0] > 0.03 * k ? 1 : -1)) ?? arms[0];
    const free = (a: Limb) => !linkOf(live, a.name);
    const arm = free(prefer) ? prefer : (arms.find(free) ?? prefer);
    const reach = arm.len1 + arm.len2;
    const shoulder = toScene(place, f.pos[arm.upper]);
    // 顺手的地方：肩膀前面、比肩膀低一点。扶的是道具上离那里最近的一点
    const yaw = place.yaw * RAD;
    const ref: V3 = [shoulder[0] + Math.sin(yaw) * reach * 0.6, shoulder[1] - reach * 0.35, shoulder[2] + Math.cos(yaw) * reach * 0.6];
    const hit = closestOnSolid(solid, ref);
    let out: V3 = hit.dist > 1e-6 ? mul(sub(ref, hit.point), 1 / hit.dist) : [0, 1, 0];
    if (insideSolid(solid, ref)) out = mul(out, -1);
    const target = madd(hit.point, out, PALM * k);
    return { arm, target, far: len(sub(target, shoulder)) / reach };
  };
  let got = aim();
  let walked = false;
  if (got.far > 0.97 && !riding) {
    // 够不着：走到道具跟前，面朝它
    const near = closestOnSolid(solid, [place.x, placeY(place) + 0.6 * c.height, place.z]).point;
    let dx = place.x - near[0];
    let dz = place.z - near[2];
    let d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      dx = -Math.sin(place.yaw * RAD);
      dz = -Math.cos(place.yaw * RAD);
      d = 1;
    }
    const at: [number, number] = [near[0] + (dx / d) * HOLD_AT * k, near[2] + (dz / d) * HOLD_AT * k];
    place = clampPlace({ x: at[0], z: at[1], yaw: Math.atan2(-dx, -dz) / RAD, y: floorAt(c, at, placeY(place) + 0.3 * c.height) });
    // 走过去以后站直、垂着手再伸手：原来的姿势是照原来那个地方摆的（坐着、撑着桌子），带过来对不上
    state = standing(solver, '自然站立');
    walked = true;
    got = aim();
  }
  // 脚留在原地；别的抓着、踩着道具的手脚也留着（走过去的话它们都松开了）
  const keep = new Set(legsOf(solver).map((l) => l.name));
  if (!walked) for (const link of live) if (link.part !== BODY_LINK && link.part !== got.arm.name) keep.add(link.part);
  state = dragReach(solver, state, limbIndex(solver, got.arm), fromScene(place, got.target), capturePins(solver, forward(rig, state), keep));
  if (c.follow) state = followPair(solver, state, 0);
  const wrist = toScene(place, forward(rig, state).pos[got.arm.end]);
  const missed = len(sub(wrist, got.target)) > MISS * k ? 1 : 0;
  if (missed && riding) return fail(tk('够不着：先把道具挪近一点'));
  const base = walked ? [] : (c.links ?? []);
  // 手掌转过去对着道具（杆是握在四指根部），手指照它的形状握上；连接带着握紧度
  const grabbed = grabLink(solver, state, place, prop, got.arm.name, 1)!;
  state = holdState(solver, grabbed.state, holdTargets(place, [grabbed.link], [prop]), { grip: 'always' });
  return {
    place,
    posing: posingOf(solver, state, c.posing),
    links: setLink(base, grabbed.link),
    missed,
    part: got.arm.name,
    walked,
  };
}

/* ---------------- 背靠着 ---------------- */

function lean(c: Ctx): ActionOutcome {
  const { solver, k, height, prop, solid } = c;
  const { rig } = solver;
  /** 站在这里、离地 y 时，道具上离腰最近的一点 */
  const waist = (x: number, z: number, y: number) => closestOnSolid(solid, [x, y + 0.55 * height, z]).point;
  let near = waist(c.place.x, c.place.z, placeY(c.place));
  let dx = c.place.x - near[0];
  let dz = c.place.z - near[2];
  let d = Math.hypot(dx, dz);
  if (d < 1e-3) {
    // 就站在道具里面：照现在的朝向往前走出来
    dx = Math.sin(c.place.yaw * RAD);
    dz = Math.cos(c.place.yaw * RAD);
    d = 1;
  }
  let at: [number, number] = [near[0] + (dx / d) * FEET * k, near[2] + (dz / d) * FEET * k];
  const floor = floorAt(c, at, placeY(c.place) + 0.3 * height);
  // 换到新站的地方、新的高度再找一遍
  near = waist(at[0], at[1], floor);
  if (Math.abs(near[1] - (floor + 0.55 * height)) > 0.15 * height) return fail(tk('这件道具太矮，靠不住'));
  if (Math.hypot(at[0] - near[0], at[1] - near[2]) > 1e-3) {
    dx = at[0] - near[0];
    dz = at[1] - near[2];
    d = Math.hypot(dx, dz);
    at = [near[0] + (dx / d) * FEET * k, near[2] + (dz / d) * FEET * k];
  }
  // 背对着道具
  const place = clampPlace({ x: at[0], z: at[1], yaw: Math.atan2(dx, dz) / RAD, y: floor });
  let state = standing(solver, '抱着胳膊');
  const f = forward(rig, state);
  const hips = f.pos[rig.hips];
  const pins = capturePins(solver, f, new Set(legsOf(solver).map((l) => l.name)));
  // 脚不动，胯往后靠到道具上（腿斜了，人矮下去一点）
  state = dragBody(solver, state, [hips[0], hips[1] - 0.03 * k, (LEAN_GAP - FEET) * k], pins);
  return { place, posing: posingOf(solver, state, c.posing), links: [rideLink(prop, place)], missed: 0 };
}

/* ---------------- 杆 ---------------- */

/** 多粗的杆还握得住（半径，米）；箱子的两个短边都不超过这么宽才算杆 */
const BAR_R_MAX = 0.09;
/** 吊着：杆最多能斜多少度 */
const HANG_PITCH = 15;

export { type Bar, barOf };

/**
 * 一只手握住这件道具：手掌先摆成四指朝 fingers、手心朝 palm（角色自己的坐标，两个方向互相垂直），
 * 手指再照道具的形状握上（见 grip.ts）。solid 是道具的网格，也在角色自己的坐标里。没有手指骨骼的手只转手掌
 */
function gripAt(solver: Solver, state: PoseState, arm: Limb, fingers: V3, palm: V3, solid: PropSolid, k: number): PoseState {
  const hand = solver.hands.find((h) => h.bone === arm.end);
  if (!hand) return state;
  const turned = cloneState(state);
  setWorldRot(solver.rig, turned, forward(solver.rig, state), hand.bone, handRot(hand, fingers, mul(palm, -1)));
  return gripHand(solver, turned, hand, solid, k, 1);
}

/** 做完动作以后，握着道具的那几只手和道具连上（带握紧度：道具改了粗细，手指跟着重新握） */
const gripLinks = (solver: Solver, state: PoseState, place: Place, prop: SceneProp, arms: readonly Limb[]): PropLink[] => {
  const f = forward(solver.rig, state);
  return arms.map((arm) => withGrip(linkTo(prop, arm.name, toScene(place, f.pos[arm.end]), undefined, sceneRot(place, f.rot[arm.end])), 1));
};

/** 手腕到四指根部多远（握杆时杆在四指根部那里） */
const palmOf = (solver: Solver, arm: Limb) => {
  const hand = solver.hands.find((h) => h.bone === arm.end);
  return hand ? palmLength(solver, hand) : len(sub(solver.rig.tail[arm.end], solver.rig.head[arm.end])) * 0.8;
};

/** 肘、膝朝 toward 那边弯（手脚不动） */
const bendTo = (solver: Solver, state: PoseState, limb: Limb, toward: V3) => dragBend(solver, state, limbIndex(solver, limb), toward);

/** 绕前后那根轴（Z）转 deg 度 */
const rollZ = (deg: number): Quat => [0, 0, Math.sin((deg * RAD) / 2), Math.cos((deg * RAD) / 2)];
/** 绕左右那根轴（X）转 deg 度：脚尖往下压 */
const pitchX = (deg: number): Quat => [Math.sin((deg * RAD) / 2), 0, 0, Math.cos((deg * RAD) / 2)];

/* 手扶着的另一种：头顶有根横杆、站着举手够得着（公交车的拉杆）。站到杆下面，一只手举起来握住。不是这种情况返回 null */
function holdOverhead(c: Ctx, arms: readonly Limb[]): ActionOutcome | null {
  const bar = thinBar(c.prop);
  if (!bar || bar.pitch > HANG_PITCH) return null;
  const { solver, k, prop, height } = c;
  const { rig } = solver;
  const flat = Math.hypot(bar.b[0] - bar.a[0], bar.b[2] - bar.a[2]);
  if (flat < 1e-3) return null;
  const ux = (bar.b[0] - bar.a[0]) / flat;
  const uz = (bar.b[2] - bar.a[2]) / flat;
  const live = liveLinks(c.links, c.props);
  const riding = Boolean(linkOf(live, BODY_LINK));
  // 用哪只手：右手；它已经抓着东西了（再点一次）就换另一只
  const free = (a: Limb) => !linkOf(live, a.name);
  const arm = arms.find((a) => a.side < 0 && free(a)) ?? arms.find(free) ?? mainArm(arms);
  const reach = arm.len1 + arm.len2;
  const palm = palmOf(solver, arm);
  const back = bar.r + 0.015 * k;
  /** 肩膀在场景的这里时，握杆上离它最近的那一处：手腕该去哪（场景坐标，还没往后让） */
  const under = (shoulder: V3): V3 => {
    const along = within((shoulder[0] - bar.a[0]) * ux + (shoulder[2] - bar.a[2]) * uz, 0, flat, 0.05 * k);
    const on = lerp(bar.a, bar.b, along / flat);
    return [on[0], on[1] - palm, on[2]];
  };
  /** 举手那边的锁骨抬起来（肩膀高一点，够得更高） */
  const shrug = (from: PoseState): PoseState => {
    const collar = rig.parent[arm.upper];
    if (collar < 0 || !/^Shoulder/.test(rig.names[collar])) return from;
    const next = cloneState(from);
    const f = forward(rig, from);
    setWorldRot(rig, next, f, collar, quatMul(rollZ(arm.side * HANG_COLLAR), f.rot[collar]));
    return next;
  };
  // 杆得比头高、站着举手又够得着，才是这一种
  const rest = forward(rig, shrug(standing(solver, '自然站立')));
  const mid = under([c.place.x, 0, c.place.z]);
  const floor = floorAt(c, [mid[0], mid[2]], mid[1] - bar.r - 0.02);
  if (mid[1] + palm - bar.r - floor < 0.98 * height || mid[1] - floor > rest.pos[arm.upper][1] + reach * 0.98) return null;
  let place = c.place;
  let state = shrug(baseState(c));
  let walked = false;
  /** 站在 place、摆着 state 时手腕去哪（角色自己的坐标），离肩膀有手臂的几成远 */
  const aim = () => {
    const s = forward(rig, state).pos[arm.upper];
    const target = fromScene(place, under(toScene(place, s)));
    target[2] -= back;
    return { target, far: len(sub(target, s)) / reach };
  };
  let got = aim();
  if (got.far > 0.97) {
    if (riding) return fail(tk('够不着：先把道具挪近一点'));
    // 走到杆下面：脸朝和杆垂直的两个方向里离现在近的那个，举着的那只手的肩膀正在杆下面一点
    let yaw = Math.atan2(-uz, ux) / RAD;
    if (Math.abs(wrap(yaw - c.place.yaw)) > 90) yaw = wrap(yaw + 180);
    state = shrug(standing(solver, '自然站立'));
    const s = forward(rig, state).pos[arm.upper];
    place = placeFor(yaw, floor, [s[0], 0, s[2] + back + 0.03 * k], [mid[0], mid[2]]);
    walked = true;
    got = aim();
  }
  // 手举上去：四指朝上、手心朝前，从后面翻过去握；手肘朝外、朝前
  state = armTo(solver, state, arm, got.target, [0, 1, 0], [0, 0, 1], [arm.side * 0.4, 0.1, 0.4]);
  const missed = len(sub(forward(rig, state).pos[arm.end], got.target)) > MISS * k ? 1 : 0;
  const grabbed = grabLink(solver, state, place, prop, arm.name, 1)!;
  state = holdState(solver, grabbed.state, holdTargets(place, [grabbed.link], [prop]), { grip: 'always' });
  return { place, posing: posingOf(solver, state, c.posing), links: setLink(walked ? [] : (c.links ?? []), grabbed.link), missed, part: arm.name, walked };
}

/* ---------------- 吊着 ---------------- */

/** 吊着：两只手离正中各多远（标准身高时，米）；手臂伸到几成直；锁骨抬多少度 */
const HANG_SPREAD = 0.2;
const HANG_STRETCH = 0.96;
const HANG_COLLAR = 22;

function hang(c: Ctx): ActionOutcome {
  const bar = barOf(c.prop);
  if (!bar) return fail(NO_BAR);
  const { solver, k, prop } = c;
  const { rig } = solver;
  const arms = armsOf(solver);
  if (!arms.length) return fail(NO_ARMS);
  const legs = legsOf(solver);
  const flat = Math.hypot(bar.b[0] - bar.a[0], bar.b[2] - bar.a[2]);
  const ux = (bar.b[0] - bar.a[0]) / flat;
  const uz = (bar.b[2] - bar.a[2]) / flat;
  // 脸朝和杆垂直的两个方向里离现在的朝向近的那个
  let yaw = Math.atan2(-uz, ux) / RAD;
  if (Math.abs(wrap(yaw - c.place.yaw)) > 90) yaw = wrap(yaw + 180);
  // 角色的左手边顺着杆是哪一头
  const left = Math.cos(yaw * RAD) * ux - Math.sin(yaw * RAD) * uz > 0 ? 1 : -1;
  const spread = Math.min(HANG_SPREAD * k, flat / 2 - 0.04 * k);
  if (spread < 0.05 * k) return fail(tk('这根杆太短，两只手握不下'));
  // 吊在杆的哪一段：照角色现在站的地方，两头留出手的位置
  const along = within((c.place.x - bar.a[0]) * ux + (c.place.z - bar.a[2]) * uz, 0, flat, spread + 0.03 * k);
  /** 杆的中线上沿着杆 s 米处 */
  const on = (s: number): V3 => lerp(bar.a, bar.b, s / flat);
  const mid = on(along);

  // 先在角色自己的坐标里摆：锁骨抬起来，两只手举过头顶握在同一高度
  let state = restState(rig);
  let f = forward(rig, state);
  for (const arm of arms) {
    const collar = rig.parent[arm.upper];
    if (collar >= 0 && /^Shoulder/.test(rig.names[collar])) setWorldRot(rig, state, f, collar, quatMul(rollZ(arm.side * HANG_COLLAR), f.rot[collar]));
  }
  f = forward(rig, state);
  const barZ = arms.reduce((sum, arm) => sum + f.pos[arm.upper][2], 0) / arms.length;
  const back = bar.r + 0.015 * k;
  let barY = Infinity;
  for (const arm of arms) {
    const from = f.pos[arm.upper];
    const reach = (arm.len1 + arm.len2) * HANG_STRETCH;
    const dx = arm.side * spread - from[0];
    const dz = barZ - back - from[2];
    barY = Math.min(barY, from[1] + Math.sqrt(Math.max(0, reach * reach - dx * dx - dz * dz)) + palmOf(solver, arm));
  }
  // 脚下：地面，或者下面别的道具
  const below = c.solids.filter((s) => s.id !== prop.id);
  const floor = Math.max(0, topUnder(below, mid[0], mid[2], mid[1] - bar.r - 0.02) ?? 0);
  // 伸直了吊着，脚底在哪；比地面低的话脚要抬起来（屈膝），人还算站在地面那一层、身子往下沉
  const sole = mid[1] - barY;
  const lift = floor + 0.02 * k - sole;
  const sink = Math.max(0, floor - sole);
  const shin = Math.min(...legs.map((l) => l.len2));
  if (lift > shin * 0.92) return fail(tk('这根杆太矮，吊不起来：把它抬高一点'));
  const place = placeFor(yaw, sole + sink, [0, 0, barZ], [mid[0], mid[2]]);
  if (sink > 0) shiftRoot(rig, state, f, [0, -sink, 0]);
  const solid = propSolid(prop, place);
  let missed = 0;
  for (const arm of arms) {
    // 每只手握在杆上自己那一处（杆斜着的话两只手不一样高）
    const at = on(along + arm.side * left * spread);
    const target = fromScene(place, [at[0], at[1] - palmOf(solver, arm), at[2]]);
    target[2] -= back;
    state = reachOnly(solver, state, limbIndex(solver, arm), target);
    // 手肘朝外、稍微朝前
    const now = forward(rig, state);
    state = bendTo(solver, state, arm, [now.pos[arm.upper][0] + arm.side * 0.5, now.pos[arm.upper][1] + 0.2, now.pos[arm.upper][2] + 0.25]);
    if (len(sub(forward(rig, state).pos[arm.end], target)) > MISS * k) missed++;
    // 正握：手指朝上，手心朝前，四指从杆后面翻过去
    state = gripAt(solver, state, arm, [0, 1, 0], [0, 0, 1], solid, k);
  }
  f = forward(rig, state);
  for (const leg of legs) {
    const hip = f.pos[leg.upper];
    if (lift > 0) {
      // 杆矮、脚会碰地：大腿垂着，小腿往后收，脚抬起来
      const cos = Math.max(0, 1 - lift / leg.len2);
      const sin = Math.sqrt(1 - cos * cos);
      state = reachOnly(solver, state, limbIndex(solver, leg), [hip[0], hip[1] - leg.len1 - leg.len2 * cos, hip[2] - leg.len2 * sin]);
      state = bendTo(solver, state, leg, [hip[0], hip[1] - leg.len1, hip[2] + 0.5]);
    } else {
      // 悬空：脚尖自然往下垂
      const room = -lift;
      state.local[leg.end] = pitchX(Math.min(32, (Math.asin(Math.min(1, room / footReach(solver, leg, k))) / RAD) * 0.9));
    }
  }
  if (c.follow) state = followPair(solver, state, 0);
  // 整个人跟着杆；两只手另外抓着它（拖胯的时候手留在杆上，杆改了粗细手指跟着握）
  return { place, posing: posingOf(solver, state, c.posing), links: [rideLink(prop, place), ...gripLinks(solver, state, place, prop, arms)], missed };
}

/* ---------------- 腿缠杆 ---------------- */

/** 缠着：大腿从杆旁边过去时离杆的中线多远、小腿从杆后面过去时离多远（都另加杆的半径；标准身高时，米） */
const WRAP_THIGH = 0.06;
const WRAP_SHIN = 0.055;
/** 高的那条腿大腿抬多少度、低的那条压多少度；脚离地多高；手握的地方离杆顶至少多远 */
const WRAP_UP = 24;
const WRAP_DOWN = 26;
const WRAP_LIFT = 0.22;
const WRAP_TOP = 0.05;

function wrapPole(c: Ctx): ActionOutcome {
  const bar = barOf(c.prop);
  if (!bar) return fail(NO_BAR);
  const { solver, k, prop } = c;
  const { rig } = solver;
  const arms = armsOf(solver);
  if (!arms.length) return fail(NO_ARMS);
  const legs = legsOf(solver);
  const r = bar.r;
  // 杆在场景里的哪（竖着的：取中线的中点）；角色在它的哪一边就从哪一边缠上去，面朝杆
  const cx = (bar.a[0] + bar.b[0]) / 2;
  const cz = (bar.a[2] + bar.b[2]) / 2;
  let dx = c.place.x - cx;
  let dz = c.place.z - cz;
  if (Math.hypot(dx, dz) < 0.02) {
    dx = -Math.sin(c.place.yaw * RAD);
    dz = -Math.cos(c.place.yaw * RAD);
  }
  const yaw = Math.atan2(-dx, -dz) / RAD;

  let state = restState(rig);
  const f0 = forward(rig, state);
  // 左腿在上、右腿在下（要反过来：在「摆姿势」里点左右镜像）
  const high = legs.find((l) => l.side === 1) ?? legs[0];
  // 膝盖要伸到杆后面一点，小腿才绕得过去：照高的那条腿大腿抬的角度定身体离杆多远
  const kneeZ = Math.sqrt(Math.max(0, (high.len1 * Math.cos(WRAP_UP * RAD)) ** 2 - (high.side * (r + WRAP_THIGH * k) - f0.pos[high.upper][0]) ** 2));
  const hipZ = f0.pos[high.upper][2];
  const poleZ = hipZ + kneeZ - r - WRAP_SHIN * k;
  if (poleZ - r < f0.pos[rig.hips][2] + 0.13 * k) return fail(BAR_THICK);
  const behind = poleZ + r + WRAP_SHIN * k;
  let lowest = Infinity;
  for (const leg of legs) {
    const up = leg === high;
    const hip = f0.pos[leg.upper];
    const kx = leg.side * (r + WRAP_THIGH * k);
    const flatLen = Math.hypot(kx - hip[0], behind - hip[2]);
    const rise = Math.sqrt(Math.max(0, leg.len1 ** 2 - flatLen ** 2));
    // 低的那条腿：大腿往下压，但不比 WRAP_DOWN 压得更多（腿长的话膝盖再往前一点）
    const knee: V3 = up ? [kx, hip[1] + rise, behind] : [kx, hip[1] - Math.min(rise, leg.len1 * Math.sin(WRAP_DOWN * RAD)), behind];
    if (!up) knee[2] = hip[2] + Math.sqrt(Math.max(0, leg.len1 ** 2 - (knee[1] - hip[1]) ** 2 - (kx - hip[0]) ** 2));
    // 小腿从杆后面横过去：高的那条横得多（脚让开下面那条大腿），低的那条差不多垂着
    const across = up ? r + (WRAP_THIGH + 0.2) * k : r + (WRAP_THIGH + 0.05) * k;
    const side = Math.min(across, leg.len2 * 0.9);
    const ankle: V3 = [knee[0] - leg.side * side, knee[1] - Math.sqrt(leg.len2 ** 2 - side ** 2), knee[2]];
    state = reachOnly(solver, state, limbIndex(solver, leg), ankle);
    state = bendTo(solver, state, leg, knee);
    // 脚跟着小腿，脚尖绷着
    state.local[leg.end] = pitchX(55);
    lowest = Math.min(lowest, ankle[1] - 0.16 * k);
  }
  // 手：右手在上、左手在下，各握在杆自己那一边（手心朝杆，四指从前面绕过去，拇指朝上）
  let f = forward(rig, state);
  let topHand = 0;
  for (const arm of arms) {
    const upper = arm.side !== high.side;
    const from = f.pos[arm.upper];
    const reach = arm.len1 + arm.len2;
    const y = from[1] + (upper ? 0.62 : 0.02) * reach;
    const target: V3 = [arm.side * (r + 0.02 * k), y, poleZ - 0.045 * k];
    state = reachOnly(solver, state, limbIndex(solver, arm), target);
    // 手肘朝下、稍微朝外
    state = bendTo(solver, state, arm, [from[0] + arm.side * 0.25, from[1] - 0.5, from[2] + 0.05]);
    topHand = Math.max(topHand, y + 0.06 * k);
  }
  f = forward(rig, state);
  // 离地多高：脚离地一截；杆不够高就往下挪，脚快碰地了还握不到杆顶以下就是杆太矮
  const below = c.solids.filter((s) => s.id !== prop.id);
  const floor = Math.max(0, topUnder(below, cx + (dx / Math.hypot(dx, dz)) * 0.1, cz + (dz / Math.hypot(dx, dz)) * 0.1, bar.b[1]) ?? 0, bar.a[1] - lowest - 0.3 * k);
  const most = bar.b[1] - WRAP_TOP * k - topHand;
  const least = floor + 0.02 * k - lowest;
  if (most < least) return fail(tk('这根杆太矮，缠不上去：把它拉高一点'));
  const place = placeFor(yaw, Math.min(most, floor + WRAP_LIFT * k - lowest), [0, 0, poleZ], [cx, cz]);
  let missed = 0;
  for (const arm of arms) if (len(sub(f.pos[arm.end], [arm.side * (r + 0.02 * k), f.pos[arm.end][1], poleZ - 0.045 * k])) > MISS * k) missed++;
  // 站的地方定了：手心朝杆、四指从前面绕过去，照杆握上
  const solid = propSolid(prop, place);
  for (const arm of arms) state = gripAt(solver, state, arm, [0, 0, 1], [-arm.side, 0, 0], solid, k);
  if (c.follow) state = followPair(solver, state, 0);
  // 整个人跟着杆；两只手另外抓着它
  return { place, posing: posingOf(solver, state, c.posing), links: [rideLink(prop, place), ...gripLinks(solver, state, place, prop, arms)], missed };
}

/* ---------------- 拿着、两手端着、抱着、举过头顶 ---------------- */

/** 一只手拿：不是杆的道具最长的一边最多多长；最高多高（标准身高时，米） */
const CARRY_MAX = 0.6;
const CARRY_TALL = 0.8;
/** 两只手拿、抱、举：左右最多多宽 */
const SPAN_MAX = 1.0;
/** 身体正面比肩膀靠前多少 */
const FRONT = 0.11;
/** 一只手握着的杆：比这短的握在正中，长的握在下面三分之一 */
const STICK = 0.45;
/** 两只手握横着的杆：各离正中多远；杆至少要比两只手宽出多少 */
const BAR_SPREAD = 0.22;
const BAR_END = 0.05;
/** 举过头顶：手臂伸到几成直、锁骨抬多少度、两只手最远离正中多远 */
const LIFT_STRETCH = 0.93;
const LIFT_COLLAR = 15;
const LIFT_SPREAD = 0.3;

const TOO_BIG_ONE = tk('这件道具太大，一只手拿不了：用「两手端着」');
const TOO_WIDE = tk('这件道具太宽，两只手够不到两边');
const BAR_SHORT = tk('这根杆太短，两只手握不下');
const NEED_TWO = tk('这个动作要两只手');
const RIDING = tk('这个角色正坐在、站在这件道具上，拿不起来：先在「连着它的」里解开');
const NO_CHEST = tk('这个身体上没找到胸口，抱不了。');

/** 能握住的杆（太粗的当普通道具端着） */
const thinBar = (prop: SceneProp): Bar | null => {
  const bar = barOf(prop);
  return bar && bar.r <= BAR_R_MAX ? bar : null;
};

/** 这四个动作一眼看得出做不了的原因（照道具自己的宽、高、深估；歪着的点了以后再量） */
function pickBlock(action: PropAction, solver: Solver, prop: SceneProp): string | null {
  const k = tallOf(solver) / STANDARD;
  if (action !== 'carry' && armsOf(solver).length < 2) return NEED_TWO;
  const bar = thinBar(prop);
  if (bar) return action !== 'carry' && action !== 'hug' && bar.length / 2 - BAR_END * k < 0.06 * k ? BAR_SHORT : null;
  const [w, h, d] = prop.size;
  if (action === 'carry') return Math.max(w, d) > CARRY_MAX * k || h > CARRY_TALL * k ? TOO_BIG_ONE : null;
  return Math.min(w, d) > SPAN_MAX * k ? TOO_WIDE : null;
}

/** 道具换个朝向、挪个地方以后的样子（位置留到毫米、角度留到 0.1°，和清单里记的一样） */
const movedTo = (prop: SceneProp, pos: V3, rot: Vec3): SceneProp => ({
  ...prop,
  pos: [Math.round(pos[0] * 1000) / 1000, Math.round(pos[1] * 1000) / 1000, Math.round(pos[2] * 1000) / 1000],
  rot: [Math.round(wrap(rot[0]) * 10) / 10, Math.round(wrap(rot[1]) * 10) / 10, Math.round(wrap(rot[2]) * 10) / 10],
});

/**
 * 不是杆的道具对着角色摆正：朝向取和角色差 90° 的倍数里离现在最近的那个（quarter：再转 90°），歪着的照样歪着。
 * ext 是这样摆时它在角色自己的坐标里占的盒子：左右多宽、多高、前后多深
 */
function squared(c: Ctx, quarter: number): { rot: Vec3; ext: V3 } {
  const yaw = c.place.yaw + (Math.round(wrap(c.prop.rot[1] - c.place.yaw) / 90) + quarter) * 90;
  return turned(c, [c.prop.rot[0], yaw, c.prop.rot[2]]);
}

/** 道具转成 rot 时在角色自己的坐标里占多大的盒子 */
function turned(c: Ctx, rot: Vec3): { rot: Vec3; ext: V3 } {
  const solid = propSolid({ ...c.prop, rot }, c.place);
  return { rot, ext: sub(solid.max, solid.min) };
}

/** 道具转成 rot，它占的盒子正中挪到 centre（角色自己的坐标） */
function boxAt(c: Ctx, rot: Vec3, centre: V3): SceneProp {
  const turned = { ...c.prop, rot };
  const solid = propSolid(turned, c.place);
  const from = toScene(c.place, lerp(solid.min, solid.max, 0.5));
  const to = toScene(c.place, centre);
  return movedTo(c.prop, [turned.pos[0] + to[0] - from[0], turned.pos[1] + to[1] - from[1], turned.pos[2] + to[2] - from[2]], rot);
}

/** 杆竖起来（upright），或者横过来、顺着角色的左右：该转成什么朝向 */
function barRot(c: Ctx, bar: Bar, upright: boolean): Vec3 {
  const yaw = c.place.yaw;
  if (upright) return bar.axis === 1 ? [0, yaw, 0] : bar.axis === 0 ? [0, yaw, 90] : [90, yaw, 0];
  return bar.axis === 1 ? [0, yaw, 90] : bar.axis === 0 ? [0, yaw, 0] : [0, yaw + 90, 0];
}

/** 杆转成 rot，中线的正中挪到 centre（角色自己的坐标） */
function barAt(c: Ctx, rot: Vec3, centre: V3): SceneProp {
  const turned = { ...c.prop, rot };
  const bar = barOf(turned)!;
  const from = lerp(bar.a, bar.b, 0.5);
  const to = toScene(c.place, centre);
  return movedTo(c.prop, [turned.pos[0] + to[0] - from[0], turned.pos[1] + to[1] - from[1], turned.pos[2] + to[2] - from[2]], rot);
}

/** 还没摆过姿势的（手臂张着）先垂下手站好；摆过的照现在的姿势，只动手臂 */
const baseState = (c: Ctx): PoseState => (c.posing.root || Object.keys(c.posing.bones).length ? stateOf(c.solver, c.posing) : standing(c.solver, '自然站立'));

/** 这个角色整个人正跟着这件道具（坐在、站在它上面） */
const ridesIt = (c: Ctx): boolean => linkOf(liveLinks(c.links, c.props), BODY_LINK)?.prop === c.prop.id;

/** 一只手伸到 wrist（角色自己的坐标），四指朝 fingers、手心朝 palm（互相垂直）；肘朝肩膀的 elbow 那边弯 */
function armTo(solver: Solver, state: PoseState, arm: Limb, wrist: V3, fingers: V3, palm: V3, elbow: V3): PoseState {
  const hand = solver.hands.find((h) => h.bone === arm.end);
  const reached = reachOnly(solver, state, limbIndex(solver, arm), wrist, hand ? handRot(hand, fingers, mul(palm, -1)) : undefined);
  const shoulder = forward(solver.rig, reached).pos[arm.upper];
  return bendTo(solver, reached, arm, [shoulder[0] + elbow[0], shoulder[1] + elbow[1], shoulder[2] + elbow[2]]);
}

/** 两个肩膀的正中（角色自己的坐标） */
const shouldersMid = (solver: Solver, state: PoseState, arms: readonly Limb[]): V3 => {
  const f = forward(solver.rig, state);
  return mul(arms.map((a) => f.pos[a.upper]).reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]), 1 / arms.length);
};

/** 带着道具的是右手（没有右手就第一只） */
const mainArm = (arms: readonly Limb[]): Limb => arms.find((a) => a.side < 0) ?? arms[0];

/**
 * 手都伸到位了：照摆好的道具落位（手掌贴上去、杆握在四指根部）、手指握上，记连接。
 * carrier：道具跟着哪一处走——一只手的名字，或者胸口那根骨骼的名字（抱着）；别的手是抓在它上面。
 * 这个角色原来连在这件道具上的都换成新的；用到的手原来抓着别的，也换掉
 */
function pickUp(c: Ctx, posed: PoseState, held: SceneProp, arms: readonly Limb[], wrists: readonly V3[], carrier: string): ActionResult {
  const { solver, place, k } = c;
  let state = posed;
  const before = forward(solver.rig, state);
  const missed = arms.filter((arm, i) => len(sub(before.pos[arm.end], wrists[i])) > MISS * k).length;
  let links: readonly PropLink[] = (c.links ?? []).filter((l) => l.prop !== held.id);
  for (const arm of arms) {
    const got = grabLink(solver, state, place, held, arm.name, 1);
    if (!got) continue;
    state = got.state;
    links = setLink(links, arm.name === carrier ? withCarry(got.link, true) : got.link);
  }
  const bone = solver.rig.index.get(carrier);
  if (!arms.some((a) => a.name === carrier) && bone !== undefined) {
    const f = forward(solver.rig, state);
    links = setLink(links, withCarry(linkTo(held, carrier, toScene(place, f.pos[bone]), undefined, sceneRot(place, f.rot[bone])), true));
  }
  const props = c.props.map((p) => (p.id === held.id ? held : p));
  state = holdState(solver, state, holdTargets(place, links, props), { grip: 'always' });
  return { place, posing: posingOf(solver, state, c.posing), links, missed };
}

/* 拿着：一只手。杆、棍子握着（竖着），别的托在手心上 */
function carryOne(c: Ctx): ActionOutcome {
  const { solver, k, prop } = c;
  const arms = armsOf(solver);
  if (!arms.length) return fail(NO_ARMS);
  if (ridesIt(c)) return fail(RIDING);
  let state = baseState(c);
  const f = forward(solver.rig, state);
  // 哪只手：道具在角色哪一边就用哪只（正前方用右手）；这只手已经拿着这一件（再点一次）就换另一只；正抓着别的道具的手不用
  const live = liveLinks(c.links, c.props);
  const here = fromScene(c.place, propPoint(prop, [0, prop.size[1] / 2, 0]));
  const mine = live.find((l) => l.prop === prop.id && l.carry);
  const free = (a: Limb) => {
    const link = linkOf(live, a.name);
    return !link || link.prop === prop.id;
  };
  let arm = arms.find((a) => a.side === (here[0] > 0.03 * k ? 1 : -1)) ?? arms[0];
  if (mine && arms.some((a) => a.name === mine.part)) arm = arms.find((a) => a.name !== mine.part) ?? arm;
  if (!free(arm)) arm = arms.find(free) ?? arm;
  // 上臂垂着、前臂朝前平伸
  const s = f.pos[arm.upper];
  const wrist: V3 = [s[0] + arm.side * 0.04 * k, s[1] - arm.len1 * 0.93, s[2] + arm.len2 * 0.92];
  const elbow: V3 = [arm.side * 0.1, -1, -0.3];
  const bar = thinBar(prop);
  let held: SceneProp;
  if (bar) {
    // 握在哪：短的握正中，长的握在下面三分之一；下头不戳到脚下的地面以下
    const grip = bar.length <= STICK * k ? bar.length / 2 : Math.min(bar.length * 0.35, Math.max(0, wrist[1] - 0.02));
    held = barAt(c, barRot(c, bar, true), [wrist[0] - arm.side * (bar.r + 0.02 * k), wrist[1] - grip + bar.length / 2, wrist[2] + 0.045 * k]);
    // 手心朝里、四指从前面绕过去
    state = armTo(solver, state, arm, wrist, [0, 0, 1], [-arm.side, 0, 0], elbow);
  } else {
    const { rot, ext } = squared(c, 0);
    if (Math.max(ext[0], ext[2]) > CARRY_MAX * k || ext[1] > CARRY_TALL * k) return fail(TOO_BIG_ONE);
    // 托在手心上：道具的底在手心上面，大的往前让开身体（手托着它靠里的那一头）
    const z = Math.max(wrist[2] + palmOf(solver, arm) * 0.6, s[2] + (FRONT + 0.02) * k + ext[2] / 2);
    held = boxAt(c, rot, [wrist[0], wrist[1] + PALM * k + ext[1] / 2, z]);
    state = armTo(solver, state, arm, wrist, [0, 0, 1], [0, 1, 0], elbow);
  }
  return { ...pickUp(c, state, held, [arm], [wrist], arm.name), part: arm.name };
}

/* 两手端着：一左一右；长杆横着握 */
function carryBoth(c: Ctx): ActionOutcome {
  const { solver, k, prop } = c;
  const arms = armsOf(solver);
  if (arms.length < 2) return fail(arms.length ? NEED_TWO : NO_ARMS);
  if (ridesIt(c)) return fail(RIDING);
  let state = baseState(c);
  const f = forward(solver.rig, state);
  const mid = shouldersMid(solver, state, arms);
  const wrists: V3[] = [];
  const bar = thinBar(prop);
  let held: SceneProp;
  if (bar) {
    const spread = Math.min(BAR_SPREAD * k, bar.length / 2 - BAR_END * k);
    if (spread < 0.06 * k) return fail(BAR_SHORT);
    // 手臂差不多垂着，杆横在胯前
    const reach = Math.min(...arms.map((a) => a.len1 + a.len2));
    const at: V3 = [mid[0], mid[1] - reach * 0.82, mid[2] + (FRONT + 0.1) * k];
    held = barAt(c, barRot(c, bar, false), at);
    for (const arm of arms) {
      // 正握：手从上面、后面过来，手心朝下
      const wrist: V3 = [at[0] + arm.side * spread, at[1] + 0.03 * k, at[2] - bar.r - 0.04 * k];
      wrists.push(wrist);
      state = armTo(solver, state, arm, wrist, [0, 0, 1], [0, -1, 0], [arm.side * 0.3, -0.6, -0.4]);
    }
  } else {
    const limit = SPAN_MAX * k;
    let sq = squared(c, 0);
    if (sq.ext[0] > limit) sq = squared(c, 1);
    if (sq.ext[0] > limit) return fail(TOO_WIDE);
    const { rot, ext } = sq;
    // 薄的（盘子、板子）手托在底下，别的手扶在左右两面上、靠下三分之一
    const flat = ext[1] < 0.08 * k;
    const wy = mid[1] - Math.max(...arms.map((a) => a.len1)) * 0.8;
    const cz = mid[2] + (FRONT + 0.03) * k + ext[2] / 2;
    held = boxAt(c, rot, [mid[0], flat ? wy + PALM * k + ext[1] / 2 : wy + ext[1] * 0.15, cz]);
    for (const arm of arms) {
      const s = f.pos[arm.upper];
      const x = mid[0] + arm.side * (flat ? Math.max(0.06 * k, ext[0] / 2 - 0.06 * k) : ext[0] / 2 + PALM * k);
      // 前后：扶在正中；手臂够不到那么前就靠里一点
      const room = Math.sqrt(Math.max(0, ((arm.len1 + arm.len2) * 0.95) ** 2 - (x - s[0]) ** 2 - (wy - s[1]) ** 2));
      const wrist: V3 = [x, wy, Math.max(cz - ext[2] / 2 + 0.03 * k, Math.min(cz, s[2] + room))];
      wrists.push(wrist);
      state = armTo(solver, state, arm, wrist, [0, 0, 1], flat ? [0, 1, 0] : [-arm.side, 0, 0], [arm.side * 0.35, -0.8, -0.4]);
    }
  }
  return pickUp(c, state, held, arms, wrists, mainArm(arms).name);
}

/* 抱着：道具贴在胸前、跟着胸口走，两只手搂着它 */
function hugIt(c: Ctx): ActionOutcome {
  const { solver, k } = c;
  const arms = armsOf(solver);
  if (arms.length < 2) return fail(arms.length ? NEED_TWO : NO_ARMS);
  if (ridesIt(c)) return fail(RIDING);
  let state = baseState(c);
  const f = forward(solver.rig, state);
  const mid = shouldersMid(solver, state, arms);
  const limit = SPAN_MAX * k;
  // 宽的那一面贴着胸口；两只手够不到两边就换一面。杆是竖着抱
  const bar = thinBar(c.prop);
  let sq = bar ? turned(c, barRot(c, bar, true)) : squared(c, 0);
  const other = bar ? sq : squared(c, 1);
  if ((other.ext[0] > sq.ext[0] && other.ext[0] <= limit) || sq.ext[0] > limit) sq = other;
  if (sq.ext[0] > limit) return fail(TOO_WIDE);
  const { rot, ext } = sq;
  // 正中在胸口下面一点；高的往下放，别挡着脸，也别戳到脚下的地面以下
  const cy = Math.max(ext[1] / 2 + 0.02, Math.min(mid[1] - 0.2 * k, mid[1] + 0.06 * k - ext[1] / 2));
  const cz = mid[2] + FRONT * k + ext[2] / 2;
  const held = boxAt(c, rot, [mid[0], cy, cz]);
  const chest = chestBone(solver.rig, f, [mid[0], cy, mid[2]]);
  if (chest < 0) return fail(NO_CHEST);
  const wrists: V3[] = [];
  const wy = cy - Math.min(ext[1] * 0.2, 0.08 * k);
  for (const arm of arms) {
    const s = f.pos[arm.upper];
    const x = mid[0] + arm.side * (ext[0] / 2 + PALM * k);
    // 手搂在两面上靠外的地方；够不到那么前就靠里一点
    const room = Math.sqrt(Math.max(0, ((arm.len1 + arm.len2) * 0.95) ** 2 - (x - s[0]) ** 2 - (wy - s[1]) ** 2));
    const wrist: V3 = [x, wy, Math.max(cz - ext[2] / 2 + 0.03 * k, Math.min(cz + ext[2] * 0.2, s[2] + room))];
    wrists.push(wrist);
    state = armTo(solver, state, arm, wrist, [0, 0, 1], [-arm.side, 0, 0], [arm.side * 0.5, -0.5, -0.3]);
  }
  return pickUp(c, state, held, arms, wrists, solver.rig.names[chest]);
}

/* 举过头顶：两只手举着；长杆横着举 */
function liftUp(c: Ctx): ActionOutcome {
  const { solver, k, prop } = c;
  const { rig } = solver;
  const arms = armsOf(solver);
  if (arms.length < 2) return fail(arms.length ? NEED_TWO : NO_ARMS);
  if (ridesIt(c)) return fail(RIDING);
  let state = cloneState(baseState(c));
  let f = forward(rig, state);
  // 锁骨抬起来一点
  for (const arm of arms) {
    const collar = rig.parent[arm.upper];
    if (collar >= 0 && /^Shoulder/.test(rig.names[collar])) setWorldRot(rig, state, f, collar, quatMul(rollZ(arm.side * LIFT_COLLAR), f.rot[collar]));
  }
  f = forward(rig, state);
  const mid = shouldersMid(solver, state, arms);
  const cz = mid[2] + 0.02 * k;
  /** 两只手各离正中 spread、前后在 z 时，手腕最高举到哪（两只手一样高） */
  const top = (spread: number, z: number) =>
    Math.min(
      ...arms.map((arm) => {
        const s = f.pos[arm.upper];
        return s[1] + Math.sqrt(Math.max(0, ((arm.len1 + arm.len2) * LIFT_STRETCH) ** 2 - (mid[0] + arm.side * spread - s[0]) ** 2 - (z - s[2]) ** 2));
      }),
    );
  const elbow = (arm: Limb): V3 => [arm.side * 0.5, 0.2, 0.2];
  const wrists: V3[] = [];
  const bar = thinBar(prop);
  let held: SceneProp;
  if (bar) {
    const spread = Math.min(LIFT_SPREAD * k, bar.length / 2 - BAR_END * k);
    if (spread < 0.06 * k) return fail(BAR_SHORT);
    const back = bar.r + 0.015 * k;
    const wy = top(spread, cz - back);
    held = barAt(c, barRot(c, bar, false), [mid[0], wy + Math.min(...arms.map((a) => palmOf(solver, a))), cz]);
    for (const arm of arms) {
      // 手在杆下面：四指朝上、手心朝前，从后面翻过去握住
      const wrist: V3 = [mid[0] + arm.side * spread, wy, cz - back];
      wrists.push(wrist);
      state = armTo(solver, state, arm, wrist, [0, 1, 0], [0, 0, 1], elbow(arm));
    }
  } else {
    const limit = SPAN_MAX * k;
    let sq = squared(c, 0);
    if (sq.ext[0] > limit) sq = squared(c, 1);
    if (sq.ext[0] > limit) return fail(TOO_WIDE);
    const { rot, ext } = sq;
    // 够宽的托在底下（手心朝上），窄的夹着左右两面
    const under = ext[0] >= 0.24 * k;
    const spread = under ? Math.max(0.1 * k, Math.min(LIFT_SPREAD * k, ext[0] / 2 - 0.06 * k)) : ext[0] / 2 + PALM * k;
    const wy = top(spread, cz);
    const bottom = under ? wy + PALM * k : wy - Math.min(ext[1] * 0.3, 0.06 * k);
    held = boxAt(c, rot, [mid[0], bottom + ext[1] / 2, cz]);
    for (const arm of arms) {
      const wrist: V3 = [mid[0] + arm.side * spread, wy, cz];
      wrists.push(wrist);
      state = under ? armTo(solver, state, arm, wrist, [0, 0, -1], [0, 1, 0], elbow(arm)) : armTo(solver, state, arm, wrist, [0, 1, 0], [-arm.side, 0, 0], elbow(arm));
    }
  }
  return pickUp(c, state, held, arms, wrists, mainArm(arms).name);
}

/* ---------------- 伸手抓住（AI 助手的「抓住」工具用） ---------------- */

/** 手腕、脚踝离道具比这近（标准身高时，米）算挨着，就在原处抓；远了先伸过去 */
const GRAB_NEAR = { arm: 0.12, leg: 0.16 } as const;

export interface GrabInput extends ActionInput {
  /** 哪只手、哪只脚（Limb.name） */
  part: string;
  /** 抓住以后道具跟着这只手走（拿着） */
  carry?: boolean;
}

/**
 * 一只手抓住、一只脚踩住一件道具：挨着就在原处抓，离得远先伸过去（身体不动），伸直了也够不着就说够不着。
 * 落位、握上、记连接和界面上点「抓住」一样（见 follow.ts 的 grabLink）
 */
export function solveGrab(input: GrabInput): ActionOutcome {
  const { solver, place, prop } = input;
  const index = solver.limbs.findIndex((l) => l.name === input.part);
  if (index < 0) return fail(tk('这个角色没有这只手（脚）'));
  const limb = solver.limbs[index];
  const k = tallOf(solver) / STANDARD;
  let state = stateOf(solver, input.posing);
  const solid = propSolid(prop);
  const at = toScene(place, forward(solver.rig, state).pos[limb.end]);
  const hit = closestOnSolid(solid, at);
  if (hit.dist > GRAB_NEAR[limb.kind] * k) {
    let out: V3 = hit.dist > 1e-6 ? mul(sub(at, hit.point), 1 / hit.dist) : [0, 1, 0];
    if (insideSolid(solid, at)) out = mul(out, -1);
    const target = madd(hit.point, out, (limb.kind === 'leg' ? FOOT_ROOM : PALM) * k);
    state = reachOnly(solver, state, index, fromScene(place, target));
    if (len(sub(toScene(place, forward(solver.rig, state).pos[limb.end]), target)) > MISS * k) return fail(tk('够不着：先把道具或者角色挪近一点'));
  }
  const got = grabLink(solver, state, place, prop, input.part, 1);
  if (!got) return fail(tk('这个角色没有这只手（脚）'));
  const link = input.carry ? withCarry(got.link, true) : got.link;
  const links = setLink(input.carry ? putDown(input.links, prop.id) : input.links, link);
  state = holdState(solver, got.state, holdTargets(place, links, input.props), { grip: 'always' });
  return { place, posing: posingOf(solver, state, input.posing), links, missed: 0, part: input.part };
}

const SOLVERS: Record<PropAction, (c: Ctx) => ActionOutcome> = { sit, lie, top, hold, lean, hang, wrap: wrapPole, carry: carryOne, both: carryBoth, hug: hugIt, lift: liftUp };

/** 做一个动作：返回角色的新位置、新姿势、新的连接；做不了返回原因 */
export function solvePropAction(action: PropAction, input: ActionInput): ActionOutcome {
  const block = actionBlock(action, input.solver, input.prop);
  if (block) return fail(block);
  const height = tallOf(input.solver);
  const local = propLocal(input.prop, [input.place.x, input.prop.pos[1], input.place.z]);
  return SOLVERS[action]({
    ...input,
    k: height / STANDARD,
    height,
    solid: propSolid(input.prop),
    solids: input.props.map((p) => propSolid(p)),
    contacts: propContacts(input.prop),
    me: [local[0], local[2]],
  });
}
