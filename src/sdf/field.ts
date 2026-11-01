/**
 * 有符号距离场（SDF）：把 Figure 的所有部件编译成一个函数 f(x, y, z)，
 * 负值在身体里面，正值在外面，0 就是皮肤表面。
 *
 * 同一类部件之间直接取并集（min），不同类之间用 smooth-min 融合出圆角：
 * 这样九条尾巴挤在尾根不会鼓成一个大包，而手臂和躯干的交界是圆滑过渡。
 *
 * 纯计算，不碰 DOM，在 Web Worker 和单元测试里都能跑。
 */
import {
  type Figure,
  type Fork,
  type Loft,
  type Part,
  type PartType,
  type Prim,
  type Wing,
  type WorldXf,
  shapeInverse,
  shapeMatrix,
  shapeThin,
  worldTransforms,
} from '../geometry/figure';
import { WING_OUTLINE, sampleTube, tubeCurve, tubeTipRadius } from '../geometry/shapes';
import { ringAt } from '../geometry/torso';
import { type Quat, type V3, Q_ID, add, mat3Apply, mul, quatMul, rotate } from '../geometry/vec';
import { forkWarp } from './fork';
import { getGrid, gridDist } from './grids';

export type Dist = (x: number, y: number, z: number) => number;

export const BIG = 1e9;
/** 每个基本体在 data 里占多少个数 */
const STRIDE = 16;
const T_CONE = 0;
const T_ELLIPSOID = 1;
export const T_CUSTOM = 2;

/** 融合的先后顺序：先是躯干和下身，再往上长别的 */
export const GROUPS: readonly PartType[] = ['torso', 'lower', 'leg', 'neck', 'head', 'arm', 'chest', 'tail', 'wing', 'hair', 'horn', 'ear'];
export const GROUP_INDEX = new Map(GROUPS.map((t, i) => [t, i]));
/** 各类部件的融合圆角相对「融合半径」的倍率：胸要柔和，角和耳朵的根部要利落 */
export const GROUP_BLEND: Partial<Record<PartType, number>> = {
  torso: 1,
  lower: 1,
  leg: 1,
  neck: 1,
  head: 0.8,
  arm: 1,
  chest: 1.4,
  tail: 1,
  wing: 0.6,
  // 头发和皮肤之间要有一道清楚的边（发际线、发梢），不能化进脸里
  hair: 0.25,
  horn: 0.4,
  ear: 0.4,
};
/** 融合网格里翅膀至少这么厚：太薄的片在体素网格上会破洞 */
const WING_THICKNESS = 0.028;
/** 一层壳（头发）的半厚至少是体素的几倍 */
const SHELL_VOXELS = 0.6;

export interface FieldOptions {
  /** 融合半径（和 Figure 同单位）。0 表示不做圆角 */
  blend: number;
  /** 细长部件的最小半径：比体素还细的尖端会直接消失，所以按网格精度兜个底 */
  minRadius?: number;
}

/** 基本体怎么并进它那一组：硬接、圆滑地加上去、挖掉 */
export const M_HARD = 0;
export const M_SOFT = 1;
export const M_CUT = 2;

export interface CompiledField {
  count: number;
  /** 每个基本体的种类 */
  type: Uint8Array;
  /** 每个基本体属于第几组；基本体已按「组 → 硬接 / 圆滑加 / 挖」排好序 */
  group: Uint8Array;
  mode: Uint8Array;
  /** 圆滑加、挖的那些基本体各自的圆角半径 */
  primK: Float64Array;
  /**
   * 圆角只在根部管用的基本体：中心 x y z、离中心多远以内是完整的圆角、到多远减到 0（每个基本体 5 个数）。
   * 最后一个数是 0 的就是不限范围
   */
  fade: Float64Array;
  /**
   * 所在的部件只在根部和别的类融合的基本体：中心 x y z、完整圆角的半径、减到 0 的半径（每个 5 个数）。
   * 最后一个数是 0 的就是不限范围。rooted：有没有这样的基本体（没有的话求值时不用管这回事）
   */
  root: Float64Array;
  rooted: boolean;
  data: Float64Array;
  custom: (Dist | null)[];
  /** 每个基本体的包围盒：minX minY minZ maxX maxY maxZ */
  box: Float64Array;
  /**
   * 斜着放的基本体自己那个斜的盒子（见 Draft.corners、Draft.cull），每个 OBB 个数：中心 3 个、三根轴（单位向量）各 3 个、
   * 沿三根轴各有多宽的一半 3 个。第 i 个基本体的是第 obbFrom[i] 到 obbFrom[i + 1] 个（不含），没有的就不用斜盒子判断
   */
  obb: Float64Array;
  obbFrom: Int32Array;
  /** 每组并进全身时的融合半径 */
  groupK: Float64Array;
  /** 所有圆角半径里最大的那个 */
  kMax: number;
  /** 0, 1, 2 … count - 1，求整个场的值时用 */
  all: Int32Array;
  min: V3;
  max: V3;
  /** 标了 owner 的基本体：每个 owner 名下有哪些（下标升序）。没有标过的就没有这一项 */
  owned?: Map<number, Int32Array>;
  /** 要空出来的地方（见 Clearance）。没有就没有这一项 */
  clear?: Clearance[];
}

