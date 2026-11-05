/**
 * 把一段数据存成文件。
 * 浏览器里走普通的下载流程；装成安卓应用时（tools/android 那个外壳）没有「下载」这回事，改由外壳替网页写进手机的存储。
 */

import { t } from '../i18n';

/** 安卓外壳留给网页的接口（见 tools/android 里的 MainActivity.java）。每一步返回空字符串是成功，否则是出错的原因 */
interface AndroidShell {
  begin(name: string): string;
  write(base64: string): string;
  end(): string;
  abort(): void;
}

const shell = (globalThis as { OcAndroid?: AndroidShell }).OcAndroid;

/** 现在是不是跑在安卓外壳里 */
export const inAndroidShell = shell !== undefined;

/** 外壳把文件放进「下载」「图片」下面这个名字的文件夹（和 MainActivity.java 里的 FOLDER 一致） */
const SHELL_FOLDER = 'OC白模工坊';
/** 一次交给外壳多少字节。是 3 的倍数：每一段单独转成 base64，接起来还是对的 */
const CHUNK = 3 * 256 * 1024;

function toBase64(bytes: Uint8Array): string {
  let text = '';
  // 一次展开太多参数会撑爆调用栈：分小段拼
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

async function saveViaShell(android: AndroidShell, filename: string, blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const check = (problem: string) => {
    if (!problem) return;
    android.abort();
    throw new Error(t('没能写进手机的存储（{problem}）', { problem }));
  };
  check(android.begin(filename));
  for (let at = 0; at < bytes.length; at += CHUNK) check(android.write(toBase64(bytes.subarray(at, at + CHUNK))));
  check(android.end());
  return /\.png$/i.test(filename) ? t('在相册的「{folder}」里', { folder: SHELL_FOLDER }) : t('在手机「下载」文件夹的「{folder}」里', { folder: SHELL_FOLDER });
}

/**
 * 用户填的文件名（不带扩展名）：Windows、安卓不认的字去掉，首尾空格、末尾的点去掉，自己写了 .json 的也去掉（存的时候统一加），
 * 最多 80 个字。什么都不剩就是空字符串
 */
export function cleanFileName(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .replace(/\.json$/i, '')
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim();
}

/** 把一段数据存成文件。返回一句话，说文件到哪去了 */
export async function saveBlob(filename: string, blob: Blob): Promise<string> {
  if (shell) return saveViaShell(shell, filename, blob);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // 留一点时间让下载开始再回收
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return t('在浏览器的下载文件夹里');
}

export function saveText(filename: string, text: string, type = 'application/json'): Promise<string> {
  return saveBlob(filename, new Blob([text], { type }));
}
