/**
 * 成品角色的表情和视线。纯函数，不碰界面。
 *
 * 表情是脸部网格的「变形」：文件里记着每个变形把每个顶点挪多少（见 source.ts 的 FaceMorphs），
 * 把几个变形各开到多少再加起来，就是一张脸现在的样子。拼装时头可能被复制、转过方向、放大缩小，
 * 所以每张脸（FaceInstance）记着「原始的脸 → 现在这张脸」转了多少、放大了多少，位移照它换算。
 * 表情加在静止姿势上，摆姿势时再跟着头的骨骼转。
 *
 * 视线是转两只眼睛的骨骼：往外、往里、上下各能转多少度，文件里有（VRM 的 lookAt）。
 */
import { t } from '../i18n';
import { type Mat3, type Quat, type V3, mat3Apply, quatConj, quatMul, rotate } from '../geometry/vec';
import type { Chunk, FaceMorphs } from './source';

/** 一张脸的表情：表情的名字（joy、blink_l、a …，或者直接写变形的名字 HA_Fung1）→ 开到多少（0–1） */
export type FaceWeights = Record<string, number>;

/** 拼好以后的一张脸 */
export interface FaceInstance {
  /**
   * 姿势数据里用它当名字：自己的头是 Head，复制出来的头是 Head.002、Head.003 …，
   * 同一个头上多出来的脸是 Head/2、Head/3 …
   */
  key: string;
  /** 这张脸跟着哪根骨骼 */
  bone: string;
  /** 两只眼睛的骨骼（角色自己的左、右）；多出来的脸没有自己的眼睛骨骼，是 null */
  eyes: [string, string] | null;
  /** 原始的脸 → 现在这张脸：位移要乘的 3×3（按行），以及其中只管转向的那一部分 */
  frame: Mat3;
  turn: Mat3;
  /** 转向写成四元数（视线要用） */
  quat: Quat;
}

/** 给人看的名字：头 1、头 2、脸 2 … */
export function faceLabel(key: string): string {
  const copy = /^Head\.(\d+)$/.exec(key);
  if (copy) return t('头 {n}', { n: Number(copy[1]) });
  const extra = /^Head\/(\d+)$/.exec(key);
  if (extra) return t('脸 {n}', { n: Number(extra[1]) });
  return t('头 {n}', { n: 1 });
}

/* ---------------- 「原始的脸 → 现在这张脸」 ---------------- */

const det3 = (m: ArrayLike<number>) =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);

function inverse3(m: ArrayLike<number>): number[] | null {
  const d = det3(m);
  if (Math.abs(d) < 1e-18) return null;
  return [
    (m[4] * m[8] - m[5] * m[7]) / d, (m[2] * m[7] - m[1] * m[8]) / d, (m[1] * m[5] - m[2] * m[4]) / d,
    (m[5] * m[6] - m[3] * m[8]) / d, (m[0] * m[8] - m[2] * m[6]) / d, (m[2] * m[3] - m[0] * m[5]) / d,
    (m[3] * m[7] - m[4] * m[6]) / d, (m[1] * m[6] - m[0] * m[7]) / d, (m[0] * m[4] - m[1] * m[3]) / d,
  ];
}

/** 旋转矩阵（按行）→ 四元数 */
function quatOf(m: ArrayLike<number>): Quat {
  const trace = m[0] + m[4] + m[8];
  let q: Quat;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s, s / 4];
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    q = [s / 4, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s];
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    q = [(m[1] + m[3]) / s, s / 4, (m[5] + m[7]) / s, (m[2] - m[6]) / s];
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    q = [(m[2] + m[6]) / s, (m[5] + m[7]) / s, s / 4, (m[3] - m[1]) / s];
  }
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/**
 * 一批点从 from 搬到了 to（转了方向、等比放大缩小、挪了位置）：找出那个 3×3（按行）。
 * points：每一项是「from 里第几个点、to 里第几个点」所在的数组和下标。点太少、都在一个平面上算不出来时返回 null。
 */
