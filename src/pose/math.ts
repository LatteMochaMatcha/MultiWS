/**
 * 摆姿势用到的几个四元数、向量小工具（geometry/vec.ts 里没有的）。纯函数。
 */
import { type Quat, type V3, cross, dot, mul, norm, sub } from '../geometry/vec';

/** 归一；长度是零就当作不转 */
export function quatUnit(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l > 0 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : [0, 0, 0, 1];
}

/** 这个旋转转了多少弧度（0 – π）。q 要是单位四元数 */
export const quatAngle = (q: Quat) => 2 * Math.acos(Math.min(1, Math.abs(q[3])));

/** 只转其中的 t 倍：t = 0 不转，t = 1 原样。走近的那一边 */
export function quatPart(q: Quat, t: number): Quat {
  const flip = q[3] < 0 ? -1 : 1;
  const x = q[0] * flip;
  const y = q[1] * flip;
  const z = q[2] * flip;
  const s = Math.hypot(x, y, z);
  if (s < 1e-12) return [0, 0, 0, 1];
  const half = Math.atan2(s, q[3] * flip) * t;
  const k = Math.sin(half) / s;
  return [x * k, y * k, z * k, Math.cos(half)];
}

/** 转得超过 max 弧度的，收回到 max */
export function quatLimit(q: Quat, max: number): Quat {
  const angle = quatAngle(q);
  return angle > max ? quatPart(q, max / angle) : q;
}

/** v 里垂直于单位向量 axis 的那一部分 */
export const reject = (v: V3, axis: V3): V3 => sub(v, mul(axis, dot(v, axis)));

/** 随便一个垂直于单位向量 a 的单位向量 */
export function anyPerp(a: V3): V3 {
  return norm(Math.abs(a[1]) < 0.9 ? cross(a, [0, 1, 0]) : cross(a, [1, 0, 0]));
}
