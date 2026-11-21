// 自己导入素材（docs/import-plan.md 第 1 期）：读 GLB、定大小朝向、转成素材文件、「我的」清单、道具数据
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { shapeOf, touchShapeOf } from '../src/geometry/propMesh';
import { writeGlb } from '../src/io/glb';
import { readGlb } from '../src/io/glbRead';
import { propGlbParts } from '../src/io/propFiles';
import { sha256Hex, sha256Plain } from '../src/io/sha256';
import { type SceneProp, clampProp, makeAssetProp, normalizeProps } from '../src/model/props';
import { type UserAsset, forgetUserAsset, isUserAssetId, propAsset, registerUserAsset, skinnedAsset, userAsset, userAssets } from '../src/props/catalog';
import { TOUCH_BUDGET, buildImport, clusterMesh, guessUnit, importExtent, importTurn, readImportGlb, sniffImage } from '../src/props/importMesh';
import { dropUserAsset, installUserAsset, propAssetShape, propTouchShape, realAssetFile } from '../src/props/library';
import { encodeRealAsset, parseRealAsset } from '../src/props/realFile';
import { addUserAsset, cleanUserAsset, loadUserAsset, removeUserAsset, userAssetId } from '../src/props/userStore';
import { propKindLabel, propLabel } from '../src/view/propNames';

const ID = 'my-0123456789abcdef';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);

/** 把 glTF 的 JSON 和二进制块拼成一个 GLB */
function glbOf(json: object, bin: Uint8Array = new Uint8Array(4)): ArrayBuffer {
  const pad = (bytes: Uint8Array, fill: number) => {
    const out = new Uint8Array((bytes.length + 3) & ~3).fill(fill);
    out.set(bytes);
    return out;
  };
  const j = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const b = pad(bin, 0);
  const out = new Uint8Array(12 + 8 + j.length + 8 + b.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, j.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(j, 20);
  view.setUint32(20 + j.length, b.length, true);
  view.setUint32(24 + j.length, 0x004e4942, true);
  out.set(b, 28 + j.length);
  return out.buffer;
}

/** 一个三角形（顶点 (0,0,0) (1,0,0) (0,1,0)，朝 +Z），不带法线；node 是那个节点的摆放 */
function triangle(node: object = {}, extra: object = {}): ArrayBuffer {
  const bin = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  return glbOf(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, ...node }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36 }],
      ...extra,
    },
    bin,
  );
}

/** 一个箱子（宽 w、高 h、深 d，底面在 y0），每个面两个三角，共 24 个点 */
function boxMesh(w: number, h: number, d: number, y0 = 0) {
  const p: number[] = [];
  const n: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  const half = [w / 2, h / 2, d / 2];
  for (const [normal, u, v] of faces) {
    const at = p.length / 3;
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const point = [0, 1, 2].map((k) => (normal[k] + u[k] * a + v[k] * b) * half[k]);
      p.push(point[0], point[1] + h / 2 + y0, point[2]);
      n.push(...normal);
      uv.push((a + 1) / 2, (b + 1) / 2);
    }
    idx.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  return { positions: new Float32Array(p), normals: new Float32Array(n), uvs: new Float32Array(uv), indices: new Uint32Array(idx) };
}

/** 细分过的一块板（n × n 格，两面），面数多得要做粗网格 */
function slab(n: number) {
  const p: number[] = [];
  const idx: number[] = [];
  for (const y of [0, 0.04]) {
    const at = p.length / 3;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) p.push(i / n - 0.5, y, j / n - 0.5);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const a = at + i * (n + 1) + j;
        const quad = [a, a + 1, a + n + 2, a, a + n + 2, a + n + 1];
        idx.push(...(y ? quad : quad.reverse()));
      }
    }
  }
  return { positions: new Float32Array(p), indices: new Uint32Array(idx) };
}

const meta = (file: { id: string; size: [number, number, number]; positions: Float32Array; indices: Uint32Array }, name = '我的杯子'): UserAsset => ({
  id: file.id,
  name,
  group: 'other',
  size: file.size,
  vertices: file.positions.length / 3,
  triangles: file.indices.length / 3,
  bytes: 0,
  added: 1,
});

afterEach(() => {
  for (const a of userAssets()) {
    forgetUserAsset(a.id);
    dropUserAsset(a.id);
  }
});

