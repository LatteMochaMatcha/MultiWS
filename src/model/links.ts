/**
 * 角色和道具之间的连接（见 docs/props-plan.md 的「钉住和跟随」）。
 *
 * 两种：整个人跟着一件道具（坐、躺、站在上面的：挪道具时人跟着走），手脚钉在一件道具上（握、扶、撑、踩的：只有那只手、那只脚跟着）。
 * 连接记在角色身上（SceneFigure.links），跟着角色的撤销走；每个角色整个人最多跟一件，每只手脚最多钉一件。
 *
 * 钉在哪记的是相对道具的位置，分两截：道具表面上离得最近的那一点（写成占宽、高、深的几成），和从那一点到钉着的点还差多少（米）。
 * 这样道具改了尺寸，钉在桌面上的手跟着桌面走，离桌面还是那么远。
 * 手、脚还记着相对道具怎么转的（见 docs/grab-plan.md）：道具转了、歪了，手掌、脚掌跟着转。
 * 手、脚的连接可以反过来（carry）：道具跟着这只手、这只脚走（拿着、带着）。记的还是同一份相对位置，所以来回切谁都不跳。
 * 这里只管数据和换算，都是不可变的值。
 */
import { type SceneProp, clampProp, propEuler, propOf, propPoint, propQuat, propRotation } from './props';
import type { Place } from './scene';
import type { Vec3 } from './spec';

/** 整个人跟着的那一种，part 写这个；手脚的写那条肢体的名字（末端那根骨骼，pose/limbs.ts 的 Limb.name） */
export const BODY_LINK = 'body';

/**
 * 是不是手、脚的连接（肢体的名字都是 Hand…、Foot… 开头）。
 * 还有一种既不是整个人、也不是手脚的：抱着——道具跟着胸口那根骨骼走（part 写那根骨骼的名字，见 docs/grab-plan.md 第 5 期）。
 * 它只有「带着」这一种，不带着了这个连接就没有了
 */
export const isLimbPart = (part: string): boolean => /^(Hand|Foot)/.test(part);

export interface PropLink {
  /** 连着哪件道具 */
  prop: string;
  /** 'body' 是整个人跟着；别的是哪条手臂、哪条腿 */
  part: string;
  /** 道具表面上离得最近的那一点：占宽、高、深的几成（道具自己的坐标，原点在底面正中，左右、前后是 -0.5–0.5，高是 0–1） */
  at: Vec3;
  /** 从那一点到钉着的点（手腕、脚踝；整个人跟着的是角色脚下那一点）还差多少：米，道具自己的坐标 */
  off: Vec3;
  /** 只有整个人跟着的有：角色的朝向比道具的朝向多转多少度 */
  yaw?: number;
  /**
   * 只有手、脚的有：末端那根骨骼（手、脚）相对道具怎么转的（四元数 [x, y, z, w]，道具自己的坐标里）。
   * 道具转了、歪了，手掌、脚掌跟着转。老的连接没有这一项：只跟位置，朝向不管
   */
  rot?: Quat4;
  /**
   * 只有带手指的手有：握紧度（0–1，留到百分之一）。有这一项，手指就照道具的形状自己握上
   * （1 是握到碰着，越小手指越直，见 scene/grip.ts）；没有这一项手指归用户自己摆
   */
  grip?: number;
  /**
   * 只有手、脚的有（而且要记着朝向）：道具跟着这只手、这只脚走（拿着、带着）。
   * 没有这一项是道具不动、手脚跟着道具（抓着公交车的拉杆）。一件道具只能跟着一个角色的一个部位
   */
  carry?: true;
}

export type Quat4 = [number, number, number, number];

const qMul = (a: Quat4, b: Quat4): Quat4 => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qConj = (q: Quat4): Quat4 => [-q[0], -q[1], -q[2], q[3]];
/** 化成单位长、w 不是负的（同一个旋转只有一种写法），留到十万分之一；不像样的返回 null */
function tidyQuat(q: readonly unknown[]): Quat4 | null {
  const v = [0, 1, 2, 3].map((i) => (typeof q[i] === 'number' && Number.isFinite(q[i]) ? (q[i] as number) : Number.NaN));
  const l = Math.hypot(v[0], v[1], v[2], v[3]);
  if (!(l > 1e-6)) return null;
  const s = (v[3] < 0 ? -1 : 1) / l;
  return v.map((x) => round(x * s, 1e5)) as Quat4;
}

