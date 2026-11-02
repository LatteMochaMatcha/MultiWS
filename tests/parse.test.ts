import { describe, expect, it } from 'vitest';
import { type BodyCounts, type CountKey, resolveLegForm } from '../src/model/spec';
import { normalizeText, parseDescription } from '../src/parser';
import { diff, diffCounts, hitsOf } from './helpers';

type Expected = Partial<BodyCounts>;

describe('需求里点名的输入', () => {
  const cases: [string, Expected, CountKey[]][] = [
    ['两个头，两对手，两对胸', { heads: 2, armPairs: 2, chestPairs: 2 }, ['heads', 'armPairs', 'chestPairs']],
    ['三头六臂', { heads: 3, armPairs: 3 }, ['heads', 'armPairs']],
    [
      '九尾狐，一对角',
      { tails: 9, hornsPerHead: 2, earPairsPerHead: 1 },
      ['tails', 'hornsPerHead', 'earPairsPerHead'],
    ],
    ['四条腿', { legs: 4 }, ['legs']],
    ['八条腿，没有尾巴', { legs: 8 }, ['legs', 'tails']],
    ['六翼天使 平胸', { wingPairs: 3, chestPairs: 0 }, ['wingPairs', 'chestPairs']],
    ['第三只眼', { eyesPerHead: 3 }, ['eyesPerHead']],
    [
      'four_arms multiple_tails two-headed',
      { armPairs: 2, tails: 3, heads: 2 },
      ['armPairs', 'tails', 'heads'],
    ],
    ['两对巨大的翅膀', { wingPairs: 2 }, ['wingPairs']],
    ['每个头两只角，每个头三只眼睛', { hornsPerHead: 2, eyesPerHead: 3 }, ['hornsPerHead', 'eyesPerHead']],
    ['4 arms, 3 heads', { armPairs: 2, heads: 3 }, ['armPairs', 'heads']],
    ['阿修罗', { heads: 3, armPairs: 3 }, ['heads', 'armPairs']],
  ];

  it.each(cases)('「%s」', (text, counts, hits) => {
    const r = parseDescription(text);
    expect(diffCounts(r.counts)).toEqual(counts);
    expect(hitsOf(r)).toEqual([...hits].sort());
  });

  it('「阿修罗」「三头六臂」手臂都在肩部聚拢', () => {
    expect(parseDescription('阿修罗').armLayout).toBe('fan');
    expect(parseDescription('三头六臂').armLayout).toBe('fan');
    expect(parseDescription('三頭六臂的战神').armLayout).toBe('fan');
    expect(parseDescription('三头八臂').armLayout).toBe('fan');
    expect(diff('三头八臂')).toEqual({ heads: 3, armPairs: 4 });
  });

  it('「三面六臂」「三张脸」「阿修罗」是一个头上几张脸；「三头六臂」「三个头」是凑成一簇的三个头', () => {
    const faces: [string, Expected][] = [
      ['阿修罗', { heads: 3, armPairs: 3 }],
      ['三面六臂', { heads: 3, armPairs: 3 }],
      ['三面八臂的战神', { heads: 3, armPairs: 4 }],
      ['三张脸', { heads: 3 }],
      ['一个头上长着两张脸', { heads: 2 }],
      ['四面佛', { heads: 4 }],
      ['双面人', { heads: 2 }],
      ['多张脸', { heads: 2 }],
      ['three faces', { heads: 3 }],
      ['two-faced', { heads: 2 }],
      ['multiple_faces', { heads: 2 }],
      ['asura', { heads: 3, armPairs: 3 }],
      ['janus', { heads: 2 }],
    ];
    for (const [text, counts] of faces) {
      const r = parseDescription(text);
      expect(r.headLayout, text).toBe('faces');
      expect(diffCounts(r.counts), text).toEqual(counts);
      expect(r.hits.has('heads'), text).toBe(true);
    }
    for (const text of ['', '三头六臂', '三个头', '两个头，两对手，两对胸', 'two-headed', '3 heads', '双头', '地狱犬', '连体双胞胎', '一张脸']) {
      expect(parseDescription(text).headLayout, text).toBe('cluster');
    }
    // 「三面六臂」和「三头六臂」一样，手臂在肩部聚拢
    expect(parseDescription('三面六臂').armLayout).toBe('fan');
    // 关键词带出来的排法，明说了「几个头」就听明说的；明说「几张脸」也一样
    expect(parseDescription('阿修罗，三个头').headLayout).toBe('cluster');
    expect(parseDescription('地狱犬，三张脸').headLayout).toBe('faces');
    expect(diff('阿修罗，四张脸')).toEqual({ heads: 4, armPairs: 3 });
  });

  it('带「面」「脸」的别的说法不会被读成几张脸', () => {
    for (const text of ['三面环山', '两面性', '脸红', '圆脸', '没有脸', '面无表情', '四面八方', '一面镜子', 'close-up face', 'no face', 'hand on own face']) {
      const r = parseDescription(text);
      expect(r.headLayout, text).toBe('cluster');
      expect(r.counts.heads, text).toBe(1);
    }
  });

  it('分开写的「三个头，六条手臂」仍然上下排；明说上下排时听明说的', () => {
    expect(parseDescription('三个头，六条手臂').armLayout).toBe('stack');
    expect(parseDescription('三个头，三对手臂').armLayout).toBe('stack');
    expect(parseDescription('三头六臂，手臂上下排列').armLayout).toBe('stack');
  });

  it('「九尾狐」带狐耳，不带角；角要另外写', () => {
    expect(diff('九尾狐')).toEqual({ tails: 9, earPairsPerHead: 1 });
    expect(parseDescription('九尾狐').counts.hornsPerHead).toBe(0);
    expect(parseDescription('九尾狐，一对角').earShape).toBe('fox');
  });

  it('四条腿是人马下身，八条腿是蛛形下身', () => {
    const four = parseDescription('四条腿');
    const eight = parseDescription('八条腿，没有尾巴');
    expect(resolveLegForm(four.counts.legs, four.legLayout)).toBe('taur');
    expect(resolveLegForm(eight.counts.legs, eight.legLayout)).toBe('spider');
    // 单数条腿自动是左右并排；一条腿是单足
    expect(resolveLegForm(3, 'auto')).toBe('row');
    expect(resolveLegForm(1, 'auto')).toBe('biped');
  });

  it('阴茎：中文、英文标签、排法和阴囊', () => {
    const read = (text: string) => {
      const r = parseDescription(text);
      return [r.counts.penises, r.penisLayout, r.scrotum];
    };
    expect(read('两根阴茎')).toEqual([2, 'row', 'shared']);
    expect(read('双阴茎')).toEqual([2, 'row', 'shared']);
    expect(read('多根肉棒')).toEqual([2, 'row', 'shared']);
    expect(read('阳具')).toEqual([1, 'row', 'shared']);
    expect(read('三根阴茎上下叠')).toEqual([3, 'stack', 'shared']);
    expect(read('四根阴茎扇形散开，每根各带阴囊')).toEqual([4, 'fan', 'each']);
    expect(read('两根阴茎，两个阴囊')).toEqual([2, 'row', 'each']);
    expect(read('2_penises, stacked penises')).toEqual([2, 'stack', 'shared']);
    expect(read('multiple_penises')).toEqual([2, 'row', 'shared']);
    expect(read('penis')).toEqual([1, 'row', 'shared']);
    // 没提到的时候
    expect(read('两个头，两对手，扇形聚拢')).toEqual([0, 'row', 'shared']);
  });

  it('没写到的部件保持默认', () => {
    expect(parseDescription('').counts).toEqual({
      torsos: 1,
      heads: 1,
      armPairs: 1,
      chestPairs: 1,
      legs: 2,
      tails: 0,
      wingPairs: 0,
      hornsPerHead: 0,
      eyesPerHead: 2,
      earPairsPerHead: 0,
      penises: 0,
    });
    expect(parseDescription('').hits.size).toBe(0);
  });
});

