/**
 * 把现成的网格（手）缝到融合出来的身体上。
 *
 * 融合网格是按体素重新生成表面的：手指比体素还细、指缝更窄，过一遍体素就粘成一团，一弯就拉出尖刺。
 * 所以手不进距离场（手臂的距离场只做到手腕外面一点），这里把模型上现成的手直接接上去：
 * 1. 在手的切口往手肘那边一点的地方横着切一刀，身体上切口以外的面都去掉，剩下一圈开口；
 * 2. 把开口那一圈照手的切口的形状收一收（往手肘那边逐渐过渡回原样），两边粗细就对上了；
 * 3. 两圈之间用一圈三角面缝起来。
 * 缝完还是一整块封闭的网格。手上的顶点带着模型自己的蒙皮权重（FusedMesh.bound）。
 *
 * 缝不上的时候（比如手动把手腕挪进了别的部件里，那里没有一圈干净的开口）：手照样放上去，
 * 自己封好口，和身体叠在一起但不相连——网格就不止一块了（info.components 会多出来）。
 *
 * 纯函数，在 Web Worker 和单元测试里都能跑。
 */
import { graftMeshOf } from '../anime/grafts';
import { skinVerticesDualInPlace } from '../character/pose';
import { type Graft, type Part, graftFrame, worldTransforms } from '../geometry/figure';
import { type Mat3, type V3, mat3Mul, quatMat3 } from '../geometry/vec';
import { buildSkeleton } from '../rig/skeleton';
import type { PoseMatrices } from './posedField';
import type { FusedMesh } from './surfaceNets';

const TAU = Math.PI * 2;
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 余子式矩阵：法线要乘的是它（差一个行列式的倍数，反正还要归一） */
const cofactor = (m: Mat3): Mat3 => [
  m[4] * m[8] - m[5] * m[7],
  m[5] * m[6] - m[3] * m[8],
  m[3] * m[7] - m[4] * m[6],
  m[2] * m[7] - m[1] * m[8],
  m[0] * m[8] - m[2] * m[6],
  m[1] * m[6] - m[0] * m[7],
  m[1] * m[5] - m[2] * m[4],
  m[2] * m[3] - m[0] * m[5],
  m[0] * m[4] - m[1] * m[3],
];
const det = (m: Mat3) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);

/** 一块要接的网格，已经算好它在世界里怎么摆 */
interface Job {
  /** 这只手接在哪个部件上 */
  part: string;
  graft: Graft;
  /** 网格自己坐标里的点 p 在世界里是 linear · p + origin */
  linear: Mat3;
  origin: V3;
  /** 摆好姿势以后每个顶点在哪、朝哪（没摆就没有：照 linear、origin 摆） */
  placed?: { positions: Float32Array; normals: Float32Array };
}

function jobsOf(parts: Part[]): Job[] {
  if (!parts.some((part) => part.grafts?.length)) return [];
  const xfs = worldTransforms({ parts, scale: 1 });
  const jobs: Job[] = [];
  for (const part of parts) {
    if (!part.grafts?.length) continue;
    const xf = xfs.get(part.name)!;
    // 世界 = 位置 + 缩放 · 旋转 · (matrix · p + offset)；部件的拉伸不照搬到手上（见 graftFrame）
    const outer = quatMat3(xf.quat).map((v) => v * xf.scale) as Mat3;
    for (const graft of part.grafts) {
      const frame = graftFrame(part, graft);
      const o = frame.offset;
      jobs.push({
        part: part.name,
        graft,
        linear: mat3Mul(outer, frame.matrix),
        origin: [
          xf.pos[0] + outer[0] * o[0] + outer[1] * o[1] + outer[2] * o[2],
          xf.pos[1] + outer[3] * o[0] + outer[4] * o[1] + outer[5] * o[2],
          xf.pos[2] + outer[6] * o[0] + outer[7] * o[1] + outer[8] * o[2],
        ],
      });
    }
  }
  return jobs;
}

/** 接上去的现成网格（手、脚）的顶点都在哪（Figure.scale 当作 1）：每一块的顶点接着排，顺序同部件、Part.grafts */
export function graftPoints(parts: Part[]): Float32Array {
  const jobs = jobsOf(parts);
  const counts = jobs.map((job) => graftMeshOf(job.graft.mesh).positions.length / 3);
  const out = new Float32Array(counts.reduce((sum, n) => sum + n, 0) * 3);
  let first = 0;
  jobs.forEach(({ graft, linear, origin }, j) => {
    const mesh = graftMeshOf(graft.mesh);
    for (let i = 0; i < counts[j]; i++) {
      const x = mesh.positions[i * 3];
      const y = mesh.positions[i * 3 + 1];
      const z = mesh.positions[i * 3 + 2];
      out[(first + i) * 3] = origin[0] + linear[0] * x + linear[1] * y + linear[2] * z;
      out[(first + i) * 3 + 1] = origin[1] + linear[3] * x + linear[4] * y + linear[5] * z;
      out[(first + i) * 3 + 2] = origin[2] + linear[6] * x + linear[7] * y + linear[8] * z;
    }
    first += counts[j];
  });
  return out;
}

/**
 * 一圈点绕轴的轮廓：问某个角度上离轴多远。
 * 不是在相邻两个点之间拉直线（那样每个点上都有一个折角，照它收身体会收出一道道竖棱），
 * 而是拿这圈点配出一条光滑的曲线：平均半径加上头几阶的起伏（椭圆、偏心、略方都够用了）。
 */
