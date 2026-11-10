import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseChangelog } from '../src/view/changelog';

describe('更新日志（打开工坊时弹出来的那一份）', () => {
  it('一版一版拆开：版本、日期、小标题、条目、粗体的一行', () => {
    const releases = parseChangelog(
      ['# 更新日志', '', '## 2.0.1（2026-01-02）', '', '### 新功能', '**一组**', '- 第一条 **粗** 和 `代码`', '- 第二条', '说明一句', '', '## 2.0.0 (2026-01-01)', '- 旧的'].join('\n'),
    );
    expect(releases.map((r) => [r.version, r.date])).toEqual([
      ['2.0.1', '2026-01-02'],
      ['2.0.0', '2026-01-01'],
    ]);
    expect(releases[0].lines).toEqual([
      { kind: 'heading', text: '新功能' },
      { kind: 'label', text: '一组' },
      { kind: 'item', text: '第一条 **粗** 和 `代码`' },
      { kind: 'item', text: '第二条' },
      { kind: 'text', text: '说明一句' },
    ]);
    expect(releases[1].lines).toEqual([{ kind: 'item', text: '旧的' }]);
  });

  it('仓库里的 CHANGELOG.md 读得出来：最新一版在最前，每版都有内容', () => {
    const releases = parseChangelog(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'));
    expect(releases.length).toBeGreaterThan(3);
    expect(releases[0].version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const r of releases) expect(r.lines.length, r.version).toBeGreaterThan(0);
    // 版本号从新到旧
    const num = (v: string) => v.split('.').reduce((n, part) => n * 1000 + Number(part), 0);
    for (let i = 1; i < releases.length; i++) expect(num(releases[i - 1].version), releases[i].version).toBeGreaterThan(num(releases[i].version));
  });
});
