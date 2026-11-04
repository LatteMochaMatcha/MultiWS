/**
 * 摆好姿势以后的距离场：把每个部件的形状照骨骼搬到摆好的位置上，再照平常那样融合成一整块。
 *
 * 蒙皮（拉着静止时的那张皮跟骨骼走）在关节转得多的地方怎么调权重都有毛病：肩头要么瘪、要么鼓成一个包，
 * 挨在一起的几条手臂之间的皮被扯成一片蹼。这里换一个做法（照「隐式蒙皮」的思路：皮肤是形状场的表面，
 * 骨骼带着的是形状场，不是皮）：
 * - 只有一根骨骼的部件（头、脖子），和没有自己骨骼的部件（胸、角、耳朵、头发）：整个跟着那根骨骼搬过去。
 *   手臂绕肩关节转、腿绕髋关节转也都是整个部件在搬——和「造型」里 A-pose、T-pose 的做法一样，
 *   肩膀、腿根是重新融合出来的，不是扯出来的。
 * - 手臂、腿（细长、关节要弯一百多度）：在每个关节处切一刀（垂直于两节骨骼的角平分线），
 *   每一段整个跟着自己那节骨骼。关节弯了以后，凹的那一侧两段叠在一起（取并集）；
 *   凸的那一侧两个切面之间张开一个楔形的口子，用切面的轮廓绕着关节扫过去补上——
 *   圆的手臂扫出来就是一个球形的关节，扁的脚掌扫出来还是它本来的宽窄。
 *   两节之间还拧了一点的话，扫的时候轮廓跟着慢慢拧过去。
 *   这样关节弯多少度都不会瘪、不会鼓，也没有一片片扯出来的皮。
 * - 躯干、兽身、尾巴（截面大、每个关节只弯一点，或者是一长串小关节）：不切开，整个顺着骨骼弯过去——
 *   空间里每个点照它离各节骨骼的远近，把这几节骨骼的动作混在一起（混的是「转多少、挪多少」，对偶四元数），
 *   倒着搬回静止时的位置去问形状。切开的话，每个关节处两段叠着的地方是一道折痕，躯干上很显眼。
 * - 照着现成的模型采样出来的腿（二次元素体）不在这里摆：这种腿的根是一圈毛边，静止时和躯干的开口对得严丝合缝
 *   才看不出来，在场里怎么弯都会错开。所以融合时让它整个跟着胯（见 heldLegs），融合完再照蒙皮权重搬过去
 *   （见 posedFuse.ts）——腿和「拖着的时候」那张网格上的一模一样。
 * - 一个上半身的二次元素体，胸整个和躯干一样弯（见 bodyChest）：胸长在躯干上，躯干怎么弯胸就怎么弯，胸根始终贴着躯干。
 *   以前整个跟着最近的那节脊柱搬，几节脊柱转得不一样时胸根和躯干错开，一圈锯齿状的沟、毛边。
 * - 好几个上半身的二次元素体（见 SHARED_LIFT）：躯干那几块（胯、每个上半身）一起顺着所有躯干骨骼弯——一个上半身那份只跟自己的脊柱的话，
 *   两个上半身一歪开，正中切开的两个切面就露出来；胸根那一层顺着自己那个上半身的脊柱弯，往外渐渐换成整个跟着那个上半身最近的那节骨骼。
 *   照权重弯的话，挤在一起的两只胸接触的那一圈是一整张皮，两个上半身一分开就被拉成一根管子；这样重新融合，两只胸干干净净地分开。
 *   两个上半身直立并排的（每个上半身是完整的一份躯干，不是切开拼的，见 OWN_BEND）另有一套：上半身那份从腰往上渐渐换成只跟自己的脊柱弯，
 *   胸整只只跟自己的脊柱，胸根和躯干对得上；两个身子歪开时从肚子上面干干净净地分开。
 * 部件之间照旧是圆滑地融合。
 *
 * 不是什么身体都照这个办法，见 refusable。
 *
 * 纯函数，在 Web Worker 和单元测试里都能跑。
 */
import { type ChestShape, type Figure, type Part, type WorldXf, worldTransforms } from '../geometry/figure';
import { type Quat, type V3, quatBasis, quatMul, rotate } from '../geometry/vec';
import { type Skeleton, buildSkeleton } from '../rig/skeleton';
import { BIG, type CompiledField, type Dist, type Draft, type FieldOptions, GROUP_BLEND, GROUP_INDEX, GROUPS, REST_ROOT_BLEND, T_CUSTOM, draftDist, pack, partDrafts } from './field';
import { collectingChests } from './grids';
import { t } from '../i18n';

/** 每根骨骼的蒙皮矩阵：12 个数一根（3×3 的旋转按行排，后面是平移），骨骼的顺序和 buildSkeleton 给静止姿势排的一样 */
export type PoseMatrices = ArrayLike<number>;

/** 两个矩阵差不到这么多就当成一样 */
const SAME = 1e-9;
/** 两条手臂的肩关节离得不到这么远，就算挤在同一个肩膀上（见 refusable）。「肩部聚拢」的几条隔两三厘米，「上下排」的隔十厘米以上 */
const CROWDED = 0.07;
/** 关节弯得不到这么多（弧度）就不用补楔形的口子了 */
const BENT = 0.004;
/** 包围盒外面多留的一点 */
const MARGIN = 0.004;
/**
 * 每一段比切面多留出这么厚的一层，相邻两段在切面两边叠着。
 * 正好切到切面为止的话，切面上场的值正好是 0：格点落在上面会被当成身体外面，表面上就沿着切面勒出一圈细沟
 */
const OVERLAP = 0.004;
/**
 * 网格化时，每一段只算离「只包住表面的那个盒子」（见 Draft.corners）切出来的那一截不远的小块（见 Draft.cull）。
 * 切之前盒子先往外胀这么多，切面也多留这么多：切出来那一截外面一点的地方，这一段的值也还不大，不能不算
 */
const CULL_GROW = 0.036;
/**
 * 摆好以后，这几类部件只在根部（关节周围）和身体圆滑地融合：离关节 near 以内是完整的圆角，到 far 减到没有。
 * 平常（静止的 A-pose、T-pose）手臂和腿都离身体远远的，整条都按圆角融合也看不出来；
 * 摆了姿势以后手会搭在腿上、手臂会贴着身体——那是挨着，再融出一圈圆角就把它们粘在一起了
 */
const ROOT_BLEND: Partial<Record<Part['type'], [near: number, far: number]>> = {
  arm: [0.09, 0.17],
  leg: [0.13, 0.24],
  tail: [0.08, 0.16],
  wing: [0.08, 0.16],
  genital: REST_ROOT_BLEND.genital,
};

const isIdentity = (m: PoseMatrices, o: number) =>
  Math.abs(m[o] - 1) < SAME &&
  Math.abs(m[o + 4] - 1) < SAME &&
  Math.abs(m[o + 8] - 1) < SAME &&
  Math.abs(m[o + 1]) + Math.abs(m[o + 2]) + Math.abs(m[o + 3]) + Math.abs(m[o + 5]) + Math.abs(m[o + 6]) + Math.abs(m[o + 7]) < SAME &&
  Math.abs(m[o + 9]) + Math.abs(m[o + 10]) + Math.abs(m[o + 11]) < SAME;

const same = (m: PoseMatrices, a: number, b: number) => {
  for (let k = 0; k < 12; k++) if (Math.abs(m[a + k] - m[b + k]) > SAME) return false;
  return true;
};

/** 静止时的点搬到摆好以后在哪 */
const carried = (m: PoseMatrices, o: number, p: readonly number[]): V3 => [
  m[o] * p[0] + m[o + 1] * p[1] + m[o + 2] * p[2] + m[o + 9],
  m[o + 3] * p[0] + m[o + 4] * p[1] + m[o + 5] * p[2] + m[o + 10],
  m[o + 6] * p[0] + m[o + 7] * p[1] + m[o + 8] * p[2] + m[o + 11],
];

/** 矩阵里的旋转写成四元数 */
const turnOf = (m: PoseMatrices, o: number): Quat => quatBasis([m[o], m[o + 3], m[o + 6]], [m[o + 1], m[o + 4], m[o + 7]], [m[o + 2], m[o + 5], m[o + 8]]);

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: readonly number[]): V3 | null => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : null;
};

/** 这几类部件不分段，整个顺着骨骼弯过去（见文件开头） */
const BENDS: ReadonlySet<Part['type']> = new Set(['torso', 'lower', 'tail']);
/** 算一个点离骨骼多远时，距离的平方里加上这一点，免得点正好落在骨骼上时除以零 */
const SOFT = 0.004 ** 2;
/**
 * 带着采样出来的腿的那个部件（躯干）弯的时候，每条腿的根上另加两截跟着胯的线段（见 bendMap 的 stubs）：
 * 一截从髋关节顺着大腿往下 down 这么长，一截从髋关节到胯那节骨骼的头。
 * 不加的话腰一弯，屁股、腹股沟那一圈会被脊柱带走两三成，和留在胯上的腿根错开，接缝就露出来了
 */
