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
import { CHU, chuSpec } from '../src/model/chu';
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
/** 每面两个胸腔的时候，正中那副胯照原样的躯干往上长到腰那一段顶上再高多少（这块躯干自己的坐标里），再截平 */
const CARRIER_TOP = 0.12;
/**
 * 每面两个胸腔的时候：每副胯原样的肚子往中间推，到腰上多高（从 CUT 算）推到胸腔的腰上（LEAN）；
 * 腰上从多高到多高，几副肚子并在一起的形状渐渐变成两个胸腔的（MORPH）；变的时候几副肚子之间倒多大的圆角（越往上越大，并成一整块）；
 * （填沟从多高开始见 SEAT_TOP）
 */
const LEAN = 0.25;
const MORPH: [number, number] = [0.08, 0.5];
const BELLY_ROUND = 0.1;
/** 几副肚子并在一起的地方最少倒多大的圆角（腰上那一层也有，不留尖角）；往中间推的起头多长是圆弧 */
const BELLY_ROUND_MIN = 0.11;
const BEND = 0.14;
/** 几副肚子之间的圆角从腰往上多高才长到 BELLY_ROUND_MIN（缝口顶上的圆拱多高） */
const ARCH = 0.105;
/** 胯自己（体块里那副胯，不在这块躯干里）比这块躯干的底高出这么多：往中间推从它顶上才开始，不然胯那一截直的戳出来、拐出一个角 */
const LEAN_FROM = 0.1;
/** 填沟从腰上多高开始：要在几列已经并起来以后（不然缝口上面被填成一整块平的「天花板」） */
const SEAT_TOP = 0.3;

/**
 * 一维的平方距离变换（Felzenszwalb）：f 是每一格到最近的「有」的格子的平方距离的初值（有的是 0、没有的是很大），就地改成真的。
 * v、z、g 是借来用的工作区
 */