/**
 * 一处要空出来的地方：list 里的基本体（一个部件自己）在一段圆柱里的那一截，周围 margin 以内不许有别的东西——
 * 挤进来的都挖掉，这个部件自己原样留着。圆柱从 a 起、沿 axis（单位向量）长 length、半径 radius。
 * 摆好姿势以后给手腕用（见 posedField.ts、graft.ts）：手腕插进了大腿、别的手臂里，那里就没有一圈干净的断口，手缝不上。
 * carve 是 false 的只护着自己（不让别处的把它挖了），不挖别人。reach：离圆柱这么远以内才管（再远改不到表面）。
 * soft：挖开的边上圆一个多大的圆角（不给就不圆）。reach 不能比它小，不然到了 reach 边上值会跳一下
 */
export interface Clearance {
  a: V3;
  axis: V3;
  length: number;
  radius: number;
  margin: number;
  soft?: number;
  reach: number;
  carve: boolean;
  list: Int32Array;
}

/** 一个还没排进场里的基本体（摆好姿势以后的距离场 posedField.ts 也要自己拼这个） */
export interface Draft {
  type: number;
  group: number;
  nums: number[];
  custom: Dist | null;
  box: number[];
  mode?: number;
  k?: number;
  /** 圆角只在这个范围里管用：中心、完整圆角的半径、减到 rest 的半径、出了范围以后的圆角（rest，缺省 0） */
  fade?: number[];
  /**
   * 这个基本体所在的部件（手臂、腿）只在根部和别的类圆滑地融合：中心（关节）、离中心多远以内是完整的圆角、到多远减到 0。
   * 摆好姿势以后用（见 posedField.ts）：手搭在大腿上、手臂贴着身体，是挨着，不该融出一圈圆角把它们粘在一起
   */
  root?: number[];
  /**
   * 斜着放的基本体（写在部件自己坐标里的形状）：它自己那个盒子的 8 个角在世界里的位置（每个 3 个数；
   * 第 i 个角的第 0、1、2 位分别是 x、y、z 取大的那头）。box 是把它们包起来的正放的盒子，斜着的长条会大出很多
   */
  corners?: number[];
  /**
   * 算整个场的范围（融合时格点从哪里排起）用的盒子，不给就是 box。采样出来的形状的 box 只包住表面（见 grids.ts），
   * 这里是连四周留白的整块格子：格点还是排在原来那些位置，融合出来的网格和只用整块格子当 box 时一样
   */
  span?: number[];
  /** 整块格子（连留白）那个斜盒子的 8 个角（排法同 corners）：摆姿势时照它分段（见 posedField.ts），和只有整块格子时分得一样 */
  outerCorners?: number[];
  /**
   * 网格化时看小块离它远不远用的几个斜盒子（每个 24 个数：8 个角，排法同 corners），离哪一个都远的小块就不算它。
   * 不给就用 corners；给的话必须把这个基本体的值小于 reach 的地方都包住（见 surfaceNets.ts）
   */
  cull?: number[][];
  /** 这个基本体是谁的（随便一个编号）：排进场里以后能照这个编号找回来（CompiledField.owned） */
  owner?: number;
}

/** 每个基本体的 fade 占几个数 */
const FADE = 6;
/** 每个基本体的斜盒子占几个数（见 CompiledField.obb） */
export const OBB = 15;

/* ---------------- 基本体 ---------------- */

/** 四元数 → 3×3 旋转矩阵（按行存） */
function mat3(q: Quat): number[] {
  const [x, y, z, w] = q;
  const xx = x * (x + x);
  const xy = x * (y + y);
  const xz = x * (z + z);
  const yy = y * (y + y);
  const yz = y * (z + z);
  const zz = z * (z + z);
  const wx = w * (x + x);
  const wy = w * (y + y);
  const wz = w * (z + z);
  return [1 - (yy + zz), xy - wz, xz + wy, xy + wz, 1 - (xx + zz), yz - wx, xz - wy, yz + wx, 1 - (xx + yy)];
}

function ellipsoidDraft(group: number, c: V3, radii: V3, q: Quat): Draft {
  const m = mat3(q);
  const ext = [0, 1, 2].map((i) => Math.hypot(m[i * 3] * radii[0], m[i * 3 + 1] * radii[1], m[i * 3 + 2] * radii[2]));
  return {
    type: T_ELLIPSOID,
    group,
    // 中心；逆旋转（即 m 的各列）；半径的倒数；最小半径
    nums: [
      c[0], c[1], c[2],
      m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8],
      1 / radii[0], 1 / radii[1], 1 / radii[2],
      Math.min(radii[0], radii[1], radii[2]),
    ],
    custom: null,
    box: [c[0] - ext[0], c[1] - ext[1], c[2] - ext[2], c[0] + ext[0], c[1] + ext[1], c[2] + ext[2]],
  };
}

