/**
 * 大腿加粗、收细（体型滑块「大腿粗细」，前后排的下半截也用它）：只改腿的形状，骨骼、接上去的脚不动。
 * 纯函数，不碰 three.js 和 DOM。
 */
import type { Part, Prim } from './figure';

/**
 * - ramp：素体的腿是一块格子带加粗变形，从腿根往下 ramp[0] 起渐渐粗、到 ramp[1] 粗足——一下子粗起来的话大腿根上鼓出一圈，像穿了灯笼裤；
 * - taper：往脚踝那头变回原样的那一段拉长到腿长的多少（膝盖上面就开始收：粗大腿、细小腿）；
 * - knee：白模的大腿是一根圆台，根上粗 k 倍，膝盖那头只粗 knee 那么多（1 + (k − 1) · knee），小腿不动
 */
export const THIGH = { ramp: [0.02, 0.3] as const, taper: 0.62, knee: 0.35 };

/**
 * 一条人腿（带脚踝骨骼的）的大腿粗到 k 倍；不是人腿、k 是 1 的原样返回。
 * shin：小腿往下变回多粗——'own' 变回脚踝本来的粗细（四肢粗细滑块自己到脚踝也变回去，脚接得上）；
 * 'thick' 变回四肢粗细滑块设的倍数（前后排的下半截一直是这样）。已经加粗过一遍的再加粗，那头不跟着变
 */
export function thighen(leg: Part, k: number, shin: 'own' | 'thick' = 'own'): Part {
  if (Math.abs(k - 1) < 1e-6) return leg;
  const ankle = leg.bones?.find((b) => /^Foot/.test(b.name))?.head;
  if (!ankle) return leg;
  const span = Math.hypot(ankle[0], ankle[1], ankle[2]);
  return {
    ...leg,
    prims: leg.prims.map((q): Prim => {
      if (q.kind === 'grid') {
        const base = q.thicken?.k ?? 1;
        const from = q.thicken?.ramp ?? [0.1, 0.2, 0.08];
        const again = q.thicken !== undefined && Math.abs(q.thicken.ramp[2] - span * THIGH.taper) < 1e-9;
        const end = again || shin === 'own' ? (q.thicken?.end ?? 1) : base;
        return { ...q, thicken: { from: [0, 0, 0], to: q.thicken?.to ?? ankle, k: base * k, ramp: [Math.min(from[0], THIGH.ramp[0]), Math.max(from[1], THIGH.ramp[1]), span * THIGH.taper], end } };
      }
      if (q.kind === 'cone' && /^Thigh/.test(q.name)) return { ...q, ra: q.ra * k, rb: q.rb * (1 + (k - 1) * THIGH.knee) };
      return q;
    }),
  };
}
