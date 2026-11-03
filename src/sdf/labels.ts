/**
 * 造型里拖着部件的时候，后台的网格还没算出来之前，先把屏幕上那张照部件的挪动搬过去（「整块挪」）。
 *
 * 分两半：
 * - labelVertices（在网格 Worker 里，和网格一起算）：给网格的每个顶点标出它属于哪一块——离哪个部件自己的表面最近；
 *   关节那里（肩膀、腋下）和连着的那一块渐变。接上去的现成网格（手、脚）照它自带的骨骼认是哪一只。
 * - pieceFrames / followInto（主线程）：每一块从「算这张网格时」摆的样子到「现在」摆的样子是一个仿射变换，
 *   顶点照标签把它那一两块的变换混起来搬过去。
 *
 * 部件只是挪动、转动、缩放、拉伸（手动微调、手臂长短）时搬得很像；形状本身变了（胸的大小、胖瘦）搬不出来，
 * 等新的网格到了再换上。接缝那里是扯出来的样子，和摆姿势时跟着骨骼动的那张一样。
 * 纯函数，不碰 three.js。
 */
import { type Part, graftFrame, shapeMatrix, worldTransforms } from '../geometry/figure';
import { type Mat3, add, mat3Mul, mul, quatMat3, rotate } from '../geometry/vec';
import { type CompiledField, type Draft, fieldAt, pack, partDrafts } from './field';
import type { FusedMesh } from './surfaceNets';

export interface VertexLabels {
  /** 各块的名字：部件名；接上去的网格是「部件名#第几块」 */
  pieces: string[];
  /** 每个顶点最近的那一块（NONE：哪块都不挨着，不搬）、第二近的那一块 */
  first: Uint16Array;
  second: Uint16Array;
  /** 第二块占多少：0–255 对应 0–0.5 */
  mix: Uint8Array;
}

export const NONE = 0xffff;
/** 离所有部件都超过这么远的顶点不认（融合圆角会让表面比部件本身鼓出来一点；部件自己的单位） */
const REACH = 0.08;
/** 第二近的那一块比最近的远不到这么多时渐变过去：接缝两边各扯开一点，不是一刀切 */
const SEAM = 0.03;
/**
 * 渐变只在连着的两块（部件和它的父部件）之间、离关节不到这么远的地方（肩膀、腋下）。
 * 碰巧挨着的（垂着的手臂贴着胸、手搭在胸上、两条腿挨着）各归各的：不然一块挪开时，另一块会把它边上扯出一片帘子
 */
const JOINT = 0.12;

/**
 * 标出 mesh 的每个顶点属于 parts 里的哪一块。parts 和 voxel 要和算这张网格时的一样
 * （细长部件按体素加粗、胸烤成多粗的格子都跟着体素走：同样的体素，胸烤好的格子照用，不重烤）
 */
