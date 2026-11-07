import { describe, expect, it } from 'vitest';
import { handMesh } from '../src/anime/hand';
import { BEND, bentHand } from '../src/anime/swap';
import { buildFigure } from '../src/geometry/layout';
import { humanoidMap } from '../src/io/vrm';
import { type BodySpec, defaultSpec, limbOf, normalizeSpec } from '../src/model/spec';
import { extraFingerTwin, fingerOf } from '../src/pose/fingers';
import { buildHandles } from '../src/pose/handles';
import { forward, restState } from '../src/pose/rig';
import { plantFeet } from '../src/pose/solve';
import { makeSolver } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { VOXEL } from '../src/sdf/fuse';
import { runJob } from '../src/sdf/job';
import { useAnimeBody } from './animeBody';

const specOf = (patch: Partial<BodySpec>): BodySpec => normalizeSpec({ ...defaultSpec(), ...patch });
const bonesOf = (s: BodySpec) => buildSkeleton(buildFigure(s)).bones.map((b) => b.name);

describe('手腕弯过去的手（anime/swap.ts 的 bentHand）', () => {
  it('切口那一圈不动，手指转到手背那边，手心朝外', () => {
    const base = handMesh();
    const { mesh, fingers, sole } = bentHand();
    expect(mesh.triangles).toBe(base.triangles);
    for (const v of base.loop) for (let k = 0; k < 3; k++) expect(mesh.positions[v * 3 + k]).toBeCloseTo(base.positions[v * 3 + k], 4);
    // 中指尖：本来在手腕外面 +X 很远，弯过去以后在手腕的 +Y（手背那边）
    const tip = fingers.find((f) => f.finger === 'Middle')!.joints[3];
    expect(tip[1] - base.end[1]).toBeGreaterThan(0.08);
    expect(Math.abs(tip[0] - base.end[0])).toBeLessThan(0.04);
    // 手心离手腕两三厘米（手掌的厚度）
    expect(sole).toBeGreaterThan(0.015);
    expect(sole).toBeLessThan(0.05);
    expect(BEND).toBeCloseTo(Math.PI / 2);
  });

  it('拇指收拢：和四指夹角不大', () => {
    const { fingers } = bentHand();
    const dir = (f: string) => {
      const j = fingers.find((x) => x.finger === f)!.joints;
      const d = [0, 1, 2].map((k) => j[3][k] - j[0][k]);
      const l = Math.hypot(d[0], d[1], d[2]);
      return d.map((v) => v / l);
    };
    const [a, b] = [dir('Thumb'), dir('Index')];
    expect(Math.acos(a[0] * b[0] + a[1] * b[1] + a[2] * b[2])).toBeLessThan(0.8);
  });
});

describe('设定', () => {
  it('默认手臂接手、腿接脚；乱写的回到默认', () => {
    expect(defaultSpec().armEnd).toBe('hand');
    expect(defaultSpec().legEnd).toBe('foot');
    const odd = normalizeSpec({ ...defaultSpec(), armEnd: 'paw', legEnd: 42 });
    expect([odd.armEnd, odd.legEnd]).toEqual(['hand', 'foot']);
  });
});

