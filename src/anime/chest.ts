/**
 * 二次元素体的胸：不是拼到躯干上的一块，而是「贴着躯干表面的一层形状」（做法见 docs/rework-plan.md、tools/build-chest.ts）。
 *
 * 躯干按「高度 × 绕竖轴的角度」展开（展开图 ChestFrame）：每个高度上前后正中 zc，往各个角度量到平胸表面的半径 r、
 * 沿截面从正中线量过去的弧长 s。躯干附近的一点就有三个坐标：u 沿表面离正中线多远（照 |x| 量，左右对称）、v 多高、
 * h 离平胸表面往外多远（沿半径量）。
 * 胸的格子（ChestPatch）是参考模型在它自己的 (u, v, h) 里原样采的距离场：胸根的过渡、胸底和肚子之间的缝都在里面。
 * 用的时候照同样的三个坐标贴到平胸躯干上；胸那一片以外就是平胸躯干，边上两者是同一张表面。
 *
 * 纯计算：在主线程、Web Worker、单元测试里都能用。数据和躯干一起放在 body.bin 里，登记见 anime/body.ts。
 */
import type { ChestShape } from '../geometry/figure';
import type { Skin } from '../sdf/grids';
import type { V3 } from '../geometry/vec';

/** 躯干的展开图（平胸躯干，躯干格子自己的坐标） */
export interface ChestFrame {
  /** 第一行多高、每行隔多远、几行；列是从正前方（0）到正后方（π）往 +X 那半圈，每列隔 π / (cols - 1) */
  y0: number;
  dy: number;
  rows: number;
  cols: number;
  /** 每行前后正中 */
  zc: Float64Array;
  /** 每格半径、弧长（rows × cols，列变得最快） */
  r: Float64Array;
  s: Float64Array;
}

/**
 * 一种胸型：在 (u, v, h) 上采的距离场。u 从 0（正中线）起，v 从 v0 起，h 从 -hIn 起，每 cell 一格；
 * 数值 -32767 … 32767 对应 -band … band。center、ru、rv：胸那一片的中心和半宽（椭圆），出了它的 1.35 倍就是平胸
 */
export interface ChestPatch {
  nu: number;
  nv: number;
  nh: number;
  v0: number;
  cell: number;
  hIn: number;
  band: number;
  center: [number, number];
  ru: number;
  rv: number;
  /** 原样大小时在「胸部大小」滑块上算多少（照体积和以前的做法对齐，见 build-chest.ts） */
  natural: number;
  data: Int16Array;
}

export type ChestKind = 'reference' | 'large';

let FRAME: ChestFrame | null = null;
/** 胸的数据换过几次（烤好的胸照它作废，见 sdf/grids.ts 的 chestDist） */
let VERSION = 0;
export const chestVersion = () => VERSION;
const PATCHES = new Map<ChestKind, ChestPatch>();

export function registerChest(frame: ChestFrame, patches: Record<ChestKind, ChestPatch>) {
  FRAME = frame;
  VERSION++;
  for (const [name, p] of Object.entries(patches) as [ChestKind, ChestPatch][]) {
    if (p.data.length !== p.nu * p.nv * p.nh) throw new Error(`胸型 ${name} 的数据长度和尺寸对不上`);
    PATCHES.set(name, p);
    COLUMNS.delete(p);
  }
}

export function chestFrame(): ChestFrame {
  if (!FRAME) throw new Error('胸的数据还没有载入');
  return FRAME;
}

export function chestPatch(kind: ChestKind): ChestPatch {
  const p = PATCHES.get(kind);
  if (!p) throw new Error(`胸型 ${kind} 还没有载入`);
  return p;
}

/* ---------------- 展开图上的查表 ---------------- */

const rowOf = (f: ChestFrame, y: number) => Math.max(0, Math.min(f.rows - 1.000001, (y - f.y0) / f.dy));
const da = (f: ChestFrame) => Math.PI / (f.cols - 1);

/** 半径图、弧长图在高度 y、角度 a 处的值（双线性） */
export function lookup(f: ChestFrame, map: Float64Array, y: number, a: number): number {
  const fi = rowOf(f, y);
  const fj = Math.max(0, Math.min(f.cols - 1.000001, a / da(f)));
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const u = fi - i;
  const w = fj - j;
  const o = i * f.cols + j;
  return (map[o] * (1 - w) + map[o + 1] * w) * (1 - u) + (map[o + f.cols] * (1 - w) + map[o + f.cols + 1] * w) * u;
}

