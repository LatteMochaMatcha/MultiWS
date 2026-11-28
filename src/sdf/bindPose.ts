/**
 * 摆姿势用的网格：融合时的姿势和静止姿势分开。
 *
 * 聚在一个肩膀上的几条手臂静止时挨得很近。照静止的样子直接融合，它们从肩膀到上臂中段是长在一起的同一张皮，
 * 把其中一条举起来，它和旁边几条之间就扯出一片蹼——权重怎么分都没用，因为网格本身就是连着的。
 *
 * 所以要权重的时候（摆姿势、导出带骨骼的模型）换一个做法：
 * 1. 先把这几条手臂张开（Part.bind），照张开的样子融合、算权重：这时它们只在肩头那一小段连着；
 * 2. 再照刚算出来的权重把手臂转回静止的位置（和摆姿势时一样，混合的是骨骼的动作，见 character/pose.ts）。
 * 得到的还是一整块封闭的网格，静止时的样子和原来差不多（几条上臂是叠在一起的，不是长在一起的），
 * 往后摆姿势、导出都把它当成静止的网格来用，别处不用知道有过这回事。
 *
 * 阴茎、阴囊是同一个办法，只是融合时摆成什么样看姿势（见 turnedParts）：它们绕根转过多少，就照转好的样子融合，
 * 屏幕上（view/fusedModel.ts 的 turn）停下来以后换上、导出时也照它。
 *
 * 挨着的两条大腿（二次元素体）是另一个办法，为的是同一件事：不转开，在中间切一刀再融合，权重算完把切口挪回去（见 legSlit.ts）。
 *
 * 纯函数，在 Web Worker 和单元测试里都能跑。
 */
import { skinVerticesDualInPlace } from '../character/pose';
import { type Part, shapeInverse, shapeMatrix, worldTransforms } from '../geometry/figure';
import { genitalRooms } from '../geometry/genital';
import { type V3, mat3Apply, quatBasis, quatConj, quatMat3, quatMul, rotate } from '../geometry/vec';
import { type Skeleton, buildSkeleton } from '../rig/skeleton';
import { type SkinWeights, bindGrafts, skinVertices } from '../rig/skin';
import { type FuseOptions, type Staged, stageParts } from './fuse';
import { type LegSlit, closeSlits, legSlits, slitOwner, slitParts } from './legSlit';
import type { BlockMemo, FusedMesh } from './surfaceNets';

/** 这副身体融合时的姿势和静止姿势是不是不一样 */
export const hasBindPose = (parts: readonly Part[]): boolean => parts.some((part) => part.bind);

/**
 * 把部件摆成融合时的姿势：带 bind 的部件绕自己的原点多转那么多。
 * 部件里最靠根的那节骨骼（锁骨：它的父骨骼在别的部件里，自己躺在躯干里）留在原地不跟着转。
 */
export function bindParts(parts: readonly Part[]): Part[] {
  return parts.map((part) => {
    if (!part.bind) return part;
    const { bind, ...rest } = part;
    const quat = quatMul(bind, part.quat);
    // 阴茎、阴囊整个跟着转（见 turnedParts）：骨骼写在部件自己的坐标里，不用动
    if (turnsWhole(part)) return { ...rest, quat };
    const own = new Set(part.bones?.map((bone) => bone.name));
    const shape = shapeMatrix(part);
    const unshape = shapeInverse(part);
    // 骨骼写在部件自己的坐标里：部件多转了，要留在原地的骨骼就反着转回去
    const stay = (p: V3): V3 => {
      const local = rotate(quatConj(quat), rotate(part.quat, shape ? mat3Apply(shape, p) : p));
      return unshape ? mat3Apply(unshape, local) : local;
    };
    const bones = part.bones?.map((bone) => (bone.parent && own.has(bone.parent) ? bone : { ...bone, head: stay(bone.head), tail: stay(bone.tail) }));
    return { ...rest, quat, ...(bones ? { bones } : {}) };
  });
}

/**
 * 每根骨骼从融合时的姿势回到静止姿势要怎么搬（每根 12 个数：3×3 的旋转按行排，后面是平移；和蒙皮矩阵一个写法）。
 * skeleton 是照融合时的姿势建的骨架；骨骼的顺序和静止姿势的骨架一样。
 */
