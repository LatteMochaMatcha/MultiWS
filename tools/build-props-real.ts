// 把 Poly Haven 的写实家具（CC0，assets/source/polyhaven-props/）转成工坊的写实款道具：
//   node tools/run.mjs tools/build-props-real.ts
//
// 写出：
//   .props-store/<SHA-256>        每件一个文件（网格、材质、贴图，排法见 src/props/realFile.ts），文件名就是内容的 SHA-256；
//                                 不进仓库、不进安装包，发版时传到下载站的 props/ 目录下，工坊里点了才下
//   src/props/realMeta.json       清单：每件的编号、分组、原样多大、文件多大、SHA-256，和下载站的地址
//
// 做的事：照 glTF 里节点的摆放把各块网格拼成一整块；需要的转个朝向（正面朝 +Z，和角色面朝的方向一样）；
// 原点挪到底面正中；位置、法线、贴图坐标都一样的点合成一个；每个材质的面排在一起；
// 贴图用下载下来的 1K 那一档，原样装进去；面多的另外做一份碰撞用的粗网格（减面）。
// 小图（public/props/real/<编号>.webp，随安装包走）不在这里做：转好以后在开发服务器的页面上截图，
// 再用 tools/prop-thumbs.py 抠底、缩小，见 assets/source/README.md。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { type GlbDoc, readAccessor } from '../src/io/glbRead';
import { type RealAssetFile, type RealGroup, type RealMaterial, type RealTexture, encodeRealAsset, parseRealAsset } from '../src/props/realFile';

type Group = 'seat' | 'bed' | 'table' | 'other';

/**
 * 要哪几件：file 是 Poly Haven 上的编号（下载下来的文件夹是 polyhaven-<file>）。
 * turn 是绕竖直轴转多少度（让正面朝 +Z），scale 是这一件另外放大多少倍（原件就是真实的尺寸，一般不用）。
 * drop 是不要的材质（那批面丢掉）：长沙发底下的流苏要靠透明度的贴图，1K 那一档里没有，画出来是一片片实心的板
 */
const PIECES: { id: string; file: string; group: Group; turn?: number; scale?: number; drop?: string[] }[] = [
  // 这一件、还有下面标了 scale 的几件，原件比真东西大一圈（坐面 55–65 厘米、桌面 80–88 厘米）：缩到坐面 43–50、桌面 75 上下
  { id: 'armchairModern', file: 'modern_arm_chair_01', group: 'seat', scale: 0.8 },
  { id: 'schoolChair', file: 'SchoolChair_01', group: 'seat', scale: 0.85 },
  { id: 'schoolDesk', file: 'SchoolDesk_01', group: 'table', scale: 0.85 },
  { id: 'sofaLeather', file: 'sofa_02', group: 'seat' },
  { id: 'bedGothic', file: 'GothicBed_01', group: 'bed' },
  { id: 'tableCloth', file: 'dining_table', group: 'table', scale: 0.93 },
  { id: 'stoolWood', file: 'bar_chair_round_01', group: 'seat' },
  { id: 'benchWood', file: 'painted_wooden_bench', group: 'seat', scale: 0.75 },
  { id: 'dayBed', file: 'vintage_day_bed', group: 'bed' },
  { id: 'swivelChair', file: 'mid_century_lounge_chair', group: 'seat' },
  { id: 'rockingChair', file: 'Rockingchair_01', group: 'seat' },
  { id: 'picnicTable', file: 'wooden_picnic_table', group: 'table' },
  { id: 'tableRoundWood', file: 'round_wooden_table_02', group: 'table' },
  { id: 'armchairChinese', file: 'chinese_armchair', group: 'seat', scale: 0.77 },
  { id: 'deskMetal', file: 'metal_office_desk', group: 'table', scale: 0.95 },
  { id: 'sofaFabric', file: 'sofa_03', group: 'seat', scale: 0.85, drop: ['sofa_03_fringe'] },
];