describe('中文数字与量词', () => {
  it.each<[string, Expected]>([
    // 成对的部件：给「对」直接用，给个数则 ceil(n / 2)
    ['两只手', {}],
    ['四只手', { armPairs: 2 }],
    ['五只手', { armPairs: 3 }],
    ['三条腿', { legs: 3 }],
    ['一条腿', { legs: 1 }],
    ['两对腿', { legs: 4 }],
    ['五只脚', { legs: 5 }],
    ['六条腿', { legs: 6 }],
    ['一双翅膀', { wingPairs: 1 }],
    ['两副翅膀', { wingPairs: 2 }],
    ['四片翅膀', { wingPairs: 2 }],
    ['三对胸', { chestPairs: 3 }],
    ['四个乳房', { chestPairs: 2 }],
    // 按个数算的部件：给「对」则乘 2
    ['一对角', { hornsPerHead: 2 }],
    ['两对眼睛', { eyesPerHead: 4 }],
    ['三颗头', { heads: 3 }],
    ['两个脑袋', { heads: 2 }],
    ['五条尾巴', { tails: 5 }],
    ['三根尾巴', { tails: 3 }],
    // 数字的各种写法
    ['俩头', { heads: 2 }],
    ['2个头', { heads: 2 }],
    ['２个头', { heads: 2 }],
    ['兩個頭，三對手臂', { heads: 2, armPairs: 3 }],
    ['九条尾巴', { tails: 9 }],
    // 没有量词
    ['三头', { heads: 3 }],
    ['四臂', { armPairs: 2 }],
    ['六足', { legs: 6 }],
    ['三眼', { eyesPerHead: 3 }],
    // 「双」当「两个」
    ['双头', { heads: 2 }],
    ['双尾', { tails: 2 }],
    ['双翼', { wingPairs: 1 }],
    ['双角', { hornsPerHead: 2 }],
  ])('「%s」', (text, counts) => {
    expect(diff(text)).toEqual(counts);
  });

  it.each<[string, Expected, CountKey]>([
    ['没有手臂', { armPairs: 0 }, 'armPairs'],
    ['无尾', {}, 'tails'],
    ['没有尾巴', {}, 'tails'],
    ['不长角', {}, 'hornsPerHead'],
    ['零条尾巴', {}, 'tails'],
    ['一对翅膀，去掉翅膀', {}, 'wingPairs'],
  ])('「%s」表示 0 个', (text, counts, key) => {
    const r = parseDescription(text);
    expect(diffCounts(r.counts)).toEqual(counts);
    expect(r.counts[key]).toBe(0);
    expect(r.hits.has(key)).toBe(true);
  });

  it.each<[string, Expected]>([
    ['二十条尾巴', { tails: 9 }],
    ['12条尾巴', { tails: 9 }],
    ['十个头', { heads: 5 }],
    ['九对翅膀', { wingPairs: 3 }],
    ['100 arms', { armPairs: 4 }],
    ['八只角', { hornsPerHead: 4 }],
  ])('超出上限时收到上限：「%s」', (text, counts) => {
    expect(diff(text)).toEqual(counts);
  });

  it.each(['没有头', '没有腿', '零个头', 'no_eyes', 'no legs'])('低于下限的说法不采纳：「%s」', (text) => {
    const r = parseDescription(text);
    expect(diffCounts(r.counts)).toEqual({});
    expect(r.hits.size).toBe(0);
  });
});

