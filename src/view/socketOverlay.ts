/**
 * 在 3D 视图里把接口（连接点，见 geometry/sockets.ts）画出来：每个接口一个小点，隔着身体也看得见。
 * 只在挑「接到哪」、或者拖着部件找接口的时候显示；只是给人看的，不进截图、不进导出。
 */
import * as THREE from 'three';

export class SocketOverlay {
  readonly root = new THREE.Group();
  private readonly dots: THREE.Points;

  constructor() {
    this.root.name = 'Sockets';
    this.root.visible = false;
    const dot = new THREE.PointsMaterial({ color: 0x35d0c0, size: 9, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 });
    this.dots = new THREE.Points(new THREE.BufferGeometry(), dot);
    this.dots.renderOrder = 8;
    // 一把散开的点，包围球算出来没有意义：不做视锥剔除
    this.dots.frustumCulled = false;
    this.root.add(this.dots);
  }

  /** 换成这些点（世界里的位置，米）；传 null 就收起来 */
  update(points: readonly (readonly [number, number, number])[] | null) {
    this.root.visible = Boolean(points?.length);
    if (!points?.length) return;
    const flat = new Float32Array(points.length * 3);
    points.forEach((p, i) => flat.set(p, i * 3));
    this.dots.geometry.dispose();
    this.dots.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(flat, 3));
  }
}
