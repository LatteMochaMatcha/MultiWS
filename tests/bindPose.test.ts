// 摆姿势用的网格：垂着的手臂先平举着摆开再融合，权重算好以后转回静止的位置（src/sdf/bindPose.ts）
import { describe, expect, it } from 'vitest';
import { skinVerticesDualInPlace, skinVerticesInPlace } from '../src/character/pose';
import { buildFigure } from '../src/geometry/layout';
import { type V3, dot, norm, quatMat3, sub } from '../src/geometry/vec';
import { type BodyCounts, type BodySpec, defaultSpec } from '../src/model/spec';
import { type Skeleton, buildSkeleton } from '../src/rig/skeleton';
import { type SkinWeights, bindGrafts, skinVertices } from '../src/rig/skin';
import { bindParts, fuseSkinned, hasBindPose } from '../src/sdf/bindPose';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
import type { FusedMesh } from '../src/sdf/surfaceNets';
import { useAnimeBody } from './animeBody';

const make = (counts: Partial<BodyCounts> = {}, rest: Partial<BodySpec> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, ...rest, counts: { ...base.counts, ...counts } };
};
const boneOf = (s: Skeleton, name: string) => {
  const bone = s.bones.find((b) => b.name === name);
  if (!bone) throw new Error(`没有骨骼 ${name}`);
  return bone;
};
const along = (s: Skeleton, name: string): V3 => norm(sub(boneOf(s, name).tail, boneOf(s, name).head));
const angle = (a: V3, b: V3) => (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;
/** 第 i 对手臂的骨骼名（左边） */
const arm = (base: string, i: number) => (i ? `${base}_L.00${i + 1}` : `${base}_L`);

/** 照老办法：静止的样子直接融合、算权重 */
function plain(spec: BodySpec, voxel: number) {
  const parts = buildFigure(spec).parts;
  const figure = { parts, scale: 1 };
  const mesh = fuseParts(parts, { voxel, blend: spec.blend });
  const skeleton = buildSkeleton(figure);
  return { mesh, skin: bindGrafts(skinVertices(figure, skeleton, mesh.positions, mesh.triangles), mesh, skeleton), skeleton };
}

/** 每根骨骼的蒙皮矩阵：name 这根上臂（连着它下面的）绕肩关节、绕前后方向的轴转 degrees（左手臂往上抬是正的），别的不动 */
function liftMatrices(skeleton: Skeleton, name: string, degrees: number): Float64Array {
  const follows = new Set<number>();
  skeleton.bones.forEach((bone, i) => {
    if (bone.name === name || follows.has(bone.parent)) follows.add(i);
  });
  const joint = boneOf(skeleton, name).head;
  const half = (degrees * Math.PI) / 360;
  const r = quatMat3([0, 0, Math.sin(half), Math.cos(half)]);
  const out = new Float64Array(skeleton.bones.length * 12);
  skeleton.bones.forEach((_, i) => {
    const m = follows.has(i) ? r : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    out.set(m, i * 12);
    for (let row = 0; row < 3; row++) out[i * 12 + 9 + row] = joint[row] - (m[row * 3] * joint[0] + m[row * 3 + 1] * joint[1] + m[row * 3 + 2] * joint[2]);
  });
  return out;
}

/** 把一条左手臂往上抬 degrees：摆好以后的顶点（dual：混合骨骼的动作；不然是线性混合） */
function lift(mesh: FusedMesh, skin: SkinWeights, skeleton: Skeleton, name: string, degrees: number, dual: boolean): Float32Array {
  const moved = mesh.positions.slice();
  const normals = mesh.normals.slice();
  (dual ? skinVerticesDualInPlace : skinVerticesInPlace)(moved, normals, skin.joints, skin.weights, liftMatrices(skeleton, name, degrees));
  return moved;
}

/** 摆了以后有多少条边被拉长到两倍半以上，最长的多出多少 */
function stretched(mesh: FusedMesh, moved: Float32Array) {
  const length = (at: ArrayLike<number>, a: number, b: number) => Math.hypot(at[a * 3] - at[b * 3], at[a * 3 + 1] - at[b * 3 + 1], at[a * 3 + 2] - at[b * 3 + 2]);
  let torn = 0;
  let worst = 0;
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = mesh.triangles[t + e];
      const b = mesh.triangles[t + ((e + 1) % 3)];
      if (a > b) continue;
      const before = length(mesh.positions, a, b);
      const after = length(moved, a, b);
      worst = Math.max(worst, after - before);
      if (after > before * 2.5 && after - before > 0.004) torn++;
    }
  }
  return { torn, worst };
}

