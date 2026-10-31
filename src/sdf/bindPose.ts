/**
 * 摆姿势用的网格：融合时的姿势和静止姿势分开。
 *
 * 聚在一个肩膀上的几条手臂静止时挨得很近。照静止的样子直接融合，它们从肩膀到上臂中段是长在一起的同一张皮，
 * 把其中一条举起来，它和旁边几条之间就扯出一片蹼——权重怎么分都没用，因为网格本身就是连着的。
 *
 * 所以要权重的时候（摆姿势、导出带骨骼的模型）换一个做法：
 * 1. 先把这几条手臂张开（Part.bind），照张开的样子融合、算权重：这时它们只在肩头那一小段连着；
 * 2. 再照刚算出来的权重把手臂转回静止的位置（和摆姿势时一样，混合的是骨骼的动作，见 character/pose.ts）。
 * 得到的还是一整块封闭的网格，静止时的样子和原来差不多（几条上臂是叠在一起的，不是长在一起的），
 * 往后摆姿势、导出都把它当成静止的网格来用，别处不用知道有过这回事。
 *
 * 纯函数，在 Web Worker 和单元测试里都能跑。
 */
import { skinVerticesDualInPlace } from '../character/pose';
import { type Part, shapeInverse, shapeMatrix, worldTransforms } from '../geometry/figure';
import { type V3, mat3Apply, quatConj, quatMat3, quatMul, rotate } from '../geometry/vec';
import { type Skeleton, buildSkeleton } from '../rig/skeleton';
import { type SkinWeights, bindGrafts, skinVertices } from '../rig/skin';
import { type FuseOptions, type Staged, stageParts } from './fuse';
import type { BlockMemo, FusedMesh } from './surfaceNets';

/** 这副身体融合时的姿势和静止姿势是不是不一样 */
export const hasBindPose = (parts: readonly Part[]): boolean => parts.some((part) => part.bind);

/**
 * 把部件摆成融合时的姿势：带 bind 的部件绕自己的原点多转那么多。
 * 部件里最靠根的那节骨骼（锁骨：它的父骨骼在别的部件里，自己躺在躯干里）留在原地不跟着转。
 */
export function bindParts(parts: readonly Part[]): Part[] {
  return parts.map((part) => {
    if (!part.bind) return part;
    const { bind, ...rest } = part;
    const quat = quatMul(bind, part.quat);
    const own = new Set(part.bones?.map((bone) => bone.name));
    const shape = shapeMatrix(part);
    const unshape = shapeInverse(part);
    // 骨骼写在部件自己的坐标里：部件多转了，要留在原地的骨骼就反着转回去
    const stay = (p: V3): V3 => {
      const local = rotate(quatConj(quat), rotate(part.quat, shape ? mat3Apply(shape, p) : p));
      return unshape ? mat3Apply(unshape, local) : local;
    };
    const bones = part.bones?.map((bone) => (bone.parent && own.has(bone.parent) ? bone : { ...bone, head: stay(bone.head), tail: stay(bone.tail) }));
    return { ...rest, quat, ...(bones ? { bones } : {}) };
  });
}

/**
 * 每根骨骼从融合时的姿势回到静止姿势要怎么搬（每根 12 个数：3×3 的旋转按行排，后面是平移；和蒙皮矩阵一个写法）。
 * skeleton 是照融合时的姿势建的骨架；骨骼的顺序和静止姿势的骨架一样。
 */
export function unbindMatrices(parts: readonly Part[], bound: readonly Part[], skeleton: Skeleton): Float64Array {
  const count = skeleton.bones.length;
  const matrices = new Float64Array(count * 12);
  for (let i = 0; i < count; i++) matrices[i * 12] = matrices[i * 12 + 4] = matrices[i * 12 + 8] = 1;
  const to = worldTransforms({ parts: [...parts], scale: 1 });
  const from = worldTransforms({ parts: [...bound], scale: 1 });
  const turned = new Map<string, number[]>();
  for (const part of parts) {
    if (!part.bind) continue;
    const a = from.get(part.name)!;
    const b = to.get(part.name)!;
    const r = quatMat3(quatMul(b.quat, quatConj(a.quat)));
    const moved = mat3Apply(r, a.pos);
    turned.set(part.name, [...r, b.pos[0] - moved[0], b.pos[1] - moved[1], b.pos[2] - moved[2]]);
  }
  skeleton.bones.forEach((bone, i) => {
    const matrix = turned.get(bone.part);
    const up = skeleton.bones[bone.parent];
    // 没转过的部件、转过的部件里留在原地的那节骨骼：不用搬
    if (!matrix || !up || up.part !== bone.part) return;
    matrices.set(matrix, i * 12);
  });
  return matrices;
}

/**
 * 融合成一整块网格，连同蒙皮权重（骨骼的顺序和 buildSkeleton 给静止姿势排的一样）。
 * 网格是静止姿势的；有部件带着 bind 时，它是照张开的样子融合、再照权重转回来的。
 */
export function fuseSkinned(parts: Part[], options: FuseOptions): { mesh: FusedMesh; skin: SkinWeights } {
  return stageSkinned(parts, options).finish();
}

/** fuseSkinned 分成前后两半（见 Staged） */
export function stageSkinned(parts: Part[], options: FuseOptions): Staged<{ mesh: FusedMesh; skin: SkinWeights }> {
  const steps = skinnedSteps(parts, options);
  const finish = (memo?: BlockMemo) => {
    const mesh = steps.fused.finish(memo);
    return steps.settle(mesh, skinVertices(steps.figure, steps.skeleton, mesh.positions, mesh.triangles));
  };
  return { field: steps.fused.field, voxel: steps.fused.voxel, finish };
}

/** 带权重融合时用的那副身体：聚在一个肩膀上的几条手臂先张开（见 bindParts）。权重照它算 */
export function skinnedFigure(parts: Part[]): { parts: Part[]; scale: number } {
  return { parts: hasBindPose(parts) ? bindParts(parts) : parts, scale: 1 };
}

/**
 * fuseSkinned 再拆细一点：先融合（fused），再照 figure、skeleton 算权重（skinVertices，可以拆开分给别的线程算，见 parallel.ts），
 * 最后把算好的权重交给 settle：缝上去的手换成自带的权重，张开的手臂转回静止的位置
 */
export function skinnedSteps(parts: Part[], options: FuseOptions) {
  const figure = skinnedFigure(parts);
  const bound = figure.parts;
  const fused = stageParts(bound, { voxel: options.voxel, blend: options.blend });
  const skeleton = buildSkeleton(figure);
  const settle = (mesh: FusedMesh, weights: SkinWeights) => {
    const skin = bindGrafts(weights, mesh, skeleton);
    // 转回去用的是对偶四元数：手臂要转几十上百度，线性混合会把肩头压瘪
    if (bound !== parts) skinVerticesDualInPlace(mesh.positions, mesh.normals, skin.joints, skin.weights, unbindMatrices(parts, bound, skeleton));
    return { mesh, skin };
  };
  return { fused, figure, skeleton, settle };
}
