import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { findClashes } from '../src/geometry/clash';
import { type Cone, type Ellipsoid, type Figure, type Part, shapeMatrix, worldTransforms } from '../src/geometry/figure';
import { buildFigure, layoutFigure } from '../src/geometry/layout';
import { buildPartGeometry } from '../src/geometry/partsMesh';
import { applyOverrides, partFrame } from '../src/geometry/tweak';
import {
  type Quat,
  type V3,
  add,
  eulerOf,
  len,
  mat3Apply,
  mul,
  norm,
  quatConj,
  quatEuler,
  quatMul,
  rotate,
  scaleAlong,
  sub,
} from '../src/geometry/vec';
import { clearAllOverrides, clearOverride, mirrorName, mirrorOverride, setOverride } from '../src/model/overrides';
import { partLabel } from '../src/model/partLabel';
import { type BodyCounts, type BodySpec, type PartOverride, cleanOverride, defaultSpec } from '../src/model/spec';
import { compilePartField, fieldAt } from '../src/sdf/field';
import { makePicker } from '../src/sdf/pick';
import { rng } from './helpers';

const DEG = Math.PI / 180;

const make = (counts: Partial<BodyCounts> = {}, overrides: Record<string, PartOverride> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, counts: { ...base.counts, ...counts }, overrides };
};
const partOf = (figure: Figure, name: string): Part => {
  const part = figure.parts.find((p) => p.name === name);
  if (!part) throw new Error(`没有部件 ${name}`);
  return part;
};
const primOf = <T extends Cone | Ellipsoid>(part: Part, name: string) => part.prims.find((p) => p.name === name) as T;
/** 部件局部坐标里的一个点在世界里的位置（不算 stretch / resize） */
const toWorld = (figure: Figure, name: string, local: V3): V3 => {
  const xf = worldTransforms(figure).get(name)!;
  return add(xf.pos, mul(rotate(xf.quat, local), xf.scale));
};
const expectV3 = (got: V3, want: V3, digits = 9) => {
  for (let k = 0; k < 3; k++) expect(got[k], `分量 ${k}`).toBeCloseTo(want[k], digits);
};

describe('向量工具', () => {
  it('eulerOf 是 quatEuler 的逆运算', () => {
    const random = rng(7);
    for (let i = 0; i < 200; i++) {
      const e: V3 = [(random() - 0.5) * 6, (random() - 0.5) * 3, (random() - 0.5) * 6];
      expectV3(eulerOf(quatEuler(e[0], e[1], e[2])), e, 8);
    }
  });

  it('绕 Y 正好转 90° 时也给得出一组等价的角度', () => {
    const q = quatEuler(0.4, Math.PI / 2, 0.3);
    const e = eulerOf(q);
    const back = quatEuler(e[0], e[1], e[2]);
    const p: V3 = [0.3, -0.2, 0.9];
    expectV3(rotate(back, p), rotate(q, p), 6);
  });

  it('quatConj 把旋转转回去', () => {
    const q = quatEuler(0.3, -0.8, 1.1);
    expectV3(rotate(quatConj(q), rotate(q, [1, 2, 3])), [1, 2, 3]);
  });

  it('scaleAlong：沿转过的那组轴各自缩放', () => {
    const frame = quatEuler(0, 0, 30 * DEG);
    const m = scaleAlong([2, 3, 0.5], frame);
    const x = rotate(frame, [1, 0, 0]);
    const y = rotate(frame, [0, 1, 0]);
    expectV3(mat3Apply(m, x), mul(x, 2));
    expectV3(mat3Apply(m, y), mul(y, 3));
    expectV3(mat3Apply(m, [0, 0, 1]), [0, 0, 0.5]);
    expectV3(mat3Apply(scaleAlong([2, 3, 0.5]), [1, 1, 1]), [2, 3, 0.5]);
  });
});

