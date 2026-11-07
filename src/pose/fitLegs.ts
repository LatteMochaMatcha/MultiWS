/**
 * 现成的姿势是给两条腿的人摆的，套到多条腿的身体上时腿怎么摆（工坊点姿势按钮、验收台、总览重测都用这一份）：
 * - 人马、蛛形的腿和胯不照它摆（马腿照人腿的样子弯会很怪，马身也不该跟着躺下去）：只套腰以上，下半身保持静止的样子。
 * - 腿左右并排、胯部聚拢、横排多胯、前后串联、人腿人马时，多出来的几对是同样的腿排在旁边、挤在后面、跟在后面：
 *   左边的都照左腿摆，右边的都照右腿摆（横排多胯是每副胯自己的左腿、右腿；前后串联、人腿人马后面那副胯的腿和前面同一边的迈同一步）。
 *   长在中线上的腿（单数条并排的正中那条、人腿人马每副胯正中那条）照左右两条腿的平均摆。
 * - 横排多胯两副胯挨着的那两条里侧的腿（见 INNER）一起照左右两条腿的平均摆。
 *
 * 纯函数。
 */
import { nthName } from '../geometry/figure';
import type { Quat } from '../geometry/vec';
import type { LegForm } from '../model/spec';
import type { PoseRig } from './rig';
import type { Posing } from './posing';

/** 一条腿从上往下的几节（姿势数据里的名字，后面接 _L、_R 和编号） */
const CHAIN = ['UpperLeg', 'LowerLeg', 'Foot', 'Toes'] as const;

/**
 * 横排多胯两副胯挨着的那两条里侧的腿：从 -X 往 +X 排，一条左腿后面紧跟着一条右腿（一副胯的右腿、左腿之间是平常的裆）。
 * 那两条大腿是两副素体原装的胯的外侧并在一起，并着往下长二十来厘米（见 rig/skin.ts 的 SEAM）。
 * 照每副胯自己的左腿、右腿摆的话，那两条一条照左腿、一条照右腿，往相反的方向去：两条挤在一起交叉穿过，并着的那一截被撕开。
 * 所以那两条一起照左右两条腿的平均摆：左右对称的那部分（往前抬、往后摆、弯膝盖）照旧，往两边张开、往里收、拧的那部分抵消掉
 */
const INNER = /^UpperLeg(?:_([LR]))?(\.\d+)?$/;

/** 两个旋转的平均（归一化的线性平均，先换到同一边）；缺的当没转 */
function average(a: Quat | undefined, b: Quat | undefined): Quat {
  const p = a ?? [0, 0, 0, 1];
  const q = b ?? [0, 0, 0, 1];
  const s = p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3] < 0 ? -1 : 1;
  const m: Quat = [p[0] + s * q[0], p[1] + s * q[1], p[2] + s * q[2], p[3] + s * q[3]];
  const l = Math.hypot(m[0], m[1], m[2], m[3]) || 1;
  return [m[0] / l, m[1] / l, m[2] / l, m[3] / l];
}

/** 横排多胯两副胯挨着的里侧两条腿（见 INNER）：每对是 [左腿那条的编号后缀, 右腿那条的]，例如 ['.002', ''] */
export function innerLegs(rig: Pick<PoseRig, 'names' | 'head'>): [string, string][] {
  const roots: { x: number; side: string; suffix: string }[] = [];
  rig.names.forEach((name, i) => {
    const m = INNER.exec(name);
    // 长在中线上的腿（单数条时正中那条，没有左右）也排进去：它两边的两条中间隔着它，不算挨着
    if (m) roots.push({ x: rig.head[i][0], side: m[1] ?? 'C', suffix: m[2] ?? '' });
  });
  roots.sort((a, b) => a.x - b.x);
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < roots.length; i++) if (roots[i].side === 'L' && roots[i + 1].side === 'R') out.push([roots[i].suffix, roots[i + 1].suffix]);
  return out;
}

/**
 * 照身体的腿把姿势里腿那几节改好（见文件开头）。form：腿的排法（FigureMetrics.legForm）；legs：几条腿；
 * rig：这副骨架（找横排多胯里侧的两条腿用，没有就不管它们）
 */
export function fitLegs(posing: Posing, form: LegForm | undefined, legs: number, rig?: Pick<PoseRig, 'names' | 'head'> | null): Posing {
  if (form === 'row' || form === 'gather' || form === 'abreast' || form === 'tandem' || form === 'humantaur') {
    const bones = { ...posing.bones };
    for (const [name, turn] of Object.entries(posing.bones)) {
      if (!/^(UpperLeg|LowerLeg|Foot|Toes)_[LR]$/.test(name)) continue;
      for (let k = 1; k < Math.ceil(legs / 2); k++) bones[nthName(name, k)] = turn;
    }
    // 长在中线上的腿（单数条时正中那条；人腿人马每副胯单数条时每副胯正中那条）照左右两条腿的平均摆：
    // 往前抬、弯膝盖跟着（蹲下、坐下时胯落下去，它要是还直直地站着，整个人就被它撑起来），往两边张开的抵消掉
    if (rig) {
      for (const name of rig.names) {
        const m = /^(UpperLeg|LowerLeg|Foot|Toes)(\.\d+)?$/.exec(name);
        if (!m || bones[name]) continue;
        const from = [posing.bones[`${m[1]}_L`], posing.bones[`${m[1]}_R`]];
        if (from[0] || from[1]) bones[name] = average(from[0], from[1]);
      }
    }
    if (form === 'abreast' && rig) {
      for (const [left, right] of innerLegs(rig)) {
        for (const part of CHAIN) {
          const from = [posing.bones[`${part}_L`], posing.bones[`${part}_R`]];
          if (!from[0] && !from[1]) continue;
          const turn = average(from[0], from[1]);
          bones[`${part}_L${left}`] = turn;
          bones[`${part}_R${right}`] = turn;
        }
      }
    }
    return { ...posing, bones };
  }
  if (form !== 'taur' && form !== 'spider') return posing;
  const bones = Object.fromEntries(Object.entries(posing.bones).filter(([name]) => !/^(Hips|UpperLeg|LowerLeg|Foot|Toe)/.test(name)));
  return { version: posing.version, bones };
}
