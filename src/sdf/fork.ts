/**
 * 从胯往上渐渐分开（好几个上半身，见 geometry/torsos.ts、figure.ts 的 Fork）：躯干的形状（采样好的格子、放样）
 * 所在的部件整个绕 pivot 转了 quat、又挪了 shift（写在部件自己的摆放里），但高度在 from 以下的地方照原样留在胯上
 * （转、挪都退回去），到 to 才转足、挪足，中间渐渐过渡——几个上半身从胯上像树杈一样分出去，腰两侧不鼓包、不起棱。
 * 挪可以另有一段（shiftFrom–shiftTo）：先在低处挪开（几个上半身并排站在一副宽胯上），高处再转开。
 *
 * 求距离时反过来：部件坐标里的一点先照整个转、挪的样子摆到胯的坐标里，再找它是分开之前哪一点挪过来的，在那一点上求原来的形状。
 */
import type { Fork } from '../geometry/figure';
import { type Mat3, type Quat, type V3, mat3Apply, mat3Mul, quatConj, quatMat3, rotate } from '../geometry/vec';

/** 分开的上半身在分足以后再往上多高以内和旁边的分界（再往上已经各是各的） */
const SPLIT_ABOVE = 0.12;

export interface ForkWarp {
  /**
   * 部件坐标里的一点 (x, y, z) 是分开之前哪一点：写进 out[0..2]。
   * 返回距离要除以的倍数（分开的那一段被拉伸、压扁了，离表面近了；没转没挪的地方是 1），
   * out[3] 是和旁边的上半身的分界在这一点外面多远（正的就切掉；没有分界是 -Infinity）
   */
  map(x: number, y: number, z: number, out: Float64Array): number;
  /** 一个盒子（分开之前的坐标）放到部件坐标里占多大：退回胯上那一截也算进来，就地改 lo、hi */
  grow(lo: V3, hi: V3): void;
}

export function forkWarp(fork: Fork): ForkWarp {
  return fork.frame ? framed(fork, fork.frame) : bareWarp(fork);
}

/**
 * frame 给了的话（见 framed），map 先把点换进上半身的坐标、分完再换回来：换算是预先算好的矩阵，
 * 求值时不新建数组（这是融合时最热的路径之一）
 */
