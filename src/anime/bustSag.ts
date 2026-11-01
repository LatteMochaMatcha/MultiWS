// 大胸往外下方坠的那一下（tools/build-bust.ts 取胸时用；tests/bust.test.ts 照它比原素材）。纯函数，不依赖 Node
type V3 = [number, number, number];

/**
 * 大胸的重量（摆好以后、照素体的米）：原素材的胸往正前方胀，从背后看不到，像单纯鼓出来。
 * 照离胸壁多远（forward：wall 处是 0、往前 depth 是 1）、离胸根中心（center，左胸）多远（高斯，reach）挪：
 * 往外挪 out（越靠下挪得越多，胸的下半截往两侧摊开；贴着胸壁的那一圈也挪 base 成：背后看到的是这一圈），往下挪 down（越靠前坠得越多）。
 * 相当于在 Blender 里拿一个晶格把胸的前半截往外下方拉，胸根、胸壁不动
 */
export const SAG = { center: [0.07, 1.17] as [number, number], wall: 0.075, depth: 0.09, reach: 0.095, out: 0.026, base: 0.45, down: 0.012, low: 0.06 };

/** 照 SAG 把（左右）一点往外下方挪（测试里也照它比原素材） */
export function sag(p: V3, side: number) {
  const dx = Math.abs(p[0]) - SAG.center[0];
  const dy = p[1] - SAG.center[1];
  const near = Math.exp(-(dx * dx + dy * dy) / (SAG.reach * SAG.reach));
  const t = Math.max(0, Math.min(1, (p[2] - SAG.wall) / SAG.depth));
  const forward = t * t * (3 - 2 * t);
  const low = 0.5 + 0.5 * Math.max(0, Math.min(1, -dy / SAG.low));
  p[0] += side * SAG.out * (SAG.base + (1 - SAG.base) * forward) * near * low;
  p[1] -= SAG.down * forward * forward * near;
}