export function labelVertices(parts: Part[], mesh: Pick<FusedMesh, 'positions' | 'bound'>, voxel: number): VertexLabels {
  const xfs = worldTransforms({ parts, scale: 1 });
  const pieces: string[] = [];
  const fields: { piece: number; field: CompiledField; part: Part }[] = [];
  /** 手、手指的骨骼 → 那只手是第几块 */
  const graftBone = new Map<string, number>();
  for (const part of parts) {
    if (part.material === 'eye') continue;
    const piece = pieces.push(part.name) - 1;
    const drafts: Draft[] = [];
    partDrafts(part, xfs.get(part.name)!, 0, voxel, drafts);
    if (drafts.length) fields.push({ piece, field: pack(drafts, [0]), part });
    part.grafts?.forEach((graft, g) => {
      const at = pieces.push(`${part.name}#${g}`) - 1;
      for (const bone of graft.rigid) graftBone.set(bone, at);
    });
  }
  // 每一块的父部件是第几块（没有是 -1）、关节在哪
  const fieldOf = new Map(fields.map((f, i) => [f.part.name, i]));
  const parentOf = fields.map((f) => (f.part.parent ? (fieldOf.get(f.part.parent) ?? -1) : -1));
  const childrenOf = fields.map((_, i) => parentOf.flatMap((up, c) => (up === i ? [c] : [])));
  const joints = fields.map(({ part }) => {
    const xf = xfs.get(part.name)!;
    return add(xf.pos, rotate(xf.quat, mul(part.pivot ?? [0, 0, 0], xf.scale)));
  });
  /** 第 i 块在第 v 个顶点（x, y, z）处的距离；包围盒比 cut 还远的不算，给 Infinity */
  const distance = (i: number, x: number, y: number, z: number, cut: number) => {
    const { min, max } = fields[i].field;
    if (x < min[0] - cut || x > max[0] + cut || y < min[1] - cut || y > max[1] + cut || z < min[2] - cut || z > max[2] + cut) return Infinity;
    return fieldAt(fields[i].field, x, y, z);
  };
  /** child 和它的父部件之间的关节离 (x, y, z) 够不够近 */
  const atJoint = (child: number, x: number, y: number, z: number) => {
    const j = joints[child];
    return Math.hypot(x - j[0], y - j[1], z - j[2]) <= JOINT;
  };

  const count = mesh.positions.length / 3;
  const first = new Uint16Array(count).fill(NONE);
  const second = new Uint16Array(count).fill(NONE);
  const mix = new Uint8Array(count);
  const p = mesh.positions;
  const bound = mesh.bound;
  /** 上一个顶点最近的那一块：相邻的顶点多半也是它，先查它，后面的包围盒就能筛掉更多 */
  let hint = 0;
  for (let v = 0; v < count; v++) {
    // 接上去的网格：照它主要跟着的那根骨骼认（手腕那一圈跟着前臂的，下面照距离认）
    if (bound && v >= bound.start) {
      const o = (v - bound.start) * 4;
      let best = -1;
      let most = 0;
      for (let k = 0; k < 4; k++) {
        const w = bound.weights[o + k];
        const at = w > most ? graftBone.get(bound.bones[bound.joints[o + k]]) : undefined;
        if (at !== undefined) {
          best = at;
          most = w;
        }
      }
      if (best >= 0) {
        first[v] = best;
        second[v] = best;
        continue;
      }
    }
    const x = p[v * 3];
    const y = p[v * 3 + 1];
    const z = p[v * 3 + 2];
    // 最近的那块：包围盒比眼下最近的还远的就不用算
    let a = -1;
    let da = REACH;
    for (let n = 0; n < fields.length; n++) {
      const i = (n + hint) % fields.length;
      const d = distance(i, x, y, z, da);
      if (d < da) {
        a = i;
        da = d;
      }
    }
    if (a < 0) continue;
    hint = a;
    // 渐变过去的那块：只在它的父部件、子部件里找，离它们之间的关节够近、比它远不出 SEAM 的里面最近的
    let b = -1;
    let db = da + SEAM;
    const up = parentOf[a];
    if (up >= 0 && atJoint(a, x, y, z)) {
      const d = distance(up, x, y, z, db);
      if (d < db) {
        b = up;
        db = d;
      }
    }
    for (const c of childrenOf[a]) {
      if (!atJoint(c, x, y, z)) continue;
      const d = distance(c, x, y, z, db);
      if (d < db) {
        b = c;
        db = d;
      }
    }
    first[v] = fields[a].piece;
    second[v] = b < 0 ? fields[a].piece : fields[b].piece;
    if (b >= 0) {
      // 一样远是各占一半，远出 SEAM 就全归最近的；中间平滑过渡
      const t = 1 - (db - da) / SEAM;
      mix[v] = Math.round(t * t * (3 - 2 * t) * 255);
    }
  }
  return { pieces, first, second, mix };
}

/**
 * 这副身体由哪些块拼成：部件名、各自的基本体是哪几种（采样好的形状记名字）、接了几块现成网格。
 * 两副一样的，才能照标签把一副的网格挪成另一副的样子：只是位置、角度、大小、长短变了。
 * 换了身体样式、多了少了部件，挪出来的没有意义，等新的网格
 */
export function outline(parts: readonly Part[]): string {
  return parts
    .map((p) => `${p.name}:${p.prims.map((q) => (q.kind === 'grid' ? q.grid : q.kind)).join(',')}:${p.grafts?.length ?? 0}`)
    .join('|');
}

/**
 * 每一块在网格里怎么摆（部件自己的单位，Figure.scale 当作 1）：块里的点 p 在 linear · p + origin。
 * 每块 12 个数：前 9 个是 linear（按行），后 3 个是 origin。
 */
export function pieceFrames(parts: Part[]): Map<string, Float64Array> {
  const xfs = worldTransforms({ parts, scale: 1 });
  const out = new Map<string, Float64Array>();
  const put = (name: string, m: Mat3, o: readonly number[]) => {
    const f = new Float64Array(12);
    f.set(m);
    f.set(o, 9);
    out.set(name, f);
  };
  for (const part of parts) {
    const xf = xfs.get(part.name)!;
    const outer = quatMat3(xf.quat).map((v) => v * xf.scale) as Mat3;
    const shape = shapeMatrix(part);
    put(part.name, shape ? mat3Mul(outer, shape) : outer, xf.pos);
    // 接上去的网格不跟着部件拉伸，照 graftFrame 摆（见 sdf/graft.ts）
    part.grafts?.forEach((graft, g) => {
      const { matrix, offset: o } = graftFrame(part, graft);
      put(`${part.name}#${g}`, mat3Mul(outer, matrix), [
        xf.pos[0] + outer[0] * o[0] + outer[1] * o[1] + outer[2] * o[2],
        xf.pos[1] + outer[3] * o[0] + outer[4] * o[1] + outer[5] * o[2],
        xf.pos[2] + outer[6] * o[0] + outer[7] * o[1] + outer[8] * o[2],
      ]);
    });
  }
  return out;
}

