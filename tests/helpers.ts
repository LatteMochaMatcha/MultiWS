import { type BodyCounts, type CountKey, COUNT_KEYS, defaultCounts } from '../src/model/spec';
import { type ParseResult, parseDescription } from '../src/parser';

/** 只留下与默认值不同的部件，让期望值写起来短 */
export function diffCounts(counts: BodyCounts): Partial<BodyCounts> {
  const def = defaultCounts();
  const out: Partial<BodyCounts> = {};
  for (const k of COUNT_KEYS) if (counts[k] !== def[k]) out[k] = counts[k];
  return out;
}

export const diff = (text: string) => diffCounts(parseDescription(text).counts);

export const hitsOf = (r: ParseResult): CountKey[] => [...r.hits].sort();

/** 可复现的伪随机数（mulberry32） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