function profile(angles: number[], radii: number[]) {
  const order = angles.map((_, i) => i).sort((p, q) => angles[p] - angles[q]);
  const n = order.length;
  const waves = Math.max(0, Math.min(4, Math.floor((n - 1) / 2)));
  let mean = 0;
  const cos = new Array<number>(waves).fill(0);
  const sin = new Array<number>(waves).fill(0);
  for (let i = 0; i < n; i++) {
    const a = angles[order[i]];
    // 这个点管着它到左右两个邻居各一半的那一段角度
    let span = angles[order[(i + 1) % n]] - angles[order[(i + n - 1) % n]];
    if (span <= 0) span += TAU;
    const share = (radii[order[i]] * span) / 2;
    mean += share / TAU;
    for (let k = 0; k < waves; k++) {
      cos[k] += (share * Math.cos((k + 1) * a)) / Math.PI;
      sin[k] += (share * Math.sin((k + 1) * a)) / Math.PI;
    }
  }
  return (angle: number): number => {
    let r = mean;
    for (let k = 0; k < waves; k++) r += cos[k] * Math.cos((k + 1) * angle) + sin[k] * Math.sin((k + 1) * angle);
    return Math.max(r, mean * 0.3);
  };
}

/** 顺着一圈走，角度一共转了多少（正的是逆时针，差不多是 ±2π） */
function winding(angles: number[]) {
  let total = 0;
  for (let i = 0; i < angles.length; i++) {
    let step = angles[(i + 1) % angles.length] - angles[i];
    if (step > Math.PI) step -= TAU;
    else if (step < -Math.PI) step += TAU;
    total += step;
  }
  return total;
}

/**
 * 摆好姿势以后的手。缝的时候手是整个跟着前臂搬过去的（linear、origin）：切口那一圈相对前臂和静止时一模一样，
 * 静止时缝得上的，摆成什么样都缝得上。缝完再把每个顶点换到照手自带的权重摆出来的位置（placed；
 * 和屏幕上拖着摆的时候一个算法）：手腕弯了、手指握起来了，缝的那一圈面跟着稍微拉开一点
 */
function poseJobs(jobs: Job[], parts: Part[], pose: PoseMatrices): Job[] {
  const index = new Map(buildSkeleton({ parts, scale: 1 }).bones.map((bone, i) => [bone.name, i]));
  const matrices = Float64Array.from(pose);
  return jobs.map((job) => {
    const { linear, origin, graft } = job;
    const hand = graftMeshOf(graft.mesh);
    const count = hand.positions.length / 3;
    const bones = hand.bones.map((name) => index.get(graft.bones[name] ?? '') ?? -1);
    if (bones.some((b) => b < 0)) return job;
    const normalMatrix = cofactor(linear);
    const sign = det(linear) < 0 ? -1 : 1;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      for (let row = 0; row < 3; row++) {
        positions[i * 3 + row] = origin[row] + linear[row * 3] * hand.positions[i * 3] + linear[row * 3 + 1] * hand.positions[i * 3 + 1] + linear[row * 3 + 2] * hand.positions[i * 3 + 2];
        normals[i * 3 + row] = sign * (normalMatrix[row * 3] * hand.normals[i * 3] + normalMatrix[row * 3 + 1] * hand.normals[i * 3 + 1] + normalMatrix[row * 3 + 2] * hand.normals[i * 3 + 2]);
      }
    }
    skinVerticesDualInPlace(positions, normals, Uint16Array.from(hand.joints, (j) => bones[j]), hand.weights, matrices);
    // 整块跟着前臂（小腿）搬：它是网格里唯一不跟着这块网格保持原样的骨骼
    const root = Object.values(graft.bones).find((name) => !graft.rigid.includes(name));
    const fore = (index.get(root ?? '') ?? bones[0]) * 12;
    const turn: Mat3 = [matrices[fore], matrices[fore + 1], matrices[fore + 2], matrices[fore + 3], matrices[fore + 4], matrices[fore + 5], matrices[fore + 6], matrices[fore + 7], matrices[fore + 8]];
    const moved: V3 = [
      turn[0] * origin[0] + turn[1] * origin[1] + turn[2] * origin[2] + matrices[fore + 9],
      turn[3] * origin[0] + turn[4] * origin[1] + turn[5] * origin[2] + matrices[fore + 10],
      turn[6] * origin[0] + turn[7] * origin[1] + turn[8] * origin[2] + matrices[fore + 11],
    ];
    return { ...job, linear: mat3Mul(turn, linear), origin: moved, placed: { positions, normals } };
  });
}

/** 缝合时切面在手的切口往手肘那边多远的地方：两圈之间要留出缝合的那一圈面的位置 */
/** 收开口时，离轴比开口远出这么多（几成）以内的跟着收，到后一个数完全不动 */
const REACH_KEEP = [0.2, 0.6] as const;
const cutGap = (voxel: number, stretch: number) => Math.min(Math.max(0.6 * voxel, 0.003 * stretch), 0.02 * stretch);

/**
 * 一只手的手腕那一段：从 a 起、沿 axis（单位向量）长 length、半径 radius 的一段圆柱，前臂的断口就在里面。
 * part 是这只手接在哪个部件上
 */
export interface WristRoom {
  part: string;
  a: V3;
  axis: V3;
  length: number;
  radius: number;
}

/**
 * 摆好姿势以后，每只手的手腕在哪一段（顺序同缝的时候：第 i 个就是第 i 只手）。
 * 缝手要在前臂的断口上找一圈干净的开口；手腕插进了大腿、别的手臂里，断口和它们融成一片，就找不到了——
 * 这一段里前臂周围得空着（见 fuse.ts、field.ts 的 Clearance）。从切面往手肘那边两个半体素起，到断口外面止
 */