describe('微调的数据', () => {
  it('cleanOverride：收进范围、去掉多余的小数、丢掉等于没改的分量', () => {
    expect(cleanOverride({ position: [0.123456, -5, 0], rotation: [0, 400, -0.004], scale: [19, 0.001, 1.23456] })).toEqual({
      position: [0.1235, -3, 0],
      rotation: [0, 180, 0],
      scale: [10, 0.05, 1.235],
    });
    expect(cleanOverride({ position: [0, 0, 0], rotation: [0, 0, 30], scale: [1, 1, 1] })).toEqual({ rotation: [0, 0, 30] });
    expect(cleanOverride({ position: [0.00001, 0, -0.00002], scale: [1.0001, 1, 1] })).toBeNull();
    expect(cleanOverride({})).toBeNull();
    // 不留下 -0
    expect(Object.is(cleanOverride({ position: [-0.00001, 0.1, 0] })!.position![0], 0)).toBe(true);
  });

  it('mirrorName：左右成对的部件才有对侧', () => {
    expect(mirrorName('Arm_02_L')).toBe('Arm_02_R');
    expect(mirrorName('Head_01_Horn_01_R')).toBe('Head_01_Horn_01_L');
    expect(mirrorName('Head_01')).toBeNull();
    expect(mirrorName('Tail_03')).toBeNull();
    expect(mirrorName('Head_01_Eye_C')).toBeNull();
    expect(mirrorName('Torso')).toBeNull();
  });

  it('mirrorOverride：左右的偏移和绕 Y、Z 的转动反过来', () => {
    expect(mirrorOverride({ position: [0.1, 0.2, 0.3], rotation: [10, 20, 30], scale: [1, 2, 3] })).toEqual({
      position: [-0.1, 0.2, 0.3],
      rotation: [10, -20, -30],
      scale: [1, 2, 3],
    });
    expect(mirrorOverride({ rotation: [5, 0, 0] })).toEqual({ rotation: [5, 0, 0] });
  });

  it('setOverride：只替换给了的分量，改回原样就整条删掉', () => {
    let spec = setOverride(defaultSpec(), 'Tail_01', { rotation: [0, 30, 0] });
    spec = setOverride(spec, 'Tail_01', { scale: [1.2, 1.2, 1.2] });
    expect(spec.overrides).toEqual({ Tail_01: { rotation: [0, 30, 0], scale: [1.2, 1.2, 1.2] } });
    spec = setOverride(spec, 'Tail_01', { rotation: [0, 0, 0] });
    expect(spec.overrides).toEqual({ Tail_01: { scale: [1.2, 1.2, 1.2] } });
    spec = setOverride(spec, 'Tail_01', { scale: [1, 1, 1] });
    expect(spec.overrides).toEqual({});
  });

  it('setOverride 不改动传进来的 spec', () => {
    const before = setOverride(defaultSpec(), 'Tail_01', { rotation: [0, 30, 0] });
    const copy = JSON.parse(JSON.stringify(before));
    setOverride(before, 'Tail_01', { rotation: [0, 60, 0] });
    setOverride(before, 'Arm_01_L', { position: [0.1, 0, 0] }, true);
    clearOverride(before, 'Tail_01');
    expect(before).toEqual(copy);
  });

  it('对称：对侧同时改成镜像的样子；还原时一起还原', () => {
    let spec = setOverride(defaultSpec(), 'Arm_01_L', { position: [0.05, 0.02, 0], rotation: [10, 20, 30] }, true);
    expect(spec.overrides).toEqual({
      Arm_01_L: { position: [0.05, 0.02, 0], rotation: [10, 20, 30] },
      Arm_01_R: { position: [-0.05, 0.02, 0], rotation: [10, -20, -30] },
    });
    // 不成对的部件开着对称也只改自己
    spec = setOverride(spec, 'Head_01', { scale: [1.1, 1.1, 1.1] }, true);
    expect(Object.keys(spec.overrides).sort()).toEqual(['Arm_01_L', 'Arm_01_R', 'Head_01']);
    // 关掉对称：只改这一侧
    spec = setOverride(spec, 'Arm_01_R', { rotation: [0, 0, 5] });
    expect(spec.overrides.Arm_01_L.rotation).toEqual([10, 20, 30]);
    expect(spec.overrides.Arm_01_R.rotation).toEqual([0, 0, 5]);
    spec = clearOverride(spec, 'Arm_01_L', true);
    expect(Object.keys(spec.overrides)).toEqual(['Head_01']);
    expect(clearAllOverrides(spec).overrides).toEqual({});
    const clean = defaultSpec();
    expect(clearAllOverrides(clean)).toBe(clean);
  });

  it('部件的中文名字', () => {
    expect(partLabel('Torso')).toBe('躯干');
    expect(partLabel('Arm_02_L')).toBe('手臂 2 左');
    expect(partLabel('Head_02_Horn_01_R')).toBe('头 2 · 角 1 右');
    expect(partLabel('Head_01_Eye_C')).toBe('头 1 · 眼睛 中');
    expect(partLabel('Head_01_Ear_02_L')).toBe('头 1 · 耳朵 2 左');
    expect(partLabel('Tail_09')).toBe('尾巴 9');
    expect(partLabel('Neck_03')).toBe('脖子 3');
    expect(partLabel('LowerBody')).toBe('下身');
    expect(partLabel('Abdomen')).toBe('蛛形腹部');
    expect(partLabel('Something_Else')).toBe('Something_Else');
  });

  it('每个部件都有中文名字', () => {
    const figure = buildFigure(
      make({ heads: 2, armPairs: 2, breasts: 4, legs: 6, tails: 2, wingPairs: 1, hornsPerHead: 3, eyesPerHead: 3, earPairsPerHead: 1 }),
    );
    for (const part of figure.parts) expect(partLabel(part.name), part.name).toMatch(/^[一-鿿]/);
  });
});

