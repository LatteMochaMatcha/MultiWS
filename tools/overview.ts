// 总览重测：三种身体样式 × 各种肢体组合 × 一串姿势，出图并记检查结果。
//   node tools/run.mjs tools/overview.ts <输出目录> [--shard 0/6] [--only A01,M03] [--poses 0,3,5]
// 每种组合先出静止的正面全身，再逐个套姿势出斜前全身（和工坊里套现成姿势一样：多出来的腿、几个上半身的脊柱照着摆，
// 手臂挑一条摆、别的跟着、再让开身体）。会照姿势重新融合的照姿势融合，别的照蒙皮权重把静止的网格弯过去。
// 每张图一行记进 <输出目录>/shard-<k>.jsonl：网格几块、破口边、非流形边、耗时；蒙皮的另记边最多拉长几倍、拉长两倍以上的边占多少。
// 之后用 tools/overview-sheet.py 按组合拼成总图。
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installAnimeBody } from '../src/anime/body';
import { assembleCharacter } from '../src/character/assemble';
import { characterSkeleton } from '../src/character/export';
import { CHARACTER } from '../src/character/load';
import { CHARACTER_BLEND, skinInPlace } from '../src/character/pose';
import { readCharacter } from '../src/character/source';
import { findClashes } from '../src/geometry/clash';
import type { Figure } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { quatEuler } from '../src/geometry/vec';
import { type BodySpec, type BodyStyle, defaultSpec, legPlan, normalizeSpec } from '../src/model/spec';
import { clearArms } from '../src/pose/clear';
import { fitArms, followArms } from '../src/pose/fit';
import { fitLegs } from '../src/pose/fitLegs';
import { POSE_LIBRARY } from '../src/pose/library';
import type { Posing } from '../src/pose/posing';
import { forward, poseMatrices } from '../src/pose/rig';
import { makeSolver, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { compileField, fieldAt } from '../src/sdf/field';
import { VOXEL } from '../src/sdf/fuse';
import { runJob } from '../src/sdf/job';
import { refusable } from '../src/sdf/posedField';
import { type V3, VIEWS, frameFor, png, render } from './softRender';

type Patch = Partial<Omit<BodySpec, 'counts' | 'shape'>> & { counts?: Partial<BodySpec['counts']>; shape?: Partial<BodySpec['shape']> };
interface Case {
  name: string;
  label: string;
  style: BodyStyle;
  spec: Patch;
}

const anime = (name: string, label: string, spec: Patch): Case => ({ name, label: `二次元素体 · ${label}`, style: 'anime', spec });
const white = (name: string, label: string, spec: Patch): Case => ({ name, label: `白模人台 · ${label}`, style: 'mannequin', spec });
const made = (name: string, label: string, spec: Patch): Case => ({ name, label: `成品角色 · ${label}`, style: 'character', spec });

export const CASES: Case[] = [
  anime('A01', '默认（一头一身一对手两腿一对胸）', {}),
  anime('A02', '两对手臂上下排', { armLayout: 'stack', counts: { armPairs: 2 } }),
  anime('A03', '两对手臂肩部聚拢', { armLayout: 'fan', counts: { armPairs: 2 } }),
  anime('A04', '三个头', { counts: { heads: 3 } }),
  anime('A05', '三排胸 · 两对手臂上下排 · 胸 2.2', { armLayout: 'stack', counts: { chestPairs: 3, armPairs: 2 }, shape: { bust: 2.2 } }),
  anime('A06', '四条腿（人马）', { counts: { legs: 4 } }),
  anime('A07', '八条腿（蛛形）', { counts: { legs: 8 } }),
  anime('A08', '三条腿', { counts: { legs: 3 } }),
  anime('A09', '四条腿左右并排', { legLayout: 'row', counts: { legs: 4 } }),
  anime('A10', '四条腿胯部聚拢', { legLayout: 'gather', counts: { legs: 4 } }),
  anime('A11', '四条腿横排两副胯', { legLayout: 'abreast', counts: { legs: 4 } }),
  anime('A12', '人腿人马（前三后三）', { legLayout: 'humantaur', hipLegs: 3, counts: { legs: 6 } }),
  anime('A13', '三条尾巴 · 一对翅膀', { counts: { tails: 3, wingPairs: 1 } }),
  anime('A14', '两个上半身', { counts: { torsos: 2 } }),
  anime('A15', '两个上半身 · 各两头两对手（肩部聚拢）两对胸', { armLayout: 'fan', counts: { torsos: 2, heads: 2, armPairs: 2, chestPairs: 2 } }),
  anime('A16', '两个头 · 宽躯干', { headLayout: 'wide', counts: { heads: 2 } }),
  anime('A17', '两个上半身 · 横排两副胯', { legLayout: 'abreast', counts: { torsos: 2, legs: 4 } }),
  anime('A18', '两个头 · 横排两副胯 · 两对手（肩部聚拢）', { legLayout: 'abreast', armLayout: 'fan', counts: { heads: 2, legs: 4, armPairs: 2 } }),
  anime('A19', '三个上半身', { counts: { torsos: 3 } }),
  anime('A20', '两个上半身 · 左边两对手 · 右边两头两对胸', { counts: { torsos: 2 }, torsoCounts: { L: { armPairs: 2 }, R: { heads: 2, chestPairs: 2 } } }),
  anime('A21', '两个上半身 · 胸 2.2 腰 1.16 胯 1.28', { counts: { torsos: 2 }, shape: { bust: 2.2, waist: 1.16, hips: 1.28 } }),
  white('M01', '默认', {}),
  white('M02', '两对手臂上下排', { armLayout: 'stack', counts: { armPairs: 2 } }),
  white('M03', '两对手臂肩部聚拢', { armLayout: 'fan', counts: { armPairs: 2 } }),
  white('M04', '三个头', { counts: { heads: 3 } }),
  white('M05', '四条腿（人马）', { counts: { legs: 4 } }),
  white('M06', '八条腿（蛛形）', { counts: { legs: 8 } }),
  white('M07', '四条腿横排两副胯', { legLayout: 'abreast', counts: { legs: 4 } }),
  white('M08', '两个上半身', { counts: { torsos: 2 } }),
  white('M09', '三个上半身', { counts: { torsos: 3 } }),
  white('M10', '三条尾巴 · 一对翅膀', { counts: { tails: 3, wingPairs: 1 } }),
  made('C01', '默认', {}),
  made('C02', '两对手臂', { counts: { armPairs: 2 } }),
  made('C03', '三个头', { counts: { heads: 3 } }),
  made('C04', '四条腿（人马）', { counts: { legs: 4 } }),
  made('C05', '八条腿（蛛形）', { counts: { legs: 8 } }),
  made('C06', '四条腿横排两副胯', { legLayout: 'abreast', counts: { legs: 4 } }),
  made('C07', '两个上半身', { counts: { torsos: 2 } }),
  made('C08', '三个上半身', { counts: { torsos: 3 } }),
];

/** 套哪些现成姿势 */
export const PRESETS = ['自然站立', '叉腰', '张开双臂', '朝天举枪', '弯腰拿东西', '蹲着', '坐着', '冲刺', '跳舞', '抡斧头'];
/** 好几个上半身另外再摆的两个：脊柱各转各的（度） */
export const TWISTS: { name: string; bones: Record<string, [number, number, number]> }[] = [
  { name: '两个身子往外歪开', bones: { Spine_L: [15, 10, -18], Chest_L: [10, 8, -6], UpperChest_L: [8, 5, 0], Spine_R: [10, -8, 12] } },
  { name: '两个往同一边扭', bones: { Spine_L: [0, 12, 0], Chest_L: [0, 8, 0], Spine_R: [0, 12, 0], Chest_R: [0, 8, 0], Spine_M: [0, 12, 0], Chest_M: [0, 8, 0] } },
];

export function specOf(c: Case): BodySpec {
  const d = defaultSpec();
  return normalizeSpec({ ...d, bodyStyle: c.style, ...c.spec, counts: { ...d.counts, ...c.spec.counts }, shape: { ...d.shape, ...c.spec.shape } });
}

/** 和工坊里点姿势按钮一样（main.ts 的 fitted）：多出来的腿照左右腿摆、几个上半身的脊柱都照着摆，手臂挑一条摆、别的跟着动，再让开身体 */
export function fittedPosing(spec: BodySpec, solver: ReturnType<typeof makeSolver>, posing: Posing, clear: ((x: number, y: number, z: number) => number) | null, scale: number): Posing {
  const bones = { ...fitLegs(posing, legPlan(spec).form, spec.counts.legs, solver.rig).bones };
  if (spec.counts.torsos > 1) {
    for (const [name, turn] of Object.entries(posing.bones)) {
      const m = /^(Spine|Chest|UpperChest)(\.\d+)?$/.exec(name);
      if (m) for (const side of ['_L', '_R', '_M']) bones[`${m[1]}${side}${m[2] ?? ''}`] = turn;
    }
  }
  const { posing: next, followers } = followArms(solver, fitArms(solver, { ...posing, bones }));
  return clear ? clearArms(solver, next, clear, scale, spec.shape.limbs, followers) : next;
}

/** 量手臂插没插进身体用的场：只算身子、头、腿、胸（main.ts 的 bodyDist） */
export function bodyField(figure: Figure, blend: number) {
  const ROOM = new Set(['torso', 'lower', 'leg', 'neck', 'head', 'chest']);
  const kept = new Set<string>();
  const parts = figure.parts.filter((p) => {
    const keep = ROOM.has(p.type) && (!p.parent || kept.has(p.parent));
    if (keep) kept.add(p.name);
    return keep;
  });
  const field = compileField({ scale: figure.scale, parts }, { blend });
  return (x: number, y: number, z: number) => fieldAt(field, x, y, z);
}

/** 边：只被一个三角面用的（破口）、被三个以上用的（不是流形） */
function edgeCheck(triangles: Uint32Array, vertices: number) {
  const uses = new Map<number, number>();
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = triangles[t + e];
      const b = triangles[t + ((e + 1) % 3)];
      const key = Math.min(a, b) * vertices + Math.max(a, b);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  let nonManifold = 0;
  for (const n of uses.values()) {
    if (n === 1) open++;
    else if (n > 2) nonManifold++;
  }
  return { open, nonManifold };
}

/** 网格分成几块，每块多少个三角面（从大到小） */
export function pieces(triangles: Uint32Array, vertices: number): number[] {
  const parent = Int32Array.from({ length: vertices }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let t = 0; t < triangles.length; t += 3) {
    const a = find(triangles[t]);
    for (let e = 1; e < 3; e++) {
      const b = find(triangles[t + e]);
      if (a !== b) parent[b] = a;
    }
  }
  const count = new Map<number, number>();
  for (let t = 0; t < triangles.length; t += 3) {
    const r = find(triangles[t]);
    count.set(r, (count.get(r) ?? 0) + 1);
  }
  return [...count.values()].sort((a, b) => b - a);
}

/** 蒙皮弯过去以后每条边拉长了几倍：最多的、两倍以上的占多少 */
function stretch(rest: Float32Array, posed: Float32Array, triangles: Uint32Array) {
  let most = 0;
  let over = 0;
  let total = 0;
  const len = (p: Float32Array, a: number, b: number) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = triangles[t + e];
      const b = triangles[t + ((e + 1) % 3)];
      if (a > b) continue;
      const r = len(rest, a, b);
      if (r < 1e-6) continue;
      const k = len(posed, a, b) / r;
      total++;
      if (k > most) most = k;
      if (k > 2) over++;
    }
  }
  return { most: Math.round(most * 100) / 100, over: total ? Math.round((over / total) * 1e5) / 1e3 : 0 };
}

