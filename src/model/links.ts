/**
 * 角色和道具之间的连接（见 docs/props-plan.md 的「钉住和跟随」）。
 *
 * 两种：整个人跟着一件道具（坐、躺、站在上面的：挪道具时人跟着走），手脚钉在一件道具上（握、扶、撑、踩的：只有那只手、那只脚跟着）。
 * 连接记在角色身上（SceneFigure.links），跟着角色的撤销走；每个角色整个人最多跟一件，每只手脚最多钉一件。
 *
 * 钉在哪记的是相对道具的位置，分两截：道具表面上离得最近的那一点（写成占宽、高、深的几成），和从那一点到钉着的点还差多少（米）。
 * 这样道具改了尺寸，钉在桌面上的手跟着桌面走，离桌面还是那么远。
 * 这里只管数据和换算，都是不可变的值。
 */
import { type SceneProp, propOf, propPoint, propRotation } from './props';
import type { Place } from './scene';
import type { Vec3 } from './spec';

/** 整个人跟着的那一种，part 写这个；手脚的写那条肢体的名字（末端那根骨骼，pose/limbs.ts 的 Limb.name） */
export const BODY_LINK = 'body';

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
 * 几成留到十万分之一、差多少留到 0.1 毫米
 */
export function makeLink(prop: SceneProp, part: string, point: Vec3, surface: Vec3, yaw?: number): PropLink {
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
  return link;
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

/** 读存档里的连接：道具不在清单里的、缺东西的丢掉；同一个部位只留第一个 */
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
    out.push(link);
  }
  return out;
}
