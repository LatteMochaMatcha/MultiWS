import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Part, Prim } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { PRESETS, applyPreset } from '../src/model/presets';
import { type BodyCounts, type BodySpec, LEG_LAYOUTS, defaultSpec } from '../src/model/spec';
import { applyParse, parseDescription } from '../src/parser';
import { castRay, compileField, fieldAt, fieldFromFunction, smin } from '../src/sdf/field';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
import { type FusedMesh, meshField } from '../src/sdf/surfaceNets';
import { PartsModel } from '../src/view/partsModel';
import { useAnimeBody } from './animeBody';

const solo = (prims: Prim[], extra: Partial<Part> = {}): Part => ({
  name: 'Test',
  type: 'torso',
  side: 0,
  pos: [0, 0, 0],
  quat: [0, 0, 0, 1],
  material: 'clay',
  prims,
  ...extra,
});

const fieldOf = (parts: Part[], blend = 0, minRadius = 0) => compileField({ parts, scale: 1 }, { blend, minRadius });

/** 网格的拓扑体检 */
function topology(mesh: FusedMesh) {
  const edges = new Map<number, number>();
  const n = mesh.positions.length / 3;
  // 面：四边形，加上本来就是三角面的那些（缝上去的手）
  const faces: number[][] = [];
  for (let q = 0; q < mesh.quads.length; q += 4) faces.push([...mesh.quads.subarray(q, q + 4)]);
  const tris = mesh.tris ?? new Uint32Array(0);
  for (let t = 0; t < tris.length; t += 3) faces.push([...tris.subarray(t, t + 3)]);
  for (const face of faces) {
    for (let t = 0; t < face.length; t++) {
      // 有向边 a→b 记 +1；它的反向边应该正好在相邻的面里出现一次
      const key = face[t] * n + face[(t + 1) % face.length];
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  let nonManifold = 0;
  let undirected = 0;
  for (const [key, count] of edges) {
    const a = Math.floor(key / n);
    const b = key % n;
    const back = edges.get(b * n + a) ?? 0;
    if (count > 1 || back > 1) nonManifold++;
    else if (back === 0) open++;
    if (a < b || back === 0) undirected++;
  }
  // 捏点：一个顶点周围的面应该围成一圈；如果分成了互不相邻的两簇，就是两片面只靠这一个点连着
  const around: number[][] = Array.from({ length: n }, () => []);
  faces.forEach((face, f) => {
    for (const v of face) around[v].push(f);
  });
  let pinched = 0;
  for (let vtx = 0; vtx < n; vtx++) {
    const near = around[vtx];
    if (near.length < 2) continue;
    // 两个面相邻 = 它们共用一条以这个顶点为端点的边
    const others = (f: number) => {
      const face = faces[f];
      const t = face.indexOf(vtx);
      return [face[(t + 1) % face.length], face[(t + face.length - 1) % face.length]];
    };
    const seen = new Set([near[0]]);
    const stack = [near[0]];
    while (stack.length) {
      const [a, b] = others(stack.pop()!);
      for (const f of near) {
        if (seen.has(f)) continue;
        const [c, d] = others(f);
        if (c === a || c === b || d === a || d === b) {
          seen.add(f);
          stack.push(f);
        }
      }
    }
    if (seen.size !== near.length) pinched++;
  }

  let volume = 0;
  const p = mesh.positions;
  const tri = mesh.triangles;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3;
    const b = tri[t + 1] * 3;
    const c = tri[t + 2] * 3;
    volume +=
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) +
        p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6;
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    min[i % 3] = Math.min(min[i % 3], p[i]);
    max[i % 3] = Math.max(max[i % 3], p[i]);
  }
  return {
    open,
    nonManifold,
    pinched,
    volume,
    min,
    max,
    // 欧拉示性数 V − E + F：一个没有洞的封闭曲面是 2
    euler: n - undirected + faces.length,
  };
}

function expectClosed(mesh: FusedMesh, label = '') {
  const t = topology(mesh);
  expect(t.open, `${label} 有没封上的边`).toBe(0);
  expect(t.nonManifold, `${label} 有非流形边`).toBe(0);
  expect(t.pinched, `${label} 有捏点`).toBe(0);
  expect(mesh.positions.every(Number.isFinite), `${label} 顶点里有非法数字`).toBe(true);
  expect(mesh.normals.every(Number.isFinite), `${label} 法线里有非法数字`).toBe(true);
  expect(mesh.triangles.length).toBe((mesh.quads.length / 4) * 6 + (mesh.tris?.length ?? 0));
  expect(mesh.info.triangles).toBe(mesh.triangles.length / 3);
  return t;
}

