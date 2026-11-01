/**
 * 手动微调：把 BodySpec.overrides 里对各个部件实例的位置 / 角度 / 大小的修改，套到摆好的 Figure 上。
 * 纯函数，不碰 three.js 和 DOM。
 *
 * 约定：
 * - 位置偏移加在部件相对父部件的位置上，沿父部件的 X、Y、Z 轴；
 * - 旋转绕父部件的轴、绕着部件自己的支点（一般是关节）转；
 * - 缩放以支点为中心。三个方向一样大就是等比缩放，子部件跟着一起变大；
 *   不一样大时，共同的那一份当作等比缩放，剩下的只拉伸部件自己：子部件跟着挪位置，但不变形。
 *
 * 躯干带着脖子、头、手臂、胸、翅膀一起动；头带着眼睛、角、耳朵一起动；腿、尾巴、兽身各自独立。
 * 腿的长短变了以后，整个人跟着升降，脚始终踩在地面上。
 */
import type { PartOverride } from '../model/spec';
import { getGrid } from '../sdf/grids';
import { graftMeshOf } from '../anime/grafts';
import { type Figure, type FigureMetrics, type Part, type Prim, graftFrame, shapeMatrix, worldTransforms } from './figure';
import { HEAD_HALF_HEIGHT, HEAD_HALF_WIDTH } from './head';
import {
  type Mat3,
  type Quat,
  type V3,
  Q_ID,
  add,
  dot,
  len,
  mat3Apply,
  mat3Mul,
  mul,
  quatConj,
  quatEuler,
  quatMat3,
  quatMul,
  rotate,
  scaleAlong,
  sub,
} from './vec';

type Overrides = Readonly<Record<string, PartOverride>>;

const DEG = Math.PI / 180;
const O: V3 = [0, 0, 0];
/** 头前后方向的半径（量身高时把头近似成椭球） */
const HEAD_HALF_DEPTH = 0.095;

/** 缩放拆成两份：等比的那一份，和剩下的各轴拉伸（三个数乘起来是 1）。本来就是等比缩放时没有后者 */
function splitScale(scale: V3 | undefined): { uniform: number; resize?: V3 } {
  if (!scale) return { uniform: 1 };
  if (Math.max(...scale) - Math.min(...scale) < 1e-9) return { uniform: scale[0] };
  const uniform = Math.cbrt(scale[0] * scale[1] * scale[2]);
  return { uniform, resize: [scale[0] / uniform, scale[1] / uniform, scale[2] / uniform] };
}

/** 把一个部件自己的微调套上去。warp 是它被拉伸的矩阵：它的子部件的位置要跟着变 */
function place(part: Part, o: PartOverride): { part: Part; warp: Mat3 | null } {
  const { uniform, resize } = splitScale(o.scale);
  const warp = resize ? scaleAlong(resize, part.axes) : null;
  const s0 = part.scale ?? 1;
  const s1 = s0 * uniform;
  const quat = o.rotation
    ? quatMul(quatEuler(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG), part.quat)
    : part.quat;
  const pivot = part.pivot ?? O;
  const moved = warp ? mat3Apply(warp, pivot) : pivot;
  // 转动、缩放以后支点还在原来的地方，然后再加上位置偏移
  const pos = add(add(part.pos, o.position ?? O), sub(rotate(part.quat, mul(pivot, s0)), rotate(quat, mul(moved, s1))));
  const out: Part = { ...part, pos, quat };
  if (uniform !== 1) out.scale = s1;
  if (resize) out.resize = resize;
  if (part.pivot) out.pivot = moved;
  return { part: out, warp };
}

const headOf = (neckName: string) => neckName.replace('Neck_', 'Head_');

/**
 * 头挪了位置，脖子跟着伸过去：脖子从根部指向头的新位置，
 * 末端离头中心的距离和原来一样（也就是照旧插在头的底下），头不会和脖子脱开。
 */
