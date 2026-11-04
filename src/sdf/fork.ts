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
  return fork.frame ? framed(fork, fork.frame) : fork.reshape ? reshapedWarp(fork) : bareWarp(fork);
}

/** 缩放绕腰支点渐变，再作原有的分叉；不能把已经接回胯上的腰根整个缩放。 */
function reshapedWarp(fork: Fork): ForkWarp {
  const a = fork.reshape!;
  const inv = inverseAffine([...a, 0, 0, 0]);
  const inner = bareWarp(fork);
  const pivot = fork.pivot, scratch = new Float64Array(4);
  const start = fork.from, span = fork.to - start;
  const bound = Math.max(1, norm2(a)) * Math.max(1, norm2(inv.slice(0, 9) as Mat3));
  const forward = (p: V3): V3 => add3(pivot, mat3Apply(a, sub3(p, pivot)), O);
  const backward = (p: V3): V3 => add3(pivot, applyAffine(inv, sub3(p, pivot)), O);
  let rx = 0, ry = 0, rz = 0, gx = 0, gy = 0, gz = 0;
  // p = pivot + inverse(I + ease(h)·(A-I))·(r-pivot)，同时求它随 h 的导数。
  const at = (h: number, x: number, y: number, z: number) => {
    const t = (h - start) / span, w = ease(t), dw = easeSlope(t) / span;
    const m00=1+w*(a[0]-1), m01=w*a[1], m02=w*a[2];
    const m10=w*a[3], m11=1+w*(a[4]-1), m12=w*a[5];
    const m20=w*a[6], m21=w*a[7], m22=1+w*(a[8]-1);
    const c00=m11*m22-m12*m21, c01=m02*m21-m01*m22, c02=m01*m12-m02*m11;
    const det=m00*c00+m10*c01+m20*c02;
    const b00=c00/det, b01=c01/det, b02=c02/det;
    const b10=(m12*m20-m10*m22)/det, b11=(m00*m22-m02*m20)/det, b12=(m02*m10-m00*m12)/det;
    const b20=(m10*m21-m11*m20)/det, b21=(m01*m20-m00*m21)/det, b22=(m00*m11-m01*m10)/det;
    const px=b00*x+b01*y+b02*z, py=b10*x+b11*y+b12*z, pz=b20*x+b21*y+b22*z;
    rx=pivot[0]+px; ry=pivot[1]+py; rz=pivot[2]+pz;
    const dx=(a[0]-1)*px+a[1]*py+a[2]*pz, dy=a[3]*px+(a[4]-1)*py+a[5]*pz, dz=a[6]*px+a[7]*py+(a[8]-1)*pz;
    gx=-dw*(b00*dx+b01*dy+b02*dz); gy=-dw*(b10*dx+b11*dy+b12*dz); gz=-dw*(b20*dx+b21*dy+b22*dz);
  };
  return {
    map(x, y, z, out) {
      const dx=x-pivot[0], dy=y-pivot[1], dz=z-pivot[2];
      const lip = inner.map(pivot[0]+a[0]*dx+a[1]*dy+a[2]*dz, pivot[1]+a[3]*dx+a[4]*dy+a[5]*dz, pivot[2]+a[6]*dx+a[7]*dy+a[8]*dz, scratch);
      const vx=scratch[0]-pivot[0], vy=scratch[1]-pivot[1], vz=scratch[2]-pivot[2];
      const fx=pivot[0]+inv[0]*vx+inv[1]*vy+inv[2]*vz, fy=pivot[1]+inv[3]*vx+inv[4]*vy+inv[5]*vz, fz=pivot[2]+inv[6]*vx+inv[7]*vy+inv[8]*vz;
      gx=gy=gz=0;
      if (scratch[1] <= start) { rx=scratch[0]; ry=scratch[1]; rz=scratch[2]; }
      else if (fy >= fork.to) { rx=fx; ry=fy; rz=fz; }
      else {
        let lo=start, hi=fork.to, h=Math.max(lo, Math.min(hi, fy)), evaluated=NaN;
        for (let i=0; i<16; i++) {
          evaluated=h;
          at(h, vx, vy, vz);
          const f=ry-h;
          if (Math.abs(f)<1e-9) break;
          if (f>0) lo=h; else hi=h;
          const next=h-f/(gy-1);
          h=next>lo && next<hi ? next : (lo+hi)/2;
        }
        if (evaluated!==h) at(h, vx, vy, vz);
      }
      out[0]=rx; out[1]=ry; out[2]=rz; out[3]=scratch[3];
      return lip * bound * (1 + Math.hypot(gx, gy, gz) / Math.max(0.05, 1-gy));
    },
    grow(lo, hi) {
      const points: V3[] = [];
      for (let i=0;i<8;i++) {
        const p: V3=[i&1?hi[0]:lo[0],i&2?hi[1]:lo[1],i&4?hi[2]:lo[2]];
        points.push(p, forward(p));
      }
      const min=([0,1,2].map(k=>Math.min(...points.map(p=>p[k])))) as V3;
      const max=([0,1,2].map(k=>Math.max(...points.map(p=>p[k])))) as V3;
      inner.grow(min,max);
      const mapped: V3[]=[];
      for(let i=0;i<8;i++) mapped.push(backward([i&1?max[0]:min[0],i&2?max[1]:min[1],i&4?max[2]:min[2]]));
      for(let k=0;k<3;k++) { lo[k]=Math.min(lo[k],...mapped.map(p=>p[k])); hi[k]=Math.max(hi[k],...mapped.map(p=>p[k])); }
    },
  };
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
  const freeze = fork.freeze;
  const middle = compileForkMid(fork, fork.quat, fork.shift);
  const neighbours = fork.split?.map((other) => ({ dir: other.dir, at: compileForkMid(fork, other.quat, other.shift) }));
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
  let c = 1;
  let sn = 0;
  const back = (h: number) => {
    amounts(h);
    const lift = apart ? t : m;
    const ex = wx - px - sx * m;
    const ey = wy - py - sy * lift;
    const ez = wz - pz - sz * lift;
    const phi = -t * angle;
    c = Math.cos(phi);
    sn = Math.sin(phi);
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
      const dot = nx * vx + ny * vy + nz * vz;
      gx -= vx * c + (ny * vz - nz * vy) * sn + nx * dot * (1 - c);
      gy -= vy * c + (nz * vx - nx * vz) * sn + ny * dot * (1 - c);
      gz -= vz * c + (nx * vy - ny * vx) * sn + nz * dot * (1 - c);
    }
  };
  // 绕 Z 分叉时，逆解高度、分界和伸长倍数与深度无关。小型定长缓存复用同一列的逆解；
  // 只在坐标变换也不混入 Z 时启用，任意轴旋转继续走完整求解。
  // 启用时一律照深度 0 求、最后加回深度：缓存里记的就是深度 0 的，取出来的和现算的逐值一样
  // （以前照这一点的深度求，缓存里记「求出来的减深度」，取出来再加回去，差在最后一位上，同一点先算过哪些点结果就不一样）
  const planar = (angle === 0 || (nx === 0 && ny === 0)) && a02 === 0 && a12 === 0 && a20 === 0 && a21 === 0 && b02 === 0 && b12 === 0 && b20 === 0 && b21 === 0;
  const cache = planar ? new Float64Array(512 * 7).fill(NaN) : null;
  return {
    map(x0, y0, depth, out) {
      const slot = (((Math.floor(x0 * 8192) * 73856093) ^ (Math.floor(y0 * 8192) * 19349663)) & 511) * 7;
      if (cache && cache[slot] === x0 && cache[slot + 1] === y0) {
        out[0] = cache[slot + 2];
        out[1] = cache[slot + 3];
        out[2] = depth + cache[slot + 4];
        out[3] = cache[slot + 5];
        return cache[slot + 6];
      }
      const z0 = cache ? 0 : depth;
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
      if (freeze !== undefined) {
        // 照一个高度上转、挪了多少整块退回去（见 Fork.freeze）：不随高度变，不拉伸
        h = freeze;
        back(h);
        out[0] = px + rx;
        out[1] = py + ry;
        out[2] = pz + rz;
      } else if (wy <= low) {
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
        let evaluatedHeight = NaN;
        for (let step = 0; step < 30; step++) {
          evaluatedHeight = h;
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
        if (evaluatedHeight !== h) back(h);
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
      if (neighbours && h < fork.to + SPLIT_ABOVE) {
        // 分界是两条中线（照高度转、挪过的身体正中）正中间
        const turn = ease((h - turnFrom) / turnSpan);
        const move = ease((h - moveFrom) / moveSpan);
        const mine = middle(h, turn, move);
        for (const other of neighbours) {
          const mid = (mine + other.at(h, turn, move)) / 2;
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
      const result = lip > 1 ? lip * squash : lip;
      if (cache) {
        cache[slot] = x0;
        cache[slot + 1] = y0;
        cache[slot + 2] = out[0];
        cache[slot + 3] = out[1];
        cache[slot + 4] = out[2];
        cache[slot + 5] = out[3];
        cache[slot + 6] = result;
        out[2] = depth + out[2];
      }
      return result;
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

/** 分界只需要旋转后中线的 X 分量；常量编译一次，逐点不创建向量或四元数。 */
function compileForkMid(fork: Fork, quat: Quat, shift: V3): (y: number, turn: number, move: number) => number {
  const half = Math.acos(Math.max(-1, Math.min(1, quat[3])));
  const sine = Math.sin(half);
  const [px, py] = fork.pivot;
  if (sine < 1e-9) return (_y, _turn, move) => shift[0] * move;
  const [qx, qy, qz] = quat;
  return (y, turn, move) => {
    const k = Math.sin(half * turn) / sine;
    const x = qx * k;
    const z = qz * k;
    const w = Math.cos(half * turn);
    const height = y - py;
    const tx = -2 * z * height;
    const ty = -2 * z * px;
    const tz = 2 * (x * height + qy * k * px);
    return px + (-px + w * tx + (qy * k * tz - z * ty)) + shift[0] * move;
  };
}

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
  const inner = fork.reshape ? reshapedWarp(fork) : bareWarp(fork);
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
  const mapped = new Float64Array(4);
  const condition = frame.shape && frame.inverse ? norm2(frame.shape) * norm2(frame.inverse) : 1;
  return {
    map: fork.reshape ? (x, y, z, out) => {
      const p=applyAffine(into, [x,y,z]);
      const lip=inner.map(...p,mapped), q=applyAffine(back,[mapped[0],mapped[1],mapped[2]]);
      out[0]=q[0]; out[1]=q[1]; out[2]=q[2]; out[3]=mapped[3]/frame.scale;
      return lip*condition;
    } : bareWarp(fork, frame).map,
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