describe('smooth-min', () => {
  it('相差超过融合半径时就是普通的 min', () => {
    expect(smin(1, 5, 0.5)).toBe(1);
    expect(smin(5, 1, 0.5)).toBe(1);
    expect(smin(1, 5, 0)).toBe(1);
  });

  it('靠近时比 min 更小（让出圆角），最多小 k/4，并且对称', () => {
    expect(smin(1, 1, 0.4)).toBeCloseTo(0.9, 12);
    expect(smin(1, 1.1, 0.4)).toBeLessThan(1);
    expect(smin(1, 1.1, 0.4)).toBeGreaterThan(0.9);
    expect(smin(1, 1.3, 0.4)).toBe(smin(1.3, 1, 0.4));
  });
});

describe('距离场的基本体', () => {
  it('球：到处都是精确距离', () => {
    const f = fieldOf([solo([{ kind: 'ellipsoid', name: 'S', center: [1, 2, 3], radii: [0.5, 0.5, 0.5] }])]);
    expect(fieldAt(f, 1, 2, 3)).toBeCloseTo(-0.5, 9);
    expect(fieldAt(f, 2, 2, 3)).toBeCloseTo(0.5, 9);
    expect(fieldAt(f, 1, 2.5, 3)).toBeCloseTo(0, 9);
    expect(f.min).toEqual([0.5, 1.5, 2.5]);
    expect(f.max).toEqual([1.5, 2.5, 3.5]);
  });

  it('椭球：表面在各轴的半径处，带旋转时轴跟着转', () => {
    const q = Math.SQRT1_2;
    const f = fieldOf([
      // 绕 Z 转 90°：局部 X（半径 0.3）转到世界 Y
      solo([{ kind: 'ellipsoid', name: 'E', center: [0, 0, 0], radii: [0.3, 0.1, 0.2], quat: [0, 0, q, q] }]),
    ]);
    expect(fieldAt(f, 0, 0.3, 0)).toBeCloseTo(0, 9);
    expect(fieldAt(f, 0.1, 0, 0)).toBeCloseTo(0, 9);
    expect(fieldAt(f, 0, 0, 0.2)).toBeCloseTo(0, 9);
    expect(fieldAt(f, 0.2, 0, 0)).toBeGreaterThan(0);
    expect(fieldAt(f, 0, 0.2, 0)).toBeLessThan(0);
    expect(f.max[0]).toBeCloseTo(0.1, 9);
    expect(f.max[1]).toBeCloseTo(0.3, 9);
  });

  it('圆台：两端是球，中间是锥面', () => {
    const f = fieldOf([solo([{ kind: 'cone', name: 'C', a: [0, 0, 0], b: [0, 1, 0], ra: 0.2, rb: 0.1 }])]);
    expect(fieldAt(f, 0, -0.2, 0)).toBeCloseTo(0, 9);
    expect(fieldAt(f, 0, 1.1, 0)).toBeCloseTo(0, 9);
    expect(fieldAt(f, 0, 0.5, 0)).toBeLessThan(-0.1);
    // 侧面：半径在 0.2 和 0.1 之间
    expect(fieldAt(f, 0.21, 0, 0)).toBeGreaterThan(0);
    expect(fieldAt(f, 0.19, 0.02, 0)).toBeLessThan(0);
    expect(fieldAt(f, 0.16, 0.5, 0)).toBeGreaterThan(0);
    expect(fieldAt(f, 0.14, 0.5, 0)).toBeLessThan(0);
    expect(fieldAt(f, 3, 0, 0)).toBeCloseTo(2.8, 9);
  });

  it('一端的球包住另一端时退化成一个球', () => {
    const f = fieldOf([solo([{ kind: 'cone', name: 'C', a: [0, 0, 0], b: [0, 0.05, 0], ra: 0.2, rb: 0.05 }])]);
    expect(fieldAt(f, 0, 0.2, 0)).toBeCloseTo(0, 9);
    expect(fieldAt(f, 0.5, 0, 0)).toBeCloseTo(0.3, 9);
  });

  it('部件的位置、旋转、缩放都算进去', () => {
    const q = Math.SQRT1_2;
    const f = compileField(
      {
        scale: 2,
        parts: [
          // 绕 Z 转 90°：局部 +X 转到世界 +Y；整体再放大 2 倍
          solo([{ kind: 'ellipsoid', name: 'S', center: [1, 0, 0], radii: [0.1, 0.1, 0.1] }], {
            pos: [0, 0, 0.5],
            quat: [0, 0, q, q],
          }),
        ],
      },
      { blend: 0 },
    );
    expect(fieldAt(f, 0, 2, 1)).toBeCloseTo(-0.2, 9);
    expect(fieldAt(f, 0, 2.2, 1)).toBeCloseTo(0, 9);
  });

  it('眼睛不参与融合', () => {
    const f = fieldOf([
      solo([{ kind: 'ellipsoid', name: 'S', center: [0, 0, 0], radii: [0.1, 0.1, 0.1] }]),
      solo([{ kind: 'ellipsoid', name: 'Eye', center: [5, 0, 0], radii: [0.1, 0.1, 0.1] }], {
        name: 'Eye',
        type: 'eye',
        material: 'eye',
      }),
    ]);
    expect(f.count).toBe(1);
    expect(fieldAt(f, 5, 0, 0)).toBeGreaterThan(4);
  });

  it('同类部件直接并在一起，不同类之间有圆角', () => {
    const a: Prim = { kind: 'ellipsoid', name: 'A', center: [-0.1, 0, 0], radii: [0.15, 0.15, 0.15] };
    const b: Prim = { kind: 'ellipsoid', name: 'B', center: [0.1, 0, 0], radii: [0.15, 0.15, 0.15] };
    // 两个球的交线上方一点：硬并集时在外面，融合后被圆角填上
    const same = fieldOf([solo([a]), solo([b], { name: 'T2' })], 0.05);
    const mixed = fieldOf([solo([a]), solo([b], { name: 'Arm', type: 'arm' })], 0.05);
    const y = Math.sqrt(0.15 ** 2 - 0.1 ** 2) + 0.005;
    expect(fieldAt(same, 0, y, 0)).toBeGreaterThan(0);
    expect(fieldAt(mixed, 0, y, 0)).toBeLessThan(0);
    // 离交界远的地方两者一样
    expect(fieldAt(mixed, -0.25, 0, 0)).toBeCloseTo(fieldAt(same, -0.25, 0, 0), 9);
  });

  it('只在根部圆滑：两条同类的手臂在根部融成一片，伸出去以后还是硬接', () => {
    // 两根从同一个地方伸出去、张开一个小角度的圆棍
    const rod = (dy: number, fuse: boolean): Part =>
      solo(
        [{ kind: 'cone', name: 'Rod', a: [0, 0, 0], b: [0.5, dy, 0], ra: 0.04, rb: 0.04, ...(fuse ? { soft: 0.03, fade: [0.1, 0.2] as [number, number] } : {}) }],
        { name: `Rod${dy}`, type: 'arm' },
      );
    const hard = fieldOf([rod(0.1, false), rod(-0.1, false)]);
    const fused = fieldOf([rod(0.1, true), rod(-0.1, true)]);
    // 两根棍子中间那道缝的上方一点，离根部 9 cm：硬接时在外面，融合以后被圆角填上了
    expect(fieldAt(hard, 0.08, 0, 0.0385)).toBeGreaterThan(0);
    expect(fieldAt(fused, 0.08, 0, 0.0385)).toBeLessThan(-0.004);
    // 离根部 15 cm：圆角只剩一半大，填得少了
    const half = fieldAt(hard, 0.15, 0, 0.035) - fieldAt(fused, 0.15, 0, 0.035);
    expect(half).toBeGreaterThan(0.002);
    expect(half).toBeLessThan(0.006);
    // 离根部 30 cm：出了范围，和硬接一模一样
    expect(fieldAt(fused, 0.3, 0, 0.03)).toBe(fieldAt(hard, 0.3, 0, 0.03));
    expect(fieldAt(fused, 0.3, 0.03, 0.03)).toBe(fieldAt(hard, 0.3, 0.03, 0.03));
    // 部件挪了地方、缩放了，范围跟着走：还是以它自己的关节为中心
    const moved = (fuse: boolean) =>
      fieldOf([rod(0.1, fuse), rod(-0.1, fuse)].map((p) => ({ ...p, pos: [1, 2, 3] as [number, number, number], scale: 2 })));
    expect(fieldAt(moved(true), 1 + 0.16, 2, 3 + 0.077)).toBeLessThan(fieldAt(moved(false), 1 + 0.16, 2, 3 + 0.077) - 0.008);
    expect(fieldAt(moved(true), 1 + 0.6, 2, 3 + 0.06)).toBe(fieldAt(moved(false), 1 + 0.6, 2, 3 + 0.06));
  });

  it('太细的管按最小半径兜底', () => {
    const thin: Prim = { kind: 'cone', name: 'C', a: [0, 0, 0], b: [0, 1, 0], ra: 0.001, rb: 0.001 };
    expect(fieldAt(fieldOf([solo([thin])]), 0.005, 0.5, 0)).toBeGreaterThan(0);
    expect(fieldAt(fieldOf([solo([thin])], 0, 0.01), 0.005, 0.5, 0)).toBeLessThan(0);
  });
});

