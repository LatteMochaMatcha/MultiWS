// 把转好的写实款道具（.props-store/<SHA-256>，tools/build-props-real.ts 出的）传到下载站 R2 的 props/ 目录。
// 用法：node tools/props-store/upload.mjs [--dry]        要先 npx wrangler login
// 只传下载站上还没有的；传之前核对本机文件的 SHA-256，传完从公开地址取回来再核对一遍。
// 最后查一下桶的跨域：网页是跨域取这些文件的，没开的话照 tools/update/r2-cors.json 设：
//   npx wrangler@4 r2 bucket cors set <桶名> --file tools/update/r2-cors.json
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dry = process.argv.includes('--dry');
const meta = JSON.parse(readFileSync(join(root, 'src/props/realMeta.json'), 'utf8'));
const { r2Bucket } = JSON.parse(readFileSync(join(root, 'tools/update/config.json'), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const folder = new URL(meta.store).pathname.replace(/^\//, '');

let sent = 0;
let failed = 0;
for (const asset of meta.assets) {
  const file = join(root, '.props-store', asset.sha256);
  const url = meta.store + asset.sha256;
  if ((await fetch(url, { method: 'HEAD' })).status === 200) {
    console.log(`已经有了  ${asset.id}`);
    continue;
  }
  if (!existsSync(file) || sha256(readFileSync(file)) !== asset.sha256) {
    console.error(`本机没有这个文件，或者内容对不上：${asset.id}（先跑 node tools/run.mjs tools/build-props-real.ts）`);
    failed++;
    continue;
  }
  if (dry) {
    console.log(`要传      ${asset.id}  ${(asset.bytes / 1e6).toFixed(1)} MB`);
    continue;
  }
  const put = spawnSync(
    'npx',
    ['--yes', 'wrangler@4', 'r2', 'object', 'put', `${r2Bucket}/${folder}${asset.sha256}`, '--file', file, '--content-type', 'application/octet-stream', '--cache-control', '"public, max-age=31536000, immutable"', '--remote'],
    { shell: true, encoding: 'utf8' },
  );
  const back = put.status === 0 ? await fetch(url, { cache: 'no-store' }) : null;
  if (back?.status === 200 && sha256(Buffer.from(await back.arrayBuffer())) === asset.sha256) {
    console.log(`传好了    ${asset.id}`);
    sent++;
  } else {
    console.error(`没传上    ${asset.id}\n${(put.stdout + put.stderr).trim().split('\n').slice(-4).join('\n')}`);
    failed++;
  }
}

const probe = meta.assets[0] && (await fetch(meta.store + meta.assets[0].sha256, { method: 'HEAD', headers: { Origin: 'http://localhost:5210' } }));
const cors = probe?.headers.get('access-control-allow-origin');
console.log(cors ? `跨域：开着（${cors}）` : `跨域：没开，网页取不到。设：npx wrangler@4 r2 bucket cors set ${r2Bucket} --file tools/update/r2-cors.json`);
console.log(`${meta.assets.length} 件，这次传了 ${sent} 件${failed ? `，${failed} 件没成` : ''}`);
process.exit(failed || !cors ? 1 : 0);
