/**
 * 把用户自己的模型文件转成工坊的素材文件（realFile.ts 那一种，见 docs/import-plan.md）。纯函数，不碰浏览器。
 *
 * 分两步：
 * - readImportGlb / readImportGltf：读 GLB、.gltf，照节点的摆放把所有网格拼成一整块（文件自己的坐标和单位），
 *   材质、贴图一起取出来；文件外面的 .bin、贴图跟调用的人要（ImportFiles）；
 *   读的时候丢掉、改掉的东西记在 notes 里，说给用户听。
 * - buildImport：照用户在导入框里定的大小、朝向转成素材文件：原点挪到底面正中、一样的点合成一个、
 *   同一个材质的面排在一起；面多的另做一份碰撞用的粗网格。
 *
 * 带骨骼的网格照文件里现在的骨骼摆放算成不动的样子；动画不要。
 */
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { t } from '../i18n';
import { type GlbDoc, readAccessor, readBufferView, readGlb } from '../io/glbRead';
import type { Vec3 } from '../model/spec';
import type { RealAssetFile, RealGroup, RealMaterial, RealTexture } from './realFile';

/** 最多认多少个三角面：再多的页面撑不住，直接说太大 */
export const IMPORT_MAX_TRIANGLES = 2_000_000;
/** 碰撞用的粗网格最多多少个面；面比这少的不另做，直接用它自己的网格 */
export const TOUCH_BUDGET = 1500;

export interface ImportSource {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** 每个面三个点的下标 */
  indices: Uint32Array;
  /** 每个面用第几个材质（materials 里的下标） */
  faceMaterial: Int32Array;
  materials: RealMaterial[];
  textures: RealTexture[];
  /** 占的盒子（文件自己的坐标和单位） */
  min: Vec3;
  max: Vec3;
  /** 读的时候丢掉、改掉的东西 */
  notes: string[];
  /** 只有形状、没有自己的颜色和贴图（OBJ、STL） */
  plain?: boolean;
  /** 文件自己写着的单位：一个单位是多少米（FBX 有）；没有的照大小猜 */
  unit?: number;
}

/**
 * 模型文件外面的文件（.bin、.mtl、贴图）：给文件里写的那个名字或路径，返回内容；没有返回 null。
 * 只选了一个文件时没有这个（什么都拿不到）
 */
export type ImportFiles = (uri: string) => Uint8Array | null;

export const MIME_OK = new Set(['image/jpeg', 'image/png', 'image/webp']);

const MISSING_TEXTURE = () => t('有的贴图文件没找到，没带上：把贴图和模型文件一起选上，或者把整个文件夹拖进来');
export const missingTextureNote = MISSING_TEXTURE;

/** 照文件开头的几个字节认图片的种类；认不出返回空 */
export function sniffImage(bytes: Uint8Array): string {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
    return 'image/webp';
  return '';
}

function dataUri(uri: string): Uint8Array | null {
  const m = /^data:[^;,]*(;base64)?,/.exec(uri);
  if (!m) return null;
  const body = uri.slice(m[0].length);
  if (!m[1]) return new TextEncoder().encode(decodeURIComponent(body));
  const text = atob(body);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

const localMatrix = (node: any): Matrix4 => {
  const m = new Matrix4();
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return m.fromArray(node.matrix);
  return m.compose(
    new Vector3(...((node.translation as number[] | undefined) ?? [0, 0, 0])),
    new Quaternion(...((node.rotation as number[] | undefined) ?? [0, 0, 0, 1])),
    new Vector3(...((node.scale as number[] | undefined) ?? [1, 1, 1])),
  );
};

/** 没带法线的：照面的朝向现算（每个点取它周围那些面的平均，按面积加权） */
export function smoothNormals(positions: Float32Array, indices: ArrayLike<number>): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const at of [a, b, c]) for (let k = 0; k < 3; k++) normals[at + k] += n[k];
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (l > 1e-20) for (let k = 0; k < 3; k++) normals[i + k] /= l;
    else normals[i + 1] = 1;
  }
  return normals;
}

