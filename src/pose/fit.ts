/**
 * 现成的姿势（pose/library.ts）是给两条手臂的人摆的，姿势数据里的手臂就是第一对（UpperArm_L、UpperArm_R）。
 * 同一个肩膀上挤着几条手臂时（「肩部聚拢」），只摆第一对会出毛病：几条手臂本来是散开的（最后一条垂在肩膀上，
 * 第一条举在后面），姿势把第一条摆成垂着的样子，它就和本来垂在那里的那一条叠在了一起。
 * 换成只摆别的哪一条也不行：这几条手臂挨得很近（静止时相邻两条只差十来度），一条挪开十几度就贴到旁边那条上。
 *
 * 所以每一侧先找这个姿势里上臂的方向和哪一条静止时的方向最接近——那一条正好摆成这个姿势
 * （垂着的姿势落在本来就垂着的那条上，举着的姿势落在举着的那条上），然后分两种情况：
 * - 这个姿势里的手臂和那一条静止时差不多（上臂、前臂都差不到 TOGETHER）：同一个肩膀上的几条一起摆，
 *   别的几条照那一条「相对自己静止时转了多少」跟着转同样多（上臂、前臂、手、手指每一节都是），还是原来那样散开着。
 *   只摆那一条的话，它挪开十几度就贴到旁边那条上了。
 * - 差得多（抱着胳膊、打电话、举枪这类）：只有那一条摆成这个姿势，别的保持自己静止时的样子。
 *   这时那一条已经离开了这一把手臂，不会和它们挤；几条一起摆的话，一把手一起伸到胸前、头边，反而都插在身上。
 * 沿躯干上下排的几对各有各的肩膀，不在此列：还是只摆最上面那一对，别的保持自己静止时的样子。
 * 纯函数。
 */
import { nthName } from '../geometry/figure';
import { type Quat, type V3, quatConj, quatMul, rotate } from '../geometry/vec';
import type { Limb } from './limbs';
import type { Posing } from './posing';
import { forward } from './rig';
import { type Solver, stateOf } from './solver';

/** 一条手臂上的骨骼（锁骨、上臂、前臂、手、手指），第一对的名字 */
const ARM_BONE = /^(?:Shoulder|UpperArm|LowerArm|Hand|(?:Thumb|Index|Middle|Ring|Little)\d)_([LR])$/;
/** 肩关节离第一对的肩关节不到上臂长的这么多倍，才算和它挤在同一个肩膀上 */
const SAME_SHOULDER = 0.5;
/** 姿势里的上臂、前臂和最接近的那条手臂静止时的方向都差不到这么多（弧度），几条手臂就一起摆 */
const TOGETHER = (35 * Math.PI) / 180;

/** 把现成的姿势里的手臂照到同一个肩膀上的每一条手臂上（见文件开头）。用不着的时候返回原来那份 */
export function fitArms(solver: Solver, posing: Posing): Posing {
  // 第 1 版的数据记的是相对父骨骼转了多少，换到别的手臂上意思就变了：不动
  if (posing.version === 1) return posing;
  const { rig, limbs } = solver;
  const frames = posing.version === 2 ? solver.frames2 : solver.frames;
  const arms = limbs.filter((limb) => limb.kind === 'arm');
  if (arms.length <= 2) return posing;
  /** 静止时从一根骨骼的头指向另一根的头的方向 */
  const restWay = (from: number, to: number): V3 => {
    const a = rig.head[from];
    const b = rig.head[to];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
  };
  const between = (a: V3, b: V3) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  const frame = forward(rig, stateOf(solver, posing));
  let bones = posing.bones;
  for (const side of [1, -1] as const) {
    const tag = side > 0 ? 'L' : 'R';
    if (!posing.bones[`UpperArm_${tag}`]) continue;
    const first = arms.find((limb) => limb.side === side && limb.pair === 0);
    if (!first) continue;
    // 和第一对挤在同一个肩膀上的几条
    const from = rig.head[first.upper];
    const mine = arms.filter((limb) => {
      const at = rig.head[limb.upper];
      return limb.side === side && Math.hypot(at[0] - from[0], at[1] - from[1], at[2] - from[2]) < SAME_SHOULDER * first.len1;
    });
    if (mine.length < 2) continue;
    // 这个姿势里上臂、前臂朝哪（放到哪条手臂上都是这个方向）；每条手臂不去摆它的话朝哪：跟着带它的那根骨骼
    // （锁骨上面那一根）转。上臂夹角最小的那一条：它正好摆成这个姿势
    const want = [rotate(frame.rot[first.upper], restWay(first.upper, first.lower)), rotate(frame.rot[first.lower], restWay(first.lower, first.end))];
    const away = (limb: Limb): [upper: number, fore: number] => {
      const collar = rig.index.get(nthName(`Shoulder_${tag}`, limb.pair)) ?? limb.upper;
      const base = rig.parent[collar];
      const slot = (way: V3) => (base >= 0 ? rotate(frame.rot[base], way) : way);
      return [between(slot(restWay(limb.upper, limb.lower)), want[0]), between(slot(restWay(limb.lower, limb.end)), want[1])];
    };
    const lead = mine.reduce((a, b) => (away(b)[0] < away(a)[0] ? b : a));
    const off = away(lead);
    // 一起摆的，还是只摆那一条的
    const turning = off[0] <= TOGETHER && off[1] <= TOGETHER ? mine : [lead];
    // 姿势数据记的是每根骨骼在世界里一共转了多少（从各自的起点 frames 算起）。那一条相对自己静止时转了
    // told · frames⁻¹；别的手臂上对应的那根骨骼也相对自己静止时转这么多，记下来就是 told · frames(那一条)⁻¹ · frames(自己)
    const fitted: Posing['bones'] = {};
    for (const [name, told] of Object.entries(bones)) {
      if (ARM_BONE.exec(name)?.[1] !== tag) {
        fitted[name] = told;
        continue;
      }
      const leading = rig.index.get(nthName(name, lead.pair));
      if (leading === undefined) continue;
      const turned = quatMul(told as Quat, quatConj(frames[leading]));
      for (const limb of turning) {
        const bone = rig.index.get(nthName(name, limb.pair));
        if (bone !== undefined) fitted[nthName(name, limb.pair)] = limb === lead ? (told as Quat) : quatMul(turned, frames[bone]);
      }
    }
    // 只摆第一对、别的不动：就是原来那份
    if (turning.length > 1 || lead !== first) bones = fitted;
  }
  return bones === posing.bones ? posing : { ...posing, bones };
}

