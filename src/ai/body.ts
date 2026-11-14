/**
 * AI 助手改造型用的那几样：模型能改哪些设定、把它要的改动套到设定上、改之前改之后比一比。
 * 纯函数，不碰 DOM（测试里直接用）。改动一律过 normalizeSpec：越界的收回范围、不认识的值丢掉，
 * 收回、丢掉的都记下来告诉模型，免得它以为改成了。
 */
import { t } from '../i18n';
import { ROSTER } from '../character/roster';
import { withoutAdult } from '../model/adult';
import { partLabel } from '../model/partLabel';
import {
  ARM_LAYOUTS,
  BODY_STYLES,
  type BodySpec,
  CHARACTER_IDS,
  CONJOINS,
  CONJOIN_POSES,
  COUNT_DEFS,
  type CountKey,
  EAR_SHAPES,
  GENDERS,
  HAND_STYLES,
  HEAD_LAYOUTS,
  LEG_LAYOUTS,
  LIMB_ENDS,
  MESH_MODES,
  PENIS_LAYOUTS,
  PER_TORSO_KEYS,
  type PerTorsoKey,
  POSES,
  SCROTUM_MODES,
  SHAPE_DEFS,
  type ShapeKey,
  TORSO_SIDES,
  type TorsoSide,
  defaultSpec,
  normalizeSpec,
} from '../model/spec';

/** 成人部件那几项：「显示成人部件」关着时模型看不到、也改不了 */
export const ADULT_COUNTS: ReadonlySet<CountKey> = new Set<CountKey>(['penises']);
export const ADULT_SHAPES: ReadonlySet<ShapeKey> = new Set<ShapeKey>(['penisSize']);

/** 单选的那几项（字段名 → 能取的值） */
export const CHOICES = {
  bodyStyle: BODY_STYLES,
  character: CHARACTER_IDS,
  gender: GENDERS,
  headLayout: HEAD_LAYOUTS,
  armLayout: ARM_LAYOUTS,
  legLayout: LEG_LAYOUTS,
  pose: POSES,
  earShape: EAR_SHAPES,
  hands: HAND_STYLES,
  armEnd: LIMB_ENDS,
  legEnd: LIMB_ENDS,
  conjoined: CONJOINS,
  conjoinPose: CONJOIN_POSES,
  meshMode: MESH_MODES,
} as const;
export const ADULT_CHOICES = { penisLayout: PENIS_LAYOUTS, scrotum: SCROTUM_MODES } as const;

type ChoiceKey = keyof typeof CHOICES;
type AdultChoiceKey = keyof typeof ADULT_CHOICES;
/** 几个单独的整数、小数 */
const NUMBERS = ['hipLegs', 'fingers', 'toes', 'blend'] as const;
const ADULT_NUMBERS = ['penisRow'] as const;

/** 模型要的改动：只写要改的那几项，别的照旧 */
export interface BodyPatch {
  /** 先回到刚打开工坊时的默认设定，再套下面的改动（「从头做一个……」） */
  fromDefault?: boolean;
  counts?: Partial<Record<CountKey, number>>;
  /** 好几个上半身时某一个上半身单独设的数量 */
  torsoCounts?: Partial<Record<TorsoSide, Partial<Record<PerTorsoKey, number>>>>;
  shape?: Partial<Record<ShapeKey, number>>;
  hair?: { style?: string; color?: string; length?: number; volume?: number };
  bodyStyle?: string;
  character?: string;
  gender?: string;
  headLayout?: string;
  armLayout?: string;
  legLayout?: string;
  pose?: string;
  earShape?: string;
  hands?: string;
  armEnd?: string;
  legEnd?: string;
  conjoined?: string;
  conjoinPose?: string;
  meshMode?: string;
  hipLegs?: number;
  fingers?: number;
  toes?: number;
  blend?: number;
  penisLayout?: string;
  scrotum?: string;
  penisRow?: number;
  penisSoft?: boolean;
}

