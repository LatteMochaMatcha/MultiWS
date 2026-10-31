// 把 VRoid 旧版的女性素体（CC0）加工成工坊能用的「距离场」资源。
//
//   node tools/build-anime-body.mjs
//
// 读 assets/source/base_female/Base_Female.vrm，只取皮肤（不要衣服、头发），
// 按骨骼权重拆成头、脖子、躯干、胸、手臂、腿几块，每块封好口、采样成有符号距离的三维格子，
// 写出 public/anime/body.bin（数据）和 src/anime/bodyMeta.json（格子的尺寸、关节的位置）。
// 只用 Node 自带的模块。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, 'assets/source/base_female/Base_Female.vrm');
const OUT_BIN = resolve(root, 'public/anime/body.bin');
const OUT_META = resolve(root, 'src/anime/bodyMeta.json');

/** 距离只存到这么远（米），再远就按这个数算 */
const BAND = 0.032;

/* ---------------- 读 GLB ---------------- */

const file = readFileSync(SOURCE);
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8'));
const bin = file.subarray(20 + jsonLength + 8);

const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const READ = {
  5120: [(o) => bin.readInt8(o), 1],
  5121: [(o) => bin.readUInt8(o), 1],
  5122: [(o) => bin.readInt16LE(o), 2],
  5123: [(o) => bin.readUInt16LE(o), 2],
  5125: [(o) => bin.readUInt32LE(o), 4],
  5126: [(o) => bin.readFloatLE(o), 4],
};
function accessor(index) {
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView];
  const size = SIZE[acc.type];
  const [read, bytes] = READ[acc.componentType];
  const stride = view.byteStride || size * bytes;
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new Float64Array(acc.count * size);
  for (let i = 0; i < acc.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = read(start + i * stride + k * bytes);
  return out;
}

// VRM 0.x 的模型面朝 -Z，角色的左手边在 -X；工坊的约定是面朝 +Z、左手边在 +X：绕 Y 轴转 180°
const fix = (x, y, z) => [-x, y, -z];

/* ---------------- 骨骼 ---------------- */

const skin = gltf.skins[0];
const inverseBind = accessor(skin.inverseBindMatrices);
/** 骨骼名 → 关节在模型里的位置 */
const joints = {};
/** 蒙皮用的骨骼下标 → 骨骼名 */
const jointName = [];
skin.joints.forEach((node, j) => {
  const m = inverseBind.subarray(j * 16, j * 16 + 16);
  // 逆绑定矩阵是 [R | t]，关节的位置是 -Rᵀ·t（按列存）
  const t = [m[12], m[13], m[14]];
  const p = [
    -(m[0] * t[0] + m[1] * t[1] + m[2] * t[2]),
    -(m[4] * t[0] + m[5] * t[1] + m[6] * t[2]),
    -(m[8] * t[0] + m[9] * t[1] + m[10] * t[2]),
  ];
  const name = gltf.nodes[node].name;
  jointName[j] = name;
  joints[name] = fix(p[0], p[1], p[2]);
});

/** 每根骨骼归哪一块。L / R 是角色自己的左 / 右 */
function groupOf(name) {
  if (/^J_Sec_([LR])_Bust/.test(name)) return `bust${RegExp.$1}`;
  if (/^J_Bip_C_Head|^J_Adj_/.test(name)) return 'head';
  if (/^J_Bip_C_Neck/.test(name)) return 'neck';
  if (/^J_Bip_([LR])_(UpperArm|LowerArm|Hand|Index|Little|Middle|Ring|Thumb)/.test(name)) return `arm${RegExp.$1}`;
  if (/^J_Bip_([LR])_(UpperLeg|LowerLeg|Foot|ToeBase)/.test(name)) return `leg${RegExp.$1}`;
  return 'torso';
}
const GROUPS = ['torso', 'head', 'neck', 'bustL', 'bustR', 'armL', 'armR', 'legL', 'legR'];
const jointGroup = jointName.map((n) => GROUPS.indexOf(groupOf(n)));

/* ---------------- 皮肤网格：收集、焊接 ---------------- */

// 这三样先装素体原来的（低面数的）网格，下面「加密」以后换成加密过的
let positions = []; // 焊接后的顶点
let weights = []; // 每个顶点在各块上的权重
const lookup = new Map();
let triangles = [];