const VIEW_W = 320;
const VIEW_H = 480;
function shot(file: string, pos: Float32Array, triangles: Uint32Array, view: 'front' | 'three') {
  const dir = VIEWS[view] as V3;
  const frame = frameFor(pos, [dir], VIEW_W, VIEW_H, 1.06);
  writeFileSync(file, png(VIEW_W, VIEW_H, render(pos, triangles, dir, frame, VIEW_W, VIEW_H)));
}

/** 一种组合在某个姿势下的样子：posing 是 null 的是静止 */
interface Body {
  rest: { pos: Float32Array; triangles: Uint32Array; vertices: number };
  restRow: Record<string, unknown>;
  pose: (posing: Posing) => { pos: Float32Array; triangles: Uint32Array; vertices: number; path: string; rest?: Float32Array };
}

export function figureBody(spec: BodySpec, voxel: number): Body {
  const figure = buildFigure(spec);
  const unit = figure.scale;
  const t0 = performance.now();
  const { mesh, skin } = runJob({ parts: figure.parts, voxel, blend: spec.blend, skin: true });
  const ms = Math.round(performance.now() - t0);
  const restPos = mesh.positions.map((v) => v * unit);
  const plain = runJob({ parts: figure.parts, voxel, blend: spec.blend }).mesh;
  const skeleton = buildSkeleton(figure);
  const solver = makeSolver(skeleton.bones);
  const clear = bodyField(figure, spec.blend);
  return {
    rest: { pos: plain.positions.map((v) => v * unit), triangles: plain.triangles, vertices: plain.info.vertices },
    restRow: { parts: figure.parts.length, components: plain.info.components, ...edgeCheck(plain.triangles, plain.info.vertices), ms, clashes: findClashes(figure).map((c) => `${c.a}×${c.b} ${(c.depth * 100).toFixed(1)}cm`) },
    pose: (raw) => {
      const posing = fittedPosing(spec, solver, raw, clear, unit);
      const frame = forward(solver.rig, stateOf(solver, posing));
      const exact = poseMatrices(solver.rig, frame, unit);
      if (refusable(figure, exact)) {
        const m = runJob({ parts: figure.parts, voxel, blend: spec.blend, pose: exact }).mesh;
        return { pos: m.positions.map((v) => v * unit), triangles: m.triangles, vertices: m.info.vertices, path: 'refuse' };
      }
      const own = Float64Array.from(poseMatrices(solver.rig, frame));
      for (let o = 9; o < own.length; o += 12) for (let q = 0; q < 3; q++) own[o + q] /= unit;
      const posed = mesh.positions.slice();
      skinInPlace('dual', posed, mesh.normals.slice(), skin!.joints, skin!.weights, own);
      return { pos: posed.map((v) => v * unit), triangles: mesh.triangles, vertices: mesh.info.vertices, path: 'skin', rest: restPos };
    },
  };
}

