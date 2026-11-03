/**
 * 摆姿势时让屏幕上的网格跟着骨骼动：按蒙皮权重把顶点直接搬过去，写回原来那张网格。
 * 十来万个顶点搬一遍只要几毫秒，三种身体样式走同一条路，导出时用的也是同一套算法（character/pose.ts）。
 * 几根骨骼的动作怎么混：成品角色是线性混合，白模是对偶四元数（关节转得多也不瘪）。
 */
import * as THREE from 'three';
import { CHARACTER_BLEND, type SkinBlend, skinInPlace } from '../character/pose';
import type { SkinWeights } from '../rig/skin';
import { MATERIALS } from './materials';
import type { BakedMesh } from './partsModel';

/** 一张可以跟着骨骼动的网格 */
export interface SkinSource {
  geometry: THREE.BufferGeometry;
  /** 每个顶点 4 个骨骼下标、4 个权重 */
  joints: ArrayLike<number>;
  weights: ArrayLike<number>;
  /** 这张网格里的 1 个单位是多少米（融合网格是按标准人台算的，整体缩放在外面乘） */
  unit: number;
  /** 几根骨骼的动作怎么混（缺省是线性混合） */
  blend?: SkinBlend;
}

interface Item {
  source: SkinSource;
  position: Float32Array;
  normal: Float32Array;
  /** 换算到这张网格自己单位的矩阵（unit 是 1 就直接用原来的） */
  scaled: Float64Array | null;
  /** 上一次搬的时候用的矩阵（这张网格自己的单位）；还没搬过、放回了静止的样子是 null */
  last: Float64Array | null;
  /** 有 edit 时：上一次改过的静止样子，和下一次改的时候用的空位 */
  edited: { position: Float32Array; normal: Float32Array } | null;
  spare: { position: Float32Array; normal: Float32Array } | null;
  /** 包围盒、包围球是不是拖着的时候估大的 */
  loose: boolean;
}

/** 白模（融合的、分部件的）摆姿势、导出摆好的样子时，骨骼的动作怎么混 */
export const WHITE_BLEND: SkinBlend = 'dual';
export { CHARACTER_BLEND };

const arrayOf = (geometry: THREE.BufferGeometry, name: 'position' | 'normal') => geometry.getAttribute(name).array as Float32Array;

/** 两份蒙皮矩阵（每根骨骼 12 个数）比一比：哪几根骨骼变了（1 是变了） */
function changedBones(before: Float64Array, after: Float64Array): Uint8Array {
  const out = new Uint8Array(after.length / 12);
  for (let j = 0; j < out.length; j++) {
    for (let i = j * 12; i < j * 12 + 12; i++) {
      if (before[i] !== after[i]) {
        out[j] = 1;
        break;
      }
    }
  }
  return out;
}

/** 两份静止的样子比一比：哪几个顶点的位置或法线变了（1 是变了） */
function changedVertices(before: { position: Float32Array; normal: Float32Array }, after: { position: Float32Array; normal: Float32Array }): Uint8Array {
  const out = new Uint8Array(after.position.length / 3);
  for (let i = 0; i < after.position.length; i++) {
    if (before.position[i] !== after.position[i] || before.normal[i] !== after.normal[i]) out[(i / 3) | 0] = 1;
  }
  return out;
}

export class PosedMeshes {
  private readonly items: Item[];
  /**
   * 摆之前先改一改静止的样子（成品角色的表情是加在静止姿势上的）：
   * 拿到第 index 张网格静止时的顶点、法线的一份副本，直接在上面改。改过的法线不用归一，后面搬顶点时会归一
   */
  edit: ((index: number, position: Float32Array, normal: Float32Array) => void) | null = null;

  /** 记下每张网格静止时的样子：以后每次摆都从它算起 */
  constructor(sources: readonly SkinSource[]) {
    this.items = sources.map((source) => ({
      source,
      position: arrayOf(source.geometry, 'position').slice(),
      normal: arrayOf(source.geometry, 'normal').slice(),
      scaled: null,
      last: null,
      edited: null,
      spare: null,
      loose: false,
    }));
  }

