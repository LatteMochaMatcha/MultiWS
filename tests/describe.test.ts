import { describe, expect, it } from 'vitest';
import { PRESETS, applyPreset } from '../src/model/presets';
import {
  type BodySpec,
  ARM_LAYOUTS,
  COUNT_DEFS,
  EAR_SHAPES,
  GENDERS,
  HEAD_LAYOUTS,
  LEG_LAYOUTS,
  PENIS_LAYOUTS,
  SCROTUM_MODES,
  POSES,
  defaultCounts,
  defaultSpec,
  legPlan,
} from '../src/model/spec';
import { applyParse, describeSpec, parseDescription, summarize } from '../src/parser';
import { rng } from './helpers';

function withCounts(patch: Partial<BodySpec['counts']>, rest: Partial<BodySpec> = {}): BodySpec {
  const spec = defaultSpec();
  return { ...spec, ...rest, counts: { ...spec.counts, ...patch } };
}

/** 描述 → 解析 → 描述 */
function roundTrip(spec: BodySpec) {
  const text = describeSpec(spec);
  const back = applyParse(spec, parseDescription(text));
  return { text, back };
}

function expectRoundTrip(spec: BodySpec) {
  const { text, back } = roundTrip(spec);
  expect(describeSpec(back), text).toBe(text);
  expect(back.counts, text).toEqual(spec.counts);
  expect(back.earShape, text).toBe(spec.earShape);
  // 只有一个头 / 一对手臂 / 一两条腿时排布不起作用，描述里也不写
  if (spec.counts.heads > 1) expect(back.headLayout, text).toBe(spec.headLayout);
  if (spec.counts.armPairs > 1) expect(back.armLayout, text).toBe(spec.armLayout);
  if (legPlan(spec).form !== 'biped') {
    expect(back.legLayout, text).toBe(spec.legLayout);
    if (spec.legLayout === 'humantaur' || spec.legLayout === 'tandem') expect(back.hipLegs, text).toBe(spec.hipLegs);
  }
  if (spec.counts.penises > 1) expect(back.penisLayout, text).toBe(spec.penisLayout);
  if (spec.counts.penises > 1 && spec.penisLayout === 'grid') expect(back.penisRow, text).toBe(spec.penisRow);
  if (spec.counts.penises > 0) expect(back.scrotum, text).toBe(spec.scrotum);
  // 性别和姿势：从一份全新的默认设定出发，光靠这句话就能读回来
  const fresh = applyParse(defaultSpec(), parseDescription(text));
  expect(fresh.gender, text).toBe(spec.gender);
  expect(fresh.pose, text).toBe(spec.pose);
  // 每排几根也光靠这句话就能读回来
  if (spec.counts.penises > 1 && spec.penisLayout === 'grid') expect(fresh.penisRow, text).toBe(spec.penisRow);
  expect(fresh.counts, text).toEqual(spec.counts);
}

