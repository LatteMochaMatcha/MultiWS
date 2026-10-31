/**
 * 摆位用的最小向量 / 四元数工具。只用普通数组，不依赖 three.js，
 * 这样摆位结果可以直接 JSON 化、送进 Web Worker。
 */

export type V3 = [number, number, number];
/** x, y, z, w */
export type Quat = [number, number, number, number];

export const Q_ID: Quat = [0, 0, 0, 1];
export const UP: V3 = [0, 1, 0];

export const v = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
/** a + d · s */
export const madd = (a: V3, d: V3, s: number): V3 => [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const lerp = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function norm(a: V3): V3 {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

const quatNorm = (q: Quat): Quat => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  // 加 0 是为了不留下 -0（存成 JSON 再读回来会变成 0）
  return l > 0 ? [q[0] / l + 0, q[1] / l + 0, q[2] / l + 0, q[3] / l + 0] : [0, 0, 0, 1];
};

/** 把单位向量 from 转到单位向量 to 的最短旋转 */
export function quatBetween(from: V3, to: V3): Quat {
  const r = dot(from, to) + 1;
  if (r < 1e-9) {
    // 正好反向：随便挑一条垂直轴转 180°
    return Math.abs(from[0]) > Math.abs(from[2])
      ? quatNorm([-from[1], from[0], 0, 0])
      : quatNorm([0, -from[2], from[1], 0]);
  }
  return quatNorm([
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
    r,
  ]);
}

/** 欧拉角（弧度，XYZ 顺序，与 three.js 默认一致） */
export function quatEuler(x: number, y: number, z: number): Quat {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/**
 * 由局部 X、Y、Z 轴在外面坐标系里的方向（三个互相垂直的单位向量，右手系）得到旋转。
 */
export function quatBasis(x: V3, y: V3, z: V3): Quat {
  const [m00, m10, m20] = x;
  const [m01, m11, m21] = y;
  const [m02, m12, m22] = z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return quatNorm([(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]);
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return quatNorm([0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]);
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return quatNorm([(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]);
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return quatNorm([(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]);
}

/** a ∘ b：先做 b，再做 a */
export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** 反方向的旋转（单位四元数的逆） */
export const quatConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** 四元数 → 欧拉角（弧度，XYZ 顺序），quatEuler 的逆运算 */
export function eulerOf(q: Quat): V3 {
  const [x, y, z, w] = q;
  // 只用得到旋转矩阵里的这几项
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m23, m33), ey, Math.atan2(-m12, m11)];
  // 正好转到 ±90°：绕 X 和绕 Z 分不开了，全算在 X 上
  return [Math.atan2(m32, m22), ey, 0];
}

/** 3×3 矩阵，按行存 */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** 四元数 → 旋转矩阵 */
export function quatMat3(q: Quat): Mat3 {
  const [x, y, z, w] = q;
  const xx = x * (x + x);
  const xy = x * (y + y);
  const xz = x * (z + z);
  const yy = y * (y + y);
  const yz = y * (z + z);
  const zz = z * (z + z);
  const wx = w * (x + x);
  const wy = w * (y + y);
  const wz = w * (z + z);
  return [1 - (yy + zz), xy - wz, xz + wy, xy + wz, 1 - (xx + zz), yz - wx, xz - wy, yz + wx, 1 - (xx + yy)];
}

export const mat3Apply = (m: Mat3, p: V3): V3 => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
  m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
  m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
];

/** a · b：先做 b，再做 a */
export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const out = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return out;
}

/** 沿 frame 这组轴各自缩放 s 倍（frame 缺省就是坐标轴本身）：R · diag(s) · Rᵀ */
export function scaleAlong(s: V3, frame?: Quat): Mat3 {
  if (!frame) return [s[0], 0, 0, 0, s[1], 0, 0, 0, s[2]];
  const r = quatMat3(frame);
  const out = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Mat3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i * 3 + j] = r[i * 3] * s[0] * r[j * 3] + r[i * 3 + 1] * s[1] * r[j * 3 + 1] + r[i * 3 + 2] * s[2] * r[j * 3 + 2];
    }
  }
  return out;
}

export function rotate(q: Quat, p: V3): V3 {
  const [x, y, z, w] = q;
  // t = 2 · (q.xyz × p)
  const tx = 2 * (y * p[2] - z * p[1]);
  const ty = 2 * (z * p[0] - x * p[2]);
  const tz = 2 * (x * p[1] - y * p[0]);
  return [
    p[0] + w * tx + (y * tz - z * ty),
    p[1] + w * ty + (z * tx - x * tz),
    p[2] + w * tz + (x * ty - y * tx),
  ];
}
