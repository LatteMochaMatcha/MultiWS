// 抓住道具第 5 期（docs/grab-plan.md）：两只手拿——拖另一只手道具绕主手转（src/scene/follow.ts 的 swingReach）、
// 另一只手跟着带着的道具走；抱着——道具跟着胸口（连接的 part 写胸口那根骨骼，src/model/links.ts）
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, type V3, add, len, norm, quatEuler, rotate, sub } from '../src/geometry/vec';
import { BODY_LINK, carriedProp, isLimbPart, linkPoint, normalizeLinks, putDown, usableLink, withCarry } from '../src/model/links';
import { type PropKind, type SceneProp, clampProp, makeProp } from '../src/model/props';
import { type Place, normalizeScene } from '../src/model/scene';
import { defaultSpec } from '../src/model/spec';
import { emptyPosing } from '../src/pose/posing';
import { type PoseState, forward } from '../src/pose/rig';
import { reachOnly, turnBone } from '../src/pose/solve';
import { makeSolver, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { placeCarried } from '../src/scene/carry';
import { grabLink, holdState, holdTargets, linkTo, rideLink, sceneRot, swingReach } from '../src/scene/follow';
import { toScene } from '../src/scene/interact';

const at0: Place = { x: 0, z: 0, yaw: 0 };
const prop = (kind: PropKind, patch: Partial<SceneProp> = {}, id = 'p1'): SceneProp => clampProp({ ...makeProp([], kind, at0), id, ...patch });
const dist = (a: V3, b: V3) => len(sub(a, b));

const solver = makeSolver(buildSkeleton(buildFigure(defaultSpec())).bones);
const { rig } = solver;
const rest = stateOf(solver, emptyPosing());
const L = solver.limbs.findIndex((l) => l.name === 'Hand_L');
const R = solver.limbs.findIndex((l) => l.name === 'Hand_R');
const endOf = (state: PoseState, limb: number) => forward(rig, state).pos[solver.limbs[limb].end];
/** 一根骨骼现在在场景里的位置和朝向 */
const boneAt = (state: PoseState, name: string, place: Place = at0) => {
  const f = forward(rig, state);
  const bone = rig.index.get(name)!;
  return { point: toScene(place, f.pos[bone]), rot: sceneRot(place, f.rot[bone]) };
};

/** 身前横着一个长盒子（34 厘米宽）：左手抓左头、拿着，右手抓右头 */
const BOX = prop('box', { size: [0.34, 0.12, 0.12], pos: [0, 1.0, 0.32] });
const reachedL = reachOnly(solver, rest, L, [0.12, 1.15, 0.32]);
const gotL = grabLink(solver, reachedL, at0, BOX, 'Hand_L', 1)!;
const reachedR = reachOnly(solver, gotL.state, R, [-0.12, 1.15, 0.32]);
const gotR = grabLink(solver, reachedR, at0, BOX, 'Hand_R', 1)!;
const MAIN = withCarry(gotL.link, true);
const OTHER = gotR.link;
const LINKS = [MAIN, OTHER];
const start = gotR.state;
/** 这个姿势下道具在哪（跟着左手） */
const boxAt = (state: PoseState) => placeCarried([BOX], [{ link: MAIN, ...boneAt(state, 'Hand_L') }]);
/** 另一只手跟到道具现在的地方 */
const ride = (state: PoseState) => holdState(solver, state, holdTargets(at0, LINKS, boxAt(state)), { grip: 'never' });

describe('两只手拿：另一只手跟着道具', () => {
  it('抓着的目标带着是哪件道具；主手不出位置目标，另一只手出', () => {
    const targets = holdTargets(at0, LINKS, [BOX]);
    expect(targets.map((h) => [h.part, h.prop, Boolean(h.carried)])).toEqual([
      ['Hand_L', 'p1', true],
      ['Hand_R', 'p1', false],
    ]);
  });

  it('拖主手：道具跟着，另一只手被带着，还抓在道具上原来那一点', () => {
    const moved = reachOnly(solver, start, L, [0.2, 1.3, 0.3]);
    // 这时候右手还在原处，离道具上它抓着的那一点远了
    const box = boxAt(moved)[0];
    expect(dist(box.pos, BOX.pos)).toBeGreaterThan(0.1);
    expect(dist(endOf(moved, R), linkPoint(box, OTHER))).toBeGreaterThan(0.05);
    const after = ride(moved);
    // 主手没被带动，右手到了道具上
    expect(dist(endOf(after, L), endOf(moved, L))).toBeLessThan(1e-9);
    expect(dist(endOf(after, R), linkPoint(box, OTHER))).toBeLessThan(1e-3);
  });

  it('转主手的手腕：道具跟着转，另一只手跟过去', () => {
    const f = forward(rig, start);
    const hand = solver.limbs[L].end;
    const turned = turnBone(solver, start, hand, [...quatMulY(0.35, f.rot[hand])] as Quat, []);
    const box = boxAt(turned)[0];
    expect(Math.abs(box.rot[1] - BOX.rot[1])).toBeGreaterThan(10);
    const after = ride(turned);
    expect(dist(endOf(after, R), linkPoint(box, OTHER))).toBeLessThan(1e-3);
  });
});

/** 绕竖直轴再转 a 弧度 */
function quatMulY(a: number, q: Quat): Quat {
  const [x, y, z, w] = quatEuler(0, a, 0);
  return [w * q[0] + x * q[3] + y * q[2] - z * q[1], w * q[1] - x * q[2] + y * q[3] + z * q[0], w * q[2] + x * q[1] - y * q[0] + z * q[3], w * q[3] - x * q[0] - y * q[1] - z * q[2]];
}

describe('两只手拿：拖另一只手，道具绕主手转', () => {
  const pivot = endOf(start, L);
  const from = endOf(start, R);
  const arm = sub(from, pivot);
  const span = len(arm);

  it('拖到同样远的另一处：主手的手腕不动，道具转过去，两只手都还抓在原处', () => {
    // 右手往上抬、往前送一点：绕着左手转二十来度
    const turn = quatEuler(0.15, 0.2, -0.3);
    const target = add(pivot, rotate(turn, arm));
    const got = swingReach(solver, start, L, R, target, 0.12)!;
    expect(got).not.toBeNull();
    expect(dist(endOf(got, L), pivot)).toBeLessThan(1e-4);
    expect(dist(endOf(got, R), target)).toBeLessThan(2e-3);
    const box = boxAt(got)[0];
    // 道具转了；右手离它抓着的那一点不到 2 毫米（位置留到毫米、角度留到 0.1°）
    expect(Math.abs(box.rot[2] - BOX.rot[2]) + Math.abs(box.rot[1] - BOX.rot[1]) + Math.abs(box.rot[0] - BOX.rot[0])).toBeGreaterThan(10);
    expect(dist(endOf(got, R), linkPoint(box, OTHER))).toBeLessThan(2e-3);
    // 主手还抓在它那一点上
    expect(dist(endOf(got, L), linkPoint(box, MAIN))).toBeLessThan(1.5e-3);
    // 落定时不用再挪谁
    const settled = holdState(solver, got, holdTargets(at0, LINKS, boxAt(got)), { grip: 'never' });
    expect(dist(endOf(settled, R), endOf(got, R))).toBeLessThan(2e-3);
  });

  it('拖得远一点、近一点（没超过松开的距离）：手留在两只手原来那么远的地方', () => {
    const dir = norm(rotate(quatEuler(0, 0, -0.25), arm));
    for (const reach of [span + 0.08, span - 0.08]) {
      const got = swingReach(solver, start, L, R, add(pivot, [dir[0] * reach, dir[1] * reach, dir[2] * reach]), 0.12)!;
      expect(got).not.toBeNull();
      expect(dist(endOf(got, R), pivot)).toBeCloseTo(span, 2);
      expect(dist(endOf(got, R), add(pivot, [dir[0] * span, dir[1] * span, dir[2] * span]))).toBeLessThan(2e-3);
    }
  });

  it('拖开超过松开的距离：不转道具（那只手被拖开了）', () => {
    const dir = norm(arm);
    expect(swingReach(solver, start, L, R, add(pivot, [dir[0] * (span + 0.2), dir[1] * (span + 0.2), dir[2] * (span + 0.2)]), 0.12)).toBeNull();
    expect(swingReach(solver, start, L, R, add(pivot, [dir[0] * (span - 0.2), dir[1] * (span - 0.2), dir[2] * (span - 0.2)]), 0.12)).toBeNull();
    expect(swingReach(solver, start, L, R, pivot, 0.12)).toBeNull();
  });

  it('转过去另一只手够不着了：只转到它还够得着的地方，手不悬着', () => {
    // 右手拖到左手的另一边、离右肩最远的那一处：右臂伸直了也够不到
    const shoulder = forward(rig, start).pos[solver.limbs[R].upper];
    const away = norm(sub(pivot, shoulder));
    const target = add(pivot, [away[0] * span, away[1] * span, away[2] * span]);
    expect(dist(target, shoulder)).toBeGreaterThan(solver.limbs[R].len1 + solver.limbs[R].len2 + 0.05);
    const got = swingReach(solver, start, L, R, target, 0.12)!;
    expect(got).not.toBeNull();
    const box = boxAt(got)[0];
    // 手还在道具上它抓着的那一点；主手的手腕没动
    expect(dist(endOf(got, R), linkPoint(box, OTHER))).toBeLessThan(3e-3);
    expect(dist(endOf(got, L), pivot)).toBeLessThan(1e-4);
    // 转了，但没转到头
    expect(dist(endOf(got, R), from)).toBeGreaterThan(0.02);
    expect(dist(endOf(got, R), target)).toBeGreaterThan(0.1);
  });

  it('每一下都从按下那一刻算起：拖出去再拖回原处，回到原样', () => {
    const got = swingReach(solver, start, L, R, from, 0.12)!;
    expect(dist(endOf(got, R), from)).toBeLessThan(1e-4);
    expect(boxAt(got)).toEqual([BOX]);
  });
});

describe('抱着：道具跟着胸口', () => {
  const chest = boneAt(rest, 'UpperChest');
  const HUG = withCarry(linkTo(BOX, 'UpperChest', chest.point, undefined, chest.rot), true);

  it('胸口的连接只有「带着」这一种：不带着就没有这个连接', () => {
    expect(HUG.carry).toBe(true);
    expect(isLimbPart('UpperChest')).toBe(false);
    expect(isLimbPart('Hand_L.002')).toBe(true);
    expect(isLimbPart('Foot_R')).toBe(true);
    expect(usableLink(HUG)).toBe(true);
    expect(usableLink(withCarry(HUG, false))).toBe(false);
    expect(usableLink(rideLink(BOX, at0))).toBe(true);
    // 放下：手改成抓着，胸口的去掉
    expect(putDown([HUG, OTHER], 'p1')).toEqual([OTHER]);
    expect(putDown([MAIN, OTHER], 'p1')).toEqual([gotL.link, OTHER]);
    expect(putDown([HUG], 'p2')).toEqual([HUG]);
  });

  it('读档：抱着的还抱着；人整个跟着它、别处已经带着它的，胸口的连接去掉', () => {
    expect(normalizeLinks(JSON.parse(JSON.stringify([HUG, OTHER])), [BOX])).toEqual([HUG, OTHER]);
    expect(normalizeLinks([{ ...HUG, carry: undefined }], [BOX])).toEqual([]);
    expect(normalizeLinks([rideLink(BOX, at0), HUG], [BOX]).map((l) => l.part)).toEqual([BODY_LINK]);
    expect(normalizeLinks([MAIN, HUG], [BOX]).map((l) => l.part)).toEqual(['Hand_L']);
    const spec = defaultSpec();
    const scene = normalizeScene(
      {
        app: 'oc-basemesh-scene',
        version: 1,
        current: 'f1',
        props: [BOX],
        figures: [
          { id: 'f1', name: '', place: at0, spec: {}, links: [HUG] },
          { id: 'f2', name: '', place: { x: 1, z: 0, yaw: 0 }, spec: {}, links: [HUG, OTHER] },
        ],
      },
      () => ({ spec, text: '' }),
    )!;
    expect(scene.figures.map((f) => (f.links ?? []).map((l) => l.part))).toEqual([['UpperChest'], ['Hand_R']]);
  });

  it('弯腰：道具跟着胸口走，抓在它上面的两只手跟着它', () => {
    const links = [HUG, gotL.link, OTHER];
    // 胸口不出手脚的目标；两只手都是普通的目标
    expect(holdTargets(at0, links, [BOX]).map((h) => h.part)).toEqual(['Hand_L', 'Hand_R']);
    // 腰往前弯 40°
    const spine = rig.index.get('Spine')!;
    const bent = turnBone(solver, start, spine, quatMulX(0.7, forward(rig, start).rot[spine]), []);
    const now = boneAt(bent, 'UpperChest');
    const box = placeCarried([BOX], [{ link: HUG, ...now }]);
    expect(box[0].pos[1]).toBeLessThan(BOX.pos[1] - 0.03);
    expect(box[0].rot[0]).toBeGreaterThan(20);
    // 道具离胸口还是原来那么远、那个方向
    expect(dist(linkPoint(box[0], HUG), now.point)).toBeLessThan(1.5e-3);
    const after = holdState(solver, bent, holdTargets(at0, links, box), { grip: 'never' });
    expect(dist(endOf(after, L), linkPoint(box[0], gotL.link))).toBeLessThan(1e-3);
    expect(dist(endOf(after, R), linkPoint(box[0], OTHER))).toBeLessThan(1e-3);
    // 道具是照胸口算的，和手没关系
    expect(carriedProp(BOX, HUG, now.point, now.rot)).toEqual(box[0]);
  });
});

/** 绕左右轴再转 a 弧度（往前弯） */
function quatMulX(a: number, q: Quat): Quat {
  const [x, y, z, w] = quatEuler(a, 0, 0);
  return [w * q[0] + x * q[3] + y * q[2] - z * q[1], w * q[1] - x * q[2] + y * q[3] + z * q[0], w * q[2] + x * q[1] - y * q[0] + z * q[3], w * q[3] - x * q[0] - y * q[1] - z * q[2]];
}
