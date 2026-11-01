// 二次元素体的胸（见 src/anime/chest.ts、docs/rework-plan.md）：从参考模型上采胸的格子，连同平胸躯干的展开图写进 body.bin。
//   node tools/run.mjs tools/build-chest.ts --write        写进 public/anime/body.bin、src/anime/bodyMeta.json
//   node tools/run.mjs tools/build-chest.ts <输出目录>     不写，出滑块各个大小的渲染图、剖面看看
//   node tools/run.mjs tools/build-chest.ts <输出目录> --debug   只出展开图上胸那一片的调试图
// 重新跑 tools/build-anime-body.mjs（重写整个 body.bin）、tools/build-torso.ts 以后要再跑一遍 --write。
//
// 1. 素体的平胸躯干按「高度 × 绕竖轴的角度」展开：每个高度上前后正中、往各个角度量到表面的半径、沿截面从正中线量过去的弧长。
// 2. 参考模型（DJP Sculpt 的中胸、DJP 01 的大胸，都是 CC0）照素体的躯干长短（裆到腋下）等比缩放、腋下对齐；
//    再算它「把胸抹平」的样子：胸那一片（往外扩一厘米）的半径照边上的原样用双调和插值补平，以外照原样。
//    在它自己的 u（沿表面离正中线多远）、v（多高）、h（离抹平的表面往外多远）里把它原样（距离场）采成一块格子——
//    胸根的过渡、胸底和肚子之间的缝都在里面。
// 3. 贴到素体上、大小怎么随滑块变，都在 src/anime/chest.ts 里（这里出的预览图用的也是它）。
// 两种胸型在滑块上算多大（NATURAL）是第 2 期照体积和以前的做法对齐定下来的（以前的做法已经拆掉了，量不了了）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { animeGrid, installAnimeBody } from '../src/anime/body';
import { type ChestFrame, type ChestKind, type ChestPatch, angleAt, lookup, registerChest, zcOf } from '../src/anime/chest';
import type { ChestShape } from '../src/geometry/figure';
import { chestDist, getGrid, gridDist } from '../src/sdf/grids';
import { type V3, png, render } from './softRender';

const BIN = 'public/anime/body.bin';
const META = 'src/anime/bodyMeta.json';
/** 两种胸型原样大小时在滑块上算多少 */
const NATURAL: Record<ChestKind, number> = { reference: 1.1, large: 1.63 };
/** 展开图存成 16 位整数时一格代表多少米 */
const FRAME_UNIT = 2e-5;

/* ---------------- 展开图的范围 ---------------- */

/** 高度从 Y0 到 Y1（素体的坐标），每 DY 一行 */
const Y0 = 0.84;
const Y1 = 1.36;
const DY = 0.002;
const ROWS = Math.round((Y1 - Y0) / DY) + 1;
/** 半圈（正前方到正后方，往 +X 那边），每度一列；另一边照镜像 */
const COLS = 181;
const DA = Math.PI / (COLS - 1);

/** 胸的格子：每格多大（米），离表面往里、往外各采到多远 */
const CELL = 0.0025;
const H_IN = 0.025;
/** 距离算到多远为止（再远的按这个数） */
const BAND = 0.04;
/** 补平时胸那一片往外扩几格（每格 2 毫米上下） */
const DILATE = 5;
/** 调试图（展开图上凸出多少、胸那一片） */
let DEBUG: Uint8Array[] | null = null;

/** 一个躯干的展开（见 ChestFrame），再加上腋下、裆多高（对齐参考模型用） */
export interface Frame extends ChestFrame {
  armpit: number;
  crotch: number;
}

const GRID = { y0: Y0, dy: DY, rows: ROWS, cols: COLS };

/** 照半径图把弧长算出来 */
function arcs(r: Float64Array): Float64Array {
  const s = new Float64Array(ROWS * COLS);
  for (let i = 0; i < ROWS; i++) {
    for (let j = 1; j < COLS; j++) {
      const a = r[i * COLS + j - 1];
      const b = r[i * COLS + j];
      s[i * COLS + j] = s[i * COLS + j - 1] + Math.hypot(((a + b) / 2) * DA, b - a);
    }
  }
  return s;
}

function smooth1(list: Float64Array, sigma: number): Float64Array {
  const k = Math.ceil(sigma * 3);
  return list.map((_, i) => {
    let s = 0;
    let w = 0;
    for (let d = -k; d <= k; d++) {
      const v = list[i + d];
      if (v === undefined || Number.isNaN(v)) continue;
      const g = Math.exp(-(d * d) / (2 * sigma * sigma));
      s += v * g;
      w += g;
    }
    return w ? s / w : NaN;
  });
}

/* ---------------- 素体：在平胸躯干的距离场上量 ---------------- */

