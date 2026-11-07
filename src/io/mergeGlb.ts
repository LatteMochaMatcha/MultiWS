/**
 * 把几个 GLB 合成一个（导出整个场景，见 docs/scene-plan.md）：每个原来的文件是一个角色，
 * 合起来以后每个角色是一个父节点（名字、在地上的位置、朝向），原来文件里的东西原样挂在它下面。
 * 网格、材质、贴图、骨架（蒙皮）都照搬，只是各种下标往后挪；二进制数据接在一起。
 * 带骨骼的也行：每个角色一副自己的骨架，进 Blender 是几个骨架物体。
 */

type Json = Record<string, any>;

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** 读 GLB：JSON 和二进制块 */
export function readGlb(buffer: ArrayBuffer): { json: Json; bin: Uint8Array } {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB');
  let json: Json | null = null;
  let bin = new Uint8Array(0);
  for (let at = 12; at + 8 <= buffer.byteLength; ) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const data = new Uint8Array(buffer, at + 8, length);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(data)) as Json;
    else if (type === CHUNK_BIN) bin = data;
    at += 8 + length;
  }
  if (!json) throw new Error('GLB without JSON');
  return { json, bin };
}

/** 写 GLB：JSON 块补空格、二进制块补 0，对齐到 4 字节 */
export function packGlb(json: Json, bin: Uint8Array): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binLength = Math.ceil(bin.length / 4) * 4;
  const total = 12 + 8 + jsonLength + (binLength ? 8 + binLength : 0);
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  bytes.set(text, 20);
  bytes.fill(0x20, 20 + text.length, 20 + jsonLength);
  if (binLength) {
    const at = 20 + jsonLength;
    view.setUint32(at, binLength, true);
    view.setUint32(at + 4, CHUNK_BIN, true);
    bytes.set(bin, at + 8);
  }
  return out;
}

export interface GlbPart {
  glb: ArrayBuffer;
  /** 父节点的名字 */
  name: string;
  /** 在地上站在哪（米）、朝哪（度，绕竖直轴，从上往下看逆时针） */
  x: number;
  z: number;
  yaw: number;
}

const shift = (v: unknown, by: number) => (typeof v === 'number' ? v + by : v);

/** 材质里引用贴图的几处 */
function shiftTextures(material: Json, by: number) {
  const fix = (info: Json | undefined) => {
    if (info && typeof info.index === 'number') info.index += by;
  };
  const pbr = material.pbrMetallicRoughness as Json | undefined;
  fix(pbr?.baseColorTexture);
  fix(pbr?.metallicRoughnessTexture);
  fix(material.normalTexture);
  fix(material.occlusionTexture);
  fix(material.emissiveTexture);
}

