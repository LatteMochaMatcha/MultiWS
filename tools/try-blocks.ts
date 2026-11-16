// 体块（docs/blocks-plan.md）试做的出图：两种白模各加一个头、一对手臂、一对胸，静止三个方向 + 几个现成姿势，
// 一种样式一张，存到 .harness-tmp/blocks/<样式>.png；同时打印融合出来几块、骨骼几根。
// 用法：node tools/run.mjs tools/try-blocks.ts [--voxel 0.012] [--case chest]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installAnimeBody } from '../src/anime/body';
import { buildFigure } from '../src/geometry/layout';
import { addBlock } from '../src/model/blocks';
import { type BodySpec, defaultSpec, normalizeSpec } from '../src/model/spec';
import { POSE_LIBRARY } from '../src/pose/library';
import { buildSkeleton } from '../src/rig/skeleton';
import { VOXEL } from '../src/sdf/fuse';
import { figureBody } from './overview';
import { type V3, VIEWS, frameFor, png, render } from './softRender';

const W = 300;
const H = 440;
const POSES = ['张开双臂', '叉腰', '蹲着'];

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
  // 多一条腿在后面、多一条尾巴
  legs: (spec) => {
    const tailed = normalizeSpec({ ...spec, counts: { ...spec.counts, tails: 1 } });
    const out = addBlock(tailed, [{ from: 'Leg_01_L', shift: [-0.09, 0, -0.16] }]).spec;
    return addBlock(out, [{ from: 'Tail_01', shift: [0.1, 0, 0] }]).spec;
  },
};

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
