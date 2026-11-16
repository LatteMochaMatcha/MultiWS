// 体块（docs/blocks-plan.md）试做的出图：两种白模各加一个头、一对手臂、一对胸，静止三个方向 + 几个现成姿势，
// 一种样式一张，存到 .harness-tmp/blocks/<样式>.png；同时打印融合出来几块、骨骼几根。
// 用法：node tools/run.mjs tools/try-blocks.ts [--voxel 0.012] [--case chest]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installAnimeBody } from '../src/anime/body';
import { buildFigure } from '../src/geometry/layout';
import { attachParts } from '../src/model/attach';
import { addBlock, copyShift, setSplitTorso } from '../src/model/blocks';
import { setOverride } from '../src/model/overrides';
import { type BodySpec, defaultSpec, normalizeSpec } from '../src/model/spec';
import { POSE_LIBRARY } from '../src/pose/library';
import { buildSkeleton } from '../src/rig/skeleton';
import { VOXEL } from '../src/sdf/fuse';
import { figureBody } from './overview';
import { type V3, VIEWS, frameFor, png, render } from './softRender';

const W = 300;
const H = 440;
const POSES = ['张开双臂', '叉腰', '蹲着'];

/** 界面上点「复制一份」时先挪开多少（见 model/blocks.ts 的 copyShift） */
const copyShiftOf = (spec: BodySpec, name: string) => {
  const part = buildFigure(setSplitTorso(spec, true)).parts.find((p) => p.name === name);
  return part ? copyShift(part) : undefined;
};