describe('Surface Nets', () => {
  const sphere = (r: number) => fieldOf([solo([{ kind: 'ellipsoid', name: 'S', center: [0.1, 0.2, 0.3], radii: [r, r, r] }])]);

  it('球：封闭、朝外、顶点都贴着球面，体积对得上', () => {
    const mesh = meshField(sphere(0.3), 0.02);
    const t = expectClosed(mesh, '球');
    expect(t.euler).toBe(2);
    expect(mesh.info.components).toBe(1);
    expect(mesh.info.cavities).toBe(0);
    const exact = (4 / 3) * Math.PI * 0.3 ** 3;
    expect(t.volume).toBeGreaterThan(exact * 0.97);
    expect(t.volume).toBeLessThan(exact * 1.01);
    const p = mesh.positions;
    const nrm = mesh.normals;
    for (let i = 0; i < p.length; i += 3) {
      const dx = p[i] - 0.1;
      const dy = p[i + 1] - 0.2;
      const dz = p[i + 2] - 0.3;
      const r = Math.hypot(dx, dy, dz);
      expect(Math.abs(r - 0.3)).toBeLessThan(0.006);
      // 法线朝外
      expect((dx * nrm[i] + dy * nrm[i + 1] + dz * nrm[i + 2]) / r).toBeGreaterThan(0.95);
    }
  });

  it('体素越小，网格越细', () => {
    const coarse = meshField(sphere(0.3), 0.04);
    const fine = meshField(sphere(0.3), 0.01);
    expect(fine.info.quads).toBeGreaterThan(coarse.info.quads * 10);
    expectClosed(coarse);
    expectClosed(fine);
  });

  it('两个不相连的球是两块', () => {
    const two = fieldOf([
      solo([
        { kind: 'ellipsoid', name: 'A', center: [0, 0, 0], radii: [0.2, 0.2, 0.2] },
        { kind: 'ellipsoid', name: 'B', center: [1, 0, 0], radii: [0.2, 0.2, 0.2] },
      ]),
    ]);
    const mesh = meshField(two, 0.02);
    expect(mesh.info.components).toBe(2);
    expectClosed(mesh);
  });

  it('封在里面的空腔会被去掉，只留外面那层皮', () => {
    // 一个空心球壳：外半径 0.35，内半径 0.25
    const shell = fieldFromFunction((x, y, z) => Math.abs(Math.hypot(x, y, z) - 0.3) - 0.05, [-0.35, -0.35, -0.35], [0.35, 0.35, 0.35]);
    const mesh = meshField(shell, 0.02);
    const t = expectClosed(mesh, '球壳');
    expect(mesh.info.components).toBe(1);
    expect(mesh.info.cavities).toBe(1);
    expect(t.euler).toBe(2);
    const solid = (4 / 3) * Math.PI * 0.35 ** 3;
    expect(t.volume).toBeGreaterThan(solid * 0.97);
    expect(t.volume).toBeLessThan(solid * 1.01);
  });

  it('比体素还小的碎屑会被去掉', () => {
    const f = fieldOf([
      solo([
        { kind: 'ellipsoid', name: 'A', center: [0, 0, 0], radii: [0.2, 0.2, 0.2] },
        { kind: 'ellipsoid', name: 'Dust', center: [1, 0.003, 0.004], radii: [0.018, 0.018, 0.018] },
      ]),
    ]);
    const mesh = meshField(f, 0.02);
    expect(mesh.info.components).toBe(1);
    expect(mesh.info.specks).toBe(1);
    expect(topology(mesh).max[0]).toBeLessThan(0.3);
  });

  it('两个相交的球融合成一块，交界处有圆角', () => {
    const parts = [
      solo([{ kind: 'ellipsoid', name: 'A', center: [-0.15, 0, 0], radii: [0.2, 0.2, 0.2] }]),
      solo([{ kind: 'ellipsoid', name: 'B', center: [0.15, 0, 0], radii: [0.2, 0.2, 0.2] }], { name: 'Arm', type: 'arm' }),
    ];
    const hard = meshField(fieldOf(parts, 0), 0.01);
    const soft = meshField(fieldOf(parts, 0.06), 0.01);
    expect(expectClosed(hard).euler).toBe(2);
    const t = expectClosed(soft);
    expect(t.euler).toBe(2);
    expect(soft.info.components).toBe(1);
    expect(t.volume).toBeGreaterThan(topology(hard).volume);
  });
});

