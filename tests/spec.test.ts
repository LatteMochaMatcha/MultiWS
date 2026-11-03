import { describe, expect, it } from 'vitest';
import { PRESETS, applyPreset } from '../src/model/presets';
import {
  type BodySpec,
  type LegLayout,
  BLEND,
  COUNT_DEFS,
  HAIR_LENGTH,
  HAIR_STYLES,
  HAIR_VOLUME,
  MAX_HIPS,
  SHAPE_DEFS,
  SPEC_VERSION,
  clampBlend,
  clampCounts,
  clampHair,
  clampShape,
  cleanColor,
  colorToLinear,
  defaultCounts,
  defaultHair,
  defaultShape,
  defaultSpec,
  headHairColor,
  legPlan,
  normalizeSpec,
  parseSpecJson,
  resolveLegForm,
  serializeSpec,
} from '../src/model/spec';

describe('默认值与范围', () => {
  it('部件数量的范围符合需求', () => {
    const range = Object.fromEntries(COUNT_DEFS.map((d) => [d.key, [d.min, d.max, d.def]]));
    expect(range).toEqual({
      torsos: [1, 3, 1],
      heads: [1, 5, 1],
      armPairs: [0, 4, 1],
      chestPairs: [0, 4, 1],
      legs: [1, 12, 2],
      tails: [0, 9, 0],
      wingPairs: [0, 3, 0],
      hornsPerHead: [0, 4, 0],
      eyesPerHead: [1, 6, 2],
      earPairsPerHead: [0, 2, 0],
      penises: [0, 6, 0],
    });
  });

  it('头身比默认 7.5，范围 6–9', () => {
    const d = SHAPE_DEFS.find((s) => s.key === 'headRatio')!;
    expect([d.min, d.max, d.def]).toEqual([6, 9, 7.5]);
  });

  it('默认是女性、A-pose、手臂上下排、融合网格', () => {
    expect(defaultSpec()).toMatchObject({
      version: SPEC_VERSION,
      gender: 'female',
      pose: 'A',
      headLayout: 'cluster',
      armLayout: 'stack',
      legLayout: 'auto',
      hands: 'fingers',
      meshMode: 'fused',
      overrides: {},
    });
  });

  it('每次返回新对象', () => {
    expect(defaultSpec()).not.toBe(defaultSpec());
    expect(defaultSpec().counts).not.toBe(defaultSpec().counts);
    expect(defaultSpec().hair).not.toBe(defaultSpec().hair);
  });
});

