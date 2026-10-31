/**
 * 在 3D 视图里把骨架画出来：每根骨骼一条线（从起点到终点），起点处一个小点。
 * 隔着身体也看得见，只是给人看的，不进截图、不进导出。
 */
import * as THREE from 'three';
import type { Skeleton } from '../rig/skeleton';

export class BoneOverlay {
  readonly root = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private readonly joints: THREE.Points;

  constructor() {
    this.root.name = 'Bones';
    this.root.visible = false;
    const line = new THREE.LineBasicMaterial({ color: 0xff8a3d, depthTest: false, depthWrite: false, transparent: true });
    const dot = new THREE.PointsMaterial({
      color: 0xffd9a8,
      size: 6,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), line);
    this.joints = new THREE.Points(new THREE.BufferGeometry(), dot);
    this.lines.renderOrder = 6;
    this.joints.renderOrder = 7;
    // 骨架的线很细，包围球算出来没有意义：不做视锥剔除
    this.lines.frustumCulled = false;
    this.joints.frustumCulled = false;
    this.root.add(this.lines, this.joints);
  }

  /** 换成新的骨架；传 null 就收起来 */
  update(skeleton: Skeleton | null) {
    this.root.visible = Boolean(skeleton);
    if (!skeleton) return;
    const n = skeleton.bones.length;
    const segments = new Float32Array(n * 6);
    const heads = new Float32Array(n * 3);
    skeleton.bones.forEach((bone, i) => {
      segments.set(bone.head, i * 6);
      segments.set(bone.tail, i * 6 + 3);
      heads.set(bone.head, i * 3);
    });
    this.lines.geometry.dispose();
    this.joints.geometry.dispose();
    this.lines.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(segments, 3));
    this.joints.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(heads, 3));
  }
}
