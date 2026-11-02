/**
 * 写 VRM 0.x：一个带 VRM 扩展的 GLB，给 VTuber 软件（VSeeFace、Warudo…）、VRoid Hub、UniVRM、Blender 的 VRM 插件用。纯函数。
 *
 * VRM 0.x 的几条规矩（https://github.com/vrm-c/vrm-specification/tree/master/specification/0.0）：
 * - 静止姿势是 T-pose：手臂平举、手心朝下（调用的人先摆好再给进来）；
 * - 模型面朝 -Z：工坊里面朝 +Z，这里整个绕竖轴转 180°（左右手不变：角色自己的左手还是 leftHand）；
 * - 骨骼节点不带旋转，只有位置；
 * - 一张人形骨骼对照表：哪个节点是 hips、spine、leftUpperArm……
 * 工坊的骨骼名本来就照 VRM / Unity 的人形骨骼起（rig/skeleton.ts），一一对上。人形骨骼只有一套：
 * 第一对手臂、第一个头、第一对腿进对照表；多出来的手臂、头、腿和尾巴、翅膀挂在骨架上，跟着身体走，不进对照表。
 */
import type { V3 } from '../geometry/vec';
import type { Skeleton } from '../rig/skeleton';
import { writeGlb } from './glb';

/** 别人能怎么用：VRM 的许可名，和随之定下的几项「允许谁扮演、暴力、性、商用」 */
export const VRM_LICENSES = {
  private: { label: '只许自己用', license: 'Redistribution_Prohibited', allowed: 'OnlyAuthor', use: 'Disallow' },
  cc0: { label: '随便用（CC0）', license: 'CC0', allowed: 'Everyone', use: 'Allow' },
  ccby: { label: '署名就能用（CC BY）', license: 'CC_BY', allowed: 'Everyone', use: 'Allow' },
  ccbync: { label: '署名、不许商用（CC BY-NC）', license: 'CC_BY_NC', allowed: 'Everyone', use: 'Allow' },
} as const;
export type VrmLicense = keyof typeof VRM_LICENSES;

export interface VrmMeta {
  title: string;
  author: string;
  license: VrmLicense;
  /** 用到的素材要求的署名（二次元素体的脚、躯干），写进 reference 和文件的 copyright */
  credits?: string;
}

/** 一串会晃的骨骼（弹簧骨骼）：roots 是每串的第一根（下标照骨架），整串跟着晃 */
export interface VrmSpring {
  comment: string;
  roots: number[];
  /** 回到原样的劲、重力、阻力、末端多粗（米），照 VRM 0.x 的 boneGroups */
  stiffness: number;
  gravity: number;
  drag: number;
  hitRadius: number;
}

export interface VrmMesh {
  /** 顶点（米，面朝 +Z，T-pose）、法线、三角面、蒙皮 */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  joints: Uint16Array;
  weights: Float32Array;
  /** 底色（sRGB，0xRRGGBB） */
  color: number;
}

/** VRM 0.x 的人形骨骼名 → 工坊里的骨骼名（先试第一个；好几个上半身时脊柱、脖子带着在哪一边） */
const SLOTS: [string, string[]][] = [
  ['hips', ['Hips']],
  ['spine', ['Spine', 'Spine_L', 'Spine_R']],
  ['chest', ['Chest', 'Chest_L', 'Chest_R']],
  ['upperChest', ['UpperChest', 'UpperChest_L', 'UpperChest_R']],
  ['neck', ['Neck', 'Neck_L', 'Neck_R']],
  ['head', ['Head', 'Head_L', 'Head_R']],
  ['leftEye', ['Eye_L']],
  ['rightEye', ['Eye_R']],
  ...(['left', 'right'] as const).flatMap((side): [string, string[]][] => {
    const s = side === 'left' ? 'L' : 'R';
    const fingers: [string, string][] = [
      ['Thumb', 'Thumb'],
      ['Index', 'Index'],
      ['Middle', 'Middle'],
      ['Ring', 'Ring'],
      ['Little', 'Little'],
    ];
    return [
      [`${side}Shoulder`, [`Shoulder_${s}`]],
      [`${side}UpperArm`, [`UpperArm_${s}`]],
      [`${side}LowerArm`, [`LowerArm_${s}`]],
      [`${side}Hand`, [`Hand_${s}`]],
      [`${side}UpperLeg`, [`UpperLeg_${s}`]],
      [`${side}LowerLeg`, [`LowerLeg_${s}`]],
      [`${side}Foot`, [`Foot_${s}`]],
      [`${side}Toes`, [`Toes_${s}`]],
      ...fingers.flatMap(([vrm, ours]): [string, string[]][] =>
        (['Proximal', 'Intermediate', 'Distal'] as const).map((joint, k) => [`${side}${vrm}${joint}`, [`${ours}${k + 1}_${s}`]]),
      ),
    ];
  }),
];

/** VRM 0.x 一定要有的人形骨骼 */
const REQUIRED = ['hips', 'spine', 'chest', 'neck', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];

