/**
 * AI 助手的设置：服务商（pi 的预设）、钥匙、模型（自动从服务商取列表，见 catalog.ts）、思考深度、测试连接。
 * 放在 AI 窗口里，点齿轮出来。
 */
import type { Api, Model } from '@earendil-works/pi-ai';
import { t } from '../i18n';
import { clearListing, factsOf } from './catalog';
import { CUSTOM_EXAMPLES, CUSTOM_ID, PROVIDERS, type ProviderGroup, providerOf } from './providers';
import { type Lineup, SetupError, humanError, lineup, pickModel, resolveFromSettings } from './session';
import { THINKING, type Thinking, loadKey, loadSettings, maskKey, saveKey, saveSettings } from './settings';
import { type Route, detectRoute } from './transport';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const GROUP_LABEL: Record<ProviderGroup, string> = { cn: t('国内'), intl: t('国外'), custom: t('其他') };
const THINKING_LABEL: Record<Thinking, string> = { off: t('不思考（最快）'), low: t('浅'), medium: t('中'), high: t('深（慢、贵）') };
/** 模型下拉框里「手填型号」那一项 */
const OWN_MODEL = '__own__';

export interface SettingsView {
  /** 重新照设置画一遍（fetch：要不要去服务商那里问模型列表） */
  fill(fetch?: 'never' | 'stale' | 'always'): Promise<void>;
  /** 这家还没填钥匙（窗口打开时直接停在设置上） */
  readonly needsKey: boolean;
}

