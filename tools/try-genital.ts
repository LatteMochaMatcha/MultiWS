// 离线试接阴茎、阴囊（docs/genital-plan.md 第 1 期）：不进设定、不进界面，直接在白模人台（或二次元素体）上加两个部件，
// 按几种体素融合出图，看缝口、龟头、阴囊和大腿：
//   node tools/run.mjs tools/try-genital.ts <输出目录> [--size 0.8] [--style mannequin|anime] [--voxel 0.006,0.012]
// 出 <输出目录>/<样式>-<体素毫米>_<视角>.png，加一份 summary.json（网格几块、有没有破口、缝没缝上）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installAnimeBody } from '../src/anime/body';
import { PENIS_BASE, PENIS_BASE_DIR, PENIS_CUT, PENIS_CUT_DIR, PENIS_RIM, SCROTUM_GRID, SCROTUM_ROOT, installGenital, penisBones } from '../src/anime/genital';
import type { Part } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type V3, Q_ID, add, mul, sub } from '../src/geometry/vec';
import { type BodySpec, defaultSpec, normalizeSpec } from '../src/model/spec';
import { castRay, compileField } from '../src/sdf/field';
import { runJob } from '../src/sdf/job';
import { frameFor, png, render } from './softRender';

/** 素体身高（米）、根部那么高时小腹正中的表面往前到哪（z）：阴茎根部离小腹多远照这个搬 */
const DJP_HEIGHT = 1.485;
const DJP_PUBIS_Z = 0.088;
/** 伸出来的那截圆柱：从根部往身体里多深、过了切口再多长 */
const STUB_IN = 0.06;
const STUB_OUT = 0.015;
/** 阴茎根部那截圆柱和阴囊之间圆滑过渡的半径（素体的单位） */
const SOFT = 0.02;

const VIEWS: Record<string, V3> = {
  front: [0, 0, 1],
  side: [1, 0, 0],
  three: [0.6, 0.15, 0.78].map((v, _, a) => v / Math.hypot(...a)) as V3,
  below: [0.25, -0.6, 0.76].map((v, _, a) => v / Math.hypot(...a)) as V3,
};