function followHead(neck: Part, src: Part, byName: Map<string, Part>, overrides: Overrides, warp?: Mat3): Part {
  const head = byName.get(headOf(src.name));
  if (!head || head.parent !== src.parent) return neck;
  const target = add(warp ? mat3Apply(warp, head.pos) : head.pos, overrides[head.name]?.position ?? O);
  const before = sub(head.pos, src.pos);
  const after = sub(target, neck.pos);
  const reach = len(after);
  if (reach < 1e-9 || len(sub(after, before)) < 1e-9) return neck;
  /** 原来从 a 伸到 b 的一段，现在伸到哪：末端到头中心原来隔着多远，现在还隔多远；头压得太低时至少留一小截 */
  const stretch = (a: V3, b: V3): V3 => add(a, mul(after, Math.max(reach - (len(before) - len(sub(b, a))), 0.02) / reach));
  return {
    ...neck,
    prims: neck.prims.map((p): Prim => (p.kind === 'cone' ? { ...p, b: stretch(p.a, p.b) } : p)),
    // 脖子的骨骼跟着脖子一起伸过去
    ...(neck.bones && { bones: neck.bones.map((bone) => ({ ...bone, tail: stretch(bone.head, bone.tail) })) }),
  };
}

/** 眼睛挪了位置、改了大小，头上挖出来的眼窝跟着变 */
function moveSockets(head: Part, overrides: Overrides): Part {
  const { resize } = splitScale(overrides[head.name]?.scale);
  // 头自己被拉伸时，眼窝是跟着头一起拉伸的：先把眼睛的偏移换算回拉伸之前
  const back = resize ? scaleAlong([1 / resize[0], 1 / resize[1], 1 / resize[2]], head.axes) : null;
  let changed = false;
  const prims = head.prims.map((p): Prim => {
    if (p.kind !== 'ellipsoid' || !p.cut || !p.name.startsWith('Socket_')) return p;
    const o = overrides[`${head.name}_Eye_${p.name.slice('Socket_'.length)}`];
    if (!o) return p;
    changed = true;
    const shift = o.position ?? O;
    return {
      ...p,
      center: add(p.center, back ? mat3Apply(back, shift) : shift),
      radii: mul(p.radii, splitScale(o.scale).uniform),
    };
  });
  return changed ? { ...head, prims } : head;
}

/**
 * 所有腿里最低的那一点有多高（部件自己的单位，没乘 Figure.scale）。没有腿时返回 null。
 * 腿是由圆台和椭球拼成的，逐个量它们最低的地方。
 */
function footLevel(parts: Part[]): number | null {
  const xfs = worldTransforms({ parts, scale: 1 });
  let low = Infinity;
  for (const part of parts) {
    if (part.type !== 'leg') continue;
    const xf = xfs.get(part.name)!;
    const shape = shapeMatrix(part);
    const turn = quatMat3(xf.quat);
    const m = shape ? mat3Mul(turn, shape) : turn;
    // 局部坐标里的一个点，在世界里有多高：只用得到矩阵的第二行
    const row: V3 = [m[3], m[4], m[5]];
    const stretch = len(row);
    const y = (p: V3) => xf.pos[1] + dot(row, p) * xf.scale;
    // 齐着地面削平的（蹄子）：底下那个挖掉的大椭球顶到哪，脚底就在哪
    const ground = part.prims.find((p) => p.kind === 'ellipsoid' && p.cut && p.name === 'Ground');
    if (ground?.kind === 'ellipsoid') {
      const r = ground.quat ? mat3Apply(quatMat3(quatConj(ground.quat)), row) : row;
      low = Math.min(low, y(ground.center) + Math.hypot(r[0] * ground.radii[0], r[1] * ground.radii[1], r[2] * ground.radii[2]) * xf.scale);
      continue;
    }
    for (const p of part.prims) {
      if (p.kind === 'cone' && !p.cut) {
        low = Math.min(low, y(p.a) - p.ra * stretch * xf.scale, y(p.b) - p.rb * stretch * xf.scale);
      } else if (p.kind === 'ellipsoid' && !p.cut) {
        const r = p.quat ? mat3Apply(quatMat3(quatConj(p.quat)), row) : row;
        low = Math.min(low, y(p.center) - Math.hypot(r[0] * p.radii[0], r[1] * p.radii[1], r[2] * p.radii[2]) * xf.scale);
      } else if (p.kind === 'grid' && !p.cut) {
        // 采样好的形状：量它外接盒子的八个角（脚切掉了的，只量到切口）
        const { min, max } = getGrid(p.grid).bounds;
        const bottom = p.clipBelow === undefined ? min[1] : Math.max(min[1], p.clipBelow);
        for (let i = 0; i < 8; i++) {
          low = Math.min(low, y([(i & 1 ? max[0] : min[0]) * (p.mirror ? -1 : 1), i & 2 ? max[1] : bottom, i & 4 ? max[2] : min[2]]));
        }
      }
    }
    // 接上去的现成的脚：照它摆好的样子量最低的那一点（腿拉长、缩短时脚不跟着变形，只跟着脚踝挪）
    for (const graft of part.grafts ?? []) {
      if (graft.mesh !== 'foot') continue;
      const { matrix: g, offset } = graftFrame(part, graft);
      const points = graftMeshOf('foot').positions;
      for (let i = 0; i < points.length; i += 3) {
        const q: V3 = [points[i], points[i + 1], points[i + 2]];
        const local = add(mat3Apply(g, q), offset);
        low = Math.min(low, xf.pos[1] + dot([turn[3], turn[4], turn[5]], local) * xf.scale);
      }
    }
  }
  return Number.isFinite(low) ? low : null;
}

