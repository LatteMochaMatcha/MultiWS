/**
 * 把别的骨架上的一个姿势换成工坊的姿势数据（posing.ts 现在的记法）。纯函数。
 * 现成的姿势就是这样从动作素材里取出来的（tools/build-poses.ts）：素材的骨架和工坊的不一样长、
 * 静止姿势也不一样（它是 A-pose），但只要每根骨骼对得上名字，照「世界里转了多少」记下来，换到谁身上都是同一个姿势。
 */
import type { Quat, V3 } from '../geometry/vec';
import { quatMul } from '../geometry/vec';
import { type Posing, POSING_VERSION, roundQuat, tidyRoot } from './posing';
import type { RigBone } from './rig';
import { makeSolver } from './solver';

/** 来源骨架上的一根骨骼。位置的单位随它，Y 朝上、角色面朝 +Z、左手边是 +X */
export interface SourceBone {
  /** 对应工坊的哪根骨骼（Hips、UpperArm_L …） */
  name: string;
  /** 父骨骼在这个数组里的下标，根是 -1。父骨骼排在子骨骼前面 */
  parent: number;
  /** 静止姿势里关节的位置、摆好以后关节的位置 */
  rest: V3;
  posed: V3;
  /** 从静止姿势到摆好的姿势，这根骨骼在世界里转了多少 */
  turn: Quat;
  /** 静止姿势里这根骨骼的终点。不写的话：有子骨骼就是第一根子骨骼的关节，没有就顺着父骨骼的方向再伸一点 */
  tail?: V3;
}

export function posingFromBones(bones: readonly SourceBone[]): Posing {
  // 照来源骨架静止时的样子搭一副骨架：手臂从哪算起（见 solver.ts）要看它静止时手臂朝哪
  const rig: RigBone[] = bones.map((bone, i) => {
    const kids = bones.filter((b) => b.parent === i);
    // 骨头的终点：有子骨骼就是第一根子骨骼的关节（脊柱往上接着的那一根排在前面）；没有就顺着父骨骼的方向再伸一点
    const from = bone.parent >= 0 ? bones[bone.parent].rest : bone.rest;
    const tail: V3 =
      bone.tail ??
      (kids.length
        ? kids[0].rest
        : [bone.rest[0] + (bone.rest[0] - from[0]) * 0.5, bone.rest[1] + (bone.rest[1] - from[1]) * 0.5, bone.rest[2] + (bone.rest[2] - from[2]) * 0.5]);
    return { name: bone.name, parent: bone.parent, head: bone.rest, tail };
  });
  const solver = makeSolver(rig);
  const out: Posing = { version: POSING_VERSION, bones: {} };
  bones.forEach((bone, j) => {
    out.bones[bone.name] = roundQuat(quatMul(bone.turn, solver.frames[j]));
  });
  // 整个人只记高低（蹲了多少、跳了多高），不记前后左右：套上去以后人还站在原地
  const hips = bones[solver.rig.hips];
  const height = hips.rest[1];
  const root = height > 1e-6 ? tidyRoot([0, (hips.posed[1] - hips.rest[1]) / height, 0]) : undefined;
  if (root) out.root = root;
  return out;
}