export function zcOf(f: ChestFrame, y: number): number {
  const fi = rowOf(f, y);
  const i = Math.floor(fi);
  return f.zc[i] + (f.zc[i + 1] - f.zc[i]) * (fi - i);
}

/** 弧长换成角度（上下两行各换一次再插值，不然每行一个台阶） */
export function angleAt(f: ChestFrame, y: number, s: number): number {
  if (s <= 0) return 0;
  const fi = rowOf(f, y);
  const i = Math.floor(fi);
  const inRow = (ii: number) => {
    const o = ii * f.cols;
    let j = 1;
    while (j < f.cols - 1 && f.s[o + j] < s) j++;
    const a = f.s[o + j - 1];
    const b = f.s[o + j];
    return (j - 1 + (b > a ? Math.min(1, (s - a) / (b - a)) : 0)) * da(f);
  };
  return inRow(i) + (inRow(i + 1) - inRow(i)) * (fi - i);
}

/** 一点在这个躯干上的 u（照 |x| 量，左右对称）、h、角度 */
export function shell(f: ChestFrame, x: number, y: number, z: number): { u: number; h: number; a: number } {
  const dz = z - zcOf(f, y);
  const ax = Math.abs(x);
  const a = Math.atan2(ax, dz);
  return { u: lookup(f, f.s, y, a), h: Math.sqrt(ax * ax + dz * dz) - lookup(f, f.r, y, a), a };
}

/** 展开图上 (u, 高度 y, h) 那一点在躯干坐标里的位置（+X 那一边） */
export function surfacePoint(f: ChestFrame, u: number, y: number, h = 0): V3 {
  const a = angleAt(f, y, u);
  const r = lookup(f, f.r, y, a) + h;
  return [r * Math.sin(a), y, zcOf(f, y) + r * Math.cos(a)];
}

/** 胸型在 (u, v, h) 处的距离（三线性）；出了格子是 NaN */
export function patchAt(p: ChestPatch, u: number, v: number, h: number): number {
  const fu = u / p.cell;
  const fv = (v - p.v0) / p.cell;
  const fh = (h + p.hIn) / p.cell;
  if (!(fu >= 0 && fv >= 0 && fh >= 0 && fu < p.nu - 1 && fv < p.nv - 1 && fh < p.nh - 1)) return NaN;
  const i = fu | 0;
  const j = fv | 0;
  const k = fh | 0;
  const a = fu - i;
  const b = fv - j;
  const c = fh - k;
  const d = p.data;
  const nu = p.nu;
  const plane = p.nu * p.nv;
  const o = k * plane + j * nu + i;
  const x00 = d[o] + (d[o + 1] - d[o]) * a;
  const x10 = d[o + nu] + (d[o + nu + 1] - d[o + nu]) * a;
  const x01 = d[o + plane] + (d[o + plane + 1] - d[o + plane]) * a;
  const x11 = d[o + plane + nu] + (d[o + plane + nu + 1] - d[o + plane + nu]) * a;
  const y0 = x00 + (x10 - x00) * b;
  const y1 = x01 + (x11 - x01) * b;
  return (y0 + (y1 - y0) * c) * (p.band / 32767);
}

/* ---------------- 胸型、大小、位置 ---------------- */

/** 放大缩小时上下照胸的哪个高度（中心往上胸那一片半高的多少）：大胸主要往下长 */
const PIVOT = 0.4;
/** 胸部大小调到多少算全平 */
export const CHEST_FLAT = 0.3;
/** 胸那一片的椭圆放大多少倍以外就是平胸；从多少倍起渐渐换回平胸 */
const OUTER = 1.35;
const INNER = 1.1;
/**
 * 往圆里变（他说照二次元作品，胸要圆润，参考图里的胸是圆球：上半截饱满、胸根宽、侧面看是一个圆、底是圆的）：
 * 参考模型的胸和一个同样大小、同样位置的椭球（在 u、v、h 里，往平胸里沉一截，上半截和平胸躯干圆滑地接上，胸底留一道缝）按 ROUNDNESS 混合，
 * 乳头照参考胸的补上（Columns.nipple）。原来大胸型调到 1.6 上下时外侧胸根那道勒痕、往前伸成一根筒，也跟着没了。
 * 1.1 以下的小胸本来就圆，不变，到 ROUND_FULL 变足。椭球每个大小一组（ChestRound），build-chest.ts 照参考胸量好存进 body.bin。
 * 形状是他 11-02 挑的那一版
 */
