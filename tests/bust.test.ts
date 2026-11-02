// 二次元素体的胸：贴在平胸躯干表面上的一层（anime/chest.ts、ChestShape；tools/build-chest.ts 从 CC0 参考模型上采的胸型）
import { describe, expect, it } from 'vitest';
import { chestFrame, chestLayers, chestRound, chestSkin, registerChestRound, shell, surfacePoint, zcOf } from '../src/anime/chest';
import { animeGrid } from '../src/anime/body';
import type { ChestShape, Figure, Part } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import type { V3 } from '../src/geometry/vec';
import { type BodySpec, type PartOverride, defaultSpec, normalizeSpec } from '../src/model/spec';
import { compileField, fieldAt } from '../src/sdf/field';
import { chestDist, getGrid, gridDist } from '../src/sdf/grids';
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

/** 不带身高、腰胯变形的原始躯干，用来量与离线验收图同单位的体积。 */
const nativeChest = (size: number, side: 1 | -1 = 1): ChestShape => ({
  kind: 'chest', name: 'Breast', body: { kind: 'grid', name: 'Torso', grid: animeGrid('torsoFlat') }, origin: [0, 0, 0], side, size,
});

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
    for (const bust of [1.8, 2.2, 2.3]) {
      const f = buildFigure(anime(bust));
      const field = chestField(f);
      const [x0, y0, z0] = centerOf(f);
      let found = false;
      // 往圆里变以后胸整个往外挪了一点：在胸部件中心往外几条竖线上找
      for (let dx = 0; dx <= 0.03 && !found; dx += 0.01) {
        for (let dy = 0; dy < 0.2 * f.scale && !found; dy += 0.003) {
          // 从前面往后走：实心几段
          let solids = 0;
          let inside = false;
          for (let z = z0 + 0.4 * f.scale; z > z0 - 0.15 * f.scale; z -= 0.001) {
            const now = fieldAt(field, x0 + dx * f.scale, y0 - dy, z) < 0;
            if (now && !inside) solids++;
            inside = now;
          }
          found = solids >= 2;
        }
      }
      expect(found, `胸 ${bust}`).toBe(true);
    }
  });

  it('胸根没有折痕：胸中心那个高度上从正中往侧面绕一圈，表面的走向慢慢变，没有突然拐弯', () => {
    // 量到后侧 120 度（大胸往侧面鼓，要完整经过它和躯干的交界）；原来的大胸型调到 1.6 上下时外侧胸根有一道勒痕（四十度上下），往圆里变以后没了
    for (const bust of [0.8, 1.3, 1.6, 1.63, 2.2, 2.3]) {
      const f = buildFigure(anime(bust));
      const field = chestField(f);
      const torso = part(f, 'Torso');
      const s = f.scale;
      const [, y] = centerOf(f);
      // 躯干的竖轴（展开图上那一行的前后正中），从它往外沿各个角度量到表面多远
      const zc = (torso.pos[2] + zcOf(chestFrame(), y / s - torso.pos[1])) * s;
      const pts: [number, number][] = [];
      for (let deg = 2; deg <= 120; deg += 2) {
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
      let checked = 0;
      for (let k = 1; k + 1 < pts.length; k++) {
        // 乳头可能经过这张横切面，不能把乳头的圆尖当成胸根折痕：只量离平胸表面两厘米以内的根部
        const h = shell(chestFrame(), pts[k][0] / s - torso.pos[0], y / s - torso.pos[1], pts[k][1] / s - torso.pos[2]).h;
        if (h > 0.02) continue;
        checked++;
        const a = Math.atan2(pts[k][1] - pts[k - 1][1], pts[k][0] - pts[k - 1][0]);
        const b = Math.atan2(pts[k + 1][1] - pts[k][1], pts[k + 1][0] - pts[k][0]);
        let turn = Math.abs(b - a);
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        worst = Math.max(worst, (turn * 180) / Math.PI);
      }
      // 每 2 度（4 毫米上下）拐多少度：乳沟、胸侧和躯干接上的那一道弯（半径一厘米上下）拐二十几度；一道折痕是一下子拐四五十度
      expect(worst, `胸 ${bust}`).toBeLessThan(35);
      expect(checked, `胸 ${bust} 有量到胸根`).toBeGreaterThan(2);
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
    for (const bust of [0.5, 0.8, 1.2, 1.6, 2.2, 2.3]) {
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

  it('实际凸出体积随滑块连续增大，往圆里变以后和参考胸差不多大', () => {
    const flat = gridDist(getGrid(animeGrid('torsoFlat'))).fn;
    const volumes = new Map<number, number>();
    let last = 0;
    // 单边按 5 毫米体素计，再乘二；量的是平胸以外的体积，不能把插入躯干的封口算进去。
    const h = 0.005;
    for (const size of [0.6, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.63, 1.9, 2.2, 2.3]) {
      const d = chestDist(nativeChest(size));
      let n = 0;
      for (let x = h / 2; x < d.max[0]; x += h) {
        for (let y = d.min[1] + h / 2; y < d.max[1]; y += h) {
          for (let z = d.min[2] + h / 2; z < d.max[2]; z += h) if (d.fn(x, y, z) < 0 && flat(x, y, z) >= 0) n++;
        }
      }
      const liters = n * h ** 3 * 2000;
      expect(liters, `胸 ${size} 单调增大`).toBeGreaterThan(last);
      last = liters;
      volumes.set(size, liters);
    }
    // 参考胸原样时 0.6 / 1 / 1.6 / 2.2 约 0.03 / 0.19 / 1.53 / 4.37 升；允许体素计数误差和往圆里变带来的变化
    expect(volumes.get(0.6)).toBeGreaterThan(0.02);
    expect(volumes.get(0.6)).toBeLessThan(0.05);
    expect(volumes.get(1)).toBeGreaterThan(0.16);
    expect(volumes.get(1)).toBeLessThan(0.23);
    expect(volumes.get(1.6)).toBeGreaterThan(1.35);
    expect(volumes.get(1.6)).toBeLessThan(1.85);
    expect(volumes.get(2.2)).toBeGreaterThan(3.9);
    expect(volumes.get(2.2)).toBeLessThan(4.9);
    expect(volumes.get(2.3)).toBeLessThan(6);
  });

  it('往圆里变：侧面看是圆的（往前凸不比胸根高）、胸底是一段凸弧，左右对称', () => {
    for (const size of [1.6, 2.2, 2.3]) {
      const fn = gridDist(getGrid(animeGrid('torsoFlat')), { skin: chestSkin(nativeChest(size)) }).fn;
      const left = chestSkin(nativeChest(size));
      const right = chestSkin(nativeChest(size, -1));
      const u = chestLayers(size).layers[0].at[0];
      const bottom: number[] = [];
      let rootLo = Infinity;
      let rootHi = -Infinity;
      let lastH = 0;
      for (let ih = 0; ih < 140; ih++) {
        const h = 0.003 + ih * 0.002;
        let low = NaN;
        for (let y = 0.9; y < 1.31; y += 0.002) {
          const p = surfacePoint(chestFrame(), u, y, h);
          const d = fn(...p);
          if (ih % 10 === 0) {
            // 两边给同一个胸壁距离，排除素体原网格的小幅不对称；胸层自身必须严格镜像
            const a = left.prepare(...p, y);
            const b = right.prepare(-p[0], p[1], p[2], y);
            expect(a > 0 ? a : left.finish(h)).toBeCloseTo(b > 0 ? b : right.finish(h), 9);
          }
          if (d >= 0) continue;
          if (!Number.isFinite(low)) low = y;
          lastH = ih;
          if (ih === 0) {
            rootLo = Math.min(rootLo, y);
            rootHi = Math.max(rootHi, y);
          }
        }
        bottom.push(low);
      }
      // 参考的大胸型原样时往前伸成一根筒（1.6 时往前凸比胸根还高）
      expect((0.003 + lastH * 0.002) / (rootHi - rootLo), `胸 ${size} 往前凸与胸根高度比`).toBeLessThan(0.9);
      // 胸底从胸下褶往前是一段凸弧：弦中点不高于两端均值（留两毫米给离散采样）
      const lo = Math.round(lastH * 0.25);
      const hi = Math.round(lastH * 0.75);
      const mid = Math.round((lo + hi) / 2);
      expect(bottom[mid] - (bottom[lo] + bottom[hi]) / 2, `胸 ${size} 下缘圆弧`).toBeLessThanOrEqual(0.0021);
    }
  });

  it('1.1 以下的小胸不往圆里变，往上渐渐变', () => {
    const round = chestRound();
    expect(round).not.toBeNull();
    const sample = (size: number) => {
      const skin = chestSkin(nativeChest(size));
      const out: number[] = [];
      for (let i = 0; i < 400; i++) {
        const x = 0.01 + ((i * 37) % 100) * 0.0015;
        const y = 1.05 + ((i * 53) % 100) * 0.002;
        const z = 0.05 + ((i * 71) % 100) * 0.002;
        const far = skin.prepare(x, y, z, y);
        out.push(far > 0 ? far : skin.finish(0.01));
      }
      return out;
    };
    const withRound = [1, 1.6].map(sample);
    registerChestRound(null);
    const without = [1, 1.6].map(sample);
    registerChestRound(round);
    expect(withRound[0]).toEqual(without[0]);
    expect(withRound[1]).not.toEqual(without[1]);
  });

  it('分部件时每个胸是封闭的一块（胸根以内，插进躯干一点）', () => {
    for (const bust of [1, 2.2, 2.3]) {
      const f = buildFigure(anime(bust));
      for (const p of f.parts.filter((q) => q.type === 'chest')) {
        const d = chestDist(p.prims[0] as ChestShape, true);
        const mesh = meshField(fieldFromFunction(d.fn, d.min, d.max), 0.005);
        expect(mesh.triangles.length, `${bust} ${p.name}`).toBeGreaterThan(300);
        const edges = new Map<string, number>();
        const parent = new Map<number, number>();
        const root = (v: number): number => {
          if (!parent.has(v)) parent.set(v, v);
          while (parent.get(v) !== v) {
            parent.set(v, parent.get(parent.get(v)!)!);
            v = parent.get(v)!;
          }
          return v;
        };
        for (let k = 0; k < mesh.triangles.length; k += 3) {
          for (let e = 0; e < 3; e++) {
            const a = mesh.triangles[k + e];
            const b = mesh.triangles[k + ((e + 1) % 3)];
            const key = a < b ? `${a},${b}` : `${b},${a}`;
            edges.set(key, (edges.get(key) ?? 0) + 1);
            parent.set(root(a), root(b));
          }
        }
        expect([...edges.values()].filter((n) => n !== 2).length, `${bust} ${p.name}`).toBe(0);
        expect(new Set([...parent.keys()].map(root)).size, `${bust} ${p.name} 只有一块`).toBe(1);
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

  it('手动微调往正中线挪过了头：整个胸平移过去，越过正中线（不在正中压成一面看不见的墙）', () => {
    /** 只看躯干和左胸：比平胸躯干多出来的格点，x 最小到哪、重心在哪 */
    const spread = (f: Figure) => {
      const field = compileField({ ...f, parts: f.parts.filter((p) => p.type === 'torso' || p.name === 'Chest_01_L') }, { blend: 0 });
      const flat = compileField({ ...f, parts: f.parts.filter((p) => p.type === 'torso') }, { blend: 0 });
      const [, y0, z0] = centerOf(f);
      let least = Infinity;
      let sum = 0;
      let n = 0;
      for (let x = -0.2; x < 0.25; x += 0.004) {
        for (let y = y0 - 0.2; y < y0 + 0.12; y += 0.004) {
          for (let z = z0 - 0.05; z < z0 + 0.25; z += 0.004) {
            if (fieldAt(field, x, y, z) >= 0 || fieldAt(flat, x, y, z) < 0.002) continue;
            least = Math.min(least, x);
            sum += x;
            n++;
          }
        }
      }
      return { least, mid: sum / n, n };
    };
    const before = spread(buildFigure(anime(1.3)));
    const after = spread(buildFigure(anime(1.3, { Chest_01_L: { position: [-0.12, 0, 0] } })));
    // 默认的不过正中线
    expect(before.least).toBeGreaterThan(-0.01);
    // 挪过头的：胸越过正中线好几厘米，整个往那边挪；往里那半截压到 SQUEEZE 就不再压，体积少不了太多（以前压进正中一厘米宽的一条里）
    expect(after.least).toBeLessThan(-0.04);
    expect(after.mid).toBeLessThan(before.mid - 0.06);
    expect(after.n / before.n).toBeGreaterThan(0.6);
    expect(after.n / before.n).toBeLessThan(1.1);
  }, 60_000);
});
