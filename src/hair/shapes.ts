/**
 * 白模人台和二次元素体的头发：和成品角色换发型用的是同一批现成的头发（见 character/hair.ts），
 * 由 tools/build-hair.mjs 另做了一份没有贴图的——存成「到头发面片有多远」的三维格子，
 * 数据在 public/hair/<发型>.bin，尺寸在 hairMeta.json。离面片几毫米以内算实心，和头融合成一整块。
 *
 * 格子的坐标是二次元素体的头自己的坐标（原点在下巴和头顶的正中，面朝 +Z）：素体的头直接戴上，
 * 白模人台的头要照它的大小再压一压（见 geometry/wig.ts）。
 *
 * 这里只管把数据登记进 sdf/grids；数据怎么读进来（浏览器里 fetch、测试里读文件）由外面决定。
 */
import type { V3 } from '../geometry/vec';
import { fetchFile } from '../io/fetchFile';
import type { HairStyle } from '../model/spec';
import { hasGrid, registerGrid } from '../sdf/grids';
import meta from './hairMeta.json';

/** 能戴到白模头上的发型（「原装」是成品角色自己的头发，白模没有） */
export type HairShape = Exclude<HairStyle, 'own'>;

interface ShapeMeta {
  min: number[];
  dims: number[];
  length: number;
  bounds: { min: number[]; max: number[] };
}

const SHAPES = meta.grids as Record<HairShape, ShapeMeta>;

/** 登记时用的名字 */
export const hairGrid = (style: HairShape) => `hair/${style}`;

/** 数据文件的地址（相对网站根目录） */
export const hairShapeUrl = (style: HairShape) => `hair/${style}.bin`;

/** 这副头发占的范围（素体的头自己的坐标） */
export const hairBounds = (style: HairShape): { min: V3; max: V3 } => ({
  min: SHAPES[style].bounds.min as V3,
  max: SHAPES[style].bounds.max as V3,
});

/** 这副头发的数据登记好了没有 */
export const hairReady = (style: HairStyle): style is HairShape => style !== 'own' && hasGrid(hairGrid(style));

/** 把读进来的数据登记成格子。重复调用没有副作用 */
export function installHairShape(style: HairShape, buffer: ArrayBuffer) {
  const m = SHAPES[style];
  registerGrid(hairGrid(style), {
    min: m.min as V3,
    dims: m.dims as [number, number, number],
    cell: meta.cell,
    band: meta.band,
    data: new Int16Array(buffer, 0, m.length),
    bounds: { min: m.bounds.min as V3, max: m.bounds.max as V3 },
  });
}

const loading = new Map<HairShape, Promise<ArrayBuffer>>();

/**
 * 浏览器里用：把一副头发的数据取回来登记好，每副只取一次。
 * 返回取到的数据：网格是在 Worker 里算的，那边也要登记一份（见 sdf/meshClient 的 provideHair）。
 */
export function loadHairShape(style: HairShape, base = '/'): Promise<ArrayBuffer> {
  let pending = loading.get(style);
  if (!pending) {
    pending = fetchFile(`${base}${hairShapeUrl(style)}`, '头发数据')
      .then((buffer) => {
        installHairShape(style, buffer);
        return buffer;
      })
      .catch((err) => {
        loading.delete(style);
        throw err;
      });
    loading.set(style, pending);
  }
  return pending;
}
