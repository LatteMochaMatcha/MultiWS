// 从 DJP Male Base Mesh Mark 03（Death Joe Productions，CC BY 4.0，assets/source/djp-male/）上取阴茎和阴囊：
//   node tools/run.mjs tools/build-genital.ts [--debug <目录>]
// 先用 Blender 把 FBX 转成 OBJ（tools/export-djp-male.py）。--debug 时把取下来的几块另存成 OBJ，拿去 Blender 里看。
//
// 阴茎：照手的做法（tools/build-hand.ts）不过距离场。融合网格是按 6–12 毫米的格子重新生成表面的，
//   龟头的冠状沟比格子还细，过一遍就成了一个圆头。所以在根部往外一点横着切一刀，切口以外原样留下，
//   写成 src/anime/penisMesh.json，融合完缝到身体上伸出来的一小截圆柱上（见 src/sdf/graft.ts）。
//   原件没有骨骼：顺着中心线分三节，权重照每个顶点在中心线上的位置现算。
// 阴囊：取下来，切口往身体里压进去封好，采成距离场格子，写进 public/genital.bin（尺寸记在 src/anime/genitalMeta.json）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type V3 = [number, number, number];

const SOURCE = 'assets/source/djp-male/djp-male.obj';
/** 顺着阴茎往根部一片片切，每片隔多远（米） */
const STEP = 0.005;
/** 横截面比阴茎本身粗出这么多倍，就是到了根部（连上了阴囊、小腹） */
const FLARE = 1.25;
/** 切口在根部往外多远：这一截以内交给距离场（从身体里伸出来的圆柱），以外是原样的网格 */
const CUT_OUT = 0.05;
/** 骨骼：从根部到龟头分几节 */
const BONES = ['Penis1', 'Penis2', 'Penis3'];
/** 相邻两节骨骼的权重在关节两边各这么长（米）里渐变 */
const BLEND = 0.015;
/** 细分几次；新加的点往外鼓多少（同 build-hand.ts） */
const LEVELS = 1;
const BULGE = 0.75;
/** 阴囊只取离中线这么近（米）的：再往外是大腿内侧 */
const SCROTUM_HALF = 0.044;
/** 只取比这更靠前的（z，米）：再往后是会阴、大腿根，阴囊贴在那里的一面不要 */
const SCROTUM_FRONT = 0.046;
/** 离阴茎中心线不到阴茎半径这么多倍的不算阴囊；中心线从根部往身体里也延长这么长一截 */
const SCROTUM_SHAFT = 1.5;
const SCROTUM_SHAFT_BACK = 0.03;
/** 只取根部中心往下阴茎半径这么多倍以下的：再往上是阴茎根部两边的小腹 */
const SCROTUM_BELOW = 0.5;
/** 阴囊的格子：每格多大、距离存到多远（米） */
const SCROTUM_CELL = 0.002;
const SCROTUM_BAND = 0.02;
/** 框比取下来的那一片往外多留多少（米）；上面切在根部中心往下阴茎半径这么多倍的地方 */
const SCROTUM_ROOM = 0.006;
const SCROTUM_TOP = 1.0;
/** 框和素体表面交界处的圆角（米） */
const SCROTUM_SMOOTH = 0.005;
/** 导出时写进去的署名 */
const CREDIT = '阴茎、阴囊取自「DJP Male Base Mesh Mark 03」© Death Joe Productions（www.DeathJoeProductions.com），CC BY 4.0';

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => scale(a, 1 / (len(a) || 1));
const mean = (ps: V3[]): V3 => scale(ps.reduce(add, [0, 0, 0] as V3), 1 / (ps.length || 1));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const edgeKey = (a: number, b: number) => (a < b ? a * 1e6 + b : b * 1e6 + a);
const round = (p: V3, digits = 4) => p.map((v) => Number(v.toFixed(digits))) as V3;

const base64 = (data: Uint8Array) => {
  let text = '';
  for (let i = 0; i < data.length; i++) text += String.fromCharCode(data[i]);
  return btoa(text);
};
const bytes = (data: Float32Array | Uint16Array | Int8Array | Uint8Array) => base64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));

function readObj(file: string): { points: V3[]; polys: number[][] } {
  const points: V3[] = [];
  const polys: number[][] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim().split(/\s+/);
    if (s[0] === 'v') points.push([Number(s[1]), Number(s[2]), Number(s[3])]);
    else if (s[0] === 'f') polys.push(s.slice(1).map((t) => Number(t.split('/')[0]) - 1));
  }
  return { points, polys };
}

