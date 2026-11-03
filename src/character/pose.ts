/**
 * 给带蒙皮的网格摆姿势，并把摆好的样子「烘焙」成新的静止姿势：
 * 顶点按各骨骼的权重跟着动（线性混合蒙皮），关节挪到摆好以后的位置。
 * 烘焙以后骨骼又都不带旋转了，权重原样保留，所以导出的模型看到的样子就是它的静止姿势，
 * 进了 Blender 还能接着摆。
 *
 * 约定：骨骼在静止姿势下不带旋转，只有关节的位置（VRM 0.x 就是这样）。纯函数。
 */
import { type Quat, type V3, quatMat3 } from '../geometry/vec';

/** 一根骨骼怎么动，都是相对父骨骼说的 */
export interface BonePose {
  /** 绕自己的关节转 */
  rotation?: Quat;
  /** 关节自己挪多少（父骨骼的坐标里） */
  move?: V3;
  /** 等比放大、缩小，子骨骼跟着一起 */
  scale?: number;
}

export interface Rig {
  /** 每根骨骼的父骨骼下标，根是 -1 */
  parent: ArrayLike<number>;
  /** 每根骨骼的关节在静止姿势里的位置 */
  rest: V3[];
}

/**
 * 每根骨骼的蒙皮矩阵：把静止姿势里的点搬到摆好以后的位置。
 * 一根骨骼 12 个数：前 9 个是 3×3 的旋转缩放（按行），后 3 个是平移。
 */
export function skinMatrices(rig: Rig, pose: ReadonlyMap<number, BonePose>): Float64Array {
  const n = rig.rest.length;
  const out = new Float64Array(n * 12);
  // 先算每根骨骼自己的坐标 → 世界的变换（关节在自己坐标的原点），再换成蒙皮矩阵
  const done = new Uint8Array(n);
  const world = (j: number) => {
    if (done[j]) return;
    done[j] = 1;
    const p = rig.parent[j];
    const move = pose.get(j);
    const s = move?.scale ?? 1;
    const r = move?.rotation ? quatMat3(move.rotation) : null;
    const local = r ? r.map((v) => v * s) : [s, 0, 0, 0, s, 0, 0, 0, s];
    const rest = rig.rest[j];
    const from: V3 = p >= 0 ? rig.rest[p] : [0, 0, 0];
    const offset: V3 = [
      rest[0] - from[0] + (move?.move?.[0] ?? 0),
      rest[1] - from[1] + (move?.move?.[1] ?? 0),
      rest[2] - from[2] + (move?.move?.[2] ?? 0),
    ];
    const o = j * 12;
    if (p < 0) {
      out.set(local, o);
      out.set(offset, o + 9);
      return;
    }
    world(p);
    const q = p * 12;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        out[o + row * 3 + col] = out[q + row * 3] * local[col] + out[q + row * 3 + 1] * local[3 + col] + out[q + row * 3 + 2] * local[6 + col];
      }
      out[o + 9 + row] = out[q + row * 3] * offset[0] + out[q + row * 3 + 1] * offset[1] + out[q + row * 3 + 2] * offset[2] + out[q + 9 + row];
    }
  };
  for (let j = 0; j < n; j++) world(j);
  // 蒙皮矩阵 = 世界变换 ∘（减去静止姿势里关节的位置）
  for (let j = 0; j < n; j++) {
    const o = j * 12;
    const rest = rig.rest[j];
    for (let row = 0; row < 3; row++) {
      out[o + 9 + row] -= out[o + row * 3] * rest[0] + out[o + row * 3 + 1] * rest[1] + out[o + row * 3 + 2] * rest[2];
    }
  }
  return out;
}

/** 摆好以后各关节的位置 */
export function posedJoints(rig: Rig, matrices: Float64Array): V3[] {
  return rig.rest.map((rest, j) => {
    const o = j * 12;
    return [
      matrices[o] * rest[0] + matrices[o + 1] * rest[1] + matrices[o + 2] * rest[2] + matrices[o + 9],
      matrices[o + 3] * rest[0] + matrices[o + 4] * rest[1] + matrices[o + 5] * rest[2] + matrices[o + 10],
      matrices[o + 6] * rest[0] + matrices[o + 7] * rest[1] + matrices[o + 8] * rest[2] + matrices[o + 11],
    ];
  });
}

