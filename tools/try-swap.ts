// 手脚互换试做：手腕往手背那边弯过去的手（docs/swap-hand-bend.png），以及白模、素体手臂接脚、腿接手的全身和手脚特写
// （docs/swap-anime.png、docs/swap-mannequin.png）；每条单独设（limbs → docs/per-limb-*.png）；成品角色（character → docs/swap-character.png）。
// 用法：node tools/run.mjs tools/try-swap.ts [anime|mannequin|hand|limbs|character]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installAnimeBody } from '../src/anime/body';
import { handMesh } from '../src/anime/hand';
import { bentHand } from '../src/anime/swap';
import { assembleCharacter } from '../src/character/assemble';
import { characterUrl, rosterEntry } from '../src/character/roster';
import { readCharacter } from '../src/character/source';
import { buildFigure } from '../src/geometry/layout';
import { type BodySpec, defaultSpec, normalizeSpec } from '../src/model/spec';
import { VOXEL } from '../src/sdf/fuse';
import { runJob } from '../src/sdf/job';
import { type V3, frameFor, png, render } from './softRender';

/** 几张图拼成一张：tiles 按行排，每行 cols 张 */
function sheet(tiles: Uint8Array[], cols: number, W: number, H: number): Buffer {
  const rows = Math.ceil(tiles.length / cols);
  const out = new Uint8Array(W * cols * H * rows * 3).fill(247);
  tiles.forEach((tile, t) => {
    const [r, c] = [Math.floor(t / cols), t % cols];
    for (let y = 0; y < H; y++) out.set(tile.subarray(y * W * 3, (y + 1) * W * 3), ((r * H + y) * W * cols + c * W) * 3);
  });
  return png(W * cols, H * rows, out);
}

function handSheet() {
  const W = 320;
  const H = 280;
  const base = handMesh();
  const bent = bentHand(5);
  const views: V3[] = [
    [0, 0, 1],
    [1, 0, 0],
    [0.5, -0.4, 0.75],
  ];
  const meshes = [base, bent.mesh];
  const frame = frameFor(new Float32Array([...base.positions, ...bent.mesh.positions]), views, W, H);
  writeFileSync('docs/swap-hand-bend.png', sheet(meshes.flatMap((m) => views.map((dir) => render(m.positions, m.triangles, dir, frame, W, H))), 3, W, H));
  console.log('手心离手腕', bent.sole.toFixed(4));
}

type Patch = Partial<Omit<BodySpec, 'counts' | 'shape'>> & { counts?: Partial<BodySpec['counts']> };

function bodySheet(style: 'anime' | 'mannequin', extra: Patch[] = []) {
  const cases: Patch[] = [{}, { armEnd: 'foot' }, { legEnd: 'hand' }, { armEnd: 'foot', legEnd: 'hand' }, ...extra];
  const W = 300;
  const H = 520;
  const tiles: Uint8Array[] = [];
  for (const patch of cases) {
    const base = defaultSpec();
    const spec = normalizeSpec({ ...base, ...patch, bodyStyle: style, counts: { ...base.counts, ...patch.counts } });
    const figure = buildFigure(spec);
    const { mesh } = runJob({ parts: figure.parts, voxel: VOXEL.fine, blend: spec.blend });
    const pos = mesh.positions.map((v) => v * figure.scale);
    let low = Infinity;
    for (let i = 1; i < pos.length; i += 3) low = Math.min(low, pos[i]);
    console.log(style, JSON.stringify(patch), '块数', mesh.info.components, '最低点', low.toFixed(4), '身高', figure.metrics.height.toFixed(3));
    const views: V3[] = [
      [0, 0, 1],
      [1, 0, 0],
    ];
    const whole = frameFor(pos, views, W, H);
    for (const dir of views) tiles.push(render(pos, mesh.triangles, dir, whole, W, H));
    // 手、脚特写：左手（+X 那边、腰以下）和左脚（膝盖以下）
    const hand = frameFor(pos, [[0.6, 0.2, 0.8]], W, H / 2, 1.15, (x, y) => x > 0.25 && y > 0.55 && y < 1.0);
    const foot = frameFor(pos, [[0.2, 0.35, 1]], W, H / 2, 1.15, (_x, y) => y < 0.2);
    const a = render(pos, mesh.triangles, [0.6, 0.2, 0.8], hand, W, H / 2);
    const b = render(pos, mesh.triangles, [0.2, 0.35, 1], foot, W, H / 2);
    tiles.push(new Uint8Array([...a, ...b]));
  }
  writeFileSync(`docs/swap-${style}.png`, sheet(tiles, 6, W, H));
}

