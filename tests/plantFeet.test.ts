// 摆姿势的「脚踩到地上」（pose/solve.ts 的 plantFeet）：每只脚落到地面、脚掌放平，腿够不着的整个人往下落，上半身不动
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { rotate, sub } from '../src/geometry/vec';
import { type BodySpec, defaultSpec, legPlan } from '../src/model/spec';
import { fitLegs } from '../src/pose/fitLegs';
import { POSE_LIBRARY } from '../src/pose/library';
import { forward } from '../src/pose/rig';
import { plantFeet } from '../src/pose/solve';
import { makeSolver, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { useAnimeBody } from './animeBody';

const make = (patch: Partial<BodySpec> = {}, legs = 2): BodySpec => {
  const base = defaultSpec();
  return { ...base, bodyStyle: 'anime', ...patch, counts: { ...base.counts, legs } };
};

describe('脚踩到地上', () => {
  for (const [label, spec] of [
    ['两条腿', make()],
    ['前后串联六条腿', make({ legLayout: 'tandem' }, 6)],
    ['人马四条腿', make({}, 4)],
  ] as const) {
    it(`${label}：跳起来、跑、蹲的姿势，每只脚的脚踝落到静止时的高度、脚底朝下；胸口以上的骨骼不转`, () => {
      useAnimeBody();
      const solver = makeSolver(buildSkeleton(buildFigure(spec)).bones);
      const { rig, limbs } = solver;
      const legs = limbs.filter((limb) => limb.kind === 'leg');
      for (const name of ['腾空', '冲刺', '蹲着', '走']) {
        const raw = POSE_LIBRARY.find((p) => p.name === name)!.posing;
        const start = stateOf(solver, fitLegs(raw, legPlan(spec).form, spec.counts.legs, rig));
        const after = plantFeet(solver, start);
        const f = forward(rig, after);
        for (const limb of legs) {
          const tag = `${label} ${name} ${limb.name}`;
          expect(f.pos[limb.end][1], tag).toBeCloseTo(rig.head[limb.end][1], 2);
          // 脚掌放平：脚这根骨头和静止时一样往下斜着（高低差不变）
          const way = sub(rig.tail[limb.end], rig.head[limb.end]);
          expect(rotate(f.rot[limb.end], way)[1], tag).toBeCloseTo(way[1], 3);
        }
        rig.names.forEach((bone, j) => {
          if (/^(Chest|UpperChest|Neck|Head|Shoulder|UpperArm|LowerArm|Hand)/.test(bone)) expect(after.local[j], `${label} ${name} ${bone}`).toEqual(start.local[j]);
        });
      }
    });
  }

  it('没有腿的身体原样返回', () => {
    useAnimeBody();
    const solver = makeSolver(buildSkeleton(buildFigure(make({}, 0))).bones);
    const start = stateOf(solver, POSE_LIBRARY[0].posing);
    expect(plantFeet(solver, start)).toBe(start);
  });
});
