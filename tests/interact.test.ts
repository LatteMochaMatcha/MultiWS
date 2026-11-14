import { describe, expect, it } from 'vitest';
import { len, sub } from '../src/geometry/vec';
import { buildFigure } from '../src/geometry/layout';
import { defaultSpec } from '../src/model/spec';
import { POSE_LIBRARY } from '../src/pose/library';
import { forward, posedBones } from '../src/pose/rig';
import { makeSolver, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import {
  PAIR_PRESETS,
  capsulesOf,
  findClashes,
  fromScene,
  heightOf,
  placeCapsules,
  pushOut,
  segmentDistance,
  solvePair,
  toScene,
} from '../src/scene/interact';

const human = () => buildSkeleton(buildFigure({ ...defaultSpec(), counts: { ...defaultSpec().counts, heads: 1, armPairs: 1, breasts: 2 } })).bones;
const base = (name: string) => POSE_LIBRARY.find((p) => p.name === name)!.posing;

describe('角色之间：胶囊体近似', () => {
  it('线段距离：平行、交叉、端点', () => {
    expect(segmentDistance([0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0])).toBeCloseTo(1);
    expect(segmentDistance([0, 0, 0], [1, 0, 0], [0.5, -1, 0.3], [0.5, 1, 0.3])).toBeCloseTo(0.3);
    expect(segmentDistance([0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0])).toBeCloseTo(1);
  });

  it('场景坐标和角色自己的坐标来回换', () => {
    const place = { x: 1.2, z: -0.4, yaw: 63 };
    const p: [number, number, number] = [0.3, 1.1, -0.2];
    const back = fromScene(place, toScene(place, p));
    expect(back[0]).toBeCloseTo(p[0]);
    expect(back[1]).toBeCloseTo(p[1]);
    expect(back[2]).toBeCloseTo(p[2]);
  });

  it('两个人站得开就没有穿插，挤在一起有，提示里说得出哪两块', () => {
    const bones = human();
    const caps = capsulesOf(bones, heightOf(bones));
    expect(caps.some((c) => c.part === 'armL')).toBe(true);
    expect(caps.some((c) => c.part === 'torso')).toBe(true);
    const far = findClashes(placeCapsules(caps, { x: 0, z: 0, yaw: 0 }), placeCapsules(caps, { x: 2, z: 0, yaw: 0 }));
    expect(far).toEqual([]);
    const near = findClashes(placeCapsules(caps, { x: 0, z: 0, yaw: 0 }), placeCapsules(caps, { x: 0.2, z: 0.05, yaw: -20 }));
    expect(near.length).toBeGreaterThan(0);
    expect(near[0].depth).toBeGreaterThan(0.05);
    expect(near.some((c) => c.mine === 'torso' && c.theirs === 'torso')).toBe(true);
  });

  it('点推到身体表面以外', () => {
    const bones = human();
    const caps = capsulesOf(bones, heightOf(bones));
    const inside: [number, number, number] = [0, 1.1, 0];
    const out = pushOut(inside, caps, 0.02);
    for (const c of caps) expect(segmentDistance(out, out, c.a, c.b)).toBeGreaterThanOrEqual(c.r + 0.02 - 1e-6);
    // 本来就在外面的不动
    const free: [number, number, number] = [1, 1, 1];
    expect(pushOut(free, caps, 0.02)).toEqual(free);
  });
});

describe('双人动作', () => {
  const side = (place: { x: number; z: number; yaw: number }, name: string | null) => ({ bones: human(), place, base: name ? base(name) : null });
  const handAt = (bones: ReturnType<typeof human>, posing: Parameters<typeof stateOf>[1], place: { x: number; z: number; yaw: number }, hand: string) => {
    const s = makeSolver(bones);
    const f = forward(s.rig, stateOf(s, posing));
    return toScene(place, f.pos[s.rig.names.indexOf(hand)]);
  };

  it('每个双人动作的底子姿势都在现成姿势里', () => {
    for (const p of PAIR_PRESETS) {
      for (const name of [p.base.A, p.base.B]) if (name) expect(POSE_LIBRARY.some((x) => x.name === name)).toBe(true);
    }
  });

  it('手拉手：B 站到 A 的左手边，两只手碰在一起，A 不挪', () => {
    const preset = PAIR_PRESETS.find((p) => p.key === 'hands')!;
    const A = side({ x: 0.5, z: 0, yaw: 30 }, '自然站立');
    const B = side({ x: 5, z: 5, yaw: 0 }, null);
    const r = solvePair(preset, A, B);
    expect(r.missed).toBe(0);
    // B 在 A 自己的 +X（她的左手边）
    const rel = fromScene(A.place, [r.placeB.x, 0, r.placeB.z]);
    expect(rel[0]).toBeGreaterThan(0.4);
    expect(Math.abs(rel[2])).toBeLessThan(0.01);
    const a = handAt(A.bones, r.posing.A, A.place, 'Hand_L');
    const b = handAt(B.bones, r.posing.B, r.placeB, 'Hand_R');
    expect(len(sub(a, b))).toBeLessThan(0.1);
  });

  it('击掌：面对面，手举过肩', () => {
    const preset = PAIR_PRESETS.find((p) => p.key === 'five')!;
    const A = side({ x: 0, z: 0, yaw: 0 }, '自然站立');
    const r = solvePair(preset, A, side({ x: 0, z: 0, yaw: 0 }, null));
    expect(r.placeB.yaw).toBe(180);
    const a = handAt(A.bones, r.posing.A, A.place, 'Hand_R');
    expect(a[1]).toBeGreaterThan(1.3);
  });

  it('每个双人动作都摆得出来：两人之间躯干不穿插', () => {
    for (const preset of PAIR_PRESETS) {
      const A = side({ x: 0, z: 0, yaw: 0 }, null);
      const B = side({ x: 3, z: 0, yaw: 0 }, null);
      const r = solvePair(preset, { ...A, base: preset.base.A ? base(preset.base.A) : null }, { ...B, base: preset.base.B ? base(preset.base.B) : null });
      const posed = (who: 'A' | 'B') => {
        const s = makeSolver(A.bones);
        const f = forward(s.rig, stateOf(s, r.posing[who]));
        return placeCapsules(
          capsulesOf(
            posedBones(s.rig, f),
            heightOf(A.bones),
          ).filter((c) => c.part === 'torso'),
          who === 'A' ? A.place : r.placeB,
        );
      };
      const torsoClash = findClashes(posed('A'), posed('B'), 0.05);
      expect(torsoClash, preset.key).toEqual([]);
    }
  });

  it('刚打开时的体型（两个头、两对手臂）摆每个双人动作：拉开到整个人都不穿插，也都够得着', () => {
    const wide = buildSkeleton(buildFigure({ ...defaultSpec(), counts: { ...defaultSpec().counts, heads: 2, armPairs: 2, breasts: 4 } })).bones;
    const posedAll = (posing: Parameters<typeof stateOf>[1], place: { x: number; z: number; yaw: number }) => {
      const s = makeSolver(wide);
      const f = forward(s.rig, stateOf(s, posing));
      return placeCapsules(
        capsulesOf(posedBones(s.rig, f), heightOf(wide)),
        place,
      );
    };
    for (const preset of PAIR_PRESETS) {
      const A = { bones: wide, place: { x: 0, z: 0, yaw: 0 }, base: preset.base.A ? base(preset.base.A) : null };
      const B = { bones: wide, place: { x: 3, z: 0, yaw: 0 }, base: preset.base.B ? base(preset.base.B) : null };
      const r = solvePair(preset, A, B);
      expect(r.missed, preset.key).toBe(0);
      expect(findClashes(posedAll(r.posing.A, A.place), posedAll(r.posing.B, r.placeB)), preset.key).toEqual([]);
    }
  });
});
