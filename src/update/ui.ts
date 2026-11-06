// 网页上的更新入口（方案见 docs/update-plan.md 第 4 期）。只在外壳（exe）里出现，开发服务器上什么都不加：
//   - 3D 视图左上角一张卡片：有新版本（版本、大小、更新说明，现在更新 / 以后再说 / 跳过这一版）→ 下载进度 → 下好了（刷新）；
//   - 面板顶上一行：现在的版本号、「检查更新」按钮、「打开时自动检查更新」开关。
// 页面载入时调一次 installUpdateUi()，后面的事它自己管。
import './update.css';
import { LANG, t } from '../i18n';
import { type CardView, cardFor, detectShell, formatBytes, pickNotes, type ShellApi, type ShellStatus } from './shell';

const RELEASES = 'https://github.com/LatteMochaMatcha/MutliWS/releases';

export function installUpdateUi(): void {
  void start();
}

async function start(): Promise<void> {
  const found = await detectShell();
  if (!found) return;
  new UpdateUi(found.api, found.status);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, kind: 'primary' | 'plain' | 'ghost', onClick: () => void): HTMLButtonElement {
  const b = el('button', kind === 'plain' ? 'btn' : `btn ${kind}`, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

class UpdateUi {
  private status: ShellStatus;
  /** 这个页面载入时外壳给的版本：外壳换了新版、页面还没刷新时，它还是旧的 */
  private readonly pageVersion: string | null;
  /** 这次打开里点过「以后再说」的版本 */
  private readonly dismissed = new Set<string>();
  /** 「检查更新」是人点的：结果写在设置那一行上 */
  private manual = false;
  private timer = 0;

  private readonly card = el('div', 'update-card');
  private readonly rowVersion = el('span', 'update-version');
  private readonly rowCheck: HTMLButtonElement;
  private readonly rowAuto = el('input');
  private readonly rowNote = el('span', 'update-note');

  constructor(
    private readonly api: ShellApi,
    status: ShellStatus,
  ) {
    this.status = status;
    this.pageVersion = status.version;
    this.card.setAttribute('role', 'status');
    this.card.hidden = true;
    document.body.append(this.card);

    this.rowCheck = button(t('检查更新'), 'ghost', () => void this.check());
    this.rowAuto.type = 'checkbox';
    this.rowAuto.addEventListener('change', () => void this.act(() => this.api.settings({ autoCheck: this.rowAuto.checked })));
    const auto = el('label', 'update-auto');
    auto.append(this.rowAuto, document.createTextNode(t('打开时自动检查更新')));
    this.rowNote.setAttribute('aria-live', 'polite');
    const row = el('div', 'update-row');
    row.append(this.rowVersion, this.rowCheck, auto, this.rowNote);
    const header = document.querySelector('.panel-scroll > header');
    const repo = header?.querySelector('.repo');
    if (repo) repo.after(row);
    else if (header) header.append(row);

    this.render();
    this.follow();
    // 新手引导开着的时候不弹卡片：引导是页面载入后过一会儿才挂到 body 上的，开、关都重新看一次
    new MutationObserver(() => this.render()).observe(document.body, { childList: true });
  }

  /**
   * 外壳正在查、正在下的时候隔一会儿问一次。刚让外壳去查、去下时，它在后台才开始，第一次回话可能还是原来的状态：
   * kicked 是这之后至少再问几次
   */
  private kicked = 0;

  private follow(): void {
    window.clearTimeout(this.timer);
    const busy = this.status.status === 'checking' || this.status.status === 'downloading';
    if (!busy && this.kicked <= 0) return;
    if (!busy) this.kicked--;
    this.timer = window.setTimeout(() => void this.act(() => this.api.status()), this.status.status === 'downloading' ? 500 : 300);
  }

  private kick(call: () => Promise<ShellStatus>): void {
    this.kicked = 5;
    void this.act(call);
  }

  private async act(call: () => Promise<ShellStatus>): Promise<void> {
    try {
      this.status = await call();
    } catch {
      // 外壳没回话（关了黑窗口之类）：什么都不改
      return;
    }
    this.render();
    this.follow();
  }

  private async check(): Promise<void> {
    this.manual = true;
    // 人点了「检查更新」：之前关掉的卡片都可以再弹
    this.dismissed.clear();
    this.closed = null;
    // 外壳收到以后在后台查：先显示「正在检查」，查完了 follow() 会接着问到结果
    this.status = { ...this.status, status: 'checking' };
    this.render();
    this.kick(() => this.api.check());
  }

  private render(): void {
    const s = this.status;
    this.rowVersion.textContent = s.version ? t('版本 {version}', { version: s.version }) : '';
    this.rowAuto.checked = s.autoCheck;
    this.rowCheck.disabled = s.status === 'checking' || s.status === 'downloading';
    this.renderNote();
    const view = cardFor(s, this.dismissed, this.pageVersion);
    this.renderCard(view.kind !== 'none' && this.closed === `${view.kind}:${view.version}` ? { kind: 'none' } : view);
  }

  /** 设置那一行后面的小字：只说人点「检查更新」得到的结果 */
  private renderNote(): void {
    const s = this.status;
    this.rowNote.replaceChildren();
    if (!this.manual) return;
    if (s.status === 'checking') this.rowNote.textContent = t('正在检查…');
    else if (s.status === 'offline') this.rowNote.textContent = t('连不上更新服务器，稍后再试');
    else if (s.needsNewShell) {
      this.rowNote.append(document.createTextNode(t('新版本要重新下载安装包：')));
      const link = el('a', '', t('去下载'));
      link.href = RELEASES;
      link.target = '_blank';
      link.rel = 'noopener';
      this.rowNote.append(link);
    } else if (s.status === 'uptodate') this.rowNote.textContent = t('已是最新');
    else if (s.latest && (s.status === 'available' || s.status === 'downloading' || s.status === 'ready')) this.rowNote.textContent = t('有新版本 {version}', { version: s.latest.version });
  }

  private renderCard(view: CardView): void {
    // 新手引导开着的时候先不弹（引导关了，构造函数里的观察者会再调 render）
    const hide = view.kind === 'none' || !!document.querySelector('.tour');
    this.card.hidden = hide;
    if (hide) return;
    // 同一张卡片不用重画：观察者、轮询都会调 render，重画会让人点不准按钮
    const key = JSON.stringify(view);
    if (this.card.dataset.view === key) return;
    this.card.dataset.view = key;
    this.card.dataset.kind = view.kind;

    const head = el('div', 'update-head');
    const close = el('button', 'update-close', '×');
    close.type = 'button';
    close.title = t('以后再说');
    close.setAttribute('aria-label', t('以后再说'));
    close.addEventListener('click', () => this.later(view));
    const body: HTMLElement[] = [];
    const actions = el('div', 'update-actions');

    if (view.kind === 'available') {
      head.append(el('b', '', t('有新版本 {version}', { version: view.version })), close);
      const notes = pickNotes(view.notes, LANG);
      if (notes) body.push(el('p', 'update-notes', notes));
      body.push(el('p', 'update-meta', t('要下载 {size}，下好以后刷新页面就换成新版，设定都还在。', { size: formatBytes(view.bytes) })));
      actions.append(
        button(t('跳过这一版'), 'ghost', () => {
          this.dismissed.add(view.version);
          void this.act(() => this.api.settings({ skip: view.version }));
        }),
        button(t('以后再说'), 'plain', () => this.later(view)),
        button(t('现在更新'), 'primary', () => this.kick(() => this.api.download())),
      );
    } else if (view.kind === 'downloading') {
      head.append(el('b', '', t('正在下载 {version}', { version: view.version })), close);
      const bar = el('div', 'update-bar');
      const fill = el('span');
      fill.style.width = `${view.total > 0 ? Math.min(100, (view.done / view.total) * 100) : 0}%`;
      bar.append(fill);
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(view.total));
      bar.setAttribute('aria-valuenow', String(view.done));
      body.push(bar, el('p', 'update-meta', `${formatBytes(view.done)} / ${formatBytes(view.total)}`));
      close.title = t('在后台接着下');
      close.setAttribute('aria-label', t('在后台接着下'));
    } else if (view.kind === 'ready') {
      head.append(el('b', '', t('{version} 已经下好了', { version: view.version })), close);
      body.push(el('p', 'update-meta', t('刷新页面就换成新版，设定都还在。不刷新的话，下次打开工坊时也会是新版。')));
      actions.append(
        button(t('稍后'), 'plain', () => this.later(view)),
        button(t('刷新'), 'primary', () => location.reload()),
      );
    } else {
      head.append(el('b', '', t('{version} 没下完', { version: view.version })), close);
      body.push(el('p', 'update-meta', t('可能是网络断了。已经下好的部分留着，重试时只补剩下的。')));
      actions.append(
        button(t('以后再说'), 'plain', () => this.later(view)),
        button(t('重试'), 'primary', () => this.kick(() => this.api.download())),
      );
    }
    this.card.replaceChildren(head, ...body, ...(actions.childElementCount ? [actions] : []));
  }

  /**
   * 关掉卡片：「有新版」「没下完」这次打开里不再提示这一版；
   * 「正在下载」「已经下好」只是这一张不再弹（下载在后台接着跑），状态变了（下好了、出错了）再弹
   */
  private later(view: CardView): void {
    if (view.kind === 'none') return;
    if (view.kind === 'available' || view.kind === 'failed') this.dismissed.add(view.version);
    else this.closed = `${view.kind}:${view.version}`;
    this.card.hidden = true;
  }

  private closed: string | null = null;
}
