// 二次元素体的胸：贴在平胸躯干表面上的一层（anime/chest.ts、ChestShape；tools/build-chest.ts 从 CC0 参考模型上采的胸型）
import { describe, expect, it } from 'vitest';
import { chestFrame, chestLayers, zcOf } from '../src/anime/chest';
import type { ChestShape, Figure, Part } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import type { V3 } from '../src/geometry/vec';
import { type BodySpec, type PartOverride, defaultSpec, normalizeSpec } from '../src/model/spec';
import { compileField, fieldAt } from '../src/sdf/field';
import { chestDist } from '../src/sdf/grids';
import { fieldFromFunction } from '../src/sdf/field';
import { meshField } from '../src/sdf/surfaceNets';
import { useAnimeBody } from './animeBody';

const anime = (bust: number, overrides: Record<string, PartOverride> = {}): BodySpec => {
  const d = defaultSpec();
  return normalizeSpec({ ...d, bodyStyle: 'anime', shape: { ...d.shape, bust }, overrides });
};
const part = (f: Figure, name: string): Part => f.parts.find((p) => p.name === name)!;
/** 躯干加两个胸融合以后的场（世界坐标） */
const chestField = (f: Figure) => compileField({ ...f, parts: f.parts.filter((p) => p.type === 'torso' || p.type === 'chest') }, { blend: 0 });
/** 世界坐标里胸中心（左胸部件的原点） */
const centerOf = (f: Figure): V3 => {
  const torso = part(f, 'Torso');
  const chest = part(f, 'Chest_01_L');
  return [0, 1, 2].map((k) => (torso.pos[k] + chest.pos[k]) * f.scale) as V3;
};

