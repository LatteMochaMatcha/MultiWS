/**
 * Surface Nets：在体素网格上找出距离场变号的格子，每个这样的格子放一个顶点，
 * 相邻的四个格子连成一个四边形。得到的是一张封闭、以四边形为主的网格，适合直接进雕刻。
 *
 * 为了又快又省内存，网格分成 8×8×8 的小块：只有附近有部件的小块才会求值，
 * 只有表面穿过的小块才会保留下来。
 *
 * 分三段：分小块（planBlocks）、在各小块的格点上求值（evaluateBlocks）、补实取面（meshField 剩下的部分）。
 * 求值最费时，各小块之间互不相干：可以先在别处（别的线程）把一部分小块算好，经 BlockMemo 交给 meshField 照抄。
 */
import { type CompiledField, OBB, evalPrims } from './field';

/** 每个小块每条边有几个格子 */
const B = 8;
/** 每个小块每条边有几个格点（比格子多一个，和相邻小块共用边界） */
const L = B + 1;
const L2 = L * L;
const L3 = L * L * L;
const B3 = B * B * B;

/** 一个格子 12 条棱的两个端点（角的编号：第 0 位是 x，第 1 位是 y，第 2 位是 z） */
const EDGE_A = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3];
const EDGE_B = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
/** 六个面，各按绕一圈的顺序列出四个角 */
const FACES = [
  [0, 1, 3, 2],
  [4, 5, 7, 6],
  [0, 1, 5, 4],
  [2, 3, 7, 6],
  [0, 2, 6, 4],
  [1, 3, 7, 5],
];

/** 一组角（按位表示）沿着格子的棱是不是连成一片 */
function connected(set: number): boolean {
  if (!set) return true;
  let seen = set & -set;
  for (let grew = true; grew; ) {
    grew = false;
    for (let c = 0; c < 8; c++) {
      if (!(seen & (1 << c))) continue;
      for (const n of [c ^ 1, c ^ 2, c ^ 4]) {
        if (set & (1 << n) && !(seen & (1 << n))) {
          seen |= 1 << n;
          grew = true;
        }
      }
    }
  }
  return seen === set;
}

/**
 * 一个格子八个角的内外情况（按位，1 是在里面）能不能连出干净的面：
 * 任何一个面上都不能是「对角在里面、另一对角在外面」，并且里面的角连成一片、外面的角也连成一片。
 */
function clean(mask: number): boolean {
  for (const [a, b, c, d] of FACES) {
    const ia = (mask >> a) & 1;
    const ib = (mask >> b) & 1;
    if (ia !== ib && ia === ((mask >> c) & 1) && ib === ((mask >> d) & 1)) return false;
  }
  return connected(mask) && connected(~mask & 255);
}

const popcount = (v: number) => {
  let n = 0;
  for (; v; v &= v - 1) n++;
  return n;
};

/** 对每种内外情况：要把哪几个在外面的角改成在里面，格子才干净（已经干净的是 0） */
const FILL = (() => {
  const subsets = Array.from({ length: 256 }, (_, i) => i).sort((a, b) => popcount(a) - popcount(b));
  const table = new Uint8Array(256);
  for (let mask = 0; mask < 256; mask++) {
    if (clean(mask)) continue;
    table[mask] = subsets.find((s) => s && !(s & mask) && clean(mask | s))!;
  }
  return table;
})();

export interface FusedMeshInfo {
  voxel: number;
  vertices: number;
  quads: number;
  /** 三角面一共多少：四边形各算两个，再加上不是四边形的那些（缝上去的手） */
  triangles: number;
  /** 网格由几块互不相连的部分组成；正常应该是 1 */
  components: number;
  /** 丢掉了几个封在身体内部的空腔 */
  cavities: number;
  /** 丢掉了几个比体素还小的碎屑 */
  specks: number;
  /** 求过值的小块数 */
  blocks: number;
  /** 网格化耗时（毫秒） */
  ms: number;
}

