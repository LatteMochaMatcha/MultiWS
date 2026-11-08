/**
 * queen conjoined 连体（docs/digits-plan.md 第 6 期）：两个上半身在腰上对接，连成一条横着的身子，两头各一个上半身，
 * 四条手臂撑在地上，没有胯、没有腿。分两种：
 * - 同向（same）：两个上半身胸口都朝下、背朝上；
 * - 反向（opposite）：一个胸口朝下，另一个仰面朝上（那一头的手臂往身后撑地）。
 *
 * 做法（白模人台、二次元素体共用，成品角色见 character/conjoined 那一段）：
 * 1. 照一个上半身摆好（layout.ts / animeLayout.ts），躯干在腰上切开，胯、腿、尾巴、阴茎都不要；
 * 2. 手臂转到朝前（整个人趴下以后就是朝下撑地），手照倒立撑地那样手心贴地、手指朝头那边；脖子、头往上抬，趴下以后看着前方；
 * 3. 腰往上整个复制一份（第二个上半身，部件、骨骼接着往下编号），绕腰转 180°：同向绕前后的轴、反向绕左右的轴，
 *    腰的切口正好对上；反向的那一份手臂改成往它自己身后伸（转过来以后也是朝下），头不抬（仰面朝上看）；
 * 4. 整个人绕腰往前趴下 90°，最低的那一点（手心）落到地面上。
 *
 * 纯函数，不依赖浏览器。
 */
import { BENT_TIP, bentHand, swapPlace } from '../anime/swap';
import { castRay, compileField } from '../sdf/field';
import { graftPoints } from '../sdf/graft';
import { getGrid } from '../sdf/grids';
import type { BoneHint, Figure, Graft, Part, Prim } from './figure';
import { nthName, shapeMatrix, worldTransforms } from './figure';
import { ringAt } from './torso';
import { type Mat3, type Quat, type V3, add, cross, dot, len, mat3Apply, mat3Mul, mul, norm, quatBetween, quatEuler, quatMat3, quatMul, rotate, sub } from './vec';

export type Conjoin = 'same' | 'opposite';
/** 连体静止时的姿态：趴着（四只手撑地）、躺着（侧躺，胳膊肘撑着）、站着（下面那个倒立撑地） */
export type ConjoinPosture = 'prone' | 'lie' | 'flat' | 'stand';

/**
 * 在腰上哪里对接：脊柱第一节（Spine）的起点往下 WAIST_FROM 到往上 WAIST_TO 之间，躯干最细的那个高度。
 * 两个上半身照切口对称（一个是另一个绕切口转过来的），在最细的地方对接，侧面的轮廓才是顺的；
 * 切在别处的话，切口两边一边在变细、一边在变粗，正好折一道沟（或者凸一道棱）
 */
const WAIST_FROM = 0.04;
const WAIST_TO = 0.16;
/** 两个上半身在切口两边各多留这么多，叠在一起取并集（多留了的话，切口下面开始变粗的那一截凸出来一圈） */
const OVERLAP = 0.006;
/** 手臂撑地时往外撇多少、几对手臂之间再撇开多少（正切） */
const ARM_SPLAY = 0.18;
const ARM_FAN = 0.35;
/** 脖子、头往上抬多少（弧度）：趴下以后脸朝前方偏下一点 */
const NECK_LIFT = 60 * (Math.PI / 180);
/** 不要的部件（胯以下的） */
const LOWER = new Set(['leg', 'lower', 'tail', 'genital']);
/** 第二个上半身照名字接着往下编号的部件 */
const NUMBERED = /^(Neck|Head|Arm|Chest|Wing)_(\d+)(.*)$/;
const FINGER = /^(Thumb|Index|Middle|Ring|Little|Finger[A-C])(\d)/;

