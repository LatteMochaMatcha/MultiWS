// 第三种身体：成品角色。带贴图和蒙皮的现成模型（public/character/ 下面那个 VRM），按部件数量拼成多肢体。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CharacterBuild, assembleCharacter, boneName, boneNames, hairMaterial } from '../src/character/assemble';
import { beastBody } from '../src/character/beast';
import { characterGlb, characterShape, characterSkeleton, mergeByMaterial } from '../src/character/export';
import { type HairDonor, readHair } from '../src/character/hair';
import { CHARACTER, hairUrl } from '../src/character/load';
import { posedJoints, skinMatrices, skinVerticesDualInPlace, skinVerticesInPlace } from '../src/character/pose';
import { type CharacterSource, readCharacter } from '../src/character/source';
import { characterPartAt, characterPartGlow, characterParts, tweakCharacter } from '../src/character/tweak';
import { activeOverrides, setOverride } from '../src/model/overrides';
import { headCluster, headShrink, headSpacing, headTurn, shoulderSpan } from '../src/geometry/bodyPlan';
import { quatEuler } from '../src/geometry/vec';
import { writeGlb } from '../src/io/glb';
import { readAccessor, readGlb } from '../src/io/glbRead';
import { type BodySpec, type HairSpec, colorToLinear, defaultSpec } from '../src/model/spec';
import { applyParse, parseDescription } from '../src/parser';

let cached: CharacterSource | null = null;
function source(): CharacterSource {
  if (!cached) {
    const file = readFileSync(new URL(`../public/${CHARACTER.url}`, import.meta.url));
    cached = readCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, CHARACTER);
  }
  return cached;
}
const make = (text = '', rest: Partial<BodySpec> = {}): BodySpec => ({
  ...applyParse(defaultSpec(), parseDescription(text)),
  bodyStyle: 'character',
  ...rest,
});
const build = (text = '', rest: Partial<BodySpec> = {}) => assembleCharacter(source(), make(text, rest));
const bone = (b: CharacterBuild, name: string) => {
  const found = b.bones.find((x) => x.name === name);
  if (!found) throw new Error(`没有骨骼 ${name}`);
  return found;
};
/** 所有顶点里 y 最低、最高的 */
function span(b: CharacterBuild) {
  let low = Infinity;
  let high = -Infinity;
  for (const mesh of b.meshes) {
    for (let i = 1; i < mesh.positions.length; i += 3) {
      low = Math.min(low, mesh.positions[i]);
      high = Math.max(high, mesh.positions[i]);
    }
  }
  return { low, high };
}

describe('读成品角色的文件', () => {
  it('读出网格、贴图、骨骼和许可', () => {
    const s = source();
    expect(s.title).toBe('ヴィータ');
    // 文件里自己写的是「Other」加一个条件页的网址；CC0 是 pixiv 在帮助中心另外声明的（见 assets/source/README.md）
    expect(s.license).toBe('Other');
    expect(s.bones).toHaveLength(159);
    expect(s.chunks.length).toBeGreaterThan(10);
    // 她自带的猫耳认出来了：左右各一块，都是头发的第三种材质
    expect(s.earMaterials).toHaveLength(1);
    expect(s.chunks.filter((chunk) => s.earMaterials.includes(chunk.material))).toHaveLength(2);
    expect(hairMaterial(s)?.name).toBe('F00_000_Hair_00_HAIR_01');
    expect(s.hairColor).toBeUndefined();
    expect(s.materials.length).toBeGreaterThan(5);
    // 只留底色贴图：每张图都有材质在用，都是 PNG
    const usedImages = new Set(s.materials.map((m) => m.image).filter((i) => i >= 0));
    expect(usedImages.size).toBe(s.images.length);
    for (const image of s.images) expect([...image.bytes.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    // 每块网格：下标不越界，每个顶点的权重加起来是 1，骨骼下标有效
    for (const chunk of s.chunks) {
      const count = chunk.positions.length / 3;
      expect(chunk.uvs.length).toBe(count * 2);
      expect(Math.max(...chunk.indices)).toBeLessThan(count);
      for (let v = 0; v < count; v++) {
        let sum = 0;
        const seen = new Set<number>();
        for (let k = 0; k < 4; k++) {
          const w = chunk.weights[v * 4 + k];
          sum += w;
          expect(chunk.joints[v * 4 + k]).toBeLessThan(s.bones.length);
          // 文件里有同一根骨骼占两格的顶点：读的时候并成了一格
          if (w) {
            expect(seen.has(chunk.joints[v * 4 + k])).toBe(false);
            seen.add(chunk.joints[v * 4 + k]);
          }
        }
        expect(sum).toBeCloseTo(1, 5);
      }
    }
  });

  it('换成了工坊的朝向：面朝 +Z，角色的左手边是 +X，脚在下面', () => {
    const s = source();
    const at = (name: string) => s.bones.find((b) => b.name === name)!.pos;
    expect(at('J_Bip_L_Hand')[0]).toBeGreaterThan(0.4);
    expect(at('J_Bip_R_Hand')[0]).toBeLessThan(-0.4);
    expect(at('J_Bip_C_Head')[1]).toBeGreaterThan(at('J_Bip_C_Hips')[1] + 0.3);
    // 脚尖在脚跟前面
    expect(at('J_Bip_L_ToeBase')[2]).toBeGreaterThan(at('J_Bip_L_Foot')[2] + 0.03);
    // 父子关系：手接在前臂上，根骨骼没有父骨骼
    const parentOf = (name: string) => s.bones[s.bones.find((b) => b.name === name)!.parent]?.name;
    expect(parentOf('J_Bip_L_Hand')).toBe('J_Bip_L_LowerArm');
    expect(parentOf('J_Bip_C_Spine')).toBe('J_Bip_C_Hips');
  });

  it('不是 GLB 的文件会报错', () => {
    expect(() => readCharacter(new ArrayBuffer(64))).toThrow();
  });
});

describe('摆姿势', () => {
  // 一条三节的链：0 在原点，1 在 (1,0,0)，2 在 (2,0,0)
  const rig = { parent: [-1, 0, 1], rest: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] as [number, number, number][] };

  it('不动的时候，点和关节都在原地', () => {
    const m = skinMatrices(rig, new Map());
    expect(posedJoints(rig, m)).toEqual(rig.rest);
    const p = new Float32Array([0.3, 0.2, 0.1]);
    const n = new Float32Array([0, 1, 0]);
    skinVerticesInPlace(p, n, [1, 0, 0, 0], [1, 0, 0, 0], m);
    expect([...p]).toEqual([...new Float32Array([0.3, 0.2, 0.1])]);
  });

  it('转一根骨骼，它下面的跟着转，上面的不动', () => {
    // 第 1 节绕 Z 轴转 90°：+X 转到 +Y
    const m = skinMatrices(rig, new Map([[1, { rotation: quatEuler(0, 0, Math.PI / 2) }]]));
    const joints = posedJoints(rig, m);
    expect(joints[0]).toEqual([0, 0, 0]);
    expect(joints[1][0]).toBeCloseTo(1, 12);
    expect(joints[2][0]).toBeCloseTo(1, 12);
    expect(joints[2][1]).toBeCloseTo(1, 12);
    // 一半跟第 0 节、一半跟第 1 节的顶点，落在两处的正中间
    const p = new Float32Array([1.5, 0, 0]);
    const n = new Float32Array([0, 1, 0]);
    skinVerticesInPlace(p, n, [0, 1, 0, 0], [0.5, 0.5, 0, 0], m);
    expect(p[0]).toBeCloseTo(1.25, 6);
    expect(p[1]).toBeCloseTo(0.25, 6);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 6);
  });

  it('对偶四元数：整个跟着一根骨骼的点和线性混合一样；一半一半的点绕着关节转一半，不往里瘪', () => {
    // 第 1 节绕 Z 轴转 170°（手臂举过头顶差不多要转这么多）
    const turn = (170 * Math.PI) / 180;
    const m = skinMatrices(rig, new Map([[1, { rotation: quatEuler(0, 0, turn) }]]));
    const a = new Float32Array([1.5, 0.2, 0.1]);
    const b = a.slice();
    const na = new Float32Array([0, 1, 0]);
    const nb = na.slice();
    skinVerticesInPlace(a, na, [1, 0, 0, 0], [1, 0, 0, 0], m);
    skinVerticesDualInPlace(b, nb, [1, 0, 0, 0], [1, 0, 0, 0], m);
    for (let k = 0; k < 3; k++) {
      expect(b[k]).toBeCloseTo(a[k], 5);
      expect(nb[k]).toBeCloseTo(na[k], 5);
    }
    // 一半一半的点，离关节 0.5：线性混合把它拉到离关节只剩 0.04（瘪了），对偶四元数是绕关节转 85°，离关节还是 0.5
    const p = new Float32Array([1.5, 0, 0]);
    const q = p.slice();
    const n = new Float32Array([0, 1, 0]);
    const o = n.slice();
    skinVerticesInPlace(p, n, [0, 1, 0, 0], [0.5, 0.5, 0, 0], m);
    skinVerticesDualInPlace(q, o, [0, 1, 0, 0], [0.5, 0.5, 0, 0], m);
    expect(Math.hypot(p[0] - 1, p[1], p[2])).toBeLessThan(0.05);
    expect(Math.hypot(q[0] - 1, q[1], q[2])).toBeCloseTo(0.5, 5);
    expect(q[0]).toBeCloseTo(1 + 0.5 * Math.cos(turn / 2), 5);
    expect(q[1]).toBeCloseTo(0.5 * Math.sin(turn / 2), 5);
    // 法线也转了 85°
    expect(o[0]).toBeCloseTo(-Math.sin(turn / 2), 5);
    expect(o[1]).toBeCloseTo(Math.cos(turn / 2), 5);
    // 权重是三七开的点：转得少一些，离关节的距离照样不变
    const r = new Float32Array([1.5, 0, 0]);
    skinVerticesDualInPlace(r, new Float32Array([0, 1, 0]), [0, 1, 0, 0], [0.7, 0.3, 0, 0], m);
    expect(Math.hypot(r[0] - 1, r[1], r[2])).toBeCloseTo(0.5, 5);
    expect(r[1]).toBeGreaterThan(0.1);
    expect(r[1]).toBeLessThan(q[1]);
  });

  it('对偶四元数：只是挪动的话，一半一半的点挪一半；骨骼都不动的话点也不动', () => {
    const still = skinMatrices(rig, new Map());
    const p = new Float32Array([1.5, 0.3, -0.2]);
    const n = new Float32Array([0, 0, 1]);
    skinVerticesDualInPlace(p, n, [0, 1, 2, 0], [0.5, 0.3, 0.2, 0], still);
    expect([...p]).toEqual([...new Float32Array([1.5, 0.3, -0.2])]);
    expect([...n]).toEqual([0, 0, 1]);
    const m = skinMatrices(rig, new Map([[1, { move: [0, 0.4, 0] }]]));
    skinVerticesDualInPlace(p, n, [0, 1, 0, 0], [0.5, 0.5, 0, 0], m);
    expect(p[0]).toBeCloseTo(1.5, 6);
    expect(p[1]).toBeCloseTo(0.5, 6);
    expect(p[2]).toBeCloseTo(-0.2, 6);
  });

  it('挪动和缩放：子骨骼跟着走', () => {
    const m = skinMatrices(rig, new Map([[1, { move: [0, 0.5, 0], scale: 2 }]]));
    const joints = posedJoints(rig, m);
    expect(joints[1]).toEqual([1, 0.5, 0]);
    // 第 2 节离第 1 节本来 1 远，放大两倍以后是 2 远
    expect(joints[2]).toEqual([3, 0.5, 0]);
  });
});