function writeObj(file: string, points: V3[], faces: number[][]) {
  const lines = points.map((p) => `v ${p[0].toFixed(6)} ${p[1].toFixed(6)} ${p[2].toFixed(6)}`);
  for (const f of faces) lines.push(`f ${f.map((v) => v + 1).join(' ')}`);
  writeFileSync(file, `${lines.join('\n')}\n`);
}

/** 面积加权的顶点法线 */
function vertexNormals(points: V3[], polys: number[][]): V3[] {
  const normals = points.map((): V3 => [0, 0, 0]);
  for (const f of polys) {
    for (let k = 1; k + 1 < f.length; k++) {
      const n = cross(sub(points[f[k]], points[f[0]]), sub(points[f[k + 1]], points[f[0]]));
      for (const v of [f[0], f[k], f[k + 1]]) normals[v] = add(normals[v], n);
    }
  }
  return normals.map(unit);
}

/** 平面（过 q、法线 d）和网格的边的交点里，离 q 不到 reach 的那些 */
function slice(points: V3[], edges: [number, number][], q: V3, d: V3, reach: number): V3[] {
  const out: V3[] = [];
  for (const [a, b] of edges) {
    const sa = dot(sub(points[a], q), d);
    const sb = dot(sub(points[b], q), d);
    if ((sa > 0) === (sb > 0)) continue;
    const p = add(points[a], scale(sub(points[b], points[a]), sa / (sa - sb)));
    if (len(sub(p, q)) < reach) out.push(p);
  }
  return out;
}

/** 一片横截面：中心、朝龟头的方向、平均半径、最大半径 */
interface Ring {
  center: V3;
  dir: V3;
  radius: number;
  widest: number;
}

/**
 * 从龟头往根部一片片切，求中心线。每片垂直于上一段中心线，交点取平均就是这一片的中心。
 * 返回从龟头到根部的各片，最后一片是刚连上阴囊、小腹的那一片（横截面一下子变粗）
 */
function traceShaft(points: V3[], edges: [number, number][], tip: V3): Ring[] {
  // 起始方向：龟头附近两片的中心连线。先沿 -Z（往身体里）猜一个，切两片，再照中心修正
  let dir: V3 = [0, 0, 1];
  let center = sub(tip, [0, 0, 0.01]);
  for (let round = 0; round < 4; round++) {
    const a = mean(slice(points, edges, sub(tip, scale(dir, 0.01)), dir, 0.04));
    const b = mean(slice(points, edges, sub(tip, scale(dir, 0.03)), dir, 0.04));
    dir = unit(sub(a, b));
    center = a;
  }
  const rings: Ring[] = [];
  let q = center;
  for (let k = 0; k < 120; k++) {
    const hits = slice(points, edges, q, dir, 0.07);
    if (hits.length < 6) break;
    const c = mean(hits);
    const radii = hits.map((p) => len(sub(p, c)));
    const ring = { center: c, dir, radius: radii.reduce((s, r) => s + r, 0) / radii.length, widest: Math.max(...radii) };
    rings.push(ring);
    const shaft = median(rings.slice(Math.min(rings.length - 1, 8)).map((r) => r.radius));
    if (rings.length > 12 && ring.widest > FLARE * Math.max(shaft, ...rings.slice(-4, -1).map((r) => r.widest))) break;
    if (rings.length > 1) dir = unit(add(scale(dir, 0.5), scale(unit(sub(rings[rings.length - 2].center, c)), 0.5)));
    q = sub(c, scale(dir, STEP));
  }
  return rings;
}

/** 从 start 出发，经过 keep 里的顶点能走到的面 */
function reachable(polys: number[][], keep: (v: number) => boolean, start: number): number[] {
  const byVertex = new Map<number, number[]>();
  polys.forEach((f, i) => {
    if (!f.every(keep)) return;
    for (const v of f) {
      const list = byVertex.get(v) ?? [];
      list.push(i);
      byVertex.set(v, list);
    }
  });
  const seen = new Set<number>();
  const stack = [...(byVertex.get(start) ?? [])];
  while (stack.length) {
    const i = stack.pop()!;
    if (seen.has(i)) continue;
    seen.add(i);
    for (const v of polys[i]) for (const j of byVertex.get(v) ?? []) if (!seen.has(j)) stack.push(j);
  }
  return [...seen].sort((a, b) => a - b);
}

