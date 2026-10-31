/**
 * 编辑手动微调用的小工具。都是纯函数，返回新的 BodySpec。
 * 改的是现在这个身体样式的那一份：成品角色改 BodySpec.characterOverrides，白模人台、二次元素体改 BodySpec.overrides
 */
import { type BodySpec, type PartOverride, cleanOverride } from './spec';

/** 现在这个身体样式的微调记在哪一份里 */
const fieldOf = (spec: Pick<BodySpec, 'bodyStyle'>) => (spec.bodyStyle === 'character' ? 'characterOverrides' : 'overrides');

/** 现在这个身体样式的微调 */
export const activeOverrides = (spec: Pick<BodySpec, 'bodyStyle' | 'overrides' | 'characterOverrides'>): Readonly<Record<string, PartOverride>> =>
  spec[fieldOf(spec)];

/** 左右成对的部件，对侧那一个的名字（Arm_02_L → Arm_02_R）；不成对的返回 null */
export function mirrorName(name: string): string | null {
  if (name.endsWith('_L')) return `${name.slice(0, -1)}R`;
  if (name.endsWith('_R')) return `${name.slice(0, -1)}L`;
  return null;
}

/** 一条微调照到对侧是什么样：左右的偏移反过来，绕 Y、Z 轴的转动反过来，大小不变 */
export function mirrorOverride(o: PartOverride): PartOverride {
  const out: PartOverride = {};
  if (o.position) out.position = [-o.position[0] + 0, o.position[1], o.position[2]];
  if (o.rotation) out.rotation = [o.rotation[0], -o.rotation[1] + 0, -o.rotation[2] + 0];
  if (o.scale) out.scale = [...o.scale];
  return out;
}

function withOverride(spec: BodySpec, name: string, o: PartOverride | null): BodySpec {
  const overrides = { ...activeOverrides(spec) };
  if (o) overrides[name] = o;
  else delete overrides[name];
  return { ...spec, [fieldOf(spec)]: overrides };
}

/**
 * 修改一个部件的微调：patch 里给了的分量（位置 / 角度 / 大小）整个替换，没给的保持原样。
 * 改完等于「没动过」的话，这个部件的记录就整条删掉。
 * mirror：左右成对的部件，对侧同时改成镜像的样子。
 */
export function setOverride(spec: BodySpec, name: string, patch: PartOverride, mirror = false): BodySpec {
  const next = cleanOverride({ ...activeOverrides(spec)[name], ...patch });
  let out = withOverride(spec, name, next);
  const twin = mirror ? mirrorName(name) : null;
  if (twin) out = withOverride(out, twin, next && mirrorOverride(next));
  return out;
}

/** 把一个部件还原成自动摆位的样子 */
export function clearOverride(spec: BodySpec, name: string, mirror = false): BodySpec {
  let out = withOverride(spec, name, null);
  const twin = mirror ? mirrorName(name) : null;
  if (twin) out = withOverride(out, twin, null);
  return out;
}

export function clearAllOverrides(spec: BodySpec): BodySpec {
  return Object.keys(activeOverrides(spec)).length ? { ...spec, [fieldOf(spec)]: {} } : spec;
}
