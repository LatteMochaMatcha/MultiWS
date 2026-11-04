/**
 * 手机竖屏的版面：3D 视图铺满，设定放在底下的抽屉里，一次只看一栏。
 *
 * - 造型：抽屉有四档高低（只露栏目名 / 三分之一 / 六成 / 几乎整屏）。点栏目名换栏，内容长的几栏自动拉到六成高；
 *   点中部件时切到「微调」、抽屉落到三分之一（镜头凑过去由 main.ts 做）。
 * - 摆姿势：没有抽屉，底下一条图标；点哪个图标弹出哪一栏的卡片，碰一下模型收起。点中关节时只弹一张两行的小卡片。
 * - 「更多」（标题区：语言、主题、新手引导、源码）、导出面板、视角小浮层是三个弹出层，同一时间只开一个。
 *
 * 只改 .app 上的几个记号（data-sheet / data-card / data-pop、notes），样子全写在 style.css 的手机那一段里；
 * 电脑、横屏版面不受影响（那时候这些记号也照样设，但样式不认）。
 */
import { t } from '../i18n';

/** 和 style.css 里手机竖屏那一段的条件一样 */
export const PHONE_QUERY = '(max-width: 600px), (max-width: 820px) and (orientation: portrait)';

export type Sheet = 'peek' | 'low' | 'tall' | 'full';
type Mode = 'shape' | 'pose';
type Pop = 'menu' | 'export' | 'views';

/** 内容长的栏：点进去抽屉拉到六成高 */
const TALL = new Set(['desc', 'layout', 'hair', 'shape', 'view', 'refs']);

/** 栏目名在手机上用短的（标签一排放得下更多），完整的名字放进 title */
const SHORT: Record<string, string> = {
  desc: t('描述@@栏目'),
  presets: t('预设@@栏目'),
  counts: t('数量@@栏目'),
  layout: t('排布@@栏目'),
  hair: t('头发@@栏目'),
  shape: t('体型@@栏目'),
  tweak: t('微调@@栏目'),
  mesh: t('网格@@栏目'),
  pose: t('姿势@@栏目'),
  hand: t('手势@@栏目'),
  face: t('表情@@栏目'),
  poses: t('现成@@栏目'),
  view: t('镜头@@栏目'),
  refs: t('参考图@@栏目'),
  config: t('配置@@栏目'),
};

/** 摆姿势时底下那条的图标（24×24，描边） */
const ICON: Record<string, string> = {
  pose: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M6 9l6 2 6-2M9 21l3-7 3 7"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.5 0-4-1.5-5.5-4L4 13a1.5 1.5 0 0 1 2.5-1.5L8 13"/>',
  face: '<circle cx="12" cy="12" r="8.5"/><path d="M9 10h.01M15 10h.01M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2"/>',
  poses: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  view: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  refs: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="m4 16 5-5 4 4 2-2 5 5"/><circle cx="15.5" cy="9.5" r="1.2"/>',
};

