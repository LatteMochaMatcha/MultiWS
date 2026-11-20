/**
 * 场景里的道具（见 docs/props-plan.md）：给姿势当依托的东西——杆、箱子、台子、球、墙板。
 *
 * 道具归整个场景，不跟着哪个角色：存的是场景里的位置（米）、旋转（度）、自己的尺寸（米）、颜色。
 * 原点在底面正中：位置的高度就是它离地多高，倾斜也是绕着底面正中转。
 * 这里只管数据：增删、复制、改、整理，都是不可变的值，每次修改返回新的。
 */
import { propAsset, realAsset } from '../props/catalog';
import type { Vec3 } from './spec';

/** 基本体的种类。形状只有三种（圆柱、方块、椭球），种类另外决定默认尺寸，以后还决定「能握」「能坐」「能靠」 */
export const PROP_KINDS = ['pole', 'box', 'stand', 'ball', 'wall'] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export interface SceneProp {
  /** 场景里唯一的编号（p1、p2……），删了不复用 */
  id: string;
  /** 用户起的名字；空着就照种类和排第几显示 */
  name: string;
  /** 基本体的种类；'asset' 是现成的素材（椅子、床……），是哪一件看 asset */
  kind: PropKind | 'asset';
  /** 素材的编号（props/catalog.ts 的清单里的）；基本体没有这一项 */
  asset?: string;
  /** 宽（左右）、高、深（前后），米。杆、台子、球是圆的：宽和深是两个方向的直径；素材是它占的盒子，网格照着拉伸 */
  size: Vec3;
  /** 底面正中在场景里的位置（米）：左右、离地多高、前后 */
  pos: Vec3;
  /** 旋转（度）：先绕竖直轴转朝向（第 2 个数），再前后倾（第 1 个）、左右倾（第 3 个） */
  rot: Vec3;
  /** 颜色，#rrggbb。写实款带着自己的贴图，刷成灰色（gray）以后才用这个颜色 */
  color: string;
  /** 写实款才有：刷成灰色——不用它自己的贴图，和别的道具一样一个颜色 */
  gray?: true;
}

/** 白模的灰色（和 view/materials.ts 的 Clay 一样） */
export const PROP_COLOR = '#e7eaeb';

/** 新放的基本体多大（米） */
export const PROP_SIZE: Record<PropKind, Vec3> = {
  pole: [0.05, 2.4, 0.05],
  box: [0.45, 0.45, 0.45],
  stand: [0.4, 0.45, 0.4],
  ball: [0.5, 0.5, 0.5],
  wall: [2, 2.4, 0.1],
};

/** 能设的范围：位置和角色一样 ±20 米，高度 -5–10 米；尺寸 1 厘米–10 米；旋转 -180°–180° */
export const PROP_LIMITS = {
  pos: [
    [-20, 20],
    [-5, 10],
    [-20, 20],
  ],
  size: [0.01, 10],
} as const;
/** 名字最长多少个字 */
export const PROP_NAME_MAX = 40;

const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number, k: number) => Math.round(v * k) / k;
const triple = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** 角度绕成 -180°–180°（180 和 -180 是同一个方向，记成 180），留到 0.1° */
function wrapDeg(deg: number): number {
  const w = ((((deg + 180) % 360) + 360) % 360) - 180;
  return round(w === -180 ? 180 : w, 10) + 0;
}

export const cleanPropName = (name: unknown): string =>
  typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, PROP_NAME_MAX) : '';

const cleanColor = (color: unknown): string => (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : PROP_COLOR);

export const isPropKind = (v: unknown): v is PropKind => (PROP_KINDS as readonly unknown[]).includes(v);

/** 这种道具原样多大：基本体是默认尺寸，素材是它本来的大小（清单里没有的素材当成半米见方） */
export const propBaseSize = (p: Pick<SceneProp, 'kind' | 'asset'>): Vec3 =>
  p.kind === 'asset' ? (propAsset(p.asset)?.size ?? [0.5, 0.5, 0.5]) : PROP_SIZE[p.kind];