export function mergeGlbs(parts: readonly GlbPart[]): ArrayBuffer {
  const out: Json = {
    asset: { version: '2.0', generator: 'OC 白模工坊 v2' },
    scene: 0,
    scenes: [{ nodes: [] as number[] }],
    nodes: [] as Json[],
    meshes: [] as Json[],
    materials: [] as Json[],
    textures: [] as Json[],
    images: [] as Json[],
    samplers: [] as Json[],
    accessors: [] as Json[],
    bufferViews: [] as Json[],
    skins: [] as Json[],
    buffers: [{ byteLength: 0 }],
  };
  const used = new Set<string>();
  const required = new Set<string>();
  const copyrights: string[] = [];
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  for (const part of parts) {
    const { json, bin } = readGlb(part.glb);
    const at = {
      node: out.nodes.length + 1, // 父节点排在前面
      mesh: out.meshes.length,
      material: out.materials.length,
      texture: out.textures.length,
      image: out.images.length,
      sampler: out.samplers.length,
      accessor: out.accessors.length,
      view: out.bufferViews.length,
      skin: out.skins.length,
    };
    // 二进制接在后面（对齐 4 字节）
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      byteLength += pad;
    }
    const binStart = byteLength;
    chunks.push(bin);
    byteLength += bin.length;

    for (const v of (json.bufferViews ?? []) as Json[]) out.bufferViews.push({ ...v, buffer: 0, byteOffset: (v.byteOffset ?? 0) + binStart });
    for (const a of (json.accessors ?? []) as Json[]) out.accessors.push({ ...a, bufferView: shift(a.bufferView, at.view) });
    for (const img of (json.images ?? []) as Json[]) out.images.push({ ...img, bufferView: shift(img.bufferView, at.view) });
    for (const s of (json.samplers ?? []) as Json[]) out.samplers.push({ ...s });
    for (const tex of (json.textures ?? []) as Json[]) out.textures.push({ ...tex, source: shift(tex.source, at.image), sampler: shift(tex.sampler, at.sampler) });
    for (const m of (json.materials ?? []) as Json[]) {
      const copy = JSON.parse(JSON.stringify(m)) as Json;
      shiftTextures(copy, at.texture);
      out.materials.push(copy);
    }
    for (const mesh of (json.meshes ?? []) as Json[]) {
      const copy = JSON.parse(JSON.stringify(mesh)) as Json;
      for (const prim of (copy.primitives ?? []) as Json[]) {
        for (const key of Object.keys(prim.attributes ?? {})) prim.attributes[key] += at.accessor;
        if (typeof prim.indices === 'number') prim.indices += at.accessor;
        if (typeof prim.material === 'number') prim.material += at.material;
        for (const target of (prim.targets ?? []) as Json[]) for (const key of Object.keys(target)) target[key] += at.accessor;
      }
      out.meshes.push(copy);
    }
    for (const skin of (json.skins ?? []) as Json[]) {
      out.skins.push({
        ...skin,
        joints: (skin.joints as number[]).map((j) => j + at.node),
        skeleton: shift(skin.skeleton, at.node),
        inverseBindMatrices: shift(skin.inverseBindMatrices, at.accessor),
      });
    }
    // 父节点：照位置、朝向摆
    const a = (part.yaw * Math.PI) / 180;
    const holder: Json = { name: part.name, translation: [part.x, 0, part.z], rotation: [0, Math.sin(a / 2), 0, Math.cos(a / 2)], children: [] as number[] };
    const holderIndex = out.nodes.length;
    out.nodes.push(holder);
    out.scenes[0].nodes.push(holderIndex);
    for (const node of (json.nodes ?? []) as Json[]) {
      const copy: Json = { ...node };
      if (typeof copy.mesh === 'number') copy.mesh += at.mesh;
      if (typeof copy.skin === 'number') copy.skin += at.skin;
      if (Array.isArray(copy.children)) copy.children = (copy.children as number[]).map((c) => c + at.node);
      out.nodes.push(copy);
    }
    const sceneNodes = ((json.scenes?.[json.scene ?? 0]?.nodes ?? []) as number[]).map((n) => n + at.node);
    holder.children = sceneNodes;
    for (const e of (json.extensionsUsed ?? []) as string[]) used.add(e);
    for (const e of (json.extensionsRequired ?? []) as string[]) required.add(e);
    const c = json.asset?.copyright;
    if (typeof c === 'string' && c && !copyrights.includes(c)) copyrights.push(c);
  }

  out.buffers[0].byteLength = byteLength;
  // 空的数组不写（有的读取器不认空数组）
  for (const key of ['meshes', 'materials', 'textures', 'images', 'samplers', 'accessors', 'bufferViews', 'skins'] as const) if (!out[key].length) delete out[key];
  if (!byteLength) delete out.buffers;
  if (used.size) out.extensionsUsed = [...used];
  if (required.size) out.extensionsRequired = [...required];
  if (copyrights.length) out.asset.copyright = copyrights.join('；');
  const bin = new Uint8Array(byteLength);
  let offset = 0;
  for (const c of chunks) {
    bin.set(c, offset);
    offset += c.length;
  }
  return packGlb(out, bin);
}