describe('套用微调', () => {
  it('没有微调、或者微调的部件现在不存在：原样返回', () => {
    const figure = layoutFigure(make());
    expect(applyOverrides(figure, {})).toBe(figure);
    expect(applyOverrides(figure, { Arm_04_L: { position: [0.1, 0, 0] }, Nope: { scale: [2, 2, 2] } })).toBe(figure);
    expect(buildFigure(make())).toEqual(figure);
  });

  it('位置：部件沿父部件的轴挪动，单位跟着身高缩放', () => {
    const t: V3 = [0.05, 0.02, -0.03];
    const before = buildFigure(make());
    const after = buildFigure(make({}, { Arm_01_L: { position: t } }));
    expectV3(sub(toWorld(after, 'Arm_01_L', [0, 0, 0]), toWorld(before, 'Arm_01_L', [0, 0, 0])), mul(t, before.scale));
    // 别的部件不动
    expect(partOf(after, 'Arm_01_R')).toEqual(partOf(before, 'Arm_01_R'));
    expect(partOf(after, 'Torso')).toEqual(partOf(before, 'Torso'));
  });

  it('长在头上的部件沿头自己的轴挪动（头是歪的时候也一样）', () => {
    const t: V3 = [0, 0.03, 0];
    const counts = { heads: 2, hornsPerHead: 2 };
    const before = buildFigure(make(counts));
    const after = buildFigure(make(counts, { Head_01_Horn_01_L: { position: t } }));
    const head = worldTransforms(before).get('Head_01')!;
    const moved = sub(toWorld(after, 'Head_01_Horn_01_L', [0, 0, 0]), toWorld(before, 'Head_01_Horn_01_L', [0, 0, 0]));
    expectV3(moved, mul(rotate(head.quat, t), head.scale));
    // 头是歪的：这个方向不是世界的正上方
    expect(Math.abs(moved[0])).toBeGreaterThan(0.002);
  });

  it('角度：绕着关节转，关节留在原地', () => {
    const before = buildFigure(make());
    const after = buildFigure(make({}, { Arm_01_L: { rotation: [0, 0, 30] } }));
    const wrist = primOf<Cone>(partOf(before, 'Arm_01_L'), 'Forearm').b;
    expectV3(toWorld(after, 'Arm_01_L', [0, 0, 0]), toWorld(before, 'Arm_01_L', [0, 0, 0]));
    const shoulder = toWorld(before, 'Arm_01_L', [0, 0, 0]);
    const want = add(shoulder, mul(rotate(quatEuler(0, 0, 30 * DEG), wrist), before.scale));
    expectV3(toWorld(after, 'Arm_01_L', wrist), want);
    // 左臂绕 Z 轴正转是往外抬
    expect(toWorld(after, 'Arm_01_L', wrist)[1]).toBeGreaterThan(toWorld(before, 'Arm_01_L', wrist)[1] + 0.05);
  });

  it('躯干绕骨盆转：骨盆不动，头、手臂跟着走，腿不动', () => {
    const before = buildFigure(make());
    const after = buildFigure(make({}, { Torso: { rotation: [20, 0, 0], scale: [1.1, 1.1, 1.1] } }));
    const pivot = partOf(before, 'Torso').pivot!;
    expect(pivot[1]).toBeGreaterThan(0.9);
    expectV3(toWorld(after, 'Torso', partOf(after, 'Torso').pivot!), toWorld(before, 'Torso', pivot));
    // 绕 X 轴正转是往前倾
    const head0 = toWorld(before, 'Head_01', [0, 0, 0]);
    const head1 = toWorld(after, 'Head_01', [0, 0, 0]);
    expect(head1[2]).toBeGreaterThan(head0[2] + 0.15);
    expect(toWorld(after, 'Arm_01_L', [0, 0, 0])[2]).toBeGreaterThan(toWorld(before, 'Arm_01_L', [0, 0, 0])[2] + 0.1);
    expect(partOf(after, 'Leg_01_L')).toEqual(partOf(before, 'Leg_01_L'));
    // 手臂跟着躯干一起放大
    expect(worldTransforms(after).get('Arm_01_L')!.scale).toBeCloseTo(before.scale * 1.1, 9);
  });

  it('等比缩放：部件和它的子部件一起变大，不产生各轴拉伸', () => {
    const counts = { hornsPerHead: 2 };
    const before = buildFigure(make(counts));
    const after = buildFigure(make(counts, { Head_01: { scale: [1.2, 1.2, 1.2] } }));
    const head0 = partOf(before, 'Head_01');
    const head1 = partOf(after, 'Head_01');
    expect(head1.scale).toBeCloseTo(head0.scale! * 1.2, 9);
    expect(head1.resize).toBeUndefined();
    const center = toWorld(before, 'Head_01', [0, 0, 0]);
    expectV3(toWorld(after, 'Head_01', [0, 0, 0]), center);
    const horn0 = sub(toWorld(before, 'Head_01_Horn_01_L', [0, 0, 0]), center);
    const horn1 = sub(toWorld(after, 'Head_01_Horn_01_L', [0, 0, 0]), center);
    expectV3(horn1, mul(horn0, 1.2));
    expect(worldTransforms(after).get('Head_01_Horn_01_L')!.scale).toBeCloseTo(worldTransforms(before).get('Head_01_Horn_01_L')!.scale * 1.2, 9);
  });

  it('各轴缩放：共同的那一份是等比缩放，剩下的只拉伸自己；子部件跟着挪位置', () => {
    const before = buildFigure(make());
    const after = buildFigure(make({}, { Head_01: { scale: [1.3, 1, 1] } }));
    const head0 = partOf(before, 'Head_01');
    const head1 = partOf(after, 'Head_01');
    const u = Math.cbrt(1.3);
    expect(head1.scale).toBeCloseTo(head0.scale! * u, 9);
    expectV3(head1.resize!, [1.3 / u, 1 / u, 1 / u]);
    expect(head1.resize![0] * head1.resize![1] * head1.resize![2]).toBeCloseTo(1, 9);
    // 合起来正好是要的倍率：头宽了 1.3 倍，高和厚不变
    const m = shapeMatrix(head1)!;
    expectV3(mul(mat3Apply(m, [1, 1, 1]), head1.scale! / head0.scale!), [1.3, 1, 1]);
    // 眼睛离头中心的左右距离变成 1.3 倍，高度不变
    const eye0 = partOf(before, 'Head_01_Eye_01_L').pos;
    const eye1 = partOf(after, 'Head_01_Eye_01_L').pos;
    expectV3(mul(eye1, head1.scale!), mul([eye0[0] * 1.3, eye0[1], eye0[2]], head0.scale!));
  });

  it('手臂的「长」沿着手臂的方向：只拉长不变粗', () => {
    for (const pose of ['A', 'T'] as const) {
      const base = { ...make(), pose };
      const before = buildFigure(base);
      const after = buildFigure({ ...base, overrides: { Arm_01_L: { scale: [1, 1.5, 1] } } });
      const arm0 = partOf(before, 'Arm_01_L');
      const arm1 = partOf(after, 'Arm_01_L');
      const elbow = primOf<Cone>(arm0, 'UpperArm').b;
      const m = shapeMatrix(arm1)!;
      // 肘在上臂的延长线上：正好远了 1.5 倍
      expectV3(mul(mat3Apply(m, elbow), arm1.scale!), mul(elbow, 1.5));
      // 垂直于手臂的方向（粗细）不变
      const dir = norm(elbow);
      const side = norm([dir[1], -dir[0], 0]);
      expectV3(mul(mat3Apply(m, side), arm1.scale!), side);
    }
  });

  it('头挪了位置，脖子跟着伸过去', () => {
    const before = buildFigure(make());
    const after = buildFigure(make({}, { Head_01: { position: [0.05, 0.06, 0.02] } }));
    const neck0 = primOf<Cone>(partOf(before, 'Neck_01'), 'Neck');
    const neck1 = primOf<Cone>(partOf(after, 'Neck_01'), 'Neck');
    expect(len(neck1.b)).toBeGreaterThan(len(neck0.b) + 0.01);
    // 脖子指向头的新位置
    const toHead = sub(partOf(after, 'Head_01').pos, partOf(after, 'Neck_01').pos);
    expectV3(norm(neck1.b), norm(toHead));
    // 脖子末端到头中心的距离不变：照旧插在头的底下
    const toHead0 = sub(partOf(before, 'Head_01').pos, partOf(before, 'Neck_01').pos);
    expect(len(toHead) - len(neck1.b)).toBeCloseTo(len(toHead0) - len(neck0.b), 9);
    // 头抬得再高，脖子也够得着
    const high = buildFigure(make({}, { Head_01: { position: [0, 0.4, 0] } }));
    const neck2 = primOf<Cone>(partOf(high, 'Neck_01'), 'Neck');
    const toHead2 = sub(partOf(high, 'Head_01').pos, partOf(high, 'Neck_01').pos);
    expect(len(toHead2) - len(neck2.b)).toBeCloseTo(len(toHead0) - len(neck0.b), 9);
    // 头压进肩膀里时，脖子缩成一小截，不会翻到反方向去
    const sunk = buildFigure(make({}, { Head_01: { position: [0, -0.15, 0] } }));
    const neck3 = primOf<Cone>(partOf(sunk, 'Neck_01'), 'Neck');
    expect(len(neck3.b)).toBeCloseTo(0.02, 9);
    expect(neck3.b[1]).toBeGreaterThan(0);
    // 只转头、不挪位置时脖子不变
    const turned = buildFigure(make({}, { Head_01: { rotation: [0, 30, 0] } }));
    expect(partOf(turned, 'Neck_01')).toEqual(partOf(before, 'Neck_01'));
  });

  it('眼睛挪了位置、改了大小，眼窝跟着变', () => {
    const before = buildFigure(make());
    const after = buildFigure(make({}, { Head_01_Eye_01_L: { position: [0.004, 0.01, 0], scale: [1.5, 1.5, 1.5] } }));
    const socket0 = primOf<Ellipsoid>(partOf(before, 'Head_01'), 'Socket_01_L');
    const socket1 = primOf<Ellipsoid>(partOf(after, 'Head_01'), 'Socket_01_L');
    expectV3(sub(socket1.center, socket0.center), [0.004, 0.01, 0]);
    expectV3(socket1.radii, mul(socket0.radii, 1.5));
    expect(primOf<Ellipsoid>(partOf(after, 'Head_01'), 'Socket_01_R')).toEqual(primOf<Ellipsoid>(partOf(before, 'Head_01'), 'Socket_01_R'));
    expectV3(sub(partOf(after, 'Head_01_Eye_01_L').pos, partOf(before, 'Head_01_Eye_01_L').pos), [0.004, 0.01, 0]);
  });

  it('对称的微调得到左右对称的结果', () => {
    const spec = setOverride(
      make({ armPairs: 2, wingPairs: 1 }),
      'Arm_02_L',
      { position: [0.03, -0.02, 0.04], rotation: [15, 25, 35], scale: [1.1, 1.3, 0.9] },
      true,
    );
    const figure = buildFigure(setOverride(spec, 'Wing_01_R', { rotation: [0, -20, 10] }, true));
    const flip = (p: V3): V3 => [-p[0], p[1], p[2]];
    for (const [l, r, prim] of [['Arm_02_L', 'Arm_02_R', 'Forearm']] as const) {
      const a = partOf(figure, l);
      const b = partOf(figure, r);
      const ma = shapeMatrix(a)!;
      const mb = shapeMatrix(b)!;
      for (const end of ['a', 'b'] as const) {
        const pa = toWorld(figure, l, mat3Apply(ma, primOf<Cone>(a, prim)[end]));
        const pb = toWorld(figure, r, mat3Apply(mb, primOf<Cone>(b, prim)[end]));
        expectV3(pb, flip(pa), 9);
      }
    }
    const wingL = worldTransforms(figure).get('Wing_01_L')!;
    const wingR = worldTransforms(figure).get('Wing_01_R')!;
    expectV3(wingR.pos, flip(wingL.pos));
    expectV3(rotate(wingR.quat, [-1, 0.3, 0.2]), flip(rotate(wingL.quat, [1, 0.3, 0.2])));
  });

  it('身高和头身比按微调以后的样子重新量', () => {
    const base = buildFigure(make());
    const raised = buildFigure(make({}, { Head_01: { position: [0, 0.1, 0] } }));
    expect(raised.metrics.height).toBeCloseTo(base.metrics.height + 0.1 * base.scale, 6);
    expect(raised.metrics.headHeight).toBeCloseTo(base.metrics.headHeight, 9);
    const bigger = buildFigure(make({}, { Head_01: { scale: [1.2, 1.2, 1.2] } }));
    expect(bigger.metrics.headHeight).toBeCloseTo(base.metrics.headHeight * 1.2, 6);
    expect(bigger.metrics.headRatio).toBeLessThan(base.metrics.headRatio);
    // 和头无关的微调不影响读数
    const tail = buildFigure(make({ tails: 1 }, { Tail_01: { rotation: [0, 40, 0] } }));
    expect(tail.metrics.height).toBeCloseTo(base.metrics.height, 9);
    expect(tail.metrics.headRatio).toBeCloseTo(base.metrics.headRatio, 9);
    expect(tail.metrics.legForm).toBe('biped');
  });

  it('腿拉长、缩短以后，整个人跟着升降，脚还踩在地面上', () => {
    /** 两只脚最低的地方（世界坐标，米）：脚掌是个椭球，量它的底 */
    const sole = (figure: Figure) =>
      Math.min(
        ...['Leg_01_L', 'Leg_01_R'].map((name) => {
          const part = partOf(figure, name);
          const foot = primOf<Ellipsoid>(part, 'Foot');
          const m = shapeMatrix(part);
          const center = toWorld(figure, name, m ? mat3Apply(m, foot.center) : foot.center);
          const xf = worldTransforms(figure).get(name)!;
          return center[1] - foot.radii[1] * (m ? m[4] : 1) * xf.scale;
        }),
      );
    const base = buildFigure(make());
    expect(sole(base)).toBeCloseTo(0, 3);
    const hip = toWorld(base, 'Leg_01_L', [0, 0, 0])[1];

    // 两条腿一起加长两成：脚还在地上，髋、躯干、头都升高了
    const long = buildFigure(setOverride(make(), 'Leg_01_L', { scale: [1, 1.2, 1] }, true));
    expect(sole(long)).toBeCloseTo(sole(base), 6);
    const rise = toWorld(long, 'Leg_01_L', [0, 0, 0])[1] - hip;
    expect(rise).toBeCloseTo(hip * 0.2, 2);
    expect(toWorld(long, 'Torso', [0, 0, 0])[1] - toWorld(base, 'Torso', [0, 0, 0])[1]).toBeCloseTo(rise, 9);
    expect(long.metrics.height).toBeCloseTo(base.metrics.height + rise, 6);

    // 整体缩小：人跟着矮下去
    const short = buildFigure(setOverride(make(), 'Leg_01_L', { scale: [0.8, 0.8, 0.8] }, true));
    expect(sole(short)).toBeCloseTo(sole(base), 6);
    expect(short.metrics.height).toBeCloseTo(base.metrics.height - hip * 0.2, 2);

    // 只抬起一条腿：另一条还站着，人不升不降
    const kick = buildFigure(make({}, { Leg_01_L: { rotation: [-40, 0, 0] } }));
    expect(partOf(kick, 'Torso')).toEqual(partOf(base, 'Torso'));
    expect(partOf(kick, 'Leg_01_R')).toEqual(partOf(base, 'Leg_01_R'));

    // 没动腿的时候，谁的位置都不变
    const arms = buildFigure(make({}, { Arm_01_L: { rotation: [0, 0, 30] }, Torso: { rotation: [0, 10, 0] } }));
    expect(partOf(arms, 'Leg_01_L')).toEqual(partOf(base, 'Leg_01_L'));
    expect(partOf(arms, 'Torso').pos).toEqual(partOf(base, 'Torso').pos);
  });

  it('人马和蛛形的腿加长以后，蹄子、足尖也还在地面上', () => {
    for (const legPairs of [2, 4]) {
      const base = buildFigure(make({ legs: legPairs * 2 }));
      let spec = make({ legs: legPairs * 2 });
      for (let k = 1; k <= legPairs; k++) spec = setOverride(spec, `Leg_0${k}_L`, { scale: [1.25, 1.25, 1.25] }, true);
      const tall = buildFigure(spec);
      // 兽身跟着升高，高出来的正好是腿长出来的那一截
      const lower = legPairs === 2 ? 'LowerBody' : 'Cephalothorax';
      const rise = toWorld(tall, lower, [0, 0, 0])[1] - toWorld(base, lower, [0, 0, 0])[1];
      expect(rise, `${legPairs} 对腿`).toBeGreaterThan(0.15);
      expect(tall.metrics.height, `${legPairs} 对腿`).toBeCloseTo(base.metrics.height + rise, 6);
    }
  });

  it('结果仍然是纯数据，JSON 往返一致', () => {
    const figure = buildFigure(
      make({ heads: 2, tails: 1 }, {
        Head_01: { position: [0, 0.02, 0], rotation: [5, 10, 0], scale: [1.1, 1, 1.2] },
        Arm_01_L: { rotation: [0, 0, 20], scale: [1, 1.2, 1] },
        Tail_01: { scale: [1.3, 1.3, 1.3] },
      }),
    );
    expect(JSON.parse(JSON.stringify(figure))).toEqual(figure);
    for (const part of figure.parts) {
      expect([...part.pos, ...part.quat].every(Number.isFinite), part.name).toBe(true);
      expect(Math.hypot(...part.quat), part.name).toBeCloseTo(1, 9);
    }
  });

  it('微调过的部件也进穿模检查', () => {
    const fine = buildFigure(make());
    expect(findClashes(fine)).toEqual([]);
    // 把左臂横着转进身体里
    const crossed = buildFigure(make({}, { Arm_01_L: { rotation: [0, 0, -75] } }));
    const clashes = findClashes(crossed);
    expect(clashes.length).toBeGreaterThan(0);
    expect(clashes.some((c) => c.a === 'Arm_01_L' || c.b === 'Arm_01_L')).toBe(true);
  });
});