/** 圆台两端各带一个球：a 端半径 ra，b 端半径 rb */
function coneDraft(group: number, a: V3, b: V3, ra: number, rb: number): Draft {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  if (a2 <= 1e-12) {
    // 一端的球把另一端整个包住了，就是一个球
    const r = Math.max(ra, rb);
    return ellipsoidDraft(group, ra >= rb ? a : b, [r, r, r], Q_ID);
  }
  return {
    type: T_CONE,
    group,
    nums: [a[0], a[1], a[2], bax, bay, baz, l2, rr, a2, 1 / l2, ra, rb],
    custom: null,
    box: [
      Math.min(a[0] - ra, b[0] - rb), Math.min(a[1] - ra, b[1] - rb), Math.min(a[2] - ra, b[2] - rb),
      Math.max(a[0] + ra, b[0] + rb), Math.max(a[1] + ra, b[1] + rb), Math.max(a[2] + ra, b[2] + rb),
    ],
  };
}

/** 一个写在局部坐标里的距离函数，放到世界里。outer：算整个场的范围用的另一个盒子（局部坐标，见 Draft.span） */
function customDraft(group: number, xf: WorldXf, local: Dist, lmin: V3, lmax: V3, outer?: { min: V3; max: V3 }): Draft {
  const m = mat3(xf.quat);
  const [px, py, pz] = xf.pos;
  const s = xf.scale;
  const inv = 1 / s;
  const box = [BIG, BIG, BIG, -BIG, -BIG, -BIG];
  const corners: number[] = [];
  for (let i = 0; i < 8; i++) {
    const w = add(xf.pos, mul(rotate(xf.quat, [i & 1 ? lmax[0] : lmin[0], i & 2 ? lmax[1] : lmin[1], i & 4 ? lmax[2] : lmin[2]]), s));
    corners.push(w[0], w[1], w[2]);
    for (let k = 0; k < 3; k++) {
      box[k] = Math.min(box[k], w[k]);
      box[k + 3] = Math.max(box[k + 3], w[k]);
    }
  }
  let span: number[] | undefined;
  let outerCorners: number[] | undefined;
  if (outer) {
    span = [BIG, BIG, BIG, -BIG, -BIG, -BIG];
    outerCorners = [];
    for (let i = 0; i < 8; i++) {
      const w = add(xf.pos, mul(rotate(xf.quat, [i & 1 ? outer.max[0] : outer.min[0], i & 2 ? outer.max[1] : outer.min[1], i & 4 ? outer.max[2] : outer.min[2]]), s));
      outerCorners.push(w[0], w[1], w[2]);
      for (let k = 0; k < 3; k++) {
        span[k] = Math.min(span[k], w[k]);
        span[k + 3] = Math.max(span[k + 3], w[k]);
      }
    }
  }
  return {
    type: T_CUSTOM,
    group,
    nums: [],
    custom: (x, y, z) => {
      const dx = x - px;
      const dy = y - py;
      const dz = z - pz;
      return (
        local(
          (m[0] * dx + m[3] * dy + m[6] * dz) * inv,
          (m[1] * dx + m[4] * dy + m[7] * dz) * inv,
          (m[2] * dx + m[5] * dy + m[8] * dz) * inv,
        ) * s
      );
    },
    box,
    corners,
    ...(span ? { span, outerCorners } : {}),
  };
}

/** 放样的躯干从胯上渐渐分开（见 sdf/fork.ts）：在分开之前的那一点上求距离 */
function forkedLoft(d: { fn: Dist; min: V3; max: V3 }, fork: Fork): { fn: Dist; min: V3; max: V3 } {
  const warp = forkWarp(fork);
  const at = new Float64Array(4);
  const min: V3 = [...d.min];
  const max: V3 = [...d.max];
  warp.grow(min, max);
  return {
    fn: (x, y, z) => {
      const lip = warp.map(x, y, z, at);
      const v = d.fn(at[0], at[1], at[2]) / lip;
      return at[3] > v ? at[3] : v;
    },
    min,
    max,
  };
}

