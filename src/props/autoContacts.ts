/**
 * 用户自己导入的素材没有「哪是坐面、哪是台面」的记号（见 docs/import-plan.md 第 2 期）：照它的分类和形状自己找。
 * 纯函数：给网格、原样的大小、分类，返回和 contacts.ts 手工标的一样的东西；找不出来就是空的（按钮灰着，用户自己摆）。
 *
 * 做法：从上往下看，把占的那一块切成小格子，量每一格最高的面有多高（一张高度图）；
 * 高度差不多的格子算同一层，面积最大的那一层就是坐面、床面，最上面那一层是台面；比它高出一截的是靠背、床头板。
 */
import type { Vec3 } from '../model/spec';
import type { PropAssetGroup } from './catalog';
import type { ContactRect, PropContacts } from './contacts';

/** 高度图每边多少格 */
const CELLS = 36;
/** 高度差在总高的这么多以内算同一层 */
const LEVEL = 0.05;
/** 比坐面、床面高出总高的这么多才算靠背、床头板 */
const RAISED = 0.14;
/** 一层至少占看得见的格子的这么多才算数 */
const AREA_MIN = 0.1;
/** 最上面那一层占到这么多：没有靠背（凳子、长凳），坐的就是最上面 */
const FLAT_TOP = 0.45;
/** 坐面最低在总高的这么多：再低的是底座、踏脚 */
const SEAT_LOW = 0.18;
/** 多长才躺得下（米；和 contacts.ts 的箱子一样） */
const LIE_MIN = 1.2;
/** 一块地方占它外接长方形不到这么多：当成圆的 */
const ROUND = 0.86;

interface Shape {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

/** 从上往下看的高度图：每格正中最高的面有多高（米）；没有面的是 -Infinity */
export function heightMap(shape: Shape, size: Vec3, cells = CELLS): Float32Array {
  const map = new Float32Array(cells * cells).fill(-Infinity);
  const [w, , d] = size;
  if (!(w > 0) || !(d > 0)) return map;
  const p = shape.positions;
  const col = (x: number) => (x / w + 0.5) * cells - 0.5;
  const row = (z: number) => (z / d + 0.5) * cells - 0.5;
  for (let t = 0; t + 2 < shape.indices.length; t += 3) {
    const [a, b, c] = [shape.indices[t] * 3, shape.indices[t + 1] * 3, shape.indices[t + 2] * 3];
    const [ax, az, bx, bz, cx, cz] = [col(p[a]), row(p[a + 2]), col(p[b]), row(p[b + 2]), col(p[c]), row(p[c + 2])];
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-12) continue;
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx)));
    const i1 = Math.min(cells - 1, Math.floor(Math.max(ax, bx, cx)));
    const j0 = Math.max(0, Math.ceil(Math.min(az, bz, cz)));
    const j1 = Math.min(cells - 1, Math.floor(Math.max(az, bz, cz)));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const u = ((bz - cz) * (i - cx) + (cx - bx) * (j - cz)) / det;
        const v = ((cz - az) * (i - cx) + (ax - cx) * (j - cz)) / det;
        const k = 1 - u - v;
        if (u < -1e-6 || v < -1e-6 || k < -1e-6) continue;
        const y = u * p[a + 1] + v * p[b + 1] + k * p[c + 1];
        if (y > map[j * cells + i]) map[j * cells + i] = y;
      }
    }
  }
  return map;
}

interface Patch {
  /** 这一层有多高（米） */
  height: number;
  /** 哪些格子（下标） */
  cells: number[];
}

/** 高度在 lo–hi 之间的格子里，连成一片的最大那一片 */
function largestPatch(map: Float32Array, cells: number, lo: number, hi: number): number[] {
  const seen = new Uint8Array(map.length);
  let best: number[] = [];
  for (let start = 0; start < map.length; start++) {
    if (seen[start] || !(map[start] >= lo && map[start] <= hi)) continue;
    const patch: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const at = stack.pop()!;
      patch.push(at);
      const [i, j] = [at % cells, Math.floor(at / cells)];
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const [x, y] = [i + di, j + dj];
        if (x < 0 || y < 0 || x >= cells || y >= cells) continue;
        const next = y * cells + x;
        if (seen[next] || !(map[next] >= lo && map[next] <= hi)) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (patch.length > best.length) best = patch;
  }
  return best;
}

/**
 * 面积最大的那一层：高度在 lo–hi 之间（米）的格子里，哪个高度上下 band 以内连成一片的格子最多。
 * 找不到够大的（不到看得见的格子的 AREA_MIN）返回 null
 */
function widestLevel(map: Float32Array, cells: number, lo: number, hi: number, band: number, covered: number): Patch | null {
  const heights = [...new Set(Array.from(map, (h) => (h >= lo && h <= hi ? Math.round(h / (band / 2)) : NaN)).filter((h) => !Number.isNaN(h)))];
  let best: Patch | null = null;
  for (const step of heights) {
    const height = step * (band / 2);
    const patch = largestPatch(map, cells, height - band, height + band);
    if (!best || patch.length > best.cells.length) best = { height, cells: patch };
  }
  return best && best.cells.length >= covered * AREA_MIN ? best : null;
}

