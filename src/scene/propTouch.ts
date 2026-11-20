/**
 * 角色和道具之间的肢体互动（见 docs/props-plan.md 第 3 期）：拖手脚、拖胯时碰到道具就停在表面，身体插进道具里时提示。
 *
 * 角色之间用的是「骨架当胶囊体」（见 interact.ts）；道具这边直接拿它的网格算：
 * 基本体、低模家具都只有几十到一千多个三角面，点到表面多远、点在不在里面，逐个面算一遍就够快
 * （写实款面多，文件里另带一份碰撞用的粗网格，见 geometry/propMesh.ts 的 touchShapeOf）。
 * - 多远：点到每个三角面最近的那一点，取最近的。
 * - 在不在里面：把每个面对着这个点张开的立体角加起来（绕数）。家具是好几块封闭的壳叠在一起拼的，
 *   数「穿过几个面」会数错，绕数不会；有缺口的网格得到的是小数，过半就算在里面。
 * 都是纯函数。坐标是调用的人定的：main.ts 里把道具换到当前角色的坐标（它站在原点）再来问。
 */
import { type V3, add, cross, dot, len, madd, mul, sub } from '../geometry/vec';
import { propWorldPoints, touchShapeOf } from '../geometry/propMesh';
import type { SceneProp } from '../model/props';
import type { Place } from '../model/scene';
import { type BodyPart, type Capsule, fromScene } from './interact';

/** 一件道具摆好以后的样子：能问「这一点离它多远、在不在里面」 */
export interface PropSolid {
  id: string;
  /** 每三个数一个点（米） */
  points: Float32Array;
  indices: Uint32Array;
  min: V3;
  max: V3;
}

/**
 * 道具摆到场景里的网格。here：换到站在这里的角色的坐标（屏幕上当前角色在原点）；不给就是场景的坐标
 */
export function propSolid(prop: SceneProp, here?: Place): PropSolid {
  const shape = touchShapeOf(prop);
  const points = propWorldPoints(prop, shape);
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    if (here) {
      const p = fromScene(here, [points[i], points[i + 1], points[i + 2]]);
      points[i] = p[0];
      points[i + 1] = p[1];
      points[i + 2] = p[2];
    }
    for (let k = 0; k < 3; k++) {
      if (points[i + k] < min[k]) min[k] = points[i + k];
      if (points[i + k] > max[k]) max[k] = points[i + k];
    }
  }
  return { id: prop.id, points, indices: shape.indices, min, max };
}

const at = (points: Float32Array, i: number): V3 => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];

