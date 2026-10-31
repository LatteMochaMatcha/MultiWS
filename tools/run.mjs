// 运行一个用 TypeScript 写的工具脚本（它可以直接 import src 里的模块）：
//   node tools/run.mjs tools/build-poses.ts [参数…]
// 借 Vite 来读 TypeScript，不用另外装东西。脚本要导出一个 main(参数) 函数。
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error('用法：node tools/run.mjs <脚本.ts> [参数…]');
  process.exit(1);
}
const server = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'error', server: { middlewareMode: true, ws: false, hmr: false }, optimizeDeps: { noDiscovery: true } });
try {
  const module = await server.ssrLoadModule(`/${relative(root, resolve(script)).replaceAll('\\', '/')}`);
  await module.main(args, root);
} finally {
  await server.close();
}