export function vroidFrame(flat: (x: number, y: number, z: number) => number): Frame {
  const march = (y: number, cz: number, dx: number, dz: number): number => {
    if (flat(0, y, cz) > 0) return NaN;
    let t = 0;
    while (t < 0.4 && flat(dx * t, y, cz + dz * t) < 0) t += 0.002;
    if (t >= 0.4) return NaN;
    let lo = t - 0.002;
    let hi = t;
    for (let k = 0; k < 18; k++) {
      const m = (lo + hi) / 2;
      if (flat(dx * m, y, cz + dz * m) < 0) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  const zc = new Float64Array(ROWS);
  const half = new Float64Array(ROWS);
  for (let i = 0; i < ROWS; i++) {
    const y = Y0 + i * DY;
    let cz = 0.01;
    for (let k = 0; k < 4; k++) {
      const f = march(y, cz, 0, 1);
      const b = march(y, cz, 0, -1);
      if (!Number.isFinite(f) || !Number.isFinite(b)) break;
      cz += (f - b) / 2;
    }
    zc[i] = cz;
    half[i] = march(y, cz, 1, 0);
  }
  const zs = smooth1(zc, 0.01 / DY);
  const r = new Float64Array(ROWS * COLS);
  for (let i = 0; i < ROWS; i++) {
    const y = Y0 + i * DY;
    for (let j = 0; j < COLS; j++) r[i * COLS + j] = march(y, zs[i], Math.sin(j * DA), Math.cos(j * DA));
  }
  // 裆：中心从这里往上都在身体里；腋下：腰往上半宽最大的地方（素体的躯干在肩关节那里切开，量不到手臂接上来）
  let crotch = 0.6;
  for (let y = 0.6; y < 1; y += 0.002) {
    let solid = true;
    for (let d = 0; d <= 0.05 && solid; d += 0.005) solid = flat(0, y + d, 0) < 0;
    if (solid) {
      crotch = y;
      break;
    }
  }
  let armpit = 1.2;
  let best = 0;
  for (let i = 0; i < ROWS; i++) {
    const y = Y0 + i * DY;
    if (y > 1.05 && y < 1.27 && half[i] > best) [best, armpit] = [half[i], y];
  }
  return { ...GRID, zc: zs, r: fillHoles(r), s: arcs(fillHoles(r)), armpit, crotch };
}

/** 半径图里量不到的格子（NaN）照同一列上下的补上 */
function fillHoles(r: Float64Array): Float64Array {
  const out = r.slice();
  for (let j = 0; j < COLS; j++) {
    let last = NaN;
    for (let i = 0; i < ROWS; i++) {
      const v = out[i * COLS + j];
      if (Number.isNaN(v)) out[i * COLS + j] = last;
      else last = v;
    }
    last = NaN;
    for (let i = ROWS - 1; i >= 0; i--) {
      const v = out[i * COLS + j];
      if (Number.isNaN(v)) out[i * COLS + j] = last;
      else last = v;
    }
  }
  return out;
}

/* ---------------- 参考模型 ---------------- */

interface Mesh {
  v: Float64Array;
  t: Uint32Array;
}

/** 读 OBJ，只留最大的那一块（眼睛、牙齿这些小块不要），脚底在 0、左右居中 */
function readObj(file: string): Mesh {
  const vs: number[] = [];
  const ts: number[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.trim().split(/\s+/);
      vs.push(+x, +y, +z);
    } else if (line.startsWith('f ')) {
      const ids = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t.split('/')[0], 10) - 1);
      for (let k = 1; k + 1 < ids.length; k++) ts.push(ids[0], ids[k], ids[k + 1]);
    }
  }
  const n = vs.length / 3;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  for (let f = 0; f < ts.length; f += 3) {
    const a = find(ts[f]);
    parent[find(ts[f + 1])] = a;
    parent[find(ts[f + 2])] = a;
  }
  const count = new Map<number, number>();
  for (let f = 0; f < ts.length; f += 3) count.set(find(ts[f]), (count.get(find(ts[f])) ?? 0) + 1);
  const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const kept = ts.filter((_, k) => find(ts[k - (k % 3)]) === main);
  let lo = Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, vs[i * 3 + 1]);
    minX = Math.min(minX, vs[i * 3]);
    maxX = Math.max(maxX, vs[i * 3]);
  }
  const cx = (minX + maxX) / 2;
  for (let i = 0; i < n; i++) {
    vs[i * 3] -= cx;
    vs[i * 3 + 1] -= lo;
  }
  return { v: Float64Array.from(vs), t: Uint32Array.from(kept) };
}

/** 一个高度上的截面线段（x0, z0, x1, z1） */
function slicer(m: Mesh): (y: number) => Float64Array {
  const buckets = new Map<number, number[]>();
  for (let f = 0; f < m.t.length; f += 3) {
    const ys = [m.v[m.t[f] * 3 + 1], m.v[m.t[f + 1] * 3 + 1], m.v[m.t[f + 2] * 3 + 1]];
    for (let b = Math.floor(Math.min(...ys) / 0.01); b <= Math.floor(Math.max(...ys) / 0.01); b++) (buckets.get(b) ?? buckets.set(b, []).get(b)!).push(f);
  }
  return (y) => {
    const out: number[] = [];
    for (const f of buckets.get(Math.floor(y / 0.01)) ?? []) {
      const p: number[] = [];
      for (let e = 0; e < 3; e++) {
        const a = m.t[f + e] * 3;
        const b = m.t[f + ((e + 1) % 3)] * 3;
        const ya = m.v[a + 1] - y;
        const yb = m.v[b + 1] - y;
        if (ya < 0 === yb < 0) continue;
        const s = ya / (ya - yb);
        p.push(m.v[a] + (m.v[b] - m.v[a]) * s, m.v[a + 2] + (m.v[b + 2] - m.v[a + 2]) * s);
      }
      if (p.length === 4) out.push(...p);
    }
    return Float64Array.from(out);
  };
}

/** 截面上从 (0, cz) 沿 (dx, dz) 最近的交点多远 */
function rayOut(segs: Float64Array, cz: number, dx: number, dz: number): number {
  let best = Infinity;
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i];
    const az = segs[i + 1] - cz;
    const ex = segs[i + 2] - segs[i];
    const ez = segs[i + 3] - segs[i + 1];
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (ax * ez - az * ex) / den;
    const u = (ax * dz - az * dx) / den;
    if (t > 1e-6 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best === Infinity ? NaN : best;
}

/** 截面上从 (0, cz) 沿 (dx, dz) 最远的交点多远（40 厘米以内）：胸往下坠、底下空着一道缝时，最近的交点是肚子，最远的才是胸 */
function rayFar(segs: Float64Array, cz: number, dx: number, dz: number): number {
  let best = -Infinity;
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i];
    const az = segs[i + 1] - cz;
    const ex = segs[i + 2] - segs[i];
    const ez = segs[i + 3] - segs[i + 1];
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (ax * ez - az * ex) / den;
    const u = (ax * dz - az * dx) / den;
    if (t > 1e-6 && t < 0.4 && u >= 0 && u <= 1 && t > best) best = t;
  }
  return best === -Infinity ? NaN : best;
}

