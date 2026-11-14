import { describe, expect, it } from 'vitest';
import { PRESETS, applyPreset } from '../src/model/presets';
import {
  type BodySpec,
  type CountKey,
  ARM_LAYOUTS,
  COUNT_DEFS,
  EAR_SHAPES,
  GENDERS,
  HEAD_LAYOUTS,
  LEG_LAYOUTS,
  PENIS_LAYOUTS,
  POSES,
  SCROTUM_MODES,
  defaultCounts,
  defaultSpec,
  legPlan,
  PER_TORSO_KEYS,
  type TorsoCounts,
  torsoSides,
} from '../src/model/spec';
import { type Lang, LANGS } from '../src/i18n';
import { applyParse, describeSpec, normalizeText, parseDescription } from '../src/parser';
import { diff, diffCounts, hitsOf, rng } from './helpers';

/** 三种语言里，英文、日文要和中文逐字段对得上 */
const OTHER: readonly Exclude<Lang, 'zh'>[] = ['en', 'ja'];

function withCounts(patch: Partial<BodySpec['counts']>, rest: Partial<BodySpec> = {}): BodySpec {
  const spec = defaultSpec();
  return { ...spec, ...rest, counts: { ...spec.counts, ...patch } };
}

/** 解析结果里和设定有关的字段（不含 hits、matches：那是界面高亮用的） */
function fields(text: string) {
  const r = parseDescription(text);
  return {
    counts: r.counts,
    headLayout: r.headLayout,
    armLayout: r.armLayout,
    legLayout: r.legLayout,
    hipLegs: r.hipLegs,
    penisLayout: r.penisLayout,
    penisRow: r.penisRow,
    scrotum: r.scrotum,
    earShape: r.earShape,
    gender: r.gender,
    pose: r.pose,
    shape: r.shape,
    hair: r.hair,
    torsoCounts: r.torsoCounts,
  };
}

/** 描述 → 解析 → 描述一致，而且读回来的设定和原来的一样；这一种语言的描述和中文描述解析出来的字段相同 */
function expectRoundTrip(spec: BodySpec, lang: Lang) {
  const text = describeSpec(spec, lang);
  const back = applyParse(spec, parseDescription(text));
  expect(describeSpec(back, lang), text).toBe(text);
  expect(back.counts, text).toEqual(spec.counts);
  expect(back.earShape, text).toBe(spec.earShape);
  if (spec.counts.heads > 1) expect(back.headLayout, text).toBe(spec.headLayout);
  if (spec.counts.armPairs > 1) expect(back.armLayout, text).toBe(spec.armLayout);
  if (legPlan(spec).form !== 'biped') {
    expect(back.legLayout, text).toBe(spec.legLayout);
    if (spec.legLayout === 'humantaur' || spec.legLayout === 'tandem') expect(back.hipLegs, text).toBe(spec.hipLegs);
  }
  if (spec.counts.penises > 1) expect(back.penisLayout, text).toBe(spec.penisLayout);
  if (spec.counts.penises > 1 && spec.penisLayout === 'grid') expect(back.penisRow, text).toBe(spec.penisRow);
  if (spec.counts.penises > 0) expect(back.scrotum, text).toBe(spec.scrotum);
  // 性别和姿势：光靠这句话就能读回来
  const fresh = applyParse(defaultSpec(), parseDescription(text));
  expect(fresh.gender, text).toBe(spec.gender);
  expect(fresh.pose, text).toBe(spec.pose);
  expect(fresh.counts, text).toEqual(spec.counts);
  // 和中文描述读出来的设定一模一样
  expect(fields(text), text).toEqual(fields(describeSpec(spec, 'zh')));
}

function expectRoundTripAll(spec: BodySpec) {
  for (const lang of OTHER) expectRoundTrip(spec, lang);
}

