/**
 * 成品角色的原始数据：从 VRM 文件（就是带扩展的 GLB，0.x 和 1.0 都认）里读出网格、贴图、骨骼和蒙皮。
 * 读出来的东西换成工坊的约定：单位米，Y 朝上，角色面朝 +Z，角色自己的左手边是 +X。
 * 骨骼、材质照 VRoid 的起名认（J_Bip_C_Hips、…_SKIN）；别的软件做的 VRM，骨骼照文件里的人形骨骼对照表换成 VRoid 的名字。
 *
 * 纯函数，不依赖浏览器：贴图只取原始的图片字节，显示时再由界面那边解码。
 */
import type { V3 } from '../geometry/vec';
import { type GlbDoc, readAccessor, readBufferView, readGlb } from '../io/glbRead';
import type { VrmToon } from '../io/vrm';

export interface SourceBone {
  /** 文件里的骨骼名，例如 J_Bip_L_UpperArm */
  name: string;
  /** 父骨骼的下标，根骨骼是 -1 */
  parent: number;
  /** 关节在静止姿势（T-pose）里的位置。VRM 0.x 的骨骼在静止姿势下都不带旋转 */
  pos: V3;
}

export type AlphaMode = 'OPAQUE' | 'MASK' | 'BLEND';

export interface SourceMaterial {
  name: string;
  /** 底色（线性空间，RGBA），和贴图相乘 */
  color: [number, number, number, number];
  /** 底色贴图在 images 里的下标，没有就是 -1 */
  image: number;
  alpha: AlphaMode;
  cutoff: number;
  doubleSided: boolean;
}

