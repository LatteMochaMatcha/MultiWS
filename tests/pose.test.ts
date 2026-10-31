// 摆姿势：姿势数据、骨架上的换算、全身 IK、控制点。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleCharacter } from '../src/character/assemble';
import { CHARACTER } from '../src/character/load';
import { skinVerticesInPlace } from '../src/character/pose';
import { type CharacterSource, readCharacter } from '../src/character/source';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, type V3, add, dot, len, norm, quatEuler, quatMul, rotate, sub } from '../src/geometry/vec';
import { type BodyCounts, type BodySpec, defaultSpec, normalizeSpec, parseSpecJson, serializeSpec } from '../src/model/spec';
import { buildHandles } from '../src/pose/handles';
import { POSE_LIBRARY } from '../src/pose/library';
import { quatAngle } from '../src/pose/math';
import { type Posing, cleanPosing, emptyPosing, flipPosing, isPosed, twinBone } from '../src/pose/posing';
import { type SourceBone, posingFromBones } from '../src/pose/retarget';
import { type PoseRig, forward, poseMatrices, posedBones, restState, tailOf } from '../src/pose/rig';
import { capturePins, dragAim, dragBend, dragBody, dragReach, turnBone } from '../src/pose/solve';
import { type Solver, makeSolver, mirrorState, posingOf, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { skinVertices } from '../src/rig/skin';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
import { rng } from './helpers';

const make = (counts: Partial<BodyCounts> = {}, rest: Partial<BodySpec> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, ...rest, counts: { ...base.counts, ...counts } };
};
const solverOf = (spec: BodySpec): Solver => makeSolver(buildSkeleton(buildFigure(spec)).bones);
const bone = (rig: PoseRig, name: string) => {
  const i = rig.index.get(name);
  if (i === undefined) throw new Error(`没有骨骼 ${name}`);
  return i;
};
const limb = (s: Solver, name: string) => {
  const i = s.limbs.findIndex((l) => l.name === name);
  if (i < 0) throw new Error(`没有肢体 ${name}`);
  return i;
};
const feet = (s: Solver) => new Set(s.limbs.filter((l) => l.kind === 'leg').map((l) => l.name));
const dist = (a: V3, b: V3) => len(sub(a, b));
const DEG = Math.PI / 180;

describe('姿势数据', () => {
  it('空姿势：没有骨骼、没有位移', () => {
    expect(emptyPosing()).toEqual({ version: 3, bones: {} });
    expect(isPosed(emptyPosing())).toBe(false);
  });

  it('乱七八糟的输入整理成空姿势，不抛错', () => {
    for (const junk of [null, undefined, 3, 'x', [], { bones: 5 }, { bones: [1, 2] }, { root: 'no' }]) {
      expect(cleanPosing(junk)).toEqual(emptyPosing());
    }
  });

  const messy = {
    A: [0, 0, 0, 1],
    B: [0, 0, 0, -1],
    C: [1, 0, 0],
    D: [0, Number.NaN, 0, 1],
    E: ['0', 0, 0, 1],
    F: [0, 0, 0.5, 0.5],
    G: [0, 0, 0, 0],
  };

  it('不是数字的、长度不对的、全是零的不留；「一共没转」是一句有用的话，留着', () => {
    const p = cleanPosing({ bones: messy, root: [0, 0, 0] });
    expect(p.version).toBe(3);
    expect(Object.keys(p.bones)).toEqual(['A', 'B', 'F']);
    expect(p.bones.B).toEqual([0, 0, 0, 1]);
    expect(p.root).toBeUndefined();
  });

  it('明写着第 1 版的照旧的意思读：等于没转的不留', () => {
    const p = cleanPosing({ version: 1, bones: messy });
    expect(p.version).toBe(1);
    expect(Object.keys(p.bones)).toEqual(['F']);
    // 第 2 版也照它自己的意思读（那一版和现在的只差在手上）
    expect(cleanPosing({ version: 2, bones: messy }).version).toBe(2);
    expect(Object.keys(cleanPosing({ version: 2, bones: messy }).bones)).toEqual(['A', 'B', 'F']);
    // 版本写得乱七八糟的当成现在这一版
    expect(cleanPosing({ version: 'x', bones: messy }).version).toBe(3);
  });

  it('旋转归一、w 取正、留 5 位小数', () => {
    const p = cleanPosing({ bones: { A: [0, 0, -2, -2] }, root: [0.123456789, 0, -0.5] });
    expect(p.bones.A).toEqual([0, 0, 0.70711, 0.70711]);
    expect(p.root).toEqual([0.12346, 0, -0.5]);
    expect(isPosed(p)).toBe(true);
  });

  it('骨骼名里的左右', () => {
    expect(twinBone('UpperArm_L')).toEqual({ side: 'L', twin: 'UpperArm_R' });
    expect(twinBone('Hand_R.003')).toEqual({ side: 'R', twin: 'Hand_L.003' });
    expect(twinBone('Wing_02_L')).toEqual({ side: 'L', twin: 'Wing_02_R' });
    for (const name of ['Hips', 'Head.002', 'Tail_01_03', 'LowerBody_01']) expect(twinBone(name)).toBeNull();
  });

  const sample: Posing = {
    version: 2,
    bones: { UpperArm_L: [0.1, 0.2, 0.3, 0.9274], 'Hand_R.002': [0, 0.6, 0, 0.8], Spine: [0, 0.2, 0.1, 0.9747] },
    root: [0.2, -0.1, 0.05],
  };


  it('左右翻转：两侧互换，中间的照镜子；翻两次回到原样', () => {
    const p = flipPosing(sample);
    expect(p.bones.UpperArm_R).toEqual([0.1, -0.2, -0.3, 0.9274]);
    expect(p.bones['Hand_L.002']).toEqual([0, -0.6, 0, 0.8]);
    expect(p.bones.Spine).toEqual([0, -0.2, -0.1, 0.9747]);
    expect(p.root).toEqual([-0.2, -0.1, 0.05]);
    expect(flipPosing(p)).toEqual(sample);
  });
});

describe('姿势存在配置里', () => {
  it('默认没有姿势；旧配置（没有 posing 字段）照常读', () => {
    expect(defaultSpec().posing).toEqual(emptyPosing());
    const old = JSON.parse(serializeSpec(defaultSpec()));
    delete old.posing;
    expect(normalizeSpec(old)).toEqual(defaultSpec());
  });

  it('存了再读回来一样', () => {
    const spec = { ...defaultSpec(), posing: cleanPosing({ bones: { Head: [0, 0.3, 0, 0.954], 'UpperArm_L.002': [0.5, 0, 0, 0.866] }, root: [0, -0.2, 0] }) };
    expect(parseSpecJson(serializeSpec(spec))).toEqual(spec);
  });

  it('配置里有现在这个身体上没有的骨骼：留着，不报错', () => {
    const spec = normalizeSpec({ counts: {}, posing: { bones: { 'Hand_L.004': [0, 0, 0.6, 0.8], Nonsense: [0.6, 0, 0, 0.8] } } });
    expect(Object.keys(spec.posing.bones).sort()).toEqual(['Hand_L.004', 'Nonsense']);
    const s = solverOf(spec);
    const state = stateOf(s, spec.posing);
    expect(state.local.every((q) => q[3] === 1)).toBe(true);
    // 摆过别的骨骼以后再存，那两条还在
    state.local[bone(s.rig, 'Head')] = quatEuler(0, 0.4, 0);
    const saved = posingOf(s, state, spec.posing);
    for (const name of ['Hand_L.004', 'Nonsense', 'Head', 'Hips', 'UpperArm_L', 'Foot_R']) expect(Object.keys(saved.bones), name).toContain(name);
  });

  it('第 1 版的姿势（上一版存的配置）照样读得出来', () => {
    const spec = normalizeSpec({ counts: {}, posing: { version: 1, bones: { Head: [0, 0.3, 0, 0.954] }, root: [0, -0.2, 0] } });
    expect(spec.posing.version).toBe(1);
    expect(parseSpecJson(serializeSpec(spec))).toEqual(spec);
  });
});

