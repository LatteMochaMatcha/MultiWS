import { describe, expect, it } from 'vitest';
import { writeGlb } from '../src/io/glb';
import { mergeGlbs, readGlb } from '../src/io/mergeGlb';

const tri = (dx = 0) => ({
  positions: new Float32Array([dx, 0, 0, dx + 1, 0, 0, dx, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
});

const skeleton = {
  bones: [
    { name: 'Hips', parent: -1, head: [0, 1, 0] as [number, number, number], tail: [0, 1.2, 0] as [number, number, number], part: '' },
    { name: 'Spine', parent: 0, head: [0, 1.2, 0] as [number, number, number], tail: [0, 1.5, 0] as [number, number, number], part: '' },
  ],
};

describe('几个 GLB 合成一个', () => {
  it('每个角色一个父节点，摆在各自的位置；网格、材质的下标挪过', () => {
    const a = writeGlb([{ name: 'A', ...tri(), material: { name: 'Clay', color: 0xffffff } }]);
    const b = writeGlb([
      { name: 'B1', ...tri(2), material: { name: 'Red', color: 0xff0000 } },
      { name: 'B2', ...tri(3), material: { name: 'Blue', color: 0x0000ff } },
    ]);
    const merged = mergeGlbs([
      { glb: a, name: '甲', x: 0, z: 0, yaw: 0 },
      { glb: b, name: '乙', x: 1.5, z: -0.5, yaw: 90 },
    ]);
    const { json, bin } = readGlb(merged);
    const ga = readGlb(a).json;
    const gb = readGlb(b).json;
    expect(json.scenes[0].nodes).toHaveLength(2);
    const [na, nb] = json.scenes[0].nodes.map((i: number) => json.nodes[i]);
    expect(na.name).toBe('甲');
    expect(nb.name).toBe('乙');
    expect(nb.translation).toEqual([1.5, 0, -0.5]);
    expect(nb.rotation[1]).toBeCloseTo(Math.SQRT1_2);
    expect(nb.rotation[3]).toBeCloseTo(Math.SQRT1_2);
    expect(json.meshes).toHaveLength(ga.meshes.length + gb.meshes.length);
    expect(json.materials).toHaveLength(ga.materials.length + gb.materials.length);
    expect(json.accessors).toHaveLength(ga.accessors.length + gb.accessors.length);
    // 乙下面挂的节点指着乙自己的网格，网格的材质是乙自己的
    const meshNames = (nb.children as number[]).map((c) => json.meshes[json.nodes[c].mesh]);
    const matNames = meshNames.flatMap((m: { primitives: { material: number }[] }) => m.primitives.map((p) => json.materials[p.material].name));
    expect(matNames.sort()).toEqual(['Blue', 'Red']);
    // 读回乙的第一个三角形的顶点：数据接对了
    const prim = json.meshes[json.nodes[nb.children[0]].mesh].primitives[0];
    const acc = json.accessors[prim.attributes.POSITION];
    const view = json.bufferViews[acc.bufferView];
    const first = new Float32Array(bin.buffer.slice(bin.byteOffset + view.byteOffset + (acc.byteOffset ?? 0), bin.byteOffset + view.byteOffset + (acc.byteOffset ?? 0) + 12));
    expect([...first].map((v) => Math.round(v))).toEqual(expect.arrayContaining([0, 0]));
    expect(json.buffers[0].byteLength).toBe(bin.length);
  });

  it('带骨骼的：每个角色一副骨架，关节指着自己的骨骼节点', () => {
    const rigged = (dx: number) =>
      writeGlb(
        [{ name: 'Body', ...tri(dx), joints: new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]) }],
        { skeleton, rigName: 'Rig' },
      );
    const merged = mergeGlbs([
      { glb: rigged(0), name: 'A', x: 0, z: 0, yaw: 0 },
      { glb: rigged(1), name: 'B', x: 2, z: 0, yaw: 0 },
    ]);
    const { json } = readGlb(merged);
    expect(json.skins).toHaveLength(2);
    for (const [k, skin] of (json.skins as { joints: number[]; skeleton: number }[]).entries()) {
      const holder = json.nodes[json.scenes[0].nodes[k]];
      expect(skin.joints.map((j) => json.nodes[j].name)).toEqual(['Hips', 'Spine']);
      // 骨架的根挂在这个角色的父节点下面
      expect(holder.children).toContain(skin.skeleton);
    }
    expect(json.skins[0].joints[0]).not.toBe(json.skins[1].joints[0]);
    // 带蒙皮的网格节点指着自己那副
    const skinned = (json.nodes as { skin?: number }[]).filter((n) => n.skin !== undefined).map((n) => n.skin);
    expect(skinned.sort()).toEqual([0, 1]);
  });

  it('署名合在一起，不重复', () => {
    const a = writeGlb([{ name: 'A', ...tri() }], { copyright: 'X' });
    const b = writeGlb([{ name: 'B', ...tri() }], { copyright: 'X' });
    const c = writeGlb([{ name: 'C', ...tri() }], { copyright: 'Y' });
    const { json } = readGlb(mergeGlbs([a, b, c].map((glb, i) => ({ glb, name: String(i), x: i, z: 0, yaw: 0 }))));
    expect(json.asset.copyright).toBe('X；Y');
  });
});
