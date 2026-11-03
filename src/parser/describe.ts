/**
 * 部件数量与排布 → 规范描述（中、英、日三语各一套写法）。保证 describe → parse → describe 往返一致。
 * 每个语言的每个短语都要能被 parse.ts 认出来，所以写法有几条约束：
 *   - 短语里不能出现会被误认成数量的字：中文的数字和「双」，英文的 one / two / a / pair 之类，日文的数字和「ふたつ」「双」。
 *   - 部件名后面不能紧跟数字（日文「脚」后面接「2対」是数量，「脚を左右に並べる」不是）。
 */

import { type Lang, LANG, t, tk } from '../i18n';
import {
  type BodySpec,
  type CountKey,
  type EarShape,
  type LegLayout,
  HIP_LEGS,
  PENIS_ROW,
  legPlan,
  perHip,
  PER_TORSO_KEYS,
  type PerTorsoKey,
  type TorsoSide,
  countsOf,
  torsoSides,
} from '../model/spec';
import { zhCount } from './numerals';

/** 界面上显示的耳形名（跟着界面语言走）；规范描述里用的耳名在各语言的 PHRASES 里 */
export const EAR_NAME: Record<EarShape, string> = {
  cat: t('猫耳'),
  fox: t('狐耳'),
  rabbit: t('兔耳'),
  elf: t('精灵耳'),
};

/** 一种语言的规范写法 */
interface Phrases {
  /** 短语之间的分隔 */
  sep: string;
  male: string;
  torsos: (n: number) => string;
  heads: (n: number) => string;
  /** 一个头上几张脸 */
  faces: (n: number) => string;
  arms: (pairs: number) => string;
  noArms: string;
  chests: (pairs: number) => string;
  flatChest: string;
  /** 双数条腿按对写（「两对腿」），单数按条写（「三条腿」） */
  legs: (n: number) => string;
  legLayout: Record<Exclude<LegLayout, 'auto'>, string>;
  /** 人腿人马、前后串联每副胯几条腿 */
  hipLegs: (n: number) => string;
  /** 好几个上半身时某一个上半身单独设的那几样：一句里不能有本语言的短语分隔符（解析时一直读到分隔符） */
  torsoOwn: (side: TorsoSide, items: string[]) => string;
  wideTorso: string;
  tails: (n: number) => string;
  wings: (pairs: number) => string;
  horns: (n: number) => string;
  noHorns: string;
  eyes: (n: number) => string;
  /** 每个头 pairs 对耳朵；只有一对时写耳名就够了（英文 fox ears、日文 狐耳） */
  ears: (pairs: number, shape: EarShape) => string;
  noEars: string;
  armFan: string;
  penises: (n: number) => string;
  /** 阴茎排成几乘几时每排几根 */
  penisRow: (n: number) => string;
  penisLayout: Record<'stack' | 'fan', string>;
  scrotumEach: string;
  tPose: string;
}

const ZH_EAR: Record<EarShape, string> = { cat: '猫耳', fox: '狐耳', rabbit: '兔耳', elf: '精灵耳' };
const EN_EAR: Record<EarShape, string> = { cat: 'cat ears', fox: 'fox ears', rabbit: 'rabbit ears', elf: 'elf ears' };
const JA_EAR: Record<EarShape, string> = { cat: '猫耳', fox: '狐耳', rabbit: 'うさ耳', elf: 'エルフ耳' };

