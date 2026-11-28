// 带权重融合时，二次元素体挨着的两条大腿之间切开、算完权重再把切口挪回去（见 src/sdf/legSlit.ts）。
import { describe, expect, it } from 'vitest';
import { skinVerticesDualInPlace } from '../src/character/pose';
import { worldTransforms } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type V3, quatEuler, quatMul } from '../src/geometry/vec';
import { type BodySpec, defaultSpec, normalizeSpec } from '../src/model/spec';
import { forward, poseMatrices, restState } from '../src/pose/rig';
import { makeSolver } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { skinVertices } from '../src/rig/skin';
import { fuseSkinned } from '../src/sdf/bindPose';
import { compilePartField, fieldAt } from '../src/sdf/field';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
import { legSlits } from '../src/sdf/legSlit';
import { useAnimeBody } from './animeBody';
import { useGenital } from './genital';

const make = (counts: Partial<BodySpec['counts']>, rest: Partial<BodySpec> = {}): BodySpec => {
  const base = defaultSpec();
  return normalizeSpec({ ...base, ...rest, counts: { ...base.counts, ...counts } });
};
const slitsOf = (spec: BodySpec) => {
  const parts = buildFigure(spec).parts;
  return legSlits(parts, buildSkeleton({ parts, scale: 1 }));
};

/** 人腿人马三副胯，胯挤扁、阴茎调大又挪到大腿中间（他那份存档的样子） */
const squeezed = (): BodySpec =>
  make(
    { legs: 6, penises: 1 },
    {
      bodyStyle: 'anime',
      legLayout: 'humantaur',
      hipLegs: 2,
      scrotum: 'each',
      shape: { ...defaultSpec().shape, penisSize: 1.6 },
      overrides: {
        LowerBody: { position: [0, 0, 0.0253], scale: [0.9, 0.85, 0.55] },
        Leg_02_L: { position: [0, 0, 0.2213], scale: [1.1, 1, 1.05] },
        Leg_02_R: { position: [0, 0, 0.2213], scale: [1.1, 1, 1.05] },
        Leg_03_L: { position: [0, 0, 0.4625], scale: [1.1, 1, 1.05] },
        Leg_03_R: { position: [0, 0, 0.4625], scale: [1.1, 1, 1.05] },
        Penis_03: { position: [0, 0, 0.2594] },
        Scrotum_03: { position: [0, 0, 0.2594] },
      },
    },
  );

describe('哪些身体切', () => {
  it('二次元素体的两条腿之间一刀；白模人台、摆了姿势要重新融合的（几条手臂挤在一个肩膀上、好几个上半身）不切', () => {
    useAnimeBody();
    const one = slitsOf(make({}, { bodyStyle: 'anime' }));
    expect(one.length).toBe(1);
    // 刀面的法向从一条腿指向另一条，竖着切
    expect(Math.abs(one[0].n[0])).toBeGreaterThan(0.95);
    expect(one[0].down[1]).toBeLessThan(-0.95);
    expect(slitsOf(make({}))).toEqual([]);
    expect(slitsOf(make({ armPairs: 2 }, { bodyStyle: 'anime', armLayout: 'fan' }))).toEqual([]);
    expect(slitsOf(make({ torsos: 2 }, { bodyStyle: 'anime' }))).toEqual([]);
  });

  it('人腿人马三副胯各一刀，夹在大腿中间的阴茎根周围不另外挖（以前挖的球在腿张开时成了一道深沟）', () => {
    useAnimeBody();
    useGenital();
    const taur = { bodyStyle: 'anime', legLayout: 'humantaur', hipLegs: 2, scrotum: 'each' } as const;
    expect(slitsOf(make({ legs: 6, penises: 1 }, taur)).length).toBe(3);
    // 胯挤扁、阴茎挪到大腿中间（他那份存档的样子）：还是三刀，都是薄的
    const slits = slitsOf(squeezed());
    expect(slits.length).toBe(3);
    for (const knife of slits) expect(knife.radii[0]).toBeLessThan(0.03);
    // 后两副胯（腿和马身子不是一类）的刀从两个髋关节正中往下 4 厘米才开始：最上面那截两条大腿连着，
    // 腿张开时那里是一片斜坡，不是一道直通到马身子底面的深沟
    const parts = buildFigure(squeezed()).parts;
    const bones = buildSkeleton({ parts, scale: 1 }).bones;
    const head = (part: string) => bones.find((b) => b.part === part && bones[b.parent]?.part !== part)!.head;
    const rear = slits.filter((s) => s.groups.length === 1 && s.groups[0] === 'leg');
    expect(rear.length).toBe(2);
    for (const knife of rear) {
      const [a, b] = knife.legs.map(head);
      const mid = a.map((v, k) => (v + b[k]) / 2);
      const start = knife.center.map((v, k) => v - knife.down[k] * knife.radii[1] - mid[k]);
      expect(start.reduce((sum, v, k) => sum + v * knife.down[k], 0)).toBeCloseTo(0.04, 3);
    }
  });
});