const ROUNDNESS = 0.8;
const ROUND_FROM = 1.1;
const ROUND_FULL = 1.6;
/**
 * 椭球和平胸躯干接上的圆角，竖向半径的几分之几：上半截大（胸从胸口顺着鼓出来，不是一个球放在胸口上、上面一圈凹角），
 * 下半截小（胸底那道缝留着）；从中心往下 0.65 个半径到往上 0.35 个半径之间渐变
 */
const FILLET_TOP = 0.6;
const FILLET_BOTTOM = 0.08;
const fillet = (v: number, center: number, rv: number) => rv * (FILLET_BOTTOM + (FILLET_TOP - FILLET_BOTTOM) * ease((v - center) / rv + 0.65));

/**
 * 每个大小（sizes）一组：整个胸往外挪多少（move：参考胸离正中线近，椭球照它的宽度不越过正中线，就连参考胸一起往外挪）、
 * 椭球中心离（挪过的）胸中心多远（u、v）、三个半径（u、v、h）、中心在平胸表面外多高
 */
export interface ChestRound {
  sizes: number[];
  params: [move: number, du: number, dv: number, au: number, av: number, ah: number, hc: number][];
}
let ROUND: ChestRound | null = null;

export const chestRound = () => ROUND;

export function registerChestRound(round: ChestRound | null) {
  ROUND = round;
  VERSION++;
}

/** 滑块 size 上的椭球（相对胸中心），和混合时它占多少；没有就是 null */
function roundAt(size: number): { move: number; off: [number, number]; radii: V3; hc: number; alpha: number } | null {
  if (!ROUND || size <= ROUND_FROM) return null;
  const { sizes, params } = ROUND;
  let i = 0;
  while (i < sizes.length - 2 && sizes[i + 1] < size) i++;
  const t = Math.min(1, Math.max(0, (size - sizes[i]) / (sizes[i + 1] - sizes[i])));
  const q = params[i].map((v, k) => v + (params[i + 1][k] - v) * t);
  const alpha = ROUNDNESS * ease((size - ROUND_FROM) / (ROUND_FULL - ROUND_FROM));
  // 往外挪也跟着往圆里变的程度渐渐加上
  return { move: (q[0] * alpha) / ROUNDNESS, off: [q[1], q[2]], radii: [q[3], q[4], q[5]], hc: q[6], alpha };
}

/** 一层胸型：放大几倍、中心放在哪、占多少分量 */
interface Layer {
  patch: ChestPatch;
  k: number;
  /** 胸根的横向、高度和离表面的厚度分别放大几倍（照胸型的格子算好，逐点求值时只除一次） */
  scale: [number, number, number];
  /** 上下照胸型里哪个高度放大 */
  pivot: number;
  at: [number, number];
  weight: number;
}

/** 照 k 等比放大：左右照正中线放大，上下照 PIVOT 那个高度放大 */
function plainLayer(patch: ChestPatch, k: number, weight = 1): Layer {
  const pivot = patch.center[1] + PIVOT * patch.rv;
  return { patch, k, scale: [k, k, k], pivot, at: [patch.center[0] * k, pivot + (patch.center[1] - pivot) * k], weight };
}