describe('挪腿时胯跟着变', () => {
  const row = (overrides: Record<string, PartOverride> = {}) => {
    const spec = make({ legs: 6 }, overrides);
    return buildFigure({ ...spec, legLayout: 'row' });
  };
  const width = (figure: Figure) => primOf<Ellipsoid>(partOf(figure, 'LowerBody'), 'LowerBody').radii[0];
  const centerX = (figure: Figure) => primOf<Ellipsoid>(partOf(figure, 'LowerBody'), 'LowerBody').center[0];

  it('左右并排：外侧一对往里收，胯跟着收窄那么多；往外挪就跟着放宽；左右不对称时胯的正中跟着偏', () => {
    const plain = width(row());
    expect(width(row({ Leg_03_L: { position: [-0.1, 0, 0] }, Leg_03_R: { position: [0.1, 0, 0] } }))).toBeCloseTo(plain - 0.1, 9);
    expect(width(row({ Leg_03_L: { position: [0.12, 0, 0] }, Leg_03_R: { position: [-0.12, 0, 0] } }))).toBeCloseTo(plain + 0.12, 9);
    const one = row({ Leg_03_L: { position: [-0.1, 0, 0] } });
    expect(width(one)).toBeCloseTo(plain - 0.05, 9);
    expect(centerX(one)).toBeCloseTo(-0.05, 9);
  });

  it('挪的是里面的腿、只转腿或者缩放腿：胯不变', () => {
    // 腿转开、拉长了整个人会跟着升降（脚踩在地上），所以只比胯的形状
    const plain = partOf(row(), 'LowerBody').prims;
    expect(partOf(row({ Leg_02_L: { position: [-0.03, 0, 0] } }), 'LowerBody').prims).toEqual(plain);
    expect(partOf(row({ Leg_03_L: { rotation: [0, 0, 20] }, Leg_03_R: { scale: [1, 1.2, 1] } }), 'LowerBody').prims).toEqual(plain);
  });

  it('两边的腿挪到一块儿了，胯也不会窄成一张纸', () => {
    const squeezed = row({ Leg_03_L: { position: [-0.6, 0, 0] }, Leg_03_R: { position: [0.6, 0, 0] }, Leg_02_L: { position: [-0.4, 0, 0] }, Leg_02_R: { position: [0.4, 0, 0] }, Leg_01_L: { position: [-0.2, 0, 0] }, Leg_01_R: { position: [0.2, 0, 0] } });
    expect(width(squeezed)).toBeGreaterThan(0.09);
  });
});