describe('拼成品角色', () => {
  it('骨骼换成工坊的名字', () => {
    expect(boneName('J_Bip_C_Hips')).toBe('Hips');
    expect(boneName('J_Bip_L_UpperArm')).toBe('UpperArm_L');
    expect(boneName('J_Bip_R_ToeBase')).toBe('Toes_R');
    expect(boneName('J_Sec_L_Bust1')).toBe('Bust1_L');
    expect(boneName('J_Adj_R_FaceEye')).toBe('Eye_R');
    expect(boneName('J_Sec_Hair1_01')).toBe('Hair1_01');
    expect(boneName('Root')).toBe('Root');
  });

  it('整副骨架的名字：重名的分开，头发的骨骼按一缕一缕编号', () => {
    const names = boneNames([
      { name: 'J_Bip_C_Head', parent: -1 },
      { name: 'J_Sec_L_UpperArm', parent: 2 },
      { name: 'J_Bip_L_UpperArm', parent: 0 },
      { name: 'HairJoint-aaaa', parent: 0 },
      { name: 'HairJoint-bbbb', parent: 3 },
      { name: 'HairJoint-cccc', parent: 0 },
    ]);
    // 身体的主骨骼占着本来的名字，挂在它下面的那根另起一个
    expect(names).toEqual(['Head', 'UpperArmSec_L', 'UpperArm_L', 'Hair_01_01', 'Hair_01_02', 'Hair_02_01']);
    // 这个角色：没有重名，也没有带一长串编号的名字
    const all = boneNames(source().bones);
    expect(new Set(all).size).toBe(all.length);
    expect(all.some((n) => n.startsWith('HairJoint'))).toBe(false);
    expect(all).toEqual(expect.arrayContaining(['UpperArm_L', 'UpperArmSec_L', 'LowerLegSec_R', 'Hair_01_01', 'LowerSleeve_L', 'SkirtBack1_R']));
  });

  it('标准人形：一副完整的骨架，根是 Hips，父骨骼排在子骨骼前面', () => {
    const b = build();
    expect(b.bones[0]).toMatchObject({ name: 'Hips', parent: -1 });
    expect(b.bones.filter((x) => x.parent < 0)).toHaveLength(1);
    b.bones.forEach((x, i) => expect(x.parent, x.name).toBeLessThan(i));
    const names = b.bones.map((x) => x.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of ['Spine', 'Chest', 'UpperChest', 'Neck', 'Head', 'Shoulder_L', 'UpperArm_L', 'LowerArm_L', 'Hand_L', 'UpperLeg_R', 'LowerLeg_R', 'Foot_R', 'Toes_R', 'Index1_L']) {
      expect(names).toContain(name);
    }
    // 只是标位置用的骨骼不导出：末端的 _end，还有 Hips 上面那几层
    expect(names.some((n) => n.includes('_end') || ['Root', 'Global', 'Position'].includes(n))).toBe(false);
    expect(bone(b, 'Hand_L').parent).toBe(names.indexOf('LowerArm_L'));
    // 骨骼都有长度
    for (const x of b.bones) expect(Math.hypot(x.tail[0] - x.head[0], x.tail[1] - x.head[1], x.tail[2] - x.head[2]), x.name).toBeGreaterThan(0.005);
    // 四肢的骨骼一节接一节：上臂的终点就是手肘，大腿的终点就是膝盖（它们下面还挂着袖子、裙子的骨骼）
    for (const [from, to] of [['Shoulder_L', 'UpperArm_L'], ['UpperArm_L', 'LowerArm_L'], ['LowerArm_R', 'Hand_R'], ['UpperLeg_L', 'LowerLeg_L'], ['LowerLeg_R', 'Foot_R']]) {
      expect(bone(b, from).tail, from).toEqual(bone(b, to).head);
    }
    // 头发的骨骼接在头上
    expect(b.bones[bone(b, 'Hair_01_01').parent].name).toBe('Head');
    expect(b.bones[bone(b, 'Hair_01_02').parent].name).toBe('Hair_01_01');
    // 不带顶点的梢（头发每一缕的最后一节）不导出：留下来的骨骼要么带着顶点，要么下面还有骨骼
    const busy = new Set<number>();
    for (const mesh of b.meshes) for (let i = 0; i < mesh.joints.length; i++) if (mesh.weights[i]) busy.add(mesh.joints[i]);
    b.bones.forEach((x) => busy.add(x.parent));
    expect(b.bones.filter((_, i) => !busy.has(i)).map((x) => x.name)).toEqual([]);
    expect(names).toContain('Hair_01_03');
    expect(names).not.toContain('Hair_01_04');
    expect(b.ignored).toEqual([]);
  });

  it('网格：权重加起来是 1，骨骼下标有效，贴图坐标原样带着', () => {
    const b = build('两个头，两对手，两对胸');
    for (const mesh of b.meshes) {
      const count = mesh.positions.length / 3;
      expect(mesh.uvs.length).toBe(count * 2);
      expect(mesh.material).toBeLessThan(b.materials.length);
      for (let v = 0; v < count; v++) {
        let sum = 0;
        const seen = new Set<number>();
        for (let k = 0; k < 4; k++) {
          const w = mesh.weights[v * 4 + k];
          sum += w;
          expect(mesh.joints[v * 4 + k]).toBeLessThan(b.bones.length);
          // 同一根骨骼不会在一个顶点上出现两次
          if (w) {
            expect(seen.has(mesh.joints[v * 4 + k])).toBe(false);
            seen.add(mesh.joints[v * 4 + k]);
          }
        }
        expect(sum).toBeCloseTo(1, 4);
      }
    }
  });

  it('脚踩在地面上，头顶是设定的身高，头身比是角色本来的比例', () => {
    for (const height of [1.4, 1.62, 1.9]) {
      const spec = make();
      const b = assembleCharacter(source(), { ...spec, shape: { ...spec.shape, height } });
      expect(span(b).low).toBeCloseTo(0, 6);
      expect(b.metrics.height).toBeCloseTo(height, 4);
      // 身高量到头顶；再往上几厘米是蓬起来的头发和她自带的猫耳
      expect(span(b).high).toBeGreaterThan(height + 0.01);
      expect(span(b).high).toBeLessThan(height + 0.06);
      expect(b.metrics.headRatio).toBeGreaterThan(6);
      expect(b.metrics.headRatio).toBeLessThan(7.2);
    }
  });

  it('A-pose 手臂放下来、手肘往前微弯；T-pose 是角色原样的平举', () => {
    const t = build('', { pose: 'T' });
    const a = build('', { pose: 'A' });
    // 平举：手和肩差不多高
    expect(Math.abs(bone(t, 'Hand_L').head[1] - bone(t, 'UpperArm_L').head[1])).toBeLessThan(0.03);
    // 放下来：手比肩低一大截，还在身体外侧
    expect(bone(a, 'UpperArm_L').head[1] - bone(a, 'Hand_L').head[1]).toBeGreaterThan(0.25);
    expect(bone(a, 'Hand_L').head[0]).toBeGreaterThan(bone(a, 'UpperArm_L').head[0] + 0.2);
    // 肩关节不动，手臂长度不变
    expect(bone(a, 'UpperArm_L').head).toEqual(bone(t, 'UpperArm_L').head);
    const length = (b: CharacterBuild, from: string, to: string) => Math.hypot(...bone(b, to).head.map((v, k) => v - bone(b, from).head[k]));
    expect(length(a, 'UpperArm_L', 'LowerArm_L')).toBeCloseTo(length(t, 'UpperArm_L', 'LowerArm_L'), 6);
    expect(length(a, 'LowerArm_L', 'Hand_L')).toBeCloseTo(length(t, 'LowerArm_L', 'Hand_L'), 6);
    // 手肘往前弯：手腕比手肘靠前
    expect(bone(a, 'Hand_L').head[2] - bone(a, 'LowerArm_L').head[2]).toBeGreaterThan(bone(t, 'Hand_L').head[2] - bone(t, 'LowerArm_L').head[2] + 0.03);
    // 左右对称
    for (const b of [a, t]) {
      for (const name of ['UpperArm', 'LowerArm', 'Hand']) {
        const left = bone(b, `${name}_L`).head;
        const right = bone(b, `${name}_R`).head;
        // 这个角色的骨架本身偏了中线不到一毫米
        expect(right[0]).toBeCloseTo(-left[0], 2);
        expect(right[1]).toBeCloseTo(left[1], 2);
        expect(right[2]).toBeCloseTo(left[2], 2);
      }
    }
  });

  it('多对手臂：复制出来的手臂带着自己的骨骼，接在下面一排', () => {
    const one = build();
    const two = build('两对手');
    expect(two.bones.length).toBeGreaterThan(one.bones.length + 30);
    for (const name of ['Shoulder_L.002', 'UpperArm_L.002', 'LowerArm_R.002', 'Hand_R.002', 'Index1_L.002']) expect(two.bones.map((b) => b.name)).toContain(name);
    // 第二对的肩关节在第一对下面，接在脊柱上
    expect(bone(two, 'UpperArm_L').head[1] - bone(two, 'UpperArm_L.002').head[1]).toBeGreaterThan(0.1);
    // 它贴着躯干的侧面：比本来的肩膀窄一点，但不缩在躯干里面，肩头露在外面
    expect(bone(two, 'UpperArm_L.002').head[0]).toBeGreaterThan(0.06);
    expect(bone(two, 'UpperArm_L.002').head[0]).toBeLessThan(bone(two, 'UpperArm_L').head[0] + 0.01);
    expect(bone(two, 'UpperArm_R.002').head[0]).toBeCloseTo(-bone(two, 'UpperArm_L.002').head[0], 2);
    expect(['Spine', 'Chest', 'UpperChest']).toContain(two.bones[bone(two, 'Shoulder_L.002').parent].name);
    expect(two.bones[bone(two, 'UpperArm_L.002').parent].name).toBe('Shoulder_L.002');
    // 沿躯干多排一排：躯干加长了，人也更高；网格也多了
    expect(two.metrics.height).toBeGreaterThan(one.metrics.height + 0.1);
    expect(two.meshes.length).toBeGreaterThan(one.meshes.length);
    expect(two.meshes.some((m) => m.name.endsWith('_Arm_02_L'))).toBe(true);
    // 肩部扇形聚拢：不加长躯干
    const fan = build('三对手', { armLayout: 'fan' });
    expect(fan.metrics.height).toBeCloseTo(one.metrics.height, 4);
    expect(fan.bones.map((b) => b.name)).toContain('UpperArm_R.003');
    // 四对手臂、T-pose 也拼得出来
    expect(build('四对手', { pose: 'T' }).bones.map((b) => b.name)).toContain('Hand_L.004');
  });

  it('肩部扇形聚拢：多出来的手臂从肩膀后面长出来，肩头不会顶到胸前', () => {
    for (const pose of ['A', 'T'] as const) {
      for (const text of ['两对手', '三对手', '四对手']) {
        const b = build(text, { armLayout: 'fan', pose });
        const main = bone(b, 'UpperArm_L').head;
        const extra = b.bones.filter((x) => /^UpperArm_L\.\d+$/.test(x.name));
        expect(extra.length, text).toBeGreaterThan(0);
        let last = main;
        for (const x of extra) {
          // 一对比一对靠后、稍低、往里收一点，都还挨着本来的肩膀
          expect(x.head[2], `${text} ${pose} ${x.name}`).toBeLessThan(last[2] - 0.02);
          expect(x.head[1], x.name).toBeLessThan(last[1]);
          expect(x.head[0], x.name).toBeLessThan(last[0]);
          expect(Math.hypot(x.head[0] - main[0], x.head[1] - main[1], x.head[2] - main[2]), x.name).toBeLessThan(0.14);
          last = x.head;
        }
        // 复制出来的手臂在肩膀那个高度上的部分（肩头），都在本来的肩关节后面，不往胸前凸
        for (const mesh of b.meshes.filter((m) => /_Arm_\d+_[LR]$/.test(m.name))) {
          for (let v = 0; v < mesh.positions.length / 3; v++) {
            const [x, y, z] = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
            if (Math.abs(x) < main[0] + 0.02 && y > main[1] - 0.08) expect(z, `${text} ${pose} ${mesh.name}`).toBeLessThan(main[2] + 0.04);
          }
        }
      }
    }
  });

  it('多个头：复制出来的头带着自己的脖子和头骨骼，左右分开', () => {
    const two = build('两个头');
    expect(two.bones.map((b) => b.name)).toEqual(expect.arrayContaining(['Neck.002', 'Head.002', 'Eye_L.002']));
    // 自己的头偏左，复制出来的偏右
    expect(bone(two, 'Head').head[0]).toBeGreaterThan(0.03);
    expect(bone(two, 'Head.002').head[0]).toBeLessThan(-0.03);
    // 角色的脖子根不是正好在中线上，两边差不到一毫米
    expect(bone(two, 'Head.002').head[0]).toBeCloseTo(-bone(two, 'Head').head[0], 2);
    expect(two.bones[bone(two, 'Neck.002').parent].name).toBe('UpperChest');
    // 三个头：自己的头在正中不动，另外两个一边一个
    const three = build('三个头');
    expect(bone(three, 'Head').head[0]).toBeCloseTo(0, 2);
    expect(Math.sign(bone(three, 'Head.002').head[0])).toBe(-Math.sign(bone(three, 'Head.003').head[0]));
    for (const heads of [4, 5]) {
      const spec = make();
      const b = assembleCharacter(source(), { ...spec, counts: { ...spec.counts, heads } });
      expect(b.bones.filter((x) => /^Head(\.\d+)?$/.test(x.name)), `${heads} 个头`).toHaveLength(heads);
    }
  });

  it('头多了肩膀基本不加宽：脖子根排不下才宽一点，最多宽三成', () => {
    const [width, shoulder, room] = [0.18, 0.108, 0.03];
    // 一个头：肩膀不动
    expect(shoulderSpan(1, width, shoulder, room)).toBe(shoulder);
    const spans = [1, 2, 3, 4, 5].map((count) => shoulderSpan(count, width, shoulder, room));
    // 三个头以内不加宽；四五个头宽一点，不超过三成
    for (const k of [1, 2]) expect(spans[k], `${k + 1} 个头`).toBe(shoulder);
    expect(spans[3]).toBeGreaterThan(shoulder * 1.1);
    expect(Math.max(...spans)).toBeLessThanOrEqual(shoulder * 1.3 + 1e-9);
    // 头小（窄）的角色加宽得少；本来肩膀就够宽的不用加
    expect(shoulderSpan(4, 0.15, shoulder, room)).toBeLessThan(spans[3]);
    expect(shoulderSpan(5, width, 0.2, room)).toBe(0.2);
  });

  it('多个头的排法：凑成一簇，脸贴着脸，中间的正着靠前，两边的往后退、往外歪', () => {
    const size = { width: 0.18, neck: 0.073, rise: 0.087 };
    expect(headCluster(1, size, 0.08)).toEqual([{ x: 0, z: 0, neck: [0, size.neck, 0], tilt: 0, turn: 0 }]);
    expect(headTurn(headCluster(1, size, 0.08)[0])).toEqual([0, 0, 0, 1]);
    for (const count of [2, 3, 4, 5]) {
      // 头多了每个头小一圈；最外面的脖子根最远到哪：肩关节往里 3 cm
      const scaled = { ...size, width: size.width * headShrink(count), rise: size.rise * headShrink(count) };
      const limit = shoulderSpan(count, scaled.width, 0.108, 0.03) - 0.03;
      const places = headCluster(count, scaled, limit);
      expect(places).toHaveLength(count);
      // 头的正中在哪（相对只有一个头时的脖子根）：脖子根 + 脖子 + 顺着头自己的上下方向到头的正中
      const centers = places.map((p) => [
        p.x + p.neck[0] + scaled.rise * Math.sin(p.tilt) * Math.cos(p.turn),
        p.neck[1] + scaled.rise * Math.cos(p.tilt),
        p.z + p.neck[2] - scaled.rise * Math.sin(p.tilt) * Math.sin(p.turn),
      ]);
      places.forEach((p, k) => {
        expect(Math.abs(p.x), `${count} 个头，脖子根`).toBeLessThanOrEqual(limit + 1e-9);
        expect(p.z).toBeLessThanOrEqual(0);
        expect(p.z).toBeGreaterThanOrEqual(-0.0351);
        // 头往外歪得不多，脸往外转得也有限度
        expect(Math.abs(p.tilt) * (180 / Math.PI), `${count} 个头，歪多少`).toBeLessThanOrEqual(28.001);
        expect(Math.abs(p.turn) * (180 / Math.PI), `${count} 个头，转多少`).toBeLessThanOrEqual(50.001);
        // 脖子只加长不缩短，最多斜 45°
        const length = Math.hypot(...p.neck);
        expect(length).toBeGreaterThan(scaled.neck - 1e-9);
        expect(Math.hypot(p.neck[0], p.neck[2])).toBeLessThanOrEqual(p.neck[1] + 1e-9);
        // 左右对称
        const mirror = places[count - 1 - k];
        expect(mirror.x).toBeCloseTo(-p.x, 9);
        expect(mirror.z).toBeCloseTo(p.z, 9);
        expect(mirror.tilt).toBeCloseTo(-p.tilt, 9);
        expect(mirror.turn).toBeCloseTo(-p.turn, 9);
        expect(mirror.neck[0]).toBeCloseTo(-p.neck[0], 9);
        expect(mirror.neck[1]).toBeCloseTo(p.neck[1], 9);
      });
      const gaps: number[] = [];
      for (let k = 1; k < count; k++) {
        // 从右到左依次排开，相邻两个头的正中隔一个「挤着的间隔」：比头窄。
        // 平常就是 headSpacing；脖子够不着的时候挤得更紧，最紧到头宽的 0.66（再紧头就压进去太深了）
        expect(centers[k][0]).toBeGreaterThan(centers[k - 1][0]);
        const apart = Math.hypot(centers[k][0] - centers[k - 1][0], centers[k][2] - centers[k - 1][2]);
        expect(apart, `${count} 个头`).toBeLessThanOrEqual(headSpacing(count, scaled.width) + 1e-9);
        expect(apart, `${count} 个头`).toBeGreaterThanOrEqual(0.66 * scaled.width - 1e-9);
        expect(apart).toBeLessThan(scaled.width);
        // 相邻两个脖子根挨得比头近得多
        expect(places[k].x - places[k - 1].x).toBeLessThan(apart * 0.75);
        gaps.push(apart);
      }
      // 间隔都一样大
      for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 9);
      // 脖子最多加长三成；还没挤到最紧的话，一定是因为脖子已经够短了
      const longest = Math.max(...places.map((p) => Math.hypot(...p.neck)));
      if (gaps[0] > 0.66 * scaled.width + 1e-6) expect(longest, `${count} 个头，脖子`).toBeLessThanOrEqual(1.3 * scaled.neck + 1e-9);
      // 两三个头本来就排得开：不用挤
      if (count <= 3) expect(gaps[0]).toBeCloseTo(headSpacing(count, scaled.width), 9);
      // 越靠外的越靠后
      if (count > 2) expect(centers[0][2]).toBeLessThan(centers[Math.floor((count - 1) / 2)][2] - 0.01);
    }
    // 单数个头：正中间那个原样不动
    expect(headCluster(3, size, 0.078)[1]).toEqual({ x: 0, z: 0, neck: [0, size.neck, 0], tilt: 0, turn: 0 });
    // 肩膀窄、脖子根只能挤得更近的时候，外面的脖子靠加长去够自己的头
    const roomy = headCluster(5, size, 0.16).map((p) => Math.hypot(...p.neck));
    const cramped = headCluster(5, size, 0.05).map((p) => Math.hypot(...p.neck));
    expect(cramped[0]).toBeGreaterThan(roomy[0] + 0.02);
  });

  it('多个头：三个头以内肩膀不动，腰和胯不变，手臂一样长', () => {
    const builds = [1, 2, 3, 4, 5].map((heads) => {
      const spec = make();
      return assembleCharacter(source(), { ...spec, counts: { ...spec.counts, heads } });
    });
    const one = builds[0];
    const reach = (b: CharacterBuild) => Math.hypot(...bone(b, 'Hand_L').head.map((v, k) => v - bone(b, 'UpperArm_L').head[k]));
    builds.forEach((b, k) => {
      const heads = k + 1;
      // 肩关节：两边对称，高度不变；最多比本来宽三成
      if (k) expect(bone(b, 'UpperArm_L').head[0], `${heads} 个头`).toBeGreaterThanOrEqual(bone(builds[k - 1], 'UpperArm_L').head[0] - 1e-6);
      expect(bone(b, 'UpperArm_L').head[0], `${heads} 个头`).toBeLessThanOrEqual(bone(one, 'UpperArm_L').head[0] * 1.3 + 1e-6);
      expect(bone(b, 'UpperArm_R').head[0]).toBeCloseTo(-bone(b, 'UpperArm_L').head[0], 2);
      expect(bone(b, 'UpperArm_L').head[1]).toBeCloseTo(bone(one, 'UpperArm_L').head[1], 3);
      // 胯、腿、脊柱都在原地；手臂整条往外挪，长短不变
      for (const name of ['Hips', 'Spine', 'UpperLeg_L', 'Foot_R']) expect(bone(b, name).head, `${heads} 个头 ${name}`).toEqual(bone(one, name).head);
      expect(reach(b)).toBeCloseTo(reach(one), 5);
      // 身高差不了多少：两边的头歪着矮一点，四五个头时头小了一圈
      expect(Math.abs(b.metrics.height - one.metrics.height), `${heads} 个头`).toBeLessThan(0.03);
    });
    // 两三个头：肩膀就是她本来的肩膀（三个头时脖子根刚好排满，宽出来的不到两毫米）
    expect(bone(builds[1], 'UpperArm_L').head[0]).toBe(bone(one, 'UpperArm_L').head[0]);
    expect(bone(builds[2], 'UpperArm_L').head[0]).toBeCloseTo(bone(one, 'UpperArm_L').head[0], 2);
    // 四五个头：每个头小一圈
    expect(builds[2].metrics.headHeight).toBeCloseTo(one.metrics.headHeight, 6);
    expect(builds[3].metrics.headHeight).toBeCloseTo(one.metrics.headHeight * 0.92, 6);
    expect(builds[4].metrics.headHeight).toBeCloseTo(one.metrics.headHeight * 0.86, 6);
    // 四个头时肩膀宽了一点，网格也跟着宽：肩膀那个高度上，躯干最宽的地方比一个头时宽；腰上一样宽
    const widest = (b: CharacterBuild, low: number, high: number) => {
      const arms = new Set(b.bones.flatMap((x, i) => (/Arm|Hand|Index|Middle|Ring|Little|Thumb|Sleeve/.test(x.name) ? [i] : [])));
      let wide = 0;
      for (const mesh of b.meshes) {
        for (let v = 0; v < mesh.positions.length / 3; v++) {
          const y = mesh.positions[v * 3 + 1];
          if (y < low || y > high) continue;
          let onArm = 0;
          for (let j = 0; j < 4; j++) if (arms.has(mesh.joints[v * 4 + j])) onArm += mesh.weights[v * 4 + j];
          if (onArm < 0.1) wide = Math.max(wide, Math.abs(mesh.positions[v * 3]));
        }
      }
      return wide;
    };
    const shoulderY = bone(one, 'UpperArm_L').head[1];
    expect(widest(builds[3], shoulderY - 0.03, shoulderY + 0.02)).toBeGreaterThan(widest(one, shoulderY - 0.03, shoulderY + 0.02) + 0.01);
    const waistY = bone(one, 'Spine').head[1];
    expect(widest(builds[3], waistY - 0.02, waistY + 0.05)).toBeCloseTo(widest(one, waistY - 0.02, waistY + 0.05), 4);
  });

  it('多个头：每个脖子根都落在两肩之间，接在身上；头凑成一簇，两边的往后退', () => {
    for (const heads of [2, 3, 4, 5]) {
      const spec = make();
      const b = assembleCharacter(source(), { ...spec, counts: { ...spec.counts, heads } });
      const shoulder = bone(b, 'UpperArm_L').head;
      const necks = b.bones.filter((x) => /^Neck(\.\d+)?$/.test(x.name));
      const tops = b.bones.filter((x) => /^Head(\.\d+)?$/.test(x.name)).sort((p, q) => p.head[0] - q.head[0]);
      expect(necks).toHaveLength(heads);
      for (const neck of necks) {
        expect(Math.abs(neck.head[0]), `${heads} 个头 ${neck.name}`).toBeLessThan(shoulder[0] + 0.005);
        // 脖子根在肩膀那个高度上下，不悬在半空
        expect(neck.head[1], neck.name).toBeLessThan(shoulder[1] + 0.06);
        expect(neck.head[1], neck.name).toBeGreaterThan(shoulder[1] - 0.03);
      }
      // 相邻两个头的关节隔开一段（比头窄：头是脸贴着脸的），头都在肩膀上方
      for (let k = 1; k < tops.length; k++) {
        const apart = Math.hypot(...tops[k].head.map((v, i) => v - tops[k - 1].head[i]));
        expect(apart, `${heads} 个头`).toBeGreaterThan(0.07);
        expect(apart, `${heads} 个头`).toBeLessThan(0.16);
      }
      // 脖子最多比本来的长三成：四五个头时是靠把头挤紧做到的，不是把脖子拉长。
      // 这里量的是骨骼（脖子根到头的关节）：复制出来的脖子根往肩膀里埋了三厘米多，算上它也不到本来的 1.85 倍
      // （改成挤紧之前，五个头时最外面的是 2.6 倍）
      const native = Math.hypot(...bone(build(), 'Head').head.map((v, i) => v - bone(build(), 'Neck').head[i]));
      for (const neck of necks) {
        const top = b.bones.find((x) => x.name === neck.name.replace('Neck', 'Head'))!;
        const length = Math.hypot(...top.head.map((v, i) => v - neck.head[i]));
        expect(length / native, `${heads} 个头 ${neck.name}`).toBeLessThan(neck.name === 'Neck' ? 1.31 : 1.85);
      }
      for (const top of tops) expect(top.head[1]).toBeGreaterThan(shoulder[1] + 0.05);
      // 最外面的头比中间的靠后
      if (heads > 2) expect(tops[0].head[2]).toBeLessThan(tops[Math.floor((heads - 1) / 2)].head[2] - 0.01);
      // 左右对称（这个角色的骨架本身偏了中线不到一毫米）
      expect(tops[0].head[0]).toBeCloseTo(-tops[tops.length - 1].head[0], 2);
      expect(tops[0].head[1]).toBeCloseTo(tops[tops.length - 1].head[1], 2);
      expect(tops[0].head[2]).toBeCloseTo(tops[tops.length - 1].head[2], 2);
    }
  });

  it('复制出来的脖子是光着的：不带衣领的碎片，最底下那一圈收进肩膀里', () => {
    const b = build('三个头');
    const cloth = (m: { material: number }) => /_CLOTH$/i.test(b.materials[m.material].name);
    const copies = b.meshes.filter((m) => /_Head_0[23]$/.test(m.name));
    // 复制出来的两个头：有脸、有头发、有脖子的皮肤，没有从连衣裙上切下来的衣领
    expect(copies.length).toBeGreaterThan(20);
    expect(copies.filter(cloth)).toHaveLength(0);
    // 她自己的衣领还在
    expect(b.meshes.filter((m) => cloth(m) && !/_Head_0\d$/.test(m.name)).length).toBeGreaterThan(0);
    // 每个复制出来的头上，带着脖子的那块身体皮肤（这个角色里是 Body.baked_0 那一块）：
    // 最底下那四分之一往脖子的轴线收拢了，横着量不超出脖子本身的粗细（半径 5 cm 以内）。
    // 不收的话，脖子根是照着三角面切下来的、往外张的一圈毛边，要到 6 cm
    const necks = copies.filter((m) => /^Body\.baked_0_/.test(m.name) && /Body_00_SKIN$/.test(b.materials[m.material].name));
    expect(necks).toHaveLength(2);
    for (const mesh of necks) {
      const count = mesh.positions.length / 3;
      let low = Infinity;
      let high = -Infinity;
      for (let v = 0; v < count; v++) {
        low = Math.min(low, mesh.positions[v * 3 + 1]);
        high = Math.max(high, mesh.positions[v * 3 + 1]);
      }
      const rim: number[] = [];
      for (let v = 0; v < count; v++) if (mesh.positions[v * 3 + 1] <= low + (high - low) / 4) rim.push(v);
      expect(rim.length).toBeGreaterThan(10);
      const cx = rim.reduce((s, v) => s + mesh.positions[v * 3], 0) / rim.length;
      const cz = rim.reduce((s, v) => s + mesh.positions[v * 3 + 2], 0) / rim.length;
      const widest = Math.max(...rim.map((v) => Math.hypot(mesh.positions[v * 3] - cx, mesh.positions[v * 3 + 2] - cz)));
      expect(widest, mesh.name).toBeLessThan(0.05);
    }
  });

  it('多排胸：复制出来的一片不带骨骼，跟着所在高度的脊柱', () => {
    const one = build();
    const two = build('两对胸');
    expect(two.bones.map((b) => b.name)).toEqual(one.bones.map((b) => b.name));
    const rows = two.meshes.filter((m) => m.name.endsWith('_Chest_02'));
    expect(rows.length).toBeGreaterThan(0);
    const spine = new Set(['Spine', 'Chest', 'UpperChest'].map((n) => two.bones.findIndex((b) => b.name === n)));
    for (const mesh of rows) {
      for (let i = 0; i < mesh.joints.length; i++) if (mesh.weights[i]) expect(spine.has(mesh.joints[i])).toBe(true);
    }
  });

  it('胸部大小、头身比：靠骨骼缩放，往大往小都管用', () => {
    const front = (bust: number) => {
      const spec = make();
      const b = assembleCharacter(source(), { ...spec, shape: { ...spec.shape, bust } });
      let z = -Infinity;
      for (const mesh of b.meshes) {
        for (let v = 0; v < mesh.positions.length / 3; v++) {
          const y = mesh.positions[v * 3 + 1];
          if (y > 1.14 && y < 1.26 && Math.abs(mesh.positions[v * 3]) < 0.1) z = Math.max(z, mesh.positions[v * 3 + 2]);
        }
      }
      return z;
    };
    expect(front(1.5)).toBeGreaterThan(front(1) + 0.01);
    expect(front(0.5)).toBeLessThan(front(1) - 0.005);
    const head = (headRatio: number) => {
      const spec = make();
      return assembleCharacter(source(), { ...spec, shape: { ...spec.shape, headRatio } }).metrics;
    };
    expect(head(9).headHeight).toBeLessThan(head(7.5).headHeight);
    expect(head(6).headHeight).toBeGreaterThan(head(7.5).headHeight);
    expect(head(9).height).toBeCloseTo(head(6).height, 4);
  });

  it('尾巴、翅膀、角、兽耳：另外捏的单色部件，接在对应的骨骼上', () => {
    const plain = build();
    const b = build('三条尾巴 一对翅膀 猫耳 两只角');
    const names = b.bones.map((x) => x.name);
    for (const name of ['Tail_01_01', 'Tail_03_05', 'Wing_01_L', 'Wing_01_R', 'Ear_01_L', 'Ear_01_R']) expect(names).toContain(name);
    expect(b.bones[bone(b, 'Tail_01_01').parent].name).toBe('Hips');
    expect(b.bones[bone(b, 'Tail_01_02').parent].name).toBe('Tail_01_01');
    expect(b.bones[bone(b, 'Wing_01_L').parent].name).toBe('UpperChest');
    expect(b.bones[bone(b, 'Ear_01_L').parent].name).toBe('Head');
    // 尾巴在身后，翅膀在背后往两边展开，耳朵和角在头上
    expect(bone(b, 'Tail_01_05').tail[2]).toBeLessThan(-0.3);
    expect(bone(b, 'Wing_01_L').tail[0]).toBeGreaterThan(0.2);
    expect(bone(b, 'Ear_01_L').head[1]).toBeGreaterThan(bone(b, 'Head').head[1]);
    // 角色自己的材质后面跟着后加部件用的单色材质（尾巴、兽耳、角、翅膀，再加马身、蹄子、蜘蛛身），没有贴图
    const own = source().materials.length;
    expect(b.materials.slice(own).map((m) => m.name)).toEqual(['OC_Tail', 'OC_Ear', 'OC_Horn', 'OC_Wing', 'OC_Coat', 'OC_Hoof', 'OC_Chitin']);
    for (const m of b.materials.slice(own)) expect(m.image).toBe(-1);
    for (const mesh of b.meshes) expect(mesh.material >= own, mesh.name).toBe(/^(Tail|Wing|Head_\d+_(Horn|Ear))/.test(mesh.name));
    // 角没有自己的骨骼，整个跟着头
    const horn = b.meshes.find((m) => m.name.includes('Horn'))!;
    const headBone = names.indexOf('Head');
    for (let v = 0; v < horn.positions.length / 3; v++) {
      expect(horn.joints[v * 4]).toBe(headBone);
      expect(horn.weights[v * 4]).toBe(1);
    }
    // 身高看头顶，不算角和耳朵
    expect(b.metrics.height).toBeCloseTo(plain.metrics.height, 4);
    expect(span(b).high).toBeGreaterThan(plain.metrics.height + 0.03);
    // 每个头都有自己的耳朵
    expect(build('两个头 猫耳').bones.map((x) => x.name)).toEqual(expect.arrayContaining(['Ear_01_L', 'Ear_01_L.002']));
    expect(b.ignored).toEqual([]);
  });

  it('加了兽耳，她自带的那副猫耳就去掉；不加就留着', () => {
    const own = new Set(source().earMaterials);
    const ears = (b: CharacterBuild) => b.meshes.filter((m) => own.has(m.material)).length;
    expect(ears(build())).toBe(2);
    expect(ears(build('两个头'))).toBe(4);
    expect(ears(build('狐耳'))).toBe(0);
    expect(ears(build('两个头 精灵耳'))).toBe(0);
    // 只加角、尾巴不动耳朵
    expect(ears(build('两只角 一条尾巴'))).toBe(2);
  });

  it('尾巴和兽耳的颜色：量出了头发的颜色就用它', () => {
    const tail = (s: CharacterSource) => assembleCharacter(s, make('一条尾巴')).materials.find((m) => m.name === 'OC_Tail')!.color;
    expect(tail({ ...source(), hairColor: [0.5, 0.6, 0.7] })).toEqual([0.5, 0.6, 0.7, 1]);
    // 没量出来（比如不在浏览器里）：头发的材质底色接近白色，颜色全在贴图里，退回去用深褐色
    expect(Math.max(...tail(source()).slice(0, 3))).toBeLessThan(0.2);
  });

  it('拼不了的设定会列出来', () => {
    expect(build('三只眼').ignored).toContain('眼睛数量');
    const spec = make();
    expect(assembleCharacter(source(), { ...spec, counts: { ...spec.counts, armPairs: 0 } }).ignored).toContain('去掉手臂');
    // 多对腿的几种排法都拼得了
    for (const legLayout of ['taur', 'spider', 'humantaur', 'tandem', 'row'] as const) expect(build('两对腿', { legLayout }).ignored, legLayout).toEqual([]);
    // 人马、蛛形拼得了
    expect(build('半人马').ignored).toEqual([]);
    expect(build('蜘蛛女').ignored).toEqual([]);
    // 单数条人腿、人腿人马每副胯几条腿也拼得了；人马单数多补一条
    for (const text of ['一条腿', '三条腿 腿左右并排', '三条腿 腿前后串联', '人腿人马 前三后三', '五条腿 人马']) expect(build(text).ignored, text).toEqual([]);
  });

  describe('单数条腿、人腿人马每副胯几条腿', () => {
    /** 每条腿的大腿根骨骼 */
    const roots = (b: CharacterBuild) => b.bones.filter((x) => /^UpperLeg(_[LR])?(\.\d+)?$/.test(x.name));
    /** 网格完整：骨骼下标有效，权重加起来是 1 */
    const sound = (b: CharacterBuild) => {
      for (const mesh of b.meshes) {
        for (let v = 0; v < mesh.positions.length / 3; v += 5) {
          let sum = 0;
          for (let k = 0; k < 4; k++) {
            sum += mesh.weights[v * 4 + k];
            if (mesh.weights[v * 4 + k]) expect(mesh.joints[v * 4 + k]).toBeLessThan(b.bones.length);
          }
          expect(sum).toBeCloseTo(1, 3);
        }
      }
    };
    it('单足：她的两条腿并成一条长在正中，骨骼不分左右；身高不变', () => {
      const two = build();
      const one = build('一条腿');
      sound(one);
      expect(roots(one).map((x) => x.name)).toEqual(['UpperLeg']);
      expect(one.bones.some((x) => /_[LR](\.\d+)?$/.test(x.name) && /^(UpperLeg|LowerLeg|Foot|Toe)/.test(x.name))).toBe(false);
      for (const name of ['UpperLeg', 'LowerLeg', 'Foot']) expect(Math.abs(bone(one, name).head[0]), name).toBeLessThan(1e-6);
      expect(bone(one, 'LowerLeg').parent).toBe(one.bones.findIndex((x) => x.name === 'UpperLeg'));
      // 并好的那条腿：脚踝以下的点都在正中附近，宽不过一只脚
      const foot = one.bones.findIndex((x) => x.name === 'Foot');
      let wide = 0;
      for (const mesh of one.meshes) {
        for (let v = 0; v < mesh.positions.length / 3; v++) {
          for (let k = 0; k < 4; k++) if (mesh.joints[v * 4 + k] === foot && mesh.weights[v * 4 + k] > 0.9) wide = Math.max(wide, Math.abs(mesh.positions[v * 3]));
        }
      }
      expect(wide).toBeGreaterThan(0.02);
      expect(wide).toBeLessThan(0.07);
      expect(span(one).high).toBeCloseTo(span(two).high, 2);
    });
    it('三条并排、前后串联三条：正中那条不分左右；人腿人马前三后三、每副胯四条', () => {
      const x = (b: CharacterBuild, name: string) => bone(b, name).head[0];
      const z = (b: CharacterBuild, name: string) => bone(b, name).head[2];
      const row = build('三条腿 腿左右并排');
      sound(row);
      expect(roots(row).map((r) => r.name).sort()).toEqual(['UpperLeg', 'UpperLeg_L', 'UpperLeg_R']);
      expect(Math.abs(x(row, 'UpperLeg'))).toBeLessThan(1e-6);
      // 两边那条离正中两个髋关节间距（和别处一样）
      expect(x(row, 'UpperLeg_L')).toBeCloseTo(2 * x(build(), 'UpperLeg_L'), 2);
      expect(x(row, 'UpperLeg_R')).toBeCloseTo(-x(row, 'UpperLeg_L'), 2);
      // 正中两条并成一条以后，外边的往里收：五条腿也是等距的一排
      const five = build('五条腿 腿左右并排');
      sound(five);
      const xs = roots(five).map((r) => r.head[0]).sort((p, q) => p - q);
      expect(xs).toHaveLength(5);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1], `第 ${i} 个空当`).toBeCloseTo(xs[1] - xs[0], 2);
      expect(x(row, 'UpperLeg_L')).toBeCloseTo(xs[3], 2);
      const tandem = build('三条腿 腿前后串联');
      sound(tandem);
      expect(roots(tandem).map((r) => r.name).sort()).toEqual(['UpperLeg', 'UpperLeg_L', 'UpperLeg_R']);
      expect(z(tandem, 'UpperLeg')).toBeLessThan(z(tandem, 'UpperLeg_L') - 0.1);
      // 前三后三：前面那副胯中间那一段复制一份排开，她的两条腿挪到外边，正中那条是拼出来的；后面那副一样
      const two = build();
      const grid = build('人腿人马 前三后三');
      sound(grid);
      expect(grid.metrics.legForm).toBe('humantaur');
      expect(roots(grid).map((r) => r.name).sort()).toEqual(['UpperLeg', 'UpperLeg.002', 'UpperLeg_L', 'UpperLeg_L.002', 'UpperLeg_R', 'UpperLeg_R.002']);
      expect(x(grid, 'UpperLeg_L') / x(two, 'UpperLeg_L')).toBeCloseTo(2, 1);
      expect(Math.abs(x(grid, 'UpperLeg'))).toBeLessThan(1e-6);
      expect(z(grid, 'UpperLeg')).toBeCloseTo(z(grid, 'UpperLeg_L'), 2);
      expect(z(grid, 'UpperLeg.002')).toBeLessThan(z(grid, 'UpperLeg') - 0.2);
      expect(span(grid).high).toBeCloseTo(span(two).high, 2);
      const four = build('人腿人马，八条腿', { hipLegs: 4 });
      sound(four);
      expect(roots(four)).toHaveLength(8);
      // 前一后一
      expect(roots(build('人腿人马，两条腿', { hipLegs: 1 })).map((r) => r.name).sort()).toEqual(['UpperLeg', 'UpperLeg.002']);
      // 前后串联也能选：前三后三
      const chain = build('前三后三，腿前后串联');
      sound(chain);
      expect(chain.metrics.legForm).toBe('tandem');
      expect(roots(chain).map((r) => r.name).sort()).toEqual(['UpperLeg', 'UpperLeg.002', 'UpperLeg_L', 'UpperLeg_L.002', 'UpperLeg_R', 'UpperLeg_R.002']);
      expect(z(chain, 'UpperLeg.002')).toBeLessThan(z(chain, 'UpperLeg') - 0.1);
    });
    it('胯部聚拢：几副胯一副紧贴一副，腿往下往外散开，脚还踩在原来的高度上；单数时正中那条在最后', () => {
      const plain = build();
      const b = build('六条腿 腿胯部聚拢');
      sound(b);
      expect(b.ignored).toEqual([]);
      expect(b.metrics.legForm).toBe('gather');
      expect(roots(b).map((r) => r.name).sort()).toEqual(['UpperLeg_L', 'UpperLeg_L.002', 'UpperLeg_L.003', 'UpperLeg_R', 'UpperLeg_R.002', 'UpperLeg_R.003']);
      const head = (x: CharacterBuild, name: string) => bone(x, name).head;
      // 一副紧贴在前一副后面（比前后串联近得多），髋关节左右还在原来的地方
      const dz = head(b, 'UpperLeg_L')[2] - head(b, 'UpperLeg_L.002')[2];
      expect(dz).toBeGreaterThan(0.03);
      expect(dz).toBeLessThan(0.1);
      expect(head(b, 'UpperLeg_L.003')[0]).toBeCloseTo(head(b, 'UpperLeg_L')[0], 3);
      // 脚一对比一对往外，往后越散越开；左右对称；高度不变
      const foot = (name: string) => head(b, name);
      const gap = foot('Foot_L.002')[0] - foot('Foot_L')[0];
      expect(foot('Foot_L')[0]).toBeCloseTo(head(plain, 'Foot_L')[0], 6);
      expect(gap).toBeGreaterThan(0.08);
      expect(foot('Foot_L.003')[0] - foot('Foot_L.002')[0]).toBeGreaterThan(gap);
      expect(foot('Foot_R.003')[0]).toBeCloseTo(-foot('Foot_L.003')[0], 2);
      for (const name of ['Foot_L', 'Foot_L.002', 'Foot_R.003']) expect(foot(name)[1], name).toBeCloseTo(head(plain, 'Foot_L')[1], 6);
      // 单数：最后那副胯上正中一条，前面那对也往外散开半步
      const five = build('五条腿 腿胯部聚拢');
      sound(five);
      expect(Math.abs(head(five, 'UpperLeg')[0])).toBeLessThan(1e-6);
      expect(head(five, 'UpperLeg')[2]).toBeLessThan(head(five, 'UpperLeg_L.002')[2] - 0.03);
      expect(head(five, 'Foot_L')[0] - head(plain, 'Foot_L')[0]).toBeGreaterThan(0.03);
      // 两条腿时这个排法不起作用
      expect(build('', { legLayout: 'gather' }).bones).toEqual(build().bones);
    });
  });

  it('同样的设定拼两次，结果一样；不会改动读进来的原始数据', () => {
    const before = source().chunks[0].positions.slice();
    const a = build('两个头，两对手，两对胸');
    const b = build('两个头，两对手，两对胸');
    expect(a.bones).toEqual(b.bones);
    expect(a.meshes.map((m) => m.name)).toEqual(b.meshes.map((m) => m.name));
    expect([...a.meshes[3].positions.subarray(0, 30)]).toEqual([...b.meshes[3].positions.subarray(0, 30)]);
    expect([...source().chunks[0].positions]).toEqual([...before]);
  });
});

