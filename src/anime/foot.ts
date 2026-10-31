/**
 * 现成的脚：Kotori（Fox Jump，CC BY）的左脚，连着五个脚趾，由 tools/build-foot.ts 取下来、摆到素体的脚踝上。
 * 二次元素体的人腿用它：素体本来的脚是给穿鞋做的（像一只鞋楦），脚趾又比融合的格子还细，
 * 所以和手一样不过距离场，融合完以后在脚踝上面一点缝到腿上（见 sdf/graft.ts）。右脚是左脚翻过来。
 */
import type { V3 } from '../geometry/vec';
import { type GraftMesh, decodeGraftMesh } from './graftMesh';
import meta from './footMesh.json';

/** 用了这只脚的模型发出去时要带的署名（CC BY）：导出的 GLB 里写进 asset.copyright，状态栏上也提一句 */
export const FOOT_CREDIT = '脚部网格 © Fox Jump（Kotori），CC BY';

let cached: GraftMesh | null = null;

/** 脚的网格（写在素体模型自己的坐标里）。切口那一头的关节（end）是脚踝，往里一节（root）是膝盖 */
export function footMesh(): GraftMesh {
  cached ??= decodeGraftMesh(meta, meta.ankle as V3, meta.knee as V3);
  return cached;
}

/** 脚踝、脚趾根、脚趾尖的关节在素体模型里的位置（左脚）：腿的骨骼照这只脚的来，脚趾才弯在脚趾根上 */
export const FOOT_ANKLE = meta.ankle as V3;
export const FOOT_TOE = meta.toe as V3;
export const FOOT_TOE_END = meta.toeEnd as V3;
/** 脚底（脚的网格最低的那一点）在素体模型里有多高 */
export const FOOT_SOLE = meta.bounds.min[1];
/** 脚的网格从脚踝的关节往上伸了多高（切口在那里） */
export const FOOT_CUFF = meta.bounds.max[1] - meta.ankle[1];
/**
 * 融合时腿的距离场要比脚踝多留这么长的一截（往下伸进脚里）：缝的时候是在脚的切口上面一点横着切开身体的，
 * 切面离断口够远，那里的表面才不受断口的影响
 */
export const FOOT_STUMP = 0.03;

/**
 * 接到一条腿上时，除了怎么摆以外的那几项（见 Graft）：骨骼的对应、跟着腿挪的那一点、哪些骨骼跟着脚。
 * name 把「Foot」换成这条腿上的全名（Foot_L.002 这样的）。小腿（LowerLeg）是腿自己的骨骼，不算脚的
 */
export const footGraft = (name: (base: string) => string) => ({
  mesh: 'foot' as const,
  bones: Object.fromEntries(meta.bones.map((bone) => [bone, name(bone)])),
  // 腿被拉伸（加粗、单足时的粗一圈）时脚跟着它变大变小：以脚踝正下方的脚底为中心，脚底还踩在地上
  pivot: [meta.ankle[0], meta.bounds.min[1], meta.ankle[2]] as V3,
  reach: [meta.ankle[0] - meta.knee[0], meta.ankle[1] - meta.knee[1], meta.ankle[2] - meta.knee[2]] as V3,
  rigid: meta.bones.filter((bone) => bone !== 'LowerLeg').map(name),
});
