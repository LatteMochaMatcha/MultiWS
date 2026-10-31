/**
 * 成品角色的手动微调：和白模人台一样，按部件实例的名字（Arm_01_L、Head_02、Tail_01 …）记在 BodySpec.overrides 里，
 * 拼好以后把那个部件带着的顶点和骨骼挪过去。位置沿父部件的轴（米），旋转绕父部件的轴、以部件的关节为中心，缩放也以关节为中心。
 *
 * 成品角色不是一块块拼的，部件按骨骼分：一个部件就是一串骨骼（手臂从上臂起、腿从大腿根起、头、脖子、尾巴、翅膀、兽耳、胸），
 * 顶点照它跟着这串骨骼的权重挪——和别处相连的地方（肩膀、腿根、脖子）渐渐过渡，不会裂开，挪远了那里会拉长。
 * 复制出来的手臂整块都跟着它自己的骨骼（连锁骨那一节），挪开就是整条拿下来。
 * 没有自己骨骼的（角、第二对以后的胸）照网格认，整块挪。
 * 躯干带着脖子、头、手臂、胸、翅膀；头带着角、兽耳；腿、尾巴各自独立。纯函数，不碰 three.js 和 DOM。
 */
import type { PartType } from '../geometry/figure';
import type { PartFrame } from '../geometry/tweak';
import {
  type Mat3,
  type Quat,
  type V3,
  Q_ID,
  add,
  mat3Apply,
  mat3Mul,
  norm,
  quatBetween,
  quatConj,
  quatEuler,
  quatMat3,
  quatMul,
  rotate,
  scaleAlong,
  sub,
} from '../geometry/vec';
import type { PartOverride } from '../model/spec';
import type { CharacterBone, CharacterBuild } from './assemble';
import type { FaceInstance } from './face';
import type { Chunk } from './source';

const DEG = Math.PI / 180;
const DOWN: V3 = [0, -1, 0];
const pad = (n: number) => String(n).padStart(2, '0');
/** 骨骼名后面的序号：UpperArm_L → 1，UpperArm_L.002 → 2 */
const ordinal = (name: string) => Number(/\.(\d+)$/.exec(name)?.[1] ?? 1);
const tagOf = (side: number) => (side > 0 ? 'L' : 'R');
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** 角的根：离头的关节最近的这么多成顶点的平均位置 */
const HORN_BASE = 0.15;

/** 成品角色上能单独微调的一个部件 */
export interface CharacterPart {
  /** 和白模人台的部件同名：Torso、Head_02、Arm_01_L、Leg_01、Tail_02、Head_01_Horn_01_L … */
  name: string;
  type: PartType;
  side: -1 | 0 | 1;
  /** 父部件：躯干带着头、手臂……，头带着角、兽耳 */
  parent?: string;
  /** 带着哪些骨骼（下标）：照它们的权重挪顶点，这些骨骼整个跟着挪 */
  bones: number[];
  /** 关节在哪根骨骼的头上（转动、缩放的中心）；照网格认的部件没有 */
  root?: number;
  /** 照网格认的：哪几块网格（名字）；side 不为 0 时只要 x 在那一边的点 */
  meshes?: string[];
  /** 「大小」沿哪根骨骼的方向：手臂、腿的 Y 是它们的长短（到这根骨骼的头为止） */
  along?: number;
}

/** 一副骨架里每根骨骼的子骨骼 */
function childrenOf(bones: readonly CharacterBone[]): number[][] {
  const out = bones.map((): number[] => []);
  bones.forEach((b, i) => {
    if (b.parent >= 0) out[b.parent].push(i);
  });
  return out;
}

function subtree(children: number[][], root: number, keep: (b: number) => boolean = () => true): number[] {
  const list = [root];
  for (let i = 0; i < list.length; i++) for (const c of children[list[i]]) if (keep(c)) list.push(c);
  return list;
}