/** 碰撞用的粗网格最多多少个面；面比这少的不另做，直接用它自己的网格 */
const TOUCH_BUDGET = 1500;
/** 粗网格最多偏离原来的表面多少（米）：从小到大试，试到面数够少为止 */
const TOUCH_ERRORS = [0.004, 0.008, 0.012, 0.016, 0.02];

interface Flat {
  positions: number[];
  normals: number[];
  uvs: number[];
  /** 每个面三个下标，和它用第几个材质 */
  faces: { a: number; b: number; c: number; material: number }[];
}

function findGltf(dir: string): string {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      try {
        return findGltf(path);
      } catch {
        // 这个子文件夹里没有：接着找别的
      }
    } else if (extname(name).toLowerCase() === '.gltf') return path;
  }
  throw new Error(`${dir} 里没找到 .gltf`);
}

/** 读 .gltf 和它旁边的 .bin */
function readGltf(path: string): GlbDoc {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  if (json.buffers?.length !== 1) throw new Error(`${path}：只认一个 .bin 的 glTF`);
  const bin = readFileSync(join(dirname(path), decodeURIComponent(json.buffers[0].uri)));
  return { json, bin: new DataView(bin.buffer, bin.byteOffset, bin.byteLength) };
}

/** 照节点的摆放把所有网格拼成一整块（glTF 自己的坐标，还没转朝向、没挪原点） */
function flatten(doc: GlbDoc, drop: readonly string[]): Flat {
  const out: Flat = { positions: [], normals: [], uvs: [], faces: [] };
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
        if (drop.includes(doc.json.materials?.[prim.material ?? 0]?.name)) continue;
        const pos = readAccessor(doc, prim.attributes.POSITION);
        const nor = readAccessor(doc, prim.attributes.NORMAL);
        const uv = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(doc, prim.attributes.TEXCOORD_0) : new Float32Array((pos.length / 3) * 2);
        const count = pos.length / 3;
        const idx = prim.indices !== undefined ? readAccessor(doc, prim.indices) : Float32Array.from({ length: count }, (_, i) => i);
        const at = out.positions.length / 3;
        const v = new Vector3();
        for (let i = 0; i < count; i++) {
          v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(world);
          out.positions.push(v.x, v.y, v.z);
          v.set(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]).applyMatrix3(normalMatrix).normalize();
          out.normals.push(v.x, v.y, v.z);
          out.uvs.push(uv[i * 2], uv[i * 2 + 1]);
        }
        const material = prim.material ?? 0;
        for (let i = 0; i < idx.length; i += 3) {
          if (flip) out.faces.push({ a: at + idx[i], b: at + idx[i + 2], c: at + idx[i + 1], material });
          else out.faces.push({ a: at + idx[i], b: at + idx[i + 1], c: at + idx[i + 2], material });
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  const scene = doc.json.scenes[doc.json.scene ?? 0];
  for (const root of scene.nodes) visit(root, new Matrix4());
  return out;
}

/** 转朝向、放大、原点挪到底面正中；一样的点合成一个；面积是零的面丢掉；同一个材质的面排在一起 */
function tidy(flat: Flat, turn: number, scale: number) {
  const a = (turn * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const spin = (x: number, y: number, z: number): [number, number, number] => [x * c + z * s, y, -x * s + z * c];
  const n = flat.positions.length / 3;
  const pos = new Float64Array(n * 3);
  const nor = new Float64Array(n * 3);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const p = spin(flat.positions[i * 3], flat.positions[i * 3 + 1], flat.positions[i * 3 + 2]);
    const q = spin(flat.normals[i * 3], flat.normals[i * 3 + 1], flat.normals[i * 3 + 2]);
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = p[k] * scale;
      nor[i * 3 + k] = q[k];
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
  const uvs: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = [0, 1, 2].map((k) => Math.round((pos[i * 3 + k] - shift[k]) * fit[k] * 1e5) / 1e5 + 0);
    const q = [0, 1, 2].map((k) => Math.max(-127, Math.min(127, Math.round(nor[i * 3 + k] * 127))));
    const w = [Math.round(flat.uvs[i * 2] * 1e5) / 1e5 + 0, Math.round(flat.uvs[i * 2 + 1] * 1e5) / 1e5 + 0];
    const key = `${p.join(',')}|${q.join(',')}|${w.join(',')}`;
    let at = seen.get(key);
    if (at === undefined) {
      at = positions.length / 3;
      seen.set(key, at);
      positions.push(...p);
      normals.push(...q.map((v) => v / 127));
      uvs.push(...w);
    }
    remap[i] = at;
  }
  const used = [...new Set(flat.faces.map((f) => f.material))].sort((x, y) => x - y);
  const indices: number[] = [];
  const groups: (RealGroup & { source: number })[] = [];
  for (const material of used) {
    const start = indices.length;
    for (const f of flat.faces) {
      if (f.material !== material) continue;
      const [i0, i1, i2] = [remap[f.a], remap[f.b], remap[f.c]];
      if (i0 === i1 || i1 === i2 || i0 === i2) continue;
      indices.push(i0, i1, i2);
    }
    if (indices.length > start) groups.push({ start, count: indices.length - start, material: groups.length, source: material });
  }
  return { positions, normals, uvs, indices, groups, size };
}

