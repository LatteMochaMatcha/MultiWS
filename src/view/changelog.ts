/**
 * 更新日志：每次打开工坊弹出来（最新一版的内容，更早的折叠在下面），勾上「不再提醒」这一版就不再自动弹，
 * 更新到新版本时再弹新版的；「⋯」菜单里的「更新日志」随时能打开。
 *
 * 内容就是仓库根上的 CHANGELOG.md（打包时当文字带进来），这里只认它用到的那几种写法：
 * 「## 版本（日期）」「### 小标题」「- 一条」「**一行粗体**」，行内的 **粗体** 和 `代码`。
 * 只用旧内核（安卓 WebView 83）也有的东西。
 */
import { LANG, t } from '../i18n';

export interface Release {
  version: string;
  /** 括号里写的：日期，或者「未发布」 */
  date: string;
  lines: { kind: 'heading' | 'label' | 'item' | 'text'; text: string }[];
}

/** 把 CHANGELOG.md 拆成一版一版，新的在前（文件里就是这个顺序） */
export function parseChangelog(md: string): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const release = /^##\s+(.+)$/.exec(line);
    if (release && !line.startsWith('###')) {
      const title = /^(.+?)\s*[（(](.+?)[）)]\s*$/.exec(release[1]);
      current = { version: (title ? title[1] : release[1]).trim(), date: title ? title[2].trim() : '', lines: [] };
      releases.push(current);
      continue;
    }
    // 第一个「## 版本」之前的（文件标题）不要
    if (!current) continue;
    const heading = /^###\s+(.+)$/.exec(line);
    const item = /^[-*]\s+(.+)$/.exec(line);
    const label = /^\*\*(.+)\*\*$/.exec(line);
    if (heading) current.lines.push({ kind: 'heading', text: heading[1] });
    else if (item) current.lines.push({ kind: 'item', text: item[1] });
    else if (label && !label[1].includes('**')) current.lines.push({ kind: 'label', text: label[1] });
    else current.lines.push({ kind: 'text', text: line });
  }
  return releases;
}

/** 勾了「不再提醒」的是哪一版 */
const MUTE_KEY = 'oc-basemesh-changelog';

const SOURCE = Object.values(import.meta.glob<string>('../../CHANGELOG.md', { eager: true, query: '?raw', import: 'default' }))[0] ?? '';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 行内的 **粗体** 和 `代码` */
function inline(parent: HTMLElement, text: string) {
  for (const piece of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
    if (!piece) continue;
    if (piece.startsWith('**')) parent.appendChild(el('b', '', piece.slice(2, -2)));
    else if (piece.startsWith('`')) parent.appendChild(el('code', '', piece.slice(1, -1)));
    else parent.appendChild(document.createTextNode(piece));
  }
}

function renderRelease(release: Release, withTitle: boolean): HTMLElement {
  const box = el('div', 'changelog-release');
  if (withTitle) box.appendChild(el('h3', '', release.date ? `${release.version} · ${release.date}` : release.version));
  let list: HTMLUListElement | null = null;
  for (const line of release.lines) {
    if (line.kind === 'item') {
      if (!list) {
        list = el('ul');
        box.appendChild(list);
      }
      inline(list.appendChild(el('li')), line.text);
      continue;
    }
    list = null;
    if (line.kind === 'heading') box.appendChild(el('h4', '', line.text));
    else if (line.kind === 'label') box.appendChild(el('p', 'changelog-label', line.text));
    else inline(box.appendChild(el('p')), line.text);
  }
  return box;
}

export interface Changelog {
  /** 打开更新日志 */
  open(): void;
  /** 开着就关掉（安卓返回键用）：关了一个是 true */
  close(): boolean;
}

/**
 * 接上页面里的更新日志框（index.html 的 #changelogDialog）和菜单里的按钮。
 * canPopUp：现在能不能自动弹（新手引导开着、第一次打开还没看过引导时不弹）。
 * 开发服务器上不自动弹（别的工具、脚本开页面时不被它挡住），地址里带 ?changelog 才弹
 */
export function installChangelog(canPopUp: () => boolean): Changelog {
  const dialog = document.getElementById('changelogDialog') as HTMLDialogElement;
  const body = document.getElementById('changelogBody')!;
  const mute = document.getElementById('changelogMute') as HTMLInputElement;
  const releases = parseChangelog(SOURCE);
  const latest = releases[0];

  const muted = (): string | null => {
    try {
      return localStorage.getItem(MUTE_KEY);
    } catch {
      return null;
    }
  };

  if (latest) {
    document.getElementById('changelogTitle')!.textContent = `${t('更新日志')} · ${latest.version}${latest.date ? `（${latest.date}）` : ''}`;
    // 更新日志只有中文：英文、日文界面上说一声
    if (LANG !== 'zh') body.appendChild(el('p', 'note', t('更新日志只有中文。')));
    body.appendChild(renderRelease(latest, false));
    if (releases.length > 1) {
      const older = el('details', 'changelog-older');
      older.appendChild(el('summary', '', t('更早的版本')));
      for (const release of releases.slice(1)) older.appendChild(renderRelease(release, true));
      body.appendChild(older);
    }
  }

  const open = () => {
    if (!latest || dialog.open) return;
    mute.checked = muted() === latest.version;
    dialog.showModal();
    body.scrollTop = 0;
  };
  dialog.addEventListener('close', () => {
    if (!latest) return;
    try {
      if (mute.checked) localStorage.setItem(MUTE_KEY, latest.version);
      else localStorage.removeItem(MUTE_KEY);
    } catch {
      // 记不住就下次再弹
    }
  });
  document.getElementById('btnChangelog')?.addEventListener('click', open);

  const wanted = !import.meta.env?.DEV || new URLSearchParams(location.search).has('changelog');
  if (latest && wanted && muted() !== latest.version) {
    // 等模型出来、新手引导决定了弹不弹以后再说
    window.setTimeout(() => {
      if (canPopUp()) open();
    }, 1200);
  }

  return {
    open,
    close() {
      if (!dialog.open) return false;
      dialog.close();
      return true;
    },
  };
}