describe('数字和部件之间的修饰语', () => {
  it.each<[string, Expected]>([
    ['两对巨大的翅膀', { wingPairs: 2 }],
    ['三条毛茸茸的尾巴', { tails: 3 }],
    ['四只纤细的手臂', { armPairs: 2 }],
    ['两个可爱的头', { heads: 2 }],
    ['两只弯曲的角', { hornsPerHead: 2 }],
    ['六只红色的眼睛', { eyesPerHead: 6 }],
  ])('「%s」', (text, counts) => {
    expect(diff(text)).toEqual(counts);
  });

  it('最多 4 个字，再长就不算带数字的描述', () => {
    // 认不出「两对」，但「翅膀」本身仍然说明有翅膀
    expect(diff('两对非常巨大的翅膀')).toEqual({ wingPairs: 1 });
  });

  it('不会跨过标点或连词去找部件', () => {
    expect(diff('两个头，翅膀')).toEqual({ heads: 2, wingPairs: 1 });
    expect(diff('三个头和尾巴')).toEqual({ heads: 3, tails: 1 });
  });
});

describe('关键词', () => {
  it.each<[string, Expected]>([
    ['平胸', { chestPairs: 0 }],
    ['无胸', { chestPairs: 0 }],
    ['半人马', { legs: 4 }],
    ['人马', { legs: 4 }],
    ['蜘蛛女', { legs: 8 }],
    ['蛛女', { legs: 8 }],
    ['九尾', { tails: 9 }],
    ['六翼', { wingPairs: 3 }],
    ['独角', { hornsPerHead: 1 }],
    ['独眼', { eyesPerHead: 1 }],
    ['千手观音', { armPairs: 4 }],
    ['地狱犬', { heads: 3 }],
    ['连体双胞胎', { heads: 2 }],
    ['复乳', { chestPairs: 2 }],
    ['多腕', { armPairs: 2 }],
    ['天使', { wingPairs: 1 }],
    ['龙娘', { hornsPerHead: 2, wingPairs: 1, tails: 1 }],
    ['魅魔', { hornsPerHead: 2, wingPairs: 1, tails: 1 }],
    ['独角龙娘', { hornsPerHead: 1, wingPairs: 1, tails: 1 }],
    ['猫娘', { earPairsPerHead: 1, tails: 1 }],
    ['猫又', { earPairsPerHead: 1, tails: 2 }],
    ['狐娘', { earPairsPerHead: 1, tails: 1 }],
    ['兔女郎', { earPairsPerHead: 1 }],
    ['精灵', { earPairsPerHead: 1 }],
    ['兽耳娘', { earPairsPerHead: 1, tails: 1 }],
  ])('「%s」', (text, counts) => {
    expect(diff(text)).toEqual(counts);
  });

  it('下身形态跟着关键词走', () => {
    expect(parseDescription('半人马').legLayout).toBe('taur');
    expect(parseDescription('蜘蛛女').legLayout).toBe('spider');
    expect(parseDescription('四条腿').legLayout).toBe('auto');
  });

  it('humantaur（人腿人马）：两对人腿，身后是人的腰和胯，不是马身', () => {
    for (const text of ['humantaur', 'Humantaur', 'human_taur', 'human-taur', 'human taur', 'humantaurs', '人腿人马', '人身人马', '人足人马', '1girl, humantaur, skirt']) {
      const r = parseDescription(text);
      expect(r.legLayout, text).toBe('humantaur');
      expect(r.counts.legs, text).toBe(4);
      expect(r.hits.has('legs'), text).toBe(true);
    }
    // 腿的对数另外写了就听写的
    expect(parseDescription('humantaur 六条腿')).toMatchObject({ legLayout: 'humantaur', counts: { legs: 6 } });
    expect(parseDescription('三对腿，人腿人马下身')).toMatchObject({ legLayout: 'humantaur', counts: { legs: 6 } });
    // 每副胯几条腿：「每副胯三条腿」「前三后三」
    expect(parseDescription('人腿人马，六条腿，每副胯三条腿')).toMatchObject({ legLayout: 'humantaur', hipLegs: 3, counts: { legs: 6 } });
    expect(parseDescription('人腿人马 前三后三')).toMatchObject({ legLayout: 'humantaur', hipLegs: 3, counts: { legs: 6 } });
    expect(parseDescription('前三后三')).toMatchObject({ legLayout: 'humantaur', hipLegs: 3, counts: { legs: 6 } });
    expect(parseDescription('前三条后两条腿')).toMatchObject({ legLayout: 'humantaur', hipLegs: 3, counts: { legs: 5 } });
    expect(parseDescription('前二后一，腿前后串联')).toMatchObject({ legLayout: 'tandem', counts: { legs: 3 } });
    expect(parseDescription('前三后三，腿前后串联')).toMatchObject({ legLayout: 'tandem', hipLegs: 3, counts: { legs: 6 } });
    // 没说就是一对
    expect(parseDescription('人腿人马').hipLegs).toBe(2);
    // 别的「人马」「taur」还是马身
    for (const text of ['半人马', '人马', 'centaur', 'taur', '马身']) expect(parseDescription(text).legLayout, text).toBe('taur');
    // 明说了人腿怎么排就听明说的
    expect(parseDescription('humantaur，腿左右并排').legLayout).toBe('row');
  });

  it('千手也是肩部聚拢', () => {
    expect(parseDescription('千手观音').armLayout).toBe('fan');
  });
});

