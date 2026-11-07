/**
 * 旧内核上的显示问题绕开的办法（函数缺的补在 src/polyfill.ts）。
 *
 * Chrome 83（没装 Google Play 的国行安卓 10 手机，2026-11 vivo Y30 标准版）给 sRGB 贴图自动生成缩小图（mipmap）时会出错：
 * 成品角色的头发一片黑、皮肤和衣服大半不见，不报任何错。Chrome 121 上没这个毛病；中间哪一版修好的不清楚，
 * 110 以下一律关掉这类贴图的缩小图（代价是远看时贴图有点闪）。
 */
import * as THREE from 'three';

/** Chrome / WebView 的主版本号；不是 Chrome 内核就是 null */
export const CHROME_MAJOR: number | null = (() => {
  const m = typeof navigator === 'undefined' ? null : /Chrome\/(\d+)/.exec(navigator.userAgent);
  return m ? Number(m[1]) : null;
})();

const OLD_SRGB_MIPMAPS = CHROME_MAJOR !== null && CHROME_MAJOR < 110;

/** 把贴图标成 sRGB；旧内核上顺便关掉缩小图 */
export function srgbTexture<T extends THREE.Texture>(texture: T): T {
  texture.colorSpace = THREE.SRGBColorSpace;
  if (OLD_SRGB_MIPMAPS) {
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
  }
  return texture;
}
