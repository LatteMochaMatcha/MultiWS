// 「载入自己的 VRM」：VRM 0.x、VRM 1.0、别的软件做的（骨骼不叫 J_Bip_…）都读得了；读不了的说清楚哪里不对。
// 手边只有 VRoid 的 VRM 0.x，VRM 1.0 和「别的软件做的」都是在这里照规矩从 vita 的文件改出来的
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleCharacter } from '../src/character/assemble';
import { OWN_READ } from '../src/character/load';
import { characterUrl } from '../src/character/roster';
import { type CharacterSource, readCharacter } from '../src/character/source';
import { readAccessor, readGlb } from '../src/io/glbRead';
import { OWN_CHARACTER, defaultSpec, normalizeSpec } from '../src/model/spec';

const original = () => {
  const file = readFileSync(new URL(`../public/${characterUrl('vita')}`, import.meta.url));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
};

/** 拼回一个 GLB：JSON 块补空格、二进制块补 0 到 4 字节对齐 */
function writeGlb(json: unknown, bin: Uint8Array): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binLength = Math.ceil(bin.length / 4) * 4;
  const out = new ArrayBuffer(12 + 8 + jsonLength + 8 + binLength);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(text, 20);
  bytes.fill(0x20, 20 + text.length, 20 + jsonLength);
  view.setUint32(20 + jsonLength, binLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  bytes.set(bin, 28 + jsonLength);
  return out;
}

/** 拆开 vita 的文件：JSON 改着玩，二进制块复制一份（要改里面的数） */
function open() {
  const doc = readGlb(original());
  const json = structuredClone(doc.json);
  const bin = new Uint8Array(doc.bin.byteLength);
  bin.set(new Uint8Array(doc.bin.buffer, doc.bin.byteOffset, doc.bin.byteLength));
  return { json, bin, view: new DataView(bin.buffer) };
}

/** 一个 float 型 accessor 的每个元素：第 i 个元素在二进制块里从哪个字节开始 */
function floats(json: any, index: number, each: (at: number) => void) {
  const acc = json.accessors[index];
  if (acc.componentType !== 5126 || acc.sparse || acc.bufferView === undefined) throw new Error(`accessor ${index} 不是普通的 float`);
  const view = json.bufferViews[acc.bufferView];
  const size = { VEC3: 3, MAT4: 16 }[acc.type as 'VEC3' | 'MAT4'];
  const stride = view.byteStride || size * 4;
  for (let i = 0; i < acc.count; i++) each((view.byteOffset ?? 0) + (acc.byteOffset ?? 0) + i * stride);
}

/** VRM 0.x 的人形骨骼名 → 1.0 的（只有大拇指不一样） */
const thumbV1 = (bone: string) => bone.replace(/ThumbProximal$/, 'ThumbMetacarpal').replace(/ThumbIntermediate$/, 'ThumbProximal');
const PRESET_V1: Record<string, string> = { joy: 'happy', angry: 'angry', sorrow: 'sad', fun: 'relaxed', a: 'aa', i: 'ih', u: 'ou', e: 'ee', o: 'oh', blink: 'blink', blink_l: 'blinkLeft', blink_r: 'blinkRight', neutral: 'neutral' };

