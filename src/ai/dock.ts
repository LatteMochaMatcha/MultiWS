/**
 * AI 助手的窗口：顶栏「AI」按钮打开，电脑上浮在 3D 视图左边，手机上铺满整屏。
 *
 * 三个页面：对话（默认）、对话列表、设置。
 * - 对话：每一轮画成「你说的话 → 模型的思考（折起来）、回答、工具调用（折起来）→ 这一轮改了什么 → 用量、按钮」；
 *   全从消息里算（turns.ts），存下来的对话也一样画；干活时只重画最后一轮。
 * - 干活时还能接着说（插进去），也能停；最后一轮能重新生成、整轮撤回；回答能复制。
 * - 对话列表：存在这台设备的浏览器里（store.ts），切换、改名、导出成 Markdown、删除。
 * - 顶上一行：用的哪个模型、上下文用了多少、这段对话花了多少钱、提示缓存命中了多少。
 * main.ts 第一次打开这个窗口时才载入这个文件（连带 pi）。
 */
import { LANG, t } from '../i18n';
import { saveText } from '../io/download';
import type { Change } from './body';
import { renderMarkdown } from './markdown';
import { type Mark, drawMarks, summarizeMark } from './marks';
import { PHONE_QUERY } from '../view/phone';
import { AiSession, MAX_TURNS, humanError } from './session';
import { mountSettings } from './settingsView';
import { type Conversation, currentId, deleteConversation, getConversation, listConversations, putConversation, setCurrentId } from './store';
import { type Step, type Turn, turnsOf } from './turns';
import type { WorkshopApi } from './workshop';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function iconButton(label: string, path: string, className = 'ai-icon'): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  return b;
}

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  circle: '<ellipse cx="12" cy="12.5" rx="8.5" ry="6.5"/><path d="M17.5 7.5 20 5"/>',
};

/** 一次最多附几张圈出来的图 */
const MAX_MARKS = 3;

/** 工具名给人看的叫法 */
const TOOL_LABEL: Record<string, string> = {
  get_state: t('读现在的设定'),
  parse_description: t('照描述解析'),
  set_body: t('改设定'),
};

/** 空对话时给几个能点的例子 */
const EXAMPLES = [t('三头六臂、九条尾巴的狐狸娘'), t('再加一对翅膀，腿长一点'), t('四条腿的人马，两条尾巴'), t('改成标准人形')];

const DRAFT_KEY = 'oc-ai-draft';

function ago(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return t('刚刚');
  if (minutes < 60) return t('{n} 分钟前', { n: minutes });
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? t('{n} 小时前', { n: hours }) : t('{n} 天前', { n: Math.floor(hours / 24) });
}

const kTokens = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n));
const dollars = (v: number) => (v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v.toFixed(4));

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 旧内核、没权限：老办法
    const area = el('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export interface AiDock {
  open(): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
  /** 设定被别处改了（人自己点的、撤销）：刷新「撤回这一轮」能不能点 */
  refresh(): void;
  /** 正在干活的这一轮停下（「打开 AI 助手」关掉时用） */
  stop(): void;
}

