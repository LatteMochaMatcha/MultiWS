/**
 * 挖空（field.ts 的 Clearance）是为了让两张皮不长在一起：阴茎夹在大腿中间、贴着肚子，照原样融合它和它们是同一张皮，
 * 一摆姿势就扯碎，所以先把它周围挖开一圈（见 geometry/genital.ts 的 genitalRooms）。
 * 可挖出来的槽不该留在身上：阴茎粗、胯又挤的时候，大腿内侧被挖出半根阴茎那么深的一道沟，腿一张开，
 * 沟壁一头跟着腿走、一头留在原地，裆部扯出一道道皮。
 *
 * 所以网格出来以后把槽填回去：槽壁上的顶点挪回它所在的那个部件原来的表面（那里在阴茎里面，静止时被它盖着），
 * 网格怎么连的不变——阴茎和大腿还是分开的两张皮，只在根部连着，和分部件时一样各是完整的。
 * 挪过的顶点记在 FusedMesh.restored 里：它们是大腿、肚子上的皮，算权重时不能因为离阴茎近就算成阴茎的（见 bindPose.ts）。
 *
 * 纯函数，在 Web Worker 和单元测试里都能跑。
 */
import { type CompiledField, evalPrims } from './field';
import type { FusedMesh } from './surfaceNets';

/** 往表面上挪时，一步最多挪几个体素、最多挪几步、离表面不到几个体素算到了 */
const STEP = { most: 1.5, rounds: 16, near: 0.03 };
/** 求梯度时左右各探出去几个体素 */
const PROBE = 0.3;
/** 在别的部件里面不到这么多个体素的不算槽壁（融合的圆角上本来就有这么点出入） */
const INSIDE = 0.2;
/** 说得出是哪个部件的皮的槽壁（见 restoreCarved 的 prefer），最多挪这么远回它的表面 */
const HINTED = 0.2;

/**
 * 从 (x, y, z) 沿着 dist 这个场（里面是负的）的梯度挪到它的表面上。离出发的地方不超过 most 就到了的返回 true，
 * p、n 是挪到的位置和那里的法线；挪不到（梯度没了、走远了、走了太多步还没到）返回 false，p、n 不动。
 * toward：梯度没了的地方（采样出来的格子只记表面里外三厘米多，再往里是平的）改朝这个方向（单位向量）走，走到有梯度的地方为止；
 * 给了它就多给些步数
 */
export function landOn(
  dist: (x: number, y: number, z: number) => number,
  voxel: number,
  x: number,
  y: number,
  z: number,
  most: number,
  p: number[],
  n: number[],
  toward?: ArrayLike<number>,
): boolean {
  const h = PROBE * voxel;
  let px = x;
  let py = y;
  let pz = z;
  const rounds = toward ? STEP.rounds + Math.ceil(most / (STEP.most * voxel)) : STEP.rounds;
  for (let round = 0; round < rounds; round++) {
    const d = dist(px, py, pz);
    let gx = dist(px + h, py, pz) - dist(px - h, py, pz);
    let gy = dist(px, py + h, pz) - dist(px, py - h, pz);
    let gz = dist(px, py, pz + h) - dist(px, py, pz - h);
    const g = Math.hypot(gx, gy, gz);
    if (!(g > 1e-9)) {
      if (!toward || d >= 0) return false;
      px += toward[0] * STEP.most * voxel;
      py += toward[1] * STEP.most * voxel;
      pz += toward[2] * STEP.most * voxel;
      if (Math.hypot(px - x, py - y, pz - z) > most) return false;
      continue;
    }
    gx /= g;
    gy /= g;
    gz /= g;
    if (Math.abs(d) < STEP.near * voxel) {
      if (Math.hypot(px - x, py - y, pz - z) > most) return false;
      p[0] = px;
      p[1] = py;
      p[2] = pz;
      n[0] = gx;
      n[1] = gy;
      n[2] = gz;
      return true;
    }
    // 场不一定是准的距离（采样出来的格子、圆滑过的）：照梯度的大小折算，一步不超过 STEP.most 个体素
    const step = Math.max(-STEP.most * voxel, Math.min(STEP.most * voxel, d / (g / (2 * h))));
    px -= gx * step;
    py -= gy * step;
    pz -= gz * step;
    if (Math.hypot(px - x, py - y, pz - z) > most) return false;
  }
  return false;
}

/**
 * 把 field 里挖空的那几处（carve 的 Clearance）槽壁上的顶点挪回原来的表面，就地改 mesh 的顶点、法线，
 * 挪过的顶点记进 mesh.restored。缝上去的手脚（mesh.bound 起的那些）不动。field 是只带着这几处挖空的那个场
 */
