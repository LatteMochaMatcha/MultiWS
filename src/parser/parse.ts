/**
 * 文字描述 → 部件数量与排布。纯函数，不依赖 DOM。
 *
 * 优先级从低到高（越具体越优先，后者覆盖前者）：
 *   1. 关键词      阿修罗、半人马、九尾、kitsune、seraph …
 *   2. 「至少」类   不带数字的提及：multiple_tails、extra_arms、多尾、翅膀、fox_tail …
 *                  只会把数量抬高到某个下限，不会压低
 *   3. 英文数字标签 four_arms、two-headed、4 arms、a pair of wings …
 *   4. 中文带数字   两个头、三对手臂、没有尾巴、双头 …
 * 同一层内按出现顺序，后写的覆盖先写的。
 */

import {
  type ArmLayout,
  type BodyCounts,
  type BodyShape,
  type CountKey,
  type EarShape,
  type Gender,
  type HairSpec,
  type HairStyle,
  type HeadLayout,
  type LegLayout,
  type PenisLayout,
  type Pose,
  type ScrotumMode,
  COUNT_DEF_BY_KEY,
  HIP_LEGS,
  PENIS_ROW,
  PAIRED_KEYS,
  clampCounts,
  defaultCounts,
} from '../model/spec';
import { CN_NUM_CHARS, ZERO_WORDS, cnNum } from './numerals';

export type MatchTier = 'measure' | 'keyword' | 'tag' | 'number';

/** 文字里被识别的一段，start / end 是原文下标 */
export interface ParseMatch {
  start: number;
  end: number;
  text: string;
  tier: MatchTier;
  keys: CountKey[];
}

export interface ParseResult {
  /** 完整的部件数量；文字没提到的部件取默认值 */
  counts: BodyCounts;
  /** 多个头是凑成一簇，还是一个头上几张脸（「三面六臂」「三张脸」「阿修罗」） */
  headLayout: HeadLayout;
  armLayout: ArmLayout;
  legLayout: LegLayout;
  /** 人腿人马每副胯几条腿（「每副胯三条腿」「前三后三」）；没说就是 2 */
  hipLegs: number;
  /** 好几根阴茎怎么排、阴囊共用还是各带一个（「阴茎上下叠」「每根各带阴囊」）；没说就是并排、共用 */
  penisLayout: PenisLayout;
  /** 排成几乘几时每排几根（「阴茎每排两根」）；没说就是 2 */
  penisRow: number;
  scrotum: ScrotumMode;
  /** 文字里点名了耳朵形状时才有 */
  earShape?: EarShape;
  /** 文字里写了「八头身」「身高 165」时才有对应项 */
  shape: Partial<Pick<BodyShape, 'height' | 'headRatio'>>;
  /** 文字里写了「男性」「少女」「1boy」这类说法时才有 */
  gender?: Gender;
  /** 文字里写了「T-pose」「双臂平举」这类说法时才有 */
  pose?: Pose;
  /** 文字里写了发型（「双马尾」「长直发」）、发色（「金发」「silver_hair」）时才有对应项 */
  hair: Partial<Pick<HairSpec, 'style' | 'color'>>;
  /** 从文字里识别到的部件（用于界面高亮） */
  hits: Set<CountKey>;
  matches: ParseMatch[];
}

/* ================= 文本规整 ================= */

/** 常见繁体 / 日文字形 → 简体，逐字替换，不改变长度 */
const T2S = new Map(
  Object.entries({
    頭: '头', 雙: '双', 對: '对', 條: '条', 隻: '只', 個: '个', 兩: '两', 両: '两', 腳: '脚',
    無: '无', 沒: '没', 龍: '龙', 貓: '猫', 靈: '灵', 馬: '马', 複: '复', 顆: '颗', 張: '张',
    羅: '罗', 獨: '独', 攏: '拢', 獸: '兽', 腦: '脑', 顱: '颅', 連: '连', 體: '体', 惡: '恶',
    長: '长', 帶: '带', 數: '数', 幾: '几', 許: '许', 額: '额', 後: '后', 並: '并', 橫: '横',
    蠍: '蝎', 魚: '鱼', 貧: '贫', 層: '层', 種: '种', 歲: '岁', 號: '号', 級: '级', 點: '点',
    寬: '宽', 鏡: '镜', 飾: '饰', 髮: '发', 環: '环', 鏈: '链', 機: '机', 襪: '袜', 釘: '钉',
    墜: '坠', 軀: '躯', 幹: '干', 釐: '厘', 約: '约', 為: '为', 嬰: '婴',
    銀: '银', 紅: '红', 藍: '蓝', 綠: '绿', 黃: '黄', 側: '侧', 單: '单',
  }),
);

/**
 * 全角转半角、英文转小写、繁体转简体。按 UTF-16 码元逐个处理，
 * 输出与输入等长，所以后面匹配到的下标可以直接用回原文。
 */
export function normalizeText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xff01 && code <= 0xff5e) code -= 0xfee0;
    else if (code === 0x3000) code = 0x20;
    if (code >= 0x41 && code <= 0x5a) code += 0x20;
    const ch = String.fromCharCode(code);
    out += T2S.get(ch) ?? ch;
  }
  return out;
}

type Span = [start: number, end: number];

/** 把已经用掉的片段换成逗号，后面的规则就不会再碰它 */
function mask(s: string, spans: Span[]): string {
  for (const [a, b] of spans) s = s.slice(0, a) + ','.repeat(b - a) + s.slice(b);
  return s;
}

/* ================= 中文：部件词表 ================= */

const N = CN_NUM_CHARS;

interface CnPart {
  word: string;
  key: CountKey;
  /** 前面紧挨着这个字时不算（「马尾」不是尾巴） */
  notAfter?: string;
  /** 后面紧跟这些字时不算（「角色」「手指」「眼镜」「头身」…） */
  notBefore?: string;
}

