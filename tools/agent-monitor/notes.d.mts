/** 问题单（见 notes.mjs）：页面能送来的图 */
export const NOTE_IMAGES: string[];

/** 文件夹名：本机时间，加那句话的头十几个字 */
export function noteName(text: unknown, at?: Date): string;

/** 存一张问题单，返回它的文件夹 */
export function saveNote(root: string, data: { note?: Record<string, unknown>; images?: Record<string, string> }, at?: Date): string;

/** 最近的几张问题单，新的在前 */
export function listNotes(
  root: string,
  limit?: number,
): { name: string; dir: string; createdAt: string | null; text: string; mode: string | null; strokes: number; files: string[] }[];