/** 椭圆截面放样的躯干：按高度查截面，在截面内算到椭圆的距离，上下各有一个平的封口 */
function loftDist(p: Loft): { fn: Dist; min: V3; max: V3 } {
  const { rings } = p;
  const y0 = rings[0].y;
  const y1 = rings[rings.length - 1].y;
  const n = 128;
  const w = new Float64Array(n + 1);
  const d = new Float64Array(n + 1);
  const zc = new Float64Array(n + 1);
  let maxW = 0;
  let minZ = BIG;
  let maxZ = -BIG;
  for (let i = 0; i <= n; i++) {
    const r = ringAt(rings, y0 + ((y1 - y0) * i) / n);
    w[i] = r.w;
    d[i] = r.d;
    zc[i] = r.z;
    maxW = Math.max(maxW, r.w);
    minZ = Math.min(minZ, r.z - r.d);
    maxZ = Math.max(maxZ, r.z + r.d);
  }
  const span = y1 - y0;
  const fn: Dist = (x, y, z) => {
    let t = ((y - y0) / span) * n;
    t = t < 0 ? 0 : t > n ? n : t;
    const i = t >= n ? n - 1 : Math.floor(t);
    const f = t - i;
    const rw = w[i] + (w[i + 1] - w[i]) * f;
    const rd = d[i] + (d[i + 1] - d[i]) * f;
    const pz = z - (zc[i] + (zc[i + 1] - zc[i]) * f);
    const ux = x / rw;
    const uz = pz / rd;
    const k0 = Math.sqrt(ux * ux + uz * uz);
    let side: number;
    if (k0 < 1e-9) side = -Math.min(rw, rd);
    else {
      const vx = ux / rw;
      const vz = uz / rd;
      side = (k0 * (k0 - 1)) / Math.sqrt(vx * vx + vz * vz);
    }
    const out = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
    if (out > 0) return side > 0 ? Math.sqrt(side * side + out * out) : out;
    return Math.max(side, y0 - y, y - y1);
  };
  return { fn, min: [-maxW, y0, minZ], max: [maxW, y1, maxZ] };
}

/** 翅膀：轮廓多边形拉出厚度，棱边倒圆 */
function wingDist(p: Wing, minRadius: number): { fn: Dist; min: V3; max: V3 } {
  const n = WING_OUTLINE.length;
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const lo: V3 = [BIG, BIG, 0];
  const hi: V3 = [-BIG, -BIG, 0];
  for (let i = 0; i < n; i++) {
    vx[i] = WING_OUTLINE[i][0] * p.size * p.side;
    vy[i] = WING_OUTLINE[i][1] * p.size;
    lo[0] = Math.min(lo[0], vx[i]);
    lo[1] = Math.min(lo[1], vy[i]);
    hi[0] = Math.max(hi[0], vx[i]);
    hi[1] = Math.max(hi[1], vy[i]);
  }
  const half = Math.max(p.thickness, WING_THICKNESS, minRadius * 2.4) / 2;
  const round = half * 0.6;
  const core = half - round;
  const far = 0.08;
  const fn: Dist = (x, y, z) => {
    // 离得远的点不用精确算：给一个不超过真实距离的估计就够了（融合只关心表面附近）
    const off = Math.max(Math.abs(z) - half, lo[0] - round - x, x - hi[0] - round, lo[1] - round - y, y - hi[1] - round);
    if (off > far) return off;
    // 平面内到多边形的有符号距离
    let best = (x - vx[0]) * (x - vx[0]) + (y - vy[0]) * (y - vy[0]);
    let sign = 1;
    for (let i = 0, j = n - 1; i < n; j = i, i++) {
      const ex = vx[j] - vx[i];
      const ey = vy[j] - vy[i];
      const wx = x - vx[i];
      const wy = y - vy[i];
      let t = (wx * ex + wy * ey) / (ex * ex + ey * ey);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const bx = wx - ex * t;
      const by = wy - ey * t;
      const dd = bx * bx + by * by;
      if (dd < best) best = dd;
      const c1 = y >= vy[i];
      const c2 = y < vy[j];
      const c3 = ex * wy > ey * wx;
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sign = -sign;
    }
    const qx = sign * Math.sqrt(best);
    const qz = Math.abs(z) - core;
    const ox = qx > 0 ? qx : 0;
    const oz = qz > 0 ? qz : 0;
    return Math.min(Math.max(qx, qz), 0) + Math.sqrt(ox * ox + oz * oz) - round;
  };
  return { fn, min: [lo[0] - round, lo[1] - round, -half], max: [hi[0] + round, hi[1] + round, half] };
}

/* ---------------- 编译 ---------------- */

const xfPoint = (xf: WorldXf, p: V3): V3 => add(xf.pos, mul(rotate(xf.quat, p), xf.scale));
const IDENTITY: WorldXf = { pos: [0, 0, 0], quat: Q_ID, scale: 1 };

/** 给体块标上它是圆滑加上去的还是挖掉的。origin：部件的原点（关节）在哪，只在根部圆滑的那种要用 */
function asMass(d: Draft, p: { soft?: number; cut?: boolean; fade?: [number, number, number?]; fadeAt?: V3 }, xf: WorldXf): Draft {
  const scale = xf.scale;
  if (p.cut) return { ...d, mode: M_CUT, k: (p.soft ?? 0) * scale };
  if (p.soft) {
    const soft: Draft = { ...d, mode: M_SOFT, k: p.soft * scale };
    // 范围的中心：部件的原点（关节），或者部件里另给的一点（fadeAt）
    const origin = p.fadeAt ? xfPoint(xf, p.fadeAt) : xf.pos;
    return p.fade ? { ...soft, fade: [origin[0], origin[1], origin[2], p.fade[0] * scale, p.fade[1] * scale, (p.fade[2] ?? 0) * scale] } : soft;
  }
  return d;
}