/**
 * 把 glTF 用到的几块二进制数据接成一块（readAccessor 只认一块）：自己带的那块（GLB 里的）、
 * 写在 JSON 里的（data:）、外面的 .bin。缺了哪个 .bin 抛出原因
 */
function joinBuffers(json: any, own: Uint8Array | null, files: ImportFiles | null): GlbDoc {
  const buffers: any[] = json.buffers ?? [];
  const parts: Uint8Array[] = buffers.map((b, i) => {
    if (typeof b?.uri !== 'string') {
      if (i === 0 && own) return own;
      throw new Error(t('这个文件里的网格是坏的，读不了'));
    }
    const bytes = dataUri(b.uri) ?? files?.(b.uri) ?? null;
    if (!bytes)
      throw new Error(
        t('这个模型还要用到「{name}」：把它和模型文件一起选上，或者把整个文件夹拖进来、打成 zip 再导', { name: decodeURIComponent(b.uri).split(/[\\/]/).pop() ?? b.uri }),
      );
    return bytes;
  });
  if (!parts.length) throw new Error(t('这个文件里没有能用的网格'));
  if (parts.length === 1) return { json, bin: new DataView(parts[0].buffer, parts[0].byteOffset, parts[0].byteLength) };
  // 好几块：接成一块，每个 bufferView 的起点跟着挪
  const starts: number[] = [];
  let total = 0;
  for (const part of parts) {
    starts.push(total);
    total += (part.byteLength + 3) & ~3;
  }
  const all = new Uint8Array(total);
  parts.forEach((part, i) => all.set(part, starts[i]));
  const bufferViews = (json.bufferViews ?? []).map((v: any) => ({ ...v, buffer: 0, byteOffset: (v.byteOffset ?? 0) + (starts[v.buffer ?? 0] ?? 0) }));
  return { json: { ...json, bufferViews }, bin: new DataView(all.buffer) };
}

/** 读一个 GLB。files 是它外面的文件（没有就不给）。读不了的抛出原因（说给用户听的话） */
export function readImportGlb(buffer: ArrayBuffer, files: ImportFiles | null = null): ImportSource {
  const glb = readGlb(buffer);
  const own = new Uint8Array(glb.bin.buffer, glb.bin.byteOffset, glb.bin.byteLength);
  return readGltfDoc(joinBuffers(glb.json, own, files), files);
}

/** 读一个 .gltf（文字的那种）：网格数据在外面的 .bin 里，或者直接写在文件里 */
export function readImportGltf(buffer: ArrayBuffer, files: ImportFiles | null = null): ImportSource {
  let json: any;
  try {
    json = JSON.parse(new TextDecoder().decode(buffer).replace(/^\uFEFF/, ''));
  } catch {
    throw new Error(t('这个 .gltf 文件是坏的，读不了'));
  }
  if (!json || typeof json !== 'object' || !json.asset) throw new Error(t('这个 .gltf 文件是坏的，读不了'));
  return readGltfDoc(joinBuffers(json, null, files), files);
}

