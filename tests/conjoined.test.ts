// queen conjoined 连体（src/geometry/conjoined.ts、src/character/conjoin.ts，docs/digits-plan.md 第 6 期）
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleCharacter } from '../src/character/assemble';
import { characterSkeleton } from '../src/character/export';
import { CHARACTER } from '../src/character/load';
import { type CharacterSource, readCharacter } from '../src/character/source';
import { buildFigure } from '../src/geometry/layout';
import { type BodySpec, defaultSpec, normalizeSpec } from '../src/model/spec';
import { forward, restState } from '../src/pose/rig';
import { plantFeet } from '../src/pose/solve';
import { makeSolver } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { graftPoints } from '../src/sdf/graft';
import { VOXEL } from '../src/sdf/fuse';
import { runJob } from '../src/sdf/job';
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
            // 侧躺：两个头差不多一样高，都在身子上面
            expect(Math.abs(at('Head')[1] - at('Head.002')[1])).toBeLessThan(0.08);
            expect(at('Head')[1]).toBeGreaterThan(at('Hips')[1]);
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

  for (const kind of ['same', 'opposite'] as const) {
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
