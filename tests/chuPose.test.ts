// 楚云萱（用体块拼的，docs/chu-blocks-plan.md 第 4 期）套现成姿势：照围成一圈的办法（pose/ring.ts），背不弯、每个头照自己的朝向、
// 挤在一起的腿都摆成一样、手臂照整个身子的左右；手臂夹在胸中间也摆得动（pose/clear.ts）；三十只胸是同一种形状（geometry/clone.ts 的 plainPieces）
import { describe, expect, it } from 'vitest';
import { plainPieces } from '../src/geometry/clone';
import type { ChestShape, Figure, Part } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, type V3, quatConj, rotate, sub } from '../src/geometry/vec';
import { addBlock, setSplitTorso } from '../src/model/blocks';
import { chuSpec } from '../src/model/chu';
import { type BodySpec, defaultSpec, normalizeSpec } from '../src/model/spec';
import { clearArms } from '../src/pose/clear';
import { fitArms, followArms } from '../src/pose/fit';
import { POSE_LIBRARY } from '../src/pose/library';
import { quatAngle } from '../src/pose/math';
import { fitRing, isRingRig } from '../src/pose/ring';
import { forward, poseMatrices } from '../src/pose/rig';
import { makeSolver, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { compileField, fieldAt } from '../src/sdf/field';
import { forkWarp } from '../src/sdf/fork';
import { posedBodyDist, wristBodyDist } from '../src/sdf/posedBody';
import { useAnimeBody } from './animeBody';

useAnimeBody();

const base = (): BodySpec => normalizeSpec({ ...defaultSpec(), bodyStyle: 'anime' });
const spec = chuSpec(base());
const figure = buildFigure(spec);
const solver = makeSolver(buildSkeleton(figure).bones);
const { rig } = solver;
const preset = (name: string) => POSE_LIBRARY.find((p) => p.name === name)!.posing;
const BODY = new Set(['torso', 'lower', 'leg', 'neck', 'head', 'chest']);
const STIFF = /^(Hips|Spine|Chest|UpperChest)(\.\d+)?$/;
const ID: Quat = [0, 0, 0, 1];

/** 静止时身体（不含手臂）的距离，和工坊里量手臂插没插进身体用的一样 */
function bodyDist(f: Figure, blend: number) {
  const kept = new Set<string>();
  const parts = f.parts.filter((p) => {
    const keep = BODY.has(p.type) && (!p.parent || kept.has(p.parent));
    if (keep) kept.add(p.name);
    return keep;
  });
  const field = compileField({ scale: f.scale, parts }, { blend });
  return (x: number, y: number, z: number) => fieldAt(field, x, y, z);
}

describe('楚云萱套现成姿势', () => {
  it('有上半身背对背的体块身体照围成一圈的办法套；并排朝前的几个胸腔不算', () => {
    expect(isRingRig(rig)).toBe(true);
    const side = addBlock(setSplitTorso(base(), true), [{ from: 'UpperBody' }]).spec;
    expect(isRingRig(makeSolver(buildSkeleton(buildFigure(side)).bones).rig)).toBe(false);
    expect(isRingRig(makeSolver(buildSkeleton(buildFigure(base())).bones).rig)).toBe(false);
  });

  it('背不弯、胯不转，整个人只上下挪', () => {
    for (const name of ['弯腰拿东西', '蹲着', '仰面躺着', '走']) {
      const fitted = fitRing(solver, preset(name));
      expect(Object.keys(fitted.bones).filter((bone) => STIFF.test(bone)), name).toEqual([]);
      const state = stateOf(solver, fitted);
      rig.names.forEach((bone, j) => {
        if (STIFF.test(bone)) expect(quatAngle(state.local[j]), `${name} ${bone}`).toBeLessThan(1e-9);
      });
      expect(state.root[0], name).toBe(0);
      expect(state.root[2], name).toBe(0);
    }
    expect(stateOf(solver, fitRing(solver, preset('蹲着'))).root[1]).toBeLessThan(-0.1);
  });

  it('每个头照自己的朝向动：前排低头是往前低，后排低头是往后低', () => {
    const rest = forward(rig, stateOf(solver, { version: 3, bones: {} }));
    const posed = forward(rig, stateOf(solver, fitRing(solver, preset('弯腰拿东西'))));
    const heads = rig.names.flatMap((bone, j) => (/^Head/.test(bone) ? [j] : []));
    expect(heads).toHaveLength(6);
    for (const j of heads) {
      // 头顶（骨骼的终点）往哪边挪了：和这个头在身子前半边还是后半边同号
      const top = (f: { pos: V3[]; rot: Quat[] }): V3 => {
        const turned = rotate(f.rot[j], sub(rig.tail[j], rig.head[j]));
        return [f.pos[j][0] + turned[0], f.pos[j][1] + turned[1], f.pos[j][2] + turned[2]];
      };
      const moved = sub(top(posed), top(rest));
      expect(moved[2] * (rig.head[j][2] > 0 ? 1 : -1), rig.names[j]).toBeGreaterThan(0.01);
    }
  });

  it('十八条腿挤在一起，都摆成一样（左右两条的平均）：走的时候不一前一后，蹲的时候一起弯', () => {
    for (const name of ['走', '蹲着', '冲刺']) {
      const fitted = fitRing(solver, preset(name));
      for (const part of ['UpperLeg', 'LowerLeg', 'Foot']) {
        const turns = Object.entries(fitted.bones).filter(([bone]) => bone.startsWith(`${part}_`));
        expect(turns, `${name} ${part}`).toHaveLength(18);
        for (const [bone, q] of turns) q.forEach((v, k) => expect(v, `${name} ${bone}`).toBeCloseTo(turns[0][1][k], 9));
      }
    }
    const squat = forward(rig, stateOf(solver, fitRing(solver, preset('蹲着'))));
    const knee = rig.index.get('LowerLeg_L')!;
    const thigh = rig.index.get('UpperLeg_L')!;
    // 蹲着：大腿抬起来了（膝盖比髋关节低得没有静止时那么多）
    expect(squat.pos[thigh][1] - squat.pos[knee][1]).toBeLessThan(0.6 * (rig.head[thigh][1] - rig.head[knee][1]));
  });

  it('手臂照整个身子的左右套：张开双臂时斜对着的两组（都是左手、都是右手）一样高，手都还在各自那一边', () => {
    const posed = forward(rig, stateOf(solver, fitRing(solver, preset('张开双臂'))));
    const hands = solver.limbs.filter((limb) => limb.kind === 'arm').map((limb) => ({ rest: rig.head[limb.end], now: posed.pos[limb.end] }));
    expect(hands).toHaveLength(12);
    const heights = (keep: (p: V3) => boolean) =>
      hands
        .filter((h) => keep(h.rest))
        .map((h) => h.now[1])
        .sort((a, b) => a - b);
    const groups = [heights((p) => p[0] > 0 && p[2] > 0), heights((p) => p[0] < 0 && p[2] > 0), heights((p) => p[0] > 0 && p[2] < 0), heights((p) => p[0] < 0 && p[2] < 0)];
    for (const group of groups) expect(group).toHaveLength(3);
    // 右前、左后是左手形状的（一组照原样、一组当成脸朝后的人的左手）；左前、右后是右手形状的
    groups[0].forEach((y, k) => expect(Math.abs(y - groups[3][k])).toBeLessThan(0.03));
    groups[1].forEach((y, k) => expect(Math.abs(y - groups[2][k])).toBeLessThan(0.03));
    for (const h of hands) expect(h.now[0] * h.rest[0]).toBeGreaterThan(0);
  });

  it('手臂夹在绕到身侧的胸中间也摆得动：不比静止时插得更深就算让开，大半的手臂跟着姿势动了', () => {
    const body = bodyDist(figure, spec.blend);
    for (const name of ['挥手', '张开双臂', '走']) {
      const { posing, followers } = followArms(solver, fitArms(solver, fitRing(solver, preset(name))));
      expect(followers).toHaveLength(12);
      const posedDist = posedBodyDist(figure, spec.blend, poseMatrices(rig, forward(rig, stateOf(solver, posing)), figure.scale));
      const after = forward(rig, stateOf(solver, clearArms(solver, posing, body, figure.scale, spec.shape.limbs, followers, posedDist)));
      const moved = solver.limbs.filter((limb) => limb.kind === 'arm' && quatAngle(after.rot[limb.upper]) > 0.05).length;
      expect(moved, name).toBeGreaterThanOrEqual(6);
    }
  });

  it('放宽的只是上臂和前臂：摆过去的手臂，手腕不插在身体里（插着的话那里没有一圈干净的断口，手缝不上、掉成单独一块）', () => {
    const body = bodyDist(figure, spec.blend);
    // 手腕的中心线离身体表面至少多远（按标准人台的米）。整条手臂都照埋得最深的那一点放宽的时候，弯腰拿东西有两只手腕在身体里面 1.4 厘米
    for (const [name, room] of [['弯腰拿东西', 0.015], ['蹲着', 0.005]] as const) {
      const { posing, followers } = followArms(solver, fitArms(solver, fitRing(solver, preset(name))));
      // 和工坊里一样：手腕周围连融合时腿还跟着胯的样子也量（sdf/posedBody.ts 的 wristBodyDist）
      const posedDist = wristBodyDist(figure, spec.blend, poseMatrices(rig, forward(rig, stateOf(solver, posing)), figure.scale))!;
      const cleared = clearArms(solver, posing, body, figure.scale, spec.shape.limbs, followers, posedDist);
      const after = forward(rig, stateOf(solver, cleared));
      // 让开以后身体没动（背不弯、胯不转），量手腕离身体多远还用同一个场
      const arms = solver.limbs.filter((limb) => limb.kind === 'arm');
      const moved = arms.filter((limb) => quatAngle(stateOf(solver, cleared).local[limb.upper]) > 0.05);
      expect(moved.length, name).toBeGreaterThanOrEqual(6);
      for (const limb of moved) {
        const w = after.pos[limb.end];
        expect(posedDist(w[0], w[1], w[2]) / figure.scale, `${name} ${rig.names[limb.end]}`).toBeGreaterThan(room);
      }
    }
  });
});

describe('整只搬过去的胸（piece）', () => {
  const chests = figure.parts.filter((p) => p.type === 'chest');
  const shapeOf = (p: Part) => p.prims.find((q): q is ChestShape => q.kind === 'chest')!;

  it('三十只是同一种形状（只烤一份），都不带从胯上分出去的那一段', () => {
    expect(chests).toHaveLength(30);
    expect(new Set(chests.map((p) => JSON.stringify(shapeOf(p)))).size).toBe(1);
    for (const p of chests) expect(shapeOf(p).body.fork, p.name).toBeUndefined();
  });

  it('plainPieces：分出去的那一段照一个高度整块退回去的转动、挪动挪到了部件的摆放上，量的地方一点不差', () => {
    // 拿一个从胯上渐渐分出去的胸腔（前排的）上的胸，把那一段装回去（torsos.ts 的 refork 装的样子）
    const rib = figure.parts.find((p) => p.type === 'torso' && p.prims.some((q) => q.kind === 'grid' && !!q.fork && !q.fork.frame))!;
    const fork = rib.prims.flatMap((q) => (q.kind === 'grid' && q.fork ? [q.fork] : []))[0];
    const piece = chests[0];
    const shape = shapeOf(piece);
    const o = shape.origin;
    const s = piece.scale ?? 1;
    const out = new Float64Array(4);
    for (const freeze of [0.75, 0.9, 1.05, 1.3]) {
      const before: Part = { ...piece, prims: [{ ...shape, body: { ...shape.body, fork: { ...fork, freeze } } }] };
      const after = plainPieces({ ...figure, parts: [rib, before] }).parts[1];
      expect(shapeOf(after).body.fork).toBeUndefined();
      const warp = forkWarp({ ...fork, freeze });
      for (const p of [[0, 0, 0], [0.1, 0.05, 0.12], [-0.08, -0.1, 0.03]] as V3[]) {
        // 原来：部件里的 p 量的是躯干里退回去以后的那一点
        warp.map(p[0] + o[0], p[1] + o[1], p[2] + o[2], out);
        // 现在：同一个地方（胸腔的坐标里）换到新的部件坐标里，量的是它加上 o
        const turned = rotate(before.quat ?? ID, [p[0] * s, p[1] * s, p[2] * s]);
        const where: V3 = [before.pos[0] + turned[0], before.pos[1] + turned[1], before.pos[2] + turned[2]];
        const local = rotate(quatConj(after.quat ?? ID), sub(where, after.pos)).map((v) => v / s);
        for (let k = 0; k < 3; k++) expect(local[k] + o[k]).toBeCloseTo(out[k], 6);
      }
    }
    // 没有那一段的照旧不动
    expect(plainPieces(figure)).toBe(figure);
  });
});