/* ---------------- 整个角色 ---------------- */

const withCounts = (counts: Partial<BodyCounts>, rest: Partial<BodySpec> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, ...rest, counts: { ...base.counts, ...counts } };
};
const fromText = (text: string) => applyParse(defaultSpec(), parseDescription(text));
const fuse = (spec: BodySpec, voxel: number = VOXEL.preview) =>
  fuseParts(buildFigure(spec).parts, { voxel, blend: spec.blend });

describe('融合整个角色', () => {
  it('标准人形：一整块封闭网格，脚踩地面，体积像个人', () => {
    const mesh = fuse(defaultSpec());
    const t = expectClosed(mesh, '标准人形');
    expect(mesh.info.components).toBe(1);
    expect(t.min[1]).toBeGreaterThan(-0.02);
    expect(t.min[1]).toBeLessThan(0.02);
    // 这是按 1.76 m 人台算的；头顶在 1.76 上下
    expect(t.max[1]).toBeGreaterThan(1.7);
    expect(t.max[1]).toBeLessThan(1.82);
    expect(t.max[0]).toBeCloseTo(-t.min[0], 1);
    expect(t.volume).toBeGreaterThan(0.035);
    expect(t.volume).toBeLessThan(0.09);
  });

  it('验收用例「两个头，两对手，两对胸」：一整块封闭网格', () => {
    for (const voxel of [VOXEL.draft, VOXEL.preview, VOXEL.fine]) {
      const mesh = fuse(fromText('两个头，两对手，两对胸'), voxel);
      expectClosed(mesh, `体素 ${voxel}`);
      expect(mesh.info.components, `体素 ${voxel}`).toBe(1);
    }
  });

  it('多个头凑成一簇（头和头互相压着）：两到五个头，三档精度下都是一整块封闭网格', () => {
    for (const heads of [2, 3, 4, 5]) {
      for (const voxel of [VOXEL.draft, VOXEL.preview, VOXEL.fine]) {
        const mesh = fuse(withCounts({ heads }), voxel);
        expectClosed(mesh, `${heads} 个头 体素 ${voxel}`);
        expect(mesh.info.components, `${heads} 个头 体素 ${voxel}`).toBe(1);
      }
    }
  });

  it('二次元素体多个头：两到五个头，三档精度下都是一整块封闭网格', () => {
    useAnimeBody();
    for (const heads of [2, 3, 4, 5]) {
      for (const voxel of [VOXEL.draft, VOXEL.preview, VOXEL.fine]) {
        const mesh = fuse(withCounts({ heads }, { bodyStyle: 'anime' }), voxel);
        expectClosed(mesh, `素体 ${heads} 个头 体素 ${voxel}`);
        expect(mesh.info.components, `素体 ${heads} 个头 体素 ${voxel}`).toBe(1);
      }
    }
  }, 60_000);

  it('一个头几张脸：两到五张脸，白模人台和二次元素体在三档精度下都是一整块封闭网格', () => {
    useAnimeBody();
    for (const bodyStyle of ['mannequin', 'anime'] as const) {
      for (const heads of [2, 3, 4, 5]) {
        for (const voxel of [VOXEL.draft, VOXEL.preview, VOXEL.fine]) {
          const label = `${bodyStyle} ${heads} 张脸 体素 ${voxel}`;
          const mesh = fuse(withCounts({ heads, hornsPerHead: 2, earPairsPerHead: 1 }, { bodyStyle, headLayout: 'faces' }), voxel);
          expectClosed(mesh, label);
          expect(mesh.info.components, label).toBe(1);
        }
      }
    }
  }, 120_000);

  it('三张脸的头比一张脸的宽：两边的脸露在外面', () => {
    const width = (spec: BodySpec) => {
      const figure = buildFigure(spec);
      const mesh = fuseParts(figure.parts, { voxel: VOXEL.preview, blend: spec.blend });
      // 脖子以上（头顶往下一个头高以内）最宽到哪
      let top = -Infinity;
      for (let i = 1; i < mesh.positions.length; i += 3) top = Math.max(top, mesh.positions[i]);
      let wide = 0;
      for (let i = 0; i < mesh.positions.length; i += 3) if (mesh.positions[i + 1] > top - 0.2) wide = Math.max(wide, Math.abs(mesh.positions[i]));
      return wide;
    };
    const one = width(withCounts({}));
    const three = width(withCounts({ heads: 3 }, { headLayout: 'faces' }));
    expect(three).toBeGreaterThan(one + 0.03);
    // 前后两张脸不往两边宽
    expect(width(withCounts({ heads: 2 }, { headLayout: 'faces' }))).toBeCloseTo(one, 2);
  });

  it('多个头带角和耳朵：四种耳朵在预览和导出精度下都是一整块封闭网格', () => {
    for (const earShape of ['cat', 'fox', 'rabbit', 'elf'] as const) {
      for (const heads of [3, 4]) {
        for (const voxel of [VOXEL.preview, VOXEL.fine]) {
          const mesh = fuse(withCounts({ heads, earPairsPerHead: 1, hornsPerHead: 2 }, { earShape }), voxel);
          expectClosed(mesh, `${heads} 个头 ${earShape} 体素 ${voxel}`);
          expect(mesh.info.components, `${heads} 个头 ${earShape} 体素 ${voxel}`).toBe(1);
        }
      }
    }
  }, 60_000);

  it('四个头带一对角，导出精度：相邻小块在共用的格点上算出一样的值，接缝上不漏面', () => {
    // 最外面的头转了 45°，下颌的表面正好擦着一层格点；隔壁那个头的下颌离得稍远，
    // 以前有的小块没把它算进去，两边的值一正一负，接缝上就漏了两条边
    const mesh = fuse(withCounts({ heads: 4, hornsPerHead: 2 }), VOXEL.fine);
    expectClosed(mesh, '四个头带角');
    expect(mesh.info.components).toBe(1);
  }, 30_000);

  it.each(['阿修罗', '半人马', '蜘蛛女', '九尾 六翼'])('验收用例「%s」：一整块封闭网格', (text) => {
    const mesh = fuse(fromText(text));
    expectClosed(mesh, text);
    expect(mesh.info.components, text).toBe(1);
  });

  it.each(PRESETS.map((p) => [p.name, p] as const))('预设「%s」在预览和导出精度下都是一整块封闭网格', (name, preset) => {
    const spec = applyPreset(defaultSpec(), preset);
    for (const voxel of [VOXEL.preview, VOXEL.fine]) {
      const mesh = fuse(spec, voxel);
      expectClosed(mesh, `${name} 体素 ${voxel}`);
      expect(mesh.info.components, `${name} 体素 ${voxel}`).toBe(1);
    }
  });

  it('每种多腿排法、四种耳朵都是一整块封闭网格', () => {
    for (const legLayout of LEG_LAYOUTS) {
      for (const legs of [1, 3, 4, 8]) {
        const mesh = fuse(withCounts({ legs, tails: 2 }, { legLayout }));
        expectClosed(mesh, `${legLayout} ${legs}`);
        expect(mesh.info.components, `${legLayout} ${legs}`).toBe(1);
      }
    }
    // 人腿人马每副胯好几条腿：前三后三、前三后二、每副四条
    for (const [legs, hipLegs] of [[6, 3], [5, 3], [8, 4], [2, 1]] as const) {
      const mesh = fuse(withCounts({ legs, tails: 1 }, { legLayout: 'humantaur', hipLegs }));
      expectClosed(mesh, `humantaur ${legs} / ${hipLegs}`);
      expect(mesh.info.components, `humantaur ${legs} / ${hipLegs}`).toBe(1);
    }
    for (const earShape of ['cat', 'fox', 'rabbit', 'elf'] as const) {
      const mesh = fuse(withCounts({ earPairsPerHead: 2, hornsPerHead: 3 }, { earShape }));
      expectClosed(mesh, earShape);
      expect(mesh.info.components, earShape).toBe(1);
    }
  });

  it('人腿人马：白模人台和二次元素体，两到四对腿，三档精度下都是一整块封闭网格', () => {
    useAnimeBody();
    for (const bodyStyle of ['mannequin', 'anime'] as const) {
      for (const legs of [4, 6, 8]) {
        for (const voxel of [VOXEL.draft, VOXEL.preview, VOXEL.fine]) {
          // 最密的一档只查两对腿的：三四对腿的网格太大，查一遍要好几秒
          if (voxel === VOXEL.fine && legs > 4) continue;
          const label = `${bodyStyle} ${legs} 条腿 体素 ${voxel}`;
          const mesh = fuse(withCounts({ legs, tails: 1 }, { bodyStyle, legLayout: 'humantaur' }), voxel);
          expectClosed(mesh, label);
          expect(mesh.info.components, label).toBe(1);
        }
      }
    }
  }, 120_000);

  it('人腿人马的身后多出一截：比两条腿时往后长了四十多厘米，宽和高都没变', () => {
    const box = (spec: BodySpec) => {
      const mesh = fuse(spec);
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < mesh.positions.length; i++) {
        lo[i % 3] = Math.min(lo[i % 3], mesh.positions[i]);
        hi[i % 3] = Math.max(hi[i % 3], mesh.positions[i]);
      }
      return { lo, hi };
    };
    const one = box(withCounts({}));
    const taur = box(withCounts({ legs: 4 }, { legLayout: 'humantaur' }));
    expect(one.lo[2] - taur.lo[2]).toBeGreaterThan(0.4);
    expect(one.lo[2] - taur.lo[2]).toBeLessThan(0.6);
    expect(taur.hi[1]).toBeCloseTo(one.hi[1], 2);
    expect(taur.hi[0]).toBeCloseTo(one.hi[0], 2);
    expect(taur.lo[1]).toBeCloseTo(one.lo[1], 2);
  });

  it('分指的手：预览和导出精度下都是一整块封闭网格；导出精度下顶点更多（手指分得开）', () => {
    const spec: BodySpec = { ...defaultSpec(), hands: 'fingers' };
    const preview = fuse(spec, VOXEL.preview);
    const fine = fuse(spec, VOXEL.fine);
    for (const [label, mesh] of [['预览', preview], ['导出', fine]] as const) {
      expectClosed(mesh, label);
      expect(mesh.info.components, label).toBe(1);
    }
    expect(fine.info.quads).toBeGreaterThan(preview.info.quads * 3);
  });

  it('眼窝是凹进去的：眼睛位置的表面比旁边的脸颊靠里', () => {
    const figure = buildFigure(defaultSpec());
    const head = figure.parts.find((p) => p.name === 'Head_01')!;
    const eye = figure.parts.find((p) => p.name === 'Head_01_Eye_01_L')!;
    const local = { ...head, parent: undefined, pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number], scale: 1 };
    const withSockets = compileField({ scale: 1, parts: [local] }, { blend: 0 });
    const without = compileField(
      { scale: 1, parts: [{ ...local, prims: local.prims.filter((p) => !('cut' in p && p.cut)) }] },
      { blend: 0 },
    );
    const [x, y] = eye.pos;
    // 沿 +Z 往脸上打一条线，看表面在哪
    const surface = (f: typeof withSockets) => 0.3 - castRay(f, [x, y, 0.3], [0, 0, -1], 0.6);
    expect(surface(without) - surface(withSockets)).toBeGreaterThan(0.003);
    expect(surface(without) - surface(withSockets)).toBeLessThan(0.012);
  });

  it('男性体型、T-pose 以及两者叠加，都是一整块封闭网格', () => {
    const base = withCounts({ armPairs: 2, tails: 1, earPairsPerHead: 1 });
    for (const gender of ['female', 'male'] as const) {
      for (const pose of ['A', 'T'] as const) {
        for (const armLayout of ['stack', 'fan'] as const) {
          const mesh = fuse({ ...base, gender, pose, armLayout });
          expectClosed(mesh, `${gender} ${pose} ${armLayout}`);
          expect(mesh.info.components, `${gender} ${pose} ${armLayout}`).toBe(1);
        }
      }
    }
  });

  it('T-pose 的网格比 A-pose 宽：指尖到指尖接近身高', () => {
    const a = topology(fuse(defaultSpec()));
    const t = topology(fuse({ ...defaultSpec(), pose: 'T' }));
    const span = t.max[0] - t.min[0];
    expect(span).toBeGreaterThan(a.max[0] - a.min[0] + 0.2);
    expect(span).toBeGreaterThan(1.6);
    expect(span).toBeLessThan(1.9);
  });

  it('所有部件拉满也是一整块封闭网格', () => {
    const mesh = fuse(
      withCounts({
        heads: 5,
        armPairs: 4,
        breasts: 8,
        legs: 8,
        tails: 9,
        wingPairs: 3,
        hornsPerHead: 4,
        eyesPerHead: 6,
        earPairsPerHead: 2,
      }),
    );
    expectClosed(mesh, '拉满');
    expect(mesh.info.components).toBe(1);
  });

  it('融合半径为 0 也能出封闭网格；半径越大体积越大', () => {
    const base = defaultSpec();
    const hard = fuse({ ...base, blend: 0 });
    const soft = fuse({ ...base, blend: 0.04 });
    expectClosed(hard);
    expectClosed(soft);
    expect(topology(soft).volume).toBeGreaterThan(topology(hard).volume);
  });

  it('融合网格和分部件的外形对得上：包围盒差不到两三厘米', () => {
    const spec = withCounts({ tails: 1, wingPairs: 1, hornsPerHead: 2, earPairsPerHead: 1 });
    const figure = buildFigure(spec);
    const t = topology(fuse(spec));
    const model = new PartsModel();
    model.update({ ...figure, scale: 1 });
    // 逐顶点量出来的精确包围盒（默认那个对转过角度的部件偏大）
    const box = new Box3().setFromObject(model.root, true);
    const min = box.min.toArray();
    const max = box.max.toArray();
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(t.min[k] - min[k]), `轴 ${k} 的下界`).toBeLessThan(0.03);
      expect(Math.abs(t.max[k] - max[k]), `轴 ${k} 的上界`).toBeLessThan(0.03);
    }
  });
});