/** 只属于一个面的边，顺着面的方向连成一圈（同 build-hand.ts） */
function boundaryLoops(triangles: number[][]): number[][] {
  const uses = new Map<number, number>();
  for (const t of triangles) for (let k = 0; k < 3; k++) uses.set(edgeKey(t[k], t[(k + 1) % 3]), (uses.get(edgeKey(t[k], t[(k + 1) % 3])) ?? 0) + 1);
  if ([...uses.values()].some((n) => n > 2)) throw new Error('有一条边被三个以上的面共用');
  const next = new Map<number, number>();
  for (const t of triangles) {
    for (let k = 0; k < 3; k++) {
      const a = t[k];
      const b = t[(k + 1) % 3];
      if (uses.get(edgeKey(a, b)) !== 1) continue;
      if (next.has(a)) throw new Error('切口不是简单的一圈');
      next.set(a, b);
    }
  }
  const loops: number[][] = [];
  const left = new Set(next.keys());
  while (left.size) {
    const start = left.values().next().value as number;
    const loop: number[] = [];
    for (let v = start; left.has(v); v = next.get(v)!) {
      left.delete(v);
      loop.push(v);
    }
    loops.push(loop);
  }
  return loops;
}

/** 细分一次：每条边的中点加一个顶点，照两头的法线往外鼓一点（同 build-hand.ts） */
function subdivide(points: V3[], normals: V3[], triangles: number[][]) {
  const middle = new Map<number, number>();
  const mid = (a: number, b: number) => {
    const key = edgeKey(a, b);
    let id = middle.get(key);
    if (id !== undefined) return id;
    const A = points[a];
    const B = points[b];
    const m = scale(add(A, B), 0.5);
    const lift: V3 = [0, 0, 0];
    for (const [p, n] of [
      [A, normals[a]],
      [B, normals[b]],
    ] as const) {
      const off = dot(sub(m, p), n);
      for (let k = 0; k < 3; k++) lift[k] -= (off * n[k]) / 2;
    }
    id = points.length;
    points.push(add(m, scale(lift, BULGE)));
    normals.push(unit(add(normals[a], normals[b])));
    middle.set(key, id);
    return id;
  };
  return triangles.flatMap(([a, b, c]) => {
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ca = mid(c, a);
    return [
      [a, ab, ca],
      [ab, b, bc],
      [ca, bc, c],
      [ab, bc, ca],
    ];
  });
}

/** 点到折线最近的地方：沿折线走了多远 */
function along(line: V3[], p: V3): number {
  let best = Infinity;
  let at = 0;
  let walked = 0;
  for (let k = 0; k + 1 < line.length; k++) {
    const seg = sub(line[k + 1], line[k]);
    const l = len(seg);
    const t = Math.min(Math.max(dot(sub(p, line[k]), seg) / (l * l || 1), 0), 1);
    const d = len(sub(p, add(line[k], scale(seg, t))));
    if (d < best) {
      best = d;
      at = walked + t * l;
    }
    walked += l;
  }
  return at;
}

/** 折线上走了 s 远的那一点 */
function pointAt(line: V3[], s: number): V3 {
  let walked = 0;
  for (let k = 0; k + 1 < line.length; k++) {
    const l = len(sub(line[k + 1], line[k]));
    if (walked + l >= s) return add(line[k], scale(sub(line[k + 1], line[k]), (s - walked) / (l || 1)));
    walked += l;
  }
  return line[line.length - 1];
}

