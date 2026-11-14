/**
 * AI 助手的对话存在这台设备的浏览器里（IndexedDB），关了再开还在，能切换、改名、删除。
 * 不进配置文件、场景文件、导出的模型。存不了（无痕窗口、旧内核出错）就只存在这次打开的内存里。
 * 一段对话 = pi 的整段消息（系统提示、用户的话、模型的回答、工具调用和结果，原样存，接着聊时原样交回给 pi），
 * 加上界面要的几样（标题、时间、花了多少钱、哪几轮停在了哪）。钥匙不在里面。
 */
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Lang } from '../i18n';

export interface Conversation {
  id: string;
  title: string;
  created: number;
  updated: number;
  /** pi 的整段消息；也当提示缓存的会话号用（id 不变，服务商那边的缓存就接得上） */
  messages: AgentMessage[];
  /** 开这段对话时成人部件开关、界面语言是什么样（系统提示照它们写的；变了另起一段） */
  adult: boolean;
  lang: Lang;
  provider: string;
  model: string;
  /** 这段对话一共花了多少（重新生成丢掉的那几轮也算在里面） */
  spent: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
  /** 某一轮（键是那句话的时间戳）停在了哪：步数到顶、被停下、省掉了前面的对话 */
  notes: Record<string, { stopped?: 'limit' | 'aborted'; trimmed?: boolean }>;
  /** 哪几句话（时间戳）是用户新开的一轮；别的用户消息是干活时插的话 */
  starts: number[];
}

const DB = 'oc-ai';
const STORE = 'conversations';
const CURRENT_KEY = 'oc-ai-current';
/** 最多存多少段，多了删最旧的 */
export const KEEP = 100;

export function newConversation(adult: boolean, lang: Lang, provider: string, model: string): Conversation {
  const now = Date.now();
  return {
    id: `c${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: '',
    created: now,
    updated: now,
    messages: [],
    adult,
    lang,
    provider,
    model,
    spent: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    notes: {},
    starts: [],
  };
}

/* ---------------- IndexedDB（打不开就用内存） ---------------- */

const memory = new Map<string, Conversation>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const req = work(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

/** 存进去的是纯数据：先过一遍 JSON（消息里不会有函数，但保险） */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export async function listConversations(): Promise<Conversation[]> {
  const found = (await run<Conversation[]>('readonly', (s) => s.getAll() as IDBRequest<Conversation[]>)) ?? [...memory.values()];
  return found.sort((a, b) => b.updated - a.updated);
}

export async function getConversation(id: string): Promise<Conversation | null> {
  return (await run<Conversation>('readonly', (s) => s.get(id) as IDBRequest<Conversation>)) ?? memory.get(id) ?? null;
}

export async function putConversation(c: Conversation): Promise<void> {
  const data = plain(c);
  memory.set(c.id, data);
  await run('readwrite', (s) => s.put(data));
  // 太多了：删最旧的
  const all = await listConversations();
  for (const old of all.slice(KEEP)) await deleteConversation(old.id);
}

export async function deleteConversation(id: string): Promise<void> {
  memory.delete(id);
  await run('readwrite', (s) => s.delete(id));
}

/** 上次停在哪段对话 */
export function currentId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function setCurrentId(id: string | null) {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    // 记不住就下次从最新那段开始
  }
}
