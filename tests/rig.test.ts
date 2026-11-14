import { describe, expect, it } from 'vitest';
import { type Figure, worldTransforms } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type V3, quatEuler, rotate } from '../src/geometry/vec';
import { setOverride } from '../src/model/overrides';
import { PRESETS, applyPreset } from '../src/model/presets';
import { type BodyCounts, type BodySpec, COUNT_DEFS, LEG_LAYOUTS, defaultSpec, legPlan } from '../src/model/spec';
import { type Skeleton, buildSkeleton } from '../src/rig/skeleton';
import { handMesh } from '../src/anime/hand';
import { type SkinWeights, bindGrafts, bindPartGrafts, finishSkin, gateNear, joinNear, nearParts, planSkin, skinVertices, weighVertices } from '../src/rig/skin';
import { buildPartGeometry } from '../src/geometry/partsMesh';
import { compileField, fieldAt } from '../src/sdf/field';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
import { graftPoints } from '../src/sdf/graft';
import { rng } from './helpers';

const make = (counts: Partial<BodyCounts> = {}, rest: Partial<BodySpec> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, ...rest, counts: { ...base.counts, ...counts } };
};
const skeletonOf = (spec: BodySpec) => buildSkeleton(buildFigure(spec));
const names = (s: Skeleton) => s.bones.map((b) => b.name);
const boneOf = (s: Skeleton, name: string) => {
  const bone = s.bones.find((b) => b.name === name);
  if (!bone) throw new Error(`没有骨骼 ${name}`);
  return bone;
};
const parentOf = (s: Skeleton, name: string) => {
  const p = boneOf(s, name).parent;
  return p < 0 ? null : s.bones[p].name;
};
/** 从这根骨骼一路往上到根 */
const chainOf = (s: Skeleton, name: string) => {
  const out = [name];
  for (let p = parentOf(s, name); p; p = parentOf(s, p)) out.push(p);
  return out;
};

describe('骨架：标准人形', () => {
  const s = skeletonOf(defaultSpec());

  it('骨骼是 VRM / Humanoid 那一套名字', () => {
    const limbs = ['Shoulder', 'UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot', 'Toes'];
    // 手指：拇指和四指各三节
    const fingers = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'].flatMap((f) => [1, 2, 3].map((k) => `${f}${k}`));
    expect([...names(s)].sort()).toEqual(
      ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head', ...[...limbs, ...fingers].flatMap((n) => [`${n}_L`, `${n}_R`])].sort(),
    );
  });

  it('根骨骼是 Hips，排在第一个；父骨骼总在子骨骼前面', () => {
    expect(s.bones[0].name).toBe('Hips');
    expect(s.bones[0].parent).toBe(-1);
    s.bones.forEach((b, i) => {
      if (i) expect(b.parent, b.name).toBeGreaterThanOrEqual(0);
      expect(b.parent, b.name).toBeLessThan(i);
    });
  });

  it('父子关系：脊柱一条链，手臂接在上胸，腿接在髋', () => {
    expect(chainOf(s, 'Head')).toEqual(['Head', 'Neck', 'UpperChest', 'Chest', 'Spine', 'Hips']);
    expect(chainOf(s, 'Hand_L')).toEqual(['Hand_L', 'LowerArm_L', 'UpperArm_L', 'Shoulder_L', 'UpperChest', 'Chest', 'Spine', 'Hips']);
    expect(chainOf(s, 'Toes_R')).toEqual(['Toes_R', 'Foot_R', 'LowerLeg_R', 'UpperLeg_R', 'Hips']);
  });

  it('_L 在角色的左手边（+X），和 _R 左右对称', () => {
    for (const bone of s.bones) {
      if (!bone.name.endsWith('_L')) continue;
      const twin = boneOf(s, `${bone.name.slice(0, -1)}R`);
      for (const end of ['head', 'tail'] as const) {
        expect(twin[end][0], bone.name).toBeCloseTo(-bone[end][0], 9);
        expect(twin[end][1], bone.name).toBeCloseTo(bone[end][1], 9);
        expect(twin[end][2], bone.name).toBeCloseTo(bone[end][2], 9);
      }
    }
    expect(boneOf(s, 'UpperArm_L').head[0]).toBeGreaterThan(0.1);
    expect(boneOf(s, 'UpperLeg_L').head[0]).toBeGreaterThan(0.05);
  });

  it('关节的位置合理：髋在腿根的高度，肩、肘、腕、膝、踝依次排开，头顶最高', () => {
    const figure = buildFigure(defaultSpec());
    const h = figure.metrics.height;
    const y = (name: string, end: 'head' | 'tail' = 'head') => boneOf(s, name)[end][1] / h;
    expect(y('Hips')).toBeGreaterThan(0.48);
    expect(y('Hips')).toBeLessThan(0.58);
    expect(y('UpperLeg_L')).toBeCloseTo(0.9 / 1.76, 1);
    expect(y('LowerLeg_L')).toBeGreaterThan(0.24);
    expect(y('LowerLeg_L')).toBeLessThan(0.32);
    expect(y('Foot_L')).toBeLessThan(0.08);
    expect(y('Toes_L', 'tail')).toBeLessThan(0.03);
    expect(y('UpperArm_L')).toBeGreaterThan(0.75);
    expect(y('UpperArm_L')).toBeLessThan(0.84);
    expect(y('LowerArm_L')).toBeLessThan(y('UpperArm_L'));
    expect(y('Hand_L')).toBeLessThan(y('LowerArm_L'));
    expect(y('Neck')).toBeGreaterThan(0.8);
    expect(y('Head', 'tail')).toBeGreaterThan(0.97);
    expect(y('Head', 'tail')).toBeLessThan(1);
    // 脊柱从下到上首尾相接
    for (const [a, b] of [['Hips', 'Spine'], ['Spine', 'Chest'], ['Chest', 'UpperChest']]) {
      expect(boneOf(s, a).tail).toEqual(boneOf(s, b).head);
    }
    // 四肢也是：上一节的终点就是下一节的起点
    for (const [a, b] of [['UpperArm_L', 'LowerArm_L'], ['LowerArm_L', 'Hand_L'], ['UpperLeg_R', 'LowerLeg_R'], ['LowerLeg_R', 'Foot_R'], ['Foot_R', 'Toes_R']]) {
      expect(boneOf(s, a).tail).toEqual(boneOf(s, b).head);
    }
  });

  it('骨骼的位置跟着身高等比缩放', () => {
    const tall = skeletonOf(make({}, { shape: { ...defaultSpec().shape, height: 1.944 } }));
    const k = 1.944 / defaultSpec().shape.height;
    for (const bone of s.bones) {
      const other = boneOf(tall, bone.name);
      for (let i = 0; i < 3; i++) expect(other.head[i], bone.name).toBeCloseTo(bone.head[i] * k, 9);
    }
  });
});

