// 把几个精细的人体素材上胸口、肚子、后背的起伏（锁骨、胸骨、肋弓、腹线、脊柱沟、肩胛、腰窝……）搬到二次元素体的躯干上：
//   node tools/run.mjs tools/build-torso.ts              改写 body.bin 里的 torso、torsoFlat
//   node tools/run.mjs tools/build-torso.ts --preview 目录  只出展开图（PGM），不改文件
//
// 素体的躯干是 VRoid 旧版的低模加密出来的，轮廓好、身材比例对，但表面几乎没有起伏，背上一大片平的。
// 手臂、腿、脖子、胸都是照这个躯干的轮廓接的，轮廓不能动：所以只搬「细节」——
// 1. 每个模型的躯干按「高度 × 绕身体竖轴的角度」展开成一张半径图（从这个高度上身体前后的正中往外量到表面多远）；
// 2. 参考模型照三个高度（裆、腰最细处、腋下）对齐到素体上，每个高度上左右、前后各缩放到和素体一样宽、一样厚；
// 3. 半径图减掉它自己模糊过的样子（高斯，BLUR）就是细节；几个参考模型的细节平均起来（各自的怪癖互相抵掉，共有的留下）；
// 4. 素体的半径换成「自己模糊过的样子 + 参考的细节」：素体自己那点低模的棱棱角角去掉，换成参考模型的起伏；
// 5. 胸那一片不搬（胸是另外接的，参考模型的胸会在平胸的躯干上留一圈印子），肩膀、脖子、腿根那里渐渐不搬（要和手臂、脖子、腿对得上）。
// 距离场上就是每个格点照它所在的高度、角度减掉半径的变化量。
//
// 要先跑 tools/build-anime-body.mjs（重写整个 body.bin），再跑这个，再跑 build-chest.ts --write（胸贴在平胸躯干上，照它量）。
// 跑过一次以后 bodyMeta.json 里记着 torsoDetail，再跑会拒绝（不然细节叠两遍）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { animeGrid, installAnimeBody } from '../src/anime/body';
import { getGrid, gridDist } from '../src/sdf/grids';

type V2 = [number, number];

const BIN = 'public/anime/body.bin';
const META = 'src/anime/bodyMeta.json';

/** 参考模型（Y 朝上）。flip：面朝 -Z 的（Blender 导出的），左右前后翻过来；unit：文件里一个单位是多少米（缺省 1） */
const REFERENCES = [
  { name: 'djp-sculpt', file: 'assets/source/djp/DJP Anime Base Sculpt.obj', flip: false, weight: 1 },
  { name: 'djp-01', file: 'assets/source/djp/DJP CC0 Free Base Mesh 01.obj', flip: false, weight: 1 },
  { name: 'blender-realistic', file: 'assets/source/blender-human-base-meshes/female_realistic.obj', flip: true, weight: 1 },
  // Fly_jkey 的「Woman」（Sketchfab，CC BY 4.0，要署名：src/anime/body.ts 的 TORSO_CREDIT，导出时自动写上）
  { name: 'sketchfab-woman', file: 'assets/source/sketchfab-woman/woman.obj', flip: false, weight: 1, unit: 0.01 },
];

/** 展开图：高度从 Y0 到 Y1（素体的坐标），每 DY 一行；角度一圈 COLS 列，0 是正前方，往 +X（角色的左手边）是正的 */
const Y0 = 0.86;
const Y1 = 1.33;
const DY = 0.004;
const COLS = 180;
/** 细节 = 半径图 − 高斯模糊过的半径图：模糊多宽（米，竖着、沿表面横着一样） */
const BLUR = 0.025;
/** 离表面多远以内叠细节、到多远渐渐不叠（米） */
const DEPTH = [0.012, 0.025];
/** 细节搬过来乘几 */
const GAIN = 1;
/** 遮罩（见 weight）：腿根往下（bottom 从哪到哪渐渐搬足）、脖子往上（top 从哪到哪渐渐不搬）、腋下往下 shoulder[0] 起往上 shoulder[1] 那么长渐渐不搬 */
const FADE = { bottom: [0.88, 0.93], top: [1.285, 1.32], shoulder: [0.06, 0.05] };
/**
 * 胸骨上窝（脖子根正前方）：正前方左右各 spread 弧度以内，从 y 起往上 rise 那么高渐渐不搬。
 * 参考模型这里是一个窝，往里推的话素体的躯干和脖子（另外一块格子）之间露出一个洞
 */
