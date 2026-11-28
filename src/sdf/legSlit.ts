/**
 * 两条大腿之间的缝（带权重融合时用，见 bindPose.ts）。
 *
 * 二次元素体的两条大腿静止时是挨着的：照原样融合，从裆往下那一段是长在一起的同一张皮，两条腿之间只有前后两道沟。
 * 摆姿势把腿张开，这张皮一头跟着左腿、一头跟着右腿、正中那一道跟着胯，被扯成两条大腿之间鼓出来的一大块——
 * 权重怎么分都没用，网格本身就是连着的（和聚在一个肩膀上的几条手臂一样，见 bindPose.ts 开头）。
 *
 * 所以带权重融合时，在挨着的两条大腿正中切一刀（一个扁到只有缝那么厚的椭球，cut + parting，
 * 和前后排用的是同一种刀，见 geometry/ring.ts 的 slits）：切开以后两条腿各有各的内侧，权重也各跟各的（rig/skin.ts 的 PARTING）。
 * 切出来的两个平面不留着：权重算完以后，把切口上的顶点挪回这条腿自己原来的表面（closeSlits）。
 * 静止时两条大腿还是圆的、挨在一起（是叠着的两张皮，不是长在一起的一张），看着和没切过一样；腿一张开，各是完整的一条。
 *
 * 夹在这两条腿中间、长在胯底下的阴茎，根周围不另外挖：以前挖过一个半径十来厘米的球（只挖腿，露出胯的底面），
 * 可腿一张开，那里就是两条大腿根之间一道直通到胯底面的深沟。现在多出来的胯上，刀口从髋关节往下 SLIT.joined 才开始，
 * 那一截两条大腿连着，张开时是一片斜坡（2026-11-28 他看过对比图选的）。根部挖出来的槽照样填回去（uncarve.ts）。
 *
 * 只管照权重弯的那种身体（二次元素体，一个肩膀上只有一条手臂、一个上半身）：摆了姿势要重新融合的那几种
 * 腿是另一条路摆的（先跟着胯融合、再抄这张网格的权重搬过去，见 posedFuse.ts），那张网格上没有这道缝，权重对不上。
 *
 * 纯函数，在 Web Worker 和单元测试里都能跑。
 */
import { type Part, type PartType, type Prim, worldTransforms } from '../geometry/figure';
import { type V3, add, cross, dot, len, mul, norm, quatBasis, sub } from '../geometry/vec';
import type { Skeleton } from '../rig/skeleton';
import { type CompiledField, compilePartField, fieldAt } from './field';
import { refusesPosed } from './posedField';
import type { FusedMesh } from './surfaceNets';
import { landOn } from './uncarve';

const SLIT = {
  /** 缝多厚。两层面之间少于两个体素在网格上分不开（预览是 1.2 厘米一格）；切口最后挪回去，厚一点看不出来 */
  gap: 0.036,
  /** 从髋关节往下切到大腿那节骨骼长度的这么多倍：膝盖里侧也常常挨着 */
  reach: 1.2,
  /** 刀面前后各伸出去多远 */
  deep: 0.25,
  /** 两个髋关节离得比这远的不算挨着 */
  near: 0.3,
  /**
   * 腿和带着它的那块身体是同一类融合的（还在原位的腿和躯干直接取并集，见 Part.fuseAs）时，这一刀也会切到那块身体：
   * 刀口从它在两条腿正中的最低处（裆）再往下这么多起，不切到它。前后各探 probe 那么远、每 step 探一次
   */
  below: 0.004,
  probe: [-0.08, -0.04, 0, 0.04, 0.08],
  /**
   * 腿和带着它的那块身体不是同一类的（多出来的胯）：刀口从两个髋关节正中往下这么远才开始，最上面这一截两条大腿连着。
   * 留一截连着，腿张得很开时那里被拉开、起点褶，比一直切到髋关节褶少（同一个姿势折过 70 度的边 301 条对 360 条）
   */
  joined: 0.04,
  step: 0.004,
  /** 刀太短的不切 */
  least: 0.03,
  /** 切口上的顶点最多挪这么远 */
  most: 0.2,
  /** 漏掉的顶点补几遍；挪回去以后在腿的表面上匀几遍 */
  late: 4,
  even: 16,
  /** 绷成膜：挪几遍、每遍挪过头多少（大于 1 收得快，不能到 2） */
  span: 150,
  over: 1.6,
  /** 上面的遍数是照这么大的体素（摆姿势时屏幕上那一档）定的 */
  tuned: 0.0095,
  /** 从膜上往表面走，最多走几步 */
  march: 40,
  /** 每遍往邻居的正中挪几成 */
  pull: 0.7,
  /** 挪过的那片皮边上没挪的那一圈，每遍往邻居的正中挪几成（不落回表面，只把接缝上的小折、挤成一条的三角面捋开） */
  rim: 0.3,
  rims: 2,
  /** 挪过的和边上那几圈顶点，法线和周围三角面的朝向夹角余弦小于这么多的，换成三角面的朝向 */
  agree: 0.8,
  /** 离切口的面不到这么多个体素的才是切口；法线至少这么朝着挖掉的那一边（夹在两条腿中间的阴囊、阴茎也在这一带，不是切口） */
  on: 1,
  facing: 0.4,
  /** 在这条腿原来的表面里面不到这么多个体素的不用挪 */
  inside: 0.2,
};

