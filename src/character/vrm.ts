/**
 * 成品角色写成 VRM 0.x（见 io/vrm.ts）。纯函数。
 *
 * - 姿势：照给的 T-pose 蒙皮矩阵把拼好的角色搬成 T-pose（骨骼也换成摆好以后的那一副）。
 * - 材质：贴图照原样；卡通着色（MToon）照原角色文件里的设定抄，染过的头发把亮面、暗面一起换成染的颜色；
 *   后加的单色部件（尾巴、翅膀、兽身）和换上的发型照材质自己配一份。原文件里的法线、高光、自发光那几张贴图没有读，不带。
 * - 表情：原文件的每个「变形」（ALL_Joy、EYE_Close_L、MTH_A …）都是脸上那个物体的一个形态键，
 *   几张脸（复制出来的头、同一个头上多出来的脸）一起动；表情组照原文件的配法绑到这些形态键上。
 * - 视线：眼睛骨骼进人形骨骼表，眼珠能转多少度照原文件。
 * - meta：许可、允许谁用、暴力、性、商用照原文件原样带上；作者写原作者加改的人，出处写「改自原角色」和要求的署名。
 */
import type { GlbMaterial, GlbMesh } from '../io/glb';
import { type VrmExpression, type VrmSpring, type VrmToon, materialColor, plainToon, writeVrmModel } from '../io/vrm';
import type { CharacterBone, CharacterBuild } from './assemble';
import { characterSkeleton, mergeByMaterial, poseBuild } from './export';
import { applyFaces } from './face';
import { CHARACTER_BLEND, skinInPlace } from './pose';
import type { Chunk, CharacterSource } from './source';

/** VRM 0.x 规定的表情名 */
const PRESETS = new Set(['neutral', 'a', 'i', 'u', 'e', 'o', 'blink', 'joy', 'angry', 'sorrow', 'fun', 'lookup', 'lookdown', 'lookleft', 'lookright', 'blink_l', 'blink_r']);
/** 带表情的那个物体 */
const FACE = 'OC_Face';

export interface CharacterVrmOptions {
  /** T-pose：每根骨骼的蒙皮矩阵（米，见 pose/rig.ts 的 poseMatrices），和摆成 T-pose 以后的骨骼 */
  matrices: Float64Array;
  bones: CharacterBone[];
  /** 文件里的名字 */
  title: string;
  /** 改的人，写进作者里（空的就只写原作者） */
  editor: string;
  /** 许可要求的署名（橙发校服、绿发红裙……）；没有就不给 */
  credit?: string;
  springs?: VrmSpring[];
}

/**
 * 一块脸上的网格开一个变形：静止时开到 1，照 T-pose 搬过去，减去没开的样子，就是这个形态键（几张脸一起开）。
 * 这块网格上没有一个顶点会动，返回 null
 */
function faceTarget(build: CharacterBuild, rest: Chunk, posed: Chunk, name: string, matrices: Float64Array): Float32Array | null {
  const positions = rest.positions.slice();
  const normals = rest.normals.slice();
  const all = Object.fromEntries(build.faces.map((face) => [face.key, { [name]: 1 }]));
  if (!applyFaces(build, rest, all, positions, normals)) return null;
  skinInPlace(CHARACTER_BLEND, positions, normals, rest.joints, rest.weights, matrices);
  let moved = false;
  for (let i = 0; i < positions.length; i++) {
    positions[i] -= posed.positions[i];
    if (Math.abs(positions[i]) > 1e-7) moved = true;
    else positions[i] = 0;
  }
  return moved ? positions : null;
}

/** 原角色的卡通着色照抄：贴图换成工坊的，染过色的把亮面、暗面一起按染的比例换掉 */
function copiedToon(toon: Omit<VrmToon, 'textureProperties'>, material: GlbMaterial): VrmToon {
  const vectors = { ...toon.vectorProperties };
  const color = materialColor(material);
  const was = vectors._Color;
  if (was && was.length >= 3 && color.some((c, k) => k < 3 && Math.abs(c - was[k]) > 1e-3)) {
    const ratio = [0, 1, 2].map((k) => (was[k] > 1e-4 ? color[k] / was[k] : 1));
    vectors._Color = [color[0], color[1], color[2], was[3] ?? color[3]];
    const shade = vectors._ShadeColor;
    if (shade && shade.length >= 3) vectors._ShadeColor = [0, 1, 2].map((k) => Math.min(1, shade[k] * ratio[k])).concat(shade[3] ?? 1);
  }
  return {
    ...toon,
    vectorProperties: vectors,
    textureProperties: material.image === undefined ? {} : { _MainTex: material.image, _ShadeTexture: material.image },
  };
}