/** 长词在前，保证「手臂」不会被拆成「手」 */
const CN_PARTS: readonly CnPart[] = [
  // 成人部件（设置里打开「显示成人部件」才长，见 model/adult.ts）
  { word: '阴茎', key: 'penises' },
  { word: '肉棒', key: 'penises' },
  { word: '阳具', key: 'penises' },
  { word: '鸡巴', key: 'penises' },
  // 「两个上半身」：一副胯和腿上长着几个上半身
  { word: '上半身', key: 'torsos' },
  { word: '上身', key: 'torsos', notBefore: '衣穿' },
  { word: '躯干', key: 'torsos' },
  { word: '脑袋', key: 'heads' },
  { word: '头颅', key: 'heads' },
  { word: '手臂', key: 'armPairs' },
  { word: '胳膊', key: 'armPairs' },
  { word: '臂膀', key: 'armPairs' },
  { word: '胸部', key: 'chestPairs' },
  { word: '乳房', key: 'chestPairs' },
  { word: '翅膀', key: 'wingPairs' },
  { word: '羽翼', key: 'wingPairs' },
  { word: '尾巴', key: 'tails' },
  { word: '眼睛', key: 'eyesPerHead' },
  { word: '犄角', key: 'hornsPerHead' },
  { word: '耳朵', key: 'earPairsPerHead' },
  { word: '兽耳', key: 'earPairsPerHead' },
  { word: '头', key: 'heads', notBefore: '发饰巾盔盖顶身套' },
  // 「三张脸」：一个头上长几张脸，数量记在头上（见 FACE_WORD）
  { word: '脸', key: 'heads', notBefore: '红颊色蛋型庞部上谱' },
  { word: '手', key: 'armPairs', notBefore: '指套镯链表环杖枪机办' },
  { word: '臂', key: 'armPairs', notBefore: '环章甲' },
  { word: '胸', key: 'chestPairs', notBefore: '针甲罩衣围口肌' },
  { word: '乳', key: 'chestPairs', notBefore: '胶牛白液汁' },
  { word: '腿', key: 'legs', notBefore: '环袜甲' },
  { word: '脚', key: 'legs', notBefore: '趾链环踝印' },
  { word: '足', key: 'legs', notBefore: '袜球够以' },
  { word: '尾', key: 'tails', notAfter: '马', notBefore: '戒灯随声' },
  { word: '翼', key: 'wingPairs' },
  { word: '翅', key: 'wingPairs' },
  { word: '角', key: 'hornsPerHead', notBefore: '色度落形帽巾裤星' },
  { word: '眼', key: 'eyesPerHead', notBefore: '镜罩影妆线神泪看望就' },
  { word: '耳', key: 'earPairsPerHead', notBefore: '环机饰坠钉' },
];

const CN_PART_KEY = new Map(CN_PARTS.map((p) => [p.word, p.key]));
/** 说的是「脸」不是「头」：几张脸长在同一个头上 */
const FACE_WORD = '脸';
/** 「三面六臂」「四面佛」「双面人」里的「N 面」：也是几张脸。后面要跟着臂、神佛之类的字，免得把「三面环山」读进来。 1 数字 */
const CN_FACES_RE = new RegExp(`([${CN_NUM_CHARS}]+|双)面(?=[${CN_NUM_CHARS}]+臂|[神佛相像怪鬼娘女]|人(?!马))`, 'g');

const PART_SRC = CN_PARTS.map(
  (p) =>
    (p.notAfter ? `(?<!${p.notAfter})` : '') + p.word + (p.notBefore ? `(?![${p.notBefore}])` : ''),
).join('|');

/** 「对 / 双 / 副」按对算，其余按个数算 */
const PAIR_CLS: readonly string[] = ['对', '双', '副'];
const UNIT_CLS: readonly string[] = ['个', '只', '条', '根', '片', '颗', '张', '支', '枚'];
const CLS_SRC = [...PAIR_CLS, ...UNIT_CLS].join('|');

/** 「无数」「无比」不是「没有」 */
const ZERO_SRC = '没有|没|无(?![数比论限敌])|不要|不带|不长|去掉';

/** 数字后面紧跟这些字，说明它在量别的东西（十六岁、两米、十分、两个人、一些…） */
const MEASURE_SRC = '[岁米厘公斤年月日天号次倍级位名人层种分秒度些点半件套把本杯]';

/** 数字和部件之间最多 4 个修饰字（「两对巨大的翅膀」）；不能跨标点、数字、连词 */
const MOD_SRC = `[^,，.。;；、!！?？:：()（）\\s\\d${N}双和与及或跟]{0,4}?`;

/** 1 数字  2 量词  3 修饰  4 部件 */
const CN_NUM_RE = new RegExp(
  `(${ZERO_SRC}|(?<![\\d.])\\d+|[${N}]+)\\s*(?:(${CLS_SRC})|(?!${CLS_SRC}))(?!${MEASURE_SRC})(${MOD_SRC})(${PART_SRC})`,
  'g',
);

/** 「双头」「双尾」「双翼」：没有数字在前的「双」当作「两个」 */
const CN_DUAL_RE = new RegExp(`(?<![${N}\\d])双(${PART_SRC})`, 'g');

/** 人腿人马每副胯几条腿：「每副胯三条腿」。 1 数字 */
const HIP_LEGS_RE = new RegExp(`每[副个]?胯上?([${N}\\d]+)条(?:腿|足)?`, 'g');
/** 「前三后三」「前两条后一条腿」：前面那副胯几条、后面那副几条。 1 前 2 后 */
const FRONT_BACK_RE = new RegExp(`前([${N}\\d]+)条?(?:腿|足)?后([${N}\\d]+)条?(?:腿|足)?`, 'g');

/** 「多一对手臂」「额外的两只手」：在现有数量上追加 */
const ADD_PREFIX_RE = /(?:多出|多长了?|多了|多|额外的?|额外有)\s*$/;

/** 「多尾」「很多条尾巴」「无数只眼睛」：没有具体数字的「多」 1/2 部件 */
const CN_MULTI_RE = new RegExp(
  `(?:很多|许多|好多|好几|若干|无数|几|数|多)(?:${CLS_SRC})${MOD_SRC}(${PART_SRC})|(?:很多|许多|好多|无数|多)(${PART_SRC})`,
  'g',
);

/** 「multiple X」「多 X」在没有具体数字时取的数量 */
const MULTI: BodyCounts = {
  torsos: 2,
  heads: 2,
  armPairs: 2,
  chestPairs: 2,
  legs: 4,
  tails: 3,
  wingPairs: 2,
  hornsPerHead: 4,
  eyesPerHead: 3,
  earPairsPerHead: 2,
  penises: 2,
};