for (const mesh of gltf.meshes) {
  for (const prim of mesh.primitives) {
    const material = gltf.materials[prim.material]?.name ?? '';
    if (!material.endsWith('_SKIN')) continue;
    const pos = accessor(prim.attributes.POSITION);
    const jnt = accessor(prim.attributes.JOINTS_0);
    const wgt = accessor(prim.attributes.WEIGHTS_0);
    const idx = accessor(prim.indices);
    const remap = new Int32Array(pos.length / 3);
    for (let v = 0; v < remap.length; v++) {
      const p = fix(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      // 贴图接缝处同一个位置有好几个顶点：按 0.01 毫米取整后并成一个
      const key = p.map((c) => Math.round(c * 1e5)).join(',');
      let id = lookup.get(key);
      if (id === undefined) {
        id = positions.length;
        lookup.set(key, id);
        positions.push(p);
        const w = new Float64Array(GROUPS.length);
        for (let k = 0; k < 4; k++) w[jointGroup[jnt[v * 4 + k]]] += wgt[v * 4 + k];
        weights.push(w);
      }
      remap[v] = id;
    }
    for (let t = 0; t < idx.length; t += 3) {
      const a = remap[idx[t]];
      const b = remap[idx[t + 1]];
      const c = remap[idx[t + 2]];
      if (a !== b && b !== c && a !== c) triangles.push([a, b, c]);
    }
  }
}

/* ---------------- 加密：把低面数的折面磨圆 ---------------- */

// 素体面数很低，原样采样的话，每个面之间的折线都会留在白模上（肚子上一格一格、腿上一条一条）。
// 做法是 Loop 细分：每个三角面一分为四，新的点和原有的点都按周围的点加权平均挪一挪，分两遍。
// 细分出来的是一张光滑的曲面（不像在每个面上各自鼓一个包那样，留下一块块凸起）。
// 细分会让整个身体略微往里收：先把原有的顶点往外推一点（推几遍，让细分的极限正好落回原来的位置附近）。
// 同一套面每次细分出来的顶点编号都一样，所以不同版本（原样、平胸）之间顶点是一一对应的。
const LEVELS = 2;
/** 往外推几遍：推得越多越贴近原来的形状，但尖的地方（鼻尖、耳廓）会推过头 */
const PUSH = 3;
/** 素体原来的（低面数的）网格 */
const coarse = { positions, weights, triangles };

/** 一张网格的邻接：每条边连着哪几个面的第三个顶点，每个顶点的邻居 */
function adjacency(count, tris) {
  const edges = new Map();
  const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (const [a, b, c] of tris) {
    for (const [u, v, w] of [[a, b, c], [b, c, a], [c, a, b]]) {
      const k = key(u, v);
      const e = edges.get(k);
      if (e) e.far.push(w);
      else edges.set(k, { a: Math.min(u, v), b: Math.max(u, v), far: [w] });
    }
  }
  const near = Array.from({ length: count }, () => new Set());
  // 开口、三个面以上共用的边算「边界」：边界上的点只跟着边界走
  const rim = Array.from({ length: count }, () => []);
  for (const e of edges.values()) {
    near[e.a].add(e.b);
    near[e.b].add(e.a);
    if (e.far.length !== 2) {
      rim[e.a].push(e.b);
      rim[e.b].push(e.a);
    }
  }
  return { edges, near, rim, key };
}

/** 原有的顶点在细分的极限曲面上落在哪（Loop 的极限位置） */
function limitOf(at, adj) {
  return at.map((p, v) => {
    const rim = adj.rim[v];
    if (rim.length === 2) return p.map((c, k) => (4 * c + at[rim[0]][k] + at[rim[1]][k]) / 6);
    if (rim.length) return [...p];
    const n = adj.near[v].size;
    if (!n) return [...p];
    const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
    const chi = 1 / (3 / (8 * beta) + n);
    const sum = [0, 0, 0];
    for (const u of adj.near[v]) for (let k = 0; k < 3; k++) sum[k] += at[u][k];
    return p.map((c, k) => (1 - n * chi) * c + chi * sum[k]);
  });
}

/** Loop 细分一遍：位置和权重都照同一套系数 */
function loopOnce({ positions: at, weights: w, triangles: tris }) {
  const count = at.length;
  const adj = adjacency(count, tris);
  const groups = w[0].length;
  const mix = (terms) => {
    const p = [0, 0, 0];
    const q = new Float64Array(groups);
    for (const [v, f] of terms) {
      for (let k = 0; k < 3; k++) p[k] += at[v][k] * f;
      for (let g = 0; g < groups; g++) q[g] += w[v][g] * f;
    }
    return [p, q];
  };
  const positions = [];
  const weights = [];
  for (let v = 0; v < count; v++) {
    const rim = adj.rim[v];
    const n = adj.near[v].size;
    let terms;
    if (rim.length === 2) terms = [[v, 3 / 4], [rim[0], 1 / 8], [rim[1], 1 / 8]];
    else if (rim.length || !n) terms = [[v, 1]];
    else {
      const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
      terms = [[v, 1 - n * beta], ...[...adj.near[v]].map((u) => [u, beta])];
    }
    const [p, q] = mix(terms);
    positions.push(p);
    weights.push(q);
  }
  const mid = new Map();
  for (const [k, e] of adj.edges) {
    const terms = e.far.length === 2 ? [[e.a, 3 / 8], [e.b, 3 / 8], [e.far[0], 1 / 8], [e.far[1], 1 / 8]] : [[e.a, 1 / 2], [e.b, 1 / 2]];
    const [p, q] = mix(terms);
    mid.set(k, positions.length);
    positions.push(p);
    weights.push(q);
  }
  const triangles = [];
  for (const [a, b, c] of tris) {
    const ab = mid.get(adj.key(a, b));
    const bc = mid.get(adj.key(b, c));
    const ca = mid.get(adj.key(c, a));
    triangles.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
  }
  return { positions, weights, triangles };
}

// 素体身上的顶点本身就一高一低（肚子上一棱一棱像腹肌、背上几道竖棱、肩头几个包）：
// 原模型靠法线把它们「画」成光滑的，变成距离场以后法线就没了，棱全露出来。
// 所以先把顶点磨一磨（Taubin：往邻居的正中挪一步、再往回退一点点，起伏磨平了，整体不缩）。
// 头不磨：脸上的五官（鼻子、嘴、眼窝的边）都是这种小起伏，磨了就没了；脖子往上渐渐不磨
const RELAX = { passes: 14, lambda: 0.5, mu: -0.53 };
function relaxed(base, adj) {
  const head = GROUPS.indexOf('head');
  const neck = GROUPS.indexOf('neck');
  const strength = coarse.weights.map((w) => Math.max(0, 1 - w[head] - 0.5 * w[neck]));
  let at = base.map((p) => [...p]);
  for (let pass = 0; pass < RELAX.passes; pass++) {
    for (const f of [RELAX.lambda, RELAX.mu]) {
      at = at.map((p, v) => {
        const n = adj.near[v].size;
        if (!n || adj.rim[v].length || !strength[v]) return p;
        const mid = [0, 0, 0];
        for (const u of adj.near[v]) for (let k = 0; k < 3; k++) mid[k] += at[u][k] / n;
        return p.map((c, k) => c + f * strength[v] * (mid[k] - c));
      });
    }
  }
  return at;
}

/**
 * 把低面数的网格加密。base 是各顶点的位置（素体原样，或者改过形状的版本），面和权重用素体原来的。
 */
function refine(base) {
  const adj = adjacency(base.length, coarse.triangles);
  const smooth = relaxed(base, adj);
  // 往外推：控制点 += 原来的位置 - 现在的极限位置
  const control = smooth.map((p) => [...p]);
  for (let pass = 0; pass < PUSH; pass++) {
    const limit = limitOf(control, adj);
    for (let v = 0; v < control.length; v++) for (let k = 0; k < 3; k++) control[v][k] += smooth[v][k] - limit[v][k];
  }
  let mesh = { positions: control, weights: coarse.weights, triangles: coarse.triangles };
  for (let level = 0; level < LEVELS; level++) mesh = loopOnce(mesh);
  // 细分出来的点再挪到极限曲面上（原有的点和新的点都挪：不挪的话还有一点点折角）
  const fine = adjacency(mesh.positions.length, mesh.triangles);
  return { ...mesh, positions: limitOf(mesh.positions, fine) };
}
({ positions, weights, triangles } = refine(coarse.positions));

/* ---------------- 拆块、封口 ---------------- */

/**
 * 一块：三角面平均下来在 groups 这些块上的权重 ≥ threshold 就算进来。
 * at：顶点的位置，缺省就是素体原样；做「平胸」这类改过形状的版本时传改过的那一份
 */
function piece(groups, threshold, veto = [], at = positions) {
  const ids = groups.map((g) => GROUPS.indexOf(g));
  const no = veto.map(([g, limit]) => [GROUPS.indexOf(g), limit]);
  const tris = triangles.filter((tri) => {
    let w = 0;
    for (const v of tri) for (const g of ids) w += weights[v][g];
    if (w / 3 < threshold) return false;
    for (const [g, limit] of no) {
      if ((weights[tri[0]][g] + weights[tri[1]][g] + weights[tri[2]][g]) / 3 >= limit) return false;
    }
    return true;
  });
  return capped(tris, 0, at);
}

/**
 * 把一块的开口封上：找出只有一个面用到的边，连成圈，每个圈用一个扇面盖住。
 * recess：小的开口（眼睛、嘴）盖子的中心往里缩一点，看起来像眼窝。
 */
/** 眼睛、嘴的盖子中间垫几圈（凹成浅碟） */
const DISH_RINGS = 3;
function capped(tris, recess = 0, at = positions) {
  const verts = [];
  const local = new Map();
  const use = (v) => {
    let id = local.get(v);
    if (id === undefined) {
      id = verts.length;
      local.set(v, id);
      verts.push([...at[v]]);
    }
    return id;
  };
  const faces = tris.map((t) => t.map(use));
  const half = new Map();
  for (const [a, b, c] of faces) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) half.set(`${u},${v}`, [u, v]);
  }
  // 开口的边：正向有、反向没有。反着走，盖子的面才朝外
  const next = new Map();
  for (const [u, v] of half.values()) {
    if (half.has(`${v},${u}`)) continue;
    const list = next.get(v);
    if (list) list.push(u);
    else next.set(v, [u]);
  }
  const loops = [];
  /** 每个开口的盖子：中心和大小 */
  const holes = [];
  for (const start of next.keys()) {
    // 两个开口可能正好在一个顶点上碰头：走回路径上已有的顶点时，把这一圈单独切下来
    const path = [start];
    while (path.length) {
      const out = next.get(path[path.length - 1]);
      if (!out?.length) {
        path.pop();
        continue;
      }
      const to = out.pop();
      const at = path.indexOf(to);
      if (at < 0) {
        path.push(to);
        continue;
      }
      const loop = path.splice(at + 1);
      loop.unshift(to);
      if (loop.length >= 3) loops.push(loop);
    }
  }
  for (const loop of loops) {
    const c = [0, 0, 0];
    for (const v of loop) for (let k = 0; k < 3; k++) c[k] += verts[v][k] / loop.length;
    const radius = Math.max(...loop.map((v) => Math.hypot(verts[v][0] - c[0], verts[v][1] - c[1], verts[v][2] - c[2])));
    if (recess && radius < 0.03) {
      // 眼睛、嘴的开口：盖成往里凹的一个浅碟（边上陡、中间平），眼皮的边看得出来。眼睛的凹得深一些
      const depth = radius > 0.018 ? recess * 3 : recess * 1.75;
      const rings = [loop];
      for (let j = 1; j <= DISH_RINGS; j++) {
        const t = j / (DISH_RINGS + 1);
        const sink = depth * (1 - (1 - t) ** 2);
        rings.push(
          loop.map((v) => {
            const p = verts[v].map((x, k) => x + (c[k] - x) * t);
            p[2] -= sink;
            verts.push(p);
            return verts.length - 1;
          }),
        );
      }
      c[2] -= depth;
      const center = verts.length;
      verts.push(c);
      for (let j = 0; j + 1 < rings.length; j++) {
        const [a, b] = [rings[j], rings[j + 1]];
        for (let i = 0; i < a.length; i++) {
          const i1 = (i + 1) % a.length;
          faces.push([a[i], a[i1], b[i1]], [a[i], b[i1], b[i]]);
        }
      }
      const last = rings[rings.length - 1];
      for (let i = 0; i < last.length; i++) faces.push([last[i], last[(i + 1) % last.length], center]);
      holes.push({ center: [...c], radius });
      continue;
    }
    const center = verts.length;
    verts.push(c);
    for (let i = 0; i < loop.length; i++) faces.push([loop[i], loop[(i + 1) % loop.length], center]);
    holes.push({ center: [...c], radius });
  }
  return { verts, faces, loops: loops.length, holes };
}