/**
 * 肩头那一圈「一半跟着这条手臂、一半跟着别处」的点（跟着手臂的权重在 0.3 ~ 0.7 之间），摆了以后离肩关节的距离是原来的几分之几：
 * 最小的那个。线性混合时手臂转得多，这些点被拉向关节，整圈缩成一片（这个数很小）；混合动作的话距离不变（接近 1）
 */
function pinch(mesh: FusedMesh, skin: SkinWeights, skeleton: Skeleton, name: string, moved: Float32Array) {
  const follows = new Set<number>();
  skeleton.bones.forEach((bone, i) => {
    if (bone.name === name || follows.has(bone.parent)) follows.add(i);
  });
  const joint = boneOf(skeleton, name).head;
  const far = (at: ArrayLike<number>, v: number) => Math.hypot(at[v * 3] - joint[0], at[v * 3 + 1] - joint[1], at[v * 3 + 2] - joint[2]);
  let least = Infinity;
  let seen = 0;
  for (let v = 0; v < mesh.positions.length / 3; v++) {
    let share = 0;
    for (let k = 0; k < 4; k++) if (follows.has(skin.joints[v * 4 + k])) share += skin.weights[v * 4 + k];
    if (share < 0.3 || share > 0.7 || far(mesh.positions, v) < 0.02) continue;
    seen++;
    least = Math.min(least, far(moved, v) / far(mesh.positions, v));
  }
  return { least, seen };
}

/** 每条前臂上的顶点都在静止时那根前臂骨骼旁边（权重是照摆开的样子算的，网格已经转回来了） */
function onForearms(mesh: FusedMesh, skin: SkinWeights, skeleton: Skeleton, armPairs: number) {
  for (let i = 0; i < armPairs; i++) {
    const bone = boneOf(skeleton, arm('LowerArm', i));
    const index = skeleton.bones.indexOf(bone);
    const axis = sub(bone.tail, bone.head);
    const length2 = dot(axis, axis);
    let seen = 0;
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      if (skin.joints[v * 4] !== index || skin.weights[v * 4] < 0.95) continue;
      seen++;
      const p: V3 = [mesh.positions[v * 3] - bone.head[0], mesh.positions[v * 3 + 1] - bone.head[1], mesh.positions[v * 3 + 2] - bone.head[2]];
      const t = Math.max(0, Math.min(1, dot(p, axis) / length2));
      expect(Math.hypot(p[0] - axis[0] * t, p[1] - axis[1] * t, p[2] - axis[2] * t), `第 ${i + 1} 对的前臂，顶点 ${v}`).toBeLessThan(0.06);
    }
    expect(seen).toBeGreaterThan(100);
  }
}

/** 同时跟着两条不同手臂的顶点里，离左肩关节最远的有多远（只看左半边） */
function sharedReach(mesh: FusedMesh, skin: SkinWeights, skeleton: Skeleton) {
  const which = skeleton.bones.map((bone) => /^(Shoulder|UpperArm|LowerArm|Hand|(Thumb|Index|Middle|Ring|Little)\d)_(L(\.\d+)?)$/.exec(bone.name)?.[3] ?? '');
  const joint = boneOf(skeleton, 'UpperArm_L').head;
  let far = 0;
  for (let v = 0; v < mesh.positions.length / 3; v++) {
    const seen = new Set<string>();
    for (let k = 0; k < 4; k++) if (skin.weights[v * 4 + k] > 1e-4 && which[skin.joints[v * 4 + k]]) seen.add(which[skin.joints[v * 4 + k]]);
    if (seen.size < 2) continue;
    far = Math.max(far, Math.hypot(mesh.positions[v * 3] - joint[0], mesh.positions[v * 3 + 1] - joint[1], mesh.positions[v * 3 + 2] - joint[2]));
  }
  return far;
}

