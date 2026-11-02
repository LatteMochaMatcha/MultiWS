/**
 * 自动蒙皮：给网格的每个顶点算出它跟着哪几根骨骼动、各占多少。
 * 纯函数，在 Web Worker 和单元测试里都能跑。
 *
 * 做法分两层，为的是不让权重「串门」（手垂在大腿旁边时，手上的顶点不该跟着大腿骨动）：
 * 1. 先看顶点属于哪个部件：离哪个部件自己的表面最近就算哪个；在两个部件的交界处，
 *    按离各自表面的远近平滑过渡。
 *    「交界处」是照着网格的表面量的：别的部件的份额只从它自己那片表面沿着网格往外传一小段。
 *    两个部件只是挨得近、表面并不连着的地方（两条小腿的内侧、垂在胯旁边的前臂、聚在一个肩膀上的几条手臂）互不相干；
 *    光按直线距离算的话，那里会带上隔壁百分之几的权重，一摆姿势就被隔壁拽出一个包。
 * 2. 再在这个部件自己的骨骼里分：离哪节骨骼近就多跟哪节，关节附近两节各占一些。
 *    没有骨骼的部件（胸、角、眼睛）用它父部件的骨骼。
 * 3. 接在同一根骨骼上的几个同类部件（聚在一个肩膀上的几条手臂、两条腿、从一个尾根散开的几条尾巴）挤在一起的地方：
 *    各自最靠根的那节骨骼（锁骨、大腿、尾巴的第一节）的份额，照被挤的程度让给那根共同的父骨骼。
 *    不然那里六七根骨骼各占差不多，留哪 4 根全看零头，隔壁的顶点一换人，表面就拧成麻花。
 *    效果是：几条手臂的根融在一起的那一团跟着躯干，两条腿中间那一道跟着胯；手臂、腿各自伸出去以后才各跟各的。
 * 每个顶点最多留 4 根骨骼，权重加起来是 1。
 * 权重在表面上是连续的：相邻两个顶点的权重要是差一截，摆姿势时那里就会裂开一道缝。
 * 所以排在后面的骨骼不是直接砍掉，而是所有的都减去同一个门槛再比（见下面第 4 步）。
 *
 * 手指是并排着的几「股」骨骼（Bone.strand）：一个顶点主要跟着离它最近的那一股，别的股按远近压得很低，
 * 不然食指弯的时候会把旁边的中指带歪。带着几股的那根骨骼（手）除了自己那一段，
 * 从它的关节到每一股的根也算它的地盘：手掌边上的顶点不会因为离指根近就跟着手指走。
 */
import { graftMeshOf } from '../anime/grafts';
import { type Figure, type Part, worldTransforms } from '../geometry/figure';
import { type CompiledField, compilePartField, fieldAt } from '../sdf/field';
import type { FusedMesh } from '../sdf/surfaceNets';
import type { Skeleton } from './skeleton';

export interface SkinWeights {
  /** 每个顶点 4 个骨骼下标（Skeleton.bones 里的位置） */
  joints: Uint16Array;
  /** 对应的 4 个权重，加起来是 1；用不满 4 根时多余的是 0 */
  weights: Float32Array;
}

/** 部件交界处过渡带的宽度（按标准人台的尺寸） */
const BAND = 0.04;
/**
 * 别的部件的份额沿着表面能传多远（BAND 的倍数）：离它自己那片表面这么远以内不打折，再远渐渐减到没有。
 * 交界处两个部件的表面常常是斜着分开的（腋下、大腿根），沿表面走出去的路比直线距离长，所以放宽到几倍
 */
const REACH_NEAR = 1;
const REACH_FAR = 3;
/** 位置差不到这么多的顶点当成同一个（硬边、接缝两侧各有一份的顶点） */
const WELD = 1e-4;
/** 每个顶点最多跟几根骨骼 */
const INFLUENCES = 4;
/** 权重不到最重那根的这个比例的骨骼直接丢掉 */
const TRIM = 0.02;
/**
 * 好几个上半身时，长在不同上半身上的部件（胸、头、手臂）挨在一起的地方：离躯干表面 near 以内照常过渡，到 far 就不再分对方的份额。
 * 躯干上两个上半身连着的那一圈照常过渡（不然一摆姿势那里拉出一道棱）；挤在一起的两只胸、碰在一起的两个头离躯干远，
 * 各跟各的上半身——以前两边各占一半，一个上半身一弯，两只胸被扯成一根长条
 */
const APART: [near: number, far: number] = [0.005, 0.02];

interface Entry {
  field: CompiledField;
  /** 这个部件的网格跟着哪些骨骼动（Skeleton.bones 的下标） */
  bones: number[];
  /** bones 里每一根的父骨骼，要是那根父骨骼不在 bones 里的话（这一根就是这个部件最靠根的骨骼）；不然是 -1 */
  outer: Int32Array;
  /** 跟着同一批骨骼的部件算一伙（躯干和长在它上面、没有自己骨骼的胸是一伙） */
  group: number;
  /** bones 里每一根属于第几股（不成股的是 -1），以及一共几股 */
  strand: Int16Array;
  strands: number;
}

/**
 * 缝上去的现成网格（手）带着模型自己的蒙皮权重：把自动算出来的那一份里这些顶点的换成它的。
 * 找不到对应骨骼的（不该有）保持自动算的。
 */
