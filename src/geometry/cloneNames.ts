/**
 * 体块：手工复制出来的部件的骨骼用的号段（见 clone.ts）。单独放一个小文件：摆姿势那边（pose/solver.ts）也要认，不用把整个复制模块带过去。
 */
import { nthName } from './figure';

/** 复制出来的骨骼的序号（UpperArm_L.101）：从第 100 个起，每块留 BONE_STEP 个。骨骼的序号只有三位（见 nthName），最多到 999 */
export const BONE_FIRST = 100;
export const BONE_STEP = 20;
export const BONE_LAST = 998;

/** 骨骼名 → 底名和第几个（Chest.002 → Chest、1） */
export const ordinal = (name: string): [string, number] => {
  const m = /^(.*?)(?:\.(\d{3}))?$/.exec(name)!;
  return [m[1], m[2] ? Number(m[2]) - 1 : 0];
};

/**
 * 复制出来的骨骼是照哪根复制的：UpperArm_L.101 → UpperArm_L，Chest.102 → Chest.002，Hips.121 → Hips。不是复制出来的是 null。
 * （号段里被占了往后挪过的对不上原来那根，那是一块里同名的骨骼超过 BONE_STEP 根的时候，平常碰不到）
 */
export function cloneBoneSource(name: string): string | null {
  const [base, index] = ordinal(name);
  return index < BONE_FIRST ? null : nthName(base, (index - BONE_FIRST) % BONE_STEP);
}
