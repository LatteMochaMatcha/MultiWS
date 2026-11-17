/**
 * 现成的姿势套到「围成一圈」的身体上（geometry/ring.ts）。
 *
 * 姿势数据（posing.ts 第 3 版）记的是「直立的一个人」在世界里每根骨骼转了多少，轴是角色自己的轴。
 * 围成一圈的每个人脸朝外、各朝各的方向，照原样套的话只有第一个人（名字不带编号的那套骨骼）动，而且别人的骨骼跟着世界的方向转。
 * 所以这里和连体（pose/conjoined.ts）一样，换到各自的朝向里去套：
 * - 背不弯：每个人的脊柱（Spine、Chest、UpperChest）不照姿势转。几个人的背是并在一起的，一弯就各自从圈心掰开、露出里面的芯子
 *   （他看了说「在这种情况下就不让背部进行弯曲了」）。摆姿势时腰、胸的圆点也不给，拖手时脊柱不帮着够（见 isRingRig）。
 * - 每个人的脖子、头：照这个人自己的朝向 B（Y 是从腰到头，Z 是他脸朝的方向，X 是他的左手边），转法是 B·q·B⁻¹。仰头是都往外仰。
 *   脸朝哪：脊柱（腰 → 脖子根）和脖子这两根线都在这个人的正中面里（脊柱往背后靠，脖子往前歪回来），和它们都垂直的就是他的左右方向，
 *   再和脊柱垂直的就是脸朝的方向。围成一圈时和「从圈心朝外」是一回事；前后排（geometry/ring.ts 的 rows）两边的人斜着朝外、
 *   上身还往中间歪，不是从圈心朝外。两根线几乎平行、看不出来的照从圈心朝外。
 * - 每条腿（外圈每人两条、圈心底下的）：照这条腿自己从圈心朝外的方向（只绕竖轴转），左腿套姿势里的左腿、右腿套右腿，
 *   中线上的套左右两条的平均；正中那条没有朝向，照原样。迈步是每条腿都往外迈，蹲下是膝盖都朝外。
 *   腿统一朝前的（geometry/ring.ts 的 legFacing，见 legsFront）不换朝向，照原样套；左右照这条腿长在整个身子的哪一边分
 *   （左半边的套姿势里的左腿、右半边的套右腿、中线上的套平均），不照名字——背对着的那个人的左腿长在整个身子的右边，
 *   照名字套的话两腿分开站时他的两条腿是交叉的。迈步是所有的腿朝一个方向迈。
 * - 两侧的手臂：照整个身子的左右套，不照它长在谁身上。左手形状的手臂长在整个身子左边（+X）、右手形状的长在右边时照原样
 *   （B 是不转）；形状和所在的一边相反的当成一个脸朝后的人的手臂（B 是绕竖轴转半圈）。
 *   上臂、前臂、手、手指是从 T-pose 算起的，转法是 B·q；锁骨是 B·q·B⁻¹。
 *   一侧有好几条时（长在同一个人身上的算一组：上下排的沿着身侧往下排，肩部扇形聚拢的挤在一个肩膀上扇开；
 *   前后排每侧有前后两组，各算各的）：这个姿势里上臂的方向
 *   和哪一条静止时的方向最接近，那一条正好摆成这个姿势，别的几条相对自己静止时转同样多——静止时几条是错开着的，这样还是错开着；
 *   都写成一模一样的朝向的话几条叠在一条线上，手压在别的手臂上。
 *   围成一圈的手臂都在这里写好了，pose/fit.ts 的 fitArms（同一个肩膀上挤着几条时怎么分）不再管：围成一圈时手臂静止是平伸的，
 *   离大多数姿势都远，照它的办法只有一条会动。
 * - 胯不转（整个身子不跟着歪、不跟着躺下），整个人只照姿势上下挪（蹲下、坐下时落下去），不往前后左右挪。
 *
 * 用体块拼出来的身体（geometry/clone.ts，楚云萱那种：好几副胯、好几个胸腔，有的胸腔转到了背后）也照这一套：
 * 有两个上半身背对背（脸朝的方向差着 90° 以上）就算（见 isRingRig），不然复制出来的骨骼都跟着原来那根照世界的方向转，
 * 朝后的那几个人是往自己背后弯、手臂穿过身体。和围成一圈不一样的只有三处：
 * - 胯有好几副（Hips、Hips.101 …），都不转；一个人是「接在某一副胯上的一串脊柱」；
 * - 脸朝哪直接照脊柱和脖子量（复制出来的胸腔是整块转过去的，量出来不会反；不拿「从圈心朝外」校正——这种身体没有圈心）；
 * - 腿不是都朝正前的（有人把胯也转了）照原样套，不换到「从圈心朝外」。
 * 纯函数。
 */
