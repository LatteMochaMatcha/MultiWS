/**
 * 模型列表：照用户的钥匙去问这家服务商自己的「有哪些模型」接口（/models），
 * 把它给的元数据（上下文多长、最多输出多少、能不能看图、会不会思考、价格）合到 pi 的预设上。
 *
 * - pi 的预设是死的（跟着 pi 的版本走），新出的模型、这把钥匙能用哪些，要问服务商才知道；
 * - 各家 /models 回的字段不一样：OpenRouter 最全，Anthropic 有上下文和最大输出，Google 有输入、输出上限，
 *   DeepSeek 这类只有 id。读得到的就用，读不到的照 pi 预设，pi 也没有的用保守的默认值；
 * - 取到的存在 localStorage，一天内不重复问；设置里换钥匙、点「刷新列表」时重新问。
 * 请求和对话一样走转发（transport.ts），钥匙只发给这一家。
 */
import type { Api, Model } from '@earendil-works/pi-ai';
import { forwardUrl, type Route } from './transport';

/** 从服务商那里读到的一个模型（读不到的项是 undefined） */
export interface ListedModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  image?: boolean;
  reasoning?: boolean;
  /** 不能调用工具的（OpenRouter 会说） */
  noTools?: boolean;
  /** 每百万 token 多少美元 */
  cost?: { input: number; output: number };
}

const CACHE_PREFIX = 'oc-ai-models:';
/** 多久以后自动再问一次 */
export const STALE_MS = 24 * 60 * 60 * 1000;

/** 不是聊天模型的（向量、语音、画图、审核……）：列表里不放 */
const NOT_CHAT = /embed|whisper|tts|speech|audio|dall-e|gpt-image|imagen|image-gen|moderation|rerank|transcri|realtime|sora|veo|aqa|-search-preview|computer-use|lyria/i;

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const hasImage = (v: unknown) => list(v).some((x) => /image|vision/i.test(String(x)));

/** 一条 /models 的记录 → ListedModel（各家的写法都认一遍） */
export function readListed(raw: unknown): ListedModel | null {
  const e = obj(raw);
  let id = typeof e.id === 'string' ? e.id : typeof e.name === 'string' ? e.name : '';
  id = id.replace(/^models\//, '');
  if (!id) return null;
  // Google：只要能 generateContent 的
  const methods = list(e.supportedGenerationMethods);
  if (methods.length && !methods.includes('generateContent')) return null;
  if (NOT_CHAT.test(id)) return null;
  const arch = obj(e.architecture);
  const top = obj(e.top_provider);
  const caps = obj(e.capabilities);
  const capOn = (key: RegExp) =>
    Object.entries(caps).some(([k, v]) => key.test(k) && (v === true || obj(v).supported === true || obj(v).enabled === true));
  const params = list(e.supported_parameters).map(String);
  const modalities = obj(e.modalities);
  const image =
    hasImage(arch.input_modalities) || hasImage(e.input_modalities) || hasImage(modalities.input) || capOn(/image|vision/i) ||
    e.supports_image_in === true || e.supports_vision === true || e.vision === true || (typeof arch.modality === 'string' && /image.*->/.test(arch.modality))
      ? true
      : undefined;
  const reasoning = params.includes('reasoning') || e.thinking === true || capOn(/thinking|reasoning/i) || e.supports_reasoning === true ? true : undefined;
  const pricing = obj(e.pricing);
  const pin = num(pricing.prompt);
  const pout = num(pricing.completion);
  const name = [e.display_name, e.displayName, e.name].find((v) => typeof v === 'string' && v && v !== raw && !String(v).startsWith('models/')) as string | undefined;
  return {
    id,
    name,
    contextWindow: num(e.context_length) ?? num(e.max_input_tokens) ?? num(e.inputTokenLimit) ?? num(e.context_window) ?? num(top.context_length) ?? num(e.max_model_len) ?? num(e.max_context_length),
    maxTokens: num(e.max_tokens) ?? num(e.outputTokenLimit) ?? num(top.max_completion_tokens) ?? num(e.max_output_tokens) ?? num(e.max_completion_tokens),
    image,
    reasoning,
    noTools: params.length > 0 && !params.includes('tools') ? true : undefined,
    cost: pin !== undefined && pout !== undefined ? { input: pin * 1e6, output: pout * 1e6 } : undefined,
  };
}

/** 一整个 /models 的回答 → 列表（OpenAI 写法的 data、Google 的 models、有的直接是数组） */
export function readListing(body: unknown): ListedModel[] {
  const b = obj(body);
  const rows = Array.isArray(body) ? body : list(b.data).length ? list(b.data) : list(b.models);
  const out: ListedModel[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const m = readListed(row);
    if (m && !seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/** 问哪个地址、带什么头：照这家的接口写法（pi 的 model.api）来 */
export function listingRequest(sample: Model<Api>, providerId: string, apiKey: string): { url: string; headers: Record<string, string> } {
  const base = sample.baseUrl.replace(/\/+$/, '');
  if (providerId === 'openrouter') return { url: 'https://openrouter.ai/api/v1/models', headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} };
  if (sample.api === 'anthropic-messages') {
    return {
      url: `${base}/v1/models?limit=1000`,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    };
  }
  if (sample.api === 'google-generative-ai') return { url: `${base}/models?pageSize=1000`, headers: { 'x-goog-api-key': apiKey } };
  return { url: `${base}/models`, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} };
}

/** 去问这家服务商有哪些模型。失败就抛错（报错内容给 humanError 翻成人话） */
export async function fetchListing(sample: Model<Api>, providerId: string, apiKey: string, route: Route, signal?: AbortSignal): Promise<ListedModel[]> {
  const { url, headers } = listingRequest(sample, providerId, apiKey);
  const target = route === 'direct' ? url : forwardUrl(url);
  const r = await fetch(target, { headers: route === 'http' ? { ...headers, 'X-Shell': '1' } : headers, signal });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`not JSON: ${text.slice(0, 120)}`);
  }
  const found = readListing(body);
  if (!found.length) throw new Error('empty model list');
  return found;
}