/** 这副成品角色上能单独微调的部件 */
export function characterParts(build: Pick<CharacterBuild, 'bones' | 'meshes'>): CharacterPart[] {
  const { bones } = build;
  const children = childrenOf(bones);
  const find = (name: string) => bones.findIndex((b) => b.name === name);
  const parts: CharacterPart[] = [];
  // 好几个上半身时（见 assemble.ts）：躯干是胯那一块，每个上半身各是一个部件（UpperBody_L …，和两种白模同名）
  const spines = bones.flatMap((b, i) => (/^Spine(_[LR])?$/.test(b.name) ? [i] : []));
  const multi = spines.length > 1;
  const spine = find('Spine');
  if (!multi && spine >= 0) parts.push({ name: 'Torso', type: 'torso', side: 0, bones: subtree(children, spine), root: spine });
  if (multi) {
    const hips = find('Hips');
    if (hips >= 0) parts.push({ name: 'Torso', type: 'torso', side: 0, bones: [hips], root: hips });
    for (const i of spines) {
      const side = /_([LR])$/.exec(bones[i].name)?.[1] ?? '';
      parts.push({ name: `UpperBody${side ? `_${side}` : ''}`, type: 'torso', side: side === 'L' ? 1 : side === 'R' ? -1 : 0, parent: 'Torso', bones: subtree(children, i), root: i });
    }
  }
  /** 长在哪个部件上：好几个上半身时是它所在的那个上半身 */
  const host = (i: number): string => {
    if (!multi) return 'Torso';
    for (let b = i; b >= 0; b = bones[b].parent) {
      const m = /^Spine(?:_([LR]))?$/.exec(bones[b].name);
      if (m) return `UpperBody${m[1] ? `_${m[1]}` : ''}`;
    }
    return 'Torso';
  };
  const firstDescendant = (root: number, re: RegExp) => subtree(children, root).find((b) => re.test(bones[b].name));
  bones.forEach((b, i) => {
    let m: RegExpExecArray | null;
    if ((m = /^Neck(\.\d+)?$/.exec(b.name))) {
      parts.push({ name: `Neck_${pad(ordinal(b.name))}`, type: 'neck', side: 0, parent: host(i), bones: subtree(children, i), root: i });
    } else if ((m = /^Head(\.\d+)?$/.exec(b.name))) {
      parts.push({ name: `Head_${pad(ordinal(b.name))}`, type: 'head', side: 0, parent: host(i), bones: subtree(children, i), root: i });
    } else if ((m = /^UpperArm_([LR])(\.\d+)?$/.exec(b.name))) {
      const side = m[1] === 'L' ? 1 : -1;
      const k = ordinal(b.name);
      // 复制出来的手臂连锁骨那一节整条都是它自己的：整块跟着挪
      const up = b.parent >= 0 && /^Shoulder_/.test(bones[b.parent].name) && k > 1 ? b.parent : i;
      parts.push({
        name: `Arm_${pad(k)}_${m[1]}`,
        type: 'arm',
        side,
        parent: host(i),
        bones: subtree(children, up),
        root: i,
        along: firstDescendant(i, /^Hand_/),
      });
    } else if ((m = /^UpperLeg(_[LR])?(\.\d+)?$/.exec(b.name))) {
      const side = m[1] === '_L' ? 1 : m[1] === '_R' ? -1 : 0;
      // 只要腿上的骨骼：有的角色把裙摆的骨骼挂在大腿上，裙子不跟着腿走
      const legBones = subtree(children, i, (c) => /^(UpperLeg|LowerLeg|Foot|Toe)/.test(bones[c].name));
      parts.push({
        name: `Leg_${pad(ordinal(b.name))}${side ? `_${m[1][1]}` : ''}`,
        type: 'leg',
        side,
        bones: legBones,
        root: i,
        along: legBones.find((c) => /^Foot/.test(bones[c].name)),
      });
    } else if ((m = /^Tail_(\d+)_01$/.exec(b.name))) {
      parts.push({ name: `Tail_${m[1]}`, type: 'tail', side: 0, bones: subtree(children, i), root: i });
    } else if ((m = /^Wing_(\d+)_([LR])$/.exec(b.name))) {
      parts.push({ name: b.name, type: 'wing', side: m[2] === 'L' ? 1 : -1, parent: host(i), bones: subtree(children, i), root: i });
    } else if ((m = /^Ear_(\d+)_([LR])(\.\d+)?$/.exec(b.name))) {
      const head = `Head_${pad(ordinal(b.name))}`;
      parts.push({ name: `${head}_Ear_${m[1]}_${m[2]}`, type: 'ear', side: m[2] === 'L' ? 1 : -1, parent: head, bones: subtree(children, i), root: i });
    } else if (!multi && (m = /^Bust1_([LR])$/.exec(b.name))) {
      parts.push({ name: `Chest_01_${m[1]}`, type: 'chest', side: m[1] === 'L' ? 1 : -1, parent: 'Torso', bones: subtree(children, i), root: i });
    }
  });
  // 没有自己骨骼的：角整块是一块网格；复制出来的胸左右两边在同一块网格里
  const chests = new Map<number, string[]>();
  for (const mesh of build.meshes) {
    // 角和白模人台的同名：每个头一只时长在额头正中（Head_01_Horn_C），成对的分左右（Head_01_Horn_01_L）
    const horn = /^Head_(\d+)_Horn_.*?(?:_([LR]))?$/.exec(mesh.name);
    if (horn) parts.push({ name: mesh.name, type: 'horn', side: horn[2] === 'L' ? 1 : horn[2] === 'R' ? -1 : 0, parent: `Head_${horn[1]}`, bones: [], meshes: [mesh.name] });
    const chest = /_Chest_(\d+)$/.exec(mesh.name);
    if (chest) chests.set(Number(chest[1]), [...(chests.get(Number(chest[1])) ?? []), mesh.name]);
  }
  for (const [k, meshes] of chests) {
    for (const side of [1, -1] as const) parts.push({ name: `Chest_${pad(k)}_${tagOf(side)}`, type: 'chest', side, parent: 'Torso', bones: [], meshes });
  }
  return parts;
}

