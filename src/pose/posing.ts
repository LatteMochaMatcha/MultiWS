/**
 * 姿势：每根骨骼朝哪、整个人挪了多少。纯数据，可 JSON 化，存在配置的 posing 字段里，也单独存成姿势文件。
 *
 * 按骨骼的名字记（UpperArm_L、Head.002 …）：把手臂从 3 对减到 1 对，第 2、3 对的姿势不会丢，
 * 加回来的时候还在；现在这个身体上没有的骨骼，它的那一条就先放着不用。
 *
 * 现在的记法（第 3 版）不依赖这个身体的静止姿势是 A-pose 还是 T-pose，换个角色也能套：
 * 每根骨骼记的是它在世界里一共转了多少，四元数 [x, y, z, w]，轴是角色自己的轴（X 左手边，Y 朝上，Z 朝前）。
 * 上臂、前臂从「T-pose、手肘朝后」算起；手掌和手指从「T-pose、手心朝下、手指并拢伸直」算起；别的骨骼从各自的静止姿势算起。
 * 身上的主要骨骼（脊柱、头、四肢）摆过以后每根都记；别的（尾巴、头发、手指）只记自己转过的，没记的跟着父骨骼走。
 * 怎么和某一副骨架互相换算见 solver.ts。左右镜像只要把 y、z 两个分量反号。
 *
 * 第 2 版和第 3 版只差在手上：那时手掌跟着前臂算，手心朝哪要看这副骨架静止时手是怎么接在前臂上的。
 * 第 1 版记的是「在这个身体的静止姿势上，相对父骨骼又转了多少」，换了 A-pose / T-pose 姿势就跟着变。
 * 旧数据都还读得出来，照原来的意思用，下次存的时候换成新的记法。
 */
import { cleanFaces, flipFaces } from '../character/face';
import type { Quat, V3 } from '../geometry/vec';
import { quatUnit } from './math';

/** 姿势数据的格式版本：现在写出去的都是这一版 */
export const POSING_VERSION = 3;

export interface Posing {
  version: 1 | 2 | 3;
  /** 骨骼名 → 这根骨骼的旋转（几个版本的意思不一样，见上面）。没写的骨骼跟着父骨骼走 */
  bones: Record<string, Quat>;
  /** 整个人（胯）挪了多少：以静止时胯离地的高度为 1，所以高个子、矮个子摆出来是同一个姿势。不挪就不写 */
  root?: V3;
  /**
   * 表情（只有成品角色用得上）：哪张脸（Head、Head.002 …，同一个头上多出来的脸是 Head/2 …）→
   * 表情的名字（joy、angry、blink_l、a …）→ 开到多少（0–1）。没有表情就不写
   */
  faces?: Record<string, Record<string, number>>;
}

export const emptyPosing = (): Posing => ({ version: POSING_VERSION, bones: {} });

/** 摆过姿势没有（只摆了表情也算） */
export const isPosed = (posing: Posing): boolean => Boolean(posing.root) || Object.keys(posing.bones).length > 0 || Boolean(posing.faces);

const round5 = (n: number) => Math.round(n * 1e5) / 1e5 + 0;

/** 整理一个旋转：归一、w 取正、留 5 位小数 */
export function roundQuat(q: Quat): Quat {
  const u = quatUnit(q);
  const s = u[3] < 0 ? -1 : 1;
  return [round5(u[0] * s), round5(u[1] * s), round5(u[2] * s), round5(u[3] * s)];
}

/** 同上；等于没转的返回 null */
export function tidyQuat(q: Quat): Quat | null {
  const out = roundQuat(q);
  return out[0] === 0 && out[1] === 0 && out[2] === 0 ? null : out;
}

/** 整理整个人的位移：留 5 位小数；等于没挪的返回 undefined */
export function tidyRoot(v: V3): V3 | undefined {
  const out: V3 = [round5(v[0]), round5(v[1]), round5(v[2])];
  return out[0] === 0 && out[1] === 0 && out[2] === 0 ? undefined : out;
}

const numbers = (v: unknown, count: number): number[] | null =>
  Array.isArray(v) && v.length === count && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (v as number[]) : null;

/**
 * 把任意来源的数据（存档、用户载入的文件）整理成合法的姿势：
 * 不是数字的、长度不对的丢掉。认不出来就是空姿势。
 */
export function cleanPosing(input: unknown): Posing {
  const out = emptyPosing();
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return out;
  const src = input as { version?: unknown; bones?: unknown; root?: unknown; faces?: unknown };
  // 只有明写着旧版本的才照旧的意思读
  if (src.version === 1 || src.version === 2) out.version = src.version;
  if (typeof src.bones === 'object' && src.bones !== null && !Array.isArray(src.bones)) {
    for (const [name, raw] of Object.entries(src.bones)) {
      const q = numbers(raw, 4);
      if (!q || q.every((n) => n === 0)) continue;
      // 第 1 版里「没转」的不用留；后来的版本里「一共没转」也是一句有用的话（父骨骼转了，它没跟着转）
      const tidy = out.version === 1 ? tidyQuat(q as Quat) : roundQuat(q as Quat);
      if (tidy) out.bones[name] = tidy;
    }
  }
  const root = numbers(src.root, 3);
  const moved = root && tidyRoot(root as V3);
  if (moved) out.root = moved;
  const faces = cleanFaces(src.faces);
  if (faces) out.faces = faces;
  return out;
}

/* ---------------- 左右 ---------------- */

/** 骨骼名里的左右：UpperArm_L、UpperArm_L.002、Wing_02_L 是左，换成 R 就是对侧那一根。不分左右的返回 null */
export function twinBone(name: string): { side: 'L' | 'R'; twin: string } | null {
  const m = /^(.*)_([LR])((?:\.\d+)?)$/.exec(name);
  if (!m) return null;
  const side = m[2] as 'L' | 'R';
  return { side, twin: `${m[1]}_${side === 'L' ? 'R' : 'L'}${m[3]}` };
}

/** 一个旋转左右镜像以后的样子 */
export const mirrorQuat = (q: Quat): Quat => [q[0], -q[1] + 0, -q[2] + 0, q[3]];


/** 整个姿势左右翻过来：左右两侧互换，中间的骨骼和整个人的位置照镜子 */
export function flipPosing(posing: Posing): Posing {
  const bones: Record<string, Quat> = {};
  for (const [name, q] of Object.entries(posing.bones)) bones[twinBone(name)?.twin ?? name] = mirrorQuat(q);
  const root = posing.root && tidyRoot([-posing.root[0], posing.root[1], posing.root[2]]);
  // 表情也照镜子：闭的是左眼的，翻过来闭右眼
  return { version: posing.version, bones, ...(root ? { root } : {}), ...(posing.faces ? { faces: flipFaces(posing.faces) } : {}) };
}
