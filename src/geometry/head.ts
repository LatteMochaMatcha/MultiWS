/**
 * 头：颅骨球 + 下颌的楔形 + 鼻子的小凸起，眼窝是挖出来的浅坑。
 * 眼睛、角、耳朵都贴着头的真实表面放：先把头自己编译成距离场，再朝它打射线找表面。
 *
 * 头的局部坐标：原点在头的正中，头顶在 +HEAD_HALF_HEIGHT，下巴在 -HEAD_HALF_HEIGHT，脸朝 +Z。
 */
import type { BodyCounts, EarShape, Gender } from '../model/spec';
import { type CompiledField, castRay, compileField } from '../sdf/field';
import { type Part, type Prim, nthName } from './figure';
import { type Skull, type WigSpec, wigPart } from './wig';
import { type Quat, type V3, Q_ID, UP, add, madd, norm, quatBetween, quatEuler, rotate, sub } from './vec';

/** 头顶、下巴离头中心的距离（头身比缩放之前） */
export const HEAD_HALF_HEIGHT = 0.115;
/** 头最宽处的半宽 */
export const HEAD_HALF_WIDTH = 0.082;

const O: V3 = [0, 0, 0];
const DEG = Math.PI / 180;
const SIDES = [1, -1] as const;
type LR = (typeof SIDES)[number];
const pad = (n: number) => String(n).padStart(2, '0');
const tag = (side: number) => (side > 0 ? 'L' : 'R');

/** 颅骨的中心：比头的正中靠上、靠后一点 */
export const CRANIUM: V3 = [0, 0.03, -0.012];
const CRANIUM_RADII: V3 = [HEAD_HALF_WIDTH, 0.085, 0.092];
/** 白模的颅骨：头发照它的大小戴上去（见 wig.ts） */
export const SKULL: Skull = { center: CRANIUM, radii: CRANIUM_RADII };

/** 这个头戴的头发：哪一副、多长多蓬，照哪个颅骨戴 */
export interface HeadHair {
  spec: WigSpec;
  skull: Skull;
}

/** 头的体块。ears：哪一侧加一只人耳的小凸起（没有兽耳、那一侧也没挨着别的头时才加）；男性的下颌更宽、下巴更方 */
function headMasses(ears: { left: boolean; right: boolean }, gender: Gender = 'female'): Prim[] {
  const male = gender === 'male';
  // 下巴那一端的半径；下巴尖正好落在 -HEAD_HALF_HEIGHT
  const chin = male ? 0.038 : 0.03;
  const prims: Prim[] = [
    { kind: 'ellipsoid', name: 'Cranium', center: CRANIUM, radii: CRANIUM_RADII },
    // 下颌：从颧骨往下巴收窄的楔形
    {
      kind: 'cone',
      name: 'Jaw',
      a: [0, -0.02, 0.014],
      b: [0, chin - HEAD_HALF_HEIGHT, 0.05],
      ra: male ? 0.074 : 0.07,
      rb: chin,
      soft: 0.035,
    },
    { kind: 'ellipsoid', name: 'Nose', center: [0, -0.024, 0.086], radii: [0.006, 0.01, 0.009], soft: 0.012 },
  ];
  for (const s of SIDES) {
    if (s > 0 ? ears.left : ears.right) {
      prims.push({
        kind: 'ellipsoid',
        name: `Ear_${tag(s)}`,
        center: [s * 0.08, -0.008, -0.006],
        radii: [0.008, 0.026, 0.016],
        soft: 0.008,
      });
    }
  }
  return prims;
}

/** 不带人耳的头的距离场（找表面用）。头的体块是固定的，算一次就够 */
let bareHead: CompiledField | null = null;
function headField(): CompiledField {
  bareHead ??= compileField(
    { scale: 1, parts: [{ name: 'Head', type: 'head', side: 0, pos: O, quat: Q_ID, material: 'clay', prims: headMasses({ left: false, right: false }) }] },
    { blend: 0 },
  );
  return bareHead;
}

/** 从外面朝 target 打一条射线，返回它落在头表面上的点 */
function hit(field: CompiledField, from: V3, target: V3): V3 {
  const dir = norm([target[0] - from[0], target[1] - from[1], target[2] - from[2]]);
  return madd(from, dir, castRay(field, from, dir, 0.6));
}