describe('二次元素体的胸', () => {
  useAnimeBody();

  it('每个胸是一个贴在躯干表面上的部件，和躯干取并集，手动微调不挪部件', () => {
    const f = buildFigure(anime(1.4));
    const chests = f.parts.filter((p) => p.type === 'chest');
    expect(chests.map((p) => p.name).sort()).toEqual(['Chest_01_L', 'Chest_01_R']);
    for (const p of chests) {
      expect(p.prims).toHaveLength(1);
      expect(p.prims[0].kind).toBe('chest');
      expect(p.fuseAs).toBe('torso');
      expect(p.surface).toBe(true);
    }
  });

  it('大胸底下有缝：胸前往身体里打的水平射线先穿过胸、再穿过一段空隙、再进躯干', () => {
    for (const bust of [1.8, 2.2, 3]) {
      const f = buildFigure(anime(bust));
      const field = chestField(f);
      const [x, y0, z0] = centerOf(f);
      let found = false;
      for (let dy = 0; dy < 0.2 * f.scale && !found; dy += 0.004) {
        // 从前面往后走：实心几段
        let solids = 0;
        let inside = false;
        for (let z = z0 + 0.4 * f.scale; z > z0 - 0.15 * f.scale; z -= 0.002) {
          const now = fieldAt(field, x, y0 - dy, z) < 0;
          if (now && !inside) solids++;
          inside = now;
        }
        found = solids >= 2;
      }
      expect(found, `胸 ${bust}`).toBe(true);
    }
  });

  it('胸根没有折痕：胸中心那个高度上从正中往侧面绕一圈，表面的走向慢慢变，没有突然拐弯', () => {
    for (const bust of [0.8, 1.3, 2.2, 3]) {
      const f = buildFigure(anime(bust));
      const field = chestField(f);
      const torso = part(f, 'Torso');
      const s = f.scale;
      const [, y] = centerOf(f);
      // 躯干的竖轴（展开图上那一行的前后正中），从它往外沿各个角度量到表面多远
      const zc = (torso.pos[2] + zcOf(chestFrame(), y / s - torso.pos[1])) * s;
      const pts: [number, number][] = [];
      for (let deg = 2; deg <= 100; deg += 2) {
        const a = (deg * Math.PI) / 180;
        const out = (r: number) => fieldAt(field, r * Math.sin(a), y, zc + r * Math.cos(a)) > 0;
        let r = 0.45 * s;
        while (r > 0 && out(r)) r -= 0.002;
        let lo = r;
        let hi = r + 0.002;
        for (let k = 0; k < 20; k++) if (out((lo + hi) / 2)) hi = (lo + hi) / 2;
        else lo = (lo + hi) / 2;
        pts.push([lo * Math.sin(a), zc + lo * Math.cos(a)]);
      }
      let worst = 0;
      for (let k = 1; k + 1 < pts.length; k++) {
        const a = Math.atan2(pts[k][1] - pts[k - 1][1], pts[k][0] - pts[k - 1][0]);
        const b = Math.atan2(pts[k + 1][1] - pts[k][1], pts[k + 1][0] - pts[k][0]);
        let turn = Math.abs(b - a);
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        worst = Math.max(worst, (turn * 180) / Math.PI);
      }
      // 每 2 度（4 毫米上下）拐多少度：乳沟、胸侧和躯干接上的那一道弯（半径一厘米上下）拐二十几度；一道折痕是一下子拐四五十度
      expect(worst, `胸 ${bust}`).toBeLessThan(35);
    }
  });

  it('胸随滑块越调越大，往小调到底是平胸', () => {
    const volume = (bust: number) => {
      const f = buildFigure(anime(bust));
      const field = chestField(f);
      const flat = compileField({ ...f, parts: f.parts.filter((p) => p.type === 'torso') }, { blend: 0 });
      const [x0, y0, z0] = centerOf(f);
      const h = 0.006 * f.scale;
      let n = 0;
      for (let x = x0 - 0.25 * f.scale; x < x0 + 0.25 * f.scale; x += h) {
        for (let y = y0 - 0.3 * f.scale; y < y0 + 0.15 * f.scale; y += h) {
          for (let z = z0 - 0.1 * f.scale; z < z0 + 0.35 * f.scale; z += h) if (fieldAt(field, x, y, z) < 0 && fieldAt(flat, x, y, z) >= 0) n++;
        }
      }
      return n;
    };
    expect(volume(0.3)).toBe(0);
    let last = 0;
    for (const bust of [0.5, 0.8, 1.2, 1.6, 2.2, 3]) {
      const v = volume(bust);
      expect(v, `胸 ${bust}`).toBeGreaterThan(last);
      last = v;
    }
  }, 60_000);

  it('中胸到大胸之间两种胸型挪到同一个中心再混合，分量加起来是一', () => {
    for (const bust of [1.2, 1.4, 1.6]) {
      const { layers, fade } = chestLayers(bust);
      expect(fade).toBe(1);
      expect(layers.reduce((s, l) => s + l.weight, 0)).toBeCloseTo(1, 9);
      expect(layers[0].at).toEqual(layers[layers.length - 1].at);
    }
  });

  it('分部件时每个胸是封闭的一块（胸根以内，插进躯干一点）', () => {
    for (const bust of [1, 2.2, 3]) {
      const f = buildFigure(anime(bust));
      for (const p of f.parts.filter((q) => q.type === 'chest')) {
        const d = chestDist(p.prims[0] as ChestShape, true);
        const mesh = meshField(fieldFromFunction(d.fn, d.min, d.max), 0.005);
        expect(mesh.triangles.length, `${bust} ${p.name}`).toBeGreaterThan(300);
        const edges = new Map<string, number>();
        for (let k = 0; k < mesh.triangles.length; k += 3) {
          for (let e = 0; e < 3; e++) {
            const a = mesh.triangles[k + e];
            const b = mesh.triangles[k + ((e + 1) % 3)];
            const key = a < b ? `${a},${b}` : `${b},${a}`;
            edges.set(key, (edges.get(key) ?? 0) + 1);
          }
        }
        expect([...edges.values()].filter((n) => n !== 2).length, `${bust} ${p.name}`).toBe(0);
      }
    }
  });

  it('手动微调沿表面挪胸：往外挪两厘米，胸往外挪一两厘米（往正中那半边被拉开一点），另一边不动', () => {
    /** 一边的胸（比平胸躯干多出来的那些格点）的重心 */
    const centroid = (f: Figure, side: number): V3 => {
      const field = chestField(f);
      const flat = compileField({ ...f, parts: f.parts.filter((p) => p.type === 'torso') }, { blend: 0 });
      const [, y0, z0] = centerOf(f);
      const sum: V3 = [0, 0, 0];
      let n = 0;
      for (let x = 0.002; x < 0.25; x += 0.004) {
        for (let y = y0 - 0.25; y < y0 + 0.12; y += 0.004) {
          for (let z = z0 - 0.08; z < z0 + 0.3; z += 0.004) {
            if (fieldAt(field, side * x, y, z) >= 0 || fieldAt(flat, side * x, y, z) < 0) continue;
            sum[0] += side * x;
            sum[1] += y;
            sum[2] += z;
            n++;
          }
        }
      }
      return sum.map((v) => v / n) as V3;
    };
    const before = buildFigure(anime(1.6));
    const after = buildFigure(anime(1.6, { Chest_01_L: { position: [0.02, 0, 0] } }));
    const a = centroid(before, 1);
    const b = centroid(after, 1);
    expect(b[0] - a[0]).toBeGreaterThan(0.01);
    expect(b[0] - a[0]).toBeLessThan(0.025);
    expect(Math.abs(b[1] - a[1])).toBeLessThan(0.005);
    expect(centroid(after, -1)).toEqual(centroid(before, -1));
    // 部件跟着挪到胸中心（操纵杆在那里），但不转不缩放
    expect(part(after, 'Chest_01_L').pos[0] - part(before, 'Chest_01_L').pos[0]).toBeCloseTo(0.02, 9);
    expect(part(after, 'Chest_01_L').scale).toBeUndefined();
  }, 60_000);
});