export function restoreCarved(mesh: FusedMesh, field: CompiledField, prefer?: (x: number, y: number, z: number, toward: number[]) => number): FusedMesh {
  const clear = field.clear?.filter((c) => c.carve && c.list.length) ?? [];
  const owned = field.owned;
  if (!clear.length || !owned) return mesh;
  const voxel = mesh.info.voxel;
  const plain: CompiledField = { ...field, clear: undefined };
  const at = (list: Int32Array, x: number, y: number, z: number) => evalPrims(plain, list, list.length, x, y, z);

  // 每个部件自己的基本体和包围盒
  const parts = [...owned.values()].map((list) => {
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const i of list) {
      for (let q = 0; q < 3; q++) {
        box[q] = Math.min(box[q], field.box[i * 6 + q]);
        box[q + 3] = Math.max(box[q + 3], field.box[i * 6 + q + 3]);
      }
    }
    return { list, box };
  });
  // 每一处：护着的那个部件以外的所有基本体（升序）、别的部件、这一处不挖的那几个部件（同一段圆柱、carve 是 false 的）合起来的基本体
  const rooms = clear.map((c) => {
    const mine = new Set(c.list);
    const kept = new Set<number>();
    if (!c.spare) for (const k of field.clear ?? []) if (!k.carve && k.a === c.a && k.length === c.length) for (const i of k.list) kept.add(i);
    return {
      c,
      others: field.all.filter((i) => !mine.has(i)),
      parts: parts.filter((p) => p.list !== c.list && p.list[0] !== c.list[0]),
      kept: kept.size ? field.all.filter((i) => kept.has(i)) : null,
    };
  });

  const { positions, normals } = mesh;
  const limit = mesh.bound ? mesh.bound.start : positions.length / 3;
  const restored: number[] = [];
  /** 挪之前各在哪（每个 3 个数） */
  const from: number[] = [];
  /** 其中收到「它长着的那块身体」表面上的 */
  const floor: number[] = [];
  /** 其中照 prefer 说的挪回那个部件表面的 */
  const hinted: number[] = [];
  /** 沿着 list 这个场的梯度挪到它的表面上；挪得到返回 true，p、n 是挪到的位置和法线 */
  const p = [0, 0, 0];
  const n = [0, 0, 0];
  let landing: Int32Array = field.all;
  const dist = (x: number, y: number, z: number) => at(landing, x, y, z);
  const land = (list: Int32Array, x: number, y: number, z: number, most: number, toward?: number[]): boolean => {
    landing = list;
    return landOn(dist, voxel, x, y, z, most, p, n, toward);
  };
  const toward = [0, 0, 0];

  for (let v = 0; v < limit; v++) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    for (const { c, others, parts: around, kept } of rooms) {
      const dx = x - c.a[0];
      const dy = y - c.a[1];
      const dz = z - c.a[2];
      const along = dx * c.axis[0] + dy * c.axis[1] + dz * c.axis[2];
      const radial = Math.sqrt(Math.max(dx * dx + dy * dy + dz * dz - along * along, 0));
      // 槽壁都在圆柱里面（挖的是「部件胀大一圈」和圆柱的交集）
      if (Math.max(-along, along - c.length, radial - c.radius) > voxel) continue;
      // 在护着的那个部件的表面上的不是槽壁
      if (at(c.list, x, y, z) < 0.5 * c.margin) continue;
      // 不在别的部件里面：这里本来就是表面，没挖过
      if (at(others, x, y, z) > -INSIDE * voxel) continue;
      // 先往「别的部件合起来」的表面上挪（贴着的肚子上那道浅槽）；够不着（夹在两条大腿中间，合起来的表面在老远），
      // 就挪回它自己那个部件的表面：在里面最浅的那个
      const most = c.radius;
      // 说得出这里的皮是哪个部件的（大腿之间切开的地方：刀哪一边就是哪条腿的，见 legSlit.ts），又确实在它里面：挪回它自己的表面
      const hint = prefer ? owned.get(prefer(x, y, z, toward)) : undefined;
      let done = hint !== undefined && hint !== c.list && at(hint, x, y, z) < -INSIDE * voxel && land(hint, x, y, z, HINTED, toward);
      if (done) hinted.push(v);
      // 根部那一截（有不挖的部件：它长着的那块身体）：槽壁收到那块身体的表面上，根部周围就是一圈身体的皮，不留两片竖着的大腿内侧
      if (!done && kept !== null && land(kept, x, y, z, c.length + c.margin)) {
        done = true;
        floor.push(v);
      }
      if (!done) done = land(others, x, y, z, Math.min(most, 2 * c.margin));
      if (!done) {
        let best: Int32Array | null = null;
        let shallow = -Infinity;
        for (const part of around) {
          const { box, list } = part;
          if (x < box[0] || y < box[1] || z < box[2] || x > box[3] || y > box[4] || z > box[5]) continue;
          const d = at(list, x, y, z);
          if (d < 0 && d > shallow) {
            shallow = d;
            best = list;
          }
        }
        done = best !== null && land(best, x, y, z, most);
      }
      if (!done) continue;
      from.push(x, y, z);
      positions.set(p, v * 3);
      normals.set(n, v * 3);
      restored.push(v);
      break;
    }
  }
  if (restored.length) mesh.restored = { all: Uint32Array.from(restored), floor: Uint32Array.from(floor), hinted: Uint32Array.from(hinted), from: Float32Array.from(from) };
  return mesh;
}
