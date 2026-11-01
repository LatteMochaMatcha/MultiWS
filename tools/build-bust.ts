// 从 DJP 原素材采样左胸：默认生成大胸 bustLarge，--small 生成默认小胸 bustReference。
//   node tools/run.mjs tools/build-bust.ts
//   node tools/run.mjs tools/build-bust.ts --small
//
// 为什么要换：以前的大胸是工坊自己用三个椭球拼的，胸调得很大时两个胸并成一大块、中间只有一道缝，
// 没有各自的圆形体量、没有胸下的褶，往两边一直糊到腋下。这个素体的胸是雕好的：各自饱满、往下坠一点、胸下有褶、略微朝外。
//
// 做的事：
// 1. 读 OBJ，保留原素材可见胸型与胸尖；--small 使用 Anime Base Sculpt，默认使用 Free Base Mesh 01；
// 2. 照素体摆好：这个素体肩膀的高度、胸口正中胸壁的前后和素体差不多，往上挪一点、往后挪一点就对上（OFFSET）；
//    它的胸廓宽一些：胸照胸根等比缩一点、往中间挪一点（SHRINK，不压扁：左右收窄的话圆胸挤成竖着的水滴）；
// 3. 在「胸」那一块的格子上采样（格子和 bust 一模一样，两份之间可以逐格混合，见 GridShape.morph）：
//    胸调到 REF 倍时，这一块（照 animeLayout.ts 摆的位置、放大 REF 倍）正好是这个素体的胸（照 SHRINK 缩过）原样大小；
// 4. 只留左胸：胸的底座（FOOT，照胸实际凸出二次元素体平胸的躯干的那一片拟合的椭圆）以内照原样，
//    以外把这个素体的表面往里压、沉到躯干里面（SINK），再往外、胸壁往后一点以后（BACK）、正中线往右（MEDIAL）的都不要。
//    靠正中那一边切过两个胸挤在一起的地方，圆滑地切开以后是胸的内侧。
//
// 重新跑 tools/build-anime-body.mjs 后，要依次运行上面两条命令（它会重写整个 body.bin）。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { animeGrid, installAnimeBody } from '../src/anime/body';
import { getGrid, gridDist } from '../src/sdf/grids';
import { sag } from '../src/anime/bustSag';

type V3 = [number, number, number];

const BIN = 'public/anime/body.bin';
const META = 'src/anime/bodyMeta.json';

/** 胸往大调时，这一块每放大一倍往身体里挪多少（和 animeLayout.ts 里第一排胸的 z 一样算） */
const PUSH = 0.03;
/**
 * 这个素体摆到二次元素体上：它的胸廓比二次元素体宽一成半，照原样摆的话胸显得比原来大、外侧伸到手臂根上（和腋下那片皮挤出一道折棱）。
 * 所以先照左胸的胸根（at，它自己的坐标）等比缩到 k 倍（胸和身子的比例照原样；两边对称地照右胸的胸根缩），
 * 再整个挪 OFFSET（米；x 是往中间挪，右边反过来；二次元素体的上胸长一点，胸往上提一点）
 */
const SHRINK = { at: [0.086, 1.13, 0.1] as V3, k: 0.85 };
const OFFSET: V3 = [-0.008, 0.03, -0.006];
/**
 * 胸的底座（正面看是一个椭圆，前后通到底）：照这个素体的胸凸出平胸的躯干 rise 以上的那一片拟合（中心是那一片的重心，
 * 半径照它的方差），和胸取交集时圆滑过渡 soft 那么宽。
 * 取的范围大了不行：胸以外那个素体的胸壁、肚子贴着二次元素体的躯干，这一块的边界离躯干表面很近，
 * 和躯干圆滑地融的时候会把躯干往外鼓几毫米，那个素体胸壁上的起伏就印到躯干上（胸口一道道波纹、肚子上几个包）
 */
const FOOT = { rise: 0.004, soft: 0.012, reach: 0.1 };
/**
 * 胸的底座以外往里压（SINK）：底座以内（离正中按椭圆量的比例 from 以内）照原样，往外渐渐把这个素体的表面往里压，
 * 到 to 压足 depth，再往外（out）就不要了。这个素体的胸壁、上胸和二次元素体的胸口前后差一厘米上下、来回交错：
 * 留着和躯干贴着的话，胸调到别的大小时这一块跟着缩放，和躯干错开，胸口上鼓一块、凹一块；和躯干圆滑地融的时候整片往外鼓，
 * 那个素体胸壁上的起伏印到躯干上；切掉又在胸根上留一道边。压下去以后整个沉在躯干里面，
 * 胸和胸口直接相交，相交的那一圈就是胸根（胸不和躯干圆滑地融，见 animeLayout.ts）。压得深：胸调大时这一块整个放大，
 * 外圈跟着往外、往上挪，压得浅的话从胸口上顶出来一圈边（像一块板子）
 */