function edt1(f: Float64Array, n: number, v: Int32Array, z: Float64Array, g: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    g[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
  for (let q = 0; q < n; q++) f[q] = g[q];
}

/**
 * 每面两个胸腔的时候烤完再磨一遍：腰上 from 往上整块磨 all 遍（三格平均），去掉胯并进上半身那几道棱；
 * 正中（左右离正中不到 half）再多磨到 middle 遍，两个胸腔接在一起的那道沟填平。往下、往两边是渐渐减弱的，和没磨的接得上
 */
const POLISH = { from: 0.05, all: 6, middle: 24, half: 0.09, waist: 20, waistTop: 0.42 };
function polish(data: Int16Array, dims: readonly number[], min: readonly number[], cell: number, o: { from: number; all: number; middle: number; half: number; waist: number; waistTop: number }) {
  const t0 = performance.now();
  const [nx, ny] = dims;
  const raw = Float32Array.from(data, (q) => (q / 32767) * BAND);
  const light = raw.slice();
  for (let pass = 0; pass < o.all; pass++) blur(light, dims);
  const heavy = light.slice();
  for (let pass = o.all; pass < o.middle; pass++) blur(heavy, dims);
  // 腰那一段（胯并进上半身的地方）也多磨：两侧的鼓包磨平，胯和胯之间缝口顶上跟着填一点
  const waist = light.slice();
  for (let pass = o.all; pass < o.waist; pass++) blur(waist, dims);
  const RAMP = 0.08;
  for (let i = 0; i < data.length; i++) {
    const x = min[0] + (i % nx) * cell;
    const y = min[1] + (Math.floor(i / nx) % ny) * cell;
    const s = Math.max(0, Math.min(1, (y - o.from) / RAMP));
    if (s <= 0) continue;
    const up = s * s * (3 - 2 * s);
    const c = Math.max(0, Math.min(1, 1 - (Math.abs(x) - o.half) / o.half));
    const mid = c * c * (3 - 2 * c);
    // 腰那一段：从 from 往上渐渐加满，到 waistTop 往上渐渐退掉
    const t = Math.max(0, Math.min(1, (o.from + o.waistTop - y) / RAMP));
    const band = up * t * t * (3 - 2 * t);
    const base = light[i] + band * (waist[i] - light[i]);
    const d = raw[i] + up * (base - raw[i] + mid * (heavy[i] - base));
    data[i] = Math.round((Math.max(-BAND, Math.min(BAND, d)) / BAND) * 32767);
  }
  console.log(`磨平：整块 ${o.all} 遍、正中 ${o.middle} 遍，${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
}

/** 沿三个方向各做一遍三格平均 */
function blur(a: Float32Array, dims: readonly number[]) {
  const [nx, ny, nz] = dims;
  const tmp = new Float32Array(Math.max(nx, ny, nz));
  const line = (start: number, stride: number, n: number) => {
    for (let q = 0; q < n; q++) tmp[q] = a[start + q * stride];
    for (let q = 1; q < n - 1; q++) a[start + q * stride] = (tmp[q - 1] + tmp[q] + tmp[q + 1]) / 3;
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) line(nx * (j + ny * k), 1, nx);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) line(i + nx * ny * k, nx, ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) line(i + nx * j, nx * ny, nz);
}

/** 每一格到最近的 on 格子的距离（米） */
function distanceTo(on: Uint8Array, dims: readonly number[], cell: number): Float32Array {
  const [nx, ny, nz] = dims;
  const d = new Float64Array(on.length);
  for (let i = 0; i < on.length; i++) d[i] = on[i] ? 0 : 1e20;
  const n = Math.max(nx, ny, nz);
  const f = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const g = new Float64Array(n);
  const pass = (len: number, stride: number, starts: Iterable<number>) => {
    for (const s of starts) {
      for (let q = 0; q < len; q++) f[q] = d[s + q * stride];
      edt1(f, len, v, z, g);
      for (let q = 0; q < len; q++) d[s + q * stride] = f[q];
    }
  };
  function* range(a: number, b: number, sa: number, sb: number) {
    for (let j = 0; j < b; j++) for (let i = 0; i < a; i++) yield i * sa + j * sb;
  }
  pass(nx, 1, range(ny, nz, nx, nx * ny));
  pass(ny, nx, range(nx, nz, 1, nx * ny));
  pass(nz, nx * ny, range(nx, ny, 1, nx));
  return Float32Array.from(d, (x) => Math.sqrt(x) * cell);
}

/**
 * 填沟：把列与列、排与排之间窄的凹沟填平（形态学闭运算：先往外胀 r，再往里缩 r），外轮廓不变，看着是一整块。
 * 只填腰以上（from 往上 RAMP 渐渐填满），和九副胯接的那一圈不动
 */
function fillGrooves(data: Int16Array, dims: readonly number[], min: readonly number[], cell: number, r: number, from: number) {
  const t0 = performance.now();
  const [nx, ny, nz] = dims;
  // 四周多留出 r 那么宽的空地再算：不然胀出去的碰到格子边上，缩不回来，顶上被切平
  const P = Math.ceil(r / cell) + 2;
  const big = [nx + 2 * P, ny + 2 * P, nz + 2 * P];
  const at = (i: number, j: number, k: number) => i + P + big[0] * (j + P + big[1] * (k + P));
  const inside = new Uint8Array(big[0] * big[1] * big[2]);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (data[i + nx * (j + ny * k)] < 0) inside[at(i, j, k)] = 1;
  // 胀：离身子不到 r 的都算
  const out = distanceTo(inside, big, cell);
  // 缩：离胀出来的外面不到 r 的去掉；填好的距离就是 r - 离外面多远
  const back = distanceTo(Uint8Array.from(out, (d) => (d < r ? 0 : 1)), big, cell);
  // 格子上算出来的距离有一格一格的台阶，表面看着一道道横纹：前后左右上下各磨三遍
  for (let pass = 0; pass < 3; pass++) blur(back, big);
  const RAMP = 0.14;
  let filled = 0;
  for (let i = 0; i < data.length; i++) {
    const y = min[1] + (Math.floor(i / nx) % ny) * cell;
    const fill0 = back[at(i % nx, Math.floor(i / nx) % ny, Math.floor(i / (nx * ny)))];
    const s = Math.max(0, Math.min(1, (y - from) / RAMP));
    if (s <= 0) continue;
    const w = s * s * (3 - 2 * s);
    const was = (data[i] / 32767) * BAND;
    // 底下渐渐收回去（越往下填得越少，底边是斜着收的圆弧，不是一块平的搁板）
    const fill = r - fill0 + (1 - w) * 0.1;
    const d = smin(was, fill, 0.02);
    if (d < 0 && was >= 0) filled++;
    data[i] = Math.round((Math.max(-BAND, Math.min(BAND, d)) / BAND) * 32767);
  }
  console.log(`填沟 r=${r}：多填了 ${filled} 格（${((filled * cell ** 3) * 1000).toFixed(2)} 升），${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
}

export async function main(args: string[], root: string) {
  const opt = (name: string, def: number) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : def;
  };
  const cell = opt('cell', 0.006);
  // 每面两个胸腔的时候不填沟（会在缝口上面填出一块平的「天花板」），两个胸腔、前后排之间靠圆角并起来（再大胸口会鼓出疙瘩）
  const round = opt('round', CHU.ribX < 1 ? 0.03 : 0.02);
  const bytes = readFileSync(join(root, 'public/anime/body.bin'));
  installAnimeBody(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

  // --chu：临时改 CHU 里的数再烤（试摆位用，和 try-chu.ts 的一样）
  const tweak = args.indexOf('--chu');
  if (tweak >= 0) Object.assign(CHU as Record<string, unknown>, JSON.parse(args[tweak + 1]));
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
  /** 每面两个胸腔（CHU.ribX < 1）：胸腔整块摆在腰上，九副胯各长到腰、彼此不连，两样之间倒大圆角（见 dist） */
  const split = CHU.ribX < 1;

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
    // 每面两个胸腔的时候（split）胸腔挪离了自己那副胯，不从胯上长出来：整块照摆好的转过去（渐渐转的那一段放到最底下以下）
    const fork: Fork = { pivot, quat: turn[3] < 0 ? [-turn[0], -turn[1], -turn[2], -turn[3]] : turn, shift: rotate(snap, shift), ...(split ? { from: -2, to: -1 } : { from, to }) };
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
    const waist = local(add(x.pos, rotate(x.quat, first.fork!.pivot)));
    return {
      name: rib.name,
      // 每面两个胸腔的时候（CHU.ribX < 1），正中那一列的胸腔只托着头、脖子、胸，不出形状；底下它那副胯照样接上来
      carrier: CHU.ribX < 1 && Math.abs(waist[0]) < 0.05 && Math.abs(waist[2]) > 0.1,
      waist,
      top: local(add(x.pos, rotate(x.quat, neck))),
      /** 它那副胯的正中在哪（左右），绕腰上这一点往中间斜多少（sin），斜到 LEAN 那么高正好到胸腔的腰上（见 dist） */
      hip: seat.pos[0],
      lean: (seat.pos[0] - waist[0]) / LEAN,
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
  /**
   * 胯的肚子：胯顶（CUT + LEAN_FROM）往上只沿用胯顶那一层的截面（不带肋骨下缘往外张的那一圈）；
   * 胯顶往下到 CUT 取这一层到胯顶之间最宽的（腰最细处往上又鼓回来，两侧看着是一个包：填平，往上只收不鼓）
   */
  /** 最外一列胯的正中离左右正中多远 */
  const outerX = Math.max(...fields.map((f) => Math.abs(f.hip)));
  const seatUp = (seat: (typeof fields)[number]['seat'], x: number, y: number, z: number): number => {
    const top = CUT + LEAN_FROM;
    if (y >= top) return fieldAt(seat, x, top, z);
    let d = fieldAt(seat, x, y, z);
    for (let k = 1; k <= 5; k++) d = Math.min(d, fieldAt(seat, x, y + ((top - y) * k) / 5, z));
    return d;
  };
  /**
   * 几副肚子不倒圆角、硬并在一起时，正面看左右最外到哪（每隔 SIDE_STEP 高一层，左右各一张表）。
   * 往上只收不放：哪一层都不比它下面任何一层宽
   */
  const SIDE_STEP = 0.005;
  const sideRows = Math.ceil(MORPH[1] / SIDE_STEP) + 2;
  const sideTable = [new Float64Array(sideRows), new Float64Array(sideRows)];
  if (split) {
    const hard = (x: number, y: number, z: number): number => {
      const up = Math.max(0, y - CUT - LEAN_FROM);
      const bend = up < BEND ? (up * up) / (2 * BEND) : up - BEND / 2;
      let d = Infinity;
      for (const f of fields) d = Math.min(d, seatUp(f.seat, x + f.lean * bend, y, z));
      return d;
    };
    for (let r = 0; r < sideRows; r++) {
      const y = CUT + r * SIDE_STEP;
      for (const s of [0, 1]) {
        const sign = s ? 1 : -1;
        let edge = 0;
        for (let z = -0.6; z <= 0.6; z += 0.008) {
          // 从外往里找第一个在里面的点，再二分到表面
          let outx = outerX + 0.35;
          let inx = -1;
          for (let ax = outx; ax >= 0; ax -= 0.01) {
            if (hard(sign * ax, y, z) <= 0) { inx = ax; break; }
            outx = ax;
          }
          if (inx < 0) continue;
          for (let k = 0; k < 12; k++) {
            const m = (inx + outx) / 2;
            if (hard(sign * m, y, z) <= 0) inx = m; else outx = m;
          }
          edge = Math.max(edge, inx);
        }
        sideTable[s][r] = r > 0 ? Math.min(edge, sideTable[s][r - 1]) : edge;
      }
    }
  }
  const sideAt = (y: number, s: 0 | 1): number => {
    const t = Math.max(0, Math.min(sideRows - 1.001, (y - CUT) / SIDE_STEP));
    const r = Math.floor(t);
    return sideTable[s][r] + (t - r) * (sideTable[s][r + 1] - sideTable[s][r]);
  };
  const dist = (x: number, y: number, z: number): number => {
    let d = BAND * 4;
    if (y < CUT - BAND) return BAND * 4;
    if (split) {
      // 这块躯干的底（CUT）就是腰，往下是九副胯、各是各的。每副胯原样的肚子越往上越往中间推（外侧是斜着并进上半身的斜线），
      // 腰上 MORPH 那一段里，这几副肚子并在一起的形状渐渐变成上面两个胸腔的形状：不切、不收棱，一路是顺的
      const dy = y - CUT;
      const s = Math.max(0, Math.min(1, (dy - MORPH[0]) / (MORPH[1] - MORPH[0])));
      const w = s * s * (3 - 2 * s);
      // 胯的肚子从胯顶（CUT + LEAN_FROM）往上只沿用那一层的截面，不带它自己肋骨下缘往外张的那一圈（两侧会鼓出一个包）
      // 往中间推多少：腰上那一层不推，起头那 BEND 一段照圆弧慢慢加上去（不是一下子拐成斜线），再往上照斜线
      const up = Math.max(0, dy - LEAN_FROM);
      const bend = up < BEND ? (up * up) / (2 * BEND) : up - BEND / 2;
      // 几副肚子之间的圆角从腰（CUT）往上 ARCH 那一段由零渐渐加大：胯和胯之间的缝口顶上是一个矮矮的圆拱，并起来以后腰是实的
      const a = Math.max(0, Math.min(1, dy / ARCH));
      const arch = a * a * (3 - 2 * a);
      let belly = BAND * 4;
      let ribsD = BAND * 4;
      for (const f of fields) {
        if (w < 1) belly = smin(belly, seatUp(f.seat, x + f.lean * bend, y, z), BELLY_ROUND_MIN * arch + BELLY_ROUND * w);
        if (w > 0 && !f.carrier && near(f, x, y, z)) ribsD = smin(ribsD, fieldAt(f.field, x, y, z), round);
      }
      // 前后排之间的圆角把侧面那道缝填上（侧面并成一整块），但填出来的不许比不倒圆角时的正面轮廓更宽：腰侧不鼓包
      if (w < 1) belly = Math.max(belly, Math.abs(x) - sideAt(y, x < 0 ? 0 : 1));
      return Math.max(w <= 0 ? belly : w >= 1 ? ribsD : (1 - w) * belly + w * ribsD, CUT - y);
    }
    const s = Math.max(0, Math.min(1, (y - mix[0]) / (mix[1] - mix[0])));
    const w = s * s * (3 - 2 * s);
    for (const f of fields) {
      if (!near(f, x, y, z)) continue;
      if (f.carrier) {
        // 只有底下那副胯：照原样的躯干往上长到 CARRIER_TOP 截平，和两边的胸腔靠填沟连成上窄下宽的一整块
        d = smin(d, Math.max(fieldAt(f.seat, x, y, z), y - (mix[1] + CARRIER_TOP)), round);
        continue;
      }
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
  const close = opt('close', 0);
  if (close > 0) fillGrooves(data, dims, min, cell, close, opt('fill-from', split ? CUT + SEAT_TOP : mix[1]));
  if (split) polish(data, dims, min, cell, { ...POLISH, from: CUT + POLISH.from, all: opt('polish', POLISH.all), middle: opt('polish-mid', POLISH.middle), waist: opt('polish-waist', POLISH.waist) });

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