const PELVIS_STUB = { down: 0.14 };

/**
 * 好几个上半身的二次元素体：胸离躯干表面 near 以内顺着自己那个上半身的脊柱弯（和躯干对得上），到 far 整个跟着那个上半身最近的那节骨骼（按标准人台的尺寸）。
 * 胸根不跟着所有躯干骨骼弯：胯、旁边那个上半身的骨骼也带着它的话，一个上半身歪得多了，里侧的胸根被拽回正中，整只胸拉成一片横在两个身子之间；
 * 正中还会多出一只只「鬼影」胸——胸原来（静止时）在的地方倒着搬回去，照胯那几节搬又落回胸上
 */
const SHARED_LIFT: [near: number, far: number] = [0.005, 0.05];
/**
 * 两个上半身直立并排时上半身那份躯干怎么弯（见 apartMap）：静止时比腰（脊柱起点）高 from 以下和胯、另一个上半身一起顺着所有躯干骨骼弯，
 * 到 to 换成只跟自己的脊柱弯，之间渐变（按标准人台的尺寸）。胸整只只跟自己的脊柱（见 chestDrafts）。
 * 下沿和胯叠着的那一截两边是同一张皮，要和胯一样弯，不然错开、肚子上横着一道锯齿缝；往上整个一起弯的话，胸根（跟着自己的脊柱）和躯干对不上，
 * 里侧胸根一圈毛边，两个身子之间冒出几块方块。
 * 胸也照躯干这种渐变弯的话不行：大胸的下半截正在渐变的那一段里，被拽向两个身子正中，里侧胸的下角拉尖
 */
const OWN_BEND: [from: number, to: number] = [0.06, 0.2];
/** 两个上半身直立并排时，胸上离胸表面这么远以外的点不再看切口（按标准人台的尺寸，见 chestDrafts） */
const CHEST_FAR = 0.06;
/** 顺着好几节骨骼弯时，一节骨骼在一个基本体上哪儿都占不到这么多，就不算它（见 bendMap 的 focus） */
const FOCUS_LEAST = 1e-3;

/** 一个关节：父骨骼 above、子骨骼 below，切面过 at、法线 n 朝着子骨骼那边 */
interface Joint {
  above: number;
  below: number;
  at: V3;
  n: V3;
}

/** 部件的一段：跟着哪根骨骼；它占的地方是几个半空间的交（每个 4 个数：法线和偏移，n · q − c ≤ 0 的那一侧是它的） */
interface Piece {
  bone: number;
  planes: number[];
  /** 并排的几股里它是哪一股（手指）：只占离自己这一股最近的地方。mine / others 是骨骼线段，每段 6 个数 */
  mine?: number[];
  others?: number[];
}

interface Plan {
  pieces: Piece[];
  joints: Joint[];
}

/** 点到一串线段的最近距离 */
function nearSegments(segments: number[], x: number, y: number, z: number): number {
  let least = Infinity;
  for (let o = 0; o < segments.length; o += 6) {
    const ax = segments[o];
    const ay = segments[o + 1];
    const az = segments[o + 2];
    const bx = segments[o + 3] - ax;
    const by = segments[o + 4] - ay;
    const bz = segments[o + 5] - az;
    const l2 = bx * bx + by * by + bz * bz;
    let t = l2 > 0 ? ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - ax - bx * t;
    const dy = y - ay - by * t;
    const dz = z - az - bz * t;
    // 比较的是平方，最后才开方（这是逐点求值时调的，Math.hypot 慢得多）
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < least) least = d2;
  }
  return Math.sqrt(least);
}

/**
 * 带着好几根骨骼的部件怎么分段。bones：这个部件自己的骨骼（骨架里的下标）。
 * 腿的根（大腿和胯之间）也切一刀：髋关节以上的那一截留在胯上，不跟着大腿转出去。
 */
function planOf(part: Part, bones: number[], skeleton: Skeleton): Plan {
  const all = skeleton.bones;
  // 手是另外缝上去的现成网格时，手和手指不在距离场里（它们照自带的权重另外搬）：这些骨骼不用分段。
  // 手臂的距离场伸过手腕的那一小截留在前臂上，是直的——缝手的时候要在那里横着切一刀
  const sewn = new Set(part.grafts?.flatMap((graft) => graft.rigid));
  const used = bones.filter((b) => !sewn.has(all[b].name));
  const inside = new Set(used);
  const way = (b: number): V3 => unit([all[b].tail[0] - all[b].head[0], all[b].tail[1] - all[b].head[1], all[b].tail[2] - all[b].head[2]]) ?? [0, 1, 0];
  const joints: Joint[] = [];
  const planes = new Map<number, number[]>();
  const cut = (bone: number, n: V3, at: V3, sign: number) => {
    const list = planes.get(bone) ?? [];
    list.push(n[0] * sign, n[1] * sign, n[2] * sign, dot(n, at) * sign);
    planes.set(bone, list);
  };
  for (const b of used) {
    const up = all[b].parent;
    if (up < 0) continue;
    let n: V3 | null = null;
    if (inside.has(up)) {
      const a = way(up);
      const c = way(b);
      // 两节骨骼的角平分面；折回去的（几乎反向）就照子骨骼的方向切
      n = unit([a[0] + c[0], a[1] + c[1], a[2] + c[2]]);
      if (!n || dot(a, c) < -0.5) n = c;
      // 肩关节（锁骨和上臂之间；锁骨躺在躯干里）：垂直于上臂切。手臂的根在关节里侧还连着一圈皮（腋下那一片），
      // 照角平分面切的话有一部分会划到上臂这边，手一举高就跟着翻出来；垂直于上臂切，关节里侧的都留在原地
      if (part.type === 'arm' && !inside.has(all[up].parent)) n = c;
    } else if (part.type === 'leg') {
      n = way(b);
    }
    if (!n) continue;
    const at = all[b].head;
    joints.push({ above: up, below: b, at, n });
    cut(up, n, at, 1);
    cut(b, n, at, -1);
  }
  // 并排的几股（手指）：每一股只占离自己最近的地方
  const strands = new Map<string, number[]>();
  for (const b of used) {
    const name = all[b].strand;
    if (!name) continue;
    const list = strands.get(name) ?? [];
    list.push(...all[b].head, ...all[b].tail);
    strands.set(name, list);
  }
  const pieces: Piece[] = [...new Set([...used, ...joints.map((j) => j.above)])].map((bone) => {
    const piece: Piece = { bone, planes: planes.get(bone) ?? [] };
    const name = all[bone].strand;
    if (name && strands.size > 1 && inside.has(bone)) {
      piece.mine = strands.get(name)!;
      piece.others = [...strands].filter(([other]) => other !== name).flatMap(([, list]) => list);
    }
    return piece;
  });
  return { pieces, joints };
}

/** 正放的盒子的 8 个角（排法同 Draft.corners） */
const boxCorners = (box: readonly number[]): number[] =>
  Array.from({ length: 8 }, (_, i) => [box[i & 1 ? 3 : 0], box[i & 2 ? 4 : 1], box[i & 4 ? 5 : 2]]).flat();

/** 8 个角围成的盒子的 12 条棱，每条两个端点 */
function edgesOf(corners: readonly number[]): number[][] {
  const corner = (i: number): number[] => corners.slice(i * 3, i * 3 + 3);
  const edges: number[][] = [];
  for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) edges.push([...corner(i), ...corner(i | bit)]);
  return edges;
}

/**
 * 基本体的盒子的 12 条棱（斜着放的用它自己那个斜的盒子：紧得多）。采样出来的形状用的是连留白的整块格子（见 Draft.outerCorners）：
 * 分段、补楔形都照它来
 */
const boxEdges = (d: Draft): number[][] => edgesOf(d.outerCorners ?? d.corners ?? boxCorners(d.box));

interface Frame {
  /** 一个角 */
  origin: V3;
  /** 三根轴（单位向量） */
  axes: V3[];
  /** 三边各多长 */
  lengths: number[];
}

/** 只包住表面的那个盒子（见 Draft.corners）沿自己的三根轴往外胀 grow；有一边几乎是零宽的就算不出来 */
function tightFrame(d: Draft, grow: number): Frame | null {
  const c = d.corners ?? boxCorners(d.box);
  const axes: V3[] = [];
  const lengths: number[] = [];
  for (const i of [1, 2, 4]) {
    const v: V3 = [c[i * 3] - c[0], c[i * 3 + 1] - c[1], c[i * 3 + 2] - c[2]];
    const length = Math.sqrt(dot(v, v));
    if (length < 1e-9) return null;
    axes.push([v[0] / length, v[1] / length, v[2] / length]);
    lengths.push(length + 2 * grow);
  }
  const origin: V3 = [0, 1, 2].map((k) => c[k] - grow * (axes[0][k] + axes[1][k] + axes[2][k])) as V3;
  return { origin, axes, lengths };
}