function bareWarp(fork: Fork, frame?: Fork['frame']): ForkWarp {
  const full = quatConj(fork.quat);
  const into = frame ? frameAffine(frame) : IDENTITY;
  const outof = frame ? inverseAffine(into) : IDENTITY;
  /** 换到上半身的坐标里放大了多少（距离跟着换算）；被压扁、拉伸过的，拉伸、压扁的倍数最多再乘上它最长、最短的方向之比 */
  const scale = frame?.scale ?? 1;
  const squash = frame?.shape && frame.inverse ? norm2(frame.shape) * norm2(frame.inverse) : 1;
  const [q00, q01, q02, q10, q11, q12, q20, q21, q22] = quatMat3(fork.quat);
  const [a00, a01, a02, a10, a11, a12, a20, a21, a22, ax, ay, az] = into;
  const [b00, b01, b02, b10, b11, b12, b20, b21, b22, bx, by, bz] = outof;
  /** 从哪么高起有转、挪，到哪么高转足、挪足 */
  const low = Math.min(fork.from, fork.shiftFrom ?? fork.from);
  const high = Math.max(fork.to, fork.shiftTo ?? fork.to);
  const turnFrom = fork.from;
  const turnSpan = fork.to - fork.from;
  const moveFrom = fork.shiftFrom ?? fork.from;
  const moveSpan = (fork.shiftTo ?? fork.to) - moveFrom;
  // 整个转的那一下：绕单位轴 (nx, ny, nz) 转 angle
  const half = Math.acos(Math.max(-1, Math.min(1, fork.quat[3])));
  const sinHalf = Math.sin(half);
  const angle = 2 * half;
  const [nx, ny, nz] = sinHalf > 1e-9 ? [fork.quat[0] / sinHalf, fork.quat[1] / sinHalf, fork.quat[2] / sinHalf] : [0, 1, 0];
  const [px, py, pz] = fork.pivot;
  const [sx, sy, sz] = fork.shift;
  /** 挪另有一段的：只有往两边的那一份照那一段挪，上下、前后的那一份跟着转（见 Fork.shiftFrom） */
  const apart = fork.shiftFrom !== undefined;
  /** 求值时用的：这一点在胯的坐标里（w）、猜的高度上退回去以后（相对 pivot） */
  let wx = 0;
  let wy = 0;
  let wz = 0;
  let rx = 0;
  let ry = 0;
  let rz = 0;
  /** 猜的高度上转了几成、挪了几成，以及它们随高度变得多快 */
  let t = 0;
  let m = 0;
  let dt = 0;
  let dm = 0;
  const amounts = (h: number) => {
    const u = (h - turnFrom) / turnSpan;
    const v = (h - moveFrom) / moveSpan;
    t = ease(u);
    dt = easeSlope(u) / turnSpan;
    m = ease(v);
    dm = easeSlope(v) / moveSpan;
  };
  /** 高度 h 上退回去：w 先减掉挪的那一份，再反着转 t 成（罗德里格斯公式），结果相对 pivot 写进 rx、ry、rz */
  const back = (h: number) => {
    amounts(h);
    const lift = apart ? t : m;
    const ex = wx - px - sx * m;
    const ey = wy - py - sy * lift;
    const ez = wz - pz - sz * lift;
    const phi = -t * angle;
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    const dot = nx * ex + ny * ey + nz * ez;
    rx = ex * c + (ny * ez - nz * ey) * sn + nx * dot * (1 - c);
    ry = ey * c + (nz * ex - nx * ez) * sn + ny * dot * (1 - c);
    rz = ez * c + (nx * ey - ny * ex) * sn + nz * dot * (1 - c);
  };
  /**
   * 退回去的那一点随猜的高度变得多快（gx, gy, gz）：转的那一份是 −angle·t′·(n × r)，挪的那一份是 −m′·Rᵀ·shift。
   * 同一套数也给出雅可比矩阵：分开之前的坐标 = (I + g·e_yᵀ / (1 − g_y)) · 一个转动 · 部件坐标
   */
  let gx = 0;
  let gy = 0;
  let gz = 0;
  const slope = () => {
    const k = -angle * dt;
    gx = k * (ny * rz - nz * ry);
    gy = k * (nz * rx - nx * rz);
    gz = k * (nx * ry - ny * rx);
    const dl = apart ? dt : dm;
    if (dm || dl) {
      // Rᵀ·（挪的那一份随高度变得多快）：反着转 t 成
      const vx = sx * dm;
      const vy = sy * dl;
      const vz = sz * dl;
      const phi = -t * angle;
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      const dot = nx * vx + ny * vy + nz * vz;
      gx -= vx * c + (ny * vz - nz * vy) * sn + nx * dot * (1 - c);
      gy -= vy * c + (nz * vx - nx * vz) * sn + ny * dot * (1 - c);
      gz -= vz * c + (nx * vy - ny * vx) * sn + nz * dot * (1 - c);
    }
  };
  return {
    map(x0, y0, z0, out) {
      // 先照部件整个转、挪的样子摆到胯的坐标里（w），再找它是分开之前哪一点（s）挪过来的：
      // s 在高度 h 处只转了、挪了那么多。s 的高度随猜的 h 变，要找 s 的高度正好等于 h 的那个 h：
      // h 在分开的那一段以下（没转没挪）就是 w 自己的高度，以上（转足挪足）就是部件坐标里的高度，不然在两者之间找
      // （牛顿法，用上面的导数；跳出夹着的范围就改成二分）
      const x = a00 * x0 + a01 * y0 + a02 * z0 + ax;
      const y = a10 * x0 + a11 * y0 + a12 * z0 + ay;
      const z = a20 * x0 + a21 * y0 + a22 * z0 + az;
      const ex = x - px;
      const ey = y - py;
      const ez = z - pz;
      wx = px + q00 * ex + q01 * ey + q02 * ez + sx;
      wy = py + q10 * ex + q11 * ey + q12 * ez + sy;
      wz = pz + q20 * ex + q21 * ey + q22 * ez + sz;
      let h: number;
      let lip = 1;
      if (wy <= low) {
        h = wy;
        out[0] = wx;
        out[1] = wy;
        out[2] = wz;
      } else if (y >= high) {
        h = y;
        out[0] = x;
        out[1] = y;
        out[2] = z;
      } else {
        let lo = low;
        let hi = high;
        h = Math.min(Math.max(wy, lo), hi);
        for (let step = 0; step < 30; step++) {
          back(h);
          const f = py + ry - h;
          if (Math.abs(f) < 1e-8) break;
          if (f > 0) lo = h;
          else hi = h;
          slope();
          const d = gy - 1;
          let next = d < -1e-6 ? h - f / d : (lo + hi) / 2;
          if (!(next > lo && next < hi)) next = (lo + hi) / 2;
          h = next;
        }
        back(h);
        out[0] = px + rx;
        out[1] = py + ry;
        out[2] = pz + rz;
        if ((t > 0 && t < 1) || (m > 0 && m < 1)) {
          // 在这一点附近被拉伸、压扁了多少（雅可比矩阵最大的奇异值）：距离要除以它。
          // 矩阵是 I + u·e_yᵀ（u = g / (1 − g_y)）乘一个转动：只在 e_y 和 u 张成的平面里不是 1，照 2×2 的式子算
          slope();
          const fold = 1 - gy;
          if (fold < 0.05) lip = 20;
          else {
            const a = gy / fold;
            const b = Math.hypot(gx, gz) / fold;
            const tr = (1 + a) ** 2 + b * b + 1;
            const top = Math.sqrt((tr + Math.sqrt(Math.max(0, tr * tr - 4 * (1 + a) ** 2))) / 2);
            lip = Math.max(1, top * 1.02);
          }
        }
      }
      let beyond = -Infinity;
      if (fork.split && h < fork.to + SPLIT_ABOVE) {
        // 分界是两条中线（照高度转、挪过的身体正中）正中间
        const mine = forkMid(fork, fork.quat, fork.shift, h);
        for (const other of fork.split) {
          const mid = (mine + forkMid(fork, other.quat, other.shift, h)) / 2;
          const off = other.dir * (wx - mid);
          if (off > beyond) beyond = off;
        }
      }
      out[3] = beyond / scale;
      if (frame) {
        const ox = out[0];
        const oy = out[1];
        const oz = out[2];
        out[0] = b00 * ox + b01 * oy + b02 * oz + bx;
        out[1] = b10 * ox + b11 * oy + b12 * oz + by;
        out[2] = b20 * ox + b21 * oy + b22 * oz + bz;
      }
      return lip > 1 ? lip * squash : lip;
    },
    grow(lo, hi) {
      // 高过分足的地方的那一截原样不动：只有它下面的那一截会退回去
      const top = Math.min(hi[1], high);
      if (top < lo[1]) return;
      const corners: V3[] = [];
      for (let i = 0; i < 8; i++) corners.push([i & 1 ? hi[0] : lo[0], i & 2 ? top : lo[1], i & 4 ? hi[2] : lo[2]]);
      for (const [t, m] of [
        [0, 0],
        [0.5, 0.5],
        [0, 1],
      ]) {
        const turn = partTurn(fork.quat, t);
        for (const c of corners) {
          // 只转了 t、挪了 m 的那一点在胯的坐标里在哪，再换回部件坐标
          const lift = fork.shiftFrom !== undefined ? t : m;
          const w = add3(fork.pivot, rotate(turn, sub3(c, fork.pivot)), [fork.shift[0] * m, fork.shift[1] * lift, fork.shift[2] * lift]);
          const p = add3(fork.pivot, rotate(full, sub3(w, add3(fork.pivot, fork.shift, O))), O);
          for (let k = 0; k < 3; k++) {
            if (p[k] < lo[k]) lo[k] = p[k];
            if (p[k] > hi[k]) hi[k] = p[k];
          }
        }
      }
    },
  };
}

