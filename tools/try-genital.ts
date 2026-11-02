// 阴茎、阴囊的验收图（docs/genital-plan.md）：照设定在白模人台（或二次元素体）上拼出来，融合、出图、记检查结果。
//   node tools/run.mjs tools/try-genital.ts <输出目录> [--only sizes,layouts] [--style mannequin|anime] [--voxel 0.006] [--obj]
// sizes：一根，「阴茎大小」0.6 / 0.8 / 1 / 1.2；layouts：三种排法 × 两种阴囊 × 2–4 根。
// 每种出正面、斜前（sizes 再加侧面），存在 <输出目录>/<组>-<名字>_<视角>.png；summary.json 里是网格几块、穿模、融合耗时。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installAnimeBody } from '../src/anime/body';
import { installGenital } from '../src/anime/genital';
import { findClashes } from '../src/geometry/clash';
import { buildFigure } from '../src/geometry/layout';
import { type BodySpec, type LegLayout, PENIS_LAYOUTS, SCROTUM_MODES, defaultSpec, normalizeSpec } from '../src/model/spec';
import { runJob } from '../src/sdf/job';
import { type V3, frameFor, png, render } from './softRender';

const VIEWS: Record<string, V3> = {
  front: [0, 0, 1],
  three: [0.6, 0.15, 0.78].map((v, _, a) => v / Math.hypot(...a)) as V3,
  side: [1, 0, 0],
};

interface Case {
  group: string;
  name: string;
  spec: Partial<Omit<BodySpec, 'counts' | 'shape'>> & { counts?: Partial<BodySpec['counts']>; shape?: Partial<BodySpec['shape']> };
  views: string[];
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const size of [0.6, 0.8, 1, 1.2]) out.push({ group: 'sizes', name: `size${size}`, spec: { counts: { penises: 1 }, shape: { penisSize: size } }, views: ['front', 'three', 'side'] });
  for (const layout of PENIS_LAYOUTS)
    for (const scrotum of SCROTUM_MODES)
      for (const n of [2, 3, 4]) out.push({ group: 'layouts', name: `${layout}-${scrotum}-${n}`, spec: { penisLayout: layout, scrotum, counts: { penises: n } }, views: ['front', 'three'] });
  // 几副胯各一套：每种排法两种腿数，每副胯一根、两根
  const forms: [LegLayout, number[]][] = [
    ['abreast', [4, 6]],
    ['tandem', [4, 6]],
    ['gather', [4, 6]],
    ['humantaur', [4, 6]],
    ['taur', [4, 6]],
    ['spider', [6, 8]],
  ];
  for (const [legLayout, legs] of forms)
    for (const n of legs)
      for (const penises of [1, 2]) out.push({ group: 'hips', name: `${legLayout}-${n}-${penises}`, spec: { legLayout, counts: { legs: n, penises } }, views: ['three', 'side'] });
  // 二次元素体特有的几种（见 docs/rework-plan.md）：两个上半身、并成宽躯干，和他常用的体型
  const his = { bust: 2.2, waist: 1.16, hips: 1.28 };
  out.push(
    { group: 'special', name: 'B-two-torsos', spec: { counts: { torsos: 2, penises: 1 } }, views: ['front', 'three', 'side'] },
    { group: 'special', name: 'C-two-torsos-two-hips', spec: { legLayout: 'abreast', counts: { torsos: 2, legs: 4, penises: 1 } }, views: ['front', 'three', 'side'] },
    { group: 'special', name: 'D-wide', spec: { legLayout: 'abreast', headLayout: 'wide', counts: { heads: 2, legs: 4, penises: 1 } }, views: ['front', 'three', 'side'] },
    { group: 'special', name: 'his-1', spec: { counts: { penises: 1 }, shape: his }, views: ['front', 'three', 'side'] },
    { group: 'special', name: 'his-row-3', spec: { counts: { penises: 3 }, shape: his }, views: ['front', 'three', 'side'] },
  );
  return out;
}

export async function main(args: string[], root: string) {
  const dir = args[0];
  const opt = (key: string) => {
    const i = args.indexOf(key);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const only = opt('--only')?.split(',');
  const style = (opt('--style') ?? 'mannequin') as BodySpec['bodyStyle'];
  const voxel = Number(opt('--voxel') ?? 0.006);
  mkdirSync(dir, { recursive: true });
  const genital = readFileSync(join(root, 'public/genital.bin'));
  installGenital(genital.buffer.slice(genital.byteOffset, genital.byteOffset + genital.byteLength) as ArrayBuffer);
  if (style === 'anime') {
    const body = readFileSync(join(root, 'public/anime/body.bin'));
    installAnimeBody(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
  }

  const summary: Record<string, unknown>[] = [];
  for (const c of cases()) {
    if (only && !only.includes(c.group)) continue;
    const base = defaultSpec();
    const spec = normalizeSpec({ ...base, ...c.spec, bodyStyle: style, counts: { ...base.counts, ...c.spec.counts }, shape: { ...base.shape, ...c.spec.shape } });
    const figure = buildFigure(spec);
    const genitals = figure.parts.filter((p) => p.type === 'genital');
    const t0 = Date.now();
    const { mesh } = runJob({ parts: figure.parts, voxel, blend: spec.blend });
    const ms = Date.now() - t0;
    const clashes = findClashes(figure).filter((k) => [k.a, k.b].some((name) => genitals.some((g) => g.name === name)));
    const pos = mesh.positions;
    const tris: number[] = [];
    for (let q = 0; q < mesh.quads.length; q += 4) tris.push(mesh.quads[q], mesh.quads[q + 1], mesh.quads[q + 2], mesh.quads[q], mesh.quads[q + 2], mesh.quads[q + 3]);
    if (mesh.tris) tris.push(...mesh.tris);
    const triangles = Uint32Array.from(tris);
    // 特写：阴茎、阴囊周围
    const ys = genitals.map((g) => g.pos[1]);
    const lo = Math.min(...ys) - 0.12;
    const hi = Math.max(...ys) + 0.14;
    const xs = genitals.map((g) => g.pos[0]);
    const near = (x: number, y: number) => y > lo && y < hi && x > Math.min(...xs) - 0.2 && x < Math.max(...xs) + 0.2;
    const tag = `${c.group}-${c.name}`;
    const frame = frameFor(pos, c.views.map((v) => VIEWS[v]), 600, 600, 1.04, near);
    for (const v of c.views) writeFileSync(join(dir, `${tag}_${v}.png`), png(600, 600, render(pos, triangles, VIEWS[v], frame, 600, 600)));
    if (args.includes('--obj')) {
      const lines: string[] = [];
      for (let i = 0; i < pos.length; i += 3) lines.push(`v ${pos[i]} ${pos[i + 1]} ${pos[i + 2]}`);
      for (let t = 0; t < triangles.length; t += 3) lines.push(`f ${triangles[t] + 1} ${triangles[t + 1] + 1} ${triangles[t + 2] + 1}`);
      writeFileSync(join(dir, `${tag}.obj`), `${lines.join('\n')}\n`);
    }
    const one = { case: tag, parts: genitals.length, components: mesh.info.components, cavities: mesh.info.cavities, vertices: mesh.info.vertices, ms, clashes: clashes.map((k) => `${k.a}×${k.b}`) };
    summary.push(one);
    console.log(`${tag}：${one.components} 块，${genitals.length} 个部件，${ms} 毫秒${one.clashes.length ? `，穿模 ${one.clashes.join(' ')}` : ''}`);
  }
  writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
}