/** 在 box 里画设置；changed：服务商、模型、钥匙、思考深度改了（会话要重新载入模型） */
export function mountSettings(box: HTMLElement, hooks: { changed: () => void }): SettingsView {
  let needsKey = false;
  const field = (label: string, control: HTMLElement, hint = '') => {
    const f = el('label', 'field');
    f.append(el('span', '', label), control);
    if (hint) f.title = hint;
    box.append(f);
    return f;
  };

  const selProvider = el('select');
  const providerOptions = new Map<string, HTMLOptionElement>();
  for (const group of ['cn', 'intl', 'custom'] as const) {
    const og = el('optgroup');
    og.label = GROUP_LABEL[group];
    for (const p of PROVIDERS.filter((x) => x.group === group)) {
      const o = el('option', '', p.name);
      o.value = p.id;
      og.append(o);
      providerOptions.set(p.id, o);
    }
    selProvider.append(og);
  }
  field(t('服务商'), selProvider, t('打了 ✓ 的是已经填过钥匙的'));

  const customUrl = el('input');
  customUrl.type = 'text';
  customUrl.placeholder = 'https://…/v1';
  customUrl.spellcheck = false;
  customUrl.autocomplete = 'off';
  const fUrl = field(t('服务地址'), customUrl, t('兼容 OpenAI 写法的地址，一般以 /v1 结尾'));
  const examples = el('div', 'chips ai-examples');
  for (const ex of CUSTOM_EXAMPLES) {
    const b = el('button', 'btn ghost', ex.name);
    b.type = 'button';
    b.addEventListener('click', () => {
      customUrl.value = ex.baseUrl;
      saveSettings({ customBaseUrl: ex.baseUrl, customModel: ex.model });
      changed('always');
    });
    examples.append(b);
  }
  fUrl.append(examples);

  const keyInput = el('input');
  keyInput.type = 'password';
  keyInput.autocomplete = 'off';
  keyInput.spellcheck = false;
  const fKey = field(t('钥匙（API Key）'), keyInput);
  const keyLink = el('a', 'ai-keylink', t('去这家申请钥匙'));
  keyLink.target = '_blank';
  keyLink.rel = 'noopener';
  fKey.append(keyLink);
  const keyClear = el('button', 'btn', t('清除这家的钥匙'));
  keyClear.type = 'button';
  keyClear.hidden = true;
  fKey.append(keyClear);

  // 模型：从服务商那里取的列表（取不到就是 pi 的预设）；列表长的时候上面多一个搜索框
  const modelFilter = el('input');
  modelFilter.type = 'text';
  modelFilter.placeholder = t('搜型号……');
  modelFilter.spellcheck = false;
  modelFilter.autocomplete = 'off';
  const selModel = el('select');
  const ownModel = el('input');
  ownModel.type = 'text';
  ownModel.placeholder = t('型号，例如 deepseek-v4-pro');
  ownModel.spellcheck = false;
  ownModel.autocomplete = 'off';
  const fModel = field(t('模型'), modelFilter);
  fModel.append(selModel, ownModel);
  const facts = el('p', 'note ai-facts');
  const listInfo = el('p', 'note ai-listinfo');
  const btnRefresh = el('button', 'btn ghost', t('刷新列表'));
  btnRefresh.type = 'button';
  btnRefresh.title = t('重新问这家服务商有哪些模型（换了钥匙、出了新模型时用）');
  const listRow = el('div', 'ai-listrow');
  listRow.append(listInfo, btnRefresh);
  fModel.append(facts, listRow);

  const visionRow = el('label', 'check');
  const vision = el('input');
  vision.type = 'checkbox';
  visionRow.append(vision, document.createTextNode(` ${t('这个模型能看图')}`));
  visionRow.title = t('服务商没说的时候才用得上：它的列表里写了能不能看图，就照它的');
  box.append(visionRow);

  const selThinking = el('select');
  for (const v of THINKING) {
    const o = el('option', '', THINKING_LABEL[v]);
    o.value = v;
    selThinking.append(o);
  }
  const fThinking = field(t('思考深度'), selThinking, t('想得越深越准，但更慢、更费钱；改个数量用「不思考」就够了'));

  const btnTest = el('button', 'btn', t('测试连接'));
  btnTest.type = 'button';
  const testOut = el('p', 'note ai-test');
  const testRow = el('div', 'actions');
  testRow.append(btnTest);
  box.append(testRow, testOut);
  const ROUTE_NOTE: Partial<Record<Route, string>> = {
    direct: t('网页版是浏览器直接连服务商，很多家会被浏览器的跨域限制挡住（Claude 不会）；用 exe 或安卓版没有这个问题。'),
    stale: t('这一版的 exe / 安卓版还没有 AI 助手要用的转发：除了 Claude，很多家会连不上。请到项目主页下载新的安装包装上（exe 也可以在「检查更新」里换新的安装包）。'),
  };
  const routeNote = el('p', 'note warn');
  routeNote.hidden = true;
  box.append(
    routeNote,
    el('p', 'note', t('钥匙只存在这台设备的这个浏览器里，只发给你选的服务商；不进配置文件、场景文件和导出的模型。用 AI 产生的费用由你自己的账户付。')),
  );

  /** 多久以前：刚刚、几分钟前、几小时前、几天前 */
  function ago(at: number): string {
    const minutes = Math.floor((Date.now() - at) / 60_000);
    if (minutes < 1) return t('刚刚');
    if (minutes < 60) return t('{n} 分钟前', { n: minutes });
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? t('{n} 小时前', { n: hours }) : t('{n} 天前', { n: Math.floor(hours / 24) });
  }

  /** 选中的模型的一行说明：上下文、最多输出、能不能看图、会不会思考、价格 */
  function describeFacts(m: Model<Api> | undefined): string {
    if (!m) return '';
    const f = factsOf(m);
    const parts = [t('上下文 {n}', { n: f.context }), t('最多输出 {n}', { n: f.output })];
    parts.push(f.image ? t('能看图') : t('不能看图'));
    if (f.reasoning) parts.push(t('会思考'));
    if (f.price) parts.push(t('每百万 token 输入 ${input}、输出 ${output}', { input: money(f.price.input), output: money(f.price.output) }));
    return parts.join(' · ');
  }
  /** 美元价：去掉末尾的 0（4、1.2、0.27） */
  const money = (v: number) => String(Number(v.toFixed(v >= 1 ? 2 : 3)));

  /** 上一次载入的模型表（搜索框过滤用） */
  let shown: Model<Api>[] = [];
  let chosenId = '';

  function renderOptions() {
    const q = modelFilter.value.trim().toLowerCase();
    const hit = q ? shown.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)) : shown;
    selModel.replaceChildren();
    for (const m of hit) {
      const label = m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id;
      const o = el('option', '', m.input.includes('image') ? t('{name}（能看图）', { name: label }) : label);
      o.value = m.id;
      selModel.append(o);
    }
    // 选着的那个被搜索框滤掉了也留着，不然一打字就换了模型
    if (chosenId && !hit.some((m) => m.id === chosenId) && shown.some((m) => m.id === chosenId)) {
      const o = el('option', '', chosenId);
      o.value = chosenId;
      selModel.prepend(o);
    }
    const own = el('option', '', t('其他型号（手填）…'));
    own.value = OWN_MODEL;
    selModel.append(own);
    selModel.value = shown.some((m) => m.id === chosenId) ? chosenId : OWN_MODEL;
  }

  /** 照设置把整个设置区刷新一遍。模型表要载入 pi 的预设、可能还要去问服务商，是异步的 */
  let listToken = 0;
  async function fill(fetch: 'never' | 'stale' | 'always' = 'stale', saidKey = false) {
    const s = loadSettings();
    const p = providerOf(s.provider);
    selProvider.value = p.id;
    for (const [id, o] of providerOptions) o.textContent = `${providerOf(id).name}${loadKey(id) ? ' ✓' : ''}`;
    const custom = p.id === CUSTOM_ID;
    fUrl.hidden = !custom;
    visionRow.hidden = !custom;
    customUrl.value = s.customBaseUrl;
    vision.checked = s.customVision;
    selThinking.value = s.thinking;
    const key = loadKey(p.id);
    keyInput.value = '';
    keyInput.placeholder = key ? t('已填：{key}（要换就重新填）', { key: maskKey(key) }) : custom ? t('不需要的就空着（例如本机 Ollama）') : t('粘贴这家的钥匙');
    keyLink.hidden = !p.keyPage;
    if (p.keyPage) keyLink.href = p.keyPage;
    keyClear.hidden = !key;
    // 一打开时还没填钥匙：设置展开着
    needsKey = !key && !custom;

    const token = ++listToken;
    selModel.replaceChildren(el('option', '', t('载入中……')));
    selModel.disabled = true;
    btnRefresh.disabled = true;
    listInfo.textContent = fetch !== 'never' ? t('正在问服务商有哪些模型……') : '';
    facts.textContent = '';
    let l: Lineup | null = null;
    let problem = '';
    try {
      l = await lineup(s, fetch);
    } catch (err) {
      problem = err instanceof SetupError ? err.message : humanError(err instanceof Error ? err.message : String(err), 'direct');
    }
    if (token !== listToken) return;
    selModel.disabled = false;
    btnRefresh.disabled = false;
    shown = l?.list ?? [];
    const model = l ? pickModel(s, l) : undefined;
    chosenId = model?.id ?? '';
    modelFilter.hidden = shown.length <= 20;
    renderOptions();
    const inList = shown.some((m) => m.id === chosenId);
    selModel.hidden = custom && !shown.length;
    ownModel.hidden = inList || (!custom && !chosenId);
    ownModel.value = inList ? '' : chosenId || (custom ? s.customModel : '');
    facts.textContent = describeFacts(model);
    // 模型不会思考：思考深度用不上
    const thinks = Boolean(model?.reasoning);
    selThinking.disabled = !thinks;
    fThinking.title = thinks ? t('想得越深越准，但更慢、更费钱；改个数量用「不思考」就够了') : t('这个模型不会思考，这一项用不上');

    if (problem) listInfo.textContent = problem;
    else if (l?.listError) listInfo.textContent = t('没能从服务商取到模型列表（{why}），先用内置的预设。', { why: humanError(l.listError, l.route) });
    else if (l?.listedAt && saidKey) listInfo.textContent = t('钥匙可用：从服务商取到 {n} 个模型。', { n: shown.length });
    else if (l?.listedAt) listInfo.textContent = t('模型列表取自服务商（{ago}），共 {n} 个。', { ago: ago(l.listedAt), n: shown.length });
    else if (!key && !custom) listInfo.textContent = t('填上钥匙后会自动从服务商取模型列表；现在列的是内置的预设。');
    else listInfo.textContent = '';
    const note = ROUTE_NOTE[l?.route ?? (await detectRoute())];
    routeNote.textContent = note ?? '';
    routeNote.hidden = !note || p.id === 'anthropic';
  }

  function changed(fetch: 'never' | 'stale' | 'always' = 'stale', saidKey = false) {
    hooks.changed();
    testOut.textContent = '';
    void fill(fetch, saidKey);
  }

  const saveModel = (id: string) => {
    if (providerOf(loadSettings().provider).id === CUSTOM_ID) saveSettings({ customModel: id });
    else saveSettings({ model: id });
  };

  selProvider.addEventListener('change', () => {
    saveSettings({ provider: selProvider.value });
    modelFilter.value = '';
    changed();
  });
  modelFilter.addEventListener('input', renderOptions);
  selModel.addEventListener('change', () => {
    if (selModel.value === OWN_MODEL) {
      ownModel.hidden = false;
      ownModel.focus();
      return;
    }
    saveModel(selModel.value);
    changed('never');
  });
  ownModel.addEventListener('change', () => {
    saveModel(ownModel.value.trim());
    changed('never');
  });
  btnRefresh.addEventListener('click', () => changed('always'));
  customUrl.addEventListener('change', () => {
    saveSettings({ customBaseUrl: customUrl.value.trim() });
    changed('always');
  });
  vision.addEventListener('change', () => {
    saveSettings({ customVision: vision.checked });
    changed('never');
  });
  // 填了钥匙：存起来，马上去问这家有哪些模型（顺便就知道钥匙对不对）
  keyInput.addEventListener('change', () => {
    if (!keyInput.value.trim()) return;
    const id = providerOf(loadSettings().provider).id;
    saveKey(id, keyInput.value);
    clearListing(id);
    changed('always', true);
  });
  keyClear.addEventListener('click', () => {
    const id = providerOf(loadSettings().provider).id;
    saveKey(id, '');
    clearListing(id);
    changed('never');
  });
  selThinking.addEventListener('change', () => {
    saveSettings({ thinking: selThinking.value as Thinking });
    changed('never');
  });

  btnTest.addEventListener('click', async () => {
    btnTest.disabled = true;
    testOut.textContent = t('连接中……');
    const started = performance.now();
    let route: Route = 'direct';
    try {
      const r = await resolveFromSettings(loadSettings());
      route = r.route;
      if (!r.apiKey && providerOf(loadSettings().provider).id !== CUSTOM_ID) throw new SetupError(t('还没填钥匙。'));
      const reply = await r.models.completeSimple(r.model, { messages: [{ role: 'user', content: 'Reply with the single word: ok', timestamp: Date.now() }] }, { apiKey: r.apiKey, maxTokens: 64 });
      if (reply.stopReason === 'error') throw new Error(reply.errorMessage ?? '');
      testOut.textContent = t('连上了：{model}，用时 {ms} 毫秒。', { model: r.model.id, ms: Math.round(performance.now() - started) });
    } catch (err) {
      testOut.textContent = err instanceof SetupError ? err.message : humanError(err instanceof Error ? err.message : String(err), route);
    } finally {
      btnTest.disabled = false;
    }
  });

  void fill();
  return {
    fill: (fetch = 'stale') => fill(fetch),
    get needsKey() {
      return needsKey;
    },
  };
}
