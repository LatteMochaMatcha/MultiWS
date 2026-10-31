/**
 * 第二种身体：二次元少女素体。
 * 形状来自 VRoid Studio 旧版自带的女性基础模型（pixiv 以 CC0 发布），
 * 由 tools/build-anime-body.mjs 加工成距离场：数据在 public/anime/body.bin，尺寸和关节在 bodyMeta.json。
 *
 * 这里只管把数据登记进 sdf/grids；数据怎么读进来（浏览器里 fetch、测试里读文件）由外面决定。
 */
import type { V3 } from '../geometry/vec';
import { fetchFile } from '../io/fetchFile';
import { type Grid, getGrid, gridDist, hasGrid, registerGrid } from '../sdf/grids';
import meta from './bodyMeta.json';

/**
 * 素体拆成的几块。torsoFlat 是平胸的躯干（格子和 torso 一模一样，两份之间可以逐格混合），
 * headBare 是去掉人耳的头（加了兽耳、精灵耳时用）。
 */
export type AnimePiece = 'torso' | 'torsoFlat' | 'head' | 'headBare' | 'neck' | 'bust' | 'arm' | 'leg';

interface PieceMeta {
  /** 这一块自己的原点（关节）在模型里的位置 */
  origin: number[];
  min: number[];
  dims: number[];
  cell: number;
  bounds: { min: number[]; max: number[] };
  /** 切口上封的盖子：中心（相对 origin）和大小 */
  caps: { center: number[]; radius: number }[];
  offset: number;
  length: number;
}

const PIECES = meta.grids as Record<AnimePiece, PieceMeta>;

/** 登记时用的名字 */
export const animeGrid = (piece: AnimePiece) => `anime/${piece}`;

/** 模型本来的身高，以及头顶、下巴、脸最前面、后脑勺的位置（米） */
export const ANIME_HEIGHT = meta.height;
export const ANIME_HEAD = meta.head;

/** 某一块自己的原点在模型里的位置 */
export const animeOrigin = (piece: AnimePiece): V3 => PIECES[piece].origin as V3;

/** 某一块的表面占的范围，写在这一块自己的坐标里 */
export const animeBounds = (piece: AnimePiece): { min: V3; max: V3 } => ({
  min: PIECES[piece].bounds.min as V3,
  max: PIECES[piece].bounds.max as V3,
});

/** 某一块的切口（封口的盖子）中心在哪、有多大，写在这一块自己的坐标里 */
export const animeCaps = (piece: AnimePiece): { center: V3; radius: number }[] =>
  PIECES[piece].caps.map((cap) => ({ center: cap.center as V3, radius: cap.radius }));

/** 关节在模型里的位置。名字是 VRoid 的骨骼名去掉前缀，例如 L_UpperArm、C_Hips */
export function animeJoint(name: string): V3 {
  const joints = meta.joints as Record<string, number[]>;
  const p = joints[`J_Bip_${name}`] ?? joints[`J_Sec_${name}`];
  if (!p) throw new Error(`素体里没有关节 ${name}`);
  return p as V3;
}

/** 数据文件的地址（相对网站根目录） */
export const ANIME_BODY_URL = 'anime/body.bin';

/** 数据登记好了没有 */
export const animeReady = () => hasGrid(animeGrid('torso'));

/** 把读进来的数据登记成一块块格子。重复调用没有副作用 */
export function installAnimeBody(buffer: ArrayBuffer) {
  const all = new Int16Array(buffer);
  for (const [piece, m] of Object.entries(PIECES) as [AnimePiece, PieceMeta][]) {
    registerGrid(animeGrid(piece), {
      min: m.min as V3,
      dims: m.dims as [number, number, number],
      cell: m.cell,
      band: meta.band,
      data: all.subarray(m.offset, m.offset + m.length),
      bounds: { min: m.bounds.min as V3, max: m.bounds.max as V3 },
    });
  }
  registerGrid(BUST_LARGE, largeBust(getGrid(animeGrid('bust')), animeCaps('bust')[0]));
}

/**
 * 大胸的胸型（见 largeBust）：格子和 bust 一模一样，两份之间可以逐格混合（GridShape.morph）。
 * 胸往大调时渐渐换成它：bust 是从素体上切下来的一块小胸，照原样放大是一个放大的尖圆锥，前面平、上下一样厚，
 * 背面那块薄盖子还从锁骨上、腋下支出来，看着是个空壳
 */
