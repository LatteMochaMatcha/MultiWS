// 把几个现成模型（pixiv 以 CC0 发布的 VRoid 旧版样例）的头发单独取出来，存成工坊能换到成品角色头上的小文件。
//
//   node tools/build-hair.mjs
//
// 读 assets/source 下面的 VRM，只留头发那一块网格、它用的材质和贴图、头发的骨骼（连同头的那一根），
// 写成 public/character/hair/<名字>.glb。文件还是 VRM 0.x 的摆法（面朝 -Z），工坊照读成品角色的办法读它。
// 另外量好原主人的头有多大、头的关节在哪，记在文件的 extras 里：换到别人头上时照这个对齐、缩放。
//
// 同一副头发再做一份给白模人台和二次元素体用的：没有贴图，存成「到头发面片有多远」的三维格子
// （public/hair/<名字>.bin，尺寸记在 src/hair/hairMeta.json）。工坊把离面片几毫米以内的地方当成实心，
// 和头融合成一整块。这一份已经摆到二次元素体的头上了（坐标是素体的头自己的坐标），头发里自带的兽耳不算在内。
// 只用 Node 自带的模块。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'public/character/hair');
const OUT_SHAPE = resolve(root, 'public/hair');
const OUT_META = resolve(root, 'src/hair/hairMeta.json');

/** 格子的间距；距离只存到 BAND 这么远；格子比头发四周多留出 MARGIN */
const CELL = 0.005;
const BAND = 0.024;
const MARGIN = 0.03;

/**
 * id 要和 src/model/spec.ts 的 HAIR_STYLES 对上。
 * dye：染发时改哪几种材质（头发本身；发夹、丝带不算）；
 * ears：这个发型自带一副兽耳（做在头发里的），是头发网格最前面的这么多批面。它们另用一份名字带 _EAR 的材质，
 *       工坊里加了兽耳就能把自带的整副去掉；
 * dark：这副头发的颜色是直接画在贴图里的深色，光改材质的底色染不浅——染的时候要借一张浅色的头发贴图来用
 */
const HAIRS = [
  { id: 'long', source: 'sendagaya_shino/Sendagaya Shino.vrm', dye: /_HAIR_01$/ },
  { id: 'sidetail', source: 'avatarsample_g/AvatarSample_G.vrm', dye: /_HAIR_0[12]$/ },
  { id: 'bob', source: 'avatarsample_d_darkness/AvatarSample_D_Darkness.vrm', dye: /_HAIR_01$/ },
  // 猫耳是前 6 批面：左右各一片背面、一片正面（头发的材质），加一片粉色的耳内
  { id: 'twintails', source: 'hairsample_female/HairSample_Female.vrm', dye: /_HAIR_01$/, ears: 6, dark: true },
];