describe('手脚互换的骨骼', () => {
  for (const style of ['mannequin', 'anime'] as const) {
    it(`${style}：手臂接脚没有手指，腿接手有 LegThumb 这些、没有脚趾`, () => {
      if (style === 'anime') useAnimeBody();
      const names = bonesOf(specOf({ bodyStyle: style, armEnd: 'foot', legEnd: 'hand', fingers: 6 }));
      for (const name of ['Hand_L', 'Hand_R', 'Foot_L', 'Foot_R', 'LegThumb1_L', 'LegIndex3_R', 'LegFingerA2_L', 'LegLittle1_R']) expect(names).toContain(name);
      for (const name of ['Thumb1_L', 'Index1_R', 'Toes_L', 'Toes_R']) expect(names).not.toContain(name);
      // 长在中线上的腿（三条腿）：不分左右
      expect(bonesOf(specOf({ bodyStyle: style, legEnd: 'hand', counts: { ...defaultSpec().counts, legs: 3 } }))).toContain('LegThumb1');
    });
  }

  it('腿上的手指也认得是手指；多出来的那根跟着腿上的无名指', () => {
    expect(fingerOf('LegThumb2_L')).toEqual({ finger: 'Thumb', joint: 2 });
    expect(fingerOf('LegIndex1')).toEqual({ finger: 'Index', joint: 1 });
    expect(fingerOf('Index1')).toBeNull();
    expect(extraFingerTwin('LegFingerA1_R.002')).toBe('LegRing1_R.002');
    expect(extraFingerTwin('FingerB3_L')).toBe('Ring3_L');
  });

  it('摆姿势：腿上的手算作腿上的手（不进手势栏），指尖能拖；脚踩到地上时手心照样贴地', () => {
    const solver = makeSolver(buildSkeleton(buildFigure(specOf({ bodyStyle: 'mannequin', legEnd: 'hand' }))).bones);
    const legs = solver.hands.filter((h) => h.limb === 'leg');
    expect(legs.length).toBe(2);
    expect(solver.hands.filter((h) => h.limb === 'arm').length).toBe(2);
    const ids = new Set(buildHandles(solver).map((h) => h.id));
    for (const hand of legs) expect(ids.has(`${solver.rig.names[hand.fingers[1][2]]}:tip`)).toBe(true);
    // 静止的样子踩一下地：脚踝（手腕）还在原来的高度
    const { rig } = solver;
    const rest = restState(rig);
    const planted = forward(rig, plantFeet(solver, rest));
    for (const hand of legs) expect(planted.pos[hand.bone][1]).toBeCloseTo(rig.head[hand.bone][1], 3);
  });

  it('导出 VRM：手臂上的手、腿上的脚照常对上，腿上的手指不进对照表', () => {
    const sk = buildSkeleton(buildFigure(specOf({ bodyStyle: 'mannequin', armEnd: 'foot', legEnd: 'hand' })));
    const map = humanoidMap(sk);
    for (const slot of ['leftHand', 'rightHand', 'leftFoot', 'rightFoot']) expect(map.has(slot)).toBe(true);
    for (const slot of ['leftThumbProximal', 'leftToes']) expect(map.has(slot)).toBe(false);
    expect([...map.values()].some((i) => sk.bones[i].name.startsWith('Leg'))).toBe(false);
  });
});

describe('手脚互换融合出来的网格', () => {
  const cases: [string, Partial<BodySpec>][] = [
    ['白模 手臂接脚', { bodyStyle: 'mannequin', armEnd: 'foot' }],
    ['白模 腿接手（分指）', { bodyStyle: 'mannequin', legEnd: 'hand' }],
    ['白模 都换（并指）', { bodyStyle: 'mannequin', hands: 'mitten', armEnd: 'foot', legEnd: 'hand' }],
    ['素体 都换', { bodyStyle: 'anime', armEnd: 'foot', legEnd: 'hand', fingers: 4, toes: 6 }],
  ];
  for (const [label, patch] of cases) {
    it(`${label}：一整块，手心、脚底贴着地，身高照设定`, () => {
      if (patch.bodyStyle === 'anime') useAnimeBody();
      const spec = specOf(patch);
      const figure = buildFigure(spec);
      const { mesh } = runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: spec.blend });
      expect(mesh.info.components).toBe(1);
      let low = Infinity;
      for (let i = 1; i < mesh.positions.length; i += 3) low = Math.min(low, mesh.positions[i] * figure.scale);
      expect(Math.abs(low)).toBeLessThan(0.004);
      expect(figure.metrics.height).toBeCloseTo(spec.shape.height, 2);
    });
  }
});

