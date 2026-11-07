/**
 * 现成的姿势只套一部分、只套几成：照 Blender 姿态库的「只套到选中的骨骼」和「拖着混合」。纯函数。
 *
 * 部位按骨骼名分：头和脖子；躯干（胯、脊柱，连同整个人的位置）；左手臂、右手臂（锁骨、手、手指都算）；腿。
 * 套几成：选中的每根骨骼，在世界里的朝向从现在的样子往姿势里的样子转过去那么几成（走近的那一边）。
 * 没选中的骨骼保持相对父骨骼的样子，跟着父骨骼走（头发、裙摆、尾巴这些挂着的也是）。
 */
import { type Quat, lerp, quatConj, quatMul } from '../geometry/vec';
import { quatPart, quatUnit } from './math';
import { type PoseRig, type PoseState, cloneState, forward } from './rig';

export const POSE_REGIONS = ['head', 'torso', 'armL', 'armR', 'legs'] as const;
export type PoseRegion = (typeof POSE_REGIONS)[number];

/** 名字后面可能带着第几个（.002）；好几个上半身时脊柱、脖子还带着在哪一边（Spine_L、Neck_R.002） */
const REGIONS: [PoseRegion, RegExp][] = [
  ['head', /^(Neck|Head)(_[LR])?(\.\d+)?$/],
  ['torso', /^(Hips|Spine|Chest|UpperChest)(_[LR])?(\.\d+)?$/],
  ['armL', /^(Shoulder|UpperArm|LowerArm|Hand|(Thumb|Index|Middle|Ring|Little|Finger[A-C])\d)_L(\.\d+)?$/],
  ['armR', /^(Shoulder|UpperArm|LowerArm|Hand|(Thumb|Index|Middle|Ring|Little|Finger[A-C])\d)_R(\.\d+)?$/],
  ['legs', /^(UpperLeg|LowerLeg|Foot|Toes|Leg(Thumb|Index|Middle|Ring|Little|Finger[A-C])\d)(_[LR])?(\.\d+)?$/],
];

/** 这根骨骼属于哪个部位；都不是（尾巴、翅膀、头发、眼睛、兽身……）就是 null */
export function regionOf(name: string): PoseRegion | null {
  return REGIONS.find(([, re]) => re.test(name))?.[0] ?? null;
}

/** 手臂上的骨骼是第几对的（0 是第一对，见 geometry/figure 的 nthName）；不是手臂的是 -1 */
export function armPairOf(name: string): number {
  const region = regionOf(name);
  if (region !== 'armL' && region !== 'armR') return -1;
  const m = /\.(\d+)$/.exec(name);
  return m ? Number(m[1]) - 1 : 0;
}

/**
 * 从 base 往 target 混合 amount（0–1）：pick 选中的骨骼在世界里的朝向转过去那么几成，别的骨骼保持相对父骨骼的样子。
 * root：整个人的位置也挪那么几成。全部选中、amount 是 1 时就是 target 本身
 */
export function blendPose(rig: PoseRig, base: PoseState, target: PoseState, amount: number, pick: (bone: number) => boolean, root: boolean): PoseState {
  const from = forward(rig, base);
  const to = forward(rig, target);
  const out = cloneState(base);
  const rot = new Array<Quat>(rig.names.length);
  rig.names.forEach((_, j) => {
    const p = rig.parent[j];
    rot[j] = pick(j)
      ? quatUnit(quatMul(from.rot[j], quatPart(quatMul(quatConj(from.rot[j]), to.rot[j]), amount)))
      : p >= 0
        ? quatMul(rot[p], base.local[j])
        : base.local[j];
    out.local[j] = quatUnit(p >= 0 ? quatMul(quatConj(rot[p]), rot[j]) : rot[j]);
  });
  if (root) out.root = lerp(base.root, target.root, amount);
  return out;
}