export function wristRooms(parts: Part[], pose: PoseMatrices, voxel: number): WristRoom[] {
  const jobs = poseJobs(jobsOf(parts), parts, pose);
  return jobs.map(({ part, graft, linear, origin }) => {
    const hand = graftMeshOf(graft.mesh);
    const fore: V3 = [hand.end[0] - hand.root[0], hand.end[1] - hand.root[1], hand.end[2] - hand.root[2]];
    const at = (v: number): V3 => {
      const x = hand.positions[v * 3];
      const y = hand.positions[v * 3 + 1];
      const z = hand.positions[v * 3 + 2];
      return [origin[0] + linear[0] * x + linear[1] * y + linear[2] * z, origin[1] + linear[3] * x + linear[4] * y + linear[5] * z, origin[2] + linear[6] * x + linear[7] * y + linear[8] * z];
    };
    const axis: V3 = [linear[0] * fore[0] + linear[1] * fore[1] + linear[2] * fore[2], linear[3] * fore[0] + linear[4] * fore[1] + linear[5] * fore[2], linear[6] * fore[0] + linear[7] * fore[1] + linear[8] * fore[2]];
    const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    const stretch = length / Math.hypot(fore[0], fore[1], fore[2]);
    for (let k = 0; k < 3; k++) axis[k] /= length;
    const rim = hand.loop.map(at);
    const center: V3 = [0, 0, 0];
    for (const p of rim) for (let k = 0; k < 3; k++) center[k] += p[k] / rim.length;
    let from = Infinity;
    let wide = 0;
    for (const p of rim) {
      const x = p[0] - center[0];
      const y = p[1] - center[1];
      const z = p[2] - center[2];
      const t = x * axis[0] + y * axis[1] + z * axis[2];
      from = Math.min(from, t);
      wide = Math.max(wide, Math.sqrt(Math.max(x * x + y * y + z * z - t * t, 0)));
    }
    const t0 = from - cutGap(voxel, stretch) - 2.5 * voxel;
    const t1 = from + 0.1 * stretch;
    return {
      part,
      a: [center[0] + axis[0] * t0, center[1] + axis[1] * t0, center[2] + axis[2] * t0],
      axis,
      length: t1 - t0,
      // 断口那一截连着大鱼际，比手的切口宽不少
      radius: wide * 3 + 3 * voxel,
    };
  });
}

/**
 * pose：摆好姿势以后的（每根骨骼的蒙皮矩阵，见 posedField.ts）；身体的网格已经是照这个姿势融合的。
 * report：哪几只手没缝上（第几只，顺序同 wristRooms），记在这里面
 */
