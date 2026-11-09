/**
 * GLB（glTF 2.0 二进制）读取器，只做读成品角色用得到的那一小部分：
 * 拆出 JSON 和二进制块，按 accessor 取数。VRM（0.x 和 1.0）就是带了扩展的 GLB，一样读。
 * 纯函数，不依赖浏览器，测试里可以直接跑。
 */

import { t } from '../i18n';

export interface GlbDoc {
  /** glTF 的 JSON。结构松散，这里不逐项声明类型，用的地方自己取 */
  json: any;
  bin: DataView;
}

const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export function readGlb(buffer: ArrayBuffer): GlbDoc {
  const view = new DataView(buffer);
  if (view.byteLength < 20 || view.getUint32(0, true) !== MAGIC) throw new Error(t('不是 GLB 文件'));
  if (view.getUint32(4, true) !== 2) throw new Error(t('只认 glTF 2.0 的 GLB'));
  let offset = 12;
  let json: unknown = null;
  let bin: DataView | null = null;
  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)));
    else if (type === CHUNK_BIN && !bin) bin = new DataView(buffer, start, length);
    offset = start + length;
  }
  if (!json || !bin) throw new Error(t('GLB 里缺 JSON 或二进制块'));
  return { json, bin };
}

const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** 每种分量类型：占几个字节、怎么读、「归一化」时除以多少 */
const COMPONENT: Record<number, [bytes: number, read: (view: DataView, at: number) => number, unit: number]> = {
  5120: [1, (v, at) => v.getInt8(at), 127],
  5121: [1, (v, at) => v.getUint8(at), 255],
  5122: [2, (v, at) => v.getInt16(at, true), 32767],
  5123: [2, (v, at) => v.getUint16(at, true), 65535],
  5125: [4, (v, at) => v.getUint32(at, true), 1],
  5126: [4, (v, at) => v.getFloat32(at, true), 1],
};

/**
 * 把一个 accessor 读成一串数（标了「归一化」的整数换算成 0…1 / -1…1）。
 * 稀疏的（sparse：只记改了的那几个元素，VRM 1.0 的表情常这么存）也读：没记的是 0（或者 bufferView 里的值）
 */
export function readAccessor(doc: GlbDoc, index: number): Float32Array {
  const acc = doc.json.accessors[index];
  const size = SIZE[acc.type];
  const [bytes, read, unit] = COMPONENT[acc.componentType];
  const out = new Float32Array(acc.count * size);
  const scale = acc.normalized ? 1 / unit : 1;
  if (acc.bufferView !== undefined) {
    const view = doc.json.bufferViews[acc.bufferView];
    const stride = view.byteStride || size * bytes;
    const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    for (let i = 0; i < acc.count; i++) {
      for (let k = 0; k < size; k++) out[i * size + k] = read(doc.bin, start + i * stride + k * bytes) * scale;
    }
  }
  if (acc.sparse) {
    const { count, indices, values } = acc.sparse;
    const [indexBytes, readIndex] = COMPONENT[indices.componentType];
    const at = (doc.json.bufferViews[indices.bufferView].byteOffset ?? 0) + (indices.byteOffset ?? 0);
    const from = (doc.json.bufferViews[values.bufferView].byteOffset ?? 0) + (values.byteOffset ?? 0);
    for (let s = 0; s < count; s++) {
      const i = readIndex(doc.bin, at + s * indexBytes);
      for (let k = 0; k < size; k++) out[i * size + k] = read(doc.bin, from + (s * size + k) * bytes) * scale;
    }
  }
  return out;
}

/** 一个 bufferView 的原始字节（图片就是这样存的） */
export function readBufferView(doc: GlbDoc, index: number): Uint8Array {
  const view = doc.json.bufferViews[index];
  return new Uint8Array(doc.bin.buffer, doc.bin.byteOffset + (view.byteOffset ?? 0), view.byteLength);
}