export async function main(args: string[], root: string) {
  const debugAt = args.indexOf('--debug');
  const debug = debugAt >= 0 ? args[debugAt + 1] : null;
  if (debug) mkdirSync(debug, { recursive: true });

  const { points, polys } = readObj(join(root, SOURCE));
  const normals = vertexNormals(points, polys);
  const edgeSet = new Map<number, [number, number]>();
  for (const f of polys) for (let k = 0; k < f.length; k++) edgeSet.set(edgeKey(f[k], f[(k + 1) % f.length]), [f[k], f[(k + 1) % f.length]]);
  const edges = [...edgeSet.values()];
  console.log(`DJP 男性素体：${points.length} 个顶点，${polys.length} 个面`);

  /* ---- 阴茎：中心线 ---- */
  let tipIndex = 0;
  points.forEach((p, i) => {
    if (p[2] > points[tipIndex][2]) tipIndex = i;
  });
  const tip = points[tipIndex];
  const rings = traceShaft(points, edges, tip);
  const flare = rings[rings.length - 1];
  // 根部：横截面刚开始变粗的那一片的前一片
  const baseRing = rings[rings.length - 2];
  const shaftRadius = median(rings.slice(8, -2).map((r) => r.radius));
  // 中心线从根部到龟头（龟头最前面那一点补在最后）
  const line: V3[] = [...rings.slice(0, -1).map((r) => r.center)].reverse();
  line.push(tip);
  let length = 0;
  for (let k = 0; k + 1 < line.length; k++) length += len(sub(line[k + 1], line[k]));
  console.log(`中心线 ${rings.length} 片，根部 (${round(baseRing.center, 3).join(', ')})，长 ${length.toFixed(3)} 米，阴茎半径 ${shaftRadius.toFixed(4)}，根部那片最宽 ${flare.widest.toFixed(3)}`);
  for (const [k, r] of rings.entries()) if (k % 4 === 0 || k > rings.length - 4) console.log(`  第 ${k} 片 中心 (${round(r.center, 3).join(', ')}) 平均半径 ${r.radius.toFixed(4)} 最宽 ${r.widest.toFixed(4)}`);

  /* ---- 阴茎：切口 ---- */
  const cutAt = CUT_OUT;
  const cut = pointAt(line, cutAt);
  const cutDir = unit(sub(pointAt(line, cutAt + 0.01), pointAt(line, Math.max(cutAt - 0.01, 0))));
  const outside = (v: number) => dot(sub(points[v], cut), cutDir) > 0;
  const kept = reachable(polys, outside, tipIndex);
  const used = new Map<number, number>();
  const piecePoints: V3[] = [];
  const pieceNormals: V3[] = [];
  const take = (v: number) => {
    let id = used.get(v);
    if (id === undefined) {
      id = piecePoints.length;
      used.set(v, id);
      piecePoints.push(points[v]);
      pieceNormals.push(normals[v]);
    }
    return id;
  };
  let triangles: number[][] = [];
  for (const i of kept) {
    const f = polys[i].map(take);
    for (let k = 1; k + 1 < f.length; k++) triangles.push([f[0], f[k], f[k + 1]]);
  }
  const loops0 = boundaryLoops(triangles);
  if (loops0.length !== 1) throw new Error(`切口应该是一圈，现在是 ${loops0.length} 圈（${loops0.map((l) => l.length).join('、')} 个顶点）`);
  for (let level = 0; level < LEVELS; level++) triangles = subdivide(piecePoints, pieceNormals, triangles);
  const [loop] = boundaryLoops(triangles);
  const rimRadius = loop.map((v) => len(sub(piecePoints[v], cut)));
  console.log(
    `阴茎：切口在根部往外 ${cutAt} 米 (${round(cut, 3).join(', ')})，方向 (${round(cutDir, 3).join(', ')})；` +
      `留下 ${kept.length} 个面，细分后 ${piecePoints.length} 个顶点、${triangles.length} 个三角面；切口一圈 ${loop.length} 个顶点，半径 ${Math.min(...rimRadius).toFixed(4)}–${Math.max(...rimRadius).toFixed(4)}`,
  );

  /* ---- 阴茎：骨骼和权重 ---- */
  const joints = BONES.map((_, k) => pointAt(line, (length * k) / BONES.length));
  joints.push(tip);
  const cuts = BONES.slice(1).map((_, k) => (length * (k + 1)) / BONES.length);
  const jointBytes = new Uint8Array(piecePoints.length * 4);
  const weightBytes = new Uint8Array(piecePoints.length * 4);
  piecePoints.forEach((p, i) => {
    const s = along(line, p);
    // 落在第几节；靠近关节的在两节之间渐变
    let bone = cuts.findIndex((c) => s < c);
    if (bone < 0) bone = BONES.length - 1;
    const near = cuts.map((c, k) => ({ k, d: s - c })).find(({ d }) => Math.abs(d) < BLEND);
    if (!near) {
      jointBytes[i * 4] = bone;
      weightBytes[i * 4] = 255;
      return;
    }
    // 关节在第 k 节和第 k + 1 节之间：d 从 -BLEND 到 BLEND，后一节的份量从 0 到 1（平滑一点）
    const t = (near.d + BLEND) / (2 * BLEND);
    const w = t * t * (3 - 2 * t);
    const heavy = w >= 0.5 ? near.k + 1 : near.k;
    const light = w >= 0.5 ? near.k : near.k + 1;
    const big = Math.round(Math.max(w, 1 - w) * 255);
    jointBytes.set([heavy, light], i * 4);
    weightBytes.set([big, 255 - big], i * 4);
  });

  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of piecePoints) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  }
  const penis = {
    note: 'DJP Male Base Mesh Mark 03（Death Joe Productions，CC BY 4.0）的阴茎，由 tools/build-genital.ts 生成，不要手改',
    vertices: piecePoints.length,
    triangles: triangles.length,
    /** 写在素体模型自己的坐标里（米，面朝 +Z，左手边是 +X）。base 是根部（横截面开始变粗的地方）的中心，cut 是切口的中心 */
    base: round(baseRing.center),
    cut: round(cut),
    /** 根部、切口处中心线的方向（朝龟头） */
    baseDir: round(unit(sub(line[Math.min(2, line.length - 1)], line[0]))),
    cutDir: round(cutDir),
    /** 阴茎的平均半径、切口一圈的平均半径 */
    radius: Number(shaftRadius.toFixed(4)),
    rim: Number((rimRadius.reduce((s, r) => s + r, 0) / rimRadius.length).toFixed(4)),
    /** 从根部到龟头沿中心线多长 */
    length: Number(length.toFixed(4)),
    /** 中心线（从根部到龟头），三节骨骼的关节（根部、两个中间、龟头） */
    line: line.map((p) => round(p)),
    jointsAt: joints.map((p) => round(p)),
    bounds: { min: round(lo), max: round(hi) },
    bones: BONES,
    loop,
    positions: bytes(new Float32Array(piecePoints.flat())),
    normals: bytes(new Int8Array(pieceNormals.flatMap((n) => n.map((c) => Math.round(c * 127))))),
    joints: bytes(jointBytes),
    weights: bytes(weightBytes),
    faces: bytes(new Uint16Array(triangles.flat())),
  };
  const target = join(root, 'src/anime/penisMesh.json');
  writeFileSync(target, `${JSON.stringify(penis)}\n`);
  console.log(`写到 ${target}（${(JSON.stringify(penis).length / 1024).toFixed(0)} KB）`);
  if (debug) {
    writeObj(join(debug, 'penis.obj'), piecePoints, triangles);
    writeObj(join(debug, 'centerline.obj'), [...line, ...joints], []);
  }

  /* ---- 阴囊：从最前面那一点往外长，碰到阴茎、大腿、身体就停 ---- */
  const base = baseRing.center;
  const baseDir = unit(sub(line[Math.min(2, line.length - 1)], line[0]));
  /** 阴茎和它根部往身体里那一截：离中心线不到这么远的不算阴囊 */
  const shaftRoom = SCROTUM_SHAFT * shaftRadius;
  const inShaft = (p: V3) => {
    const t = dot(sub(p, base), baseDir);
    if (t < -SCROTUM_SHAFT_BACK) return false;
    const s = Math.max(t, 0) ? along(line, p) : 0;
    const axis = t > 0 ? pointAt(line, s) : add(base, scale(baseDir, t));
    return len(sub(p, axis)) < shaftRoom;
  };
  const allowed = (v: number) => {
    const p = points[v];
    return Math.abs(p[0]) < SCROTUM_HALF && p[2] > SCROTUM_FRONT && p[1] < base[1] - SCROTUM_BELOW * shaftRadius && !inShaft(p);
  };
  let seed = -1;
  points.forEach((p, i) => {
    if (Math.abs(p[0]) < 0.01 && p[1] > 0.55 && p[1] < base[1] - 2 * shaftRadius && allowed(i) && (seed < 0 || p[2] > points[seed][2])) seed = i;
  });
  if (seed < 0) throw new Error('找不到阴囊');
  const sacFaces = reachable(polys, allowed, seed);
  const sacUsed = new Map<number, number>();
  const sacPoints: V3[] = [];
  const sacTris: number[][] = [];
  for (const i of sacFaces) {
    const f = polys[i].map((v) => {
      let id = sacUsed.get(v);
      if (id === undefined) {
        id = sacPoints.length;
        sacUsed.set(v, id);
        sacPoints.push(points[v]);
      }
      return id;
    });
    for (let k = 1; k + 1 < f.length; k++) sacTris.push([f[0], f[k], f[k + 1]]);
  }
  const sacLoops = boundaryLoops(sacTris);
  const sacLo: V3 = [Infinity, Infinity, Infinity];
  const sacHi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of sacPoints) {
    for (let k = 0; k < 3; k++) {
      sacLo[k] = Math.min(sacLo[k], p[k]);
      sacHi[k] = Math.max(sacHi[k], p[k]);
    }
  }
  console.log(
    `阴囊：从 (${round(points[seed], 3).join(', ')}) 长出去 ${sacFaces.length} 个面、${sacPoints.length} 个顶点；` +
      `范围 x ${sacLo[0].toFixed(3)}–${sacHi[0].toFixed(3)}，y ${sacLo[1].toFixed(3)}–${sacHi[1].toFixed(3)}，z ${sacLo[2].toFixed(3)}–${sacHi[2].toFixed(3)}；` +
      `开口 ${sacLoops.length} 圈（${sacLoops.map((l) => l.length).join('、')} 个顶点）`,
  );
  if (debug) writeObj(join(debug, 'scrotum-patch.obj'), sacPoints, sacTris);


  /* ---- 阴囊：采成距离场格子 ---- */
  // 上面取下来的那一片只用来定范围：它上面贴着阴茎根部、后面贴着会阴，两头都敞着，封不干净。
  // 距离照整个素体的表面算（素体是封死的，里外沿 z 打射线数穿过几次），再只框出阴囊那一块：
  // 左右不到大腿内侧，后面在会阴前面切平，上面在阴茎根部底下切平，下面在阴囊底下一点。切平的几面用的时候埋进身体里
  // 框是包住取下来那一片的椭球（各方向多留 SCROTUM_ROOM），再在后面、上面各切平：方的框会把阴囊两边、后面的大腿根也框进来
  const box = {
    min: [sacLo[0] - SCROTUM_ROOM, sacLo[1] - SCROTUM_ROOM, SCROTUM_FRONT] as V3,
    max: [sacHi[0] + SCROTUM_ROOM, base[1] - SCROTUM_TOP * shaftRadius, sacHi[2] + SCROTUM_ROOM] as V3,
  };
  const egg = { center: scale(add(sacLo, sacHi), 0.5), radii: scale(sub(sacHi, sacLo), 0.5).map((v) => v + SCROTUM_ROOM) as V3 };
  /** 框的有符号距离：椭球（近似的距离）和后面、上面两个平面取交 */
  const boxDist = (p: V3) => {
    const u = sub(p, egg.center).map((v, k) => v / egg.radii[k]) as V3;
    const w = u.map((v, k) => v / egg.radii[k]) as V3;
    const k0 = len(u);
    const ellipsoid = k0 < 1e-9 ? -Math.min(...egg.radii) : (k0 * (k0 - 1)) / (len(w) || 1);
    return Math.max(ellipsoid, box.min[2] - p[2], p[1] - box.max[1]);
  };
  // 格子的原点：框的后面正中（贴着身体的那一面）；用的时候这里对着身体
  const sacRoot: V3 = [0, (box.min[1] + box.max[1]) / 2, box.min[2]];
  const margin = SCROTUM_BAND + SCROTUM_CELL;
  const min = [box.min[0] - margin, box.min[1] - margin, box.min[2] - margin].map((v, k) => v - sacRoot[k]) as V3;
  const dims = [0, 1, 2].map((k) => Math.ceil((box.max[k] - box.min[k] + 2 * margin) / SCROTUM_CELL) + 1) as [number, number, number];
  const [nx, ny, nz] = dims;
  const at = (i: number, j: number, k: number): V3 => [sacRoot[0] + min[0] + i * SCROTUM_CELL, sacRoot[1] + min[1] + j * SCROTUM_CELL, sacRoot[2] + min[2] + k * SCROTUM_CELL];
  const gridLo = at(0, 0, 0);
  const gridHi = at(nx - 1, ny - 1, nz - 1);
  const t0 = Date.now();
  const bodyTris: [V3, V3, V3][] = polys.flatMap((f) => f.slice(1, -1).map((_, k) => [points[f[0]], points[f[k + 1]], points[f[k + 2]]] as [V3, V3, V3]));
  // 里外：每一列沿 +z 打一条射线，和哪些三角形相交（只看 xy 范围盖得住这一列的）
  const column = bodyTris.filter(([a, b, c]) => Math.max(a[0], b[0], c[0]) >= gridLo[0] && Math.min(a[0], b[0], c[0]) <= gridHi[0] && Math.max(a[1], b[1], c[1]) >= gridLo[1] && Math.min(a[1], b[1], c[1]) <= gridHi[1]);
  // 距离：只看格子周围一圈的三角形
  const near = column.filter(([a, b, c]) => Math.max(a[2], b[2], c[2]) >= gridLo[2] - SCROTUM_BAND && Math.min(a[2], b[2], c[2]) <= gridHi[2] + SCROTUM_BAND);
  const data = new Int16Array(nx * ny * nz);
  let insideCells = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const [x, y] = at(i, j, 0);
      const xs = x + 1.3e-7;
      const ys = y + 0.7e-7;
      const hits: number[] = [];
      for (const [a, b, c] of column) {
        // 点 (xs, ys) 在三角形的 xy 投影里面的话，求那里的 z
        const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (Math.abs(d) < 1e-14) continue;
        const u = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d;
        const v = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d;
        if (u < 0 || v < 0 || u + v > 1) continue;
        hits.push(u * a[2] + v * b[2] + (1 - u - v) * c[2]);
      }
      for (let k = 0; k < nz; k++) {
        const p = at(i, j, k);
        let d2 = Infinity;
        for (const [a, b, c] of near) d2 = Math.min(d2, distance2(p, a, b, c));
        const inside = hits.filter((z) => z > p[2]).length % 2 === 1;
        let d = Math.sqrt(d2) * (inside ? -1 : 1);
        // 只留框里的（交界倒个小圆角，切口不起毛边）
        d = smax(d, boxDist(p), SCROTUM_SMOOTH);
        if (d < 0) insideCells++;
        data[i + nx * (j + ny * k)] = Math.round(Math.max(-1, Math.min(1, d / SCROTUM_BAND)) * 32767);
      }
    }
  }
  const sacLo2 = sub(box.min, sacRoot);
  const sacHi2 = sub(box.max, sacRoot);
  console.log(`阴囊格子：${dims.join(' × ')}，每格 ${SCROTUM_CELL * 1000} 毫米，用了 ${((Date.now() - t0) / 1000).toFixed(1)} 秒；里面 ${insideCells} 格；射线看了 ${column.length} 个三角形，距离看了 ${near.length} 个`);
  const binary = join(root, 'public/genital.bin');
  writeFileSync(binary, new Uint8Array(data.buffer));
  const meta = {
    note: 'DJP Male Base Mesh Mark 03（Death Joe Productions，CC BY 4.0）的阴囊，由 tools/build-genital.ts 生成，不要手改',
    credit: CREDIT,
    scrotum: {
      /** 格子的坐标以框的后面正中（贴着身体那一面）为原点；它在素体模型里的位置 */
      root: round(sacRoot),
      min: round(min, 5),
      dims,
      cell: SCROTUM_CELL,
      band: SCROTUM_BAND,
      bounds: { min: round(sacLo2), max: round(sacHi2) },
      offset: 0,
      length: data.length,
    },
  };
  writeFileSync(join(root, 'src/anime/genitalMeta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`写到 ${binary}（${(data.byteLength / 1024).toFixed(0)} KB）和 src/anime/genitalMeta.json`);
}

/** 圆滑的取交：a、b 都在里面的才算里面，交界处倒半径 k 的圆角 */
function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
}

/** 点到三角形的距离的平方（同 tools/build-anime-body.mjs） */
function distance2(p: V3, a: V3, b: V3, c: V3): number {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  let q: V3;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) q = add(a, scale(ab, d1 / (d1 - d3)));
      else {
        const cp = sub(p, c);
        const d5 = dot(ab, cp);
        const d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) q = add(a, scale(ac, d2 / (d2 - d6)));
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) q = add(b, scale(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
            else {
              const den = 1 / (va + vb + vc);
              q = add(a, add(scale(ab, vb * den), scale(ac, vc * den)));
            }
          }
        }
      }
    }
  }
  const d = sub(p, q);
  return dot(d, d);
}

