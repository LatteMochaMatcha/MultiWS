// 抓住道具第 2 期（docs/grab-plan.md）：手落到道具上、手指照道具的形状握上（src/scene/grip.ts），
// 连接带握紧度（src/model/links.ts、src/scene/follow.ts），一键动作用同一套（src/scene/propActions.ts）
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, type V3, cross, dot, len, norm, quatConj, quatMul, rotate, sub } from '../src/geometry/vec';
import { BODY_LINK, linkOf, normalizeLinks, withGrip } from '../src/model/links';
import { type PropKind, type SceneProp, clampProp, makeProp, updateProp } from '../src/model/props';
import { defaultSpec } from '../src/model/spec';
import { GESTURES, type Hand, readHand, shapeHand } from '../src/pose/fingers';
import { emptyPosing } from '../src/pose/posing';
import { type PoseState, forward, tailOf } from '../src/pose/rig';
import { reachOnly } from '../src/pose/solve';
import { makeSolver, posingOf, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { barOf } from '../src/scene/bar';
import { grabLink, holdPosing, holdState, holdTargets, linkTo } from '../src/scene/follow';
import { PALM, closeHand, gripHand, loosen, palmLength, scaleOf, seatFoot, seatHand } from '../src/scene/grip';
import { solvePropAction } from '../src/scene/propActions';
import { nearPart, propSolid, solidDistance, surfaceAt, touchesSolid } from '../src/scene/propTouch';

const at0 = { x: 0, z: 0, yaw: 0 };
const prop = (kind: PropKind, patch: Partial<SceneProp> = {}, id = 'p1'): SceneProp => clampProp({ ...makeProp([], kind, at0), id, ...patch });
const near = (a: readonly number[], b: readonly number[], digits = 3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const dist = (a: V3, b: V3) => len(sub(a, b));
const sameTurn = (a: Quat, b: Quat, digits = 4) => ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[]).forEach((v) => near(rotate(a, v), rotate(b, v), digits));

const solver = makeSolver(buildSkeleton(buildFigure(defaultSpec())).bones);
const { rig } = solver;
const k = scaleOf(solver);
const rest = stateOf(solver, emptyPosing());
const handOf = (name: string) => solver.hands.find((h) => h.name === name)!;
const limbOf = (name: string) => solver.limbs.findIndex((l) => l.name === name);
/** 手掌现在四指朝哪、手心朝哪 */
const palmOf = (state: PoseState, hand: Hand) => {
  const f = forward(rig, state);
  const turn = quatMul(f.rot[hand.bone], hand.frame);
  return { wrist: f.pos[hand.bone], fingers: rotate(turn, [hand.side, 0, 0]), palm: rotate(turn, [0, -1, 0]) };
};
/** 每根手指每一节的末端离道具表面多远（米；在里面是负的） */
const fingerGaps = (state: PoseState, hand: Hand, p: SceneProp) => {
  const f = forward(rig, state);
  const solid = propSolid(p, at0);
  return hand.fingers.map((chain) => chain.map((bone) => solidDistance(solid, tailOf(rig, f, bone))));
};
/** 左手（右手是镜像）伸到 to，落位、握上 */
const grab = (p: SceneProp, to: V3, part = 'Hand_L') => {
  const side = part === 'Hand_L' ? 1 : -1;
  const mine = side > 0 ? p : { ...p, pos: [-p.pos[0], p.pos[1], p.pos[2]] as V3 };
  const reached = reachOnly(solver, rest, limbOf(part), [to[0] * side, to[1], to[2]]);
  const got = grabLink(solver, reached, at0, mine, part, 1)!;
  const held = holdState(solver, got.state, holdTargets(at0, [got.link], [mine]), { grip: 'always' });
  return { prop: mine, reached, seated: got.state, link: got.link, held };
};

const POLE = prop('pole', { pos: [0.25, 0, 0.34] });
/** 手先伸到杆跟前的这一点 */
const AT_POLE: V3 = [0.25, 1.15, 0.305];
const TABLE = prop('box', { size: [1, 1, 0.6], pos: [0, 0, 0.5] });
const BALL = prop('ball', { size: [0.3, 0.3, 0.3], pos: [0.25, 0.8, 0.4] });

describe('道具的表面：最近的面朝哪、手边的那一部分', () => {
  const box = propSolid(prop('box', { size: [1, 0.5, 1] }));

  it('箱子顶上：朝上；侧面：朝外', () => {
    const top = surfaceAt(box, [0.2, 0.6, 0.1])!;
    near(top.point, [0.2, 0.5, 0.1], 6);
    near(top.normal, [0, 1, 0], 6);
    expect(top.dist).toBeCloseTo(0.1, 6);
    near(surfaceAt(box, [0.7, 0.2, 0])!.normal, [1, 0, 0], 6);
  });

  it('在棱的外面：两边一样近，取朝着指定方向的那一面', () => {
    const p: V3 = [0.5, 0.5, 0];
    near(surfaceAt(box, [0.55, 0.55, 0], [0, 1, 0])!.normal, [0, 1, 0], 6);
    near(surfaceAt(box, [0.55, 0.55, 0], [1, 0, 0])!.normal, [1, 0, 0], 6);
    near(surfaceAt(box, [0.55, 0.55, 0], [1, 0, 0])!.point, p, 6);
  });

  it('只留手边的面；碰没碰着问得出来', () => {
    const part = nearPart(box, [0.5, 0.5, 0.5], 0.1);
    expect(part.indices.length).toBeGreaterThan(0);
    expect(part.indices.length).toBeLessThan(box.indices.length);
    expect(nearPart(box, [3, 3, 3], 0.1).indices.length).toBe(0);
    expect(touchesSolid(box, [0, 0.505, 0], 0.01)).toBe(true);
    expect(touchesSolid(box, [0, 0.52, 0], 0.01)).toBe(false);
    // 在里面深处：离每个面都远，「碰着」问不出来（所以握之前另外查一次在不在里面）
    expect(touchesSolid(box, [0, 0.25, 0], 0.01)).toBe(false);
  });
});

describe('连接：握紧度', () => {
  const box = prop('box');
  const link = linkTo(box, 'Hand_L', [0.2, 1.03, 0]);

  it('记上、改、去掉；整个人跟着的不记', () => {
    expect(link.grip).toBeUndefined();
    expect(withGrip(link, 1).grip).toBe(1);
    expect(withGrip(link, 0.456).grip).toBe(0.46);
    expect(withGrip(link, 7).grip).toBe(1);
    expect(withGrip(withGrip(link, 1), 0)).toEqual(link);
    expect(withGrip(link, Number.NaN)).toEqual(link);
    const ride = { ...link, part: BODY_LINK, yaw: 0 };
    expect(withGrip(ride, 1)).toBe(ride);
  });

  it('读存档：收进 0–1、留到百分之一；0、不像样的不记', () => {
    const raw = (part: string, grip: unknown) => ({ prop: 'p1', part, at: [0, 1, 0], off: [0, 0.03, 0], grip });
    const read = normalizeLinks([raw('Hand_L', 0.5), raw('Hand_R', 3), raw('Foot_L', 0), raw('Foot_R', 'x'), raw('Hand_L.002', -1), { ...raw(BODY_LINK, 1), yaw: 0 }], [box]);
    expect(read.map((l) => l.grip)).toEqual([0.5, 1, undefined, undefined, undefined, undefined]);
    expect(normalizeLinks(JSON.parse(JSON.stringify(read)), [box])).toEqual(read);
  });
});

describe('落位：手掌对着道具、脚底贴着面', () => {
  it('杆：手心对着杆的中线，四指横着绕，杆在四指根部', () => {
    for (const part of ['Hand_L', 'Hand_R']) {
      const got = grab(POLE, AT_POLE, part);
      const hand = handOf(part);
      const { wrist, fingers, palm } = palmOf(got.seated, hand);
      const bar = barOf(got.prop)!;
      const axis = norm(sub(bar.b, bar.a));
      expect(Math.abs(dot(fingers, axis))).toBeLessThan(1e-6);
      // 四指根部离杆的中线：半径 + 1.5 厘米；手心正对着中线
      const roots: V3 = [wrist[0] + fingers[0] * palmLength(solver, hand), wrist[1] + fingers[1] * palmLength(solver, hand), wrist[2] + fingers[2] * palmLength(solver, hand)];
      const out: V3 = [roots[0] - bar.a[0], 0, roots[2] - bar.a[2]];
      expect(len(out)).toBeCloseTo(bar.r + 0.015 * k, 4);
      near(palm, norm([-out[0], 0, -out[2]]), 4);
      // 手腕没被挪远
      expect(dist(wrist, forward(rig, got.reached).pos[hand.bone])).toBeLessThan(0.12);
    }
  });

  it('已经握好的手再落一次位：还在原处（换地方抓、道具动了都要重新落位，不能越转越偏）', () => {
    const got = grab(POLE, AT_POLE);
    const again = grabLink(solver, got.held, at0, got.prop, 'Hand_L', 1)!;
    const a = forward(rig, got.held);
    const b = forward(rig, again.state);
    const bone = handOf('Hand_L').bone;
    expect(dist(a.pos[bone], b.pos[bone])).toBeLessThan(1e-6);
    sameTurn(a.rot[bone], b.rot[bone], 6);
    near(again.link.at, got.link.at, 4);
    // 桌面上也一样
    const flat = grab(TABLE, [0.2, 1.04, 0.3]);
    const flat2 = grabLink(solver, flat.held, at0, flat.prop, 'Hand_L', 1)!;
    expect(dist(forward(rig, flat.held).pos[bone], forward(rig, flat2.state).pos[bone])).toBeLessThan(1e-6);
  });

  it('杆横着、歪着：一样对着中线；从哪一边绕取离现在近的', () => {
    const tilted = prop('pole', { pos: [0.1, 1.2, 0.35], rot: [0, 0, 70], size: [0.05, 1, 0.05] });
    const got = grab(tilted, [0.25, 1.3, 0.33]);
    const hand = handOf('Hand_L');
    const { fingers } = palmOf(got.seated, hand);
    const bar = barOf(tilted)!;
    expect(Math.abs(dot(fingers, norm(sub(bar.b, bar.a))))).toBeLessThan(1e-6);
    // 没有翻过去：比原来转了不到 100°
    const turned = quatMul(quatConj(forward(rig, got.reached).rot[hand.bone]), forward(rig, got.seated).rot[hand.bone]);
    expect(2 * Math.acos(Math.min(1, Math.abs(turned[3])))).toBeLessThan((100 * Math.PI) / 180);
  });

  it('桌面、墙：手心贴着面，手腕离面一个手掌厚', () => {
    const table = grab(TABLE, [0.2, 1.04, 0.3]);
    const a = palmOf(table.seated, handOf('Hand_L'));
    near(a.palm, [0, -1, 0], 6);
    expect(a.wrist[1]).toBeCloseTo(1 + PALM * k, 5);
    const wall = grab(prop('wall', { size: [2, 2.4, 0.1], pos: [0, 0, 0.5] }), [0.25, 1.2, 0.42]);
    const b = palmOf(wall.seated, handOf('Hand_L'));
    near(b.palm, [0, 0, 1], 6);
    expect(b.wrist[2]).toBeCloseTo(0.45 - PALM * k, 5);
  });

  it('手背对着道具：不帮着转', () => {
    const hand = handOf('Hand_L');
    const state = reachOnly(solver, rest, limbOf('Hand_L'), [0.2, 1.04, 0.3], [1, 0, 0, 0]);
    // 绕前后的轴翻了半圈：手心朝上
    expect(palmOf(state, hand).palm[1]).toBeGreaterThan(0.8);
    expect(seatHand(solver, state, hand, propSolid(TABLE, at0), k)).toBeNull();
    // 照样能连上，只是手没动
    const got = grabLink(solver, state, at0, TABLE, 'Hand_L', 1)!;
    expect(got.state).toBe(state);
    expect(got.link.grip).toBe(1);
  });

  it('脚：脚底贴着斜面，脚踝离面和站在地上时一样高；脚尖顶着墙的不帮着转', () => {
    const board = prop('box', { size: [0.6, 0.2, 0.5], pos: [0, 0, 0.35], rot: [20, 0, 0] });
    const leg = solver.limbs[limbOf('Foot_L')];
    const lifted = reachOnly(solver, rest, limbOf('Foot_L'), [0.08, 0.35, 0.3]);
    const seat = seatFoot(solver, lifted, leg, propSolid(board, at0))!;
    const up = rotate(seat.rot, [0, 1, 0]);
    near(up, [0, Math.cos((20 * Math.PI) / 180), Math.sin((20 * Math.PI) / 180)], 5);
    expect(solidDistance(propSolid(board, at0), seat.target)).toBeCloseTo(rig.head[leg.end][1], 4);
    // 连上：脚的连接不带握紧度
    const got = grabLink(solver, lifted, at0, board, 'Foot_L', 1)!;
    expect(got.link.grip).toBeUndefined();
    near(forward(rig, got.state).pos[leg.end], seat.target, 5);
    const wall = prop('wall', { size: [2, 2.4, 0.1], pos: [0, 0, 0.3] });
    expect(seatFoot(solver, reachOnly(solver, rest, limbOf('Foot_L'), [0.08, 0.3, 0.18]), leg, propSolid(wall, at0))).toBeNull();
  });
});

describe('手指握上', () => {
  it('杆：四指每一节都贴着杆（不插进去、也不悬着），左右手是镜像', () => {
    const shapes = ['Hand_L', 'Hand_R'].map((part) => {
      const got = grab(POLE, AT_POLE, part);
      const hand = handOf(part);
      const gaps = fingerGaps(got.held, hand, got.prop);
      for (const chain of gaps.slice(1)) {
        for (const gap of chain) {
          expect(gap).toBeGreaterThan(0.004);
          expect(gap).toBeLessThan(0.02);
        }
      }
      // 拇指没插进杆里
      for (const gap of gaps[0]) expect(gap).toBeGreaterThan(0);
      return readHand(solver, got.held, hand);
    });
    shapes[0].fingers.forEach((finger, i) => near(finger.curl, shapes[1].fingers[i].curl, 1));
    // 是绕过去的：每根手指三节加起来弯了八十度以上
    for (const finger of shapes[0].fingers) expect(finger.curl[0] + finger.curl[1] + finger.curl[2]).toBeGreaterThan(80);
  });

  it('桌面：手指搭在台面上，指尖贴着面', () => {
    const got = grab(TABLE, [0.2, 1.04, 0.3]);
    const hand = handOf('Hand_L');
    const gaps = fingerGaps(got.held, hand, got.prop);
    for (const chain of gaps) {
      expect(chain[chain.length - 1]).toBeGreaterThan(0.004);
      expect(chain[chain.length - 1]).toBeLessThan(0.02);
    }
    for (const finger of readHand(solver, got.held, hand).fingers) expect(finger.curl[0] + finger.curl[1] + finger.curl[2]).toBeLessThan(45);
  });

  it('球：手指顺着球面搭下去', () => {
    const got = grab(BALL, [0.25, 1.13, 0.4]);
    const gaps = fingerGaps(got.held, handOf('Hand_L'), got.prop);
    for (const chain of gaps.slice(1)) {
      expect(chain[chain.length - 1]).toBeGreaterThan(0.003);
      expect(chain[chain.length - 1]).toBeLessThan(0.025);
    }
  });

  it('只动手指：手掌、手臂、别处都不动', () => {
    const got = grab(POLE, AT_POLE);
    const hand = handOf('Hand_L');
    const fingers = new Set([...hand.fingers, ...hand.extras].flat());
    got.held.local.forEach((q, i) => {
      if (!fingers.has(i)) expect(q).toEqual(got.seated.local[i]);
    });
    expect(got.held.root).toEqual(got.seated.root);
  });

  it('手边没有东西：不握，原样返回', () => {
    const hand = handOf('Hand_L');
    expect(closeHand(solver, rest, hand, propSolid(prop('box', { pos: [3, 0, 3] }), at0), k)).toBeNull();
    expect(gripHand(solver, rest, hand, propSolid(prop('box', { pos: [3, 0, 3] }), at0), k)).toBe(rest);
  });

  it('握紧度：1 是握到碰着，一半是半握，0 是伸直；往手背翘的不跟着松', () => {
    const shape = GESTURES.find((g) => g.name === '握着东西')!.shape;
    expect(loosen(shape, 1)).toEqual(shape);
    expect(loosen(shape, 0.5).fingers[0].curl).toEqual(shape.fingers[0].curl.map((v) => v / 2));
    expect(loosen(shape, 0).fingers.every((f) => f.curl.every((v) => v === 0))).toBe(true);
    expect(loosen(shape, 0).thumb).toMatchObject({ out: shape.thumb.out, down: 0, curl: [0, 0] });
    const back = { ...shape, fingers: shape.fingers.map((f) => ({ ...f, curl: [-18, 40, 0] })) as typeof shape.fingers };
    expect(loosen(back, 0.5).fingers[0].curl).toEqual([-18, 20, 0]);
    // 半握的手指比握实的直
    const got = grab(POLE, AT_POLE);
    const hand = handOf('Hand_L');
    const half = holdState(solver, got.seated, holdTargets(at0, [withGrip(got.link, 0.5)], [got.prop]), { grip: 'always' });
    const sum = (state: PoseState) => readHand(solver, state, hand).fingers.reduce((n, f) => n + f.curl.reduce((m, v) => m + Math.max(0, v), 0), 0);
    expect(sum(half)).toBeCloseTo(sum(got.held) / 2, 0);
  });
});

describe('跟随：带握紧度的手', () => {
  const got = grab(POLE, AT_POLE);
  const hand = handOf('Hand_L');
  const open = GESTURES.find((g) => g.name === '张开')!.shape;
  const targets = (links = [got.link], props = [got.prop]) => holdTargets(at0, links, props);

  it('握好了再算一遍：一点不变，返回的就是原来那份（存下来取整过的也一样）', () => {
    expect(holdState(solver, got.held, targets(), { grip: 'always' })).toBe(got.held);
    const posing = posingOf(solver, got.held);
    expect(holdPosing(solver, posing, targets(), { grip: 'always' })).toBe(posing);
  });

  it('平时只在手挪了、转了的时候重新握：自己摆的手指留着；说了要握才握回去；正拖着道具时不握', () => {
    const mine = shapeHand(solver, got.held, hand, open);
    expect(holdState(solver, mine, targets())).toBe(mine);
    expect(holdState(solver, mine, targets(), { grip: 'never' })).toBe(mine);
    const back = holdState(solver, mine, targets(), { grip: 'always' });
    near(readHand(solver, back, hand).fingers[0].curl, readHand(solver, got.held, hand).fingers[0].curl, 1);
    // 道具挪了：手跟过去，手指重新握（'never' 时只跟过去）
    const moved = updateProp([got.prop], 'p1', { pos: [0.27, 0, 0.35] });
    const follow = holdState(solver, mine, targets([got.link], [...moved]));
    expect(readHand(solver, follow, hand).fingers[0].curl[1]).toBeGreaterThan(20);
    const dragging = holdState(solver, mine, targets([got.link], [...moved]), { grip: 'never' });
    expect(readHand(solver, dragging, hand).fingers[0].curl[1]).toBeLessThan(5);
  });

  it('没有握紧度的连接：手指从来不动', () => {
    const plain = withGrip(got.link, 0);
    const mine = shapeHand(solver, got.held, hand, open);
    expect(holdState(solver, mine, targets([plain]), { grip: 'always' })).toBe(mine);
    expect(holdTargets(at0, [plain], [got.prop])[0]).not.toHaveProperty('grip');
  });

  it('够不着（道具挪远了）：手臂伸过去，手指不动', () => {
    const far = updateProp([got.prop], 'p1', { pos: [2.5, 0, 0.34] });
    const mine = shapeHand(solver, got.held, hand, open);
    const next = holdState(solver, mine, targets([got.link], [...far]), { grip: 'always' });
    for (const bone of hand.fingers.flat()) expect(next.local[bone]).toEqual(mine.local[bone]);
  });

  it('杆改粗了：重新落位、重新握，手指还是贴着杆、不插进去', () => {
    const [thick] = updateProp([got.prop], 'p1', { size: [0.09, 2.4, 0.09] });
    const placed = holdState(solver, got.held, targets([got.link], [thick]), { grip: 'never' });
    const again = grabLink(solver, placed, at0, thick, 'Hand_L', got.link.grip)!;
    const held = holdState(solver, again.state, targets([again.link], [thick]), { grip: 'always' });
    const gaps = fingerGaps(held, hand, thick);
    for (const chain of gaps.slice(1)) for (const gap of chain) expect(gap).toBeGreaterThan(0.004);
    // 粗了：手指比原来张得开
    const sum = (state: PoseState) => readHand(solver, state, hand).fingers.reduce((n, f) => n + f.curl[0] + f.curl[1] + f.curl[2], 0);
    expect(sum(held)).toBeLessThan(sum(got.held));
    expect(again.link.grip).toBe(1);
  });
});

describe('一键动作：做完手握着道具，连接带握紧度', () => {
  const act = (action: 'hang' | 'wrap' | 'hold' | 'top', p: SceneProp) => {
    const got = solvePropAction(action, { solver, place: at0, posing: emptyPosing(), links: [], prop: p, props: [p], follow: false });
    if ('error' in got) throw new Error(got.error);
    return got;
  };
  const tipsOf = (got: ReturnType<typeof act>, p: SceneProp, part: string) => {
    const f = forward(rig, stateOf(solver, got.posing));
    const solid = propSolid(p, got.place);
    return handOf(part).fingers.slice(1).map((chain) => solidDistance(solid, tailOf(rig, f, chain[chain.length - 1])));
  };

  it('吊着、腿缠杆：整个人跟着杆，两只手另外抓着它；四指绕在杆上', () => {
    const bar = prop('pole', { pos: [0, 2.1, 0], rot: [0, 0, 90] });
    const hang = act('hang', bar);
    expect(hang.links.map((l) => [l.part, l.grip])).toEqual([[BODY_LINK, undefined], ['Hand_L', 1], ['Hand_R', 1]]);
    for (const part of ['Hand_L', 'Hand_R']) for (const gap of tipsOf(hang, bar, part)) expect(Math.abs(gap)).toBeLessThan(0.02);
    // 做完再照连接摆一遍：一点不变
    expect(holdPosing(solver, hang.posing, holdTargets(hang.place, hang.links, [bar]), { grip: 'always' })).toBe(hang.posing);
    const pole = prop('pole', { pos: [0, 0, 0.5], size: [0.05, 2.6, 0.05] });
    const wrap = act('wrap', pole);
    expect(wrap.links.map((l) => [l.part, l.grip])).toEqual([[BODY_LINK, undefined], ['Hand_L', 1], ['Hand_R', 1]]);
    for (const part of ['Hand_L', 'Hand_R']) for (const gap of tipsOf(wrap, pole, part)) expect(Math.abs(gap)).toBeLessThan(0.02);
  });

  it('手扶着杆：握在杆上；手撑着桌面：两只手掌贴着台面', () => {
    const pole = prop('pole', { pos: [0.5, 0, 0.6] });
    const hold = act('hold', pole);
    const part = hold.part!;
    expect(linkOf(hold.links, part)!.grip).toBe(1);
    for (const gap of tipsOf(hold, pole, part)) expect(Math.abs(gap)).toBeLessThan(0.02);
    const table = prop('box', { size: [1.2, 0.75, 0.6], pos: [0, 0, 0.8] });
    const top = act('top', table);
    expect(top.links.map((l) => [l.part, l.grip])).toEqual([['Hand_L', 1], ['Hand_R', 1]]);
    const f = forward(rig, stateOf(solver, top.posing));
    for (const name of ['Hand_L', 'Hand_R']) {
      const hand = handOf(name);
      const palm = rotate(quatMul(f.rot[hand.bone], hand.frame), [0, -1, 0]);
      near(palm, [0, -1, 0], 3);
      for (const gap of tipsOf(top, table, name)) {
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeLessThan(0.02);
      }
    }
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
  });
});