/** 每个顶点的权重加起来是 1，骨骼下标有效，三角面的下标不越界 */
function expectSkinned(b: CharacterBuild) {
  for (const mesh of b.meshes) {
    const count = mesh.positions.length / 3;
    let highest = 0;
    for (const index of mesh.indices) highest = Math.max(highest, index);
    expect(highest, mesh.name).toBeLessThan(count);
    expect(mesh.normals.length).toBe(count * 3);
    for (let v = 0; v < count; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += mesh.weights[v * 4 + k];
        if (mesh.joints[v * 4 + k] >= b.bones.length) throw new Error(`${mesh.name} 第 ${v} 个顶点用到了不存在的骨骼`);
      }
      if (Math.abs(sum - 1) > 1e-4) throw new Error(`${mesh.name} 第 ${v} 个顶点的权重加起来是 ${sum}`);
    }
  }
}
const parentName = (b: CharacterBuild, name: string) => b.bones[bone(b, name).parent]?.name;
const meshOf = (b: CharacterBuild, name: string) => {
  const found = b.meshes.find((m) => m.name === name);
  if (!found) throw new Error(`没有网格 ${name}`);
  return found;
};
/** 一块网格在某个轴上最小、最大到哪 */
function extent(mesh: { positions: Float32Array }, axis: 0 | 1 | 2) {
  let low = Infinity;
  let high = -Infinity;
  for (let i = axis; i < mesh.positions.length; i += 3) {
    low = Math.min(low, mesh.positions[i]);
    high = Math.max(high, mesh.positions[i]);
  }
  return { low, high };
}