const SINK = { from: 0.8, to: 1.2, depth: 0.05, out: 1.22 };
/** 胸壁往后的都不要（摆好以后的 z）：胸根上的胸壁在 0.08 左右，这一刀切在它后面，切口埋在躯干里 */
const BACK = 0.06;
/**
 * 大胸：胸后面在躯干外面的那一截切到哪（摆好以后的 z），切口倒多大的圆角（见下面「胸后面那一截」）。
 * 小胸（--small）不切：那个素体的胸廓和二次元素体差不多宽，胸本身就贴着胸口，切了只剩一个尖
 */
const SIDE = { z: 0.1, soft: 0.01, margin: 0.01 };
/**
 * 正中线往右的都不要（摆好以后的 x）：两个胸在正中挨着，底座的椭圆越过正中线，会带进右胸内侧的一条。
 * 左右两个胸都在时这一条正好叠在右胸里看不出来；只有一个胸（两个上半身挨着的那一侧放不下胸）或者手动挪开时，就是胸口上的几根碎片
 */
const MEDIAL = 0;


/** 距离精确算到离表面多远（米，摆好以后的大小）；再远的按这个数 */
const NEAR = 0.05;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function readObj(file: string): { verts: V3[]; tris: [number, number, number][] } {
  const verts: V3[] = [];
  const tris: [number, number, number][] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.trim().split(/\s+/);
      verts.push([+x, +y, +z]);
    } else if (line.startsWith('f ')) {
      const ids = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t.split('/')[0], 10) - 1);
      for (let k = 1; k + 1 < ids.length; k++) tris.push([ids[0], ids[k], ids[k + 1]]);
    }
  }
  return { verts, tris };
}

/** 点到三角形的距离的平方 */
function distance2(p: V3, a: V3, b: V3, c: V3): number {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  let q: V3;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const t = d1 / (d1 - d3);
        q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
      } else {
        const cp = sub(p, c);
        const d5 = dot(ab, cp);
        const d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const t = d2 / (d2 - d6);
            q = [a[0] + ac[0] * t, a[1] + ac[1] * t, a[2] + ac[2] * t];
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
              q = [b[0] + (c[0] - b[0]) * t, b[1] + (c[1] - b[1]) * t, b[2] + (c[2] - b[2]) * t];
            } else {
              const den = 1 / (va + vb + vc);
              const v = vb * den;
              const w = vc * den;
              q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
            }
          }
        }
      }
    }
  }
  return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
}

/**
 * 沿 axis 轴打射线数穿过几次：格子上每个点在网格里面吗。射线稍微错开一点（不正好擦过棱、顶点）
 */
function parity(verts: V3[], tris: [number, number, number][], points: (i: number) => V3, count: number, axis: number, columns: Map<string, number[]>): Uint8Array {
  const [u, v] = [0, 1, 2].filter((k) => k !== axis);
  const inside = new Uint8Array(count);
  // 只看投影下来和格子那一片重叠的三角形
  let [loU, hiU, loV, hiV] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const ids of columns.values()) {
    const p = points(ids[0]);
    [loU, hiU, loV, hiV] = [Math.min(loU, p[u]), Math.max(hiU, p[u]), Math.min(loV, p[v]), Math.max(hiV, p[v])];
  }
  tris = tris.filter((t) => {
    const us = t.map((id) => verts[id][u]);
    const vs = t.map((id) => verts[id][v]);
    return Math.max(...us) >= loU && Math.min(...us) <= hiU && Math.max(...vs) >= loV && Math.min(...vs) <= hiV;
  });
  // 每一列（u、v 一样的点）打一条射线，交点排好序
  const hits = new Map<string, number[]>();
  for (const [name, ids] of columns) {
    const p = points(ids[0]);
    const pu = p[u] + 1.234e-7;
    const pv = p[v] + 2.345e-7;
    const list: number[] = [];
    for (const t of tris) {
      const [a, b, c] = [verts[t[0]], verts[t[1]], verts[t[2]]];
      const minU = Math.min(a[u], b[u], c[u]);
      const maxU = Math.max(a[u], b[u], c[u]);
      const minV = Math.min(a[v], b[v], c[v]);
      const maxV = Math.max(a[v], b[v], c[v]);
      if (pu < minU || pu > maxU || pv < minV || pv > maxV) continue;
      // 投影到 u、v 平面上的重心坐标
      const den = (b[v] - c[v]) * (a[u] - c[u]) + (c[u] - b[u]) * (a[v] - c[v]);
      if (!den) continue;
      const l1 = ((b[v] - c[v]) * (pu - c[u]) + (c[u] - b[u]) * (pv - c[v])) / den;
      const l2 = ((c[v] - a[v]) * (pu - c[u]) + (a[u] - c[u]) * (pv - c[v])) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      list.push(l1 * a[axis] + l2 * b[axis] + l3 * c[axis]);
    }
    list.sort((x, y) => x - y);
    hits.set(name, list);
  }
  for (const [name, ids] of columns) {
    const list = hits.get(name)!;
    for (const id of ids) {
      const w = points(id)[axis];
      let n = 0;
      while (n < list.length && list[n] < w) n++;
      inside[id] = n % 2;
    }
  }
  return inside;
}