export interface FusedMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** 四边形，每 4 个下标一个，逆时针朝外 */
  quads: Uint32Array;
  /** 全部的三角面：四边形各沿较短的对角线切成两个（第 k 个四边形是第 2k、2k + 1 个三角形），后面接着 tris */
  triangles: Uint32Array;
  /** 本来就是三角面的那些（缝上去的手、缝合的那一圈，见 graft.ts）；没有就没有这一项 */
  tris?: Uint32Array;
  /**
   * 自带蒙皮权重的顶点（缝上去的手）：从第 start 个顶点到最后一个。
   * 每个顶点 4 根骨骼：joints 是 bones 里的下标，bones 里是骨架里的骨骼名；weights 加起来是 1
   */
  bound?: { start: number; bones: string[]; joints: Uint16Array; weights: Float32Array };
  info: FusedMeshInfo;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * 哪些小块碰到了要挖开的地方（field.clear 里 carve 的那几处，各自离圆柱 reach 以内）：只有这些小块里的值和没有 clear 时不一样。
 * 只护着、不挖的那几处不改值（见 field.ts 里 cleared）
 */
function changedBlocks(field: CompiledField, ox: number, oy: number, oz: number, bx: number, by: number, bz: number, size: number): Uint8Array {
  const out = new Uint8Array(bx * by * bz);
  for (const c of field.clear ?? []) {
    if (!c.carve) continue;
    const grow = c.radius + c.reach;
    const lo = [0, 1, 2].map((k) => Math.min(c.a[k], c.a[k] + c.axis[k] * c.length) - grow);
    const hi = [0, 1, 2].map((k) => Math.max(c.a[k], c.a[k] + c.axis[k] * c.length) + grow);
    const span = (k: number, o: number, n: number) => [Math.max(0, Math.floor((lo[k] - o) / size)), Math.min(n - 1, Math.floor((hi[k] - o) / size))];
    const [i0, i1] = span(0, ox, bx);
    const [j0, j1] = span(1, oy, by);
    const [k0, k1] = span(2, oz, bz);
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out[i + bx * (j + by * k)] = 1;
  }
  return out;
}

/**
 * 中心在 (x, y, z)、半边长 half 的正方体，离第 o 个数起的那个斜盒子（见 CompiledField.obb）是不是比 gap 还远：
 * 沿斜盒子的三根轴各看一下，有一根轴上两者的投影隔开了就是（只看这三根轴，判不出来的当作挨着）
 */
function apart(obb: Float64Array, o: number, x: number, y: number, z: number, half: number, gap: number): boolean {
  const dx = x - obb[o];
  const dy = y - obb[o + 1];
  const dz = z - obb[o + 2];
  for (let a = 0; a < 3; a++) {
    const ux = obb[o + 3 + a * 3];
    const uy = obb[o + 4 + a * 3];
    const uz = obb[o + 5 + a * 3];
    const along = dx * ux + dy * uy + dz * uz;
    const cube = half * ((ux < 0 ? -ux : ux) + (uy < 0 ? -uy : uy) + (uz < 0 ? -uz : uz));
    if ((along < 0 ? -along : along) > obb[o + 12 + a] + cube + gap) return true;
  }
  return false;
}

/**
 * 小块正中的那些格点各算好了没有、算出来是什么（补实之前的值）。meshField 遇到这里有的小块直接照抄，不再求值。
 * 两种来路：先在别处把小块算好放进来（keepBlocks）；
 * 同一个场先后融合两遍、第二遍只多了几处要空出来的地方（field.clear，见 fuse.ts）时，第一遍把自己算的存在这里，
 * 第二遍离那几处远的小块照抄
 */
export interface BlockMemo {
  saved?: {
    /** 格点、小块的排法（BlockPlan.key）：一样的才抄 */
    key: string;
    /** 哪些小块有数（没有的照常求值） */
    done: Uint8Array;
    /** 有表面穿过的小块的值 */
    values: (Float32Array | undefined)[];
    /** 整块都在里面的小块 */
    solid: Uint8Array;
  };
}

/** 场分成的小块（第 1 步的结果） */
export interface BlockPlan {
  /** 体素边长 */
  h: number;
  /** 第一个格点的位置 */
  ox: number;
  oy: number;
  oz: number;
  /** 三个方向各几个小块 */
  bx: number;
  by: number;
  bz: number;
  /** 每个小块附近有哪些基本体（下标升序）；附近没有基本体的小块是 undefined，不用求值 */
  lists: (number[] | undefined)[];
  /** 格点、小块的排法：一样的两份才能互相交换求出来的值 */
  key: string;
}