const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const round = (v: number, k: number) => Math.round(v * k) / k + 0;
const wrap = (deg: number) => {
  const w = ((((deg + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
};

/** 场景里的一点在道具自己的坐标里是哪（propPoint 反过来） */
export function propLocal(prop: SceneProp, point: Vec3, m: number[] = propRotation(prop.rot)): Vec3 {
  const x = point[0] - prop.pos[0];
  const y = point[1] - prop.pos[1];
  const z = point[2] - prop.pos[2];
  // 旋转矩阵反过来就是转置
  return [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z];
}

/**
 * 记下一个连接：point 是要钉住的那一点、surface 是道具表面上离它最近的那一点（都是场景里的位置）。
 * 几成留到十万分之一、差多少留到 0.1 毫米。
 * rot：手、脚现在在场景里的朝向（给了就记下它相对道具怎么转的）
 */
export function makeLink(prop: SceneProp, part: string, point: Vec3, surface: Vec3, yaw?: number, rot?: Quat4): PropLink {
  const m = propRotation(prop.rot);
  const s = propLocal(prop, surface, m);
  const p = propLocal(prop, point, m);
  const link: PropLink = {
    prop: prop.id,
    part,
    at: [0, 1, 2].map((i) => round(s[i] / prop.size[i], 1e5)) as Vec3,
    off: [0, 1, 2].map((i) => round(p[i] - s[i], 1e4)) as Vec3,
  };
  if (part === BODY_LINK) link.yaw = round(wrap((yaw ?? 0) - prop.rot[1]), 10);
  else if (rot) return turnLink(prop, link, rot);
  return link;
}

/** 同一个连接，朝向换成 rot（手、脚现在在场景里的朝向）。抓在哪不变；整个人跟着的不记朝向，原样返回 */
export function turnLink(prop: SceneProp, link: PropLink, rot: Quat4): PropLink {
  const rel = link.part === BODY_LINK ? null : tidyQuat(qMul(qConj(propQuat(prop.rot)), rot));
  return rel ? { ...link, rot: rel } : link;
}

/** 同一个连接，握紧度换成 tight（0–1）；0 是不要手指自己握（去掉这一项）。整个人跟着的原样返回 */
export function withGrip(link: PropLink, tight: number): PropLink {
  if (link.part === BODY_LINK) return link;
  const { grip: _old, ...rest } = link;
  const t = round(Math.max(0, Math.min(1, Number.isFinite(tight) ? tight : 0)), 100);
  return t > 0 ? { ...rest, grip: t } : rest;
}

/** 同一个连接，换成道具跟着这只手脚（on）、或者道具不动（off）。整个人跟着的、没记朝向的不能带着道具，原样返回 */
export function withCarry(link: PropLink, on: boolean): PropLink {
  const { carry: _old, ...rest } = link;
  return on && link.part !== BODY_LINK && link.rot ? { ...rest, carry: true } : rest;
}

/** 这件道具不再跟着这几个连接里的谁：手脚的改成抓着（还连着，跟着道具走），胸口的那种去掉 */
export const putDown = (links: readonly PropLink[] | undefined, prop: string): PropLink[] =>
  (links ?? []).flatMap((l) => (l.carry && l.prop === prop ? (isLimbPart(l.part) ? [withCarry(l, false)] : []) : [l]));

/**
 * 带着的道具现在该在哪：手（脚）在场景里的 point、朝向 rot 时，道具摆到哪、转成什么样，连接里记的相对位置才对得上。
 * 返回摆好的那一件（位置留到毫米、角度留到 0.1°，和清单里存的一样）；连接没记朝向的返回原来那件
 */
export function carriedProp(prop: SceneProp, link: PropLink, point: Vec3, rot: Quat4): SceneProp {
  if (!link.rot) return prop;
  // 先定朝向（取整以后的），再照它定位置：这样手抓着的那一点不会因为角度取整偏出去
  const turned = clampProp({ ...prop, rot: propEuler(qMul(rot, qConj(link.rot))) });
  const m = propRotation(turned.rot);
  const [x, y, z] = [0, 1, 2].map((i) => link.at[i] * prop.size[i] + link.off[i]);
  return clampProp({
    ...turned,
    pos: [point[0] - (m[0] * x + m[1] * y + m[2] * z), point[1] - (m[3] * x + m[4] * y + m[5] * z), point[2] - (m[6] * x + m[7] * y + m[8] * z)],
  });
}

/** 这个连接抓着的手、脚现在在场景里该朝哪（四元数）；没记朝向的返回 null */
export function linkRot(prop: SceneProp, link: PropLink): Quat4 | null {
  if (!link.rot) return null;
  const q = qMul(propQuat(prop.rot), link.rot);
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l > 1e-9 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : null;
}

/** 这个连接钉着的那一点现在在场景里的哪 */
export function linkPoint(prop: SceneProp, link: PropLink): Vec3 {
  return propPoint(prop, [0, 1, 2].map((i) => link.at[i] * prop.size[i] + link.off[i]) as Vec3);
}

/** 整个人跟着的：角色现在该站在哪（位置跟着那一点走，朝向跟着道具的朝向转；道具倾斜了人不跟着歪） */
export function ridePlace(prop: SceneProp, link: PropLink): Place {
  const p = linkPoint(prop, link);
  return { x: p[0], z: p[2], yaw: wrap(prop.rot[1] + (link.yaw ?? 0)), y: p[1] };
}

export const linkOf = (links: readonly PropLink[] | undefined, part: string): PropLink | undefined => links?.find((l) => l.part === part);

/** 加一个连接：同一个部位原来连着的换掉 */
export const setLink = (links: readonly PropLink[] | undefined, link: PropLink): readonly PropLink[] => [...(links ?? []).filter((l) => l.part !== link.part), link];

/** 解开一个部位的连接 */
export const dropLink = (links: readonly PropLink[] | undefined, part: string): readonly PropLink[] => (links ?? []).filter((l) => l.part !== part);

/** 解开连着某件道具的全部连接 */
export const dropLinksTo = (links: readonly PropLink[] | undefined, prop: string): readonly PropLink[] => (links ?? []).filter((l) => l.prop !== prop);

/** 两份连接是不是一回事（撤销历史用） */
export const sameLinks = (a: readonly PropLink[] | undefined, b: readonly PropLink[] | undefined): boolean =>
  a === b || JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** 现在用得上的那些：道具还在的（道具删了，连接先留着不用：撤销把道具放回来时还连着） */
export const liveLinks = (links: readonly PropLink[] | undefined, props: readonly SceneProp[]): PropLink[] => (links ?? []).filter((l) => propOf(props, l.prop));

/** 读存档里的连接：道具不在清单里的、缺东西的丢掉；同一个部位只留第一个；同一件道具只留第一个带着它的，整个人跟着的那件不能再带着 */
export function normalizeLinks(raw: unknown, props: readonly SceneProp[]): PropLink[] {
  if (!Array.isArray(raw)) return [];
  const out: PropLink[] = [];
  const used = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const l = item as Record<string, unknown>;
    if (typeof l.prop !== 'string' || !propOf(props, l.prop)) continue;
    if (typeof l.part !== 'string' || !l.part || l.part.length > 80 || used.has(l.part)) continue;
    if (!Array.isArray(l.at) || !Array.isArray(l.off)) continue;
    const at = l.at as unknown[];
    const off = l.off as unknown[];
    used.add(l.part);
    const link: PropLink = {
      prop: l.prop,
      part: l.part,
      at: [0, 1, 2].map((i) => round(Math.max(-50, Math.min(50, finite(at[i], 0))), 1e5)) as Vec3,
      off: [0, 1, 2].map((i) => round(Math.max(-30, Math.min(30, finite(off[i], 0))), 1e4)) as Vec3,
    };
    if (l.part === BODY_LINK) link.yaw = round(wrap(finite(l.yaw, 0)), 10);
    else if (Array.isArray(l.rot)) {
      const rot = tidyQuat(l.rot);
      if (rot) link.rot = rot;
    }
    out.push(l.part === BODY_LINK ? link : withCarry(withGrip(link, finite(l.grip, 0)), l.carry === true));
  }
  // 带着的：一件道具只认第一个；人整个跟着它的那件不能再跟着这个人的手（绕圈了）
  const ride = out.find((l) => l.part === BODY_LINK)?.prop;
  const taken = new Set<string>();
  return out
    .map((l) => {
      if (!l.carry) return l;
      if (l.prop === ride || taken.has(l.prop)) return withCarry(l, false);
      taken.add(l.prop);
      return l;
    })
    .filter(usableLink);
}

/** 用得上的连接：整个人跟着的、手脚的，和带着道具的胸口（胸口不带着道具的没有意义） */
export const usableLink = (l: PropLink): boolean => l.part === BODY_LINK || isLimbPart(l.part) || l.carry === true;
