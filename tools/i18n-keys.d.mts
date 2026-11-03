export interface KeyRef {
  file: string;
  line: number;
  code: string;
}
export interface Key {
  key: string;
  refs: KeyRef[];
}
export interface Report {
  keys: Map<string, Key>;
  problems: string[];
  missing: Record<'en' | 'ja', string[]>;
  unused: Partial<Record<'en' | 'ja', string[]>>;
  badVars: string[];
}
/** 项目根目录 */
export const ROOT: string;
export function normKey(s: string): string;
export function placeholders(s: string): string[];
export function loadDict(root: string | undefined, lang: 'en' | 'ja'): { dict: Record<string, string>; dups: string[] };
export function collectKeys(root?: string, only?: string[]): { keys: Map<string, Key>; problems: string[] };
export function report(root?: string, only?: string[]): Report;
