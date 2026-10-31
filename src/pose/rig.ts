/**
 * 摆姿势用的骨架：从工坊通用的骨架（rig/skeleton.ts、成品角色的骨骼）整理出来，
 * 加上「姿势 → 每根骨骼在哪、朝哪」的换算。纯函数，不碰 three.js 和 DOM。
 *
 * 约定和 character/pose.ts 一样：静止姿势下每根骨骼都不带旋转，只有关节的位置；
 * 一根骨骼的旋转是绕它自己的关节（起点）转，子骨骼跟着走。父骨骼总排在子骨骼前面。
 */
import { type Mat3, type Quat, type V3, Q_ID, add, mat3Apply, quatConj, quatMat3, quatMul, rotate, sub } from '../geometry/vec';
import { quatUnit } from './math';

export interface RigBone {
  name: string;
  /** 父骨骼的下标，根是 -1 */
  parent: number;
  /** 静止姿势里的起点（关节）和终点，米 */
  head: V3;
  tail: V3;
}

export interface PoseRig {
  names: string[];
  parent: number[];
  head: V3[];
  tail: V3[];
  index: Map<string, number>;
  /** 胯（Hips）是哪一根；整个人挪动就是挪它。没有叫 Hips 的就用第一根根骨骼 */
  hips: number;
  /** 静止时胯离地多高（米）：姿势里整个人的位移以它为 1 */
  unit: number;
}

export function makeRig(bones: readonly RigBone[]): PoseRig {
  const names = bones.map((b) => b.name);
  const index = new Map(names.map((name, i) => [name, i]));
  const named = index.get('Hips');
  const hips = named ?? Math.max(0, bones.findIndex((b) => b.parent < 0));
  const height = bones[hips]?.head[1] ?? 0;
  return {
    names,
    parent: bones.map((b) => b.parent),
    head: bones.map((b) => b.head),
    tail: bones.map((b) => b.tail),
    index,
    hips,
    unit: height > 1e-3 ? height : 1,
  };
}

/** 一个姿势落到某副骨架上：每根骨骼相对父骨骼的旋转，加上胯挪了多少（米） */
export interface PoseState {
  local: Quat[];
  root: V3;
}

export const restState = (rig: PoseRig): PoseState => ({ local: rig.names.map(() => Q_ID), root: [0, 0, 0] });

export const cloneState = (state: PoseState): PoseState => ({ local: state.local.slice(), root: [state.root[0], state.root[1], state.root[2]] });


/** 摆好以后每根骨骼的朝向（相对静止姿势转了多少）和关节的位置，世界坐标 */
export interface Frame {
  rot: Quat[];
  pos: V3[];
}

const ORIGIN: V3 = [0, 0, 0];

export function forward(rig: PoseRig, state: PoseState): Frame {
  const n = rig.names.length;
  const rot = new Array<Quat>(n);
  const pos = new Array<V3>(n);
  for (let j = 0; j < n; j++) {
    const p = rig.parent[j];
    let offset = sub(rig.head[j], p >= 0 ? rig.head[p] : ORIGIN);
    if (j === rig.hips) offset = add(offset, state.root);
    if (p < 0) {
      rot[j] = state.local[j];
      pos[j] = offset;
    } else {
      rot[j] = quatMul(rot[p], state.local[j]);
      pos[j] = add(pos[p], rotate(rot[p], offset));
    }
  }
  return { rot, pos };
}

/** 跟着第 bone 根骨骼动的一个点（rest 是它在静止姿势里的位置）现在在哪 */
export const pointOn = (rig: PoseRig, frame: Frame, bone: number, rest: V3): V3 =>
  add(frame.pos[bone], rotate(frame.rot[bone], sub(rest, rig.head[bone])));

/** 骨骼的终点现在在哪 */
export const tailOf = (rig: PoseRig, frame: Frame, bone: number): V3 => pointOn(rig, frame, bone, rig.tail[bone]);

/** 让第 bone 根骨骼在世界里朝 rot 这个方向：改的是它相对父骨骼的旋转。frame 是改之前算的 */
export function setWorldRot(rig: PoseRig, state: PoseState, frame: Frame, bone: number, rot: Quat): void {
  const p = rig.parent[bone];
  state.local[bone] = quatUnit(p >= 0 ? quatMul(quatConj(frame.rot[p]), rot) : rot);
}

/** 让胯在世界里挪 delta（米） */
export function shiftRoot(rig: PoseRig, state: PoseState, frame: Frame, delta: V3): void {
  const p = rig.parent[rig.hips];
  state.root = add(state.root, p >= 0 ? rotate(quatConj(frame.rot[p]), delta) : delta);
}

/**
 * 每根骨骼的蒙皮矩阵：把静止姿势里的点搬到摆好以后的位置（和 character/pose.ts 的 skinMatrices 同一种格式）。
 * 一根骨骼 12 个数：前 9 个是 3×3 的旋转（按行），后 3 个是平移。
 * unit：网格的 1 个单位是多少米（融合网格是按标准人台算的，整体缩放另外乘）。
 */
export function poseMatrices(rig: PoseRig, frame: Frame, unit = 1): Float64Array {
  const n = rig.names.length;
  const out = new Float64Array(n * 12);
  for (let j = 0; j < n; j++) {
    const r: Mat3 = quatMat3(frame.rot[j]);
    const moved = mat3Apply(r, rig.head[j]);
    out.set(r, j * 12);
    out[j * 12 + 9] = (frame.pos[j][0] - moved[0]) / unit;
    out[j * 12 + 10] = (frame.pos[j][1] - moved[1]) / unit;
    out[j * 12 + 11] = (frame.pos[j][2] - moved[2]) / unit;
  }
  return out;
}

/** 摆好以后的骨架：把这个样子当成新的静止姿势写进文件用 */
export function posedBones(rig: PoseRig, frame: Frame): RigBone[] {
  return rig.names.map((name, j) => ({ name, parent: rig.parent[j], head: frame.pos[j], tail: tailOf(rig, frame, j) }));
}
