// 界面文字的键：从 src 里的 t('…') / tk('…') 和 index.html 里写死的中文抽出来，对照 src/i18n/en、ja 下的译文。
//   node tools/i18n-keys.mjs                  只报数：多少键、各缺多少、有没有毛病
//   node tools/i18n-keys.mjs --dump [目录]     把键（带出处和那一行代码）、缺的键写成 JSON，默认 .harness-tmp/i18n/
//   node tools/i18n-keys.mjs --file src/main.ts   只看某个文件里的键（可以写多次）
// 规整法和 src/i18n/index.ts 的 normKey、translateDom 一致。写法见 docs/i18n.md。
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CJK = /[぀-ヿ㐀-鿿]/;
const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** 项目根目录（这个脚本在 tools/ 里） */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const normKey = (s) => s.replace(/\s+/g, ' ').trim();

const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const lineOf = (src, i) => src.slice(0, i).split('\n').length;

/** 读一个字符串字面量（i 指着开头的引号），返回内容和结束下标；模板字符串里有 ${} 的返回 null */
function readLiteral(src, i) {
  const q = src[i];
  let j = i + 1;
  let text = '';
  while (j < src.length && src[j] !== q) {
    if (src[j] === '\\') {
      const n = src[j + 1];
      text += n === 'n' ? '\n' : n === 't' ? '\t' : n;
      j += 2;
      continue;
    }
    if (q === '`' && src[j] === '$' && src[j + 1] === '{') return null;
    text += src[j];
    j++;
  }
  return { text, end: j + 1 };
}

/** 源码里 t( / tk( 的调用：字面量参数收作键，不是字面量的 t( 记下来（tk 必须是字面量） */
function scanTs(file, root, keys, problems) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(root, file).replaceAll('\\', '/');
  const re = /(?<![\w$.])(tk?)\(\s*/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const at = m.index + m[0].length;
    const ch = src[at];
    const line = lineOf(src, m.index);
    // 跳过注释里的
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const before = src.slice(lineStart, m.index);
    if (/\/\/|^\s*\*/.test(before)) continue;
    if (ch === "'" || ch === '"' || ch === '`') {
      const lit = readLiteral(src, at);
      if (!lit) {
        problems.push(`${rel}:${line} ${m[1]}() 的模板字符串里有 \${}：变的部分改成 {占位符}`);
        continue;
      }
      const after = src.slice(lit.end).match(/^\s*([,)+])/);
      if (after?.[1] === '+') problems.push(`${rel}:${line} ${m[1]}() 的参数是拼起来的：并成一个字面量`);
      add(keys, lit.text, rel, line, src.slice(lineStart, src.indexOf('\n', at)).trim());
    } else if (m[1] === 'tk') {
      problems.push(`${rel}:${line} tk() 的参数必须是字面量`);
    }
  }
}

function add(keys, key, file, line, code) {
  if (!key.trim()) return;
  let k = keys.get(key);
  if (!k) keys.set(key, (k = { key, refs: [] }));
  k.refs.push({ file, line, code: code.slice(0, 240) });
}

/** index.html：照 translateDom 的规矩抽文字节点、属性、data-i18n-html 整段 */
function scanHtml(file, root, keys) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(root, file).replaceAll('\\', '/');
  const stack = []; // { tag, skip, html?: 开始下标 }
  const tagRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  let last = 0;
  const skipping = () => stack.some((s) => s.skip);
  const text = (from, to) => {
    if (skipping()) return;
    const raw = decode(src.slice(from, to));
    if (CJK.test(raw)) add(keys, normKey(raw), rel, lineOf(src, from), normKey(raw));
  };
  for (let m = tagRe.exec(src); m; m = tagRe.exec(src)) {
    text(last, m.index);
    last = tagRe.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    const tag = m[1].toLowerCase();
    const attrs = m[2] ?? '';
    if (m[0].startsWith('</')) {
      // 往回找同名的开始标签
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag !== tag) continue;
        const open = stack[i];
        stack.length = i;
        if (open.html !== undefined && !skipping()) {
          const inner = normKey(src.slice(open.html, m.index));
          if (CJK.test(inner)) add(keys, inner, rel, lineOf(src, open.html), inner);
        }
        break;
      }
      continue;
    }
    const attr = (name) => {
      const a = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
      return a ? decode(a[2] ?? a[3] ?? '') : null;
    };
    const no = attr('translate') === 'no';
    if (!no && !skipping()) {
      for (const a of ATTRS) {
        const v = attr(a);
        if (v && CJK.test(v)) add(keys, normKey(v), rel, lineOf(src, m.index), `${a}="${v}"`);
      }
    }
    if (VOID.has(tag) || m[0].endsWith('/>')) continue;
    const isHtml = /\sdata-i18n-html(\s|=|$)/.test(attrs);
    const isSkip = no || tag === 'script' || tag === 'style';
    stack.push({ tag, skip: isSkip || (isHtml && !skipping()) ? true : false, html: isHtml && !skipping() ? tagRe.lastIndex : undefined });
    // <title> 里的字照文字节点算
  }
  text(last, src.length);
}

