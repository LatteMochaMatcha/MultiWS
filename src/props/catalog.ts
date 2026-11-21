/**
 * 道具素材的清单（见 docs/props-plan.md）。纯数据，不读文件：存档、测试都能直接用。网格怎么读见 library.ts。
 *
 * - 低模家具（PROP_ASSETS）：随安装包走，网格都在 public/props/lowpoly.bin 里，
 *   每件的编号、分组、原样多大由 tools/build-props.ts 写进 lowpolyMeta.json。
 * - 写实款（REAL_ASSETS）：带贴图，不进安装包，一件一个文件放在下载站上，用到哪件才下哪件（见 realLoad.ts）；
 *   清单由 tools/build-props-real.ts 写进 realMeta.json。
 * - 我的（userAssets）：用户自己导入的（见 docs/import-plan.md），文件和写实款是同一种，存在这台设备上；
 *   这一份清单是跑起来以后才有的：导入一件、打开工坊时从本机读回来，都登记到这里（见 userStore.ts）。
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

/** 用户自己导入的一件 */
export interface UserAsset extends PropAssetInfo {
  /** 用户起的名字（默认是文件名） */
  name: string;
  /** 转好的文件多少字节 */
  bytes: number;
  /** 小图（data: 地址）；画不出来的没有 */
  thumb?: string;
  /** 只有形状、没有自己的颜色和贴图（OBJ、STL）：和基本体一样是白模的灰色，能挑颜色 */
  plain?: true;
  /** 什么时候导入的（毫秒）：「我的」里照这个排 */
  added: number;
}

/** 导入的素材的编号：my- 加原文件内容 SHA-256 的前 16 位。同一个文件在哪台设备上导入都是同一个编号 */
const USER_ID = /^my-[0-9a-f]{16}$/;
export const isUserAssetId = (id: unknown): id is string => typeof id === 'string' && USER_ID.test(id);

const users = new Map<string, UserAsset>();

/** 登记一件导入的素材（同一个编号的换掉） */
export function registerUserAsset(asset: UserAsset): void {
  if (isUserAssetId(asset.id)) users.set(asset.id, asset);
}

export function forgetUserAsset(id: string): void {
  users.delete(id);
}

/** 这个编号是导入的、这台设备上有的话，它的那一条 */
export const userAsset = (id: unknown): UserAsset | undefined => (typeof id === 'string' ? users.get(id) : undefined);

/** 这台设备上导入过的全部，先导入的在前 */
export const userAssets = (): UserAsset[] => [...users.values()].sort((a, b) => a.added - b.added || a.id.localeCompare(b.id));

/** 清单里的一件素材（低模、写实、这台设备上导入过的都算） */
export const propAsset = (id: unknown): PropAssetInfo | undefined => (typeof id === 'string' ? (byId.get(id) ?? users.get(id)) : undefined);

/** 这个编号是写实款的话，它在清单里的那一条 */
export const realAsset = (id: unknown): RealAsset | undefined => (typeof id === 'string' ? realById.get(id) : undefined);

/** 带着自己的贴图、能「刷成灰色」的：写实款和导入的（导入的这台设备上没有文件时也算） */
export const skinnedAsset = (id: unknown): boolean => Boolean(realAsset(id)) || isUserAssetId(id);
