/**
 * 道具素材的小图：不另外存图片，素材的网格读进来以后现画一遍（每件一张，斜着从前上方看过去），
 * 画完就把这个临时的画布放掉。画不了（没有 WebGL）就返回空的，格子里只剩名字。
 */
import * as THREE from 'three';
import { PROP_ASSETS } from '../props/catalog';
import { propAssetShape } from '../props/library';

/** 小图一边多少像素（按两倍屏画） */
const PIXELS = 144;

export function renderPropThumbs(): Map<string, string> {
  const out = new Map<string, string>();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return out;
  }
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(PIXELS, PIXELS, false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a949a, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-1.2, 2.4, 1.6);
    scene.add(sun);
    const material = new THREE.MeshStandardMaterial({ color: 0xc9d0d3, roughness: 0.85, metalness: 0 });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    scene.add(mesh);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    // 从右前上方看：正面（+Z）和一个侧面都看得见
    const from = new THREE.Vector3(0.9, 0.75, 1.3).normalize();
    for (const asset of PROP_ASSETS) {
      const shape = propAssetShape(asset.id);
      if (!shape) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(shape.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(shape.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(shape.indices, 1));
      mesh.geometry = geometry;
      const centre = new THREE.Vector3(0, asset.size[1] / 2, 0);
      camera.position.copy(centre).addScaledVector(from, 20);
      camera.lookAt(centre);
      camera.updateMatrixWorld();
      // 八个角投到镜头的平面上，量出要多宽多高，四周留一点边
      let half = 0;
      const p = new THREE.Vector3();
      for (const x of [-0.5, 0.5]) {
        for (const y of [0, 1]) {
          for (const z of [-0.5, 0.5]) {
            p.set(x * asset.size[0], y * asset.size[1], z * asset.size[2]).applyMatrix4(camera.matrixWorldInverse);
            half = Math.max(half, Math.abs(p.x), Math.abs(p.y));
          }
        }
      }
      half *= 1.08;
      camera.left = -half;
      camera.right = half;
      camera.top = half;
      camera.bottom = -half;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      out.set(asset.id, renderer.domElement.toDataURL('image/png'));
      geometry.dispose();
    }
    material.dispose();
  } catch {
    out.clear();
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return out;
}
