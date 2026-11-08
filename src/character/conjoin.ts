/**
 * 成品角色的 queen conjoined 连体（见 geometry/conjoined.ts 的说明）：照她自己的网格做，不自己捏。
 * 1. 趁还是 T-pose（手臂平举，都在腰上面）：腰最细的地方往下的都不要（腿、胯、裙摆、垂到腰下面的头发）；
 * 2. 腰往上整个复制一份（骨骼也复制，接着往下编号），绕腰转 180°：同向绕前后的轴、反向绕左右的轴；
 * 3. 姿势：手臂朝前（趴下以后朝下撑地）、手腕往手背弯 90°（手心贴地、手指朝头那边）、脖子和头往上抬；
 *    第二个上半身照第一个的转法转过去（反向的手臂往它自己身后伸、头不抬，仰面朝上看）。这些和别的姿势一起烤成静止姿势；
 * 4. 烤完以后整个人绕腰往前趴下 90°（layDown），反向的再歪一点让四只手都踩到地上；最后照最低点落到地面上（assemble.ts 本来就这么做）。
 *
 * 纯函数（改的是传进来的工作副本），在 Web Worker 和单元测试里都能跑。
 */
import { nthName } from '../geometry/figure';
import { lineUpTurns, uprightFix } from '../geometry/lieLine';
import { type Quat, type V3, add, cross, dot, mul, norm, quatBetween, quatConj, quatEuler, quatMul, rotate, sub } from '../geometry/vec';
import type { BoneOrigin } from './assemble';
import type { BonePose } from './pose';
import type { Chunk } from './source';

export type CharacterConjoin = 'same' | 'opposite';
/** 连体的姿态：趴着、躺着、站着（见 geometry/conjoined.ts） */
export type CharacterPosture = 'prone' | 'lie' | 'flat' | 'stand';

/** 烤完姿势以后怎么摆（见 layDown） */
export interface Laid {
  pivot: V3;
  /** 两个上半身各自的手（骨骼下标） */
  hands: [number[], number[]];
  /** 整个人绕腰转多少（趴下、侧躺）；站着的不转 */
  turn: Quat | null;
  /** 两头的手要不要找平（反向趴着的） */
  level: boolean;
  /** 照手心落地（趴着、站着）；躺着的照最低点 */
  palms: boolean;
}

export interface ConjoinWork {
  names: string[];
  parent: number[];
  rest: V3[];
  origin: (BoneOrigin | null)[];
  marker: boolean[];
  chunks: Chunk[];
  pose: Map<number, BonePose>;
}

/** 量腰最细的地方：脊柱第一节的起点往下、往上各多远 */
const WAIST_FROM = 0.04;
const WAIST_TO = 0.16;
/** 两个上半身在切口两边各多留这么多 */
const OVERLAP = 0.01;
/** 手臂撑地时往外撇多少、几对手臂之间再撇开多少（正切） */
const ARM_SPLAY = 0.18;
const ARM_FAN = 0.35;
/**
 * 侧躺：两个上半身照他定的排在同一条轴上（不翘成 V，脊柱也不往上弯），整个人侧着平躺在地上；
 * 靠地那只手臂朝自己前面平伸着贴地（PROP_UPPER：世界里上臂朝哪，几乎水平朝前）；
 * 头往正上方回正多少和白模、素体一样（geometry/lieLine.ts 的 uprightFix），脖子、头分着转
 */
const PROP_UPPER = norm([0, -0.12, 1]);
const NECK_SHARE = 0.55;
/**
 * 上面那只手撑在胸前的地上：胳膊肘那一圈多粗，手腕到手掌中间多远，往头那边偏多少；
 * HAND_SINK：照 T-pose 估的肩高比烤完的高（衣服、肩膀那一圈跟着转），手臂多斜这么多手心才贴到地
 */
