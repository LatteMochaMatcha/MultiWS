/**
 * 面板的版面：一次只看一栏，栏目名按钮换栏；「更多」菜单、导出面板是弹出层；状态消息从顶上冒一下。
 * 电脑和手机竖屏是两套样子，这里管两边共用的记号（名字沿用最早只管手机时的 Phone）。
 *
 * 手机竖屏（PHONE_QUERY）：3D 视图铺满，设定放在底下的抽屉里，一次只看一栏。
 * - 造型：抽屉三档（只露栏目名 / 照这一栏的内容定高、最高六成屏 / 几乎整屏）。点栏目名换栏，抽屉跟着内容变高变矮；
 *   点中部件时切到「微调」（镜头凑过去由 main.ts 做）。
 * - 摆姿势：没有抽屉，底下一条图标；点哪个图标弹出哪一栏的卡片，碰一下模型收起。点中关节时只弹一张两行的小卡片。
 * - 弹出层三个：「更多」、导出面板、视角小浮层。
 *
 * 电脑（其余所有尺寸，含手机横屏）：顶上一条工具栏，面板左边一竖排栏目图标，面板里显示选中的那一组。
 * - 内容少的几栏并成一组（GROUPS：身体 = 描述 + 预设 + 数量，外观 = 体型 + 头发，微调 = 微调 + 网格，视图 = 镜头 + 参考图），
 *   一个图标、一次都显示，各栏的标题当小标题。
 * - 造型、摆姿势各记各的上次停在哪一栏（存在浏览器里）。
 * - 点中部件切到「微调」，点中关节切到「姿势」；取消选择回到原来那一栏。
 * - 弹出层两个：「更多」、导出面板（顶栏右边的按钮下面），点别处关掉。
 *
 * 只改 .app 上的几个记号（data-sheet / data-card / data-pop、notes）和栏目上的 tab-on；样子全写在 style.css 里。
 */
import { t } from '../i18n';

/** 和 style.css 里手机竖屏那一段的条件一样（电脑那一段是它的反面） */
export const PHONE_QUERY = '(max-width: 600px), (max-width: 820px) and (orientation: portrait)';

/** 手机抽屉的三档：只露栏目名 / 照这一栏的内容定高（最高六成屏）/ 几乎整屏 */
export type Sheet = 'peek' | 'fit' | 'full';
type Mode = 'shape' | 'pose';
type Pop = 'menu' | 'export' | 'views';

/** 每个模式上次看的是哪一栏、「说明」开没开，记在浏览器里 */
const TABS_KEY = 'oc-basemesh-tabs';
const NOTES_KEY = 'oc-basemesh-notes';

/**
 * 电脑上内容少的几栏并成一组，一个图标、一次都显示出来（手机竖屏还是一次一栏）。
 * 组里第一栏是领头的：图标、组名写在它的按钮上，别的几栏的按钮在电脑上不出现。没写进来的栏自己一组
 */
const GROUPS: readonly { keys: readonly string[]; label: string; icon?: string }[] = [
  { keys: ['desc', 'presets', 'counts'], label: t('身体@@栏目'), icon: '<circle cx="12" cy="7" r="3.5"/><path d="M5 20.5c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/>' },
  { keys: ['shape', 'hair'], label: t('外观@@栏目') },
  { keys: ['tweak', 'mesh'], label: t('微调@@栏目') },
  { keys: ['view', 'refs'], label: t('视图@@栏目') },
];
const groupOf = (key: string) => GROUPS.find((g) => g.keys.includes(key));

/** 栏目名按钮上用短的（手机一排放得下更多、电脑竖排图标下面两个字），完整的名字放进 title */
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
  scene: t('场景@@栏目'),
  view: t('镜头@@栏目'),
  refs: t('参考图@@栏目'),
};