describe('头发', () => {
  it('默认是原装的头发，不染，长度和蓬松都是原样', () => {
    expect(defaultSpec().hair).toEqual({ style: 'own', color: '', length: 1, volume: 1, heads: [] });
    expect(defaultHair()).toEqual(defaultSpec().hair);
    expect(HAIR_STYLES[0]).toBe('own');
  });

  it('clampHair：不认识的发型回到原装，数值收进范围，颜色整理成 #rrggbb', () => {
    expect(clampHair(undefined)).toEqual(defaultHair());
    expect(clampHair('长发')).toEqual(defaultHair());
    expect(clampHair({ style: 'twintails', color: '#ABCDEF', length: 9, volume: 0 })).toEqual({
      style: 'twintails',
      color: '#abcdef',
      length: HAIR_LENGTH.max,
      volume: HAIR_VOLUME.min,
      heads: [],
    });
    expect(clampHair({ style: 'mohawk', color: 'red', length: 'long', volume: Number.NaN })).toEqual(defaultHair());
  });

  it('cleanColor / colorToLinear', () => {
    expect(cleanColor('#FFF')).toBe('#ffffff');
    expect(cleanColor('12ab9F')).toBe('#12ab9f');
    expect(cleanColor(' #808080 ')).toBe('#808080');
    for (const bad of ['', 'red', '#12345', '#gggggg', 123, null]) expect(cleanColor(bad)).toBe('');
    expect(colorToLinear('#000000')).toEqual([0, 0, 0]);
    expect(colorToLinear('#ffffff')).toEqual([1, 1, 1]);
    // sRGB 的中灰在线性空间里大约是 0.216
    expect(colorToLinear('#808080')[0]).toBeCloseTo(0.2159, 3);
    expect(colorToLinear('#ff0000')).toEqual([1, 0, 0]);
  });

  it('normalizeSpec：旧存档里没有头发就补默认值；存下来再读回来不变', () => {
    expect(normalizeSpec({ counts: { heads: 2 } }).hair).toEqual(defaultHair());
    const spec: BodySpec = { ...defaultSpec(), hair: { style: 'long', color: '#c2413b', length: 1.25, volume: 1.1, heads: ['', 'none', '#2a5f9e'] } };
    expect(parseSpecJson(serializeSpec(spec)).hair).toEqual(spec.hair);
    expect(normalizeSpec({ hair: { style: 'bob', length: 0.1 } }).hair).toEqual({ ...defaultHair(), style: 'bob', length: HAIR_LENGTH.min });
  });

  it('几个头分开染：每项是空、none 或颜色，末尾的空项去掉，最多和头一样多', () => {
    const hair = normalizeSpec({ hair: { color: '#ABC', heads: ['', 'red', '#123456', 'none', '#fff', '', 7, '#000000'] } }).hair;
    expect(hair.heads).toEqual(['', '', '#123456', 'none', '#ffffff']);
    expect(normalizeSpec({ hair: { heads: ['', ''] } }).hair.heads).toEqual([]);
    expect(normalizeSpec({ hair: { heads: 'red' } }).hair.heads).toEqual([]);
    // 空的跟着上面的发色，none 是不染
    expect([0, 1, 2, 3, 4, 5].map((i) => headHairColor(hair, i))).toEqual(['#aabbcc', '#aabbcc', '#123456', '', '#ffffff', '#aabbcc']);
  });
});

describe('clampCounts / clampShape', () => {
  it('取整并收进范围', () => {
    expect(clampCounts({ heads: 99, armPairs: -3, tails: 2.6, eyesPerHead: 0 })).toEqual({
      ...defaultCounts(),
      heads: 5,
      armPairs: 0,
      tails: 3,
      eyesPerHead: 1,
    });
  });

  it('不是数字的值回到默认', () => {
    const bad = { heads: NaN, tails: Infinity, wingPairs: '3' } as unknown as Partial<BodySpec['counts']>;
    expect(clampCounts(bad)).toEqual(defaultCounts());
  });

  it('体型参数收进范围', () => {
    expect(clampShape({ height: 5, headRatio: 2, bust: 1.23456 })).toEqual({
      ...defaultShape(),
      height: 2.2,
      headRatio: 6,
      bust: 1.235,
    });
  });

  it('融合圆角默认 2 cm，范围 0–4 cm；不是数字时回到默认', () => {
    expect(defaultSpec().blend).toBe(0.02);
    expect([BLEND.min, BLEND.max, BLEND.def]).toEqual([0, 0.04, 0.02]);
    expect(clampBlend(0.5)).toBe(0.04);
    expect(clampBlend(-1)).toBe(0);
    expect(clampBlend(0.0123456)).toBe(0.0123);
    expect(clampBlend('2')).toBe(0.02);
    expect(clampBlend(NaN)).toBe(0.02);
    expect(normalizeSpec({ blend: 0.031, meshMode: 'parts' })).toMatchObject({ blend: 0.031, meshMode: 'parts' });
    expect(normalizeSpec({ blend: 7 }).blend).toBe(0.04);
  });
});

