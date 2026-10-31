import { readFileSync } from 'node:fs';
import { animeReady, installAnimeBody } from '../src/anime/body';

/** 测试里用：从磁盘把二次元素体的数据读进来登记好（浏览器里是 fetch 回来的） */
export function useAnimeBody() {
  if (animeReady()) return;
  const bytes = readFileSync(new URL('../public/anime/body.bin', import.meta.url));
  installAnimeBody(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}