/** 每个顶点跟着这个部件挪多少（0 到 1） */
function weightsOf(part: CharacterPart, chunk: Chunk, set: ReadonlySet<number>): Float32Array | null {
  const count = chunk.positions.length / 3;
  if (part.meshes) {
    if (!part.meshes.includes(chunk.name)) return null;
    const out = new Float32Array(count);
    for (let v = 0; v < count; v++) out[v] = !part.side || chunk.positions[v * 3] * part.side > 0 ? 1 : 0;
    return out;
  }
  let any = false;
  const out = new Float32Array(count);
  for (let v = 0; v < count; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (set.has(chunk.joints[v * 4 + k])) w += chunk.weights[v * 4 + k];
    out[v] = Math.min(1, w);
    if (w) any = true;
  }
  return any ? out : null;
}

/** 照网格认的部件的关节：角是它贴着头的那一圈，胸是那一边的正中 */
function meshPivot(part: CharacterPart, build: Pick<CharacterBuild, 'meshes'>, near: V3 | null): V3 {
  const points: V3[] = [];
  for (const chunk of build.meshes) {
    if (!part.meshes!.includes(chunk.name)) continue;
    for (let v = 0; v < chunk.positions.length; v += 3) {
      if (part.side && chunk.positions[v] * part.side <= 0) continue;
      points.push([chunk.positions[v], chunk.positions[v + 1], chunk.positions[v + 2]]);
    }
  }
  if (!points.length) return [0, 0, 0];
  const dist = (p: V3) => (near ? Math.hypot(p[0] - near[0], p[1] - near[1], p[2] - near[2]) : 0);
  const chosen = near ? [...points].sort((a, b) => dist(a) - dist(b)).slice(0, Math.max(1, Math.ceil(points.length * HORN_BASE))) : points;
  const sum = chosen.reduce((s, p) => add(s, p), [0, 0, 0] as V3);
  return [sum[0] / chosen.length, sum[1] / chosen.length, sum[2] / chosen.length];
}

/** 微调套上去以后的角色，和每个部件现在的支点、朝向（操纵杆摆在哪） */
export interface TweakedCharacter {
  build: CharacterBuild;
  parts: CharacterPart[];
  frames: Map<string, PartFrame>;
}