describe('操纵杆的坐标', () => {
  it('支点在关节上；父部件的朝向和缩放决定位置偏移怎么换算', () => {
    const figure = buildFigure(make({ heads: 2, hornsPerHead: 2 }));
    const arm = partFrame(figure, 'Arm_01_L')!;
    expectV3(arm.pivot, toWorld(figure, 'Arm_01_L', [0, 0, 0]));
    expect(arm.parentScale).toBeCloseTo(figure.scale, 12);
    expectV3(rotate(arm.parentQuat, [1, 2, 3]), [1, 2, 3]);
    const horn = partFrame(figure, 'Head_02_Horn_01_L')!;
    const head = worldTransforms(figure).get('Head_02')!;
    expect(horn.parentScale).toBeCloseTo(head.scale, 12);
    expectV3(rotate(horn.parentQuat, [0, 1, 0]), rotate(head.quat, [0, 1, 0]));
    const leg = partFrame(figure, 'Leg_01_L')!;
    expect(leg.parentScale).toBeCloseTo(figure.scale, 12);
    expect(partFrame(figure, 'Nope')).toBeNull();
  });

  it('转动、缩放时支点不动；挪位置时支点跟着走', () => {
    for (const name of ['Arm_01_L', 'Torso', 'Head_01', 'Leg_01_R']) {
      const base = partFrame(buildFigure(make()), name)!;
      const turned = partFrame(buildFigure(make({}, { [name]: { rotation: [20, -35, 50], scale: [1.4, 0.8, 1.1] } })), name)!;
      expectV3(turned.pivot, base.pivot, 9);
      const t: V3 = [0.04, -0.02, 0.03];
      const moved = partFrame(buildFigure(make({}, { [name]: { position: t, rotation: [20, -35, 50], scale: [1.4, 0.8, 1.1] } })), name)!;
      expectV3(sub(moved.pivot, base.pivot), mul(rotate(base.parentQuat, t), base.parentScale), 9);
    }
  });

  it('手臂的缩放轴：Y 沿着手臂', () => {
    const figure = buildFigure(make());
    const frame = partFrame(figure, 'Arm_01_L')!;
    const elbow = primOf<Cone>(partOf(figure, 'Arm_01_L'), 'UpperArm').b;
    expectV3(rotate(frame.axesQuat, [0, -1, 0]), norm(elbow));
    // 转过的手臂，缩放轴跟着转
    const turned = buildFigure(make({}, { Arm_01_L: { rotation: [0, 0, 40] } }));
    expectV3(rotate(partFrame(turned, 'Arm_01_L')!.axesQuat, [0, -1, 0]), rotate(quatEuler(0, 0, 40 * DEG), norm(elbow)));
  });

  it('从操纵杆的朝向换算回角度：和存下来的一致', () => {
    const figure = buildFigure(make({ heads: 3, earPairsPerHead: 1 }));
    const frame = partFrame(figure, 'Head_01_Ear_01_L')!;
    const stored: V3 = [12, -34, 56];
    const delta = quatEuler(stored[0] * DEG, stored[1] * DEG, stored[2] * DEG);
    // 操纵杆在世界里的朝向 = 父部件的朝向 ∘ 追加的旋转
    const handle: Quat = quatMul(frame.parentQuat, delta);
    const back = eulerOf(quatMul(quatConj(frame.parentQuat), handle)).map((r) => r / DEG) as V3;
    expectV3(back, stored, 8);
  });
});

