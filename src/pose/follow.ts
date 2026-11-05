/**
 * 多出来的手臂跟着其中一对：摆姿势时打开「几对手臂一起动」，别的几对手臂（锁骨、上臂、前臂、手、手指）一直照领头的那一对摆。
 * 领头的是最后拖过、转过的那一对（左右各算各的），界面上不用选。
 * 怎么跟和 fit.ts 的 followArms 一样：
 * - 和那一对长在同一个上半身上（沿躯干上下排、肩部聚拢）：相对自己静止时转同样多。静止时几排是错开着、散开着的，跟完还是那样；
 *   照搬一模一样的朝向的话，垂着的时候几条叠在一条线上。
 * - 长在另一个上半身上（两个上半身时里侧的手臂）：照搬一模一样的朝向（姿势数据里记的那个），每个上半身各自做一整套动作。
 * 左边的跟左边的，右边的跟右边的。别的骨骼（脊柱、头、腿……）、整个人的位置不动。纯函数。
 */
import { nthName } from '../geometry/figure';
import { type Quat, quatConj, quatMul } from '../geometry/vec';
import { armPairOf } from './blend';
import { quatUnit } from './math';
import { type PoseState, cloneState, forward } from './rig';
import type { Solver } from './solver';

/** 手臂上一根骨骼去掉「第几对」的后缀（UpperArm_L.002 → UpperArm_L） */
const baseName = (name: string) => name.replace(/\.\d+$/, '');

/** 左右两边各是哪一对领头（从 0 数）；只给一个数就是两边都是它 */
export type Leads = number | { left: number; right: number };
const leadOf = (leads: Leads, side: 1 | -1) => (typeof leads === 'number' ? leads : side > 0 ? leads.left : leads.right);

/** 一根骨骼是哪一对、哪一边手臂上的（锁骨、上臂、前臂、手、手指都算）；不是手臂上的给 null */
export function armOfBone(solver: Solver, bone: number): { pair: number; side: 1 | -1 } | null {
  const name = solver.rig.names[bone];
  if (name === undefined) return null;
  const pair = armPairOf(name);
  if (pair < 0) return null;
  return { pair, side: /_L(\.\d+)?$/.test(name) ? 1 : -1 };
}

/** 这副骨架上一共几对手臂 */
export const armPairCount = (solver: Solver): number =>
  solver.limbs.reduce((n, limb) => (limb.kind === 'arm' ? Math.max(n, limb.pair + 1) : n), 0);

/** 手臂长在哪个上半身上：往上找到的第一节脊柱带的边（Spine_L 是 _L，正中那个是空的） */
function torsoOf(solver: Solver, bone: number): string {
  const { rig } = solver;
  for (let b = rig.parent[bone]; b >= 0; b = rig.parent[b]) {
    const m = /^(?:Spine|Chest|UpperChest)(_[LR])?(?:\.\d+)?$/.exec(rig.names[b]);
    if (m) return m[1] ?? '';
  }
  return '';
}

/**
 * 让别的几对手臂跟着领头的那一对摆（leads：左右各是第几对，从 0 数）。这副骨架上没有那一对、或者只有一对手臂时原样返回。
 * 姿势状态记的是相对父骨骼转了多少；这里先算出每根跟着的骨骼在世界里该朝哪，再从上往下换回相对父骨骼的
 */
export function followPair(solver: Solver, state: PoseState, leads: Leads): PoseState {
  const { rig, frames } = solver;
  const pairs = armPairCount(solver);
  if (pairs < 2 || (leadOf(leads, 1) >= pairs && leadOf(leads, -1) >= pairs)) return state;
  const frame = forward(rig, state);
  /** 跟着的骨骼 → 它在世界里该朝哪（相对它自己的静止姿势） */
  const target = new Map<number, Quat>();
  /** 每一对、每一边的手臂各长在哪个上半身上（照上臂找） */
  const torso = new Map<string, string>();
  for (const limb of solver.limbs) if (limb.kind === 'arm') torso.set(`${limb.pair}${limb.side}`, torsoOf(solver, limb.upper));
  rig.names.forEach((name, from) => {
    const side: 1 | -1 = /_L(\.\d+)?$/.test(name) ? 1 : -1;
    const lead = leadOf(leads, side);
    if (armPairOf(name) !== lead) return;
    const base = baseName(name);
    const leadTorso = torso.get(`${lead}${side}`);
    for (let pair = 0; pair < pairs; pair++) {
      if (pair === lead) continue;
      const to = rig.index.get(nthName(base, pair));
      if (to === undefined) continue;
      // 同一个上半身：相对自己静止时转同样多；另一个上半身：姿势数据里记的朝向一样（世界里转的 × 起点）
      target.set(
        to,
        torso.get(`${pair}${side}`) === leadTorso ? frame.rot[from] : quatMul(quatMul(frame.rot[from], frames[from]), quatConj(frames[to])),
      );
    }
  });
  if (!target.size) return state;
  const out = cloneState(state);
  // 父骨骼在子骨骼前面（见 rig.ts）：从上往下，一边换一边记新的世界朝向
  const world: Quat[] = [];
  rig.names.forEach((_, j) => {
    const p = rig.parent[j];
    const above = p >= 0 ? world[p] : null;
    const want = target.get(j);
    if (want) out.local[j] = quatUnit(above ? quatMul(quatConj(above), want) : want);
    world.push(above ? quatMul(above, out.local[j]) : out.local[j]);
  });
  return out;
}
