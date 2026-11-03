/**
 * 成品角色写成 VRM 0.x（见 io/vrm.ts）。纯函数。
 *
 * - 姿势：照给的 T-pose 蒙皮矩阵把拼好的角色搬成 T-pose（骨骼也换成摆好以后的那一副）。
 * - 材质：贴图照原样；卡通着色（MToon）照原角色文件里的设定抄，染过的头发把亮面、暗面一起换成染的颜色；
 *   后加的单色部件（尾巴、翅膀、兽身）和换上的发型照材质自己配一份。原文件里的法线、高光、自发光那几张贴图没有读，不带。
 * - 表情：原文件的每个「变形」（ALL_Joy、EYE_Close_L、MTH_A …）都是脸上那个物体的一个形态键，
 *   几张脸（复制出来的头、同一个头上多出来的脸）一起动；表情组照原文件的配法绑到这些形态键上。
 * - 视线：眼睛骨骼进人形骨骼表，眼珠能转多少度照原文件。
 * - 弹簧骨骼：头发、裙摆、胸照原文件的参数晃，碰撞球照原文件挂；复制出来的头、手臂、胸上的跟着复制（见 springsOf）。
 * - meta：许可、允许谁用、暴力、性、商用照原文件原样带上；作者写原作者加改的人，出处写「改自原角色」和要求的署名。
 */
import { type Quat, type V3, Q_ID, cross, len, norm, quatBasis, quatBetween, quatConj, quatMul, rotate, sub } from '../geometry/vec';
import { type GlbMaterial, type GlbMesh, materialColor } from '../io/glb';
import { type VrmColliders, type VrmExpression, type VrmSpring, type VrmToon, linearColor, metaFromV1, plainToon, srgbColor, writeVrmModel } from '../io/vrm';
import { type CharacterBone, type CharacterBuild, isHairBone } from './assemble';
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

/**
 * 原角色的卡通着色照抄，贴图换成工坊的。染过色的（底色和原文件里同名材质的底色 before 不一样）：
 * 亮面换成染的颜色，暗面按同样的比例变。比例在线性空间里算，存回 sRGB（见 io/vrm.ts 的 srgbColor）。
 * 不拿 _Color 和底色比：两个一个是 sRGB、一个是线性，有的导出程序还两个写成一样的
 */
