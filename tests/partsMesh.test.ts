import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { buildPartGeometry, triangleCount } from '../src/geometry/partsMesh';
import { PRESETS, applyPreset } from '../src/model/presets';
import { defaultSpec } from '../src/model/spec';
import { buildSkeleton } from '../src/rig/skeleton';
import { bindPartGrafts, skinVertices } from '../src/rig/skin';
import { PartsModel } from '../src/view/partsModel';

const spec = (counts: Partial<ReturnType<typeof defaultSpec>['counts']> = {}) => {
  const base = defaultSpec();
  return { ...base, counts: { ...base.counts, ...counts } };
};

describe('分部件网格', () => {
  it('每个部件都生成一个合法的网格：有三角面，坐标都是有限数，带法线', () => {
    const figure = buildFigure(
      spec({ heads: 2, armPairs: 2, chestPairs: 2, tails: 2, wingPairs: 1, hornsPerHead: 3, earPairsPerHead: 1 }),
    );
    for (const part of figure.parts) {
      const geo = buildPartGeometry(part);
      expect(triangleCount(geo), part.name).toBeGreaterThan(10);
      expect(Number.isInteger(triangleCount(geo)), part.name).toBe(true);
      const pos = geo.attributes.position.array as Float32Array;
      const normal = geo.attributes.normal.array as Float32Array;
      expect(pos.every(Number.isFinite), part.name).toBe(true);
      expect(normal.every(Number.isFinite), part.name).toBe(true);
      expect(normal.length).toBe(pos.length);
    }
  });

  it('挖掉的体块（眼窝）在分部件模式下不出网格', () => {
    const head = buildFigure(spec()).parts.find((p) => p.name === 'Head_01')!;
    const withSockets = buildPartGeometry(head);
    const without = buildPartGeometry({ ...head, prims: head.prims.filter((p) => !('cut' in p && p.cut)) });
    expect(head.prims.some((p) => 'cut' in p && p.cut)).toBe(true);
    expect(triangleCount(withSockets)).toBe(triangleCount(without));
  });

  it('法线朝外：躯干、胸上每个顶点的法线都背向部件中心', () => {
    const figure = buildFigure(spec());
    for (const name of ['Torso', 'Chest_01_L']) {
      const whole = figure.parts.find((p) => p.name === name)!;
      // 只看主体那一块（躯干的放样面），附加的体块埋在里面的那一半本来就朝里
      const geo = buildPartGeometry({ ...whole, prims: whole.prims.slice(0, 1) });
      geo.computeBoundingBox();
      const center = geo.boundingBox!.getCenter(new THREE.Vector3());
      const pos = geo.attributes.position;
      const normal = geo.attributes.normal;
      const p = new THREE.Vector3();
      const n = new THREE.Vector3();
      let outward = 0;
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).sub(center);
        n.fromBufferAttribute(normal, i);
        if (p.dot(n) > 0) outward++;
      }
      expect(outward / pos.count, name).toBeGreaterThan(0.97);
    }
  });

  it('压扁的耳朵比不压扁时薄', () => {
    const figure = buildFigure(spec({ earPairsPerHead: 1 }));
    const ear = figure.parts.find((p) => p.type === 'ear')!;
    const flat = buildPartGeometry(ear);
    const round = buildPartGeometry({ ...ear, stretch: undefined });
    flat.computeBoundingBox();
    round.computeBoundingBox();
    const depth = (g: THREE.BufferGeometry) => g.boundingBox!.max.z - g.boundingBox!.min.z;
    expect(depth(flat)).toBeCloseTo(depth(round) * ear.stretch![2], 6);
  });
});