/** 从挨着的两条腿上挖掉的一块扁椭球（世界坐标，部件自己的单位）：把两条腿分开的那一刀 */
export interface LegSlit {
  /** 两边的两条腿（部件名）：n 指向的那一边是 legs[1] */
  legs: [string, string];
  /** 这两条腿各算哪一类融合（要挖的就是这几类） */
  groups: PartType[];
  center: V3;
  /** 两条腿正中那个面的法向、顺着腿往下、面上的另一个方向（都是单位向量），椭球的三个轴 */
  n: V3;
  down: V3;
  side: V3;
  /** 三个轴上的半径（n、down、side） */
  radii: V3;
}

const sampledLeg = (part: Part | undefined): part is Part => !!part && part.type === 'leg' && part.prims.some((prim) => prim.kind === 'grid');

/**
 * 这副身体上哪几对大腿之间要切开：接在同一根骨骼上、髋关节挨着（中间没有隔着另一条）的两条采样出来的腿。
 * skeleton 是照这些部件建的骨架。前后排自己带着刀（ring.ts），不另切；摆了姿势要重新融合的身体也不切（见文件开头）
 */
export function legSlits(parts: Part[], skeleton: Skeleton): LegSlit[] {
  if (!parts.some(sampledLeg)) return [];
  if (parts.some((part) => part.prims.some((prim) => prim.kind === 'ellipsoid' && prim.parting))) return [];
  if (refusesPosed({ parts, scale: 1 })) return [];
  const byName = new Map(parts.map((part) => [part.name, part]));
  // 每条采样出来的腿最靠根的那节骨骼（大腿）
  const roots = skeleton.bones.filter((bone) => bone.parent >= 0 && skeleton.bones[bone.parent].part !== bone.part && sampledLeg(byName.get(bone.part)));
  if (roots.length < 2) return [];
  const xfs = worldTransforms({ parts, scale: 1 });
  const hosts = new Map<string, CompiledField>();
  const slits: LegSlit[] = [];
  for (let i = 0; i < roots.length; i++) {
    for (let j = i + 1; j < roots.length; j++) {
      const a = roots[i];
      const b = roots[j];
      if (a.parent !== b.parent) continue;
      const across = sub(b.head, a.head);
      const apart = len(across);
      if (apart > SLIT.near || apart < 1e-6) continue;
      // 两条中间还隔着一条（同一根骨骼上三条以上并排）：不是挨着的
      const between = roots.some((c) => {
        if (c === a || c === b || c.parent !== a.parent) return false;
        const to = sub(c.head, a.head);
        const t = dot(to, across) / (apart * apart);
        return t > 0.15 && t < 0.85 && len(sub(to, mul(across, t))) < 0.5 * apart;
      });
      if (between) continue;
      const down = norm(add(norm(sub(a.tail, a.head)), norm(sub(b.tail, b.head))));
      const long = (len(sub(a.tail, a.head)) + len(sub(b.tail, b.head))) / 2;
      const flat = sub(across, mul(down, dot(across, down)));
      if (len(flat) < 0.2 * apart) continue;
      const n = norm(flat);
      const side = cross(n, down);
      const mid = mul(add(a.head, b.head), 0.5);
      const legA = byName.get(a.part)!;
      const legB = byName.get(b.part)!;
      const groups = [...new Set([legA.fuseAs ?? legA.type, legB.fuseAs ?? legB.type])];
      // 带着这两条腿的那块身体也在要切的那几类里：刀口从裆下面起
      let top = 0;
      const host = byName.get(skeleton.bones[a.parent].part);
      const shared = !!host && groups.includes(host.fuseAs ?? host.type);
      if (!shared) top = SLIT.joined;
      if (host && shared) {
        let field = hosts.get(host.name);
        if (!field) hosts.set(host.name, (field = compilePartField(host, xfs.get(host.name)!)));
        for (const s of SLIT.probe) {
          const from = add(mid, mul(side, s));
          if (fieldAt(field, from[0], from[1], from[2]) >= 0) continue;
          let t = SLIT.step;
          while (t < long && fieldAt(field, from[0] + down[0] * t, from[1] + down[1] * t, from[2] + down[2] * t) < 0) t += SLIT.step;
          if (t + SLIT.below > top) top = t + SLIT.below;
        }
      }
      const tall = (long * SLIT.reach - top) / 2;
      if (tall < SLIT.least) continue;
      const center = add(mid, mul(down, top + tall));
      const legs: [string, string] = [a.part, b.part];
      slits.push({ legs, groups, center, n, down, side, radii: [SLIT.gap / 2, tall, SLIT.deep] });
    }
  }
  return slits;
}

