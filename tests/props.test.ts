import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dropHeight, propBounds, propShape, propWorldPoints, shapeOf } from '../src/geometry/propMesh';
import {
  PROP_COLOR,
  PROP_KINDS,
  PROP_SIZE,
  type PropKind,
  type SceneProp,
  addProp,
  clampProp,
  copyProp,
  makeAssetProp,
  makeProp,
  nextPropId,
  normalizeProps,
  propBaseSize,
  propPoint,
  propQuat,
  propRotation,
  removeProp,
  sameProps,
  updateProp,
} from '../src/model/props';
import { mergeGlbs, readGlb } from '../src/io/mergeGlb';
import { propGlbParts, propTriangles, propWorldShapes } from '../src/io/propFiles';
import { normalizeScene, serializeScene, singleScene } from '../src/model/scene';
import { defaultSpec, normalizeSpec, serializeSpec } from '../src/model/spec';
import { PROP_ASSETS, PROP_ASSET_GROUPS, propAsset } from '../src/props/catalog';
import { installPropAssets, propAssetShape, propAssetsReady } from '../src/props/library';
import { propAssetLabel } from '../src/view/propNames';

const at = (x = 0, z = 0, yaw = 0) => ({ x, z, yaw });
const prop = (kind: PropKind, patch: Partial<SceneProp> = {}, id = 'p1'): SceneProp => clampProp({ ...makeProp([], kind, at()), id, ...patch });