const NOTCH = { spread: 0.8, y: 1.22, rise: 0.04 };
/** 胸那一片（正前方左右各 spread 弧度、高度 y 上下各 height 米的椭圆）：两个胸连同中间那道沟（素体的胸、参考模型的胸都在 ±30° 上下） */
const BREAST = { spread: 1.65, y: 1.16, height: 0.09 };
/** 量躯干的宽、厚、前后中心时沿高度抹平多宽（米） */
const PROFILE_BLUR = 0.02;
/** 细节里比这还窄的抹掉（高斯，米） */
const FINE = 0.008;
/** 细节最多推进、拉出多少（米） */
const LIMIT = 0.008;

const ROWS = Math.round((Y1 - Y0) / DY) + 1;
const angle = (j: number) => (j / COLS) * 2 * Math.PI - Math.PI;

/* ---------------- 参考模型：读进来、按高度切片 ---------------- */

interface Mesh {
  verts: Float64Array;
  tris: Uint32Array;
}

function readObj(file: string, flip: boolean, unit = 1): Mesh {
  const vs: number[] = [];
  const ts: number[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.trim().split(/\s+/);
      vs.push((flip ? -x : +x) * unit, +y * unit, (flip ? -z : +z) * unit);
    } else if (line.startsWith('f ')) {
      const ids = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t.split('/')[0], 10) - 1);
      for (let k = 1; k + 1 < ids.length; k++) ts.push(ids[0], ids[k], ids[k + 1]);
    }
  }
  // 脚底踩在 0，左右居中
  let lo = Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < vs.length; i += 3) {
    lo = Math.min(lo, vs[i + 1]);
    minX = Math.min(minX, vs[i]);
    maxX = Math.max(maxX, vs[i]);
  }
  const cx = (minX + maxX) / 2;
  for (let i = 0; i < vs.length; i += 3) {
    vs[i] -= cx;
    vs[i + 1] -= lo;
  }
  return { verts: Float64Array.from(vs), tris: Uint32Array.from(ts) };
}

/** 一个高度上的截面：一段段线段（x0, z0, x1, z1） */
function slicer(mesh: Mesh): (y: number) => Float64Array {
  const { verts: v, tris: t } = mesh;
  // 三角形按高度分桶（每桶 1 厘米）
  const buckets = new Map<number, number[]>();
  for (let f = 0; f < t.length; f += 3) {
    const ys = [v[t[f] * 3 + 1], v[t[f + 1] * 3 + 1], v[t[f + 2] * 3 + 1]];
    for (let b = Math.floor(Math.min(...ys) / 0.01); b <= Math.floor(Math.max(...ys) / 0.01); b++) (buckets.get(b) ?? buckets.set(b, []).get(b)!).push(f);
  }
  return (y) => {
    const out: number[] = [];
    for (const f of buckets.get(Math.floor(y / 0.01)) ?? []) {
      const p: number[] = [];
      for (let e = 0; e < 3; e++) {
        const a = t[f + e] * 3;
        const b = t[f + ((e + 1) % 3)] * 3;
        const ya = v[a + 1] - y;
        const yb = v[b + 1] - y;
        if ((ya < 0) === (yb < 0)) continue;
        const s = ya / (ya - yb);
        p.push(v[a] + (v[b] - v[a]) * s, v[a + 2] + (v[b + 2] - v[a + 2]) * s);
      }
      if (p.length === 4) out.push(...p);
    }
    return Float64Array.from(out);
  };
}

