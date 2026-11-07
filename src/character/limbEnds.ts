/**
 * 成品角色的手指数、手脚互换（docs/digits-plan.md 第 5 期）。都照她自己的网格改，不自己捏：
 * - 手指多了：照她自己的无名指复制几根，排在无名指和小指之间，小指往外挪；少了：拿掉的那根缩回指根，小指往里挪；
 * - 手臂接脚：把她自己的脚（连鞋）复制一份，缩到手腕那么粗，接在手腕上（手臂垂下来时鞋底朝下、鞋尖朝前），
 *   前臂的断口收进鞋口里；她自己的手不要了；
 * - 腿接手：把她自己的手复制一份，手腕照她自己的权重往手背那边弯 90°、拇指收拢，放大到脚踝那么粗，
 *   手心朝下贴地、手指朝前；她自己的脚（连鞋）不要了。手比鞋矮，整个人照最低点落到地面上（见 assemble.ts）。
 *
 * 在复制手臂、腿之前改她自己那一对：多出来的手臂、腿是照改过的复制的。只在 T-pose 的原样上改（手臂平举、腿竖直）。
 * 纯函数（改的是传进来的工作副本），在 Web Worker 和单元测试里都能跑。
 */
import { PALM_AHEAD, swapPlace } from '../anime/swap';
import type { V3 } from '../geometry/vec';
import type { BoneOrigin } from './assemble';
import type { Chunk } from './source';

/** 拼角色时一路往里加、往上改的那几样（见 assemble.ts 的「骨架和网格的工作副本」） */
export interface LimbWork {
  names: string[];
  parent: number[];
  rest: V3[];
  origin: (BoneOrigin | null)[];
  marker: boolean[];
  chunks: Chunk[];
  /** 角色本来的网格有几块：只改、只复制这几块 */
  original: number;
  /** 这块网格是不是皮肤：手接到腿上只复制皮肤（袖口挂在手上的那一截不要，不然一起弯过去摊在地上） */
  skin: (chunk: Chunk) => boolean;
}

/** 脚接到手臂上缩多少（脚踝比手腕粗）；手接到腿上放大多少 */
const FOOT_ON_ARM = 0.8;
const HAND_ON_LEG = 1.2;
/** 脚接到手臂上时，只复制平均权重这么多以上落在脚上的三角面 */
const SHOE_ONLY = 0.85;
/** 脚接到手臂上时整个往肩膀那边挪多少（米）：前臂的断口收进鞋口里 */
const SHOE_SWALLOW = 0.02;
/** 手接到腿上时整个往上挪多少（米）：手腕的断口收进裤腿、袜口里 */
const CUFF_SWALLOW = 0.01;
/** 拇指收到和四指只差这么多（弧度），见 anime/swap.ts 的 THUMB_SPREAD */
const THUMB_SPREAD = 0.35;
/** 多出来的手指之间隔多远（无名指到小指那一段的几成） */
const EXTRA_GAP = 0.85;

const SIDES = [1, -1] as const;
const tag = (side: number) => (side > 0 ? 'L' : 'R');

/** 绕过 at、方向是 axis（单位向量）的轴转 angle */
function turnAbout(p: V3, at: V3, axis: V3, angle: number): V3 {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const d: V3 = [p[0] - at[0], p[1] - at[1], p[2] - at[2]];
  const k = axis[0] * d[0] + axis[1] * d[1] + axis[2] * d[2];
  const x: V3 = [axis[1] * d[2] - axis[2] * d[1], axis[2] * d[0] - axis[0] * d[2], axis[0] * d[1] - axis[1] * d[0]];
  return [0, 1, 2].map((i) => at[i] + d[i] * c + x[i] * s + axis[i] * k * (1 - c)) as V3;
}

