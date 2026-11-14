import { describe, expect, it } from 'vitest';
import { type Figure, worldTransforms } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { partFrame } from '../src/geometry/tweak';
import { type Quat, type V3, quatConj, quatEuler, quatMul, rotate, sub } from '../src/geometry/vec';
import { type TweakDelta, mirrorDelta, mirrorOverride, nudgeOverride, setOverride, sideOf, topMost } from '../src/model/overrides';
import { type BodyCounts, type BodySpec, type PartOverride, defaultSpec } from '../src/model/spec';

const DEG = Math.PI / 180;

const make = (counts: Partial<BodyCounts> = {}, overrides: Record<string, PartOverride> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, counts: { ...base.counts, ...counts }, overrides };
};
const expectV3 = (got: V3, want: V3, digits = 6) => {
  for (let k = 0; k < 3; k++) expect(got[k], `分量 ${k}`).toBeCloseTo(want[k], digits);
};
const quatOf = (figure: Figure, name: string): Quat => worldTransforms(figure).get(name)!.quat;
const pivotOf = (figure: Figure, name: string): V3 => partFrame(figure, name)!.pivot;

/** 几个部件各自照同一份改动改（和 main.ts 多选时做的一样），返回改完以后的设定 */
function nudgeAll(spec: BodySpec, names: string[], delta: TweakDelta): BodySpec {
  const figure = buildFigure(spec);
  let out = spec;
  for (const name of names) out = setOverride(out, name, nudgeOverride(spec.overrides[name], partFrame(figure, name)!, delta));
  return out;
}

describe('多选：真正要改的部件', () => {
  const parents: Record<string, string> = { Arm_01_L: 'Torso', Head_01: 'Torso', Head_01_Horn_01_L: 'Head_01' };
  const parentOf = (name: string) => parents[name];

  it('父部件也选中了的不算：它跟着父部件动', () => {
    expect(topMost(['Torso', 'Arm_01_L', 'Leg_01_L'], parentOf)).toEqual(['Torso', 'Leg_01_L']);
  });

  it('隔了一层的也算跟着：躯干带着头，头带着角', () => {
    expect(topMost(['Head_01_Horn_01_L', 'Torso'], parentOf)).toEqual(['Torso']);
  });

  it('互不相干的都留着，先后不变', () => {
    expect(topMost(['Arm_01_L', 'Leg_01_L', 'Head_01'], parentOf)).toEqual(['Arm_01_L', 'Leg_01_L', 'Head_01']);
  });
});

describe('多选：几个部件照同一份改动改', () => {
  // 眼睛的父部件是头，手臂的父部件是躯干，腿没有父部件：三种都试到
  const names = ['Arm_01_L', 'Arm_02_R', 'Leg_01_L', 'Head_01_Eye_01_L'];
  const spec = make({ armPairs: 2 }, { Arm_02_R: { position: [0.01, 0, 0.02], rotation: [10, -20, 30], scale: [1.2, 1.2, 1.2] }, Head_01: { rotation: [0, 25, 10] } });
  const before = buildFigure(spec);

  it('选的部件都在', () => {
    for (const name of names) expect(before.parts.some((p) => p.name === name), name).toBe(true);
  });

  it('移动：每个部件的关节在世界里都挪了同样的一段', () => {
    const move: V3 = [0.03, -0.02, 0.04];
    // 腿挪了以后整个人会跟着升降（脚踩在地上），这里只挪不带腿的那几个
    const moved = names.filter((n) => n !== 'Leg_01_L');
    const after = buildFigure(nudgeAll(spec, moved, { move }));
    for (const name of moved) expectV3(sub(pivotOf(after, name), pivotOf(before, name)), move, 4);
  });

  it('旋转：每个部件在世界里都多转了同样的一份，关节不动', () => {
    const turn = quatEuler(20 * DEG, -35 * DEG, 15 * DEG);
    const turned = names.filter((n) => n !== 'Leg_01_L');
    const after = buildFigure(nudgeAll(spec, turned, { turn }));
    const probe: V3 = [0.3, -0.5, 0.8];
    for (const name of turned) {
      expectV3(rotate(quatOf(after, name), probe), rotate(quatMul(turn, quatOf(before, name)), probe), 3);
      expectV3(pivotOf(after, name), pivotOf(before, name), 4);
    }
  });

  it('旋转：转过去再转回来，回到原样', () => {
    const turn = quatEuler(40 * DEG, 10 * DEG, -70 * DEG);
    const frame = partFrame(before, 'Arm_02_R')!;
    const there = nudgeOverride(spec.overrides.Arm_02_R, frame, { turn });
    const back = nudgeOverride({ ...spec.overrides.Arm_02_R, ...there }, frame, { turn: quatConj(turn) });
    expectV3(back.rotation as V3, spec.overrides.Arm_02_R.rotation as V3, 6);
  });

  it('缩放：各自在原来的倍数上再乘同样的倍率', () => {
    const next = nudgeAll(spec, names, { ratio: [1.5, 1.5, 1.5] });
    expect(next.overrides.Arm_01_L.scale).toEqual([1.5, 1.5, 1.5]);
    expect(next.overrides.Arm_02_R.scale).toEqual([1.8, 1.8, 1.8]);
    // 没提到的分量原样留着
    expect(next.overrides.Arm_02_R.rotation).toEqual([10, -20, 30]);
    const each = nudgeAll(spec, names, { ratio: [1, 2, 1] });
    expect(each.overrides.Arm_02_R.scale).toEqual([1.2, 2.4, 1.2]);
  });

  it('只给出改了的那一项', () => {
    const frame = partFrame(before, 'Arm_01_L')!;
    expect(Object.keys(nudgeOverride(undefined, frame, { move: [0.01, 0, 0] }))).toEqual(['position']);
    expect(Object.keys(nudgeOverride(undefined, frame, { turn: quatEuler(0.1, 0, 0) }))).toEqual(['rotation']);
    expect(Object.keys(nudgeOverride(undefined, frame, { ratio: [2, 2, 2] }))).toEqual(['scale']);
  });

  it('对称：对侧照镜像的改动改，结果就是这一侧的镜像', () => {
    const plain = buildFigure(make({ armPairs: 2 }));
    const delta: TweakDelta = { move: [0.03, -0.02, 0.04], turn: quatEuler(20 * DEG, -35 * DEG, 15 * DEG), ratio: [1.1, 1.4, 1.1] };
    const left = nudgeOverride(undefined, partFrame(plain, 'Arm_02_L')!, delta);
    const right = nudgeOverride(undefined, partFrame(plain, 'Arm_02_R')!, mirrorDelta(delta));
    const want = mirrorOverride(left);
    expectV3(right.position as V3, want.position as V3);
    expectV3(right.rotation as V3, want.rotation as V3);
    expectV3(right.scale as V3, want.scale as V3);
  });

  it('认得出部件在哪一侧', () => {
    expect(sideOf('Arm_02_L')).toBe('L');
    expect(sideOf('Head_01_Horn_01_R')).toBe('R');
    expect(sideOf('Head_01')).toBeNull();
    expect(sideOf('Torso')).toBeNull();
  });
});