describe('骨架：多出来的部件', () => {
  it('上下排的多对手臂：后缀 .002、.003，各接在自己那一节胸腔上', () => {
    const s = skeletonOf(make({ armPairs: 3 }));
    expect(chainOf(s, 'UpperChest')).toEqual(['UpperChest', 'Chest.002', 'Chest.003', 'Chest', 'Spine', 'Hips']);
    expect(parentOf(s, 'Shoulder_L')).toBe('UpperChest');
    expect(parentOf(s, 'Shoulder_L.002')).toBe('Chest.002');
    expect(parentOf(s, 'Shoulder_R.003')).toBe('Chest.003');
    expect(chainOf(s, 'Hand_R.003').slice(0, 4)).toEqual(['Hand_R.003', 'LowerArm_R.003', 'UpperArm_R.003', 'Shoulder_R.003']);
    // 每排手臂的肩关节都落在它那节胸腔的高度范围里
    for (const [arm, chest] of [['UpperArm_L', 'UpperChest'], ['UpperArm_L.002', 'Chest.002'], ['UpperArm_L.003', 'Chest.003']]) {
      const y = boneOf(s, arm).head[1];
      expect(y, arm).toBeGreaterThan(boneOf(s, chest).head[1]);
      expect(y, arm).toBeLessThan(boneOf(s, chest).tail[1]);
    }
    // 越往下的一排越低
    expect(boneOf(s, 'UpperArm_L.002').head[1]).toBeLessThan(boneOf(s, 'UpperArm_L').head[1] - 0.1);
    expect(boneOf(s, 'UpperArm_L.003').head[1]).toBeLessThan(boneOf(s, 'UpperArm_L.002').head[1] - 0.1);
  });

  it('聚拢在肩部的多对手臂：都接在上胸，躯干不加长', () => {
    const s = skeletonOf(make({ armPairs: 3 }, { armLayout: 'fan' }));
    expect(names(s)).not.toContain('Chest.002');
    for (const name of ['Shoulder_L', 'Shoulder_L.002', 'Shoulder_R.003']) expect(parentOf(s, name)).toBe('UpperChest');
  });

  it('多排胸也会让胸腔多出几节', () => {
    const s = skeletonOf(make({ breasts: 6 }));
    expect(chainOf(s, 'UpperChest')).toEqual(['UpperChest', 'Chest.002', 'Chest.003', 'Chest', 'Spine', 'Hips']);
    expect(parentOf(s, 'Shoulder_L')).toBe('UpperChest');
  });

  it('多个头：Neck.002 / Head.002 ……，耳朵跟着各自的头', () => {
    const s = skeletonOf(make({ heads: 3, earPairsPerHead: 2, hornsPerHead: 2 }));
    expect(chainOf(s, 'Head.003').slice(0, 3)).toEqual(['Head.003', 'Neck.003', 'UpperChest']);
    expect(parentOf(s, 'Ear_01_L')).toBe('Head');
    expect(parentOf(s, 'Ear_02_R.002')).toBe('Head.002');
    expect(parentOf(s, 'Ear_01_L.003')).toBe('Head.003');
    // 第一个头在角色的右手边（-X），最后一个在左手边
    expect(boneOf(s, 'Head').head[0]).toBeLessThan(-0.05);
    expect(boneOf(s, 'Head.003').head[0]).toBeGreaterThan(0.05);
    // 角没有自己的骨骼
    expect(names(s).some((n) => n.includes('Horn'))).toBe(false);
  });

  it('一个头几张脸：只有一根脖子、一根头骨骼，多出来的脸没有自己的骨骼，网格跟着头', () => {
    const spec = make({ heads: 3, earPairsPerHead: 1 }, { headLayout: 'faces' });
    const s = skeletonOf(spec);
    expect(names(s).filter((n) => /^(Head|Neck)/.test(n))).toEqual(['Neck', 'Head']);
    expect(names(s).filter((n) => /^Ear/.test(n)).sort()).toEqual(['Ear_01_L', 'Ear_01_R']);
    // 骨架和一个头的时候一样（只有兽耳往头顶中间收了一点，给两边的脸让地方）
    const single = skeletonOf(make({ earPairsPerHead: 1 }));
    expect(names(s)).toEqual(names(single));
    const fixed = (rig: Skeleton) => rig.bones.filter((b) => !b.name.startsWith('Ear'));
    expect(fixed(s)).toEqual(fixed(single));
    expect(boneOf(s, 'Ear_01_L').head[0]).toBeLessThan(boneOf(single, 'Ear_01_L').head[0]);
    // 朝左的那张脸上的一点（鼻尖附近）：整个跟着头
    const figure = { parts: buildFigure(spec).parts, scale: 1 };
    const rig = buildSkeleton(figure);
    const face = worldTransforms(figure).get('Head_02')!;
    const nose = [face.pos[0] + 0.09 * face.scale, face.pos[1], face.pos[2]];
    const skin = skinVertices(figure, rig, nose);
    expect(rig.bones[skin.joints[0]].name).toBe('Head');
    expect(skin.weights[0]).toBeGreaterThan(0.9);
  });

  it('尾巴：Tail_01_01 … Tail_01_05 一节接一节，从尾根到尾尖', () => {
    const s = skeletonOf(make({ tails: 2 }));
    expect(chainOf(s, 'Tail_02_05')).toEqual(['Tail_02_05', 'Tail_02_04', 'Tail_02_03', 'Tail_02_02', 'Tail_02_01', 'Hips']);
    expect(parentOf(s, 'Tail_01_01')).toBe('Hips');
    for (let k = 1; k < 5; k++) expect(boneOf(s, `Tail_01_0${k}`).tail).toEqual(boneOf(s, `Tail_01_0${k + 1}`).head);
    // 尾根在身后，尾尖比尾根远
    expect(boneOf(s, 'Tail_01_01').head[2]).toBeLessThan(-0.05);
    expect(boneOf(s, 'Tail_01_05').tail[2]).toBeLessThan(boneOf(s, 'Tail_01_01').head[2] - 0.3);
  });

  it('翅膀：Wing_02_L，一根骨骼从翼根指向翼尖', () => {
    const s = skeletonOf(make({ wingPairs: 2 }));
    expect(parentOf(s, 'Wing_02_L')).toBe('UpperChest');
    const wing = boneOf(s, 'Wing_01_L');
    expect(wing.tail[0]).toBeGreaterThan(wing.head[0] + 0.3);
    expect(wing.tail[1]).toBeGreaterThan(wing.head[1] + 0.2);
    expect(boneOf(s, 'Wing_01_R').tail[0]).toBeCloseTo(-wing.tail[0], 9);
  });

  it('人马：后腿接在兽身的骨骼上，尾巴接在兽身的末端', () => {
    const s = skeletonOf(make({ legs: 6, tails: 1 }, { legLayout: 'taur' }));
    expect(parentOf(s, 'UpperLeg_L')).toBe('Hips');
    expect(chainOf(s, 'UpperLeg_L.002')).toEqual(['UpperLeg_L.002', 'LowerBody_01', 'Hips']);
    expect(chainOf(s, 'UpperLeg_R.003')).toEqual(['UpperLeg_R.003', 'LowerBody_02', 'LowerBody_01', 'Hips']);
    expect(parentOf(s, 'Tail_01_01')).toBe('LowerBody_02');
    expect(names(s)).not.toContain('Toes_L');
    // 兽身的骨骼一节一节往后
    expect(boneOf(s, 'LowerBody_01').tail[2]).toBeLessThan(boneOf(s, 'LowerBody_01').head[2] - 0.2);
    expect(boneOf(s, 'LowerBody_02').head).toEqual(boneOf(s, 'LowerBody_01').tail);
    // 蹄子落在地上
    expect(boneOf(s, 'Foot_L.003').tail[1]).toBeLessThan(0.08);
  });

  it('蛛形：所有的腿都接在 Hips 上，腹部有自己的骨骼，尾巴接在腹部', () => {
    const s = skeletonOf(make({ legs: 8, tails: 1 }));
    for (const name of ['UpperLeg_L', 'UpperLeg_R.002', 'UpperLeg_L.004']) expect(parentOf(s, name)).toBe('Hips');
    expect(parentOf(s, 'Abdomen')).toBe('Hips');
    expect(parentOf(s, 'Tail_01_01')).toBe('Abdomen');
    expect(boneOf(s, 'Foot_L.004').tail[1]).toBeLessThan(0.05);
  });

  it('前后串联和左右并排的人腿', () => {
    const tandem = skeletonOf(make({ legs: 6, tails: 1 }, { legLayout: 'tandem' }));
    expect(chainOf(tandem, 'UpperLeg_L.003')).toEqual(['UpperLeg_L.003', 'LowerBody_02', 'LowerBody_01', 'Hips']);
    expect(parentOf(tandem, 'Tail_01_01')).toBe('LowerBody_02');
    expect(names(tandem)).toContain('Toes_R.003');
    // 胯部聚拢也是一副胯接一副胯
    const gather = skeletonOf(make({ legs: 6, tails: 1 }, { legLayout: 'gather' }));
    expect(chainOf(gather, 'UpperLeg_L.003')).toEqual(['UpperLeg_L.003', 'LowerBody_02', 'LowerBody_01', 'Hips']);
    expect(parentOf(gather, 'Tail_01_01')).toBe('LowerBody_02');
    const row = skeletonOf(make({ legs: 6, tails: 1 }, { legLayout: 'row' }));
    for (const name of ['UpperLeg_L', 'UpperLeg_L.002', 'UpperLeg_R.003']) expect(parentOf(row, name)).toBe('Hips');
    expect(names(row).some((n) => n.startsWith('LowerBody'))).toBe(false);
    expect(parentOf(row, 'Tail_01_01')).toBe('Hips');
  });

  it('人腿人马：前腿接在 Hips 上，后面每副胯一节 LowerBody，后腿是带脚趾的人腿，尾巴接在最后一副胯上', () => {
    const s = skeletonOf(make({ legs: 6, tails: 1 }, { legLayout: 'humantaur' }));
    expect(parentOf(s, 'UpperLeg_L')).toBe('Hips');
    expect(chainOf(s, 'UpperLeg_L.002')).toEqual(['UpperLeg_L.002', 'LowerBody_01', 'Hips']);
    expect(chainOf(s, 'UpperLeg_R.003')).toEqual(['UpperLeg_R.003', 'LowerBody_02', 'LowerBody_01', 'Hips']);
    expect(parentOf(s, 'Tail_01_01')).toBe('LowerBody_02');
    for (const name of ['Toes_L', 'Toes_L.002', 'Toes_R.003']) expect(names(s)).toContain(name);
    // 胯一副在一副后面，隔得比前后串联远；高度一样（腿一样长）
    const back = (name: string) => boneOf(s, name).head[2];
    expect(back('UpperLeg_L.002')).toBeLessThan(back('UpperLeg_L') - 0.35);
    expect(back('UpperLeg_L.003')).toBeLessThan(back('UpperLeg_L.002') - 0.35);
    expect(boneOf(s, 'UpperLeg_L.003').head[1]).toBeCloseTo(boneOf(s, 'UpperLeg_L').head[1], 9);
    expect(boneOf(s, 'LowerBody_02').head).toEqual(boneOf(s, 'LowerBody_01').tail);
    // 脚都踩在地上
    for (const name of ['Foot_L', 'Foot_L.002', 'Foot_R.003']) expect(boneOf(s, name).tail[1]).toBeLessThan(0.05);
  });
});