/** 不带数字的中文提及：出现了就至少有这么多 */
const CN_PRESENCE: ReadonlyArray<{ re: RegExp; key: CountKey; min: number }> = [
  { re: /尾巴|(?:狐|猫|龙|兽|蝎|鱼|恶魔)尾/g, key: 'tails', min: 1 },
  { re: /翅膀|羽翼|(?:龙|蝠|羽|光|蝶)翼/g, key: 'wingPairs', min: 1 },
  { re: /犄角|(?:龙|鹿|羊|牛|鬼|恶魔)角|(?:长着|生着|有|长|带)角(?![色度落形])/g, key: 'hornsPerHead', min: 2 },
  { re: /兽耳|(?:猫咪?|狐狸?|兔子?|狼|犬|狗|虎|精灵|尖)耳/g, key: 'earPairsPerHead', min: 1 },
  { re: /阴茎|肉棒|阳具|鸡巴/g, key: 'penises', min: 1 },
];

/* ================= 英文：Danbooru / e621 风格标签 ================= */

/** 标签里的词间分隔：空格、下划线、连字符都算 */
const S = '[ _-]';
/** 词边界（下划线和连字符也算边界，所以不能用 \b） */
const L = '(?<![a-z0-9])';
const L0 = '(?<![a-z0-9.])';
const R = '(?![a-z0-9])';

const EN_NUM: ReadonlyMap<string, number> = new Map(
  Object.entries({
    zero: 0, no: 0, a: 1, an: 1, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  }),
);
const EN_NUM_SRC = '\\d+|zero|no|one|single|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';

const EN_PART: ReadonlyMap<string, CountKey> = new Map(
  Object.entries({
    torso: 'torsos', torsos: 'torsos', torsoed: 'torsos',
    head: 'heads', heads: 'heads', headed: 'heads',
    // three_faces、two-faced：几张脸长在同一个头上，数量记在头上
    face: 'heads', faces: 'heads', faced: 'heads',
    arm: 'armPairs', arms: 'armPairs', armed: 'armPairs',
    limb: 'armPairs', limbs: 'armPairs',
    breast: 'chestPairs', breasts: 'chestPairs', breasted: 'chestPairs',
    boob: 'chestPairs', boobs: 'chestPairs',
    leg: 'legs', legs: 'legs', legged: 'legs',
    tail: 'tails', tails: 'tails', tailed: 'tails',
    wing: 'wingPairs', wings: 'wingPairs', winged: 'wingPairs',
    eye: 'eyesPerHead', eyes: 'eyesPerHead', eyed: 'eyesPerHead',
    horn: 'hornsPerHead', horns: 'hornsPerHead', horned: 'hornsPerHead',
    ear: 'earPairsPerHead', ears: 'earPairsPerHead', eared: 'earPairsPerHead',
    penis: 'penises', penises: 'penises', cock: 'penises', cocks: 'penises', dick: 'penises', dicks: 'penises',
  } satisfies Record<string, CountKey>),
);
const EN_PART_SRC =
  'torsoed|torsos?|headed|heads?|faced|faces?|armed|arms?|breasted|breasts?|boobs?|legged|legs?|tailed|tails?|winged|wings?|eyed|eyes?|horned|horns?|eared|ears?|penis(?:es)?|cocks?|dicks?';

/** 数字和部件之间允许夹一个形容词（two fox tails），但不能是这些虚词 */
const EN_STOP = 'with|and|or|of|has|have|having|in|on|the|a|an|to|girls?|boys?|pairs?|extra|additional|more';
const EN_ADJ = `(?!(?:${EN_STOP})${R})[a-z]+`;

/**
 * four_arms / 4 arms / two-headed / two_fox_tails。 1 数字  2 分隔符  3 形容词  4 部件
 * 夹形容词时前后分隔符必须一致，这样「no_bra tail」不会被读成「没有尾巴」。
 */
const EN_NUM_RE = new RegExp(
  `${L0}(${EN_NUM_SRC})(?:(${S})(${EN_ADJ})\\2|${S}*)(${EN_PART_SRC})${R}`,
  'g',
);

/** two pairs of arms / an extra pair of wings。 1 数字  2 extra  3 部件 */
const EN_PAIRS_RE = new RegExp(
  `${L0}(a|an|${EN_NUM_SRC})${S}+((?:extra|additional)${S}+)?pairs?${S}+of${S}+(?:${EN_ADJ}${S}+)?(${EN_PART_SRC})${R}`,
  'g',
);

/** two extra arms。 1 数字  2 部件 */
const EN_ADD_RE = new RegExp(
  `${L0}(${EN_NUM_SRC})${S}+(?:extra|additional|more)${S}+(${EN_PART_SRC})${R}`,
  'g',
);

/** multiple_tails / extra_arms / multi_leg / multiboob。 1 前缀  2 部件 */
const EN_MULTI_RE = new RegExp(
  `${L}(multiple|extra|multi|many|several)${S}*(${EN_PART_SRC}|boob|limbs?)${R}`,
  'g',
);

const EN_ANIMALS =
  'animal|cat|fox|wolf|dog|rabbit|bunny|tiger|lion|leopard|pointy|elf|elven|kemono|mouse|bear|horse|cow|sheep|goat|deer|raccoon|squirrel|jackal';

/** 不带数字的英文标签：fox_tail、demon_wings、horns、cat_ears … */
const EN_PRESENCE: ReadonlyArray<{ re: RegExp; key: CountKey; min: number }> = [
  // twin_tails / pony_tail 是发型
  { re: new RegExp(`${L}(?<!twin${S})(?<!pony${S})tails?${R}`, 'g'), key: 'tails', min: 1 },
  { re: new RegExp(`${L}wings?${R}(?!${S}collar)`, 'g'), key: 'wingPairs', min: 1 },
  { re: new RegExp(`${L}horns${R}`, 'g'), key: 'hornsPerHead', min: 2 },
  { re: new RegExp(`${L}horn${R}`, 'g'), key: 'hornsPerHead', min: 1 },
  { re: new RegExp(`${L}(?:penis|cock|dick)${R}`, 'g'), key: 'penises', min: 1 },
  {
    re: new RegExp(
      `${L}(?:${EN_ANIMALS})${S}ears?${R}|${L}(?:kemonomimi|nekomimi|usamimi|kitsunemimi|inumimi)${R}`,
      'g',
    ),
    key: 'earPairsPerHead',
    min: 1,
  },
];

