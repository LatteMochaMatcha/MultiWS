/**
 * BodySpec —— 角色身体的完整描述，可直接 JSON 序列化。
 * 解析器、几何生成、骨骼、导出都只依赖这一份数据，不碰 DOM。
 *
 * 约定：单位米，Y 轴朝上，角色面朝 +Z；_L / _R 以角色自身的左右为准。
 */
import { FINGER_COUNT, TOE_COUNT } from '../anime/digits';
import { t } from '../i18n';
import { cap } from './partLabel';
import { type Posing, cleanPosing, emptyPosing } from '../pose/posing';

/* ---------------- 部件数量 ---------------- */

export type CountKey =
  | 'torsos'
  | 'heads'
  | 'armPairs'
  | 'chestPairs'
  | 'legs'
  | 'tails'
  | 'wingPairs'
  | 'hornsPerHead'
  | 'eyesPerHead'
  | 'earPairsPerHead'
  | 'penises';

export type BodyCounts = Record<CountKey, number>;

export interface CountDef {
  key: CountKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  def: number;
}

/** 数量那一栏名字上的悬停说明 */
export const COUNT_HINTS: Partial<Record<keyof BodyCounts, string>> = {
  chestPairs: t('好几个上半身时每个上半身各长这么多；二次元素体两个人并成一个宽躯干时（两个上半身，或者两个头选了宽躯干，横排两副胯）按一个人算，摆在正中'),
};

export const COUNT_DEFS: readonly CountDef[] = [
  // 好几个上半身时，头、手臂、胸、翅膀是每个上半身各长这么多（见 geometry/torsos.ts）；
  // 二次元素体并成一个宽躯干的（两个头或两个上半身、横排两副胯）胸按一个人算，摆在正中（见 COUNT_HINTS）
  { key: 'torsos', label: t('上半身'), unit: t('个'), min: 1, max: 3, def: 1 },
  { key: 'heads', label: cap(t('头')), unit: t('个'), min: 1, max: 5, def: 1 },
  { key: 'armPairs', label: t('手臂'), unit: t('对'), min: 0, max: 4, def: 1 },
  { key: 'chestPairs', label: t('胸'), unit: t('对'), min: 0, max: 4, def: 1 },
  { key: 'legs', label: t('腿'), unit: t('条'), min: 1, max: 12, def: 2 },
  { key: 'tails', label: t('尾巴'), unit: t('条'), min: 0, max: 9, def: 0 },
  { key: 'wingPairs', label: t('翅膀'), unit: t('对'), min: 0, max: 3, def: 0 },
  { key: 'hornsPerHead', label: t('角'), unit: t('只 / 每个头'), min: 0, max: 4, def: 0 },
  { key: 'eyesPerHead', label: t('眼睛'), unit: t('只 / 每个头'), min: 1, max: 6, def: 2 },
  { key: 'earPairsPerHead', label: t('兽耳'), unit: t('对 / 每个头'), min: 0, max: 2, def: 0 },
  // 成人部件：设置里打开「显示成人部件」才有（见 model/adult.ts）；好几副胯时每副胯各长这么多
  { key: 'penises', label: t('阴茎'), unit: t('根 / 每副胯'), min: 0, max: 6, def: 0 },
];

export const COUNT_KEYS: readonly CountKey[] = COUNT_DEFS.map((d) => d.key);

export const COUNT_DEF_BY_KEY = Object.fromEntries(COUNT_DEFS.map((d) => [d.key, d])) as Record<
  CountKey,
  CountDef
>;

/** 好几个上半身时每个上半身可以单独设的几样（见 BodySpec.torsoCounts）；别的（翅膀、尾巴、腿……）整个身体一份 */
export const PER_TORSO_KEYS = ['heads', 'armPairs', 'chestPairs', 'hornsPerHead', 'eyesPerHead', 'earPairsPerHead'] as const;
export type PerTorsoKey = (typeof PER_TORSO_KEYS)[number];
/** 哪个上半身：L 角色的左手边（+X），R 右手边，M 正中（三个上半身时） */
export const TORSO_SIDES = ['L', 'R', 'M'] as const;
export type TorsoSide = (typeof TORSO_SIDES)[number];
/** 每个上半身单独设过的数量：没设的照 counts（「全部一样」的数） */
export type TorsoCounts = Partial<Record<TorsoSide, Partial<Record<PerTorsoKey, number>>>>;

/** 几个上半身时各在哪一边，从右往左（-X 到 +X）：两个是右、左，三个是右、中、左；一个时没有 */
export function torsoSides(torsos: number): TorsoSide[] {
  return torsos >= 3 ? ['R', 'M', 'L'] : torsos === 2 ? ['R', 'L'] : [];
}

/** 某一个上半身的数量（单独设过的那几样换成它自己的） */
export function countsOf(spec: Pick<BodySpec, 'counts' | 'torsoCounts'>, side: TorsoSide): BodyCounts {
  return { ...spec.counts, ...spec.torsoCounts?.[side] };
}

/** 用得上的几个上半身（见 torsoSides）单独设的几样是不是都和「全部一样」的数一样 */
export function torsosAlike(spec: Pick<BodySpec, 'counts' | 'torsoCounts'>): boolean {
  return torsoSides(spec.counts.torsos).every((side) => PER_TORSO_KEYS.every((key) => countsOf(spec, side)[key] === spec.counts[key]));
}