describe('道具：增删、复制、改', () => {
  it('新做的基本体是默认尺寸、白模的灰色，底面贴地', () => {
    const p = makeProp([], 'pole', at(1, -2, 30));
    expect(p).toEqual({ id: 'p1', name: '', kind: 'pole', size: PROP_SIZE.pole, pos: [1, 0, -2], rot: [0, 30, 0], color: PROP_COLOR });
  });

  it('编号不重复，删了也不复用', () => {
    let props = addProp([], makeProp([], 'box', at()));
    props = addProp(props, makeProp(props, 'ball', at()));
    props = addProp(props, makeProp(props, 'wall', at()));
    expect(props.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    props = removeProp(props, 'p2');
    expect(nextPropId(props)).toBe('p4');
    expect(removeProp(props, 'p9')).toBe(props);
  });

  it('改的时候收进范围：位置 ±20 米、尺寸 1 厘米–10 米、角度绕回 ±180°', () => {
    const props = updateProp([prop('box')], 'p1', { pos: [99, -99, 0.12345], size: [0, 50, 0.3], rot: [190, -540, 0.04], name: '  高 脚  凳 ', color: '#ABCDEF' });
    expect(props[0].pos).toEqual([20, -5, 0.123]);
    expect(props[0].size).toEqual([0.01, 10, 0.3]);
    expect(props[0].rot).toEqual([-170, 180, 0]);
    expect(props[0].name).toBe('高 脚 凳');
    expect(props[0].color).toBe('#abcdef');
  });

  it('复制出来的挪开一点，别的都一样', () => {
    const { props, id } = copyProp([prop('stand', { pos: [1, 0.5, 2], rot: [0, 45, 10], color: '#112233' })], 'p1', { x: 0.3, z: 0 });
    expect(id).toBe('p2');
    expect(props[1]).toEqual({ ...props[0], id: 'p2', pos: [1.3, 0.5, 2] });
    expect(copyProp(props, 'nope', { x: 0, z: 0 }).id).toBeNull();
  });

  it('两份清单内容一样就算一回事', () => {
    expect(sameProps([prop('box')], [prop('box')])).toBe(true);
    expect(sameProps([prop('box')], [prop('box', { pos: [0, 0.001, 0] })])).toBe(false);
  });
});

describe('道具：存读', () => {
  const specData = (spec: ReturnType<typeof defaultSpec>, text: string) => JSON.parse(serializeSpec(spec, text));
  const readSpec = (raw: unknown) => ({ spec: normalizeSpec(raw), text: '' });

  it('认不出种类的丢掉，编号重复的重新编，坏的数换成默认', () => {
    const props = normalizeProps([
      { id: 'p2', kind: 'box', size: [1, 'x', null], pos: [0.5], rot: 'no', color: 'red' },
      { id: 'p2', kind: 'pole' },
      { id: 'p7', kind: 'sofa' },
      null,
      { kind: 'ball', id: 12 },
    ]);
    expect(props.map((p) => [p.id, p.kind])).toEqual([
      ['p2', 'box'],
      ['p1', 'pole'],
      ['p3', 'ball'],
    ]);
    expect(props[0].size).toEqual([1, 0.45, 0.45]);
    expect(props[0].pos).toEqual([0.5, 0, 0]);
    expect(props[0].rot).toEqual([0, 0, 0]);
    expect(props[0].color).toBe(PROP_COLOR);
    expect(normalizeProps('oops')).toEqual([]);
  });

  it('场景文件带着道具存、读回来一样；没有道具时文件里没有这一项', () => {
    const empty = singleScene(defaultSpec(), '');
    expect(JSON.parse(serializeScene(empty, specData))).not.toHaveProperty('props');
    const scene = { ...empty, props: [prop('pole', { pos: [0.4, 0, 0.2] }), prop('box', { rot: [0, 90, 0] }, 'p2')] };
    const back = normalizeScene(JSON.parse(serializeScene(scene, specData)), readSpec);
    expect(back?.props).toEqual(scene.props);
  });

  it('加道具以前的场景文件照样读，道具是空的', () => {
    const old = JSON.parse(serializeScene(singleScene(defaultSpec(), ''), specData));
    expect(normalizeScene(old, readSpec)?.props).toEqual([]);
  });
});

describe('道具：网格', () => {
  it('每种基本体的盒子正好是它的尺寸，底面在 y = 0', () => {
    for (const kind of PROP_KINDS) {
      const { min, max } = propBounds(prop(kind, { size: [0.6, 1.2, 0.4] }));
      expect(min[0]).toBeCloseTo(-0.3, 5);
      expect(max[0]).toBeCloseTo(0.3, 5);
      expect(min[1]).toBeCloseTo(0, 5);
      expect(max[1]).toBeCloseTo(1.2, 5);
      expect(min[2]).toBeCloseTo(-0.2, 5);
      expect(max[2]).toBeCloseTo(0.2, 5);
    }
  });

  it('面都朝外：每个面的朝向和它几个点的法线同一边，法线从正中往外指', () => {
    for (const kind of PROP_KINDS) {
      const size = [0.6, 1.2, 0.4] as [number, number, number];
      const { positions: p, normals: n, indices } = propShape(kind, size);
      const centre = [0, size[1] / 2, 0];
      for (let i = 0; i < indices.length; i += 3) {
        const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
        const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
        const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
        const face = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const mid = [(p[a] + p[b] + p[c]) / 3 - centre[0], (p[a + 1] + p[b + 1] + p[c + 1]) / 3 - centre[1], (p[a + 2] + p[b + 2] + p[c + 2]) / 3 - centre[2]];
        expect(face[0] * mid[0] + face[1] * mid[1] + face[2] * mid[2], `${kind} 第 ${i / 3} 个面`).toBeGreaterThan(0);
        expect(face[0] * n[a] + face[1] * n[a + 1] + face[2] * n[a + 2], `${kind} 第 ${i / 3} 个面的法线`).toBeGreaterThan(0);
      }
      for (let i = 0; i < n.length; i += 3) expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 5);
    }
  });

  it('旋转的顺序：先倾斜再转朝向（和 three.js 的 YXZ 一样）', () => {
    // 朝向转 90°：自己的 +Z（前）转到场景的 +X
    const turned = prop('box', { rot: [0, 90, 0], pos: [1, 0, 0] });
    const front = propPoint(turned, [0, 0, 1]);
    expect(front[0]).toBeCloseTo(2, 6);
    expect(front[2]).toBeCloseTo(0, 6);
    // 往前倾 90°：自己的 +Y（上）倒向 +Z（前）
    const tipped = propPoint(prop('pole', { rot: [90, 0, 0] }), [0, 1, 0]);
    expect(tipped[1]).toBeCloseTo(0, 6);
    expect(tipped[2]).toBeCloseTo(1, 6);
    // 两样一起：先倒向自己的前面，再跟着朝向转到 +X
    const both = propPoint(prop('pole', { rot: [90, 90, 0] }), [0, 1, 0]);
    expect(both[0]).toBeCloseTo(1, 6);
    expect(both[1]).toBeCloseTo(0, 6);
    expect(both[2]).toBeCloseTo(0, 6);
  });

  it('搬到场景里的点数和网格一样多', () => {
    const p = prop('ball', { pos: [3, 1, -2] });
    expect(propWorldPoints(p).length).toBe(shapeOf(p).positions.length);
  });
});

