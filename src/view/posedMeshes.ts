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
}

/** 白模（融合的、分部件的）摆姿势、导出摆好的样子时，骨骼的动作怎么混 */
export const WHITE_BLEND: SkinBlend = 'dual';
export { CHARACTER_BLEND };

const arrayOf = (geometry: THREE.BufferGeometry, name: 'position' | 'normal') => geometry.getAttribute(name).array as Float32Array;

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
    }));
  }

  /** matrices：每根骨骼的蒙皮矩阵（见 pose/rig.ts 的 poseMatrices），按米算 */
  apply(matrices: Float64Array) {
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
      const position = arrayOf(geometry, 'position');
      const normal = arrayOf(geometry, 'normal');
      position.set(item.position);
      normal.set(item.normal);
      this.edit?.(index, position, normal);
      skinInPlace(blend ?? 'linear', position, normal, joints, weights, own);
      this.touch(geometry);
    }
  }

  /** 回到静止的样子 */
  restore() {
    for (const item of this.items) {
      arrayOf(item.source.geometry, 'position').set(item.position);
      arrayOf(item.source.geometry, 'normal').set(item.normal);
      this.touch(item.source.geometry);
    }
  }

  private touch(geometry: THREE.BufferGeometry) {
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('normal').needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
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
