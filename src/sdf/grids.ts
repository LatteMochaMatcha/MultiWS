/**
 * 采样好的距离场（「格子」）：从现成的模型加工来的形状，存成三维格点上的有符号距离。
 * 求值就是在格点之间做三线性插值。先登记（registerGrid），部件里按名字引用。
 *
 * 纯计算，在主线程、Web Worker 和单元测试里都能用；数据由外面读进来再登记。
 */
import type { BackStretch, ChestShape, Fork, GridShape, SpreadX, Thicken, Twin, WidenBand } from '../geometry/figure';
import { type V3, sub } from '../geometry/vec';
import { type ChestFrame, chestFrame, chestRegion, chestSkin, chestVersion } from '../anime/chest';
import type { Dist } from './field';
import { forkWarp } from './fork';
import { type Stretch, unstretch } from './stretch';

export interface Grid {
  /** 第一个格点的位置（这块形状自己的坐标，米） */
  min: V3;
  /** 三个方向各有几个格点 */
  dims: [number, number, number];
  /** 相邻格点的间距 */
  cell: number;
  /** 距离只存到这么远，更远的地方都按这个数算 */
  band: number;
  /** 各格点的距离，-32767 … 32767 对应 -band … band；x 变得最快，然后 y，然后 z */
  data: Int16Array;
  /** 表面实际占的范围（不含四周的留白） */
  bounds: { min: V3; max: V3 };
}

const grids = new Map<string, Grid>();

export function registerGrid(name: string, grid: Grid) {
  if (grid.data.length !== grid.dims[0] * grid.dims[1] * grid.dims[2]) {
    throw new Error(`格子 ${name} 的数据长度和尺寸对不上`);
  }
  grids.set(name, grid);
}

export const hasGrid = (name: string) => grids.has(name);

export function getGrid(name: string): Grid {
  const grid = grids.get(name);
  if (!grid) throw new Error(`格子 ${name} 还没有载入`);
  return grid;
}

/**
 * 求出格子的距离以后再换成别的（胸，见 anime/chest.ts 的 chestSkin）。先 prepare：传进去的是退回各种变形以后的点、退回加长之前的高度、
 * 那里横着压窄成了几倍（taperX，没有就是 1），离得肯定够远的话返回一个正数（不用再查格子，就用它），不然返回 0 或负数；
 * 再 finish：传进去那里格子的距离，返回换过以后的
 */
export interface Skin {
  prepare(x: number, y: number, z: number, yp: number, narrow?: number): number;
  finish(d: number): number;
}

export interface GridUse {
  /** 左右镜像（右手、右腿用左边那一份翻过来） */
  mirror?: boolean;
  /**
   * 把 [from, to] 这一段沿 Y 拉长 extra，上面的部分整体上移：
   * 多排手臂、多排胸时用它把胸腔加长。第四个数是两头渐变多长（见 sdf/stretch.ts）
   */
  stretchY?: Stretch;
  /** 只留下 x ≥ clipX 的部分（镜像之前的坐标） */
  clipX?: number;
  /** 只留下 y ≥ clipBelow 的部分：腿只留最上面一截 */
  clipBelow?: number;
  /** 只留下 y ≤ clipAbove 的部分：好几个上半身时，躯干只留腰以下那一截（见 geometry/torsos.ts） */
  clipAbove?: number;
  /** 切口的棱倒多大的圆角（不给就是一刀切平） */
  clipRound?: number;
  /** 只留下 x ≤ clipTo 的部分（镜像、弯之前的坐标）：把手切掉 */
  clipTo?: number;
  /**
   * 弯一下（手肘）：从 (x, z) 这根竖轴往外（+X）的部分绕它转 angle 弧度，正的是往前（+Z）弯；
   * 轴两边各 width 宽的一段平滑过渡。写的是镜像之前的坐标，镜像以后照样往前弯。
   */
  bend?: [x: number, z: number, angle: number, width: number];
  /**
   * 和另一块格子按比例混合：t = 0 是自己，t = 1 是另一块（登记时用的名字）。
   * 两块的格子必须一模一样（原样的躯干和平胸的躯干）。
   */
  morph?: [grid: string, t: number];
  /**
   * 往两边加宽、收窄（肩宽、腰宽、胯宽，多个头时把肩膀加宽）：每一段从高度 from 起逐渐变，到 to 变足，每边宽出 amount
   * （负的是收窄；to 比 from 低就是往下变）。离中线 core 以内的一段是被拉开（压窄）的，再往外的整个挪。
   * 几段叠在同一个高度上时，各段的挪动加在一起。高度按加长（stretchY）之前的算。
   */
  widenX?: WidenBand[];
  /**
   * 绕一根轴变粗变细（四肢粗细）：from 到 to 这一段轴（镜像之前、弯过来之前的坐标）周围，离轴的距离乘 k。
   * 沿轴离 from 不到 ramp[0] 的不变，到 ramp[1] 变足；到 to 之前 ramp[2] 那么长慢慢变回原样（或者 end 倍）。
   * 这样接躯干的根（和躯干叠在一起的那一截）、接手的手腕、脚踝都和原来对得上；过了 to 的（脚）不变（或者 end 倍）
   */
  thicken?: Thicken;
  /**
   * 离身体中线（这块格子自己坐标里的 x = mid）的距离乘一个随高度变的倍数（胯宽）：高度是这块格子自己的 y 加上 rise
   * （换算成躯干的高度）。levels 从上往下四个高度：top 以上不变，到 full 变足（k 倍），到 fullTo 还是足的，到 bottom 以下变回不变。
   * 躯干和腿各照自己的 mid、rise 用同一份，叠在一起的那一截（腿根）就还是对得上。镜像之前的坐标
   */
  spreadX?: SpreadX;
  /** 再一份和 spreadX 一样算的（多排胸时胸下面接长的那截肋骨往下收窄，k < 1），叠在胯宽上 */
  taperX?: SpreadX;
  /**
   * 背那半边另照一种加长（多排胸：胸那边照 stretchY 接一截直筒，背照素体的背整段拉长）：前后 z 在 front 以前照 stretchY，
   * 到 back 全照 backStretch.stretch，中间渐变。两种加长的总长要一样（再往上就对得上）
   */
  backStretch?: BackStretch;
  /**
   * 斜过去（腿往外散开）：往下（-Y）走到 depth 那么深时往 +X 挪满 out，再往下整个平移；y ≥ 0 的不挪。
   * 每个高度上整片平移，膝盖、脚踝还是水平的，脚平踩在地上。镜像之前的坐标，在别的变形外面
   */
  lean?: [out: number, depth: number];
  /**
   * 从胯往上渐渐分开（好几个上半身，见 geometry/torsos.ts）：这块格子所在的部件整个绕 pivot 转了 quat、又挪了 shift
   * （写在部件自己的摆放里），但高度在 from 以下的地方照原样留在胯上（转、挪都退回去），到 to 才转足、挪足，
   * 中间渐渐过渡——几个上半身从胯上像树杈一样分出去，腰两侧不鼓包、不起棱。坐标是这块格子自己的（镜像之前），
   * 切口（clipBelow 这些）照分开之前的高度算
   */
  fork?: Fork;
  /**
   * 两个人从肩到胯并成一个宽躯干（横排两副胯、两个头的二次元素体，见 geometry/animeLayout.ts）：这块格子离中线 d 往左右各放一份。
   * 高度在 bottom 以下、top 以上，两份各是各的，挨着的地方取并集（两副胯、两根脖子，正中各一道沟）；
   * full 到 fullTo 之间是一整块：离中线 core 以内的一段往两边拉开（和 widenX 一样），腰上、胸上拉开多少、core 多宽各不一样，
   * 前后的 core 也可以不一样；中间两份渐渐往中间靠拢。在别的变形外面：坐标是这块格子所在部件的，高度是加长（stretchY）以后的
   */
  twin?: Twin;
  /**
   * 这块格子存的是到一层面片的距离（头发），没有里外：离面片 shell 以内的地方算实心。
   * 加长（stretchY）、加宽这些照常管用。
   */
  shell?: number;
  /** 胸（见 Skin）：求出这块格子的距离以后再换成它 */
  skin?: Skin;
  /** 占的范围不照格子的表面，照这个（这块格子自己的坐标，变形之前）：胸只占躯干格子里的一小片 */
  region?: { min: V3; max: V3 };
}

