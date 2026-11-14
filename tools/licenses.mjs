// 把随软件一起分发的开源库（package.json 的 dependencies 和它们带的依赖）的许可声明汇成一份，
// 写到 dist/third-party-licenses.txt：打包时跟着网页一起进 exe、apk 和自动更新。
// MIT、Apache-2.0、BSD 这些许可都要求分发时附上许可原文和版权声明。
//   node tools/licenses.mjs            写到 dist/
//   node tools/licenses.mjs <目录>     写到别的目录
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'dist'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));

/** 许可原文一样的包并在一起（几十个 Apache-2.0 的包只写一遍原文） */
const byText = new Map();
/** 包里没带许可文件的：只列名字和许可的名称 */
const bare = [];
let count = 0;
for (const [dir, info] of Object.entries(lock.packages)) {
  // 只要随软件分发的：开发时才用的（vite、vitest、typescript……）不算
  if (!dir || info.dev || info.devOptional) continue;
  const at = join(root, dir);
  if (!existsSync(at)) continue;
  const pkg = JSON.parse(readFileSync(join(at, 'package.json'), 'utf8'));
  const id = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? '许可见包内');
  const name = `${pkg.name}@${pkg.version}`;
  count++;
  const files = readdirSync(at).filter((file) => /^(licen[sc]e|copying|notice)(\.|-|$)/i.test(file)).sort();
  if (!files.length) {
    bare.push(`${name} — ${id}`);
    continue;
  }
  const text = files.map((file) => readFileSync(join(at, file), 'utf8').replace(/\r\n/g, '\n').trim()).join('\n\n');
  const entry = byText.get(text) ?? { id, names: [] };
  entry.names.push(name);
  byText.set(text, entry);
}

const line = '='.repeat(78);
const parts = [
  'OC 白模工坊 / OC Base Mesh Workshop — third-party software notices',
  '',
  `这份软件里用到了下面 ${count} 个开源库，各自的许可原文和版权声明照录如下。`,
  `This software includes the ${count} open-source packages listed below; their licence texts and copyright notices follow.`,
];
for (const [text, entry] of [...byText].sort((a, b) => a[1].names[0].localeCompare(b[1].names[0]))) {
  parts.push('', line, `${entry.id}:`, ...entry.names.sort().map((name) => `  ${name}`), line, '', text);
}
if (bare.length) parts.push('', line, '包里没有单独的许可文件 / no separate licence file in the package:', ...bare.sort().map((name) => `  ${name}`), line);

mkdirSync(out, { recursive: true });
const file = join(out, 'third-party-licenses.txt');
writeFileSync(file, `${parts.join('\n')}\n`, 'utf8');
console.log(`第三方许可声明：${count} 个包，${byText.size} 份不同的许可原文 → ${file}`);