/** 参考模型的裆、腋下（往上半宽一下子跳出去：手臂接上了） */
function refMarks(slice: (y: number) => Float64Array, top: number): { crotch: number; armpit: number } {
  const ys: number[] = [];
  const half: number[] = [];
  const solid: boolean[] = [];
  let cz = 0;
  for (let y = top * 0.3; y < top * 0.95; y += 0.002) {
    const segs = slice(y);
    const f = rayOut(segs, cz, 0, 1);
    const b = rayOut(segs, cz, 0, -1);
    if (Number.isFinite(f) && Number.isFinite(b)) cz += (f - b) / 2;
    ys.push(y);
    solid.push(Number.isFinite(f) && Number.isFinite(b));
    half.push(rayOut(segs, cz, 1, 0));
  }
  let c = 0;
  for (let i = 0; i + 25 < ys.length; i++) {
    let ok = true;
    for (let k = i; k <= i + 25 && ok; k++) ok = solid[k];
    if (ok) {
      c = i;
      break;
    }
  }
  let a = ys.length - 1;
  for (let i = c + 50; i + 4 < ys.length; i++) {
    if (half[i + 4] > half[i] * 1.25 + 0.01) {
      a = i;
      break;
    }
  }
  return { crotch: ys[c], armpit: ys[a] };
}

/** 照对齐（等比缩放 + 平移）摆好的参考模型，和它的展开（没抹平的、抹平的） */
export interface Reference {
  name: string;
  mesh: Mesh;
  frame: Frame;
  raw: Float64Array;
  /** 胸那一片：(u, v) 的椭圆（v 是高度） */
  breast: { u: number; v: number; ru: number; rv: number };
}

/**
 * 读参考模型、摆到素体上：照「裆到腋下」的长短等比缩放，腋下对齐素体的腋下，前后照胸口正中的前后中心对齐。
 * scale、lift 是在这之上再调的（胸偏大偏高时用）
 */
export function loadReference(name: string, file: string, target: Frame, tune: { scale: number; lift: number }): Reference {
  const mesh = readObj(file);
  let top = 0;
  for (let i = 1; i < mesh.v.length; i += 3) top = Math.max(top, mesh.v[i]);
  const marks = refMarks(slicer(mesh), top);
  const s = ((target.armpit - target.crotch) / (marks.armpit - marks.crotch)) * tune.scale;
  const dy = target.armpit - marks.armpit * s + tune.lift;
  for (let i = 0; i < mesh.v.length; i += 3) {
    mesh.v[i] *= s;
    mesh.v[i + 1] = mesh.v[i + 1] * s + dy;
    mesh.v[i + 2] *= s;
  }
  const slice = slicer(mesh);
  // 前后中心照后背量（后背到中心 = 素体那一行的后背到中心）：照前后正中量的话，胸会把前面顶出去、中心跟着往前挪
  // 后背：这一行的截面和正中线（x = 0）的交点里最靠后的那个（从某一点往后打射线的话，起点可能已经在身体后面）
  const zs = new Float64Array(ROWS);
  for (let i = 0; i < ROWS; i++) {
    const segs = slice(Y0 + i * DY);
    let back = Infinity;
    for (let k = 0; k < segs.length; k += 4) {
      const x0 = segs[k];
      const x1 = segs[k + 2];
      if (x0 < 0 === x1 < 0 || x0 === x1) continue;
      back = Math.min(back, segs[k + 1] + ((segs[k + 3] - segs[k + 1]) * x0) / (x0 - x1));
    }
    zs[i] = Number.isFinite(back) ? back + target.r[i * COLS + COLS - 1] : NaN;
  }
  const zcs = smooth1(zs, 0.015 / DY);
  const raw = new Float64Array(ROWS * COLS);
  const far = new Float64Array(ROWS * COLS);
  for (let i = 0; i < ROWS; i++) {
    const segs = slice(Y0 + i * DY);
    for (let j = 0; j < COLS; j++) {
      raw[i * COLS + j] = rayOut(segs, zcs[i], Math.sin(j * DA), Math.cos(j * DA));
      far[i * COLS + j] = rayFar(segs, zcs[i], Math.sin(j * DA), Math.cos(j * DA));
    }
  }
  const filled = fillHoles(raw);
  const flatR = flatten(filled, fillHoles(far), target);
  const frame: Frame = { ...GRID, zc: zcs, r: flatR.r, s: arcs(flatR.r), armpit: target.armpit, crotch: target.crotch };
  console.log(`${name}：缩放 ${s.toFixed(3)}，腋下 ${marks.armpit.toFixed(3)} → ${target.armpit.toFixed(3)}，胸那一片 u ${flatR.breast.u.toFixed(3)}±${flatR.breast.ru.toFixed(3)} v ${flatR.breast.v.toFixed(3)}±${flatR.breast.rv.toFixed(3)}`);
  return { name, mesh, frame, raw: fillHoles(far), breast: flatR.breast };
}

/**
 * 「把胸抹平」：先给正面（0–88°）、胸口那几行的半径拟合一个光滑曲面（照角度、高度的四次多项式，凸出去的点一轮轮剔掉）。
 * 胸：最远的交点凸出这个曲面最多的那一格（胸尖）往外，凸出得够多、连成一片的格子。
 * 胸那一片往外扩一点，里面照边上的原样用双调和插值补平；以外照原样。
 * （用拟合的曲面直接换的话，它在侧面比真实表面鼓，换进去的那一圈表面压出一道沟）
 */