/** 截面上从 (cx, cz) 沿 (dx, dz) 走多远出去（最近的交点）；没交点是 NaN */
function rayOut(segs: Float64Array, cx: number, cz: number, dx: number, dz: number): number {
  let best = Infinity;
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i] - cx;
    const az = segs[i + 1] - cz;
    const ex = segs[i + 2] - segs[i];
    const ez = segs[i + 3] - segs[i + 1];
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (ax * ez - az * ex) / den;
    const u = (ax * dz - az * dx) / den;
    if (t > 1e-6 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best === Infinity ? NaN : best;
}

/** 截面上 x = 0 那条线前后各到哪：前后正中（量半径的中心）、厚度 */
function middle(segs: Float64Array, guess: number): { cz: number; depth: number } {
  const front = rayOut(segs, 0, guess, 0, 1);
  const back = rayOut(segs, 0, guess, 0, -1);
  if (!Number.isFinite(front) || !Number.isFinite(back)) return { cz: guess, depth: NaN };
  const cz = guess + (front - back) / 2;
  return { cz, depth: front + back };
}

/** 一个截面里，中心是不是在身体里面（往 +X 打一条射线，交点数奇偶） */
function inside(segs: Float64Array, cx: number, cz: number): boolean {
  let n = 0;
  for (let i = 0; i < segs.length; i += 4) {
    const z0 = segs[i + 1] - cz;
    const z1 = segs[i + 3] - cz;
    if ((z0 < 0) === (z1 < 0)) continue;
    const x = segs[i] + (segs[i + 2] - segs[i]) * (z0 / (z0 - z1));
    if (x > cx) n++;
  }
  return n % 2 === 1;
}

/* ---------------- 三个高度：裆、腰、腋下 ---------------- */

interface Profile {
  /** 从下往上每隔 1 毫米：左右半宽（往 ±X 量的平均）、前后正中、厚度、中心在不在身体里 */
  ys: number[];
  half: number[];
  cz: number[];
  depth: number[];
  solid: boolean[];
}

function profileOf(at: (y: number) => { half: number; cz: number; depth: number; solid: boolean }, from: number, to: number): Profile {
  const p: Profile = { ys: [], half: [], cz: [], depth: [], solid: [] };
  for (let y = from; y <= to; y += 0.001) {
    const s = at(y);
    p.ys.push(y);
    p.half.push(s.half);
    p.cz.push(s.cz);
    p.depth.push(s.depth);
    p.solid.push(s.solid);
  }
  return p;
}

/**
 * 沿高度抹平（PROFILE_BLUR）的一份：正中线上的肚脐、腹沟会让量出来的厚度、前后中心一下子跳一截，展开图上一道横线。
 * 找裆、腰、腋下用没抹平的（腋下靠的就是半宽一下子跳出去）
 */
function smoothProfile(p: Profile): Profile {
  return { ...p, half: smoothed(p.half, PROFILE_BLUR / 0.001), cz: smoothed(p.cz, PROFILE_BLUR / 0.001), depth: smoothed(p.depth, PROFILE_BLUR / 0.001) };
}

/** 一串数按高斯抹平（sigma 按个数），NaN 的不算 */
function smoothed(list: number[], sigma: number): number[] {
  const k = Math.ceil(sigma * 3);
  return list.map((_, i) => {
    let s = 0;
    let w = 0;
    for (let d = -k; d <= k; d++) {
      const v = list[i + d];
      if (v === undefined || Number.isNaN(v)) continue;
      const g = Math.exp(-(d * d) / (2 * sigma * sigma));
      s += v * g;
      w += g;
    }
    return w ? s / w : NaN;
  });
}

/** 裆（中心从这里往上都在身体里）、腋下（往上左右半宽一下子跳出去：手臂接上了）、腰（两者之间最细的地方） */
function landmarks(p: Profile): { crotch: number; waist: number; armpit: number } {
  // 从下往上第一个「往上 5 厘米都在身体里」的高度
  let c = 0;
  for (let i = 0; i + 50 < p.ys.length; i++) {
    let ok = true;
    for (let k = i; k <= i + 50 && ok; k++) ok = p.solid[k];
    if (ok) { c = i; break; }
  }
  let a = p.ys.length - 1;
  for (let i = c + 50; i + 8 < p.ys.length; i++) {
    if (p.half[i + 8] > p.half[i] * 1.25 + 0.01) { a = i; break; }
  }
  let w = c;
  const lo = c + Math.round((a - c) * 0.25);
  const hi = a - Math.round((a - c) * 0.25);
  for (let i = lo; i <= hi; i++) if (p.half[i] < p.half[w] || w < lo) w = i;
  return { crotch: p.ys[c], waist: p.ys[w], armpit: p.ys[a] };
}