function readGltfDoc(doc: GlbDoc, files: ImportFiles | null): ImportSource {
  const json = doc.json;
  const required: string[] = json.extensionsRequired ?? [];
  if (required.includes('KHR_draco_mesh_compression') || required.includes('EXT_meshopt_compression'))
    throw new Error(t('这个文件的网格是压缩过的，读不了：在 Blender 里重新导出一次，不勾「压缩」'));
  const nodes: any[] = json.nodes ?? [];
  const meshes: any[] = json.meshes ?? [];
  const notes = new Set<string>();

  /* ---- 每个节点在场景里的摆放 ---- */
  const world: (Matrix4 | null)[] = nodes.map(() => null);
  const order: number[] = [];
  const place = (index: number, parent: Matrix4, depth: number) => {
    const node = nodes[index];
    if (!node || world[index] || depth > 200) return;
    world[index] = parent.clone().multiply(localMatrix(node));
    order.push(index);
    for (const child of node.children ?? []) place(child, world[index]!, depth + 1);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots: number[] = scene?.nodes ?? nodes.map((_, i) => i).filter((i) => !nodes.some((n) => (n.children ?? []).includes(i)));
  for (const root of roots) place(root, new Matrix4(), 0);

  /* ---- 贴图、材质：用到哪个取哪个 ---- */
  const textures: RealTexture[] = [];
  const textureAt = new Map<number, number | undefined>();
  const texture = (ref: any): number | undefined => {
    if (!ref || typeof ref.index !== 'number') return undefined;
    if ((ref.texCoord ?? 0) !== 0) {
      notes.add(t('有的贴图用的是第二套贴图坐标，没带上'));
      return undefined;
    }
    if (ref.extensions?.KHR_texture_transform) notes.add(t('贴图的平铺、偏移没带上，花纹可能对不上'));
    const entry = json.textures?.[ref.index];
    const source = entry?.source ?? entry?.extensions?.EXT_texture_webp?.source;
    if (typeof source !== 'number') {
      notes.add(t('有的贴图是工坊不认的格式，没带上'));
      return undefined;
    }
    if (textureAt.has(source)) return textureAt.get(source);
    const image = json.images?.[source];
    let bytes: Uint8Array | null = null;
    if (typeof image?.bufferView === 'number') bytes = readBufferView(doc, image.bufferView).slice();
    else if (typeof image?.uri === 'string') bytes = dataUri(image.uri) ?? files?.(image.uri) ?? null;
    const mime = bytes ? sniffImage(bytes) || String(image?.mimeType ?? '') : '';
    let at: number | undefined;
    if (bytes && MIME_OK.has(mime)) {
      at = textures.length;
      textures.push({ mime, bytes });
    } else if (!bytes && typeof image?.uri === 'string') notes.add(MISSING_TEXTURE());
    else notes.add(t('有的贴图是工坊不认的格式，没带上'));
    textureAt.set(source, at);
    return at;
  };
  const materials: RealMaterial[] = [];
  const materialAt = new Map<number, number>();
  const material = (source: number): number => {
    let at = materialAt.get(source);
    if (at !== undefined) return at;
    const m = json.materials?.[source] ?? {};
    const pbr = m.pbrMetallicRoughness ?? {};
    const old = m.extensions?.KHR_materials_pbrSpecularGlossiness;
    const factor: number[] = pbr.baseColorFactor ?? old?.diffuseFactor ?? [1, 1, 1, 1];
    const map = texture(pbr.baseColorTexture ?? old?.diffuseTexture);
    const normal = texture(m.normalTexture);
    const arm = texture(pbr.metallicRoughnessTexture);
    if (m.alphaMode === 'BLEND' || m.alphaMode === 'MASK') notes.add(t('透明、镂空的材质画成不透明的'));
    at = materials.length;
    materialAt.set(source, at);
    materials.push({
      name: String(m.name ?? `m${source < 0 ? 0 : source}`).slice(0, 60),
      ...(map === undefined ? {} : { map }),
      ...(normal === undefined ? {} : { normal }),
      ...(arm === undefined ? {} : { arm }),
      // 缝隙里的暗和粗糙度是同一张图时，红色通道就是它
      ...(arm !== undefined && m.occlusionTexture?.index === pbr.metallicRoughnessTexture?.index ? { ao: true as const } : {}),
      color: [Number(factor[0] ?? 1), Number(factor[1] ?? 1), Number(factor[2] ?? 1)],
      roughness: old ? 1 - Number(old.glossinessFactor ?? 1) : Number(pbr.roughnessFactor ?? 1),
      metalness: old ? 0 : Number(pbr.metallicFactor ?? 1),
      ...(m.doubleSided ? { doubleSided: true } : {}),
    });
    return at;
  };

  /* ---- 网格：先数一遍有多少，再装 ---- */
  interface Piece {
    node: number;
    prim: any;
  }
  const pieces: Piece[] = [];
  let vertexTotal = 0;
  let faceTotal = 0;
  for (const index of order) {
    const mesh = meshes[nodes[index].mesh];
    if (!mesh) continue;
    for (const prim of mesh.primitives ?? []) {
      if (prim.extensions?.KHR_draco_mesh_compression) throw new Error(t('这个文件的网格是压缩过的，读不了：在 Blender 里重新导出一次，不勾「压缩」'));
      if ((prim.mode ?? 4) !== 4) {
        notes.add(t('文件里的线、点没要，只要了面'));
        continue;
      }
      const count = json.accessors?.[prim.attributes?.POSITION]?.count;
      if (!(count > 0)) continue;
      const corners = prim.indices !== undefined ? json.accessors[prim.indices].count : count;
      pieces.push({ node: index, prim });
      vertexTotal += count;
      faceTotal += Math.floor(corners / 3);
    }
  }
  if (!faceTotal) throw new Error(t('这个文件里没有能用的网格'));
  if (faceTotal > IMPORT_MAX_TRIANGLES) throw new Error(t('这个文件有 {n} 万个面，太大了：在 Blender 里减面以后再导', { n: Math.round(faceTotal / 10000) }));

  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const uvs = new Float32Array(vertexTotal * 2);
  const indices = new Uint32Array(faceTotal * 3);
  const faceMaterial = new Int32Array(faceTotal);
  let vertexAt = 0;
  let faceAt = 0;
  const v = new Vector3();
  const blend = new Matrix4();
  const one = new Matrix4();
  for (const { node: index, prim } of pieces) {
    const node = nodes[index];
    const pos = readAccessor(doc, prim.attributes.POSITION);
    const count = pos.length / 3;
    const idx = prim.indices !== undefined ? readAccessor(doc, prim.indices) : Float32Array.from({ length: count }, (_, i) => i);
    const nor = prim.attributes.NORMAL !== undefined ? readAccessor(doc, prim.attributes.NORMAL) : smoothNormals(pos, idx);
    const uv = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(doc, prim.attributes.TEXCOORD_0) : null;
    if (prim.attributes.COLOR_0 !== undefined) notes.add(t('刷在点上的颜色没带上'));

    // 带骨骼的：每个点照它跟着的那几根骨骼现在的摆放算；不带的照节点的摆放
    const skin = typeof node.skin === 'number' ? json.skins?.[node.skin] : undefined;
    const joints = skin && prim.attributes.JOINTS_0 !== undefined && prim.attributes.WEIGHTS_0 !== undefined ? readAccessor(doc, prim.attributes.JOINTS_0) : null;
    const weights = joints ? readAccessor(doc, prim.attributes.WEIGHTS_0) : null;
    let bones: Matrix4[] | null = null;
    if (joints && weights) {
      const inverse = skin.inverseBindMatrices !== undefined ? readAccessor(doc, skin.inverseBindMatrices) : null;
      bones = (skin.joints as number[]).map((joint, j) => {
        const m = (world[joint] ?? new Matrix4()).clone();
        return inverse ? m.multiply(new Matrix4().fromArray(inverse, j * 16)) : m;
      });
      notes.add(t('这个文件带骨骼：照它现在的姿势当成不动的东西，动画没要'));
    }
    const rigid = world[index]!;
    const rigidNormal = new Matrix3().getNormalMatrix(rigid);
    const normalMatrix = new Matrix3();
    // 镜像过的节点（缩放里有奇数个负数）面的绕向要反过来
    const flip = !bones && rigid.determinant() < 0;
    for (let i = 0; i < count; i++) {
      let m = rigid;
      let nm = rigidNormal;
      if (bones && joints && weights) {
        blend.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          const w = weights[i * 4 + k];
          const bone = bones[joints[i * 4 + k]];
          if (!(w > 0) || !bone) continue;
          sum += w;
          for (let e = 0; e < 16; e++) blend.elements[e] += bone.elements[e] * w;
        }
        if (sum > 1e-6) {
          for (let e = 0; e < 16; e++) blend.elements[e] /= sum;
          m = blend;
          nm = normalMatrix.getNormalMatrix(one.copy(blend));
        }
      }
      const to = (vertexAt + i) * 3;
      v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(m);
      positions[to] = v.x;
      positions[to + 1] = v.y;
      positions[to + 2] = v.z;
      v.set(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]).applyMatrix3(nm);
      const l = v.length();
      normals[to] = l > 1e-12 ? v.x / l : 0;
      normals[to + 1] = l > 1e-12 ? v.y / l : 1;
      normals[to + 2] = l > 1e-12 ? v.z / l : 0;
      if (uv) {
        uvs[(vertexAt + i) * 2] = uv[i * 2];
        uvs[(vertexAt + i) * 2 + 1] = uv[i * 2 + 1];
      }
    }
    const which = material(typeof prim.material === 'number' ? prim.material : -1);
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
      if (a >= count || b >= count || c >= count) continue;
      indices[faceAt * 3] = vertexAt + a;
      indices[faceAt * 3 + 1] = vertexAt + (flip ? c : b);
      indices[faceAt * 3 + 2] = vertexAt + (flip ? b : c);
      faceMaterial[faceAt++] = which;
    }
    vertexAt += count;
  }

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const p = positions[i + k];
      if (!Number.isFinite(p)) throw new Error(t('这个文件里的网格是坏的，读不了'));
      if (p < min[k]) min[k] = p;
      if (p > max[k]) max[k] = p;
    }
  }
  return {
    positions,
    normals,
    uvs,
    indices: faceAt === faceTotal ? indices : indices.slice(0, faceAt * 3),
    faceMaterial: faceAt === faceTotal ? faceMaterial : faceMaterial.slice(0, faceAt),
    materials,
    textures,
    min,
    max,
    notes: [...notes],
  };
}