describe('骨架：各种组合都成立', () => {
  /** 骨骼的两头都应该在身体里面（或者贴着表面） */
  const expectInside = (spec: BodySpec, label: string) => {
    const figure = buildFigure(spec);
    const s = buildSkeleton(figure);
    const field = compileField(figure, { blend: spec.blend * figure.scale });
    const tolerance = 0.006 * figure.scale;
    // 分指的手是接上去的现成网格，不在距离场里：手和手指的骨骼要在那只手的网格里面
    const hands = graftPoints(figure.parts);
    const toHand = (p: readonly number[]) => {
      let near = Infinity;
      for (let i = 0; i < hands.length; i += 3) {
        near = Math.min(near, Math.hypot(hands[i] * figure.scale - p[0], hands[i + 1] * figure.scale - p[1], hands[i + 2] * figure.scale - p[2]));
      }
      return near;
    };
    for (const bone of s.bones) {
      const finger = /^(Thumb|Index|Middle|Ring|Little)\d/.test(bone.name);
      for (const end of ['head', 'tail'] as const) {
        const p = bone[end];
        const text = `${label}：${bone.name} 的${end === 'head' ? '起点' : '终点'}露在身体外面`;
        // 手指细，骨骼贴着中间走；手掌厚一些
        if (hands.length && (finger || (/^Hand_/.test(bone.name) && end === 'tail'))) expect(toHand(p), text).toBeLessThan((finger ? 0.016 : 0.03) * figure.scale);
        else expect(fieldAt(field, p[0], p[1], p[2]), text).toBeLessThan(tolerance);
      }
    }
    return s;
  };

  it.each(PRESETS.map((p) => [p.name, p] as const))('预设「%s」：骨骼都在身体里面', (name, preset) => {
    expectInside(applyPreset(defaultSpec(), preset), name);
  });

  it('各种排法、男女、A / T 姿势、粗细极端值：骨骼都在身体里面', () => {
    const base = make({ heads: 2, armPairs: 3, breasts: 4, tails: 3, wingPairs: 2, hornsPerHead: 2, earPairsPerHead: 2 });
    for (const armLayout of ['stack', 'fan'] as const) {
      for (const pose of ['A', 'T'] as const) {
        for (const gender of ['female', 'male'] as const) {
          expectInside({ ...base, armLayout, pose, gender }, `${armLayout} ${pose} ${gender}`);
        }
      }
    }
    for (const legLayout of LEG_LAYOUTS) {
      for (const legs of [3, 4, 7, 8]) expectInside(make({ legs, tails: 1 }, { legLayout }), `${legLayout} ${legs}`);
    }
    for (const earShape of ['cat', 'fox', 'rabbit', 'elf'] as const) expectInside(make({ earPairsPerHead: 2 }, { earShape }), earShape);
    const shape = defaultSpec().shape;
    expectInside(make({}, { shape: { ...shape, build: 0.8, limbs: 0.8, shoulders: 0.85, waist: 0.8, hips: 0.8, headRatio: 9 } }), '最瘦');
    expectInside(make({}, { shape: { ...shape, build: 1.3, limbs: 1.3, shoulders: 1.3, waist: 1.3, hips: 1.4, headRatio: 6 } }), '最壮');
  });

  it('随机 300 种组合：名字不重复，只有一根根骨骼，父骨骼都在前面，左右成对', () => {
    const random = rng(2026);
    const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
    for (let i = 0; i < 300; i++) {
      const counts = Object.fromEntries(
        COUNT_DEFS.map((d) => [d.key, d.min + Math.floor(random() * (d.max - d.min + 1))]),
      ) as BodyCounts;
      const spec = make(counts, {
        armLayout: pick(['stack', 'fan'] as const),
        legLayout: pick(LEG_LAYOUTS),
        pose: pick(['A', 'T'] as const),
        gender: pick(['female', 'male'] as const),
      });
      const s = skeletonOf(spec);
      const label = JSON.stringify(counts);
      const all = names(s);
      expect(new Set(all).size, label).toBe(all.length);
      expect(s.bones.filter((b) => b.parent < 0).map((b) => b.name), label).toEqual(['Hips']);
      s.bones.forEach((b, k) => expect(b.parent, `${label} ${b.name}`).toBeLessThan(k));
      for (const name of all) {
        // 名字里的 _L 可能后面还跟着序号：UpperArm_L.002
        const twin = name.replace(/_L(\.\d+)?$/, '_R$1');
        if (twin !== name) expect(all, `${label} ${name}`).toContain(twin);
        expect(name, label).toMatch(/^[A-Za-z]+\d?(_\d\d)*(_[LR])?(\.\d{3})?$/);
      }
      for (const b of s.bones) expect([...b.head, ...b.tail].every(Number.isFinite), `${label} ${b.name}`).toBe(true);
      // 骨骼的数量对得上：好几个上半身时，头、手臂、翅膀是每个上半身各一份（挨着旁边那个长不下的里侧手臂、翅膀不长，见 torsos.ts）
      const parts = buildFigure(spec).parts;
      const arms = parts.filter((p) => p.type === 'arm').length * 4;
      const heads = counts.torsos * counts.heads * (2 + counts.earPairsPerHead * 2);
      if (counts.torsos === 1) expect(arms, label).toBe(counts.armPairs * 2 * 4);
      expect(all.filter((n) => /^(Shoulder|UpperArm|LowerArm|Hand)_/.test(n)).length, label).toBe(arms);
      expect(all.filter((n) => /^(Neck|Head|Ear)/.test(n)).length, label).toBe(heads);
      expect(all.filter((n) => n.startsWith('Tail_')).length, label).toBe(counts.tails * 5);
      expect(all.filter((n) => n.startsWith('Wing_')).length, label).toBe(parts.filter((p) => p.type === 'wing').length);
      if (counts.torsos === 1) expect(all.filter((n) => n.startsWith('Wing_')).length, label).toBe(counts.wingPairs * 2);
      // 中线上的腿不分左右：UpperLeg、UpperLeg.002
      expect(all.filter((n) => /^UpperLeg(_|\.|$)/.test(n)).length, label).toBe(legPlan(spec).total);
    }
  });
});

