import { describe, expect, it } from 'vitest';
import { type Quat, type V3, Q_ID, dot, len, norm, sub } from '../src/geometry/vec';
import { BodySurface, CLEARANCE, boneRadius, drape, drapeBones } from '../src/pose/drape';
import { type RigBone, forward, makeRig, restState, tailOf } from '../src/pose/rig';

/** 一个小人：胯、脊柱、头，头后面垂着一缕三节的头发，胯上一片裙摆、一条尾巴，再加几根不该动的 */
const BONES: RigBone[] = [
  { name: 'Hips', parent: -1, head: [0, 1, 0], tail: [0, 1.1, 0] },
  { name: 'Spine', parent: 0, head: [0, 1.1, 0], tail: [0, 1.5, 0] },
  { name: 'Head', parent: 1, head: [0, 1.5, 0], tail: [0, 1.7, 0] },
  { name: 'Hair_01_01', parent: 2, head: [0, 1.6, -0.1], tail: [0, 1.5, -0.1] },
  { name: 'Hair_01_02', parent: 3, head: [0, 1.5, -0.1], tail: [0, 1.4, -0.1] },
  { name: 'Hair_01_03', parent: 4, head: [0, 1.4, -0.1], tail: [0, 1.3, -0.1] },
  { name: 'SkirtBack_01_L', parent: 0, head: [0.1, 1, -0.1], tail: [0.12, 0.8, -0.12] },
  { name: 'LowerSleeve_L', parent: 1, head: [0.3, 1.4, 0], tail: [0.3, 1.3, 0] },
  { name: 'Tail_01_01', parent: 0, head: [0, 0.95, -0.12], tail: [0, 1.1, -0.3] },
  { name: 'Bust1_L', parent: 1, head: [0.08, 1.3, 0.05], tail: [0.08, 1.3, 0.12] },
  { name: 'RabbitEar1_01_L', parent: 2, head: [0.05, 1.7, 0], tail: [0.05, 1.85, 0] },
  { name: 'Wing_01_L', parent: 1, head: [0.05, 1.35, -0.1], tail: [0.4, 1.5, -0.2] },
];
const rig = makeRig(BONES);
const at = (name: string) => rig.index.get(name)!;

/** 整个人绕 X 轴转 angle（弧度）：-90° 是仰面躺下（头朝 -Z） */
function tilted(angle: number) {
  const state = restState(rig);
  const s = Math.sin(angle / 2);
  state.local[rig.hips] = [s, 0, 0, Math.cos(angle / 2)] as Quat;
  return state;
}

/** 一个球面上均匀撒的点和朝外的法线 */
function sphere(center: V3, radius: number, n = 4000) {
  const points = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * Math.PI * (3 - Math.sqrt(5));
    const d: V3 = [Math.cos(a) * r, y, Math.sin(a) * r];
    normals.set(d, i * 3);
    points.set([center[0] + d[0] * radius, center[1] + d[1] * radius, center[2] + d[2] * radius], i * 3);
  }
  return new BodySurface(points, normals);
}

const angleToDown = (a: V3, b: V3) => Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(b, a)), [0, -1, 0]))));
const hair = ['Hair_01_01', 'Hair_01_02', 'Hair_01_03'].map(at);

describe('自然下垂：哪些骨骼会垂', () => {
  it('头发、裙摆、袖子；尾巴要勾上才算；胸、兽耳、翅膀不算', () => {
    const names = (tails: boolean) => [...drapeBones(rig, tails).keys()].map((j) => rig.names[j]).sort();
    expect(names(false)).toEqual(['Hair_01_01', 'Hair_01_02', 'Hair_01_03', 'LowerSleeve_L', 'SkirtBack_01_L']);
    expect(names(true)).toContain('Tail_01_01');
    expect(names(true)).not.toContain('Wing_01_L');
  });
});

