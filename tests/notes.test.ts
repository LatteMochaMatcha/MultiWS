// 问题单（tools/agent-monitor/notes.mjs）：起名、存、列出来
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listNotes, noteName, saveNote } from '../tools/agent-monitor/notes.mjs';

const root = mkdtempSync(join(tmpdir(), 'oc-notes-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const at = new Date(2026, 10, 2, 22, 30, 15);
const png = Buffer.from('\x89PNG fake', 'latin1').toString('base64');

describe('问题单', () => {
  it('文件夹名是时间加那句话的头几个字，文件名里不能有的字符去掉', () => {
    expect(noteName('手腕凹下去了', at)).toBe('2026-11-02_223015_手腕凹下去了');
    expect(noteName('a/b:c*d?  e.f', at)).toBe('2026-11-02_223015_a_b_c_d_e_f');
    expect(noteName('', at)).toBe('2026-11-02_223015');
    expect(noteName('一二三四五六七八九十一二三四五六七八', at)).toBe('2026-11-02_223015_一二三四五六七八九十一二三四五六');
  });

  it('存图和 note.json；只认那两张图的名字', () => {
    const dir = saveNote(root, { note: { text: '肩头鼓包', strokes: [[[0.1, 0.2]]] }, images: { 'screen.png': png, 'clean.png': png, '../evil.png': png } }, at);
    expect(readdirSync(dir).sort()).toEqual(['clean.png', 'note.json', 'screen.png']);
    const note = JSON.parse(readFileSync(join(dir, 'note.json'), 'utf8'));
    expect(note).toMatchObject({ text: '肩头鼓包', files: ['screen.png', 'clean.png'] });
    expect(Buffer.from(readFileSync(join(dir, 'screen.png'))).toString('latin1')).toBe('\x89PNG fake');
  });

  it('同一秒存两张不会盖掉', () => {
    const a = saveNote(root, { note: { text: '同一秒' }, images: {} }, at);
    const b = saveNote(root, { note: { text: '同一秒' }, images: {} }, at);
    expect(a).not.toBe(b);
  });

  it('空的问题单不存', () => {
    expect(() => saveNote(root, { images: {} }, at)).toThrow('问题单是空的');
  });

  it('列出来：新的在前', () => {
    saveNote(root, { note: { text: '后来的', snapshot: { mode: 'pose' }, strokes: [[], []] }, images: {} }, new Date(2026, 10, 3, 9, 0, 0));
    const list = listNotes(root, 2);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ text: '后来的', mode: 'pose', strokes: 2 });
    expect(listNotes(join(root, '没有这个'))).toEqual([]);
  });
});