/* ---------------- 采样成距离场 ---------------- */

/** 点到三角形的距离的平方 */
function distance2(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  let q;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const t = d1 / (d1 - d3);
        q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
      } else {
        const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
        const d5 = dot(ab, cp);
        const d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const t = d2 / (d2 - d6);
            q = [a[0] + ac[0] * t, a[1] + ac[1] * t, a[2] + ac[2] * t];
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
              q = [b[0] + (c[0] - b[0]) * t, b[1] + (c[1] - b[1]) * t, b[2] + (c[2] - b[2]) * t];
            } else {
              const den = 1 / (va + vb + vc);
              const v = vb * den;
              const w = vc * den;
              q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
            }
          }
        }
      }
    }
  }
  return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
}

/**
 * 把一块封闭的网格采样成有符号距离的格子。origin 是这一块自己的原点（关节），格子的坐标相对它。
 * 里外：沿三个轴各打一遍射线数穿过几次，三取二（个别缝隙只会骗过一个方向）。
 * 距离：表面附近精确算，远处一圈圈往外推（够用了：远处只在融合圆角里用得到）。
 */
function sample({ verts, faces }, origin, cell, frame) {
  const pts = verts.map((p) => [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]]);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p[k]);
    hi[k] = Math.max(hi[k], p[k]);
  }
  const margin = BAND + cell;
  // frame：和另一块用同样的格子（两块之间要逐格插值时）
  const min = frame ? frame.min : lo.map((v) => v - margin);
  const dims = frame ? frame.dims : hi.map((v, k) => Math.ceil((v + margin - min[k]) / cell) + 1);
  const [nx, ny, nz] = dims;
  const n = nx * ny * nz;
  const at = (i, j, k) => i + nx * (j + ny * k);

  // 里外
  const votes = new Uint8Array(n);
  const jitter = cell * 1e-4; // 射线稍微偏一点，免得正好擦着边
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const columns = new Map();
    for (const f of faces) {
      const [a, b, c] = f.map((i) => pts[i]);
      const u0 = Math.max(0, Math.ceil((Math.min(a[u], b[u], c[u]) - min[u]) / cell - 1));
      const u1 = Math.min(dims[u] - 1, Math.floor((Math.max(a[u], b[u], c[u]) - min[u]) / cell + 1));
      const v0 = Math.max(0, Math.ceil((Math.min(a[v], b[v], c[v]) - min[v]) / cell - 1));
      const v1 = Math.min(dims[v] - 1, Math.floor((Math.max(a[v], b[v], c[v]) - min[v]) / cell + 1));
      const area = (b[u] - a[u]) * (c[v] - a[v]) - (b[v] - a[v]) * (c[u] - a[u]);
      if (Math.abs(area) < 1e-14) continue;
      for (let iu = u0; iu <= u1; iu++) {
        const pu = min[u] + iu * cell + jitter;
        for (let iv = v0; iv <= v1; iv++) {
          const pv = min[v] + iv * cell + jitter * 1.618;
          const w0 = ((b[u] - pu) * (c[v] - pv) - (b[v] - pv) * (c[u] - pu)) / area;
          const w1 = ((c[u] - pu) * (a[v] - pv) - (c[v] - pv) * (a[u] - pu)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const key = iu + dims[u] * iv;
          const list = columns.get(key);
          const depth = w0 * a[axis] + w1 * b[axis] + w2 * c[axis];
          if (list) list.push(depth);
          else columns.set(key, [depth]);
        }
      }
    }
    for (const [key, list] of columns) {
      list.sort((p, q) => p - q);
      const iu = key % dims[u];
      const iv = (key - iu) / dims[u];
      const index = [0, 0, 0];
      index[u] = iu;
      index[v] = iv;
      let crossed = 0;
      for (let i = 0; i < dims[axis]; i++) {
        const depth = min[axis] + i * cell;
        while (crossed < list.length && list[crossed] < depth) crossed++;
        if (crossed % 2) {
          index[axis] = i;
          votes[at(index[0], index[1], index[2])]++;
        }
      }
    }
  }

  // 表面附近的精确距离
  const dist = new Float32Array(n).fill(1e9);
  const reach = cell * 2.5;
  for (const f of faces) {
    const [a, b, c] = f.map((i) => pts[i]);
    const r0 = [0, 1, 2].map((k) => Math.max(0, Math.floor((Math.min(a[k], b[k], c[k]) - reach - min[k]) / cell)));
    const r1 = [0, 1, 2].map((k) => Math.min(dims[k] - 1, Math.ceil((Math.max(a[k], b[k], c[k]) + reach - min[k]) / cell)));
    for (let k = r0[2]; k <= r1[2]; k++) {
      for (let j = r0[1]; j <= r1[1]; j++) {
        for (let i = r0[0]; i <= r1[0]; i++) {
          const d = Math.sqrt(distance2([min[0] + i * cell, min[1] + j * cell, min[2] + k * cell], a, b, c));
          const id = at(i, j, k);
          if (d < dist[id]) dist[id] = d;
        }
      }
    }
  }
  // 往外推：每个格点看一圈邻居，谁近就从谁那里加上一步的距离。正着扫一遍、倒着扫一遍，来两轮
  const steps = [];
  for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (di || dj || dk) steps.push([di, dj, dk, Math.hypot(di, dj, dk) * cell]);
  }
  for (let round = 0; round < 2; round++) {
    for (const dir of [1, -1]) {
      for (let kk = 0; kk < nz; kk++) {
        const k = dir > 0 ? kk : nz - 1 - kk;
        for (let jj = 0; jj < ny; jj++) {
          const j = dir > 0 ? jj : ny - 1 - jj;
          for (let ii = 0; ii < nx; ii++) {
            const i = dir > 0 ? ii : nx - 1 - ii;
            const id = at(i, j, k);
            let best = dist[id];
            for (const [di, dj, dk, len] of steps) {
              const a = i + di;
              const b = j + dj;
              const c = k + dk;
              if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
              const d = dist[at(a, b, c)] + len;
              if (d < best) best = d;
            }
            dist[id] = best;
          }
        }
      }
    }
  }

  let inside = 0;
  for (let i = 0; i < n; i++) {
    if (votes[i] >= 2) {
      inside++;
      dist[i] = -dist[i];
    }
  }
  return {
    min: min.map((v) => +v.toFixed(6)),
    dims,
    cell,
    // 有符号距离，没有截断（后面还要在它上面加工）；存盘时再压成 16 位
    signed: dist,
    // 表面实际占的范围（不含留白）
    bounds: { min: lo.map((v) => +v.toFixed(5)), max: hi.map((v) => +v.toFixed(5)) },
    volume: inside * cell ** 3,
  };
}