/**
 * 腿被拉长、缩短、转开以后，整个人跟着升降：脚还是踩在原来的地面上。
 * 只看腿；没动过腿的时候什么都不变。
 */
function reground(parts: Part[], original: Part[]): Part[] {
  const before = footLevel(original);
  const after = footLevel(parts);
  if (before === null || after === null || Math.abs(after - before) < 1e-9) return parts;
  const lift = before - after;
  // 没有父部件的那些（躯干、腿、兽身、尾巴）一起挪，挂在它们下面的自然跟着走
  return parts.map((p): Part => (p.parent ? p : { ...p, pos: [p.pos[0], p.pos[1] + lift, p.pos[2]] }));
}

/** 套用微调以后重新量身高和头高：头可能被挪高、放大、歪过去了 */
function measure(parts: Part[], figure: Figure): FigureMetrics {
  const xfs = worldTransforms({ parts, scale: figure.scale });
  // 把头近似成一个椭球，量它最高的那一点
  const half: V3[] = [
    [HEAD_HALF_WIDTH, 0, 0],
    [0, HEAD_HALF_HEIGHT, 0],
    [0, 0, HEAD_HALF_DEPTH],
  ];
  let height = 0;
  let headHeight = 0;
  for (const part of parts) {
    if (part.type !== 'head') continue;
    const xf = xfs.get(part.name)!;
    const m = shapeMatrix(part);
    const axes = half.map((h) => mul(rotate(xf.quat, m ? mat3Apply(m, h) : h), xf.scale));
    height = Math.max(height, xf.pos[1] + Math.hypot(axes[0][1], axes[1][1], axes[2][1]));
    headHeight = Math.max(headHeight, 2 * len(axes[1]));
  }
  if (!height) return figure.metrics;
  return { ...figure.metrics, height, headHeight, headRatio: height / headHeight };
}

/**
 * 把手动微调套到摆好的 Figure 上，返回新的 Figure。
 * 没有任何一条微调对得上现有的部件时，原样返回传进来的那个 Figure。
 */
export function applyOverrides(figure: Figure, overrides: Overrides): Figure {
  if (!figure.parts.some((p) => overrides[p.name])) return figure;
  const byName = new Map(figure.parts.map((p) => [p.name, p]));
  const warps = new Map<string, Mat3>();
  const parts: Part[] = [];
  for (const src of figure.parts) {
    const warp = src.parent ? warps.get(src.parent) : undefined;
    let part = warp ? { ...src, pos: mat3Apply(warp, src.pos) } : src;
    if (src.type === 'neck') part = followHead(part, src, byName, overrides, warp);
    if (src.type === 'head') part = moveSockets(part, overrides);
    // 贴在躯干表面上的（胸）：摆位时已经照微调沿表面挪好了（见 Part.surface）
    const o = src.surface ? undefined : overrides[src.name];
    if (o) {
      const placed = place(part, o);
      part = placed.part;
      if (placed.warp) warps.set(src.name, placed.warp);
    }
    parts.push(part);
  }
  const grounded = reground(refitHips(parts, figure.parts), figure.parts);
  return { parts: grounded, scale: figure.scale, metrics: measure(grounded, figure) };
}

