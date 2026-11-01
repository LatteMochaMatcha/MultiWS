// 验收台：照几种固定的组合出验收图，并记一份检查结果（见 docs/rework-plan.md 第 1 期）。
//   node tools/run.mjs tools/accept.ts <输出目录> [--only A2,B-ref …] [--against <上一次的输出目录>] [--voxel 0.006]
// 每种组合（二次元素体）出静止的正面、侧面、背面、斜后，再套上「自然站立」出一张正面、一张斜前，存在 <输出目录>/<组合>_<视角>.png；
// summary.json 里是每种组合的部件数、网格是不是一整块、有没有破口、部件之间的穿插、融合耗时。
// 给了 --against 就和那一次的 summary.json 比，把变差的地方列出来。
// 之后用 tools/accept-sheet.py 拼成带标题的总图、和 refs/ 里的参考图并排的对照图。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installAnimeBody } from '../src/anime/body';
import { skinInPlace } from '../src/character/pose';
import { findClashes } from '../src/geometry/clash';
import { type Figure, nthName } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type BodySpec, defaultSpec, normalizeSpec } from '../src/model/spec';
import { clearArms } from '../src/pose/clear';
import { fitArms, followArms } from '../src/pose/fit';
import { POSE_LIBRARY } from '../src/pose/library';
import type { Posing } from '../src/pose/posing';
import { forward, poseMatrices } from '../src/pose/rig';
import { makeSolver, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { compileField, fieldAt } from '../src/sdf/field';
import { VOXEL } from '../src/sdf/fuse';
import { runJob } from '../src/sdf/job';
import { refusable } from '../src/sdf/posedField';
import { type V3, VIEWS, type ViewName, frameFor, png, render } from './softRender';

/** 一种组合：counts 等只写和默认不一样的 */
interface Case {
  name: string;
  /** 总图上的标题 */
  label: string;
  /** 归在哪一组（总图按组拼、和 refs/ 里同字母开头的参考图对照） */
  group: 'A' | 'B' | 'C' | 'D' | 'E';
  spec: Partial<Omit<BodySpec, 'counts' | 'shape'>> & { counts: Partial<BodySpec['counts']> };
  /** 只查不坏，不出姿势那两张 */
  checkOnly?: boolean;
}

/** 两套设定：默认的，和他常用的那套 */
const SETTINGS = {
  def: { label: '默认', shape: {} },
  his: { label: '胸 2.2 · 腰 1.16 · 胯 1.28', shape: { bust: 2.2, waist: 1.16, hips: 1.28 } },
} as const;

const BASES: Case[] = [
  { name: 'A2', group: 'A', label: 'A 两排胸 · 两对手臂（上下排）', spec: { armLayout: 'stack', counts: { chestPairs: 2, armPairs: 2 } } },
  { name: 'A3', group: 'A', label: 'A 三排胸 · 两对手臂（上下排）', spec: { armLayout: 'stack', counts: { chestPairs: 3, armPairs: 2 } } },
  { name: 'A4', group: 'A', label: 'A 四排胸 · 两对手臂（上下排）', spec: { armLayout: 'stack', counts: { chestPairs: 4, armPairs: 2 } } },
  { name: 'B-ref', group: 'B', label: 'B 两个上半身 · 各一头一对手一对胸（参考图那种）', spec: { counts: { torsos: 2 } } },
  { name: 'B-his', group: 'B', label: 'B 两个上半身 · 各两头两对手（肩部聚拢）两对胸', spec: { armLayout: 'fan', counts: { torsos: 2, heads: 2, armPairs: 2, chestPairs: 2 } } },
  { name: 'C', group: 'C', label: 'C 两个上半身 · 横排两副胯', spec: { legLayout: 'abreast', counts: { torsos: 2, legs: 4 } } },
  { name: 'D1', group: 'D', label: 'D 两个头 · 横排两副胯 · 两对手（肩部聚拢）一对胸', spec: { legLayout: 'abreast', armLayout: 'fan', counts: { heads: 2, legs: 4, armPairs: 2 } } },
  { name: 'D2', group: 'D', label: 'D 两个头 · 横排两副胯 · 两对手（肩部聚拢）两对胸', spec: { legLayout: 'abreast', armLayout: 'fan', counts: { heads: 2, legs: 4, armPairs: 2, chestPairs: 2 } } },
  { name: 'E3', group: 'E', label: 'E 三个上半身（只查不坏）', spec: { counts: { torsos: 3 } }, checkOnly: true },
];

/**
 * 出哪几张：full 是全身，close 是只框躯干的特写（脚往上 38% 到 88% 的高度、离中线不到四分之一身高的顶点，出了画面的裁掉）。
 * 静止的全身一张正面、躯干四个方向；摆了姿势的全身正面、躯干斜前
 */
interface Shot {
  view: ViewName;
  close: boolean;
}
const REST_SHOTS: Shot[] = [
  { view: 'front', close: false },
  { view: 'front', close: true },
  { view: 'side', close: true },
  { view: 'back', close: true },
  { view: 'rear', close: true },
];
const POSED_SHOTS: Shot[] = [
  { view: 'front', close: false },
  { view: 'three', close: true },
];
const CHECK_SHOTS: Shot[] = [
  { view: 'front', close: false },
  { view: 'front', close: true },
  { view: 'back', close: true },
];
const POSE_NAME = '自然站立';
const FULL = [420, 640] as const;
const CLOSE = [480, 480] as const;

function specOf(base: Case, setting: keyof typeof SETTINGS): BodySpec {
  const d = defaultSpec();
  return normalizeSpec({
    ...d,
    bodyStyle: 'anime',
    ...base.spec,
    counts: { ...d.counts, ...base.spec.counts },
    shape: { ...d.shape, ...SETTINGS[setting].shape },
  });
}

/**
 * 套现成的姿势，和工坊里点姿势按钮时一样（main.ts 的 fitted）：多出来的腿照左右腿摆、几个上半身的脊柱都照着摆，
 * 肩上挤着的手臂挑一条摆、别的跟着动，再让手臂让开身体
 */
function fittedPosing(spec: BodySpec, figure: Figure, solver: ReturnType<typeof makeSolver>, posing: Posing): Posing {
  let bones = { ...posing.bones };
  const form = figure.metrics.legForm;
  if (form === 'row' || form === 'gather' || form === 'abreast') {
    for (const [name, turn] of Object.entries(posing.bones)) {
      if (!/^(UpperLeg|LowerLeg|Foot|Toes)_[LR]$/.test(name)) continue;
      for (let k = 1; k < Math.ceil(spec.counts.legs / 2); k++) bones[nthName(name, k)] = turn;
    }
  } else if (form === 'taur' || form === 'spider') {
    bones = Object.fromEntries(Object.entries(bones).filter(([name]) => !/^(Hips|UpperLeg|LowerLeg|Foot|Toe)/.test(name)));
  }
  if (spec.counts.torsos > 1) {
    for (const [name, turn] of Object.entries(posing.bones)) {
      const m = /^(Spine|Chest|UpperChest)(\.\d+)?$/.exec(name);
      if (m) for (const side of ['_L', '_R']) bones[`${m[1]}${side}${m[2] ?? ''}`] = turn;
    }
  }
  const own: Posing = { ...posing, bones };
  const { posing: next, followers } = followArms(solver, fitArms(solver, own));
  // 量手臂插没插进身体：只算身子、头、腿、胸（main.ts 的 bodyDist）
  const ROOM = new Set(['torso', 'lower', 'leg', 'neck', 'head', 'chest']);
  const kept = new Set<string>();
  const parts = figure.parts.filter((p) => {
    const keep = ROOM.has(p.type) && (!p.parent || kept.has(p.parent));
    if (keep) kept.add(p.name);
    return keep;
  });
  const field = compileField({ scale: figure.scale, parts }, { blend: spec.blend });
  return clearArms(solver, next, (x, y, z) => fieldAt(field, x, y, z), figure.scale, spec.shape.limbs, followers);
}

/** 网格的边：只被一个三角面用的（破口）、被三个以上用的（不是流形） */
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

const countBy = (figure: Figure) => {
  const out: Record<string, number> = {};
  for (const p of figure.parts) out[p.type] = (out[p.type] ?? 0) + 1;
  return out;
};

/** 出图：同一组里全身的几张共用一个取景，特写的几张共用一个取景。文件名 <组合>_<视角>（特写加 -close） */
function shoot(dir: string, name: string, pos: Float32Array, triangles: Uint32Array, shots: Shot[]) {
  let lo = Infinity;
  let hi = -Infinity;
  let cx = 0;
  for (let i = 0; i < pos.length; i += 3) {
    lo = Math.min(lo, pos[i + 1]);
    hi = Math.max(hi, pos[i + 1]);
    cx += pos[i];
  }
  cx /= pos.length / 3;
  const tall = hi - lo;
  const torso = (x: number, y: number) => y > lo + 0.38 * tall && y < lo + 0.88 * tall && Math.abs(x - cx) < 0.25 * tall;
  for (const close of [false, true]) {
    const mine = shots.filter((s) => s.close === close);
    if (!mine.length) continue;
    const [w, h] = close ? CLOSE : FULL;
    const frame = frameFor(pos, mine.map((s) => VIEWS[s.view] as V3), w, h, 1.06, close ? torso : undefined);
    for (const s of mine) writeFileSync(join(dir, `${name}_${s.view}${close ? '-close' : ''}.png`), png(w, h, render(pos, triangles, VIEWS[s.view] as V3, frame, w, h)));
  }
}

export async function main(args: string[], root: string) {
  const dir = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);
  if (!dir) throw new Error('用法：node tools/run.mjs tools/accept.ts <输出目录> [--only A2,B-ref] [--against <目录>] [--voxel 0.006]');
  const opt = (key: string) => {
    const i = args.indexOf(key);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const only = opt('--only')?.split(',');
  const against = opt('--against');
  const voxel = Number(opt('--voxel') ?? VOXEL.fine);
  mkdirSync(dir, { recursive: true });
  const bytes = readFileSync(join(root, 'public/anime/body.bin'));
  installAnimeBody(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const preset = POSE_LIBRARY.find((p) => p.name === POSE_NAME);
  if (!preset) throw new Error(`姿势库里没有「${POSE_NAME}」`);

  const summary: Record<string, unknown>[] = [];
  for (const base of BASES) {
    for (const setting of Object.keys(SETTINGS) as (keyof typeof SETTINGS)[]) {
      if (base.checkOnly && setting !== 'def') continue;
      const name = `${base.name}_${setting}`;
      if (only && !only.includes(base.name) && !only.includes(name)) continue;
      const spec = specOf(base, setting);
      const figure = buildFigure(spec);
      const unit = figure.scale;
      const t0 = performance.now();
      const rest = runJob({ parts: figure.parts, voxel, blend: spec.blend }).mesh;
      const restMs = performance.now() - t0;
      const restPos = rest.positions.map((v) => v * unit);
      shoot(dir, name, restPos, rest.triangles, base.checkOnly ? CHECK_SHOTS : REST_SHOTS);
      const edges = edgeCheck(rest.triangles, rest.info.vertices);
      const clashes = findClashes(figure);
      const row: Record<string, unknown> = {
        name,
        label: base.label,
        group: base.group,
        setting: SETTINGS[setting].label,
        parts: countBy(figure),
        rest: { triangles: rest.info.triangles, components: rest.info.components, ...edges, ms: Math.round(restMs) },
        clashes: clashes.map((c) => `${c.a}×${c.b} ${(c.depth * 100).toFixed(1)}cm`),
      };
      if (!base.checkOnly) {
        // 套「自然站立」：肩上挤着几条手臂的照姿势重新融合，别的照权重把静止的网格弯过去（和工坊里看到的一样）
        const skeleton = buildSkeleton(figure);
        const solver = makeSolver(skeleton.bones);
        const posing = fittedPosing(spec, figure, solver, preset.posing);
        const frame = forward(solver.rig, stateOf(solver, posing));
        const exact = poseMatrices(solver.rig, frame, unit);
        const t1 = performance.now();
        let posed: Float32Array;
        let triangles: Uint32Array;
        const refused = refusable(figure, exact);
        if (refused) {
          const mesh = runJob({ parts: figure.parts, voxel, blend: spec.blend, pose: exact }).mesh;
          posed = mesh.positions.map((v) => v * unit);
          triangles = mesh.triangles;
        } else {
          const { mesh, skin } = runJob({ parts: figure.parts, voxel, blend: spec.blend, skin: true });
          const own = Float64Array.from(poseMatrices(solver.rig, frame));
          for (let o = 9; o < own.length; o += 12) for (let q = 0; q < 3; q++) own[o + q] /= unit;
          posed = mesh.positions.slice();
          skinInPlace('dual', posed, mesh.normals.slice(), skin!.joints, skin!.weights, own);
          posed = posed.map((v) => v * unit);
          triangles = mesh.triangles;
        }
        row.posed = { pose: POSE_NAME, refused, ms: Math.round(performance.now() - t1) };
        shoot(dir, `${name}_posed`, posed, triangles, POSED_SHOTS);
      }
      summary.push(row);
      const r = row.rest as { components: number; open: number; nonManifold: number; ms: number };
      console.log(`${name}: ${r.ms} ms，${r.components} 块，破口边 ${r.open}，非流形边 ${r.nonManifold}，穿插 ${clashes.length} 处`);
    }
  }
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ voxel, at: new Date().toISOString(), cases: summary }, null, 2));
  if (against) compare(summary, against);
}