const turnAbout = (p: V3, at: V3, m: Mat3): V3 => add(at, mat3Apply(m, sub(p, at)));
const toQuat = (m: Mat3): Quat => {
  // 3×3 旋转矩阵（按行）→ 四元数
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
/** 三根轴（列）拼成的旋转矩阵（按行） */
const basis = (x: V3, y: V3, z: V3): Mat3 => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/** 一个基本体整个绕 at 转 m（部件自己的坐标里） */
function turnPrim(p: Prim, at: V3, m: Mat3): Prim {
  if (p.kind === 'cone') return { ...p, a: turnAbout(p.a, at, m), b: turnAbout(p.b, at, m) };
  if (p.kind === 'ellipsoid') return { ...p, center: turnAbout(p.center, at, m), quat: quatMul(toQuat(m), p.quat ?? [0, 0, 0, 1]) };
  return p;
}

/** 手臂的手、手指的骨骼是哪些 */
const isHandBone = (name: string) => /^Hand_/.test(name) || FINGER.test(name);

/**
 * 一条手臂转到朝 target（躯干的坐标里），手照倒立撑地那样：手心朝 ground、手指朝 ahead（都是躯干的坐标）。
 * 现成的手（分指）换成手腕弯过去的那只（anime/swap.ts 的 bentHand）；人台自己的手（并指）整个绕手腕转过去
 */
function plantArm(part: Part, target: V3, ahead: V3, ground: V3): Part {
  const bones = part.bones ?? [];
  const upper = bones.find((b) => /^UpperArm/.test(b.name));
  const lower = bones.find((b) => /^LowerArm/.test(b.name));
  const hand = bones.find((b) => /^Hand_/.test(b.name));
  if (!upper || !lower) return part;
  // 手臂现在朝哪（躯干的坐标里）：肩到手腕
  const now = norm(rotate(part.quat, sub(lower.tail, upper.head)));
  const quat = quatMul(quatBetween(now, norm(target)), part.quat);
  const { bind: _bind, ...rest } = part;
  const out: Part = { ...rest, quat };
  // 末端接的是脚（手脚互换）：照腿上那样摆的，手臂朝下时脚底正好朝下，不用再转
  if (!hand || part.grafts?.some((g) => g.mesh === 'foot') || part.prims.some((p) => 'name' in p && p.name === 'Foot')) return out;
  // 手心、手指要朝的方向，换到手臂自己的坐标里
  const back = quatMat3([-quat[0], -quat[1], -quat[2], quat[3]]);
  const fore = norm(mat3Apply(back, ahead));
  const palm = norm(sub(mat3Apply(back, ground), mul(fore, dot(mat3Apply(back, ground), fore))));
  const wrist = hand.head;
  const graft = part.grafts?.find((g) => g.mesh === 'hand');
  if (graft) {
    // 现成的手：换成手腕弯过去的那只，前臂对上前臂、手指朝 fore；原来是翻过来的（右手）照样翻
    const det = graft.matrix[0] * (graft.matrix[4] * graft.matrix[8] - graft.matrix[5] * graft.matrix[7]) - graft.matrix[1] * (graft.matrix[3] * graft.matrix[8] - graft.matrix[5] * graft.matrix[6]) + graft.matrix[2] * (graft.matrix[3] * graft.matrix[7] - graft.matrix[4] * graft.matrix[6]);
    const size = Math.cbrt(Math.abs(det));
    const flip = det < 0;
    const mirror = (p: V3): V3 => (flip ? [-p[0], p[1], p[2]] : p);
    const placed = swapPlace({ end: mirror(BENT_TIP.end), root: mirror(BENT_TIP.root), ahead: BENT_TIP.ahead }, { end: wrist, root: lower.head, ahead: fore }, size);
    const matrix = (flip ? mat3Mul(placed.matrix, [-1, 0, 0, 0, 1, 0, 0, 0, 1]) : placed.matrix) as Graft['matrix'];
    const at = (p: V3): V3 => add(mat3Apply(matrix, p), placed.offset);
    const bent = bentHand(graft.digits);
    const middle = bent.fingers.find((f) => f.finger === 'Middle')!.joints[0];
    const palmGraft: Graft = { ...graft, mesh: 'palm', matrix, offset: placed.offset, pivot: add(BENT_TIP.end, mul(norm(sub(BENT_TIP.end, BENT_TIP.root)), bent.sole)) };
    out.grafts = part.grafts!.map((g) => (g === graft ? palmGraft : g));
    out.bones = bones.map((b) => {
      if (b === hand) return { ...b, tail: at(middle) };
      const m = FINGER.exec(b.name);
      const joints = m && bent.fingers.find((f) => f.finger === m[1])?.joints;
      return joints ? { ...b, head: at(joints[Number(m![2]) - 1]), tail: at(joints[Number(m![2])]) } : b;
    });
    return out;
  }
  // 人台自己的手（并指、分指的圆棒）：照手、手指的骨骼量出手现在的三个方向，整个绕手腕转到手心朝 palm、手指朝 fore
  const thumb = bones.find((b) => /^Thumb1/.test(b.name));
  const nowFore = norm(sub(hand.tail, hand.head));
  const side = part.side < 0 ? -1 : 1;
  const towardThumb = thumb ? sub(thumb.head, wrist) : [0, 0, 1] as V3;
  const nowThumb = norm(sub(towardThumb, mul(nowFore, dot(towardThumb, nowFore))));
  const nowPalm = mul(cross(nowFore, nowThumb), side);
  const newThumb = mul(cross(palm, fore), side);
  const m = mat3Mul(basis(fore, newThumb, palm), transpose(basis(nowFore, nowThumb, nowPalm)));
  const handPrim = /^(Palm_|Thumb|Fingers_|Index|Middle|Ring|Little)/;
  out.prims = part.prims.map((p) => ('name' in p && handPrim.test(p.name) ? turnPrim(p, wrist, m) : p));
  out.bones = bones.map((b) => (isHandBone(b.name) ? { ...b, head: turnAbout(b.head, wrist, m), tail: turnAbout(b.tail, wrist, m) } : b));
  return out;
}

/** 第二个上半身的部件名：头、脖子、手臂、胸、翅膀接着往下编号，躯干叫 Torso_B */
function renamePart(name: string, last: Map<string, number>): string {
  if (name === 'Torso') return 'Torso_B';
  const m = NUMBERED.exec(name);
  if (!m) return `${name}_B`;
  // 头上长的（眼睛、角、耳朵）跟着头的号：Head_01_Eye_01_L → Head_03_Eye_01_L
  return `${m[1]}_${String(Number(m[2]) + (last.get(m[1]) ?? 0)).padStart(2, '0')}${m[3]}`;
}

/** 骨骼名 → 底名和第几个（Chest.002 → Chest、1） */
const ordinal = (name: string): [string, number] => {
  const m = /^(.*?)(?:\.(\d{3}))?$/.exec(name)!;
  return [m[1], m[2] ? Number(m[2]) - 1 : 0];
};

/**
 * 一串部件里最低的那一点（部件的单位，Figure.scale 当作 1）：接上去的网格照顶点量，基本体照外接的圆、球量。
 * only：只量这几个部件（别的照样算位置）
 */
function lowest(all: Part[], only?: ReadonlySet<string>): number {
  let low = Infinity;
  const parts = only ? all.map((p) => (only.has(p.name) ? p : { ...p, grafts: undefined, prims: [] })) : all;
  const points = graftPoints(parts);
  for (let i = 1; i < points.length; i += 3) low = Math.min(low, points[i]);
  const xfs = worldTransforms({ parts, scale: 1 });
  for (const part of parts) {
    const xf = xfs.get(part.name)!;
    const shape = shapeMatrix(part);
    const y = (p: V3) => xf.pos[1] + rotate(xf.quat, shape ? mat3Apply(shape, p) : p)[1] * xf.scale;
    for (const p of part.prims) {
      if (p.kind === 'cone' && !p.cut) low = Math.min(low, y(p.a) - p.ra * xf.scale, y(p.b) - p.rb * xf.scale);
      else if (p.kind === 'ellipsoid' && !p.cut) low = Math.min(low, y(p.center) - Math.max(...p.radii) * xf.scale);
    }
  }
  return low;
}

/** 躯干（拼的、采样的都行）最低到哪：从底下往上打一排射线，碰到的最低那一点 */
function underside(parts: Part[], blend = 0, depth = 0.4, step = 0.04): number {
  const field = compileField({ scale: 1, parts }, { blend });
  let low = Infinity;
  for (let x = -1; x <= 1; x += step) {
    for (let z = -depth; z <= depth; z += step) {
      const t = castRay(field, [x, -2, z], [0, 1, 0], 6);
      if (t < 6) low = Math.min(low, -2 + t);
    }
  }
  return low;
}

/** 一串部件里最高的那一点（头顶）：头照外接盒子量 */
function highest(parts: Part[]): number {
  let top = -Infinity;
  const xfs = worldTransforms({ parts, scale: 1 });
  for (const part of parts) {
    if (part.type !== 'head') continue;
    const xf = xfs.get(part.name)!;
    for (const p of part.prims) {
      const r = p.kind === 'ellipsoid' ? Math.max(...p.radii) : p.kind === 'grid' ? len(sub(getGrid(p.grid).bounds.max, getGrid(p.grid).bounds.min)) / 2 : 0;
      const c = p.kind === 'ellipsoid' ? p.center : p.kind === 'grid' ? mul(add(getGrid(p.grid).bounds.max, getGrid(p.grid).bounds.min), 0.5) : null;
      if (c) top = Math.max(top, xf.pos[1] + rotate(xf.quat, c)[1] * xf.scale + r * xf.scale);
    }
  }
  return top;
}

/** 把摆好的一个上半身（连胯和腿）改成连体。figure 是照一个上半身、两条人腿摆的 */
export function conjoin(figure: Figure, kind: Conjoin, posture: ConjoinPosture = 'prone'): Figure {
  const torso = figure.parts.find((p) => p.name === 'Torso');
  const spine = torso?.bones?.find((b) => b.name === 'Spine');
  if (!torso || !spine) return figure;
  // 躯干最细的那个高度：从正中往两边打射线量半宽
  const probe = compileField({ scale: 1, parts: [{ ...torso, parent: undefined, pos: [0, 0, 0], quat: [0, 0, 0, 1] }] }, { blend: 0 });
  let cutY = spine.head[1];
  let narrow = Infinity;
  for (let y = spine.head[1] - WAIST_FROM; y <= spine.head[1] + WAIST_TO; y += 0.004) {
    const half = 0.6 - castRay(probe, [0.6, y, spine.head[2]], [-1, 0, 0], 0.6);
    if (half < narrow - 1e-4) {
      narrow = half;
      cutY = y;
    }
  }
  // 腰上对接的那一点（躯干的坐标里）：两个上半身绕它转，整个人也绕它趴下。前后取在切口那一圈的正中：
  // 反向的那一份前后翻过来，正中对正中，肚子、后腰才是对着的（取在脊柱上的话差出好几厘米，一道台阶）
  const front = 0.6 - castRay(probe, [0, cutY, 0.6], [0, 0, -1], 1.2);
  const back = -0.6 + castRay(probe, [0, cutY, -0.6], [0, 0, 1], 1.2);
  const pivot: V3 = [0, cutY, front > back ? (front + back) / 2 : spine.head[2]];

  /* ---- 1. 躯干在腰上切开，胯以下的部件都不要 ---- */
  const keepFrom = cutY - OVERLAP;
  const prims: Prim[] = [];
  for (const p of torso.prims) {
    if (p.kind === 'loft') prims.push({ ...p, rings: [ringAt(p.rings, keepFrom), ...p.rings.filter((r) => r.y > keepFrom)] });
    else if (p.kind === 'grid') prims.push({ ...p, clipBelow: keepFrom, clipRound: 0, tile: undefined });
    else {
      const y = p.kind === 'ellipsoid' ? p.center[1] : p.kind === 'cone' ? Math.max(p.a[1], p.b[1]) : cutY + 1;
      if (y > cutY) prims.push(p);
    }
  }
  // 胯那根骨骼挪到腰上：两个上半身的脊柱都接在它上面
  const bones: BoneHint[] = (torso.bones ?? []).map((b) => (b.name === 'Hips' ? { ...b, head: pivot, tail: [pivot[0], pivot[1] - 0.06, pivot[2]] } : b));
  const upper: Part[] = [{ ...torso, prims, bones }, ...figure.parts.filter((p) => p !== torso && p.parent && !LOWER.has(p.type))];
  const kept = new Set(upper.map((p) => p.name));
  // 挂在不要的部件上的也不要（尾巴上的什么、腿上的什么）
  const parts = upper.filter((p) => !p.parent || kept.has(p.parent));

  /* ---- 第二个上半身：照 list 复制（部件、骨骼接着往下编号），挂在第一个躯干上，绕腰那一点转 local ---- */
  const last = new Map<string, number>();
  for (const p of parts) {
    const m = NUMBERED.exec(p.name);
    if (m) last.set(m[1], Math.max(last.get(m[1]) ?? 0, Number(m[2])));
  }
  const boneCount = new Map<string, number>();
  for (const p of parts) for (const b of p.bones ?? []) {
    const [base] = ordinal(b.name);
    boneCount.set(base, (boneCount.get(base) ?? 0) + 1);
  }
  const boneName = new Map<string, string>([['Hips', 'Hips']]);
  const renameBone = (name: string) => {
    let out = boneName.get(name);
    if (!out) {
      const [base, k] = ordinal(name);
      out = nthName(base, (boneCount.get(base) ?? 0) + k);
      boneName.set(name, out);
    }
    return out;
  };
  const partName = new Map(parts.map((p) => [p.name, renamePart(p.name, last)]));
  // 同向：绕前后的轴（Z）转 180°，胸口还朝前；反向：绕左右的轴（X）转 180°，胸口朝后
  const flip = kind === 'same' ? quatEuler(0, 0, Math.PI) : quatEuler(Math.PI, 0, 0);
  const copySecond = (list: Part[], local: Quat): Part[] =>
    list.map((p): Part => {
      const name = partName.get(p.name)!;
      const own = (b: BoneHint): BoneHint => {
        // 翅膀的骨骼就叫部件的名字
        const n = p.type === 'wing' && b.name === p.name ? name : renameBone(b.name);
        return { ...b, name: n, ...(b.parent ? { parent: b.parent === p.name && p.type === 'wing' ? name : renameBone(b.parent) } : {}) };
      };
      const renamed: Part = {
        ...p,
        name,
        ...(p.parent ? { parent: partName.get(p.parent) ?? p.parent } : {}),
        ...(p.bones ? { bones: p.bones.filter((b) => b.name !== 'Hips').map(own) } : {}),
        ...(p.grafts ? { grafts: p.grafts.map((g) => ({ ...g, bones: Object.fromEntries(Object.entries(g.bones).map(([k, v]) => [k, renameBone(v)])), rigid: g.rigid.map(renameBone) })) } : {}),
      };
      if (p.name !== 'Torso') return renamed;
      // 反向的两个腰前后反着对上（肚子对着后腰），切口两边厚薄不一样：当成别的一类融合（见 Part.fuseAs），那一圈圆滑地过渡
      return { ...renamed, parent: 'Torso', pos: sub(pivot, rotate(local, pivot)), quat: local, ...(kind === 'opposite' ? { fuseAs: 'lower' as const } : {}) };
    });
  const pairOf = (p: Part) => Number(/^Arm_(\d+)/.exec(p.name)?.[1] ?? 1) - 1;
  const splayOf = (p: Part) => (p.side < 0 ? -1 : 1) * (ARM_SPLAY + ARM_FAN * pairOf(p));
  /** 第一个躯干绕腰那一点转 q，整个人往下落到最低的那一点踩在地上 */
  const finish = (list: Part[], q: Quat): Figure => {
    let out = list.map((p) => (p.name === 'Torso' ? { ...p, pos: add(pivot, rotate(q, sub(p.pos, pivot))), quat: quatMul(q, p.quat) } : p));
    // 躯干（躺着时它贴着地）也算：拼的、采样的躯干不在 lowest 里。
    // 侧躺时身子压在靠地那一侧的肩膀上：肩膀和躯干融合时鼓出来的那一圈最低，照缺省的融合圆角量身子正下方那一条
    // （撑在前面的手照 lowest 量：射线在手的网格上量得偏低）
    const low = Math.min(
      lowest(out),
      posture === 'lie' ? underside(out.filter((p) => p.material !== 'eye'), LIE_BLEND, LIE_UNDER, 0.02) : underside(out.filter((p) => p.type === 'torso')),
    );
    out = out.map((p) => (p.name === 'Torso' ? { ...p, pos: [p.pos[0], p.pos[1] - low, p.pos[2]] as V3 } : p));
    const height = highest(out) * figure.scale;
    return { ...figure, parts: out, metrics: { ...figure.metrics, height, headRatio: height / figure.metrics.headHeight } };
  };

  /* ---- 站着：第二个上半身倒立在下面，两只手举过头撑地（手心贴地、手指朝前）；上面那个照原样站着 ---- */
  if (posture === 'stand') {
    // 标准的倒立：手臂伸直（手肘原来那点弯也拉直）、竖直、和肩同宽，肩膀撑到最高，头离地远远的。
    // 手臂斜着、肘弯着的话肩膀低，看着像用头顶着地
    const straight = (p: Part) => {
      const j = armJointsOf(p);
      if (!j) return p;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(j.elbow, j.shoulder)), norm(sub(j.wrist, j.elbow))))));
      return angle > 1e-3 ? bendElbow(p, -angle) : p;
    };
    const across = (p: Part) => (p.side < 0 ? -1 : 1) * (HANDSTAND_SPLAY + ARM_FAN * pairOf(p));
    // 肩膀往头那边耸起一点（倒立时耸肩撑着地），整个人顶得更高；头往胸口收（低头含胸），头的最低处离地远些
    const shrug = (p: Part): Part => ({ ...p, pos: [p.pos[0], p.pos[1] + HANDSTAND_SHRUG, p.pos[2]] });
    const handstand = turnHeads(
      parts.map((p) => (p.type === 'arm' ? shrug(plantArm(straight(p), [across(p), 1, 0], [0, 0, 1], [0, 1, 0])) : p)),
      () => quatEuler(HANDSTAND_TUCK, 0, 0),
    );
    return finish([...parts, ...copySecond(handstand, flip)], [0, 0, 0, 1]);
  }

  /* ---- 平躺：整个人往后躺平（第一个上半身仰面朝上），手臂顺着身子两边放在地上；反向的那个趴着，头稍微抬起来 ---- */
  if (posture === 'flat') {
    const root = quatEuler(-Math.PI / 2, 0, 0);
    const lay = (list: Part[], world: Quat) => {
      // 往地上那边（这个上半身自己的坐标里）
      const down = rotate([-world[0], -world[1], -world[2], world[3]], [0, -1, 0]);
      return list.map((p) => (p.type === 'arm' ? pointArm(p, norm(add([(p.side < 0 ? -1 : 1) * FLAT_SPREAD, -1, 0], mul(down, FLAT_DROP)))) : p));
    };
    const secondWorld = quatMul(root, flip);
    const second = kind === 'opposite' ? turnHeads(lay(parts, secondWorld), () => quatEuler(-NECK_LIFT, 0, 0)) : lay(parts, secondWorld);
    return finish([...lay(parts, root), ...copySecond(second, flip)], root);
  }

  /* ---- 躺着：侧躺，两个上半身各用一只胳膊肘撑着（前臂贴地），在腰上往上翘 ---- */
  if (posture === 'lie') {
    // 两个上半身各往上翘，腰上两个切口之间底下张开一道楔形的缝：垫一个圆团（和腰一样粗）填上
    const half = narrow;
    const depth = front > back ? (front - back) / 2 : half;
    const filled = parts.map((p) =>
      p.name === 'Torso' ? { ...p, prims: [...p.prims, { kind: 'ellipsoid' as const, name: 'Waist', center: pivot, radii: [half, half, depth] as V3 }] } : p,
    );
    return lieDown(filled, flip, pivot, copySecond, finish);
  }

  /* ---- 趴着：手臂撑地，脖子、头抬起来（第一个上半身；同向的第二个是照它复制的） ---- */
  const aim = (p: Part, forward: 1 | -1) => plantArm(p, [splayOf(p), 0, forward], [0, 1, 0], [0, 0, forward]);
  const lift = quatEuler(-NECK_LIFT, 0, 0);
  const first = turnHeads(parts.map((p) => (p.type === 'arm' ? aim(p, 1) : p)), () => lift);
  // 同向的那一份照抬好头的复制；反向的照没抬的复制、手臂往它自己身后伸：仰面朝上，正好朝上看
  const second = copySecond(kind === 'opposite' ? parts.map((p) => (p.type === 'arm' ? aim(p, -1) : p)) : first, flip);
  const out = [...first, ...second];
  let q = quatEuler(Math.PI / 2, 0, 0);
  // 反向的：仰面那一头的肩膀离地近（肩关节靠着后背），两头的手不一样低。整个人绕左右的轴歪一点，四只手都踩到地上
  if (kind === 'opposite') {
    const groups = [first, second].map((list) => new Set(list.filter((p) => p.type === 'arm').map((p) => p.name)));
    // 手心不在手腕正下方：歪一次差一点，照新的样子再量着歪几次
    for (let round = 0; round < 4 && groups.every((g) => g.size); round++) {
      const trial = out.map((p) => (p.name === 'Torso' ? { ...p, pos: add(pivot, rotate(q, sub(p.pos, pivot))), quat: quatMul(q, p.quat) } : p));
      const xfs = worldTransforms({ parts: trial, scale: 1 });
      /** 一组手臂的手腕平均在哪（世界里） */
      const wristOf = (names: Set<string>): V3 => {
        const at = [...names].map((n) => {
          const part = trial.find((p) => p.name === n)!;
          const hand = part.bones?.find((b) => /^Hand_/.test(b.name)) ?? part.bones?.at(-1);
          const xf = xfs.get(n)!;
          return add(xf.pos, mul(rotate(xf.quat, hand ? hand.head : [0, 0, 0]), xf.scale));
        });
        return mul(at.reduce((a, b) => add(a, b)), 1 / at.length);
      };
      const [a, b] = groups.map(wristOf);
      const dy = lowest(trial, groups[0]) - lowest(trial, groups[1]);
      const dz = a[2] - b[2];
      if (Math.abs(dz) <= 1e-3) break;
      q = quatMul(quatEuler(Math.atan2(dy, dz), 0, 0), q);
    }
  }
  return finish(out, q);
}