function flatten(r: Float64Array, far: Float64Array, target: Frame): { r: Float64Array; breast: Reference['breast'] } {
  const iLo = Math.round((target.armpit - 0.26 - Y0) / DY);
  const iHi = Math.round((target.armpit + 0.06 - Y0) / DY);
  // 侧面 88° 往后的不拟合：那里往外打的射线会碰到垂着的手臂
  const jHi = Math.round((88 * Math.PI) / 180 / DA);
  const basis = (a: number, y: number) => {
    const t = a - 0.6;
    const v = (y - target.armpit + 0.1) * 5;
    const out: number[] = [];
    for (let p = 0; p <= 4; p++) for (let q = 0; q <= 4 - p; q++) out.push(t ** p * v ** q);
    return out;
  };
  const pts: { a: number; y: number; r: number; on: boolean }[] = [];
  for (let i = iLo; i <= iHi; i++) for (let j = 0; j <= jHi; j++) pts.push({ a: j * DA, y: Y0 + i * DY, r: r[i * COLS + j], on: true });
  let coef: number[] = [];
  for (let round = 0; round < 8; round++) {
    coef = leastSquares(pts.filter((p) => p.on).map((p) => basis(p.a, p.y)), pts.filter((p) => p.on).map((p) => p.r));
    for (const p of pts) p.on = p.r - dotv(basis(p.a, p.y), coef) < 0.003;
  }
  const fit = (a: number, y: number) => dotv(basis(a, y), coef);
  const rise = (i: number, j: number) => far[i * COLS + j] - fit(j * DA, Y0 + i * DY);
  // 胸尖：腋下往下 1–20 厘米、5–70° 里凸出最多的那一格；从它往外连成一片
  let seed = [0, 0];
  let most = -Infinity;
  for (let i = Math.round((target.armpit - 0.2 - Y0) / DY); i <= Math.round((target.armpit - 0.01 - Y0) / DY); i++) {
    for (let j = 5; j <= 70; j++) if (rise(i, j) > most) [most, seed] = [rise(i, j), [i, j]];
  }
  // 连片只在胸尖周围（往上 10 厘米、往下 16 厘米、80° 以内）找，凸出胸尖的 12% 以上才算（最少 4 毫米）：
  // 胸上方的上胸、锁骨也比拟合的曲面凸出几毫米，门槛低了会一路连过去
  const jMax = Math.round((80 * Math.PI) / 180 / DA);
  const rowLo = Math.max(iLo, seed[0] - Math.round(0.16 / DY));
  const rowHi = Math.min(iHi, seed[0] + Math.round(0.1 / DY));
  const floor = Math.max(0.004, most * 0.12);
  const inMask = new Uint8Array(ROWS * COLS);
  const stack = [seed];
  inMask[seed[0] * COLS + seed[1]] = 1;
  while (stack.length) {
    const [i, j] = stack.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < rowLo || ii > rowHi || jj < 0 || jj > jMax || inMask[ii * COLS + jj]) continue;
      if (rise(ii, jj) < floor) continue;
      inMask[ii * COLS + jj] = 1;
      stack.push([ii, jj]);
    }
  }
  // 补平的范围：胸那一片往外再扩 1 厘米（DILATE 格）；以外照原样
  const fill = inMask.slice();
  for (let pass = 0; pass < DILATE; pass++) {
    const next = fill.slice();
    for (let i = iLo; i <= iHi; i++) {
      for (let j = 0; j <= jMax; j++) {
        if (fill[i * COLS + j]) continue;
        if (fill[(i - 1) * COLS + j] || fill[(i + 1) * COLS + j] || fill[i * COLS + j + 1] || (j > 0 && fill[i * COLS + j - 1])) next[i * COLS + j] = 1;
      }
    }
    fill.set(next);
  }
  // 双调和插值（边上两圈照原样，里面 Δ²r = 0，表面在边上连斜率都接得上）：先拿拟合的曲面当初值，高斯-赛德尔迭代。
  // 正中线左右对称（j = -1 就是 j = 1）
  const out = r.slice();
  const cells: number[] = [];
  for (let i = iLo; i <= iHi; i++) for (let j = 0; j <= jMax; j++) if (fill[i * COLS + j]) cells.push(i * COLS + j), (out[i * COLS + j] = fit(j * DA, Y0 + i * DY));
  const at = (i: number, j: number) => out[i * COLS + Math.abs(j)];
  for (let it = 0; it < 3000; it++) {
    for (const k of cells) {
      const i = Math.floor(k / COLS);
      const j = k % COLS;
      const near = at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1);
      const diag = at(i - 1, j - 1) + at(i - 1, j + 1) + at(i + 1, j - 1) + at(i + 1, j + 1);
      const far2 = at(i - 2, j) + at(i + 2, j) + at(i, j - 2) + at(i, j + 2);
      out[k] = (8 * near - 2 * diag - far2) / 20;
    }
  }
  // 胸那一片的椭圆：补平范围的重心（照凸出多少加权）和范围，弧长在补平的面上量（和贴的时候用的一样）
  const s = arcs(out);
  let w0 = 0;
  let su = 0;
  let sv = 0;
  for (let i = iLo; i <= iHi; i++) {
    for (let j = 0; j <= jMax; j++) {
      if (!inMask[i * COLS + j]) continue;
      const w = rise(i, j);
      su += s[i * COLS + j] * w;
      sv += (Y0 + i * DY) * w;
      w0 += w;
    }
  }
  const u = su / w0;
  const v = sv / w0;
  let ru = 0;
  let rv = 0;
  for (let i = iLo; i <= iHi; i++) {
    for (let j = 0; j <= jMax; j++) {
      if (!fill[i * COLS + j]) continue;
      ru = Math.max(ru, Math.abs(s[i * COLS + j] - u));
      rv = Math.max(rv, Math.abs(Y0 + i * DY - v));
    }
  }
  const breast = { u, v, ru: ru * 1.05, rv: rv * 1.05 };
  if (DEBUG) {
    // 调试：凸出多少（灰度，0–8 厘米）、胸那一片（红）、补平的范围（淡红）
    const img = new Uint8Array(ROWS * COLS * 3);
    for (let i = 0; i < ROWS; i++) {
      for (let j = 0; j < COLS; j++) {
        const g = Math.max(0, Math.min(255, Math.round((rise(i, j) / 0.08) * 255)));
        const o = ((ROWS - 1 - i) * COLS + j) * 3;
        img.set(inMask[i * COLS + j] ? [255, g >> 1, g >> 1] : fill[i * COLS + j] ? [255, 170, 170] : [g, g, g], o);
      }
    }
    DEBUG.push(img);
  }
  return { r: out, breast };
}

const dotv = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);


