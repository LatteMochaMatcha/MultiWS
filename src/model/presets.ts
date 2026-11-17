import { t } from '../i18n';
import { chuSpec } from './chu';
import {
  type ArmLayout,
  type BodyCounts,
  type BodyShape,
  type BodySpec,
  type EarShape,
  type HeadLayout,
  type LegLayout,
  type RingChestMode,
  type RingMode,
  CHEST_ROW,
  HIP_LEGS,
  clampShape,
  defaultCounts,
} from './spec';

export interface Preset {
  name: string;
  counts?: Partial<BodyCounts>;
  shape?: Partial<BodyShape>;
  headLayout?: HeadLayout;
  armLayout?: ArmLayout;
  legLayout?: LegLayout;
  earShape?: EarShape;
  /** 胸每排几个（没写就是缺省的一对一对） */
  chestRow?: number;
  /** 围成一圈：哪种排法、几个人、松紧、胸怎么排；前后排的胯几排、每排几个（没写的不动） */
  ring?: RingMode;
  ringCount?: number;
  ringSpread?: number;
  ringChest?: RingChestMode;
  ringHipRows?: number;
  ringHipsPerRow?: number;
  /** 数量、排法、体型都套好以后，再把设定加工一遍：用体块拼出来的预设在这里换成自己的数量、体型，把胯、胸腔一块一块复制出来摆好（见 model/chu.ts） */
  build?: (spec: BodySpec) => BodySpec;
}

export const PRESETS: readonly Preset[] = [
  { name: t('标准人形') },
  { name: t('双头'), counts: { heads: 2 } },
  { name: t('四臂'), counts: { armPairs: 2 } },
  { name: t('两对胸'), counts: { breasts: 4 } },
  // 阿修罗是「三面六臂」：一个头上三张脸，不是三个头
  { name: t('阿修罗'), counts: { heads: 3, armPairs: 3 }, headLayout: 'faces', armLayout: 'fan' },
  { name: t('半人马'), counts: { legs: 4 }, legLayout: 'taur' },
  { name: t('蜘蛛女'), counts: { legs: 8 }, legLayout: 'spider' },
  { name: t('九尾狐'), counts: { tails: 9, earPairsPerHead: 1 }, earShape: 'fox', shape: { tailFluff: 1.4 } },
  { name: t('六翼天使'), counts: { wingPairs: 3 } },
  { name: t('三眼'), counts: { eyesPerHead: 3 } },
  { name: t('龙娘'), counts: { hornsPerHead: 2, wingPairs: 1, tails: 1 }, shape: { tailFluff: 0.2 } },
  { name: t('兽耳娘'), counts: { earPairsPerHead: 1, tails: 1 }, earShape: 'cat', shape: { tailFluff: 0.6 } },
  // 六个头、九副胯：前排三个、后排三个背靠背，前中后三排胯；每侧前后两组各三条手臂，胸前后两面各排成上宽下尖的一串（从上到下 6、5、4 只）。
  // 二次元素体上是用体块拼的（每副胯、每个胸腔、每只胸都是能单独选中、挪、删的一块，见 model/chu.ts）；
  // 体块的摆位只照二次元素体调过，白模人台（和拼不了体块的成品角色）还是下面这一套「围成一圈」里的前后排
  {
    name: t('楚云萱'),
    counts: { armPairs: 3, breasts: 6 },
    armLayout: 'fan',
    chestRow: 2,
    shape: { bust: 2.3 },
    ring: 'rows',
    ringCount: 6,
    ringSpread: 0.44,
    ringChest: 'taper',
    ringHipRows: 3,
    ringHipsPerRow: 0,
    build: (spec) => (spec.bodyStyle === 'anime' ? chuSpec(spec) : spec),
  },
];

/**
 * 套用预设：部件数量和排布整体替换，体型只改预设点名的那几项（与 v1 一致），
 * 其余设置（性别、姿势等）保持不变。
 * 手动微调是针对上一个角色的部件做的，换了预设就全部清掉。
 */
export function applyPreset(spec: BodySpec, preset: Preset): BodySpec {
  const applied: BodySpec = {
    ...spec,
    counts: { ...defaultCounts(), ...preset.counts },
    shape: clampShape({ ...spec.shape, ...preset.shape }),
    headLayout: preset.headLayout ?? 'cluster',
    armLayout: preset.armLayout ?? 'stack',
    legLayout: preset.legLayout ?? 'auto',
    hipLegs: HIP_LEGS.def,
    chestRow: preset.chestRow ?? CHEST_ROW.def,
    ring: preset.ring ?? 'none',
    ringCount: preset.ringCount ?? spec.ringCount,
    ringSpread: preset.ringSpread ?? spec.ringSpread,
    ringChest: preset.ringChest ?? spec.ringChest,
    ringHipRows: preset.ringHipRows ?? spec.ringHipRows,
    ringHipsPerRow: preset.ringHipsPerRow ?? spec.ringHipsPerRow,
    earShape: preset.earShape ?? spec.earShape,
    overrides: {},
    // 手工加的体块也是针对上一个角色的部件加的
    blocks: { added: [] },
  };
  return preset.build ? preset.build(applied) : applied;
}

/** 两份设定是不是一样：数差一点点（存档读回来去掉的小数，见 spec.ts 的 cleanOverride）不算，没写和 undefined 不分 */
function near(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 0.006;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => near(v, b[i]));
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const [x, y] = [a as Record<string, unknown>, b as Record<string, unknown>];
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) if (!near(x[key], y[key])) return false;
  return true;
}

/**
 * 现在的设定是不是哪个「各种身体样式拼法不一样」的预设（楚云萱）刚套上去的原样（再套一遍还是它自己）：是的话给出那个预设。
 * 换身体样式时用：照新的样式重新套一遍——不然白模人台上点了楚云萱再换到二次元素体还是旧的前后排、不是体块拼的，
 * 反过来照素体量着摆的体块搬到白模人台上是乱的。套完以后改过数量、动过体块的不算（重套会把改动冲掉）
 */
export function styledPreset(spec: BodySpec): Preset | null {
  return PRESETS.find((preset) => preset.build && near(applyPreset(spec, preset), spec)) ?? null;
}