/* ---------------- 大小、朝向 ---------------- */

export type ImportUnit = 'm' | 'cm' | 'mm' | 'fit';

/**
 * 文件里最长的那一边是 longest：猜它用的是什么单位，要乘多少才是米。
 * 当成米在 2 厘米–10 米之间就是米；不然依次试厘米、毫米，落在 2 厘米–4 米之间的就是它；都不像就缩放到半米
 */
export function guessUnit(longest: number): { scale: number; unit: ImportUnit } {
  if (!(longest > 0) || !Number.isFinite(longest)) return { scale: 1, unit: 'm' };
  if (longest >= 0.02 && longest <= 10) return { scale: 1, unit: 'm' };
  for (const [scale, unit] of [
    [0.01, 'cm'],
    [0.001, 'mm'],
  ] as const) {
    if (longest * scale >= 0.02 && longest * scale <= 4) return { scale, unit };
  }
  return { scale: 0.5 / longest, unit: 'fit' };
}

export interface ImportOptions {
  /** 素材的编号（my-…） */
  id: string;
  /** 文件里的数乘多少是米 */
  scale: number;
  /** 往前翻几个 90°（绕左右那根轴）：1 是把 Z 朝上的文件转正 */
  upright?: number;
  /** 绕竖直轴转几个 90°（让正面朝前） */
  yaw?: number;
}

