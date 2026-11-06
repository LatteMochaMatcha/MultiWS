// 给打包好的网页（dist）写文件清单 dist/update-manifest.json，软件内自动更新要用（见 docs/update-plan.md）。
// npm run build 最后一步会自动跑它；单独跑：node tools/run.mjs tools/update-manifest.ts
//
// 参数（发版脚本 tools/release.ps1 用）：
//   --notes <文件>  更新说明，一个 {"zh": "...", "en": "...", "ja": "..."} 的 JSON 文件
//   --out <文件>    清单另写一份到这里（dist 里那份照样写，但不带更新说明）
//   --dist <目录>   网页不在 dist 里时（另外打包到别处试的时候）
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { buildManifest, MANIFEST_NAME, type Manifest, type ManifestFile, serializeManifest } from '../src/update/manifest';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 后面要跟一个文件路径`);
  return value;
}

export async function main(args: string[], root: string): Promise<void> {
  const distOption = option(args, '--dist');
  const dist = distOption ? resolve(distOption) : join(root, 'dist');
  const version: string = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const { minShell } = JSON.parse(readFileSync(join(root, 'tools', 'update', 'config.json'), 'utf8')) as { minShell: number };

  const files: ManifestFile[] = [];
  for (const path of walk(dist)) {
    const name = relative(dist, path).replaceAll('\\', '/');
    if (name === MANIFEST_NAME) continue;
    const bytes = readFileSync(path);
    files.push({ path: name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const base = { version, minShell, published: new Date().toISOString(), notes: {}, files };
  const manifest = buildManifest(base);
  writeFileSync(join(dist, MANIFEST_NAME), serializeManifest(manifest), 'utf8');

  const out = option(args, '--out');
  if (out) {
    const notesPath = option(args, '--notes');
    const notes: Manifest['notes'] = notesPath ? JSON.parse(readFileSync(resolve(notesPath), 'utf8')) : {};
    writeFileSync(resolve(out), serializeManifest(buildManifest({ ...base, notes })), 'utf8');
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  console.log(`文件清单：${version}，${files.length} 个文件，${(total / 1024 / 1024).toFixed(1)} MB`);
}