export function graftMeshes(mesh: FusedMesh, parts: Part[], voxel: number, pose?: PoseMatrices, report?: { loose: number[] }): FusedMesh {
  const rest = jobsOf(parts);
  if (!rest.length) return mesh;
  const jobs = pose ? poseJobs(rest, parts, pose) : rest;
  const t0 = now();
  const meshes = jobs.map((job) => graftMeshOf(job.graft.mesh));
  const body = mesh.positions.length / 3;
  // 每只手多留一个顶点：缝不上时给切口封盖用。接过渡管子的那几圈顶点到时候再加（见 grow）
  const extra = meshes.reduce((sum, m) => sum + m.positions.length / 3 + 1, 0);
  let room = body + extra;
  let pos = new Float32Array(room * 3);
  let nor = new Float32Array(room * 3);
  pos.set(mesh.positions);
  nor.set(mesh.normals);
  const quads = mesh.quads;
  const quadCount = quads.length / 4;
  const alive = new Uint8Array(quadCount).fill(1);
  const tris: number[] = [];
  /** 身体上挪过的顶点：法线要重新算 */
  const moved = new Uint8Array(body);
  /** 这一只手附近的顶点：1 在附近，2 在切面以外 */
  const mark = new Uint8Array(body);
  const along = new Float32Array(body);
  const boneIndex = new Map<string, number>();
  let boundJoints = new Uint16Array(extra * 4);
  let boundWeights = new Float32Array(extra * 4);
  let total = body;
  /** 再加 count 个顶点（过渡管子上的）的地方 */
  const grow = (count: number) => {
    if (total + count <= room) return;
    room = total + count;
    const more = (old: Float32Array) => {
      const out = new Float32Array(room * 3);
      out.set(old);
      return out;
    };
    pos = more(pos);
    nor = more(nor);
    const joints = new Uint16Array((room - body) * 4);
    joints.set(boundJoints);
    boundJoints = joints;
    const weights = new Float32Array((room - body) * 4);
    weights.set(boundWeights);
    boundWeights = weights;
  };

  /** 一只摆好了的手：切口的轴、切口那一圈，和切的时候要用的几个尺寸 */
  interface Hand {
    index: number;
    rim: number[];
    rimPolar: { t: number; radius: number; angle: number }[];
    /** 一个点沿轴走了多远、离轴多远、绕轴的角度 */
    polar: (v: number) => { t: number; radius: number; angle: number };
    /** 切口那一圈的中心、沿前臂的轴（单位向量） */
    center: V3;
    axis: V3;
    rimFrom: number;
    rimWide: number;
    rimThin: number;
    /** 手跟着前臂拉长了几倍 */
    stretch: number;
    gap: number;
    ease: number;
    reach: number;
    far: number;
    turnRim: number;
  }
  const hands: Hand[] = [];
  /** 摆过姿势的手：缝完以后要换成摆好的位置（从第几个顶点开始、换成什么） */
  const posed: { base: number; placed: NonNullable<Job['placed']> }[] = [];
  jobs.forEach(({ graft, linear, origin, placed }, index) => {
    const hand = meshes[index];
    const handCount = hand.positions.length / 3;
    const base = total;
    if (placed) posed.push({ base, placed });
    const flipped = det(linear) < 0;
    const normalMatrix = cofactor(linear);
    const sign = flipped ? -1 : 1;
    for (let i = 0; i < handCount; i++) {
      const x = hand.positions[i * 3];
      const y = hand.positions[i * 3 + 1];
      const z = hand.positions[i * 3 + 2];
      pos[(base + i) * 3] = origin[0] + linear[0] * x + linear[1] * y + linear[2] * z;
      pos[(base + i) * 3 + 1] = origin[1] + linear[3] * x + linear[4] * y + linear[5] * z;
      pos[(base + i) * 3 + 2] = origin[2] + linear[6] * x + linear[7] * y + linear[8] * z;
      const nx = hand.normals[i * 3];
      const ny = hand.normals[i * 3 + 1];
      const nz = hand.normals[i * 3 + 2];
      const mx = (normalMatrix[0] * nx + normalMatrix[1] * ny + normalMatrix[2] * nz) * sign;
      const my = (normalMatrix[3] * nx + normalMatrix[4] * ny + normalMatrix[5] * nz) * sign;
      const mz = (normalMatrix[6] * nx + normalMatrix[7] * ny + normalMatrix[8] * nz) * sign;
      const l = Math.hypot(mx, my, mz) || 1;
      nor[(base + i) * 3] = mx / l;
      nor[(base + i) * 3 + 1] = my / l;
      nor[(base + i) * 3 + 2] = mz / l;
      for (let k = 0; k < 4; k++) {
        const weight = hand.weights[i * 4 + k];
        const name = graft.bones[hand.bones[hand.joints[i * 4 + k]]] ?? '';
        let bone = boneIndex.get(name);
        if (bone === undefined) boneIndex.set(name, (bone = boneIndex.size));
        boundJoints[(base - body + i) * 4 + k] = bone;
        boundWeights[(base - body + i) * 4 + k] = weight;
      }
    }
    total += handCount;
    // 镜像过的面要反过来才朝外，切口那一圈的走向也跟着反过来
    for (let t = 0; t < hand.triangles.length; t += 3) {
      const a = base + hand.triangles[t];
      const b = base + hand.triangles[t + 1];
      const c = base + hand.triangles[t + 2];
      if (flipped) tris.push(a, c, b);
      else tris.push(a, b, c);
    }
    const rim = (flipped ? [...hand.loop].reverse() : hand.loop).map((v) => base + v);

    /* ---- 手的切口：沿前臂的轴、绕轴的一圈 ---- */
    const fore: V3 = [hand.end[0] - hand.root[0], hand.end[1] - hand.root[1], hand.end[2] - hand.root[2]];
    let ax = linear[0] * fore[0] + linear[1] * fore[1] + linear[2] * fore[2];
    let ay = linear[3] * fore[0] + linear[4] * fore[1] + linear[5] * fore[2];
    let az = linear[6] * fore[0] + linear[7] * fore[1] + linear[8] * fore[2];
    const stretch = Math.hypot(ax, ay, az) / Math.hypot(fore[0], fore[1], fore[2]);
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al;
    ay /= al;
    az /= al;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const v of rim) {
      cx += pos[v * 3] / rim.length;
      cy += pos[v * 3 + 1] / rim.length;
      cz += pos[v * 3 + 2] / rim.length;
    }
    // 垂直于轴的两个方向 u、w，u × w 就是轴
    let ux = Math.abs(ay) < 0.9 ? -az : 0;
    let uy = Math.abs(ay) < 0.9 ? 0 : az;
    let uz = Math.abs(ay) < 0.9 ? ax : -ay;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const wx = ay * uz - az * uy;
    const wy = az * ux - ax * uz;
    const wz = ax * uy - ay * ux;
    const polar = (v: number) => {
      const x = pos[v * 3] - cx;
      const y = pos[v * 3 + 1] - cy;
      const z = pos[v * 3 + 2] - cz;
      const t = x * ax + y * ay + z * az;
      const p = x * ux + y * uy + z * uz;
      const q = x * wx + y * wy + z * wz;
      return { t, radius: Math.hypot(p, q), angle: Math.atan2(q, p) };
    };
    const rimPolar = rim.map(polar);
    const rimFrom = Math.min(...rimPolar.map((p) => p.t));
    const rimWide = Math.max(...rimPolar.map((p) => p.radius));
    hands.push({
      index,
      rim,
      rimPolar,
      polar,
      center: [cx, cy, cz],
      axis: [ax, ay, az],
      rimFrom,
      rimWide,
      rimThin: Math.min(...rimPolar.map((p) => p.radius)),
      stretch,
      // 切面在手的切口往手肘那边 gap 的地方：两圈之间要留出缝合的那一圈面的位置
      gap: cutGap(voxel, stretch),
      // 往手肘那边这么长的一段跟着过渡
      ease: Math.max(0.03 * stretch, 2.5 * voxel),
      reach: rimWide * 2 + 1.5 * voxel,
      far: rimFrom + 0.1 * stretch + 2 * voxel,
      turnRim: winding(rimPolar.map((p) => p.angle)),
    });
  });

  /** 隔梁上新加的点（法线要照周围的面重新算） */
  const bridged: number[] = [];
  /**
   * 两只手腕长在一起、切开以后只剩一圈开口（两截前臂的横截面连成一团）：在两条前臂正中间横着加一道隔梁，
   * 把这一圈分成两圈，各接各的手（像一条裤腰分出两条裤腿）。隔梁上的点是新加的，两圈各走一遍、方向相反。
   * 返回两圈（顺序同 group）；这一圈和两条前臂正中间那个面交不出正好两处的，返回 null
   */
  const split = (loop: number[], group: Hand[]): number[][] | null => {
    const [a, b] = group;
    // 正中间那个面：过两只手切口中心的中点，垂直于两个中心的连线（去掉沿前臂的那一份）
    const axis = [0, 1, 2].map((k) => a.axis[k] + b.axis[k]);
    const al = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    const along = (v: number[]) => (v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2]) / al;
    const d = [0, 1, 2].map((k) => b.center[k] - a.center[k]);
    const da = along(d);
    const n = [0, 1, 2].map((k) => d[k] - (axis[k] / al) * da);
    const nl = Math.hypot(n[0], n[1], n[2]);
    if (nl < 1e-6) return null;
    const mid = [0, 1, 2].map((k) => (a.center[k] + b.center[k]) / 2);
    const side = (v: number) => ((pos[v * 3] - mid[0]) * n[0] + (pos[v * 3 + 1] - mid[1]) * n[1] + (pos[v * 3 + 2] - mid[2]) * n[2]) / nl;
    const m = loop.length;
    const sides = loop.map(side);
    // 圈上过这个面的两处：各取离面近的那个点
    const cross: number[] = [];
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      if (sides[i] < 0 !== sides[j] < 0) cross.push(Math.abs(sides[i]) <= Math.abs(sides[j]) ? i : j);
    }
    if (cross.length !== 2 || cross[0] === cross[1]) return null;
    const [p, q] = cross;
    const arc = (from: number, to: number) => {
      const out: number[] = [];
      for (let i = from; ; i = (i + 1) % m) {
        out.push(loop[i]);
        if (i === to) return out;
      }
    };
    const one = arc(p, q);
    const two = arc(q, p);
    if (one.length < 3 || two.length < 3) return null;
    // 隔梁：从 q 点到 p 点一条直线，大约一个体素一个点
    const pv = loop[p];
    const qv = loop[q];
    const span = Math.hypot(pos[pv * 3] - pos[qv * 3], pos[pv * 3 + 1] - pos[qv * 3 + 1], pos[pv * 3 + 2] - pos[qv * 3 + 2]);
    const count = Math.max(0, Math.round(span / voxel) - 1);
    grow(count);
    const beam: number[] = [];
    for (let i = 1; i <= count; i++) {
      const s = i / (count + 1);
      const v = total++;
      for (let k = 0; k < 3; k++) pos[v * 3 + k] = pos[qv * 3 + k] + (pos[pv * 3 + k] - pos[qv * 3 + k]) * s;
      for (let k = 0; k < 4; k++) {
        boundJoints[(v - body) * 4 + k] = boundJoints[(a.rim[0] - body) * 4 + k];
        boundWeights[(v - body) * 4 + k] = boundWeights[(a.rim[0] - body) * 4 + k];
      }
      beam.push(v);
    }
    // 第一段从 p 走到 q，接着顺着隔梁从 q 回到 p；第二段从 q 走到 p，再顺着隔梁倒着回到 q
    const first = [...one, ...beam];
    const second = [...two, ...beam.slice().reverse()];
    // 哪一圈归哪只手：a 在面的负的那一边
    const oneSide = one.reduce((sum, v) => sum + side(v), 0);
    return oneSide < 0 ? [first, second] : [second, first];
  };

  /**
   * 试着在这几只手的手腕上切开：每只手的切面在它的切口往手肘那边 gap + back 的地方，切面以外、连着手腕轴心的面都去掉。
   * 去掉以后剩下的开口要正好是每只手一圈、绕着它的手腕。几只手腕长在一起的（垂着贴在一起、两只手握在一起），
   * 长在一起的那一团一起去掉，剩下各自的一圈。成了返回要去掉的面、每只手的那一圈（顺序同 group）；不成返回 null。
   * 只切一只手、back 是 0 的就是平常的切法：成了的话 mark、along、near、kept 留着，后面照手的切口收开口要用
   */
  const attempt = (group: Hand[], back: number) => {
    const cutAt = group.map((h) => h.rimFrom - h.gap - back);
    /** 第 g 只手看，顶点 v 沿轴多远、离轴多远（平方）；不在这只手附近的是 null */
    const local = (g: number, v: number) => {
      const h = group[g];
      const x = pos[v * 3] - h.center[0];
      const y = pos[v * 3 + 1] - h.center[1];
      const z = pos[v * 3 + 2] - h.center[2];
      const t = x * h.axis[0] + y * h.axis[1] + z * h.axis[2];
      if (t < cutAt[g] - h.ease - 3 * voxel || t > h.far) return null;
      const radius2 = x * x + y * y + z * z - t * t;
      return radius2 > h.reach * h.reach ? null : { t, radius2 };
    };

    /* ---- 1. 身体上切面以外的面去掉，找出剩下的开口 ---- */
    const near: number[] = [];
    for (let v = 0; v < body; v++) {
      for (let g = 0; g < group.length; g++) {
        const here = local(g, v);
        if (!here) continue;
        if (!mark[v]) near.push(v);
        mark[v] = Math.max(mark[v], here.t > cutAt[g] ? 2 : 1);
        along[v] = here.t;
      }
    }
    const fail = () => {
      for (const v of near) mark[v] = 0;
      return null;
    };
    let gone: number[] = [];
    const kept: number[] = [];
    for (let q = 0; q < quadCount; q++) {
      if (!alive[q]) continue;
      const m = mark[quads[q * 4]] | mark[quads[q * 4 + 1]] | mark[quads[q * 4 + 2]] | mark[quads[q * 4 + 3]];
      if (m & 2) gone.push(q);
      else if (m) kept.push(q);
    }
    // 切面以外的面可能不止手臂自己的那一截（手垂在大腿边上时，大腿也有一片落在这个范围里）：
    // 只去掉连着轴心的那一块（手臂的断口正对着轴），别的留着
    const groupOf = new Map<number, number>();
    const find = (v: number): number => {
      let root = v;
      while (groupOf.get(root) !== root) root = groupOf.get(root)!;
      groupOf.set(v, root);
      return root;
    };
    for (const q of gone) {
      for (let k = 0; k < 4; k++) if (!groupOf.has(quads[q * 4 + k])) groupOf.set(quads[q * 4 + k], quads[q * 4 + k]);
      for (let k = 1; k < 4; k++) groupOf.set(find(quads[q * 4 + k]), find(quads[q * 4]));
    }
    // 轴心：先在紧挨着切面的那一圈里找离轴最近的（那是前臂的管壁）。只看「离轴最近」不够：
    // 手腕周围被挖空过的话（见 wristRooms），挖出来的那个坑的底也正对着轴
    const cores = new Set<number>();
    for (let g = 0; g < group.length; g++) {
      let core = -1;
      let closest = Infinity;
      let coreAny = -1;
      let closestAny = Infinity;
      for (const v of groupOf.keys()) {
        const here = group.length === 1 ? (mark[v] === 2 ? { t: along[v], radius2: 0 } : null) : local(g, v);
        if (!here || here.t <= cutAt[g]) continue;
        const x = pos[v * 3] - group[g].center[0];
        const y = pos[v * 3 + 1] - group[g].center[1];
        const z = pos[v * 3 + 2] - group[g].center[2];
        const radius2 = x * x + y * y + z * z - here.t * here.t;
        if (radius2 < closestAny) {
          closestAny = radius2;
          coreAny = find(v);
        }
        if (here.t <= cutAt[g] + 2 * voxel && radius2 < closest) {
          closest = radius2;
          core = find(v);
        }
      }
      if (core < 0) core = coreAny;
      if (core < 0) return fail();
      cores.add(core);
    }
    const others = gone.filter((q) => !cores.has(find(quads[q * 4])));
    gone = gone.filter((q) => cores.has(find(quads[q * 4])));
    kept.push(...others);
    const goneEdges = new Set<number>();
    for (const q of gone) for (let k = 0; k < 4; k++) goneEdges.add(quads[q * 4 + k] * body + quads[q * 4 + ((k + 1) & 3)]);
    let open = 0;
    for (const edge of goneEdges) if (!goneEdges.has((edge % body) * body + Math.floor(edge / body))) open++;
    /** 开口上每个顶点的下一个（顺着留下来的面的方向） */
    const next = new Map<number, number>();
    let simple = gone.length > 0;
    for (const q of kept) {
      for (let k = 0; k < 4; k++) {
        const a = quads[q * 4 + k];
        const b = quads[q * 4 + ((k + 1) & 3)];
        if (!goneEdges.has(b * body + a)) continue;
        if (next.has(a)) simple = false;
        next.set(a, b);
      }
    }
    if (!simple || next.size < 4 * group.length || next.size !== open) return fail();
    // 开口一圈一圈地走出来
    const loops: number[][] = [];
    const seen = new Set<number>();
    for (const start of next.keys()) {
      if (seen.has(start)) continue;
      const loop: number[] = [];
      let v = start;
      do {
        loop.push(v);
        seen.add(v);
        v = next.get(v) ?? -1;
      } while (v >= 0 && v !== start && loop.length <= next.size);
      if (v !== start) return fail();
      loops.push(loop);
    }
    // 每一圈归一只手：圈上的点都该在这只手的切面边上、绕着它的手腕（隔梁上新加的点不看离轴多远）。
    // 挪过切口、几只手一起切的，开口和手之间本来就要接一段管子：开口离切面远一点（两只手腕一前一后）也行
    const fits = (g: number, ring: number[]) => {
      const h = group[g];
      const slack = group.length > 1 || back > 0 ? 0.08 * h.stretch : 0;
      if (ring.length < 4) return false;
      for (const v of ring) {
        const here = local(g, v);
        const p = h.polar(v);
        if (!here || here.t > cutAt[g] || p.t < cutAt[g] - 3 * voxel - slack || (v < body && p.radius < h.rimThin * 0.3)) return false;
      }
      // 身体的开口和手的切口是面对面的，顺着各自的面走，绕轴的方向正好相反
      return Math.abs(Math.abs(h.turnRim) - TAU) <= 0.5 && Math.abs(winding(ring.map((v) => h.polar(v).angle)) + h.turnRim) <= 0.5;
    };
    const before = total;
    let rings: number[][] | null = null;
    if (loops.length === group.length) {
      rings = [];
      const used = new Set<number>();
      for (let g = 0; g < group.length && rings; g++) {
        const at = loops.findIndex((loop, i) => !used.has(i) && fits(g, loop));
        if (at < 0) rings = null;
        else {
          used.add(at);
          rings.push(loops[at]);
        }
      }
    } else if (group.length === 2 && loops.length === 1) rings = split(loops[0], group);
    if (!rings || !rings.every((ring, g) => fits(g, ring))) {
      total = before;
      return fail();
    }
    bridged.push(...Array.from({ length: total - before }, (_, i) => before + i));
    return { gone, kept, near, rings };
  };

  /** 两圈之间缝一圈三角面：两边都朝同一个方向绕轴走，谁的下一个点角度小就先走谁。lap 在身体这边，rim 在手这边 */
  const stitch = (lap: number[], rim: number[], angleOf: (v: number) => number) => {
    const lapAngle = lap.map(angleOf);
    const rimAngle = rim.map(angleOf);
    const first = (angles: number[]) => angles.reduce((best, a, i) => (a < angles[best] ? i : best), 0);
    const i0 = first(lapAngle);
    const j0 = first(rimAngle);
    const m = lap.length;
    const n = rim.length;
    let done = 0;
    let sewn = 0;
    while (done < m || sewn < n) {
      const a = lap[(i0 + done) % m];
      const h = rim[(j0 + sewn) % n];
      const nextLap = done < m ? lapAngle[(i0 + done + 1) % m] + (done + 1 === m ? TAU : 0) : Infinity;
      const nextRim = sewn < n ? rimAngle[(j0 + sewn + 1) % n] + (sewn + 1 === n ? TAU : 0) : Infinity;
      if (nextLap <= nextRim) {
        tris.push(a, lap[(i0 + done + 1) % m], h);
        done++;
      } else {
        tris.push(rim[(j0 + sewn + 1) % n], h, a);
        sewn++;
      }
    }
  };
  const angleOn = (h: Hand) => {
    const dir = h.turnRim > 0 ? 1 : -1;
    return (v: number) => {
      const a = h.polar(v).angle * dir;
      return a < 0 ? a + TAU : a;
    };
  };

  /** 切口往手肘那边挪过、或者几只手一起切的：开口和手的切口之间隔着一段，缝完姿势以后用一段管子接上 */
  const tubes: { hand: Hand; ring: number[] }[] = [];
  const pending: Hand[] = [];
  // 挪一步多远：一个半体素，至少一厘米（按标准人台的尺寸）；最多挪到前臂上八厘米的地方
  const backs = (h: Hand) => {
    const step = Math.max(1.5 * voxel, 0.01 * h.stretch);
    const out: number[] = [];
    for (let back = step; back <= 0.08 * h.stretch + 1e-9; back += step) out.push(back);
    return out;
  };
  const sewLater = (group: Hand[], cut: NonNullable<ReturnType<typeof attempt>>) => {
    for (const q of cut.gone) alive[q] = 0;
    for (const v of cut.near) mark[v] = 0;
    group.forEach((h, g) => tubes.push({ hand: h, ring: cut.rings[g] }));
    for (const h of group) if (pending.includes(h)) pending.splice(pending.indexOf(h), 1);
  };
  // 手腕挨得很近的两只（同一边垂在一起的两条手臂、握在一起的两只手）：两截前臂多半长在一起，先缝上的那只会把长在一起的那一团
  // 切走，另一只就找不到前臂了。先试着两只一起切，不成再一只一只来
  const done = new Set<Hand>();
  const close: [number, Hand, Hand][] = [];
  for (let i = 0; i < hands.length; i++) {
    for (let j = i + 1; j < hands.length; j++) {
      const [a, b] = [hands[i], hands[j]];
      const d = Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1], a.center[2] - b.center[2]);
      if (d < 2 * Math.max(a.rimWide, b.rimWide) + 2 * voxel) close.push([d, a, b]);
    }
  }
  close.sort((p, q) => p[0] - q[0]);
  for (const [, a, b] of close) {
    if (done.has(a) || done.has(b)) continue;
    const cut = [0, ...backs(a)].reduce<ReturnType<typeof attempt>>((found, back) => found ?? attempt([a, b], back), null);
    if (!cut) continue;
    sewLater([a, b], cut);
    done.add(a);
    done.add(b);
  }
  for (const h of hands) {
    if (done.has(h)) continue;
    const cut = attempt([h], 0);
    if (!cut) {
      pending.push(h);
      continue;
    }
    const { gone, kept, near, rings } = cut;
    const ring = rings[0];
    const cutAt = h.rimFrom - h.gap;
    for (const q of gone) alive[q] = 0;

    /* ---- 2. 开口那一圈照手的切口收一收 ---- */
    // 开口是顺着面的边走的，不是平的一圈（有的地方比切面靠里一个体素）。不把它们硬挪到切面上：
    // 上下挨着的两个点挪过去会叠在一起，留下没有面积的面
    const ringPolar = ring.map(h.polar);
    const rimRadius = profile(h.rimPolar.map((p) => p.angle), h.rimPolar.map((p) => p.radius));
    const ringRadius = profile(ringPolar.map((p) => p.angle), ringPolar.map((p) => p.radius));
    // 只动连着开口的那些顶点（顺着留下来的面一圈圈往手肘那边找），旁边路过的别的部件不动
    const linked = new Set(ring);
    for (let grew = true; grew; ) {
      grew = false;
      for (const q of kept) {
        const o = q * 4;
        if (!linked.has(quads[o]) && !linked.has(quads[o + 1]) && !linked.has(quads[o + 2]) && !linked.has(quads[o + 3])) continue;
        for (let k = 0; k < 4; k++) {
          const v = quads[o + k];
          if (mark[v] !== 1 || linked.has(v)) continue;
          linked.add(v);
          grew = true;
        }
      }
    }
    for (const v of near) mark[v] = 0;
    for (const v of linked) {
      // 开口那一圈（切面往里一个多体素以内）整个照手的切口来，再往手肘那边逐渐过渡回原样
      const weight = smooth((along[v] - (cutAt - 1.5 * voxel - h.ease)) / h.ease);
      if (!weight) continue;
      const p = h.polar(v);
      const here = ringRadius(p.angle);
      // 离轴比开口远出一截的（长在一起的胸口、大腿，手腕周围挖空过的时候会连过来）不跟着收：
      // 照手腕的轴往外推拉它们，会扯出一根根长刺
      const beyond = (p.radius - here) / here;
      const keep = beyond <= REACH_KEEP[0] ? 1 : 1 - smooth((beyond - REACH_KEEP[0]) / (REACH_KEEP[1] - REACH_KEEP[0]));
      if (!keep) continue;
      const scale = 1 + (rimRadius(p.angle) / here - 1) * weight * keep;
      const [cx, cy, cz] = h.center;
      const [ax, ay, az] = h.axis;
      const x = pos[v * 3] - cx - ax * p.t;
      const y = pos[v * 3 + 1] - cy - ay * p.t;
      const z = pos[v * 3 + 2] - cz - az * p.t;
      pos[v * 3] = cx + ax * p.t + x * scale;
      pos[v * 3 + 1] = cy + ay * p.t + y * scale;
      pos[v * 3 + 2] = cz + az * p.t + z * scale;
      moved[v] = 1;
    }

    /* ---- 3. 两圈之间缝一圈三角面 ---- */
    // 身体的开口倒着走，就和手的切口同向了
    stitch(ring.slice().reverse(), h.rim, angleOn(h));
  }

  /* ---- 平常的切法缝不上的：切口往手肘那边挪，或者和长在一起的那只手一起切 ---- */
  for (const h of [...pending]) {
    for (const back of backs(h)) {
      const cut = attempt([h], back);
      if (!cut) continue;
      sewLater([h], cut);
      break;
    }
  }
  for (let i = 0; i < pending.length; i++) {
    for (let j = i + 1; j < pending.length; j++) {
      const pair = [pending[i], pending[j]];
      const cut = [0, ...backs(pair[0])].reduce<ReturnType<typeof attempt>>((found, back) => found ?? attempt(pair, back), null);
      if (!cut) continue;
      sewLater(pair, cut);
      i = -1;
      break;
    }
  }

  /* ---- 还是缝不上：手自己封好口，和身体叠着 ---- */
  // 每只手本来预留了一个封盖的顶点，但隔梁上加的点（见 split）可能已经占了它
  grow(pending.length);
  for (const h of pending) {
    const cap = total++;
    pos.set(h.center, cap * 3);
    nor.set([-h.axis[0], -h.axis[1], -h.axis[2]], cap * 3);
    for (let k = 0; k < 4; k++) {
      boundJoints[(cap - body) * 4 + k] = boundJoints[(h.rim[0] - body) * 4 + k];
      boundWeights[(cap - body) * 4 + k] = boundWeights[(h.rim[0] - body) * 4 + k];
    }
    for (let j = 0; j < h.rim.length; j++) tris.push(h.rim[(j + 1) % h.rim.length], h.rim[j], cap);
  }
  if (report) report.loose.push(...pending.map((h) => h.index).sort((a, b) => a - b));
  const loose = pending.length;

  for (const { base, placed } of posed) {
    pos.set(placed.positions, base * 3);
    nor.set(placed.normals, base * 3);
  }

  /* ---- 挪过切口的：开口和手的切口之间接一段管子（中间几圈照角度对上，从开口的样子慢慢变成切口的样子） ---- */
  const lofted: number[] = [];
  for (const { hand: h, ring } of tubes) {
    const lap = ring.slice().reverse();
    const angleOf = angleOn(h);
    // 开口那一圈在某个角度上的点：照角度在相邻两点之间插
    const order = lap.map((v) => ({ v, a: angleOf(v) })).sort((p, q) => p.a - q.a);
    const pointAt = (angle: number): V3 => {
      let i = order.findIndex((p) => p.a > angle);
      if (i < 0) i = 0;
      const b = order[i];
      const a = order[(i + order.length - 1) % order.length];
      let span = b.a - a.a;
      let off = angle - a.a;
      if (span <= 0) span += TAU;
      if (off < 0) off += TAU;
      const s = Math.min(1, off / span);
      return [0, 1, 2].map((k) => pos[a.v * 3 + k] + (pos[b.v * 3 + k] - pos[a.v * 3 + k]) * s) as V3;
    };
    const middle = (list: number[]) => [0, 1, 2].map((k) => list.reduce((sum, v) => sum + pos[v * 3 + k], 0) / list.length);
    const from = middle(lap);
    const to = middle(h.rim);
    const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const steps = Math.max(1, Math.round(length / (1.5 * voxel)));
    const n = h.rim.length;
    grow((steps - 1) * n);
    const bands: number[][] = [];
    for (let j = 1; j < steps; j++) {
      const s = j / steps;
      const band: number[] = [];
      for (const r of h.rim) {
        const p = pointAt(angleOf(r));
        const v = total++;
        for (let k = 0; k < 3; k++) pos[v * 3 + k] = p[k] + (pos[r * 3 + k] - p[k]) * s;
        for (let k = 0; k < 4; k++) {
          boundJoints[(v - body) * 4 + k] = boundJoints[(r - body) * 4 + k];
          boundWeights[(v - body) * 4 + k] = boundWeights[(r - body) * 4 + k];
        }
        band.push(v);
        lofted.push(v);
      }
      bands.push(band);
    }
    bands.push(h.rim);
    stitch(lap, bands[0], angleOf);
    for (let j = 0; j + 1 < bands.length; j++) {
      const x = bands[j];
      const y = bands[j + 1];
      for (let i = 0; i < n; i++) {
        const i1 = (i + 1) % n;
        tris.push(x[i], x[i1], y[i]);
        tris.push(y[i1], y[i], x[i1]);
      }
    }
  }

  /* ---- 整理：去掉没人用的顶点，重新编号 ---- */
  const used = new Uint8Array(total);
  let quadsLeft = 0;
  for (let q = 0; q < quadCount; q++) {
    if (!alive[q]) continue;
    quadsLeft++;
    for (let k = 0; k < 4; k++) used[quads[q * 4 + k]] = 1;
  }
  for (const v of tris) used[v] = 1;
  const remap = new Int32Array(total);
  let count = 0;
  let bodyLeft = 0;
  for (let v = 0; v < total; v++) {
    remap[v] = used[v] ? count++ : -1;
    if (v === body - 1) bodyLeft = count;
  }
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  for (let v = 0; v < total; v++) {
    const r = remap[v];
    if (r < 0) continue;
    positions[r * 3] = pos[v * 3];
    positions[r * 3 + 1] = pos[v * 3 + 1];
    positions[r * 3 + 2] = pos[v * 3 + 2];
    // 挪过的顶点先清零，下面照周围的面重新算（过渡管子上的本来就是 0）
    if (v < body && moved[v]) continue;
    normals[r * 3] = nor[v * 3];
    normals[r * 3 + 1] = nor[v * 3 + 1];
    normals[r * 3 + 2] = nor[v * 3 + 2];
  }
  const outQuads = new Uint32Array(quadsLeft * 4);
  const triangles = new Uint32Array(quadsLeft * 6 + tris.length);
  let w = 0;
  for (let q = 0; q < quadCount; q++) {
    if (!alive[q]) continue;
    for (let k = 0; k < 4; k++) outQuads[w * 4 + k] = remap[quads[q * 4 + k]];
    for (let k = 0; k < 6; k++) triangles[w * 6 + k] = remap[mesh.triangles[q * 6 + k]];
    w++;
  }
  const outTris = Uint32Array.from(tris, (v) => remap[v]);
  triangles.set(outTris, quadsLeft * 6);
  // 挪过的顶点的法线：周围的面的法线（按面积）加起来
  const fresh = new Uint8Array(count);
  for (let v = 0; v < body; v++) if (moved[v] && remap[v] >= 0) fresh[remap[v]] = 1;
  for (const v of lofted) fresh[remap[v]] = 1;
  for (const v of bridged) fresh[remap[v]] = 1;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t];
    const b = triangles[t + 1];
    const c = triangles[t + 2];
    if (!fresh[a] && !fresh[b] && !fresh[c]) continue;
    const e1x = positions[b * 3] - positions[a * 3];
    const e1y = positions[b * 3 + 1] - positions[a * 3 + 1];
    const e1z = positions[b * 3 + 2] - positions[a * 3 + 2];
    const e2x = positions[c * 3] - positions[a * 3];
    const e2y = positions[c * 3 + 1] - positions[a * 3 + 1];
    const e2z = positions[c * 3 + 2] - positions[a * 3 + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      if (!fresh[v]) continue;
      normals[v * 3] += nx;
      normals[v * 3 + 1] += ny;
      normals[v * 3 + 2] += nz;
    }
  }
  for (let v = 0; v < count; v++) {
    if (!fresh[v]) continue;
    const l = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
    normals[v * 3] /= l;
    normals[v * 3 + 1] /= l;
    normals[v * 3 + 2] /= l;
  }

  const bones = [...boneIndex.keys()];
  return {
    positions,
    normals,
    quads: outQuads,
    triangles,
    tris: outTris,
    bound: { start: bodyLeft, bones, joints: boundJoints.slice(0, (count - bodyLeft) * 4), weights: boundWeights.slice(0, (count - bodyLeft) * 4) },
    info: {
      ...mesh.info,
      vertices: count,
      quads: quadsLeft,
      triangles: triangles.length / 3,
      components: mesh.info.components + loose,
      ms: mesh.info.ms + (now() - t0),
    },
  };
}