describe('融合时的姿势', () => {
  it('垂着的手臂都要先平举着摆开；本来就平举着的（T-pose 的一对、T-pose 的上下排）不用', () => {
    const has = (counts: Partial<BodyCounts>, rest: Partial<BodySpec>) => hasBindPose(buildFigure(make(counts, rest)).parts);
    expect(has({ armPairs: 1 }, {})).toBe(true);
    expect(has({ armPairs: 3 }, { armLayout: 'fan' })).toBe(true);
    expect(has({ armPairs: 3 }, { armLayout: 'stack' })).toBe(true);
    // T-pose 的肩部聚拢：几条手臂上下只隔二十来度，照样要前后摆开
    expect(has({ armPairs: 3 }, { armLayout: 'fan', pose: 'T' })).toBe(true);
    expect(has({ armPairs: 1 }, { pose: 'T' })).toBe(false);
    expect(has({ armPairs: 3 }, { armLayout: 'stack', pose: 'T' })).toBe(false);
    const parts = buildFigure(make({ armPairs: 3 }, { armLayout: 'fan' })).parts;
    expect(parts.filter((part) => part.bind).map((part) => part.name).sort()).toEqual(['Arm_01_L', 'Arm_01_R', 'Arm_02_L', 'Arm_02_R', 'Arm_03_L', 'Arm_03_R']);
  });

  it('摆开以后：每条手臂都是平举的，相邻两条隔得开，肩关节和锁骨留在原地，别的部件原样不动', () => {
    for (const [armPairs, armLayout] of [[1, 'fan'], [2, 'fan'], [3, 'fan'], [4, 'fan'], [3, 'stack']] as const) {
      const parts = buildFigure(make({ armPairs }, { armLayout })).parts;
      const bound = bindParts(parts);
      expect(bound.some((part) => part.bind)).toBe(false);
      parts.forEach((part, i) => {
        if (!part.bind) expect(bound[i]).toBe(part);
      });
      const rest = buildSkeleton({ parts, scale: 1 });
      const spread = buildSkeleton({ parts: bound, scale: 1 });
      expect(spread.bones.map((bone) => bone.name)).toEqual(rest.bones.map((bone) => bone.name));
      for (let i = 0; i < armPairs; i++) {
        // 锁骨没动；上臂还是从同一个肩关节伸出去，手臂的长短没变
        for (const end of ['head', 'tail'] as const) {
          boneOf(spread, arm('Shoulder', i))[end].forEach((x, k) => expect(x).toBeCloseTo(boneOf(rest, arm('Shoulder', i))[end][k], 9));
        }
        boneOf(spread, arm('UpperArm', i)).head.forEach((x, k) => expect(x).toBeCloseTo(boneOf(rest, arm('UpperArm', i)).head[k], 9));
        const reach = (s: Skeleton) => Math.hypot(...sub(boneOf(s, arm('Hand', i)).head, boneOf(s, arm('UpperArm', i)).head));
        expect(reach(spread)).toBeCloseTo(reach(rest), 9);
        // 平举：上臂不朝上也不朝下，是往外伸的（静止时是垂着的）
        const way = along(spread, arm('UpperArm', i));
        expect(Math.abs(way[1]), `${armLayout} ${armPairs} 对，第 ${i + 1} 对`).toBeLessThan(0.02);
        expect(way[0]).toBeGreaterThan(0.4);
        expect(along(rest, arm('UpperArm', i))[1]).toBeLessThan(-0.3);
        // 聚在一个肩膀上的：相邻两条静止时只隔十几度，摆开以后至少隔二十五度；越靠前的那条越往前
        if (i && armLayout === 'fan') {
          const between = (s: Skeleton) => angle(along(s, arm('UpperArm', i - 1)), along(s, arm('UpperArm', i)));
          expect(between(spread), `${armPairs} 对，第 ${i} 和 ${i + 1} 对`).toBeGreaterThan(25);
          expect(between(spread)).toBeGreaterThan(between(rest) + 3);
          expect(way[2]).toBeGreaterThan(along(spread, arm('UpperArm', i - 1))[2] + 0.3);
        }
      }
      // 不是手臂的骨骼都没动
      rest.bones.forEach((bone, i) => {
        if (!/^(Shoulder|UpperArm|LowerArm|Hand|(Thumb|Index|Middle|Ring|Little)[0-9])_/.test(bone.name)) expect(spread.bones[i]).toEqual(bone);
      });
    }
  });

  it('手动把手臂拉长过（部件带着各轴缩放）：锁骨还是留在原地', () => {
    const parts = buildFigure(make({ armPairs: 2 }, { armLayout: 'fan' })).parts.map((part) => (part.name === 'Arm_01_L' ? { ...part, resize: [1, 1.3, 1] as V3 } : part));
    const rest = buildSkeleton({ parts, scale: 1 });
    const spread = buildSkeleton({ parts: bindParts(parts), scale: 1 });
    for (const end of ['head', 'tail'] as const) boneOf(spread, 'Shoulder_L')[end].forEach((x, k) => expect(x).toBeCloseTo(boneOf(rest, 'Shoulder_L')[end][k], 9));
  });
});