describe('成品角色的人马和蛛形', () => {
  it('兽身：照白模人台的做法捏出来融合成一块，带骨骼和蒙皮；只算一次', () => {
    const horse = beastBody('taur', 2);
    expect(beastBody('taur', 2)).toBe(horse);
    const count = horse.body.positions.length / 3;
    expect(count).toBeGreaterThan(5000);
    for (const piece of [horse.body, horse.hoof!]) {
      const n = piece.positions.length / 3;
      expect(piece.normals.length).toBe(n * 3);
      expect(piece.uvs.length).toBe(n * 2);
      expect(piece.joints.length).toBe(n * 4);
      for (let v = 0; v < n; v++) {
        const sum = piece.weights[v * 4] + piece.weights[v * 4 + 1] + piece.weights[v * 4 + 2] + piece.weights[v * 4 + 3];
        if (Math.abs(sum - 1) > 1e-5) throw new Error(`第 ${v} 个顶点的权重加起来是 ${sum}`);
      }
      for (const index of piece.indices) if (index >= n) throw new Error('面的下标越界');
    }
    // 第 0 根骨骼是胯（接的时候换成角色自己的）；四条腿各三节，马身后半截一节
    expect(horse.bones[0].name).toBe('Hips');
    expect(horse.bones.map((x) => x.name).sort()).toEqual(
      ['Hips', 'LowerBody_01', ...['', '.002'].flatMap((n) => ['L', 'R'].flatMap((s) => ['UpperLeg', 'LowerLeg', 'Foot'].map((base) => `${base}_${s}${n}`)))].sort(),
    );
    horse.bones.forEach((x, i) => expect(x.parent).toBeLessThan(i));
    // 蹄子另算一块，都在地面附近，底是平的，正好踩在地面上；身子的面多得多
    expect(horse.hoof!.indices.length).toBeGreaterThan(300);
    expect(horse.body.indices.length).toBeGreaterThan(horse.hoof!.indices.length * 5);
    expect(extent(horse.hoof!, 1).high).toBeLessThan(0.09);
    expect(extent(horse.hoof!, 1).low).toBeGreaterThan(-0.005);
    expect(extent(horse.hoof!, 1).low).toBeLessThan(0.005);
    expect(extent(horse.body, 1).low).toBeGreaterThan(0.05);
    // 座位在马身前端的背上
    expect(horse.seat[1]).toBeGreaterThan(1.1);
    expect(horse.seat[2]).toBeGreaterThan(0.05);
    expect(horse.tailRoot[2]).toBeLessThan(-0.4);
    expect(horse.tailParent).toBe('LowerBody_01');
    // 蛛形：没有蹄子，八条腿，尾巴接在腹部
    const spider = beastBody('spider', 4);
    expect(spider.hoof).toBeNull();
    expect(spider.bones.filter((x) => /^UpperLeg/.test(x.name))).toHaveLength(8);
    expect(spider.tailParent).toBe('Abdomen');
  });

  it('半人马：她自己的腿去掉，胯以下接一个马身；马身和蹄子各是一块单色的网格', () => {
    const plain = build();
    const b = build('半人马');
    expect(b.ignored).toEqual([]);
    expect(b.metrics.legForm).toBe('taur');
    expectSkinned(b);
    const material = (name: string) => b.materials[meshOf(b, name).material].name;
    expect(material('Horse')).toBe('OC_Coat');
    expect(material('Hooves')).toBe('OC_Hoof');
    // 鞋子整块没了；身体的皮肤少了两条腿；裙子还在
    const count = (x: CharacterBuild, test: RegExp) =>
      x.meshes.filter((m) => test.test(x.materials[m.material].name)).reduce((sum, m) => sum + m.indices.length / 3, 0);
    expect(count(plain, /Shoes/)).toBeGreaterThan(100);
    expect(count(b, /Shoes/)).toBe(0);
    expect(count(b, /Body_00_SKIN/)).toBeLessThan(count(plain, /Body_00_SKIN/) * 0.75);
    expect(count(b, /Onepice/)).toBe(count(plain, /Onepice/));
    // 踩在地上；比两条腿的时候高一点（坐在马背上），高不出一个头
    expect(span(b).low).toBeCloseTo(0, 6);
    expect(b.metrics.height).toBeGreaterThan(plain.metrics.height + 0.05);
    expect(b.metrics.height).toBeLessThan(plain.metrics.height + plain.metrics.headHeight);
    // 骨架：四条马腿（各三节）、马身后半截一节；她自己的腿骨没了
    const names = b.bones.map((x) => x.name);
    for (const name of ['UpperLeg_L', 'LowerLeg_L', 'Foot_L', 'UpperLeg_R.002', 'Foot_R.002', 'LowerBody_01']) expect(names).toContain(name);
    expect(names).not.toContain('Toes_L');
    expect(names.filter((n) => n.includes('~'))).toEqual([]);
    expect(parentName(b, 'UpperLeg_L')).toBe('Hips');
    expect(parentName(b, 'LowerBody_01')).toBe('Hips');
    expect(parentName(b, 'UpperLeg_L.002')).toBe('LowerBody_01');
    // 前腿在她正下方，后腿在身后；蹄子着地
    const hips = bone(b, 'Hips').head;
    expect(Math.abs(bone(b, 'UpperLeg_L').head[2] - hips[2])).toBeLessThan(0.1);
    expect(bone(b, 'UpperLeg_L.002').head[2]).toBeLessThan(hips[2] - 0.3);
    expect(bone(b, 'Foot_L').tail[1]).toBeLessThan(0.08);
    expect(bone(b, 'UpperLeg_R').head[0]).toBeCloseTo(-bone(b, 'UpperLeg_L').head[0], 6);
    // 裙摆的骨骼本来挂在大腿上，现在改接到胯上
    expect(parentName(plain, 'SkirtFront1_L')).toBe('UpperLeg_L');
    expect(parentName(b, 'SkirtFront1_L')).toBe('Hips');
    // 马背差不多齐着她的胯：她坐在里面，没有悬空，也没有埋到腰
    const back = extent(meshOf(b, 'Horse'), 1).high;
    expect(back).toBeGreaterThan(hips[1] - 0.08);
    expect(back).toBeLessThan(hips[1] + 0.12);
    // 马身比她的肩膀宽一点，从她身后伸出去
    expect(extent(meshOf(b, 'Horse'), 0).high).toBeGreaterThan(0.13);
    expect(extent(meshOf(b, 'Horse'), 2).low).toBeLessThan(hips[2] - 0.5);
    // 蹄子的面都在地面附近
    expect(extent(meshOf(b, 'Hooves'), 1).high).toBeLessThan(0.1);
    // 大腿根剩下的那一圈埋在马的前胸里（前胸有四十多厘米厚），没有从底下支出来
    const skinLow = Math.min(...b.meshes.filter((m) => /Body_00_SKIN/.test(b.materials[m.material].name)).map((m) => extent(m, 1).low));
    expect(skinLow).toBeGreaterThan(back - 0.2);
  });

  it('蜘蛛女：头胸部加腹部的蜘蛛身，八条腿往两边伸出去；尾巴长在腹部后端', () => {
    const b = build('蜘蛛女 一条尾巴');
    expect(b.ignored).toEqual([]);
    expect(b.metrics.legForm).toBe('spider');
    expectSkinned(b);
    const spider = meshOf(b, 'Spider');
    expect(b.materials[spider.material].name).toBe('OC_Chitin');
    expect(b.meshes.some((m) => m.name === 'Hooves')).toBe(false);
    const names = b.bones.map((x) => x.name);
    expect(names.filter((n) => /^UpperLeg_[LR]/.test(n))).toHaveLength(8);
    expect(parentName(b, 'Abdomen')).toBe('Hips');
    expect(parentName(b, 'Tail_01_01')).toBe('Abdomen');
    // 腿往两边伸出去很远，足尖着地；腹部拖在身后
    expect(extent(spider, 0).high).toBeGreaterThan(0.6);
    expect(extent(spider, 0).low).toBeCloseTo(-extent(spider, 0).high, 2);
    expect(span(b).low).toBeCloseTo(0, 6);
    expect(extent(spider, 2).low).toBeLessThan(bone(b, 'Hips').head[2] - 0.6);
    expect(bone(b, 'Tail_01_01').head[2]).toBeLessThan(bone(b, 'Hips').head[2] - 0.6);
  });

  it('记下来的兽身不会被拼装改掉：连拼两次，结果一样；改身高也只是整体缩放', () => {
    const before = beastBody('taur', 2).body.positions.slice();
    const a = build('半人马');
    const b = build('半人马');
    expect([...beastBody('taur', 2).body.positions.subarray(0, 300)]).toEqual([...before.subarray(0, 300)]);
    expect(a.bones).toEqual(b.bones);
    expect([...meshOf(a, 'Horse').positions.subarray(0, 300)]).toEqual([...meshOf(b, 'Horse').positions.subarray(0, 300)]);
    expect([...meshOf(a, 'Horse').joints.subarray(0, 300)]).toEqual([...meshOf(b, 'Horse').joints.subarray(0, 300)]);
    const spec = make('半人马');
    const tall = assembleCharacter(source(), { ...spec, shape: { ...spec.shape, height: 2 } });
    const ratio = 2 / spec.shape.height;
    expect(extent(meshOf(tall, 'Horse'), 1).high).toBeCloseTo(extent(meshOf(a, 'Horse'), 1).high * ratio, 4);
    expect(tall.metrics.height).toBeCloseTo(a.metrics.height * ratio, 4);
  });

  it('兽身可以和别的一起用：尾巴接在马身后端，多个头、多对手臂、T-pose、三对腿都行', () => {
    const b = build('半人马 一条尾巴 两个头 两对手', { pose: 'T' });
    expect(b.ignored).toEqual([]);
    expectSkinned(b);
    expect(parentName(b, 'Tail_01_01')).toBe('LowerBody_01');
    expect(bone(b, 'Tail_01_01').head[2]).toBeLessThan(bone(b, 'UpperLeg_L.002').head[2]);
    for (const name of ['Head.002', 'UpperArm_L.002']) expect(b.bones.map((x) => x.name)).toContain(name);
    // 三对腿的人马：马身加长，六条腿
    const six = build('三对腿', { legLayout: 'taur' });
    expect(six.metrics.legForm).toBe('taur');
    expect(parentName(six, 'UpperLeg_L.003')).toBe('LowerBody_02');
    expect(extent(meshOf(six, 'Horse'), 2).low).toBeLessThan(extent(meshOf(build('半人马'), 'Horse'), 2).low - 0.15);
    // 肩部聚拢、自然下垂的手臂要让开兽身：比没有兽身时张得开
    const hand = (x: CharacterBuild) => bone(x, 'Hand_L').head[0];
    expect(hand(build('蜘蛛女 两对手 肩部聚拢'))).toBeGreaterThan(hand(build('两对手 肩部聚拢')) + 0.02);
  });

  it('导出：带骨骼的 GLB 里马身和她是同一个物体，骨骼都在', () => {
    const b = build('半人马');
    const { json } = readGlb(characterGlb(b, { rig: true }));
    expect(json.meshes).toHaveLength(1);
    expect(json.skins[0].joints).toHaveLength(b.bones.length);
    const names = json.materials.map((m: { name: string }) => m.name);
    expect(names).toContain('OC_Coat');
    expect(names).toContain('OC_Hoof');
    // 单色的部件照常受光照，不是 unlit
    const coat = json.materials.find((m: { name: string }) => m.name === 'OC_Coat');
    expect(coat.extensions).toBeUndefined();
  });
});

describe('成品角色的人腿人马（humantaur）', () => {
  it('身后接一份她自己的腰、胯和腿：腰折平了并进前面的后腰里，胯和腿原样立着', () => {
    const plain = build();
    const b = build('humantaur');
    expect(b.ignored).toEqual([]);
    expect(b.metrics.legForm).toBe('humantaur');
    expectSkinned(b);
    // 腿还是人腿、还是那么长：身高不变，她本来的骨骼都在原地
    expect(b.metrics.height).toBeCloseTo(plain.metrics.height, 6);
    for (const name of ['Hips', 'Spine', 'UpperLeg_L', 'Foot_R', 'Head', 'UpperArm_L']) expect(bone(b, name).head, name).toEqual(bone(plain, name).head);
    // 复制出来的那一份有自己的骨骼：胯、腰、腿、脚趾、裙摆，名字带 .002
    const names = b.bones.map((x) => x.name);
    for (const name of ['Hips.002', 'Spine.002', 'Chest.002', 'UpperLeg_L.002', 'LowerLeg_R.002', 'Toes_L.002', 'SkirtFront1_L.002', 'SkirtSide1_R.002']) {
      expect(names, name).toContain(name);
    }
    // 胸以上的东西没有复制：没有第二个头、第二对手臂
    for (const name of ['UpperChest.002', 'Neck.002', 'Head.002', 'UpperArm_L.002', 'Bust1_L.002']) expect(names, name).not.toContain(name);
    expect(parentName(b, 'Hips.002')).toBe('Hips');
    expect(parentName(b, 'UpperLeg_L.002')).toBe('Hips.002');
    expect(parentName(b, 'Spine.002')).toBe('Hips.002');
    expect(parentName(b, 'Chest.002')).toBe('Spine.002');
    // 后面那副胯在身后三四十厘米，和前面一样高；后腿、后脚和前面的一模一样，只是往后挪了
    const hips = bone(b, 'Hips').head;
    const rear = bone(b, 'Hips.002').head;
    const span = hips[2] - rear[2];
    expect(span).toBeGreaterThan(0.3);
    expect(span).toBeLessThan(0.45);
    expect(rear[0]).toBeCloseTo(hips[0], 6);
    expect(rear[1]).toBeCloseTo(hips[1], 6);
    for (const name of ['UpperLeg_L', 'LowerLeg_R', 'Foot_L', 'Toes_R']) {
      const a = bone(b, name).head;
      const c = bone(b, `${name}.002`).head;
      expect(c[0], name).toBeCloseTo(a[0], 6);
      expect(c[1], name).toBeCloseTo(a[1], 6);
      expect(c[2], name).toBeCloseTo(a[2] - span, 6);
    }
    // 腰折平了：复制出来的 Chest 不在 Spine 上面，而在它前面，差不多一样高
    const spine2 = bone(b, 'Spine.002').head;
    const chest2 = bone(b, 'Chest.002').head;
    expect(chest2[2]).toBeGreaterThan(spine2[2] + 0.1);
    expect(Math.abs(chest2[1] - spine2[1])).toBeLessThan(0.03);
    // 折平的腰够着了前面那副胯：最前头伸进了她后腰里面（她的后背在 z ≈ -0.08）
    const copies = b.meshes.filter((m) => /_Lower_02$/.test(m.name));
    expect(copies.length).toBeGreaterThan(3);
    const front = Math.max(...copies.map((m) => extent(m, 2).high));
    expect(front).toBeGreaterThan(-0.06);
    expect(front).toBeLessThan(0.06);
    // 复制出来的那一份：有皮肤、有裙子、有鞋，都踩在地上；最高到后腰，没有胸
    const material = (m: { material: number }) => b.materials[m.material].name;
    for (const kind of [/Body_00_SKIN/, /Onepice/, /Shoes/]) expect(copies.some((m) => kind.test(material(m))), String(kind)).toBe(true);
    expect(Math.min(...copies.map((m) => extent(m, 1).low))).toBeCloseTo(0, 3);
    expect(Math.max(...copies.map((m) => extent(m, 1).high))).toBeLessThan(bone(b, 'Chest').head[1] + 0.03);
    // 左右对称
    const wide = copies.map((m) => extent(m, 0));
    expect(Math.max(...wide.map((w) => w.high))).toBeCloseTo(-Math.min(...wide.map((w) => w.low)), 2);
  });

  it('三对、四对腿就往后再接一份；尾巴长在最后那副胯上；能和多头、多臂、T-pose 一起用', () => {
    const three = build('三对腿 一条尾巴', { legLayout: 'humantaur' });
    expect(three.ignored).toEqual([]);
    expectSkinned(three);
    expect(parentName(three, 'Hips.003')).toBe('Hips.002');
    expect(parentName(three, 'UpperLeg_R.003')).toBe('Hips.003');
    expect(parentName(three, 'Tail_01_01')).toBe('Hips.003');
    const z = (name: string) => bone(three, name).head[2];
    expect(z('Hips') - z('Hips.002')).toBeCloseTo(z('Hips.002') - z('Hips.003'), 6);
    expect(z('Tail_01_01')).toBeLessThan(z('Hips.003') - 0.05);
    // 两条腿时尾巴照常长在她自己的胯上
    expect(parentName(build('一条尾巴'), 'Tail_01_01')).toBe('Hips');
    const four = build('四对腿', { legLayout: 'humantaur' });
    expect(four.bones.filter((x) => /^Hips(\.\d+)?$/.test(x.name))).toHaveLength(4);
    // 每接一份多出来的骨骼一样多，名字只带一个序号（不会把前面复制出来的那份又复制一遍）
    const two = build('humantaur');
    const count = (x: CharacterBuild) => x.bones.length;
    const tail = count(build('一条尾巴')) - count(build());
    expect(count(three) - tail - count(two)).toBe(count(two) - count(build()));
    expect(count(four) - count(two)).toBe(2 * (count(two) - count(build())));
    for (const x of [three, four]) expect(x.bones.filter((y) => /\.\d+\.\d+/.test(y.name))).toEqual([]);
    // 每根复制出来的腿骨都带着顶点
    const used = new Set<number>();
    for (const mesh of four.meshes) for (let i = 0; i < mesh.joints.length; i++) if (mesh.weights[i] > 0.2) used.add(mesh.joints[i]);
    for (const name of ['UpperLeg_L.004', 'LowerLeg_R.003', 'Foot_L.002', 'Hips.004', 'Spine.003']) {
      expect(used.has(four.bones.findIndex((y) => y.name === name)), name).toBe(true);
    }
    const mixed = build('humantaur 两个头 两对手 猫耳', { pose: 'T' });
    expect(mixed.ignored).toEqual([]);
    expectSkinned(mixed);
    for (const name of ['Head.002', 'UpperArm_L.002', 'Hips.002', 'UpperLeg_L.002']) expect(mixed.bones.map((x) => x.name)).toContain(name);
    // 一对腿时这个排法不起作用
    expect(build('', { legLayout: 'humantaur' }).bones).toEqual(build().bones);
  });

  it('导出：带骨骼的 GLB 写得出来，骨骼都在', () => {
    const b = build('humantaur');
    const { json } = readGlb(characterGlb(b, { rig: true }));
    expect(json.skins[0].joints).toHaveLength(b.bones.length);
    const nodes = json.nodes.map((n: { name: string }) => n.name);
    for (const name of ['Hips.002', 'UpperLeg_L.002', 'Toes_R.002']) expect(nodes).toContain(name);
  });
});