describe('规范描述：英文、日文的样子', () => {
  it('中文一个字没变', () => {
    expect(describeSpec(defaultSpec(), 'zh')).toBe('一个头，一对手臂，一对胸，一对腿');
    // 默认语言在 Node 里是中文
    expect(describeSpec(defaultSpec())).toBe(describeSpec(defaultSpec(), 'zh'));
    expect(describeSpec(withCounts({ heads: 2, armPairs: 2, breasts: 4 }), 'zh')).toBe('两个头，两对手臂，两对胸，一对腿');
  });

  it('英文：数字用阿拉伯数字，逗号分隔', () => {
    expect(describeSpec(defaultSpec(), 'en')).toBe('1 head, 1 pair of arms, 1 pair of breasts, 1 pair of legs');
    expect(describeSpec(withCounts({ heads: 2, armPairs: 2, breasts: 4 }), 'en')).toBe(
      '2 heads, 2 pairs of arms, 2 pairs of breasts, 1 pair of legs',
    );
    expect(
      describeSpec(withCounts({ heads: 2, armPairs: 2, breasts: 4, legs: 4, tails: 9, earPairsPerHead: 1 }, { legLayout: 'taur', earShape: 'fox' }), 'en'),
    ).toBe('2 heads, 2 pairs of arms, 2 pairs of breasts, 2 pairs of legs, centaur lower body, 9 tails, fox ears');
    expect(describeSpec(withCounts({ armPairs: 0, breasts: 0, legs: 3, tails: 1 }, { gender: 'male', pose: 'T' }), 'en')).toBe(
      'male, 1 head, no arms, flat chest, 3 legs, 1 tail, T-pose',
    );
    expect(describeSpec(withCounts({ heads: 3 }, { headLayout: 'faces' }), 'en')).toBe('3 faces, 1 pair of arms, 1 pair of breasts, 1 pair of legs');
    expect(describeSpec(withCounts({ hornsPerHead: 2, eyesPerHead: 3, earPairsPerHead: 2 }, { earShape: 'elf' }), 'en')).toBe(
      '1 head, 1 pair of arms, 1 pair of breasts, 1 pair of legs, 2 horns per head, 3 eyes per head, 2 pairs of elf ears per head',
    );
    expect(describeSpec({ ...withCounts({ legs: 6 }, { legLayout: 'humantaur' }), hipLegs: 3 }, 'en')).toBe(
      '1 head, 1 pair of arms, 1 pair of breasts, 3 pairs of legs, humantaur lower body, 3 legs per pelvis',
    );
    expect(describeSpec(withCounts({ armPairs: 3 }, { armLayout: 'fan' }), 'en')).toBe(
      '1 head, 3 pairs of arms, 1 pair of breasts, 1 pair of legs, arms gathered at the shoulders',
    );
  });

  it('日文：数字用阿拉伯数字，顿号分隔', () => {
    expect(describeSpec(defaultSpec(), 'ja')).toBe('頭1つ、腕1対、胸1対、脚1対');
    expect(describeSpec(withCounts({ heads: 2, armPairs: 2, breasts: 4 }), 'ja')).toBe('頭2つ、腕2対、胸2対、脚1対');
    expect(
      describeSpec(withCounts({ heads: 2, armPairs: 2, breasts: 4, legs: 4, tails: 9, earPairsPerHead: 1 }, { legLayout: 'taur', earShape: 'fox' }), 'ja'),
    ).toBe('頭2つ、腕2対、胸2対、脚2対、ケンタウロスの下半身、尻尾9本、狐耳');
    expect(describeSpec(withCounts({ armPairs: 0, breasts: 0, legs: 3, tails: 1 }, { gender: 'male', pose: 'T' }), 'ja')).toBe(
      '男性、頭1つ、腕なし、貧乳、脚3本、尻尾1本、Tポーズ',
    );
    expect(describeSpec(withCounts({ heads: 3 }, { headLayout: 'faces' }), 'ja')).toBe('顔3つ、腕1対、胸1対、脚1対');
    expect(describeSpec(withCounts({ hornsPerHead: 2, eyesPerHead: 3, earPairsPerHead: 2 }, { earShape: 'rabbit' }), 'ja')).toBe(
      '頭1つ、腕1対、胸1対、脚1対、頭ごとに角2本、頭ごとに目3つ、頭ごとにうさ耳2対',
    );
    expect(describeSpec({ ...withCounts({ legs: 6 }, { legLayout: 'humantaur' }), hipLegs: 3 }, 'ja')).toBe(
      '頭1つ、腕1対、胸1対、脚3対、ヒューマンタウロスの下半身、骨盤ごとに脚3本',
    );
  });

  it('每种排法都有自己的写法，互不相同', () => {
    for (const lang of OTHER) {
      const texts = LEG_LAYOUTS.filter((l) => l !== 'auto').map((legLayout) => describeSpec(withCounts({ legs: 6 }, { legLayout }), lang));
      expect(new Set(texts).size, lang).toBe(texts.length);
    }
  });
});