export function unbindMatrices(parts: readonly Part[], bound: readonly Part[], skeleton: Skeleton): Float64Array {
  const count = skeleton.bones.length;
  const matrices = new Float64Array(count * 12);
  for (let i = 0; i < count; i++) matrices[i * 12] = matrices[i * 12 + 4] = matrices[i * 12 + 8] = 1;
  const to = worldTransforms({ parts: [...parts], scale: 1 });
  const from = worldTransforms({ parts: [...bound], scale: 1 });
  const turned = new Map<string, number[]>();
  const whole = new Set<string>();
  for (const part of parts) {
    if (!part.bind) continue;
    const a = from.get(part.name)!;
    const b = to.get(part.name)!;
    const r = quatMat3(quatMul(b.quat, quatConj(a.quat)));
    const moved = mat3Apply(r, a.pos);
    turned.set(part.name, [...r, b.pos[0] - moved[0], b.pos[1] - moved[1], b.pos[2] - moved[2]]);
    if (turnsWhole(part)) whole.add(part.name);
  }
  skeleton.bones.forEach((bone, i) => {
    const matrix = turned.get(bone.part);
    const up = skeleton.bones[bone.parent];
    // 没转过的部件、转过的部件里留在原地的那节骨骼：不用搬
    if (!matrix || (!whole.has(bone.part) && (!up || up.part !== bone.part))) return;
    matrices.set(matrix, i * 12);
  });
  return matrices;
}

/**
 * 阴茎、阴囊的根是长在带着它的那根骨骼（胯）上的，可它脚下那一圈身上的皮照平常的算法大半跟着大腿：
 * 腿一张开，这圈皮跟着腿走，根留在原地，接缝上扯出一根根尖刺。所以离根不到最靠根那节骨骼长度的 from 倍的皮
 * 也整个跟着那根骨骼，到 to 倍渐渐回到原样（阴茎、阴囊自己的骨骼占的那一份不动）。
 * open：露在外面的皮（不是切口挪回去的、挖槽填回去的那几层）到这么多倍才回到原样。大腿粗、压着根的时候，
 * 大腿内侧顶端落在钉住的范围里，从钉住到跟腿那一圈窄的话，腿一抬就在那条弧线上挤出一道竖棱（2026-11-28，拉宽以后矮多了）；
 * 埋在里面的那几层不拉宽：它们贴着根，宽了根旁边多扯一片
 */
const GENITAL_PIN = { from: 0.8, to: 1.6, open: 2 };

/**
 * 带权重融合好以后，把阴茎、阴囊周围的权重理一遍（就地改 weights），算完把 mesh.restored 拿掉：
 * 1. 从挖出来的槽壁上挪回原来表面的顶点（见 uncarve.ts）是大腿、肚子上的皮，这时却在阴茎里面，照整副身体算会算成阴茎的：
 *    照「没有阴茎、阴囊」的身体另算；
 * 2. 根部周围的皮钉在带着根的那根骨骼上（见 GENITAL_PIN）；收到那块身体表面上的槽壁（restored.floor）整个钉上
 */
