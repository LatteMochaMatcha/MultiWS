// queen conjoined 连体（src/geometry/conjoined.ts、src/character/conjoin.ts，docs/digits-plan.md 第 6 期）
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleCharacter } from '../src/character/assemble';
import { characterSkeleton } from '../src/character/export';
import { applyFaces, faceLabel } from '../src/character/face';
import { CHARACTER } from '../src/character/load';
import { type CharacterSource, readCharacter } from '../src/character/source';
import { buildFigure } from '../src/geometry/layout';
import { type BodySpec, defaultSpec, normalizeSpec } from '../src/model/spec';
import { fitConjoined } from '../src/pose/conjoined';
import { POSE_LIBRARY } from '../src/pose/library';
import { forward, restState } from '../src/pose/rig';
import { plantFeet } from '../src/pose/solve';
import { makeSolver, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { graftPoints } from '../src/sdf/graft';
import { VOXEL } from '../src/sdf/fuse';
import { runJob } from '../src/sdf/job';
import { type V3, dot, norm, sub } from '../src/geometry/vec';
import { useAnimeBody } from './animeBody';

const specOf = (patch: Partial<BodySpec>): BodySpec => normalizeSpec({ ...defaultSpec(), ...patch });

describe('连体：白模人台、二次元素体', () => {
  for (const style of ['mannequin', 'anime'] as const) {
    for (const kind of ['same', 'opposite'] as const) {
      it(`${style} ${kind}：一整块，四只手都踩在地上，没有腿；骨骼接着往下编号`, () => {
        if (style === 'anime') useAnimeBody();
        const spec = specOf({ bodyStyle: style, conjoined: kind });
        const figure = buildFigure(spec);
        expect(figure.parts.some((p) => p.type === 'leg' || p.type === 'tail')).toBe(false);
        const arms = figure.parts.filter((p) => p.type === 'arm');
        expect(arms.length).toBe(4);
        // 每只手最低的那一点都在地上
        for (const arm of arms) {
          const only = figure.parts.map((p) => (p === arm ? p : { ...p, grafts: undefined }));
          const pts = graftPoints(only);
          let low = Infinity;
          for (let i = 1; i < pts.length; i += 3) low = Math.min(low, pts[i]);
          expect(Math.abs(low)).toBeLessThan(0.003);
        }
        const { mesh } = runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: spec.blend });
        expect(mesh.info.components).toBe(1);
        const names = buildSkeleton(figure).bones.map((b) => b.name);
        for (const name of ['Hips', 'Spine', 'Spine.002', 'Head', 'Head.002', 'UpperArm_L', 'UpperArm_L.002', 'Hand_R.002']) expect(names).toContain(name);
        expect(names).not.toContain('UpperLeg_L');
        // 摆姿势：四条手臂，没有腿；「脚踩到地上」踩的是手，静止时手腕原地不动
        const solver = makeSolver(buildSkeleton(figure).bones);
        expect(solver.limbs.filter((l) => l.kind === 'arm').length).toBe(4);
        expect(solver.limbs.filter((l) => l.kind === 'leg').length).toBe(0);
        const planted = forward(solver.rig, plantFeet(solver, restState(solver.rig)));
        for (const limb of solver.limbs) expect(planted.pos[limb.end][1]).toBeCloseTo(solver.rig.head[limb.end][1], 3);
      });
    }
  }

  for (const style of ['mannequin', 'anime'] as const) {
    it(`${style}：站着（下面那个倒立撑地）、侧躺（撑着胳膊肘）、平躺都是一整块，落在地上`, () => {
      if (style === 'anime') useAnimeBody();
      for (const posture of ['stand', 'lie', 'flat'] as const) {
        for (const kind of ['same', 'opposite'] as const) {
          const spec = specOf({ bodyStyle: style, conjoined: kind, conjoinPose: posture });
          const figure = buildFigure(spec);
          const { mesh } = runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: spec.blend });
          expect(mesh.info.components).toBe(1);
          let low = Infinity;
          for (let i = 1; i < mesh.positions.length; i += 3) low = Math.min(low, mesh.positions[i] * figure.scale);
          expect(Math.abs(low)).toBeLessThan(0.006);
          const sk = buildSkeleton(figure).bones;
          const at = (n: string) => sk.find((b) => b.name === n)!.head;
          if (posture === 'stand') {
            // 上面那个的头在最上面，下面那个倒立：头在胯底下、两只手撑在地上
            expect(at('Head')[1]).toBeGreaterThan(at('Head.002')[1] + 0.5);
            expect(at('Hand_L.002')[1]).toBeLessThan(0.1);
          } else if (posture === 'flat') {
            // 平躺：整个人贴着地，两个头一前一后，手张开在身子两边、不在腰上交叉
            expect(figure.metrics.height).toBeLessThan(0.7);
            expect(Math.abs(at('Head')[2] - at('Head.002')[2])).toBeGreaterThan(0.5);
            expect(Math.abs(at('Hand_L')[0] - at('Hand_R')[0])).toBeGreaterThan(0.5);
          } else {
            // 侧躺：两个头差不多一样高，都在身子上面；两个上半身在同一条轴上（腰到两边脖子差不多一条直线，不翘成 V）
            expect(Math.abs(at('Head')[1] - at('Head.002')[1])).toBeLessThan(0.08);
            expect(at('Head')[1]).toBeGreaterThan(at('Hips')[1]);
            const toward = (n: string) => {
              const d = sub(at(n), at('Hips'));
              return norm(d as V3);
            };
            expect(dot(toward('Neck'), toward('Neck.002'))).toBeLessThan(Math.cos((170 * Math.PI) / 180));
          }
        }
      }
    });
  }

  it('同向两个都胸口朝下：两个头都在身子上面（趴着抬头），身子是横着的', () => {
    const figure = buildFigure(specOf({ bodyStyle: 'mannequin', conjoined: 'same' }));
    const sk = buildSkeleton(figure).bones;
    const at = (n: string) => sk.find((b) => b.name === n)!.head;
    // 两个头一前一后，差不多一样高；手比头低得多
    expect(Math.abs(at('Head')[2] - at('Head.002')[2])).toBeGreaterThan(0.5);
    expect(Math.abs(at('Head')[1] - at('Head.002')[1])).toBeLessThan(0.05);
    expect(at('Hand_L')[1]).toBeLessThan(at('Head')[1] - 0.3);
  });
});