describe('带权重融合', () => {
  it('静止时看着没切过：没有顶点留在腿原来的表面里面；大腿内侧那片皮各跟各的腿，不再跟着胯', () => {
    useAnimeBody();
    // 大腿调粗：两条从裆往下挨着一长段（默认的素体只在裆底下挨着几厘米）
    const spec = make({}, { bodyStyle: 'anime', overrides: { Leg_01_L: { scale: [1.3, 1, 1.15] }, Leg_01_R: { scale: [1.3, 1, 1.15] } } });
    const figure = buildFigure(spec);
    const unit = { parts: figure.parts, scale: 1 };
    const skeleton = buildSkeleton(unit);
    const xfs = worldTransforms(unit);
    const legs = figure.parts.filter((p) => p.type === 'leg').map((p) => ({ name: p.name, field: compilePartField(p, xfs.get(p.name)!) }));
    expect(legs.length).toBe(2);
    const hipY = skeleton.bones.find((b) => /^UpperLeg_L/.test(b.name))!.head[1];
    const hips = skeleton.bones.findIndex((b) => b.name === 'Hips');

    /** 髋关节往下 12 到 30 厘米、离正中不到 3 厘米的那些顶点里，胯占两成以上的有几个；一共几个 */
    const inner = (positions: Float32Array, limit: number, joints: Uint16Array, weights: Float32Array) => {
      let all = 0;
      let held = 0;
      for (let v = 0; v < limit; v++) {
        const down = hipY - positions[v * 3 + 1];
        if (Math.abs(positions[v * 3]) > 0.03 || down < 0.12 || down > 0.3) continue;
        all++;
        let share = 0;
        for (let k = 0; k < 4; k++) if (joints[v * 4 + k] === hips) share += weights[v * 4 + k];
        if (share > 0.2) held++;
      }
      return { all, held };
    };

    // 不切的话（照原样融合、照原样算权重）：两条大腿之间那一道跟着胯
    const plain = fuseParts(figure.parts, { voxel: VOXEL.preview, blend: spec.blend });
    const old = skinVertices(unit, skeleton, plain.positions, plain.triangles);
    const before = inner(plain.positions, plain.bound ? plain.bound.start : plain.positions.length / 3, old.joints, old.weights);
    expect(before.held).toBeGreaterThan(20);

    const { mesh, skin } = fuseSkinned(figure.parts, { voxel: VOXEL.preview, blend: spec.blend });
    expect(mesh.info.components).toBe(1);
    const limit = mesh.bound ? mesh.bound.start : mesh.positions.length / 3;
    const after = inner(mesh.positions, limit, skin.joints, skin.weights);
    expect(after.all).toBeGreaterThan(before.all);
    expect(after.held).toBe(0);

    // 切口都挪回去了：没有顶点在哪条腿原来的表面里面一个体素以上
    let deep = 0;
    for (let v = 0; v < limit; v++) {
      for (const leg of legs) if (fieldAt(leg.field, mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]) < -VOXEL.preview) deep++;
    }
    // 两条腿的皮现在是叠着的：一条腿内侧的皮在另一条腿里面是应该的，可它在自己那条腿的表面上——所以每个顶点至少有一条腿是「不在里面」的
    let buried = 0;
    for (let v = 0; v < limit; v++) {
      const x = mesh.positions[v * 3];
      const y = mesh.positions[v * 3 + 1];
      const z = mesh.positions[v * 3 + 2];
      if (legs.every((leg) => fieldAt(leg.field, x, y, z) < -VOXEL.preview)) buried++;
    }
    expect(buried).toBe(0);
    // 叠着的那一片不大（大腿只是挨着）
    expect(deep).toBeLessThan(limit * 0.05);

  });
});