/**
 * 只重算一部分顶点（摆姿势拖动中，见 view/posedMeshes.ts）。算出来的和全部重算的逐值一样：
 * 每个顶点只看它自己那 4 根骨骼的矩阵，那几根都没变，结果就和上一次一样。
 */
export interface SkinOnly {
  /** 从这份静止的顶点、法线算起，写进 positions、normals（不给就从 positions、normals 自己算起） */
  from?: { positions: Float32Array; normals: Float32Array };
  /** 哪几根骨骼的矩阵变了（1 是变了）。给了的话，4 根骨骼一根都没变的顶点跳过：positions、normals 里原来是什么还是什么 */
  moved?: Uint8Array;
  /** 这些顶点不管骨骼变没变都重算（静止的样子改过了：成品角色换了表情） */
  fresh?: Uint8Array;
  /** 重算过的顶点搬到了哪，顺便框进来（最小 x y z、最大 x y z） */
  box?: Float64Array;
}

/** 第 v 个顶点要不要重算 */
function needed(only: SkinOnly, joints: ArrayLike<number>, weights: ArrayLike<number>, v: number): boolean {
  const moved = only.moved;
  if (!moved || only.fresh?.[v]) return true;
  for (let k = 0; k < 4; k++) if (weights[v * 4 + k] && moved[joints[v * 4 + k]]) return true;
  return false;
}

function grow(box: Float64Array | undefined, x: number, y: number, z: number) {
  if (!box) return;
  if (x < box[0]) box[0] = x;
  if (y < box[1]) box[1] = y;
  if (z < box[2]) box[2] = z;
  if (x > box[3]) box[3] = x;
  if (y > box[4]) box[4] = y;
  if (z > box[5]) box[5] = z;
}

/** 把顶点和法线按蒙皮矩阵搬过去（直接改传进来的数组） */
export function skinVerticesInPlace(
  positions: Float32Array,
  normals: Float32Array,
  joints: ArrayLike<number>,
  weights: ArrayLike<number>,
  matrices: Float64Array,
  only: SkinOnly = {},
) {
  const count = positions.length / 3;
  const src = only.from?.positions ?? positions;
  const srcN = only.from?.normals ?? normals;
  for (let v = 0; v < count; v++) {
    if (!needed(only, joints, weights, v)) continue;
    const px = src[v * 3];
    const py = src[v * 3 + 1];
    const pz = src[v * 3 + 2];
    const nx = srcN[v * 3];
    const ny = srcN[v * 3 + 1];
    const nz = srcN[v * 3 + 2];
    let x = 0;
    let y = 0;
    let z = 0;
    let a = 0;
    let b = 0;
    let c = 0;
    for (let k = 0; k < 4; k++) {
      const w = weights[v * 4 + k];
      if (!w) continue;
      const o = joints[v * 4 + k] * 12;
      x += w * (matrices[o] * px + matrices[o + 1] * py + matrices[o + 2] * pz + matrices[o + 9]);
      y += w * (matrices[o + 3] * px + matrices[o + 4] * py + matrices[o + 5] * pz + matrices[o + 10]);
      z += w * (matrices[o + 6] * px + matrices[o + 7] * py + matrices[o + 8] * pz + matrices[o + 11]);
      a += w * (matrices[o] * nx + matrices[o + 1] * ny + matrices[o + 2] * nz);
      b += w * (matrices[o + 3] * nx + matrices[o + 4] * ny + matrices[o + 5] * nz);
      c += w * (matrices[o + 6] * nx + matrices[o + 7] * ny + matrices[o + 8] * nz);
    }
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;
    grow(only.box, x, y, z);
    // 逐个顶点的地方不用 Math.hypot：它比开平方慢好几倍（这里不会溢出，用不着它那份小心）
    const l = Math.sqrt(a * a + b * b + c * c) || 1;
    normals[v * 3] = a / l;
    normals[v * 3 + 1] = b / l;
    normals[v * 3 + 2] = c / l;
  }
}

