/**
 * 全身 IK：拖一个点，全身怎么跟着动。纯函数，在单元测试里可以直接跑。
 *
 * 做法（原理是公开的那一类，代码是自己写的）：
 * - 手臂、腿各是两节骨头，知道根部关节和末端要到的位置，中间关节的位置可以直接算出来（三角形的边长都知道）；
 *   肘、膝往哪边顶，由「弯曲平面」决定，拖手脚的时候这个平面跟着一起转，不会自己乱翻。
 * - 手够不着的时候，锁骨、脊柱一节一节朝目标转一点，胯再跟过去一些，这样反复几轮；
 *   每一节能出多少力、最多转多少都有上限，所以是「身体跟过去」，不是把人折起来。
 * - 钉住的手脚（平时是脚）留在原地：胯挪动以后重新算那条腿；腿伸直了还够不着，胯就被拉回来。
 * 骨头的长度从头到尾不变：改的只有每根骨骼的旋转和胯的位置。
 *
 * 每次拖动都是从「按下去那一刻的姿势」算起的，和中间经过哪里无关：拖出去再拖回来，就回到原样。
 */
import { type Quat, type V3, add, cross, dot, len, mul, norm, quatBetween, quatConj, quatMul, rotate, sub } from '../geometry/vec';
import { type Limb, STRAIGHT, limbFrame } from './limbs';
import { anyPerp, quatAngle, quatLimit, quatPart, quatUnit, reject } from './math';
import { type Frame, type PoseRig, type PoseState, cloneState, forward, pointOn, setWorldRot, shiftRoot } from './rig';
import type { Solver } from './solver';

/** 钉住的一条肢体：末端留在 pos，朝向保持 rot（都是世界坐标） */
export interface Pin {
  limb: number;
  pos: V3;
  rot: Quat;
  /** 钉住的那一刻，这条肢体从根部到末端有多远：本来就伸得这么直的，不算够不着 */
  span: number;
}

const DEG = Math.PI / 180;
/** 手臂、腿最多伸到全长的这么多：留一点点弯，免得伸直的那一瞬间肘、膝的方向定不下来 */
const REACH = 0.999;
/**
 * 够不着时，身体跟过去要反复几轮；每一轮里，剩下还差的距离有几成由胯挪过去补上。
 * 前几轮胯基本不动，让锁骨、脊柱、骨盆先弯过去（弯腰去够）；后几轮才把胯送过去，保证够得着的一定够着。
 * 一上来就挪胯的话，伸手够地面会变成整个人跪下去。
 */
const ROOT_GIVE = [0.1, 0.2, 0.4, 0.65, 0.9, 0.97];
/** 骨盆：脚钉着的时候它也帮着转（弯腰主要是胯在折） */
const PELVIS: Helper = { give: 0.35, step: 13 * DEG, max: 100 * DEG };

/**
 * 锁骨自己（相对静止姿势）最多转多少：再往外是上身跟着转（拖肩上的圆点见 handles.ts，手够不着见 pull）。
 * 锁骨转多了，肩关节被带离躯干，重新融合以后手臂就悬在半空。拖之前已经转过了这么多的（以前存下来的姿势），
 * 以那时转的为限（见 collarLimit）
 */
export const COLLAR_MAX = 30 * DEG;
/** 第 bone 根骨骼（锁骨）这次拖动里最多转到多少：COLLAR_MAX，拖之前已经超过的就是拖之前的 */
export const collarLimit = (start: PoseState, bone: number): number => Math.max(COLLAR_MAX, quatAngle(start.local[bone]));

/** 帮着够的一节骨骼：每轮补上差距的几成、每轮最多转多少、这次拖动里总共最多转多少；collar：是锁骨（还受 COLLAR_MAX 管） */
interface Helper {
  give: number;
  step: number;
  max: number;
  collar?: boolean;
}
/**
 * 挤在一个肩膀上的几根锁骨（肩关节离得很近：肩部聚拢的几条手臂）帮得少得多：
 * 锁骨一转，这条手臂的肩头就被带离那一团共用的肩膀，中间的皮被扯成长长的一片。
 */