/**
 * 两份并成一个宽躯干（见 GridUse.twin）：one 是放在原位的那一份的距离场。
 * 过渡的那一段不是把「各是各的」和「一整块」两个场按比例混合（两张表面叠出一层虚影：横着一道棱、正中一条鼓条），
 * 而是取样的地方随高度从「那一份自己的」渐渐挪到「一整块的」：两份往中间靠拢，正中那道沟渐渐变浅，始终是一张完整的表面。
 * 取样的地方随高度挪得快的，离表面的距离要缩一点
 */
function twinned(one: Dist, twin: Twin): Dist {
  const { d } = twin;
  const [bottom, full, fullTo, top] = twin.levels ?? APART;
  /**
   * 离中线 c 的那一份在 (x, y, z) 上的距离：横着在哪取样，照「一整块」占多少（w，随高度变得多快是 slope）
   * 从那一份自己的挪到一整块的（merged，随高度、随前后挪得多快是 mergedY、mergedZ）
   */
  const copy = (x: number, y: number, z: number, c: number, w: number, slope: number, merged: number, mergedY: number, mergedZ: number) => {
    const at = (1 - w) * (x - c) + w * merged;
    const ay = slope * (merged - (x - c)) + w * mergedY;
    const az = w * mergedZ;
    const v = one(at, y, z);
    return ay || az ? v / Math.sqrt(1 + ay * ay + az * az) : v;
  };
  return (x, y, z) => {
    /** 这个高度上「一整块」占多少，以及它随高度变得多快（往上变成一整块是正的） */
    let w = 0;
    let slope = 0;
    if (y > bottom && y < top) {
      if (y < full) {
        const t = (y - bottom) / (full - bottom);
        w = t * t * (3 - 2 * t);
        slope = (6 * t * (1 - t)) / (full - bottom);
      } else if (y > fullTo) {
        const t = (top - y) / (top - fullTo);
        w = t * t * (3 - 2 * t);
        slope = (-6 * t * (1 - t)) / (top - fullTo);
      } else w = 1;
    }
    const far = x < 0 ? -x : x;
    const sign = x < 0 ? -1 : 1;
    // 一整块时在哪取样（merged），以及它随高度、随前后挪得多快（mergedY、mergedZ）
    let merged = 0;
    let mergedY = 0;
    let mergedZ = 0;
    if (w > 0) {
      spreadBack(twin, far, y, z);
      merged = sign * spread3[0];
      mergedY = sign * spread3[1];
      mergedZ = sign * spread3[2];
    }
    if (w === 1) return copy(x, y, z, 0, w, slope, merged, mergedY, mergedZ);
    // 自己这边那一份；离中线不到 d 的地方另一份也伸得过来，取近的
    const v = copy(x, y, z, sign * d, w, slope, merged, mergedY, mergedZ);
    if (far >= d) return v;
    const other = copy(x, y, z, -sign * d, w, slope, merged, mergedY, mergedZ);
    return other < v ? other : v;
  };
}

/** Twin.levels 不给时：哪个高度上都不并成一整块 */
const APART = [Infinity, Infinity, Infinity, Infinity] as const;

/** spreadX、taperX 在高度 y（这块格子自己的）上把离中线的距离乘了多少 */
export function spreadAt(spread: SpreadX, y: number): number {
  const [top, full, fullTo, bottom] = spread.levels;
  const h = y + spread.rise;
  const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const u = h > full ? ease((top - h) / (top - full)) : h < fullTo ? ease((h - bottom) / (fullTo - bottom)) : 1;
  return 1 + (spread.k - 1) * u;
}

/** unspread 的结果放在这里（求值时用，免得每次新建数组）：拉宽以前离中线多远（x 坐标），距离要除以多少，这个高度上乘的倍数 */
const unspread2 = new Float64Array(3);

