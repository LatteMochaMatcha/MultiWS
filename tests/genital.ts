import { readFileSync } from 'node:fs';
import { genitalReady, installGenital } from '../src/anime/genital';

/** 测试里用：从磁盘把阴囊的格子读进来登记好（浏览器里是 fetch 回来的） */
export function useGenital() {
  if (genitalReady()) return;
  const bytes = readFileSync(new URL('../public/genital.bin', import.meta.url));
  installGenital(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}