describe('不带数字的「多 X」', () => {
  it.each<[string, Expected]>([
    ['多头', { heads: 2 }],
    ['多臂', { armPairs: 2 }],
    ['多乳', { chestPairs: 2 }],
    ['多足', { legs: 4 }],
    ['多尾', { tails: 3 }],
    ['多翼', { wingPairs: 2 }],
    ['多眼', { eyesPerHead: 3 }],
    ['很多条尾巴', { tails: 3 }],
    ['好几只手', { armPairs: 2 }],
    ['无数只眼睛', { eyesPerHead: 3 }],
    ['尾巴', { tails: 1 }],
    ['狐尾', { tails: 1 }],
    ['翅膀', { wingPairs: 1 }],
    ['龙角', { hornsPerHead: 2 }],
    ['头上长角', { hornsPerHead: 2 }],
  ])('「%s」', (text, counts) => {
    expect(diff(text)).toEqual(counts);
  });
});

describe('英文标签（Danbooru / e621 风格）', () => {
  it.each<[string, Expected]>([
    // 多 X
    ['multiple_heads', { heads: 2 }],
    ['multiple_arms', { armPairs: 2 }],
    ['extra_arms', { armPairs: 2 }],
    ['multiple_legs', { legs: 4 }],
    ['extra_legs', { legs: 4 }],
    ['multiple_breasts', { chestPairs: 2 }],
    ['extra_breasts', { chestPairs: 2 }],
    ['multiple_tails', { tails: 3 }],
    ['multiple_wings', { wingPairs: 2 }],
    ['multiple_horns', { hornsPerHead: 4 }],
    ['extra_eyes', { eyesPerHead: 3 }],
    ['multiple_eyes', { eyesPerHead: 3 }],
    ['extra_ears', { earPairsPerHead: 1 }],
    ['multi_arm', { armPairs: 2 }],
    ['multi_tail', { tails: 3 }],
    ['multi_limb', { armPairs: 2 }],
    ['multi_head', { heads: 2 }],
    ['multi_breast', { chestPairs: 2 }],
    ['multi_wing', { wingPairs: 2 }],
    ['multi_eye', { eyesPerHead: 3 }],
    ['multi_leg', { legs: 4 }],
    // 带数字
    ['two-headed', { heads: 2 }],
    ['two_heads', { heads: 2 }],
    ['2_heads', { heads: 2 }],
    ['three-headed', { heads: 3 }],
    ['four_arms', { armPairs: 2 }],
    ['4_arms', { armPairs: 2 }],
    ['six_arms', { armPairs: 3 }],
    ['six-armed', { armPairs: 3 }],
    ['eight_arms', { armPairs: 4 }],
    ['four_breasts', { chestPairs: 2 }],
    ['6_breasts', { chestPairs: 3 }],
    ['four_legs', { legs: 4 }],
    ['four-legged', { legs: 4 }],
    ['six_legs', { legs: 6 }],
    ['eight_legs', { legs: 8 }],
    ['two_tails', { tails: 2 }],
    ['nine_tails', { tails: 9 }],
    ['nine-tailed fox', { tails: 9 }],
    ['two fox tails', { tails: 2 }],
    ['two_fox_tails', { tails: 2 }],
    ['four_wings', { wingPairs: 2 }],
    ['six_wings', { wingPairs: 3 }],
    ['six-winged', { wingPairs: 3 }],
    ['three_eyes', { eyesPerHead: 3 }],
    ['three-eyed', { eyesPerHead: 3 }],
    ['four_eyes', { eyesPerHead: 4 }],
    ['one-eyed', { eyesPerHead: 1 }],
    ['single_horn', { hornsPerHead: 1 }],
    ['four_horns', { hornsPerHead: 4 }],
    ['no_tail', {}],
    ['no_arms', { armPairs: 0 }],
    // 按对说
    ['two pairs of arms', { armPairs: 2 }],
    ['three pairs of wings', { wingPairs: 3 }],
    ['a pair of horns', { hornsPerHead: 2 }],
    ['two pairs of large wings', { wingPairs: 2 }],
    // 关键词
    ['third_eye', { eyesPerHead: 3 }],
    ['flat_chest', { chestPairs: 0 }],
    ['centaur', { legs: 4 }],
    ['taur', { legs: 4 }],
    ['arachne', { legs: 8 }],
    ['drider', { legs: 8 }],
    ['spider_girl', { legs: 8 }],
    ['kitsune', { tails: 9, earPairsPerHead: 1 }],
    ['seraph', { wingPairs: 3 }],
    ['asura', { heads: 3, armPairs: 3 }],
    ['cerberus', { heads: 3 }],
    ['conjoined', { heads: 2 }],
    ['cyclops', { eyesPerHead: 1 }],
    ['unicorn', { hornsPerHead: 1 }],
    ['armless', { armPairs: 0 }],
    ['succubus', { hornsPerHead: 2, wingPairs: 1, tails: 1 }],
    ['dragon_girl', { hornsPerHead: 2, wingPairs: 1, tails: 1 }],
    ['angel', { wingPairs: 1 }],
    ['cat_girl', { earPairsPerHead: 1, tails: 1 }],
    ['catgirl', { earPairsPerHead: 1, tails: 1 }],
    ['fox_girl', { earPairsPerHead: 1, tails: 1 }],
    ['bunny_girl', { earPairsPerHead: 1 }],
    ['elf', { earPairsPerHead: 1 }],
    // 不带数字的部件标签
    ['fox_tail', { tails: 1 }],
    ['demon_wings', { wingPairs: 1 }],
    ['angel_wings', { wingPairs: 1 }],
    ['horns', { hornsPerHead: 2 }],
    ['demon_horns', { hornsPerHead: 2 }],
    ['animal_ears', { earPairsPerHead: 1 }],
    ['cat_ears, cat_tail', { earPairsPerHead: 1, tails: 1 }],
    ['pointy_ears', { earPairsPerHead: 1 }],
    // 大小写、全角、整串标签
    ['Four Arms, Multiple Tails', { armPairs: 2, tails: 3 }],
    ['ｆｏｕｒ＿ａｒｍｓ', { armPairs: 2 }],
    ['1girl, solo, four_arms, cat_ears, tail', { armPairs: 2, earPairsPerHead: 1, tails: 1 }],
    ['2girls, long_hair, blue_eyes, smile', {}],
  ])('%s', (text, counts) => {
    expect(diff(text)).toEqual(counts);
  });

  it('no_tail 算作识别到了尾巴', () => {
    expect(parseDescription('no_tail').hits.has('tails')).toBe(true);
  });

  it('下身形态', () => {
    expect(parseDescription('centaur').legLayout).toBe('taur');
    expect(parseDescription('drider').legLayout).toBe('spider');
    expect(parseDescription('asura').armLayout).toBe('fan');
  });
});