export interface SourceImage {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

/** 一块网格：同一个材质的一批三角面，带贴图坐标和蒙皮 */
export interface Chunk {
  name: string;
  /** 材质在 materials 里的下标 */
  material: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** 每个顶点 4 个骨骼下标（指向 bones）和 4 个权重，权重加起来是 1 */
  joints: Uint16Array;
  weights: Float32Array;
  indices: Uint32Array;
  /**
   * 脸上的网格才有：每个顶点是角色原始脸部网格的第几个顶点（表情里它挪多少照这个查，见 FaceMorphs）。
   * 不是脸上的顶点是 -1（几块网格并成一块以后会混着）
   */
  faceVertex?: Int32Array;
  /** 拼好以后才有：每个顶点属于第几张脸（CharacterBuild.faces 的下标） */
  faceOf?: Uint8Array;
}

/** 一种表情：把哪几个变形各开到多少 */
export interface Expression {
  /** VRM 里规定的名字（joy、angry、sorrow、fun、blink_l、a …）；文件自己加的（没有规定名字的）用它起的名字的小写 */
  key: string;
  binds: { morph: number; weight: number }[];
}

/** 表情的数据：脸部网格的一组「变形」，每个变形是每个顶点挪多少 */
export interface FaceMorphs {
  /** 变形的名字，去掉了文件里那一长串前缀：ALL_Joy、EYE_Close_L、MTH_A、HA_Fung1 … */
  names: string[];
  /** 每个变形里每个顶点的位移、法线的变化：按原始脸部网格的顶点排，三个数一个，已经换成面朝 +Z */
  positions: Float32Array[];
  normals: Float32Array[];
  /** 原始脸部网格每个顶点静止时的位置 */
  rest: Float32Array;
  /** 文件里定好的几种表情 */
  expressions: Expression[];
  /** 眼珠最多转多少度：往外、往里、往下、往上（VRM 的 lookAt 那几项） */
  look: { outer: number; inner: number; down: number; up: number };
}

export interface CharacterSource {
  title: string;
  /** 文件里写的作者（几个的用顿号隔开）；没写就是空的 */
  author: string;
  /** 文件里写的许可（VRM 0.x 的 meta.licenseName，1.0 的 meta.licenseUrl） */
  license: string;
  /** VRM 0.x 许可选了「Other」时，条款的网址（meta.otherLicenseUrl） */
  licenseUrl?: string;
  /** 文件里的缩略图（VRM 的 meta 里那张）；没有就没有这一项 */
  thumbnail?: SourceImage;
  /** 是不是 VRoid 做的（骨骼叫 J_Bip_…）：不是的话材质认不全（皮肤、衣服、头发照 VRoid 的材质名认） */
  vroid: boolean;
  bones: SourceBone[];
  chunks: Chunk[];
  materials: SourceMaterial[];
  images: SourceImage[];
  /** 角色自带的兽耳（做在头发里的装饰）用的是哪几种材质；没有就是空的 */
  earMaterials: number[];
  /** 染发时改哪几种材质（头发本身；挑染、发夹、丝带不算）；没有就是空的 */
  dyeMaterials: number[];
  /** 表情（脸部网格的变形）。文件里没有就没有这一项 */
  face?: FaceMorphs;
  /**
   * 头发的平均颜色（线性空间）。读文件时不解码贴图，这一项先空着；
   * 界面那边把贴图解出来以后填上（见 load.ts），后加的尾巴和兽耳照它上色。
   */
  hairColor?: [number, number, number];
  /**
   * 染发用的浅色贴图。有的角色头发的颜色是直接画在贴图里的（新版 VRoid 导出的都是）：光改材质的底色只能染得更深。
   * 界面那边把这种贴图解出来、调成差不多是白的另存一张（见 load.ts），染的时候换上它。
   * 键是材质的下标；image 是那张浅色贴图在 images 里的下标，tone 是它的平均颜色（线性空间）。
   * 贴图本来就是浅色的（颜色在材质的底色里）就没有这一项
   */
  hairLight?: Map<number, { image: number; tone: [number, number, number] }>;
  /**
   * VRM 0.x 文件里每个材质的卡通着色（MToon）设定，按材质名（去掉「 (Instance)」）：导出 VRM 时照抄。
   * 贴图那几项不留（这里只读了底色贴图），导出时照工坊的材质重新填。1.0 的文件没有这一项
   */
  toon?: Map<string, Omit<VrmToon, 'textureProperties'>>;
  /** VRM 0.x 文件的 meta 原样：导出 VRM 时照抄许可、允许谁用、作者这几项。1.0 的文件没有这一项 */
  vrmMeta?: Record<string, unknown>;
}

export interface ReadOptions {
  /** 角色自带的兽耳是哪种材质（按材质名认） */
  ears?: RegExp;
  /** 染发时改哪种材质（按材质名认） */
  dye?: RegExp;
  /** 读用户自己给的文件：不是 VRM、缺拼装要用的骨骼时，说清楚是哪里不对（换发型用的头发文件不是整个人，不查） */
  strict?: boolean;
}

/** VRM 0.x 的模型面朝 -Z：绕 Y 轴转 180°（1.0 的本来就面朝 +Z，不用转） */
const turnAround = (data: Float32Array) => {
  for (let i = 0; i < data.length; i += 3) {
    data[i] = -data[i];
    data[i + 2] = -data[i + 2];
  }
  return data;
};

/**
 * VRM 的人形骨骼 → VRoid 的骨骼名。v1：是不是 VRM 1.0（大拇指三节的叫法两版不一样：
 * 0.x 是 Proximal、Intermediate、Distal，1.0 是 Metacarpal、Proximal、Distal）
 */
function humanName(bone: string, v1: boolean): string | null {
  const center: Record<string, string> = { hips: 'Hips', spine: 'Spine', chest: 'Chest', upperChest: 'UpperChest', neck: 'Neck', head: 'Head' };
  if (center[bone]) return `J_Bip_C_${center[bone]}`;
  const m = /^(left|right)(.+)$/.exec(bone);
  if (!m) return null;
  const side = m[1] === 'left' ? 'L' : 'R';
  const part = m[2];
  if (part === 'Eye') return `J_Adj_${side}_FaceEye`;
  const limb: Record<string, string> = {
    Shoulder: 'Shoulder', UpperArm: 'UpperArm', LowerArm: 'LowerArm', Hand: 'Hand',
    UpperLeg: 'UpperLeg', LowerLeg: 'LowerLeg', Foot: 'Foot', Toes: 'ToeBase',
  };
  if (limb[part]) return `J_Bip_${side}_${limb[part]}`;
  const finger = /^(Thumb|Index|Middle|Ring|Little)(Metacarpal|Proximal|Intermediate|Distal)$/.exec(part);
  if (!finger) return null;
  const joints = finger[1] === 'Thumb' && v1 ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
  const at = joints.indexOf(finger[2]);
  return at < 0 ? null : `J_Bip_${side}_${finger[1]}${at + 1}`;
}

/** 拼装一定要有的骨骼（VRoid 的名字）和它在 VRM 里叫什么 */
const REQUIRED: [name: string, human: string][] = [
  ['J_Bip_C_Hips', 'hips'], ['J_Bip_C_Spine', 'spine'], ['J_Bip_C_Chest', 'chest'], ['J_Bip_C_UpperChest', 'upperChest'],
  ['J_Bip_C_Neck', 'neck'], ['J_Bip_C_Head', 'head'],
  ...(['L', 'R'] as const).flatMap((s): [string, string][] => {
    const side = s === 'L' ? 'left' : 'right';
    return ['UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot'].map((p) => [`J_Bip_${s}_${p}`, `${side}${p}`]);
  }),
];

/** VRM 1.0 的表情名 → 工坊用的（VRM 0.x 的）名字 */
const PRESET_V1: Record<string, string> = {
  happy: 'joy', angry: 'angry', sad: 'sorrow', relaxed: 'fun', surprised: 'surprised', neutral: 'neutral',
  aa: 'a', ih: 'i', ou: 'u', ee: 'e', oh: 'o', blink: 'blink', blinkLeft: 'blink_l', blinkRight: 'blink_r',
  lookUp: 'lookup', lookDown: 'lookdown', lookLeft: 'lookleft', lookRight: 'lookright',
};

/** 读骨骼：按第一副蒙皮的关节顺序排，别的蒙皮里多出来的关节接在后面。turned：要不要转成面朝 +Z */
function readBones(doc: GlbDoc, turned: boolean): { bones: SourceBone[]; ofNode: Map<number, number> } {
  const { json } = doc;
  const ofNode = new Map<number, number>();
  const bones: SourceBone[] = [];
  for (const skin of json.skins as { joints: number[]; inverseBindMatrices: number }[]) {
    const inverse = readAccessor(doc, skin.inverseBindMatrices);
    skin.joints.forEach((node, j) => {
      if (ofNode.has(node)) return;
      const m = inverse.subarray(j * 16, j * 16 + 16);
      // 逆绑定矩阵按列存：前三列是旋转，第四列是平移
      const identity = [m[0], m[5], m[10]].every((v) => Math.abs(v - 1) < 1e-4) && [m[1], m[2], m[4], m[6], m[8], m[9]].every((v) => Math.abs(v) < 1e-4);
      if (!identity) throw new Error(`骨骼 ${json.nodes[node].name} 在静止姿势下带旋转或缩放，这种模型还读不了`);
      ofNode.set(node, bones.length);
      // 关节的位置就是平移取反；VRM 0.x 的再换成面朝 +Z
      bones.push({ name: json.nodes[node].name ?? `Bone_${node}`, parent: -1, pos: turned ? [m[12], -m[13], m[14]] : [-m[12], -m[13], -m[14]] });
    });
  }
  (json.nodes as { children?: number[] }[]).forEach((node, index) => {
    const parent = ofNode.get(index);
    if (parent === undefined) return;
    for (const child of node.children ?? []) {
      const bone = ofNode.get(child);
      if (bone !== undefined) bones[bone].parent = parent;
    }
  });
  return { bones, ofNode };
}

export function readCharacter(buffer: ArrayBuffer, options: ReadOptions = {}): CharacterSource {
  const doc = readGlb(buffer);
  const { json } = doc;
  const vrm0 = json.extensions?.VRM;
  const vrm1 = json.extensions?.VRMC_vrm;
  if (options.strict && !vrm0 && !vrm1) throw new Error('这个文件不是 VRM（GLB 里没有 VRM 的扩展）');
  const turn = vrm1 ? (data: Float32Array) => data : turnAround;
  const { bones, ofNode } = readBones(doc, !vrm1);
  // 不是 VRoid 做的：照人形骨骼对照表把身体的骨骼换成 VRoid 的名字
  const vroid = bones.some((b) => b.name.startsWith('J_Bip_'));
  const human: [bone: string, node: number][] = vrm1
    ? Object.entries((vrm1.humanoid?.humanBones ?? {}) as Record<string, { node: number }>).map(([bone, v]) => [bone, v.node])
    : ((vrm0?.humanoid?.humanBones ?? []) as { bone: string; node: number }[]).map((h) => [h.bone, h.node]);
  if (!vroid) {
    for (const [bone, node] of human) {
      const name = humanName(bone, Boolean(vrm1));
      const b = ofNode.get(node);
      if (name && b !== undefined) bones[b].name = name;
    }
  }
  const missing = REQUIRED.filter(([name]) => !bones.some((b) => b.name === name)).map(([, h]) => h);
  if (options.strict && missing.length) throw new Error(`这个模型缺少工坊要用的人形骨骼：${missing.join('、')}`);

  // 只留用得到的材质和底色贴图（法线贴图、缩略图这些不要）
  const materials: SourceMaterial[] = [];
  const images: SourceImage[] = [];
  const materialOf = new Map<number, number>();
  const imageOf = new Map<number, number>();
  const useMaterial = (index: number): number => {
    const known = materialOf.get(index);
    if (known !== undefined) return known;
    const m = json.materials[index];
    const pbr = m.pbrMetallicRoughness ?? {};
    let image = -1;
    const texture = pbr.baseColorTexture?.index;
    if (texture !== undefined) {
      const source: number = json.textures[texture].source;
      const seen = imageOf.get(source);
      if (seen !== undefined) image = seen;
      else {
        const info = json.images[source];
        image = images.length;
        imageOf.set(source, image);
        images.push({ name: info.name ?? `Image_${source}`, mime: info.mimeType ?? 'image/png', bytes: readBufferView(doc, info.bufferView) });
      }
    }
    const out = materials.length;
    materialOf.set(index, out);
    materials.push({
      // 新版 VRoid 导出的材质名后面拖着一个「 (Instance)」：去掉，后面按名字认皮肤、衣服、头发时不用管它
      name: (m.name ?? `Material_${index}`).replace(/ \(Instance\)$/, ''),
      color: (pbr.baseColorFactor as [number, number, number, number] | undefined) ?? [1, 1, 1, 1],
      image,
      alpha: (m.alphaMode as AlphaMode | undefined) ?? 'OPAQUE',
      cutoff: m.alphaCutoff ?? 0.5,
      doubleSided: Boolean(m.doubleSided),
    });
    return out;
  };

  const chunks: Chunk[] = [];
  // 同一个网格的几批面共用一套顶点：按 accessor 读一次
  const cache = new Map<number, Float32Array>();
  const accessor = (index: number) => {
    let data = cache.get(index);
    if (!data) {
      data = readAccessor(doc, index);
      cache.set(index, data);
    }
    return data;
  };

  // 表情：带「变形」的那个网格就是脸。它的几批面共用一套顶点，变形也是这一套
  type Target = { POSITION?: number; NORMAL?: number };
  type Primitive = { attributes: Record<string, number>; indices: number; material: number; targets?: Target[]; extras?: { targetNames?: string[] } };
  let face: FaceMorphs | undefined;
  let faceMesh = -1;
  let facePosition = -1;
  (json.meshes as { primitives: Primitive[]; extras?: { targetNames?: string[] } }[]).forEach((mesh, m) => {
    const first = mesh.primitives[0];
    const targets = first?.targets?.filter((t) => t.POSITION !== undefined);
    if (face || !targets?.length || first.attributes.POSITION === undefined) return;
    const rest = turn(Float32Array.from(accessor(first.attributes.POSITION)));
    const given = first.extras?.targetNames ?? mesh.extras?.targetNames ?? [];
    const vrm = vrm0 ?? {};
    const degrees = (curve: { yRange?: number } | undefined, fallback: number) => (typeof curve?.yRange === 'number' && curve.yRange > 0 ? curve.yRange : fallback);
    // VRM 1.0：眼珠转多少度写在 lookAt 的 rangeMap 里
    const range = (map: { outputScale?: number } | undefined, fallback: number) => (typeof map?.outputScale === 'number' && map.outputScale > 0 ? map.outputScale : fallback);
    type BindV1 = { node: number; index: number; weight: number };
    const exprV1 = vrm1
      ? [
          ...Object.entries((vrm1.expressions?.preset ?? {}) as Record<string, { morphTargetBinds?: BindV1[] }>).map(([k, e]) => ({ key: PRESET_V1[k] ?? k.toLowerCase(), e })),
          ...Object.entries((vrm1.expressions?.custom ?? {}) as Record<string, { morphTargetBinds?: BindV1[] }>).map(([k, e]) => ({ key: k.toLowerCase(), e })),
        ]
      : [];
    faceMesh = m;
    facePosition = first.attributes.POSITION;
    face = {
      // 「Face.M_F00_000_00_Fcl_ALL_Joy」只留最后那一段「ALL_Joy」
      // 新版 VRoid 导出的直接叫「Fcl_ALL_Joy」，一样只留「ALL_Joy」
      names: targets.map((_, i) => (given[i] ?? `Morph_${i}`).replace(/^.*?M_[A-Za-z]\d+_\d+_\d+_/, '').replace(/^Fcl_/, '')),
      positions: targets.map((t) => turn(Float32Array.from(accessor(t.POSITION!)))),
      normals: targets.map((t) => (t.NORMAL === undefined ? new Float32Array(rest.length) : turn(Float32Array.from(accessor(t.NORMAL))))),
      rest,
      expressions: vrm1
        ? exprV1
            .map(({ key, e }) => ({
              key,
              // 1.0 的权重是 0–1，绑的是节点（照节点找到网格）
              binds: (e.morphTargetBinds ?? []).filter((b) => json.nodes[b.node]?.mesh === m && b.index < targets.length).map((b) => ({ morph: b.index, weight: b.weight })),
            }))
            .filter((e) => e.key && e.binds.length)
        : ((vrm.blendShapeMaster?.blendShapeGroups ?? []) as { name?: string; presetName?: string; binds?: { mesh: number; index: number; weight: number }[] }[])
            .map((group) => ({
              key: group.presetName && group.presetName !== 'unknown' ? group.presetName : (group.name ?? '').toLowerCase(),
              binds: (group.binds ?? []).filter((b) => b.mesh === m && b.index < targets.length).map((b) => ({ morph: b.index, weight: b.weight / 100 })),
            }))
            .filter((e) => e.key && e.binds.length),
      look: vrm1
        ? {
            outer: range(vrm1.lookAt?.rangeMapHorizontalOuter, 12),
            inner: range(vrm1.lookAt?.rangeMapHorizontalInner, 8),
            down: range(vrm1.lookAt?.rangeMapVerticalDown, 10),
            up: range(vrm1.lookAt?.rangeMapVerticalUp, 10),
          }
        : {
            outer: degrees(vrm.firstPerson?.lookAtHorizontalOuter, 12),
            inner: degrees(vrm.firstPerson?.lookAtHorizontalInner, 8),
            down: degrees(vrm.firstPerson?.lookAtVerticalDown, 10),
            up: degrees(vrm.firstPerson?.lookAtVerticalUp, 10),
          },
    };
  });
  for (const node of json.nodes as { name?: string; mesh?: number; skin?: number }[]) {
    if (node.mesh === undefined || node.skin === undefined) continue;
    const mesh = json.meshes[node.mesh];
    const skinJoints: number[] = json.skins[node.skin].joints;
    for (const [p, prim] of (mesh.primitives as Primitive[]).entries()) {
      const a = prim.attributes;
      if (a.POSITION === undefined || a.JOINTS_0 === undefined || a.WEIGHTS_0 === undefined || prim.indices === undefined) continue;
      const position = accessor(a.POSITION);
      const normal = a.NORMAL === undefined ? null : accessor(a.NORMAL);
      const uv = a.TEXCOORD_0 === undefined ? null : accessor(a.TEXCOORD_0);
      const joint = accessor(a.JOINTS_0);
      const weight = accessor(a.WEIGHTS_0);
      const index = accessor(prim.indices);
      // 只留这批面用到的顶点，重新编号
      const remap = new Map<number, number>();
      const indices = new Uint32Array(index.length);
      for (let i = 0; i < index.length; i++) {
        let id = remap.get(index[i]);
        if (id === undefined) {
          id = remap.size;
          remap.set(index[i], id);
        }
        indices[i] = id;
      }
      const count = remap.size;
      const chunk: Chunk = {
        name: `${mesh.name ?? node.name ?? 'Mesh'}_${p}`,
        material: useMaterial(prim.material),
        positions: new Float32Array(count * 3),
        normals: new Float32Array(count * 3),
        uvs: new Float32Array(count * 2),
        joints: new Uint16Array(count * 4),
        weights: new Float32Array(count * 4),
        indices,
      };
      // 脸上的顶点记下它在原始脸部网格里是第几个：表情照它查
      const faceVertex = node.mesh === faceMesh && a.POSITION === facePosition ? new Int32Array(count) : null;
      if (faceVertex) chunk.faceVertex = faceVertex;
      for (const [from, to] of remap) {
        if (faceVertex) faceVertex[to] = from;
        for (let k = 0; k < 3; k++) {
          chunk.positions[to * 3 + k] = position[from * 3 + k];
          if (normal) chunk.normals[to * 3 + k] = normal[from * 3 + k];
        }
        if (uv) {
          chunk.uvs[to * 2] = uv[from * 2];
          chunk.uvs[to * 2 + 1] = uv[from * 2 + 1];
        }
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += weight[from * 4 + k];
        // 有的文件里同一根骨骼在一个顶点上占了两格：并成一格，权重加在一起
        let filled = 0;
        for (let k = 0; k < 4; k++) {
          const w = sum > 0 ? weight[from * 4 + k] / sum : k === 0 ? 1 : 0;
          if (!(w > 0)) continue;
          const bone = ofNode.get(skinJoints[joint[from * 4 + k]]);
          if (bone === undefined) throw new Error(`网格 ${chunk.name} 用到了骨架以外的关节`);
          let slot = 0;
          while (slot < filled && chunk.joints[to * 4 + slot] !== bone) slot++;
          if (slot === filled) chunk.joints[to * 4 + filled++] = bone;
          chunk.weights[to * 4 + slot] += w;
        }
      }
      turn(chunk.positions);
      turn(chunk.normals);
      chunks.push(chunk);
    }
  }
  if (!chunks.length) throw new Error('文件里没有带蒙皮的网格');

  const meta = (vrm1 ? vrm1.meta : vrm0?.meta) ?? {};
  // 缩略图：0.x 记的是贴图的下标，1.0 记的是图片的下标
  const thumbIndex: number | undefined = vrm1 ? meta.thumbnailImage : meta.texture === undefined ? undefined : json.textures?.[meta.texture]?.source;
  const thumbInfo = thumbIndex === undefined ? undefined : json.images?.[thumbIndex];
  const thumbnail: SourceImage | undefined =
    thumbInfo?.bufferView === undefined ? undefined : { name: thumbInfo.name ?? 'Thumbnail', mime: thumbInfo.mimeType ?? 'image/png', bytes: readBufferView(doc, thumbInfo.bufferView) };
  // 0.x 的卡通着色设定，按材质名留着（导出 VRM 时照抄）
  type RawToon = Partial<VrmToon> & { name?: string };
  const toon = new Map<string, Omit<VrmToon, 'textureProperties'>>();
  for (const p of (vrm0?.materialProperties ?? []) as RawToon[]) {
    if (typeof p?.name !== 'string' || typeof p.shader !== 'string') continue;
    toon.set(p.name.replace(/ \(Instance\)$/, ''), {
      shader: p.shader,
      renderQueue: typeof p.renderQueue === 'number' ? p.renderQueue : 2000,
      floatProperties: { ...(p.floatProperties ?? {}) },
      vectorProperties: { ...(p.vectorProperties ?? {}) },
      keywordMap: { ...(p.keywordMap ?? {}) },
      tagMap: { ...(p.tagMap ?? {}) },
    });
  }
  return {
    title: (vrm1 ? meta.name : meta.title) || 'Character',
    author: vrm1 ? ((meta.authors ?? []) as string[]).join('、') : (meta.author ?? ''),
    license: (vrm1 ? meta.licenseUrl : meta.licenseName) ?? '',
    // 0.x 选了「Other」的，真正的条款在 otherLicenseUrl 里
    ...(!vrm1 && meta.licenseName === 'Other' && meta.otherLicenseUrl ? { licenseUrl: String(meta.otherLicenseUrl) } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    vroid,
    bones,
    chunks,
    materials,
    images,
    earMaterials: materials.flatMap((m, i) => (options.ears?.test(m.name) ? [i] : [])),
    dyeMaterials: materials.flatMap((m, i) => (options.dye?.test(m.name) ? [i] : [])),
    ...(face ? { face } : {}),
    ...(toon.size ? { toon } : {}),
    ...(vrm0?.meta ? { vrmMeta: { ...vrm0.meta } } : {}),
  };
}
