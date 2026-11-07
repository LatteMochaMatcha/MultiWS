/**
 * 场景里角色之间的肢体互动（见 docs/scene-plan.md「肢体互动」）。
 *
 * 每个角色各是一块网格，靠得再近也不会融合在一起，只会互相穿插。这里用骨架近似身体：
 * 每根主要骨骼（脊柱、头、四肢、手脚）当成一段胶囊体，半径照身高按比例估。拿它来
 * - 查两个角色之间哪里穿插（findClashes），
 * - 拖手脚时碰到别人就停在表面（pushOut），
 * - 双人动作：两个人站好、各套一个底子姿势，再让手用 IK 去够接触点（solvePair）。
 * 都是纯函数，坐标是场景的绝对坐标（米），每个角色自己的坐标用 Place 换过去。
 */
import { tk } from '../i18n';
import { type V3, add, dot, len, madd, mul, norm, sub } from '../geometry/vec';
import { type Place, absolutePlace } from '../model/scene';
import { type Posing, emptyPosing } from '../pose/posing';
import { type PoseState, type RigBone, cloneState, forward, posedBones } from '../pose/rig';
import { fitArms, followArms } from '../pose/fit';
import { armOfBone, followPair } from '../pose/follow';
import { POSE_LIBRARY } from '../pose/library';
import { type Pin, capturePins, dragReach } from '../pose/solve';
import { type Solver, makeSolver, posingOf, stateOf } from '../pose/solver';

/** 身上的哪一块：穿插提示里说「左手臂」「躯干」这样的话 */
export type BodyPart = 'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR' | 'tail';

export const PART_LABEL: Record<BodyPart, string> = {
  head: tk('头'),
  torso: tk('躯干'),
  armL: tk('左手臂'),
  armR: tk('右手臂'),
  legL: tk('左腿'),
  legR: tk('右腿'),
  tail: tk('尾巴'),
};

export interface Capsule {
  a: V3;
  b: V3;
  r: number;
  bone: string;
  part: BodyPart;
}

/** 标准身高 1.7 米时各骨骼的半径（米）；别的身高照比例 */
const RADIUS: [RegExp, number, BodyPart | 'side'][] = [
  [/^Head/, 0.095, 'head'],
  [/^Neck/, 0.05, 'head'],
  [/^Hips/, 0.125, 'torso'],
  [/^Spine/, 0.115, 'torso'],
  [/^(Upper)?Chest/, 0.125, 'torso'],
  [/^Shoulder/, 0.055, 'side'],
  [/^UpperArm/, 0.045, 'side'],
  [/^LowerArm/, 0.037, 'side'],
  [/^Hand/, 0.04, 'side'],
  [/^UpperLeg/, 0.075, 'side'],
  [/^LowerLeg/, 0.052, 'side'],
  [/^Foot/, 0.045, 'side'],
  [/^Tail/, 0.04, 'tail'],
];
const STANDARD = 1.7;

/** 骨骼名字里的左右（_L、_L.002 之类）；没有就是 0 */
const sideOf = (name: string): 1 | -1 | 0 => (/_L(\.\d+)?$/.test(name) ? 1 : /_R(\.\d+)?$/.test(name) ? -1 : 0);

/** 这副骨架有多高（头顶大约在哪；静止姿势站在 y = 0 上） */
export function heightOf(bones: readonly RigBone[]): number {
  let top = 0;
  for (const b of bones) top = Math.max(top, b.head[1], b.tail[1]);
  return top || STANDARD;
}

/** 骨架 → 胶囊体（骨骼在自己的坐标里）。height：照它定半径（静止姿势的身高；摆了姿势蹲下去也照站着的算） */
export function capsulesOf(bones: readonly RigBone[], height: number): Capsule[] {
  const k = height / STANDARD;
  const out: Capsule[] = [];
  for (const b of bones) {
    const hit = RADIUS.find(([re]) => re.test(b.name));
    if (!hit) continue;
    const [, r, kind] = hit;
    let part: BodyPart;
    if (kind !== 'side') part = kind;
    else {
      const side = sideOf(b.name);
      const leg = /^(UpperLeg|LowerLeg|Foot)/.test(b.name);
      // 长在中线上的腿（蛛形、人马的中间那条）算右腿，免得提示里没处放
      part = leg ? (side === 1 ? 'legL' : 'legR') : side === 1 ? 'armL' : side === -1 ? 'armR' : 'torso';
    }
    out.push({ a: b.head, b: b.tail, r: r * k, bone: b.name, part });
  }
  return out;
}