export function bindGrafts(skin: SkinWeights, mesh: Pick<FusedMesh, 'bound'>, skeleton: Skeleton): SkinWeights {
  const bound = mesh.bound;
  if (!bound) return skin;
  const index = bound.bones.map((name) => skeleton.bones.findIndex((bone) => bone.name === name));
  const count = bound.joints.length / INFLUENCES;
  for (let i = 0; i < count; i++) {
    const v = bound.start + i;
    let known = true;
    for (let k = 0; k < INFLUENCES; k++) if (bound.weights[i * INFLUENCES + k] && index[bound.joints[i * INFLUENCES + k]] < 0) known = false;
    if (!known) continue;
    for (let k = 0; k < INFLUENCES; k++) {
      const weight = bound.weights[i * INFLUENCES + k];
      skin.joints[v * INFLUENCES + k] = weight ? index[bound.joints[i * INFLUENCES + k]] : 0;
      skin.weights[v * INFLUENCES + k] = weight;
    }
  }
  return skin;
}

/**
 * 分部件模式用：每个部件一张网格，顶点接在一起算的权重。部件上接的现成网格（手）排在这个部件的网格的最后，
 * 把那些顶点的权重换成手自己带的——和融合模式里的手一样摆，手指不会跟错骨骼。
 * meshes：每张网格是哪个部件的、有多少个顶点（顺序和算权重时接起来的顺序一样）。
 */
export function bindPartGrafts(
  skin: SkinWeights,
  figure: Pick<Figure, 'parts'>,
  skeleton: Skeleton,
  meshes: readonly { name: string; positions: ArrayLike<number> }[],
): SkinWeights {
  const byName = new Map(figure.parts.map((part) => [part.name, part]));
  let first = 0;
  for (const mesh of meshes) {
    const count = mesh.positions.length / 3;
    const grafts = byName.get(mesh.name)?.grafts ?? [];
    if (grafts.length) {
      // 接的网格排在这个部件的网格最后，一块接一块（顺序同 grafts）
      let start = first + count - grafts.reduce((sum, graft) => sum + graftMeshOf(graft.mesh).positions.length / 3, 0);
      for (const graft of grafts) {
        const hand = graftMeshOf(graft.mesh);
        if (start >= first) {
          const bound = { start, bones: hand.bones.map((bone) => graft.bones[bone] ?? ''), joints: Uint16Array.from(hand.joints), weights: hand.weights };
          bindGrafts(skin, { bound }, skeleton);
        }
        start += hand.positions.length / 3;
      }
    }
    first += count;
  }
  return skin;
}

/**
 * triangles：这些顶点连成的三角面（每 3 个下标一个）。给了才知道哪里的表面是连着的；
 * 不给的话，挨得近的部件都互相过渡（老办法）。
 * meshes：分部件模式用——顶点是一个个部件各自的网格接起来的（每张网格是哪个部件的、有多少个顶点）。
 * 分部件时各个部件是互相插着的几块壳，不是一张皮，照一张皮那样过渡会把壳扯破。所以：
 * - 一个部件自己的网格只跟着它自己的骨骼，和它接在上面的那些部件的骨骼（腿根跟着胯，插在躯干里的那一截不会被拔出来）。
 *   反过来不算：躯干的网格不跟着手臂、腿动——不然手臂一举，肩口那一块壳会被拽成一片破布。
 *   别的不相干的部件（另一条手臂、垂下来碰到的大腿）就算插在它里面，也不带着它动。
 * - 关节上的球（肩、肘、膝那里垫着的一个个球）整个跟着从这个关节伸出去的那节骨骼：
 *   球绕着自己的球心转，看上去还是原地那个球；要是一半跟着上一节、一半跟着下一节，球会被拧成一圈一圈的。
 * - 根上垫着球的部件（手臂；白模人台的腿）是球形关节：整个只跟自己的骨骼，绕着球心转，切口有球盖着。
 *   它的根要是还一半跟着躯干，手臂举过头顶时那一圈会缩成一个尖。
 */
export function skinVertices(
  figure: Pick<Figure, 'parts' | 'scale'>,
  skeleton: Skeleton,
  positions: ArrayLike<number>,
  triangles?: ArrayLike<number>,
  meshes?: readonly { name: string; positions: ArrayLike<number> }[],
): SkinWeights {
  const plan = planSkin(figure, skeleton, positions, triangles, meshes);
  const near = joinNear(plan, [nearParts(plan, 0, plan.count)]);
  const gate = gateNear(plan, near);
  const joints = new Uint16Array(plan.count * INFLUENCES);
  const weights = new Float32Array(plan.count * INFLUENCES);
  weighVertices(plan, near, gate, 0, plan.count, joints, weights);
  return finishSkin(plan, joints, weights);
}

/**
 * skinVertices 分成几步（见下面），每一步要用的都在这里：每个部件的距离场、骨骼线段、哪些顶点位置一样……
 * 第 1 步（nearParts）、第 3 步（weighVertices）是逐个顶点算的，各个顶点互不相干，可以拆成几段分给别的线程；
 * 同样的输入准备出来的这一份一模一样（见 planSkin），哪个线程算的结果都一样
 */
