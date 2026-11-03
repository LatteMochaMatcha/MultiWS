/**
 * 融合网格的入口：部件 → 距离场 → 一整块封闭网格。
 * 网格的坐标是部件自己的单位（Figure.scale 当作 1）；显示和导出时再乘上 Figure.scale。
 * 这样拖「身高」只改一个缩放，不用重新融合。
 */
import type { Figure, Part } from '../geometry/figure';
import { buildSkeleton } from '../rig/skeleton';
import { type CompiledField, compileField } from './field';
import { graftMeshes, wristRooms } from './graft';
import { type PoseMatrices, compilePosedField } from './posedField';
import { type BlockMemo, type FusedMesh, meshField } from './surfaceNets';
import { refineSurface, settleSurface, surfaceLocks } from './surfaceQuality';

/** 体素大小（按 1.76 m 的人台算）：拖动时用 draft，停下来换 preview，导出用 fine */
export const VOXEL = { draft: 0.02, preview: 0.012, fine: 0.006 } as const;

export interface FuseOptions {
  /** 体素边长 */
  voxel: number;
  /** 融合圆角的半径 */
  blend: number;
  /**
   * 摆好的姿势：每根骨骼的蒙皮矩阵（见 posedField.ts）。给了的话，融合出来的就是摆好以后的样子——
   * 各部件的形状先照骨骼搬过去再融合，不是把静止的网格扯过去
   */
  pose?: PoseMatrices;
  /**
   * 挖手腕周围时不许挖的部件（名字）：二次元素体先跟着胯融合、融完再搬到摆好位置的腿（见 posedFuse.ts）。
   * 那时手腕插在它里面是假的（腿搬走以后就不挨着了），挖了的话，挖掉的坑跟着腿搬过去，露在腿上
   */
  keep?: string[];
}

/**
 * 一次融合分成前后两半：先编译出要网格化的场（field），再收尾（finish：网格化、缝手……）。
 * 中间可以先把 field 的小块拿到别处（别的线程）算好，经 memo 交给 finish 照抄（见 surfaceNets.ts 的 BlockMemo）；
 * 不给就照常现算。finish 只调一次
 */
export interface Staged<T> {
  field: CompiledField;
  voxel: number;
  finish(memo?: BlockMemo): T;
  /**
   * 收尾最后一步是表面校正（静止的二次元素体）时，可以拆开：rough 给出校正之前的网格，
   * 各顶点挪到哪另外算好（surfaceQuality.ts 的 surfaceMoves，可以分给帮手，见 parallel.ts），交给 polish 做完。
   * rough + polish 出来的和 finish 一模一样
   */
  refine?: { rough(memo?: BlockMemo): FusedMesh; polish(mesh: FusedMesh, moved: Float32Array): T };
}

export function stageParts(parts: Part[], options: FuseOptions): Staged<FusedMesh> {
  // 细长的东西（角尖、尾尖、耳尖）至少留一个体素那么粗的半径，不然取出来的网格会一节一节的
  const figure = { parts, scale: 1 };
  const shape = { blend: options.blend, minRadius: options.voxel };
  const { pose, voxel } = options;
  if (!pose) {
    const field = compileField(figure, shape);
    // 手不进距离场：身体出来以后，把现成的手在手腕处缝上去。
    // 有的手没缝上（手臂很短，手腕插进了躯干里）：照「每根骨骼都不动」的姿势走下面那条路，它会把手腕周围挖空再缝
    const finish = (memo?: BlockMemo) => {
      const report = { loose: [] as number[] };
      const mesh = graftMeshes(meshField(field, voxel, memo), parts, voxel, undefined, report);
      if (!report.loose.length) return mesh;
      const still = stageParts(parts, { ...options, pose: restMatrices(figure) }).finish();
      return still.info.components < mesh.info.components ? still : mesh;
    };
    // 静止的二次元素体：缝合完成后校正身体曲面，避免改变缝合圈的选取。
    const refine = voxel <= VOXEL.preview && parts.some((p) => p.prims.some((shape) => shape.kind === 'grid' && shape.grid.startsWith('anime/')));
    if (!refine) return { field, voxel, finish };
    return {
      field,
      voxel,
      finish: (memo) => refineSurface(finish(memo), field),
      refine: { rough: finish, polish: (mesh, moved) => settleSurface(mesh, moved, surfaceLocks(mesh), performance.now()) },
    };
  }
  const field = compilePosedField(figure, shape, pose);
  const finish = (memo: BlockMemo = {}) => {
    const first = { loose: [] as number[] };
    let best = graftMeshes(meshField(field, voxel, memo), parts, voxel, pose, first);
    let loose = first.loose.length;
    if (!loose) return best;
    // 有的手没缝上：手腕插进了大腿、别的手臂里，前臂的断口和它们融成了一片。
    // 把这几只手腕周围空出来（挤进来的东西挖掉一圈）再融合一遍；别的手只护着，不让这一圈把它们的断口也挖了。
    // 先照直挖；还有没缝上的，再挖一遍、挖开的边上圆个圆角（圆了以后有的手腕缝得上，有的反而缝不上），哪遍缝上的多用哪遍
    const rooms = wristRooms(parts, pose, voxel);
    const keep = options.keep ?? [];
    for (const soft of [false, true]) {
      const list = rooms.map((room, i) => ({ ...room, carve: first.loose.includes(i), soft }));
      // 不许挖的部件：要挖的那几处也护着它们
      for (const room of rooms.filter((_, i) => first.loose.includes(i))) for (const part of keep) list.push({ ...room, part, carve: false, soft });
      const carved = compilePosedField(figure, shape, pose, list);
      const report = { loose: [] as number[] };
      // 几遍的场只在挖开的那几处附近不一样：别处的小块照抄第一遍的值
      const mesh = graftMeshes(meshField(carved, voxel, memo), parts, voxel, pose, report);
      if (report.loose.length < loose) {
        best = mesh;
        loose = report.loose.length;
      }
      if (!loose) break;
    }
    return best;
  };
  return { field, voxel, finish };
}

export function fuseParts(parts: Part[], options: FuseOptions): FusedMesh {
  return stageParts(parts, options).finish();
}

/** 每根骨骼都不动的姿势（蒙皮矩阵全是单位矩阵） */
function restMatrices(figure: Pick<Figure, 'parts' | 'scale'>): Float64Array {
  const count = buildSkeleton(figure).bones.length;
  const out = new Float64Array(count * 12);
  for (let i = 0; i < count; i++) out.set([1, 0, 0, 0, 1, 0, 0, 0, 1], i * 12);
  return out;
}
