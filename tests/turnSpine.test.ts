// 用旋转环扭躯干：绕脊柱拧的那一部分分给整串脊柱（pose/solve.ts 的 turnSpine），骨盆不跟着脊柱拧（rig/skin.ts 的 PELVIS）
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, quatConj, quatMul } from '../src/geometry/vec';
import { type BodySpec, defaultSpec } from '../src/model/spec';
import { buildHandles } from '../src/pose/handles';
import { quatAngle } from '../src/pose/math';
import { forward, restState } from '../src/pose/rig';
import { turnBone, turnSpine } from '../src/pose/solve';
import { makeSolver } from '../src/pose/solver';
import { planSkin } from '../src/rig/skin';
import { buildSkeleton } from '../src/rig/skeleton';
import { fuseSkinned } from '../src/sdf/bindPose';
import { VOXEL } from '../src/sdf/fuse';
import { useAnimeBody } from './animeBody';

const DEG = Math.PI / 180;
const spec = (patch: Partial<BodySpec> = {}): BodySpec => ({ ...defaultSpec(), bodyStyle: 'anime', ...patch });
/** 绕单位向量 axis 转 angle 弧度 */
const about = (axis: number[], angle: number): Quat => {
  const l = Math.hypot(axis[0], axis[1], axis[2]);
  const s = Math.sin(angle / 2) / l;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
/** 两个旋转差多少弧度 */
const apart = (a: Quat, b: Quat) => quatAngle(quatMul(a, quatConj(b)));

function kit(patch: Partial<BodySpec> = {}) {
  useAnimeBody();
  const solver = makeSolver(buildSkeleton(buildFigure(spec(patch))).bones);
  const handles = buildHandles(solver).filter((h) => h.group === 'torso');
  return { solver, handles };
}

describe('用旋转环扭躯干', () => {
  it('腰、胸的旋转环带着这个上半身的整串脊柱（从胯往上）；别的点没有', () => {
    const { solver, handles } = kit();
    const names = (list: number[]) => list.map((b) => solver.rig.names[b]);
    for (const label of ['腰', '胸']) expect(names(handles.find((h) => h.label.startsWith(label))!.twist), label).toEqual(['Spine', 'Chest', 'UpperChest']);
    expect(buildHandles(solver).find((h) => h.label.startsWith('头'))!.twist).toEqual([]);
    // 两个上半身：各带各的
    const two = kit({ counts: { ...defaultSpec().counts, torsos: 2 } });
    const left = two.handles.filter((h) => h.twist.length && /Spine_L|Chest_L/.test(two.solver.rig.names[h.turn]));
    expect(left.length).toBeGreaterThan(0);
    for (const h of left) expect(h.twist.map((b) => two.solver.rig.names[b])).toEqual(['Spine_L', 'Chest_L', 'UpperChest_L']);
  });

  it('把胸扭 150°：最上面那节最后转的和以前一样，但扭转分给三节，每个关节都不超过一半（以前全挤在胸下面那一个关节上）', () => {
    const { solver, handles } = kit();
    const { rig } = solver;
    const start = restState(rig);
    const f0 = forward(rig, start);
    for (const label of ['胸', '腰']) {
      const handle = handles.find((h) => h.label.startsWith(label))!;
      // 旋转环沿着这串脊柱摆（main.ts）
      const top0 = handle.twist[handle.twist.length - 1];
      const axis = [0, 1, 2].map((k) => rig.tail[top0][k] - rig.head[handle.twist[0]][k]);
      const delta = about(axis, 150 * DEG);
      const before = turnBone(solver, start, handle.turn, quatMul(delta, f0.rot[handle.turn]), []);
      const after = turnSpine(solver, start, handle.turn, handle.twist, delta, []);
      const top = handle.twist[handle.twist.length - 1];
      expect(apart(forward(rig, after).rot[top], forward(rig, before).rot[top]), label).toBeLessThan(1e-6);
      expect(Math.max(...handle.twist.map((b) => quatAngle(before.local[b]))) / DEG, label).toBeGreaterThan(149);
      for (const b of handle.twist) expect(quatAngle(after.local[b]) / DEG, `${label} ${rig.names[b]}`).toBeLessThan(70);
      // 最下面那节（腰椎）分得最少
      expect(quatAngle(after.local[handle.twist[0]]) / DEG, label).toBeLessThan(20);
    }
  });

  it('只是往前弯、往旁边倒（不绕脊柱拧）的：和以前差不多，只转点中的那一节（脊柱略往后斜，往旁边倒里带一点点拧）', () => {
    const { solver, handles } = kit();
    const { rig } = solver;
    const start = restState(rig);
    const f0 = forward(rig, start);
    const handle = handles.find((h) => h.label.startsWith('胸'))!;
    for (const [delta, most] of [
      [about([1, 0, 0], 35 * DEG), 0.1],
      [about([0, 0, 1], -25 * DEG), 2],
    ] as const) {
      const before = turnBone(solver, start, handle.turn, quatMul(delta, f0.rot[handle.turn]), []);
      const after = turnSpine(solver, start, handle.turn, handle.twist, delta, []);
      rig.names.forEach((name, b) => expect(apart(after.local[b], before.local[b]) / DEG, name).toBeLessThan(most));
    }
  });
});

describe('骨盆不跟着脊柱拧', () => {
  it('二次元素体：髋关节往下的顶点不分腰、胸的权重（以前屁股、大腿根分到一两成，扭身子时大腿根错开一截）', () => {
    useAnimeBody();
    const s = spec();
    const figure = buildFigure(s);
    const skeleton = buildSkeleton(figure);
    const { mesh, skin } = fuseSkinned(figure.parts, { voxel: VOXEL.preview, blend: s.blend });
    const spine = new Set(skeleton.bones.map((b, i) => (/^(Spine|Chest|UpperChest)$/.test(b.name) ? i : -1)).filter((i) => i >= 0));
    const hip = skeleton.bones.find((b) => b.name === 'UpperLeg_L')!.head[1];
    let below = 0;
    let above = 0;
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const y = mesh.positions[v * 3 + 1];
      let share = 0;
      for (let k = 0; k < 4; k++) if (spine.has(skin.joints[v * 4 + k])) share += skin.weights[v * 4 + k];
      // 紧挨着髋关节下面那一点（1 cm 以内）是表面上权重连续过渡带下来的零头
      if (y < hip - 0.01) below = Math.max(below, share);
      else if (y > hip + 0.1 && y < hip + 0.2) above = Math.max(above, share);
    }
    // 以前那一带腰、胸占一两成
    expect(below).toBeLessThan(0.02);
    // 腰上面照旧跟着脊柱
    expect(above).toBeGreaterThan(0.5);
  }, 60_000);

  it('只管站着、腿接在胯上的身体：连体（躺着、反着连在一起）的不管', () => {
    useAnimeBody();
    const pelvis = (patch: Partial<BodySpec>) => {
      const figure = buildFigure(spec(patch));
      return planSkin(figure, buildSkeleton(figure), new Float32Array(0)).pelvis;
    };
    expect(pelvis({})).not.toBeNull();
    expect(pelvis({ bodyStyle: 'mannequin' })).not.toBeNull();
    for (const conjoined of ['same', 'opposite'] as const) expect(pelvis({ conjoined, conjoinPose: 'lie' }), conjoined).toBeNull();
  });
});
