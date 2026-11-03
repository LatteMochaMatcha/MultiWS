/**
 * 导出 VRM 前要在骨架上备好的两样（纯函数，界面在 main.ts 里调）：摆成 T-pose 用的姿势、尾巴的弹簧骨骼。
 */
import { type Quat, Q_ID } from '../geometry/vec';
import { FINGER_NAMES } from '../pose/fingers';
import { type Posing, POSING_VERSION } from '../pose/posing';
import type { Skeleton } from '../rig/skeleton';
import type { VrmSpring } from './vrm';

/**
 * VRM 的静止姿势是 T-pose：第一对手臂平举、手心朝下、五指并拢伸直。
 * 姿势数据里上臂、前臂、手、手指本来就是从这个样子算起的（见 pose/posing.ts），这几根不转就是 T-pose。
 * 平举的是进了人形骨骼对照表的那一对（好几个上半身时右手臂是第一个上半身里侧的那条，UpperArm_R.002），
 * 再加上不带序号的那一对（两边对称）；别的骨骼（多出来的手臂、头、腿）保持静止时的样子。humanoid 见 io/vrm.ts 的 humanoidMap
 */
export function tPosing(humanoid: Map<string, number>, rest: Skeleton): Posing {
  const bones: Record<string, Quat> = {};
  for (const s of ['L', 'R']) {
    for (const name of ['UpperArm', 'LowerArm', 'Hand']) bones[`${name}_${s}`] = Q_ID;
    for (const finger of FINGER_NAMES) for (let k = 1; k <= 3; k++) bones[`${finger}${k}_${s}`] = Q_ID;
  }
  for (const [slot, i] of humanoid) {
    if (/^(left|right)(UpperArm|LowerArm|Hand|Thumb|Index|Middle|Ring|Little)/.test(slot)) bones[rest.bones[i].name] = Q_ID;
  }
  return { version: POSING_VERSION, bones };
}

/** 尾巴是会晃的弹簧骨骼：每条一串，从尾根晃到尾尖 */
export function tailSprings(skeleton: Skeleton): VrmSpring[] {
  const roots = skeleton.bones.flatMap((b, i) => (/^Tail_\d+_01$/.test(b.name) ? [i] : []));
  return roots.length ? [{ comment: 'Tail', roots, stiffness: 1, gravity: 0.05, drag: 0.4, hitRadius: 0.03 }] : [];
}