function settleGenitals(mesh: FusedMesh, weights: SkinWeights, parts: readonly Part[], skeleton: Skeleton, legSkin: Uint8Array) {
  const restored = mesh.restored;
  delete mesh.restored;
  const names = new Set(parts.filter((part) => part.type === 'genital').map((part) => part.name));
  if (!names.size) return;
  const { positions } = mesh;
  const limit = mesh.bound ? mesh.bound.start : positions.length / 3;
  const own = skeleton.bones.map((bone) => names.has(bone.part));

  if (restored?.all.length) {
    const bare = { parts: parts.filter((part) => part.type !== 'genital'), scale: 1 };
    const bones = buildSkeleton(bare);
    const index = new Map(skeleton.bones.map((bone, i) => [bone.name, i]));
    const map = bones.bones.map((bone) => index.get(bone.name) ?? 0);
    const list = restored.all;
    // 照挪之前的位置算：挪回去以后，切开的两条大腿的皮是互相叠着的（见 legSlit.ts），照位置分不清是哪条腿的
    const made = skinVertices(bare, bones, restored.from);
    list.forEach((v, i) => {
      for (let k = 0; k < 4; k++) {
        weights.joints[v * 4 + k] = map[made.joints[i * 4 + k]];
        weights.weights[v * 4 + k] = made.weights[i * 4 + k];
      }
    });
  }

  const roots: { at: V3; host: number; from: number; to: number; open: number }[] = [];
  skeleton.bones.forEach((bone, i) => {
    if (!own[i] || bone.parent < 0 || skeleton.bones[bone.parent].part === bone.part) return;
    const long = Math.hypot(bone.tail[0] - bone.head[0], bone.tail[1] - bone.head[1], bone.tail[2] - bone.head[2]);
    roots.push({ at: bone.head, host: bone.parent, from: GENITAL_PIN.from * long, to: GENITAL_PIN.to * long, open: GENITAL_PIN.open * long });
  });
  const floor = new Uint8Array(limit);
  if (restored) for (const v of restored.floor) if (v < limit) floor[v] = 1;
  // 大腿之间切口挪回去的皮（legSlit.ts）离根近的也照样钉：它们静止时就贴着根（从前根周围挖了个球把它们隔开，后来去掉了），
  // 只跟着腿的话，腿一张开从根旁边翻出来，根两边各一圈碎片（2026-11-28）
  const { joints } = weights;
  const share = weights.weights;
  // 埋在里面的那几层：切口挪回去的、挖槽填回去的（过渡带不拉宽，见 GENITAL_PIN.open）
  const inner = legSkin.slice(0, limit);
  if (restored) for (const v of restored.all) if (v < limit) inner[v] = 1;
  for (let v = 0; v < limit; v++) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    let pin = 0;
    let host = -1;
    let nearest = Infinity;
    for (const root of roots) {
      const d = Math.hypot(x - root.at[0], y - root.at[1], z - root.at[2]);
      if (floor[v]) {
        // 收到身体表面上的槽壁：整个跟着最近的那个根
        if (d < nearest) {
          nearest = d;
          pin = 1;
          host = root.host;
        }
        continue;
      }
      const to = inner[v] ? root.to : root.open;
      if (d >= to) continue;
      const t = d <= root.from ? 0 : (d - root.from) / (to - root.from);
      const here = 1 - t * t * (3 - 2 * t);
      if (here > pin) {
        pin = here;
        host = root.host;
      }
    }
    if (pin <= 0) continue;
    // 别的骨骼各让出 pin 这么多，都给带着根的那根骨骼
    let moved = 0;
    let slot = -1;
    let least = -1;
    for (let k = 0; k < 4; k++) {
      const o = v * 4 + k;
      if (joints[o] === host && share[o] > 0) {
        slot = k;
        continue;
      }
      if (share[o] > 0 && own[joints[o]]) continue;
      moved += share[o] * pin;
      share[o] *= 1 - pin;
      if (least < 0 || share[o] < share[v * 4 + least]) least = k;
    }
    if (moved <= 0) continue;
    if (slot < 0) {
      // 四个位置里没有那根骨骼：顶掉让完以后最轻的那个
      if (least < 0) continue;
      slot = least;
      moved += share[v * 4 + slot];
      joints[v * 4 + slot] = host;
      share[v * 4 + slot] = 0;
    }
    share[v * 4 + slot] += moved;
  }
}
/**
 * 切口挪回去的那片皮：权重在网格上匀几遍、每遍往邻居的平均挪几成、往外带上几圈没挪过的邻居一起匀。
 * 遍数、圈数是照 tuned 这么大的体素（摆姿势时屏幕上那一档）定的：网格细了照着加，匀开的宽度才一样
 */
const LEG_SKIN_EVEN = { rounds: 12, pull: 0.6, rings: 3, tuned: 0.0095 };

/**
 * 大腿之间的切口挪回去以后（legSlit.ts 的 closeSlits），把那片皮和它边上几圈的权重在网格上匀一匀（就地改 weights）。
 * 那片皮的权重是照切开时的位置一个顶点一个顶点分的，贴着胯的那一圈上相邻的顶点常常一个大半跟胯、一个大半跟腿，
 * 腿一张开，这一圈就支成一排锯齿。匀过以后从跟胯到跟腿是渐渐过去的。
 * 两条腿的皮不互相匀（另一条腿的皮不算邻居）：不然刀白切了
 */