/** 几根骨骼的动作怎么混在一起：linear 混合搬完以后的位置（线性混合蒙皮），dual 混合「转多少、挪多少」（对偶四元数） */
export type SkinBlend = 'linear' | 'dual';

/**
 * 成品角色摆姿势（屏幕上、导出摆好的样子）时怎么混：也是对偶四元数。她的权重是照线性混合画的，
 * 现成姿势那种弯法两种看起来差不多；但关节弯得厉害时线性混合会把皮肉往里压，膝盖弯到 150° 被挤成一个尖
 * （docs/character-dual-quat.png）。拼她的时候那一步（头、胸要缩放）还是线性混合
 */
export const CHARACTER_BLEND: SkinBlend = 'dual';

/**
 * 同样是把顶点和法线搬过去，但几根骨骼之间混合的是动作本身（对偶四元数蒙皮），不是搬完以后的位置。
 *
 * 线性混合在骨骼转得多的时候会瘪：手臂举过头顶要转一百多度，肩头那一圈一半跟着躯干、一半跟着手臂的点
 * 被拉到两个位置的正中间，整圈缩成薄薄的一片。混合动作就没有这个毛病：那些点只是绕着关节转了一个居中的角度，
 * 粗细不变。
 *
 * 白模的权重是自动算的，关节又常常要转很大的角度，用这个；成品角色摆姿势时也用这个（见 CHARACTER_BLEND）。
 * 矩阵得是纯旋转加平移（不带缩放）。
 */