/**
 * 碰撞用的粗网格：位置一样的点先并成一个（贴图接缝两边本来是分开的），再用 meshoptimizer 减面
 * （它是 three 的类型包带进来的，没单独装；哪天没有了这里会报错，到时候再装）。
 * 减到面数够少、或者再减就要偏离原来的表面超过限度为止；限度从小到大试，零碎的小块（螺丝、雕花）去掉
 */
async function coarsen(positions: number[], indices: number[]) {
  const { MeshoptSimplifier } = await import('meshoptimizer');
  await MeshoptSimplifier.ready;
  const n = positions.length / 3;
  const seen = new Map<string, number>();
  const remap = new Int32Array(n);
  const welded: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    const key = p.map((v) => Math.round(v * 1e4)).join(',');
    let at = seen.get(key);
    if (at === undefined) {
      at = welded.length / 3;
      seen.set(key, at);
      welded.push(...p);
    }
    remap[i] = at;
  }
  const faces: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [remap[indices[i]], remap[indices[i + 1]], remap[indices[i + 2]]];
    if (a !== b && b !== c && a !== c) faces.push(a, b, c);
  }
  const points = new Float32Array(welded);
  let best: { indices: Uint32Array; error: number } | null = null;
  for (const error of TOUCH_ERRORS) {
    const [out] = MeshoptSimplifier.simplify(Uint32Array.from(faces), points, 3, TOUCH_BUDGET * 3, error, ['ErrorAbsolute', 'Prune', 'Permissive']);
    best = { indices: out, error };
    if (out.length / 3 <= TOUCH_BUDGET) break;
  }
  // 只留用到的点
  const used = new Map<number, number>();
  const outIndices = Uint32Array.from(best!.indices, (i) => {
    let at = used.get(i);
    if (at === undefined) used.set(i, (at = used.size));
    return at;
  });
  const outPoints = new Float32Array(used.size * 3);
  for (const [from, to] of used) for (let k = 0; k < 3; k++) outPoints[to * 3 + k] = points[from * 3 + k];
  return { positions: outPoints, indices: outIndices, error: best!.error };
}

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

