/**
 * 问题单：用户在工坊页面上画红圈、写一句话（src/dev/annotate.ts），存成一个文件夹，agent 打开就能照原样复现。
 * 开发服务器收到页面送来的问题单就写进 notes/（plugin.mjs）；`npm run agent -- notes` 直接读这个文件夹，服务器关着也能看。
 *
 * 一张问题单一个文件夹，名字是时间加那句话的头几个字：notes/2026-11-02_223015_手腕凹下去/
 *   screen.png  当时屏幕上的 3D 视图，画着红圈
 *   clean.png   同一张，不带红圈
 *   note.json   那句话、红圈在哪、画面多大、页面和镜头、完整的设定和姿势、读数、选中的部件……
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 页面能送来的图（别的名字不认，免得往别处写文件） */
export const NOTE_IMAGES = ['screen.png', 'clean.png'];

const pad = (n) => String(n).padStart(2, '0');

/** 文件夹名：本机时间，加那句话的头十几个字（去掉文件名里不能有的字符） */
export function noteName(text, at = new Date()) {
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}_${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  const head = String(text ?? '')
    .replace(/[\\/:*?"<>|.\s\x00-\x1f]+/g, ' ')
    .trim()
    .slice(0, 16)
    .trim()
    .replace(/ +/g, '_');
  return head ? `${stamp}_${head}` : stamp;
}

/** 存一张问题单，返回它的文件夹。data：{ note: {…}, images: { 'screen.png': base64, 'clean.png': base64 } } */
export function saveNote(root, data, at = new Date()) {
  const note = data?.note;
  if (!note || typeof note !== 'object' || Array.isArray(note)) throw new Error('问题单是空的');
  mkdirSync(root, { recursive: true });
  const name = noteName(note.text, at);
  let dir = join(root, name);
  for (let k = 2; existsSync(dir); k++) dir = join(root, `${name}_${k}`);
  mkdirSync(dir);
  const files = [];
  for (const file of NOTE_IMAGES) {
    const base64 = data.images?.[file];
    if (typeof base64 !== 'string' || !base64) continue;
    writeFileSync(join(dir, file), Buffer.from(base64, 'base64'));
    files.push(file);
  }
  writeFileSync(join(dir, 'note.json'), `${JSON.stringify({ ...note, files }, null, 2)}\n`);
  return dir;
}

/** 最近的几张问题单，新的在前：文件夹、什么时候、那句话、在哪个模式、有哪些图 */
export function listNotes(root, limit = 20) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const name of readdirSync(root).sort().reverse()) {
    const file = join(root, name, 'note.json');
    if (!existsSync(file)) continue;
    let note;
    try {
      note = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    out.push({
      name,
      dir: join(root, name),
      createdAt: note.createdAt ?? null,
      text: note.text ?? '',
      mode: note.snapshot?.mode ?? null,
      strokes: Array.isArray(note.strokes) ? note.strokes.length : 0,
      files: note.files ?? [],
    });
    if (out.length >= limit) break;
  }
  return out;
}