/** 按比例拉宽、压窄过的（spreadX、taperX）：现在 x、高度 y 的一点换算回去（写进 unspread2） */
function unspread(spread: SpreadX, lx: number, ly: number): void {
  // 这个高度上乘的倍数 f，换算回去就是离中线的距离除以 f
  const [top, full, fullTo, bottom] = spread.levels;
  const h = ly + spread.rise;
  let u = 1;
  let du = 0;
  if (h > full) {
    const t = (top - h) / (top - full);
    u = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
    du = t <= 0 || t >= 1 ? 0 : (-6 * t * (1 - t)) / (top - full);
  } else if (h < fullTo) {
    const t = (h - bottom) / (fullTo - bottom);
    u = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
    du = t <= 0 || t >= 1 ? 0 : (6 * t * (1 - t)) / (fullTo - bottom);
  }
  const f = 1 + (spread.k - 1) * u;
  unspread2[0] = lx;
  unspread2[1] = 1;
  unspread2[2] = f;
  if (f === 1) return;
  const x = (lx - spread.mid) / f;
  unspread2[0] = spread.mid + x;
  // 压窄的地方离表面近了；倍数随高度变，斜着拉过的地方也近一点
  const slope = (x * (spread.k - 1) * du) / f;
  unspread2[1] = Math.sqrt(Math.max(1, 1 / (f * f)) + slope * slope);
}

/** spreadBack 的结果放在这里（求值时用，免得每次新建数组）：拉开以前离中线多远，它随高度、随前后变得多快 */
const spread3 = new Float64Array(3);

/** 并成一整块的那一段（见 Twin.steps）：现在离中线 far、高度 y、前后 z 的一点，拉开以前离中线多远（写进 spread3） */
function spreadBack(twin: Twin, far: number, y: number, z: number): void {
  const { steps } = twin;
  const last = steps.length - 1;
  // 这个高度上拉开多少（a），前面、后面的 core 多宽，在相邻两个高度之间渐变（da、dfront、dback 是它们随高度变得多快）
  let k = 0;
  while (k < last && y >= steps[k + 1][0]) k++;
  let a = steps[k][1];
  let front = steps[k][2];
  let back = steps[k][3];
  let da = 0;
  let dFront = 0;
  let dBack = 0;
  if (k < last && y > steps[k][0]) {
    const [y0, a0, f0, b0] = steps[k];
    const [y1, a1, f1, b1] = steps[k + 1];
    const v = (y - y0) / (y1 - y0);
    const u = v * v * (3 - 2 * v);
    const du = (6 * v * (1 - v)) / (y1 - y0);
    a = a0 + (a1 - a0) * u;
    front = f0 + (f1 - f0) * u;
    back = b0 + (b1 - b0) * u;
    da = (a1 - a0) * du;
    dFront = (f1 - f0) * du;
    dBack = (b1 - b0) * du;
  }
  // 前后：从后面的 core 渐渐换成前面的（dz 是它随前后变得多快）
  const [zBack, zFront] = twin.depth;
  const q = (z - zBack) / (zFront - zBack);
  const g = q <= 0 ? 0 : q >= 1 ? 1 : q * q * (3 - 2 * q);
  const dg = q <= 0 || q >= 1 ? 0 : (6 * q * (1 - q)) / (zFront - zBack);
  const core = back + (front - back) * g;
  const dcy = dBack + (dFront - dBack) * g;
  const dcz = (front - back) * dg;
  // 原来离中线 s 的点现在在 s + a·smoothstep(s / core)，反过来求 s 用牛顿法
  if (far >= core + a) {
    spread3[0] = far - a;
    spread3[1] = -da;
    spread3[2] = 0;
    return;
  }
  let s = (far * core) / (core + a);
  for (let step = 0; step < 4; step++) {
    const t = s / core;
    s -= (s + a * t * t * (3 - 2 * t) - far) / (1 + (a * 6 * t * (1 - t)) / core);
    if (s < 0) s = 0;
    else if (s > core) s = core;
  }
  const t = s / core;
  const h = t * t * (3 - 2 * t);
  const hs = 6 * t * (1 - t);
  const per = 1 + (a * hs) / core;
  const bySpread = (a * hs * s) / (core * core);
  spread3[0] = s;
  spread3[1] = -(da * h - bySpread * dcy) / per;
  spread3[2] = (bySpread * dcz) / per;
}