describe('SHA-256、素材的编号', () => {
  it('自己算的和 Node 算的一样（空的、短的、正好卡在一块的边上的、长的）', async () => {
    for (const length of [0, 3, 55, 56, 63, 64, 65, 1000, 70000]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 131 + 7) & 255);
      const want = createHash('sha256').update(bytes).digest('hex');
      expect(sha256Plain(bytes)).toBe(want);
      expect(await sha256Hex(bytes.buffer)).toBe(want);
    }
  });

  it('编号是 my- 加校验值的前 16 位：同一个文件同一个编号，改一个字节就换', async () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const id = await userAssetId(a.buffer);
    expect(id).toBe(`my-${createHash('sha256').update(a).digest('hex').slice(0, 16)}`);
    expect(isUserAssetId(id)).toBe(true);
    expect(await userAssetId(new Uint8Array([1, 2, 3, 5]).buffer)).not.toBe(id);
    for (const bad of ['chair', 'my-123', 'my-0123456789ABCDEF', 'my-0123456789abcdef0', 5, undefined]) expect(isUserAssetId(bad)).toBe(false);
  });
});

describe('读 GLB', () => {
  it('带贴图的箱子：点、面、材质、贴图都取出来', () => {
    const box = boxMesh(0.4, 0.8, 0.2);
    const glb = writeGlb([{ name: 'box', ...box, material: { name: 'wood', color: 0xffffff, factor: [0.5, 0.25, 1, 1], image: 0, doubleSided: true } }], {
      images: [{ mime: 'image/png', bytes: PNG }],
    });
    const source = readImportGlb(glb);
    expect(source.positions.length / 3).toBe(24);
    expect(source.faceMaterial.length).toBe(12);
    expect(source.min.map((v) => +v.toFixed(4))).toEqual([-0.2, 0, -0.1]);
    expect(source.max.map((v) => +v.toFixed(4))).toEqual([0.2, 0.8, 0.1]);
    expect(source.materials).toEqual([{ name: 'wood', map: 0, color: [0.5, 0.25, 1], roughness: expect.any(Number), metalness: expect.any(Number), doubleSided: true }]);
    expect(source.textures).toEqual([{ mime: 'image/png', bytes: PNG }]);
    expect(source.notes).toEqual([]);
  });

  it('照节点的摆放拼：挪了、放大了的照挪、照放大；镜像过的面绕向反过来', () => {
    const moved = readImportGlb(triangle({ translation: [10, 0, 0], scale: [2, 2, 2] }));
    expect([...moved.positions]).toEqual([10, 0, 0, 12, 0, 0, 10, 2, 0]);
    expect([...moved.indices]).toEqual([0, 1, 2]);
    const mirrored = readImportGlb(triangle({ scale: [-1, 1, 1] }));
    expect([...mirrored.positions]).toEqual([0, 0, 0, -1, 0, 0, 0, 1, 0]);
    expect([...mirrored.indices]).toEqual([0, 2, 1]);
  });

  it('没带法线的照面的朝向现算', () => {
    const source = readImportGlb(triangle());
    expect([...source.normals]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });

  it('带骨骼的照骨骼现在的摆放算成不动的样子，说一声', () => {
    // 一根骨骼往上挪了 1：三个点全跟着它
    const bin = new Uint8Array(36 + 12 + 48);
    bin.set(new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer), 0);
    bin.set(new Uint8Array(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]).buffer), 48);
    const glb = glbOf(
      {
        asset: { version: '2.0' },
        scenes: [{ nodes: [0, 1] }],
        nodes: [{ mesh: 0, skin: 0, translation: [99, 99, 99] }, { translation: [0, 1, 0] }],
        skins: [{ joints: [1] }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] }],
        accessors: [
          { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
          { bufferView: 1, componentType: 5121, count: 3, type: 'VEC4' },
          { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
        ],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: 36 },
          { buffer: 0, byteOffset: 36, byteLength: 12 },
          { buffer: 0, byteOffset: 48, byteLength: 48 },
        ],
        buffers: [{ byteLength: 96 }],
      },
      bin,
    );
    const source = readImportGlb(glb);
    expect([...source.positions]).toEqual([0, 1, 0, 1, 1, 0, 0, 2, 0]);
    expect(source.notes.join()).toMatch(/骨骼/);
  });

  it('读不了的说清原因：不是 GLB、压缩过的、要用外面的文件、里面没有网格', () => {
    expect(() => readImportGlb(new Uint8Array(40).buffer)).toThrow();
    expect(() => readImportGlb(triangle({}, { extensionsRequired: ['KHR_draco_mesh_compression'] }))).toThrow(/压缩/);
    expect(() => readImportGlb(triangle({}, { buffers: [{ byteLength: 36, uri: 'a.bin' }] }))).toThrow(/a\.bin/);
    expect(() => readImportGlb(triangle({ mesh: undefined }))).toThrow(/没有能用的网格/);
  });

  it('线、点不要，说一声；认图片的种类看文件开头', () => {
    const lines = triangle({}, { meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 1 }, { attributes: { POSITION: 0 } }] }] });
    const source = readImportGlb(lines);
    expect(source.faceMaterial.length).toBe(1);
    expect(source.notes.join()).toMatch(/线、点/);
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(JPG)).toBe('image/jpeg');
    expect(sniffImage(new TextEncoder().encode('RIFF....WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]))).toBe('');
  });
});