describe('切口挪回去以后', () => {
  it('人马、阴茎夹在大腿中间：后两副胯的大腿还是完整的（没有顶点同时埋在两条腿里），那片皮和它边上的皮之间，相邻顶点跟腿的份额没有差一半以上的（差得多，腿一张开就是一排锯齿）', () => {
    useAnimeBody();
    useGenital();
    const spec = squeezed();
    const figure = buildFigure(spec);
    const unit = { parts: figure.parts, scale: 1 };
    const skeleton = buildSkeleton(unit);
    const xfs = worldTransforms(unit);
    const legs = figure.parts.filter((p) => /^Leg_0[23]_/.test(p.name)).map((p) => ({ name: p.name, field: compilePartField(p, xfs.get(p.name)!) }));
    expect(legs.length).toBe(4);
    const { mesh, skin } = fuseSkinned(figure.parts, { voxel: VOXEL.preview, blend: spec.blend });
    expect(mesh.info.components).toBe(1);
    const limit = mesh.bound ? mesh.bound.start : mesh.positions.length / 3;
    const depth = (v: number) => legs.map((leg) => fieldAt(leg.field, mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]));
    // 切口挪回去的那片皮：埋在某条腿里面半个体素以上（两张皮叠着的地方）
    const lid = new Uint8Array(limit);
    let lids = 0;
    for (let v = 0; v < limit; v++) {
      if (depth(v).some((d) => d < -0.5 * VOXEL.preview)) {
        lid[v] = 1;
        lids++;
      }
    }
    expect(lids).toBeGreaterThan(100);
    const legBone = skeleton.bones.map((b) => legs.some((leg) => leg.name === b.part));
    const legShare = (v: number) => {
      let sum = 0;
      for (let k = 0; k < 4; k++) if (legBone[skin.joints[v * 4 + k]]) sum += skin.weights[v * 4 + k];
      return sum;
    };
    let steep = 0;
    let edges = 0;
    for (let t = 0; t < mesh.triangles.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = mesh.triangles[t + e];
        const b = mesh.triangles[t + ((e + 1) % 3)];
        if (a >= limit || b >= limit || (!lid[a] && !lid[b])) continue;
        edges++;
        if (Math.abs(legShare(a) - legShare(b)) > 0.5) steep++;
      }
    }
    expect(edges).toBeGreaterThan(800);
    expect(steep).toBe(0);
  });

  it('阴茎夹在两条大腿中间，腿往外张开六十度：根周围没有被扯开的碎片（挪回去的那片皮贴着根，离根近的也跟着胯）', () => {
    useAnimeBody();
    useGenital();
    const spec = squeezed();
    const figure = buildFigure(spec);
    const bones = buildSkeleton({ parts: figure.parts, scale: 1 }).bones;
    const { rig } = makeSolver(bones);
    const thigh = (part: string) => bones.findIndex((b) => b.part === part && bones[b.parent]?.part !== part);
    const legs = [thigh('Leg_03_L'), thigh('Leg_03_R')];
    const spread = (turn: number) => {
      const state = restState(rig);
      legs.forEach((bone, i) => (state.local[bone] = quatEuler(0, 0, i ? -turn : turn)));
      return poseMatrices(rig, forward(rig, state));
    };
    /** 两个膝盖离多远 */
    const apart = (pose: ArrayLike<number>) => {
      const [a, b] = legs.map((bone) => {
        const t = bones[bone].tail;
        const o = bone * 12;
        return [0, 1, 2].map((r) => pose[o + r * 3] * t[0] + pose[o + r * 3 + 1] * t[1] + pose[o + r * 3 + 2] * t[2] + pose[o + 9 + r]);
      });
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    };
    const pose = spread(Math.PI / 3);
    expect(apart(pose)).toBeGreaterThan(apart(spread(0)) + 0.3);

    const { mesh, skin } = fuseSkinned(figure.parts, { voxel: VOXEL.preview, blend: spec.blend });
    const rest = mesh.positions.slice();
    // 静止时就没有特别长的边：贴着根的那几个切口顶点挪回去时要是顺着反了的方向穿过整条腿，
    // 会落到腿的另一面上，静止时被腿挡着，一摆就是一根十几厘米的刺（2026-11-28 修之前有 10 个顶点连着这种边）
    let far = 0;
    for (let t = 0; t < mesh.triangles.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = mesh.triangles[t + e];
        const b = mesh.triangles[t + ((e + 1) % 3)];
        if (Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2]) > 4 * VOXEL.preview) far++;
      }
    }
    expect(far).toBe(0);
    skinVerticesDualInPlace(mesh.positions, mesh.normals, skin.joints, skin.weights, Float64Array.from(pose));
    const root = bones.find((b) => b.part === 'Penis_03' && bones[b.parent]?.part !== 'Penis_03')!.head;
    const edge = (p: Float32Array, a: number, b: number) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
    // 静止时离根不到 8 厘米的三角面：最长那条边拉长了几倍
    let near = 0;
    let torn = 0;
    let ripped = 0;
    const { triangles } = mesh;
    for (let t = 0; t < triangles.length; t += 3) {
      const corners = [triangles[t], triangles[t + 1], triangles[t + 2]];
      if (!corners.some((v) => Math.hypot(rest[v * 3] - root[0], rest[v * 3 + 1] - root[1], rest[v * 3 + 2] - root[2]) < 0.08)) continue;
      near++;
      let most = 0;
      for (let e = 0; e < 3; e++) most = Math.max(most, edge(mesh.positions, corners[e], corners[(e + 1) % 3]) / Math.max(edge(rest, corners[e], corners[(e + 1) % 3]), 1e-6));
      if (most > 3) torn++;
      if (most > 5) ripped++;
    }
    expect(near).toBeGreaterThan(500);
    // 那片皮只跟腿的话（2026-11-28 之前）：拉长三倍以上的 158 个、五倍以上的 68 个，根两边各一圈碎片
    expect(torn).toBeLessThan(40);
    expect(ripped).toBeLessThanOrEqual(3);
  });
});

