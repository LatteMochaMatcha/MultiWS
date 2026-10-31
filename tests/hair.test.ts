// 白模人台和二次元素体的头发：现成的头发转成的一层壳（public/hair/ 下面的数据），戴在头上，和头融合成一整块。
import { describe, expect, it } from 'vitest';
import { findClashes } from '../src/geometry/clash';
import type { Figure, GridShape, Part } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { buildPartGeometry } from '../src/geometry/partsMesh';
import { ANIME_SKULL, wigOf } from '../src/geometry/wig';
import { hairBounds, hairGrid, hairReady } from '../src/hair/shapes';
import { partLabel } from '../src/model/partLabel';
import { type BodySpec, type HairSpec, defaultHair, defaultSpec } from '../src/model/spec';
import { applyParse, parseDescription } from '../src/parser';
import { buildSkeleton } from '../src/rig/skeleton';
import { skinVertices } from '../src/rig/skin';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
import { getGrid, gridDist } from '../src/sdf/grids';
import type { FusedMesh } from '../src/sdf/surfaceNets';
import { useAnimeBody } from './animeBody';
import { HAIR_SHAPES, useHairShapes } from './hairShapes';

useAnimeBody();
useHairShapes();

type Body = 'mannequin' | 'anime';
const BODIES: readonly Body[] = ['mannequin', 'anime'];
const spec = (bodyStyle: Body, hair: Partial<HairSpec> = {}, text = '', rest: Partial<BodySpec> = {}): BodySpec => {
  const base = applyParse(defaultSpec(), parseDescription(text));
  return { ...base, ...rest, bodyStyle, hair: { ...base.hair, ...hair } };
};
const figureOf = (bodyStyle: Body, hair: Partial<HairSpec> = {}, text = '', rest: Partial<BodySpec> = {}) => buildFigure(spec(bodyStyle, hair, text, rest));
const hairParts = (figure: Figure) => figure.parts.filter((part) => part.type === 'hair');
const shapeOf = (part: Part) => part.prims[0] as GridShape;
const fuse = (figure: Pick<Figure, 'parts'>, voxel: number = VOXEL.preview) => fuseParts(figure.parts, { voxel, blend: 0.02 });
/** 只把头发取成网格（别的部件留着位置、不画），坐标和整个人的一样 */
const hairOnly = (figure: Figure) =>
  fuseParts(
    figure.parts.map((part) => (part.type === 'hair' ? part : { ...part, prims: [], grafts: undefined })),
    { voxel: VOXEL.draft, blend: 0 },
  );