/** 两层胸型挪到同一个中心（照 t 在两者原本的中心之间取）按比例混合：隔开的两团混出来是尖的 */
function blend(a: Layer, b: Layer, t: number): Layer[] {
  const at: [number, number] = [a.at[0] + (b.at[0] - a.at[0]) * t, a.at[1] + (b.at[1] - a.at[1]) * t];
  return [
    { ...a, at, weight: 1 - t },
    { ...b, at, weight: t },
  ];
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * 滑块上的胸：CHEST_FLAT 以下是平胸；往上先是中胸（放大倍数照开方变，再和平胸按比例混合：往小调主要是往平胸里沉，
 * 不缩成一小团）；中胸到大胸之间两种胸型渐变；再往上照大胸放大（滑块最大 2.3）。
 * fade：和平胸混合时胸占多少
 */
export function chestLayers(size: number): { layers: Layer[]; fade: number } {
  const ref = chestPatch('reference');
  const large = chestPatch('large');
  if (size <= CHEST_FLAT) return { layers: [], fade: 0 };
  if (size <= ref.natural) {
    return { layers: [plainLayer(ref, Math.sqrt(size / ref.natural))], fade: (size - CHEST_FLAT) / (ref.natural - CHEST_FLAT) };
  }
  if (size < large.natural) {
    const t = ease((size - ref.natural) / (large.natural - ref.natural));
    return { layers: blend(plainLayer(ref, size / ref.natural), plainLayer(large, size / large.natural), t), fade: 1 };
  }
  return { layers: [plainLayer(large, size / large.natural)], fade: 1 };
}

/** 胸的中心（u、高度）在滑块 size 上原本在哪（还没往上下挪、没手动微调） */
export function chestCenter(size: number): [number, number] {
  const { layers } = chestLayers(Math.max(size, CHEST_FLAT + 0.01));
  return layers[0].at;
}

/** 胸在滑块 size 上从中心往上、往下大概各伸多远（米）：多排胸排开时用 */
export function chestReach(size: number): [up: number, down: number] {
  const { layers } = chestLayers(Math.max(size, CHEST_FLAT + 0.01));
  let reach = 0;
  // 胸那一片的椭圆连着往外补平的一圈，胸本身大概是它的八成
  for (const l of layers) reach += l.patch.rv * l.scale[1] * 0.8 * l.weight;
  return [reach, reach];
}

/** 胸在滑块 size 上大概多大：胸根半径、胸尖离平胸表面多远（米）。穿模检查用 */
export function chestBulk(size: number): { radius: number; depth: number } {
  const { layers, fade } = chestLayers(size);
  let radius = 0;
  let depth = 0;
  for (const l of layers) {
    radius += Math.min(l.patch.ru * l.scale[0], l.patch.rv * l.scale[1]) * 0.8 * l.weight;
    // 格子往外多采了 2 厘米（build-chest.ts 的 top + 0.02）
    depth += ((l.patch.nh - 1) * l.patch.cell - l.patch.hIn - 0.02) * l.scale[2] * l.weight * fade;
  }
  return { radius, depth };
}

/* ---------------- 胸那一片在展开图上的范围 ---------------- */

/** 取乳头时胸面磨多宽（米，高斯的 σ）：比乳头宽、比整个胸窄得多；只取乳头周围多远（一半以内取足，到这么远减到没有） */
const NIPPLE_BLUR = 0.008;
const NIPPLE_REACH = 0.025;
/** 分部件时胸根从凸出平胸多少的地方切开（胸那一片以外是躯干，免得两张面叠在一起） */
const FOOT_RISE = 0.003;
/** 胸型和平胸差不到这么多的地方当成平胸（融合时胸只在差得多的那一片里算，范围小、算得快） */
const ACTIVE_RISE = 0.0005;

/**
 * 胸型的每一列 (u, v)：最外面那张表面凸出平胸多少（rise，米，胸型自己的大小；没有表面是 NaN）；
 * 离胸根（凸出 FOOT_RISE 的那一圈）多远（foot）、离和平胸不一样的那一片（胸那一片的椭圆以内凸出或凹进 ACTIVE_RISE 以上，再往外扩两格）多远（active），
 * 外面正、里面负
 */
interface Columns {
  rise: Float32Array;
  foot: Float32Array;
  active: Float32Array;
  /** 乳头：胸尖周围胸面比磨平（NIPPLE_BLUR）的胸面凸出来多少（米，只算凸出来的）。往圆里变时照它补回去，胸尖不磨平 */
  nipple: Float32Array;
}
const COLUMNS = new Map<ChestPatch, Columns>();

function columns(p: ChestPatch): Columns {
  const known = COLUMNS.get(p);
  if (known) return known;
  const n = p.nu * p.nv;
  const rise = new Float32Array(n).fill(NaN);
  for (let iv = 0; iv < p.nv; iv++) {
    for (let iu = 0; iu < p.nu; iu++) {
      // 从最外面往里找第一个进到身体里的格子，在它和外面那一格之间插值
      for (let ih = p.nh - 1; ih >= 0; ih--) {
        const d = p.data[(ih * p.nv + iv) * p.nu + iu];
        if (d >= 0) continue;
        const above = ih + 1 < p.nh ? p.data[((ih + 1) * p.nv + iv) * p.nu + iu] : d;
        const t = above > d ? -d / (above - d) : 0;
        rise[iv * p.nu + iu] = (ih + t) * p.cell - p.hIn;
        break;
      }
    }
  }
  const foot = distance2d(p, (k) => rise[k] > FOOT_RISE);
  // 只算胸那一片的椭圆以内（再往外是平胸；格子上面几行碰得到参考模型的肩膀、手臂）
  const inEllipse = (k: number) => Math.hypot(((k % p.nu) * p.cell - p.center[0]) / p.ru, (p.v0 + Math.floor(k / p.nu) * p.cell - p.center[1]) / p.rv) < OUTER;
  const grown = distance2d(p, (k) => Math.abs(rise[k]) > ACTIVE_RISE && inEllipse(k));
  const active = grown.map((d) => d - 2 * p.cell);
  // 乳头：凸出平胸的高度先横竖各磨一遍（高斯），比磨过的高出来的那一小块。只取胸尖（胸那一片中间离平胸最远的那一格）
  // 周围 NIPPLE_REACH 以内的：胸下缘悬空那一圈陡下去，也比磨过的高，不能算进来
  const height = Float32Array.from(rise, (r) => (Number.isNaN(r) ? 0 : Math.max(0, r)));
  const sigma = NIPPLE_BLUR / p.cell;
  const reach = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: 2 * reach + 1 }, (_, k) => Math.exp(-((k - reach) ** 2) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  let blur = height;
  for (const [step, count, other] of [
    [1, p.nu, p.nv],
    [p.nu, p.nv, p.nu],
  ] as const) {
    const next = new Float32Array(n);
    for (let b = 0; b < other; b++) {
      const base = step === 1 ? b * p.nu : b;
      for (let a = 0; a < count; a++) {
        let acc = 0;
        for (let k = -reach; k <= reach; k++) acc += blur[base + Math.max(0, Math.min(count - 1, a + k)) * step] * kernel[k + reach];
        next[base + a * step] = acc / sum;
      }
    }
    blur = next;
  }
  let tip = 0;
  for (let k = 0; k < n; k++) {
    const e = Math.hypot(((k % p.nu) * p.cell - p.center[0]) / p.ru, (p.v0 + Math.floor(k / p.nu) * p.cell - p.center[1]) / p.rv);
    if (e < 0.6 && height[k] > height[tip]) tip = k;
  }
  const nipple = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const d = Math.hypot((k % p.nu) - (tip % p.nu), Math.floor(k / p.nu) - Math.floor(tip / p.nu)) * p.cell;
    nipple[k] = Math.max(0, height[k] - blur[k]) * (1 - ease(d / NIPPLE_REACH - 0.5));
  }
  const out = { rise, foot, active, nipple };
  COLUMNS.set(p, out);
  return out;
}

