// 把 Kenney 的 Furniture Kit（CC0，assets/source/kenney-furniture-kit/）里挑中的低模家具转成工坊的道具素材：
//   node tools/run.mjs tools/build-props.ts
//
// 写出两个文件：
//   public/props/lowpoly.bin      全部素材的网格，一件接一件（点、法线、面）
//   src/props/lowpolyMeta.json    每件的编号、分在哪一组、原样多大、在 bin 里的位置
//
// 做的事：照 GLB 里节点的摆放把各块网格拼成一整块；放大到真人的尺寸（包里的单位大约是真实的一半）；
// 需要的转个朝向（正面朝 +Z，和角色面朝的方向一样）；原点挪到底面正中；位置和法线都一样的点合成一个。
// 材质、贴图坐标不要：道具在工坊里是统一的一个颜色。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { readAccessor, readGlb } from '../src/io/glbRead';

/** 包里的单位放大多少倍（椅子坐面 22 → 45 厘米，门框 1.01 → 2.02 米） */
const SCALE = 2;

/** 分组：道具栏里照这个顺序排 */
type Group = 'seat' | 'bed' | 'table' | 'other';

/**
 * 要哪几件：file 是包里的文件名（不带 .glb）。
 * turn 是绕竖直轴转多少度（让正面朝 +Z），tilt 是先绕左右的轴放倒多少度（枕头在包里是立着的），scale 是这一件另外放大多少倍
 */
const PIECES: { id: string; file: string; group: Group; turn?: number; tilt?: number; scale?: number }[] = [
  { id: 'chair', file: 'chair', group: 'seat' },
  { id: 'chairCushion', file: 'chairCushion', group: 'seat' },
  { id: 'chairRounded', file: 'chairRounded', group: 'seat' },
  { id: 'chairDesk', file: 'chairDesk', group: 'seat' },
  { id: 'stoolBar', file: 'stoolBar', group: 'seat' },
  { id: 'bench', file: 'bench', group: 'seat' },
  { id: 'loungeChair', file: 'loungeChair', group: 'seat' },
  { id: 'loungeSofa', file: 'loungeSofa', group: 'seat' },
  { id: 'loungeSofaLong', file: 'loungeSofaLong', group: 'seat' },
  { id: 'ottoman', file: 'loungeSofaOttoman', group: 'seat' },
  { id: 'bedSingle', file: 'bedSingle', group: 'bed' },
  { id: 'bedDouble', file: 'bedDouble', group: 'bed' },
  { id: 'bedBunk', file: 'bedBunk', group: 'bed' },
  { id: 'pillow', file: 'pillow', group: 'bed', tilt: -90 },
  // 餐桌在包里只有 65 厘米高，坐着腿伸不进去：放大到 75 厘米
  { id: 'table', file: 'table', group: 'table', scale: 1.15 },
  { id: 'tableRound', file: 'tableRound', group: 'table' },
  { id: 'tableCoffee', file: 'tableCoffee', group: 'table' },
  { id: 'desk', file: 'desk', group: 'table' },
  { id: 'kitchenBar', file: 'kitchenBar', group: 'table' },
  { id: 'bookcase', file: 'bookcaseOpen', group: 'table' },
  { id: 'bathtub', file: 'bathtub', group: 'other' },
  { id: 'toilet', file: 'toilet', group: 'other' },
  { id: 'stairs', file: 'stairs', group: 'other' },
  { id: 'doorway', file: 'doorwayOpen', group: 'other' },
];

interface Flat {
  positions: number[];
  normals: number[];
  indices: number[];
}