export function skinVerticesDualInPlace(
  positions: Float32Array,
  normals: Float32Array,
  joints: ArrayLike<number>,
  weights: ArrayLike<number>,
  matrices: Float64Array,
  only: SkinOnly = {},
) {
  // 每根骨骼的动作写成对偶四元数：前 4 个数是旋转（x y z w），后 4 个是 ½·平移·旋转
  const bones = matrices.length / 12;
  const dual = new Float64Array(bones * 8);
  for (let j = 0; j < bones; j++) {
    const o = j * 12;
    const m00 = matrices[o];
    const m11 = matrices[o + 4];
    const m22 = matrices[o + 8];
    let x: number;
    let y: number;
    let z: number;
    let w: number;
    const trace = m00 + m11 + m22;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      w = 0.25 / s;
      x = (matrices[o + 7] - matrices[o + 5]) * s;
      y = (matrices[o + 2] - matrices[o + 6]) * s;
      z = (matrices[o + 3] - matrices[o + 1]) * s;
    } else if (m00 > m11 && m00 > m22) {
      const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
      w = (matrices[o + 7] - matrices[o + 5]) / s;
      x = 0.25 * s;
      y = (matrices[o + 1] + matrices[o + 3]) / s;
      z = (matrices[o + 2] + matrices[o + 6]) / s;
    } else if (m11 > m22) {
      const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
      w = (matrices[o + 2] - matrices[o + 6]) / s;
      x = (matrices[o + 1] + matrices[o + 3]) / s;
      y = 0.25 * s;
      z = (matrices[o + 5] + matrices[o + 7]) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
      w = (matrices[o + 3] - matrices[o + 1]) / s;
      x = (matrices[o + 2] + matrices[o + 6]) / s;
      y = (matrices[o + 5] + matrices[o + 7]) / s;
      z = 0.25 * s;
    }
    const l = Math.hypot(x, y, z, w) || 1;
    x /= l;
    y /= l;
    z /= l;
    w /= l;
    const tx = matrices[o + 9];
    const ty = matrices[o + 10];
    const tz = matrices[o + 11];
    const d = j * 8;
    dual[d] = x;
    dual[d + 1] = y;
    dual[d + 2] = z;
    dual[d + 3] = w;
    dual[d + 4] = 0.5 * (tx * w + ty * z - tz * y);
    dual[d + 5] = 0.5 * (ty * w + tz * x - tx * z);
    dual[d + 6] = 0.5 * (tz * w + tx * y - ty * x);
    dual[d + 7] = -0.5 * (tx * x + ty * y + tz * z);
  }
  const count = positions.length / 3;
  const src = only.from?.positions ?? positions;
  const srcN = only.from?.normals ?? normals;
  for (let v = 0; v < count; v++) {
    if (!needed(only, joints, weights, v)) continue;
    let rx = 0;
    let ry = 0;
    let rz = 0;
    let rw = 0;
    let ex = 0;
    let ey = 0;
    let ez = 0;
    let ew = 0;
    let first = -1;
    for (let k = 0; k < 4; k++) {
      let w = weights[v * 4 + k];
      if (!w) continue;
      const d = joints[v * 4 + k] * 8;
      // 同一个旋转有正负两种写法：都换成和第一根骨骼同一边的，混出来才是走近路
      if (first < 0) first = d;
      else if (dual[d] * dual[first] + dual[d + 1] * dual[first + 1] + dual[d + 2] * dual[first + 2] + dual[d + 3] * dual[first + 3] < 0) w = -w;
      rx += w * dual[d];
      ry += w * dual[d + 1];
      rz += w * dual[d + 2];
      rw += w * dual[d + 3];
      ex += w * dual[d + 4];
      ey += w * dual[d + 5];
      ez += w * dual[d + 6];
      ew += w * dual[d + 7];
    }
    if (first < 0) {
      // 不跟任何骨骼的顶点留在静止的地方
      if (src !== positions) {
        for (let i = v * 3; i < v * 3 + 3; i++) {
          positions[i] = src[i];
          normals[i] = srcN[i];
        }
      }
      grow(only.box, positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      continue;
    }
    // 逐个顶点的地方不用 Math.hypot：它比开平方慢好几倍（这里不会溢出，用不着它那份小心）
    const scale = 1 / (Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw) || 1);
    rx *= scale;
    ry *= scale;
    rz *= scale;
    rw *= scale;
    ex *= scale;
    ey *= scale;
    ez *= scale;
    ew *= scale;
    // 平移 = 2 · 对偶部分 · 旋转的共轭
    const tx = 2 * (rw * ex - ew * rx + ry * ez - rz * ey);
    const ty = 2 * (rw * ey - ew * ry + rz * ex - rx * ez);
    const tz = 2 * (rw * ez - ew * rz + rx * ey - ry * ex);
    const px = src[v * 3];
    const py = src[v * 3 + 1];
    const pz = src[v * 3 + 2];
    // 转一个点：p + 2 · r × (r × p + w · p)
    let cx = ry * pz - rz * py + rw * px;
    let cy = rz * px - rx * pz + rw * py;
    let cz = rx * py - ry * px + rw * pz;
    positions[v * 3] = px + 2 * (ry * cz - rz * cy) + tx;
    positions[v * 3 + 1] = py + 2 * (rz * cx - rx * cz) + ty;
    positions[v * 3 + 2] = pz + 2 * (rx * cy - ry * cx) + tz;
    grow(only.box, positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    const nx = srcN[v * 3];
    const ny = srcN[v * 3 + 1];
    const nz = srcN[v * 3 + 2];
    cx = ry * nz - rz * ny + rw * nx;
    cy = rz * nx - rx * nz + rw * ny;
    cz = rx * ny - ry * nx + rw * nz;
    const a = nx + 2 * (ry * cz - rz * cy);
    const b = ny + 2 * (rz * cx - rx * cz);
    const c = nz + 2 * (rx * cy - ry * cx);
    const l = Math.sqrt(a * a + b * b + c * c) || 1;
    normals[v * 3] = a / l;
    normals[v * 3 + 1] = b / l;
    normals[v * 3 + 2] = c / l;
  }
}

/** 照 blend 说的办法把顶点和法线搬过去 */
export function skinInPlace(
  blend: SkinBlend,
  positions: Float32Array,
  normals: Float32Array,
  joints: ArrayLike<number>,
  weights: ArrayLike<number>,
  matrices: Float64Array,
  only?: SkinOnly,
) {
  if (blend === 'dual') skinVerticesDualInPlace(positions, normals, joints, weights, matrices, only);
  else skinVerticesInPlace(positions, normals, joints, weights, matrices, only);
}
