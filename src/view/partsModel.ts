/**
 * 把 Figure 变成 three.js 场景里的一组物体（分部件模式）：每个部件一个网格，父子关系照搬。
 * 几何体按形状缓存：拖滑块时只有形状真的变了的部件才重建；形状一样的部件（体块组装复制出来的胸、腿、胯）共用一份，
 * 不各算一遍（楚云萱九十块里三十只胸是同一种，各算一遍要十几秒）。
 * 手动微调压扁拉长过的（resize）：先照没拉长的样子算一份（也是共用的），再把顶点拉伸过去——拉伸只是乘一个矩阵，不用重新采样。
 */
import * as THREE from 'three';
import { type Figure, type Material, type Part, shapeMatrix } from '../geometry/figure';
import { buildPartGeometry, triangleCount } from '../geometry/partsMesh';
import { MATERIALS } from './materials';

export interface ModelStats {
  triangles: number;
  box: THREE.Box3;
}

/** 决定一个部件的网格长什么样的全部数据；它不变，网格就不用重建 */
export function shapeKey(part: Part): string {
  const resize = part.resize ? `${part.resize}|${part.axes ?? ''}` : '';
  return `${JSON.stringify(part.prims)}|${part.stretch ?? ''}|${resize}`;
}

/** 没有手动拉伸时的样子（同一种形状拉伸得不一样的部件共用这一份）。带着现成的手的不算：手不跟着拉长，要整个重算（见 buildPartGeometry） */
const unstretched = (part: Part): Part | null => {
  if (!part.resize || part.grafts?.length) return null;
  const { resize: _resize, axes: _axes, ...plain } = part;
  return plain;
};

export class PartsModel {
  readonly root = new THREE.Group();
  private cache = new Map<string, THREE.BufferGeometry>();
  /** 一共照形状算过几次网格（采样、抽面那种费时间的；拉伸现成的不算） */
  builds = 0;

  /** 这个部件的网格：缓存里有就用缓存的；压扁拉长过的拿没拉长的那一份拉伸过去 */
  private geometryOf(part: Part, next: Map<string, THREE.BufferGeometry>): THREE.BufferGeometry {
    const key = shapeKey(part);
    const known = this.cache.get(key) ?? next.get(key);
    if (known) {
      next.set(key, known);
      return known;
    }
    const plain = unstretched(part);
    let geo: THREE.BufferGeometry;
    if (plain) {
      // 只有 resize 那一份：stretch 已经在没拉长的那一份里了（shapeMatrix 是先 stretch 再 resize）
      const m = shapeMatrix({ resize: part.resize, axes: part.axes })!;
      geo = this.geometryOf(plain, next).clone().applyMatrix4(new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1));
    } else {
      geo = buildPartGeometry(part);
      this.builds++;
    }
    next.set(key, geo);
    return geo;
  }

  constructor() {
    this.root.name = 'OC_BaseMesh';
  }

  update(figure: Figure): ModelStats {
    this.root.clear();
    this.root.scale.setScalar(figure.scale);
    const next = new Map<string, THREE.BufferGeometry>();
    const nodes = new Map<string, THREE.Object3D>();
    let triangles = 0;

    for (const part of figure.parts) {
      const geo = this.geometryOf(part, next);
      triangles += triangleCount(geo);

      const mesh = new THREE.Mesh(geo, MATERIALS[part.material]);
      mesh.name = part.name;
      mesh.userData.material = part.material;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(part.pos[0], part.pos[1], part.pos[2]);
      mesh.quaternion.set(part.quat[0], part.quat[1], part.quat[2], part.quat[3]);
      mesh.scale.setScalar(part.scale ?? 1);
      (part.parent ? nodes.get(part.parent) ?? this.root : this.root).add(mesh);
      nodes.set(part.name, mesh);
    }

    for (const [key, geo] of this.cache) if (!next.has(key)) geo.dispose();
    this.cache = next;

    this.root.updateMatrixWorld(true);
    return { triangles: Math.round(triangles), box: new THREE.Box3().setFromObject(this.root) };
  }

  /**
   * 导出用的副本：把所有缩放烘焙进顶点和位置，每个物体的缩放都是 1。
   * 这样导进 Blender 后不用再「应用缩放」，雕刻笔刷的大小也是对的。
   */
  baked(): THREE.Object3D {
    const copy = (src: THREE.Object3D, parentScale: number): THREE.Object3D => {
      const scale = parentScale * src.scale.x;
      let dst: THREE.Object3D;
      if (src instanceof THREE.Mesh) {
        const geo = (src.geometry as THREE.BufferGeometry).clone();
        geo.scale(scale, scale, scale);
        dst = new THREE.Mesh(geo, src.material);
      } else {
        dst = new THREE.Group();
      }
      dst.name = src.name;
      dst.position.copy(src.position).multiplyScalar(parentScale);
      dst.quaternion.copy(src.quaternion);
      for (const child of src.children) dst.add(copy(child, scale));
      return dst;
    };
    const out = copy(this.root, 1);
    out.updateMatrixWorld(true);
    return out;
  }

  /**
   * 导出用的原始数据：每个部件一张网格，顶点已经搬到世界坐标（米），不再有父子关系。
   * OBJ、STL 和带骨骼的 GLB 都从这里取。
   */
  bakedMeshes(): BakedMesh[] {
    this.root.updateMatrixWorld(true);
    const out: BakedMesh[] = [];
    this.root.traverse((o) => {
      // 没有形状的部件（「楚云萱躯干」另外八个胸腔的落脚处）不导出
      if (!(o instanceof THREE.Mesh) || !(o.geometry as THREE.BufferGeometry).attributes.position.count) return;
      const geo = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld);
      const positions = new Float32Array(geo.attributes.position.array);
      const normals = new Float32Array(geo.attributes.normal.array);
      // 有的几何体（翅膀）没有顶点下标，每三个顶点就是一个面
      const indices = geo.index
        ? Uint32Array.from(geo.index.array)
        : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
      geo.dispose();
      out.push({ name: o.name, material: (o.userData.material as Material | undefined) ?? 'clay', positions, normals, indices });
    });
    return out;
  }
}

export interface BakedMesh {
  name: string;
  material: Material;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/** 释放 baked() 生成的副本占用的网格 */
export function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) (o.geometry as THREE.BufferGeometry).dispose();
  });
}
