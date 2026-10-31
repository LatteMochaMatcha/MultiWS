// 测试里要从磁盘读素体的数据文件。项目没有装 Node 的类型声明，这里只声明用得到的这一点。
declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array;
  export function writeFileSync(path: string | URL, data: string | Uint8Array): void;
  export function mkdirSync(path: string | URL, options?: { recursive?: boolean }): void;
}
