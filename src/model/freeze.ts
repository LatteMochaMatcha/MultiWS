/**
 * 整个角色冻结（存在角色自己的设定里：spec.wholeFreeze）：什么都不能改，只能看、导出、转视角。
 * 顶栏的雪花和场景清单里每一行的雪花是同一个开关；冻结的角色也切得过去，只是改不了。站的地方也挪不了。
 *
 * 界面上能改这个角色的都点不了（main.ts 的 blockWhileFrozen），圆点一个不给（求解器的 lockAll）。
 * 万一有漏掉的路子改了设定，每次改设定都过一遍 holdFrozen，照冻结时的那一份换回去。
 */
import type { BodySpec } from './spec';

/** 冻结那一刻的整份设定（它自己不带 wholeFreeze） */
export interface WholeFreeze {
  spec: BodySpec;
}

/** 冻结了的话：设定换回冻结时的那一份。每一项还是同一个对象（没改）就原样返回 */
export function holdFrozen(spec: BodySpec): BodySpec {
  const f = spec.wholeFreeze;
  if (!f) return spec;
  const held = f.spec as unknown as Record<string, unknown>;
  const now = spec as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(held), ...Object.keys(now)]);
  keys.delete('wholeFreeze');
  for (const k of keys) if (held[k] !== now[k]) return { ...f.spec, wholeFreeze: f };
  return spec;
}

/** 冻结开关：冻结时记下现在的整份设定 */
export function setWholeFreeze(spec: BodySpec, on: boolean): BodySpec {
  const { wholeFreeze: _f, ...rest } = spec;
  return on ? { ...rest, wholeFreeze: { spec: rest } } : rest;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 读存档：冻结时的那份设定也照读设定的办法整理（normalize 是 spec.ts 的 normalizeSpec）。
 * 11-28 那一版里顶栏的「整个角色」冻结也是这么记的，原样读
 */
export function cleanWholeFreeze(raw: unknown, normalize: (raw: unknown) => BodySpec): WholeFreeze | undefined {
  if (!isRecord(raw) || !isRecord(raw.spec)) return undefined;
  const { wholeFreeze: _w, ...spec } = normalize({ ...raw.spec, wholeFreeze: undefined });
  return { spec };
}