describe('resolveLegForm', () => {
  it.each([
    [1, 'auto', 'biped'],
    [2, 'auto', 'biped'],
    [2, 'spider', 'biped'],
    [3, 'auto', 'row'],
    [4, 'auto', 'taur'],
    [5, 'auto', 'row'],
    [6, 'auto', 'spider'],
    [8, 'auto', 'spider'],
    [6, 'taur', 'taur'],
    [5, 'taur', 'taur'],
    [4, 'spider', 'spider'],
    [4, 'tandem', 'tandem'],
    [3, 'tandem', 'tandem'],
    [8, 'row', 'row'],
    [3, 'humantaur', 'humantaur'],
    [4, 'humantaur', 'humantaur'],
    [8, 'humantaur', 'humantaur'],
    [2, 'humantaur', 'biped'],
    [3, 'gather', 'gather'],
    [12, 'gather', 'gather'],
    [2, 'gather', 'biped'],
  ] as const)('%i 条腿 + %s → %s', (legs, layout, form) => {
    expect(resolveLegForm(legs, layout)).toBe(form);
  });

  it('人腿人马每副胯几条腿：一副胯装得下就是并排，「前一后一」也算人腿人马', () => {
    expect(resolveLegForm(3, 'humantaur', 3)).toBe('row');
    expect(resolveLegForm(6, 'humantaur', 3)).toBe('humantaur');
    expect(resolveLegForm(2, 'humantaur', 1)).toBe('humantaur');
    expect(resolveLegForm(1, 'humantaur', 1)).toBe('biped');
    // 前后串联也一样
    expect(resolveLegForm(3, 'tandem', 3)).toBe('row');
    expect(resolveLegForm(6, 'tandem', 3)).toBe('tandem');
    expect(resolveLegForm(2, 'tandem', 1)).toBe('tandem');
  });
});

describe('legPlan', () => {
  const plan = (legs: number, legLayout: LegLayout, hipLegs = 2) => legPlan({ counts: { ...defaultCounts(), legs }, legLayout, hipLegs });
  it('每一站几条腿', () => {
    expect(plan(1, 'auto')).toEqual({ form: 'biped', stations: [1], total: 1 });
    expect(plan(2, 'auto')).toEqual({ form: 'biped', stations: [2], total: 2 });
    expect(plan(5, 'row')).toEqual({ form: 'row', stations: [5], total: 5 });
    // 前后排的：单数时最后那副胯只有一条
    expect(plan(3, 'tandem')).toEqual({ form: 'tandem', stations: [2, 1], total: 3 });
    expect(plan(5, 'humantaur')).toEqual({ form: 'humantaur', stations: [2, 2, 1], total: 5 });
    // 「前三后三」「前三后二」
    expect(plan(6, 'humantaur', 3)).toEqual({ form: 'humantaur', stations: [3, 3], total: 6 });
    expect(plan(5, 'humantaur', 3)).toEqual({ form: 'humantaur', stations: [3, 2], total: 5 });
    expect(plan(12, 'humantaur', 4)).toEqual({ form: 'humantaur', stations: [4, 4, 4], total: 12 });
    expect(plan(6, 'tandem', 3)).toEqual({ form: 'tandem', stations: [3, 3], total: 6 });
    expect(plan(7, 'tandem', 4)).toEqual({ form: 'tandem', stations: [4, 3], total: 7 });
    // 胯部聚拢：每副胯一对，不管 hipLegs；单数时最后那副一条
    expect(plan(6, 'gather', 3)).toEqual({ form: 'gather', stations: [2, 2, 2], total: 6 });
    expect(plan(5, 'gather')).toEqual({ form: 'gather', stations: [2, 2, 1], total: 5 });
    // 人马、蛛形只能成对：单数多补一条
    expect(plan(5, 'taur')).toEqual({ form: 'taur', stations: [2, 2, 2], total: 6 });
    expect(plan(7, 'spider')).toEqual({ form: 'spider', stations: [2, 2, 2, 2], total: 8 });
    // 前后排的最多 MAX_HIPS 副胯
    expect(plan(12, 'humantaur', 1).stations).toHaveLength(MAX_HIPS);
  });
});

