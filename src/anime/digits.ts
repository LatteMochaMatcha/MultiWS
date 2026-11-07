/**
 * 手指有几根：把现成的手（anime/hand.ts）照原样复制、或者拿掉「一根手指 + 它底下那一条手掌」，不自己捏手指。
 *
 * 1. 在相邻两根手指的指缝里各横着切一刀（刀面和拇指 → 小指的方向垂直，切在指缝最浅的地方，只切过手掌和指蹼），
 *    手就分成一条一条：拇指连食指那一条、中指、无名指、小指；
 * 2. 照要的根数重新排：多了就把中指那一条复制几份插在中指后面（新的手指叫 FingerA、FingerB、FingerC），
 *    少了就拿掉无名指、再拿掉中指；
 * 3. 相邻两条的切口是两条差不多的曲线（手掌在不同指缝处的截面），各自在对方的点上补点，再一对一焊成一条：
 *    缝完还是一整块、只有手腕一个开口的网格；
 * 4. 手掌靠手腕的那一截往回收一点：手指多了手腕不跟着宽那么多，少了也不窄那么多（拇指那一条不动）。
 *
 * 骨骼、权重跟着复制：每一条上原来记着「上一根、下一根手指」的那点权重，换成新排法里上一根、下一根手指的；没有了的给手掌。
 * 纯函数，在 Web Worker 和单元测试里都能跑。
 */
import type { V3 } from '../geometry/vec';
import type { GraftMesh } from './graftMesh';

/** 一只手几根手指（连拇指）：最少、最多、现成的那只手本来的 */
export const FINGER_COUNT = { min: 3, max: 8, base: 5 } as const;
/** 多出来的手指（插在无名指后面）的名字，从拇指那边数起 */
export const EXTRA_FINGERS = ['FingerA', 'FingerB', 'FingerC'] as const;
/** 四指本来的名字，拇指那边数起 */
const FOUR = ['Index', 'Middle', 'Ring', 'Little'] as const;

/** 一根手指的四个关节（指根、两个指节、指尖），在网格自己的坐标里 */
export interface FingerJoints {
  finger: string;
  joints: V3[];
}

export interface ShapedHand {
  mesh: GraftMesh;
  /** 这只手上的手指，拇指在前，往小指那边排 */
  fingers: FingerJoints[];
}

/**
 * 照总根数（连拇指）排出四指那几条：0 食指（连拇指）、1 中指、2 无名指、3 小指；
 * 4 是复制出来的手指（照原样平移复制无名指那一条），插在无名指和小指之间。
 * 复制无名指不复制中指：无名指两边的指缝（和中指、和小指之间）截面差不多，一条接一条焊得平；
 * 中指两边的指缝一深一浅，焊上去手心有一道沟。照正中镜像也不行：手掌横着是斜的，镜像过来正中折出一道沟
 */
export function fingerSlabs(count: number): number[] {
  const n = Math.round(Math.min(FINGER_COUNT.max, Math.max(FINGER_COUNT.min, count))) - 1;
  if (n === 2) return [0, 3];
  if (n === 3) return [0, 1, 3];
  return [0, 1, 2, ...Array.from({ length: n - 4 }, () => TILE), 3];
}
/** fingerSlabs 里复制出来的那一条 */
const TILE = 4;

/** 新排法里每一条的手指名：复制出来的依次叫 FingerA … */
function slabNames(order: number[]): string[] {
  let extra = 0;
  return order.map((s) => (s === TILE ? EXTRA_FINGERS[extra++] : FOUR[s]));
}

/* ---------------- 一堆三角面，带着每个顶点的法线、权重 ---------------- */

interface Soup {
  /** 每个顶点 3 个 */
  P: number[];
  N: number[];
  /** 每个顶点 4 个：骨骼名（不带左右）和权重 */
  J: string[];
  W: number[];
  /** 每个三角面 3 个 */
  T: number[];
  /** 每个三角面属于哪一块（拼的时候才用：手掌那一块是 0，接上去的手指那几条是 1） */
  G?: number[];
}

const emptySoup = (): Soup => ({ P: [], N: [], J: [], W: [], T: [] });

function soupOf(mesh: GraftMesh): Soup {
  const count = mesh.positions.length / 3;
  const J: string[] = [];
  for (let i = 0; i < count * 4; i++) J.push(mesh.bones[mesh.joints[i]]);
  return { P: [...mesh.positions], N: [...mesh.normals], J, W: [...mesh.weights], T: [...mesh.triangles] };
}

/** 两组权重按 a、b 混合，留最大的四个，加起来是 1 */
function mixWeights(J: string[], W: number[], parts: [number, number][]): { j: string[]; w: number[] } {
  const sum = new Map<string, number>();
  for (const [v, k] of parts) {
    for (let i = 0; i < 4; i++) {
      const w = W[v * 4 + i] * k;
      if (w > 0) sum.set(J[v * 4 + i], (sum.get(J[v * 4 + i]) ?? 0) + w);
    }
  }
  const top = [...sum].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = top.reduce((s, [, w]) => s + w, 0) || 1;
  const j = top.map(([b]) => b);
  const w = top.map(([, x]) => x / total);
  while (j.length < 4) {
    j.push(j[0] ?? 'Hand');
    w.push(0);
  }
  return { j, w };
}

/** 在 a、b 两个顶点之间 t 处加一个顶点（位置、法线、权重都照比例），返回它的下标 */
function addBetween(s: Soup, a: number, b: number, t: number): number {
  const v = s.P.length / 3;
  for (let k = 0; k < 3; k++) s.P.push(s.P[a * 3 + k] + (s.P[b * 3 + k] - s.P[a * 3 + k]) * t);
  const n = [0, 1, 2].map((k) => s.N[a * 3 + k] * (1 - t) + s.N[b * 3 + k] * t);
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  s.N.push(n[0] / l, n[1] / l, n[2] / l);
  const { j, w } = mixWeights(s.J, s.W, [
    [a, 1 - t],
    [b, t],
  ]);
  s.J.push(...j);
  s.W.push(...w);
  return v;
}

/** 离刀面这么近的顶点直接挪到刀面上，免得切出细得看不见的三角面 */
const SNAP = 1e-9;
/** 刀面离最近的顶点至少这么远（见 gapsOf） */
const CLEAR = 1.2e-5;