/** 角色自己坐标里的点 → 场景里 */
export function toScene(place: Place, p: V3): V3 {
  const a = (place.yaw * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * p[0] + s * p[2] + place.x, p[1], -s * p[0] + c * p[2] + place.z];
}

/** 场景里的点 → 角色自己的坐标 */
export function fromScene(place: Place, p: V3): V3 {
  const a = (place.yaw * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = p[0] - place.x;
  const z = p[2] - place.z;
  return [c * x - s * z, p[1], s * x + c * z];
}

export const placeCapsules = (caps: readonly Capsule[], place: Place): Capsule[] =>
  caps.map((c) => ({ ...c, a: toScene(place, c.a), b: toScene(place, c.b) }));

/** 点到线段最近的那一点 */
function closestOnSegment(p: V3, a: V3, b: V3): V3 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return madd(a, ab, t);
}

/** 两条线段之间最近的距离 */
export function segmentDistance(p1: V3, q1: V3, p2: V3, q2: V3): number {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s: number;
  let t: number;
  if (a <= 1e-12 && e <= 1e-12) return len(r);
  if (a <= 1e-12) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= 1e-12) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  return len(sub(madd(p1, d1, s), madd(p2, d2, t)));
}

/** 两个角色之间穿插的一处：哪两块、插进去多深（米） */
export interface Clash {
  mine: BodyPart;
  theirs: BodyPart;
  depth: number;
}

/** 穿插不到这么深（米）不算：贴着、刚碰到是正常的（手搭在肩上、拥抱时两人的手臂交叠） */
export const CLASH_TOLERANCE = 0.03;

/** 手碰到别人是互动本身（牵手、搭肩），不算穿插 */
const isHand = (c: Capsule) => /^Hand/.test(c.bone);

/** 两个角色之间哪里穿插：同一对部位只留插得最深的那一次，深的排前面。手不算（见 isHand） */
export function findClashes(mine: readonly Capsule[], theirs: readonly Capsule[], tolerance = CLASH_TOLERANCE): Clash[] {
  const worst = new Map<string, Clash>();
  for (const c1 of mine) {
    if (isHand(c1)) continue;
    for (const c2 of theirs) {
      if (isHand(c2)) continue;
      // 先用包围球粗筛
      const m1 = mul(add(c1.a, c1.b), 0.5);
      const m2 = mul(add(c2.a, c2.b), 0.5);
      const reach = len(sub(c1.b, c1.a)) / 2 + len(sub(c2.b, c2.a)) / 2 + c1.r + c2.r;
      if (len(sub(m1, m2)) > reach) continue;
      const depth = c1.r + c2.r - segmentDistance(c1.a, c1.b, c2.a, c2.b);
      if (depth <= tolerance) continue;
      const key = `${c1.part}|${c2.part}`;
      const was = worst.get(key);
      if (!was || depth > was.depth) worst.set(key, { mine: c1.part, theirs: c2.part, depth });
    }
  }
  return [...worst.values()].sort((a, b) => b.depth - a.depth);
}

/**
 * 点 p 要是在别人身体里面（离哪段胶囊体比它的半径加 extra 还近）就推到表面上。
 * 几段挨着的胶囊体推来推去，反复几遍
 */
export function pushOut(p: V3, caps: readonly Capsule[], extra: number): V3 {
  let out = p;
  for (let round = 0; round < 4; round++) {
    let moved = false;
    for (const c of caps) {
      const q = closestOnSegment(out, c.a, c.b);
      const d = sub(out, q);
      const dist = len(d);
      const need = c.r + extra;
      if (dist >= need) continue;
      const dir = dist > 1e-6 ? mul(d, 1 / dist) : ([0, 1, 0] as V3);
      out = madd(q, dir, need);
      moved = true;
    }
    if (!moved) break;
  }
  return out;
}

