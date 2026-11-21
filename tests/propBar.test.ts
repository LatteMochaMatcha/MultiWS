// 第 7 期：吊在横杆上、腿缠杆（src/scene/propActions.ts），杆横过来（src/model/props.ts），「保存姿势」带上道具（src/scene/poseProps.ts）
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import type { V3 } from '../src/geometry/vec';
import { BODY_LINK, linkOf } from '../src/model/links';
import { POLE_HANG_HEIGHT, type PropKind, type SceneProp, clampProp, makeProp, poleIsFlat, propPoint, turnPole } from '../src/model/props';
import { type Place, placeY } from '../src/model/scene';
import { type BodySpec, defaultSpec } from '../src/model/spec';
import { emptyPosing } from '../src/pose/posing';
import { forward, posedBones, tailOf } from '../src/pose/rig';
import { type Solver, makeSolver, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { followPlace, linkTo, rideLink } from '../src/scene/follow';
import { capsulesOf, heightOf, placeCapsules, toScene } from '../src/scene/interact';
import { packPoseProps, placePoseProps, readPoseProps } from '../src/scene/poseProps';
import { type ActionResult, type PropAction, actionBlock, barOf, solvePropAction } from '../src/scene/propActions';
import { propClashes, propSolid, solidDistance } from '../src/scene/propTouch';

const at0 = { x: 0, z: 0, yaw: 0 };
const basic = (kind: PropKind, patch: Partial<SceneProp> = {}, id = 'p1'): SceneProp => clampProp({ ...makeProp([], kind, at0), id, ...patch });
/** 一根横杆：中点在原点上方 height 米，沿左右方向 */
const bar = (height: number, patch: Partial<SceneProp> = {}): SceneProp => basic('pole', { rot: [0, 0, 90], pos: [1.2, height, 0], ...patch });
const solverOf = (patch: (spec: BodySpec) => BodySpec = (s) => s): Solver => makeSolver(buildSkeleton(buildFigure(patch(defaultSpec()))).bones);
const solver = solverOf();
const height = heightOf(buildSkeleton(buildFigure(defaultSpec())).bones);
const k = height / 1.7;
const AWAY: Place = { x: 0.3, z: 1.2, yaw: 180 };

function act(action: PropAction, prop: SceneProp, more: { place?: Place; props?: SceneProp[]; solver?: Solver; follow?: boolean } = {}): ActionResult {
  const got = solvePropAction(action, { solver: more.solver ?? solver, place: more.place ?? AWAY, posing: emptyPosing(), prop, props: more.props ?? [prop], follow: more.follow });
  if ('error' in got) throw new Error(got.error);
  return got;
}
const errorOf = (action: PropAction, prop: SceneProp, props: SceneProp[] = [prop]) => {
  const got = solvePropAction(action, { solver, place: AWAY, posing: emptyPosing(), prop, props });
  return 'error' in got ? got.error : null;
};
const frameOf = (got: ActionResult, s: Solver = solver) => forward(s.rig, stateOf(s, got.posing));
const boneAt = (got: ActionResult, name: string, s: Solver = solver): V3 => toScene(got.place, frameOf(got, s).pos[s.rig.names.indexOf(name)]);
const tipAt = (got: ActionResult, name: string): V3 => toScene(got.place, tailOf(solver.rig, frameOf(got), solver.rig.names.indexOf(name)));
function deepest(got: ActionResult, props: SceneProp[]): number {
  const caps = placeCapsules(capsulesOf(posedBones(solver.rig, frameOf(got)), height), got.place);
  return propClashes(caps, props.map((p) => propSolid(p)), 0)[0]?.depth ?? 0;
}

describe('哪些道具算杆', () => {
  it('杆：竖着 90°，横过来 0°；两头、粗细照尺寸和朝向算', () => {
    const up = barOf(basic('pole'))!;
    expect(up.pitch).toBeCloseTo(90, 3);
    expect(up.r).toBeCloseTo(0.025, 6);
    expect(up.a).toEqual([0, 0, 0]);
    expect(up.b[1]).toBeCloseTo(2.4, 6);
    const flat = barOf(bar(2.1))!;
    expect(flat.pitch).toBeCloseTo(0, 3);
    expect(Math.abs(flat.b[0] - flat.a[0])).toBeCloseTo(2.4, 4);
    expect(flat.a[1]).toBeCloseTo(2.1, 4);
  });

  it('细长的箱子也算（照最长的那一边）；一般的箱子、台子、球、墙板不算', () => {
    const beam = barOf(basic('box', { size: [2, 0.06, 0.06], pos: [0, 2, 0] }))!;
    expect(beam.pitch).toBeCloseTo(0, 3);
    expect(beam.a[1]).toBeCloseTo(2.03, 4);
    expect(beam.length).toBe(2);
    expect(barOf(basic('box', { size: [0.06, 2, 0.06] }))!.pitch).toBeCloseTo(90, 3);
    expect(barOf(basic('box'))).toBeNull();
    expect(barOf(basic('box', { size: [2, 0.3, 0.06] }))).toBeNull();
    for (const kind of ['stand', 'ball', 'wall'] as const) expect(barOf(basic(kind))).toBeNull();
  });

  it('按钮：竖杆不能吊、横杆不能缠，太粗的都不行，不是杆的说要一根杆', () => {
    expect(actionBlock('hang', solver, basic('pole'))).toMatch(/横过来/);
    expect(actionBlock('hang', solver, bar(2.1))).toBeNull();
    expect(actionBlock('hang', solver, bar(2.1, { rot: [0, 0, 80] }))).toBeNull();
    expect(actionBlock('hang', solver, bar(2.1, { rot: [0, 0, 60] }))).toMatch(/横过来/);
    expect(actionBlock('wrap', solver, basic('pole'))).toBeNull();
    expect(actionBlock('wrap', solver, bar(2.1))).toMatch(/竖起来/);
    expect(actionBlock('wrap', solver, basic('pole', { rot: [8, 0, 0] }))).toMatch(/竖起来/);
    expect(actionBlock('wrap', solver, basic('pole', { size: [0.3, 2.4, 0.3] }))).toMatch(/太粗/);
    expect(actionBlock('hang', solver, basic('box'))).toMatch(/要一根杆/);
    expect(actionBlock('wrap', solver, basic('wall'))).toMatch(/要一根杆/);
    const none = solverOf((s) => ({ ...s, counts: { ...s.counts, armPairs: 0 } }));
    expect(actionBlock('hang', none, bar(2.1))).toMatch(/没有手臂/);
    const four = solverOf((s) => ({ ...s, counts: { ...s.counts, legs: 4 } }));
    expect(actionBlock('wrap', four, basic('pole'))).toMatch(/两条腿的人形/);
  });
});

describe('杆横过来、竖起来', () => {
  it('横过来：中点留在原地、抬到 2.1 米；再来一次竖回地面上', () => {
    const pole = basic('pole', { pos: [1, 0, -2], rot: [0, 30, 0] });
    expect(poleIsFlat(pole)).toBe(false);
    const flat = clampProp({ ...pole, ...turnPole(pole) });
    expect(poleIsFlat(flat)).toBe(true);
    const mid = propPoint(flat, [0, flat.size[1] / 2, 0]);
    expect(mid[0]).toBeCloseTo(1, 3);
    expect(mid[1]).toBeCloseTo(POLE_HANG_HEIGHT, 3);
    expect(mid[2]).toBeCloseTo(-2, 3);
    expect(barOf(flat)!.pitch).toBeCloseTo(0, 2);
    const back = clampProp({ ...flat, ...turnPole(flat) });
    expect(back.rot).toEqual([0, 30, 0]);
    expect(back.pos[0]).toBeCloseTo(1, 3);
    expect(back.pos[1]).toBe(0);
    expect(back.pos[2]).toBeCloseTo(-2, 3);
  });
});

describe('吊着', () => {
  it('杆够高：两只手握在杆上、整个人悬空、脚尖垂着，整个人跟着杆', () => {
    const prop = bar(2.1);
    const got = act('hang', prop);
    expect(got.missed).toBe(0);
    // 整个人跟着杆；两只手另外抓着它，带着握紧度
    expect(got.links.map((l) => l.part)).toEqual([BODY_LINK, 'Hand_L', 'Hand_R']);
    expect(got.links.slice(1).map((l) => l.grip)).toEqual([1, 1]);
    // 脸朝和杆垂直的方向（照原来的朝向挑近的那一个），吊在杆的正下面
    expect(Math.abs(got.place.yaw)).toBe(180);
    expect(boneAt(got, 'Hips')[2]).toBeCloseTo(0, 1);
    const solid = propSolid(prop);
    for (const hand of ['Hand_L', 'Hand_R']) {
      const wrist = boneAt(got, hand);
      // 手腕在杆下面一个手掌的地方
      expect(wrist[1]).toBeLessThan(2.1);
      expect(solidDistance(solid, wrist)).toBeLessThan(0.09 * k);
    }
    // 两只手分在身体两边，比肩膀宽一点
    expect(Math.abs(boneAt(got, 'Hand_L')[0] - boneAt(got, 'Hand_R')[0])).toBeCloseTo(0.4 * k, 1);
    // 脚离地、脚尖比脚踝低
    expect(placeY(got.place)).toBeGreaterThan(0.15);
    expect(tipAt(got, 'Toes_L')[1]).toBeGreaterThan(0.1);
    expect(tipAt(got, 'Toes_L')[1]).toBeLessThan(boneAt(got, 'Foot_L')[1]);
    expect(deepest(got, [prop])).toBeLessThan(0.02);
  });

  it('手指翻过杆握住：指尖在杆的另一边、贴着杆不插进去', () => {
    const prop = bar(2.1);
    const got = act('hang', prop);
    const solid = propSolid(prop);
    for (const side of ['L', 'R']) {
      const base = boneAt(got, `Middle1_${side}`);
      const tip = tipAt(got, `Middle3_${side}`);
      // 角色朝 -Z：手指根在杆后面（+Z），指尖翻到了前面（-Z）
      expect(base[2]).toBeGreaterThan(0.01);
      expect(tip[2]).toBeLessThan(0);
      expect(solidDistance(solid, tip)).toBeGreaterThan(0);
      expect(solidDistance(solid, tip)).toBeLessThan(0.03);
    }
  });

  it('杆矮一点：人站在地面那一层，屈着膝、脚抬起来；再矮就吊不起来', () => {
    const prop = bar(1.7);
    const got = act('hang', prop);
    expect(placeY(got.place)).toBe(0);
    // 胯比站着低，脚踝抬起来了、在身后
    expect(boneAt(got, 'Hips')[1]).toBeLessThan(0.75);
    expect(boneAt(got, 'Foot_L')[1]).toBeGreaterThan(0.07);
    expect(boneAt(got, 'Foot_L')[2]).toBeGreaterThan(0.15);
    for (const hand of ['Hand_L', 'Hand_R']) expect(solidDistance(propSolid(prop), boneAt(got, hand))).toBeLessThan(0.09 * k);
    expect(errorOf('hang', bar(1.3))).toMatch(/太矮/);
  });

  it('下面有台子：照台子的顶面算脚下', () => {
    const prop = bar(2.1);
    const box = basic('box', { size: [1, 0.4, 1], pos: [0.3, 0, 0] }, 'p2');
    const got = act('hang', prop, { props: [prop, box] });
    expect(placeY(got.place)).toBe(0.4);
    expect(boneAt(got, 'Foot_L')[1]).toBeGreaterThan(0.45);
  });

  it('杆斜一点：两只手一高一低都握在杆上；太短的握不下', () => {
    const prop = bar(2.1, { rot: [0, 30, 80] });
    const got = act('hang', prop);
    expect(got.missed).toBe(0);
    const solid = propSolid(prop);
    const l = boneAt(got, 'Hand_L');
    const r = boneAt(got, 'Hand_R');
    expect(Math.abs(l[1] - r[1])).toBeGreaterThan(0.03);
    for (const wrist of [l, r]) expect(solidDistance(solid, wrist)).toBeLessThan(0.1 * k);
    expect(errorOf('hang', bar(2.1, { size: [0.05, 0.15, 0.05] }))).toMatch(/太短/);
  });

  it('两对手臂开着「一起动」：第二对也举起来', () => {
    const many = solverOf((s) => ({ ...s, counts: { ...s.counts, armPairs: 2 } }));
    const prop = bar(2.2);
    const got = act('hang', prop, { solver: many, follow: true });
    const f = frameOf(got, many);
    const second = many.limbs.find((l) => l.kind === 'arm' && l.pair === 1)!;
    expect(f.pos[second.end][1]).toBeGreaterThan(f.pos[second.upper][1] + 0.2);
  });
});

describe('腿缠杆', () => {
  const pole = basic('pole');

  it('面朝杆、身体离地，两只手握在杆上，两条腿一高一低都贴着杆，整个人跟着杆', () => {
    const got = act('wrap', pole);
    expect(got.missed).toBe(0);
    // 整个人跟着杆；两只手另外抓着它，带着握紧度
    expect(got.links.map((l) => l.part)).toEqual([BODY_LINK, 'Hand_L', 'Hand_R']);
    expect(got.links.slice(1).map((l) => l.grip)).toEqual([1, 1]);
    const solid = propSolid(pole);
    // 面朝杆：从角色站的地方到杆的方向就是它的朝向
    const yaw = (got.place.yaw * Math.PI) / 180;
    const toPole = Math.hypot(got.place.x, got.place.z);
    expect((-got.place.x * Math.sin(yaw) - got.place.z * Math.cos(yaw)) / toPole).toBeCloseTo(1, 3);
    // 从原来站的那一边缠上去
    expect(got.place.z).toBeGreaterThan(0);
    for (const hand of ['Hand_L', 'Hand_R']) expect(solidDistance(solid, boneAt(got, hand))).toBeLessThan(0.06 * k);
    // 右手在上、左手在下
    expect(boneAt(got, 'Hand_R')[1]).toBeGreaterThan(boneAt(got, 'Hand_L')[1] + 0.2 * k);
    // 两个膝盖、两条小腿都挨着杆（膝盖一左一右夹着杆，一个高一个低）
    for (const knee of ['LowerLeg_L', 'LowerLeg_R']) expect(solidDistance(solid, boneAt(got, knee))).toBeLessThan(0.12 * k);
    expect(boneAt(got, 'LowerLeg_L')[1]).toBeGreaterThan(boneAt(got, 'LowerLeg_R')[1] + 0.2 * k);
    // 脚离地
    for (const toe of ['Toes_L', 'Toes_R']) expect(tipAt(got, toe)[1]).toBeGreaterThan(0.1);
    // 身体和杆不插进去（大腿挨着杆，胶囊体粗一点，容一两厘米）
    expect(deepest(got, [pole])).toBeLessThan(0.03);
  });

  it('手指握着杆：指尖贴着杆不插进去', () => {
    const got = act('wrap', pole);
    const solid = propSolid(pole);
    for (const side of ['L', 'R']) {
      const tip = tipAt(got, `Middle3_${side}`);
      expect(solidDistance(solid, tip)).toBeGreaterThan(0);
      expect(solidDistance(solid, tip)).toBeLessThan(0.03);
    }
  });

  it('杆矮：往下挪到脚快碰地；再矮就缠不上去', () => {
    const low = basic('pole', { size: [0.05, 1.68, 0.05] });
    const got = act('wrap', low);
    expect(placeY(got.place)).toBeLessThan(placeY(act('wrap', pole).place));
    // 上面那只手没超过杆顶
    expect(boneAt(got, 'Hand_R')[1]).toBeLessThan(1.68);
    expect(errorOf('wrap', basic('pole', { size: [0.05, 1.4, 0.05] }))).toMatch(/太矮/);
  });

  it('粗一点的杆照样缠：身体离杆远一点', () => {
    const thick = basic('pole', { size: [0.14, 2.4, 0.14] });
    const got = act('wrap', thick);
    expect(deepest(got, [thick])).toBeLessThan(0.04);
    for (const hand of ['Hand_L', 'Hand_R']) expect(solidDistance(propSolid(thick), boneAt(got, hand))).toBeLessThan(0.06 * k);
  });

  it('挪杆、转杆：人跟着走', () => {
    const got = act('wrap', pole);
    const moved = clampProp({ ...pole, pos: [2, 0, 1], rot: [0, 90, 0] });
    const place = followPlace(got.place, got.links, [moved]);
    // 离杆还是那么远
    expect(Math.hypot(place.x - 2, place.z - 1)).toBeCloseTo(Math.hypot(got.place.x, got.place.z), 2);
    expect(placeY(place)).toBeCloseTo(placeY(got.place), 3);
  });
});

describe('「保存姿势」带上道具', () => {
  const chair = basic('box', { pos: [2, 0, 3], rot: [0, 40, 0] }, 'p3');
  const other = basic('ball', { pos: [-1, 0, 0] }, 'p4');
  const place: Place = { x: 2.2, z: 3.4, yaw: 130, y: 0.45 };

  it('没连着道具的不带；连着的只带那几件，位置换成相对角色的', () => {
    expect(packPoseProps(place, [], [chair, other])).toBeNull();
    expect(packPoseProps(place, undefined, [chair])).toBeNull();
    const links = [rideLink(chair, place)];
    const packed = packPoseProps(place, links, [chair, other])!;
    expect(packed.props.map((p) => p.id)).toEqual(['p3']);
    expect(packed.lift).toBe(0.45);
    // 朝向相对角色；高度照原样
    expect(packed.props[0].rot[1]).toBe(-90);
    expect(packed.props[0].pos[1]).toBe(0);
    expect(Math.hypot(packed.props[0].pos[0], packed.props[0].pos[2])).toBeCloseTo(Math.hypot(0.2, 0.4), 3);
  });

  it('存了再读、放到别处：道具相对角色还在原来的地方，编号接着场景里的往下起，角色照连接站回去', () => {
    const hand: V3 = [2.1, 0.9, 3.2];
    const links = [rideLink(chair, place), linkTo(chair, 'Hand_L', hand)];
    const packed = readPoseProps(JSON.parse(JSON.stringify(packPoseProps(place, links, [chair, other]))))!;
    expect(packed.links.map((l) => l.part)).toEqual([BODY_LINK, 'Hand_L']);
    const there: Place = { x: -4, z: 1, yaw: -20 };
    const existing = [basic('pole', {}, 'p1'), basic('pole', {}, 'p7')];
    const got = placePoseProps(packed, there, existing);
    expect(got.props.map((p) => p.id)).toEqual(['p8']);
    expect(got.links.every((l) => l.prop === 'p8')).toBe(true);
    // 角色站回连接记的那个地方：左右、前后、朝向就是现在站的，离地照存的时候
    expect(got.place.x).toBeCloseTo(-4, 2);
    expect(got.place.z).toBeCloseTo(1, 2);
    expect(got.place.yaw).toBeCloseTo(-20, 0);
    expect(placeY(got.place)).toBeCloseTo(0.45, 2);
    // 道具离角色还是那么远、朝向差还是那么多
    const put = got.props[0];
    expect(Math.hypot(put.pos[0] + 4, put.pos[2] - 1)).toBeCloseTo(Math.hypot(0.2, 0.4), 2);
    expect(put.rot[1]).toBeCloseTo(-110, 3);
    expect(linkOf(got.links, 'Hand_L')).toBeDefined();
  });

  it('只钉着手的（没有整个人跟着）：角色原地不动，只换离地多高', () => {
    const links = [linkTo(chair, 'Hand_R', [2.1, 0.5, 3.1])];
    const packed = packPoseProps({ x: 2.2, z: 3.4, yaw: 130 }, links, [chair])!;
    const got = placePoseProps(packed, { x: 1, z: 1, yaw: 0, y: 0.3 }, []);
    expect(got.place).toEqual({ x: 1, z: 1, yaw: 0 });
    expect(got.props[0].id).toBe('p1');
  });

  it('文件里没有道具、读不懂的：当作没带', () => {
    expect(readPoseProps(undefined)).toBeNull();
    expect(readPoseProps({ props: [], links: [] })).toBeNull();
    expect(readPoseProps({ props: 'x', links: 3 })).toBeNull();
    // 连接指着的道具不在里面
    expect(readPoseProps({ props: [chair], links: [{ prop: 'p9', part: BODY_LINK, at: [0, 1, 0], off: [0, 0, 0] }] })).toBeNull();
  });
});