/** 照三个高度分段线性对应：素体的高度 y → 参考模型的高度 */
function heightMap(from: { crotch: number; waist: number; armpit: number }, to: { crotch: number; waist: number; armpit: number }) {
  const a = [from.crotch, from.waist, from.armpit];
  const b = [to.crotch, to.waist, to.armpit];
  return (y: number) => {
    const k = y < a[1] ? 0 : 1;
    return b[k] + ((y - a[k]) * (b[k + 1] - b[k])) / (a[k + 1] - a[k]);
  };
}

/* ---------------- 展开图 ---------------- */

const blank = () => new Float64Array(ROWS * COLS).fill(NaN);
const cell = (i: number, j: number) => i * COLS + ((j % COLS) + COLS) % COLS;

/** 高斯模糊（竖着按米，横着按这一行的平均半径换算成弧长；radii 是量半径用的那张图，不给就是 map 自己）；NaN 的格子不算 */
function blurred(map: Float64Array, sigma: number, radii?: Float64Array): Float64Array {
  const out = blank();
  const tmp = blank();
  const sy = sigma / DY;
  const ky = Math.ceil(sy * 3);
  for (let j = 0; j < COLS; j++) {
    for (let i = 0; i < ROWS; i++) {
      let s = 0;
      let w = 0;
      for (let d = -ky; d <= ky; d++) {
        const v = map[cell(Math.min(ROWS - 1, Math.max(0, i + d)), j)];
        if (Number.isNaN(v)) continue;
        const g = Math.exp(-(d * d) / (2 * sy * sy));
        s += v * g;
        w += g;
      }
      tmp[cell(i, j)] = w ? s / w : NaN;
    }
  }
  for (let i = 0; i < ROWS; i++) {
    let mean = 0;
    let n = 0;
    const ruler = radii ?? tmp;
    for (let j = 0; j < COLS; j++) if (!Number.isNaN(ruler[cell(i, j)])) (mean += ruler[cell(i, j)]), n++;
    mean = n ? mean / n : 0.1;
    const sx = sigma / ((mean * 2 * Math.PI) / COLS);
    const kx = Math.ceil(sx * 3);
    for (let j = 0; j < COLS; j++) {
      let s = 0;
      let w = 0;
      for (let d = -kx; d <= kx; d++) {
        const v = tmp[cell(i, j + d)];
        if (Number.isNaN(v)) continue;
        const g = Math.exp(-(d * d) / (2 * sx * sx));
        s += v * g;
        w += g;
      }
      out[cell(i, j)] = w ? s / w : NaN;
    }
  }
  return out;
}

/** 写一张灰度图（PGM）：细节 ±LIMIT 对应黑到白，NaN 是灰 */
function writeMap(file: string, map: Float64Array, range = LIMIT) {
  const pix = Buffer.alloc(ROWS * COLS);
  for (let i = 0; i < ROWS; i++) {
    for (let j = 0; j < COLS; j++) {
      const v = map[cell(i, j)];
      // 图上：上面是高处，正中是正前方，左右两边是后背
      pix[(ROWS - 1 - i) * COLS + j] = Number.isNaN(v) ? 128 : Math.max(0, Math.min(255, Math.round(128 + (v / range) * 127)));
    }
  }
  writeFileSync(file, Buffer.concat([Buffer.from(`P5\n${COLS} ${ROWS}\n255\n`), pix]));
}