/* ---------------- 双人动作 ---------------- */

/** 双人动作里的一个人：A 是现在改的那个，B 是一起摆的那个 */
export type Who = 'A' | 'B';
/** 第一对手臂的两只手（多出来的手臂不动，照底子姿势） */
type HandName = 'Hand_L' | 'Hand_R';

type Contact =
  /** 两只手碰在一起（牵手、击掌）：在两人各自那一侧的肩膀正中间，高度是肩高的几成；forward：往两人朝向的平均方向再挪多少（单位同上） */
  | { kind: 'meet'; a: HandName; b: HandName; height: number; forward?: number }
  /**
   * 一只手放到对方身上：对方的某根骨骼（起点）再挪 offset（对方自己的坐标里，单位同上）。
   * 落点在对方身体里面的话推到表面上
   */
  | { kind: 'on'; who: Who; hand: HandName; bone: string; offset: V3 };

export interface PairPreset {
  key: string;
  name: string;
  /** B 站在哪：A 自己的坐标里，x、z 以两人身高的 0.19 倍（见 unitOf）的平均为单位；朝向是相对 A 的 */
  place: { x: number; z: number; yaw: number };
  /** 两人的底子姿势（现成姿势的名字，见 pose/library.ts；null 是自然垂手），再在上面伸手 */
  base: { A: string | null; B: string | null };
  /**
   * 多出来的几对手臂（不伸手的那几对）照哪个现成姿势摆；不写就照底子姿势。
   * 底子是 null 时要写：不然它们照静止时那样张开着
   */
  extraArms?: string;
  contacts: Contact[];
}

export const PAIR_PRESETS: readonly PairPreset[] = [
  {
    key: 'hands',
    name: tk('手拉手'),
    place: { x: 1.75, z: 0, yaw: 0 },
    base: { A: '自然站立', B: '自然站立' },
    contacts: [{ kind: 'meet', a: 'Hand_L', b: 'Hand_R', height: 0.62, forward: 0.2 }],
  },
  {
    key: 'shoulder',
    name: tk('勾肩搭背'),
    place: { x: 1.35, z: 0, yaw: 0 },
    base: { A: '自然站立', B: '自然站立' },
    contacts: [
      { kind: 'on', who: 'A', hand: 'Hand_L', bone: 'UpperArm_R', offset: [-0.05, 0.12, -0.08] },
      { kind: 'on', who: 'B', hand: 'Hand_R', bone: 'Hips', offset: [0.35, 0.12, -0.3] },
    ],
  },
  {
    key: 'back',
    name: tk('背靠背'),
    place: { x: 0, z: -0.9, yaw: 180 },
    base: { A: '抱着胳膊', B: '抱着胳膊' },
    contacts: [],
  },
  {
    key: 'five',
    name: tk('击掌'),
    place: { x: 0, z: 2.4, yaw: 180 },
    base: { A: '自然站立', B: '自然站立' },
    contacts: [{ kind: 'meet', a: 'Hand_R', b: 'Hand_L', height: 1.15 }],
  },
  {
    key: 'both',
    name: tk('面对面牵双手'),
    place: { x: 0, z: 1.95, yaw: 180 },
    base: { A: '自然站立', B: '自然站立' },
    contacts: [
      { kind: 'meet', a: 'Hand_R', b: 'Hand_L', height: 0.72 },
      { kind: 'meet', a: 'Hand_L', b: 'Hand_R', height: 0.72 },
    ],
  },
  {
    key: 'hug',
    name: tk('拥抱'),
    // 往旁边错开一点：两个头不撞在一起。底子不套现成姿势（「自然站立」迈着一条腿、身子歪着，面对面会撞上），
    // 多出来的几对手臂照「自然站立」垂下来
    // 间距是两个头凑在一起、两对手臂的默认体型上试出来的（单个头的也不插）
    place: { x: 0.4, z: 0.9, yaw: 180 },
    base: { A: null, B: null },
    extraArms: '自然站立',
    // A 的手搂对方背上两侧，B 的手搂对方腰两侧：一上一下，两人的手臂不打架。
    // 都放在伸手够得着的地方（放到正后方的话够不着，IK 会让人弯腰往前凑，两个头撞在一起）
    contacts: [
      { kind: 'on', who: 'A', hand: 'Hand_L', bone: 'UpperChest', offset: [-0.55, 0.25, -0.15] },
      { kind: 'on', who: 'A', hand: 'Hand_R', bone: 'UpperChest', offset: [0.55, 0.25, -0.15] },
      { kind: 'on', who: 'B', hand: 'Hand_L', bone: 'Spine', offset: [-0.55, 0.1, -0.1] },
      { kind: 'on', who: 'B', hand: 'Hand_R', bone: 'Spine', offset: [0.55, 0.1, -0.1] },
    ],
  },
];

