import { describe, expect, it } from 'vitest';
import { type Quat, Q_ID } from '../src/geometry/vec';
import { armPairOf, blendPose, regionOf } from '../src/pose/blend';
import { quatAngle } from '../src/pose/math';
import { type RigBone, forward, makeRig, restState } from '../src/pose/rig';

const BONES: RigBone[] = [
  { name: 'Hips', parent: -1, head: [0, 1, 0], tail: [0, 1.1, 0] },
  { name: 'Spine', parent: 0, head: [0, 1.1, 0], tail: [0, 1.4, 0] },
  { name: 'Head', parent: 1, head: [0, 1.5, 0], tail: [0, 1.7, 0] },
  { name: 'UpperArm_L', parent: 1, head: [0.2, 1.4, 0], tail: [0.45, 1.4, 0] },
  { name: 'LowerArm_L', parent: 3, head: [0.45, 1.4, 0], tail: [0.7, 1.4, 0] },
  { name: 'Tail_01_01', parent: 0, head: [0, 1, -0.1], tail: [0, 1.2, -0.3] },
];
const rig = makeRig(BONES);
const at = (name: string) => rig.index.get(name)!;
/** 绕 axis 转 deg 度 */
const turn = (axis: [number, number, number], deg: number): Quat => {
  const s = Math.sin((deg * Math.PI) / 360);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos((deg * Math.PI) / 360)];
};
/** 两个旋转差多少度 */
const apart = (a: Quat, b: Quat) => (quatAngle([a[3] * b[0] - a[0] * b[3] - a[1] * b[2] + a[2] * b[1], a[3] * b[1] + a[0] * b[2] - a[1] * b[3] - a[2] * b[0], a[3] * b[2] - a[0] * b[1] + a[1] * b[0] - a[2] * b[3], a[3] * b[3] + a[0] * b[0] + a[1] * b[1] + a[2] * b[2]]) * 180) / Math.PI;

/** 目标：弯腰 40°、左臂放下 70°、尾巴甩开、整个人往下 0.2 */
function target() {
  const s = restState(rig);
  s.local[at('Spine')] = turn([1, 0, 0], 40);
  s.local[at('UpperArm_L')] = turn([0, 0, 1], -70);
  s.local[at('Tail_01_01')] = turn([0, 1, 0], 50);
  s.root = [0, -0.2, 0];
  return s;
}

describe('现成的姿势：分部位', () => {
  it('按骨骼名分到部位', () => {
    expect(regionOf('Head.002')).toBe('head');
    expect(regionOf('Neck_R')).toBe('head');
    expect(regionOf('Spine_L')).toBe('torso');
    expect(regionOf('Hips')).toBe('torso');
    expect(regionOf('Shoulder_L')).toBe('armL');
    expect(regionOf('Thumb1_R.002')).toBe('armR');
    expect(regionOf('Toes_L.003')).toBe('legs');
    for (const name of ['Tail_01_01', 'Wing_01_L', 'Hair_01_01', 'Eye_L', 'LowerBody_01', 'SkirtBack_01_L']) expect(regionOf(name)).toBeNull();
  });

  it('手臂是第几对', () => {
    expect(armPairOf('UpperArm_L')).toBe(0);
    expect(armPairOf('Index2_R.002')).toBe(1);
    expect(armPairOf('Hand_L.004')).toBe(3);
    expect(armPairOf('Head.002')).toBe(-1);
  });
});

describe('现成的姿势：混合', () => {
  const base = restState(rig);
  const all = () => true;

  it('全选、套满：就是目标本身', () => {
    const out = forward(rig, blendPose(rig, base, target(), 1, all, true));
    const want = forward(rig, target());
    out.rot.forEach((q, j) => expect(apart(q, want.rot[j])).toBeLessThan(1e-4));
    expect(out.pos[at('Hips')][1]).toBeCloseTo(0.8, 9);
  });

  it('套一半：每根骨骼转过去一半，整个人挪一半', () => {
    const out = blendPose(rig, base, target(), 0.5, all, true);
    expect(apart(forward(rig, out).rot[at('Spine')], Q_ID)).toBeCloseTo(20, 4);
    expect(out.root[1]).toBeCloseTo(-0.1, 9);
  });

  it('只套左手臂：手臂在世界里朝姿势里的方向，躯干、尾巴、整个人的位置不动', () => {
    const pick = (j: number) => regionOf(rig.names[j]) === 'armL';
    const out = blendPose(rig, base, target(), 1, pick, false);
    const world = forward(rig, out);
    expect(apart(world.rot[at('UpperArm_L')], forward(rig, target()).rot[at('UpperArm_L')])).toBeLessThan(1e-4);
    for (const name of ['Hips', 'Spine', 'Head', 'Tail_01_01']) expect(out.local[at(name)]).toEqual(base.local[at(name)]);
    expect(out.root).toEqual(base.root);
  });

  it('没选中的挂着的骨骼跟着父骨骼走：只套躯干时尾巴保持相对胯的样子', () => {
    const from = restState(rig);
    from.local[at('Tail_01_01')] = turn([1, 0, 0], 25);
    const pick = (j: number) => regionOf(rig.names[j]) === 'torso';
    const out = blendPose(rig, from, target(), 1, pick, true);
    expect(apart(out.local[at('Tail_01_01')], from.local[at('Tail_01_01')])).toBeLessThan(1e-4);
  });
});