describe('英文、日文的规范描述：往返一致，且和中文读出来的设定相同', () => {
  it('每个部件单独取遍所有数量', () => {
    for (const d of COUNT_DEFS) {
      for (let v = d.min; v <= d.max; v++) expectRoundTripAll(withCounts({ [d.key]: v }));
    }
  });

  it('所有排布与耳形的组合', () => {
    for (const armLayout of ARM_LAYOUTS)
      for (const legLayout of LEG_LAYOUTS)
        for (const earShape of EAR_SHAPES)
          for (const legs of [1, 2, 3, 4, 5, 6, 8, 9])
            for (const armPairs of [0, 1, 3])
              for (const hipLegs of legLayout === 'humantaur' || legLayout === 'tandem' ? [1, 2, 3, 4] : [2])
                expectRoundTripAll({
                  ...withCounts({ legs, armPairs, earPairsPerHead: 1 }, { armLayout, legLayout, earShape }),
                  hipLegs,
                });
  });

  it('耳形和每个头几对耳朵', () => {
    for (const earShape of EAR_SHAPES) for (const earPairsPerHead of [1, 2]) for (const heads of [1, 3]) expectRoundTripAll(withCounts({ earPairsPerHead, heads }, { earShape }));
  });

  it('全部预设', () => {
    for (const preset of PRESETS) expectRoundTripAll(applyPreset(defaultSpec(), preset));
  });

  it('多头的三种排法', () => {
    for (const heads of [2, 3, 4, 5]) {
      for (const headLayout of HEAD_LAYOUTS) expectRoundTripAll(withCounts({ heads, hornsPerHead: 2, earPairsPerHead: 1 }, { headLayout }));
    }
  });

  it('阴茎的根数、排法和阴囊', () => {
    for (const penises of [1, 2, 3, 4, 6])
      for (const penisLayout of PENIS_LAYOUTS)
        for (const scrotum of SCROTUM_MODES) expectRoundTripAll(withCounts({ penises, legs: 4 }, { penisLayout, scrotum, legLayout: 'abreast' }));
    for (const penisRow of [1, 2, 3, 4]) expectRoundTripAll(withCounts({ penises: 6 }, { penisLayout: 'grid', penisRow }));
  });

  it('性别和姿势的四种组合', () => {
    for (const gender of GENDERS) {
      for (const pose of POSES) {
        expectRoundTripAll(withCounts({ armPairs: 3, tails: 2 }, { gender, pose, armLayout: 'fan' }));
        expectRoundTripAll(withCounts({ armPairs: 0, breasts: 0 }, { gender, pose }));
      }
    }
  });

  it('2000 个随机组合', () => {
    const rand = rng(20261103);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    for (let i = 0; i < 2000; i++) {
      const counts = defaultCounts();
      for (const d of COUNT_DEFS) counts[d.key] = d.min + Math.floor(rand() * (d.max - d.min + 1));
      expectRoundTripAll({
        ...defaultSpec(),
        counts,
        headLayout: pick(HEAD_LAYOUTS),
        armLayout: pick(ARM_LAYOUTS),
        legLayout: pick(LEG_LAYOUTS),
        hipLegs: 1 + Math.floor(rand() * 4),
        earShape: pick(EAR_SHAPES),
        gender: pick(GENDERS),
        pose: pick(POSES),
        penisLayout: pick(PENIS_LAYOUTS),
        penisRow: 1 + Math.floor(rand() * 4),
        scrotum: pick(SCROTUM_MODES),
      });
    }
  });

  it('规范描述里写到的部件全部被识别', () => {
    const spec = withCounts({ torsos: 2, tails: 2, wingPairs: 1, hornsPerHead: 2, eyesPerHead: 3, earPairsPerHead: 1, penises: 2 });
    for (const lang of OTHER) {
      const r = parseDescription(describeSpec(spec, lang));
      expect([...r.hits].sort(), lang).toEqual(COUNT_DEFS.map((d) => d.key).sort());
    }
  });
});

