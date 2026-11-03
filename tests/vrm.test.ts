// VRM 0.x 导出（src/io/vrm.ts）：人形骨骼对照、面朝 -Z、骨骼不转、meta、材质、弹簧骨骼
import { describe, expect, it } from 'vitest';
import type { V3 } from '../src/geometry/vec';
import { readAccessor, readGlb } from '../src/io/glbRead';
import { humanoidMap, writeVrm } from '../src/io/vrm';
import type { Bone, Skeleton } from '../src/rig/skeleton';

/** 一副 T-pose 的人形骨架，加上第二对手臂和一条两节的尾巴 */
function skeleton(extra = true): Skeleton {
  const bones: Bone[] = [];
  const add = (name: string, parent: string | null, head: V3, tail: V3) => {
    bones.push({ name, parent: parent === null ? -1 : bones.findIndex((b) => b.name === parent), head, tail, part: '' });
  };
  add('Hips', null, [0, 1, 0], [0, 1.1, 0]);
  add('Spine', 'Hips', [0, 1.1, 0], [0, 1.2, 0]);
  add('Chest', 'Spine', [0, 1.2, 0], [0, 1.3, 0]);
  add('UpperChest', 'Chest', [0, 1.3, 0], [0, 1.4, 0]);
  add('Neck', 'UpperChest', [0, 1.4, 0], [0, 1.5, 0]);
  add('Head', 'Neck', [0, 1.5, 0], [0, 1.7, 0]);
  for (const [s, x] of [['L', 1], ['R', -1]] as const) {
    add(`Shoulder_${s}`, 'UpperChest', [0.05 * x, 1.38, 0], [0.15 * x, 1.38, 0]);
    add(`UpperArm_${s}`, `Shoulder_${s}`, [0.15 * x, 1.38, 0], [0.4 * x, 1.38, 0]);
    add(`LowerArm_${s}`, `UpperArm_${s}`, [0.4 * x, 1.38, 0], [0.65 * x, 1.38, 0]);
    add(`Hand_${s}`, `LowerArm_${s}`, [0.65 * x, 1.38, 0], [0.75 * x, 1.38, 0]);
    add(`Index1_${s}`, `Hand_${s}`, [0.75 * x, 1.38, 0.02], [0.78 * x, 1.38, 0.02]);
    add(`Index2_${s}`, `Index1_${s}`, [0.78 * x, 1.38, 0.02], [0.8 * x, 1.38, 0.02]);
    add(`Index3_${s}`, `Index2_${s}`, [0.8 * x, 1.38, 0.02], [0.82 * x, 1.38, 0.02]);
    add(`UpperLeg_${s}`, 'Hips', [0.1 * x, 0.95, 0], [0.1 * x, 0.5, 0]);
    add(`LowerLeg_${s}`, `UpperLeg_${s}`, [0.1 * x, 0.5, 0], [0.1 * x, 0.08, 0]);
    add(`Foot_${s}`, `LowerLeg_${s}`, [0.1 * x, 0.08, 0], [0.1 * x, 0.02, 0.12]);
    add(`Toes_${s}`, `Foot_${s}`, [0.1 * x, 0.02, 0.12], [0.1 * x, 0.02, 0.18]);
    if (extra) add(`UpperArm_${s}.002`, 'Chest', [0.12 * x, 1.22, 0], [0.4 * x, 1.22, 0]);
  }
  if (extra) {
    add('Tail_01_01', 'Hips', [0, 0.95, -0.1], [0, 1, -0.3]);
    add('Tail_01_02', 'Tail_01_01', [0, 1, -0.3], [0, 1.1, -0.45]);
  }
  return { bones };
}

