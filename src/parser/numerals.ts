/** 中文数字 ↔ 整数。只覆盖部件计数用得到的 0–99。 */

const DIGIT: ReadonlyMap<string, number> = new Map([
  ['零', 0],
  ['〇', 0],
  ['一', 1],
  ['二', 2],
  ['两', 2],
  ['俩', 2],
  ['三', 3],
  ['四', 4],
  ['五', 5],
  ['六', 6],
  ['七', 7],
  ['八', 8],
  ['九', 9],
]);

/** 可以出现在中文数字里的字（用于拼正则字符类） */
export const CN_NUM_CHARS = '零〇一二两俩三四五六七八九十';

/** 表示「0 个」的说法 */
export const ZERO_WORDS: ReadonlySet<string> = new Set(['没有', '没', '无', '不要', '不带', '不长', '去掉']);

/**
 * 「三」「两」「十二」「二十三」「12」「没有」→ 整数；认不出返回 NaN。
 * 不含「十」的多位写法按位读（「一二」= 12），与 v1 一致。
 */
export function cnNum(s: string): number {
  if (s === '') return NaN;
  if (/^\d+$/.test(s)) return Number(s);
  if (ZERO_WORDS.has(s)) return 0;
  if (s.includes('十')) {
    const parts = s.split('十');
    if (parts.length !== 2) return NaN;
    const [a, b] = parts;
    const tens = a === '' ? 1 : a.length === 1 ? (DIGIT.get(a) ?? NaN) : NaN;
    const ones = b === '' ? 0 : b.length === 1 ? (DIGIT.get(b) ?? NaN) : NaN;
    return tens * 10 + ones;
  }
  let n = 0;
  for (const ch of s) {
    const d = DIGIT.get(ch);
    if (d === undefined) return NaN;
    n = n * 10 + d;
  }
  return n;
}

const ZH_QTY = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九'];
const ZH_DIGIT = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 整数 → 量词前的中文写法：2 →「两」，12 →「十二」，20 →「二十」。 */
export function zhCount(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n < 10) return ZH_QTY[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return (tens === 1 ? '' : ZH_DIGIT[tens]) + '十' + (ones ? ZH_DIGIT[ones] : '');
}