describe('大腿粗、压着阴茎根和阴囊', () => {
  const thick = { Leg_01_L: { scale: [1.3, 1, 1.15] as V3 }, Leg_01_R: { scale: [1.3, 1, 1.15] as V3 } };
  const withPenis = () => make({ penises: 1 }, { bodyStyle: 'anime', scrotum: 'each', shape: { ...defaultSpec().shape, penisSize: 1.6 }, overrides: thick });

  /**
   * 两条大腿往前（flex 正）或往后抬 flex 弧度、再各往外张开四十五度，摆出来才折过七十度（静止时不到三十度）的边有几条：
   * 只数静止时离 center 不到 reach 的。center 是 'crotch'（两个髋关节正中）或部件名（它最靠根那节骨骼的起点）
   */
  const folds = (spec: BodySpec, flex: number, center: string, reach: number) => {
    const figure = buildFigure(spec);
    const bones = buildSkeleton({ parts: figure.parts, scale: 1 }).bones;
    const { rig } = makeSolver(bones);
    const first = (part: string) => bones.findIndex((b) => b.part === part && bones[b.parent]?.part !== part);
    const legs = ['Leg_01_L', 'Leg_01_R'].map(first);
    const state = restState(rig);
    const spread = Math.PI / 4;
    legs.forEach((bone, i) => (state.local[bone] = quatMul(quatEuler(flex, 0, 0), quatEuler(0, 0, i ? -spread : spread))));
    const pose = poseMatrices(rig, forward(rig, state));
    const { mesh, skin } = fuseSkinned(figure.parts, { voxel: VOXEL.preview, blend: spec.blend });
    const rest = mesh.positions.slice();
    skinVerticesDualInPlace(mesh.positions, mesh.normals, skin.joints, skin.weights, Float64Array.from(pose));
    const at = center === 'crotch' ? [0, bones[legs[0]].head[1], (bones[legs[0]].head[2] + bones[legs[1]].head[2]) / 2] : bones[first(center)].head;
    const T = mesh.triangles;
    const normal = (p: Float32Array, t: number) => {
      const [a, b, c] = [T[t], T[t + 1], T[t + 2]];
      const u = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
      const w = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      return n.map((x) => x / l);
    };
    const faces = new Map<string, number[]>();
    for (let t = 0; t < T.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = T[t + e];
        const b = T[t + ((e + 1) % 3)];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        const list = faces.get(key);
        if (list) list.push(t);
        else faces.set(key, [t]);
      }
    }
    const near = (v: number) => Math.hypot(rest[v * 3] - at[0], rest[v * 3 + 1] - at[1], rest[v * 3 + 2] - at[2]) < reach;
    let count = 0;
    for (const [key, pair] of faces) {
      if (pair.length !== 2) continue;
      const [a, b] = key.split(',').map(Number);
      if (!near(a) && !near(b)) continue;
      const dot = (p: Float32Array) => {
        const m = normal(p, pair[0]);
        const n = normal(p, pair[1]);
        return m[0] * n[0] + m[1] * n[1] + m[2] * n[2];
      };
      if (dot(mesh.positions) < Math.cos((70 * Math.PI) / 180) && dot(rest) > Math.cos((30 * Math.PI) / 180)) count++;
    }
    return count;
  };

  it('阴囊贴着两条大腿内侧：大腿往前抬九十度再张开，阴囊底下没有扯出一扇竖褶（阴囊周围只挖大腿，和没有阴茎的身体差不多）', () => {
    useAnimeBody();
    useGenital();
    const penis = folds(withPenis(), Math.PI / 2, 'crotch', 0.2);
    const without = folds(make({}, { bodyStyle: 'anime', overrides: thick }), Math.PI / 2, 'crotch', 0.2);
    // 阴囊周围不挖的话（2026-11-28 之前）：比没有阴茎的多 50 条，现在多 17 条
    expect(penis).toBeLessThan(without + 30);
  });

  it('大腿往前、往后抬九十度再张开：阴茎根两边没有竖起来的棱（露在外面的皮从钉住到跟腿那一圈够宽，见 GENITAL_PIN.open）', () => {
    useAnimeBody();
    useGenital();
    const spec = withPenis();
    // 根周围 12 厘米内：过渡带和埋在里面的那几层一样窄的话（2026-11-28 之前）往前 33 条、往后 59 条，现在 7 条、23 条
    expect(folds(spec, Math.PI / 2, 'Penis_01', 0.12)).toBeLessThan(15);
    expect(folds(spec, -Math.PI / 2, 'Penis_01', 0.12)).toBeLessThan(35);
  });
});

