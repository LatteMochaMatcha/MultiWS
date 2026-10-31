/**
 * 后台线程接的一个融合任务（照摆好的姿势融合、带权重、只要网格三种），分成前后两半（见 fuse.ts 的 Staged）。
 * 网格 Worker 照这个融合；要帮着求值的线程也照这个把场编译出来——同样的任务编译出来的场一模一样，
 * 在它上面求出来的值也就一模一样，交回去照抄，融合出来的网格和一个线程从头算的逐个顶点相同。
 *
 * 纯函数，在 Web Worker 和单元测试里都能跑。
 */
import type { Part } from '../geometry/figure';
import type { SkinWeights } from '../rig/skin';
import { stageSkinned } from './bindPose';
import { type Staged, stageParts } from './fuse';
import { stagePosed } from './posedFuse';
import type { FusedMesh } from './surfaceNets';

export interface FuseJob {
  parts: Part[];
  voxel: number;
  blend: number;
  /** 顺便算出每个顶点的蒙皮权重（摆姿势、导出带骨骼的模型时用） */
  skin?: boolean;
  /** 摆好的姿势（每根骨骼的蒙皮矩阵）：融合出摆好以后的样子。这时不算权重 */
  pose?: Float64Array;
}

export interface FuseResult {
  mesh: FusedMesh;
  /** 只有任务里要了 skin 才有 */
  skin?: SkinWeights;
}

export function stageJob(job: FuseJob): Staged<FuseResult> {
  const { parts, voxel, blend, pose } = job;
  // 要权重的（摆姿势、导出带骨骼的）：网格、骨架、权重都按 Figure.scale = 1 来算，权重和整体缩放无关。
  // 聚在一个肩膀上的几条手臂这时是先张开再融合的（见 bindPose.ts）
  if (!pose && job.skin) return stageSkinned(parts, { voxel, blend });
  const fused = pose ? stagePosed(parts, { voxel, blend, pose }) : stageParts(parts, { voxel, blend });
  return { field: fused.field, voxel, finish: (memo) => ({ mesh: fused.finish(memo) }) };
}

export function runJob(job: FuseJob): FuseResult {
  return stageJob(job).finish();
}