/** 脸上 (x, y) 处的表面 */
const faceAt = (field: CompiledField, x: number, y: number): V3 => hit(field, [x, y, 0.3], [x, y, 0]);
/** 头顶 (x, z) 处的表面 */
const topAt = (field: CompiledField, x: number, z: number): V3 => hit(field, [x, 0.3, z], [x, 0, z]);
/** 从颅骨中心朝 dir 方向看出去碰到的头皮 */
const scalpAt = (field: CompiledField, dir: V3, z: number): V3 =>
  hit(field, madd([0, CRANIUM[1], z], dir, 0.3), [0, CRANIUM[1], z]);

/** 眼睛的位置：成对排成行，从下往上；单数时在最上面正中再加一只 */
function eyeSpots(n: number): { x: number; y: number; tag: string }[] {
  if (n === 1) return [{ x: 0, y: 0.012, tag: 'C' }];
  const spots: { x: number; y: number; tag: string }[] = [];
  const pairs = Math.floor(n / 2);
  for (let p = 0; p < pairs; p++) {
    const y = 0.005 + p * 0.034;
    const x = 0.037 - p * 0.006;
    spots.push({ x, y, tag: `${pad(p + 1)}_L` }, { x: -x, y, tag: `${pad(p + 1)}_R` });
  }
  if (n % 2) spots.push({ x: 0, y: 0.005 + pairs * 0.034, tag: 'C' });
  return spots;
}

interface EarForm {
  points: V3[];
  r0: number;
  r1: number;
  bulge: number;
  /** 前后方向压扁到多少 */
  flat: number;
}

/**
 * 四种耳朵的外形：一条略弯的中心线，半径沿线变化，再前后压扁成片。
 * 中心线写的是角色左耳（x 朝外）；右耳把 x 取反。第一个点埋在头里面，封口的球不会从头皮下面鼓出来。
 */
const EAR_FORMS: Record<EarShape, EarForm> = {
  // 猫耳：矮而宽的三角，耳尖略微朝外、朝前
  cat: {
    points: [[0, -0.03, 0], [0, 0.015, 0], [0.004, 0.048, 0.004], [0.01, 0.074, 0.01]],
    r0: 0.029,
    r1: 0.005,
    bulge: 0.006,
    flat: 0.5,
  },
  // 狐耳：更高更尖，中段最宽，像一片叶子
  fox: {
    points: [[0, -0.03, 0], [0, 0.03, 0], [0.006, 0.072, 0.002], [0.016, 0.108, 0.006]],
    r0: 0.026,
    r1: 0.004,
    bulge: 0.013,
    flat: 0.5,
  },
  // 兔耳：细长，整体向后弯，耳尖是圆的
  rabbit: {
    points: [[0, -0.03, 0], [0, 0.06, -0.004], [0.004, 0.125, -0.014], [0.01, 0.185, -0.034]],
    r0: 0.016,
    r1: 0.011,
    bulge: 0.013,
    flat: 0.55,
  },
  // 精灵耳：长而尖，耳尖上挑
  elf: {
    points: [[0, -0.02, 0], [0, 0.04, 0], [-0.006, 0.085, 0], [-0.02, 0.128, 0]],
    r0: 0.017,
    r1: 0.003,
    bulge: 0.005,
    flat: 0.5,
  },
};

/**
 * 一只耳朵在头上的位置和朝向。crowded：旁边还有别的头，第二对耳朵不能往外倒得太平；
 * squeezed：这一侧紧挨着别的头，耳朵往头顶中间靠、竖直着长，不然会和隔壁的耳朵糊在一起
 */
function earPlacement(
  field: CompiledField,
  shape: EarShape,
  pair: number,
  side: LR,
  hasHorns: boolean,
  crowded: boolean,
  squeezed: boolean,
): { pos: V3; quat: Quat } {
  if (shape === 'elf') {
    // 长在人耳的位置，向外、向后伸；第二对在下面一点，更平
    const around = (110 + pair * 22) * DEG;
    const at = scalpAt(field, [side * Math.sin(around), Math.cos(around), 0], -0.008);
    const dir = norm(crowded ? [side * 0.45, 0.45 - pair * 0.5, -0.8] : [side * 0.8, 0.45 - pair * 0.5, -0.4]);
    return { pos: madd(at, [side, 0, 0], -0.01), quat: quatBetween(UP, dir) };
  }
  // 长在头顶两侧；有角时往外让一让
  const upright = shape === 'rabbit';
  const firstAround = Math.min((upright ? 26 : 36) + (hasHorns ? 20 : 0), squeezed ? 30 : 90);
  // 旁边还有别的头时耳朵竖得直一些，免得和邻居的耳朵交叉
  const firstLean = Math.min((upright ? 0.2 : 0.38) + (hasHorns ? 0.32 : 0), squeezed ? 0.1 : crowded ? 0.32 : 9);
  let around = firstAround;
  let lean = firstLean;
  // 有角时耳朵往前一点、少往后倒，和往后弯的角错开
  let z = hasHorns ? -0.002 : -0.012;
  let back = hasHorns ? -0.04 : -0.12;
  if (pair > 0 && crowded) {
    // 旁边还有别的头，头顶也可能被角占着：第二对长在后脑勺两侧，朝后伸
    const out = norm([side * 0.55, 0.25, -0.8]);
    const at = hit(field, madd(CRANIUM, out, 0.3), CRANIUM);
    return { pos: madd(at, out, -0.012), quat: quatBetween(UP, norm([side * 0.25, 0.1, -0.96])) };
  }
  if (pair > 0) {
    // 第二对在更靠下的侧面，更往外倒
    around = upright ? 66 : 72;
    lean = upright ? 0.8 : 1.05;
    z = -0.022;
  }
  const out: V3 = [side * Math.sin(around * DEG), Math.cos(around * DEG), 0];
  return { pos: madd(scalpAt(field, out, z), out, -0.012), quat: quatEuler(back, 0, -side * lean) };
}

