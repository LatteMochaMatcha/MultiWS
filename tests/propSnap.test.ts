// 抓住道具第 3 期（docs/grab-plan.md）：拖手脚拖到道具跟前吸上去——
// 找棱、找细长的一截（src/scene/propTouch.ts），棱上扣住、细杆握住（src/scene/grip.ts），拖动时吸附（src/scene/follow.ts）
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, type V3, dot, len, norm, quatMul, rotate, sub } from '../src/geometry/vec';
import { type PropKind, type SceneProp, clampProp, makeAssetProp, makeProp } from '../src/model/props';
import { defaultSpec } from '../src/model/spec';
import type { Hand } from '../src/pose/fingers';
import { emptyPosing } from '../src/pose/posing';
import { type PoseState, forward, tailOf } from '../src/pose/rig';
import { capturePins, dragReach, reachOnly } from '../src/pose/solve';
import { makeSolver, stateOf } from '../src/pose/solver';
import { installPropAssets, propAssetsReady } from '../src/props/library';
import { buildSkeleton } from '../src/rig/skeleton';
import { grabLink, holdState, holdTargets, seatLimb, snapReach } from '../src/scene/follow';
import { PALM, palmLength, scaleOf } from '../src/scene/grip';
import { type PropSolid, edgeAt, propSolid, solidDistance, thinPart } from '../src/scene/propTouch';