/** 胸型展开图上每一列离 inside 那一片的边多远（米），外面正、里面负 */
function distance2d(p: ChestPatch, inside: (k: number) => boolean): Float32Array {
  const n = p.nu * p.nv;
  const mask = new Uint8Array(n);
  for (let k = 0; k < n; k++) mask[k] = inside(k) ? 1 : 0;
  const edge: number[] = [];
  for (let iv = 0; iv < p.nv; iv++) {
    for (let iu = 0; iu < p.nu; iu++) {
      const m = mask[iv * p.nu + iu];
      const diff = (du: number, dv: number) => {
        const u = iu + du;
        const v = iv + dv;
        return u >= 0 && v >= 0 && u < p.nu && v < p.nv && mask[v * p.nu + u] !== m;
      };
      if (diff(1, 0) || diff(-1, 0) || diff(0, 1) || diff(0, -1)) edge.push(iu, iv);
    }
  }
  const out = new Float32Array(n);
  for (let iv = 0; iv < p.nv; iv++) {
    for (let iu = 0; iu < p.nu; iu++) {
      let best = Infinity;
      for (let e = 0; e < edge.length; e += 2) {
        const d = (edge[e] - iu) ** 2 + (edge[e + 1] - iv) ** 2;
        if (d < best) best = d;
      }
      const d = (Math.sqrt(best) + 0.5) * p.cell;
      out[iv * p.nu + iu] = mask[iv * p.nu + iu] ? -d : d;
    }
  }
  return out;
}

/** 展开图上 (u, v) 处 map 的值（双线性，出了格子再加上到边的距离） */
function columnAt(p: ChestPatch, map: Float32Array, u: number, v: number): number {
  const fu = Math.max(0, Math.min(p.nu - 1.000001, u / p.cell));
  const fv = Math.max(0, Math.min(p.nv - 1.000001, (v - p.v0) / p.cell));
  const i = fu | 0;
  const j = fv | 0;
  const a = fu - i;
  const b = fv - j;
  const o = j * p.nu + i;
  const d = (map[o] * (1 - a) + map[o + 1] * a) * (1 - b) + (map[o + p.nu] * (1 - a) + map[o + p.nu + 1] * a) * b;
  // 出了格子的范围：再加上到边的距离
  return d + Math.hypot(u / p.cell - fu, (v - p.v0) / p.cell - fv) * p.cell;
}