/** 倒立时手臂往外撇多少（正切）：差不多竖直、和肩同宽 */
const HANDSTAND_SPLAY = 0.05;
/** 倒立时肩膀往头那边耸起多少（米）、头往胸口收多少（弧度） */
const HANDSTAND_SHRUG = 0.03;
const HANDSTAND_TUCK = 35 * (Math.PI / 180);

/** 平躺时手臂往外张开多少（正切，顺着身子放的话两个上半身的手在腰上交叉）、往地上那边斜多少：手搭在地上 */
const FLAT_SPREAD = 1.6;
const FLAT_DROP = 0.3;

/** 整条手臂绕肩关节转到朝 target（躯干的坐标里），别的不动 */
function pointArm(part: Part, target: V3): Part {
  const j = armJointsOf(part);
  if (!j) return part;
  const now = norm(rotate(part.quat, sub(j.wrist, j.shoulder)));
  const { bind: _bind, ...rest } = part;
  return { ...rest, quat: quatMul(quatBetween(now, target), part.quat) };
}

/** 脖子绕脖子根、头跟着一起转 turn(脖子)（上半身自己的坐标里） */
function turnHeads(list: Part[], turn: (neck: Part) => Quat): Part[] {
  return list.map((p) => {
    if (p.type !== 'neck' && p.type !== 'head') return p;
    const neck = list.find((q) => q.type === 'neck' && q.name.replace(/^Neck/, 'Head') === p.name.replace(/^Neck/, 'Head'));
    const q = turn(neck ?? p);
    const base = neck?.pos ?? p.pos;
    return { ...p, pos: turnAbout(p.pos, base, quatMat3(q)), quat: quatMul(q, p.quat) };
  });
}

