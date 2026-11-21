/**
 * 一次导入的一组文件（见 docs/import-plan.md 第 3 期）：一次选的好几个文件、拖进来的文件夹、zip 包里的东西。
 * 这里只管整理：哪些是模型、模型里写的「旁边那个文件」是这一组里的哪一个。纯函数，不碰浏览器。
 *
 * zip 用 three 自带的那份 fflate 解（FBX 的读法也用它），用到才载。
 */
import { t } from '../i18n';
import type { ImportFiles } from './importMesh';
import { importKind } from './importShape';

export interface ImportEntry {
  /** 在这一组里的路径（用 / 分开；单个文件就是文件名） */
  path: string;
  bytes: Uint8Array;
}

/** 模型要用到的旁边的文件：.bin、.mtl、贴图 */
const SIDE = /\.(bin|mtl|png|jpe?g|webp)$/i;
const ZIP = /\.zip$/i;

/** 这个文件导入时用不用得上（模型、zip、模型旁边的文件）：用不上的不用读进来 */
export const importWanted = (path: string): boolean => importKind(path) !== null || ZIP.test(path) || SIDE.test(path);

/** 是不是一个能导入的东西（模型，或者可能装着模型的 zip） */
export const importStarts = (path: string): boolean => importKind(path) !== null || ZIP.test(path);

export const isZip = (path: string): boolean => ZIP.test(path);

/** 一次最多导几个模型：再多的一个个问太烦，让用户挑着来 */
export const IMPORT_BATCH = 8;
/** zip 解开以后最多多大（字节）：再大的页面撑不住 */
const UNZIP_MAX = 1024 * 1048576;

const clean = (path: string) =>
  path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');

/** 解开一个 zip：只要导入用得上的文件；prefix 是这个 zip 自己在这一组里的位置（它里面的文件接在后面） */
export async function unzipEntries(bytes: Uint8Array, prefix = ''): Promise<ImportEntry[]> {
  const { unzipSync } = await import('three/examples/jsm/libs/fflate.module.js');
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        // 苹果电脑打包时带的那些、隐藏文件、文件夹自己都不要
        if (/(^|\/)(__MACOSX|\.[^/]*)(\/|$)/.test(file.name) || file.name.endsWith('/') || !importWanted(file.name) || ZIP.test(file.name)) return false;
        total += file.originalSize;
        if (total > UNZIP_MAX) throw new Error('too big');
        return true;
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'too big') throw new Error(t('这个 zip 包解开以后超过 1 GB，太大了：解压出来，挑要的文件导'));
    throw new Error(t('这个 zip 包是坏的，或者加了密码，解不开'));
  }
  const base = clean(prefix);
  return Object.entries(files).map(([name, data]) => ({ path: clean(base ? `${base}/${name}` : name), bytes: data }));
}

/** 这一组里的模型文件：GLB 排最前（它自己什么都带着），别的照路径排 */
export function bundleModels(entries: readonly ImportEntry[]): ImportEntry[] {
  const rank = (path: string) => ['glb', 'gltf', 'fbx', 'obj', 'stl'].indexOf(importKind(path) ?? '');
  return entries.filter((e) => importKind(e.path) !== null).sort((a, b) => rank(a.path) - rank(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * 给一个模型配上「旁边的文件」：模型里写的是相对它自己的路径（或者只是个文件名，FBX 里常常是作者电脑上的整条路径）。
 * 先照路径找，找不到就照文件名找（不分大小写）；文件名一样的有好几个时挑和模型挨得最近的
 */
export function bundleFiles(entries: readonly ImportEntry[], main: ImportEntry): ImportFiles {
  const byPath = new Map<string, ImportEntry>();
  const byName = new Map<string, ImportEntry[]>();
  for (const entry of entries) {
    if (entry === main) continue;
    byPath.set(entry.path.toLowerCase(), entry);
    const name = entry.path.split('/').pop()!.toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), entry]);
  }
  const folder = main.path.split('/').slice(0, -1);
  /** 两条路径开头有几段一样 */
  const shared = (path: string) => {
    const parts = path.split('/');
    let n = 0;
    while (n < folder.length && n < parts.length - 1 && parts[n].toLowerCase() === folder[n].toLowerCase()) n++;
    return n;
  };
  return (uri) => {
    let wanted = uri.split(/[?#]/)[0];
    try {
      wanted = decodeURIComponent(wanted);
    } catch {
      // 不是编过码的：原样用
    }
    const parts = [...folder];
    for (const part of wanted.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    const exact = byPath.get(parts.join('/').toLowerCase());
    if (exact) return exact.bytes;
    const same = byName.get((parts.pop() ?? '').toLowerCase());
    if (!same?.length) return null;
    return same.reduce((best, entry) => (shared(entry.path) > shared(best.path) ? entry : best)).bytes;
  };
}