describe('摆姿势用的网格', () => {
  it('不用摆开的身体（T-pose）：和照老办法融合、算权重的结果一模一样', () => {
    const spec = make({ armPairs: 2 }, { pose: 'T' });
    const parts = buildFigure(spec).parts;
    expect(hasBindPose(parts)).toBe(false);
    const old = plain(spec, VOXEL.draft);
    const now = fuseSkinned(parts, { voxel: VOXEL.draft, blend: spec.blend });
    expect(now.mesh.positions).toEqual(old.mesh.positions);
    expect(now.skin.joints).toEqual(old.skin.joints);
    expect(now.skin.weights).toEqual(old.skin.weights);
  });

  it('一对手臂：还是一整块，手臂回到了垂着的位置；举过头顶，肩头不瘪（照老办法会缩成一片）', () => {
    const spec = make();
    const parts = buildFigure(spec).parts;
    const old = plain(spec, VOXEL.preview);
    const { mesh, skin } = fuseSkinned(parts, { voxel: VOXEL.preview, blend: spec.blend });
    const skeleton = old.skeleton;
    expect(mesh.info.components).toBe(1);
    for (let i = 0; i < mesh.positions.length; i++) if (!Number.isFinite(mesh.positions[i])) throw new Error(`第 ${i} 个坐标不是数`);
    onForearms(mesh, skin, skeleton, 1);
    // 静止时上臂离垂直向下 48°，举过头顶要转 130°
    const before = pinch(old.mesh, old.skin, skeleton, 'UpperArm_L', lift(old.mesh, old.skin, skeleton, 'UpperArm_L', 130, false));
    const after = pinch(mesh, skin, skeleton, 'UpperArm_L', lift(mesh, skin, skeleton, 'UpperArm_L', 130, true));
    expect(before.seen).toBeGreaterThan(50);
    expect(after.seen).toBeGreaterThan(50);
    expect(before.least).toBeLessThan(0.55);
    expect(after.least).toBeGreaterThan(0.97);
  }, 60_000);

  it('肩部聚拢的三对手臂：还是一整块；手臂回到了静止的位置；几条手臂只在肩头连着；哪一条举过头顶肩头都不瘪', () => {
    const spec = make({ armPairs: 3 }, { armLayout: 'fan' });
    const parts = buildFigure(spec).parts;
    const old = plain(spec, VOXEL.preview);
    const { mesh, skin } = fuseSkinned(parts, { voxel: VOXEL.preview, blend: spec.blend });
    const skeleton = old.skeleton;
    expect(mesh.info.components).toBe(1);
    expect(skin.joints.length).toBe((mesh.positions.length / 3) * 4);
    for (let i = 0; i < mesh.positions.length; i++) if (!Number.isFinite(mesh.positions[i])) throw new Error(`第 ${i} 个坐标不是数`);
    onForearms(mesh, skin, skeleton, 3);
    // 照静止的样子直接融合：几条手臂从肩膀到上臂中段是一张皮，离肩关节三十多厘米的地方还同时跟着两条手臂
    expect(sharedReach(old.mesh, old.skin, skeleton)).toBeGreaterThan(0.3);
    expect(sharedReach(mesh, skin, skeleton)).toBeLessThan(0.24);
    for (let i = 0; i < 3; i++) {
      const name = arm('UpperArm', i);
      const before = pinch(old.mesh, old.skin, skeleton, name, lift(old.mesh, old.skin, skeleton, name, 130, false));
      const moved = lift(mesh, skin, skeleton, name, 130, true);
      const after = pinch(mesh, skin, skeleton, name, moved);
      // 也没有哪片皮被扯成长条：照老办法直接融合再举，几百上千条边被拉长，最长的多出十几厘米；现在最长的多出五六厘米
      const was = stretched(old.mesh, lift(old.mesh, old.skin, skeleton, name, 130, false));
      const now = stretched(mesh, moved);
      expect(was.torn, name).toBeGreaterThan(500);
      expect(was.worst, name).toBeGreaterThan(0.11);
      expect(now.torn, name).toBeLessThan(250);
      expect(now.worst, name).toBeLessThan(0.08);
      expect(before.least, name).toBeLessThan(0.55);
      expect(after.seen, name).toBeGreaterThan(30);
      expect(after.least, name).toBeGreaterThan(0.97);
    }
  }, 90_000);

  it('二次元素体、四对手臂：一样', () => {
    useAnimeBody();
    const spec = make({ armPairs: 4 }, { armLayout: 'fan', bodyStyle: 'anime' });
    const parts = buildFigure(spec).parts;
    expect(hasBindPose(parts)).toBe(true);
    const old = plain(spec, VOXEL.preview);
    const { mesh, skin } = fuseSkinned(parts, { voxel: VOXEL.preview, blend: spec.blend });
    expect(mesh.info.components).toBe(1);
    expect(sharedReach(old.mesh, old.skin, old.skeleton)).toBeGreaterThan(0.3);
    expect(sharedReach(mesh, skin, old.skeleton)).toBeLessThan(0.24);
    for (let i = 0; i < 4; i++) {
      const name = arm('UpperArm', i);
      const moved = lift(mesh, skin, old.skeleton, name, 130, true);
      expect(pinch(mesh, skin, old.skeleton, name, moved).least, name).toBeGreaterThan(0.97);
      expect(stretched(mesh, moved).torn, name).toBeLessThan(500);
      expect(stretched(mesh, moved).worst, name).toBeLessThan(0.11);
    }
  }, 90_000);
});
