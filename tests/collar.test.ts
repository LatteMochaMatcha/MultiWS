// 以前存下来的姿势里转过头的锁骨：打开时退回到肩关节刚好贴着身子（src/pose/collar.ts）
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type V3, add, dot, len, mul, quatConj, quatEuler, quatMul, rotate, sub } from '../src/geometry/vec';
import { type BodyCounts, type BodySpec, defaultSpec } from '../src/model/spec';
import type { BodyDist } from '../src/pose/clear';
import { rootReach, settleCollars } from '../src/pose/collar';
import { quatAngle } from '../src/pose/math';
import { forward, restState, tailOf } from '../src/pose/rig';
import { makeSolver, posingOf, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { compileField, fieldAt } from '../src/sdf/field';
import { useAnimeBody } from './animeBody';

const DEG = Math.PI / 180;
const make = (counts: Partial<BodyCounts> = {}, rest: Partial<BodySpec> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, ...rest, counts: { ...base.counts, ...counts } };
};

/** 一副身体、它的骨架，和静止姿势下身子（不含手臂）的距离场：和工坊里 bodyDist 一样 */
function setup(spec: BodySpec) {
  const figure = buildFigure(spec);
  const solver = makeSolver(buildSkeleton(figure).bones);
  const kept = new Set<string>();
  const parts = figure.parts.filter((p) => {
    const keep = ['torso', 'lower', 'leg', 'neck', 'head', 'chest'].includes(p.type) && (!p.parent || kept.has(p.parent));
    if (keep) kept.add(p.name);
    return keep;
  });
  const field = compileField({ scale: figure.scale, parts }, { blend: spec.blend });
  const body: BodyDist = (x, y, z) => fieldAt(field, x, y, z);
  const room = { dist: body, reach: rootReach(figure) };
  /** 只转这几根锁骨（相对父骨骼）的姿势 */
  const turned = (turns: Record<string, ReturnType<typeof quatEuler>>) => {
    const state = restState(solver.rig);
    for (const [name, q] of Object.entries(turns)) state.local[solver.rig.index.get(name)!] = q;
    return posingOf(solver, state);
  };
  return { figure, solver, body, room, turned };
}

describe('打开旧姿势时退回转过头的锁骨', () => {
  it('锁骨把肩关节带出了身子：照原来那根轴退回到刚好贴着身子，上臂朝向不变', () => {
    useAnimeBody();
    // 两个上半身时左边那个里侧的手臂：锁骨从肩关节往后伸，绕 X 转 120° 肩关节就到了后背外面
    const { figure, solver, body, room, turned } = setup(make({ torsos: 2 }, { bodyStyle: 'anime' }));
    const { rig } = solver;
    const name = 'Shoulder_R.002';
    const collar = rig.index.get(name)!;
    const arm = rig.names.findIndex((_, k) => rig.parent[k] === collar);
    const posing = turned({ [name]: quatEuler(-120 * DEG, 0, 0) });
    const settled = settleCollars(solver, posing, () => room, figure.scale);
    expect(settled).not.toBe(posing);
    const before = forward(rig, stateOf(solver, posing));
    const after = forward(rig, stateOf(solver, settled));
    const angle = quatAngle(stateOf(solver, settled).local[collar]);
    // 只退到刚好贴着：没退回静止的样子
    expect(angle).toBeGreaterThan(10 * DEG);
    expect(angle).toBeLessThan(110 * DEG);
    // 上臂在世界里的朝向一点没变：手臂整条平移回肩膀上
    expect(quatAngle(quatMul(quatConj(before.rot[arm]), after.rot[arm]))).toBeLessThan(1e-6);
    // 肩关节（照带着锁骨的那节骨骼换算回静止姿势里）往那节骨骼上走：退之前要走好几厘米才进到身子，退之后和静止时差不多
    const host = rig.parent[collar];
    const axis = sub(rig.tail[host], rig.head[host]);
    const spine = add(rig.head[host], mul(axis, Math.min(Math.max(dot(sub(rig.tail[collar], rig.head[host]), axis) / dot(axis, axis), 0), 1)));
    const gap = (at: V3) => {
      for (let i = 0; i <= 200; i++) {
        const p = add(at, mul(sub(spine, at), i / 200));
        if (body(p[0], p[1], p[2]) <= 0) return len(sub(p, at));
      }
      return Infinity;
    };
    const restored = (f: typeof after) => add(rig.head[host], rotate(quatConj(f.rot[host]), sub(tailOf(rig, f, collar), f.pos[host])));
    const rest = gap(rig.tail[collar]);
    expect(gap(restored(before))).toBeGreaterThan(rest + 0.03);
    expect(gap(restored(after))).toBeLessThan(rest + 0.012);
  }, 120_000);

  it('锁骨没转过头、或者转过头了还贴着身子：原样不动，转过头的都没有时连身子都不用量', () => {
    useAnimeBody();
    const { figure, solver, room, turned } = setup(make({ torsos: 2 }, { bodyStyle: 'anime' }));
    let asked = 0;
    const lazy = () => {
      asked++;
      return room;
    };
    const mild = turned({ 'Shoulder_R.002': quatEuler(0, 0, 20 * DEG) });
    expect(settleCollars(solver, mild, lazy, figure.scale)).toBe(mild);
    expect(asked).toBe(0);
    // 标准人台的锁骨从脊柱旁边伸出去、肩头是个大圆球：锁骨往上转 60°，肩球还挨着身子
    const white = setup(defaultSpec());
    const up = white.turned({ Shoulder_L: quatEuler(0, 0, 60 * DEG) });
    expect(settleCollars(white.solver, up, () => white.room, white.figure.scale)).toBe(up);
  }, 120_000);
});
