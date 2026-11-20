/**
 * 写实款道具的文件（见 docs/props-plan.md 第 6 期）：一件一个文件，网格、材质、贴图都在里面。
 * 不进安装包，放在下载站上，用到哪件才下哪件（见 realLoad.ts）。tools/build-props-real.ts 写，这里读；纯函数。
 *
 * 排法（都是小端）：
 *   4 字节  'OCP1'
 *   4 字节  说明有多少字节（Uint32）
 *   说明    一段 JSON（UTF-8），补齐到 4 字节
 *   数据    依次是点（Float32 ×3）、法线（Int8 ×3）、贴图坐标（Float32 ×2）、面（点不超过 65535 个时 Uint16，否则 Uint32）、
 *           碰撞用的粗网格的点（Float32 ×3）和面（Uint16 ×3，没有粗网格就没有这两段）、一张张贴图原样的字节；每段补齐到 4 字节
 *
 * 网格是原样的大小，原点在底面正中，正面朝 +Z；贴图坐标照 glTF 的约定（左上角是原点）。
 */
import type { Vec3 } from '../model/spec';
import { t } from '../i18n';

/** 一批面用的材质。贴图那几项是 textures 里的下标 */
export interface RealMaterial {
  name: string;
  /** 底色贴图（sRGB） */
  map?: number;
  /** 法线贴图（OpenGL 的朝向：绿色朝上） */
  normal?: number;
  /** 粗糙度的贴图：绿是粗糙度、蓝是金属度（照 glTF 的排法） */
  arm?: number;
  /** arm 那张的红色通道是不是缝隙里的暗（Poly Haven 的三合一贴图是；只有粗糙度的那种不是） */
  ao?: true;
  /** 底色（线性空间，0–1）；有贴图时和贴图相乘 */
  color: [number, number, number];
  roughness: number;
  metalness: number;
  doubleSided?: boolean;
}

export interface RealGroup {
  /** 从第几个面的下标开始、一共多少个下标（都是 3 的倍数） */
  start: number;
  count: number;
  material: number;
}

export interface RealTexture {
  /** image/jpeg 或 image/png */
  mime: string;
  bytes: Uint8Array;
}

export interface RealAssetFile {
  id: string;
  /** 原样多大：宽、高、深（米） */
  size: Vec3;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  groups: RealGroup[];
  materials: RealMaterial[];
  textures: RealTexture[];
  /** 碰撞用的粗网格（面多的家具才有）：手脚碰到它停在表面、查穿插时用，比照着画的那份省得多 */
  touch?: { positions: Float32Array; indices: Uint32Array };
}

const MAGIC = 0x3150434f;
const pad4 = (n: number) => (n + 3) & ~3;

interface Header {
  id: string;
  size: Vec3;
  vertices: number;
  triangles: number;
  groups: RealGroup[];
  materials: RealMaterial[];
  textures: { mime: string; bytes: number }[];
  touch?: { vertices: number; triangles: number };
}

/** 写成文件 */
export function encodeRealAsset(asset: RealAssetFile): Uint8Array {
  const vertices = asset.positions.length / 3;
  const wide = vertices > 65535;
  if (asset.touch && asset.touch.positions.length / 3 > 65535) throw new Error('碰撞用的粗网格点太多');
  const packed = new Int8Array(vertices * 3);
  for (let i = 0; i < packed.length; i++) packed[i] = Math.max(-127, Math.min(127, Math.round(asset.normals[i] * 127)));
  const header: Header = {
    id: asset.id,
    size: asset.size,
    vertices,
    triangles: asset.indices.length / 3,
    groups: asset.groups,
    materials: asset.materials,
    textures: asset.textures.map((x) => ({ mime: x.mime, bytes: x.bytes.byteLength })),
    ...(asset.touch ? { touch: { vertices: asset.touch.positions.length / 3, triangles: asset.touch.indices.length / 3 } } : {}),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const bytesOf = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const parts: Uint8Array[] = [
    bytesOf(asset.positions),
    bytesOf(packed),
    bytesOf(asset.uvs),
    bytesOf(wide ? asset.indices : Uint16Array.from(asset.indices)),
    ...(asset.touch ? [bytesOf(asset.touch.positions), bytesOf(Uint16Array.from(asset.touch.indices))] : []),
    ...asset.textures.map((x) => x.bytes),
  ];
  const total = 8 + pad4(json.byteLength) + parts.reduce((n, p) => n + pad4(p.byteLength), 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, json.byteLength, true);
  out.set(json, 8);
  // JSON 后面补的是空格，别的段补 0
  out.fill(0x20, 8 + json.byteLength, 8 + pad4(json.byteLength));
  let at = 8 + pad4(json.byteLength);
  for (const part of parts) {
    out.set(part, at);
    at += pad4(part.byteLength);
  }
  return out;
}

const broken = () => new Error(t('道具素材的文件坏了'));

/** 读文件。不是这种文件、长度对不上（下了一半）都报错 */
export function parseRealAsset(buffer: ArrayBuffer): RealAssetFile {
  if (buffer.byteLength < 8) throw broken();
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw broken();
  const jsonBytes = view.getUint32(4, true);
  if (8 + jsonBytes > buffer.byteLength) throw broken();
  let header: Header;
  try {
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, jsonBytes))) as Header;
  } catch {
    throw broken();
  }
  const { vertices, triangles } = header;
  if (!Number.isInteger(vertices) || !Number.isInteger(triangles) || vertices <= 0 || triangles <= 0) throw broken();
  const wide = vertices > 65535;
  let at = 8 + pad4(jsonBytes);
  const take = (bytes: number): ArrayBuffer => {
    if (bytes < 0 || at + bytes > buffer.byteLength) throw broken();
    const piece = buffer.slice(at, at + bytes);
    at += pad4(bytes);
    return piece;
  };
  const positions = new Float32Array(take(vertices * 12));
  const packed = new Int8Array(take(vertices * 3));
  const normals = new Float32Array(vertices * 3);
  for (let i = 0; i < vertices; i++) {
    const [x, y, z] = [packed[i * 3], packed[i * 3 + 1], packed[i * 3 + 2]];
    const l = Math.hypot(x, y, z) || 1;
    normals[i * 3] = x / l;
    normals[i * 3 + 1] = y / l;
    normals[i * 3 + 2] = z / l;
  }
  const uvs = new Float32Array(take(vertices * 8));
  const indices = wide ? new Uint32Array(take(triangles * 12)) : Uint32Array.from(new Uint16Array(take(triangles * 6)));
  let touch: RealAssetFile['touch'];
  if (header.touch) {
    const points = new Float32Array(take(header.touch.vertices * 12));
    touch = { positions: points, indices: Uint32Array.from(new Uint16Array(take(header.touch.triangles * 6))) };
  }
  const textures = (header.textures ?? []).map((x) => ({ mime: x.mime, bytes: new Uint8Array(take(x.bytes)) }));
  if (at !== buffer.byteLength) throw broken();
  for (const index of indices) if (index >= vertices) throw broken();
  const groups = header.groups ?? [];
  const materials = header.materials ?? [];
  for (const g of groups) if (g.start < 0 || g.start + g.count > indices.length || !materials[g.material]) throw broken();
  for (const m of materials) for (const slot of [m.map, m.normal, m.arm]) if (slot !== undefined && !textures[slot]) throw broken();
  return { id: header.id, size: header.size, positions, normals, uvs, indices, groups, materials, textures, touch };
}
