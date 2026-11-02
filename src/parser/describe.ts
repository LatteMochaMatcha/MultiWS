/** 部件数量与排布 → 规范中文描述。保证 describe → parse → describe 往返一致。 */

import {
  type BodySpec,
  type CountKey,
  type EarShape,
  type LegLayout,
  type PenisLayout,
  HIP_LEGS,
  legPlan,
  perHip,
} from '../model/spec';
import { zhCount } from './numerals';

export const EAR_NAME: Record<EarShape, string> = {
  cat: '猫耳',
  fox: '狐耳',
  rabbit: '兔耳',
  elf: '精灵耳',
};

/** 注意这些短语里不能出现数字或「双」，否则会被解析成部件数量 */
const LEG_PHRASE: Record<Exclude<LegLayout, 'auto'>, string> = {
  taur: '人马下身',
  spider: '蛛形下身',
  humantaur: '人腿人马下身',
  tandem: '腿前后排列',
  row: '腿左右并排',
  gather: '腿胯部聚拢',
  abreast: '横排多胯',
};

const PENIS_PHRASE: Record<Exclude<PenisLayout, 'row'>, string> = {
  stack: '阴茎上下叠',
  fan: '阴茎扇形散开',
};

export type Describable = Pick<BodySpec, 'counts' | 'armLayout' | 'legLayout' | 'earShape'> &
  Partial<Pick<BodySpec, 'gender' | 'pose' | 'headLayout' | 'hipLegs' | 'penisLayout' | 'scrotum'>>;

/** 是不是「一个头上几张脸」（只有一个头时谈不上） */
const manyFaces = (spec: Describable) => spec.headLayout === 'faces' && spec.counts.heads > 1;

export function describeSpec(spec: Describable): string {
  const c = spec.counts;
  // 女性、A-pose 是默认，不写；男性和 T-pose 写出来
  const p = spec.gender === 'male' ? ['男性'] : [];
  // 好几个上半身时，后面的头、手臂、胸是每个上半身各这么多
  if (c.torsos > 1) p.push(`${zhCount(c.torsos)}个上半身`);
  p.push(
    manyFaces(spec) ? `${zhCount(c.heads)}张脸` : `${zhCount(c.heads)}个头`,
    c.armPairs ? `${zhCount(c.armPairs)}对手臂` : '没有手臂',
    c.chestPairs ? `${zhCount(c.chestPairs)}对胸` : '平胸',
    // 双数照旧按对写（「两对腿」），单数按条写（「三条腿」）
    c.legs % 2 ? `${zhCount(c.legs)}条腿` : `${zhCount(c.legs / 2)}对腿`,
  );
  if (spec.legLayout !== 'auto' && legPlan(spec).form !== 'biped') {
    p.push(LEG_PHRASE[spec.legLayout]);
    const hip = spec.hipLegs ?? HIP_LEGS.def;
    if (perHip(spec.legLayout) && hip !== HIP_LEGS.def) p.push(`每副胯${zhCount(hip)}条腿`);
  }
  if (spec.headLayout === 'wide' && c.heads > 1) p.push('宽躯干');
  if (c.tails) p.push(`${zhCount(c.tails)}条尾巴`);
  if (c.wingPairs) p.push(`${zhCount(c.wingPairs)}对翅膀`);
  if (c.hornsPerHead) p.push(`每个头${zhCount(c.hornsPerHead)}只角`);
  if (c.eyesPerHead !== 2) p.push(`每个头${zhCount(c.eyesPerHead)}只眼睛`);
  if (c.earPairsPerHead) p.push(`每个头${zhCount(c.earPairsPerHead)}对${EAR_NAME[spec.earShape]}`);
  if (spec.armLayout === 'fan' && c.armPairs > 1) p.push('手臂肩部聚拢');
  if (c.penises) {
    p.push(`${zhCount(c.penises)}根阴茎`);
    if (c.penises > 1 && spec.penisLayout && spec.penisLayout !== 'row') p.push(PENIS_PHRASE[spec.penisLayout]);
    if (spec.scrotum === 'each') p.push('每根各带阴囊');
  }
  if (spec.pose === 'T') p.push('T-pose');
  return p.join('，');
}

export interface Chip {
  key: CountKey;
  label: string;
}

/** 界面上那一排识别结果标签 */
export function summarize(spec: Describable): Chip[] {
  const c = spec.counts;
  const plan = legPlan(spec);
  const feet = plan.total;
  const legs = {
    biped: feet === 1 ? '单足' : '双足',
    taur: feet === 4 ? '人马下身' : `人马式 ${feet} 足`,
    spider: `蛛形 ${feet} 足`,
    // 每副胯不是一对时，把每副几条写出来：「人腿人马 3+3 足」
    humantaur: plan.stations.every((n) => n === 2) ? `人腿人马 ${feet} 足` : `人腿人马 ${plan.stations.join('+')} 足`,
    tandem: plan.stations.every((n) => n <= 2) ? `前后 ${feet} 腿` : `前后 ${plan.stations.join('+')} 腿`,
    row: `并排 ${feet} 腿`,
    gather: `聚拢 ${feet} 腿`,
    abreast: `横排 ${plan.stations.length} 副胯 ${feet} 腿`,
  }[plan.form];

  return [
    { key: 'torsos', label: `上半身 ${c.torsos}` },
    { key: 'heads', label: manyFaces(spec) ? `一个头 ${c.heads} 张脸` : spec.headLayout === 'wide' && c.heads > 1 ? `头 ${c.heads} · 宽躯干` : `头 ${c.heads}` },
    { key: 'armPairs', label: `手臂 ${c.armPairs} 对` },
    { key: 'chestPairs', label: c.chestPairs ? `胸 ${c.chestPairs} 对` : '平胸' },
    { key: 'legs', label: legs },
    { key: 'tails', label: `尾 ${c.tails}` },
    { key: 'wingPairs', label: `翼 ${c.wingPairs} 对` },
    { key: 'hornsPerHead', label: `角 ${c.hornsPerHead}` },
    { key: 'eyesPerHead', label: `眼 ${c.eyesPerHead}` },
    {
      key: 'earPairsPerHead',
      label: c.earPairsPerHead ? `${EAR_NAME[spec.earShape]} ${c.earPairsPerHead} 对` : '兽耳 0',
    },
    // 成人部件只在有的时候列出来（开关关着时设定里一律是 0，见 model/adult.ts）
    ...(c.penises ? [{ key: 'penises' as const, label: `阴茎 ${c.penises}` }] : []),
  ];
}
