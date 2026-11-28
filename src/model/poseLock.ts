/**
 * 摆姿势时按部位锁定（每个角色各记各的，存在设定里的 poseLock）。部位和「现成的姿势 → 套到哪些部位」是同一套：
 * 头、躯干、左手臂、右手臂、腿（见 pose/blend.ts 的 POSE_REGIONS；好几对手臂时左边的都算左手臂）。
 *
 * 锁了的部位：
 * - 圆点不给，拖不动；拖别的部位时它相对父骨骼保持原样（跟着身子走）。躯干锁了，整个人的位置也不挪。
 *   求解器那边见 pose/solve.ts 的 keepLocked。
 * - 什么都不改它的姿势：套现成姿势、还原、初始化、镜像、脚踩地、双人动作、抓道具都跳过它（main.ts 的 guardPose）。
 * - 体型照常能改。
 */
import { POSE_REGIONS, type PoseRegion, regionOf } from '../pose/blend';
import type { BodySpec } from './spec';

/** 这根骨骼是不是躯干上的（胯、脊柱、胸，好几个上半身的也算） */
export const isTorsoBone = (name: string): boolean => regionOf(name) === 'torso';

/** 这根骨骼属于哪个部位（pose/blend.ts 的 regionOf，ToeBase 也算腿）；尾巴、翅膀、头发这些是 null */
export const boneRegion = (name: string): PoseRegion | null => regionOf(name) ?? (/^ToeBase(_[LR])?(\.\d+)?$/.test(name) ? 'legs' : null);

/** 锁了哪几个部位 */
export const lockedRegions = (spec: Pick<BodySpec, 'poseLock'>): ReadonlySet<PoseRegion> => new Set(spec.poseLock ?? []);

/** 某个部位锁了没有 */
export const isLocked = (spec: Pick<BodySpec, 'poseLock'>, region: PoseRegion): boolean => spec.poseLock?.includes(region) ?? false;

/** 锁定开关：照 POSE_REGIONS 的顺序记，一个都没锁就不写 */
export function setPoseLock(spec: BodySpec, region: PoseRegion, on: boolean): BodySpec {
  const set = new Set(spec.poseLock ?? []);
  if (on) set.add(region);
  else set.delete(region);
  const list = POSE_REGIONS.filter((r) => set.has(r));
  const { poseLock: _lock, ...rest } = spec;
  return list.length ? { ...rest, poseLock: list } : rest;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 读存档：认得的部位留下，照 POSE_REGIONS 排好。
 * 以前的版本（11-28 那两版）记的是躯干锁定（torsoLock）、躯干冻结（torsoFreeze）、四肢冻结（limbFreeze）：
 * 换成那几个部位锁定（姿势存档时已经是冻结时的样子；体型不再定住）
 */
export function cleanPoseLock(src: Record<string, unknown>): PoseRegion[] {
  const set = new Set<PoseRegion>();
  if (Array.isArray(src.poseLock)) for (const r of src.poseLock) if ((POSE_REGIONS as readonly unknown[]).includes(r)) set.add(r as PoseRegion);
  if (src.torsoLock === true || isRecord(src.torsoFreeze)) set.add('torso');
  if (isRecord(src.limbFreeze)) for (const r of ['armL', 'armR', 'legs'] as const) set.add(r);
  return POSE_REGIONS.filter((r) => set.has(r));
}