/** 双人动作里一个人的东西：静止骨架、在场景里站在哪、底子姿势（null 是不摆，自然垂手） */
export interface PairSide {
  bones: readonly RigBone[];
  place: Place;
  base: Posing | null;
}

export interface PairResult {
  /** B 换到哪 */
  placeB: Place;
  posing: Record<Who, Posing>;
  /** 有的接触点够不着（隔得太远、没有手臂）：照够得着的那么摆 */
  missed: number;
}

/**
 * 双人动作里量距离的单位：身高的 0.19 倍（标准身高 1.7 米时约 32 厘米，差不多是连手臂在内的肩宽）。
 * 不照肩关节量：二次元素体肩关节靠得近，照它算两个人会站得贴脸
 */
const unitOf = (bones: readonly RigBone[]): number => heightOf(bones) * 0.19;

/** 手掌离接触面留多少（米）：手本身的厚度 */
const PALM = 0.025;

/**
 * 摆一个双人动作：B 挪到 A 旁边的位置，两人各套底子姿势，再用 IK 让手去够接触点（脚钉着不动，手够不着时身子跟过去）。
 * 返回两人的新姿势和 B 的新位置；A 的位置不动
 */
/** 双人动作最多试多久（毫秒） */
const PAIR_BUDGET_MS = 1200;

export function solvePair(preset: PairPreset, A: PairSide, B: PairSide): PairResult {
  // 照预设的间距摆；两人身子还是插在一起（多个头凑在一起、几对手臂，和预设量的体型不一样）就换着试：
  // 左右、前后各挪近一点或拉开一点；多出来的几对手臂怎么放（见 Extra）；搭在别人身上的手往他身后挪一点。
  // 挑够得着的不比原来少、插得最浅的那个；改动小的先试，不插了就停
  const SPREADS = [1, 0.9, 1.1, 0.8, 1.2];
  const BACKS = preset.contacts.some((c) => c.kind === 'on') ? [0, 0.05, 0.1] : [0];
  const kit = pairKit(preset, A, B);
  const many = (who: Who) => kit.solvers[who].limbs.some((l) => l.kind === 'arm' && l.pair > 0);
  const modes = (who: Who): Extra[] => (!many(who) ? ['keep'] : preset.extraArms ? ['hang', 'follow', 'keep'] : ['keep', 'follow']);
  const extras: [Extra, Extra][] = [];
  for (const a of modes('A')) for (const b of modes('B')) extras.push([a, b]);
  const tries: { sx: number; sz: number; extra: [Extra, Extra]; back: number; cost: number }[] = [];
  for (const sx of SPREADS)
    for (const sz of preset.place.z ? SPREADS : [1])
      for (const back of BACKS)
        extras.forEach((extra, k) => tries.push({ sx, sz, extra, back, cost: Math.abs(sx - 1) + Math.abs(sz - 1) + back + k * 0.001 }));
  tries.sort((p, q) => p.cost - q.cost);
  let best: { result: PairResult; depth: number } | null = null;
  // 手臂多的身子一次要算好几毫秒：试满这么久还插着就不试了，留目前最好的（点了按钮别卡太久）
  const until = performance.now() + PAIR_BUDGET_MS;
  for (const t of tries) {
    if (best && performance.now() > until) break;
    const tried = solvePairAt(preset, A, B, kit, t.sx, t.sz, t.extra, t.back);
    if (best && tried.result.missed > best.result.missed) continue;
    if (!best || tried.result.missed < best.result.missed || tried.depth < best.depth - 1e-4) best = tried;
    if (best.depth === 0) break;
  }
  return best!.result;
}

