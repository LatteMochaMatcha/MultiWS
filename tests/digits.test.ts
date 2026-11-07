import { describe, expect, it } from 'vitest';
import { EXTRA_FINGERS, FINGER_COUNT, TOE_COUNT, fingerSlabs, toeSlabs } from '../src/anime/digits';
import { footMesh } from '../src/anime/foot';
import { handMesh, handShape } from '../src/anime/hand';
import { buildFigure } from '../src/geometry/layout';
import { humanoidMap } from '../src/io/vrm';
import { type Quat, quatConj, quatMul } from '../src/geometry/vec';
import { type BodySpec, defaultSpec } from '../src/model/spec';
import { RELAXED, shapeHand as poseHand } from '../src/pose/fingers';
import { buildHandles } from '../src/pose/handles';
import { quatAngle } from '../src/pose/math';
import { forward, restState } from '../src/pose/rig';
import { makeSolver, posingOf, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { useAnimeBody } from './animeBody';

/** 每条边被几个三角面用到；只有手腕开口上的边是 1 */
function edgeUse(triangles: Uint16Array): Map<string, number> {
  const use = new Map<string, number>();
  for (let f = 0; f < triangles.length; f += 3) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[f + k];
      const b = triangles[f + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      use.set(key, (use.get(key) ?? 0) + 1);
    }
  }
  return use;
}

describe('手指根数（anime/digits.ts）', () => {
  it('五根就是现成的那只手，原样不动', () => {
    expect(handShape(5).mesh).toBe(handMesh());
    expect(fingerSlabs(5)).toEqual([0, 1, 2, 3]);
  });

  it('排法：少了拿掉无名指、中指，多了复制无名指', () => {
    expect(fingerSlabs(3)).toEqual([0, 3]);
    expect(fingerSlabs(4)).toEqual([0, 1, 3]);
    expect(fingerSlabs(8)).toEqual([0, 1, 2, 4, 4, 4, 3]);
    expect(fingerSlabs(1)).toEqual(fingerSlabs(FINGER_COUNT.min));
    expect(fingerSlabs(20)).toEqual(fingerSlabs(FINGER_COUNT.max));
  });

  for (let count = FINGER_COUNT.min; count <= FINGER_COUNT.max; count++) {
    it(`${count} 根：一整块，只有手腕一个开口，骨骼、权重都对得上`, () => {
      const { mesh, fingers } = handShape(count);
      const vertices = mesh.positions.length / 3;
      expect(fingers.length).toBe(count);
      expect(fingers.map((f) => f.finger).filter((f) => (EXTRA_FINGERS as readonly string[]).includes(f)).length).toBe(Math.max(0, count - 5));

      const use = edgeUse(mesh.triangles);
      expect([...use.values()].every((n) => n === 1 || n === 2)).toBe(true);
      const open = [...use.values()].filter((n) => n === 1).length;
      expect(open).toBe(mesh.loop.length);
      expect(new Set(mesh.loop).size).toBe(mesh.loop.length);

      // 连成一块
      const parent = Array.from({ length: vertices }, (_, i) => i);
      const find = (v: number): number => (parent[v] === v ? v : (parent[v] = find(parent[v])));
      for (let f = 0; f < mesh.triangles.length; f += 3) {
        parent[find(mesh.triangles[f + 1])] = find(mesh.triangles[f]);
        parent[find(mesh.triangles[f + 2])] = find(mesh.triangles[f]);
      }
      expect(new Set(Array.from({ length: vertices }, (_, i) => find(i))).size).toBe(1);

      // 没有细得看不见的三角面
      let thinnest = Infinity;
      for (let f = 0; f < mesh.triangles.length; f += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => mesh.triangles[f + k]);
        const e1 = [0, 1, 2].map((k) => mesh.positions[b * 3 + k] - mesh.positions[a * 3 + k]);
        const e2 = [0, 1, 2].map((k) => mesh.positions[c * 3 + k] - mesh.positions[a * 3 + k]);
        const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
        thinnest = Math.min(thinnest, area);
      }
      expect(thinnest).toBeGreaterThan(1e-12);

      // 权重加起来是 1，骨骼都在名单里，每根手指的三节骨骼都有
      for (let v = 0; v < vertices; v++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += mesh.weights[v * 4 + k];
          expect(mesh.joints[v * 4 + k]).toBeLessThan(mesh.bones.length);
        }
        expect(sum).toBeCloseTo(1, 4);
      }
      for (const { finger } of fingers) for (let k = 1; k <= 3; k++) expect(mesh.bones).toContain(`${finger}${k}`);
      expect(new Set(mesh.bones).size).toBe(mesh.bones.length);
    });
  }

  it('手指多了手掌变宽、少了变窄，拇指那一侧不动', () => {
    const width = (count: number) => {
      const p = handShape(count).mesh.positions;
      let lo = Infinity;
      for (let i = 2; i < p.length; i += 3) lo = Math.min(lo, p[i]);
      return lo;
    };
    expect(width(8)).toBeLessThan(width(5));
    expect(width(3)).toBeGreaterThan(width(5));
    const thumb = (count: number) => handShape(count).fingers[0].joints;
    expect(thumb(8)).toEqual(thumb(5));
  });
});