describe('骨架上的换算', () => {
  const s = solverOf(defaultSpec());
  const { rig } = s;

  it('没摆姿势：关节都在静止的位置，蒙皮矩阵是「不动」', () => {
    const f = forward(rig, restState(rig));
    rig.head.forEach((head, i) => expect(dist(f.pos[i], head), rig.names[i]).toBeLessThan(1e-12));
    const m = poseMatrices(rig, f);
    const still = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    m.forEach((value, k) => expect(value).toBeCloseTo(still[k % 12], 12));
  });

  it('转一根骨骼：它的终点和后面的骨骼跟着转，前面的不动；骨头长度不变', () => {
    const state = restState(rig);
    const upper = bone(rig, 'UpperArm_L');
    state.local[upper] = quatEuler(0, 0, 60 * DEG);
    const f = forward(rig, state);
    expect(dist(f.pos[upper], rig.head[upper])).toBeLessThan(1e-12);
    for (const name of ['LowerArm_L', 'Hand_L']) {
      const i = bone(rig, name);
      expect(dist(f.pos[i], rig.head[i]), name).toBeGreaterThan(0.05);
      const p = rig.parent[i];
      expect(dist(f.pos[i], f.pos[p]), name).toBeCloseTo(dist(rig.head[i], rig.head[p]), 9);
    }
    expect(dist(f.pos[bone(rig, 'Hand_R')], rig.head[bone(rig, 'Hand_R')])).toBeLessThan(1e-12);
    expect(dist(tailOf(rig, f, upper), f.pos[bone(rig, 'LowerArm_L')])).toBeLessThan(1e-9);
  });

  it('整个人的位移以胯离地的高度为 1：存、读不走样', () => {
    const state = restState(rig);
    state.root = [0.1, -0.3, 0.05];
    const posing = posingOf(s, state);
    expect(posing.root![1]).toBeCloseTo(-0.3 / rig.unit, 4);
    const back = stateOf(s, posing);
    expect(dist(back.root, state.root)).toBeLessThan(1e-4);
    const f = forward(rig, back);
    expect(f.pos[rig.hips][1]).toBeCloseTo(rig.head[rig.hips][1] - 0.3, 4);
    // 高个子上同一个姿势：胯往下蹲的比例一样
    const tall = solverOf({ ...defaultSpec(), shape: { ...defaultSpec().shape, height: 2 } });
    expect(stateOf(tall, posing).root[1] / tall.rig.unit).toBeCloseTo(-0.3 / rig.unit, 4);
  });

  it('摆好的骨架：起点、终点都在摆好以后的位置', () => {
    const state = restState(rig);
    state.local[bone(rig, 'Spine')] = quatEuler(0.5, 0, 0);
    const f = forward(rig, state);
    const posed = posedBones(rig, f);
    expect(posed.map((b) => b.name)).toEqual(rig.names);
    expect(posed.map((b) => b.parent)).toEqual(rig.parent);
    const head = bone(rig, 'Head');
    expect(posed[head].head[2]).toBeGreaterThan(rig.head[head][2] + 0.1);
    expect(dist(posed[head].head, posed[head].tail)).toBeCloseTo(dist(rig.head[head], rig.tail[head]), 9);
  });
});

describe('找手臂和腿', () => {
  it('标准人形：两条手臂、两条腿', () => {
    const s = solverOf(defaultSpec());
    expect(s.limbs.map((l) => l.name).sort()).toEqual(['Foot_L', 'Foot_R', 'Hand_L', 'Hand_R']);
    const arm = s.limbs[limb(s, 'Hand_L')];
    expect(arm).toMatchObject({ kind: 'arm', side: 1, pair: 0 });
    expect(s.rig.names[arm.upper]).toBe('UpperArm_L');
    expect(s.rig.names[arm.lower]).toBe('LowerArm_L');
    expect(arm.chain.map((b) => s.rig.names[b])).toEqual(['Shoulder_L', 'UpperChest', 'Chest', 'Spine']);
    const leg = s.limbs[limb(s, 'Foot_R')];
    expect(leg).toMatchObject({ kind: 'leg', side: -1, pair: 0 });
    expect(leg.chain).toEqual([]);
    for (const l of s.limbs) {
      expect(l.len1).toBeGreaterThan(0.2);
      expect(l.len2).toBeGreaterThan(0.2);
      expect(len(l.hinge)).toBeCloseTo(1, 9);
    }
  });

  it('多出来的手臂、腿都找得到，名字带着第几对', () => {
    const s = solverOf(make({ armPairs: 3, legs: 4 }));
    expect(s.limbs.filter((l) => l.kind === 'arm')).toHaveLength(6);
    expect(s.limbs.filter((l) => l.kind === 'leg')).toHaveLength(4);
    expect(s.limbs[limb(s, 'Hand_R.003')].pair).toBe(2);
    expect(s.limbs[limb(s, 'Foot_L.002')].pair).toBe(1);
    // 第二排手臂接在自己那一节胸腔上
    expect(s.limbs[limb(s, 'Hand_L.002')].chain.map((b) => s.rig.names[b])).toContain('Chest.002');
  });

  it('长在中线上的腿也认得出来：不分左右，圆点叫「中」', () => {
    const one = solverOf(make({ legs: 1 }));
    const legs = one.limbs.filter((l) => l.kind === 'leg');
    expect(legs.map((l) => [l.name, l.side])).toEqual([['Foot', 0]]);
    const grid = solverOf(make({ legs: 6 }, { legLayout: 'humantaur', hipLegs: 3 }));
    expect(grid.limbs.filter((l) => l.kind === 'leg').map((l) => l.name).sort()).toEqual(
      ['Foot', 'Foot.002', 'Foot_L', 'Foot_L.002', 'Foot_R', 'Foot_R.002'],
    );
    expect(grid.limbs.find((l) => l.name === 'Foot.002')?.pair).toBe(1);
  });

  it('蛛形、人腿人马、T-pose、扇形聚拢的手臂也一样', () => {
    expect(solverOf(make({ legs: 8 })).limbs.filter((l) => l.kind === 'leg')).toHaveLength(8);
    expect(solverOf(make({ legs: 4 }, { legLayout: 'humantaur' })).limbs.filter((l) => l.kind === 'leg')).toHaveLength(4);
    const fan = solverOf(make({ armPairs: 4 }, { armLayout: 'fan', pose: 'T' }));
    expect(fan.limbs.filter((l) => l.kind === 'arm')).toHaveLength(8);
  });
});

