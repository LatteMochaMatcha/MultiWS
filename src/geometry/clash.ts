/**
 * 穿模检查：把每个部件粗略地当成一串「圆棒」（两端半径可以不同的胶囊，取在部件里面，宁小勿大），
 * 看不同部件的圆棒有没有明显插进对方里面。
 *
 * 部件在连接处本来就是长在一起的（肩膀埋在躯干里、尾巴根埋在臀部里），
 * 所以离部件自己的根部很近的那一段重叠不算数。
 */
import {
  type Figure,
  type Part,
  type PartType,
  type Prim,
  type WorldXf,
  shapeMatrix,
  shapeThin,
  worldTransforms,
} from './figure';
import { getGrid } from '../sdf/grids';
import { chestBulk } from '../anime/chest';
import { PENIS_BASE, PENIS_LINE, PENIS_RADIUS } from '../anime/genital';
import { sampleTube } from './shapes';
import { type V3, add, dot, lerp, mat3Apply, mul, rotate, sub } from './vec';

export interface Clash {
  /** 互相穿插的两个部件 */
  a: string;
  b: string;
  /** 插进去多深（米） */
  depth: number;
  /** 大致在哪里（世界坐标，米） */
  at: V3;
}

interface Rod {
  a: V3;
  b: V3;
  ra: number;
  rb: number;
}

interface Body {
  part: Part;
  root: V3;
  rods: Rod[];
  /** 所有圆棒的包围盒，用来快速排除离得远的部件 */
  min: V3;
  max: V3;
}

/** 部件根部这么大范围以内的重叠是「长在一起」，不算穿模（按标准人台的尺寸） */
const ROOT_FREE: Partial<Record<PartType, number>> = {
  arm: 0.13,
  leg: 0.12,
  tail: 0.18,
  neck: 0.07,
  horn: 0.04,
  ear: 0.05,
  // 阴茎根部的圆台往身体里埋了好几厘米，阴囊贴着身体那一面埋在大腿前面
  genital: 0.09,
};
/** 同类部件之间（两条腿、两只角）根部挨得近，多放宽一些 */
const SIBLING_FACTOR = 1.6;
/**
 * 手臂和手臂之间放得更宽：肩部聚拢时几条手臂从同一个肩膀长出来，
 * 整段上臂挨在一起是正常的，只查肘部以下有没有互相插进去。
 */
const ARM_SIBLING_FREE = 0.3;
/** 贴着父部件表面长的部件：它们和父部件的重叠是设计如此 */
const FLUSH: ReadonlySet<PartType> = new Set(['neck', 'chest', 'horn', 'ear']);
/** 躯干和下身各块本来就连成一体 */
const CORE: ReadonlySet<PartType> = new Set(['torso', 'lower']);
/** 头、脖子，和长在头上的东西 */
const CLUSTER: ReadonlySet<PartType> = new Set(['head', 'neck', 'ear', 'horn']);
/** 多个头是脸贴着脸、互相压着一点的：两个头压进对方这么深（两个头的半径之和的几分之几）以内都是摆出来的样子 */
const HEAD_PRESS = 0.3;