const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function build({ id, source, dye, ears = 0, dark }) {
  const file = readFileSync(resolve(root, 'assets/source', source));
  const jsonLength = file.readUInt32LE(12);
  const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8'));
  const bin = file.subarray(20 + jsonLength + 8);
  const READ = {
    5120: [(o) => bin.readInt8(o), 1, 127],
    5121: [(o) => bin.readUInt8(o), 1, 255],
    5122: [(o) => bin.readInt16LE(o), 2, 32767],
    5123: [(o) => bin.readUInt16LE(o), 2, 65535],
    5125: [(o) => bin.readUInt32LE(o), 4, 1],
    5126: [(o) => bin.readFloatLE(o), 4, 1],
  };
  const cache = new Map();
  const accessor = (index) => {
    let out = cache.get(index);
    if (out) return out;
    const acc = gltf.accessors[index];
    const view = gltf.bufferViews[acc.bufferView];
    const size = SIZE[acc.type];
    const [read, bytes, unit] = READ[acc.componentType];
    const stride = view.byteStride || size * bytes;
    const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
    const scale = acc.normalized ? 1 / unit : 1;
    out = new Float64Array(acc.count * size);
    for (let i = 0; i < acc.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = read(start + i * stride + k * bytes) * scale;
    cache.set(index, out);
    return out;
  };

  /* ---- 骨骼：头，和头下面的头发骨骼 ---- */
  const skin = gltf.skins[0];
  const inverseBind = accessor(skin.inverseBindMatrices);
  const jointOfNode = new Map(skin.joints.map((node, j) => [node, j]));
  const parentOf = new Map();
  gltf.nodes.forEach((node, i) => (node.children ?? []).forEach((child) => parentOf.set(child, i)));
  const headNode = gltf.nodes.findIndex((node) => node.name === 'J_Bip_C_Head');
  if (headNode < 0) throw new Error(`${source}：没找到头的骨骼`);
  /** 关节在文件里的位置（VRM 0.x 的骨骼不带旋转：逆绑定矩阵的平移取反就是） */
  const jointAt = (node) => {
    const j = jointOfNode.get(node);
    return [-inverseBind[j * 16 + 12], -inverseBind[j * 16 + 13], -inverseBind[j * 16 + 14]];
  };
  const kept = [headNode];
  for (let i = 0; i < kept.length; i++) {
    for (const child of gltf.nodes[kept[i]].children ?? []) {
      if (/^HairJoint-/.test(gltf.nodes[child].name ?? '') && jointOfNode.has(child)) kept.push(child);
    }
  }
  const newJoint = new Map(kept.map((node, j) => [node, j]));
  /** 头和它下面所有的骨骼（量头的大小时用） */
  const onHead = new Set([headNode]);
  for (const node of onHead) for (const child of gltf.nodes[node].children ?? []) onHead.add(child);

  /* ---- 头发的网格：同一种材质的并成一批 ---- */
  /** 材质下标 → 这一批的顶点和面 */
  const batches = new Map();
  /** 头有多大：头顶、下巴、最宽、最靠前、最靠后（工坊的摆法：面朝 +Z） */
  const size = { top: -Infinity, chin: Infinity, wide: 0, front: -Infinity, back: Infinity };
  for (const mesh of gltf.meshes) {
    const isHair = /^Hair/i.test(mesh.name ?? '');
    for (const [order, prim] of mesh.primitives.entries()) {
      const a = prim.attributes;
      const position = accessor(a.POSITION);
      const joints = accessor(a.JOINTS_0);
      const weights = accessor(a.WEIGHTS_0);
      const index = accessor(prim.indices);
      const material = gltf.materials[prim.material];
      if (!isHair) {
        // 不是头发：顺便量头的大小（大半跟着头走的点）
        const face = /Face.*SKIN/i.test(material.name ?? '');
        for (const v of new Set(index)) {
          let sum = 0;
          let head = 0;
          for (let k = 0; k < 4; k++) {
            const w = weights[v * 4 + k];
            sum += w;
            if (onHead.has(skin.joints[joints[v * 4 + k]])) head += w;
          }
          if (!(sum > 0) || head / sum <= 0.5) continue;
          const [x, y, z] = [-position[v * 3], position[v * 3 + 1], -position[v * 3 + 2]];
          if (face && y < size.chin) size.chin = y;
          size.top = Math.max(size.top, y);
          size.wide = Math.max(size.wide, Math.abs(x));
          size.front = Math.max(size.front, z);
          size.back = Math.min(size.back, z);
        }
        continue;
      }
      const normal = a.NORMAL === undefined ? null : accessor(a.NORMAL);
      const uv = a.TEXCOORD_0 === undefined ? null : accessor(a.TEXCOORD_0);
      // 自带的兽耳单放一批（同一种材质也分开）
      const ear = order < ears;
      const key = `${prim.material}${ear ? ':ear' : ''}`;
      let batch = batches.get(key);
      if (!batch) {
        batch = { material: prim.material, ear, remap: new Map(), positions: [], normals: [], uvs: [], joints: [], weights: [], indices: [] };
        batches.set(key, batch);
      }
      for (const v of index) {
        const key = `${a.POSITION}/${v}`;
        let to = batch.remap.get(key);
        if (to === undefined) {
          to = batch.remap.size;
          batch.remap.set(key, to);
          batch.positions.push(position[v * 3], position[v * 3 + 1], position[v * 3 + 2]);
          batch.normals.push(normal ? normal[v * 3] : 0, normal ? normal[v * 3 + 1] : 1, normal ? normal[v * 3 + 2] : 0);
          batch.uvs.push(uv ? uv[v * 2] : 0, uv ? uv[v * 2 + 1] : 0);
          // 头发只跟着头和头发的骨骼；万一带着别的骨骼的权重，都归到头上。同一根骨骼只占一格
          const slots = new Map();
          let sum = 0;
          for (let k = 0; k < 4; k++) {
            const w = weights[v * 4 + k];
            if (!(w > 0)) continue;
            const joint = newJoint.get(skin.joints[joints[v * 4 + k]]) ?? 0;
            slots.set(joint, (slots.get(joint) ?? 0) + w);
            sum += w;
          }
          if (!slots.size) {
            slots.set(0, 1);
            sum = 1;
          }
          const list = [...slots].sort((p, q) => q[1] - p[1]);
          for (let k = 0; k < 4; k++) {
            batch.joints.push(list[k] ? list[k][0] : 0);
            batch.weights.push(list[k] ? list[k][1] / sum : 0);
          }
        }
        batch.indices.push(to);
      }
    }
  }
  if (!batches.size) throw new Error(`${source}：没找到头发的网格`);

  /* ---- 写 GLB ---- */
  const chunks = [];
  let length = 0;
  const bufferViews = [];
  const accessors = [];
  const pushView = (bytes, target) => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      length += pad;
    }
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    length += bytes.byteLength;
    return bufferViews.length - 1;
  };
  const pushAccessor = (array, type, componentType, target, bounds = false) => {
    const count = array.length / SIZE[type];
    const acc = { bufferView: pushView(array, target), componentType, count, type };
    if (bounds) {
      acc.min = [Infinity, Infinity, Infinity];
      acc.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < array.length; i++) {
        acc.min[i % 3] = Math.min(acc.min[i % 3], array[i]);
        acc.max[i % 3] = Math.max(acc.max[i % 3], array[i]);
      }
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  const images = [];
  const textures = [];
  const imageOf = new Map();
  const useTexture = (index) => {
    const from = gltf.textures[index].source;
    let image = imageOf.get(from);
    if (image === undefined) {
      const info = gltf.images[from];
      const view = gltf.bufferViews[info.bufferView];
      const bytes = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
      image = images.length;
      imageOf.set(from, image);
      images.push({ name: info.name ?? `Hair_${image}`, mimeType: info.mimeType ?? 'image/png', bufferView: pushView(new Uint8Array(bytes)) });
    }
    textures.push({ source: image });
    return textures.length - 1;
  };

  const materials = [];
  const primitives = [];
  const earNames = [];
  const dyeNames = [];
  let vertices = 0;
  let triangles = 0;
  for (const batch of batches.values()) {
    const m = gltf.materials[batch.material];
    const pbr = m.pbrMetallicRoughness ?? {};
    const name = batch.ear ? `${m.name}_EAR` : m.name;
    if (batch.ear) earNames.push(name);
    if (dye?.test(m.name ?? '')) dyeNames.push(name);
    materials.push({
      name,
      pbrMetallicRoughness: {
        baseColorFactor: pbr.baseColorFactor ?? [1, 1, 1, 1],
        ...(pbr.baseColorTexture ? { baseColorTexture: { index: useTexture(pbr.baseColorTexture.index) } } : {}),
        metallicFactor: 0,
        roughnessFactor: 0.9,
      },
      alphaMode: m.alphaMode ?? 'OPAQUE',
      ...(m.alphaCutoff === undefined ? {} : { alphaCutoff: m.alphaCutoff }),
      doubleSided: Boolean(m.doubleSided),
    });
    primitives.push({
      attributes: {
        POSITION: pushAccessor(Float32Array.from(batch.positions), 'VEC3', 5126, 34962, true),
        NORMAL: pushAccessor(Float32Array.from(batch.normals), 'VEC3', 5126, 34962),
        TEXCOORD_0: pushAccessor(Float32Array.from(batch.uvs), 'VEC2', 5126, 34962),
        JOINTS_0: pushAccessor(Uint16Array.from(batch.joints), 'VEC4', 5123, 34962),
        WEIGHTS_0: pushAccessor(Float32Array.from(batch.weights), 'VEC4', 5126, 34962),
      },
      indices: pushAccessor(Uint32Array.from(batch.indices), 'SCALAR', 5125, 34963),
      material: materials.length - 1,
    });
    vertices += batch.positions.length / 3;
    triangles += batch.indices.length / 3;
  }

  const inverse = new Float32Array(kept.length * 16);
  const nodes = kept.map((node, j) => {
    const at = jointAt(node);
    inverse.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -at[0], -at[1], -at[2], 1], j * 16);
    const up = j ? jointAt(parentOf.get(node)) : [0, 0, 0];
    const children = (gltf.nodes[node].children ?? []).filter((child) => newJoint.has(child)).map((child) => newJoint.get(child));
    return { name: gltf.nodes[node].name, translation: [at[0] - up[0], at[1] - up[1], at[2] - up[2]], ...(children.length ? { children } : {}) };
  });
  nodes.push({ name: 'Hair', mesh: 0, skin: 0 });

  // 贴着头皮的那一层底色（画在身体的网格上，这里不带走，只记下颜色）
  const backMaterial = gltf.materials.find((m) => /HairBack/i.test(m.name ?? ''));
  const headAt = jointAt(headNode);
  const round = (v) => Math.round(v * 1e5) / 1e5;
  const meta = gltf.extensions?.VRM?.meta ?? {};
  const json = {
    asset: { version: '2.0', generator: 'oc-basemesh tools/build-hair.mjs' },
    extras: {
      ocHair: {
        id,
        title: meta.title ?? '',
        from: source,
        // 都换成工坊的摆法：面朝 +Z，角色的左手边是 +X
        head: {
          joint: [round(-headAt[0]), round(headAt[1]), round(-headAt[2])],
          top: round(size.top),
          chin: round(size.chin),
          wide: round(size.wide),
          front: round(size.front),
          back: round(size.back),
        },
        scalp: backMaterial?.pbrMetallicRoughness?.baseColorFactor?.slice(0, 3).map(round) ?? null,
        dye: dyeNames,
        ears: earNames,
        dark: Boolean(dark),
      },
    },
    scene: 0,
    scenes: [{ nodes: [0, nodes.length - 1] }],
    nodes,
    meshes: [{ name: 'Hair', primitives }],
    skins: [{ joints: kept.map((_, j) => j), inverseBindMatrices: pushAccessor(inverse, 'MAT4', 5126) }],
    materials,
    textures,
    images,
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: 0 }],
  };
  for (const texture of textures) texture.sampler = 0;

  const tail = (4 - (length % 4)) % 4;
  if (tail) {
    chunks.push(Buffer.alloc(tail));
    length += tail;
  }
  json.buffers[0].byteLength = length;
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + 8 + length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(text.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  const out = Buffer.concat([header, jsonHead, text, binHead, ...chunks]);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `${id}.glb`), out);
  console.log(
    `${id}.glb  ${(out.length / 1024).toFixed(0)} KB  ${vertices} 顶点 ${triangles} 面  ${materials.length} 种材质 ${images.length} 张贴图  ${kept.length - 1} 根头发骨骼` +
      `  头高 ${(size.top - size.chin).toFixed(4)} 宽 ${(2 * size.wide).toFixed(4)}  ← ${meta.title ?? source}`,
  );
  return {
    id,
    // 头发的面片（文件里的坐标），自带的兽耳不要
    meshes: [...batches.values()].filter((batch) => !batch.ear),
    joint: headAt,
    size,
  };
}

