/**
 * 读 FBX（见 docs/import-plan.md 第 3 期）：用 three 自带的 FBXLoader，用到才载（不小，平时不占地方）。
 * 读出来的那棵物体交给 importObject.ts 拼成和 GLB 一样的东西。
 *
 * 带贴图的要在浏览器里跑（FBXLoader 用 <img> 载贴图）；不带贴图的哪都能跑。
 */
import { LoadingManager, type Object3D, type Texture } from 'three';
import { t } from '../i18n';
import { type ImportFiles, type ImportSource, sniffImage } from './importMesh';
import { sourceFromObject } from './importObject';

/** 等贴图最多等多久（毫秒）：载不出来的不等了，当成没有 */
const TEXTURE_WAIT = 20_000;

export async function readImportFbx(buffer: ArrayBuffer, files: ImportFiles | null = null): Promise<ImportSource> {
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const notes = new Set<string>();
  /** 我们自己为外面的贴图文件做的地址 → 文件内容 */
  const own = new Map<string, Uint8Array>();
  let started = false;
  let finish: (() => void) | null = null;
  const manager = new LoadingManager();
  manager.onStart = () => {
    started = true;
  };
  manager.onLoad = () => finish?.();
  // 贴图在文件里的（blob:、data:）原样载；在外面的，FBX 里写的常常是作者电脑上的整条路径：照文件名在这一组文件里找
  manager.setURLModifier((url) => {
    if (/^(blob:|data:)/.test(url)) return url;
    const bytes = files?.(url) ?? null;
    // 找不到的：给一个载不出来的地址，这张贴图就当没有
    if (!bytes) return 'data:,';
    const made = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: sniffImage(bytes) || 'application/octet-stream' }));
    own.set(made, bytes);
    return made;
  });

  let root: Object3D;
  try {
    root = new FBXLoader(manager).parse(buffer, '');
  } catch (error) {
    for (const url of own.keys()) URL.revokeObjectURL(url);
    const text = error instanceof Error ? error.message : String(error);
    if (/version not supported/i.test(text)) throw new Error(t('这个 FBX 是很老的版本（7.0 以前），读不了：在 Blender 里打开，另存成 GLB 再导'));
    throw new Error(t('这个 FBX 文件读不了（可能是坏的，或者是工坊不认的版本）：在 Blender 里打开，另存成 GLB 再导'));
  }
  if (started) {
    await new Promise<void>((resolve) => {
      finish = resolve;
      setTimeout(resolve, TEXTURE_WAIT);
    });
  }

  // 每张用到的贴图的文件内容：外面的在 own 里；文件里带着的，照它的地址读回来
  const loaded = new Map<Texture, Uint8Array | null>();
  const jobs: Promise<void>[] = [];
  root.traverse((object) => {
    const list = (object as { material?: unknown }).material;
    for (const m of Array.isArray(list) ? list : list ? [list] : []) {
      for (const texture of [(m as { map?: Texture }).map, (m as { normalMap?: Texture }).normalMap]) {
        if (!texture || loaded.has(texture)) continue;
        loaded.set(texture, null);
        const src = String((texture.image as { src?: string } | null)?.src ?? '');
        const mine = own.get(src);
        if (mine) loaded.set(texture, mine);
        else if (/^(blob:|data:image)/.test(src)) {
          jobs.push(
            fetch(src)
              .then((r) => r.arrayBuffer())
              .then((bytes) => void loaded.set(texture, new Uint8Array(bytes)))
              .catch(() => undefined),
          );
        }
      }
    }
  });
  await Promise.all(jobs);
  for (const url of own.keys()) URL.revokeObjectURL(url);

  const source = sourceFromObject(root, (texture) => loaded.get(texture) ?? null, notes);
  // FBX 自己写着单位：一个单位是多少厘米
  const perUnit = Number((root.userData as { unitScaleFactor?: unknown }).unitScaleFactor);
  if (Number.isFinite(perUnit) && perUnit > 0) source.unit = perUnit / 100;
  return source;
}