/** 英文：1 个用单数，其余用复数 */
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const PHRASES: Record<Lang, Phrases> = {
  zh: {
    sep: '，',
    male: '男性',
    torsos: (n) => `${zhCount(n)}个上半身`,
    heads: (n) => `${zhCount(n)}个头`,
    faces: (n) => `${zhCount(n)}张脸`,
    arms: (n) => `${zhCount(n)}对手臂`,
    noArms: '没有手臂',
    chests: (n) => `${zhCount(n)}对胸`,
    flatChest: '平胸',
    legs: (n) => (n % 2 ? `${zhCount(n)}条腿` : `${zhCount(n / 2)}对腿`),
    legLayout: {
      taur: '人马下身',
      spider: '蛛形下身',
      humantaur: '人腿人马下身',
      tandem: '腿前后排列',
      row: '腿左右并排',
      gather: '腿胯部聚拢',
      abreast: '横排多胯',
    },
    hipLegs: (n) => `每副胯${zhCount(n)}条腿`,
    torsoOwn: (side, items) => `${{ L: '左边', M: '中间', R: '右边' }[side]}的上半身${items.join('、')}`,
    wideTorso: '宽躯干',
    tails: (n) => `${zhCount(n)}条尾巴`,
    wings: (n) => `${zhCount(n)}对翅膀`,
    horns: (n) => `每个头${zhCount(n)}只角`,
    noHorns: '没有角',
    eyes: (n) => `每个头${zhCount(n)}只眼睛`,
    ears: (n, shape) => `每个头${zhCount(n)}对${ZH_EAR[shape]}`,
    noEars: '没有兽耳',
    armFan: '手臂肩部聚拢',
    penises: (n) => `${zhCount(n)}根阴茎`,
    penisRow: (n) => `阴茎每排${zhCount(n)}根`,
    penisLayout: { stack: '阴茎上下叠', fan: '阴茎扇形散开' },
    scrotumEach: '每根各带阴囊',
    tPose: 'T-pose',
  },
  en: {
    sep: ', ',
    male: 'male',
    torsos: (n) => `${n} upper bodies`,
    heads: (n) => `${n} ${plural(n, 'head', 'heads')}`,
    faces: (n) => `${n} faces`,
    arms: (n) => `${n} ${plural(n, 'pair', 'pairs')} of arms`,
    noArms: 'no arms',
    chests: (n) => `${n} ${plural(n, 'pair', 'pairs')} of breasts`,
    flatChest: 'flat chest',
    legs: (n) => (n % 2 ? `${n} ${plural(n, 'leg', 'legs')}` : `${n / 2} ${plural(n / 2, 'pair', 'pairs')} of legs`),
    legLayout: {
      taur: 'centaur lower body',
      spider: 'spider lower body',
      humantaur: 'humantaur lower body',
      tandem: 'legs in tandem',
      row: 'legs side by side',
      gather: 'legs gathered at the pelvis',
      abreast: 'pelvises side by side',
    },
    hipLegs: (n) => `${n} ${plural(n, 'leg', 'legs')} per pelvis`,
    torsoOwn: (side, items) => `${{ L: 'left', M: 'middle', R: 'right' }[side]} upper body with ${items.join(' and ')}`,
    wideTorso: 'wide torso',
    tails: (n) => `${n} ${plural(n, 'tail', 'tails')}`,
    wings: (n) => `${n} ${plural(n, 'pair', 'pairs')} of wings`,
    horns: (n) => `${n} ${plural(n, 'horn', 'horns')} per head`,
    noHorns: 'no horns',
    eyes: (n) => `${n} ${plural(n, 'eye', 'eyes')} per head`,
    ears: (n, shape) => (n === 1 ? EN_EAR[shape] : `${n} pairs of ${EN_EAR[shape]} per head`),
    noEars: 'no ears',
    armFan: 'arms gathered at the shoulders',
    penises: (n) => `${n} ${plural(n, 'penis', 'penises')}`,
    penisRow: (n) => `penises in rows of ${n}`,
    penisLayout: { stack: 'penises stacked', fan: 'penises fanned out' },
    scrotumEach: 'each with its own scrotum',
    tPose: 'T-pose',
  },
  ja: {
    sep: '、',
    male: '男性',
    torsos: (n) => `上半身${n}つ`,
    heads: (n) => `頭${n}つ`,
    faces: (n) => `顔${n}つ`,
    arms: (n) => `腕${n}対`,
    noArms: '腕なし',
    chests: (n) => `胸${n}対`,
    flatChest: '貧乳',
    legs: (n) => (n % 2 ? `脚${n}本` : `脚${n / 2}対`),
    legLayout: {
      taur: 'ケンタウロスの下半身',
      spider: 'アラクネの下半身',
      humantaur: 'ヒューマンタウロスの下半身',
      tandem: '脚を前後に並べる',
      row: '脚を左右に並べる',
      gather: '脚を骨盤に集める',
      abreast: '骨盤を横に並べる',
    },
    hipLegs: (n) => `骨盤ごとに脚${n}本`,
    // 「、」是短语分隔符，几样之间用「と」
    torsoOwn: (side, items) => `${{ L: '左', M: '中央', R: '右' }[side]}の上半身は${items.join('と')}`,
    wideTorso: '幅広の胴',
    tails: (n) => `尻尾${n}本`,
    wings: (n) => `翼${n}対`,
    horns: (n) => `頭ごとに角${n}本`,
    noHorns: '角なし',
    eyes: (n) => `頭ごとに目${n}つ`,
    ears: (n, shape) => (n === 1 ? JA_EAR[shape] : `頭ごとに${JA_EAR[shape]}${n}対`),
    noEars: 'ケモミミなし',
    armFan: '腕を肩に集める',
    penises: (n) => `陰茎${n}本`,
    penisRow: (n) => `陰茎は段ごとに${n}本`,
    penisLayout: { stack: '陰茎を上下に重ねる', fan: '陰茎を扇形に広げる' },
    scrotumEach: '陰茎ごとに陰嚢',
    tPose: 'Tポーズ',
  },
};