/** 第 1 步：场分成小块，每个小块附近有哪些基本体 */
export function planBlocks(field: CompiledField, voxel: number): BlockPlan {
  const h = voxel;
  // 一个基本体能影响到的范围：圆角半径再加两个体素
  const reach = field.kMax + 2 * h;
  const pad = reach + h;
  const ox = field.min[0] - pad;
  const oy = field.min[1] - pad;
  const oz = field.min[2] - pad;
  const bx = Math.max(1, Math.ceil((field.max[0] + pad - ox) / (h * B)));
  const by = Math.max(1, Math.ceil((field.max[1] + pad - oy) / (h * B)));
  const bz = Math.max(1, Math.ceil((field.max[2] + pad - oz) / (h * B)));
  const blockCount = bx * by * bz;
  const blockSize = h * B;
  const lists: (number[] | undefined)[] = new Array(blockCount);
  const clampIndex = (v: number, n: number) => (v < 0 ? 0 : v >= n ? n - 1 : v);
  for (let p = 0; p < field.count; p++) {
    const o = p * 6;
    // 自己带圆角的基本体（圆滑加上去的、挖掉的）影响得更远：它先把周围的值拉低一点，
    // 后面的基本体再跟这个值圆滑过渡。少算了它，相邻两个小块在共用的格点上会算出不一样的值，
    // 正好一正一负的话，接缝上就会漏面。
    const r = reach + field.primK[p];
    const i0 = clampIndex(Math.floor((field.box[o] - r - ox) / blockSize), bx);
    const j0 = clampIndex(Math.floor((field.box[o + 1] - r - oy) / blockSize), by);
    const k0 = clampIndex(Math.floor((field.box[o + 2] - r - oz) / blockSize), bz);
    const i1 = clampIndex(Math.floor((field.box[o + 3] + r - ox) / blockSize), bx);
    const j1 = clampIndex(Math.floor((field.box[o + 4] + r - oy) / blockSize), by);
    const k1 = clampIndex(Math.floor((field.box[o + 5] + r - oz) / blockSize), bz);
    // 斜着放的基本体：正放的盒子比它自己那个斜的盒子大出很多，离它的斜盒子（有几个的话，离哪一个都）远的小块就不算它
    const from = field.obbFrom[p];
    const to = field.obbFrom[p + 1];
    for (let k = k0; k <= k1; k++) {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (from < to) {
            const cx = ox + (i + 0.5) * blockSize;
            const cy = oy + (j + 0.5) * blockSize;
            const cz = oz + (k + 0.5) * blockSize;
            let near = false;
            for (let q = from; q < to && !near; q++) near = !apart(field.obb, q * OBB, cx, cy, cz, blockSize / 2, r);
            if (!near) continue;
          }
          const b = i + bx * (j + by * k);
          (lists[b] ??= []).push(p);
        }
      }
    }
  }
  return { h, ox, oy, oz, bx, by, bz, lists, key: `${ox},${oy},${oz},${bx},${by},${bz},${h},${field.count}` };
}

/** 第 b 个小块的 L³ 个格点上的值（x 变得最快，然后 y、z）写进 out；返回有几个在里面（值小于 0） */
export function evaluateBlock(field: CompiledField, plan: BlockPlan, b: number, out: Float32Array): number {
  const { h, ox, oy, oz, bx, by } = plan;
  const list = plan.lists[b]!;
  const bi = b % bx;
  const bj = Math.floor(b / bx) % by;
  const bk = Math.floor(b / (bx * by));
  const n = list.length;
  let inside = 0;
  let c = 0;
  for (let k = 0; k < L; k++) {
    const z = oz + (bk * B + k) * h;
    for (let j = 0; j < L; j++) {
      const y = oy + (bj * B + j) * h;
      for (let i = 0; i < L; i++) {
        const d = evalPrims(field, list, n, ox + (bi * B + i) * h, y, z);
        out[c++] = d;
        if (d < 0) inside++;
      }
    }
  }
  return inside;
}

/** 小块求值的结果分三类 */
const OUTSIDE = 0;
const INSIDE = 1;
const SURFACE = 2;

/**
 * 一批小块求出来的值，打包成几个大数组（在线程之间可以整个移交，不用复制）。
 * blocks 是哪几个小块；kinds 是各自的类别（整块在外、整块在里、有表面）；有表面的依次在 data 里各占 L³ 个数
 */
