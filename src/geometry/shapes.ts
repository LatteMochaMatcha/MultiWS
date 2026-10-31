/**
 * 分部件网格和融合网格共用的形状定义，保证两种模式下同一个部件长得一样。
 */
import { CatmullRomCurve3, Vector3 } from 'three';
import type { Tube } from './figure';
import type { V3 } from './vec';

/** 翅膀轮廓：翼根在原点，向 +X 展开，单位是米（size = 1 时） */
export const WING_OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.12, 0.1], [0.32, 0.24], [0.55, 0.38], [0.86, 0.52], [0.8, 0.4], [0.7, 0.31], [0.66, 0.22],
  [0.56, 0.2], [0.5, 0.08], [0.4, 0.1], [0.34, -0.02], [0.24, 0.02], [0.17, -0.07], [0.07, -0.04],
];

/** 管的中心线：穿过各控制点的向心 Catmull-Rom 曲线，按弧长取点 */
export function tubeCurve(tube: Tube): CatmullRomCurve3 {
  return new CatmullRomCurve3(
    tube.points.map((p) => new Vector3(p[0], p[1], p[2])),
    false,
    'centripetal',
  );
}

/** 管在弧长比例 u（0 是根部，1 是尖端）处的半径 */
export const tubeRadius = (tube: Tube, u: number) =>
  tube.r0 + (tube.r1 - tube.r0) * u + tube.bulge * Math.sin(Math.PI * Math.min(1, u * 1.12));

/** 尖端封口球的半径：太细的尖端留一点厚度 */
export const tubeTipRadius = (tube: Tube) => Math.max(tube.r1, tube.r0 * 0.07);

/** 沿中心线取 n + 1 个点和对应的半径 */
export function sampleTube(tube: Tube, n: number): { point: V3; radius: number }[] {
  const curve = tubeCurve(tube);
  const out: { point: V3; radius: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = curve.getPointAt(u);
    out.push({ point: [p.x, p.y, p.z], radius: i === n ? tubeTipRadius(tube) : tubeRadius(tube, u) });
  }
  return out;
}
