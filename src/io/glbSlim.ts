/**
 * 给 GLB / VRM 文件「瘦身」：工坊只用每种材质的底色贴图，别的图（法线、阴影色、高光、缩略图 …）用不到，
 * 换成 1×1 的占位图。网格、骨骼、表情、扩展里的说明都原样留着。加工角色文件时用（tools/build-characters.ts）。
 * 纯函数，不依赖浏览器。
 */
const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** 一张 1×1 的白色 PNG */
const TINY_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 255, 255, 255, 127,
  0, 9, 251, 3, 253, 42, 134, 227, 138, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

/** 把用不到的图换成占位图，重新排一遍二进制块 */
export function slim(file: Uint8Array): { out: Uint8Array; dropped: number } {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('不是 GLB 文件');
  let offset = 12;
  let json: any = null;
  let bin: Uint8Array | null = null;
  while (offset + 8 <= file.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(data));
    else if (type === CHUNK_BIN && !bin) bin = data;
    offset += 8 + length;
  }
  if (!json || !bin) throw new Error('GLB 里缺 JSON 或二进制块');

  const used = new Set<number>();
  for (const material of json.materials ?? []) {
    const texture = material.pbrMetallicRoughness?.baseColorTexture?.index;
    if (texture !== undefined) used.add(json.textures[texture].source);
  }
  const placeholder = TINY_PNG;
  const swapped = new Set<number>();
  let dropped = 0;
  (json.images ?? []).forEach((image: { bufferView?: number; mimeType?: string }, i: number) => {
    if (used.has(i) || image.bufferView === undefined) return;
    swapped.add(image.bufferView);
    image.mimeType = 'image/png';
    dropped++;
  });

  const pieces: Uint8Array[] = [];
  let total = 0;
  for (const [index, bufferView] of (json.bufferViews as { buffer: number; byteOffset?: number; byteLength: number }[]).entries()) {
    if (bufferView.buffer !== 0) throw new Error('只认一个二进制块的 GLB');
    const data = swapped.has(index) ? placeholder : bin.subarray(bufferView.byteOffset ?? 0, (bufferView.byteOffset ?? 0) + bufferView.byteLength);
    const padded = new Uint8Array(Math.ceil(data.length / 4) * 4);
    padded.set(data);
    bufferView.byteOffset = total;
    bufferView.byteLength = data.length;
    pieces.push(padded);
    total += padded.length;
  }
  json.buffers[0].byteLength = total;
  json.asset = { ...json.asset, extras: { ...json.asset?.extras, ocWorkshop: 'OC 白模工坊加工过：底色以外的贴图换成了 1×1 的占位图，别的没动' } };

  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + total);
  const head = new DataView(out.buffer);
  head.setUint32(0, MAGIC, true);
  head.setUint32(4, 2, true);
  head.setUint32(8, out.length, true);
  head.setUint32(12, jsonLength, true);
  head.setUint32(16, CHUNK_JSON, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  head.setUint32(20 + jsonLength, total, true);
  head.setUint32(24 + jsonLength, CHUNK_BIN, true);
  let at = 28 + jsonLength;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return { out, dropped };
}
