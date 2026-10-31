/**
 * 躯干截面：几圈关键椭圆 → Catmull-Rom 加密成一摞细密的截面。
 * 手臂、胸、翅膀都靠 ringAt() 查某个高度上躯干有多宽、多厚，贴着表面放。
 */
import type { Ring } from './figure';

const CHANNELS = ['y', 'w', 'd', 'z'] as const;

const catmullRom = (a: number, b: number, c: number, d: number, t: number) =>
  0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);

/** 把关键截面加密，大约每 1.2 cm 一圈；保证 y 严格递增 */
export function smoothRings(keys: readonly Ring[]): Ring[] {
  const out: Ring[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const p0 = keys[Math.max(0, i - 1)];
    const p1 = keys[i];
    const p2 = keys[i + 1];
    const p3 = keys[Math.min(keys.length - 1, i + 2)];
    const n = Math.max(2, Math.ceil((p2.y - p1.y) / 0.012));
    for (let s = 0; s < n; s++) {
      const t = s / n;
      const r = { y: 0, w: 0, d: 0, z: 0 };
      for (const k of CHANNELS) r[k] = catmullRom(p0[k], p1[k], p2[k], p3[k], t);
      out.push(r);
    }
  }
  out.push({ ...keys[keys.length - 1] });
  for (let i = 1; i < out.length; i++) {
    if (out[i].y <= out[i - 1].y) out[i].y = out[i - 1].y + 0.001;
  }
  return out;
}

/** 高度 y 处的截面（线性插值；超出两端时取端点） */
export function ringAt(rings: readonly Ring[], y: number): Ring {
  const last = rings[rings.length - 1];
  if (y <= rings[0].y) return rings[0];
  if (y >= last.y) return last;
  let i = 1;
  while (rings[i].y < y) i++;
  const a = rings[i - 1];
  const b = rings[i];
  const t = (y - a.y) / (b.y - a.y);
  return { y, w: a.w + (b.w - a.w) * t, d: a.d + (b.d - a.d) * t, z: a.z + (b.z - a.z) * t };
}