describe('优先级：关键词 < 英文标签 < 中文带数字的描述', () => {
  it.each<[string, Expected]>([
    ['阿修罗，两条手臂', { heads: 3 }],
    ['centaur 六条腿', { legs: 6 }],
    ['four_arms 三对手臂', { armPairs: 3 }],
    ['三对手臂 four_arms', { armPairs: 3 }],
    ['kitsune two_tails', { tails: 2, earPairsPerHead: 1 }],
    ['kitsune multiple_tails', { tails: 9, earPairsPerHead: 1 }],
    ['two_tails multiple_tails', { tails: 2 }],
    ['九尾狐 three_tails', { tails: 9, earPairsPerHead: 1 }],
    ['seraph, two_wings', { wingPairs: 1 }],
    ['龙娘，没有翅膀，四只角', { hornsPerHead: 4, tails: 1 }],
    ['蜘蛛女 六条腿', { legs: 6 }],
  ])('「%s」', (text, counts) => {
    expect(diff(text)).toEqual(counts);
  });

  it('同一层里后写的覆盖先写的', () => {
    expect(diff('两个头 三个头')).toEqual({ heads: 3 });
    expect(diff('four_arms six_arms')).toEqual({ armPairs: 3 });
  });

  it('被数字覆盖后，关键词带来的排布仍然保留', () => {
    expect(parseDescription('centaur 六条腿').legLayout).toBe('taur');
    expect(parseDescription('阿修罗，两条手臂').armLayout).toBe('fan');
  });
});

