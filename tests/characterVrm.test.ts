// 成品角色导出 VRM（src/character/vrm.ts）：形态键、表情组、卡通着色照抄、染发、meta 照原角色
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleCharacter } from '../src/character/assemble';
import { type HairDonor, readHair } from '../src/character/hair';
import { CHARACTER, hairUrl } from '../src/character/load';
import { characterUrl, rosterEntry } from '../src/character/roster';
import { type CharacterSource, readCharacter } from '../src/character/source';
import { characterVrm } from '../src/character/vrm';
import type { V3 } from '../src/geometry/vec';
import { readAccessor, readGlb } from '../src/io/glbRead';
import { describeLicense, linearColor, plainToon, srgbColor } from '../src/io/vrm';
import { type BodySpec, defaultSpec } from '../src/model/spec';

const bufferOf = (path: string) => {
  const file = readFileSync(new URL(`../public/${path}`, import.meta.url));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
};
let cached: CharacterSource | null = null;
function source(): CharacterSource {
  if (!cached) cached = readCharacter(bufferOf(CHARACTER.url), CHARACTER);
  return cached;
}

/** 照这份设定拼好角色（donor：换上的发型）、写成 VRM（姿势不动：每根骨骼的蒙皮矩阵都是单位矩阵），读回来 */
function exported(rest: Partial<BodySpec> = {}, donor: HairDonor | null = null) {
  const spec: BodySpec = { ...defaultSpec(), bodyStyle: 'character', ...rest };
  const build = assembleCharacter(source(), spec, donor);
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

describe('成品角色导出 VRM：卡通着色的颜色（0.x 存 sRGB）', () => {
  type Props = { name: string; renderQueue: number; vectorProperties: Record<string, number[]>; floatProperties: Record<string, number> };
  const propsOf = (json: { extensions: { VRM: { materialProperties: Props[] } } }) => json.extensions.VRM.materialProperties;
  const close = (a: number[], b: number[], digits = 5) => a.forEach((v, k) => expect(v, `第 ${k} 个`).toBeCloseTo(b[k], digits));

  it('白模的单色材质：亮面就是屏幕上的颜色（0xRRGGBB 除以 255）', () => {
    const toon = plainToon({ name: 'OC_Clay', color: 0x8899aa });
    close(toon.vectorProperties._Color, [0x88 / 255, 0x99 / 255, 0xaa / 255, 1]);
  });

  it('染过的头发：亮面存染的颜色，暗面在线性空间里按同样的比例变', () => {
    const { json } = exported({ hair: { ...defaultSpec().hair, color: '#3060ff' } });
    const dyed = propsOf(json).find((p) => /HAIR/.test(p.name) && source().toon?.has(p.name))!;
    // 文件里这个材质的底色（线性）就是染的颜色；原来的底色从角色文件里读
    const now = json.materials.find((m: { name: string }) => m.name === dyed.name).pbrMetallicRoughness.baseColorFactor as number[];
    const before = source().materials.find((m) => m.name === dyed.name)!.color;
    const raw = source().toon!.get(dyed.name)!.vectorProperties;
    close(dyed.vectorProperties._Color.slice(0, 3), srgbColor(now).slice(0, 3));
    expect(dyed.vectorProperties._Color[2]).toBeGreaterThan(dyed.vectorProperties._Color[0]);
    const shade = linearColor(raw._ShadeColor);
    close(dyed.vectorProperties._ShadeColor.slice(0, 3), srgbColor([0, 1, 2].map((k) => Math.min(1, (shade[k] * now[k]) / before[k]))));
  });

  it('没染过的照原样抄：绿发红裙有几个材质的 _Color 不是白的，也不当成染过', () => {
    const kotori = readCharacter(bufferOf(characterUrl('kotori')), rosterEntry('kotori'));
    const build = assembleCharacter(kotori, { ...defaultSpec(), bodyStyle: 'character' });
    const identity = new Float64Array(build.bones.length * 12);
    for (let j = 0; j < build.bones.length; j++) identity.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], j * 12);
    const json = readGlb(characterVrm(build, kotori, { matrices: identity, bones: build.bones, title: '测试', editor: '我' })).json;
    const copied = propsOf(json).filter((p) => kotori.toon?.has(p.name));
    expect(copied.some((p) => p.vectorProperties._Color.slice(0, 3).some((v) => Math.abs(v - 1) > 0.01))).toBe(true);
    for (const p of copied) {
      expect(p.vectorProperties._Color, p.name).toEqual(kotori.toon!.get(p.name)!.vectorProperties._Color);
      expect(p.vectorProperties._ShadeColor, p.name).toEqual(kotori.toon!.get(p.name)!.vectorProperties._ShadeColor);
    }
  });

  it('分开染的头（材质改名成 …_Head_02）、改成两面的（…_Both）照样抄原角色的卡通着色', () => {
    const { json } = exported({ counts: { ...defaultSpec().counts, heads: 2 }, hair: { ...defaultSpec().hair, heads: ['', '#3060ff'] } });
    const renamed = propsOf(json).filter((p) => /_Head_\d+|_Both$/.test(p.name));
    expect(renamed.some((p) => /_Head_02/.test(p.name))).toBe(true);
    for (const p of renamed) {
      const raw = source().toon?.get(p.name.replace(/(?:_Head_\d+)?(?:_Both)?$/, ''));
      if (!raw) continue;
      expect(p.renderQueue, p.name).toBe(raw.renderQueue);
      for (const key of ['_ShadeShift', '_ShadeToony', '_OutlineWidth', '_OutlineWidthMode']) expect(p.floatProperties[key], `${p.name} ${key}`).toBe(raw.floatProperties[key]);
    }
  });
});

