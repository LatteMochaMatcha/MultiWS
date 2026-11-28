/**
 * 躯干锁定、冻结（每个角色各记各的，存在设定里）。
 *
 * 锁定：摆姿势时胯、腰、胸不跟着动——拖手脚够不着时脊柱不帮着够、胯不跟过去，腰、胸、胯的圆点也不给
 *       （求解器那边见 pose/solve.ts 的 lockTorso）。造型照样能改，现成姿势照样能套。
 * 冻结：在锁定之外，躯干定成冻结那一刻的样子——躯干的姿势（胯、脊柱、胸的朝向，整个人的位置）、
 *       躯干的体型（肩宽、胸部大小、腰宽、胯宽、躯干长短）、上半身和胸的数量、每排几个胸。
 *       套现成姿势、还原姿势、初始化、读进别的设定，这几样都照冻结时的写回去（见 holdTorso，每次改设定都过一遍）。
 * 这里只管数据：记下冻结时的样子、把它写回去、读存档时整理。
 */
import type { Quat, V3 } from '../geometry/vec';
import { regionOf } from '../pose/blend';
import { POSING_VERSION, type Posing } from '../pose/posing';
import type { BodySpec, ShapeKey, TorsoCounts } from './spec';

/** 冻结时照着定住的体型滑块 */
export const TORSO_SHAPE_KEYS = ['shoulders', 'bust', 'waist', 'hips', 'torso'] as const satisfies readonly ShapeKey[];
/** 冻结时照着定住的数量 */
export const TORSO_COUNT_KEYS = ['torsos', 'breasts'] as const;

export interface TorsoFreeze {
  /** 躯干骨骼（胯、脊柱、胸）在世界里一共转了多少，和第 3 版姿势数据一个意思；没写的是没转 */
  bones: Record<string, Quat>;
  /** 整个人（胯）挪了多少，和姿势数据的 root 一个意思；没挪就不写 */
  root?: V3;
  shape: Record<(typeof TORSO_SHAPE_KEYS)[number], number>;
  counts: Record<(typeof TORSO_COUNT_KEYS)[number], number>;
  chestRow: number;
  /** 好几个上半身时每个上半身各几个胸（没单独设的不写） */
  torsoBreasts: Partial<Record<string, number>>;
}

/** 这根骨骼是不是躯干上的（胯、脊柱、胸，好几个上半身的也算） */
export const isTorsoBone = (name: string): boolean => regionOf(name) === 'torso';

/** 摆姿势时躯干动不动得了（锁定、冻结的都不动） */
export const torsoLocked = (spec: Pick<BodySpec, 'torsoLock' | 'torsoFreeze'>): boolean => Boolean(spec.torsoLock || spec.torsoFreeze);

/** 记下现在躯干的样子。posing 要是第 3 版的（旧版本的姿势先换算过来再给） */
export function captureTorso(spec: BodySpec, posing: Posing = spec.posing): TorsoFreeze {
  const bones: Record<string, Quat> = {};
  if (posing.version === POSING_VERSION) for (const [name, q] of Object.entries(posing.bones)) if (isTorsoBone(name)) bones[name] = q;
  const torsoBreasts: Partial<Record<string, number>> = {};
  for (const [side, counts] of Object.entries(spec.torsoCounts ?? {})) if (counts?.breasts !== undefined) torsoBreasts[side] = counts.breasts;
  return {
    bones,
    ...(posing.root ? { root: [...posing.root] as V3 } : {}),
    shape: Object.fromEntries(TORSO_SHAPE_KEYS.map((k) => [k, spec.shape[k]])) as TorsoFreeze['shape'],
    counts: Object.fromEntries(TORSO_COUNT_KEYS.map((k) => [k, spec.counts[k]])) as TorsoFreeze['counts'],
    chestRow: spec.chestRow,
    torsoBreasts,
  };
}

const sameQuat = (a: Quat | undefined, b: Quat | undefined) => a === b || (!!a && !!b && a.every((v, i) => v === b[i]));
const sameV3 = (a: V3 | undefined, b: V3 | undefined) => a === b || (!!a && !!b && a.every((v, i) => v === b[i]));

/** 姿势里躯干那几根骨骼、整个人的位置换回冻结时的；别的骨骼不动。旧版本的姿势不碰（下次存姿势时换成第 3 版就对上了） */
function holdPose(posing: Posing, f: TorsoFreeze): Posing {
  if (posing.version !== POSING_VERSION) return posing;
  let bones: Record<string, Quat> | null = null;
  const own = () => (bones ??= { ...posing.bones });
  // 姿势里有、冻结时没写的躯干骨骼：冻结时是没转的。躯干骨骼的上级都是躯干骨骼，没写和写「没转」是一回事，直接去掉
  for (const name of Object.keys(posing.bones)) if (isTorsoBone(name) && !f.bones[name]) delete own()[name];
  for (const [name, q] of Object.entries(f.bones)) if (!sameQuat(posing.bones[name], q)) own()[name] = q;
  const rootSame = sameV3(posing.root, f.root);
  if (!bones && rootSame) return posing;
  const { root: _root, ...rest } = posing;
  return { ...rest, bones: bones ?? posing.bones, ...(f.root ? { root: f.root } : {}) };
}