/* ---------------- 给白模用的那一份：到头发面片的距离 ---------------- */

const body = JSON.parse(readFileSync(resolve(root, 'src/anime/bodyMeta.json'), 'utf8'));
/** 素体的头有多高；头的关节在头自己坐标里的位置（头的原点在下巴和头顶的正中） */
const ANIME_HEAD = body.head.top - body.head.chin;
const ANIME_JOINT = body.joints.J_Bip_C_Head.map((v, k) => v - body.grids.head.origin[k]);

/** 点 p 到三角形 abc 的距离的平方（Ericson，《Real-Time Collision Detection》5.1.5） */
function distance2(px, py, pz, a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = px - a[0], apy = py - a[1], apz = pz - a[2];
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) [qx, qy, qz] = a;
  else {
    const bpx = px - b[0], bpy = py - b[1], bpz = pz - b[2];
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) [qx, qy, qz] = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        qx = a[0] + v * abx; qy = a[1] + v * aby; qz = a[2] + v * abz;
      } else {
        const cpx = px - c[0], cpy = py - c[1], cpz = pz - c[2];
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) [qx, qy, qz] = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            qx = a[0] + w * acx; qy = a[1] + w * acy; qz = a[2] + w * acz;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              qx = b[0] + w * (c[0] - b[0]); qy = b[1] + w * (c[1] - b[1]); qz = b[2] + w * (c[2] - b[2]);
            } else {
              const denom = 1 / (va + vb + vc);
              const v = vb * denom;
              const w = vc * denom;
              qx = a[0] + abx * v + acx * w; qy = a[1] + aby * v + acy * w; qz = a[2] + abz * v + acz * w;
            }
          }
        }
      }
    }
  }
  return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}

