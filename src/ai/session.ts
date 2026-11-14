/**
 * AI 助手的运行框架：pi-agent-core 的 Agent 接上工坊。
 *
 * - 一轮（用户说一句话，到模型说完）里的所有改动在撤销记录里并成一步（WorkshopApi.hold），面板上能整轮撤回；
 * - 一轮最多跑 MAX_TURNS 次模型调用，到了就停，免得一直烧钱；
 * - 报错、被拒、钥匙不对、额度用完、连不上，都翻成一句人话，不重试；
 * - 服务商、模型、思考深度从设置里读（settings.ts），换了就接着用同一段对话；成人部件开关、界面语言变了另起一段；
 * - 对话存在浏览器里（store.ts），能切换、接着聊；同一段对话用同一个会话号，服务商的提示缓存接得上；
 * - 干活时又说的话插进去（steer）；最后一轮能重来（先撤回它的改动）。
 */
import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model, Models } from '@earendil-works/pi-ai';
import { type Lang, t } from '../i18n';
import { STALE_MS, fetchListing, loadListing, mergeModels, saveListing } from './catalog';
import { type Mark, describeMarks } from './marks';
import { systemPrompt } from './prompt';
import { CUSTOM_ID, customModel, customProvider, providerOf } from './providers';
import { type AiSettings, loadKey, loadSettings } from './settings';
import { type Conversation, newConversation } from './store';
import { bodyTools } from './tools';
import { type Route, detectRoute, routeModel } from './transport';
import { titleOf, turnsOf, usageOf } from './turns';
import type { WorkshopApi } from './workshop';

/** 用户那句话：纯文字，或者几段文字加图 */
type UserContent = string | ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];

/** 设置没填好（没钥匙、没地址）：这句话原样给人看，不当成服务商的报错去猜 */
export class SetupError extends Error {}

/** 一轮最多调用几次模型（每次可能带好几个工具调用） */
export const MAX_TURNS = 12;

/** 发给模型的对话最多占它上下文的几成（剩下的留给系统提示、工具说明和它的回答） */
export const CONTEXT_SHARE = 0.6;

/** 粗估一条消息多少 token：中文大约一字一个、英文四字母一个，按 2.5 个字符一个算；图按 1500 个算 */
export function estimateTokens(message: unknown): number {
  let images = 0;
  const text = JSON.stringify(message, (key, value) => {
    if (key === 'data' && typeof value === 'string' && value.length > 1000) {
      images++;
      return '';
    }
    return value;
  });
  return Math.ceil(text.length / 2.5) + images * 1500;
}

/**
 * 对话太长、快装不进模型的上下文时，从最早的一轮开始整轮省掉（一轮 = 用户一句话到下一句话之前，工具调用和结果不会被拆开）。
 * 开头的系统消息、最近的一轮一定留着。返回省过的对话和省没省
 */
export function trimContext<T extends { role: string }>(messages: readonly T[], contextWindow: number): { messages: T[]; trimmed: boolean } {
  const budget = contextWindow * CONTEXT_SHARE;
  const out = [...messages];
  let lead = 0;
  while (lead < out.length && out[lead].role === 'system') lead++;
  let total = out.reduce((sum, m) => sum + estimateTokens(m), 0);
  let trimmed = false;
  while (total > budget) {
    // 第二轮从哪开始：在它之前的（最早那一轮）整个去掉
    let next = -1;
    for (let i = lead + 1; i < out.length; i++) {
      if (out[i].role === 'user') {
        next = i;
        break;
      }
    }
    if (next < 0) break;
    for (const m of out.splice(lead, next - lead)) total -= estimateTokens(m);
    trimmed = true;
  }
  return { messages: out, trimmed };
}

/** 用哪个模型：设置里选的，或者测试里直接给的 */
export interface Resolved {
  models: Models;
  model: Model<Api>;
  apiKey: string;
  route: Route;
}

