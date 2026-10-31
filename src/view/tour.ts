/**
 * 新手引导：一步一步指给人看界面上的几块地方。每一步把要看的那块地方打亮（四周压暗），旁边一张小卡片写着它是干什么的；
 * 卡片上随时可以「跳过」。Esc 也是跳过，← → 翻上一步、下一步。
 *
 * 只管画和翻页；第几步指着谁、要先展开哪一栏、看完记在哪里，都由调用的一方（main.ts）给。
 */

export interface TourStep {
  title: string;
  text: string;
  /** 指着哪块地方；取不到、看不见（被收起来、宽高是 0）就不打亮，卡片放在屏幕正中 */
  target?: () => Element | null;
  /** 指过去之前先做的事：切模式、展开那一栏 */
  before?: () => void;
}

/** 打亮的那一圈比目标大多少（像素） */
const PAD = 6;
/** 卡片离屏幕边、离打亮的那一圈至少多远 */
const GAP = 12;

export class Tour {
  /** 关掉的时候（看完、跳过都算）：done 是看到了最后一步 */
  onClose: (done: boolean) => void = () => {};

  private root: HTMLElement | null = null;
  private spot!: HTMLElement;
  private card!: HTMLElement;
  private at = 0;
  private place = () => this.layout();
  private keys = (e: KeyboardEvent) => this.key(e);

  constructor(private readonly steps: readonly TourStep[]) {}

  get open() {
    return this.root !== null;
  }

  start(at = 0) {
    if (!this.steps.length) return;
    if (!this.root) this.build();
    this.go(at);
  }

  /** 关掉；done 是不是看完了（不是跳过） */
  close(done = false) {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    window.removeEventListener('resize', this.place);
    window.removeEventListener('scroll', this.place, true);
    window.removeEventListener('keydown', this.keys, true);
    this.onClose(done);
  }

  private build() {
    const root = document.createElement('div');
    root.className = 'tour';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'tourTitle');
    this.spot = document.createElement('div');
    this.spot.className = 'tour-spot';
    this.card = document.createElement('div');
    this.card.className = 'tour-card';
    root.append(this.spot, this.card);
    document.body.append(root);
    this.root = root;
    // 面板滚动、窗口变大小时，打亮的那一圈跟着目标走
    window.addEventListener('resize', this.place);
    window.addEventListener('scroll', this.place, true);
    window.addEventListener('keydown', this.keys, true);
  }

  private key(e: KeyboardEvent) {
    if (e.key === 'Escape') this.close();
    else if (e.key === 'ArrowRight') this.go(this.at + 1);
    else if (e.key === 'ArrowLeft') this.go(this.at - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  private go(at: number) {
    if (at >= this.steps.length) return this.close(true);
    this.at = Math.max(0, at);
    const step = this.steps[this.at];
    step.before?.();
    const last = this.at === this.steps.length - 1;

    const head = document.createElement('div');
    head.className = 'tour-head';
    const title = document.createElement('h3');
    title.id = 'tourTitle';
    title.textContent = step.title;
    const count = document.createElement('span');
    count.textContent = `${this.at + 1} / ${this.steps.length}`;
    head.append(title, count);
    const text = document.createElement('p');
    text.textContent = step.text;
    const row = document.createElement('div');
    row.className = 'tour-actions';
    const button = (label: string, className: string, onClick: () => void) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = className;
      btn.textContent = label;
      btn.addEventListener('click', onClick);
      return btn;
    };
    const skip = button('跳过', 'btn ghost', () => this.close());
    skip.hidden = last;
    const back = button('上一步', 'btn', () => this.go(this.at - 1));
    back.disabled = this.at === 0;
    const next = button(last ? '开始用' : '下一步', 'btn primary', () => this.go(this.at + 1));
    row.append(skip, back, next);
    this.card.replaceChildren(head, text, row);

    // 目标在面板里时先滚到看得见（手机上整页一起滚）；滚完再量位置
    const target = this.target();
    target?.scrollIntoView({ block: 'nearest' });
    this.layout();
    // 平滑滚动、展开一栏的版面变化，过一会儿才定下来
    window.setTimeout(this.place, 120);
    window.setTimeout(this.place, 400);
    next.focus({ preventScroll: true });
  }

  /** 现在这一步指着的东西；看不见就当没有 */
  private target(): Element | null {
    const found = this.steps[this.at]?.target?.() ?? null;
    if (!found) return null;
    const box = found.getBoundingClientRect();
    return box.width > 0 && box.height > 0 ? found : null;
  }

  /** 打亮的那一圈对准目标，卡片摆在它旁边放得下的地方 */
  private layout() {
    if (!this.root) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const target = this.target();
    const card = this.card;
    card.style.maxWidth = `${Math.min(360, vw - GAP * 2)}px`;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const clampX = (x: number) => Math.max(GAP, Math.min(vw - cw - GAP, x));
    const clampY = (y: number) => Math.max(GAP, Math.min(vh - ch - GAP, y));
    if (!target) {
      this.spot.hidden = true;
      this.root.classList.add('dim');
      card.style.left = `${clampX((vw - cw) / 2)}px`;
      card.style.top = `${clampY((vh - ch) / 2)}px`;
      return;
    }
    this.root.classList.remove('dim');
    this.spot.hidden = false;
    const r = target.getBoundingClientRect();
    // 打亮的那一圈不出屏幕（大的目标，比如 3D 视图，四周留一点暗边）
    const left = Math.max(2, r.left - PAD);
    const top = Math.max(2, r.top - PAD);
    const right = Math.min(vw - 2, r.right + PAD);
    const bottom = Math.min(vh - 2, r.bottom + PAD);
    Object.assign(this.spot.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
    const middle = clampX((left + right) / 2 - cw / 2);
    // 先试下面、上面，再试右边、左边；都放不下就压在目标里面靠下
    if (vh - bottom >= ch + GAP * 2) return this.put(middle, bottom + GAP);
    if (top >= ch + GAP * 2) return this.put(middle, top - GAP - ch);
    const level = clampY((top + bottom) / 2 - ch / 2);
    if (vw - right >= cw + GAP * 2) return this.put(right + GAP, level);
    if (left >= cw + GAP * 2) return this.put(left - GAP - cw, level);
    this.put(middle, clampY(bottom - ch - GAP * 2));
  }

  private put(x: number, y: number) {
    this.card.style.left = `${x}px`;
    this.card.style.top = `${y}px`;
  }
}
