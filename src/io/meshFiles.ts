/**
 * OBJ 和 STL 的写出器。纯函数，不依赖浏览器。
 * 单位都是米。OBJ 的坐标原样写出（Y 朝上、正面朝 +Z）；STL 转成 Z 朝上，原因见 writeStl。
 */

export interface PolyMesh {
  name: string;
  positions: ArrayLike<number>;
  normals?: ArrayLike<number>;
  /** 面的顶点下标，每 faceSize 个一个面 */
  faces: ArrayLike<number>;
  /** 3 是三角面，4 是四边面（OBJ 存得下四边面，导进 Blender 布线更干净） */
  faceSize: 3 | 4;
  /** 另外还有一批三角面（四边面的网格上缝着的手），每 3 个下标一个 */
  triangles?: ArrayLike<number>;
}

/** 小数点后留 5 位（0.01 毫米），去掉多余的 0 */
const num = (v: number) => String(Math.round(v * 1e5) / 1e5 + 0);

/** Wavefront OBJ：每个网格一个物体（o），带逐顶点法线 */
export function writeObj(meshes: PolyMesh[]): string {
  const lines: string[] = ['# OC Basemesh Workshop v2', '# unit: meter, up: +Y, front: +Z'];
  let base = 1;
  for (const mesh of meshes) {
    const { positions, normals, faces, faceSize } = mesh;
    const count = positions.length / 3;
    lines.push(`o ${mesh.name}`);
    for (let i = 0; i < count; i++) {
      lines.push(`v ${num(positions[i * 3])} ${num(positions[i * 3 + 1])} ${num(positions[i * 3 + 2])}`);
    }
    if (normals) {
      for (let i = 0; i < count; i++) {
        lines.push(`vn ${num(normals[i * 3])} ${num(normals[i * 3 + 1])} ${num(normals[i * 3 + 2])}`);
      }
    }
    // 开平滑着色：不然每个面都是一块平的
    lines.push('s 1');
    for (const [list, size] of [[faces, faceSize], [mesh.triangles ?? [], 3]] as const) {
      for (let f = 0; f < list.length; f += size) {
        let line = 'f';
        for (let k = 0; k < size; k++) {
          const index = list[f + k] + base;
          line += normals ? ` ${index}//${index}` : ` ${index}`;
        }
        lines.push(line);
      }
    }
    base += count;
  }
  lines.push('');
  return lines.join('\n');
}

export interface TriMesh {
  positions: ArrayLike<number>;
  triangles: ArrayLike<number>;
}

/**
 * 二进制 STL：所有网格的三角面写在一起（STL 里没有物体、没有单位的概念）。
 *
 * STL 文件里不记哪个轴朝上，Blender 和切片软件都默认 Z 朝上。
 * 所以这里和 GLB / OBJ 不一样，把坐标转成 Z 朝上、正面朝 -Y 再写出去：
 * 这样导进去角色是站着的，朝向也和 GLB 导入以后一样。
 */
export function writeStl(meshes: TriMesh[]): ArrayBuffer {
  const total = meshes.reduce((n, m) => n + m.triangles.length / 3, 0);
  const out = new ArrayBuffer(84 + total * 50);
  const view = new DataView(out);
  // 文件头 80 个字节，随便写点说明；不能以 "solid" 开头，否则有的软件会当成文本格式来读
  const title = new TextEncoder().encode('OC Basemesh Workshop v2 - unit: meter, up: +Z, front: -Y');
  new Uint8Array(out, 0, 80).set(title.subarray(0, 80));
  view.setUint32(80, total, true);
  /** 写一个向量：(x, y, z) → (x, -z, y) */
  const put = (at: number, x: number, y: number, z: number) => {
    view.setFloat32(at, x, true);
    view.setFloat32(at + 4, -z + 0, true);
    view.setFloat32(at + 8, y, true);
  };
  let offset = 84;
  for (const { positions, triangles } of meshes) {
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t] * 3;
      const b = triangles[t + 1] * 3;
      const c = triangles[t + 2] * 3;
      const ux = positions[b] - positions[a];
      const uy = positions[b + 1] - positions[a + 1];
      const uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a];
      const vy = positions[c + 1] - positions[a + 1];
      const vz = positions[c + 2] - positions[a + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      put(offset, nx / l, ny / l, nz / l);
      put(offset + 12, positions[a], positions[a + 1], positions[a + 2]);
      put(offset + 24, positions[b], positions[b + 1], positions[b + 2]);
      put(offset + 36, positions[c], positions[c + 1], positions[c + 2]);
      offset += 50;
    }
  }
  return out;
}