describe('成品角色的腿前后串联', () => {
  it('两对腿：身后紧挨着再接一副她自己的胯和腿，没有横着的那截腰', () => {
    const plain = build();
    const b = build('两对腿', { legLayout: 'tandem' });
    expect(b.ignored).toEqual([]);
    expect(b.metrics.legForm).toBe('tandem');
    expectSkinned(b);
    // 腿还是那么长：身高不变，她本来的骨骼都在原地
    expect(b.metrics.height).toBeCloseTo(plain.metrics.height, 6);
    for (const name of ['Hips', 'Spine', 'Chest', 'UpperLeg_L', 'Foot_R', 'Head', 'Hand_L']) expect(bone(b, name).head, name).toEqual(bone(plain, name).head);
    // 后面那副胯有一根自己的骨骼（和白模人台一样叫 LowerBody_01），从她的胯伸到后面那副胯；脊柱没有复制
    const names = b.bones.map((x) => x.name);
    for (const name of ['Hips.002', 'Spine.002', 'Chest.002', 'Head.002', 'UpperArm_L.002']) expect(names, name).not.toContain(name);
    expect(parentName(b, 'LowerBody_01')).toBe('Hips');
    expect(bone(b, 'LowerBody_01').head).toEqual(bone(b, 'Hips').head);
    for (const name of ['UpperLeg_L.002', 'UpperLeg_R.002', 'SkirtSide1_L.002']) expect(parentName(b, name), name).toBe('LowerBody_01');
    expect(parentName(b, 'Toes_R.002')).toBe('Foot_R.002');
    // 后腿和前腿一模一样，只是往后挪了：隔得比人腿人马近得多（差不多是腿长的四分之一）
    const span = bone(b, 'UpperLeg_L').head[2] - bone(b, 'UpperLeg_L.002').head[2];
    const legLength = bone(b, 'UpperLeg_L').head[1];
    expect(span).toBeGreaterThan(legLength * 0.2);
    expect(span).toBeLessThan(legLength * 0.3);
    const taur = build('humantaur');
    expect(span).toBeLessThan((bone(taur, 'UpperLeg_L').head[2] - bone(taur, 'UpperLeg_L.002').head[2]) * 0.8);
    for (const name of ['UpperLeg_L', 'LowerLeg_R', 'Foot_L', 'Toes_R']) {
      const a = bone(b, name).head;
      const c = bone(b, `${name}.002`).head;
      expect(c[0], name).toBeCloseTo(a[0], 6);
      expect(c[1], name).toBeCloseTo(a[1], 6);
      expect(c[2], name).toBeCloseTo(a[2] - span, 6);
    }
    const tail = bone(b, 'LowerBody_01').tail;
    expect(tail[2]).toBeCloseTo(bone(b, 'Hips').head[2] - span, 6);
    expect(tail[1]).toBeCloseTo(bone(b, 'Hips').head[1], 6);
    // 复制出来的那一份：有皮肤、有裙子、有鞋，踩在地上；最高到腰，没有胸；左右对称，最靠后的地方比她自己靠后一个间隔
    const copies = b.meshes.filter((m) => /_Lower_02$/.test(m.name));
    expect(copies.length).toBeGreaterThan(3);
    const material = (m: { material: number }) => b.materials[m.material].name;
    for (const kind of [/Body_00_SKIN/, /Onepice/, /Shoes/]) expect(copies.some((m) => kind.test(material(m))), String(kind)).toBe(true);
    expect(Math.min(...copies.map((m) => extent(m, 1).low))).toBeCloseTo(0, 3);
    expect(Math.max(...copies.map((m) => extent(m, 1).high))).toBeLessThan(bone(b, 'Chest').head[1] + 0.08);
    const wide = copies.map((m) => extent(m, 0));
    expect(Math.max(...wide.map((w) => w.high))).toBeCloseTo(-Math.min(...wide.map((w) => w.low)), 2);
    const rear = (x: CharacterBuild) => Math.min(...x.meshes.filter((m) => !/HAIR/.test(x.materials[m.material].name)).map((m) => extent(m, 2).low));
    expect(rear(plain) - rear(b)).toBeCloseTo(span, 2);
    // 每根后腿的骨骼都带着顶点，后面那副胯上的顶点跟着 LowerBody_01
    const used = new Set<number>();
    for (const mesh of b.meshes) for (let i = 0; i < mesh.joints.length; i++) if (mesh.weights[i] > 0.2) used.add(mesh.joints[i]);
    for (const name of ['LowerBody_01', 'UpperLeg_L.002', 'LowerLeg_R.002', 'Foot_L.002']) expect(used.has(names.indexOf(name)), name).toBe(true);
  });

  it('三对、四对腿就往后再接；尾巴长在最后那副胯上；能和多头、多臂、T-pose 一起用', () => {
    const three = build('三对腿 一条尾巴', { legLayout: 'tandem' });
    expect(three.ignored).toEqual([]);
    expectSkinned(three);
    expect(parentName(three, 'LowerBody_02')).toBe('LowerBody_01');
    expect(parentName(three, 'UpperLeg_R.003')).toBe('LowerBody_02');
    expect(parentName(three, 'Tail_01_01')).toBe('LowerBody_02');
    expect(bone(three, 'LowerBody_02').head).toEqual(bone(three, 'LowerBody_01').tail);
    const z = (x: CharacterBuild, name: string) => bone(x, name).head[2];
    expect(z(three, 'UpperLeg_L') - z(three, 'UpperLeg_L.002')).toBeCloseTo(z(three, 'UpperLeg_L.002') - z(three, 'UpperLeg_L.003'), 6);
    // 尾巴在最后那副胯的后面
    expect(z(three, 'Tail_01_01')).toBeLessThan(z(three, 'UpperLeg_L.003') - 0.03);
    expect(parentName(build('一条尾巴'), 'Tail_01_01')).toBe('Hips');
    const two = build('两对腿', { legLayout: 'tandem' });
    const four = build('四对腿', { legLayout: 'tandem' });
    expectSkinned(four);
    expect(four.bones.filter((x) => /^LowerBody_\d+$/.test(x.name))).toHaveLength(3);
    expect(four.bones.filter((x) => /^UpperLeg_[LR](\.\d+)?$/.test(x.name))).toHaveLength(8);
    // 每接一份多出来的骨骼一样多，名字只带一个序号
    const count = (x: CharacterBuild) => x.bones.length;
    expect(count(four) - count(two)).toBe(2 * (count(two) - count(build())));
    for (const x of [three, four]) expect(x.bones.filter((y) => /\.\d+\.\d+/.test(y.name))).toEqual([]);
    const mixed = build('两对腿 两个头 两对手 猫耳', { legLayout: 'tandem', pose: 'T' });
    expect(mixed.ignored).toEqual([]);
    expectSkinned(mixed);
    for (const name of ['Head.002', 'UpperArm_L.002', 'LowerBody_01', 'UpperLeg_L.002']) expect(mixed.bones.map((x) => x.name)).toContain(name);
    // 一对腿时这个排法不起作用
    expect(build('', { legLayout: 'tandem' }).bones).toEqual(build().bones);
    // 导出：带骨骼的 GLB 写得出来，骨骼都在
    const { json } = readGlb(characterGlb(two, { rig: true }));
    expect(json.skins[0].joints).toHaveLength(two.bones.length);
    const nodes = json.nodes.map((n: { name: string }) => n.name);
    for (const name of ['LowerBody_01', 'UpperLeg_L.002', 'Toes_R.002']) expect(nodes).toContain(name);
  });
});

describe('成品角色的腿左右并排', () => {
  /** 高度在 [low, high] 里的顶点，离中线最远的有多远 */
  const reach = (b: CharacterBuild, low: number, high: number) => {
    let far = 0;
    for (const mesh of b.meshes) {
      for (let i = 0; i < mesh.positions.length; i += 3) {
        if (mesh.positions[i + 1] >= low && mesh.positions[i + 1] <= high) far = Math.max(far, Math.abs(mesh.positions[i]));
      }
    }
    return far;
  };
  const legs = (pairs: number) => [
    ...Array.from({ length: pairs }, (_, k) => `L${pairs - 1 - k ? `.00${pairs - k}` : ''}`),
    ...Array.from({ length: pairs }, (_, k) => `R${k ? `.00${k + 1}` : ''}`),
  ];

  it('两对腿：她的胯中间那一段照原样复制排开，她的两条腿挪到最外边，中间两条是拼出来的；四条腿等距、笔直，花纹不拉宽', () => {
    const plain = build('', { pose: 'T' });
    const b = build('两对腿', { legLayout: 'row', pose: 'T' });
    expect(b.ignored).toEqual([]);
    expect(b.metrics.legForm).toBe('row');
    expectSkinned(b);
    // 腿还是那么长：身高不变；胯、脊柱、手臂、头的骨骼都在原地
    expect(b.metrics.height).toBeCloseTo(plain.metrics.height, 6);
    for (const name of ['Hips', 'Spine', 'Chest', 'Head', 'UpperArm_L', 'Hand_R']) expect(bone(b, name).head, name).toEqual(bone(plain, name).head);
    // 只有一副胯：没有复制出来的胯、脊柱、裙摆；四条腿都接在 Hips 下面
    const names = b.bones.map((x) => x.name);
    for (const name of ['Hips.002', 'Spine.002', 'Chest.002', 'Head.002', 'UpperArm_L.002', 'SkirtFront1_L.002']) expect(names, name).not.toContain(name);
    expect(names).toContain('SkirtFront1_L');
    expect(legs(2)).toEqual(['L.002', 'L', 'R', 'R.002']);
    for (const leg of legs(2)) {
      expect(parentName(b, `UpperLeg_${leg}`), leg).toBe('Hips');
      expect(parentName(b, `LowerLeg_${leg}`), leg).toBe(`UpperLeg_${leg}`);
      expect(parentName(b, `Toes_${leg}`), leg).toBe(`Foot_${leg}`);
    }
    // 骨骼照位置起名：从她的左边到右边是 L.002、L、R、R.002，隔得一样远，就是原来两条腿隔的那么远（左右差不到一毫米）
    const gap = bone(plain, 'UpperLeg_L').head[0] - bone(plain, 'UpperLeg_R').head[0];
    const xs = legs(2).map((leg) => bone(b, `UpperLeg_${leg}`).head[0]);
    for (let i = 0; i + 1 < xs.length; i++) expect(xs[i] - xs[i + 1], String(i)).toBeCloseTo(gap, 2);
    expect(xs[0]).toBeCloseTo(-xs[3], 2);
    expect(xs[1]).toBeCloseTo(-xs[2], 2);
    // 每条腿都笔直朝下（脚踝在髋关节正下方），和原来一样高、一样靠前
    for (const leg of legs(2)) {
      const hip = bone(b, `UpperLeg_${leg}`).head;
      const foot = bone(b, `Foot_${leg}`).head;
      const was = bone(plain, `Foot_${leg[0]}`).head;
      expect(foot[0], leg).toBeCloseTo(hip[0], 3);
      expect(foot[1], leg).toBeCloseTo(was[1], 6);
      expect(foot[2], leg).toBeCloseTo(was[2], 6);
    }
    // 中间那两条是拼出来的（一条腿的里侧一半加另一条腿的里侧一半），没有单独复制的腿
    expect(b.meshes.filter((m) => /_Leg_\d+/.test(m.name)).map((m) => m.name)).toEqual([]);
    const hipY = bone(b, 'UpperLeg_L').head[1];
    // 胯那一圈的衣服花纹、褶子没有被拉宽：贴图上一样大的地方，身上还是差不多一样大（照直拉宽的话要宽出四成）
    const density = (x: CharacterBuild) => {
      const list: number[] = [];
      for (const m of x.meshes) {
        for (let t = 0; t < m.indices.length; t += 3) {
          const [p, q, r] = [0, 1, 2].map((k) => m.indices[t + k]);
          const at = (v: number, k: number) => m.positions[v * 3 + k];
          const y = (at(p, 1) + at(q, 1) + at(r, 1)) / 3;
          if (y < hipY - 0.05 || y > hipY + 0.08) continue;
          const e = [0, 1, 2].map((k) => [at(q, k) - at(p, k), at(r, k) - at(p, k)]);
          const area = Math.hypot(e[1][0] * e[2][1] - e[2][0] * e[1][1], e[2][0] * e[0][1] - e[0][0] * e[2][1], e[0][0] * e[1][1] - e[1][0] * e[0][1]);
          const uv = (k: number, v: number) => m.uvs[v * 2 + k] - m.uvs[p * 2 + k];
          const flat = Math.abs(uv(0, q) * uv(1, r) - uv(0, r) * uv(1, q));
          if (area > 1e-9 && flat > 1e-9) list.push(Math.sqrt(area / flat));
        }
      }
      return list.sort((u, w) => u - w)[Math.floor(list.length * 0.75)];
    };
    expect(density(b) / density(plain)).toBeLessThan(1.08);
    // 腰还是一个人的腰（没有变宽），胯那里宽出去一条腿的间隔，左右对称
    const chest = bone(b, 'Chest').head[1];
    expect(reach(b, chest + 0.07, chest + 0.1)).toBeCloseTo(reach(plain, chest + 0.07, chest + 0.1), 6);
    expect(reach(b, hipY - 0.02, hipY + 0.02)).toBeCloseTo(reach(plain, hipY - 0.02, hipY + 0.02) + gap, 1);
    const wide = b.meshes.map((m) => extent(m, 0));
    expect(Math.max(...wide.map((w) => w.high))).toBeCloseTo(-Math.min(...wide.map((w) => w.low)), 2);
    // 每根腿骨都带着顶点
    const used = new Set<number>();
    for (const mesh of b.meshes) for (let i = 0; i < mesh.joints.length; i++) if (mesh.weights[i] > 0.2) used.add(mesh.joints[i]);
    for (const leg of legs(2)) for (const part of ['UpperLeg', 'LowerLeg', 'Foot']) expect(used.has(names.indexOf(`${part}_${leg}`)), `${part}_${leg}`).toBe(true);
  });

  it('三对、四对腿接着往两边排；尾巴照常长在后腰正中，手臂跟着让；能和多头、多臂一起用', () => {
    const plain = build('一条尾巴');
    const two = build('两对腿 一条尾巴', { legLayout: 'row' });
    const three = build('三对腿 一条尾巴', { legLayout: 'row' });
    const four = build('四对腿', { legLayout: 'row' });
    for (const [b, pairs] of [[two, 2], [three, 3], [four, 4]] as const) {
      expect(b.ignored).toEqual([]);
      expectSkinned(b);
      const xs = legs(pairs).map((leg) => bone(b, `UpperLeg_${leg}`).head[0]);
      for (let i = 0; i + 1 < xs.length; i++) expect(xs[i] - xs[i + 1], `${pairs} 对腿 ${i}`).toBeCloseTo(xs[0] - xs[1], 2);
      expect(xs[0], String(pairs)).toBeCloseTo(-xs[xs.length - 1], 2);
      expect(b.bones.filter((x) => /^UpperLeg_[LR](\.\d+)?$/.test(x.name))).toHaveLength(pairs * 2);
      // 名字只带一个序号
      expect(b.bones.filter((x) => /\.\d+\.\d+/.test(x.name))).toEqual([]);
    }
    // 每多一对腿，多出来的骨骼一样多（只有腿上的）
    const count = (x: CharacterBuild) => x.bones.length;
    const perPair = count(two) - count(plain);
    const tailBones = count(plain) - count(build());
    expect(perPair).toBeGreaterThan(6);
    expect(count(three) - count(two)).toBe(perPair);
    expect(count(four) - (count(three) - tailBones)).toBe(perPair);
    // 只有一副胯：尾巴照常长在后腰正中
    const tail = (b: CharacterBuild) => bone(b, 'Tail_01_01').head;
    expect(parentName(two, 'Tail_01_01')).toBe('Hips');
    for (const b of [two, three]) {
      expect(tail(b)[0]).toBeCloseTo(0, 2);
      expect(tail(b)[2]).toBeCloseTo(tail(plain)[2], 2);
    }
    // 三对腿以上胯张得很宽：手臂抬高了，手不会搭在胯上
    expect(bone(two, 'Hand_L').head[1]).toBeCloseTo(bone(plain, 'Hand_L').head[1], 6);
    expect(bone(three, 'Hand_L').head[1]).toBeGreaterThan(bone(plain, 'Hand_L').head[1] + 0.03);
    expect(bone(four, 'Hand_L').head[1]).toBeGreaterThan(bone(three, 'Hand_L').head[1] + 0.03);
    const mixed = build('两对腿 两个头 三对手 猫耳', { legLayout: 'row', armLayout: 'stack' });
    expect(mixed.ignored).toEqual([]);
    expectSkinned(mixed);
    for (const name of ['Head.002', 'UpperArm_L.003', 'UpperLeg_L.002', 'UpperLeg_R.002']) expect(mixed.bones.map((x) => x.name)).toContain(name);
    // 一对腿时这个排法不起作用
    expect(build('', { legLayout: 'row' }).bones).toEqual(build().bones);
  });

  it('胯宽调了，并排的间隔跟着变；导出带骨骼的 GLB 写得出来', () => {
    const base = make('两对腿', { legLayout: 'row' });
    const wide = assembleCharacter(source(), { ...base, shape: { ...base.shape, hips: 1.3 } });
    const b = assembleCharacter(source(), base);
    expectSkinned(wide);
    const gap = (x: CharacterBuild) => bone(x, 'UpperLeg_L.002').head[0] - bone(x, 'UpperLeg_L').head[0];
    expect(gap(wide)).toBeGreaterThan(gap(b) * 1.1);
    const { json } = readGlb(characterGlb(b, { rig: true }));
    expect(json.skins[0].joints).toHaveLength(b.bones.length);
    const nodes = json.nodes.map((n: { name: string }) => n.name);
    for (const name of ['UpperLeg_L.002', 'Toes_R.002', 'SkirtFront1_L']) expect(nodes).toContain(name);
  });
});