import { BONE_FIRST, ordinal } from '../geometry/cloneNames';
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
/** 脊柱和脖子这两根线的夹角的正弦不到这么多的，看不出这个人脸朝哪：照从圈心朝外 */
const FACING = 0.05;

/** 胯：Hips，和手工复制出来的那几副（Hips.101 …，见 geometry/cloneNames.ts） */
const PELVIS = /^Hips(\.\d{3})?$/;

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

type Bones = Pick<PoseRig, 'names' | 'parent' | 'hips' | 'head' | 'tail'>;

/** 骨架上的人：每个人是接在胯上的一串脊柱（roots）；top 是一根骨骼顺着父骨骼往上、直接接在胯上的那一根 */
function peopleOf(rig: Pick<PoseRig, 'names' | 'parent' | 'hips'>) {
  const { names, parent, hips } = rig;
  const pelvis = (j: number) => j === hips || (j >= 0 && PELVIS.test(names[j]));
  const top = (j: number): number => {
    let b = j;
    while (b >= 0 && !pelvis(parent[b])) b = parent[b];
    return b;
  };
  const roots = names.flatMap((name, j) => (pelvis(parent[j]) && /^Spine/.test(name) ? [j] : []));
  return { pelvis, top, roots };
}

/**
 * 这个人脸朝哪（水平的单位向量）：脊柱（腰 → 脖子根）和脖子这两根线都在他的正中面里，和它们都垂直的是他的左右方向，
 * 再和脊柱垂直的就是脸朝的方向。没有脖子、两根线几乎平行看不出来的是 null
 */
function facingOf(rig: Bones, root: number, top: (j: number) => number): V3 | null {
  const neck = rig.names.findIndex((name, j) => /^Neck/.test(name) && top(j) === root);
  if (neck < 0) return null;
  const spine = norm(sub(rig.head[neck], rig.head[root]));
  const side = cross(spine, norm(sub(rig.tail[neck], rig.head[neck])));
  if (Math.hypot(side[0], side[1], side[2]) <= FACING) return null;
  const ahead = cross(norm(side), spine);
  const flat = Math.hypot(ahead[0], ahead[2]);
  return flat > 1e-6 ? [ahead[0] / flat, 0, ahead[2] / flat] : null;
}

/** 是不是手工复制出来的骨骼（Spine.261，见 geometry/cloneNames.ts） */
const copied = (name: string) => ordinal(name)[1] >= BONE_FIRST;

const blockRigs = new WeakMap<object, boolean>();
/** 用体块拼的、有两个上半身背对背的（isRingRig 里的第二种）。手臂让开时比围成一圈的多一条要求，见 pose/clear.ts */
export function isBlockRig(rig: Bones): boolean {
  let known = blockRigs.get(rig);
  if (known === undefined) blockRigs.set(rig, (known = backToBack(rig)));
  return known;
}

/** 用体块拼的、有两个上半身背对背的（脸朝的方向差着 90° 以上）：见文件开头 */
function backToBack(rig: Bones): boolean {
  const { top, roots } = peopleOf(rig);
  if (!roots.some((root) => copied(rig.names[root]))) return false;
  const faces = roots.map((root) => facingOf(rig, root, top)).filter((f): f is V3 => f !== null);
  return faces.some((a, i) => faces.some((b, k) => k > i && a[0] * b[0] + a[2] * b[2] < 0));
}

const ringRigs = new WeakMap<object, boolean>();
/**
 * 这副骨架是不是照围成一圈的办法套姿势、背不弯（见文件开头）：
 * - 围成一圈的：胯底下直接接着三条以上的脊柱，名字是 Spine、Spine.002 …（好几个上半身的是 Spine_L、Spine_R，连体只有两条，都不算）；
 * - 用体块拼的、有两个上半身背对背的。手工复制出来的胸腔都朝着差不多的方向的（并排的几个上半身）不算，照平常的套
 */
