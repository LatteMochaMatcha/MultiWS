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

/**
 * 开关关着：把成人部件去掉，连带它们的设定（大小、排法、每排几根、阴囊）回到默认，
 * 姿势、微调里阴茎、阴囊那几条也删掉——不然存下来、导出的配置里还留着。没有要去的就原样返回。
 * 再打开开关时照描述重新长出来（根数、排法、阴囊写在描述里）；大小、摆过的姿势、微调不留
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
    spec.scrotum === def.scrotum;
  if (settled && !bones && !overrides && !characterOverrides) return spec;
  return {
    ...spec,
    counts: { ...spec.counts, penises: 0 },
    shape: { ...spec.shape, penisSize: def.shape.penisSize },
    penisLayout: def.penisLayout,
    penisRow: def.penisRow,
    scrotum: def.scrotum,
    ...(bones ? { posing: { ...spec.posing, bones } } : {}),
    ...(overrides ? { overrides } : {}),
    ...(characterOverrides ? { characterOverrides } : {}),
  };
}
