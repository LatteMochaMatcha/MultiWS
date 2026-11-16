import { t } from '../i18n';
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
  // 前后排的六个头：前排三个人、后排三个人背靠背，前中后三排胯；每侧前后两组各三条手臂，每人六只胸，前后两面各排成上宽下尖的一串（从上到下 6、5、4 只）
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
  },
];

/**
 * 套用预设：部件数量和排布整体替换，体型只改预设点名的那几项（与 v1 一致），
 * 其余设置（性别、姿势等）保持不变。
 * 手动微调是针对上一个角色的部件做的，换了预设就全部清掉。
 */
export function applyPreset(spec: BodySpec, preset: Preset): BodySpec {
  return {
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
}