function primDrafts(p: Prim, xf: WorldXf, group: number, minR: number, out: Draft[]) {
  const s = xf.scale;
  switch (p.kind) {
    case 'ellipsoid':
      out.push(
        asMass(
          ellipsoidDraft(group, xfPoint(xf, p.center), mul(p.radii, s), p.quat ? quatMul(xf.quat, p.quat) : xf.quat),
          p,
          xf,
        ),
      );
      break;
    case 'cone': {
      // 挖掉的东西不需要按网格精度加粗
      const min = p.cut ? 0 : minR;
      out.push(
        asMass(coneDraft(group, xfPoint(xf, p.a), xfPoint(xf, p.b), Math.max(p.ra * s, min), Math.max(p.rb * s, min)), p, xf),
      );
      break;
    }
    case 'tube': {
      // 切成一串首尾相接的圆台；长的多切几段
      const n = Math.max(6, Math.min(16, Math.ceil(tubeCurve(p).getLength() / 0.04)));
      const pts = sampleTube(p, n);
      for (let i = 0; i < n; i++) {
        out.push(
          coneDraft(
            group,
            xfPoint(xf, pts[i].point),
            xfPoint(xf, pts[i + 1].point),
            Math.max(pts[i].radius * s, minR),
            Math.max(pts[i + 1].radius * s, minR),
          ),
        );
      }
      break;
    }
    case 'loft': {
      const d = p.fork ? forkedLoft(loftDist(p), p.fork) : loftDist(p);
      out.push(customDraft(group, xf, d.fn, d.min, d.max));
      break;
    }
    case 'wing': {
      const d = wingDist(p, minR / s);
      out.push(customDraft(group, xf, d.fn, d.min, d.max));
      break;
    }
    case 'grid': {
      // 薄薄的一层壳（头发）至少要有一个多体素那么厚，不然在体素网格上会破洞
      const d = gridDist(getGrid(p.grid), p.shell ? { ...p, shell: Math.max(p.shell, (SHELL_VOXELS * minR) / s) } : p);
      out.push(asMass(customDraft(group, xf, d.fn, d.min, d.max, d.outer), p, xf));
      break;
    }
  }
}

/** 一个基本体最细处的半径 */
function thinnestRadius(p: Prim): number {
  switch (p.kind) {
    case 'ellipsoid':
      return p.cut ? Infinity : Math.min(p.radii[0], p.radii[1], p.radii[2]);
    case 'cone':
      return p.cut ? Infinity : Math.min(p.ra, p.rb);
    case 'tube':
      return Math.min(p.r0, tubeTipRadius(p));
    default:
      return Infinity;
  }
}

export function partDrafts(part: Part, xf: WorldXf, group: number, minR: number, out: Draft[]) {
  const fwd = shapeMatrix(part);
  const inv = shapeInverse(part);
  if (!fwd || !inv) {
    for (const p of part.prims) primDrafts(p, xf, group, minR, out);
    return;
  }
  // 被压扁、拉伸的部件：基本体先在没变形的局部坐标里编译，求值时把点反向变回去
  const thin = shapeThin(part);
  // 手动拉伸过的部件：细的地方先按拉伸前的尺寸加粗，拉伸以后最薄的方向还剩一个体素那么粗
  const localMin = part.resize ? minR / (xf.scale * Math.min(...part.resize)) : 0;
  const sub: Draft[] = [];
  // 一层壳（头发）在这里就按网格的精度加厚：它不走下面「整个往外鼓一点」那条路
  for (const p of part.prims) primDrafts(p, IDENTITY, 0, p.kind === 'grid' && p.shell ? minR / (xf.scale * thin) : localMin, sub);
  // 压扁以后最薄的地方（耳尖）可能比体素还薄。不去改半径（那样整只耳朵会变成一根粗棒），
  // 而是把整个形状均匀地往外鼓一点，鼓到最薄处刚好够厚：轮廓还是原来的轮廓
  const thinnest = Math.max(Math.min(...part.prims.map(thinnestRadius)), localMin) * thin * xf.scale;
  const pad = Math.max(0, minR - thinnest) / xf.scale;
  // 每个基本体各包一层、各算各的包围盒：网格化时离得远的块就不用算它
  for (const d of sub) {
    const cut = d.mode === M_CUT;
    const one = pack([{ ...d, mode: M_HARD, k: 0, fade: undefined }], [0]);
    const grow = cut ? 0 : pad;
    const local: Dist = (x, y, z) =>
      evalPrims(
        one,
        one.all,
        1,
        inv[0] * x + inv[1] * y + inv[2] * z,
        inv[3] * x + inv[4] * y + inv[5] * z,
        inv[6] * x + inv[7] * y + inv[8] * z,
      ) *
        thin -
      grow;
    /** 一个盒子变形以后（压扁、拉伸，再往外鼓 grow）占多大 */
    const reshaped = (box: number[]) => {
      const min: V3 = [BIG, BIG, BIG];
      const max: V3 = [-BIG, -BIG, -BIG];
      for (let i = 0; i < 8; i++) {
        const corner = mat3Apply(fwd, [box[i & 1 ? 3 : 0], box[i & 2 ? 4 : 1], box[i & 4 ? 5 : 2]]);
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], corner[k] - grow);
          max[k] = Math.max(max[k], corner[k] + grow);
        }
      }
      return { min, max };
    };
    const local3 = reshaped(d.box);
    const wrapped = customDraft(group, xf, local, local3.min, local3.max, d.span ? reshaped(d.span) : undefined);
    // 圆滑加上去、挖掉的体块：圆角半径跟着一起缩放；只在根部圆滑的，范围以部件在世界里的原点为中心
    out.push(
      d.mode === undefined
        ? wrapped
        : {
            ...wrapped,
            mode: d.mode,
            k: (d.k ?? 0) * thin * xf.scale,
            ...(d.fade ? { fade: [...xfPoint(xf, mat3Apply(fwd, [d.fade[0], d.fade[1], d.fade[2]])), d.fade[3] * xf.scale, d.fade[4] * xf.scale, d.fade[5] * xf.scale] } : {}),
          },
    );
  }
}