/** 一共几个头（好几个上半身时每个上半身的加起来；一个头几张脸的算一个） */
export function totalHeads(spec: Pick<BodySpec, 'counts' | 'torsoCounts' | 'headLayout'>): number {
  const per = (c: BodyCounts) => (spec.headLayout === 'faces' ? 1 : c.heads);
  const sides = torsoSides(spec.counts.torsos);
  return sides.length ? sides.reduce((sum, side) => sum + per(countsOf(spec, side)), 0) : per(spec.counts);
}

/** 以「对」计数的部件：文字里给个数时取 ceil(n / 2)。其余按个数计，给「对」时乘 2。腿按条数计（可以是单数） */
export const PAIRED_KEYS: ReadonlySet<CountKey> = new Set<CountKey>([
  'armPairs',
  'chestPairs',
  'wingPairs',
  'earPairsPerHead',
]);

/* ---------------- 体型参数 ---------------- */

export type ShapeKey =
  | 'height'
  | 'headRatio'
  | 'build'
  | 'shoulders'
  | 'bust'
  | 'waist'
  | 'hips'
  | 'limbs'
  | 'armLength'
  | 'legLength'
  | 'tailFluff'
  | 'tailLength'
  | 'penisSize';

export type BodyShape = Record<ShapeKey, number>;

export interface ShapeDef {
  key: ShapeKey;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
  /**
   * 「常用的」那一段：查过各种组合都不穿模的范围（2026-10-31 以前滑块就是这么宽）。
   * 滑块可以拉得比它更大、更小，那一截不保证不穿模（开发模式下左上角会提示）。缺省就是整个范围
   */
  safe?: [min: number, max: number];
}

/** 胸部大小滑块 2.2 以上（到 2.3）只有二次元素体照着变大（白模人台、成品角色到 2.2 为止） */
export const BUST_MAX_OTHER = 2.2;

export const SHAPE_DEFS: readonly ShapeDef[] = [
  { key: 'height', label: t('身高'), min: 1.2, max: 2.2, step: 0.01, def: 1.62, unit: 'm' },
  { key: 'headRatio', label: t('头身比'), min: 6, max: 9, step: 0.1, def: 7.5 },
  { key: 'build', label: t('体格'), min: 0.7, max: 1.5, step: 0.01, def: 1, safe: [0.8, 1.3] },
  { key: 'shoulders', label: t('肩宽'), min: 0.75, max: 1.6, step: 0.01, def: 1, safe: [0.85, 1.3] },
  { key: 'bust', label: t('胸部大小'), min: 0.3, max: 2.3, step: 0.01, def: 1, safe: [0.3, 1.6] },
  { key: 'waist', label: t('腰宽'), min: 0.7, max: 1.6, step: 0.01, def: 1, safe: [0.8, 1.3] },
  { key: 'hips', label: t('胯宽'), min: 0.7, max: 1.8, step: 0.01, def: 1, safe: [0.8, 1.4] },
  { key: 'limbs', label: t('四肢粗细'), min: 0.5, max: 2, step: 0.01, def: 1, safe: [0.8, 1.3] },
  { key: 'armLength', label: t('手臂长短'), min: 0.5, max: 2, step: 0.01, def: 1, safe: [1, 1] },
  { key: 'legLength', label: t('腿长短'), min: 0.5, max: 1.8, step: 0.01, def: 1, safe: [1, 1] },
  { key: 'tailFluff', label: t('尾巴蓬松'), min: 0, max: 3, step: 0.01, def: 0.4, safe: [0, 2] },
  { key: 'tailLength', label: t('尾巴长度'), min: 0.3, max: 3, step: 0.01, def: 1, safe: [0.5, 2] },
  { key: 'penisSize', label: t('阴茎大小'), min: 0.5, max: 1.6, step: 0.01, def: 1 },
];

export const SHAPE_KEYS: readonly ShapeKey[] = SHAPE_DEFS.map((d) => d.key);

export const SHAPE_DEF_BY_KEY = Object.fromEntries(SHAPE_DEFS.map((d) => [d.key, d])) as Record<
  ShapeKey,
  ShapeDef
>;

/* ---------------- 排布与选项 ---------------- */

/**
 * 多个头怎么长：
 * cluster 凑成一簇，各有各的脖子；
 * faces 一个头上长几张脸，共用一个脖子（阿修罗、梵天那种「三面」「四面」）；
 * wide 宽躯干：两个头各有自己的肩膀，并成一个两个人宽的躯干，手臂只长在两边外侧。只在二次元素体、一个上半身、
 * 两个头、横排两副胯（每副两条腿）时这样，别的组合照 cluster。
 */
export const HEAD_LAYOUTS = ['cluster', 'faces', 'wide'] as const;
export type HeadLayout = (typeof HEAD_LAYOUTS)[number];

/** 多对手臂：沿躯干上下排 / 肩部扇形聚拢 */
export const ARM_LAYOUTS = ['stack', 'fan'] as const;
export type ArmLayout = (typeof ARM_LAYOUTS)[number];