/** 位置、旋转、尺寸收进范围；位置和尺寸留到毫米 */
export function clampProp(p: Omit<SceneProp, 'id'> & { id: string }): SceneProp {
  const size = triple(p.size);
  const pos = triple(p.pos);
  const rot = triple(p.rot);
  const base = propBaseSize(p);
  const [lo, hi] = PROP_LIMITS.size;
  return {
    id: p.id,
    name: cleanPropName(p.name),
    kind: p.kind,
    ...(p.kind === 'asset' ? { asset: p.asset } : {}),
    size: [0, 1, 2].map((i) => round(clamp(finite(size[i], base[i]), lo, hi), 1000)) as Vec3,
    pos: [0, 1, 2].map((i) => round(clamp(finite(pos[i], 0), PROP_LIMITS.pos[i][0], PROP_LIMITS.pos[i][1]), 1000) + 0) as Vec3,
    rot: [0, 1, 2].map((i) => wrapDeg(finite(rot[i], 0))) as Vec3,
    color: cleanColor(p.color),
    ...(p.kind === 'asset' && p.gray === true && realAsset(p.asset) ? { gray: true as const } : {}),
  };
}

/** 下一个没用过的编号 */
export function nextPropId(props: readonly SceneProp[]): string {
  let n = 0;
  for (const p of props) {
    const m = /^p(\d+)$/.exec(p.id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `p${n + 1}`;
}

export const propOf = (props: readonly SceneProp[], id: string | null): SceneProp | undefined => (id ? props.find((p) => p.id === id) : undefined);

/** 新做一个基本体（还没放进清单）：默认尺寸、白模的灰色，底面正中在 at，朝向 yaw */
export function makeProp(props: readonly SceneProp[], kind: PropKind, at: { x: number; z: number; yaw: number }): SceneProp {
  return clampProp({ id: nextPropId(props), name: '', kind, size: PROP_SIZE[kind], pos: [at.x, 0, at.z], rot: [0, at.yaw, 0], color: PROP_COLOR });
}

/** 新做一件素材道具（还没放进清单）：原样的大小、白模的灰色。清单里没有这个编号时返回 null */
export function makeAssetProp(props: readonly SceneProp[], asset: string, at: { x: number; z: number; yaw: number }): SceneProp | null {
  const entry = propAsset(asset);
  if (!entry) return null;
  return clampProp({ id: nextPropId(props), name: '', kind: 'asset', asset, size: entry.size, pos: [at.x, 0, at.z], rot: [0, at.yaw, 0], color: PROP_COLOR });
}

/** 加一个（排在最后） */
export const addProp = (props: readonly SceneProp[], prop: SceneProp): readonly SceneProp[] => [...props, clampProp(prop)];

/** 改一个道具的几项（编号、种类不能改） */
export function updateProp(props: readonly SceneProp[], id: string, patch: Partial<Omit<SceneProp, 'id' | 'kind' | 'asset'>>): readonly SceneProp[] {
  if (!propOf(props, id)) return props;
  return props.map((p) => (p.id === id ? clampProp({ ...p, ...patch }) : p));
}

export const removeProp = (props: readonly SceneProp[], id: string): readonly SceneProp[] =>
  propOf(props, id) ? props.filter((p) => p.id !== id) : props;

/** 复制一个，挪开 offset（场景里的左右、前后，米）。返回新的清单和复制出来那个的编号 */
export function copyProp(props: readonly SceneProp[], id: string, offset: { x: number; z: number }): { props: readonly SceneProp[]; id: string | null } {
  const from = propOf(props, id);
  if (!from) return { props, id: null };
  const copy = clampProp({ ...from, id: nextPropId(props), pos: [from.pos[0] + offset.x, from.pos[1], from.pos[2] + offset.z] });
  return { props: [...props, copy], id: copy.id };
}

/** 两份清单是不是一回事（撤销历史用） */
export const sameProps = (a: readonly SceneProp[], b: readonly SceneProp[]): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/* ---------------- 存档 ---------------- */

/** 读存档里的道具清单：不是数组、哪一件认不出种类（或者是清单里没有的素材）的就丢掉，编号重复、不像编号的重新编 */
export function normalizeProps(raw: unknown): SceneProp[] {
  if (!Array.isArray(raw)) return [];
  const out: SceneProp[] = [];
  const used = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const p = item as Record<string, unknown>;
    const asset = p.kind === 'asset' ? propAsset(p.asset)?.id : undefined;
    if (!isPropKind(p.kind) && !asset) continue;
    const kind = asset ? 'asset' : (p.kind as PropKind);
    let id = typeof p.id === 'string' && /^p\d+$/.test(p.id) && !used.has(p.id) ? p.id : '';
    if (!id) {
      let n = 0;
      do id = `p${++n}`;
      while (used.has(id) || raw.some((r) => (r as { id?: unknown } | null)?.id === id));
    }
    used.add(id);
    out.push(clampProp({ id, name: p.name as string, kind, asset, size: p.size as Vec3, pos: p.pos as Vec3, rot: p.rot as Vec3, color: p.color as string, ...(p.gray === true ? { gray: true as const } : {}) }));
  }
  return out;
}

/* ---------------- 摆放的换算 ---------------- */

const RAD = Math.PI / 180;

/**
 * 旋转矩阵（按行写的 9 个数）。顺序和 three.js 的 Euler 'YXZ' 一样：
 * 先绕自己的 Z 左右倾、再绕 X 前后倾、最后绕竖直轴转朝向
 */
export function propRotation(rot: Vec3): number[] {
  const a = Math.cos(rot[0] * RAD);
  const b = Math.sin(rot[0] * RAD);
  const c = Math.cos(rot[1] * RAD);
  const d = Math.sin(rot[1] * RAD);
  const e = Math.cos(rot[2] * RAD);
  const f = Math.sin(rot[2] * RAD);
  return [c * e + d * f * b, d * e * b - c * f, a * d, a * f, a * e, -b, c * f * b - d * e, d * f + c * e * b, a * c];
}

/** 同一个旋转写成四元数 [x, y, z, w]（导出 GLB 时节点的朝向用） */
export function propQuat(rot: Vec3): [number, number, number, number] {
  const c1 = Math.cos((rot[0] * RAD) / 2);
  const c2 = Math.cos((rot[1] * RAD) / 2);
  const c3 = Math.cos((rot[2] * RAD) / 2);
  const s1 = Math.sin((rot[0] * RAD) / 2);
  const s2 = Math.sin((rot[1] * RAD) / 2);
  const s3 = Math.sin((rot[2] * RAD) / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
}

/** 道具自己坐标里的一点（原点在底面正中）在场景里的哪里 */
export function propPoint(prop: SceneProp, local: Vec3, m: number[] = propRotation(prop.rot)): Vec3 {
  const [x, y, z] = local;
  return [prop.pos[0] + m[0] * x + m[1] * y + m[2] * z, prop.pos[1] + m[3] * x + m[4] * y + m[5] * z, prop.pos[2] + m[6] * x + m[7] * y + m[8] * z];
}

/** 杆横过来以后抬到多高（米）：一般身高的角色吊在上面脚离地二三十厘米 */
export const POLE_HANG_HEIGHT = 2.1;

/** 杆是不是横着的（和水平面夹不到 15°） */
export function poleIsFlat(prop: Pick<SceneProp, 'rot'>): boolean {
  const up = propRotation(prop.rot)[4];
  return Math.abs(up) < Math.sin((15 * Math.PI) / 180);
}

/**
 * 杆横过来（吊在上面用）：左右倾 90°，中点留在原来的地方、抬到 POLE_HANG_HEIGHT；
 * 已经横着的再来一次是竖回去：立在中点下面的地面上
 */
export function turnPole(prop: SceneProp): Pick<SceneProp, 'rot' | 'pos'> {
  const centre = propPoint(prop, [0, prop.size[1] / 2, 0]);
  if (poleIsFlat(prop)) return { rot: [0, prop.rot[1], 0], pos: [centre[0], 0, centre[2]] };
  const rot: Vec3 = [0, prop.rot[1], 90];
  const half = propPoint({ ...prop, rot, pos: [0, 0, 0] }, [0, prop.size[1] / 2, 0]);
  return { rot, pos: [centre[0] - half[0], POLE_HANG_HEIGHT - half[1], centre[2] - half[2]] };
}