describe('自然下垂：怎么垂', () => {
  const bones = drapeBones(rig, true);
  const open = { now: null, rest: null, floor: -10 };

  it('站着（静止姿势）点它什么都不变', () => {
    const out = drape(rig, restState(rig), bones, open);
    for (const q of out.local) expect(q).toEqual(Q_ID);
  });

  it('躺下：头发往下垂，根上转得少、梢上转得多；别的骨骼不动', () => {
    const lying = tilted(-Math.PI / 2);
    const before = forward(rig, lying);
    const after = forward(rig, drape(rig, lying, bones, open));
    // 不垂的时候，头发跟着头横过来（和正下方差 90°）
    expect(angleToDown(before.pos[hair[0]], tailOf(rig, before, hair[0]))).toBeCloseTo(Math.PI / 2, 5);
    const bend = hair.map((j) => angleToDown(after.pos[j], tailOf(rig, after, j)));
    expect(bend[0]).toBeCloseTo(Math.PI / 4, 5); // 根上转回去一半
    expect(bend[1]).toBeLessThan(bend[0]);
    expect(bend[2]).toBeLessThan(bend[1]);
    // 每一节把剩下的再转回去一半：第三节离正下方还差 90° 的八分之一
    expect(bend[2]).toBeCloseTo((Math.PI / 2) * 0.125, 5);
    const out = drape(rig, lying, bones, open);
    for (const name of ['Hips', 'Spine', 'Head', 'Bust1_L', 'Wing_01_L']) expect(out.local[at(name)]).toEqual(lying.local[at(name)]);
  });

  it('倒立：头发也垂下来', () => {
    const upside = tilted(Math.PI);
    const after = forward(rig, drape(rig, upside, bones, open));
    expect(angleToDown(after.pos[hair[2]], tailOf(rig, after, hair[2]))).toBeLessThan(Math.PI / 4);
  });

  it('碰到地面就停在地面上面', () => {
    const lying = tilted(-Math.PI / 2);
    // 躺着时头发的根大约在 1 m 高（胯的高度）；把地面放在 0.95 m
    const floor = 0.95;
    const after = forward(rig, drape(rig, lying, bones, { now: null, rest: null, floor }));
    for (const j of hair) expect(tailOf(rig, after, j)[1]).toBeGreaterThanOrEqual(floor + CLEARANCE.hair - 1e-6);
  });

  it('碰到身体就拨到外面，长度不变', () => {
    const lying = tilted(-Math.PI / 2);
    const free = forward(rig, drape(rig, lying, bones, open));
    // 在垂下来的头发正中间放一个球
    const tip = tailOf(rig, free, hair[1]);
    const center: V3 = [tip[0], tip[1] - 0.02, tip[2]];
    const ball = sphere(center, 0.05);
    const after = forward(rig, drape(rig, lying, bones, { now: ball, rest: null, floor: -10 }));
    for (const j of hair) {
      const t = tailOf(rig, after, j);
      expect(len(sub(t, center))).toBeGreaterThan(0.05 + CLEARANCE.hair - 0.006);
      expect(len(sub(t, after.pos[j]))).toBeCloseTo(0.1, 6);
    }
  });

  it('中间一节被拨开，下一节还是照原来的方向往下垂（搭在手臂上的头发不整缕翘出去）', () => {
    const lying = tilted(-Math.PI / 2);
    const free = forward(rig, drape(rig, lying, bones, open));
    // 球挡在第一节的末端：第一节被拨开
    const tip = tailOf(rig, free, hair[0]);
    const ball = sphere([tip[0], tip[1], tip[2] + 0.03], 0.04);
    const after = forward(rig, drape(rig, lying, bones, { now: ball, rest: null, floor: -10 }));
    expect(len(sub(tailOf(rig, after, hair[0]), tip))).toBeGreaterThan(0.01);
    // 最后一节的方向和没有球时几乎一样
    const dir = (f: typeof after, j: number) => norm(sub(tailOf(rig, f, j), f.pos[j]));
    expect(dot(dir(after, hair[2]), dir(free, hair[2]))).toBeGreaterThan(Math.cos((5 * Math.PI) / 180));
  });

  it('静止时本来就贴着身体的，垂下来以后也只要求离那么远（站着点它照样不变）', () => {
    // 头发第二节的末端静止时就在球面上
    const ball = sphere([0, 1.4, -0.15], 0.05);
    const out = drape(rig, restState(rig), bones, { now: ball, rest: ball, floor: -10 });
    for (const q of out.local) expect(q).toEqual(Q_ID);
  });
});

describe('自然下垂：量表面和粗细', () => {
  it('离球面多远：外面为正，里面为负，太远认不出', () => {
    const ball = sphere([0, 0, 0], 0.1);
    expect(ball.near([0.13, 0, 0])!.gap).toBeCloseTo(0.03, 2);
    expect(ball.near([0.07, 0, 0])!.gap).toBeCloseTo(-0.03, 2);
    expect(ball.near([0.5, 0, 0])).toBeNull();
  });

  it('骨骼有多粗：周围顶点到骨头的距离取中位数', () => {
    const pts: number[] = [];
    for (let i = 0; i < 100; i++) {
      const a = i * 0.7;
      pts.push(Math.cos(a) * 0.04, 1 + (i % 10) * 0.01, -0.2 + Math.sin(a) * 0.04);
    }
    const r = boneRadius(makeRig([{ name: 'Tail_01_01', parent: -1, head: [0, 1, -0.2], tail: [0, 1.1, -0.2] }]), new Map([[0, new Float32Array(pts)]]));
    expect(r.get(0)).toBeCloseTo(0.04, 4);
  });
});
