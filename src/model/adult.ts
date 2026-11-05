/**
 * 「显示成人部件」开关：这台设备、这个浏览器自己记着（localStorage），不进配置、不进撤销。
 * 默认关。关着的时候阴茎这几项不出现，文字里写了、载入的配置里有也不长（见 main.ts 的 commit）。
 * 工坊的仓库是公开的，exe、apk 也会发给别人，所以默认藏着。
 */
import { type BodySpec, type PartOverride, defaultSpec } from './spec';

const KEY = 'oc-basemesh-adult';
/** 这一次打开以后拨过的：本机存不了的时候（禁止网站存数据、无痕窗口）照它算，这一次照样管用 */
let chosen: boolean | undefined;

export function adultOn(): boolean {
  if (chosen !== undefined) return chosen;
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setAdult(on: boolean) {
  chosen = on;
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // 存不了：这一次照样管用（见 chosen），下次打开又是关着的
  }
}

/** 阴茎、阴囊的部件、骨骼名字（Penis_01、Penis_01_02、Scrotum_01） */
const ADULT_NAME = /^(Penis|Scrotum)_/;
const dropAdult = <T>(record: Record<string, T>): Record<string, T> | null => {
  const keys = Object.keys(record).filter((name) => ADULT_NAME.test(name));
  if (!keys.length) return null;
  return Object.fromEntries(Object.entries(record).filter(([name]) => !ADULT_NAME.test(name)));
};

/** 关开关时收起来的成人部件设定（见 keepAdult）：也是这台设备自己记着，不进配置、不进撤销 */
const KEPT_KEY = 'oc-basemesh-adult-kept';

/** 关开关时收起来的那一份：几根、多大、排法、每排几根、阴囊、软硬，姿势、微调里阴茎和阴囊那几条 */
interface KeptAdult {
  penises: number;
  penisSize: number;
  penisLayout: BodySpec['penisLayout'];
  penisRow: number;
  scrotum: BodySpec['scrotum'];
  penisSoft?: boolean;
  bones: Record<string, [number, number, number, number]>;
  overrides: Record<string, PartOverride>;
  characterOverrides: Record<string, PartOverride>;
}
/** 本机存不了的时候（无痕窗口）这一次照它算 */
let keptHere: KeptAdult | null | undefined;

const onlyAdult = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([name]) => ADULT_NAME.test(name)));

/**
 * 关开关之前：把成人部件的设定收起来（只是藏起来，不是还原）。再打开时 restoreAdult 原样放回去，不用重新捏。
 * 身上没有阴茎、设定也都是默认的就不收（之前收着的照样留着）
 */
export function keepAdult(spec: BodySpec) {
  const def = defaultSpec();
  const kept: KeptAdult = {
    penises: spec.counts.penises,
    penisSize: spec.shape.penisSize,
    penisLayout: spec.penisLayout,
    penisRow: spec.penisRow,
    scrotum: spec.scrotum,
    penisSoft: spec.penisSoft,
    bones: onlyAdult(spec.posing.bones),
    overrides: onlyAdult(spec.overrides),
    characterOverrides: onlyAdult(spec.characterOverrides),
  };
  const nothing =
    !kept.penises &&
    kept.penisSize === def.shape.penisSize &&
    kept.penisLayout === def.penisLayout &&
    kept.penisRow === def.penisRow &&
    kept.scrotum === def.scrotum &&
    !kept.penisSoft &&
    !Object.keys(kept.bones).length &&
    !Object.keys(kept.overrides).length &&
    !Object.keys(kept.characterOverrides).length;
  if (nothing) return;
  keptHere = kept;
  try {
    localStorage.setItem(KEPT_KEY, JSON.stringify(kept));
  } catch {
    // 存不了：这一次照样管用（见 keptHere）
  }
}

function readKept(): KeptAdult | null {
  if (keptHere !== undefined) return keptHere;
  try {
    const raw = localStorage.getItem(KEPT_KEY);
    return raw ? (JSON.parse(raw) as KeptAdult) : null;
  } catch {
    return null;
  }
}

/**
 * 打开开关以后：关之前收起来的那一份原样放回去（几根、大小、排法、姿势、微调都是关之前的样子），用过就清掉。
 * 没收过就原样返回。根数照收起来的那份：关着时描述里不写阴茎，照描述认出来的是 0
 */
export function restoreAdult(spec: BodySpec): BodySpec {
  const kept = readKept();
  keptHere = null;
  try {
    localStorage.removeItem(KEPT_KEY);
  } catch {
    // 存不了就算了
  }
  if (!kept) return spec;
  const def = defaultSpec();
  return {
    ...spec,
    counts: { ...spec.counts, penises: spec.counts.penises || (Number(kept.penises) || 0) },
    shape: { ...spec.shape, penisSize: Number.isFinite(kept.penisSize) ? kept.penisSize : def.shape.penisSize },
    penisLayout: kept.penisLayout ?? def.penisLayout,
    penisRow: Number.isFinite(kept.penisRow) ? kept.penisRow : def.penisRow,
    scrotum: kept.scrotum ?? def.scrotum,
    penisSoft: kept.penisSoft === true,
    posing: { ...spec.posing, bones: { ...spec.posing.bones, ...kept.bones } },
    overrides: { ...spec.overrides, ...kept.overrides },
    characterOverrides: { ...spec.characterOverrides, ...kept.characterOverrides },
  };
}

/**
 * 开关关着：把成人部件去掉，连带它们的设定（大小、排法、每排几根、阴囊、软硬）回到默认，
 * 姿势、微调里阴茎、阴囊那几条也删掉——不然存下来、导出的配置里还留着。没有要去的就原样返回。
 * 关开关时这些先收起来（keepAdult），再打开时原样放回去（restoreAdult）
 */
export function withoutAdult(spec: BodySpec): BodySpec {
  const def = defaultSpec();
  const bones = dropAdult(spec.posing.bones);
  const overrides = dropAdult<PartOverride>(spec.overrides);
  const characterOverrides = dropAdult<PartOverride>(spec.characterOverrides);
  const settled =
    !spec.counts.penises &&
    spec.shape.penisSize === def.shape.penisSize &&
    spec.penisLayout === def.penisLayout &&
    spec.penisRow === def.penisRow &&
    spec.scrotum === def.scrotum &&
    !spec.penisSoft;
  if (settled && !bones && !overrides && !characterOverrides) return spec;
  return {
    ...spec,
    counts: { ...spec.counts, penises: 0 },
    shape: { ...spec.shape, penisSize: def.shape.penisSize },
    penisLayout: def.penisLayout,
    penisRow: def.penisRow,
    scrotum: def.scrotum,
    penisSoft: false,
    ...(bones ? { posing: { ...spec.posing, bones } } : {}),
    ...(overrides ? { overrides } : {}),
    ...(characterOverrides ? { characterOverrides } : {}),
  };
}