/**
 * 三条以上的腿怎么排：
 * auto 自动（4 条人马式，6 条以上蛛形，单数左右并排）、taur 人马式（沿水平躯干前后排）、
 * spider 蛛形（头胸部向两侧放射）、
 * humantaur 人腿人马（像人马，但后半截不是马：身后横着一截人的腰，接着又一副人的胯和腿）、
 * tandem 人腿前后串联、row 人腿左右并排、gather 人腿胯部聚拢（像手臂肩部聚拢：几副胯一副紧贴着一副，
 * 每副两条腿，腿往下一对比一对往外散开，正面看像一把扇子）、abreast 人腿横排多胯（几副完整的胯左右并排，
 * 各有自己的屁股和胯下，每副两条腿，单数时正中那副一条，左右对称；上半身还是一个，坐在正中）。人腿人马、前后串联每副胯几条腿见 BodySpec.hipLegs。
 * 人马、蛛形的腿只能成对，单数时多补一条；人腿的几种单数时多出来的那条长在中线上（并排的在正中，前后排、聚拢的在最后那副胯的正中）。
 */
export const LEG_LAYOUTS = ['auto', 'taur', 'spider', 'humantaur', 'tandem', 'row', 'gather', 'abreast'] as const;
export type LegLayout = (typeof LEG_LAYOUTS)[number];

/** 实际采用的下身形态（auto 已解析；一两条腿、又不是人腿人马的，是 biped：一条腿就是单足） */
export type LegForm = 'biped' | 'taur' | 'spider' | 'humantaur' | 'tandem' | 'row' | 'gather' | 'abreast';

/**
 * 一副胯上好几根阴茎怎么排（根部都挤在小腹正中一处）：row 左右并排、stack 上下叠（一根正叠在一根上面）、
 * fan 扇形散开（往两边张开）、grid 几乘几（几排上下叠、每排左右并排，每排几根见 BodySpec.penisRow）。
 * 阴囊：shared 几根共用一个（摆在正中，根数多了跟着变大）、each 每根各带一个（小一圈）
 */
export const PENIS_LAYOUTS = ['row', 'stack', 'fan', 'grid'] as const;
export type PenisLayout = (typeof PENIS_LAYOUTS)[number];
export const SCROTUM_MODES = ['shared', 'each'] as const;
export type ScrotumMode = (typeof SCROTUM_MODES)[number];

export const POSES = ['A', 'T'] as const;
export type Pose = (typeof POSES)[number];

export const GENDERS = ['female', 'male'] as const;
export type Gender = (typeof GENDERS)[number];

export const EAR_SHAPES = ['cat', 'fox', 'rabbit', 'elf'] as const;
export type EarShape = (typeof EAR_SHAPES)[number];

/** 手：并指手套形 / 分指 */
export const HAND_STYLES = ['mitten', 'fingers'] as const;
export type HandStyle = (typeof HAND_STYLES)[number];

/**
 * 手臂、腿的末端接什么（手脚互换，见 anime/swap.ts）：手臂默认接手、腿默认接脚，
 * 换过来就是手臂接脚（手臂垂下来时脚底朝下、脚趾朝前）、腿接手（手心朝下贴地、手指朝前）
 */
export const LIMB_ENDS = ['hand', 'foot'] as const;
export type LimbEnd = (typeof LIMB_ENDS)[number];

/** queen conjoined 连体：不连、同向（两个上半身都胸口朝下）、反向（一个仰面朝上），见 geometry/conjoined.ts */
export const CONJOINS = ['none', 'same', 'opposite'] as const;
export type ConjoinMode = (typeof CONJOINS)[number];
/** 连体静止时的姿态：趴着（四只手撑地）、侧躺（胳膊肘撑着）、平躺（仰面躺平）、站着（下面那个倒立撑地） */
export const CONJOIN_POSES = ['prone', 'lie', 'flat', 'stand'] as const;
export type ConjoinPose = (typeof CONJOIN_POSES)[number];

/** 一条手臂、腿单独的设法：末端接什么、手指几根、脚趾几个；不写的跟着 BodySpec 里统一的 */
export interface LimbSetting {
  end?: LimbEnd;
  fingers?: number;
  toes?: number;
}
/** 能单独设的部件：手臂 Arm_01_L、人腿 Leg_01_L（中线上的腿 Leg_01） */
export const LIMB_PART = /^(Arm|Leg)_\d+(_[LR])?$/;

/** 这一条手臂（Arm_…）、腿（Leg_…）实际用的设法：单独设过的照它，没设的跟着统一的 */
export function limbOf(spec: Pick<BodySpec, 'armEnd' | 'legEnd' | 'fingers' | 'toes' | 'perLimb'>, name: string): Required<LimbSetting> {
  const own = spec.perLimb[name] ?? {};
  return {
    end: own.end ?? (name.startsWith('Arm') ? spec.armEnd : spec.legEnd),
    fingers: own.fingers ?? spec.fingers,
    toes: own.toes ?? spec.toes,
  };
}

/**
 * 身体的样式：
 * - mannequin：白模人台，自己捏的，体型滑块都管用；
 * - anime：二次元素体，现成的裸素体做成的白模，体型在她原来的样子上拉宽、压窄、变粗变细；
 * - character：成品角色，带头发、衣服和贴图的现成模型，多出来的头和手臂是复制她自己的接上去。
 * 多出来的头、手臂三种都能拼。
 */