describe('在现有数量上追加', () => {
  it.each<[string, Expected]>([
    ['多一对手臂', { armPairs: 2 }],
    ['额外的两只手', { armPairs: 2 }],
    ['多了一条尾巴', { tails: 1 }],
    ['两对手臂，多一对手臂', { armPairs: 3 }],
    ['多长了一个头', { heads: 2 }],
    ['two extra arms', { armPairs: 2 }],
    ['four extra arms', { armPairs: 3 }],
    ['an extra pair of arms', { armPairs: 2 }],
    ['an extra pair of wings', { wingPairs: 1 }],
  ])('「%s」', (text, counts) => {
    expect(diff(text)).toEqual(counts);
  });
});

describe('排布', () => {
  it.each<[string, 'stack' | 'fan']>([
    ['三对手臂，肩部聚拢', 'fan'],
    ['三对手臂在肩膀处聚拢', 'fan'],
    ['手臂扇形排列', 'fan'],
    ['三对手臂', 'stack'],
    ['阿修罗，手臂上下排列', 'stack'],
    ['手臂沿躯干上下排', 'stack'],
  ])('手臂：「%s」→ %s', (text, layout) => {
    expect(parseDescription(text).armLayout).toBe(layout);
  });

  it.each<[string, string]>([
    ['三对腿前后排列', 'tandem'],
    ['tandem_legs', 'tandem'],
    ['两对腿左右并排', 'row'],
    ['半人马，腿左右并排', 'row'],
    ['两对腿，人马下身', 'taur'],
    ['两对腿，蛛形下身', 'spider'],
    ['两对腿，人腿人马下身', 'humantaur'],
    ['两对腿', 'auto'],
    ['六条腿，腿胯部聚拢', 'gather'],
    ['三对腿扇形聚拢', 'gather'],
    ['胯部聚拢的四对腿', 'gather'],
    ['gathered_legs', 'gather'],
    // 聚拢说的是手臂
    ['六条腿，手臂肩部聚拢', 'auto'],
  ])('腿：「%s」→ %s', (text, layout) => {
    expect(parseDescription(text).legLayout).toBe(layout);
  });

  it('手臂肩部聚拢、腿胯部聚拢各管各的', () => {
    expect(parseDescription('四对手臂，手臂肩部聚拢，六条腿，腿胯部聚拢')).toMatchObject({ armLayout: 'fan', legLayout: 'gather' });
    // 中间没有逗号也分得开：「手臂……腿胯部聚拢」的聚拢说的是腿
    expect(parseDescription('四对手臂六条腿胯部聚拢')).toMatchObject({ armLayout: 'stack', legLayout: 'gather' });
  });

  it('「两对胸（上下排列）」不会被当成手臂排布，也不影响数量', () => {
    const r = parseDescription('两个头，两对手，两对胸（上下排列）');
    expect(diffCounts(r.counts)).toEqual({ heads: 2, armPairs: 2, chestPairs: 2 });
    expect(r.armLayout).toBe('stack');
  });
});

describe('兽耳', () => {
  it.each<[string, number, string | undefined]>([
    ['猫耳', 1, 'cat'],
    ['一对狐耳', 1, 'fox'],
    ['两对兔耳', 2, 'rabbit'],
    ['四只猫耳', 2, 'cat'],
    ['精灵耳', 1, 'elf'],
    ['尖耳', 1, 'elf'],
    ['兽耳', 1, undefined],
    ['fox_ears', 1, 'fox'],
    ['rabbit_ears', 1, 'rabbit'],
    ['狐娘，猫耳', 1, 'cat'],
    ['猫娘', 1, 'cat'],
    ['没有兽耳', 0, undefined],
  ])('「%s」→ %i 对，%s', (text, pairs, shape) => {
    const r = parseDescription(text);
    expect(r.counts.earPairsPerHead).toBe(pairs);
    expect(r.earShape).toBe(shape);
  });
});

