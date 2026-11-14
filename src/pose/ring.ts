/**
 * 现成的姿势套到「围成一圈」的身体上（geometry/ring.ts）。
 *
 * 姿势数据（posing.ts 第 3 版）记的是「直立的一个人」在世界里每根骨骼转了多少，轴是角色自己的轴。
 * 围成一圈的每个人脸朝外、各朝各的方向，照原样套的话只有第一个人（名字不带编号的那套骨骼）动，而且别人的骨骼跟着世界的方向转。
 * 所以这里和连体（pose/conjoined.ts）一样，换到各自的朝向里去套：
 * - 背不弯：每个人的脊柱（Spine、Chest、UpperChest）不照姿势转。几个人的背是并在一起的，一弯就各自从圈心掰开、露出里面的芯子
 *   （他看了说「在这种情况下就不让背部进行弯曲了」）。摆姿势时腰、胸的圆点也不给，拖手时脊柱不帮着够（见 isRingRig）。
 * - 每个人的脖子、头：照这个人自己的朝向 B（Y 是从腰到头，Z 是从圈心朝外，X 是他的左手边），转法是 B·q·B⁻¹。仰头是都往外仰。
 * - 每条腿（外圈每人两条、圈心底下的）：照这条腿自己从圈心朝外的方向（只绕竖轴转），左腿套姿势里的左腿、右腿套右腿，
 *   中线上的套左右两条的平均；正中那条没有朝向，照原样。迈步是每条腿都往外迈，蹲下是膝盖都朝外。
 *   腿统一朝前的（geometry/ring.ts 的 legFacing，见 legsFront）不换朝向，照原样套；左右照这条腿长在整个身子的哪一边分
 *   （左半边的套姿势里的左腿、右半边的套右腿、中线上的套平均），不照名字——背对着的那个人的左腿长在整个身子的右边，
 *   照名字套的话两腿分开站时他的两条腿是交叉的。迈步是所有的腿朝一个方向迈。
 * - 两侧的手臂：照整个身子的左右套，不照它长在谁身上。左手形状的手臂长在整个身子左边（+X）、右手形状的长在右边时照原样
 *   （B 是不转）；形状和所在的一边相反的当成一个脸朝后的人的手臂（B 是绕竖轴转半圈）。
 *   上臂、前臂、手、手指是从 T-pose 算起的，转法是 B·q；锁骨是 B·q·B⁻¹。
 *   一侧有好几条时（都长在同一个人身上：上下排的沿着身侧往下排，肩部扇形聚拢的挤在一个肩膀上扇开）：这个姿势里上臂的方向
 *   和哪一条静止时的方向最接近，那一条正好摆成这个姿势，别的几条相对自己静止时转同样多——静止时几条是错开着的，这样还是错开着；
 *   都写成一模一样的朝向的话几条叠在一条线上，手压在别的手臂上。
 *   围成一圈的手臂都在这里写好了，pose/fit.ts 的 fitArms（同一个肩膀上挤着几条时怎么分）不再管：围成一圈时手臂静止是平伸的，
 *   离大多数姿势都远，照它的办法只有一条会动。
 * - 胯不转（整个身子不跟着歪、不跟着躺下），整个人只照姿势上下挪（蹲下、坐下时落下去），不往前后左右挪。
 * 纯函数。
 */
import type { Quat, V3 } from '../geometry/vec';
import { cross, norm, quatConj, quatMul, rotate, sub } from '../geometry/vec';
import { quatUnit } from './math';
import type { Posing } from './posing';
import { type PoseRig, forward } from './rig';
import { type Solver, stateOf } from './solver';

/** 从 T-pose 算起的骨骼（去掉编号以后的名字） */
const FROM_T = /^(UpperArm|LowerArm|Hand|(Thumb|Index|Middle|Ring|Little|Finger[A-C])\d)_[LR]$/;
/** 手臂上的骨骼（锁骨也算） */
const ARM_PART = /^(Shoulder|UpperArm|LowerArm|Hand|(Thumb|Index|Middle|Ring|Little|Finger[A-C])\d)_([LR])$/;
/** 腿上的骨骼：1 哪一节，2 左右（中线上的没有） */
const LEG_PART = /^(UpperLeg|LowerLeg|Foot|Toes)(?:_([LR]))?$/;
/** 脊柱的几节（去掉编号以后的名字） */
const SPINE_PART = /^(Spine|Chest|UpperChest)$/;
/** 离圈心不到这么远的腿（正中那条）没有朝向 */
const CENTER = 0.03;