/**
 * 别的多出来的手臂（沿躯干上下排的几对、好几个上半身时里侧的手臂）跟着原来的那条做同样的动作：
 * 现成的姿势只写了第一对，不跟的话它们一直保持静止的样子，身子弯下去、转过去，它们还直直地伸着。
 * 「原来的那条」是同一边的第一对（UpperArm_R.002 跟 UpperArm_R）。怎么跟：
 * - 和原来那条长在同一个上半身上（上下排）：相对自己静止时转同样多。静止时几排是错开着的，这样还是错开着；
 *   照搬一模一样的朝向的话，垂着的时候几条叠在一条线上。
 * - 长在另一个上半身上（两个上半身时，一边的里侧手臂跟的是另一边外侧的那条）：照搬一模一样的朝向，
 *   每个上半身各自做一整套动作（自己的左手、右手）。
 * 和第一对挤在同一个肩膀上的（肩部聚拢）照 fitArms，姿势里已经写了的不动。
 * 返回新的姿势数据和跟着动的那几条手臂（solver.limbs 的下标）：碰到东西的话让开、让不开就退回去，见 clear.ts
 */
export function followArms(solver: Solver, posing: Posing): { posing: Posing; followers: number[] } {
  const { rig, limbs } = solver;
  const frames = posing.version === 2 ? solver.frames2 : solver.frames;
  const arms = limbs.filter((limb) => limb.kind === 'arm');
  const followers: number[] = [];
  if (posing.version === 1 || arms.length <= 2) return { posing, followers };
  const bones = { ...posing.bones };
  for (const limb of arms) {
    if (limb.pair === 0 || posing.bones[rig.names[limb.upper]]) continue;
    const first = arms.find((other) => other.side === limb.side && other.pair === 0);
    if (!first || !posing.bones[rig.names[first.upper]]) continue;
    // 和姿势里摆了的手臂挤在同一个肩膀上的：fitArms 管
    const at = rig.head[limb.upper];
    const crowded = arms.some((other) => {
      if (other === limb || !posing.bones[rig.names[other.upper]]) return false;
      const p = rig.head[other.upper];
      return Math.hypot(at[0] - p[0], at[1] - p[1], at[2] - p[2]) < SAME_SHOULDER * first.len1;
    });
    if (crowded) continue;
    const same = torsoOf(rig, limb.upper) === torsoOf(rig, first.upper);
    const tag = limb.side > 0 ? 'L' : 'R';
    for (const [name, told] of Object.entries(posing.bones)) {
      if (ARM_BONE.exec(name)?.[1] !== tag) continue;
      const from = rig.index.get(name);
      const mine = nthName(name, limb.pair);
      const to = rig.index.get(mine);
      if (from === undefined || to === undefined) continue;
      bones[mine] = same ? quatMul(quatMul(told as Quat, quatConj(frames[from])), frames[to]) : (told as Quat);
    }
    followers.push(limbs.indexOf(limb));
  }
  return followers.length ? { posing: { ...posing, bones }, followers } : { posing, followers };
}

/** 一根骨骼（手臂）长在哪个上半身上：往上找到的第一节脊柱带的边（Spine_L 是 _L，正中那个是空的） */
export function torsoOf(rig: Pick<Solver['rig'], 'names' | 'parent'>, bone: number): string {
  for (let b = rig.parent[bone]; b >= 0; b = rig.parent[b]) {
    const m = /^(?:Spine|Chest|UpperChest)(_[LR])?(?:\.\d+)?$/.exec(rig.names[b]);
    if (m) return m[1] ?? '';
  }
  return '';
}