/** 从 from 那样摆到 to 那样摆，每一块要乘的变换（每块 12 个数，同 pieceFrames）。哪边少了这一块、或者它没动，就是 null */
export function followMatrices(pieces: string[], from: Map<string, Float64Array>, to: Map<string, Float64Array>): (Float64Array | null)[] {
  return pieces.map((name) => {
    const a = from.get(name);
    const b = to.get(name);
    if (!a || !b) return null;
    let same = true;
    for (let i = 0; i < 12 && same; i++) same = Math.abs(a[i] - b[i]) < 1e-9;
    if (same) return null;
    const inv = invert(a);
    if (!inv) return null;
    // b · a⁻¹：先从网格里退回块自己的坐标，再照现在的样子摆出去
    const m = new Float64Array(12);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) m[r * 3 + c] = b[r * 3] * inv[c] + b[r * 3 + 1] * inv[3 + c] + b[r * 3 + 2] * inv[6 + c];
      m[9 + r] = b[r * 3] * inv[9] + b[r * 3 + 1] * inv[10] + b[r * 3 + 2] * inv[11] + b[9 + r];
    }
    return m;
  });
}

/** 仿射变换（12 个数，同 pieceFrames）的逆；压扁成一片的给 null */
function invert(f: Float64Array): Float64Array | null {
  const [a, b, c, d, e, g, h, i, j] = f;
  const det = a * (e * j - g * i) - b * (d * j - g * h) + c * (d * i - e * h);
  if (Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  const m = new Float64Array(12);
  m[0] = (e * j - g * i) * k;
  m[1] = (c * i - b * j) * k;
  m[2] = (b * g - c * e) * k;
  m[3] = (g * h - d * j) * k;
  m[4] = (a * j - c * h) * k;
  m[5] = (c * d - a * g) * k;
  m[6] = (d * i - e * h) * k;
  m[7] = (b * h - a * i) * k;
  m[8] = (a * e - b * d) * k;
  for (let r = 0; r < 3; r++) m[9 + r] = -(m[r * 3] * f[9] + m[r * 3 + 1] * f[10] + m[r * 3 + 2] * f[11]);
  return m;
}

/**
 * 照标签把静止的顶点（rest、restNormals）搬到 out、outNormals：每个顶点是它那一两块的变换按比例混起来。
 * moves 是 followMatrices 给的（null 是不动）。返回挪得最远的那个顶点挪了多远（包围球要放大这么多）
 */
export function followInto(
  labels: VertexLabels,
  moves: (Float64Array | null)[],
  rest: Float32Array,
  restNormals: Float32Array,
  out: Float32Array,
  outNormals: Float32Array,
): number {
  const { first, second, mix } = labels;
  const count = first.length;
  let far = 0;
  // 不动的块当作单位变换
  const still = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  for (let v = 0; v < count; v++) {
    const ma = first[v] === NONE ? null : moves[first[v]];
    const mb = second[v] === NONE ? null : moves[second[v]];
    const o = v * 3;
    const x = rest[o];
    const y = rest[o + 1];
    const z = rest[o + 2];
    const nx = restNormals[o];
    const ny = restNormals[o + 1];
    const nz = restNormals[o + 2];
    const w = ma === mb ? 0 : mix[v] / 510;
    if (!ma && (!mb || w === 0)) {
      out[o] = x;
      out[o + 1] = y;
      out[o + 2] = z;
      outNormals[o] = nx;
      outNormals[o + 1] = ny;
      outNormals[o + 2] = nz;
      continue;
    }
    // 两块的变换按比例混成一个，再乘上去
    const a = ma ?? still;
    const b = mb ?? still;
    const u = 1 - w;
    const m0 = a[0] * u + b[0] * w;
    const m1 = a[1] * u + b[1] * w;
    const m2 = a[2] * u + b[2] * w;
    const m3 = a[3] * u + b[3] * w;
    const m4 = a[4] * u + b[4] * w;
    const m5 = a[5] * u + b[5] * w;
    const m6 = a[6] * u + b[6] * w;
    const m7 = a[7] * u + b[7] * w;
    const m8 = a[8] * u + b[8] * w;
    const px = m0 * x + m1 * y + m2 * z + a[9] * u + b[9] * w;
    const py = m3 * x + m4 * y + m5 * z + a[10] * u + b[10] * w;
    const pz = m6 * x + m7 * y + m8 * z + a[11] * u + b[11] * w;
    // 法线只照着转（拉伸时不完全对，拖着的时候看不出来）
    const qx = m0 * nx + m1 * ny + m2 * nz;
    const qy = m3 * nx + m4 * ny + m5 * nz;
    const qz = m6 * nx + m7 * ny + m8 * nz;
    out[o] = px;
    out[o + 1] = py;
    out[o + 2] = pz;
    const l = Math.hypot(qx, qy, qz) || 1;
    outNormals[o] = qx / l;
    outNormals[o + 1] = qy / l;
    outNormals[o + 2] = qz / l;
    far = Math.max(far, Math.abs(px - x) + Math.abs(py - y) + Math.abs(pz - z));
  }
  return far;
}
