/**
 * queen conjoined 侧躺时两种做法（白模、素体的 geometry/conjoined.ts，成品角色的 character/conjoin.ts）共用的两样：
 * 两个上半身对成同一条轴，头往正上方回正多少。纯函数，Web Worker 里也能用。
 */
import { type Quat, type V3, mul, quatEuler, rotate } from './vec';

/** 头往正上方回正几成、最多回正多少（全回正的话脖子折成一个角） */
const HEAD_UPRIGHT = 0.6;
const HEAD_MAX = 30 * (Math.PI / 180);

/** 在躯干的坐标里绕左右的轴（X）量：这个方向从朝头（+Y）往胸口（+Z）偏了多少 */
const angleOf = (v: V3) => Math.atan2(v[2], v[1]);

/**
 * 腰到脖子那条线（neck：躯干的坐标里，从腰那一点指向脖子）：脖子长在腰那条线前面一点，
 * 同向时两个上半身都往前偏，从上往下看成个浅 V。两个上半身各绕左右的轴转一下（侧过来以后就是在地面上转），两条线对成一条直线。
 * first：第一个上半身先转的（侧过来之前）；second：第二个上半身在它自己翻过去（flip）之前再转的（第二个上半身相对第一个的转法是 second · flip）
 */
export function lineUpTurns(neck: V3, flip: Quat): { first: Quat; second: Quat } {
  return {
    first: quatEuler(-angleOf(neck), 0, 0),
    second: quatEuler(angleOf(mul(neck, -1)) - angleOf(rotate(flip, neck)), 0, 0),
  };
}

/** 头往正上方回正多少（绕前后的轴，弧度）：up 是这个上半身坐标里的正上方，只回正左右歪的那一份，回正一部分、有上限 */
export function uprightFix(up: V3): number {
  const lean = Math.atan2(-up[0], up[1]);
  return Math.sign(lean) * Math.min(Math.abs(lean) * HEAD_UPRIGHT, HEAD_MAX);
}
