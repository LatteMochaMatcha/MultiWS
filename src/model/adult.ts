/**
 * 「显示成人部件」开关：这台设备、这个浏览器自己记着（localStorage），不进配置、不进撤销。
 * 默认关。关着的时候阴茎这几项不出现，文字里写了、载入的配置里有也不长（见 main.ts 的 commit）。
 * 工坊的仓库是公开的，exe、apk 也会发给别人，所以默认藏着。
 */
import type { BodySpec } from './spec';

const KEY = 'oc-basemesh-adult';

export function adultOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setAdult(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // 无痕窗口等场景下存不了：这一次照样管用，下次打开又是关着的
  }
}

/** 开关关着：把成人部件去掉（没有就原样返回） */
export const withoutAdult = (spec: BodySpec): BodySpec => (spec.counts.penises ? { ...spec, counts: { ...spec.counts, penises: 0 } } : spec);