/** 带着这几块的部件（没有骨骼，直接放在世界里）：每一类要挖的各一个，排在所有部件后面 */
export function slitParts(slits: readonly LegSlit[]): Part[] {
  const byGroup = new Map<PartType, Prim[]>();
  slits.forEach((slit, i) => {
    for (const group of slit.groups) {
      const prim: Prim = { kind: 'ellipsoid', name: `LegSlit_${i + 1}`, center: slit.center, radii: slit.radii, quat: quatBasis(slit.n, slit.down, slit.side), cut: true, parting: true };
      const list = byGroup.get(group);
      if (list) list.push(prim);
      else byGroup.set(group, [prim]);
    }
  });
  return [...byGroup].map(([group, prims]): Part => ({ name: `LegSlits_${group}`, type: 'leg', side: 0, pos: [0, 0, 0], quat: [0, 0, 0, 1], material: 'clay', fuseAs: group, prims }));
}

/**
 * 这一点在哪一刀的刀面范围里、在刀的哪一边：那一边那条腿是 parts 里的第几个，toward 里写上朝刀面去的方向
 * （那条腿挨着另一条的那片表面就在刀面附近）；不在哪一刀的范围里返回 -1。
 * 阴茎周围挖出来的槽填回去时用（见 uncarve.ts 的 restoreCarved）：槽壁在哪条腿那一边，就挪回哪条腿的表面
 */
export function slitOwner(parts: readonly Part[], slits: readonly LegSlit[]): (x: number, y: number, z: number, toward: number[]) => number {
  const index = new Map(parts.map((part, i) => [part.name, i]));
  const knives = slits;
  const sides = knives.map((slit) => [index.get(slit.legs[0]) ?? -1, index.get(slit.legs[1]) ?? -1]);
  return (x, y, z, toward) => {
    for (let i = 0; i < knives.length; i++) {
      const slit = knives[i];
      const dx = x - slit.center[0];
      const dy = y - slit.center[1];
      const dz = z - slit.center[2];
      const u = (dx * slit.down[0] + dy * slit.down[1] + dz * slit.down[2]) / slit.radii[1];
      const w = (dx * slit.side[0] + dy * slit.side[1] + dz * slit.side[2]) / slit.radii[2];
      if (u * u + w * w >= 1) continue;
      const first = dx * slit.n[0] + dy * slit.n[1] + dz * slit.n[2] < 0;
      for (let k = 0; k < 3; k++) toward[k] = first ? slit.n[k] : -slit.n[k];
      return sides[i][first ? 0 : 1];
    }
    return -1;
  };
}

/**
 * 把切口上的顶点挪回它那条腿原来的表面（就地改 mesh 的顶点、法线），返回哪些顶点挪过（1 是）。要在权重算完以后做：
 * 权重是照切开的样子分的（刀哪一边的皮跟哪条腿，见 rig/skin.ts 的 PARTING），挪回去以后两条腿的皮互相叠着，照位置就分不清了。
 * parts 是融合时用的那些部件（带不带刀都行）。缝上去的手脚（mesh.bound 起的那些）不动。
 * legSkin：这个顶点是不是这条腿（部件名）的皮（照权重看）；补漏掉的顶点时用，不给就不看
 */
