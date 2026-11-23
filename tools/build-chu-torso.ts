// 「楚云萱躯干」：把预设「楚云萱」的九个胸腔拼成一整块，烤成一块距离场格子（public/anime/chu-torso.bin + src/anime/chuTorsoMeta.json），
// 程序里当一个部件用（见 src/geometry/trunk.ts、docs/chu-blocks-plan.md）。
// 用法：node tools/run.mjs tools/build-chu-torso.ts [--cell 0.006] [--round 0.02] [--obj]
//   --round  九个胸腔挨着的地方倒多大的圆角
//   --obj    另存一份网格（.harness-tmp/chu/楚云萱躯干.obj，能在 Blender 里打开看）
// 拼法：九个胸腔照预设摆好的位置，每个都从自己那副胯上渐渐长出来（转了半圈的后排先整个转半圈再长，腰不拧麻花）。
// 腰那一段（MIX）从自己那副胯原样的形状渐渐过渡到胸腔的形状，最底下和胯一模一样：和九副胯接的地方不垫圆顶、不起台阶、不露边
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installAnimeBody } from '../src/anime/body';
import { CHU_TORSO_GRID, CHU_TORSO_URL } from '../src/anime/chuTorso';
import { type Fork, type Part, worldTransforms } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, type V3, add, quatConj, quatMul, rotate, sub } from '../src/geometry/vec';
import { chuSpec } from '../src/model/chu';
import { defaultSpec, normalizeSpec } from '../src/model/spec';
import { compilePartField, fieldAt, smin } from '../src/sdf/field';
import { registerGrid } from '../src/sdf/grids';
import { runJob } from '../src/sdf/job';
import { type V3 as RV3, png, render } from './softRender';

const BAND = 0.032;
/** 胸腔底下多留多长埋在胯里 */
const SINK = 0.04;
const R180: Quat = [0, 1, 0, 0];
/** 腰那一段从哪么高到哪么高（这块躯干自己的坐标里）从胯原样的形状渐渐换成胸腔的形状；CUT 以下不要（那里就是胯） */
const MIX: [number, number] = [0.96, 1.15];
const CUT = 0.945;

