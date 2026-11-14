import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import type { Api, Model } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { applyPatch, diffSpec } from '../src/ai/body';
import { AiSession, MAX_TURNS, humanError } from '../src/ai/session';
import type { AiEvent } from '../src/ai/session';
import type { Conversation } from '../src/ai/store';
import { MARK_PREFIX, type Mark, describeMarks, regionOf } from '../src/ai/marks';
import { forwardUrl, targetOf } from '../src/ai/transport';
import { titleOf, turnsOf } from '../src/ai/turns';
import type { WorkshopApi } from '../src/ai/workshop';
import { withoutAdult } from '../src/model/adult';
import { History } from '../src/model/history';
import { type BodySpec, defaultSpec, normalizeSpec } from '../src/model/spec';

/** 假工坊：真的整理设定、真的撤销记录，只是没有界面 */
function fakeWorkshop(adult = false) {
  let spec = defaultSpec();
  const history = new History<BodySpec>(spec, { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  const api: WorkshopApi = {
    spec: () => spec,
    apply(next, key) {
      spec = adult ? normalizeSpec(next) : withoutAdult(normalizeSpec(next));
      history.push(spec, key);
      return spec;
    },
    adultOn: () => adult,
    hold: (key) => history.hold(key),
    release: () => history.release(),
    mark: () => history.current,
    undo: () => {
      const s = history.undo();
      if (s) spec = s;
    },
    stage: () => null,
    pickAt: () => null,
    snapshot: () => Promise.reject(new Error('no view')),
    viewSide: () => 'front',
    parts: () => ['Head_01', 'Arm_01_L', 'Arm_01_R', 'Leg_01_L', 'Leg_01_R'],
  };
  return { api, history, get spec() { return spec; } };
}

function fakeSession(adult = false, saved: Conversation[] = [], vision = true) {
  const shop = fakeWorkshop(adult);
  const faux = fauxProvider({ models: [{ id: 'faux', input: vision ? ['text', 'image'] : ['text'] }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const session = new AiSession({
    api: shop.api,
    lang: 'zh',
    resolve: async () => ({ models, model: faux.getModel() as Model<Api>, apiKey: 'test', route: 'direct' }),
    save: (c) => {
      saved.push(JSON.parse(JSON.stringify(c)) as Conversation);
    },
  });
  const events: AiEvent[] = [];
  session.on((e) => events.push(e));
  return { shop, faux, session, events };
}

describe('applyPatch', () => {
  it('只改给了的那几项，越界的收回范围并说明', () => {
    const { spec, adjusted } = applyPatch(defaultSpec(), { counts: { legs: 4, tails: 99 }, legLayout: 'taur' }, false);
    expect(spec.counts.legs).toBe(4);
    expect(spec.counts.tails).toBe(9);
    expect(spec.legLayout).toBe('taur');
    expect(spec.counts.heads).toBe(1);
    expect(adjusted).toEqual([expect.objectContaining({ field: 'counts.tails', asked: 99, got: 9, why: 'clamped' })]);
  });

  it('不认识的值、成人部件（开关关着）都不照办', () => {
    const { spec, adjusted } = applyPatch(defaultSpec(), { legLayout: 'octopus', counts: { penises: 2 }, penisLayout: 'fan' }, false);
    expect(spec.legLayout).toBe('auto');
    expect(spec.counts.penises).toBe(0);
    expect(adjusted.map((a) => [a.field, a.why])).toEqual(
      expect.arrayContaining([['counts.penises', 'adult'], ['penisLayout', 'adult'], ['legLayout', 'unknown']]),
    );
  });

  it('只有一个上半身时，单独设某个上半身的数量不起作用并说明', () => {
    const { adjusted } = applyPatch(defaultSpec(), { torsoCounts: { L: { heads: 2 } } }, false);
    expect(adjusted).toEqual([expect.objectContaining({ field: 'torsoCounts.L.heads', why: 'ignored' })]);
  });

  it('fromDefault 先回到默认设定', () => {
    const start = applyPatch(defaultSpec(), { counts: { tails: 3 }, shape: { height: 1.8 } }, false).spec;
    const { spec } = applyPatch(start, { fromDefault: true, counts: { armPairs: 2 } }, false);
    expect(spec.counts.tails).toBe(0);
    expect(spec.shape.height).toBe(defaultSpec().shape.height);
    expect(spec.counts.armPairs).toBe(2);
  });

  it('diffSpec 列出改了的项', () => {
    const a = defaultSpec();
    const b = applyPatch(a, { counts: { legs: 4 }, shape: { height: 1.8 } }, false).spec;
    const fields = diffSpec(a, b).map((c) => c.field);
    expect(fields).toEqual(expect.arrayContaining(['counts.legs', 'shape.height']));
  });
});

describe('AiSession（假服务商）', () => {
  it('跑工具改设定，一轮的改动撤销一次全回去', async () => {
    const { shop, faux, session, events } = fakeSession();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('set_body', { counts: { legs: 4 } })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('set_body', { counts: { tails: 3 }, legLayout: 'taur' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('改成了四条腿的人马，加了三条尾巴。')]),
    ]);
    await session.send('四条腿人马，三条尾巴');
    expect(shop.spec.counts.legs).toBe(4);
    expect(shop.spec.counts.tails).toBe(3);
    expect(shop.spec.legLayout).toBe('taur');
    expect(events.some((e) => e.type === 'failed')).toBe(false);
    const [turn] = turnsOf(session.messages, session.starts);
    expect(turn.error).toBeUndefined();
    expect(turn.changes.map((c) => c.field)).toEqual(expect.arrayContaining(['counts.legs', 'counts.tails', 'legLayout']));
    expect(turn.steps.some((st) => st.kind === 'text' && st.text.includes('人马'))).toBe(true);
    // 两次工具调用并成一步撤销
    expect(session.canUndoTurn()).toBe(true);
    session.undoTurn();
    expect(shop.spec.counts.legs).toBe(2);
    expect(shop.spec.counts.tails).toBe(0);
    expect(shop.history.canUndo).toBe(false);
  });

  it('人在这一轮之后又改过，就不能整轮撤回了', async () => {
    const { shop, faux, session } = fakeSession();
    faux.setResponses([fauxAssistantMessage([fauxToolCall('set_body', { counts: { tails: 2 } })], { stopReason: 'toolUse' }), fauxAssistantMessage([fauxText('好')])]);
    await session.send('两条尾巴');
    shop.api.apply({ ...shop.spec, counts: { ...shop.spec.counts, heads: 2 } }, 'user');
    expect(session.canUndoTurn()).toBe(false);
  });

  it('parse_description 的 merge 只改提到的部件', async () => {
    const { shop, faux, session } = fakeSession();
    shop.api.apply({ ...shop.spec, counts: { ...shop.spec.counts, tails: 5 } }, 'user');
    faux.setResponses([fauxAssistantMessage([fauxToolCall('parse_description', { text: '一对翅膀', mode: 'merge' })], { stopReason: 'toolUse' }), fauxAssistantMessage([fauxText('加了翅膀')])]);
    await session.send('再加一对翅膀');
    expect(shop.spec.counts.wingPairs).toBe(1);
    expect(shop.spec.counts.tails).toBe(5);
  });

  it('一轮最多调用 MAX_TURNS 次模型', async () => {
    const { faux, session } = fakeSession();
    faux.setResponses(Array.from({ length: MAX_TURNS + 5 }, (_, i) => fauxAssistantMessage([fauxToolCall('set_body', { shape: { height: 1.5 + (i % 2) * 0.1 } })], { stopReason: 'toolUse' })));
    await session.send('一直改');
    const [turn] = turnsOf(session.messages, session.starts);
    expect(session.conversation.notes[turn.key]?.stopped).toBe('limit');
    expect(faux.state.callCount).toBe(MAX_TURNS);
  });

  it('成人部件开关关着时，工具参数里没有那几项', async () => {
    const seen = async (adult: boolean) => {
      const { faux, session } = fakeSession(adult);
      let context = '';
      faux.setResponses([
        (ctx) => {
          context = JSON.stringify(ctx);
          return fauxAssistantMessage([fauxText('好')]);
        },
      ]);
      await session.send('你好');
      return context;
    };
    expect(await seen(false)).not.toContain('penis');
    expect(await seen(true)).toContain('penisLayout');
  });
});

describe('对话：存、接着聊、重新生成、插话', () => {
  it('一轮干完存一次：标题、开轮的时间、花费都记下', async () => {
    const saved: Conversation[] = [];
    const { faux, session } = fakeSession(false, saved);
    faux.setResponses([fauxAssistantMessage([fauxToolCall('set_body', { counts: { tails: 2 } })], { stopReason: 'toolUse' }), fauxAssistantMessage([fauxText('好了')])]);
    await session.send('给她加两条尾巴吧，蓬松一点的那种狐狸尾巴，颜色随意');
    expect(saved).toHaveLength(1);
    const c = saved[0];
    expect(c.title).toBe(titleOf(c.messages));
    expect(c.title.endsWith('…')).toBe(true);
    expect(c.starts).toHaveLength(1);
    expect(c.spent.input + c.spent.output).toBeGreaterThan(0);
    expect(c.messages.some((m) => m.role === 'toolResult')).toBe(true);
  });

  it('存下的对话打开以后接着聊：以前的消息原样交回给模型', async () => {
    const saved: Conversation[] = [];
    const first = fakeSession(false, saved);
    first.faux.setResponses([fauxAssistantMessage([fauxText('记住了，你喜欢狐狸。')])]);
    await first.session.send('我喜欢狐狸');
    const second = fakeSession(false, saved);
    second.session.open(saved[0]);
    let context = '';
    second.faux.setResponses([
      (ctx) => {
        context = JSON.stringify(ctx);
        return fauxAssistantMessage([fauxText('好')]);
      },
    ]);
    await second.session.send('那就加九条尾巴');
    expect(context).toContain('我喜欢狐狸');
    expect(context).toContain('记住了，你喜欢狐狸。');
    expect(turnsOf(second.session.messages, second.session.starts)).toHaveLength(2);
  });

  it('重新生成：先撤回最后一轮的改动，截掉它，再发一次同一句', async () => {
    const { shop, faux, session } = fakeSession();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('set_body', { counts: { tails: 2 } })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('两条')]),
      fauxAssistantMessage([fauxToolCall('set_body', { counts: { tails: 3 } })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('三条')]),
    ]);
    await session.send('加尾巴');
    expect(shop.spec.counts.tails).toBe(2);
    await session.regenerate();
    expect(shop.spec.counts.tails).toBe(3);
    const turns = turnsOf(session.messages, session.starts);
    expect(turns).toHaveLength(1);
    expect(turns[0].user).toBe('加尾巴');
    expect(turns[0].changes).toEqual([expect.objectContaining({ field: 'counts.tails', from: 0, to: 3 })]);
    // 撤销只回到最开始（第一次那一轮已经撤回了）
    session.undoTurn();
    expect(shop.spec.counts.tails).toBe(0);
  });

  it('成人部件开关变了：另起一段对话', async () => {
    const saved: Conversation[] = [];
    const { shop, faux, session, events } = fakeSession(false, saved);
    faux.setResponses([fauxAssistantMessage([fauxText('好')]), fauxAssistantMessage([fauxText('好')])]);
    await session.send('你好');
    const firstId = session.conversation.id;
    (shop.api as { adultOn: () => boolean }).adultOn = () => true;
    await session.send('再来');
    expect(session.conversation.id).not.toBe(firstId);
    expect(events.some((e) => e.type === 'conversation' && e.forked)).toBe(true);
    expect(session.conversation.adult).toBe(true);
  });

  it('同一项改了好几次，这一轮只显示头尾；改回原样的不显示', () => {
    const change = (from: number, to: number) => ({ field: 'counts.tails', from, to, label: '尾巴', fromText: String(from), toText: String(to), text: `尾巴 ${from}→${to}` });
    const call = (id: string) => ({ role: 'assistant', content: [{ type: 'toolCall', id, name: 'set_body', arguments: {} }], stopReason: 'toolUse' });
    const result = (id: string, from: number, to: number) => ({ role: 'toolResult', toolCallId: id, content: [], details: { changes: [change(from, to)] }, isError: false });
    const user = { role: 'user', content: 'x', timestamp: 1 };
    const end = { role: 'assistant', content: [{ type: 'text', text: '好' }], stopReason: 'stop' };
    expect(turnsOf([user, call('a'), result('a', 0, 2), call('b'), result('b', 2, 5), end])[0].changes).toEqual([expect.objectContaining({ from: 0, to: 5, text: '尾巴 0→5' })]);
    expect(turnsOf([user, call('a'), result('a', 0, 2), call('b'), result('b', 2, 0), end])[0].changes).toEqual([]);
  });

  it('模型干活时又说一句：插进去，下一步模型就看得到，还是同一轮', async () => {
    const shop = fakeWorkshop();
    // 慢慢吐字，好在中间插话
    const faux = fauxProvider({ tokensPerSecond: 40 });
    const models = createModels();
    models.setProvider(faux.provider);
    const session = new AiSession({ api: shop.api, lang: 'zh', resolve: async () => ({ models, model: faux.getModel() as Model<Api>, apiKey: 'test', route: 'direct' }) });
    let second = '';
    faux.setResponses([
      fauxAssistantMessage([fauxText('先改腿，'), fauxToolCall('set_body', { counts: { legs: 4 } })], { stopReason: 'toolUse' }),
      (ctx) => {
        second = JSON.stringify(ctx);
        return fauxAssistantMessage([fauxText('好，尾巴也加上了说一下')]);
      },
    ]);
    const running = session.send('四条腿');
    await new Promise((r) => setTimeout(r, 60));
    expect(session.busy).toBe(true);
    await session.say('尾巴也要两条');
    await running;
    expect(second).toContain('尾巴也要两条');
    const turns = turnsOf(session.messages, session.starts);
    expect(turns).toHaveLength(1);
    expect(turns[0].steers).toEqual(['尾巴也要两条']);
  });

  it('干活时插的话算在这一轮里，不另起一轮', () => {
    const messages = [
      { role: 'user', content: '四条腿', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'a', name: 'set_body', arguments: {} }], stopReason: 'toolUse' },
      { role: 'toolResult', toolCallId: 'a', content: [], isError: false },
      { role: 'user', content: '尾巴也要', timestamp: 2 },
      { role: 'assistant', content: [{ type: 'text', text: '好' }], stopReason: 'stop' },
      { role: 'user', content: '下一句', timestamp: 3 },
    ];
    expect(turnsOf(messages).map((tn) => [tn.user, tn.steers])).toEqual([['四条腿', ['尾巴也要']], ['下一句', []]]);
    // 给了「哪几句是开轮的」就照它分
    expect(turnsOf(messages, new Set([1, 2, 3])).map((tn) => tn.user)).toEqual(['四条腿', '尾巴也要', '下一句']);
  });
});

