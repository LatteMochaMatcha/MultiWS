/**
 * 「自然下垂」：头发、裙摆、衣摆、袖子（勾上的话还有尾巴）照重力垂下来，碰到身体、地面就停在外面。纯函数。
 *
 * 不是物理模拟，是一步算出来的。静止姿势里它们本来的样子，就当作「站着时被重力拉成的样子」：
 * 身体摆了姿势以后，每一节看自己的父骨骼——在父骨骼看来重力的方向变了多少，它就跟着转回去一部分（COMPLIANCE），
 * 从根往梢一节一节传下去：根上转得少（钉在头皮上、腰上），越往梢越接近完全朝下。
 * 所以站着点它什么都不变（设计好的发型、裙摆的样子都在）；躺下、弯腰、倒立时才垂下来。
 * 转完再看这一节的末端有没有扎进身体、地面，扎进去了就把这一节拨到外面。
 *
 * 照的是 VRM 的弹簧骨骼（VRoid、Blender 的 Wiggle 插件也是这一套）：一节一节从根往梢、末端碰到球就推出去。
 * 只是那边是一帧一帧地晃，这里只要停下来的那个样子。
 */
import { type Quat, type V3, add, dot, len, norm, quatBetween, quatConj, quatMul, rotate, sub } from '../geometry/vec';
import { quatPart, quatUnit } from './math';
import { type PoseRig, type PoseState, cloneState } from './rig';

export type DrapeKind = 'hair' | 'cloth' | 'tail';

/** 骨骼名 → 哪一种（成品角色的骨骼名见 character/assemble.ts 的 boneNames；尾巴见 rig/skeleton.ts） */
const FAMILIES: [RegExp, DrapeKind][] = [
  [/^Hair_/, 'hair'],
  [/^(Coat)?Skirt/, 'cloth'],
  [/Sleeve/, 'cloth'],
  [/^Tail_/, 'tail'],
];

/** 每一节跟着重力转回去多少，其余的保持在父骨骼上本来的样子。尾巴自己有劲，转得少 */
const COMPLIANCE: Record<DrapeKind, number> = { hair: 0.5, cloth: 0.45, tail: 0.25 };

/** 末端离身体、地面至少多远（米）：骨骼在一缕头发、一片裙摆的中间，外面还有一层 */
export const CLEARANCE: Record<DrapeKind, number> = { hair: 0.015, cloth: 0.01, tail: 0.03 };

/** 这副骨架上哪些骨骼会垂下来、各是哪一种。tails：尾巴算不算（尾巴本来翘着是设计，默认不动它） */
export function drapeBones(rig: PoseRig, tails: boolean): Map<number, DrapeKind> {
  const out = new Map<number, DrapeKind>();
  rig.names.forEach((name, j) => {
    if (rig.parent[j] < 0) return;
    const kind = FAMILIES.find(([re]) => re.test(name))?.[1];
    if (kind && (tails || kind !== 'tail')) out.set(j, kind);
  });
  return out;
}

/** 找表面时最远看多远（米）：比这更深地扎在身体里的认不出来，当作在外面 */
const REACH = 0.08;
const cellOf = (x: number) => Math.floor(x / REACH);
const keyOf = (ix: number, iy: number, iz: number) => ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);

/**
 * 身体表面：一把均匀撒在表面上的点和朝外的法线（米），量一个点离身体多远用。
 * 点在 REACH 那么大的格子里分好，找最近的只看周围 27 格。
 */
export class BodySurface {
  private readonly cells = new Map<number, number[]>();

  constructor(
    readonly points: Float32Array,
    readonly normals: Float32Array,
  ) {
    for (let i = 0; i < points.length / 3; i++) {
      const key = keyOf(cellOf(points[i * 3]), cellOf(points[i * 3 + 1]), cellOf(points[i * 3 + 2]));
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, (cell = []));
      cell.push(i);
    }
  }

  /**
   * p 离表面多远（在外面为正，扎进去为负）和那里朝外的方向。离最近的表面也比 REACH 远就是 null。
   * 朝外的方向取最近那一点附近（再远一厘米以内）几个点的法线的平均，免得一个点的法线歪了推错方向
   */
  near(p: V3): { gap: number; normal: V3 } | null {
    const { points, normals } = this;
    const [cx, cy, cz] = [cellOf(p[0]), cellOf(p[1]), cellOf(p[2])];
    const found: { i: number; d: number }[] = [];
    let best = REACH * REACH;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cell = this.cells.get(keyOf(cx + dx, cy + dy, cz + dz));
          if (!cell) continue;
          for (const i of cell) {
            const x = points[i * 3] - p[0];
            const y = points[i * 3 + 1] - p[1];
            const z = points[i * 3 + 2] - p[2];
            const d = x * x + y * y + z * z;
            if (d > (Math.sqrt(best) + 0.01) ** 2) continue;
            if (d < best) best = d;
            found.push({ i, d });
          }
        }
      }
    }
    if (!found.length || best >= REACH * REACH) return null;
    const limit = (Math.sqrt(best) + 0.01) ** 2;
    const sum: V3 = [0, 0, 0];
    let nearest = found[0];
    for (const f of found) {
      if (f.d > limit) continue;
      if (f.d < nearest.d) nearest = f;
      sum[0] += normals[f.i * 3];
      sum[1] += normals[f.i * 3 + 1];
      sum[2] += normals[f.i * 3 + 2];
    }
    if (len(sum) < 1e-9) return null;
    const normal = norm(sum);
    const at: V3 = [points[nearest.i * 3], points[nearest.i * 3 + 1], points[nearest.i * 3 + 2]];
    return { gap: dot(sub(p, at), normal), normal };
  }
}