const CROWDED: Helper = { give: 0.5, step: 4 * DEG, max: 8 * DEG, collar: true };
function crowded(rig: PoseRig, bone: number): boolean {
  const near = len(sub(rig.tail[bone], rig.head[bone])) * 0.5;
  return rig.names.some(
    (name, other) =>
      other !== bone && name.startsWith('Shoulder') && rig.parent[other] === rig.parent[bone] && len(sub(rig.tail[other], rig.tail[bone])) < near,
  );
}
function helperOf(rig: PoseRig, bone: number): Helper {
  const name = rig.names[bone];
  // 锁骨：出力快，但转不了多少
  if (name.startsWith('Shoulder')) return crowded(rig, bone) ? CROWDED : { give: 0.5, step: 16 * DEG, max: 50 * DEG, collar: true };
  // 兽身的那几节：基本不弯
  if (name.startsWith('LowerBody') || name === 'Abdomen') return { give: 0.15, step: 5 * DEG, max: 15 * DEG };
  // 脊柱
  return { give: 0.3, step: 11 * DEG, max: 65 * DEG };
}

/** 一条肢体在这次拖动开始时的样子 */
interface Held {
  /** 弯曲平面的法线 */
  normal: V3;
  /** 从根部关节指向末端的方向 */
  axis: V3;
  /** 上、下两节在「照关节位置摆出来的朝向」之外又拧了多少（人手动转过的），重新摆的时候原样带上 */
  twistUpper: Quat;
  twistLower: Quat;
}

/** 一节骨头从静止的朝向（base）转到「沿 dir、法线 normal」要怎么转 */
const turnTo = (dir: V3, normal: V3, base: Quat): Quat => quatMul(limbFrame(dir, normal), quatConj(base));

function holdOf(limb: Limb, f: Frame): Held {
  const s = f.pos[limb.upper];
  const e = f.pos[limb.lower];
  const w = f.pos[limb.end];
  const u = norm(sub(e, s));
  const v = norm(sub(w, e));
  const bent = cross(u, v);
  let normal: V3;
  if (len(bent) > STRAIGHT) {
    normal = norm(bent);
  } else {
    // 差不多是直的：弯曲平面看上面那节骨头自己拧到了哪
    const turned = reject(rotate(f.rot[limb.upper], limb.hinge), u);
    normal = len(turned) > 1e-6 ? norm(turned) : anyPerp(u);
  }
  const span = sub(w, s);
  return {
    normal,
    axis: len(span) > 1e-6 ? norm(span) : u,
    twistUpper: quatMul(quatConj(turnTo(u, normal, limb.baseUpper)), f.rot[limb.upper]),
    twistLower: quatMul(quatConj(turnTo(v, normal, limb.baseLower)), f.rot[limb.lower]),
  };
}

/**
 * 把一条肢体摆到末端落在 target 上（够不着就朝它伸直）。直接改 state。
 * f 是现在的姿势（要用它的根部关节位置和父骨骼的朝向）；held 是拖动开始时这条肢体的样子。
 * normal：指定弯曲平面（拖肘、膝的时候）；endRot：末端那根骨骼保持这个朝向（不给就跟着前臂、小腿转）。
 */