describe('英文的自然写法', () => {
  it.each<[string, Partial<Record<CountKey, number>>]>([
    ['two heads', { heads: 2 }],
    ['2 heads', { heads: 2 }],
    ['two-headed', { heads: 2 }],
    ['four arms', { armPairs: 2 }],
    ['2 pairs of arms', { armPairs: 2 }],
    ['a pair of wings', { wingPairs: 1 }],
    ['6 wings', { wingPairs: 3 }],
    ['nine tails', { tails: 9 }],
    ['three eyes', { eyesPerHead: 3 }],
    ['2 horns', { hornsPerHead: 2 }],
    ['cat ears', { earPairsPerHead: 1 }],
    ['flat chest', { breasts: 0 }],
    ['centaur', { legs: 4 }],
    ['Centaur girl', { legs: 4 }],
    ['drider', { legs: 8 }],
    ['arachne', { legs: 8 }],
    ['spider lower body', { legs: 8 }],
    ['humantaur', { legs: 4 }],
    ['asura', { heads: 3, armPairs: 3 }],
    ['2 upper bodies', { torsos: 2 }],
    ['three torsos', { torsos: 3 }],
    ['3 faces', { heads: 3 }],
    ['1 pair of legs', {}],
    ['3 legs', { legs: 3 }],
    ['4 pairs of legs', { legs: 8 }],
    ['1 leg', { legs: 1 }],
    ['1 eye per head', { eyesPerHead: 1 }],
    ['3 horns per head, 2 pairs of rabbit ears per head', { hornsPerHead: 3, earPairsPerHead: 2 }],
    ['5 penises', { penises: 5 }],
    ['no arms', { armPairs: 0 }],
    ['Two Heads, Four Arms, Nine Tails', { heads: 2, armPairs: 2, tails: 9 }],
  ])('「%s」', (text, counts) => {
    expect(diff(text)).toEqual(counts);
  });

  it('没有就是 0', () => {
    const r = parseDescription('no tail');
    expect(r.counts.tails).toBe(0);
    expect(r.hits.has('tails')).toBe(true);
  });

  it('下身形态和排布', () => {
    expect(parseDescription('centaur').legLayout).toBe('taur');
    expect(parseDescription('drider').legLayout).toBe('spider');
    expect(parseDescription('spider lower body').legLayout).toBe('spider');
    expect(parseDescription('humantaur').legLayout).toBe('humantaur');
    expect(parseDescription('humantaur lower body').legLayout).toBe('humantaur');
    expect(parseDescription('6 legs, legs in tandem').legLayout).toBe('tandem');
    expect(parseDescription('tandem legs').legLayout).toBe('tandem');
    expect(parseDescription('6 legs, legs side by side').legLayout).toBe('row');
    expect(parseDescription('6 legs, legs gathered at the pelvis').legLayout).toBe('gather');
    expect(parseDescription('gathered legs').legLayout).toBe('gather');
    expect(parseDescription('4 pairs of legs, pelvises side by side').legLayout).toBe('abreast');
    expect(parseDescription('hips side by side').legLayout).toBe('abreast');
    expect(parseDescription('3 pairs of arms, arms gathered at the shoulders').armLayout).toBe('fan');
    expect(parseDescription('3 pairs of arms, fanned arms').armLayout).toBe('fan');
    expect(parseDescription('3 pairs of arms, arms stacked').armLayout).toBe('stack');
    expect(parseDescription('2 heads, wide torso').headLayout).toBe('wide');
    expect(parseDescription('3 faces').headLayout).toBe('faces');
    expect(parseDescription('3 heads').headLayout).toBe('cluster');
  });

  it('每副胯几条腿', () => {
    expect(parseDescription('3 pairs of legs, humantaur lower body, 3 legs per pelvis')).toMatchObject({
      legLayout: 'humantaur',
      hipLegs: 3,
      counts: { legs: 6 },
    });
    expect(parseDescription('humantaur, 5 legs, each pelvis has 3 legs')).toMatchObject({ hipLegs: 3, counts: { legs: 5 } });
    expect(parseDescription('4 legs, legs in tandem, one leg per pelvis')).toMatchObject({ hipLegs: 1, counts: { legs: 4 } });
  });

  it('阴茎的排法、每排几根、阴囊', () => {
    expect(parseDescription('6 penises, penises in rows of 3')).toMatchObject({ penisLayout: 'grid', penisRow: 3, counts: { penises: 6 } });
    expect(parseDescription('6 penises, 2 per row')).toMatchObject({ penisLayout: 'grid', penisRow: 2, counts: { penises: 6 } });
    expect(parseDescription('3 penises, penises stacked').penisLayout).toBe('stack');
    expect(parseDescription('3 penises, penises fanned out').penisLayout).toBe('fan');
    expect(parseDescription('3 penises').penisLayout).toBe('row');
    expect(parseDescription('3 penises, each with its own scrotum').scrotum).toBe('each');
    expect(parseDescription('3 penises').scrotum).toBe('shared');
  });

  it('性别、姿势、头身比、身高', () => {
    for (const [text, gender] of [['male', 'male'], ['boy', 'male'], ['1boy', 'male'], ['female', 'female'], ['girl', 'female'], ['woman', 'female']] as const) {
      expect(parseDescription(text).gender, text).toBe(gender);
    }
    expect(parseDescription('T-pose').pose).toBe('T');
    expect(parseDescription('A-pose').pose).toBe('A');
    expect(parseDescription('8 heads tall').shape.headRatio).toBe(8);
    expect(parseDescription('eight heads tall').shape.headRatio).toBe(8);
    expect(parseDescription('7.5 heads tall').shape.headRatio).toBe(7.5);
    expect(parseDescription('seven and a half heads tall').shape.headRatio).toBe(7.5);
    expect(parseDescription('8-head-tall').shape.headRatio).toBe(8);
    expect(parseDescription('height 165').shape.height).toBe(1.65);
    expect(parseDescription('height: 1.7 m').shape.height).toBe(1.7);
    expect(parseDescription('165 cm').shape.height).toBe(1.65);
    expect(parseDescription('165cm tall').shape.height).toBe(1.65);
    // 头身比里的数字不是头的数量
    expect(diff('8 heads tall')).toEqual({});
    expect(diff('8 heads tall, 2 heads')).toEqual({ heads: 2 });
  });

  it('发型和发色', () => {
    expect(parseDescription('twintails').hair.style).toBe('twintails');
    expect(parseDescription('twin tails').hair.style).toBe('twintails');
    expect(parseDescription('ponytail').hair.style).toBe('sidetail');
    expect(parseDescription('long hair').hair.style).toBe('long');
    expect(parseDescription('bob cut').hair.style).toBe('bob');
    expect(parseDescription('blonde hair').hair.color).toBe('#e8cf7a');
    expect(parseDescription('silver hair').hair.color).toBe('#d5dbe6');
    expect(diff('twintails, ponytail, blonde hair')).toEqual({});
  });

  it('整词匹配：arm 不会命中 armor，ear 不会命中 year / earring', () => {
    for (const text of ['armor', '2 armor', 'two armored knights', 'year', '2 years', 'earring', 'a pair of earrings', 'tailor', 'legend', 'headphones', 'eyebrows', 'wingman', 'horny', 'facebook', 'head over heels']) {
      const r = parseDescription(text);
      expect(diffCounts(r.counts), text).toEqual({});
      expect(r.hits.size, text).toBe(0);
    }
  });
});