export function closeSlits(mesh: FusedMesh, parts: Part[], slits: readonly LegSlit[], legSkin?: (vertex: number, leg: string) => boolean): Uint8Array {
  const { positions, normals } = mesh;
  const limit = mesh.bound ? mesh.bound.start : positions.length / 3;
  const moved = new Uint8Array(limit);
  if (!slits.length) return moved;
  /** 挪过的顶点各是哪条腿的 */
  const owner: string[] = [];
  /** 认出来时知道往哪边回的（朝刀面去的方向，那条腿挨着另一条的那片表面在那一边）：后面整片推回去时拿来核对膜的朝向 */
  const back = new Map<number, V3>();
  // 阴茎周围挖出来的槽壁里已经照腿挪回去的那些（见 uncarve.ts 的 restoreCarved）也算上：它们边上漏掉的一起补、一起匀
  const restored = mesh.restored;
  if (restored?.hinted.length) {
    const at = new Map<number, number>();
    restored.all.forEach((v, i) => at.set(v, i));
    const whose = slitOwner(parts, slits);
    const toward = [0, 0, 0];
    for (const v of restored.hinted) {
      const i = at.get(v);
      if (i === undefined || v >= limit) continue;
      const leg = parts[whose(restored.from[i * 3], restored.from[i * 3 + 1], restored.from[i * 3 + 2], toward)];
      if (!leg) continue;
      moved[v] = 1;
      owner[v] = leg.name;
      back.set(v, [toward[0], toward[1], toward[2]]);
    }
  }
  const voxel = mesh.info.voxel;
  const xfs = worldTransforms({ parts, scale: 1 });
  const byName = new Map(parts.map((part) => [part.name, part]));
  const fields = new Map<string, CompiledField>();
  const fieldOf = (name: string): CompiledField => {
    let field = fields.get(name);
    if (!field) fields.set(name, (field = compilePartField(byName.get(name)!, xfs.get(name)!)));
    return field;
  };
  const p = [0, 0, 0];
  const q = [0, 0, 0];
  const toward = [0, 0, 0];
  let field: CompiledField | null = null;
  const dist = (x: number, y: number, z: number) => fieldAt(field!, x, y, z);
  for (let v = 0; v < limit; v++) {
    if (moved[v]) continue;
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    for (const slit of slits) {
      const dx = x - slit.center[0];
      const dy = y - slit.center[1];
      const dz = z - slit.center[2];
      const off = dx * slit.n[0] + dy * slit.n[1] + dz * slit.n[2];
      const [rn, rd, rs] = slit.radii;
      if (Math.abs(off) > rn + SLIT.on * voxel) continue;
      const a = off / rn;
      const b = (dx * slit.down[0] + dy * slit.down[1] + dz * slit.down[2]) / rd;
      const c = (dx * slit.side[0] + dy * slit.side[1] + dz * slit.side[2]) / rs;
      // 离这块椭球的面多远（和 field.ts 里椭球的算法一样）：顶点要在面上
      const k0 = Math.hypot(a, b, c);
      const ga = a / rn;
      const gb = b / rd;
      const gc = c / rs;
      const g = Math.hypot(ga, gb, gc);
      if (!(g > 1e-12) || Math.abs((k0 * (k0 - 1)) / g) > SLIT.on * voxel) continue;
      // 切口朝着挖掉的那一边：法线和椭球往外的方向相反
      const nn = normals[v * 3] * slit.n[0] + normals[v * 3 + 1] * slit.n[1] + normals[v * 3 + 2] * slit.n[2];
      const nd = normals[v * 3] * slit.down[0] + normals[v * 3 + 1] * slit.down[1] + normals[v * 3 + 2] * slit.down[2];
      const ns = normals[v * 3] * slit.side[0] + normals[v * 3 + 1] * slit.side[1] + normals[v * 3 + 2] * slit.side[2];
      if ((nn * ga + nd * gb + ns * gc) / g > -SLIT.facing) continue;
      field = fieldOf(slit.legs[off < 0 ? 0 : 1]);
      if (dist(x, y, z) > -SLIT.inside * voxel) continue;
      // 腿的格子只记表面里外三厘米多：再往里没有梯度，先朝两条腿正中那个面走（腿挨着另一条的那片表面就在那附近）
      for (let k = 0; k < 3; k++) toward[k] = off < 0 ? slit.n[k] : -slit.n[k];
      if (!landOn(dist, voxel, x, y, z, SLIT.most, p, q, toward)) continue;
      positions.set(p, v * 3);
      normals.set(q, v * 3);
      moved[v] = 1;
      owner[v] = off < 0 ? slit.legs[0] : slit.legs[1];
      back.set(v, [toward[0], toward[1], toward[2]]);
      break;
    }
  }

  // 挪回去的顶点是照「离哪儿近」各找各的落点，挖得深的那一片落得疏密不匀，三角面又大又斜，抄近路把腿上的棱削掉一块块。
  // 在腿的表面上匀几遍：每个顶点往邻居的正中挪一点，再落回它那条腿的表面
  if (!moved.includes(1)) return moved;
  const { triangles } = mesh;
  // 漏掉的：切口拐角上法线歪的、离面稍远的顶点没认出来，留在原地，被挪走的邻居拽成一根刺。
  // 邻居大半都挪了、自己又确实在那条腿原来的表面里面的，也挪回去（做几遍）
  for (let pass = 0; pass < SLIT.late; pass++) {
    const votes = new Map<number, { all: Set<number>; legs: string[] }>();
    for (let t = 0; t < triangles.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const v = triangles[t + e];
        if (v >= limit || moved[v]) continue;
        const others = [triangles[t + ((e + 1) % 3)], triangles[t + ((e + 2) % 3)]];
        if (!others.some((u) => u < limit && moved[u])) continue;
        let vote = votes.get(v);
        if (!vote) votes.set(v, (vote = { all: new Set(), legs: [] }));
        for (const u of others) {
          if (vote.all.has(u)) continue;
          vote.all.add(u);
          if (u < limit && moved[u]) vote.legs.push(owner[u]);
        }
      }
    }
    const late: [number, string][] = [];
    for (const [v, vote] of votes) {
      if (vote.legs.length * 2 < vote.all.size) continue;
      const leg = vote.legs[0];
      if (vote.legs.some((other) => other !== leg)) continue;
      // 得是这条腿的皮（权重大半跟着它）：露出来的那片胯的底面、阴茎的根静止时也在腿原来的表面里面，不能拽走
      if (legSkin && !legSkin(v, leg)) continue;
      field = fieldOf(leg);
      const x = positions[v * 3];
      const y = positions[v * 3 + 1];
      const z = positions[v * 3 + 2];
      if (dist(x, y, z) > -SLIT.inside * voxel) continue;
      // 朝哪边走：照挪过的邻居挪到的地方
      let tx = 0;
      let ty = 0;
      let tz = 0;
      for (const u of vote.all) {
        if (u >= limit || !moved[u]) continue;
        tx += positions[u * 3] - x;
        ty += positions[u * 3 + 1] - y;
        tz += positions[u * 3 + 2] - z;
      }
      const long = Math.hypot(tx, ty, tz);
      if (!(long > 1e-9)) continue;
      toward[0] = tx / long;
      toward[1] = ty / long;
      toward[2] = tz / long;
      if (!landOn(dist, voxel, x, y, z, SLIT.most, p, q, toward)) continue;
      positions.set(p, v * 3);
      normals.set(q, v * 3);
      late.push([v, leg]);
      back.set(v, [toward[0], toward[1], toward[2]]);
    }
    if (!late.length) break;
    for (const [v, leg] of late) {
      moved[v] = 1;
      owner[v] = leg;
    }
  }

  const list: number[] = [];
  for (let v = 0; v < limit; v++) if (moved[v]) list.push(v);
  const near = new Map<number, Set<number>>(list.map((v) => [v, new Set<number>()]));
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const set = near.get(triangles[t + e]);
      if (!set) continue;
      set.add(triangles[t + ((e + 1) % 3)]);
      set.add(triangles[t + ((e + 2) % 3)]);
    }
  }
  // 各找各的落点会叠层：球壁在腿的表面底下比口子宽（球心在腿里面，越往里截面越大），那一圈顶点就近落到了口子外面，
  // 压在原来没动的皮上，口子正中反倒没有顶点。所以先不管腿的表面，把这片皮在没挪的边沿之间绷成一张平顺的膜
  // （每个顶点反复挪到邻居的正中；这样排出来的顶点不会叠、不会翻），再从膜上整片落回腿的表面
  {
    const landed = new Float32Array(list.length * 3);
    list.forEach((v, i) => landed.set(positions.subarray(v * 3, v * 3 + 3), i * 3));
    // 网格细了，同样大的一片皮上顶点的圈数多，要多挪几遍才收得住
    const spans = Math.ceil(SLIT.span * Math.max(1, SLIT.tuned / voxel));
    for (let round = 0; round < spans; round++) {
      for (const v of list) {
        const around = near.get(v)!;
        if (!around.size) continue;
        let ax = 0;
        let ay = 0;
        let az = 0;
        for (const u of around) {
          ax += positions[u * 3];
          ay += positions[u * 3 + 1];
          az += positions[u * 3 + 2];
        }
        positions[v * 3] += (ax / around.size - positions[v * 3]) * SLIT.over;
        positions[v * 3 + 1] += (ay / around.size - positions[v * 3 + 1]) * SLIT.over;
        positions[v * 3 + 2] += (az / around.size - positions[v * 3 + 2]) * SLIT.over;
      }
    }
    // 膜朝外的方向（照三角面的朝向：朝着挖掉的那一边，腿原来的表面就在那一边）
    const at = new Map(list.map((v, i) => [v, i]));
    const out = new Float32Array(list.length * 3);
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t];
      const b = triangles[t + 1];
      const c = triangles[t + 2];
      const ia = at.get(a);
      const ib = at.get(b);
      const ic = at.get(c);
      if (ia === undefined && ib === undefined && ic === undefined) continue;
      const ux = positions[b * 3] - positions[a * 3];
      const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
      const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
      const wx = positions[c * 3] - positions[a * 3];
      const wy = positions[c * 3 + 1] - positions[a * 3 + 1];
      const wz = positions[c * 3 + 2] - positions[a * 3 + 2];
      const face = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
      for (const i of [ia, ib, ic]) if (i !== undefined) for (let k = 0; k < 3; k++) out[i * 3 + k] += face[k];
    }
    list.forEach((v, i) => {
      field = fieldOf(owner[v]);
      let x = positions[v * 3];
      let y = positions[v * 3 + 1];
      let z = positions[v * 3 + 2];
      // 先顺着膜朝外的方向走到离表面一个体素以内（每步不超过离表面的距离，走不过头），再落到表面上：
      // 整片是顺着同一个朝向推出去的，不会各找各的最近点落乱
      const long = Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
      if (long > 1e-12) {
        let nx = out[i * 3] / long;
        let ny = out[i * 3 + 1] / long;
        let nz = out[i * 3 + 2] / long;
        // 膜的朝向和认出来时该回的那一边相反（贴着阴茎根、几张皮挤在一起的地方会这样）：照该回的那一边走，
        // 不然顺着反的方向穿过整条腿，落到腿的另一面上，摆开腿是一根十几厘米的长刺
        const way = back.get(v);
        if (way && nx * way[0] + ny * way[1] + nz * way[2] < 0) [nx, ny, nz] = way;
        let gone = 0;
        for (let step = 0; step < SLIT.march && gone < SLIT.most; step++) {
          const d = dist(x, y, z);
          if (d > -voxel) break;
          const s = Math.min(-d - 0.5 * voxel, 1.5 * voxel);
          x += nx * s;
          y += ny * s;
          z += nz * s;
          gone += s;
        }
      }
      if (landOn(dist, voxel, x, y, z, SLIT.most, p, q)) {
        positions.set(p, v * 3);
        normals.set(q, v * 3);
      } else positions.set(landed.subarray(i * 3, i * 3 + 3), v * 3);
    });
  }
  // 边上没挪的那一圈：它们一边连着落回去的皮、一边连着原来的皮，接缝上常留一道小折和挤扁的三角面，摆开腿时翻过来就是一道黑印
  // 往外捋 rims 圈（网格细了照着加圈），再往外的不动
  const rim: number[] = [];
  const rimNear: Set<number>[] = [];
  {
    const seen = new Set<number>(list);
    let front = list;
    const rims = Math.round(SLIT.rims * Math.max(1, SLIT.tuned / voxel));
    for (let r = 0; r < rims; r++) {
      const inFront = new Set(front);
      const ring: number[] = [];
      for (let t = 0; t < triangles.length; t += 3) {
        if (!inFront.has(triangles[t]) && !inFront.has(triangles[t + 1]) && !inFront.has(triangles[t + 2])) continue;
        for (let e = 0; e < 3; e++) {
          const u = triangles[t + e];
          if (u < limit && !seen.has(u)) seen.add(u), ring.push(u);
        }
      }
      rim.push(...ring);
      front = ring;
    }
    const at = new Map(rim.map((v, i) => [v, i]));
    rim.forEach(() => rimNear.push(new Set()));
    for (let t = 0; t < triangles.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const i = at.get(triangles[t + e]);
        if (i === undefined) continue;
        rimNear[i].add(triangles[t + ((e + 1) % 3)]);
        rimNear[i].add(triangles[t + ((e + 2) % 3)]);
      }
    }
  }
  const rimNext = new Float32Array(rim.length * 3);
  const next = new Float32Array(list.length * 6);
  for (let round = 0; round < SLIT.even; round++) {
    rim.forEach((v, i) => {
      let ax = 0;
      let ay = 0;
      let az = 0;
      for (const u of rimNear[i]) {
        ax += positions[u * 3];
        ay += positions[u * 3 + 1];
        az += positions[u * 3 + 2];
      }
      const n = rimNear[i].size || 1;
      for (let k = 0; k < 3; k++) rimNext[i * 3 + k] = positions[v * 3 + k] + ([ax, ay, az][k] / n - positions[v * 3 + k]) * (rimNear[i].size ? SLIT.rim : 0);
    });
    rim.forEach((v, i) => positions.set(rimNext.subarray(i * 3, i * 3 + 3), v * 3));
    list.forEach((v, i) => {
      const around = near.get(v)!;
      let ax = 0;
      let ay = 0;
      let az = 0;
      for (const u of around) {
        ax += positions[u * 3];
        ay += positions[u * 3 + 1];
        az += positions[u * 3 + 2];
      }
      const x = positions[v * 3];
      const y = positions[v * 3 + 1];
      const z = positions[v * 3 + 2];
      next.set([x, y, z, normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]], i * 6);
      if (!around.size) return;
      field = fieldOf(owner[v]);
      const cx = x + (ax / around.size - x) * SLIT.pull;
      const cy = y + (ay / around.size - y) * SLIT.pull;
      const cz = z + (az / around.size - z) * SLIT.pull;
      if (landOn(dist, voxel, cx, cy, cz, SLIT.most, p, q)) next.set([p[0], p[1], p[2], q[0], q[1], q[2]], i * 6);
    });
    list.forEach((v, i) => {
      positions.set(next.subarray(i * 6, i * 6 + 3), v * 3);
      normals.set(next.subarray(i * 6 + 3, i * 6 + 6), v * 3);
    });
  }
  // 法线：落回去的顶点用的是腿的距离场的朝向，边上那几圈还是切口那面墙的朝向；挪过以后有的和周围三角面差得远，
  // 页面上照顶点法线打光，那里就是一道黑印。和周围三角面的朝向差得多的，换成三角面的朝向
  const touched = new Map<number, number>();
  for (const v of [...list, ...rim]) touched.set(v, touched.size);
  const facing = new Float64Array(touched.size * 3);
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t];
    const b = triangles[t + 1];
    const c = triangles[t + 2];
    const ia = touched.get(a);
    const ib = touched.get(b);
    const ic = touched.get(c);
    if (ia === undefined && ib === undefined && ic === undefined) continue;
    const ux = positions[b * 3] - positions[a * 3];
    const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
    const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const wx = positions[c * 3] - positions[a * 3];
    const wy = positions[c * 3 + 1] - positions[a * 3 + 1];
    const wz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const face = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
    for (const i of [ia, ib, ic]) if (i !== undefined) for (let k = 0; k < 3; k++) facing[i * 3 + k] += face[k];
  }
  for (const [v, i] of touched) {
    const fx = facing[i * 3];
    const fy = facing[i * 3 + 1];
    const fz = facing[i * 3 + 2];
    const long = Math.hypot(fx, fy, fz);
    if (!(long > 1e-12)) continue;
    const nx = normals[v * 3];
    const ny = normals[v * 3 + 1];
    const nz = normals[v * 3 + 2];
    if ((nx * fx + ny * fy + nz * fz) / (long * (Math.hypot(nx, ny, nz) || 1)) >= SLIT.agree) continue;
    normals[v * 3] = fx / long;
    normals[v * 3 + 1] = fy / long;
    normals[v * 3 + 2] = fz / long;
  }
  return moved;
}
