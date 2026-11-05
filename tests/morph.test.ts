// 换网格时的过渡（src/view/morph.ts）：新网格先贴在原来那张的表面上，再平滑地变成自己的样子。
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { defaultSpec } from '../src/model/spec';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
import { morphLeft, surfaceOffsets } from '../src/view/morph';
import { useAnimeBody } from './animeBody';

useAnimeBody();

/** 球面上大致均匀的 n 个点（斐波那契），半径 r；法线朝外 */
function sphere(n: number, r: number): { positions: Float32Array; normals: Float32Array } {
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const s = Math.sqrt(1 - y * y);
    const a = golden * i;
    normals.set([Math.cos(a) * s, y, Math.sin(a) * s], i * 3);
    positions.set([Math.cos(a) * s * r, y * r, Math.sin(a) * s * r], i * 3);
  }
  return { positions, normals };
}

/** 一个个比找最近的点（对照用） */
function bruteNearest(from: Float32Array, x: number, y: number, z: number): number {
  let best = Infinity;
  let hit = -1;
  for (let j = 0; j < from.length; j += 3) {
    const d = (from[j] - x) ** 2 + (from[j + 1] - y) ** 2 + (from[j + 2] - z) ** 2;
    if (d < best) {
      best = d;
      hit = j;
    }
  }
  return hit;
}

describe('换网格时的过渡', () => {
  it('新网格贴到原来那张的表面上：球从半径 0.3 长到 0.32，每个点沿法线往回挪 2 cm', () => {
    const before = sphere(20000, 0.3);
    const after = sphere(15000, 0.32);
    const off = surfaceOffsets(before.positions, after.positions, after.normals, 0.05);
    let worst = 0;
    for (let i = 0; i < off.length; i += 3) {
      const r = Math.hypot(after.positions[i] + off[i], after.positions[i + 1] + off[i + 1], after.positions[i + 2] + off[i + 2]);
      worst = Math.max(worst, Math.abs(r - 0.3));
    }
    // 原来那张的点隔着 0.7 cm 左右，沿法线量的误差远小于它
    expect(worst).toBeLessThan(0.002);
  });

  it('一圈圈往外找到的最近点和一个个比的一样', () => {
    const before = sphere(3000, 0.3);
    const after = sphere(2000, 0.31);
    const off = surfaceOffsets(before.positions, after.positions, after.normals, 0.05);
    for (let i = 0; i < after.positions.length; i += 3 * 37) {
      const [x, y, z] = [after.positions[i], after.positions[i + 1], after.positions[i + 2]];
      const j = bruteNearest(before.positions, x, y, z);
      const along =
        (before.positions[j] - x) * after.normals[i] + (before.positions[j + 1] - y) * after.normals[i + 1] + (before.positions[j + 2] - z) * after.normals[i + 2];
      expect(off[i]).toBeCloseTo(after.normals[i] * along, 6);
      expect(off[i + 2]).toBeCloseTo(after.normals[i + 2] * along, 6);
    }
  });

  it('离原来那张太远的点不挪：直接是新的样子', () => {
    const before = sphere(2000, 0.3);
    const after = sphere(2000, 0.5);
    const off = surfaceOffsets(before.positions, after.positions, after.normals, 0.05);
    expect(off.every((v) => v === 0)).toBe(true);
  });

  it('先快后慢地收回去，到头是 0', () => {
    expect(morphLeft(0)).toBe(1);
    expect(morphLeft(0.5)).toBeCloseTo(0.25);
    expect(morphLeft(1)).toBe(0);
    expect(morphLeft(3)).toBe(0);
  });

  it('二次元素体两张网格之间（胸围拖了一小段，换成粗一档的格子）：过渡的起点贴着原来那张，在主线程上算得快', () => {
    const spec = { ...defaultSpec(), bodyStyle: 'anime' as const };
    const parts = (bust: number) => buildFigure({ ...spec, shape: { ...spec.shape, bust } }).parts.filter((p) => p.material !== 'eye');
    const old = fuseParts(parts(1), { voxel: VOXEL.preview, blend: 0.02 });
    const next = fuseParts(parts(1.25), { voxel: VOXEL.draft, blend: 0.02 });
    const t0 = performance.now();
    const off = surfaceOffsets(old.positions, next.positions, next.normals, 0.05);
    const ms = performance.now() - t0;
    // 一个点离原来那张的表面多远：到最近的那个顶点的切平面的距离（顶点隔着一厘米多，直接量到顶点量不准）
    const gap = (x: number, y: number, z: number) => {
      const q = bruteNearest(old.positions, x, y, z);
      const o = old.positions;
      const m = old.normals;
      return Math.abs((x - o[q]) * m[q] + (y - o[q + 1]) * m[q + 1] + (z - o[q + 2]) * m[q + 2]);
    };
    // 胸那里（离原来那张 3 mm 以上的）：直接换上会跳多远 vs 过渡的起点离原来那张多远
    let direct = 0;
    let start = 0;
    let n = 0;
    for (let i = 0; i < next.positions.length; i += 3) {
      const [x, y, z] = [next.positions[i], next.positions[i + 1], next.positions[i + 2]];
      const d = gap(x, y, z);
      if (d < 0.003) continue;
      direct += d;
      start += gap(x + off[i], y + off[i + 1], z + off[i + 2]);
      n++;
    }
    expect(n).toBeGreaterThan(50);
    expect(start / n).toBeLessThan((direct / n) * 0.4);
    // 一次要比一帧短得多（这台机器上几毫秒）
    expect(ms).toBeLessThan(60);
  });
});