/* ---------------- 存起来 ---------------- */

export interface CachedListing {
  at: number;
  /** 取的时候钥匙的后几位：换了钥匙就不算数（不存钥匙本身） */
  keyTail: string;
  models: ListedModel[];
}

const tail = (key: string) => key.slice(-6);

export function loadListing(providerId: string, key: string): CachedListing | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CACHE_PREFIX + providerId) ?? 'null');
    const c = obj(raw);
    if (typeof c.at !== 'number' || c.keyTail !== tail(key) || !Array.isArray(c.models)) return null;
    return { at: c.at, keyTail: c.keyTail, models: (c.models as unknown[]).map(readListedCached).filter((m): m is ListedModel => m !== null) };
  } catch {
    return null;
  }
}

/** 存的是我们自己写的格式，读回来时只认得 id 就够了 */
function readListedCached(raw: unknown): ListedModel | null {
  const e = obj(raw);
  return typeof e.id === 'string' && e.id ? (e as unknown as ListedModel) : null;
}

export function saveListing(providerId: string, key: string, models: ListedModel[]) {
  try {
    localStorage.setItem(CACHE_PREFIX + providerId, JSON.stringify({ at: Date.now(), keyTail: tail(key), models } satisfies CachedListing));
  } catch {
    // 存不了就每次都问
  }
}

export function clearListing(providerId: string) {
  try {
    localStorage.removeItem(CACHE_PREFIX + providerId);
  } catch {
    // 无所谓
  }
}

/* ---------------- 合到 pi 的预设上 ---------------- */

/** 服务商没说、pi 也没有的新模型：照这几个保守的数 */
const FALLBACK = { contextWindow: 128_000, maxTokens: 8_192 };

/**
 * 合成这家的模型表：取到了列表就以它为准（这把钥匙能用的），每个模型的元数据先看服务商说的、再看 pi 预设；
 * 没取到就是 pi 预设原样。template 是这家在 pi 里的随便一个模型（接口写法、地址、兼容设置照它）
 */
export function mergeModels(catalog: readonly Model<Api>[], listed: readonly ListedModel[] | null, template: Model<Api>): Model<Api>[] {
  if (!listed?.length) return [...catalog];
  const byId = new Map(catalog.map((m) => [m.id, m]));
  return listed
    .filter((l) => !l.noTools)
    .map((l) => {
      const known = byId.get(l.id);
      const base: Model<Api> = known ?? {
        ...template,
        id: l.id,
        name: l.name ?? l.id,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: FALLBACK.contextWindow,
        maxTokens: FALLBACK.maxTokens,
        thinkingLevelMap: undefined,
      };
      const input: ('text' | 'image')[] = l.image === true ? ['text', 'image'] : base.input;
      return {
        ...base,
        name: known?.name ?? l.name ?? l.id,
        contextWindow: l.contextWindow ?? base.contextWindow,
        maxTokens: Math.min(l.maxTokens ?? base.maxTokens, l.contextWindow ?? base.contextWindow ?? Infinity),
        input,
        reasoning: l.reasoning ?? base.reasoning,
        cost: l.cost && !known ? { ...base.cost, input: l.cost.input, output: l.cost.output } : base.cost,
      };
    });
}

/* ---------------- 给人看的一行说明 ---------------- */

const kTokens = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}K`);

export interface ModelFacts {
  context: string;
  output: string;
  image: boolean;
  reasoning: boolean;
  /** 输入、输出每百万 token 的美元价；不知道是 null */
  price: { input: number; output: number } | null;
}

export function factsOf(m: Model<Api>): ModelFacts {
  return {
    context: kTokens(m.contextWindow),
    output: kTokens(m.maxTokens),
    image: m.input.includes('image'),
    reasoning: m.reasoning,
    price: m.cost.input || m.cost.output ? { input: m.cost.input, output: m.cost.output } : null,
  };
}