/** 第 4 期：每条手臂、腿单独设 */
function perLimbSheet(style: 'anime' | 'mannequin') {
  const W = 300;
  const H = 520;
  const cases: Patch[] = [
    { perLimb: { Arm_01_L: { end: 'foot' }, Leg_01_R: { end: 'hand', fingers: 6 } } },
    { fingers: 4, perLimb: { Arm_01_R: { fingers: 7 }, Leg_01_L: { end: 'hand' }, Leg_01_R: { toes: 3 } } },
    { legEnd: 'hand', perLimb: { Leg_01_L: { end: 'foot' } } },
    { counts: { torsos: 2 }, perLimb: { Arm_01_L: { end: 'foot' }, Arm_02_L: { fingers: 3 } } },
  ];
  const tiles: Uint8Array[] = [];
  for (const patch of cases) {
    const base = defaultSpec();
    const spec = normalizeSpec({ ...base, ...patch, bodyStyle: style, counts: { ...base.counts, ...patch.counts } });
    const figure = buildFigure(spec);
    const { mesh } = runJob({ parts: figure.parts, voxel: VOXEL.fine, blend: spec.blend });
    const pos = mesh.positions.map((v) => v * figure.scale);
    let low = Infinity;
    for (let i = 1; i < pos.length; i += 3) low = Math.min(low, pos[i]);
    console.log(style, JSON.stringify(patch.perLimb), '块数', mesh.info.components, '最低点', low.toFixed(4), '身高', figure.metrics.height.toFixed(3));
    const views: V3[] = [[0, 0, 1]];
    const whole = frameFor(pos, views, W, H);
    tiles.push(render(pos, mesh.triangles, [0, 0, 1], whole, W, H));
    const feet = frameFor(pos, [[0.2, 0.35, 1]], W, H, 1.15, (_x, y) => y < 0.25);
    tiles.push(render(pos, mesh.triangles, [0.2, 0.35, 1], feet, W, H));
  }
  writeFileSync(`docs/per-limb-${style}.png`, sheet(tiles, 4, W, H));
}

/** 第 5 期：成品角色。每行一种设定：全身正面、左手（或者接上去的鞋）特写、脚特写 */
function characterSheet(root: string, ids: string[], conjoined = false) {
  const W = 260;
  const H = 300;
  const cases: Partial<BodySpec>[] = conjoined ? [{ conjoined: 'same' }, { conjoined: 'opposite' }, { conjoined: 'same', conjoinPose: 'lie' }, { conjoined: 'opposite', conjoinPose: 'lie' }, { conjoined: 'same', conjoinPose: 'flat' }, { conjoined: 'opposite', conjoinPose: 'flat' }, { conjoined: 'same', conjoinPose: 'stand' }, { conjoined: 'opposite', conjoinPose: 'stand' }] : [{}, { armEnd: 'foot' }, { legEnd: 'hand' }, { fingers: 7 }, { fingers: 3 }];
  const tiles: Uint8Array[] = [];
  for (const id of ids) {
    const entry = rosterEntry(id as never);
    const bytes = readFileSync(join(root, 'public', characterUrl(id as never)));
    const source = readCharacter(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { ...entry, url: characterUrl(id as never) });
    for (const patch of cases) {
      const build = assembleCharacter(source, normalizeSpec({ ...defaultSpec(), bodyStyle: 'character', character: id, ...patch }));
      let n = 0;
      let m = 0;
      for (const c of build.meshes) {
        n += c.positions.length / 3;
        m += c.indices.length;
      }
      const pos = new Float32Array(n * 3);
      const idx = new Uint32Array(m);
      let vo = 0;
      let io = 0;
      for (const c of build.meshes) {
        pos.set(c.positions, vo * 3);
        for (let i = 0; i < c.indices.length; i++) idx[io++] = c.indices[i] + vo;
        vo += c.positions.length / 3;
      }
      let top = -Infinity;
      for (let i = 1; i < pos.length; i += 3) top = Math.max(top, pos[i]);
      console.log(id, JSON.stringify(patch), '骨骼', build.bones.length, '身高', build.metrics.height.toFixed(3));
      if (conjoined) {
        const views: V3[] = [[1, 0.15, 0], [0.6, 0.5, 0.6], [0, 0.1, 1]];
        const frame = frameFor(pos, views, W, H);
        for (const dir of views) tiles.push(render(pos, idx, dir, frame, W, H));
        continue;
      }
      tiles.push(render(pos, idx, [0, 0, 1], frameFor(pos, [[0, 0, 1]], W, H), W, H));
      // 左手：照接上去的鞋、多出来的手指那几块取景，没有就照手大概在的地方
      let box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const c of build.meshes) {
        if (!/FootOnArm_L|FingerA_L/.test(c.name)) continue;
        for (let i = 0; i < c.positions.length; i += 3) for (let k = 0; k < 3; k++) {
          box[k] = Math.min(box[k], c.positions[i + k]);
          box[k + 3] = Math.max(box[k + 3], c.positions[i + k]);
        }
      }
      if (box[0] === Infinity) box = [0.4, top * 0.42, -0.1, 0.65, top * 0.56, 0.15];
      const pad = 0.06;
      const near = (x: number, y: number, z: number) => x > box[0] - pad && x < box[3] + pad && y > box[1] - pad && y < box[4] + pad && z > box[2] - pad && z < box[5] + pad;
      tiles.push(render(pos, idx, [0.3, -0.2, 1], frameFor(pos, [[0.3, -0.2, 1]], W, H, 1.1, near), W, H));
      tiles.push(render(pos, idx, [0.4, 0.3, 1], frameFor(pos, [[0.4, 0.3, 1]], W, H, 1.2, (_x, y) => y < top * 0.12), W, H));
    }
  }
  writeFileSync(conjoined ? 'docs/conjoined-character.png' : 'docs/swap-character.png', sheet(tiles, 6, W, H));
}