/* ================= 关键词 ================= */

interface Keyword {
  re: RegExp;
  /** 直接设为该值 */
  set?: Partial<BodyCounts>;
  /** 至少这么多 */
  min?: Partial<BodyCounts>;
  headLayout?: HeadLayout;
  armLayout?: ArmLayout;
  legLayout?: LegLayout;
  earShape?: EarShape;
}

const kw = (src: string) => new RegExp(src, 'g');
const CREATURE = { hornsPerHead: 2, wingPairs: 1, tails: 1 } as const;
const KEMONO = { earPairsPerHead: 1, tails: 1 } as const;

const KEYWORDS: readonly Keyword[] = [
  { re: kw(`平胸|无胸|没有胸|${L}flat${S}chest(?:ed)?${R}`), set: { chestPairs: 0 } },
  // 阿修罗是「三面六臂」：一个头上三张脸
  { re: kw(`阿修罗|${L}ash?ura${R}`), set: { heads: 3, armPairs: 3 }, headLayout: 'faces', armLayout: 'fan' },
  { re: kw(`${L}janus${R}`), set: { heads: 2 }, headLayout: 'faces' },
  { re: kw('千手'), set: { armPairs: 4 }, armLayout: 'fan' },
  // minotaur 是牛头人，不是人马；humantaur 另算（见下一条）
  { re: kw(`半人马|人马|马身|(?<!mino)(?<!human)(?<!human${S})taurs?${R}`), set: { legs: 4 }, legLayout: 'taur' },
  // humantaur：像人马，但后半截是人的腰、胯和腿。排在「人马」后面：「人腿人马」两条都对得上，听这一条的
  { re: kw(`人腿人马|人身人马|人足人马|${L}human${S}?taurs?${R}`), set: { legs: 4 }, legLayout: 'humantaur' },
  {
    re: kw(`蜘蛛|蛛女|蛛娘|蛛形|${L}(?:arachne|drider|jorougumo)${R}|${L}spider${S}?(?:girl|woman|boy|legs)${R}`),
    set: { legs: 8 },
    legLayout: 'spider',
  },
  { re: kw(`九尾|${L}(?:kitsune|kyuubi|kyubi)${R}`), set: { tails: 9 } },
  { re: kw(`六翼|${L}seraph(?:im)?${R}`), set: { wingPairs: 3 } },
  { re: kw(`第三只眼|${L}third${S}eye${R}`), set: { eyesPerHead: 3 } },
  { re: kw(`独角|${L}unicorn${R}`), set: { hornsPerHead: 1 } },
  { re: kw(`独眼|${L}cyclops${R}|${L}mono${S}?eye${R}`), set: { eyesPerHead: 1 } },
  { re: kw(`地狱犬|刻耳柏洛斯|${L}cerberus${R}`), set: { heads: 3 } },
  // 希腊神话里的革律翁：三个身子在腰上连着
  { re: kw(`革律翁|格律翁|格里昂|${L}geryon${R}`), set: { torsos: 3 } },
  { re: kw(`猫又|${L}nekomata${R}`), set: { tails: 2 }, min: { earPairsPerHead: 1 }, earShape: 'cat' },
  { re: kw(`${L}armless${R}`), set: { armPairs: 0 } },
  // 「连体泳衣」不算
  { re: kw(`连体(?:人|婴|双胞胎|姐妹|兄弟)|${L}conjoined${R}`), min: { heads: 2 } },
  { re: kw('复乳|副乳'), min: { chestPairs: 2 } },
  { re: kw('多腕|复腕'), min: { armPairs: 2 } },
  { re: kw(`龙娘|龙女|龙人|${L}dragon${S}?(?:girl|boy)${R}`), min: CREATURE },
  {
    re: kw(`魅魔|小恶魔|恶魔娘|恶魔少女|${L}(?:succubus|incubus)${R}|${L}demon${S}?(?:girl|boy)${R}`),
    min: CREATURE,
  },
  { re: kw(`天使|${L}angel${R}`), min: { wingPairs: 1 } },
  { re: kw(`猫娘|猫女|猫耳娘|${L}cat${S}?(?:girl|boy)${R}|${L}nekomusume${R}`), min: KEMONO, earShape: 'cat' },
  {
    re: kw(`狐娘|狐女|狐妖|妖狐|狐仙|九尾狐|${L}kitsune${R}|${L}fox${S}?(?:girl|boy)${R}`),
    min: KEMONO,
    earShape: 'fox',
  },
  { re: kw(`狼娘|狼女|犬娘|${L}(?:wolf|dog)${S}?(?:girl|boy)${R}`), min: KEMONO, earShape: 'fox' },
  {
    re: kw(`兔娘|兔女郎|兔耳娘|${L}(?:bunny|rabbit)${S}?(?:girl|boy)${R}`),
    min: { earPairsPerHead: 1 },
    earShape: 'rabbit',
  },
  { re: kw(`精灵|${L}(?:elf|elven)${R}`), min: { earPairsPerHead: 1 }, earShape: 'elf' },
  { re: kw(`兽耳娘|兽娘|${L}kemonomimi${R}`), min: KEMONO },
];

/** 点名耳朵形状的说法；比关键词推断出来的形状优先 */
const EAR_SHAPE_RES: ReadonlyArray<[RegExp, EarShape]> = [
  [kw(`猫咪?耳|虎耳|豹耳|狮耳|${L}(?:cat|tiger|lion|leopard|mouse|bear|raccoon)${S}ears?${R}|${L}nekomimi${R}`), 'cat'],
  [kw(`狐狸?耳|狼耳|犬耳|狗耳|${L}(?:fox|wolf|dog|jackal)${S}ears?${R}|${L}(?:kitsunemimi|inumimi)${R}`), 'fox'],
  [kw(`兔子?耳|${L}(?:rabbit|bunny)${S}ears?${R}|${L}usamimi${R}`), 'rabbit'],
  [kw(`精灵耳|尖耳|${L}(?:elf|elven|pointy)${S}ears?${R}`), 'elf'],
];

/* ================= 排布 ================= */

