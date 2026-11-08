/**
 * 现成的姿势套到 queen conjoined 连体上（geometry/conjoined.ts、character/conjoin.ts）。
 *
 * 姿势数据（posing.ts 第 3 版）记的是「直立的一个人」在世界里每根骨骼转了多少，轴是角色自己的轴。
 * 连体静止时两个上半身是趴着、侧躺着、倒立着的，照原样套上去的话，手臂照世界的方向摆（举手是朝天、垂手是朝地），
 * 胯一转整个人跟着翻过去，撑在地上的手也被抬起来——整个人翻滚、手乱飞。所以这里：
 * - 每个上半身量出自己静止时的朝向 B（照两边肩膀、脊柱的根量：X 是它的左手边，Y 是朝头，Z 是胸口朝的那边），
 *   姿势换到它自己的朝向里去套：上臂、前臂、手、手指是从 T-pose 算起的，转法是 B·q；
 *   别的（脊柱、脖子、头、锁骨）是从静止姿势算起的，转法是 B·q·B⁻¹。
 * - 姿势只写了第一对手臂、第一个头：每个上半身的每一对手臂、每个头都照姿势里同名（去掉 .002 这类编号）的那根套，
 *   各做一整套。
 * - 胯（两个上半身接在一起的那一节）、整个人的位置不动：连体靠这个姿态撑着地。
 * - 撑着身子的手（趴着、倒立时落在地上的手，侧躺时胳膊肘撑着的那只）连同锁骨留在原处，写成静止的样子
 *   （不写的话别的手臂会跟着第一对动，见 fit.ts 的 followArms）；有手撑着的上半身脊柱也不弯（一弯手就离地）。
 *   平躺时手只是放着，照姿势摆。
 * 纯函数。
 */
import type { Quat, V3 } from '../geometry/vec';
import { cross, norm, quatConj, quatMul, sub } from '../geometry/vec';
import type { ConjoinPose } from '../model/spec';
import { quatUnit } from './math';
import type { Posing } from './posing';
import type { Solver } from './solver';

/** 从 T-pose 算起的骨骼（去掉编号以后的名字） */
const FROM_T = /^(UpperArm|LowerArm|Hand|(Thumb|Index|Middle|Ring|Little|Finger[A-C])\d)_[LR]$/;
/** 手臂上的骨骼（锁骨也算） */
const ARM_PART = /^(Shoulder|UpperArm|LowerArm|Hand|(Thumb|Index|Middle|Ring|Little|Finger[A-C])\d)_[LR]$/;
/** 离地不到整个人高的这么多倍，就算落在地上 */
const NEAR_GROUND = 0.12;

const baseName = (name: string) => name.replace(/\.\d{3}$/, '');

/** 三根轴（列）拼成的旋转 → 四元数 */
function basisQuat(x: V3, y: V3, z: V3): Quat {
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  return quatUnit(q);
}

const average = (points: V3[]): V3 => {
  const sum: V3 = [0, 0, 0];
  for (const p of points) for (let k = 0; k < 3; k++) sum[k] += p[k] / points.length;
  return sum;
};

/** 把直立的人的姿势换成这副连体骨架上的（见文件开头）。不是连体、旧记法的姿势原样返回 */
export function fitConjoined(solver: Solver, posing: Posing, posture: ConjoinPose): Posing {
  if (posing.version === 1) return posing;
  const { rig, limbs } = solver;
  const frames = posing.version === 2 ? solver.frames2 : solver.frames;
  const { names, parent, head } = rig;
  // 两个上半身：胯底下直接接着的脊柱
  const roots = names.flatMap((name, j) => (parent[j] === rig.hips && /^Spine/.test(name) ? [j] : []));
  if (roots.length < 2) return posing;
  const bodyOf = (j: number): number => {
    for (let b = j; b >= 0; b = parent[b]) if (parent[b] === rig.hips) return roots.indexOf(b);
    return -1;
  };
  // 每个上半身静止时的朝向
  const turns: (Quat | null)[] = roots.map((root, k) => {
    const shoulders = (side: 'L' | 'R') => names.flatMap((name, j) => (bodyOf(j) === k && new RegExp(`^UpperArm_${side}`).test(name) ? [head[j]] : []));
    const left = shoulders('L');
    const right = shoulders('R');
    if (!left.length || !right.length) return null;
    const y = norm(sub(average([...left, ...right]), head[root]));
    const across = sub(average(left), average(right));
    const k2 = across[0] * y[0] + across[1] * y[1] + across[2] * y[2];
    const x = norm([across[0] - y[0] * k2, across[1] - y[1] * k2, across[2] - y[2] * k2]);
    return basisQuat(x, y, cross(x, y));
  });
  // 撑着身子的手臂：手落在地上（侧躺时还要胳膊肘也落在地上：上面那只手撑在胸前的地上，只是放着）
  let low = Infinity;
  let top = -Infinity;
  for (const p of head) {
    low = Math.min(low, p[1]);
    top = Math.max(top, p[1]);
  }
  const near = (j: number) => head[j][1] - low < NEAR_GROUND * (top - low);
  const support = new Set<number>();
  if (posture !== 'flat') {
    for (const limb of limbs) {
      if (limb.kind !== 'arm' || !near(limb.end)) continue;
      if (posture === 'lie' && !near(limb.lower)) continue;
      // 这条手臂上的骨骼：从上臂往下的，再加上它的锁骨（锁骨照姿势转的话整条手臂跟着挪开）
      const collar = parent[limb.upper];
      if (collar >= 0 && /^Shoulder_/.test(names[collar])) support.add(collar);
      for (let j = 0; j < names.length; j++) {
        for (let b = j; b >= 0; b = parent[b]) {
          if (b === limb.upper) {
            support.add(j);
            break;
          }
        }
      }
    }
  }
  // 有手撑着的上半身，脊柱也不照姿势弯：一弯肩膀就挪开，撑在地上的手跟着离地
  const propped = new Set([...support].map(bodyOf));
  const bones: Record<string, Quat> = {};
  names.forEach((name, j) => {
    const k = bodyOf(j);
    if (k < 0) return;
    const base = baseName(name);
    if (propped.has(k) && /^(Spine|Chest|UpperChest)$/.test(base)) return;
    if (support.has(j)) {
      // 留在静止的样子：从 T-pose 算起的写成「转回静止」那一下，别的写成没转
      if (ARM_PART.test(base)) bones[name] = FROM_T.test(base) ? frames[j] : [0, 0, 0, 1];
      return;
    }
    const told = posing.bones[base] ?? posing.bones[name];
    const B = turns[k];
    if (!told) return;
    if (!B) {
      bones[name] = told;
      return;
    }
    bones[name] = quatUnit(FROM_T.test(base) ? quatMul(B, told) : quatMul(quatMul(B, told), quatConj(B)));
  });
  return { version: posing.version, bones, ...(posing.faces ? { faces: posing.faces } : {}) };
}
