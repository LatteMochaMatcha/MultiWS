// 网页这边读外壳的更新状态、决定更新卡片显示什么
import { describe, expect, it } from 'vitest';
import { cardFor, formatBytes, pickNotes, readStatus, type ShellStatus, shouldCheckOnOpen } from '../src/update/shell';

function status(over: Partial<ShellStatus> = {}): ShellStatus {
  return {
    shell: 1, enabled: true, version: '2.7.2', builtin: '2.7.2', usingBuiltin: true, autoCheck: true, skip: null, lastCheck: null,
    status: 'idle', error: null, needsNewShell: false, progress: { done: 0, total: 0 }, platform: 'exe', started: null, ...over,
  };
}
const latest = { version: '2.7.3', notes: { zh: '修了手' }, bytes: 3_000_000 };

describe('读外壳的状态', () => {
  it('外壳回的状态原样读出来', () => {
    const raw = { ...status({ status: 'available' }), latest };
    expect(readStatus(JSON.parse(JSON.stringify(raw)))).toEqual(raw);
  });
  it('不像外壳说的话就当没有外壳', () => {
    expect(readStatus(null)).toBeNull();
    expect(readStatus('<!doctype html>')).toBeNull();
    expect(readStatus({ shell: 1, enabled: true, status: 'flying' })).toBeNull();
    expect(readStatus({ enabled: true, status: 'idle' })).toBeNull();
  });
  it('缺的字段给个稳妥的值，不认识的语言丢掉', () => {
    const s = readStatus({ shell: 1, enabled: true, status: 'available', latest: { version: '2.7.3', notes: { zh: 'a', fr: 'b' }, bytes: '12' } });
    expect(s?.progress).toEqual({ done: 0, total: 0 });
    expect(s?.latest).toEqual({ version: '2.7.3', notes: { zh: 'a' }, bytes: 12 });
    expect(s?.autoCheck).toBe(true);
  });
});

