/**
 * 一个场景里的好几个角色（见 docs/scene-plan.md）。
 *
 * 每个角色是一份完整的设定（BodySpec，连姿势、微调、头发都在里面）加描述文字、名字，和它在地上站在哪、朝哪。
 * 同一时间只改一个（当前角色）：界面、撤销、摆姿势照旧只对着它；别的角色在屏幕上是定住的网格。
 * 这里只管数据：增删、复制、改名、切换、摆放，存档和读档。都是不可变的值，每次修改返回新的。
 */
import { type PropLink, normalizeLinks, usableLink, withCarry } from './links';
import { type SceneProp, normalizeProps } from './props';
import { setWholeFreeze } from './freeze';
import type { BodySpec } from './spec';

/** 在地上站在哪（米）、朝哪（度，从上往下看逆时针为正；0 是脸朝 +Z，也就是正面视图里朝着镜头） */
export interface Place {
  x: number;
  z: number;
  yaw: number;
  /** 脚下离地多高（米）：站在台子上、跟着道具被抬起来。在地上的不写这一项（和加高度以前的存档一模一样） */
  y?: number;
}

/** 脚下离地多高（没写就是在地上） */
export const placeY = (p: Place): number => p.y ?? 0;
/** 带上离地高度：0 就不写这一项 */
const withY = (p: { x: number; z: number; yaw: number }, y: number): Place => (y ? { ...p, y } : p);

export interface SceneFigure {
  /** 场景里唯一的编号（f1、f2……），删了不复用 */
  id: string;
  /** 用户起的名字；空着就照排第几显示「角色 n」 */
  name: string;
  spec: BodySpec;
  text: string;
  place: Place;
  /** 和道具的连接（整个人跟着哪件、哪只手脚钉在哪件上，见 model/links.ts）；没有就不写 */
  links?: readonly PropLink[];
  /** 锁定：站在哪、朝哪不能改（拖不动底座圈，道具挪了也不跟着走）；造型、姿势照样能改。没锁就不写 */
  locked?: true;
  // 冻结（什么都不能改）记在角色自己的设定里：spec.wholeFreeze（见 model/freeze.ts），只有一个角色时也一样
}

/** 这个角色冻结着没有 */
export const isFrozen = (f: Pick<SceneFigure, 'spec'>): boolean => Boolean(f.spec.wholeFreeze);

/** 这个角色站的地方能不能挪（锁定、冻结的都不能） */
export const canMoveFigure = (f: Pick<SceneFigure, 'locked' | 'spec'>): boolean => !f.locked && !isFrozen(f);

/** 站的地方锁定开关 */
export function setFigureLock(scene: Scene, id: string, on: boolean): Scene {
  const f = figureOf(scene, id);
  if (!f || Boolean(f.locked) === on) return scene;
  const figures = scene.figures.map((o) => {
    if (o.id !== id) return o;
    const { locked: _, ...rest } = o;
    return on ? { ...rest, locked: true as const } : rest;
  });
  return { ...scene, figures };
}

export interface Scene {
  figures: readonly SceneFigure[];
  /** 当前角色的 id */
  current: string;
  /** 场景里的道具（见 model/props.ts）：归整个场景，不跟着哪个角色 */
  props: readonly SceneProp[];
}

export const SCENE_APP = 'oc-basemesh-scene';
export const SCENE_VERSION = 1;

/** 摆放能设的范围：位置 ±20 米，朝向 -180°–180°，离地 -5–10 米（和道具一样） */
export const PLACE_LIMITS = { x: [-20, 20], z: [-20, 20], yaw: [-180, 180], y: [-5, 10] } as const;
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
  return withY(
    {
      x: round(clamp(finite(p?.x, 0), PLACE_LIMITS.x), 1000),
      z: round(clamp(finite(p?.z, 0), PLACE_LIMITS.z), 1000),
      yaw: round(wrapYaw(finite(p?.yaw, 0)), 10),
    },
    round(clamp(finite(p?.y, 0), PLACE_LIMITS.y), 1000) + 0,
  );
}

export const cleanName = (name: unknown): string => (typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '');

/** 只有一个角色的场景（打开旧版存档、第一次打开时） */
export function singleScene(spec: BodySpec, text: string): Scene {
  return { figures: [{ id: 'f1', name: '', spec, text, place: ORIGIN }], current: 'f1', props: [] };
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
    ...scene,
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
  return { ...scene, figures, current };
}

/** 把删掉的角色放回原来的位置（「恢复刚删的」） */
export function restoreFigure(scene: Scene, figure: SceneFigure, at: number): Scene {
  if (figureOf(scene, figure.id)) return scene;
  const figures = [...scene.figures];
  figures.splice(Math.max(0, Math.min(at, figures.length)), 0, figure);
  return { ...scene, figures, current: figure.id };
}

/** 换当前角色（不认得的 id 不换；冻结的也切得过去，只是改不了） */
export function setCurrent(scene: Scene, id: string): Scene {
  const f = figureOf(scene, id);
  return f && scene.current !== id ? { ...scene, current: id } : scene;
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
  return withY({ x: c * dx + s * dz, z: -s * dx + c * dz, yaw: wrapYaw(to.yaw - from.yaw) }, placeY(to) - placeY(from));
}

/** relativePlace 反过来：在 from 的坐标里位于 local 的点，在场景里站在哪 */
export function absolutePlace(from: Place, local: Place): Place {
  const a = from.yaw * RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return withY({ x: from.x + c * local.x + s * local.z, z: from.z - s * local.x + c * local.z, yaw: wrapYaw(from.yaw + local.yaw) }, placeY(from) + placeY(local));
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
    figures: scene.figures.map((f) => {
      // 道具已经不在了的连接不写（屏幕上留着它，是为了撤销把道具放回来时还连着）
      const links = (f.links ?? []).filter((l) => scene.props.some((p) => p.id === l.prop));
      return {
        id: f.id,
        name: f.name,
        place: f.place,
        spec: specData(f.spec, f.text),
        ...(links.length ? { links } : {}),
        ...(f.locked ? { locked: true } : {}),
      };
    }),
    // 没有道具就不写这一项：和加道具以前的文件一模一样
    ...(scene.props.length ? { props: scene.props } : {}),
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
  const props = normalizeProps((data as { props?: unknown }).props);
  const carried = new Set<string>();
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
    const read = readSpec(f.spec);
    // 以前的版本把冻结记在角色上（frozen: true）：换成记在它自己的设定里
    const spec = f.frozen === true && !read.spec.wholeFreeze ? setWholeFreeze(read.spec, true) : read.spec;
    const { text } = read;
    // 一件道具只能跟着一个角色的一个部位：前面的角色已经带着的，这里的只算抓着
    const links = normalizeLinks(f.links, props)
      .map((l) => {
        if (!l.carry) return l;
        if (carried.has(l.prop)) return withCarry(l, false);
        carried.add(l.prop);
        return l;
      })
      .filter(usableLink);
    figures.push({
      id,
      name: cleanName(f.name),
      spec,
      text,
      place: clampPlace(f.place as Partial<Place>),
      ...(links.length ? { links } : {}),
      ...(f.locked === true ? { locked: true as const } : {}),
    });
  }
  if (!figures.length) return null;
  const want = (data as { current?: unknown }).current;
  const current = typeof want === 'string' && used.has(want) ? want : figures[0].id;
  return { figures, current, props };
}