const CLAUSE = '[^,。;、]';
const ARM_WORD = '(?:手臂?|臂|胳膊)';
/** 中间不隔着腿、胯（「手臂四对，腿胯部聚拢」的聚拢说的是腿） */
const NOT_LEG = '[^,。;、腿胯]';
const ARM_FAN_RE = new RegExp(
  `(?:${ARM_WORD}|肩部?)${NOT_LEG}{0,6}?(?:聚拢|扇形)|(?:聚拢|扇形)${NOT_LEG}{0,4}?${ARM_WORD}|${L}fan(?:ned)?${S}arms${R}`,
);
const ARM_STACK_RE = new RegExp(
  `${ARM_WORD}${CLAUSE}{0,6}?(?:上下排|上下并列|沿躯干)|(?:上下排|上下并列|沿躯干)${CLAUSE}{0,6}?${ARM_WORD}|${L}stacked${S}arms${R}`,
);
/** 「三头六臂」「三面六臂」「三头八臂」这类成语式的说法是神佛造像，手臂从肩部散开 */
const ARM_IDIOM_RE = new RegExp(`[${N}]+[头面][${N}]+臂`);
const LEG_TANDEM_RE = new RegExp(
  `腿${CLAUSE}{0,3}?前后(?:排|串|并)|前后(?:排列|串联|并列|排)${CLAUSE}{0,3}?腿|${L}tandem${S}legs${R}`,
);
/** 腿胯部聚拢、腿扇形聚拢、胯部聚拢（中间不隔着手臂、肩：「腿……手臂肩部聚拢」说的是手臂） */
const LEG_GATHER_RE = new RegExp(
  `(?:腿|胯)[^,。;、手臂肩胳]{0,4}?(?:扇形)?聚拢|${L}(?:gathered|fan(?:ned)?)${S}legs${R}`,
);
/** 多个头选了宽躯干（见 HEAD_LAYOUTS）：「宽躯干」「wide torso」 */
const WIDE_TORSO_RE = new RegExp(`宽躯干|${L}wide${S}torso${R}`);
/** 横排多胯、多胯横排、几副胯左右并排（说的是胯，不是腿：「腿横排」是腿左右并排） */
const LEG_ABREAST_RE = new RegExp(
  `横排${CLAUSE}{0,2}?(?:多|几)?副?胯|胯${CLAUSE}{0,4}?(?:横排|左右并排|并排)|${L}(?:side${S}by${S}side|abreast)${S}hips${R}`,
);
const LEG_ROW_RE = new RegExp(
  `腿${CLAUSE}{0,4}?(?:并排|横排|左右排)|(?:并排|横排|左右排)${CLAUSE}{0,4}?腿|${L}legs${S}(?:abreast|side${S}by${S}side)${R}`,
);

const PENIS_WORD = '(?:阴茎|肉棒|阳具|鸡巴)';
/** 好几根阴茎上下叠、扇形散开（没说就是左右并排） */
const PENIS_STACK_RE = new RegExp(
  `${PENIS_WORD}${CLAUSE}{0,6}?(?:上下叠|上下排|叠着)|(?:上下叠|上下排)${CLAUSE}{0,6}?${PENIS_WORD}|${L}stacked${S}(?:penises|cocks)${R}`,
);
/**
 * 阴茎排成几乘几：「阴茎每排两根」。前面同一句里（隔着逗号也行）得提到阴茎，后面紧跟着别的部件的不算（「每排两根角」）。 1 数字
 */
const PENIS_ROW_RE = new RegExp(`(?<=${PENIS_WORD}[^。;]{0,10}?)每排([${N}\\d]+)根(?!${PART_SRC})`, 'g');
const PENIS_FAN_RE = new RegExp(`${PENIS_WORD}${CLAUSE}{0,6}?(?:扇形|散开)|扇形${CLAUSE}{0,6}?${PENIS_WORD}`);
/** 每根各带一个阴囊（没说就是共用一个）。「一个阴囊」「共用一个阴囊」是共用：几个阴囊只认两个以上 */
const SCROTUM_EACH_RE = new RegExp(`(?:每根|各)${CLAUSE}{0,3}?阴囊|阴囊${CLAUSE}{0,2}?各|(?:[二两俩三四五六七八九十几多]|[2-9]|\\d{2,})个阴囊`);

/* ================= 性别、姿势 ================= */

/** 文字里最后提到的那个算数 */
const GENDER_RES: ReadonlyArray<[RegExp, Gender]> = [
  [kw(`男性|男人|男生|男孩|男体|少年|${L}(?:male|1boy|boys?|man)${R}`), 'male'],
  [kw(`女性|女人|女生|女孩|女体|少女|${L}(?:female|1girl|girls?|woman)${R}`), 'female'],
];
/** 姿势的说法里常带「双臂」「两手」，要先取走，免得被当成手臂数量 */
const POSE_RES: ReadonlyArray<[RegExp, Pose]> = [
  [kw(`${L}t${S}?pose${R}|t字(?:形|型)?(?:站姿|姿势)?|(?:双臂|两臂|双手|两手|手臂)?平举`), 'T'],
  [kw(`${L}a${S}?pose${R}|a字(?:形|型)?(?:站姿|姿势)?|(?:双臂|两臂|双手|两手|手臂)?自然下垂`), 'A'],
];

/* ================= 头发：发型、发色 ================= */

/** 发型的说法，文字里最后提到的那个算数。「双马尾」里的「马尾」不是单马尾 */
const HAIR_STYLE_RES: ReadonlyArray<[RegExp, HairStyle]> = [
  [kw(`黑长直|长直发|长发|直发|姬发式?|${L}(?:very${S})?long${S}hair${R}|${L}straight${S}hair${R}|${L}hime${S}cut${R}`), 'long'],
  [kw(`侧马尾|单马尾|(?<!双)马尾|${L}(?:side${S}?)?pony${S}?tail${R}`), 'sidetail'],
  [kw(`波波头|妹妹头|短发|${L}bob${S}?(?:cut|hair)${R}|${L}short${S}hair${R}`), 'bob'],
  [kw(`双马尾|${L}twin${S}?tails?${R}`), 'twintails'],
  [kw('原装(?:的)?(?:头发|发型)|原来的(?:头发|发型)'), 'own'],
];