export const BODY_STYLES = ['mannequin', 'anime', 'character'] as const;
export type BodyStyle = (typeof BODY_STYLES)[number];

/**
 * 「成品角色」样式用哪个角色。每个角色是一个现成的 VRoid 模型，来历和许可见 character/roster.ts；
 * 第一个（vita）是一开始就有的那个，也是默认的。别的身体样式用不到这一项。
 */
export const CHARACTER_IDS = ['vita', 'victoria', 'shino', 'shibu', 'vivi', 'rabbit', 'kuro', 'sailor', 'alice', 'kotori', 'fumiriya', 'haruto', 'noble', 'fritz', 'shinya', 'marron'] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];
/**
 * 「载入自己的 VRM」：用户自己给的角色文件。文件不随工坊分发，也不写进配置文件，
 * 存在这台设备的浏览器里（见 io/keepFile.ts）；配置里只记「用的是自己的」
 */
export const OWN_CHARACTER = 'own' as const;
export type CharacterChoice = CharacterId | typeof OWN_CHARACTER;

/** 网格：融合成一整块 / 保留 v1 的分部件 */
export const MESH_MODES = ['fused', 'parts'] as const;
export type MeshMode = (typeof MESH_MODES)[number];

/* ---------------- 头发 ---------------- */

/**
 * 成品角色的发型。own 是她原装的头发；其余几种是从别的现成模型上取下来的头发（都是 pixiv 以 CC0 发布的 VRoid 样例，
 * 见 character/hair.ts），整个换到她头上：
 * long 长直发、sidetail 侧马尾、bob 波波头、twintails 双马尾。
 * 白模人台和二次元素体没有头发，这一栏对它们不起作用。
 */