/** 展开图上 (u, v) 处 map 的值（双线性，出了格子是 0） */
function columnValue(p: ChestPatch, map: Float32Array, u: number, v: number): number {
  const fu = u / p.cell;
  const fv = (v - p.v0) / p.cell;
  if (!(fu >= 0 && fv >= 0 && fu < p.nu - 1 && fv < p.nv - 1)) return 0;
  const i = fu | 0;
  const j = fv | 0;
  const a = fu - i;
  const b = fv - j;
  const o = j * p.nu + i;
  return (map[o] * (1 - a) + map[o + 1] * a) * (1 - b) + (map[o + p.nu] * (1 - a) + map[o + p.nu + 1] * a) * b;
}

/* ---------------- 距离场 ---------------- */

/** 胸那一块往身体里取多深（离平胸表面往里）：融合时埋在躯干里，分部件时是插进躯干的那一截 */
export const CHEST_DEPTH = 0.01;
const DEG = Math.PI / 180;

/**
 * 一个胸部件的距离场（见 sdf/grids.ts 的 Skin），写在躯干格子自己的坐标里（已经退回加宽、加长这些变形之前）：
 * prepare 拿到退回去以后的点和退回加长（stretchY）之前的高度 yp——胸照 yp 摆，胸腔加长时胸不跟着拉长（胸贴着的那一圈表面照退回去的算）；
 * finish 拿到那里平胸躯干的距离 g。
 * 只取这一边（side）、离平胸表面往里 CHEST_DEPTH 以外、胸那一片以内的：融合时和躯干取并集，就是贴好胸的躯干。
 * piece：分部件用——只取胸根以内（凸出平胸 3 毫米以上的那一片），平胸以外的皮不要（和躯干叠在一起）
 */