/** 转朝向用的矩阵（按行写的 9 个数）：先翻、再转朝向。都是 90° 的倍数，里面只有 0、1、-1 */
export function importTurn(upright = 0, yaw = 0): number[] {
  const quarter = (n: number): [number, number] => [[1, 0, -1, 0][((n % 4) + 4) % 4], [0, 1, 0, -1][((n % 4) + 4) % 4]];
  const [cu, su] = quarter(upright);
  const [cy, sy] = quarter(yaw);
  // 绕 X 转 -90°×upright（+Z 翻到 +Y），再绕 Y 转 90°×yaw
  const rx = [1, 0, 0, 0, cu, su, 0, -su, cu];
  const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(ry[r * 3] * rx[c] + ry[r * 3 + 1] * rx[3 + c] + ry[r * 3 + 2] * rx[6 + c]);
  return out;
}

/** 照这个朝向摆好以后占多大（宽、高、深，文件自己的单位） */
export function importExtent(source: Pick<ImportSource, 'min' | 'max'>, upright = 0, yaw = 0): Vec3 {
  const m = importTurn(upright, yaw);
  const d = [0, 1, 2].map((k) => source.max[k] - source.min[k]);
  return [0, 1, 2].map((r) => Math.abs(m[r * 3]) * d[0] + Math.abs(m[r * 3 + 1]) * d[1] + Math.abs(m[r * 3 + 2]) * d[2]) as Vec3;
}

