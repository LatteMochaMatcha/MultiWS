// 手指和手势：找手、手势和骨骼旋转之间的换算、指尖的圆点、姿势数据里的手、蒙皮。
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, type V3, add, dot, len, norm, quatConj, quatEuler, quatMul, rotate, sub } from '../src/geometry/vec';
import { type BodyCounts, type BodySpec, defaultSpec } from '../src/model/spec';
import {
  type Hand,
  type HandShape,
  FINGER_NAMES,
  GESTURES,
  RELAXED,
  dialsOf,
  fingerOf,
  posingHand,
  readHand,
  shapeHand,
  shapeOf,
  withCurl,
  withPosingHand,
  withSpread,
} from '../src/pose/fingers';
import { buildHandles } from '../src/pose/handles';
import { POSE_LIBRARY } from '../src/pose/library';
import { quatAngle } from '../src/pose/math';
import { type Posing, flipPosing, mirrorQuat } from '../src/pose/posing';
import { type SourceBone, posingFromBones } from '../src/pose/retarget';
import { type PoseRig, type PoseState, forward, restState, tailOf } from '../src/pose/rig';
import { dragAim, turnBone } from '../src/pose/solve';
import { type Solver, makeSolver, mirrorState, posingOf, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { skinVertices } from '../src/rig/skin';
import { VOXEL, fuseParts } from '../src/sdf/fuse';

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
const handOf = (s: Solver, name: string): Hand => {
  const hand = s.hands.find((h) => h.name === name);
  if (!hand) throw new Error(`没有手 ${name}`);
  return hand;
};
const gesture = (name: string): HandShape => {
  const found = GESTURES.find((g) => g.name === name);
  if (!found) throw new Error(`没有手势 ${name}`);
  return found.shape;
};
const DEG = Math.PI / 180;
const dist = (a: V3, b: V3) => len(sub(a, b));
/** 两个手势差多少度（拇指五个数、四指各四个数里差得最多的那一个） */
const apart = (a: HandShape, b: HandShape) => {
  const flat = (s: HandShape) => [s.thumb.out, s.thumb.down, s.thumb.roll, ...s.thumb.curl, ...s.fingers.flatMap((f) => [...f.curl, f.spread])];
  const x = flat(a);
  const y = flat(b);
  return Math.max(...x.map((v, i) => Math.abs(v - y[i])));
};
/** 一只手的五个指尖，写在手掌自己的坐标里（手腕在原点，手怎么转都不变），米 */
const tips = (s: Solver, state: PoseState, hand: Hand): V3[] => {
  const f = forward(s.rig, state);
  const back = quatConj(quatMul(f.rot[hand.bone], hand.frame));
  return hand.fingers.map((chain) => rotate(back, sub(tailOf(s.rig, f, chain[chain.length - 1]), f.pos[hand.bone])));
};

describe('找手', () => {
  // 并指的手照约定的样子摆（T-pose 时手掌就是它静止的样子）；分指的手是现成的网格，手掌本来带一点角度
  const a = solverOf({ ...defaultSpec(), hands: 'mitten' });
  const t = solverOf({ ...defaultSpec(), hands: 'mitten', pose: 'T' });

  it('骨骼名里认得出是哪根手指的第几节', () => {
    expect(fingerOf('Index1_L')).toEqual({ finger: 'Index', joint: 1 });
    expect(fingerOf('Thumb3_R.002')).toEqual({ finger: 'Thumb', joint: 3 });
    for (const name of ['Hand_L', 'IndexSec_L', 'Index_L', 'Tail_01_02', 'UpperArm_L']) expect(fingerOf(name), name).toBeNull();
  });

  it('标准人形：两只手，每只五根手指各三节，从根到梢', () => {
    expect(a.hands.map((h) => h.name)).toEqual(['Hand_L', 'Hand_R']);
    const left = handOf(a, 'Hand_L');
    expect(left).toMatchObject({ side: 1, pair: 0 });
    expect(left.fingers.map((chain) => chain.map((b) => a.rig.names[b]))).toEqual(
      FINGER_NAMES.map((f) => [1, 2, 3].map((k) => `${f}${k}_L`)),
    );
    expect(handOf(a, 'Hand_R').side).toBe(-1);
    for (const chain of left.fingers) chain.forEach((b, k) => expect(a.rig.parent[b]).toBe(k ? chain[k - 1] : left.bone));
  });

  it('多对手臂各有各的手；没有手臂就没有手', () => {
    const more = solverOf(make({ armPairs: 3 }));
    expect(more.hands.map((h) => `${h.name}/${h.pair}`).sort()).toEqual(
      ['Hand_L/0', 'Hand_R/0', 'Hand_L.002/1', 'Hand_R.002/1', 'Hand_L.003/2', 'Hand_R.003/2'].sort(),
    );
    expect(more.rig.names).toContain('Little3_R.003');
    expect(solverOf(make({ armPairs: 0 })).hands).toEqual([]);
  });

  it('左右手的起点互为镜像；T-pose 的身体上手掌就是从它自己的静止姿势算起', () => {
    for (const s of [a, t]) {
      const left = handOf(s, 'Hand_L');
      const right = handOf(s, 'Hand_R');
      expect(quatAngle(quatMul(quatConj(mirrorQuat(left.frame)), right.frame))).toBeLessThan(1e-6);
      left.fingers.forEach((chain, f) =>
        chain.forEach((b, k) => {
          const twin = right.fingers[f][k];
          expect(quatAngle(quatMul(quatConj(mirrorQuat(s.frames[b])), s.frames[twin])), s.rig.names[b]).toBeLessThan(1e-6);
        }),
      );
    }
    expect(quatAngle(handOf(t, 'Hand_L').frame)).toBeLessThan(1e-6);
    expect(quatAngle(handOf(a, 'Hand_L').frame)).toBeGreaterThan(20 * DEG);
  });
});

describe('手势', () => {
  const a = solverOf(make({}, { hands: 'fingers' }));
  const t = solverOf(make({}, { hands: 'fingers', pose: 'T' }));
  const mitten = solverOf({ ...defaultSpec(), hands: 'mitten' });

  it('有十几个，名字不重样', () => {
    expect(GESTURES.length).toBeGreaterThan(12);
    expect(new Set(GESTURES.map((g) => g.name)).size).toBe(GESTURES.length);
  });

  it('摆上去再量回来是同一个手势，左右手都是', () => {
    for (const s of [a, t]) {
      for (const hand of s.hands) {
        for (const g of GESTURES) {
          const state = shapeHand(s, restState(s.rig), hand, g.shape);
          expect(apart(readHand(s, state, hand), g.shape), `${hand.name} ${g.name}`).toBeLessThan(0.01);
        }
      }
    }
  });

  it('只动这只手的手指：手掌、手臂、另一只手都不动', () => {
    const state = shapeHand(a, restState(a.rig), handOf(a, 'Hand_L'), gesture('握拳'));
    a.rig.names.forEach((name, i) => {
      const moved = quatAngle(state.local[i]) > 1e-9;
      expect(moved, name).toBe(fingerOf(name) !== null && name.endsWith('_L'));
    });
  });

  it('两只手摆同一个手势：互为镜像', () => {
    let state = restState(a.rig);
    for (const hand of a.hands) state = shapeHand(a, state, hand, gesture('OK'));
    const f = forward(a.rig, state);
    for (const name of a.rig.names.filter((n) => n.endsWith('_L'))) {
      const l = f.pos[bone(a.rig, name)];
      const r = f.pos[bone(a.rig, name.replace(/_L$/, '_R'))];
      expect(dist(r, [-l[0], l[1], l[2]]), name).toBeLessThan(1e-6);
    }
    // 「左边 → 右边」照过去的也是这个手势
    const one = shapeHand(a, restState(a.rig), handOf(a, 'Hand_L'), gesture('剪刀手'));
    const both = mirrorState(a, one, 'L');
    expect(apart(readHand(a, both, handOf(a, 'Hand_R')), gesture('剪刀手'))).toBeLessThan(0.01);
    // 整个翻过来：手势跟着换到另一只手上
    const flipped = stateOf(a, flipPosing(posingOf(a, one)));
    expect(apart(readHand(a, flipped, handOf(a, 'Hand_R')), gesture('剪刀手'))).toBeLessThan(0.05);
  });

  it('握拳：指尖收到手心下面；张开：五指伸着，食指和小指分得最开', () => {
    const hand = handOf(t, 'Hand_L');
    const fist = tips(t, shapeHand(t, restState(t.rig), hand, gesture('握拳')), hand);
    const open = tips(t, shapeHand(t, restState(t.rig), hand, gesture('张开')), hand);
    for (let f = 1; f < 5; f++) {
      // 手掌自己的坐标里：X 是手指伸出去的方向，Y 是手背那一面
      expect(fist[f][0], FINGER_NAMES[f]).toBeLessThan(open[f][0] - 0.04);
      expect(fist[f][1], FINGER_NAMES[f]).toBeLessThan(0);
      expect(Math.abs(open[f][1]), FINGER_NAMES[f]).toBeLessThan(0.01);
    }
    expect(dist(open[1], open[4])).toBeGreaterThan(dist(fist[1], fist[4]) + 0.02);
    // 握拳时拇指横在四指前面：指尖越过了食指那一侧，往中指那边去
    expect(fist[0][2]).toBeLessThan(open[0][2] - 0.04);
  });

  it('OK、捏：拇指尖和食指尖凑在一起（二次元素体的手上是碰着的；白模的拇指短，差一点）', () => {
    const hand = handOf(t, 'Hand_L');
    for (const name of ['OK', '捏']) {
      const at = tips(t, shapeHand(t, restState(t.rig), hand, gesture(name)), hand);
      const rest = tips(t, restState(t.rig), hand);
      expect(dist(at[0], at[1]), name).toBeLessThan(dist(rest[0], rest[1]) * 0.6);
    }
  });

  it('换了静止姿势、换了手的样式，同一份姿势数据摆出来是同一个手势', () => {
    for (const g of GESTURES) {
      let state = restState(a.rig);
      for (const hand of a.hands) state = shapeHand(a, state, hand, g.shape);
      const posing = posingOf(a, state);
      for (const other of [t, mitten]) {
        const back = stateOf(other, posing);
        for (const hand of other.hands) expect(apart(readHand(other, back, hand), g.shape), `${g.name} ${hand.name}`).toBeLessThan(0.05);
      }
    }
  });

  it('手臂摆到别处、手掌转过去，手势跟着手走，量出来不变', () => {
    const hand = handOf(a, 'Hand_L');
    let state = shapeHand(a, restState(a.rig), hand, gesture('竖大拇指'));
    state = turnBone(a, state, bone(a.rig, 'UpperArm_L'), quatEuler(0.4, -0.8, 0.3), []);
    state = turnBone(a, state, hand.bone, quatMul(quatEuler(-0.5, 0.2, 0.9), forward(a.rig, state).rot[hand.bone]), []);
    expect(apart(readHand(a, state, hand), gesture('竖大拇指'))).toBeLessThan(0.01);
    // 存了再读回来也一样
    const back = stateOf(a, posingOf(a, state));
    expect(apart(readHand(a, back, hand), gesture('竖大拇指'))).toBeLessThan(0.05);
  });

  it('没摆过手指的姿势里不记手指；摆过的只记那只手的', () => {
    const hand = handOf(a, 'Hand_R');
    const posing = posingOf(a, shapeHand(a, restState(a.rig), hand, gesture('指')));
    const fingers = Object.keys(posing.bones).filter((name) => fingerOf(name));
    expect(fingers.length).toBeGreaterThan(10);
    for (const name of fingers) expect(name.endsWith('_R'), name).toBe(true);
  });
});

describe('手势的滑块', () => {
  it('滑块 → 手势 → 滑块，数不变', () => {
    for (const dials of [
      { curl: [0, 0, 0, 0, 0], spread: 0 },
      { curl: [1, 1, 1, 1, 1], spread: 0 },
      { curl: [0.3, 0.1, 0.5, 0.7, 0.9], spread: 0.6 },
      { curl: [0, 0.2, 0, 0.2, 0], spread: 1 },
    ] as const) {
      const back = dialsOf(shapeOf({ curl: [...dials.curl], spread: dials.spread }));
      back.curl.forEach((c, i) => expect(c, `第 ${i} 根`).toBeCloseTo(dials.curl[i], 6));
      // 全握起来的手看不出张没张
      if (dials.curl[1] < 0.5) expect(back.spread).toBeCloseTo(dials.spread, 6);
    }
  });

  it('握到底就是握拳的那个弯法；伸直就是伸直', () => {
    const fist = shapeOf({ curl: [1, 1, 1, 1, 1], spread: 0 });
    expect(apart(fist, gesture('握拳'))).toBeLessThan(1e-9);
    const flat = shapeOf({ curl: [0, 0, 0, 0, 0], spread: 0 });
    for (const f of flat.fingers) expect(f).toEqual({ curl: [0, 0, 0], spread: 0 });
  });

  it('只改一根手指：别的手指不动；只改张开：各自弯多少不动', () => {
    const from = gesture('爪');
    const bent = withCurl(from, 2, 0.1);
    expect(bent.fingers[0]).toEqual(from.fingers[0]);
    expect(bent.fingers[2]).toEqual(from.fingers[2]);
    expect(bent.thumb).toEqual(from.thumb);
    expect(dialsOf(bent).curl[2]).toBeCloseTo(0.1, 6);
    expect(bent.fingers[1].spread).toBe(from.fingers[1].spread);
    const thumbed = withCurl(from, 0, 1);
    expect(thumbed.fingers).toEqual(from.fingers);
    expect(dialsOf(thumbed).curl[0]).toBeCloseTo(1, 6);
    const closed = withSpread(from, 0);
    closed.fingers.forEach((f, i) => {
      expect(f.curl).toEqual(from.fingers[i].curl);
      expect(f.spread).toBeCloseTo(0, 9);
    });
    expect(closed.thumb.curl).toEqual(from.thumb.curl);
    expect(withSpread(from, 1).fingers[0].spread).toBeGreaterThan(withSpread(from, 1).fingers[3].spread + 20);
  });

  it('现成的手势在滑块上都落在 0–1 之间', () => {
    for (const g of GESTURES) {
      const d = dialsOf(g.shape);
      for (const v of [...d.curl, d.spread]) {
        expect(v, g.name).toBeGreaterThanOrEqual(0);
        expect(v, g.name).toBeLessThanOrEqual(1);
      }
    }
    expect(dialsOf(gesture('握拳')).curl).toEqual([1, 1, 1, 1, 1]);
    expect(dialsOf(gesture('张开'))).toEqual({ curl: [0, 0, 0, 0, 0], spread: 1 });
    expect(dialsOf(gesture('指')).curl.slice(1)).toEqual([0, 1, 1, 1]);
  });
});

describe('指尖的圆点', () => {
  const s = solverOf(make({ armPairs: 2 }, { hands: 'fingers', pose: 'T' }));
  const handles = buildHandles(s);
  const fingers = handles.filter((h) => h.group === 'finger');

  it('每根手指一个，长在指尖上，名字里带着哪只手', () => {
    expect(fingers).toHaveLength(20);
    const labels = fingers.map((h) => h.label);
    for (const label of ['拇指 左', '食指 右', '小指 左 2', '中指 右 2']) expect(labels).toContain(label);
    const index = handles.find((h) => h.id === 'Index3_L:tip')!;
    expect(index.rest).toEqual(s.rig.tail[bone(s.rig, 'Index3_L')]);
    expect(s.rig.names[index.turn]).toBe('Index1_L');
    // 三节都出力；后两节只绕一根轴弯
    expect(index.links.map((l) => s.rig.names[l.bone]).sort()).toEqual(['Index1_L', 'Index2_L', 'Index3_L']);
    for (const link of index.links) expect(Boolean(link.hinge), s.rig.names[link.bone]).toBe(s.rig.names[link.bone] !== 'Index1_L');
  });

  it('把指尖往手心拖：指尖到了，整根手指匀着往手心弯', () => {
    const hand = handOf(s, 'Hand_L');
    const index = handles.find((h) => h.id === 'Index3_L:tip')!;
    const rest = restState(s.rig);
    const target = add(index.rest, [-0.03, -0.035, 0]);
    const state = dragAim(s, rest, index.links, { bone: index.anchor, rest: index.rest }, target, []);
    const f = forward(s.rig, state);
    // 手指的关节是现成那只手自带的，不在一条直线上：凑几轮以后离手指要去的地方还差几毫米（接着拖会接着凑）
    expect(dist(tailOf(s.rig, f, index.anchor), target)).toBeLessThan(0.008);
    const shape = readHand(s, state, hand).fingers[0];
    for (const c of shape.curl) expect(c).toBeGreaterThan(5);
    // 不是光勾指尖：中间那一节弯得不比指尖少
    expect(shape.curl[1]).toBeGreaterThan(shape.curl[2] * 0.8);
    // 别的手指没动
    expect(apart({ ...readHand(s, state, hand), fingers: readHand(s, rest, hand).fingers }, readHand(s, rest, hand))).toBeLessThan(1e-6);
  });

  it('往手背、往旁边硬拖：后两节不会往旁边折，往手背翘也有个头', () => {
    const index = handles.find((h) => h.id === 'Index3_L:tip')!;
    const rest = restState(s.rig);
    for (const offset of [[-0.01, 0.07, 0], [-0.02, 0, 0.06], [-0.02, 0.03, -0.05]] as V3[]) {
      const state = dragAim(s, rest, index.links, { bone: index.anchor, rest: index.rest }, add(index.rest, offset), []);
      for (const link of index.links) {
        if (!link.hinge) continue;
        const q = state.local[link.bone];
        // 相对父骨骼的那一下正好是绕着自己的轴转的
        const along = Math.abs(dot(norm([q[0], q[1], q[2]]), link.hinge.axis));
        if (quatAngle(q) > 1e-6) expect(along, s.rig.names[link.bone]).toBeGreaterThan(0.999999);
        const angle = 2 * Math.atan2(dot([q[0], q[1], q[2]], link.hinge.axis), q[3]);
        expect(angle).toBeGreaterThanOrEqual(link.hinge.min - 1e-9);
        expect(angle).toBeLessThanOrEqual(link.hinge.max + 1e-9);
      }
    }
  });
});

describe('姿势数据里的手', () => {
  const a = solverOf(defaultSpec());

  it('直接在数据上读手势，和在骨架上量的一样；数据里没有手指就是没有', () => {
    let state = turnBone(a, restState(a.rig), bone(a.rig, 'LowerArm_L'), quatEuler(0.3, 0.5, -0.4), []);
    state = shapeHand(a, state, handOf(a, 'Hand_L'), gesture('摇滚'));
    const posing = posingOf(a, state);
    expect(apart(posingHand(posing, 'L')!, gesture('摇滚'))).toBeLessThan(0.05);
    expect(posingHand(posing, 'R')).toBeNull();
    expect(posingHand({ version: 3, bones: {} }, 'L')).toBeNull();
  });

  it('直接在数据上换手势，和在骨架上摆了再存是同一份', () => {
    const state = turnBone(a, restState(a.rig), bone(a.rig, 'UpperArm_R'), quatEuler(-0.6, 0.2, 0.7), []);
    const written = withPosingHand(posingOf(a, state), 'R', gesture('握着东西'));
    const direct = posingOf(a, shapeHand(a, state, handOf(a, 'Hand_R'), gesture('握着东西')));
    expect(Object.keys(written.bones).sort()).toEqual(Object.keys(direct.bones).sort());
    for (const [name, q] of Object.entries(direct.bones)) q.forEach((c, k) => expect(written.bones[name][k], name).toBeCloseTo(c, 4));
    // 数据里没有那只手掌：原样返回
    const empty: Posing = { version: 3, bones: {} };
    expect(withPosingHand(empty, 'L', RELAXED)).toBe(empty);
  });

  it('上一版存的姿势（手掌跟着前臂算）：读出来还是原来的样子，再存就换成新的记法', () => {
    const state = turnBone(a, restState(a.rig), bone(a.rig, 'Hand_L'), quatEuler(0.5, -0.3, 0.8), []);
    const f = forward(a.rig, state);
    // 照上一版的意思写：每根骨骼「世界里转了多少」乘上那一版的起点
    const old: Posing = { version: 2, bones: {} };
    a.rig.names.forEach((name, i) => {
      if (a.main[i]) old.bones[name] = quatMul(f.rot[i], a.frames2[i]) as Quat;
    });
    const back = forward(a.rig, stateOf(a, old));
    a.rig.names.forEach((name, i) => expect(quatAngle(quatMul(quatConj(f.rot[i]), back.rot[i])), name).toBeLessThan(1e-6));
    // 手掌的两种算法确实不一样（A-pose 的白模上差着一个角度）
    expect(quatAngle(quatMul(quatConj(a.frames2[bone(a.rig, 'Hand_L')]), a.frames[bone(a.rig, 'Hand_L')]))).toBeGreaterThan(1 * DEG);
    const saved = posingOf(a, stateOf(a, old), old);
    expect(saved.version).toBe(3);
    const again = forward(a.rig, stateOf(a, saved));
    a.rig.names.forEach((name, i) => expect(quatAngle(quatMul(quatConj(f.rot[i]), again.rot[i])), name).toBeLessThan(1e-4));
  });

  it('上一版数据里、这副骨架上没有的骨骼照留，只有手掌不留', () => {
    const old: Posing = { version: 2, bones: { 'UpperArm_L.004': [0, 0, 0.6, 0.8], 'Hand_L.004': [0, 0.6, 0, 0.8], Tail_03_01: [0.6, 0, 0, 0.8] } };
    const saved = posingOf(a, turnBone(a, restState(a.rig), bone(a.rig, 'Head'), quatEuler(0, 0.3, 0), []), old);
    expect(saved.bones['UpperArm_L.004']).toEqual([0, 0, 0.6, 0.8]);
    expect(saved.bones.Tail_03_01).toEqual([0.6, 0, 0, 0.8]);
    expect(saved.bones['Hand_L.004']).toBeUndefined();
  });
});

describe('别的骨架上的手势', () => {
  /** 静止时手指就弯着的一副骨架：拿白模摆了「放松」的样子当它的静止姿势 */
  const a = solverOf(make({}, { hands: 'fingers' }));
  const curled = (() => {
    let state = restState(a.rig);
    for (const hand of a.hands) state = shapeHand(a, state, hand, RELAXED);
    return state;
  })();

  it('来源静止时手指弯着、目标静止时手指直着：换过去还是来源摆的那个手势', () => {
    let posed = curled;
    posed = shapeHand(a, posed, handOf(a, 'Hand_L'), gesture('剪刀手'));
    posed = shapeHand(a, posed, handOf(a, 'Hand_R'), gesture('握拳'));
    const rest = forward(a.rig, curled);
    const now = forward(a.rig, posed);
    const source: SourceBone[] = a.rig.names.map((name, i) => ({
      name,
      parent: a.rig.parent[i],
      rest: rest.pos[i],
      posed: now.pos[i],
      turn: quatMul(now.rot[i], quatConj(rest.rot[i])),
      tail: tailOf(a.rig, rest, i),
    }));
    const posing = posingFromBones(source);
    for (const target of [a, solverOf(make({}, { hands: 'fingers', pose: 'T' }))]) {
      const state = stateOf(target, posing);
      for (const [name, wanted] of [['Hand_L', gesture('剪刀手')], ['Hand_R', gesture('握拳')]] as const) {
        const hand = handOf(target, name);
        // 每一节骨头朝哪是准的：五个指尖都落在直接摆这个手势时的地方
        const direct = tips(target, shapeHand(target, restState(target.rig), hand, wanted), hand);
        tips(target, state, hand).forEach((p, f) => expect(dist(p, direct[f]), `${name} ${FINGER_NAMES[f]}`).toBeLessThan(2e-4));
        // 四指弯多少、张多少也量得出来（拇指顺着自己的轴拧了多少，要看来源骨架静止时拇指是怎么长的，不比）
        const got = readHand(target, state, hand);
        got.fingers.forEach((f, i) => {
          f.curl.forEach((c, k) => expect(c, `${name} ${i}`).toBeCloseTo(wanted.fingers[i].curl[k], 0));
        });
      }
    }
  });
});

describe('现成的姿势里的手', () => {
  const byName = new Map(POSE_LIBRARY.map((p) => [p.name, p.posing]));
  const curl = (posing: Posing, tag: string) => posingHand(posing, tag)!.fingers.map((f) => f.curl[0] + f.curl[1] + f.curl[2]);

  it('每个姿势两只手的手指都记着', () => {
    for (const preset of POSE_LIBRARY) {
      for (const tag of ['L', 'R']) expect(posingHand(preset.posing, tag), `${preset.name} ${tag}`).not.toBeNull();
    }
  });

  it('站着、走路这类没特意摆手的：手是放松的，不是攥着拳；出拳、握方向盘的还是拳头', () => {
    for (const name of ['站着', '走', '靠着栏杆', '抱着胳膊']) {
      for (const tag of ['L', 'R']) for (const c of curl(byName.get(name)!, tag)) expect(c, `${name} ${tag}`).toBeLessThan(120);
    }
    for (const name of ['直拳', '握方向盘']) {
      for (const tag of ['L', 'R']) for (const c of curl(byName.get(name)!, tag)) expect(c, `${name} ${tag}`).toBeGreaterThan(200);
    }
    // 提着灯：拿灯的右手握着，空着的左手放松
    for (const c of curl(byName.get('提着灯')!, 'R')) expect(c).toBeGreaterThan(200);
    for (const c of curl(byName.get('提着灯')!, 'L')) expect(c).toBeLessThan(120);
  });

  it('套到白模人台上，手指不会折到手背那边去', () => {
    const s = solverOf(make({}, { hands: 'fingers' }));
    for (const preset of POSE_LIBRARY) {
      const state = stateOf(s, preset.posing);
      for (const hand of s.hands) {
        const shape = readHand(s, state, hand);
        for (const f of shape.fingers) for (const c of f.curl) expect(c, `${preset.name} ${hand.name}`).toBeGreaterThan(-25);
      }
    }
  });
});

describe('手指的蒙皮', () => {
  // 分指的白模，照导出的精度融合：手指是一根根分开的
  const figure = buildFigure(make({}, { hands: 'fingers', pose: 'T' }));
  const unit = { parts: figure.parts, scale: 1 };
  const mesh = fuseParts(figure.parts, { voxel: VOXEL.fine, blend: defaultSpec().blend });
  const skeleton = buildSkeleton(unit);
  const skin = skinVertices(unit, skeleton, mesh.positions);
  const index = new Map(skeleton.bones.map((b, i) => [b.name, i]));
  const weightsAt = (v: number) => {
    const out: Record<string, number> = {};
    for (let k = 0; k < 4; k++) {
      const w = skin.weights[v * 4 + k];
      if (w > 0) out[skeleton.bones[skin.joints[v * 4 + k]].name] = w;
    }
    return out;
  };
  const near = (p: readonly number[], radius: number) => {
    const out: number[] = [];
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      if (Math.hypot(mesh.positions[v * 3] - p[0], mesh.positions[v * 3 + 1] - p[1], mesh.positions[v * 3 + 2] - p[2]) < radius) out.push(v);
    }
    return out;
  };
  const boneNamed = (name: string) => skeleton.bones[index.get(name)!];

  it('手指的骨骼各是一股，手那根不是', () => {
    expect(boneNamed('Index2_L').strand).toBe(boneNamed('Index1_L').strand);
    expect(boneNamed('Index2_L').strand).not.toBe(boneNamed('Middle2_L').strand);
    expect(boneNamed('Index2_L').strand).not.toBe(boneNamed('Index2_R').strand);
    expect(boneNamed('Hand_L').strand).toBeUndefined();
  });

  it('指尖跟着那根手指的最后一节，不会被旁边的手指带着走', () => {
    for (const finger of ['Index', 'Middle', 'Ring', 'Little', 'Thumb']) {
      const tip = boneNamed(`${finger}3_L`).tail;
      const found = near(tip, 0.014);
      expect(found.length, finger).toBeGreaterThan(3);
      for (const v of found) {
        const w = weightsAt(v);
        for (const [name, x] of Object.entries(w)) {
          if (!name.startsWith(finger)) expect(x, `${finger} 的指尖上有 ${name}`).toBeLessThan(0.03);
        }
        // 小指的最后一节很短，离指尖一厘米多已经到关节了：最后一节占一半以上就算对
        expect(w[`${finger}3_L`], finger).toBeGreaterThan(0.5);
      }
    }
  });

  it('手掌边上的顶点跟着手，不会因为离指根近就跟着手指弯', () => {
    const hand = boneNamed('Hand_L');
    const little = boneNamed('Little1_L');
    // 手腕到小指根的半路上，手掌小指那一侧的边沿
    const mid = [0, 1, 2].map((k) => (hand.head[k] + little.head[k]) / 2);
    const found = near(mid, 0.02);
    expect(found.length).toBeGreaterThan(5);
    for (const v of found) {
      const w = weightsAt(v);
      const onPalm = (w.Hand_L ?? 0) + (w.LowerArm_L ?? 0);
      expect(onPalm, `顶点 ${v} ${JSON.stringify(w)}`).toBeGreaterThan(0.75);
    }
  });
});