/** 一家服务商能选的模型：pi 预设，合上从服务商那里问到的列表（见 catalog.ts） */
export interface Lineup {
  models: Models;
  /** 能选的模型（地址还没改成转发的） */
  list: Model<Api>[];
  /** 列表是什么时候从服务商那里问来的；null 是只有 pi 预设 */
  listedAt: number | null;
  /** 这次去问的时候出的错（列表照旧用存着的或 pi 预设） */
  listError?: string;
  apiKey: string;
  route: Route;
}

/**
 * 照设置载入服务商和它的模型表。fetch：
 * 'never' 只用存着的列表（发话时用，不多等）；'stale' 存着的过期了（或没有）才去问；'always' 一定去问（点「刷新列表」、换钥匙）
 */
export async function lineup(s: AiSettings, fetch: 'never' | 'stale' | 'always' = 'never'): Promise<Lineup> {
  const { createModels } = await import('@earendil-works/pi-ai');
  const models = createModels({ identity: { attribution: { name: 'OC Base Mesh Workshop', url: 'https://github.com/LatteMochaMatcha/MultiWS' } } });
  const choice = providerOf(s.provider);
  const custom = choice.id === CUSTOM_ID;
  let catalog: Model<Api>[];
  let template: Model<Api>;
  if (custom) {
    if (!s.customBaseUrl.trim()) throw new SetupError(t('「自定义」要先填服务地址。'));
    models.setProvider(await customProvider(s));
    template = customModel(s) as Model<Api>;
    catalog = s.customModel.trim() ? [template] : [];
  } else {
    models.setProvider(await choice.load!());
    catalog = [...models.getModels(choice.id)];
    template = catalog.find((m) => m.id === choice.model) ?? catalog[0];
    if (!template) throw new SetupError(t('这家没有能用的模型。'));
  }
  const route = await detectRoute();
  const key = loadKey(choice.id);
  // 自定义的不要钥匙（本机 Ollama）：pi 不肯在没钥匙时发请求，给个占位的，服务器那边不看
  const apiKey = key || (custom ? 'none' : '');
  let cached = loadListing(choice.id, key);
  let listError: string | undefined;
  // OpenRouter 的列表不要钥匙也能问
  const canAsk = Boolean(key) || custom || choice.id === 'openrouter';
  const due = fetch === 'always' || (fetch === 'stale' && (!cached || Date.now() - cached.at > STALE_MS));
  if (due && canAsk) {
    try {
      const found = await fetchListing(template, choice.id, key, route);
      saveListing(choice.id, key, found);
      cached = loadListing(choice.id, key) ?? { at: Date.now(), keyTail: '', models: found };
    } catch (err) {
      listError = err instanceof Error ? err.message : String(err);
    }
  }
  return { models, list: mergeModels(catalog, cached?.models ?? null, template), listedAt: cached?.at ?? null, listError, apiKey, route };
}

/** 设置里选的是哪个模型：选过的、这家默认的、列表第一个；都不在列表里就照这家的写法拼一个（新出的型号也能用） */
export function pickModel(s: AiSettings, l: Lineup): Model<Api> | undefined {
  const choice = providerOf(s.provider);
  const want = choice.id === CUSTOM_ID ? s.customModel.trim() : s.model;
  const found = (want && l.list.find((m) => m.id === want)) || (!want && choice.model && l.list.find((m) => m.id === choice.model)) || (!want ? l.list[0] : undefined);
  if (found) return found;
  const like = l.list[0];
  if (want && like) return { ...like, id: want, name: want };
  return undefined;
}

/** 照设置载入服务商、挑模型、决定走不走转发 */
export async function resolveFromSettings(s: AiSettings): Promise<Resolved> {
  const l = await lineup(s, 'never');
  const model = pickModel(s, l);
  if (!model) throw new SetupError(providerOf(s.provider).id === CUSTOM_ID ? t('「自定义」要先选或填一个型号。') : t('这家没有能用的模型。'));
  return { models: l.models, model: routeModel(model, l.route), apiKey: l.apiKey, route: l.route };
}