describe('骨架跟着手动微调走', () => {
  it('转动手臂：肩关节不动，肘和手跟着转', () => {
    const before = skeletonOf(defaultSpec());
    const after = skeletonOf(setOverride(defaultSpec(), 'Arm_01_L', { rotation: [0, 0, 40] }));
    expect(boneOf(after, 'UpperArm_L').head).toEqual(boneOf(before, 'UpperArm_L').head);
    const shoulder = boneOf(before, 'UpperArm_L').head;
    const turn = quatEuler(0, 0, (40 * Math.PI) / 180);
    const wrist = boneOf(before, 'Hand_L').head;
    const arm: V3 = [wrist[0] - shoulder[0], wrist[1] - shoulder[1], wrist[2] - shoulder[2]];
    const want = rotate(turn, arm).map((v, i) => v + shoulder[i]);
    boneOf(after, 'Hand_L').head.forEach((v, i) => expect(v).toBeCloseTo(want[i], 9));
    // 对侧没动
    expect(boneOf(after, 'Hand_R')).toEqual(boneOf(before, 'Hand_R'));
  });

  it('加长手臂：肘、腕都沿着手臂往外挪', () => {
    const before = skeletonOf(defaultSpec());
    const after = skeletonOf(setOverride(defaultSpec(), 'Arm_01_L', { scale: [1, 1.5, 1] }));
    const length = (s: Skeleton) => {
      const a = boneOf(s, 'UpperArm_L');
      return Math.hypot(a.tail[0] - a.head[0], a.tail[1] - a.head[1], a.tail[2] - a.head[2]);
    };
    expect(length(after)).toBeCloseTo(length(before) * 1.5, 9);
  });

  it('挪头：头的骨骼跟着走，脖子的骨骼伸过去', () => {
    const before = skeletonOf(defaultSpec());
    const after = skeletonOf(setOverride(defaultSpec(), 'Head_01', { position: [0.05, 0.1, 0] }));
    const s = buildFigure(defaultSpec()).scale;
    expect(boneOf(after, 'Head').tail[1]).toBeCloseTo(boneOf(before, 'Head').tail[1] + 0.1 * s, 9);
    expect(boneOf(after, 'Neck').head).toEqual(boneOf(before, 'Neck').head);
    expect(boneOf(after, 'Neck').tail[1]).toBeGreaterThan(boneOf(before, 'Neck').tail[1] + 0.08 * s);
    // 脖子的终点还是挨着头的起点
    const gap = boneOf(after, 'Neck').tail.map((v, i) => v - boneOf(after, 'Head').head[i]);
    expect(Math.hypot(...gap)).toBeLessThan(0.02);
  });

  it('腿加长以后人升高，脚上的骨骼还在地面附近', () => {
    const before = skeletonOf(defaultSpec());
    const after = skeletonOf(setOverride(defaultSpec(), 'Leg_01_L', { scale: [1, 1.3, 1] }, true));
    expect(boneOf(after, 'Hips').head[1]).toBeGreaterThan(boneOf(before, 'Hips').head[1] + 0.15);
    // 脚掌跟着腿一起拉高了一点，所以不是分毫不差
    expect(boneOf(after, 'Toes_L').tail[1]).toBeGreaterThan(0);
    expect(boneOf(after, 'Toes_L').tail[1]).toBeLessThan(0.05);
  });
});