export const BUST_LARGE = 'anime/bustLarge';

/**
 * 大胸的样子，按 bust 背面盖子的大小（R）和朝向摆（都是工坊自己拼的形状，不来自素材）：
 * - 下半截一个圆球，比盖子正中低一点、往外一点：饱满、往下坠，正面看是圆的，侧面看下沿是一道圆弧（乳房下缘的褶）；
 * - 上半截一个扁的，从盖子上沿顺着胸口斜下来接到圆球上（上坡是平缓的，不是圆锥）；
 * - 背面垫一个扁椭球埋在胸口里（实心，放大以后背面也是圆的，不会露出空壳）。
 * 三块圆滑地融在一起。原样大小时和 bust 差不多大（往前凸出差不多一样多）
 */
const LARGE = {
  ball: { center: [0.07, -0.22, 0.22], radii: [0.7, 0.64, 0.46] },
  slope: { center: [0.02, 0.36, 0.05], radii: [0.56, 0.5, 0.26] },
  pad: { center: [0, 0, -0.25], radii: [0.76, 0.76, 0.5] },
  soft: 0.27,
} as const;

function largeBust(bust: Grid, cap: { center: V3; radius: number }): Grid {
  const skin = gridDist(bust).fn;
  // 盖子中心那里的法线（朝身体里）；往前 f、往上 u、往外 l
  const e = bust.cell / 2;
  const [cx, cy, cz] = cap.center;
  const n = unit([
    skin(cx + e, cy, cz) - skin(cx - e, cy, cz),
    skin(cx, cy + e, cz) - skin(cx, cy - e, cz),
    skin(cx, cy, cz + e) - skin(cx, cy, cz - e),
  ]);
  const f: V3 = [-n[0], -n[1], -n[2]];
  const u = unit([-f[1] * f[0], 1 - f[1] * f[1], -f[1] * f[2]]);
  const l = cross(u, f);
  const R = cap.radius;
  /** 一块椭球：中心、三个半径都照 l、u、f 和 R 写 */
  const blobs = [LARGE.ball, LARGE.slope, LARGE.pad].map(({ center, radii }) => ({
    at: [0, 1, 2].map((k) => cap.center[k] + (l[k] * center[0] + u[k] * center[1] + f[k] * center[2]) * R) as V3,
    r: radii.map((v) => v * R) as V3,
  }));
  const k = LARGE.soft * R;
  const [nx, ny, nz] = bust.dims;
  const unitQ = bust.band / 32767;
  const data = new Int16Array(bust.data.length);
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let kz = 0; kz < nz; kz++) {
    for (let ky = 0; ky < ny; ky++) {
      for (let kx = 0; kx < nx; kx++) {
        const p: V3 = [bust.min[0] + kx * bust.cell, bust.min[1] + ky * bust.cell, bust.min[2] + kz * bust.cell];
        let d = Infinity;
        for (const { at, r } of blobs) {
          const q: V3 = [p[0] - at[0], p[1] - at[1], p[2] - at[2]];
          // 椭球的距离（近似：k0·(k0 − 1)/k1）
          const a = dot(q, l) / r[0];
          const b = dot(q, u) / r[1];
          const c = dot(q, f) / r[2];
          const k0 = Math.hypot(a, b, c);
          const k1 = Math.hypot(a / r[0], b / r[1], c / r[2]);
          const one = k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r);
          const h = Math.max(k - Math.abs(d - one), 0) / k;
          d = Math.min(d, one) - (h * h * k) / 4;
        }
        data[kx + nx * (ky + ny * kz)] = Math.max(-32767, Math.min(32767, Math.round(d / unitQ)));
        if (d < 0) {
          for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], p[i] - bust.cell);
            max[i] = Math.max(max[i], p[i] + bust.cell);
          }
        }
      }
    }
  }
  return { ...bust, data, bounds: { min, max } };
}

const dot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const unit = (p: V3): V3 => {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
};

let loading: Promise<ArrayBuffer> | null = null;

/**
 * 浏览器里用：把数据文件取回来登记好，只取一次。
 * 返回取到的数据：网格是在 Worker 里算的，那边也要登记一份（见 sdf/meshClient 的 provideShapes）。
 */
export function loadAnimeBody(base = '/'): Promise<ArrayBuffer> {
  loading ??= fetchFile(`${base}${ANIME_BODY_URL}`, '素体数据')
    .then((buffer) => {
      installAnimeBody(buffer);
      return buffer;
    })
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}