describe('拖手、拖脚', () => {
  const s = solverOf(defaultSpec());
  const { rig } = s;
  const rest = restState(rig);
  const f0 = forward(rig, rest);
  const hand = limb(s, 'Hand_L');
  const wrist = () => f0.pos[s.limbs[hand].end];
  const shoulder = () => f0.pos[s.limbs[hand].upper];

  it('够得着：手到了，只有这条手臂的上、下两节动', () => {
    const target = add(shoulder(), [0.15, -0.1, 0.3]);
    const state = dragReach(s, rest, hand, target, []);
    const f = forward(rig, state);
    expect(dist(f.pos[s.limbs[hand].end], target)).toBeLessThan(1e-6);
    const moved = rig.names.filter((_, i) => quatAngle(state.local[i]) > 1e-9);
    expect(moved.sort()).toEqual(['LowerArm_L', 'UpperArm_L']);
    expect(state.root).toEqual([0, 0, 0]);
  });

  it('手往身前收：手肘往后顶，不往前', () => {
    const target = add(shoulder(), [0.02, -0.25, 0.2]);
    const f = forward(rig, dragReach(s, rest, hand, target, []));
    const elbow = f.pos[s.limbs[hand].lower];
    const line = add(shoulder(), [0.01, -0.125, 0.1]);
    expect(elbow[2]).toBeLessThan(line[2] - 0.02);
  });

  it('T-pose（手臂伸直的）也是手肘往后顶', () => {
    const t = solverOf({ ...defaultSpec(), hands: 'mitten', pose: 'T' });
    const i = limb(t, 'Hand_R');
    const g0 = forward(t.rig, restState(t.rig));
    const from = g0.pos[t.limbs[i].upper];
    const target = add(from, [-0.3, 0, 0.15]);
    const f = forward(t.rig, dragReach(t, restState(t.rig), i, target, []));
    expect(dist(f.pos[t.limbs[i].end], target)).toBeLessThan(1e-6);
    expect(f.pos[t.limbs[i].lower][2]).toBeLessThan(from[2]);
  });

  it('抬脚：膝盖往前顶，脚掌保持原来的朝向', () => {
    const foot = limb(s, 'Foot_L');
    const ankle = f0.pos[s.limbs[foot].end];
    const target = add(ankle, [0, 0.3, 0.1]);
    const state = dragReach(s, rest, foot, target, []);
    const f = forward(rig, state);
    expect(dist(f.pos[s.limbs[foot].end], target)).toBeLessThan(1e-6);
    expect(f.pos[s.limbs[foot].lower][2]).toBeGreaterThan(f0.pos[s.limbs[foot].lower][2] + 0.05);
    expect(quatAngle(f.rot[s.limbs[foot].end])).toBeLessThan(1e-6);
  });

  it('够不着、脚钉着：脚不动，锁骨和脊柱帮着够，胯跟过去；腿不会被拉长', () => {
    const pins = capturePins(s, f0, feet(s));
    const target = add(wrist(), [0.5, 0.2, 0.9]);
    const state = dragReach(s, rest, hand, target, pins);
    const f = forward(rig, state);
    for (const pin of pins) {
      expect(dist(f.pos[s.limbs[pin.limb].end], pin.pos), s.limbs[pin.limb].name).toBeLessThan(1e-5);
      expect(quatAngle(quatMul(f.rot[s.limbs[pin.limb].end], [-pin.rot[0], -pin.rot[1], -pin.rot[2], pin.rot[3]]))).toBeLessThan(1e-5);
    }
    // 手比原地伸直够得更远
    const reach = s.limbs[hand].len1 + s.limbs[hand].len2;
    expect(dist(f.pos[s.limbs[hand].end], target)).toBeLessThan(dist(shoulder(), target) - reach - 0.1);
    expect(quatAngle(state.local[bone(rig, 'Shoulder_L')])).toBeGreaterThan(5 * DEG);
    expect(quatAngle(state.local[bone(rig, 'Shoulder_L')])).toBeLessThan(51 * DEG);
    for (const name of ['Spine', 'Chest', 'UpperChest']) {
      expect(quatAngle(state.local[bone(rig, name)]), name).toBeGreaterThan(1 * DEG);
      expect(quatAngle(state.local[bone(rig, name)]), name).toBeLessThan(66 * DEG);
    }
    expect(f.pos[rig.hips][2]).toBeGreaterThan(f0.pos[rig.hips][2] + 0.02);
    // 另一只手没钉：跟着身体走，自己不弯
    expect(quatAngle(state.local[bone(rig, 'UpperArm_R')])).toBeLessThan(1e-9);
  });

  it('伸手够身前的地面、脚钉着：是弯腰去够，不是整个人跪下去', () => {
    const pins = capturePins(s, f0, feet(s));
    const right = limb(s, 'Hand_R');
    const target: V3 = [-0.15, 0.25, 0.75];
    const state = dragReach(s, rest, right, target, pins);
    const f = forward(rig, state);
    expect(dist(f.pos[s.limbs[right].end], target)).toBeLessThan(0.01);
    // 胯还在原来七成以上的高度，没怎么往前窜；骨盆和脊柱都往前折了
    expect(f.pos[rig.hips][1]).toBeGreaterThan(f0.pos[rig.hips][1] * 0.7);
    expect(f.pos[rig.hips][2]).toBeLessThan(f0.pos[rig.hips][2] + 0.25);
    expect(quatAngle(state.local[rig.hips])).toBeGreaterThan(20 * DEG);
    expect(quatAngle(state.local[rig.hips])).toBeLessThan(66 * DEG);
    // 头比胯还靠前、比原来低
    const head = bone(rig, 'Head');
    expect(f.pos[head][2]).toBeGreaterThan(f.pos[rig.hips][2] + 0.2);
    expect(f.pos[head][1]).toBeLessThan(f0.pos[head][1] - 0.2);
    for (const pin of pins) expect(dist(f.pos[s.limbs[pin.limb].end], pin.pos)).toBeLessThan(1e-4);
  });

  it('脚没钉的时候骨盆不跟着转（一转腿就甩出去了）', () => {
    const state = dragReach(s, rest, hand, add(wrist(), [0.5, 0.2, 0.9]), []);
    expect(quatAngle(state.local[rig.hips])).toBeLessThan(1e-9);
  });

  it('够不着、什么都没钉：整个人跟过去，手到得了', () => {
    const target = add(wrist(), [0.8, 0.6, 0.5]);
    const f = forward(rig, dragReach(s, rest, hand, target, []));
    expect(dist(f.pos[s.limbs[hand].end], target)).toBeLessThan(0.02);
  });

  it('每次都从按下去那一刻的姿势算：结果只看目标在哪，和中间经过哪里无关', () => {
    const pins = capturePins(s, f0, feet(s));
    const target = add(wrist(), [0.2, 0.3, 0.4]);
    const a = dragReach(s, rest, hand, target, pins);
    dragReach(s, rest, hand, add(target, [1, 1, 1]), pins);
    const b = dragReach(s, rest, hand, target, pins);
    expect(b).toEqual(a);
    // 拖回原处就是原样
    const back = dragReach(s, rest, hand, wrist(), pins);
    for (let i = 0; i < rig.names.length; i++) expect(quatAngle(back.local[i]), rig.names[i]).toBeLessThan(1e-6);
  });

  it('人手动把前臂拧过一下：再拖手，拧的那一下还在', () => {
    const lower = s.limbs[hand].lower;
    const along = norm(sub(f0.pos[s.limbs[hand].end], f0.pos[lower]));
    const half = 20 * DEG;
    const twist: Quat = [along[0] * Math.sin(half), along[1] * Math.sin(half), along[2] * Math.sin(half), Math.cos(half)];
    const twisted = turnBone(s, rest, lower, twist, []);
    const before = forward(rig, twisted);
    const after = forward(rig, dragReach(s, twisted, hand, add(wrist(), [0.001, 0, 0]), []));
    const delta = quatMul(after.rot[lower], [-before.rot[lower][0], -before.rot[lower][1], -before.rot[lower][2], before.rot[lower][3]]);
    expect(quatAngle(delta)).toBeLessThan(1 * DEG);
    expect(quatAngle(after.rot[lower])).toBeGreaterThan(35 * DEG);
  });

  it('随便往哪拖都不出怪数：脚一直钉着，腿、手臂的长度不变', () => {
    const pins = capturePins(s, f0, feet(s));
    const rand = rng(7);
    for (let k = 0; k < 150; k++) {
      const target: V3 = [rand() * 3 - 1.5, rand() * 2.6 - 0.3, rand() * 3 - 1.5];
      const which = k % 3 === 0 ? limb(s, 'Hand_R') : hand;
      const state = dragReach(s, rest, which, target, pins);
      const f = forward(rig, state);
      for (const q of state.local) for (const c of q) expect(Number.isFinite(c)).toBe(true);
      for (const c of state.root) expect(Number.isFinite(c)).toBe(true);
      for (const pin of pins) expect(dist(f.pos[s.limbs[pin.limb].end], pin.pos)).toBeLessThan(1e-4);
      for (const l of s.limbs) {
        expect(dist(f.pos[l.upper], f.pos[l.lower])).toBeCloseTo(l.len1, 6);
        expect(dist(f.pos[l.lower], f.pos[l.end])).toBeCloseTo(l.len2, 6);
      }
    }
  });
});