describe('describeSpec 规范描述', () => {
  it('默认人形', () => {
    expect(describeSpec(defaultSpec())).toBe('一个头，一对手臂，一对胸，一对腿');
  });

  it('与 v1 的写法一致', () => {
    expect(describeSpec(withCounts({ heads: 2, armPairs: 2, chestPairs: 2 }))).toBe(
      '两个头，两对手臂，两对胸，一对腿',
    );
    expect(describeSpec(withCounts({ armPairs: 0, chestPairs: 0 }))).toBe('一个头，没有手臂，平胸，一对腿');
    expect(describeSpec(withCounts({ heads: 3, armPairs: 3 }, { armLayout: 'fan' }))).toBe(
      '三个头，三对手臂，一对胸，一对腿，手臂肩部聚拢',
    );
    expect(describeSpec(withCounts({ tails: 9, wingPairs: 3, hornsPerHead: 2, eyesPerHead: 3 }))).toBe(
      '一个头，一对手臂，一对胸，一对腿，九条尾巴，三对翅膀，每个头两只角，每个头三只眼睛',
    );
  });

  it('兽耳带上耳形', () => {
    expect(describeSpec(withCounts({ earPairsPerHead: 1 }, { earShape: 'fox' }))).toBe(
      '一个头，一对手臂，一对胸，一对腿，每个头一对狐耳',
    );
    expect(describeSpec(withCounts({ earPairsPerHead: 2 }, { earShape: 'elf' }))).toBe(
      '一个头，一对手臂，一对胸，一对腿，每个头两对精灵耳',
    );
  });

  it('三条以上的腿且指定了排法时写出下身形态', () => {
    expect(describeSpec(withCounts({ legs: 4 }))).toBe('一个头，一对手臂，一对胸，两对腿');
    expect(describeSpec(withCounts({ legs: 6 }, { legLayout: 'taur' }))).toBe(
      '一个头，一对手臂，一对胸，三对腿，人马下身',
    );
    expect(describeSpec(withCounts({ legs: 4 }, { legLayout: 'spider' }))).toContain('蛛形下身');
    expect(describeSpec(withCounts({ legs: 4 }, { legLayout: 'humantaur' }))).toBe('一个头，一对手臂，一对胸，两对腿，人腿人马下身');
    expect(describeSpec(withCounts({ legs: 4 }, { legLayout: 'tandem' }))).toContain('腿前后排列');
    expect(describeSpec(withCounts({ legs: 4 }, { legLayout: 'row' }))).toContain('腿左右并排');
    expect(describeSpec(withCounts({ legs: 6 }, { legLayout: 'gather' }))).toContain('腿胯部聚拢');
    expect(describeSpec(withCounts({ legs: 2 }, { legLayout: 'taur' }))).toBe(
      '一个头，一对手臂，一对胸，一对腿',
    );
    // 单数条腿；人腿人马每副胯不是一对的把每副几条写出来
    expect(describeSpec(withCounts({ legs: 1 }))).toBe('一个头，一对手臂，一对胸，一条腿');
    expect(describeSpec(withCounts({ legs: 3 }, { legLayout: 'row' }))).toBe('一个头，一对手臂，一对胸，三条腿，腿左右并排');
    expect(describeSpec({ ...withCounts({ legs: 6 }, { legLayout: 'humantaur' }), hipLegs: 3 })).toBe(
      '一个头，一对手臂，一对胸，三对腿，人腿人马下身，每副胯三条腿',
    );
  });

  it('每个上半身单独设的数量：写成「左边的上半身两个头、两对手臂」，读回来一样；写成零的也读得回来', () => {
    const two = { ...withCounts({ torsos: 2 }), torsoCounts: { L: { heads: 2, armPairs: 2 } } };
    expect(describeSpec(two)).toBe('两个上半身，一个头，一对手臂，一对胸，一对腿，左边的上半身两个头、两对手臂');
    expect(parseDescription(describeSpec(two)).torsoCounts).toEqual({ L: { heads: 2, armPairs: 2 } });
    expect(parseDescription(describeSpec(two)).counts).toEqual(two.counts);
    const zero = { ...withCounts({ torsos: 3, hornsPerHead: 2, earPairsPerHead: 1 }), torsoCounts: { R: { armPairs: 0, chestPairs: 0, hornsPerHead: 0, earPairsPerHead: 0 }, M: { eyesPerHead: 3, heads: 2 } } };
    const back = parseDescription(describeSpec(zero));
    expect(back.torsoCounts, describeSpec(zero)).toEqual(zero.torsoCounts);
    expect(back.counts, describeSpec(zero)).toEqual(zero.counts);
    // 和全部一样的数一样的不写；一个上半身时不写
    expect(describeSpec({ ...withCounts({ torsos: 2 }), torsoCounts: { L: { heads: 1 } } })).toBe('两个上半身，一个头，一对手臂，一对胸，一对腿');
    expect(describeSpec({ ...withCounts({}), torsoCounts: { L: { heads: 2 } } })).toBe('一个头，一对手臂，一对胸，一对腿');
    // 没说某一个上半身的：清空（数量整体照文字来）
    expect(parseDescription('两个上半身，一个头').torsoCounts).toEqual({});
    expect(applyParse(two, parseDescription('两个上半身，一个头')).torsoCounts).toEqual({});
  });

  it('识别标签：有上半身单独设过的那几样写出每个的数', () => {
    const spec = { ...withCounts({ torsos: 2 }), torsoCounts: { L: { heads: 2, chestPairs: 0 } } };
    const chip = (key: string) => summarize(spec).find((c) => c.key === key)?.label;
    expect(chip('heads')).toBe('头 左2 右1');
    expect(chip('chestPairs')).toBe('胸 左0 右1 对');
    expect(chip('armPairs')).toBe('手臂 1 对');
  });

  it('只有一对手臂时不写排布', () => {
    expect(describeSpec(withCounts({}, { armLayout: 'fan' }))).toBe('一个头，一对手臂，一对胸，一对腿');
  });

  it('一个头上几张脸：写成「几张脸」；只有一个头时照常写「一个头」', () => {
    expect(describeSpec(withCounts({ heads: 3 }, { headLayout: 'faces' }))).toBe('三张脸，一对手臂，一对胸，一对腿');
    expect(describeSpec(withCounts({ heads: 3 }, { headLayout: 'cluster' }))).toBe('三个头，一对手臂，一对胸，一对腿');
    expect(describeSpec(withCounts({ heads: 1 }, { headLayout: 'faces' }))).toBe('一个头，一对手臂，一对胸，一对腿');
    expect(describeSpec(withCounts({ heads: 2, legs: 4 }, { headLayout: 'wide', legLayout: 'abreast' }))).toBe('两个头，一对手臂，一对胸，两对腿，横排多胯，宽躯干');
    expect(parseDescription('两个头，四条腿，横排多胯，宽躯干').headLayout).toBe('wide');
    expect(parseDescription('two heads, wide torso').headLayout).toBe('wide');
    expect(describeSpec(applyPreset(defaultSpec(), PRESETS.find((p) => p.name === '阿修罗')!))).toBe(
      '三张脸，三对手臂，一对胸，一对腿，手臂肩部聚拢',
    );
    // 写回去再读，还是几张脸
    for (const heads of [2, 3, 4, 5]) {
      for (const headLayout of HEAD_LAYOUTS) expectRoundTrip(withCounts({ heads, hornsPerHead: 2, earPairsPerHead: 1 }, { headLayout }));
    }
  });

  it('男性写在最前面，T-pose 写在最后面；女性和 A-pose 是默认，不写', () => {
    expect(describeSpec(withCounts({}, { gender: 'male' }))).toBe('男性，一个头，一对手臂，一对胸，一对腿');
    expect(describeSpec(withCounts({ armPairs: 2 }, { pose: 'T', armLayout: 'fan' }))).toBe(
      '一个头，两对手臂，一对胸，一对腿，手臂肩部聚拢，T-pose',
    );
    expect(describeSpec(withCounts({ tails: 1 }, { gender: 'male', pose: 'T' }))).toBe(
      '男性，一个头，一对手臂，一对胸，一对腿，一条尾巴，T-pose',
    );
    expect(describeSpec(withCounts({}, { gender: 'female', pose: 'A' }))).toBe('一个头，一对手臂，一对胸，一对腿');
  });
});