function leastSquares(rows: number[][], rhs: number[]): number[] {
  const m = rows[0].length;
  const A = Array.from({ length: m }, () => new Float64Array(m + 1));
  rows.forEach((row, k) => {
    for (let p = 0; p < m; p++) {
      for (let q = 0; q < m; q++) A[p][q] += row[p] * row[q];
      A[p][m] += row[p] * rhs[k];
    }
  });
  for (let p = 0; p < m; p++) A[p][p] += 1e-9;
  for (let c = 0; c < m; c++) {
    let piv = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let q = c; q <= m; q++) A[r][q] -= f * A[c][q];
    }
  }
  return A.map((row, p) => row[m] / row[p]);
}

/* ---------------- 参考模型的距离场 ---------------- */

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 点到三角形最近点的距离平方 */
function distance2(p: V3, a: V3, b: V3, c: V3): number {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return dot(ap, ap);
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return dot(bp, bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    const q = sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
    return dot(q, q);
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return dot(cp, cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    const q = sub(p, [a[0] + ac[0] * t, a[1] + ac[1] * t, a[2] + ac[2] * t]);
    return dot(q, q);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
    const q = sub(p, [b[0] + (c[0] - b[0]) * t, b[1] + (c[1] - b[1]) * t, b[2] + (c[2] - b[2]) * t]);
    return dot(q, q);
  }
  const den = 1 / (va + vb + vc);
  const v = vb * den;
  const w = vc * den;
  const q = sub(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
  return dot(q, q);
}

/**
 * 网格的距离场：正负照往 +Z 打射线穿过几次（整块网格是封闭的），距离照最近的三角形算。
 * arm 说是手臂的三角形（重心）不算：垂着的手臂离大胸外侧近，算进来的话胸的格子边上带着一片手臂。
 * 去掉手臂以后肩膀那一圈不再封闭，那里的正负可能不对，好在离胸远
 */
export function meshSdf(m: Mesh, arm: (x: number, y: number, z: number) => boolean = () => false): (p: V3) => number {
  const P = (i: number): V3 => [m.v[i * 3], m.v[i * 3 + 1], m.v[i * 3 + 2]];
  const C2 = 0.005;
  const cols = new Map<number, number[]>();
  const key2 = (ix: number, iy: number) => ix * 100003 + iy;
  const C3 = 0.01;
  const cells = new Map<number, number[]>();
  const key3 = (ix: number, iy: number, iz: number) => (ix * 1009 + iy) * 1009 + iz;
  for (let f = 0; f < m.t.length; f += 3) {
    const a = P(m.t[f]);
    const b = P(m.t[f + 1]);
    const c = P(m.t[f + 2]);
    const lo = [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2])];
    const hi = [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])];
    if (arm((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3)) continue;
    for (let ix = Math.floor(lo[0] / C2); ix <= Math.floor(hi[0] / C2); ix++)
      for (let iy = Math.floor(lo[1] / C2); iy <= Math.floor(hi[1] / C2); iy++) (cols.get(key2(ix, iy)) ?? cols.set(key2(ix, iy), []).get(key2(ix, iy))!).push(f);
    for (let ix = Math.floor(lo[0] / C3); ix <= Math.floor(hi[0] / C3); ix++)
      for (let iy = Math.floor(lo[1] / C3); iy <= Math.floor(hi[1] / C3); iy++)
        for (let iz = Math.floor(lo[2] / C3); iz <= Math.floor(hi[2] / C3); iz++) (cells.get(key3(ix + 500, iy, iz + 500)) ?? cells.set(key3(ix + 500, iy, iz + 500), []).get(key3(ix + 500, iy, iz + 500))!).push(f);
  }
  const stamp = new Int32Array(m.t.length / 3);
  let tick = 0;
  return (p) => {
    // 正负
    const px = p[0] + 1.234e-7;
    const py = p[1] + 2.345e-7;
    let crossings = 0;
    for (const f of cols.get(key2(Math.floor(px / C2), Math.floor(py / C2))) ?? []) {
      const a = P(m.t[f]);
      const b = P(m.t[f + 1]);
      const c = P(m.t[f + 2]);
      const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (!den) continue;
      const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den;
      const l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      if (l1 * a[2] + l2 * b[2] + l3 * c[2] > p[2]) crossings++;
    }
    const sign = crossings % 2 ? -1 : 1;
    // 距离：一圈圈往外找
    tick++;
    let best = BAND * BAND;
    const cx = Math.floor(p[0] / C3) + 500;
    const cy = Math.floor(p[1] / C3);
    const cz = Math.floor(p[2] / C3) + 500;
    const rings = Math.ceil(BAND / C3) + 1;
    for (let ring = 0; ring <= rings; ring++) {
      for (let ix = cx - ring; ix <= cx + ring; ix++) {
        for (let iy = cy - ring; iy <= cy + ring; iy++) {
          for (let iz = cz - ring; iz <= cz + ring; iz++) {
            if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy), Math.abs(iz - cz)) !== ring) continue;
            for (const f of cells.get(key3(ix, iy, iz)) ?? []) {
              if (stamp[f / 3] === tick) continue;
              stamp[f / 3] = tick;
              const d = distance2(p, P(m.t[f]), P(m.t[f + 1]), P(m.t[f + 2]));
              if (d < best) best = d;
            }
          }
        }
      }
      if (best <= (ring * C3) ** 2) break;
    }
    return sign * Math.sqrt(best);
  };
}

/* ---------------- 胸的格子 ---------------- */

/**
 * 一块胸：在 (u, v, h) 上采的距离场。u 从正中线量（0 到 nu 格），v 是高度减去 v0，h 从 -H_IN 往外。
 * center 是胸的中心（u、v），放大缩小照它
 */
export interface Patch {
  name: string;
  nu: number;
  nv: number;
  nh: number;
  v0: number;
  data: Float32Array;
  center: [number, number];
  /** 胸那一片的椭圆，出了它（放大 1.35 倍）就和平胸一样 */
  ru: number;
  rv: number;
}

