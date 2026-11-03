/**
 * 以前存下来的姿势里转过头的锁骨：退回到肩关节刚好贴着身子。
 *
 * 以前拖肩上的圆点时锁骨能随便转，有的姿势里锁骨转了一百多度，把肩关节带离躯干十几厘米，重新融合以后手臂悬在半空。
 * 现在锁骨自己最多转 COLLAR_MAX，再往外是上身跟着转（见 solve.ts、handles.ts）；存下来的姿势推不出当时是怎么拖的，
 * 只能照原来那根轴按比例退回去：退到肩关节刚好贴着身子为止，没带出身子的不动。
 * 锁骨下面那一节（上臂）在世界里的朝向不变：手臂整条平移回肩膀上，长短、方向都不变。
 * 贴没贴着：从肩关节往带着锁骨的那节骨骼（上胸）上离它最近的一点走，要走多远才进到身子里——不比手臂的根从肩关节往回伸出去的
 * （见 rootReach）、也不比静止时多出 GAP 以上，就是贴着（肩关节本身不一定在身子里：标准人台是靠肩头的大圆球接上的）。
 * 身子是静止姿势下的距离场（不含手臂，见 clear.ts 的 BodyDist），肩关节照那节骨骼换算回静止姿势里去量。
 * 纯函数。
 */
import { type Figure, worldTransforms } from '../geometry/figure';
import { type V3, add, dot, len, mul, norm, quatConj, quatMul, rotate, sub } from '../geometry/vec';
import { buildSkeleton } from '../rig/skeleton';
import { compilePartField, fieldAt } from '../sdf/field';
import type { BodyDist } from './clear';
import { quatAngle, quatPart } from './math';
import type { Posing } from './posing';
import { forward, tailOf } from './rig';
import { COLLAR_MAX } from './solve';
import { type Solver, posingOf, stateOf } from './solver';

/** 从肩关节走进身子，比手臂的根伸出去的、比静止时多走这么远以内还算贴着（按标准人台的米）：融合的圆角盖得住 */
const GAP = 0.005;
/** 量手臂的根往回伸出去多远时，最多量到这么远（按标准人台的米） */
const REACH_MAX = 0.15;
/** 往身子里走时每一步多远（按标准人台的米） */
const STEP = 0.002;
/** 找退到哪儿时对半分几次 */
const HALVINGS = 12;

/**
 * 每条手臂的根从肩关节往回（和上臂反着的方向，朝身子那边）伸出去多远（米），按锁骨在骨架里的下标查。
 * 照举高以后换上的那套基本体量（见 Part.posed：二次元素体本来的肩膀举高以后根部切掉，只剩圆肩头），没有就照本来的
 */
export function rootReach(figure: Figure): (collar: number) => number {
  const { bones } = buildSkeleton(figure);
  const xfs = worldTransforms(figure);
  const known = new Map<number, number>();
  return (collar) => {
    const had = known.get(collar);
    if (had !== undefined) return had;
    let reach = 0;
    const part = figure.parts.find((p) => p.name === bones[collar].part);
    const upper = bones.findIndex((b) => b.parent === collar);
    if (part && upper >= 0) {
      const field = compilePartField({ ...part, prims: part.posed?.prims ?? part.prims }, xfs.get(part.name)!);
      const { head, tail } = bones[upper];
      const back = norm(sub(head, tail));
      for (let d = 0; d <= REACH_MAX * figure.scale; d += STEP * figure.scale) {
        const p = add(head, mul(back, d));
        if (fieldAt(field, p[0], p[1], p[2]) > 0) break;
        reach = d;
      }
    }
    known.set(collar, reach);
    return reach;
  };
}

/**
 * 退回转过头的锁骨（见文件开头）。body：要用到的时候才取（大多数姿势里没有转过头的锁骨，不用编译身子的距离场），
 * 身子的距离场和各条手臂的根伸出去多远（见 rootReach）；scale：骨架比标准人台大多少倍。没有要退的就返回原来那份
 */
export function settleCollars(solver: Solver, posing: Posing, body: () => { dist: BodyDist; reach: (collar: number) => number } | null, scale = 1): Posing {
  const { rig } = solver;
  const state = stateOf(solver, posing);
  const turned = rig.names.map((_, bone) => bone).filter((bone) => rig.names[bone].startsWith('Shoulder') && rig.parent[bone] >= 0 && quatAngle(state.local[bone]) > COLLAR_MAX);
  if (!turned.length) return posing;
  const room = body();
  if (!room) return posing;
  const { dist } = room;
  const original = state.local.slice();
  let changed = false;
  for (const bone of turned) {
    const host = rig.parent[bone];
    const kids = rig.names.map((_, k) => k).filter((k) => rig.parent[k] === bone);
    // 那节骨骼上离肩关节最近的一点（静止姿势里）
    const axis = sub(rig.tail[host], rig.head[host]);
    const along = Math.min(Math.max(dot(sub(rig.tail[bone], rig.head[host]), axis) / (dot(axis, axis) || 1), 0), 1);
    const spine = add(rig.head[host], mul(axis, along));
    /** 从静止姿势里的 at 往 spine 走，走多远进到身子里 */
    const gapOf = (at: V3) => {
      const way = sub(spine, at);
      const steps = Math.max(1, Math.ceil(len(way) / (STEP * scale)));
      for (let i = 0; i <= steps; i++) {
        const p = add(at, mul(way, i / steps));
        if (dist(p[0], p[1], p[2]) <= 0) return (len(way) * i) / steps;
      }
      return len(way);
    };
    const allowed = Math.max(gapOf(rig.tail[bone]), room.reach(bone)) + GAP * scale;
    /** 锁骨只转原来的 t 倍，下面那一节在世界里的朝向不变 */
    const set = (t: number) => {
      const turn = quatPart(original[bone], t);
      const fix = quatMul(quatConj(turn), original[bone]);
      state.local[bone] = turn;
      for (const k of kids) state.local[k] = quatMul(fix, original[k]);
    };
    /** 现在贴不贴着：肩关节照带着锁骨的那节骨骼换算回静止姿势里，往里走进身子比静止时多走多远 */
    const near = () => {
      const f = forward(rig, state);
      const at = add(rig.head[host], rotate(quatConj(f.rot[host]), sub(tailOf(rig, f, bone), f.pos[host])));
      return gapOf(at) <= allowed;
    };
    if (near()) continue;
    // 一点都不转时肩关节就在静止的位置上，一定贴着
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < HALVINGS; i++) {
      const mid = (lo + hi) / 2;
      set(mid);
      if (near()) lo = mid;
      else hi = mid;
    }
    set(lo);
    changed = true;
  }
  return changed ? posingOf(solver, state, posing) : posing;
}