export function characterBody(spec: BodySpec, root: string): Body {
  const bytes = readFileSync(join(root, 'public', CHARACTER.url));
  const source = readCharacter(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, CHARACTER);
  const t0 = performance.now();
  const build = assembleCharacter(source, spec);
  const ms = Math.round(performance.now() - t0);
  // 几块网格并成一块（只为了出图、量边）
  let vertices = 0;
  let indices = 0;
  for (const c of build.meshes) {
    vertices += c.positions.length / 3;
    indices += c.indices.length;
  }
  const rest = new Float32Array(vertices * 3);
  const triangles = new Uint32Array(indices);
  {
    let v = 0;
    let i = 0;
    for (const c of build.meshes) {
      rest.set(c.positions, v * 3);
      for (let k = 0; k < c.indices.length; k++) triangles[i + k] = c.indices[k] + v;
      v += c.positions.length / 3;
      i += c.indices.length;
    }
  }
  const solver = makeSolver(characterSkeleton(build).bones);
  return {
    rest: { pos: rest, triangles, vertices },
    restRow: { parts: build.meshes.length, components: pieces(triangles, vertices).length, ...edgeCheck(triangles, vertices), ms, clashes: [] },
    pose: (raw) => {
      const posing = fittedPosing(spec, solver, raw, null, 1);
      const matrices = poseMatrices(solver.rig, forward(solver.rig, stateOf(solver, posing)));
      const pos = new Float32Array(vertices * 3);
      let v = 0;
      for (const c of build.meshes) {
        const p = c.positions.slice();
        skinInPlace(CHARACTER_BLEND, p, c.normals.slice(), c.joints, c.weights, matrices);
        pos.set(p, v * 3);
        v += c.positions.length / 3;
      }
      return { pos, triangles, vertices, path: 'skin', rest };
    },
  };
}

