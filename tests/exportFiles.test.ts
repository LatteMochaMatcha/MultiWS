import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, type V3, add, len, quatMul, rotate, sub } from '../src/geometry/vec';
import { type GlbMesh, writeGlb } from '../src/io/glb';
import { writeObj, writeStl } from '../src/io/meshFiles';
import { defaultSpec } from '../src/model/spec';
import { buildSkeleton } from '../src/rig/skeleton';
import { skinVertices } from '../src/rig/skin';
import { VOXEL, fuseParts } from '../src/sdf/fuse';

/** 一个四面体：4 个顶点、4 个三角面 */
const tetra = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  normals: new Float32Array([-0.577, -0.577, -0.577, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  triangles: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
};

/** 把 GLB 拆开：JSON 部分和二进制部分 */
function readGlb(glb: ArrayBuffer) {
  const view = new DataView(glb);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a);
  expect(jsonLength % 4).toBe(0);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength)));
  const binStart = 20 + jsonLength;
  const binLength = view.getUint32(binStart, true);
  expect(view.getUint32(binStart + 4, true)).toBe(0x004e4942);
  expect(binStart + 8 + binLength).toBe(glb.byteLength);
  expect(json.buffers).toEqual([{ byteLength: binLength }]);
  const bin = glb.slice(binStart + 8);
  /** 读出一个 accessor 的全部数字 */
  const read = (index: number): number[] => {
    const acc = json.accessors[index];
    const bv = json.bufferViews[acc.bufferView];
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type as 'SCALAR'];
    const n = acc.count * size;
    expect(bv.byteOffset % 4, `bufferView ${acc.bufferView} 没有按 4 字节对齐`).toBe(0);
    if (acc.componentType === 5126) return [...new Float32Array(bin, bv.byteOffset, n)];
    if (acc.componentType === 5123) return [...new Uint16Array(bin, bv.byteOffset, n)];
    return [...new Uint32Array(bin, bv.byteOffset, n)];
  };
  return { json, read };
}

interface NodeJson {
  translation: V3;
  rotation: Quat;
  children?: number[];
}

/** 顺着节点树把平移、旋转一层层乘下来：每个骨骼节点在世界里的位置和朝向 */
function poseOf(nodes: NodeJson[], root: number): Map<number, { at: V3; turn: Quat }> {
  const out = new Map<number, { at: V3; turn: Quat }>();
  const walk = (index: number, origin: V3, frame: Quat) => {
    const node = nodes[index];
    const at = add(origin, rotate(frame, node.translation));
    const turn = quatMul(frame, node.rotation);
    out.set(index, { at, turn });
    for (const child of node.children ?? []) walk(child, at, turn);
  };
  walk(root, [0, 0, 0], [0, 0, 0, 1]);
  return out;
}

