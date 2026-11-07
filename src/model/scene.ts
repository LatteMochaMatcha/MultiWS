/**
 * 一个场景里的好几个角色（见 docs/scene-plan.md）。
 *
 * 每个角色是一份完整的设定（BodySpec，连姿势、微调、头发都在里面）加描述文字、名字，和它在地上站在哪、朝哪。
 * 同一时间只改一个（当前角色）：界面、撤销、摆姿势照旧只对着它；别的角色在屏幕上是定住的网格。
 * 这里只管数据：增删、复制、改名、切换、摆放，存档和读档。都是不可变的值，每次修改返回新的。
 */
import type { BodySpec } from './spec';

/** 在地上站在哪（米）、朝哪（度，从上往下看逆时针为正；0 是脸朝 +Z，也就是正面视图里朝着镜头） */
export interface Place {
  x: number;
  z: number;
  yaw: number;
}

export interface SceneFigure {
  /** 场景里唯一的编号（f1、f2……），删了不复用 */
  id: string;
  /** 用户起的名字；空着就照排第几显示「角色 n」 */
  name: string;
  spec: BodySpec;
  text: string;
  place: Place;
}

export interface Scene {
  figures: readonly SceneFigure[];
  /** 当前角色的 id */
  current: string;
}

export const SCENE_APP = 'oc-basemesh-scene';
export const SCENE_VERSION = 1;

/** 摆放能设的范围：位置 ±20 米，朝向 -180°–180° */
export const PLACE_LIMITS = { x: [-20, 20], z: [-20, 20], yaw: [-180, 180] } as const;
export const ORIGIN: Place = { x: 0, z: 0, yaw: 0 };
/** 名字最长多少个字 */
export const NAME_MAX = 40;

const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));