describe('日文的自然写法', () => {
  it.each<[string, Partial<Record<CountKey, number>>]>([
    ['頭2つ', { heads: 2 }],
    ['頭が2つ', { heads: 2 }],
    ['2つの頭', { heads: 2 }],
    ['ふたつの頭', { heads: 2 }],
    ['頭がみっつ', { heads: 3 }],
    ['頭が三つ', { heads: 3 }],
    ['双頭', { heads: 2 }],
    ['二頭', { heads: 2 }],
    ['顔3つ', { heads: 3 }],
    ['腕4本', { armPairs: 2 }],
    ['腕が4本', { armPairs: 2 }],
    ['腕2対', { armPairs: 2 }],
    ['腕が2対', { armPairs: 2 }],
    ['四本腕', { armPairs: 2 }],
    ['4本の腕', { armPairs: 2 }],
    ['六臂', { armPairs: 3 }],
    ['腕なし', { armPairs: 0 }],
    ['翼6枚', { wingPairs: 3 }],
    ['翼3対', { wingPairs: 3 }],
    ['3対の翼', { wingPairs: 3 }],
    ['六枚翼の天使', { wingPairs: 3 }],
    ['尻尾9本', { tails: 9 }],
    ['尻尾が3本', { tails: 3 }],
    ['九本の長い尻尾', { tails: 9 }],
    ['九尾', { tails: 9 }],
    ['三つ目', { eyesPerHead: 3 }],
    ['目3つ', { eyesPerHead: 3 }],
    ['目が3つ', { eyesPerHead: 3 }],
    ['一つ目', { eyesPerHead: 1 }],
    ['角2本', { hornsPerHead: 2 }],
    ['2本の角', { hornsPerHead: 2 }],
    ['猫耳', { earPairsPerHead: 1 }],
    ['ネコミミ', { earPairsPerHead: 1 }],
    ['ねこみみ', { earPairsPerHead: 1 }],
    ['ケモミミ', { earPairsPerHead: 1 }],
    ['うさ耳', { earPairsPerHead: 1 }],
    ['エルフ耳', { earPairsPerHead: 1 }],
    ['猫耳2対', { earPairsPerHead: 2 }],
    ['胸2対', { breasts: 4 }],
    ['貧乳', { breasts: 0 }],
    ['ぺたんこ', { breasts: 0 }],
    ['脚4本', { legs: 4 }],
    ['脚が3本', { legs: 3 }],
    ['脚2対', { legs: 4 }],
    ['六本足', { legs: 6 }],
    ['上半身2つ', { torsos: 2 }],
    ['ケンタウロス', { legs: 4 }],
    ['半人半馬', { legs: 4 }],
    ['ヒューマンタウロス', { legs: 4 }],
    ['アラクネ', { legs: 8 }],
    ['蜘蛛', { legs: 8 }],
    ['阿修羅', { heads: 3, armPairs: 3 }],
    ['複数の尻尾', { tails: 3 }],
    ['たくさんの腕', { armPairs: 2 }],
    ['頭2つ 腕4本 尻尾9本', { heads: 2, armPairs: 2, tails: 9 }],
    ['頭が3つ、腕が6本、尻尾が3本', { heads: 3, armPairs: 3, tails: 3 }],
    ['陰茎3本', { penises: 3 }],
  ])('「%s」', (text, counts) => {
    expect(diff(text)).toEqual(counts);
  });

  it('没有就是 0', () => {
    for (const text of ['尻尾なし', '尻尾がない', 'しっぽ無し', '尻尾は無い']) {
      const r = parseDescription(text);
      expect(r.counts.tails, text).toBe(0);
      expect(r.hits.has('tails'), text).toBe(true);
    }
    expect(parseDescription('翼なし、角がない').hits.size).toBe(2);
  });

  it('片假名和平假名是一回事，全角数字也行', () => {
    expect(diff('ねこみみ')).toEqual(diff('ネコミミ'));
    expect(diff('頭２つ、腕４本')).toEqual({ heads: 2, armPairs: 2 });
    expect(diff('頭2ツ')).toEqual({ heads: 2 });
    expect(parseDescription('ケンタウロス').legLayout).toBe('taur');
    expect(parseDescription('けんたうろす').legLayout).toBe('taur');
  });

  it('下身形态和排布', () => {
    expect(parseDescription('ケンタウロスの下半身').legLayout).toBe('taur');
    expect(parseDescription('アラクネの下半身').legLayout).toBe('spider');
    expect(parseDescription('ヒューマンタウロスの下半身').legLayout).toBe('humantaur');
    expect(parseDescription('脚6本、脚を前後に並べる').legLayout).toBe('tandem');
    expect(parseDescription('脚6本、脚を左右に並べる').legLayout).toBe('row');
    expect(parseDescription('脚6本、脚を腰に集める').legLayout).toBe('gather');
    expect(parseDescription('脚4対、腰を横に並べる').legLayout).toBe('abreast');
    // 界面上「胯」是「骨盤」：按钮名照抄进来也认
    expect(parseDescription('脚6本、脚を骨盤に集める').legLayout).toBe('gather');
    expect(parseDescription('脚4対、骨盤横並び').legLayout).toBe('abreast');
    expect(parseDescription('脚3対、ヒューマンタウロスの下半身、骨盤ごとに脚3本')).toMatchObject({ legLayout: 'humantaur', hipLegs: 3 });
    expect(parseDescription('腕3対、腕を肩に集める').armLayout).toBe('fan');
    expect(parseDescription('腕3対、腕を上下に並べる').armLayout).toBe('stack');
    expect(parseDescription('頭2つ、幅広の胴').headLayout).toBe('wide');
    expect(parseDescription('顔3つ').headLayout).toBe('faces');
    expect(parseDescription('頭3つ').headLayout).toBe('cluster');
    // 肩に集める腕と腰に集める脚、各管各的
    expect(parseDescription('腕3対、腕を肩に集める、脚6本、脚を腰に集める')).toMatchObject({ armLayout: 'fan', legLayout: 'gather' });
  });

  it('每副胯几条腿', () => {
    expect(parseDescription('脚3対、ヒューマンタウロスの下半身、腰ごとに脚3本')).toMatchObject({
      legLayout: 'humantaur',
      hipLegs: 3,
      counts: { legs: 6 },
    });
    // 前3後3 和中文的「前三后三」一样
    expect(parseDescription('前3後3')).toMatchObject({ legLayout: 'humantaur', hipLegs: 3, counts: { legs: 6 } });
  });

  it('阴茎的排法、每排几根、阴囊', () => {
    expect(parseDescription('陰茎6本、陰茎は段ごとに3本')).toMatchObject({ penisLayout: 'grid', penisRow: 3, counts: { penises: 6 } });
    expect(parseDescription('陰茎6本、陰茎を2本ずつ')).toMatchObject({ penisLayout: 'grid', penisRow: 2, counts: { penises: 6 } });
    expect(parseDescription('陰茎3本、陰茎を上下に重ねる').penisLayout).toBe('stack');
    expect(parseDescription('陰茎3本、陰茎を扇形に広げる').penisLayout).toBe('fan');
    expect(parseDescription('陰茎3本、陰茎ごとに陰嚢').scrotum).toBe('each');
    expect(parseDescription('陰茎3本').scrotum).toBe('shared');
  });

  it('性别、姿势、头身比、身高', () => {
    for (const [text, gender] of [['男性', 'male'], ['少年', 'male'], ['男の子', 'male'], ['女性', 'female'], ['少女', 'female'], ['女の子', 'female']] as const) {
      expect(parseDescription(text).gender, text).toBe(gender);
    }
    expect(parseDescription('Tポーズ').pose).toBe('T');
    expect(parseDescription('Aポーズ').pose).toBe('A');
    expect(parseDescription('腕を水平に広げる').pose).toBe('T');
    expect(parseDescription('両腕を自然に下ろす').pose).toBe('A');
    // 姿势里的「両腕」不是一对手臂
    expect(diff('腕3対、両腕を水平に')).toEqual({ armPairs: 3 });
    expect(parseDescription('八頭身').shape.headRatio).toBe(8);
    expect(parseDescription('7.5頭身').shape.headRatio).toBe(7.5);
    expect(parseDescription('身長165').shape.height).toBe(1.65);
    expect(parseDescription('身長は165センチ').shape.height).toBe(1.65);
    expect(parseDescription('身長1.7メートル').shape.height).toBe(1.7);
    expect(parseDescription('170cm').shape.height).toBe(1.7);
    expect(diff('身長165、八頭身、頭2つ')).toEqual({ heads: 2 });
  });

  it('发型和发色', () => {
    expect(parseDescription('ツインテール').hair.style).toBe('twintails');
    expect(parseDescription('ツインテ').hair.style).toBe('twintails');
    expect(parseDescription('ポニーテール').hair.style).toBe('sidetail');
    expect(parseDescription('ロング').hair.style).toBe('long');
    expect(parseDescription('ボブ').hair.style).toBe('bob');
    expect(parseDescription('短髪').hair.style).toBe('bob');
    expect(parseDescription('金髪').hair.color).toBe('#e8cf7a');
    expect(parseDescription('銀髪').hair.color).toBe('#d5dbe6');
    expect(parseDescription('黒髪ロング').hair).toEqual({ style: 'long', color: '#23222a' });
    expect(parseDescription('ピンクの髪').hair.color).toBe('#f0a3bd');
    expect(parseDescription('金色の髪').hair.color).toBe('#e8cf7a');
    expect(parseDescription('ブロンドヘア').hair.color).toBe('#e8cf7a');
    // 饰品不是发色
    expect(parseDescription('ピンクのヘアバンド').hair).toEqual({});
    expect(diff('金髪ツインテール、九尾')).toEqual({ tails: 9 });
  });
});

