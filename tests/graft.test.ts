// 手：白模人台（分指）和二次元素体的手是现成的网格，不过距离场，融合完以后在手腕处缝到身体上（src/sdf/graft.ts）。
import { describe, expect, it } from 'vitest';
import { FOOT_ANKLE, FOOT_SOLE, FOOT_TOE, FOOT_TOE_END, footMesh } from '../src/anime/foot';
import { graftMeshOf } from '../src/anime/grafts';
import { FINGER_JOINTS, HAND_CUFF, HAND_LENGTH, HAND_WRIST, handMesh } from '../src/anime/hand';
import { type Figure, type Part, worldTransforms } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { buildPartGeometry, triangleCount } from '../src/geometry/partsMesh';
import { rotate } from '../src/geometry/vec';
import { writeObj } from '../src/io/meshFiles';
import { type BodySpec, defaultSpec } from '../src/model/spec';
import { buildSkeleton } from '../src/rig/skeleton';
import { bindGrafts, skinVertices } from '../src/rig/skin';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
import { graftPoints } from '../src/sdf/graft';
import type { FusedMesh } from '../src/sdf/surfaceNets';
import { useAnimeBody } from './animeBody';

useAnimeBody();

const make = (rest: Partial<BodySpec> = {}, counts: Partial<BodySpec['counts']> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, hands: 'fingers', ...rest, counts: { ...base.counts, ...counts } };
};
const fuse = (figure: Pick<Figure, 'parts'>, voxel: number = VOXEL.preview) => fuseParts(figure.parts, { voxel, blend: 0.02 });
/** 一个 Figure 上接的现成网格（手；二次元素体还有脚）一共有多少个顶点、多少个面、切口一共多少个点 */
const sewn = (figure: Pick<Figure, 'parts'>) => {
  const meshes = figure.parts.flatMap((p) => p.grafts ?? []).map((graft) => graftMeshOf(graft.mesh));
  const sum = (f: (m: (typeof meshes)[number]) => number) => meshes.reduce((total, m) => total + f(m), 0);
  return { vertices: sum((m) => m.positions.length / 3), triangles: sum((m) => m.triangles.length / 3), loop: sum((m) => m.loop.length), count: meshes.length };
};
const part = (figure: Figure, name: string): Part => {
  const found = figure.parts.find((p) => p.name === name);
  if (!found) throw new Error(`没有部件 ${name}`);
  return found;
};

/** 所有的面（四边形和三角形）：有几条没封上的边、几条被用了不止两次的边 */
function edges(mesh: FusedMesh) {
  const n = mesh.positions.length / 3;
  const seen = new Map<number, number>();
  for (const [faces, size] of [[mesh.quads, 4], [mesh.tris ?? new Uint32Array(0), 3]] as const) {
    for (let f = 0; f < faces.length; f += size) {
      for (let k = 0; k < size; k++) {
        const key = faces[f + k] * n + faces[f + ((k + 1) % size)];
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
  }
  let open = 0;
  let crowded = 0;
  for (const [key, count] of seen) {
    if (count > 1) crowded++;
    else if (!seen.has((key % n) * n + Math.floor(key / n))) open++;
  }
  return { open, crowded };
}
/** 网格分成几块互不相连的 */
function pieces(mesh: FusedMesh) {
  const n = mesh.positions.length / 3;
  const group = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (group[i] !== i) i = group[i] = group[group[i]];
    return i;
  };
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    group[find(mesh.triangles[t])] = find(mesh.triangles[t + 1]);
    group[find(mesh.triangles[t + 1])] = find(mesh.triangles[t + 2]);
  }
  const roots = new Set<number>();
  for (let i = 0; i < n; i++) roots.add(find(i));
  return roots.size;
}