function evenLegSkin(mesh: FusedMesh, weights: SkinWeights, parts: readonly Part[], skeleton: Skeleton, legSkin: Uint8Array) {
  if (!legSkin.includes(1)) return;
  const { triangles } = mesh;
  const limit = legSkin.length;
  const finer = Math.max(1, LEG_SKIN_EVEN.tuned / mesh.info.voxel);
  const rings = Math.round(LEG_SKIN_EVEN.rings * finer);
  const rounds = Math.round(LEG_SKIN_EVEN.rounds * finer * finer);
  // 要匀的顶点：挪过的，加上往外几圈
  const ring = new Int8Array(limit).fill(-1);
  for (let v = 0; v < limit; v++) if (legSkin[v]) ring[v] = 0;
  for (let r = 1; r <= rings; r++) {
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t];
      const b = triangles[t + 1];
      const c = triangles[t + 2];
      if (a >= limit || b >= limit || c >= limit) continue;
      if (ring[a] !== r - 1 && ring[b] !== r - 1 && ring[c] !== r - 1) continue;
      if (ring[a] < 0) ring[a] = r;
      if (ring[b] < 0) ring[b] = r;
      if (ring[c] < 0) ring[c] = r;
    }
  }
  const list: number[] = [];
  for (let v = 0; v < limit; v++) if (ring[v] >= 0) list.push(v);  const at = new Map(list.map((v, i) => [v, i]));
  const near: Set<number>[] = list.map(() => new Set());
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const i = at.get(triangles[t + e]);
      if (i === undefined) continue;
      for (const u of [triangles[t + ((e + 1) % 3)], triangles[t + ((e + 2) % 3)]]) if (u < limit) near[i].add(u);
    }
  }
  // 每根骨骼是哪条腿的（不是腿的是 -1）；每个顶点大半跟着哪条腿
  const legs = new Map<string, number>();
  for (const part of parts) if (part.type === 'leg') legs.set(part.name, legs.size);
  const legOf = skeleton.bones.map((bone) => legs.get(bone.part) ?? -1);
  const { joints } = weights;
  const share = weights.weights;
  const mainLeg = (v: number): number => {
    let best = -1;
    let most = 0;
    for (let k = 0; k < 4; k++) {
      const leg = legOf[joints[v * 4 + k]];
      if (leg < 0) continue;
      let sum = 0;
      for (let j = 0; j < 4; j++) if (legOf[joints[v * 4 + j]] === leg) sum += share[v * 4 + j];
      if (sum > most) {
        most = sum;
        best = leg;
      }
    }
    return most >= 0.5 ? best : -1;
  };
  const own = new Map<number, number>();
  const whose = (v: number): number => {
    let leg = own.get(v);
    if (leg === undefined) own.set(v, (leg = mainLeg(v)));
    return leg;
  };
  // 每个顶点的权重摊开成「骨骼 → 份额」，匀完再收成四个
  let now: Map<number, number>[] = list.map((v) => {
    const map = new Map<number, number>();
    for (let k = 0; k < 4; k++) if (share[v * 4 + k] > 0) map.set(joints[v * 4 + k], (map.get(joints[v * 4 + k]) ?? 0) + share[v * 4 + k]);
    return map;
  });
  const outside = (u: number): Map<number, number> => {
    const map = new Map<number, number>();
    for (let k = 0; k < 4; k++) if (share[u * 4 + k] > 0) map.set(joints[u * 4 + k], (map.get(joints[u * 4 + k]) ?? 0) + share[u * 4 + k]);
    return map;
  };
  const fixed = new Map<number, Map<number, number>>();
  for (let round = 0; round < rounds; round++) {
    const next = list.map((v, i) => {
      // 最外面那一圈不动：它外面的皮没匀，动了的话接缝就挪到那里去了
      if (ring[v] === rings) return now[i];
      const mine = whose(v);
      const sum = new Map<number, number>();
      let count = 0;
      for (const u of near[i]) {
        const other = whose(u);
        if (mine >= 0 && other >= 0 && other !== mine) continue;
        const j = at.get(u);
        let from = j === undefined ? fixed.get(u) : now[j];
        if (!from) fixed.set(u, (from = outside(u)));
        for (const [bone, w] of from) sum.set(bone, (sum.get(bone) ?? 0) + w);
        count++;
      }
      if (!count) return now[i];
      const out = new Map<number, number>();
      for (const [bone, w] of now[i]) out.set(bone, w * (1 - LEG_SKIN_EVEN.pull));
      for (const [bone, w] of sum) out.set(bone, (out.get(bone) ?? 0) + (w / count) * LEG_SKIN_EVEN.pull);
      return out;
    });
    now = next;
  }
  list.forEach((v, i) => {
    if (ring[v] === rings) return;
    const top = [...now[i]].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = top.reduce((sum, [, w]) => sum + w, 0);
    if (!(total > 0)) return;
    for (let k = 0; k < 4; k++) {
      joints[v * 4 + k] = k < top.length ? top[k][0] : 0;
      share[v * 4 + k] = k < top.length ? top[k][1] / total : 0;
    }
  });
}