export function main(args: string[], root: string) {
  const previewAt = args.indexOf('--preview');
  const preview = previewAt >= 0 ? args[previewAt + 1] : null;
  const meta = JSON.parse(readFileSync(join(root, META), 'utf8'));
  if (meta.torsoDetail && !preview) throw new Error('body.bin 里的躯干已经叠过细节了：先重跑 tools/build-anime-body.mjs');
  const bin = readFileSync(join(root, BIN));
  installAnimeBody(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer);
  const flat = gridDist(getGrid(animeGrid('torsoFlat'))).fn;

  /* 素体：在平胸的躯干的距离场上打射线 */
  const march = (cx: number, y: number, cz: number, dx: number, dz: number): number => {
    if (flat(cx, y, cz) > 0) return NaN;
    let t = 0;
    while (t < 0.4 && flat(cx + dx * t, y, cz + dz * t) < 0) t += 0.002;
    if (t >= 0.4) return NaN;
    let lo = t - 0.002;
    let hi = t;
    for (let k = 0; k < 20; k++) {
      const m = (lo + hi) / 2;
      if (flat(cx + dx * m, y, cz + dz * m) < 0) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  const centerOf = (y: number): { cz: number; depth: number } => {
    let cz = 0.01;
    for (let k = 0; k < 3; k++) {
      const f = march(0, y, cz, 0, 1);
      const b = march(0, y, cz, 0, -1);
      if (!Number.isFinite(f) || !Number.isFinite(b)) return { cz, depth: NaN };
      cz += (f - b) / 2;
      if (Math.abs(f - b) < 1e-4) return { cz, depth: f + b };
    }
    return { cz, depth: march(0, y, cz, 0, 1) + march(0, y, cz, 0, -1) };
  };
  const target = profileOf(
    (y) => {
      const { cz, depth } = centerOf(y);
      const solid = flat(0, y, cz) < 0;
      return { cz, depth, solid, half: (march(0, y, cz, 1, 0) + march(0, y, cz, -1, 0)) / 2 };
    },
    0.75,
    1.33,
  );
  // 素体的躯干在肩关节那里就切开了（手臂另外接），腋下没有「一下子跳出去」：取腰往上半宽最大的地方
  const tMarks = landmarks(target);
  const tSmooth = smoothProfile(target);
  {
    let best = -1;
    for (let i = 0; i < target.ys.length; i++) if (target.ys[i] > tMarks.waist && target.ys[i] < 1.27 && (best < 0 || target.half[i] > target.half[best])) best = i;
    tMarks.armpit = target.ys[best];
  }
  console.log('素体', fmt(tMarks));
  const czAt = (p: Profile, y: number) => p.cz[Math.max(0, Math.min(p.ys.length - 1, Math.round((y - p.ys[0]) / 0.001)))];
  const at = (p: Profile, key: 'half' | 'depth', y: number) => p[key][Math.max(0, Math.min(p.ys.length - 1, Math.round((y - p.ys[0]) / 0.001)))];

  // 素体自己的半径图
  const own = blank();
  for (let i = 0; i < ROWS; i++) {
    const y = Y0 + i * DY;
    const cz = czAt(tSmooth, y);
    for (let j = 0; j < COLS; j++) own[cell(i, j)] = march(0, y, cz, Math.sin(angle(j)), Math.cos(angle(j)));
  }
  const ownBlur = blurred(own, BLUR);
  const ownDetail = own.map((v, k) => v - ownBlur[k]);

  /* 参考模型 */
  const details: { name: string; weight: number; map: Float64Array }[] = [];
  for (const ref of REFERENCES) {
    const t0 = performance.now();
    const mesh = readObj(join(root, ref.file), ref.flip, 'unit' in ref ? ref.unit : 1);
    const slice = slicer(mesh);
    let guess = 0;
    const prof = profileOf(
      (y) => {
        const segs = slice(y);
        const m = middle(segs, guess);
        if (Number.isFinite(m.depth)) guess = m.cz;
        const half = (rayOut(segs, 0, m.cz, 1, 0) + rayOut(segs, 0, m.cz, -1, 0)) / 2;
        return { cz: m.cz, depth: m.depth, half, solid: segs.length > 0 && inside(segs, 0, m.cz) };
      },
      0.3,
      1.6,
    );
    const rMarks = landmarks(prof);
    const pSmooth = smoothProfile(prof);
    const toRef = heightMap(tMarks, rMarks);
    // 左右、前后的缩放：腋下往上手臂接上了、量不准，照腋下往下 1 厘米那里的
    const scaleAt = (y: number) => {
      const yt = Math.min(y, tMarks.armpit - 0.01);
      const yr = toRef(yt);
      return { sx: at(tSmooth, 'half', yt) / at(pSmooth, 'half', yr), sz: at(tSmooth, 'depth', yt) / at(pSmooth, 'depth', yr) };
    };
    const map = blank();
    for (let i = 0; i < ROWS; i++) {
      const y = Y0 + i * DY;
      const yr = toRef(y);
      const segs = slice(yr);
      const cz = czAt(pSmooth, yr);
      const { sx, sz } = scaleAt(y);
      for (let j = 0; j < COLS; j++) {
        const a = angle(j);
        // 素体上朝 a 那个方向，在参考模型上（左右、前后各压回去以后）是哪个方向
        let dx = Math.sin(a) / sx;
        let dz = Math.cos(a) / sz;
        const n = Math.hypot(dx, dz);
        dx /= n;
        dz /= n;
        const t = rayOut(segs, 0, cz, dx, dz);
        map[cell(i, j)] = Number.isFinite(t) ? Math.hypot(t * dx * sx, t * dz * sz) : NaN;
      }
    }
    const blur = blurred(map, BLUR);
    const detail = map.map((v, k) => v - blur[k]);
    details.push({ name: ref.name, weight: ref.weight, map: detail });
    console.log(`${ref.name}`, fmt(rMarks), `${Math.round(performance.now() - t0)} ms`);
    if (preview) {
      mkdirSync(preview, { recursive: true });
      writeMap(join(preview, `${ref.name}.pgm`), detail);
    }
  }
  // 几个参考模型的细节平均，限在 ±LIMIT；素体的半径换成「自己模糊过的 + 参考的细节」：变化量 = (参考的细节 − 自己的细节) × 遮罩
  // 太窄的（FINE 以下）先抹掉：参考模型侧面有几道很细的接缝、凹槽，5 毫米的格子表现不出来，只会在侧面留一道折痕
  const mean = blurred(
    blank().map((_, k) => {
      let s = 0;
      let w = 0;
      for (const d of details) if (!Number.isNaN(d.map[k])) (s += d.map[k] * d.weight), (w += d.weight);
      return w ? Math.max(-LIMIT, Math.min(LIMIT, s / w)) : NaN;
    }),
    FINE,
    own,
  );
  const mask = blank();
  const change = blank();
  for (let i = 0; i < ROWS; i++) {
    const y = Y0 + i * DY;
    for (let j = 0; j < COLS; j++) {
      const k = cell(i, j);
      mask[k] = weight(y, angle(j), tMarks.armpit);
      change[k] = Number.isNaN(mean[k]) || Number.isNaN(ownDetail[k]) ? 0 : (mean[k] - ownDetail[k]) * mask[k] * GAIN;
    }
  }
  if (preview) {
    mkdirSync(preview, { recursive: true });
    writeMap(join(preview, 'own.pgm'), ownDetail);
    writeMap(join(preview, 'mean.pgm'), mean);
    writeMap(join(preview, 'mask.pgm'), mask.map((v) => v * 2 - 1), 1);
    writeMap(join(preview, 'change.pgm'), change);
    console.log('展开图写到', preview);
    return;
  }

  /* 改写距离场：每个格点照它的高度、角度减掉半径的变化量（变化量是正的，表面往外挪） */
  const czOf = (y: number) => czAt(tSmooth, y);
  const sample = (y: number, a: number) => {
    const fi = (y - Y0) / DY;
    if (fi <= 0 || fi >= ROWS - 1) return 0;
    const fj = ((a + Math.PI) / (2 * Math.PI)) * COLS;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const u = fi - i;
    const v = fj - j;
    return (change[cell(i, j)] * (1 - v) + change[cell(i, j + 1)] * v) * (1 - u) + (change[cell(i + 1, j)] * (1 - v) + change[cell(i + 1, j + 1)] * v) * u;
  };
  let out = bin;
  for (const name of ['torso', 'torsoFlat']) {
    const g = meta.grids[name];
    const [nx, ny, nz] = g.dims as [number, number, number];
    const data = new Int16Array(out.buffer.slice(out.byteOffset + g.offset * 2, out.byteOffset + (g.offset + g.length) * 2));
    let most = 0;
    for (let kz = 0; kz < nz; kz++) {
      const z = g.min[2] + kz * g.cell;
      for (let ky = 0; ky < ny; ky++) {
        const y = g.min[1] + ky * g.cell;
        if (y <= Y0 || y >= Y1) continue;
        const cz = czOf(y);
        for (let kx = 0; kx < nx; kx++) {
          const x = g.min[0] + kx * g.cell;
          const id = kx + nx * (ky + ny * kz);
          const old = (data[id] / 32767) * meta.band;
          // 只在表面附近叠（DEPTH）：离竖轴近的地方角度一变细节量就变，躯干深处跟着减的话距离场的坡度超过 1，往里打射线会冲过表面
          const near = 1 - Math.min(1, Math.max(0, (Math.abs(old) - DEPTH[0]) / (DEPTH[1] - DEPTH[0])));
          const dr = near && sample(y, Math.atan2(x, z - cz)) * near * near * (3 - 2 * near);
          if (!dr) continue;
          const d = old - dr;
          data[id] = Math.round((Math.max(-meta.band, Math.min(meta.band, d)) / meta.band) * 32767);
          most = Math.max(most, Math.abs(dr));
        }
      }
    }
    const bytes = Buffer.from(data.buffer);
    out = Buffer.concat([out.subarray(0, g.offset * 2), bytes, out.subarray((g.offset + g.length) * 2)]);
    console.log(`${name}：最多挪 ${(most * 1000).toFixed(1)} 毫米`);
  }
  meta.torsoDetail = { references: REFERENCES.map((r) => r.file), blur: BLUR, limit: LIMIT, gain: GAIN };
  writeFileSync(join(root, BIN), out);
  writeFileSync(join(root, META), `${JSON.stringify(meta, null, 1)}
`);
  console.log('写好了：接着跑 node tools/run.mjs tools/build-chest.ts --write（胸的展开图和胸型照新的躯干重算）');
}

/**
 * 哪里搬细节（0–1）：y 是素体的高度，a 是角度（0 正前方），armpit 是腋下的高度。
 * - 腿根往下、脖子往上渐渐不搬（要和腿、脖子的格子对得上）；
 * - 腋下往上、身体两侧渐渐不搬（肩膀那一截接手臂）；参考模型在那里量到的是它自己的手臂根；
 * - 胸那一片不搬：胸另外接，参考模型自己的胸（还有素体原样躯干上的胸）在平胸上会留一圈印子
 */
function weight(y: number, a: number, armpit: number): number {
  const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const front = Math.cos(a);
  const side = Math.abs(Math.sin(a));
  let w = ease((y - FADE.bottom[0]) / (FADE.bottom[1] - FADE.bottom[0])) * (1 - ease((y - FADE.top[0]) / (FADE.top[1] - FADE.top[0])));
  w *= 1 - ease((y - (armpit - FADE.shoulder[0])) / FADE.shoulder[1]) * ease((side - 0.45) / 0.35);
  if (front > 0) {
    w *= 1 - ease((y - NOTCH.y) / NOTCH.rise) * (1 - ease((Math.abs(a) - NOTCH.spread * 0.6) / (NOTCH.spread * 0.4)));
    const da = a / BREAST.spread;
    const dy = (y - BREAST.y) / BREAST.height;
    const r = Math.hypot(da, dy);
    w *= ease((r - 0.85) / 0.35);
  }
  return w;
}

const fmt = (m: { crotch: number; waist: number; armpit: number }) => `裆 ${m.crotch.toFixed(3)} 腰 ${m.waist.toFixed(3)} 腋下 ${m.armpit.toFixed(3)}`;