/** 一片格子占的长方形（占宽、深的几成），和它是不是圆的 */
function rectOf(patch: readonly number[], cells: number): { rect: ContactRect; round: boolean } {
  let [i0, i1, j0, j1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const at of patch) {
    const [i, j] = [at % cells, Math.floor(at / cells)];
    i0 = Math.min(i0, i);
    i1 = Math.max(i1, i);
    j0 = Math.min(j0, j);
    j1 = Math.max(j1, j);
  }
  const f = (n: number) => Math.round((n / cells - 0.5) * 1000) / 1000;
  const fill = patch.length / ((i1 - i0 + 1) * (j1 - j0 + 1));
  const square = Math.abs(i1 - i0 - (j1 - j0)) <= Math.max(2, (i1 - i0) * 0.15);
  return { rect: { x: [f(i0), f(i1 + 1)], z: [f(j0), f(j1 + 1)] }, round: square && fill < ROUND && fill > 0.6 };
}

/** 一片格子的正中（格子的坐标） */
function centre(patch: readonly number[], cells: number): [number, number] {
  let [x, z] = [0, 0];
  for (const at of patch) {
    x += at % cells;
    z += Math.floor(at / cells);
  }
  return [x / patch.length, z / patch.length];
}

/**
 * 高出来的那一块（靠背、床头板）在这片的哪一边：返回「背对着它」朝哪（度；0 是朝 +Z，90 是朝 +X）。
 * 没有高出来的、四周都高（浴缸那样）、偏得不明显的返回 null
 */
function awayFromBack(map: Float32Array, cells: number, patch: Patch, raise: number): number | null {
  const high: number[] = [];
  for (let at = 0; at < map.length; at++) if (map[at] > patch.height + raise) high.push(at);
  // 床头板只有薄薄一条（两米长的床上占不到 3%）也要认
  if (high.length < patch.cells.length * 0.02) return null;
  const [sx, sz] = centre(patch.cells, cells);
  const [hx, hz] = centre(high, cells);
  const [dx, dz] = [(hx - sx) / cells, (hz - sz) / cells];
  if (Math.hypot(dx, dz) < 0.06) return null;
  // 靠背在 -Z 那一头：脸朝 +Z（0°）
  if (Math.abs(dz) >= Math.abs(dx)) return dz < 0 ? 0 : 180;
  return dx < 0 ? 90 : -90;
}

/** 照分类和形状找接触面。shape 是原样大小的网格（原点在底面正中），size 是它原样多大 */
export function autoContacts(shape: Shape, size: Vec3, group: PropAssetGroup): PropContacts {
  if (group === 'other') return {};
  const H = size[1];
  if (!(H > 0)) return {};
  const map = heightMap(shape, size);
  let covered = 0;
  let top = -Infinity;
  for (const h of map) {
    if (h === -Infinity) continue;
    covered++;
    if (h > top) top = h;
  }
  if (covered < 8) return {};
  const band = H * LEVEL;
  const upper = { height: top, cells: largestPatch(map, CELLS, top - band * 2, top + 1e-6) };

  if (group === 'table') {
    // 最上面那一层太小（桌上带着架子、挡板）：台面是下面面积最大的那一层
    const level = upper.cells.length >= covered * AREA_MIN ? upper : widestLevel(map, CELLS, H * 0.3, top + 1e-6, band, covered);
    if (!level) return {};
    const { rect, round } = rectOf(level.cells, CELLS);
    return { top: { rect, ...(round ? { round } : {}) }, sit: { rect, ...(round ? { round } : {}) } };
  }

  if (group === 'seat') {
    // 最上面那一层就占了一大半：没有靠背，坐最上面
    if (upper.cells.length >= covered * FLAT_TOP) {
      const { rect, round } = rectOf(upper.cells, CELLS);
      const long = Math.max((rect.x[1] - rect.x[0]) * size[0], (rect.z[1] - rect.z[0]) * size[2]);
      const along = (rect.z[1] - rect.z[0]) * size[2] >= (rect.x[1] - rect.x[0]) * size[0] ? 0 : 90;
      return { sit: { rect, ...(round ? { round } : {}) }, ...(long >= LIE_MIN && !round ? { lie: { rect, turn: along } } : {}) };
    }
    const seat = widestLevel(map, CELLS, H * SEAT_LOW, top - H * RAISED, band, covered);
    if (!seat) return {};
    const { rect } = rectOf(seat.cells, CELLS);
    const face = awayFromBack(map, CELLS, seat, H * RAISED);
    if (face === null) return { sit: { rect } };
    // 够长的（沙发）顺着躺：头朝坐着时的右手边
    const wide = face === 0 || face === 180 ? (rect.x[1] - rect.x[0]) * size[0] : (rect.z[1] - rect.z[0]) * size[2];
    return { sit: { rect, face }, ...(wide >= LIE_MIN ? { lie: { rect, turn: face === 180 ? -90 : face + 90 } } : {}) };
  }

  // 床：面积最大的那一层是床面；床头板在哪头，头就朝哪头
  const bed = widestLevel(map, CELLS, H * 0.08, top + 1e-6, band * 1.6, covered);
  if (!bed) return {};
  const { rect } = rectOf(bed.cells, CELLS);
  const feet = awayFromBack(map, CELLS, bed, H * RAISED);
  const turn = feet ?? ((rect.z[1] - rect.z[0]) * size[2] >= (rect.x[1] - rect.x[0]) * size[0] ? 0 : 90);
  const long = turn === 0 || turn === 180 ? (rect.z[1] - rect.z[0]) * size[2] : (rect.x[1] - rect.x[0]) * size[0];
  // 坐在两条长边上（床头、床尾那两头有板挡着）
  const sides = turn === 0 || turn === 180 ? [90, -90] : [0, 180];
  return { ...(long >= LIE_MIN ? { lie: { rect, turn } } : {}), sit: { rect, sides } };
}