const O: V3 = [0, 0, 0];
const add3 = (a: V3, b: V3, c: V3): V3 => [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** 照 quat、shift 分开的那个上半身，在（分开之前的）高度 y 处身体正中线挪到了 x 多少 */
function forkMid(fork: Fork, quat: Quat, shift: V3, y: number): number {
  const [t, m] = forkAmounts(fork, y);
  const p = rotate(partTurn(quat, t), [-fork.pivot[0], y - fork.pivot[1], 0]);
  return fork.pivot[0] + p[0] + shift[0] * m;
}

/** 高度 y 处转了几成、挪了几成（各自那一段以下 0、以上 1，中间两头缓） */
function forkAmounts(fork: Fork, y: number): [turn: number, move: number] {
  return [ramp(fork.from, fork.to, y), ramp(fork.shiftFrom ?? fork.from, fork.shiftTo ?? fork.to, y)];
}

const ramp = (from: number, to: number, y: number) => ease((y - from) / (to - from));

/**
 * 0 → 1 两头缓（6u⁵ − 15u⁴ + 10u³）：两头连弯的程度都是 0。只是斜率连续的话（3u² − 2u³），
 * 分开的那一段两头弯的程度一下子从 0 跳到很大，腰上、肋骨下沿各一道横着的棱
 */
const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (6 * u - 15) + 10));
const easeSlope = (u: number) => (u <= 0 || u >= 1 ? 0 : 30 * u * u * (1 - u) * (1 - u));

