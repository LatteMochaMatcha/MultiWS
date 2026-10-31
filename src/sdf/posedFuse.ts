/**
 * 照摆好的姿势融合一整块网格（屏幕上松手以后换上的、不带骨骼导出的都是它）。
 *
 * 多数身体直接照姿势融合就行（fuseParts 带上姿势，见 posedField.ts）。
 * 照着现成的模型采样出来的身体（二次元素体）多一步：它的腿不在距离场里摆——腿根是一圈毛边，静止时和躯干的开口
 * 对得严丝合缝才看不出来，在场里怎么弯都会错开。所以先让腿整个跟着胯去融合（腿和躯干像静止时那样合着，
 * 手臂、躯干、头照姿势摆好），再照蒙皮权重把腿搬到摆好的位置。
 * 权重不重新算：下半身这时和「拖着的时候」那张网格（fuseSkinned）静止时是同一片表面，
 * 每个顶点到那张网格上找周围的点，照远近把它们的权重平均一下。搬的办法也一样（对偶四元数），
 * 所以腿和拖着时看到的一模一样。
 *
 * 纯函数，在 Web Worker 和单元测试里都能跑。
 */
import { skinVerticesDualInPlace } from '../character/pose';
import type { Part } from '../geometry/figure';
import { buildSkeleton } from '../rig/skeleton';
import { fuseSkinned } from './bindPose';
import { type FuseOptions, type Staged, VOXEL, stageParts } from './fuse';
import { type PoseMatrices, heldLegs } from './posedField';
import type { FusedMesh } from './surfaceNets';

/**
 * 抄权重时，每个顶点看那张网格上离它这么多个体素（两张网格里粗的那个）以内的点，越近的占得越多；
 * 一个都没有的不抄：它不在下半身原来的表面上。只抄最近的一个点的话，相邻的顶点抄到的不一样，表面上一粒一粒的
 */
const REACH = 2;
/** 抄权重时两边的法线至少要这么一致（点积）：挨着大腿的前臂、手朝着大腿，不能把大腿的权重抄给它 */
const FACING = 0.2;

/** 上一次算的「拖着的时候」那张网格（静止时的位置、法线、权重）：同一副身体换着姿势融合时不用重算 */
let lastBind: { key: string; positions: Float32Array; normals: Float32Array; joints: Uint16Array; weights: Float32Array } | null = null;

function bindOf(parts: Part[], blend: number) {
  const key = `${blend}|${JSON.stringify(parts)}`;
  if (lastBind?.key !== key) {
    const { mesh, skin } = fuseSkinned(parts, { voxel: VOXEL.preview, blend });
    lastBind = { key, positions: mesh.positions, normals: mesh.normals, joints: skin.joints, weights: skin.weights };
  }
  return lastBind;
}

/** 12 个数的矩阵（旋转按行排，后面是平移）a · b⁻¹，写进 out 的第 o 个数起 */
function over(m: PoseMatrices, a: number, b: number, out: Float64Array, o: number) {
  // b⁻¹：旋转转置，平移 −Rᵀ t
  const r = [m[b], m[b + 3], m[b + 6], m[b + 1], m[b + 4], m[b + 7], m[b + 2], m[b + 5], m[b + 8]];
  const t = [-(r[0] * m[b + 9] + r[1] * m[b + 10] + r[2] * m[b + 11]), -(r[3] * m[b + 9] + r[4] * m[b + 10] + r[5] * m[b + 11]), -(r[6] * m[b + 9] + r[7] * m[b + 10] + r[8] * m[b + 11])];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) out[o + i * 3 + j] = m[a + i * 3] * r[j] + m[a + i * 3 + 1] * r[3 + j] + m[a + i * 3 + 2] * r[6 + j];
    out[o + 9 + i] = m[a + i * 3] * t[0] + m[a + i * 3 + 1] * t[1] + m[a + i * 3 + 2] * t[2] + m[a + 9 + i];
  }
}