/** 栏目名按钮里的内容：图标（只在摆姿势的底栏里显示）+ 短名字 */
export function jumpLabel(button: HTMLButtonElement, key: string, full: string) {
  button.dataset.key = key;
  button.title = full;
  button.setAttribute('aria-label', full);
  const icon = ICON[key] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[key]}</svg>` : '';
  button.innerHTML = `${icon}<span></span>`;
  button.querySelector('span')!.textContent = SHORT[key] ?? full;
}

/** 状态消息在手机上冒出来多久（毫秒） */
const TOAST_MS = 3500;

export class Phone {
  private readonly mq = window.matchMedia(PHONE_QUERY);
  private readonly app: HTMLElement;
  /** 造型时看的是哪一栏 */
  private shapeTab = 'counts';
  /** 点中部件前在看哪一栏：取消选择后回去 */
  private beforePick: string | null = null;
  private mode: Mode = 'shape';
  private toastTimer = 0;
  /** 模式、栏目换了以后（main.ts 用来同步别的东西） */
  onChange: () => void = () => {};

  constructor(private readonly sections: Map<string, HTMLElement>) {
    this.app = document.querySelector<HTMLElement>('.app')!;
    this.mode = this.app.dataset.mode === 'pose' ? 'pose' : 'shape';
    this.app.dataset.sheet = 'low';
    // 长说明（没有 id、写死在页面里的那几段）平时收起来，点「说明」才出来
    for (const note of document.querySelectorAll<HTMLElement>('.panel-scroll .note:not([id])')) {
      if ((note.textContent ?? '').trim().length > 60) note.classList.add('long');
    }
    this.wireGrip();
    this.wirePops();
    this.wireToast();
    const notes = document.getElementById('btnNotes')!;
    notes.addEventListener('click', () => {
      const on = !this.app.classList.contains('notes');
      this.app.classList.toggle('notes', on);
      notes.setAttribute('aria-pressed', String(on));
    });
    // 摆姿势时碰一下模型：卡片收起来（点中关节的小卡片除外，它跟着选中走）；视角小浮层也收起来
    document.getElementById('stage')!.addEventListener('pointerdown', (e) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      if (this.app.dataset.pop === 'views') this.setPop(null);
      if (this.mode === 'pose' && this.app.dataset.card === 'open') this.closeCard();
    });
    this.mq.addEventListener?.('change', () => this.sync());
    this.sync();
  }

  /** 现在是不是手机竖屏版面 */
  get on(): boolean {
    return this.mq.matches;
  }

  /** 打开某一栏：造型时换抽屉里的栏，摆姿势时弹出那一栏的卡片（再点一次同一个就收起） */
  open(key: string, sheet?: Sheet) {
    if (!this.sections.has(key)) return;
    this.setPop(null);
    if (this.mode === 'pose') {
      if (this.app.dataset.card === 'open' && this.current() === key) return this.closeCard();
      this.app.dataset.card = 'open';
      this.show(key);
      return;
    }
    this.shapeTab = key;
    // 选着部件时打开「微调」（新手引导会这样）：还记着点中之前那一栏，取消选择时回去
    if (key !== 'tweak') this.beforePick = null;
    this.show(key);
    const now = this.app.dataset.sheet as Sheet;
    this.app.dataset.sheet = sheet ?? (now === 'full' ? 'full' : TALL.has(key) ? 'tall' : 'low');
    this.panelScroll().scrollTop = 0;
  }

  /** 换模式：造型回到上次看的那一栏，摆姿势先不弹卡片 */
  setMode(mode: Mode) {
    this.mode = mode;
    this.setPop(null);
    if (mode === 'pose') {
      delete this.app.dataset.card;
      this.show(null);
    } else {
      delete this.app.dataset.card;
      this.show(this.shapeTab);
    }
  }

  /** 选中了部件（造型）或关节（摆姿势），或者取消了 */
  picked(what: 'part' | 'joint' | null) {
    if (this.mode === 'pose') {
      if (what === 'joint') {
        this.setPop(null);
        this.app.dataset.card = 'joint';
        this.show('pose');
      } else if (this.app.dataset.card === 'joint') this.closeCard();
      // 切去摆姿势时部件的选中被清掉了：回造型时回到点中之前那一栏
      if (what === null && this.beforePick && this.shapeTab === 'tweak') {
        this.shapeTab = this.beforePick;
        this.beforePick = null;
      }
      return;
    }
    if (what === 'part') {
      if (this.shapeTab !== 'tweak') this.beforePick = this.shapeTab;
      this.shapeTab = 'tweak';
      this.show('tweak');
      if (this.app.dataset.sheet !== 'full') this.app.dataset.sheet = 'low';
    } else if (this.beforePick && this.shapeTab === 'tweak') {
      this.shapeTab = this.beforePick;
      this.beforePick = null;
      this.show(this.shapeTab);
    }
  }

  /** 安卓返回键：一层一层退。退了一层就是 true */
  back(): boolean {
    if (!this.on) return false;
    if (this.app.dataset.pop) {
      this.setPop(null);
      return true;
    }
    if (this.mode === 'pose' && this.app.dataset.card === 'open') {
      this.closeCard();
      return true;
    }
    const sheet = this.app.dataset.sheet;
    if (this.mode === 'shape' && (sheet === 'tall' || sheet === 'full')) {
      this.app.dataset.sheet = 'low';
      return true;
    }
    return false;
  }

  /** 开、关一个弹出层（同一时间只开一个） */
  setPop(pop: Pop | null) {
    if (pop) this.app.dataset.pop = pop;
    else delete this.app.dataset.pop;
    document.getElementById('scrim')!.hidden = pop !== 'menu' && pop !== 'export';
    document.getElementById('btnMore')!.setAttribute('aria-expanded', String(pop === 'menu'));
    document.getElementById('btnExportMenu')!.setAttribute('aria-expanded', String(pop === 'export'));
    document.getElementById('btnViewMenu')!.setAttribute('aria-expanded', String(pop === 'views'));
    // 开了弹出层就把冒出来的小条收起（导出面板里状态那一行正常显示；菜单、视角浮层别被它挡着）
    if (pop) this.hideToast();
  }

  get pop(): Pop | null {
    return (this.app.dataset.pop as Pop | undefined) ?? null;
  }

  private closeCard() {
    delete this.app.dataset.card;
    this.show(null);
  }

  private current(): string | null {
    for (const [key, s] of this.sections) if (s.classList.contains('tab-on')) return key;
    return null;
  }

  /** 只亮出这一栏（null：一栏都不亮，摆姿势收起卡片时） */
  private show(key: string | null) {
    for (const [k, s] of this.sections) s.classList.toggle('tab-on', k === key);
    for (const b of document.querySelectorAll<HTMLButtonElement>('#jump button')) {
      const on = b.dataset.key === key;
      b.setAttribute('aria-current', String(on));
      if (on && this.on) b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    this.onChange();
  }

  private panelScroll() {
    return document.getElementById('panelScroll')!;
  }

  /** 进出手机版面时把记号对齐（转屏、拉窗口） */
  private sync() {
    if (!this.on) {
      this.setPop(null);
      return;
    }
    this.setMode(this.mode);
  }

  /** 拖把手换高低：跟着手指走，松手停在最近的一档；点一下就升一档（到顶回三分之一） */
  private wireGrip() {
    const grip = document.getElementById('grip')!;
    const order: Sheet[] = ['peek', 'low', 'tall', 'full'];
    let start: { y: number; h: number } | null = null;
    let moved = false;
    const heights = () => {
      const vh = window.innerHeight;
      const css = getComputedStyle(this.app);
      const px = (name: string) => {
        const probe = css.getPropertyValue(name).trim();
        if (probe.endsWith('%')) return (parseFloat(probe) / 100) * vh;
        if (probe.endsWith('px')) return parseFloat(probe);
        return NaN;
      };
      return { peek: px('--sheet-peek'), low: px('--sheet-low'), tall: px('--sheet-tall'), full: vh - px('--sheet-gap') };
    };
    grip.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('button')) return;
      start = { y: e.clientY, h: document.querySelector('.panel')!.getBoundingClientRect().height };
      moved = false;
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dy = e.clientY - start.y;
      if (!moved && Math.abs(dy) < 6) return;
      moved = true;
      const h = Math.max(60, Math.min(window.innerHeight - 40, start.h - dy));
      this.app.style.setProperty('--sheet', `${h}px`);
    });
    const end = (e: PointerEvent) => {
      if (!start) return;
      const was = start;
      start = null;
      this.app.style.removeProperty('--sheet');
      const now = this.app.dataset.sheet as Sheet;
      if (!moved) {
        const i = order.indexOf(now);
        this.app.dataset.sheet = i >= order.length - 1 ? 'low' : order[i + 1];
        return;
      }
      const h = was.h - (e.clientY - was.y);
      const hs = heights();
      let best: Sheet = now;
      let gap = Infinity;
      for (const s of order) {
        const d = Math.abs(hs[s] - h);
        if (d < gap) {
          gap = d;
          best = s;
        }
      }
      this.app.dataset.sheet = best;
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  private wirePops() {
    const toggle = (pop: Pop) => () => this.setPop(this.pop === pop ? null : pop);
    document.getElementById('btnMore')!.addEventListener('click', toggle('menu'));
    document.getElementById('btnExportMenu')!.addEventListener('click', toggle('export'));
    document.getElementById('btnViewMenu')!.addEventListener('click', toggle('views'));
    document.getElementById('scrim')!.addEventListener('click', () => this.setPop(null));
    // 点了导出按钮、菜单里的东西：面板关掉（导出的结果在冒出来的小条里说）
    document.querySelector('.export')!.addEventListener('click', (e) => {
      if (!(e.target as Element).closest('button:not(:disabled):not(.unavailable)') || this.pop !== 'export') return;
      this.setPop(null);
      // 点的那一下已经写了状态（「已导出 …」「正在导出…」）：面板关了，改在小条里说
      this.showToast();
    });
    document.querySelector('header')!.addEventListener('click', (e) => {
      if ((e.target as Element).closest('#btnTour, a') && this.pop === 'menu') this.setPop(null);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.pop) {
        this.setPop(null);
        e.stopPropagation();
      }
    });
  }

  /** 状态消息（导出好了、可以摆姿势了……）：导出面板没开时在顶上冒一下，过几秒自己收起 */
  private wireToast() {
    const status = document.getElementById('status')!;
    new MutationObserver(() => this.showToast()).observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-idle'],
    });
    status.addEventListener('click', () => this.hideToast());
  }

  private showToast() {
    const status = document.getElementById('status')!;
    if (!this.on || status.hasAttribute('data-idle') || !status.textContent?.trim() || this.pop) return;
    status.classList.add('toast');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.hideToast(), TOAST_MS);
  }

  private hideToast() {
    window.clearTimeout(this.toastTimer);
    document.getElementById('status')?.classList.remove('toast');
  }
}