describe('每条手臂、腿单独设（BodySpec.perLimb）', () => {
  it('读存档：只留手臂、腿的名字，数夹到范围里，空的去掉；没设的跟着统一的', () => {
    const s = normalizeSpec({ ...defaultSpec(), fingers: 6, perLimb: { Arm_01_L: { end: 'foot', fingers: 99 }, Head_01: { end: 'foot' }, Leg_01: { toes: 3 }, Leg_02_R: { end: 'paw' } } });
    expect(s.perLimb).toEqual({ Arm_01_L: { end: 'foot', fingers: 8 }, Leg_01: { toes: 3 } });
    expect(limbOf(s, 'Arm_01_L')).toEqual({ end: 'foot', fingers: 8, toes: 5 });
    expect(limbOf(s, 'Arm_01_R')).toEqual({ end: 'hand', fingers: 6, toes: 5 });
    expect(limbOf(s, 'Leg_01_L').end).toBe('foot');
  });

  for (const style of ['mannequin', 'anime'] as const) {
    it(`${style}：只有设过的那一条换了，别的照统一的`, () => {
      if (style === 'anime') useAnimeBody();
      const spec = specOf({ bodyStyle: style, perLimb: { Arm_01_L: { end: 'foot' }, Arm_01_R: { fingers: 7 }, Leg_01_R: { end: 'hand', fingers: 4 } } });
      const parts = buildFigure(spec).parts;
      const bones = (name: string) => parts.find((p) => p.name === name)!.bones!.map((b) => b.name);
      expect(bones('Arm_01_L')).not.toContain('Thumb1_L');
      expect(bones('Arm_01_R')).toContain('FingerB1_R');
      expect(bones('Leg_01_L')).toContain('Toes_L');
      expect(bones('Leg_01_R')).toContain('LegLittle3_R');
      expect(bones('Leg_01_R')).not.toContain('LegRing1_R');
      expect(bones('Leg_01_R')).not.toContain('Toes_R');
    });

    it(`${style}：腿有手有脚时整个人不往下落，接手的那条拉长到手心贴地`, () => {
      if (style === 'anime') useAnimeBody();
      const plain = buildFigure(specOf({ bodyStyle: style }));
      // 两种都是左腿接手、右腿接脚：一种是统一接脚、左腿单独设手，一种是统一接手、右腿单独设脚
      const patches: Partial<BodySpec>[] = [{ perLimb: { Leg_01_L: { end: 'hand' } } }, { legEnd: 'hand', perLimb: { Leg_01_R: { end: 'foot' } } }];
      for (const patch of patches) {
        const spec = specOf({ bodyStyle: style, ...patch });
        const figure = buildFigure(spec);
        expect(figure.parts.find((p) => p.name === 'Torso')!.pos).toEqual(plain.parts.find((p) => p.name === 'Torso')!.pos);
        const { mesh } = runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: spec.blend });
        expect(mesh.info.components).toBe(1);
        let low = Infinity;
        for (let i = 1; i < mesh.positions.length; i += 3) low = Math.min(low, mesh.positions[i] * figure.scale);
        expect(Math.abs(low)).toBeLessThan(0.004);
        // 接手的那条：手腕（脚那根骨骼的头）比接脚的那条的脚踝低（拉长了）
        const sk = buildSkeleton(figure).bones;
        const ankle = (name: string) => sk.find((b) => b.name === name)!.head[1];
        expect(ankle('Foot_L')).toBeLessThan(ankle('Foot_R') - 0.02);
      }
    });
  }

  it('两个上半身：照最后的部件名单独设（右边那个上半身的手臂改过名）', () => {
    useAnimeBody();
    const spec = specOf({ bodyStyle: 'anime', counts: { ...defaultSpec().counts, torsos: 2 }, perLimb: { Arm_02_L: { fingers: 3 } } });
    const parts = buildFigure(spec).parts;
    const bones = (name: string) => parts.find((p) => p.name === name)!.bones!.map((b) => b.name);
    expect(bones('Arm_02_L').some((b) => b.startsWith('Middle'))).toBe(false);
    expect(bones('Arm_01_L').some((b) => b.startsWith('Middle'))).toBe(true);
  });
});
