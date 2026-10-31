/**
 * GLB（glTF 2.0 二进制）写出器，只做白模用得到的那一小部分：
 * 若干个三角网格，可以带一副骨架和蒙皮权重。纯函数，不依赖浏览器，测试里可以直接跑。
 *
 * glTF 的约定正好是：单位米、Y 朝上、正面朝 +Z；Blender 导入时会自动转成它自己的 Z 朝上。
 */
import {
  type Quat,
  type V3,
  Q_ID,
  UP,
  len,
  mat3Apply,
  norm,
  quatBetween,
  quatConj,
  quatMat3,
  quatMul,
  rotate,
  sub,
} from '../geometry/vec';
import type { Skeleton } from '../rig/skeleton';

export interface GlbMesh {
  name: string;
  /**
   * 属于哪个物体。object 相同的几块网格在文件里是同一个物体的几批面
   * （导进 Blender 是一个物体、几个材质槽）；不给的话每块网格各是一个物体。
   */
  object?: string;
  /** 顶点位置，世界坐标，米 */
  positions: Float32Array;
  normals?: Float32Array;
  /** 三角形，每三个下标一个面 */
  indices: Uint32Array;
  /** 蒙皮：每个顶点 4 个骨骼下标和 4 个权重 */
  joints?: Uint16Array;
  weights?: Float32Array;
  /** 贴图坐标（每个顶点两个数，glTF 的约定：左上角是原点） */
  uvs?: Float32Array;
  /** 材质：名字、底色（sRGB，0xRRGGBB）、是不是双面；带贴图的材质见 GlbMaterial 里其余几项 */
  material?: GlbMaterial;
}

export interface GlbMaterial {
  name: string;
  /** 底色（sRGB，0xRRGGBB） */
  color: number;
  doubleSided?: boolean;
  /** 底色直接给线性空间的 RGBA（给了就不看 color）。有贴图时和贴图相乘 */
  factor?: [number, number, number, number];
  /** 底色贴图：GlbOptions.images 里的下标 */
  image?: number;
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
  /** 不受光照影响（二次元角色的贴图本身就画好了明暗） */
  unlit?: boolean;
}

export interface GlbImage {
  name?: string;
  /** image/png 或 image/jpeg */
  mime: string;
  bytes: Uint8Array;
}

export interface GlbOptions {
  /** 给了骨架，带蒙皮数据的网格就绑在它上面 */
  skeleton?: Skeleton;
  /** 骨架在 Blender 里显示的名字 */
  rigName?: string;
  /** 材质用到的贴图，原样存进文件；没被用到的不存 */
  images?: GlbImage[];
  /** 署名：写进文件的 asset.copyright（用了要求署名的素材时带上） */
  copyright?: string;
}

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

/** sRGB 的一个通道（0–255）→ 线性（glTF 的颜色是线性的） */
const linear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

type Json = Record<string, unknown>;

