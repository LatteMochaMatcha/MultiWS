import type { Api, Model } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { listingRequest, mergeModels, readListing } from '../src/ai/catalog';
import { trimContext } from '../src/ai/session';

const template: Model<Api> = {
  id: 'deepseek-v4-pro',
  name: 'DeepSeek V4 Pro',
  api: 'openai-completions',
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  reasoning: true,
  input: ['text'],
  cost: { input: 0.5, output: 2, cacheRead: 0.05, cacheWrite: 0 },
  contextWindow: 1_000_000,
  maxTokens: 64_000,
};

describe('各家 /models 的回答', () => {
  it('OpenRouter：上下文、最多输出、看图、思考、价格、不能用工具', () => {
    const list = readListing({
      data: [
        {
          id: 'anthropic/claude-opus-5.5',
          name: 'Anthropic: Claude Opus 5.5',
          context_length: 1_000_000,
          architecture: { input_modalities: ['text', 'image', 'file'] },
          pricing: { prompt: '0.000004', completion: '0.00002' },
          top_provider: { max_completion_tokens: 128_000 },
          supported_parameters: ['tools', 'reasoning', 'max_tokens'],
        },
        { id: 'some/no-tools', context_length: 8000, supported_parameters: ['max_tokens'] },
        { id: 'openai/text-embedding-3-large' },
      ],
    });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: 'anthropic/claude-opus-5.5', contextWindow: 1_000_000, maxTokens: 128_000, image: true, reasoning: true });
    expect(list[0].cost?.input).toBeCloseTo(4);
    expect(list[0].cost?.output).toBeCloseTo(20);
    expect(list[1].noTools).toBe(true);
  });

  it('Anthropic：max_input_tokens、max_tokens、capabilities', () => {
    const [m] = readListing({ data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', max_input_tokens: 1_000_000, max_tokens: 128_000, capabilities: { image_input: { supported: true }, thinking: { supported: true } } }] });
    expect(m).toMatchObject({ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', contextWindow: 1_000_000, maxTokens: 128_000, image: true, reasoning: true });
  });

  it('Google：models/ 前缀去掉，只要能 generateContent 的', () => {
    const list = readListing({
      models: [
        { name: 'models/gemini-pro-latest', displayName: 'Gemini Pro', inputTokenLimit: 1_048_576, outputTokenLimit: 65_536, supportedGenerationMethods: ['generateContent'], thinking: true },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ],
    });
    expect(list).toEqual([expect.objectContaining({ id: 'gemini-pro-latest', name: 'Gemini Pro', contextWindow: 1_048_576, maxTokens: 65_536, reasoning: true })]);
  });

  it('DeepSeek 这类只有 id 的', () => {
    expect(readListing({ object: 'list', data: [{ id: 'deepseek-flash', object: 'model', owned_by: 'deepseek' }] })).toEqual([{ id: 'deepseek-flash', name: undefined, contextWindow: undefined, maxTokens: undefined, image: undefined, reasoning: undefined, noTools: undefined, cost: undefined }]);
  });

  it('各家问哪个地址', () => {
    expect(listingRequest(template, 'deepseek', 'k').url).toBe('https://api.deepseek.com/models');
    expect(listingRequest({ ...template, api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com' }, 'anthropic', 'k')).toMatchObject({ url: 'https://api.anthropic.com/v1/models?limit=1000', headers: { 'x-api-key': 'k' } });
    expect(listingRequest({ ...template, api: 'anthropic-messages', baseUrl: 'https://openrouter.ai/api' }, 'openrouter', '').url).toBe('https://openrouter.ai/api/v1/models');
  });
});

describe('合到 pi 的预设上', () => {
  it('以服务商的列表为准；预设里有的保留预设的价格，服务商说的上下文、看图盖上去', () => {
    const merged = mergeModels([template], [{ id: 'deepseek-v4-pro', contextWindow: 256_000, image: true }, { id: 'deepseek-v5-preview' }], template);
    expect(merged.map((m) => m.id)).toEqual(['deepseek-v4-pro', 'deepseek-v5-preview']);
    expect(merged[0]).toMatchObject({ contextWindow: 256_000, maxTokens: 64_000, input: ['text', 'image'], cost: template.cost });
    // 预设里没有的新模型：照这家的写法拼，数用保守的
    expect(merged[1]).toMatchObject({ api: 'openai-completions', baseUrl: 'https://api.deepseek.com', contextWindow: 128_000, maxTokens: 8_192, reasoning: false, input: ['text'] });
  });

  it('没取到列表就是预设原样', () => {
    expect(mergeModels([template], null, template)).toEqual([template]);
  });

  it('最多输出不超过上下文', () => {
    const [m] = mergeModels([], [{ id: 'small', contextWindow: 4096, maxTokens: 8192 }], template);
    expect(m.maxTokens).toBe(4096);
  });
});

describe('对话太长时省掉最早的几轮', () => {
  const turn = (n: number, size: number) => [
    { role: 'user', content: `第 ${n} 句 ${'字'.repeat(size)}` },
    { role: 'assistant', content: [{ type: 'toolCall', id: `c${n}` }] },
    { role: 'toolResult', toolCallId: `c${n}`, content: 'ok' },
    { role: 'assistant', content: 'done' },
  ];

  it('不长就原样', () => {
    const messages = [{ role: 'system', content: 'sys' }, ...turn(1, 10), ...turn(2, 10)];
    expect(trimContext(messages, 128_000)).toEqual({ messages, trimmed: false });
  });

  it('整轮省掉，系统消息和最后一轮留着，工具调用和结果不拆开', () => {
    const messages = [{ role: 'system', content: 'sys' }, ...turn(1, 3000), ...turn(2, 3000), ...turn(3, 100)];
    const r = trimContext(messages, 4000);
    expect(r.trimmed).toBe(true);
    expect(r.messages[0].role).toBe('system');
    expect(r.messages[1].role).toBe('user');
    expect(JSON.stringify(r.messages)).toContain('第 3 句');
    expect(JSON.stringify(r.messages)).not.toContain('第 1 句');
    // 每个工具结果前面都还有它的调用
    for (const [i, m] of r.messages.entries()) if (m.role === 'toolResult') expect(r.messages[i - 1].role).toBe('assistant');
  });

  it('只剩一轮也太长：不再省（交给服务商报错）', () => {
    const messages = [{ role: 'system', content: 'sys' }, ...turn(1, 50_000)];
    expect(trimContext(messages, 1000).messages).toHaveLength(messages.length);
  });
});

describe('每家记住自己选的模型', () => {
  it('换服务商再换回来，还是原来选的', async () => {
    const { loadSettings, saveSettings } = await import('../src/ai/settings');
    saveSettings({ provider: 'deepseek' });
    saveSettings({ model: 'deepseek-flash' });
    saveSettings({ provider: 'openrouter' });
    expect(loadSettings().model).toBe('');
    saveSettings({ model: 'moonshotai/kimi-k3' });
    saveSettings({ provider: 'deepseek' });
    expect(loadSettings().model).toBe('deepseek-flash');
    saveSettings({ provider: 'openrouter' });
    expect(loadSettings().model).toBe('moonshotai/kimi-k3');
  });
});
