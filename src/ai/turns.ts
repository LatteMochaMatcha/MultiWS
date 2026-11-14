/**
 * 把 pi 的整段消息分成一轮一轮给界面画：一轮 = 用户说的一句话，到下一句话之前模型的所有回答、工具调用和结果。
 * 界面上看到的全从消息里算出来（存下来的对话也一样画得出来），不另记一份。纯函数，测试里直接用。
 */
import { type Adjusted, type Change, mergeChanges } from './body';
import { MARK_PREFIX } from './marks';

export type Step =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; args: unknown; done: boolean; isError: boolean; result: string; changes: Change[]; adjusted: Adjusted[] };

export interface TurnUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface Turn {
  /** 用户那句话的时间戳（Conversation.notes 的键） */
  key: string;
  /** 这一轮从第几条消息开始（重新生成时从这里截掉） */
  start: number;
  user: string;
  images: number;
  /** 这句话附的图（data: 地址，界面上显示小图） */
  pictures: string[];
  /** 在 3D 视图上圈出来的部件（界面语言的名字） */
  marked: string[];
  /** 正在干活时插进来的话（steer），跟在这一轮里 */
  steers: string[];
  steps: Step[];
  /** 这一轮一共改了什么（同一项改了几次只算头尾） */
  changes: Change[];
  usage: TurnUsage;
  model?: string;
  /** 最后一次回答的结果：stop、toolUse、error、aborted…… */
  stopReason?: string;
  /** 服务商的原话（界面再翻成人话） */
  error?: string;
}

interface Msg {
  role: string;
  content?: unknown;
  timestamp?: number;
  [key: string]: unknown;
}

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((c) => c && (c as { type?: string }).type === 'text')
          .map((c) => (c as { text: string }).text)
          .join('')
      : '';

const imagesOf = (content: unknown) => (Array.isArray(content) ? content.filter((c) => c && (c as { type?: string }).type === 'image').length : 0);

/** 用户那句话里自己写的（圈出来的那段说明不算） */
const spokenOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((c) => c && (c as { type?: string }).type === 'text' && !String((c as { text?: string }).text).startsWith(MARK_PREFIX))
          .map((c) => (c as { text: string }).text)
          .join('')
      : '';

/** 圈出来的那段说明里的部件名：「Arm_02_L (手臂 2 · 左, 70%)」里括号中的那个 */
const markedOf = (content: unknown): string[] => {
  if (!Array.isArray(content)) return [];
  const out = new Set<string>();
  for (const c of content) {
    const text = (c as { type?: string; text?: string }).type === 'text' ? String((c as { text?: string }).text) : '';
    if (!text.startsWith(MARK_PREFIX)) continue;
    for (const m of text.matchAll(/\(([^,()]+), \d+%\)/g)) out.add(m[1]);
  }
  return [...out];
};

const picturesOf = (content: unknown): string[] =>
  Array.isArray(content)
    ? content
        .filter((c) => c && (c as { type?: string }).type === 'image')
        .map((c) => `data:${(c as { mimeType?: string }).mimeType ?? 'image/jpeg'};base64,${(c as { data?: string }).data ?? ''}`)
    : [];

const emptyUsage = (): TurnUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });

/**
 * messages：pi 的整段消息（可以把正在流式写的那条接在最后）。
 * starts：哪几句话（时间戳）是用户新开的一轮；给了就照它分，没给就照「上一轮还在等工具」猜哪句是插话
 */
export function turnsOf(messages: readonly unknown[], starts?: ReadonlySet<number>): Turn[] {
  const turns: Turn[] = [];
  let turn: Turn | null = null;
  const tools = new Map<string, Extract<Step, { kind: 'tool' }>>();
  /** 上一条（不算系统消息）：模型停下来等工具结果、或者刚有工具结果时，这一轮还没完 */
  let open = false;
  messages.forEach((raw, index) => {
    const m = raw as Msg;
    if (!m || typeof m !== 'object' || m.role === 'system') return;
    if (m.role === 'user') {
      // 这一轮还在干活时进来的话：是插话（steer），算在这一轮里
      const steer = starts ? !starts.has(Number(m.timestamp)) : open;
      if (turn && steer) {
        turn.steers.push(textOf(m.content));
        return;
      }
      turn = {
        key: String(m.timestamp ?? index),
        start: index,
        user: spokenOf(m.content),
        images: imagesOf(m.content),
        pictures: picturesOf(m.content),
        marked: markedOf(m.content),
        steers: [],
        steps: [],
        changes: [],
        usage: emptyUsage(),
      };
      turns.push(turn);
      open = false;
      return;
    }
    if (!turn) return;
    if (m.role === 'assistant') {
      for (const c of Array.isArray(m.content) ? m.content : []) {
        const block = c as { type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: unknown };
        if (block.type === 'thinking' && block.thinking) turn.steps.push({ kind: 'thinking', text: block.thinking });
        else if (block.type === 'text' && block.text) turn.steps.push({ kind: 'text', text: block.text });
        else if (block.type === 'toolCall' && block.id) {
          const step: Extract<Step, { kind: 'tool' }> = { kind: 'tool', id: block.id, name: block.name ?? '', args: block.arguments, done: false, isError: false, result: '', changes: [], adjusted: [] };
          tools.set(block.id, step);
          turn.steps.push(step);
        }
      }
      const u = m.usage as Partial<TurnUsage> & { cost?: { total?: number } } | undefined;
      if (u) {
        turn.usage.input += u.input ?? 0;
        turn.usage.output += u.output ?? 0;
        turn.usage.cacheRead += u.cacheRead ?? 0;
        turn.usage.cacheWrite += u.cacheWrite ?? 0;
        turn.usage.cost += u.cost?.total ?? 0;
      }
      if (typeof m.model === 'string') turn.model = m.model;
      turn.stopReason = typeof m.stopReason === 'string' ? m.stopReason : undefined;
      open = m.stopReason === 'toolUse';
      turn.error = m.stopReason === 'error' ? String(m.errorMessage ?? '') : undefined;
    } else if (m.role === 'toolResult') {
      open = true;
      const step = tools.get(String(m.toolCallId));
      if (!step) return;
      const details = (m.details ?? {}) as { changes?: Change[]; adjusted?: Adjusted[] };
      step.done = true;
      step.isError = m.isError === true;
      step.result = textOf(m.content);
      step.changes = details.changes ?? [];
      step.adjusted = details.adjusted ?? [];
      turn.changes = mergeChanges([...turn.changes, ...step.changes]);
    }
  });
  return turns;
}

/** 一段对话一共花了多少（从消息里算；重新生成丢掉的那几轮不在里面） */
export function usageOf(messages: readonly unknown[]): TurnUsage {
  const total = emptyUsage();
  for (const t of turnsOf(messages)) {
    total.input += t.usage.input;
    total.output += t.usage.output;
    total.cacheRead += t.usage.cacheRead;
    total.cacheWrite += t.usage.cacheWrite;
    total.cost += t.usage.cost;
  }
  return total;
}

/** 给对话起个标题：第一句话的前 24 个字 */
export function titleOf(messages: readonly unknown[]): string {
  const first = turnsOf(messages)[0]?.user.trim().replace(/\s+/g, ' ') ?? '';
  return first.length > 24 ? `${first.slice(0, 24)}…` : first;
}