/**
 * 碰撞用的粗网格：把空间切成小格子，落在同一格里的点并成一个（取它们的平均），并没了的面丢掉。
 * 格子从细到粗试，试到面数不超过 budget 为止。偏离原来的表面不超过半个格子
 */
export function clusterMesh(positions: ArrayLike<number>, indices: ArrayLike<number>, size: Vec3, budget = TOUCH_BUDGET): { positions: Float32Array; indices: Uint32Array } {
  const longest = Math.max(size[0], size[1], size[2], 1e-6);
  let best: { positions: Float32Array; indices: Uint32Array } | null = null;
  for (const cells of [48, 36, 28, 22, 17, 13, 10, 8, 6, 4]) {
    const cell = longest / cells;
    const at = new Map<number, number>();
    const sums: number[] = [];
    const remap = new Int32Array(positions.length / 3);
    for (let i = 0; i < remap.length; i++) {
      const x = Math.round(positions[i * 3] / cell) + 512;
      const y = Math.round(positions[i * 3 + 1] / cell) + 512;
      const z = Math.round(positions[i * 3 + 2] / cell) + 512;
      const key = (x * 1024 + y) * 1024 + z;
      let to = at.get(key);
      if (to === undefined) {
        to = sums.length / 4;
        at.set(key, to);
        sums.push(0, 0, 0, 0);
      }
      sums[to * 4] += positions[i * 3];
      sums[to * 4 + 1] += positions[i * 3 + 1];
      sums[to * 4 + 2] += positions[i * 3 + 2];
      sums[to * 4 + 3]++;
      remap[i] = to;
    }
    const faces: number[] = [];
    const seen = new Set<string>();
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const [a, b, c] = [remap[indices[i]], remap[indices[i + 1]], remap[indices[i + 2]]];
      if (a === b || b === c || a === c) continue;
      // 同三个点的面（正反都算）只留一个
      const key = [a, b, c].sort((p, q) => p - q).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      faces.push(a, b, c);
    }
    // 只留用到的点
    const used = new Map<number, number>();
    const outIndices = Uint32Array.from(faces, (i) => {
      let to = used.get(i);
      if (to === undefined) used.set(i, (to = used.size));
      return to;
    });
    const outPositions = new Float32Array(used.size * 3);
    for (const [from, to] of used) for (let k = 0; k < 3; k++) outPositions[to * 3 + k] = sums[from * 4 + k] / sums[from * 4 + 3];
    best = { positions: outPositions, indices: outIndices };
    if (faces.length / 3 <= budget && used.size <= 65535) break;
  }
  return best!;
}