describe('场景里的模型', () => {
  it('标准人形：脚踩地面，头顶就是身高，左右对称', () => {
    const figure = buildFigure(spec());
    const model = new PartsModel();
    const stats = model.update(figure);
    expect(stats.box.min.y).toBeGreaterThan(-0.005);
    expect(stats.box.min.y).toBeLessThan(0.005);
    expect(stats.box.max.y).toBeCloseTo(figure.metrics.height, 3);
    expect(stats.box.max.x).toBeCloseTo(-stats.box.min.x, 3);
    expect(stats.triangles).toBeGreaterThan(5000);
    expect(model.root.name).toBe('OC_BaseMesh');
  });

  it('物体名就是部件名，父子关系照搬', () => {
    const figure = buildFigure(spec({ heads: 2, hornsPerHead: 2 }));
    const model = new PartsModel();
    model.update(figure);
    const found: string[] = [];
    model.root.traverse((o) => {
      if (o !== model.root) found.push(o.name);
    });
    expect(found.sort()).toEqual(figure.parts.map((p) => p.name).sort());
    expect(model.root.getObjectByName('Head_02_Horn_01_L')!.parent!.name).toBe('Head_02');
    expect(model.root.getObjectByName('Head_02')!.parent!.name).toBe('Torso');
    expect(model.root.getObjectByName('Leg_01_L')!.parent).toBe(model.root);
  });

  it('只有形状变了的部件才重建网格；拖身高、头身比时一个都不重建', () => {
    const model = new PartsModel();
    const a = defaultSpec();
    model.update(buildFigure(a));
    const geos = () => {
      const out = new Map<string, THREE.BufferGeometry>();
      model.root.traverse((o) => {
        if (o instanceof THREE.Mesh) out.set(o.name, o.geometry);
      });
      return out;
    };
    const before = geos();

    model.update(buildFigure({ ...a, shape: { ...a.shape, bust: 1.4 } }));
    const bust = geos();
    expect(bust.get('Head_01')).toBe(before.get('Head_01'));
    expect(bust.get('Chest_01_L')).not.toBe(before.get('Chest_01_L'));

    model.update(buildFigure({ ...a, shape: { ...a.shape, bust: 1.4, height: 1.9, headRatio: 6.2 } }));
    const scaled = geos();
    for (const [name, geo] of bust) expect(scaled.get(name), name).toBe(geo);
  });

  it('导出用的副本：缩放都烘焙进了顶点，每个物体的缩放是 1，外形和屏幕上的一样', () => {
    const base = defaultSpec();
    const figure = buildFigure({
      ...base,
      counts: { ...base.counts, heads: 2, hornsPerHead: 2, earPairsPerHead: 1, tails: 2 },
      shape: { ...base.shape, height: 1.9, headRatio: 6.5 },
    });
    const model = new PartsModel();
    const stats = model.update(figure);
    const baked = model.baked();

    const names: string[] = [];
    baked.traverse((o) => {
      expect(o.scale.toArray(), o.name).toEqual([1, 1, 1]);
      if (o !== baked) names.push(o.name);
    });
    expect(baked.name).toBe('OC_BaseMesh');
    expect(names.sort()).toEqual(figure.parts.map((p) => p.name).sort());
    expect(baked.getObjectByName('Head_02_Horn_01_L')!.parent!.name).toBe('Head_02');

    const box = new THREE.Box3().setFromObject(baked);
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(box.min[axis]).toBeCloseTo(stats.box.min[axis], 4);
      expect(box.max[axis]).toBeCloseTo(stats.box.max[axis], 4);
    }
    // 每个部件各自的位置也对得上
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const name of names) {
      model.root.getObjectByName(name)!.getWorldPosition(a);
      baked.getObjectByName(name)!.getWorldPosition(b);
      expect(a.distanceTo(b), name).toBeLessThan(1e-5);
    }
    // 原模型没有被改动
    expect(model.root.scale.x).toBeCloseTo(figure.scale, 9);
  });

  it.each(PRESETS.map((p) => [p.name, p] as const))('预设「%s」能生成，整体尺寸合理', (_name, preset) => {
    const figure = buildFigure(applyPreset(defaultSpec(), preset));
    const stats = new PartsModel().update(figure);
    const size = stats.box.getSize(new THREE.Vector3());
    expect(stats.box.min.y).toBeGreaterThan(-0.03);
    expect(size.y).toBeGreaterThan(1.5);
    expect(size.y).toBeLessThan(3);
    expect(size.x).toBeLessThan(3.2);
    expect(size.z).toBeLessThan(3.2);
  });

  it('分部件摆姿势的权重：躯干的壳不跟着手脚动；手臂是球形关节，整条只跟自己的骨骼；关节上的球整个跟一节骨骼', () => {
    const figure = buildFigure(spec({ armPairs: 2 }));
    const model = new PartsModel();
    model.update(figure);
    const meshes = model.bakedMeshes();
    const positions = new Float32Array(meshes.reduce((n, m) => n + m.positions.length, 0));
    const triangles = new Uint32Array(meshes.reduce((n, m) => n + m.indices.length, 0));
    let vertex = 0;
    let corner = 0;
    const first = new Map<string, number>();
    for (const m of meshes) {
      first.set(m.name, vertex);
      positions.set(m.positions, vertex * 3);
      for (let i = 0; i < m.indices.length; i++) triangles[corner++] = m.indices[i] + vertex;
      vertex += m.positions.length / 3;
    }
    const skeleton = buildSkeleton(figure);
    const skin = bindPartGrafts(skinVertices(figure, skeleton, positions, triangles, meshes), figure, skeleton, meshes);
    /** 这张网格上的顶点一共跟了哪些骨骼 */
    const bonesOf = (name: string) => {
      const mesh = meshes.find((m) => m.name === name)!;
      const start = first.get(name)!;
      const seen = new Set<string>();
      for (let v = start; v < start + mesh.positions.length / 3; v++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          const w = skin.weights[v * 4 + k];
          sum += w;
          if (w > 0) seen.add(skeleton.bones[skin.joints[v * 4 + k]].name);
        }
        expect(sum, `${name} 的顶点 ${v - start}`).toBeCloseTo(1, 5);
      }
      return [...seen].sort();
    };
    // 躯干：只有脊柱那几节。手臂、腿再怎么摆，躯干的壳都不会被拽走
    for (const name of bonesOf('Torso')) expect(name).toMatch(/^(Hips|Spine|Chest(\.\d+)?|UpperChest)$/);
    // 手臂：只有这条手臂自己的骨骼，没有躯干的，没有锁骨（它在躯干里），没有另一排手臂的
    const arm = bonesOf('Arm_01_L');
    for (const name of arm) expect(name).toMatch(/^(UpperArm|LowerArm|Hand|(Thumb|Index|Middle|Ring|Little)\d)_L$/);
    expect(arm).toContain('UpperArm_L');
    expect(arm).toContain('Index3_L');
    for (const name of bonesOf('Arm_02_R')) expect(name).toMatch(/^(UpperArm|LowerArm|Hand|(Thumb|Index|Middle|Ring|Little)\d)_R\.002$/);
    // 腿：没有手臂的骨骼，也没有另一条腿的
    for (const name of bonesOf('Leg_01_L')) expect(name).toMatch(/^(Hips|Spine|(UpperLeg|LowerLeg|Foot|Toes)_L)$/);
    // 肩关节周围（肩头的球、上臂的根）整个跟着上臂：绕着球心转，球还是那个球
    const joint = skeleton.bones.find((b) => b.name === 'UpperArm_L')!.head;
    const upper = skeleton.bones.findIndex((b) => b.name === 'UpperArm_L');
    const mesh = meshes.find((m) => m.name === 'Arm_01_L')!;
    const start = first.get('Arm_01_L')!;
    let around = 0;
    for (let v = start; v < start + mesh.positions.length / 3; v++) {
      if (Math.hypot(positions[v * 3] - joint[0], positions[v * 3 + 1] - joint[1], positions[v * 3 + 2] - joint[2]) > 0.05 * figure.scale) continue;
      around++;
      expect(skin.joints[v * 4]).toBe(upper);
      expect(skin.weights[v * 4]).toBeGreaterThan(0.99);
    }
    expect(around).toBeGreaterThan(30);
  });
});
