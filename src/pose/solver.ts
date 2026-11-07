/**
 * 一副骨架摆姿势要用的全部东西（骨架、手臂和腿、每根骨骼从哪算起），以及姿势数据和这副骨架之间的换算。纯函数。
 *
 * 姿势数据（posing.ts）记的是每根骨骼在世界里一共转了多少：手臂从「T-pose、手肘朝后」算起，别的从静止姿势算起。
 * 所以同一份姿势放到 A-pose 的身体上、T-pose 的身体上、另一个角色身上，摆出来的是同一个样子；
 * 这里的 frames 就是「这副骨架的每根骨骼，静止时相对那个起点已经转了多少」：
 * 手臂上的骨骼是「从 T-pose 转到它静止时的方向」，别的骨骼是「没转」。
 * 手掌和手指另有自己的起点（手心朝下、四指并拢伸直，见 fingers.ts）：
 * 静止时手掌歪着一点、手指张着弯着的骨架，手心的朝向和手势照样对得上。
 */
import { type Quat, type V3, Q_ID, mul, quatBasis, quatConj, quatMul } from '../geometry/vec';
import { type Hand, extraFingerTwin, findHands } from './fingers';
import { type Limb, findLimbs, limbFrame } from './limbs';
import { quatUnit } from './math';
import { type Posing, POSING_VERSION, mirrorQuat, placedTwins, roundQuat, tidyQuat, tidyRoot, twinBone } from './posing';
import { type PoseRig, type PoseState, type RigBone, cloneState, forward, makeRig, restState } from './rig';

export interface Solver {
  rig: PoseRig;
  limbs: Limb[];
  /** 带手指的手（没有手指骨骼的手不在里面） */
  hands: Hand[];
  /** 每根骨骼静止时相对「算起的那个姿势」已经转了多少（见上面） */
  frames: Quat[];
  /** 同上，照第 2 版姿势数据的意思：那时手掌没有自己的起点，跟着前臂算 */
  frames2: Quat[];
  /** 是不是身上的主要骨骼（脊柱、脖子、头、锁骨、四肢、手脚）：摆过姿势以后，这些骨骼每根都记 */
  main: boolean[];
}

const MAIN = /^(Hips|Spine|Chest|UpperChest|Neck|Head|Shoulder|UpperArm|LowerArm|Hand|UpperLeg|LowerLeg|Foot|Toes|ToeBase)(_[LR])?(\.\d+)?$/;

/** T-pose 的手臂：沿 X 伸出去，手肘的转轴朝下（前臂往前收） */
const T_POSE: Quat = quatBasis([1, 0, 0], [0, -1, 0], [0, 0, -1]);

/**
 * 手臂上一节骨头静止时的朝向，相对 T-pose 转了多少。dir 是骨头的方向，hinge 是手肘的转轴。
 * 右手臂的两根轴都反过来取：这样左右手臂在 T-pose 时是同一个朝向，镜像一个姿势只要把四元数的 y、z 反号。
 */
const armFrame = (dir: V3, hinge: V3, side: number): Quat => quatMul(limbFrame(mul(dir, side), mul(hinge, side)), quatConj(T_POSE));

export function makeSolver(bones: readonly RigBone[]): Solver {
  const rig = makeRig(bones);
  const limbs = findLimbs(rig);
  const own = new Map<number, Quat>();
  for (const limb of limbs) {
    if (limb.kind !== 'arm') continue;
    const dir = (from: number, to: number): V3 => {
      const d: V3 = [rig.head[to][0] - rig.head[from][0], rig.head[to][1] - rig.head[from][1], rig.head[to][2] - rig.head[from][2]];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      return [d[0] / l, d[1] / l, d[2] / l];
    };
    own.set(limb.upper, armFrame(dir(limb.upper, limb.lower), limb.hinge, limb.side));
    own.set(limb.lower, armFrame(dir(limb.lower, limb.end), limb.hinge, limb.side));
  }
  // 手指每一节也各有各的
  const { hands, frames: fingers } = findHands(rig, limbs);
  for (const [bone, frame] of fingers) own.set(bone, frame);
  // 上臂、前臂、手指各有各的；它们下面的骨骼（袖子）跟着所在的那一节。别的骨骼都是「没转」
  const spread = (): Quat[] => {
    const frames: Quat[] = [];
    rig.names.forEach((_, j) => {
      const p = rig.parent[j];
      frames.push(own.get(j) ?? (p >= 0 ? frames[p] : Q_ID));
    });
    return frames;
  };
  const frames2 = spread();
  // 带手指的手：手掌有自己的起点
  for (const hand of hands) own.set(hand.bone, hand.frame);
  return { rig, limbs, hands, frames: spread(), frames2, main: rig.names.map((name) => MAIN.test(name)) };
}