describe('成品角色：一个头几张脸', () => {
  const faced = (heads: number, text = '') => build(text, { headLayout: 'faces', counts: { ...make(text).counts, heads } });
  /** 复制出来的第 k 张脸的皮肤，顶点的平均位置 */
  const center = (b: CharacterBuild, k: number) => {
    const sum = [0, 0, 0];
    let n = 0;
    for (const mesh of b.meshes) {
      if (!mesh.name.endsWith(`_Face_0${k}`) || !/Face_00_SKIN/.test(b.materials[mesh.material].name)) continue;
      for (let v = 0; v < mesh.positions.length; v++) sum[v % 3] += mesh.positions[v];
      n += mesh.positions.length / 3;
    }
    if (!n) throw new Error(`没有第 ${k} 张脸`);
    return sum.map((v) => v / n);
  };

  it('三张脸：只有一个头、一根脖子；多出来的两张是把她自己的脸复制一份，整片跟着头', () => {
    const one = build();
    const b = faced(3);
    expect(b.ignored).toEqual([]);
    expectSkinned(b);
    // 骨架和一个头的时候一模一样：没有多出来的脖子和头
    expect(b.bones).toEqual(one.bones);
    expect(b.metrics).toEqual(one.metrics);
    const copies = b.meshes.filter((m) => /_Face_0[23]$/.test(m.name));
    expect(copies.length).toBeGreaterThan(10);
    expect(b.meshes.some((m) => /_Face_04$/.test(m.name))).toBe(false);
    const head = b.bones.findIndex((x) => x.name === 'Head');
    for (const mesh of copies) {
      for (let v = 0; v < mesh.positions.length / 3; v++) {
        if (mesh.joints[v * 4] !== head || mesh.weights[v * 4] !== 1) throw new Error(`${mesh.name} 没有整片跟着头`);
      }
    }
    // 一张朝左、一张朝右，从头的两边露出来；高度和正面那张差不多
    const top = bone(b, 'Head').head;
    expect(center(b, 2)[0]).toBeGreaterThan(top[0] + 0.08);
    expect(center(b, 3)[0]).toBeLessThan(top[0] - 0.08);
    expect(center(b, 2)[0]).toBeCloseTo(-center(b, 3)[0], 2);
    expect(center(b, 2)[1]).toBeGreaterThan(top[1]);
    // 复制的只有头上的东西（脸、刘海）：没有脖子的皮肤，没有她自带的猫耳
    expect(copies.some((m) => m.name.startsWith('Body.baked_0_'))).toBe(false);
    const ears = new Set(source().earMaterials);
    expect(copies.some((m) => ears.has(m.material))).toBe(false);
    expect(copies.some((m) => /^Hair/.test(m.name))).toBe(true);
    // 切下来的脸是半个壳：皮肤换成两面都画的那一份，从后面看过去不是透的
    const skins = copies.filter((m) => /_SKIN/.test(b.materials[m.material].name));
    expect(skins.length).toBeGreaterThan(0);
    for (const mesh of skins) {
      expect(b.materials[mesh.material].doubleSided, mesh.name).toBe(true);
      expect(b.materials[mesh.material].name).toMatch(/_SKIN_Both$/);
      expect(b.materials[mesh.material].image).toBeGreaterThanOrEqual(0);
    }
    // 她自己的脸还是单面的那一份
    expect(b.materials[meshOf(b, 'Face.baked_7').material].doubleSided).toBe(false);
  });

  it('两张脸一前一后；四张脸是前、左、右、后；五张脸绕一圈', () => {
    const two = faced(2);
    const back = bone(two, 'Head').head[2];
    expect(center(two, 2)[2]).toBeLessThan(back - 0.08);
    expect(Math.abs(center(two, 2)[0])).toBeLessThan(0.01);
    const four = faced(4);
    expect(center(four, 2)[0]).toBeGreaterThan(0.08);
    expect(center(four, 3)[0]).toBeLessThan(-0.08);
    expect(center(four, 4)[2]).toBeLessThan(back - 0.08);
    const five = faced(5);
    expectSkinned(five);
    expect(five.meshes.filter((m) => /_Face_05$/.test(m.name)).length).toBeGreaterThan(5);
    expect(center(five, 4)[2]).toBeLessThan(center(five, 2)[2] - 0.05);
  });

  it('角和兽耳只长在这一个头上；只有一个头时这个选项不起作用', () => {
    const b = faced(3, '两只角 狐耳');
    const names = b.bones.map((x) => x.name);
    expect(names.filter((n) => /^Ear_01_L/.test(n))).toEqual(['Ear_01_L']);
    expect(b.meshes.filter((m) => /Horn/.test(m.name))).toHaveLength(2);
    expect(build('', { headLayout: 'faces' }).bones).toEqual(build().bones);
    expect(build('', { headLayout: 'faces' }).meshes.map((m) => m.name)).toEqual(build().meshes.map((m) => m.name));
  });

  it('阿修罗：三张脸、三对手臂从肩部散开', () => {
    const spec = make('阿修罗');
    expect(spec.headLayout).toBe('faces');
    const b = assembleCharacter(source(), spec);
    expect(b.bones.filter((x) => /^Head(\.\d+)?$/.test(x.name))).toHaveLength(1);
    expect(b.bones.filter((x) => /^UpperArm_L(\.\d+)?$/.test(x.name))).toHaveLength(3);
    expect(b.meshes.some((m) => /_Face_03$/.test(m.name))).toBe(true);
  });
});

describe('成品角色：换发型、染发', () => {
  const STYLES = ['long', 'sidetail', 'bob', 'twintails'] as const;
  type Style = (typeof STYLES)[number];
  const donors = new Map<Style, HairDonor>();
  const donor = (style: Style): HairDonor => {
    let made = donors.get(style);
    if (!made) {
      const file = readFileSync(new URL(`../public/${hairUrl(style)}`, import.meta.url));
      made = readHair(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
      donors.set(style, made);
    }
    return made;
  };
  const withHair = (text: string, hair: Partial<HairSpec>, rest: Partial<BodySpec> = {}): BodySpec => {
    const spec = make(text, rest);
    return { ...spec, hair: { ...spec.hair, ...hair } };
  };
  const styled = (style: Style, text = '', hair: Partial<HairSpec> = {}, rest: Partial<BodySpec> = {}) =>
    assembleCharacter(source(), withHair(text, { style, ...hair }, rest), donor(style));
  /** 换上去的头发（不算复制到别的头上的那几份） */
  const hairOf = (b: CharacterBuild) => b.meshes.filter((m) => /^Hair_\d+$/.test(m.name));
  /** 换上去的头发的材质从第几个开始：角色自己的，加七种单色材质 */
  const donorBase = () => source().materials.length + 7;
  const close = (a: ArrayLike<number>, b: ArrayLike<number>) => {
    for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k], 4);
  };

  it('头发文件：只有头发的网格、材质和贴图，骨骼都挂在头下面，带着原主人的头的尺寸', () => {
    for (const style of STYLES) {
      const d = donor(style);
      expect(d.meta.id).toBe(style);
      expect(d.meta.title.length).toBeGreaterThan(0);
      const tall = d.meta.head.top - d.meta.head.chin;
      expect(tall).toBeGreaterThan(0.2);
      expect(tall).toBeLessThan(0.3);
      // 头的关节在下巴和头顶之间
      expect(d.meta.head.joint[1]).toBeGreaterThan(d.meta.head.chin - 0.02);
      expect(d.meta.head.joint[1]).toBeLessThan(d.meta.head.top);
      expect(d.source.bones[0].name).toBe('J_Bip_C_Head');
      expect(d.source.bones[0].pos[1]).toBeCloseTo(d.meta.head.joint[1], 4);
      for (const x of d.source.bones.slice(1)) expect(x.name).toMatch(/^HairJoint-/);
      expect(d.source.chunks.length).toBeGreaterThan(0);
      for (const chunk of d.source.chunks) {
        expect(chunk.name).toMatch(/^Hair_\d+$/);
        const count = chunk.positions.length / 3;
        for (let v = 0; v < count; v++) {
          const sum = chunk.weights[v * 4] + chunk.weights[v * 4 + 1] + chunk.weights[v * 4 + 2] + chunk.weights[v * 4 + 3];
          if (Math.abs(sum - 1) > 1e-4) throw new Error(`${style} ${chunk.name} 第 ${v} 个顶点的权重加起来是 ${sum}`);
        }
      }
      for (const m of d.source.materials) expect(m.name).toMatch(/_HAIR_\d+(_EAR)?$/);
      expect(d.source.images.length).toBeLessThanOrEqual(d.source.materials.length);
      // 染发改哪种材质记在文件里；头发本身那一种一定在里面
      expect(d.source.dyeMaterials.map((i) => d.source.materials[i].name)).toContain(hairMaterial(d.source)!.name);
    }
    // 侧马尾前后两种头发都染，丝带不染；双马尾自带一副猫耳，颜色是画在贴图里的深色
    expect(donor('sidetail').source.dyeMaterials).toHaveLength(2);
    expect(donor('sidetail').source.materials).toHaveLength(3);
    // 猫耳另用两种名字带 _EAR 的材质：耳朵外面的毛（和头发一起染）、粉色的耳内（不染）
    const tails = donor('twintails').source;
    expect(tails.earMaterials.map((i) => tails.materials[i].name).sort()).toEqual(['F00_000_Hair_00_HAIR_01_EAR', 'F00_000_Hair_00_HAIR_02_EAR']);
    expect(tails.dyeMaterials.map((i) => tails.materials[i].name).sort()).toEqual(['F00_000_Hair_00_HAIR_01', 'F00_000_Hair_00_HAIR_01_EAR']);
    // 耳朵立在头顶上面，别的头发没有那么高
    const peak = (ear: boolean) =>
      Math.max(...tails.chunks.filter((chunk) => tails.earMaterials.includes(chunk.material) === ear).map((chunk) => extent(chunk, 1).high));
    expect(peak(true)).toBeGreaterThan(peak(false) + 0.01);
    expect(donor('long').source.earMaterials).toHaveLength(0);
    expect(STYLES.filter((style) => donor(style).meta.dark)).toEqual(['twintails']);
    // 原主人贴着头皮的那层底色：双马尾那位没有这一层
    expect(donor('long').meta.scalp).toHaveLength(3);
    expect(donor('twintails').meta.scalp).toBeNull();
  });

  it('不是头发文件的 GLB 会报错', () => {
    const file = readFileSync(new URL(`../public/${CHARACTER.url}`, import.meta.url));
    expect(() => readHair(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer)).toThrow('头发文件');
  });

  it('换上去：她原装的头发和猫耳不见了，新头发对在她头上，骨骼接在头下面', () => {
    const own = build();
    const hers = source().materials.length;
    for (const style of STYLES) {
      const b = styled(style);
      expectSkinned(b);
      expect(b.ignored, style).toEqual([]);
      // 她自己的头发（连同做在头发里的猫耳）一块都不剩；贴着头皮的那层底色画在身体上，还在
      expect(b.meshes.some((m) => m.material < hers && /_Hair_00_HAIR/.test(b.materials[m.material].name)), style).toBe(false);
      expect(b.meshes.some((m) => /HairBack/.test(b.materials[m.material].name))).toBe(true);
      const hair = hairOf(b);
      expect(hair).toHaveLength(donor(style).source.chunks.length);
      for (const mesh of hair) expect(mesh.material).toBeGreaterThanOrEqual(donorBase());
      // 对在头上：头发的最高处比头顶高一点，前后左右都在头的附近
      const head = bone(b, 'Head').head;
      const top = Math.max(...hair.map((m) => extent(m, 1).high));
      expect(top, style).toBeGreaterThan(own.metrics.height - 0.01);
      expect(top, style).toBeLessThan(own.metrics.height + 0.08);
      for (const mesh of hair) {
        expect(extent(mesh, 0).high, style).toBeLessThan(head[0] + 0.3);
        expect(extent(mesh, 0).low, style).toBeGreaterThan(head[0] - 0.3);
        expect(extent(mesh, 2).high, style).toBeLessThan(head[2] + 0.16);
      }
      // 身高、头身比量的是头，不算头发：和原装的时候一样
      expect(b.metrics).toEqual(own.metrics);
      // 骨骼：她自己的头发骨骼没有了，新头发的骨骼都接在 Head 下面，名字不重复
      const names = b.bones.map((x) => x.name);
      expect(new Set(names).size).toBe(names.length);
      expect(names.some((n) => n.includes('~'))).toBe(false);
      const strands = b.bones.filter((x) => /^Hair_\d+_\d+$/.test(x.name));
      expect(strands.length, style).toBeGreaterThan(5);
      for (const strand of strands) {
        let up = strand;
        while (up.parent >= 0 && up.name !== 'Head') up = b.bones[up.parent];
        expect(up.name, strand.name).toBe('Head');
      }
      // 材质和贴图：新头发带来的接在后面
      expect(b.materials).toHaveLength(donorBase() + donor(style).source.materials.length);
      expect(b.images).toHaveLength(source().images.length + donor(style).source.images.length);
      for (const m of b.materials.slice(donorBase())) expect(m.image).toBeGreaterThanOrEqual(source().images.length);
    }
  });

  it('头发还没取回来（或者给的不是选的那一副）：先照原装的拼', () => {
    const own = build();
    const spec = withHair('', { style: 'long' });
    expect(assembleCharacter(source(), spec).meshes.map((m) => m.name)).toEqual(own.meshes.map((m) => m.name));
    expect(assembleCharacter(source(), spec, donor('bob')).meshes.map((m) => m.name)).toEqual(own.meshes.map((m) => m.name));
    // 选的是原装，手里有别的头发也不换
    expect(assembleCharacter(source(), make(), donor('bob')).bones).toEqual(own.bones);
  });

  it('多个头、几张脸：复制出来的头带着新头发；别的拼法照常', () => {
    const one = styled('long');
    const two = styled('long', '两个头');
    expectSkinned(two);
    const all = (b: CharacterBuild) => b.meshes.filter((m) => /^Hair_\d+/.test(m.name)).length;
    expect(all(two)).toBe(2 * all(one));
    expect(two.meshes.some((m) => /^Hair_\d+_Head_02$/.test(m.name))).toBe(true);
    expect(two.bones.map((x) => x.name)).toEqual(expect.arrayContaining(['Hair_01_01', 'Hair_01_01.002']));
    const faces = styled('bob', '', {}, { headLayout: 'faces', counts: { ...make().counts, heads: 3 } });
    expectSkinned(faces);
    expect(faces.meshes.some((m) => /^Hair_\d+_Face_02$/.test(m.name))).toBe(true);
    expect(faces.bones.filter((x) => /^Head(\.\d+)?$/.test(x.name))).toHaveLength(1);
    for (const text of ['半人马 一条尾巴', 'humantaur', '三对手 两只角', '两个头 T-pose']) expectSkinned(styled('twintails', text));
  });

  it('自带兽耳的发型（双马尾）：加了工坊的兽耳就去掉自带的那副', () => {
    const builtIn = new Set(donor('twintails').source.earMaterials.map((i) => donorBase() + i));
    const ears = (b: CharacterBuild) => b.meshes.filter((m) => builtIn.has(m.material)).length;
    expect(ears(styled('twintails'))).toBeGreaterThan(0);
    expect(ears(styled('twintails', '两个头'))).toBe(2 * ears(styled('twintails')));
    const fox = styled('twintails', '狐耳');
    expect(ears(fox)).toBe(0);
    expect(fox.meshes.some((m) => /_EAR$/.test(fox.materials[m.material].name))).toBe(false);
    expect(fox.bones.map((x) => x.name)).toContain('Ear_01_L');
    // 自带的那副立在头顶上面：去掉以后头发矮了一截
    const tall = (b: CharacterBuild) => Math.max(...hairOf(b).map((m) => extent(m, 1).high));
    expect(tall(fox)).toBeLessThan(tall(styled('twintails')) - 0.01);
  });

  it('染发：改头发那几种材质的底色，头皮那层跟着走；挑染、发夹、丝带不动；尾巴跟着发色', () => {
    const red = '#c2413b';
    const want = colorToLinear(red);
    const named = (b: CharacterBuild, name: string, from = 0) => {
      const found = b.materials.find((m, i) => i >= from && m.name === name);
      if (!found) throw new Error(`没有材质 ${name}`);
      return found;
    };
    // 不染：材质原样（就是读进来的那几个对象）
    const plain = build('一条尾巴');
    source().materials.forEach((m, i) => expect(plain.materials[i]).toBe(m));
    // 原装的头发：第一种材质染了，第二种（蓝色的挑染）和猫耳没动
    const own = assembleCharacter(source(), withHair('一条尾巴', { color: red }));
    close(named(own, 'F00_000_Hair_00_HAIR_01').color, want);
    expect(named(own, 'F00_000_Hair_00_HAIR_01').color[3]).toBe(1);
    expect(named(own, 'F00_000_Hair_00_HAIR_02')).toBe(named(plain, 'F00_000_Hair_00_HAIR_02'));
    expect(named(own, 'F00_000_Hair_00_HAIR_03')).toBe(named(plain, 'F00_000_Hair_00_HAIR_03'));
    close(named(own, 'F00_000_HairBack_00_HAIR').color, want);
    close(named(own, 'OC_Tail').color, want);
    // 别的材质一个没动
    own.materials.forEach((m, i) => {
      if (i < source().materials.length && !/HAIR_01$|HairBack/.test(m.name)) expect(m, m.name).toBe(source().materials[i]);
    });
    // 量出了贴图的平均颜色：底色 = 要的颜色 ÷ 贴图的平均颜色，不超过 1
    const main = hairMaterial(source())!.color;
    const measured = assembleCharacter({ ...source(), hairColor: [0.4 * main[0], 0.5 * main[1], 0.6 * main[2]] }, withHair('', { color: '#808080' }));
    const grey = colorToLinear('#808080');
    close(named(measured, 'F00_000_Hair_00_HAIR_01').color, [grey[0] / 0.4, grey[1] / 0.5, grey[2] / 0.6]);
    const bright = assembleCharacter({ ...source(), hairColor: [0.4 * main[0], 0.5 * main[1], 0.6 * main[2]] }, withHair('', { color: '#ffffff' }));
    close(named(bright, 'F00_000_Hair_00_HAIR_01').color, [1, 1, 1]);

    // 换上去的头发：染的是它自己的那几种材质；头皮那层不染时照原主人的颜色，染了就是染的颜色
    const long = styled('long');
    close(named(long, 'F00_000_HairBack_00_HAIR').color, donor('long').meta.scalp!);
    const dyedLong = styled('long', '一条尾巴', { color: red });
    close(named(dyedLong, 'F00_000_Hair_00_HAIR_01', donorBase()).color, want);
    close(named(dyedLong, 'F00_000_HairBack_00_HAIR').color, want);
    close(named(dyedLong, 'OC_Tail').color, want);
    // 发夹的那种材质没动，贴图还是它自己的
    expect(named(dyedLong, 'F00_000_Hair_00_HAIR_02', donorBase()).color).toEqual(named(long, 'F00_000_Hair_00_HAIR_02', donorBase()).color);
    expect(named(dyedLong, 'F00_000_Hair_00_HAIR_01', donorBase()).image).toBe(named(long, 'F00_000_Hair_00_HAIR_01', donorBase()).image);
    // 尾巴不染时跟着这副头发本来的颜色（这里没解贴图，用的是材质的底色）
    close(named(styled('long', '一条尾巴'), 'OC_Tail').color, donor('long').source.materials[0].color);
    // 颜色画在贴图里的深色头发（双马尾）：染的时候换用她自己那张浅色的头发贴图，不染就还是原来的
    const tails = styled('twintails');
    const dyedTails = styled('twintails', '', { color: red });
    expect(named(tails, 'F00_000_Hair_00_HAIR_01', donorBase()).image).toBeGreaterThanOrEqual(source().images.length);
    expect(named(dyedTails, 'F00_000_Hair_00_HAIR_01', donorBase()).image).toBe(hairMaterial(source())!.image);
    // 它自带的猫耳：外面的毛跟着染，粉色的耳内不动
    close(named(dyedTails, 'F00_000_Hair_00_HAIR_01_EAR', donorBase()).color, want);
    expect(named(dyedTails, 'F00_000_Hair_00_HAIR_02_EAR', donorBase())).toBe(named(tails, 'F00_000_Hair_00_HAIR_02_EAR', donorBase()));
    // 同样的设定拼两次：材质和贴图的清单是同一批对象，显示那边不用重建
    const again = styled('long', '一条尾巴', { color: red });
    again.materials.forEach((m, i) => expect(m, m.name).toBe(dyedLong.materials[i]));
    expect(again.images).toBe(dyedLong.images);
  });

  it('几个头分开染：复制出来的头染的颜色不一样，头发、头皮、兽耳各换用自己那一份材质', () => {
    const red = '#c2413b';
    const blue = '#2a5f9e';
    const color = (b: CharacterBuild, mesh: string) => {
      const found = b.meshes.find((m) => m.name === mesh);
      if (!found) throw new Error(`没有网格 ${mesh}`);
      return b.materials[found.material];
    };
    const plain = styled('long', '三个头，猫耳');
    const allRed = styled('long', '三个头，猫耳', { color: red });
    // 第 2 个头染蓝，第 3 个不染，角色自己的头跟着上面的红色
    const b = styled('long', '三个头，猫耳', { color: red, heads: ['', blue, 'none'] });
    expectSkinned(b);
    const hair = hairOf(b).map((m) => m.name);
    expect(hair.length).toBeGreaterThan(0);
    let dyedPieces = 0;
    for (const name of hair) {
      // 复制到第 2、3 个头上的那几块
      const second = color(b, `${name}_Head_02`);
      if (color(allRed, name) !== color(plain, name)) {
        dyedPieces++;
        close(color(b, name).color, colorToLinear(red));
        close(second.color, colorToLinear(blue));
        expect(second.name).toMatch(/_Head_02$/);
        expect(color(b, `${name}_Head_03`).color).toEqual(color(plain, `${name}_Head_03`).color);
      } else {
        // 不染的那几种（发夹之类）三个头一样
        expect(second.color).toEqual(color(plain, name).color);
      }
    }
    expect(dyedPieces).toBeGreaterThan(0);
    // 兽耳跟着它长在的那个头
    close(color(b, 'Head_01_Ear_01_L').color, colorToLinear(red));
    close(color(b, 'Head_02_Ear_01_L').color, colorToLinear(blue));
    expect(color(b, 'Head_03_Ear_01_L').color).toEqual(color(plain, 'Head_03_Ear_01_L').color);
    // 三个头都和第 1 个一样：不多出材质；一个头几张脸只有一副头发，分开染的不算
    expect(styled('long', '三个头，猫耳', { color: red, heads: ['', red, ''] }).materials).toHaveLength(allRed.materials.length);
    const faces = styled('long', '三面，猫耳', { color: red, heads: ['', blue, 'none'] }, { headLayout: 'faces' });
    expect(faces.materials).toHaveLength(styled('long', '三面，猫耳', { color: red }, { headLayout: 'faces' }).materials.length);
    // 用自己原装头发的也一样：头皮那层是画在身体网格上的，第 2 个头的头皮跟着它的颜色
    const own = assembleCharacter(source(), withHair('两个头', { color: red, heads: ['', blue] }));
    const scalp = own.meshes.filter((m) => /HairBack/.test(own.materials[m.material].name));
    expect(scalp.some((m) => /_Head_02$/.test(m.name) && Math.abs(own.materials[m.material].color[0] - colorToLinear(blue)[0]) < 1e-3)).toBe(true);
  });

  it('长度、蓬松：只动头发；垂着的那一段拉长，整副头发放大；自带的兽耳不跟着变', () => {
    const lowest = (b: CharacterBuild) => Math.min(...hairOf(b).map((m) => extent(m, 1).low));
    const highest = (b: CharacterBuild) => Math.max(...hairOf(b).map((m) => extent(m, 1).high));
    const widest = (b: CharacterBuild) => Math.max(...hairOf(b).map((m) => extent(m, 0).high));
    const base = styled('long');
    const longer = styled('long', '', { length: 1.5 });
    const shorter = styled('long', '', { length: 0.6 });
    expectSkinned(longer);
    expect(lowest(longer)).toBeLessThan(lowest(base) - 0.1);
    expect(lowest(shorter)).toBeGreaterThan(lowest(base) + 0.1);
    expect(highest(longer)).toBeCloseTo(highest(base), 5);
    const puffy = styled('long', '', { volume: 1.15 });
    expect(widest(puffy)).toBeGreaterThan(widest(base) + 0.005);
    expect(highest(puffy)).toBeGreaterThan(highest(base) + 0.005);
    // 身体没动，身高也没变
    for (const b of [longer, puffy]) {
      expect([...meshOf(b, 'Body.baked_0').positions]).toEqual([...meshOf(base, 'Body.baked_0').positions]);
      expect(b.metrics).toEqual(base.metrics);
    }
    // 头发的骨骼跟着走：最低的那个关节更低了
    const tip = (b: CharacterBuild) => Math.min(...b.bones.filter((x) => /^Hair_\d+_\d+$/.test(x.name)).map((x) => x.head[1]));
    expect(tip(longer)).toBeLessThan(tip(base) - 0.05);
    // 原装的头发也能调；做在头发里的那副猫耳不变
    const own = build();
    const ownPuffy = assembleCharacter(source(), withHair('', { volume: 1.15 }));
    const ears = new Set(source().earMaterials);
    let moved = 0;
    own.meshes.forEach((mesh, i) => {
      const same = mesh.positions.every((v, k) => v === ownPuffy.meshes[i].positions[k]);
      if (/^Hair/.test(mesh.name) && !ears.has(mesh.material)) moved += same ? 0 : 1;
      else expect(same, mesh.name).toBe(true);
    });
    expect(moved).toBeGreaterThan(10);
    // 双马尾自带的猫耳也不变
    const builtIn = new Set(donor('twintails').source.earMaterials.map((i) => donorBase() + i));
    const a = styled('twintails');
    const b = styled('twintails', '', { volume: 1.15, length: 1.4 });
    a.meshes.forEach((mesh, i) => {
      if (builtIn.has(mesh.material)) expect([...b.meshes[i].positions]).toEqual([...mesh.positions]);
    });
  });

  it('导出：带骨骼的 GLB 里新头发的材质、贴图和骨骼都在；用不到的贴图不存', () => {
    const b = styled('sidetail', '两个头', { color: '#8e6ccf' });
    const { json } = readGlb(characterGlb(b, { rig: true }));
    expect(json.skins[0].joints.map((n: number) => json.nodes[n].name)).toEqual(b.bones.map((x) => x.name));
    const used = new Set(b.meshes.map((m) => b.materials[m.material].image).filter((i) => i >= 0));
    expect(json.images).toHaveLength(used.size);
    // 她原装头发的那几张贴图没人用了
    expect(json.images.length).toBeLessThan(b.images.length);
    expect(json.materials.filter((m: { name: string }) => /_HAIR_0\d$/.test(m.name))).toHaveLength(3);
  });
});