export interface SkinPlan {
  count: number;
  positions: ArrayLike<number>;
  triangles?: ArrayLike<number>;
  band: number;
  soft: number;
  entries: Entry[];
  groups: number;
  parentBone: Int32Array;
  kind: string[];
  sample: Int32Array;
  home: Int32Array;
  kin: Uint8Array;
  socket: Uint8Array;
  lead: Uint8Array;
  balls: { vertices: number[]; bone: number }[];
  groupOf: Uint16Array;
  /** 每一伙长在第几个上半身上（照 figure.parts 里那个上半身部件的位置；不在哪个上半身上的是 -1），见 APART */
  body: Int32Array;
  /** entries 里哪些是躯干 */
  torso: Uint8Array;
  /** 每个顶点由谁代表（位置一样的顶点只算一次） */
  rep: Int32Array;
  bones: number;
  mostStrands: number;
  /** 点到第 i 根骨骼（它的那一段或者几段）的距离的平方 */
  boneDist2: (i: number, x: number, y: number, z: number) => number;
}

export function planSkin(
  figure: Pick<Figure, 'parts' | 'scale'>,
  skeleton: Skeleton,
  positions: ArrayLike<number>,
  triangles?: ArrayLike<number>,
  meshes?: readonly { name: string; positions: ArrayLike<number> }[],
): SkinPlan {
  const count = Math.floor(positions.length / 3);
  const band = BAND * figure.scale;
  // 骨骼距离的平方里加上这一点，免得顶点正好落在骨骼上时除以零
  const soft = (0.004 * figure.scale) ** 2;

  const ownBones = new Map<string, number[]>();
  skeleton.bones.forEach((bone, i) => {
    const list = ownBones.get(bone.part);
    if (list) list.push(i);
    else ownBones.set(bone.part, [i]);
  });
  const byName = new Map(figure.parts.map((p) => [p.name, p]));
  const rootOnly = [0];
  const groupIds = new Map<number[], number>();
  const bonesFor = (part: Part): number[] => {
    for (let p: Part | undefined = part; p; p = p.parent ? byName.get(p.parent) : undefined) {
      const own = ownBones.get(p.name);
      if (own) return own;
    }
    // 既没有自己的骨骼、也没有父部件：跟着根骨骼
    return rootOnly;
  };
  const xfs = worldTransforms(figure);
  let mostStrands = 0;
  const entries: Entry[] = figure.parts
    .filter((part) => part.material !== 'eye')
    .map((part) => {
      const bones = bonesFor(part);
      const names: string[] = [];
      const strand = Int16Array.from(bones, (b) => {
        const name = skeleton.bones[b].strand;
        if (!name) return -1;
        const at = names.indexOf(name);
        return at >= 0 ? at : names.push(name) - 1;
      });
      mostStrands = Math.max(mostStrands, names.length);
      let group = groupIds.get(bones);
      if (group === undefined) groupIds.set(bones, (group = groupIds.size));
      const outer = Int32Array.from(bones, (b) => (bones.includes(skeleton.bones[b].parent) ? -1 : skeleton.bones[b].parent));
      return { field: compilePartField(part, xfs.get(part.name)!), bones, outer, group, strand, strands: names.length };
    });

  // 每一伙接在哪根骨骼上（它最靠根的那节骨骼的父骨骼；根骨骼所在的那一伙是 -1）、是哪一类部件（带着这些骨骼的那个部件的类型）、
  // 这一伙的骨骼看哪个部件的
  const groups = groupIds.size;
  const parentBone = new Int32Array(groups).fill(-1);
  const kind: string[] = new Array(groups).fill('');
  const sample = new Int32Array(groups).fill(-1);
  entries.forEach((entry, e) => {
    if (sample[entry.group] >= 0) return;
    sample[entry.group] = e;
    const first = skeleton.bones[entry.bones[0]];
    parentBone[entry.group] = first.parent;
    kind[entry.group] = byName.get(first.part)?.type ?? '';
  });

  // 分部件：每个顶点是哪一伙的网格上的（不知道就是 -1），它认哪几伙的骨骼
  const home = new Int32Array(count).fill(-1);
  const kin = new Uint8Array(groups * groups);
  const boneGroup = new Int32Array(skeleton.bones.length).fill(-1);
  for (const entry of entries) for (const b of entry.bones) boneGroup[b] = entry.group;
  if (meshes) {
    // kin[g * groups + h]：g 这一伙的网格认不认 h 这一伙的骨骼。认自己的，和一路往上接着的那几伙的
    for (let g = 0; g < groups; g++) {
      kin[g * groups + g] = 1;
      for (let b = parentBone[g]; b >= 0; b = skeleton.bones[b].parent) {
        const above = boneGroup[b];
        if (above >= 0) kin[g * groups + above] = 1;
      }
    }
    let first = 0;
    for (const mesh of meshes) {
      const part = byName.get(mesh.name);
      const group = part ? groupIds.get(bonesFor(part)) : undefined;
      const size = mesh.positions.length / 3;
      if (group !== undefined) home.fill(group, first, Math.min(count, first + size));
      first += size;
    }
  }

  // 骨骼线段：起点、方向、长度的平方。一根骨骼平时就是一段；带着几股的（手）另外多出几段：从它的关节到每一股的根
  const nb = skeleton.bones.length;
  const pieces: number[][] = skeleton.bones.map(() => []);
  const piece = (bone: number, from: readonly number[], to: readonly number[]) => {
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    pieces[bone].push(from[0], from[1], from[2], d[0], d[1], d[2], d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
  };
  skeleton.bones.forEach((bone, i) => {
    piece(i, bone.head, bone.tail);
    const up = skeleton.bones[bone.parent];
    if (bone.strand && up && !up.strand) piece(bone.parent, up.head, bone.head);
  });
  const first = new Int32Array(nb + 1);
  pieces.forEach((list, i) => (first[i + 1] = first[i] + list.length));
  const seg = Float64Array.from(pieces.flat());
  const boneDist2 = (i: number, x: number, y: number, z: number) => {
    let least = Infinity;
    for (let o = first[i]; o < first[i + 1]; o += 7) {
      const px = x - seg[o];
      const py = y - seg[o + 1];
      const pz = z - seg[o + 2];
      const l2 = seg[o + 6];
      let t = l2 > 0 ? (px * seg[o + 3] + py * seg[o + 4] + pz * seg[o + 5]) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - seg[o + 3] * t;
      const dy = py - seg[o + 4] * t;
      const dz = pz - seg[o + 5] * t;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < least) least = d2;
    }
    return least;
  };

  // 0) 位置一样的顶点只算一次（rep 是替它算的那个顶点）；沿表面找路时它们也是同一个点
  const rep = weld(positions, count, WELD * figure.scale, meshes ? home : undefined);

  // 分部件：关节上的球；根上垫着球的那几伙（socket）；最靠根、又整个在自己身体外面的骨骼（lead：锁骨在躯干里，
  // 手臂的网格从肩关节才开始）——球形关节的部件自己的网格不跟它
  const balls = meshes && triangles ? jointBalls(positions, triangles, rep, home, skeleton, figure.scale) : [];
  const socket = new Uint8Array(groups);
  const lead = new Uint8Array(skeleton.bones.length);
  if (balls.length) {
    const rootOf = (b: number, group: number) => boneGroup[b] === group && (skeleton.bones[b].parent < 0 || boneGroup[skeleton.bones[b].parent] !== group);
    for (const entry of entries) {
      for (const b of entry.bones) {
        if (!rootOf(b, entry.group)) continue;
        const bone = skeleton.bones[b];
        const mid = [(bone.head[0] + bone.tail[0]) / 2, (bone.head[1] + bone.tail[1]) / 2, (bone.head[2] + bone.tail[2]) / 2];
        let least = Infinity;
        for (const other of entries) if (other.group === entry.group) least = Math.min(least, fieldAt(other.field, mid[0], mid[1], mid[2]));
        if (least > 0.01 * figure.scale) lead[b] = 1;
      }
    }
    for (const ball of balls) {
      const group = boneGroup[ball.bone];
      if (group < 0) continue;
      const up = skeleton.bones[ball.bone].parent;
      if (rootOf(ball.bone, group) || (up >= 0 && lead[up] && rootOf(up, group))) socket[group] = 1;
    }
  }
  const groupOf = Uint16Array.from(entries, (entry) => entry.group);
  // 每个部件往上找到的那个上半身（UpperBody、UpperBody_L …，见 geometry/torsos.ts）
  const kept = figure.parts.filter((part) => part.material !== 'eye');
  const bodyOf = (part: Part): number => {
    for (let p: Part | undefined = part; p; p = p.parent ? byName.get(p.parent) : undefined) if (/^UpperBody/.test(p.name)) return figure.parts.indexOf(p);
    return -1;
  };
  const body = Int32Array.from({ length: groups }, (_, g) => bodyOf(kept[sample[g]]));
  const torso = Uint8Array.from(kept, (part) => (part.type === 'torso' ? 1 : 0));
  return {
    count,
    positions,
    triangles,
    band,
    soft,
    entries,
    groups,
    parentBone,
    kind,
    sample,
    home,
    kin,
    socket,
    lead,
    balls,
    groupOf,
    body,
    torso,
    rep,
    bones: nb,
    mostStrands,
    boneDist2,
  };
}