describe('拖肘、拖膝', () => {
  const s = solverOf(defaultSpec());
  const { rig } = s;
  const hand = limb(s, 'Hand_L');
  // 先把手收到身前，手肘弯起来
  const f00 = forward(rig, restState(rig));
  const bent = dragReach(s, restState(rig), hand, add(f00.pos[s.limbs[hand].upper], [0.05, -0.2, 0.25]), []);
  const f0 = forward(rig, bent);

  it('手腕不动，手肘转到手指的那一边', () => {
    const l = s.limbs[hand];
    for (const toward of [[1, 0, 0], [0, 1, 0], [0, -1, -1]] as V3[]) {
      const state = dragBend(s, bent, hand, add(f0.pos[l.lower], toward));
      const f = forward(rig, state);
      expect(dist(f.pos[l.end], f0.pos[l.end])).toBeLessThan(1e-6);
      expect(dist(f.pos[l.upper], f0.pos[l.upper])).toBeLessThan(1e-9);
      // 手肘离「肩 → 腕」那根线的方向，和手指的方向在同一边
      const axis = norm(sub(f.pos[l.end], f.pos[l.upper]));
      const off = (p: V3) => {
        const d = sub(p, f.pos[l.upper]);
        return norm(sub(d, [axis[0] * dot(d, axis), axis[1] * dot(d, axis), axis[2] * dot(d, axis)]));
      };
      expect(dot(off(f.pos[l.lower]), off(add(f0.pos[l.lower], toward)))).toBeGreaterThan(0.999);
      // 手的朝向不跟着翻
      expect(quatAngle(quatMul(f.rot[l.end], [-f0.rot[l.end][0], -f0.rot[l.end][1], -f0.rot[l.end][2], f0.rot[l.end][3]]))).toBeLessThan(1e-6);
    }
  });

  it('换了一边以后再拖手，手肘留在新的那一边', () => {
    const l = s.limbs[hand];
    const out = dragBend(s, bent, hand, add(f0.pos[l.lower], [1, 0.3, 0]));
    const f1 = forward(rig, out);
    const f2 = forward(rig, dragReach(s, out, hand, add(f1.pos[l.end], [0, 0.05, 0.02]), []));
    expect(f2.pos[l.lower][0]).toBeGreaterThan(f2.pos[l.end][0]);
    expect(dist(f2.pos[l.lower], f1.pos[l.lower])).toBeLessThan(0.08);
  });
});

describe('拖胯', () => {
  const s = solverOf(defaultSpec());
  const { rig } = s;
  const rest = restState(rig);
  const f0 = forward(rig, rest);
  const pins = capturePins(s, f0, feet(s));
  const hips = f0.pos[rig.hips];

  it('往下拖：脚钉在地上，膝盖往前弯，上身整个跟着下去', () => {
    const state = dragBody(s, rest, add(hips, [0, -0.3, 0]), pins);
    const f = forward(rig, state);
    expect(f.pos[rig.hips][1]).toBeCloseTo(hips[1] - 0.3, 6);
    for (const pin of pins) {
      const l = s.limbs[pin.limb];
      expect(dist(f.pos[l.end], pin.pos)).toBeLessThan(1e-6);
      expect(f.pos[l.lower][2]).toBeGreaterThan(f0.pos[l.lower][2] + 0.1);
    }
    const head = bone(rig, 'Head');
    expect(f.pos[head][1]).toBeCloseTo(f0.pos[head][1] - 0.3, 6);
    expect(quatAngle(state.local[bone(rig, 'Spine')])).toBeLessThan(1e-9);
  });

  it('往上拖：腿伸直了就到头，脚不离地', () => {
    const f = forward(rig, dragBody(s, rest, add(hips, [0, 1, 0]), pins));
    for (const pin of pins) {
      const l = s.limbs[pin.limb];
      expect(dist(f.pos[l.end], pin.pos)).toBeLessThan(1e-4);
      expect(dist(f.pos[l.upper], pin.pos)).toBeLessThanOrEqual(l.len1 + l.len2 + 1e-9);
    }
    expect(f.pos[rig.hips][1]).toBeLessThan(hips[1] + 0.05);
  });

  it('脚没钉：整个人平着挪过去，谁也不弯', () => {
    const state = dragBody(s, rest, add(hips, [0.3, 0.5, -0.2]), []);
    expect(state.local.every((q) => q[3] === 1)).toBe(true);
    expect(dist(state.root, [0.3, 0.5, -0.2])).toBeLessThan(1e-12);
  });

  it('手也钉着：胯挪开以后手还在原处', () => {
    const all = capturePins(s, f0, new Set(s.limbs.map((l) => l.name)));
    const f = forward(rig, dragBody(s, rest, add(hips, [0.08, -0.15, 0.05]), all));
    for (const pin of all) expect(dist(f.pos[s.limbs[pin.limb].end], pin.pos), s.limbs[pin.limb].name).toBeLessThan(1e-5);
  });

  it('人马：四只蹄子都钉得住', () => {
    const taur = solverOf(make({ legs: 4 }));
    const g0 = forward(taur.rig, restState(taur.rig));
    const hooves = capturePins(taur, g0, feet(taur));
    expect(hooves).toHaveLength(4);
    const f = forward(taur.rig, dragBody(taur, restState(taur.rig), add(g0.pos[taur.rig.hips], [0, -0.12, 0.05]), hooves));
    for (const pin of hooves) expect(dist(f.pos[taur.limbs[pin.limb].end], pin.pos)).toBeLessThan(1e-4);
  });
});

describe('带着骨头转过去、用旋转环转', () => {
  const s = solverOf(defaultSpec());
  const { rig } = s;
  const rest = restState(rig);
  const f0 = forward(rig, rest);
  const pins = capturePins(s, f0, feet(s));

  it('拖头顶：头朝手指的方向歪过去，脖子也跟着弯一点', () => {
    const head = bone(rig, 'Head');
    const neck = bone(rig, 'Neck');
    const tip = tailOf(rig, f0, head);
    const target = add(tip, [0.15, -0.02, 0]);
    const state = dragAim(s, rest, [{ bone: head, weight: 0.7 }, { bone: neck, weight: 0.3 }], { bone: head, rest: rig.tail[head] }, target, pins);
    const f = forward(rig, state);
    expect(tailOf(rig, f, head)[0]).toBeGreaterThan(tip[0] + 0.1);
    expect(quatAngle(state.local[head])).toBeGreaterThan(quatAngle(state.local[neck]));
    expect(quatAngle(state.local[neck])).toBeGreaterThan(1 * DEG);
    expect(quatAngle(state.local[bone(rig, 'Spine')])).toBeLessThan(1e-9);
  });

  it('拖胸口弯腰：几节脊柱一起弯，脚不动', () => {
    const top = bone(rig, 'UpperChest');
    const links = ['Chest', 'Spine'].map((name) => ({ bone: bone(rig, name), weight: 0.6 }));
    const target = add(f0.pos[top], [0, -0.1, 0.25]);
    const state = dragAim(s, rest, links, { bone: top, rest: rig.head[top] }, target, pins);
    const f = forward(rig, state);
    expect(f.pos[top][2]).toBeGreaterThan(f0.pos[top][2] + 0.15);
    for (const link of links) expect(quatAngle(state.local[link.bone])).toBeGreaterThan(5 * DEG);
    for (const pin of pins) expect(dist(f.pos[s.limbs[pin.limb].end], pin.pos)).toBeLessThan(1e-9);
  });

  it('转胯：脚还钉在原地，上身跟着转', () => {
    const state = turnBone(s, rest, rig.hips, quatEuler(0, 0.5, 0), pins);
    const f = forward(rig, state);
    for (const pin of pins) expect(dist(f.pos[s.limbs[pin.limb].end], pin.pos)).toBeLessThan(1e-4);
    const left = bone(rig, 'UpperArm_L');
    expect(f.pos[left][2]).toBeLessThan(f0.pos[left][2] - 0.05);
  });

  it('转钉着的那条腿自己的骨头：这条腿就不钉了，照转', () => {
    const upper = bone(rig, 'UpperLeg_L');
    const state = turnBone(s, rest, upper, quatEuler(-0.6, 0, 0), pins);
    const f = forward(rig, state);
    const foot = bone(rig, 'Foot_L');
    expect(f.pos[foot][2]).toBeGreaterThan(f0.pos[foot][2] + 0.2);
    expect(dist(f.pos[bone(rig, 'Foot_R')], f0.pos[bone(rig, 'Foot_R')])).toBeLessThan(1e-9);
  });
});