/** 栏目图标（24×24，描边）：电脑的竖排、手机摆姿势时底下那条 */
const ICON: Record<string, string> = {
  desc: '<path d="M6 3.5h9l3 3V20.5H6z"/><path d="M9 10h6M9 13.5h6M9 17h4"/>',
  presets: '<path d="m12 3.5 2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.4l-5.1 2.8L8 13.5l-4.3-4 5.8-.7z"/>',
  counts: '<path d="M4 7h9M4 12h9M4 17h9"/><path d="M18 9.5v5M15.5 12h5"/>',
  layout: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M5 10l7 2 7-2M8.5 20.5 12 14l3.5 6.5"/><path d="M3.5 7.5 5 10M20.5 7.5 19 10"/>',
  hair: '<path d="M5 20c0-9.5 2.5-15.5 7-15.5s7 6 7 15.5"/><path d="M8.5 9.5c1.5 2 5 3 7.5 1.5"/>',
  shape: '<path d="M9 3.5h6l1.2 5-2.2 3 1 9H9l1-9-2.2-3z"/>',
  tweak: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  mesh: '<path d="M4 4h16v16H4zM4 12h16M12 4v16M4 4l16 16"/>',
  pose: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M6 9l6 2 6-2M9 21l3-7 3 7"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.5 0-4-1.5-5.5-4L4 13a1.5 1.5 0 0 1 2.5-1.5L8 13"/>',
  face: '<circle cx="12" cy="12" r="8.5"/><path d="M9 10h.01M15 10h.01M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2"/>',
  poses: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  scene: '<circle cx="7" cy="6" r="2"/><circle cx="17" cy="6" r="2"/><path d="M7 8.5v6M17 8.5v6M4.5 11h5M14.5 11h5M5 20l2-5.5 2 5.5M15 20l2-5.5 2 5.5"/>',
  view: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  refs: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="m4 16 5-5 4 4 2-2 5 5"/><circle cx="15.5" cy="9.5" r="1.2"/>',
};

/**
 * 栏目名按钮里的内容：图标 + 短名字。
 * 并了组的栏：领头的那个另带一个组名（.g，电脑上显示它、不显示 .s），别的记成 follower（电脑上不出现）
 */
export function jumpLabel(button: HTMLButtonElement, key: string, full: string) {
  const group = groupOf(key);
  button.dataset.key = key;
  button.title = full;
  button.setAttribute('aria-label', full);
  const path = (group && group.keys[0] === key ? group.icon : undefined) ?? ICON[key];
  const icon = path ? `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>` : '';
  button.innerHTML = `${icon}<span class="s"></span>`;
  button.querySelector('.s')!.textContent = SHORT[key] ?? full;
  if (!group) return;
  if (group.keys[0] !== key) {
    button.classList.add('follower');
    return;
  }
  button.dataset.group = group.label;
  const name = document.createElement('span');
  name.className = 'g';
  name.textContent = group.label;
  button.append(name);
}

/** 状态消息冒出来多久（毫秒） */
const TOAST_MS = 3500;

export class Phone {
  private readonly mq = window.matchMedia(PHONE_QUERY);
  private readonly app: HTMLElement;
  /** 每个模式上次看的是哪一栏 */
  private readonly tabs: Record<Mode, string> = { shape: 'counts', pose: 'pose' };
  /** 点中部件（关节）前在看哪一栏：取消选择后回去 */
  private beforePick: string | null = null;
  private beforeJoint: string | null = null;
  private mode: Mode = 'shape';
  private toastTimer = 0;
  /** 模式、栏目换了以后（main.ts 用来同步别的东西） */
  onChange: () => void = () => {};