/**
 * 第 1 步算出来的一段顶点（first 起的 counts.length 个）：每个顶点离哪些部件近（near* 是这一段的接在一起，
 * 第 i 个顶点的是 offsets[i] ~ offsets[i + 1] 那一截；只有代表自己的顶点有）、它算哪一伙的（别的是 -1）
 */
export interface NearParts {
  first: number;
  offsets: Uint32Array;
  entry: Uint16Array;
  dist: Float32Array;
  owner: Int32Array;
}

/** 第 1 步：from ~ to（不含）这些顶点各离哪些部件近、算哪一伙的 */
export function nearParts(plan: SkinPlan, from: number, to: number): NearParts {
  const { positions, entries, home, groups, kin, socket, rep, band } = plan;
  const reachBox = band * 2;
  const size = to - from;
  const offsets = new Uint32Array(size + 1);
  let nearEntry = new Uint16Array(size * 3 + 16);
  let nearDist = new Float32Array(size * 3 + 16);
  const owner = new Int32Array(size).fill(-1);
  let used = 0;
  for (let v = from; v < to; v++) {
    offsets[v - from] = used;
    if (rep[v] !== v) continue;
    if (used + entries.length > nearEntry.length) {
      const grow = Math.max(nearEntry.length * 2, used + entries.length);
      const moreEntry = new Uint16Array(grow);
      moreEntry.set(nearEntry);
      nearEntry = moreEntry;
      const moreDist = new Float32Array(grow);
      moreDist.set(nearDist);
      nearDist = moreDist;
    }
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    let closest = Infinity;
    let best = -1;
    // 这个顶点所在的网格只认哪几伙（不知道是哪张网格上的就都认）
    const mine = home[v] >= 0 ? home[v] * groups : -1;
    const alone = home[v] >= 0 && socket[home[v]] === 1;
    for (let e = 0; e < entries.length; e++) {
      if (mine >= 0 && (alone ? entries[e].group !== home[v] : !kin[mine + entries[e].group])) continue;
      // 这个顶点就在这一伙自己的网格上：它本来就在这一伙的表面上，不用看离得多远
      // （接上去的手不在距离场里，照距离算会显得离自己的手臂很远）
      const own = entries[e].group === home[v];
      // 包围盒外面留两倍的过渡带：顶点要是浮在所有部件外面一点（融合出来的圆角上），
      // 离它一个过渡带开外的部件也可能还够得着，不能在盒子边上一刀切掉
      const { min, max } = entries[e].field;
      if (
        !own &&
        (x < min[0] - reachBox || x > max[0] + reachBox ||
          y < min[1] - reachBox || y > max[1] + reachBox ||
          z < min[2] - reachBox || z > max[2] + reachBox)
      ) {
        continue;
      }
      const d = own ? Math.min(0, fieldAt(entries[e].field, x, y, z)) : fieldAt(entries[e].field, x, y, z);
      nearEntry[used] = e;
      nearDist[used++] = d;
      if (d < closest) {
        closest = d;
        best = e;
      }
    }
    if (best < 0) {
      // 离所有部件都远（缝上去的手：它不在哪个部件的距离场里）：老老实实找最近的那个
      for (let e = 0; e < entries.length; e++) {
        if (mine >= 0 && (alone ? entries[e].group !== home[v] : !kin[mine + entries[e].group])) continue;
        const d = fieldAt(entries[e].field, x, y, z);
        if (d < closest) {
          closest = d;
          best = e;
        }
      }
      nearEntry[used] = best;
      nearDist[used++] = closest;
    }
    owner[v - from] = entries[best].group;
  }
  offsets[size] = used;
  return { first: from, offsets, entry: nearEntry.slice(0, used), dist: nearDist.slice(0, used), owner };
}