describe('道具：导出', () => {
  const chair = prop('box', { name: '椅子', size: [0.4, 0.5, 0.6], pos: [1, 0.2, -2], rot: [30, 70, -15], color: '#336699' });

  it('四元数和旋转矩阵是同一个旋转', () => {
    for (const rot of [[30, 70, -15], [90, 0, 0], [0, 180, 0], [-45, 120, 60]] as [number, number, number][]) {
      const [x, y, z, w] = propQuat(rot);
      expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 9);
      const m = propRotation(rot);
      // 四元数转一个向量：v + 2w(q×v) + 2q×(q×v)
      const turn = (v: number[]) => {
        const c1 = [y * v[2] - z * v[1], z * v[0] - x * v[2], x * v[1] - y * v[0]];
        const c2 = [y * c1[2] - z * c1[1], z * c1[0] - x * c1[2], x * c1[1] - y * c1[0]];
        return v.map((a, i) => a + 2 * w * c1[i] + 2 * c2[i]);
      };
      for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        const byMatrix = [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
        turn(v).forEach((a, i) => expect(a).toBeCloseTo(byMatrix[i], 9));
      }
    }
  });

  it('GLB：每件道具一个父节点，带着位置、朝向，网格挂在下面，颜色写进材质', () => {
    const parts = propGlbParts([chair, prop('ball', {}, 'p2')], (p) => p.name || p.id);
    const { json } = readGlb(mergeGlbs(parts));
    const roots = (json.scenes[0].nodes as number[]).map((i) => json.nodes[i]);
    expect(roots.map((n) => n.name)).toEqual(['椅子', 'p2']);
    expect(roots[0].translation).toEqual([1, 0.2, -2]);
    roots[0].rotation.forEach((v: number, i: number) => expect(v).toBeCloseTo(propQuat([30, 70, -15])[i], 9));
    expect(roots[1].translation).toEqual([0, 0, 0]);
    const child = json.nodes[roots[0].children[0]];
    expect(child.name).toBe('椅子');
    expect(json.meshes).toHaveLength(2);
    // #336699 的红色通道 0x33 换成线性
    expect(json.materials[0].pbrMetallicRoughness.baseColorFactor[0]).toBeCloseTo(((0x33 / 255 + 0.055) / 1.055) ** 2.4, 6);
  });

  it('合 GLB 时不给高度、朝向的（角色）照旧站在地上、只绕竖直轴转', () => {
    const [part] = propGlbParts([prop('box')], () => 'x');
    const { json } = readGlb(mergeGlbs([{ glb: part.glb, name: '甲', x: 1, z: 2, yaw: 90 }]));
    expect(json.nodes[0].translation).toEqual([1, 0, 2]);
    expect(json.nodes[0].rotation[1]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(json.nodes[0].rotation[3]).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('OBJ、STL 用的网格：点搬到场景里，法线跟着转、还是单位长', () => {
    const [shape] = propWorldShapes([chair], (p) => p.name);
    expect(shape.name).toBe('椅子');
    expect(Array.from(shape.positions)).toEqual(Array.from(propWorldPoints(chair)));
    for (let i = 0; i < shape.normals.length; i += 3) expect(Math.hypot(shape.normals[i], shape.normals[i + 1], shape.normals[i + 2])).toBeCloseTo(1, 5);
    // 顶面的法线（自己坐标里朝上）转过去以后，和「自己的上」在场景里的方向一样
    const up = propPoint({ ...chair, pos: [0, 0, 0] }, [0, 1, 0]);
    const top = shapeOf(chair).normals.findIndex((v, i, all) => i % 3 === 1 && v === 1 && all[i - 1] === 0) - 1;
    [0, 1, 2].forEach((k) => expect(shape.normals[top + k]).toBeCloseTo(up[k], 6));
    expect(propTriangles([chair, prop('box', {}, 'p2')])).toBe(24);
  });
});

describe('道具：落到下面', () => {
  it('悬着的落到地面，埋在地下的拉回地面', () => {
    expect(dropHeight(prop('box', { pos: [0, 1.5, 0] }), [])).toBeCloseTo(0, 6);
    expect(dropHeight(prop('box', { pos: [0, -0.3, 0] }), [])).toBeCloseTo(0, 6);
  });

  it('正下方有别的道具就落在它上面，不在正下方的不算', () => {
    const table = prop('box', { size: [1.2, 0.75, 0.6] }, 'p2');
    expect(dropHeight(prop('ball', { pos: [0.3, 2, 0.1] }), [table])).toBeCloseTo(0.75, 4);
    expect(dropHeight(prop('ball', { pos: [3, 2, 0] }), [table])).toBeCloseTo(0, 6);
  });

  it('大的落在小的上面：只有正中下面有东西也接得住', () => {
    const stool = prop('stand', { size: [0.3, 0.45, 0.3] }, 'p2');
    expect(dropHeight(prop('box', { size: [1.2, 0.05, 0.8], pos: [0, 1, 0] }), [stool])).toBeCloseTo(0.45, 4);
  });

  it('能叠好几层：落在最高的那一件上', () => {
    const low = prop('box', { size: [1, 0.3, 1] }, 'p2');
    const high = prop('box', { size: [0.5, 0.3, 0.5], pos: [0, 0.3, 0] }, 'p3');
    expect(dropHeight(prop('ball', { pos: [0, 3, 0] }), [low, high])).toBeCloseTo(0.6, 4);
  });

  it('斜着的照最低的那一头落：倒下的杆落下以后最低点正好贴地', () => {
    const leaning = prop('pole', { rot: [60, 0, 0], pos: [0, 1, 0] });
    const y = dropHeight(leaning, []);
    expect(propBounds({ ...leaning, pos: [0, y, 0] }).min[1]).toBeCloseTo(0, 5);
  });

  it('已经在别的道具里面的不往上顶：只找正下方的面', () => {
    const table = prop('box', { size: [1.2, 0.75, 0.6] }, 'p2');
    expect(dropHeight(prop('ball', { pos: [0, 0.2, 0] }), [table])).toBeCloseTo(0, 6);
  });
});

describe('道具：现成的素材', () => {
  const chairProp = (patch: Partial<SceneProp> = {}): SceneProp => clampProp({ ...makeAssetProp([], 'chair', at())!, ...patch });

  it('清单：编号不重复，都分了组、起了名字，尺寸是正的', () => {
    expect(new Set(PROP_ASSETS.map((a) => a.id)).size).toBe(PROP_ASSETS.length);
    expect(PROP_ASSETS.length).toBeGreaterThanOrEqual(20);
    for (const asset of PROP_ASSETS) {
      expect(PROP_ASSET_GROUPS).toContain(asset.group);
      expect(propAssetLabel(asset.id), asset.id).not.toBe('');
      asset.size.forEach((v) => expect(v).toBeGreaterThan(0.01));
    }
    // 每一组都有东西
    for (const group of PROP_ASSET_GROUPS) expect(PROP_ASSETS.some((a) => a.group === group)).toBe(true);
  });

  it('新放的素材是原样的大小；清单里没有的编号做不出来', () => {
    const chair = makeAssetProp([], 'chair', at(1, 2, 90))!;
    expect(chair).toEqual({ id: 'p1', name: '', kind: 'asset', asset: 'chair', size: propAsset('chair')!.size, pos: [1, 0, 2], rot: [0, 90, 0], color: PROP_COLOR });
    expect(propBaseSize(chair)).toEqual(propAsset('chair')!.size);
    expect(makeAssetProp([], 'nothing', at())).toBeNull();
  });

  it('存了再读一模一样；认不出的素材丢掉；基本体存出来没有 asset 这一项', () => {
    const props = [chairProp({ size: [0.5, 1, 0.45], color: '#aa5533' }), prop('box', {}, 'p2')];
    expect(normalizeProps(JSON.parse(JSON.stringify(props)))).toEqual(props);
    expect(normalizeProps([{ id: 'p1', kind: 'asset', asset: 'gone' }, { id: 'p2', kind: 'asset' }])).toEqual([]);
    expect('asset' in props[1]).toBe(false);
    // 复制、改尺寸以后还是那件素材
    const { props: copied } = copyProp(props, 'p1', { x: 1, z: 0 });
    expect(copied[2]).toMatchObject({ kind: 'asset', asset: 'chair', size: [0.5, 1, 0.45] });
    expect(updateProp(props, 'p1', { size: [1, 1, 1] })[0]).toMatchObject({ kind: 'asset', asset: 'chair', size: [1, 1, 1] });
  });

  it('文件还没读进来时用一个同样大的方块顶着', () => {
    expect(propAssetsReady()).toBe(false);
    const shape = shapeOf(chairProp());
    expect(shape.indices.length / 3).toBe(12);
  });

  it('读进来以后：每件的网格占的盒子就是清单里写的大小，原点在底面正中，法线是单位长、面朝外', () => {
    const file = readFileSync('public/props/lowpoly.bin');
    installPropAssets(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
    expect(propAssetsReady()).toBe(true);
    for (const asset of PROP_ASSETS) {
      const shape = propAssetShape(asset.id)!;
      expect(shape.positions.length / 3, asset.id).toBe(asset.vertices);
      expect(shape.indices.length / 3, asset.id).toBe(asset.triangles);
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < shape.positions.length; i++) {
        lo[i % 3] = Math.min(lo[i % 3], shape.positions[i]);
        hi[i % 3] = Math.max(hi[i % 3], shape.positions[i]);
      }
      [0, 1, 2].forEach((k) => expect(hi[k] - lo[k], `${asset.id} 第 ${k} 个方向`).toBeCloseTo(asset.size[k], 2));
      expect(lo[1], asset.id).toBeCloseTo(0, 3);
      expect(lo[0] + hi[0], asset.id).toBeCloseTo(0, 3);
      expect(lo[2] + hi[2], asset.id).toBeCloseTo(0, 3);
      for (let i = 0; i < shape.normals.length; i += 3) expect(Math.hypot(shape.normals[i], shape.normals[i + 1], shape.normals[i + 2])).toBeCloseTo(1, 5);
      for (const index of shape.indices) expect(index).toBeLessThan(asset.vertices);
    }
  });

  it('改了尺寸网格跟着拉伸：盒子正好是新的尺寸，没改的就是原样那一份', () => {
    const natural = propAssetShape('chair')!;
    expect(shapeOf(chairProp())).toBe(natural);
    const wide = chairProp({ size: [0.8, 0.5, 0.4] });
    const { min, max } = propBounds(wide);
    expect(max[0] - min[0]).toBeCloseTo(0.8, 4);
    expect(max[1] - min[1]).toBeCloseTo(0.5, 4);
    expect(max[2] - min[2]).toBeCloseTo(0.4, 4);
    const shape = shapeOf(wide);
    for (let i = 0; i < shape.normals.length; i += 3) expect(Math.hypot(shape.normals[i], shape.normals[i + 1], shape.normals[i + 2])).toBeCloseTo(1, 5);
  });

  it('东西能落到素材上：球落在餐桌的桌面上', () => {
    const table = clampProp({ ...makeAssetProp([], 'table', at())!, id: 'p2' });
    expect(dropHeight(prop('ball', { size: [0.2, 0.2, 0.2], pos: [0, 2, 0] }), [table])).toBeCloseTo(table.size[1], 3);
  });

  it('导出：素材道具写出来的是它自己的网格，不是方块', () => {
    const chair = chairProp({ pos: [1, 0, 2] });
    const [shape] = propWorldShapes([chair], () => 'chair');
    expect(shape.triangles.length / 3).toBe(propAsset('chair')!.triangles);
    expect(propTriangles([chair])).toBe(propAsset('chair')!.triangles);
    const { json } = readGlb(mergeGlbs(propGlbParts([chair], () => '椅子_1')));
    expect(json.nodes[json.scenes[0].nodes[0]].translation).toEqual([1, 0, 2]);
  });
});
