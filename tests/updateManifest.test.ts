// 软件内自动更新的文件清单：版本比较、路径检查、读写、算出要下哪些文件、挑清单
import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  compareVersions,
  isSafePath,
  MANIFEST_NAME,
  type Manifest,
  parseManifest,
  pickManifest,
  planDownload,
  serializeManifest,
} from '../src/update/manifest';

const hash = (c: string) => c.repeat(64);

function sample(version = '2.7.2', minShell = 1, files = [
  { path: 'index.html', size: 100, sha256: hash('a') },
  { path: 'assets/index-X.js', size: 2000, sha256: hash('b') },
  { path: 'character/alice.vrm', size: 11_000_000, sha256: hash('c') },
]): Manifest {
  return buildManifest({ version, minShell, published: '2026-11-06T00:00:00.000Z', notes: {}, files });
}

describe('版本比较', () => {
  it('按段比数字，不按字符串', () => {
    expect(compareVersions('2.7.10', '2.7.9')).toBeGreaterThan(0);
    expect(compareVersions('2.7.2', '2.8')).toBeLessThan(0);
    expect(compareVersions('3', '2.99.99')).toBeGreaterThan(0);
  });
  it('缺的段当 0', () => {
    expect(compareVersions('2.7', '2.7.0')).toBe(0);
    expect(compareVersions('2.7.0.0', '2.7')).toBe(0);
  });
  it('不是几段数字就报错', () => {
    expect(() => compareVersions('2.7.2-beta', '2.7.2')).toThrow();
    expect(() => compareVersions('', '1')).toThrow();
  });
});

describe('路径检查', () => {
  it('普通的相对路径可以', () => {
    expect(isSafePath('index.html')).toBe(true);
    expect(isSafePath('character/hair/a.glb')).toBe(true);
  });
  it('往外走、绝对路径、反斜杠都不行', () => {
    for (const bad of ['', '/etc/passwd', '../x', 'a/../../x', 'a\\b', 'C:/x', 'c:x', 'a//b', './a', 'a/']) expect(isSafePath(bad), bad).toBe(false);
  });
});

describe('生成、写出、读回', () => {
  it('按路径排序，写出来再读回一样', () => {
    const manifest = sample();
    expect(manifest.files.map((f) => f.path)).toEqual(['assets/index-X.js', 'character/alice.vrm', 'index.html']);
    const text = serializeManifest(manifest);
    expect(text.endsWith('\n')).toBe(true);
    expect(parseManifest(text)).toEqual(manifest);
    // 同样的内容写两遍字节一样：签名靠这个
    expect(serializeManifest(parseManifest(text))).toBe(text);
  });
  it('更新说明只留认识的语言', () => {
    const text = serializeManifest({ ...sample(), notes: { zh: '修了手', en: 'Fixed hands' } });
    const raw = JSON.parse(text);
    raw.notes.fr = 'x';
    raw.notes.ja = 3;
    expect(parseManifest(JSON.stringify(raw)).notes).toEqual({ zh: '修了手', en: 'Fixed hands' });
  });
  it('坏清单都报错', () => {
    const good = JSON.parse(serializeManifest(sample()));
    const broken: [string, (m: Record<string, any>) => void][] = [
      ['格式不认识', (m) => { m.format = 2; }],
      ['版本号不对', (m) => { m.version = 'v2'; }],
      ['minShell 不是正整数', (m) => { m.minShell = 0; }],
      ['时间不对', (m) => { m.published = '昨天'; }],
      ['没有文件', (m) => { m.files = []; }],
      ['路径往外走', (m) => { m.files[0].path = '../evil.exe'; }],
      ['列了自己', (m) => { m.files[0].path = MANIFEST_NAME; }],
      ['路径重复', (m) => { m.files[1].path = m.files[0].path; }],
      ['sha256 大写', (m) => { m.files[0].sha256 = 'A'.repeat(64); }],
      ['sha256 太短', (m) => { m.files[0].sha256 = 'a'.repeat(63); }],
      ['大小是负数', (m) => { m.files[0].size = -1; }],
      ['没有 index.html', (m) => { m.files = m.files.filter((f: { path: string }) => f.path !== 'index.html'); }],
    ];
    for (const [name, breakIt] of broken) {
      const copy = structuredClone(good);
      breakIt(copy);
      expect(() => parseManifest(JSON.stringify(copy)), name).toThrow();
    }
    expect(() => parseManifest('不是 JSON')).toThrow();
    expect(() => parseManifest('[]')).toThrow();
  });
});

describe('新的安装包（installers）', () => {
  const exe = { version: '2.8.0', shell: 2, size: 70_000_000, sha256: hash('e') };
  it('写出来再读回一样；没有就不写这个字段', () => {
    const withIt = { ...sample(), installers: { exe } };
    expect(parseManifest(serializeManifest(withIt))).toEqual(withIt);
    expect(serializeManifest(sample())).not.toContain('installers');
  });
  it('不认识的种类丢掉，字段不对就报错', () => {
    const raw = JSON.parse(serializeManifest({ ...sample(), installers: { exe } }));
    raw.installers.dmg = { version: '1', shell: 1, size: 1, sha256: hash('f') };
    expect(parseManifest(JSON.stringify(raw)).installers).toEqual({ exe });
    for (const breakIt of [(i: Record<string, unknown>) => { i.shell = 0; }, (i: Record<string, unknown>) => { i.sha256 = 'x'; }, (i: Record<string, unknown>) => { i.size = 0; }]) {
      const copy = structuredClone(raw);
      breakIt(copy.installers.exe);
      expect(() => parseManifest(JSON.stringify(copy))).toThrow();
    }
  });
});

describe('要下哪些文件', () => {
  it('只下本机没有的内容', () => {
    const target = sample();
    const plan = planDownload(target, (sha) => sha === hash('c'));
    expect(plan.files.map((f) => f.path)).toEqual(['assets/index-X.js', 'index.html']);
    expect(plan.bytes).toBe(2100);
  });
  it('全都有就什么都不下', () => {
    expect(planDownload(sample(), () => true)).toEqual({ files: [], bytes: 0 });
  });
  it('同一份内容放在两个路径上只下一次', () => {
    const target = sample('2.7.3', 1, [
      { path: 'index.html', size: 100, sha256: hash('a') },
      { path: 'hair/a.glb', size: 500, sha256: hash('d') },
      { path: 'character/hair/a.glb', size: 500, sha256: hash('d') },
    ]);
    const plan = planDownload(target, () => false);
    expect(plan.files).toHaveLength(2);
    expect(plan.bytes).toBe(600);
  });
});

describe('挑清单', () => {
  const builtin = sample('2.7.2');
  it('挑外壳能用的里面最新的', () => {
    expect(pickManifest([builtin, sample('2.7.3')], 1)?.version).toBe('2.7.3');
  });
  it('外壳太旧就不用要求更高的那份', () => {
    expect(pickManifest([builtin, sample('2.8.0', 2)], 1)?.version).toBe('2.7.2');
    expect(pickManifest([builtin, sample('2.8.0', 2)], 2)?.version).toBe('2.8.0');
  });
  it('外壳自带的比下好的新（重装了新外壳）就用自带的', () => {
    expect(pickManifest([sample('2.9.0'), sample('2.8.0')], 1)?.version).toBe('2.9.0');
  });
  it('版本一样时先列的优先，没有能用的返回 null', () => {
    const other = sample('2.7.2');
    expect(pickManifest([builtin, other], 1)).toBe(builtin);
    expect(pickManifest([null, undefined], 1)).toBeNull();
  });
});
