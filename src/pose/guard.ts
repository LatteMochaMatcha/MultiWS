/**
 * 锁定的部位不让别的路子改它的姿势（见 model/poseLock.ts）：套现成姿势、还原、初始化、镜像、脚踩地、双人动作、抓道具……
 * 改完的姿势和改之前的比：锁定部位的骨骼相对父骨骼变了的，换回改之前的（跟着身子走）；躯干锁了，整个人的位置也换回去。
 * 拖圆点本来就不改锁定的部位（求解器的 keepLocked），过这一遍也不变。纯函数。
 */
import { type PoseRegion, blendPose } from './blend';
import type { Posing } from './posing';
import { type Solver, posingOf, stateOf } from './solver';
import { boneRegion } from '../model/poseLock';

/** 小于这些的不算改了（存档里的数留 5 位小数） */
const TURN_EPS = 1e-3;
const MOVE_EPS = 1e-4;

/**
 * next 里锁定部位的姿势换回 prev 的。没有要换的返回 null；
 * 有的话返回换好的姿势和被换回去的是哪几个部位（照 locked 的顺序）
 */
export function guardPosing(solver: Solver, prev: Posing, next: Posing, locked: ReadonlySet<PoseRegion>): { posing: Posing; touched: PoseRegion[] } | null {
  if (!locked.size) return null;
  const { rig } = solver;
  const a = stateOf(solver, prev);
  const b = stateOf(solver, next);
  const regions = rig.names.map(boneRegion);
  const touched = new Set<PoseRegion>();
  regions.forEach((region, j) => {
    if (region && locked.has(region) && angleBetween(a.local[j], b.local[j]) > TURN_EPS) touched.add(region);
  });
  const torso = locked.has('torso');
  if (torso && Math.hypot(a.root[0] - b.root[0], a.root[1] - b.root[1], a.root[2] - b.root[2]) > MOVE_EPS) touched.add('torso');
  if (!touched.size) return null;
  // 没锁的骨骼照 next 在世界里的朝向；锁了的（blendPose 里没选中的）保持 prev 相对父骨骼的样子，跟着身子走
  const mixed = blendPose(rig, a, b, 1, (j) => !(regions[j] && locked.has(regions[j]!)), !torso);
  return { posing: posingOf(solver, mixed, next), touched: [...locked].filter((r) => touched.has(r)) };
}

/** 两个旋转差多少（弧度） */
function angleBetween(p: readonly number[], q: readonly number[]): number {
  const d = Math.abs(p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3]);
  return 2 * Math.acos(Math.min(1, d));
}
