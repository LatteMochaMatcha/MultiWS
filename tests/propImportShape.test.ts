// 自己导入素材（docs/import-plan.md 第 2 期）：读 OBJ、STL，照形状自己找坐面、台面、床面
import { afterEach, describe, expect, it } from 'vitest';
import { makeAssetProp } from '../src/model/props';
import { autoContacts, heightMap } from '../src/props/autoContacts';
import { type UserAsset, forgetUserAsset, registerUserAsset } from '../src/props/catalog';
import { propContacts } from '../src/props/contacts';
import { buildImport, readImportGlb } from '../src/props/importMesh';
import { cornerNormals, importKind, readImportFile, readImportObj, readImportStl, weldPoints } from '../src/props/importShape';
import { dropUserAsset, installUserAsset } from '../src/props/library';
import { encodeRealAsset } from '../src/props/realFile';
import type { Vec3 } from '../src/model/spec';

const ID = 'my-00112233445566ff';
const text = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

/** 一个长方块：x、y、z 各从哪到哪 */
type Box = [number, number, number, number, number, number];

/** 几个长方块拼成的网格（每块 8 个点、12 个面，面朝外） */
function boxes(list: Box[]): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [x0, x1, y0, y1, z0, z1] of list) {
    const base = positions.length / 3;
    for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) positions.push(x, y, z);
    // 点的编号：x 是第 0 位，y 第 1 位，z 第 2 位
    for (const quad of [
      [0, 2, 3, 1],
      [4, 5, 7, 6],
      [0, 1, 5, 4],
      [2, 6, 7, 3],
      [0, 4, 6, 2],
      [1, 3, 7, 5],
    ]) {
      indices.push(base + quad[0], base + quad[1], base + quad[2], base + quad[0], base + quad[2], base + quad[3]);
    }
  }
  return { positions, indices };
}

/** 一个圆柱（轴是 y） */
function cylinder(r: number, y0: number, y1: number, around = 48): { positions: number[]; indices: number[] } {
  const positions: number[] = [0, y1, 0, 0, y0, 0];
  const indices: number[] = [];
  for (let i = 0; i < around; i++) {
    const a = (i / around) * Math.PI * 2;
    positions.push(Math.cos(a) * r, y1, Math.sin(a) * r, Math.cos(a) * r, y0, Math.sin(a) * r);
  }
  for (let i = 0; i < around; i++) {
    const [t0, b0, t1, b1] = [2 + i * 2, 3 + i * 2, 2 + ((i + 1) % around) * 2, 3 + ((i + 1) % around) * 2];
    indices.push(0, t1, t0, 1, b0, b1, t0, t1, b1, t0, b1, b0);
  }
  return { positions, indices };
}

function objOf(mesh: { positions: number[]; indices: number[] }): string {
  const lines: string[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) lines.push(`v ${mesh.positions[i]} ${mesh.positions[i + 1]} ${mesh.positions[i + 2]}`);
  for (let i = 0; i < mesh.indices.length; i += 3) lines.push(`f ${mesh.indices[i] + 1} ${mesh.indices[i + 1] + 1} ${mesh.indices[i + 2] + 1}`);
  return lines.join('\n');
}

function stlOf(mesh: { positions: number[]; indices: number[] }): ArrayBuffer {
  const count = mesh.indices.length / 3;
  const out = new ArrayBuffer(84 + count * 50);
  const view = new DataView(out);
  view.setUint32(80, count, true);
  for (let f = 0; f < count; f++) {
    for (let k = 0; k < 3; k++) {
      for (let c = 0; c < 3; c++) view.setFloat32(84 + f * 50 + 12 + (k * 3 + c) * 4, mesh.positions[mesh.indices[f * 3 + k] * 3 + c], true);
    }
  }
  return out;
}

/** 椅子：四条腿、坐面、靠背在 -Z 那一头 */
const CHAIR: Box[] = [
  [-0.225, -0.185, 0, 0.42, -0.225, -0.185],
  [0.185, 0.225, 0, 0.42, -0.225, -0.185],
  [-0.225, -0.185, 0, 0.42, 0.185, 0.225],
  [0.185, 0.225, 0, 0.42, 0.185, 0.225],
  [-0.225, 0.225, 0.42, 0.46, -0.225, 0.225],
  [-0.225, 0.225, 0.46, 0.9, -0.225, -0.185],
];
const CHAIR_SIZE: Vec3 = [0.45, 0.9, 0.45];

