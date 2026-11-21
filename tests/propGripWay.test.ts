// 握杆的正手、反手（docs/grab-plan.md「正手握、反手握」）：认是哪种（gripWayOf、barGripWay）、换过去（flipGrip）。都在 src/scene/follow.ts
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type V3, dot, len, quatConj, quatMul, sub } from '../src/geometry/vec';
import { type PropLink, linkPoint } from '../src/model/links';
import { type PropKind, type SceneProp, clampProp, makeAssetProp, makeProp } from '../src/model/props';
import type { Place } from '../src/model/scene';
import { defaultSpec } from '../src/model/spec';
import { quatAngle } from '../src/pose/math';
import { emptyPosing } from '../src/pose/posing';
import { type PoseState, forward } from '../src/pose/rig';
import { limbTwist, reachOnly } from '../src/pose/solve';
import { makeSolver, stateOf } from '../src/pose/solver';
import { installPropAssets, propAssetsReady } from '../src/props/library';
import { buildSkeleton } from '../src/rig/skeleton';
import { barOf } from '../src/scene/bar';
import { placeCarried } from '../src/scene/carry';
import { barGripWay, flipGrip, grabLink, sceneRot } from '../src/scene/follow';
import { handRot, thumbSide } from '../src/scene/grip';
import { toScene } from '../src/scene/interact';
import { type ActionResult, type PropAction, solvePropAction } from '../src/scene/propActions';