export async function main(_args: string[], root: string) {
  const source = join(root, 'assets/source/polyhaven-props');
  const store = join(root, '.props-store');
  rmSync(store, { recursive: true, force: true });
  mkdirSync(store, { recursive: true });
  const config = JSON.parse(readFileSync(join(root, 'tools/update/config.json'), 'utf8'));
  const meta: { id: string; group: Group; size: number[]; vertices: number; triangles: number; bytes: number; sha256: string }[] = [];
  for (const piece of PIECES) {
    const dir = join(source, `polyhaven-${piece.file}`);
    if (!existsSync(dir)) throw new Error(`没有 ${dir}：这一件还没下载`);
    const path = findGltf(dir);
    const doc = readGltf(path);
    const mesh = tidy(flatten(doc, piece.drop ?? []), piece.turn ?? 0, piece.scale ?? 1);

    // 贴图：同一张图只装一次
    const textures: RealTexture[] = [];
    const textureOf = new Map<string, number>();
    const uriOf = (ref: { index: number }) => decodeURIComponent(doc.json.images[doc.json.textures[ref.index].source].uri as string);
    const texture = (ref: { index: number } | undefined): number | undefined => {
      if (!ref) return undefined;
      const uri = uriOf(ref);
      let at = textureOf.get(uri);
      if (at === undefined) {
        const mime = MIME[extname(uri).toLowerCase()];
        if (!mime) throw new Error(`${piece.id}：不认这种贴图 ${uri}`);
        at = textures.length;
        textureOf.set(uri, at);
        textures.push({ mime, bytes: new Uint8Array(readFileSync(join(dirname(path), uri))) });
      }
      return at;
    };
    const materials: RealMaterial[] = mesh.groups.map((g) => {
      const m = doc.json.materials?.[g.source] ?? {};
      const pbr = m.pbrMetallicRoughness ?? {};
      const factor = (pbr.baseColorFactor as number[] | undefined) ?? [1, 1, 1, 1];
      const map = texture(pbr.baseColorTexture);
      const normal = texture(m.normalTexture);
      const arm = texture(pbr.metallicRoughnessTexture);
      return {
        name: String(m.name ?? `m${g.source}`),
        ...(map === undefined ? {} : { map }),
        ...(normal === undefined ? {} : { normal }),
        ...(arm === undefined ? {} : { arm }),
        // Poly Haven 的三合一贴图（文件名里带 _arm_）红色通道是缝隙里的暗
        ...(arm !== undefined && /_arm_/.test(uriOf(pbr.metallicRoughnessTexture)) ? { ao: true as const } : {}),
        color: [factor[0], factor[1], factor[2]],
        roughness: pbr.roughnessFactor ?? 1,
        metalness: pbr.metallicFactor ?? 1,
        ...(m.doubleSided ? { doubleSided: true } : {}),
      };
    });

    const triangles = mesh.indices.length / 3;
    const touch = triangles > TOUCH_BUDGET ? await coarsen(mesh.positions, mesh.indices) : null;
    const file: RealAssetFile = {
      id: piece.id,
      size: mesh.size as [number, number, number],
      positions: new Float32Array(mesh.positions),
      normals: new Float32Array(mesh.normals),
      uvs: new Float32Array(mesh.uvs),
      indices: Uint32Array.from(mesh.indices),
      groups: mesh.groups.map(({ start, count, material }) => ({ start, count, material })),
      materials,
      textures,
      ...(touch ? { touch: { positions: touch.positions, indices: touch.indices } } : {}),
    };
    const bytes = encodeRealAsset(file);
    // 写出去以前自己读一遍：读不回来的不要
    parseRealAsset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(store, sha256), bytes);
    meta.push({ id: piece.id, group: piece.group, size: mesh.size, vertices: mesh.positions.length / 3, triangles, bytes: bytes.byteLength, sha256 });
    console.log(
      `${piece.id.padEnd(16)} ${String(mesh.positions.length / 3).padStart(6)} 点 ${String(triangles).padStart(6)} 面  ${mesh.size.join(' × ')} 米  ` +
        `${materials.length} 个材质 ${textures.length} 张贴图  ${(bytes.byteLength / 1048576).toFixed(2)} MB` +
        (touch ? `  粗网格 ${touch.indices.length / 3} 面（最多偏 ${Math.round(touch.error * 1000)} 毫米）` : ''),
    );
  }
  writeFileSync(
    join(root, 'src/props/realMeta.json'),
    `${JSON.stringify({ source: 'Poly Haven (CC0)', store: `${config.sources[0].base}props/`, assets: meta }, null, 1)}\n`,
  );
  console.log(`写了 .props-store/（${meta.length} 件，共 ${(meta.reduce((n, m) => n + m.bytes, 0) / 1048576).toFixed(1)} MB）和 src/props/realMeta.json`);
}