/** 第 1 步的几段（照顶点的先后，从 0 号顶点起一段接一段）接成整个网格的一份 */
export function joinNear(plan: SkinPlan, parts: readonly NearParts[]): NearParts {
  if (parts.length === 1 && parts[0].first === 0 && parts[0].owner.length === plan.count) return parts[0];
  const total = parts.reduce((n, part) => n + part.entry.length, 0);
  const offsets = new Uint32Array(plan.count + 1);
  const entry = new Uint16Array(total);
  const dist = new Float32Array(total);
  const owner = new Int32Array(plan.count).fill(-1);
  let used = 0;
  let next = 0;
  for (const part of parts) {
    if (part.first !== next) throw new Error('顶点没接上');
    const size = part.owner.length;
    for (let i = 0; i < size; i++) offsets[part.first + i] = used + part.offsets[i];
    entry.set(part.entry, used);
    dist.set(part.dist, used);
    owner.set(part.owner, part.first);
    used += part.entry.length;
    next += size;
  }
  if (next !== plan.count) throw new Error('顶点没接上');
  offsets[plan.count] = used;
  return { first: 0, offsets, entry, dist, owner };
}

/** 第 2 步：别的伙的份额打几折（照它沿着表面离得多远，见 reach）。没给三角面就都不打折（null） */
export function gateNear(plan: SkinPlan, near: NearParts): Float32Array | null {
  return plan.triangles
    ? reach(plan.positions, plan.triangles, plan.rep, near.owner, near.offsets, near.entry, plan.groupOf, plan.groups, REACH_NEAR * plan.band, REACH_FAR * plan.band)
    : null;
}

/**
 * 第 3 步：from ~ to（不含）这些顶点的权重，写进 joints、weights（第 from 个顶点写在开头）。
 * near、gate 至少要包住这一段（near.first 起的那些顶点；gate 和 near 的各项一一对应）
 */