describe('性别与姿势', () => {
  it.each<[string, 'male' | 'female' | undefined]>([
    ['男性，四臂', 'male'],
    ['四臂的少年', 'male'],
    ['1boy, four_arms', 'male'],
    ['male, multiple_tails', 'male'],
    ['dragon boy', 'male'],
    ['女性', 'female'],
    ['九尾狐少女', 'female'],
    ['1girl, fox_tail', 'female'],
    ['female, wings', 'female'],
    ['cat girl', 'female'],
    ['两个头，两对手', undefined],
    ['阿修罗', undefined],
    // 后写的算数
    ['男性……不对，是女性', 'female'],
    ['1girl 1boy', 'male'],
    // female 里的 male、woman 里的 man 不算
    ['female', 'female'],
    ['woman', 'female'],
    ['minotaur', undefined],
  ])('「%s」→ %s', (text, gender) => {
    expect(parseDescription(text).gender).toBe(gender);
  });

  it.each<[string, 'A' | 'T' | undefined]>([
    ['T-pose', 'T'],
    ['t pose', 'T'],
    ['tpose', 'T'],
    ['T字形站姿', 'T'],
    ['双臂平举', 'T'],
    ['手臂平举，四条腿', 'T'],
    ['A-pose', 'A'],
    ['a_pose', 'A'],
    ['双臂自然下垂', 'A'],
    ['三对手臂', undefined],
    ['先写了 T-pose，后来改成 A-pose', 'A'],
  ])('「%s」→ %s', (text, pose) => {
    expect(parseDescription(text).pose).toBe(pose);
  });

  it('「双臂平举」里的「双臂」不会被读成一对手臂', () => {
    expect(diff('四对手臂，双臂平举')).toEqual({ armPairs: 4 });
    expect(diff('三对手臂，两手平举')).toEqual({ armPairs: 3 });
    expect(diff('六条手臂，双臂自然下垂')).toEqual({ armPairs: 3 });
    // 不带姿势的「双臂」照旧是一对手臂
    expect(hitsOf(parseDescription('双臂'))).toEqual(['armPairs']);
  });

  it('性别和姿势的写法不影响部件数量', () => {
    expect(diff('男性，T-pose')).toEqual({});
    expect(diff('1girl, 1boy')).toEqual({});
    expect(diff('少女，两个头')).toEqual({ heads: 2 });
  });

  it('识别到的片段会被标出来', () => {
    const r = parseDescription('男性，四臂，T-pose');
    const texts = r.matches.map((m) => m.text);
    expect(texts).toContain('男性');
    expect(texts).toContain('T-pose');
  });
});

describe('发型与发色', () => {
  const hair = (text: string) => parseDescription(text).hair;

  it.each<[string, string]>([
    ['长直发', 'long'],
    ['长发及腰', 'long'],
    ['姬发式', 'long'],
    ['long_hair', 'long'],
    ['very long hair, straight_hair', 'long'],
    ['马尾', 'sidetail'],
    ['侧马尾', 'sidetail'],
    ['单马尾', 'sidetail'],
    ['ponytail', 'sidetail'],
    ['side_ponytail', 'sidetail'],
    ['波波头', 'bob'],
    ['短发', 'bob'],
    ['bob_cut', 'bob'],
    ['short hair', 'bob'],
    ['双马尾', 'twintails'],
    ['twintails', 'twintails'],
    ['twin_tails', 'twintails'],
    ['原装的头发', 'own'],
  ])('%s → 发型 %s', (text, style) => {
    expect(hair(text).style).toBe(style);
  });

  it.each<[string, string]>([
    ['金发', '#e8cf7a'],
    ['银色的长发', '#d5dbe6'],
    ['粉红色头发', '#f0a3bd'],
    ['黑发', '#23222a'],
    ['红色短发', '#c2413b'],
    ['一头白发', '#f2f2f5'],
    ['blonde_hair', '#e8cf7a'],
    ['silver hair', '#d5dbe6'],
    ['grey_hair', '#9aa0aa'],
    ['gray-hair', '#9aa0aa'],
    ['purple_hair', '#8e6ccf'],
  ])('%s → 发色 %s', (text, color) => {
    expect(hair(text).color).toBe(color);
  });

  it('发型和发色可以一起写；「黑长直」两样都有', () => {
    expect(hair('金发双马尾')).toEqual({ style: 'twintails', color: '#e8cf7a' });
    expect(hair('黑长直')).toEqual({ style: 'long', color: '#23222a' });
    expect(hair('1girl, pink_hair, twintails, cat_ears')).toEqual({ style: 'twintails', color: '#f0a3bd' });
    expect(hair('銀髮，長髮')).toEqual({ style: 'long', color: '#d5dbe6' });
  });

  it('没写头发就什么都没有；后写的算数', () => {
    expect(hair('两个头，九条尾巴')).toEqual({});
    expect(hair('头发很漂亮')).toEqual({});
    expect(hair('短发，后来留了长发')).toEqual({ style: 'long' });
    expect(hair('金发，其实是银发')).toEqual({ color: '#d5dbe6' });
  });

  it('饰品不算发色：蓝发带、红发卡', () => {
    expect(hair('蓝发带')).toEqual({});
    expect(hair('红色发卡')).toEqual({});
    expect(hair('hair_ribbon, hairband')).toEqual({});
  });

  it('头发的写法不影响部件数量：「双马尾」「马尾」不是尾巴，「头发」不是头', () => {
    expect(diff('金发双马尾')).toEqual({});
    expect(diff('黑长直，马尾')).toEqual({});
    expect(diff('twintails, ponytail, long_hair, silver_hair')).toEqual({});
    expect(diff('银发，九条尾巴，狐耳')).toEqual({ tails: 9, earPairsPerHead: 1 });
    expect(diff('两个头，粉色头发')).toEqual({ heads: 2 });
  });

  it('识别到的片段会被标出来', () => {
    const texts = parseDescription('金发双马尾，四臂').matches.map((m) => m.text);
    expect(texts).toContain('金发');
    expect(texts).toContain('双马尾');
  });
});