/** 单独一个基本体的距离函数（不管它是硬接、圆滑加还是挖掉的：就是它自己的形状） */
export function draftDist(d: Draft): Dist {
  if (d.custom) return d.custom;
  const one = pack([{ ...d, group: 0, mode: M_HARD, k: 0, fade: undefined }], [0]);
  return (x, y, z) => evalPrims(one, one.all, 1, x, y, z);
}

/** 把单独一个部件编译成距离场（点选部件时用）。xf 是它在世界里的变换 */
export function compilePartField(part: Part, xf: WorldXf): CompiledField {
  const drafts: Draft[] = [];
  partDrafts(part, xf, 0, 0, drafts);
  return pack(drafts, [0]);
}

export function pack(drafts: Draft[], groupK: number[]): CompiledField {
  // 每组里先是硬接的，再是圆滑加上去的，最后是挖掉的；求值时就按这个顺序累计
  const sorted = drafts
    .map((d, i) => ({ d, i }))
    .sort((a, b) => a.d.group - b.d.group || (a.d.mode ?? 0) - (b.d.mode ?? 0) || a.i - b.i);
  const count = sorted.length;
  const field: CompiledField = {
    count,
    type: new Uint8Array(count),
    group: new Uint8Array(count),
    mode: new Uint8Array(count),
    primK: new Float64Array(count),
    fade: new Float64Array(count * FADE),
    root: new Float64Array(count * FADE),
    rooted: false,
    data: new Float64Array(count * STRIDE),
    custom: new Array<Dist | null>(count).fill(null),
    box: new Float64Array(count * 6),
    obb: new Float64Array(0),
    obbFrom: new Int32Array(count + 1),
    groupK: Float64Array.from(groupK),
    kMax: Math.max(0, ...groupK),
    all: Int32Array.from({ length: count }, (_, i) => i),
    min: [BIG, BIG, BIG],
    max: [-BIG, -BIG, -BIG],
  };
  const owned = new Map<number, number[]>();
  sorted.forEach(({ d }, i) => {
    field.type[i] = d.type;
    field.group[i] = d.group;
    field.mode[i] = d.mode ?? M_HARD;
    field.primK[i] = d.k ?? 0;
    if (d.fade) field.fade.set(d.fade, i * FADE);
    if (d.root) {
      field.root.set(d.root, i * FADE);
      field.rooted = true;
    }
    field.kMax = Math.max(field.kMax, d.k ?? 0);
    field.data.set(d.nums, i * STRIDE);
    field.custom[i] = d.custom;
    field.box.set(d.box, i * 6);
    if (d.owner !== undefined) {
      const list = owned.get(d.owner);
      if (list) list.push(i);
      else owned.set(d.owner, [i]);
    }
    // 挖掉的东西不算进整体的范围
    if (d.mode === M_CUT) return;
    const range = d.span ?? d.box;
    for (let k = 0; k < 3; k++) {
      field.min[k] = Math.min(field.min[k], range[k]);
      field.max[k] = Math.max(field.max[k], range[k + 3]);
    }
  });
  if (owned.size) field.owned = new Map([...owned].map(([owner, list]) => [owner, Int32Array.from(list)]));
  // 斜盒子：哪一个算不出来（有一边几乎是零宽），这个基本体就不用斜盒子判断
  const boxes = sorted.map(({ d }) => {
    const list = (d.cull ?? (d.corners ? [d.corners] : [])).map(obbOf);
    return list.every(Boolean) ? (list as number[][]) : [];
  });
  field.obb = new Float64Array(boxes.reduce((n, list) => n + list.length * OBB, 0));
  let at = 0;
  boxes.forEach((list, i) => {
    field.obbFrom[i] = at / OBB;
    for (const one of list) {
      field.obb.set(one, at);
      at += OBB;
    }
  });
  field.obbFrom[count] = at / OBB;
  return field;
}