/** 离胸的底座那一圈（正中 c、半径 r 的椭圆，前后通到底）多远：里面是负的；椭圆的距离用近似，照两个半径里小的那个换算 */
function baseDistance(p: V3, c: [number, number], r: [number, number]): number {
  return (Math.hypot((p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1]) - 1) * Math.min(r[0], r[1]);
}

export function main(args: string[], root: string) {
  const reference = args.includes('--small');
  const SOURCE = reference ? 'assets/source/djp/DJP Anime Base Sculpt.obj' : 'assets/source/djp/DJP CC0 Free Base Mesh 01.obj';
  const NAME = reference ? 'bustReference' : 'bustLarge';
  // 胸调到 1.76 时（这一块照 animeLayout.ts 摆好、放大 1.76 倍）正好是那个素体的胸（照 SHRINK 缩过）原样大小，调到最大 2.2 再大四分之一
  const REF = reference ? 1 : 1.76;
  const meta = JSON.parse(readFileSync(join(root, META), 'utf8'));
  const bust = meta.grids.bust;
  const band: number = meta.band;
  let bin = readFileSync(join(root, BIN));
  // 二次元素体平胸的躯干（模型自己的坐标，和摆好以后的胸是同一个坐标）：照文件现在的样子登记（bodyMeta.json 是一起读进来的）
  installAnimeBody(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer);
  const flat = gridDist(getGrid(animeGrid('torsoFlat'))).fn;
  // 同尺寸原位替换，保留后面追加的形状，支持先后任意重建小胸/大胸。
  const old = meta.grids[NAME];
  const offset = old?.offset ?? bin.length / 2;
  const { verts, tris } = readObj(join(root, SOURCE));
  for (const p of verts) {
    const side = p[0] < 0 ? -1 : 1;
    const at: V3 = [SHRINK.at[0] * side, SHRINK.at[1], SHRINK.at[2]];
    const scale = reference ? 1 : SHRINK.k;
    const shift: V3 = reference ? [0, 0.03, -0.006] : OFFSET;
    for (let k = 0; k < 3; k++) p[k] = at[k] + (p[k] - at[k]) * scale + (k ? shift[k] : shift[0] * side);
    if (!reference) sag(p, side);
  }

  // 格子上第 i 个点摆好以后在哪：这一块（胸调到 REF 倍）的原点在 bust 的原点往身体里挪 PUSH·(REF − 1)
  const [nx, ny, nz] = bust.dims as [number, number, number];
  const origin: V3 = [bust.origin[0], bust.origin[1], bust.origin[2] - PUSH * (REF - 1)];
  const count = nx * ny * nz;
  const point = (i: number): V3 => {
    const kx = i % nx;
    const ky = Math.floor(i / nx) % ny;
    const kz = Math.floor(i / (nx * ny));
    return [0, 1, 2].map((k) => origin[k] + REF * (bust.min[k] + [kx, ky, kz][k] * bust.cell)) as V3;
  };
  const lo = point(0);
  const hi = point(count - 1);

  // 距离：只算离格子不远的那些三角形，每个三角形更新它周围 NEAR 以内的格点
  const step = REF * bust.cell;
  const near2 = new Float64Array(count).fill(NEAR * NEAR);
  const kept = tris.filter((t) => t.some((id) => verts[id].every((v, k) => v > lo[k] - NEAR && v < hi[k] + NEAR)));
  for (const t of kept) {
    const [a, b, c] = [verts[t[0]], verts[t[1]], verts[t[2]]];
    const from = [0, 1, 2].map((k) => Math.max(0, Math.floor((Math.min(a[k], b[k], c[k]) - NEAR - lo[k]) / step)));
    const to = [0, 1, 2].map((k) => Math.min(bust.dims[k] - 1, Math.ceil((Math.max(a[k], b[k], c[k]) + NEAR - lo[k]) / step)));
    for (let kz = from[2]; kz <= to[2]; kz++) {
      for (let ky = from[1]; ky <= to[1]; ky++) {
        for (let kx = from[0]; kx <= to[0]; kx++) {
          const id = kx + nx * (ky + ny * kz);
          const d = distance2(point(id), a, b, c);
          if (d < near2[id]) near2[id] = d;
        }
      }
    }
  }

  // 里外：沿三个轴各打一遍射线，三取二
  const votes = new Uint8Array(count);
  for (const axis of [0, 1, 2]) {
    const [u, v] = [0, 1, 2].filter((k) => k !== axis);
    const columns = new Map<string, number[]>();
    for (let id = 0; id < count; id++) {
      const p = point(id);
      const name = `${p[u].toFixed(5)},${p[v].toFixed(5)}`;
      (columns.get(name) ?? columns.set(name, []).get(name)!).push(id);
    }
    const inside = parity(verts, tris, point, count, axis, columns);
    for (let id = 0; id < count; id++) votes[id] += inside[id];
  }

  // 胸的底座：每一列（x、y 一样的格点）上，这个素体最前面在哪、平胸的躯干最前面在哪，凸出 FOOT.rise 以上的算胸
  let apex = verts[0];
  for (const p of verts) if (p[0] > 0.02 && p[1] > 0.9 && p[1] < 1.4 && p[2] > apex[2]) apex = p;
  const foot: [number, number][] = [];
  for (let ky = 0; ky < ny; ky++) {
    for (let kx = 0; kx < nx; kx++) {
      const top = point(kx + nx * (ky + ny * (nz - 1)));
      // 只看左胸这一边（右胸靠中间那一截也凸出来，算进来的话底座偏到正中、宽一倍）
      if (top[0] < 0.002 || Math.hypot(top[0] - apex[0], top[1] - apex[1]) > FOOT.reach) continue;
      let front = -Infinity;
      for (let kz = nz - 1; kz >= 0; kz--) {
        const id = kx + nx * (ky + ny * kz);
        if (votes[id] >= 2) {
          front = point(id)[2] + Math.sqrt(near2[id]);
          break;
        }
      }
      // 平胸的躯干：从前面往后一步步走到表面
      let z = top[2];
      for (let step = 0; step < 200; step++) {
        const d = flat(top[0], top[1], z);
        if (d < 1e-4) break;
        z -= d;
      }
      if (front - z > FOOT.rise) foot.push([top[0], top[1]]);
    }
  }
  const mean = [0, 1].map((k) => foot.reduce((sum, q) => sum + q[k], 0) / foot.length);
  const spread = [0, 1].map((k) => Math.sqrt(foot.reduce((sum, q) => sum + (q[k] - mean[k]) ** 2, 0) / foot.length));
  // 小胸的内侧会被目标胸壁遮住，按“凸出目标躯干”的面积拟合会把底座推向腋下并削窄。
  // 用原素材胸尖定位底座，保留原素材整个可见半球；只在隐藏的边缘沉入胸壁。
  const baseAt: [number, number] = reference ? [apex[0], apex[1]] : [mean[0], mean[1]];
  const baseR: [number, number] = reference ? [0.055, 0.07] : [2 * spread[0], 2 * spread[1]];

  // 每个高度上平胸躯干的侧面离中线最远多远（正面看的轮廓）：从外往里走到表面，前后取几处里最宽的
  const sides = new Map<number, number>();
  const sideAt = (y: number) => {
    const key = Math.round(y * 1000);
    let far = sides.get(key);
    if (far === undefined) {
      far = 0;
      for (let z = -0.08; z <= 0.12; z += 0.01) {
        let x = 0.4;
        for (let step = 0; step < 200; step++) {
          const d = flat(x, y, z);
          if (d < 1e-4 || x < 0) break;
          x -= Math.max(d, 1e-3);
        }
        if (x > far) far = x;
      }
      sides.set(key, far);
    }
    return far;
  };

  // 底座以外往里压，和底座、胸壁往后那一刀圆滑地取交集
  const field = new Float64Array(count);
  for (let id = 0; id < count; id++) {
    const p = point(id);
    // 底座以外往里压（见 SINK）
    const e = Math.hypot((p[0] - baseAt[0]) / baseR[0], (p[1] - baseAt[1]) / baseR[1]);
    const t = Math.min(1, Math.max(0, (e - SINK.from) / (SINK.to - SINK.from)));
    const sink = SINK.depth * t * t * (3 - 2 * t);
    // 胸后面那一截（比 SIDE.z 靠后的），在二次元素体平胸的躯干外面的都不要：这个素体的胸廓宽，胸后面连着它自己的胸侧、腋下，
    // 留着的话一直伸到二次元素体的侧面外面，背面那一刀（BACK）切出来的平面露在外面，像一块板子。往前凸出来的胸本身不管（胸侧可以比躯干宽）
    const plain = flat(p[0], p[1], p[2]);
    // 只切躯干侧面以外的（离中线比这个高度上平胸躯干的侧面还远、往里 SIDE.margin）：胸根正前方、胸和胸口之间那一层不能切
    const behind = reference ? -Infinity : Math.min(plain, SIDE.z - p[2], p[0] - (sideAt(p[1]) - SIDE.margin));
    const g = Math.max(SIDE.soft - Math.abs(behind - (Math.sqrt(near2[id]) * (votes[id] >= 2 ? -1 : 1) + sink)), 0) / SIDE.soft;
    const surface = Math.max(Math.sqrt(near2[id]) * (votes[id] >= 2 ? -1 : 1) + sink, behind) + (g * g * SIDE.soft) / 4;
    const base = Math.max(baseDistance(p, baseAt, [baseR[0] * SINK.out, baseR[1] * SINK.out]), BACK - p[2], MEDIAL - p[0]);
    const k = FOOT.soft;
    const h = Math.max(k - Math.abs(surface - base), 0) / k;
    field[id] = Math.max(surface, base) + (h * h * k) / 4;
  }
  // 换算成这一块自己的大小，存成 16 位
  const data = new Int16Array(count);
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  let inside = 0;
  for (let id = 0; id < count; id++) {
    const local = field[id] / REF;
    data[id] = Math.round((Math.max(-band, Math.min(band, local)) / band) * 32767);
    if (local < 0) {
      inside++;
      const kx = id % nx;
      const ky = Math.floor(id / nx) % ny;
      const kz = Math.floor(id / (nx * ny));
      [kx, ky, kz].forEach((g, k) => {
        const at = bust.min[k] + g * bust.cell;
        min[k] = Math.min(min[k], at - bust.cell);
        max[k] = Math.max(max[k], at + bust.cell);
      });
    }
  }
  // 胸挨着格子的边了：说明 REF 太小、或者挪得不对，胸被格子的边切掉了一截
  for (const [k, edge] of [0, 1, 2].flatMap((k) => [[k, bust.min[k] + bust.cell], [k, bust.min[k] + (bust.dims[k] - 2) * bust.cell]])) {
    if (Math.abs(min[k] + bust.cell - edge) < 1e-9 || Math.abs(max[k] - bust.cell - edge) < 1e-9) console.warn(`胸碰到格子的边了（第 ${k} 个轴）`);
  }

  meta.grids[NAME] = {
    origin: bust.origin,
    min: bust.min,
    dims: bust.dims,
    cell: bust.cell,
    bounds: { min: min.map((v) => +v.toFixed(5)), max: max.map((v) => +v.toFixed(5)) },
    caps: bust.caps,
    offset,
    length: count,
  };
  meta[reference ? 'bustReferenceSource' : 'bustLargeSource'] = `Death Joe Productions, ${SOURCE.split('/').pop()}. CC0. Original visible breast surface; only hidden root adapted.`;
  if (old && old.length !== count) throw new Error('重建形状的格子大小改变，不能原位替换');
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  writeFileSync(join(root, BIN), old ? Buffer.concat([bin.subarray(0, offset * 2), bytes, bin.subarray((offset + count) * 2)]) : Buffer.concat([bin, bytes]));
  writeFileSync(join(root, META), `${JSON.stringify(meta, null, 1)}\n`);
  console.log(`胸的底座：正中 (${baseAt.map((v) => v.toFixed(3)).join(', ')})，半径 ${baseR.map((v) => v.toFixed(3)).join(' × ')}；保留原素材胸尖；用到 ${kept.length} 个三角形；格子 ${bust.dims.join('×')}，里面 ${inside} 个点；写进 ${BIN}、${META}`);
}