export interface BlockValues {
  key: string;
  blocks: Int32Array;
  kinds: Uint8Array;
  data: Float32Array;
}

/** 第 2 步：在这几个小块（都要是附近有基本体的）的格点上求值 */
export function evaluateBlocks(field: CompiledField, plan: BlockPlan, blocks: ArrayLike<number>): BlockValues {
  const kinds = new Uint8Array(blocks.length);
  const kept: Float32Array[] = [];
  let v = new Float32Array(L3);
  for (let i = 0; i < blocks.length; i++) {
    const inside = evaluateBlock(field, plan, blocks[i], v);
    if (inside === L3) kinds[i] = INSIDE;
    else if (inside === 0) kinds[i] = OUTSIDE;
    else {
      kinds[i] = SURFACE;
      kept.push(v);
      v = new Float32Array(L3);
    }
  }
  const data = new Float32Array(kept.length * L3);
  kept.forEach((one, i) => data.set(one, i * L3));
  return { key: plan.key, blocks: Int32Array.from(blocks), kinds, data };
}

/** 附近有基本体（要求值）的小块，按下标排好 */
export function blocksToEvaluate(plan: BlockPlan): Int32Array {
  const out: number[] = [];
  plan.lists.forEach((list, b) => {
    if (list) out.push(b);
  });
  return Int32Array.from(out);
}

/** 把别处算好的几批小块放进 memo，交给 meshField 照抄。排法和 plan 不一样的那批不要 */
export function keepBlocks(plan: BlockPlan, batches: readonly BlockValues[], memo: BlockMemo = {}): BlockMemo {
  const count = plan.bx * plan.by * plan.bz;
  const saved = { key: plan.key, done: new Uint8Array(count), values: new Array<Float32Array | undefined>(count), solid: new Uint8Array(count) };
  for (const batch of batches) {
    if (batch.key !== plan.key) continue;
    let at = 0;
    batch.blocks.forEach((b, i) => {
      saved.done[b] = 1;
      if (batch.kinds[i] === INSIDE) saved.solid[b] = 1;
      else if (batch.kinds[i] === SURFACE) {
        saved.values[b] = batch.data.subarray(at * L3, (at + 1) * L3);
        at++;
      }
    });
  }
  memo.saved = saved;
  return memo;
}