export type Describable = Pick<BodySpec, 'counts' | 'armLayout' | 'legLayout' | 'earShape'> &
  Partial<Pick<BodySpec, 'gender' | 'pose' | 'headLayout' | 'hipLegs' | 'penisLayout' | 'penisRow' | 'scrotum' | 'torsoCounts'>>;

/** 每个上半身单独设的数量照左、中、右写 */
const SIDE_ORDER: readonly TorsoSide[] = ['L', 'M', 'R'];
/** 识别标签里的哪一边（「头 左2 右1」） */
const SIDE_SHORT: Record<TorsoSide, string> = { L: tk('左@@上半身简称'), M: tk('中@@上半身简称'), R: tk('右@@上半身简称') };

/** 某一个上半身单独设的那一样怎么写 */
function ownPhrase(w: Phrases, spec: Describable, key: PerTorsoKey, n: number): string {
  switch (key) {
    case 'heads':
      return spec.headLayout === 'faces' && n > 1 ? w.faces(n) : w.heads(n);
    case 'armPairs':
      return n ? w.arms(n) : w.noArms;
    case 'chestPairs':
      return n ? w.chests(n) : w.flatChest;
    case 'hornsPerHead':
      return n ? w.horns(n) : w.noHorns;
    case 'eyesPerHead':
      return w.eyes(n);
    case 'earPairsPerHead':
      return n ? w.ears(n, spec.earShape) : w.noEars;
  }
}

/** 是不是「一个头上几张脸」（只有一个头时谈不上） */
const manyFaces = (spec: Describable) => spec.headLayout === 'faces' && spec.counts.heads > 1;

/**
 * 规范描述。lang 默认是界面语言（Node 里是中文）；中、英、日写法各一套，
 * parseDescription 三种都认，所以任何一种写出来再读回去都是同一个设定。
 */
export function describeSpec(spec: Describable, lang: Lang = LANG): string {
  const w = PHRASES[lang];
  const c = spec.counts;
  // 女性、A-pose 是默认，不写；男性和 T-pose 写出来
  const p = spec.gender === 'male' ? [w.male] : [];
  // 好几个上半身时，后面的头、手臂、胸是每个上半身各这么多
  if (c.torsos > 1) p.push(w.torsos(c.torsos));
  p.push(
    manyFaces(spec) ? w.faces(c.heads) : w.heads(c.heads),
    c.armPairs ? w.arms(c.armPairs) : w.noArms,
    c.chestPairs ? w.chests(c.chestPairs) : w.flatChest,
    w.legs(c.legs),
  );
  if (spec.legLayout !== 'auto' && legPlan(spec).form !== 'biped') {
    p.push(w.legLayout[spec.legLayout]);
    const hip = spec.hipLegs ?? HIP_LEGS.def;
    if (perHip(spec.legLayout) && hip !== HIP_LEGS.def) p.push(w.hipLegs(hip));
  }
  // 好几个上半身时某一个上半身单独设的：「左边的上半身两个头、两对手臂」
  for (const side of SIDE_ORDER) {
    if (!torsoSides(c.torsos).includes(side)) continue;
    const own = countsOf(spec, side);
    const items = PER_TORSO_KEYS.filter((key) => own[key] !== c[key]).map((key) => ownPhrase(w, spec, key, own[key]));
    if (items.length) p.push(w.torsoOwn(side, items));
  }
  if (spec.headLayout === 'wide' && c.heads > 1) p.push(w.wideTorso);
  if (c.tails) p.push(w.tails(c.tails));
  if (c.wingPairs) p.push(w.wings(c.wingPairs));
  if (c.hornsPerHead) p.push(w.horns(c.hornsPerHead));
  if (c.eyesPerHead !== 2) p.push(w.eyes(c.eyesPerHead));
  if (c.earPairsPerHead) p.push(w.ears(c.earPairsPerHead, spec.earShape));
  if (spec.armLayout === 'fan' && c.armPairs > 1) p.push(w.armFan);
  if (c.penises) {
    p.push(w.penises(c.penises));
    const layout = c.penises > 1 ? spec.penisLayout : undefined;
    if (layout === 'grid') p.push(w.penisRow(spec.penisRow ?? PENIS_ROW.def));
    else if (layout && layout !== 'row') p.push(w.penisLayout[layout]);
    if (spec.scrotum === 'each') p.push(w.scrotumEach);
  }
  if (spec.pose === 'T') p.push(w.tPose);
  return p.join(w.sep);
}

