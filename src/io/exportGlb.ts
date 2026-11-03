import type { Object3D } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

/**
 * 把场景里的一棵物体树导出成 GLB。
 * glTF 的约定正好是：单位米、Y 朝上、正面朝 +Z；Blender 导入时会自动转成它自己的 Z 朝上。
 * copyright：用到了要求署名的素材时写进文件的署名（asset.copyright）
 */
export async function exportGlb(root: Object3D, copyright?: string): Promise<Blob> {
  const result = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true, ...(copyright ? { copyright } : {}) });
  if (!(result instanceof ArrayBuffer)) throw new Error('导出器没有返回二进制数据');
  return new Blob([result], { type: 'model/gltf-binary' });
}