/* ---------------- 手动微调 ---------------- */

describe('手动微调以后的融合网格', () => {
  /** 各种部件、位置 / 角度 / 大小都动一动 */
  const tweaked: BodySpec = {
    ...withCounts({ heads: 2, armPairs: 2, tails: 2, wingPairs: 1, hornsPerHead: 2, earPairsPerHead: 1 }),
    overrides: {
      Torso: { rotation: [6, 0, 0], scale: [1.05, 1.1, 1] },
      Arm_01_L: { rotation: [0, 0, 35], scale: [1, 1.3, 1] },
      Arm_01_R: { rotation: [0, 0, -35], scale: [1, 1.3, 1] },
      Arm_02_L: { position: [0.02, -0.03, 0.02], scale: [0.85, 0.85, 0.85] },
      Head_01: { position: [-0.03, 0.05, 0], rotation: [10, -15, 0], scale: [1.15, 1, 1.1] },
      Head_01_Eye_01_L: { position: [0.003, 0.006, 0], scale: [1.3, 1.3, 1.3] },
      Head_02_Horn_01_L: { scale: [1, 1.6, 1] },
      Head_02_Ear_01_R: { rotation: [0, 0, -20], scale: [1.2, 1.4, 1] },
      Neck_02: { scale: [1.2, 1, 1.2] },
      Chest_01_L: { scale: [1.2, 1.1, 1.3] },
      Wing_01_L: { rotation: [0, 0, 20], scale: [1.2, 0.9, 1] },
      Leg_01_L: { rotation: [0, 0, 8], scale: [1.1, 1, 1.1] },
      Tail_01: { rotation: [0, 30, 0], scale: [1.3, 1.3, 1.3] },
      Tail_02: { position: [0, 0.03, 0], scale: [1, 1, 1.4] },
    },
  };

  it('各种部件都动过以后，预览和导出精度下仍然是一整块封闭网格', () => {
    for (const voxel of [VOXEL.draft, VOXEL.preview, VOXEL.fine]) {
      const mesh = fuse(tweaked, voxel);
      expectClosed(mesh, `体素 ${voxel}`);
      expect(mesh.info.components, `体素 ${voxel}`).toBe(1);
    }
  }, 30_000);

  it('融合网格和分部件的外形仍然对得上', () => {
    const figure = buildFigure(tweaked);
    const t = topology(fuse(tweaked));
    const model = new PartsModel();
    model.update({ ...figure, scale: 1 });
    const box = new Box3().setFromObject(model.root, true);
    const min = box.min.toArray();
    const max = box.max.toArray();
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(t.min[k] - min[k]), `轴 ${k} 的下界`).toBeLessThan(0.03);
      expect(Math.abs(t.max[k] - max[k]), `轴 ${k} 的上界`).toBeLessThan(0.03);
    }
  });

  it('把头抬高、挪到一边，脖子跟着伸过去，头没有和身体脱开', () => {
    const top = topology(fuse(defaultSpec())).max[1];
    for (const position of [[0.04, 0.08, 0.02], [0, 0.25, 0], [0.2, 0.1, -0.05], [0, -0.1, 0.05]] as const) {
      const spec: BodySpec = { ...defaultSpec(), overrides: { Head_01: { position: [...position] } } };
      const mesh = fuse(spec);
      expectClosed(mesh, `${position}`);
      expect(mesh.info.components, `${position}`).toBe(1);
      expect(topology(mesh).max[1], `${position}`).toBeCloseTo(top + position[1], 1);
    }
  });

  it('手臂加长 1.5 倍：指尖更远，上臂没有变粗', () => {
    const base: BodySpec = { ...defaultSpec(), pose: 'T' };
    const long: BodySpec = { ...base, overrides: { Arm_01_L: { scale: [1, 1.5, 1] }, Arm_01_R: { scale: [1, 1.5, 1] } } };
    const a = topology(fuse(base));
    const b = topology(fuse(long));
    // T-pose 的手臂从肩到手腕长约 0.53，加长一半就是每边多出 0.26；手不跟着拉长（只等比大一点），指尖再多出两三厘米。
    // 手要是也拉成 1.5 倍长，指尖会多出 0.34 以上
    expect(b.max[0] - a.max[0]).toBeGreaterThan(0.26);
    expect(b.max[0] - a.max[0]).toBeLessThan(0.32);
    // 上臂中段的粗细：沿手臂取一个点，量它上下的厚度
    const thickness = (spec: BodySpec, x: number) => {
      const figure = buildFigure(spec);
      // 躯干在原点、没有转动，手臂相对躯干的位置就是它在世界里的位置
      const arm: Part = { ...figure.parts.find((p) => p.name === 'Arm_01_L')!, parent: undefined };
      const field = compileField({ parts: [arm], scale: 1 }, { blend: 0 });
      const [px, py, pz] = arm.pos;
      const up = castRay(field, [px + x, py + 0.3, pz], [0, -1, 0], 0.6);
      const down = castRay(field, [px + x, py - 0.3, pz], [0, 1, 0], 0.6);
      return 0.6 - up - down;
    };
    expect(thickness(long, 0.2)).toBeCloseTo(thickness(base, 0.2 / 1.5), 2);
    expect(thickness(base, 0.14)).toBeGreaterThan(0.06);
  });

  it('微调只影响动过的部件：别处的表面一点没变', () => {
    const base = withCounts({ tails: 1 });
    const figure0 = buildFigure(base);
    const figure1 = buildFigure({ ...base, overrides: { Tail_01: { rotation: [0, 35, 0] } } });
    const f0 = compileField({ parts: figure0.parts, scale: 1 }, { blend: base.blend });
    const f1 = compileField({ parts: figure1.parts, scale: 1 }, { blend: base.blend });
    // 头、胸口、手、脚附近
    for (const p of [[0, 1.7, 0.05], [0.07, 1.28, 0.12], [0.5, 0.9, 0.1], [0.09, 0.03, 0.1]] as const) {
      expect(fieldAt(f1, p[0], p[1], p[2])).toBeCloseTo(fieldAt(f0, p[0], p[1], p[2]), 12);
    }
    // 尾巴原来所在的地方现在是空的
    const tail = figure0.parts.find((p) => p.name === 'Tail_01')!;
    const tube = tail.prims[0];
    if (tube.kind !== 'tube') throw new Error('尾巴应该是一根管');
    const tip = tube.points[tube.points.length - 1];
    const at = [tail.pos[0] + tip[0], tail.pos[1] + tip[1], tail.pos[2] + tip[2]] as const;
    expect(fieldAt(f0, at[0], at[1], at[2])).toBeLessThan(0);
    expect(fieldAt(f1, at[0], at[1], at[2])).toBeGreaterThan(0.05);
  });
});