/** 照定好的大小、朝向转成素材文件 */
export function buildImport(source: ImportSource, options: ImportOptions): RealAssetFile {
  const m = importTurn(options.upright, options.yaw);
  const scale = options.scale > 0 && Number.isFinite(options.scale) ? options.scale : 1;
  const n = source.positions.length / 3;
  const pos = new Float64Array(n * 3);
  const nor = new Float64Array(n * 3);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const [x, y, z] = [source.positions[i * 3], source.positions[i * 3 + 1], source.positions[i * 3 + 2]];
    const [a, b, c] = [source.normals[i * 3], source.normals[i * 3 + 1], source.normals[i * 3 + 2]];
    for (let k = 0; k < 3; k++) {
      const p = (m[k * 3] * x + m[k * 3 + 1] * y + m[k * 3 + 2] * z) * scale;
      pos[i * 3 + k] = p;
      nor[i * 3 + k] = m[k * 3] * a + m[k * 3 + 1] * b + m[k * 3 + 2] * c;
      if (p < lo[k]) lo[k] = p;
      if (p > hi[k]) hi[k] = p;
    }
  }
  const shift = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  // 尺寸留到毫米，网格跟着凑成正好这么大；薄得没有厚度的（一张纸）当成 1 毫米厚，网格不拉
  const size = [0, 1, 2].map((k) => Math.max(0.001, Math.round((hi[k] - lo[k]) * 1000) / 1000)) as Vec3;
  const fit = [0, 1, 2].map((k) => (hi[k] - lo[k] > 1e-6 ? size[k] / (hi[k] - lo[k]) : 1));

  // 位置、法线、贴图坐标都一样的点合成一个
  const remap = new Int32Array(n);
  const seen = new Map<string, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = [0, 1, 2].map((k) => Math.round((pos[i * 3 + k] - shift[k]) * fit[k] * 1e5) / 1e5 + 0);
    const q = [0, 1, 2].map((k) => Math.max(-127, Math.min(127, Math.round(nor[i * 3 + k] * 127))));
    const w = [Math.round(source.uvs[i * 2] * 1e5) / 1e5 + 0, Math.round(source.uvs[i * 2 + 1] * 1e5) / 1e5 + 0];
    const key = `${p[0]},${p[1]},${p[2]}|${q[0]},${q[1]},${q[2]}|${w[0]},${w[1]}`;
    let at = seen.get(key);
    if (at === undefined) {
      at = positions.length / 3;
      seen.set(key, at);
      positions.push(p[0], p[1], p[2]);
      normals.push(q[0] / 127, q[1] / 127, q[2] / 127);
      uvs.push(w[0], w[1]);
    }
    remap[i] = at;
  }

  // 同一个材质的面排在一起；面积是零的丢掉；没用上的材质、贴图不带
  const faces = source.faceMaterial.length;
  const usedMaterials = [...new Set(source.faceMaterial)].sort((a, b) => a - b);
  const indices: number[] = [];
  const groups: RealGroup[] = [];
  const materials: RealMaterial[] = [];
  const textures: RealTexture[] = [];
  const textureAt = new Map<number, number>();
  const texture = (index: number | undefined): number | undefined => {
    if (index === undefined || !source.textures[index]) return undefined;
    let at = textureAt.get(index);
    if (at === undefined) {
      at = textures.length;
      textureAt.set(index, at);
      textures.push(source.textures[index]);
    }
    return at;
  };
  for (const which of usedMaterials) {
    const start = indices.length;
    for (let f = 0; f < faces; f++) {
      if (source.faceMaterial[f] !== which) continue;
      const [a, b, c] = [remap[source.indices[f * 3]], remap[source.indices[f * 3 + 1]], remap[source.indices[f * 3 + 2]]];
      if (a === b || b === c || a === c) continue;
      indices.push(a, b, c);
    }
    if (indices.length === start) continue;
    const from = source.materials[which];
    const { map: _map, normal: _normal, arm: _arm, ao: _ao, ...plain } = from;
    const [map, normal, arm] = [texture(from.map), texture(from.normal), texture(from.arm)];
    groups.push({ start, count: indices.length - start, material: materials.length });
    materials.push({
      ...plain,
      ...(map === undefined ? {} : { map }),
      ...(normal === undefined ? {} : { normal }),
      ...(arm === undefined ? {} : { arm }),
      ...(arm !== undefined && from.ao ? { ao: true as const } : {}),
    });
  }
  if (!indices.length) throw new Error(t('这个文件里没有能用的网格'));
  const touch = indices.length / 3 > TOUCH_BUDGET ? clusterMesh(positions, indices, size) : null;
  return {
    id: options.id,
    size,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: Uint32Array.from(indices),
    groups,
    materials,
    textures,
    ...(touch && touch.indices.length ? { touch } : {}),
  };
}