export function meshField(field: CompiledField, voxel: number, memo?: BlockMemo): FusedMesh {
  const t0 = now();
  /* ---- 1. 每个小块附近有哪些基本体 ---- */
  const plan = planBlocks(field, voxel);
  const { h, ox, oy, oz, bx, by, bz, lists, key } = plan;
  const blockCount = bx * by * bz;

  /* ---- 2. 在格点上求值；整块都在里面或都在外面的不用留 ---- */
  const values: (Float32Array | undefined)[] = new Array(blockCount);
  /** 整块都在身体里面的小块：没有表面，也不可能再被改动 */
  const solid = new Uint8Array(blockCount);
  let insideCount = 0;
  const evaluate = (b: number): Float32Array => {
    const v = new Float32Array(L3);
    insideCount = evaluateBlock(field, plan, b, v);
    return v;
  };
  let evaluated = 0;
  // 格点、小块的排法一样，才抄得了 memo 里的
  const reuse = memo?.saved?.key === key ? memo.saved : undefined;
  const changed = reuse ? changedBlocks(field, ox, oy, oz, bx, by, bz, h * B) : undefined;
  for (let b = 0; b < blockCount; b++) {
    if (!lists[b]) continue;
    if (reuse?.done[b] && !changed![b]) {
      if (reuse.solid[b]) solid[b] = 1;
      else if (reuse.values[b]) values[b] = reuse.values[b]!.slice();
      continue;
    }
    evaluated++;
    const v = evaluate(b);
    if (insideCount === L3) solid[b] = 1;
    else if (insideCount > 0) values[b] = v;
  }
  // 下面补实时会改这些值：先存一份原样的（每个附近有基本体的小块这时都有数了）
  if (memo && !reuse) {
    const done = new Uint8Array(blockCount);
    for (let b = 0; b < blockCount; b++) if (lists[b]) done[b] = 1;
    memo.saved = { key, done, values: values.map((v) => v?.slice()), solid: solid.slice() };
  }

  /* ---- 2.5 把分辨不清的地方补实 ----
     两层皮贴得比一个体素还近时，格子里会出现「对角在里面、另一对角在外面」这类情况，
     直接连面会得到四个面共用一条边、或者两片面只靠一个点连着的坏网格。
     这里把这种格子里少数几个在外面的格点改成在里面（相当于把细缝填上），直到没有这种格子。 */
  const filled = -0.3 * h;
  const queue: number[] = [];
  const queued = new Uint8Array(blockCount);
  for (let b = 0; b < blockCount; b++) {
    if (values[b]) {
      queue.push(b);
      queued[b] = 1;
    }
  }
  // 一个格点落在小块边界上时同时属于相邻的几个小块，要一起改
  const span = (g: number, blocks: number, out: number[]) => {
    const q = Math.floor(g / B);
    const local = g - q * B;
    let n = 0;
    if (q < blocks) {
      out[n++] = q;
      out[n++] = local;
    }
    if (local === 0 && q > 0) {
      out[n++] = q - 1;
      out[n++] = B;
    }
    return n;
  };
  const sx = [0, 0, 0, 0];
  const sy = [0, 0, 0, 0];
  const sz = [0, 0, 0, 0];
  const fillPoint = (gx: number, gy: number, gz: number) => {
    const nx = span(gx, bx, sx);
    const ny = span(gy, by, sy);
    const nz = span(gz, bz, sz);
    for (let c = 0; c < nz; c += 2) {
      for (let b2 = 0; b2 < ny; b2 += 2) {
        for (let a = 0; a < nx; a += 2) {
          const b = sx[a] + bx * (sy[b2] + by * sz[c]);
          if (!lists[b] || solid[b]) continue;
          // 原先整块都在外面、所以没留下来的小块：现在有格点进到里面了，重新算出来
          const v = (values[b] ??= evaluate(b));
          const at = sx[a + 1] + L * (sy[b2 + 1] + L * sz[c + 1]);
          if (v[at] >= 0) v[at] = filled;
          if (!queued[b]) {
            queued[b] = 1;
            queue.push(b);
          }
        }
      }
    }
  };
  while (queue.length) {
    const b = queue.pop()!;
    queued[b] = 0;
    const v = values[b]!;
    const gi0 = (b % bx) * B;
    const gj0 = (Math.floor(b / bx) % by) * B;
    const gk0 = Math.floor(b / (bx * by)) * B;
    for (let k = 0; k < B; k++) {
      for (let j = 0; j < B; j++) {
        for (let i = 0; i < B; i++) {
          const c = i + L * (j + L * k);
          const mask =
            (v[c] < 0 ? 1 : 0) |
            (v[c + 1] < 0 ? 2 : 0) |
            (v[c + L] < 0 ? 4 : 0) |
            (v[c + L + 1] < 0 ? 8 : 0) |
            (v[c + L2] < 0 ? 16 : 0) |
            (v[c + L2 + 1] < 0 ? 32 : 0) |
            (v[c + L2 + L] < 0 ? 64 : 0) |
            (v[c + L2 + L + 1] < 0 ? 128 : 0);
          const fill = FILL[mask];
          if (!fill) continue;
          for (let q = 0; q < 8; q++) {
            if (fill & (1 << q)) fillPoint(gi0 + i + (q & 1), gj0 + j + ((q >> 1) & 1), gk0 + k + ((q >> 2) & 1));
          }
        }
      }
    }
  }

  /* ---- 3. 变号的格子各放一个顶点：取各条变号棱上零点的平均位置 ---- */
  const cellVertex: (Int32Array | undefined)[] = new Array(blockCount);
  const pos: number[] = [];
  const corner = new Float64Array(8);
  let vertexCount = 0;
  for (let b = 0; b < blockCount; b++) {
    const v = values[b];
    if (!v) continue;
    const bi = b % bx;
    const bj = Math.floor(b / bx) % by;
    const bk = Math.floor(b / (bx * by));
    const ids = new Int32Array(B3).fill(-1);
    for (let k = 0; k < B; k++) {
      for (let j = 0; j < B; j++) {
        for (let i = 0; i < B; i++) {
          const c = i + L * (j + L * k);
          corner[0] = v[c];
          corner[1] = v[c + 1];
          corner[2] = v[c + L];
          corner[3] = v[c + L + 1];
          corner[4] = v[c + L2];
          corner[5] = v[c + L2 + 1];
          corner[6] = v[c + L2 + L];
          corner[7] = v[c + L2 + L + 1];
          let neg = 0;
          for (let q = 0; q < 8; q++) if (corner[q] < 0) neg++;
          if (neg === 0 || neg === 8) continue;
          let sx = 0;
          let sy = 0;
          let sz = 0;
          let crossings = 0;
          for (let e = 0; e < 12; e++) {
            const a = EDGE_A[e];
            const bb = EDGE_B[e];
            const va = corner[a];
            const vb = corner[bb];
            if (va < 0 === vb < 0) continue;
            const t = va / (va - vb);
            const ax = a & 1;
            const ay = (a >> 1) & 1;
            const az = (a >> 2) & 1;
            sx += ax + t * ((bb & 1) - ax);
            sy += ay + t * (((bb >> 1) & 1) - ay);
            sz += az + t * (((bb >> 2) & 1) - az);
            crossings++;
          }
          pos.push(
            ox + (bi * B + i + sx / crossings) * h,
            oy + (bj * B + j + sy / crossings) * h,
            oz + (bk * B + k + sz / crossings) * h,
          );
          ids[i + B * (j + B * k)] = vertexCount++;
        }
      }
    }
    cellVertex[b] = ids;
  }

  /* ---- 4. 每条变号的棱，把围着它的四个格子的顶点连成一个四边形 ---- */
  // 按全局格子坐标找顶点（B = 8，所以 >> 3 是块号，& 7 是块内下标）
  const vertexAt = (gi: number, gj: number, gk: number): number => {
    if (gi < 0 || gj < 0 || gk < 0) return -1;
    const ids = cellVertex[(gi >> 3) + bx * ((gj >> 3) + by * (gk >> 3))];
    return ids ? ids[(gi & 7) + B * ((gj & 7) + B * (gk & 7))] : -1;
  };
  const quads: number[] = [];
  const emit = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) quads.push(a, d, c, b);
    else quads.push(a, b, c, d);
  };
  for (let b = 0; b < blockCount; b++) {
    const v = values[b];
    const ids = cellVertex[b];
    if (!v || !ids) continue;
    const gi0 = (b % bx) * B;
    const gj0 = (Math.floor(b / bx) % by) * B;
    const gk0 = Math.floor(b / (bx * by)) * B;
    for (let k = 0; k < B; k++) {
      for (let j = 0; j < B; j++) {
        for (let i = 0; i < B; i++) {
          const self = ids[i + B * (j + B * k)];
          if (self < 0) continue;
          const c = i + L * (j + L * k);
          const inside = v[c] < 0;
          const gi = gi0 + i;
          const gj = gj0 + j;
          const gk = gk0 + k;
          // 从这个格子的最小角出发的三条棱。棱的起点在里面时，面朝棱的正方向
          if (v[c + 1] < 0 !== inside) {
            emit(self, vertexAt(gi, gj - 1, gk), vertexAt(gi, gj - 1, gk - 1), vertexAt(gi, gj, gk - 1), !inside);
          }
          if (v[c + L] < 0 !== inside) {
            emit(self, vertexAt(gi, gj, gk - 1), vertexAt(gi - 1, gj, gk - 1), vertexAt(gi - 1, gj, gk), !inside);
          }
          if (v[c + L2] < 0 !== inside) {
            emit(self, vertexAt(gi - 1, gj, gk), vertexAt(gi - 1, gj - 1, gk), vertexAt(gi, gj - 1, gk), !inside);
          }
        }
      }
    }
  }

  /* ---- 5. 清理：去掉封在体内的空腔和零星碎屑 ---- */
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  const find = (i: number) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let q = 0; q < quads.length; q += 4) {
    const r = find(quads[q]);
    for (let t = 1; t < 4; t++) {
      const s = find(quads[q + t]);
      if (s !== r) parent[s] = r;
    }
  }
  // 每一块的有符号体积：朝外的封闭曲面为正，空腔的内壁为负
  const volume = new Float64Array(vertexCount);
  const triVolume = (a: number, b: number, c: number) => {
    const ax = pos[a * 3];
    const ay = pos[a * 3 + 1];
    const az = pos[a * 3 + 2];
    const bx2 = pos[b * 3];
    const by2 = pos[b * 3 + 1];
    const bz2 = pos[b * 3 + 2];
    const cx = pos[c * 3];
    const cy = pos[c * 3 + 1];
    const cz = pos[c * 3 + 2];
    return (ax * (by2 * cz - bz2 * cy) + ay * (bz2 * cx - bx2 * cz) + az * (bx2 * cy - by2 * cx)) / 6;
  };
  for (let q = 0; q < quads.length; q += 4) {
    volume[find(quads[q])] +=
      triVolume(quads[q], quads[q + 1], quads[q + 2]) + triVolume(quads[q], quads[q + 2], quads[q + 3]);
  }
  const speck = 8 * h * h * h;
  let components = 0;
  let cavities = 0;
  let specks = 0;
  const keepRoot = new Uint8Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    if (parent[i] !== i) continue;
    if (volume[i] < 0) cavities++;
    else if (volume[i] < speck) specks++;
    else {
      keepRoot[i] = 1;
      components++;
    }
  }

  const remap = new Int32Array(vertexCount).fill(-1);
  let kept = 0;
  for (let i = 0; i < vertexCount; i++) if (keepRoot[find(i)]) remap[i] = kept++;
  const positions = new Float32Array(kept * 3);
  for (let i = 0; i < vertexCount; i++) {
    const r = remap[i];
    if (r < 0) continue;
    positions[r * 3] = pos[i * 3];
    positions[r * 3 + 1] = pos[i * 3 + 1];
    positions[r * 3 + 2] = pos[i * 3 + 2];
  }
  let keptQuads = 0;
  for (let q = 0; q < quads.length; q += 4) if (remap[quads[q]] >= 0) keptQuads++;
  const outQuads = new Uint32Array(keptQuads * 4);
  const triangles = new Uint32Array(keptQuads * 6);
  const normals = new Float32Array(kept * 3);
  let w = 0;
  for (let q = 0; q < quads.length; q += 4) {
    const a = remap[quads[q]];
    if (a < 0) continue;
    const b = remap[quads[q + 1]];
    const c = remap[quads[q + 2]];
    const d = remap[quads[q + 3]];
    outQuads[w * 4] = a;
    outQuads[w * 4 + 1] = b;
    outQuads[w * 4 + 2] = c;
    outQuads[w * 4 + 3] = d;

    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const bx2 = positions[b * 3];
    const by2 = positions[b * 3 + 1];
    const bz2 = positions[b * 3 + 2];
    const cx = positions[c * 3];
    const cy = positions[c * 3 + 1];
    const cz = positions[c * 3 + 2];
    const dx = positions[d * 3];
    const dy = positions[d * 3 + 1];
    const dz = positions[d * 3 + 2];
    // 两条对角线：ac 和 bd。沿较短的那条切开，三角形更匀称
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const bdx = dx - bx2;
    const bdy = dy - by2;
    const bdz = dz - bz2;
    if (acx * acx + acy * acy + acz * acz <= bdx * bdx + bdy * bdy + bdz * bdz) {
      triangles.set([a, b, c, a, c, d], w * 6);
    } else {
      triangles.set([a, b, d, b, c, d], w * 6);
    }
    // 对角线的叉积就是四边形的面法线（长度正比于面积），累加到四个顶点上
    const nx = acy * bdz - acz * bdy;
    const ny = acz * bdx - acx * bdz;
    const nz = acx * bdy - acy * bdx;
    for (const vtx of [a, b, c, d]) {
      normals[vtx * 3] += nx;
      normals[vtx * 3 + 1] += ny;
      normals[vtx * 3 + 2] += nz;
    }
    w++;
  }
  for (let i = 0; i < kept; i++) {
    const len = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) || 1;
    normals[i * 3] /= len;
    normals[i * 3 + 1] /= len;
    normals[i * 3 + 2] /= len;
  }

  return {
    positions,
    normals,
    quads: outQuads,
    triangles,
    info: {
      voxel,
      vertices: kept,
      quads: keptQuads,
      triangles: keptQuads * 2,
      components,
      cavities,
      specks,
      blocks: evaluated,
      ms: now() - t0,
    },
  };
}
