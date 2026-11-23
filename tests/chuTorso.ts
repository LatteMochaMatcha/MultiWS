import { readFileSync } from 'node:fs';
import { chuTorsoReady, installChuTorso } from '../src/anime/chuTorso';

/** 测试里用：从磁盘把「楚云萱躯干」的格子读进来登记好（浏览器里是 fetch 回来的） */
export function useChuTorso() {
  if (chuTorsoReady()) return;
  const bytes = readFileSync(new URL('../public/anime/chu-torso.bin', import.meta.url));
  installChuTorso(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}