/** 盒子的 8 个角（排法同 Draft.corners）：沿三根轴各从 lo 到 hi */
const frameCorners = ({ origin, axes, lengths }: Frame, lo: readonly number[] = [0, 0, 0], hi: readonly number[] = lengths): number[] =>
  Array.from({ length: 8 }, (_, i) =>
    [0, 1, 2].map((k) => origin[k] + axes[0][k] * (i & 1 ? hi[0] : lo[0]) + axes[1][k] * (i & 2 ? hi[1] : lo[1]) + axes[2][k] * (i & 4 ? hi[2] : lo[2])),
  ).flat();

/** 只包住表面的盒子胀 CULL_GROW 以后的 8 个角 */
function tightCorners(d: Draft): number[] {
  const frame = tightFrame(d, CULL_GROW);
  return frame ? frameCorners(frame) : boxCorners(d.box);
}

/** 一串线段只留下半空间 n · q − c ≤ slack 里的部分 */
function clipSegments(segments: number[][], plane: number[], o: number, slack: number): number[][] {
  const out: number[][] = [];
  for (const s of segments) {
    const a = plane[o] * s[0] + plane[o + 1] * s[1] + plane[o + 2] * s[2] - plane[o + 3] - slack;
    const b = plane[o] * s[3] + plane[o + 1] * s[4] + plane[o + 2] * s[5] - plane[o + 3] - slack;
    if (a > 0 && b > 0) continue;
    if (a <= 0 && b <= 0) {
      out.push(s);
      continue;
    }
    const t = a / (a - b);
    const mid = [s[0] + (s[3] - s[0]) * t, s[1] + (s[4] - s[1]) * t, s[2] + (s[5] - s[2]) * t];
    out.push(a <= 0 ? [s[0], s[1], s[2], ...mid] : [...mid, s[3], s[4], s[5]]);
  }
  return out;
}

/** 把第 bone 根骨骼「搬回静止位置」的动作写成对偶四元数（8 个数）：旋转是共轭，平移是 −Rᵀ · t */
function backOf(m: PoseMatrices, bone: number): number[] {
  const o = bone * 12;
  const q = turnOf(m, o);
  const [x, y, z, w] = [-q[0], -q[1], -q[2], q[3]];
  const tx = -(m[o] * m[o + 9] + m[o + 3] * m[o + 10] + m[o + 6] * m[o + 11]);
  const ty = -(m[o + 1] * m[o + 9] + m[o + 4] * m[o + 10] + m[o + 7] * m[o + 11]);
  const tz = -(m[o + 2] * m[o + 9] + m[o + 5] * m[o + 10] + m[o + 8] * m[o + 11]);
  return [x, y, z, w, 0.5 * (tx * w + ty * z - tz * y), 0.5 * (ty * w + tz * x - tx * z), 0.5 * (tz * w + tx * y - ty * x), -0.5 * (tx * x + ty * y + tz * z)];
}

/** 照一个对偶四元数（8 个数，已经归一）搬一个点，结果写进 out */
function moveBy(d: ArrayLike<number>, x: number, y: number, z: number, out: Float64Array) {
  const rx = d[0];
  const ry = d[1];
  const rz = d[2];
  const rw = d[3];
  const cx = ry * z - rz * y + rw * x;
  const cy = rz * x - rx * z + rw * y;
  const cz = rx * y - ry * x + rw * z;
  out[0] = x + 2 * (ry * cz - rz * cy) + 2 * (rw * d[4] - d[7] * rx + ry * d[6] - rz * d[5]);
  out[1] = y + 2 * (rz * cx - rx * cz) + 2 * (rw * d[5] - d[7] * ry + rz * d[4] - rx * d[6]);
  out[2] = z + 2 * (rx * cy - ry * cx) + 2 * (rw * d[6] - d[7] * rz + rx * d[5] - ry * d[4]);
}

/** 一截不在骨架里的线段（静止时的位置，6 个数），跟着第 bone 根骨骼动（见 bendMap） */
interface Stub {
  bone: number;
  seg: number[];
}

/**
 * 「顺着 bones 这几节骨骼弯过去」倒着算：摆好以后的点 p，先看它离各节骨骼（摆好以后的）多远，
 * 照远近把这几节「搬回静止位置」的动作混在一起，搬回去——map 把静止时的位置写进 out。
 * box：一个静止时的基本体这么弯过去以后占多大地方。
 * stubs：另外加进来一起算的几截线段（离它近的地方就跟着它那根骨骼）。
 * focus：只给这个基本体用的话，在它盒子的哪个角、中心都占不到千分之一的那几节不算（好几个上半身时躯干一起顺着十几节弯，见 shared）
 */
function bendMap(bones: number[], skeleton: Skeleton, m: PoseMatrices, stubs: Stub[] = [], focus?: Draft) {
  let carriers: Stub[] = [...bones.map((b) => ({ bone: b, seg: [...skeleton.bones[b].head, ...skeleton.bones[b].tail] })), ...stubs];
  if (focus && carriers.length > 1) {
    const points = boxEdges(focus).flatMap((e) => [e.slice(0, 3), e.slice(3)]);
    points.push([0, 1, 2].map((k) => points.reduce((sum, p) => sum + p[k], 0) / points.length));
    const most = carriers.map(() => 0);
    for (const p of points) {
      const w = carriers.map(({ seg: s }) => 1 / (nearSegments(s, p[0], p[1], p[2]) ** 2 + SOFT) ** 2);
      const total = w.reduce((a, b) => a + b, 0);
      w.forEach((v, j) => (most[j] = Math.max(most[j], v / total)));
    }
    const kept = carriers.filter((_, j) => most[j] >= FOCUS_LEAST);
    if (kept.length) carriers = kept;
  }
  const count = carriers.length;
  // 每节骨骼：静止时的线段（6 个数）、矩阵（12 个数）、「搬回去」这个动作的对偶四元数（8 个数）
  const seg = new Float64Array(count * 6);
  const mat = new Float64Array(count * 12);
  const back = new Float64Array(count * 8);
  carriers.forEach(({ bone: b, seg: line }, j) => {
    seg.set(line, j * 6);
    for (let k = 0; k < 12; k++) mat[j * 12 + k] = m[b * 12 + k];
    back.set(backOf(m, b), j * 8);
  });
  /** 一个静止时的点离第 j 节骨骼有多远（距离的平方） */
  const far2 = (j: number, x: number, y: number, z: number) => {
    const o = j * 6;
    const bx = seg[o + 3] - seg[o];
    const by = seg[o + 4] - seg[o + 1];
    const bz = seg[o + 5] - seg[o + 2];
    const px = x - seg[o];
    const py = y - seg[o + 1];
    const pz = z - seg[o + 2];
    const l2 = bx * bx + by * by + bz * bz;
    let t = l2 > 0 ? (px * bx + py * by + pz * bz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - bx * t;
    const dy = py - by * t;
    const dz = pz - bz * t;
    return dx * dx + dy * dy + dz * dz;
  };
  const mixed = new Float64Array(8);
  const map = (x: number, y: number, z: number, out: Float64Array) => {
    let rx = 0;
    let ry = 0;
    let rz = 0;
    let rw = 0;
    let ex = 0;
    let ey = 0;
    let ez = 0;
    let ew = 0;
    for (let j = 0; j < count; j++) {
      // 这个点要是跟着第 j 节，静止时在哪；离那一节多远
      const o = j * 12;
      const dx = x - mat[o + 9];
      const dy = y - mat[o + 10];
      const dz = z - mat[o + 11];
      const d2 = far2(j, mat[o] * dx + mat[o + 3] * dy + mat[o + 6] * dz, mat[o + 1] * dx + mat[o + 4] * dy + mat[o + 7] * dz, mat[o + 2] * dx + mat[o + 5] * dy + mat[o + 8] * dz) + SOFT;
      let w = 1 / (d2 * d2);
      const k = j * 8;
      // 同一个旋转有正负两种写法：都换成和第一节同一边的
      if (back[k] * back[0] + back[k + 1] * back[1] + back[k + 2] * back[2] + back[k + 3] * back[3] < 0) w = -w;
      rx += w * back[k];
      ry += w * back[k + 1];
      rz += w * back[k + 2];
      rw += w * back[k + 3];
      ex += w * back[k + 4];
      ey += w * back[k + 5];
      ez += w * back[k + 6];
      ew += w * back[k + 7];
    }
    const scale = 1 / (Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw) || 1);
    mixed[0] = rx * scale;
    mixed[1] = ry * scale;
    mixed[2] = rz * scale;
    mixed[3] = rw * scale;
    mixed[4] = ex * scale;
    mixed[5] = ey * scale;
    mixed[6] = ez * scale;
    mixed[7] = ew * scale;
    moveBy(mixed, x, y, z, out);
  };
  // 包围盒：盒子的每个角（和中心）主要跟着哪几节，就照那几节各搬一遍，都包进来
  const box = (d: Draft): number[] => {
    const corners = boxEdges(d).flatMap((s) => [s.slice(0, 3), s.slice(3)]);
    const middle = [0, 1, 2].map((k) => corners.reduce((sum, c) => sum + c[k], 0) / corners.length);
    const near = new Set<number>();
    for (const c of [...corners, middle]) {
      const w = carriers.map((_, j) => 1 / (far2(j, c[0], c[1], c[2]) + SOFT) ** 2);
      const total = w.reduce((a, b) => a + b, 0);
      w.forEach((v, j) => {
        if (v > 0.01 * total) near.add(j);
      });
    }
    const out = [BIG, BIG, BIG, -BIG, -BIG, -BIG];
    for (const j of near) {
      for (const c of corners) {
        const p = carried(mat, j * 12, c);
        for (let k = 0; k < 3; k++) {
          out[k] = Math.min(out[k], p[k]);
          out[k + 3] = Math.max(out[k + 3], p[k]);
        }
      }
    }
    const pad = MARGIN + 0.03 * Math.max(out[3] - out[0], out[4] - out[1], out[5] - out[2]);
    for (let k = 0; k < 3; k++) {
      out[k] -= pad;
      out[k + 3] += pad;
    }
    return out;
  };
  return { map, box };
}