/** 从盒子的 8 个角（见 Draft.corners）写出斜盒子的中心、三根轴、三个半宽（OBB 个数）；有哪一边几乎是零宽的就算不出来 */
function obbOf(c: number[]): number[] | null {
  const axes: number[] = [];
  const half: number[] = [];
  for (const corner of [1, 2, 4]) {
    const dx = c[corner * 3] - c[0];
    const dy = c[corner * 3 + 1] - c[1];
    const dz = c[corner * 3 + 2] - c[2];
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-9) return null;
    axes.push(dx / length, dy / length, dz / length);
    half.push(length / 2);
  }
  return [(c[0] + c[21]) / 2, (c[1] + c[22]) / 2, (c[2] + c[23]) / 2, ...axes, ...half];
}

/**
 * 把一个 Figure 编译成距离场。眼睛不参与融合（它们是另外摆上去的标记）。
 * 场的坐标就是 worldTransforms(figure) 的世界坐标。
 */
export function compileField(figure: Pick<Figure, 'parts' | 'scale'>, options: FieldOptions): CompiledField {
  const xfs = worldTransforms(figure);
  const minR = options.minRadius ?? 0;
  const drafts: Draft[] = [];
  for (const part of figure.parts) {
    const group = GROUP_INDEX.get(part.fuseAs ?? part.type);
    if (group === undefined || part.material === 'eye') continue;
    partDrafts(part, xfs.get(part.name)!, group, minR, drafts);
  }
  return pack(
    drafts,
    GROUPS.map((t) => options.blend * (GROUP_BLEND[t] ?? 1)),
  );
}

/** 直接用一个距离函数当场（测试网格化时用） */
export function fieldFromFunction(fn: Dist, min: V3, max: V3): CompiledField {
  return pack([{ type: T_CUSTOM, group: 0, nums: [], custom: fn, box: [...min, ...max] }], [0]);
}

/* ---------------- 求值 ---------------- */

/** 多项式 smooth-min：两个值相差不到 k 时，在交界处让出一段圆角 */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return a < b ? a : b;
  const h = k - Math.abs(a - b);
  if (h <= 0) return a < b ? a : b;
  return (a < b ? a : b) - (h * h) / (4 * k);
}

/**
 * 在一个点上求场的值，只看 list 里列出的前 n 个基本体（list 要按下标升序，也就是按组排好）。
 */
export function evalPrims(f: CompiledField, list: ArrayLike<number>, n: number, x: number, y: number, z: number): number {
  const d = foldPrims(f, list, n, x, y, z);
  return f.clear === undefined ? d : cleared(f, f.clear, d, x, y, z);
}

/** 要空出来的地方：别的东西挤进来的部分挖掉，护着的那个部件自己加回去（见 Clearance） */
function cleared(f: CompiledField, clear: Clearance[], d: number, x: number, y: number, z: number): number {
  let cut = -BIG;
  let soft = 0;
  let own = BIG;
  for (let i = 0; i < clear.length; i++) {
    const c = clear[i];
    const px = x - c.a[0];
    const py = y - c.a[1];
    const pz = z - c.a[2];
    const along = px * c.axis[0] + py * c.axis[1] + pz * c.axis[2];
    const radial = Math.sqrt(Math.max(px * px + py * py + pz * pz - along * along, 0));
    // 离那段圆柱多远（里面是负的）
    const out = Math.max(-along, along - c.length, radial - c.radius);
    if (out >= c.reach) continue;
    const mine = foldPrims(f, c.list, c.list.length, x, y, z);
    if (mine < own) own = mine;
    if (!c.carve) continue;
    // 这个部件胀大 margin 以后、又在圆柱里面的地方，都要空着（两样的交界处圆一圆）
    const room = smin(c.margin - mine, -out, c.margin);
    if (room > cut) {
      cut = room;
      soft = c.soft ?? 0;
    }
  }
  // 附近没有要挖的：原样
  if (cut === -BIG) return d;
  // 挖开的边上圆一圆（见 Clearance.soft）
  const h = soft - Math.abs(d - cut);
  const carved = (d > cut ? d : cut) + (h > 0 ? (h * h) / (4 * soft) : 0);
  return own < carved ? own : carved;
}

/**
 * 把 list 里的基本体按组累计起来。
 * 这是整个网格化里最热的循环：圆台和椭球直接内联计算，其余走各自的函数。
 */
