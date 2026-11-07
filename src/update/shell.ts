// 网页和外壳（exe 走同一网站下的 /__shell/，apk 走 window.OcShell）之间关于更新的那几句话。方案和接口表见 docs/update-plan.md 第 2 期。
// 在开发服务器上、或者直接用浏览器打开时没有外壳：detectShell() 返回 null，网页上就不出现任何更新入口。
import type { NoteLanguage } from './manifest';

export type UpdateState = 'idle' | 'checking' | 'uptodate' | 'available' | 'downloading' | 'ready' | 'offline' | 'error';

export interface ShellStatus {
  shell: number;
  enabled: boolean;
  /** 现在用的这一版 */
  version: string | null;
  /** 外壳自带的那一版 */
  builtin: string | null;
  usingBuiltin: boolean;
  autoCheck: boolean;
  skip: string | null;
  lastCheck: string | null;
  status: UpdateState;
  error: string | null;
  /** 下载站上有新版，但要更新的外壳（重新下载安装包）才用得了 */
  needsNewShell: boolean;
  latest?: { version: string; notes: Partial<Record<NoteLanguage, string>>; bytes: number };
  progress: { done: number; total: number };
  /** 哪种外壳 */
  platform: 'exe' | 'apk' | null;
  /** 外壳这次是什么时候开的：exe 换了安装包重启以后会变 */
  started: string | null;
  /** 新的安装包（外壳本身的更新），没有就不在 */
  installer?: { version: string; shell: number; bytes: number; status: InstallerState; error: string | null; done: number };
}

export type InstallerState = 'none' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
const INSTALLER_STATES: readonly InstallerState[] = ['none', 'available', 'downloading', 'ready', 'installing', 'error'];

export interface ShellApi {
  status(): Promise<ShellStatus>;
  check(): Promise<ShellStatus>;
  download(): Promise<ShellStatus>;
  settings(change: { autoCheck?: boolean; skip?: string | null }): Promise<ShellStatus>;
  installerDownload(): Promise<ShellStatus>;
  installerInstall(): Promise<ShellStatus>;
}

const STATES: readonly UpdateState[] = ['idle', 'checking', 'uptodate', 'available', 'downloading', 'ready', 'offline', 'error'];

/** 外壳回来的东西先过一遍：不像外壳说的话就当没有外壳 */
export function readStatus(raw: unknown): ShellStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.shell !== 'number' || typeof r.enabled !== 'boolean' || !STATES.includes(r.status as UpdateState)) return null;
  const progress = (r.progress && typeof r.progress === 'object' ? r.progress : {}) as Record<string, unknown>;
  const status: ShellStatus = {
    shell: r.shell,
    enabled: r.enabled,
    version: typeof r.version === 'string' ? r.version : null,
    builtin: typeof r.builtin === 'string' ? r.builtin : null,
    usingBuiltin: r.usingBuiltin !== false,
    autoCheck: r.autoCheck !== false,
    skip: typeof r.skip === 'string' ? r.skip : null,
    lastCheck: typeof r.lastCheck === 'string' ? r.lastCheck : null,
    status: r.status as UpdateState,
    error: typeof r.error === 'string' ? r.error : null,
    needsNewShell: r.needsNewShell === true,
    progress: { done: Number(progress.done) || 0, total: Number(progress.total) || 0 },
    platform: r.platform === 'exe' || r.platform === 'apk' ? r.platform : null,
    started: typeof r.started === 'string' ? r.started : null,
  };
  const installer = r.installer as Record<string, unknown> | undefined;
  if (installer && typeof installer === 'object' && typeof installer.version === 'string' && INSTALLER_STATES.includes(installer.status as InstallerState)) {
    status.installer = {
      version: installer.version,
      shell: Number(installer.shell) || 0,
      bytes: Number(installer.bytes) || 0,
      status: installer.status as InstallerState,
      error: typeof installer.error === 'string' ? installer.error : null,
      done: Number(installer.done) || 0,
    };
  }
  const latest = r.latest as Record<string, unknown> | undefined;
  if (latest && typeof latest === 'object' && typeof latest.version === 'string') {
    const notes: Partial<Record<NoteLanguage, string>> = {};
    const raw = (latest.notes && typeof latest.notes === 'object' ? latest.notes : {}) as Record<string, unknown>;
    for (const language of ['zh', 'en', 'ja'] as const) if (typeof raw[language] === 'string') notes[language] = raw[language] as string;
    status.latest = { version: latest.version, notes, bytes: Number(latest.bytes) || 0 };
  }
  return status;
}