export function weighVertices(
  plan: SkinPlan,
  near: NearParts,
  gate: Float32Array | null,
  from: number,
  to: number,
  joints: Uint16Array,
  weights: Float32Array,
) {
  const { positions, entries, rep, band, soft, groups, parentBone, kind, sample, home, socket, lead, groupOf, body, torso } = plan;
  const apartNear = APART[0] * (band / BAND);
  const apartFar = APART[1] * (band / BAND);
  const several = body.some((b) => b >= 0);
  const { offsets, entry: nearEntry, dist: nearDist } = near;
  const base = near.first;
  /** 每一股离这个顶点最近的那一节有多远（距离的平方） */
  const strandNear = new Float64Array(plan.mostStrands);
  // 每个顶点的临时账本：骨骼下标 → 累计的权重
  const total = new Float64Array(plan.bones);
  const touched: number[] = [];
  const share: number[] = [];
  const dist2: number[] = [];
  const pick = new Int32Array(INFLUENCES + 1);
  const groupShare = new Float64Array(groups);
  const here: number[] = [];
  const picked = new Float64Array(INFLUENCES + 1);

  for (let v = from; v < to; v++) {
    if (rep[v] !== v) continue;
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    const k0 = offsets[v - base];
    const k1 = offsets[v - base + 1];
    let closest = Infinity;
    let first = -1;
    for (let k = k0; k < k1; k++) {
      if (nearDist[k] < closest) {
        closest = nearDist[k];
        first = k;
      }
    }
    // 好几个上半身：这个顶点算哪个上半身的，别的上半身的份额打几折（离躯干表面越远打得越狠，见 APART）
    const mine = several && first >= 0 ? body[groupOf[nearEntry[first]]] : -1;
    let apart = 1;
    if (mine >= 0) {
      let skin = Infinity;
      for (let k = k0; k < k1; k++) if (torso[nearEntry[k]] && nearDist[k] < skin) skin = nearDist[k];
      const t = (skin - apartNear) / (apartFar - apartNear);
      apart = t <= 0 ? 1 : t >= 1 ? 0 : 1 - t * t * (3 - 2 * t);
    }

    // 每一伙占多少：它的各个部件的份额加起来
    here.length = 0;
    for (let k = k0; k < k1; k++) {
      const gap = nearDist[k] - closest;
      if (gap >= band) continue;
      const other = mine >= 0 && body[groupOf[nearEntry[k]]] >= 0 && body[groupOf[nearEntry[k]]] !== mine;
      const part = (1 - gap / band) ** 2 * (gate ? gate[k] : 1) * (other ? apart : 1);
      if (part <= 0) continue;
      const group = groupOf[nearEntry[k]];
      if (groupShare[group] === 0) here.push(group);
      groupShare[group] += part;
    }

    touched.length = 0;
    for (let i = 0; i < here.length; i++) {
      const group = here[i];
      const part = groupShare[group];
      // 接在同一根骨骼上的同类也在这里（另一条手臂、另一条腿）：被挤得多厉害（挤它的那一伙占的 / 它自己占的，最多算 1）
      let crowd = 0;
      const up = parentBone[group];
      if (up >= 0) {
        let rival = 0;
        for (let j = 0; j < here.length; j++) {
          const other = here[j];
          if (j !== i && parentBone[other] === up && kind[other] === kind[group] && groupShare[other] > rival) rival = groupShare[other];
        }
        crowd = Math.min(1, rival / part);
      }
      // 这一伙的份额摊到它的骨骼上
      const { bones, outer, strand, strands } = entries[sample[group]];
      let sum = 0;
      let nearest = Infinity;
      if (strands) {
        strandNear.fill(Infinity, 0, strands);
        for (let j = 0; j < bones.length; j++) {
          const d2 = plan.boneDist2(bones[j], x, y, z) + soft;
          dist2[j] = d2;
          const s = strand[j];
          if (s >= 0 && d2 < strandNear[s]) strandNear[s] = d2;
        }
        for (let s = 0; s < strands; s++) if (strandNear[s] < nearest) nearest = strandNear[s];
      }
      const alone = home[v] === group && socket[group] === 1;
      for (let j = 0; j < bones.length; j++) {
        if (alone && lead[bones[j]]) {
          share[j] = 0;
          continue;
        }
        let w = 1 / (strands ? dist2[j] : plan.boneDist2(bones[j], x, y, z) + soft) ** 2;
        // 不是最近的那一股：照「最近的那股有多近 / 这一股有多近」再压四次方
        if (strands && strand[j] >= 0) w *= (nearest / strandNear[strand[j]]) ** 4;
        share[j] = w;
        sum += w;
      }
      if (!(sum > 0)) continue;
      for (let j = 0; j < bones.length; j++) {
        let amount = (part * share[j]) / sum;
        // 被挤着的：最靠根的那节骨骼的份额让一部分给父骨骼
        const above = crowd > 0 ? outer[j] : -1;
        if (above >= 0) {
          if (total[above] === 0) touched.push(above);
          total[above] += amount * crowd;
          amount *= 1 - crowd;
          if (amount <= 0) continue;
        }
        const b = bones[j];
        if (total[b] === 0) touched.push(b);
        total[b] += amount;
      }
    }
    for (const group of here) groupShare[group] = 0;

    // 4) 留下最重的 4 根，归一。所有的都先减去一个门槛：排第 5 的那根有多重，和最重那根的 2%，取大的。
    //    这样一根骨骼是慢慢减到零再退出去的，不会在某两个顶点之间突然少一截（那里一摆姿势就裂）；
    //    那点零头留着也只会让权重图显得很脏
    let found = 0;
    for (; found <= INFLUENCES; found++) {
      let best = -1;
      for (const b of touched) if (total[b] > 0 && (best < 0 || total[b] > total[best])) best = b;
      if (best < 0) break;
      pick[found] = best;
      picked[found] = total[best];
      total[best] = 0;
    }
    for (const b of touched) total[b] = 0;
    const o = (v - from) * INFLUENCES;
    if (!found) {
      weights[o] = 1;
      continue;
    }
    const floor = Math.max(found > INFLUENCES ? picked[INFLUENCES] : 0, picked[0] * TRIM);
    let kept = 0;
    let keptSum = 0;
    for (; kept < Math.min(found, INFLUENCES); kept++) {
      const w = picked[kept] - floor;
      if (w <= 0) break;
      joints[o + kept] = pick[kept];
      weights[o + kept] = w;
      keptSum += w;
    }
    if (!kept) {
      // 五根一样重（碰不上的）：就跟着第一根
      joints[o] = pick[0];
      weights[o] = 1;
      continue;
    }
    for (let slot = 0; slot < kept; slot++) weights[o + slot] /= keptSum;
  }
}