/** 在一块格子里求距离的函数，以及它在自己坐标里占的范围（outer：连四周的留白，整块格子占的范围） */
export function gridDist(grid: Grid, use: GridUse = {}): { fn: Dist; min: V3; max: V3; outer: { min: V3; max: V3 } } {
  const { dims, cell } = grid;
  const [nx, ny, nz] = dims;
  const [x0, y0, z0] = grid.min;
  const inv = 1 / cell;
  const unit = grid.band / 32767;
  const nxy = nx * ny;
  const flip = use.mirror ? -1 : 1;
  const stretch = use.stretchY;
  const [from, to, extra] = stretch ?? [0, 0, 0];
  const cut = use.clipX;
  const below = use.clipBelow;
  const above = use.clipAbove;
  const cutTo = use.clipTo;
  const round = use.clipRound ?? 0;
  const [bendX, bendZ, bendAngle, bendWidth] = use.bend ?? [0, 0, 0, 1];
  // 上臂和前臂之间的分界面：垂直于两段手臂的角平分线
  const halfCos = Math.cos(bendAngle / 2);
  const halfSin = Math.sin(bendAngle / 2);
  const fullCos = Math.cos(bendAngle);
  const fullSin = Math.sin(bendAngle);
  const bands = use.widenX ?? [];
  /** 加宽的几段加起来每边最多宽出多少（收窄的不算） */
  const wide = bands.reduce((sum, [amount]) => sum + Math.max(amount, 0), 0);
  const thick = use.thicken;
  const spread = use.spreadX;
  const taper = use.taperX;
  const back = use.backStretch;
  const [leanOut, leanDepth] = use.lean ?? [0, 1];
  /** 斜过去的那一段（x 随高度一路挪）离表面近了多少：错切的最大伸长倍数 */
  const leanSlope = leanOut / leanDepth;
  const leanLip = Math.sqrt((2 + leanSlope * leanSlope + Math.abs(leanSlope) * Math.sqrt(4 + leanSlope * leanSlope)) / 2);
  const [tx0, ty0, tz0] = thick?.from ?? [0, 0, 0];
  const tSpan = thick ? Math.hypot(thick.to[0] - tx0, thick.to[1] - ty0, thick.to[2] - tz0) : 0;
  const [tux, tuy, tuz] = thick ? [0, 1, 2].map((k) => (thick.to[k] - thick.from[k]) / (tSpan || 1)) : [0, 0, 0];
  const shell = use.shell ?? 0;
  const skin = use.skin;
  /** 并成一个宽躯干的胸贴在并好的躯干外面（见 ChestShape.wide）：不在每一份里换，并好以后再换 */
  const inner = use.twin ? undefined : skin;
  const mix = use.morph?.[1] ?? 0;
  const other = mix ? getGrid(use.morph![0]) : null;
  if (other && (other.dims.some((n, k) => n !== dims[k]) || other.cell !== cell || other.min.some((v, k) => v !== grid.min[k]))) {
    throw new Error(`格子 ${use.morph![0]} 和要混合的那一块尺寸不一样`);
  }
  // 整个换成另一块（平胸的躯干）：只读那一块
  const data2 = mix === 1 ? undefined : other?.data;
  const data = mix === 1 ? other!.data : grid.data;

  /** 每一段加宽在当前这个高度上挪了多少（求值时用，免得每次新建数组） */
  const aNow = new Float64Array(bands.length);
  const fork = use.fork ? forkWarp(use.fork) : null;
  /** 分开之前的那一点、和旁边分界在外面多远（见 sdf/fork.ts），求值时用 */
  const forked = new Float64Array(4);
  const one: Dist = (qx, qy, qz) => {
    let px = qx;
    let py = qy;
    let pz = qz;
    /** 分开的那一段被拉伸、压扁了多少（距离要跟着缩） */
    let lip = 1;
    if (fork) {
      lip = fork.map(qx, qy, qz, forked);
      px = forked[0];
      py = forked[1];
      pz = forked[2];
    }
    let lx = px * flip;
    let lz = pz;
    if (bendAngle) {
      // 反过来求弯之前的位置：过了分界面的点绕轴转回去
      const dx = lx - bendX;
      const dz = lz - bendZ;
      const side = dx * halfCos + dz * halfSin;
      if (side > -bendWidth) {
        let c = fullCos;
        let s = fullSin;
        if (side < bendWidth) {
          const u = (side + bendWidth) / (2 * bendWidth);
          const a = bendAngle * u * u * (3 - 2 * u);
          c = Math.cos(a);
          s = Math.sin(a);
        }
        lx = bendX + dx * c + dz * s;
        lz = bendZ - dx * s + dz * c;
      }
    }
    /** 弯之前沿手臂走了多远 */
    const along = lx;
    let ly = py;
    /** 换算回原来的形状以后，距离要除以多少（收窄、变细的地方离表面近了） */
    let squeeze = 1;
    if (leanOut && ly < 0) {
      // 斜过去：换算回斜之前的位置
      const t = -ly / leanDepth;
      lx -= leanOut * (t >= 1 ? 1 : t);
      if (t < 1) squeeze = leanLip;
    }
    if (spread) {
      unspread(spread, lx, ly);
      lx = unspread2[0];
      if (unspread2[1] > squeeze) squeeze = unspread2[1];
    }
    /** 这里横着压窄成了几倍（taperX） */
    let narrow = 1;
    if (taper) {
      unspread(taper, lx, ly);
      lx = unspread2[0];
      if (unspread2[1] > squeeze) squeeze = unspread2[1];
      narrow = unspread2[2];
    }
    if (thick) {
      // 变粗变细：换算回离轴原来多远。轴上的位置 t 处乘的倍数，两头缓缓变回 1
      const qx = lx - tx0;
      const qy = ly - ty0;
      const qz = lz - tz0;
      let t = qx * tux + qy * tuy + qz * tuz;
      if (t < 0) t = 0;
      else if (t > tSpan) t = tSpan;
      const root = (t - thick.ramp[0]) / (thick.ramp[1] - thick.ramp[0]);
      const tip = (tSpan - t) / thick.ramp[2];
      const mid = root <= 0 ? 1 : 1 + (thick.k - 1) * (root >= 1 ? 1 : root * root * (3 - 2 * root));
      const end = thick.end ?? 1;
      const k = tip >= 1 ? mid : end + (mid - end) * tip * tip * (3 - 2 * tip);
      if (k !== 1) {
        const fx = tx0 + tux * t;
        const fy = ty0 + tuy * t;
        const fz = tz0 + tuz * t;
        lx = fx + (lx - fx) / k;
        ly = fy + (ly - fy) / k;
        lz = fz + (lz - fz) / k;
        if (k < 1) squeeze = Math.max(squeeze, 1 / k);
      }
    }
    // 加长过的那一段：换算回加长之前的高度（见 sdf/stretch.ts）
    let y = ly;
    if (extra && y > from) y = y >= to + extra ? y - extra : unstretch(y, stretch);
    if (back) {
      // 背那半边照另一种加长换算回去，前后渐变；渐变的那一段高度随前后变，斜着拉过，离表面近一点
      const w0 = (lz - back.front) / (back.back - back.front);
      if (w0 > 0) {
        const t = w0 >= 1 ? 1 : w0 * w0 * (3 - 2 * w0);
        const dt = w0 >= 1 ? 0 : (6 * w0 * (1 - w0)) / (back.front - back.back);
        const dy = unstretch(ly, back.stretch) - y;
        y += dy * t;
        const lip = Math.sqrt(1 + dy * dt * (dy * dt));
        if (lip > squeeze) squeeze = lip;
      }
    }
    if (bands.length) {
      // 加宽、收窄过的地方：换算回原来离中线多远。
      // 原来离中线 s 的点现在在 s + Σ a·smoothstep(s / core)，每段的 a 随高度从 0 变到 amount；反过来求 s 也是牛顿法
      let total = 0;
      let core = 0;
      for (let b = 0; b < bands.length; b++) {
        const [amount, from, to, c] = bands[b];
        const up = (y - from) / (to - from);
        const a = up <= 0 ? 0 : up >= 1 ? amount : amount * up * up * (3 - 2 * up);
        aNow[b] = a;
        if (a) {
          total += a;
          if (c > core) core = c;
        }
      }
      if (core) {
        const far = lx < 0 ? -lx : lx;
        let s: number;
        // 离中线 core 以外的整个挪了 total
        if (far >= core + total) s = far - total;
        else {
          s = (far * core) / (core + total);
          for (let step = 0; step < 4; step++) {
            let moved = 0;
            let slope = 0;
            for (let b = 0; b < bands.length; b++) {
              const a = aNow[b];
              if (!a) continue;
              const c = bands[b][3];
              const t = s < c ? s / c : 1;
              moved += a * t * t * (3 - 2 * t);
              slope += (a * 6 * t * (1 - t)) / c;
            }
            s -= (s + moved - far) / (1 + slope);
            if (s < 0) s = 0;
            else if (s > core) s = core;
          }
          // 压窄的地方离表面近了：距离跟着缩
          let slope = 0;
          for (let b = 0; b < bands.length; b++) {
            const c = bands[b][3];
            const t = s < c ? s / c : 1;
            slope += (aNow[b] * 6 * t * (1 - t)) / c;
          }
          if (slope < 0) squeeze /= 1 + slope;
        }
        lx = lx < 0 ? -s : s;
      }
    }
    let clip = cut === undefined ? -Infinity : cut - px * flip;
    if (below !== undefined && below - py > clip) clip = below - py;
    if (above !== undefined && py - above > clip) clip = py - above;
    if (lip > 1) {
      if (lip > squeeze) squeeze = lip;
      clip /= lip;
    }
    if (fork && forked[3] > clip) clip = forked[3];
    if (inner) {
      // 胸：离这一块肯定还远的地方不用再查格子
      const far = inner.prepare(lx, y, lz, ly, narrow);
      if (far > 0) return far / squeeze > clip ? far / squeeze : clip;
    }
    let fx = (lx - x0) * inv;
    let fy = (y - y0) * inv;
    let fz = (lz - z0) * inv;
    // 出了格子的范围：按格子边上的值，再加上到边的距离
    let out = 0;
    if (fx < 0) {
      out += fx * fx;
      fx = 0;
    } else if (fx > nx - 1) {
      out += (fx - nx + 1) ** 2;
      fx = nx - 1;
    }
    if (fy < 0) {
      out += fy * fy;
      fy = 0;
    } else if (fy > ny - 1) {
      out += (fy - ny + 1) ** 2;
      fy = ny - 1;
    }
    if (fz < 0) {
      out += fz * fz;
      fz = 0;
    } else if (fz > nz - 1) {
      out += (fz - nz + 1) ** 2;
      fz = nz - 1;
    }
    let i = fx | 0;
    let j = fy | 0;
    let k = fz | 0;
    if (i > nx - 2) i = nx - 2;
    if (j > ny - 2) j = ny - 2;
    if (k > nz - 2) k = nz - 2;
    const tx = fx - i;
    const ty = fy - j;
    const tz = fz - k;
    const o = i + nx * j + nxy * k;
    const c00 = data[o] + (data[o + 1] - data[o]) * tx;
    const c10 = data[o + nx] + (data[o + nx + 1] - data[o + nx]) * tx;
    const c01 = data[o + nxy] + (data[o + nxy + 1] - data[o + nxy]) * tx;
    const c11 = data[o + nxy + nx] + (data[o + nxy + nx + 1] - data[o + nxy + nx]) * tx;
    const c0 = c00 + (c10 - c00) * ty;
    const c1 = c01 + (c11 - c01) * ty;
    let d = c0 + (c1 - c0) * tz;
    if (data2) {
      const e00 = data2[o] + (data2[o + 1] - data2[o]) * tx;
      const e10 = data2[o + nx] + (data2[o + nx + 1] - data2[o + nx]) * tx;
      const e01 = data2[o + nxy] + (data2[o + nxy + 1] - data2[o + nxy]) * tx;
      const e11 = data2[o + nxy + nx] + (data2[o + nxy + nx + 1] - data2[o + nxy + nx]) * tx;
      const e0 = e00 + (e10 - e00) * ty;
      const e1 = e01 + (e11 - e01) * ty;
      d += (e0 + (e1 - e0) * tz - d) * mix;
    }
    d = d * unit - shell;
    if (out > 0) d += Math.sqrt(out) * cell;
    if (inner) d = inner.finish(d);
    if (squeeze !== 1) d /= squeeze;
    if (cutTo !== undefined && along - cutTo > d) d = along - cutTo;
    if (round > 0) {
      // 切口的棱倒圆：两个值差不多大的地方（也就是棱附近）再往里收一点
      const edge = round - (clip > d ? clip - d : d - clip);
      if (edge > 0) return (clip > d ? clip : d) + (edge * edge) / (4 * round);
    }
    return clip > d ? clip : d;
  };
  const twin = use.twin;
  const shaped: Dist = twin ? twinned(one, twin) : one;
  const fn: Dist =
    twin && skin
      ? (x, y, z) => {
          // 胸照加长以后的高度摆、贴着的表面也照它找（展开图是照并好的躯干现量的，见 wideFrame）
          const far = skin.prepare(x, y, z, y, 1);
          return far > 0 ? far : skin.finish(shaped(x, y, z));
        }
      : shaped;

  /** 一个盒子（这块格子自己的坐标）加宽、加长、加厚、弯过以后占多大，镜像过来 */
  const placed = (lo: V3, hi: V3): { min: V3; max: V3 } => {
    const most = thick ? Math.max(thick.k, thick.end ?? 1) : 1;
    if (thick && most > 1) {
      // 变粗了：离轴最远的那个角离轴多远，就往外多留它乘 (k - 1)
      let reach = 0;
      for (const x of [lo[0], hi[0]]) {
        for (const y of [lo[1], hi[1]]) {
          for (const z of [lo[2], hi[2]]) {
            const qx = x - tx0;
            const qy = y - ty0;
            const qz = z - tz0;
            const t = qx * tux + qy * tuy + qz * tuz;
            reach = Math.max(reach, Math.sqrt(Math.max(qx * qx + qy * qy + qz * qz - t * t, 0)));
          }
        }
      }
      const grow = reach * (most - 1);
      for (let k = 0; k < 3; k++) {
        lo[k] -= grow;
        hi[k] += grow;
      }
    }
    if (leanOut) {
      // 斜过去：往那边多留斜出去的那么多
      if (leanOut > 0) hi[0] += leanOut;
      else lo[0] += leanOut;
    }
    if (spread && spread.k > 1) {
      // 拉宽了：离中线最远的那一边往外多留
      const grow = Math.max(Math.abs(lo[0] - spread.mid), Math.abs(hi[0] - spread.mid)) * (spread.k - 1);
      lo[0] -= grow;
      hi[0] += grow;
    }
    lo[0] -= wide + shell;
    lo[1] -= shell;
    lo[2] -= shell;
    hi[0] += wide + shell;
    hi[1] += extra + shell;
    hi[2] += shell;
    if (bendAngle) {
      // 弯过去的那一段会伸到原来的范围外面：把它转过以后的几个角也算进来
      const start = bendX - bendWidth;
      const corners: [number, number][] = [
        [start, lo[2]],
        [start, hi[2]],
        [hi[0], lo[2]],
        [hi[0], hi[2]],
      ];
      for (const a of [bendAngle / 2, bendAngle]) {
        for (const [x, z] of corners) {
          const dx = x - bendX;
          const dz = z - bendZ;
          const bx = bendX + dx * Math.cos(a) - dz * Math.sin(a);
          const bz = bendZ + dx * Math.sin(a) + dz * Math.cos(a);
          lo[0] = Math.min(lo[0], bx);
          hi[0] = Math.max(hi[0], bx);
          lo[2] = Math.min(lo[2], bz);
          hi[2] = Math.max(hi[2], bz);
        }
      }
    }
    // 分开之前那一截退回胯上：照退回去的样子把几个角也算进来
    fork?.grow(lo, hi);
    const box: { min: V3; max: V3 } = use.mirror ? { min: [-hi[0], lo[1], lo[2]], max: [-lo[0], hi[1], hi[2]] } : { min: lo, max: hi };
    if (twin) {
      // 左右各放了一份（并成一整块的那一段拉开得不比 d 多）
      const most = Math.max(twin.d, ...twin.steps.map((step) => step[1]));
      box.min[0] -= most;
      box.max[0] += most;
    }
    return box;
  };
  // 占的范围按表面实际占的地方算，不算四周的留白（再留一个格子）：留白里只有离表面更远的值，
  // 那么远的地方这块格子本来就影响不到融合出来的表面（见 surfaceNets.ts 里 reach），包进来只是让附近的小块白算它。
  // 切掉的那几边也收到切口为止。和另一块混合的，两块的范围都算上
  const bounds = use.region ?? (other ? { min: grid.bounds.min.map((v, k) => Math.min(v, other.bounds.min[k])), max: grid.bounds.max.map((v, k) => Math.max(v, other.bounds.max[k])) } : grid.bounds);
  const lo: V3 = [bounds.min[0] - cell, bounds.min[1] - cell, bounds.min[2] - cell];
  const hi: V3 = [bounds.max[0] + cell, bounds.max[1] + cell, bounds.max[2] + cell];
  if (cut !== undefined && cut > lo[0]) lo[0] = cut;
  if (below !== undefined && below > lo[1]) lo[1] = below;
  if (above !== undefined && above < hi[1]) hi[1] = above;
  if (cutTo !== undefined && cutTo < hi[0]) hi[0] = cutTo;
  const tight = placed(lo, hi);
  // 整块格子（连留白）占的范围：融合时整个场的格点从哪里排起是照它算的（见 Draft.span）
  const outer = use.region
    ? placed([lo[0] - cell, lo[1] - cell, lo[2] - cell], [hi[0] + cell, hi[1] + cell, hi[2] + cell])
    : placed([x0, y0, z0], [x0 + (nx - 1) * cell, y0 + (ny - 1) * cell, z0 + (nz - 1) * cell]);
  return { fn, min: tight.min, max: tight.max, outer };
}