/* ---------------- 蒙皮 ---------------- */

interface Rigged {
  skeleton: Skeleton;
  positions: Float32Array;
  triangles: Uint32Array;
  skin: SkinWeights;
}

function rig(spec: BodySpec, voxel: number = VOXEL.draft): Rigged {
  // 和导出时一样：网格、骨架、权重都按标准人台的尺寸算（Figure.scale 当作 1）
  const figure = { parts: buildFigure(spec).parts, scale: 1 };
  const mesh = fuseParts(figure.parts, { voxel, blend: spec.blend });
  const skeleton = buildSkeleton(figure);
  const skin = bindGrafts(skinVertices(figure, skeleton, mesh.positions, mesh.triangles), mesh, skeleton);
  return { skeleton, positions: mesh.positions, triangles: mesh.triangles, skin };
}

/** 这根骨骼是哪条胳膊、哪条腿上的（躯干、头、尾巴上的不算） */
function limbOf(name: string): string | null {
  const arm = name.match(/^(?:Shoulder|UpperArm|LowerArm|Hand|(?:Thumb|Index|Middle|Ring|Little)\d)_([LR])(\.\d+)?$/);
  if (arm) return `arm${arm[1]}${arm[2] ?? ''}`;
  const leg = name.match(/^(?:UpperLeg|LowerLeg|Foot|Toes)_([LR])(\.\d+)?$/);
  return leg ? `leg${leg[1]}${leg[2] ?? ''}` : null;
}