export async function main(args: string[], root: string) {
  const dir = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  if (!dir) throw new Error('用法：node tools/run.mjs tools/overview.ts <输出目录> [--shard 0/6] [--only A01,M03] [--poses 0,3]');
  const opt = (key: string) => {
    const i = args.indexOf(key);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const [k, n] = (opt('--shard') ?? '0/1').split('/').map(Number);
  const only = opt('--only')?.split(',');
  const poseFilter = opt('--poses')?.split(',').map(Number);
  const voxel = Number(opt('--voxel') ?? VOXEL.fine);
  mkdirSync(join(dir, 'img'), { recursive: true });
  const bytes = readFileSync(join(root, 'public/anime/body.bin'));
  installAnimeBody(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const base = POSE_LIBRARY.find((p) => p.name === '自然站立')!.posing;
  const out = join(dir, `shard-${k}.jsonl`);
  writeFileSync(out, '');
  const list = CASES.filter((c, i) => i % n === k && (!only || only.includes(c.name)));
  for (const c of list) {
    const spec = specOf(c);
    let body: Body;
    try {
      body = c.style === 'character' ? characterBody(spec, root) : figureBody(spec, voxel);
    } catch (e) {
      appendFileSync(out, `${JSON.stringify({ case: c.name, label: c.label, pose: -1, error: String((e as Error).stack ?? e) })}\n`);
      console.log(`${c.name} 出错：${(e as Error).message}`);
      continue;
    }
    shot(join(dir, 'img', `${c.name}_rest.png`), body.rest.pos, body.rest.triangles, 'front');
    appendFileSync(out, `${JSON.stringify({ case: c.name, label: c.label, pose: -1, name: '静止', ...body.restRow })}\n`);
    const poses: { name: string; posing: Posing }[] = PRESETS.map((name) => ({ name, posing: POSE_LIBRARY.find((p) => p.name === name)!.posing }));
    if (spec.counts.torsos > 1) {
      for (const t of TWISTS) {
        const bones: Posing['bones'] = {};
        for (const [name, e] of Object.entries(t.bones)) bones[name] = quatEuler(e[0] * (Math.PI / 180), e[1] * (Math.PI / 180), e[2] * (Math.PI / 180));
        poses.push({ name: t.name, posing: { ...base, bones } });
      }
    }
    for (let p = 0; p < poses.length; p++) {
      if (poseFilter && !poseFilter.includes(p)) continue;
      const t0 = performance.now();
      try {
        const got = body.pose(poses[p].posing);
        const ms = Math.round(performance.now() - t0);
        const parts = pieces(got.triangles, got.vertices);
        const row: Record<string, unknown> = { case: c.name, label: c.label, pose: p, name: poses[p].name, path: got.path, ms, components: parts.length, small: parts.slice(1, 6) };
        if (got.path === 'refuse') Object.assign(row, edgeCheck(got.triangles, got.vertices));
        if (got.rest) row.stretch = stretch(got.rest, got.pos, got.triangles);
        shot(join(dir, 'img', `${c.name}_p${String(p).padStart(2, '0')}.png`), got.pos, got.triangles, 'three');
        appendFileSync(out, `${JSON.stringify(row)}\n`);
        console.log(`${c.name} ${poses[p].name}: ${got.path} ${ms} ms，${parts.length} 块`);
      } catch (e) {
        appendFileSync(out, `${JSON.stringify({ case: c.name, label: c.label, pose: p, name: poses[p].name, error: String((e as Error).stack ?? e) })}\n`);
        console.log(`${c.name} ${poses[p].name} 出错：${(e as Error).message}`);
      }
    }
  }
}