  /**
   * matrices：每根骨骼的蒙皮矩阵（见 pose/rig.ts 的 poseMatrices），按米算。
   * 只重算矩阵变了的那几根骨骼带着的顶点（拖一只手时只有那条手臂），算出来和全部重算的逐值一样。
   * rough：正拖着，包围盒、包围球不逐个顶点重算，只放大到框得住这次挪过的顶点；不拖了再照常算一次准的
   */
  apply(matrices: Float64Array, rough = false) {
    for (const [index, item] of this.items.entries()) {
      const { geometry, joints, weights, unit, blend } = item.source;
      let own = matrices;
      if (unit !== 1) {
        own = item.scaled ??= new Float64Array(matrices.length);
        own.set(matrices);
        for (let o = 9; o < own.length; o += 12) {
          own[o] /= unit;
          own[o + 1] /= unit;
          own[o + 2] /= unit;
        }
      }
      // 上一次搬过、骨骼还是那些：只重算动了的；不然全部重算
      let full = !item.last || item.last.length !== own.length;
      // 从静止的样子算起；有 edit（表情）时先改一份，改了的顶点不管骨骼动没动都重算
      let from = { positions: item.position, normals: item.normal };
      let fresh: Uint8Array | undefined;
      if (this.edit) {
        const next = item.spare ?? { position: new Float32Array(item.position.length), normal: new Float32Array(item.normal.length) };
        next.position.set(item.position);
        next.normal.set(item.normal);
        this.edit(index, next.position, next.normal);
        if (item.edited) fresh = changedVertices(item.edited, next);
        else full = true;
        item.spare = item.edited;
        item.edited = next;
        from = { positions: next.position, normals: next.normal };
      }
      let moved = full ? undefined : changedBones(item.last!, own);
      const count = moved ? moved.reduce((n, m) => n + m, 0) : 0;
      if (moved && !count && !fresh?.includes(1)) {
        // 什么都没变（松手以后又照同一个姿势同步了一次）：顶点不用动，拖着时估大的包围盒补一次准的
        if (!rough && item.loose) this.bound(item, geometry, null);
        continue;
      }
      // 大半骨骼都动了（够不着，身体跟过去了）：直接全部重算，不一个个顶点地查
      if (moved && count > moved.length * 0.75) moved = undefined;
      const box = rough && geometry.boundingBox ? Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity) : undefined;
      skinInPlace(blend ?? 'linear', arrayOf(geometry, 'position'), arrayOf(geometry, 'normal'), joints, weights, own, {
        from,
        moved,
        fresh,
        box,
      });
      if (full) item.last = new Float64Array(own.length);
      item.last!.set(own);
      geometry.getAttribute('position').needsUpdate = true;
      geometry.getAttribute('normal').needsUpdate = true;
      this.bound(item, geometry, box ?? null);
    }
  }

  /** 回到静止的样子 */
  restore() {
    for (const item of this.items) {
      arrayOf(item.source.geometry, 'position').set(item.position);
      arrayOf(item.source.geometry, 'normal').set(item.normal);
      item.last = null;
      item.edited = null;
      const { geometry } = item.source;
      geometry.getAttribute('position').needsUpdate = true;
      geometry.getAttribute('normal').needsUpdate = true;
      this.bound(item, geometry, null);
    }
  }

  /**
   * 包围盒、包围球（点选、视锥裁剪、落地、镜头对准用）：逐个顶点重算一遍。
   * moved：正拖着，只把原来的放大到框得住这次挪过的那些顶点（挪走的顶点原来的地方也还框着：只会偏大）
   */
  private bound(item: Item, geometry: THREE.BufferGeometry, moved: Float64Array | null) {
    const box = geometry.boundingBox;
    if (!moved || !box) {
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      item.loose = false;
      return;
    }
    item.loose = true;
    if (moved[0] > moved[3]) return;
    box.expandByPoint(new THREE.Vector3(moved[0], moved[1], moved[2]));
    box.expandByPoint(new THREE.Vector3(moved[3], moved[4], moved[5]));
    geometry.boundingSphere = box.getBoundingSphere(geometry.boundingSphere ?? new THREE.Sphere());
  }

  /**
   * 「自然下垂」用：身体表面上撒一把均匀的点和法线（米，每 spacing 那么大的一格一个），现在摆着的和静止时的各一份。
   * 主要跟着 skip 里的骨骼动的顶点不算身体（头发、裙摆自己）；一张网格里这种顶点占了三成以上的，整张不算
   * （头发贴着头皮的那一层是跟着头动的，也不能当身体）。
   * own：skip 里每根骨骼主要带着的顶点静止时在哪（每根最多取几百个），量它自己有多粗用
   */
  sample(skip: ReadonlySet<number>, spacing = 0.015) {
    const now = new Thinner(spacing);
    const rest = new Thinner(spacing);
    const own = new Map<number, number[]>();
    for (const item of this.items) {
      const { geometry, joints, weights, unit } = item.source;
      const position = arrayOf(geometry, 'position');
      const normal = arrayOf(geometry, 'normal');
      const count = position.length / 3;
      const lead = new Int32Array(count);
      let hanging = 0;
      for (let v = 0; v < count; v++) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (weights[v * 4 + k] > weights[v * 4 + best]) best = k;
        lead[v] = joints[v * 4 + best];
        if (skip.has(lead[v])) hanging++;
      }
      const whole = hanging < count * 0.3;
      for (let v = 0; v < count; v++) {
        if (skip.has(lead[v])) {
          let list = own.get(lead[v]);
          if (!list) own.set(lead[v], (list = []));
          list.push(item.position[v * 3] * unit, item.position[v * 3 + 1] * unit, item.position[v * 3 + 2] * unit);
        } else if (whole) {
          now.add(position, normal, v, unit);
          rest.add(item.position, item.normal, v, unit);
        }
      }
    }
    const kept = new Map<number, Float32Array>();
    for (const [bone, list] of own) {
      const step = Math.max(1, Math.floor(list.length / 3 / 400));
      const out: number[] = [];
      for (let i = 0; i < list.length; i += 3 * step) out.push(list[i], list[i + 1], list[i + 2]);
      kept.set(bone, new Float32Array(out));
    }
    return { now: now.done(), rest: rest.done(), own: kept };
  }

  /** 现在所有网格合起来占多大地方（米） */
  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const { source } of this.items) {
      const one = source.geometry.boundingBox;
      if (!one) continue;
      box.expandByPoint(one.min.clone().multiplyScalar(source.unit));
      box.expandByPoint(one.max.clone().multiplyScalar(source.unit));
    }
    return box;
  }
}

