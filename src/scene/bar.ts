/**
 * 一件道具能不能当杆用（杆，或者细长的箱子）：吊着、腿缠杆、抓住时握杆都照它算（见 propActions.ts、grip.ts）。纯函数。
 */
import type { V3 } from '../geometry/vec';
import { type SceneProp, propPoint } from '../model/props';
import type { Vec3 } from '../model/spec';

/** 箱子的两个短边都不超过这么宽（米）才算杆 */
const BAR_BOX = 0.14;
const RAD = Math.PI / 180;

/** 一根杆：两头在场景里的哪（a 是低的那头）、多粗（半径）、多长、和水平面夹多少度（0 是横着，90 是竖着）；axis 是顺着道具自己的哪根轴（0 宽、1 高、2 深） */
export interface Bar {
  axis: 0 | 1 | 2;
  a: V3;
  b: V3;
  r: number;
  length: number;
  pitch: number;
}

/** 这件道具当杆用是什么样；不是杆（不是「杆」，也不是细长的箱子）返回 null */
export function barOf(prop: SceneProp): Bar | null {
  if (prop.kind !== 'pole' && prop.kind !== 'box') return null;
  const [w, h, d] = prop.size;
  const axis = prop.kind === 'pole' ? 1 : w >= h && w >= d ? 0 : h >= d ? 1 : 2;
  const length = prop.size[axis];
  const thick = Math.max(...prop.size.filter((_, i) => i !== axis));
  if (prop.kind === 'box' && (thick > BAR_BOX || length < thick * 4)) return null;
  const end = (side: number): Vec3 => (axis === 1 ? [0, side > 0 ? h : 0, 0] : axis === 0 ? [(side * w) / 2, h / 2, 0] : [0, h / 2, (side * d) / 2]);
  const p = propPoint(prop, end(-1));
  const q = propPoint(prop, end(1));
  const [a, b] = p[1] <= q[1] ? [p, q] : [q, p];
  return { axis, a, b, r: thick / 2, length, pitch: Math.asin(Math.min(1, (b[1] - a[1]) / Math.max(length, 1e-6))) / RAD };
}