describe('不误伤中文', () => {
  it('「手腕」是腕部，不是日文的「腕」（手臂）', () => {
    for (const text of ['手腕', '手腕上戴着手表', '她的手腕很细', '左手腕', '腕表', '腕力']) {
      const r = parseDescription(text);
      expect(diffCounts(r.counts), text).toEqual({});
    }
  });

  it('「每个头两对耳朵」「头两只角」里的数字属于后面的部件，不是头的数量', () => {
    expect(diff('每个头两对耳朵')).toEqual({ earPairsPerHead: 2 });
    expect(diff('每个头两只角，每个头三只眼睛')).toEqual({ hornsPerHead: 2, eyesPerHead: 3 });
    expect(diff('头顶两只角')).toEqual({ hornsPerHead: 2 });
    expect(diff('两个头四只手')).toEqual({ heads: 2, armPairs: 2 });
    expect(diff('一对角，三条腿')).toEqual({ hornsPerHead: 2, legs: 3 });
  });

  it('中文的词表也认日文的字形（逐字并进简体）', () => {
    expect(diff('三頭六臂')).toEqual({ heads: 3, armPairs: 3 });
    expect(diff('両腕')).toEqual({});
    expect(parseDescription('龍娘')).toMatchObject({ counts: { hornsPerHead: 2, wingPairs: 1, tails: 1 } });
    expect(parseDescription('竜娘')).toMatchObject({ counts: { hornsPerHead: 2, wingPairs: 1, tails: 1 } });
    expect(parseDescription('獣耳娘').counts.earPairsPerHead).toBe(1);
  });

  it('中文的数字和量词照旧', () => {
    expect(diff('两个头，三对手臂，九条尾巴')).toEqual({ heads: 2, armPairs: 3, tails: 9 });
    expect(diff('六条腿，每副胯三条腿')).toEqual({ legs: 6 });
    expect(parseDescription('身高 170，八头身').shape).toEqual({ height: 1.7, headRatio: 8 });
  });
});