describe('normalizeSpec', () => {
  it.each([null, undefined, 42, 'abc', [], {}])('乱七八糟的输入 %j 得到默认值', (input) => {
    expect(normalizeSpec(input)).toEqual(defaultSpec());
  });

  it('越界的数值和不认识的选项被修正', () => {
    const spec = normalizeSpec({
      counts: { heads: 12, tails: -1, nope: 3 },
      shape: { height: 9, nope: 1 },
      gender: 'robot',
      pose: 'X',
      headLayout: 'hydra',
      armLayout: 'spiral',
      legLayout: 'wheel',
      earShape: 'dog',
    });
    expect(spec).toEqual({ ...defaultSpec(), counts: { ...defaultCounts(), heads: 5 }, shape: { ...defaultShape(), height: 2.2 } });
  });

  it('第 2 版的配置文件：腿的对数换成条数', () => {
    const v2 = { app: 'oc-basemesh', version: 2, counts: { legPairs: 3 }, legLayout: 'humantaur' };
    const spec = normalizeSpec(v2);
    expect(spec.counts.legs).toBe(6);
    expect(spec.hipLegs).toBe(2);
    // 第 3 版的 legs 就是条数
    expect(normalizeSpec({ version: 3, counts: { legs: 3 }, hipLegs: 3 })).toMatchObject({ counts: { legs: 3 }, hipLegs: 3 });
    expect(normalizeSpec({ version: 3, hipLegs: 9 }).hipLegs).toBe(4);
  });

  it('阴茎几乘几：每排几根默认 2，越界收回', () => {
    expect(defaultSpec().penisRow).toBe(2);
    expect(normalizeSpec({ version: 3, penisLayout: 'grid', penisRow: 3 })).toMatchObject({ penisLayout: 'grid', penisRow: 3 });
    expect(normalizeSpec({ version: 3, penisRow: 9 }).penisRow).toBe(4);
    expect(normalizeSpec({ version: 3, penisRow: 'x' }).penisRow).toBe(2);
  });

  it('读得懂 v1 的配置文件', () => {
    const v1 = {
      app: 'oc-basemesh',
      version: 1,
      text: '两个头，两对手臂，两对胸，一对腿',
      counts: { heads: 2, arms: 2, chest: 2, legs: 1, tails: 3, wings: 1, horns: 2, eyes: 3 },
      shape: { build: 1.1, shoulders: 0.9, bust: 1.2, hips: 1.3, fluff: 1.4 },
      layout: 'shoulder',
    };
    const spec = normalizeSpec(v1);
    expect(spec.version).toBe(SPEC_VERSION);
    expect(spec.counts).toEqual({
      torsos: 1,
      heads: 2,
      armPairs: 2,
      chestPairs: 2,
      legs: 2,
      tails: 3,
      wingPairs: 1,
      hornsPerHead: 2,
      eyesPerHead: 3,
      earPairsPerHead: 0,
      penises: 0,
    });
    expect(spec.shape).toMatchObject({ build: 1.1, shoulders: 0.9, bust: 1.2, hips: 1.3, tailFluff: 1.4 });
    expect(spec.armLayout).toBe('fan');
  });

  it('保留合法的手动微调，丢掉不合法的', () => {
    const spec = normalizeSpec({
      overrides: {
        'UpperArm_L.002': { position: [0, 0.1, 0], rotation: [0, 0, 15] },
        Tail_01_03: { scale: [1, 2, 1] },
        bad1: { position: [1, 2] },
        bad2: { rotation: ['a', 0, 0] },
        bad3: 'nope',
      },
    });
    expect(spec.overrides).toEqual({
      'UpperArm_L.002': { position: [0, 0.1, 0], rotation: [0, 0, 15] },
      Tail_01_03: { scale: [1, 2, 1] },
    });
  });

  it('手动微调越界的数值收回范围，等于没改的丢掉', () => {
    const spec = normalizeSpec({
      overrides: {
        Arm_01_L: { position: [0, 9, 0], rotation: [0, 0, -720], scale: [0.001, 1, 50] },
        Head_01: { position: [0, 0, 0], scale: [1, 1, 1] },
        Tail_01: { position: [0, 0, 0], rotation: [0, 12.3456, 0] },
      },
    });
    expect(spec.overrides).toEqual({
      Arm_01_L: { position: [0, 3, 0], rotation: [0, 0, -180], scale: [0.05, 1, 10] },
      Tail_01: { rotation: [0, 12.35, 0] },
    });
  });
});

