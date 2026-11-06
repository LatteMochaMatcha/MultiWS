// 网页这边读外壳的更新状态、决定更新卡片显示什么
import { describe, expect, it } from 'vitest';
import { cardFor, formatBytes, pickNotes, readStatus, type ShellStatus } from '../src/update/shell';

function status(over: Partial<ShellStatus> = {}): ShellStatus {
  return {
    shell: 1, enabled: true, version: '2.7.2', builtin: '2.7.2', usingBuiltin: true, autoCheck: true, skip: null, lastCheck: null,
    status: 'idle', error: null, needsNewShell: false, progress: { done: 0, total: 0 }, ...over,
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