/** 「倒着搬回静止位置」的一种办法（见 bendMap、apartMap） */
type Back = {
  map: (x: number, y: number, z: number, out: Float64Array) => void;
  box: (d: Draft) => number[];
};

/** 一个静止时的基本体，顺着 bones 这几节骨骼弯过去（不分段，见 bendMap）；made：另给的弯法（见 apartMap） */
function bendDraft(d: Draft, bones: number[], skeleton: Skeleton, m: PoseMatrices, fadeAt: V3 | null, root: number[] | undefined, out: Draft[], stubs: Stub[] = [], focus = false, made?: (d: Draft) => Back) {
  const f = draftDist(d);
  const bend = made ? made(d) : bendMap(bones, skeleton, m, stubs, focus ? d : undefined);
  const q = new Float64Array(3);
  out.push({
    type: T_CUSTOM,
    group: d.group,
    nums: [],
    mode: d.mode,
    k: d.k,
    custom: (x, y, z) => {
      bend.map(x, y, z, q);
      return f(q[0], q[1], q[2]);
    },
    box: bend.box(d),
    // 网格化时判断远近用的：只包住表面的盒子（胀一点）弯过去以后占的地方
    ...(d.span ? { cull: [boxCorners(bend.box({ ...d, corners: tightCorners(d), outerCorners: undefined }))] } : {}),
    ...(d.fade && fadeAt ? { fade: [fadeAt[0], fadeAt[1], fadeAt[2], d.fade[3], d.fade[4]] } : {}),
    ...(root ? { root } : {}),
  });
}

/** 一个静止时的基本体，照分段的办法搬到摆好的位置：每一段一个、每个弯了的关节再补一个楔形 */
function poseDraft(d: Draft, plan: Plan, m: PoseMatrices, fadeAt: V3 | null, root: number[] | undefined, drafts: Draft[]) {
  const f = draftDist(d);
  const edges = boxEdges(d);
  // 网格化时判断远近用的：只包住表面的盒子（胀一点），每一段切出它的那一截（见 CULL_GROW）
  const frame = tightFrame(d, CULL_GROW);
  const tightEdges = frame ? edgesOf(frameCorners(frame)) : [];
  // 先收在这里：圆滑加上去的、挖掉的基本体，它的几段最后要并成一个再往身上加（见下面）
  const out: Draft[] = [];
  const base = {
    type: T_CUSTOM,
    group: d.group,
    nums: [] as number[],
    mode: d.mode,
    k: d.k,
    ...(d.fade && fadeAt ? { fade: [fadeAt[0], fadeAt[1], fadeAt[2], d.fade[3], d.fade[4]] } : {}),
    ...(root ? { root } : {}),
  };

  for (const piece of plan.pieces) {
    const { planes, mine, others } = piece;
    let left = edges;
    for (let o = 0; o < planes.length && left.length; o += 4) left = clipSegments(left, planes, o, MARGIN + OVERLAP);
    if (!left.length) continue;
    const o = piece.bone * 12;
    let near = tightEdges;
    for (let k = 0; k < planes.length && near.length; k += 4) near = clipSegments(near, planes, k, MARGIN + OVERLAP + CULL_GROW);
    // 切出来的那一截沿盒子自己的三根轴各占多少，再搬到摆好的位置；一点都没切到的不用这个判断
    let cull: number[][] | undefined;
    if (frame && near.length) {
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (const seg of near) {
        for (const at of [0, 3]) {
          for (let k = 0; k < 3; k++) {
            const t = (seg[at] - frame.origin[0]) * frame.axes[k][0] + (seg[at + 1] - frame.origin[1]) * frame.axes[k][1] + (seg[at + 2] - frame.origin[2]) * frame.axes[k][2];
            lo[k] = Math.min(lo[k], t - MARGIN);
            hi[k] = Math.max(hi[k], t + MARGIN);
          }
        }
      }
      const rest = frameCorners(frame, lo, hi);
      cull = [Array.from({ length: 8 }, (_, i) => carried(m, o, rest.slice(i * 3, i * 3 + 3))).flat()];
    }
    const box = [BIG, BIG, BIG, -BIG, -BIG, -BIG];
    for (const s of left) {
      for (const p of [carried(m, o, s), carried(m, o, s.slice(3))]) {
        for (let k = 0; k < 3; k++) {
          box[k] = Math.min(box[k], p[k] - MARGIN);
          box[k + 3] = Math.max(box[k + 3], p[k] + MARGIN);
        }
      }
    }
    const [r0, r1, r2, r3, r4, r5, r6, r7, r8, t0, t1, t2] = Array.from({ length: 12 }, (_, k) => m[o + k]);
    const count = planes.length;
    const custom: Dist = (x, y, z) => {
      // 摆好以后的点搬回静止时的位置：q = Rᵀ · (p − t)
      const dx = x - t0;
      const dy = y - t1;
      const dz = z - t2;
      const qx = r0 * dx + r3 * dy + r6 * dz;
      const qy = r1 * dx + r4 * dy + r7 * dz;
      const qz = r2 * dx + r5 * dy + r8 * dz;
      let v = f(qx, qy, qz);
      for (let k = 0; k < count; k += 4) {
        const c = planes[k] * qx + planes[k + 1] * qy + planes[k + 2] * qz - planes[k + 3] - OVERLAP;
        if (c > v) v = c;
      }
      if (mine) {
        const c = (nearSegments(mine, qx, qy, qz) - nearSegments(others!, qx, qy, qz)) / 2;
        if (c > v) v = c;
      }
      return v;
    };
    out.push({ ...base, custom, box, ...(cull ? { cull } : {}) });
  }

  for (const joint of plan.joints) {
    const a = joint.above * 12;
    const c = joint.below * 12;
    if (same(m, a, c)) continue;
    const { n, at } = joint;
    // 子骨骼相对父骨骼转了多少：R = Raᵀ · Rc，分成绕 n 拧的和把 n 扳歪的两部分
    const rel = quatMul([-turnOf(m, a)[0], -turnOf(m, a)[1], -turnOf(m, a)[2], turnOf(m, a)[3]], turnOf(m, c));
    const along = rel[0] * n[0] + rel[1] * n[1] + rel[2] * n[2];
    const size = Math.hypot(along, rel[3]);
    const twist: Quat = size > 1e-9 ? [(n[0] * along) / size, (n[1] * along) / size, (n[2] * along) / size, rel[3] / size] : [0, 0, 0, 1];
    let swing = quatMul(rel, [-twist[0], -twist[1], -twist[2], twist[3]]);
    if (swing[3] < 0) swing = [-swing[0], -swing[1], -swing[2], -swing[3]];
    const theta = 2 * Math.acos(Math.min(1, swing[3]));
    if (theta < BENT) continue;
    const axis = unit([swing[0], swing[1], swing[2]]);
    if (!axis) continue;
    // 拧了多少（绕 n，−π ~ π）
    let tau = 2 * Math.atan2(along, rel[3]);
    if (tau > Math.PI) tau -= 2 * Math.PI;
    else if (tau < -Math.PI) tau += 2 * Math.PI;
    const side = cross(axis, n);
    // 切面和这个基本体的包围盒交出来的那一片有多大：楔形最多伸到这么远
    const offset = dot(n, at);
    const reachOf = (lines: number[][]) => {
      let far = 0;
      for (const s of lines) {
        const p = n[0] * s[0] + n[1] * s[1] + n[2] * s[2] - offset;
        const q = n[0] * s[3] + n[1] * s[4] + n[2] * s[5] - offset;
        if ((p > 0 && q > 0) || (p < 0 && q < 0) || p === q) continue;
        const t = p / (p - q);
        far = Math.max(far, Math.hypot(s[0] + (s[3] - s[0]) * t - at[0], s[1] + (s[4] - s[1]) * t - at[1], s[2] + (s[5] - s[2]) * t - at[2]));
      }
      return far && far + MARGIN;
    };
    const reach = reachOf(edges);
    if (!reach) continue;
    const [r0, r1, r2, r3, r4, r5, r6, r7, r8, t0, t1, t2] = Array.from({ length: 12 }, (_, k) => m[a + k]);
    // 楔形占的地方：绕轴从 0 转到 theta 的那一瓣，离关节不超过 far。在这一瓣的边上取一些点把它包起来
    const sector = (far: number) => {
      const box = [BIG, BIG, BIG, -BIG, -BIG, -BIG];
      const steps = Math.max(1, Math.ceil(theta / 0.26));
      for (let i = 0; i <= steps; i++) {
        const psi = (theta * i) / steps;
        const out = [n[0] * Math.sin(psi) - side[0] * Math.cos(psi), n[1] * Math.sin(psi) - side[1] * Math.cos(psi), n[2] * Math.sin(psi) - side[2] * Math.cos(psi)];
        for (let j = -3; j <= 3; j++) {
          const phi = (j * Math.PI) / 6;
          const p = carried(m, a, [
            at[0] + far * (axis[0] * Math.sin(phi) + out[0] * Math.cos(phi)),
            at[1] + far * (axis[1] * Math.sin(phi) + out[1] * Math.cos(phi)),
            at[2] + far * (axis[2] * Math.sin(phi) + out[2] * Math.cos(phi)),
          ]);
          for (let k = 0; k < 3; k++) {
            // 取的点之间隔着十几度，边上再留百分之几
            box[k] = Math.min(box[k], p[k] - 0.04 * far - MARGIN);
            box[k + 3] = Math.max(box[k + 3], p[k] + 0.04 * far + MARGIN);
          }
        }
      }
      return box;
    };
    const box = sector(reach);
    // 网格化时判断远近用的：照只包住表面的盒子（胀一点）算的那一瓣
    const tightReach = frame ? reachOf(tightEdges) : 0;
    const cull = tightReach ? [boxCorners(sector(tightReach))] : undefined;
    const custom: Dist = (x, y, z) => {
      const dx = x - t0;
      const dy = y - t1;
      const dz = z - t2;
      // 在父骨骼自己的坐标里看（父骨骼那一段是静止的），相对关节的位置
      const ux = r0 * dx + r3 * dy + r6 * dz - at[0];
      const uy = r1 * dx + r4 * dy + r7 * dz - at[1];
      const uz = r2 * dx + r5 * dy + r8 * dz - at[2];
      const xn = ux * n[0] + uy * n[1] + uz * n[2];
      if (xn <= 0) return BIG;
      const xm = ux * side[0] + uy * side[1] + uz * side[2];
      // 绕着关节的轴，从父骨骼的切面量起转过了多少；到子骨骼的切面是 theta
      const psi = Math.atan2(xn, -xm);
      if (psi >= theta) return BIG;
      const r = Math.sqrt(xn * xn + xm * xm);
      const h = ux * axis[0] + uy * axis[1] + uz * axis[2];
      // 转回切面上：离轴 r、沿轴 h
      let px = axis[0] * h - side[0] * r;
      let py = axis[1] * h - side[1] * r;
      let pz = axis[2] * h - side[2] * r;
      if (tau) {
        // 子骨骼还拧了 tau：轮廓从父骨骼这边到子骨骼那边慢慢拧过去（切面上的点绕 n 转）
        const turn = (-tau * psi) / theta;
        const cos = Math.cos(turn);
        const sin = Math.sin(turn);
        const cx = n[1] * pz - n[2] * py;
        const cy = n[2] * px - n[0] * pz;
        const cz = n[0] * py - n[1] * px;
        px = px * cos + cx * sin;
        py = py * cos + cy * sin;
        pz = pz * cos + cz * sin;
      }
      return f(at[0] + px, at[1] + py, at[2] + pz);
    };
    out.push({ ...base, custom, box, ...(cull ? { cull } : {}) });
  }

  // 硬接的基本体：几段各自算一个（各有各的包围盒，离得远的小块不用算它）
  if (!d.mode || out.length < 2) {
    drafts.push(...out);
    return;
  }
  // 圆滑加上去的、挖掉的：几段先直接取并集，当成一个基本体再圆滑地加（挖）。
  // 各自圆滑地加的话，相邻两段叠着的地方（值差不多大）会各鼓出一圈，关节上就多出一道棱
  const each = out.map((one) => ({ custom: one.custom!, box: one.box }));
  // 网格化时判断远近用的：各段的都并进来；有一段没有的话就都不用
  const cull = out.every((one) => one.cull) ? out.flatMap((one) => one.cull!) : undefined;
  const box = [BIG, BIG, BIG, -BIG, -BIG, -BIG];
  for (const one of each) {
    for (let k = 0; k < 3; k++) {
      box[k] = Math.min(box[k], one.box[k]);
      box[k + 3] = Math.max(box[k + 3], one.box[k + 3]);
    }
  }
  // 离哪一段的盒子都远的点：给一个不小于「到最近那个盒子的距离」的值就行（只要是正的、够大）
  const slack = Math.max(d.k ?? 0, 0) + 0.05;
  const custom: Dist = (x, y, z) => {
    let v = BIG;
    for (const one of each) {
      const b = one.box;
      if (x < b[0] - slack || x > b[3] + slack || y < b[1] - slack || y > b[4] + slack || z < b[2] - slack || z > b[5] + slack) continue;
      const c = one.custom(x, y, z);
      if (c < v) v = c;
    }
    return v;
  };
  drafts.push({ ...base, custom, box, ...(cull ? { cull } : {}) });
}