function shape({ id, meshes, joint, size }) {
  // 摆到素体的头上：换成工坊的摆法（面朝 +Z），头的关节对上头的关节，再按两个头的高度之比缩放
  const fit = ANIME_HEAD / (size.top - size.chin);
  const place = (x, y, z) => [
    ANIME_JOINT[0] + (-x + joint[0]) * fit,
    ANIME_JOINT[1] + (y - joint[1]) * fit,
    ANIME_JOINT[2] + (-z + joint[2]) * fit,
  ];
  const triangles = [];
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    const points = [];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const p = place(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]);
      points.push(p);
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[k]);
        hi[k] = Math.max(hi[k], p[k]);
      }
    }
    for (let i = 0; i < mesh.indices.length; i += 3) triangles.push([points[mesh.indices[i]], points[mesh.indices[i + 1]], points[mesh.indices[i + 2]]]);
  }
  const min = lo.map((v) => Math.floor((v - MARGIN) / CELL) * CELL);
  const dims = hi.map((v, k) => Math.ceil((v + MARGIN - min[k]) / CELL) + 1);
  const [nx, ny, nz] = dims;
  const field = new Float32Array(nx * ny * nz).fill(BAND * BAND);
  for (const [a, b, c] of triangles) {
    const from = [0, 1, 2].map((k) => Math.max(0, Math.floor((Math.min(a[k], b[k], c[k]) - BAND - min[k]) / CELL)));
    const to = [0, 1, 2].map((k) => Math.min(dims[k] - 1, Math.ceil((Math.max(a[k], b[k], c[k]) + BAND - min[k]) / CELL)));
    for (let k = from[2]; k <= to[2]; k++) {
      const z = min[2] + k * CELL;
      for (let j = from[1]; j <= to[1]; j++) {
        const y = min[1] + j * CELL;
        for (let i = from[0]; i <= to[0]; i++) {
          const at = i + nx * (j + ny * k);
          const d = distance2(min[0] + i * CELL, y, z, a, b, c);
          if (d < field[at]) field[at] = d;
        }
      }
    }
  }
  const data = new Int16Array(field.length);
  for (let i = 0; i < data.length; i++) data[i] = Math.round((Math.sqrt(field[i]) / BAND) * 32767);
  mkdirSync(OUT_SHAPE, { recursive: true });
  writeFileSync(resolve(OUT_SHAPE, `${id}.bin`), Buffer.from(data.buffer));
  const round = (v) => Math.round(v * 1e5) / 1e5;
  // 头顶对得准不准：原主人的头顶摆过来以后，应该正好落在素体的头顶上
  const top = place(0, size.top, 0)[1];
  console.log(
    `${id}.bin  ${(data.byteLength / 1024).toFixed(0)} KB  ${dims.join('×')} 格  ${triangles.length} 面` +
      `  头顶差 ${((top - ANIME_HEAD / 2) * 1000).toFixed(1)} mm  占 ${lo.map((v, k) => `${v.toFixed(3)}…${hi[k].toFixed(3)}`).join(' / ')}`,
  );
  return { min: min.map(round), dims, length: data.length, bounds: { min: lo.map(round), max: hi.map(round) } };
}

const grids = {};
for (const hair of HAIRS) grids[hair.id] = shape(build(hair));
mkdirSync(dirname(OUT_META), { recursive: true });
writeFileSync(OUT_META, `${JSON.stringify({ cell: CELL, band: BAND, grids }, null, 1)}\n`);