export function reshapeLimbEnds(w: LimbWork, spec: { fingers: number; armEnd: 'hand' | 'foot'; legEnd: 'hand' | 'foot' }, humanLegs: boolean): void {
  const { names, parent, rest, origin, marker, chunks } = w;
  const find = (name: string) => names.indexOf(name);
  const subtree = (root: number): number[] => {
    const list = [root];
    for (let i = 0; i < list.length; i++) for (let b = 0; b < parent.length; b++) if (parent[b] === list[i]) list.push(b);
    return list;
  };
  /** 一个顶点有多少权重落在 set 上 */
  const shareOf = (chunk: Chunk, v: number, set: ReadonlySet<number>) => {
    let sum = 0;
    for (let k = 0; k < 4; k++) if (chunk.weights[v * 4 + k] && set.has(chunk.joints[v * 4 + k])) sum += chunk.weights[v * 4 + k];
    return sum;
  };
  /** 一个三角面平均有多少权重落在 set 上 */
  const triShare = (chunk: Chunk, t: number, set: ReadonlySet<number>) =>
    (shareOf(chunk, chunk.indices[t], set) + shareOf(chunk, chunk.indices[t + 1], set) + shareOf(chunk, chunk.indices[t + 2], set)) / 3;

  /**
   * 把角色本来的网格里落在 set 上（平均权重过半）的三角面去掉；没有面用到的点也去掉
   * （不然它们的权重还挂在去掉的骨骼上，那几根骨骼就清不掉）
   */
  const remove = (set: ReadonlySet<number>, skinOnly = false) => {
    for (let n = 0; n < w.original; n++) {
      const chunk = chunks[n];
      if (skinOnly && !w.skin(chunk)) continue;
      const keep: number[] = [];
      for (let t = 0; t < chunk.indices.length; t += 3) if (triShare(chunk, t, set) < 0.5) keep.push(chunk.indices[t], chunk.indices[t + 1], chunk.indices[t + 2]);
      if (keep.length === chunk.indices.length) continue;
      const remap = new Map<number, number>();
      for (const v of keep) if (!remap.has(v)) remap.set(v, remap.size);
      const count = remap.size;
      const made: Chunk = {
        ...chunk,
        positions: new Float32Array(count * 3),
        normals: new Float32Array(count * 3),
        uvs: new Float32Array(count * 2),
        joints: new Uint16Array(count * 4),
        weights: new Float32Array(count * 4),
        indices: Uint32Array.from(keep, (v) => remap.get(v)!),
        ...(chunk.faceVertex ? { faceVertex: new Int32Array(count) } : {}),
      };
      for (const [v, id] of remap) {
        made.positions.set(chunk.positions.subarray(v * 3, v * 3 + 3), id * 3);
        made.normals.set(chunk.normals.subarray(v * 3, v * 3 + 3), id * 3);
        made.uvs.set(chunk.uvs.subarray(v * 2, v * 2 + 2), id * 2);
        made.joints.set(chunk.joints.subarray(v * 4, v * 4 + 4), id * 4);
        made.weights.set(chunk.weights.subarray(v * 4, v * 4 + 4), id * 4);
        if (chunk.faceVertex) made.faceVertex![id] = chunk.faceVertex[v];
      }
      chunks[n] = made;
    }
  };

  /**
   * 把角色本来的网格里落在 set 上（平均权重过半）的三角面复制一份，加在最后：
   * 每个点照 place 搬（on 问这个点有多少权重落在某一组骨骼上），法线跟着搬；权重照 boneOf 换成新的骨骼
   */
  const transplant = (
    set: ReadonlySet<number>,
    label: string,
    place: (p: V3, on: (s: ReadonlySet<number>) => number) => V3,
    boneOf: (bone: number) => number,
    skinOnly = false,
    threshold = 0.5,
  ) => {
    for (let n = 0; n < w.original; n++) {
      const from = chunks[n];
      if (skinOnly && !w.skin(from)) continue;
      const remap = new Map<number, number>();
      const indices: number[] = [];
      for (let t = 0; t < from.indices.length; t += 3) {
        if (triShare(from, t, set) < threshold) continue;
        for (let k = 0; k < 3; k++) {
          const v = from.indices[t + k];
          let id = remap.get(v);
          if (id === undefined) {
            id = remap.size;
            remap.set(v, id);
          }
          indices.push(id);
        }
      }
      if (!indices.length) continue;
      const count = remap.size;
      const made: Chunk = {
        name: `${from.name}_${label}`,
        material: from.material,
        positions: new Float32Array(count * 3),
        normals: new Float32Array(count * 3),
        uvs: new Float32Array(count * 2),
        joints: new Uint16Array(count * 4),
        weights: new Float32Array(count * 4),
        indices: Uint32Array.from(indices),
      };
      for (const [v, id] of remap) {
        const on = (s: ReadonlySet<number>) => shareOf(from, v, s);
        const p: V3 = [from.positions[v * 3], from.positions[v * 3 + 1], from.positions[v * 3 + 2]];
        const q = place(p, on);
        made.positions.set(q, id * 3);
        // 法线：顺着法线挪一点点再搬，看搬过去以后朝哪
        const e = 1e-4;
        const r = place([p[0] + from.normals[v * 3] * e, p[1] + from.normals[v * 3 + 1] * e, p[2] + from.normals[v * 3 + 2] * e], on);
        const d: V3 = [r[0] - q[0], r[1] - q[1], r[2] - q[2]];
        const l = Math.hypot(d[0], d[1], d[2]) || 1;
        made.normals.set([d[0] / l, d[1] / l, d[2] / l], id * 3);
        made.uvs[id * 2] = from.uvs[v * 2];
        made.uvs[id * 2 + 1] = from.uvs[v * 2 + 1];
        let filled = 0;
        for (let k = 0; k < 4; k++) {
          const wt = from.weights[v * 4 + k];
          if (!wt) continue;
          const bone = boneOf(from.joints[v * 4 + k]);
          let slot = 0;
          while (slot < filled && made.joints[id * 4 + slot] !== bone) slot++;
          if (slot === filled) made.joints[id * 4 + filled++] = bone;
          made.weights[id * 4 + slot] += wt;
        }
      }
      chunks.push(made);
    }
  };

  /** 加一根骨骼（复制 from 那根的来历），返回下标 */
  const addBone = (name: string, from: number, up: number, at: V3) => {
    names.push(name);
    origin.push(origin[from]);
    marker.push(marker[from]);
    parent.push(up);
    rest.push(at);
    return names.length - 1;
  };
  /** 网格里所有落在 set 上的点照权重挪 move（连关节） */
  const shift = (set: ReadonlySet<number>, move: V3) => {
    for (let n = 0; n < w.original; n++) {
      const chunk = chunks[n];
      for (let v = 0; v < chunk.positions.length / 3; v++) {
        const s = shareOf(chunk, v, set);
        if (s) for (let i = 0; i < 3; i++) chunk.positions[v * 3 + i] += move[i] * s;
      }
    }
    for (const b of set) for (let i = 0; i < 3; i++) rest[b][i] += move[i];
  };

  /** 两边各自的手、脚：骨骼、手腕和脚踝在哪 */
  const limbs = SIDES.flatMap((side) => {
    const [hand, lowerArm, foot, lowerLeg] = ['Hand', 'LowerArm', 'Foot', 'LowerLeg'].map((b) => find(`${b}_${tag(side)}`));
    if (hand < 0 || foot < 0 || lowerArm < 0 || lowerLeg < 0) return [];
    return [{ side, hand, lowerArm, foot, lowerLeg, wrist: [...rest[hand]] as V3, ankle: [...rest[foot]] as V3, footSet: new Set(subtree(foot).filter((b) => /^(Foot|Toe)/.test(names[b]))) }];
  });
  const armFoot = spec.armEnd === 'foot';
  const legHand = spec.legEnd === 'hand' && humanLegs;

  /* ---- 第一步，手指数：有手（手臂上的，或者要接到腿上去的）才改 ---- */
  if ((!armFoot || legHand) && spec.fingers !== 5) {
    for (const { side } of limbs) {
      const fingerRoot = (f: string) => find(`${f}1_${tag(side)}`);
      const ring = fingerRoot('Ring');
      const little = fingerRoot('Little');
      const middle = fingerRoot('Middle');
      if (ring < 0 || little < 0 || middle < 0) continue;
      if (spec.fingers < 5) {
        // 少了：先拿掉无名指，再拿掉中指。拿掉的那根照权重缩回指根，小指往里挪到它的位置上
        const gone = spec.fingers === 4 ? [ring] : [middle, ring];
        for (const f of gone) {
          const set = new Set(subtree(f));
          const knuckle: V3 = [...rest[f]];
          for (let n = 0; n < w.original; n++) {
            const chunk = chunks[n];
            for (let v = 0; v < chunk.positions.length / 3; v++) {
              const s = shareOf(chunk, v, set);
              if (!s) continue;
              for (let i = 0; i < 3; i++) chunk.positions[v * 3 + i] += (knuckle[i] - chunk.positions[v * 3 + i]) * s;
              // 权重归到手上：这根手指的骨骼就没用了，最后清掉
              for (let k = 0; k < 4; k++) if (set.has(chunk.joints[v * 4 + k])) chunk.joints[v * 4 + k] = parent[f];
            }
          }
          for (const b of set) marker[b] = true;
        }
        const to = rest[gone[0]];
        const from = rest[little];
        shift(new Set(subtree(little)), [(to[0] - from[0]) * 0.8, (to[1] - from[1]) * 0.8, (to[2] - from[2]) * 0.8]);
      } else {
        // 多了：照无名指复制，排在无名指和小指之间；小指往外让开
        const extra = spec.fingers - 5;
        const gap: V3 = [0, 1, 2].map((i) => (rest[little][i] - rest[ring][i]) * EXTRA_GAP) as V3;
        const ringSet = new Set(subtree(ring));
        shift(new Set(subtree(little)), [gap[0] * extra, gap[1] * extra, gap[2] * extra]);
        for (let j = 1; j <= extra; j++) {
          const move: V3 = [gap[0] * j, gap[1] * j, gap[2] * j];
          const letter = 'ABC'[j - 1];
          const map = new Map<number, number>();
          for (const b of subtree(ring)) {
            map.set(b, addBone(names[b].replace(/^Ring/, `Finger${letter}`), b, b === ring ? parent[ring] : map.get(parent[b])!, [rest[b][0] + move[0], rest[b][1] + move[1], rest[b][2] + move[2]]));
          }
          transplant(ringSet, `Finger${letter}_${tag(side)}`, (p) => [p[0] + move[0], p[1] + move[1], p[2] + move[2]], (b) => map.get(b) ?? b);
        }
      }
    }
    // 复制出来的手指也算她自己的手：下面接到腿上时一起复制
    w.original = chunks.length;
  }

  /* ---- 第二步，复制（都照她本来的手、脚复制，在去掉之前） ---- */
  for (const { side, hand, lowerArm, foot, lowerLeg, wrist, ankle, footSet } of limbs) {
    // 腿接手：她自己的手接到脚踝上，手心朝下、手指朝前
    if (legHand) {
      const out = side;
      const handSet = new Set(subtree(hand));
      // 拇指往四指那边收：手上 side·X 朝外（手指）、+Z 朝拇指，绕手心的法线（Y）转
      const thumb = find(`Thumb1_${tag(side)}`);
      const thumbSet = new Set(thumb >= 0 ? subtree(thumb) : []);
      let tuck = 0;
      if (thumb >= 0) {
        const tip = subtree(thumb).at(-1)!;
        tuck = Math.max(0, Math.PI / 2 - THUMB_SPREAD - Math.atan2(out * (rest[tip][0] - rest[thumb][0]), rest[tip][2] - rest[thumb][2]));
      }
      const thumbAt: V3 = thumb >= 0 ? [...rest[thumb]] : wrist;
      // 手腕往手背那边弯 90°：绕过手腕、沿 Z 的轴，左手正着转、右手反着转（手指转到 +Y）。照权重转一部分，手腕那一圈不塌
      const bend = (p: V3, on: number, thumbOn: number): V3 => {
        const tucked = thumbOn ? turnAbout(p, thumbAt, [0, 1, 0], out * tuck * thumbOn) : p;
        return turnAbout(tucked, wrist, [0, 0, 1], (out * Math.PI * on) / 2);
      };
      // 弯好的手：前臂朝 side·X 的反方向，手指朝 +Y。摆到脚踝上：前臂竖着朝上，手指朝前（往外撇一点），手心贴地
      const ahead: V3 = [out * PALM_AHEAD[0], PALM_AHEAD[1], PALM_AHEAD[2]];
      const end: V3 = [ankle[0], ankle[1] + CUFF_SWALLOW, ankle[2]];
      const { matrix, offset } = swapPlace({ end: wrist, root: [wrist[0] - out, wrist[1], wrist[2]], ahead: [0, 1, 0] }, { end, root: [end[0], end[1] + 1, end[2]], ahead }, HAND_ON_LEG);
      const onLeg = (p: V3): V3 => [0, 1, 2].map((i) => matrix[i * 3] * p[0] + matrix[i * 3 + 1] * p[1] + matrix[i * 3 + 2] * p[2] + offset[i]) as V3;
      // 手指的骨骼：复制一份挂在脚那根骨骼上，名字前面加 Leg（LegThumb1_L …）；手那根就是脚那根
      const map = new Map<number, number>([[hand, foot]]);
      for (const b of subtree(hand)) {
        if (b === hand || !/^(Thumb|Index|Middle|Ring|Little|Finger[A-C])/.test(names[b])) continue;
        map.set(b, addBone(`Leg${names[b]}`, b, map.get(parent[b]) ?? foot, onLeg(bend(rest[b], 1, thumbSet.has(b) ? 1 : 0))));
      }
      transplant(handSet, `HandOnLeg_${tag(side)}`, (p, on) => onLeg(bend(p, on(handSet), on(thumbSet))), (b) => map.get(b) ?? (b === lowerArm ? lowerLeg : foot), true);
    }
    // 手臂接脚：她自己的脚（连鞋）接到手腕上。腿上的脚是脚踝正上方是腿、脚尖朝前；
    // 换到手臂上：顺着手臂往外当作往下，脚尖还朝前，往肩膀那边挪一点，前臂的断口收进鞋口
    if (armFoot) {
      const end: V3 = [wrist[0] - side * SHOE_SWALLOW, wrist[1], wrist[2]];
      const { matrix, offset } = swapPlace({ end: ankle, root: [ankle[0], ankle[1] + 1, ankle[2]], ahead: [0, 0, 1] }, { end, root: [end[0] - side, end[1], end[2]], ahead: [0, 0, 1] }, FOOT_ON_ARM);
      const place = (p: V3): V3 => [0, 1, 2].map((i) => matrix[i * 3] * p[0] + matrix[i * 3 + 1] * p[1] + matrix[i * 3 + 2] * p[2] + offset[i]) as V3;
      // 只要几乎整个跟着脚的（鞋、脚）：裤脚、袜口挂在脚上的那一点碎边不要
      transplant(footSet, `FootOnArm_${tag(side)}`, place, (b) => (b === lowerLeg ? lowerArm : hand), false, SHOE_ONLY);
    }
  }

  /* ---- 第三步，去掉被换掉的手、脚（只动她本来的网格，刚复制出来的不动） ---- */
  for (const { hand, foot, footSet } of limbs) {
    if (armFoot) {
      const handSet = new Set(subtree(hand));
      // 只去掉手（皮肤）：袖口挂在手上的那一截留着，不然切出一圈碎边；鞋口套在它外面
      remove(handSet, true);
      // 手指的骨骼不要了：留下来的袖口上挂在手指上的那一点权重归到手上，骨骼只当标记，最后不导出
      for (let n = 0; n < w.original; n++) {
        const joints = chunks[n].joints;
        for (let i = 0; i < joints.length; i++) if (joints[i] !== hand && handSet.has(joints[i])) joints[i] = hand;
      }
      for (const b of handSet) if (b !== hand) marker[b] = true;
    }
    if (legHand) {
      remove(footSet);
      for (const b of footSet) if (b !== foot) marker[b] = true;
    }
  }
  w.original = chunks.length;
}