describe('现成的手的网格', () => {
  const hand = handMesh();
  const count = hand.positions.length / 3;

  it('一只左手：除了手腕那一圈切口都是封好的，每个顶点都有面用到', () => {
    expect(count).toBeGreaterThan(1500);
    expect(hand.normals).toHaveLength(count * 3);
    expect(hand.joints).toHaveLength(count * 4);
    const seen = new Map<number, number>();
    const used = new Uint8Array(count);
    for (let t = 0; t < hand.triangles.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = hand.triangles[t + k];
        const b = hand.triangles[t + ((k + 1) % 3)];
        used[a] = 1;
        seen.set(a * count + b, (seen.get(a * count + b) ?? 0) + 1);
      }
    }
    expect(used.every((u) => u === 1)).toBe(true);
    // 没有对面的边正好就是切口那一圈，顺着 loop 的方向
    const open = [...seen.keys()].filter((key) => !seen.has((key % count) * count + Math.floor(key / count)));
    expect([...seen.values()].every((uses) => uses === 1)).toBe(true);
    expect(open).toHaveLength(hand.loop.length);
    hand.loop.forEach((v, i) => expect(seen.has(v * count + hand.loop[(i + 1) % hand.loop.length]), String(i)).toBe(true));
    // 切口在手腕的关节往手肘那边一点；手指朝 +X，拇指朝前，手是扁的
    for (const v of hand.loop) expect(hand.positions[v * 3]).toBeLessThan(HAND_WRIST[0] - 0.003);
    expect(HAND_CUFF).toBeGreaterThan(0.008);
    expect(HAND_CUFF).toBeLessThan(0.02);
    expect(HAND_LENGTH).toBeGreaterThan(0.13);
    expect(HAND_LENGTH).toBeLessThan(0.17);
  });

  it('自带权重：每个顶点加起来是 1；指尖跟着那根手指的最后一节，切口那一圈主要跟着前臂和手', () => {
    expect(hand.bones).toEqual(expect.arrayContaining(['LowerArm', 'Hand', 'Thumb1', 'Thumb3', 'Index1', 'Middle2', 'Ring3', 'Little3']));
    expect(hand.bones).toHaveLength(17);
    for (let v = 0; v < count; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += hand.weights[v * 4 + k];
      expect(sum).toBeCloseTo(1, 5);
    }
    const on = (v: number, names: string[]) => [0, 1, 2, 3].reduce((s, k) => s + (names.includes(hand.bones[hand.joints[v * 4 + k]]) ? hand.weights[v * 4 + k] : 0), 0);
    for (const { finger, joints } of FINGER_JOINTS) {
      // 离指尖最近的顶点
      const tip = joints[3];
      let best = 0;
      let near = Infinity;
      for (let v = 0; v < count; v++) {
        const d = Math.hypot(hand.positions[v * 3] - tip[0], hand.positions[v * 3 + 1] - tip[1], hand.positions[v * 3 + 2] - tip[2]);
        if (d < near) [near, best] = [d, v];
      }
      expect(near, finger).toBeLessThan(0.012);
      expect(on(best, [`${finger}3`]), finger).toBeGreaterThan(0.9);
    }
    for (const v of hand.loop) expect(on(v, ['LowerArm', 'Hand'])).toBeGreaterThan(0.8);
  });
});