/** 人形骨骼的上下级：每根要长在哪几根下面（排在前面的、对上了的那一根） */
const UNDER: Record<string, string[]> = {
  spine: ['hips'],
  chest: ['spine'],
  upperChest: ['chest'],
  neck: ['upperChest', 'chest'],
  head: ['neck'],
  leftEye: ['head'],
  rightEye: ['head'],
  leftShoulder: ['upperChest', 'chest'],
  rightShoulder: ['upperChest', 'chest'],
  leftUpperArm: ['leftShoulder', 'upperChest', 'chest'],
  rightUpperArm: ['rightShoulder', 'upperChest', 'chest'],
  leftLowerArm: ['leftUpperArm'],
  rightLowerArm: ['rightUpperArm'],
  leftHand: ['leftLowerArm'],
  rightHand: ['rightLowerArm'],
  leftUpperLeg: ['hips'],
  rightUpperLeg: ['hips'],
  leftLowerLeg: ['leftUpperLeg'],
  rightLowerLeg: ['rightUpperLeg'],
  leftFoot: ['leftLowerLeg'],
  rightFoot: ['rightLowerLeg'],
  leftToes: ['leftFoot'],
  rightToes: ['rightFoot'],
};
for (const side of ['left', 'right']) {
  for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
    UNDER[`${side}${finger}Proximal`] = [`${side}Hand`];
    UNDER[`${side}${finger}Intermediate`] = [`${side}${finger}Proximal`];
    UNDER[`${side}${finger}Distal`] = [`${side}${finger}Intermediate`];
  }
}

/** 少了哪根人形骨骼时给人看的说法 */
const MISSING: Record<string, string> = {
  hips: '胯',
  spine: '腰',
  chest: '胸腔',
  neck: '脖子',
  head: '头',
  leftUpperArm: '左手臂',
  leftLowerArm: '左前臂',
  leftHand: '左手',
  rightUpperArm: '右手臂',
  rightLowerArm: '右前臂',
  rightHand: '右手',
  leftUpperLeg: '左腿',
  leftLowerLeg: '左小腿',
  leftFoot: '左脚',
  rightUpperLeg: '右腿',
  rightLowerLeg: '右小腿',
  rightFoot: '右脚',
};

/**
 * 人形骨骼对照表：VRM 的骨骼名 → 骨架里的下标。每根都要长在它的上级下面（不一定紧挨着）；
 * 可有可无的对不上就不放，一定要有的对不上就报错，说清楚是缺了哪一块。
 * 先认不带序号的名字，长的地方不对再认带序号的（.002…）：好几个上半身时，第一个上半身上的脖子、
 * 里侧的手臂是 Neck.002、UpperArm_R.002 这样的名字，这样整套都从同一个上半身上取
 */
export function humanoidMap(skeleton: Skeleton): Map<string, number> {
  const { bones } = skeleton;
  const isUnder = (child: number, ancestor: number) => {
    for (let at = bones[child].parent; at >= 0; at = bones[at].parent) if (at === ancestor) return true;
    return false;
  };
  const base = (name: string) => name.replace(/\.\d+$/, '');
  const map = new Map<string, number>();
  for (const [slot, names] of SLOTS) {
    const ups = (UNDER[slot] ?? []).map((up) => map.get(up)).filter((i): i is number => i !== undefined);
    const fits = (i: number) => ups.length === 0 || isUnder(i, ups[0]);
    const exact = names.map((name) => bones.findIndex((b) => b.name === name));
    const numbered = names.flatMap((name) => bones.flatMap((b, i) => (b.name !== name && base(b.name) === name ? [i] : [])));
    const pick = [...exact, ...numbered].find((i) => i >= 0 && fits(i));
    if (pick !== undefined) map.set(slot, pick);
  }
  const missing = REQUIRED.filter((slot) => !map.has(slot));
  if (missing.length) {
    throw new Error(`VRM 要一副完整的人形骨骼，这个身体缺：${missing.map((slot) => MISSING[slot] ?? slot).join('、')}（VRM 只认一个头、一对手臂、一对腿的那一套）`);
  }
  return map;
}

/** 绕竖轴转 180°：面朝 +Z 变成面朝 -Z */
const turn = (p: V3): V3 => [-p[0], p[1], -p[2]];
function turnArray(a: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 3) {
    out[i] = -a[i];
    out[i + 1] = a[i + 1];
    out[i + 2] = -a[i + 2];
  }
  return out;
}

