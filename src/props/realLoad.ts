/**
 * 写实款道具的文件从哪来（见 docs/props-plan.md 第 6 期）：不进安装包，用到哪件才从下载站取哪件，
 * 取过的存在这台设备的浏览器里（IndexedDB，和用户自己的 VRM 存在一处），下次打开、断了网都还能用。
 *
 * 先看内存里读没读过，再看本机存没存过，都没有才联网。下完核对大小和 SHA-256，对不上不认、不存。
 * exe、apk、网页三种跑法用的是同一套：都是页面自己取、自己存，不经过外壳的更新目录（那里的文件会被清理掉）。
 */
import { t } from '../i18n';
import { OfflineError } from '../io/fetchFile';
import { forgetFile, keepFile, keptFile } from '../io/keepFile';
import { REAL_STORE, type RealAsset, realAsset } from './catalog';
import { installRealAsset, realAssetFile } from './library';

/** 本机存的时候用的名字 */
const keyOf = (id: string) => `prop:${id}`;

/** 这一件现在是什么情况：读进来了、正在下（下了几成）、还没有 */
export type RealState = { state: 'ready' } | { state: 'loading'; done: number } | { state: 'none' };

const jobs = new Map<string, Promise<boolean>>();
const progress = new Map<string, number>();
const watchers = new Set<() => void>();

/** 有哪件开始下、下了一截、下完、没下成：叫一声（道具栏的格子跟着换） */
export function watchRealAssets(listener: () => void): () => void {
  watchers.add(listener);
  return () => watchers.delete(listener);
}
const tell = () => {
  for (const listener of watchers) listener();
};

export function realState(id: string): RealState {
  if (realAssetFile(id)) return { state: 'ready' };
  const done = progress.get(id);
  return done === undefined ? { state: 'none' } : { state: 'loading', done };
}

/** 开发服务器上从本机转好的文件里取（tools/props-store/plugin.mjs），正式版从下载站取 */
const storeUrl = (entry: RealAsset) => `${import.meta.env.DEV ? '/__props/' : REAL_STORE}${entry.sha256}`;

async function sha256(bytes: ArrayBuffer): Promise<string | null> {
  // 用局域网地址打开开发服务器时浏览器不给 crypto.subtle：只核对大小和文件自己的格式
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 从下载站取一件，边取边报下了几成 */
async function download(entry: RealAsset, onProgress: (done: number) => void): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(storeUrl(entry));
  } catch {
    throw new Error(t('这件素材没下下来：连不上下载站。看看网络，再点一次'));
  }
  if (!response.ok) throw new Error(t('{what}没取到（{status}）', { what: t('道具素材'), status: response.status }));
  const reader = response.body?.getReader?.();
  let bytes: Uint8Array;
  try {
    if (reader) {
      bytes = new Uint8Array(entry.bytes);
      let at = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (at + value.byteLength > bytes.byteLength) throw new Error(t('道具素材的文件大小不对'));
        bytes.set(value, at);
        at += value.byteLength;
        onProgress(at / entry.bytes);
      }
      if (at !== entry.bytes) throw new Error(t('道具素材的文件大小不对'));
    } else {
      bytes = new Uint8Array(await response.arrayBuffer());
    }
  } catch (error) {
    if (error instanceof Error && !(error instanceof TypeError)) throw error;
    // 取到一半断了
    throw new OfflineError();
  }
  if (bytes.byteLength !== entry.bytes) throw new Error(t('道具素材的文件大小不对'));
  const hash = await sha256(bytes.buffer as ArrayBuffer);
  if (hash !== null && hash !== entry.sha256) throw new Error(t('道具素材的文件坏了'));
  return bytes.buffer as ArrayBuffer;
}

/**
 * 把一件写实款读进来。返回 true：读进来了。
 * local：只看本机存没存过，不联网（打开场景时用；没存过返回 false）。联网没取到会抛出原因
 */
export function loadRealAsset(id: string, local = false): Promise<boolean> {
  const entry = realAsset(id);
  if (!entry) return Promise.resolve(false);
  if (realAssetFile(id)) return Promise.resolve(true);
  const running = jobs.get(id);
  // 正在联网下的那一趟，谁来问都等它；只看本机的那一趟很快，各走各的
  if (running) return running;
  const job = (async () => {
    const kept = await keptFile(keyOf(id));
    if (kept) {
      try {
        // 存的时候名字记的是 SHA-256：清单换了新版，旧文件不认
        if (kept.name !== entry.sha256) throw new Error('旧版');
        installRealAsset(id, kept.bytes);
        return true;
      } catch {
        await forgetFile(keyOf(id));
      }
    }
    if (local) return false;
    progress.set(id, 0);
    tell();
    try {
      const bytes = await download(entry, (done) => {
        progress.set(id, done);
        tell();
      });
      installRealAsset(id, bytes);
      // 存不了（隐私模式、空间满了）也照样能用，只是下次要重下
      await keepFile(keyOf(id), { name: entry.sha256, bytes });
      return true;
    } finally {
      progress.delete(id);
    }
  })();
  if (!local) {
    jobs.set(id, job);
    void job
      .catch(() => {})
      .then(() => {
        jobs.delete(id);
        tell();
      });
  }
  return job;
}

/** 场景里用到的写实款：本机存过的读进来。返回本机没有的那几件的编号 */
export async function loadKeptRealAssets(ids: Iterable<string>): Promise<string[]> {
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    if (!realAsset(id)) continue;
    if (!(await loadRealAsset(id, true).catch(() => false))) missing.push(id);
  }
  return missing;
}