describe('手缝到身体上', () => {
  for (const [label, spec] of [
    ['二次元素体', make({ bodyStyle: 'anime' })],
    ['白模人台 分指', make()],
  ] as const) {
    it(`${label}：三档精度下都是一整块封闭的网格，手上是三角面，带着自己的权重`, () => {
      const figure = buildFigure(spec);
      const all = sewn(figure);
      // 二次元素体的脚也是缝上去的
      expect(all.count).toBe(label === '二次元素体' ? 4 : 2);
      for (const voxel of [VOXEL.draft, VOXEL.preview, VOXEL.fine]) {
        const mesh = fuse(figure, voxel);
        const text = `${label} 体素 ${voxel}`;
        expect(edges(mesh), text).toEqual({ open: 0, crowded: 0 });
        expect(pieces(mesh), text).toBe(1);
        expect(mesh.info.components, text).toBe(1);
        expect(mesh.positions.every(Number.isFinite), text).toBe(true);
        expect(mesh.normals.every(Number.isFinite), text).toBe(true);
        // 手（和脚）的顶点排在最后，一个不少；面比它们本身多出来的是缝合的那几圈
        const bound = mesh.bound!;
        expect(mesh.positions.length / 3 - bound.start, text).toBe(all.vertices);
        expect(bound.joints, text).toHaveLength(all.vertices * 4);
        expect(mesh.tris!.length / 3, text).toBeGreaterThan(all.triangles + all.loop);
        expect(mesh.tris!.length / 3, text).toBeLessThan(all.triangles + all.loop + 100 * all.count);
        expect(mesh.triangles.length, text).toBe((mesh.quads.length / 4) * 6 + mesh.tris!.length);
        expect(mesh.info.triangles, text).toBe(mesh.triangles.length / 3);
        expect(mesh.info.vertices, text).toBe(mesh.positions.length / 3);
        // 身体留下来的每个顶点都有面用到（切掉的那一截的顶点清掉了）
        const used = new Uint8Array(mesh.positions.length / 3);
        for (const v of mesh.triangles) used[v] = 1;
        expect(used.every((u) => u === 1), text).toBe(true);
        // 没有叠在一起的顶点，缝上去的面没有面积是零的（Blender 里「按距离合并」不会合掉东西）
        const spots = new Set<string>();
        for (let v = 0; v < mesh.positions.length / 3; v++) spots.add(`${mesh.positions[v * 3].toFixed(6)},${mesh.positions[v * 3 + 1].toFixed(6)},${mesh.positions[v * 3 + 2].toFixed(6)}`);
        expect(spots.size, text).toBe(mesh.positions.length / 3);
        const p = mesh.positions;
        let thin = 0;
        for (let t = 0; t < mesh.tris!.length; t += 3) {
          const [a, b, c] = [mesh.tris![t] * 3, mesh.tris![t + 1] * 3, mesh.tris![t + 2] * 3];
          const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
          const w = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
          if (Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) < 1e-10) thin++;
        }
        expect(thin, text).toBe(0);
        // 法线是单位长度
        for (let v = 0; v < mesh.normals.length / 3; v += 37) {
          expect(Math.hypot(mesh.normals[v * 3], mesh.normals[v * 3 + 1], mesh.normals[v * 3 + 2]), text).toBeCloseTo(1, 3);
        }
      }
    });

    it(`${label}：左右两只手是对称的；手指一根根分开，指尖上的顶点跟着那根手指的最后一节`, () => {
      const figure = buildFigure({ ...spec, pose: 'T' });
      const mesh = fuse(figure);
      const unit = { parts: figure.parts, scale: 1 };
      const skeleton = buildSkeleton(unit);
      const skin = bindGrafts(skinVertices(unit, skeleton, mesh.positions), mesh, skeleton);
      const perHand = handMesh().positions.length / 3;
      const { start } = mesh.bound!;
      // 先左手后右手，同一个顶点左右镜像
      for (let i = 0; i < perHand; i += 53) {
        const l = (start + i) * 3;
        const r = (start + perHand + i) * 3;
        expect(mesh.positions[r]).toBeCloseTo(-mesh.positions[l], 5);
        expect(mesh.positions[r + 1]).toBeCloseTo(mesh.positions[l + 1], 5);
        expect(mesh.positions[r + 2]).toBeCloseTo(mesh.positions[l + 2], 5);
        expect(mesh.normals[r]).toBeCloseTo(-mesh.normals[l], 4);
      }
      // 每根手指的指尖骨骼旁边都有顶点，而且整个跟着这一节；左右手各是各的
      for (const side of ['L', 'R']) {
        for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
          const name = `${finger}3_${side}`;
          const b = skeleton.bones.findIndex((bone) => bone.name === name);
          const tip = skeleton.bones[b].tail;
          let best = -1;
          let near = Infinity;
          for (let v = start; v < mesh.positions.length / 3; v++) {
            const d = Math.hypot(mesh.positions[v * 3] - tip[0], mesh.positions[v * 3 + 1] - tip[1], mesh.positions[v * 3 + 2] - tip[2]);
            if (d < near) [near, best] = [d, v];
          }
          expect(near, name).toBeLessThan(0.015);
          let own = 0;
          let sum = 0;
          for (let k = 0; k < 4; k++) {
            sum += skin.weights[best * 4 + k];
            if (skin.joints[best * 4 + k] === b) own += skin.weights[best * 4 + k];
          }
          expect(sum, name).toBeCloseTo(1, 5);
          expect(own, name).toBeGreaterThan(0.9);
        }
      }
      // 手腕那一圈接上了：身体这边紧挨着手的顶点，和手的切口差不多粗（没有台阶）
      const xf = worldTransforms(unit).get('Arm_01_L')!;
      const wrist = skeleton.bones.find((bone) => bone.name === 'Hand_L')!.head;
      const along = rotate(xf.quat, [1, 0, 0]);
      expect(Math.abs(along[0])).toBeGreaterThan(0.9);
      const ring = (from: number, to: number, first: number, last: number) => {
        let wide = 0;
        for (let v = first; v < last; v++) {
          const x = mesh.positions[v * 3] - wrist[0];
          if (x < from || x > to) continue;
          wide = Math.max(wide, Math.hypot(mesh.positions[v * 3 + 1] - wrist[1], mesh.positions[v * 3 + 2] - wrist[2]));
        }
        return wide;
      };
      const s = label.startsWith('白模') ? 1.16 : 1;
      const cuff = ring(-HAND_CUFF * s - 0.004, -HAND_CUFF * s + 0.004, start, start + perHand);
      const sleeve = ring(-HAND_CUFF * s - 0.02, -HAND_CUFF * s - 0.004, 0, start);
      expect(cuff).toBeGreaterThan(0.012);
      expect(cuff).toBeLessThan(0.035);
      expect(sleeve).toBeGreaterThan(cuff * 0.85);
      expect(sleeve).toBeLessThan(cuff * 1.35);
    });
  }

  it('手臂多了每只手都缝得上：四对手臂，上下排和肩部聚拢，两种白模', () => {
    for (const bodyStyle of ['mannequin', 'anime'] as const) {
      for (const armLayout of ['stack', 'fan'] as const) {
        const figure = buildFigure(make({ bodyStyle, armLayout }, { armPairs: 4 }));
        const mesh = fuse(figure);
        const text = `${bodyStyle} ${armLayout}`;
        expect(edges(mesh), text).toEqual({ open: 0, crowded: 0 });
        expect(mesh.info.components, text).toBe(1);
        expect(pieces(mesh), text).toBe(1);
        expect(mesh.positions.length / 3 - mesh.bound!.start, text).toBe(sewn(figure).vertices);
        // 每只手 17 根骨骼；二次元素体的两只脚各 3 根（小腿、脚、脚趾）
        expect(new Set(mesh.bound!.bones).size, text).toBe(17 * 8 + (bodyStyle === 'anime' ? 6 : 0));
      }
    }
  });

  it('并指的手套形、没有手臂：不接现成的手，网格里没有三角面（二次元素体只缝两只脚）', () => {
    for (const figure of [buildFigure(make({ hands: 'mitten' })), buildFigure(make({}, { armPairs: 0 }))]) {
      expect(figure.parts.some((p) => p.grafts?.length)).toBe(false);
      const mesh = fuse(figure, VOXEL.draft);
      expect(mesh.tris).toBeUndefined();
      expect(mesh.bound).toBeUndefined();
      expect(mesh.info.triangles).toBe(mesh.quads.length / 2);
    }
    const legless = buildFigure(make({ bodyStyle: 'anime' }, { armPairs: 0 }));
    expect(legless.parts.flatMap((p) => p.grafts ?? []).map((g) => g.mesh)).toEqual(['foot', 'foot']);
    expect(fuse(legless, VOXEL.draft).info.components).toBe(1);
    // 分指、二次元素体：手臂的部件上带着这只手，骨骼名都对得上
    for (const figure of [buildFigure(make()), buildFigure(make({ bodyStyle: 'anime' }))]) {
      const names = new Set(buildSkeleton(figure).bones.map((b) => b.name));
      for (const arm of ['Arm_01_L', 'Arm_01_R']) {
        const [graft] = part(figure, arm).grafts!;
        expect(graft.mesh).toBe('hand');
        for (const name of Object.values(graft.bones)) expect(names.has(name), name).toBe(true);
      }
    }
  });

  it('手的摆放：手腕的关节落在 Hand 那根骨骼的根上，手指的关节落在手指骨骼上', () => {
    for (const spec of [make({ bodyStyle: 'anime' }), make({ bodyStyle: 'anime', pose: 'T' }), make(), make({}, { armPairs: 3 })]) {
      const figure = buildFigure(spec);
      const unit = { parts: figure.parts, scale: 1 };
      const skeleton = buildSkeleton(unit);
      const xfs = worldTransforms(unit);
      for (const arm of figure.parts.filter((p) => p.grafts?.[0].mesh === 'hand')) {
        const [graft] = arm.grafts!;
        const xf = xfs.get(arm.name)!;
        const place = (p: readonly number[]) => {
          const m = graft.matrix;
          const local: [number, number, number] = [
            graft.offset[0] + m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
            graft.offset[1] + m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
            graft.offset[2] + m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
          ];
          return rotate(xf.quat, local).map((v, k) => xf.pos[k] + v * xf.scale);
        };
        const at = (name: string) => skeleton.bones.find((b) => b.name === name)!;
        // 关节的位置在两份数据里各存了一遍，小数位数不一样，差几微米
        place(HAND_WRIST).forEach((v, k) => expect(v, `${arm.name} 手腕`).toBeCloseTo(at(graft.bones.Hand).head[k], 4));
        for (const { finger, joints } of FINGER_JOINTS) {
          place(joints[0]).forEach((v, k) => expect(v, `${arm.name} ${finger}`).toBeCloseTo(at(graft.bones[`${finger}1`]).head[k], 4));
          place(joints[3]).forEach((v, k) => expect(v, `${arm.name} ${finger} 指尖`).toBeCloseTo(at(graft.bones[`${finger}3`]).tail[k], 4));
        }
      }
    }
  });

  it('缝不上的时候（手腕那里没有一圈干净的开口）：手自己封好口放上去，网格还是封闭的，只是多出几块', () => {
    const figure = buildFigure(make({ bodyStyle: 'anime' }));
    // 把左臂的距离场整个拿掉：左手没有地方可缝
    const parts = figure.parts.map((p) => (p.name === 'Arm_01_L' ? { ...p, prims: [] } : p));
    const mesh = fuse({ parts });
    expect(edges(mesh)).toEqual({ open: 0, crowded: 0 });
    expect(pieces(mesh)).toBe(2);
    expect(mesh.info.components).toBe(2);
    // 右手（和两只脚）照常缝上了；左手多了一个封口用的顶点
    expect(mesh.positions.length / 3 - mesh.bound!.start).toBe(sewn(figure).vertices + 1);
  });

  it('手动把手臂拉长、放大：手跟着手腕走（放大是整个一起放大，拉长不把手指也拉长），照样缝得上', () => {
    const figure = buildFigure(make({ bodyStyle: 'anime', pose: 'T' }));
    const plain = fuse(figure);
    const far = (mesh: FusedMesh) => {
      let x = 0;
      for (let i = 0; i < mesh.positions.length; i += 3) x = Math.max(x, mesh.positions[i]);
      return x;
    };
    const stretched = fuse({ parts: figure.parts.map((p) => (p.type === 'arm' ? { ...p, resize: [1, 1.2, 1] as [number, number, number] } : p)) });
    expect(edges(stretched)).toEqual({ open: 0, crowded: 0 });
    expect(stretched.info.components).toBe(1);
    const arm = part(figure, 'Arm_01_L');
    // 手臂拉长了 1.2 倍，手还是原来的大小：最远的指尖比「整条连手拉长 1.2 倍」近一点
    expect(far(stretched) - arm.pos[0]).toBeGreaterThan((far(plain) - arm.pos[0]) * 1.12);
    expect(far(stretched) - arm.pos[0]).toBeLessThan((far(plain) - arm.pos[0]) * 1.2 - 0.01);
    const bigger = fuse({ parts: figure.parts.map((p) => (p.type === 'arm' ? { ...p, scale: 1.3 } : p)) });
    expect(edges(bigger)).toEqual({ open: 0, crowded: 0 });
    expect(bigger.info.components).toBe(1);
    expect(far(bigger) - arm.pos[0]).toBeCloseTo((far(plain) - arm.pos[0]) * 1.3, 2);
  });

  it('导出 OBJ：四边面后面接着写手上的三角面；分部件时手臂的网格里也带着手', () => {
    const figure = buildFigure(make());
    const mesh = fuse(figure, VOXEL.draft);
    const text = writeObj([{ name: 'Body', positions: mesh.positions, normals: mesh.normals, faces: mesh.quads, faceSize: 4, triangles: mesh.tris }]);
    const faces = text.split('\n').filter((line) => line.startsWith('f '));
    expect(faces.filter((line) => line.split(' ').length === 5)).toHaveLength(mesh.quads.length / 4);
    expect(faces.filter((line) => line.split(' ').length === 4)).toHaveLength(mesh.tris!.length / 3);
    const withHand = triangleCount(buildPartGeometry(part(figure, 'Arm_01_L')));
    const without = triangleCount(buildPartGeometry({ ...part(figure, 'Arm_01_L'), grafts: undefined }));
    expect(withHand - without).toBe(handMesh().triangles.length / 3);
  });
});