/** 这副身体是不是照着现成的模型一块块采样出来的（二次元素体）。阴囊也是采样的格子，但它是加在身上的，不算 */
export const isSampled = (parts: Part[]): boolean => parts.some((part) => part.type !== 'genital' && part.prims.some((prim) => prim.kind === 'grid'));

/** 采样出来的腿上每根骨骼，和带着那条腿的骨骼（往上数第一根不属于同一个部件的）：成对的下标 */
/** 照着现成的模型采样出来的腿（二次元素体）：这些部件的名字 */
const sampledLegs = (figure: Pick<Figure, 'parts'>) => figure.parts.filter((part) => part.type === 'leg' && part.prims.some((prim) => prim.kind === 'grid')).map((part) => part.name);

function sampledLegBones(figure: Pick<Figure, 'parts' | 'scale'>, skeleton: Skeleton): number[] {
  const legs = new Set(sampledLegs(figure));
  const pairs: number[] = [];
  skeleton.bones.forEach((bone, i) => {
    if (!legs.has(bone.part)) return;
    let up = bone.parent;
    while (up >= 0 && skeleton.bones[up].part === bone.part) up = skeleton.bones[up].parent;
    if (up >= 0) pairs.push(i, up);
  });
  return pairs;
}

/**
 * 照着现成的模型采样出来的腿（二次元素体）不在距离场里摆（原因见文件开头）：把姿势里这些腿的骨骼都换成
 * 带着那条腿的骨骼（胯）的动作，照这个去融合，腿就整个跟着胯、和躯干像静止时那样合着。
 * 返回换过的姿势，和换了哪些骨骼（bones：成对的下标，腿上的骨骼、带着它的骨骼）——融合完要照蒙皮权重把腿搬过去；
 * legs：这些腿（部件的名字）。没有这种腿、或者腿相对胯没动过，返回 null
 */
export function heldLegs(figure: Pick<Figure, 'parts' | 'scale'>, matrices: PoseMatrices): { matrices: Float64Array; bones: number[]; legs: string[] } | null {
  if (!isSampled(figure.parts)) return null;
  const bones = sampledLegBones(figure, buildSkeleton(figure));
  const held = Float64Array.from(matrices);
  let moved = false;
  for (let p = 0; p < bones.length; p += 2) {
    const a = bones[p] * 12;
    const b = bones[p + 1] * 12;
    for (let k = 0; k < 12; k++) {
      if (Math.abs(held[a + k] - matrices[b + k]) > SAME) moved = true;
      held[a + k] = matrices[b + k];
    }
  }
  return moved ? { matrices: held, bones, legs: sampledLegs(figure) } : null;
}

/**
 * 这副身体摆了姿势以后要不要照这里的办法重新融合（不要的话，调用的地方接着用照权重弯的那张网格）。
 * 白模人台（部件都是一节一节的圆台、椭球）：要。
 * 照着现成的模型采样出来的身体（二次元素体）：几条手臂挤在同一个肩膀上的才要——
 * 一个肩膀上只有一条手臂的，照权重弯出来的肩膀本来就比重新融合的（换成圆肩头的）自然，不用换；
 * 挤在一个肩膀上的几条才是照权重弯不好的：肩头鼓成一团，手臂之间扯着皮。
 * 好几个上半身的也要：挤在一起的胸照权重弯会被拉成管子（见文件开头）。
 * matrices 只用来核对骨骼数。
 */