export function isRingRig(rig: Bones): boolean {
  let known = ringRigs.get(rig);
  if (known === undefined) {
    const roots = rig.names.filter((name, j) => rig.parent[j] === rig.hips && /^Spine/.test(name));
    known = (roots.length >= 3 && roots.every((name) => /^Spine(\.0\d{2})?$/.test(name))) || isBlockRig(rig);
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

/**
 * 用体块拼的身体里挤成一堆的腿（每条腿最上面那根骨骼的下标）：髋关节水平离得不到大腿长的 PACKED 倍的算挨着，
 * 连成一片、超过两条（不止一副胯）的那些。楚云萱九副胯贴在一起，十八条大腿一条挨一条、融合成一整块：
 * 相邻的两条摆得不一样（左腿往前、右腿往后），中间那层皮就被扯成一块板。所以这些腿都摆成一样——左右两条的平均：
 * 蹲、坐这类两条腿差不多的姿势照做，走、跑这类一前一后的腿就不动了。只有一副胯的两条腿不算，照旧一左一右
 */
const PACKED = 0.6;
function packedLegs(rig: Bones, pelvis: (j: number) => boolean): Set<number> {
  const tops = rig.names.flatMap((name, j) => (/^UpperLeg/.test(name) && pelvis(rig.parent[j]) ? [j] : []));
  const group = tops.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  tops.forEach((a, i) => {
    const reach = PACKED * Math.hypot(rig.tail[a][0] - rig.head[a][0], rig.tail[a][1] - rig.head[a][1], rig.tail[a][2] - rig.head[a][2]);
    tops.forEach((b, k) => {
      if (k > i && Math.hypot(rig.head[a][0] - rig.head[b][0], rig.head[a][2] - rig.head[b][2]) < reach) group[find(i)] = find(k);
    });
  });
  const size = new Map<number, number>();
  tops.forEach((_, i) => size.set(find(i), (size.get(find(i)) ?? 0) + 1));
  return new Set(tops.filter((_, i) => size.get(find(i))! > 2));
}

/** 是不是脊柱的一节（Spine、Chest.002、UpperChest.003 …） */
export const isSpineBone = (name: string): boolean => SPINE_PART.test(baseName(name));

/** 把直立的人的姿势换成这副围成一圈的骨架上的（见文件开头）。骨架不是围成一圈的、旧记法的姿势原样返回 */
export function fitRing(solver: Solver, posing: Posing): Posing {
  if (posing.version === 1) return posing;
  const { names, parent, head } = solver.rig;
  const front = legsFront(solver.rig);
  const frames = posing.version === 2 ? solver.frames2 : solver.frames;
  // 每个人：接在胯上的一串脊柱；topOf 是一根骨骼顺着父骨骼往上、直接接在胯上的那一根
  const { pelvis, top: topOf, roots } = peopleOf(solver.rig);
  if (roots.length < 2) return posing;
  /** 用体块拼的（见文件开头） */
  const blocks = roots.some((root) => copied(names[root]));
  const packed = blocks ? packedLegs(solver.rig, pelvis) : new Set<number>();
  const outward = (p: V3): V3 | null => (Math.hypot(p[0], p[2]) > CENTER ? norm([p[0], 0, p[2]]) : null);
  // 每个人自己的朝向：Y 从腰到头，Z 是他脸朝的方向
  const bodies = roots.map((root): Quat | null => {
    const top = names.findIndex((name, j) => /^Head/.test(name) && topOf(j) === root);
    const out = outward(head[root]);
    const ahead = facingOf(solver.rig, root, topOf);
    // 用体块拼的：量出来的就是（见文件开头）；量不出来的（没有头的光胸腔）没有要照朝向套的骨骼
    if (blocks ? !ahead : !out) return null;
    const y = top >= 0 ? norm(sub(head[top], head[root])) : ([0, 1, 0] as V3);
    // 围成一圈：和从圈心朝外差着半圈以上的是量反了，翻过来；量不出来的照从圈心朝外
    let face = (ahead ?? out)!;
    if (!blocks && ahead && ahead[0] * out![0] + ahead[2] * out![2] < 0) face = [-ahead[0], 0, -ahead[2]];
    if (!blocks && !ahead) face = out!;
    const k = face[0] * y[0] + face[1] * y[1] + face[2] * y[2];
    const z = norm([face[0] - y[0] * k, face[1] - y[1] * k, face[2] - y[2] * k]);
    return basisQuat(cross(y, z), y, z);
  });
  const turned = (B: Quat | null, q: Quat, fromT: boolean): Quat => (B ? quatUnit(fromT ? quatMul(B, q) : quatMul(quatMul(B, q), quatConj(B))) : q);
  const bones: Record<string, Quat> = {};
  names.forEach((name, j) => {
    // 胯不转（复制出来的那几副也是）
    if (pelvis(j)) return;
    const base = baseName(name);
    const top = topOf(j);
    if (top < 0) return;
    const leg = LEG_PART.exec(base);
    if (leg && roots.indexOf(top) < 0) {
      const both = () => (posing.bones[`${leg[1]}_L`] || posing.bones[`${leg[1]}_R`] ? average(posing.bones[`${leg[1]}_L`], posing.bones[`${leg[1]}_R`]) : undefined);
      if (front) {
        // 统一朝前：照原样套，左右照这条腿长在整个身子的哪一边。挤成一堆的（见 packedLegs）都套左右两条的平均
        const x = head[top][0];
        const told = packed.has(top) || Math.abs(x) < CENTER ? both() : posing.bones[`${leg[1]}_${x > 0 ? 'L' : 'R'}`];
        if (told) bones[name] = told;
        return;
      }
      // 腿：照这条腿自己朝外的方向。用体块拼的没有圈心，照原样套
      const told = leg[2] ? posing.bones[base] : both();
      if (!told) return;
      if (blocks) {
        bones[name] = told;
        return;
      }
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
      // 手臂：照整个身子的左右（同一个人身上有好几条的，下面再照组分开）。从这根骨骼往上找到上臂，看它在哪一边
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
  const suffixOf2 = (name: string) => /\.\d{3}$/.exec(name)?.[0] ?? '';
  for (const tag of ['L', 'R']) {
    // 这种形状的手臂照长在谁身上分组（围成一圈每侧一组，前后排每侧两组）
    const groups = new Map<number, number[]>();
    names.forEach((name, j) => {
      if (baseName(name) !== `UpperArm_${tag}` || lowerOf(j) === undefined || !bones[name]) return;
      const top = topOf(j);
      groups.set(top, [...(groups.get(top) ?? []), j]);
    });
    for (const column of groups.values()) {
      if (column.length < 2) continue;
      const first = column[0];
      // 这个姿势里上臂朝哪（这一组的第一条摆成这样时）；每一条静止时朝哪（围成一圈时背不弯、胯不转，带着它的骨骼都没动）
      const posed = forward(solver.rig, stateOf(solver, { version: posing.version, bones } as Posing));
      const want = rotate(posed.rot[first], way(first, lowerOf(first)!));
      const off = (upper: number) => {
        const rest = way(upper, lowerOf(upper)!);
        return Math.acos(Math.max(-1, Math.min(1, rest[0] * want[0] + rest[1] * want[1] + rest[2] * want[2])));
      };
      const lead = column.reduce((a, b) => (off(b) < off(a) ? b : a));
      // 这一组第一条上的每根骨骼：最接近的那条正好摆成这样，别的相对自己静止时转同样多
      const told = Object.entries(bones).filter(([name]) => ARM_PART.exec(baseName(name))?.[3] === tag && suffixOf2(name) === suffixOf(first));
      for (const [name, pose] of told) {
        const base = baseName(name);
        const leading = index.get(base + suffixOf(lead));
        if (leading === undefined) continue;
        const turnedBy = quatMul(pose, quatConj(frames[leading]));
        for (const upper of column) {
          const own = index.get(base + suffixOf(upper));
          if (own !== undefined) bones[base + suffixOf(upper)] = upper === lead ? pose : quatUnit(quatMul(turnedBy, frames[own]));
        }
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