export async function main(args: string[], root: string) {
  const dir = args[0];
  const opt = (key: string) => {
    const i = args.indexOf(key);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const size = Number(opt('--size') ?? 0.8);
  // 阴囊往前、往上挪多少（米）：人台的胯比素体短得多，两条大腿在胯下贴得很近，阴囊放不进两腿中间，要搁在大腿前面
  const sacForward = Number(opt('--sac-forward') ?? 0.02);
  const sacUp = Number(opt('--sac-up') ?? 0.012);
  const style = (opt('--style') ?? 'mannequin') as BodySpec['bodyStyle'];
  const voxels = (opt('--voxel') ?? '0.006,0.012').split(',').map(Number);
  mkdirSync(dir, { recursive: true });
  const genital = readFileSync(join(root, 'public/genital.bin'));
  installGenital(genital.buffer.slice(genital.byteOffset, genital.byteOffset + genital.byteLength) as ArrayBuffer);
  if (style === 'anime') {
    const body = readFileSync(join(root, 'public/anime/body.bin'));
    installAnimeBody(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
  }

  const spec = normalizeSpec({ ...defaultSpec(), bodyStyle: style });
  const figure = buildFigure(spec);
  const field = compileField({ scale: 1, parts: figure.parts }, { blend: spec.blend });
  // 身高：从头顶上方往下打一条射线；脚底按 0 算
  const top = 2.5 - castRay(field, [0, 2.5, 0], [0, -1, 0], 2.5);
  const s = (top / DJP_HEIGHT) * size;
  // 根部那么高的地方，小腹正中的表面
  const y = (PENIS_BASE[1] / DJP_HEIGHT) * top;
  const z = 0.5 - castRay(field, [0, y, 0.5], [0, 0, -1], 0.6);
  const pubis: V3 = [0, y, z];
  const at = (p: V3): V3 => add(pubis, mul(sub(p, [0, PENIS_BASE[1], DJP_PUBIS_Z]), s));
  console.log(`${style}：身高 ${top.toFixed(3)}，缩放 ${s.toFixed(3)}，小腹 (${pubis.map((v) => v.toFixed(3)).join(', ')})`);

  const tip = sub(add(PENIS_CUT, mul(PENIS_CUT_DIR, STUB_OUT)), PENIS_BASE);
  const penis: Part = {
    name: 'Penis_01',
    type: 'genital',
    side: 0,
    pos: at(PENIS_BASE),
    quat: Q_ID,
    scale: s,
    material: 'clay',
    prims: [{ kind: 'cone', name: 'PenisRoot', a: mul(PENIS_BASE_DIR, -STUB_IN), b: tip, ra: PENIS_RIM * 0.85, rb: PENIS_RIM, soft: SOFT }],
    grafts: [
      {
        mesh: 'penis',
        matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        offset: mul(PENIS_BASE, -1),
        bones: penisBones((b) => `${b}_01`),
        pivot: PENIS_CUT,
        reach: sub(PENIS_CUT, PENIS_BASE),
        rigid: [],
      },
    ],
  };
  const scrotum: Part = {
    name: 'Scrotum_01',
    type: 'genital',
    side: 0,
    pos: add(at(SCROTUM_ROOT), [0, sacUp, sacForward]),
    quat: Q_ID,
    scale: s,
    material: 'clay',
    prims: [{ kind: 'grid', name: 'Scrotum', grid: SCROTUM_GRID, soft: SOFT }],
  };
  const parts = [...figure.parts, penis, scrotum];

  const summary: Record<string, unknown> = { style, size, scale: s, pubis };
  for (const voxel of voxels) {
    const t0 = Date.now();
    const report = { loose: [] as number[] };
    const { mesh } = runJob({ parts, voxel, blend: spec.blend });
    const ms = Date.now() - t0;
    const pos = mesh.positions;
    const tris: number[] = [];
    for (let q = 0; q < mesh.quads.length; q += 4) tris.push(mesh.quads[q], mesh.quads[q + 1], mesh.quads[q + 2], mesh.quads[q], mesh.quads[q + 2], mesh.quads[q + 3]);
    if (mesh.tris) tris.push(...mesh.tris);
    const triangles = Uint32Array.from(tris);
    // 特写：根部周围 ±0.2 身高
    const near = (x: number, yy: number) => Math.abs(yy - y) < 0.12 * top && Math.abs(x) < 0.12 * top;
    const frame = frameFor(pos, Object.values(VIEWS), 700, 700, 1.04, near);
    const tag = `${style}-${Math.round(voxel * 1000)}mm`;
    for (const [view, d] of Object.entries(VIEWS)) writeFileSync(join(dir, `${tag}_${view}.png`), png(700, 700, render(pos, triangles, d, frame, 700, 700)));
    summary[tag] = { ...mesh.info, ms, loose: report.loose };
    if (args.includes('--obj')) {
      const lines: string[] = [];
      for (let i = 0; i < pos.length; i += 3) lines.push(`v ${pos[i]} ${pos[i + 1]} ${pos[i + 2]}`);
      for (let i = 0; i < mesh.normals.length; i += 3) lines.push(`vn ${mesh.normals[i]} ${mesh.normals[i + 1]} ${mesh.normals[i + 2]}`);
      for (let t = 0; t < triangles.length; t += 3) lines.push(`f ${triangles[t] + 1}//${triangles[t] + 1} ${triangles[t + 1] + 1}//${triangles[t + 1] + 1} ${triangles[t + 2] + 1}//${triangles[t + 2] + 1}`);
      writeFileSync(join(dir, `${tag}.obj`), `${lines.join('\n')}\n`);
    }
    console.log(`${tag}：${mesh.info.vertices} 个顶点，${mesh.info.components} 块，${ms} 毫秒`);
  }
  writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
}