describe('描述 → 解析 → 描述 往返一致', () => {
  it('每个部件单独取遍所有数量', () => {
    for (const d of COUNT_DEFS) {
      for (let v = d.min; v <= d.max; v++) expectRoundTrip(withCounts({ [d.key]: v }));
    }
  });

  it('所有排布与耳形的组合', () => {
    for (const armLayout of ARM_LAYOUTS)
      for (const legLayout of LEG_LAYOUTS)
        for (const earShape of EAR_SHAPES)
          for (const legs of [1, 2, 3, 4, 5, 6, 8, 9])
            for (const armPairs of [0, 1, 3])
              for (const hipLegs of legLayout === 'humantaur' || legLayout === 'tandem' ? [1, 2, 3, 4] : [2])
                expectRoundTrip({
                  ...withCounts({ legs, armPairs, earPairsPerHead: 1 }, { armLayout, legLayout, earShape }),
                  hipLegs,
                });
  });

  it('全部预设', () => {
    for (const preset of PRESETS) expectRoundTrip(applyPreset(defaultSpec(), preset));
  });

  it('2000 个随机组合', () => {
    const rand = rng(20261004);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    for (let i = 0; i < 2000; i++) {
      const counts = defaultCounts();
      for (const d of COUNT_DEFS) counts[d.key] = d.min + Math.floor(rand() * (d.max - d.min + 1));
      expectRoundTrip({
        ...defaultSpec(),
        counts,
        headLayout: pick(HEAD_LAYOUTS),
        armLayout: pick(ARM_LAYOUTS),
        legLayout: pick(LEG_LAYOUTS),
        earShape: pick(EAR_SHAPES),
        gender: pick(GENDERS),
        pose: pick(POSES),
        penisLayout: pick(PENIS_LAYOUTS),
        scrotum: pick(SCROTUM_MODES),
      });
    }
  });

  it('阴茎的根数、排法和阴囊', () => {
    for (const penises of [1, 2, 3, 4, 6])
      for (const penisLayout of PENIS_LAYOUTS)
        for (const scrotum of SCROTUM_MODES) expectRoundTrip(withCounts({ penises, legs: 4 }, { penisLayout, scrotum, legLayout: 'abreast' }));
    for (const penisRow of [1, 2, 3, 4]) expectRoundTrip(withCounts({ penises: 6 }, { penisLayout: 'grid', penisRow }));
  });

  it('性别和姿势的四种组合', () => {
    for (const gender of GENDERS) {
      for (const pose of POSES) {
        expectRoundTrip(withCounts({ armPairs: 3, tails: 2 }, { gender, pose, armLayout: 'fan' }));
        expectRoundTrip(withCounts({ armPairs: 0, chestPairs: 0 }, { gender, pose }));
      }
    }
  });

  it('规范描述里写到的部件全部被识别', () => {
    const spec = withCounts({ torsos: 2, tails: 2, wingPairs: 1, hornsPerHead: 2, eyesPerHead: 3, earPairsPerHead: 1, penises: 2 });
    const r = parseDescription(describeSpec(spec));
    expect([...r.hits].sort()).toEqual(COUNT_DEFS.map((d) => d.key).sort());
  });
});

