// 抓住道具第 4 期（docs/grab-plan.md）：道具跟着手——连接上的 carry（src/model/links.ts）、
// 照手算道具现在在哪（src/scene/carry.ts）、带着道具的手不算「钉在道具上」（src/scene/follow.ts）
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, type V3, len, quatEuler, quatMul, rotate, sub } from '../src/geometry/vec';
import { BODY_LINK, type PropLink, carriedProp, linkOf, linkPoint, linkRot, normalizeLinks, withCarry, withGrip } from '../src/model/links';
import { type PropKind, type SceneProp, clampProp, makeProp, propEuler, propQuat } from '../src/model/props';
import { type Place, normalizeScene, serializeScene } from '../src/model/scene';
import { defaultSpec } from '../src/model/spec';
import { emptyPosing } from '../src/pose/posing';
import { forward, tailOf } from '../src/pose/rig';
import { capturePins, dragBody, reachOnly } from '../src/pose/solve';
import { makeSolver, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { carrierIn, carryLoops, placeCarried, samePose } from '../src/scene/carry';
import { grabLink, holdState, holdTargets, linkTo, rideLink, sceneRot } from '../src/scene/follow';
import { scaleOf } from '../src/scene/grip';
import { toScene } from '../src/scene/interact';
import { packPoseProps, placePoseProps, readPoseProps } from '../src/scene/poseProps';
import { propSolid, solidDistance } from '../src/scene/propTouch';

const at0: Place = { x: 0, z: 0, yaw: 0 };
const prop = (kind: PropKind, patch: Partial<SceneProp> = {}, id = 'p1'): SceneProp => clampProp({ ...makeProp([], kind, at0), id, ...patch });
const near = (a: readonly number[], b: readonly number[], digits = 3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const dist = (a: V3, b: V3) => len(sub(a, b));
const sameTurn = (a: Quat, b: Quat, digits = 4) => ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[]).forEach((v) => near(rotate(a, v), rotate(b, v), digits));

const solver = makeSolver(buildSkeleton(buildFigure(defaultSpec())).bones);
const { rig } = solver;
const rest = stateOf(solver, emptyPosing());
const limbOf = (name: string) => solver.limbs.findIndex((l) => l.name === name);
const handOf = (name: string) => solver.hands.find((h) => h.name === name)!;
/** 这只手现在在场景里的位置和朝向 */
const handAt = (state: typeof rest, part: string, place: Place = at0) => {
  const f = forward(rig, state);
  const end = solver.limbs[limbOf(part)].end;
  return { point: toScene(place, f.pos[end]), rot: sceneRot(place, f.rot[end]) };
};

/** 一个小盒子（12 厘米见方），左手伸过去抓住、握上 */
const BOX = prop('box', { size: [0.12, 0.12, 0.12], pos: [0.3, 1.0, 0.3] });
const reached = reachOnly(solver, rest, limbOf('Hand_L'), [0.3, 1.14, 0.3]);
const got = grabLink(solver, reached, at0, BOX, 'Hand_L', 1)!;
const held = holdState(solver, got.state, holdTargets(at0, [got.link], [BOX]), { grip: 'always' });
const CARRY = withCarry(got.link, true);

describe('道具的旋转：四元数换回角度', () => {
  it('和 propQuat 一来一回是同一个旋转', () => {
    for (const rot of [
      [0, 0, 0],
      [0, 40, 0],
      [30, 0, 0],
      [0, 0, 30],
      [25, -70, 110],
      [-80, 170, 15],
      [90, 30, 0],
      [-90, -120, 0],
      [89.9, 10, 20],
    ] as V3[]) {
      const q = propQuat(rot);
      sameTurn(propQuat(propEuler(q)), q);
    }
  });

  it('前后倾正好 90° 时朝向和左右倾分不开：全算在朝向上，还是同一个旋转', () => {
    const q = propQuat([90, 30, 40]);
    const e = propEuler(q);
    expect(e[2]).toBe(0);
    sameTurn(propQuat(e), q);
  });
});

describe('连接上的「道具跟着」', () => {
  it('只有记着朝向的手、脚能带着道具；整个人跟着的不行', () => {
    expect(CARRY.carry).toBe(true);
    expect(withCarry(CARRY, false).carry).toBeUndefined();
    expect('carry' in withCarry(CARRY, false)).toBe(false);
    const { rot: _rot, ...bare } = got.link;
    expect(withCarry(bare, true).carry).toBeUndefined();
    expect(withCarry(rideLink(BOX, at0), true).carry).toBeUndefined();
    // 别的不动
    expect(withCarry(got.link, true)).toEqual({ ...got.link, carry: true });
  });

  it('存档读回来还带着；握紧度、朝向照旧', () => {
    const back = normalizeLinks(JSON.parse(JSON.stringify([CARRY])), [BOX]);
    expect(back).toEqual([CARRY]);
    // 乱写的不算
    expect(normalizeLinks([{ ...got.link, carry: 'yes' }], [BOX])[0].carry).toBeUndefined();
  });

  it('读档：人整个跟着的那件不能又跟着他的手；一件道具只认第一个带着它的', () => {
    const ride = rideLink(BOX, at0);
    const loop = normalizeLinks([ride, CARRY], [BOX]);
    expect(linkOf(loop, BODY_LINK)).toBeTruthy();
    expect(linkOf(loop, 'Hand_L')?.carry).toBeUndefined();
    const two = normalizeLinks([CARRY, { ...CARRY, part: 'Hand_R' }], [BOX]);
    expect(two.map((l) => l.carry)).toEqual([true, undefined]);
  });

  it('读场景：两个角色都写着带着同一件，只认前一个', () => {
    const spec = defaultSpec();
    const data = {
      app: 'oc-basemesh-scene',
      version: 1,
      current: 'f1',
      props: [BOX],
      figures: [
        { id: 'f1', name: '', place: at0, spec: {}, links: [CARRY] },
        { id: 'f2', name: '', place: { x: 1, z: 0, yaw: 0 }, spec: {}, links: [CARRY] },
      ],
    };
    const scene = normalizeScene(data, () => ({ spec, text: '' }))!;
    expect(scene.figures.map((f) => f.links?.[0].carry)).toEqual([true, undefined]);
    // 写出去再读回来还是这样
    const again = normalizeScene(JSON.parse(serializeScene(scene, () => ({}))), () => ({ spec, text: '' }))!;
    expect(again.figures.map((f) => f.links?.[0].carry)).toEqual([true, undefined]);
  });
});

describe('照手算道具现在在哪', () => {
  it('手没动：算出来就是清单里那一份（差不到取整的误差）', () => {
    const { point, rot } = handAt(held, 'Hand_L');
    const now = carriedProp(BOX, CARRY, point, rot);
    expect(samePose(now, BOX)).toBe(true);
    expect(placeCarried([BOX], [{ link: CARRY, point, rot }])).toEqual([BOX]);
  });

  it('手挪了、转了：道具跟过去，手还抓在同一点、同一个朝向上', () => {
    const { point, rot } = handAt(held, 'Hand_L');
    for (const [move, turn] of [
      [[0.2, 0.1, -0.15], quatEuler(0, 0, 0)],
      [[0, 0, 0], quatEuler(0, 1.1, 0)],
      [[-0.4, 0.3, 0.2], quatEuler(0.6, -0.8, 0.3)],
      [[0.1, -0.2, 0.1], quatEuler(Math.PI / 2, 0.4, 0)],
    ] as [V3, Quat][]) {
      const to: V3 = [point[0] + move[0], point[1] + move[1], point[2] + move[2]];
      const turned = quatMul(turn, rot);
      const now = carriedProp(BOX, CARRY, to, turned);
      // 位置留到毫米、角度留到 0.1°：手离抓着的那一点不到 1.5 毫米
      expect(dist(linkPoint(now, CARRY), to)).toBeLessThan(1.5e-3);
      sameTurn(linkRot(now, CARRY)!, turned, 2);
      // 尺寸、颜色、名字、编号都不变
      expect({ ...now, pos: BOX.pos, rot: BOX.rot }).toEqual(BOX);
    }
  });

  it('没记朝向的连接算不了：原样返回', () => {
    const { rot: _rot, ...bare } = CARRY;
    expect(carriedProp(BOX, bare, [1, 1, 1], [0, 0, 0, 1])).toBe(BOX);
  });

  it('没人带着道具时返回的就是清单本身；别的道具还是原来那一个', () => {
    const other = prop('pole', {}, 'p2');
    const list = [BOX, other];
    expect(placeCarried(list, [])).toBe(list);
    const { point, rot } = handAt(held, 'Hand_L');
    expect(placeCarried(list, [{ link: CARRY, point, rot }])).toBe(list);
    const moved = placeCarried(list, [{ link: CARRY, point: [point[0] + 0.3, point[1], point[2]], rot }]);
    expect(moved).not.toBe(list);
    expect(moved[1]).toBe(other);
    expect(moved[0].pos[0]).toBeCloseTo(BOX.pos[0] + 0.3, 3);
    // 再算一次、手没再动：还是上一回那一份
    expect(placeCarried(list, [{ link: CARRY, point: [point[0] + 0.3, point[1], point[2]], rot }], moved)).toBe(moved);
    // 手又挪了：新的一份
    expect(placeCarried(list, [{ link: CARRY, point: [point[0] + 0.31, point[1], point[2]], rot }], moved)).not.toBe(moved);
  });

  it('角色站在别处、转了身：照场景里的位置算', () => {
    const place: Place = { x: 1.5, z: -0.7, yaw: 60 };
    // 道具摆到相对这个角色同样的地方
    const there = clampProp({ ...BOX, pos: toScene(place, BOX.pos), rot: [0, 60, 0] });
    const g = grabLink(solver, reached, place, there, 'Hand_L', 1)!;
    const link = withCarry(g.link, true);
    const { point, rot } = handAt(g.state, 'Hand_L', place);
    expect(samePose(carriedProp(there, link, point, rot), there)).toBe(true);
    // 角色再转 90°：道具绕着他转过去
    const turned: Place = { ...place, yaw: 150 };
    const after = handAt(g.state, 'Hand_L', turned);
    const now = carriedProp(there, link, after.point, after.rot);
    expect(dist(linkPoint(now, link), after.point)).toBeLessThan(1.5e-3);
    expect(now.rot[1]).toBeCloseTo(150, 0);
  });
});

describe('带着道具的手不算钉在道具上', () => {
  it('没有握紧度的：不出目标；有握紧度的：只管握，不管手在哪', () => {
    expect(holdTargets(at0, [withGrip(CARRY, 0)], [BOX])).toEqual([]);
    const targets = holdTargets(at0, [CARRY], [BOX]);
    expect(targets).toHaveLength(1);
    expect(targets[0].carried).toBeTypeOf('function');
    expect(targets[0].solid).toBeUndefined();
    // 同一个连接不带着的时候是普通的目标
    expect(holdTargets(at0, [got.link], [BOX])[0].carried).toBeUndefined();
  });

  it('道具刚自己被挪了（led）：这一下手跟着它，是普通的目标', () => {
    const targets = holdTargets(at0, [CARRY], [BOX], new Set(['p1']));
    expect(targets[0].carried).toBeUndefined();
    expect(targets[0].rot).toBeTruthy();
  });

  it('拖胯：带着道具的手跟着身体走，不把身体拉住；道具照手算出来跟着', () => {
    const f0 = forward(rig, held);
    const end = solver.limbs[limbOf('Hand_L')].end;
    // 钉着的只有脚（带着道具的手不在里面）
    const feet = new Set(solver.limbs.filter((l) => l.kind === 'leg').map((l) => l.name));
    const pins = capturePins(solver, f0, feet);
    const hips = f0.pos[rig.hips];
    const moved = dragBody(solver, held, [hips[0] + 0.1, hips[1] - 0.15, hips[2]], pins);
    // 落定：带着的手不动
    const settled = holdState(solver, moved, holdTargets(at0, [CARRY], [BOX]));
    expect(settled).toBe(moved);
    const f1 = forward(rig, settled);
    expect(dist(f1.pos[end], f0.pos[end])).toBeGreaterThan(0.1);
    const { point, rot } = handAt(settled, 'Hand_L');
    const now = carriedProp(BOX, CARRY, point, rot);
    expect(dist(now.pos, BOX.pos)).toBeGreaterThan(0.1);
    expect(dist(linkPoint(now, CARRY), point)).toBeLessThan(1.5e-3);
    // 同一个连接不带着的时候：手被拉回道具上
    const back = holdState(solver, moved, holdTargets(at0, [got.link], [BOX]));
    expect(dist(forward(rig, back).pos[end], f0.pos[end])).toBeLessThan(2e-3);
  });

  it('换了一个姿势（手指张开了）、要求重新握：照道具跟到手上以后的样子握，指尖还贴着它', () => {
    const hand = handOf('Hand_L');
    // 手挪到别处、手指放回静止的样子
    const away = reachOnly(solver, rest, limbOf('Hand_L'), [0.35, 1.3, 0.2]);
    const targets = holdTargets(at0, [CARRY], [BOX]);
    // 平时（只有挪了的才握）：不动
    expect(holdState(solver, away, targets)).toBe(away);
    const regripped = holdState(solver, away, targets, { grip: 'always' });
    expect(regripped).not.toBe(away);
    const f = forward(rig, regripped);
    const end = solver.limbs[limbOf('Hand_L')].end;
    // 手没被挪
    expect(dist(f.pos[end], forward(rig, away).pos[end])).toBeLessThan(1e-9);
    // 道具跟到手上：四指至少有两根的指尖贴着它（不到 1.5 厘米），而且没有哪一节插进去
    const { point, rot } = handAt(regripped, 'Hand_L');
    const solid = propSolid(carriedProp(BOX, CARRY, point, rot), at0);
    const k = scaleOf(solver);
    const tips = hand.fingers.slice(1).map((chain) => solidDistance(solid, tailOf(rig, f, chain[chain.length - 1])));
    expect(tips.filter((d) => d < 0.015 * k).length).toBeGreaterThanOrEqual(2);
    for (const chain of hand.fingers) for (const bone of chain) expect(solidDistance(solid, tailOf(rig, f, bone))).toBeGreaterThan(-0.004 * k);
  });
});

describe('保存姿势带着道具', () => {
  it('拿着的道具跟姿势一起存，载入以后还是拿着的，而且在手上', () => {
    const packed = packPoseProps(at0, [CARRY], [BOX])!;
    expect(packed.links[0].carry).toBe(true);
    const read = readPoseProps(JSON.parse(JSON.stringify(packed)))!;
    expect(read.links[0].carry).toBe(true);
    // 放到站在别处、转了身的角色身上
    const place: Place = { x: 2, z: 1, yaw: 90 };
    const put = placePoseProps(read, place, [prop('pole', {}, 'p1')]);
    expect(put.links[0]).toMatchObject({ prop: 'p2', part: 'Hand_L', carry: true });
    const { point, rot } = handAt(held, 'Hand_L', place);
    // 道具放的地方，就是照这只手算出来的地方
    expect(samePose(carriedProp(put.props[0], put.links[0], point, rot), put.props[0])).toBe(true);
  });
});

describe('不许绕圈', () => {
  const link = (p: string, part: string, carry = false): PropLink => ({ ...(part === BODY_LINK ? rideLink(prop('box', {}, p), at0) : linkTo(prop('box', {}, p), part, [0, 1, 0], undefined, [0, 0, 0, 1])), ...(carry ? { carry: true as const } : {}) });

  it('人整个跟着这件道具：它不能又跟着这个人的手', () => {
    expect(carryLoops([{ id: 'f1', links: [link('p1', BODY_LINK)] }], 'f1', 'p1')).toBe(true);
    expect(carryLoops([{ id: 'f1', links: [link('p1', BODY_LINK)] }], 'f1', 'p2')).toBe(false);
    expect(carryLoops([{ id: 'f1', links: [] }], 'f1', 'p1')).toBe(false);
    expect(carryLoops([{ id: 'f1' }], 'f1', 'p1')).toBe(false);
  });

  it('隔着别的角色绕回来也算：我坐的椅子被他拿着，他坐的箱子不能被我拿着', () => {
    const figures = [
      { id: 'f1', links: [link('p1', BODY_LINK)] },
      { id: 'f2', links: [link('p2', BODY_LINK), link('p1', 'Hand_L', true)] },
    ];
    expect(carryLoops(figures, 'f1', 'p2')).toBe(true);
    // 他不坐在箱子上就不绕
    expect(carryLoops([figures[0], { id: 'f2', links: [link('p1', 'Hand_L', true)] }], 'f1', 'p2')).toBe(false);
    // 已经绕着的存档读进来也不会转不出来
    const tangled = [
      { id: 'f1', links: [link('p1', BODY_LINK), link('p2', 'Hand_L', true)] },
      { id: 'f2', links: [link('p2', BODY_LINK), link('p1', 'Hand_L', true)] },
    ];
    expect(carryLoops(tangled, 'f1', 'p3')).toBe(false);
  });

  it('找得到是谁带着', () => {
    const figures = [
      { id: 'f1', links: [link('p1', 'Hand_L')] },
      { id: 'f2', links: [link('p1', 'Hand_R', true)] },
    ];
    expect(carrierIn(figures, 'p1')).toMatchObject({ figure: 'f2', link: { part: 'Hand_R' } });
    expect(carrierIn(figures, 'p2')).toBeNull();
  });
});
