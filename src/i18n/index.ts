/**
 * 界面文字的中、英、日三语。
 *
 * 键就是中文原文：代码里写 t('撤销')，英文、日文到 en/、ja/ 下的 JSON 里按原文查，查不到就显示中文。
 * 带变量的写成占位符：t('已导出 {file}', { file: name })；英文要分单复数时译文里写 {n:arm|arms}。
 * 语言在页面载入时定下来（设置里改了就存起来、整页重新载入），所以模块顶层的常量里也能直接用 t()。
 * 写法和术语表见 docs/i18n.md。
 */

export type Lang = 'zh' | 'en' | 'ja';

export const LANGS: readonly { key: Lang; label: string }[] = [
  { key: 'zh', label: '中文' },
  { key: 'en', label: 'English' },
  { key: 'ja', label: '日本語' },
];

const LANG_KEY = 'oc-basemesh-lang';

const isLang = (v: unknown): v is Lang => v === 'zh' || v === 'en' || v === 'ja';

function fromLocale(list: readonly string[]): Lang {
  for (const l of list) {
    const s = l.toLowerCase();
    if (s.startsWith('zh')) return 'zh';
    if (s.startsWith('ja')) return 'ja';
    if (s.startsWith('en')) return 'en';
  }
  return 'en';
}

function detect(): Lang {
  // 网格线程：主页面建线程时把语言写在线程名里（lang=en）
  if (typeof document === 'undefined') {
    const name = typeof self !== 'undefined' && 'name' in self ? String((self as { name?: unknown }).name ?? '') : '';
    const m = /lang=(zh|en|ja)/.exec(name);
    // 测试、Node 脚本里一律中文
    return m ? (m[1] as Lang) : 'zh';
  }
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (isLang(q)) return q;
    const saved = localStorage.getItem(LANG_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // 存储被禁用时照系统语言
  }
  return fromLocale(navigator.languages?.length ? navigator.languages : [navigator.language ?? '']);
}

export const LANG: Lang = detect();

/** 换语言：记下来，整页重新载入（设定本来就存着，重新载入后原样回来） */
export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // 记不住也照样换这一次
  }
  const url = new URL(location.href);
  url.searchParams.delete('lang');
  if (url.href !== location.href) history.replaceState(null, '', url.href);
  location.reload();
}

type Dict = Record<string, string>;

/**
 * 译文表当成文字取进来再 JSON.parse。当成 JSON 模块导入的话，打包时键会写成不带引号的名字，
 * 「ヴィクトリア・ルービン」里的「・」到 Unicode 15.1 才能放进名字：旧内核（安卓 WebView 110）整个脚本读不了，页面一片空白
 */
function merge(files: Record<string, string>): Dict {
  const out: Dict = {};
  for (const name of Object.keys(files).sort()) Object.assign(out, JSON.parse(files[name]) as Dict);
  return out;
}

const TABLES: Record<Exclude<Lang, 'zh'>, Dict> = {
  en: merge(import.meta.glob<string>('./en/*.json', { eager: true, query: '?raw', import: 'default' })),
  ja: merge(import.meta.glob<string>('./ja/*.json', { eager: true, query: '?raw', import: 'default' })),
};

const table: Dict | null = LANG === 'zh' ? null : TABLES[LANG];

/** 开发时记下查不到的键，`__oc` 和测试接口能读到 */
export const missing = new Set<string>();

function lookup(key: string): string | undefined {
  if (!table) return undefined;
  const hit = table[key];
  if (hit) return hit;
  if (!missing.has(key)) {
    missing.add(key);
    if (import.meta.env?.DEV) console.warn(`[i18n] ${LANG} 缺译文：${key}`);
  }
  return undefined;
}

type Vars = Record<string, string | number>;

/** 填占位符：{name} 换成值；{n:one|other} 照 n 是不是 1 选一个 */
function fill(s: string, vars: Vars): string {
  return s.replace(/\{(\w+)(?::([^{}|]*)\|([^{}]*))?\}/g, (whole, name: string, one?: string, other?: string) => {
    if (!(name in vars)) return whole;
    const v = vars[name];
    if (one === undefined) return String(v);
    return Number(v) === 1 ? one : (other ?? '');
  });
}

/**
 * 同一句中文在不同地方要译成不同的话时，键后面加 @@语境（「头 {n}」是第几个头，「头 {n}@@数量」是几个头），
 * 显示中文时去掉
 */
const bare = (key: string) => {
  const at = key.indexOf('@@');
  return at < 0 ? key : key.slice(0, at);
};

/** 界面文字：参数必须是中文原文的字面量（抽键脚本只认字面量），变的部分用占位符 */
export function t(zh: string, vars?: Vars): string {
  const s = lookup(zh) ?? bare(zh);
  return vars ? fill(s, vars) : s;
}

/** 一个键在三种语言里的写法（没译的语言不算），给「存的是不是某句默认文字」这类判断用 */
export function variants(zh: string): string[] {
  return [zh, TABLES.en[zh], TABLES.ja[zh]].filter((s): s is string => !!s);
}

/**
 * 只登记、不翻译：给要拿中文原文当键或拿来比较的数据用，显示的时候再 t(变量)。
 * 抽键脚本把 tk('…') 里的字面量也算作要翻译的键。
 */
export function tk<S extends string>(zh: S): S {
  return zh;
}

/* ================= 页面上写死的文字（index.html） ================= */

const CJK = /[぀-ヿ㐀-鿿]/;
const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'] as const;

/** 抽键脚本和页面用同一个规整法：连续空白并成一个空格，去掉首尾空白 */
export function normKey(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function skip(el: Element | null): boolean {
  return !!el?.closest('script, style, [translate="no"], [data-i18n-html]');
}

/**
 * 把一段 DOM 里的中文换成当前语言：文字节点、title / placeholder / aria-label / alt 按原文查；
 * 带 data-i18n-html 的元素整段按规整后的 innerHTML 查（段落里夹着 <code>、<b> 之类的）。
 * translate="no" 的不动。
 */
export function translateDom(root: ParentNode): void {
  if (!table) return;
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-html]')) {
    if (el.parentElement && skip(el.parentElement)) continue;
    const hit = lookup(normKey(el.innerHTML));
    if (hit) el.innerHTML = hit;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = node.nodeValue ?? '';
    if (!CJK.test(raw) || skip(node.parentElement)) continue;
    const hit = lookup(normKey(raw));
    if (hit) node.nodeValue = (/^\s*/.exec(raw)?.[0] ?? '') + hit + (/\s*$/.exec(raw)?.[0] ?? '');
  }
  const scope = root instanceof Element ? [root, ...root.querySelectorAll('*')] : [...root.querySelectorAll('*')];
  for (const el of scope) {
    if (el.closest('[translate="no"]')) continue;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v || !CJK.test(v)) continue;
      const hit = lookup(normKey(v));
      if (hit) el.setAttribute(a, hit);
    }
  }
}

/** 页面一载入就调：换 <html lang>、标题，翻译写死在 index.html 里的文字 */
export function translatePage(): void {
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : LANG;
  document.documentElement.dataset.lang = LANG;
  if (!table) return;
  const title = lookup(normKey(document.title));
  if (title) document.title = title;
  translateDom(document.body);
}
