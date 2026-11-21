// 抓住道具（docs/grab-plan.md 第 0、1 期）：连接带朝向（src/model/links.ts、src/scene/follow.ts），
// 抓着道具的手伸直了把身体拉住（src/pose/solve.ts 的 Pin.firm）
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, type V3, quatConj, quatEuler, quatMul, rotate } from '../src/geometry/vec';
import { BODY_LINK, linkPoint, linkRot, normalizeLinks, turnLink } from '../src/model/links';
import { type PropKind, type SceneProp, clampProp, makeProp, propPoint, propQuat, propRotation, updateProp } from '../src/model/props';
import type { Place } from '../src/model/scene';
import { defaultSpec } from '../src/model/spec';
import { emptyPosing } from '../src/pose/posing';
import { forward } from '../src/pose/rig';
import { type Pin, capturePins, dragBody, dragReach, reachOnly, turnBone } from '../src/pose/solve';
import { makeSolver, posingOf, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { holdPosing, holdState, holdTargets, linkTo, rideLink, sceneRot, yawQuat } from '../src/scene/follow';
import { fromScene, toScene } from '../src/scene/interact';

const at0 = { x: 0, z: 0, yaw: 0 };
const prop = (kind: PropKind, patch: Partial<SceneProp> = {}, id = 'p1'): SceneProp => clampProp({ ...makeProp([], kind, at0), id, ...patch });
const near = (a: readonly number[], b: readonly number[], digits = 3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const AXES: V3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
/** 两个四元数是不是同一个旋转（q 和 -q 是同一个）：看它们把三根轴转到哪 */
const sameTurn = (a: Quat, b: Quat, digits = 4) => AXES.forEach((v) => near(rotate(a, v), rotate(b, v), digits));
const apply = (m: number[], v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

describe('朝向的几种写法对得上', () => {
  it('道具的朝向：四元数和 3×3 矩阵是同一个旋转', () => {
    for (const rot of [
      [0, 0, 0],
      [0, 40, 0],
      [30, 0, 0],
      [0, 0, 30],
      [25, -70, 110],
      [-80, 170, 15],
    ] as V3[]) {
      const q = propQuat(rot);
      const m = propRotation(rot);
      for (const v of [...AXES, [0.3, -0.5, 0.8] as V3]) near(rotate(q, v), apply(m, v), 9);
    }
  });

  it('角色的朝向：yawQuat 和 toScene 是同一个转法', () => {
    for (const yaw of [0, 25, 90, -140, 180]) {
      const place: Place = { x: 0.4, z: -1.2, yaw, y: 0.3 };
      const p: V3 = [0.2, 1.1, -0.35];
      const turned = rotate(yawQuat(yaw), p);
      near(toScene(place, p), [turned[0] + 0.4, turned[1] + 0.3, turned[2] - 1.2], 9);
      // 手在角色自己坐标里的朝向换到场景里：先转手、再转角色
      const hand = quatEuler(0.3, -0.2, 0.9);
      near(rotate(sceneRot(place, hand), [0, 0, 1]), rotate(yawQuat(yaw), rotate(hand, [0, 0, 1])), 9);
    }
  });
});

describe('连接：记着手、脚相对道具怎么转的', () => {
  const hand = quatEuler(0.4, -0.3, 1.1);

  it('抓的时候道具是正的：记下来的就是手在场景里的朝向', () => {
    const pole = prop('pole');
    const link = linkTo(pole, 'Hand_L', [0.03, 1, 0], undefined, hand);
    expect(link.rot).toHaveLength(4);
    expect(Math.hypot(...link.rot!)).toBeCloseTo(1, 4);
    expect(link.rot![3]).toBeGreaterThanOrEqual(0);
    sameTurn(linkRot(pole, link)!, hand);
    // 位置照旧
    near(linkPoint(pole, link), [0.03, 1, 0], 4);
  });

  it('抓的时候道具已经转着、歪着：这会儿算出来的还是手现在的朝向', () => {
    const pole = prop('pole', { rot: [20, 65, -35], pos: [1, 0.2, -0.5] });
    const link = linkTo(pole, 'Foot_R', propPoint(pole, [0.03, 0.8, 0]), undefined, hand);
    sameTurn(linkRot(pole, link)!, hand);
  });

  it('道具转了、歪了：手跟着转同样多', () => {
    const before = prop('pole', { rot: [0, 30, 0] });
    const link = linkTo(before, 'Hand_L', [0.03, 1, 0], undefined, hand);
    const [after] = updateProp([before], 'p1', { rot: [0, 30, 30], pos: [0.5, 0, 0.2] });
    // 道具从 before 转到 after 的那一下，原样加在手上
    const delta = quatMul(propQuat(after.rot), quatConj(propQuat(before.rot)));
    sameTurn(linkRot(after, link)!, quatMul(delta, hand));
    // 道具转回去，手也转回去
    sameTurn(linkRot(before, link)!, hand);
  });

  it('整个人跟着的不记朝向；没给朝向的和以前一模一样', () => {
    const box = prop('box');
    expect(linkTo(box, BODY_LINK, [0, 1, 0], 30, hand).rot).toBeUndefined();
    expect(rideLink(box, { x: 0, z: 0, yaw: 30 }).rot).toBeUndefined();
    const plain = linkTo(box, 'Hand_L', [0.2, 1.03, 0]);
    expect(plain.rot).toBeUndefined();
    expect(Object.keys(plain).sort()).toEqual(['at', 'off', 'part', 'prop']);
    expect(linkRot(box, plain)).toBeNull();
    expect(holdTargets(at0, [plain], [box])[0]).not.toHaveProperty('rot');
  });

  it('只换朝向：抓在哪不变', () => {
    const pole = prop('pole', { rot: [0, 0, 20] });
    const link = linkTo(pole, 'Hand_L', propPoint(pole, [0.03, 1, 0]), undefined, hand);
    const other = quatEuler(-1, 0.2, 0.1);
    const turned = turnLink(pole, link, other);
    expect(turned.at).toEqual(link.at);
    expect(turned.off).toEqual(link.off);
    sameTurn(linkRot(pole, turned)!, other);
    // 以前的连接（没记朝向的）转过一次手以后也记上了
    const old = linkTo(pole, 'Hand_R', propPoint(pole, [0.03, 1, 0]));
    sameTurn(linkRot(pole, turnLink(pole, old, other))!, other);
    // 整个人跟着的不管
    const ride = rideLink(pole, at0);
    expect(turnLink(pole, ride, other)).toBe(ride);
  });

  it('读存档：朝向化成单位长、w 不是负的；不像样的朝向丢掉，连接留着', () => {
    const box = prop('box');
    const raw = (part: string, rot: unknown) => ({ prop: 'p1', part, at: [0, 1, 0], off: [0, 0.03, 0], rot });
    const read = normalizeLinks(
      [
        raw('Hand_L', [0, 0, 0, 2]),
        raw('Hand_R', [0, -0.6, 0, -0.8]),
        raw('Foot_L', [0, 0, 0, 0]),
        raw('Foot_R', [0, Number.NaN, 0, 1]),
        raw('Hand_L.002', [0, 1]),
        raw('Hand_R.002', 'x'),
        { prop: 'p1', part: BODY_LINK, at: [0, 1, 0], off: [0, 0, 0], yaw: 10, rot: [0, 0, 0, 1] },
      ],
      [box],
    );
    expect(read.map((l) => l.part)).toEqual(['Hand_L', 'Hand_R', 'Foot_L', 'Foot_R', 'Hand_L.002', 'Hand_R.002', BODY_LINK]);
    expect(read[0].rot).toEqual([0, 0, 0, 1]);
    near(read[1].rot!, [0, 0.6, 0, 0.8], 5);
    for (const i of [2, 3, 4, 5, 6]) expect(read[i].rot).toBeUndefined();
    // 存了再读是原样
    expect(normalizeLinks(JSON.parse(JSON.stringify(read)), [box])).toEqual(read);
  });
});

describe('抓着的手、踩着的脚：道具转了跟着转', () => {
  const solver = makeSolver(buildSkeleton(buildFigure(defaultSpec())).bones);
  const { rig } = solver;
  const hand = solver.limbs.findIndex((l) => l.name === 'Hand_L');
  const foot = solver.limbs.findIndex((l) => l.name === 'Foot_L');
  const rest = stateOf(solver, emptyPosing());
  const f0 = forward(rig, rest);
  const place: Place = { x: 0.3, z: -0.2, yaw: 25 };
  const wrist = f0.pos[solver.limbs[hand].end];
  /** 一根竖着的杆，正好立在手腕旁边；手抓在上面（连朝向一起记） */
  const pole = prop('pole', { pos: toScene(place, [wrist[0], 0, wrist[2] + 0.03]) });
  const grabbed = [linkTo(pole, 'Hand_L', toScene(place, wrist), undefined, sceneRot(place, f0.rot[solver.limbs[hand].end]))];

  it('给了朝向：手转到那个朝向；不给的话手跟着前臂、脚保持原来的朝向（和以前一样）', () => {
    const want = quatEuler(0.5, 0.2, -0.4);
    const target: V3 = [wrist[0] - 0.1, wrist[1] + 0.1, wrist[2] + 0.2];
    const turned = forward(rig, reachOnly(solver, rest, hand, target, want));
    sameTurn(turned.rot[solver.limbs[hand].end], want, 6);
    expect(dist(turned.pos[solver.limbs[hand].end], target)).toBeLessThan(1e-6);
    // 不给：手相对前臂没动
    const plain = reachOnly(solver, rest, hand, target);
    expect(plain.local[solver.limbs[hand].end]).toEqual(rest.local[solver.limbs[hand].end]);
    // 脚不给：保持原来在场景里的朝向；给了：转过去
    const ankle = f0.pos[solver.limbs[foot].end];
    const up: V3 = [ankle[0], ankle[1] + 0.2, ankle[2] + 0.2];
    sameTurn(forward(rig, reachOnly(solver, rest, foot, up)).rot[solver.limbs[foot].end], f0.rot[solver.limbs[foot].end], 6);
    sameTurn(forward(rig, reachOnly(solver, rest, foot, up, want)).rot[solver.limbs[foot].end], want, 6);
  });

  it('道具没动：姿势一点不变，返回的就是原来那份（存下来的数取整过也一样）', () => {
    const posing = posingOf(solver, rest);
    expect(holdPosing(solver, posing, holdTargets(place, grabbed, [pole]))).toBe(posing);
    expect(holdState(solver, rest, holdTargets(place, grabbed, [pole]))).toBe(rest);
  });

  it('杆歪 30°：手跟着歪 30°；歪回来，手回到原样', () => {
    const [tilted] = updateProp([pole], 'p1', { rot: [0, 0, 30] });
    const targets = holdTargets(place, grabbed, [tilted]);
    const posing = holdPosing(solver, posingOf(solver, rest), targets);
    const f = forward(rig, stateOf(solver, posing));
    const end = solver.limbs[hand].end;
    // 在场景里看：手比原来多转了「杆歪的那一下」
    sameTurn(sceneRot(place, f.rot[end]), quatMul(propQuat([0, 0, 30]), sceneRot(place, f0.rot[end])));
    // 原来顺着杆的那根线（手自己坐标里的），现在还顺着杆
    const along = rotate(quatConj(sceneRot(place, f0.rot[end])), [0, 1, 0]);
    near(rotate(sceneRot(place, f.rot[end]), along), rotate(propQuat([0, 0, 30]), [0, 1, 0]), 3);
    // 再算一遍不再变（不会一直抖）
    expect(holdPosing(solver, posing, targets)).toBe(posing);
    // 歪回来
    const back = forward(rig, stateOf(solver, holdPosing(solver, posing, holdTargets(place, grabbed, [pole]))));
    sameTurn(back.rot[end], f0.rot[end], 3);
    expect(dist(back.pos[end], wrist)).toBeLessThan(2e-3);
  });

  it('杆歪得少、手够得着：手还在抓着的那一点上，朝向也对', () => {
    const [tilted] = updateProp([pole], 'p1', { rot: [8, 0, 0] });
    const targets = holdTargets(place, grabbed, [tilted]);
    const f = forward(rig, holdState(solver, rest, targets));
    const end = solver.limbs[hand].end;
    expect(dist(f.pos[end], targets[0].target)).toBeLessThan(1e-6);
    near(toScene(place, f.pos[end]), linkPoint(tilted, grabbed[0]), 6);
    sameTurn(f.rot[end], targets[0].rot!, 6);
  });

  it('杆原地转（绕自己的轴）：手绕着杆转过去，手掌还对着杆', () => {
    const [spun] = updateProp([pole], 'p1', { rot: [0, 40, 0] });
    const targets = holdTargets(place, grabbed, [spun]);
    const f = forward(rig, holdState(solver, rest, targets));
    const end = solver.limbs[hand].end;
    // 手到杆心的那根线，在手自己看来没变
    const toAxis = (frame: typeof f, p: SceneProp) => rotate(quatConj(sceneRot(place, frame.rot[end])), [p.pos[0] - toScene(place, frame.pos[end])[0], 0, p.pos[2] - toScene(place, frame.pos[end])[2]]);
    near(toAxis(f, spun), toAxis(f0, pole), 3);
  });

  it('角色自己转了身：手在场景里的朝向不变（还照着道具）', () => {
    const turned: Place = { ...place, yaw: place.yaw + 20 };
    const targets = holdTargets(turned, grabbed, [pole]);
    const f = forward(rig, holdState(solver, rest, targets));
    const end = solver.limbs[hand].end;
    sameTurn(sceneRot(turned, f.rot[end]), sceneRot(place, f0.rot[end]), 4);
  });

  it('以前的连接（没记朝向）：只跟位置，手还是跟着前臂转', () => {
    const old = [linkTo(pole, 'Hand_L', toScene(place, wrist))];
    const [tilted] = updateProp([pole], 'p1', { rot: [8, 0, 0] });
    const next = holdState(solver, rest, holdTargets(place, old, [tilted]));
    expect(next.local[solver.limbs[hand].end]).toEqual(rest.local[solver.limbs[hand].end]);
  });
});

describe('抓着道具的手：手臂伸直了把身体拉住', () => {
  const solver = makeSolver(buildSkeleton(buildFigure(defaultSpec())).bones);
  const { rig } = solver;
  const left = solver.limbs.findIndex((l) => l.name === 'Hand_L');
  const right = solver.limbs.findIndex((l) => l.name === 'Hand_R');
  const rest = stateOf(solver, emptyPosing());
  const f0 = forward(rig, rest);
  const arm = solver.limbs[left];
  const full = arm.len1 + arm.len2;
  const hips = f0.pos[rig.hips];
  /** 左手抓着道具（就在它现在的地方）；firm：伸直了拉不拉得住身体 */
  const pinsOf = (firm: boolean): Pin[] => capturePins(solver, f0, new Set(['Hand_L'])).map((pin) => ({ ...pin, firm }));
  const grabAt = f0.pos[arm.end];

  it('拖胯拖远：身体停在手臂够得着的地方，手还在道具上、朝向没变', () => {
    const far: V3 = [hips[0] - 2, hips[1], hips[2]];
    const f = forward(rig, dragBody(solver, rest, far, pinsOf(true)));
    expect(dist(f.pos[arm.end], grabAt)).toBeLessThan(1e-3);
    expect(dist(f.pos[arm.upper], grabAt)).toBeLessThanOrEqual(full + 1e-6);
    // 胯没到拖的地方：被拉住了，但也确实挪出去了一截
    expect(dist(f.pos[rig.hips], far)).toBeGreaterThan(1);
    expect(dist(f.pos[rig.hips], hips)).toBeGreaterThan(0.05);
    sameTurn(f.rot[arm.end], f0.rot[arm.end], 6);
  });

  it('对照：没抓着（只是钉着的手）拉不住身体，和以前一样', () => {
    const far: V3 = [hips[0] - 2, hips[1], hips[2]];
    const f = forward(rig, dragBody(solver, rest, far, pinsOf(false)));
    near(f.pos[rig.hips], far, 6);
    expect(dist(f.pos[arm.end], grabAt)).toBeGreaterThan(1);
  });

  it('够得着的范围里：身体照拖的走，一点不拦', () => {
    const close: V3 = [hips[0] + 0.05, hips[1] - 0.05, hips[2] + 0.03];
    const f = forward(rig, dragBody(solver, rest, close, pinsOf(true)));
    near(f.pos[rig.hips], close, 6);
    expect(dist(f.pos[arm.end], grabAt)).toBeLessThan(1e-6);
  });

  it('往下蹲、往上跳也拉得住', () => {
    for (const dy of [-1.5, 1.5]) {
      const f = forward(rig, dragBody(solver, rest, [hips[0], hips[1] + dy, hips[2]], pinsOf(true)));
      expect(dist(f.pos[arm.end], grabAt)).toBeLessThan(1e-3);
      expect(dist(f.pos[arm.upper], grabAt)).toBeLessThanOrEqual(full + 1e-6);
    }
  });

  it('拖另一只手拖远：身体跟过去，跟到抓着的那只手臂伸直为止', () => {
    const other = f0.pos[solver.limbs[right].end];
    const far: V3 = [other[0] - 2, other[1], other[2]];
    const held = forward(rig, dragReach(solver, rest, right, far, pinsOf(true)));
    expect(dist(held.pos[arm.end], grabAt)).toBeLessThan(1e-3);
    expect(dist(held.pos[arm.upper], grabAt)).toBeLessThanOrEqual(full + 1e-6);
    // 对照：没抓着的话身体跟得更远，手离开原处
    const loose = forward(rig, dragReach(solver, rest, right, far, pinsOf(false)));
    expect(dist(loose.pos[arm.end], grabAt)).toBeGreaterThan(0.2);
    expect(dist(loose.pos[rig.hips], hips)).toBeGreaterThan(dist(held.pos[rig.hips], hips) + 0.1);
  });

  it('用旋转环转上身：抓着的手留在道具上', () => {
    const chest = rig.names.indexOf('Chest');
    expect(chest).toBeGreaterThanOrEqual(0);
    const turn = quatMul(quatEuler(0, 1.2, 0), f0.rot[chest]);
    const f = forward(rig, turnBone(solver, rest, chest, turn, pinsOf(true)));
    expect(dist(f.pos[arm.end], grabAt)).toBeLessThan(1e-3);
    expect(dist(f.pos[arm.upper], grabAt)).toBeLessThanOrEqual(full + 1e-6);
  });

  it('两只手都抓着、两只脚也钉着：往哪拖四处都还在原地', () => {
    const feet = solver.limbs.filter((l) => l.kind === 'leg').map((l) => l.name);
    const pins = capturePins(solver, f0, new Set(['Hand_L', 'Hand_R', ...feet])).map((pin) => ({ ...pin, firm: solver.limbs[pin.limb].kind === 'arm' }));
    for (const to of [
      [hips[0] + 1, hips[1], hips[2]],
      [hips[0], hips[1] - 0.6, hips[2] + 0.8],
      [hips[0] - 0.4, hips[1] + 1, hips[2] - 1],
    ] as V3[]) {
      const f = forward(rig, dragBody(solver, rest, to, pins));
      for (const pin of pins) expect(dist(f.pos[solver.limbs[pin.limb].end], pin.pos)).toBeLessThan(0.02);
    }
  });

  it('抓着的点换到角色自己的坐标里再拉：角色站在别处、转着身也一样', () => {
    const place: Place = { x: 1.5, z: -0.7, yaw: 115 };
    const box = prop('box', { size: [0.4, 0.4, 0.4], pos: toScene(place, [grabAt[0], grabAt[1] - 0.43, grabAt[2]]) });
    const links = [linkTo(box, 'Hand_L', toScene(place, grabAt), undefined, sceneRot(place, f0.rot[arm.end]))];
    const [hold] = holdTargets(place, links, [box]);
    near(hold.target, grabAt, 3);
    near(fromScene(place, linkPoint(box, links[0])), grabAt, 3);
    sameTurn(hold.rot!, f0.rot[arm.end], 4);
  });
});