/** sRGB 的一个通道（0–255）→ 线性 */
const linear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** 单色的 MToon（VRM 的卡通材质）：亮面是底色，暗面暗一些，没有描边 */
function mtoon(name: string, color: number) {
  const lit = [linear((color >> 16) & 255), linear((color >> 8) & 255), linear(color & 255), 1];
  const shade = [lit[0] * 0.62, lit[1] * 0.64, lit[2] * 0.7, 1];
  return {
    name,
    shader: 'VRM/MToon',
    renderQueue: 2000,
    floatProperties: {
      _Cutoff: 0.5,
      _BumpScale: 1,
      _ReceiveShadowRate: 1,
      _ShadingGradeRate: 1,
      _ShadeShift: -0.1,
      _ShadeToony: 0.75,
      _LightColorAttenuation: 0,
      _IndirectLightIntensity: 0.1,
      _RimLightingMix: 0,
      _RimFresnelPower: 1,
      _RimLift: 0,
      _OutlineWidth: 0,
      _OutlineScaledMaxDistance: 1,
      _OutlineLightingMix: 1,
      _UvAnimScrollX: 0,
      _UvAnimScrollY: 0,
      _UvAnimRotation: 0,
      _MToonVersion: 38,
      _DebugMode: 0,
      _BlendMode: 0,
      _OutlineWidthMode: 0,
      _OutlineColorMode: 0,
      _CullMode: 2,
      _OutlineCullMode: 1,
      _SrcBlend: 1,
      _DstBlend: 0,
      _ZWrite: 1,
      _AlphaToMask: 0,
    },
    vectorProperties: {
      _Color: lit,
      _ShadeColor: shade,
      _MainTex: [0, 0, 1, 1],
      _ShadeTexture: [0, 0, 1, 1],
      _EmissionColor: [0, 0, 0, 1],
      _RimColor: [0, 0, 0, 1],
      _OutlineColor: [0, 0, 0, 1],
    },
    textureProperties: {},
    keywordMap: {},
    tagMap: { RenderType: 'Opaque' },
  };
}

/** lookAt 的曲线（没有眼睛骨骼时用不上，但 VRM 0.x 要求写着） */
const CURVE = { curve: [0, 0, 0, 1, 1, 1, 1, 0], xRange: 90, yRange: 10 };

/**
 * 写成 VRM 0.x。mesh、skeleton 是 T-pose、面朝 +Z、米；springs 是会晃的几串骨骼。
 * 一定要有的人形骨骼对不上时报错（见 humanoidMap）
 */
export function writeVrm(mesh: VrmMesh, skeleton: Skeleton, meta: VrmMeta, springs: VrmSpring[] = []): ArrayBuffer {
  const humanoid = humanoidMap(skeleton);
  const turned: Skeleton = { bones: skeleton.bones.map((b) => ({ ...b, head: turn(b.head), tail: turn(b.tail) })) };
  const material = 'OC_Clay';
  const terms = VRM_LICENSES[meta.license];
  // 节点的下标：骨骼照骨架的顺序排在最前面，网格是下一个（见 writeGlb）
  const head = humanoid.get('head')!;
  const vrm = {
    exporterVersion: 'OC Basemesh Workshop v2',
    specVersion: '0.0',
    meta: {
      title: meta.title,
      version: '1.0',
      author: meta.author,
      contactInformation: '',
      reference: meta.credits ?? '',
      allowedUserName: terms.allowed,
      violentUssageName: terms.use,
      sexualUssageName: terms.use,
      commercialUssageName: meta.license === 'ccbync' ? 'Disallow' : terms.use,
      otherPermissionUrl: '',
      licenseName: terms.license,
      otherLicenseUrl: '',
    },
    humanoid: {
      humanBones: [...humanoid].map(([bone, node]) => ({ bone, node, useDefaultValues: true })),
      armStretch: 0.05,
      legStretch: 0.05,
      upperArmTwist: 0.5,
      lowerArmTwist: 0.5,
      upperLegTwist: 0.5,
      lowerLegTwist: 0.5,
      feetSpacing: 0,
      hasTranslationDoF: false,
    },
    firstPerson: {
      firstPersonBone: head,
      firstPersonBoneOffset: { x: 0, y: 0.06, z: 0 },
      meshAnnotations: [{ mesh: 0, firstPersonFlag: 'Auto' }],
      lookAtTypeName: 'Bone',
      lookAtHorizontalInner: CURVE,
      lookAtHorizontalOuter: CURVE,
      lookAtVerticalDown: CURVE,
      lookAtVerticalUp: CURVE,
    },
    blendShapeMaster: { blendShapeGroups: [] },
    secondaryAnimation: {
      boneGroups: springs
        .filter((s) => s.roots.length)
        .map((s) => ({
          comment: s.comment,
          stiffiness: s.stiffness,
          gravityPower: s.gravity,
          gravityDir: { x: 0, y: -1, z: 0 },
          dragForce: s.drag,
          center: -1,
          hitRadius: s.hitRadius,
          bones: s.roots,
          colliderGroups: [],
        })),
      colliderGroups: [],
    },
    materialProperties: [mtoon(material, mesh.color)],
  };
  return writeGlb(
    [
      {
        name: 'OC_Body',
        positions: turnArray(mesh.positions),
        normals: turnArray(mesh.normals),
        indices: mesh.indices,
        joints: mesh.joints,
        weights: mesh.weights,
        material: { name: material, color: mesh.color },
      },
    ],
    {
      skeleton: turned,
      rigName: 'OC_Rig',
      boneAxes: 'none',
      ...(meta.credits ? { copyright: meta.credits } : {}),
      extensions: { used: ['VRM'], data: { VRM: vrm } },
    },
  );
}