export interface Chip {
  key: CountKey;
  label: string;
}

/** 界面上那一排识别结果标签（跟着界面语言走） */
export function summarize(spec: Describable): Chip[] {
  const c = spec.counts;
  const plan = legPlan(spec);
  const feet = plan.total;
  /** 每站几条腿：每站都是一对（或更少）时只写总数，否则「3+3」 */
  const split = plan.stations.join('+');
  const legs = {
    biped: feet === 1 ? t('单足') : t('双足'),
    taur: feet === 4 ? t('人马下身') : t('人马式 {n} 足', { n: feet }),
    spider: t('蛛形 {n} 足', { n: feet }),
    // 每副胯不是一对时，把每副几条写出来：「人腿人马 3+3 足」
    humantaur: t('人腿人马 {n} 足', { n: plan.stations.every((n) => n === 2) ? feet : split }),
    tandem: t('前后 {n} 腿', { n: plan.stations.every((n) => n <= 2) ? feet : split }),
    row: t('并排 {n} 腿', { n: feet }),
    gather: t('聚拢 {n} 腿', { n: feet }),
    abreast: t('横排 {hips} 副胯 {n} 腿', { hips: plan.stations.length, n: feet }),
  }[plan.form];

  /** 好几个上半身、有上半身单独设过这一样时，把每个的数都写出来：「头 左2 右1」（拿「左2 右1」去填标签里原来的数） */
  const each = (key: PerTorsoKey, label: (n: string) => string) => {
    const sides = SIDE_ORDER.filter((side) => torsoSides(c.torsos).includes(side));
    if (sides.every((side) => countsOf(spec, side)[key] === c[key])) return null;
    return label(sides.map((side) => `${t(SIDE_SHORT[side])}${countsOf(spec, side)[key]}`).join(' '));
  };
  return [
    { key: 'torsos', label: t('上半身 {n}', { n: c.torsos }) },
    {
      key: 'heads',
      label:
        each('heads', (n) => (spec.headLayout === 'faces' ? t('脸 {n}@@数量', { n }) : t('头 {n}@@数量', { n }))) ??
        (manyFaces(spec)
          ? t('一个头 {n} 张脸', { n: c.heads })
          : spec.headLayout === 'wide' && c.heads > 1
            ? t('头 {n} · 宽躯干', { n: c.heads })
            : t('头 {n}@@数量', { n: c.heads })),
    },
    { key: 'armPairs', label: each('armPairs', (n) => t('手臂 {n} 对', { n })) ?? t('手臂 {n} 对', { n: c.armPairs }) },
    {
      key: 'chestPairs',
      label: each('chestPairs', (n) => t('胸 {n} 对', { n })) ?? (c.chestPairs ? t('胸 {n} 对', { n: c.chestPairs }) : t('平胸')),
    },
    { key: 'legs', label: legs },
    { key: 'tails', label: t('尾 {n}', { n: c.tails }) },
    { key: 'wingPairs', label: t('翼 {n} 对', { n: c.wingPairs }) },
    { key: 'hornsPerHead', label: each('hornsPerHead', (n) => t('角 {n}', { n })) ?? t('角 {n}', { n: c.hornsPerHead }) },
    { key: 'eyesPerHead', label: each('eyesPerHead', (n) => t('眼 {n}', { n })) ?? t('眼 {n}', { n: c.eyesPerHead }) },
    {
      key: 'earPairsPerHead',
      label:
        each('earPairsPerHead', (n) => t('{ear} {n} 对', { ear: EAR_NAME[spec.earShape], n })) ??
        (c.earPairsPerHead ? t('{ear} {n} 对', { ear: EAR_NAME[spec.earShape], n: c.earPairsPerHead }) : t('兽耳 0')),
    },
    // 成人部件只在有的时候列出来（开关关着时设定里一律是 0，见 model/adult.ts）
    ...(c.penises ? [{ key: 'penises' as const, label: t('阴茎 {n}', { n: c.penises }) }] : []),
  ];
}