describe('拉伸过的部件：两种网格对得上', () => {
  const spec = make({ earPairsPerHead: 1, hornsPerHead: 2, tails: 1, wingPairs: 1 }, {
    Arm_01_L: { rotation: [10, 0, 25], scale: [1.3, 1.6, 0.8] },
    Head_01_Ear_01_L: { scale: [1.4, 0.8, 1.2] },
    Head_01: { scale: [1.2, 0.9, 1.1], rotation: [0, 20, 0] },
    Tail_01: { scale: [0.7, 1.2, 1.5] },
    Leg_01_R: { scale: [1.3, 1, 0.9] },
    Chest_01_L: { scale: [1.3, 1, 1.4] },
  });
  const figure = buildFigure(spec);
  const xfs = worldTransforms(figure);

  it.each(['Arm_01_L', 'Head_01_Ear_01_L', 'Tail_01', 'Leg_01_R', 'Chest_01_L'])(
    '%s：分部件网格的顶点都落在距离场的表面附近',
    (name) => {
      const part = partOf(figure, name);
      const xf = xfs.get(name)!;
      expect(part.resize, name).toBeDefined();
      const field = compilePartField(part, xf);
      // 接上去的手不在距离场里（graft.test.ts 另外测）：这里只看基本体
      const geo = buildPartGeometry({ ...part, grafts: undefined });
      const pos = geo.attributes.position;
      const v = new THREE.Vector3();
      let worst = 0;
      let outside = 0;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const w = add(xf.pos, mul(rotate(xf.quat, [v.x, v.y, v.z]), xf.scale));
        const d = fieldAt(field, w[0], w[1], w[2]);
        // 每块基本体的网格都贴着自己的表面：顶点不会跑到整个部件的外面
        if (d > 0.004) outside++;
        if (d > worst) worst = d;
      }
      expect(outside, `${name} 有顶点在距离场外面（最远 ${worst.toFixed(4)}）`).toBe(0);
      // 包围盒对得上：拉伸的方向没有弄错
      geo.computeBoundingBox();
      for (const corner of [geo.boundingBox!.min, geo.boundingBox!.max]) {
        for (const axis of [0, 1, 2]) {
          const local: V3 = [0, 0, 0];
          local[axis] = corner.getComponent(axis);
          // 沿这个轴从包围盒外面一点看进来，是在外面的
          local[axis] += Math.sign(local[axis] || 1) * 0.03;
          const w = add(xf.pos, mul(rotate(xf.quat, local), xf.scale));
          expect(fieldAt(field, w[0], w[1], w[2]), `${name} 轴 ${axis}`).toBeGreaterThan(0);
        }
      }
    },
  );
});

