import { describe, expect, it } from 'vitest';
import { cnNum, zhCount } from '../src/parser';

describe('cnNum 中文数字 → 整数', () => {
  it.each([
    ['零', 0],
    ['〇', 0],
    ['一', 1],
    ['二', 2],
    ['两', 2],
    ['俩', 2],
    ['九', 9],
    ['十', 10],
    ['十二', 12],
    ['二十', 20],
    ['二十三', 23],
    ['九十九', 99],
    ['一二', 12],
    ['12', 12],
    ['007', 7],
    ['没有', 0],
    ['无', 0],
    ['不要', 0],
  ])('%s → %i', (s, n) => {
    expect(cnNum(s)).toBe(n);
  });

  it.each(['', '百', '十十', '二十三四', '三x', 'abc'])('认不出「%s」时返回 NaN', (s) => {
    expect(cnNum(s)).toBeNaN();
  });
});

describe('zhCount 整数 → 量词前的中文写法', () => {
  it.each([
    [0, '零'],
    [1, '一'],
    [2, '两'],
    [9, '九'],
    [10, '十'],
    [12, '十二'],
    [20, '二十'],
    [22, '二十二'],
    [99, '九十九'],
    [100, '100'],
    [-1, '-1'],
  ])('%i → %s', (n, s) => {
    expect(zhCount(n)).toBe(s);
  });

  it('0–99 往返一致', () => {
    for (let n = 0; n < 100; n++) expect(cnNum(zhCount(n))).toBe(n);
  });
});