export function samplePatch(name: string, frame: Frame, breast: Reference['breast'], sdf: (p: V3) => number, top: number): Patch {
  const uMax = breast.u + breast.ru * 1.4;
  const v0 = breast.v - breast.rv * 1.4;
  const v1 = breast.v + breast.rv * 1.4;
  const nu = Math.ceil(uMax / CELL) + 1;
  const nv = Math.ceil((v1 - v0) / CELL) + 1;
  const nh = Math.ceil((H_IN + top) / CELL) + 1;
  const data = new Float32Array(nu * nv * nh);
  const t0 = performance.now();
  for (let iv = 0; iv < nv; iv++) {
    const y = v0 + iv * CELL;
    const zc = zcOf(frame, y);
    for (let iu = 0; iu < nu; iu++) {
      const a = angleAt(frame, y, iu * CELL);
      const r0 = lookup(frame, frame.r, y, a);
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      for (let ih = 0; ih < nh; ih++) {
        const r = r0 - H_IN + ih * CELL;
        data[(ih * nv + iv) * nu + iu] = sdf([r * sa, y, zc + r * ca]);
      }
    }
  }
  console.log(`${name}：胸的格子 ${nu}×${nv}×${nh}，${Math.round(performance.now() - t0)} ms，堵掉的小气泡 ${closePockets(data, nu, nv, nh)} 格`);
  return { name, nu, nv, nh, v0, data, center: [breast.u, breast.v], ru: breast.ru, rv: breast.rv };
}

/**
 * 胸底的缝收到缝尖比一格还窄，那里的格子正负交替，插值出来是一串小气泡（网格上是身体里一个个小空泡）。
 * 从格子外面几个面（正中线那面除外，那面左右镜像）的空气往里连，连不到的空气格算身体里，改成刚好在里面
 */
function closePockets(data: Float32Array, nu: number, nv: number, nh: number): number {
  const seen = new Uint8Array(data.length);
  const stack: number[] = [];
  const idx = (iu: number, iv: number, ih: number) => (ih * nv + iv) * nu + iu;
  const push = (k: number) => {
    if (seen[k] || data[k] < 0) return;
    seen[k] = 1;
    stack.push(k);
  };
  for (let ih = 0; ih < nh; ih++) {
    for (let iv = 0; iv < nv; iv++) {
      for (let iu = 0; iu < nu; iu++) if (iu === nu - 1 || iv === 0 || iv === nv - 1 || ih === 0 || ih === nh - 1) push(idx(iu, iv, ih));
    }
  }
  while (stack.length) {
    const k = stack.pop()!;
    const iu = k % nu;
    const iv = Math.floor(k / nu) % nv;
    const ih = Math.floor(k / (nu * nv));
    if (iu > 0) push(k - 1);
    if (iu < nu - 1) push(k + 1);
    if (iv > 0) push(k - nu);
    if (iv < nv - 1) push(k + nu);
    if (ih > 0) push(k - nu * nv);
    if (ih < nh - 1) push(k + nu * nv);
  }
  let n = 0;
  for (let k = 0; k < data.length; k++) {
    if (data[k] >= 0 && !seen[k]) {
      data[k] = -CELL * 0.25;
      n++;
    }
  }
  return n;
}

/* ---------------- 网格化（简单的 surface nets）---------------- */

export function meshOf(fn: (x: number, y: number, z: number) => number, lo: V3, hi: V3, h: number): { pos: Float32Array; tri: Uint32Array } {
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1;
  const ny = Math.ceil((hi[1] - lo[1]) / h) + 1;
  const nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const val = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) val[(k * ny + j) * nx + i] = fn(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
  const V = (i: number, j: number, k: number) => val[(k * ny + j) * nx + i];
  const vid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const pos: number[] = [];
  const C = (i: number, j: number, k: number) => (k * (ny - 1) + j) * (nx - 1) + i;
  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  const edges = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const v = corners.map(([a, b, c]) => V(i + a, j + b, k + c));
        if (v.every((x) => x < 0) || v.every((x) => x >= 0)) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [p, q] of edges) {
          if (v[p] < 0 === v[q] < 0) continue;
          const t = v[p] / (v[p] - v[q]);
          sx += corners[p][0] + (corners[q][0] - corners[p][0]) * t;
          sy += corners[p][1] + (corners[q][1] - corners[p][1]) * t;
          sz += corners[p][2] + (corners[q][2] - corners[p][2]) * t;
          n++;
        }
        vid[C(i, j, k)] = pos.length / 3;
        pos.push(lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (k + sz / n) * h);
      }
    }
  }
  const tri: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) tri.push(a, c, b, a, d, c);
    else tri.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v0 = V(i, j, k) < 0;
        if (i < nx - 1 && v0 !== V(i + 1, j, k) < 0) quad(vid[C(i, j - 1, k - 1)], vid[C(i, j, k - 1)], vid[C(i, j, k)], vid[C(i, j - 1, k)], !v0);
        if (j < ny - 1 && v0 !== V(i, j + 1, k) < 0) quad(vid[C(i - 1, j, k - 1)], vid[C(i - 1, j, k)], vid[C(i, j, k)], vid[C(i, j, k - 1)], !v0);
        if (k < nz - 1 && v0 !== V(i, j, k + 1) < 0) quad(vid[C(i - 1, j - 1, k)], vid[C(i, j - 1, k)], vid[C(i, j, k)], vid[C(i - 1, j, k)], !v0);
      }
    }
  }
  return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
}

/* ---------------- 出图 ---------------- */