/** 存盘用：距离截到 ±BAND，压成 16 位整数 */
function packed(signed) {
  const data = new Int16Array(signed.length);
  for (let i = 0; i < signed.length; i++) {
    data[i] = Math.round((Math.max(-BAND, Math.min(BAND, signed[i])) / BAND) * 32767);
  }
  return data;
}

/** 在格子里按位置取距离（三线性插值）。p 是这一块自己的坐标 */
function valueAt(grid, p) {
  const [nx, ny, nz] = grid.dims;
  const f = [0, 1, 2].map((k) => Math.max(0, Math.min(grid.dims[k] - 1.001, (p[k] - grid.min[k]) / grid.cell)));
  const i = Math.floor(f[0]);
  const j = Math.floor(f[1]);
  const k = Math.floor(f[2]);
  const tx = f[0] - i;
  const ty = f[1] - j;
  const tz = f[2] - k;
  const at = (a, b, c) => grid.signed[a + nx * (b + ny * c)];
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(
    lerp(lerp(at(i, j, k), at(i + 1, j, k), tx), lerp(at(i, j + 1, k), at(i + 1, j + 1, k), tx), ty),
    lerp(lerp(at(i, j, k + 1), at(i + 1, j, k + 1), tx), lerp(at(i, j + 1, k + 1), at(i + 1, j + 1, k + 1), tx), ty),
    tz,
  );
}