/** 用 axis = c 这个平面切开（axis 0 是 x，2 是 z）：跨过它的三角面切成两半，切口上的点两边共用 */
function cut(s: Soup, c: number, axis = 2): void {
  const count = s.P.length / 3;
  for (let v = 0; v < count; v++) if (Math.abs(s.P[v * 3 + axis] - c) < SNAP) s.P[v * 3 + axis] = c;
  const side = (v: number) => Math.sign(s.P[v * 3 + axis] - c);
  const made = new Map<string, number>();
  const at = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let v = made.get(key);
    if (v === undefined) {
      const za = s.P[a * 3 + axis] - c;
      const zb = s.P[b * 3 + axis] - c;
      v = addBetween(s, a, b, za / (za - zb));
      s.P[v * 3 + axis] = c;
      made.set(key, v);
    }
    return v;
  };
  const T: number[] = [];
  for (let f = 0; f < s.T.length; f += 3) {
    const tri = [s.T[f], s.T[f + 1], s.T[f + 2]];
    const sides = tri.map(side);
    if (!sides.includes(1) || !sides.includes(-1)) {
      T.push(...tri);
      continue;
    }
    // 照顺序走一圈，分成刀面上、下两个多边形（都是凸的，扇形三角化就行）
    const up: number[] = [];
    const down: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      const sa = sides[k];
      const sb = sides[(k + 1) % 3];
      if (sa >= 0) up.push(a);
      if (sa <= 0) down.push(a);
      if (sa * sb < 0) {
        const m = at(a, b);
        up.push(m);
        down.push(m);
      }
    }
    for (const poly of [up, down]) for (let k = 1; k + 1 < poly.length; k++) T.push(poly[0], poly[k], poly[k + 1]);
  }
  s.T = T;
}

/** 只留下重心 (x, y, z) 合 keep 的那些三角面，顶点重新编号 */
function pick(s: Soup, keep: (x: number, y: number, z: number) => boolean): Soup {
  const out = emptySoup();
  const map = new Map<number, number>();
  const take = (v: number) => {
    let i = map.get(v);
    if (i === undefined) {
      i = out.P.length / 3;
      map.set(v, i);
      out.P.push(s.P[v * 3], s.P[v * 3 + 1], s.P[v * 3 + 2]);
      out.N.push(s.N[v * 3], s.N[v * 3 + 1], s.N[v * 3 + 2]);
      for (let k = 0; k < 4; k++) {
        out.J.push(s.J[v * 4 + k]);
        out.W.push(s.W[v * 4 + k]);
      }
    }
    return i;
  };
  for (let f = 0; f < s.T.length; f += 3) {
    const c = [0, 1, 2].map((k) => (s.P[s.T[f] * 3 + k] + s.P[s.T[f + 1] * 3 + k] + s.P[s.T[f + 2] * 3 + k]) / 3);
    if (keep(c[0], c[1], c[2])) out.T.push(take(s.T[f]), take(s.T[f + 1]), take(s.T[f + 2]));
  }
  return out;
}


/* ---------------- 指缝在哪 ---------------- */

/**
 * z = c 这个平面切过手的地方，最远伸到哪（沿手指的方向 x）：指缝里只切过手掌和指蹼，这个数最小。
 * 截出来的不是「一整条、两头在手腕开口上」的（刀面擦过指节的鼓包，多出一个小圈）算切不了，给无穷大
 */
function reachAt(s: Soup, c: number): number {
  let far = -Infinity;
  const links = new Map<string, number>();
  const segments: [string, string][] = [];
  for (let f = 0; f < s.T.length; f += 3) {
    const crossed: string[] = [];
    for (let k = 0; k < 3; k++) {
      const a = s.T[f + k];
      const b = s.T[f + ((k + 1) % 3)];
      const za = s.P[a * 3 + 2] - c;
      const zb = s.P[b * 3 + 2] - c;
      if (za < 0 === zb < 0) continue;
      const t = za / (za - zb);
      far = Math.max(far, s.P[a * 3] + (s.P[b * 3] - s.P[a * 3]) * t);
      crossed.push(a < b ? `${a},${b}` : `${b},${a}`);
    }
    if (crossed.length !== 2) continue;
    segments.push([crossed[0], crossed[1]]);
    for (const e of crossed) links.set(e, (links.get(e) ?? 0) + 1);
  }
  // 连成几条：并查集
  const parent = new Map<string, string>();
  const find = (e: string): string => {
    const p = parent.get(e) ?? e;
    if (p === e) return e;
    const r = find(p);
    parent.set(e, r);
    return r;
  };
  for (const [a, b] of segments) parent.set(find(a), find(b));
  const pieces = new Set([...links.keys()].map(find));
  const ends = [...links.values()].filter((n) => n === 1).length;
  return pieces.size === 1 && ends === 2 ? far : Infinity;
}

/** 四指相邻两根之间的指缝（三刀，从拇指那边往小指那边，z 从大到小）：在两根手指的指根之间找切得最浅的地方 */
function gapsOf(s: Soup, roots: readonly number[]): number[] {
  return roots.slice(1).map((_, i) => {
    const [hi, lo] = [roots[i], roots[i + 1]];
    let best = (hi + lo) / 2;
    let bestReach = Infinity;
    const steps = 48;
    for (let k = 4; k <= steps - 4; k++) {
      const c = hi + ((lo - hi) * k) / steps;
      // 前后挪一点也得切得干净：刀面附近的顶点会被吸到刀面上
      const reach = Math.max(reachAt(s, c - 4e-4), reachAt(s, c), reachAt(s, c + 4e-4));
      if (reach < bestReach - 1e-6) {
        bestReach = reach;
        best = c;
      }
    }
    if (bestReach === Infinity) throw new Error('digits: no clean cut between fingers');
    return clearOf(s, best);
  });
}

/** 刀面别正好贴着顶点（不然会切出平躺在刀面上的三角面，两边的切口对不上）：挪到离最近的顶点够远的地方 */
function clearOf(s: Soup, c0: number, axis = 2): number {
  for (let k = 0; k < 40; k++) {
    const c = c0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 1e-5;
    let near = Infinity;
    for (let v = axis; v < s.P.length; v += 3) near = Math.min(near, Math.abs(s.P[v] - c));
    if (near > CLEAR) return c;
  }
  return c0;
}

/* ---------------- 拼 ---------------- */