const SHOT = 360;
const VIEW: Record<string, V3> = {
  front: [0, 0, 1],
  side: [1, 0, 0],
  under: normalize([0.25, -0.55, 0.8]),
  three: normalize([0.62, 0.12, 0.78]),
};
function normalize(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
/** 所有图同一个取景：躯干胸口那一截 */
const FRAME = { k: SHOT / 0.5, center: [0, 1.1, 0.04] as V3 };

function shots(dir: string, name: string, pos: Float32Array, tri: Uint32Array) {
  for (const [view, d] of Object.entries(VIEW)) writeFileSync(join(dir, `${name}_${view}.png`), png(SHOT, SHOT, render(pos, tri, d, FRAME, SHOT, SHOT)));
}

/* ---------------- 主程序 ---------------- */

/** 每种胸型：参考模型、对齐时再调的缩放和高低 */
const SHAPES: { name: ChestKind; file: string; tune: { scale: number; lift: number } }[] = [
  { name: 'reference', file: 'assets/source/djp/DJP Anime Base Sculpt.obj', tune: { scale: 1, lift: 0 } },
  { name: 'large', file: 'assets/source/djp/DJP CC0 Free Base Mesh 01.obj', tune: { scale: 1, lift: 0 } },
];

/** 采好的胸型换成存进 body.bin 的样子（16 位） */
function packPatch(p: Patch, natural: number): ChestPatch {
  const data = new Int16Array(p.data.length);
  for (let k = 0; k < data.length; k++) data[k] = Math.round((Math.max(-BAND, Math.min(BAND, p.data[k])) / BAND) * 32767);
  return { nu: p.nu, nv: p.nv, nh: p.nh, v0: p.v0, cell: CELL, hIn: H_IN, band: BAND, center: p.center, ru: p.ru, rv: p.rv, natural, data };
}

/** 展开图存成 16 位：每行前后正中、每格半径、每格弧长，一个接一个 */
function packFrame(f: Frame): Int16Array {
  const out = new Int16Array(ROWS + 2 * ROWS * COLS);
  const put = (k: number, v: number) => (out[k] = Math.round(v / FRAME_UNIT));
  for (let i = 0; i < ROWS; i++) put(i, f.zc[i]);
  for (let k = 0; k < ROWS * COLS; k++) {
    put(ROWS + k, f.r[k]);
    put(ROWS + ROWS * COLS + k, f.s[k]);
  }
  return out;
}

/** 存进去以后再读出来的样子（预览和工坊里用的一样） */
function unpackFrame(data: Int16Array): ChestFrame {
  const zc = new Float64Array(ROWS);
  const r = new Float64Array(ROWS * COLS);
  const s = new Float64Array(ROWS * COLS);
  for (let i = 0; i < ROWS; i++) zc[i] = data[i] * FRAME_UNIT;
  for (let k = 0; k < ROWS * COLS; k++) {
    r[k] = data[ROWS + k] * FRAME_UNIT;
    s[k] = data[ROWS + ROWS * COLS + k] * FRAME_UNIT;
  }
  return { ...GRID, zc, r, s };
}

export async function main(args: string[], root: string) {
  const write = args.includes('--write');
  const dir = args.find((a) => !a.startsWith('--'));
  if (!write && !dir) throw new Error('用法：node tools/run.mjs tools/build-chest.ts --write | <输出目录> [--debug]');
  if (dir) mkdirSync(dir, { recursive: true });
  if (args.includes('--debug')) DEBUG = [];
  const bin = readFileSync(join(root, BIN));
  installAnimeBody(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer);
  const flat = gridDist(getGrid(animeGrid('torsoFlat'))).fn;
  const vroid = vroidFrame(flat);
  console.log(`素体：裆 ${vroid.crotch.toFixed(3)}，腋下 ${vroid.armpit.toFixed(3)}`);

  const refs: Reference[] = [];
  const patches = {} as Record<ChestKind, ChestPatch>;
  for (const shape of SHAPES) {
    const ref = loadReference(shape.name, join(root, shape.file), vroid, shape.tune);
    refs.push(ref);
    if (DEBUG) continue;
    // 往外采多远：胸那一片（椭圆放大 1.35 倍以内）最远的交点凸出抹平的面多少
    let top = 0;
    const b = ref.breast;
    for (let i = 0; i < ROWS; i++) {
      for (let j = 0; j < (85 * COLS) / 180; j++) {
        const k = i * COLS + j;
        if (Math.hypot((ref.frame.s[k] - b.u) / b.ru, (Y0 + i * DY - b.v) / b.rv) > 1.35) continue;
        top = Math.max(top, ref.raw[k] - ref.frame.r[k]);
      }
    }
    // 手臂：腋下往上 2 厘米以下、比躯干侧面（抹平的面在 90° 的半径）还往外 1 厘米、在 78° 往后的
    const f = ref.frame;
    const arm = (x: number, y: number, z: number) =>
      y < f.armpit + 0.02 && Math.abs(x) > lookup(f, f.r, y, Math.PI / 2) + 0.01 && Math.atan2(Math.abs(x), z - zcOf(f, y)) > (78 * Math.PI) / 180;
    patches[shape.name] = packPatch(samplePatch(shape.name, ref.frame, ref.breast, meshSdf(ref.mesh, arm), top + 0.02), NATURAL[shape.name]);
  }
  if (DEBUG) {
    DEBUG.forEach((img, k) => writeFileSync(join(dir!, `rise-${SHAPES[k].name}.png`), png(COLS, ROWS, img)));
    return;
  }
  const frameData = packFrame(vroid);
  registerChest(unpackFrame(frameData), patches);

  if (write) {
    // 格子照原来的顺序一块块接起来（以前的三块胸 bust、bustLarge、bustReference 不要了），后面接展开图和两种胸型
    const meta = JSON.parse(readFileSync(join(root, META), 'utf8'));
    const all = new Int16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2);
    const chunks: Int16Array[] = [];
    let offset = 0;
    const grids: Record<string, { offset: number; length: number }> = {};
    for (const [name, g] of Object.entries(meta.grids as Record<string, { offset: number; length: number }>)) {
      if (name === 'bust' || name === 'bustLarge' || name === 'bustReference') continue;
      chunks.push(all.slice(g.offset, g.offset + g.length));
      grids[name] = { ...g, offset };
      offset += g.length;
    }
    const chest: Record<string, unknown> = {
      source: 'Death Joe Productions「DJP Anime Base Sculpt」（中胸）、「DJP CC0 Free Base Mesh 01」（大胸），CC0',
      frame: { ...GRID, unit: FRAME_UNIT, offset },
      patches: {},
    };
    chunks.push(frameData);
    offset += frameData.length;
    for (const [name, p] of Object.entries(patches)) {
      (chest.patches as Record<string, unknown>)[name] = { ...p, data: undefined, offset };
      chunks.push(p.data);
      offset += p.data.length;
    }
    meta.grids = grids;
    delete meta.bustLargeSource;
    delete meta.bustReferenceSource;
    meta.chest = chest;
    const out = new Int16Array(offset);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    writeFileSync(join(root, BIN), Buffer.from(out.buffer));
    writeFileSync(join(root, META), `${JSON.stringify(meta, null, 1)}\n`);
    console.log(`写进 ${BIN}（${(out.byteLength / 1e6).toFixed(2)} MB）、${META}`);
    if (!dir) return;
  }

  /* 预览：平胸躯干贴上两边的胸（和工坊里融合时一样取并集），滑块从平到 3 */
  const box: [V3, V3] = [
    [-0.22, 0.86, -0.16],
    [0.22, 1.34, 0.36],
  ];
  const H = 0.003;
  const body = { kind: 'grid' as const, name: 'Torso', grid: animeGrid('torsoFlat') };
  const withChest = (size: number) => {
    const sides = ([1, -1] as const).map((side) => chestDist({ kind: 'chest', name: 'Breast', body, origin: [0, 0, 0], side, size } satisfies ChestShape));
    return (x: number, y: number, z: number) => Math.min(flat(x, y, z), sides[0].fn(x, y, z), sides[1].fn(x, y, z));
  };
  const flatVolume = volume(meshOf(flat, box[0], box[1], H));
  const sizes: string[] = [];
  for (const bust of [0.3, 0.6, 1, 1.3, 1.6, 2.2, 2.6, 3]) {
    const fn = withChest(bust);
    const m = meshOf(fn, box[0], box[1], H);
    shots(dir!, `new-${bust}`, m.pos, m.tri);
    sizes.push(`${bust}→${((volume(m) - flatVolume) * 1000).toFixed(2)}`);
    if (bust === 1 || bust === 2.2 || bust === 3) writeFileSync(join(dir!, `section-new-${bust}.png`), section(fn, 0.075));
  }
  console.log(`胸的体积（升）：${sizes.join(' ')}`);
  // 参考模型摆好以后的样子，和从它胸的正中切一刀
  for (const ref of refs) {
    const pos = Float32Array.from(ref.mesh.v);
    shots(dir!, `ref-${ref.name}`, pos, ref.mesh.t);
    const f = ref.frame;
    const a = angleAt(f, ref.breast.v, ref.breast.u);
    const x = lookup(f, f.r, ref.breast.v, a) * Math.sin(a);
    writeFileSync(join(dir!, `section-ref-${ref.name}.png`), sectionOfMesh(pos, ref.mesh.t, x));
  }
}