/**
 * 「开运算」：先往里缩 r、再往外长回来。比 2r 薄的东西（耳朵）缩没了就长不回来，厚的地方不变。
 * 返回加工后的有符号距离；mask(x, y, z) 是 0 … 1，只在它不为 0 的地方生效。
 */
function withoutThin(grid, r, mask) {
  const { dims, cell, signed, min } = grid;
  const [nx, ny, nz] = dims;
  const n = signed.length;
  const at = (i, j, k) => i + nx * (j + ny * k);
  // 缩过以后还剩下的部分
  const kept = (id) => signed[id] < -r;
  const far = new Float32Array(n).fill(1e9);
  const steps = [];
  for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (di || dj || dk) steps.push([di, dj, dk, Math.hypot(di, dj, dk) * cell]);
  }
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const id = at(i, j, k);
    if (kept(id)) {
      far[id] = 0;
      continue;
    }
    // 紧挨着剩下部分的格点：离它的距离可以直接从原来的距离推出来，比数格子准
    for (const [di, dj, dk] of steps) {
      const a = i + di;
      const b = j + dj;
      const c = k + dk;
      if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
      if (kept(at(a, b, c))) {
        far[id] = Math.max(0, signed[id] + r);
        break;
      }
    }
  }
  for (let round = 0; round < 2; round++) {
    for (const dir of [1, -1]) {
      for (let kk = 0; kk < nz; kk++) {
        const k = dir > 0 ? kk : nz - 1 - kk;
        for (let jj = 0; jj < ny; jj++) {
          const j = dir > 0 ? jj : ny - 1 - jj;
          for (let ii = 0; ii < nx; ii++) {
            const i = dir > 0 ? ii : nx - 1 - ii;
            const id = at(i, j, k);
            let best = far[id];
            if (best === 0) continue;
            for (const [di, dj, dk, len] of steps) {
              const a = i + di;
              const b = j + dj;
              const c = k + dk;
              if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
              const d = far[at(a, b, c)] + len;
              if (d < best) best = d;
            }
            far[id] = best;
          }
        }
      }
    }
  }
  const out = new Float32Array(n);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const id = at(i, j, k);
    const m = mask(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
    const opened = kept(id) ? signed[id] : far[id] - r;
    out[id] = m > 0 ? signed[id] + m * (Math.max(opened, signed[id]) - signed[id]) : signed[id];
  }
  return out;
}