/**
 * 把微调套到拼好的成品角色上。父部件先挪（躯干带着头、手臂），子部件再在挪过以后的位置上、照父部件转过以后的轴挪。
 * 返回新的角色（原来那份不动）
 */
export function tweakCharacter(base: CharacterBuild, overrides: Readonly<Record<string, PartOverride>>): TweakedCharacter {
  const parts = characterParts(base);
  const bones: CharacterBone[] = base.bones.map((b) => ({ ...b, head: [...b.head] as V3, tail: [...b.tail] as V3 }));
  const meshes: Chunk[] = base.meshes.map((m) => ({ ...m }));
  const faces: FaceInstance[] = base.faces.map((f) => ({ ...f }));
  const build: CharacterBuild = { ...base, bones, meshes, faces };
  const byName = new Map(parts.map((p) => [p.name, p]));
  // 父部件先挪：按关节所在的骨骼排（父骨骼总在子骨骼前面）；照网格认的跟在父部件后面
  const rank = (p: CharacterPart): number => p.root ?? rank(byName.get(p.parent ?? '') ?? { ...p, root: 0 }) + 0.5;
  const order = [...parts].sort((a, b) => rank(a) - rank(b));
  /** 挪过以后每个部件在世界里的朝向 */
  const orient = new Map<string, Quat>();
  const frames = new Map<string, PartFrame>();
  /** 部件 p 的父部件：照网格认的用记着的；按骨骼的是带着它的关节的那些里最深的一个 */
  const parentOf = (p: CharacterPart): CharacterPart | undefined => {
    if (p.meshes || p.root === undefined) return p.parent ? byName.get(p.parent) : undefined;
    let best: CharacterPart | undefined;
    for (const q of order) {
      if (q === p) break;
      if (q.root !== undefined && q.bones.includes(p.root) && (!best || rank(q) > rank(best))) best = q;
    }
    return best;
  };
  /**
   * 挪腿时胯跟着挪（只跟平移，转腿、缩放腿只动腿自己）：胯上不跟着哪条腿的点，照离哪条腿的根最近来分——
   * 离这条腿近的整个跟着平移，和相邻那条腿中间那一带渐渐过渡（过渡带有两条腿的间隔那么宽）；
   * 从髋关节往上到腰（Spine 的关节）渐渐不跟，上身不动。只有一条腿时整副胯跟着它
   */
  const followHips = (part: CharacterPart, shift: V3) => {
    const root = bones[part.root!].head;
    const legs = parts.filter((p) => p.type === 'leg' && p.root !== undefined);
    const others = legs.filter((p) => p !== part).map((p) => bones[p.root!].head);
    const legBones = new Set(legs.flatMap((p) => p.bones));
    // 好几个上半身时取最低的那根脊柱
    const spineTops = bones.filter((b) => /^Spine(_[LR])?$/.test(b.name)).map((b) => b.head[1]);
    const top = spineTops.length ? Math.min(...spineTops) : root[1] + 0.15;
    const gap = others.length ? Math.max(0.02, Math.min(...others.map((h) => Math.hypot(h[0] - root[0], h[2] - root[2])))) : 0;
    for (let c = 0; c < meshes.length; c++) {
      let copied = meshes[c].positions !== base.meshes[c].positions;
      const chunk = meshes[c];
      for (let v = 0; v < chunk.positions.length / 3; v++) {
        let onLeg = 0;
        for (let k = 0; k < 4; k++) if (legBones.has(chunk.joints[v * 4 + k])) onLeg += chunk.weights[v * 4 + k];
        if (onLeg >= 1) continue;
        const [x, y, z] = [chunk.positions[v * 3], chunk.positions[v * 3 + 1], chunk.positions[v * 3 + 2]];
        const rise = smooth((top - y) / (top - root[1]));
        if (!rise) continue;
        const own = Math.hypot(x - root[0], z - root[2]);
        const near = others.length ? smooth(0.5 + (Math.min(...others.map((h) => Math.hypot(x - h[0], z - h[2]))) - own) / gap) : 1;
        const f = (1 - onLeg) * rise * near;
        if (!f) continue;
        if (!copied) {
          meshes[c] = { ...chunk, positions: chunk.positions.slice() };
          copied = true;
        }
        for (let k = 0; k < 3; k++) meshes[c].positions[v * 3 + k] += shift[k] * f;
      }
    }
  };
  for (const part of order) {
    const up = parentOf(part);
    const F = (up && orient.get(up.name)) ?? Q_ID;
    // 角的关节在它贴着头的那一圈：离头的关节最近的那些点
    const host = part.type === 'horn' ? byName.get(part.parent ?? '') : undefined;
    const near = host?.root !== undefined ? bones[host.root].head : null;
    const pivot: V3 = part.root !== undefined ? [...bones[part.root].head] : meshPivot(part, build, near);
    // 「大小」的三根轴：手臂、腿的 Y 沿着它们（从关节指向手腕、脚踝），别的就是父部件的轴
    const axes = part.along !== undefined && part.root !== undefined ? quatBetween(DOWN, norm(sub(bones[part.along].head, pivot))) : F;
    const o = overrides[part.name];
    const q = o?.rotation ? quatMul(quatMul(F, quatEuler(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG)), quatConj(F)) : Q_ID;
    const shift = o?.position ? rotate(F, o.position) : ([0, 0, 0] as V3);
    orient.set(part.name, quatMul(q, F));
    frames.set(part.name, { pivot: add(pivot, shift), parentQuat: F, parentScale: 1, axesQuat: quatMul(q, axes) });
    if (!o || (!o.position && !o.rotation && !o.scale)) continue;
    const R = quatMat3(q);
    const s = o.scale ?? [1, 1, 1];
    const M = mat3Mul(R, scaleAlong(s, axes));
    const N = mat3Mul(R, scaleAlong([1 / s[0], 1 / s[1], 1 / s[2]], axes));
    const moved = (p: V3): V3 => add(add(pivot, shift), mat3Apply(M, sub(p, pivot)));
    const set = new Set(part.bones);
    for (let c = 0; c < meshes.length; c++) {
      const w = weightsOf(part, meshes[c], set);
      if (!w) continue;
      // 第一次挪到这块网格时才复制一份（原来那份不动）
      if (meshes[c].positions === base.meshes[c].positions) meshes[c] = { ...meshes[c], positions: meshes[c].positions.slice(), normals: meshes[c].normals.slice() };
      const chunk = meshes[c];
      for (let v = 0; v < w.length; v++) {
        if (!w[v]) continue;
        const p: V3 = [chunk.positions[v * 3], chunk.positions[v * 3 + 1], chunk.positions[v * 3 + 2]];
        const to = moved(p);
        for (let k = 0; k < 3; k++) chunk.positions[v * 3 + k] = p[k] + (to[k] - p[k]) * w[v];
        const n: V3 = [chunk.normals[v * 3], chunk.normals[v * 3 + 1], chunk.normals[v * 3 + 2]];
        const turned = norm(mat3Apply(N, n));
        chunk.normals.set(norm([n[0] + (turned[0] - n[0]) * w[v], n[1] + (turned[1] - n[1]) * w[v], n[2] + (turned[2] - n[2]) * w[v]]), v * 3);
      }
    }
    // 挪腿：胯上离这条腿最近的那一片也跟着挪，胯不会还撑在原来那么宽（要在腿的骨骼挪走之前算）
    if (part.type === 'leg' && o.position && part.root !== undefined) followHips(part, shift);
    for (const b of part.bones) {
      bones[b].head = moved(bones[b].head);
      bones[b].tail = moved(bones[b].tail);
    }
    // 跟着这个部件的脸：表情、视线照它转过以后的方向
    const names = new Set(part.bones.map((b) => bones[b].name));
    faces.forEach((face, i) => {
      if (!names.has(face.bone)) return;
      faces[i] = { ...face, frame: mat3Mul(M, face.frame) as Mat3, turn: mat3Mul(R, face.turn) as Mat3, quat: quatMul(q, face.quat) };
    });
  }
  // 腿改长、改短了：整个人跟着升降，脚还踩在地上（和白模人台一样）
  if (parts.some((p) => p.type === 'leg' && overrides[p.name]?.scale)) {
    const sole = (b: CharacterBuild) => lowestLegPoint(b, parts);
    const dy = sole(base) - sole(build);
    if (Number.isFinite(dy) && Math.abs(dy) > 1e-9) {
      for (let c = 0; c < meshes.length; c++) {
        if (meshes[c].positions === base.meshes[c].positions) meshes[c] = { ...meshes[c], positions: meshes[c].positions.slice() };
        for (let v = 1; v < meshes[c].positions.length; v += 3) meshes[c].positions[v] += dy;
      }
      for (const b of bones) {
        b.head[1] += dy;
        b.tail[1] += dy;
      }
      for (const f of frames.values()) f.pivot = [f.pivot[0], f.pivot[1] + dy, f.pivot[2]];
      build.metrics = { ...build.metrics, height: build.metrics.height + dy };
    }
  }
  return { build, parts, frames };
}

