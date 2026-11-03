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
import { type GlbContext, type GlbImage, type GlbMaterial, type GlbMesh, writeGlb } from './glb';

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

/** VRM 0.x 一个材质的卡通着色（MToon）设定，照 materialProperties 的写法；textureProperties 的值是图片在 images 里的下标 */
export interface VrmToon {
  shader: string;
  renderQueue: number;
  floatProperties: Record<string, number>;
  vectorProperties: Record<string, number[]>;
  textureProperties: Record<string, number>;
  keywordMap: Record<string, boolean>;
  tagMap: Record<string, string>;
}

/** 材质的底色（线性 RGBA）：给了 factor 用它，不然照 color 换 */
export const materialColor = (m: GlbMaterial): number[] =>
  m.factor ? [...m.factor] : [linear((m.color >> 16) & 255), linear((m.color >> 8) & 255), linear(m.color & 255), 1];

/**
 * 照材质自己的样子配一份 MToon：亮面是底色（有贴图就是贴图乘底色），暗面暗一些，没有描边；
 * 透明、镂空、双面照材质的设定
 */
export function plainToon(m: GlbMaterial): VrmToon {
  const lit = materialColor(m);
  const shade = [lit[0] * 0.62, lit[1] * 0.64, lit[2] * 0.7, lit[3]];
  const mode = m.alphaMode ?? 'OPAQUE';
  const blend = mode === 'BLEND';
  return {
    shader: 'VRM/MToon',
    renderQueue: blend ? 3000 : mode === 'MASK' ? 2450 : 2000,
    floatProperties: {
      _Cutoff: m.alphaCutoff ?? 0.5,
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
      _BlendMode: blend ? 2 : mode === 'MASK' ? 1 : 0,
      _OutlineWidthMode: 0,
      _OutlineColorMode: 0,
      _CullMode: m.doubleSided ? 0 : 2,
      _OutlineCullMode: 1,
      _SrcBlend: blend ? 5 : 1,
      _DstBlend: blend ? 10 : 0,
      _ZWrite: blend ? 0 : 1,
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
    textureProperties: m.image === undefined ? {} : { _MainTex: m.image, _ShadeTexture: m.image },
    keywordMap: blend ? { _ALPHABLEND_ON: true } : mode === 'MASK' ? { _ALPHATEST_ON: true } : {},
    tagMap: { RenderType: blend ? 'Transparent' : mode === 'MASK' ? 'TransparentCutout' : 'Opaque' },
  };
}

/** lookAt 的曲线：输入转 90°（xRange）时眼珠转 range 度（yRange） */
const curve = (range: number) => ({ curve: [0, 0, 0, 1, 1, 1, 1, 0], xRange: 90, yRange: range });

/** 一个表情组（VRM 0.x 的 blendShapeGroup）：开哪个物体的哪几个形态键、开到多少（0–1） */
export interface VrmExpression {
  name: string;
  /** VRM 规定的名字（joy、blink_l、a …）；不是规定的写 unknown */
  preset: string;
  binds: { object: string; target: number; weight: number }[];
}

/** 一个完整的 VRM：网格、贴图、骨架都是 T-pose、面朝 +Z、米 */
export interface VrmModel {
  meshes: GlbMesh[];
  images?: GlbImage[];
  skeleton: Skeleton;
  /** VRM 0.x 的 meta，除了缩略图（见 thumbnail）都写全 */
  meta: Record<string, unknown>;
  /** 缩略图在 images 里的下标 */
  thumbnail?: number;
  /** 写进文件 asset.copyright 的署名 */
  copyright?: string;
  /** 每个材质的卡通着色 */
  toon(material: GlbMaterial): VrmToon;
  expressions?: VrmExpression[];
  /** 眼珠最多转多少度（往外、往里、往下、往上）；没有眼睛骨骼就不给 */
  look?: { outer: number; inner: number; down: number; up: number };
  springs?: VrmSpring[];
}

/** 写成 VRM 0.x。一定要有的人形骨骼对不上时报错（见 humanoidMap） */
export function writeVrmModel(model: VrmModel): ArrayBuffer {
  const { skeleton, look, springs = [], expressions = [] } = model;
  const humanoid = humanoidMap(skeleton);
  const turned: Skeleton = { bones: skeleton.bones.map((b) => ({ ...b, head: turn(b.head), tail: turn(b.tail) })) };
  // 每块网格都记上属于哪个物体（没给的就是它自己）：表情组、第一人称要照物体找网格
  const meshes: GlbMesh[] = model.meshes.map((m) => ({
    ...m,
    object: m.object ?? m.name,
    positions: turnArray(m.positions),
    ...(m.normals ? { normals: turnArray(m.normals) } : {}),
    ...(m.targets ? { targets: m.targets.map((t) => ({ name: t.name, positions: turnArray(t.positions) })) } : {}),
  }));
  const objects = [...new Set(meshes.map((m) => m.object ?? m.name))];
  // 节点的下标：骨骼照骨架的顺序排在最前面，网格是后面几个（见 writeGlb）
  const head = humanoid.get('head')!;
  const data = (context: GlbContext) => ({
    VRM: {
      exporterVersion: 'OC Basemesh Workshop v2',
      specVersion: '0.0',
      meta: { ...model.meta, ...(model.thumbnail === undefined ? {} : { texture: context.texture(model.thumbnail) }) },
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
        meshAnnotations: objects.map((object) => ({ mesh: context.meshOf(object), firstPersonFlag: 'Auto' })),
        lookAtTypeName: 'Bone',
        lookAtHorizontalInner: curve(look?.inner ?? 10),
        lookAtHorizontalOuter: curve(look?.outer ?? 10),
        lookAtVerticalDown: curve(look?.down ?? 10),
        lookAtVerticalUp: curve(look?.up ?? 10),
      },
      blendShapeMaster: {
        blendShapeGroups: expressions.map((e) => ({
          name: e.name,
          presetName: e.preset,
          binds: e.binds.map((b) => ({ mesh: context.meshOf(b.object), index: b.target, weight: Math.round(b.weight * 1000) / 10 })),
          materialValues: [],
          isBinary: false,
        })),
      },
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
      // 和文件里的材质一一对应；贴图那几项从图片下标换成贴图下标
      materialProperties: context.materials.map((m) => {
        const toon = model.toon(m);
        return {
          name: m.name,
          ...toon,
          textureProperties: Object.fromEntries(Object.entries(toon.textureProperties).map(([key, image]) => [key, context.texture(image)])),
        };
      }),
    },
  });
  return writeGlb(meshes, {
    skeleton: turned,
    rigName: 'OC_Rig',
    boneAxes: 'none',
    ...(model.images ? { images: model.images } : {}),
    ...(model.copyright ? { copyright: model.copyright } : {}),
    extensions: { used: ['VRM'], data },
  });
}