export function chestSkin(shape: ChestShape, piece = false): Skin {
  const f = chestFrame();
  const { layers, fade } = chestLayers(shape.size);
  const side = shape.side;
  const [tu, tv, th] = shape.scale ?? [1, 1, 1];
  // 往圆里变的椭球（见 ROUNDNESS）：跟着手动微调挪、放大；整个胸往外挪的那一份加在手动微调的往外挪上
  const round = layers.length ? roundAt(shape.size) : null;
  const [shiftU, dv, push] = shape.shift ?? [0, 0, 0];
  const du = shiftU + (round?.move ?? 0);
  const [rx, ry, rz] = (shape.tilt ?? [0, 0, 0]).map((a) => a * DEG);
  const tanX = Math.tan(rx);
  const tanY = Math.tan(ry);
  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);
  const lift = shape.lift ?? 0;
  const empty = !layers.length || (piece && fade * Math.min(...layers.map((l) => l.k)) < 0.35);
  const ready = layers.map((l) => {
    const p = l.patch;
    const ku = l.scale[0] * tu;
    const kv = l.scale[1] * tv;
    const kh = l.scale[2] * th;
    // 往正中线挪也不过正中线
    const at: [number, number] = [Math.max(0.01, l.at[0] + du), l.at[1] + dv];
    // 左右：胸中心那一列对上 at，中心附近照 ku 放大；往正中线那边渐渐换成「正中线对正中线」（左右镜像接得上）
    const shift = Math.min(at[0] - p.center[0] * ku, 0.6 * at[0]);
    const pivot = l.pivot;
    return {
      p,
      weight: l.weight,
      ku,
      kv,
      kh,
      kmin: Math.min(ku, kv, kh),
      at,
      shift,
      pivot,
      // 上下：中心对上 at 的高度
      lower: at[1] - (pivot + (p.center[1] - pivot) * kv),
      cols: columns(p),
      // prepare 算好、finish 接着用的：这一点在胸型里的坐标、离胸那一片的椭圆多远
      pu: 0,
      pv: 0,
      ph: 0,
      e: 0,
    };
  });
  const rc: [number, number] = round ? [Math.max(0.01, ready[0].at[0] + round.off[0] * tu), ready[0].at[1] + round.off[1] * tv] : [0, 0];
  const [ra, rb, rh] = round ? [round.radii[0] * tu, round.radii[1] * tv, round.radii[2] * th] : [1, 1, 1];
  const rhc = round ? round.hc * th : 0;
  /** prepare 算好的：离平胸表面多远、离椭球多远（和这里的圆角多大）、切掉的那几刀里最靠外的 */
  let h = 0;
  let ball = 0;
  let rk = 1;
  let cut = 0;
  return {
    prepare(x, y, z, yp) {
      if (empty) return 1;
      const own = -x * side;
      const at = shell(f, x, y, z);
      h = at.h;
      // 手动微调的转动：绕胸中心在表面上转（rz），胸尖往下、往外歪（rx、ry：离表面越远挪得越多）。几层胸型的中心是同一个
      const hh = h - push;
      let uu = at.u;
      let vv = yp - lift;
      if (rx) vv += hh * tanX;
      if (ry) uu -= side * hh * tanY;
      if (rz) {
        const c = ready[0].at;
        const a = uu - c[0];
        const b = vv - c[1];
        uu = c[0] + a * cosZ + b * sinZ * side;
        vv = c[1] - a * sinZ * side + b * cosZ;
      }
      let edge = Infinity;
      if (round) {
        // 椭球的距离（近似）；融合时出了它和平胸接上的圆角就不要，分部件时出了它就不要
        const qu = (uu - rc[0]) / ra;
        const qv = (vv - rc[1]) / rb;
        const qh = (hh - rhc) / rh;
        const k0 = Math.sqrt(qu * qu + qv * qv + qh * qh);
        const k1 = Math.sqrt((qu / ra) ** 2 + (qv / rb) ** 2 + (qh / rh) ** 2);
        ball = k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(ra, rb, rh);
        rk = fillet(vv, rc[1], rb);
        edge = piece ? ball : ball - rk;
      }
      for (const l of ready) {
        const p = l.p;
        const t = uu <= 0 ? 0 : uu >= l.at[0] ? 1 : uu / l.at[0];
        l.pu = (uu - l.shift * t * t * (3 - 2 * t)) / l.ku;
        l.pv = l.pivot + (vv - l.lower - l.pivot) / l.kv;
        l.ph = hh / l.kh;
        const eu = (l.pu - p.center[0]) / p.ru;
        const ev = (l.pv - p.center[1]) / p.rv;
        l.e = Math.sqrt(eu * eu + ev * ev);
        // 离胸那一片（和平胸不一样的那一片）多远：融合时出了它的不要；分部件时离胸根多远（几层胸型取最宽的）
        const lateral = columnAt(p, piece ? l.cols.foot : l.cols.active, l.pu, l.pv) * l.kmin;
        if (lateral < edge) edge = lateral;
      }
      // 只要这一边、平胸表面往里 CHEST_DEPTH 以外、胸那一片以内的
      cut = Math.max(own, edge, -(h + CHEST_DEPTH));
      // 切掉的地方离得比一个体素还远：不用查格子了
      return cut > FAR ? cut : 0;
    },
    finish(g) {
      if (empty) return Math.max(g, CHEST_DEPTH) + 1;
      let mix = 0;
      for (const l of ready) {
        let s = g;
        if (l.e < OUTER) {
          const d = patchAt(l.p, l.pu, l.pv, l.ph);
          if (d === d) {
            const w0 = Math.min(1, Math.max(0, (l.e - INNER) / (OUTER - INNER)));
            const w = w0 * w0 * (3 - 2 * w0);
            s = d * l.kmin * (1 - w) + g * w;
          }
        }
        mix += s * l.weight;
      }
      let s = g + (mix - g) * fade;
      if (round) {
        // 椭球和平胸躯干圆滑地接上，再和参考胸混合；参考胸只剩一部分，它的乳头照分量补回去（往外推那么高）
        const e = Math.max(rk - Math.abs(g - ball), 0) / rk;
        let nipple = 0;
        for (const l of ready) nipple += columnValue(l.p, l.cols.nipple, l.pu, l.pv) * l.kmin * l.weight;
        s += ((g < ball ? g : ball) - (e * e * rk) / 4 - nipple - s) * round.alpha;
      }
      return s > cut ? s : cut;
    },
  };
}

/** 切掉的地方离得比这还远时不再查格子（融合最细的一档体素 6 毫米） */
const FAR = 0.008;

/** 加长（GridShape.stretchY）以后的高度换回加长之前的（和 sdf/grids.ts 里一样，牛顿法） */
function unstretch(y: number, stretch?: [number, number, number]): number {
  if (!stretch || y <= stretch[0]) return y;
  const [from, to, extra] = stretch;
  if (y >= to + extra) return y - extra;
  const span = to - from;
  let s = from + ((y - from) * span) / (span + extra);
  for (let k = 0; k < 6; k++) {
    const t = (s - from) / span;
    s -= (s + extra * t * t * (3 - 2 * t) - y) / (1 + (extra * 6 * t * (1 - t)) / span);
    s = Math.min(to, Math.max(from, s));
  }
  return s;
}