describe('多肢体', () => {
  it('三对手臂：每只手都拖得动，够得着的时候互不影响', () => {
    const s = solverOf(make({ armPairs: 3 }));
    const { rig } = s;
    const rest = restState(rig);
    const f0 = forward(rig, rest);
    for (const [i, l] of s.limbs.entries()) {
      if (l.kind !== 'arm') continue;
      const target = add(f0.pos[l.upper], [l.side * 0.2, -0.05, 0.3]);
      const state = dragReach(s, rest, i, target, []);
      const f = forward(rig, state);
      expect(dist(f.pos[l.end], target), l.name).toBeLessThan(1e-6);
      for (const other of s.limbs) {
        if (other !== l) expect(dist(f.pos[other.end], f0.pos[other.end]), `${l.name} → ${other.name}`).toBeLessThan(1e-9);
      }
    }
  });

  it('手往头顶上够不着的地方伸：只有一对手臂时锁骨帮着抬不少；聚在一个肩膀上的几条，锁骨只帮一点点', () => {
    const lift = (spec: BodySpec, name: string) => {
      const s = solverOf(spec);
      const { rig } = s;
      const rest = restState(rig);
      const f0 = forward(rig, rest);
      const l = s.limbs[limb(s, name)];
      const state = dragReach(s, rest, limb(s, name), add(f0.pos[l.upper], [0.05, 0.9, 0]), capturePins(s, f0, feet(s)));
      return quatAngle(state.local[bone(rig, name.replace('Hand', 'Shoulder'))]) / DEG;
    };
    expect(lift(defaultSpec(), 'Hand_L')).toBeGreaterThan(20);
    // 上下排的每一排各有各的肩膀，不算挤着
    expect(lift(make({ armPairs: 3 }, { armLayout: 'stack' }), 'Hand_L.002')).toBeGreaterThan(20);
    for (const name of ['Hand_L', 'Hand_L.002', 'Hand_L.003', 'Hand_R.002']) {
      expect(lift(make({ armPairs: 3 }, { armLayout: 'fan' }), name), name).toBeLessThan(8.5);
    }
  });

  it('左边摆好照到右边：右手的位置正好是左手的镜像', () => {
    const s = solverOf(make({ armPairs: 2 }));
    const { rig } = s;
    const rest = restState(rig);
    const f0 = forward(rig, rest);
    let state = rest;
    for (const name of ['Hand_L', 'Hand_L.002']) {
      const l = s.limbs[limb(s, name)];
      state = dragReach(s, state, limb(s, name), add(f0.pos[l.upper], [0.25, 0.1, 0.2]), []);
    }
    const posing = posingOf(s, mirrorState(s, state, 'L'));
    const f = forward(rig, stateOf(s, posing));
    for (const name of ['Hand', 'LowerArm', 'UpperArm']) {
      for (const tail of ['', '.002']) {
        const left = f.pos[bone(rig, `${name}_L${tail}`)];
        const right = f.pos[bone(rig, `${name}_R${tail}`)];
        expect(dist(right, [-left[0], left[1], left[2]]), name + tail).toBeLessThan(1e-4);
      }
    }
  });
});

describe('控制点', () => {
  it('标准人形：胯、腰、胸、脖子、头、头顶，每条手臂三个，每条腿四个，每根手指的指尖一个', () => {
    const s = solverOf(defaultSpec());
    const handles = buildHandles(s);
    expect(handles.map((h) => h.id).sort()).toEqual(
      [
        'Hips', 'Spine', 'UpperChest', 'Neck', 'Head', 'Head:tip',
        ...['UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot', 'Toes'].flatMap((n) => [`${n}_L`, `${n}_R`]),
        ...['Thumb', 'Index', 'Middle', 'Ring', 'Little'].flatMap((n) => [`${n}3_L:tip`, `${n}3_R:tip`]),
      ].sort(),
    );
    const by = new Map(handles.map((h) => [h.id, h]));
    expect(by.get('Hips')).toMatchObject({ kind: 'body', group: 'torso', label: '胯' });
    expect(by.get('Hand_L')).toMatchObject({ kind: 'reach', group: 'arm', label: '手 左' });
    expect(by.get('LowerLeg_R')).toMatchObject({ kind: 'bend', group: 'leg', label: '膝 右' });
    expect(by.get('UpperArm_L')!.links.map((l) => s.rig.names[l.bone])).toEqual(['Shoulder_L']);
    expect(by.get('UpperChest')!.links.map((l) => s.rig.names[l.bone])).toEqual(['Chest', 'Spine']);
    expect(by.get('Head:tip')!.rest).toEqual(s.rig.tail[bone(s.rig, 'Head')]);
    // 点一下转的是从这个关节往外的那一段；指尖的点转的是整根手指
    for (const h of handles) {
      expect(s.rig.names[h.turn], h.id).toBe(h.group === 'finger' ? h.id.replace('3_', '1_').replace(':tip', '') : h.id.replace(':tip', ''));
    }
    expect(by.get('Index3_L:tip')).toMatchObject({ kind: 'aim', group: 'finger', label: '食指 左' });
    expect(by.get('Thumb3_R:tip')).toMatchObject({ kind: 'aim', group: 'finger', label: '拇指 右' });
  });

  it('多头多臂：每个头、每条手臂都有自己的点，名字里带着第几个', () => {
    const s = solverOf(make({ heads: 3, armPairs: 2 }));
    const handles = buildHandles(s);
    const labels = handles.map((h) => h.label);
    for (const label of ['头', '头 2', '头 3', '头顶 3', '脖子 2', '手 左', '手 右 2', '肘 左 2']) expect(labels).toContain(label);
    expect(new Set(handles.map((h) => h.id)).size).toBe(handles.length);
  });
});

describe('摆好姿势的网格', () => {
  it('抬手以后：手上的顶点跟过去了，脚上的顶点没动', () => {
    const figure = buildFigure(defaultSpec());
    const unit = { parts: figure.parts, scale: 1 };
    const mesh = fuseParts(figure.parts, { voxel: VOXEL.draft, blend: 0.02 });
    const skeleton = buildSkeleton(unit);
    const skin = skinVertices(unit, skeleton, mesh.positions);
    const s = makeSolver(skeleton.bones);
    const { rig } = s;
    const hand = limb(s, 'Hand_L');
    const f0 = forward(rig, restState(rig));
    const lift: V3 = [0.1, 0.5, 0.2];
    const f = forward(rig, dragReach(s, restState(rig), hand, add(f0.pos[s.limbs[hand].end], lift), capturePins(s, f0, feet(s))));
    const positions = mesh.positions.slice();
    const normals = mesh.normals.slice();
    skinVerticesInPlace(positions, normals, skin.joints, skin.weights, poseMatrices(rig, f));
    const wrist = f0.pos[s.limbs[hand].end];
    let handMoved = 0;
    let handCount = 0;
    let footMoved = 0;
    for (let v = 0; v < positions.length; v += 3) {
      const before: V3 = [mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]];
      const after: V3 = [positions[v], positions[v + 1], positions[v + 2]];
      if (dist(before, add(wrist, [0.02, -0.06, 0.02])) < 0.05) {
        handMoved += dist(sub(after, before), rotate([0, 0, 0, 1], lift)) < 0.2 ? 1 : 0;
        handCount++;
      }
      if (before[1] < 0.1) footMoved = Math.max(footMoved, dist(before, after));
      for (const c of after) expect(Number.isFinite(c)).toBe(true);
    }
    expect(handCount).toBeGreaterThan(5);
    expect(handMoved).toBe(handCount);
    // 脚踝钉着、脚掌的朝向也没变；只有脚踝上面一点点跟着小腿的顶点会动几毫米
    expect(footMoved).toBeLessThan(0.005);
  });
});