describe('圈出来', () => {
  /** 一个圆圈，圆心 (cx, cy)，半径 r（画布比例） */
  const ring = (cx: number, cy: number, r: number) => Array.from({ length: 40 }, (_, i) => [cx + r * Math.cos((i / 40) * Math.PI * 2), cy + r * Math.sin((i / 40) * Math.PI * 2)] as [number, number]);

  it('圈住的地方是哪些部件：圈里面也取点，按点中的多少排', () => {
    // 左半边是手臂，右半边是躯干
    const pick = (x: number) => (x < 0.5 ? 'Arm_02_L' : 'Torso');
    const region = regionOf(ring(0.4, 0.5, 0.15), pick);
    expect(region.parts[0].name).toBe('Arm_02_L');
    expect(region.parts.map((p) => p.name)).toContain('Torso');
    expect(region.parts[0].share).toBeGreaterThan(region.parts[1].share);
    expect(region.parts.reduce((sum, p) => sum + p.share, 0)).toBeCloseTo(1, 1);
  });

  it('圈在空白处：没有部件', () => {
    expect(regionOf(ring(0.5, 0.5, 0.1), () => null).parts).toEqual([]);
  });

  const mark: Mark = { view: 'front', image: 'AAAA', regions: [{ parts: [{ name: 'Arm_02_L', label: '手臂 2 · 左', share: 0.8 }, { name: 'Torso', label: '躯干', share: 0.2 }] }, { parts: [] }] };

  it('发给模型的说明：部件名、左右、看的方向、有没有图', () => {
    const withPic = describeMarks([mark], true);
    expect(withPic.startsWith(MARK_PREFIX)).toBe(true);
    expect(withPic).toContain('Arm_02_L (手臂 2 · 左, 80%)');
    expect(withPic).toContain('no part (empty space)');
    expect(withPic).toContain('from the front');
    expect(withPic).toContain('attached picture');
    expect(describeMarks([mark], false)).toContain('cannot read images');
  });

  it('能看图的模型：说明和图都发；分轮时说明不算用户说的话，圈的部件和小图单独拿出来', async () => {
    const { faux, session } = fakeSession();
    let sent = '';
    faux.setResponses([
      (ctx) => {
        sent = JSON.stringify(ctx);
        return fauxAssistantMessage([fauxText('好')]);
      },
    ]);
    await session.send('这条手臂太长了', [mark]);
    expect(sent).toContain('Arm_02_L');
    expect(sent).toContain('"type":"image"');
    const [turn] = turnsOf(session.messages, session.starts);
    expect(turn.user).toBe('这条手臂太长了');
    expect(turn.marked).toEqual(['手臂 2 · 左', '躯干']);
    expect(turn.pictures).toEqual(['data:image/jpeg;base64,AAAA']);
  });

  it('不能看图的模型：只发部件名，不发图', async () => {
    const { faux, session } = fakeSession(false, [], false);
    let sent = '';
    faux.setResponses([
      (ctx) => {
        sent = JSON.stringify(ctx);
        return fauxAssistantMessage([fauxText('好')]);
      },
    ]);
    await session.send('这条手臂太长了', [mark]);
    expect(sent).toContain('Arm_02_L');
    expect(sent).not.toContain('"type":"image"');
    expect(sent).toContain('cannot read images');
  });

  it('重新生成时连圈出来的一起重发', async () => {
    const { faux, session } = fakeSession();
    const sent: string[] = [];
    const reply = (ctx: unknown) => {
      sent.push(JSON.stringify(ctx));
      return fauxAssistantMessage([fauxText('好')]);
    };
    faux.setResponses([reply, reply]);
    await session.send('这条手臂太长了', [mark]);
    await session.regenerate();
    expect(sent[1]).toContain('Arm_02_L');
    expect(sent[1]).toContain('"type":"image"');
    expect(turnsOf(session.messages, session.starts)).toHaveLength(1);
  });
});

