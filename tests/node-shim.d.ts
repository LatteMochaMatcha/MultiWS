// 测试里要从磁盘读素体的数据文件、在临时文件夹里存问题单。项目没有装 Node 的类型声明，这里只声明用得到的这一点。
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
  export function readFileSync(path: string | URL): Uint8Array;
  export function writeFileSync(path: string | URL, data: string | Uint8Array): void;
  export function mkdirSync(path: string | URL, options?: { recursive?: boolean }): void;
  export function mkdtempSync(prefix: string): string;
  export function readdirSync(path: string): string[];
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare const Buffer: {
  from(data: string | Uint8Array, encoding?: 'latin1' | 'base64' | 'utf8'): Uint8Array & { toString(encoding?: 'latin1' | 'base64' | 'utf8'): string };
};