/* ---------------- 各块 ---------------- */

const J = (name) => joints[name];
const headTris = piece(['head'], 0.5);
const headTop = Math.max(...headTris.verts.map((p) => p[1]));
// 下巴：脸正面（靠前的那一半）最低的地方
const front = Math.max(...headTris.verts.map((p) => p[2]));
const chin = Math.min(...headTris.verts.filter((p) => p[2] > front - 0.05).map((p) => p[1]));
const backOfHead = Math.min(...headTris.verts.map((p) => p[2]));
// 头自己的原点：上下取下巴和头顶的正中；前后取脑袋最厚处的中点再往前一点（和白模的头一个约定）
const headOrigin = [0, (chin + headTop) / 2, (front + backOfHead) / 2 + 0.012];

const specs = [
  // 躯干在肩关节那里就收住（手臂占到一半的地方）：再往外是手臂的，手臂放下来时不会在肩上留一截「肩章」。
  // 手臂那一块从四成的地方开始，两块叠着一小段：摆在原位时，各自封口的盖子都埋在对方里面。
  // 胸留在躯干上不切下来（切下来以后胸口的大洞封不平）；另外单独的那一块「胸」是给第二排、放大时用的
  {
    name: 'torso',
    mesh: piece(['torso', 'bustL', 'bustR'], 0.3, [['armL', 0.5], ['armR', 0.5]]),
    origin: [0, 0, 0],
    cell: 0.005,
  },
  { name: 'head', mesh: capped(triangles.filter((t) => (weights[t[0]][1] + weights[t[1]][1] + weights[t[2]][1]) / 3 >= 0.5), 0.004), origin: headOrigin, cell: 0.004 },
  { name: 'neck', mesh: piece(['neck'], 0.25), origin: J('J_Bip_C_Neck'), cell: 0.004 },
  { name: 'bust', mesh: piece(['bustL'], 0.2), origin: J('J_Sec_L_Bust1'), cell: 0.004 },
  { name: 'arm', mesh: piece(['armL'], 0.4), origin: J('J_Bip_L_UpperArm'), cell: 0.004 },
  { name: 'leg', mesh: piece(['legL'], 0.3), origin: J('J_Bip_L_UpperLeg'), cell: 0.005 },
];