describe('保存与载入', () => {
  const spec: BodySpec = {
    ...applyPreset(defaultSpec(), PRESETS.find((p) => p.name === '九尾狐')!),
    gender: 'male',
    pose: 'T',
    overrides: { 'Head.002': { rotation: [0, 10, 0] } },
  };

  it('JSON 往返一致', () => {
    expect(parseSpecJson(serializeSpec(spec))).toEqual(spec);
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
  });

  it('文件里带上应用名和描述文字', () => {
    const data = JSON.parse(serializeSpec(spec, '九条尾巴'));
    expect(data.app).toBe('oc-basemesh');
    expect(data.version).toBe(3);
    expect(data.text).toBe('九条尾巴');
  });

  it('不是 JSON 时抛错', () => {
    expect(() => parseSpecJson('{oops')).toThrow();
  });
});

describe('预设', () => {
  it('包含需求里的 12 个', () => {
    expect(PRESETS.map((p) => p.name)).toEqual([
      '标准人形',
      '双头',
      '四臂',
      '两对胸',
      '阿修罗',
      '半人马',
      '蜘蛛女',
      '九尾狐',
      '六翼天使',
      '三眼',
      '龙娘',
      '兽耳娘',
    ]);
  });

  it('数量都在范围内', () => {
    for (const p of PRESETS) {
      const counts = { ...defaultCounts(), ...p.counts };
      expect(clampCounts(counts), p.name).toEqual(counts);
    }
  });

  it('套用预设会重置数量和排布、清掉手动微调，但不动性别和姿势', () => {
    const before: BodySpec = {
      ...defaultSpec(),
      counts: { ...defaultCounts(), heads: 4, tails: 5 },
      armLayout: 'fan',
      legLayout: 'row',
      gender: 'male',
      pose: 'T',
      overrides: { Head_01: { scale: [1.1, 1.1, 1.1] } },
    };
    const after = applyPreset({ ...before, headLayout: 'faces' }, PRESETS.find((p) => p.name === '半人马')!);
    expect(after.counts).toEqual({ ...defaultCounts(), legs: 4 });
    expect(after.headLayout).toBe('cluster');
    expect(after.armLayout).toBe('stack');
    expect(after.legLayout).toBe('taur');
    expect(after.gender).toBe('male');
    expect(after.pose).toBe('T');
    expect(after.overrides).toEqual({});
    // 原来的 spec 没有被改动
    expect(before.overrides).toEqual({ Head_01: { scale: [1.1, 1.1, 1.1] } });
  });

  it('阿修罗是「三面六臂」：一个头上三张脸，手臂在肩部聚拢；别的预设都是凑成一簇', () => {
    const asura = applyPreset(defaultSpec(), PRESETS.find((p) => p.name === '阿修罗')!);
    expect(asura).toMatchObject({ headLayout: 'faces', armLayout: 'fan' });
    expect(asura.counts).toMatchObject({ heads: 3, armPairs: 3 });
    for (const p of PRESETS) if (p.name !== '阿修罗') expect(applyPreset(asura, p).headLayout, p.name).toBe('cluster');
    // 存下来再读回来还在；不认识的写法回到默认
    expect(parseSpecJson(serializeSpec(asura)).headLayout).toBe('faces');
    expect(normalizeSpec({ headLayout: 'faces' }).headLayout).toBe('faces');
    expect(normalizeSpec({}).headLayout).toBe('cluster');
  });

  it('只改预设点名的体型参数', () => {
    const before = { ...defaultSpec(), shape: { ...defaultShape(), bust: 1.5 } };
    const after = applyPreset(before, PRESETS.find((p) => p.name === '九尾狐')!);
    expect(after.shape).toEqual({ ...defaultShape(), bust: 1.5, tailFluff: 1.4 });
    expect(after.earShape).toBe('fox');
  });
});