describe('成品角色导出 VRM：弹簧骨骼', () => {
  type Group = { comment: string; stiffiness: number; dragForce: number; gravityPower: number; hitRadius: number; bones: number[]; colliderGroups: number[] };
  type Colliders = { node: number; colliders: { offset: { x: number; y: number; z: number }; radius: number }[] };
  const raw = readGlb(bufferOf(CHARACTER.url)).json;
  const rawAnimation = raw.extensions.VRM.secondaryAnimation as { boneGroups: Group[]; colliderGroups: Colliders[] };
  const rawNode = (n: number) => raw.nodes[n].name as string;
  /** 读回来的文件：每一组、每组碰撞球，节点的名字、父节点、位置（换回面朝 +Z） */
  const animationOf = (result: ReturnType<typeof exported>) => {
    const { json } = result;
    const parent = new Map<number, number>();
    (json.nodes as { children?: number[] }[]).forEach((node, i) => {
      for (const c of node.children ?? []) parent.set(c, i);
    });
    const at = (n: number): V3 => {
      const p: V3 = [0, 0, 0];
      for (let k: number | undefined = n; k !== undefined; k = parent.get(k)) {
        const t = json.nodes[k].translation ?? [0, 0, 0];
        for (let i = 0; i < 3; i++) p[i] += t[i];
      }
      return [-p[0], p[1], -p[2]];
    };
    const animation = json.extensions.VRM.secondaryAnimation as { boneGroups: Group[]; colliderGroups: Colliders[] };
    return {
      ...animation,
      name: (n: number) => json.nodes[n].name as string,
      parent: (n: number) => parent.get(n) ?? -1,
      children: (n: number) => (json.nodes[n].children ?? []) as number[],
      at,
    };
  };
  /** 文件里存的碰撞球方向换成面朝 +Z 的写法 */
  const facing = (o: { x: number; y: number; z: number }): V3 => [-o.x, o.y, o.z];
  const cosine = (a: V3, b: V3) => (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));

  it('读角色时留下弹簧骨骼和碰撞球；左臂上的球顺着左臂（+X）排', () => {
    expect(source().springs?.length).toBe(rawAnimation.boneGroups.length);
    expect(source().colliders?.length).toBe(rawAnimation.colliderGroups.length);
    const arm = source().colliders!.find((c) => source().bones[c.bone].name === 'J_Bip_L_UpperArm')!;
    expect(Math.max(...arm.spheres.map((s) => s.offset[0]))).toBeGreaterThan(0.05);
  });

  const one = animationOf(exported());
  it('一个头：每一组照原文件抄（参数一样，串的根换成拼好的骨骼），碰撞球一组不少', () => {
    expect(one.boneGroups.map((g) => g.comment)).toEqual(rawAnimation.boneGroups.map((g) => g.comment));
    one.boneGroups.forEach((g, i) => {
      const was = rawAnimation.boneGroups[i];
      expect(g.stiffiness).toBe(was.stiffiness);
      expect(g.dragForce).toBe(was.dragForce);
      expect(g.gravityPower).toBe(was.gravityPower);
      expect(g.bones.length).toBeGreaterThanOrEqual(was.bones.length);
      for (const c of g.colliderGroups) expect(c).toBeLessThan(one.colliderGroups.length);
    });
    const hair = one.boneGroups.filter((g) => g.bones.every((b) => /^Hair_\d+_\d+$/.test(one.name(b))));
    expect(hair.length).toBeGreaterThan(3);
    expect(one.colliderGroups).toHaveLength(rawAnimation.colliderGroups.length);
  });

  it('头上的碰撞球：方向照原文件（头没歪），大小跟着身高一起缩放', () => {
    const was = rawAnimation.colliderGroups.find((c) => rawNode(c.node) === 'J_Bip_C_Head')!;
    const now = one.colliderGroups.find((c) => one.name(c.node) === 'Head')!;
    const scale = now.colliders[0].radius / was.colliders[0].radius;
    expect(scale).toBeGreaterThan(0.7);
    expect(scale).toBeLessThan(1.4);
    expect(cosine(facing(now.colliders[0].offset), facing(was.colliders[0].offset))).toBeGreaterThan(0.999);
  });

  it('两个头：头发每一组的根多一倍，头上的碰撞球两组，头发也碰复制出来的头', () => {
    const two = animationOf(exported({ counts: { ...defaultSpec().counts, heads: 2 } }));
    const heads = two.colliderGroups.flatMap((c, i) => (/^Head(\.\d+)?$/.test(two.name(c.node)) ? [i] : []));
    expect(heads).toHaveLength(2);
    two.boneGroups.forEach((g, i) => {
      if (!one.boneGroups[i].bones.every((b) => /^Hair_/.test(one.name(b)))) return;
      expect(g.bones).toHaveLength(one.boneGroups[i].bones.length * 2);
      for (const h of heads) expect(g.colliderGroups).toContain(h);
    });
  });

  it('多一对手臂：多出来的手臂也挂碰撞球，球顺着它自己的方向排', () => {
    const four = animationOf(exported({ counts: { ...defaultSpec().counts, armPairs: 2 } }));
    for (const name of ['UpperArm_L', 'UpperArm_L.002']) {
      const group = four.colliderGroups.find((c) => four.name(c.node) === name)!;
      expect(group, name).toBeTruthy();
      // 离关节最远的那个球：顺着上臂到下臂的方向
      const far = group.colliders.reduce((a, b) => (Math.hypot(...facing(b.offset)) > Math.hypot(...facing(a.offset)) ? b : a));
      const child = four.children(group.node).find((n) => /^LowerArm_L/.test(four.name(n)))!;
      const along = four.at(child).map((v, k) => v - four.at(group.node)[k]) as V3;
      expect(cosine(facing(far.offset), along), name).toBeGreaterThan(0.98);
    }
  });

  it('换上的发型：整副头发一组，从头上长出来，参数和碰撞球照她自己的头发', () => {
    const donor = readHair(bufferOf(hairUrl('bob')));
    const bob = animationOf(exported({ hair: { ...defaultSpec().hair, style: 'bob' } }, donor));
    const group = bob.boneGroups.at(-1)!;
    expect(group.comment).toBe('Hair');
    expect(group.bones.length).toBeGreaterThan(3);
    for (const b of group.bones) expect(bob.name(bob.parent(b))).toBe('Head');
    expect(group.colliderGroups.length).toBeGreaterThan(0);
    // 她自己的头发不在了：别的组里没有一根头发
    for (const g of bob.boneGroups.slice(0, -1)) for (const b of g.bones) expect(bob.name(b)).not.toMatch(/^Hair_/);
  });
});

describe('许可说成人话', () => {
  it('CC BY-SA；不许的几条列出来', () => {
    expect(describeLicense({ licenseName: 'CC_BY_SA', allowedUserName: 'Everyone', sexualUssageName: 'Allow' })).toBe('CC BY-SA（要署名，改过的也只能用这个许可）');
    expect(describeLicense({ licenseName: 'Other', sexualUssageName: 'Disallow', commercialUssageName: 'Disallow' })).toBe('原作者自己写的条件，不许用于性表现，不许商用');
  });
});