/** 表情组：原文件里配好的（规定名字的照用，自己加的写 unknown），再补上 VRM 软件常要的眨眼、平常 */
function expressionsOf(build: CharacterBuild, targets: Set<number>): VrmExpression[] {
  const morphs = build.morphs;
  if (!morphs) return [];
  const out: VrmExpression[] = morphs.expressions
    .map((e) => ({
      name: e.key.charAt(0).toUpperCase() + e.key.slice(1),
      preset: PRESETS.has(e.key) ? e.key : 'unknown',
      binds: e.binds.filter((b) => targets.has(b.morph)).map((b) => ({ object: FACE, target: b.morph, weight: b.weight })),
    }))
    .filter((e) => e.binds.length);
  const has = (key: string) => out.some((e) => e.preset === key);
  if (!has('blink') && has('blink_l') && has('blink_r')) {
    out.push({ name: 'Blink', preset: 'blink', binds: out.filter((e) => e.preset === 'blink_l' || e.preset === 'blink_r').flatMap((e) => e.binds) });
  }
  if (!has('neutral')) out.unshift({ name: 'Neutral', preset: 'neutral', binds: [] });
  return out;
}

/** 写成 VRM 0.x */
export function characterVrm(build: CharacterBuild, source: CharacterSource, options: CharacterVrmOptions): ArrayBuffer {
  const posed = poseBuild(build, options.matrices, options.bones);
  const rest = mergeByMaterial(build);
  const chunks = mergeByMaterial(posed);
  const names = build.morphs?.names ?? [];
  const faceChunks = chunks.map((chunk, c) => Boolean(build.morphs && rest[c].faceVertex && rest[c].faceOf && chunk.faceVertex));
  // 形态键：每个变形在每块脸上的网格各算一份；哪块都不动的变形不要（同一个物体的几块网格形态键要一样多）
  const deltas = chunks.map((chunk, c) => (faceChunks[c] ? names.map((name) => faceTarget(build, rest[c], chunk, name, options.matrices)) : []));
  const kept = names.flatMap((_, n) => (deltas.some((list) => list[n]) ? [n] : []));
  const targetOf = new Map(kept.map((n, t) => [n, t]));
  const meshes: GlbMesh[] = chunks.map((chunk, c) => {
    const m = build.materials[chunk.material];
    const material: GlbMaterial = {
      name: m.name,
      color: 0xffffff,
      factor: m.color,
      ...(m.image >= 0 ? { image: m.image } : {}),
      alphaMode: m.alpha,
      alphaCutoff: m.cutoff,
      doubleSided: m.doubleSided,
      unlit: m.image >= 0,
    };
    const face = faceChunks[c] && kept.length > 0;
    return {
      name: chunk.name,
      object: face ? FACE : 'OC_Body',
      positions: chunk.positions,
      normals: chunk.normals,
      uvs: chunk.uvs,
      indices: chunk.indices,
      joints: chunk.joints,
      weights: chunk.weights,
      material,
      ...(face ? { targets: kept.map((n) => ({ name: names[n], positions: deltas[c][n] ?? new Float32Array(chunk.positions.length) })) } : {}),
    };
  });
  // 表情组里绑的是变形的编号：换成留下来的形态键的编号
  const expressions = expressionsOf(build, new Set(kept)).map((e) => ({
    ...e,
    binds: e.binds.map((b) => ({ ...b, target: targetOf.get(b.target)! })),
  }));
  const raw = source.vrmMeta ?? {};
  const text = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
  const images = source.thumbnail ? [...build.images, source.thumbnail] : build.images;
  return writeVrmModel({
    meshes,
    images,
    skeleton: characterSkeleton(posed),
    meta: {
      title: options.title,
      version: '1.0',
      author: [source.author ? `${source.author}（原作者）` : '', options.editor ? `${options.editor}（改）` : ''].filter(Boolean).join('、') || '不详',
      contactInformation: text(raw.contactInformation),
      reference: [`改自「${source.title}」（用 OC 白模工坊改）`, options.credit ?? ''].filter(Boolean).join('；'),
      allowedUserName: text(raw.allowedUserName, 'OnlyAuthor'),
      violentUssageName: text(raw.violentUssageName, 'Disallow'),
      sexualUssageName: text(raw.sexualUssageName, 'Disallow'),
      commercialUssageName: text(raw.commercialUssageName, 'Disallow'),
      otherPermissionUrl: text(raw.otherPermissionUrl),
      licenseName: text(raw.licenseName, 'Redistribution_Prohibited'),
      otherLicenseUrl: text(raw.otherLicenseUrl),
    },
    ...(source.thumbnail ? { thumbnail: build.images.length } : {}),
    copyright: options.credit ?? [source.title, source.author, source.license].filter(Boolean).join(' / '),
    toon: (material) => {
      const toon = source.toon?.get(material.name);
      return toon ? copiedToon(toon, material) : plainToon(material);
    },
    expressions,
    ...(build.morphs ? { look: build.morphs.look } : {}),
    ...(options.springs ? { springs: options.springs } : {}),
  });
}