/** 网格的体积（三角形朝向一致，取绝对值） */
function volume(m: { pos: ArrayLike<number>; tri: ArrayLike<number> }): number {
  let v = 0;
  for (let t = 0; t < m.tri.length; t += 3) {
    const a = m.tri[t] * 3;
    const b = m.tri[t + 1] * 3;
    const c = m.tri[t + 2] * 3;
    const [ax, ay, az] = [m.pos[a], m.pos[a + 1], m.pos[a + 2]];
    const [bx, by, bz] = [m.pos[b], m.pos[b + 1], m.pos[b + 2]];
    const [cx, cy, cz] = [m.pos[c], m.pos[c + 1], m.pos[c + 2]];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(v) / 6;
}

/** 剖面：在 x 这个竖切面上，身体里面画成灰的（高度 0.95–1.32，前后 -0.12–0.32，每像素 1 毫米；左边是后背） */
const SEC = { y: [0.95, 1.32], z: [-0.12, 0.32], px: 0.001 };
function section(fn: (x: number, y: number, z: number) => number, x: number): Buffer {
  const w = Math.round((SEC.z[1] - SEC.z[0]) / SEC.px);
  const h = Math.round((SEC.y[1] - SEC.y[0]) / SEC.px);
  const img = new Uint8Array(w * h * 3).fill(250);
  for (let i = 0; i < h; i++) {
    const y = SEC.y[1] - i * SEC.px;
    for (let j = 0; j < w; j++) if (fn(x, y, SEC.z[0] + j * SEC.px) < 0) img.set([120, 126, 134], (i * w + j) * 3);
  }
  return png(w, h, img);
}

/** 网格的剖面：每一行（高度）和竖切面相交的线段，照前后排序以后两两一段填上 */
function sectionOfMesh(pos: ArrayLike<number>, tri: ArrayLike<number>, x: number): Buffer {
  const w = Math.round((SEC.z[1] - SEC.z[0]) / SEC.px);
  const h = Math.round((SEC.y[1] - SEC.y[0]) / SEC.px);
  const img = new Uint8Array(w * h * 3).fill(250);
  // 和 x 平面相交的三角形切成线段（y0, z0, y1, z1）
  const segs: number[] = [];
  for (let t = 0; t < tri.length; t += 3) {
    const p: number[] = [];
    for (let e = 0; e < 3; e++) {
      const a = tri[t + e] * 3;
      const b = tri[t + ((e + 1) % 3)] * 3;
      const xa = pos[a] - x;
      const xb = pos[b] - x;
      if (xa < 0 === xb < 0) continue;
      const s = xa / (xa - xb);
      p.push(pos[a + 1] + (pos[b + 1] - pos[a + 1]) * s, pos[a + 2] + (pos[b + 2] - pos[a + 2]) * s);
    }
    if (p.length === 4) segs.push(...p);
  }
  for (let i = 0; i < h; i++) {
    const y = SEC.y[1] - i * SEC.px;
    const zs: number[] = [];
    for (let k = 0; k < segs.length; k += 4) {
      const y0 = segs[k];
      const y1 = segs[k + 2];
      if (y0 < y === y1 < y || y0 === y1) continue;
      zs.push(segs[k + 1] + ((segs[k + 3] - segs[k + 1]) * (y - y0)) / (y1 - y0));
    }
    zs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < zs.length; k += 2) {
      for (let j = Math.max(0, Math.round((zs[k] - SEC.z[0]) / SEC.px)); j < Math.min(w, Math.round((zs[k + 1] - SEC.z[0]) / SEC.px)); j++) img.set([120, 126, 134], (i * w + j) * 3);
    }
  }
  return png(w, h, img);
}
