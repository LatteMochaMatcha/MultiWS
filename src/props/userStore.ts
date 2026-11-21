/**
 * 用户自己导入的素材存在哪（见 docs/import-plan.md）：这台设备的浏览器里（IndexedDB，和写实款、用户自己的 VRM 存在一处），
 * 不上传。每件一个文件（realFile.ts 那一种），另有一份清单（名字、分类、大小、小图）。
 *
 * 存不了（隐私模式、浏览器不让存、空间满了）时这一次打开期间照样能用，只是关掉以后就没了：addUserAsset 会说存没存上。
 */
import { forgetFile, keepFile, keptFile } from '../io/keepFile';
import { sha256Hex } from '../io/sha256';
import type { Vec3 } from '../model/spec';
import { PROP_ASSET_GROUPS, type PropAssetGroup, type UserAsset, forgetUserAsset, isUserAssetId, registerUserAsset, userAsset, userAssets } from './catalog';
import { dropUserAsset, installUserAsset, realAssetFile } from './library';

/** 清单在本机叫什么 */
const INDEX_KEY = 'myprops';
/** 一件的文件在本机叫什么 */
const fileKey = (id: string) => `myprop:${id}`;
/** 名字最长多少个字（和道具的名字一样） */
const NAME_MAX = 40;

const watchers = new Set<() => void>();

/** 「我的」变了（导入了一件、删了一件、从本机读回来了）：叫一声 */
export function watchUserAssets(listener: () => void): () => void {
  watchers.add(listener);
  return () => watchers.delete(listener);
}
const tell = () => {
  for (const listener of watchers) listener();
};

/** 这个文件导入以后的编号：my- 加内容 SHA-256 的前 16 位。同一个文件在哪都是同一个编号 */
export async function userAssetId(bytes: ArrayBuffer): Promise<string> {
  return `my-${(await sha256Hex(bytes)).slice(0, 16)}`;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 清单里读出来的一条整理成能用的；缺东西的返回 null */
export function cleanUserAsset(raw: unknown): UserAsset | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (!isUserAssetId(a.id)) return null;
  const size = Array.isArray(a.size) ? a.size : [];
  if (size.length !== 3 || !size.every((v) => finite(v) && v > 0)) return null;
  if (!finite(a.vertices) || !finite(a.triangles) || a.triangles <= 0) return null;
  const name = typeof a.name === 'string' ? a.name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
  return {
    id: a.id,
    name,
    group: (PROP_ASSET_GROUPS as readonly unknown[]).includes(a.group) ? (a.group as PropAssetGroup) : 'other',
    size: size as Vec3,
    vertices: a.vertices,
    triangles: a.triangles,
    bytes: finite(a.bytes) ? a.bytes : 0,
    ...(typeof a.thumb === 'string' && a.thumb.startsWith('data:image/') && a.thumb.length < 400_000 ? { thumb: a.thumb } : {}),
    ...(a.plain === true ? { plain: true as const } : {}),
    added: finite(a.added) ? a.added : 0,
  };
}

async function writeIndex(): Promise<boolean> {
  const bytes = new TextEncoder().encode(JSON.stringify(userAssets()));
  return keepFile(INDEX_KEY, { name: 'index', bytes: bytes.buffer as ArrayBuffer });
}

let opening: Promise<void> | null = null;

/** 打开工坊时：把本机存着的清单读回来登记上（只读清单，文件用到才读）。多叫几次只读一次 */
export function loadUserIndex(): Promise<void> {
  opening ??= (async () => {
    const kept = await keptFile(INDEX_KEY);
    if (!kept) return;
    let list: unknown;
    try {
      list = JSON.parse(new TextDecoder().decode(kept.bytes));
    } catch {
      return;
    }
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      const asset = cleanUserAsset(raw);
      // 这一次打开期间刚导入的比本机存的新：不盖
      if (asset && !userAsset(asset.id)) registerUserAsset(asset);
    }
    tell();
  })();
  return opening;
}

const reading = new Map<string, Promise<boolean>>();

/** 把一件导入的素材的文件从本机读进来。返回 false：这台设备上没有它 */
export function loadUserAsset(id: string): Promise<boolean> {
  if (!isUserAssetId(id)) return Promise.resolve(false);
  if (realAssetFile(id)) return Promise.resolve(true);
  let job = reading.get(id);
  if (!job) {
    job = (async () => {
      await loadUserIndex();
      if (!userAsset(id)) return false;
      const kept = await keptFile(fileKey(id));
      if (!kept) return false;
      try {
        installUserAsset(id, kept.bytes);
        return true;
      } catch {
        return false;
      }
    })();
    reading.set(id, job);
    void job.then(() => {
      reading.delete(id);
      tell();
    });
  }
  return job;
}

/** 场景里用到的导入的素材：本机有的读进来。返回这台设备上没有的那几件的编号 */
export async function loadUserAssets(ids: Iterable<string>): Promise<string[]> {
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    if (!isUserAssetId(id)) continue;
    if (!(await loadUserAsset(id))) missing.push(id);
  }
  return missing;
}

/**
 * 导入了一件：读进来、登记、存到本机。file 是转好的素材文件。
 * 返回 kept：存上了没有（没存上这一次照样能用，关掉工坊就没了）
 */
export async function addUserAsset(asset: UserAsset, file: Uint8Array): Promise<{ kept: boolean }> {
  await loadUserIndex();
  const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  installUserAsset(asset.id, bytes);
  registerUserAsset(asset);
  const kept = (await keepFile(fileKey(asset.id), { name: asset.id, bytes })) && (await writeIndex());
  tell();
  return { kept };
}

/** 改一件的分类（一键动作照分类找坐面、台面） */
export async function regroupUserAsset(id: string, group: PropAssetGroup): Promise<void> {
  const asset = userAsset(id);
  if (!asset || asset.group === group || !(PROP_ASSET_GROUPS as readonly string[]).includes(group)) return;
  registerUserAsset({ ...asset, group });
  await writeIndex();
  tell();
}

/** 从「我的」里删掉一件：清单、文件都删 */
export async function removeUserAsset(id: string): Promise<void> {
  await loadUserIndex();
  forgetUserAsset(id);
  dropUserAsset(id);
  await forgetFile(fileKey(id));
  await writeIndex();
  tell();
}
