/**
 * 钉住和跟随（见 docs/props-plan.md）：角色照它和道具的连接（model/links.ts）该站在哪、钉着的手脚该在哪。纯函数。
 *
 * - 整个人跟着一件道具的：角色的摆放照道具算（位置、朝向、离地多高），姿势不动。
 * - 手脚钉在道具上的：只有那一条手臂、那一条腿重新摆，末端去钉着的点；够不着就朝它伸直，身体不跟过去。
 */
import type { V3 } from '../geometry/vec';
import { BODY_LINK, type PropLink, linkOf, linkPoint, liveLinks, makeLink, ridePlace } from '../model/links';
import { type SceneProp, propOf } from '../model/props';
import { type Place, clampPlace, placeY } from '../model/scene';
import type { Posing } from '../pose/posing';
import { type PoseState, forward } from '../pose/rig';
import { reachOnly } from '../pose/solve';
import { type Solver, posingOf, stateOf } from '../pose/solver';
import { fromScene } from './interact';
import { type PropSolid, closestOnSolid, propSolid, solidDistance } from './propTouch';

/** 把场景里的一点连到道具上：记下它相对道具表面的位置。yaw：整个人跟着时角色现在的朝向 */
export function linkTo(prop: SceneProp, part: string, point: V3, yaw?: number): PropLink {
  return makeLink(prop, part, point, closestOnSolid(propSolid(prop), point).point, yaw);
}

/** 整个人跟着这件道具：照角色现在站的地方记 */
export const rideLink = (prop: SceneProp, place: Place): PropLink => linkTo(prop, BODY_LINK, [place.x, placeY(place), place.z], place.yaw);

/** 角色照连接该站在哪：整个人跟着一件道具的照道具算；没有就是原来的 */
export function followPlace(place: Place, links: readonly PropLink[] | undefined, props: readonly SceneProp[]): Place {
  const ride = linkOf(liveLinks(links, props), BODY_LINK);
  const prop = ride && propOf(props, ride.prop);
  return prop ? clampPlace(ridePlace(prop, ride)) : place;
}

export interface HoldTarget {
  /** 哪条肢体（Limb.name） */
  part: string;
  /** 末端该在哪（角色自己的坐标） */
  target: V3;
}

/** 钉着的手脚各该在哪：角色站在 place 时，换到它自己的坐标里 */
export function holdTargets(place: Place, links: readonly PropLink[] | undefined, props: readonly SceneProp[]): HoldTarget[] {
  const out: HoldTarget[] = [];
  for (const link of liveLinks(links, props)) {
    if (link.part === BODY_LINK) continue;
    out.push({ part: link.part, target: fromScene(place, linkPoint(propOf(props, link.prop)!, link)) });
  }
  return out;
}

/** 差得比这个还少就不动（米）：存下来的数是取整过的，来回算会差一点点 */
const SETTLED = 5e-4;

/** 把钉着的手脚摆到各自该在的点上（只动那一条肢体）。都已经在了返回原来那份 */
export function holdState(solver: Solver, state: PoseState, targets: readonly HoldTarget[]): PoseState {
  let out = state;
  for (const { part, target } of targets) {
    const i = solver.limbs.findIndex((l) => l.name === part);
    if (i < 0) continue;
    const at = forward(solver.rig, out).pos[solver.limbs[i].end];
    if (Math.hypot(at[0] - target[0], at[1] - target[1], at[2] - target[2]) < SETTLED) continue;
    out = reachOnly(solver, out, i, target);
  }
  return out;
}

/** 同上，照存下来的姿势算；没动返回原来那份 */
export function holdPosing(solver: Solver, posing: Posing, targets: readonly HoldTarget[]): Posing {
  if (!targets.length) return posing;
  const start = stateOf(solver, posing);
  const next = holdState(solver, start, targets);
  return next === start ? posing : posingOf(solver, next, posing);
}

/** 离这一点最近的道具，和它的表面离这一点多远（米；在里面是负的）。solids 是场景坐标里的 */
export function nearestSolid(solids: readonly PropSolid[], point: V3): { id: string; dist: number } | null {
  let best: { id: string; dist: number } | null = null;
  for (const solid of solids) {
    const dist = solidDistance(solid, point);
    if (!best || dist < best.dist) best = { id: solid.id, dist };
  }
  return best;
}

/**
 * 竖直往下找：从 (x, from, z) 往下，碰到的最高的道具表面有多高。下面没有道具返回 null（就是地面）。
 * solids 用哪个坐标都行，返回的高度也是那个坐标里的
 */
export function topUnder(solids: readonly PropSolid[], x: number, z: number, from: number): number | null {
  let best: number | null = null;
  for (const { points: p, indices, min, max } of solids) {
    if (x < min[0] || x > max[0] || z < min[2] || z > max[2] || min[1] > from) continue;
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3;
      const b = indices[t + 1] * 3;
      const c = indices[t + 2] * 3;
      // 从上往下看，(x, z) 在不在这个三角形里（重心坐标）
      const d = (p[b + 2] - p[c + 2]) * (p[a] - p[c]) + (p[c] - p[b]) * (p[a + 2] - p[c + 2]);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((p[b + 2] - p[c + 2]) * (x - p[c]) + (p[c] - p[b]) * (z - p[c + 2])) / d;
      const v = ((p[c + 2] - p[a + 2]) * (x - p[c]) + (p[a] - p[c]) * (z - p[c + 2])) / d;
      const w = 1 - u - v;
      if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
      const y = u * p[a + 1] + v * p[b + 1] + w * p[c + 1];
      if (y <= from && (best === null || y > best)) best = y;
    }
  }
  return best;
}