/** 发色的说法 → 颜色。长的词排在前面，「粉红」不会被读成「红」 */
const HAIR_COLORS: ReadonlyArray<[cn: string, en: string, color: string]> = [
  ['粉红|粉', 'pink', '#f0a3bd'],
  ['银白|银', 'silver', '#d5dbe6'],
  ['金黄|金|黄', 'blonde?|golden|yellow', '#e8cf7a'],
  ['棕|褐|茶|栗', 'brown', '#6b4a32'],
  ['紫', 'purple', '#8e6ccf'],
  ['蓝', 'blue', '#4f7fd1'],
  ['青', 'aqua', '#58c3c9'],
  ['绿', 'green', '#5fae86'],
  ['橙|橘', 'orange', '#e58a3c'],
  ['红|赤', 'red', '#c2413b'],
  ['白', 'white', '#f2f2f5'],
  ['灰', 'gr[ae]y', '#9aa0aa'],
  ['黑', 'black', '#23222a'],
];
const HAIR_COLOR_CN = new Map(HAIR_COLORS.flatMap(([cn, , color]) => cn.split('|').map((word): [string, string] => [word, color])));
/** 「金发」「银色的长发」「粉红色头发」「黑长直」；「蓝发带」「红发卡」是饰品，不算。 1 颜色 */
const HAIR_COLOR_CN_RE = new RegExp(`(${HAIR_COLORS.map(([cn]) => cn).join('|')})(?:色?的?(?:头|长|短|直|卷)?发(?![带卡夹饰箍圈绳])|长直)`, 'g');
/** blonde_hair、silver hair。每种颜色一条 */
const HAIR_COLOR_EN_RES: ReadonlyArray<[RegExp, string]> = HAIR_COLORS.map(([, en, color]) => [kw(`${L}(?:${en})${S}hair${R}`), color]);

/* ================= 度量：头身比、身高 ================= */

const CN_DIGITS = '零〇一二两三四五六七八九';

/** 「八头身」「7.5 头身」「七个半头身」。 1 整数部分  2 点后一位  3 半 */
const HEAD_RATIO_RE = new RegExp(
  `((?<![\\d.])\\d+(?:\\.\\d+)?|[${N}]+)\\s*个?(?:点([${CN_DIGITS}])|(半))?\\s*头身`,
  'g',
);

function readHeadRatio(m: RegExpExecArray): number {
  const base = /^\d/.test(m[1]) ? Number(m[1]) : cnNum(m[1]);
  return base + (m[2] ? cnNum(m[2]) / 10 : 0) + (m[3] ? 0.5 : 0);
}

/** 「1 米 65」这种写法：whole=1，tail='65' → 1.65 */
const meters = (whole: number, tail?: string) => whole + (tail ? Number(tail) / 10 ** tail.length : 0);

const HEIGHT_RULES: ReadonlyArray<{ re: RegExp; read: (m: RegExpExecArray) => number }> = [
  {
    // 身高170 / 身高 1.7 米 / 身高：165cm
    // 1 数值  2 厘米单位  3 米单位  4 「1 米 65」的尾数
    re: /身高\s*(?:是|为|约|大约|大概|:)?\s*(\d+(?:\.\d+)?)(?:\s*(?:(cm|厘米|公分)|(米|m(?![a-z]))(\d{1,2})?))?/g,
    read: (m) => {
      const v = Number(m[1]);
      if (m[3]) return meters(v, m[4]);
      if (m[2]) return v / 100;
      return v > 3 ? v / 100 : v;
    },
  },
  { re: /(?<![\d.])(\d{2,3}(?:\.\d+)?)\s*(?:cm|厘米|公分)/g, read: (m) => Number(m[1]) / 100 },
  {
    // 1.7米 / 1米65 / 1.75m；「3 米长的尾巴」不是身高
    re: /(?<![\d.])(\d(?:\.\d+)?)\s*(?:米|m(?![a-z]))(\d{1,2})?(?![长宽粗厚])/g,
    read: (m) => meters(Number(m[1]), m[2]),
  },
  {
    // 一米六 / 一米六五 / 两米
    re: new RegExp(`(?:身高\\s*)?([一二两])米([${CN_DIGITS}]{1,2})?(?![长宽粗厚])`, 'g'),
    read: (m) => meters(cnNum(m[1]), m[2] ? [...m[2]].map((ch) => cnNum(ch)).join('') : undefined),
  },
];

/* ================= 主流程 ================= */

type Mode = 'set' | 'min' | 'add';

interface Effect {
  start: number;
  end: number;
  key: CountKey;
  value: number;
  mode: Mode;
  tier: MatchTier;
}

const byStart = (a: { start: number }, b: { start: number }) => a.start - b.start;