/**
 * 格子在挂在上半身上的一个部件（胸）自己的坐标里（见 Fork.frame）：先换到上半身的坐标里再分，分完换回来
 */
function framed(fork: Fork, frame: NonNullable<Fork['frame']>): ForkWarp {
  const inner = bareWarp(fork);
  const into = frameAffine(frame);
  const back = inverseAffine(into);
  /** 一个盒子换到另一个坐标里以后占多大 */
  const box = (lo: V3, hi: V3, m: Affine) => {
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 8; i++) {
      const c = applyAffine(m, [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], c[k]);
        max[k] = Math.max(max[k], c[k]);
      }
    }
    return { min, max };
  };
  return {
    map: bareWarp(fork, frame).map,
    grow(lo, hi) {
      const outer = box(lo, hi, into);
      inner.grow(outer.min, outer.max);
      const mine = box(outer.min, outer.max, back);
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], mine.min[k]);
        hi[k] = Math.max(hi[k], mine.max[k]);
      }
    },
  };
}

/** 仿射变换：3×3 矩阵（按行）加平移，p → M·p + t */
type Affine = [number, number, number, number, number, number, number, number, number, number, number, number];
const IDENTITY: Affine = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** 部件里的一点换到上半身里：pos + quat · (scale · shape · p) */
function frameAffine(frame: NonNullable<Fork['frame']>): Affine {
  const r = quatMat3(frame.quat);
  const m = frame.shape ? mat3Mul(r, frame.shape) : r;
  return [...m.map((v) => v * frame.scale), ...frame.pos] as Affine;
}

function inverseAffine(a: Affine): Affine {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22, tx, ty, tz] = a;
  const c00 = m11 * m22 - m12 * m21;
  const c01 = m02 * m21 - m01 * m22;
  const c02 = m01 * m12 - m02 * m11;
  const det = m00 * c00 + m10 * c01 + m20 * c02;
  const k = 1 / det;
  const inv = [
    c00 * k,
    c01 * k,
    c02 * k,
    (m12 * m20 - m10 * m22) * k,
    (m00 * m22 - m02 * m20) * k,
    (m02 * m10 - m00 * m12) * k,
    (m10 * m21 - m11 * m20) * k,
    (m01 * m20 - m00 * m21) * k,
    (m00 * m11 - m01 * m10) * k,
  ];
  return [...inv, -(inv[0] * tx + inv[1] * ty + inv[2] * tz), -(inv[3] * tx + inv[4] * ty + inv[5] * tz), -(inv[6] * tx + inv[7] * ty + inv[8] * tz)] as Affine;
}

const applyAffine = (a: Affine, p: V3): V3 => [
  a[0] * p[0] + a[1] * p[1] + a[2] * p[2] + a[9],
  a[3] * p[0] + a[4] * p[1] + a[5] * p[2] + a[10],
  a[6] * p[0] + a[7] * p[1] + a[8] * p[2] + a[11],
];

/** 矩阵最大的奇异值（对 MᵀM 做幂迭代） */
function norm2(m: Mat3): number {
  let v: V3 = [1, 0.7, 0.4];
  let size = 1;
  for (let i = 0; i < 30; i++) {
    const w = mat3Apply(m, v);
    const u: V3 = [m[0] * w[0] + m[3] * w[1] + m[6] * w[2], m[1] * w[0] + m[4] * w[1] + m[7] * w[2], m[2] * w[0] + m[5] * w[1] + m[8] * w[2]];
    size = Math.hypot(u[0], u[1], u[2]);
    if (size < 1e-12) return 0;
    v = [u[0] / size, u[1] / size, u[2] / size];
  }
  return Math.sqrt(size);
}

/** 绕同一根轴转 q 的几成 */
function partTurn(q: Quat, a: number): Quat {
  const w = Math.max(-1, Math.min(1, q[3]));
  const half = Math.acos(w);
  const s = Math.sin(half);
  if (s < 1e-9) return [0, 0, 0, 1];
  const k = Math.sin(half * a) / s;
  return [q[0] * k, q[1] * k, q[2] * k, Math.cos(half * a)];
}
