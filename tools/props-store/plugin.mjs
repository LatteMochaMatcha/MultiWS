/**
 * 开发服务器上顶替下载站：写实款道具的文件（tools/build-props-real.ts 转好放在 .props-store/ 里，文件名是内容的 SHA-256）
 * 从 /__props/<SHA-256> 取。只挂在开发服务器上；打包出来的工坊是从下载站取的（地址在 src/props/realMeta.json）。
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function propsStore() {
  return {
    name: 'props-store',
    configureServer(server) {
      const dir = join(server.config.root, '.props-store');
      server.middlewares.use('/__props', (req, res) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, '');
        const path = join(dir, name);
        if (req.method !== 'GET' || !/^[0-9a-f]{64}$/.test(name) || !existsSync(path)) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', String(statSync(path).size));
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(path).pipe(res);
      });
    },
  };
}
