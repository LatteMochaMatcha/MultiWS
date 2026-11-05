/**
 * 换网格时的过渡：造型里拖滑块、拖部件时，后台每算好一张新网格就换上（粗的一秒六七张，再换成预览、精细的）。
 * 直接换的话，每换一次形状跳一下，看着一顿一顿的、不跟手。
 * 所以新网格先贴在屏幕上原来那张的表面上，再在一两百毫秒里平滑地变到它自己的样子：
 * 新网格每个顶点找原来那张上最近的顶点，沿自己的法线量出离原来的表面多远（只沿法线：顺着表面滑的那部分不要，
 * 不然会被原来那张的顶点间距扯出一格一格的小面），过渡时从「贴着原来的表面」往回收到 0。
 * 离原来那张太远的顶点（多了个部件、换了样式）找不到对应的，直接是新的样子。
 * 纯函数，不碰 three.js。
 */

/** 分桶的格子边长（网格自己的单位）：和最细的网格顶点间距差不多，每格只有一两个顶点 */
const CELL = 0.012;

/**
 * 新网格每个顶点沿法线挪多少就贴到原来那张的表面上（每顶点 3 个数，和 positions 同样排）。
 * reach：最近的顶点比这还远就不挪（网格自己的单位）
 */
export function surfaceOffsets(from: Float32Array, positions: Float32Array, normals: Float32Array, reach: number): Float32Array {
  const out = new Float32Array(positions.length);
  const n = from.length / 3;
  if (!n || !positions.length) return out;
  // 原来那张的顶点按格子分桶（格子边长 CELL）：每个新顶点先看自己周围一圈，没找到够近的再往外一圈，最远到 reach
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < from.length; i += 3) {
    const x = from[i];
    const y = from[i + 1];
    const z = from[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const cell = Math.min(reach, CELL);
  const inv = 1 / cell;
  const rings = Math.ceil(reach / cell);
  const nx = Math.floor((x1 - x0) * inv) + 1;
  const ny = Math.floor((y1 - y0) * inv) + 1;
  const nz = Math.floor((z1 - z0) * inv) + 1;
  const cells = nx * ny * nz;
  // 格子太多（形状大得离谱、reach 太小）：不做过渡
  if (!Number.isFinite(cells) || cells > 3e6) return out;
  const cellOf = new Int32Array(n);
  const start = new Int32Array(cells + 1);
  for (let v = 0; v < n; v++) {
    const cx = Math.floor((from[v * 3] - x0) * inv);
    const cy = Math.floor((from[v * 3 + 1] - y0) * inv);
    const cz = Math.floor((from[v * 3 + 2] - z0) * inv);
    const c = (cz * ny + cy) * nx + cx;
    cellOf[v] = c;
    start[c + 1]++;
  }
  for (let c = 0; c < cells; c++) start[c + 1] += start[c];
  const fill = start.slice(0, cells);
  const order = new Int32Array(n);
  for (let v = 0; v < n; v++) order[fill[cellOf[v]]++] = v;

  const reach2 = reach * reach;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const cx = Math.floor((x - x0) * inv);
    const cy = Math.floor((y - y0) * inv);
    const cz = Math.floor((z - z0) * inv);
    let best = reach2;
    let hit = -1;
    // 第 r 圈：离中心那格 r 格远的一层壳。看完第 r 圈，找到的比 r 格还近，外面的就不可能更近了
    for (let r = 0; r <= rings; r++) {
      if (hit >= 0 && best <= (r - 1) * (r - 1) * cell * cell) break;
      for (let dz = -r; dz <= r; dz++) {
      const gz = cz + dz;
      if (gz < 0 || gz >= nz) continue;
      for (let dy = -r; dy <= r; dy++) {
        const gy = cy + dy;
        if (gy < 0 || gy >= ny) continue;
        const shell = Math.abs(dz) === r || Math.abs(dy) === r;
        for (let dx = -r; dx <= r; dx += shell || r === 0 ? 1 : 2 * r) {
          const gx = cx + dx;
          if (gx < 0 || gx >= nx) continue;
          const c = (gz * ny + gy) * nx + gx;
          for (let k = start[c]; k < start[c + 1]; k++) {
            const o = order[k] * 3;
            const ex = from[o] - x;
            const ey = from[o + 1] - y;
            const ez = from[o + 2] - z;
            const d2 = ex * ex + ey * ey + ez * ez;
            if (d2 < best) {
              best = d2;
              hit = o;
            }
          }
        }
      }
      }
    }
    if (hit < 0) continue;
    const mx = normals[i];
    const my = normals[i + 1];
    const mz = normals[i + 2];
    const along = (from[hit] - x) * mx + (from[hit + 1] - y) * my + (from[hit + 2] - z) * mz;
    out[i] = mx * along;
    out[i + 1] = my * along;
    out[i + 2] = mz * along;
  }
  return out;
}

/** 过渡进行到 t（0–1）时还剩几成没收回去：先快后慢 */
export const morphLeft = (t: number): number => (t >= 1 ? 0 : (1 - t) * (1 - t));