/** 占位符：{name} 和 {name:一|多} 都算 name */
export const placeholders = (s) => [...s.matchAll(/\{(\w+)(?::[^{}|]*\|[^{}]*)?\}/g)].map((m) => m[1]).sort();

export function loadDict(root, lang) {
  const dir = join(root, 'src/i18n', lang);
  const out = {};
  const dups = [];
  if (!existsSync(dir)) return { dict: out, dups };
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    for (const [k, v] of Object.entries(data)) {
      if (k in out && out[k] !== v) dups.push(`${lang}/${name}: 「${k}」和别的文件译法不同`);
      out[k] = v;
    }
  }
  return { dict: out, dups };
}

export function collectKeys(root, only) {
  const keys = new Map();
  const problems = [];
  const files = walk(join(root, 'src')).filter((f) => !/[\\/]i18n[\\/]/.test(f));
  for (const f of files) {
    const rel = relative(root, f).replaceAll('\\', '/');
    if (only?.length && !only.includes(rel)) continue;
    scanTs(f, root, keys, problems);
  }
  if (!only?.length || only.includes('index.html')) scanHtml(join(root, 'index.html'), root, keys);
  return { keys, problems };
}

export function report(root, only) {
  const { keys, problems } = collectKeys(root, only);
  const out = { keys, problems: [...problems], missing: {}, unused: {}, badVars: [] };
  for (const lang of ['en', 'ja']) {
    const { dict, dups } = loadDict(root, lang);
    out.problems.push(...dups);
    out.missing[lang] = [...keys.keys()].filter((k) => !dict[k]);
    if (!only?.length) out.unused[lang] = Object.keys(dict).filter((k) => !keys.has(k));
    for (const k of keys.keys()) {
      if (!dict[k]) continue;
      const a = placeholders(k).join(',');
      const b = [...new Set(placeholders(dict[k]))].sort().join(',');
      if ([...new Set(placeholders(k))].sort().join(',') !== b) out.badVars.push(`${lang}: 「${k}」占位符 {${a}} 和译文 {${b}} 对不上`);
    }
  }
  return out;
}

function main(argv) {
  const root = ROOT;
  const only = [];
  let dump = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') only.push(argv[++i].replaceAll('\\', '/'));
    else if (argv[i] === '--dump') dump = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : join(root, '.harness-tmp/i18n');
  }
  const r = report(root, only);
  console.log(`键 ${r.keys.size} 个；缺英文 ${r.missing.en.length}，缺日文 ${r.missing.ja.length}`);
  if (r.unused.en) console.log(`没用到的译文：英文 ${r.unused.en.length}，日文 ${r.unused.ja.length}`);
  for (const p of [...r.problems, ...r.badVars]) console.log('  ! ' + p);
  if (dump) {
    mkdirSync(dump, { recursive: true });
    const list = [...r.keys.values()];
    writeFileSync(join(dump, 'keys.json'), JSON.stringify(list, null, 1));
    for (const lang of ['en', 'ja']) {
      const miss = list.filter((k) => r.missing[lang].includes(k.key));
      writeFileSync(join(dump, `missing-${lang}.json`), JSON.stringify(miss, null, 1));
    }
    console.log(`写到 ${dump}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