/** 照 VRM 1.0 的规矩改：扩展换成 VRMC_vrm，模型转成面朝 +Z，表情的权重换成 0–1、绑在节点上 */
function toV1(): ArrayBuffer {
  const { json, bin, view } = open();
  const v0 = json.extensions.VRM;
  // 面朝 +Z：所有顶点、法线、表情的位移 x、z 取反；逆绑定矩阵的平移 x、z 取反
  const flipped = new Set<number>();
  const flip = (index: number | undefined) => {
    if (index === undefined || flipped.has(index)) return;
    flipped.add(index);
    floats(json, index, (at) => {
      view.setFloat32(at, -view.getFloat32(at, true), true);
      view.setFloat32(at + 8, -view.getFloat32(at + 8, true), true);
    });
  };
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      flip(prim.attributes.POSITION);
      flip(prim.attributes.NORMAL);
      for (const target of prim.targets ?? []) {
        flip(target.POSITION);
        flip(target.NORMAL);
      }
    }
  }
  const inverse = new Set<number>(json.skins.map((skin: { inverseBindMatrices: number }) => skin.inverseBindMatrices));
  for (const index of inverse) {
    floats(json, index, (at) => {
      view.setFloat32(at + 48, -view.getFloat32(at + 48, true), true);
      view.setFloat32(at + 56, -view.getFloat32(at + 56, true), true);
    });
  }
  const meshNode = (mesh: number) => json.nodes.findIndex((node: { mesh?: number }) => node.mesh === mesh);
  const preset: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  for (const group of v0.blendShapeMaster.blendShapeGroups) {
    const binds = (group.binds ?? []).map((b: { mesh: number; index: number; weight: number }) => ({ node: meshNode(b.mesh), index: b.index, weight: b.weight / 100 }));
    const name = PRESET_V1[group.presetName];
    if (name) preset[name] = { morphTargetBinds: binds };
    else if (group.name) custom[group.name] = { morphTargetBinds: binds };
  }
  const range = (curve: { yRange: number }) => ({ inputMaxValue: 90, outputScale: curve.yRange });
  json.extensions = {
    VRMC_vrm: {
      specVersion: '1.0',
      meta: { name: v0.meta.title, authors: [v0.meta.author, '第二位作者'], licenseUrl: 'https://vrm.dev/licenses/1.0/', thumbnailImage: json.textures[v0.meta.texture].source },
      humanoid: { humanBones: Object.fromEntries(v0.humanoid.humanBones.map((h: { bone: string; node: number }) => [thumbV1(h.bone), { node: h.node }])) },
      expressions: { preset, custom },
      lookAt: {
        rangeMapHorizontalOuter: range(v0.firstPerson.lookAtHorizontalOuter),
        rangeMapHorizontalInner: range(v0.firstPerson.lookAtHorizontalInner),
        rangeMapVerticalDown: range(v0.firstPerson.lookAtVerticalDown),
        rangeMapVerticalUp: range(v0.firstPerson.lookAtVerticalUp),
      },
    },
  };
  json.extensionsUsed = ['VRMC_vrm'];
  return writeGlb(json, bin);
}

/** 照「别的软件做的」改：身体的骨骼全换成别的名字（人形骨骼对照表留着） */
function renamed(drop?: string): ArrayBuffer {
  const { json, bin } = open();
  json.nodes.forEach((node: { name?: string }, i: number) => {
    if (node.name?.startsWith('J_')) node.name = `bone.${i}`;
  });
  if (drop) json.extensions.VRM.humanoid.humanBones = json.extensions.VRM.humanoid.humanBones.filter((h: { bone: string }) => h.bone !== drop);
  return writeGlb(json, bin);
}

const read = (bytes: ArrayBuffer) => readCharacter(bytes, OWN_READ);
const spec = () => ({ ...defaultSpec(), bodyStyle: 'character' as const, character: OWN_CHARACTER });
/** 两份读出来的角色一样：骨骼的名字和位置、每块网格的顶点 */
function expectSame(a: CharacterSource, b: CharacterSource) {
  expect(b.bones.map((x) => x.name)).toEqual(a.bones.map((x) => x.name));
  a.bones.forEach((bone, i) => bone.pos.forEach((v, k) => expect(b.bones[i].pos[k]).toBeCloseTo(v, 5)));
  expect(b.chunks.length).toBe(a.chunks.length);
  a.chunks.forEach((chunk, i) => {
    expect(b.chunks[i].positions.length).toBe(chunk.positions.length);
    for (let v = 0; v < chunk.positions.length; v += 97) expect(b.chunks[i].positions[v]).toBeCloseTo(chunk.positions[v], 5);
  });
}