/**
 * 一个胸部件在躯干格子坐标里大概占多大（加长、加宽之前；照 lift 摆）：融合时只在这个范围里算它。
 * 照每层胸型里和平胸不一样的那一片（Columns.active），每一列从平胸表面往里 CHEST_DEPTH 到那一列凸出的高度，换算回躯干上的位置
 */
export function chestRegion(shape: ChestShape): { min: V3; max: V3 } | null {
  const f = chestFrame();
  const { layers } = chestLayers(shape.size);
  if (!layers.length) return null;
  const [tu, tv, th] = shape.scale ?? [1, 1, 1];
  const round = layers.length ? roundAt(shape.size) : null;
  const [shiftU, dv, push] = shape.shift ?? [0, 0, 0];
  const du = shiftU + (round?.move ?? 0);
  const tilt = Math.max(...(shape.tilt ?? [0, 0, 0]).map((a) => Math.abs(Math.tan(Math.min(80, Math.abs(a)) * DEG))));
  const lift = shape.lift ?? 0;
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  const add = (q: V3) => {
    for (let k = 0; k < 3; k++) {
      if (q[k] < min[k]) min[k] = q[k];
      if (q[k] > max[k]) max[k] = q[k];
    }
  };
  for (const l of layers) {
    const p = l.patch;
    const cols = columns(p);
    const ku = l.scale[0] * tu;
    const kv = l.scale[1] * tv;
    const kh = l.scale[2] * th;
    const at: [number, number] = [Math.max(0.01, l.at[0] + du), l.at[1] + dv];
    const shift = Math.min(at[0] - p.center[0] * ku, 0.6 * at[0]);
    const pivot = l.pivot;
    const lower = at[1] - (pivot + (p.center[1] - pivot) * kv);
    // 胸型的 u 换回躯干上的 u（chestSkin 里那一步反过来：单调的，二分）
    const realU = (pu: number) => {
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 30; k++) {
        const m = (lo + hi) / 2;
        const t = m >= at[0] ? 1 : m / at[0];
        if ((m - shift * t * t * (3 - 2 * t)) / ku < pu) lo = m;
        else hi = m;
      }
      return lo;
    };
    for (let iv = 0; iv < p.nv; iv += 2) {
      for (let iu = 0; iu < p.nu; iu += 2) {
        const k = iv * p.nu + iu;
        if (cols.active[k] > 0) continue;
        const top = Number.isNaN(cols.rise[k]) ? 0 : Math.max(0, cols.rise[k]);
        const h = top * kh + Math.max(push, 0) + 0.005;
        const slack = h * tilt;
        const u = realU(iu * p.cell);
        // 胸照加长以后的高度摆，贴着的那一圈表面在加长之前的高度上
        const y = pivot + (p.v0 + iv * p.cell - pivot) * kv + lower + lift;
        for (const dy of slack ? [-slack, 0, slack] : [0]) {
          const ys = unstretch(y + dy, shape.body.stretchY);
          add(surfacePoint(f, u + slack, ys, h));
          add(surfacePoint(f, Math.max(0, u - slack), ys, -CHEST_DEPTH));
        }
      }
    }
  }
  if (round) {
    // 往圆里变的椭球（和平胸接上的圆角也算进去）
    const c0 = layers[0].at;
    const cu = Math.max(0.01, c0[0] + du + round.off[0] * tu);
    const cv = c0[1] + dv + round.off[1] * tv + lift;
    const [ra, rb, rh] = [round.radii[0] * tu, round.radii[1] * tv, round.radii[2] * th];
    const rk = FILLET_TOP * rb;
    const top = round.hc * th + rh + Math.max(push, 0) + rk;
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 8; j++) {
        const u = Math.max(0, cu + (i / 4 - 1) * (ra + rk));
        const y = unstretch(cv + (j / 4 - 1) * (rb + rk), shape.body.stretchY);
        add(surfacePoint(f, u, y, top));
        add(surfacePoint(f, u, y, -CHEST_DEPTH));
      }
    }
  }
  if (!Number.isFinite(min[0])) return null;
  // +X 那一边算的：换到这一边，正中线那边留到正中线（胸那一片的格点隔一格取的，四周再多留 1.5 厘米）
  const pad = 0.015;
  const lo: V3 = shape.side > 0 ? [-pad, min[1] - pad, min[2] - pad] : [-max[0] - pad, min[1] - pad, min[2] - pad];
  const hi: V3 = shape.side > 0 ? [max[0] + pad, max[1] + pad, max[2] + pad] : [pad, max[1] + pad, max[2] + pad];
  return { min: lo, max: hi };
}
