import * as THREE from 'three';
import type { Material } from '../geometry/figure';

/** 三种材质的名字、底色、是不是双面：屏幕上和导出的文件里用同一份 */
export const MATERIAL_INFO: Record<Material, { name: string; color: number; doubleSided?: boolean }> = {
  clay: { name: 'Clay', color: 0xe7eaeb },
  eye: { name: 'Eye', color: 0x283034 },
  wing: { name: 'ClayWing', color: 0xe7eaeb, doubleSided: true },
};

/** 白模用的三种材质，两种网格模式共用 */
export const MATERIALS: Record<Material, THREE.Material> = {
  clay: new THREE.MeshStandardMaterial({ color: MATERIAL_INFO.clay.color, roughness: 0.78, metalness: 0, name: 'Clay' }),
  eye: new THREE.MeshStandardMaterial({ color: MATERIAL_INFO.eye.color, roughness: 0.35, name: 'Eye' }),
  wing: new THREE.MeshStandardMaterial({
    color: MATERIAL_INFO.wing.color,
    roughness: 0.8,
    side: THREE.DoubleSide,
    name: 'ClayWing',
  }),
};