/** 一个三角形，前面那个顶点在 +Z，全跟着胯 */
function mesh() {
  return {
    positions: new Float32Array([0, 1, 0.1, 0.1, 1, 0, -0.1, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    joints: new Uint16Array(12),
    weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    color: 0xe7eaeb,
  };
}

describe('VRM：人形骨骼对照', () => {
  it('第一套进对照表，多出来的手臂、尾巴不进；手指三节对上', () => {
    const sk = skeleton();
    const map = humanoidMap(sk);
    const name = (slot: string) => sk.bones[map.get(slot)!].name;
    expect(name('hips')).toBe('Hips');
    expect(name('upperChest')).toBe('UpperChest');
    expect(name('leftUpperArm')).toBe('UpperArm_L');
    expect(name('rightHand')).toBe('Hand_R');
    expect(name('leftIndexProximal')).toBe('Index1_L');
    expect(name('rightIndexDistal')).toBe('Index3_R');
    expect(name('leftToes')).toBe('Toes_L');
    const used = new Set([...map.values()].map((i) => sk.bones[i].name));
    expect(used.has('UpperArm_L.002')).toBe(false);
    expect(used.has('Tail_01_01')).toBe(false);
  });

  it('两个上半身：整套从同一个上半身上取（它的脖子、里侧的手臂带序号）', () => {
    const bones: Bone[] = [];
    const add = (name: string, parent: string | null) =>
      bones.push({ name, parent: parent === null ? -1 : bones.findIndex((b) => b.name === parent), head: [0, bones.length * 0.01, 0], tail: [0, bones.length * 0.01 + 0.01, 0], part: '' });
    add('Hips', null);
    // 左边那个上半身：脖子、头带 .002，里侧（右边）的手臂也是
    add('Spine_L', 'Hips');
    add('Chest_L', 'Spine_L');
    add('UpperChest_L', 'Chest_L');
    add('Neck.002', 'UpperChest_L');
    add('Head.002', 'Neck.002');
    add('Shoulder_L', 'UpperChest_L');
    add('UpperArm_L', 'Shoulder_L');
    add('LowerArm_L', 'UpperArm_L');
    add('Hand_L', 'LowerArm_L');
    add('Shoulder_R.002', 'UpperChest_L');
    add('UpperArm_R.002', 'Shoulder_R.002');
    add('LowerArm_R.002', 'UpperArm_R.002');
    add('Hand_R.002', 'LowerArm_R.002');
    // 右边那个上半身：不带序号的脖子、头、右手臂在这边
    add('Spine_R', 'Hips');
    add('Chest_R', 'Spine_R');
    add('UpperChest_R', 'Chest_R');
    add('Neck', 'UpperChest_R');
    add('Head', 'Neck');
    add('Shoulder_R', 'UpperChest_R');
    add('UpperArm_R', 'Shoulder_R');
    add('LowerArm_R', 'UpperArm_R');
    add('Hand_R', 'LowerArm_R');
    for (const s of ['L', 'R']) {
      add(`UpperLeg_${s}`, 'Hips');
      add(`LowerLeg_${s}`, `UpperLeg_${s}`);
      add(`Foot_${s}`, `LowerLeg_${s}`);
    }
    const map = humanoidMap({ bones });
    const name = (slot: string) => bones[map.get(slot)!].name;
    expect(['spine', 'chest', 'neck', 'head', 'leftUpperArm', 'rightUpperArm', 'rightHand'].map(name)).toEqual(['Spine_L', 'Chest_L', 'Neck.002', 'Head.002', 'UpperArm_L', 'UpperArm_R.002', 'Hand_R.002']);
  });

  it('缺一定要有的骨骼：报错说清楚缺什么', () => {
    const sk = skeleton(false);
    sk.bones = sk.bones.filter((b) => !/(Arm|Hand|Index|Shoulder)_R/.test(b.name));
    // 删了骨骼以后父骨骼的下标要重排
    const names = skeleton(false).bones;
    sk.bones = sk.bones.map((b) => ({ ...b, parent: b.parent < 0 ? -1 : sk.bones.findIndex((p) => p.name === names[b.parent].name) }));
    expect(() => humanoidMap(sk)).toThrow(/右手臂.*右前臂.*右手/);
  });
});

describe('VRM：写出来的文件', () => {
  const sk = skeleton();
  const springs = [{ comment: 'Tail', roots: [sk.bones.findIndex((b) => b.name === 'Tail_01_01')], stiffness: 0.8, gravity: 0.05, drag: 0.4, hitRadius: 0.03 }];
  const doc = readGlb(writeVrm(mesh(), sk, { title: '测试', author: '我', license: 'private', credits: '脚部网格 © Fox Jump' }, springs));
  const { json } = doc;
  const vrm = json.extensions.VRM;

  it('有 VRM 扩展、0.0 版', () => {
    expect(json.extensionsUsed).toContain('VRM');
    expect(vrm.specVersion).toBe('0.0');
  });

  it('骨骼节点不带旋转，排在最前面、名字对得上', () => {
    sk.bones.forEach((b, i) => {
      expect(json.nodes[i].name).toBe(b.name);
      expect(json.nodes[i].rotation).toBeUndefined();
    });
    const map = vrm.humanoid.humanBones as { bone: string; node: number }[];
    expect(json.nodes[map.find((h) => h.bone === 'head')!.node].name).toBe('Head');
    expect(vrm.firstPerson.firstPersonBone).toBe(map.find((h) => h.bone === 'head')!.node);
  });

  it('面朝 -Z：前面那个顶点到了 -Z，左手边（+X）到了 -X；骨骼也跟着转', () => {
    const position = readAccessor(doc, json.meshes[0].primitives[0].attributes.POSITION);
    expect(position[2]).toBeCloseTo(-0.1);
    expect(position[3]).toBeCloseTo(-0.1);
    const upperArmL = json.nodes.find((n: { name: string }) => n.name === 'UpperArm_L');
    // 上臂相对锁骨的位置：原来往 +X，现在往 -X
    expect(upperArmL.translation[0]).toBeLessThan(0);
  });

  it('绑定矩阵只有平移（骨骼不转）', () => {
    const inverse = readAccessor(doc, json.skins[0].inverseBindMatrices);
    for (let i = 0; i < sk.bones.length; i++) {
      const m = inverse.slice(i * 16, i * 16 + 12);
      expect([...m].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    }
  });

  it('meta：只许自己用；署名进 reference 和 copyright', () => {
    expect(vrm.meta).toMatchObject({ title: '测试', author: '我', licenseName: 'Redistribution_Prohibited', allowedUserName: 'OnlyAuthor', commercialUssageName: 'Disallow', reference: '脚部网格 © Fox Jump' });
    expect(json.asset.copyright).toBe('脚部网格 © Fox Jump');
  });

  it('每个材质都有 MToon 的设定，名字对得上', () => {
    expect(vrm.materialProperties.map((m: { name: string }) => m.name)).toEqual(json.materials.map((m: { name: string }) => m.name));
    expect(vrm.materialProperties[0].shader).toBe('VRM/MToon');
  });

  it('尾巴是弹簧骨骼：根节点对得上', () => {
    const group = vrm.secondaryAnimation.boneGroups[0];
    expect(json.nodes[group.bones[0]].name).toBe('Tail_01_01');
    expect(group).toMatchObject({ stiffiness: 0.8, gravityPower: 0.05, hitRadius: 0.03 });
  });
});