/** 白模填的那几项 → VRM 0.x 的 meta */
export function licenseMeta(meta: VrmMeta): Record<string, unknown> {
  const terms = VRM_LICENSES[meta.license];
  return {
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
  };
}

/**
 * 白模写成 VRM 0.x：一整块单色的网格。mesh、skeleton 是 T-pose、面朝 +Z、米；springs 是会晃的几串骨骼。
 * 一定要有的人形骨骼对不上时报错（见 humanoidMap）
 */
export function writeVrm(mesh: VrmMesh, skeleton: Skeleton, meta: VrmMeta, springs: VrmSpring[] = []): ArrayBuffer {
  return writeVrmModel({
    meshes: [
      {
        name: 'OC_Body',
        positions: mesh.positions,
        normals: mesh.normals,
        indices: mesh.indices,
        joints: mesh.joints,
        weights: mesh.weights,
        material: { name: 'OC_Clay', color: mesh.color },
      },
    ],
    skeleton,
    meta: licenseMeta(meta),
    ...(meta.credits ? { copyright: meta.credits } : {}),
    toon: plainToon,
    springs,
  });
}

/** 原角色的许可说成人话（导出前的小框里给人看）：许可名，再加上几条「不许」 */
export function describeLicense(meta: Record<string, unknown>): string {
  const names: Record<string, string> = {
    CC0: 'CC0（随便用）',
    CC_BY: 'CC BY（要署名）',
    CC_BY_NC: 'CC BY-NC（要署名、不许商用）',
    CC_BY_SA: 'CC BY-SA（要署名，改过的也只能用这个许可）',
    CC_BY_NC_SA: 'CC BY-NC-SA（要署名、不许商用，改过的也只能用这个许可）',
    CC_BY_ND: 'CC BY-ND（要署名、不许改）',
    CC_BY_NC_ND: 'CC BY-NC-ND（要署名、不许商用、不许改）',
    Redistribution_Prohibited: '不许再分发',
    Other: '原作者自己写的条件',
  };
  const license = typeof meta.licenseName === 'string' ? meta.licenseName : '';
  const notes = [
    names[license] ?? (license || '没写许可'),
    meta.allowedUserName === 'OnlyAuthor' ? '只许作者本人扮演' : '',
    meta.violentUssageName === 'Disallow' ? '不许用于暴力表现' : '',
    meta.sexualUssageName === 'Disallow' ? '不许用于性表现' : '',
    meta.commercialUssageName === 'Disallow' ? '不许商用' : '',
  ];
  return notes.filter(Boolean).join('，');
}
