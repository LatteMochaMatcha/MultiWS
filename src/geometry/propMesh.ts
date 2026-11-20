/**
 * 道具的网格（见 model/props.ts）：基本体照种类和尺寸现算，素材拿现成的网格照尺寸拉伸；
 * 屏幕上、「落到下面」、导出都用这一份。
 * 道具自己的坐标：原点在底面正中，Y 朝上，宽沿 X、深沿 Z。
 */
import { type PropKind, type SceneProp, propPoint, propRotation } from '../model/props';
import type { Vec3 } from '../model/spec';
import { propAsset } from '../props/catalog';
import { propAssetShape, propTouchShape } from '../props/library';

export interface PropShape {
  /** 每三个数一个点（米） */
  positions: Float32Array;
  normals: Float32Array;
  /** 每三个数一个面，从外面看逆时针 */
  indices: Uint32Array;
  /** 贴图坐标（每个点两个数，左上角是原点）：只有写实款的素材有 */
  uvs?: Float32Array;
  /** 面分成几批、各用第几个材质（写实款；材质见 props/realFile.ts） */
  groups?: { start: number; count: number; material: number }[];
}

/** 圆的一圈分多少段 */
const ROUND = 40;
/** 球从底到顶分多少圈 */
const RINGS = 20;

function box(w: number, h: number, d: number): PropShape {
  const x = w / 2;
  const z = d / 2;
  // 六个面：朝哪边、四个角（从外面看逆时针）
  const faces: [Vec3, Vec3[]][] = [
    [[1, 0, 0], [[x, 0, z], [x, 0, -z], [x, h, -z], [x, h, z]]],
    [[-1, 0, 0], [[-x, 0, -z], [-x, 0, z], [-x, h, z], [-x, h, -z]]],
    [[0, 1, 0], [[-x, h, z], [x, h, z], [x, h, -z], [-x, h, -z]]],
    [[0, -1, 0], [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]]],
    [[0, 0, 1], [[-x, 0, z], [x, 0, z], [x, h, z], [-x, h, z]]],
    [[0, 0, -1], [[x, 0, -z], [-x, 0, -z], [-x, h, -z], [x, h, -z]]],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const [n, corners] of faces) {
    const at = positions.length / 3;
    for (const c of corners) {
      positions.push(...c);
      normals.push(...n);
    }
    indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}