/** 姿势数据 → 这副骨架上的姿势。骨架上没有的骨骼跳过 */
export function stateOf(solver: Solver, posing: Posing): PoseState {
  const { rig } = solver;
  const frames = posing.version === 2 ? solver.frames2 : solver.frames;
  const state = restState(rig);
  if (posing.root) state.root = mul(posing.root, rig.unit);
  if (posing.version === 1) {
    // 旧的记法：直接就是相对父骨骼又转的那一下
    for (const [name, q] of Object.entries(posing.bones)) {
      const i = rig.index.get(name);
      if (i !== undefined) state.local[i] = quatUnit(q);
    }
    return state;
  }
  // 记着的骨骼：世界里一共转了多少 → 相对静止姿势转了多少 → 相对父骨骼转了多少。没记的跟着父骨骼
  const world: Quat[] = [];
  rig.names.forEach((name, j) => {
    const p = rig.parent[j];
    const above = p >= 0 ? world[p] : Q_ID;
    // 多出来的手指没记的：跟着它照着复制的那根（无名指）
    const twin = extraFingerTwin(name);
    const told = posing.bones[name] ?? (twin ? posing.bones[twin] : undefined);
    if (!told) {
      world.push(above);
      return;
    }
    const turned = quatMul(quatUnit(told), quatConj(frames[j]));
    world.push(turned);
    state.local[j] = quatUnit(quatMul(quatConj(above), turned));
  });
  return state;
}

/**
 * 这副骨架上的姿势 → 姿势数据。keep：原来的姿势数据，里面这副骨架上没有的骨骼原样留着
 * （减掉的手臂加回来时姿势还在）。整个人都没动过的话是空姿势。
 */
export function posingOf(solver: Solver, state: PoseState, keep?: Posing): Posing {
  const { rig, frames, main } = solver;
  const bones: Record<string, Quat> = {};
  if (keep && keep.version !== 1) {
    // 第 2 版的数据里，手掌是另一种算法：这副骨架上没有的手就不留了，别的照留
    const stale = keep.version === 2 ? /^Hand_/ : null;
    for (const [name, q] of Object.entries(keep.bones)) if (!rig.index.has(name) && !stale?.test(name)) bones[name] = q;
  }
  const root = tidyRoot(mul(state.root, 1 / rig.unit));
  const moved = state.local.map((q) => tidyQuat(q) !== null);
  if (root || moved.some(Boolean)) {
    const frame = forward(rig, state);
    rig.names.forEach((name, j) => {
      if (main[j] || moved[j]) bones[name] = roundQuat(quatMul(frame.rot[j], frames[j]));
    });
  }
  // 表情不在骨架上：原来的姿势数据里有，就原样带着
  return { version: POSING_VERSION, bones, ...(root ? { root } : {}), ...(keep?.faces ? { faces: keep.faces } : {}) };
}

/**
 * 把一侧的姿势照到另一侧：from 那一侧的每根骨骼，对侧的那一根相对各自的父骨骼摆成镜像。
 * 对侧原来的姿势被盖掉；中间的骨骼（脊柱、头）和整个人的位置不动。
 * 是相对身体对称，不是相对地面：身子拧着的时候，两只手相对胸口还是一边一个样。
 */
export function mirrorState(solver: Solver, state: PoseState, from: 'L' | 'R'): PoseState {
  const { rig } = solver;
  const out = cloneState(state);
  const placed = placedTwins(rig);
  rig.names.forEach((name, j) => {
    const pair = twinBone(name) ?? placed.get(name);
    if (!pair || pair.side !== from) return;
    const other = rig.index.get(pair.twin);
    if (other !== undefined) out.local[other] = mirrorQuat(state.local[j]);
  });
  return out;
}