describe('成品角色的手动微调', () => {
  const spec = make('两个头，两对手臂，两对胸，一条尾巴，一对翅膀，每个头一只角，每个头一对兽耳');
  const base = assembleCharacter(source(), spec);
  /** 顶点的位置：哪块网格（名字以 prefix 开头）的第几个点 */
  const point = (b: CharacterBuild, mesh: number, v: number) => [0, 1, 2].map((k) => b.meshes[mesh].positions[v * 3 + k]);
  const bodyMesh = base.meshes.findIndex((m) => m.name.startsWith('Body') && !/_(Arm|Head|Chest)_/.test(m.name));

  it('部件和白模人台同名：躯干、脖子、头、手臂、腿、尾巴、翅膀、兽耳、胸；角、复制出来的胸照网格认', () => {
    const names = characterParts(base).map((p) => p.name);
    for (const name of [
      'Torso',
      'Neck_01',
      'Head_01',
      'Head_02',
      'Arm_01_L',
      'Arm_02_R',
      'Leg_01_L',
      'Leg_01_R',
      'Tail_01',
      'Wing_01_L',
      'Head_01_Ear_01_L',
      'Head_02_Horn_C',
      'Chest_01_L',
      'Chest_02_R',
    ]) {
      expect(names, name).toContain(name);
    }
    expect(characterParts(base).find((p) => p.name === 'Head_02_Horn_C')).toMatchObject({ type: 'horn', parent: 'Head_02', bones: [] });
  });

  it('什么都没调：和拼好的一模一样', () => {
    const plain = tweakCharacter(base, {});
    expect(plain.build.bones).toEqual(base.bones);
    for (let m = 0; m < base.meshes.length; m++) expect(plain.build.meshes[m].positions).toEqual(base.meshes[m].positions);
  });

  it('转手臂：手跟着绕肩关节转，离得远的头不动，肩膀那一圈渐渐过渡；原来那份不动', () => {
    const before = base.meshes.map((m) => m.positions.slice());
    const { build, frames } = tweakCharacter(base, { Arm_01_L: { rotation: [0, 0, 40] } });
    const shoulder = bone(base, 'UpperArm_L').head;
    const hand = bone(base, 'Hand_L').head;
    const moved = bone(build, 'Hand_L').head;
    // 绕关节转：到关节的距离不变，手往上抬（绕 +Z 转 40°，左手往上）
    expect(Math.hypot(...moved.map((v, k) => v - shoulder[k]))).toBeCloseTo(Math.hypot(...hand.map((v, k) => v - shoulder[k])), 6);
    expect(moved[1]).toBeGreaterThan(hand[1] + 0.1);
    expect(bone(build, 'Head').head).toEqual(bone(base, 'Head').head);
    expect(frames.get('Arm_01_L')!.pivot).toEqual(shoulder);
    // 身上的点：跟着手臂的整个转，不跟的不动，介于中间的挪了一部分
    const mesh = build.meshes[bodyMesh];
    let full = 0;
    let none = 0;
    let part = 0;
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const d = Math.hypot(...point(build, bodyMesh, v).map((x, k) => x - point(base, bodyMesh, v)[k]));
      if (d < 1e-9) none++;
      else if (point(base, bodyMesh, v)[0] > hand[0] - 0.05) full++;
      else part++;
    }
    expect(full).toBeGreaterThan(20);
    expect(none).toBeGreaterThan(1000);
    expect(part).toBeGreaterThan(10);
    base.meshes.forEach((m, i) => expect(m.positions).toEqual(before[i]));
  });

  it('复制出来的手臂整条拿下来：它的每个点都挪了一样远', () => {
    const shift = [0.2, -0.1, 0.05];
    const { build } = tweakCharacter(base, { Arm_02_L: { position: shift as [number, number, number] } });
    const copies = base.meshes.map((m, i) => [m, i] as const).filter(([m]) => m.name.endsWith('_Arm_02_L'));
    expect(copies.length).toBeGreaterThan(0);
    for (const [m, i] of copies) {
      for (let v = 0; v < m.positions.length / 3; v++) {
        const d = point(build, i, v).map((x, k) => x - point(base, i, v)[k]);
        for (let k = 0; k < 3; k++) expect(d[k], `${m.name} ${v}`).toBeCloseTo(shift[k], 5);
      }
    }
    expect(bone(build, 'Hand_L.002').head[0]).toBeCloseTo(bone(base, 'Hand_L.002').head[0] + 0.2, 6);
  });

  it('父部件带着子部件：躯干转了，手臂跟着转，手臂再照躯干转过以后的轴挪', () => {
    const { build, frames } = tweakCharacter(base, { Torso: { rotation: [0, 90, 0] }, Arm_01_L: { position: [0.1, 0, 0] } });
    // 躯干绕 Y 转了 90°：手臂的 X 方向（她的左手边）转到了 -Z
    expect(frames.get('Arm_01_L')!.parentQuat.map((v) => +v.toFixed(6))).toEqual(quatEuler(0, Math.PI / 2, 0).map((v) => +v.toFixed(6)));
    const onlyTorso = tweakCharacter(base, { Torso: { rotation: [0, 90, 0] } }).build;
    const d = bone(build, 'Hand_L').head.map((v, k) => v - bone(onlyTorso, 'Hand_L').head[k]);
    expect(d[0]).toBeCloseTo(0, 6);
    expect(d[2]).toBeCloseTo(-0.1, 6);
    // 腿不跟着躯干
    expect(bone(build, 'Foot_L').head).toEqual(bone(base, 'Foot_L').head);
  });

  it('转头：那张脸的表情、视线跟着转；放大角：整块角以它贴着头的根为中心变大', () => {
    const { build } = tweakCharacter(base, { Head_01: { rotation: [0, 30, 0] }, Head_02_Horn_C: { scale: [2, 2, 2] } });
    const face = build.faces.find((f) => f.bone === 'Head')!;
    const was = base.faces.find((f) => f.bone === 'Head')!;
    expect(face.quat).not.toEqual(was.quat);
    expect(build.faces.find((f) => f.bone === 'Head.002')!.quat).toEqual(base.faces.find((f) => f.bone === 'Head.002')!.quat);
    const horn = base.meshes.findIndex((m) => m.name === 'Head_02_Horn_C');
    const extent = (b: CharacterBuild) => {
      const ys = Array.from({ length: b.meshes[horn].positions.length / 3 }, (_, v) => b.meshes[horn].positions[v * 3 + 1]);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(extent(build)).toBeCloseTo(extent(base) * 2, 3);
  });

  it('点选：点在哪个部件上就是哪个；高亮的面跟着那个部件', () => {
    const tweaked = tweakCharacter(base, {});
    expect(characterPartAt(tweaked, bone(base, 'Hand_L').head)).toBe('Arm_01_L');
    expect(characterPartAt(tweaked, bone(base, 'LowerLeg_R').head)).toBe('Leg_01_R');
    const horn = base.meshes.find((m) => m.name === 'Head_02_Horn_C')!;
    expect(characterPartAt(tweaked, [horn.positions[0], horn.positions[1], horn.positions[2]])).toBe('Head_02_Horn_C');
    const glow = characterPartGlow(tweaked, 'Tail_01');
    expect(glow.length % 9).toBe(0);
    expect(glow.length).toBeGreaterThan(90);
  });

  it('兽身换了部件数重新拼过：骨骼下标串一样的另一条腿，高亮的还是它自己的面', () => {
    // 兽身那块的权重每次拼都是同一份，骨骼下标却重新编号：加了兽耳、翅膀以后，前一副的 Leg_02_L 和这一副的 Leg_01_L 下标串一样
    const spider = make('蜘蛛女');
    const before = assembleCharacter(source(), spider);
    const after = assembleCharacter(source(), { ...spider, counts: { ...spider.counts, earPairsPerHead: 2, wingPairs: 1 } });
    const legs = (b: CharacterBuild) => characterParts(b).filter((p) => p.type === 'leg');
    const pair = legs(after)
      .map((p) => [legs(before).find((q) => q.bones.join() === p.bones.join() && q.name !== p.name), p] as const)
      .find(([q]) => q);
    expect(pair, '前后两副里得有骨骼下标串一样、名字不一样的腿').toBeDefined();
    const [was, now] = [pair![0]!, pair![1]];
    /** 照权重现数：跟着这条腿的权重加起来过半的面有几个 */
    const faces = (b: CharacterBuild, bones: number[]) => {
      let n = 0;
      for (const m of b.meshes) {
        const w = (v: number) => {
          let s = 0;
          for (let k = 0; k < 4; k++) if (bones.includes(m.joints[v * 4 + k])) s += m.weights[v * 4 + k];
          return Math.min(1, s);
        };
        for (let t = 0; t < m.indices.length; t += 3) if (w(m.indices[t]) + w(m.indices[t + 1]) + w(m.indices[t + 2]) >= 1.5) n++;
      }
      return n;
    };
    characterPartGlow(tweakCharacter(before, {}), was.name);
    const glow = characterPartGlow(tweakCharacter(after, {}), now.name);
    expect(glow.length / 9).toBe(faces(after, now.bones));
    expect(faces(after, now.bones)).not.toBe(faces(before, was.bones));
  });

  it('腿改长了：整个人跟着升高，脚还踩在地上', () => {
    const { build } = tweakCharacter(base, { Leg_01_L: { scale: [1, 1.3, 1] }, Leg_01_R: { scale: [1, 1.3, 1] } });
    expect(bone(build, 'Hips').head[1]).toBeGreaterThan(bone(base, 'Hips').head[1] + 0.1);
    expect(build.metrics.height).toBeGreaterThan(base.metrics.height + 0.1);
    const low = (b: CharacterBuild) => Math.min(...b.meshes.flatMap((m) => Array.from({ length: m.positions.length / 3 }, (_, v) => m.positions[v * 3 + 1])));
    expect(low(build)).toBeCloseTo(low(base), 3);
  });

  it('挪腿时胯跟着挪：并排时外侧一对往里收，胯跟着收窄；腰以上、别的腿不动', () => {
    const row = build('六条腿 腿左右并排');
    const shift = 0.1;
    const { build: moved } = tweakCharacter(row, { Leg_03_L: { position: [-shift, 0, 0] }, Leg_03_R: { position: [shift, 0, 0] } });
    const hipY = bone(row, 'UpperLeg_L').head[1];
    const spineY = bone(row, 'Spine').head[1];
    const legs = new Set(row.bones.flatMap((b, i) => (/^(UpperLeg|LowerLeg|Foot|Toe)/.test(b.name) ? [i] : [])));
    /** 高度在 [low, high] 里、不跟着腿的点，离中线最远多远 */
    const reach = (b: CharacterBuild, low: number, high: number) => {
      let far = 0;
      b.meshes.forEach((m) => {
        for (let v = 0; v < m.positions.length / 3; v++) {
          const y = m.positions[v * 3 + 1];
          if (y < low || y > high) continue;
          let w = 0;
          for (let k = 0; k < 4; k++) if (legs.has(m.joints[v * 4 + k])) w += m.weights[v * 4 + k];
          if (w < 0.5) far = Math.max(far, Math.abs(m.positions[v * 3]));
        }
      });
      return far;
    };
    // 胯那一圈最外沿跟着腿收进去差不多那么多
    expect(reach(row, hipY - 0.03, hipY + 0.03) - reach(moved, hipY - 0.03, hipY + 0.03)).toBeGreaterThan(shift * 0.8);
    // 腰以上不动
    expect(reach(moved, spineY + 0.02, spineY + 0.2)).toBeCloseTo(reach(row, spineY + 0.02, spineY + 0.2), 6);
    // 别的腿不动
    expect(bone(moved, 'Foot_L.002').head).toEqual(bone(row, 'Foot_L.002').head);
  });

  it('成品角色的微调单独记一份，不和白模人台的混在一起', () => {
    const tweakedSpec = setOverride(spec, 'Arm_01_L', { rotation: [0, 0, 20] });
    expect(tweakedSpec.characterOverrides).toEqual({ Arm_01_L: { rotation: [0, 0, 20] } });
    expect(tweakedSpec.overrides).toEqual({});
    expect(activeOverrides(tweakedSpec)).toBe(tweakedSpec.characterOverrides);
    const mannequin = setOverride({ ...spec, bodyStyle: 'mannequin' }, 'Arm_01_L', { rotation: [0, 0, 20] });
    expect(mannequin.overrides).toEqual({ Arm_01_L: { rotation: [0, 0, 20] } });
    expect(mannequin.characterOverrides).toEqual({});
  });
});