describe('连体：套现成的姿势（pose/conjoined.ts）', () => {
  for (const posture of ['prone', 'lie'] as const) {
    it(`白模 ${posture}：姿势换到每个上半身自己的朝向里，胯不动，撑着的手留在原处，上面的手照姿势动`, () => {
      const figure = buildFigure(specOf({ bodyStyle: 'mannequin', conjoined: 'same', conjoinPose: posture, counts: { ...defaultSpec().counts, heads: 2, armPairs: 2 } }));
      const solver = makeSolver(buildSkeleton(figure).bones);
      const preset = POSE_LIBRARY.find((p) => p.name === '张开双臂')!.posing;
      const posing = fitConjoined(solver, preset, posture);
      expect(posing.root).toBeUndefined();
      expect(posing.bones.Hips).toBeUndefined();
      const rest = forward(solver.rig, restState(solver.rig));
      const posed = forward(solver.rig, stateOf(solver, posing));
      const moved = (j: number) => Math.hypot(...[0, 1, 2].map((k) => posed.pos[j][k] - rest.pos[j][k]));
      // 两个上半身的脊柱、脖子都差不多在原处（不会整个人翻过去；姿势里脊柱自己弯一点，脖子跟着挪几厘米）
      for (const name of ['Spine', 'Spine.002']) expect(moved(solver.rig.index.get(name)!)).toBeLessThan(1e-3);
      for (const name of ['Neck', 'Neck.003']) expect(moved(solver.rig.index.get(name)!)).toBeLessThan(0.08);
      const arms = solver.limbs.filter((l) => l.kind === 'arm');
      expect(arms.length).toBe(8);
      const low = Math.min(...solver.rig.head.map((h) => h[1]));
      const grounded = arms.filter((l) => solver.rig.head[l.end][1] - low < 0.06);
      // 落在地上撑着的手一动不动；趴着时八只手都是，侧躺时还有上面那几只手照姿势动了
      for (const l of grounded) if (posture === 'prone' || solver.rig.head[l.lower][1] - low < 0.06) expect(moved(l.end)).toBeLessThan(1e-3);
      if (posture === 'lie') expect(arms.filter((l) => moved(l.end) > 0.05).length).toBeGreaterThanOrEqual(4);
    });
  }
});