describe('载入自己的 VRM', () => {
  it('VRoid 的 VRM 0.x：读得了，作者、许可、缩略图都有，拼得起来', () => {
    const source = read(original());
    expect(source.vroid).toBe(true);
    expect(source.title).toBeTruthy();
    expect(source.author).toBeTruthy();
    // 工坊带的角色文件把用不到的贴图换成了 1×1 的占位图（缩略图也是）：这里只看读到了
    expect(source.thumbnail?.mime).toMatch(/^image\//);
    expect(source.dyeMaterials.length).toBeGreaterThan(0);
    expect(assembleCharacter(source, spec()).bones.length).toBeGreaterThan(50);
  });

  it('VRM 1.0：模型本来面朝 +Z、表情绑在节点上、权重是 0–1；读出来和 0.x 那份一样', () => {
    const v0 = read(original());
    const v1 = read(toV1());
    expectSame(v0, v1);
    expect(v1.author).toBe(`${v0.author}、第二位作者`);
    expect(v1.license).toBe('https://vrm.dev/licenses/1.0/');
    expect(v1.thumbnail?.bytes).toEqual(v0.thumbnail?.bytes);
    // 表情：名字换回工坊用的（happy → joy …），绑的变形和权重一样
    const keys = (s: CharacterSource) => s.face!.expressions.map((e) => e.key).sort();
    expect(keys(v1)).toEqual(keys(v0));
    for (const e of v0.face!.expressions) expect(v1.face!.expressions.find((x) => x.key === e.key)!.binds).toEqual(e.binds);
    expect(v1.face!.look).toEqual(v0.face!.look);
    for (let i = 0; i < v0.face!.positions.length; i += 7) expect(v1.face!.positions[i][0]).toBeCloseTo(v0.face!.positions[i][0], 5);
    // 拼出来也一样
    const a = assembleCharacter(v0, spec());
    const b = assembleCharacter(v1, spec());
    expect(b.bones.map((x) => x.name)).toEqual(a.bones.map((x) => x.name));
    expect(b.metrics.height).toBeCloseTo(a.metrics.height, 5);
  });

  it('别的软件做的（骨骼不叫 J_Bip_…）：照人形骨骼对照表认出身体的骨骼，拼得起来', () => {
    const v0 = read(original());
    const other = read(renamed());
    expect(other.vroid).toBe(false);
    // 身体的主骨骼、手指、眼睛都换回了 VRoid 的名字
    for (const name of ['J_Bip_C_Hips', 'J_Bip_C_UpperChest', 'J_Bip_L_UpperLeg', 'J_Bip_R_Foot', 'J_Bip_L_Thumb1', 'J_Bip_R_Little3', 'J_Adj_L_FaceEye']) {
      const at = v0.bones.findIndex((b) => b.name === name);
      expect(other.bones[at]?.name, name).toBe(name);
    }
    const build = assembleCharacter(other, { ...spec(), counts: { ...spec().counts, heads: 2, legs: 3 } });
    expect(build.bones.some((b) => b.name === 'Head.002')).toBe(true);
    expect(build.bones.some((b) => b.name === 'UpperLeg')).toBe(true);
  });

  it('读不了的说清楚：不是 VRM、缺人形骨骼', () => {
    const { json, bin } = open();
    delete json.extensions;
    expect(() => read(writeGlb(json, bin))).toThrow('不是 VRM');
    expect(() => read(renamed('upperChest'))).toThrow('upperChest');
    expect(() => read(new ArrayBuffer(40))).toThrow();
  });

  it('稀疏的 accessor（VRM 1.0 的表情常这么存）也读得了', () => {
    const bin = new DataView(new ArrayBuffer(16));
    bin.setUint32(0, 2, true);
    [1.5, -2, 0.25].forEach((v, k) => bin.setFloat32(4 + k * 4, v, true));
    const doc = {
      json: {
        accessors: [{ count: 3, type: 'VEC3', componentType: 5126, sparse: { count: 1, indices: { bufferView: 0, componentType: 5125 }, values: { bufferView: 1 } } }],
        bufferViews: [{ byteOffset: 0, byteLength: 4 }, { byteOffset: 4, byteLength: 12 }],
      },
      bin,
    };
    expect([...readAccessor(doc, 0)]).toEqual([0, 0, 0, 0, 0, 0, 1.5, -2, 0.25]);
  });

  it('配置里记「用的是自己的」，读回来还是', () => {
    expect(normalizeSpec({ character: 'own' }).character).toBe(OWN_CHARACTER);
    expect(normalizeSpec({ character: 'nobody' }).character).toBe('vita');
  });
});