export function refusable(figure: Pick<Figure, 'parts' | 'scale'>, matrices: PoseMatrices): boolean {
  let known = sampledBodies.get(figure.parts);
  if (!known) {
    // 有没有两条手臂的肩关节挨着（长在同一个部件上、同一侧、离得不到 CROWDED）
    const arms = figure.parts.filter((part) => part.type === 'arm');
    const crowded = arms.some((one, i) =>
      arms.some((other, j) => j > i && other.parent === one.parent && other.side === one.side && Math.hypot(other.pos[0] - one.pos[0], other.pos[1] - one.pos[1], other.pos[2] - one.pos[2]) < CROWDED),
    );
    known = { bones: buildSkeleton(figure).bones.length, sampled: isSampled(figure.parts), crowded, bodies: severalBodies(figure.parts) };
    sampledBodies.set(figure.parts, known);
  }
  if (matrices.length !== known.bones * 12) return false;
  return !known.sampled || known.crowded || known.bodies;
}
/** 每副身体只看一遍：骨架多少根骨骼、是不是采样出来的、手臂挤不挤、是不是好几个上半身 */
const sampledBodies = new WeakMap<object, { bones: number; sampled: boolean; crowded: boolean; bodies: boolean }>();
/** 好几个上半身（UpperBody、UpperBody_L …，见 geometry/torsos.ts） */
const severalBodies = (parts: Part[]): boolean => parts.filter((part) => /^UpperBody/.test(part.name)).length > 1;

/** 挖开的边上圆角多大（几个 margin，见 Room.soft） */
const CARVE_SOFT = 1.5;

/**
 * 一处要空出来的地方（摆好以后的世界坐标）：名叫 part 的那个部件在一段圆柱（从 a 起、沿 axis 长 length、半径 radius）里的那一截——
 * carve 的话，它周围两个体素以内别的部件挤进来的部分都挖掉；不 carve 的只是不让别处的把这个部件自己挖掉。
 * 给手腕用，见 graft.ts 的 wristRooms、fuse.ts
 */
export interface Room {
  part: string;
  a: V3;
  axis: V3;
  length: number;
  radius: number;
  carve: boolean;
  /** 挖开的边上圆个圆角（CARVE_SOFT 个 margin）。圆了以后有的手腕缝得上，有的反而缝不上（见 fuse.ts） */
  soft?: boolean;
}

/** 胸那一带离躯干多远的格子隔多远一格（按标准人台的尺寸）：只用来定胸上一点跟躯干还是跟自己的上半身（见 SHARED_LIFT），粗一点没关系 */
const TORSO_CELL = 0.008;
/** 烤好的「胸那一带离躯干多远」：静止时的躯干不随姿势变，换着姿势重新融合时不用重烤（照躯干、胸部件本身认） */
const torsoBaked = new Map<string, Dist>();

/**
 * 好几个上半身时，静止时胸那一带（几个胸部件的盒子再往外两厘米）离躯干表面多远（几块躯干取并集）：烤成 TORSO_CELL 一格的格子，三线性插值，
 * 出了格子照最近的格点。每个胸上的点都现算的话，三块躯干的格子带着各种变形要算一遍，重新融合慢四五倍
 */
function torsoNearChests(parts: Part[], xfs: Map<string, WorldXf>, minR: number): Dist {
  const torsos = parts.filter((part) => part.type === 'torso');
  const chests = parts.filter((part) => part.type === 'chest');
  const key = JSON.stringify([torsos, chests.map((part) => [part.name, part.pos, part.parent])]);
  const known = torsoBaked.get(key);
  if (known) return known;
  const list: Draft[] = [];
  for (const part of torsos) partDrafts(part, xfs.get(part.name)!, 0, minR, list);
  const fs = list.map(draftDist);
  const exact = (x: number, y: number, z: number) => {
    let v = BIG;
    for (const f of fs) {
      const d = f(x, y, z);
      if (d < v) v = d;
    }
    return v;
  };
  const boxes: Draft[] = [];
  for (const part of chests) partDrafts(part, xfs.get(part.name)!, 0, minR, boxes);
  // 只是看看要烤哪些胸（见 grids.ts 的 neededChests；上面这几个胸也记上了）：胸的范围框这时是现算的、大好几倍，
  // 照它烤出来的格子记下来的话，正式编译就用上了这份范围不一样的，网格跟着变。这一遍的场本来就不用，现算的对付
  if (collectingChests()) return exact;
  const scale = xfs.get(chests[0]?.name ?? '')?.scale ?? 1;
  const cell = TORSO_CELL * scale;
  const lo = [BIG, BIG, BIG];
  const hi = [-BIG, -BIG, -BIG];
  for (const d of boxes) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], d.box[k] - 0.02 * scale);
      hi[k] = Math.max(hi[k], d.box[k + 3] + 0.02 * scale);
    }
  }
  if (!boxes.length) return exact;
  const n = [0, 1, 2].map((k) => Math.max(2, Math.ceil((hi[k] - lo[k]) / cell) + 1));
  const data = new Float32Array(n[0] * n[1] * n[2]);
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) data[(k * n[1] + j) * n[0] + i] = exact(lo[0] + i * cell, lo[1] + j * cell, lo[2] + k * cell);
  const at = (v: number, k: number): [number, number] => {
    const f = Math.min(Math.max((v - lo[k]) / cell, 0), n[k] - 1.000001);
    const i = Math.floor(f);
    return [i, f - i];
  };
  const baked: Dist = (x, y, z) => {
    const [i, a] = at(x, 0);
    const [j, b] = at(y, 1);
    const [k, c] = at(z, 2);
    const o = (k * n[1] + j) * n[0] + i;
    const row = n[0];
    const plane = n[0] * n[1];
    const x00 = data[o] + (data[o + 1] - data[o]) * a;
    const x10 = data[o + row] + (data[o + row + 1] - data[o + row]) * a;
    const x01 = data[o + plane] + (data[o + plane + 1] - data[o + plane]) * a;
    const x11 = data[o + plane + row] + (data[o + plane + row + 1] - data[o + plane + row]) * a;
    const y0 = x00 + (x10 - x00) * b;
    const y1 = x01 + (x11 - x01) * b;
    return y0 + (y1 - y0) * c;
  };
  torsoBaked.set(key, baked);
  if (torsoBaked.size > 4) torsoBaked.delete(torsoBaked.keys().next().value!);
  return baked;
}

/**
 * 把一个 Figure 照摆好的姿势编译成距离场。matrices：每根骨骼的蒙皮矩阵（和 Figure 同单位）。
 * 眼睛不参与融合。场的坐标是摆好以后的世界坐标。rooms：要空出来的地方。
 */