/**
 * 胸（见 anime/chest.ts）：躯干那一块格子（body，带着和躯干一样的加宽、加长）的距离换成贴好胸的、只取这一边胸那一片的。
 * 胸这个部件不转不缩放，它的原点在躯干里的 origin：先挪回躯干的坐标再求。piece：分部件用，只取胸根以内。
 * 融合时一个点要求好几次（分块、找表面、算法线），胸现算又慢：融合用的先烤成 BAKE 一格的格子（同一个胸几档精细度之间共用），
 * 分部件只网格化一次，现算
 */
export function chestDist(p: ChestShape, piece = false, voxel = 0): { fn: Dist; min: V3; max: V3; outer: { min: V3; max: V3 } } {
  // 烤成的格子：最细一档 BAKE，融合的体素粗的话跟着粗（草图那档拖滑块时要快）
  const cell = voxel > 0 ? Math.min(BAKE_COARSE, Math.max(BAKE, voxel * 0.6)) : BAKE;
  const key = piece ? '' : `${chestVersion()} ${cell} ${JSON.stringify(p)}`;
  const known = key ? BAKED.get(key) : undefined;
  if (known) {
    BAKED.delete(key);
    BAKED.set(key, known);
    return known;
  }
  const frame = p.wide ? wideFrame(p.body) : chestFrame();
  const region = chestRegion(p, frame) ?? { min: [0, 0, 0] as V3, max: [0, 0, 0] as V3 };
  const d = gridDist(getGrid(p.body.grid), { ...p.body, skin: chestSkin(p, piece, frame), region });
  const [ox, oy, oz] = p.origin;
  const [nx, ny, nz, nd] = p.seam ?? [0, 0, 0, 0];
  const exact = {
    fn: p.seam
      ? (x: number, y: number, z: number) => {
          // 里侧的胸在两个身子正中间切齐（ChestShape.seam）
          const v = d.fn(x + ox, y + oy, z + oz);
          const cut = nx * (x + ox) + ny * (y + oy) + nz * (z + oz) - nd;
          return v > cut ? v : cut;
        }
      : (x: number, y: number, z: number) => d.fn(x + ox, y + oy, z + oz),
    min: sub(d.min, p.origin),
    max: sub(d.max, p.origin),
    outer: { min: sub(d.outer.min, p.origin), max: sub(d.outer.max, p.origin) },
  };
  if (piece) return exact;
  // 框的范围是照躯干的加宽、加长、胯宽一起放大的，比胸大好几倍：粗扫一遍，只框到里面和离表面不到一个粗格的地方
  const step = cell * 3;
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let x = exact.min[0]; x <= exact.max[0] + step; x += step) {
    for (let y = exact.min[1]; y <= exact.max[1] + step; y += step) {
      for (let z = exact.min[2]; z <= exact.max[2] + step; z += step) {
        if (exact.fn(x, y, z) > step * 1.2) continue;
        const q = [x, y, z];
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], q[k] - step);
          hi[k] = Math.max(hi[k], q[k] + step);
        }
      }
    }
  }
  if (!Number.isFinite(lo[0])) return exact;
  const baked = { ...exact, min: lo, max: hi, fn: bake(exact.fn, lo, hi, cell) };
  BAKED.set(key, baked);
  if (BAKED.size > 12) BAKED.delete(BAKED.keys().next().value!);
  return baked;
}