/** 报错翻成一句人话 */
export function humanError(message: string, route: Route): string {
  const m = message || '';
  if (/\b401\b|unauthori[sz]ed|invalid.{0,20}(api[ _-]?key|token|x-api-key)|authentication|incorrect api key/i.test(m)) return t('钥匙不对，或者已经失效。到设置里重新填一下。');
  if (/\b402\b|insufficient|quota|balance|billing|credit|余额|欠费/i.test(m)) return t('这家的额度用完了，或者账户余额不足。');
  if (/\b429\b|rate.?limit|too many requests|overloaded|\b529\b/i.test(m)) return t('服务商那边太忙，或者请求太频繁被限流了。等一会儿再试。');
  if (/\b404\b|model.{0,40}(not.?found|not exist|does not exist|unknown)/i.test(m)) return t('服务商说没有这个模型。到设置里换一个型号。');
  if (/refus|content.?(policy|filter|management)|safety|sensitive|inappropriate|审核|违规|敏感/i.test(m)) return t('服务商拒绝了这个请求（内容审核）。换个说法，或者换一家试试。');
  if (/failed to fetch|networkerror|network error|load failed|fetch failed|econn|enotfound|etimedout|timed? ?out|cors/i.test(m)) {
    if (route === 'stale') return t('连不上服务商。这一版的 exe / 安卓版还没有 AI 助手要用的转发，很多家会被跨域限制挡住（Claude 不会）：请到项目主页下载新的安装包装上；也可能是网络不通。');
    return route === 'direct'
      ? t('连不上服务商。网页版直接连常被浏览器的跨域限制挡住，请用 exe 或安卓版；也可能是网络不通。')
      : t('连不上服务商，检查一下网络（国外的服务可能要开代理）。');
  }
  return t('出错了：{message}', { message: m.length > 240 ? `${m.slice(0, 240)}…` : m });
}

export type AiEvent =
  /** 消息变了（流式写着、工具做完）：重画最后一轮 */
  | { type: 'update' }
  /** 开始干活、干完了 */
  | { type: 'busy'; busy: boolean }
  /** 换了一段对话（打开别的、新对话、成人部件开关变了自动另起）：整个重画 */
  | { type: 'conversation'; forked?: boolean }
  /** 还没发出去就出错（没钥匙、没地址）：这句话不进对话 */
  | { type: 'failed'; text: string; user: string };