/** 每个上半身各几个胸换回冻结时的（头、手臂这些照现在的） */
function holdTorsoCounts(counts: TorsoCounts | undefined, f: TorsoFreeze): TorsoCounts | undefined {
  const sides = new Set([...Object.keys(counts ?? {}), ...Object.keys(f.torsoBreasts)]) as Set<keyof TorsoCounts>;
  let out: TorsoCounts | null = null;
  for (const side of sides) {
    const now = counts?.[side]?.breasts;
    const want = f.torsoBreasts[side];
    if (now === want) continue;
    out ??= { ...counts };
    const { breasts: _b, ...others } = counts?.[side] ?? {};
    out[side] = want === undefined ? others : { ...others, breasts: want };
  }
  return out ?? counts;
}

/**
 * 冻结了的话：躯干的姿势、体型、数量换回冻结时的。没冻结、本来就一样的原样返回（同一个对象）。
 * 每次改设定（滑块、套姿势、初始化、撤销、读档）都过这一遍
 */
export function holdTorso(spec: BodySpec): BodySpec {
  const f = spec.torsoFreeze;
  if (!f) return spec;
  const posing = holdPose(spec.posing, f);
  const shapeSame = TORSO_SHAPE_KEYS.every((k) => spec.shape[k] === f.shape[k]);
  const countsSame = TORSO_COUNT_KEYS.every((k) => spec.counts[k] === f.counts[k]);
  const torsoCounts = holdTorsoCounts(spec.torsoCounts, f);
  if (posing === spec.posing && shapeSame && countsSame && spec.chestRow === f.chestRow && torsoCounts === spec.torsoCounts) return spec;
  return {
    ...spec,
    posing,
    shape: shapeSame ? spec.shape : { ...spec.shape, ...f.shape },
    counts: countsSame ? spec.counts : { ...spec.counts, ...f.counts },
    chestRow: f.chestRow,
    ...(torsoCounts ? { torsoCounts } : {}),
  };
}

/** 锁定、冻结开关。冻结时记下 posing（第 3 版）那一刻躯干的样子；解冻后还是锁定着的（要放开再关锁定） */
export function setTorsoHold(spec: BodySpec, flag: 'lock' | 'freeze', on: boolean, posing: Posing = spec.posing): BodySpec {
  const { torsoLock: _l, torsoFreeze: _f, ...rest } = spec;
  if (flag === 'lock') return on ? { ...rest, torsoLock: true, ...(spec.torsoFreeze ? { torsoFreeze: spec.torsoFreeze } : {}) } : spec.torsoFreeze ? { ...rest, torsoFreeze: spec.torsoFreeze } : rest;
  if (!on) return spec.torsoLock ? { ...rest, torsoLock: true } : rest;
  return { ...rest, ...(spec.torsoLock ? { torsoLock: true as const } : {}), torsoFreeze: captureTorso(spec, posing) };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numbers = (v: unknown, n: number): number[] | null => (Array.isArray(v) && v.length === n && v.every(finite) ? (v as number[]) : null);

/** 读存档：认不出来的是没冻结。体型、数量缺的照 fallback（就是读出来的那份设定现在的值） */
export function cleanTorsoFreeze(raw: unknown, fallback: Pick<BodySpec, 'shape' | 'counts' | 'chestRow'>): TorsoFreeze | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const bones: Record<string, Quat> = {};
  if (typeof src.bones === 'object' && src.bones !== null) {
    for (const [name, q] of Object.entries(src.bones)) {
      const v = numbers(q, 4);
      if (v && isTorsoBone(name)) bones[name] = v as Quat;
    }
  }
  const root = numbers(src.root, 3) as V3 | null;
  const pickNum = (from: unknown, key: string, def: number) => {
    const v = typeof from === 'object' && from !== null ? (from as Record<string, unknown>)[key] : undefined;
    return finite(v) ? v : def;
  };
  const torsoBreasts: Partial<Record<string, number>> = {};
  if (typeof src.torsoBreasts === 'object' && src.torsoBreasts !== null) {
    for (const [side, n] of Object.entries(src.torsoBreasts)) if (finite(n) && ['R', 'M', 'L'].includes(side)) torsoBreasts[side] = n;
  }
  return {
    bones,
    ...(root ? { root } : {}),
    shape: Object.fromEntries(TORSO_SHAPE_KEYS.map((k) => [k, pickNum(src.shape, k, fallback.shape[k])])) as TorsoFreeze['shape'],
    counts: Object.fromEntries(TORSO_COUNT_KEYS.map((k) => [k, Math.round(pickNum(src.counts, k, fallback.counts[k]))])) as TorsoFreeze['counts'],
    chestRow: Math.round(pickNum(src, 'chestRow', fallback.chestRow)),
    torsoBreasts,
  };
}
