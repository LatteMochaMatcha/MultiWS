// 沿 Y 拉长一段（GridShape.stretchY）：加长以后的高度和加长之前的互相换算。sdf/grids.ts、anime/chest.ts、布局都照这一份

/**
 * [from, to, extra]：原来的高度 s 变成 s + extra·smoothstep((s − from) / (to − from))，两头缓、中间急；extra 是负的就是缩短。
 * [from, to, extra, ramp]：拉长的那一段中间是一截直筒，上下两头各在加长以后 ramp 那么长里渐渐变回原样（ramp 不超过 to − from）。
 * 只用 smoothstep 拉得多时，两头在加长以后只有几毫米就从原来的斜面拐成直筒，背上一上一下两道硬边；
 * 这里换算回去的斜率（原来的高度随加长以后的高度变得多快）照 smoothstep 在 ramp 里从 1 渐变到直筒那一截的，表面的朝向跟着匀着转
 */
export type Stretch = [from: number, to: number, extra: number, ramp?: number];

/** smoothstep 从 0 积到 t */
const rampArea = (t: number) => t * t * t - (t * t * t * t) / 2;

/** 两头渐变的那种：直筒那一截换算回去的斜率、两头渐变多长（加长以后）、整段多长（加长以后） */
function soft(from: number, to: number, extra: number, ramp: number): [q: number, r: number, total: number] {
  const span = to - from;
  const r = Math.min(ramp, span);
  const total = span + extra;
  return [(span - r) / (total - r), r, total];
}

/** 加长以后的高度 y 换回加长之前的 */
export function unstretch(y: number, stretch: Stretch | undefined): number {
  if (!stretch) return y;
  const [from, to, extra, ramp] = stretch;
  if (!extra || y <= from) return y;
  if (y >= to + extra) return y - extra;
  if (ramp && extra > 0) {
    const [q, r, total] = soft(from, to, extra, ramp);
    const u = y - from;
    // 加长以后从 from 往上走 u，其中「被拉开」的那部分有多少（直筒那一截全算，两头照 smoothstep 渐变）
    const pulled = u <= r ? r * rampArea(u / r) : u < total - r ? r / 2 + (u - r) : total - r - r * rampArea((total - u) / r);
    return from + u - (1 - q) * pulled;
  }
  // smoothstep 那种：反过来求 s 没有现成的式子，用牛顿法迭代几步
  const span = to - from;
  let s = from + ((y - from) * span) / (span + extra);
  for (let k = 0; k < 4; k++) {
    const t = (s - from) / span;
    s -= (s + extra * t * t * (3 - 2 * t) - y) / (1 + (extra * 6 * t * (1 - t)) / span);
    if (s < from) s = from;
    else if (s > to) s = to;
  }
  return s;
}

/** 加长之前的高度 s 加长以后在哪 */
export function restretch(s: number, stretch: Stretch | undefined): number {
  if (!stretch) return s;
  const [from, to, extra, ramp] = stretch;
  if (!extra || s <= from) return s;
  if (s >= to) return s + extra;
  if (ramp && extra > 0) {
    // 换算回去是单调的，二分
    let lo = from;
    let hi = to + extra;
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2;
      if (unstretch(mid, stretch) < s) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
  const t = (s - from) / (to - from);
  return s + extra * t * t * (3 - 2 * t);
}