/** 椭圆柱：宽、深是两个方向的直径 */
function cylinder(w: number, h: number, d: number): PropShape {
  const rx = w / 2;
  const rz = d / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  // 侧面：每段上下各一个点，首尾各放一份（法线不用在接缝上平均）
  for (let i = 0; i <= ROUND; i++) {
    const a = (i / ROUND) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // 椭圆的法线：(cos/rx, sin/rz) 归一
    const nx = c / rx;
    const nz = s / rz;
    const nl = Math.hypot(nx, nz);
    positions.push(rx * c, 0, rz * s, rx * c, h, rz * s);
    normals.push(nx / nl, 0, nz / nl, nx / nl, 0, nz / nl);
  }
  for (let i = 0; i < ROUND; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  // 顶、底：正中一个点加一圈
  for (const [y, ny] of [
    [h, 1],
    [0, -1],
  ]) {
    const centre = positions.length / 3;
    positions.push(0, y, 0);
    normals.push(0, ny, 0);
    for (let i = 0; i < ROUND; i++) {
      const a = (i / ROUND) * Math.PI * 2;
      positions.push(rx * Math.cos(a), y, rz * Math.sin(a));
      normals.push(0, ny, 0);
    }
    for (let i = 0; i < ROUND; i++) {
      const p = centre + 1 + i;
      const q = centre + 1 + ((i + 1) % ROUND);
      if (ny > 0) indices.push(centre, q, p);
      else indices.push(centre, p, q);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}

/** 椭球：三个方向的直径，底在 y = 0 */
function ellipsoid(w: number, h: number, d: number): PropShape {
  const rx = w / 2;
  const ry = h / 2;
  const rz = d / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= RINGS; j++) {
    // 从底（-90°）到顶（90°）
    const lat = (j / RINGS - 0.5) * Math.PI;
    const cy = Math.cos(lat);
    const sy = Math.sin(lat);
    for (let i = 0; i <= ROUND; i++) {
      const a = (i / ROUND) * Math.PI * 2;
      const ux = cy * Math.cos(a);
      const uz = cy * Math.sin(a);
      positions.push(rx * ux, ry + ry * sy, rz * uz);
      const nx = ux / rx;
      const ny = sy / ry;
      const nz = uz / rz;
      const nl = Math.hypot(nx, ny, nz);
      normals.push(nx / nl, ny / nl, nz / nl);
    }
  }
  const row = ROUND + 1;
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < ROUND; i++) {
      const a = j * row + i;
      const b = a + row;
      // 最底、最顶那一圈缩成一个点：各少一个面
      if (j > 0) indices.push(a, b + 1, a + 1);
      if (j < RINGS - 1) indices.push(a, b, b + 1);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}

/** 基本体在自己坐标里的网格 */
export function propShape(kind: PropKind, size: Vec3): PropShape {
  const [w, h, d] = size;
  if (kind === 'box' || kind === 'wall') return box(w, h, d);
  if (kind === 'ball') return ellipsoid(w, h, d);
  return cylinder(w, h, d);
}

/** 素材原样的网格照尺寸拉伸：点各方向乘上倍数，法线反着除再归一（拉长的方向上面变得更「侧」） */
function stretch(shape: PropShape, from: Vec3, to: Vec3): PropShape {
  const f = [0, 1, 2].map((k) => (from[k] > 1e-6 ? to[k] / from[k] : 1));
  if (f.every((v) => Math.abs(v - 1) < 1e-6)) return shape;
  const positions = new Float32Array(shape.positions.length);
  const normals = new Float32Array(shape.normals.length);
  for (let i = 0; i < positions.length; i += 3) {
    const n = [shape.normals[i] / f[0], shape.normals[i + 1] / f[1], shape.normals[i + 2] / f[2]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    for (let k = 0; k < 3; k++) {
      positions[i + k] = shape.positions[i + k] * f[k];
      normals[i + k] = n[k] / l;
    }
  }
  return { ...shape, positions, normals };
}

/**
 * 一件道具在自己坐标里的网格：基本体现算；素材拿它原样的网格照尺寸拉伸。
 * 素材的文件还没读进来（或者没读到）时先用一个同样大的方块顶着
 */
export function shapeOf(prop: Pick<SceneProp, 'kind' | 'asset' | 'size'>): PropShape {
  if (prop.kind !== 'asset') return propShape(prop.kind, prop.size);
  const natural = propAssetShape(prop.asset);
  const entry = propAsset(prop.asset);
  if (!natural || !entry) return box(prop.size[0], prop.size[1], prop.size[2]);
  return stretch(natural, entry.size, prop.size);
}

/**
 * 碰撞用的网格（停在表面、查穿插、落到下面）：写实款面多的有一份粗的，照同样的尺寸拉伸；别的就是 shapeOf
 */
export function touchShapeOf(prop: Pick<SceneProp, 'kind' | 'asset' | 'size'>): PropShape {
  if (prop.kind !== 'asset') return propShape(prop.kind, prop.size);
  const coarse = propTouchShape(prop.asset);
  const entry = propAsset(prop.asset);
  if (!coarse || !entry) return box(prop.size[0], prop.size[1], prop.size[2]);
  return stretch(coarse, entry.size, prop.size);
}

/** 网格的点搬到场景里（照道具的位置、旋转） */
export function propWorldPoints(prop: SceneProp, shape: PropShape = shapeOf(prop)): Float32Array {
  const m = propRotation(prop.rot);
  const out = new Float32Array(shape.positions.length);
  for (let i = 0; i < out.length; i += 3) {
    const p = propPoint(prop, [shape.positions[i], shape.positions[i + 1], shape.positions[i + 2]], m);
    out[i] = p[0];
    out[i + 1] = p[1];
    out[i + 2] = p[2];
  }
  return out;
}

/** 网格的法线转到场景里（照道具的旋转） */
export function propWorldNormals(prop: SceneProp, shape: PropShape = shapeOf(prop)): Float32Array {
  const m = propRotation(prop.rot);
  const n = shape.normals;
  const out = new Float32Array(n.length);
  for (let i = 0; i < out.length; i += 3) {
    out[i] = m[0] * n[i] + m[1] * n[i + 1] + m[2] * n[i + 2];
    out[i + 1] = m[3] * n[i] + m[4] * n[i + 1] + m[5] * n[i + 2];
    out[i + 2] = m[6] * n[i] + m[7] * n[i + 1] + m[8] * n[i + 2];
  }
  return out;
}

/** 道具在场景里占的盒子（米） */
export function propBounds(prop: SceneProp): { min: Vec3; max: Vec3 } {
  const pts = propWorldPoints(prop);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (pts[i + k] < min[k]) min[k] = pts[i + k];
      if (pts[i + k] > max[k]) max[k] = pts[i + k];
    }
  }
  return { min, max };
}

/* ---------------- 落到下面 ---------------- */

/** 离最低点这么近的点都算「底下那一片」（米） */
const BOTTOM_BAND = 0.02;
/** 最多拿多少个点往下试 */
const MAX_PROBES = 96;

/** 从 (x, y, z) 竖直往下，打在这个三角面上的高度；打不中、或者面在这一点上方，返回 null */
function below(x: number, y: number, z: number, pts: Float32Array, a: number, b: number, c: number): number | null {
  const ax = pts[a * 3];
  const az = pts[a * 3 + 2];
  const bx = pts[b * 3];
  const bz = pts[b * 3 + 2];
  const cx = pts[c * 3];
  const cz = pts[c * 3 + 2];
  const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  // 竖着的面（从上往下看是一条线）打不中
  if (Math.abs(det) < 1e-12) return null;
  const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
  const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
  const w = 1 - u - v;
  const eps = -1e-6;
  if (u < eps || v < eps || w < eps) return null;
  const hit = u * pts[a * 3 + 1] + v * pts[b * 3 + 1] + w * pts[c * 3 + 1];
  return hit <= y + 1e-6 ? hit : null;
}

/**
 * 「落到下面」：这件道具竖直落下去，落到地面或者正下方别的道具上，返回落好以后它的高度（pos 的第 2 个数）。
 *
 * 拿它最低的那一片（最低点往上 2 厘米以内的点，加上这一片的正中、正中到各点的半路）往下试：
 * 哪一处下面有别的道具的面，取最高的那个；都没有就是地面。埋在地下的拉回地面上。
 * 只看正下方：已经插进别的道具里的，那件不算（它的面在上面）。
 */
export function dropHeight(prop: SceneProp, others: readonly SceneProp[]): number {
  const pts = propWorldPoints(prop);
  let lowest = Infinity;
  for (let i = 1; i < pts.length; i += 3) lowest = Math.min(lowest, pts[i]);
  const patch: [number, number][] = [];
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 1] <= lowest + BOTTOM_BAND) patch.push([pts[i], pts[i + 2]]);
  const stride = Math.max(1, Math.ceil(patch.length / (MAX_PROBES / 2)));
  const picked = patch.filter((_, i) => i % stride === 0);
  const cx = picked.reduce((s, p) => s + p[0], 0) / picked.length;
  const cz = picked.reduce((s, p) => s + p[1], 0) / picked.length;
  const probes: [number, number][] = [[cx, cz], ...picked, ...picked.map((p): [number, number] => [(p[0] + cx) / 2, (p[1] + cz) / 2])];

  // 埋在地下的：从地面算起
  const from = Math.max(lowest, 0);
  let rest = 0;
  for (const other of others) {
    if (other.id === prop.id) continue;
    const shape = touchShapeOf(other);
    const world = propWorldPoints(other, shape);
    for (let i = 0; i < shape.indices.length; i += 3) {
      for (const [x, z] of probes) {
        const hit = below(x, from, z, world, shape.indices[i], shape.indices[i + 1], shape.indices[i + 2]);
        if (hit !== null && hit > rest) rest = hit;
      }
    }
  }
  return prop.pos[1] + (rest - lowest);
}