describe('安卓外壳的 window.OcShell', () => {
  it('有桥就走桥：方法返回 JSON 文字，设置原样传过去', async () => {
    const calls: string[] = [];
    const reply = JSON.stringify({ ...status({ status: 'available' }), latest });
    (globalThis as { window?: unknown }).window = {
      OcShell: {
        status: () => reply,
        check: () => (calls.push('check'), reply),
        download: () => (calls.push('download'), reply),
        settings: (json: string) => (calls.push(`settings ${json}`), reply),
      },
    };
    try {
      const { detectShell } = await import('../src/update/shell');
      const found = await detectShell();
      expect(found?.status.latest?.version).toBe('2.7.3');
      await found?.api.download();
      await found?.api.settings({ autoCheck: false });
      expect(calls).toEqual(['download', 'settings {"autoCheck":false}']);
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
  it('桥说更新功能没开就当没有外壳', async () => {
    (globalThis as { window?: unknown }).window = { OcShell: { status: () => JSON.stringify(status({ enabled: false })) } };
    try {
      const { detectShell } = await import('../src/update/shell');
      expect(await detectShell()).toBeNull();
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});

describe('更新说明、大小', () => {
  it('先用当前语言，没有就用中文、英文、日文', () => {
    expect(pickNotes({ zh: '中', en: 'en' }, 'en')).toBe('en');
    expect(pickNotes({ zh: '中', en: 'en' }, 'ja')).toBe('中');
    expect(pickNotes({ ja: 'ja' }, 'en')).toBe('ja');
    expect(pickNotes(undefined, 'zh')).toBe('');
  });
  it('大小写成 MB、KB', () => {
    expect(formatBytes(3_000_000)).toBe('2.9 MB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(100)).toBe('100 B');
  });
});

describe('卡片显示什么', () => {
  const none = new Set<string>();
  it('没查到新版就不显示', () => {
    expect(cardFor(status({ status: 'uptodate' }), none, '2.7.2').kind).toBe('none');
    expect(cardFor(status({ status: 'offline' }), none, '2.7.2').kind).toBe('none');
  });
  it('有新版：显示版本、大小、说明；点过「以后再说」就不显示', () => {
    const s = status({ status: 'available', latest });
    expect(cardFor(s, none, '2.7.2')).toEqual({ kind: 'available', version: '2.7.3', bytes: 3_000_000, notes: { zh: '修了手' } });
    expect(cardFor(s, new Set(['2.7.3']), '2.7.2').kind).toBe('none');
  });
  it('下载中显示进度', () => {
    const s = status({ status: 'downloading', latest, progress: { done: 10, total: 40 } });
    expect(cardFor(s, none, '2.7.2')).toEqual({ kind: 'downloading', version: '2.7.3', done: 10, total: 40 });
  });
  it('下好了、页面还是旧版：提示刷新；刷新以后不再提示', () => {
    const s = status({ status: 'ready', version: '2.7.3', usingBuiltin: false, latest });
    expect(cardFor(s, none, '2.7.2').kind).toBe('ready');
    expect(cardFor(s, none, '2.7.3').kind).toBe('none');
  });
  it('下载出错：提示重试', () => {
    expect(cardFor(status({ status: 'error', latest }), none, '2.7.2').kind).toBe('failed');
  });
});

describe('更新入口在旧内核上也能用', () => {
  it('src/update 里不用 Chrome 80 没有的东西（2.7.3 在 WebView 83 上卡在 replaceChildren，「检查更新」点了没反应）', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    // vitest 在项目根目录跑
    const dir = 'src/update/';
    const tooNew = /\.replaceChildren\(|\.replaceAll\(|\.at\(-?\d|Object\.hasOwn|\.findLast\(|structuredClone|\.toSorted\(|:has\(/;
    for (const name of readdirSync(dir).filter((n) => /\.(ts|css)$/.test(n))) {
      const lines = readFileSync(`${dir}${name}`, 'utf8').split('\n');
      const bad = lines.map((line, i) => [i + 1, line] as const).filter(([, line]) => tooNew.test(line) && !line.trim().startsWith('*') && !line.trim().startsWith('//'));
      expect(bad, name).toEqual([]);
    }
  });
});

describe('页面打开时要不要让外壳查', () => {
  const now = Date.parse('2026-11-07T08:00:00Z');
  it('没查过、或者上次查是 10 分钟以前：查', () => {
    expect(shouldCheckOnOpen(status({ lastCheck: null }), now)).toBe(true);
    expect(shouldCheckOnOpen(status({ lastCheck: '2026-11-07T04:43:04Z' }), now)).toBe(true);
    expect(shouldCheckOnOpen(status({ lastCheck: '2026-11-07T07:50:00Z' }), now)).toBe(true);
  });
  it('刚查过、正在查、已经查到结果、关了自动检查：不查', () => {
    expect(shouldCheckOnOpen(status({ lastCheck: '2026-11-07T07:55:00Z' }), now)).toBe(false);
    expect(shouldCheckOnOpen(status({ status: 'checking' }), now)).toBe(false);
    expect(shouldCheckOnOpen(status({ status: 'available', latest }), now)).toBe(false);
    expect(shouldCheckOnOpen(status({ autoCheck: false }), now)).toBe(false);
    expect(shouldCheckOnOpen(status({ enabled: false }), now)).toBe(false);
  });
});

describe('新的安装包的卡片', () => {
  const none = new Set<string>();
  const installer: NonNullable<ShellStatus['installer']> = { version: '2.8.0', shell: 2, bytes: 70_000_000, status: 'available', error: null, done: 0 };
  it('网页没有要提示的时候才显示安装包', () => {
    expect(cardFor(status({ status: 'uptodate', installer }), none, '2.7.2')).toEqual({ kind: 'installer', version: '2.8.0', bytes: 70_000_000, platform: 'exe' });
    expect(cardFor(status({ status: 'available', latest, installer }), none, '2.7.2').kind).toBe('available');
  });
  it('下载中、下好了、正在装、出错', () => {
    const at = (over: Partial<typeof installer>) => cardFor(status({ status: 'uptodate', installer: { ...installer, ...over } }), none, '2.7.2');
    expect(at({ status: 'downloading', done: 5 })).toEqual({ kind: 'installer-downloading', version: '2.8.0', done: 5, total: 70_000_000 });
    expect(at({ status: 'ready' })).toEqual({ kind: 'installer-ready', version: '2.8.0', platform: 'exe' });
    expect(at({ status: 'installing' }).kind).toBe('installer-installing');
    expect(at({ status: 'error', error: 'x' })).toEqual({ kind: 'installer-failed', version: '2.8.0', error: 'x' });
  });
  it('点过「以后再说」就不再弹；正在装的不受影响', () => {
    const hidden = new Set(['installer:2.8.0']);
    expect(cardFor(status({ status: 'uptodate', installer }), hidden, '2.7.2').kind).toBe('none');
    expect(cardFor(status({ status: 'uptodate', installer: { ...installer, status: 'installing' } }), hidden, '2.7.2').kind).toBe('installer-installing');
  });
  it('读外壳的状态时带上安装包、平台、启动时间', () => {
    const s = readStatus({ ...status({ platform: 'apk', started: 't1' }), installer: { ...installer, status: 'ready' } });
    expect(s?.platform).toBe('apk');
    expect(s?.started).toBe('t1');
    expect(s?.installer?.status).toBe('ready');
    expect(readStatus({ ...status(), installer: { ...installer, status: 'flying' } })?.installer).toBeUndefined();
  });
});
