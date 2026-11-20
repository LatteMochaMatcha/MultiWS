/**
 * 道具写进导出的文件里（导出整个场景时带上，见 docs/props-plan.md）。
 * GLB：每件道具一个父节点，带着它在场景里的位置、朝向，网格是它自己坐标里的（原点在底面正中），
 * 导进 Blender 以后还能照原样挪、转。OBJ、STL 没有节点：点直接搬到场景里的位置（也不带贴图）。
 */
import { type PropShape, propWorldNormals, propWorldPoints, shapeOf } from '../geometry/propMesh';
import { type SceneProp, propQuat } from '../model/props';
import { realAssetFile } from '../props/library';
import { writeGlb } from './glb';
import type { GlbPart } from './mergeGlb';

/** 一批面单独拿出来：只留这批面用到的点 */
function slice(shape: PropShape, start: number, count: number) {
  const remap = new Map<number, number>();
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const from = shape.indices[start + i];
    let to = remap.get(from);
    if (to === undefined) remap.set(from, (to = remap.size));
    indices[i] = to;
  }
  const positions = new Float32Array(remap.size * 3);
  const normals = new Float32Array(remap.size * 3);
  const uvs = new Float32Array(remap.size * 2);
  for (const [from, to] of remap) {
    for (let k = 0; k < 3; k++) {
      positions[to * 3 + k] = shape.positions[from * 3 + k];
      normals[to * 3 + k] = shape.normals[from * 3 + k];
    }
    if (shape.uvs) {
      uvs[to * 2] = shape.uvs[from * 2];
      uvs[to * 2 + 1] = shape.uvs[from * 2 + 1];
    }
  }
  return { positions, normals, uvs, indices };
}

/**
 * 每件道具写成一个小 GLB，连同它该摆在哪（交给 mergeGlbs 和角色合在一起）。nameOf：文件里的物体名。
 * 写实款带着底色贴图出去（一个物体、每批面一个材质）；刷成灰色的、文件没读进来的和别的道具一样一个颜色
 */
export function propGlbParts(props: readonly SceneProp[], nameOf: (prop: SceneProp) => string): GlbPart[] {
  return props.map((prop) => {
    const name = nameOf(prop);
    const shape = shapeOf(prop);
    const file = prop.kind === 'asset' && !prop.gray ? realAssetFile(prop.asset) : undefined;
    let glb: ArrayBuffer;
    if (file && shape.uvs && shape.groups?.length) {
      const meshes = shape.groups.map((g) => {
        const m = file.materials[g.material];
        return {
          name,
          object: name,
          ...slice(shape, g.start, g.count),
          material: {
            name: `Prop_${file.id}_${m.name}`,
            color: 0xffffff,
            factor: [m.color[0], m.color[1], m.color[2], 1] as [number, number, number, number],
            ...(m.map === undefined ? {} : { image: m.map }),
            ...(m.doubleSided ? { doubleSided: true } : {}),
          },
        };
      });
      glb = writeGlb(meshes, { images: file.textures.map((x, i) => ({ name: `${file.id}_${i}`, mime: x.mime, bytes: x.bytes })) });
    } else {
      const hex = prop.color.slice(1);
      glb = writeGlb([
        { name, positions: shape.positions, normals: shape.normals, indices: shape.indices, material: { name: `Prop_${hex}`, color: Number.parseInt(hex, 16) } },
      ]);
    }
    return { glb, name, x: prop.pos[0], y: prop.pos[1], z: prop.pos[2], yaw: 0, rotation: propQuat(prop.rot) };
  });
}

/** 每件道具的网格，点和法线已经搬到场景里（OBJ、STL 用） */
export function propWorldShapes(
  props: readonly SceneProp[],
  nameOf: (prop: SceneProp) => string,
): { name: string; positions: Float32Array; normals: Float32Array; triangles: Uint32Array }[] {
  return props.map((prop) => {
    const shape = shapeOf(prop);
    return { name: nameOf(prop), positions: propWorldPoints(prop, shape), normals: propWorldNormals(prop, shape), triangles: shape.indices };
  });
}

/** 这些道具一共多少个三角面 */
export const propTriangles = (props: readonly SceneProp[]): number =>
  props.reduce((n, prop) => n + shapeOf(prop).indices.length / 3, 0);
