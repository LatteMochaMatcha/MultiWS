import { describe, expect, it } from 'vitest';
import { cleanFileName } from '../src/io/download';

describe('保存时填的文件名', () => {
  it('去掉系统不认的字、末尾的点和空格、自己写的 .json', () => {
    expect(cleanFileName('  我的角色 v2.json ')).toBe('我的角色 v2');
    expect(cleanFileName('a/b\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(cleanFileName('名字...')).toBe('名字');
    expect(cleanFileName('三头六臂.JSON')).toBe('三头六臂');
  });
  it('什么都不剩就是空的（调用的地方换成默认的名字）', () => {
    expect(cleanFileName('  ///  ')).toBe('');
    expect(cleanFileName('.json')).toBe('');
  });
  it('最多 80 个字', () => {
    expect(cleanFileName('a'.repeat(200))).toHaveLength(80);
  });
});
