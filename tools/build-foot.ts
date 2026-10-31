// 从 Kotori（Fox Jump，CC BY，assets/source/kotori/）身上取下左脚的网格（连着五个脚趾），
// 写成二次元素体用的那只脚（src/anime/footMesh.json）：
//   node tools/run.mjs tools/build-foot.ts
//
// 为什么要单独取：二次元素体本来的脚（VRoid 旧版女性素体）是给穿鞋做的，像一只鞋楦，没有脚趾；
// 脚趾比融合的格子还细，过一遍格子也会粘成一团。所以和手一样：脚不过格子，直接用现成的网格（连它自带的蒙皮权重），
// 融合完以后在脚踝上面一点缝到腿上（见 src/sdf/graft.ts）。
//
// 做的事：脚踝往上一点的那一圈往下的面都留下；同一个位置的顶点焊成一个；只留最大的一块；
// 照素体的脚摆好（脚踝对上素体的脚踝，等比放大一点，脚底踩在素体的脚底那么高）；细分一次，让脚趾圆一点。
// 网格写在素体模型自己的坐标里（面朝 +Z，左手边是 +X），和手一样。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boneNames } from '../src/character/assemble';
import { type CharacterSource, readCharacter } from '../src/character/source';

/** 从脚踝的关节往膝盖那边留多高的一截（米，Kotori 自己的大小）：切口在这里，缝的时候从这里接上小腿 */
const CUFF = 0.035;
/** Kotori 的脚放大多少倍摆到素体上（素体是 1.6 米、Kotori 是 1.43 米；脚踝到脚底差不多高） */
const SIZE = 1.08;
/** 细分几次；新加的点往外鼓多少（0 是不鼓，就在边的正中） */
const LEVELS = 1;
const BULGE = 0.75;

type V3 = [number, number, number];
interface Vertex {
  p: V3;
  n: V3;
  /** 骨骼名 → 权重 */
  w: Map<string, number>;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const edgeKey = (a: number, b: number) => (a < b ? a * 1e6 + b : b * 1e6 + a);

const base64 = (data: Uint8Array) => {
  let text = '';
  for (let i = 0; i < data.length; i++) text += String.fromCharCode(data[i]);
  return btoa(text);
};
const bytes = (data: Float32Array | Uint16Array | Int8Array | Uint8Array) => base64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));

function load(root: string, path: string): { source: CharacterSource; joint: (name: string) => V3; names: string[] } {
  const file = readFileSync(join(root, path));
  const source = readCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  const names = boneNames(source.bones);
  const joint = (name: string): V3 => {
    const bone = source.bones[names.indexOf(name)];
    if (!bone) throw new Error(`${path} 里没有骨骼 ${name}`);
    return [bone.pos[0], bone.pos[1], bone.pos[2]];
  };
  return { source, joint, names };
}

/** 一个模型的皮肤上，左脚（x > 0、低于 below）最低的那一点有多高 */
function soleOf(source: CharacterSource, below: number): number {
  let low = Infinity;
  for (const chunk of source.chunks) {
    if (!/_SKIN/i.test(source.materials[chunk.material].name)) continue;
    for (const v of chunk.indices) {
      const y = chunk.positions[v * 3 + 1];
      if (y < below && chunk.positions[v * 3] > 0) low = Math.min(low, y);
    }
  }
  return low;
}