/** 各种加法：名字 → 在默认角色上加了什么 */
const CASES: Record<string, (spec: BodySpec) => BodySpec> = {
  // 肩上多一个头、胯边多一对手臂、肚子上多一对胸
  all: (spec) => {
    const anime = spec.bodyStyle === 'anime';
    let out = addBlock(spec, [{ from: 'Head_01', shift: [0.2, -0.03, 0] }]).spec;
    out = addBlock(out, [
      { from: 'Arm_01_L', shift: [0, -0.3, 0] },
      { from: 'Arm_01_R', shift: [0, -0.3, 0] },
    ]).spec;
    return addBlock(out, [
      { from: 'Chest_01_L', shift: [0, -0.17, anime ? -0.012 : -0.02], plain: anime },
      { from: 'Chest_01_R', shift: [0, -0.17, anime ? -0.012 : -0.02], plain: anime },
    ]).spec;
  },
  // 只加胸：肚子上一对、背上一对（转到背后）。环境变量 BUST 给胸部大小，SINK 给肚子上那对往里沉多少，BACK 给背上那对往后挪多少
  chest: (given) => {
    const spec = normalizeSpec({ ...given, shape: { ...given.shape, bust: Number(process.env.BUST ?? given.shape.bust) } });
    const anime = spec.bodyStyle === 'anime';
    const sink = -Number(process.env.SINK ?? (anime ? 0.012 : 0.02));
    let out = addBlock(spec, [
      { from: 'Chest_01_L', shift: [0, -0.17, sink], plain: anime },
      { from: 'Chest_01_R', shift: [0, -0.17, sink], plain: anime },
    ]).spec;
    out = addBlock(out, [
      { from: 'Chest_01_L', plain: anime },
      { from: 'Chest_01_R', plain: anime },
    ]).spec;
    const back = -Number(process.env.BACK ?? 0.2);
    return { ...out, overrides: { ...out.overrides, Chest_201_L: { position: [0, 0, back], rotation: [0, 180, 0] }, Chest_201_R: { position: [0, 0, back], rotation: [0, 180, 0] } } };
  },
  // 第 3 期缝合：复制一个小头接到左上臂上、复制一只胸接到左大腿上、右手臂接到头上——套姿势时它们跟着接的那个部件走
  attach: (spec) => {
    const anime = spec.bodyStyle === 'anime';
    let out = addBlock(spec, [{ from: 'Head_01', shift: [0.33, -0.1, 0] }]).spec;
    out = setOverride(out, 'Head_101', { scale: [0.55, 0.55, 0.55] });
    out = attachParts(out, ['Head_101'], 'Arm_01_L').spec;
    out = addBlock(out, [{ from: 'Chest_01_L', shift: [0.03, -0.5, -0.02], plain: anime }]).spec;
    out = attachParts(out, ['Chest_201_L'], 'Leg_01_L').spec;
    return attachParts(out, ['Arm_01_R'], 'Head_01').spec;
  },
  // 第 4 期：躯干分成两块以后复制胸腔——一个胯上两个胸腔，各往两边歪开
  ribs: (spec) => addBlock(setSplitTorso(spec, true), [{ from: 'UpperBody' }]).spec,
  // 第 4 期：复制胯——后面多一副胯，带着自己的一对腿
  hips: (spec) => addBlock(setSplitTorso(spec, true), [{ from: 'Torso', shift: [0, 0, -0.3] }]).spec,
  // 第 4 期：前后两副胯，各长一个胸腔——复制出来的胸腔接到复制出来的胯上，从那副胯上长出来
  pair: (spec) => {
    let out = addBlock(setSplitTorso(spec, true), [{ from: 'Torso', shift: [0, 0, -0.28] }]).spec;
    out = addBlock(out, [{ from: 'UpperBody', shift: [0, 0, -0.28] }]).spec;
    return attachParts(out, ['UpperBody_201'], 'Torso_101').spec;
  },
  // 对照：程序自己排的两个、三个上半身（counts.torsos）
  program2: (spec) => normalizeSpec({ ...spec, counts: { ...spec.counts, torsos: 2 } }),
  program3: (spec) => normalizeSpec({ ...spec, counts: { ...spec.counts, torsos: 3 } }),
  // 复制出来的两个、三个胸腔，什么都不调（复制完就是这样）
  copy2: (spec) => addBlock(setSplitTorso(spec, true), [{ from: 'UpperBody', shift: copyShiftOf(spec, 'UpperBody') }]).spec,
  copy3: (spec) => {
    const out = addBlock(setSplitTorso(spec, true), [{ from: 'UpperBody', shift: copyShiftOf(spec, 'UpperBody') }]).spec;
    return addBlock(out, [{ from: 'UpperBody', shift: copyShiftOf(spec, 'UpperBody') }]).spec;
  },
  // 四个胸腔（程序排的「几个上半身」最多三个）
  copy4: (spec) => {
    let out = setSplitTorso(spec, true);
    for (let i = 0; i < 3; i++) out = addBlock(out, [{ from: 'UpperBody' }]).spec;
    return out;
  },
  // 第 4 期：三个胸腔、两副胯
  both: (spec) => {
    let out = addBlock(setSplitTorso(spec, true), [{ from: 'UpperBody' }]).spec;
    out = addBlock(out, [{ from: 'UpperBody' }]).spec;
    return addBlock(out, [{ from: 'Torso', shift: [0, 0, -0.3] }]).spec;
  },
  // 多一条腿在后面、多一条尾巴
  legs: (spec) => {
    const tailed = normalizeSpec({ ...spec, counts: { ...spec.counts, tails: 1 } });
    const out = addBlock(tailed, [{ from: 'Leg_01_L', shift: [-0.09, 0, -0.16] }]).spec;
    return addBlock(out, [{ from: 'Tail_01', shift: [0.1, 0, 0] }]).spec;
  },
};

/** 第 2 期：躯干分成胸腔和胯两块。每一行一种摆法：名字 → 胸腔（UpperBody）、胯（Torso）的微调 */
const SPLITS: [string, BodySpec['overrides']][] = [
  ['没切开', {}],
  ['切开没动', {}],
  ['胸腔前倾 20°', { UpperBody: { rotation: [20, 0, 0] } }],
  ['胸腔歪 15°', { UpperBody: { rotation: [0, 0, 15] } }],
  ['胸腔拔高 10 cm', { UpperBody: { position: [0, 0.1, 0] } }],
  ['胸腔扭 30°', { UpperBody: { rotation: [0, 30, 0] } }],
  ['胸腔左挪 6 cm', { UpperBody: { position: [0.06, 0, 0] } }],
  ['胯歪 12°', { Torso: { rotation: [0, 0, 12] } }],
  ['胯放大 1.25', { Torso: { scale: [1.25, 1.25, 1.25] } }],
  ['胯后挪 6 cm', { Torso: { position: [0, 0, -0.06] } }],
];

