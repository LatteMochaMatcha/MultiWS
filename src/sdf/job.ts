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
import { type VertexLabels, labelVertices } from './labels';
import { type BindMesh, provideBind, stagePosed } from './posedFuse';
import type { FusedMesh } from './surfaceNets';

export interface FuseJob {
  parts: Part[];
  voxel: number;
  blend: number;
  /** 顺便算出每个顶点的蒙皮权重（摆姿势、导出带骨骼的模型时用） */
  skin?: boolean;
  /** 摆好的姿势（每根骨骼的蒙皮矩阵）：融合出摆好以后的样子。这时不算权重 */
  pose?: Float64Array;
  /** 顺便标出每个顶点属于哪个部件（造型里拖着部件时，新网格出来之前先把这张整块挪过去，见 labels.ts）。只在不摆姿势、不要权重时有 */
  labels?: boolean;
  /**
   * 摆姿势时：这副身体静止姿势、预览精度、带权重的那张网格（parts、blend 和这个任务一样，就是 { parts, voxel: 预览, skin: true } 那个任务算出来的）。
   * 二次元素体照姿势融合时要用它把腿搬过去（见 posedFuse.ts 的 bindOf）：给了就不用在这个线程里再算一遍
   */
  bind?: BindMesh;
}

export interface FuseResult {
  mesh: FusedMesh;
  /** 只有任务里要了 skin 才有 */
  skin?: SkinWeights;
  /** 只有任务里要了 labels 才有 */
  labels?: VertexLabels;
}

export function stageJob(job: FuseJob): Staged<FuseResult> {
  const { parts, voxel, blend, pose } = job;
  // 要权重的（摆姿势、导出带骨骼的）：网格、骨架、权重都按 Figure.scale = 1 来算，权重和整体缩放无关。
  // 聚在一个肩膀上的几条手臂这时是先张开再融合的（见 bindPose.ts）
  if (!pose && job.skin) return stageSkinned(parts, { voxel, blend });
  if (pose && job.bind) provideBind(parts, blend, job.bind);
  const fused = pose ? stagePosed(parts, { voxel, blend, pose }) : stageParts(parts, { voxel, blend });
  const labels = job.labels && !pose;
  const done = (mesh: FusedMesh): FuseResult => (labels ? { mesh, labels: labelVertices(parts, mesh, voxel) } : { mesh });
  const refine = fused.refine;
  return {
    field: fused.field,
    voxel,
    finish: (memo) => done(fused.finish(memo)),
    ...(refine && { refine: { rough: refine.rough, polish: (mesh: FusedMesh, moved: Float32Array) => done(refine.polish(mesh, moved)) } }),
  };
}

export function runJob(job: FuseJob): FuseResult {
  return stageJob(job).finish();
}