export function mountDock(root: HTMLElement, api: WorkshopApi, hooks: { toggled: (open: boolean) => void }): AiDock {
  const session = new AiSession({
    api,
    lang: LANG,
    save: async (c) => {
      await putConversation(c);
      setCurrentId(c.id);
      if (view === 'list') void renderList();
    },
  });
  root.replaceChildren();
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', t('AI 助手'));

  /* ---------- 顶上 ---------- */
  const head = el('div', 'ai-head');
  const btnBack = iconButton(t('回到对话'), ICONS.back);
  const titleBtn = el('button', 'ai-title');
  titleBtn.type = 'button';
  titleBtn.title = t('看全部对话：切换、改名、导出、删除');
  const btnList = iconButton(t('全部对话'), ICONS.list);
  const btnNew = iconButton(t('新对话'), ICONS.plus);
  const btnGear = iconButton(t('设置：服务商、模型、钥匙'), ICONS.gear);
  const btnClose = iconButton(t('关掉 AI 助手'), ICONS.close);
  head.append(btnBack, titleBtn, btnList, btnNew, btnGear, btnClose);
  const meta = el('div', 'ai-meta');

  /* ---------- 三个页面 ---------- */
  const chatView = el('div', 'ai-view ai-chat');
  const listView = el('div', 'ai-view ai-list');
  const settingsView = el('div', 'ai-view ai-settings-view');
  const settingsBox = el('div', 'ai-set');
  settingsView.append(settingsBox);

  const log = el('div', 'ai-log');
  log.setAttribute('aria-live', 'polite');
  const compose = el('div', 'ai-compose');
  const input = el('textarea', 'ai-input');
  input.rows = 2;
  input.setAttribute('aria-label', t('对 AI 助手说的话'));
  const btnStop = el('button', 'btn', t('停'));
  btnStop.type = 'button';
  const btnSend = el('button', 'btn primary', t('发送'));
  btnSend.type = 'button';
  const btnMark = el('button', 'btn ghost ai-mark-btn');
  btnMark.type = 'button';
  btnMark.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.circle}</svg>`;
  btnMark.append(el('span', '', t('圈出来')));
  btnMark.title = t('在 3D 视图上把要改的地方圈出来，AI 就知道是哪个部件（先把镜头转好）');
  const attachments = el('div', 'ai-attachments');
  const composeRow = el('div', 'ai-compose-row');
  const composeHint = el('span', 'ai-hint');
  composeRow.append(btnMark, composeHint, btnStop, btnSend);
  compose.append(attachments, input, composeRow);
  chatView.append(log, compose);

  root.append(head, meta, chatView, listView, settingsView);

  type View = 'chat' | 'list' | 'settings';
  let view: View = 'chat';
  function show(next: View) {
    view = next;
    chatView.hidden = next !== 'chat';
    listView.hidden = next !== 'list';
    settingsView.hidden = next !== 'settings';
    btnBack.hidden = next === 'chat';
    btnList.setAttribute('aria-pressed', String(next === 'list'));
    btnGear.setAttribute('aria-pressed', String(next === 'settings'));
    if (next === 'list') void renderList();
    if (next === 'settings') void settings.fill('stale');
    if (next === 'chat') {
      void updateMeta();
      input.focus();
    }
  }

  /* ---------- 设置 ---------- */
  const settings = mountSettings(settingsBox, {
    changed: () => {
      session.settingsChanged();
      void updateMeta();
    },
  });

  /* ---------- 顶上那一行：模型、上下文、花了多少 ---------- */
  let setupProblem: string | null = null;
  async function updateMeta() {
    setupProblem = await session.prepare();
    const c = session.conversation;
    titleBtn.textContent = c.title || t('新对话');
    const m = session.model;
    const parts: string[] = [];
    if (setupProblem) parts.push(setupProblem);
    else if (m) {
      parts.push(m.id);
      parts.push(t('上下文 {used} / {max}', { used: kTokens(session.contextTokens()), max: kTokens(m.contextWindow) }));
    }
    const s = c.spent;
    if (s.input || s.output) {
      const hit = s.cacheRead + s.input > 0 ? Math.round((s.cacheRead / (s.cacheRead + s.input)) * 100) : 0;
      parts.push(s.cost > 0 ? t('这段对话约 {cost} 美元', { cost: dollars(s.cost) }) : t('这段对话用了 {n} 个 token', { n: kTokens(s.input + s.output + s.cacheRead) }));
      if (hit > 0) parts.push(t('缓存命中 {n}%', { n: hit }));
    }
    meta.textContent = parts.join(' · ');
    meta.classList.toggle('warn', Boolean(setupProblem));
  }

  /* ---------- 对话 ---------- */
  /** 还没发出去就出的错（没钥匙）：显示在最后，下次发话时清掉 */
  let failure: { user: string; text: string } | null = null;
  let turnEls: HTMLElement[] = [];

  function helloEl(): HTMLElement {
    const box = el('div', 'ai-hello');
    box.append(el('p', '', t('用大白话说你想要什么样的身体，每一轮改完都能一键撤回。试试：')));
    const chips = el('div', 'chips');
    for (const ex of EXAMPLES) {
      const b = el('button', 'btn ghost', ex);
      b.type = 'button';
      b.addEventListener('click', () => {
        input.value = ex;
        input.focus();
      });
      chips.append(b);
    }
    box.append(chips);
    return box;
  }

  function stepEl(step: Step, live: boolean): HTMLElement {
    if (step.kind === 'text') {
      const d = el('div', 'ai-text');
      d.append(renderMarkdown(step.text));
      return d;
    }
    if (step.kind === 'thinking') {
      const d = el('details', 'ai-fold ai-think');
      d.append(el('summary', '', live ? t('正在思考……') : t('思考过程')));
      const body = el('div', 'ai-fold-body');
      body.append(renderMarkdown(step.text));
      d.append(body);
      return d;
    }
    const d = el('details', `ai-fold ai-tool${step.isError ? ' bad' : ''}`);
    const mark = !step.done ? '…' : step.isError ? '✗' : '✓';
    d.append(el('summary', '', `${mark} ${TOOL_LABEL[step.name] ?? step.name}`));
    const body = el('div', 'ai-fold-body');
    const args = el('pre', '', JSON.stringify(step.args ?? {}, null, 1));
    body.append(el('div', 'ai-fold-label', t('交给工具的参数')), args);
    if (step.done) {
      body.append(el('div', 'ai-fold-label', t('工具回的结果')));
      const res = el('pre', '', step.result.length > 1200 ? `${step.result.slice(0, 1200)}…` : step.result);
      body.append(res);
    }
    d.append(body);
    return d;
  }

  function changesEl(changes: Change[]): HTMLElement {
    const box = el('div', 'ai-changes-box');
    box.append(el('div', 'ai-note', t('这一轮改了：')));
    const list = el('ul', 'ai-changes');
    for (const c of changes) list.append(el('li', '', c.text));
    box.append(list);
    return box;
  }

  function turnEl(turn: Turn, last: boolean): HTMLElement {
    const busy = last && session.busy;
    const wrap = el('div', 'ai-turn');
    const user = el('div', 'ai-msg user', turn.user);
    if (turn.marked.length) user.append(el('div', 'ai-marked', t('圈了：{parts}', { parts: turn.marked.join('、') })));
    if (turn.pictures.length) {
      const pics = el('div', 'ai-pics');
      for (const src of turn.pictures) {
        const img = el('img');
        img.src = src;
        img.alt = t('圈出来的地方');
        img.title = t('点一下放大、缩小');
        img.addEventListener('click', () => img.classList.toggle('big'));
        pics.append(img);
      }
      user.append(pics);
    } else if (turn.images) user.append(el('span', 'ai-attach', t(' · {n} 张图', { n: turn.images })));
    wrap.append(user);
    for (const s of turn.steers) wrap.append(el('div', 'ai-msg user steer', t('（插话）{text}', { text: s })));
    const bot = el('div', 'ai-msg bot');
    turn.steps.forEach((step, i) => bot.append(stepEl(step, busy && i === turn.steps.length - 1)));
    if (busy && !turn.steps.some((s) => s.kind === 'text')) bot.append(el('div', 'ai-text wait', turn.steps.length ? t('改设定……') : t('想一想……')));
    if (turn.changes.length) bot.append(changesEl(turn.changes));
    const note = session.conversation.notes[turn.key];
    if (note?.stopped === 'limit') bot.append(el('div', 'ai-note warn', t('一轮最多让模型连着做 {n} 步，先停在这里。要接着改就再说一句。', { n: MAX_TURNS })));
    if (note?.stopped === 'aborted' || (!busy && turn.stopReason === 'aborted')) bot.append(el('div', 'ai-note', t('已停下。')));
    if (note?.trimmed) bot.append(el('div', 'ai-note', t('对话太长，这一轮发给模型时省掉了最早的几轮。要从头说，点「新对话」。')));
    if (turn.error !== undefined) bot.append(el('div', 'ai-note err', humanError(turn.error, session.route)));
    if (!busy) {
      const foot = el('div', 'ai-foot');
      const u = turn.usage;
      if (u.input || u.output) {
        const cache = u.cacheRead ? t('（缓存 {n}）', { n: kTokens(u.cacheRead) }) : '';
        const cost = u.cost > 0 ? ` · $${dollars(u.cost)}` : '';
        foot.append(el('span', 'ai-usage', t('{model} · 输入 {input}{cache} · 输出 {output}{cost}', { model: turn.model ?? '', input: kTokens(u.input), cache, output: kTokens(u.output), cost })));
      }
      const actions = el('span', 'ai-actions');
      const reply = turn.steps.filter((s) => s.kind === 'text').map((s) => (s as { text: string }).text).join('\n\n');
      if (reply) {
        const copy = el('button', 'btn ghost', t('复制'));
        copy.type = 'button';
        copy.addEventListener('click', async () => {
          copy.textContent = (await copyText(reply)) ? t('已复制') : t('复制失败');
        });
        actions.append(copy);
      }
      if (last) {
        const again = el('button', 'btn ghost', t('重新生成'));
        again.type = 'button';
        again.title = t('撤回这一轮的改动（撤得回的话），把这句话再发一次');
        again.addEventListener('click', () => void session.regenerate());
        actions.append(again);
        if (turn.changes.length) {
          const undo = el('button', 'btn ghost ai-undo', t('撤回这一轮'));
          undo.type = 'button';
          undo.disabled = !session.canUndoTurn();
          if (undo.disabled) undo.title = t('这一轮之后你又改过设定，或者已经撤回过了');
          undo.addEventListener('click', () => {
            if (session.undoTurn()) renderLast();
          });
          actions.append(undo);
        }
      }
      foot.append(actions);
      bot.append(foot);
    }
    wrap.append(bot);
    return wrap;
  }

  function failureEl(): HTMLElement | null {
    if (!failure) return null;
    const box = el('div', 'ai-turn');
    if (failure.user) box.append(el('div', 'ai-msg user', failure.user));
    box.append(el('div', 'ai-msg bot ai-note err', failure.text));
    return box;
  }

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;

  function renderAll() {
    const turns = turnsOf(session.messages, session.starts);
    turnEls = turns.map((tn, i) => turnEl(tn, i === turns.length - 1));
    log.replaceChildren(...(turns.length ? [] : [helloEl()]), ...turnEls);
    const f = failureEl();
    if (f) log.append(f);
    log.scrollTop = log.scrollHeight;
    void updateMeta();
    syncCompose();
  }

  /** 只重画最后一轮（流式写着的时候） */
  function renderLast() {
    const turns = turnsOf(session.messages, session.starts);
    if (turns.length !== turnEls.length) return renderAll();
    if (!turns.length) return;
    const stick = nearBottom();
    const next = turnEl(turns[turns.length - 1], true);
    // 折叠块的开合照原样（人点开的思考过程，流式时别又收起来）
    const was = turnEls[turnEls.length - 1];
    const opened = [...was.querySelectorAll('details')].map((d) => d.open);
    next.querySelectorAll('details').forEach((d, i) => {
      if (opened[i]) d.open = true;
    });
    was.replaceWith(next);
    turnEls[turnEls.length - 1] = next;
    if (stick) log.scrollTop = log.scrollHeight;
    syncCompose();
  }

  let frame = 0;
  const scheduleLast = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderLast();
    });
  };

  function syncCompose() {
    const busy = session.busy;
    btnStop.hidden = !busy;
    composeHint.textContent = busy ? t('正在干活。现在说的话会插进去。') : '';
    input.placeholder = busy ? t('想补充什么？Enter 发送') : t('想怎么改？Enter 发送，Shift+Enter 换行');
    btnNew.disabled = busy;
    btnMark.disabled = busy || marks.length >= MAX_MARKS;
  }

  session.on((e) => {
    if (e.type === 'update') scheduleLast();
    else if (e.type === 'busy') {
      if (e.busy) failure = null;
      renderAll();
    } else if (e.type === 'conversation') {
      failure = null;
      renderAll();
      if (e.forked) {
        const note = el('div', 'ai-note', t('「显示成人部件」开关或界面语言变了，接着说的话放进了一段新对话（旧的在对话列表里）。'));
        log.prepend(note);
      }
    } else if (e.type === 'failed') {
      failure = { user: e.user, text: e.text };
      renderAll();
      if (!settings.needsKey) return;
      show('settings');
    }
  });

  /** 圈好了、还没发出去的 */
  let marks: Mark[] = [];

  function renderAttachments() {
    attachments.replaceChildren();
    marks.forEach((m, i) => {
      const chip = el('div', 'ai-chip');
      if (m.image) {
        const img = el('img');
        img.src = `data:image/jpeg;base64,${m.image}`;
        img.alt = '';
        chip.append(img);
      }
      chip.append(el('span', '', summarizeMark(m)));
      const drop = el('button', 'ai-chip-x', '×');
      drop.type = 'button';
      drop.title = t('不要这个');
      drop.setAttribute('aria-label', t('不要这个'));
      drop.addEventListener('click', () => {
        marks.splice(i, 1);
        renderAttachments();
      });
      chip.append(drop);
      attachments.append(chip);
    });
    attachments.hidden = !marks.length;
    btnMark.disabled = session.busy || marks.length >= MAX_MARKS;
  }

  async function startMark() {
    if (session.busy || marks.length >= MAX_MARKS) return;
    // 画的时候窗口先让开，3D 视图整个露出来
    root.hidden = true;
    const mark = await drawMarks(api);
    root.hidden = false;
    if (mark) {
      marks.push(mark);
      renderAttachments();
    }
    input.focus();
  }

  async function send() {
    const busy = session.busy;
    const text = input.value.trim() || (marks.length && !busy ? t('看看我圈出来的地方。') : '');
    if (!text) return;
    input.value = '';
    saveDraft();
    autosize();
    // 干活时插话只带文字，圈出来的留到下一句
    const sending = busy ? [] : marks;
    if (!busy) {
      marks = [];
      renderAttachments();
    }
    await session.say(text, sending);
  }

  btnMark.addEventListener('click', () => void startMark());
  renderAttachments();

  /** 输入框跟着字数长高（最多六行） */
  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight + 2, 150)}px`;
  }
  input.addEventListener('input', autosize);

  btnSend.addEventListener('click', () => void send());
  btnStop.addEventListener('click', () => session.stop());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    }
  });
  // 没发出去的草稿记着：关了窗口、刷新页面都还在
  const saveDraft = () => {
    try {
      if (input.value) localStorage.setItem(DRAFT_KEY, input.value);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      // 记不住就算了
    }
  };
  input.addEventListener('input', saveDraft);
  try {
    input.value = localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    // 没有就空着
  }

  /* ---------- 对话列表 ---------- */
  function exportMarkdown(c: Conversation) {
    const lines = [`# ${c.title || t('新对话')}`, ''];
    for (const turn of turnsOf(c.messages, new Set(c.starts))) {
      lines.push(`**${t('你')}**：${turn.user}`, '');
      for (const s of turn.steers) lines.push(`**${t('你（插话）')}**：${s}`, '');
      const reply = turn.steps.filter((s) => s.kind === 'text').map((s) => (s as { text: string }).text).join('\n\n');
      if (reply) lines.push(`**AI（${turn.model ?? ''}）**：`, '', reply, '');
      if (turn.changes.length) lines.push(`${t('这一轮改了：')}`, ...turn.changes.map((ch) => `- ${ch.text}`), '');
      if (turn.error !== undefined) lines.push(`> ${humanError(turn.error, 'http')}`, '');
    }
    const name = `${(c.title || 'AI').replace(/[\\/:*?"<>|]/g, '').slice(0, 40)}.md`;
    void saveText(name, lines.join('\n'), 'text/markdown');
  }

  async function renderList() {
    const all = await listConversations();
    listView.replaceChildren();
    const top = el('div', 'ai-list-top');
    const newBtn = el('button', 'btn primary', t('新对话'));
    newBtn.type = 'button';
    newBtn.addEventListener('click', () => {
      // 正在干活时不换对话（和点列表里别的对话一样）：先停下或者等这一轮完
      if (session.busy) return;
      session.startNew();
      show('chat');
    });
    top.append(newBtn, el('span', 'note', t('对话存在这台设备的这个浏览器里，最多留 {n} 段。', { n: 100 })));
    listView.append(top);
    if (!all.length) {
      listView.append(el('p', 'note', t('还没有存下来的对话。')));
      return;
    }
    for (const c of all) {
      const row = el('div', `ai-conv${c.id === session.conversation.id ? ' on' : ''}`);
      const pick = el('button', 'ai-conv-pick');
      pick.type = 'button';
      pick.append(el('span', 'ai-conv-title', c.title || t('新对话')));
      const turns = c.starts.length;
      const info = [ago(c.updated), c.model, t('{n} 轮', { n: turns })];
      if (c.spent.cost > 0) info.push(`$${dollars(c.spent.cost)}`);
      pick.append(el('span', 'ai-conv-info', info.filter(Boolean).join(' · ')));
      pick.addEventListener('click', async () => {
        if (session.busy) return;
        const full = await getConversation(c.id);
        if (full) {
          session.open(full);
          setCurrentId(full.id);
        }
        show('chat');
      });
      const rename = el('button', 'btn ghost', t('改名'));
      rename.type = 'button';
      rename.addEventListener('click', () => {
        const field = el('input');
        field.type = 'text';
        field.value = c.title;
        field.maxLength = 60;
        const done = async () => {
          const title = field.value.trim();
          if (c.id === session.conversation.id) await session.rename(title);
          else await putConversation({ ...c, title });
          void renderList();
          void updateMeta();
        };
        field.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') void done();
          if (e.key === 'Escape') void renderList();
        });
        field.addEventListener('blur', () => void done());
        pick.replaceWith(field);
        field.focus();
        field.select();
      });
      const exportBtn = el('button', 'btn ghost', t('导出'));
      exportBtn.type = 'button';
      exportBtn.title = t('存成一个 Markdown 文件');
      exportBtn.addEventListener('click', () => exportMarkdown(c));
      const del = el('button', 'btn ghost', t('删除'));
      del.type = 'button';
      let armed = false;
      del.addEventListener('click', async () => {
        // 正在干活的这一段不能删：这一轮完了还要存回它
        if (c.id === session.conversation.id && session.busy) return;
        // 点两下才删：第一下变成「再点一下删除」
        if (!armed) {
          armed = true;
          del.textContent = t('再点一下删除');
          del.classList.add('danger');
          return;
        }
        await deleteConversation(c.id);
        if (c.id === session.conversation.id) {
          session.startNew();
          setCurrentId(null);
        }
        void renderList();
      });
      const actions = el('div', 'ai-conv-actions');
      actions.append(rename, exportBtn, del);
      row.append(pick, actions);
      listView.append(row);
    }
  }

  /* ---------- 拖动、缩放（电脑上；手机上铺满整屏，不动） ---------- */
  const PLACE_KEY = 'oc-ai-dock-place';
  const MIN_W = 300;
  const MIN_H = 300;
  interface Place {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  const phoneMq = window.matchMedia(PHONE_QUERY);
  /** 刚拖过（拖标题时松手别又当成点了标题） */
  let dragged = false;
  let place: Place | null = null;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null');
    const p = raw as Partial<Place> | null;
    if (p && [p.x, p.y, p.w, p.h].every((v) => typeof v === 'number' && Number.isFinite(v))) place = p as Place;
  } catch {
    // 没记过就用默认的位置
  }
  const clampPlace = (p: Place): Place => {
    const w = Math.min(Math.max(p.w, MIN_W), innerWidth - 16);
    const h = Math.min(Math.max(p.h, MIN_H), innerHeight - 16);
    return { w, h, x: Math.min(Math.max(p.x, 8), innerWidth - w - 8), y: Math.min(Math.max(p.y, 8), innerHeight - h - 8) };
  };
  function applyPlace() {
    const floating = Boolean(place) && !phoneMq.matches;
    root.classList.toggle('floating', floating);
    if (!floating || !place) {
      root.style.removeProperty('left');
      root.style.removeProperty('top');
      root.style.removeProperty('width');
      root.style.removeProperty('height');
      return;
    }
    place = clampPlace(place);
    root.style.left = `${place.x}px`;
    root.style.top = `${place.y}px`;
    root.style.width = `${place.w}px`;
    root.style.height = `${place.h}px`;
  }
  const savePlace = () => {
    try {
      if (place) localStorage.setItem(PLACE_KEY, JSON.stringify(place));
      else localStorage.removeItem(PLACE_KEY);
    } catch {
      // 记不住就下次回到默认位置
    }
  };
  /** 拖着改位置、大小：dir 是哪条边（n、s、e、w 和四个角），move 是拖标题栏 */
  function dragFrom(e: PointerEvent, dir: string) {
    if (phoneMq.matches || e.button !== 0) return;
    e.preventDefault();
    const r = root.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const from: Place = { x: r.left, y: r.top, w: r.width, h: r.height };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    root.classList.add('dragging');
    dragged = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (Math.hypot(dx, dy) > 3) dragged = true;
      const p = { ...from };
      if (dir === 'move') {
        p.x += dx;
        p.y += dy;
      } else {
        if (dir.includes('e')) p.w = Math.max(MIN_W, from.w + dx);
        if (dir.includes('s')) p.h = Math.max(MIN_H, from.h + dy);
        if (dir.includes('w')) {
          p.w = Math.max(MIN_W, from.w - dx);
          p.x = from.x + from.w - p.w;
        }
        if (dir.includes('n')) {
          p.h = Math.max(MIN_H, from.h - dy);
          p.y = from.y + from.h - p.h;
        }
      }
      place = p;
      applyPlace();
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      root.classList.remove('dragging');
      savePlace();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }
  for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    const grip = el('div', `ai-grip ai-grip-${dir}`);
    // 右下角画两道斜杠：一看就知道能拖着改大小
    if (dir === 'se') {
      grip.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M11 4 4 11M11 8.5 8.5 11"/></svg>';
      grip.title = t('拖这里改窗口大小');
    }
    grip.addEventListener('pointerdown', (e) => dragFrom(e, dir));
    root.append(grip);
  }
  head.addEventListener('pointerdown', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b && b !== titleBtn) return;
    dragFrom(e, 'move');
  });
  // 双击标题栏：回到默认的位置和大小
  head.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    place = null;
    savePlace();
    applyPlace();
  });
  head.title = t('拖这里挪窗口，拖边、角改大小；双击回到原来的位置');
  window.addEventListener('resize', applyPlace);
  phoneMq.addEventListener?.('change', applyPlace);
  applyPlace();

  /* ---------- 开关 ---------- */
  let opened = false;
  let started = false;
  async function start() {
    if (started) return;
    started = true;
    const id = currentId();
    const c = id ? await getConversation(id) : null;
    if (c) session.open(c);
    else renderAll();
    show(settings.needsKey ? 'settings' : 'chat');
  }

  function open() {
    opened = true;
    root.hidden = false;
    hooks.toggled(true);
    void start().then(() => {
      if (view === 'chat') input.focus();
    });
  }

  function close() {
    opened = false;
    root.hidden = true;
    hooks.toggled(false);
  }

  btnClose.addEventListener('click', close);
  btnBack.addEventListener('click', () => show('chat'));
  btnList.addEventListener('click', () => show(view === 'list' ? 'chat' : 'list'));
  titleBtn.addEventListener('click', () => {
    if (dragged) {
      dragged = false;
      return;
    }
    show(view === 'list' ? 'chat' : 'list');
  });
  btnGear.addEventListener('click', () => show(view === 'settings' ? 'chat' : 'settings'));
  btnNew.addEventListener('click', () => {
    session.startNew();
    show('chat');
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (view !== 'chat') show('chat');
    else close();
  });

  return {
    open,
    close,
    toggle: () => (opened ? close() : open()),
    get isOpen() {
      return opened;
    },
    refresh() {
      if (opened && !session.busy && view === 'chat') renderLast();
    },
    stop: () => session.stop(),
  };
}