/** 同时跟着两条不同的胳膊腿的顶点有多少个，按「手臂+腿」这样分类数 */
function crossTalk(skeleton: Skeleton, skin: SkinWeights): Record<string, number> {
  const limb = skeleton.bones.map((b) => limbOf(b.name));
  const out: Record<string, number> = {};
  for (let v = 0; v < skin.joints.length / 4; v++) {
    const seen = new Set<string>();
    for (let k = 0; k < 4; k++) {
      const l = skin.weights[v * 4 + k] > 1e-4 ? limb[skin.joints[v * 4 + k]] : null;
      if (l) seen.add(l);
    }
    if (seen.size < 2) continue;
    const key = [...new Set([...seen].map((l) => l.slice(0, 3)))].sort().join('+');
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** 第 v 个顶点的权重，按骨骼名字列出来 */
function weightsOf(r: Rigged, v: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let k = 0; k < 4; k++) {
    const w = r.skin.weights[v * 4 + k];
    if (w > 0) out[r.skeleton.bones[r.skin.joints[v * 4 + k]].name] = w;
  }
  return out;
}

/** 离某一点不超过 radius 的顶点 */
function verticesNear(r: Rigged, p: readonly number[], radius: number): number[] {
  const out: number[] = [];
  for (let v = 0; v < r.positions.length / 3; v++) {
    if (Math.hypot(r.positions[v * 3] - p[0], r.positions[v * 3 + 1] - p[1], r.positions[v * 3 + 2] - p[2]) < radius) out.push(v);
  }
  return out;
}

describe('自动蒙皮', () => {
  const r = rig(make({ tails: 1 }));
  const count = r.positions.length / 3;

  it('每个顶点最多 4 根骨骼，权重都不小于 0，加起来是 1，骨骼下标都有效', () => {
    expect(r.skin.joints.length).toBe(count * 4);
    expect(r.skin.weights.length).toBe(count * 4);
    for (let v = 0; v < count; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const w = r.skin.weights[v * 4 + k];
        expect(w).toBeGreaterThanOrEqual(0);
        expect(r.skin.joints[v * 4 + k]).toBeLessThan(r.skeleton.bones.length);
        // 权重从大到小排
        if (k) expect(w).toBeLessThanOrEqual(r.skin.weights[v * 4 + k - 1] + 1e-6);
        sum += w;
      }
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it('每根骨骼都带着一些顶点', () => {
    const used = new Set<number>();
    for (let i = 0; i < r.skin.joints.length; i++) if (r.skin.weights[i] > 0.2) used.add(r.skin.joints[i]);
    expect(r.skeleton.bones.filter((_, i) => !used.has(i)).map((b) => b.name)).toEqual([]);
  });

  it('不串门：手上的顶点只跟这条手臂的骨骼（手、手指），哪怕手就垂在大腿旁边', () => {
    for (const side of ['L', 'R']) {
      const hand = boneOf(r.skeleton, `Hand_${side}`);
      const tips = verticesNear(r, hand.tail, 0.05);
      expect(tips.length).toBeGreaterThan(10);
      for (const v of tips) {
        const w = weightsOf(r, v);
        for (const name of Object.keys(w)) {
          expect(name, `顶点 ${v}`).toMatch(new RegExp(`^(Hand|LowerArm|UpperArm|Shoulder|(Thumb|Index|Middle|Ring|Little)\\d)_${side}$`));
        }
        // 手和手指加起来占大头
        const onHand = Object.entries(w).reduce((sum, [name, x]) => (/Arm|Shoulder/.test(name) ? sum : sum + x), 0);
        expect(onHand, `顶点 ${v}`).toBeGreaterThan(0.6);
      }
    }
  });

  it('大腿中段跟大腿骨，头顶跟头，尾巴尖跟最后一节尾巴', () => {
    const thigh = boneOf(r.skeleton, 'UpperLeg_L');
    const mid = thigh.head.map((v, i) => (v + thigh.tail[i]) / 2);
    for (const v of verticesNear(r, [mid[0] + 0.07, mid[1], mid[2]], 0.04)) {
      expect(weightsOf(r, v).UpperLeg_L, `顶点 ${v}`).toBeGreaterThan(0.85);
    }
    const crown = boneOf(r.skeleton, 'Head').tail;
    const top = verticesNear(r, [crown[0], crown[1] + 0.012, crown[2]], 0.03);
    expect(top.length).toBeGreaterThan(3);
    for (const v of top) expect(weightsOf(r, v).Head, `顶点 ${v}`).toBeGreaterThan(0.99);
    const tip = verticesNear(r, boneOf(r.skeleton, 'Tail_01_05').tail, 0.03);
    expect(tip.length).toBeGreaterThan(3);
    for (const v of tip) expect(weightsOf(r, v).Tail_01_05, `顶点 ${v}`).toBeGreaterThan(0.8);
  });

  it('关节处是过渡：肘部的顶点上臂、前臂各占一些', () => {
    const elbow = boneOf(r.skeleton, 'LowerArm_L').head;
    const ring = verticesNear(r, elbow, 0.045);
    expect(ring.length).toBeGreaterThan(8);
    let upper = 0;
    let lower = 0;
    for (const v of ring) {
      const w = weightsOf(r, v);
      upper += w.UpperArm_L ?? 0;
      lower += w.LowerArm_L ?? 0;
      expect((w.UpperArm_L ?? 0) + (w.LowerArm_L ?? 0), `顶点 ${v}`).toBeGreaterThan(0.95);
    }
    expect(upper / ring.length).toBeGreaterThan(0.25);
    expect(lower / ring.length).toBeGreaterThan(0.25);
  });

  it('部件交界处也是过渡：肩头的顶点既跟手臂也跟躯干', () => {
    const shoulder = boneOf(r.skeleton, 'UpperArm_L').head;
    const around = verticesNear(r, shoulder, 0.075);
    let arm = 0;
    let body = 0;
    for (const v of around) {
      for (const [name, w] of Object.entries(weightsOf(r, v))) {
        if (/^(Shoulder|UpperArm|LowerArm)_L$/.test(name)) arm += w;
        else if (/^(UpperChest|Chest|Spine|Neck)$/.test(name)) body += w;
        else throw new Error(`肩头的顶点 ${v} 不该跟着 ${name}`);
      }
    }
    expect(arm / around.length).toBeGreaterThan(0.3);
    expect(body / around.length).toBeGreaterThan(0.05);
  });

  it('转动一根骨骼：它带的顶点跟着走，别处不动', () => {
    // 把左上臂绕肩关节往前抬 90°，用线性混合蒙皮算出新位置
    const upper = r.skeleton.bones.findIndex((b) => b.name === 'UpperArm_L');
    const follows = new Set<number>([upper]);
    r.skeleton.bones.forEach((b, i) => {
      if (follows.has(b.parent)) follows.add(i);
    });
    const pivot = r.skeleton.bones[upper].head;
    const turn = quatEuler(-Math.PI / 2, 0, 0);
    const moved = (v: number): number => {
      const p: V3 = [r.positions[v * 3], r.positions[v * 3 + 1], r.positions[v * 3 + 2]];
      const local: V3 = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
      const q = rotate(turn, local);
      let share = 0;
      for (let k = 0; k < 4; k++) if (follows.has(r.skin.joints[v * 4 + k])) share += r.skin.weights[v * 4 + k];
      return share * Math.hypot(q[0] - local[0], q[1] - local[1], q[2] - local[2]);
    };
    const hand = verticesNear(r, boneOf(r.skeleton, 'Hand_L').tail, 0.04);
    for (const v of hand) expect(moved(v), `手上的顶点 ${v}`).toBeGreaterThan(0.5);
    // 右手、腿、头一点都不动
    for (const name of ['Hand_R', 'Foot_L', 'Head']) {
      for (const v of verticesNear(r, boneOf(r.skeleton, name).tail, 0.04)) expect(moved(v), `${name} 附近的顶点 ${v}`).toBe(0);
    }
  });

  it('两排手臂：第二排的手只跟第二排的骨骼', () => {
    const two = rig(make({ armPairs: 2 }));
    const tips = verticesNear(two, boneOf(two.skeleton, 'Hand_L.002').tail, 0.05);
    expect(tips.length).toBeGreaterThan(10);
    for (const v of tips) {
      for (const name of Object.keys(weightsOf(two, v))) expect(name, `顶点 ${v}`).toMatch(/_L\.002$/);
    }
    // 第二排的肩头过渡到的是它自己那节胸腔
    const around = verticesNear(two, boneOf(two.skeleton, 'UpperArm_L.002').head, 0.07);
    const seen = new Set(around.flatMap((v) => Object.keys(weightsOf(two, v))));
    expect(seen.has('Chest.002')).toBe(true);
    expect(seen.has('Hand_L')).toBe(false);
  });

  it('没有骨骼的部件跟着父部件：胸跟躯干的脊柱，角跟头', () => {
    const horned = rig(make({ hornsPerHead: 2 }));
    const figure = { parts: buildFigure(make({ hornsPerHead: 2 })).parts, scale: 1 };
    const horn = figure.parts.find((p) => p.name === 'Head_01_Horn_01_L')!;
    const head = figure.parts.find((p) => p.name === 'Head_01')!;
    const torso = figure.parts.find((p) => p.name === 'Torso')!;
    const tube = horn.prims[0];
    if (tube.kind !== 'tube') throw new Error('角应该是一根管');
    // 角尖在世界里的位置：躯干 → 头 → 角（头有缩放，没有转动）
    const s = head.scale ?? 1;
    const tipLocal = tube.points[tube.points.length - 1];
    const tip = [0, 1, 2].map((i) => torso.pos[i] + head.pos[i] + (horn.pos[i] + tipLocal[i]) * s);
    const at = verticesNear(horned, tip, 0.03);
    expect(at.length).toBeGreaterThan(2);
    for (const v of at) expect(weightsOf(horned, v).Head, `角尖的顶点 ${v}`).toBeGreaterThan(0.99);

    const chest = figure.parts.find((p) => p.name === 'Chest_01_L')!;
    const front = [torso.pos[0] + chest.pos[0], torso.pos[1] + chest.pos[1], torso.pos[2] + chest.pos[2] + 0.05];
    const breast = verticesNear(horned, front, 0.03);
    expect(breast.length).toBeGreaterThan(3);
    for (const v of breast) {
      for (const name of Object.keys(weightsOf(horned, v))) expect(name, `胸上的顶点 ${v}`).toMatch(/^(UpperChest|Chest|Spine|Hips)$/);
    }
  });

  it('挨得近、表面并不连着的部件互不相干：两条腿之间、垂在胯旁边的手臂和腿之间都不带对方的权重', () => {
    // 手臂上下排：每条胳膊、每条腿都是各管各的
    const stack = rig(make({ armPairs: 2 }), VOXEL.preview);
    expect(crossTalk(stack.skeleton, stack.skin)).toEqual({});
    // 肩部聚拢：同一个肩膀上的几条手臂根部融成了一片，那里互相过渡；手臂和腿、腿和腿还是不相干
    const fan = rig(make({ armPairs: 3 }, { armLayout: 'fan' }), VOXEL.preview);
    const mixed = crossTalk(fan.skeleton, fan.skin);
    expect(Object.keys(mixed)).toEqual(['arm']);
  }, 30_000);

  it('两条腿中间那一道跟着胯，不跟着哪条腿：左腿抬起来，右腿上没有一个顶点跟着动', () => {
    const two = rig(make({ armPairs: 2 }), VOXEL.preview);
    const index = (name: string) => two.skeleton.bones.findIndex((b) => b.name === name);
    const left = new Set<number>();
    two.skeleton.bones.forEach((b, i) => {
      if (limbOf(b.name) === 'legL') left.add(i);
    });
    const hips = index('Hips');
    const knee = boneOf(two.skeleton, 'LowerLeg_R').head;
    let seam = 0;
    for (let v = 0; v < two.positions.length / 3; v++) {
      const x = two.positions[v * 3];
      const y = two.positions[v * 3 + 1];
      let onLeft = 0;
      let onHips = 0;
      for (let k = 0; k < 4; k++) {
        if (left.has(two.skin.joints[v * 4 + k])) onLeft += two.skin.weights[v * 4 + k];
        if (two.skin.joints[v * 4 + k] === hips) onHips += two.skin.weights[v * 4 + k];
      }
      // 右边的小腿、右脚：离左腿再近也不跟它
      if (x < -0.01 && y < knee[1]) expect(onLeft, `顶点 ${v}`).toBe(0);
      // 正中间那一道
      if (Math.abs(x) < 0.006 && y < boneOf(two.skeleton, 'UpperLeg_L').head[1] - 0.03 && y > knee[1]) {
        seam++;
        expect(onHips, `顶点 ${v}`).toBeGreaterThan(0.5);
      }
    }
    expect(seam).toBeGreaterThan(5);
  }, 30_000);

  it('权重是连续的：沿着表面一小步一小步走过去，哪根骨骼的权重都不会突然多一截、少一截', () => {
    // 相邻两个顶点的权重要是差一截，摆姿势时那里就裂一道缝。
    // 在网格上找几条穿过交界处的路（一个顶点接一个顶点），路上每 0.1 mm 取一个点
    for (const armLayout of ['stack', 'fan'] as const) {
      const spec = make({ armPairs: 3 }, { armLayout });
      const figure = { parts: buildFigure(spec).parts, scale: 1 };
      const one = rig(spec);
      const count = one.positions.length / 3;
      const at = (v: number): V3 => [one.positions[v * 3], one.positions[v * 3 + 1], one.positions[v * 3 + 2]];
      const gap = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const next: number[][] = Array.from({ length: count }, () => []);
      for (let t = 0; t < one.triangles.length; t += 3) {
        for (let e = 0; e < 3; e++) next[one.triangles[t + e]].push(one.triangles[t + ((e + 1) % 3)]);
      }
      const nearest = (p: readonly number[]) => {
        let best = 0;
        for (let v = 1; v < count; v++) if (gap(at(v), p) < gap(at(best), p)) best = v;
        return best;
      };
      /** 从离 a 最近的顶点出发，每次挪到离 b 更近的邻居，直到挪不动 */
      const walk = (a: readonly number[], b: readonly number[]) => {
        const path = [nearest(a)];
        for (;;) {
          const here = path[path.length - 1];
          let best = here;
          for (const v of next[here]) if (gap(at(v), b) < gap(at(best), b)) best = v;
          if (best === here) return path;
          path.push(best);
        }
      };
      const hip = boneOf(one.skeleton, 'UpperLeg_L').head;
      const knee = boneOf(one.skeleton, 'LowerLeg_L').head;
      const ankle = boneOf(one.skeleton, 'Foot_L').head;
      const shoulder = boneOf(one.skeleton, 'UpperArm_L').head;
      const elbow = boneOf(one.skeleton, 'LowerArm_L').head;
      const neck = boneOf(one.skeleton, 'Neck').head;
      const routes: [string, readonly number[], readonly number[]][] = [
        ['肚子到大腿前面', [hip[0], hip[1] + 0.25, 0.2], [knee[0], knee[1], 0.2]],
        ['两腿之间往下', [0, hip[1] - 0.08, 0], [ankle[0] - 0.05, ankle[1], ankle[2]]],
        ['脖子到手肘', [neck[0] + 0.03, neck[1], neck[2]], [elbow[0] + 0.03, elbow[1], elbow[2]]],
        ['后背到手肘', [0, shoulder[1], -0.2], [elbow[0], elbow[1], elbow[2] - 0.05]],
        ['腋下到胯', [shoulder[0] - 0.02, shoulder[1] - 0.1, 0], [hip[0] + 0.15, hip[1] - 0.1, 0]],
      ];
      for (const [label, a, b] of routes) {
        const path = walk(a, b);
        expect(path.length, `${armLayout} ${label}`).toBeGreaterThan(8);
        const points: number[] = [];
        for (let i = 1; i < path.length; i++) {
          const p = at(path[i - 1]);
          const q = at(path[i]);
          const steps = Math.max(1, Math.round(gap(p, q) / 0.0001));
          for (let k = 0; k < steps; k++) points.push(p[0] + ((q[0] - p[0]) * k) / steps, p[1] + ((q[1] - p[1]) * k) / steps, p[2] + ((q[2] - p[2]) * k) / steps);
        }
        const skin = skinVertices(figure, one.skeleton, points);
        const row = (i: number) => {
          const out = new Map<number, number>();
          for (let k = 0; k < 4; k++) if (skin.weights[i * 4 + k]) out.set(skin.joints[i * 4 + k], skin.weights[i * 4 + k]);
          return out;
        };
        let worst = 0;
        let before = row(0);
        for (let i = 1; i < points.length / 3; i++) {
          const now = row(i);
          for (const [bone, w] of now) worst = Math.max(worst, Math.abs(w - (before.get(bone) ?? 0)));
          for (const [bone, w] of before) if (!now.has(bone)) worst = Math.max(worst, w);
          before = now;
        }
        expect(worst, `${armLayout} ${label}`).toBeLessThan(0.012);
      }
    }
  }, 60_000);

  it('分部件：一个部件自己的网格不跟不相干的部件走；手的网格用手自己带的权重', () => {
    const spec = make({ armPairs: 2 });
    const figure = { parts: buildFigure(spec).parts, scale: 1 };
    const skeleton = buildSkeleton(figure);
    // 大腿外侧表面上的一点：说它是手臂的网格上的顶点（手垂下来插进了大腿），它就只跟手臂、躯干；说它是腿上的，才跟腿
    const thigh = boneOf(skeleton, 'UpperLeg_L');
    const p = [thigh.head[0] + 0.07, (thigh.head[1] + thigh.tail[1]) / 2, thigh.head[2]];
    const both = Float32Array.from([...p, ...p]);
    const meshes = [
      { name: 'Arm_02_L', positions: p },
      { name: 'Leg_01_L', positions: p },
    ];
    const skin = skinVertices(figure, skeleton, both, undefined, meshes);
    const namesAt = (v: number) => [0, 1, 2, 3].filter((k) => skin.weights[v * 4 + k] > 0).map((k) => skeleton.bones[skin.joints[v * 4 + k]].name);
    for (const name of namesAt(0)) expect(limbOf(name) ?? 'arm' + 'L.002', name).toBe('armL.002');
    expect(namesAt(0).some((name) => limbOf(name) === 'armL.002')).toBe(true);
    expect(namesAt(1)).toEqual(['UpperLeg_L']);
    // 不说是哪张网格上的：就近，跟腿
    expect(skeleton.bones[skinVertices(figure, skeleton, p).joints[0]].name).toBe('UpperLeg_L');

    // 手：部件的网格最后那一段是接上去的手，权重换成手自己带的
    const hand = handMesh();
    const each = hand.positions.length / 3;
    const points = graftPoints(figure.parts);
    const arms = figure.parts.filter((part) => part.grafts?.length);
    expect(points.length).toBe(arms.length * each * 3);
    const lead = [0, 0, 0, 0, 0, 0];
    const parts = arms.map((part, i) => ({ name: part.name, positions: [...lead, ...points.subarray(i * each * 3, (i + 1) * each * 3)] }));
    const all = Float32Array.from(parts.flatMap((part) => part.positions));
    const bound = bindPartGrafts(skinVertices(figure, skeleton, all, undefined, parts), figure, skeleton, parts);
    let first = 0;
    for (const part of arms) {
      const tag = part.name.endsWith('_L') ? 'L' : 'R';
      const order = part.name.slice(4, 6) === '01' ? '' : '.002';
      for (let i = 0; i < each; i++) {
        const v = first + 2 + i;
        for (let k = 0; k < 4; k++) {
          const w = hand.weights[i * 4 + k];
          expect(bound.weights[v * 4 + k]).toBeCloseTo(w, 6);
          if (w > 0) expect(skeleton.bones[bound.joints[v * 4 + k]].name).toBe(`${hand.bones[hand.joints[i * 4 + k]]}_${tag}${order}`);
        }
      }
      first += 2 + each;
    }
  });

  it('人马、蛛形、九尾六翼：权重都合法，每根骨骼都用上了', () => {
    for (const spec of [
      make({ legs: 4, tails: 1 }),
      make({ legs: 8 }),
      make({ tails: 9, wingPairs: 3, earPairsPerHead: 1 }),
      make({ heads: 3, armPairs: 3 }, { armLayout: 'fan' }),
    ]) {
      const one = rig(spec);
      const label = JSON.stringify(spec.counts);
      const used = new Set<number>();
      for (let v = 0; v < one.positions.length / 3; v++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          const w = one.skin.weights[v * 4 + k];
          sum += w;
          if (w > 0.2) used.add(one.skin.joints[v * 4 + k]);
        }
        if (Math.abs(sum - 1) > 1e-5) throw new Error(`${label}：顶点 ${v} 的权重加起来是 ${sum}`);
      }
      expect(one.skeleton.bones.filter((_, i) => !used.has(i)).map((b) => b.name), label).toEqual([]);
    }
  }, 30_000);
});

describe('自动蒙皮拆成几步、按顶点分几段算（别的线程帮着算时就是这样）', () => {
  /** 第 1 步、第 3 步各分成 count 段，每段各自准备一份（像别的线程那样），再接起来 */
  function split(
    figure: Pick<Figure, 'parts' | 'scale'>,
    skeleton: Skeleton,
    positions: Float32Array,
    triangles: ArrayLike<number>,
    count: number,
    meshes?: { name: string; positions: Float32Array }[],
  ) {
    const plan = planSkin(figure, skeleton, positions, triangles, meshes);
    const cut = Array.from({ length: count + 1 }, (_, i) => Math.round((plan.count * i) / count));
    const own = () => planSkin(figure, skeleton, positions, undefined, meshes);
    const near = joinNear(plan, cut.slice(0, count).map((from, i) => nearParts(own(), from, cut[i + 1])));
    const gate = gateNear(plan, near);
    const joints = new Uint16Array(plan.count * 4);
    const weights = new Float32Array(plan.count * 4);
    for (let i = 0; i < count; i++) {
      const [from, to] = [cut[i], cut[i + 1]];
      const j = new Uint16Array((to - from) * 4);
      const w = new Float32Array((to - from) * 4);
      weighVertices(own(), near, gate, from, to, j, w);
      joints.set(j, from * 4);
      weights.set(w, from * 4);
    }
    return finishSkin(plan, joints, weights);
  }

  it('融合模式：分 1、3、7 段算，和一口气算的逐个数一样', () => {
    for (const spec of [make({ armPairs: 3 }, { armLayout: 'fan' }), make({ heads: 2, tails: 3, wingPairs: 1 }), make({ legs: 4 }, { legLayout: 'taur' })]) {
      const figure = { parts: buildFigure(spec).parts, scale: 1 };
      const mesh = fuseParts(figure.parts, { voxel: VOXEL.draft, blend: spec.blend });
      const skeleton = buildSkeleton(figure);
      const whole = skinVertices(figure, skeleton, mesh.positions, mesh.triangles);
      for (const count of [1, 3, 7]) {
        const parts = split(figure, skeleton, mesh.positions, mesh.triangles, count);
        expect(parts.joints, `${JSON.stringify(spec.counts)} ${count} 段`).toEqual(whole.joints);
        expect(parts.weights, `${JSON.stringify(spec.counts)} ${count} 段`).toEqual(whole.weights);
      }
    }
  }, 60_000);

  it('分部件模式（每个部件一张网格接起来，关节上的球）：分 4 段算，和一口气算的逐个数一样', () => {
    const spec = make({ armPairs: 2, tails: 1 });
    const figure = { parts: buildFigure(spec).parts.filter((part) => part.material !== 'eye'), scale: 1 };
    const skeleton = buildSkeleton(figure);
    const meshes: { name: string; positions: Float32Array }[] = [];
    const triangles: number[] = [];
    let at = 0;
    for (const part of figure.parts) {
      const geo = buildPartGeometry(part);
      const pos = Float32Array.from(geo.getAttribute('position').array as Float32Array);
      meshes.push({ name: part.name, positions: pos });
      const index = geo.getIndex()!;
      for (let i = 0; i < index.count; i++) triangles.push(index.getX(i) + at);
      at += pos.length / 3;
    }
    const positions = new Float32Array(at * 3);
    let o = 0;
    for (const mesh of meshes) {
      positions.set(mesh.positions, o);
      o += mesh.positions.length;
    }
    const whole = skinVertices(figure, skeleton, positions, triangles, meshes);
    const parts = split(figure, skeleton, positions, triangles, 4, meshes);
    expect(parts.joints).toEqual(whole.joints);
    expect(parts.weights).toEqual(whole.weights);
  }, 60_000);
});