describe('手指根数接到骨架和摆姿势上', () => {
  const spec = (bodyStyle: BodySpec['bodyStyle'], fingers: number): BodySpec => ({ ...defaultSpec(), bodyStyle, fingers });
  const bonesOf = (s: BodySpec) => buildSkeleton(buildFigure(s)).bones.map((b) => b.name);

  for (const style of ['mannequin', 'anime'] as const) {
    it(`${style}：7 根手指多出 FingerA、FingerB，3 根没有中指、无名指`, () => {
      if (style === 'anime') useAnimeBody();
      const seven = bonesOf(spec(style, 7));
      for (const name of ['FingerA1_L', 'FingerB3_R', 'Ring2_L', 'Little1_R']) expect(seven).toContain(name);
      expect(seven).not.toContain('FingerC1_L');
      const three = bonesOf(spec(style, 3));
      for (const name of ['Thumb1_L', 'Index1_L', 'Little3_R']) expect(three).toContain(name);
      for (const name of ['Middle1_L', 'Ring1_R', 'FingerA1_L']) expect(three).not.toContain(name);
    });
  }

  it('多出来的手指：能拖指尖；手势、只记了五根手指的姿势里都跟着无名指', () => {
    const solver = makeSolver(buildSkeleton(buildFigure(spec('mannequin', 6))).bones);
    const hand = solver.hands.find((h) => h.side > 0 && h.pair === 0)!;
    expect(hand.extras.length).toBe(1);
    expect(buildHandles(solver).some((h) => h.id === `${solver.rig.names[hand.extras[0][2]]}:tip`)).toBe(true);

    const { rig, frames } = solver;
    /** 一节手指相对「约定的样子」转了多少（世界里），无名指和多出来的同一节应当一样 */
    const turned = (state: ReturnType<typeof restState>, bone: number): Quat => quatMul(forward(rig, state).rot[bone], frames[bone]);
    const apart = (a: Quat, b: Quat) => quatAngle(quatMul(quatConj(a), b));
    const posed = poseHand(solver, restState(rig), hand, RELAXED);
    for (let k = 0; k < 3; k++) expect(apart(turned(posed, hand.extras[0][k]), turned(posed, hand.fingers[3][k]))).toBeLessThan(1e-6);

    // 姿势数据里拿掉多出来的手指：读回来照样跟着无名指
    const posing = posingOf(solver, posed);
    for (const name of Object.keys(posing.bones)) if (name.startsWith('FingerA')) delete posing.bones[name];
    const back = stateOf(solver, posing);
    for (let k = 0; k < 3; k++) expect(apart(turned(back, hand.extras[0][k]), turned(back, hand.fingers[3][k]))).toBeLessThan(1e-3);
  });

  it('导出 VRM：标准的五根手指照常对上，多出来的不进对照表，少了的就空着', () => {
    for (const [count, has, lacks] of [
      [7, ['leftRingProximal', 'leftLittleDistal'], []],
      [3, ['leftIndexProximal', 'rightLittleProximal'], ['leftMiddleProximal', 'rightRingProximal']],
    ] as const) {
      const sk = buildSkeleton(buildFigure(spec('mannequin', count)));
      const map = humanoidMap(sk);
      for (const slot of has) expect(map.has(slot)).toBe(true);
      for (const slot of lacks) expect(map.has(slot)).toBe(false);
      expect([...map.values()].some((i) => sk.bones[i].name.startsWith('Finger'))).toBe(false);
    }
  });
});

