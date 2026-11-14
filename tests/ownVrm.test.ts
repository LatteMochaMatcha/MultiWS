// 「载入自己的 VRM」：VRM 0.x、VRM 1.0、别的软件做的（骨骼不叫 J_Bip_…）都读得了；读不了的说清楚哪里不对。
// 手边只有 VRoid 的 VRM 0.x，VRM 1.0 和「别的软件做的」都是在这里照规矩从 vita 的文件改出来的
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleCharacter } from '../src/character/assemble';
import { OWN_READ } from '../src/character/load';
import { characterUrl } from '../src/character/roster';
import { type CharacterSource, type SourceSpring, readCharacter } from '../src/character/source';
import { characterVrm } from '../src/character/vrm';
import { readAccessor, readGlb } from '../src/io/glbRead';
import { describeLicense, linearColor, srgbColor, toonFromV1 } from '../src/io/vrm';
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
  // 卡通着色：0.x 的数照 1.0 的算法换过去（明暗分界的两头对上），写进每个材质自己的扩展
  const toon = new Map<string, { floatProperties: Record<string, number>; vectorProperties: Record<string, number[]> }>(
    v0.materialProperties.map((p: { name: string }) => [p.name.replace(/ \(Instance\)$/, ''), p]),
  );
  for (const m of json.materials) {
    const p = toon.get(m.name.replace(/ \(Instance\)$/, ''));
    if (!p) continue;
    const f = p.floatProperties;
    const low = f._ShadeShift;
    const high = 1 + (f._ShadeShift - 1) * f._ShadeToony;
    m.extensions = {
      ...m.extensions,
      VRMC_materials_mtoon: {
        specVersion: '1.0',
        shadingShiftFactor: -(low + high) / 2,
        shadingToonyFactor: 1 - (high - low) / 2,
        // 0.x 存的颜色是 sRGB，1.0 是线性的
        shadeColorFactor: linearColor(p.vectorProperties._ShadeColor).slice(0, 3),
        giEqualizationFactor: 1 - f._IndirectLightIntensity,
        outlineWidthMode: ['none', 'worldCoordinates', 'screenCoordinates'][f._OutlineWidthMode],
        outlineWidthFactor: f._OutlineWidth / 100,
        outlineColorFactor: linearColor(p.vectorProperties._OutlineColor).slice(0, 3),
        outlineLightingMixFactor: f._OutlineColorMode === 1 ? f._OutlineLightingMix : 0,
      },
    };
  }
  // 弹簧骨骼：每组的每个根写成一串（只写第一节），每个碰撞球写成一个碰撞体。0.x 存的方向（UniVRM 的写法）x 取反就是面朝 +Z
  type Xyz = { x: number; y: number; z: number };
  const sa = v0.secondaryAnimation;
  const colliders: unknown[] = [];
  const colliderGroups = sa.colliderGroups.map((g: { node: number; colliders: { offset: Xyz; radius: number }[] }) => ({
    colliders: g.colliders.map((c) => colliders.push({ node: g.node, shape: { sphere: { offset: [-c.offset.x, c.offset.y, c.offset.z], radius: c.radius } } }) - 1),
  }));
  type Group = { comment: string; bones: number[]; hitRadius: number; stiffiness: number; gravityPower: number; gravityDir: Xyz; dragForce: number; colliderGroups: number[] };
  const springs = sa.boneGroups.flatMap((g: Group) =>
    g.bones.map((node) => ({
      name: g.comment,
      joints: [{ node, hitRadius: g.hitRadius, stiffness: g.stiffiness, gravityPower: g.gravityPower, gravityDir: [-g.gravityDir.x, g.gravityDir.y, g.gravityDir.z], dragForce: g.dragForce }],
      colliderGroups: g.colliderGroups,
    })),
  );
  json.extensions = {
    VRMC_springBone: { specVersion: '1.0', colliders, colliderGroups, springs },
    VRMC_vrm: {
      specVersion: '1.0',
      meta: {
        name: v0.meta.title,
        authors: [v0.meta.author, '第二位作者'],
        licenseUrl: 'https://vrm.dev/licenses/1.0/',
        thumbnailImage: json.textures[v0.meta.texture].source,
        avatarPermission: 'everyone',
        commercialUsage: 'personalProfit',
        creditNotation: 'required',
        allowRedistribution: true,
        modification: 'allowModification',
      },
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
  json.extensionsUsed = ['VRMC_vrm', 'VRMC_springBone', 'VRMC_materials_mtoon'];
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
    expect(() => read(renamed('hips'))).toThrow('hips');
    expect(() => read(new ArrayBuffer(40))).toThrow();
  });

  it('没有上胸、脖子（VRM 里可以没有）：补一根不带权重的，放在上下两根中间，拼得起来', () => {
    for (const [drop, name, below, above] of [
      ['upperChest', 'J_Bip_C_UpperChest', 'J_Bip_C_Chest', 'J_Bip_C_Neck'],
      ['neck', 'J_Bip_C_Neck', 'J_Bip_C_UpperChest', 'J_Bip_C_Head'],
      ['chest', 'J_Bip_C_Chest', 'J_Bip_C_Spine', 'J_Bip_C_UpperChest'],
    ] as const) {
      const source = read(renamed(drop));
      const at = (n: string) => source.bones.findIndex((b) => b.name === n);
      const made = at(name);
      expect(made, drop).toBeGreaterThanOrEqual(0);
      expect(source.bones[made].parent).toBe(at(below));
      // 上面那根在补的这根下面
      let p = at(above);
      while (p >= 0 && p !== made) p = source.bones[p].parent;
      expect(p, drop).toBe(made);
      expect(source.bones[made].pos[1]).toBeCloseTo((source.bones[at(below)].pos[1] + source.bones[at(above)].pos[1]) / 2, 5);
      for (const chunk of source.chunks) for (let k = 0; k < chunk.joints.length; k++) if (chunk.weights[k] > 0) expect(chunk.joints[k]).not.toBe(made);
      const build = assembleCharacter(source, { ...spec(), counts: { ...spec().counts, heads: 2, armPairs: 2 } });
      expect(build.bones.some((b) => b.name === 'Head.002')).toBe(true);
    }
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

  it('VRM 1.0 的卡通着色换成 0.x：Blender 的 VRM 插件从 kotori 的 0.x 转出来的数，换回去和原来的一样', () => {
    // 插件转出来的皮肤材质：明暗分界 −0.2 / 0.2、描边 0.75 毫米（世界坐标）、描边不混光照；原来 0.x 是 −0.6 / 0、0.075 厘米、固定颜色
    const toon = toonFromV1({
      name: 'F00_002_02_Body_00_SKIN',
      alphaMode: 'MASK',
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] },
      extensions: {
        VRMC_materials_mtoon: {
          shadingShiftFactor: -0.2,
          shadingToonyFactor: 0.2,
          giEqualizationFactor: 0.9,
          outlineWidthMode: 'worldCoordinates',
          outlineWidthFactor: 0.00075,
          outlineLightingMixFactor: 0,
          shadeColorFactor: [0.94, 0.63, 0.72],
          uvAnimationScrollYSpeedFactor: 0.5,
        },
      },
    })!;
    const f = toon.floatProperties;
    expect(f._ShadeShift).toBeCloseTo(-0.6, 6);
    expect(f._ShadeToony).toBeCloseTo(0, 6);
    expect(f._OutlineWidth).toBeCloseTo(0.075, 6);
    expect(f._OutlineWidthMode).toBe(1);
    expect(f._OutlineColorMode).toBe(0);
    expect(f._IndirectLightIntensity).toBeCloseTo(0.1, 6);
    expect(f._BlendMode).toBe(1);
    expect(toon.renderQueue).toBe(2450);
    // 颜色：1.0 是线性的，0.x 存 sRGB；纵向滚动两版方向相反
    toon.vectorProperties._ShadeColor.forEach((v, k) => expect(v).toBeCloseTo(srgbColor([0.94, 0.63, 0.72, 1])[k], 6));
    expect(toon.vectorProperties._ShadeColor[0]).toBeGreaterThan(0.94);
    expect(f._UvAnimScrollY).toBe(-0.5);
    // 头发是 0.x 的 1 / 1（转出来 1.0 是 −1 / 1）：分母是 0 的那种也换得回去
    const hair = toonFromV1({ extensions: { VRMC_materials_mtoon: { shadingShiftFactor: -1, shadingToonyFactor: 1 } } })!;
    expect(hair.floatProperties._ShadeShift).toBe(1);
    expect(hair.floatProperties._ShadeToony).toBe(1);
    expect(toonFromV1({ name: '不是 MToon' })).toBeNull();
  });

  it('VRM 1.0：卡通着色、弹簧骨骼、碰撞球换成 0.x 的写法，和 0.x 那份读出来的一样', () => {
    const v0 = read(original());
    const v1 = read(toV1());
    for (const [name, toon] of v0.toon!) {
      const back = v1.toon!.get(name)!;
      expect(back, name).toBeTruthy();
      for (const key of ['_ShadeShift', '_ShadeToony', '_OutlineWidthMode', '_OutlineColorMode', '_IndirectLightIntensity']) {
        expect(back.floatProperties[key], `${name} ${key}`).toBeCloseTo(toon.floatProperties[key], 5);
      }
      // 不画描边时 0.x 里的宽度没用（1.0 写的是 0）
      if (toon.floatProperties._OutlineWidthMode) expect(back.floatProperties._OutlineWidth, name).toBeCloseTo(toon.floatProperties._OutlineWidth, 5);
      // 颜色换成线性再换回 sRGB，和原来的一样
      for (const key of ['_ShadeColor', '_OutlineColor']) {
        toon.vectorProperties[key].slice(0, 3).forEach((v, k) => expect(back.vectorProperties[key][k], `${name} ${key}`).toBeCloseTo(v, 5));
      }
    }
    // 1.0 一串一个根：每个根的晃法、碰的碰撞球和 0.x 那一组一样
    const flat = (s: CharacterSource) =>
      s.springs!.flatMap((g) => g.roots.map((root) => ({ root, stiffness: g.stiffness, gravity: g.gravity, drag: g.drag, hitRadius: g.hitRadius, gravityDir: g.gravityDir })));
    expect(flat(v1)).toEqual(flat(v0));
    // 碰撞球：每根骨骼上的球心、大小一样（1.0 是一个碰撞体一组）
    const balls = (s: CharacterSource) =>
      s.colliders!.flatMap((c) => c.spheres.map((b) => `${c.bone}:${b.offset.map((v) => v.toFixed(5)).join(',')}:${b.radius.toFixed(5)}`)).sort();
    expect(balls(v1)).toEqual(balls(v0));
    const hits = (s: CharacterSource, g: SourceSpring) => [...new Set(g.colliders.map((c) => s.colliders![c].bone))].sort();
    v1.springs!.forEach((g) => {
      const was = v0.springs!.find((x) => x.roots.includes(g.roots[0]))!;
      expect(hits(v1, g)).toEqual(hits(v0, was));
    });
  });

  it('VRM 1.0 的角色导出 VRM：许可写 Other、条款网址指向 VRM 公共许可，0.x 写不下的条件接在出处后面；小框里说成人话', () => {
    const v1 = read(toV1());
    const build = assembleCharacter(v1, spec());
    const identity = new Float64Array(build.bones.length * 12);
    for (let j = 0; j < build.bones.length; j++) identity.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], j * 12);
    const vrm = readGlb(characterVrm(build, v1, { matrices: identity, bones: build.bones, title: '测试', editor: '我' })).json.extensions.VRM;
    expect(vrm.meta.licenseName).toBe('Other');
    expect(vrm.meta.otherLicenseUrl).toBe('https://vrm.dev/licenses/1.0/');
    expect(vrm.meta.allowedUserName).toBe('Everyone');
    expect(vrm.meta.commercialUssageName).toBe('Disallow');
    expect(vrm.meta.sexualUssageName).toBe('Disallow');
    expect(vrm.meta.author).toContain('第二位作者');
    expect(vrm.meta.reference).toContain('不许用于政治、宗教');
    expect(vrm.meta.reference).toContain('改过的不许再分发');
    expect(vrm.secondaryAnimation.boneGroups.length).toBeGreaterThan(5);
    expect(vrm.materialProperties.some((p: { floatProperties: Record<string, number> }) => p.floatProperties._ShadeToony !== 0.75)).toBe(true);
    expect(describeLicense(v1.vrm1Meta!)).toBe(
      'VRM 公共许可 1.0，不许用于暴力表现，不许用于性表现，只许个人商用，不许用于政治、宗教，不许用于反社会、仇恨，要署名，改过的不许再分发',
    );
  });

  it('配置里记「用的是自己的」，读回来还是', () => {
    expect(normalizeSpec({ character: 'own' }).character).toBe(OWN_CHARACTER);
    expect(normalizeSpec({ character: 'nobody' }).character).toBe('vita');
  });
});