/** 点 p 到三角面 abc 最近的那一点 */
function closestOnTriangle(p: V3, a: V3, b: V3, c: V3): V3 {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return madd(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return madd(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return madd(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const denom = va + vb + vc;
  if (Math.abs(denom) < 1e-18) return a;
  return add(a, add(mul(ab, vb / denom), mul(ac, vc / denom)));
}

/** 点 p 离这件道具的盒子多远（在盒子里是 0）：先粗筛 */
function boxDistance(solid: PropSolid, p: V3): number {
  let d2 = 0;
  for (let k = 0; k < 3; k++) {
    const d = Math.max(solid.min[k] - p[k], 0, p[k] - solid.max[k]);
    d2 += d * d;
  }
  return Math.sqrt(d2);
}

/** 表面上离 p 最近的那一点，和有多远 */
export function closestOnSolid(solid: PropSolid, p: V3): { point: V3; dist: number } {
  let best: V3 = p;
  let bestD = Infinity;
  const { points, indices } = solid;
  for (let i = 0; i < indices.length; i += 3) {
    const q = closestOnTriangle(p, at(points, indices[i]), at(points, indices[i + 1]), at(points, indices[i + 2]));
    const d = len(sub(p, q));
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return { point: best, dist: bestD };
}

/** 点在不在道具里面（绕数过半） */
export function insideSolid(solid: PropSolid, p: V3): boolean {
  for (let k = 0; k < 3; k++) if (p[k] < solid.min[k] || p[k] > solid.max[k]) return false;
  const { points, indices } = solid;
  let total = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = sub(at(points, indices[i]), p);
    const b = sub(at(points, indices[i + 1]), p);
    const c = sub(at(points, indices[i + 2]), p);
    const la = len(a);
    const lb = len(b);
    const lc = len(c);
    // 正好在面上、在顶点上：这个面不算
    if (la < 1e-9 || lb < 1e-9 || lc < 1e-9) continue;
    const num = dot(a, cross(b, c));
    const den = la * lb * lc + dot(a, b) * lc + dot(b, c) * la + dot(c, a) * lb;
    total += 2 * Math.atan2(num, den);
  }
  // 面朝外（从外面看逆时针）：点在里面时每个面的立体角加起来是 4π，在外面是 0
  return total / (4 * Math.PI) > 0.5;
}

/** 点到道具表面的距离：在外面是正的，在里面是负的 */
export function solidDistance(solid: PropSolid, p: V3): number {
  const { dist } = closestOnSolid(solid, p);
  return insideSolid(solid, p) ? -dist : dist;
}

/** 点 p 离这件道具够不够远：不在里面，离表面至少 extra */
function clearOf(solid: PropSolid, p: V3, extra: number): boolean {
  if (boxDistance(solid, p) >= extra) return true;
  return closestOnSolid(solid, p).dist >= extra - 1e-6 && !insideSolid(solid, p);
}

/**
 * 点 p 要是在道具里面、或者离表面不到 extra，就推到离表面 extra 的地方（从最近的那一面出去）。
 * 挨着的几件道具推来推去，反复几遍；还是出不来（两件贴在一起，从这件出来正好进了那件）就往上：
 * 挪到挡着它的道具顶上，取够得着的最低的那一层
 */
export function pushOutOfSolids(p: V3, solids: readonly PropSolid[], extra: number): V3 {
  let out = p;
  for (let round = 0; round < 4; round++) {
    let moved = false;
    for (const solid of solids) {
      if (boxDistance(solid, out) >= extra) continue;
      const { point, dist } = closestOnSolid(solid, out);
      const inside = insideSolid(solid, out);
      if (!inside && dist >= extra - 1e-6) continue;
      // 在里面：穿过最近的那一面出去；在外面：顺着原来的方向再退一点。正好在面上没有方向，往上
      const dir: V3 = dist > 1e-6 ? mul(inside ? sub(point, out) : sub(out, point), 1 / dist) : [0, 1, 0];
      out = madd(point, dir, extra);
      moved = true;
    }
    if (!moved) return out;
  }
  if (solids.every((solid) => clearOf(solid, out, extra))) return out;
  const tops = solids
    .filter((solid) => !clearOf(solid, p, extra) || !clearOf(solid, out, extra))
    .map((solid) => solid.max[1] + extra)
    .sort((a, b) => a - b);
  for (const y of tops) {
    const up: V3 = [p[0], y, p[2]];
    if (y >= p[1] && solids.every((solid) => clearOf(solid, up, extra))) return up;
  }
  return tops.length ? [p[0], tops[tops.length - 1], p[2]] : out;
}

/** 沿路每隔多远查一次（米）：比薄板（椅子的坐面、桌面）薄 */
const PATH_STEP = 0.02;

/**
 * 拖动时的「停在表面」：手从 from（上一次停的地方）往 target 走，路上碰到道具就停在那一面上，剩下的路贴着表面滑。
 *
 * 只把目标点推到最近的表面（pushOutOfSolids）不够：桌面、坐面是薄板，手往下按过了板子的一半，最近的面就成了底面，
 * 手会从板子底下冒出来；拖得快，一步跨过整块板子也会穿过去。所以要记着手是从哪一边来的。
 * from 自己就在道具里面（开始拖的时候手已经插在里面）：没有「哪一边」可言，退回推到最近的表面
 */
export function slideOutOfSolids(from: V3, target: V3, solids: readonly PropSolid[], extra: number): V3 {
  if (!solids.length) return target;
  const clear = (p: V3) => solids.every((solid) => clearOf(solid, p, extra));
  if (!clear(from)) return pushOutOfSolids(target, solids, extra);
  const path = sub(target, from);
  const length = len(path);
  // 沿路查过去：第一个进了道具（或者离表面不到 extra）的地方
  const steps = Math.min(96, Math.max(1, Math.ceil(length / PATH_STEP)));
  let free = 0;
  let blocked = -1;
  for (let s = 1; s <= steps; s++) {
    if (clear(madd(from, path, s / steps))) free = s / steps;
    else {
      blocked = s / steps;
      break;
    }
  }
  if (blocked < 0) return target;
  // 在这一小段里对半找，找到正好碰上的那一点
  let lo = free;
  let hi = blocked;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (clear(madd(from, path, mid))) lo = mid;
    else hi = mid;
  }
  const stop = madd(from, path, lo);
  // 挡着它的那一面朝哪边：从表面上最近的那一点指向停下来的地方
  let normal: V3 | null = null;
  let nearest = Infinity;
  for (const solid of solids) {
    if (boxDistance(solid, stop) >= extra + PATH_STEP) continue;
    const { point, dist } = closestOnSolid(solid, stop);
    if (dist < nearest && dist > 1e-6) {
      nearest = dist;
      normal = mul(sub(stop, point), 1 / dist);
    }
  }
  if (!normal) return stop;
  // 剩下的路去掉往里的那一份，贴着表面滑过去；滑到的地方还挨着别的面就再推出来
  const rest = sub(target, stop);
  const into = dot(rest, normal);
  const slid = pushOutOfSolids(into < 0 ? madd(add(stop, rest), normal, -into) : add(stop, rest), solids, extra);
  // 滑过去的路上又隔着东西（绕过了棱、钻到了另一件后面）：就停在碰上的地方
  const hop = sub(slid, stop);
  const hops = Math.min(48, Math.max(1, Math.ceil(len(hop) / PATH_STEP)));
  for (let s = 1; s <= hops; s++) {
    const p = madd(stop, hop, s / hops);
    if (solids.some((solid) => insideSolid(solid, p))) return stop;
  }
  return slid;
}

/** 身体和一件道具穿插的一处：哪件道具、身上哪一块、插进去多深（米） */
export interface PropClash {
  id: string;
  part: BodyPart;
  depth: number;
}

/**
 * 穿插不到这么深（米）不算：坐着、躺着时身体本来就压在道具上，胶囊体又只是身体的大概。
 * 6 厘米是在椅子上试出来的：胯拖到坐面上停住（见 main.ts 的 TOUCH_ROOM）、脚踩着地，大腿照胶囊体算压进坐面 4.4 厘米，看着是正常的坐姿
 */
export const PROP_CLASH_TOLERANCE = 0.06;

/** 手、脚碰道具是互动本身（扶着、踩着），不算穿插 */
const isEnd = (c: Capsule) => /^(Hand|Foot)/.test(c.bone);

/**
 * 身体（骨架的胶囊体）和道具哪里穿插：每段胶囊体沿中线取几个点，量到道具表面多远，比半径近多少就是插进去多深。
 * 同一件道具、同一块身体只留插得最深的那一次，深的排前面。手脚不算
 */
export function propClashes(body: readonly Capsule[], solids: readonly PropSolid[], tolerance = PROP_CLASH_TOLERANCE): PropClash[] {
  const worst = new Map<string, PropClash>();
  for (const solid of solids) {
    for (const c of body) {
      if (isEnd(c)) continue;
      const axis = sub(c.b, c.a);
      const steps = Math.max(1, Math.ceil(len(axis) / Math.max(c.r, 0.02)));
      let depth = -Infinity;
      for (let s = 0; s <= steps; s++) {
        const p = madd(c.a, axis, s / steps);
        if (boxDistance(solid, p) >= c.r - tolerance) continue;
        depth = Math.max(depth, c.r - solidDistance(solid, p));
      }
      if (depth <= tolerance) continue;
      const key = `${solid.id}|${c.part}`;
      const was = worst.get(key);
      if (!was || depth > was.depth) worst.set(key, { id: solid.id, part: c.part, depth });
    }
  }
  return [...worst.values()].sort((a, b) => b.depth - a.depth);
}