export function writeGlb(meshes: GlbMesh[], options: GlbOptions = {}): ArrayBuffer {
  const { skeleton } = options;
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: Json[] = [];
  const accessors: Json[] = [];

  /** 往二进制块里加一段数据（按 4 字节对齐），返回对应的 accessor 下标 */
  /** 往二进制块里加一段原始字节（按 4 字节对齐），返回对应的 bufferView 下标 */
  const addBytes = (bytes: Uint8Array, target?: number): number => {
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(bytes);
    byteLength += bytes.byteLength;
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      byteLength += pad;
    }
    return bufferViews.length - 1;
  };
  const add = (
    data: Float32Array | Uint16Array | Uint32Array,
    type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4',
    size: number,
    target?: number,
    extra: Json = {},
  ): number => {
    const bufferView = addBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), target);
    const componentType = data instanceof Float32Array ? FLOAT : data instanceof Uint16Array ? UNSIGNED_SHORT : UNSIGNED_INT;
    accessors.push({ bufferView, componentType, count: data.length / size, type, ...extra });
    return accessors.length - 1;
  };

  const nodes: Json[] = [];
  const sceneNodes: number[] = [];
  const skins: Json[] = [];

  // 骨骼：一根骨骼一个节点。节点自己的 +Y 轴从骨骼的起点指向终点——
  // Blender 就是按这根轴来画骨骼的，不这样的话导进去所有骨骼都直挺挺地朝上
  if (skeleton) {
    const { bones } = skeleton;
    const turns: Quat[] = bones.map((bone) => {
      const along = sub(bone.tail, bone.head);
      return len(along) > 1e-9 ? quatBetween(UP, norm(along)) : Q_ID;
    });
    bones.forEach((bone, i) => {
      // 相对父骨骼的位置和朝向
      const up = bone.parent >= 0 ? quatConj(turns[bone.parent]) : Q_ID;
      const from: V3 = bone.parent >= 0 ? bones[bone.parent].head : [0, 0, 0];
      nodes.push({ name: bone.name, translation: rotate(up, sub(bone.head, from)), rotation: quatMul(up, turns[i]) });
    });
    bones.forEach((bone, i) => {
      if (bone.parent < 0) {
        sceneNodes.push(i);
        return;
      }
      const parent = nodes[bone.parent];
      const children = (parent.children as number[] | undefined) ?? [];
      children.push(i);
      parent.children = children;
    });
    // 绑定姿势的逆矩阵：把顶点从世界坐标搬到骨骼自己的坐标（先减去骨骼的起点，再转回去）。按列存
    const inverse = new Float32Array(bones.length * 16);
    bones.forEach((bone, i) => {
      const r = quatMat3(quatConj(turns[i]));
      const t = mat3Apply(r, bone.head);
      inverse.set([r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, -t[0], -t[1], -t[2], 1], i * 16);
    });
    skins.push({
      name: options.rigName ?? 'Armature',
      joints: bones.map((_, i) => i),
      skeleton: bones.findIndex((b) => b.parent < 0),
      inverseBindMatrices: add(inverse, 'MAT4', 16),
    });
  }

  const materials: Json[] = [];
  const materialIndex = new Map<string, number>();
  const gltfMeshes: Json[] = [];
  // 贴图：用到哪张存哪张，一张图对应一个 texture
  const images: Json[] = [];
  const textureOf = new Map<number, number>();
  const texture = (index: number): number => {
    let made = textureOf.get(index);
    if (made === undefined) {
      const image = options.images?.[index];
      if (!image) throw new Error(`材质要用第 ${index} 张贴图，但没有给`);
      made = images.length;
      textureOf.set(index, made);
      images.push({ ...(image.name ? { name: image.name } : {}), mimeType: image.mime, bufferView: addBytes(image.bytes) });
    }
    return made;
  };
  let unlit = false;
  /** 物体名 → 它在 gltfMeshes 里的下标 */
  const objectOf = new Map<string, number>();

  for (const mesh of meshes) {
    const count = mesh.positions.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i++) {
      const v = mesh.positions[i];
      if (v < min[i % 3]) min[i % 3] = v;
      if (v > max[i % 3]) max[i % 3] = v;
    }
    const attributes: Json = { POSITION: add(mesh.positions, 'VEC3', 3, ARRAY_BUFFER, { min, max }) };
    if (mesh.normals) attributes.NORMAL = add(mesh.normals, 'VEC3', 3, ARRAY_BUFFER);
    if (mesh.uvs) {
      if (mesh.uvs.length !== count * 2) throw new Error(`网格 ${mesh.name} 的贴图坐标和顶点数对不上`);
      attributes.TEXCOORD_0 = add(mesh.uvs, 'VEC2', 2, ARRAY_BUFFER);
    }
    const skinned = Boolean(skeleton && mesh.joints && mesh.weights);
    if (skinned) {
      if (mesh.joints!.length !== count * 4 || mesh.weights!.length !== count * 4) {
        throw new Error(`网格 ${mesh.name} 的蒙皮数据和顶点数对不上`);
      }
      attributes.JOINTS_0 = add(mesh.joints!, 'VEC4', 4, ARRAY_BUFFER);
      attributes.WEIGHTS_0 = add(mesh.weights!, 'VEC4', 4, ARRAY_BUFFER);
    }
    const primitive: Json = { attributes, indices: add(mesh.indices, 'SCALAR', 1, ELEMENT_ARRAY_BUFFER), mode: 4 };

    if (mesh.material) {
      const m = mesh.material;
      const key = JSON.stringify([m.name, m.color, m.doubleSided ?? false, m.factor ?? null, m.image ?? -1, m.alphaMode ?? 'OPAQUE', m.alphaCutoff ?? 0.5, m.unlit ?? false]);
      let index = materialIndex.get(key);
      if (index === undefined) {
        index = materials.length;
        materialIndex.set(key, index);
        if (m.unlit) unlit = true;
        materials.push({
          name: m.name,
          pbrMetallicRoughness: {
            baseColorFactor: m.factor ?? [linear((m.color >> 16) & 255), linear((m.color >> 8) & 255), linear(m.color & 255), 1],
            ...(m.image === undefined ? {} : { baseColorTexture: { index: texture(m.image) } }),
            metallicFactor: 0,
            roughnessFactor: m.unlit ? 0.9 : 0.8,
          },
          ...(m.doubleSided ? { doubleSided: true } : {}),
          ...(m.alphaMode && m.alphaMode !== 'OPAQUE' ? { alphaMode: m.alphaMode } : {}),
          ...(m.alphaMode === 'MASK' ? { alphaCutoff: m.alphaCutoff ?? 0.5 } : {}),
          ...(m.unlit ? { extensions: { KHR_materials_unlit: {} } } : {}),
        });
      }
      primitive.material = index;
    }

    const shared = mesh.object === undefined ? undefined : objectOf.get(mesh.object);
    if (shared !== undefined) {
      (gltfMeshes[shared].primitives as Json[]).push(primitive);
      continue;
    }
    if (mesh.object !== undefined) objectOf.set(mesh.object, gltfMeshes.length);
    const name = mesh.object ?? mesh.name;
    gltfMeshes.push({ name, primitives: [primitive] });
    sceneNodes.push(nodes.length);
    nodes.push({ name, mesh: gltfMeshes.length - 1, ...(skinned ? { skin: 0 } : {}) });
  }

  const json: Json = {
    asset: { version: '2.0', generator: 'OC Basemesh Workshop v2', ...(options.copyright ? { copyright: options.copyright } : {}) },
    scene: 0,
    scenes: [{ nodes: sceneNodes }],
    nodes,
    meshes: gltfMeshes,
    ...(materials.length ? { materials } : {}),
    ...(images.length
      ? {
          images,
          textures: images.map((_, i) => ({ source: i, sampler: 0 })),
          // 线性过滤、带多级渐远、两个方向都重复
          samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
        }
      : {}),
    ...(unlit ? { extensionsUsed: ['KHR_materials_unlit'] } : {}),
    ...(skins.length ? { skins } : {}),
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };

  // 拼成 GLB：文件头 + JSON 块（用空格补齐到 4 的倍数）+ 二进制块
  const text = new TextEncoder().encode(JSON.stringify(json));
  const textLength = text.byteLength + ((4 - (text.byteLength % 4)) % 4);
  const total = 12 + 8 + textLength + 8 + byteLength;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, textLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + textLength);
  bytes.set(text, 20);
  let offset = 20 + textLength;
  view.setUint32(offset, byteLength, true);
  view.setUint32(offset + 4, 0x004e4942, true);
  offset += 8;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