describe('单独微调部件', () => {
  it('tweak_part：照名字改这一个部件，默认对侧镜像，能整轮撤回', async () => {
    const { shop, faux, session } = fakeSession();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('tweak_part', { part: 'Arm_01_L', scale: 1.3, rotate: [0, 0, 20] })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('左手臂放大了')]),
    ]);
    await session.send('左手臂大一点');
    expect(shop.spec.overrides.Arm_01_L).toEqual({ rotation: [0, 0, 20], scale: [1.3, 1.3, 1.3] });
    // 对侧镜像：绕 Z 的转动反过来
    expect(shop.spec.overrides.Arm_01_R).toEqual({ rotation: [0, 0, -20], scale: [1.3, 1.3, 1.3] });
    const [turn] = turnsOf(session.messages, session.starts);
    expect(turn.changes.map((c) => c.field).sort()).toEqual(['overrides.Arm_01_L', 'overrides.Arm_01_R']);
    session.undoTurn();
    expect(shop.spec.overrides).toEqual({});
  });

  it('tweak_part：mirror false 只改这一边；reset 还原；不认识的部件报错给模型', async () => {
    const { shop, faux, session } = fakeSession();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('tweak_part', { part: 'Leg_01_R', move: [0, 0.05, 0], mirror: false })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('tweak_part', { part: 'Tail_09', scale: 2 })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('好')]),
    ]);
    await session.send('右腿往上挪一点');
    expect(shop.spec.overrides.Leg_01_R).toEqual({ position: [0, 0.05, 0] });
    expect(shop.spec.overrides.Leg_01_L).toBeUndefined();
    const [turn] = turnsOf(session.messages, session.starts);
    const bad = turn.steps.find((st) => st.kind === 'tool' && st.isError);
    expect(bad && bad.kind === 'tool' && bad.result).toContain('Unknown part');
    faux.setResponses([fauxAssistantMessage([fauxToolCall('tweak_part', { part: 'Leg_01_R', reset: true })], { stopReason: 'toolUse' }), fauxAssistantMessage([fauxText('还原了')])]);
    await session.send('还原右腿');
    expect(shop.spec.overrides.Leg_01_R).toBeUndefined();
  });
});