/** 一条的切口：这一条里落在刀面上的那些边界边连成的一条曲线（两头在手腕的开口上），从高（手背）那头走到低的那头 */
function seamOf(s: Soup, first: number, end: number, tri0: number, tri1: number, z: number): number[] {
  const on = (v: number) => Math.abs(s.P[v * 3 + 2] - z) < 1e-7;
  const uses = new Map<string, number>();
  for (let f = tri0; f < tri1; f += 3) {
    for (let k = 0; k < 3; k++) {
      const a = s.T[f + k];
      const b = s.T[f + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const next = new Map<number, number[]>();
  for (const [key, n] of uses) {
    if (n !== 1) continue;
    const [a, b] = key.split(',').map(Number);
    if (a < first || a >= end || !on(a) || !on(b)) continue;
    next.set(a, [...(next.get(a) ?? []), b]);
    next.set(b, [...(next.get(b) ?? []), a]);
  }
  const ends = [...next].filter(([, n]) => n.length === 1).map(([v]) => v);
  if (ends.length !== 2) throw new Error(`digits: seam at z=${z} has ${ends.length} ends`);
  const start = s.P[ends[0] * 3 + 1] >= s.P[ends[1] * 3 + 1] ? ends[0] : ends[1];
  const line = [start];
  let prev = -1;
  let v = start;
  while (true) {
    const n = next.get(v)!.find((u) => u !== prev);
    if (n === undefined) break;
    prev = v;
    v = n;
    line.push(v);
    if (line.length > next.size) throw new Error('digits: seam loops');
  }
  if (line.length !== next.size) throw new Error('digits: seam is broken');
  return line;
}

/**
 * 一条接在另一条后面时要往上、往下挪多少：两个截面（上一条的下切口、这一条的上切口）按走到全长的几成一一对上，
 * 平均差多高
 */
function liftBetween(a: Soup, za: number, b: Soup, zb: number): number {
  const sample = (s: Soup, z: number) => {
    const line = seamOf(s, 0, s.P.length / 3, 0, s.T.length, z);
    const p = params(s, line);
    return (u: number): [number, number] => {
      let k = 0;
      while (k + 2 < line.length && p[k + 1] < u) k++;
      const t = Math.min(1, Math.max(0, (u - p[k]) / (p[k + 1] - p[k] || 1)));
      const [i, j] = [line[k], line[k + 1]];
      return [s.P[i * 3] + (s.P[j * 3] - s.P[i * 3]) * t, s.P[i * 3 + 1] + (s.P[j * 3 + 1] - s.P[i * 3 + 1]) * t];
    };
  };
  const fa = sample(a, za);
  const fb = sample(b, zb);
  let sum = 0;
  let n = 0;
  for (let k = 0; k <= 200; k++) {
    const [, ya] = fa(k / 200);
    const [, yb] = fb(k / 200);
    sum += ya - yb;
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * 曲线上每个点走到了全长的几成。以伸得最远（指蹼的尖）的那个点为界分成手背、手心两半，各占一半：
 * 两条截线的指蹼伸出去的长短不一样，整条一起量的话，手心那一半的点会错开
 */
function params(s: Soup, line: number[]): number[] {
  const along = [0];
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    along.push(along[i - 1] + Math.hypot(s.P[a * 3] - s.P[b * 3], s.P[a * 3 + 1] - s.P[b * 3 + 1], s.P[a * 3 + 2] - s.P[b * 3 + 2]));
  }
  let tip = 0;
  for (let i = 1; i < line.length; i++) if (s.P[line[i] * 3] > s.P[line[tip] * 3]) tip = i;
  const total = along[along.length - 1];
  const mid = along[tip];
  if (tip === 0 || tip === line.length - 1) return along.map((d) => d / (total || 1));
  return along.map((d) => (d <= mid ? (0.5 * d) / mid : 0.5 + (0.5 * (d - mid)) / (total - mid)));
}

/** 在曲线的第 k 段（line[k] → line[k+1]）的 t 处补一个点：返回它的下标，并记下要劈开哪条边 */
type Inserts = Map<string, { a: number; b: number; points: { t: number; v: number }[] }>;

/**
 * 两条切口焊成一条：各自在对方的点上（按走到全长的几成对上）补点，补完一一对应，下面那条的点并到上面那条的点上。
 * 返回「哪个顶点并到哪个顶点」
 */
function weld(
  s: Soup,
  upper: number[],
  lower: number[],
  ranges: { upper: [number, number]; lower: [number, number] },
  inserts: Inserts,
  merge: Map<number, number>,
  pu = params(s, upper),
  pl = params(s, lower),
  lock?: (v: number) => readonly boolean[],
): void {
  /** 两个点走到全长的几成差这么点以内，算同一个点 */
  const TOL = 0.003;
  /** 在曲线上第 k、k+1 个点之间（前一个已经配过、后一个还没配），走到全长 u 成的地方补一个点 */
  const insert = (line: number[], p: number[], k: number, u: number): number => {
    const [a, b] = [line[k], line[k + 1]];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const entry = inserts.get(key) ?? { a, b, points: [] };
    // 同一段上后补的点一定排在先补的后面（夹到端点上的几个点 t 一样的话，排序会把先后弄反，网格交叉出缺口）
    const after = entry.points.length ? Math.max(...entry.points.map((q) => (entry.a === a ? q.t : 1 - q.t))) : 0;
    const t = Math.min(1 - 1e-6, Math.max(after + 1e-6, Math.min(1, Math.max(0, (u - p[k]) / (p[k + 1] - p[k] || 1)))));
    const v = addBetween(s, a, b, t);
    entry.points.push({ t: entry.a === a ? t : 1 - t, v });
    inserts.set(key, entry);
    return v;
  };
  // 两条一起从头往后走：对得上的配成一对，对不上的在对面补一个点。两头（手背、手心那两个端点）一定配成一对
  const pairs: [number, number][] = [[upper[0], lower[0]]];
  let i = 1;
  let j = 1;
  const lastU = upper.length - 1;
  const lastL = lower.length - 1;
  while (i < lastU || j < lastL) {
    if (i < lastU && j < lastL && Math.abs(pu[i] - pl[j]) < TOL) pairs.push([upper[i++], lower[j++]]);
    else if (j >= lastL || (i < lastU && pu[i] < pl[j])) {
      pairs.push([upper[i], insert(lower, pl, j - 1, pu[i])]);
      i++;
    } else {
      pairs.push([insert(upper, pu, i - 1, pl[j]), lower[j]]);
      j++;
    }
  }
  pairs.push([upper[lastU], lower[lastL]]);
  blend(s, pairs, ranges, lock);
  pairs.forEach(([v, b]) => {
    const a = { v };
    // 位置、法线、权重取两边的平均
    for (let k = 0; k < 3; k++) {
      s.P[a.v * 3 + k] = (s.P[a.v * 3 + k] + s.P[b * 3 + k]) / 2;
      s.N[a.v * 3 + k] = s.N[a.v * 3 + k] + s.N[b * 3 + k];
    }
    const { j, w } = mixWeights(s.J, s.W, [
      [a.v, 0.5],
      [b, 0.5],
    ]);
    for (let k = 0; k < 4; k++) {
      s.J[a.v * 4 + k] = j[k];
      s.W[a.v * 4 + k] = w[k];
    }
    merge.set(b, a.v);
  });
}

/** 焊缝两边的落差摊开多宽（离切口这么远以内的点跟着挪，越近挪得越多） */
const BLEND = 0.006;
/** 落差（每边要挪的）大的时候，摊开的宽度是它的几倍，最宽多少 */
const BLEND_SPREAD = 3;
const BLEND_MAX = 0.016;

/**
 * 两条切口配好对以后，切口上的点都要挪到两边的正中。只挪切口上的点，落差全挤在那一条线上，是一道台阶；
 * 这里把两边离切口 BLEND 以内的点也跟着挪（越远挪得越少），落差摊成一段缓坡
 */
function blend(
  s: Soup,
  pairs: [number, number][],
  ranges: { upper: [number, number]; lower: [number, number] },
  lock?: (v: number) => readonly boolean[],
): void {
  const at = (v: number): V3 => [s.P[v * 3], s.P[v * 3 + 1], s.P[v * 3 + 2]];
  const up = pairs.map(([a]) => at(a));
  const low = pairs.map(([, b]) => at(b));
  /** 每一对要往正中挪多少（上面那条的点；下面那条反过来） */
  const half = pairs.map((_, k): V3 => [(low[k][0] - up[k][0]) / 2, (low[k][1] - up[k][1]) / 2, (low[k][2] - up[k][2]) / 2]);
  // 落差大的（指蹼一深一浅差得多）摊得宽一点，不然挤出几道皱
  const most = Math.max(...half.map((h) => Math.hypot(h[0], h[1], h[2])));
  const radius = Math.min(BLEND_MAX, Math.max(BLEND, most * BLEND_SPREAD));
  const pull = ([first, end]: [number, number], line: V3[], sign: number) => {
    const moves: [number, V3][] = [];
    for (let v = first; v < end; v++) {
      const p = at(v);
      let best = Infinity;
      let move: V3 = [0, 0, 0];
      for (let k = 0; k + 1 < line.length; k++) {
        const [a, b] = [line[k], line[k + 1]];
        const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
        const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2));
        const d = Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t);
        if (d < best) {
          best = d;
          move = [0, 1, 2].map((q) => (half[k][q] + (half[k + 1][q] - half[k][q]) * t) * sign) as V3;
        }
      }
      if (best < radius) {
        const w = 1 - smooth01(best / radius);
        const fixed = lock?.(v);
        moves.push([v, [0, 1, 2].map((q) => (fixed?.[q] ? 0 : move[q] * w)) as V3]);
      }
    }
    for (const [v, m] of moves) for (let q = 0; q < 3; q++) s.P[v * 3 + q] += m[q];
  };
  pull(ranges.upper, up, 1);
  pull(ranges.lower, low, -1);
}

/** 补的点：把边上带着这些点的三角面劈成一把扇子（保持原来的绕向） */
function splitEdges(s: Soup, inserts: Inserts): void {
  if (!inserts.size) return;
  const T: number[] = [];
  const G: number[] = [];
  for (let f = 0; f < s.T.length; f += 3) {
    const tri = [s.T[f], s.T[f + 1], s.T[f + 2]];
    const before = T.length;
    // 顺着绕向走一圈，每条边上补的点按从起点到终点的顺序排进去
    const ring: number[] = [];
    const split: number[] = [];
    for (let k = 0; k < 3; k++) {
      const x = tri[k];
      const y = tri[(k + 1) % 3];
      ring.push(x);
      const entry = inserts.get(x < y ? `${x},${y}` : `${y},${x}`);
      if (!entry) continue;
      split.push(k);
      const along = entry.points.map((p) => ({ t: entry.a === x ? p.t : 1 - p.t, v: p.v })).sort((p, q) => p.t - q.t);
      ring.push(...along.map((p) => p.v));
    }
    if (!split.length) T.push(...tri);
    else if (split.length === 1) {
      // 只有一条边补了点：从对面那个角铺成一把扇子
      const k = split[0];
      const c = tri[(k + 2) % 3];
      const from = ring.indexOf(tri[k]);
      const chain = [...ring.slice(from), ...ring.slice(0, from)].filter((v) => v !== c);
      for (let i = 0; i + 1 < chain.length; i++) T.push(chain[i], chain[i + 1], c);
    } else {
      // 好几条边都补了点：在三角面正中加一个点，绕着它铺一圈
      const m = s.P.length / 3;
      for (let k = 0; k < 3; k++) s.P.push((s.P[tri[0] * 3 + k] + s.P[tri[1] * 3 + k] + s.P[tri[2] * 3 + k]) / 3);
      s.N.push(...[0, 1, 2].map((k) => s.N[tri[0] * 3 + k] + s.N[tri[1] * 3 + k] + s.N[tri[2] * 3 + k]));
      const { j, w } = mixWeights(
        s.J,
        s.W,
        tri.map((v): [number, number] => [v, 1 / 3]),
      );
      s.J.push(...j);
      s.W.push(...w);
      for (let i = 0; i < ring.length; i++) T.push(ring[i], ring[(i + 1) % ring.length], m);
    }
    if (s.G) for (let k = before; k < T.length; k += 3) G.push(s.G[f / 3]);
  }
  s.T = T;
  if (s.G) s.G = G;
}

const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** 手指多了、少了，手腕跟着宽窄的比例要打多少折（0 是手腕和手掌一样宽窄，1 是手腕不变） */
const WRIST_TAPER = 0.4;
/** 焊缝两边磨平多宽（米）、磨几遍 */
const RELAX_RADIUS = 0.0045;
const RELAX_ROUNDS = 10;

/**
 * 焊缝附近磨平（Taubin：先往邻居的平均挪一点，再往回挪一点，整体不缩）。离焊缝越远挪得越少。
 * planes 是要磨的那几个平面（z），reach 是磨到哪为止（沿手指的方向 x，再往外是手指，不磨）。
 * 手腕开口上的点只顺着开口那一圈磨（不往里缩）
 */
function relax(s: Soup, planes: { z: number; reach: number; radius: number; axis?: number }[], rounds: number): void {
  const count = s.P.length / 3;
  const near = new Float64Array(count);
  for (let v = 0; v < count; v++) {
    for (const { z, reach, radius, axis = 2 } of planes) {
      const d = Math.abs(s.P[v * 3 + axis] - z);
      if (d >= radius) continue;
      const fade = 1 - smooth01((s.P[v * 3] - reach) / 0.004);
      near[v] = Math.max(near[v], (1 - smooth01(d / radius)) * fade);
    }
  }
  const links: Set<number>[] = Array.from({ length: count }, () => new Set());
  const use = new Map<string, number>();
  for (let f = 0; f < s.T.length; f += 3) {
    for (let k = 0; k < 3; k++) {
      const a = s.T[f + k];
      const b = s.T[f + ((k + 1) % 3)];
      links[a].add(b);
      links[b].add(a);
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      use.set(key, (use.get(key) ?? 0) + 1);
    }
  }
  // 开口上的点：邻居只算开口上挨着的两个
  const rim = new Map<number, number[]>();
  for (const [key, n] of use) {
    if (n !== 1) continue;
    const [a, b] = key.split(',').map(Number);
    rim.set(a, [...(rim.get(a) ?? []), b]);
    rim.set(b, [...(rim.get(b) ?? []), a]);
  }
  const step = (k: number) => {
    const moved = new Float64Array(count * 3);
    for (let v = 0; v < count; v++) {
      const around = rim.get(v) ?? [...links[v]];
      if (!near[v] || !around.length) continue;
      const avg = [0, 0, 0];
      for (const u of around) for (let q = 0; q < 3; q++) avg[q] += s.P[u * 3 + q];
      for (let q = 0; q < 3; q++) moved[v * 3 + q] = (avg[q] / around.length - s.P[v * 3 + q]) * k * near[v];
    }
    for (let i = 0; i < moved.length; i++) s.P[i] += moved[i];
  };
  for (let r = 0; r < rounds; r++) {
    step(0.5);
    step(-0.53);
  }
}

/**
 * 照总根数（连拇指，FINGER_COUNT 以内）重新拼一只手。fingers 是现成那只手五根手指的关节（拇指、食指 … 小指）。
 * 根数就是本来的五根时原样返回。
 */
/**
 * 一只手（脚）怎么按条拼。都写在「手的方向」里：指（趾）头朝 +x，手背（脚背）朝 +y，横着排在 z 上，
 * 第 0 条（锚，连着手掌那一块不动的：拇指和食指 / 大脚趾）在 z 最大的那一头
 */
interface StripPlan {
  /** 每一条的指（趾）根在 z 上的位置，从锚那一条往外排：相邻两个之间找指缝下刀 */
  roots: readonly number[];
  /** 照着复制的是哪一条；order 里写成 roots.length 的就是它的复制品 */
  copyOf: number;
  /** 手掌和指节的分界（x）：再往外是一条一条拼的，往里是整片拉宽的手掌 */
  reach: number;
  /** 手腕（脚踝）的 x：往那边拉宽的程度打折 */
  wristX: number;
  /** 手腕（脚踝）跟着宽窄的比例打多少折：0 是和手掌（脚掌）一样宽窄，1 是不变 */
  wristTaper: number;
  /** 照手指名给骨骼改名（Index、Middle、Ring、Little，按条）；脚趾共用一根骨骼，不改名 */
  fingerNames: readonly string[] | null;
}

interface Reshaped {
  positions: Float32Array;
  normals: Float32Array;
  triangles: Uint16Array;
  loop: number[];
  /** 每个顶点 4 个骨骼名（不带左右） */
  jointNames: string[];
  weights: Float32Array;
  /** 接上去的每一条（order 里第 1 个起）横着挪了多少（shift）、上下挪了多少（lift） */
  placed: { shift: number; lift: number }[];
}

/**
 * 照 order 把 base 按条重新拼（order[0] 是锚那一条；names 是 order 里每一条新的手指名，只有改名时用得上）。
 * 怎么切、怎么拼、怎么焊见文件开头
 */
function reshape(base: GraftMesh, plan: StripPlan, order: readonly number[], names: readonly string[]): Reshaped {
  const TILE_ID = plan.roots.length;
  const whole = soupOf(base);
  const gaps = gapsOf(whole, plan.roots);
  for (const g of gaps) cut(whole, g);
  const top = gaps[0];
  // 手掌和指节的分界：指根往手腕那边一点。再往手腕那边（锚那一条以外）是手掌和手腕，照原样整片横着拉宽、压窄；
  // 往外是指节、指蹼、手指，一条一条复制、拿掉。手掌、手腕不是一条一条一样的（横着是斜的、手腕是一根管子），复制必然起花纹
  const reach = clearOf(whole, plan.reach, 0);
  cut(whole, reach, 0);
  const bounds = [Infinity, ...gaps, -Infinity];
  const palm = pick(whole, (x, _y, z) => z >= top || x < reach);
  const strips = plan.roots.map((_, i) => pick(whole, (x, _y, z) => x >= reach && z >= bounds[i + 1] && z < bounds[i]));
  const ownOf = (i: number) => (i === TILE_ID ? plan.copyOf : i);
  const last = plan.roots.length - 1;
  const FN = plan.fingerNames;
  const fingerBone = FN ? new RegExp(`^(${FN.join('|')})(\\d)$`) : null;

  const out: Soup = { ...emptySoup(), G: [] };
  // 手掌那一块（连拇指、食指）：骨骼名照旧，拿掉了的手指给手掌（挨着锚的那一根没了的，那点权重给现在挨着的那根）
  const kept = new Set(names);
  const palmBone = (b: string) => {
    const m = fingerBone?.exec(b);
    if (!m || kept.has(m[1])) return b;
    return m[1] === FN![1] ? `${names[1]}${m[2]}` : 'Hand';
  };
  for (let v = 0; v < palm.P.length / 3; v++) {
    out.P.push(palm.P[v * 3], palm.P[v * 3 + 1], palm.P[v * 3 + 2]);
    out.N.push(palm.N[v * 3], palm.N[v * 3 + 1], palm.N[v * 3 + 2]);
    for (let k = 0; k < 4; k++) {
      out.J.push(palmBone(palm.J[v * 4 + k]));
      out.W.push(palm.W[v * 4 + k]);
    }
  }
  out.T.push(...palm.T);
  for (let f = 0; f < palm.T.length; f += 3) out.G!.push(0);
  const palmEnd = out.P.length / 3;

  /** 接上去的每一条在拼好的网格里从哪个顶点、哪个三角面开始，挪了多少 */
  const placed: { first: number; end: number; tri0: number; tri1: number; top: number; bottom: number; shift: number; lift: number }[] = [];
  let cursor = top;
  // 手掌横着是斜的（往小指那边翘起来）：一条接一条时还要照两边截面的高低差往上、往下挪，斜面才接得上
  let lift = 0;
  order.forEach((i, at) => {
    if (at === 0) return;
    const own = ownOf(i);
    const piece = strips[own];
    const shift = cursor - bounds[own];
    const prev = ownOf(order[at - 1]);
    if (at > 1) lift += liftBetween(strips[prev], bounds[prev + 1], piece, bounds[own]);
    // 骨骼改名：自己这根换成新名字，原来上、下挨着的那根换成现在上、下挨着的；不挨着了的给手掌
    const rename = new Map<string, string>();
    if (FN) {
      rename.set(FN[own], names[at]);
      if (own > 0) rename.set(FN[own - 1], names[at - 1]);
      if (own < last) rename.set(FN[own + 1], at + 1 < order.length ? names[at + 1] : '');
    }
    const boneName = (b: string) => {
      const m = fingerBone?.exec(b);
      if (!m) return b;
      const to = rename.get(m[1]);
      return to ? `${to}${m[2]}` : 'Hand';
    };
    const first = out.P.length / 3;
    const tri0 = out.T.length;
    for (let v = 0; v < piece.P.length / 3; v++) {
      out.P.push(piece.P[v * 3], piece.P[v * 3 + 1] + lift, piece.P[v * 3 + 2] + shift);
      out.N.push(piece.N[v * 3], piece.N[v * 3 + 1], piece.N[v * 3 + 2]);
      for (let k = 0; k < 4; k++) {
        out.J.push(boneName(piece.J[v * 4 + k]));
        out.W.push(piece.W[v * 4 + k]);
      }
    }
    for (const t of piece.T) out.T.push(t + first);
    for (let f = 0; f < piece.T.length; f += 3) out.G!.push(1);
    placed.push({ first, end: out.P.length / 3, tri0, tri1: out.T.length, top: cursor, bottom: bounds[own + 1] + shift, shift, lift });
    cursor = bounds[own + 1] + shift;
  });

  // 一：相邻两条的切口焊起来
  {
    const inserts: Inserts = new Map();
    const merge = new Map<number, number>();
    const seams = placed.slice(1).map((low, k) => {
      const up = placed[k];
      return {
        upper: seamOf(out, up.first, up.end, up.tri0, up.tri1, up.bottom),
        lower: seamOf(out, low.first, low.end, low.tri0, low.tri1, low.top),
        ranges: { upper: [up.first, up.end] as [number, number], lower: [low.first, low.end] as [number, number] },
      };
    });
    // 指根前那条线上的点只顺着线挪（不离开 x = reach），后面还要照这条线和手掌焊上
    const lock = (v: number) => [out.P[v * 3] === reach, false, false];
    for (const { upper, lower, ranges } of seams) weld(out, upper, lower, ranges, inserts, merge, undefined, undefined, lock);
    splitEdges(out, inserts);
    out.T = out.T.map((v) => merge.get(v) ?? v);
  }

  // 二：手掌（拇指那一条以外）横着拉宽、压窄到和接上去的那几条一样宽；往手腕那边打个折，手腕不跟着宽窄那么多
  const lowest = (from: number, to: number) => {
    let z = Infinity;
    for (let v = from; v < to; v++) if (out.P[v * 3] === reach) z = Math.min(z, out.P[v * 3 + 2]);
    return z;
  };
  const width = top - lowest(0, palmEnd);
  const ratio = (top - lowest(palmEnd, out.P.length)) / width;
  const wrist = ratio ** (1 - plan.wristTaper);
  const x0 = plan.wristX;
  const widen = (x: number) => (x >= reach ? ratio : wrist + (ratio - wrist) * smooth01((x - x0) / (reach - x0)));
  // 拉宽的程度从拇指那一条的切口往小指那边 STRETCH_EASE 以内逐渐加上去：一下子加上去，切口那里折出一道
  for (let v = 0; v < palmEnd; v++) {
    const z = out.P[v * 3 + 2];
    if (z < top) out.P[v * 3 + 2] = top - eased(top - z, widen(out.P[v * 3]), width);
  }

  // 三：手掌那一块和接上去的那几条之间是一整圈（指根前那条线，加上食指那一条下面的切口）：照展开以后的位置一一对上，焊起来
  {
    const onLine = (v: number) => {
      const [x, z] = [out.P[v * 3], out.P[v * 3 + 2]];
      return (Math.abs(z - top) < 1e-7 && x >= reach - 1e-9) || (x === reach && z <= top + 1e-7);
    };
    const upper = ringOf(out, 0, onLine);
    const lower = ringOf(out, 1, onLine);
    /** 展开：食指那一条下面的切口上 s = x - reach（往外是正），指根前那条线上 s = z - top（往小指那边是负） */
    const flat = (v: number): [number, number] => {
      const [x, y, z] = [out.P[v * 3], out.P[v * 3 + 1], out.P[v * 3 + 2]];
      return [Math.abs(z - top) < 1e-7 && x >= reach ? x - reach : z - top, y];
    };
    const [pu, pl] = [upper, lower].map((line) => ringParams(line.map(flat)));
    const inserts: Inserts = new Map();
    const merge = new Map<number, number>();
    weld(out, upper, lower, { upper: [0, palmEnd], lower: [palmEnd, out.P.length] }, inserts, merge, pu, pl);
    splitEdges(out, inserts);
    out.T = out.T.map((v) => merge.get(v) ?? v);
  }
  // 两边的截面厚薄不完全一样，焊上以后有一道棱：焊缝两边几毫米磨平
  relax(
    out,
    [
      ...placed.slice(0, -1).map((p) => ({ z: p.bottom, reach: Infinity, radius: RELAX_RADIUS })),
      // 手掌和手指那几条之间那一圈：指根前那条线、食指那一条下面的切口
      { z: reach, reach: Infinity, radius: RELAX_RADIUS, axis: 0 },
      { z: top, reach: Infinity, radius: RELAX_RADIUS },
    ],
    RELAX_ROUNDS,
  );
  // 压窄得多的：手掌（脚掌）上本来浅浅的纹路被挤密，成了几道皱。指根线往里那一片磨平（不磨手指、脚趾）
  if (ratio < SQUEEZE_SMOOTH) relax(out, [{ z: reach, reach, radius: SQUEEZE_RADIUS, axis: 0 }], SQUEEZE_ROUNDS);
  // 指蹼尖两边深浅不一，焊上以后那里有几个小三角面折翻过来，像一片薄片：找出来抹平
  unfold(out, (v) => {
    const [x, z] = [out.P[v * 3], out.P[v * 3 + 2]];
    return x > reach && [top, ...placed.slice(0, -1).map((p) => p.bottom)].some((c) => Math.abs(z - c) < UNFOLD_NEAR);
  });

  // 丢掉没用上的顶点，重新编号
  const used = new Map<number, number>();
  for (const v of out.T) if (!used.has(v)) used.set(v, used.size);
  const count2 = used.size;
  const positions = new Float32Array(count2 * 3);
  const weights = new Float32Array(count2 * 4);
  const jointNames: string[] = new Array(count2 * 4);
  for (const [v, i] of used) {
    positions.set([out.P[v * 3], out.P[v * 3 + 1], out.P[v * 3 + 2]], i * 3);
    for (let k = 0; k < 4; k++) {
      jointNames[i * 4 + k] = out.J[v * 4 + k];
      weights[i * 4 + k] = out.W[v * 4 + k];
    }
  }
  const triangles = Uint16Array.from(out.T, (v) => used.get(v)!);

  // 法线照新的形状重算（面积加权）
  const normals = new Float32Array(count2 * 3);
  for (let f = 0; f < triangles.length; f += 3) {
    const [a, b, c] = [triangles[f], triangles[f + 1], triangles[f + 2]];
    const e1 = [0, 1, 2].map((k) => positions[b * 3 + k] - positions[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => positions[c * 3 + k] - positions[a * 3 + k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) normals[v * 3 + k] += n[k];
  }
  for (let v = 0; v < count2; v++) {
    const l = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) normals[v * 3 + k] /= l;
  }

  // 手腕的开口：顺着三角面的绕向走一圈
  const edges = new Set<string>();
  for (let f = 0; f < triangles.length; f += 3) for (let k = 0; k < 3; k++) edges.add(`${triangles[f + k]},${triangles[f + ((k + 1) % 3)]}`);
  const next = new Map<number, number>();
  for (const e of edges) {
    const [a, b] = e.split(',').map(Number);
    if (!edges.has(`${b},${a}`)) next.set(a, b);
  }
  // 从离原来那一圈起点最近的那个顶点走起
  const origin = [0, 1, 2].map((k) => base.positions[base.loop[0] * 3 + k]);
  let start = -1;
  let nearest = Infinity;
  for (const v of next.keys()) {
    const d = Math.hypot(positions[v * 3] - origin[0], positions[v * 3 + 1] - origin[1], positions[v * 3 + 2] - origin[2]);
    if (d < nearest) [start, nearest] = [v, d];
  }
  const loop = [start];
  for (let v = next.get(start)!; v !== start && loop.length <= next.size; v = next.get(v)!) loop.push(v);
  if (loop.length !== next.size) throw new Error('digits: the wrist opening is not one loop');
  return { positions, normals, triangles, loop, jointNames, weights, placed: placed.map(({ shift, lift }) => ({ shift, lift })) };
}

/**
 * 照总根数（连拇指，FINGER_COUNT 以内）重新拼一只手。fingers 是现成那只手五根手指的关节（拇指、食指 … 小指）。
 * 根数就是本来的五根时原样返回
 */
export function shapeHand(base: GraftMesh, fingers: FingerJoints[], count: number): ShapedHand {
  const order = fingerSlabs(count);
  if (order.length === 4) return { mesh: base, fingers };
  const names = slabNames(order);
  const own = (i: number) => fingers.find((f) => f.finger === FOUR[i === TILE ? 2 : i])!;
  const plan: StripPlan = {
    roots: FOUR.map((_, i) => own(i).joints[0][2]),
    copyOf: 2,
    reach: Math.min(...fingers.slice(1).map((f) => f.joints[0][0])) - KNUCKLE_MARGIN,
    wristX: base.end[0],
    wristTaper: WRIST_TAPER,
    fingerNames: FOUR,
  };
  const r = reshape(base, plan, order, names);

  // 骨骼：本来那些里还用得着的（手臂、手掌、拇指、留下的手指），再加上多出来的手指
  const fingerList: FingerJoints[] = [fingers[0], fingers[1]];
  order.forEach((i, at) => {
    if (at === 0) return;
    const { shift, lift } = r.placed[at - 1];
    fingerList.push({ finger: names[at], joints: own(i).joints.map((p): V3 => [p[0], p[1] + lift, p[2] + shift]) });
  });
  const bones = [
    ...base.bones.filter((b) => {
      const m = /^(Index|Middle|Ring|Little)\d$/.exec(b);
      return !m || names.includes(b.slice(0, -1));
    }),
    ...names.filter((n) => (EXTRA_FINGERS as readonly string[]).includes(n)).flatMap((n) => [1, 2, 3].map((k) => `${n}${k}`)),
  ];
  const index = new Map(bones.map((b, i) => [b, i]));
  const joints = Uint8Array.from(r.jointNames, (b) => index.get(b) ?? index.get('Hand')!);
  return {
    mesh: { positions: r.positions, normals: r.normals, triangles: r.triangles, loop: r.loop, joints, weights: r.weights, bones, end: base.end, root: base.root },
    fingers: fingerList,
  };
}

/** 一只脚几个脚趾：最少、最多、现成的那只脚本来的。一个做不了：小脚趾那一侧的脚掌外缘是跟着小脚趾那一条来的 */
export const TOE_COUNT = { min: 2, max: 8, base: 5 } as const;

/**
 * 照总数排出脚趾那几条：0 大脚趾（锚）、1 第二趾、2 第三趾、3 第四趾、4 小脚趾；5 是复制出来的（照第二趾，它两边的趾缝一样深），
 * 插在第二趾后面。少了先拿掉第四趾，再拿掉第三趾、第二趾
 */
export function toeSlabs(count: number): number[] {
  const n = Math.round(Math.min(TOE_COUNT.max, Math.max(TOE_COUNT.min, count)));
  if (n === 2) return [0, 4];
  if (n === 3) return [0, 1, 4];
  if (n === 4) return [0, 1, 2, 4];
  return [0, 1, ...Array.from({ length: n - 5 }, () => 5), 2, 3, 4];
}

/**
 * 脚：素体模型的坐标里脚趾朝 +z、脚背朝 +y，左脚的大脚趾在 x 小的那一侧（靠身体正中）。
 * 转到手的方向（脚趾朝 +x、大脚趾在 z 大的那一头）拼，拼完再转回来
 */
const footToHand = (p: ArrayLike<number>, i: number): V3 => [p[i + 2], p[i + 1], -p[i]];
const handToFoot = (p: ArrayLike<number>, i: number): V3 => [-p[i + 2], p[i + 1], p[i]];

/**
 * 照总数（TOE_COUNT 以内）重新拼一只脚。toeRoots 是五个脚趾（大脚趾 → 小脚趾）根部在模型里的 x，toeBase 是脚趾根那一排（模型里的 z）。
 * 脚趾共用一根骨骼，骨骼不用改。个数就是本来的五个时原样返回
 */
export function shapeFoot(base: GraftMesh, toeRoots: readonly number[], toeBase: number, count: number): GraftMesh {
  const order = toeSlabs(count);
  if (order.length === 5 && order.every((v, i) => v === i)) return base;
  const turn = (a: Float32Array, to: (p: ArrayLike<number>, i: number) => V3) => {
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i += 3) out.set(to(a, i), i);
    return out;
  };
  const turned: GraftMesh = {
    ...base,
    positions: turn(base.positions, footToHand),
    normals: turn(base.normals, footToHand),
    end: footToHand(base.end, 0),
    root: footToHand(base.root, 0),
  };
  const plan: StripPlan = {
    roots: toeRoots.map((x) => -x),
    copyOf: 1,
    reach: toeBase - TOE_MARGIN,
    wristX: turned.end[0],
    // 脚跟、脚踝不跟着变：只有前脚掌变宽变窄（脚踝那一圈还要和腿缝上）
    wristTaper: 1,
    fingerNames: null,
  };
  const r = reshape(turned, plan, order, order.map((i) => `toe${i}`));
  const index = new Map(base.bones.map((b, i) => [b, i]));
  return {
    positions: turn(r.positions, handToFoot),
    normals: turn(r.normals, handToFoot),
    triangles: r.triangles,
    loop: r.loop,
    joints: Uint8Array.from(r.jointNames, (b) => index.get(b) ?? index.get('Foot')!),
    weights: r.weights,
    bones: base.bones,
    end: base.end,
    root: base.root,
  };
}

/** 脚掌和脚趾的分界离脚趾根那一排多远（往脚跟那边） */
const TOE_MARGIN = 0.004;

/**
 * 折翻的三角面（和挨着的面朝向差得比 FOLD 还多）的顶点挪到邻居的平均位置，反复几遍，直到没有折翻的。
 * 只看 near 的那些（焊缝附近；别处本来就有的尖角不动），开口上的点不动
 */
function unfold(s: Soup, near: (v: number) => boolean): void {
  const count = s.P.length / 3;
  const links: Set<number>[] = Array.from({ length: count }, () => new Set());
  const faces = new Map<string, number[]>();
  for (let f = 0; f < s.T.length; f += 3) {
    for (let k = 0; k < 3; k++) {
      const a = s.T[f + k];
      const b = s.T[f + ((k + 1) % 3)];
      links[a].add(b);
      links[b].add(a);
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      faces.set(key, [...(faces.get(key) ?? []), f / 3]);
    }
  }
  const rim = new Set<number>();
  for (const [key, list] of faces) if (list.length === 1) for (const v of key.split(',').map(Number)) rim.add(v);
  const normal = (t: number): V3 => {
    const [a, b, c] = [s.T[t * 3], s.T[t * 3 + 1], s.T[t * 3 + 2]];
    const e1 = [0, 1, 2].map((k) => s.P[b * 3 + k] - s.P[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => s.P[c * 3 + k] - s.P[a * 3 + k]);
    const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  };
  for (let round = 0; round < UNFOLD_ROUNDS; round++) {
    const bad = new Set<number>();
    for (const [key, list] of faces) {
      if (list.length !== 2) continue;
      const [n1, n2] = list.map(normal);
      if (!key.split(',').map(Number).some(near) || n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] > FOLD) continue;
      for (const t of list) for (let k = 0; k < 3; k++) bad.add(s.T[t * 3 + k]);
      for (const v of key.split(',').map(Number)) for (const u of links[v]) bad.add(u);
    }
    if (!bad.size) return;
    for (let pass = 0; pass < 3; pass++) {
      for (const v of bad) {
        if (rim.has(v)) continue;
        const avg = [0, 0, 0];
        for (const u of links[v]) for (let q = 0; q < 3; q++) avg[q] += s.P[u * 3 + q];
        for (let q = 0; q < 3; q++) s.P[v * 3 + q] = avg[q] / links[v].size;
      }
    }
  }
}
/** 挨着的两个三角面朝向的夹角余弦小于这个算折翻（-0.2：差了一百度以上） */
const FOLD = -0.2;
const UNFOLD_ROUNDS = 12;
/** 只看手指那几条之间的焊缝两边这么宽以内的 */
const UNFOLD_NEAR = 0.004;

/** 手掌拉宽时，拉宽的程度从拇指那一条的切口往外多宽以内逐渐加上去 */
const STRETCH_EASE = 0.014;
/** 压窄到这么多以下时，指根线往里 SQUEEZE_RADIUS 以内磨平几遍 */
const SQUEEZE_SMOOTH = 0.8;
const SQUEEZE_RADIUS = 0.03;
const SQUEEZE_ROUNDS = 60;
/** 手掌（脚掌）压窄时中间那一段最多压到原来的几成 */
const SQUEEZE_MIN = 0.4;

/**
 * 手掌横着拉宽：离拇指那一条的切口 t 远的点挪到多远。整片（宽 width）一共拉宽 ratio 倍，
 * 但拉宽的程度（导数）在两头 STRETCH_EASE 以内是 1、往中间平滑地变到 k：切口那里不折，小指那一侧的边缘还是原来的弧度
 */
function eased(t: number, ratio: number, width: number): number {
  // 压窄得多的时候两头过渡的那一段要窄一点，不然中间那一段压得太扁（导数不小于 SQUEEZE_MIN）
  const roomy = ratio < 1 ? width - (width * (1 - ratio)) / (1 - SQUEEZE_MIN) : Infinity;
  const B = Math.max(0, Math.min(STRETCH_EASE, width * 0.4, roomy));
  if (B < 1e-4) return t * ratio;
  const k = 1 + (width * (ratio - 1)) / (width - B);
  /** smooth01 从 0 积到 x（乘 B 就是那一段的长度） */
  const area = (x: number) => (x <= 0 ? 0 : x >= 1 ? x - 0.5 : x * x * x - (x * x * x * x) / 2);
  const ramp = B * area(t / B) - B * area((t - (width - B)) / B);
  return t + (k - 1) * ramp;
}

/** 手掌和指节的分界离最靠手腕的指根多远 */
const KNUCKLE_MARGIN = 0.008;

/**
 * group 那一块（G）的边界上、落在 onLine 上的那些边连成的一整圈。从最靠外的点（食指那一条下面的指蹼尖）走起，
 * 先往手背那边（y 大的）走；末尾再接上起点，当一条首尾相接的曲线用
 */
function ringOf(s: Soup, group: number, onLine: (v: number) => boolean): number[] {
  const uses = new Map<string, number>();
  for (let f = 0; f < s.T.length; f += 3) {
    if (s.G![f / 3] !== group) continue;
    for (let k = 0; k < 3; k++) {
      const a = s.T[f + k];
      const b = s.T[f + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const next = new Map<number, number[]>();
  for (const [key, n] of uses) {
    if (n !== 1) continue;
    const [a, b] = key.split(',').map(Number);
    if (!onLine(a) || !onLine(b)) continue;
    next.set(a, [...(next.get(a) ?? []), b]);
    next.set(b, [...(next.get(b) ?? []), a]);
  }
  if (![...next.values()].every((n) => n.length === 2)) throw new Error('digits: the knuckle line is not one ring');
  let start = -1;
  for (const v of next.keys()) if (start < 0 || s.P[v * 3] > s.P[start * 3]) start = v;
  const [a, b] = next.get(start)!;
  const ring = [start, s.P[a * 3 + 1] >= s.P[b * 3 + 1] ? a : b];
  while (ring.length <= next.size) {
    const [prev, cur] = [ring[ring.length - 2], ring[ring.length - 1]];
    const n = next.get(cur)!.find((u) => u !== prev)!;
    if (n === start) break;
    ring.push(n);
  }
  if (ring.length !== next.size) throw new Error('digits: the knuckle line is broken');
  return [...ring, start];
}

/** 一整圈（首尾相接）展开以后每个点走到了全长的几成：以展开后最靠里（小指那边）的点为界分成两半，各占一半 */
function ringParams(points: [number, number][]): number[] {
  const along = [0];
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  let tip = 0;
  for (let i = 1; i < points.length - 1; i++) if (points[i][0] < points[tip][0]) tip = i;
  const total = along[along.length - 1];
  const mid = along[tip];
  return along.map((d) => (d <= mid ? (0.5 * d) / mid : 0.5 + (0.5 * (d - mid)) / (total - mid)));
}