describe('手臂手动拉长、加粗以后的手', () => {
  const boneOf = (figure: Pick<Figure, 'parts' | 'scale'>, name: string) => buildSkeleton(figure).bones.find((bone) => bone.name === name)!;
  const span = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  /** 左手的那几个尺寸：前臂长、手掌长（手腕到中指根）、中指三节各多长 */
  const sizes = (figure: Pick<Figure, 'parts' | 'scale'>) => ({
    fore: span(boneOf(figure, 'LowerArm_L').head, boneOf(figure, 'LowerArm_L').tail),
    palm: span(boneOf(figure, 'Hand_L').head, boneOf(figure, 'Middle1_L').head),
    finger: ['Middle1_L', 'Middle2_L', 'Middle3_L'].map((name) => span(boneOf(figure, name).head, boneOf(figure, name).tail)),
  });

  for (const bodyStyle of ['mannequin', 'anime'] as const) {
    it(`${bodyStyle}：手臂拉长 1.8 倍，手还是原来的大小（不跟着细长一倍），接在拉长以后的手腕上`, () => {
      if (bodyStyle === 'anime') useAnimeBody();
      const plain = buildFigure({ ...defaultSpec(), bodyStyle });
      const long = buildFigure({ ...defaultSpec(), bodyStyle, overrides: { Arm_01_L: { scale: [1, 1.8, 1] } } });
      const a = sizes(plain);
      const b = sizes(long);
      // 前臂是照着拉长的
      expect(b.fore / a.fore).toBeGreaterThan(1.6);
      // 手：照手腕那里横截面的粗细等比变——手臂只是拉长，手就还是原来的大小（前臂不是正好顺着拉长的方向，差一点点），
      // 手掌和每节手指是同一个倍数
      const grown = b.palm / a.palm;
      expect(grown).toBeCloseTo(1, 1);
      b.finger.forEach((length, k) => expect(length / a.finger[k], `中指第 ${k + 1} 节`).toBeCloseTo(grown, 2));
      // 手的骨骼还是接在前臂的末端
      const wrist = boneOf(long, 'LowerArm_L').tail;
      boneOf(long, 'Hand_L').head.forEach((v, k) => expect(v).toBeCloseTo(wrist[k], 4));
      // 手的网格也是：左手（第一只）的顶点离手腕最远还是原来那么远（照老办法手指被拉成原来的 1.8 倍长）
      const reach = (figure: Figure) => {
        const at = boneOf(figure, 'Hand_L').head;
        const points = graftPoints(figure.parts);
        const each = handMesh().positions.length;
        let far = 0;
        // 网格的点是按 Figure.scale = 1 给的，骨架是米
        for (let i = 0; i < each; i += 3) far = Math.max(far, Math.hypot(points[i] * figure.scale - at[0], points[i + 1] * figure.scale - at[1], points[i + 2] * figure.scale - at[2]));
        return far;
      };
      expect(reach(long) / reach(plain)).toBeLessThan(1.06);
      expect(reach(long) / reach(plain)).toBeGreaterThan(0.97);
      // 融合出来还是一整块，手缝得上
      const mesh = fuseParts(long.parts, { voxel: VOXEL.draft, blend: 0.02 });
      expect(mesh.info.components).toBe(1);
      // 右手没动过
      expect(sizes(long).fore).toBeCloseTo(b.fore, 9);
      const right = (figure: Figure) => span(boneOf(figure, 'Hand_R').head, boneOf(figure, 'Middle1_R').head);
      expect(right(long)).toBeCloseTo(right(plain), 9);
    }, 60_000);
  }

  it('分部件：手臂拉长以后，手的那一片网格没有被拉长（整个部件等比放大的那一份，手在部件自己的坐标里缩回去，摆出来还是原来的大小）', () => {
    const plain = buildFigure(defaultSpec()).parts.find((part) => part.name === 'Arm_01_L')!;
    const long = buildFigure({ ...defaultSpec(), overrides: { Arm_01_L: { scale: [1, 1.8, 1] } } }).parts.find((part) => part.name === 'Arm_01_L')!;
    const hand = handMesh().positions.length / 3;
    /** 部件网格的最后一段是手：它的顶点互相之间最远隔多远 */
    const size = (part: Part) => {
      const geo = buildPartGeometry(part);
      const p = geo.getAttribute('position').array;
      const from = p.length / 3 - hand;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let v = from; v < p.length / 3; v++) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], p[v * 3 + k]);
          max[k] = Math.max(max[k], p[v * 3 + k]);
        }
      }
      geo.dispose();
      return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    };
    expect(long.scale).toBeCloseTo(Math.cbrt(1.8), 6);
    expect((size(long) * long.scale!) / size(plain)).toBeCloseTo(1, 1);
  });

  it('手臂加粗 1.5 倍（长短不变）：手跟着大到 1.5 倍，还缝得上', () => {
    const plain = buildFigure(defaultSpec());
    const thick = buildFigure({ ...defaultSpec(), overrides: { Arm_01_L: { scale: [1.5, 1, 1.5] } } });
    const palm = (figure: Figure) => span(boneOf(figure, 'Hand_L').head, boneOf(figure, 'Middle1_L').head);
    expect(palm(thick) / palm(plain)).toBeCloseTo(1.5, 1);
    expect(fuseParts(thick.parts, { voxel: VOXEL.draft, blend: 0.02 }).info.components).toBe(1);
  }, 60_000);
});

