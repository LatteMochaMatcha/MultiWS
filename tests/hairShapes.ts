import { readFileSync } from 'node:fs';
import { type HairShape, hairReady, hairShapeUrl, installHairShape } from '../src/hair/shapes';

export const HAIR_SHAPES: readonly HairShape[] = ['long', 'sidetail', 'bob', 'twintails'];

/** 测试里用：从磁盘把白模用的头发数据读进来登记好（浏览器里是 fetch 回来的） */
export function useHairShapes() {
  for (const style of HAIR_SHAPES) {
    if (hairReady(style)) continue;
    const bytes = readFileSync(new URL(`../public/${hairShapeUrl(style)}`, import.meta.url));
    installHairShape(style, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }
}
