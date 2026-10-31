/**
 * 现成的手：VRoid Studio 旧版女性基础模型（pixiv 以 CC0 发布）的左手，由 tools/build-hand.ts 取下来。
 * 白模人台（分指）和二次元素体的手用的都是它：不过距离场，融合完以后直接在手腕处缝到身体上（见 sdf/graft.ts），
 * 手指才是一根一根分开的、带着模型自己的蒙皮权重。右手是左手翻过来。
 *
 * 数据直接打在代码里（不到一百 KB），主线程、Worker、单元测试里都能直接用。
 */
import type { V3 } from '../geometry/vec';
import { animeJoint } from './body';
import { type GraftMesh, decodeGraftMesh } from './graftMesh';
import meta from './handMesh.json';

/** 现成的手（写在模型自己的坐标里：面朝 +Z，左手边是 +X，手臂平举，手指朝 +X，手心朝下，拇指朝前）。
 * 切口那一头的关节（end）是手腕，往里一节（root）是手肘；骨骼名不带左右：LowerArm、Hand、Thumb1 … Little3 */
export type HandMesh = GraftMesh;

let cached: HandMesh | null = null;

export function handMesh(): HandMesh {
  cached ??= decodeGraftMesh(meta, meta.wrist as V3, meta.elbow as V3);
  return cached;
}

/** 手有多长：从手腕的关节到最远的指尖（沿手臂的方向量） */
export const HAND_LENGTH = meta.bounds.max[0] - meta.wrist[0];
/** 手的网格从手腕的关节往手肘这边伸了多长（切口最靠里的地方） */
export const HAND_CUFF = meta.wrist[0] - meta.bounds.min[0];
/**
 * 融合时手臂的距离场要比手腕多留这么长的一截：缝的时候是在手的切口里面一点横着切开身体的，
 * 切面离断口够远，那里的表面才不受断口的影响
 */
export const HAND_STUMP = 0.03;
/** 手腕、手肘的关节在模型里的位置（手的网格就写在模型自己的坐标里） */
export const HAND_WRIST = meta.wrist as V3;
export const HAND_ELBOW = meta.elbow as V3;

/** 五根手指各自的四个关节（指根、两个指节、指尖）在模型里的位置（左手） */
export const FINGER_JOINTS = (['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const).map((finger) => ({
  finger,
  joints: [`L_${finger}1`, `L_${finger}2`, `L_${finger}3`, `L_${finger}3_end`].map(animeJoint),
}));

/** 网格里的骨骼名 → 这条手臂上的全名（name 把「Hand」换成 Hand_L.002 这样的） */
export const handBones = (name: (base: string) => string): Record<string, string> =>
  Object.fromEntries(meta.bones.map((bone) => [bone, name(bone)]));

/**
 * 接到一条手臂上时，除了怎么摆以外的那几项（见 Graft）：骨骼的对应、手腕在哪、哪些骨骼跟着手。
 * 前臂（LowerArm）是手臂自己的骨骼，手的网格只是有一圈袖口跟着它，它不算手的
 */
export const handGraft = (name: (base: string) => string) => ({
  mesh: 'hand' as const,
  bones: handBones(name),
  pivot: meta.wrist as V3,
  reach: [meta.wrist[0] - meta.elbow[0], meta.wrist[1] - meta.elbow[1], meta.wrist[2] - meta.elbow[2]] as V3,
  rigid: meta.bones.filter((bone) => bone !== 'LowerArm').map(name),
});