function placeLimb(
  rig: PoseRig,
  state: PoseState,
  f: Frame,
  limb: Limb,
  held: Held,
  target: V3,
  opts: { normal?: V3; endRot?: Quat; span?: number } = {},
) {
  const s = f.pos[limb.upper];
  const full = limb.len1 + limb.len2;
  const span = sub(target, s);
  const far = len(span);
  const axis = far > 1e-6 ? norm(span) : held.axis;
  // 本来就伸得更直的（opts.span），可以伸回到那么直
  const most = Math.max(full * REACH, Math.min(opts.span ?? 0, full));
  const dist = Math.min(most, Math.max(Math.abs(limb.len1 - limb.len2) + full * (1 - REACH), far));
  // 弯曲平面跟着「根部 → 末端」这根线一起转过去
  const carried = reject(opts.normal ?? rotate(quatBetween(held.axis, axis), held.normal), axis);
  const normal = len(carried) > 1e-6 ? norm(carried) : anyPerp(axis);
  // 三角形三条边都知道：算出根部那个角，中间关节就定下来了
  const cos = Math.max(-1, Math.min(1, (limb.len1 ** 2 + dist ** 2 - limb.len2 ** 2) / (2 * limb.len1 * dist)));
  const sin = Math.sqrt(1 - cos * cos);
  const out = cross(axis, normal);
  const mid = add(s, add(mul(axis, limb.len1 * cos), mul(out, limb.len1 * sin)));
  const end = add(s, mul(axis, dist));
  const upper = quatMul(turnTo(norm(sub(mid, s)), normal, limb.baseUpper), held.twistUpper);
  const lower = quatMul(turnTo(norm(sub(end, mid)), normal, limb.baseLower), held.twistLower);
  setWorldRot(rig, state, f, limb.upper, upper);
  state.local[limb.lower] = quatUnit(quatMul(quatConj(upper), lower));
  if (opts.endRot) state.local[limb.end] = quatUnit(quatMul(quatConj(lower), opts.endRot));
}

/** 从 from 到 target 超出 reach 的那一段（够得着就是 null） */
function shortfall(from: V3, target: V3, reach: number): V3 | null {
  const d = sub(target, from);
  const dist = len(d);
  return dist > reach ? mul(d, 1 - reach / dist) : null;
}

/** 钉着的脚够不着了：把胯拉回到每条腿都够得着的地方 */
function settleRoot(solver: Solver, state: PoseState, pins: readonly Pin[]) {
  const legs = pins.filter((pin) => solver.limbs[pin.limb].kind === 'leg');
  if (!legs.length) return;
  const f = forward(solver.rig, state);
  let shift: V3 = [0, 0, 0];
  for (let round = 0; round < 8; round++) {
    let moved = false;
    for (const pin of legs) {
      const limb = solver.limbs[pin.limb];
      const gap = shortfall(add(f.pos[limb.upper], shift), pin.pos, Math.max((limb.len1 + limb.len2) * REACH, pin.span));
      if (!gap) continue;
      shift = add(shift, gap);
      moved = true;
    }
    if (!moved) break;
  }
  if (len(shift) > 0) shiftRoot(solver.rig, state, f, shift);
}

const near = (a: V3, b: V3) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-7;
const sameTurn = (a: Quat, b: Quat) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) > 1 - 1e-12;

/** 身体动过以后，把钉着的肢体重新摆回各自的位置。f0 是拖动开始时的姿势 */
function keepPins(solver: Solver, state: PoseState, f0: Frame, pins: readonly Pin[]) {
  if (!pins.length) return;
  const { rig, limbs } = solver;
  const f = forward(rig, state);
  for (const pin of pins) {
    const limb = limbs[pin.limb];
    const p = rig.parent[limb.upper];
    // 根部关节没动、带着它的骨骼也没转：这条肢体不用碰
    if (near(f.pos[limb.upper], f0.pos[limb.upper]) && (p < 0 || sameTurn(f.rot[p], f0.rot[p]))) continue;
    placeLimb(rig, state, f, limb, holdOf(limb, f0), pin.pos, { endRot: pin.rot, span: pin.span });
  }
}