/** 第 6 期：连体（同向、反向），侧面、斜上、正面 */
function conjoinSheet(style: 'anime' | 'mannequin') {
  const W = 360;
  const H = 300;
  const cases: Partial<BodySpec>[] = [
    { conjoined: 'same' },
    { conjoined: 'opposite' },
    { conjoined: 'same', counts: { ...defaultSpec().counts, armPairs: 2, heads: 2 } },
    { conjoined: 'same', conjoinPose: 'lie' },
    { conjoined: 'opposite', conjoinPose: 'lie' },
    { conjoined: 'same', conjoinPose: 'flat' },
    { conjoined: 'opposite', conjoinPose: 'flat' },
    { conjoined: 'same', conjoinPose: 'stand' },
    { conjoined: 'opposite', conjoinPose: 'stand' },
  ];
  const tiles: Uint8Array[] = [];
  for (const patch of cases) {
    const spec = normalizeSpec({ ...defaultSpec(), ...patch, bodyStyle: style });
    const figure = buildFigure(spec);
    const { mesh } = runJob({ parts: figure.parts, voxel: VOXEL.fine, blend: spec.blend });
    const pos = mesh.positions.map((v) => v * figure.scale);
    let low = Infinity;
    for (let i = 1; i < pos.length; i += 3) low = Math.min(low, pos[i]);
    console.log(style, JSON.stringify(patch.conjoined), patch.conjoinPose ?? 'prone', '块数', mesh.info.components, '最低点', low.toFixed(4), '高', figure.metrics.height.toFixed(3));
    const views: V3[] = [[1, 0.15, 0], [0.6, 0.5, 0.6], [0, 0.1, 1]];
    const frame = frameFor(pos, views, W, H);
    for (const dir of views) tiles.push(render(pos, mesh.triangles, dir, frame, W, H));
  }
  writeFileSync(`docs/conjoined-${style}.png`, sheet(tiles, 3, W, H));
}

export function main(args: string[], root: string) {
  const what = args[0] ?? 'all';
  if (what === 'conjoined') {
    const bytes = readFileSync(join(root, 'public/anime/body.bin'));
    installAnimeBody(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    for (const style of (args[1] ?? 'mannequin,anime').split(',')) conjoinSheet(style as 'anime' | 'mannequin');
    return;
  }
  if (what === 'character') {
    characterSheet(root, (args[1] ?? 'vita,noble').split(','), args[2] === 'conjoined');
    return;
  }
  if (what === 'limbs') {
    const bytes = readFileSync(join(root, 'public/anime/body.bin'));
    installAnimeBody(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    perLimbSheet('anime');
    perLimbSheet('mannequin');
    return;
  }
  if (what === 'hand' || what === 'all') handSheet();
  if (what === 'anime' || what === 'all') {
    const bytes = readFileSync(join(root, 'public/anime/body.bin'));
    installAnimeBody(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    bodySheet('anime');
  }
  if (what === 'mannequin' || what === 'all') bodySheet('mannequin', [{ hands: 'mitten', armEnd: 'foot', legEnd: 'hand' }]);
}