export async function main(_args: string[], root: string) {
  const kotori = load(root, 'assets/source/kotori/Model/Kotori.vrm');
  const base = load(root, 'assets/source/base_female/Base_Female.vrm');
  const ankle = kotori.joint('Foot_L');
  const cutY = ankle[1] + CUFF;
  // 摆到素体上：脚踝对上素体的脚踝（左右前后），等比放大，脚底踩在素体的脚底那么高
  const target = base.joint('Foot_L');
  const lift = soleOf(base.source, 0.15) - (target[1] + (soleOf(kotori.source, 0.15) - ankle[1]) * SIZE);
  const place = (p: V3): V3 => [target[0] + (p[0] - ankle[0]) * SIZE, target[1] + (p[1] - ankle[1]) * SIZE + lift, target[2] + (p[2] - ankle[2]) * SIZE];

  /* ---- 1. 脚踝往上一点那一圈往下的面，同一个位置的顶点焊成一个 ---- */
  let vertices: Vertex[] = [];
  let triangles: number[][] = [];
  const welded = new Map<string, number>();
  const { source, names } = kotori;
  for (const chunk of source.chunks) {
    if (!/_SKIN/i.test(source.materials[chunk.material].name)) continue;
    const idOf = new Map<number, number>();
    for (let t = 0; t < chunk.indices.length; t += 3) {
      const tri = [chunk.indices[t], chunk.indices[t + 1], chunk.indices[t + 2]];
      if (!tri.every((v) => chunk.positions[v * 3 + 1] < cutY && chunk.positions[v * 3] > 0)) continue;
      triangles.push(
        tri.map((v) => {
          let id = idOf.get(v);
          if (id !== undefined) return id;
          const p: V3 = [chunk.positions[v * 3], chunk.positions[v * 3 + 1], chunk.positions[v * 3 + 2]];
          const n: V3 = [chunk.normals[v * 3], chunk.normals[v * 3 + 1], chunk.normals[v * 3 + 2]];
          const key = p.map((c) => Math.round(c * 2e5)).join(',');
          id = welded.get(key);
          if (id === undefined) {
            const w = new Map<string, number>();
            for (let k = 0; k < 4; k++) {
              const weight = chunk.weights[v * 4 + k];
              if (!weight) continue;
              const name = names[chunk.joints[v * 4 + k]];
              if (!/_L$/.test(name)) throw new Error(`左脚上的顶点跟着 ${name}`);
              // ToeBase_end 是脚趾尖上的末端，没有自己的权重；有的话算在脚趾上
              const short = name.slice(0, -2) === 'ToeBase_end' ? 'Toes' : name.slice(0, -2);
              if (!['LowerLeg', 'Foot', 'Toes'].includes(short)) throw new Error(`左脚上的顶点跟着 ${name}`);
              w.set(short, (w.get(short) ?? 0) + weight);
            }
            id = vertices.length;
            welded.set(key, id);
            vertices.push({ p: place(p), n: [0, 0, 0], w });
          }
          // 接缝两边的法线不一样：加起来取平均（等比放大，法线方向不变）
          for (let k = 0; k < 3; k++) vertices[id].n[k] += n[k];
          idOf.set(v, id);
          return id;
        }),
      );
    }
  }
  for (const v of vertices) v.n = unit(v.n);

  /* ---- 2. 只留最大的一块 ---- */
  const group = vertices.map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  for (const t of triangles) {
    group[find(t[0])] = find(t[1]);
    group[find(t[1])] = find(t[2]);
  }
  const size = new Map<number, number>();
  vertices.forEach((_, i) => size.set(find(i), (size.get(find(i)) ?? 0) + 1));
  const [main, ...rest] = [...size].sort((a, b) => b[1] - a[1]);
  if (rest.some(([, n]) => n > 40)) throw new Error(`脚上还有别的碎块：${rest.map(([, n]) => n)}`);
  const renumber = new Map<number, number>();
  vertices = vertices.filter((_, i) => find(i) === main[0] && renumber.set(i, renumber.size));
  triangles = triangles.filter((t) => renumber.has(t[0])).map((t) => t.map((v) => renumber.get(v)!));
  console.log(`脚：${vertices.length} 个顶点，${triangles.length} 个面；丢掉了 ${rest.length} 小块`);

  /* ---- 3. 细分：每条边的中点加一个顶点，照两头的法线往外鼓一点 ---- */
  for (let level = 0; level < LEVELS; level++) {
    const middle = new Map<number, number>();
    const mid = (a: number, b: number) => {
      const key = edgeKey(a, b);
      let id = middle.get(key);
      if (id !== undefined) return id;
      const A = vertices[a];
      const B = vertices[b];
      const m: V3 = [(A.p[0] + B.p[0]) / 2, (A.p[1] + B.p[1]) / 2, (A.p[2] + B.p[2]) / 2];
      const lift: V3 = [0, 0, 0];
      for (const v of [A, B]) {
        const off = dot(sub(m, v.p), v.n);
        for (let k = 0; k < 3; k++) lift[k] -= (off * v.n[k]) / 2;
      }
      const w = new Map<string, number>();
      for (const v of [A, B]) for (const [name, weight] of v.w) w.set(name, (w.get(name) ?? 0) + weight / 2);
      id = vertices.length;
      vertices.push({ p: [m[0] + lift[0] * BULGE, m[1] + lift[1] * BULGE, m[2] + lift[2] * BULGE], n: unit([A.n[0] + B.n[0], A.n[1] + B.n[1], A.n[2] + B.n[2]]), w });
      middle.set(key, id);
      return id;
    };
    triangles = triangles.flatMap(([a, b, c]) => {
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

  /* ---- 4. 切口那一圈：只属于一个面的边，顺着面的方向连成一圈 ---- */
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
  const loop: number[] = [];
  const start = next.keys().next().value as number;
  for (let v = start; loop.length <= next.size; v = next.get(v)!) {
    if (loop.length && v === start) break;
    loop.push(v);
  }
  if (loop.length !== next.size) throw new Error(`切口有 ${next.size} 条边，连成的一圈只有 ${loop.length} 条：不止一圈`);

  /* ---- 5. 骨骼和权重：每个顶点最多 4 根，权重加起来是 255 ---- */
  const bones = ['LowerLeg', 'Foot', 'Toes'].filter((name) => vertices.some((v) => v.w.has(name)));
  const joints = new Uint8Array(vertices.length * 4);
  const weights = new Uint8Array(vertices.length * 4);
  vertices.forEach((v, i) => {
    const top = [...v.w].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, [, w]) => s + w, 0);
    const packed = top.map(([name, w]) => ({ bone: bones.indexOf(name), byte: Math.round((w / sum) * 255) }));
    packed[0].byte += 255 - packed.reduce((total, one) => total + one.byte, 0);
    packed.sort((a, b) => b.byte - a.byte);
    packed.forEach((one, k) => {
      joints[i * 4 + k] = one.byte ? one.bone : 0;
      weights[i * 4 + k] = one.byte;
    });
  });

  const positions = new Float32Array(vertices.flatMap((v) => v.p));
  const normals = new Int8Array(vertices.flatMap((v) => v.n.map((c) => Math.round(c * 127))));
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const v of vertices) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], v.p[k]);
      hi[k] = Math.max(hi[k], v.p[k]);
    }
  }
  const round = (p: V3) => p.map((v) => +v.toFixed(5));
  const out = {
    note: 'Kotori（Fox Jump，CC BY，https://fox-jump.itch.io/kotori-anime-character）的左脚，摆在 VRoid 旧版女性素体上；由 tools/build-foot.ts 生成，不要手改',
    vertices: vertices.length,
    triangles: triangles.length,
    /** 脚踝、膝盖、脚趾根、脚趾尖的关节在素体模型里的位置（脚的网格写在素体模型自己的坐标里：面朝 +Z，左手边是 +X） */
    ankle: round(place(ankle)),
    knee: round(place(kotori.joint('LowerLeg_L'))),
    toe: round(place(kotori.joint('Toes_L'))),
    toeEnd: round(place(kotori.joint('ToeBase_end_L'))),
    /** 切口在脚踝往上多高（素体的大小） */
    cuff: +(CUFF * SIZE).toFixed(5),
    bounds: { min: lo, max: hi },
    bones,
    loop,
    positions: bytes(positions),
    normals: bytes(normals),
    joints: bytes(joints),
    weights: bytes(weights),
    faces: bytes(new Uint16Array(triangles.flat())),
  };
  const file = join(root, 'src/anime/footMesh.json');
  writeFileSync(file, `${JSON.stringify(out)}\n`);
  console.log(`细分以后 ${vertices.length} 个顶点，${triangles.length} 个面；切口一圈 ${loop.length} 个顶点；骨骼 ${bones.join('、')}`);
  console.log(`脚踝 ${out.ankle}（素体 ${target.map((v) => v.toFixed(4))}），脚趾根 ${out.toe}，脚尖 ${out.toeEnd}`);
  console.log(`范围 x ${lo[0].toFixed(3)}–${hi[0].toFixed(3)}，y ${lo[1].toFixed(3)}–${hi[1].toFixed(3)}，z ${lo[2].toFixed(3)}–${hi[2].toFixed(3)}；写到 ${file}（${(JSON.stringify(out).length / 1024).toFixed(0)} KB）`);
}