/** 最后一步：分部件时关节上的球整个跟着一节骨骼；位置一样的顶点抄一份 */
export function finishSkin(plan: SkinPlan, joints: Uint16Array, weights: Float32Array): SkinWeights {
  for (const ball of plan.balls) {
    for (const v of ball.vertices) {
      const o = v * INFLUENCES;
      joints[o] = ball.bone;
      weights[o] = 1;
      for (let k = 1; k < INFLUENCES; k++) {
        joints[o + k] = 0;
        weights[o + k] = 0;
      }
    }
  }
  const { rep } = plan;
  for (let v = 0; v < plan.count; v++) {
    const r = rep[v];
    if (r === v) continue;
    for (let k = 0; k < INFLUENCES; k++) {
      joints[v * INFLUENCES + k] = joints[r * INFLUENCES + k];
      weights[v * INFLUENCES + k] = weights[r * INFLUENCES + k];
    }
  }
  return { joints, weights };
}

/**
 * 位置一样的顶点归成一个：返回每个顶点由谁代表（下标最小的那个；自己代表自己的就是它本身）。
 * span：每个顶点在哪一张网格上（同一张的排在一起）；不同网格上的顶点不归并
 */
function weld(positions: ArrayLike<number>, count: number, step: number, span?: Int32Array): Int32Array {
  const rep = new Int32Array(count);
  const seen = new Map<number, number>();
  // 每个坐标量化成 17 位的整数，三个拼成一个数当键；超出范围（离原点六米开外）的不归并
  const half = 65536;
  for (let v = 0; v < count; v++) {
    const qx = Math.round(positions[v * 3] / step) + half;
    const qy = Math.round(positions[v * 3 + 1] / step) + half;
    const qz = Math.round(positions[v * 3 + 2] / step) + half;
    rep[v] = v;
    if (span && v && span[v] !== span[v - 1]) seen.clear();
    if (!(qx >= 0 && qx < 2 * half && qy >= 0 && qy < 2 * half && qz >= 0 && qz < 2 * half)) continue;
    const key = (qx * 2 * half + qy) * 2 * half + qz;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, v);
    else rep[v] = first;
  }
  return rep;
}

/**
 * 每个顶点旁边的每个部件（near* 里的每一项）的份额打几折：
 * 和这个顶点同一伙的不打折；别的伙的，看从它自己那片表面（归它的那些顶点）沿着网格的边走到这里有多远——
 * near 以内不打折，far 以外是 0，中间平滑过渡；沿表面走不到的（两块不连着的表面）是 0。
 */