export interface SessionOptions {
  api: WorkshopApi;
  lang: Lang;
  /** 测试里换成假服务商；默认照设置去载入 pi 的服务商 */
  resolve?: (settings: AiSettings) => Promise<Resolved>;
  /** 一轮干完、改了名字时存起来（见 store.ts）；测试里不给 */
  save?: (c: Conversation) => void | Promise<void>;
}

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class AiSession {
  private agent: Agent | null = null;
  /** agent 是照哪段对话建的 */
  private agentFor = '';
  private resolved: Resolved | null = null;
  private runKey = '';
  private turnsThisRun = 0;
  private hitLimit = false;
  private trimmedThisRun = false;
  private stopped = false;
  /** 一轮从头到尾都算在干活（载入服务商、收尾存档那两段 pi 不在流式输出，也不能再起一轮） */
  private running = false;
  /** 这一轮里插的话：一轮结束时看哪几句没送到模型手上 */
  private steered: { text: string; at: number }[] = [];
  private listeners = new Set<(e: AiEvent) => void>();
  /** 上一轮结束时撤销记录的记号；「撤回这一轮」时核对 */
  private lastMark: unknown = null;
  private lastChanged = false;
  conversation: Conversation;

  constructor(private readonly opts: SessionOptions) {
    this.conversation = this.fresh();
  }

  private fresh(): Conversation {
    const s = loadSettings();
    return newConversation(this.opts.api.adultOn(), this.opts.lang, s.provider, s.model);
  }

  on(listener: (e: AiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: AiEvent) {
    for (const l of this.listeners) l(e);
  }

  get busy(): boolean {
    return this.running || (this.agent?.state.isStreaming ?? false);
  }

  /** 走的是哪条路（报错翻成人话时要看） */
  get route(): Route {
    return this.resolved?.route ?? 'direct';
  }

  /** 现在用的模型（还没载入就是 null；prepare 以后有） */
  get model(): Model<Api> | null {
    return this.resolved?.model ?? null;
  }

  /** 界面要画的消息：存着的，干活时加上正在流式写的那一条 */
  get messages(): unknown[] {
    if (!this.agent || this.agentFor !== this.conversation.id) return this.conversation.messages;
    const streaming = this.agent.state.streamingMessage;
    return streaming ? [...this.agent.state.messages, streaming] : [...this.agent.state.messages];
  }

  get starts(): ReadonlySet<number> {
    return new Set(this.conversation.starts);
  }

  /** 打开窗口时先把模型载进来（不联网），好显示上下文多长、多少钱 */
  async prepare(): Promise<string | null> {
    try {
      if (!this.resolved) this.resolved = await (this.opts.resolve ?? resolveFromSettings)(loadSettings());
      return null;
    } catch (err) {
      return err instanceof SetupError ? err.message : humanError(err instanceof Error ? err.message : String(err), this.route);
    }
  }

  /** 设置改了：下一次发话时重新载入服务商、模型（对话接着用） */
  settingsChanged() {
    this.resolved = null;
    if (this.agent && !this.busy) this.agent = null;
  }

  /** 换到另一段对话 */
  open(c: Conversation) {
    this.stop();
    this.agent = null;
    this.conversation = c;
    this.lastMark = null;
    this.lastChanged = false;
    this.emit({ type: 'conversation' });
  }

  /** 新对话（还没说话前不存） */
  startNew() {
    this.open(this.fresh());
  }

  stop() {
    if (!this.busy) return;
    this.stopped = true;
    this.agent?.abort();
  }

  /** 上一轮的改动还能不能整轮撤回（之后人自己又改过、撤销过、换了对话就不能了） */
  canUndoTurn(): boolean {
    return this.lastChanged && !this.busy && this.lastMark !== null && this.opts.api.mark() === this.lastMark;
  }

  undoTurn(): boolean {
    if (!this.canUndoTurn()) return false;
    this.opts.api.undo();
    this.lastMark = null;
    this.lastChanged = false;
    return true;
  }

  /** 最后一轮重来：先撤回它的改动（撤得回的话），对话截掉这一轮，再把那句话发一次 */
  async regenerate(): Promise<void> {
    if (this.busy) return;
    const last = turnsOf(this.conversation.messages, this.starts).pop();
    if (!last) return;
    this.undoTurn();
    // 那句话原样（连圈出来的部件和图）再发一次
    const original = (this.conversation.messages[last.start] as { content?: UserContent } | undefined)?.content ?? last.user;
    this.conversation = {
      ...this.conversation,
      messages: this.conversation.messages.slice(0, last.start),
      starts: this.conversation.starts.filter((s) => String(s) !== last.key),
    };
    this.agent = null;
    this.emit({ type: 'conversation' });
    await this.run(last.user, () => original);
  }

  /** 改对话的标题 */
  async rename(title: string) {
    this.conversation = { ...this.conversation, title: title.trim() };
    if (this.conversation.messages.length) await this.opts.save?.(this.conversation);
  }

  private async ensure(): Promise<Agent> {
    const settings = loadSettings();
    if (!this.resolved) this.resolved = await (this.opts.resolve ?? resolveFromSettings)(settings);
    const { models, model, apiKey } = this.resolved;
    const thinkingLevel = model.reasoning ? settings.thinking : 'off';
    if (this.agent && this.agentFor === this.conversation.id) {
      this.agent.state.model = model;
      this.agent.state.thinkingLevel = thinkingLevel;
      return this.agent;
    }
    const adult = this.conversation.adult;
    const tools: AgentTool[] = bodyTools({ api: this.opts.api, undoKey: () => this.runKey }, adult);
    this.agentFor = this.conversation.id;
    this.agent = new Agent({
      // 接着以前的对话：消息原样交回（开头那条系统消息就是当时的系统提示）
      initialState: { systemPrompt: systemPrompt(this.conversation.lang, adult), model, thinkingLevel, tools, messages: plain(this.conversation.messages) as AgentMessage[] },
      streamFn: models.streamSimple.bind(models),
      getApiKey: () => this.resolved?.apiKey ?? apiKey,
      // 改设定的工具一个个来（后一个要看前一个改完的样子）
      toolExecution: 'sequential',
      // 对话太长时省掉最早的几轮：上下文多长看模型的元数据（服务商说的，或 pi 预设）
      transformContext: async (messages) => {
        const r = trimContext(messages, this.resolved?.model.contextWindow ?? 128_000);
        if (r.trimmed) this.trimmedThisRun = true;
        return r.messages;
      },
      // 提示缓存：同一段对话用同一个会话号（存着的对话关了再开也一样），服务商那边的缓存接得上
      sessionId: `oc-${this.conversation.id}`,
      identity: { attribution: { name: 'OC Base Mesh Workshop', url: 'https://github.com/LatteMochaMatcha/MultiWS' } },
      finishTurn: async ({ message }) => {
        if (message.stopReason === 'error' || message.stopReason === 'aborted') return undefined;
        this.turnsThisRun++;
        if (this.turnsThisRun >= MAX_TURNS) {
          this.hitLimit = true;
          return { action: 'end' };
        }
        return undefined;
      },
    });
    this.agent.subscribe((e) => this.relay(e));
    return this.agent;
  }

  private relay(e: AgentEvent) {
    if (e.type === 'message_start' || e.type === 'message_update' || e.type === 'message_end' || e.type === 'tool_execution_start' || e.type === 'tool_execution_end') {
      this.emit({ type: 'update' });
    }
  }

  /** 正在干活时用户又说了一句：插进去（下一步模型就看得到）；没在干活就是正常发话。插话只带文字（圈出来的留到下一句） */
  async say(text: string, marks: readonly Mark[] = []): Promise<void> {
    if (!this.busy) return this.send(text, marks);
    if (!this.agent) {
      this.emit({ type: 'failed', text: t('这句话没来得及发给模型，要的话再发一次。'), user: text });
      return;
    }
    const at = Date.now();
    this.steered.push({ text, at });
    this.agent.steer({ role: 'user', content: text, timestamp: at });
    this.emit({ type: 'update' });
  }

  /**
   * 用户说了一句话：跑完整一轮。marks：在 3D 视图上圈出来的地方——部件名总是发，图只发给能看图的模型
   */
  async send(text: string, marks: readonly Mark[] = []): Promise<void> {
    await this.run(text, (vision) => {
      if (!marks.length) return text;
      const blocks: UserContent = [{ type: 'text', text }, { type: 'text', text: describeMarks(marks, vision) }];
      if (vision) for (const m of marks) if (m.image) blocks.push({ type: 'image', data: m.image, mimeType: 'image/jpeg' });
      return blocks;
    });
  }

  /** 跑一轮：content 照模型能不能看图拼出发给它的那句话 */
  private async run(text: string, content: (vision: boolean) => UserContent): Promise<void> {
    if (this.busy) return;
    this.running = true;
    const api = this.opts.api;
    // 成人部件开关、界面语言变了：工具和系统提示都不一样了，另起一段（旧的留在列表里）
    if (this.conversation.messages.length && (this.conversation.adult !== api.adultOn() || this.conversation.lang !== this.opts.lang)) {
      this.agent = null;
      this.conversation = this.fresh();
      this.emit({ type: 'conversation', forked: true });
    }
    let agent: Agent;
    try {
      agent = await this.ensure();
      if (!this.resolved?.apiKey && providerOf(loadSettings().provider).id !== CUSTOM_ID) throw new SetupError(t('还没填钥匙。在设置里填上这家的钥匙。'));
    } catch (err) {
      const why = err instanceof SetupError ? err.message : humanError(err instanceof Error ? err.message : String(err), this.route);
      this.running = false;
      this.emit({ type: 'failed', text: why, user: text });
      return;
    }
    const at = Date.now();
    const before = api.mark();
    const from = agent.state.messages.length;
    this.conversation = { ...this.conversation, starts: [...this.conversation.starts, at] };
    /** 这一轮是哪段对话的：跑到一半换了对话的话，结果还存回这一段，不写进新换的那段里 */
    const mine = this.conversation;
    this.steered = [];
    this.turnsThisRun = 0;
    this.hitLimit = false;
    this.trimmedThisRun = false;
    this.stopped = false;
    this.runKey = `ai:${at.toString(36)}`;
    this.emit({ type: 'busy', busy: true });
    api.hold(this.runKey);
    try {
      const vision = Boolean(this.resolved?.model.input.includes('image'));
      await agent.prompt({ role: 'user', content: content(vision), timestamp: at });
    } catch (err) {
      // pi 一般把错写进消息里；真抛出来的（极少）记成这一轮的错
      this.emit({ type: 'failed', text: humanError(err instanceof Error ? err.message : String(err), this.route), user: '' });
    } finally {
      api.release();
    }
    const messages = plain(agent.state.messages) as AgentMessage[];
    const spentNow = usageOf(messages.slice(from));
    const s = loadSettings();
    const here = this.conversation.id === mine.id;
    const was = here ? this.conversation : mine;
    const done: Conversation = {
      ...was,
      messages,
      title: was.title || titleOf(messages),
      updated: Date.now(),
      provider: s.provider,
      model: this.resolved?.model.id ?? s.model,
      spent: {
        input: was.spent.input + spentNow.input,
        output: was.spent.output + spentNow.output,
        cacheRead: was.spent.cacheRead + spentNow.cacheRead,
        cacheWrite: was.spent.cacheWrite + spentNow.cacheWrite,
        cost: was.spent.cost + spentNow.cost,
      },
      notes: this.hitLimit || this.stopped || this.trimmedThisRun
        ? { ...was.notes, [String(at)]: { stopped: this.stopped ? 'aborted' : this.hitLimit ? 'limit' : undefined, trimmed: this.trimmedThisRun || undefined } }
        : was.notes,
    };
    // 插的话没送到模型手上（这一轮停了、出错了、到了步数上限）：不留在队列里拖到下一轮，告诉用户
    const sent = new Set(messages.map((m) => (m as { role?: string; timestamp?: number }).role === 'user' ? (m as { timestamp?: number }).timestamp : undefined));
    const unsent = this.steered.filter((s) => !sent.has(s.at)).map((s) => s.text);
    this.steered = [];
    agent.clearSteeringQueue();
    if (here) {
      this.conversation = done;
      const after = api.mark();
      this.lastChanged = after !== before;
      this.lastMark = this.lastChanged ? after : null;
    }
    try {
      await this.opts.save?.(done);
    } catch {
      // 存不了（浏览器不让存）：这一段还在内存里，接着聊不受影响
    }
    this.running = false;
    this.emit({ type: 'busy', busy: false });
    this.emit({ type: 'update' });
    if (unsent.length) this.emit({ type: 'failed', text: t('这句话没来得及发给模型，要的话再发一次。'), user: unsent.join('\n') });
  }

  /** 发给模型的大概有多少 token（界面上显示上下文用了多少） */
  contextTokens(): number {
    return (this.messages as unknown[]).reduce<number>((sum, m) => sum + estimateTokens(m), 0);
  }
}