export async function main(args: string[], root: string) {
  const opt = (name: string, def: number) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : def;
  };
  const cell = opt('cell', 0.006);
  const round = opt('round', 0.02);
  const bytes = readFileSync(join(root, 'public/anime/body.bin'));
  installAnimeBody(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

  const preset = chuSpec(normalizeSpec({ ...defaultSpec(), bodyStyle: 'anime' }));
  // 照九个胸腔各是各的那种拼法摆（不换成这一整块）
  const spec = { ...preset, blocks: { ...preset.blocks!, trunk: undefined } };
  const figure = buildFigure(spec);
  const xfs = worldTransforms({ parts: figure.parts, scale: 1 });
  const home = xfs.get('UpperBody')!;
  const back = quatConj(home.quat);
  /** 世界里的一点、一个朝向换到这块躯干自己的坐标里（就是正中那个胸腔的坐标） */
  const local = (p: V3): V3 => rotate(back, sub(p, home.pos));

  const ribs = figure.parts.filter((p) => p.type === 'torso' && /^UpperBody(_\d+)?$/.test(p.name));
  if (ribs.length !== 9) throw new Error(`胸腔应该是九个，现在是 ${ribs.length} 个`);
  const first = ribs[0].prims.find((q) => q.kind === 'grid');
  if (!first || first.kind !== 'grid' || !first.fork) throw new Error('正中那个胸腔不是从胯上长出来的');
  const stretch = first.stretchY;
  // 接长的那一截在腰下面、是直的，胸腔从它顶上才开始斜（和 model/chu.ts 摆的一样）：斜的支点、渐渐斜的那一段都抬这么高
  const lift = stretch?.[2] ?? 0;
  const pivot: V3 = [first.fork.pivot[0], first.fork.pivot[1] + lift, first.fork.pivot[2]];
  const from = first.fork.from + lift;
  const to = first.fork.to + lift;
  /** 腰那一段从哪么高到哪么高从胯原样的形状渐渐换成胸腔的形状（接长了的话跟着往上延） */
  const mix: [number, number] = [MIX[0], MIX[1] + lift];

  const fields = ribs.map((rib) => {
    const grid = rib.prims.find((q) => q.kind === 'grid');
    if (!grid || grid.kind !== 'grid') throw new Error(`${rib.name} 没有素体的形状`);
    // 每个胸腔都从自己那副胯上长出来、从接长那截的顶上开始斜。转了半圈的（后排）先整个转半圈（腰的横截面前后差不多），剩下的再渐渐转
    const face = rotate(rib.quat, [0, 0, 1]);
    const flip = Math.abs(Math.atan2(face[0], face[2])) > (100 * Math.PI) / 180;
    const snap = flip ? quatConj(R180) : ([0, 0, 0, 1] as Quat);
    const shift = sub(rib.pos, sub(pivot, rotate(rib.quat, pivot)));
    const turn = quatMul(snap, rib.quat);
    // 同一个转法有两种写法，取转得少的那一种（不然渐渐转的那一段绕远路）
    const fork: Fork = { pivot, quat: turn[3] < 0 ? [-turn[0], -turn[1], -turn[2], -turn[3]] : turn, shift: rotate(snap, shift), from, to };
    const how = flip ? '先转半圈再长出来' : '从胯上长出来';
    const x = xfs.get(rib.name)!;
    const part: Part = {
      ...rib,
      parent: undefined,
      pos: local(x.pos),
      quat: quatMul(back, x.quat),
      bones: undefined,
      prims: [{ ...grid, clipBelow: (grid.clipBelow ?? 0.98) - SINK, fork }],
    };
    console.log(rib.name.padEnd(16), how, '腰在', local(add(x.pos, rotate(x.quat, first.fork!.pivot))).map((v) => v.toFixed(3)).join(', '));
    // 脖子根在哪（胸腔自己的坐标里，最上面那根骨骼的末端）
    const neck = rib.bones?.[rib.bones.length - 1]?.tail ?? [0, pivot[1] + 0.55, 0];
    // 它坐着的那副胯：整个躯干原样的形状（不切掉腰以上），腰那一段从它过渡过来
    const pelvis = figure.parts.find((p) => p.name === rib.parent);
    const pg = pelvis?.prims.find((q) => q.kind === 'grid');
    if (!pelvis || !pg || pg.kind !== 'grid') throw new Error(`${rib.name} 不是坐在一副胯上`);
    const px = xfs.get(pelvis.name)!;
    const { clipAbove: _a, clipRound: _r, ...whole } = pg;
    const seat: Part = { ...pelvis, parent: undefined, pos: local(px.pos), quat: quatMul(back, px.quat), bones: undefined, prims: [whole] };
    return {
      name: rib.name,
      waist: local(add(x.pos, rotate(x.quat, first.fork!.pivot))),
      top: local(add(x.pos, rotate(x.quat, neck))),
      field: compilePartField(part, { pos: part.pos, quat: part.quat, scale: 1 }),
      seat: compilePartField(seat, { pos: seat.pos, quat: seat.quat, scale: 1 }),
    };
  });
  /**
   * 每个胸腔只管自己周围：离它的中轴（腰往下一点到脖子根）REACH 以外的地方不算它。
   * 渐渐转的那一段（fork）离自己很远的地方求出来的距离不准，和别的胸腔一倒圆角，别人身上就鼓出一道棱
   */
  const REACH = 0.3;
  const near = (f: (typeof fields)[number], x: number, y: number, z: number): boolean => {
    const ax = f.top[0] - f.waist[0];
    const ay = f.top[1] - f.waist[1];
    const az = f.top[2] - f.waist[2];
    const t = Math.max(-0.15, Math.min(1, ((x - f.waist[0]) * ax + (y - f.waist[1]) * ay + (z - f.waist[2]) * az) / (ax * ax + ay * ay + az * az)));
    return Math.hypot(x - f.waist[0] - t * ax, y - f.waist[1] - t * ay, z - f.waist[2] - t * az) < REACH;
  };
  const dist = (x: number, y: number, z: number): number => {
    let d = BAND * 4;
    if (y < CUT - BAND) return BAND * 4;
    const s = Math.max(0, Math.min(1, (y - mix[0]) / (mix[1] - mix[0])));
    const w = s * s * (3 - 2 * s);
    for (const f of fields) {
      if (!near(f, x, y, z)) continue;
      const own = w <= 0 ? fieldAt(f.seat, x, y, z) : w >= 1 ? fieldAt(f.field, x, y, z) : (1 - w) * fieldAt(f.seat, x, y, z) + w * fieldAt(f.field, x, y, z);
      d = smin(d, own, round);
    }
    return Math.max(d, CUT - y);
  };

  // 先粗粗扫一遍找出占多大地方
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  const COARSE = 0.012;
  for (let z = -0.7; z <= 0.7; z += COARSE) for (let y = 0.8; y <= 1.9; y += COARSE) for (let x = -0.9; x <= 0.9; x += COARSE) {
    if (dist(x, y, z) > 0) continue;
    const p = [x, y, z];
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k] - COARSE);
      hi[k] = Math.max(hi[k], p[k] + COARSE);
    }
  }
  const pad = BAND + cell;
  const min: V3 = [lo[0] - pad, lo[1] - pad, lo[2] - pad];
  const dims = [0, 1, 2].map((k) => Math.ceil((hi[k] + pad - min[k]) / cell) + 1) as [number, number, number];
  const [nx, ny, nz] = dims;
  const data = new Int16Array(nx * ny * nz);
  const q = (d: number) => Math.round((Math.max(-BAND, Math.min(BAND, d)) / BAND) * 32767);
  // 一块一块来：一块正中离表面够远的，整块都按最远算，不逐点求
  const B = args.includes("--exact") ? 1 : 4;
  const reach = BAND + (B * cell * Math.sqrt(3)) / 2 + cell;
  const t0 = performance.now();
  let fine = 0;
  for (let bz = 0; bz < nz; bz += B) for (let by = 0; by < ny; by += B) for (let bx = 0; bx < nx; bx += B) {
    const mid = dist(min[0] + (bx + (B - 1) / 2) * cell, min[1] + (by + (B - 1) / 2) * cell, min[2] + (bz + (B - 1) / 2) * cell);
    const far = Math.abs(mid) > reach;
    for (let k = bz; k < Math.min(nz, bz + B); k++) for (let j = by; j < Math.min(ny, by + B); j++) for (let i = bx; i < Math.min(nx, bx + B); i++) {
      if (!far) fine++;
      data[i + nx * (j + ny * k)] = far ? (mid > 0 ? 32767 : -32767) : q(dist(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell));
    }
  }
  console.log(`格子 ${dims.join('×')}（${(data.length / 1e6).toFixed(2)} 百万点，逐点求了 ${(fine / 1e6).toFixed(2)} 百万），${((performance.now() - t0) / 1000).toFixed(1)} 秒`);

  const bounds = { min: lo.map((v) => +v.toFixed(4)), max: hi.map((v) => +v.toFixed(4)) };
  writeFileSync(join(root, 'public', CHU_TORSO_URL), new Uint8Array(data.buffer));
  const meta = {
    note: '楚云萱躯干：预设「楚云萱」的九个胸腔拼成的一整块，tools/build-chu-torso.ts 生成。坐标是正中那个胸腔（UpperBody）自己的',
    min: min.map((v) => +v.toFixed(5)),
    dims,
    cell,
    band: BAND,
    length: data.length,
    bounds,
    /** 烤的时候躯干在哪一段接长了多少（「躯干长短」），九个胸腔的腰各在哪：程序里照现在的再拉长、拉宽（见 src/geometry/trunk.ts） */
    stretch: stretch ? [stretch[0], stretch[1], +stretch[2].toFixed(5)] : [0.92, 0.99, 0],
    waists: Object.fromEntries(fields.map((f) => [f.name, f.waist.map((v) => +v.toFixed(5))])),
  };
  writeFileSync(join(root, 'src/anime/chuTorsoMeta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  console.log('写好了', CHU_TORSO_URL, `${(data.byteLength / 1e6).toFixed(1)} MB`);

  if (args.includes('--obj')) {
    registerGrid(CHU_TORSO_GRID, { min, dims, cell, band: BAND, data, bounds: { min: lo, max: hi } });
    const part: Part = { name: 'ChuTorso', type: 'torso', side: ribs[0].side, pos: [0, 0, 0], quat: [0, 0, 0, 1], material: ribs[0].material, prims: [{ kind: 'grid', name: 'ChuTorso', grid: CHU_TORSO_GRID }] };
    const { mesh } = runJob({ parts: [part], voxel: 0.004, blend: 0 });
    if (args.includes('--probe')) {
      // 调试：正面一条竖线上，拼出来的形状和烤好的格子各自的表面在哪
      const baked = compilePartField(part, { pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: 1 });
      const hit = (fn: (z: number) => number) => {
        let z = 0.45;
        while (z > 0 && fn(z) > 0) z -= 0.0002;
        return z.toFixed(4);
      };
      for (let y = 1.0; y <= 1.09; y += 0.003) console.log(y.toFixed(3), hit((z) => dist(0.05, y, z)), hit((z) => fieldAt(baked, 0.05, y, z)));
    }
    const lines = ['# 楚云萱躯干（tools/build-chu-torso.ts），单位米，Y 朝上，面朝 +Z', 'o ChuTorso'];
    for (let i = 0; i < mesh.positions.length; i += 3) lines.push(`v ${mesh.positions[i].toFixed(5)} ${mesh.positions[i + 1].toFixed(5)} ${mesh.positions[i + 2].toFixed(5)}`);
    for (let i = 0; i < mesh.triangles.length; i += 3) lines.push(`f ${mesh.triangles[i] + 1} ${mesh.triangles[i + 1] + 1} ${mesh.triangles[i + 2] + 1}`);
    mkdirSync(join(root, '.harness-tmp/chu'), { recursive: true });
    writeFileSync(join(root, '.harness-tmp/chu/楚云萱躯干.obj'), `${lines.join('\n')}\n`);
    console.log('网格', mesh.info.vertices, '个顶点，', mesh.info.components, '块');
    // 正面、侧面、背面、俯视、从底下往上看（和九副胯接的那一面）
    const dirs: RV3[] = [[0, 0, 1], [1, 0, 0.0001], [0, 0, -1], [0, 1, 0.0001], [0, -1, 0.0001]];
    const W = 900;
    const H = 640;
    const frame = { k: 860, center: [0, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] as RV3 };
    const sheet = new Uint8Array(W * dirs.length * H * 3);
    dirs.forEach((dir, c) => {
      const img = render(mesh.positions, mesh.triangles, dir, frame, W, H);
      for (let y = 0; y < H; y++) sheet.set(img.subarray(y * W * 3, (y + 1) * W * 3), (y * W * dirs.length + c * W) * 3);
    });
    writeFileSync(join(root, '.harness-tmp/chu/楚云萱躯干.png'), png(W * dirs.length, H, sheet));
  }
}
