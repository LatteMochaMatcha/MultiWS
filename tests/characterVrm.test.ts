// 成品角色导出 VRM（src/character/vrm.ts）：形态键、表情组、卡通着色照抄、染发、meta 照原角色
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleCharacter } from '../src/character/assemble';
import { CHARACTER } from '../src/character/load';
import { type CharacterSource, readCharacter } from '../src/character/source';
import { characterVrm } from '../src/character/vrm';
import { readAccessor, readGlb } from '../src/io/glbRead';
import { describeLicense } from '../src/io/vrm';
import { type BodySpec, defaultSpec } from '../src/model/spec';

let cached: CharacterSource | null = null;
function source(): CharacterSource {
  if (!cached) {
    const file = readFileSync(new URL(`../public/${CHARACTER.url}`, import.meta.url));
    cached = readCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, CHARACTER);
  }
  return cached;
}

/** 照这份设定拼好角色、写成 VRM（姿势不动：每根骨骼的蒙皮矩阵都是单位矩阵），读回来 */
function exported(rest: Partial<BodySpec> = {}) {
  const spec: BodySpec = { ...defaultSpec(), bodyStyle: 'character', ...rest };
  const build = assembleCharacter(source(), spec);
  const identity = new Float64Array(build.bones.length * 12);
  for (let j = 0; j < build.bones.length; j++) identity.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], j * 12);
  const file = characterVrm(build, source(), { matrices: identity, bones: build.bones, title: '测试', editor: '我' });
  const doc = readGlb(file);
  return { build, json: doc.json, doc };
}

/** 脸上那个物体里，某个形态键挪动了几个顶点 */
function moving(result: ReturnType<typeof exported>, name: string): number {
  const mesh = result.json.meshes.find((m: { name: string }) => m.name === 'OC_Face');
  const index = (mesh.extras.targetNames as string[]).indexOf(name);
  let count = 0;
  for (const p of mesh.primitives) {
    const d = readAccessor(result.doc, p.targets[index].POSITION);
    for (let i = 0; i < d.length; i += 3) if (Math.hypot(d[i], d[i + 1], d[i + 2]) > 1e-6) count++;
  }
  return count;
}

describe('成品角色导出 VRM', () => {
  const { build, json } = exported({ counts: { ...defaultSpec().counts, heads: 2 } });
  const vrm = json.extensions.VRM;
  const face = json.meshes.findIndex((m: { name: string }) => m.name === 'OC_Face');

  it('原文件读出来就带着卡通着色和 meta', () => {
    expect(source().toon?.size).toBeGreaterThan(0);
    expect(source().vrmMeta?.licenseName).toBeTruthy();
  });

  it('脸是单独一个物体，带着原文件的变形当形态键；身子那个没有', () => {
    expect(face).toBeGreaterThanOrEqual(0);
    const names = json.meshes[face].extras.targetNames as string[];
    expect(names).toContain('ALL_Joy');
    expect(names.length).toBeGreaterThan(20);
    for (const p of json.meshes[face].primitives) expect(p.targets).toHaveLength(names.length);
    const body = json.meshes.find((m: { name: string }) => m.name === 'OC_Body');
    expect(body.primitives.every((p: { targets?: unknown }) => !p.targets)).toBe(true);
  });

  it('表情组：规定的那几种都在，都绑在脸上的形态键上；没有的眨眼由左右眨眼拼成', () => {
    const groups = vrm.blendShapeMaster.blendShapeGroups as { presetName: string; binds: { mesh: number; index: number; weight: number }[] }[];
    const presets = groups.map((g) => g.presetName);
    for (const key of ['joy', 'angry', 'sorrow', 'fun', 'a', 'i', 'u', 'e', 'o', 'blink', 'blink_l', 'blink_r']) expect(presets).toContain(key);
    const count = json.meshes[face].extras.targetNames.length;
    for (const g of groups) for (const b of g.binds) {
      expect(b.mesh).toBe(face);
      expect(b.index).toBeLessThan(count);
      expect(b.weight).toBeGreaterThan(0);
    }
  });

  it('两个头：一个形态键两张脸一起动（挪动的顶点是一个头时的两倍）', () => {
    expect(build.faces.length).toBe(2);
    const two = moving(exported({ counts: { ...defaultSpec().counts, heads: 2 } }), 'ALL_Joy');
    const one = moving(exported(), 'ALL_Joy');
    expect(one).toBeGreaterThan(100);
    expect(two).toBe(one * 2);
  });

  it('材质的卡通着色照原文件抄，和文件里的材质一一对应', () => {
    expect(vrm.materialProperties.map((p: { name: string }) => p.name)).toEqual(json.materials.map((m: { name: string }) => m.name));
    const copied = vrm.materialProperties.filter((p: { name: string }) => source().toon?.has(p.name));
    expect(copied.length).toBeGreaterThan(5);
    for (const p of copied) {
      const raw = source().toon!.get(p.name)!;
      expect(p.renderQueue).toBe(raw.renderQueue);
      expect(p.floatProperties._ShadeToony).toBe(raw.floatProperties._ShadeToony);
    }
  });

  it('meta：许可、允许谁用照原角色；作者写原作者和改的人', () => {
    const raw = source().vrmMeta!;
    for (const key of ['licenseName', 'allowedUserName', 'violentUssageName', 'sexualUssageName', 'commercialUssageName', 'otherLicenseUrl']) {
      expect(vrm.meta[key]).toBe(raw[key] ?? '');
    }
    expect(vrm.meta.author).toContain('（原作者）');
    expect(vrm.meta.author).toContain('我（改）');
    expect(vrm.meta.reference).toContain('改自');
  });

  it('眼睛骨骼进人形表', () => {
    const bones = (vrm.humanoid.humanBones as { bone: string }[]).map((h) => h.bone);
    expect(bones).toContain('leftEye');
    expect(bones).toContain('rightEye');
  });
});

describe('成品角色导出 VRM：染过的头发', () => {
  it('亮面换成染的颜色，暗面按同样的比例变', () => {
    const { json } = exported({ hair: { ...defaultSpec().hair, color: '#3060ff' } });
    const dyed = (json.extensions.VRM.materialProperties as { name: string; vectorProperties: Record<string, number[]> }[]).find(
      (p) => /HAIR/.test(p.name) && source().toon?.has(p.name),
    )!;
    const raw = source().toon!.get(dyed.name)!.vectorProperties;
    const color = dyed.vectorProperties._Color;
    // 蓝色比红色多（染成了偏蓝）；暗面照亮面的比例变
    expect(color[2]).toBeGreaterThan(color[0]);
    for (const k of [0, 1, 2]) {
      if (raw._Color[k] > 1e-3 && raw._ShadeColor[k] * (color[k] / raw._Color[k]) < 1) {
        expect(dyed.vectorProperties._ShadeColor[k]).toBeCloseTo(raw._ShadeColor[k] * (color[k] / raw._Color[k]), 4);
      }
    }
  });
});

describe('许可说成人话', () => {
  it('CC BY-SA；不许的几条列出来', () => {
    expect(describeLicense({ licenseName: 'CC_BY_SA', allowedUserName: 'Everyone', sexualUssageName: 'Allow' })).toBe('CC BY-SA（要署名，改过的也只能用这个许可）');
    expect(describeLicense({ licenseName: 'Other', sexualUssageName: 'Disallow', commercialUssageName: 'Disallow' })).toBe('原作者自己写的条件，不许用于性表现，不许商用');
  });
});