export function fitFrame(from: Float32Array, to: readonly { positions: Float32Array; vertex: Int32Array }[]): { frame: Mat3; turn: Mat3; quat: Quat } | null {
  let n = 0;
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  for (const { positions, vertex } of to) {
    for (let v = 0; v < vertex.length; v++) {
      const f = vertex[v];
      if (f < 0) continue;
      for (let k = 0; k < 3; k++) {
        a[k] += from[f * 3 + k];
        b[k] += positions[v * 3 + k];
      }
      n++;
    }
  }
  if (n < 4) return null;
  for (let k = 0; k < 3; k++) {
    a[k] /= n;
    b[k] /= n;
  }
  // 最小二乘：frame = Σ (q − q̄)(p − p̄)ᵀ · (Σ (p − p̄)(p − p̄)ᵀ)⁻¹
  const pp = new Float64Array(9);
  const qp = new Float64Array(9);
  for (const { positions, vertex } of to) {
    for (let v = 0; v < vertex.length; v++) {
      const f = vertex[v];
      if (f < 0) continue;
      for (let r = 0; r < 3; r++) {
        const p = from[f * 3 + r] - a[r];
        const q = positions[v * 3 + r] - b[r];
        for (let c = 0; c < 3; c++) {
          const pc = from[f * 3 + c] - a[c];
          pp[r * 3 + c] += p * pc;
          qp[r * 3 + c] += q * pc;
        }
      }
    }
  }
  const inv = inverse3(pp);
  if (!inv) return null;
  const frame = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) frame[r * 3 + c] += qp[r * 3 + k] * inv[k * 3 + c];
  const size = Math.cbrt(Math.abs(det3(frame)));
  if (!(size > 1e-9)) return null;
  const turn = frame.map((v) => v / size);
  return { frame: frame as Mat3, turn: turn as Mat3, quat: quatOf(turn) };
}

/* ---------------- 表情 ---------------- */

/** 这个角色认得的表情名字（文件里定好的那几种） */
export const expressionKeys = (morphs: FaceMorphs | undefined): string[] => morphs?.expressions.map((e) => e.key) ?? [];

/** 这个名字（表情或者变形）这个角色有没有 */
export const hasExpression = (morphs: FaceMorphs | undefined, key: string): boolean =>
  Boolean(morphs && (morphs.expressions.some((e) => e.key === key) || morphs.names.includes(key)));

/** 一张脸的表情 → 每个变形开到多少（没开的不在里面） */
export function morphAmounts(morphs: FaceMorphs, face: FaceWeights): Map<number, number> {
  const out = new Map<number, number>();
  for (const [key, weight] of Object.entries(face)) {
    if (!(weight > 0)) continue;
    const expression = morphs.expressions.find((e) => e.key === key);
    if (expression) {
      for (const bind of expression.binds) out.set(bind.morph, (out.get(bind.morph) ?? 0) + bind.weight * weight);
      continue;
    }
    const morph = morphs.names.indexOf(key);
    if (morph >= 0) out.set(morph, (out.get(morph) ?? 0) + weight);
  }
  // 同一个变形被几种表情一起开：最多开到头
  for (const [morph, amount] of out) if (amount > 1) out.set(morph, 1);
  return out;
}

/**
 * 把表情加到一块网格（静止姿势）的顶点和法线上，直接改传进来的数组。faces：脸的名字 → 表情。
 * 这块网格上没有脸、或者没有哪张脸带表情，就什么都不动，返回 false。法线改过以后不是单位长度，用之前要归一。
 */
export function applyFaces(
  build: { faces: readonly FaceInstance[]; morphs?: FaceMorphs },
  chunk: Pick<Chunk, 'faceVertex' | 'faceOf'>,
  faces: Readonly<Record<string, FaceWeights>> | undefined,
  positions: Float32Array,
  normals: Float32Array,
): boolean {
  const { morphs } = build;
  const { faceVertex, faceOf } = chunk;
  if (!morphs || !faces || !faceVertex || !faceOf) return false;
  // 每张脸：开着的变形和各自开到多少
  const active = build.faces.map((instance) => {
    const face = faces[instance.key];
    return face ? [...morphAmounts(morphs, face)] : [];
  });
  if (active.every((list) => list.length === 0)) return false;
  for (let v = 0; v < faceVertex.length; v++) {
    const f = faceVertex[v];
    if (f < 0) continue;
    const instance = build.faces[faceOf[v]];
    const list = active[faceOf[v]];
    if (!instance || !list.length) continue;
    const d: V3 = [0, 0, 0];
    const n: V3 = [0, 0, 0];
    for (const [morph, amount] of list) {
      const p = morphs.positions[morph];
      const q = morphs.normals[morph];
      for (let k = 0; k < 3; k++) {
        d[k] += p[f * 3 + k] * amount;
        n[k] += q[f * 3 + k] * amount;
      }
    }
    const moved = mat3Apply(instance.frame, d);
    const turned = mat3Apply(instance.turn, n);
    for (let k = 0; k < 3; k++) {
      positions[v * 3 + k] += moved[k];
      normals[v * 3 + k] += turned[k];
    }
  }
  return true;
}

