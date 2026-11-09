import { describe, expect, it } from 'vitest';
import { t, tk } from '../src/i18n';
import { ROOT as root, loadDict, report } from '../tools/i18n-keys.mjs';

describe('界面文字的译文', () => {
  const r = report(root);

  it('抽键没有毛病（模板字符串里有 ${}、拼起来的参数、两个文件译法不同）', () => {
    expect(r.problems).toEqual([]);
  });

  it('每个键都有英文、日文', () => {
    expect(r.keys.size).toBeGreaterThan(0);
    expect(r.missing.en.slice(0, 30)).toEqual([]);
    expect(r.missing.ja.slice(0, 30)).toEqual([]);
  });

  it('译文里没有源码已经不用的键', () => {
    expect(r.unused.en).toEqual([]);
    expect(r.unused.ja).toEqual([]);
  });

  it('译文的占位符和原文一样', () => {
    expect(r.badVars).toEqual([]);
  });

  it('英文译文里没有汉字、假名', () => {
    const { dict } = loadDict(root, 'en');
    const cjk = /[぀-ヿ㐀-鿿]/;
    expect(Object.entries(dict).filter(([, v]) => cjk.test(v)).map(([k]) => k)).toEqual([]);
  });
});

describe('t()', () => {
  it('测试里是中文：原样返回、填占位符', () => {
    expect(t('撤销')).toBe('撤销');
    expect(t('已导出 {file}', { file: 'a.glb' })).toBe('已导出 a.glb');
    expect(tk('左')).toBe('左');
    // @@ 后面是给译者看的语境，中文里不显示
    expect(t('头 {n}@@数量', { n: 2 })).toBe('头 2');
  });

  it('{n:单|复} 照 n 选', () => {
    // 中文原文不写单复数，这里直接拿带单复数的字符串当「查不到的键」试填法
    expect(t('{n} {n:arm|arms}', { n: 1 })).toBe('1 arm');
    expect(t('{n} {n:arm|arms}', { n: 4 })).toBe('4 arms');
  });
});