beforeAll(() => {
  if (propAssetsReady()) return;
  const file = readFileSync('public/props/lowpoly.bin');
  installPropAssets(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
});

const at0 = { x: 0, z: 0, yaw: 0 };
const prop = (kind: PropKind, patch: Partial<SceneProp> = {}, id = 'p1'): SceneProp => clampProp({ ...makeProp([], kind, at0), id, ...patch });
const asset = (name: string, patch: Partial<SceneProp> = {}, id = 'p1'): SceneProp => clampProp({ ...makeAssetProp([], name, at0)!, id, ...patch });
const near = (a: readonly number[], b: readonly number[], digits = 3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const dist = (a: V3, b: V3) => len(sub(a, b));

const solver = makeSolver(buildSkeleton(buildFigure(defaultSpec())).bones);
const { rig } = solver;
const k = scaleOf(solver);
const rest = stateOf(solver, emptyPosing());
const handOf = (name: string) => solver.hands.find((h) => h.name === name)!;
const limbOf = (name: string) => solver.limbs.findIndex((l) => l.name === name);
const LEFT = limbOf('Hand_L');
const palmOf = (state: PoseState, hand: Hand) => {
  const f = forward(rig, state);
  const turn = quatMul(f.rot[hand.bone], hand.frame);
  const wrist = f.pos[hand.bone];
  const fingers = rotate(turn, [hand.side, 0, 0]);
  const reach = palmLength(solver, hand);
  return { wrist, fingers, palm: rotate(turn, [0, -1, 0]), roots: [wrist[0] + fingers[0] * reach, wrist[1] + fingers[1] * reach, wrist[2] + fingers[2] * reach] as V3, rot: f.rot[hand.bone] };
};
/** 四指朝 fingers、手心朝下的手（左手） */
const flatHand = (fingers: V3): Quat => {
  const hand = handOf('Hand_L');
  // 约定的样子（pose/fingers.ts）：左手四指 +X、手心 −Y。绕竖轴转到四指朝 fingers
  const half = Math.atan2(-fingers[2], fingers[0]) / 2;
  const want: Quat = [0, Math.sin(half), 0, Math.cos(half)];
  return quatMul(want, [-hand.frame[0], -hand.frame[1], -hand.frame[2], hand.frame[3]]);
};

/** 桌子：台面高 1 米，朝角色这一边的棱在 z = 0.2 */
const TABLE = prop('box', { size: [1, 1, 0.6], pos: [0, 0, 0.5] });

describe('找棱', () => {
  const box = propSolid(prop('box', { size: [1, 0.5, 1] }));

  it('台面上离边近：棱上最近的那一点，和朝棱外面的方向；离边远、正中间没有', () => {
    const edge = edgeAt(box, [0.1, 0.5, 0.48], [0, 1, 0], 0.04)!;
    near(edge.point, [0.1, 0.5, 0.5], 6);
    near(edge.over, [0, 0, 1], 6);
    expect(edgeAt(box, [0.1, 0.5, 0.4], [0, 1, 0], 0.04)).toBeNull();
    expect(edgeAt(box, [0, 0.5, 0], [0, 1, 0], 0.04)).toBeNull();
    // 角上：两条棱里近的那条
    near(edgeAt(box, [0.49, 0.5, 0.47], [0, 1, 0], 0.04)!.over, [1, 0, 0], 6);
  });

  it('刚出了边（悬着一点）也算；侧面上离顶近的：棱是顶上那条，往上翻', () => {
    const out = edgeAt(box, [0.1, 0.5, 0.52], [0, 1, 0], 0.04)!;
    near(out.point, [0.1, 0.5, 0.5], 6);
    near(out.over, [0, 0, 1], 6);
    const side = edgeAt(box, [0.1, 0.48, 0.5], [0, 0, 1], 0.04)!;
    near(side.point, [0.1, 0.5, 0.5], 6);
    near(side.over, [0, 1, 0], 6);
  });

  it('往里凹的折角（地面碰到墙根）不算', () => {
    // 一块地面（朝上）和一面墙（朝 −z，立在 z = 0.5）
    const solid: PropSolid = {
      id: 'corner',
      points: Float32Array.from([-1, 0, -1, 1, 0, -1, 1, 0, 0.5, -1, 0, 0.5, -1, 1, 0.5, 1, 1, 0.5]),
      indices: Uint32Array.from([0, 2, 1, 0, 3, 2, 3, 4, 5, 3, 5, 2]),
      min: [-1, 0, -1],
      max: [1, 1, 0.5],
    };
    expect(edgeAt(solid, [0, 0, 0.48], [0, 1, 0], 0.04)).toBeNull();
  });
});

describe('找细长的一截', () => {
  const find = (p: SceneProp, at: V3) => thinPart(propSolid(p, at0), at, 0.12 * k, 0.06 * k, 0.025 * k);

  it('细的方柱：中线、半径；粗的箱子、台面、球都不是', () => {
    const post = prop('box', { size: [0.3, 0.9, 0.06], pos: [0.3, 0, 0.3] });
    // 6 厘米厚、30 厘米宽：不是杆（barOf 也不认），当平面
    expect(find(post, [0.3, 0.5, 0.27])).toBeNull();
    const thin = find(prop('box', { size: [0.06, 0.9, 0.06], pos: [0.3, 0, 0.3] }), [0.3, 0.5, 0.27])!;
    near(norm(sub(thin.b, thin.a)).map(Math.abs), [0, 1, 0], 2);
    expect(Math.hypot(thin.a[0] - 0.3, thin.a[2] - 0.3)).toBeLessThan(0.004);
    expect(thin.r).toBeGreaterThan(0.03);
    expect(thin.r).toBeLessThan(0.043);
    expect(len(sub(thin.b, thin.a))).toBeGreaterThan(0.18);
    expect(find(TABLE, [0, 1, 0.4])).toBeNull();
    expect(find(prop('ball', { size: [0.3, 0.3, 0.3], pos: [0, 0.8, 0] }), [0, 1.1, 0])).toBeNull();
  });

  it('家具上的：椅子腿（旁边连着横撑）、椅背顶上的横梁、吧台凳的腿是；桌面、椅子的坐面不是', () => {
    const chair = asset('chair');
    const leg = find(chair, [-0.18, 0.2, -0.2])!;
    expect(Math.abs(norm(sub(leg.b, leg.a))[1])).toBeGreaterThan(0.99);
    expect(Math.hypot(leg.a[0] + 0.16, leg.a[2] + 0.16)).toBeLessThan(0.01);
    const rail = find(chair, [0, 0.94, -0.16])!;
    expect(Math.abs(norm(sub(rail.b, rail.a))[0])).toBeGreaterThan(0.99);
    expect(find(asset('stoolBar'), [-0.134, 0.15, -0.128])).not.toBeNull();
    const table = asset('table');
    expect(find(table, [0, propSolid(table).max[1], 0])).toBeNull();
    // 坐面正中
    const s = propSolid(chair);
    let seat = 0;
    for (let i = 1; i < s.points.length; i += 3) if (s.points[i] > 0.3 && s.points[i] < 0.6) seat = Math.max(seat, s.points[i]);
    expect(find(chair, [0, seat, 0.05])).toBeNull();
  });
});

describe('落位：棱上扣住、家具的细杆握住', () => {
  const hand = handOf('Hand_L');
  /** 左手伸到 to，四指朝 fingers、手心朝下 */
  const reach = (to: V3, fingers: V3) => reachOnly(solver, rest, LEFT, to, flatHand(fingers));

  it('四指朝着桌沿外面、离桌沿近：四指根部落到棱上，手掌贴着台面，四指垂直着棱', () => {
    // 角色在桌子里侧够不着：换成一张摆在身前、棱朝外（+z）的矮台，手从台面上往外伸
    const desk = prop('box', { size: [1, 1, 0.3], pos: [0, 0, 0.2] });
    const state = reach([0.2, 1.04, 0.25], [0, 0, 1]);
    const seat = seatLimb(solver, state, at0, desk, LEFT)!;
    const seated = reachOnly(solver, state, LEFT, seat.target, seat.rot);
    const got = palmOf(seated, hand);
    near(got.fingers, [0, 0, 1], 5);
    near(got.palm, [0, -1, 0], 5);
    // 棱在 z = 0.35、y = 1
    expect(got.roots[2]).toBeCloseTo(0.35, 4);
    expect(got.wrist[1]).toBeCloseTo(1 + PALM * k, 4);
    near(seat.mark.at, [got.wrist[0], 1, 0.35], 4);
    near(seat.mark.axis, [0, 1, 0], 6);
    // 再落一次位还在原处
    const again = seatLimb(solver, seated, at0, desk, LEFT)!;
    expect(dist(again.target, got.wrist)).toBeLessThan(1e-6);
    // 握上：指尖翻过棱，到了台面以下、贴着侧面
    const held = grabLink(solver, state, at0, desk, 'Hand_L', 1)!;
    const gripped = holdState(solver, held.state, holdTargets(at0, [held.link], [desk]), { grip: 'always' });
    const f = forward(rig, gripped);
    const solid = propSolid(desk, at0);
    for (const chain of hand.fingers.slice(1)) {
      const tip = tailOf(rig, f, chain[chain.length - 1]);
      expect(tip[1]).toBeLessThan(1);
      expect(tip[2]).toBeGreaterThan(0.35);
      const gap = solidDistance(solid, tip);
      expect(gap).toBeGreaterThan(0.003);
      expect(gap).toBeLessThan(0.025);
    }
  });

  it('四指顺着桌沿（没朝外）、离桌沿远：只是手掌贴着台面，手不转向', () => {
    const desk = prop('box', { size: [1, 1, 0.3], pos: [0, 0, 0.2] });
    const along = reach([0.2, 1.04, 0.3], [1, 0, 0]);
    const a = seatLimb(solver, along, at0, desk, LEFT)!;
    near(palmOf(reachOnly(solver, along, LEFT, a.target, a.rot), hand).fingers, [1, 0, 0], 4);
    const far = reach([0.2, 1.04, 0.12], [0, 0, 1]);
    const b = seatLimb(solver, far, at0, desk, LEFT)!;
    expect(b.target[2]).toBeCloseTo(forward(rig, far).pos[hand.bone][2], 5);
    expect(b.target[1]).toBeCloseTo(1 + PALM * k, 5);
  });

  it('椅背顶上的横梁：当杆握（手心对着它的中线）；再落一次位差不到 2 毫米', () => {
    const chair = asset('chair', { pos: [0.2, 0.2, 0.3], rot: [0, 180, 0] });
    const solid = propSolid(chair, at0);
    const top = solid.max[1];
    // 横梁在椅背那一边：找最高的那些点里 z 的范围
    let zLo = Infinity;
    let zHi = -Infinity;
    for (let i = 0; i < solid.points.length; i += 3) {
      if (solid.points[i + 1] < top - 1e-4) continue;
      zLo = Math.min(zLo, solid.points[i + 2]);
      zHi = Math.max(zHi, solid.points[i + 2]);
    }
    const z = (zLo + zHi) / 2;
    const state = reach([0.2, top + 0.04, z], [0, 0, 1]);
    const seat = seatLimb(solver, state, at0, chair, LEFT, solid)!;
    // 亮圈套在横梁上：轴顺着横梁（左右方向）
    expect(Math.abs(seat.mark.axis[0])).toBeGreaterThan(0.99);
    const seated = reachOnly(solver, state, LEFT, seat.target, seat.rot);
    const got = palmOf(seated, hand);
    expect(Math.abs(got.fingers[0])).toBeLessThan(0.02);
    // 手心对着中线
    const toAxis = norm([0, seat.mark.at[1] - got.roots[1], seat.mark.at[2] - got.roots[2]]);
    expect(dot(got.palm, toAxis)).toBeGreaterThan(0.99);
    const again = seatLimb(solver, seated, at0, chair, LEFT, solid)!;
    expect(dist(again.target, got.wrist)).toBeLessThan(0.002);
  });
});

describe('拖动时吸上去', () => {
  const hand = handOf('Hand_L');
  const pins = capturePins(solver, forward(rig, rest), new Set<string>());
  const POLE = prop('pole', { pos: [0.25, 0, 0.34] });

  it('dragReach 能指定末端朝向；不给和以前一样', () => {
    const rot = flatHand([0, 0, 1]);
    const state = dragReach(solver, rest, LEFT, [0.25, 1.1, 0.3], pins, rot);
    const f = forward(rig, state);
    near(f.pos[hand.bone], [0.25, 1.1, 0.3], 5);
    near(rotate(quatMul(f.rot[hand.bone], hand.frame), [0, -1, 0]), [0, -1, 0], 5);
    expect(dragReach(solver, rest, LEFT, [0.25, 1.1, 0.3], pins)).toEqual(dragReach(solver, rest, LEFT, [0.25, 1.1, 0.3], pins, undefined));
  });

  it('手拖到杆跟前：落到握得住的地方，亮圈套在杆上；松手抓住时不再挪', () => {
    const dragged = dragReach(solver, rest, LEFT, [0.25, 1.15, 0.3], pins);
    const got = snapReach(solver, rest, LEFT, pins, dragged, at0, POLE)!;
    const palm = palmOf(got.state, hand);
    expect(Math.hypot(palm.roots[0] - 0.25, palm.roots[2] - 0.34)).toBeCloseTo(0.025 + 0.015 * k, 3);
    near(got.mark.axis.map(Math.abs), [0, 1, 0], 6);
    expect(got.mark.radius).toBeCloseTo(0.025 + 0.012 * k, 6);
    near([got.mark.at[0], got.mark.at[2]], [0.25, 0.34], 6);
    const link = grabLink(solver, got.state, at0, POLE, 'Hand_L', 1)!;
    expect(dist(forward(rig, link.state).pos[hand.bone], palm.wrist)).toBeLessThan(1e-6);
    expect(link.link.grip).toBe(1);
  });

  it('沿着杆拖：手跟着上下滑，一直握着杆', () => {
    const heights = [1.0, 1.1, 1.2, 1.3];
    const at = heights.map((y) => {
      const dragged = dragReach(solver, rest, LEFT, [0.25, y, 0.3], pins);
      const p = palmOf(snapReach(solver, rest, LEFT, pins, dragged, at0, POLE)!.state, hand);
      expect(Math.hypot(p.roots[0] - 0.25, p.roots[2] - 0.34)).toBeCloseTo(0.025 + 0.015 * k, 3);
      return p.wrist[1];
    });
    // 拖高 10 厘米，手也往上滑 10 厘米左右（手跟着前臂转，四指根部沿杆的位置略有出入）
    for (let i = 1; i < at.length; i++) {
      expect(at[i] - at[i - 1]).toBeGreaterThan(0.05);
      expect(at[i] - at[i - 1]).toBeLessThan(0.15);
    }
  });

  it('手背对着台面：不吸；脚拖到箱子上：脚底贴着面', () => {
    const up = reachOnly(solver, rest, LEFT, [0.2, 1.04, 0.3], [1, 0, 0, 0]);
    expect(snapReach(solver, rest, LEFT, pins, up, at0, TABLE)).toBeNull();
    const box = prop('box', { size: [0.6, 0.2, 0.5], pos: [0, 0, 0.35], rot: [15, 0, 0] });
    const foot = limbOf('Foot_L');
    const dragged = dragReach(solver, rest, foot, [0.08, 0.36, 0.3], pins);
    const got = snapReach(solver, rest, foot, pins, dragged, at0, box)!;
    const end = solver.limbs[foot].end;
    const f = forward(rig, got.state);
    near(rotate(f.rot[end], [0, 1, 0]), got.mark.axis, 4);
    expect(solidDistance(propSolid(box, at0), f.pos[end])).toBeCloseTo(rig.head[end][1], 3);
  });
});