/** 带 bind 的部件是不是连最靠根的那节骨骼一起转（阴茎、阴囊；手臂的锁骨是留在原地的） */
const turnsWhole = (part: Pick<Part, 'type'>): boolean => part.type === 'genital';

/** 阴茎、阴囊绕根转了不到这么多（弧度）的不算转过 */
const TURNED = 0.02;

/** 每副身体只看一遍：骨架多少根骨骼，哪些部件是阴茎、阴囊，它最靠根的那节骨骼、带着它的骨骼是第几根 */
const genitalRoots = new WeakMap<object, { bones: number; list: { at: number; bone: number; host: number }[] }>();

/**
 * 摆姿势时阴茎、阴囊绕自己的根转过的：把转的这些写成它们的 bind，照这副身体带权重融合（fuseSkinned），
 * 它们就是在转好的地方和身体融合的，再照权重搬到摆好的姿势时根部不用弯——和分部件时看到的一样，整根绕着根转。
 * 不这么办的话，转上一百多度全靠根部那一圈皮去弯：要么扯成一片片，要么下半截留在原地、上半截飞出去。
 * 只烤最靠根的那一节（整个部件绕根转）；阴茎后面两节的弯还是照权重。
 * pose：每根骨骼的蒙皮矩阵（部件自己的单位，顺序同 buildSkeleton）。一个都没转过（或者没有阴茎、阴囊）返回 null
 */
export function turnedParts(parts: readonly Part[], pose: ArrayLike<number>): Part[] | null {
  let known = genitalRoots.get(parts);
  if (!known) {
    const list: { at: number; bone: number; host: number }[] = [];
    let bones = 0;
    if (parts.some((part) => part.type === 'genital')) {
      const skeleton = buildSkeleton({ parts: [...parts], scale: 1 });
      bones = skeleton.bones.length;
      parts.forEach((part, at) => {
        if (part.type !== 'genital' || part.parent) return;
        const bone = skeleton.bones.findIndex((b) => b.part === part.name && skeleton.bones[b.parent]?.part !== part.name);
        if (bone >= 0) list.push({ at, bone, host: skeleton.bones[bone].parent });
      });
    }
    genitalRoots.set(parts, (known = { bones, list }));
  }
  if (!known.list.length || pose.length !== known.bones * 12) return null;
  let out: Part[] | null = null;
  for (const { at, bone, host } of known.list) {
    // 相对带着它的骨骼转了多少（静止时的坐标里）：R胯ᵀ · R自己，一列一列地算
    const a = bone * 12;
    const column = (j: number): V3 => {
      const c: V3 = [pose[a + j], pose[a + 3 + j], pose[a + 6 + j]];
      if (host < 0) return c;
      const b = host * 12;
      return [pose[b] * c[0] + pose[b + 3] * c[1] + pose[b + 6] * c[2], pose[b + 1] * c[0] + pose[b + 4] * c[1] + pose[b + 7] * c[2], pose[b + 2] * c[0] + pose[b + 5] * c[1] + pose[b + 8] * c[2]];
    };
    const turn = quatBasis(column(0), column(1), column(2));
    if (2 * Math.acos(Math.min(1, Math.abs(turn[3]))) < TURNED) continue;
    const part = parts[at];
    (out ??= [...parts])[at] = { ...part, bind: part.bind ? quatMul(turn, part.bind) : turn };
  }
  return out;
}