// 调试：DUMP=<目录> 时把每一块封好口的网格写成 OBJ
if (process.env.DUMP) {
  for (const spec of specs) {
    const lines = spec.mesh.verts.map((p) => `v ${p[0]} ${p[1]} ${p[2]}`);
    for (const f of spec.mesh.faces) lines.push(`f ${f[0] + 1} ${f[1] + 1} ${f[2] + 1}`);
    writeFileSync(resolve(process.env.DUMP, `${spec.name}.obj`), lines.join('\n'));
  }
}

const grids = {};
const chunks = [];
let offset = 0;
/** 把一块格子记进结果里。grid：sample() 的结果；signed：要存的距离（缺省就是 grid 自己的） */
function store(name, origin, grid, holes, signed = grid.signed, bounds = grid.bounds) {
  const data = packed(signed);
  grids[name] = {
    origin: origin.map((v) => +v.toFixed(6)),
    min: grid.min,
    dims: grid.dims,
    cell: grid.cell,
    bounds,
    // 封口的盖子（相对这一块自己的原点）：摆位时要知道切口在哪
    caps: holes.map((hole) => ({
      center: hole.center.map((v, k) => +(v - origin[k]).toFixed(5)),
      radius: +hole.radius.toFixed(5),
    })),
    offset,
    length: data.length,
  };
  chunks.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  offset += data.length;
}
/** 采样好的各块，后面做变体时还要用 */
const sampled = {};
for (const spec of specs) {
  const t0 = performance.now();
  const grid = sample(spec.mesh, spec.origin, spec.cell);
  sampled[spec.name] = grid;
  store(spec.name, spec.origin, grid, spec.mesh.holes);
  console.log(
    `${spec.name.padEnd(6)} ${spec.mesh.faces.length} 面，封了 ${spec.mesh.loops} 个口，格子 ${grid.dims.join('×')}，体积 ${(grid.volume * 1000).toFixed(2)} 升，${Math.round(performance.now() - t0)} ms`,
  );
  for (const hole of spec.mesh.holes) {
    console.log(`         口 (${hole.center.map((v) => v.toFixed(3)).join(', ')}) 半径 ${hole.radius.toFixed(3)}`);
  }
}