/** 朝向绕成 -180°–180°（180 和 -180 是同一个方向，记成 180） */
export function wrapYaw(yaw: number): number {
  const w = ((((yaw + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

/** 位置、朝向收进范围；位置留到毫米、朝向留到 0.1° */
export function clampPlace(p: Partial<Place> | null | undefined): Place {
  const round = (v: number, k: number) => Math.round(v * k) / k;
  return {
    x: round(clamp(finite(p?.x, 0), PLACE_LIMITS.x), 1000),
    z: round(clamp(finite(p?.z, 0), PLACE_LIMITS.z), 1000),
    yaw: round(wrapYaw(finite(p?.yaw, 0)), 10),
  };
}

export const cleanName = (name: unknown): string => (typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '');

/** 只有一个角色的场景（打开旧版存档、第一次打开时） */
export function singleScene(spec: BodySpec, text: string): Scene {
  return { figures: [{ id: 'f1', name: '', spec, text, place: ORIGIN }], current: 'f1' };
}

/** 下一个没用过的编号 */
export function nextId(scene: Scene): string {
  let n = 0;
  for (const f of scene.figures) {
    const m = /^f(\d+)$/.exec(f.id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `f${n + 1}`;
}

export const figureOf = (scene: Scene, id: string): SceneFigure | undefined => scene.figures.find((f) => f.id === id);
export const currentOf = (scene: Scene): SceneFigure => figureOf(scene, scene.current) ?? scene.figures[0];
export const indexOf = (scene: Scene, id: string): number => scene.figures.findIndex((f) => f.id === id);

/** 改一个角色的几项（id 不能改） */
export function updateFigure(scene: Scene, id: string, patch: Partial<Omit<SceneFigure, 'id'>>): Scene {
  if (!figureOf(scene, id)) return scene;
  const clean: Partial<SceneFigure> = { ...patch };
  if (patch.place) clean.place = clampPlace(patch.place);
  if (patch.name !== undefined) clean.name = cleanName(patch.name);
  return { ...scene, figures: scene.figures.map((f) => (f.id === id ? { ...f, ...clean } : f)) };
}

/** 加一个角色（排在最后），并把它设成当前的 */
export function addFigure(scene: Scene, figure: Omit<SceneFigure, 'id'>): Scene {
  const id = nextId(scene);
  return {
    figures: [...scene.figures, { ...figure, id, name: cleanName(figure.name), place: clampPlace(figure.place) }],
    current: id,
  };
}

/** 删掉一个角色。只剩一个时删不了。删的是当前的：换成它后面那个（没有就前面那个） */
export function removeFigure(scene: Scene, id: string): Scene {
  const i = indexOf(scene, id);
  if (i < 0 || scene.figures.length <= 1) return scene;
  const figures = scene.figures.filter((f) => f.id !== id);
  const current = scene.current === id ? figures[Math.min(i, figures.length - 1)].id : scene.current;
  return { figures, current };
}

/** 把删掉的角色放回原来的位置（「恢复刚删的」） */
export function restoreFigure(scene: Scene, figure: SceneFigure, at: number): Scene {
  if (figureOf(scene, figure.id)) return scene;
  const figures = [...scene.figures];
  figures.splice(Math.max(0, Math.min(at, figures.length)), 0, figure);
  return { figures, current: figure.id };
}

/** 换当前角色（不认得的 id 不换） */
export function setCurrent(scene: Scene, id: string): Scene {
  return figureOf(scene, id) && scene.current !== id ? { ...scene, current: id } : scene;
}

/** 往前、往后挪一格（角色条上的顺序） */
export function moveFigure(scene: Scene, id: string, step: -1 | 1): Scene {
  const i = indexOf(scene, id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= scene.figures.length) return scene;
  const figures = [...scene.figures];
  [figures[i], figures[j]] = [figures[j], figures[i]];
  return { ...scene, figures };
}

/* ---------------- 摆放的换算 ---------------- */

const RAD = Math.PI / 180;

/**
 * 「to 站在 from 看来的哪里」：把 to 的位置、朝向换到 from 自己的坐标里
 * （from 站在原点、脸朝 +Z 时 to 该摆在哪）。屏幕上当前角色永远站在原点，别人照这个摆。
 */
export function relativePlace(from: Place, to: Place): Place {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const a = -from.yaw * RAD;
  // 绕 Y 轴转 a（three.js 的 rotation.y：从上往下看逆时针）
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: c * dx + s * dz, z: -s * dx + c * dz, yaw: wrapYaw(to.yaw - from.yaw) };
}

/** relativePlace 反过来：在 from 的坐标里位于 local 的点，在场景里站在哪 */
export function absolutePlace(from: Place, local: Place): Place {
  const a = from.yaw * RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: from.x + c * local.x + s * local.z, z: from.z - s * local.x + c * local.z, yaw: wrapYaw(from.yaw + local.yaw) };
}

/** 一个角色占的地方：在场景里的位置，从上往下看的半宽（米） */
export interface Footprint {
  x: number;
  z: number;
  radius: number;
}

/**
 * 新角色站哪：在所有角色右边（+X）空出 gap 米站着，和最右边那个前后对齐。
 * 屏幕上正面看过去，新来的站在右手边
 */
export function besideAll(taken: readonly Footprint[], radius: number, gap = 0.3): Place {
  if (!taken.length) return ORIGIN;
  let right = taken[0];
  for (const f of taken) if (f.x + f.radius > right.x + right.radius) right = f;
  return clampPlace({ x: right.x + right.radius + gap + radius, z: right.z, yaw: 0 });
}

/* ---------------- 存档 ---------------- */

/**
 * 存成 JSON 的样子。设定照 specData 写（和「保存配置」一样的格式，成人部件没用就不写那几项），
 * 读的时候每份设定照 normalizeSpec 整理
 */
export function serializeScene(scene: Scene, specData: (spec: BodySpec, text: string) => object, pretty = false): string {
  const data = {
    app: SCENE_APP,
    version: SCENE_VERSION,
    current: scene.current,
    figures: scene.figures.map((f) => ({ id: f.id, name: f.name, place: f.place, spec: specData(f.spec, f.text) })),
  };
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

export const isSceneData = (data: unknown): boolean => typeof data === 'object' && data !== null && (data as { app?: unknown }).app === SCENE_APP;

/**
 * 读存档：认不出来返回 null。每份设定交给 readSpec 整理（坏了的整理成默认的），编号重复、不像编号的重新编。
 * readSpec 返回设定和描述文字
 */
export function normalizeScene(data: unknown, readSpec: (raw: unknown) => { spec: BodySpec; text: string }): Scene | null {
  if (!isSceneData(data)) return null;
  const raw = (data as { figures?: unknown }).figures;
  if (!Array.isArray(raw) || !raw.length) return null;
  const used = new Set<string>();
  const figures: SceneFigure[] = [];
  let n = 0;
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const f = item as Record<string, unknown>;
    let id = typeof f.id === 'string' && /^f\d+$/.test(f.id) && !used.has(f.id) ? f.id : '';
    if (!id) {
      do id = `f${++n}`;
      while (used.has(id) || raw.some((r) => (r as { id?: unknown })?.id === id));
    }
    used.add(id);
    const { spec, text } = readSpec(f.spec);
    figures.push({ id, name: cleanName(f.name), spec, text, place: clampPlace(f.place as Partial<Place>) });
  }
  if (!figures.length) return null;
  const want = (data as { current?: unknown }).current;
  const current = typeof want === 'string' && used.has(want) ? want : figures[0].id;
  return { figures, current };
}
