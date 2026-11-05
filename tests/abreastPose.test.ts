// 横排多胯摆姿势：两副胯挨着的那条缝的蒙皮权重、里侧两条腿一起摆、抄权重时漏掉的顶点照周围补（总览重测找到的三处，见 docs/rework-plan.md）
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, quatEuler } from '../src/geometry/vec';
import { type BodySpec, defaultSpec } from '../src/model/spec';
import { fitLegs, innerLegs } from '../src/pose/fitLegs';
import { mirrorQuat } from '../src/pose/posing';
import { planSkin } from '../src/rig/skin';
import { buildSkeleton } from '../src/rig/skeleton';
import { fuseSkinned } from '../src/sdf/bindPose';
import { VOXEL } from '../src/sdf/fuse';
import { fillMissing } from '../src/sdf/posedFuse';
import { useAnimeBody } from './animeBody';

const DEG = Math.PI / 180;
const spec = (legs: number, legLayout: BodySpec['legLayout'], bodyStyle: BodySpec['bodyStyle'] = 'anime'): BodySpec => ({
  ...defaultSpec(),
  bodyStyle,
  legLayout,
  counts: { ...defaultSpec().counts, legs },
});
/** 一副只有大腿的骨架：名字、髋关节的 x */
const rig = (legs: [string, number][]) => ({ names: legs.map(([n]) => n), head: legs.map(([, x]) => [x, 0.9, 0] as [number, number, number]) });

describe('横排多胯里侧两条腿', () => {
  it('从 -X 往 +X 一条左腿后面紧跟着一条右腿的才算两副胯挨着；中间隔着正中那条腿的不算', () => {
    expect(innerLegs(rig([['UpperLeg_R.002', -0.2], ['UpperLeg_L.002', -0.06], ['UpperLeg_R', 0.06], ['UpperLeg_L', 0.2]]))).toEqual([['.002', '']]);
    // 平常两条腿、左右并排：右右左左，没有
    expect(innerLegs(rig([['UpperLeg_R', -0.09], ['UpperLeg_L', 0.09]]))).toEqual([]);
    expect(innerLegs(rig([['UpperLeg_R.002', -0.2], ['UpperLeg_R', -0.07], ['UpperLeg_L', 0.07], ['UpperLeg_L.002', 0.2]]))).toEqual([]);
    expect(innerLegs(rig([['UpperLeg_R.002', -0.3], ['UpperLeg_L.002', -0.15], ['UpperLeg.003', 0], ['UpperLeg_R', 0.15], ['UpperLeg_L', 0.3]]))).toEqual([]);
  });

  it('里侧两条一起照左右两条腿的平均摆：往前抬照旧，往两边张开的抵消；外侧两条照旧各照左腿、右腿', () => {
    const left: Quat = quatEuler(-40 * DEG, 0, 12 * DEG);
    const right = mirrorQuat(left);
    const posing = { version: 3 as const, bones: { UpperLeg_L: left, UpperLeg_R: right, LowerLeg_L: quatEuler(50 * DEG, 0, 0) } };
    const r = rig([['UpperLeg_R.002', -0.2], ['UpperLeg_L.002', -0.06], ['UpperLeg_R', 0.06], ['UpperLeg_L', 0.2]]);
    const out = fitLegs(posing, 'abreast', 4, r).bones;
    expect(out.UpperLeg_L).toEqual(left);
    expect(out['UpperLeg_R.002']).toEqual(right);
    const inner = out['UpperLeg_L.002'];
    expect(out.UpperLeg_R).toEqual(inner);
    // 左右对称的姿势：平均以后只剩绕 X 的（往前抬）
    expect(Math.abs(inner[1]) + Math.abs(inner[2])).toBeLessThan(1e-9);
    expect(Math.abs(inner[0])).toBeGreaterThan(0.2);
    // 只给了一边的（右小腿没转）：平均成转一半
    expect(out['LowerLeg_L.002']).toEqual(out.LowerLeg_R);
    expect(2 * Math.asin(Math.abs(out.LowerLeg_R[0])) / DEG).toBeCloseTo(25, 5);
    // 左右并排的照旧：左边的都照左腿
    const row = fitLegs(posing, 'row', 4, r).bones;
    expect(row['UpperLeg_L.002']).toEqual(left);
    expect(row.UpperLeg_R).toEqual(right);
  });
});

