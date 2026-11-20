// 一键动作：坐上去、躺上去、手撑着、手扶着、背靠着（src/scene/propActions.ts），道具的接触面（src/props/contacts.ts）
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import type { V3 } from '../src/geometry/vec';
import { BODY_LINK, linkOf, linkPoint } from '../src/model/links';
import { type PropKind, type SceneProp, clampProp, makeAssetProp, makeProp } from '../src/model/props';
import { type Place, placeY } from '../src/model/scene';
import { type BodySpec, defaultSpec } from '../src/model/spec';
import { emptyPosing } from '../src/pose/posing';
import { forward, posedBones } from '../src/pose/rig';
import { type Solver, makeSolver, stateOf } from '../src/pose/solver';
import { PROP_ASSETS } from '../src/props/catalog';
import { propContacts } from '../src/props/contacts';
import { installPropAssets, propAssetsReady } from '../src/props/library';
import { buildSkeleton } from '../src/rig/skeleton';
import { topUnder } from '../src/scene/follow';
import { capsulesOf, heightOf, placeCapsules, toScene } from '../src/scene/interact';
import { type ActionResult, PROP_ACTIONS, type PropAction, actionBlock, solvePropAction } from '../src/scene/propActions';
import { propClashes, propSolid, solidDistance } from '../src/scene/propTouch';