/** 绕竖轴转 90° 的整数倍（一次是 +Z 那头转到 +X 那头） */
function turned(list: Box[], quarter: number): Box[] {
  let out = list;
  for (let i = 0; i < quarter; i++) out = out.map(([x0, x1, y0, y1, z0, z1]) => [z0, z1, y0, y1, -x1, -x0] as Box);
  return out;
}

describe('认文件', () => {
  it('照后缀认，别的不认', () => {
    expect(importKind('椅子.GLB')).toBe('glb');
    expect(importKind('a b.obj')).toBe('obj');
    expect(importKind('part.Stl')).toBe('stl');
    expect(importKind('chair.dae')).toBeNull();
    expect(importKind('obj')).toBeNull();
  });

  it('照种类分给各自的读法', () => {
    expect(readImportFile('obj', text(objOf(boxes([[0, 1, 0, 1, 0, 1]])))).plain).toBe(true);
    expect(readImportFile('stl', stlOf(boxes([[0, 1, 0, 1, 0, 1]]))).plain).toBe(true);
    expect(() => readImportFile('glb', text('不是 GLB'))).toThrow();
    expect(readImportGlb).toBeTypeOf('function');
  });
});

describe('读 OBJ', () => {
  it('四边形拆成两个三角，倒着数的下标、贴图坐标、法线都认', () => {
    const source = readImportObj(
      text(
        [
          '# 一个正方形',
          'mtllib a.mtl',
          'v 0 0 0',
          'v 1 0 0',
          'v 1 1 0',
          'v 0 1 0',
          'vt 0 0',
          'vt 1 0',
          'vt 1 1',
          'vt 0 1',
          'vn 0 0 2',
          'usemtl wood',
          'f 1/1/1 2/2/1 -2/3/1 -1/4/-1',
        ].join('\r\n'),
      ),
    );
    expect(source.faceMaterial.length).toBe(2);
    expect(Array.from(source.positions)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]);
    // 法线化成单位长
    expect(Array.from(source.normals.subarray(0, 3))).toEqual([0, 0, 1]);
    // 贴图坐标上下翻过来（工坊照 glTF：左上角是原点）
    expect(Array.from(source.uvs.subarray(0, 6))).toEqual([0, 1, 1, 1, 1, 0]);
    expect(source.min).toEqual([0, 0, 0]);
    expect(source.max).toEqual([1, 1, 0]);
    expect(source.plain).toBe(true);
    expect(source.textures).toEqual([]);
    // 材质没带上只说一遍
    expect(source.notes.length).toBe(1);
  });

  it('没带法线的照面算：箱子的棱还是棱', () => {
    const source = readImportObj(text(objOf(boxes([[0, 1, 0, 1, 0, 1]]))));
    expect(source.faceMaterial.length).toBe(12);
    for (let i = 0; i < source.normals.length; i += 3) {
      const n = [source.normals[i], source.normals[i + 1], source.normals[i + 2]].map((v) => Math.abs(v));
      // 每个角的法线都正对着一根轴，没有被旁边的面带歪
      expect(Math.max(...n)).toBeCloseTo(1, 5);
    }
    // 朝外：+X 那一面上的角，法线朝 +X
    const at = Array.from({ length: source.positions.length / 9 }, (_, f) => f).find((f) => [0, 1, 2].every((k) => source.positions[f * 9 + k * 3] === 1))!;
    expect(source.normals[at * 9]).toBeCloseTo(1, 5);
  });

  it('没带法线的圆柱：侧面是光滑的', () => {
    const source = readImportObj(text(objOf(cylinder(1, 0, 2))));
    let checked = 0;
    for (let i = 0; i < source.positions.length; i += 3) {
      const [x, y, z] = [source.positions[i], source.positions[i + 1], source.positions[i + 2]];
      const [nx, ny, nz] = [source.normals[i], source.normals[i + 1], source.normals[i + 2]];
      if (Math.abs(ny) > 0.5 || Math.hypot(x, z) < 0.5) continue;
      // 侧面上的角：法线顺着半径朝外
      expect(nx * x + nz * z).toBeGreaterThan(0.995);
      expect(Math.abs(ny)).toBeLessThan(1e-4);
      expect(y === 0 || y === 2).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('没有面的、点不够的读不了；坏的面跳过', () => {
    expect(() => readImportObj(text('v 0 0 0\nv 1 0 0\n'))).toThrow();
    expect(() => readImportObj(text('f 1 2 3\n'))).toThrow();
    const source = readImportObj(text('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\nf 1 2\nl 1 2\nf 1 2 3\n'));
    expect(source.faceMaterial.length).toBe(1);
    expect(source.notes.length).toBe(1);
    expect(() => readImportObj(text('v 0 0 0\nv 1 0 x\nv 0 1 0\nf 1 2 3\n'))).toThrow();
  });
});

describe('读 STL', () => {
  it('二进制的：一样的点合起来，法线照面算', () => {
    const source = readImportStl(stlOf(boxes([[-1, 1, 0, 2, -1, 1]])));
    expect(source.faceMaterial.length).toBe(12);
    expect(source.min).toEqual([-1, 0, -1]);
    expect(source.max).toEqual([1, 2, 1]);
    for (let i = 0; i < source.normals.length; i += 3) {
      expect(Math.max(Math.abs(source.normals[i]), Math.abs(source.normals[i + 1]), Math.abs(source.normals[i + 2]))).toBeCloseTo(1, 5);
    }
    expect(source.plain).toBe(true);
  });

  it('文字的也认', () => {
    const source = readImportStl(
      text('solid a\n facet normal 0 0 0\n  outer loop\n   vertex 0 0 0\n   vertex 1e0 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid a\n'),
    );
    expect(Array.from(source.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(source.normals.subarray(0, 3))).toEqual([0, 0, 1]);
  });

  it('圆柱的侧面是光滑的（文件里每个面各带三个点）', () => {
    const source = readImportStl(stlOf(cylinder(0.5, 0, 1)));
    let checked = 0;
    for (let i = 0; i < source.positions.length; i += 3) {
      const [x, z] = [source.positions[i], source.positions[i + 2]];
      if (Math.abs(source.normals[i + 1]) > 0.5 || Math.hypot(x, z) < 0.25) continue;
      expect((source.normals[i] * x + source.normals[i + 2] * z) / 0.5).toBeGreaterThan(0.995);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('长度对不上的、空的读不了；缩成一条线的面不要', () => {
    expect(() => readImportStl(new ArrayBuffer(100))).toThrow();
    expect(() => readImportStl(new ArrayBuffer(84))).toThrow();
    expect(() => readImportStl(text('solid empty\nendsolid empty\n'))).toThrow();
    const line = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 1, 0, 1, 2] };
    expect(readImportStl(stlOf(line)).faceMaterial.length).toBe(1);
  });

  it('合点：一样的坐标是同一个点，-0 和 0 算一样', () => {
    const { points, ids } = weldPoints(new Float32Array([0, 0, 0, 1, 2, 3, -0, 0, 0, 1, 2, 3, 1, 2, 3.5]));
    expect(Array.from(ids)).toEqual([0, 1, 0, 1, 2]);
    expect(points.length).toBe(9);
  });

  it('角的法线：平的一片里每个角都朝同一边', () => {
    const normals = cornerNormals([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], [0, 2, 1, 0, 3, 2]);
    for (let i = 0; i < normals.length; i += 3) expect([normals[i], normals[i + 1], normals[i + 2]]).toEqual([0, 1, 0]);
  });
});

describe('照形状找坐面、台面、床面', () => {
  it('高度图：量的是每格最高的面', () => {
    const map = heightMap(boxes(CHAIR), CHAIR_SIZE, 9);
    // 靠背那一排（-Z 那头）最高，别的是坐面
    expect(map[4]).toBeCloseTo(0.9, 5);
    expect(map[4 * 9 + 4]).toBeCloseTo(0.46, 5);
    expect(heightMap({ positions: [], indices: [] }, CHAIR_SIZE, 4).every((h) => h === -Infinity)).toBe(true);
  });

  it('椅子：坐面在靠背前面，脸背着靠背', () => {
    const found = autoContacts(boxes(CHAIR), CHAIR_SIZE, 'seat');
    expect(found.sit?.face).toBe(0);
    expect(found.sit!.rect.x[0]).toBeCloseTo(-0.5, 2);
    expect(found.sit!.rect.x[1]).toBeCloseTo(0.5, 2);
    // 靠背占的那一条不算坐面
    expect(found.sit!.rect.z[0]).toBeGreaterThan(-0.45);
    expect(found.sit!.rect.z[0]).toBeLessThan(-0.36);
    expect(found.sit!.rect.z[1]).toBeCloseTo(0.5, 2);
    // 椅子不够长：躺不了
    expect(found.lie).toBeUndefined();
    expect(found.top).toBeUndefined();
  });

  it('椅子转了方向：脸跟着转', () => {
    const size: Vec3 = [0.45, 0.9, 0.45];
    expect(autoContacts(boxes(turned(CHAIR, 1)), size, 'seat').sit?.face).toBe(90);
    expect(autoContacts(boxes(turned(CHAIR, 2)), size, 'seat').sit?.face).toBe(180);
    expect(autoContacts(boxes(turned(CHAIR, 3)), size, 'seat').sit?.face).toBe(-90);
  });

  it('凳子：没有靠背，坐最上面，哪边都能坐；圆的认成圆的', () => {
    const stool = autoContacts(
      boxes([
        [-0.2, -0.16, 0, 0.42, -0.2, -0.16],
        [0.16, 0.2, 0, 0.42, 0.16, 0.2],
        [-0.2, 0.2, 0.42, 0.45, -0.2, 0.2],
      ]),
      [0.4, 0.45, 0.4],
      'seat',
    );
    expect(stool.sit?.face).toBeUndefined();
    expect(stool.sit?.round).toBeUndefined();
    expect(stool.sit!.rect).toEqual({ x: [-0.5, 0.5], z: [-0.5, 0.5] });
    const round = autoContacts(cylinder(0.2, 0, 0.45), [0.4, 0.45, 0.4], 'seat');
    expect(round.sit?.round).toBe(true);
    expect(round.lie).toBeUndefined();
  });

  it('长凳：够长，能躺', () => {
    const bench = autoContacts(boxes([[-0.9, 0.9, 0, 0.45, -0.2, 0.2]]), [1.8, 0.45, 0.4], 'seat');
    expect(bench.sit).toBeDefined();
    expect(bench.lie?.turn).toBe(90);
  });

  it('沙发：坐面在靠背前面、两个扶手中间，够长能顺着躺', () => {
    const sofa = autoContacts(
      boxes([
        [-1, 1, 0, 0.42, -0.45, 0.45],
        [-1, 1, 0.42, 0.8, -0.45, -0.2],
        [-1, -0.85, 0.42, 0.6, -0.2, 0.45],
        [0.85, 1, 0.42, 0.6, -0.2, 0.45],
      ]),
      [2, 0.8, 0.9],
      'seat',
    );
    expect(sofa.sit?.face).toBe(0);
    expect(sofa.sit!.rect.x[0]).toBeCloseTo(-0.425, 1);
    expect(sofa.sit!.rect.x[1]).toBeCloseTo(0.425, 1);
    expect(sofa.sit!.rect.z[0]).toBeCloseTo(-0.22, 1);
    expect(sofa.lie?.turn).toBe(90);
    expect(sofa.lie!.rect).toEqual(sofa.sit!.rect);
  });

  it('桌子：最上面那一层是台面（也能坐）', () => {
    const table = autoContacts(
      boxes([
        [-0.55, -0.5, 0, 0.7, -0.35, -0.3],
        [0.5, 0.55, 0, 0.7, 0.3, 0.35],
        [-0.6, 0.6, 0.7, 0.74, -0.4, 0.4],
      ]),
      [1.2, 0.74, 0.8],
      'table',
    );
    expect(table.top!.rect).toEqual({ x: [-0.5, 0.5], z: [-0.5, 0.5] });
    expect(table.top?.round).toBeUndefined();
    expect(table.sit!.rect).toEqual(table.top!.rect);
    expect(autoContacts(cylinder(0.4, 0, 0.7), [0.8, 0.7, 0.8], 'table').top?.round).toBe(true);
    // 桌上带一排架子：台面是架子前面那一大块
    const desk = autoContacts(
      boxes([
        [-0.6, 0.6, 0, 0.74, -0.4, 0.4],
        [-0.6, 0.6, 0.74, 1.2, -0.4, -0.34],
      ]),
      [1.2, 1.2, 0.8],
      'table',
    );
    expect(desk.top!.rect.z[0]).toBeGreaterThan(-0.45);
    expect(desk.top!.rect.z[1]).toBeCloseTo(0.5, 2);
  });

  it('床：床面是面积最大的那一层，头朝床头板，坐在两条长边上', () => {
    const bed: Box[] = [
      [-0.5, 0.5, 0, 0.45, -1, 1],
      [-0.5, 0.5, 0.45, 0.9, -1, -0.92],
    ];
    const found = autoContacts(boxes(bed), [1, 0.9, 2], 'bed');
    expect(found.lie?.turn).toBe(0);
    expect(found.lie!.rect.z[0]).toBeGreaterThan(-0.5);
    expect(found.lie!.rect.z[1]).toBeCloseTo(0.5, 2);
    expect(found.sit?.sides).toEqual([90, -90]);
    // 床头板在另一头
    const flipped = autoContacts(boxes(turned(bed, 2)), [1, 0.9, 2], 'bed');
    expect(flipped.lie?.turn).toBe(180);
    // 没有床头板的垫子：顺着长的那一边躺
    expect(autoContacts(boxes([[-1, 1, 0, 0.2, -0.5, 0.5]]), [2, 0.2, 1], 'bed').lie?.turn).toBe(90);
    // 太短的躺不下，只能坐
    const short = autoContacts(boxes([[-0.4, 0.4, 0, 0.3, -0.4, 0.4]]), [0.8, 0.3, 0.8], 'bed');
    expect(short.lie).toBeUndefined();
    expect(short.sit).toBeDefined();
  });

  it('「其他」、空网格什么都不找', () => {
    expect(autoContacts(boxes(CHAIR), CHAIR_SIZE, 'other')).toEqual({});
    expect(autoContacts({ positions: [], indices: [] }, CHAIR_SIZE, 'seat')).toEqual({});
    expect(autoContacts(boxes(CHAIR), [0.45, 0, 0.45], 'seat')).toEqual({});
  });
});

describe('导入的素材接上一键动作', () => {
  const asset = (group: UserAsset['group'], size: Vec3): UserAsset => ({ id: ID, name: '椅子', group, size, vertices: 8, triangles: 12, bytes: 1, plain: true, added: 1 });

  afterEach(() => {
    dropUserAsset(ID);
    forgetUserAsset(ID);
  });

  it('OBJ 的椅子导进来：分类是「坐的」就有坐面，改成「其他」就没有，文件没读进来也没有', () => {
    const file = buildImport(readImportObj(text(objOf(boxes(CHAIR)))), { id: ID, scale: 1 });
    expect(file.size).toEqual([0.45, 0.9, 0.45]);
    registerUserAsset(asset('seat', file.size));
    const prop = { kind: 'asset' as const, asset: ID, size: file.size };
    // 文件还没读进来
    expect(propContacts(prop)).toEqual({});
    installUserAsset(ID, encodeRealAsset(file).buffer as ArrayBuffer);
    expect(propContacts(prop).sit?.face).toBe(0);
    // 找过一回记着：同一份结果
    expect(propContacts(prop)).toBe(propContacts(prop));
    registerUserAsset(asset('other', file.size));
    expect(propContacts(prop)).toEqual({});
    registerUserAsset(asset('table', file.size));
    // 当成「桌柜」：最上面是靠背那一条，太小，台面落在下面最大的那一层（坐面）
    expect(propContacts(prop).top!.rect.z[0]).toBeGreaterThan(-0.45);
  });

  it('只有形状的素材放下来就是一个颜色的（能挑颜色）', () => {
    registerUserAsset(asset('seat', CHAIR_SIZE));
    expect(makeAssetProp([], ID, { x: 0, z: 0, yaw: 0 })!.gray).toBe(true);
    registerUserAsset({ ...asset('seat', CHAIR_SIZE), plain: undefined });
    expect(makeAssetProp([], ID, { x: 0, z: 0, yaw: 0 })!.gray).toBeUndefined();
  });
});