describe('成品角色的导出', () => {
  it('GLB：一个物体、每个材质一批面，贴图原样存进去', () => {
    const b = build('两对手');
    const doc = readGlb(characterGlb(b, { rig: false }));
    const { json } = doc;
    expect(json.meshes).toHaveLength(1);
    expect(json.meshes[0].name).toBe('OC_Character');
    const used = new Set(b.meshes.map((m) => m.material));
    expect(json.meshes[0].primitives).toHaveLength(used.size);
    expect(json.skins).toBeUndefined();
    expect(json.extensionsUsed).toEqual(['KHR_materials_unlit']);
    expect(json.images).toHaveLength(b.images.length);
    expect(json.textures).toHaveLength(b.images.length);
    for (const material of json.materials) {
      expect(material.extensions).toHaveProperty('KHR_materials_unlit');
      expect(material.pbrMetallicRoughness.baseColorTexture.index).toBeLessThan(json.textures.length);
    }
    // 半透明、镂空的材质照样标着
    expect(json.materials.some((m: { alphaMode?: string }) => m.alphaMode === 'BLEND')).toBe(true);
    expect(json.materials.some((m: { alphaMode?: string }) => m.alphaMode === 'MASK')).toBe(true);
    // 每批面：顶点、贴图坐标一样多，下标不越界
    let triangles = 0;
    for (const prim of json.meshes[0].primitives) {
      const count = json.accessors[prim.attributes.POSITION].count;
      expect(json.accessors[prim.attributes.TEXCOORD_0].count).toBe(count);
      expect(json.accessors[prim.attributes.NORMAL].count).toBe(count);
      const indices = readAccessor(doc, prim.indices);
      expect(Math.max(...indices)).toBeLessThan(count);
      triangles += indices.length / 3;
    }
    expect(triangles).toBe(b.meshes.reduce((sum, m) => sum + m.indices.length / 3, 0));
    // 存进去的图片就是原来的字节
    const first = json.bufferViews[json.images[0].bufferView];
    expect(first.byteLength).toBe(b.images.find((_, i) => i === b.materials[mergeByMaterial(b)[0].material].image)!.bytes.byteLength);
  });

  it('带骨骼的 GLB：骨架、权重都在，再读回来对得上', () => {
    const b = build('两个头 一条尾巴');
    const doc = readGlb(characterGlb(b, { rig: true }));
    const { json } = doc;
    expect(json.skins).toHaveLength(1);
    expect(json.skins[0].joints).toHaveLength(b.bones.length);
    expect(json.skins[0].joints.map((n: number) => json.nodes[n].name)).toEqual(b.bones.map((x) => x.name));
    for (const prim of json.meshes[0].primitives) {
      const count = json.accessors[prim.attributes.POSITION].count;
      const joints = readAccessor(doc, prim.attributes.JOINTS_0);
      const weights = readAccessor(doc, prim.attributes.WEIGHTS_0);
      expect(joints.length).toBe(count * 4);
      expect(Math.max(...joints)).toBeLessThan(b.bones.length);
      for (let v = 0; v < count; v += 97) expect(weights[v * 4] + weights[v * 4 + 1] + weights[v * 4 + 2] + weights[v * 4 + 3]).toBeCloseTo(1, 4);
    }
    // 后加的单色部件受光照，不标「不受光照」
    const tail = json.materials.find((m: { name: string }) => m.name === 'OC_Tail');
    expect(tail.extensions).toBeUndefined();
    expect(tail.pbrMetallicRoughness.baseColorTexture).toBeUndefined();
    expect(characterSkeleton(b).bones).toHaveLength(b.bones.length);
  });

  it('只要形状（OBJ、STL 用）：所有网格并成一块', () => {
    const b = build('两对手');
    const shape = characterShape(b);
    expect(shape.positions.length).toBe(b.meshes.reduce((sum, m) => sum + m.positions.length, 0));
    expect(shape.triangles.length).toBe(b.meshes.reduce((sum, m) => sum + m.indices.length, 0));
    expect(Math.max(...shape.triangles)).toBe(shape.positions.length / 3 - 1);
  });
});

describe('GLB 写出器：贴图和分批的面', () => {
  const triangle = (name: string, extra: object = {}) => ({
    name,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    ...extra,
  });

  it('object 相同的网格写成同一个物体的几批面', () => {
    const { json } = readGlb(
      writeGlb([triangle('A', { object: 'Thing' }), triangle('B', { object: 'Thing' }), triangle('C')]),
    );
    expect(json.meshes.map((m: { name: string; primitives: unknown[] }) => [m.name, m.primitives.length])).toEqual([
      ['Thing', 2],
      ['C', 1],
    ]);
    expect(json.scenes[0].nodes).toHaveLength(2);
  });

  it('贴图：只存用到的图片，材质指向它；贴图坐标写成 TEXCOORD_0', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const other = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9]);
    const doc = readGlb(
      writeGlb(
        [
          triangle('A', {
            uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
            material: { name: 'Skin', color: 0xffffff, image: 1, alphaMode: 'MASK', alphaCutoff: 0.4, unlit: true },
          }),
        ],
        { images: [{ mime: 'image/png', bytes: other }, { name: 'Skin', mime: 'image/png', bytes: png }] },
      ),
    );
    const { json } = doc;
    expect(json.images).toEqual([{ name: 'Skin', mimeType: 'image/png', bufferView: json.images[0].bufferView }]);
    expect(json.bufferViews[json.images[0].bufferView].byteLength).toBe(png.byteLength);
    expect(json.materials[0]).toMatchObject({ alphaMode: 'MASK', alphaCutoff: 0.4, extensions: { KHR_materials_unlit: {} } });
    expect(json.materials[0].pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 });
    expect(json.accessors[json.meshes[0].primitives[0].attributes.TEXCOORD_0]).toMatchObject({ type: 'VEC2', count: 3 });
    expect(json.extensionsUsed).toEqual(['KHR_materials_unlit']);
  });

  it('材质要的贴图没给、贴图坐标数目不对，都会报错', () => {
    expect(() => writeGlb([triangle('A', { material: { name: 'M', color: 0, image: 0 } })])).toThrow();
    expect(() => writeGlb([triangle('A', { uvs: new Float32Array(4) })])).toThrow();
  });
});

describe('成品角色：好几个上半身', () => {
  it('两个：腰以上复制一份，两份从腰那里往两边弯开；脊柱带边、头从右往左数、外侧手臂照原名，骨骼不重名', () => {
    const one = build();
    const b = build('两个上半身');
    expectSkinned(b);
    expect(b.ignored).toEqual([]);
    const names = b.bones.map((x) => x.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain('Spine');
    for (const side of ['L', 'R']) {
      expect(bone(b, `Spine_${side}`).parent).toBe(names.indexOf('Hips'));
      expect(names).toContain(`UpperChest_${side}`);
    }
    // 往自己那一边弯：左边那个的头在 +X，右边的在 -X
    const heads = names.filter((n) => /^Head(\.\d+)?$/.test(n));
    expect(heads.sort()).toEqual(['Head', 'Head.002']);
    expect(bone(b, 'Head').head[0]).toBeLessThan(-0.1);
    expect(bone(b, 'Head.002').head[0]).toBeGreaterThan(0.1);
    // 外侧的手臂照原名（左右互为镜像），里侧的是第 2 对，往前伸
    // 她自己的模型左右差一点点（不到一毫米）
    expect(bone(b, 'UpperArm_L').head[0]).toBeCloseTo(-bone(b, 'UpperArm_R').head[0], 2);
    for (const inner of ['UpperArm_L.002', 'UpperArm_R.002']) {
      const up = bone(b, inner);
      const low = bone(b, inner.replace('Upper', 'Lower'));
      expect(low.head[2] - up.head[2], inner).toBeGreaterThan(Math.abs(low.head[0] - up.head[0]));
    }
    // 两张脸，各跟着自己的头
    expect(b.faces.map((f) => f.key).sort()).toEqual(['Head', 'Head.002']);
    // 身高量的是歪过去以后的头顶：矮一点
    expect(b.metrics.height).toBeLessThan(one.metrics.height);
    expect(b.metrics.height).toBeGreaterThan(one.metrics.height * 0.9);
    // 腿没有复制
    expect(names.filter((n) => /^UpperLeg_[LR]$/.test(n))).toEqual(['UpperLeg_L', 'UpperLeg_R']);
    expect(names.filter((n) => /^UpperLeg/.test(n))).toEqual(one.bones.map((x) => x.name).filter((n) => /^UpperLeg/.test(n)));
  });

  it('三个：正中一个不带边，两边各一个；三张脸', () => {
    const b = build('三个上半身');
    expectSkinned(b);
    const names = b.bones.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['Spine', 'Spine_L', 'Spine_R']));
    expect(b.faces).toHaveLength(3);
    expect(new Set(names).size).toBe(names.length);
  });

  it('每个上半身照设定各长一份头、手臂；里侧的翅膀不要；分开染的颜色照全身第几个头', () => {
    const b = build('两个上半身，两个头，两对手臂，一对翅膀');
    const names = b.bones.map((x) => x.name);
    expect(names.filter((n) => /^Head(\.\d+)?$/.test(n))).toHaveLength(4);
    expect(names.filter((n) => /^UpperArm_/.test(n))).toHaveLength(8);
    expect(names.filter((n) => /^Wing_/.test(n)).sort()).toEqual(['Wing_01_L', 'Wing_01_R']);
    // 第 1 个头（右边那个上半身上）染红，第 3 个（左边那个上半身上）染蓝
    const red = '#c2413b';
    const blue = '#2a5f9e';
    const dyed = assembleCharacter(source(), { ...make('两个上半身'), hair: { ...defaultSpec().hair, color: red, heads: ['', blue] } });
    const hair = dyed.meshes.filter((m) => /HAIR_01/.test(dyed.materials[m.material].name) && !/EAR/.test(dyed.materials[m.material].name));
    const colors = new Set(hair.map((m) => dyed.materials[m.material].color.slice(0, 3).map((v) => v.toFixed(3)).join(',')));
    expect(colors.size).toBe(2);
    const left = hair.find((m) => m.positions[0] > 0)!;
    const right = hair.find((m) => m.positions[0] < 0)!;
    expect(dyed.materials[right.material].color[0]).toBeGreaterThan(dyed.materials[right.material].color[2]);
    expect(dyed.materials[left.material].color[2]).toBeGreaterThan(dyed.materials[left.material].color[0]);
  });

  it('每个上半身单独设的数量也照着拼：左边三个头、两对手臂，右边照全部一样', () => {
    const b = build('两个上半身，左边的上半身三个头、两对手臂');
    expectSkinned(b);
    expect(b.ignored).toEqual([]);
    const names = b.bones.map((x) => x.name);
    expect(new Set(names).size).toBe(names.length);
    /** 这根骨骼长在哪个上半身上 */
    const torsoOf = (name: string) => {
      let i = names.indexOf(name);
      while (i >= 0 && !/^Spine_[LR]$/.test(names[i])) i = b.bones[i].parent;
      return names[i];
    };
    // 头从右往左数：右边那个上半身上的是第 1 个，左边的三个接着往下数
    expect(names.filter((n) => /^Head(\.\d+)?$/.test(n)).sort()).toEqual(['Head', 'Head.002', 'Head.003', 'Head.004']);
    expect(torsoOf('Head')).toBe('Spine_R');
    for (const head of ['Head.002', 'Head.003', 'Head.004']) expect(torsoOf(head)).toBe('Spine_L');
    expect(b.faces).toHaveLength(4);
    // 手臂：同一个后缀上先排外侧的（左边两对），再排里侧的（照另一个上半身有几对往后排）
    expect(names.filter((n) => /^UpperArm_/.test(n)).sort()).toEqual(['UpperArm_L', 'UpperArm_L.002', 'UpperArm_L.003', 'UpperArm_R', 'UpperArm_R.002', 'UpperArm_R.003']);
    for (const arm of ['UpperArm_L', 'UpperArm_L.002', 'UpperArm_R.002', 'UpperArm_R.003']) expect(torsoOf(arm), arm).toBe('Spine_L');
    for (const arm of ['UpperArm_R', 'UpperArm_L.003']) expect(torsoOf(arm), arm).toBe('Spine_R');
    // 腿没有多：胯、腿还是她自己那一副
    expect(names.filter((n) => /^UpperLeg/.test(n))).toEqual(build().bones.map((x) => x.name).filter((n) => /^UpperLeg/.test(n)));
    // 单独设成和「全部一样」一样多的：和没设一模一样
    expect(build('两个上半身', { torsoCounts: { L: { heads: 1 }, R: { armPairs: 1 } } }).bones).toEqual(build('两个上半身').bones);
  });

  it('三个上半身：正中那个单独设过的，她自己（正中）照它的数拼，两边照全部一样；分开染照全身第几个头', () => {
    const blue = '#2a5f9e';
    const spec = make('三个上半身，中间的上半身两对手臂，右边的上半身两个头');
    const b = assembleCharacter(source(), { ...spec, hair: { ...spec.hair, color: '#c2413b', heads: ['', '', '', blue] } });
    expectSkinned(b);
    const names = b.bones.map((x) => x.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => /^UpperArm_/.test(n))).toHaveLength(8);
    // 右边两个、正中一个、左边一个
    expect(names.filter((n) => /^Head(\.\d+)?$/.test(n))).toHaveLength(4);
    expect(b.faces).toHaveLength(4);
    // 第 4 个头（左边那个上半身上的）染蓝：只有它在 +X 那边
    const hair = b.meshes.filter((m) => /HAIR_01/.test(b.materials[m.material].name) && !/EAR/.test(b.materials[m.material].name));
    const blueHair = hair.filter((m) => b.materials[m.material].color[2] > b.materials[m.material].color[0] * 1.5);
    expect(blueHair.length).toBeGreaterThan(0);
    for (const m of blueHair) expect(m.positions[0]).toBeGreaterThan(0.1);
  });

  it('手动微调：胯是 Torso，每个上半身一个部件，手臂、头挂在自己那个上半身上', () => {
    const b = build('两个上半身');
    const parts = characterParts(b);
    const byName = new Map(parts.map((p) => [p.name, p]));
    expect(byName.get('Torso')?.type).toBe('torso');
    expect(byName.get('UpperBody_L')?.parent).toBe('Torso');
    expect(byName.get('Arm_01_L')?.parent).toBe('UpperBody_L');
    expect(byName.get('Arm_01_R')?.parent).toBe('UpperBody_R');
    expect(byName.get('Head_01')?.parent).toBe('UpperBody_R');
    // 挪一个上半身：它上面的东西跟着走，另一个不动
    const moved = tweakCharacter(b, { UpperBody_R: { position: [-0.05, 0, 0] } }).build;
    expect(moved.bones.find((x) => x.name === 'Head')!.head[0]).toBeLessThan(bone(b, 'Head').head[0] - 0.04);
    expect(moved.bones.find((x) => x.name === 'Head.002')!.head[0]).toBeCloseTo(bone(b, 'Head.002').head[0], 6);
  });

  it('十个角色都拼得出来，人马、蛛形下身也行', () => {
    for (const legs of [2, 4]) {
      const b = build(`两个上半身，${legs === 4 ? '人马' : ''}`);
      expectSkinned(b);
      expect(new Set(b.bones.map((x) => x.name)).size).toBe(b.bones.length);
    }
  });
});
