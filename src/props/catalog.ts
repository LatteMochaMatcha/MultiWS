/**
 * 道具素材的清单（见 docs/props-plan.md）。纯数据，不读文件：存档、测试都能直接用。网格怎么读见 library.ts。
 *
 * - 低模家具（PROP_ASSETS）：随安装包走，网格都在 public/props/lowpoly.bin 里，
 *   每件的编号、分组、原样多大由 tools/build-props.ts 写进 lowpolyMeta.json。
 * - 写实款（REAL_ASSETS）：带贴图，不进安装包，一件一个文件放在下载站上，用到哪件才下哪件（见 realLoad.ts）；
 *   清单由 tools/build-props-real.ts 写进 realMeta.json。
 */
import type { Vec3 } from '../model/spec';
import meta from './lowpolyMeta.json';
import real from './realMeta.json';

/** 道具栏里照这个顺序分组：坐的、躺的、桌柜、别的 */
export const PROP_ASSET_GROUPS = ['seat', 'bed', 'table', 'other'] as const;
export type PropAssetGroup = (typeof PROP_ASSET_GROUPS)[number];

/** 两种素材都有的几项 */
export interface PropAssetInfo {
  id: string;
  group: PropAssetGroup;
  /** 原样多大：宽、高、深（米）。新放的就是这么大 */
  size: Vec3;
  vertices: number;
  triangles: number;
}

export interface PropAsset extends PropAssetInfo {
  /** 在 lowpoly.bin 里从第几个字节开始 */
  at: number;
}

export interface RealAsset extends PropAssetInfo {
  /** 文件多少字节（下载前告诉用户、下完核对） */
  bytes: number;
  /** 文件内容的 SHA-256（十六进制）：在下载站上就叫这个名字，下完核对 */
  sha256: string;
}

export const PROP_ASSETS = meta.assets as unknown as readonly PropAsset[];
/** lowpoly.bin 应该有多少字节（读的时候核对，旧缓存、下了一半的不认） */
export const PROP_ASSET_BYTES: number = meta.bytes;

export const REAL_ASSETS = real.assets as unknown as readonly RealAsset[];
/** 写实款的文件在下载站的哪个目录下（后面接文件的 SHA-256） */
export const REAL_STORE: string = real.store;

const byId = new Map<string, PropAssetInfo>([...PROP_ASSETS, ...REAL_ASSETS].map((a) => [a.id, a]));
const realById = new Map(REAL_ASSETS.map((a) => [a.id, a]));

/** 清单里的一件素材（低模、写实都算） */
export const propAsset = (id: unknown): PropAssetInfo | undefined => (typeof id === 'string' ? byId.get(id) : undefined);

/** 这个编号是写实款的话，它在清单里的那一条 */
export const realAsset = (id: unknown): RealAsset | undefined => (typeof id === 'string' ? realById.get(id) : undefined);