/** 一块缝上去的网格是不是好的：一整块、边只有开口那一圈、没有细得看不见的三角面、权重加起来是 1 */
function checkGraft(mesh: ReturnType<typeof footMesh>) {
  const vertices = mesh.positions.length / 3;
  const use = edgeUse(mesh.triangles);
  expect([...use.values()].every((n) => n === 1 || n === 2)).toBe(true);
  expect([...use.values()].filter((n) => n === 1).length).toBe(mesh.loop.length);
  expect(new Set(mesh.loop).size).toBe(mesh.loop.length);
  const parent = Array.from({ length: vertices }, (_, i) => i);
  const find = (v: number): number => (parent[v] === v ? v : (parent[v] = find(parent[v])));
  for (let f = 0; f < mesh.triangles.length; f += 3) {
    parent[find(mesh.triangles[f + 1])] = find(mesh.triangles[f]);
    parent[find(mesh.triangles[f + 2])] = find(mesh.triangles[f]);
  }
  expect(new Set(Array.from({ length: vertices }, (_, i) => find(i))).size).toBe(1);
  for (let f = 0; f < mesh.triangles.length; f += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => mesh.triangles[f + k]);
    const e1 = [0, 1, 2].map((k) => mesh.positions[b * 3 + k] - mesh.positions[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => mesh.positions[c * 3 + k] - mesh.positions[a * 3 + k]);
    expect(Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])).toBeGreaterThan(2e-12);
  }
  for (let v = 0; v < vertices; v++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      sum += mesh.weights[v * 4 + k];
      expect(mesh.joints[v * 4 + k]).toBeLessThan(mesh.bones.length);
    }
    expect(sum).toBeCloseTo(1, 4);
  }
}

describe('脚趾个数（anime/digits.ts 的 shapeFoot）', () => {
  it('五个就是现成的那只脚；排法：少了拿掉第四趾、第三趾，多了复制第二趾', () => {
    expect(footMesh(5)).toBe(footMesh());
    expect(toeSlabs(2)).toEqual([0, 4]);
    expect(toeSlabs(4)).toEqual([0, 1, 2, 4]);
    expect(toeSlabs(7)).toEqual([0, 1, 5, 5, 2, 3, 4]);
    expect(toeSlabs(0)).toEqual(toeSlabs(TOE_COUNT.min));
  });

  for (let count = TOE_COUNT.min; count <= TOE_COUNT.max; count++) {
    it(`${count} 个：一整块，只有脚踝一个开口，骨骼照旧`, () => {
      const mesh = footMesh(count);
      checkGraft(mesh);
      expect(mesh.bones).toEqual(footMesh().bones);
    });
  }

  it('脚趾多了前脚掌变宽（往小脚趾那边），大脚趾那一侧、脚底高低不动', () => {
    const span = (count: number) => {
      const p = footMesh(count).positions;
      let [lo, hi, sole] = [Infinity, -Infinity, Infinity];
      for (let i = 0; i < p.length; i += 3) {
        sole = Math.min(sole, p[i + 1]);
        // 只量前脚掌（脚跟、脚踝不跟着变）
        if (p[i + 2] < 0.04) continue;
        lo = Math.min(lo, p[i]);
        hi = Math.max(hi, p[i]);
      }
      return { lo, hi, sole };
    };
    expect(span(8).hi).toBeGreaterThan(span(5).hi + 0.02);
    expect(span(2).hi).toBeLessThan(span(5).hi - 0.01);
    expect(span(8).lo).toBeCloseTo(span(5).lo, 3);
    expect(span(8).sole).toBeCloseTo(span(5).sole, 3);
  });

  it('二次元素体：脚上接的是照个数拼好的脚，人台的腿不受影响', () => {
    useAnimeBody();
    const feet = (s: BodySpec) => buildFigure(s).parts.flatMap((p) => p.grafts ?? []).filter((g) => g.mesh === 'foot');
    const anime = feet({ ...defaultSpec(), bodyStyle: 'anime', toes: 7 });
    expect(anime.length).toBeGreaterThan(0);
    expect(anime.every((g) => g.digits === 7)).toBe(true);
    expect(feet({ ...defaultSpec(), bodyStyle: 'anime' }).every((g) => g.digits === undefined)).toBe(true);
  });
});