describe('报错和转发地址', () => {
  it('常见报错翻成人话', () => {
    expect(humanError('401 Unauthorized: invalid x-api-key', 'http')).toContain('钥匙');
    expect(humanError('429 rate limit', 'http')).toContain('限流');
    expect(humanError('Failed to fetch', 'direct')).toContain('exe');
    expect(humanError('Insufficient Balance', 'http')).toContain('额度');
  });

  it('转发地址来回换得回去', () => {
    const g = globalThis as { location?: unknown };
    const had = g.location;
    g.location = { href: 'http://localhost:5210/index.html' };
    try {
      const url = forwardUrl('https://api.deepseek.com/v1');
      expect(url).toBe('http://localhost:5210/__ai/fwd/https/api.deepseek.com/v1');
      expect(targetOf('https/api.deepseek.com/v1/chat/completions')).toBe('https://api.deepseek.com/v1/chat/completions');
      expect(targetOf('http/localhost:11434/v1/chat/completions')).toBe('http://localhost:11434/v1/chat/completions');
    } finally {
      g.location = had;
    }
  });
});

describe('圈出来：快速一划', () => {
  it('只有头尾两个点的直线也沿线取点', () => {
    // 头尾都在空白处，中间一段是尾巴
    const pick = (x: number) => (x > 0.45 && x < 0.55 ? 'Tail_01' : null);
    expect(regionOf([[0.3, 0.5], [0.7, 0.5]], pick).parts.map((p) => p.name)).toEqual(['Tail_01']);
  });
});
