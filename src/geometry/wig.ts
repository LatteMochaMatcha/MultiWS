/**
 * 白模人台和二次元素体头上的头发：现成的头发转成的一层壳（见 hair/shapes.ts），当成头的一个子部件，
 * 和头融合成一整块。它没有自己的骨骼，整个跟着头动。
 *
 * 头发的数据是照二次元素体的头摆好的。戴到别的头上（白模人台的头小一圈、窄一些）时，
 * 照两个头的颅骨之比各个方向压一压，颅骨的中心对上颅骨的中心。
 */
import { type HairShape, hairBounds, hairGrid, hairReady } from '../hair/shapes';
import type { HairSpec } from '../model/spec';
import type { GridShape, Part } from './figure';
import { type V3, Q_ID } from './vec';

/** 颅骨近似成的椭球（头自己的坐标）：中心和三个半径 */
export interface Skull {
  center: V3;
  radii: V3;
}

/** 二次元素体的颅骨（朝头打射线量出来的）：头发的数据就是照它摆的 */
export const ANIME_SKULL: Skull = { center: [0, 0.025, -0.017], radii: [0.092, 0.095, 0.106] };

/** 头发这层壳的半厚 */
const SHELL = 0.005;
/** 调长短时从哪里往下算垂着的：鼻尖那么高（素体的头自己的坐标），和成品角色那边一个位置 */
const HANG = -0.048;
/** 头发的最低处比 HANG 低不了这么多的话，就没有垂着的那一段可调（短发） */
const HANG_MIN = 0.03;

export type WigSpec = HairSpec & { style: HairShape };

/**
 * 白模的头上戴不戴头发、戴哪一副。选的是「原装」（白模上就是光头），或者那副头发的数据还没取回来，
 * 就是不戴（数据到了以后界面会重新生成一遍）
 */
export function wigOf(hair: HairSpec): WigSpec | null {
  const { style } = hair;
  return hairReady(style) ? { ...hair, style } : null;
}

/** 头 head 上的那副头发。skull 是这个头的颅骨；不给就是二次元素体的头 */
export function wigPart(head: string, hair: WigSpec, skull: Skull = ANIME_SKULL): Part {
  // 蓬松：整副头发以颅骨的正中为中心放大、缩小
  const scale = skull.radii.map((r, k) => (r / ANIME_SKULL.radii[k]) * hair.volume) as V3;
  const pos = skull.center.map((c, k) => c - scale[k] * ANIME_SKULL.center[k]) as V3;
  const shape: GridShape = { kind: 'grid', name: 'Hair', grid: hairGrid(hair.style), shell: SHELL };
  // 长短：垂在鼻尖以下的那一段拉长、缩短。格子是把这一段拉开、上面的整个往上挪，所以再把整副头发挪回来，头顶就不动了
  const bottom = hairBounds(hair.style).min[1] - 0.01;
  const extra = (hair.length - 1) * (HANG - bottom);
  if (extra && HANG - bottom > HANG_MIN) {
    shape.stretchY = [bottom, HANG, extra];
    pos[1] -= scale[1] * extra;
  }
  const plain = scale.every((s) => Math.abs(s - 1) < 1e-9);
  return {
    name: `${head}_Hair`,
    type: 'hair',
    side: 0,
    parent: head,
    pos,
    quat: Q_ID,
    ...(plain ? {} : { stretch: scale }),
    material: 'clay',
    prims: [shape],
  };
}
