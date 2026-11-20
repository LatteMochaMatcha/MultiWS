// 钉住和跟随：角色和道具的连接（src/model/links.ts、src/scene/follow.ts），角色摆放的离地高度（src/model/scene.ts）
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import type { V3 } from '../src/geometry/vec';
import { History } from '../src/model/history';
import { BODY_LINK, dropLink, dropLinksTo, linkOf, linkPoint, liveLinks, normalizeLinks, propLocal, ridePlace, sameLinks, setLink } from '../src/model/links';
import { type PropKind, type SceneProp, clampProp, makeProp, propPoint, updateProp } from '../src/model/props';
import { type Place, absolutePlace, clampPlace, normalizeScene, placeY, relativePlace, serializeScene, singleScene, updateFigure } from '../src/model/scene';
import { defaultSpec, normalizeSpec, serializeSpec } from '../src/model/spec';
import { emptyPosing } from '../src/pose/posing';
import { forward } from '../src/pose/rig';
import { dragReach, reachOnly } from '../src/pose/solve';
import { makeSolver, posingOf, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { followPlace, holdPosing, holdState, holdTargets, linkTo, nearestSolid, rideLink, topUnder } from '../src/scene/follow';
import { fromScene, toScene } from '../src/scene/interact';
import { propSolid } from '../src/scene/propTouch';

const at0 = { x: 0, z: 0, yaw: 0 };
const prop = (kind: PropKind, patch: Partial<SceneProp> = {}, id = 'p1'): SceneProp => clampProp({ ...makeProp([], kind, at0), id, ...patch });
const near = (a: readonly number[], b: readonly number[], digits = 3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const specData = (spec: ReturnType<typeof defaultSpec>, text: string) => JSON.parse(serializeSpec(spec, text));
const readSpec = (raw: unknown) => ({ spec: normalizeSpec(raw), text: '' });

describe('角色的摆放：离地多高', () => {
  it('在地上的不写这一项，和以前一模一样', () => {
    expect(clampPlace({ x: 1, z: 2, yaw: 30 })).toEqual({ x: 1, z: 2, yaw: 30 });
    expect(clampPlace({ x: 1, z: 2, yaw: 30, y: 0 })).toEqual({ x: 1, z: 2, yaw: 30 });
    expect(relativePlace({ x: 1, z: 0, yaw: 0 }, { x: 3, z: 2, yaw: 30 })).toEqual({ x: 2, z: 2, yaw: 30 });
  });

  it('高度收进范围、留到毫米', () => {
    expect(clampPlace({ x: 0, z: 0, yaw: 0, y: 0.45049 })).toEqual({ x: 0, z: 0, yaw: 0, y: 0.45 });
    expect(placeY(clampPlace({ x: 0, z: 0, yaw: 0, y: 99 }))).toBe(10);
    expect(placeY(clampPlace({ x: 0, z: 0, yaw: 0, y: -99 }))).toBe(-5);
    expect(placeY(clampPlace({ x: 0, z: 0, yaw: 0, y: Number.NaN }))).toBe(0);
  });

  it('换到别人的坐标里：高度是差多少；换回来是原样', () => {
    const from: Place = { x: 1, z: -2, yaw: 40, y: 0.45 };
    const to: Place = { x: -3, z: 0.5, yaw: -100, y: 1.2 };
    const rel = relativePlace(from, to);
    expect(placeY(rel)).toBeCloseTo(0.75, 9);
    const back = absolutePlace(from, rel);
    near([back.x, back.z, back.yaw, placeY(back)], [to.x, to.z, to.yaw, 1.2], 9);
    // 一样高：差是 0，不写
    expect(relativePlace(from, { ...to, y: 0.45 }).y).toBeUndefined();
  });

  it('角色自己坐标里的点和场景里的点来回换：带着高度', () => {
    const place: Place = { x: 2, z: 1, yaw: 90, y: 0.45 };
    const p = toScene(place, [0.1, 1, 0.3]);
    expect(p[1]).toBeCloseTo(1.45, 9);
    near(fromScene(place, p), [0.1, 1, 0.3], 9);
  });

  it('存档：高度存得进读得出，在地上的不写', () => {
    let s = singleScene(defaultSpec(), 'x');
    expect(serializeScene(s, specData)).not.toContain('"y"');
    s = updateFigure(s, 'f1', { place: { x: 0.5, z: 0, yaw: 0, y: 0.45 } });
    const back = normalizeScene(JSON.parse(serializeScene(s, specData)), readSpec)!;
    expect(back.figures[0].place).toEqual({ x: 0.5, z: 0, yaw: 0, y: 0.45 });
  });
});

describe('连接：记在道具的哪里', () => {
  it('钉在箱子顶上：记的是顶面上那一点占几成，和离它多远', () => {
    const box = prop('box', { size: [1, 0.5, 1], pos: [2, 0, 0] });
    const link = linkTo(box, 'Hand_L', [2.2, 0.53, -0.1]);
    expect(link).toMatchObject({ prop: 'p1', part: 'Hand_L' });
    near(link.at, [0.2, 1, -0.1], 5);
    near(link.off, [0, 0.03, 0], 4);
    expect(link.yaw).toBeUndefined();
    near(linkPoint(box, link), [2.2, 0.53, -0.1], 4);
  });

  it('道具挪了、转了、歪了：钉着的点跟着', () => {
    const box = prop('box', { size: [1, 0.5, 1] });
    const link = linkTo(box, 'Hand_L', [0.2, 0.53, -0.1]);
    const moved = prop('box', { size: [1, 0.5, 1], pos: [1, 0.3, -2], rot: [20, 70, -10] });
    near(linkPoint(moved, link), propPoint(moved, [0.2, 0.53, -0.1]), 4);
    // 换回道具自己的坐标还是原来那一点
    near(propLocal(moved, linkPoint(moved, link)), [0.2, 0.53, -0.1], 4);
  });

  it('道具改了尺寸：钉在桌面上的手跟着桌面走，离桌面还是那么远', () => {
    const box = prop('box', { size: [1, 0.5, 1] });
    const link = linkTo(box, 'Hand_L', [0.2, 0.53, -0.1]);
    const tall = prop('box', { size: [2, 0.9, 1] });
    near(linkPoint(tall, link), [0.4, 0.93, -0.1], 4);
  });

  it('道具里面的点也记得住（坐进沙发里的胯）', () => {
    const box = prop('box', { size: [1, 1, 1] });
    const link = linkTo(box, 'Hand_R', [0.1, 0.8, 0]);
    near(linkPoint(box, link), [0.1, 0.8, 0], 4);
  });

  it('整个人跟着：位置、离地多高跟着那一点，朝向跟着道具转；道具歪了人不歪', () => {
    const stand = prop('stand', { size: [0.6, 0.45, 0.6], pos: [1, 0, 1] });
    const place: Place = { x: 1.05, z: 1, yaw: 30, y: 0.45 };
    const link = rideLink(stand, place);
    expect(link.part).toBe(BODY_LINK);
    expect(link.yaw).toBe(30);
    const same = ridePlace(stand, link);
    near([same.x, placeY(same), same.z, same.yaw], [1.05, 0.45, 1, 30], 4);
    // 台子挪开、抬高、转 90°：人还站在台面上原来那一点，脸跟着转
    const moved = updateProp([stand], 'p1', { pos: [3, 0.2, -1], rot: [0, 90, 0] })[0];
    const next = followPlace(place, [link], [moved]);
    near([next.x, placeY(next), next.z, next.yaw], [3, 0.65, -1.05, 120], 3);
    // 倾斜：只跟位置
    const tilted = updateProp([stand], 'p1', { rot: [25, 0, 0] })[0];
    expect(followPlace(place, [link], [tilted]).yaw).toBe(30);
  });

  it('没有连接、道具不在了：原地不动', () => {
    const place: Place = { x: 1, z: 2, yaw: 3 };
    expect(followPlace(place, undefined, [])).toBe(place);
    const link = rideLink(prop('box'), place);
    expect(followPlace(place, [link], [])).toBe(place);
    expect(holdTargets(place, [linkTo(prop('box'), 'Hand_L', [0, 0.5, 0])], [])).toEqual([]);
  });
});

describe('连接：清单', () => {
  const box = prop('box');
  const a = linkTo(box, 'Hand_L', [0, 0.5, 0]);
  const b = linkTo(box, 'Hand_R', [0.1, 0.5, 0]);

  it('同一个部位只连一件：新的换掉旧的', () => {
    const other = prop('box', {}, 'p2');
    const links = setLink(setLink(undefined, a), b);
    expect(links).toHaveLength(2);
    const again = setLink(links, linkTo(other, 'Hand_L', [0, 0.5, 0]));
    expect(again).toHaveLength(2);
    expect(linkOf(again, 'Hand_L')?.prop).toBe('p2');
  });

  it('单独解开一个、解开连着某件道具的全部', () => {
    const links = [a, b, rideLink(prop('box', {}, 'p2'), at0)];
    expect(dropLink(links, 'Hand_L').map((l) => l.part)).toEqual(['Hand_R', BODY_LINK]);
    expect(dropLinksTo(links, 'p1').map((l) => l.part)).toEqual([BODY_LINK]);
    expect(dropLink(undefined, 'x')).toEqual([]);
  });

  it('道具删了：连接先留着不用，道具放回来还连着', () => {
    expect(liveLinks([a, b], [])).toEqual([]);
    expect(liveLinks([a, b], [box])).toHaveLength(2);
    expect(sameLinks(undefined, [])).toBe(true);
    expect(sameLinks([a], [b])).toBe(false);
  });

  it('读存档：道具不在的、缺东西的、重复的丢掉', () => {
    const raw = [a, { ...b, prop: 'p9' }, { ...a, at: [9, 9, 9] }, { prop: 'p1', part: 'Foot_L' }, 5, null, { ...b, off: ['x', 1e9, 0] }];
    const got = normalizeLinks(raw, [box]);
    expect(got.map((l) => l.part)).toEqual(['Hand_L', 'Hand_R']);
    expect(got[0]).toEqual(a);
    expect(got[1].off).toEqual([0, 30, 0]);
    expect(normalizeLinks('x', [box])).toEqual([]);
  });

  it('场景存档：连接跟着角色存，道具不在了的不写；没有连接的文件和以前一模一样', () => {
    let s = singleScene(defaultSpec(), 'x');
    const plain = serializeScene(s, specData);
    s = { ...updateFigure(s, 'f1', { links: [a] }), props: [box] };
    const back = normalizeScene(JSON.parse(serializeScene(s, specData)), readSpec)!;
    expect(back.figures[0].links).toEqual([a]);
    // 道具删了：屏幕上留着连接，写出去的文件里没有
    expect(serializeScene({ ...s, props: [] }, specData)).toBe(plain);
    expect(serializeScene(updateFigure(s, 'f1', { links: [] }), specData)).not.toContain('links');
  });
});

describe('跟随：钉着的手脚', () => {
  const figure = buildFigure(defaultSpec());
  const solver = makeSolver(buildSkeleton(figure).bones);
  const hand = solver.limbs.findIndex((l) => l.name === 'Hand_L');
  const rest = stateOf(solver, emptyPosing());
  const end = (state = rest, limb = hand) => forward(solver.rig, state).pos[solver.limbs[limb].end];

  it('只动那一条手臂：手到了，别的骨骼、胯都没动', () => {
    const target: V3 = [end()[0] - 0.1, end()[1] + 0.15, end()[2] + 0.2];
    const next = reachOnly(solver, rest, hand, target);
    expect(dist(end(next), target)).toBeLessThan(1e-6);
    const { upper, lower, end: tip } = solver.limbs[hand];
    next.local.forEach((q, i) => {
      if (i !== upper && i !== lower && i !== tip) expect(q).toEqual(rest.local[i]);
    });
    expect(next.root).toEqual(rest.root);
  });

  it('够不着：手臂朝那一点伸直，身体不跟过去（拖手的话身体会跟过去）', () => {
    const target: V3 = [end()[0] + 2, end()[1], end()[2]];
    const next = reachOnly(solver, rest, hand, target);
    const f = forward(solver.rig, next);
    const hips = solver.rig.hips;
    near(f.pos[hips], forward(solver.rig, rest).pos[hips], 9);
    expect(dist(end(next), target)).toBeGreaterThan(1);
    // 对照：拖手是会把身体拽过去的
    const dragged = forward(solver.rig, dragReach(solver, rest, hand, target, []));
    expect(dist(dragged.pos[hips], f.pos[hips])).toBeGreaterThan(0.1);
  });

  it('道具挪了：钉着的手跟到新的地方；挪回来，手回到原处', () => {
    const place: Place = { x: 0.3, z: -0.2, yaw: 25 };
    const start = end();
    const box = prop('box', { size: [0.4, 0.4, 0.4], pos: toScene(place, [start[0], start[1] - 0.43, start[2]]) });
    const links = [linkTo(box, 'Hand_L', toScene(place, start))];
    // 没动：一点不变，返回的就是原来那份
    const posing = posingOf(solver, rest);
    expect(holdPosing(solver, posing, holdTargets(place, links, [box]))).toBe(posing);
    // 道具往前挪 15 厘米、抬高 10 厘米
    const moved = updateProp([box], 'p1', { pos: [box.pos[0] + 0.05, box.pos[1] + 0.1, box.pos[2] + 0.15] });
    const targets = holdTargets(place, links, moved);
    expect(targets).toHaveLength(1);
    const next = holdPosing(solver, posing, targets);
    expect(next).not.toBe(posing);
    expect(dist(end(stateOf(solver, next)), targets[0].target)).toBeLessThan(2e-3);
    expect(dist(end(stateOf(solver, next)), start)).toBeGreaterThan(0.15);
    // 挪回来
    const back = holdPosing(solver, next, holdTargets(place, links, [box]));
    expect(dist(end(stateOf(solver, back)), start)).toBeLessThan(2e-3);
  });

  it('角色自己挪了：钉着的手留在道具上', () => {
    const start = end();
    const box = prop('box', { size: [0.4, 0.4, 0.4], pos: [start[0], start[1] - 0.43, start[2]] });
    const links = [linkTo(box, 'Hand_L', start)];
    // 角色往它的左手边挪 10 厘米：在它自己看来，钉着的点往身子这边来了 10 厘米
    const targets = holdTargets({ x: 0.1, z: 0, yaw: 0 }, links, [box]);
    near(targets[0].target, [start[0] - 0.1, start[1], start[2]], 3);
    const next = holdState(solver, rest, targets);
    near(toScene({ x: 0.1, z: 0, yaw: 0 }, end(next)), start, 3);
  });

  it('两只手各钉各的；骨架上没有的那条不管', () => {
    const right = solver.limbs.findIndex((l) => l.name === 'Hand_R');
    const targets = [
      { part: 'Hand_L', target: [end()[0], end()[1] + 0.1, end()[2] + 0.1] as V3 },
      { part: 'Hand_R', target: [end(rest, right)[0], end(rest, right)[1] + 0.2, end(rest, right)[2]] as V3 },
      { part: 'Hand_L.009', target: [0, 0, 0] as V3 },
    ];
    const next = holdState(solver, rest, targets);
    expect(dist(end(next), targets[0].target)).toBeLessThan(1e-6);
    expect(dist(end(next, right), targets[1].target)).toBeLessThan(1e-6);
  });
});

describe('跟随：找道具', () => {
  it('最近的那件，和离它的表面多远', () => {
    const solids = [propSolid(prop('box', { size: [1, 1, 1] })), propSolid(prop('box', { size: [1, 1, 1], pos: [3, 0, 0] }, 'p2'))];
    expect(nearestSolid(solids, [0.7, 0.5, 0])).toMatchObject({ id: 'p1' });
    expect(nearestSolid(solids, [0.7, 0.5, 0])!.dist).toBeCloseTo(0.2, 6);
    expect(nearestSolid(solids, [2.6, 0.5, 0])).toMatchObject({ id: 'p2' });
    expect(nearestSolid(solids, [3, 0.5, 0])!.dist).toBeLessThan(0);
    expect(nearestSolid([], [0, 0, 0])).toBeNull();
  });

  it('往下找落脚的面：台子顶上、叠着的取最高的、旁边没有、在它下面的不算', () => {
    const solids = [propSolid(prop('box', { size: [1, 0.45, 1] })), propSolid(prop('box', { size: [0.4, 0.2, 0.4], pos: [0.2, 0.45, 0] }, 'p2'))];
    expect(topUnder(solids, -0.3, 0, 2)).toBeCloseTo(0.45, 6);
    expect(topUnder(solids, 0.2, 0, 2)).toBeCloseTo(0.65, 6);
    expect(topUnder(solids, 2, 0, 2)).toBeNull();
    // 从两层之间往下找：只看得到下面那一层
    expect(topUnder(solids, 0.2, 0, 0.5)).toBeCloseTo(0.45, 6);
    // 从台子里面往下找：只有底面
    expect(topUnder(solids, -0.3, 0, 0.2)).toBeCloseTo(0, 6);
  });

  it('歪着的板子：落在斜面上那一点的高度', () => {
    const board = prop('wall', { size: [2, 0.1, 2], rot: [0, 0, 20] });
    const solid = propSolid(board);
    // 板子顶面上的一点在场景里的哪：从它正上方往下找，找到的就是它的高度
    const top = propPoint(board, [0.3, 0.1, -0.4]);
    expect(topUnder([solid], top[0], top[2], 3)).toBeCloseTo(top[1], 4);
  });
});

describe('撤销历史：换掉现在这一步', () => {
  it('amend 不多记一步，撤销回去的还是上一步，能重做的还留着', () => {
    const h = new History<number>(1);
    h.push(2);
    h.amend(20);
    expect(h.current).toBe(20);
    expect(h.steps).toBe(1);
    expect(h.undo()).toBe(1);
    h.amend(10);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe(20);
  });
});