let cached: CharacterSource | null = null;
function source(): CharacterSource {
  if (!cached) {
    const file = readFileSync(new URL(`../public/${CHARACTER.url}`, import.meta.url));
    cached = readCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, CHARACTER);
  }
  return cached;
}

describe('连体：成品角色', () => {
  it('站着、躺着也拼得出来，落在地上', () => {
    for (const conjoinPose of ['stand', 'lie', 'flat'] as const) {
      const build = assembleCharacter(source(), { ...defaultSpec(), bodyStyle: 'character', conjoined: 'same', conjoinPose });
      let low = Infinity;
      for (const c of build.meshes) for (let i = 1; i < c.positions.length; i += 3) low = Math.min(low, c.positions[i]);
      expect(low).toBeGreaterThan(-0.05);
      expect(makeSolver(characterSkeleton(build).bones).limbs.filter((l) => l.kind === 'arm').length).toBe(4);
    }
  });

  it('两个上半身的脸各是一张，表情各摆各的；第二个上半身的头接着往下数，眼睛骨骼也有', () => {
    for (const kind of ['same', 'opposite'] as const) {
      const build = assembleCharacter(source(), { ...defaultSpec(), bodyStyle: 'character', conjoined: kind });
      expect(build.faces.map((f) => f.key)).toEqual(['Head', 'Head.002']);
      expect(build.faces[1].bone).toBe('Head.002');
      expect(build.faces[1].eyes).toEqual(['Eye_L.002', 'Eye_R.002']);
      for (const name of build.faces[1].eyes!) expect(build.bones.some((b) => b.name === name), name).toBe(true);
      // 只给第二个上半身的脸套表情：动的只有它那张脸上的点，而且每个点挪的距离和第一张脸套同一个表情时一样（只是转了个方向）
      const moved = (key: string) => {
        const out = [0, 0];
        let far = 0;
        for (const m of build.meshes) {
          const p = m.positions.slice();
          if (!applyFaces(build, m, { [key]: { joy: 1 } }, p, m.normals.slice())) continue;
          for (let v = 0; v < m.faceOf!.length; v++) {
            const d = Math.hypot(p[v * 3] - m.positions[v * 3], p[v * 3 + 1] - m.positions[v * 3 + 1], p[v * 3 + 2] - m.positions[v * 3 + 2]);
            if (d > 1e-6) out[m.faceOf![v]]++;
            far += d;
          }
        }
        return { out, far };
      };
      const first = moved('Head');
      const second = moved('Head.002');
      expect(first.out[0]).toBeGreaterThan(500);
      expect(first.out[1]).toBe(0);
      expect(second.out).toEqual([0, first.out[0]]);
      expect(second.far).toBeCloseTo(first.far, 2);
    }
    // 两个头的连体：第二个上半身的两个头是头 3、头 4；一个头两张脸的，第二个上半身多出来的那张是「头 2 脸 2」
    const two = assembleCharacter(source(), { ...defaultSpec(), bodyStyle: 'character', conjoined: 'same', counts: { ...defaultSpec().counts, heads: 2 } });
    expect(two.faces.map((f) => f.key).sort()).toEqual(['Head', 'Head.002', 'Head.003', 'Head.004']);
    for (const f of two.faces) for (const name of f.eyes!) expect(two.bones.some((b) => b.name === name), name).toBe(true);
    const sided = assembleCharacter(source(), { ...defaultSpec(), bodyStyle: 'character', conjoined: 'same', headLayout: 'faces', counts: { ...defaultSpec().counts, heads: 2 } });
    expect(sided.faces.map((f) => f.key).sort()).toEqual(['Head', 'Head.002', 'Head.002/2', 'Head/2']);
    expect(sided.faces.map((f) => faceLabel(f.key)).sort()).toEqual(['头 1', '头 2', '头 2 脸 2', '脸 2']);
  });

  for (const kind of ['same', 'opposite'] as const) {
    it(`${kind} 侧躺：两个上半身在同一条轴上，脖子只稍微歪，头不往肩膀上挤；靠地的那只手臂贴地`, () => {
      const build = assembleCharacter(source(), { ...defaultSpec(), bodyStyle: 'character', conjoined: kind, conjoinPose: 'lie' });
      const at = (name: string) => build.bones.find((b) => b.name === name)!;
      const dir = (from: number[], to: number[]) => {
        const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
        const n = Math.hypot(d[0], d[1], d[2]);
        return d.map((x) => x / n);
      };
      for (const suffix of ['', '.002']) {
        const head = at(`Head${suffix}`);
        const neck = build.bones[head.parent];
        const chest = build.bones[neck.parent];
        const neckDir = dir(neck.head, head.head);
        const chestDir = dir(chest.head, neck.head);
        // 脖子相对胸口弯不到 30°（以前全靠脖子扶正头，弯四十几度，下巴挤进领子）
        expect(Math.acos(neckDir.reduce((s, x, i) => s + x * chestDir[i], 0))).toBeLessThan((30 * Math.PI) / 180);
      }
      // 两个上半身在同一条轴上：腰到两边脖子差不多一条直线（不翘成 V）
      const hips = at('Hips').head;
      const neckA = dir(hips, at('Neck').head);
      const neckB = dir(hips, at('Neck.002').head);
      expect(neckA.reduce((s, x, i) => s + x * neckB[i], 0)).toBeLessThan(Math.cos((170 * Math.PI) / 180));
      let low = Infinity;
      for (const c of build.meshes) for (let i = 1; i < c.positions.length; i += 3) low = Math.min(low, c.positions[i]);
      expect(low).toBeCloseTo(0, 4);
      // 靠地的那只手臂：每个上半身至少有一个胳膊肘离地不到 12 厘米（袖口垂在胳膊肘下面，关节在袖子里）
      for (const suffix of ['', '.002']) {
        const elbows = ['L', 'R'].map((s) => at(`LowerArm_${s}${suffix}`).head[1] - low);
        expect(Math.min(...elbows)).toBeLessThan(0.12);
      }
    });

    it(`${kind}：腰往下没了，复制出来的上半身接着往下编号，落在地上，四条手臂`, () => {
      const build = assembleCharacter(source(), { ...defaultSpec(), bodyStyle: 'character', conjoined: kind });
      const names = build.bones.map((b) => b.name);
      for (const name of ['Hips', 'Spine.002', 'Head.002', 'UpperArm_R.002']) expect(names).toContain(name);
      expect(names).not.toContain('UpperLeg_L');
      let low = Infinity;
      for (const c of build.meshes) for (let i = 1; i < c.positions.length; i += 3) low = Math.min(low, c.positions[i]);
      expect(low).toBeCloseTo(0, 4);
      const solver = makeSolver(characterSkeleton(build).bones);
      expect(solver.limbs.filter((l) => l.kind === 'arm').length).toBe(4);
      // 两头的手都在地上（手腕弯过去以后离地不到 12 厘米：喇叭袖口裹着手腕）
      const wrists = solver.limbs.map((l) => solver.rig.head[l.end][1]);
      for (const y of wrists) expect(y).toBeLessThan(0.12);
    });
  }
});