describe('GLB', () => {
  it('不带骨骼：一个网格一个节点，位置、法线、三角面原样写进去', () => {
    const mesh: GlbMesh = { name: 'Tetra', positions: tetra.positions, normals: tetra.normals, indices: tetra.triangles };
    const { json, read } = readGlb(writeGlb([mesh]));
    expect(json.asset.version).toBe('2.0');
    expect(json.scenes[0].nodes).toEqual([0]);
    expect(json.nodes).toEqual([{ name: 'Tetra', mesh: 0 }]);
    expect(json.skins).toBeUndefined();
    const prim = json.meshes[0].primitives[0];
    expect(prim.mode).toBe(4);
    expect(read(prim.attributes.POSITION)).toEqual([...tetra.positions]);
    expect(read(prim.attributes.NORMAL)).toEqual([...tetra.normals]);
    expect(read(prim.indices)).toEqual([...tetra.triangles]);
    const pos = json.accessors[prim.attributes.POSITION];
    expect(pos.min).toEqual([0, 0, 0]);
    expect(pos.max).toEqual([1, 1, 1]);
    expect(pos.count).toBe(4);
    expect(prim.attributes.JOINTS_0).toBeUndefined();
  });

  it('材质：颜色换算成线性，相同的材质只写一份', () => {
    const base = { positions: tetra.positions, indices: tetra.triangles };
    const { json } = readGlb(
      writeGlb([
        { ...base, name: 'A', material: { name: 'Clay', color: 0xffffff } },
        { ...base, name: 'B', material: { name: 'Clay', color: 0xffffff } },
        { ...base, name: 'C', material: { name: 'Wing', color: 0x808080, doubleSided: true } },
      ]),
    );
    expect(json.materials).toHaveLength(2);
    expect(json.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([1, 1, 1, 1]);
    // sRGB 的 50% 灰换成线性大约是 0.216
    expect(json.materials[1].pbrMetallicRoughness.baseColorFactor[0]).toBeCloseTo(0.2159, 3);
    expect(json.materials[1].doubleSided).toBe(true);
    expect(json.meshes.map((m: { primitives: { material: number }[] }) => m.primitives[0].material)).toEqual([0, 0, 1]);
    expect(json.scenes[0].nodes).toEqual([0, 1, 2]);
  });

  it('带骨骼：骨骼是一棵只有平移的节点树，网格绑在蒙皮上', () => {
    const skeleton = {
      bones: [
        { name: 'Hips', parent: -1, head: [0, 1, 0] as [number, number, number], tail: [0, 1.2, 0] as [number, number, number], part: 'Torso' },
        { name: 'Spine', parent: 0, head: [0, 1.2, 0.1] as [number, number, number], tail: [0, 1.5, 0] as [number, number, number], part: 'Torso' },
        { name: 'Leg_L', parent: 0, head: [0.1, 0.9, 0] as [number, number, number], tail: [0.1, 0, 0] as [number, number, number], part: 'Leg' },
      ],
    };
    const mesh: GlbMesh = {
      name: 'Body',
      positions: tetra.positions,
      indices: tetra.triangles,
      joints: new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0]),
      weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0]),
    };
    const { json, read } = readGlb(writeGlb([mesh], { skeleton, rigName: 'OC_Rig' }));
    expect(json.nodes.slice(0, 3).map((n: { name: string }) => n.name)).toEqual(['Hips', 'Spine', 'Leg_L']);
    expect(json.nodes[0].children).toEqual([1, 2]);
    expect(json.nodes[1].children).toBeUndefined();
    // 根骨骼本来就朝上：不用转
    expect(json.nodes[0].translation).toEqual([0, 1, 0]);
    expect(json.nodes[0].rotation).toEqual([0, 0, 0, 1]);
    expect(json.nodes[3]).toEqual({ name: 'Body', mesh: 0, skin: 0 });
    // 场景里只挂根骨骼和网格；子骨骼通过 children 挂在父骨骼下面
    expect(json.scenes[0].nodes).toEqual([0, 3]);
    expect(json.skins).toHaveLength(1);
    expect(json.skins[0].name).toBe('OC_Rig');
    expect(json.skins[0].joints).toEqual([0, 1, 2]);
    expect(json.skins[0].skeleton).toBe(0);
    // 顺着节点树走下来：每根骨骼的原点落在它的起点上，自己的 +Y 轴指向它的终点
    const posed = poseOf(json.nodes, 0);
    skeleton.bones.forEach((bone, i) => {
      const { at, turn } = posed.get(i)!;
      at.forEach((v, k) => expect(v, bone.name).toBeCloseTo(bone.head[k], 9));
      const along = sub(bone.tail, bone.head);
      const y = rotate(turn, [0, 1, 0]);
      y.forEach((v, k) => expect(v, bone.name).toBeCloseTo(along[k] / len(along), 9));
    });
    // 绑定姿势的逆矩阵（按列存）：把骨骼的起点搬到原点，把终点搬到 +Y 轴上
    const inverse = read(json.skins[0].inverseBindMatrices);
    const apply = (m: number[], p: number[]) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
    skeleton.bones.forEach((bone, i) => {
      const m = inverse.slice(i * 16, i * 16 + 16);
      apply(m, bone.head).forEach((v) => expect(v, bone.name).toBeCloseTo(0, 6));
      const tail = apply(m, bone.tail);
      expect(tail[0], bone.name).toBeCloseTo(0, 6);
      expect(tail[1], bone.name).toBeCloseTo(len(sub(bone.tail, bone.head)), 6);
      expect(tail[2], bone.name).toBeCloseTo(0, 6);
      expect([m[3], m[7], m[11], m[15]]).toEqual([0, 0, 0, 1]);
    });
    const prim = json.meshes[0].primitives[0];
    expect(json.accessors[prim.attributes.JOINTS_0]).toMatchObject({ componentType: 5123, type: 'VEC4', count: 4 });
    expect(json.accessors[prim.attributes.WEIGHTS_0]).toMatchObject({ componentType: 5126, type: 'VEC4', count: 4 });
    expect(read(prim.attributes.JOINTS_0)).toEqual([...mesh.joints!]);
    expect(read(prim.attributes.WEIGHTS_0)).toEqual([...mesh.weights!]);
  });

  it('蒙皮数据和顶点数对不上时报错', () => {
    const skeleton = { bones: [{ name: 'Hips', parent: -1, head: [0, 0, 0] as [number, number, number], tail: [0, 1, 0] as [number, number, number], part: 'Torso' }] };
    const bad: GlbMesh = { name: 'Bad', positions: tetra.positions, indices: tetra.triangles, joints: new Uint16Array(4), weights: new Float32Array(4) };
    expect(() => writeGlb([bad], { skeleton })).toThrow(/对不上/);
  });

  it('整个角色带骨骼导出：结构完整，骨骼节点还原出来的位置和骨架一致', () => {
    const spec = defaultSpec();
    const figure = buildFigure(spec);
    const unit = { parts: figure.parts, scale: 1 };
    const fused = fuseParts(unit.parts, { voxel: VOXEL.draft, blend: spec.blend });
    const skin = skinVertices(unit, buildSkeleton(unit), fused.positions);
    const skeleton = buildSkeleton(figure);
    const positions = fused.positions.map((v) => v * figure.scale);
    const { json, read } = readGlb(
      writeGlb(
        [{ name: 'OC_BaseMesh', positions, normals: fused.normals, indices: fused.triangles, joints: skin.joints, weights: skin.weights }],
        { skeleton, rigName: 'OC_Rig' },
      ),
    );
    const n = skeleton.bones.length;
    expect(json.skins[0].joints).toHaveLength(n);
    expect(json.nodes).toHaveLength(n + 1);
    expect(json.nodes[n]).toEqual({ name: 'OC_BaseMesh', mesh: 0, skin: 0 });
    // 顺着节点树走下来：每根骨骼的原点是它的起点，自己的 +Y 轴指向它的终点
    const posed = poseOf(json.nodes, 0);
    expect(posed.size).toBe(n);
    skeleton.bones.forEach((bone, i) => {
      expect(json.nodes[i].name).toBe(bone.name);
      const { at, turn } = posed.get(i)!;
      at.forEach((v, k) => expect(v, bone.name).toBeCloseTo(bone.head[k], 9));
      const along = sub(bone.tail, bone.head);
      rotate(turn, [0, 1, 0]).forEach((v, k) => expect(v, bone.name).toBeCloseTo(along[k] / len(along), 9));
    });
    // 每个顶点的骨骼下标都在范围里，权重加起来是 1
    const prim = json.meshes[0].primitives[0];
    const joints = read(prim.attributes.JOINTS_0);
    const weights = read(prim.attributes.WEIGHTS_0);
    expect(Math.max(...joints)).toBeLessThan(n);
    for (let v = 0; v < weights.length; v += 4) {
      expect(weights[v] + weights[v + 1] + weights[v + 2] + weights[v + 3]).toBeCloseTo(1, 5);
    }
    // 身高对得上
    expect(json.accessors[prim.attributes.POSITION].max[1]).toBeCloseTo(figure.metrics.height, 1);
  });
});