describe('applyParse', () => {
  it('不动体型、性别、姿势和手动微调', () => {
    const spec: BodySpec = {
      ...defaultSpec(),
      gender: 'male',
      pose: 'T',
      earShape: 'rabbit',
      shape: { ...defaultSpec().shape, bust: 1.4, height: 1.8 },
      overrides: { 'UpperArm_L.002': { position: [0, 0.1, 0] } },
    };
    const out = applyParse(spec, parseDescription('两个头'));
    expect(out.counts.heads).toBe(2);
    expect(out.gender).toBe('male');
    expect(out.pose).toBe('T');
    expect(out.earShape).toBe('rabbit');
    expect(out.shape).toEqual(spec.shape);
    expect(out.overrides).toEqual(spec.overrides);
    expect(out).not.toBe(spec);
  });

  it('没提到的部件回到默认（与 v1 一致）', () => {
    const spec = withCounts({ tails: 9, wingPairs: 3 });
    expect(applyParse(spec, parseDescription('两个头')).counts).toEqual({ ...defaultCounts(), heads: 2 });
  });

  it('写了身高和头身比就改，并收进范围', () => {
    const spec = defaultSpec();
    expect(applyParse(spec, parseDescription('身高170，八头身')).shape).toMatchObject({
      height: 1.7,
      headRatio: 8,
    });
    expect(applyParse(spec, parseDescription('三头身')).shape.headRatio).toBe(6);
    expect(applyParse(spec, parseDescription('身高 2.8 米')).shape.height).toBe(2.2);
  });

  it('点名了耳形就改', () => {
    expect(applyParse(defaultSpec(), parseDescription('一对兔耳')).earShape).toBe('rabbit');
  });

  it('写了性别和姿势就改，没写就保持原样', () => {
    const male: BodySpec = { ...defaultSpec(), gender: 'male', pose: 'T' };
    expect(applyParse(defaultSpec(), parseDescription('男性，四臂，T-pose'))).toMatchObject({ gender: 'male', pose: 'T' });
    expect(applyParse(male, parseDescription('少女，双臂自然下垂'))).toMatchObject({ gender: 'female', pose: 'A' });
    expect(applyParse(male, parseDescription('九条尾巴'))).toMatchObject({ gender: 'male', pose: 'T' });
  });

  it('写了发型、发色就改，没写的那一样保持原样；长度和蓬松不动', () => {
    const spec: BodySpec = { ...defaultSpec(), hair: { style: 'bob', color: '#123456', length: 1.3, volume: 1.1, heads: ['', '#ff0000'] } };
    expect(applyParse(spec, parseDescription('两个头')).hair).toEqual(spec.hair);
    expect(applyParse(spec, parseDescription('双马尾')).hair).toEqual({ ...spec.hair, style: 'twintails' });
    expect(applyParse(spec, parseDescription('金发')).hair).toEqual({ ...spec.hair, color: '#e8cf7a' });
    expect(applyParse(defaultSpec(), parseDescription('黑长直')).hair).toMatchObject({ style: 'long', color: '#23222a', length: 1, volume: 1 });
    // 规范描述里不写头发：描述 → 解析 → 再套回去，头发还是原来的
    expect(applyParse(spec, parseDescription(describeSpec(spec))).hair).toEqual(spec.hair);
  });
});

