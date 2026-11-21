/**
 * 道具跟着手（见 docs/grab-plan.md 第 4 期）：连接上带着 carry 的，道具的位置照那只手、那只脚现算。纯函数。
 *
 * 清单里存的那一份（SceneProp.pos、rot）是「上一回落定时在哪」；手动了、角色挪了，这里算出它现在在哪。
 * 算出来和清单里差不到一点点的（取整的误差）还用清单里那一份：没带着道具时返回的就是清单本身。
 */
import { BODY_LINK, type PropLink, type Quat4, carriedProp, linkOf } from '../model/links';
import type { SceneProp } from '../model/props';
import type { Vec3 } from '../model/spec';

/** 一件带着的道具：哪个连接带着它，那只手（脚）现在在场景里的位置和朝向 */
export interface Carrier {
  link: PropLink;
  point: Vec3;
  rot: Quat4;
}

/** 位置差不到这么多（米）、角度差不到这么多（度）：算是没动（存下来的姿势、位置都取整过，来回算会差一点点） */
const SAME_POS = 1.5e-3;
const SAME_ROT = 0.15;

const turnOf = (a: number, b: number) => Math.abs(((((a - b + 180) % 360) + 360) % 360) - 180);
/** 两件道具摆的地方是不是一回事（差不到取整的误差） */
export const samePose = (a: Pick<SceneProp, 'pos' | 'rot'>, b: Pick<SceneProp, 'pos' | 'rot'>): boolean =>
  [0, 1, 2].every((i) => Math.abs(a.pos[i] - b.pos[i]) <= SAME_POS && turnOf(a.rot[i], b.rot[i]) <= SAME_ROT);

/** 算出来的两份是不是一个数（一模一样才算；差一毫米也是挪了） */
const sameSpot = (a: SceneProp, b: SceneProp) => a.id === b.id && [0, 1, 2].every((i) => a.pos[i] === b.pos[i] && a.rot[i] === b.rot[i]);

/**
 * 道具现在各在哪：带着的照手算，别的照清单。没有哪件挪了返回 props 本身；
 * last 是上一回照同一份清单算出来的，和它一模一样就还返回它（调用的人靠「是不是同一份」认变没变）
 */
export function placeCarried(props: readonly SceneProp[], carriers: readonly Carrier[], last?: readonly SceneProp[]): readonly SceneProp[] {
  if (!carriers.length) return props;
  let moved = false;
  const out = props.map((prop) => {
    const by = carriers.find((c) => c.link.prop === prop.id);
    if (!by) return prop;
    const now = carriedProp(prop, by.link, by.point, by.rot);
    if (samePose(now, prop)) return prop;
    moved = true;
    return now;
  });
  if (!moved) return props;
  if (last && last.length === out.length && out.every((p, i) => p === last[i] || (p !== props[i] && sameSpot(p, last[i])))) return last;
  return out;
}

interface Linked {
  id: string;
  links?: readonly PropLink[];
}

/** 带着这件道具的是谁的哪个连接；没人带着返回 null */
export function carrierIn(figures: readonly Linked[], prop: string): { figure: string; link: PropLink } | null {
  for (const f of figures) {
    const link = f.links?.find((l) => l.carry && l.prop === prop);
    if (link) return { figure: f.id, link };
  }
  return null;
}

/**
 * 这个角色带着这件道具会不会绕圈：人整个跟着一件道具（坐在上面），那件道具又跟着这个人的手——
 * 或者隔着别的角色绕回来（我坐的椅子被他拿着，他坐的箱子被我拿着）。绕圈的话道具和人会互相带着跑
 */
export function carryLoops(figures: readonly Linked[], figure: string, prop: string): boolean {
  const seen = new Set<string>();
  let id: string | undefined = figure;
  while (id && !seen.has(id)) {
    seen.add(id);
    const ride = linkOf(figures.find((f) => f.id === id)?.links, BODY_LINK);
    if (!ride) return false;
    if (ride.prop === prop) return true;
    id = carrierIn(figures, ride.prop)?.figure;
  }
  return false;
}