function copiedToon(toon: Omit<VrmToon, 'textureProperties'>, material: GlbMaterial, before: readonly number[] | undefined): VrmToon {
  const vectors = { ...toon.vectorProperties };
  const color = materialColor(material);
  if (before && color.some((c, k) => k < 3 && Math.abs(c - before[k]) > 1e-4)) {
    const ratio = [0, 1, 2].map((k) => (before[k] > 1e-4 ? color[k] / before[k] : 1));
    vectors._Color = [...srgbColor(color).slice(0, 3), vectors._Color?.[3] ?? color[3]];
    const shade = vectors._ShadeColor;
    if (shade && shade.length >= 3) {
      const lit = linearColor(shade);
      vectors._ShadeColor = srgbColor([0, 1, 2].map((k) => Math.min(1, lit[k] * ratio[k]))).concat(shade[3] ?? 1);
    }
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

const median = (list: number[]) => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * 弹簧骨骼和碰撞球照原文件抄到拼好的骨架上（bones 是 T-pose 时的骨架）。
 * - 拼好的每根骨骼照 origins 认是原文件的哪一根，再往上找最近的一串的第一根：那一串属于哪一组，它就跟着那一组晃。
 *   复制出来的头上的头发、多排的胸也是那一组，各自从自己的根开始晃。
 * - 碰撞球：原文件挂在哪根骨骼上，拼好以后那根骨骼的每一份（复制出来的手臂、头、上半身）都挂一组。
 *   球心照这根骨骼和相邻几根骨骼的方向转过去（歪着的头、斜着的手臂），球的大小照骨骼之间的距离缩放。
 * - 换上的发型（文件里没有弹簧骨骼）：整副头发一组，参数和碰的碰撞球照角色自己的头发。
 */
function springsOf(build: CharacterBuild, source: CharacterSource, bones: CharacterBone[]): { springs: VrmSpring[]; colliders: VrmColliders[] } {
  const origins = build.origins;
  const own = source.springs ?? [];
  if (!origins) return { springs: [], colliders: [] };
  const from = source.bones;
  const children: number[][] = bones.map(() => []);
  bones.forEach((b, i) => {
    if (b.parent >= 0) children[b.parent].push(i);
  });
  /**
   * 这根骨骼到它的子骨骼（离得远的排前面）：原文件里、拼好以后各是哪个方向、多远。骨骼转了，子骨骼跟着转；
   * 没有子骨骼的才看父骨骼（当它和父骨骼一起转）
   */
  const pairs = (i: number): { s: V3; t: V3 }[] => {
    const o = origins[i];
    if (o?.file !== 'body') return [];
    const toward = (list: number[]) => {
      const out: { s: V3; t: V3 }[] = [];
      for (const n of list) {
        const on = n >= 0 ? origins[n] : null;
        if (on?.file !== 'body' || on.bone === o.bone) continue;
        const s = sub(from[on.bone].pos, from[o.bone].pos);
        const t = sub(bones[n].head, bones[i].head);
        if (len(s) > 0.005 && len(t) > 1e-4) out.push({ s, t });
      }
      return out.sort((a, b) => len(b.s) - len(a.s));
    };
    const down = toward(children[i]);
    return down.length ? down : toward([bones[i].parent]);
  };
  const ratios = bones.flatMap((_, i) => pairs(i).slice(0, 1).map(({ s, t }) => len(t) / len(s)));
  const overall = ratios.length ? median(ratios) : 1;
  /** 一根骨骼从原文件到拼好以后转了多少、放大了多少 */
  const frameOf = (i: number): { q: Quat; scale: number } => {
    const list = pairs(i);
    if (!list.length) return { q: Q_ID, scale: overall };
    const scale = median(list.map(({ s, t }) => len(t) / len(s)));
    // 第一个方向，再加一个和它最不平行的方向，两个方向定下转了多少；只有一个方向就按最短的转法
    const [first] = list;
    let second: { s: V3; t: V3 } | undefined;
    let best = 0.3;
    for (const p of list.slice(1)) {
      const sin = len(cross(norm(first.s), norm(p.s)));
      if (sin > best) [best, second] = [sin, p];
    }
    if (!second) return { q: quatBetween(norm(first.s), norm(first.t)), scale };
    const basis = (a: V3, b: V3) => {
      const x = norm(a);
      const z = norm(cross(a, b));
      return quatBasis(x, cross(z, x), z);
    };
    return { q: quatMul(basis(first.t, second.t), quatConj(basis(first.s, second.s))), scale };
  };

  /* 碰撞球：原文件的每一组，拼好以后有几份就挂几组 */
  const colliders: VrmColliders[] = [];
  const copiesOf = (source.colliders ?? []).map((group) =>
    bones.flatMap((_, i) => {
      const o = origins[i];
      if (o?.file !== 'body' || o.bone !== group.bone) return [];
      const { q, scale } = frameOf(i);
      return [colliders.push({ bone: i, spheres: group.spheres.map((s) => ({ offset: rotate(q, s.offset).map((v) => v * scale) as V3, radius: s.radius * scale })) }) - 1];
    }),
  );

  /* 每根骨骼跟着哪一组晃：原文件里往上找，最近的一串的第一根属于哪一组 */
  const groupOfRoot = new Map<number, number>();
  own.forEach((spring, g) => {
    for (const r of spring.roots) if (!groupOfRoot.has(r)) groupOfRoot.set(r, g);
  });
  const groupOf = (bone: number): number => {
    for (let b = bone; b >= 0; b = from[b].parent) {
      const g = groupOfRoot.get(b);
      if (g !== undefined) return g;
    }
    return -1;
  };
  // 换上的发型排在最后一组
  const donor = own.length;
  const member = origins.map((o) => (o?.file === 'hair' ? donor : o ? groupOf(o.bone) : -1));
  const rootsOf = (g: number) => member.flatMap((m, i) => (m === g && (bones[i].parent < 0 || member[bones[i].parent] !== g) ? [i] : []));
  const springs: VrmSpring[] = own.map((s, g) => ({
    comment: s.comment,
    roots: rootsOf(g),
    stiffness: s.stiffness,
    gravity: s.gravity,
    gravityDir: s.gravityDir,
    drag: s.drag,
    hitRadius: s.hitRadius * overall,
    colliders: s.colliders.flatMap((c) => copiesOf[c] ?? []),
  }));
  const donorRoots = rootsOf(donor);
  if (donorRoots.length) {
    const hair = own.find((s) => s.roots.some((r) => isHairBone(from[r].name)));
    springs.push({
      comment: 'Hair',
      roots: donorRoots,
      stiffness: hair?.stiffness ?? 0.5,
      gravity: hair?.gravity ?? 0.05,
      drag: hair?.drag ?? 0.4,
      hitRadius: hair ? hair.hitRadius * overall : 0.02,
      colliders: hair ? hair.colliders.flatMap((c) => copiesOf[c] ?? []) : colliders.map((_, i) => i),
    });
  }
  return { springs: springs.filter((s) => s.roots.length), colliders };
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
  const raw = source.vrmMeta ?? (source.vrm1Meta ? metaFromV1(source.vrm1Meta) : {});
  const text = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
  const sway = springsOf(build, source, options.bones);
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
      reference: [`改自「${source.title}」（用 OC 白模工坊改）`, options.credit ?? '', text(raw.reference)].filter(Boolean).join('；'),
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
      // 分开染的头（…_Head_02）、改成两面的（…_Both）是拼的时候改过名的同一种材质：照原来的名字找
      const name = source.toon?.has(material.name) ? material.name : material.name.replace(/(?:_Head_\d+)?(?:_Both)?$/, '');
      const toon = source.toon?.get(name);
      return toon ? copiedToon(toon, material, source.materials.find((m) => m.name === name)?.color) : plainToon(material);
    },
    expressions,
    ...(build.morphs ? { look: build.morphs.look } : {}),
    springs: [...sway.springs, ...(options.springs ?? [])],
    colliders: sway.colliders,
  });
}