describe('二次元素体的脚：现成的网格（带脚趾），缝在脚踝上面', () => {
  const foot = footMesh();
  const count = foot.positions.length / 3;

  it('一只左脚：除了脚踝上面那一圈切口都是封好的；脚趾尖跟着 Toes，切口跟着小腿', () => {
    expect(count).toBeGreaterThan(1000);
    expect(foot.bones).toEqual(['LowerLeg', 'Foot', 'Toes']);
    const seen = new Map<number, number>();
    for (let t = 0; t < foot.triangles.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = foot.triangles[t + k];
        const b = foot.triangles[t + ((k + 1) % 3)];
        seen.set(a * count + b, (seen.get(a * count + b) ?? 0) + 1);
      }
    }
    let open = 0;
    for (const [key, n] of seen) {
      expect(n).toBe(1);
      if (!seen.has((key % count) * count + Math.floor(key / count))) open++;
    }
    expect(open).toBe(foot.loop.length);
    for (let v = 0; v < count; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += foot.weights[v * 4 + k];
      expect(sum).toBeCloseTo(1, 2);
    }
    // 最靠前的顶点（脚尖）跟着脚趾，切口那一圈（脚踝上面）大多跟着小腿
    let front = 0;
    for (let v = 1; v < count; v++) if (foot.positions[v * 3 + 2] > foot.positions[front * 3 + 2]) front = v;
    const on = (v: number, bone: string) => {
      let w = 0;
      for (let k = 0; k < 4; k++) if (foot.bones[foot.joints[v * 4 + k]] === bone) w += foot.weights[v * 4 + k];
      return w;
    };
    expect(on(front, 'Toes')).toBeGreaterThan(0.9);
    const shin = foot.loop.reduce((sum, v) => sum + on(v, 'LowerLeg'), 0) / foot.loop.length;
    expect(shin).toBeGreaterThan(0.5);
    // 脚底踩在素体的脚底那么高，脚踝和素体的脚踝差不了几毫米
    expect(FOOT_SOLE).toBeLessThan(0.02);
    expect(Math.hypot(FOOT_ANKLE[0] - 0.0463, FOOT_ANKLE[1] - 0.1029, FOOT_ANKLE[2] + 0.0252)).toBeLessThan(0.005);
  });

  const low = (mesh: FusedMesh) => {
    let y = Infinity;
    for (let i = 1; i < mesh.positions.length; i += 3) y = Math.min(y, mesh.positions[i]);
    return y;
  };

  it('每条人腿一只脚：两条腿、单足、人腿人马、前后串联、胯部聚拢，腿拉长缩短、变粗变细，都是一整块、脚底踩在地上', () => {
    const anime = (counts: Partial<BodySpec['counts']>, rest: Partial<BodySpec> = {}, shape: Partial<BodySpec['shape']> = {}) => {
      const base = make({ bodyStyle: 'anime', ...rest }, counts);
      return { ...base, shape: { ...base.shape, ...shape } };
    };
    for (const [text, spec] of [
      ['两条腿', anime({})],
      ['单足', anime({ legs: 1 })],
      ['人腿人马', anime({ legs: 4 }, { legLayout: 'humantaur' })],
      ['前后串联', anime({ legs: 4 }, { legLayout: 'tandem' })],
      ['胯部聚拢', anime({ legs: 6 }, { legLayout: 'gather' })],
      ['腿拉长', anime({}, {}, { legLength: 1.6 })],
      ['腿缩短', anime({}, {}, { legLength: 0.6 })],
      ['腿变粗', anime({}, {}, { limbs: 1.8 })],
      ['腿变细', anime({}, {}, { limbs: 0.55 })],
    ] as const) {
      const figure = buildFigure(spec);
      const legs = figure.parts.filter((p) => p.type === 'leg');
      expect(legs.length, text).toBe(spec.counts.legs);
      for (const leg of legs) expect(leg.grafts?.map((g) => g.mesh), `${text} ${leg.name}`).toEqual(['foot']);
      const mesh = fuse(figure);
      expect(mesh.info.components, text).toBe(1);
      expect(edges(mesh), text).toEqual({ open: 0, crowded: 0 });
      expect(low(mesh), text).toBeGreaterThan(-0.006);
      expect(low(mesh), text).toBeLessThan(0.006);
    }
  }, 120_000);

  it('脚的骨骼：脚踝、脚趾根落在 Foot、Toes 的根上，脚尖在 Toes 的末端', () => {
    const figure = buildFigure(make({ bodyStyle: 'anime' }));
    const unit = { parts: figure.parts, scale: 1 };
    const skeleton = buildSkeleton(unit);
    const xf = worldTransforms(unit).get('Leg_01_L')!;
    const [graft] = part(figure, 'Leg_01_L').grafts!;
    const place = (p: readonly number[]) => {
      const m = graft.matrix;
      const local: [number, number, number] = [
        graft.offset[0] + m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
        graft.offset[1] + m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
        graft.offset[2] + m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
      ];
      return rotate(xf.quat, local).map((v, k) => xf.pos[k] + v * xf.scale);
    };
    const at = (name: string) => skeleton.bones.find((b) => b.name === name)!;
    // 骨骼的脚踝是素体的，脚的网格是照它摆的：差几毫米
    place(FOOT_ANKLE).forEach((v, k) => expect(Math.abs(v - at('Foot_L').head[k])).toBeLessThan(0.006));
    place(FOOT_TOE).forEach((v, k) => expect(v).toBeCloseTo(at('Toes_L').head[k], 4));
    place(FOOT_TOE_END).forEach((v, k) => expect(v).toBeCloseTo(at('Toes_L').tail[k], 4));
  });
});