const baseName = (name: string) => name.replace(/\.\d{3}$/, '');
const aboutY = (angle: number): Quat => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];

/** 三根轴（列）拼成的旋转 → 四元数 */
function basisQuat(x: V3, y: V3, z: V3): Quat {
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  return quatUnit(q);
}

/** 两个旋转的平均（归一化的线性平均，先换到同一边）；缺的当没转 */
function average(a: Quat | undefined, b: Quat | undefined): Quat {
  const p = a ?? [0, 0, 0, 1];
  const q = b ?? [0, 0, 0, 1];
  const s = p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3] < 0 ? -1 : 1;
  return quatUnit([p[0] + s * q[0], p[1] + s * q[1], p[2] + s * q[2], p[3] + s * q[3]]);
}

const ringRigs = new WeakMap<object, boolean>();
/**
 * 这副骨架是不是围成一圈的：胯底下直接接着三条以上的脊柱，名字是 Spine、Spine.002 …
 * （好几个上半身的是 Spine_L、Spine_R，连体只有两条，都不算）。围成一圈时背不弯：见文件开头
 */
export function isRingRig(rig: Pick<PoseRig, 'names' | 'parent' | 'hips'>): boolean {
  let known = ringRigs.get(rig);
  if (known === undefined) {
    const roots = rig.names.filter((name, j) => rig.parent[j] === rig.hips && /^Spine/.test(name));
    known = roots.length >= 3 && roots.every((name) => /^Spine(\.\d{3})?$/.test(name));
    ringRigs.set(rig, known);
  }
  return known;
}

/** 腿是不是统一朝前的：每只脚从脚踝到脚尖，从上面看都朝正前（+Z，差不到 20°）。绕圈朝外的总有朝后的 */
function legsFront(rig: Pick<PoseRig, 'names' | 'head' | 'tail'>): boolean {
  let feet = 0;
  for (let j = 0; j < rig.names.length; j++) {
    if (!/^Foot(_[LR])?$/.test(baseName(rig.names[j]))) continue;
    const along = sub(rig.tail[j], rig.head[j]);
    const flat = Math.hypot(along[0], along[2]);
    if (flat < 1e-3) continue;
    if (along[2] / flat < 0.94) return false;
    feet++;
  }
  return feet > 0;
}

/** 是不是脊柱的一节（Spine、Chest.002、UpperChest.003 …） */
export const isSpineBone = (name: string): boolean => SPINE_PART.test(baseName(name));