describe('成品角色的骨架', () => {
  let cached: CharacterSource | null = null;
  const source = () => {
    if (!cached) {
      const file = readFileSync(new URL(`../public/${CHARACTER.url}`, import.meta.url));
      cached = readCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, CHARACTER);
    }
    return cached;
  };
  const solver = (counts: Partial<BodyCounts> = {}): Solver => {
    const build = assembleCharacter(source(), make(counts, { bodyStyle: 'character' }));
    return makeSolver(build.bones);
  };

  it('手臂、腿、脊柱、头都认得出来，控制点齐全', () => {
    const s = solver();
    expect(s.rig.names[s.rig.hips]).toBe('Hips');
    expect(s.limbs.map((l) => l.name).sort()).toEqual(['Foot_L', 'Foot_R', 'Hand_L', 'Hand_R']);
    const ids = buildHandles(s).map((h) => h.id);
    for (const id of ['Hips', 'Spine', 'UpperChest', 'Neck', 'Head', 'Head:tip', 'UpperArm_L', 'LowerArm_R', 'Hand_L', 'UpperLeg_R', 'LowerLeg_L', 'Foot_R']) {
      expect(ids, id).toContain(id);
    }
  });

  it('头发、裙摆、袖子各是一串，末梢有圆点；手指在指尖有圆点；眼睛、帮着拧的骨骼没有', () => {
    const s = solver();
    const handles = buildHandles(s);
    const hair = handles.filter((h) => h.group === 'hair');
    expect(hair.filter((h) => h.label.startsWith('头发'))).toHaveLength(15);
    expect(hair.filter((h) => h.label.startsWith('裙摆')).map((h) => h.label).sort()).toEqual(['裙摆 侧 右', '裙摆 侧 左', '裙摆 前 右', '裙摆 前 左', '裙摆 后 右', '裙摆 后 左'].sort());
    const skirt = handles.find((h) => h.id === 'SkirtBack2_L:tip')!;
    expect(s.rig.names[skirt.turn]).toBe('SkirtBack1_L');
    expect(skirt.links.map((l) => s.rig.names[l.bone])).toEqual(['SkirtBack2_L', 'SkirtBack1_L']);
    for (const h of handles) expect(h.id).not.toMatch(/Sec_|Eye/);
    // 手指只在指尖有点，归在「手指」那一组，不会混进头发衣摆里
    const fingers = handles.filter((h) => /Thumb|Index|Middle|Ring|Little/.test(h.id));
    expect(fingers.map((h) => h.id).sort()).toEqual(['Thumb', 'Index', 'Middle', 'Ring', 'Little'].flatMap((n) => [`${n}3_L:tip`, `${n}3_R:tip`]).sort());
    for (const h of fingers) expect(h.group, h.id).toBe('finger');
    expect(new Set(handles.map((h) => h.id)).size).toBe(handles.length);
  });

  it('白模人台上摆的姿势换到她身上：骨头朝着同样的方向', () => {
    const from = solverOf(defaultSpec());
    const f0 = forward(from.rig, restState(from.rig));
    let state = dragReach(from, restState(from.rig), limb(from, 'Hand_R'), add(f0.pos[bone(from.rig, 'UpperArm_R')], [-0.15, 0.35, 0.2]), capturePins(from, f0, feet(from)));
    state = turnBone(from, state, bone(from.rig, 'UpperLeg_L'), quatEuler(-0.7, 0, 0.1), []);
    const posing = posingOf(from, state);
    const to = solver();
    const fa = forward(from.rig, state);
    const fb = forward(to.rig, stateOf(to, posing));
    const dir = (s: Solver, f: ReturnType<typeof forward>, a: string, b: string) => norm(sub(f.pos[bone(s.rig, b)], f.pos[bone(s.rig, a)]));
    // 手臂是照骨头的方向对的
    for (const [a, b] of [['UpperArm_R', 'LowerArm_R'], ['LowerArm_R', 'Hand_R'], ['UpperArm_L', 'LowerArm_L']]) {
      expect(dot(dir(from, fa, a, b), dir(to, fb, a, b)), `${a} → ${b}`).toBeGreaterThan(0.9999);
    }
    // 腿是照「从静止姿势转了多少」对的：抬起来的那条大腿转的角度一样
    const turned = (s: Solver, f: ReturnType<typeof forward>) => quatAngle(f.rot[bone(s.rig, 'UpperLeg_L')]);
    expect(turned(to, fb)).toBeCloseTo(turned(from, fa), 3);
    // 她的头发、裙摆、手指姿势里没有：跟着身体走
    const stateB = stateOf(to, posing);
    for (const name of ['Hair_01_01', 'SkirtSide1_L', 'Index1_R', 'Bust1_L']) expect(quatAngle(stateB.local[bone(to.rig, name)]), name).toBeLessThan(1e-9);
  });

  it('拖手、蹲下都算得出来；复制出来的手臂也拖得动', () => {
    const s = solver({ armPairs: 2 });
    const { rig } = s;
    expect(s.limbs.filter((l) => l.kind === 'arm')).toHaveLength(4);
    const rest = restState(rig);
    const f0 = forward(rig, rest);
    const pins = capturePins(s, f0, feet(s));
    for (const name of ['Hand_L', 'Hand_R.002']) {
      const l = s.limbs[limb(s, name)];
      const target = add(f0.pos[l.upper], [l.side * 0.1, 0.05, 0.25]);
      const f = forward(rig, dragReach(s, rest, limb(s, name), target, pins));
      expect(dist(f.pos[l.end], target), name).toBeLessThan(1e-6);
      // 手肘在身后那一侧
      expect(f.pos[l.lower][2], name).toBeLessThan(target[2]);
    }
    const f = forward(rig, dragBody(s, rest, add(f0.pos[rig.hips], [0, -0.2, 0]), pins));
    for (const pin of pins) {
      const l = s.limbs[pin.limb];
      expect(dist(f.pos[l.end], pin.pos)).toBeLessThan(1e-5);
      expect(f.pos[l.lower][2], '膝盖往前').toBeGreaterThan(f0.pos[l.lower][2] + 0.05);
    }
  });
});

