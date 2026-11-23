// 楚云萱用体块拼（docs/chu-blocks-plan.md）试做的出图：正面、侧面、背面、斜前、俯视一张，存到 .harness-tmp/chu/<名字>.png。
// 用法：node tools/run.mjs tools/try-chu.ts [--voxel 0.01] [--name v1] [--pose 序号 [--skin]] [--poses]
// （--skin：不重新融合，照权重弯，页面上拖着的时候看到的样子）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installAnimeBody } from '../src/anime/body';
import { installChuTorso } from '../src/anime/chuTorso';
import { worldTransforms } from '../src/geometry/figure';
import { buildPartGeometry } from '../src/geometry/partsMesh';
import { rotate } from '../src/geometry/vec';
import { buildFigure } from '../src/geometry/layout';
import { addBlock, isBlockRoot, removeBlockAt } from '../src/model/blocks';
import { CHU, chuBlocks, chuRefit, chuSpec } from '../src/model/chu';
import { hidePart, setOverride } from '../src/model/overrides';
import { PRESETS, applyPreset } from '../src/model/presets';
import { POSE_LIBRARY } from '../src/pose/library';
import { type BodySpec, defaultSpec, normalizeSpec, parseSpecJson } from '../src/model/spec';
import { buildSkeleton } from '../src/rig/skeleton';
import { figureBody } from './overview';
import { type V3, frameFor, png, render } from './softRender';

const unit = (v: V3): V3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** 页面上删一个部件做的事（main.ts 的 btnTweakDelete）：手工加的那一块真的拿掉，别的记成「已删除」 */
const drop = (spec: BodySpec, name: string): BodySpec => (isBlockRoot(spec, name) ? removeBlockAt(spec, buildFigure(spec), name) : hidePart(spec, name));
/** 在原来的微调上再挪、再转（度）、再放大 */
const nudge = (spec: BodySpec, name: string, by: { position?: V3; rotation?: V3; scale?: number }): BodySpec => {
  const was = spec.overrides[name] ?? {};
  const sum = (a: readonly number[] | undefined, b: V3 | undefined, zero: number): V3 | undefined => (b ? [(a?.[0] ?? zero) + b[0], (a?.[1] ?? zero) + b[1], (a?.[2] ?? zero) + b[2]] : (a as V3 | undefined));
  const scale = by.scale ? ((was.scale ?? [1, 1, 1]).map((v) => v * by.scale!) as V3) : was.scale;
  return setOverride(spec, name, { position: sum(was.position, by.position, 0), rotation: sum(was.rotation, by.rotation, 0), ...(scale && { scale }) });
};
const EDITS: Record<string, (spec: BodySpec) => BodySpec> = {
  // 前面正中上排的一只胸：往前挪 6 厘米、放大两成
  'move-breast': (s) => nudge(s, 'Chest_1901_C', { position: [0, 0, 0.06], scale: 1.2 }),
  // 前排右边那个胸腔（带头、三条手臂、几只胸）：再往外转 25 度
  'turn-rib': (s) => nudge(s, 'UpperBody_1001', { rotation: [0, 25, 0] }),
  // 前排正中那个头：歪 20 度
  'turn-head': (s) => nudge(s, 'Head_901', { rotation: [0, 0, 20] }),
  // 前排右边那副胯（连腿、连上面的胸腔）：往外挪 10 厘米
  'move-pelvis': (s) => nudge(s, 'Torso_201', { position: [0.1, 0, 0] }),
  // 一条手臂：往下转 30 度
  'turn-arm': (s) => nudge(s, 'Arm_1001_L', { rotation: [0, 0, -30] }),
  // 一条腿：往外转 15 度
  'turn-leg': (s) => nudge(s, 'Leg_201_L', { rotation: [0, 0, 15] }),
  'del-breast': (s) => drop(s, 'Chest_2501_C'),
  'del-head': (s) => drop(s, 'Head_1001'),
  'del-arm': (s) => drop(s, 'Arm_1002_L'),
  'del-leg': (s) => drop(s, 'Leg_201_L'),
  // 前排正中的胸腔（上面挂着头和十来只胸）
  'del-rib': (s) => drop(s, 'UpperBody_901'),
  // 前排右边那副胯（上面接着一个胸腔）
  'del-pelvis': (s) => drop(s, 'Torso_201'),
  // 中间一排左边那个光的胸腔
  'del-mid': (s) => drop(s, 'UpperBody_1301'),
  // 套完预设以后再拖体型滑块、改部件数量（体块不重新排，看会乱成什么样）
  ...Object.fromEntries(
    (
      [
        ['bust', 2], ['bust', 3.4], ['thighs', 1], ['thighs', 1.8], ['hips', 0.8], ['hips', 1.4], ['waist', 1.3], ['build', 1.3], ['build', 0.8],
        ['shoulders', 1.3], ['limbs', 1.3], ['legLength', 1.3], ['armLength', 1.4], ['height', 1.9], ['headRatio', 6],
      ] as const
    ).flatMap(([k, v]) => [
      [`${k}-${v}`, (s: BodySpec): BodySpec => ({ ...s, shape: { ...s.shape, [k]: v } })],
      // r-：页面上拖滑块做的事——体块没手动动过就照新的体型重新摆
      [`r-${k}-${v}`, (s: BodySpec): BodySpec => chuRefit(s, { ...s, shape: { ...s.shape, [k]: v } })],
    ]),
  ),
  ...Object.fromEntries(
    ([['heads', 2], ['armPairs', 4], ['armPairs', 2], ['armPairs', 1], ['armPairs', 6], ['breasts', 2], ['breasts', 0], ['legs', 4], ['legs', 1], ['tails', 1], ['wingPairs', 1]] as const).flatMap(([k, v]) => [
      [`n-${k}-${v}`, (s: BodySpec): BodySpec => normalizeSpec({ ...s, counts: { ...s.counts, [k]: v } })],
      [`rn-${k}-${v}`, (s: BodySpec): BodySpec => chuRefit(s, { ...s, counts: { ...s.counts, [k]: v } })],
    ]),
  ),
  // 再复制一只胸、一条手臂
  'copy-breast': (s) => addBlock(s, [{ from: 'Chest_2501_C', shift: [0, -0.25, 0] }]).spec,
  'copy-arm': (s) => addBlock(s, [{ from: 'Arm_1003_L', shift: [0, -0.11, 0] }]).spec,
};

