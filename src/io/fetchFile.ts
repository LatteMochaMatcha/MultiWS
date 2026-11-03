/**
 * 取工坊自己带的数据文件（二次元素体、成品角色）。
 *
 * 页面打开以后，这些文件是用到时才取的。要是那时候工坊的程序已经关了
 * （exe 的黑色窗口被关掉，或者 npm run dev 停了），浏览器只会报一句「Failed to fetch」；
 * 这里换成一句看得懂、知道该怎么办的话。
 */

import { t } from '../i18n';

/** 连不上工坊的程序 */
export class OfflineError extends Error {
  constructor() {
    super(t('连不上工坊的程序，它可能已经关掉了。重新打开它（双击 exe，或者 npm run dev），回到这个页面就会自动重试'));
    this.name = 'OfflineError';
  }
}

/** 把 url 指的文件整个取回来。what 是这个文件的叫法，报错时用 */
export async function fetchFile(url: string, what: string): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new OfflineError();
  }
  if (!response.ok) throw new Error(t('{what}没取到（{status}）', { what, status: response.status }));
  try {
    return await response.arrayBuffer();
  } catch {
    // 取到一半断了
    throw new OfflineError();
  }
}
