/**
 * 编辑手动微调用的小工具。都是纯函数，返回新的 BodySpec。
 * 改的是现在这个身体样式的那一份：成品角色改 BodySpec.characterOverrides，白模人台、二次元素体改 BodySpec.overrides
 */
import { type Quat, type V3, eulerOf, quatConj, quatEuler, quatMul, rotate } from '../geometry/vec';
import { type BodySpec, type PartOverride, type Vec3, cleanOverride } from './spec';

const DEG = Math.PI / 180;

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

/* ---------------- 多选：好几个部件一起改 ---------------- */

/**
 * 好几个部件一起改时的同一份改动：每个部件都绕自己的关节，各自照它改。
 * move 是世界坐标里挪了多少（米），turn 是世界坐标里转了多少，ratio 是三个方向各放大到几倍
 */
export interface TweakDelta {
  move?: V3;
  turn?: Quat;
  ratio?: Vec3;
}

/**
 * 选中的部件里真正要改的那些：父部件（往上数任何一层）也选中了的不算——它本来就跟着父部件动，再改一次就动了两份。
 * parentOf 给出一个部件的父部件名，没有就是 undefined
 */
export function topMost(names: readonly string[], parentOf: (name: string) => string | undefined): string[] {
  const picked = new Set(names);
  return names.filter((name) => {
    // 最多往上数这么多层：万一父子关系绕成了圈也停得下来
    for (let up = parentOf(name), guard = 0; up !== undefined && guard < 32; up = parentOf(up), guard++) if (picked.has(up)) return false;
    return true;
  });
}

/** 同一份改动照到对侧是什么样：左右的平移反过来，绕 Y、Z 轴的转动反过来，倍率不变（和 mirrorOverride 一个意思） */
export function mirrorDelta(delta: TweakDelta): TweakDelta {
  const out: TweakDelta = {};
  if (delta.move) out.move = [-delta.move[0] + 0, delta.move[1], delta.move[2]];
  if (delta.turn) out.turn = [delta.turn[0], -delta.turn[1] + 0, -delta.turn[2] + 0, delta.turn[3]];
  if (delta.ratio) out.ratio = [...delta.ratio];
  return out;
}

/** 部件在哪一侧（名字以 _L、_R 结尾的）；正中的是 null */
export const sideOf = (name: string): 'L' | 'R' | null => (name.endsWith('_L') ? 'L' : name.endsWith('_R') ? 'R' : null);

/**
 * 一个部件的微调照 delta 改了以后是什么样（只给出改了的那一项，交给 setOverride）。
 * 位置、角度都是相对父部件记的：parentQuat、parentScale 是父部件在世界里的朝向和缩放（见 geometry/tweak.ts 的 PartFrame）
 */
export function nudgeOverride(o: PartOverride | undefined, frame: { parentQuat: Quat; parentScale: number }, delta: TweakDelta): PartOverride {
  const out: PartOverride = {};
  if (delta.move) {
    const local = rotate(quatConj(frame.parentQuat), delta.move);
    const p = o?.position ?? [0, 0, 0];
    out.position = [p[0] + local[0] / frame.parentScale, p[1] + local[1] / frame.parentScale, p[2] + local[2] / frame.parentScale];
  }
  if (delta.turn) {
    const r = o?.rotation ?? [0, 0, 0];
    // 世界里多转的那一份，换到父部件的轴里，接在原来的角度前面
    const turned = quatMul(quatMul(quatMul(quatConj(frame.parentQuat), delta.turn), frame.parentQuat), quatEuler(r[0] * DEG, r[1] * DEG, r[2] * DEG));
    const e = eulerOf(turned);
    out.rotation = [e[0] / DEG, e[1] / DEG, e[2] / DEG];
  }
  if (delta.ratio) {
    const s = o?.scale ?? [1, 1, 1];
    out.scale = [s[0] * delta.ratio[0], s[1] * delta.ratio[1], s[2] * delta.ratio[2]];
  }
  return out;
}

export function clearAllOverrides(spec: BodySpec): BodySpec {
  return Object.keys(activeOverrides(spec)).length ? { ...spec, [fieldOf(spec)]: {} } : spec;
}