function foldPrims(f: CompiledField, list: ArrayLike<number>, n: number, x: number, y: number, z: number): number {
  const { type, group, mode, primK, fade, data, custom, groupK, root, rooted } = f;
  let d = BIG;
  let g = -1;
  let dg = BIG;
  /** 这一组里现在是哪个基本体的值最小（它所在的部件离根部多远，决定这一组在这个点上融合的圆角有多大） */
  let win = -1;
  for (let t = 0; t < n; t++) {
    const i = list[t];
    const gi = group[i];
    if (gi !== g) {
      if (g >= 0) d = smin(d, dg, rooted && win >= 0 ? rootBlend(groupK[g], root, win, x, y, z) : groupK[g]);
      g = gi;
      dg = BIG;
      win = -1;
    }
    let v: number;
    const ty = type[i];
    const o = i * STRIDE;
    if (ty === T_CONE) {
      const pax = x - data[o];
      const pay = y - data[o + 1];
      const paz = z - data[o + 2];
      const bax = data[o + 3];
      const bay = data[o + 4];
      const baz = data[o + 5];
      const l2 = data[o + 6];
      const rr = data[o + 7];
      const a2 = data[o + 8];
      const il2 = data[o + 9];
      const yy = pax * bax + pay * bay + paz * baz;
      const zz = yy - l2;
      const qx = pax * l2 - bax * yy;
      const qy = pay * l2 - bay * yy;
      const qz = paz * l2 - baz * yy;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yy * yy * l2;
      const z2 = zz * zz * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) v = Math.sqrt(x2 + z2) * il2 - data[o + 11];
      else if (Math.sign(yy) * a2 * y2 < k) v = Math.sqrt(x2 + y2) * il2 - data[o + 10];
      else v = (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - data[o + 10];
    } else if (ty === T_ELLIPSOID) {
      const px = x - data[o];
      const py = y - data[o + 1];
      const pz = z - data[o + 2];
      const irx = data[o + 12];
      const iry = data[o + 13];
      const irz = data[o + 14];
      const ux = (data[o + 3] * px + data[o + 4] * py + data[o + 5] * pz) * irx;
      const uy = (data[o + 6] * px + data[o + 7] * py + data[o + 8] * pz) * iry;
      const uz = (data[o + 9] * px + data[o + 10] * py + data[o + 11] * pz) * irz;
      const k0 = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (k0 < 1e-9) v = -data[o + 15];
      else {
        const wx = ux * irx;
        const wy = uy * iry;
        const wz = uz * irz;
        v = (k0 * (k0 - 1)) / Math.sqrt(wx * wx + wy * wy + wz * wz);
      }
    } else {
      v = custom[i]!(x, y, z);
    }
    const m = mode[i];
    if (m !== M_CUT && v < dg) win = i;
    if (m === M_HARD) {
      if (v < dg) dg = v;
    } else if (m === M_SOFT) {
      let k = primK[i];
      const far = fade[i * FADE + 4];
      if (far > 0) {
        // 只在根部圆滑：离根部越远圆角越小，出了范围就是硬接
        const fx = x - fade[i * FADE];
        const fy = y - fade[i * FADE + 1];
        const fz = z - fade[i * FADE + 2];
        const r = Math.sqrt(fx * fx + fy * fy + fz * fz);
        const near = fade[i * FADE + 3];
        const rest = fade[i * FADE + 5];
        if (r >= far) k = rest;
        else if (r > near) {
          const t = (far - r) / (far - near);
          k = rest + (k - rest) * t * t * (3 - 2 * t);
        }
      }
      dg = smin(dg, v, k);
    } else {
      // 挖掉：smooth-max(dg, -v)
      dg = -smin(-dg, v, primK[i]);
    }
  }
  if (g >= 0) d = smin(d, dg, rooted && win >= 0 ? rootBlend(groupK[g], root, win, x, y, z) : groupK[g]);
  return d;
}

/** 只在根部融合的部件：离根部越远，和别的类之间的圆角越小，出了范围就是硬接 */
function rootBlend(k: number, root: Float64Array, i: number, x: number, y: number, z: number): number {
  const o = i * FADE;
  const far = root[o + 4];
  if (far <= 0) return k;
  const dx = x - root[o];
  const dy = y - root[o + 1];
  const dz = z - root[o + 2];
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const near = root[o + 3];
  if (r <= near) return k;
  if (r >= far) return 0;
  const t = (far - r) / (far - near);
  return k * t * t * (3 - 2 * t);
}

/** 在一个点上求整个场的值（不做任何裁剪，慢；摆位时找表面、测试和调试用） */
export function fieldAt(f: CompiledField, x: number, y: number, z: number): number {
  return evalPrims(f, f.all, f.count, x, y, z);
}

/**
 * 从 origin 沿 dir（单位向量）走，返回碰到表面时走了多远；maxT 以内没碰到就返回 maxT。
 * 摆位时用它把眼睛、角、耳朵贴到头的表面上。
 */
export function castRay(f: CompiledField, origin: V3, dir: V3, maxT: number): number {
  let t = 0;
  for (let i = 0; i < 96 && t < maxT; i++) {
    const d = fieldAt(f, origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t);
    if (d < 2e-5) return t;
    // 椭球的距离是近似值，步子收着点走
    t += d * 0.8;
  }
  return Math.min(t, maxT);
}