/**
 * 融合成一整块网格，连同蒙皮权重（骨骼的顺序和 buildSkeleton 给静止姿势排的一样）。
 * 网格是静止姿势的；有部件带着 bind 时，它是照张开的样子融合、再照权重转回来的。
 */
export function fuseSkinned(parts: Part[], options: FuseOptions): { mesh: FusedMesh; skin: SkinWeights } {
  return stageSkinned(parts, options).finish();
}

/** fuseSkinned 分成前后两半（见 Staged） */
export function stageSkinned(parts: Part[], options: FuseOptions): Staged<{ mesh: FusedMesh; skin: SkinWeights }> {
  const steps = skinnedSteps(parts, options);
  const finish = (memo?: BlockMemo) => {
    const mesh = steps.fused.finish(memo);
    return steps.settle(mesh, skinVertices(steps.figure, steps.skeleton, mesh.positions, mesh.triangles));
  };
  return { field: steps.fused.field, voxel: steps.fused.voxel, finish };
}

/** 每副身体只备一遍：带权重融合时用的那副身体、它上面大腿之间的几刀 */
const prepared = new WeakMap<Part[], { figure: { parts: Part[]; scale: number }; slits: LegSlit[] }>();

function prepare(parts: Part[]) {
  let made = prepared.get(parts);
  if (!made) {
    const bound = hasBindPose(parts) ? bindParts(parts) : parts;
    const slits = legSlits(bound, buildSkeleton({ parts: bound, scale: 1 }));
    prepared.set(parts, (made = { figure: { parts: slits.length ? [...bound, ...slitParts(slits)] : bound, scale: 1 }, slits }));
  }
  return made;
}

/**
 * 带权重融合时用的那副身体：聚在一个肩膀上的几条手臂先张开（见 bindParts），挨着的两条大腿之间切开（见 legSlit.ts，
 * 刀在排在最后的几个没有骨骼的部件里，骨架不变）。权重照它算
 */
export function skinnedFigure(parts: Part[]): { parts: Part[]; scale: number } {
  return prepare(parts).figure;
}

/**
 * fuseSkinned 再拆细一点：先融合（fused），再照 figure、skeleton 算权重（skinVertices，可以拆开分给别的线程算，见 parallel.ts），
 * 最后把算好的权重交给 settle：缝上去的手换成自带的权重，张开的手臂转回静止的位置
 */
export function skinnedSteps(parts: Part[], options: FuseOptions) {
  const { figure, slits } = prepare(parts);
  const bound = figure.parts;
  // 阴茎根部往外那一截周围先空出来（见 geometry/genital.ts 的 genitalRooms）：不然它和贴着的肚子、大腿长成一张皮，一转就扯碎
  const rooms = genitalRooms(bound);
  const fused = stageParts(bound, { voxel: options.voxel, blend: options.blend, ...(rooms.length ? { rooms, ...(slits.length ? { owner: slitOwner(bound, slits) } : {}) } : {}) });
  const skeleton = buildSkeleton(figure);
  const settle = (mesh: FusedMesh, weights: SkinWeights) => {
    // 大腿之间的切口挪回原来的表面：权重已经照切开的样子分好了（见 legSlit.ts）
    const legSkin = closeSlits(mesh, bound, slits, (v, leg) => {
      let share = 0;
      for (let k = 0; k < 4; k++) if (skeleton.bones[weights.joints[v * 4 + k]].part === leg) share += weights.weights[v * 4 + k];
      return share >= 0.5;
    });
    settleGenitals(mesh, weights, bound, skeleton, legSkin);
    evenLegSkin(mesh, weights, bound, skeleton, legSkin);
    const skin = bindGrafts(weights, mesh, skeleton);
    // 转回去用的是对偶四元数：手臂要转几十上百度，线性混合会把肩头压瘪
    if (hasBindPose(parts)) skinVerticesDualInPlace(mesh.positions, mesh.normals, skin.joints, skin.weights, unbindMatrices(parts, bound, skeleton));
    return { mesh, skin };
  };
  return { fused, figure, skeleton, settle };
}