/** 一种样式一张：每行一种摆法，静止的正面、侧面、斜前，再套两个现成姿势 */
function splitSheet(dir: string, bodyStyle: 'mannequin' | 'anime', voxel: number, rows: string | undefined) {
  const poses = ['弯腰拿东西', '蹲着'];
  const tiles: Uint8Array[] = [];
  const picked = SPLITS.filter(([name]) => !rows || rows.split(',').includes(name));
  for (const [name, overrides] of picked) {
    const spec = normalizeSpec({ ...defaultSpec(), bodyStyle, overrides, blocks: { added: [], splitTorso: name !== '没切开' } });
    const figure = buildFigure(spec);
    const body = figureBody(spec, voxel);
    const shot = (pos: Float32Array, triangles: Uint32Array, view: keyof typeof VIEWS) => {
      const dirOf = VIEWS[view] as V3;
      tiles.push(render(pos, triangles, dirOf, frameFor(pos, [dirOf], W, H, 1.06), W, H));
    };
    for (const view of ['front', 'side', 'three'] as const) shot(body.rest.pos, body.rest.triangles, view);
    const paths: string[] = [];
    for (const poseName of poses) {
      const posed = body.pose(POSE_LIBRARY.find((p) => p.name === poseName)!.posing);
      paths.push(`${poseName}:${posed.path}`);
      shot(posed.pos, posed.triangles, 'three');
    }
    console.log(bodyStyle, name, '部件', figure.parts.map((p) => p.name).filter((n) => /Torso|UpperBody/.test(n)).join('+'), '身高', figure.metrics.height.toFixed(3), JSON.stringify(body.restRow), paths.join(' '));
  }
  const cols = 3 + poses.length;
  const sheet = new Uint8Array(W * cols * H * picked.length * 3);
  tiles.forEach((img, i) => {
    const [r, c] = [Math.floor(i / cols), i % cols];
    for (let y = 0; y < H; y++) sheet.set(img.subarray(y * W * 3, (y + 1) * W * 3), ((r * H + y) * W * cols + c * W) * 3);
  });
  const file = join(dir, `split-${bodyStyle}.png`);
  writeFileSync(file, png(W * cols, H * picked.length, sheet));
  console.log(file);
}

export async function main(args: string[], root: string) {
  const opt = (key: string) => {
    const i = args.indexOf(key);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const voxel = Number(opt('--voxel') ?? VOXEL.fine);
  const only = opt('--case');
  const dir = join(root, '.harness-tmp', 'blocks');
  mkdirSync(dir, { recursive: true });
  const bytes = readFileSync(join(root, 'public/anime/body.bin'));
  installAnimeBody(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  if (only === 'split') {
    for (const bodyStyle of (opt('--style') ? [opt('--style')] : ['mannequin', 'anime']) as ('mannequin' | 'anime')[]) splitSheet(dir, bodyStyle, voxel, opt('--rows'));
    return;
  }

  for (const [name, make] of Object.entries(CASES)) {
    if (only && only !== name) continue;
    for (const bodyStyle of ['mannequin', 'anime'] as const) {
      const spec = make(normalizeSpec({ ...defaultSpec(), bodyStyle }));
      const figure = buildFigure(spec);
      const body = figureBody(spec, voxel);
      const tiles: Uint8Array[] = [];
      const shot = (pos: Float32Array, triangles: Uint32Array, view: keyof typeof VIEWS) => {
        const dirOf = VIEWS[view] as V3;
        tiles.push(render(pos, triangles, dirOf, frameFor(pos, [dirOf], W, H, 1.06), W, H));
      };
      for (const view of ['front', 'three', 'back'] as const) shot(body.rest.pos, body.rest.triangles, view);
      const paths: string[] = [];
      for (const poseName of POSES) {
        const preset = POSE_LIBRARY.find((p) => p.name === poseName);
        if (!preset) throw new Error(`没有现成姿势 ${poseName}`);
        const posed = body.pose(preset.posing);
        paths.push(`${poseName}:${posed.path}`);
        shot(posed.pos, posed.triangles, 'three');
      }
      const sheet = new Uint8Array(W * tiles.length * H * 3);
      tiles.forEach((img, c) => {
        for (let y = 0; y < H; y++) sheet.set(img.subarray(y * W * 3, (y + 1) * W * 3), (y * W * tiles.length + c * W) * 3);
      });
      const file = join(dir, `${name}-${bodyStyle}.png`);
      writeFileSync(file, png(W * tiles.length, H, sheet));
      console.log(file, '部件', figure.parts.length, '骨骼', buildSkeleton(figure).bones.length, JSON.stringify(body.restRow), paths.join(' '));
    }
  }
}