/** 现量的展开图（见 wideFrame）每行隔多高、每列隔几度（弧度），量哪一段高度（加长以前的，上头再加上加长的） */
const WIDE_DY = 0.004;
const WIDE_COLS = 91;
const WIDE_FROM = 0.95;
const WIDE_TO = 1.36;
/** 量好的宽躯干展开图，最近用过的排在后面 */
const WIDE = new Map<string, ChestFrame>();

/**
 * 并成一个宽躯干时胸要贴的展开图（见 anime/chest.ts 的 ChestFrame、figure.ts 的 ChestShape.wide）：照这块躯干（body，带着并成一整块、
 * 加长这些，不带胸）现量。素体的展开图是一个人的，宽躯干正中是拉宽过的，照它贴的话正中那对胸跟着被横着拉开。
 * 高度用加长以后的，只量胸会长的那一段（WIDE_FROM–WIDE_TO 再加上加长的）；每个高度上前后正中照正中线的前后表面，
 * 从那里往 +X 那半圈每 2 度打一条射线量到表面多远、沿截面走过的弧长。正中那一点不在身体里的高度（脖子之间）照下面一行。
 * 同一块躯干只量一次（八千条上下的射线）
 */
export function wideFrame(body: GridShape): ChestFrame {
  const key = JSON.stringify(body);
  const known = WIDE.get(key);
  if (known) {
    WIDE.delete(key);
    WIDE.set(key, known);
    return known;
  }
  const fn = gridDist(getGrid(body.grid), body).fn;
  const extra = body.stretchY?.[2] ?? 0;
  const rows = Math.ceil((WIDE_TO + extra - WIDE_FROM) / WIDE_DY) + 1;
  const cols = WIDE_COLS;
  const zc = new Float64Array(rows);
  const r = new Float64Array(rows * cols);
  const s = new Float64Array(rows * cols);
  /** 从 (x, y, z) 往 (dx, 0, dz) 走，第一次出了身体的地方多远（起点不在身体里是 NaN） */
  const exit = (x: number, y: number, z: number, dx: number, dz: number): number => {
    let t = 0;
    let d = fn(x, y, z);
    if (d >= 0) return NaN;
    let last = 0;
    while (d < 0 && t < 0.6) {
      last = t;
      t += Math.max(-d * 0.9, 0.0005);
      d = fn(x + dx * t, y, z + dz * t);
    }
    if (d < 0) return NaN;
    let lo = last;
    let hi = t;
    for (let k = 0; k < 12; k++) {
      const m = (lo + hi) / 2;
      if (fn(x + dx * m, y, z + dz * m) < 0) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  for (let i = 0; i < rows; i++) {
    const y = WIDE_FROM + i * WIDE_DY;
    // 正中线上的前后表面：从身体里面往前、往后走出去（身体里一点照素体的前后正中）
    const inside = chestFrame();
    const mid = inside.zc[Math.max(0, Math.min(inside.rows - 1, Math.round((Math.min(y - extra, WIDE_TO) - inside.y0) / inside.dy)))];
    const front = exit(0, y, mid, 0, 1);
    const back = exit(0, y, mid, 0, -1);
    const o = i * cols;
    if (!(front > 0) || !(back > 0)) {
      if (i > 0) {
        zc[i] = zc[i - 1];
        r.copyWithin(o, o - cols, o);
        s.copyWithin(o, o - cols, o);
      } else zc[i] = mid;
      continue;
    }
    zc[i] = mid + (front - back) / 2;
    let px = 0;
    let pz = 0;
    for (let j = 0; j < cols; j++) {
      const a = (j * Math.PI) / (cols - 1);
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      let rr = exit(0, y, zc[i], dx, dz);
      if (!(rr > 0)) rr = j ? r[o + j - 1] : (front + back) / 2;
      r[o + j] = rr;
      const qx = rr * dx;
      const qz = rr * dz;
      s[o + j] = j ? s[o + j - 1] + Math.hypot(qx - px, qz - pz) : 0;
      px = qx;
      pz = qz;
    }
  }
  const frame: ChestFrame = { y0: WIDE_FROM, dy: WIDE_DY, rows, cols, zc, r, s };
  WIDE.set(key, frame);
  if (WIDE.size > 8) WIDE.delete(WIDE.keys().next().value!);
  return frame;
}

/** 烤的时候先每几格取一个粗点（见 bake） */
const BAKE_STRIDE = 2;
/** 胸烤成的格子每格多大：最细一档和躯干的格子（5 毫米）、胸型放大以后的格子差不多（融合最细一档的体素 6 毫米）；粗的几档最粗到 BAKE_COARSE */
const BAKE = 0.004;
const BAKE_COARSE = 0.012;
/** 烤好的胸，最近用过的排在后面 */
const BAKED = new Map<string, { fn: Dist; min: V3; max: V3; outer: { min: V3; max: V3 } }>();

/** 把一个距离场在 [min, max] 里每 cell 采一个点存起来，求值时三线性插值；出了范围照边上的值加上到边的距离 */
function bake(fn: Dist, min: V3, max: V3, cell: number): Dist {
  const [x0, y0, z0] = min;
  // 格点数凑成 BAKE_STRIDE 的整数倍再加一：粗的那一遍正好落在细格点上
  const count = (span: number) => Math.max(1, Math.ceil(span / cell / BAKE_STRIDE)) * BAKE_STRIDE + 1;
  const nx = count(max[0] - x0);
  const ny = count(max[1] - y0);
  const nz = count(max[2] - z0);
  const nxy = nx * ny;
  const data = new Float32Array(nxy * nz);
  // 先每 BAKE_STRIDE 格取一个粗点；一个粗格子八个角离表面都比格子的对角线（再宽一点）远的，表面穿不过这个格子：
  // 里面的细格点照八个角插值，只有表面附近的粗格子才逐点算（胸那一块里大半是空的、或者埋在躯干里，现算又慢）
  const step = cell * BAKE_STRIDE;
  const [cx, cy, cz] = [(nx - 1) / BAKE_STRIDE + 1, (ny - 1) / BAKE_STRIDE + 1, (nz - 1) / BAKE_STRIDE + 1];
  const coarse = new Float32Array(cx * cy * cz);
  for (let k = 0, o = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) coarse[o++] = fn(x0 + i * step, y0 + j * step, z0 + k * step);
  const far = step * Math.sqrt(3) * 1.05;
  const at = (i: number, j: number, k: number) => coarse[i + cx * (j + cy * k)];
  // 哪些细格点要逐点算：表面附近的粗格子里的（每个点只算一次）
  const needs = new Uint8Array(nxy * nz);
  for (let K = 0; K < cz - 1; K++)
    for (let J = 0; J < cy - 1; J++)
      for (let I = 0; I < cx - 1; I++) {
        let near = false;
        for (let c = 0; c < 8 && !near; c++) {
          const v = at(I + (c & 1), J + ((c >> 1) & 1), K + ((c >> 2) & 1));
          near = (v < 0 ? -v : v) < far;
        }
        if (!near) continue;
        for (let k = 0; k <= BAKE_STRIDE; k++)
          for (let j = 0; j <= BAKE_STRIDE; j++)
            for (let i = 0; i <= BAKE_STRIDE; i++) needs[I * BAKE_STRIDE + i + nx * (J * BAKE_STRIDE + j) + nxy * (K * BAKE_STRIDE + k)] = 1;
      }
  for (let gk = 0, o = 0; gk < nz; gk++)
    for (let gj = 0; gj < ny; gj++)
      for (let gi = 0; gi < nx; gi++, o++) {
        const [I, J, K] = [Math.min(Math.floor(gi / BAKE_STRIDE), cx - 2), Math.min(Math.floor(gj / BAKE_STRIDE), cy - 2), Math.min(Math.floor(gk / BAKE_STRIDE), cz - 2)];
        const [u, v, w] = [gi / BAKE_STRIDE - I, gj / BAKE_STRIDE - J, gk / BAKE_STRIDE - K];
        // 正好落在粗点上的就用粗点的值
        if (u % 1 === 0 && v % 1 === 0 && w % 1 === 0) data[o] = at(I + u, J + v, K + w);
        else if (needs[o]) data[o] = fn(x0 + gi * cell, y0 + gj * cell, z0 + gk * cell);
        else {
          const a = at(I, J, K) + (at(I + 1, J, K) - at(I, J, K)) * u;
          const b = at(I, J + 1, K) + (at(I + 1, J + 1, K) - at(I, J + 1, K)) * u;
          const e = at(I, J, K + 1) + (at(I + 1, J, K + 1) - at(I, J, K + 1)) * u;
          const f = at(I, J + 1, K + 1) + (at(I + 1, J + 1, K + 1) - at(I, J + 1, K + 1)) * u;
          const g = a + (b - a) * v;
          const h = e + (f - e) * v;
          data[o] = g + (h - g) * w;
        }
      }
  const inv = 1 / cell;
  return (x, y, z) => {
    let fx = (x - x0) * inv;
    let fy = (y - y0) * inv;
    let fz = (z - z0) * inv;
    let out = 0;
    if (fx < 0) (out += fx * fx), (fx = 0);
    else if (fx > nx - 1) (out += (fx - nx + 1) ** 2), (fx = nx - 1);
    if (fy < 0) (out += fy * fy), (fy = 0);
    else if (fy > ny - 1) (out += (fy - ny + 1) ** 2), (fy = ny - 1);
    if (fz < 0) (out += fz * fz), (fz = 0);
    else if (fz > nz - 1) (out += (fz - nz + 1) ** 2), (fz = nz - 1);
    const i = Math.min(fx | 0, nx - 2);
    const j = Math.min(fy | 0, ny - 2);
    const k = Math.min(fz | 0, nz - 2);
    const tx = fx - i;
    const ty = fy - j;
    const tz = fz - k;
    const q = i + nx * j + nxy * k;
    const c00 = data[q] + (data[q + 1] - data[q]) * tx;
    const c10 = data[q + nx] + (data[q + nx + 1] - data[q + nx]) * tx;
    const c01 = data[q + nxy] + (data[q + nxy + 1] - data[q + nxy]) * tx;
    const c11 = data[q + nxy + nx] + (data[q + nxy + nx + 1] - data[q + nxy + nx]) * tx;
    const c0 = c00 + (c10 - c00) * ty;
    const c1 = c01 + (c11 - c01) * ty;
    const d = c0 + (c1 - c0) * tz;
    return out > 0 ? d + Math.sqrt(out) * cell : d;
  };
}