const ELBOW_R = 0.035;
const HAND_SINK = 0.028;
const PALM_REACH = 0.05;
const FREE_TOWARD_HEAD = 0.25;
/** 倒立时手臂往外撇多少（正切）：差不多竖直、和肩同宽 */
const HANDSTAND_SPLAY = 0.05;
/** 倒立时头往胸口收多少（弧度） */
const HANDSTAND_TUCK = 35 * (Math.PI / 180);
/** 平躺时手臂往外张开多少（正切）、往地上那边斜多少 */
const FLAT_SPREAD = 1.6;
const FLAT_DROP = 0.3;
/** 脖子、头各往上抬多少（弧度） */
const NECK_LIFT = 30 * (Math.PI / 180);
const HEAD_LIFT = 30 * (Math.PI / 180);

/** 绕 axis（单位向量）转 angle 的四元数 */
const axisAngle = (axis: V3, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ordinal = (name: string): [string, number] => {
  const m = /^(.*?)(?:\.(\d{3}))?$/.exec(name)!;
  return [m[1], m[2] ? Number(m[2]) - 1 : 0];
};

/** 只留 indices 用到的点（去掉的面上的点不留着：落地是照所有点里最低的那个量的） */
function compact(chunk: Chunk, indices: number[]): Chunk {
  const remap = new Map<number, number>();
  for (const v of indices) if (!remap.has(v)) remap.set(v, remap.size);
  const m = remap.size;
  const out: Chunk = {
    ...chunk,
    positions: new Float32Array(m * 3),
    normals: new Float32Array(m * 3),
    uvs: new Float32Array(m * 2),
    joints: new Uint16Array(m * 4),
    weights: new Float32Array(m * 4),
    indices: Uint32Array.from(indices, (v) => remap.get(v)!),
    ...(chunk.faceVertex ? { faceVertex: new Int32Array(m) } : {}),
  };
  for (const [v, id] of remap) {
    out.positions.set(chunk.positions.subarray(v * 3, v * 3 + 3), id * 3);
    out.normals.set(chunk.normals.subarray(v * 3, v * 3 + 3), id * 3);
    out.uvs.set(chunk.uvs.subarray(v * 2, v * 2 + 2), id * 2);
    out.joints.set(chunk.joints.subarray(v * 4, v * 4 + 4), id * 4);
    out.weights.set(chunk.weights.subarray(v * 4, v * 4 + 4), id * 4);
    if (chunk.faceVertex) out.faceVertex![id] = chunk.faceVertex[v];
  }
  return out;
}

/**
 * 第 1–3 步（T-pose 上做，姿势还没烤）。返回腰上对接的那一点，以及两个上半身各自的手（骨骼下标）：
 * 烤完以后 layDown 照它们趴下、找平
 */
export function conjoinCharacter(w: ConjoinWork, kind: CharacterConjoin, posture: CharacterPosture = 'prone'): Laid | null {
  const { names, parent, rest, origin, marker, chunks, pose } = w;
  const find = (name: string) => names.indexOf(name);
  const hips = find('Hips');
  const spine = find('Spine');
  if (hips < 0 || spine < 0) return null;

  /* ---- 腰最细的地方：照每个高度上身子（不算手臂）最宽到哪 ---- */
  const at = rest[spine];
  let cutY = at[1];
  let narrow = Infinity;
  for (let y = at[1] - WAIST_FROM; y <= at[1] + WAIST_TO; y += 0.004) {
    let half = 0;
    for (const chunk of chunks) {
      for (let v = 0; v < chunk.positions.length / 3; v++) {
        const x = Math.abs(chunk.positions[v * 3]);
        if (Math.abs(chunk.positions[v * 3 + 1] - y) < 0.004 && x < 0.3) half = Math.max(half, x);
      }
    }
    if (half > 0 && half < narrow - 1e-4) {
      narrow = half;
      cutY = y;
    }
  }
  // 前后取在切口那一圈的正中：反向的那一份前后翻过来，正中对正中
  let front = -Infinity;
  let back = Infinity;
  for (const chunk of chunks) {
    for (let v = 0; v < chunk.positions.length / 3; v++) {
      if (Math.abs(chunk.positions[v * 3 + 1] - cutY) > 0.006 || Math.abs(chunk.positions[v * 3]) > 0.3) continue;
      front = Math.max(front, chunk.positions[v * 3 + 2]);
      back = Math.min(back, chunk.positions[v * 3 + 2]);
    }
  }
  const pivot: V3 = [0, cutY, front > back ? (front + back) / 2 : at[2]];

  /* ---- 1. 腰往下的都不要 ---- */
  const keepFrom = cutY - OVERLAP;
  for (let n = 0; n < chunks.length; n++) {
    const chunk = chunks[n];
    const keep: number[] = [];
    for (let t = 0; t < chunk.indices.length; t += 3) {
      const tri = [chunk.indices[t], chunk.indices[t + 1], chunk.indices[t + 2]];
      if (tri.some((v) => chunk.positions[v * 3 + 1] >= keepFrom)) keep.push(...tri);
    }
    if (keep.length !== chunk.indices.length) chunks[n] = compact(chunk, keep);
  }
  // 腰下面的骨骼（腿、裙摆）：没有网格了的最后清掉
  // 脊柱那一串（胯到脖子）的不算：脊柱第一节的起点就在腰下面一点
  const chain = new Set<number>();
  for (let b = find('Neck'); b >= 0; b = parent[b]) chain.add(b);
  rest.forEach((p, b) => {
    if (b !== hips && !chain.has(b) && p[1] < keepFrom - 0.02) marker[b] = true;
  });
  // 胯那根挪到腰上：两个上半身的脊柱都接在它上面
  rest[hips] = [...pivot];

  /* ---- 姿势：手臂朝前撑地，手腕弯过去，脖子、头抬起来 ---- */
  const upperArms = names.flatMap((name, b) => (/^UpperArm_[LR](\.\d+)?$/.test(name) ? [b] : []));
  const childOf = (b: number, base: string) => names.findIndex((n, k) => parent[k] === b && n.startsWith(base));
  const sideOf = (upper: number) => {
    const lower = childOf(upper, 'LowerArm');
    return lower >= 0 && rest[lower][0] < rest[upper][0] ? -1 : 1;
  };
  const splayOf = (upper: number) => sideOf(upper) * (ARM_SPLAY + ARM_FAN * ordinal(names[upper])[1]);
  /**
   * 一条手臂朝 target 撑地时，上臂、前臂、手各转多少（还是第一个上半身的坐标）：
   * 手臂伸直，手腕往手背弯 90°，手指转到朝 ahead、手心转到朝地（顺着手臂往外）
   */
  const armPose = (upper: number, target: V3, ahead: V3): Map<number, Quat> => {
    const out = new Map<number, Quat>();
    const lower = childOf(upper, 'LowerArm');
    const hand = lower >= 0 ? childOf(lower, 'Hand') : -1;
    if (lower < 0) return out;
    const turn = quatBetween(norm(sub(rest[lower], rest[upper])), norm(target));
    out.set(upper, turn);
    out.set(lower, [0, 0, 0, 1]);
    if (hand >= 0) {
      const bend = axisAngle(norm(cross(norm(target), ahead)), Math.PI / 2);
      out.set(hand, quatMul(quatConj(turn), quatMul(bend, turn)));
    }
    return out;
  };
  /** 脖子、头往上抬 */
  const liftPose = (): Map<number, Quat> => {
    const out = new Map<number, Quat>();
    names.forEach((name, b) => {
      if (/^Neck(\.\d+)?$/.test(name)) out.set(b, quatMul(quatEuler(-NECK_LIFT, 0, 0), pose.get(b)?.rotation ?? [0, 0, 0, 1]));
      if (/^Head(\.\d+)?$/.test(name)) out.set(b, quatMul(quatEuler(-HEAD_LIFT, 0, 0), pose.get(b)?.rotation ?? [0, 0, 0, 1]));
    });
    return out;
  };
  /**
   * 躺着：整个人侧过来（绕前后的轴转 90°，第一个上半身的头朝 -X），两个上半身在同一条轴上。
   * world：这个上半身（第一个上半身的坐标）→ 世界的旋转。靠地那一侧的手臂朝前平伸着贴地，上面那只撑在胸前的地上，
   * 脖子往正上方回正一些
   */
  const liePose = (world: Quat): Map<number, Quat> => {
    const out = new Map<number, Quat>();
    const back: Quat = [-world[0], -world[1], -world[2], world[3]];
    const local = (d: V3) => rotate(back, d);
    const heightOf = (b: number) => rotate(world, sub(rest[b], pivot))[1];
    // 这个上半身自己的「前面」（世界里、水平）：反向的那一个朝 -Z
    const facing = rotate(world, [0, 0, 1]);
    const fwd = norm([facing[0], 0, facing[2]]);
    const propDir = norm(add(mul([0, -1, 0], -PROP_UPPER[1]), mul(fwd, PROP_UPPER[2])));
    const props: number[] = [];
    const free: number[] = [];
    for (const upper of upperArms) {
      const lower = childOf(upper, 'LowerArm');
      if (lower < 0) continue;
      const twin = names.indexOf(names[upper].replace(/_([LR])/, (_m, s: string) => (s === 'L' ? '_R' : '_L')));
      const low = twin < 0 || heightOf(upper) <= heightOf(twin);
      if (low) {
        props.push(upper);
        const turn = quatBetween(norm(sub(rest[lower], rest[upper])), local(propDir));
        const hand = childOf(lower, 'Hand');
        const fore = norm(sub(hand >= 0 ? rest[hand] : rest[lower], rest[lower]));
        out.set(upper, turn);
        // 前臂：烤之前是伸直的（跟着上臂转过去），再转到水平朝前，绕前臂拧到手心朝地（T-pose 手心朝下）——
        // 只转过去的话，反向的那一个手是侧着立在地上的，大拇指戳到地底下
        const ahead = local(fwd);
        const swing = quatBetween(fore, ahead);
        const flat = (d: V3) => {
          const k = d[0] * ahead[0] + d[1] * ahead[1] + d[2] * ahead[2];
          return norm(sub(d, [ahead[0] * k, ahead[1] * k, ahead[2] * k]));
        };
        const palm = flat(rotate(swing, [0, -1, 0]));
        const ground = flat(local([0, -1, 0]));
        const twist = Math.atan2(cross(palm, ground).reduce((sum, c, i) => sum + c * ahead[i], 0), palm[0] * ground[0] + palm[1] * ground[1] + palm[2] * ground[2]);
        out.set(lower, quatMul(quatConj(turn), quatMul(axisAngle(ahead, twist), swing)));
      } else free.push(upper);
    }
    // 上面那只手（照侧躺参考：手掌撑在胸前的地上）：手臂伸直往下、往前斜，斜到手心刚好够到地，手腕弯过来手心贴地。
    // 地面在撑着的胳膊肘底下（胳膊肘那一圈粗约 ELBOW_R）
    const elbowY = props.length ? Math.min(...props.map((u) => rotate(world, sub(rest[u], pivot))[1] + PROP_UPPER[1] * dist(rest[childOf(u, 'LowerArm')], rest[u]))) : 0;
    for (const upper of free) {
      const lower = childOf(upper, 'LowerArm');
      const hand = childOf(lower, 'Hand');
      const reach = dist(rest[lower], rest[upper]) + (hand >= 0 ? dist(rest[hand], rest[lower]) + PALM_REACH : 0.25);
      const height = rotate(world, sub(rest[upper], pivot))[1] - (elbowY - ELBOW_R) + HAND_SINK;
      const drop = Math.min(1, Math.max(0.2, height / reach));
      const head = rotate(world, [0, 1, 0]);
      const along = norm([head[0], 0, head[2]]);
      // 好几对手臂的：越往下的那对越往自己头那边偏，不和另一个上半身的手在腰那儿交叉
      const d = norm(add(add([0, -drop, 0], mul(fwd, Math.sqrt(1 - drop * drop))), mul(along, FREE_TOWARD_HEAD + ARM_FAN * 2 * ordinal(names[upper])[1])));
      const target = local(d);
      const swing = quatBetween(norm(sub(rest[lower], rest[upper])), target);
      // 绕手臂拧到手心朝地，再弯手腕让手掌平贴地面、指尖朝前
      const perp = (v: V3, axis: V3) => {
        const k = dot(v, axis);
        return norm(sub(v, mul(axis, k)));
      };
      const palm = perp(rotate(swing, [0, -1, 0]), target);
      const ground = perp(local([0, -1, 0]), target);
      const twist = Math.atan2(dot(cross(palm, ground), target), dot(palm, ground));
      const turn = quatMul(axisAngle(target, twist), swing);
      out.set(upper, turn);
      out.set(lower, [0, 0, 0, 1]);
      if (hand >= 0) {
        const level = local(norm([d[0], 0, d[2]]));
        const bend = quatBetween(target, level);
        out.set(hand, quatMul(quatConj(turn), quatMul(bend, turn)));
      }
    }
    // 头往正上方回正：只回正左右歪的那部分，回正一部分、有上限，脖子和头分着转（全压在脖子上，下巴就挤进领子里）
    const fix = uprightFix(local([0, 1, 0]));
    names.forEach((name, b) => {
      if (b >= total0) return;
      const share = /^Neck(\.\d+)?$/.test(name) ? NECK_SHARE : /^Head(\.\d+)?$/.test(name) ? 1 - NECK_SHARE : 0;
      if (share) out.set(b, quatMul(quatEuler(0, 0, fix * share), pose.get(b)?.rotation ?? [0, 0, 0, 1]));
    });
    return out;
  };
  const total0 = names.length;
  const flip0 = kind === 'same' ? quatEuler(0, 0, Math.PI) : quatEuler(Math.PI, 0, 0);
  // 侧躺：两个上半身照腰到脖子那条线对成一条直线（见 geometry/lieLine.ts）
  const { first: lineUp, second: lineUpB } = lineUpTurns(norm(sub(rest[find('Neck')], pivot)), flip0);
  const rootLie = quatMul(quatEuler(0, 0, Math.PI / 2), lineUp);
  const secondLie = quatMul(rootLie, quatMul(lineUpB, flip0));
  /** 平躺：手臂顺着身子两边放在地上（world：这个上半身 → 世界的旋转），肘伸直 */
  const flatRoot = quatEuler(-Math.PI / 2, 0, 0);
  const flatPose = (world: Quat): Map<number, Quat> => {
    const out = new Map<number, Quat>();
    const down = rotate([-world[0], -world[1], -world[2], world[3]], [0, -1, 0]);
    for (const upper of upperArms) {
      const lower = childOf(upper, 'LowerArm');
      if (lower < 0) continue;
      const target = norm(add([sideOf(upper) * FLAT_SPREAD, -1, 0], [down[0] * FLAT_DROP, down[1] * FLAT_DROP, down[2] * FLAT_DROP]));
      out.set(upper, quatBetween(norm(sub(rest[lower], rest[upper])), target));
      out.set(lower, [0, 0, 0, 1]);
    }
    return out;
  };
  /** 第一个上半身的姿势 */
  const front1 = new Map<number, Quat>();
  if (posture === 'prone') {
    for (const upper of upperArms) for (const [b, q] of armPose(upper, [splayOf(upper), 0, 1], [0, 1, 0])) front1.set(b, q);
    for (const [b, q] of liftPose()) front1.set(b, q);
  } else if (posture === 'lie') {
    for (const [b, q] of liePose(rootLie)) front1.set(b, q);
  } else if (posture === 'flat') {
    for (const [b, q] of flatPose(flatRoot)) front1.set(b, q);
  }

  /* ---- 2. 腰往上复制一份，绕腰转 180° ---- */
  const flip = kind === 'same' ? quatEuler(0, 0, Math.PI) : quatEuler(Math.PI, 0, 0);
  const turnPoint = (p: V3): V3 => add(pivot, rotate(flip, sub(p, pivot)));
  const count = new Map<string, number>();
  for (const name of names) {
    const [base] = ordinal(name);
    count.set(base, (count.get(base) ?? 0) + 1);
  }
  const copyOf = new Map<number, number>([[hips, hips]]);
  const total = names.length;
  for (let b = 0; b < total; b++) {
    if (b === hips || marker[b]) continue;
    const [base, k] = ordinal(names[b]);
    copyOf.set(b, names.length);
    names.push(nthName(base, (count.get(base) ?? 0) + k));
    origin.push(origin[b]);
    marker.push(false);
    parent.push(-2);
    rest.push(turnPoint(rest[b]));
  }
  for (const [b, c] of copyOf) if (b !== hips) parent[c] = parent[b] < 0 ? -1 : (copyOf.get(parent[b]) ?? hips);
  const original = chunks.length;
  for (let n = 0; n < original; n++) {
    const from = chunks[n];
    if (!from.indices.length) continue;
    const used = new Map<number, number>();
    for (const v of from.indices) if (!used.has(v)) used.set(v, used.size);
    const m = used.size;
    const made: Chunk = {
      name: `${from.name}_Conjoined`,
      material: from.material,
      positions: new Float32Array(m * 3),
      normals: new Float32Array(m * 3),
      uvs: new Float32Array(m * 2),
      joints: new Uint16Array(m * 4),
      weights: new Float32Array(m * 4),
      indices: Uint32Array.from(from.indices, (v) => used.get(v)!),
    };
    for (const [v, id] of used) {
      made.positions.set(turnPoint([from.positions[v * 3], from.positions[v * 3 + 1], from.positions[v * 3 + 2]]), id * 3);
      made.normals.set(rotate(flip, [from.normals[v * 3], from.normals[v * 3 + 1], from.normals[v * 3 + 2]]), id * 3);
      made.uvs.set(from.uvs.subarray(v * 2, v * 2 + 2), id * 2);
      made.weights.set(from.weights.subarray(v * 4, v * 4 + 4), id * 4);
      for (let k = 0; k < 4; k++) made.joints[id * 4 + k] = copyOf.get(from.joints[v * 4 + k]) ?? hips;
    }
    chunks.push(made);
  }

  /* ---- 3. 两个上半身的姿势 ---- */
  // 第二个照第一个的转法转（换到它自己的朝向：绕 flip 共轭）。反向的手臂往它自己身后伸、头不抬
  const second = new Map<number, Quat>();
  for (const [b, q] of pose) if (q.rotation && copyOf.has(b) && b !== hips) second.set(copyOf.get(b)!, q.rotation);
  const own = (() => {
    if (posture === 'lie') return liePose(secondLie);
    if (posture === 'flat') {
      // 平躺：反向的那个趴着，头抬起来一点（不然脸埋在地里）
      const out = flatPose(quatMul(flatRoot, flip0));
      if (kind === 'opposite') for (const [b, q] of liftPose()) out.set(b, q);
      return out;
    }
    const out = new Map<number, Quat>();
    // 站着：第二个上半身倒立在下面，手举过头（它自己的 +Y）撑地，手指朝前
    // 标准的倒立：手臂伸直、竖直、和肩同宽，肩膀撑到最高，头离地远远的
    if (posture === 'stand') {
      for (const upper of upperArms) {
        const across = sideOf(upper) * (HANDSTAND_SPLAY + ARM_FAN * ordinal(names[upper])[1]);
        for (const [b, q] of armPose(upper, [across, 1, 0], [0, 0, 1])) out.set(b, q);
      }
      // 头往胸口收（低头含胸），头的最低处离地远些
      names.forEach((name, b) => {
        if (/^Neck(\.\d+)?$/.test(name) && b < total0) out.set(b, quatMul(quatEuler(HANDSTAND_TUCK, 0, 0), pose.get(b)?.rotation ?? [0, 0, 0, 1]));
      });
    }
    else if (kind === 'same') return front1;
    else for (const upper of upperArms) for (const [b, q] of armPose(upper, [splayOf(upper), 0, -1], [0, 1, 0])) out.set(b, q);
    return out;
  })();
  for (const [b, q] of own) second.set(copyOf.get(b)!, q);
  for (const [b, q] of front1) pose.set(b, { ...pose.get(b), rotation: q });
  for (const [c, q] of second) pose.set(c, { ...pose.get(c), rotation: quatMul(flip, quatMul(q, quatConj(flip))) });
  // 侧躺：第二个上半身绕腰那一点转过去对齐（脊柱第一节的起点不在那一点上，跟着挪一点）
  const spineB = copyOf.get(spine);
  if (posture === 'lie' && spineB !== undefined) {
    const at = rest[spineB];
    const moved = add(pivot, rotate(lineUpB, sub(at, pivot)));
    pose.set(spineB, { ...pose.get(spineB), rotation: quatMul(lineUpB, pose.get(spineB)?.rotation ?? [0, 0, 0, 1]), move: sub(moved, at) });
  }
  const handsOf = (map: (b: number) => number) => names.slice(0, total).flatMap((name, b) => (/^Hand_[LR](\.\d+)?$/.test(name) && !marker[b] ? [map(b)] : []));
  return { pivot, hands: [handsOf((b) => b), handsOf((b) => copyOf.get(b)!)], turn: posture === 'prone' ? quatEuler(Math.PI / 2, 0, 0) : posture === 'lie' ? rootLie : posture === 'flat' ? flatRoot : null, level: posture === 'prone' && kind === 'opposite', palms: posture === 'prone' || posture === 'stand' };
}

/**
 * 第 4 步（姿势烤完以后）：整个人绕腰往前趴下 90°；反向的两头的手不一样低，绕左右的轴歪一点，四只手都踩到地上。
 * 落到地面上（最低点 = 0）留给 assemble.ts 最后那一步
 */
export function layDown(w: ConjoinWork, laid: Laid): number | null {
  const { pivot, hands } = laid;
  const { chunks, rest } = w;
  const turnAll = (q: Quat, at: V3) => {
    for (const chunk of chunks) {
      for (let v = 0; v < chunk.positions.length / 3; v++) {
        chunk.positions.set(add(at, rotate(q, sub([chunk.positions[v * 3], chunk.positions[v * 3 + 1], chunk.positions[v * 3 + 2]], at))), v * 3);
        chunk.normals.set(rotate(q, [chunk.normals[v * 3], chunk.normals[v * 3 + 1], chunk.normals[v * 3 + 2]]), v * 3);
      }
    }
    for (let b = 0; b < rest.length; b++) rest[b] = add(at, rotate(q, sub(rest[b], at)));
  };
  if (laid.turn) turnAll(laid.turn, pivot);
  // 两头的手：落在手（连手指）上的顶点最低到哪、平均在前后哪里
  const sets = hands.map((list) => {
    const set = new Set(list);
    for (let i = 0; i < w.names.length; i++) if (w.parent[i] >= 0 && set.has(w.parent[i])) set.add(i);
    for (let pass = 0; pass < 4; pass++) for (let i = 0; i < w.names.length; i++) if (w.parent[i] >= 0 && set.has(w.parent[i])) set.add(i);
    return set;
  });
  /** 两头的手：落在手上的点最低到哪、平均在前后哪里 */
  const measure = () =>
    sets.map((set) => {
      let low = Infinity;
      let z = 0;
      let n = 0;
      for (const chunk of chunks) {
        for (let v = 0; v < chunk.positions.length / 3; v++) {
          let on = 0;
          for (let k = 0; k < 4; k++) if (set.has(chunk.joints[v * 4 + k])) on += chunk.weights[v * 4 + k];
          if (on < 0.5) continue;
          low = Math.min(low, chunk.positions[v * 3 + 1]);
          z += chunk.positions[v * 3 + 2];
          n++;
        }
      }
      return { low, z: n ? z / n : 0, n };
    });
  for (let round = 0; round < 4 && laid.level; round++) {
    const stats = measure();
    if (stats.some((s) => !s.n)) break;
    const dy = stats[0].low - stats[1].low;
    const dz = stats[0].z - stats[1].z;
    if (Math.abs(dy) < 1e-4 || Math.abs(dz) < 1e-3) break;
    turnAll(quatEuler(Math.atan2(dy, dz), 0, 0), rest[w.names.indexOf('Hips')]);
  }
  // 落地照手心（袖口垂得比手心还低的，袖口那一点稍微插进地里，手心才贴着地）；躺着的照最低点
  if (!laid.palms) return null;
  const lows = measure().filter((s) => s.n).map((s) => s.low);
  return lows.length ? Math.min(...lows) : null;
}