/** 把一堆顶点按格子并成均匀的一把点：落在同一格里的位置、法线取平均 */
class Thinner {
  private readonly cells = new Map<number, number>();
  private readonly sums: number[] = [];

  constructor(private readonly spacing: number) {}

  add(position: ArrayLike<number>, normal: ArrayLike<number>, v: number, unit: number) {
    const x = position[v * 3] * unit;
    const y = position[v * 3 + 1] * unit;
    const z = position[v * 3 + 2] * unit;
    const c = (t: number) => Math.floor(t / this.spacing) + 1024;
    const key = (c(x) * 2048 + c(y)) * 2048 + c(z);
    let at = this.cells.get(key);
    if (at === undefined) {
      at = this.sums.length;
      this.cells.set(key, at);
      this.sums.push(0, 0, 0, 0, 0, 0, 0);
    }
    const s = this.sums;
    s[at] += x;
    s[at + 1] += y;
    s[at + 2] += z;
    s[at + 3] += normal[v * 3];
    s[at + 4] += normal[v * 3 + 1];
    s[at + 5] += normal[v * 3 + 2];
    s[at + 6]++;
  }

  done(): { points: Float32Array; normals: Float32Array } {
    const n = this.sums.length / 7;
    const points = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const s = this.sums.slice(i * 7, i * 7 + 7);
      const l = Math.hypot(s[3], s[4], s[5]) || 1;
      points.set([s[0] / s[6], s[1] / s[6], s[2] / s[6]], i * 3);
      normals.set([s[3] / l, s[4] / l, s[5] / l], i * 3);
    }
    return { points, normals };
  }
}

/**
 * 分部件模式摆姿势时用的一组网格：每个部件一张，顶点已经搬到世界坐标（米），不再有父子关系，
 * 这样一个部件里面（手肘）也能弯。
 */
export class FlatParts {
  readonly root = new THREE.Group();

  constructor() {
    this.root.name = 'OC_Posed';
    this.root.visible = false;
  }

  /** 换成这一批部件；skin 是把所有部件的顶点接在一起算出来的权重。返回它们的蒙皮来源 */
  set(meshes: readonly BakedMesh[], skin: SkinWeights): SkinSource[] {
    this.clear();
    let first = 0;
    return meshes.map((m) => {
      const count = m.positions.length / 3;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(m.indices, 1));
      const mesh = new THREE.Mesh(geometry, MATERIALS[m.material]);
      mesh.name = m.name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      const source: SkinSource = {
        geometry,
        joints: skin.joints.subarray(first * 4, (first + count) * 4),
        weights: skin.weights.subarray(first * 4, (first + count) * 4),
        unit: 1,
        blend: WHITE_BLEND,
      };
      first += count;
      return source;
    });
  }

  clear() {
    for (const child of [...this.root.children]) {
      (child as THREE.Mesh).geometry.dispose();
      this.root.remove(child);
    }
  }
}