/** 每条边正好被两个面共用、方向相反：一张封闭的、朝向一致的网格 */
function expectClosed(mesh: FusedMesh, label: string) {
  const edges = new Map<number, number>();
  const n = mesh.positions.length / 3;
  for (const [faces, size] of [[mesh.quads, 4], [mesh.tris ?? new Uint32Array(0), 3]] as const) {
    for (let q = 0; q < faces.length; q += size) {
      for (let k = 0; k < size; k++) {
        const key = faces[q + k] * n + faces[q + ((k + 1) % size)];
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
  }
  let bad = 0;
  for (const [key, count] of edges) {
    const a = Math.floor(key / n);
    const b = key % n;
    if (count !== 1 || edges.get(b * n + a) !== 1) bad++;
  }
  expect(bad, `${label} 有没封上的边或非流形边`).toBe(0);
  expect(mesh.positions.every(Number.isFinite), label).toBe(true);
}
function extent(positions: ArrayLike<number>, axis: 0 | 1 | 2) {
  let low = Infinity;
  let high = -Infinity;
  for (let i = axis; i < positions.length; i += 3) {
    low = Math.min(low, positions[i]);
    high = Math.max(high, positions[i]);
  }
  return { low, high };
}

describe('白模用的头发数据', () => {
  it('四副头发都登记好了；「原装」是成品角色自己的头发，白模没有', () => {
    for (const style of HAIR_SHAPES) expect(hairReady(style), style).toBe(true);
    expect(hairReady('own')).toBe(false);
    expect(wigOf(defaultHair())).toBeNull();
    expect(wigOf({ ...defaultHair(), style: 'long', length: 1.2 })).toEqual({ ...defaultHair(), style: 'long', length: 1.2 });
  });

  it('存的是到头发面片的距离：没有负数，面片上接近 0，远处封顶', () => {
    for (const style of HAIR_SHAPES) {
      const grid = getGrid(hairGrid(style));
      let low = Infinity;
      let high = -Infinity;
      for (const v of grid.data) {
        if (v < low) low = v;
        if (v > high) high = v;
      }
      expect(low, style).toBeGreaterThanOrEqual(0);
      // 最近的格点离面片不到一毫米
      expect((low / 32767) * grid.band, style).toBeLessThan(0.001);
      expect(high, style).toBe(32767);
      // 头发占的范围在格子里面，四周留着白
      const bounds = hairBounds(style);
      for (let k = 0; k < 3; k++) {
        expect(bounds.min[k], style).toBeGreaterThan(grid.min[k] + 0.02);
        expect(bounds.max[k], style).toBeLessThan(grid.min[k] + (grid.dims[k] - 1) * grid.cell - 0.02);
      }
      // 头发戴在头上：头顶在素体的头顶（约 0.12）上面一点，左右差不多居中
      expect(bounds.max[1], style).toBeGreaterThan(0.12);
      expect(bounds.max[1], style).toBeLessThan(0.17);
      expect(Math.abs(bounds.min[0] + bounds.max[0]), style).toBeLessThan(0.08);
    }
    // 长直发垂得最低，波波头最短
    expect(hairBounds('long').min[1]).toBeLessThan(hairBounds('twintails').min[1] - 0.1);
    expect(hairBounds('bob').min[1]).toBeGreaterThan(hairBounds('sidetail').min[1]);
  });

  it('壳：离面片 shell 以内算实心，范围跟着往外扩', () => {
    const grid = getGrid(hairGrid('bob'));
    const plain = gridDist(grid);
    const shell = gridDist(grid, { shell: 0.005 });
    // 找一个离面片最近的格点
    let at = 0;
    for (let i = 1; i < grid.data.length; i++) if (grid.data[i] < grid.data[at]) at = i;
    const [nx, ny] = grid.dims;
    const p = [grid.min[0] + (at % nx) * grid.cell, grid.min[1] + (Math.floor(at / nx) % ny) * grid.cell, grid.min[2] + Math.floor(at / (nx * ny)) * grid.cell];
    expect(plain.fn(p[0], p[1], p[2])).toBeGreaterThanOrEqual(0);
    expect(shell.fn(p[0], p[1], p[2])).toBeCloseTo(plain.fn(p[0], p[1], p[2]) - 0.005, 6);
    expect(shell.fn(p[0], p[1], p[2])).toBeLessThan(0);
    // 格子外面老远的地方不是头发
    expect(shell.fn(1, 1, 1)).toBeGreaterThan(0.5);
    for (let k = 0; k < 3; k++) {
      expect(shell.min[k]).toBeCloseTo(plain.min[k] - 0.005, 9);
      expect(shell.max[k]).toBeCloseTo(plain.max[k] + 0.005, 9);
    }
  });
});

describe('白模人台和二次元素体戴头发', () => {
  it('头发是头的一个子部件：一块壳，没有自己的骨骼；不戴（光头）就没有这个部件', () => {
    for (const body of BODIES) {
      expect(hairParts(figureOf(body))).toEqual([]);
      const figure = figureOf(body, { style: 'long' });
      const [wig, ...more] = hairParts(figure);
      expect(more).toEqual([]);
      expect(wig).toMatchObject({ name: 'Head_01_Hair', type: 'hair', parent: 'Head_01', side: 0, material: 'clay' });
      expect(wig.bones).toBeUndefined();
      expect(wig.prims).toHaveLength(1);
      expect(shapeOf(wig)).toMatchObject({ kind: 'grid', grid: 'hair/long' });
      expect(shapeOf(wig).shell).toBeGreaterThan(0.003);
      // 身高、头身比量的是头，戴不戴头发都一样
      expect(figure.metrics).toEqual(figureOf(body).metrics);
      expect(figure.scale).toBe(figureOf(body).scale);
      // 头发排在头后面，别的部件一个没动
      const bald = figureOf(body).parts.map((part) => part.name);
      expect(figure.parts.map((part) => part.name).filter((name) => name !== 'Head_01_Hair')).toEqual(bald);
    }
  });

  it('素体的头直接戴上；白模人台的头小一圈，头发照颅骨的大小各个方向压一压', () => {
    const anime = hairParts(figureOf('anime', { style: 'bob' }))[0];
    expect(anime.stretch).toBeUndefined();
    expect(anime.pos).toEqual([0, 0, 0]);
    const mannequin = hairParts(figureOf('mannequin', { style: 'bob' }))[0];
    for (const s of mannequin.stretch!) {
      expect(s).toBeGreaterThan(0.8);
      expect(s).toBeLessThan(0.95);
    }
    // 颅骨的中心对上颅骨的中心：素体的颅骨中心照这个压法挪过去，正好是白模的颅骨中心 (0, 0.03, -0.012)
    const center = ANIME_SKULL.center.map((c, k) => mannequin.pos[k] + mannequin.stretch![k] * c);
    expect(center[0]).toBeCloseTo(0, 6);
    expect(center[1]).toBeCloseTo(0.03, 6);
    expect(center[2]).toBeCloseTo(-0.012, 6);
  });

  it('蓬松：整副头发以颅骨为中心放大；长度：垂着的那一段拉长，头顶不动', () => {
    const puffy = hairParts(figureOf('anime', { style: 'long', volume: 1.1 }))[0];
    expect(puffy.stretch).toEqual([1.1, 1.1, 1.1]);
    // 颅骨的中心没挪地方
    ANIME_SKULL.center.forEach((c, k) => expect(puffy.pos[k] + 1.1 * c).toBeCloseTo(c, 9));

    const plain = hairParts(figureOf('anime', { style: 'long' }))[0];
    expect(shapeOf(plain).stretchY).toBeUndefined();
    const longer = hairParts(figureOf('anime', { style: 'long', length: 1.5 }))[0];
    const [from, to, extra] = shapeOf(longer).stretchY!;
    expect(from).toBeLessThan(hairBounds('long').min[1]);
    expect(to).toBeGreaterThan(from + 0.3);
    expect(extra).toBeCloseTo(0.5 * (to - from), 9);
    // 格子把这一段拉开时上面的整个往上挪了，部件再挪回来
    expect(longer.pos[1]).toBeCloseTo(-extra, 9);
    const shorter = hairParts(figureOf('anime', { style: 'long', length: 0.6 }))[0];
    expect(shapeOf(shorter).stretchY![2]).toBeLessThan(0);

    for (const body of BODIES) {
      const base = hairOnly(figureOf(body, { style: 'long' }));
      const long = hairOnly(figureOf(body, { style: 'long', length: 1.5 }));
      const short = hairOnly(figureOf(body, { style: 'long', length: 0.6 }));
      const big = hairOnly(figureOf(body, { style: 'long', volume: 1.2 }));
      // 头顶没变，发梢垂得更低（缩短就更高）
      expect(extent(long.positions, 1).high, body).toBeCloseTo(extent(base.positions, 1).high, 2);
      expect(extent(long.positions, 1).low, body).toBeLessThan(extent(base.positions, 1).low - 0.1);
      expect(extent(short.positions, 1).low, body).toBeGreaterThan(extent(base.positions, 1).low + 0.08);
      expect(extent(short.positions, 1).high, body).toBeCloseTo(extent(base.positions, 1).high, 2);
      // 蓬松：头顶高了，两边也宽了
      expect(extent(big.positions, 1).high, body).toBeGreaterThan(extent(base.positions, 1).high + 0.01);
      expect(extent(big.positions, 0).high, body).toBeGreaterThan(extent(base.positions, 0).high + 0.01);
    }
  });

  it('多个头各戴一副；一个头几张脸只戴一副', () => {
    for (const body of BODIES) {
      expect(hairParts(figureOf(body, { style: 'sidetail' }, '三个头')).map((part) => `${part.name}<${part.parent}`)).toEqual([
        'Head_01_Hair<Head_01',
        'Head_02_Hair<Head_02',
        'Head_03_Hair<Head_03',
      ]);
      expect(hairParts(figureOf(body, { style: 'sidetail' }, '三张脸')).map((part) => part.name)).toEqual(['Head_01_Hair']);
    }
  });

  it('角和兽耳长在头发外面：戴了头发，它们的根跟着往外挪', () => {
    for (const body of BODIES) {
      const bald = figureOf(body, {}, '猫耳 两只角');
      const haired = figureOf(body, { style: 'long' }, '猫耳 两只角');
      for (const name of ['Head_01_Ear_01_L', 'Head_01_Ear_01_R', 'Head_01_Horn_01_L', 'Head_01_Horn_01_R']) {
        const before = bald.parts.find((part) => part.name === name)!;
        const after = haired.parts.find((part) => part.name === name)!;
        expect(after.pos[1], `${body} ${name}`).toBeGreaterThan(before.pos[1] + 0.004);
        expect(after.pos[1], `${body} ${name}`).toBeLessThan(before.pos[1] + 0.06);
      }
      // 眼睛还是贴着脸放的，不会跑到刘海上
      const eye = (figure: Figure) => figure.parts.find((part) => part.name === 'Head_01_Eye_01_L');
      expect(eye(haired)?.pos).toEqual(eye(bald)?.pos);
    }
  });

  it('融合：每副头发戴在两种白模上，都是一整块封闭网格；头顶高出一截', () => {
    for (const body of BODIES) {
      const bald = fuse(figureOf(body));
      for (const style of HAIR_SHAPES) {
        const label = `${body} ${style}`;
        const mesh = fuse(figureOf(body, { style }));
        expectClosed(mesh, label);
        expect(mesh.info.components, label).toBe(1);
        const rise = extent(mesh.positions, 1).high - extent(bald.positions, 1).high;
        expect(rise, label).toBeGreaterThan(0.005);
        expect(rise, label).toBeLessThan(0.08);
        // 脚下没变
        expect(extent(mesh.positions, 1).low, label).toBeCloseTo(extent(bald.positions, 1).low, 3);
        expect(mesh.triangles.length, label).toBeGreaterThan(bald.triangles.length);
      }
    }
  });

  it('三档精度下都是一整块封闭网格：网格粗的时候壳自动加厚，不会破洞', () => {
    for (const body of BODIES) {
      for (const voxel of [VOXEL.draft, VOXEL.fine]) {
        for (const style of ['long', 'twintails'] as const) {
          const mesh = fuse(figureOf(body, { style }), voxel);
          expectClosed(mesh, `${body} ${style} 体素 ${voxel}`);
          expect(mesh.info.components, `${body} ${style} 体素 ${voxel}`).toBe(1);
        }
      }
    }
  });

  it('和别的一起用：多个头、几张脸、兽耳和角、人马、调过长短和蓬松，都是一整块封闭网格', () => {
    const cases: [Body, Partial<HairSpec>, string][] = [
      ['mannequin', { style: 'sidetail' }, '两个头，两对手，两对胸'],
      ['anime', { style: 'bob' }, '三个头 猫耳'],
      ['mannequin', { style: 'long' }, '阿修罗'],
      ['anime', { style: 'twintails', length: 1.5, volume: 1.15 }, '半人马 九尾 两只角 狐耳'],
      ['mannequin', { style: 'long', length: 0.6, volume: 0.97 }, '六翼 精灵耳'],
      ['anime', { style: 'long', length: 1.4 }, '五个头 T-pose'],
    ];
    for (const [body, hair, text] of cases) {
      const mesh = fuse(figureOf(body, hair, text));
      expectClosed(mesh, `${body} ${hair.style} ${text}`);
      expect(mesh.info.components, `${body} ${hair.style} ${text}`).toBe(1);
    }
  });

  it('蒙皮：头发整个跟着它所在的那个头', () => {
    for (const body of BODIES) {
      const figure = { parts: figureOf(body, { style: 'bob' }, '两个头').parts, scale: 1 };
      const mesh = fuse(figure, VOXEL.draft);
      const skeleton = buildSkeleton(figure);
      const skin = skinVertices(figure, skeleton, mesh.positions);
      // 没有多出骨骼：头发没有自己的骨骼
      expect(skeleton.bones.map((bone) => bone.name)).toEqual(buildSkeleton({ parts: figureOf(body, {}, '两个头').parts, scale: 1 }).bones.map((bone) => bone.name));
      // 最高的那些顶点在头发上：每个都几乎全跟着某一个头
      const top = extent(mesh.positions, 1).high;
      const heads = new Set<string>();
      let checked = 0;
      for (let v = 0; v < mesh.positions.length / 3; v++) {
        if (mesh.positions[v * 3 + 1] < top - 0.03) continue;
        let onHead = 0;
        for (let k = 0; k < 4; k++) {
          const name = skeleton.bones[skin.joints[v * 4 + k]].name;
          if (/^Head(\.\d+)?$/.test(name) && skin.weights[v * 4 + k] > 0.5) heads.add(name);
          if (/^Head(\.\d+)?$/.test(name)) onHead += skin.weights[v * 4 + k];
        }
        if (onHead < 0.95) throw new Error(`${body} 第 ${v} 个顶点（头发上）只有 ${onHead} 跟着头`);
        checked++;
      }
      expect(checked, body).toBeGreaterThan(20);
      expect(heads.size, body).toBeGreaterThanOrEqual(1);
    }
  });

  it('穿模检查不管头发：它本来就是搭在别的东西上的', () => {
    for (const body of BODIES) {
      const clashes = findClashes(figureOf(body, { style: 'long', length: 1.5 }, '三个头 六翼 九尾 两对手'));
      expect(clashes.filter((clash) => /Hair/.test(clash.a) || /Hair/.test(clash.b))).toEqual([]);
    }
  });

  it('分部件模式：头发是单独的一块网格；部件的名字认得出来', () => {
    const wig = hairParts(figureOf('anime', { style: 'twintails' }))[0];
    const geometry = buildPartGeometry(wig);
    expect(geometry.attributes.position.count).toBeGreaterThan(2000);
    geometry.computeBoundingBox();
    // 双马尾往两边伸出去
    expect(geometry.boundingBox!.max.x).toBeGreaterThan(0.15);
    expect(geometry.boundingBox!.min.x).toBeLessThan(-0.15);
    geometry.dispose();
    expect(partLabel('Head_01_Hair')).toBe('头 1 · 头发');
    expect(partLabel('Head_03_Hair')).toBe('头 3 · 头发');
  });
});