/** 把直立的人的姿势换成这副围成一圈的骨架上的（见文件开头）。骨架不是围成一圈的、旧记法的姿势原样返回 */
export function fitRing(solver: Solver, posing: Posing): Posing {
  if (posing.version === 1) return posing;
  const { names, parent, head, hips } = solver.rig;
  const front = legsFront(solver.rig);
  const frames = posing.version === 2 ? solver.frames2 : solver.frames;
  // 圈上的每个人：胯底下直接接着的脊柱
  const roots = names.flatMap((name, j) => (parent[j] === hips && /^Spine/.test(name) ? [j] : []));
  if (roots.length < 2) return posing;
  /** 这根骨骼顺着父骨骼往上，胯底下的那一根 */
  const topOf = (j: number): number => {
    let b = j;
    while (b >= 0 && parent[b] !== hips) b = parent[b];
    return b;
  };
  const outward = (p: V3): V3 | null => (Math.hypot(p[0], p[2]) > CENTER ? norm([p[0], 0, p[2]]) : null);
  // 每个人自己的朝向：Y 从腰到头，Z 从圈心朝外
  const bodies = roots.map((root): Quat | null => {
    const top = names.findIndex((name, j) => /^Head/.test(name) && topOf(j) === root);
    const out = outward(head[root]);
    if (!out) return null;
    const y = top >= 0 ? norm(sub(head[top], head[root])) : ([0, 1, 0] as V3);
    const k = out[0] * y[0] + out[1] * y[1] + out[2] * y[2];
    const z = norm([out[0] - y[0] * k, out[1] - y[1] * k, out[2] - y[2] * k]);
    return basisQuat(cross(y, z), y, z);
  });
  const turned = (B: Quat | null, q: Quat, fromT: boolean): Quat => (B ? quatUnit(fromT ? quatMul(B, q) : quatMul(quatMul(B, q), quatConj(B))) : q);
  const bones: Record<string, Quat> = {};
  names.forEach((name, j) => {
    if (j === hips) return;
    const base = baseName(name);
    const top = topOf(j);
    if (top < 0) return;
    const leg = LEG_PART.exec(base);
    if (leg && roots.indexOf(top) < 0) {
      const both = () => (posing.bones[`${leg[1]}_L`] || posing.bones[`${leg[1]}_R`] ? average(posing.bones[`${leg[1]}_L`], posing.bones[`${leg[1]}_R`]) : undefined);
      if (front) {
        // 统一朝前：照原样套，左右照这条腿长在整个身子的哪一边
        const x = head[top][0];
        const told = Math.abs(x) < CENTER ? both() : posing.bones[`${leg[1]}_${x > 0 ? 'L' : 'R'}`];
        if (told) bones[name] = told;
        return;
      }
      // 腿：照这条腿自己朝外的方向
      const told = leg[2] ? posing.bones[base] : both();
      if (!told) return;
      const out = outward(head[top]);
      bones[name] = turned(out ? aboutY(Math.atan2(out[0], out[2])) : null, told, false);
      return;
    }
    // 背不弯
    if (SPINE_PART.test(base)) return;
    const told = posing.bones[base] ?? posing.bones[name];
    if (!told) return;
    const arm = ARM_PART.exec(base);
    if (arm) {
      // 和第一对长在同一个人身上的另外几条：下面一起算（见 together）
      const lead = solver.rig.index.get(base);
      if (name !== base && lead !== undefined && topOf(lead) === top) return;
      // 手臂：照整个身子的左右。从这根骨骼往上找到上臂，看它在哪一边
      let upper = j;
      while (upper >= 0 && !/^(Shoulder|UpperArm)_/.test(names[upper])) upper = parent[upper];
      const at = upper >= 0 ? head[upper] : head[j];
      const left = arm[3] === 'L';
      const same = at[0] >= 0 === left;
      bones[name] = turned(same ? null : aboutY(Math.PI), told, FROM_T.test(base));
      return;
    }
    const k = roots.indexOf(top);
    bones[name] = turned(k >= 0 ? bodies[k] : null, told, false);
  });
  /* 一侧好几条手臂（都长在第一对那个人身上）：最接近这个姿势的那一条正好摆成这样，别的相对自己静止时转同样多 */
  const { index } = solver.rig;
  const way = (from: number, to: number): V3 => norm(sub(head[to], head[from]));
  const lowerOf = (upper: number) => index.get(names[upper].replace(/^UpperArm/, 'LowerArm'));
  const suffixOf = (bone: number) => /\.\d{3}$/.exec(names[bone])?.[0] ?? '';
  for (const tag of ['L', 'R']) {
    const first = index.get(`UpperArm_${tag}`);
    const firstLower = first === undefined ? undefined : lowerOf(first);
    if (first === undefined || firstLower === undefined || !bones[`UpperArm_${tag}`]) continue;
    const top = topOf(first);
    const column = names.flatMap((name, j) => (baseName(name) === `UpperArm_${tag}` && topOf(j) === top && lowerOf(j) !== undefined ? [j] : []));
    if (column.length < 2) continue;
    // 这个姿势里上臂朝哪（第一对摆成这样时）；每一条静止时朝哪（围成一圈时背不弯、胯不转，带着它的骨骼都没动）
    const posed = forward(solver.rig, stateOf(solver, { version: posing.version, bones } as Posing));
    const want = rotate(posed.rot[first], way(first, firstLower));
    const off = (upper: number) => {
      const rest = way(upper, lowerOf(upper)!);
      return Math.acos(Math.max(-1, Math.min(1, rest[0] * want[0] + rest[1] * want[1] + rest[2] * want[2])));
    };
    const lead = column.reduce((a, b) => (off(b) < off(a) ? b : a));
    for (const [name, told] of Object.entries(bones)) {
      if (ARM_PART.exec(name)?.[3] !== tag) continue;
      const leading = index.get(name + suffixOf(lead));
      if (leading === undefined) continue;
      const turnedBy = quatMul(told, quatConj(frames[leading]));
      for (const upper of column) {
        const own = index.get(name + suffixOf(upper));
        if (own !== undefined) bones[name + suffixOf(upper)] = upper === lead ? told : quatUnit(quatMul(turnedBy, frames[own]));
      }
    }
  }
  return {
    version: posing.version,
    bones,
    ...(posing.root ? { root: [0, posing.root[1], 0] as V3 } : {}),
    ...(posing.faces ? { faces: posing.faces } : {}),
  };
}
