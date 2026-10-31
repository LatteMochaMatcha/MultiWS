/**
 * 采样好的距离场（「格子」）：从现成的模型加工来的形状，存成三维格点上的有符号距离。
 * 求值就是在格点之间做三线性插值。先登记（registerGrid），部件里按名字引用。
 *
 * 纯计算，在主线程、Web Worker 和单元测试里都能用；数据由外面读进来再登记。
 */
import type { Fork, SpreadX, Thicken, WidenBand } from '../geometry/figure';
import type { V3 } from '../geometry/vec';
import type { Dist } from './field';
import { forkWarp } from './fork';

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

export interface GridUse {
  /** 左右镜像（右手、右腿用左边那一份翻过来） */
  mirror?: boolean;
  /**
   * 把 [from, to] 这一段沿 Y 拉长 extra，上面的部分整体上移：
   * 多排手臂、多排胸时用它把胸腔加长。
   */
  stretchY?: [from: number, to: number, extra: number];
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
   * 这块格子存的是到一层面片的距离（头发），没有里外：离面片 shell 以内的地方算实心。
   * 加长（stretchY）、加宽这些照常管用。
   */
  shell?: number;
}

/** 在一块格子里求距离的函数，以及它在自己坐标里占的范围（outer：连四周的留白，整块格子占的范围） */
export function gridDist(grid: Grid, use: GridUse = {}): { fn: Dist; min: V3; max: V3; outer: { min: V3; max: V3 } } {
  const { dims, cell, data } = grid;
  const [nx, ny, nz] = dims;
  const [x0, y0, z0] = grid.min;
  const inv = 1 / cell;
  const unit = grid.band / 32767;
  const nxy = nx * ny;
  const flip = use.mirror ? -1 : 1;
  const [from, to, extra] = use.stretchY ?? [0, 0, 0];
  const span = to - from;
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
  const [leanOut, leanDepth] = use.lean ?? [0, 1];
  /** 斜过去的那一段（x 随高度一路挪）离表面近了多少：错切的最大伸长倍数 */
  const leanSlope = leanOut / leanDepth;
  const leanLip = Math.sqrt((2 + leanSlope * leanSlope + Math.abs(leanSlope) * Math.sqrt(4 + leanSlope * leanSlope)) / 2);
  const [tx0, ty0, tz0] = thick?.from ?? [0, 0, 0];
  const tSpan = thick ? Math.hypot(thick.to[0] - tx0, thick.to[1] - ty0, thick.to[2] - tz0) : 0;
  const [tux, tuy, tuz] = thick ? [0, 1, 2].map((k) => (thick.to[k] - thick.from[k]) / (tSpan || 1)) : [0, 0, 0];
  const shell = use.shell ?? 0;
  const mix = use.morph?.[1] ?? 0;
  const other = mix ? getGrid(use.morph![0]) : null;
  if (other && (other.dims.some((n, k) => n !== dims[k]) || other.cell !== cell || other.min.some((v, k) => v !== grid.min[k]))) {
    throw new Error(`格子 ${use.morph![0]} 和要混合的那一块尺寸不一样`);
  }
  const data2 = other?.data;

  /** 每一段加宽在当前这个高度上挪了多少（求值时用，免得每次新建数组） */
  const aNow = new Float64Array(bands.length);
  const fork = use.fork ? forkWarp(use.fork) : null;
  /** 分开之前的那一点、和旁边分界在外面多远（见 sdf/fork.ts），求值时用 */
  const forked = new Float64Array(4);
  const fn: Dist = (qx, qy, qz) => {
    let px = qx;
    let py = qy;
    let pz = qz;
    /** 分开的那一段被拉伸、压扁了多少（距离要跟着缩） */
    let lip = 1;
    if (fork) {
      lip = fork.map(qx, qy, qz, forked);
      [px, py, pz] = forked;
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
      // 按比例拉宽：这个高度上乘的倍数 f，换算回去就是离中线的距离除以 f
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
      if (f !== 1) {
        const x = (lx - spread.mid) / f;
        lx = spread.mid + x;
        // 压窄的地方离表面近了；倍数随高度变，斜着拉过的地方也近一点
        const slope = (x * (spread.k - 1) * du) / f;
        const lip = Math.sqrt(Math.max(1, 1 / (f * f)) + slope * slope);
        if (lip > squeeze) squeeze = lip;
      }
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
    // 加长过的那一段：换算回加长之前的高度。
    // 加长是「两头缓、中间急」的（原来的高度 s 变成 s + extra·smoothstep），这样两头不会留下折痕；
    // 反过来求 s 没有现成的式子，用牛顿法迭代几步
    let y = ly;
    if (extra && y > from) {
      if (y >= to + extra) y -= extra;
      else {
        let s = from + ((y - from) * span) / (span + extra);
        for (let step = 0; step < 4; step++) {
          const t = (s - from) / span;
          const grown = s + extra * t * t * (3 - 2 * t) - y;
          s -= grown / (1 + (extra * 6 * t * (1 - t)) / span);
          if (s < from) s = from;
          else if (s > to) s = to;
        }
        y = s;
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
    if (squeeze !== 1) d /= squeeze;
    if (cutTo !== undefined && along - cutTo > d) d = along - cutTo;
    if (round > 0) {
      // 切口的棱倒圆：两个值差不多大的地方（也就是棱附近）再往里收一点
      const edge = round - (clip > d ? clip - d : d - clip);
      if (edge > 0) return (clip > d ? clip : d) + (edge * edge) / (4 * round);
    }
    return clip > d ? clip : d;
  };

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
    return use.mirror ? { min: [-hi[0], lo[1], lo[2]], max: [-lo[0], hi[1], hi[2]] } : { min: lo, max: hi };
  };
  // 占的范围按表面实际占的地方算，不算四周的留白（再留一个格子）：留白里只有离表面更远的值，
  // 那么远的地方这块格子本来就影响不到融合出来的表面（见 surfaceNets.ts 里 reach），包进来只是让附近的小块白算它。
  // 切掉的那几边也收到切口为止。和另一块混合的，两块的范围都算上
  const bounds = other ? { min: grid.bounds.min.map((v, k) => Math.min(v, other.bounds.min[k])), max: grid.bounds.max.map((v, k) => Math.max(v, other.bounds.max[k])) } : grid.bounds;
  const lo: V3 = [bounds.min[0] - cell, bounds.min[1] - cell, bounds.min[2] - cell];
  const hi: V3 = [bounds.max[0] + cell, bounds.max[1] + cell, bounds.max[2] + cell];
  if (cut !== undefined && cut > lo[0]) lo[0] = cut;
  if (below !== undefined && below > lo[1]) lo[1] = below;
  if (above !== undefined && above < hi[1]) hi[1] = above;
  if (cutTo !== undefined && cutTo < hi[0]) hi[0] = cutTo;
  const tight = placed(lo, hi);
  // 整块格子（连留白）占的范围：融合时整个场的格点从哪里排起是照它算的（见 Draft.span）
  const outer = placed([x0, y0, z0], [x0 + (nx - 1) * cell, y0 + (ny - 1) * cell, z0 + (nz - 1) * cell]);
  return { fn, min: tight.min, max: tight.max, outer };
}
