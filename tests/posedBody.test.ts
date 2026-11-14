// 照姿势变形以后身体的距离（sdf/posedBody.ts）：套现成姿势时手腕外面那一截照它量
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type BodySpec, defaultSpec } from '../src/model/spec';
import { clearArms } from '../src/pose/clear';
import { fitArms, followArms } from '../src/pose/fit';
import { POSE_LIBRARY } from '../src/pose/library';
import { forward, poseMatrices, tailOf } from '../src/pose/rig';
import { makeSolver, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { compileField, fieldAt } from '../src/sdf/field';
import { posedBodyDist } from '../src/sdf/posedBody';
import { useAnimeBody } from './animeBody';

describe('照姿势变形以后身体的距离', () => {
  it('每根骨骼都不动时和静止的距离场一样（只算身子、头、腿、胸，不算手臂）', () => {
    useAnimeBody();
    const spec = { ...defaultSpec(), bodyStyle: 'anime' as const };
    const figure = buildFigure(spec);
    const bones = buildSkeleton(figure).bones.length;
    const still = new Float64Array(bones * 12);
    for (let i = 0; i < bones; i++) still.set([1, 0, 0, 0, 1, 0, 0, 0, 1], i * 12);
    const posed = posedBodyDist(figure, spec.blend, still);
    expect(posed).not.toBeNull();
    const kept = new Set<string>();
    const parts = figure.parts.filter((p) => {
      const keep = ['torso', 'lower', 'leg', 'neck', 'head', 'chest'].includes(p.type) && (!p.parent || kept.has(p.parent));
      if (keep) kept.add(p.name);
      return keep;
    });
    const field = compileField({ scale: figure.scale, parts }, { blend: spec.blend });
    let worst = 0;
    let n = 0;
    for (let x = -0.3; x <= 0.3; x += 0.05) {
      for (let y = 0.1; y <= 1.5; y += 0.1) {
        for (let z = -0.2; z <= 0.2; z += 0.05) {
          const a = fieldAt(field, x, y, z);
          if (Math.abs(a) > 0.03) continue;
          n++;
          worst = Math.max(worst, Math.abs(posed!(x, y, z) - a));
        }
      }
    }
    expect(n).toBeGreaterThan(50);
    expect(worst).toBeLessThan(1e-6);
  }, 60_000);

  it('骨架对不上（蒙皮矩阵数目不对）返回 null', () => {
    useAnimeBody();
    const figure = buildFigure({ ...defaultSpec(), bodyStyle: 'anime' });
    expect(posedBodyDist(figure, 0.02, new Float64Array(12))).toBeNull();
  });

  it('套姿势时手腕外面那一截照它量：两个上半身弯腰时屁股那里，照静止姿势换算量不准，手腕外面那一截顶在屁股上（缝不上，手掉成单独一块）', () => {
    useAnimeBody();
    const base = defaultSpec();
    const spec: BodySpec = { ...base, bodyStyle: 'anime', counts: { ...base.counts, torsos: 2 }, torsoCounts: { L: { armPairs: 2 }, R: { heads: 2, breasts: 4 } } };
    const figure = buildFigure(spec);
    const solver = makeSolver(buildSkeleton(figure).bones);
    const kept = new Set<string>();
    const parts = figure.parts.filter((p) => {
      const keep = ['torso', 'lower', 'leg', 'neck', 'head', 'chest'].includes(p.type) && (!p.parent || kept.has(p.parent));
      if (keep) kept.add(p.name);
      return keep;
    });
    const field = compileField({ scale: figure.scale, parts }, { blend: spec.blend });
    const still = (x: number, y: number, z: number) => fieldAt(field, x, y, z);
    const raw = POSE_LIBRARY.find((p) => p.name === '弯腰拿东西')!.posing;
    const bones = { ...raw.bones };
    for (const [name, turn] of Object.entries(raw.bones)) {
      const m = /^(Spine|Chest|UpperChest)(\.\d+)?$/.exec(name);
      if (m) for (const side of ['_L', '_R']) bones[`${m[1]}${side}${m[2] ?? ''}`] = turn;
    }
    const { posing, followers } = followArms(solver, fitArms(solver, { ...raw, bones }));
    const posed = posedBodyDist(figure, spec.blend, poseMatrices(solver.rig, forward(solver.rig, stateOf(solver, posing)), figure.scale))!;
    // 左边那个身子下面那条右手：顺着手往手腕外面 2 cm、3 cm 那两点离身体多远（照摆好的姿势量）
    const gaps = (after: typeof posing) => {
      const frame = forward(solver.rig, stateOf(solver, after));
      const limb = solver.limbs.find((one) => one.name === 'Hand_R.003')!;
      const w = frame.pos[limb.end];
      const tip = tailOf(solver.rig, frame, solver.rig.index.get('Middle3_R.003')!);
      const l = Math.hypot(tip[0] - w[0], tip[1] - w[1], tip[2] - w[2]);
      return [0.02, 0.03].map((at) => posed(...([0, 1, 2].map((k) => w[k] + ((tip[k] - w[k]) / l) * at * figure.scale) as [number, number, number])));
    };
    for (const gap of gaps(clearArms(solver, posing, still, figure.scale, 1, followers))) expect(gap).toBeLessThan(0.028 * figure.scale);
    for (const gap of gaps(clearArms(solver, posing, still, figure.scale, 1, followers, posed))) expect(gap).toBeGreaterThan(0.028 * figure.scale);
  }, 60_000);
});