describe('预设名本身就能被解析成对应的预设', () => {
  it.each(PRESETS.map((p) => [p.name, p] as const))('「%s」', (name, preset) => {
    const want = applyPreset(defaultSpec(), preset);
    const r = parseDescription(name);
    expect(r.counts).toEqual(want.counts);
    expect(r.headLayout).toBe(want.headLayout);
    expect(r.armLayout).toBe(want.armLayout);
    expect(r.legLayout).toBe(want.legLayout);
    if (r.earShape) expect(r.earShape).toBe(want.earShape);
  });
});

describe('summarize 识别结果标签', () => {
  const label = (spec: BodySpec, key: string) => summarize(spec).find((c) => c.key === key)?.label;

  it('每个部件一个标签', () => {
    expect(summarize(defaultSpec()).map((c) => c.label)).toEqual([
      '上半身 1',
      '头 1',
      '手臂 1 对',
      '胸 1 对',
      '双足',
      '尾 0',
      '翼 0 对',
      '角 0',
      '眼 2',
      '兽耳 0',
    ]);
  });

  it('下身形态', () => {
    expect(label(withCounts({ legs: 4 }), 'legs')).toBe('人马下身');
    expect(label(withCounts({ legs: 8 }), 'legs')).toBe('蛛形 8 足');
    expect(label(withCounts({ legs: 6 }, { legLayout: 'taur' }), 'legs')).toBe('人马式 6 足');
    expect(label(withCounts({ legs: 4 }, { legLayout: 'humantaur' }), 'legs')).toBe('人腿人马 4 足');
    expect(label(withCounts({ legs: 4 }, { legLayout: 'tandem' }), 'legs')).toBe('前后 4 腿');
    expect(label(withCounts({ legs: 4 }, { legLayout: 'row' }), 'legs')).toBe('并排 4 腿');
    expect(label(withCounts({ legs: 1 }), 'legs')).toBe('单足');
    expect(label(withCounts({ legs: 3 }), 'legs')).toBe('并排 3 腿');
    expect(label(withCounts({ legs: 3 }, { legLayout: 'tandem' }), 'legs')).toBe('前后 3 腿');
    // 人马、蛛形单数时多补一条
    expect(label(withCounts({ legs: 5 }, { legLayout: 'taur' }), 'legs')).toBe('人马式 6 足');
    expect(label({ ...withCounts({ legs: 6 }, { legLayout: 'humantaur' }), hipLegs: 3 }, 'legs')).toBe('人腿人马 3+3 足');
    expect(label({ ...withCounts({ legs: 5 }, { legLayout: 'humantaur' }), hipLegs: 3 }, 'legs')).toBe('人腿人马 3+2 足');
    expect(label(withCounts({ legs: 3 }, { legLayout: 'humantaur' }), 'legs')).toBe('人腿人马 2+1 足');
    expect(label({ ...withCounts({ legs: 6 }, { legLayout: 'tandem' }), hipLegs: 3 }, 'legs')).toBe('前后 3+3 腿');
    expect(label(withCounts({ legs: 5 }, { legLayout: 'gather' }), 'legs')).toBe('聚拢 5 腿');
  });

  it('一个头上几张脸', () => {
    expect(label(withCounts({ heads: 3 }, { headLayout: 'faces' }), 'heads')).toBe('一个头 3 张脸');
    expect(label(withCounts({ heads: 3 }), 'heads')).toBe('头 3');
    expect(label(withCounts({ heads: 1 }, { headLayout: 'faces' }), 'heads')).toBe('头 1');
  });

  it('平胸与耳形', () => {
    expect(label(withCounts({ chestPairs: 0 }), 'chestPairs')).toBe('平胸');
    expect(label(withCounts({ earPairsPerHead: 2 }, { earShape: 'fox' }), 'earPairsPerHead')).toBe('狐耳 2 对');
  });
});