/** 手（脚）够不着 target：锁骨、脊柱朝它转一点，胯跟过去一些，反复几轮 */
function pull(solver: Solver, state: PoseState, start: PoseState, limb: Limb, target: V3, pins: readonly Pin[]) {
  const { rig } = solver;
  const reach = (limb.len1 + limb.len2) * REACH;
  // 手臂够不着、又有脚钉着：骨盆也跟着转（腿会重新摆回脚的位置）。脚都没钉的话骨盆一转腿就甩出去了，不转
  const planted = pins.some((pin) => solver.limbs[pin.limb].kind === 'leg');
  const helpers = limb.chain.length && planted ? [...limb.chain, rig.hips] : limb.chain;
  for (const give of ROOT_GIVE) {
    let f = forward(rig, state);
    let gap = shortfall(f.pos[limb.upper], target, reach);
    if (!gap) return;
    for (const bone of helpers) {
      const helper = bone === rig.hips ? PELVIS : helperOf(rig, bone);
      const from = sub(f.pos[limb.upper], f.pos[bone]);
      if (len(from) < 1e-6) continue;
      const turn = quatLimit(quatBetween(norm(from), norm(add(from, mul(gap, helper.give)))), helper.step);
      setWorldRot(rig, state, f, bone, quatMul(turn, f.rot[bone]));
      // 这次拖动里总共转了多少，有上限
      const since = quatLimit(quatMul(state.local[bone], quatConj(start.local[bone])), helper.max);
      state.local[bone] = quatUnit(quatMul(since, start.local[bone]));
      // 锁骨自己转的也有上限，剩下的交给后面几节脊柱
      if (helper.collar) state.local[bone] = quatLimit(state.local[bone], collarLimit(start, bone));
      f = forward(rig, state);
      gap = shortfall(f.pos[limb.upper], target, reach);
      if (!gap) return;
    }
    shiftRoot(rig, state, f, mul(gap, give));
    settleRoot(solver, state, pins);
  }
}

/** 第 bone 根骨骼属于哪条肢体（上、下两节或者末端）；都不是返回 -1 */
export const limbWith = (solver: Solver, bone: number): number =>
  solver.limbs.findIndex((limb) => limb.upper === bone || limb.lower === bone || limb.end === bone);

/** 把名字在 names 里的肢体钉在它们现在的位置上 */
export function capturePins(solver: Solver, frame: Frame, names: ReadonlySet<string>): Pin[] {
  const pins: Pin[] = [];
  solver.limbs.forEach((limb, i) => {
    if (names.has(limb.name)) {
      pins.push({ limb: i, pos: frame.pos[limb.end], rot: frame.rot[limb.end], span: len(sub(frame.pos[limb.end], frame.pos[limb.upper])) });
    }
  });
  return pins;
}

/**
 * 拖手、拖脚：第 limb 条肢体的末端去 target。
 * 够得着时只有这条肢体动；够不着时身体跟过去。手跟着前臂转，脚保持原来的朝向（抬腿时脚掌不会跟着小腿翻）。
 */
export function dragReach(solver: Solver, start: PoseState, limb: number, target: V3, pins: readonly Pin[]): PoseState {
  const { rig, limbs } = solver;
  const one = limbs[limb];
  const others = pins.filter((pin) => pin.limb !== limb);
  const f0 = forward(rig, start);
  const state = cloneState(start);
  pull(solver, state, start, one, target, others);
  placeLimb(rig, state, forward(rig, state), one, holdOf(one, f0), target, one.kind === 'leg' ? { endRot: f0.rot[one.end] } : {});
  keepPins(solver, state, f0, others);
  return state;
}

/** 拖肘、拖膝：手脚不动，中间那个关节绕着「根部 → 末端」这根线转到朝 toward 的那一边 */
export function dragBend(solver: Solver, start: PoseState, limb: number, toward: V3): PoseState {
  const { rig, limbs } = solver;
  const one = limbs[limb];
  const f0 = forward(rig, start);
  const held = holdOf(one, f0);
  const out = reject(sub(toward, f0.pos[one.upper]), held.axis);
  if (len(out) < 1e-6) return start;
  const state = cloneState(start);
  placeLimb(rig, state, f0, one, held, f0.pos[one.end], { normal: cross(norm(out), held.axis), endRot: f0.rot[one.end] });
  return state;
}

/** 拖胯：整个人跟着走，钉着的手脚留在原地；腿伸直了还够不着，胯就到此为止 */
export function dragBody(solver: Solver, start: PoseState, target: V3, pins: readonly Pin[]): PoseState {
  const { rig } = solver;
  const f0 = forward(rig, start);
  const state = cloneState(start);
  shiftRoot(rig, state, f0, sub(target, f0.pos[rig.hips]));
  settleRoot(solver, state, pins);
  keepPins(solver, state, f0, pins);
  return state;
}