/** 腿上（跟着腿的权重过半的点）最低的那一点有多高：脚底 */
function lowestLegPoint(build: CharacterBuild, parts: CharacterPart[]): number {
  const legs = new Set(parts.filter((p) => p.type === 'leg').flatMap((p) => p.bones));
  let low = Infinity;
  for (const chunk of build.meshes) {
    for (let v = 0; v < chunk.positions.length / 3; v++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (legs.has(chunk.joints[v * 4 + k])) w += chunk.weights[v * 4 + k];
      if (w > 0.5 && chunk.positions[v * 3 + 1] < low) low = chunk.positions[v * 3 + 1];
    }
  }
  return low;
}

/** 最具体的部件排在前面：角在头前面，头在躯干前面 */
const specific = (parts: CharacterPart[]) => [...parts].reverse();

/** 模型上 point 这一点（世界坐标，米）是哪个部件：看离它最近的顶点跟着谁 */
export function characterPartAt(tweaked: TweakedCharacter, point: V3): string | null {
  const { build, parts } = tweaked;
  let best = Infinity;
  let at: { chunk: Chunk; v: number } | null = null;
  for (const chunk of build.meshes) {
    for (let v = 0; v < chunk.positions.length / 3; v++) {
      const d = (chunk.positions[v * 3] - point[0]) ** 2 + (chunk.positions[v * 3 + 1] - point[1]) ** 2 + (chunk.positions[v * 3 + 2] - point[2]) ** 2;
      if (d < best) {
        best = d;
        at = { chunk, v };
      }
    }
  }
  if (!at) return null;
  const { chunk, v } = at;
  for (const part of specific(parts)) {
    if (part.meshes) {
      if (part.meshes.includes(chunk.name) && (!part.side || chunk.positions[v * 3] * part.side > 0)) return part.name;
      continue;
    }
    let w = 0;
    for (let k = 0; k < 4; k++) if (part.bones.includes(chunk.joints[v * 4 + k])) w += chunk.weights[v * 4 + k];
    if (w >= 0.5) return part.name;
  }
  // 胯、裙子这些不属于哪个部件的：算躯干
  return parts.some((p) => p.name === 'Torso') ? 'Torso' : null;
}

/** 选中的部件罩一层颜色用的三角面（世界坐标，每三个点一个面）：跟着它的权重过半的那些面 */
export function characterPartGlow(tweaked: TweakedCharacter, name: string): Float32Array {
  const part = tweaked.parts.find((p) => p.name === name);
  if (!part) return new Float32Array(0);
  const set = new Set(part.bones);
  const out: number[] = [];
  for (const chunk of tweaked.build.meshes) {
    const w = weightsOf(part, chunk, set);
    if (!w) continue;
    for (let t = 0; t < chunk.indices.length; t += 3) {
      const [a, b, c] = [chunk.indices[t], chunk.indices[t + 1], chunk.indices[t + 2]];
      if (w[a] + w[b] + w[c] < 1.5) continue;
      for (const v of [a, b, c]) out.push(chunk.positions[v * 3], chunk.positions[v * 3 + 1], chunk.positions[v * 3 + 2]);
    }
  }
  return Float32Array.from(out);
}
