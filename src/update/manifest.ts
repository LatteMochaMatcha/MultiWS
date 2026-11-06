// 软件内自动更新用的文件清单（方案见 docs/update-plan.md）。
//
// 每次打包都在 dist 里写一份 update-manifest.json：版本号、要求的最低外壳版本、dist 里每个文件的路径、大小、sha256。
//   - 外壳（exe、apk）里自带的那份，告诉外壳「自己带了哪些文件」，新版里没变的文件就不用下；
//   - 发版时同样的内容加上更新说明，改名 latest.json 放到下载站上，再配一个签名 latest.json.sig。
// 这里只放不碰文件、不碰网络的纯逻辑：网页、发版脚本、测试都能用。外壳那边（C#、Java）照同样的规则各写一份。

/** dist 里那份清单的文件名。它自己不列在清单里 */
export const MANIFEST_NAME = 'update-manifest.json';
/** 清单格式的版本。改了字段的含义就加一，旧外壳看到不认识的格式就不用这份清单 */
export const MANIFEST_FORMAT = 1;

export type NoteLanguage = 'zh' | 'en' | 'ja';

export interface ManifestFile {
  /** 相对 dist 的路径，用正斜杠，例如 assets/index-BHqgmWKw.js */
  path: string;
  size: number;
  /** 小写十六进制，64 位 */
  sha256: string;
}

export interface Manifest {
  format: typeof MANIFEST_FORMAT;
  /** 几段数字，例如 2.7.2，和 package.json 一样 */
  version: string;
  /** 外壳的版本（一个整数）至少要这么大，才能用这份清单。外壳的版本只在外壳和网页之间的约定变了的时候加一 */
  minShell: number;
  /** 打包的时间，ISO 格式 */
  published: string;
  /** 更新说明，缺哪种语言就显示别的语言的 */
  notes: Partial<Record<NoteLanguage, string>>;
  /** 按路径排好序 */
  files: ManifestFile[];
}

const VERSION = /^\d+(\.\d+){0,3}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** 比两个版本号：a 新返回正数，一样返回 0，a 旧返回负数。段数不同时缺的段当 0（2.7 和 2.7.0 一样） */
export function compareVersions(a: string, b: string): number {
  if (!VERSION.test(a)) throw new Error(`版本号要是几段数字：${a}`);
  if (!VERSION.test(b)) throw new Error(`版本号要是几段数字：${b}`);
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 路径只能往下走：不能是绝对路径、不能有 .. 和反斜杠。外壳照路径把文件存在本机，这一步挡住「写到别处去」 */
export function isSafePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** 整理成一份清单：检查每一项、按路径排序。有不对的地方直接报错，不会生成一份坏清单 */
export function buildManifest(input: Omit<Manifest, 'format'>): Manifest {
  const manifest: Manifest = { format: MANIFEST_FORMAT, ...input, files: [...input.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
  check(manifest);
  return manifest;
}

/** 写成文本：两格缩进、结尾换行。签名签的就是这段文本的 UTF-8 原样字节 */
export function serializeManifest(manifest: Manifest): string {
  const { format, version, minShell, published, notes, files } = manifest;
  return `${JSON.stringify({ format, version, minShell, published, notes, files: files.map(({ path, size, sha256 }) => ({ path, size, sha256 })) }, null, 2)}\n`;
}

/** 读一份清单。格式不认识、字段不对都报错 */
export function parseManifest(text: string): Manifest {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('清单不是合法的 JSON');
  }
  if (!data || typeof data !== 'object') throw new Error('清单不是一个对象');
  const raw = data as Record<string, unknown>;
  if (raw.format !== MANIFEST_FORMAT) throw new Error(`不认识的清单格式：${String(raw.format)}`);
  const notes: Manifest['notes'] = {};
  if (raw.notes && typeof raw.notes === 'object') {
    for (const language of ['zh', 'en', 'ja'] as const) {
      const note = (raw.notes as Record<string, unknown>)[language];
      if (typeof note === 'string') notes[language] = note;
    }
  }
  const manifest = {
    format: MANIFEST_FORMAT,
    version: raw.version,
    minShell: raw.minShell,
    published: raw.published,
    notes,
    files: Array.isArray(raw.files) ? raw.files : null,
  } as unknown as Manifest;
  check(manifest);
  return manifest;
}

function check(manifest: Manifest): void {
  if (typeof manifest.version !== 'string' || !VERSION.test(manifest.version)) throw new Error(`清单的版本号不对：${String(manifest.version)}`);
  if (!Number.isInteger(manifest.minShell) || manifest.minShell < 1) throw new Error(`清单的 minShell 要是正整数：${String(manifest.minShell)}`);
  if (typeof manifest.published !== 'string' || Number.isNaN(Date.parse(manifest.published))) throw new Error(`清单的打包时间不对：${String(manifest.published)}`);
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('清单里没有文件');
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (!file || typeof file !== 'object') throw new Error('清单里有一项不是对象');
    if (typeof file.path !== 'string' || !isSafePath(file.path)) throw new Error(`清单里的路径不安全：${String(file.path)}`);
    if (file.path === MANIFEST_NAME) throw new Error(`清单不能列出自己：${MANIFEST_NAME}`);
    if (seen.has(file.path)) throw new Error(`清单里的路径重复了：${file.path}`);
    seen.add(file.path);
    if (!Number.isInteger(file.size) || file.size < 0) throw new Error(`文件大小不对：${file.path}`);
    if (typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)) throw new Error(`sha256 要是 64 位小写十六进制：${file.path}`);
  }
  if (!seen.has('index.html')) throw new Error('清单里没有 index.html');
}

/** 这个外壳能不能用这份清单 */
export function usableBy(manifest: Manifest, shellVersion: number): boolean {
  return manifest.minShell <= shellVersion;
}

/**
 * 要更新到 target，还得下载哪些文件。have(sha256) 说本机（外壳自带的、上次下好的）有没有这份内容。
 * 内容一样的文件只下一次（同一个文件放在两个路径上时）。
 */
export function planDownload(target: Manifest, have: (sha256: string) => boolean): { files: ManifestFile[]; bytes: number } {
  const files: ManifestFile[] = [];
  const queued = new Set<string>();
  let bytes = 0;
  for (const file of target.files) {
    if (queued.has(file.sha256) || have(file.sha256)) continue;
    queued.add(file.sha256);
    files.push(file);
    bytes += file.size;
  }
  return { files, bytes };
}

/** 从几份清单里挑出外壳该用的那份：外壳能用的里面版本最新的；版本一样时先列的优先（把外壳自带的放在第一个） */
export function pickManifest(candidates: readonly (Manifest | null | undefined)[], shellVersion: number): Manifest | null {
  let best: Manifest | null = null;
  for (const manifest of candidates) {
    if (!manifest || !usableBy(manifest, shellVersion)) continue;
    if (!best || compareVersions(manifest.version, best.version) > 0) best = manifest;
  }
  return best;
}
