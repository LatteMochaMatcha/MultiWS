// 抓住道具第 6 期（docs/grab-plan.md）：一键动作「拿着」「两手端着」「抱着」「举过头顶」——道具到角色身上来、跟着手或者胸口走；
// 「手扶着」头顶的横杆；伸手抓住（AI 助手的工具用）。都在 src/scene/propActions.ts
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, type V3, quatEuler } from '../src/geometry/vec';
import { BODY_LINK, type PropLink, isLimbPart, linkOf, linkPoint } from '../src/model/links';
import { type PropKind, type SceneProp, clampProp, makeProp } from '../src/model/props';
import type { Place } from '../src/model/scene';
import { type BodySpec, defaultSpec } from '../src/model/spec';
import { emptyPosing } from '../src/pose/posing';
import { forward } from '../src/pose/rig';
import { turnBone } from '../src/pose/solve';
import { type Solver, makeSolver, posingOf, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { barOf } from '../src/scene/bar';
import { placeCarried } from '../src/scene/carry';
import { holdState, holdTargets, rideLink, sceneRot } from '../src/scene/follow';
import { heightOf, toScene } from '../src/scene/interact';
import { type ActionResult, PROP_ACTIONS, type PropAction, actionBlock, isPickAction, solveGrab, solvePropAction } from '../src/scene/propActions';
import { closestOnSolid, propSolid } from '../src/scene/propTouch';

const at0: Place = { x: 0, z: 0, yaw: 0 };
const basic = (kind: PropKind, patch: Partial<SceneProp> = {}, id = 'p1'): SceneProp => clampProp({ ...makeProp([], kind, at0), id, ...patch });
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const solverOf = (patch: (spec: BodySpec) => BodySpec = (s) => s): Solver => makeSolver(buildSkeleton(buildFigure(patch(defaultSpec()))).bones);
const solver = solverOf();
const height = heightOf(buildSkeleton(buildFigure(defaultSpec())).bones);
const k = height / 1.7;
/** 角色站在这里（不在原点、转了个角度：坐标换算错了看得出来） */
const HERE: Place = { x: 0.6, z: -0.4, yaw: 35 };

type More = { place?: Place; props?: SceneProp[]; links?: readonly PropLink[]; posing?: ActionResult['posing']; solver?: Solver };
function outcome(action: PropAction, prop: SceneProp, more: More = {}) {
  return solvePropAction(action, { solver: more.solver ?? solver, place: more.place ?? HERE, posing: more.posing ?? emptyPosing(), links: more.links, prop, props: more.props ?? [prop] });
}
function act(action: PropAction, prop: SceneProp, more: More = {}): ActionResult {
  const got = outcome(action, prop, more);
  if ('error' in got) throw new Error(got.error);
  return got;
}
const errorOf = (action: PropAction, prop: SceneProp, more: More = {}) => {
  const got = outcome(action, prop, more);
  return 'error' in got ? got.error : null;
};

/** 摆好以后某根骨骼在场景里的位置和朝向 */
function boneAt(got: ActionResult, name: string, with_: Solver = solver): { point: V3; rot: Quat } {
  const f = forward(with_.rig, stateOf(with_, got.posing));
  const bone = with_.rig.index.get(name)!;
  return { point: toScene(got.place, f.pos[bone]), rot: sceneRot(got.place, f.rot[bone]) };
}
/** 做完以后道具在哪：照带着它的那一处（手、胸口）算，和页面上一样 */
function carried(got: ActionResult, prop: SceneProp, with_: Solver = solver): SceneProp {
  const link = got.links.find((l) => l.carry && l.prop === prop.id)!;
  expect(link).toBeTruthy();
  return placeCarried([prop], [{ link, ...boneAt(got, link.part, with_) }])[0];
}
/** 这只手的手腕离道具表面多远 */
const handOff = (got: ActionResult, prop: SceneProp, part: string) => closestOnSolid(propSolid(prop), boneAt(got, part).point).dist;
/** 道具占的盒子（场景坐标） */
const boxOf = (prop: SceneProp) => propSolid(prop);
/** 站着时头顶多高（角色站在地面上） */
const headTop = (_got: ActionResult) => height;
/** 站着时肩膀多高、手臂多长 */
const rest = forward(solver.rig, stateOf(solver, emptyPosing()));
const armR = solver.limbs.find((l) => l.name === 'Hand_R')!;
const shoulderY = rest.pos[armR.upper][1];
const reach = armR.len1 + armR.len2;

const BOX = basic('box', { size: [0.3, 0.2, 0.2], pos: [2, 0, 1], rot: [0, 20, 0] });
const BALL = basic('ball', { size: [0.22, 0.22, 0.22], pos: [-1, 0, 2] });
const POLE = basic('pole', { pos: [1.5, 0, 1.5] });
const STICK = basic('box', { size: [0.03, 0.3, 0.03], pos: [1, 0, 1] });
const TABLE = basic('box', { size: [1.6, 0.75, 0.9], pos: [2, 0, 2] });

describe('四个动作在按钮上', () => {
  it('排在原来七个后面；哪四个是把道具拿过来的', () => {
    expect(PROP_ACTIONS.map((a) => a.key)).toEqual(['sit', 'lie', 'top', 'hold', 'lean', 'hang', 'wrap', 'carry', 'both', 'hug', 'lift']);
    expect(PROP_ACTIONS.map((a) => a.key).filter(isPickAction)).toEqual(['carry', 'both', 'hug', 'lift']);
  });

  it('一眼看得出做不了的：太大、太宽、杆太短、没有手臂', () => {
    for (const action of ['carry', 'both', 'hug', 'lift'] as const) expect(actionBlock(action, solver, BOX)).toBeNull();
    expect(actionBlock('carry', solver, TABLE)).toMatch(/一只手拿不了/);
    expect(actionBlock('both', solver, TABLE)).toBeNull();
    expect(actionBlock('both', solver, basic('box', { size: [1.6, 0.75, 1.4] }))).toMatch(/太宽/);
    expect(actionBlock('carry', solver, POLE)).toBeNull();
    expect(actionBlock('both', solver, basic('box', { size: [0.03, 0.12, 0.03] }))).toMatch(/太短/);
    expect(actionBlock('carry', solver, basic('box', { size: [0.03, 0.12, 0.03] }))).toBeNull();
    const armless = solverOf((s) => ({ ...s, counts: { ...s.counts, armPairs: 0 } }));
    expect(actionBlock('carry', armless, BOX)).toMatch(/没有手臂/);
  });
});

describe('拿着（一只手）', () => {
  it('箱子托在手心上：角色不动，道具到手上来，底在手腕上面，连接是「道具跟着这只手」', () => {
    const got = act('carry', BOX);
    expect(got.place).toEqual(HERE);
    expect(got.missed).toBe(0);
    expect(got.links.map((l) => [l.part, l.prop, l.carry === true, (l.grip ?? 0) > 0])).toEqual([[got.part, 'p1', true, true]]);
    const now = carried(got, BOX);
    const box = boxOf(now);
    const wrist = boneAt(got, got.part!).point;
    // 底面在手腕上面一点，手在它底下
    expect(box.min[1]).toBeGreaterThan(wrist[1]);
    expect(box.min[1] - wrist[1]).toBeLessThan(0.08);
    expect(handOff(got, now, got.part!)).toBeLessThan(0.07);
    // 没歪，大小没变；和角色对正（差 90° 的倍数）
    expect([now.rot[0], now.rot[2]]).toEqual([0, 0]);
    expect(now.size).toEqual(BOX.size);
    expect(Math.abs((((now.rot[1] - HERE.yaw) % 90) + 90) % 90)).toBeLessThan(0.2);
  });

  it('道具在角色左边用左手，在右边、正前方用右手；再点一次换另一只手', () => {
    const left = act('carry', BOX, { place: at0, props: [{ ...BOX, pos: [1, 0, 0.5] }] });
    expect(act('carry', { ...BOX, pos: [1, 0, 0.5] }, { place: at0 }).part).toBe('Hand_L');
    expect(left.part).toBe('Hand_L');
    const first = act('carry', { ...BOX, pos: [-1, 0, 0.5] }, { place: at0 });
    expect(first.part).toBe('Hand_R');
    const again = act('carry', carried(first, { ...BOX, pos: [-1, 0, 0.5] }), { place: at0, posing: first.posing, links: first.links });
    expect(again.part).toBe('Hand_L');
    expect(again.links.map((l) => l.part)).toEqual(['Hand_L']);
  });

  it('球也托着；长杆竖着握、下头不戳进地里；短棍握在正中', () => {
    const ball = act('carry', BALL);
    expect(handOff(ball, carried(ball, BALL), ball.part!)).toBeLessThan(0.07);
    const pole = act('carry', POLE);
    const upright = barOf(carried(pole, POLE))!;
    expect(upright.pitch).toBeGreaterThan(89);
    expect(upright.a[1]).toBeGreaterThanOrEqual(0.015);
    const wrist = boneAt(pole, pole.part!).point;
    expect(Math.hypot(wrist[0] - upright.a[0], wrist[2] - upright.a[2])).toBeLessThan(0.12);
    const stick = act('carry', STICK);
    const short = barOf(carried(stick, STICK))!;
    expect(short.pitch).toBeGreaterThan(89);
    const grip = boneAt(stick, stick.part!).point;
    expect(Math.abs((short.a[1] + short.b[1]) / 2 - grip[1])).toBeLessThan(0.02);
  });

  it('桌子太大：说原因，不做', () => {
    expect(errorOf('carry', TABLE)).toMatch(/一只手拿不了/);
  });
});

describe('两手端着', () => {
  it('箱子：两只手一左一右扶在两面上，道具在身前，跟着右手', () => {
    const got = act('both', BOX);
    expect(got.place).toEqual(HERE);
    expect(got.missed).toBe(0);
    expect(got.links.map((l) => [l.part, l.carry === true]).sort()).toEqual([
      ['Hand_L', false],
      ['Hand_R', true],
    ]);
    const now = carried(got, BOX);
    for (const part of ['Hand_L', 'Hand_R']) {
      expect(handOff(got, now, part)).toBeLessThan(0.07);
      // 记的那一点就是手现在在的地方
      expect(dist(linkPoint(now, linkOf(got.links, part)!), boneAt(got, part).point)).toBeLessThan(3e-3);
    }
    // 两只手在道具的两边
    const centre = propSolid(now, got.place);
    const f = forward(solver.rig, stateOf(solver, got.posing));
    const l = f.pos[solver.rig.index.get('Hand_L')!];
    const r = f.pos[solver.rig.index.get('Hand_R')!];
    expect(l[0]).toBeGreaterThan(centre.max[0] - 0.01);
    expect(r[0]).toBeLessThan(centre.min[0] + 0.01);
    // 在身前，没插进身体
    expect(centre.min[2]).toBeGreaterThan(0.08 * k);
  });

  it('薄板托在底下；宽的那一面够不到就转 90°；两面都太宽说原因', () => {
    const tray = basic('box', { size: [0.5, 0.03, 0.35], pos: [1, 0.8, 1] });
    const got = act('both', tray);
    const now = carried(got, tray);
    for (const part of ['Hand_L', 'Hand_R']) expect(boneAt(got, part).point[1]).toBeLessThan(boxOf(now).min[1]);
    const plank = basic('box', { size: [1.4, 0.2, 0.3], pos: [1, 0, 1] });
    const turned = act('both', plank, { place: at0 });
    expect(Math.abs(Math.abs(carried(turned, plank).rot[1]) - 90)).toBeLessThan(0.2);
    expect(errorOf('both', basic('box', { size: [1.6, 0.75, 1.4] }))).toMatch(/太宽/);
  });

  it('杆横着握在胯前：两只手都在杆上', () => {
    const got = act('both', POLE);
    const bar = barOf(carried(got, POLE))!;
    expect(bar.pitch).toBeLessThan(2);
    expect(got.missed).toBe(0);
    for (const part of ['Hand_L', 'Hand_R']) expect(handOff(got, carried(got, POLE), part)).toBeLessThan(0.09);
    const wrist = boneAt(got, 'Hand_R').point;
    expect(wrist[1]).toBeLessThan(boneAt(got, 'UpperChest').point[1]);
  });
});

describe('抱着', () => {
  it('道具贴在胸前、跟着胸口；两只手搂着它', () => {
    const got = act('hug', BOX);
    expect(got.place).toEqual(HERE);
    const chest = got.links.find((l) => l.carry)!;
    expect(isLimbPart(chest.part)).toBe(false);
    expect(chest.part).toBe('UpperChest');
    expect(got.links.filter((l) => !l.carry).map((l) => l.part).sort()).toEqual(['Hand_L', 'Hand_R']);
    const now = carried(got, BOX);
    for (const part of ['Hand_L', 'Hand_R']) expect(handOff(got, now, part)).toBeLessThan(0.07);
    // 在胸口前面，挨着身体
    const solid = propSolid(now, got.place);
    expect(solid.min[2]).toBeGreaterThan(0.05 * k);
    expect(solid.min[2]).toBeLessThan(0.2 * k);
    // 宽的那一面贴着胸口
    expect(solid.max[0] - solid.min[0]).toBeGreaterThan(solid.max[2] - solid.min[2]);
  });

  it('抱好以后弯腰：道具跟着胸口，两只手跟得上', () => {
    const got = act('hug', BOX);
    const start = stateOf(solver, got.posing);
    const spine = solver.rig.index.get('Spine')!;
    const [x, y, z, w] = quatEuler(0.6, 0, 0);
    const q = forward(solver.rig, start).rot[spine];
    const bent = turnBone(solver, start, spine, [w * q[0] + x * q[3] + y * q[2] - z * q[1], w * q[1] - x * q[2] + y * q[3] + z * q[0], w * q[2] + x * q[1] - y * q[0] + z * q[3], w * q[3] - x * q[0] - y * q[1] - z * q[2]], []);
    const bentGot = { ...got, posing: posingOf(solver, bent, got.posing) };
    const now = carried(bentGot, BOX);
    expect(now.pos[1]).toBeLessThan(carried(got, BOX).pos[1] - 0.03);
    const after = holdState(solver, bent, holdTargets(got.place, got.links, [now]), { grip: 'never' });
    const settled = { ...got, posing: posingOf(solver, after, got.posing) };
    for (const part of ['Hand_L', 'Hand_R']) expect(dist(boneAt(settled, part).point, linkPoint(now, linkOf(got.links, part)!))).toBeLessThan(3e-3);
  });

  it('杆是竖着抱：不朝前戳出去，下头不戳进地里', () => {
    const got = act('hug', POLE);
    const now = carried(got, POLE);
    const bar = barOf(now)!;
    expect(bar.pitch).toBeGreaterThan(88);
    expect(Math.min(bar.a[1], bar.b[1])).toBeGreaterThan(-1e-6);
    expect(got.links.find((l) => l.carry)!.part).toBe('UpperChest');
  });
});

describe('举过头顶', () => {
  it('箱子在头顶上面，两只手托着底，跟着右手', () => {
    const got = act('lift', BOX);
    expect(got.place).toEqual(HERE);
    expect(got.missed).toBe(0);
    const now = carried(got, BOX);
    expect(boxOf(now).min[1]).toBeGreaterThan(headTop(got));
    for (const part of ['Hand_L', 'Hand_R']) {
      expect(handOff(got, now, part)).toBeLessThan(0.07);
      expect(boneAt(got, part).point[1]).toBeGreaterThan(boneAt(got, 'Head').point[1]);
    }
    expect(got.links.find((l) => l.carry)?.part).toBe('Hand_R');
  });

  it('杆横着举：比头高，两只手握着', () => {
    const got = act('lift', POLE);
    const bar = barOf(carried(got, POLE))!;
    expect(bar.pitch).toBeLessThan(2);
    expect(bar.a[1]).toBeGreaterThan(headTop(got));
    for (const part of ['Hand_L', 'Hand_R']) expect(handOff(got, carried(got, POLE), part)).toBeLessThan(0.09);
  });
});

describe('拿不起来的', () => {
  it('人正坐在、站在这件上：四个动作都说原因', () => {
    const ride = [rideLink(TABLE, HERE)];
    for (const action of ['both', 'hug', 'lift'] as const) expect(errorOf(action, TABLE, { links: ride, props: [TABLE] })).toMatch(/拿不起来/);
    const stool = basic('stand', { size: [0.4, 0.4, 0.4] });
    expect(errorOf('carry', stool, { links: [rideLink(stool, HERE)] })).toMatch(/拿不起来/);
  });

  it('原来连在这件上的换成新的，连在别的道具上的留着', () => {
    const chair = basic('stand', { size: [0.5, 0.45, 0.5], pos: [0.6, 0, -0.4] }, 'p2');
    const before = [rideLink(chair, HERE)];
    const first = act('both', BOX, { links: before, props: [BOX, chair] });
    expect(first.links.map((l) => `${l.part}>${l.prop}`).sort()).toEqual(['Hand_L>p1', 'Hand_R>p1', `${BODY_LINK}>p2`]);
    const then = act('hug', carried(first, BOX), { links: first.links, posing: first.posing, props: [BOX, chair] });
    expect(then.links.map((l) => `${l.part}>${l.prop}${l.carry ? '*' : ''}`).sort()).toEqual(['Hand_L>p1', 'Hand_R>p1', 'UpperChest>p1*', `${BODY_LINK}>p2`]);
  });
});

describe('手扶着：头顶的横杆', () => {
  /** 一根横杆：比头高一点，站着举手够得着 */
  const RAIL_Y = Math.max(height + 0.05, shoulderY + reach * 0.75);
  const RAIL = basic('pole', { size: [0.04, 2.4, 0.04], pos: [0, RAIL_Y, 2], rot: [0, 0, 90] });

  it('走到杆下面，举起右手握住；手比头高，握在杆上', () => {
    const got = act('hold', RAIL, { place: { x: 0.3, z: 0.2, yaw: 0 } });
    expect(got.walked).toBe(true);
    expect(got.part).toBe('Hand_R');
    expect(got.missed).toBe(0);
    // 站在杆下面
    expect(Math.abs(got.place.z - 2)).toBeLessThan(0.2);
    const wrist = boneAt(got, 'Hand_R').point;
    expect(wrist[1]).toBeGreaterThan(boneAt(got, 'Head').point[1]);
    expect(handOff(got, RAIL, 'Hand_R')).toBeLessThan(0.09);
    expect(got.links.map((l) => [l.part, l.carry === true, (l.grip ?? 0) > 0])).toEqual([['Hand_R', false, true]]);
  });

  it('再点一次：原地换左手，右手还握着', () => {
    const first = act('hold', RAIL, { place: { x: 0.3, z: 0.2, yaw: 0 } });
    const again = act('hold', RAIL, { place: first.place, posing: first.posing, links: first.links });
    expect(again.walked).toBe(false);
    expect(again.part).toBe('Hand_L');
    expect(again.place).toEqual(first.place);
    expect(again.links.map((l) => l.part).sort()).toEqual(['Hand_L', 'Hand_R']);
    expect(handOff(again, RAIL, 'Hand_L')).toBeLessThan(0.09);
  });

  it('杆在胸口那么高：照老样子扶（手比肩膀低）；高得够不着也照老样子', () => {
    const low = basic('pole', { size: [0.04, 2.4, 0.04], pos: [0, 1.1, 2], rot: [0, 0, 90] });
    const got = act('hold', low, { place: { x: 0.3, z: 0.2, yaw: 0 } });
    expect(boneAt(got, got.part!).point[1]).toBeLessThan(boneAt(got, 'Head').point[1]);
    const high = basic('pole', { size: [0.04, 2.4, 0.04], pos: [0, 2.6, 2], rot: [0, 0, 90] });
    const far = act('hold', high, { place: { x: 0.3, z: 0.2, yaw: 0 } });
    expect(far.missed).toBe(1);
  });
});

describe('伸手抓住（AI 助手用）', () => {
  const grab = (part: string, prop: SceneProp, more: { carry?: boolean; links?: readonly PropLink[] } = {}) =>
    solveGrab({ solver, place: at0, posing: emptyPosing(), links: more.links, prop, props: [prop], part, carry: more.carry });

  it('够得着：手伸过去抓住，身体不动；carry 是道具跟着这只手', () => {
    const near = basic('box', { size: [0.3, 0.3, 0.3], pos: [0.35, 0.9, 0.3] });
    const got = grab('Hand_L', near);
    if ('error' in got) throw new Error(got.error);
    expect(got.place).toEqual(at0);
    expect(got.links.map((l) => [l.part, l.carry === true])).toEqual([['Hand_L', false]]);
    // 扣在棱上的话手腕在棱外面一个手掌远
    expect(handOff(got, near, 'Hand_L')).toBeLessThan(0.11);
    const held = grab('Hand_L', near, { carry: true });
    if ('error' in held) throw new Error(held.error);
    expect(held.links[0].carry).toBe(true);
  });

  it('脚也行；够不着说原因；没有这只手说没有', () => {
    const step = basic('box', { size: [0.3, 0.15, 0.3], pos: [0.1, 0, 0.3] });
    const foot = grab('Foot_L', step);
    expect('error' in foot).toBe(false);
    const got = grab('Hand_L', basic('box', { pos: [3, 0, 3] }));
    expect('error' in got && got.error).toMatch(/够不着/);
    const none = grab('Hand_L.002', step);
    expect('error' in none && none.error).toMatch(/没有这只/);
  });
});
