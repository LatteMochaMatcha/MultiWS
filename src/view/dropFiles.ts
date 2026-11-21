/**
 * 拖进窗口的东西：文件、文件夹都取出来，文件夹里的带着路径（模型里写的「textures/木纹.png」才对得上）。
 */

/** 文件夹里最多取多少个文件：再多的多半是拖错了东西 */
const DROP_MAX = 4000;

interface Entry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (file: File) => void, fail: (error: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: Entry[]) => void, fail: (error: unknown) => void) => void };
}

export async function droppedFiles(data: DataTransfer): Promise<{ path: string; file: File }[]> {
  // 松手以后 data 里的东西就读不到了：先同步地把每一项取出来
  const roots: Entry[] = [];
  for (const item of [...data.items]) {
    const entry = item.kind === 'file' ? ((item as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null) : null;
    if (entry) roots.push(entry);
  }
  // 老浏览器不给「文件夹」那一套：只有文件
  if (!roots.length) return [...data.files].map((file) => ({ path: file.name, file }));

  const out: { path: string; file: File }[] = [];
  const walk = async (entry: Entry, folder: string): Promise<void> => {
    if (out.length >= DROP_MAX) return;
    const path = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isFile && entry.file) {
      const file = await new Promise<File | null>((resolve) => entry.file!(resolve, () => resolve(null)));
      if (file) out.push({ path, file });
      return;
    }
    if (!entry.isDirectory || !entry.createReader) return;
    const reader = entry.createReader();
    // 一次只给一批，读到空为止
    for (;;) {
      const batch = await new Promise<Entry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
      if (!batch.length) break;
      for (const child of batch) await walk(child, path);
    }
  };
  for (const entry of roots) await walk(entry, '');
  return out;
}
