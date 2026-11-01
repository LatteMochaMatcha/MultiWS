/**
 * 第二种身体：二次元少女素体。
 * 形状来自 VRoid Studio 旧版自带的女性基础模型（pixiv 以 CC0 发布），
 * 由 tools/build-anime-body.mjs 加工成距离场：数据在 public/anime/body.bin，尺寸和关节在 bodyMeta.json。
 *
 * 这里只管把数据登记进 sdf/grids；数据怎么读进来（浏览器里 fetch、测试里读文件）由外面决定。
 */
import type { V3 } from '../geometry/vec';
import { fetchFile } from '../io/fetchFile';
import { hasGrid, registerGrid } from '../sdf/grids';
import { type ChestKind, type ChestPatch, registerChest } from './chest';
import meta from './bodyMeta.json';

/**
 * 素体拆成的几块。torsoFlat 是平胸的躯干（格子和 torso 一模一样，两份之间可以逐格混合），headBare 是去掉人耳的头。
 * 胸不是单独的一块格子，是贴在平胸躯干表面上的一层（见 anime/chest.ts），数据也在 body.bin 里（bodyMeta.json 的 chest）
 */
export type AnimePiece = 'torso' | 'torsoFlat' | 'head' | 'headBare' | 'neck' | 'arm' | 'leg';

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

interface ChestMeta {
  frame: { y0: number; dy: number; rows: number; cols: number; unit: number; offset: number };
  patches: Record<ChestKind, Omit<ChestPatch, 'data' | 'center'> & { center: number[]; offset: number }>;
}

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
  // 胸：展开图（每行前后正中、每格半径、每格弧长）和两种胸型（tools/build-chest.ts 写进来的；没跑过的话没有胸）
  const chest = (meta as { chest?: ChestMeta }).chest;
  if (!chest) return;
  const { frame, patches } = chest;
  const n = frame.rows * frame.cols;
  const read = (from: number, count: number) => Float64Array.from(all.subarray(from, from + count), (v) => v * frame.unit);
  const patch = (p: ChestMeta['patches'][ChestKind]): ChestPatch => ({ ...p, center: [p.center[0], p.center[1]], data: all.subarray(p.offset, p.offset + p.nu * p.nv * p.nh) });
  registerChest(
    { ...frame, zc: read(frame.offset, frame.rows), r: read(frame.offset + frame.rows, n), s: read(frame.offset + frame.rows + n, n) },
    // 长大的大胸型（grown）是后来加的：重新跑 build-chest.ts 之前的数据里没有，先拿大胸型顶着
    { reference: patch(patches.reference), large: patch(patches.large), grown: patch(patches.grown ?? patches.large) },
  );
}

/** 躯干上的起伏（tools/build-torso.ts）参考了的素材里要求署名的那个（CC BY 4.0）：导出时和脚的署名一起写进去 */
export const TORSO_CREDIT = '躯干起伏参考了「Woman」© Fly_jkey（sketchfab.com/3d-models/woman-b303b7606140480f8335cda121b9607c），CC BY 4.0';

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
