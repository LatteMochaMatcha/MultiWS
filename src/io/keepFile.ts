/**
 * 把用户给的文件（自己的 VRM）存在这台设备的浏览器里（IndexedDB），下次打开工坊还在。
 * 存不了（隐私模式、浏览器不让存）就当没存，不报错：只是下次要重新选一遍。
 */

const DB = 'oc-basemesh-files';
const STORE = 'files';

export interface KeptFile {
  name: string;
  bytes: ArrayBuffer;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('没有 IndexedDB'));
      return;
    }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 存一个文件（同一个 key 存过的会被换掉）。存不了返回 false */
export async function keepFile(key: string, file: KeptFile): Promise<boolean> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(file, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** 取存过的文件；没存过、取不出来都是 null */
export async function keptFile(key: string): Promise<KeptFile | null> {
  try {
    const db = await open();
    const found = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const file = found as Partial<KeptFile> | undefined;
    return file && typeof file.name === 'string' && file.bytes instanceof ArrayBuffer ? { name: file.name, bytes: file.bytes } : null;
  } catch {
    return null;
  }
}
