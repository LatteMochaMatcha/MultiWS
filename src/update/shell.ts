// 网页和外壳（exe、以后的 apk）之间关于更新的那几句话。方案和接口表见 docs/update-plan.md 第 2 期。
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
}

export interface ShellApi {
  status(): Promise<ShellStatus>;
  check(): Promise<ShellStatus>;
  download(): Promise<ShellStatus>;
  settings(change: { autoCheck?: boolean; skip?: string | null }): Promise<ShellStatus>;
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
  };
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
  };
}

/** 有外壳就返回能跟它说话的接口和现在的状态，没有返回 null。不会抛错 */
export async function detectShell(): Promise<{ api: ShellApi; status: ShellStatus } | null> {
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
  | { kind: 'failed'; version: string };

/**
 * pageVersion：这个页面载入时外壳给的是哪一版。外壳下好新版以后换过去了，但刷新之前页面上跑的还是旧版的代码
 */
export function cardFor(status: ShellStatus, dismissed: ReadonlySet<string>, pageVersion: string | null): CardView {
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