/** 和上一次比：部件少了、网格碎了、破口多了、穿插多了、慢了一半以上的，列出来 */
function compare(now: Record<string, unknown>[], dir: string) {
  const file = join(dir, 'summary.json');
  if (!existsSync(file)) {
    console.log(`没有 ${file}，不比`);
    return;
  }
  const before = new Map((JSON.parse(readFileSync(file, 'utf8')).cases as Record<string, unknown>[]).map((c) => [c.name as string, c]));
  const worse: string[] = [];
  for (const c of now) {
    const b = before.get(c.name as string) as typeof c | undefined;
    if (!b) continue;
    const pn = c.parts as Record<string, number>;
    const pb = b.parts as Record<string, number>;
    for (const type of new Set([...Object.keys(pn), ...Object.keys(pb)])) {
      if ((pn[type] ?? 0) < (pb[type] ?? 0)) worse.push(`${c.name}：${type} 部件 ${pb[type]} → ${pn[type] ?? 0}`);
    }
    const rn = c.rest as Record<string, number>;
    const rb = b.rest as Record<string, number>;
    if (rn.components > rb.components) worse.push(`${c.name}：网格 ${rb.components} 块 → ${rn.components} 块`);
    if (rn.open > rb.open) worse.push(`${c.name}：破口边 ${rb.open} → ${rn.open}`);
    if (rn.nonManifold > rb.nonManifold) worse.push(`${c.name}：非流形边 ${rb.nonManifold} → ${rn.nonManifold}`);
    if (rn.ms > rb.ms * 1.5) worse.push(`${c.name}：融合 ${rb.ms} ms → ${rn.ms} ms`);
    const cn = (c.clashes as string[]).length;
    const cb = (b.clashes as string[]).length;
    if (cn > cb) worse.push(`${c.name}：穿插 ${cb} → ${cn} 处`);
  }
  console.log(worse.length ? `比 ${dir} 变差的：\n  ${worse.join('\n  ')}` : `和 ${dir} 比没有变差的`);
}