describe('猜单位、转朝向', () => {
  it('米、厘米、毫米各猜各的；都不像的缩放到半米', () => {
    expect(guessUnit(0.9)).toEqual({ scale: 1, unit: 'm' });
    expect(guessUnit(8)).toEqual({ scale: 1, unit: 'm' });
    expect(guessUnit(90)).toEqual({ scale: 0.01, unit: 'cm' });
    expect(guessUnit(15)).toEqual({ scale: 0.01, unit: 'cm' });
    expect(guessUnit(900)).toEqual({ scale: 0.001, unit: 'mm' });
    expect(guessUnit(50000)).toMatchObject({ unit: 'fit' });
    expect(50000 * guessUnit(50000).scale).toBeCloseTo(0.5);
    expect(0.001 * guessUnit(0.001).scale).toBeCloseTo(0.5);
    expect(guessUnit(0)).toEqual({ scale: 1, unit: 'm' });
  });

  it('转正：Z 朝上的翻到 Y 朝上；十六种转法都不镜像', () => {
    const apply = (m: number[], v: number[]) => [0, 1, 2].map((r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2] + 0);
    expect(importTurn(0, 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(apply(importTurn(1, 0), [0, 0, 1])).toEqual([0, 1, 0]);
    expect(apply(importTurn(0, 1), [1, 0, 0])).toEqual([0, 0, -1]);
    for (let u = 0; u < 4; u++) {
      for (let y = 0; y < 4; y++) {
        const m = importTurn(u, y);
        const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
        expect(det).toBe(1);
      }
    }
    expect(importExtent({ min: [0, 0, 0], max: [1, 2, 3] }, 1, 0)).toEqual([1, 3, 2]);
    expect(importExtent({ min: [0, 0, 0], max: [1, 2, 3] }, 0, 1)).toEqual([3, 2, 1]);
  });
});

describe('转成素材文件', () => {
  const source = () => {
    const box = boxMesh(40, 80, 20, 100);
    const pad = boxMesh(10, 10, 10, 180);
    return readImportGlb(
      writeGlb(
        [
          { name: 'box', ...box, material: { name: 'wood', color: 0xffffff, image: 1 } },
          { name: 'pad', ...pad, material: { name: 'plain', color: 0xff0000 } },
        ],
        { images: [{ mime: 'image/jpeg', bytes: JPG }, { mime: 'image/png', bytes: PNG }] },
      ),
    );
  };

  it('照定的倍数放大缩小，原点挪到底面正中，尺寸留到毫米', () => {
    const file = buildImport(source(), { id: ID, scale: 0.01 });
    expect(file.id).toBe(ID);
    expect(file.size).toEqual([0.4, 0.9, 0.2]);
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < file.positions.length; i += 3) {
      lo = lo.map((v, k) => Math.min(v, file.positions[i + k]));
      hi = hi.map((v, k) => Math.max(v, file.positions[i + k]));
    }
    expect(lo.map((v) => +v.toFixed(5))).toEqual([-0.2, 0, -0.1]);
    expect(hi.map((v) => +v.toFixed(5))).toEqual([0.2, 0.9, 0.1]);
  });

  it('同一个材质的面排在一起；只带用到的贴图', () => {
    const file = buildImport(source(), { id: ID, scale: 0.01 });
    expect(file.groups).toEqual([
      { start: 0, count: 36, material: 0 },
      { start: 36, count: 36, material: 1 },
    ]);
    expect(file.materials.map((m) => [m.name, m.map])).toEqual([
      ['wood', 0],
      ['plain', undefined],
    ]);
    // 文件里有两张图，用到的只有 PNG 那张
    expect(file.textures).toEqual([{ mime: 'image/png', bytes: PNG }]);
    const again = parseRealAsset(encodeRealAsset(file).buffer as ArrayBuffer);
    expect(again.size).toEqual(file.size);
    expect(again.groups).toEqual(file.groups);
    expect([...again.indices]).toEqual([...file.indices]);
  });

  it('转正、转 90°：占的盒子跟着换，面还朝外', () => {
    const up = buildImport(source(), { id: ID, scale: 0.01, upright: 1 });
    expect(up.size).toEqual([0.4, 0.2, 0.9]);
    const turned = buildImport(source(), { id: ID, scale: 0.01, yaw: 1 });
    expect(turned.size).toEqual([0.2, 0.9, 0.4]);
    // 每个面照点的顺序算出来的朝向和存的法线同一边
    for (const file of [up, turned]) {
      for (let i = 0; i < file.indices.length; i += 3) {
        const [a, b, c] = [file.indices[i] * 3, file.indices[i + 1] * 3, file.indices[i + 2] * 3];
        const u = [0, 1, 2].map((k) => file.positions[b + k] - file.positions[a + k]);
        const v = [0, 1, 2].map((k) => file.positions[c + k] - file.positions[a + k]);
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        expect(n[0] * file.normals[a] + n[1] * file.normals[a + 1] + n[2] * file.normals[a + 2]).toBeGreaterThan(0);
      }
    }
  });

  it('一样的点合成一个；薄得没有厚度的当成 1 毫米', () => {
    // 同一个三角形装两遍：点合成 3 个
    const twice = triangle({}, { nodes: [{ mesh: 0 }, { mesh: 0 }], scenes: [{ nodes: [0, 1] }] });
    const file = buildImport(readImportGlb(twice), { id: ID, scale: 1 });
    expect(file.positions.length / 3).toBe(3);
    expect(file.indices.length / 3).toBe(2);
    expect(file.size).toEqual([1, 1, 0.001]);
    expect(file.touch).toBeUndefined();
  });

  it('面多的另做一份碰撞用的粗网格：面数不超、不偏出原来的盒子', () => {
    const fine = slab(40);
    expect(fine.indices.length / 3).toBeGreaterThan(TOUCH_BUDGET);
    const coarse = clusterMesh(fine.positions, fine.indices, [1, 0.04, 1]);
    expect(coarse.indices.length / 3).toBeLessThanOrEqual(TOUCH_BUDGET);
    expect(coarse.indices.length / 3).toBeGreaterThan(100);
    for (let i = 0; i < coarse.positions.length; i += 3) {
      expect(Math.abs(coarse.positions[i])).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(coarse.positions[i + 1]).toBeGreaterThanOrEqual(-1e-6);
      expect(coarse.positions[i + 1]).toBeLessThanOrEqual(0.04 + 1e-6);
    }
    for (const index of coarse.indices) expect(index).toBeLessThan(coarse.positions.length / 3);

    const glb = writeGlb([{ name: 'slab', positions: fine.positions, indices: fine.indices }]);
    const file = buildImport(readImportGlb(glb), { id: ID, scale: 1 });
    expect(file.touch).toBeDefined();
    expect(file.touch!.indices.length / 3).toBeLessThanOrEqual(TOUCH_BUDGET);
    expect(parseRealAsset(encodeRealAsset(file).buffer as ArrayBuffer).touch!.indices.length).toBe(file.touch!.indices.length);
  });
});

describe('「我的」清单和道具', () => {
  const made = () => {
    const box = boxMesh(0.08, 0.1, 0.08);
    const glb = writeGlb([{ name: 'cup', ...box, material: { name: 'glaze', color: 0xffffff, image: 0 } }], { images: [{ mime: 'image/png', bytes: PNG }] });
    return buildImport(readImportGlb(glb), { id: ID, scale: 1 });
  };

  it('登记了、文件读进来了：能放、网格是它自己的、名字是用户起的、导出带贴图', () => {
    const file = made();
    installUserAsset(ID, encodeRealAsset(file).buffer as ArrayBuffer);
    registerUserAsset(meta(file));
    expect(propAsset(ID)?.size).toEqual([0.08, 0.1, 0.08]);
    expect(skinnedAsset(ID)).toBe(true);
    const prop = makeAssetProp([], ID, { x: 1, z: 2, yaw: 30 })!;
    expect(prop).toMatchObject({ kind: 'asset', asset: ID, assetName: '我的杯子', size: [0.08, 0.1, 0.08], pos: [1, 0, 2] });
    expect(shapeOf(prop).positions.length / 3).toBe(24);
    expect(touchShapeOf(prop).positions.length / 3).toBe(24);
    expect(propKindLabel(prop)).toBe('我的杯子');
    expect(propLabel(prop)).toBe('我的杯子 1');
    // 拉高一倍：网格跟着拉
    const tall = shapeOf({ ...prop, size: [0.08, 0.2, 0.08] });
    let top = 0;
    for (let i = 1; i < tall.positions.length; i += 3) top = Math.max(top, tall.positions[i]);
    expect(top).toBeCloseTo(0.2);
    const doc = readGlb(propGlbParts([prop], () => 'cup')[0].glb);
    expect(doc.json.images).toHaveLength(1);
    expect(doc.json.materials[0].pbrMetallicRoughness.baseColorTexture).toBeDefined();
    // 刷成灰色：不带贴图
    expect(readGlb(propGlbParts([{ ...prop, gray: true }], () => 'cup')[0].glb).json.images).toBeUndefined();
  });

  it('存档里的：这台设备上没有也留着，用方块顶着，名字用放下时记的；灰色、1 毫米的薄都留着', () => {
    const raw = [
      { id: 'p1', name: '', kind: 'asset', asset: ID, assetName: '  朋友的   剑 ', size: [0.05, 1.1, 0.003], pos: [0, 0, 0], rot: [0, 0, 0], color: '#e7eaeb', gray: true },
      { id: 'p2', name: '', kind: 'asset', asset: 'nonsense', size: [1, 1, 1], pos: [0, 0, 0], rot: [0, 0, 0], color: '#e7eaeb' },
      { id: 'p3', name: '', kind: 'box', assetName: '不该有', size: [0.003, 1, 1], pos: [0, 0, 0], rot: [0, 0, 0], color: '#e7eaeb' },
    ];
    const props = normalizeProps(raw);
    expect(props.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(props[0]).toMatchObject({ asset: ID, assetName: '朋友的 剑', size: [0.05, 1.1, 0.003], gray: true });
    expect(props[1].size).toEqual([0.01, 1, 1]);
    expect('assetName' in props[1]).toBe(false);
    expect(userAsset(ID)).toBeUndefined();
    expect(propKindLabel(props[0])).toBe('朋友的 剑');
    // 没有文件：一个同样大的方块
    expect(shapeOf(props[0]).positions.length / 3).toBe(24);
    expect(propKindLabel({ kind: 'asset', asset: ID })).toBe('导入的素材');
    // 存回去再读一遍不变
    expect(normalizeProps(JSON.parse(JSON.stringify(props)))).toEqual(props);
    expect(clampProp({ ...props[0], size: [0.0001, 20, 1] } as SceneProp).size).toEqual([0.001, 10, 1]);
  });

  it('导入、读回、删掉（测试里没有 IndexedDB：存不上，这一次照样能用）', async () => {
    const file = made();
    const { kept } = await addUserAsset(meta(file, '杯子'), encodeRealAsset(file));
    expect(kept).toBe(false);
    expect(userAssets().map((a) => a.name)).toEqual(['杯子']);
    expect(realAssetFile(ID)?.textures).toHaveLength(1);
    expect(await loadUserAsset(ID)).toBe(true);
    expect(await loadUserAsset('my-ffffffffffffffff')).toBe(false);
    expect(await loadUserAsset('chair')).toBe(false);
    await removeUserAsset(ID);
    expect(userAssets()).toEqual([]);
    expect(propAssetShape(ID)).toBeUndefined();
    expect(propTouchShape(ID)).toBeUndefined();
    expect(await loadUserAsset(ID)).toBe(false);
  });

  it('清单里读出来的一条：缺东西的不要，分类不认的当「别的」，名字收拾干净', () => {
    const good = { id: ID, name: '  a   b ', group: 'seat', size: [1, 2, 3], vertices: 8, triangles: 12, bytes: 99, added: 5, thumb: 'data:image/png;base64,AAAA' };
    expect(cleanUserAsset(good)).toEqual({ ...good, name: 'a b' });
    expect(cleanUserAsset({ ...good, group: 'weapon', thumb: 'javascript:alert(1)' })).toEqual({ ...good, name: 'a b', group: 'other', thumb: undefined });
    for (const bad of [null, 5, { ...good, id: 'chair' }, { ...good, size: [1, 2] }, { ...good, size: [1, 0, 3] }, { ...good, triangles: 0 }]) expect(cleanUserAsset(bad)).toBeNull();
  });
});