/** 拖动时要转的一节骨骼，和它出几成力 */
export interface AimLink {
  bone: number;
  weight: number;
  /**
   * 这一节只能绕一根轴弯（手指的后两节）：axis 是静止姿势里那根轴的方向，
   * min、max 是相对父骨骼最少、最多弯多少弧度
   */
  hinge?: { axis: V3; min: number; max: number };
  /** 是锁骨：相对静止姿势最多转 collarLimit，再往外交给后面几节（拖肩上的圆点，见 handles.ts） */
  collar?: boolean;
}

/**
 * 拖一个长在身上的点（anchor 骨骼上、静止时在 rest 的那个点）：links 里的骨骼各自绕自己的关节转，让这个点朝 target 去。
 * 只有一节时就是「这节骨头指向手指」；几节一起时（拖胸口弯腰），越靠前的出力越多，反复几轮凑过去。
 * 拖肩膀时第一节是锁骨，它转到上限、或者够不着（锁骨长短不变）的那部分由后面几节脊柱补上（上身跟着转）。
 */
export function dragAim(
  solver: Solver,
  start: PoseState,
  links: readonly AimLink[],
  anchor: { bone: number; rest: V3 },
  target: V3,
  pins: readonly Pin[],
): PoseState {
  const { rig } = solver;
  const state = cloneState(start);
  // 一节的转一下就到位；几节的反复几轮凑过去，节数多的（尾巴）多凑几轮
  const rounds = links.length > 1 ? Math.max(4, links.length * 2) : 1;
  for (let round = 0; round < rounds; round++) {
    for (const link of links) {
      const f = forward(rig, state);
      const from = sub(pointOn(rig, f, anchor.bone, anchor.rest), f.pos[link.bone]);
      const to = sub(target, f.pos[link.bone]);
      if (len(from) < 1e-6 || len(to) < 1e-6) continue;
      if (link.hinge) {
        // 只绕自己的轴弯：两个方向都压到和轴垂直的平面里再比，转完夹在能弯的范围里
        const { axis, min, max } = link.hinge;
        const n = rotate(f.rot[link.bone], axis);
        const a = reject(from, n);
        const b = reject(to, n);
        if (len(a) < 1e-6 || len(b) < 1e-6) continue;
        const local = state.local[link.bone];
        const now = 2 * Math.atan2(local[0] * axis[0] + local[1] * axis[1] + local[2] * axis[2], local[3]);
        const bent = now - 2 * Math.PI * Math.round(now / (2 * Math.PI)) + Math.atan2(dot(cross(a, b), n), dot(a, b)) * link.weight;
        const half = Math.min(max, Math.max(min, bent)) / 2;
        const s = Math.sin(half);
        state.local[link.bone] = [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
        continue;
      }
      setWorldRot(rig, state, f, link.bone, quatMul(quatPart(quatBetween(norm(from), norm(to)), link.weight), f.rot[link.bone]));
      if (link.collar) state.local[link.bone] = quatLimit(state.local[link.bone], collarLimit(start, link.bone));
    }
  }
  const turned = new Set(links.map((link) => link.bone));
  const others = pins.filter((pin) => {
    const limb = solver.limbs[pin.limb];
    return !turned.has(limb.upper) && !turned.has(limb.lower) && !turned.has(limb.end);
  });
  settleRoot(solver, state, others);
  keepPins(solver, state, forward(rig, start), others);
  return state;
}

/**
 * 脚全部踩到地上（摆姿势里的「脚踩到地上」）：每只脚原地落到地面（前后左右不动，只往上下挪），脚掌放平
 * （只留脚尖朝哪个方向转，前后翘、左右歪的都去掉，脚趾也放平），腿照这个重新弯；
 * 有哪条腿伸直了也够不着地面（跳起来、踮着脚的姿势），整个人先往下落到每条都够得着、膝盖还留一点弯。
 * 上半身不动。floor：地面多高（米）；脚踝离地多高照静止姿势（静止时站在 y = 0 上）。没有腿的原样返回
 */
export function plantFeet(solver: Solver, start: PoseState, floor = 0): PoseState {
  const { rig, limbs } = solver;
  // 没有腿、靠手撑在地上的（连体，静止时手就在地上）：踩的是手
  const standing = limbs.filter((limb) => limb.kind === 'leg');
  const legs = standing.length ? standing : limbs.filter((limb) => limb.kind === 'arm' && rig.head[limb.end][1] < PALM_REST);
  if (!legs.length) return start;
  const f0 = forward(rig, start);
  const state = cloneState(start);
  const targets = legs.map((limb) => {
    const at = f0.pos[limb.end];
    // 脚掌放平：静止时脚是平的，所以只留绕竖直方向转的那一点（脚尖朝哪）
    const way = sub(rig.tail[limb.end], rig.head[limb.end]);
    const now = rotate(f0.rot[limb.end], way);
    const a: V3 = [way[0], 0, way[2]];
    const b: V3 = [now[0], 0, now[2]];
    const rot: Quat = len(a) > 1e-6 && len(b) > 1e-6 && dot(norm(a), norm(b)) > -0.999 ? quatBetween(norm(a), norm(b)) : [0, 0, 0, 1];
    return { limb, pos: [at[0], floor + Math.max(0, rig.head[limb.end][1]), at[2]] as V3, rot };
  });
  // 够不着地面的：整个人往下落，落到最够不着的那条也够得着、膝盖还弯着 PLANT_BEND
  let drop = 0;
  for (const { limb, pos } of targets) {
    const s = f0.pos[limb.upper];
    const reach = (limb.len1 + limb.len2) * PLANT_BEND;
    const flat = Math.hypot(pos[0] - s[0], pos[2] - s[2]);
    if (flat >= reach) continue;
    drop = Math.max(drop, s[1] - pos[1] - Math.sqrt(reach * reach - flat * flat));
  }
  if (drop > 0) shiftRoot(rig, state, f0, [0, -drop, 0]);
  const f = forward(rig, state);
  for (const { limb, pos, rot } of targets) placeLimb(rig, state, f, limb, holdOf(limb, f0), pos, { endRot: rot });
  // 脚趾放平；腿末端接的是手的（手脚互换）、撑地的手（连体），手指也放平
  const planted = (j: number) => {
    for (let p = rig.parent[j]; p >= 0; p = rig.parent[p]) if (legs.some((limb) => limb.end === p)) return true;
    return false;
  };
  rig.names.forEach((name, j) => {
    if (/^Leg(Thumb|Index|Middle|Ring|Little|Finger[A-C])\d/.test(name) || ((/^Toe/.test(name) || /^(Thumb|Index|Middle|Ring|Little|Finger[A-C])\d/.test(name)) && planted(j))) state.local[j] = [0, 0, 0, 1];
  });
  return state;
}
/** 没有腿时，静止姿势里手腕离地不到这么高（米）的手算是撑在地上的（连体） */
const PALM_REST = 0.15;
/** 脚踩到地上时腿最多伸到全长的这么多（留一点弯，看着是站着，不是绷直了吊着） */
const PLANT_BEND = 0.97;

/** 用旋转环转一根骨骼：让它在世界里朝 rot。它自己所在的那条肢体不再钉着，别的钉着的照旧 */
export function turnBone(solver: Solver, start: PoseState, bone: number, rot: Quat, pins: readonly Pin[]): PoseState {
  const { rig } = solver;
  const f0 = forward(rig, start);
  const state = cloneState(start);
  setWorldRot(rig, state, f0, bone, rot);
  const own = limbWith(solver, bone);
  const others = pins.filter((pin) => pin.limb !== own);
  settleRoot(solver, state, others);
  keepPins(solver, state, f0, others);
  return state;
}