/** 一个基本体对应的圆棒（部件的局部坐标） */
function primRods(p: Prim): Rod[] {
  switch (p.kind) {
    case 'ellipsoid': {
      if (p.cut) return [];
      // 沿最长的轴放一串圆棒，每处的粗细取那里放得下的最大的球（贴着椭球里面）：整串都在椭球里面。
      // 只放一根等粗的（取最短的半径）的话，又宽又扁的椭球（并排好多条腿时加宽的胯）两头会高出椭球一大截
      const axis = p.radii[0] >= p.radii[1] && p.radii[0] >= p.radii[2] ? 0 : p.radii[1] >= p.radii[2] ? 1 : 2;
      const long = p.radii[axis];
      const others = p.radii.filter((_, k) => k !== axis);
      const thin = Math.min(...others);
      /** 沿长轴离中心 t 处，放得下的最大的球多大（在每个过长轴的截面里都放得下） */
      const fit = (t: number) =>
        Math.min(...others.map((r) => (long - r > 1e-9 ? r * Math.sqrt(Math.max(0, 1 - (t * t) / (long * long - r * r))) : r)));
      // 再往外放得下的球就是贴着长轴的顶端了
      const reach = long - (thin * thin) / long;
      const unit: V3 = [0, 0, 0];
      unit[axis] = 1;
      const dir = p.quat ? rotate(p.quat, unit) : unit;
      const ts = reach > 1e-6 ? [-1, -0.7, -0.4, 0, 0.4, 0.7, 1].map((f) => f * reach) : [0];
      const at = (t: number) => add(p.center, mul(dir, t));
      if (ts.length === 1) return [{ a: p.center, b: p.center, ra: thin, rb: thin }];
      return ts.slice(1).map((t, i) => ({ a: at(ts[i]), b: at(t), ra: fit(ts[i]), rb: fit(t) }));
    }
    case 'cone':
      return p.cut ? [] : [{ a: p.a, b: p.b, ra: p.ra, rb: p.rb }];
    case 'tube': {
      const pts = sampleTube(p, 6);
      return pts.slice(1).map((q, i) => ({ a: pts[i].point, b: q.point, ra: pts[i].radius, rb: q.radius }));
    }
    case 'loft': {
      // 每隔几厘米取一圈截面，横着放一根圆棒
      const rods: Rod[] = [];
      let last = -Infinity;
      for (const ring of p.rings) {
        if (ring.y - last < 0.035) continue;
        last = ring.y;
        // 又宽又扁的一圈（多个头时并排挤着几根脖子的那一片、加宽过的肩膀）：上下不远处躯干就窄下去了，
        // 圆棒要是还按这一圈的厚度算，会从它下面支出去，把下面一排平举的手臂误报成穿模。
        // 所以半径不超过「到明显变窄的地方有多远」
        let clear = Infinity;
        if (ring.w > ring.d * 1.8) {
          for (const other of p.rings) if (other.w < ring.w * 0.85) clear = Math.min(clear, Math.abs(other.y - ring.y));
        }
        const r = Math.min(ring.w, ring.d, clear) * 0.92;
        const half = Math.max(0, ring.w - ring.d) * 0.9;
        rods.push({ a: [-half, ring.y, ring.z], b: [half, ring.y, ring.z], ra: r, rb: r });
      }
      return rods;
    }
    case 'wing':
      return [];
    case 'grid': {
      // 采样好的形状：沿它最长的方向放一根圆棒，粗细取另外两个方向里窄的那个的一小半（宁小勿大）
      if (p.cut) return [];
      const bounds = getGrid(p.grid).bounds;
      // 只留了上面一截（clipBelow）、下面一截（clipAbove）的：照留下的那一截算
      const max: V3 = [bounds.max[0], Math.min(bounds.max[1], p.clipAbove ?? Infinity), bounds.max[2]];
      const min: V3 = [bounds.min[0], Math.max(bounds.min[1], p.clipBelow ?? -Infinity), bounds.min[2]];
      const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
      const axis = size[0] >= size[1] && size[0] >= size[2] ? 0 : size[1] >= size[2] ? 1 : 2;
      const r = Math.min(...size.filter((_, k) => k !== axis)) * 0.22;
      const flip = p.mirror ? -1 : 1;
      const a: V3 = [((min[0] + max[0]) / 2) * flip, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
      const b: V3 = [a[0], a[1], a[2]];
      a[axis] = (axis === 0 ? flip : 1) * (min[axis] + r);
      b[axis] = (axis === 0 ? flip : 1) * (max[axis] - r) + (axis === 1 ? (p.stretchY?.[2] ?? 0) : 0);
      return [{ a, b, ra: r, rb: r }];
    }
    case 'chest': {
      // 胸：从胸根中心（部件的原点，在平胸表面上）往前放一根短圆棒，粗细取胸根半径的一半多一点（宁小勿大）
      const { radius, depth } = chestBulk(p.size);
      const r = radius * 0.6;
      if (depth < r) return [];
      return [{ a: [0, -0.2 * radius, r * 0.5], b: [0, -0.2 * radius, depth - r], ra: r, rb: r }];
    }
  }
}

/** 部件根部多大范围以内的重叠不算（部件自己的单位） */
function rootFree(part: Part): number {
  const base = part.rootFree ?? ROOT_FREE[part.type] ?? 0;
  if (part.type !== 'tail') return base;
  // 蓬松的尾巴根部本来就很粗，整个贴在身上：按蓬松程度放宽
  const fluff = Math.max(0, ...part.prims.map((p) => (p.kind === 'tube' ? p.bulge : 0)));
  return base + 2.2 * fluff;
}

/** 阴茎（部件的局部坐标，原点在根部）：中心线每隔一段一根圆棒 */
function penisRods(): Rod[] {
  const pts = PENIS_LINE.filter((_, k) => k % 4 === 0 || k === PENIS_LINE.length - 1).map((p) => sub(p, PENIS_BASE));
  const r = PENIS_RADIUS * 0.9;
  return pts.slice(1).map((b, i) => ({ a: pts[i], b, ra: r, rb: r }));
}

function toBody(part: Part, xf: WorldXf): Body {
  const shape = shapeMatrix(part);
  const thin = shapeThin(part);
  const place = (q: V3): V3 => add(xf.pos, mul(rotate(xf.quat, shape ? mat3Apply(shape, q) : q), xf.scale));
  // 缝上去的阴茎不在基本体里：顺着它的中心线另放一串圆棒（粗细取九成，宁小勿大）
  const grafted = part.grafts?.some((g) => g.mesh === 'penis') ? penisRods() : [];
  const rods = [...part.prims.flatMap(primRods), ...grafted].map((r) => ({
    a: place(r.a),
    b: place(r.b),
    ra: r.ra * xf.scale * thin,
    rb: r.rb * xf.scale * thin,
  }));
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const r of rods) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], r.a[k] - r.ra, r.b[k] - r.rb);
      max[k] = Math.max(max[k], r.a[k] + r.ra, r.b[k] + r.rb);
    }
  }
  return { part, root: xf.pos, rods, min, max };
}