/** exe 外壳：同一个网站下的 /__shell/。POST 都带 X-Shell 头（外壳不认没带的） */
function httpShell(): ShellApi {
  const call = async (what: string, body?: unknown): Promise<ShellStatus> => {
    const response = await fetch(`/__shell/${what}`, body === undefined && what === 'status'
      ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'X-Shell': '1', 'Content-Type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
    const status = readStatus(await response.json());
    if (!status) throw new Error('外壳回的不是状态');
    return status;
  };
  return {
    status: () => call('status'),
    check: () => call('check', {}),
    download: () => call('download', {}),
    settings: (change) => call('settings', change),
    installerDownload: () => call('installer/download', {}),
    installerInstall: () => call('installer/install', {}),
  };
}

/** apk 外壳挂在网页上的 window.OcShell（tools/android/src/.../Updater.java 的 Bridge）：每个方法都同步返回状态的 JSON */
interface AndroidBridge {
  status(): string;
  check(): string;
  download(): string;
  settings(json: string): string;
  installerDownload(): string;
  installerInstall(): string;
}

function androidShell(bridge: AndroidBridge): ShellApi {
  const call = async (run: () => string): Promise<ShellStatus> => {
    const status = readStatus(JSON.parse(run()));
    if (!status) throw new Error('外壳回的不是状态');
    return status;
  };
  return {
    status: () => call(() => bridge.status()),
    check: () => call(() => bridge.check()),
    download: () => call(() => bridge.download()),
    settings: (change) => call(() => bridge.settings(JSON.stringify(change))),
    installerDownload: () => call(() => bridge.installerDownload()),
    installerInstall: () => call(() => bridge.installerInstall()),
  };
}

/** 有外壳就返回能跟它说话的接口和现在的状态，没有返回 null。不会抛错 */
export async function detectShell(): Promise<{ api: ShellApi; status: ShellStatus } | null> {
  const bridge = typeof window !== 'undefined' ? (window as unknown as { OcShell?: AndroidBridge }).OcShell : undefined;
  if (bridge && typeof bridge.status === 'function') {
    try {
      const api = androidShell(bridge);
      const status = await api.status();
      return status.enabled ? { api, status } : null;
    } catch {
      return null;
    }
  }
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  // exe 外壳只开在本机的 localhost 上；别的地方（开发服务器的局域网地址、放在网站上）不用问
  if (location.hostname !== 'localhost') return null;
  try {
    const api = httpShell();
    const status = await api.status();
    return status.enabled ? { api, status } : null;
  } catch {
    // 开发服务器把不认识的地址都回成首页：读成 JSON 会出错，就是没有外壳
    return null;
  }
}

/** 页面打开时，外壳上次检查要是比这更早，就让它再查一次 */
export const RECHECK_AFTER_MS = 10 * 60 * 1000;

/**
 * 页面打开时要不要让外壳查一次。2.7.3、2.7.4 的外壳自己 20 小时才查一次，而且不记得上次查到的新版：
 * 别的程序（试跑的另一个版本）刚查过一次，或者上次提示了没点，再打开就看不到提示了。由网页来补这一下，旧外壳也管用
 */
export function shouldCheckOnOpen(status: ShellStatus, now: number): boolean {
  if (!status.enabled || !status.autoCheck || status.status !== 'idle') return false;
  if (!status.lastCheck) return true;
  const last = Date.parse(status.lastCheck);
  return Number.isNaN(last) || now - last >= RECHECK_AFTER_MS;
}

/** 更新说明：先用当前语言，没有就依次用中文、英文、日文 */
export function pickNotes(notes: Partial<Record<NoteLanguage, string>> | undefined, lang: NoteLanguage): string {
  if (!notes) return '';
  return notes[lang] ?? notes.zh ?? notes.en ?? notes.ja ?? '';
}

/** 1.2 MB、340 KB 这样的大小 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${bytes} B`;
}

/** 卡片该显示什么。dismissed 是这次打开里点过「以后再说」的版本 */
export type CardView =
  | { kind: 'none' }
  | { kind: 'available'; version: string; bytes: number; notes: Partial<Record<NoteLanguage, string>> }
  | { kind: 'downloading'; version: string; done: number; total: number }
  | { kind: 'ready'; version: string }
  | { kind: 'failed'; version: string }
  // 新的安装包：网页这边没有要提示的时候才轮到它
  | { kind: 'installer'; version: string; bytes: number; platform: 'exe' | 'apk' }
  | { kind: 'installer-downloading'; version: string; done: number; total: number }
  | { kind: 'installer-ready'; version: string; platform: 'exe' | 'apk' }
  | { kind: 'installer-installing'; version: string; platform: 'exe' | 'apk' }
  | { kind: 'installer-failed'; version: string; error: string | null };

/**
 * pageVersion：这个页面载入时外壳给的是哪一版。外壳下好新版以后换过去了，但刷新之前页面上跑的还是旧版的代码
 */
export function cardFor(status: ShellStatus, dismissed: ReadonlySet<string>, pageVersion: string | null): CardView {
  const web = webCard(status, dismissed, pageVersion);
  if (web.kind !== 'none') return web;
  return installerCard(status, dismissed);
}

/** 安装包的卡片。dismissed 里记的是「installer:版本」 */
function installerCard(status: ShellStatus, dismissed: ReadonlySet<string>): CardView {
  const i = status.installer;
  const platform = status.platform;
  if (!i || !platform) return { kind: 'none' };
  const hidden = dismissed.has(`installer:${i.version}`);
  switch (i.status) {
    case 'available':
      return hidden ? { kind: 'none' } : { kind: 'installer', version: i.version, bytes: i.bytes, platform };
    case 'downloading':
      return { kind: 'installer-downloading', version: i.version, done: i.done, total: i.bytes };
    case 'ready':
      return hidden ? { kind: 'none' } : { kind: 'installer-ready', version: i.version, platform };
    case 'installing':
      return { kind: 'installer-installing', version: i.version, platform };
    case 'error':
      return hidden ? { kind: 'none' } : { kind: 'installer-failed', version: i.version, error: i.error };
    default:
      return { kind: 'none' };
  }
}

function webCard(status: ShellStatus, dismissed: ReadonlySet<string>, pageVersion: string | null): CardView {
  const latest = status.latest;
  if (!latest) return { kind: 'none' };
  switch (status.status) {
    case 'available':
      return dismissed.has(latest.version) ? { kind: 'none' } : { kind: 'available', version: latest.version, bytes: latest.bytes, notes: latest.notes };
    case 'downloading':
      return { kind: 'downloading', version: latest.version, done: status.progress.done, total: status.progress.total };
    case 'ready':
      // 下好了、页面还是旧的：提示刷新。已经刷新过（页面就是新版）就不提示
      return status.version === latest.version && pageVersion !== latest.version ? { kind: 'ready', version: latest.version } : { kind: 'none' };
    case 'error':
      return dismissed.has(latest.version) ? { kind: 'none' } : { kind: 'failed', version: latest.version };
    default:
      return { kind: 'none' };
  }
}