/** 要的值没照办的一项：要的是什么、实际成了什么、为什么 */
export interface Adjusted {
  field: string;
  asked: unknown;
  got: unknown;
  why: 'clamped' | 'unknown' | 'adult' | 'ignored';
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 把改动套到设定上。返回整理好的新设定和没照办的那几项。
 * adult 是「显示成人部件」开没开：关着时成人部件那几项一律不认。
 */
export function applyPatch(spec: BodySpec, patch: BodyPatch, adult: boolean): { spec: BodySpec; adjusted: Adjusted[] } {
  const adjusted: Adjusted[] = [];
  const base = patch.fromDefault ? defaultSpec() : spec;
  const draft: Record<string, unknown> = { ...base };

  const counts: Record<string, unknown> = { ...base.counts };
  if (isObj(patch.counts)) {
    for (const [key, value] of Object.entries(patch.counts)) {
      if (!COUNT_DEFS.some((d) => d.key === key)) adjusted.push({ field: `counts.${key}`, asked: value, got: undefined, why: 'unknown' });
      else if (!adult && ADULT_COUNTS.has(key as CountKey)) adjusted.push({ field: `counts.${key}`, asked: value, got: base.counts[key as CountKey], why: 'adult' });
      else counts[key] = value;
    }
  }
  draft.counts = counts;

  const shape: Record<string, unknown> = { ...base.shape };
  if (isObj(patch.shape)) {
    for (const [key, value] of Object.entries(patch.shape)) {
      if (!SHAPE_DEFS.some((d) => d.key === key)) adjusted.push({ field: `shape.${key}`, asked: value, got: undefined, why: 'unknown' });
      else if (!adult && ADULT_SHAPES.has(key as ShapeKey)) adjusted.push({ field: `shape.${key}`, asked: value, got: base.shape[key as ShapeKey], why: 'adult' });
      else shape[key] = value;
    }
  }
  draft.shape = shape;

  if (isObj(patch.hair)) draft.hair = { ...base.hair, ...patch.hair };

  if (isObj(patch.torsoCounts)) {
    const torso: Record<string, Record<string, unknown>> = {};
    for (const side of TORSO_SIDES) torso[side] = { ...(base.torsoCounts?.[side] ?? {}) };
    for (const [side, values] of Object.entries(patch.torsoCounts)) {
      if (!(TORSO_SIDES as readonly string[]).includes(side) || !isObj(values)) {
        adjusted.push({ field: `torsoCounts.${side}`, asked: values, got: undefined, why: 'unknown' });
        continue;
      }
      for (const [key, value] of Object.entries(values)) {
        if ((PER_TORSO_KEYS as readonly string[]).includes(key)) torso[side][key] = value;
        else adjusted.push({ field: `torsoCounts.${side}.${key}`, asked: value, got: undefined, why: 'unknown' });
      }
    }
    draft.torsoCounts = torso;
  }

  const choices: Record<string, readonly string[]> = adult ? { ...CHOICES, ...ADULT_CHOICES } : CHOICES;
  for (const key of [...Object.keys(CHOICES), ...Object.keys(ADULT_CHOICES)] as (ChoiceKey | AdultChoiceKey)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    if (!choices[key]) adjusted.push({ field: key, asked: value, got: (base as unknown as Record<string, unknown>)[key], why: 'adult' });
    else draft[key] = value;
  }
  for (const key of [...NUMBERS, ...ADULT_NUMBERS]) {
    const value = patch[key];
    if (value === undefined) continue;
    if (!adult && (ADULT_NUMBERS as readonly string[]).includes(key)) adjusted.push({ field: key, asked: value, got: base[key], why: 'adult' });
    else draft[key] = value;
  }
  if (patch.penisSoft !== undefined) {
    if (adult) draft.penisSoft = patch.penisSoft;
    else adjusted.push({ field: 'penisSoft', asked: patch.penisSoft, got: base.penisSoft, why: 'adult' });
  }

  let next = normalizeSpec(draft);
  if (!adult) next = withoutAdult(next);

  // 要的值和整理后的一项项比：没照办的记下来
  const said = new Set(adjusted.map((a) => a.field));
  const check = (field: string, asked: unknown, got: unknown) => {
    if (said.has(field) || asked === undefined || asked === got) return;
    const known = typeof asked === 'number' && typeof got === 'number';
    adjusted.push({ field, asked, got, why: known ? 'clamped' : 'unknown' });
  };
  if (isObj(patch.counts)) for (const [key, value] of Object.entries(patch.counts)) check(`counts.${key}`, value, next.counts[key as CountKey]);
  if (isObj(patch.shape)) for (const [key, value] of Object.entries(patch.shape)) check(`shape.${key}`, value, next.shape[key as ShapeKey]);
  if (isObj(patch.hair)) {
    for (const [key, value] of Object.entries(patch.hair)) {
      const got = (next.hair as unknown as Record<string, unknown>)[key];
      // 发色写成大写、三位的也算照办了
      if (key === 'color' && typeof value === 'string' && typeof got === 'string' && got && value.toLowerCase().length >= 4) continue;
      check(`hair.${key}`, value, got);
    }
  }
  if (isObj(patch.torsoCounts)) {
    for (const [side, values] of Object.entries(patch.torsoCounts)) {
      if (!isObj(values)) continue;
      for (const [key, value] of Object.entries(values)) {
        const got = next.torsoCounts?.[side as TorsoSide]?.[key as PerTorsoKey] ?? next.counts[key as CountKey];
        if (said.has(`torsoCounts.${side}.${key}`)) continue;
        if (next.counts.torsos < 2) adjusted.push({ field: `torsoCounts.${side}.${key}`, asked: value, got: undefined, why: 'ignored' });
        else check(`torsoCounts.${side}.${key}`, value, got);
      }
    }
  }
  for (const key of [...Object.keys(CHOICES), ...Object.keys(ADULT_CHOICES), ...NUMBERS, ...ADULT_NUMBERS, 'penisSoft']) {
    check(key, (patch as Record<string, unknown>)[key], (next as unknown as Record<string, unknown>)[key]);
  }
  return { spec: next, adjusted };
}

/* ---------------- 改之前、改之后比一比（面板上「这一轮改了」、告诉模型改成了什么） ---------------- */

const CHOICE_LABEL: Record<string, Record<string, string>> = {
  bodyStyle: { mannequin: t('白模人台'), anime: t('二次元素体'), character: t('成品角色') },
  gender: { female: t('女性'), male: t('男性') },
  headLayout: { cluster: t('凑成一簇'), faces: t('一个头几张脸'), wide: t('宽躯干') },
  armLayout: { stack: t('沿躯干上下排'), fan: t('肩部扇形聚拢') },
  legLayout: {
    auto: t('自动'),
    taur: t('人马式'),
    spider: t('蛛形'),
    humantaur: t('人腿人马'),
    tandem: t('前后串联'),
    row: t('左右并排'),
    gather: t('胯部聚拢'),
    abreast: t('横排多胯'),
  },
  pose: { A: t('A-pose（手臂下垂）'), T: t('T-pose（手臂平举）') },
  hands: { fingers: t('分指'), mitten: t('并指（手套形）') },
  armEnd: { hand: t('手'), foot: t('脚') },
  legEnd: { hand: t('手'), foot: t('脚') },
  conjoined: { none: t('不连'), same: t('同向'), opposite: t('反向') },
  conjoinPose: { prone: t('趴着'), lie: t('侧躺'), flat: t('平躺'), stand: t('站着') },
  meshMode: { fused: t('融合成一整块'), parts: t('分部件（v1）') },
  penisLayout: { row: t('左右并排'), stack: t('上下叠'), fan: t('扇形散开'), grid: t('几乘几') },
  scrotum: { shared: t('几根共用一个'), each: t('每根各带一个') },
  hairStyle: { own: t('原装'), long: t('长直发'), sidetail: t('侧马尾'), bob: t('波波头'), twintails: t('双马尾') },
};

const FIELD_LABEL: Record<string, string> = {
  bodyStyle: t('身体样式'),
  character: t('角色'),
  gender: t('性别'),
  headLayout: t('多个头'),
  armLayout: t('多对手臂'),
  legLayout: t('三条以上的腿'),
  pose: t('姿势'),
  earShape: t('兽耳形状'),
  hands: t('手的样式'),
  armEnd: t('手臂末端'),
  legEnd: t('腿末端'),
  conjoined: t('连体'),
  conjoinPose: t('连体姿态'),
  meshMode: t('网格模式'),
  blend: t('融合圆角'),
  hipLegs: t('每副胯几条腿'),
  fingers: t('手指'),
  toes: t('脚趾'),
  hairStyle: t('发型'),
  hairColor: t('发色'),
  hairLength: t('头发长度'),
  hairVolume: t('蓬松'),
  penisLayout: t('好几根阴茎怎么排'),
  scrotum: t('阴囊'),
  penisRow: t('每排几根'),
  penisSoft: t('阴茎软硬'),
  posing: t('摆的姿势'),
  overrides: t('手动微调'),
};

const EAR_LABEL: Record<string, string> = { cat: t('猫耳'), fox: t('狐耳'), rabbit: t('兔耳'), elf: t('精灵耳') };
const SIDE_LABEL: Record<TorsoSide, string> = { L: t('左@@上半身'), R: t('右@@上半身'), M: t('中@@上半身') };

const round = (v: number) => String(Math.round(v * 100) / 100);
const choiceText = (field: string, value: unknown) =>
  field === 'character'
    ? (ROSTER.find((r) => r.id === value)?.name ?? String(value))
    : field === 'earShape'
      ? (EAR_LABEL[String(value)] ?? String(value))
      : (CHOICE_LABEL[field]?.[String(value)] ?? String(value));

/** 一项改动：给人看的一句（界面语言），和给模型看的字段名、前后的值 */
export interface Change {
  text: string;
  field: string;
  from: unknown;
  to: unknown;
  /** 拆开的几段（合并同一项的几次改动时重拼 text 用）；「变了」那种没有 */
  label?: string;
  fromText?: string;
  toText?: string;
}

/** 同一项先后改了好几次：只留第一次的「从」和最后一次的「到」；改回原样的去掉 */
export function mergeChanges(list: readonly Change[]): Change[] {
  const byField = new Map<string, Change>();
  for (const c of list) {
    const was = byField.get(c.field);
    if (!was) {
      byField.set(c.field, c);
      continue;
    }
    const merged: Change = { ...c, from: was.from, fromText: was.fromText };
    if (c.label !== undefined && was.fromText !== undefined && c.toText !== undefined) {
      merged.text = t('{what} {from}→{to}', { what: c.label, from: was.fromText, to: c.toText });
    }
    byField.set(c.field, merged);
  }
  return [...byField.values()].filter((c) => c.field === 'posing' || JSON.stringify(c.from) !== JSON.stringify(c.to));
}

/** 两份设定差在哪：只比 AI 能改的那几项，加上姿势、微调有没有变 */
export function diffSpec(a: BodySpec, b: BodySpec): Change[] {
  const out: Change[] = [];
  const push = (field: string, label: string, from: unknown, to: unknown, show: (v: unknown) => string) => {
    const fromText = show(from);
    const toText = show(to);
    out.push({ field, from, to, label, fromText, toText, text: t('{what} {from}→{to}', { what: label, from: fromText, to: toText }) });
  };
  const scalar = (field: keyof BodySpec, label = FIELD_LABEL[field]) => {
    if (a[field] !== b[field]) push(field, label, a[field], b[field], (v) => (typeof v === 'number' ? round(v) : typeof v === 'boolean' ? (v ? t('是') : t('否')) : choiceText(field, v)));
  };
  scalar('bodyStyle');
  scalar('character');
  scalar('gender');
  for (const d of COUNT_DEFS) {
    if (a.counts[d.key] !== b.counts[d.key]) push(`counts.${d.key}`, d.label, a.counts[d.key], b.counts[d.key], (v) => String(v));
  }
  for (const side of TORSO_SIDES) {
    for (const key of PER_TORSO_KEYS) {
      const from = a.torsoCounts?.[side]?.[key];
      const to = b.torsoCounts?.[side]?.[key];
      if (from === to) continue;
      const label = t('{side}边的上半身：{what}', { side: SIDE_LABEL[side], what: COUNT_DEFS.find((d) => d.key === key)!.label });
      push(`torsoCounts.${side}.${key}`, label, from, to, (v) => (v === undefined ? t('跟着全部') : String(v)));
    }
  }
  for (const field of ['headLayout', 'armLayout', 'legLayout', 'hipLegs', 'pose', 'earShape', 'hands', 'fingers', 'toes', 'armEnd', 'legEnd', 'conjoined', 'conjoinPose', 'meshMode', 'blend', 'penisLayout', 'scrotum', 'penisRow', 'penisSoft'] as const) {
    scalar(field);
  }
  for (const d of SHAPE_DEFS) {
    if (a.shape[d.key] !== b.shape[d.key]) push(`shape.${d.key}`, d.label, a.shape[d.key], b.shape[d.key], (v) => round(v as number) + (d.unit ?? ''));
  }
  if (a.hair.style !== b.hair.style) push('hair.style', FIELD_LABEL.hairStyle, a.hair.style, b.hair.style, (v) => CHOICE_LABEL.hairStyle[String(v)] ?? String(v));
  if (a.hair.color !== b.hair.color) push('hair.color', FIELD_LABEL.hairColor, a.hair.color, b.hair.color, (v) => (v ? String(v) : t('原装')));
  if (a.hair.length !== b.hair.length) push('hair.length', FIELD_LABEL.hairLength, a.hair.length, b.hair.length, (v) => round(v as number));
  if (a.hair.volume !== b.hair.volume) push('hair.volume', FIELD_LABEL.hairVolume, a.hair.volume, b.hair.volume, (v) => round(v as number));
  if (JSON.stringify(a.posing) !== JSON.stringify(b.posing)) out.push({ field: 'posing', from: null, to: null, text: t('{what}变了', { what: FIELD_LABEL.posing }) });
  // 手动微调：一个部件一条，写清是哪个部件
  for (const key of ['overrides', 'characterOverrides'] as const) {
    const names = new Set([...Object.keys(a[key]), ...Object.keys(b[key])]);
    for (const name of [...names].sort()) {
      const from = a[key][name] ?? null;
      const to = b[key][name] ?? null;
      if (JSON.stringify(from) === JSON.stringify(to)) continue;
      out.push({ field: `overrides.${name}`, from, to, text: to ? t('微调 {part}', { part: partLabel(name) }) : t('还原 {part}', { part: partLabel(name) }) });
    }
  }
  return out;
}

/** 给模型看的现在的设定（字段名是英文的，值照 BodySpec 原样）：只列 AI 能改的那几项 */
export function stateForModel(spec: BodySpec, adult: boolean): Record<string, unknown> {
  const counts = Object.fromEntries(COUNT_DEFS.filter((d) => adult || !ADULT_COUNTS.has(d.key)).map((d) => [d.key, spec.counts[d.key]]));
  const shape = Object.fromEntries(SHAPE_DEFS.filter((d) => adult || !ADULT_SHAPES.has(d.key)).map((d) => [d.key, spec.shape[d.key]]));
  const out: Record<string, unknown> = {
    bodyStyle: spec.bodyStyle,
    ...(spec.bodyStyle === 'character' ? { character: spec.character } : {}),
    gender: spec.gender,
    counts,
    ...(spec.counts.torsos > 1 && spec.torsoCounts && Object.keys(spec.torsoCounts).length ? { torsoCounts: spec.torsoCounts } : {}),
    headLayout: spec.headLayout,
    armLayout: spec.armLayout,
    legLayout: spec.legLayout,
    hipLegs: spec.hipLegs,
    pose: spec.pose,
    earShape: spec.earShape,
    hands: spec.hands,
    fingers: spec.fingers,
    toes: spec.toes,
    armEnd: spec.armEnd,
    legEnd: spec.legEnd,
    conjoined: spec.conjoined,
    conjoinPose: spec.conjoinPose,
    shape,
    hair: { style: spec.hair.style, color: spec.hair.color, length: spec.hair.length, volume: spec.hair.volume },
    meshMode: spec.meshMode,
    blend: spec.blend,
    hasPosing: Object.keys(spec.posing.bones ?? {}).length > 0,
  };
  if (adult) Object.assign(out, { penisLayout: spec.penisLayout, scrotum: spec.scrotum, penisRow: spec.penisRow, penisSoft: spec.penisSoft });
  return out;
}