export function compilePosedField(
  figure: Pick<Figure, 'parts' | 'scale'>,
  options: FieldOptions,
  matrices: PoseMatrices,
  rooms: Room[] = [],
): CompiledField {
  const skeleton = buildSkeleton(figure);
  if (matrices.length !== skeleton.bones.length * 12) throw new Error(t('姿势里有 {n} 根骨骼，骨架里是 {bones} 根', { n: matrices.length / 12, bones: skeleton.bones.length }));
  const xfs = worldTransforms(figure);
  const minR = options.minRadius ?? 0;
  const byName = new Map(figure.parts.map((part) => [part.name, part]));
  const own = new Map<string, number[]>();
  skeleton.bones.forEach((bone, i) => {
    const list = own.get(bone.part);
    if (list) list.push(i);
    else own.set(bone.part, [i]);
  });
  /** 没有自己骨骼的部件跟着父部件（再往上）的骨骼 */
  const bonesFor = (part: Part): number[] => {
    for (let p: Part | undefined = part; p; p = p.parent ? byName.get(p.parent) : undefined) {
      const list = own.get(p.name);
      if (list) return list;
    }
    return [0];
  };
  /** 离一个点最近的那根骨骼 */
  const nearest = (bones: number[], at: V3): number => {
    let best = bones[0];
    let least = Infinity;
    for (const b of bones) {
      const bone = skeleton.bones[b];
      const d = nearSegments([...bone.head, ...bone.tail], at[0], at[1], at[2]);
      if (d < least) {
        least = d;
        best = b;
      }
    }
    return best;
  };
  /** 整个部件跟着第 bone 根骨骼搬过去以后的摆放 */
  const moved = (xf: WorldXf, bone: number): WorldXf => {
    const o = bone * 12;
    if (isIdentity(matrices, o)) return xf;
    return { pos: carried(matrices, o, xf.pos), quat: quatMul(turnOf(matrices, o), xf.quat), scale: xf.scale };
  };

  /** 这个部件是不是转得离它本来合得上的方向太远了，该换另一套基本体（见 Part.posed） */
  const swapped = (part: Part): boolean => {
    const alt = part.posed;
    const mine = own.get(part.name);
    if (!alt || !mine) return false;
    const xf = xfs.get(part.name)!;
    const all = skeleton.bones;
    // 从这个部件的原点（关节）伸出去的那节骨骼；带着这个部件的那根外面的骨骼（锁骨接在它上面）
    const limb = mine.find((b) => Math.hypot(all[b].head[0] - xf.pos[0], all[b].head[1] - xf.pos[1], all[b].head[2] - xf.pos[2]) < 1e-6) ?? mine[0];
    const base = all[mine.find((b) => !mine.includes(all[b].parent)) ?? mine[0]].parent;
    const way = unit([all[limb].tail[0] - all[limb].head[0], all[limb].tail[1] - all[limb].head[1], all[limb].tail[2] - all[limb].head[2]]);
    if (!way) return false;
    const turn = (bone: number, v: readonly number[]): V3 => {
      if (bone < 0) return [v[0], v[1], v[2]];
      const o = bone * 12;
      return [
        matrices[o] * v[0] + matrices[o + 1] * v[1] + matrices[o + 2] * v[2],
        matrices[o + 3] * v[0] + matrices[o + 4] * v[1] + matrices[o + 5] * v[2],
        matrices[o + 6] * v[0] + matrices[o + 7] * v[1] + matrices[o + 8] * v[2],
      ];
    };
    const parent = part.parent ? xfs.get(part.parent) : undefined;
    const home = unit(turn(base, parent ? rotate(parent.quat, alt.home) : alt.home));
    return Boolean(home) && dot(turn(limb, way), home!) < Math.cos(alt.beyond);
  };

  /** 带着采样出来的腿的部件（躯干）：弯的时候每条腿的根上另加的那两截跟着胯的线段（见 PELVIS_STUB） */
  const pelvis = new Map<string, Stub[]>();
  {
    const pairs = sampledLegBones(figure, skeleton);
    for (let p = 0; p < pairs.length; p += 2) {
      const top = skeleton.bones[pairs[p]];
      const up = pairs[p + 1];
      // 只要每条腿最上面那一节（它的父骨骼就是带着这条腿的那根）
      if (top.parent !== up) continue;
      const host = skeleton.bones[up];
      const way = unit([top.tail[0] - top.head[0], top.tail[1] - top.head[1], top.tail[2] - top.head[2]]) ?? [0, -1, 0];
      const down = PELVIS_STUB.down * (xfs.get(top.part)?.scale ?? 1);
      const list = pelvis.get(host.part) ?? [];
      list.push({ bone: up, seg: [...top.head, top.head[0] + way[0] * down, top.head[1] + way[1] * down, top.head[2] + way[2] * down] }, { bone: up, seg: [...top.head, ...host.head] });
      pelvis.set(host.part, list);
    }
  }

  // 好几个上半身的二次元素体（见 SHARED_LIFT）：躯干那几块一起顺着所有躯干骨骼弯（腿根那几截也算上），胸根顺着自己那个上半身的脊柱弯
  const sampled = isSampled(figure.parts);
  const shared = sampled && severalBodies(figure.parts);
  /**
   * 一个上半身的二次元素体：胸整个和躯干一样弯（同一组骨骼、腿根那几截，见 bendDraft），胸根始终贴着躯干。
   * 好几个上半身的另有一套（见 chestDrafts）
   */
  const body = sampled && !shared ? figure.parts.find((part) => part.name === 'Torso') : undefined;
  const bodyBones = body ? (own.get(body.name) ?? []) : [];
  const bodyStubs = body ? (pelvis.get(body.name) ?? []) : [];
  const torsoParts = shared ? figure.parts.filter((part) => part.type === 'torso') : [];
  const torsoBones = torsoParts.flatMap((part) => own.get(part.name) ?? []);
  const torsoStubs = torsoParts.flatMap((part) => pelvis.get(part.name) ?? []);
  /**
   * 两个上半身直立并排：每个上半身是完整的一份躯干，上半身那份往上渐渐换成只跟自己的脊柱弯（见 OWN_BEND），胸只跟自己的脊柱。
   * 切开拼起来的——并成宽躯干切成两半的（clipX）、三个上半身和相邻的各留一半的（fork.split）——照旧整个一起弯，各跟各的话切面露出来
   */
  const apart =
    shared && !torsoParts.some((part) => part.prims.some((prim) => prim.kind === 'grid' && (prim.clipX !== undefined || !!prim.fork?.split?.length)));
  const apartMaps = new Map<string, (d: Draft) => Back>();
  /** 两个上半身直立并排时某个上半身那份躯干怎么倒着搬回去（见 OWN_BEND）；不是这种的 undefined */
  const apartMap = (name: string): ((d: Draft) => Back) | undefined => {
    if (!apart || !/^UpperBody/.test(name)) return undefined;
    const spine = own.get(name);
    if (!spine?.length) return undefined;
    let made = apartMaps.get(name);
    if (made) return made;
    const scale = xfs.get(name)?.scale ?? 1;
    const waist = Math.min(...spine.map((b) => skeleton.bones[b].head[1]));
    const [lo, hi] = OWN_BEND.map((v) => waist + v * scale);
    made = (d: Draft): Back => {
      const all = bendMap(torsoBones, skeleton, matrices, torsoStubs, d);
      const mine = bendMap(spine, skeleton, matrices, [], d);
      const a = new Float64Array(3);
      return {
        map: (x, y, z, out) => {
          mine.map(x, y, z, out);
          const t = (out[1] - lo) / (hi - lo);
          if (t >= 1) return;
          all.map(x, y, z, a);
          if (t <= 0) {
            out[0] = a[0];
            out[1] = a[1];
            out[2] = a[2];
            return;
          }
          const w = t * t * (3 - 2 * t);
          for (let k = 0; k < 3; k++) out[k] = a[k] + (out[k] - a[k]) * w;
        },
        box: (dd) => {
          const p = all.box(dd);
          const q = mine.box(dd);
          return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2]), Math.max(p[3], q[3]), Math.max(p[4], q[4]), Math.max(p[5], q[5])];
        },
      };
    };
    apartMaps.set(name, made);
    return made;
  };
  /** 静止时胸那一带离躯干表面多远（烤好的，见 torsoNearChests） */
  let torsoRest: Dist | null = null;
  const restTorso = (): Dist => (torsoRest ??= torsoNearChests(figure.parts, xfs, minR));
  /**
   * 胸（好几个上半身时）：离躯干表面 SHARED_LIFT[0] 以内顺着自己那个上半身的脊柱弯，到 SHARED_LIFT[1] 整个跟着那个上半身最近的那节骨骼，之间渐变。
   * 摆好以后的点先照「整个跟着那节骨骼」搬回去，照那里离躯干多远定跟谁、各跟多少。
   * 两个上半身直立并排时里侧的胸在两个身子正中间切齐（ChestShape.seam）：那一刀跟着躯干弯（两个身子正中间），不跟着胸——
   * 跟着胸的话两个身子一分开，两只胸各露出一个平的切面；跟着躯干的话切口落在两个身子正中间，分得开了就切不到胸，胸是圆的
   */
  const chestDrafts = (part: Part, xf: WorldXf, group: number) => {
    const bone = nearest(bonesFor(part), xf.pos);
    const o = bone * 12;
    const m = matrices;
    const torso = restTorso();
    const [near, far] = SHARED_LIFT.map((v) => v * xf.scale);
    const shape = part.prims.find((prim): prim is ChestShape => prim.kind === 'chest');
    const seam = shape?.seam;
    // 切齐的那一刀（静止时的世界坐标里）：n·p + c ≤ 0 的一侧留着
    const n = seam ? rotate(xf.quat, [seam[0], seam[1], seam[2]]) : [0, 0, 0];
    const c = seam && shape ? xf.scale * (seam[0] * shape.origin[0] + seam[1] * shape.origin[1] + seam[2] * shape.origin[2] - seam[3]) - dot(n, xf.pos) : 0;
    const rest: Draft[] = [];
    partDrafts(seam ? { ...part, prims: part.prims.map((prim) => (prim.kind === 'chest' ? { ...prim, seam: undefined } : prim)) } : part, xf, group, minR, rest);
    // 胸长在哪个上半身上：胸根只顺着它的脊柱弯（见 SHARED_LIFT）；找不到的照旧顺着所有躯干骨骼
    let body: Part | undefined = part;
    while (body && body.type !== 'torso') body = body.parent ? byName.get(body.parent) : undefined;
    const spine = body && /^UpperBody/.test(body.name) ? own.get(body.name) : undefined;
    // 两个上半身直立并排：整只胸只顺着自己那个上半身的脊柱弯（见 OWN_BEND）
    const follow = body && spine && apartMap(body.name) ? spine : undefined;
    const q = new Float64Array(3);
    /** 一个静止时的基本体整个跟着那节骨骼搬过去以后占多大（corners：用哪几个角） */
    const rigidBox = (corners: readonly number[]): number[] => {
      const out = [BIG, BIG, BIG, -BIG, -BIG, -BIG];
      for (let i = 0; i < corners.length; i += 3) {
        const p = carried(m, o, corners.slice(i, i + 3));
        for (let k = 0; k < 3; k++) {
          out[k] = Math.min(out[k], p[k]);
          out[k + 3] = Math.max(out[k + 3], p[k]);
        }
      }
      return out;
    };
    const merge = (a: number[], b: number[]): number[] => [0, 1, 2, 3, 4, 5].map((k) => (k < 3 ? Math.min(a[k], b[k]) : Math.max(a[k], b[k])) + (k < 3 ? -MARGIN : MARGIN));
    for (const d of rest) {
      const f = draftDist(d);
      if (follow) {
        const far = CHEST_FAR * xf.scale;
        const bend = bendMap(follow, skeleton, m, [], d);
        const whole = seam ? bendMap(torsoBones, skeleton, m, torsoStubs, d) : null;
        drafts.push({
          type: T_CUSTOM,
          group: d.group,
          nums: [],
          mode: d.mode,
          k: d.k,
          custom: (x, y, z) => {
            bend.map(x, y, z, q);
            const v = f(q[0], q[1], q[2]);
            // 离胸表面远的不用再看切口（切口只会把值改大，远处的值不影响表面）：胸的格子盒子很大，大半是空的
            if (!whole || v > far) return v;
            // 里侧的胸在两个身子正中切齐的那一刀：跟着胸的那一刀、留在两个身子正中（顺着所有躯干骨骼弯）的那一刀，两刀都切到的才切掉。
            // 只跟着胸的话两个身子分开时胸上留着一个平面；只留在正中的话往同一边扭、歪时越过正中的胸被切平
            const mine = n[0] * q[0] + n[1] * q[1] + n[2] * q[2] + c;
            if (mine <= v) return v;
            whole.map(x, y, z, q);
            const middle = n[0] * q[0] + n[1] * q[1] + n[2] * q[2] + c;
            const cut = mine < middle ? mine : middle;
            return v > cut ? v : cut;
          },
          box: bend.box(d),
          ...(d.span ? { cull: [boxCorners(bend.box({ ...d, corners: tightCorners(d), outerCorners: undefined }))] } : {}),
        });
        continue;
      }
      const whole = seam || !spine ? bendMap(torsoBones, skeleton, m, torsoStubs, d) : null;
      const bend = spine ? bendMap(spine, skeleton, m, [], d) : whole!;
      const tight = { ...d, corners: tightCorners(d), outerCorners: undefined };
      drafts.push({
        type: T_CUSTOM,
        group: d.group,
        nums: [],
        mode: d.mode,
        k: d.k,
        custom: (x, y, z) => {
          // 整个跟着那节骨骼的话，静止时在哪：Rᵀ (p − t)
          const dx = x - m[o + 9];
          const dy = y - m[o + 10];
          const dz = z - m[o + 11];
          const rx = m[o] * dx + m[o + 3] * dy + m[o + 6] * dz;
          const ry = m[o + 1] * dx + m[o + 4] * dy + m[o + 7] * dz;
          const rz = m[o + 2] * dx + m[o + 5] * dy + m[o + 8] * dz;
          const h = torso(rx, ry, rz);
          const t = h <= near ? 0 : h >= far ? 1 : (h - near) / (far - near);
          const w = t * t * (3 - 2 * t);
          if (w >= 1 && !seam) return f(rx, ry, rz);
          let v: number;
          if (w >= 1) v = f(rx, ry, rz);
          else {
            bend.map(x, y, z, q);
            v = f(q[0] + (rx - q[0]) * w, q[1] + (ry - q[1]) * w, q[2] + (rz - q[2]) * w);
          }
          if (!seam) return v;
          // 切齐的那一刀照旧顺着所有躯干骨骼弯（落在两个身子正中间）
          whole!.map(x, y, z, q);
          const cut = n[0] * q[0] + n[1] * q[1] + n[2] * q[2] + c;
          return v > cut ? v : cut;
        },
        box: merge(bend.box(d), rigidBox(boxEdges(d).flatMap((e) => e))),
        ...(d.span ? { cull: [boxCorners(merge(bend.box(tight), rigidBox(tight.corners)))] } : {}),
      });
    }
  };

  const drafts: Draft[] = [];
  /** drafts 里每一个是第几个部件的 */
  const owners: number[] = [];
  let owner = -1;
  const tag = () => {
    while (owners.length < drafts.length) owners.push(owner);
  };
  for (let index = 0; index < figure.parts.length; index++) {
    const given = figure.parts[index];
    tag();
    owner = index;
    const group = GROUP_INDEX.get(given.fuseAs ?? given.type);
    if (group === undefined || given.material === 'eye') continue;
    // 有的部件转得离本来的方向远了以后另有一套基本体（见 Part.posed）
    const part = swapped(given) ? { ...given, prims: given.posed!.prims } : given;
    const xf = xfs.get(part.name)!;
    const mine = own.get(part.name);
    const blend = ROOT_BLEND[part.type];
    /** 整个部件跟着一根骨骼搬过去 */
    const whole = (bone: number) => {
      const to = moved(xf, bone);
      const from = drafts.length;
      partDrafts(part, to, group, minR, drafts);
      if (blend) for (let i = from; i < drafts.length; i++) drafts[i] = { ...drafts[i], root: [...to.pos, blend[0] * xf.scale, blend[1] * xf.scale] };
    };
    if (shared && part.type === 'chest') {
      chestDrafts(part, xf, group);
      continue;
    }
    if (bodyBones.length && part.type === 'chest' && !bodyBones.every((b) => same(matrices, b * 12, bodyBones[0] * 12))) {
      const rest: Draft[] = [];
      partDrafts(part, xf, group, minR, rest);
      for (const d of rest) bendDraft(d, bodyBones, skeleton, matrices, null, undefined, drafts, bodyStubs);
      continue;
    }
    if (!mine) {
      whole(nearest(bonesFor(part), xf.pos));
      continue;
    }
    // 照着现成的模型采样出来的腿（二次元素体）平常不在这里摆（见 heldLegs）；真摆到了这里，也不分段，顺着弯：
    // 大腿、小腿的表面是斜的、鼓的，切开以后两段各转各的，切口两边对不齐，膝盖上勒出一圈棱
    const sampledLeg = part.type === 'leg' && part.prims.some((prim) => prim.kind === 'grid');
    if (BENDS.has(part.type) || sampledLeg) {
      // 好几个上半身的二次元素体：躯干那几块一起顺着所有躯干骨骼弯（见 shared）
      const together = shared && part.type === 'torso';
      const carriers = together ? torsoBones : mine;
      // 这个部件的几节骨骼都没有相对动过：整个搬过去就行
      if (carriers.every((bone) => same(matrices, bone * 12, carriers[0] * 12))) {
        whole(carriers[0]);
        continue;
      }
      const rest: Draft[] = [];
      partDrafts(part, xf, group, minR, rest);
      const origin = carried(matrices, nearest(carriers, xf.pos) * 12, xf.pos);
      const root = blend ? [...origin, blend[0] * xf.scale, blend[1] * xf.scale] : undefined;
      const made = together ? apartMap(part.name) : undefined;
      for (const d of rest) bendDraft(d, carriers, skeleton, matrices, origin, root, drafts, together ? torsoStubs : pelvis.get(part.name), together, made);
      continue;
    }
    const plan = mine.length > 1 || part.type === 'leg' ? planOf(part, mine, skeleton) : null;
    // 这个部件的几段都没有相对动过：整个搬过去就行，不用分段
    const first = plan?.pieces[0]?.bone ?? mine[0];
    if (!plan || plan.pieces.every((piece) => same(matrices, piece.bone * 12, first * 12))) {
      whole(first);
      continue;
    }
    const rest: Draft[] = [];
    partDrafts(part, xf, group, minR, rest);
    // 部件的原点（关节）摆好以后在哪：它跟着离它最近的那节骨骼走。只在根部圆滑的基本体、只在根部融合的部件都以它为中心
    const origin = carried(matrices, nearest(plan.pieces.map((piece) => piece.bone), xf.pos) * 12, xf.pos);
    const root = blend ? [...origin, blend[0] * xf.scale, blend[1] * xf.scale] : undefined;
    for (const d of rest) poseDraft(d, plan, matrices, origin, root, drafts);
  }
  tag();
  const field = pack(
    rooms.length ? drafts.map((d, i) => ({ ...d, owner: owners[i] })) : drafts,
    GROUPS.map((t) => options.blend * (GROUP_BLEND[t] ?? 1)),
  );
  if (rooms.length) {
    const indexOf = new Map(figure.parts.map((part, i) => [part.name, i]));
    // 两层面之间少于两个体素，在网格上分不开
    const margin = 2 * minR;
    field.clear = rooms.map((room) => {
      const soft = room.soft ? CARVE_SOFT * margin : 0;
      return {
        a: room.a,
        axis: room.axis,
        length: room.length,
        radius: room.radius,
        margin,
        soft,
        // 离那段圆柱三个体素以外，改了也碰不到表面；圆角大的，要管到比圆角还远一个体素
        reach: Math.max(3 * minR, soft + minR),
        carve: room.carve,
        list: field.owned?.get(indexOf.get(room.part) ?? -1) ?? new Int32Array(0),
      };
    });
  }
  return field;
}