describe('姿势的记法不依赖静止姿势', () => {
  // 并指的手是照约定的样子摆的（平举、手心朝下就是它静止的样子）；分指的手是现成的网格，手掌本来就带一点角度
  const a = solverOf({ ...defaultSpec(), hands: 'mitten' });
  const t = solverOf({ ...defaultSpec(), hands: 'mitten', pose: 'T' });
  const dirOf = (s: Solver, f: ReturnType<typeof forward>, from: string, to: string) => norm(sub(f.pos[bone(s.rig, to)], f.pos[bone(s.rig, from)]));

  /** 在 A-pose 的身体上摆一个姿势：抬手、蹲一点、歪头 */
  const posed = (() => {
    const f0 = forward(a.rig, restState(a.rig));
    const pins = capturePins(a, f0, feet(a));
    let state = dragReach(a, restState(a.rig), limb(a, 'Hand_L'), add(f0.pos[bone(a.rig, 'UpperArm_L')], [0.2, 0.3, 0.25]), pins);
    state = dragBody(a, state, add(f0.pos[a.rig.hips], [0.02, -0.15, 0]), capturePins(a, forward(a.rig, state), feet(a)));
    state = turnBone(a, state, bone(a.rig, 'Head'), quatEuler(0.1, 0.4, 0), []);
    return state;
  })();
  const posing = posingOf(a, posed);

  it('没摆过的是空姿势；摆过以后身上的主要骨骼每根都记，别的不记', () => {
    expect(posingOf(a, restState(a.rig))).toEqual(emptyPosing());
    expect(posing.version).toBe(3);
    // 手指没摆过，不记
    expect(Object.keys(posing.bones).sort()).toEqual(a.rig.names.filter((_, i) => a.main[i]).sort());
    // 带尾巴的身体：没转过的尾巴不记
    const tailed = solverOf(make({ tails: 1 }));
    const state = restState(tailed.rig);
    state.local[bone(tailed.rig, 'Head')] = quatEuler(0, 0.3, 0);
    expect(Object.keys(posingOf(tailed, state).bones).some((name) => name.startsWith('Tail'))).toBe(false);
    state.local[bone(tailed.rig, 'Tail_01_02')] = quatEuler(0.3, 0, 0);
    expect(Object.keys(posingOf(tailed, state).bones).filter((name) => name.startsWith('Tail'))).toEqual(['Tail_01_02']);
  });

  it('存了再读回来是同一个姿势', () => {
    const back = stateOf(a, posing);
    const f1 = forward(a.rig, posed);
    const f2 = forward(a.rig, back);
    a.rig.names.forEach((name, i) => expect(dist(f1.pos[i], f2.pos[i]), name).toBeLessThan(2e-4));
    // 再存一遍，数还是那些数（差在最后一位小数的取整上）
    const again = posingOf(a, back);
    expect(Object.keys(again.bones)).toEqual(Object.keys(posing.bones));
    for (const [name, q] of Object.entries(posing.bones)) q.forEach((c, k) => expect(again.bones[name][k], name).toBeCloseTo(c, 4));
    expect(again.root).toEqual(posing.root);
  });

  it('T-pose 的身体上，手臂的骨骼就是从它自己的静止姿势算起', () => {
    for (const name of ['UpperArm_L', 'LowerArm_R', 'Hand_L']) expect(quatAngle(t.frames[bone(t.rig, name)]), name).toBeLessThan(1e-6);
    for (const name of ['UpperArm_L', 'LowerArm_R']) expect(quatAngle(a.frames[bone(a.rig, name)]), name).toBeGreaterThan(20 * DEG);
    for (const s of [a, t]) for (const name of ['Hips', 'Spine', 'Head', 'UpperLeg_L', 'Foot_R', 'Shoulder_L']) expect(s.frames[bone(s.rig, name)]).toEqual([0, 0, 0, 1]);
  });

  it('换成 T-pose 的身体：同一份姿势摆出来，每根骨头还是朝着原来的方向', () => {
    const fa = forward(a.rig, posed);
    const ft = forward(t.rig, stateOf(t, posing));
    for (const [from, to] of [['UpperArm_L', 'LowerArm_L'], ['LowerArm_L', 'Hand_L'], ['UpperArm_R', 'LowerArm_R'], ['LowerArm_R', 'Hand_R'], ['UpperLeg_L', 'LowerLeg_L'], ['Neck', 'Head'], ['Hips', 'Spine']]) {
      expect(dot(dirOf(a, fa, from, to), dirOf(t, ft, from, to)), `${from} → ${to}`).toBeGreaterThan(0.9999);
    }
    // 没动过的那只手：在 A-pose 的身体上是垂着的，换到 T-pose 的身体上还是垂着的（没有变回平举）
    expect(dirOf(t, ft, 'UpperArm_R', 'LowerArm_R')[1]).toBeLessThan(-0.5);
    // 头转过的那一下也在
    expect(quatAngle(quatMul(ft.rot[bone(t.rig, 'Head')], [-fa.rot[bone(a.rig, 'Head')][0], -fa.rot[bone(a.rig, 'Head')][1], -fa.rot[bone(a.rig, 'Head')][2], fa.rot[bone(a.rig, 'Head')][3]]))).toBeLessThan(1e-3);
  });

  it('没摆过的时候，换 A-pose / T-pose 换的就是静止姿势', () => {
    const f = forward(t.rig, stateOf(t, emptyPosing()));
    expect(Math.abs(dirOf(t, f, 'UpperArm_L', 'LowerArm_L')[1])).toBeLessThan(0.05);
  });

  it('多出来的手臂姿势里没有：跟着身体走，保持自己静止时的样子', () => {
    const more = solverOf(make({ armPairs: 2 }));
    const state = stateOf(more, posing);
    for (const name of ['Shoulder_L.002', 'UpperArm_L.002', 'LowerArm_R.002', 'Hand_R.002']) expect(quatAngle(state.local[bone(more.rig, name)]), name).toBeLessThan(1e-9);
    expect(quatAngle(state.local[bone(more.rig, 'UpperArm_L')])).toBeGreaterThan(5 * DEG);
  });

  it('上一版存的姿势（记的是相对静止姿势转了多少）：读出来还是原来的样子，再存就换成新的记法', () => {
    const old: Posing = { version: 1, bones: {} };
    a.rig.names.forEach((name, i) => {
      const q = posed.local[i];
      if (quatAngle(q) > 1e-9) old.bones[name] = [q[0], q[1], q[2], q[3]];
    });
    old.root = [posed.root[0] / a.rig.unit, posed.root[1] / a.rig.unit, posed.root[2] / a.rig.unit];
    const state = stateOf(a, cleanPosing(JSON.parse(JSON.stringify(old))));
    const f1 = forward(a.rig, posed);
    const f2 = forward(a.rig, state);
    a.rig.names.forEach((name, i) => expect(dist(f1.pos[i], f2.pos[i]), name).toBeLessThan(2e-4));
    expect(posingOf(a, state).version).toBe(3);
    // 旧记法里别的身体上的骨骼换算不了，不留
    const kept = posingOf(a, state, { version: 1, bones: { 'Hand_L.004': [0, 0, 0.6, 0.8] } });
    expect(kept.bones['Hand_L.004']).toBeUndefined();
  });

  it('左 → 右、右 → 左：对侧相对身体摆成镜像（身子拧着也一样），中间的骨骼和整个人的位置不动', () => {
    for (const s of [a, t]) {
      const before = stateOf(s, posing);
      // 从胸口看过去，两条手臂的每个关节互为镜像
      const symmetric = (state: typeof before) => {
        const f = forward(s.rig, state);
        const chest = bone(s.rig, 'UpperChest');
        const seen = (name: string): V3 => {
          const q = f.rot[chest];
          return rotate([-q[0], -q[1], -q[2], q[3]], sub(f.pos[bone(s.rig, name)], f.pos[chest]));
        };
        for (const name of ['Hand', 'LowerArm', 'UpperArm']) {
          const left = seen(`${name}_L`);
          expect(dist(seen(`${name}_R`), [-left[0], left[1], left[2]]), name).toBeLessThan(1e-6);
        }
      };
      const state = mirrorState(s, before, 'L');
      symmetric(state);
      for (const name of ['Hips', 'Spine', 'Chest', 'Head', 'UpperArm_L', 'Foot_L']) expect(state.local[bone(s.rig, name)], name).toEqual(before.local[bone(s.rig, name)]);
      expect(state.root).toEqual(before.root);
      // 再照一遍不变
      expect(mirrorState(s, state, 'L')).toEqual(state);
      // 反过来照：左手臂变成右手臂（没抬过的那只）的镜像，右手臂自己不动
      const back = mirrorState(s, before, 'R');
      symmetric(back);
      expect(back.local[bone(s.rig, 'UpperArm_R')]).toEqual(before.local[bone(s.rig, 'UpperArm_R')]);
    }
  });
});