export async function main(args: string[], root: string) {
  const opt = (key: string) => {
    const i = args.indexOf(key);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const voxel = Number(opt('--voxel') ?? 0.01);
  const W = Number(opt('--w') ?? 460);
  const H = Number(opt('--h') ?? 620);
  const dirs: V3[] = (opt('--dirs') ? (JSON.parse(opt('--dirs')!) as V3[]) : ([[0, 0, 1], [1, 0, 0.0001], [0, 0, -1], [0.6, 0.25, 0.75], [0, 1, 0.02]] as V3[])).map(unit);
  const dir = join(root, '.harness-tmp', 'chu');
  mkdirSync(dir, { recursive: true });
  const bytes = readFileSync(join(root, 'public/anime/body.bin'));
  installAnimeBody(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  // 「楚云萱躯干」（上半身换成一整块，见 src/geometry/trunk.ts）；--notrunk 不装，照九个胸腔各是各的拼
  if (!args.includes('--notrunk')) {
    const trunk = readFileSync(join(root, 'public/anime/chu-torso.bin'));
    installChuTorso(trunk.buffer.slice(trunk.byteOffset, trunk.byteOffset + trunk.byteLength) as ArrayBuffer);
  }
  // --chu：临时改 CHU 里的数（试摆位用）
  if (opt('--chu')) Object.assign(CHU as Record<string, unknown>, JSON.parse(opt('--chu')!));
  const bodyStyle = (opt('--style') ?? 'anime') as BodySpec['bodyStyle'];
  const d = normalizeSpec({ ...defaultSpec(), bodyStyle, ...(opt('--ovr') ? JSON.parse(opt('--ovr')!) : {}) });
  // --old：旧的前后排预设；--bust / --hips / --thighs：在楚云萱的体型上再改
  const shape = Object.fromEntries((['bust', 'hips', 'thighs'] as const).flatMap((k) => (opt(`--${k}`) !== undefined ? [[k, Number(opt(`--${k}`))]] : [])));
  let spec: BodySpec = args.includes('--old')
    ? applyPreset(d, { ...PRESETS.find((q) => q.ring === 'rows')!, build: undefined })
    : Object.keys(shape).length
      ? chuBlocks({ ...chuSpec(d), blocks: undefined, overrides: {}, shape: { ...chuSpec(d).shape, ...shape } })
      : chuSpec(d);
  // --edit：套完预设以后照页面上「手动微调」的做法动一下（挪、转、放大、删、复制），几样用逗号隔开
  for (const key of (opt('--edit') ?? '').split(',').filter(Boolean)) spec = EDITS[key](spec);
  // --file：不套预设，读一份工坊里存出来的 json（别人调过的楚云萱）
  if (opt('--file')) spec = parseSpecJson(readFileSync(opt('--file')!, 'utf8'));
  let figure = buildFigure(spec);
  // --nochest：不要胸，看底下的身体
  if (args.includes('--nochest')) {
    for (const part of figure.parts) if (part.type === 'chest') spec.overrides[part.name] = { ...spec.overrides[part.name], hidden: true };
    figure = buildFigure(spec);
  }
  if (args.includes('--parts')) {
    const xfs = worldTransforms({ parts: figure.parts, scale: 1 });
    for (const p of figure.parts) if (!/Finger|Toe|Eye|Ear/.test(p.name)) console.log(p.name, p.type, 'parent', p.parent ?? '-', xfs.get(p.name)!.pos.map((v) => v.toFixed(3)).join(','));
  }
  // --parts-mode：分部件（关掉融合）的样子，每个部件单独一块网格，和页面上「分部件」一样摆（view/partsModel.ts）
  if (args.includes('--parts-mode')) {
    const xfs = worldTransforms(figure);
    const chunks: { pos: Float32Array; tri: Uint32Array }[] = [];
    const t0 = performance.now();
    for (const part of figure.parts) {
      const geo = buildPartGeometry(part);
      const xf = xfs.get(part.name)!;
      const src = geo.attributes.position.array as Float32Array;
      const pos = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        const v = rotate(xf.quat, [src[i] * xf.scale, src[i + 1] * xf.scale, src[i + 2] * xf.scale]);
        pos[i] = v[0] + xf.pos[0];
        pos[i + 1] = v[1] + xf.pos[1];
        pos[i + 2] = v[2] + xf.pos[2];
      }
      const count = src.length / 3;
      const tri = geo.index ? Uint32Array.from(geo.index.array) : Uint32Array.from({ length: count }, (_, i) => i);
      chunks.push({ pos, tri });
    }
    const ms = Math.round(performance.now() - t0);
    const total = chunks.reduce((n, c) => n + c.pos.length, 0);
    const pos = new Float32Array(total);
    const tri = new Uint32Array(chunks.reduce((n, c) => n + c.tri.length, 0));
    let v = 0;
    let k = 0;
    for (const c of chunks) {
      pos.set(c.pos, v * 3);
      for (let i = 0; i < c.tri.length; i++) tri[k + i] = c.tri[i] + v;
      v += c.pos.length / 3;
      k += c.tri.length;
    }
    const frame = frameFor(pos, dirs, W, H, 1.04);
    const sheet = new Uint8Array(W * dirs.length * H * 3);
    dirs.forEach((d, c) => {
      const img = render(pos, tri, d, frame, W, H);
      for (let y = 0; y < H; y++) sheet.set(img.subarray(y * W * 3, (y + 1) * W * 3), (y * W * dirs.length + c * W) * 3);
    });
    const file = join(dir, `${opt('--name') ?? 'chu-parts'}.png`);
    writeFileSync(file, png(W * dirs.length, H, sheet));
    console.log(file, '分部件', figure.parts.length, '块', tri.length / 3, '三角面', ms, 'ms');
    return;
  }
  const body = figureBody(spec, voxel);
  if (args.includes('--poses')) console.log(POSE_LIBRARY.map((q, i) => `${i}:${q.name}`).join(' '));
  const posed = opt('--pose') !== undefined ? body.pose(POSE_LIBRARY[Number(opt('--pose'))].posing, args.includes('--skin')) : null;
  if (posed) console.log('姿势', POSE_LIBRARY[Number(opt('--pose'))].name, '走的是', posed.path);
  const pos = posed ? posed.pos : body.rest.pos;
  const triangles = posed ? posed.triangles : body.rest.triangles;
  const lo = Number(opt('--lo') ?? 0);
  const hi = Number(opt('--hi') ?? 0);
  const xlo = Number(opt('--xlo') ?? 0);
  const xhi = Number(opt('--xhi') ?? 0);
  const frame = frameFor(pos, dirs, W, H, 1.04, hi > lo ? (x: number, y: number) => y > lo && y < hi && (xhi > xlo ? x > xlo && x < xhi : true) : undefined);
  const sheet = new Uint8Array(W * dirs.length * H * 3);
  dirs.forEach((d, c) => {
    const img = render(pos, triangles, d, frame, W, H);
    for (let y = 0; y < H; y++) sheet.set(img.subarray(y * W * 3, (y + 1) * W * 3), (y * W * dirs.length + c * W) * 3);
  });
  if (args.includes('--measure')) {
    // 量前后多厚：正中那一列（|x| < 8 厘米）在髋关节上下几个高度上，最前、最后的点隔多远（米，照设定的身高）
    const unit = figure.scale;
    const hipY = Math.max(...figure.parts.filter((p) => p.type === 'leg' && p.parent === undefined).map((p) => p.pos[1])) * unit;
    const top = pos.reduce((m, v, i) => (i % 3 === 1 ? Math.max(m, v) : m), 0);
    const rows: string[] = [];
    for (const k of [0.6, 0.75, 0.9, 1, 1.08, 1.16, 1.3, 1.5]) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < pos.length; i += 3) {
        if (Math.abs(pos[i]) > 0.08 || Math.abs(pos[i + 1] - hipY * k) > 0.012) continue;
        lo = Math.min(lo, pos[i + 2]);
        hi = Math.max(hi, pos[i + 2]);
      }
      rows.push(`${k}:${(hi - lo).toFixed(3)}`);
    }
    console.log('量', 'unit', unit.toFixed(3), '髋关节高', hipY.toFixed(3), '最高', top.toFixed(3), '髋高/最高', (hipY / top).toFixed(3), '厚度', rows.join(' '));
  }
  const file = join(dir, `${opt('--name') ?? 'chu'}.png`);
  writeFileSync(file, png(W * dirs.length, H, sheet));
  const types: Record<string, number> = {};
  for (const p of figure.parts) types[p.type] = (types[p.type] ?? 0) + 1;
  console.log(file, '部件', figure.parts.length, JSON.stringify(types), '骨骼', buildSkeleton(figure).bones.length, '身高', figure.metrics.height.toFixed(2), JSON.stringify(body.restRow));
}
