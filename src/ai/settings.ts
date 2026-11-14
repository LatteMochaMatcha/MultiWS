/**
 * AI 助手的开关和设置：这台设备、这个浏览器自己记着（localStorage），不进配置文件、不进撤销、不进场景文件。
 * 钥匙按服务商分开存，只发给那一家（见 transport.ts）。这个文件不引用 pi，开工坊时就能读（决定那一栏出不出现）。
 */

const ON_KEY = 'oc-ai-on';
const SETTINGS_KEY = 'oc-ai-settings';
const KEY_PREFIX = 'oc-ai-key:';

/** 思考深度：照 pi 的分级，界面上只给四档 */
export const THINKING = ['off', 'low', 'medium', 'high'] as const;
export type Thinking = (typeof THINKING)[number];

export interface AiSettings {
  provider: string;
  /** 选的模型；空字符串是这家的默认 */
  model: string;
  /** 每家各自选过的模型：换服务商再换回来，还是原来选的那个 */
  modelFor: Record<string, string>;
  thinking: Thinking;
  /** 「自定义（兼容 OpenAI）」那一家的地址、型号、能不能看图 */
  customBaseUrl: string;
  customModel: string;
  customVision: boolean;
}

const DEFAULTS: AiSettings = { provider: 'deepseek', model: '', modelFor: {}, thinking: 'off', customBaseUrl: '', customModel: '', customVision: false };

/** 这一次打开以后拨过的：存不了的时候（无痕窗口）照它算 */
let onNow: boolean | undefined;

export function aiOn(): boolean {
  if (onNow !== undefined) return onNow;
  try {
    return localStorage.getItem(ON_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAiOn(on: boolean) {
  onNow = on;
  try {
    if (on) localStorage.setItem(ON_KEY, '1');
    else localStorage.removeItem(ON_KEY);
  } catch {
    // 存不了：这一次照样管用
  }
}

let settingsNow: AiSettings | undefined;

export function loadSettings(): AiSettings {
  if (settingsNow) return settingsNow;
  let saved: Partial<AiSettings> = {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    if (raw && typeof raw === 'object') saved = raw as Partial<AiSettings>;
  } catch {
    // 读不出来就用默认的
  }
  const s: AiSettings = { ...DEFAULTS };
  if (typeof saved.provider === 'string' && saved.provider) s.provider = saved.provider;
  if (typeof saved.model === 'string') s.model = saved.model;
  if (saved.modelFor && typeof saved.modelFor === 'object') {
    s.modelFor = Object.fromEntries(Object.entries(saved.modelFor).filter((e): e is [string, string] => typeof e[1] === 'string'));
  }
  // 以前只记了一个：算成当时那一家选的
  if (s.model && !s.modelFor[s.provider]) s.modelFor = { ...s.modelFor, [s.provider]: s.model };
  if (typeof saved.thinking === 'string' && (THINKING as readonly string[]).includes(saved.thinking)) s.thinking = saved.thinking;
  if (typeof saved.customBaseUrl === 'string') s.customBaseUrl = saved.customBaseUrl;
  if (typeof saved.customModel === 'string') s.customModel = saved.customModel;
  if (typeof saved.customVision === 'boolean') s.customVision = saved.customVision;
  settingsNow = s;
  return s;
}

export function saveSettings(change: Partial<AiSettings>): AiSettings {
  const was = loadSettings();
  settingsNow = { ...was, ...change };
  // 换了服务商：模型换成那一家上次选的；选了模型：记在这一家名下
  if (change.provider !== undefined && change.provider !== was.provider && change.model === undefined) settingsNow.model = was.modelFor[change.provider] ?? '';
  if (change.model !== undefined) settingsNow.modelFor = { ...settingsNow.modelFor, [settingsNow.provider]: change.model };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsNow));
  } catch {
    // 存不了：这一次照样管用
  }
  return settingsNow;
}

const keysNow = new Map<string, string>();

export function loadKey(provider: string): string {
  if (keysNow.has(provider)) return keysNow.get(provider)!;
  try {
    return localStorage.getItem(KEY_PREFIX + provider) ?? '';
  } catch {
    return '';
  }
}

export function saveKey(provider: string, key: string) {
  const clean = key.trim();
  keysNow.set(provider, clean);
  try {
    if (clean) localStorage.setItem(KEY_PREFIX + provider, clean);
    else localStorage.removeItem(KEY_PREFIX + provider);
  } catch {
    // 存不了：这一次照样管用
  }
}

/** 面板上只露钥匙的后四位 */
export function maskKey(key: string): string {
  return key.length > 4 ? `••••${key.slice(-4)}` : key ? '••••' : '';
}