beforeAll(() => {
  if (propAssetsReady()) return;
  const file = readFileSync('public/props/lowpoly.bin');
  installPropAssets(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
});

const at0: Place = { x: 0, z: 0, yaw: 0 };
/** 角色站在这里（不在原点、转了个角度：坐标换算错了看得出来） */
const HERE: Place = { x: 0.6, z: -0.4, yaw: 35 };
const basic = (kind: PropKind, patch: Partial<SceneProp> = {}): SceneProp => clampProp({ ...makeProp([], kind, at0), id: 'p1', ...patch });
const solver = makeSolver(buildSkeleton(buildFigure(defaultSpec())).bones);
const limbOf = (part: string) => solver.limbs.findIndex((l) => l.name === part);
const handOf = (part: string) => solver.hands.find((h) => h.name === part)!;

/** 做完以后道具在哪：带着的照手现算，和页面上一样 */
function propNow(got: ActionResult, state: PoseState, prop: SceneProp, links: readonly PropLink[]): SceneProp {
  const link = links.find((l) => l.carry);
  if (!link) return prop;
  const f = forward(solver.rig, state);
  const bone = solver.rig.index.get(link.part)!;
  return placeCarried([prop], [{ link, point: toScene(got.place, f.pos[bone]), rot: sceneRot(got.place, f.rot[bone]) }])[0];
}
/** 做一个一键动作；返回做完的姿势、连接、道具现在在哪 */
function act(action: PropAction, prop: SceneProp, place: Place = HERE) {
  const got = solvePropAction(action, { solver, place, posing: emptyPosing(), prop, props: [prop] });
  if ('error' in got) throw new Error(got.error);
  const state = stateOf(solver, got.posing);
  return { got, state, prop: propNow(got, state, prop, got.links) };
}
const wrist = (place: Place, state: PoseState, part: string): V3 => toScene(place, forward(solver.rig, state).pos[handOf(part).bone]);
const thumb = (state: PoseState, part: string): V3 => thumbSide(forward(solver.rig, state).rot[handOf(part).bone], handOf(part));
/** 手腕离杆的中线多远 */
function offBar(prop: SceneProp, point: V3): number {
  const bar = barOf(prop)!;
  const u = sub(bar.b, bar.a);
  const t = dot(sub(point, bar.a), u) / dot(u, u);
  return len(sub(point, [bar.a[0] + u[0] * t, bar.a[1] + u[1] * t, bar.a[2] + u[2] * t]));
}

const UPRIGHT = basic('pole', { pos: [1, 0, 1] });
const HIGH_BAR = basic('pole', { pos: [0, 2.1, 0.5], rot: [0, 0, 90] });

describe('认正手、反手', () => {
  it('一键动作摆出来的握法都是正手：横杆上两个拇指相对，竖杆上拇指在上', () => {
    const cases: [PropAction, SceneProp, string[]][] = [
      ['hang', HIGH_BAR, ['Hand_L', 'Hand_R']],
      ['both', UPRIGHT, ['Hand_L', 'Hand_R']],
      ['lift', UPRIGHT, ['Hand_L', 'Hand_R']],
      ['hug', UPRIGHT, ['Hand_L', 'Hand_R']],
      ['wrap', basic('pole', { pos: [0, 0, 0.5] }), ['Hand_L', 'Hand_R']],
      ['carry', UPRIGHT, ['Hand_L']],
      ['hold', basic('pole', { pos: [0.3, 0, 0.4] }), ['Hand_L']],
    ];
    for (const [action, raw, parts] of cases) {
      const { got, state, prop } = act(action, raw, at0);
      for (const part of parts) expect([action, part, barGripWay(solver, state, got.place, prop, part)]).toEqual([action, part, 'over']);
    }
    // 吊着：两个拇指朝着对方；竖着拿：拇指朝上
    const hang = act('hang', HIGH_BAR, at0);
    expect(thumb(hang.state, 'Hand_L')[0]).toBeLessThan(-0.9);
    expect(thumb(hang.state, 'Hand_R')[0]).toBeGreaterThan(0.9);
    expect(thumb(act('carry', UPRIGHT, at0).state, 'Hand_L')[1]).toBeGreaterThan(0.9);
  });

  it('不是握着杆的没有正手、反手：撑在台面上的手、踩着的脚、没有这只手', () => {
    const table = basic('box', { size: [1.2, 0.75, 0.7], pos: [0, 0, 0.8] });
    const { got, state } = act('top', table, at0);
    expect(barGripWay(solver, state, got.place, table, 'Hand_L')).toBeNull();
    expect(flipGrip(solver, state, got.place, table, got.links.find((l) => l.part === 'Hand_L')!)).toBeNull();
    expect(barGripWay(solver, state, got.place, UPRIGHT, 'Foot_L')).toBeNull();
    expect(barGripWay(solver, state, got.place, UPRIGHT, 'Tail')).toBeNull();
  });
});

describe('换握法', () => {
  it('换成反手：拇指掉头，手腕到杆的另一侧、离中线还是那么远，沿杆握在哪不变；道具不动', () => {
    for (const [action, raw] of [
      ['both', UPRIGHT],
      ['hang', HIGH_BAR],
      ['carry', UPRIGHT],
    ] as [PropAction, SceneProp][]) {
      const { got, state, prop } = act(action, raw);
      const part = got.links.some((l) => l.part === 'Hand_R') ? 'Hand_R' : 'Hand_L';
      const link = got.links.find((l) => l.part === part)!;
      const flipped = flipGrip(solver, state, got.place, prop, link)!;
      expect(flipped).toBeTruthy();
      expect(barGripWay(solver, flipped.state, got.place, prop, part)).toBe('under');
      expect(dot(thumb(state, part), thumb(flipped.state, part))).toBeLessThan(-0.95);
      const before = wrist(got.place, state, part);
      const after = wrist(got.place, flipped.state, part);
      expect(len(sub(after, before))).toBeGreaterThan(0.04);
      expect(Math.abs(offBar(prop, after) - offBar(prop, before))).toBeLessThan(2e-3);
      const u = sub(barOf(prop)!.b, barOf(prop)!.a);
      expect(Math.abs(dot(sub(after, before), u)) / len(u)).toBeLessThan(2e-3);
      // 连接记的就是手现在在的地方；握紧度、带不带着照旧
      expect(len(sub(linkPoint(prop, flipped.link), after))).toBeLessThan(1e-3);
      expect(flipped.link.grip).toBe(link.grip);
      expect(flipped.link.carry).toBe(link.carry);
      // 带着它的手换了握法，道具还在原处
      const links = got.links.map((l) => (l.part === part ? flipped.link : l));
      const now = propNow(got, flipped.state, raw, links);
      expect(len(sub(now.pos, prop.pos))).toBeLessThan(2e-3);
      for (let i = 0; i < 3; i++) expect(Math.abs(now.rot[i] - prop.rot[i])).toBeLessThan(0.3);
    }
  });

  it('换过去再换回来：手回到原处，前臂也拧回去', () => {
    const { got, state, prop } = act('both', UPRIGHT);
    const link = got.links.find((l) => l.part === 'Hand_L')!;
    const i = limbOf('Hand_L');
    const under = flipGrip(solver, state, got.place, prop, link)!;
    // 手掌翻 180°，前臂跟着拧 90°
    expect(Math.abs(Math.abs(limbTwist(solver, under.state, i).lower - limbTwist(solver, state, i).lower) - Math.PI / 2)).toBeLessThan(0.02);
    const back = flipGrip(solver, under.state, got.place, prop, under.link)!;
    expect(barGripWay(solver, back.state, got.place, prop, 'Hand_L')).toBe('over');
    expect(len(sub(wrist(got.place, back.state, 'Hand_L'), wrist(got.place, state, 'Hand_L')))).toBeLessThan(1e-3);
    const bone = handOf('Hand_L').bone;
    expect(quatAngle(quatMul(quatConj(forward(solver.rig, state).rot[bone]), forward(solver.rig, back.state).rot[bone]))).toBeLessThan(0.01);
    expect(Math.abs(limbTwist(solver, back.state, i).lower - limbTwist(solver, state, i).lower)).toBeLessThan(0.01);
    expect(back.link.at).toEqual(link.at);
  });

  it('只动这一条手臂：另一只手、身体别处都不动', () => {
    const { got, state, prop } = act('hang', HIGH_BAR);
    const flipped = flipGrip(solver, state, got.place, prop, got.links.find((l) => l.part === 'Hand_L')!)!;
    const a = forward(solver.rig, state);
    const b = forward(solver.rig, flipped.state);
    for (const name of ['Hand_R', 'Hips', 'Head', 'Foot_L']) expect(len(sub(a.pos[solver.rig.index.get(name)!], b.pos[solver.rig.index.get(name)!]))).toBeLessThan(1e-9);
  });

  it('椅子腿也能换；手腕挪到另一侧以后认不出还握着杆的地方（挨着坐面的那一头），手腕留在原处翻，也换得回来', () => {
    // 椅子垫高到手够得着：近处那条腿在 x = 0.36、z = 0.24 上下，从 0.6 到坐面底下
    const chair = clampProp({ ...makeAssetProp([], 'chair', at0)!, id: 'p1', pos: [0.2, 0.6, 0.4] });
    const i = limbOf('Hand_L');
    const rest = stateOf(solver, emptyPosing());
    const grab = (to: V3) => grabLink(solver, reachOnly(solver, rest, i, to, handRot(handOf('Hand_L'), [0, 0, 1], [1, 0, 0])), at0, chair, 'Hand_L', 1)!;
    const low = grab([0.41, 0.78, 0.17]);
    expect(barGripWay(solver, low.state, at0, chair, 'Hand_L')).toBe('over');
    const under = flipGrip(solver, low.state, at0, chair, low.link)!;
    expect(barGripWay(solver, under.state, at0, chair, 'Hand_L')).toBe('under');
    expect(barGripWay(solver, flipGrip(solver, under.state, at0, chair, under.link)!.state, at0, chair, 'Hand_L')).toBe('over');
    // 再高 2 厘米：手腕挪到另一侧以后坐面进了手边、认不出是细的一截了——退一步，手腕留在原处只翻手掌；还能换回来
    const high = grab([0.42, 0.8, 0.2]);
    expect(barGripWay(solver, high.state, at0, chair, 'Hand_L')).toBe('over');
    const stay = flipGrip(solver, high.state, at0, chair, high.link)!;
    expect(barGripWay(solver, stay.state, at0, chair, 'Hand_L')).toBe('under');
    expect(len(sub(wrist(at0, stay.state, 'Hand_L'), wrist(at0, high.state, 'Hand_L')))).toBeLessThan(5e-3);
    expect(barGripWay(solver, flipGrip(solver, stay.state, at0, chair, stay.link)!.state, at0, chair, 'Hand_L')).toBe('over');
  });
});