/* ---------------- 变体：平胸的躯干、没有人耳的头 ---------------- */

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 平胸的躯干：在素体原来的（低面数的）网格上，把跟着胸骨骼动的那一片像绷一张膜一样抹平——
// 这一片里每个顶点反复挪到邻居的正中间，边上的顶点不动；再把这一片连同外面两圈一起轻轻磨几遍，
// 免得膜和周围的皮肤接出一圈折痕。然后和原样的躯干一样加密、拆块、采样。
// 格子和原样的躯干完全一样，运行时在两份之间逐格插值，胸就能从原样一路调到平。
{
  const t0 = performance.now();
  const BL = GROUPS.indexOf('bustL');
  const BR = GROUPS.indexOf('bustR');
  // 胸的骨骼占到一成以上的顶点才算「胸」：再往外的那一圈权重很小，一直蔓延到腋下和上臂，不能跟着抹
  const BUST_EDGE = 0.1;
  const count = coarse.positions.length;
  const near = Array.from({ length: count }, () => new Set());
  for (const [a, b, c] of coarse.triangles) {
    near[a].add(b).add(c);
    near[b].add(a).add(c);
    near[c].add(a).add(b);
  }
  // 没有邻居的顶点是别的材质（内衣）留下的，皮肤的面用不到它们，跳过
  const chest = [];
  for (let v = 0; v < count; v++) {
    if (near[v].size && coarse.weights[v][BL] + coarse.weights[v][BR] > BUST_EDGE) chest.push(v);
  }
  const flat = coarse.positions.map((p) => [...p]);
  const average = (v) => {
    const sum = [0, 0, 0];
    for (const n of near[v]) for (let k = 0; k < 3; k++) sum[k] += flat[n][k] / near[v].size;
    return sum;
  };
  for (let pass = 0; pass < 400; pass++) for (const v of chest) flat[v] = average(v);
  // 往外再扩两圈
  const wide = new Set(chest);
  for (let ring = 0; ring < 2; ring++) for (const v of [...wide]) for (const n of near[v]) wide.add(n);
  for (let pass = 0; pass < 6; pass++) {
    const next = new Map();
    for (const v of wide) {
      const to = average(v);
      next.set(v, flat[v].map((c, k) => c + (to[k] - c) * 0.5));
    }
    for (const [v, p] of next) flat[v] = p;
  }
  let deepest = 0;
  for (const v of chest) deepest = Math.max(deepest, coarse.positions[v][2] - flat[v][2]);
  const torso = sampled.torso;
  const mesh = piece(['torso', 'bustL', 'bustR'], 0.3, [['armL', 0.5], ['armR', 0.5]], refine(flat).positions);
  const grid = sample(mesh, [0, 0, 0], torso.cell, { min: torso.min, dims: torso.dims });
  store('torsoFlat', [0, 0, 0], grid, mesh.holes);
  console.log(
    `torsoFlat 抹平了 ${chest.length} 个顶点，最多往回 ${(deepest * 100).toFixed(1)} 厘米，体积 ${(torso.volume * 1000).toFixed(2)} → ${(grid.volume * 1000).toFixed(2)} 升，${Math.round(performance.now() - t0)} ms`,
  );
}

// 没有人耳的头：加了兽耳、精灵耳时用。耳朵是薄片，在头两侧做一次「开运算」就没了，颅骨不受影响
{
  const t0 = performance.now();
  const head = sampled.head;
  // 耳根比耳廓厚，半径要取到 1.2 厘米才去得干净
  const signed = withoutThin(head, 0.012, (x) => smooth(0.055, 0.068, Math.abs(x)));
  // 表面实际占的范围：数一遍在里面的格点
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const [nx, ny] = head.dims;
  let inside = 0;
  for (let id = 0; id < signed.length; id++) {
    if (signed[id] >= 0) continue;
    inside++;
    const index = [id % nx, Math.floor(id / nx) % ny, Math.floor(id / (nx * ny))];
    for (let k = 0; k < 3; k++) {
      const at = head.min[k] + index[k] * head.cell;
      lo[k] = Math.min(lo[k], at - head.cell / 2);
      hi[k] = Math.max(hi[k], at + head.cell / 2);
    }
  }
  const headSpec = specs.find((s) => s.name === 'head');
  store('headBare', headSpec.origin, head, headSpec.mesh.holes, signed, {
    min: lo.map((v) => +v.toFixed(5)),
    max: hi.map((v) => +v.toFixed(5)),
  });
  console.log(
    `headBare  半宽 ${head.bounds.max[0].toFixed(3)} → ${hi[0].toFixed(3)}，体积 ${(head.volume * 1000).toFixed(2)} → ${(inside * head.cell ** 3 * 1000).toFixed(2)} 升，${Math.round(performance.now() - t0)} ms`,
  );
}

const round = (p) => p.map((v) => +v.toFixed(5));
const meta = {
  source: 'VRoid Studio (old beta) base model, female. CC0. https://vroid.pixiv.help/hc/en-us/articles/4402614652569',
  band: BAND,
  height: +headTop.toFixed(5),
  head: { top: +headTop.toFixed(5), chin: +chin.toFixed(5), front: +front.toFixed(5), back: +backOfHead.toFixed(5) },
  grids,
  joints: Object.fromEntries(Object.entries(joints).filter(([name]) => name.startsWith('J_')).map(([name, p]) => [name, round(p)])),
};
mkdirSync(dirname(OUT_BIN), { recursive: true });
mkdirSync(dirname(OUT_META), { recursive: true });
writeFileSync(OUT_BIN, Buffer.concat(chunks));
writeFileSync(OUT_META, `${JSON.stringify(meta, null, 1)}\n`);
console.log(`写出 ${OUT_BIN}（${(offset * 2 / 1024 / 1024).toFixed(2)} MB）和 ${OUT_META}`);