  constructor(private readonly sections: Map<string, HTMLElement>) {
    this.app = document.querySelector<HTMLElement>('.app')!;
    this.mode = this.app.dataset.mode === 'pose' ? 'pose' : 'shape';
    this.app.dataset.sheet = 'fit';
    this.loadTabs();
    // 电脑上并在一组里的栏：各自的标题留着当小标题
    for (const group of GROUPS) for (const key of group.keys) sections.get(key)?.classList.add('grouped');
    // 长说明（没有 id、写死在页面里的那几段）平时收起来，点「说明」才出来
    for (const note of document.querySelectorAll<HTMLElement>('.panel-scroll .note:not([id])')) {
      if ((note.textContent ?? '').trim().length > 60) note.classList.add('long');
    }
    this.wireGrip();
    this.wirePops();
    this.wireToast();
    this.wireNotes();
    this.wireFit();
    this.wireTabsFade();
    // 碰一下模型：视角小浮层收起来，摆姿势的卡片也收起来（点中关节的小卡片除外，它跟着选中走）
    document.getElementById('stage')!.addEventListener('pointerdown', (e) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      if (this.app.dataset.pop === 'views') this.setPop(null);
      if (this.on && this.mode === 'pose' && this.app.dataset.card === 'open') this.closeCard();
    });
    this.mq.addEventListener?.('change', () => this.sync());
    this.sync();
  }

  /** 现在是不是手机竖屏版面（不是就是电脑版面） */
  get on(): boolean {
    return this.mq.matches;
  }

  /** 两个模式各停在哪一栏：新手引导开始前记下，关掉时还原 */
  get tabState(): Record<Mode, string> {
    return { ...this.tabs };
  }

  set tabState(state: Record<Mode, string>) {
    this.remember(state.shape, 'shape');
    this.remember(state.pose, 'pose');
    this.beforePick = null;
    this.beforeJoint = null;
    this.setMode(this.mode);
  }

  /** 打开某一栏。电脑：换面板里的栏；手机造型：换抽屉里的栏；手机摆姿势：弹出那一栏的卡片（再点一次同一个就收起） */
  open(key: string, sheet?: Sheet) {
    const section = this.sections.get(key);
    if (!section) return;
    this.setPop(null);
    if (this.on && this.mode === 'pose') {
      if (this.app.dataset.card === 'open' && this.shown === key) return this.closeCard();
      this.app.dataset.card = 'open';
      this.show(key);
      return;
    }
    // 只属于另一个模式的栏不记成这个模式的（新手引导会先换模式再开栏，正常走不到这里）
    if (!section.dataset.mode || section.dataset.mode === this.mode) this.remember(key);
    // 手动换了栏：不再「取消选择时回去」（选着部件时打开「微调」除外，新手引导会这样）
    if (key !== 'tweak') this.beforePick = null;
    if (key !== 'pose') this.beforeJoint = null;
    this.show(key);
    // 手机：抽屉照这一栏的内容定高（已经拉到整屏的就留着）
    if (this.on) this.app.dataset.sheet = sheet ?? (this.app.dataset.sheet === 'full' ? 'full' : 'fit');
    // 电脑上并在一组里、不是领头的那一栏（程序替人换过去的：新手引导、点中部件）：滚到它那里
    const follows = !this.on && groupOf(key)?.keys[0] !== key && groupOf(key) !== undefined;
    if (follows) section.scrollIntoView({ block: 'start' });
    else this.panelScroll().scrollTop = 0;
  }

  /** 换模式：回到这个模式上次看的那一栏（手机摆姿势先不弹卡片） */
  setMode(mode: Mode) {
    this.mode = mode;
    this.setPop(null);
    delete this.app.dataset.card;
    this.show(this.on && mode === 'pose' ? null : this.tabs[mode]);
  }

  /** 选中了部件（造型）或关节（摆姿势），或者取消了 */
  picked(what: 'part' | 'joint' | null) {
    if (this.mode === 'pose') {
      if (this.on) {
        if (what === 'joint') {
          this.setPop(null);
          this.app.dataset.card = 'joint';
          this.show('pose');
        } else if (this.app.dataset.card === 'joint') this.closeCard();
      } else if (what === 'joint') {
        if (this.tabs.pose !== 'pose') this.beforeJoint ??= this.tabs.pose;
        this.remember('pose');
        this.show('pose');
      } else if (this.beforeJoint && this.tabs.pose === 'pose') {
        this.remember(this.beforeJoint);
        this.beforeJoint = null;
        this.show(this.tabs.pose);
      }
      // 切去摆姿势时部件的选中被清掉了：回造型时回到点中之前那一栏
      if (what === null && this.beforePick && this.tabs.shape === 'tweak') {
        this.remember(this.beforePick, 'shape');
        this.beforePick = null;
      }
      return;
    }
    // 回到造型时关节的选中也清掉了：摆姿势那边同样回到原来那一栏
    if (what === null && this.beforeJoint && this.tabs.pose === 'pose') {
      this.remember(this.beforeJoint, 'pose');
      this.beforeJoint = null;
    }
    if (what === 'part') {
      if (this.tabs.shape !== 'tweak') this.beforePick ??= this.tabs.shape;
      this.remember('tweak');
      this.show('tweak');
      if (this.on && this.app.dataset.sheet !== 'full') this.app.dataset.sheet = 'fit';
    } else if (this.beforePick && this.tabs.shape === 'tweak') {
      this.remember(this.beforePick);
      this.beforePick = null;
      this.show(this.tabs.shape);
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
    if (this.mode === 'shape' && this.app.dataset.sheet === 'full') {
      this.app.dataset.sheet = 'fit';
      return true;
    }
    return false;
  }

  /** 开、关一个弹出层（同一时间只开一个） */
  setPop(pop: Pop | null) {
    if (pop) this.app.dataset.pop = pop;
    else delete this.app.dataset.pop;
    // 手机上菜单、导出面板底下垫一层压暗的；电脑上是小下拉，点别处关掉，不压暗
    document.getElementById('scrim')!.hidden = !this.on || (pop !== 'menu' && pop !== 'export');
    for (const b of document.querySelectorAll<HTMLElement>('[data-pop-for]')) {
      b.setAttribute('aria-expanded', String(pop === b.dataset.popFor));
    }
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

  /** 记下某个模式（缺省是现在这个）停在哪一栏 */
  private remember(key: string, mode: Mode = this.mode) {
    if (this.tabs[mode] === key) return;
    this.tabs[mode] = key;
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify(this.tabs));
    } catch {
      // 记不住就下次从缺省那栏开始
    }
  }

  private loadTabs() {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(TABS_KEY) ?? 'null');
      if (!saved || typeof saved !== 'object') return;
      for (const mode of ['shape', 'pose'] as const) {
        const key = (saved as Record<string, unknown>)[mode];
        const section = typeof key === 'string' ? this.sections.get(key) : undefined;
        // 「微调」要选着部件才有内容：打开页面时不停在那里
        if (section && key !== 'tweak' && (!section.dataset.mode || section.dataset.mode === mode)) this.tabs[mode] = key as string;
      }
    } catch {
      // 读不到就用缺省的
    }
  }

  /**
   * 只亮出这一栏（null：一栏都不亮，手机摆姿势收起卡片时）。
   * 电脑上这一栏要是并在一组里，整组都亮出来，按钮亮的是领头的那个
   */
  private show(key: string | null) {
    const group = key && !this.on ? groupOf(key) : undefined;
    const keys = group ? group.keys : key ? [key] : [];
    const lead = keys[0] ?? null;
    for (const [k, s] of this.sections) s.classList.toggle('tab-on', keys.includes(k));
    for (const b of document.querySelectorAll<HTMLButtonElement>('#jump button')) {
      const on = b.dataset.key === lead;
      b.setAttribute('aria-current', String(on));
      if (on && this.on) b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    // 电脑上面板顶上写这一栏（这一组）的名字
    const title = group ? group.label : key ? this.sections.get(key)?.querySelector('.fold')?.textContent : '';
    document.getElementById('panelTitle')!.textContent = title ?? '';
    this.shown = key;
    this.fit();
    this.fadeTabs();
    this.onChange();
  }

  /** 现在亮着的是哪一栏（并了组的是点的那一栏） */
  private shown: string | null = null;

  private panelScroll() {
    return document.getElementById('panelScroll')!;
  }

  /** 进出手机版面时把记号对齐（转屏、拉窗口） */
  private sync() {
    this.setMode(this.mode);
  }

  /** 「说明」开关：手机抽屉上沿、电脑面板标题旁各一个，开关同一件事，记在浏览器里 */
  private wireNotes() {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.notes-toggle')];
    const set = (on: boolean) => {
      this.app.classList.toggle('notes', on);
      for (const b of buttons) b.setAttribute('aria-pressed', String(on));
    };
    try {
      set(localStorage.getItem(NOTES_KEY) === '1');
    } catch {
      // 读不到就收着
    }
    for (const b of buttons) {
      b.addEventListener('click', () => {
        const on = !this.app.classList.contains('notes');
        set(on);
        try {
          localStorage.setItem(NOTES_KEY, on ? '1' : '0');
        } catch {
          // 记不住也照样开关这一次
        }
      });
    }
  }

  /** 样式里写的一个长度（--sheet-peek 这类，px 或者占屏高的百分比）是多少像素 */
  private cssPx(name: string): number {
    const value = getComputedStyle(this.app).getPropertyValue(name).trim();
    if (value.endsWith('%')) return (parseFloat(value) / 100) * window.innerHeight;
    return parseFloat(value);
  }

  /**
   * 手机造型：量现在这一栏的内容有多高，抽屉就开多高（样式里再夹在最矮、最高之间）。
   * 内容少的栏（描述、预设、参考图）抽屉矮，模型大；内容多的（排布、体型）到六成屏为止，里面滚
   */
  private fit() {
    if (!this.on || this.mode !== 'shape') return;
    const section = this.shown ? this.sections.get(this.shown) : undefined;
    if (!section || !section.offsetParent) return;
    const scroll = this.panelScroll();
    const pad = getComputedStyle(scroll);
    const chrome = document.getElementById('grip')!.offsetHeight + document.getElementById('jump')!.offsetHeight;
    const height = Math.ceil(chrome + section.offsetHeight + parseFloat(pad.paddingTop) + parseFloat(pad.paddingBottom)) + 1;
    this.app.style.setProperty('--sheet-fit', `${height}px`);
  }

  /** 这一栏的内容变高变矮了（选中了部件、开了「说明」、多出几行）、屏幕转了：抽屉跟着重新定高 */
  private wireFit() {
    if (typeof ResizeObserver !== 'undefined') {
      const watch = new ResizeObserver(() => this.fit());
      for (const section of this.sections.values()) watch.observe(section);
    }
    window.addEventListener('resize', () => this.fit());
  }

  /** 手机上栏目名一排放不下：右边还有的时候那一头淡出去，提示能横着滑 */
  private fadeTabs() {
    const jump = document.getElementById('jump')!;
    jump.classList.toggle('more', jump.scrollLeft + jump.clientWidth < jump.scrollWidth - 6);
  }

  private wireTabsFade() {
    const jump = document.getElementById('jump')!;
    jump.addEventListener('scroll', () => this.fadeTabs(), { passive: true });
    window.addEventListener('resize', () => this.fadeTabs());
  }

  /** 拖把手换高低：跟着手指走，松手停在最近的一档；点一下就升一档（到顶回照内容定高那一档） */
  private wireGrip() {
    const grip = document.getElementById('grip')!;
    const order: Sheet[] = ['peek', 'fit', 'full'];
    let start: { y: number; h: number } | null = null;
    let moved = false;
    const heights = () => {
      const fit = parseFloat(this.app.style.getPropertyValue('--sheet-fit')) || this.cssPx('--sheet-low');
      return {
        peek: this.cssPx('--sheet-peek'),
        fit: Math.min(Math.max(this.cssPx('--sheet-min'), fit), this.cssPx('--sheet-tall')),
        full: window.innerHeight - this.cssPx('--sheet-gap'),
      };
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
        this.app.dataset.sheet = i >= order.length - 1 ? 'fit' : order[i + 1];
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
    for (const b of document.querySelectorAll<HTMLElement>('[data-pop-for]')) {
      const pop = b.dataset.popFor as Pop;
      b.addEventListener('click', () => this.setPop(this.pop === pop ? null : pop));
    }
    document.getElementById('scrim')!.addEventListener('click', () => this.setPop(null));
    // 电脑上没有垫底那一层：在弹出层和开它的按钮以外的地方按下就关掉
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (this.on || !this.pop) return;
        const target = e.target as Element;
        if (target.closest('[data-pop-for], .panel-foot, .panel-scroll > header, .tour')) return;
        this.setPop(null);
      },
      true,
    );
    // 点了导出按钮、菜单里的东西：面板关掉（导出的结果在冒出来的小条里说）
    document.querySelector('.export')!.addEventListener('click', (e) => {
      if (!(e.target as Element).closest('button:not(:disabled):not(.unavailable)') || this.pop !== 'export') return;
      this.setPop(null);
      // 点的那一下已经写了状态（「已导出 …」「正在导出…」）：面板关了，改在小条里说
      this.showToast();
    });
    const header = document.querySelector('header')!;
    header.addEventListener('click', (e) => {
      if ((e.target as Element).closest('#btnTour, #btnJson, a') && this.pop === 'menu') this.setPop(null);
    });
    // 「载入配置…」：选好文件再关菜单（点的那一下关掉的话，有的内核里选文件的框弹不出来）
    header.addEventListener('change', (e) => {
      if ((e.target as Element).id === 'fileJson' && this.pop === 'menu') this.setPop(null);
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
    if (status.hasAttribute('data-idle') || !status.textContent?.trim() || this.pop) return;
    status.classList.add('toast');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.hideToast(), TOAST_MS);
  }

  private hideToast() {
    window.clearTimeout(this.toastTimer);
    document.getElementById('status')?.classList.remove('toast');
  }
}