describe('OBJ', () => {
  it('顶点、法线、面都写出来，下标从 1 开始', () => {
    const text = writeObj([{ name: 'Tetra', positions: tetra.positions, normals: tetra.normals, faces: tetra.triangles, faceSize: 3 }]);
    const lines = text.split('\n');
    expect(lines.filter((l) => l.startsWith('v '))).toEqual(['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'v 0 0 1']);
    expect(lines.filter((l) => l.startsWith('vn '))).toHaveLength(4);
    expect(lines.filter((l) => l.startsWith('f '))).toEqual(['f 1//1 3//3 2//2', 'f 1//1 2//2 4//4', 'f 1//1 4//4 3//3', 'f 2//2 3//3 4//4']);
    expect(lines).toContain('o Tetra');
    expect(lines[0].startsWith('#')).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('四边面按四边面写；没有法线时只写顶点下标', () => {
    const quad = { name: 'Quad', positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], faces: [0, 1, 2, 3], faceSize: 4 as const };
    expect(writeObj([quad]).split('\n').filter((l) => l.startsWith('f '))).toEqual(['f 1 2 3 4']);
  });

  it('多个物体：后一个的下标接着前一个往下数', () => {
    const one = { name: 'A', positions: tetra.positions, faces: tetra.triangles, faceSize: 3 as const };
    const lines = writeObj([one, { ...one, name: 'B' }]).split('\n');
    expect(lines.filter((l) => l.startsWith('o '))).toEqual(['o A', 'o B']);
    const faces = lines.filter((l) => l.startsWith('f '));
    expect(faces[4]).toBe('f 5 7 6');
    expect(faces).toHaveLength(8);
  });

  it('小数留 5 位，不出现科学计数法和 -0', () => {
    const text = writeObj([{ name: 'P', positions: [1.23456789, -0.0000001, 1e-9, 0, 0, 0, 0, 0, 0], faces: [0, 1, 2], faceSize: 3 }]);
    expect(text).toContain('v 1.23457 0 0');
    expect(text).not.toMatch(/e-|-0 /);
  });

  it('融合网格按四边面导出：面数就是四边面的个数', () => {
    const spec = defaultSpec();
    const fused = fuseParts(buildFigure(spec).parts, { voxel: VOXEL.draft, blend: spec.blend });
    const text = writeObj([{ name: 'OC_BaseMesh', positions: fused.positions, normals: fused.normals, faces: fused.quads, faceSize: 4 }]);
    const lines = text.split('\n');
    expect(lines.filter((l) => l.startsWith('v ')).length).toBe(fused.positions.length / 3);
    const faces = lines.filter((l) => l.startsWith('f '));
    expect(faces.length).toBe(fused.quads.length / 4);
    expect(faces.every((l) => l.split(' ').length === 5)).toBe(true);
  });
});

describe('STL', () => {
  it('二进制格式：80 字节文件头 + 面数 + 每个面 50 字节', () => {
    const stl = writeStl([{ positions: tetra.positions, triangles: tetra.triangles }]);
    expect(stl.byteLength).toBe(84 + 4 * 50);
    const view = new DataView(stl);
    expect(view.getUint32(80, true)).toBe(4);
    // 文件头不能以 solid 开头
    expect(new TextDecoder().decode(new Uint8Array(stl, 0, 5))).not.toBe('solid');
    // 坐标转成了 Z 朝上：(x, y, z) → (x, -z, y)。
    // 第一个面 0-2-1 原来在 z = 0 的平面上、法线朝 -Z（角色的背后），转完以后朝 +Y
    expect([view.getFloat32(84, true), view.getFloat32(88, true), view.getFloat32(92, true)]).toEqual([0, 1, 0]);
    // 三个顶点：原来的 (0,0,0)、(0,1,0)、(1,0,0)
    const vertex = (k: number) => [0, 4, 8].map((o) => view.getFloat32(84 + 12 + k * 12 + o, true));
    expect([vertex(0), vertex(1), vertex(2)]).toEqual([[0, 0, 0], [0, 0, 1], [1, 0, 0]]);
    expect(view.getUint16(84 + 48, true)).toBe(0);
  });

  it('角色导出来是站着的：Z 方向的高度就是身高，脚尖朝 -Y', () => {
    const spec = defaultSpec();
    const figure = buildFigure(spec);
    const fused = fuseParts(figure.parts, { voxel: VOXEL.draft, blend: spec.blend });
    const stl = writeStl([{ positions: fused.positions.map((v) => v * figure.scale), triangles: fused.triangles }]);
    const view = new DataView(stl);
    const count = view.getUint32(80, true);
    expect(count).toBe(fused.triangles.length / 3);
    let top = -Infinity;
    let toes = Infinity;
    let heels = -Infinity;
    for (let t = 0; t < count; t++) {
      for (let k = 0; k < 3; k++) {
        const o = 84 + t * 50 + 12 + k * 12;
        const y = view.getFloat32(o + 4, true);
        const z = view.getFloat32(o + 8, true);
        top = Math.max(top, z);
        if (z < 0.05) {
          toes = Math.min(toes, y);
          heels = Math.max(heels, y);
        }
      }
    }
    expect(top).toBeCloseTo(figure.metrics.height, 1);
    // 脚掌往前伸得比往后长
    expect(-toes).toBeGreaterThan(heels + 0.05);
  });

  it('多个网格的面写在一起；法线都是单位长度', () => {
    const one = { positions: tetra.positions, triangles: tetra.triangles };
    const stl = writeStl([one, one]);
    const view = new DataView(stl);
    expect(view.getUint32(80, true)).toBe(8);
    for (let t = 0; t < 8; t++) {
      const o = 84 + t * 50;
      expect(Math.hypot(view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true))).toBeCloseTo(1, 5);
    }
  });
});