describe('横排多胯两副胯挨着的缝的蒙皮权重', () => {
  it('只有横排多胯才有这条缝：平常两条腿、左右并排、人马、蛛形都没有', () => {
    useAnimeBody();
    const seams = (s: BodySpec) => {
      const f = buildFigure(s);
      return planSkin(f, buildSkeleton(f), new Float32Array(0)).seams;
    };
    expect(seams(spec(4, 'abreast'))).toHaveLength(1);
    expect(seams(spec(4, 'abreast', 'mannequin'))).toHaveLength(1);
    expect(seams(spec(6, 'abreast'))).toHaveLength(2);
    // 五条腿：正中那副一条腿，两边各一副，中间隔着正中那条，没有挨着的
    expect(seams(spec(5, 'abreast'))).toHaveLength(0);
    for (const s of [spec(2, 'auto'), spec(4, 'row'), spec(4, 'auto'), spec(8, 'auto'), spec(6, 'humantaur')]) expect(seams(s), `${s.legLayout} ${s.counts.legs}`).toHaveLength(0);
  });

  it('二次元素体四条腿：缝上髋关节往下那一截跟着两条里侧的大腿，不跟胯（以前胯占六成，一坐下被拽成屁股底下一片皮）', () => {
    useAnimeBody();
    const s = spec(4, 'abreast');
    const f = buildFigure(s);
    const skeleton = buildSkeleton(f);
    const { mesh, skin } = fuseSkinned(f.parts, { voxel: VOXEL.preview, blend: s.blend });
    const hips = skeleton.bones.findIndex((b) => b.name === 'Hips');
    const joint = skeleton.bones.find((b) => b.name === 'UpperLeg_R')!.head[1];
    let n = 0;
    let share = 0;
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const [x, y] = [mesh.positions[v * 3], mesh.positions[v * 3 + 1]];
      if (Math.abs(x) > 0.015 || y > joint - 0.08 || y < joint - 0.22) continue;
      n++;
      for (let k = 0; k < 4; k++) if (skin.joints[v * 4 + k] === hips) share += skin.weights[v * 4 + k];
    }
    expect(n).toBeGreaterThan(20);
    expect(share / n).toBeLessThan(0.05);
  }, 60_000);
});

describe('照姿势融合时抄权重漏掉的顶点', () => {
  // 一圈六个点围着正中那个点
  const triangles = [1, 2, 3, 4, 5, 6].flatMap((i) => [0, i, (i % 6) + 1]);
  const still = 0;
  const mesh = (got: number[]) => {
    const joints = new Uint16Array(7 * 4).fill(still);
    const weights = new Float32Array(7 * 4);
    for (let v = 0; v < 7; v++) {
      if (got[v]) joints[v * 4] = v % 2 ? 5 : 6;
      weights[v * 4] = 1;
    }
    return { got: Uint8Array.from(got), joints, weights };
  };

  it('周围都抄到了：照周围平均', () => {
    const m = mesh([0, 1, 1, 1, 1, 1, 1]);
    fillMissing(triangles, 7, m.got, m.joints, m.weights, still);
    expect(m.got[0]).toBe(1);
    const w = new Map<number, number>();
    for (let k = 0; k < 4; k++) if (m.weights[k] > 0) w.set(m.joints[k], m.weights[k]);
    expect(w.get(5)).toBeCloseTo(0.5, 6);
    expect(w.get(6)).toBeCloseTo(0.5, 6);
  });

  it('周围大半都没抄到（手臂、躯干那种）：不补，还是跟着不动的那根', () => {
    const m = mesh([0, 1, 0, 0, 0, 0, 0]);
    fillMissing(triangles, 7, m.got, m.joints, m.weights, still);
    expect([...m.got]).toEqual([0, 1, 0, 0, 0, 0, 0]);
    expect(m.joints[0]).toBe(still);
    expect(m.weights[0]).toBe(1);
  });
});