/** 手臂的几个关节（部件自己的坐标）：肩、肘、腕 */
function armJointsOf(part: Part): { shoulder: V3; elbow: V3; wrist: V3 } | null {
  const bones = part.bones ?? [];
  const upper = bones.find((b) => /^UpperArm/.test(b.name));
  const lower = bones.find((b) => /^LowerArm/.test(b.name));
  if (!upper || !lower) return null;
  return { shoulder: upper.head, elbow: lower.head, wrist: lower.tail };
}

/**
 * 胳膊肘再弯 extra（弧度）：前臂、手（基本体、接上去的手或脚、骨骼）绕肘关节往里收。
 * 二次元素体的手臂是采样的格子，弯肘照它自己的 bend 那一项加（见 GridShape.bend）
 */
function bendElbow(part: Part, extra: number): Part {
  const j = armJointsOf(part);
  if (!j) return part;
  const u = sub(j.elbow, j.shoulder);
  const f = sub(j.wrist, j.elbow);
  let n = cross(u, f);
  if (len(n) < 1e-6 * len(u) * len(f)) n = cross(u, [0, 0, 1]);
  n = norm(n);
  const h = extra / 2;
  const m = quatMat3([n[0] * Math.sin(h), n[1] * Math.sin(h), n[2] * Math.sin(h), Math.cos(h)]);
  const e = j.elbow;
  const along = norm(u);
  const beyond = (p: V3) => dot(sub(p, e), along) > -1e-6;
  const prim = (p: Prim): Prim => {
    if (p.kind === 'grid' && p.bend) return { ...p, bend: [p.bend[0], p.bend[1], p.bend[2] + extra, p.bend[3]] };
    if (p.kind === 'cone' && p.name === 'Forearm') return { ...p, b: turnAbout(p.b, e, m) };
    if ((p.kind === 'cone' || p.kind === 'ellipsoid') && /^(Palm_|Thumb|Fingers_|Index|Middle|Ring|Little|Foot|Heel)/.test(p.name)) return turnPrim(p, e, m);
    return p;
  };
  return {
    ...part,
    prims: part.prims.map(prim),
    ...(part.posed ? { posed: { ...part.posed, prims: part.posed.prims.map(prim) } } : {}),
    ...(part.grafts ? { grafts: part.grafts.map((g) => ({ ...g, matrix: mat3Mul(m, g.matrix) as Graft['matrix'], offset: turnAbout(g.offset, e, m) })) } : {}),
    bones: (part.bones ?? []).map((b) => {
      if (/^(Shoulder|UpperArm)/.test(b.name)) return b;
      if (/^LowerArm/.test(b.name)) return { ...b, tail: turnAbout(b.tail, e, m) };
      return beyond(b.head) ? { ...b, head: turnAbout(b.head, e, m), tail: turnAbout(b.tail, e, m) } : b;
    }),
  };
}