beforeAll(() => {
  if (propAssetsReady()) return;
  const file = readFileSync('public/props/lowpoly.bin');
  installPropAssets(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
});

const at0 = { x: 0, z: 0, yaw: 0 };
const basic = (kind: PropKind, patch: Partial<SceneProp> = {}, id = 'p1'): SceneProp => clampProp({ ...makeProp([], kind, at0), id, ...patch });
const asset = (name: string, patch: Partial<SceneProp> = {}, id = 'p1'): SceneProp => clampProp({ ...makeAssetProp([], name, at0)!, id, ...patch });
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const solverOf = (patch: (spec: BodySpec) => BodySpec = (s) => s): Solver => makeSolver(buildSkeleton(buildFigure(patch(defaultSpec()))).bones);
const solver = solverOf();
const height = heightOf(buildSkeleton(buildFigure(defaultSpec())).bones);
const k = height / 1.7;
/** 角色先站在道具的右前方 1.5 米外，面朝它 */
const AWAY: Place = { x: 0.4, z: 1.5, yaw: 180 };

function act(action: PropAction, prop: SceneProp, more: { place?: Place; props?: SceneProp[]; links?: ActionResult['links']; posing?: ActionResult['posing'] } = {}): ActionResult {
  const got = solvePropAction(action, { solver, place: more.place ?? AWAY, posing: more.posing ?? emptyPosing(), links: more.links, prop, props: more.props ?? [prop] });
  if ('error' in got) throw new Error(got.error);
  return got;
}
const errorOf = (action: PropAction, prop: SceneProp, place: Place = AWAY) => {
  const got = solvePropAction(action, { solver, place, posing: emptyPosing(), prop, props: [prop] });
  return 'error' in got ? got.error : null;
};

/** 摆好以后某根骨骼的起点在场景里的哪 */
function boneAt(got: ActionResult, name: string): V3 {
  const f = forward(solver.rig, stateOf(solver, got.posing));
  return toScene(got.place, f.pos[solver.rig.names.indexOf(name)]);
}
/** 摆好以后身体和道具插得最深的那处（米；不插是 0） */
function deepest(got: ActionResult, props: SceneProp[]): number {
  const f = forward(solver.rig, stateOf(solver, got.posing));
  const caps = placeCapsules(capsulesOf(posedBones(solver.rig, f), height), got.place);
  return propClashes(caps, props.map((p) => propSolid(p)), 0)[0]?.depth ?? 0;
}

describe('道具的接触面', () => {
  it('基本体照种类认：箱子能坐能撑，够长才能躺；台子、球是圆的；杆和墙板没有', () => {
    expect(Object.keys(propContacts(basic('box'))).sort()).toEqual(['sit', 'top']);
    expect(propContacts(basic('box', { size: [0.9, 0.4, 2] })).lie).toEqual({ rect: { x: [-0.5, 0.5], z: [-0.5, 0.5] }, turn: 0 });
    expect(propContacts(basic('box', { size: [2, 0.4, 0.9] })).lie?.turn).toBe(90);
    expect(propContacts(basic('stand')).sit?.round).toBe(true);
    expect(propContacts(basic('ball')).top).toBeUndefined();
    expect(propContacts(basic('pole'))).toEqual({});
    expect(propContacts(basic('wall'))).toEqual({});
  });

  it('现成的家具：椅子能坐、床能躺、桌子能撑；标的那一块下面真的有面', () => {
    expect(propContacts(asset('chair')).sit?.face).toBe(0);
    expect(propContacts(asset('bedDouble')).lie?.turn).toBe(0);
    expect(propContacts(asset('table')).top).toBeDefined();
    expect(propContacts(asset('bookcase'))).toEqual({});
    for (const entry of PROP_ASSETS) {
      const prop = asset(entry.id);
      const solid = propSolid(prop);
      const contacts = propContacts(prop);
      for (const key of ['sit', 'lie', 'top'] as const) {
        const spot = contacts[key];
        if (!spot) continue;
        const x = ((spot.rect.x[0] + spot.rect.x[1]) / 2) * prop.size[0];
        const z = ((spot.rect.z[0] + spot.rect.z[1]) / 2) * prop.size[2];
        const under = 'under' in spot && spot.under ? prop.size[1] * spot.under : 10;
        const y = topUnder([solid], x, z, under);
        expect(y, `${entry.id} ${key}`).not.toBeNull();
        // 坐的、躺的面不会比一米还高；撑手的台面在半米到一米之间
        expect(y!, `${entry.id} ${key}`).toBeLessThan(key === 'top' ? 1 : 0.95);
        if (key === 'top') expect(y!, `${entry.id} top`).toBeGreaterThan(0.4);
      }
    }
  });
});

describe('按钮什么时候是灰的', () => {
  it('两条腿的人形都能做；道具上没有那种面的是灰的', () => {
    expect(actionBlock('sit', solver, asset('chair'))).toBeNull();
    expect(actionBlock('sit', solver, basic('pole'))).toMatch(/没有能坐/);
    expect(actionBlock('lie', solver, asset('chair'))).toMatch(/没有能躺/);
    expect(actionBlock('top', solver, asset('chair'))).toMatch(/没有能撑/);
    expect(actionBlock('hold', solver, basic('pole'))).toBeNull();
    expect(actionBlock('lean', solver, basic('wall'))).toBeNull();
    expect(PROP_ACTIONS.map((a) => a.key)).toEqual(['sit', 'lie', 'top', 'hold', 'lean', 'hang', 'wrap']);
  });

  it('歪着的道具不能坐、躺、撑（先摆正）；扶、靠照样行', () => {
    const tilted = basic('box', { rot: [12, 0, 0] });
    expect(actionBlock('sit', solver, tilted)).toMatch(/摆正/);
    expect(actionBlock('top', solver, tilted)).toMatch(/摆正/);
    expect(actionBlock('hold', solver, tilted)).toBeNull();
    expect(actionBlock('sit', solver, basic('box', { rot: [3, 40, 0] }))).toBeNull();
  });

  it('不是两条腿的身体：每个都是灰的，说了原因', () => {
    const four = solverOf((s) => ({ ...s, counts: { ...s.counts, legs: 4 } }));
    expect(four.limbs.filter((l) => l.kind === 'leg').length).toBe(4);
    for (const { key } of PROP_ACTIONS) expect(actionBlock(key, four, basic('box'))).toMatch(/两条腿的人形/);
    const got = solvePropAction('sit', { solver: four, place: AWAY, posing: emptyPosing(), prop: basic('box'), props: [] });
    expect('error' in got).toBe(true);
  });

  it('没有手臂的不能撑、不能扶，还能坐', () => {
    const none = solverOf((s) => ({ ...s, counts: { ...s.counts, armPairs: 0 } }));
    expect(actionBlock('hold', none, basic('pole'))).toMatch(/没有手臂/);
    expect(actionBlock('top', none, asset('table'))).toMatch(/没有手臂/);
    expect(actionBlock('sit', none, basic('box'))).toBeNull();
  });
});

describe('坐上去', () => {
  it('椅子：朝前坐，胯在坐面上方，膝盖伸出前沿，整个人跟着椅子', () => {
    const chair = asset('chair');
    const got = act('sit', chair);
    expect(got.place.yaw).toBe(0);
    const seat = topUnder([propSolid(chair)], 0, 0.05, 10)!;
    const hips = boneAt(got, 'Hips');
    expect(hips[1]).toBeCloseTo(seat + 0.1 * k, 2);
    expect(Math.abs(hips[0])).toBeLessThan(0.08);
    // 膝盖在椅子前沿外面，脚在膝盖下面
    expect(boneAt(got, 'LowerLeg_L')[2]).toBeGreaterThan(chair.size[2] / 2);
    expect(boneAt(got, 'Foot_L')[1]).toBeLessThan(0.25);
    expect(got.links.map((l) => l.part)).toEqual([BODY_LINK]);
    expect(deepest(got, [chair])).toBeLessThan(0.06);
  });

  it('椅子转了、挪了：人跟着转、跟着挪', () => {
    const chair = asset('chair', { pos: [2, 0, -1], rot: [0, 90, 0] });
    const got = act('sit', chair);
    expect(got.place.yaw).toBe(90);
    const hips = boneAt(got, 'Hips');
    expect(Math.hypot(hips[0] - 2, hips[2] + 1)).toBeLessThan(0.12);
    // 脸朝椅子的前面（转了 90° 以后是 +X）
    expect(boneAt(got, 'LowerLeg_L')[0]).toBeGreaterThan(hips[0] + 0.25);
  });

  it('箱子：坐在离角色最近的那一边，脸朝外', () => {
    const box = basic('box');
    expect(act('sit', box, { place: { x: 0, z: 1.5, yaw: 180 } }).place.yaw).toBe(0);
    expect(act('sit', box, { place: { x: 0, z: -1.5, yaw: 0 } }).place.yaw).toBe(180);
    expect(act('sit', box, { place: { x: 1.5, z: 0, yaw: -90 } }).place.yaw).toBe(90);
    expect(act('sit', box, { place: { x: -1.5, z: 0, yaw: 90 } }).place.yaw).toBe(-90);
    const got = act('sit', box, { place: { x: 1.5, z: 0, yaw: -90 } });
    expect(boneAt(got, 'LowerLeg_L')[0]).toBeGreaterThan(box.size[0] / 2);
    expect(deepest(got, [box])).toBeLessThan(0.06);
  });

  it('矮的坐面脚踩着地、膝盖抬起来；高的（吧台凳）脚垂着', () => {
    const low = act('sit', basic('box', { size: [0.5, 0.25, 0.5] }));
    const ankle = solver.rig.head[solver.rig.names.indexOf('Foot_L')][1];
    expect(boneAt(low, 'Foot_L')[1]).toBeCloseTo(ankle, 2);
    expect(boneAt(low, 'LowerLeg_L')[1]).toBeGreaterThan(boneAt(low, 'UpperLeg_L')[1] + 0.05);
    const high = act('sit', asset('stoolBar'));
    expect(boneAt(high, 'Foot_L')[1]).toBeGreaterThan(0.3);
    expect(boneAt(high, 'LowerLeg_L')[1]).toBeCloseTo(boneAt(high, 'UpperLeg_L')[1], 1);
  });

  it('椅子放在台子上：人离地、脚落在台子上', () => {
    const stage = basic('box', { size: [2, 0.3, 2] }, 'p2');
    const chair = asset('chair', { pos: [0, 0.3, 0] });
    const got = act('sit', chair, { props: [chair, stage] });
    expect(placeY(got.place)).toBeCloseTo(0.3, 3);
    expect(boneAt(got, 'Hips')[1]).toBeGreaterThan(0.8);
  });

  it('手搭在大腿上', () => {
    const got = act('sit', asset('chair'));
    for (const side of ['L', 'R']) {
      const hand = boneAt(got, `Hand_${side}`);
      const thigh = boneAt(got, `UpperLeg_${side}`);
      expect(hand[1]).toBeGreaterThan(thigh[1] + 0.04);
      expect(hand[1]).toBeLessThan(thigh[1] + 0.2);
      expect(hand[2]).toBeGreaterThan(thigh[2] + 0.1);
    }
  });
});

describe('躺上去', () => {
  it('床：头朝床头、脚朝床尾，身体在床垫上方，整个人跟着床', () => {
    const bed = asset('bedDouble');
    const got = act('lie', bed);
    expect(got.place.yaw).toBe(0);
    const head = boneAt(got, 'Head');
    const foot = boneAt(got, 'Foot_L');
    expect(head[2]).toBeLessThan(-0.4);
    expect(foot[2]).toBeGreaterThan(0.4);
    const hips = boneAt(got, 'Hips');
    const mattress = topUnder([propSolid(bed)], hips[0], hips[2], 10)!;
    expect(hips[1]).toBeCloseTo(mattress + 0.12 * k, 2);
    expect(got.links.map((l) => l.part)).toEqual([BODY_LINK]);
    expect(deepest(got, [bed])).toBeLessThan(0.06);
  });

  it('角色在床的哪一边就躺哪一边，不躺到床沿外面', () => {
    const bed = asset('bedDouble');
    const right = boneAt(act('lie', bed, { place: { x: 2, z: 0, yaw: 0 } }), 'Hips')[0];
    const left = boneAt(act('lie', bed, { place: { x: -2, z: 0, yaw: 0 } }), 'Hips')[0];
    expect(right).toBeGreaterThan(0.3);
    expect(left).toBeLessThan(-0.3);
    expect(right).toBeLessThan(bed.size[0] / 2 - 0.2);
  });

  it('长箱子顺着长的那一边躺；浴缸躺在里面', () => {
    const slab = basic('box', { size: [2, 0.4, 0.8] });
    const got = act('lie', slab);
    expect(Math.abs(got.place.yaw)).toBe(90);
    expect(Math.abs(boneAt(got, 'Head')[0] - boneAt(got, 'Foot_L')[0])).toBeGreaterThan(1);
    const tub = asset('bathtub');
    const inside = act('lie', tub);
    expect(boneAt(inside, 'Hips')[1]).toBeLessThan(0.4);
    expect(deepest(inside, [tub])).toBeLessThan(0.06);
  });

  it('沙发上躺不下：脚搭在扶手上，不插进去', () => {
    const sofa = asset('loungeSofa');
    const got = act('lie', sofa);
    const seat = topUnder([propSolid(sofa)], 0, 0.1, 10)!;
    expect(boneAt(got, 'Foot_L')[1]).toBeGreaterThan(seat + 0.2);
    expect(deepest(got, [sofa])).toBeLessThan(0.06);
  });
});

describe('手撑着', () => {
  it('桌子：站在最近的那一边、面朝桌子，两只手落在台面上，钉在桌子上', () => {
    const table = asset('table');
    const got = act('top', table);
    expect(got.place.yaw).toBe(180);
    expect(got.place.z).toBeGreaterThan(table.size[2] / 2 + 0.15);
    expect(got.missed).toBe(0);
    const solid = propSolid(table);
    for (const side of ['L', 'R']) {
      const wrist = boneAt(got, `Hand_${side}`);
      expect(solidDistance(solid, wrist)).toBeGreaterThan(0.01);
      expect(solidDistance(solid, wrist)).toBeLessThan(0.06);
      expect(wrist[2]).toBeLessThan(table.size[2] / 2);
      // 钉着的点就是手腕现在在的地方
      const link = linkOf(got.links, `Hand_${side}`)!;
      expect(dist(linkPoint(table, link), wrist)).toBeLessThan(0.002);
    }
    // 左手在角色自己的左边：面朝 -Z 时是场景的 -X
    expect(boneAt(got, 'Hand_L')[0]).toBeLessThan(boneAt(got, 'Hand_R')[0]);
    expect(linkOf(got.links, BODY_LINK)).toBeUndefined();
    expect(deepest(got, [table])).toBeLessThan(0.06);
  });

  it('太矮、太高的台面撑不着，说原因', () => {
    expect(errorOf('top', asset('tableCoffee'))).toMatch(/太矮/);
    expect(errorOf('top', basic('box', { size: [1, 1.5, 1] }))).toMatch(/太高/);
  });

  it('圆桌：站在角色现在那一边', () => {
    const got = act('top', asset('tableRound'), { place: { x: -2, z: 0, yaw: 90 } });
    expect(got.place.x).toBeLessThan(-0.7);
    expect(Math.abs(got.place.z)).toBeLessThan(0.05);
    expect(got.place.yaw).toBe(90);
    expect(got.missed).toBe(0);
  });
});

describe('手扶着', () => {
  it('够不着：走到杆跟前、面朝它，一只手握在杆上，钉住', () => {
    const pole = basic('pole');
    const got = act('hold', pole);
    expect(got.walked).toBe(true);
    expect(Math.hypot(got.place.x, got.place.z)).toBeLessThan(0.6);
    expect(got.missed).toBe(0);
    const wrist = boneAt(got, got.part!);
    expect(solidDistance(propSolid(pole), wrist)).toBeLessThan(0.06);
    expect(wrist[1]).toBeGreaterThan(0.8);
    expect(got.links.map((l) => l.part)).toEqual([got.part]);
    // 没摆过姿势的：另一只手垂着，不是张开的
    const other = got.part === 'Hand_R' ? 'Hand_L' : 'Hand_R';
    expect(boneAt(got, other)[1]).toBeLessThan(1.05);
  });

  it('够得着：原地伸手，不走、别的姿势不动', () => {
    const pole = basic('pole', { pos: [-0.3, 0, 0.3] });
    const got = act('hold', pole, { place: at0 });
    expect(got.walked).toBe(false);
    expect(got.place).toEqual(at0);
    // 杆在角色的右前方：用右手
    expect(got.part).toBe('Hand_R');
    expect(solidDistance(propSolid(pole), boneAt(got, 'Hand_R'))).toBeLessThan(0.06);
  });

  it('再点一次换另一只手，先前那只还钉着', () => {
    const pole = basic('pole', { pos: [0, 0, 0.3] });
    const first = act('hold', pole, { place: at0 });
    const second = act('hold', pole, { place: first.place, posing: first.posing, links: first.links });
    expect(second.part).not.toBe(first.part);
    expect(second.links.map((l) => l.part).sort()).toEqual(['Hand_L', 'Hand_R']);
    expect(dist(boneAt(second, first.part!), boneAt(first, first.part!))).toBeLessThan(0.01);
  });

  it('坐着的时候够不着：不走过去，说够不着', () => {
    const chair = asset('chair');
    const pole = basic('pole', { pos: [3, 0, 0] }, 'p2');
    const seated = act('sit', chair);
    const got = solvePropAction('hold', { solver, place: seated.place, posing: seated.posing, links: seated.links, prop: pole, props: [chair, pole] });
    expect('error' in got && got.error).toMatch(/够不着/);
    // 就在手边的：坐着伸手，还坐在椅子上
    const close = basic('pole', { pos: [-0.35, 0, 0.3] }, 'p2');
    const held = solvePropAction('hold', { solver, place: seated.place, posing: seated.posing, links: seated.links, prop: close, props: [chair, close] });
    expect('error' in held).toBe(false);
    if (!('error' in held)) {
      expect(held.place).toEqual(seated.place);
      expect(held.links.map((l) => l.part).sort()).toEqual(['Hand_R', BODY_LINK].sort());
    }
  });
});

describe('背靠着', () => {
  it('墙板：背对着墙，脚在墙前面，胯贴着墙，整个人跟着墙', () => {
    const wall = basic('wall');
    const got = act('lean', wall);
    // 角色原来在墙的前面（+Z）：靠上去以后脸还朝 +Z
    expect(got.place.yaw).toBe(0);
    expect(got.place.z).toBeCloseTo(0.05 + 0.3 * k, 2);
    const hips = boneAt(got, 'Hips');
    expect(hips[2] - 0.05).toBeGreaterThan(0.08);
    expect(hips[2] - 0.05).toBeLessThan(0.14);
    // 脚没动地方（还在静止姿势的位置上）
    expect(boneAt(got, 'Foot_L')[2]).toBeGreaterThan(got.place.z - 0.08);
    expect(got.links.map((l) => l.part)).toEqual([BODY_LINK]);
    expect(deepest(got, [wall])).toBeLessThan(0.06);
  });

  it('从墙的另一面走过来：靠另一面', () => {
    const got = act('lean', basic('wall'), { place: { x: 0, z: -1.5, yaw: 0 } });
    expect(got.place.yaw).toBe(180);
    expect(got.place.z).toBeLessThan(-0.3);
  });

  it('太矮的靠不住；桌子沿可以靠', () => {
    expect(errorOf('lean', basic('box'))).toMatch(/太矮/);
    const table = asset('table');
    const got = act('lean', table);
    expect(boneAt(got, 'Hips')[2]).toBeGreaterThan(table.size[2] / 2 + 0.05);
    expect(deepest(got, [table])).toBeLessThan(0.06);
  });
});

describe('别的身体', () => {
  it('两对手臂、两个头的也能坐、能撑：多出来的手臂不乱伸', () => {
    const many = solverOf((s) => ({ ...s, counts: { ...s.counts, armPairs: 2, heads: 2 } }));
    const chair = asset('chair');
    const sat = solvePropAction('sit', { solver: many, place: AWAY, posing: emptyPosing(), prop: chair, props: [chair] });
    expect('error' in sat).toBe(false);
    const table = asset('table');
    const leaned = solvePropAction('top', { solver: many, place: AWAY, posing: emptyPosing(), prop: table, props: [table] });
    expect('error' in leaned).toBe(false);
    if (!('error' in leaned)) {
      expect(leaned.links.map((l) => l.part).sort()).toEqual(['Hand_L', 'Hand_R']);
      // 第二对手臂垂着：手在肩膀下面
      const f = forward(many.rig, stateOf(many, leaned.posing));
      const second = many.limbs.find((l) => l.kind === 'arm' && l.pair === 1)!;
      expect(f.pos[second.end][1]).toBeLessThan(f.pos[second.upper][1] - 0.2);
    }
    // 开着「一起动」：第二对照第一对伸出去（手往前、抬起来了），钉着的还是第一对
    const both = solvePropAction('top', { solver: many, place: AWAY, posing: emptyPosing(), prop: table, props: [table], follow: true });
    expect('error' in both).toBe(false);
    if (!('error' in both) && !('error' in leaned)) {
      const second = many.limbs.find((l) => l.kind === 'arm' && l.pair === 1)!;
      const hung = forward(many.rig, stateOf(many, leaned.posing)).pos[second.end];
      const out = forward(many.rig, stateOf(many, both.posing)).pos[second.end];
      expect(out[2]).toBeGreaterThan(hung[2] + 0.1);
      expect(both.links.map((l) => l.part).sort()).toEqual(['Hand_L', 'Hand_R']);
    }
  });
});