/**
 * 网格是照「腿整个跟着胯」融合的：照蒙皮权重把腿搬到摆好的位置（就地改顶点和法线）。
 * bones：成对的下标，腿上的骨骼、带着它的骨骼（见 heldLegs）
 */
function skinLegs(mesh: FusedMesh, parts: Part[], options: FuseOptions, pose: PoseMatrices, bones: number[]) {
  const bind = bindOf(parts, options.blend);
  const count = pose.length / 12;
  // 每根骨骼相对「融合时用的姿势」又动了多少：腿上的是 M · M胯⁻¹，别的不动
  const extra = new Float64Array(count * 12);
  for (let b = 0; b < count; b++) extra[b * 12] = extra[b * 12 + 4] = extra[b * 12 + 8] = 1;
  const isLeg = new Uint8Array(count);
  const hosts: number[] = [];
  for (let p = 0; p < bones.length; p += 2) {
    over(pose, bones[p] * 12, bones[p + 1] * 12, extra, bones[p] * 12);
    isLeg[bones[p]] = 1;
    if (!hosts.includes(bones[p + 1])) hosts.push(bones[p + 1]);
  }
  const still = isLeg.indexOf(0);

  // 那张网格上带着腿的权重的顶点，按格子存起来（格子和找的范围一样大）
  const reach = REACH * Math.max(options.voxel, VOXEL.preview);
  const cell = (x: number, y: number, z: number) => `${Math.floor(x / reach)},${Math.floor(y / reach)},${Math.floor(z / reach)}`;
  const grid = new Map<string, number[]>();
  const total = bind.positions.length / 3;
  for (let v = 0; v < total; v++) {
    let leg = 0;
    for (let k = 0; k < 4; k++) if (isLeg[bind.joints[v * 4 + k]]) leg += bind.weights[v * 4 + k];
    if (leg < 1e-4) continue;
    const key = cell(bind.positions[v * 3], bind.positions[v * 3 + 1], bind.positions[v * 3 + 2]);
    const list = grid.get(key);
    if (list) list.push(v);
    else grid.set(key, [v]);
  }

  // 缝上去的手不抄（它们排在最后，照自己的权重已经摆好了）
  const limit = mesh.bound ? mesh.bound.start : mesh.positions.length / 3;
  const joints = new Uint16Array(limit * 4).fill(still);
  const weights = new Float32Array(limit * 4);
  const { positions, normals } = mesh;
  // 一个顶点周围的点各带着哪些骨骼、加起来各占多少（骨骼不多，顺着找就行）
  const mixBone = new Int32Array(32);
  const mixShare = new Float64Array(32);
  for (let v = 0; v < limit; v++) {
    weights[v * 4] = 1;
    let mixed = 0;
    let found = 0;
    for (const h of hosts) {
      // 这个顶点要是下半身的，静止时在哪、朝哪：q = Rᵀ (p − t)
      const o = h * 12;
      const dx = positions[v * 3] - pose[o + 9];
      const dy = positions[v * 3 + 1] - pose[o + 10];
      const dz = positions[v * 3 + 2] - pose[o + 11];
      const qx = pose[o] * dx + pose[o + 3] * dy + pose[o + 6] * dz;
      const qy = pose[o + 1] * dx + pose[o + 4] * dy + pose[o + 7] * dz;
      const qz = pose[o + 2] * dx + pose[o + 5] * dy + pose[o + 8] * dz;
      const nx = pose[o] * normals[v * 3] + pose[o + 3] * normals[v * 3 + 1] + pose[o + 6] * normals[v * 3 + 2];
      const ny = pose[o + 1] * normals[v * 3] + pose[o + 4] * normals[v * 3 + 1] + pose[o + 7] * normals[v * 3 + 2];
      const nz = pose[o + 2] * normals[v * 3] + pose[o + 5] * normals[v * 3 + 1] + pose[o + 8] * normals[v * 3 + 2];
      const cx = Math.floor(qx / reach);
      const cy = Math.floor(qy / reach);
      const cz = Math.floor(qz / reach);
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          for (let k = -1; k <= 1; k++) {
            const list = grid.get(`${cx + i},${cy + j},${cz + k}`);
            if (!list) continue;
            for (const u of list) {
              const ex = bind.positions[u * 3] - qx;
              const ey = bind.positions[u * 3 + 1] - qy;
              const ez = bind.positions[u * 3 + 2] - qz;
              const d2 = ex * ex + ey * ey + ez * ez;
              if (d2 >= reach * reach) continue;
              if (bind.normals[u * 3] * nx + bind.normals[u * 3 + 1] * ny + bind.normals[u * 3 + 2] * nz < FACING) continue;
              // 越近的占得越多，到 reach 平滑地减到零
              const near = 1 - d2 / (reach * reach);
              const share = near * near;
              found += share;
              for (let t = 0; t < 4; t++) {
                const w = bind.weights[u * 4 + t] * share;
                if (w <= 0) continue;
                const bone = bind.joints[u * 4 + t];
                let at = 0;
                while (at < mixed && mixBone[at] !== bone) at++;
                if (at === mixed) {
                  if (mixed === mixBone.length) continue;
                  mixBone[mixed] = bone;
                  mixShare[mixed] = 0;
                  mixed++;
                }
                mixShare[at] += w;
              }
            }
          }
        }
      }
    }
    if (!(found > 0)) continue;
    // 留占得最多的四根，重新凑成 1
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      let top = -1;
      for (let at = 0; at < mixed; at++) if (mixShare[at] > 0 && (top < 0 || mixShare[at] > mixShare[top])) top = at;
      if (top < 0) {
        joints[v * 4 + k] = still;
        weights[v * 4 + k] = 0;
        continue;
      }
      joints[v * 4 + k] = mixBone[top];
      weights[v * 4 + k] = mixShare[top];
      sum += mixShare[top];
      mixShare[top] = 0;
    }
    if (sum > 0) for (let k = 0; k < 4; k++) weights[v * 4 + k] /= sum;
    else weights[v * 4] = 1;
  }
  skinVerticesDualInPlace(positions.subarray(0, limit * 3), normals.subarray(0, limit * 3), joints, weights, extra);

  // 缝在腿上的脚：融合时跟着胯，照它自己的权重也搬过去（手的骨骼不在腿上，extra 是单位矩阵，不动）
  const bound = mesh.bound;
  if (!bound) return;
  const index = new Map(buildSkeleton({ parts, scale: 1 }).bones.map((bone, i) => [bone.name, i]));
  const map = bound.bones.map((name) => index.get(name) ?? still);
  const sewn = positions.length / 3 - bound.start;
  if (!bound.joints.some((j, k) => bound.weights[k] > 0 && isLeg[map[j]])) return;
  skinVerticesDualInPlace(
    positions.subarray(bound.start * 3),
    normals.subarray(bound.start * 3),
    Uint16Array.from(bound.joints.subarray(0, sewn * 4), (j) => map[j]),
    bound.weights.subarray(0, sewn * 4),
    extra,
  );
}

export function fusePosed(parts: Part[], options: FuseOptions & { pose: PoseMatrices }): FusedMesh {
  return stagePosed(parts, options).finish();
}

/** fusePosed 分成前后两半（见 Staged） */
export function stagePosed(parts: Part[], options: FuseOptions & { pose: PoseMatrices }): Staged<FusedMesh> {
  const held = heldLegs({ parts, scale: 1 }, options.pose);
  if (!held) return stageParts(parts, options);
  // 腿这时是跟着胯的，不在摆好的位置上：挖手腕周围时不挖它们（见 FuseOptions.keep）
  const fused = stageParts(parts, { ...options, pose: held.matrices, keep: held.legs });
  return {
    field: fused.field,
    voxel: fused.voxel,
    finish: (memo) => {
      const mesh = fused.finish(memo);
      skinLegs(mesh, parts, options, options.pose, held.bones);
      return mesh;
    },
  };
}