describe('头身比与身高', () => {
  it.each<[string, number]>([
    ['八头身', 8],
    ['7.5头身', 7.5],
    ['七个半头身', 7.5],
    ['六点五头身', 6.5],
    ['9 头身', 9],
  ])('「%s」→ 头身比 %d', (text, ratio) => {
    const r = parseDescription(text);
    expect(r.shape.headRatio).toBe(ratio);
    expect(diffCounts(r.counts)).toEqual({});
    expect(r.hits.size).toBe(0);
  });

  it.each<[string, number]>([
    ['身高165', 1.65],
    ['身高 170', 1.7],
    ['身高：158cm', 1.58],
    ['身高1.72米', 1.72],
    ['身高一米六', 1.6],
    ['一米七五', 1.75],
    ['170cm', 1.7],
    ['165 厘米', 1.65],
    ['1米65', 1.65],
    ['1.8m', 1.8],
  ])('「%s」→ 身高 %d 米', (text, height) => {
    const r = parseDescription(text);
    expect(r.shape.height).toBe(height);
    expect(diffCounts(r.counts)).toEqual({});
  });

  it('「两米长的尾巴」不是身高', () => {
    const r = parseDescription('两米长的尾巴');
    expect(r.shape.height).toBeUndefined();
    expect(diffCounts(r.counts)).toEqual({ tails: 1 });
  });

  it('和部件描述混在一起', () => {
    const r = parseDescription('身高 170，八头身，两个头，三对手臂');
    expect(r.shape).toEqual({ height: 1.7, headRatio: 8 });
    expect(diffCounts(r.counts)).toEqual({ heads: 2, armPairs: 3 });
  });

  it('没写就不带这两项', () => {
    expect(parseDescription('两个头').shape).toEqual({});
  });
});

describe('不该误判的写法', () => {
  it.each([
    '八头身',
    '双马尾',
    '高马尾',
    '一副眼镜',
    '一个角色',
    '六根手指',
    '三角帽',
    '五角星发饰',
    '两个人',
    '十分可爱',
    '五岁',
    '黑色长发',
    '头发很长',
    '戴着手套和眼镜',
    '连体泳衣',
    'one_eye_closed',
    'hair_over_one_eye',
    'twintails',
    'twin_tails',
    'low_twintails',
    'ponytail',
    'side_ponytail',
    'minotaur',
    'wing_collar',
    'long_hair, blue_eyes, smile, looking_at_viewer',
    'no_bra, thighhighs',
  ])('「%s」不改变任何部件', (text) => {
    expect(diff(text)).toEqual({});
  });

  it.each<[string, Expected]>([
    ['十六岁的双头少女', { heads: 2 }],
    ['身高一米六的双头少女', { heads: 2 }],
    ['无比巨大的翅膀', { wingPairs: 1 }],
    ['黑色长发，头上有两只角', { hornsPerHead: 2 }],
    ['戴着眼镜的三眼少女', { eyesPerHead: 3 }],
    ['一头金色长发，两条尾巴', { tails: 2 }],
    ['双马尾，两条尾巴', { tails: 2 }],
    ['八头身，两个头', { heads: 2 }],
    ['三角帽，一只角', { hornsPerHead: 1 }],
    ['twintails, two_tails', { tails: 2 }],
    ['minotaur, horns', { hornsPerHead: 2 }],
  ])('「%s」只认真正的部件', (text, counts) => {
    expect(diff(text)).toEqual(counts);
  });
});

describe('识别片段', () => {
  it('记录原文里的位置', () => {
    const text = '两个头，两对手';
    const r = parseDescription(text);
    expect(r.matches.map((m) => m.text)).toEqual(['两个头', '两对手']);
    for (const m of r.matches) expect(text.slice(m.start, m.end)).toBe(m.text);
  });

  it('全角和繁体不会让位置错开', () => {
    const text = '兩個頭，ｆｏｕｒ＿ａｒｍｓ';
    const r = parseDescription(text);
    expect(r.matches.map((m) => m.text)).toEqual(['兩個頭', 'ｆｏｕｒ＿ａｒｍｓ']);
  });

  it('身高和头身比各自成段，不吞掉中间的空格', () => {
    const r = parseDescription('身高170 八头身的九尾狐');
    expect(r.matches.filter((m) => m.tier === 'measure').map((m) => m.text)).toEqual(['身高170', '八头身']);
  });

  it('normalizeText 不改变长度', () => {
    const text = '兩個頭，Ｆｏｕｒ＿Ａｒｍｓ　😀 ABC 龍貓';
    const out = normalizeText(text);
    expect(out.length).toBe(text.length);
    expect(out).toBe('两个头,four_arms 😀 abc 龙猫');
  });
});