describe('尾巴、翅膀、兽身：一串一串的', () => {
  const s = solverOf(make({ tails: 2, wingPairs: 1, legs: 4 }));
  const { rig } = s;
  const handles = buildHandles(s);
  const by = new Map(handles.map((h) => [h.id, h]));

  it('每条尾巴、每只翅膀、兽身的末梢各有一个圆点', () => {
    const tails = handles.filter((h) => h.group === 'tail').map((h) => `${h.id} ${h.label}`);
    expect(tails.sort()).toEqual(['LowerBody_01:tip 兽身 1', 'Tail_01_05:tip 尾巴 1', 'Tail_02_05:tip 尾巴 2', 'Wing_01_L:tip 翅膀 左', 'Wing_01_R:tip 翅膀 右'].sort());
    const tail = by.get('Tail_01_05:tip')!;
    // 圆点在尾巴尖上，点一下转的是整条尾巴（绕尾根），拖的时候每一节都出力
    expect(tail.rest).toEqual(rig.tail[bone(rig, 'Tail_01_05')]);
    expect(rig.names[tail.turn]).toBe('Tail_01_01');
    expect(tail.links.map((l) => rig.names[l.bone])).toEqual(['Tail_01_05', 'Tail_01_04', 'Tail_01_03', 'Tail_01_02', 'Tail_01_01']);
    expect(rig.names[by.get('Wing_01_L:tip')!.turn]).toBe('Wing_01_L');
  });

  it('拖尾巴尖：整条尾巴朝那边弯过去，尾根不动，身体不动', () => {
    const tail = by.get('Tail_01_05:tip')!;
    const rest = restState(rig);
    const f0 = forward(rig, rest);
    const tip0 = tailOf(rig, f0, tail.anchor);
    const target = add(tip0, [0.25, 0.2, 0.1]);
    const state = dragAim(s, rest, tail.links, { bone: tail.anchor, rest: tail.rest }, target, capturePins(s, f0, feet(s)));
    const f = forward(rig, state);
    expect(dist(tailOf(rig, f, tail.anchor), target)).toBeLessThan(dist(tip0, target) * 0.25);
    expect(dist(f.pos[tail.turn], f0.pos[tail.turn])).toBeLessThan(1e-9);
    const bent = tail.links.filter((l) => quatAngle(state.local[l.bone]) > 2 * DEG);
    expect(bent.length).toBeGreaterThanOrEqual(3);
    for (const name of ['Hips', 'Spine', 'UpperLeg_L', 'Tail_02_01']) expect(quatAngle(state.local[bone(rig, name)]), name).toBeLessThan(1e-9);
  });

  it('拖翅膀尖：翅膀绕翼根转过去', () => {
    const wing = by.get('Wing_01_R:tip')!;
    const rest = restState(rig);
    const f0 = forward(rig, rest);
    const tip0 = tailOf(rig, f0, wing.anchor);
    const target = add(tip0, [0, -0.3, -0.2]);
    const f = forward(rig, dragAim(s, rest, wing.links, { bone: wing.anchor, rest: wing.rest }, target, []));
    expect(dot(norm(sub(tailOf(rig, f, wing.anchor), f.pos[wing.turn])), norm(sub(target, f.pos[wing.turn])))).toBeGreaterThan(0.9999);
  });
});

describe('别的骨架上的姿势换成工坊的', () => {
  /** 把一副骨架摆好的样子当成「别的骨架」交出去 */
  const asSource = (s: Solver, state: ReturnType<typeof restState>): SourceBone[] => {
    const f = forward(s.rig, state);
    return s.rig.names.map((name, i) => ({ name, parent: s.rig.parent[i], rest: s.rig.head[i], posed: f.pos[i], turn: f.rot[i] }));
  };
  const a = solverOf({ ...defaultSpec(), hands: 'mitten' });
  const f0 = forward(a.rig, restState(a.rig));
  let posed = dragReach(a, restState(a.rig), limb(a, 'Hand_L'), add(f0.pos[bone(a.rig, 'UpperArm_L')], [0.15, 0.3, 0.25]), capturePins(a, f0, feet(a)));
  posed = dragBody(a, posed, add(f0.pos[a.rig.hips], [0.05, -0.2, 0.03]), capturePins(a, forward(a.rig, posed), feet(a)));

  it('拿工坊自己的骨架当来源：换出来的和直接存的是同一份（整个人只留高低）', () => {
    const direct = posingOf(a, posed);
    const converted = posingFromBones(asSource(a, posed));
    // 换出来的每根骨骼都记（来源的手指也一根根记着）；直接存的那些，数是一样的
    expect(Object.keys(converted.bones).sort()).toEqual([...a.rig.names].sort());
    for (const [name, q] of Object.entries(direct.bones)) q.forEach((c, k) => expect(converted.bones[name][k], name).toBeCloseTo(c, 4));
    // 多记的那些（没动过的手指）读回来还是没动
    const back = stateOf(a, converted);
    a.rig.names.forEach((name, i) => {
      if (!(name in direct.bones)) expect(quatAngle(back.local[i]), name).toBeLessThan(1e-4);
    });
    expect(converted.root![0]).toBe(0);
    expect(converted.root![2]).toBe(0);
    expect(converted.root![1]).toBeCloseTo(direct.root![1], 4);
  });

  it('来源是 A-pose、目标是 T-pose：手臂朝着同一个方向', () => {
    const t = solverOf({ ...defaultSpec(), hands: 'mitten', pose: 'T' });
    const converted = posingFromBones(asSource(a, posed));
    const fa = forward(a.rig, posed);
    const ft = forward(t.rig, stateOf(t, converted));
    for (const [from, to] of [['UpperArm_L', 'LowerArm_L'], ['LowerArm_L', 'Hand_L'], ['UpperArm_R', 'LowerArm_R']]) {
      const da = norm(sub(fa.pos[bone(a.rig, to)], fa.pos[bone(a.rig, from)]));
      const dt = norm(sub(ft.pos[bone(t.rig, to)], ft.pos[bone(t.rig, from)]));
      expect(dot(da, dt), `${from} → ${to}`).toBeGreaterThan(0.9999);
    }
  });

  it('来源什么都没动：换出来每根骨骼都在静止的样子（手臂是它自己静止时的方向）', () => {
    const converted = posingFromBones(asSource(a, restState(a.rig)));
    expect(converted.root).toBeUndefined();
    const state = stateOf(a, converted);
    state.local.forEach((q, i) => expect(quatAngle(q), a.rig.names[i]).toBeLessThan(1e-4));
  });
});

describe('现成的姿势', () => {
  it('有几十个，名字不重样，身上的主要骨骼都有', () => {
    expect(POSE_LIBRARY.length).toBeGreaterThan(30);
    expect(new Set(POSE_LIBRARY.map((p) => p.name)).size).toBe(POSE_LIBRARY.length);
    for (const preset of POSE_LIBRARY) {
      expect(preset.posing.version, preset.name).toBe(3);
      for (const name of ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head', 'UpperArm_L', 'LowerArm_R', 'Hand_L', 'UpperLeg_R', 'LowerLeg_L', 'Foot_R']) {
        expect(preset.posing.bones[name], `${preset.name} ${name}`).toBeDefined();
      }
    }
  });

  it('套到白模人台上：每个都算得出来，骨头不会折到身体外面去（头在胯上面或者人是躺着的），多出来的手臂不动', () => {
    const s = solverOf(make({ armPairs: 2, tails: 1 }));
    const names = new Map(POSE_LIBRARY.map((p) => [p.name, p]));
    for (const preset of POSE_LIBRARY) {
      const state = stateOf(s, preset.posing);
      const f = forward(s.rig, state);
      for (const p of f.pos) for (const c of p) expect(Number.isFinite(c), preset.name).toBe(true);
      for (const name of ['UpperArm_L.002', 'LowerArm_R.002', 'Tail_01_02']) expect(quatAngle(state.local[bone(s.rig, name)]), `${preset.name} ${name}`).toBeLessThan(1e-9);
    }
    // 挑两个看得出对错的：站着的时候头在胯的正上方；坐着的时候大腿是往前伸的
    const up = (name: string) => {
      const f = forward(s.rig, stateOf(s, names.get(name)!.posing));
      return norm(sub(f.pos[bone(s.rig, 'Head')], f.pos[s.rig.hips]));
    };
    expect(up('站着')[1]).toBeGreaterThan(0.97);
    expect(up('仰面躺着')[1]).toBeLessThan(0.3);
    const sit = forward(s.rig, stateOf(s, names.get('坐着')!.posing));
    const thigh = norm(sub(sit.pos[bone(s.rig, 'LowerLeg_L')], sit.pos[bone(s.rig, 'UpperLeg_L')]));
    expect(thigh[2]).toBeGreaterThan(0.8);
    // 举枪瞄准：两只手都在胸前
    const aim = forward(s.rig, stateOf(s, names.get('举枪瞄准')!.posing));
    for (const hand of ['Hand_L', 'Hand_R']) expect(aim.pos[bone(s.rig, hand)][2], hand).toBeGreaterThan(aim.pos[bone(s.rig, 'UpperChest')][2] + 0.15);
  });
});