/**
 * 多出来的几对手臂（不伸手的那几对）怎么放：照底子姿势（或 extraArms）垂着、照第一对一起伸手、
 * 留在静止时那样（底子是 null 时张开着；拥抱时对方的手搂在腰上，垂着的会和它打架）
 */
type Extra = 'hang' | 'follow' | 'keep';

/** 每次试都一样的那些：两人的骨架、套好的底子姿势、多出来的手臂垂着时的样子 */
interface PairKit {
  solvers: Record<Who, Solver>;
  base: Record<Who, Posing | null>;
  start: Record<Who, PoseState>;
  hang: Record<Who, PoseState | null>;
}

function pairKit(preset: PairPreset, A: PairSide, B: PairSide): PairKit {
  const solvers: Record<Who, Solver> = { A: makeSolver(A.bones), B: makeSolver(B.bones) };
  // 底子姿势只写了第一对手臂：照界面上套现成姿势那样，让多出来的几对也跟着摆（见 pose/fit.ts）
  const fitted = (who: Who, posing: Posing | null | undefined): Posing | null => (posing ? followArms(solvers[who], fitArms(solvers[who], posing)).posing : null);
  const base = { A: fitted('A', A.base), B: fitted('B', B.base) };
  const hangPosing = preset.extraArms ? POSE_LIBRARY.find((p) => p.name === preset.extraArms)?.posing : undefined;
  const hangOf = (who: Who) => {
    const p = fitted(who, hangPosing);
    return p ? stateOf(solvers[who], p) : null;
  };
  return {
    solvers,
    base,
    start: { A: stateOf(solvers.A, base.A ?? emptyPosing()), B: stateOf(solvers.B, base.B ?? emptyPosing()) },
    hang: { A: hangOf('A'), B: hangOf('B') },
  };
}

/**
 * 照预设摆一次：左右间距放大 sx 倍、前后 sz 倍；extra：A、B 多出来的几对手臂怎么放；
 * back：搭在别人身上的手再往别人身后挪多少（单位同 offset）。
 * depth：摆好以后两人插得最深的那处（米，不插是 0）
 */