/** 读一个 GLB，照节点的摆放把所有网格拼成一整块（GLB 自己的坐标，还没放大、没挪原点） */
function flatten(buffer: ArrayBuffer): Flat {
  const doc = readGlb(buffer);
  const out: Flat = { positions: [], normals: [], indices: [] };
  const visit = (index: number, parent: Matrix4) => {
    const node = doc.json.nodes[index];
    const local = new Matrix4();
    if (node.matrix) local.fromArray(node.matrix);
    else
      local.compose(
        new Vector3(...((node.translation as number[] | undefined) ?? [0, 0, 0])),
        new Quaternion(...((node.rotation as number[] | undefined) ?? [0, 0, 0, 1])),
        new Vector3(...((node.scale as number[] | undefined) ?? [1, 1, 1])),
      );
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined) {
      const normalMatrix = new Matrix3().getNormalMatrix(world);
      // 镜像过的节点（缩放里有奇数个负数）面的绕向要反过来
      const flip = world.determinant() < 0;
      for (const prim of doc.json.meshes[node.mesh].primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) throw new Error('只认三角面');
        const pos = readAccessor(doc, prim.attributes.POSITION);
        const nor = readAccessor(doc, prim.attributes.NORMAL);
        const count = pos.length / 3;
        const idx = prim.indices !== undefined ? readAccessor(doc, prim.indices) : Float32Array.from({ length: count }, (_, i) => i);
        const at = out.positions.length / 3;
        const v = new Vector3();
        for (let i = 0; i < count; i++) {
          v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(world);
          out.positions.push(v.x, v.y, v.z);
          v.set(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]).applyMatrix3(normalMatrix).normalize();
          out.normals.push(v.x, v.y, v.z);
        }
        for (let i = 0; i < idx.length; i += 3) {
          if (flip) out.indices.push(at + idx[i], at + idx[i + 2], at + idx[i + 1]);
          else out.indices.push(at + idx[i], at + idx[i + 1], at + idx[i + 2]);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  const scene = doc.json.scenes[doc.json.scene ?? 0];
  for (const root of scene.nodes) visit(root, new Matrix4());
  return out;
}

/** 转朝向、放大、原点挪到底面正中；位置和法线都一样的点合成一个；面积是零的面丢掉 */
function tidy(flat: Flat, turn: number, tilt: number, scale: number) {
  const a = (turn * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const b = (tilt * Math.PI) / 180;
  const tc = Math.cos(b);
  const ts = Math.sin(b);
  // 先绕 X 放倒，再绕 Y 转朝向
  const spin = (x: number, y: number, z: number): [number, number, number] => {
    const y1 = y * tc - z * ts;
    const z1 = y * ts + z * tc;
    return [x * c + z1 * s, y1, -x * s + z1 * c];
  };
  const n = flat.positions.length / 3;
  const pos = new Float64Array(n * 3);
  const nor = new Float64Array(n * 3);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const p = spin(flat.positions[i * 3], flat.positions[i * 3 + 1], flat.positions[i * 3 + 2]);
    const q = spin(flat.normals[i * 3], flat.normals[i * 3 + 1], flat.normals[i * 3 + 2]);
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = p[k] * SCALE * scale;
      nor[i * 3 + k] = q[k];
    }
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], pos[i * 3 + k]);
      hi[k] = Math.max(hi[k], pos[i * 3 + k]);
    }
  }
  const shift = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  // 清单里的尺寸留到毫米：网格跟着凑成正好这么大（差不到半毫米），工坊里「原样的大小」就不用再拉伸
  const size = [0, 1, 2].map((k) => Math.round((hi[k] - lo[k]) * 1000) / 1000);
  const fit = [0, 1, 2].map((k) => (hi[k] - lo[k] > 1e-9 ? size[k] / (hi[k] - lo[k]) : 1));
  const remap = new Int32Array(n);
  const seen = new Map<string, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = [0, 1, 2].map((k) => Math.round((pos[i * 3 + k] - shift[k]) * fit[k] * 1e5) / 1e5 + 0);
    const q = [0, 1, 2].map((k) => Math.max(-127, Math.min(127, Math.round(nor[i * 3 + k] * 127))));
    const key = `${p.join(',')}|${q.join(',')}`;
    let at = seen.get(key);
    if (at === undefined) {
      at = positions.length / 3;
      seen.set(key, at);
      positions.push(...p);
      normals.push(...q);
    }
    remap[i] = at;
  }
  const indices: number[] = [];
  for (let i = 0; i < flat.indices.length; i += 3) {
    const [i0, i1, i2] = [remap[flat.indices[i]], remap[flat.indices[i + 1]], remap[flat.indices[i + 2]]];
    if (i0 === i1 || i1 === i2 || i0 === i2) continue;
    indices.push(i0, i1, i2);
  }
  if (positions.length / 3 > 65535) throw new Error('点太多，装不进 16 位的编号');
  return { positions, normals, indices, size };
}

export async function main(_args: string[], root: string) {
  const source = join(root, 'assets/source/kenney-furniture-kit/kit/Models/GLTF format');
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const pad = () => {
    const extra = (4 - (offset % 4)) % 4;
    if (extra) {
      chunks.push(new Uint8Array(extra));
      offset += extra;
    }
  };
  const push = (data: Float32Array | Int8Array | Uint16Array) => {
    chunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    offset += data.byteLength;
    pad();
  };
  const meta: { id: string; group: Group; size: number[]; vertices: number; triangles: number; at: number }[] = [];
  for (const piece of PIECES) {
    const file = readFileSync(join(source, `${piece.file}.glb`));
    const mesh = tidy(flatten(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer), piece.turn ?? 0, piece.tilt ?? 0, piece.scale ?? 1);
    meta.push({ id: piece.id, group: piece.group, size: mesh.size, vertices: mesh.positions.length / 3, triangles: mesh.indices.length / 3, at: offset });
    push(new Float32Array(mesh.positions));
    push(new Int8Array(mesh.normals));
    push(new Uint16Array(mesh.indices));
    console.log(`${piece.id.padEnd(16)} ${String(mesh.positions.length / 3).padStart(5)} 点 ${String(mesh.indices.length / 3).padStart(5)} 面  ${mesh.size.join(' × ')} 米`);
  }
  const bin = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) {
    bin.set(chunk, at);
    at += chunk.byteLength;
  }
  mkdirSync(join(root, 'public/props'), { recursive: true });
  mkdirSync(join(root, 'src/props'), { recursive: true });
  writeFileSync(join(root, 'public/props/lowpoly.bin'), bin);
  writeFileSync(
    join(root, 'src/props/lowpolyMeta.json'),
    `${JSON.stringify({ source: 'Kenney Furniture Kit 2.0 (CC0)', bytes: bin.byteLength, assets: meta }, null, 1)}\n`,
  );
  console.log(`写了 public/props/lowpoly.bin（${(bin.byteLength / 1024).toFixed(1)} KB，${meta.length} 件）和 src/props/lowpolyMeta.json`);
}