function reach(
  positions: ArrayLike<number>,
  triangles: ArrayLike<number>,
  rep: Int32Array,
  owner: Int32Array,
  from: Uint32Array,
  nearEntry: Uint16Array,
  groupOf: Uint16Array,
  groups: number,
  near: number,
  far: number,
): Float32Array {
  const count = rep.length;
  // 顶点之间的边（位置一样的顶点算同一个）
  const first = new Uint32Array(count + 1);
  const corners = triangles.length - (triangles.length % 3);
  for (let t = 0; t < corners; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = rep[triangles[t + e]];
      const b = rep[triangles[t + ((e + 1) % 3)]];
      if (a === b) continue;
      first[a + 1]++;
      first[b + 1]++;
    }
  }
  for (let v = 0; v < count; v++) first[v + 1] += first[v];
  const cursor = first.slice(0, count);
  const link = new Uint32Array(first[count]);
  for (let t = 0; t < corners; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = rep[triangles[t + e]];
      const b = rep[triangles[t + ((e + 1) % 3)]];
      if (a === b) continue;
      link[cursor[a]++] = b;
      link[cursor[b]++] = a;
    }
  }
  const span = (a: number, b: number) =>
    Math.hypot(positions[a * 3] - positions[b * 3], positions[a * 3 + 1] - positions[b * 3 + 1], positions[a * 3 + 2] - positions[b * 3 + 2]);

  // 先都按「走不到」算，再一伙一伙地从它自己那片表面往外量
  const gate = new Float32Array(from[count]);
  const members: number[][] = Array.from({ length: groups }, () => []);
  const wanted = new Uint8Array(groups);
  for (let v = 0; v < count; v++) {
    if (rep[v] !== v) continue;
    members[owner[v]].push(v);
    for (let k = from[v]; k < from[v + 1]; k++) {
      const group = groupOf[nearEntry[k]];
      if (group === owner[v]) gate[k] = 1;
      else wanted[group] = 1;
    }
  }

  const far2 = far - near;
  const geo = new Float64Array(count).fill(Infinity);
  // 小顶堆：下一个该从哪个顶点往外走（离得最近的先走）
  const heapKey: number[] = [];
  const heapId: number[] = [];
  const push = (key: number, id: number) => {
    let i = heapKey.length;
    heapKey.push(key);
    heapId.push(id);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heapKey[up] <= key) break;
      heapKey[i] = heapKey[up];
      heapId[i] = heapId[up];
      i = up;
    }
    heapKey[i] = key;
    heapId[i] = id;
  };
  const pop = () => {
    const last = heapKey.length - 1;
    const key = heapKey[last];
    const id = heapId[last];
    heapKey.pop();
    heapId.pop();
    if (last > 0) {
      let i = 0;
      for (;;) {
        let child = i * 2 + 1;
        if (child >= last) break;
        if (child + 1 < last && heapKey[child + 1] < heapKey[child]) child++;
        if (heapKey[child] >= key) break;
        heapKey[i] = heapKey[child];
        heapId[i] = heapId[child];
        i = child;
      }
      heapKey[i] = key;
      heapId[i] = id;
    }
  };
  const reached: number[] = [];
  for (let group = 0; group < groups; group++) {
    if (!wanted[group]) continue;
    reached.length = 0;
    const step = (u: number, base: number) => {
      for (let k = first[u]; k < first[u + 1]; k++) {
        const w = link[k];
        if (owner[w] === group) continue;
        const d = base + span(u, w);
        if (d >= far || d >= geo[w]) continue;
        if (geo[w] === Infinity) reached.push(w);
        geo[w] = d;
        push(d, w);
      }
    };
    for (const v of members[group]) step(v, 0);
    while (heapKey.length) {
      const d = heapKey[0];
      const u = heapId[0];
      pop();
      if (d <= geo[u]) step(u, d);
    }
    for (const w of reached) {
      const t = Math.max(0, Math.min(1, (geo[w] - near) / far2));
      const value = 1 - t * t * (3 - 2 * t);
      for (let k = from[w]; k < from[w + 1]; k++) if (groupOf[nearEntry[k]] === group) gate[k] = value;
      geo[w] = Infinity;
    }
  }
  return gate;
}

/** 一块网格算不算关节上的球：最大有多大（半径，按标准人台的尺寸）、多圆（最近的顶点离球心至少是最远的多少倍）、球心离关节最多偏多少（半径的倍数） */
const BALL_RADIUS = 0.09;
const BALL_ROUND = 0.8;
const BALL_OFF = 0.4;

/**
 * 分部件的网格里找关节上的球：单独的一小块、差不多是个球、球心就在某节骨骼的起点上。
 * 返回每个球的顶点，和它该跟着的那节骨骼（从这个关节伸出去的那一节）。
 */
function jointBalls(
  positions: ArrayLike<number>,
  triangles: ArrayLike<number>,
  rep: Int32Array,
  home: Int32Array,
  skeleton: Skeleton,
  scale: number,
): { vertices: number[]; bone: number }[] {
  const count = rep.length;
  // 连在一起的顶点归成一块
  const up = new Int32Array(count);
  for (let v = 0; v < count; v++) up[v] = rep[v];
  const find = (v: number) => {
    let r = v;
    while (up[r] !== r) r = up[r];
    while (up[v] !== r) {
      const next = up[v];
      up[v] = r;
      v = next;
    }
    return r;
  };
  const corners = triangles.length - (triangles.length % 3);
  for (let t = 0; t < corners; t += 3) {
    const a = find(triangles[t]);
    for (let e = 1; e < 3; e++) {
      const b = find(triangles[t + e]);
      if (a !== b) up[b] = a;
    }
  }
  const pieces = new Map<number, number[]>();
  for (let v = 0; v < count; v++) {
    if (rep[v] !== v || home[v] < 0) continue;
    const r = find(v);
    const list = pieces.get(r);
    if (list) list.push(v);
    else pieces.set(r, [v]);
  }
  const out: { vertices: number[]; bone: number }[] = [];
  for (const vertices of pieces.values()) {
    if (vertices.length < 12) continue;
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (const v of vertices) {
      for (let k = 0; k < 3; k++) {
        low[k] = Math.min(low[k], positions[v * 3 + k]);
        high[k] = Math.max(high[k], positions[v * 3 + k]);
      }
    }
    const center = [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2];
    let near = Infinity;
    let far = 0;
    for (const v of vertices) {
      const d = Math.hypot(positions[v * 3] - center[0], positions[v * 3 + 1] - center[1], positions[v * 3 + 2] - center[2]);
      near = Math.min(near, d);
      far = Math.max(far, d);
    }
    if (far > BALL_RADIUS * scale || near < far * BALL_ROUND) continue;
    let bone = -1;
    let least = far * BALL_OFF;
    skeleton.bones.forEach((b, i) => {
      const d = Math.hypot(b.head[0] - center[0], b.head[1] - center[1], b.head[2] - center[2]);
      if (d < least) {
        least = d;
        bone = i;
      }
    });
    if (bone >= 0) out.push({ vertices, bone });
  }
  return out;
}