describe('中、英、日混着写', () => {
  it.each<[string, Partial<Record<CountKey, number>>]>([
    ['two heads, 腕4本', { heads: 2, armPairs: 2 }],
    ['2 heads，三对手臂，尻尾9本', { heads: 2, armPairs: 3, tails: 9 }],
    ['两个头, four arms, 翼3対', { heads: 2, armPairs: 2, wingPairs: 3 }],
    ['九尾 flat chest 角2本', { tails: 9, breasts: 0, hornsPerHead: 2 }],
    ['ケンタウロス、six legs', { legs: 6 }],
    ['centaur 脚6本', { legs: 6 }],
    ['阿修羅，2 pairs of arms', { heads: 3, armPairs: 2 }],
    ['nine tails，目3つ，两对翅膀', { tails: 9, eyesPerHead: 3, wingPairs: 2 }],
  ])('「%s」', (text, counts) => {
    expect(diff(text)).toEqual(counts);
  });

  it('混着写的排布、性别、姿势、身高', () => {
    const r = parseDescription('男性, 八頭身, height 175, Tポーズ, 三对手臂 arms gathered at the shoulders, 腰を横に並べる, 脚4対');
    expect(r).toMatchObject({ gender: 'male', pose: 'T', armLayout: 'fan', legLayout: 'abreast', shape: { height: 1.75, headRatio: 8 }, counts: { armPairs: 3, legs: 8 } });
  });
});

describe('识别片段与档位', () => {
  it('档位：中文、日文带数字的是 number，英文带数字的是 tag，关键词是 keyword，身高头身比是 measure', () => {
    const tier = (text: string) => parseDescription(text).matches.map((m) => `${m.text}:${m.tier}`);
    expect(tier('腕4本')).toEqual(['腕4本:number']);
    expect(tier('頭が2つ')).toEqual(['頭が2つ:number']);
    expect(tier('尻尾なし')).toEqual(['尻尾なし:number']);
    expect(tier('4 arms')).toEqual(['4 arms:tag']);
    expect(tier('two heads')).toEqual(['two heads:tag']);
    expect(tier('ケンタウロス')).toEqual(['ケンタウロス:keyword']);
    expect(tier('centaur')).toEqual(['centaur:keyword']);
    expect(tier('猫耳')).toEqual(['猫耳:keyword']);
    expect(tier('Tポーズ')).toEqual(['Tポーズ:keyword']);
    expect(tier('身長165')).toEqual(['身長165:measure']);
    expect(tier('八頭身')).toEqual(['八頭身:measure']);
    expect(tier('8 heads tall')).toEqual(['8 heads tall:measure']);
    expect(tier('height 165')).toEqual(['height 165:measure']);
  });

  it('下标对得回原文：全角、片假名转平假名、新字体都不改变长度', () => {
    const text = '頭２つ、ネコミミ、腕4本，Four Arms，身長１６５センチ，金髪';
    const r = parseDescription(text);
    expect(r.matches.map((m) => m.text)).toEqual(['頭２つ', 'ネコミミ', '腕4本', 'Four Arms', '身長１６５センチ', '金髪']);
    for (const m of r.matches) expect(text.slice(m.start, m.end)).toBe(m.text);
    expect(normalizeText(text).length).toBe(text.length);
    expect(normalizeText('ネコミミ')).toBe('ねこみみ');
    expect(normalizeText('髪・獣・竜・対')).toBe('发・兽・龙・对');
  });

  it('重叠的写法只记一次（中文的词表和日文的词表认出同一段时）', () => {
    const r = parseDescription('2つの頭、3対の翼、猫耳');
    expect(r.matches.map((m) => m.text)).toEqual(['2つの頭', '3対の翼', '猫耳']);
    expect(hitsOf(r)).toEqual(['earPairsPerHead', 'heads', 'wingPairs']);
  });
});

/** 译文文件（src/i18n/<lang>/*.json）合在一起 */
function dict(lang: 'en' | 'ja'): Record<string, string> {
  const files = import.meta.glob<Record<string, string>>('../src/i18n/*/*.json', { eager: true, import: 'default' });
  const out: Record<string, string> = {};
  for (const [path, data] of Object.entries(files)) if (path.includes(`/i18n/${lang}/`)) Object.assign(out, data);
  return out;
}

