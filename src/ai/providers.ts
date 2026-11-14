/**
 * 设置里列的服务商：用 pi 预设里的那几家（各家的模型表、能不能看图、价格都来自 pi），加一项「自定义（兼容 OpenAI）」。
 * 要 OAuth 登录、要云账号的（Copilot、Codex、Bedrock、Vertex、Azure、Cloudflare）在浏览器里用不了，不列。
 * 每家的工厂函数各自按需载入：选了哪家才下载哪家的模型表，接口代码等第一次发请求时才下载。
 */
import type { Api, Model, Provider } from '@earendil-works/pi-ai';
import { t } from '../i18n';
import type { AiSettings } from './settings';

export type ProviderGroup = 'cn' | 'intl' | 'custom';

export interface ProviderChoice {
  id: string;
  name: string;
  group: ProviderGroup;
  /** 这家默认用哪个模型（pi 预设里没有它时用列表第一个） */
  model?: string;
  /** 去哪里申请钥匙（设置里给个链接） */
  keyPage?: string;
  load?: () => Promise<Provider>;
}

export const CUSTOM_ID = 'custom';

export const PROVIDERS: readonly ProviderChoice[] = [
  { id: 'deepseek', name: 'DeepSeek', group: 'cn', model: 'deepseek-v4-pro', keyPage: 'https://platform.deepseek.com/api_keys', load: () => import('@earendil-works/pi-ai/providers/deepseek').then((m) => m.deepseekProvider()) },
  { id: 'moonshotai-cn', name: t('Kimi（月之暗面）'), group: 'cn', model: 'kimi-k3.1-pro', keyPage: 'https://platform.moonshot.cn/console/api-keys', load: () => import('@earendil-works/pi-ai/providers/moonshotai-cn').then((m) => m.moonshotaiCnProvider()) },
  { id: 'qwen-token-plan-cn', name: t('通义千问（Token 套餐）'), group: 'cn', model: 'qwen3.8-max', keyPage: 'https://bailian.console.aliyun.com/', load: () => import('@earendil-works/pi-ai/providers/qwen-token-plan-cn').then((m) => m.qwenTokenPlanCnProvider()) },
  { id: 'zai-coding-cn', name: t('智谱 GLM（编程套餐）'), group: 'cn', model: 'glm-5.3', keyPage: 'https://open.bigmodel.cn/usercenter/apikeys', load: () => import('@earendil-works/pi-ai/providers/zai-coding-cn').then((m) => m.zaiCodingCnProvider()) },
  { id: 'minimax-cn', name: 'MiniMax', group: 'cn', model: 'MiniMax-M3', keyPage: 'https://platform.minimaxi.com/', load: () => import('@earendil-works/pi-ai/providers/minimax-cn').then((m) => m.minimaxCnProvider()) },
  { id: 'xiaomi', name: t('小米 MiMo'), group: 'cn', model: 'mimo-v2.6-pro', load: () => import('@earendil-works/pi-ai/providers/xiaomi').then((m) => m.xiaomiProvider()) },
  { id: 'ant-ling', name: t('蚂蚁百灵 Ling'), group: 'cn', model: 'Ling-2.6-1T', load: () => import('@earendil-works/pi-ai/providers/ant-ling').then((m) => m.antLingProvider()) },
  { id: 'anthropic', name: 'Anthropic Claude', group: 'intl', model: 'claude-opus-5-5', keyPage: 'https://platform.claude.com/settings/keys', load: () => import('@earendil-works/pi-ai/providers/anthropic').then((m) => m.anthropicProvider()) },
  { id: 'openai', name: 'OpenAI', group: 'intl', model: 'gpt-5.5', keyPage: 'https://platform.openai.com/api-keys', load: () => import('@earendil-works/pi-ai/providers/openai').then((m) => m.openaiProvider()) },
  { id: 'google', name: 'Google Gemini', group: 'intl', model: 'gemini-pro-latest', keyPage: 'https://aistudio.google.com/apikey', load: () => import('@earendil-works/pi-ai/providers/google').then((m) => m.googleProvider()) },
  { id: 'openrouter', name: 'OpenRouter', group: 'intl', model: 'anthropic/claude-opus-5.5', keyPage: 'https://openrouter.ai/keys', load: () => import('@earendil-works/pi-ai/providers/openrouter').then((m) => m.openrouterProvider()) },
  { id: 'xai', name: 'xAI Grok', group: 'intl', model: 'grok-4.7', keyPage: 'https://console.x.ai/', load: () => import('@earendil-works/pi-ai/providers/xai').then((m) => m.xaiProvider()) },
  { id: CUSTOM_ID, name: t('自定义（兼容 OpenAI）'), group: 'custom' },
];

export const providerOf = (id: string) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

/** 「自定义」那一项常用的几个地址：设置里点一下填进去 */
export const CUSTOM_EXAMPLES: readonly { name: string; baseUrl: string; model: string }[] = [
  { name: t('阿里云百炼（按量付费）'), baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-max' },
  { name: t('火山方舟（豆包）'), baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
  { name: t('硅基流动'), baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  { name: t('本机 Ollama'), baseUrl: 'http://localhost:11434/v1', model: 'qwen3' },
];

/** 自定义那一家的模型：pi 认的格式，地址、型号照设置里填的 */
export function customModel(s: AiSettings): Model<'openai-completions'> {
  const id = s.customModel.trim() || 'model';
  const baseUrl = s.customBaseUrl.trim().replace(/\/+$/, '');
  return {
    id,
    name: id,
    api: 'openai-completions',
    provider: CUSTOM_ID,
    baseUrl,
    reasoning: false,
    input: s.customVision ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
    // 千问在百炼上：思考开关是 enable_thinking；别的不认 developer 角色的，按系统消息发
    compat: {
      supportsDeveloperRole: false,
      supportsStore: false,
      ...(baseUrl.includes('dashscope') ? { thinkingFormat: 'qwen' as const } : {}),
    },
  };
}

export async function customProvider(s: AiSettings): Promise<Provider> {
  const [{ createProvider }, { openAICompletionsApi }] = await Promise.all([
    import('@earendil-works/pi-ai'),
    import('@earendil-works/pi-ai/api/openai-completions.lazy'),
  ]);
  const model = customModel(s);
  return createProvider({
    id: CUSTOM_ID,
    name: t('自定义'),
    baseUrl: model.baseUrl,
    // 钥匙由 Agent 的 getApiKey 每次给；本机 Ollama 这类不要钥匙的也算配好了
    auth: { apiKey: { name: 'Custom', resolve: async () => ({ auth: {} }) } },
    models: [model as Model<Api>],
    api: openAICompletionsApi(),
  });
}