/** 整理读进来的表情数据：不是数字的、不在 0–1 之间的收拾好，等于没有的不留。什么都没有就是 undefined */
export function cleanFaces(input: unknown): Record<string, FaceWeights> | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const out: Record<string, FaceWeights> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || key.length > 40) continue;
    const face: FaceWeights = {};
    for (const [name, value] of Object.entries(raw)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || name.length > 60) continue;
      const weight = Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
      if (weight > 0) face[name] = weight;
    }
    if (Object.keys(face).length) out[key] = face;
  }
  return Object.keys(out).length ? out : undefined;
}

/** 表情左右照镜子：blink_l ↔ blink_r、EYE_Close_L ↔ EYE_Close_R */
export function flipFaces(faces: Readonly<Record<string, FaceWeights>>): Record<string, FaceWeights> {
  const twin = (name: string) => name.replace(/_([lrLR])$/, (_, s: string) => `_${{ l: 'r', r: 'l', L: 'R', R: 'L' }[s]}`);
  return Object.fromEntries(Object.entries(faces).map(([key, face]) => [key, Object.fromEntries(Object.entries(face).map(([name, w]) => [twin(name), w]))]));
}

/* ---------------- 视线 ---------------- */

const DEG = Math.PI / 180;
const about = (axis: V3, degrees: number): Quat => {
  const half = (degrees * DEG) / 2;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 视线：往角色自己的左边看是正（-1 – 1），往上看是正（-1 – 1） */
export type Gaze = [side: number, up: number];

/**
 * 视线 → 两只眼睛的骨骼各转多少（[左眼, 右眼]，相对它们的父骨骼，按这副骨架静止时的轴）。
 * 眼珠往外能转的比往里多，所以两只眼睛转的角度不一样。instance：这是哪张脸（它静止时头可能是歪着的）。
 */
export function gazeTurns(gaze: Gaze, look: FaceMorphs['look'], instance: Pick<FaceInstance, 'quat'>): [Quat, Quat] {
  const side = clamp(gaze[0], -1, 1);
  const up = clamp(gaze[1], -1, 1);
  const pitch = up * (up > 0 ? look.up : look.down);
  return [1, -1].map((eye) => {
    // 左眼往左、右眼往右是「往外」
    const yaw = side * (side * eye > 0 ? look.outer : look.inner);
    // 脸朝 +Z：绕 Y 转是往左看，绕 -X 转是往上看
    const local = quatMul(about([0, 1, 0], yaw), about([-1, 0, 0], pitch));
    return quatMul(quatMul(instance.quat, local), quatConj(instance.quat));
  }) as [Quat, Quat];
}

/** gazeTurns 反过来：左眼的骨骼转了这么多，视线在哪 */
export function gazeOf(leftEye: Quat, look: FaceMorphs['look'], instance: Pick<FaceInstance, 'quat'>): Gaze {
  const local = quatMul(quatMul(quatConj(instance.quat), leftEye), instance.quat);
  const forward = rotate(local, [0, 0, 1]);
  const yaw = Math.atan2(forward[0], forward[2]) / DEG;
  const pitch = Math.asin(clamp(forward[1], -1, 1)) / DEG;
  const round = (v: number) => Math.round(clamp(v, -1, 1) * 1000) / 1000 + 0;
  return [round(yaw / (yaw > 0 ? look.outer : look.inner)), round(pitch / (pitch > 0 ? look.up : look.down))];
}

/** 眼睛转到头才看得到的偏角（度）：目标偏出这么多，眼珠就转到头了 */
const LOOK_REACH = { side: 50, up: 35 };

/**
 * 看向一个点。eye：两眼中间现在在哪；facing：这张脸现在朝哪（头的骨骼现在的朝向 ∘ 这张脸静止时的朝向）；target：要看的点。
 * 目标在脑后的时候眼睛看不过去，就转到头。
 */
export function gazeAt(eye: V3, facing: Quat, target: V3): Gaze {
  const d = rotate(quatConj(facing), [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const flat = Math.hypot(d[0], d[2]);
  if (flat < 1e-9 && Math.abs(d[1]) < 1e-9) return [0, 0];
  const yaw = Math.atan2(d[0], d[2]) / DEG;
  const pitch = Math.atan2(d[1], flat) / DEG;
  const round = (v: number) => Math.round(clamp(v, -1, 1) * 100) / 100 + 0;
  return [round(yaw / LOOK_REACH.side), round(pitch / LOOK_REACH.up)];
}