/**
 * 腿挪了：垫在腿根上的胯（下身里的椭球：左右并排时那副宽胯、前后排和胯部聚拢的每一副胯、人腿人马后面的胯）跟着收窄、放宽。
 * 每个椭球照它原来盖着的那几条腿（腿根在它左右、前后的范围里）：最外边的腿根离椭球左右两边各留多宽，挪过以后还留那么宽。
 * 只看腿根左右挪了没有：腿只是转、缩放（腿根不动）时不变
 */
function refitHips(parts: Part[], original: readonly Part[]): Part[] {
  const now = new Map(parts.filter((p) => p.type === 'leg').map((p) => [p.name, p.pos]));
  const legs = original.filter((p) => p.type === 'leg' && now.has(p.name));
  const moved = new Set(legs.filter((p) => Math.abs(now.get(p.name)![0] - p.pos[0]) > 1e-9).map((p) => p.name));
  if (!moved.size) return parts;
  return parts.map((part) => {
    const was = original.find((p) => p.name === part.name);
    if (part.type !== 'lower' || part.parent || !was) return part;
    const s0 = was.scale ?? 1;
    const s1 = part.scale ?? 1;
    let changed = false;
    const prims = part.prims.map((prim, i) => {
      const old = was.prims[i];
      if (prim.kind !== 'ellipsoid' || old?.kind !== 'ellipsoid' || prim.quat) return prim;
      const cx = was.pos[0] + old.center[0] * s0;
      const cz = was.pos[2] + old.center[2] * s0;
      const rx = old.radii[0] * s0;
      const covered = legs.filter((l) => Math.abs(l.pos[0] - cx) <= rx && Math.abs(l.pos[2] - cz) <= old.radii[2] * s0);
      if (!covered.some((l) => moved.has(l.name))) return prim;
      const xs = covered.map((l) => l.pos[0]);
      const to = covered.map((l) => now.get(l.name)![0]);
      const lo = Math.min(...to) - (Math.min(...xs) - (cx - rx));
      const hi = Math.max(...to) + (cx + rx - Math.max(...xs));
      // 挪的是里面的腿：最外边的腿根没动，胯也不动
      if (Math.abs(lo - (cx - rx)) < 1e-9 && Math.abs(hi - (cx + rx)) < 1e-9) return prim;
      // 两边的腿挪到一块儿了也留着一点：不比椭球原来的厚度窄
      const half = Math.max((hi - lo) / 2, Math.min(old.radii[1], old.radii[2]) * s0);
      changed = true;
      const center: V3 = [((lo + hi) / 2 - part.pos[0]) / s1, prim.center[1], prim.center[2]];
      return { ...prim, center, radii: [half / s1, prim.radii[1], prim.radii[2]] as V3 };
    });
    return changed ? { ...part, prims } : part;
  });
}

/** 一个部件在世界里的「操作坐标」：手动微调的操纵杆摆在哪、沿哪组轴 */
export interface PartFrame {
  /** 支点（关节）在世界里的位置，米 */
  pivot: V3;
  /** 父部件在世界里的朝向和缩放：位置偏移、旋转都是相对它来说的 */
  parentQuat: Quat;
  parentScale: number;
  /** 各轴缩放所沿的那组轴在世界里的朝向 */
  axesQuat: Quat;
}

export function partFrame(figure: Pick<Figure, 'parts' | 'scale'>, name: string): PartFrame | null {
  const part = figure.parts.find((p) => p.name === name);
  if (!part) return null;
  const xfs = worldTransforms(figure);
  const xf = xfs.get(name)!;
  const parent = part.parent ? xfs.get(part.parent)! : { quat: Q_ID, scale: figure.scale };
  return {
    pivot: add(xf.pos, rotate(xf.quat, mul(part.pivot ?? O, xf.scale))),
    parentQuat: parent.quat,
    parentScale: parent.scale,
    axesQuat: quatMul(xf.quat, part.axes ?? Q_ID),
  };
}