const apart = (a: Body, b: Body) =>
  a.min[0] > b.max[0] || b.min[0] > a.max[0] || a.min[1] > b.max[1] || b.min[1] > a.max[1] || a.min[2] > b.max[2] || b.min[2] > a.max[2];

/** 两条线段上离得最近的一对点，返回它们各自在线段上的位置（0–1） */
function closest(p1: V3, q1: V3, p2: V3, q2: V3): [number, number] {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  if (a < 1e-12 && e < 1e-12) return [0, 0];
  if (a < 1e-12) return [0, clamp(f / e)];
  const c = dot(d1, r);
  if (e < 1e-12) return [clamp(-c / a), 0];
  const b = dot(d1, d2);
  const denom = a * e - b * b;
  let s = denom > 1e-12 ? clamp((b * f - c * e) / denom) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = clamp(-c / a);
  } else if (t > 1) {
    t = 1;
    s = clamp((b - c) / a);
  }
  return [s, t];
}

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const neckOf = (headName: string) => headName.replace('Head_', 'Neck_');

/** 这两个部件之间的重叠是不是设计如此，根本不用查 */
function related(a: Part, b: Part): boolean {
  if (a.type === 'eye' || b.type === 'eye' || a.type === 'wing' || b.type === 'wing') return true;
  // 头发是搭在别的东西上的：披在背上、垂在肩头、和隔壁的头发挨着，都是它本来的样子
  if (a.type === 'hair' || b.type === 'hair') return true;
  if (FLUSH.has(a.type) && a.parent === b.name) return true;
  if (FLUSH.has(b.type) && b.parent === a.name) return true;
  if (CORE.has(a.type) && CORE.has(b.type)) return true;
  if (a.type === 'head' && b.type === 'neck' && neckOf(a.name) === b.name) return true;
  if (b.type === 'head' && a.type === 'neck' && neckOf(b.name) === a.name) return true;
  // 一排排的胸、挤在一起的尾巴：互相贴着是正常的
  if (a.type === b.type && (a.type === 'chest' || a.type === 'tail')) return true;
  // 多个头是凑成一簇的：脖子根并在一起，里侧的角和耳朵挨着隔壁的头。头和头之间另外算（见 HEAD_PRESS）
  if (CLUSTER.has(a.type) && CLUSTER.has(b.type) && !(a.type === 'head' && b.type === 'head')) return true;
  // 同一个头上的几张脸（多出来的脸是正面那个头的子部件）本来就长在一起
  if (a.type === 'head' && b.type === 'head' && skullOf(a) === skullOf(b)) return true;
  return false;
}

/** 这张脸长在哪个头上：多出来的脸是正面那个头的子部件，别的头就是它自己 */
function skullOf(head: Part): string {
  return head.parent?.startsWith('Head_') ? head.parent : head.name;
}

export interface ClashOptions {
  /** 插进去超过这么深才算穿模（米，按最终身高算）。默认 2 cm */
  tolerance?: number;
}

/** 找出明显互相穿插的部件对，按深度从大到小排 */
export function findClashes(figure: Figure, options: ClashOptions = {}): Clash[] {
  const tolerance = options.tolerance ?? 0.02;
  const xfs = worldTransforms(figure);
  const bodies = figure.parts.map((p) => toBody(p, xfs.get(p.name)!)).filter((b) => b.rods.length > 0);
  const free = (b: Body, sibling: boolean) =>
    (sibling ? (b.part.siblingFree ?? (b.part.type === 'arm' ? ARM_SIBLING_FREE : rootFree(b.part) * SIBLING_FACTOR)) : rootFree(b.part)) * figure.scale;

  const out: Clash[] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i];
      const B = bodies[j];
      if (apart(A, B) || related(A.part, B.part)) continue;
      const sibling = A.part.type === B.part.type;
      const freeA = free(A, sibling);
      const freeB = free(B, sibling);
      const press = A.part.type === 'head' && B.part.type === 'head' ? 1 - HEAD_PRESS : 1;
      let worst = 0;
      let where: V3 = [0, 0, 0];
      for (const ra of A.rods) {
        for (const rb of B.rods) {
          const [s, t] = closest(ra.a, ra.b, rb.a, rb.b);
          const pa = lerp(ra.a, ra.b, s);
          const pb = lerp(rb.a, rb.b, t);
          const depth = (ra.ra + (ra.rb - ra.ra) * s + rb.ra + (rb.rb - rb.ra) * t) * press - dist(pa, pb);
          if (depth <= worst) continue;
          if (dist(pa, A.root) < freeA || dist(pb, B.root) < freeB) continue;
          worst = depth;
          where = lerp(pa, pb, 0.5);
        }
      }
      if (worst > tolerance) out.push({ a: A.part.name, b: B.part.name, depth: worst, at: where });
    }
  }
  return out.sort((x, y) => y.depth - x.depth);
}

/** 一行文字的小结，开发时打在控制台里 */
export function describeClashes(clashes: Clash[]): string {
  return clashes.map((c) => `${c.a} × ${c.b}（${(c.depth * 100).toFixed(1)} cm）`).join('，');
}