describe('分部件', () => {
  it('阴茎、阴囊的壳整个跟自己的骨骼：根上不分给带着它的那块身体（不然骨骼一转，壳被撕成两半）', () => {
    useAnimeBody();
    useGenital();
    const spec = make({ legs: 6, penises: 1 }, { bodyStyle: 'anime', legLayout: 'humantaur', hipLegs: 2, scrotum: 'each' });
    const figure = buildFigure(spec);
    const unit = { parts: figure.parts, scale: 1 };
    const skeleton = buildSkeleton(unit);
    const xfs = worldTransforms(unit);
    const meshes = ['Penis_02', 'Scrotum_02', 'Leg_02_L'].map((name) => {
      const part = figure.parts.find((p) => p.name === name)!;
      const xf = xfs.get(name)!;
      const made = fuseParts([{ ...part, parent: undefined, pos: xf.pos, quat: xf.quat, scale: xf.scale }], { voxel: VOXEL.preview, blend: spec.blend });
      return { name, positions: made.positions, normals: made.normals, triangles: made.triangles };
    });
    const total = meshes.reduce((sum, m) => sum + m.positions.length / 3, 0);
    const positions = new Float32Array(total * 3);
    const triangles: number[] = [];
    const starts: number[] = [];
    let first = 0;
    for (const m of meshes) {
      starts.push(first);
      positions.set(m.positions, first * 3);
      for (const i of m.triangles) triangles.push(i + first);
      first += m.positions.length / 3;
    }
    const skin = skinVertices(unit, skeleton, positions, Uint32Array.from(triangles), meshes);
    const ownShare = (m: number) => {
      const count = meshes[m].positions.length / 3;
      let least = 1;
      for (let v = starts[m]; v < starts[m] + count; v++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) if (skeleton.bones[skin.joints[v * 4 + k]].part === meshes[m].name) sum += skin.weights[v * 4 + k];
        least = Math.min(least, sum);
      }
      return least;
    };
    expect(ownShare(0)).toBeGreaterThan(0.999);
    expect(ownShare(1)).toBeGreaterThan(0.999);
    // 腿不是：腿根那一圈照旧跟着胯
    expect(ownShare(2)).toBeLessThan(0.5);
  });
});