describe('界面译文跟解析器对得上', () => {
  const START = '两个头，两对手，两对胸';

  it('默认描述的英文、日文译文解析出来和中文一样', () => {
    const want = fields(START);
    for (const lang of OTHER) {
      const text = dict(lang)[START];
      expect(text, `${lang} 缺默认描述的译文`).toBeTruthy();
      expect(fields(text), text).toEqual(want);
    }
    // 规范描述（带腿）也一样
    const spec = applyParse(defaultSpec(), parseDescription(START));
    for (const lang of OTHER) expect(fields(describeSpec(spec, lang))).toEqual(want);
  });

  it('「能认哪些写法」说明里举的 <code> 例子，解析器真的认', () => {
    for (const lang of OTHER) {
      const d = dict(lang);
      const note = d[Object.keys(d).find((k) => k.startsWith('头、手 / 臂、胸、腿 / 脚'))!];
      const samples = [...note.matchAll(/<code>(.*?)<\/code>/g)].map((m) => m[1]);
      expect(samples.length, lang).toBeGreaterThan(8);
      for (const sample of samples) expect(parseDescription(sample).matches.length, `${lang}: ${sample}`).toBeGreaterThan(0);
    }
  });

  it('图例的四档都有译文', () => {
    for (const lang of OTHER) {
      const d = dict(lang);
      for (const key of ['中文带数字的描述', '英文标签', '关键词', '身高 / 头身比', '能认哪些写法']) expect(d[key], `${lang}: ${key}`).toBeTruthy();
    }
  });

  it('语言表里有这三种', () => {
    expect(LANGS.map((l) => l.key)).toEqual(['zh', 'en', 'ja']);
  });
});

describe('每个上半身单独设：英文、日文', () => {
  it('规范描述的样子', () => {
    const spec = { ...withCounts({ torsos: 2 }), torsoCounts: { L: { heads: 2, armPairs: 0 } } };
    expect(describeSpec(spec, 'en')).toBe('2 upper bodies, 1 head, 1 pair of arms, 1 pair of breasts, 1 pair of legs, left upper body with 2 heads and no arms');
    expect(describeSpec(spec, 'ja')).toBe('上半身2つ、頭1つ、腕1対、胸1対、脚1対、左の上半身は頭2つと腕なし');
  });

  it('300 个随机组合往返一致，读出来和中文一样', () => {
    const rand = rng(20261104);
    for (let i = 0; i < 300; i++) {
      const torsos = 2 + Math.floor(rand() * 2);
      const counts = { ...defaultCounts(), torsos, heads: 1 + Math.floor(rand() * 3), hornsPerHead: Math.floor(rand() * 3), earPairsPerHead: Math.floor(rand() * 2) };
      const torsoCounts: TorsoCounts = {};
      for (const side of torsoSides(torsos)) {
        if (rand() < 0.3) continue;
        const own: Partial<Record<(typeof PER_TORSO_KEYS)[number], number>> = {};
        for (const key of PER_TORSO_KEYS) {
          if (rand() < 0.5) continue;
          const d = COUNT_DEFS.find((x) => x.key === key)!;
          own[key] = d.min + Math.floor(rand() * (Math.min(d.max, 4) - d.min + 1));
        }
        torsoCounts[side] = own;
      }
      // 一个头几张脸要整个身体也是几张脸才读得回来（只有某个上半身几张脸时，中文也读成几个头）
      const faces = counts.heads > 1 && rand() < 0.3;
      const spec = { ...defaultSpec(), counts, torsoCounts, headLayout: faces ? ('faces' as const) : ('cluster' as const), earShape: EAR_SHAPES[i % EAR_SHAPES.length] };
      expectRoundTripAll(spec);
      // 读回来的就是和「全部一样」不同的那几样
      const want: TorsoCounts = {};
      for (const side of torsoSides(torsos)) {
        const own = Object.fromEntries(PER_TORSO_KEYS.filter((k) => (torsoCounts[side]?.[k] ?? counts[k]) !== counts[k]).map((k) => [k, torsoCounts[side]![k]]));
        if (Object.keys(own).length) want[side] = own;
      }
      for (const lang of LANGS) expect(parseDescription(describeSpec(spec, lang.key)).torsoCounts, describeSpec(spec, lang.key)).toEqual(want);
    }
  });

  it.each<[string, TorsoCounts]>([
    ['2 upper bodies, left torso: 3 heads, right upper body has no arms', { L: { heads: 3 }, R: { armPairs: 0 } }],
    ['three upper bodies, center upper body with 2 pairs of breasts', { M: { breasts: 4 } }],
    ['3 torsos, middle torso with 4 horns per head and 3 eyes per head', { M: { hornsPerHead: 4, eyesPerHead: 3 } }],
    ['上半身2つ、右側の上半身は腕3対と角2本', { R: { armPairs: 3, hornsPerHead: 2 } }],
    ['上半身3つ、真ん中の上半身に頭2つ', { M: { heads: 2 } }],
    ['上半身2つ、左の上半身は胸なし', { L: { breasts: 0 } }],
    ['两个上半身，left upper body with 2 heads，右の上半身は腕2対', { L: { heads: 2 }, R: { armPairs: 2 } }],
  ])('%s', (text, want) => {
    const r = parseDescription(text);
    expect(r.torsoCounts).toEqual(want);
    // 单独设的数量不算到整个身体上
    expect(r.counts.heads).toBe(1);
    expect(r.counts.armPairs).toBe(1);
  });
});