/** 整条手臂绕肩关节转：上臂朝 U、前臂（肘到腕）偏向 F 那一边（躯干的坐标里） */
function aimArm(part: Part, U: V3, F: V3): Part {
  const j = armJointsOf(part);
  if (!j) return part;
  const frame = (a: V3, b: V3): Mat3 => {
    const x = norm(a);
    const y = norm(sub(b, mul(x, dot(b, x))));
    return basis(x, y, cross(x, y));
  };
  const now = frame(rotate(part.quat, sub(j.elbow, j.shoulder)), rotate(part.quat, sub(j.wrist, j.elbow)));
  const want = frame(U, F);
  const turn = toQuat(mat3Mul(want, transpose(now)));
  const { bind: _bind, ...rest } = part;
  return { ...rest, quat: quatMul(turn, part.quat) };
}

/**
 * 侧躺（和成品角色的一样，见 character/conjoin.ts）：两个上半身照他定的排在同一条轴上（不翘成 V），整个人侧着平躺在地上。
 * 靠地那只手臂从竖直往前抬多少照「前臂和躯干一样低」两分找（最多 LEAN_MAX，水平朝前）；前臂水平朝前贴地。
 */
const LEAN_MAX = 90 * (Math.PI / 180);
/** 量侧躺时最低点用的融合圆角（缺省的那个） */
const LIE_BLEND = 0.02;
/** 量的那一条前后多宽（躯干的厚度以内） */
const LIE_UNDER = 0.16;
/** 头往正上方回正几成、最多回正多少（全回正的话脖子折成一个角） */
const HEAD_UPRIGHT = 0.6;
const HEAD_MAX = 30 * (Math.PI / 180);
/**
 * 上面那只手撑在胸前的地上，往头那边或腰那边偏多少（正切）：第一对往自己头那边，第二对起往腰那边、越往后的越偏。
 * 不偏开的话几对的手落在同一处叠着融合，多出一小块碎片；偏得太多两个上半身的手在腰那儿碰上
 */