export function parseDescription(text: string): ParseResult {
  const c = defaultCounts();
  const hits = new Set<CountKey>();
  const matches: ParseMatch[] = [];
  const shape: ParseResult['shape'] = {};

  const record = (start: number, end: number, tier: MatchTier, keys: CountKey[]) => {
    matches.push({ start, end, text: text.slice(start, end), tier, keys });
  };

  /** 低于下限的说法（「没有头」「no_eyes」）不采纳；高于上限的收到上限 */
  const apply = (e: Effect) => {
    const def = COUNT_DEF_BY_KEY[e.key];
    const v =
      e.mode === 'add' ? c[e.key] + e.value : e.mode === 'min' ? Math.max(c[e.key], e.value) : e.value;
    if (v < def.min) return;
    c[e.key] = Math.min(def.max, v);
    hits.add(e.key);
    record(e.start, e.end, e.tier, [e.key]);
  };

  let work = normalizeText(text);

  /* ---- 0. 头身比、身高：先取走，免得里面的数字被当成部件数量 ---- */
  {
    const spans: Span[] = [];
    for (const m of work.matchAll(HEAD_RATIO_RE)) {
      const v = readHeadRatio(m);
      if (Number.isFinite(v)) shape.headRatio = v;
      spans.push([m.index, m.index + m[0].length]);
      record(m.index, m.index + m[0].length, 'measure', []);
    }
    work = mask(work, spans);
  }
  for (const rule of HEIGHT_RULES) {
    const spans: Span[] = [];
    for (const m of work.matchAll(rule.re)) {
      const h = rule.read(m);
      if (h >= 0.5 && h <= 3) {
        shape.height = Math.round(h * 100) / 100;
        record(m.index, m.index + m[0].length, 'measure', []);
      }
      spans.push([m.index, m.index + m[0].length]);
    }
    work = mask(work, spans);
  }

  /* ---- 0.5 姿势、性别：各取最后提到的；姿势的说法取走，免得「双臂平举」被读成一对手臂 ---- */
  let pose: Pose | undefined;
  {
    const spans: Span[] = [];
    let last = -1;
    for (const [re, value] of POSE_RES) {
      for (const m of work.matchAll(re)) {
        spans.push([m.index, m.index + m[0].length]);
        record(m.index, m.index + m[0].length, 'keyword', []);
        if (m.index > last) {
          last = m.index;
          pose = value;
        }
      }
    }
    work = mask(work, spans);
  }
  /* ---- 0.55 人腿人马每副胯几条腿：取走，免得「每副胯三条腿」被读成三条腿 ---- */
  let hipLegs: number = HIP_LEGS.def;
  /** 「前三后三」：腿的总数，等后面收集带数字的描述时一起排 */
  const frontBack: { start: number; end: number; legs: number }[] = [];
  {
    const spans: Span[] = [];
    const num = (w: string) => (/^\d+$/.test(w) ? Number(w) : cnNum(w));
    for (const m of work.matchAll(HIP_LEGS_RE)) {
      const n = num(m[1]);
      if (n >= HIP_LEGS.min && n <= HIP_LEGS.max) hipLegs = n;
      spans.push([m.index, m.index + m[0].length]);
      record(m.index, m.index + m[0].length, 'keyword', []);
    }
    for (const m of work.matchAll(FRONT_BACK_RE)) {
      const front = num(m[1]);
      const back = num(m[2]);
      if (!(front >= 1 && back >= 1)) continue;
      // 前面的少、后面的多（前二后三）拼不出来：多的那副放前面
      hipLegs = Math.min(HIP_LEGS.max, Math.max(front, back));
      frontBack.push({ start: m.index, end: m.index + m[0].length, legs: front + back });
      spans.push([m.index, m.index + m[0].length]);
    }
    work = mask(work, spans);
  }
  /* ---- 0.56 阴茎每排几根：取走，免得「每排两根」被读成两根 ---- */
  let penisRow: number = PENIS_ROW.def;
  let gridSaid = false;
  {
    const spans: Span[] = [];
    for (const m of work.matchAll(PENIS_ROW_RE)) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : cnNum(m[1]);
      if (n >= PENIS_ROW.min && n <= PENIS_ROW.max) penisRow = n;
      gridSaid = true;
      spans.push([m.index, m.index + m[0].length]);
      record(m.index, m.index + m[0].length, 'keyword', []);
    }
    work = mask(work, spans);
  }
  let gender: Gender | undefined;
  {
    let last = -1;
    for (const [re, value] of GENDER_RES) {
      for (const m of work.matchAll(re)) {
        record(m.index, m.index + m[0].length, 'keyword', []);
        if (m.index > last) {
          last = m.index;
          gender = value;
        }
      }
    }
  }

  /* ---- 0.6 头发：发型、发色各取最后提到的 ---- */
  const hair: ParseResult['hair'] = {};
  {
    let last = -1;
    for (const [re, value] of HAIR_STYLE_RES) {
      for (const m of work.matchAll(re)) {
        record(m.index, m.index + m[0].length, 'keyword', []);
        if (m.index > last) {
          last = m.index;
          hair.style = value;
        }
      }
    }
    last = -1;
    const tint = (m: RegExpExecArray, color: string) => {
      record(m.index, m.index + m[0].length, 'keyword', []);
      if (m.index > last) {
        last = m.index;
        hair.color = color;
      }
    };
    for (const m of work.matchAll(HAIR_COLOR_CN_RE)) tint(m, HAIR_COLOR_CN.get(m[1])!);
    for (const [re, color] of HAIR_COLOR_EN_RES) for (const m of work.matchAll(re)) tint(m, color);
  }

  /* ---- 1. 关键词：先应用「至少」，再应用「设为」，让「独角」能压过「龙娘」的两只角 ---- */
  let headLayout: HeadLayout = 'cluster';
  let armLayout: ArmLayout = 'stack';
  let legLayout: LegLayout = 'auto';
  let earShape: EarShape | undefined;
  /** 文字里明说了「几张脸」/「几个头」（比关键词带出来的排法优先） */
  let facesSaid = false;
  let headsSaid = false;
  const found: Keyword[] = [];
  for (const k of KEYWORDS) {
    const keys = Object.keys({ ...k.min, ...k.set }) as CountKey[];
    let any = false;
    for (const m of work.matchAll(k.re)) {
      any = true;
      record(m.index, m.index + m[0].length, 'keyword', keys);
    }
    if (any) found.push(k);
  }
  for (const pass of ['min', 'set'] as const) {
    for (const k of found) {
      for (const [key, value] of Object.entries(k[pass] ?? {}) as [CountKey, number][]) {
        c[key] = pass === 'min' ? Math.max(c[key], value) : value;
        hits.add(key);
      }
    }
  }
  for (const k of found) {
    if (k.headLayout) headLayout = k.headLayout;
    if (k.armLayout) armLayout = k.armLayout;
    if (k.legLayout) legLayout = k.legLayout;
    if (k.earShape) earShape = k.earShape;
  }

  /* ---- 2. 收集英文标签。带数字的先匹配并遮掉，免得「two extra arms」又被读成「extra arms」 ---- */
  const soft: Effect[] = [];
  const enHard: Effect[] = [];
  let en = work;
  const sweep = (re: RegExp, read: (m: RegExpExecArray) => Omit<Effect, 'start' | 'end' | 'tier'> | null) => {
    const spans: Span[] = [];
    for (const m of en.matchAll(re)) {
      const e = read(m);
      if (!e) continue;
      const span: Span = [m.index, m.index + m[0].length];
      (e.mode === 'min' ? soft : enHard).push({ ...e, start: span[0], end: span[1], tier: 'tag' });
      spans.push(span);
    }
    en = mask(en, spans);
  };
  const enNum = (w: string) => (/^\d+$/.test(w) ? Number(w) : (EN_NUM.get(w) ?? NaN));
  const perUnit = (key: CountKey, n: number) => (PAIRED_KEYS.has(key) ? Math.ceil(n / 2) : n);
  const perPair = (key: CountKey, n: number) => (PAIRED_KEYS.has(key) ? n : n * 2);
  /** 记下说的是脸还是头（「一张脸」「one face」不算：一个头本来就一张脸） */
  const said = (word: string, key: CountKey, n: number) => {
    if (key !== 'heads' || !(n >= 2)) return;
    if (word === FACE_WORD || word.startsWith('face')) facesSaid = true;
    else headsSaid = true;
  };

  sweep(EN_PAIRS_RE, (m) => {
    const key = EN_PART.get(m[3])!;
    return { key, value: perPair(key, enNum(m[1])), mode: m[2] ? 'add' : 'set' };
  });
  sweep(EN_ADD_RE, (m) => {
    const key = EN_PART.get(m[2])!;
    said(m[2], key, 2);
    return { key, value: perUnit(key, enNum(m[1])), mode: 'add' };
  });
  sweep(EN_NUM_RE, (m) => {
    const key = EN_PART.get(m[4])!;
    const n = enNum(m[1]);
    // one_eye_closed、hair_over_one_eye 是眨眼和刘海，只有 one-eyed 才是独眼
    if (key === 'eyesPerHead' && n <= 1 && m[4] !== 'eyed') return null;
    // 「no」后面不接形容词：no_panties tail 不是「没有尾巴」
    if (n === 0 && m[3]) return null;
    said(m[4], key, n);
    return { key, value: perUnit(key, n), mode: 'set' };
  });
  sweep(EN_MULTI_RE, (m) => {
    const key = EN_PART.get(m[2])!;
    // Danbooru 的 extra_ears 指兽耳和人耳并存，只说明有兽耳
    const value = m[1] === 'extra' && key === 'earPairsPerHead' ? 1 : MULTI[key];
    said(m[2], key, 2);
    return { key, value, mode: 'min' };
  });
  for (const p of EN_PRESENCE) sweep(p.re, () => ({ key: p.key, value: p.min, mode: 'min' }));

  /* ---- 3. 收集中文里不带数字的提及 ---- */
  for (const m of work.matchAll(CN_MULTI_RE)) {
    const key = CN_PART_KEY.get(m[1] ?? m[2])!;
    said(m[1] ?? m[2], key, 2);
    soft.push({ start: m.index, end: m.index + m[0].length, key, value: MULTI[key], mode: 'min', tier: 'keyword' });
  }
  for (const p of CN_PRESENCE) {
    for (const m of work.matchAll(p.re)) {
      soft.push({ start: m.index, end: m.index + m[0].length, key: p.key, value: p.min, mode: 'min', tier: 'keyword' });
    }
  }

  /* ---- 4. 收集中文带数字的描述 ---- */
  const cnHard: Effect[] = [];
  for (const m of work.matchAll(CN_NUM_RE)) {
    const n = ZERO_WORDS.has(m[1]) ? 0 : cnNum(m[1]);
    if (Number.isNaN(n)) continue;
    const key = CN_PART_KEY.get(m[4])!;
    const value = PAIR_CLS.includes(m[2]) ? perPair(key, n) : perUnit(key, n);
    const add = ADD_PREFIX_RE.test(work.slice(Math.max(0, m.index - 4), m.index));
    said(m[4], key, add ? 2 : value);
    cnHard.push({ start: m.index, end: m.index + m[0].length, key, value, mode: add ? 'add' : 'set', tier: 'number' });
  }
  for (const m of work.matchAll(CN_DUAL_RE)) {
    const key = CN_PART_KEY.get(m[1])!;
    said(m[1], key, 2);
    cnHard.push({ start: m.index, end: m.index + m[0].length, key, value: perUnit(key, 2), mode: 'set', tier: 'number' });
  }
  // 「三面六臂」里的「三面」：三张脸
  for (const m of work.matchAll(CN_FACES_RE)) {
    const n = m[1] === '双' ? 2 : cnNum(m[1]);
    if (Number.isNaN(n)) continue;
    said(FACE_WORD, 'heads', n);
    cnHard.push({ start: m.index, end: m.index + m[0].length, key: 'heads', value: n, mode: 'set', tier: 'number' });
  }

  for (const f of frontBack) cnHard.push({ start: f.start, end: f.end, key: 'legs', value: f.legs, mode: 'set', tier: 'number' });

  /* ---- 5. 按优先级依次应用 ---- */
  // 「一条尾巴」里的「尾巴」已经有具体数字了，不再当作一次单独的提及
  const hard = [...enHard, ...cnHard];
  const hasNumber = (e: Effect) => hard.some((h) => h.key === e.key && h.start < e.end && e.start < h.end);
  soft
    .filter((e) => !hasNumber(e))
    .sort(byStart)
    .forEach(apply);
  enHard.sort(byStart).forEach(apply);
  cnHard.sort(byStart).forEach(apply);

  /* ---- 6. 排布与耳形：明说的优先于关键词带出来的 ---- */
  if (facesSaid) headLayout = 'faces';
  else if (WIDE_TORSO_RE.test(work)) headLayout = 'wide';
  else if (headsSaid) headLayout = 'cluster';

  if (ARM_STACK_RE.test(work)) armLayout = 'stack';
  else if (ARM_FAN_RE.test(work) || ARM_IDIOM_RE.test(work)) armLayout = 'fan';

  if (LEG_TANDEM_RE.test(work)) legLayout = 'tandem';
  else if (LEG_ABREAST_RE.test(work)) legLayout = 'abreast';
  else if (LEG_ROW_RE.test(work)) legLayout = 'row';
  else if (LEG_GATHER_RE.test(work)) legLayout = 'gather';
  // 只说了「前三后三」：就是人腿人马
  else if (frontBack.length && legLayout === 'auto') legLayout = 'humantaur';

  let shapeAt = -1;
  for (const [re, s] of EAR_SHAPE_RES) {
    for (const m of work.matchAll(re)) {
      if (m.index > shapeAt) {
        shapeAt = m.index;
        earShape = s;
      }
    }
  }

  const penisLayout: PenisLayout = gridSaid ? 'grid' : PENIS_STACK_RE.test(work) ? 'stack' : PENIS_FAN_RE.test(work) ? 'fan' : 'row';
  const scrotum: ScrotumMode = SCROTUM_EACH_RE.test(work) ? 'each' : 'shared';

  return {
    counts: clampCounts(c),
    headLayout,
    armLayout,
    legLayout,
    hipLegs,
    penisLayout,
    penisRow,
    scrotum,
    earShape,
    shape,
    gender,
    pose,
    hair,
    hits,
    matches: matches.sort(byStart),
  };
}