function solvePairAt(preset: PairPreset, A: PairSide, B: PairSide, kit: PairKit, sx: number, sz: number, extra: [Extra, Extra], back = 0): { result: PairResult; depth: number } {
  const unit = (unitOf(A.bones) + unitOf(B.bones)) / 2;
  const placeB = absolutePlace(A.place, { x: preset.place.x * unit * sx, z: preset.place.z * unit * sz, yaw: preset.place.yaw });
  const sides = { A: { ...A, place: A.place }, B: { ...B, place: placeB } };
  const { solvers } = kit;
  const baseA = kit.base.A;
  const baseB = kit.base.B;
  const states: Record<Who, PoseState> = { A: cloneState(kit.start.A), B: cloneState(kit.start.B) };
  const heights = { A: heightOf(A.bones), B: heightOf(B.bones) };
  /** 某人某根骨骼的起点现在在场景里的哪 */
  const boneAt = (who: Who, name: string): V3 | null => {
    const s = solvers[who];
    const j = s.rig.names.indexOf(name);
    if (j < 0) return null;
    return toScene(sides[who].place, forward(s.rig, states[who]).pos[j]);
  };
  const limbOf = (who: Who, hand: HandName) => solvers[who].limbs.findIndex((l) => l.name === hand);
  /** 已经摆好、要留在原地的手，加上两只脚 */
  const done: Record<Who, Set<string>> = { A: new Set(), B: new Set() };
  const reach = (who: Who, hand: HandName, target: V3): boolean => {
    const s = solvers[who];
    const limb = limbOf(who, hand);
    if (limb < 0) return false;
    const keep = new Set([...done[who], ...s.limbs.filter((l) => l.kind === 'leg').map((l) => l.name)]);
    const pins: Pin[] = capturePins(s, forward(s.rig, states[who]), keep);
    states[who] = dragReach(s, states[who], limb, fromScene(sides[who].place, target), pins);
    done[who].add(hand);
    // 够着了没有：差得多的算没够着
    const got = toScene(sides[who].place, forward(s.rig, states[who]).pos[s.limbs[limb].end]);
    return len(sub(got, target)) < 0.06 * (heights[who] / STANDARD);
  };
  let missed = 0;
  for (const c of preset.contacts) {
    if (c.kind === 'meet') {
      const sa = boneAt('A', c.a.replace('Hand', 'UpperArm'));
      const sb = boneAt('B', c.b.replace('Hand', 'UpperArm'));
      if (!sa || !sb) {
        missed++;
        continue;
      }
      const mid = mul(add(sa, sb), 0.5);
      const y = Math.min(sa[1], sb[1]) * c.height;
      // 两人朝向的平均方向（面对面时抵消掉，就不往前挪）
      const fa = sub(toScene(sides.A.place, [0, 0, 1]), toScene(sides.A.place, [0, 0, 0]));
      const fb = sub(toScene(sides.B.place, [0, 0, 1]), toScene(sides.B.place, [0, 0, 0]));
      const ahead = mul(add(fa, fb), 0.5 * (c.forward ?? 0) * unit);
      const meet: V3 = [mid[0] + ahead[0], y, mid[2] + ahead[2]];
      // 两只手掌各退半个手掌厚，贴在一起不重叠
      const apart = norm(sub([sb[0], 0, sb[2]], [sa[0], 0, sa[2]]));
      if (!reach('A', c.a, madd(meet, apart, -PALM))) missed++;
      if (!reach('B', c.b, madd(meet, apart, PALM))) missed++;
    } else {
      const other: Who = c.who === 'A' ? 'B' : 'A';
      const s = solvers[other];
      const j = s.rig.names.indexOf(c.bone);
      if (j < 0) {
        missed++;
        continue;
      }
      const f = forward(s.rig, states[other]);
      const local = add(f.pos[j], mul([c.offset[0], c.offset[1], c.offset[2] - back], unit));
      let target = toScene(sides[other].place, local);
      // 落在对方身子里面：推到表面，留一个手掌厚
      const body = placeCapsules(capsulesOf(posedBones(s.rig, f), heights[other]), sides[other].place);
      target = pushOut(target, body, PALM);
      if (!reach(c.who, c.hand, target)) missed++;
    }
  }
  // 多出来的几对手臂：照第一对摆（和「几对手臂 → 一起动」一样），或者照 extraArms 垂着（第一对还是伸手的样子）
  (['A', 'B'] as const).forEach((who, k) => {
    const s = solvers[who];
    const want = kit.hang[who];
    if (extra[k] === 'follow') states[who] = followPair(s, states[who], 0);
    else if (extra[k] === 'hang' && want) {
      const next = cloneState(states[who]);
      for (let j = 0; j < s.rig.names.length; j++) if ((armOfBone(s, j)?.pair ?? 0) > 0) next.local[j] = want.local[j];
      states[who] = next;
    }
  });
  const posed = (who: Who) => placeCapsules(capsulesOf(posedBones(solvers[who].rig, forward(solvers[who].rig, states[who])), heights[who]), sides[who].place);
  const clashes = findClashes(posed('A'), posed('B'));
  return {
    result: {
      placeB,
      posing: {
        A: posingOf(solvers.A, states.A, baseA ?? undefined),
        B: posingOf(solvers.B, states.B, baseB ?? undefined),
      },
      missed,
    },
    depth: clashes[0]?.depth ?? 0,
  };
}