export const HAIR_STYLES = ['own', 'long', 'sidetail', 'bob', 'twintails'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export interface HairSpec {
  style: HairStyle;
  /** 发色，#rrggbb；空字符串是不染，用这个发型本来的颜色 */
  color: string;
  /** 长度的倍率：耳朵以下垂着的那一段拉长、缩短多少 */
  length: number;
  /** 蓬松的倍率：整个头发以头为中心放大、缩小多少 */
  volume: number;
  /**
   * 几个头分开染（成品角色、几个头凑成一簇时才用得上）：第 i 项是第 i 个头（Head_01 是角色自己的那个，见 headHairColor）。
   * 空字符串是跟着上面的 color 走；HAIR_UNDYED 是这个头不染，用本来的颜色；别的是 #rrggbb。末尾的空项去掉
   */
  heads: string[];
}

/** HairSpec.heads 里的「这个头不染」 */
export const HAIR_UNDYED = 'none';

export const HAIR_LENGTH = { min: 0.6, max: 1.5, step: 0.01, def: 1 } as const;
/** 蓬松往小调的余地很少：再小头发就陷进头皮里了 */
export const HAIR_VOLUME = { min: 0.97, max: 1.2, step: 0.005, def: 1 } as const;

export function defaultHair(): HairSpec {
  return { style: 'own', color: '', length: HAIR_LENGTH.def, volume: HAIR_VOLUME.def, heads: [] };
}

/** 第 index 个头的头发染成什么颜色：#rrggbb，空字符串是不染 */
export function headHairColor(hair: HairSpec, index: number): string {
  const own = hair.heads[index] ?? '';
  return own === HAIR_UNDYED ? '' : own || hair.color;
}

/** 整理 HairSpec.heads：每项是空、HAIR_UNDYED 或颜色，最多和头一样多，末尾的空项去掉 */
function cleanHeadColors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = value.slice(0, COUNT_DEF_BY_KEY.heads.max).map((v) => (v === HAIR_UNDYED ? HAIR_UNDYED : cleanColor(v)));
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

/** #rrggbb（或 #rgb）→ 小写的 #rrggbb；不是颜色就返回空字符串 */
export function cleanColor(value: unknown): string {
  if (typeof value !== 'string') return '';
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return '';
  const hex = m[1].length === 3 ? [...m[1]].map((ch) => ch + ch).join('') : m[1];
  return `#${hex.toLowerCase()}`;
}

/** #rrggbb → 线性空间的 RGB（0–1） */
export function colorToLinear(hex: string): [number, number, number] {
  const n = Number.parseInt(cleanColor(hex).slice(1) || '000000', 16);
  const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return [linear(((n >> 16) & 255) / 255), linear(((n >> 8) & 255) / 255), linear((n & 255) / 255)];
}

/** 人腿人马、前后串联每副胯上几条腿（并排着）：2 是一对，3 就是「前三后三」那种 */
export const HIP_LEGS = { min: 1, max: 4, def: 2 } as const;

/** 一只手几根手指（连拇指）。只管分指的手（白模人台、二次元素体），成品角色的手是角色自己的 */
export const FINGERS = { min: FINGER_COUNT.min, max: FINGER_COUNT.max, def: FINGER_COUNT.base } as const;

/** 一只脚几个脚趾。只管二次元素体的脚（白模人台的脚没有脚趾，成品角色的脚是角色自己的） */
export const TOES = { min: TOE_COUNT.min, max: TOE_COUNT.max, def: TOE_COUNT.base } as const;

/** 阴茎排成几乘几时每排几根（左右并排着）：根数不是它的整数倍时，最上面那排少几根 */
export const PENIS_ROW = { min: 1, max: 4, def: 2 } as const;

/** 融合圆角的半径：不同部件交界处（肩、髋、颈）圆滑过渡的范围，米（按标准人台算） */
export const BLEND = { min: 0, max: 0.04, step: 0.001, def: 0.02 } as const;

/* ---------------- 手动微调 ---------------- */

export type Vec3 = [number, number, number];

/** 单个部件实例的覆盖值；缺省的分量表示不覆盖。 */
export interface PartOverride {
  /**
   * 位置偏移，沿父部件的轴：X 是角色的左手边，Y 朝上，Z 朝前（父部件是头时，就是头自己的左、上、前）。
   * 单位是摆位用的标准人台（1.76 m 上下）的米：身高、头的大小变了，偏移跟着等比变化。
   */
  position?: Vec3;
  /** 追加旋转：绕父部件的 X、Y、Z 轴，欧拉角 XYZ，度。绕着部件自己的关节转 */
  rotation?: Vec3;
  /** 缩放倍率，以关节为中心。三个数一样就是等比缩放 */
  scale?: Vec3;
}

/** 微调的取值范围：位置 ±3，角度 ±180°，缩放 0.05–10 倍 */
export const OVERRIDE_LIMITS = { position: 3, rotation: 180, scaleMin: 0.05, scaleMax: 10 } as const;

/**
 * 把一条微调收进范围、去掉多余的小数；等于「没改」的分量丢掉。
 * 整条都等于没改时返回 null。
 */
export function cleanOverride(o: PartOverride): PartOverride | null {
  const tidy = (v: Vec3 | undefined, min: number, max: number, digits: number, identity: number): Vec3 | undefined => {
    if (!v) return undefined;
    const k = 10 ** digits;
    // 加 0 是为了把 -0 变成 0
    const out = v.map((n) => Math.round(clamp(n, min, max) * k) / k + 0) as Vec3;
    return out.every((n) => n === identity) ? undefined : out;
  };
  const L = OVERRIDE_LIMITS;
  const position = tidy(o.position, -L.position, L.position, 4, 0);
  const rotation = tidy(o.rotation, -L.rotation, L.rotation, 2, 0);
  const scale = tidy(o.scale, L.scaleMin, L.scaleMax, 3, 1);
  if (!position && !rotation && !scale) return null;
  return { ...(position && { position }), ...(rotation && { rotation }), ...(scale && { scale }) };
}

/* ---------------- BodySpec ---------------- */

/** 第 3 版起腿按条数记（counts.legs）；第 2 版和 v1 记的是对数 */
export const SPEC_VERSION = 3;

export interface BodySpec {
  version: typeof SPEC_VERSION;
  counts: BodyCounts;
  shape: BodyShape;
  bodyStyle: BodyStyle;
  /** 成品角色用哪一个，见 CHARACTER_IDS；OWN_CHARACTER 是用户自己载入的 VRM */
  character: CharacterChoice;
  gender: Gender;
  headLayout: HeadLayout;
  armLayout: ArmLayout;
  legLayout: LegLayout;
  /** 人腿人马、前后串联每副胯上几条腿，见 HIP_LEGS。腿的总数不是它的整数倍时，最后那副胯少几条 */
  hipLegs: number;
  /** 一副胯上好几根阴茎怎么排、阴囊共用还是各带一个，见 PENIS_LAYOUTS、SCROTUM_MODES */
  penisLayout: PenisLayout;
  /** 阴茎排成几乘几时每排几根，见 PENIS_ROW */
  penisRow: number;
  scrotum: ScrotumMode;
  /** 阴茎是软的（疲软）：根部、几根、排法、大小照旧，整根小一圈、往下垂（见 geometry/genital.ts 的 SOFT_SIZE）。不写进描述 */
  penisSoft: boolean;
  pose: Pose;
  earShape: EarShape;
  hands: HandStyle;
  /** 一只手几根手指（连拇指），见 FINGERS 和 anime/digits.ts */
  fingers: number;
  /** 一只脚几个脚趾，见 TOES */
  toes: number;
  /** 手臂末端接手还是脚、腿末端接脚还是手（手脚互换）。成品角色不管这两项 */
  armEnd: LimbEnd;
  legEnd: LimbEnd;
  /** 某一条手臂、腿单独的设法（部件名 → 末端、手指数、脚趾数），没写的那几项跟着上面统一的 */
  perLimb: Record<string, LimbSetting>;
  /** queen conjoined 连体：两个上半身在腰上对接、四条手臂撑地，没有胯和腿（腿、尾巴、阴茎、几个上半身都不管） */
  conjoined: ConjoinMode;
  /** 连体静止时是趴着、侧躺、平躺还是站着 */
  conjoinPose: ConjoinPose;
  hair: HairSpec;
  meshMode: MeshMode;
  /** 融合圆角的半径，见 BLEND */
  blend: number;
  /** 手动微调（白模人台、二次元素体）。键是部件实例名，例如 "Arm_02_L"、"Head_01"、"Tail_03" */
  overrides: Record<string, PartOverride>;
  /**
   * 成品角色的手动微调，单独记一份（见 character/tweak.ts）：部件同名，但成品角色是照骨骼挪的，
   * 位置的单位是米，第几对手臂的排法也和白模人台不一样，两边的数值互相套不上
   */
  characterOverrides: Record<string, PartOverride>;
  /** 摆的姿势（在上面的 pose 那个静止姿势上又摆的）。键是骨骼名，见 pose/posing.ts */
  posing: Posing;
  /** 好几个上半身时每个上半身单独设的头、手臂、胸、角、眼睛、兽耳（见 TorsoCounts）；成品角色不看它 */
  torsoCounts?: TorsoCounts;
  /**
   * 成品角色好几个上半身时，某个上半身换成别的角色（比如一个男生、一个女生）：没设的、和 character 一样的照 character。
   * 胯、腿照 character；两种白模不看它
   */
  torsoCharacters?: TorsoCharacters;
}

/** 每个上半身换成了哪个成品角色（见 BodySpec.torsoCharacters） */
export type TorsoCharacters = Partial<Record<TorsoSide, CharacterId>>;

/** 整理 torsoCharacters：只留认得的角色 */
export function cleanTorsoCharacters(value: unknown): TorsoCharacters {
  const out: TorsoCharacters = {};
  if (!isRecord(value)) return out;
  for (const side of TORSO_SIDES) {
    const id = value[side];
    if ((CHARACTER_IDS as readonly unknown[]).includes(id)) out[side] = id as CharacterId;
  }
  return out;
}

export function defaultCounts(): BodyCounts {
  return Object.fromEntries(COUNT_DEFS.map((d) => [d.key, d.def])) as BodyCounts;
}

export function defaultShape(): BodyShape {
  return Object.fromEntries(SHAPE_DEFS.map((d) => [d.key, d.def])) as BodyShape;
}

export function defaultSpec(): BodySpec {
  return {
    version: SPEC_VERSION,
    counts: defaultCounts(),
    shape: defaultShape(),
    bodyStyle: 'mannequin',
    character: 'vita',
    gender: 'female',
    headLayout: 'cluster',
    armLayout: 'stack',
    legLayout: 'auto',
    hipLegs: HIP_LEGS.def,
    penisLayout: 'row',
    penisRow: PENIS_ROW.def,
    scrotum: 'shared',
    penisSoft: false,
    pose: 'A',
    earShape: 'cat',
    hands: 'fingers',
    fingers: FINGERS.def,
    toes: TOES.def,
    armEnd: 'hand',
    legEnd: 'foot',
    perLimb: {},
    conjoined: 'none',
    conjoinPose: 'prone',
    hair: defaultHair(),
    meshMode: 'fused',
    blend: BLEND.def,
    overrides: {},
    characterOverrides: {},
    posing: emptyPosing(),
    torsoCounts: {},
    torsoCharacters: {},
  };
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** 取整并收进各自范围；非数字回落到默认值。返回新对象。 */
export function clampCounts(counts: Partial<BodyCounts>): BodyCounts {
  const out = defaultCounts();
  for (const d of COUNT_DEFS) {
    const v = counts[d.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[d.key] = clamp(Math.round(v), d.min, d.max);
  }
  return out;
}

export function clampShape(shape: Partial<BodyShape>): BodyShape {
  const out = defaultShape();
  for (const d of SHAPE_DEFS) {
    const v = shape[d.key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[d.key] = Math.round(clamp(v, d.min, d.max) * 1000) / 1000;
    }
  }
  return out;
}

/** 整理每个上半身单独设的数量：只留认得的上半身和那几样，数值取整收进范围；空的去掉 */
export function clampTorsoCounts(value: unknown): TorsoCounts {
  const out: TorsoCounts = {};
  if (!isRecord(value)) return out;
  for (const side of TORSO_SIDES) {
    const src = value[side];
    if (!isRecord(src)) continue;
    const own: Partial<Record<PerTorsoKey, number>> = {};
    for (const key of PER_TORSO_KEYS) {
      const v = src[key];
      const d = COUNT_DEF_BY_KEY[key];
      if (typeof v === 'number' && Number.isFinite(v)) own[key] = clamp(Math.round(v), d.min, d.max);
    }
    if (Object.keys(own).length) out[side] = own;
  }
  return out;
}

export function clampBlend(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return BLEND.def;
  return Math.round(clamp(value, BLEND.min, BLEND.max) * 10000) / 10000;
}

/** 把任意来源的头发设定整理成合法的：缺的补默认值，越界的收回范围 */
export function clampHair(hair: unknown): HairSpec {
  const src = isRecord(hair) ? hair : {};
  const def = defaultHair();
  const number = (v: unknown, range: { min: number; max: number; def: number }) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(clamp(v, range.min, range.max) * 1000) / 1000 : range.def;
  return {
    style: pick(HAIR_STYLES, src.style, def.style),
    color: cleanColor(src.color),
    length: number(src.length, HAIR_LENGTH),
    volume: number(src.volume, HAIR_VOLUME),
    heads: cleanHeadColors(src.heads),
  };
}

export function clampFingers(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return FINGERS.def;
  return clamp(Math.round(value), FINGERS.min, FINGERS.max);
}

export function clampToes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return TOES.def;
  return clamp(Math.round(value), TOES.min, TOES.max);
}

/** 读存档里的 perLimb：只留手臂、人腿的名字和合法的值，空的去掉 */
function cleanPerLimb(src: unknown): Record<string, LimbSetting> {
  const out: Record<string, LimbSetting> = {};
  if (!src || typeof src !== 'object') return out;
  for (const [name, raw] of Object.entries(src as Record<string, unknown>)) {
    if (!LIMB_PART.test(name) || !raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const one: LimbSetting = {};
    if (r.end === 'hand' || r.end === 'foot') one.end = r.end;
    if (typeof r.fingers === 'number' && Number.isFinite(r.fingers)) one.fingers = clampFingers(r.fingers);
    if (typeof r.toes === 'number' && Number.isFinite(r.toes)) one.toes = clampToes(r.toes);
    if (Object.keys(one).length) out[name] = one;
  }
  return out;
}

export function clampHipLegs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return HIP_LEGS.def;
  return clamp(Math.round(value), HIP_LEGS.min, HIP_LEGS.max);
}

export function clampPenisRow(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return PENIS_ROW.def;
  return clamp(Math.round(value), PENIS_ROW.min, PENIS_ROW.max);
}

/** 这种排法是不是一副胯一副胯往后排的人腿（每副胯几条腿看 hipLegs） */
export const perHip = (legLayout: LegLayout) => legLayout === 'humantaur' || legLayout === 'tandem';

export function resolveLegForm(legs: number, legLayout: LegLayout, hipLegs: number = HIP_LEGS.def): LegForm {
  // 人腿人马、前后串联：一副胯装不下才算（「前一后一」两条腿也算）
  if (perHip(legLayout) && legs > hipLegs) return legLayout;
  if (legs < 3) return 'biped';
  if (legLayout === 'auto') return legs % 2 ? 'row' : legs === 4 ? 'taur' : 'spider';
  // 一副胯就装得下：就是并排
  if (perHip(legLayout)) return 'row';
  return legLayout;
}

/** 人腿前后排（串联、人腿人马）最多几副胯 */
export const MAX_HIPS = 6;

export interface LegPlan {
  form: LegForm;
  /**
   * 从前往后每一站几条腿：双足、并排只有一站；串联、人腿人马每副胯一站；聚拢每副胯一站（两条，单数时最后一站一条）；
   * 横排多胯从右往左每副胯一站（两条，单数时正中那站一条，见 abreastStations）；
   * 人马、蛛形每对腿一站（恒为 2）。
   * 一站里的腿左右并排，单数时正中一条
   */
  stations: number[];
  /** 实际拼出来几条腿（人马、蛛形单数时多补一条，前后排的超过 MAX_HIPS 副胯时少几条） */
  total: number;
}

/** 腿实际怎么摆：三种身体样式、描述文字都照这个 */
export function legPlan(spec: Pick<BodySpec, 'counts' | 'legLayout'> & Partial<Pick<BodySpec, 'hipLegs'>>): LegPlan {
  const legs = spec.counts.legs;
  const hip = spec.hipLegs ?? HIP_LEGS.def;
  const form = resolveLegForm(legs, spec.legLayout, hip);
  /** n 条腿每 size 条一站，最后一站少几条 */
  const chunk = (n: number, size: number) =>
    Array.from({ length: Math.min(Math.ceil(n / size), MAX_HIPS) }, (_, k) => Math.min(size, n - k * size));
  const stations =
    form === 'biped' || form === 'row'
      ? [legs]
      : form === 'taur' || form === 'spider'
        ? Array.from({ length: Math.ceil(legs / 2) }, () => 2)
        : form === 'abreast'
          ? abreastStations(legs)
          : chunk(legs, form === 'gather' ? 2 : hip);
  return { form, stations, total: stations.reduce((a, b) => a + b, 0) };
}

/**
 * 横排多胯从右往左（-X 到 +X）每副胯几条腿：每副两条，左右对称地排。
 * 单数条时正中那副一条；这样两边的对数不一样多的（3、7、11 条），正中是三副各一条的
 */
function abreastStations(legs: number): number[] {
  const pairs = Math.floor(legs / 2);
  if (legs % 2 === 0) return Array.from({ length: pairs }, () => 2);
  const side = Array.from({ length: Math.floor(pairs / 2) }, () => 2);
  return [...side, ...(pairs % 2 ? [1, 1, 1] : [1]), ...side];
}

/* ---------------- 读入 / 保存 ---------------- */

/** v1 配置文件里的旧键名（v1 的 legs 是对数，在 normalizeSpec 里换算） */
const V1_COUNT_ALIAS: Record<string, CountKey> = {
  arms: 'armPairs',
  chest: 'chestPairs',
  wings: 'wingPairs',
  horns: 'hornsPerHead',
  eyes: 'eyesPerHead',
};
const V1_SHAPE_ALIAS: Record<string, ShapeKey> = { fluff: 'tailFluff' };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function pick<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function readVec3(v: unknown): Vec3 | undefined {
  if (!Array.isArray(v) || v.length !== 3) return undefined;
  if (!v.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
  return [v[0], v[1], v[2]];
}

function readOverrides(v: unknown): Record<string, PartOverride> {
  const out: Record<string, PartOverride> = {};
  if (!isRecord(v)) return out;
  for (const [name, raw] of Object.entries(v)) {
    if (!isRecord(raw)) continue;
    const o = cleanOverride({
      position: readVec3(raw.position),
      rotation: readVec3(raw.rotation),
      scale: readVec3(raw.scale),
    });
    if (o) out[name] = o;
  }
  return out;
}

/**
 * 把任意来源的数据（localStorage、用户载入的 JSON、v1 配置）整理成合法的 BodySpec。
 * 缺的字段补默认值，越界的数值收回范围，不认识的字段丢弃。
 */
export function normalizeSpec(input: unknown): BodySpec {
  const src = isRecord(input) ? input : {};

  const counts: Partial<BodyCounts> = {};
  // 第 3 版以前腿记的是对数：第 2 版叫 legPairs，v1 叫 legs
  const pairsBefore = typeof src.version !== 'number' || src.version < 3;
  if (isRecord(src.counts)) {
    for (const [k, v] of Object.entries(src.counts)) {
      if (typeof v !== 'number') continue;
      if (k === 'legPairs' || (k === 'legs' && pairsBefore)) {
        counts.legs = v * 2;
        continue;
      }
      const key = V1_COUNT_ALIAS[k] ?? k;
      if (key in COUNT_DEF_BY_KEY) counts[key as CountKey] = v;
    }
  }

  const shape: Partial<BodyShape> = {};
  if (isRecord(src.shape)) {
    for (const [k, v] of Object.entries(src.shape)) {
      const key = V1_SHAPE_ALIAS[k] ?? k;
      if (key in SHAPE_DEF_BY_KEY && typeof v === 'number') shape[key as ShapeKey] = v;
    }
  }

  const v1Layout = src.layout === 'shoulder' ? 'fan' : src.layout;

  return {
    version: SPEC_VERSION,
    counts: clampCounts(counts),
    shape: clampShape(shape),
    bodyStyle: pick(BODY_STYLES, src.bodyStyle, 'mannequin'),
    character: pick<CharacterChoice>([...CHARACTER_IDS, OWN_CHARACTER], src.character, 'vita'),
    gender: pick(GENDERS, src.gender, 'female'),
    headLayout: pick(HEAD_LAYOUTS, src.headLayout, 'cluster'),
    armLayout: pick(ARM_LAYOUTS, src.armLayout ?? v1Layout, 'stack'),
    legLayout: pick(LEG_LAYOUTS, src.legLayout, 'auto'),
    hipLegs: clampHipLegs(src.hipLegs),
    penisLayout: pick(PENIS_LAYOUTS, src.penisLayout, 'row'),
    penisRow: clampPenisRow(src.penisRow),
    scrotum: pick(SCROTUM_MODES, src.scrotum, 'shared'),
    penisSoft: src.penisSoft === true,
    pose: pick(POSES, src.pose, 'A'),
    earShape: pick(EAR_SHAPES, src.earShape, 'cat'),
    hands: pick(HAND_STYLES, src.hands, 'fingers'),
    fingers: clampFingers(src.fingers),
    toes: clampToes(src.toes),
    armEnd: pick(LIMB_ENDS, src.armEnd, 'hand'),
    legEnd: pick(LIMB_ENDS, src.legEnd, 'foot'),
    perLimb: cleanPerLimb(src.perLimb),
    conjoined: pick(CONJOINS, src.conjoined, 'none'),
    conjoinPose: pick(CONJOIN_POSES, src.conjoinPose, 'prone'),
    hair: clampHair(src.hair),
    meshMode: pick(MESH_MODES, src.meshMode, 'fused'),
    blend: clampBlend(src.blend),
    overrides: readOverrides(src.overrides),
    characterOverrides: readOverrides(src.characterOverrides),
    posing: cleanPosing(src.posing),
    torsoCounts: clampTorsoCounts(src.torsoCounts),
    torsoCharacters: cleanTorsoCharacters(src.torsoCharacters),
  };
}

export function serializeSpec(spec: BodySpec, text?: string): string {
  return JSON.stringify({ app: 'oc-basemesh', ...withoutAdultKeys(spec), ...(text === undefined ? {} : { text }) }, null, 2);
}

/**
 * 没长阴茎、阴茎那几项也都是默认的：存的时候不写这几个键（读的时候 normalizeSpec 会补上默认值）。
 * 没打开过「显示成人部件」的人存下来的配置里不出现它们（见 model/adult.ts）
 */
function withoutAdultKeys(spec: BodySpec): object {
  const def = defaultSpec();
  if (spec.counts.penises || spec.shape.penisSize !== def.shape.penisSize || spec.penisLayout !== def.penisLayout || spec.penisRow !== def.penisRow || spec.scrotum !== def.scrotum || spec.penisSoft)
    return spec;
  const { penises: _p, ...counts } = spec.counts;
  const { penisSize: _s, ...shape } = spec.shape;
  const { penisLayout: _l, penisRow: _r, scrotum: _c, penisSoft: _f, ...rest } = spec;
  return { ...rest, counts, shape };
}

/** 解析配置文件文本；不是合法 JSON 时抛错。 */
export function parseSpecJson(json: string): BodySpec {
  return normalizeSpec(JSON.parse(json));
}