export interface DrapeScene {
  /** 现在摆着的身体表面；没有就只躲地面 */
  now: BodySurface | null;
  /** 静止姿势里的身体表面：本来就贴着、扎着身体的（设计成那样的），垂下来以后也只要求离那么远 */
  rest: BodySurface | null;
  /** 地面多高（米） */
  floor: number;
  /** 有的骨骼自己量过有多粗（尾巴）：末端离身体、地面至少这么远，比 CLEARANCE 大的话用它 */
  radius?: ReadonlyMap<number, number>;
}

const DOWN: V3 = [0, -1, 0];
const ORIGIN: V3 = [0, 0, 0];

/** 把 state 里会垂下来的那些骨骼换成垂下来的样子，返回新的姿势（别的骨骼不动） */
export function drape(rig: PoseRig, state: PoseState, bones: ReadonlyMap<number, DrapeKind>, scene: DrapeScene): PoseState {
  const next = cloneState(state);
  const n = rig.names.length;
  const rot = new Array<Quat>(n);
  const pos = new Array<V3>(n);
  /**
   * 不算碰撞、只照重力垂下来时每根骨骼朝哪。下一节从这里接着垂：
   * 上一节被身体拨开了，只是它自己挪了位置，下一节还是照原来的垂法往下（搭在手臂上的头发从手臂两边垂下去），
   * 不然拨开的那一下会一节一节传下去，整缕头发翘出去
   */
  const free = new Array<Quat>(n);
  for (let j = 0; j < n; j++) {
    const p = rig.parent[j];
    let offset = sub(rig.head[j], p >= 0 ? rig.head[p] : ORIGIN);
    if (j === rig.hips) offset = add(offset, next.root);
    pos[j] = p >= 0 ? add(pos[p], rotate(rot[p], offset)) : offset;
    const kind = bones.get(j);
    if (!kind || p < 0) {
      rot[j] = free[j] = p >= 0 ? quatMul(rot[p], next.local[j]) : next.local[j];
      continue;
    }
    // 在父骨骼看来，重力从静止时的「正下方」变到了哪：跟着转回去一部分
    const seen = rotate(quatConj(free[p]), DOWN);
    let world = (free[j] = quatMul(free[p], quatPart(quatBetween(DOWN, seen), COMPLIANCE[kind])));
    const bone = sub(rig.tail[j], rig.head[j]);
    const length = len(bone);
    if (length > 1e-6) {
      const need = Math.max(CLEARANCE[kind], scene.radius?.get(j) ?? 0);
      // 静止时离得比 need 还近的（设计成贴着身体的），垂下来以后也只要求离那么远
      const restGap = scene.rest?.near(rig.tail[j])?.gap ?? Infinity;
      const body = Math.min(need, restGap);
      const ground = Math.min(need, rig.tail[j][1] - scene.floor);
      let tip = add(pos[j], rotate(world, bone));
      for (let k = 0; k < 4; k++) {
        let out = tip;
        const hit = scene.now?.near(out);
        if (hit && hit.gap < body) out = add(out, hit.normal.map((c) => c * (body - hit.gap)) as V3);
        if (out[1] - scene.floor < ground) out = [out[0], scene.floor + ground, out[2]];
        if (out === tip) break;
        // 末端拨出来：这一节绕自己的根转过去，长度不变
        const from = norm(sub(tip, pos[j]));
        const to = norm(sub(out, pos[j]));
        world = quatUnit(quatMul(quatBetween(from, to), world));
        tip = add(pos[j], rotate(world, bone));
      }
    }
    rot[j] = world;
    next.local[j] = quatUnit(quatMul(quatConj(rot[p]), world));
  }
  return next;
}

/**
 * 每根骨骼自己有多粗：主要跟着它动的那些顶点（静止时，米）到这一节骨头的距离取中位数。
 * 量尾巴用：尾巴蓬松调得大，末端要离地面、身体远一些，不然半截尾巴埋进地里
 */
export function boneRadius(rig: PoseRig, own: ReadonlyMap<number, Float32Array>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [j, points] of own) {
    const a = rig.head[j];
    const ab = sub(rig.tail[j], a);
    const l2 = dot(ab, ab);
    const d: number[] = [];
    for (let i = 0; i < points.length; i += 3) {
      const ap: V3 = [points[i] - a[0], points[i + 1] - a[1], points[i + 2] - a[2]];
      const t = l2 > 0 ? Math.max(0, Math.min(1, dot(ap, ab) / l2)) : 0;
      d.push(len(sub(ap, [ab[0] * t, ab[1] * t, ab[2] * t])));
    }
    if (d.length >= 8) out.set(j, d.sort((x, y) => x - y)[d.length >> 1]);
  }
  return out;
}