/** 不用白模自己捏的头，换一个现成的：它的基本体，以及用来贴着表面放角、耳朵的距离场 */
export interface CustomHead {
  prims: Prim[];
  field: CompiledField;
}

/**
 * 这个头怎么接：这是第几个头（从 0 数），脖子顶端在头自己的坐标里的位置（头的骨骼从这里开始），
 * 以及哪一侧挨着别的头（left 是角色的左手边）。
 */
export interface HeadRig {
  index: number;
  neckTop: V3;
  beside?: { left: boolean; right: boolean };
}

/**
 * 同一个头上多出来的一张脸（「三面」里朝两边、朝后的那几张）：
 * 一整个头绕颅骨的竖轴转过去，再顺着它自己朝的方向往外挪一点，大半埋在正面那个头里，露出来的就是一张脸。
 * 它是正面那个头（parent）的子部件：没有自己的骨骼，整个跟着那个头动；角和耳朵都只长在正面那个头上。
 * pivot：颅骨的竖轴在头自己坐标里的位置；out：往外挪多少。
 */
export function makeFace(
  name: string,
  parent: string,
  turn: number,
  pivot: V3,
  out: number,
  c: BodyCounts,
  earShape: EarShape,
  gender: Gender,
  index: number,
  custom?: CustomHead,
): Part[] {
  const quat = quatEuler(0, turn, 0);
  const pos = add(sub(pivot, rotate(quat, pivot)), rotate(quat, [0, 0, out]));
  const rig: HeadRig = { index, neckTop: O, beside: { left: true, right: true } };
  const made = makeHead(name, parent, pos, quat, 1, { ...c, hornsPerHead: 0, earPairsPerHead: 0 }, earShape, gender, rig, custom);
  delete made[0].bones;
  return made;
}

/**
 * 一个头，连同它的眼睛、角、耳朵。
 * scale 是头身比带来的缩放，眼睛、角、耳朵跟着头一起缩放。
 */
