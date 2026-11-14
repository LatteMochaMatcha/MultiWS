import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareVersions } from '../src/update/manifest';
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
    // 两段的（2.8）和三段的（2.7.8）都行，和 package.json 的版本号一个规矩（见 update/manifest.ts 的 compareVersions）
    expect(releases[0].version).toMatch(/^\d+(\.\d+){1,3}$/);
    for (const r of releases) expect(r.lines.length, r.version).toBeGreaterThan(0);
    // 版本号从新到旧
    for (let i = 1; i < releases.length; i++) expect(compareVersions(releases[i - 1].version, releases[i].version), releases[i].version).toBeGreaterThan(0);
  });
});