describe('点选部件', () => {
  const figure = buildFigure(make({ armPairs: 2, tails: 1, hornsPerHead: 2 }, { Arm_02_L: { rotation: [0, 0, 20], scale: [1, 1.3, 1] } }));
  const pick = makePicker(figure);
  /** 部件某个基本体表面上、朝 out 方向的那个点 */
  const surface = (name: string, local: V3, out: V3, radius: number): V3 => {
    const part = partOf(figure, name);
    const m = shapeMatrix(part);
    const xf = worldTransforms(figure).get(name)!;
    const center = add(xf.pos, mul(rotate(xf.quat, m ? mat3Apply(m, local) : local), xf.scale));
    return add(center, mul(norm(out), radius * xf.scale));
  };

  it('点在哪个部件的表面上，就选中哪个部件', () => {
    const arm = partOf(figure, 'Arm_01_L');
    const elbow = primOf<Cone>(arm, 'UpperArm').b;
    expect(pick(surface('Arm_01_L', elbow, [1, 0, 0], 0.036))).toBe('Arm_01_L');
    expect(pick(surface('Arm_01_R', primOf<Cone>(partOf(figure, 'Arm_01_R'), 'UpperArm').b, [-1, 0, 0], 0.036))).toBe('Arm_01_R');
    const wrist2 = primOf<Cone>(partOf(figure, 'Arm_02_L'), 'Forearm').b;
    expect(pick(surface('Arm_02_L', wrist2, [1, 0, 0], 0.02))).toBe('Arm_02_L');
    expect(pick(surface('Head_01', [0, 0.03, -0.012], [0, 1, 0], 0.085))).toBe('Head_01');
    expect(pick(surface('Chest_01_L', [0, 0, 0], [0, 0, 1], 0.05))).toBe('Chest_01_L');
    const knee = primOf<Cone>(partOf(figure, 'Leg_01_R'), 'Thigh').b;
    expect(pick(surface('Leg_01_R', knee, [0, 0, 1], 0.05))).toBe('Leg_01_R');
  });

  it('肚子是躯干，尾巴尖是尾巴，角是角', () => {
    const s = figure.scale;
    expect(pick([0, 1.12 * s, 0.09 * s])).toBe('Torso');
    const tail = partOf(figure, 'Tail_01');
    const tube = tail.prims[0];
    if (tube.kind !== 'tube') throw new Error('尾巴应该是一根管');
    expect(pick(toWorld(figure, 'Tail_01', tube.points[tube.points.length - 1]))).toBe('Tail_01');
    const horn = partOf(figure, 'Head_01_Horn_01_L').prims[0];
    if (horn.kind !== 'tube') throw new Error('角应该是一根管');
    expect(pick(toWorld(figure, 'Head_01_Horn_01_L', horn.points[2]))).toBe('Head_01_Horn_01_L');
  });

  it('离身体很远的点谁也不算', () => {
    expect(pick([1.5, 1, 0])).toBeNull();
    expect(pick([0, 3, 0])).toBeNull();
  });
});
