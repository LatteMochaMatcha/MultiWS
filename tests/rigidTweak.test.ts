// 多选「像一整块那样转动、缩放」：选中的几个部件绕同一个点一起转、一起等比缩放，互相之间的位置不变（见 model/overrides.ts 的 rigidDelta）
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { partFrame } from '../src/geometry/tweak';
import { type Quat, type V3, add, len, mul, quatEuler, rotate, sub } from '../src/geometry/vec';
import { type TweakDelta, nudgeOverride, rigidDelta, setOverride } from '../src/model/overrides';
import { type BodySpec, defaultSpec, normalizeSpec } from '../src/model/spec';

const DEG = Math.PI / 180;

describe('rigidDelta', () => {
  const turn: Quat = quatEuler(0, 0, 90 * DEG);

  it('转：除了自己转，还绕支点挪过去', () => {
    const out = rigidDelta({ turn }, [0, 0, 0], [1, 0, 0]);
    expect(out.turn).toBe(turn);
    expect(len(sub(out.move!, [-1, 1, 0]))).toBeLessThan(1e-9);
    // 支点上的那个不挪
    expect(len(rigidDelta({ turn }, [2, 3, 4], [2, 3, 4]).move!)).toBeLessThan(1e-9);
  });

  it('等比缩放：离支点的距离跟着变；各方向不一样的缩放不挪', () => {
    expect(rigidDelta({ ratio: [2, 2, 2] }, [1, 0, 0], [3, 0, 0]).move).toEqual([2, 0, 0]);
    expect(rigidDelta({ ratio: [2, 1, 1] }, [1, 0, 0], [3, 0, 0]).move).toEqual([0, 0, 0]);
  });

  it('本来就带着的平移照旧加上', () => {
    expect(rigidDelta({ move: [0, 0.5, 0] }, [0, 0, 0], [1, 0, 0]).move).toEqual([0, 0.5, 0]);
  });
});

describe('几个部件像一整块那样转', () => {
  const spec: BodySpec = normalizeSpec({ ...defaultSpec(), counts: { ...defaultSpec().counts, armPairs: 2, tails: 1 } });
  const names = ['Arm_01_L', 'Arm_02_L', 'Tail_01'];
  const anchor = 'Arm_01_L';
  const figure = buildFigure(spec);
  const frames = new Map(names.map((n) => [n, partFrame(figure, n)!]));
  const pivot = frames.get(anchor)!.pivot;

  /** 照同一份改动改这几个部件（rigid：像一整块；不然各自绕自己的关节） */
  const apply = (delta: TweakDelta, rigid: boolean): BodySpec => {
    let next = spec;
    for (const name of names) {
      const frame = frames.get(name)!;
      const own = rigid && name !== anchor ? rigidDelta(delta, pivot, frame.pivot) : delta;
      next = setOverride(next, name, nudgeOverride(undefined, frame, own), false);
    }
    return next;
  };

  it('转 40°：每个部件的支点都绕操纵杆所在的那个部件转过去，互相之间的距离不变', () => {
    const turn = quatEuler(20 * DEG, 0, 40 * DEG);
    const after = buildFigure(apply({ turn }, true));
    for (const name of names) {
      const was = frames.get(name)!.pivot;
      const want: V3 = add(pivot, rotate(turn, sub(was, pivot)));
      expect(len(sub(partFrame(after, name)!.pivot, want))).toBeLessThan(2e-4);
    }
    // 不勾的时候：各自绕自己的关节，支点都不动
    const loose = buildFigure(apply({ turn }, false));
    for (const name of names) expect(len(sub(partFrame(loose, name)!.pivot, frames.get(name)!.pivot))).toBeLessThan(2e-4);
  });

  it('等比放大 1.5 倍：离操纵杆所在的那个部件的距离也是 1.5 倍', () => {
    const after = buildFigure(apply({ ratio: [1.5, 1.5, 1.5] }, true));
    for (const name of names) {
      const want: V3 = add(pivot, mul(sub(frames.get(name)!.pivot, pivot), 1.5));
      expect(len(sub(partFrame(after, name)!.pivot, want))).toBeLessThan(2e-4);
    }
  });
});
