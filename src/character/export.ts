/**
 * 把拼好的成品角色写成文件用的数据：带贴图（和骨骼）的 GLB，或者只要形状的 OBJ / STL。纯函数。
 */
import { type GlbMaterial, type GlbMesh, writeGlb } from '../io/glb';
import type { Skeleton } from '../rig/skeleton';
import type { CharacterBone, CharacterBuild } from './assemble';
import { type FaceWeights, applyFaces } from './face';
import { CHARACTER_BLEND, skinInPlace } from './pose';
import type { Chunk } from './source';

/** 骨架，换成工坊里通用的那种写法（画骨骼示意线、写 GLB 都用它） */
export const characterSkeleton = (build: CharacterBuild): Skeleton => ({
  bones: build.bones.map((bone) => ({ ...bone, part: '' })),
});

/**
 * 摆好的样子定成新的静止姿势（导出「摆姿势」里看到的样子用）：
 * 表情先加在静止的样子上，顶点再跟着骨骼搬过去；骨骼换成摆好以后的那一副。
 * matrices：每根骨骼的蒙皮矩阵；bones：摆好以后的骨架；faces：每张脸的表情。
 */
export function poseBuild(
  build: CharacterBuild,
  matrices: Float64Array,
  bones: CharacterBone[],
  faces?: Readonly<Record<string, FaceWeights>>,
): CharacterBuild {
  return {
    ...build,
    bones,
    meshes: build.meshes.map((chunk) => {
      const positions = chunk.positions.slice();
      const normals = chunk.normals.slice();
      applyFaces(build, chunk, faces, positions, normals);
      // 搬的时候法线会归一。和屏幕上摆姿势时一样混（见 CHARACTER_BLEND）
      skinInPlace(CHARACTER_BLEND, positions, normals, chunk.joints, chunk.weights, matrices);
      return { ...chunk, positions, normals };
    }),
  };
}

/** 同一个材质的几块网格并成一块：导进 Blender 是一个物体、每个材质一个材质槽 */
export function mergeByMaterial(build: CharacterBuild): Chunk[] {
  const groups = new Map<number, Chunk[]>();
  for (const chunk of build.meshes) {
    const list = groups.get(chunk.material);
    if (list) list.push(chunk);
    else groups.set(chunk.material, [chunk]);
  }
  return [...groups].map(([material, list]) => {
    const vertices = list.reduce((sum, chunk) => sum + chunk.positions.length / 3, 0);
    const merged: Chunk = {
      name: build.materials[material].name,
      material,
      positions: new Float32Array(vertices * 3),
      normals: new Float32Array(vertices * 3),
      uvs: new Float32Array(vertices * 2),
      joints: new Uint16Array(vertices * 4),
      weights: new Float32Array(vertices * 4),
      indices: new Uint32Array(list.reduce((sum, chunk) => sum + chunk.indices.length, 0)),
    };
    // 里面有脸上的网格：哪个顶点是脸上的第几个、属于第几张脸，也跟着并过来（不是脸上的顶点记 -1）
    if (list.some((chunk) => chunk.faceVertex && chunk.faceOf)) {
      merged.faceVertex = new Int32Array(vertices).fill(-1);
      merged.faceOf = new Uint8Array(vertices);
    }
    let v = 0;
    let i = 0;
    for (const chunk of list) {
      if (chunk.faceVertex && chunk.faceOf) {
        merged.faceVertex!.set(chunk.faceVertex, v);
        merged.faceOf!.set(chunk.faceOf, v);
      }
      merged.positions.set(chunk.positions, v * 3);
      merged.normals.set(chunk.normals, v * 3);
      merged.uvs.set(chunk.uvs, v * 2);
      merged.joints.set(chunk.joints, v * 4);
      merged.weights.set(chunk.weights, v * 4);
      for (let k = 0; k < chunk.indices.length; k++) merged.indices[i + k] = chunk.indices[k] + v;
      v += chunk.positions.length / 3;
      i += chunk.indices.length;
    }
    return merged;
  });
}

/** 写成 GLB。rig：带不带骨骼和蒙皮权重；copyright：角色的许可要求署名时，那一句署名 */
export function characterGlb(build: CharacterBuild, options: { rig: boolean; copyright?: string }): ArrayBuffer {
  const meshes: GlbMesh[] = mergeByMaterial(build).map((chunk) => {
    const m = build.materials[chunk.material];
    const material: GlbMaterial = {
      name: m.name,
      color: 0xffffff,
      factor: m.color,
      ...(m.image >= 0 ? { image: m.image } : {}),
      alphaMode: m.alpha,
      alphaCutoff: m.cutoff,
      doubleSided: m.doubleSided,
      // 带贴图的是角色本身，贴图里已经画好了明暗；后加的单色部件（尾巴、翅膀）照常受光照
      unlit: m.image >= 0,
    };
    return {
      name: chunk.name,
      object: 'OC_Character',
      positions: chunk.positions,
      normals: chunk.normals,
      uvs: chunk.uvs,
      indices: chunk.indices,
      ...(options.rig ? { joints: chunk.joints, weights: chunk.weights } : {}),
      material,
    };
  });
  return writeGlb(meshes, {
    images: build.images,
    ...(options.copyright ? { copyright: options.copyright } : {}),
    ...(options.rig ? { skeleton: characterSkeleton(build), rigName: 'OC_Rig' } : {}),
  });
}

/** 只要形状（OBJ、STL 存不了贴图和骨骼）：所有网格并成一块 */
export function characterShape(build: CharacterBuild): { positions: Float32Array; normals: Float32Array; triangles: Uint32Array } {
  const vertices = build.meshes.reduce((sum, chunk) => sum + chunk.positions.length / 3, 0);
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const triangles = new Uint32Array(build.meshes.reduce((sum, chunk) => sum + chunk.indices.length, 0));
  let v = 0;
  let i = 0;
  for (const chunk of build.meshes) {
    positions.set(chunk.positions, v * 3);
    normals.set(chunk.normals, v * 3);
    for (let k = 0; k < chunk.indices.length; k++) triangles[i + k] = chunk.indices[k] + v;
    v += chunk.positions.length / 3;
    i += chunk.indices.length;
  }
  return { positions, normals, triangles };
}