export function makeHead(
  name: string,
  parent: string,
  pos: V3,
  quat: Quat,
  scale: number,
  c: BodyCounts,
  earShape: EarShape,
  gender: Gender = 'female',
  rig: HeadRig = { index: 0, neckTop: [0, -0.1, 0] },
  custom?: CustomHead,
  hair?: HeadHair,
): Part[] {
  const crowded = c.heads > 1;
  // 现成的头：形状和五官都是它自带的，不另外挖眼窝、放眼睛；角和耳朵贴着它的表面放
  const field = custom?.field ?? headField();
  const spots = custom ? [] : eyeSpots(c.eyesPerHead).map((s) => ({ ...s, at: faceAt(field, s.x, s.y) }));
  // 头发：戴上以后，角和兽耳就贴着头发的外面长，不然大半截埋在头发里
  const wig = hair ? wigPart(name, hair.spec, hair.skull) : null;
  const crown =
    wig && (c.hornsPerHead || c.earPairsPerHead)
      ? compileField(
          {
            scale: 1,
            parts: [
              { name, type: 'head', side: 0, pos: O, quat: Q_ID, material: 'clay', prims: custom?.prims ?? headMasses({ left: false, right: false }, gender) },
              wig,
            ],
          },
          { blend: 0 },
        )
      : field;
  const headBone = nthName('Head', rig.index);
  const head: Part = {
    name,
    type: 'head',
    side: 0,
    parent,
    pos,
    quat,
    scale,
    material: 'clay',
    // 头的骨骼：从脖子顶端到头顶
    bones: [
      { name: headBone, parent: nthName('Neck', rig.index), head: rig.neckTop, tail: [0, HEAD_HALF_HEIGHT - 0.012, CRANIUM[2]] },
    ],
    prims: custom
      ? custom.prims
      : [
          ...headMasses({ left: c.earPairsPerHead === 0 && !rig.beside?.left, right: c.earPairsPerHead === 0 && !rig.beside?.right }, gender),
          // 眼窝：在每只眼睛的位置挖一个浅坑
          ...spots.map(
            (s): Prim => ({
              kind: 'ellipsoid',
              name: `Socket_${s.tag}`,
              center: [s.at[0], s.at[1], s.at[2] + 0.006],
              radii: [0.019, 0.013, 0.012],
              cut: true,
              soft: 0.008,
            }),
          ),
        ],
  };
  const parts: Part[] = [head];

  for (const s of spots) {
    parts.push({
      name: `${name}_Eye_${s.tag}`,
      type: 'eye',
      side: s.x > 0 ? 1 : s.x < 0 ? -1 : 0,
      parent: name,
      pos: [s.at[0], s.at[1], s.at[2] - 0.005],
      // 眼睛贴着脸的弧度略微朝外
      quat: quatEuler(0, Math.atan2(1.2 * s.x, 1 - s.at[2]), 0),
      material: 'eye',
      prims: [{ kind: 'ellipsoid', name: 'Eye', center: O, radii: [0.014, 0.011, 0.005] }],
    });
  }

  // 角：单数时额头正中一只，其余成对往两侧、往后排
  const horn = (hornName: string, side: -1 | 0 | 1, at: V3, offsets: V3[]) => {
    parts.push({
      name: `${name}_Horn_${hornName}`,
      type: 'horn',
      side,
      parent: name,
      pos: [at[0], at[1] - 0.012, at[2]],
      quat: Q_ID,
      material: 'clay',
      prims: [{ kind: 'tube', name: 'Horn', points: [O, ...offsets], r0: 0.017, r1: 0.002, bulge: 0 }],
    });
  };
  if (c.hornsPerHead % 2) {
    horn('C', 0, topAt(crown, 0, 0.035), [[0, 0.06, 0.035], [0, 0.13, 0.06]]);
  }
  /** 这一侧是不是紧挨着别的头 */
  const squeezed = (s: LR) => Boolean(s > 0 ? rig.beside?.left : rig.beside?.right);
  // 头顶还长着兽耳时，角往后挪一点，把前面的位置让给耳朵
  const hornBack = c.earPairsPerHead > 0 && earShape !== 'elf' ? 0.024 : 0;
  for (let p = 0; p < Math.floor(c.hornsPerHead / 2); p++) {
    for (const s of SIDES) {
      // 紧挨着别的头的那一侧，角收拢着往上、往后长，不往旁边撇，免得和隔壁的角交叉
      const out = s * (squeezed(s) ? 0.25 : 1);
      horn(`${pad(p + 1)}_${tag(s)}`, s, topAt(crown, s * (0.038 + p * 0.018), -0.012 - p * 0.03 - hornBack), [
        [out * 0.025, 0.06, -0.025],
        [out * 0.05, 0.1, -0.09],
        [out * 0.055, 0.12, -0.15],
      ]);
    }
  }

  const form = EAR_FORMS[earShape];
  for (let p = 0; p < c.earPairsPerHead; p++) {
    for (const s of SIDES) {
      // 精灵耳长在人耳的位置，正好是两个头贴着的地方：紧挨着别的头的那一侧不长
      if (earShape === 'elf' && squeezed(s)) continue;
      const at = earPlacement(crown, earShape, p, s, c.hornsPerHead > 1, crowded, squeezed(s));
      const points = form.points.map((q): V3 => [q[0] * s, q[1], q[2]]);
      parts.push({
        name: `${name}_Ear_${pad(p + 1)}_${tag(s)}`,
        type: 'ear',
        side: s,
        parent: name,
        pos: at.pos,
        quat: at.quat,
        stretch: [1, 1, form.flat],
        material: 'clay',
        prims: [{ kind: 'tube', name: 'Ear', points, r0: form.r0, r1: form.r1, bulge: form.bulge }],
        // 一根骨骼，从耳根到耳尖（做会晃的耳朵时用得上）
        bones: [
          { name: nthName(`Ear_${pad(p + 1)}_${tag(s)}`, rig.index), parent: headBone, head: O, tail: points[points.length - 1] },
        ],
      });
    }
  }
  if (wig) parts.push(wig);
  return parts;
}