const freeAlong = (pair: number) => (pair === 0 ? 0.6 : -(0.05 + 0.1 * (pair - 1)));
/** 那只手的前臂往下撑地时往前斜多少（正切） */
const FREE_FORE_AHEAD = 0.5;
/** 上臂最多往下斜多少：再斜就从躯干里穿过去（白模肩宽、手臂短时手够不着地，就在胸前悬着一点） */
const DIP_MAX = 60 * (Math.PI / 180);

/**
 * 躺着：整个人侧过来（绕前后的轴转，第一个上半身的头朝 -X），两个上半身在腰上各往上翘；
 * 靠地那一侧的手臂胳膊肘撑着、前臂朝自己前面贴地；上面那只手伸直撑在胸前的地上；头往正上方回正一些
 */
function lieDown(
  parts: Part[],
  flip: Quat,
  pivot: V3,
  copySecond: (list: Part[], local: Quat) => Part[],
  finish: (list: Part[], q: Quat) => Figure,
): Figure {
  const pairOf = (p: Part) => Number(/^Arm_(\d+)/.exec(p.name)?.[1] ?? 1) - 1;
  // 腰到脖子那条线（躯干的坐标里）：脖子长在腰那条线前面一点，同向时两个上半身都往前偏，从上往下看成个浅 V。
  // 各在地面上转一下（侧过来以后绕左右的轴转就是在地面上转），两条线对成一条直线
  const necks = parts.filter((p) => p.type === 'neck' && p.parent === 'Torso');
  const axis = necks.length ? norm(sub(necks.reduce((sum, p) => add(sum, mul(p.pos, 1 / necks.length)), [0, 0, 0] as V3), pivot)) : ([0, 1, 0] as V3);
  const angleOf = (v: V3) => Math.atan2(v[2], v[1]);
  const lineUp = quatEuler(-angleOf(axis), 0, 0);
  const lineUpB = quatEuler(angleOf(mul(axis, -1)) - angleOf(rotate(flip, axis)), 0, 0);
  const build = (tilt: number, lean: number, drops: Map<string, number>) => {
    const rootQ = quatMul(quatEuler(0, 0, Math.PI / 2 - tilt), lineUp);
    const localB = quatMul(quatMul(quatEuler(0, 0, 2 * tilt), lineUpB), flip);
    /** 胳膊肘撑着的、手撑在胸前的（部件名，第二个上半身的是复制以前的名字） */
    const props: [Set<string>, Set<string>] = [new Set(), new Set()];
    const frees: [Set<string>, Set<string>] = [new Set(), new Set()];
    /** 摆一个上半身（half：它的坐标 → 世界的旋转） */
    const pose = (half: Quat, which: 0 | 1) => {
      const back: Quat = [-half[0], -half[1], -half[2], half[3]];
      const local = (d: V3) => rotate(back, d);
      // 这个上半身自己的前面（世界里、水平）：反向的那一个朝 -Z，撑地的前臂、手都往它自己前面伸
      const facing = rotate(half, [0, 0, 1]);
      const fwd = norm([facing[0], 0, facing[2]]);
      const headW = rotate(half, [0, 1, 0]);
      const along = norm([headW[0], 0, headW[2]]);
      const U = norm(add(mul([0, -1, 0], Math.cos(lean)), mul(fwd, Math.sin(lean))));
      const xfs = worldTransforms({ parts: parts.map((p) => (p.name === 'Torso' ? { ...p, pos: [0, 0, 0] as V3, quat: half } : p)), scale: 1 });
      const list = parts.map((p) => {
        if (p.type !== 'arm') return p;
        // 靠地的那一侧：肩膀在世界里低的那一只
        const twinName = p.name.replace(/_([LR])$/, (_m, s: string) => (s === 'L' ? '_R' : '_L'));
        const twin = parts.find((q) => q.type === 'arm' && q.name === twinName);
        const low = !twin || xfs.get(p.name)!.pos[1] <= xfs.get(twin.name)!.pos[1];
        if (low) {
          props[which].add(p.name);
          const j = armJointsOf(p);
          const angle = j ? Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(j.elbow, j.shoulder)), norm(sub(j.wrist, j.elbow)))))) : 0;
          return aimArm(bendElbow(p, Math.acos(Math.max(-1, Math.min(1, dot(U, fwd)))) - angle), local(U), local(fwd));
        }
        // 上面那只：上臂往前抬（从水平往下斜 dip，伸直往下的话从胸前穿过去扎进胸里），前臂往下撑地，手心贴地、手指朝前
        frees[which].add(p.name);
        const dip = drops.get(`${which}:${p.name}`) ?? 0.5;
        const Uf = norm(add(add(mul(fwd, Math.cos(dip)), mul([0, -1, 0], Math.sin(dip))), mul(along, freeAlong(pairOf(p)))));
        const Ff = norm(add([0, -1, 0], mul(fwd, FREE_FORE_AHEAD)));
        const j = armJointsOf(p);
        const angle = j ? Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(j.elbow, j.shoulder)), norm(sub(j.wrist, j.elbow)))))) : 0;
        const bent = aimArm(bendElbow(p, Math.acos(Math.max(-1, Math.min(1, dot(Uf, Ff)))) - angle), local(Uf), local(Ff));
        const jb = armJointsOf(bent)!;
        // 手臂已经摆好了：照它现在肩到手腕的方向（不再转），只把手腕弯过去贴地
        return plantArm(bent, rotate(bent.quat, sub(jb.wrist, jb.shoulder)), local(fwd), local([0, -1, 0]));
      });
      // 头往正上方回正：只回正左右歪的那一份，回正一部分、有上限
      const up = local([0, 1, 0]);
      const lean2 = Math.atan2(-up[0], up[1]);
      const fix = Math.sign(lean2) * Math.min(Math.abs(lean2) * HEAD_UPRIGHT, HEAD_MAX);
      return turnHeads(list, () => quatEuler(0, 0, fix));
    };
    const first = pose(rootQ, 0);
    // 第二个上半身在它自己的坐标里摆好再复制过去
    const before = pose(quatMul(rootQ, localB), 1);
    const second = copySecond(before, localB);
    const renamed = (set: Set<string>) => new Set(before.flatMap((p, i) => (set.has(p.name) ? [second[i].name] : [])));
    const list = [...first, ...second];
    const placed = list.map((p) => (p.name === 'Torso' ? { ...p, pos: add(pivot, rotate(rootQ, sub(p.pos, pivot))), quat: quatMul(rootQ, p.quat) } : p));
    return { list, placed, rootQ, propped: new Set([...props[0], ...renamed(props[1])]), free: [[...frees[0]].map((n): [string, string] => [n, n]), before.flatMap((p, i): [string, string][] => (frees[1].has(p.name) ? [[p.name, second[i].name]] : []))] };
  };
  /** 两分：f 从 lo 到 hi 由负变正（或反过来），找过零的那一点 */
  const solve = (f: (x: number) => number, lo: number, hi: number, rising: boolean) => {
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) < 0 === rising) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const drops = new Map<string, number>();
  // 两个上半身在同一条轴上（不翘）
  const tilt = 0;
  // 躯干最低到哪
  const floor = underside(build(tilt, 0, drops).placed.filter((p) => p.type === 'torso'));
  // 撑着的前臂比躯干还高多少：上臂越往前抬，胳膊肘越高
  const gap = (lean: number) => {
    const b = build(tilt, lean, drops);
    return lowest(b.placed, b.propped) - floor;
  };
  const lean = gap(0) > 0 ? 0 : gap(LEAN_MAX) < 0 ? LEAN_MAX : solve(gap, 0, LEAN_MAX, true);
  // 上面那只手：一只一只找往下斜多少，手心刚好贴到地（地 = 撑着的前臂、躯干里低的那个）
  const base = build(tilt, lean, drops);
  const ground = Math.min(floor, lowest(base.placed, base.propped));
  for (const [which, names] of base.free.entries()) {
    for (const [own, final] of names) {
      const key = `${which}:${own}`;
      const handLow = (drop: number) => {
        drops.set(key, drop);
        return lowest(build(tilt, lean, drops).placed, new Set([final])) - ground;
      };
      // 上臂越往下斜手越低：上臂竖直往下都够不着就竖直，水平都扎进地里就水平
      drops.set(key, handLow(DIP_MAX) > 0 ? DIP_MAX : handLow(0) < 0 ? 0 : solve(handLow, 0, DIP_MAX, false));
    }
  }
  const { list, rootQ } = build(tilt, lean, drops);
  return finish(list, rootQ);
}
