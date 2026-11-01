import { describe, expect, it } from 'vitest';
import { type Figure, type Part, type Prim, worldTransforms } from '../src/geometry/figure';
import { HEAD_HALF_HEIGHT, HEAD_HALF_WIDTH } from '../src/geometry/head';
import { buildFigure } from '../src/geometry/layout';
import { ringAt, smoothRings } from '../src/geometry/torso';
import { quatBetween, quatEuler, quatMul, rotate } from '../src/geometry/vec';
import { PRESETS, applyPreset } from '../src/model/presets';
import {
  type BodyCounts,
  type BodyShape,
  type BodySpec,
  COUNT_DEFS,
  LEG_LAYOUTS,
  SHAPE_DEFS,
  clampShape,
  defaultSpec,
  legPlan,
} from '../src/model/spec';
import { castRay, compileField, fieldAt } from '../src/sdf/field';
import { rng } from './helpers';

type PartialShape = Partial<BodyShape>;

function make(counts: Partial<BodyCounts> = {}, rest: Partial<BodySpec> = {}, shape: PartialShape = {}): BodySpec {
  const base = defaultSpec();
  return { ...base, ...rest, counts: { ...base.counts, ...counts }, shape: clampShape({ ...base.shape, ...shape }) };
}

const figure = (counts: Partial<BodyCounts> = {}, rest: Partial<BodySpec> = {}, shape: PartialShape = {}) =>
  buildFigure(make(counts, rest, shape));

const ofType = (f: Figure, type: Part['type']) => f.parts.filter((p) => p.type === type);
const names = (f: Figure, type: Part['type']) => ofType(f, type).map((p) => p.name);
const part = (f: Figure, name: string) => {
  const p = f.parts.find((q) => q.name === name);
  if (!p) throw new Error(`没有部件 ${name}`);
  return p;
};

/** 部件里所有的数字，用来查 NaN */
function numbers(p: Prim): number[] {
  switch (p.kind) {
    case 'ellipsoid':
      return [...p.center, ...p.radii, ...(p.quat ?? []), p.soft ?? 0];
    case 'cone':
      return [...p.a, ...p.b, p.ra, p.rb, p.soft ?? 0];
    case 'tube':
      return [...p.points.flat(), p.r0, p.r1, p.bulge];
    case 'loft':
      return p.rings.flatMap((r) => [r.y, r.w, r.d, r.z]);
    case 'wing':
      return [p.size, p.thickness];
    case 'grid':
      return p.stretchY ?? [];
    case 'chest':
      return [...p.origin, p.size, p.lift ?? 0, ...(p.shift ?? []), ...(p.scale ?? []), ...(p.tilt ?? [])];
  }
}

function expectSound(f: Figure) {
  const seen = new Set<string>();
  for (const p of f.parts) {
    expect(seen.has(p.name), `部件名重复：${p.name}`).toBe(false);
    if (p.parent) expect(seen.has(p.parent), `${p.name} 的父部件要排在它前面`).toBe(true);
    seen.add(p.name);
    const nums = [...p.pos, ...p.quat, p.scale ?? 1, ...(p.stretch ?? []), ...p.prims.flatMap(numbers)];
    expect(nums.every(Number.isFinite), `${p.name} 里有非法数字`).toBe(true);
    expect(p.prims.length).toBeGreaterThan(0);
  }
  expect(Number.isFinite(f.metrics.height)).toBe(true);
  expect(f.scale).toBeGreaterThan(0.5);
  // 腿缩短以后身高还是设定的那么高：整个人放大一些
  expect(f.scale).toBeLessThan(2);
}

/** 部件在世界里的位置（米） */
const worldPos = (f: Figure, name: string) => worldTransforms(f).get(name)!.pos;

/** 每个 _L 部件都有一个镜像的 _R，整个人左右对称 */
function expectMirrored(f: Figure) {
  const world = worldTransforms(f);
  const heads = f.parts.filter((q) => q.type === 'head').length;
  /** 一个头上几张脸：多出来的脸是正面那个头的子部件 */
  const faces = f.parts.some((q) => q.type === 'head' && q.parent?.startsWith('Head_'));
  /** 第 k 个头（从 1 数）对面的那个是第几个 */
  const across = (k: number) => {
    if (!faces) return heads + 1 - k;
    // 正前、正后的脸自己和自己对称；朝两边的是一左一右挨着编号的（2 和 3、4 和 5）
    if (k === 1 || (heads % 2 === 0 && k === heads)) return k;
    return k % 2 ? k - 1 : k + 1;
  };
  /**
   * 镜像的那个部件叫什么。多个头时头是歪着、转着的，紧挨着别的头的那一侧角和耳朵还收拢着长：
   * 第 k 个头左边的部件，和对面那个头右边的部件才是一对
   */
  const twinName = (name: string) => {
    const twin = `${name.slice(0, -2)}_R`;
    const onHead = /^Head_(\d+)_/.exec(twin);
    return onHead ? twin.replace(/^Head_\d+/, `Head_${String(across(Number(onHead[1]))).padStart(2, '0')}`) : twin;
  };
  // 横排多胯：每副胯上的两条腿是这副胯自己的左右（见 abreast.test.ts），不和中线另一边的对；几条腿整体左右对称
  const abreast = f.metrics.legForm === 'abreast';
  if (abreast) {
    const xs = f.parts.filter((q) => q.type === 'leg').map((q) => q.pos[0]).sort((a, b) => a - b);
    xs.forEach((x, k) => expect(x).toBeCloseTo(-xs[xs.length - 1 - k], 9));
  }
  for (const p of f.parts) {
    if (!p.name.endsWith('_L') || (abreast && p.type === 'leg')) continue;
    expect(p.side).toBe(1);
    const twin = f.parts.find((q) => q.name === twinName(p.name));
    expect(twin, `${p.name} 没有对应的 _R`).toBeDefined();
    expect(twin!.side).toBe(-1);
    expect(twin!.pos[0]).toBeCloseTo(-p.pos[0], 9);
    expect(twin!.pos[1]).toBeCloseTo(p.pos[1], 9);
    expect(twin!.pos[2]).toBeCloseTo(p.pos[2], 9);
    const a = world.get(p.name)!.pos;
    const b = world.get(twin!.name)!.pos;
    expect(b[0]).toBeCloseTo(-a[0], 9);
    expect(b[1]).toBeCloseTo(a[1], 9);
    expect(b[2]).toBeCloseTo(a[2], 9);
    if (heads === 1) expect(a[0]).toBeGreaterThan(0);
  }
}

describe('向量工具', () => {
  it('quatBetween 把一个方向转到另一个方向', () => {
    const to: [number, number, number] = [0.6, 0, 0.8];
    const r = rotate(quatBetween([0, 1, 0], to), [0, 1, 0]);
    r.forEach((v, i) => expect(v).toBeCloseTo(to[i], 12));
    const flip = rotate(quatBetween([0, 1, 0], [0, -1, 0]), [0, 1, 0]);
    expect(flip[1]).toBeCloseTo(-1, 12);
  });

  it('quatEuler 的顺序和 three.js 一样：先绕 Z，再绕 Y，再绕 X', () => {
    const r = rotate(quatEuler(0, Math.PI / 2, 0), [1, 0, 0]);
    expect(r[0]).toBeCloseTo(0, 12);
    expect(r[2]).toBeCloseTo(-1, 12);
    const q = quatMul(quatEuler(0.3, 0, 0), quatMul(quatEuler(0, 0.5, 0), quatEuler(0, 0, 0.7)));
    quatEuler(0.3, 0.5, 0.7).forEach((v, i) => expect(v).toBeCloseTo(q[i], 12));
  });
});

describe('躯干截面', () => {
  const rings = smoothRings([
    { y: 0, w: 0.1, d: 0.1, z: 0 },
    { y: 0.1, w: 0.2, d: 0.1, z: 0 },
    { y: 0.3, w: 0.1, d: 0.1, z: 0.02 },
  ]);

  it('加密后高度严格递增，首尾是原来的关键截面', () => {
    for (let i = 1; i < rings.length; i++) expect(rings[i].y).toBeGreaterThan(rings[i - 1].y);
    expect(rings[0]).toEqual({ y: 0, w: 0.1, d: 0.1, z: 0 });
    expect(rings[rings.length - 1]).toEqual({ y: 0.3, w: 0.1, d: 0.1, z: 0.02 });
    expect(rings.length).toBeGreaterThan(20);
  });

  it('ringAt 按高度查截面，超出两端取端点', () => {
    expect(ringAt(rings, 0.1).w).toBeCloseTo(0.2, 6);
    expect(ringAt(rings, -1)).toBe(rings[0]);
    expect(ringAt(rings, 9)).toBe(rings[rings.length - 1]);
  });
});

describe('标准人形', () => {
  const f = figure();

  it('身高和头身比正好是设定值', () => {
    expect(f.metrics.height).toBeCloseTo(1.62, 9);
    expect(f.metrics.headRatio).toBeCloseTo(7.5, 9);
    expect(f.metrics.legForm).toBe('biped');
  });

  it('部件齐全：躯干、脖子、头、两只眼睛、一对手臂、一对胸、一对腿', () => {
    expect(f.parts.map((p) => p.name)).toEqual([
      'Torso',
      'Neck_01',
      'Head_01',
      'Head_01_Eye_01_L',
      'Head_01_Eye_01_R',
      'Arm_01_L',
      'Arm_01_R',
      'Chest_01_L',
      'Chest_01_R',
      'Leg_01_L',
      'Leg_01_R',
    ]);
    expectSound(f);
    expectMirrored(f);
  });

  it('_L 在角色自己的左手边（+X），脸朝 +Z，脚踩在地面上', () => {
    const world = worldTransforms(f);
    expect(world.get('Arm_01_L')!.pos[0]).toBeGreaterThan(0);
    expect(world.get('Head_01_Eye_01_L')!.pos[0]).toBeGreaterThan(0);
    expect(world.get('Head_01_Eye_01_L')!.pos[2]).toBeGreaterThan(world.get('Head_01')!.pos[2]);
    expect(world.get('Chest_01_L')!.pos[2]).toBeGreaterThan(0);
    const foot = part(f, 'Leg_01_L').prims.find((p) => p.name === 'Foot');
    if (foot?.kind !== 'ellipsoid') throw new Error('没有脚');
    const leg = world.get('Leg_01_L')!;
    expect(leg.pos[1] + (foot.center[1] - foot.radii[1]) * leg.scale).toBeCloseTo(0, 9);
  });

  it('头顶的高度就是身高，下巴到头顶就是头高', () => {
    const head = worldTransforms(f).get('Head_01')!;
    expect(head.pos[1] + HEAD_HALF_HEIGHT * head.scale).toBeCloseTo(f.metrics.height, 9);
    expect(2 * HEAD_HALF_HEIGHT * head.scale).toBeCloseTo(f.metrics.headHeight, 9);
    // 头的体块真的顶到头顶、落到下巴
    const prims = part(f, 'Head_01').prims;
    const cranium = prims.find((p) => p.name === 'Cranium');
    const jaw = prims.find((p) => p.name === 'Jaw');
    if (cranium?.kind !== 'ellipsoid' || jaw?.kind !== 'cone') throw new Error('头缺了颅骨或下颌');
    expect(cranium.center[1] + cranium.radii[1]).toBeCloseTo(HEAD_HALF_HEIGHT, 9);
    expect(jaw.b[1] - jaw.rb).toBeCloseTo(-HEAD_HALF_HEIGHT, 9);
  });

  it('头有颅骨、下颌、鼻子，每只眼睛的位置挖了眼窝；没有兽耳时有人耳', () => {
    const names = (g: Figure) => part(g, 'Head_01').prims.map((p) => p.name);
    expect(names(f)).toEqual(['Cranium', 'Jaw', 'Nose', 'Ear_L', 'Ear_R', 'Socket_01_L', 'Socket_01_R']);
    expect(names(figure({ eyesPerHead: 3, earPairsPerHead: 1 }))).toEqual([
      'Cranium',
      'Jaw',
      'Nose',
      'Socket_01_L',
      'Socket_01_R',
      'Socket_C',
    ]);
    const sockets = part(f, 'Head_01').prims.filter((p) => p.name.startsWith('Socket'));
    for (const s of sockets) expect(s.kind === 'ellipsoid' && s.cut).toBe(true);
  });

  it('眼睛贴在脸的表面上，眼窝就在眼睛的位置', () => {
    const head = part(f, 'Head_01');
    const field = compileField({ scale: 1, parts: [{ ...head, parent: undefined, pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: 1 }] }, { blend: 0 });
    for (const tag of ['01_L', '01_R']) {
      const eye = part(f, `Head_01_Eye_${tag}`);
      const socket = head.prims.find((p) => p.name === `Socket_${tag}`);
      if (socket?.kind !== 'ellipsoid') throw new Error('没有眼窝');
      expect(socket.center[0]).toBeCloseTo(eye.pos[0], 9);
      expect(socket.center[1]).toBeCloseTo(eye.pos[1], 9);
      // 眼睛的中心在挖过眼窝的脸皮附近（差不到 1 cm），不是悬在空中或埋在头里
      expect(Math.abs(fieldAt(field, eye.pos[0], eye.pos[1], eye.pos[2]))).toBeLessThan(0.01);
      expect(eye.pos[2]).toBeGreaterThan(0.05);
    }
  });

  it('身高滑块整体等比缩放，头身比不变；部件数据原样不动（所以不用重建网格）', () => {
    const tall = figure({}, {}, { height: 1.8 });
    expect(tall.metrics.height).toBeCloseTo(1.8, 9);
    expect(tall.metrics.headRatio).toBeCloseTo(7.5, 9);
    expect(tall.scale).toBeCloseTo((f.scale * 1.8) / 1.62, 9);
    expect(tall.parts).toEqual(f.parts);
    expect(worldPos(tall, 'Leg_01_L')[1]).toBeCloseTo((worldPos(f, 'Leg_01_L')[1] * 1.8) / 1.62, 9);
  });

  it('头身比只改头的大小，身高不变；头以外的部件形状不动', () => {
    for (const ratio of [6, 7, 8, 9]) {
      const g = figure({}, {}, { headRatio: ratio });
      expect(g.metrics.height).toBeCloseTo(1.62, 9);
      expect(g.metrics.headRatio).toBeCloseTo(ratio, 9);
      expect(g.metrics.headHeight).toBeCloseTo(1.62 / ratio, 9);
      for (const name of ['Torso', 'Arm_01_L', 'Leg_01_R', 'Head_01_Eye_01_L']) {
        expect(part(g, name).prims, name).toEqual(part(f, name).prims);
      }
    }
    expect(part(figure({}, {}, { headRatio: 6 }), 'Head_01').scale).toBeGreaterThan(
      part(figure({}, {}, { headRatio: 9 }), 'Head_01').scale!,
    );
  });
});

describe('男女体型', () => {
  const female = figure();
  const male = figure({}, { gender: 'male' });
  const torso = (f: Figure) => {
    const loft = part(f, 'Torso').prims[0];
    if (loft.kind !== 'loft') throw new Error('躯干不是放样面');
    return (y: number) => ringAt(loft.rings, y);
  };

  it('男性肩更宽、腰更粗、胯更窄；身高和头身比不变', () => {
    const f = torso(female);
    const m = torso(male);
    expect(m(1.42).w).toBeGreaterThan(f(1.42).w + 0.02);
    expect(m(1.115).w).toBeGreaterThan(f(1.115).w + 0.015);
    expect(m(0.935).w).toBeLessThan(f(0.935).w - 0.01);
    expect(male.metrics.height).toBeCloseTo(female.metrics.height, 9);
    expect(male.metrics.headRatio).toBeCloseTo(female.metrics.headRatio, 9);
  });

  it('女性腰比胯细得多，男性肩比胯宽', () => {
    const f = torso(female);
    const m = torso(male);
    expect(f(1.115).w / f(0.935).w).toBeLessThan(0.7);
    expect(m(1.42).w / m(0.935).w).toBeGreaterThan(1.2);
    expect(f(1.42).w / f(0.935).w).toBeLessThan(1);
  });

  it('男性的手臂、腿、脖子更粗，下巴更方，胸是扁平的胸肌', () => {
    const cone = (f: Figure, partName: string, primName: string) => {
      const p = part(f, partName).prims.find((q) => q.name === primName);
      if (p?.kind !== 'cone') throw new Error(`${partName} 没有 ${primName}`);
      return p;
    };
    expect(cone(male, 'Arm_01_L', 'UpperArm').ra).toBeGreaterThan(cone(female, 'Arm_01_L', 'UpperArm').ra * 1.1);
    expect(cone(male, 'Leg_01_L', 'Thigh').ra).toBeGreaterThan(cone(female, 'Leg_01_L', 'Thigh').ra);
    expect(cone(male, 'Neck_01', 'Neck').ra).toBeGreaterThan(cone(female, 'Neck_01', 'Neck').ra);
    expect(cone(male, 'Head_01', 'Jaw').rb).toBeGreaterThan(cone(female, 'Head_01', 'Jaw').rb);
    // 下巴尖仍然落在头的最低点
    expect(cone(male, 'Head_01', 'Jaw').b[1] - cone(male, 'Head_01', 'Jaw').rb).toBeCloseTo(-HEAD_HALF_HEIGHT, 9);
    const breast = (f: Figure) => {
      const p = part(f, 'Chest_01_L').prims[0];
      if (p.kind !== 'ellipsoid') throw new Error('胸不是椭球');
      return p.radii;
    };
    expect(breast(female)[2] / breast(female)[0]).toBeGreaterThan(0.85);
    expect(breast(male)[2] / breast(male)[0]).toBeLessThan(0.4);
  });

  it('男女的部件清单一样，都左右对称', () => {
    expect(male.parts.map((p) => p.name)).toEqual(female.parts.map((p) => p.name));
    expectSound(male);
    expectMirrored(male);
  });
});

describe('姿势', () => {
  const arm = (f: Figure, name: string) => {
    const get = (prim: string) => {
      const p = part(f, name).prims.find((q) => q.name === prim);
      if (p?.kind !== 'cone') throw new Error(`${name} 没有 ${prim}`);
      return p;
    };
    return { upper: get('UpperArm'), fore: get('Forearm') };
  };

  it('A-pose：手臂斜向下垂，前臂略微向前弯', () => {
    const { upper, fore } = arm(figure(), 'Arm_01_L');
    expect(upper.b[0]).toBeGreaterThan(0.15);
    expect(upper.b[1]).toBeLessThan(-0.15);
    expect(fore.b[2]).toBeGreaterThan(fore.a[2] + 0.03);
  });

  it('T-pose：手臂向两侧水平伸直，肩、肘、腕在一条直线上', () => {
    const f = figure({}, { pose: 'T' });
    for (const [name, side] of [['Arm_01_L', 1], ['Arm_01_R', -1]] as const) {
      const { upper, fore } = arm(f, name);
      expect(upper.b[1]).toBeCloseTo(0, 9);
      expect(upper.b[2]).toBeCloseTo(0, 9);
      expect(fore.b[1]).toBeCloseTo(0, 9);
      expect(fore.b[2]).toBeCloseTo(0, 9);
      expect(fore.b[0] * side).toBeCloseTo(0.53, 9);
    }
    expectSound(f);
    expectMirrored(f);
  });

  it('T-pose 时手掌朝下：手的厚度方向是竖直的，拇指在前面', () => {
    // 并指的手套形是用几块基本体拼的；分指的手是接上去的现成网格，另外测（graft.test.ts）
    const f = figure({}, { pose: 'T', hands: 'mitten' });
    const prims = part(f, 'Arm_01_L').prims;
    const palms = prims.filter((p) => p.name.startsWith('Palm'));
    const thumb = prims.find((p) => p.name === 'Thumb');
    if (thumb?.kind !== 'cone') throw new Error('没有拇指');
    for (const p of palms) {
      if (p.kind !== 'cone') throw new Error('手掌不是圆棒');
      expect(p.a[1]).toBeCloseTo(0, 9);
      expect(p.b[1]).toBeCloseTo(0, 9);
    }
    // 三根圆棒在前后方向排开
    const zs = palms.map((p) => (p.kind === 'cone' ? p.a[2] : 0));
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.03);
    expect(thumb.b[2]).toBeGreaterThan(0.05);
    // 拇指略微朝手心（朝下）弯
    expect(thumb.b[1]).toBeLessThan(0);
  });

  it('T-pose 多排手臂：每一排都平举，互相平行', () => {
    const f = figure({ armPairs: 3 }, { pose: 'T' });
    for (const name of ['Arm_01_L', 'Arm_02_L', 'Arm_03_L']) {
      expect(arm(f, name).fore.b[1]).toBeCloseTo(0, 9);
    }
    expect(worldPos(f, 'Arm_01_L')[1]).toBeGreaterThan(worldPos(f, 'Arm_02_L')[1] + 0.1);
  });

  it('姿势不影响腿和身高', () => {
    const a = figure();
    const t = figure({}, { pose: 'T' });
    expect(part(t, 'Leg_01_L')).toEqual(part(a, 'Leg_01_L'));
    expect(part(t, 'Torso')).toEqual(part(a, 'Torso'));
    expect(t.metrics).toEqual(a.metrics);
  });
});

describe('兽耳', () => {
  it('四种耳形长度不同：兔耳最长，猫耳最短', () => {
    const length = (earShape: BodySpec['earShape']) => {
      const t = part(figure({ earPairsPerHead: 1 }, { earShape }), 'Head_01_Ear_01_L').prims[0];
      if (t.kind !== 'tube') throw new Error('耳朵不是管');
      return t.points[t.points.length - 1][1];
    };
    expect(length('rabbit')).toBeGreaterThan(length('elf'));
    expect(length('elf')).toBeGreaterThan(length('fox'));
    expect(length('fox')).toBeGreaterThan(length('cat'));
  });

  it('猫 / 狐 / 兔耳长在头顶，精灵耳长在两侧（人耳的位置）', () => {
    const y = (earShape: BodySpec['earShape']) => part(figure({ earPairsPerHead: 1 }, { earShape }), 'Head_01_Ear_01_L').pos[1];
    expect(y('cat')).toBeGreaterThan(0.07);
    expect(y('rabbit')).toBeGreaterThan(0.07);
    expect(y('elf')).toBeLessThan(0.03);
    const elf = part(figure({ earPairsPerHead: 1 }, { earShape: 'elf' }), 'Head_01_Ear_01_L');
    expect(elf.pos[0]).toBeGreaterThan(0.06);
  });

  it('左右耳的中心线互为镜像，耳朵都是压扁的', () => {
    for (const earShape of ['cat', 'fox', 'rabbit', 'elf'] as const) {
      const f = figure({ earPairsPerHead: 2 }, { earShape });
      for (const pair of ['01', '02']) {
        const l = part(f, `Head_01_Ear_${pair}_L`);
        const r = part(f, `Head_01_Ear_${pair}_R`);
        const lt = l.prims[0];
        const rt = r.prims[0];
        if (lt.kind !== 'tube' || rt.kind !== 'tube') throw new Error('耳朵不是管');
        lt.points.forEach((p, i) => {
          expect(rt.points[i][0]).toBeCloseTo(-p[0], 12);
          expect(rt.points[i][1]).toBeCloseTo(p[1], 12);
          expect(rt.points[i][2]).toBeCloseTo(p[2], 12);
        });
        expect(l.stretch![2]).toBeLessThan(0.7);
      }
    }
  });

  it('有兽耳就没有人耳；精灵耳也顶替人耳', () => {
    const has = (f: Figure) => part(f, 'Head_01').prims.some((p) => p.name === 'Ear_L');
    expect(has(figure())).toBe(true);
    expect(has(figure({ earPairsPerHead: 1 }, { earShape: 'cat' }))).toBe(false);
    expect(has(figure({ earPairsPerHead: 1 }, { earShape: 'elf' }))).toBe(false);
  });
});

describe('部件数量', () => {
  it('每种部件的实例数与设定一致', () => {
    const f = figure({
      heads: 3,
      armPairs: 4,
      chestPairs: 3,
      legs: 8,
      tails: 7,
      wingPairs: 3,
      hornsPerHead: 3,
      eyesPerHead: 5,
      earPairsPerHead: 2,
    });
    expect(ofType(f, 'head')).toHaveLength(3);
    expect(ofType(f, 'neck')).toHaveLength(3);
    expect(ofType(f, 'arm')).toHaveLength(8);
    expect(ofType(f, 'chest')).toHaveLength(6);
    expect(ofType(f, 'leg')).toHaveLength(8);
    expect(ofType(f, 'tail')).toHaveLength(7);
    expect(ofType(f, 'wing')).toHaveLength(6);
    expect(ofType(f, 'horn')).toHaveLength(9);
    expect(ofType(f, 'eye')).toHaveLength(15);
    expect(ofType(f, 'ear')).toHaveLength(12);
    expectSound(f);
    expectMirrored(f);
  });

  it('没有手臂、平胸时就没有对应部件', () => {
    const f = figure({ armPairs: 0, chestPairs: 0 });
    expect(ofType(f, 'arm')).toHaveLength(0);
    expect(ofType(f, 'chest')).toHaveLength(0);
  });

  it('眼睛成对排成行，单数时正中加一只', () => {
    expect(names(figure({ eyesPerHead: 1 }), 'eye')).toEqual(['Head_01_Eye_C']);
    expect(names(figure({ eyesPerHead: 3 }), 'eye')).toEqual(['Head_01_Eye_01_L', 'Head_01_Eye_01_R', 'Head_01_Eye_C']);
    const six = figure({ eyesPerHead: 6 });
    expect(names(six, 'eye')).toHaveLength(6);
    expect(part(six, 'Head_01_Eye_03_L').pos[1]).toBeGreaterThan(part(six, 'Head_01_Eye_01_L').pos[1]);
    const three = figure({ eyesPerHead: 3 });
    expect(part(three, 'Head_01_Eye_C').pos[0]).toBe(0);
    expect(part(three, 'Head_01_Eye_C').pos[1]).toBeGreaterThan(part(three, 'Head_01_Eye_01_L').pos[1]);
  });

  it('角：单数时正中一只，其余成对', () => {
    expect(names(figure({ hornsPerHead: 1 }), 'horn')).toEqual(['Head_01_Horn_C']);
    expect(names(figure({ hornsPerHead: 2 }), 'horn')).toEqual(['Head_01_Horn_01_L', 'Head_01_Horn_01_R']);
    expect(names(figure({ hornsPerHead: 3 }), 'horn')).toHaveLength(3);
  });

  it('眼睛、角、耳朵都挂在各自的头上', () => {
    const f = figure({ heads: 2, hornsPerHead: 2, earPairsPerHead: 1 });
    for (const p of f.parts.filter((q) => ['eye', 'horn', 'ear'].includes(q.type))) {
      expect(p.parent).toMatch(/^Head_0[12]$/);
      expect(p.name.startsWith(`${p.parent}_`)).toBe(true);
    }
  });
});

describe('手臂和胸的排布', () => {
  it('上下排：每多一排，躯干加长一截，身高跟着变高', () => {
    const one = figure();
    const three = figure({ armPairs: 3 });
    const step = (three.metrics.height - one.metrics.height) / 2;
    expect(step).toBeGreaterThan(0.14);
    expect(step).toBeLessThan(0.18);
    const ys = ['Arm_01_L', 'Arm_02_L', 'Arm_03_L'].map((n) => worldPos(three, n)[1]);
    expect(ys[0] - ys[1]).toBeCloseTo(step, 9);
    expect(ys[1] - ys[2]).toBeCloseTo(step, 9);
  });

  it('肩部聚拢：躯干不加长，手臂都挤在肩膀附近', () => {
    const one = figure();
    const fan = figure({ armPairs: 3 }, { armLayout: 'fan' });
    expect(fan.metrics.height).toBeCloseTo(one.metrics.height, 9);
    const ys = ['Arm_01_L', 'Arm_02_L', 'Arm_03_L'].map((n) => part(fan, n).pos[1]);
    expect(ys[0] - ys[2]).toBeLessThan(0.12);
  });

  it('肩部聚拢：手臂自然下垂，最上面一对张得最开，往下一对比一对垂得直', () => {
    /** 上臂离开「垂直向下」多少度，以及肘、手腕比肩关节低多少 */
    const hang = (f: Figure, n: string) => {
      const arm = part(f, n);
      const upper = arm.prims.find((p) => p.name === 'UpperArm');
      const fore = arm.prims.find((p) => p.name === 'Forearm');
      if (upper?.kind !== 'cone' || fore?.kind !== 'cone') throw new Error('没有上臂或前臂');
      const [x, y, z] = upper.b;
      return { angle: (Math.atan2(Math.hypot(x, z), -y) * 180) / Math.PI, elbow: upper.b, wrist: fore.b };
    };
    for (const armPairs of [2, 3, 4]) {
      const f = figure({ armPairs }, { armLayout: 'fan' });
      const arms = Array.from({ length: armPairs }, (_, i) => hang(f, `Arm_0${i + 1}_L`));
      arms.forEach((arm, i) => {
        // 每一条都是往下垂的：肘在肩下面，手腕在肘下面，而且没有举到水平以上
        expect(arm.elbow[1], `${armPairs} 对的第 ${i + 1} 对`).toBeLessThan(-0.12);
        expect(arm.wrist[1], `${armPairs} 对的第 ${i + 1} 对`).toBeLessThan(arm.elbow[1] - 0.1);
        expect(arm.angle, `${armPairs} 对的第 ${i + 1} 对`).toBeLessThan(65);
        expect(arm.angle, `${armPairs} 对的第 ${i + 1} 对`).toBeGreaterThan(15);
        // 左臂都在身体的左边
        expect(arm.elbow[0]).toBeGreaterThan(0);
        if (i) {
          expect(arm.angle).toBeLessThan(arms[i - 1].angle - 8);
          // 越往下的一对越靠前：肩关节一对比一对靠前，手肘也跟着往前摆
          expect(arm.elbow[2]).toBeGreaterThan(arms[i - 1].elbow[2]);
          expect(part(f, `Arm_0${i + 1}_L`).pos[2]).toBeGreaterThan(part(f, `Arm_0${i}_L`).pos[2] + 0.02);
        }
      });
      // 垂得最直的最后一对就在本来的肩膀上（和只有一对手臂时是同一个位置），
      // 其余的都从它后面长出来：没有哪个肩头跑到前胸去
      expect(part(f, `Arm_0${armPairs}_L`).pos).toEqual(part(figure(), 'Arm_01_L').pos);
      // 最上面一对和只有一对手臂时差不多
      expect(arms[0].angle).toBeGreaterThan(44);
    }
  });

  it('肩部聚拢 + T-pose：仍然以水平为中心上下张开', () => {
    const f = figure({ armPairs: 3 }, { armLayout: 'fan', pose: 'T' });
    const elbowY = (n: string) => {
      const upper = part(f, n).prims.find((p) => p.name === 'UpperArm');
      if (upper?.kind !== 'cone') throw new Error('没有上臂');
      return upper.b[1];
    };
    expect(elbowY('Arm_01_L')).toBeGreaterThan(0.05);
    expect(Math.abs(elbowY('Arm_02_L'))).toBeLessThan(0.03);
    expect(elbowY('Arm_03_L')).toBeLessThan(-0.05);
  });

  it('肩部聚拢：胸大、胯宽的时候，贴身的那对手臂往外让', () => {
    const angle = (f: Figure) => {
      const upper = part(f, 'Arm_03_L').prims.find((p) => p.name === 'UpperArm');
      if (upper?.kind !== 'cone') throw new Error('没有上臂');
      return (Math.atan2(Math.hypot(upper.b[0], upper.b[2]), -upper.b[1]) * 180) / Math.PI;
    };
    const slim = figure({ armPairs: 3 }, { armLayout: 'fan' });
    const wideHips = figure({ armPairs: 3 }, { armLayout: 'fan' }, { hips: 1.4, shoulders: 0.85, build: 1.3 });
    const bigChest = figure({ armPairs: 3, chestPairs: 3 }, { armLayout: 'fan' }, { bust: 1.6, shoulders: 0.85 });
    expect(angle(wideHips)).toBeGreaterThan(angle(slim) + 5);
    expect(angle(bigChest)).toBeGreaterThan(angle(slim) + 5);
  });

  it('多排胸和多排手臂共用躯干加长：取两者里排数多的', () => {
    const base = figure().metrics.height;
    const chest3 = figure({ chestPairs: 3 }).metrics.height;
    const both = figure({ chestPairs: 3, armPairs: 2 }).metrics.height;
    const arms4 = figure({ chestPairs: 3, armPairs: 4 }).metrics.height;
    expect(chest3).toBeGreaterThan(base + 0.28);
    expect(both).toBeCloseTo(chest3, 9);
    expect(arms4).toBeGreaterThan(chest3 + 0.14);
  });

  it('下面几排胸更小，并且贴在躯干前表面', () => {
    const f = figure({ chestPairs: 3 });
    const radius = (n: string) => {
      const p = part(f, n).prims[0];
      if (p.kind !== 'ellipsoid') throw new Error('胸不是椭球');
      return p.radii[0];
    };
    expect(radius('Chest_02_L')).toBeLessThan(radius('Chest_01_L'));
    expect(radius('Chest_03_L')).toBeLessThan(radius('Chest_02_L'));
    for (const p of ofType(f, 'chest')) expect(p.pos[2]).toBeGreaterThan(0.05);
  });

  it('胸部大小滑块只改胸', () => {
    const small = figure({}, {}, { bust: 0.3 });
    const big = figure({}, {}, { bust: 1.6 });
    const r = (f: Figure) => (part(f, 'Chest_01_L').prims[0] as { radii: number[] }).radii[0];
    expect(r(big)).toBeGreaterThan(r(small) * 4);
    expect(part(big, 'Torso')).toEqual(part(small, 'Torso'));
    expect(part(big, 'Arm_01_L')).toEqual(part(small, 'Arm_01_L'));
  });
});

describe('多头', () => {
  it('头凑成一簇：脸贴着脸、互相压着一点，中间的靠前，两边的往后退', () => {
    for (let heads = 2; heads <= 5; heads++) {
      const f = figure({ heads });
      const world = worldTransforms(f);
      const at = names(f, 'head').map((n) => world.get(n)!.pos);
      const width = 2 * HEAD_HALF_WIDTH * world.get('Head_01')!.scale;
      for (let i = 1; i < at.length; i++) {
        expect(at[i][0]).toBeGreaterThan(at[i - 1][0]);
        // 相邻两个头的正中隔得比头窄（压着一点），但不到压掉半张脸的程度
        const apart = Math.hypot(at[i][0] - at[i - 1][0], at[i][1] - at[i - 1][1], at[i][2] - at[i - 1][2]);
        expect(apart, `${heads} 个头时第 ${i} 和 ${i + 1} 个头离得太远`).toBeLessThan(width * 0.95);
        expect(apart, `${heads} 个头时第 ${i} 和 ${i + 1} 个头压得太多`).toBeGreaterThan(width * 0.7);
      }
      expect(at[0][0]).toBeCloseTo(-at[at.length - 1][0], 9);
      // 越靠外的越靠后
      const middle = at[Math.floor((heads - 1) / 2)];
      if (heads > 2) expect(at[0][2]).toBeLessThan(middle[2] - 0.01);
    }
  });

  it('中间的头是正的；两边的往外歪一点、脸朝外转一点', () => {
    const f = figure({ heads: 3 });
    const up = (name: string) => rotate(part(f, name).quat, [0, 1, 0]);
    const face = (name: string) => rotate(part(f, name).quat, [0, 0, 1]);
    expect(up('Head_02')[0]).toBeCloseTo(0, 9);
    expect(face('Head_02')[0]).toBeCloseTo(0, 9);
    // Head_03 在角色的左手边（+X）
    expect(up('Head_03')[0]).toBeGreaterThan(0.15);
    expect(up('Head_03')[0]).toBeLessThan(0.45);
    expect(face('Head_03')[0]).toBeGreaterThan(0.3);
    expect(face('Head_03')[2]).toBeGreaterThan(0.7);
    expect(up('Head_01')[0]).toBeCloseTo(-up('Head_03')[0], 9);
  });

  it('身体还是一个人的身体：三四个头肩膀不加宽，五个头也只宽一点', () => {
    const shoulderX = (heads: number) => part(figure({ heads }), 'Arm_01_L').pos[0];
    expect(shoulderX(3)).toBeCloseTo(shoulderX(1), 2);
    expect(shoulderX(4)).toBeCloseTo(shoulderX(1), 2);
    expect(shoulderX(5)).toBeLessThan(shoulderX(1) * 1.15);
  });

  it('脖子根并排挤在肩膀中间，都在两肩以内', () => {
    for (let heads = 2; heads <= 5; heads++) {
      const f = figure({ heads });
      const roots = names(f, 'neck').map((n) => part(f, n).pos[0]);
      const shoulder = part(f, 'Arm_01_L').pos[0];
      for (const x of roots) expect(Math.abs(x)).toBeLessThan(shoulder - 0.04);
      for (let i = 1; i < roots.length; i++) expect(roots[i] - roots[i - 1]).toBeLessThan(0.08);
    }
  });

  it('四五个头时每个头小一圈', () => {
    const size = (heads: number) => part(figure({ heads }), 'Head_01').scale!;
    expect(size(3)).toBeCloseTo(size(1), 9);
    expect(size(4)).toBeCloseTo(size(1) * 0.92, 9);
    expect(size(5)).toBeCloseTo(size(1) * 0.86, 9);
  });

  it('紧挨着别的头的那一侧不长人耳，精灵耳也只留最外面的两只', () => {
    const ears = (f: Figure, name: string) => part(f, name).prims.filter((p) => /^Ear_/.test(p.name)).map((p) => p.name);
    const three = figure({ heads: 3 });
    expect(ears(three, 'Head_01')).toEqual(['Ear_R']);
    expect(ears(three, 'Head_02')).toEqual([]);
    expect(ears(three, 'Head_03')).toEqual(['Ear_L']);
    const elf = figure({ heads: 3, earPairsPerHead: 1 }, { earShape: 'elf' });
    expect(names(elf, 'ear')).toEqual(['Head_01_Ear_01_R', 'Head_03_Ear_01_L']);
    // 长在头顶的兽耳每个头都是一对
    expect(names(figure({ heads: 3, earPairsPerHead: 1 }, { earShape: 'cat' }), 'ear')).toHaveLength(6);
  });
});

describe('一个头几张脸', () => {
  const faced = (heads: number, counts: Partial<BodyCounts> = {}) => figure({ heads, ...counts }, { headLayout: 'faces' });
  /** 这个头的脸朝哪边 */
  const facing = (f: Figure, name: string) => rotate(worldTransforms(f).get(name)!.quat, [0, 0, 1]);

  it('只有一个头、一根脖子；多出来的脸是正面那个头的子部件，没有自己的骨骼', () => {
    const f = faced(3);
    expect(names(f, 'neck')).toEqual(['Neck_01']);
    expect(names(f, 'head')).toEqual(['Head_01', 'Head_02', 'Head_03']);
    expect(part(f, 'Head_01').parent).toBe('Torso');
    expect(part(f, 'Head_01').bones?.map((b) => b.name)).toEqual(['Head']);
    for (const name of ['Head_02', 'Head_03']) {
      expect(part(f, name).parent).toBe('Head_01');
      expect(part(f, name).bones).toBeUndefined();
    }
    // 肩膀不用加宽，头也不缩小：身体和只有一个头时一样
    const one = figure();
    expect(worldPos(f, 'Arm_01_L')).toEqual(worldPos(one, 'Arm_01_L'));
    expect(part(f, 'Head_01').scale).toBe(part(one, 'Head_01').scale);
    expect(f.metrics.height).toBeCloseTo(one.metrics.height, 9);
    // 只有一个头时这个选项不起作用
    expect(figure({}, { headLayout: 'faces' })).toEqual(one);
  });

  it('两张脸一前一后，三张是正前、左、右，四张再加一张朝后', () => {
    const three = faced(3);
    expect(facing(three, 'Head_01')[2]).toBeGreaterThan(0.99);
    expect(facing(three, 'Head_02')[0]).toBeGreaterThan(0.99);
    expect(facing(three, 'Head_03')[0]).toBeLessThan(-0.99);
    expect(facing(faced(4), 'Head_04')[2]).toBeLessThan(-0.99);
    expect(facing(faced(2), 'Head_02')[2]).toBeLessThan(-0.99);
    // 多出来的脸顺着它自己朝的方向挪出去了一点，不是整个埋在正面那个头里
    expect(worldPos(three, 'Head_02')[0]).toBeGreaterThan(worldPos(three, 'Head_01')[0] + 0.02);
    expect(worldPos(three, 'Head_03')[0]).toBeCloseTo(-worldPos(three, 'Head_02')[0], 9);
    // 五张脸绕一圈均匀分开：相邻两张隔 72°
    const five = faced(5);
    const yaw = (name: string) => Math.atan2(facing(five, name)[0], facing(five, name)[2]) / (Math.PI / 180);
    expect([1, 2, 3, 4, 5].map((k) => Math.round(yaw(`Head_0${k}`)))).toEqual([0, 72, -72, 144, -144]);
  });

  it('每张脸都有眼睛；角和兽耳只长在正面那个头上；两边长着脸时不长人耳', () => {
    const f = faced(3, { hornsPerHead: 2, earPairsPerHead: 1 });
    expect(names(f, 'eye')).toHaveLength(6);
    expect(names(f, 'horn')).toEqual(['Head_01_Horn_01_L', 'Head_01_Horn_01_R']);
    expect(names(f, 'ear')).toEqual(['Head_01_Ear_01_L', 'Head_01_Ear_01_R']);
    const humanEars = (g: Figure, head: string) => part(g, head).prims.filter((p) => p.name.startsWith('Ear_')).length;
    expect(humanEars(faced(3), 'Head_01')).toBe(0);
    expect(humanEars(faced(3), 'Head_02')).toBe(0);
    // 一前一后两张脸：耳朵在两侧，共用正面那个头的
    expect(humanEars(faced(2), 'Head_01')).toBe(2);
    expect(humanEars(faced(2), 'Head_02')).toBe(0);
  });

  it('2–5 张脸都能生成，左右对称', () => {
    for (let heads = 2; heads <= 5; heads++) {
      for (const armLayout of ['stack', 'fan'] as const) {
        const f = figure({ heads, armPairs: 3, hornsPerHead: 3, earPairsPerHead: 2 }, { headLayout: 'faces', armLayout, pose: 'T' });
        expectSound(f);
        expectMirrored(f);
      }
    }
  });
});

describe('下半身', () => {
  it('两对腿默认是人马下身：上半身抬高，尾巴接在兽身后端', () => {
    const f = figure({ legs: 4, tails: 1 });
    expect(f.metrics.legForm).toBe('taur');
    expect(names(f, 'lower')).toEqual(['LowerBody']);
    expect(part(f, 'Torso').pos[1]).toBeGreaterThan(0.1);
    expect(f.metrics.height).toBeGreaterThan(figure().metrics.height + 0.1);
    expect(part(f, 'Tail_01').pos[2]).toBeLessThan(part(f, 'Leg_02_L').pos[2]);
    expect(part(f, 'Leg_01_L').pos[2]).toBeGreaterThan(part(f, 'Leg_02_L').pos[2]);
  });

  it('马身是前胸、腰身、后臀三团；后腿的飞节往后突，蹄子底下是平的', () => {
    const f = figure({ legs: 4 });
    const body = part(f, 'LowerBody');
    expect(body.prims.map((p) => p.name)).toEqual(['Barrel', 'Chest', 'Croup']);
    const blobOf = (name: string) => {
      const p = body.prims.find((q) => q.name === name);
      if (p?.kind !== 'ellipsoid') throw new Error(`没有 ${name}`);
      return p;
    };
    // 腰身比前胸、后臀都细；前胸在前，后臀在后
    expect(blobOf('Barrel').radii[0]).toBeLessThan(blobOf('Chest').radii[0]);
    expect(blobOf('Barrel').radii[1]).toBeLessThan(blobOf('Croup').radii[1]);
    expect(blobOf('Chest').center[2]).toBeGreaterThan(0.1);
    expect(blobOf('Croup').center[2]).toBeLessThan(-0.1);
    // 上半身坐在前胸的正上方
    expect(part(f, 'Torso').pos[2]).toBeCloseTo(body.pos[2] + blobOf('Chest').center[2], 1);
    const joint = (leg: string, name: string) => {
      const p = part(f, leg).prims.find((q) => q.name === name);
      if (p?.kind !== 'ellipsoid') throw new Error(`${leg} 没有 ${name}`);
      return p.center;
    };
    // 前腿是直的，后腿的飞节比髋关节靠后、球节又回到前面一点：侧面看是一道折线
    expect(Math.abs(joint('Leg_01_L', 'Knee')[2])).toBeLessThan(0.03);
    expect(joint('Leg_02_L', 'Hock')[2]).toBeLessThan(-0.06);
    expect(joint('Leg_02_L', 'Fetlock')[2]).toBeGreaterThan(joint('Leg_02_L', 'Hock')[2] + 0.03);
    // 每条腿都带着一块削平蹄底用的「地面」，顶面正好在地面上
    for (const leg of ofType(f, 'leg')) {
      const ground = leg.prims.find((p) => p.name === 'Ground');
      if (ground?.kind !== 'ellipsoid') throw new Error('没有地面');
      expect(ground.cut).toBe(true);
      expect(leg.pos[1] + ground.center[1] + ground.radii[1]).toBeCloseTo(0, 9);
      // 膝盖以上是长在马身里的：穿模检查时放宽
      expect(leg.rootFree).toBeGreaterThan(0.4);
    }
  });

  it('三对以上默认是蛛形下身：头胸部加腹部，腿向两侧放射', () => {
    const f = figure({ legs: 8 });
    expect(f.metrics.legForm).toBe('spider');
    expect(names(f, 'lower')).toEqual(['Cephalothorax', 'Abdomen']);
    const tipX = (n: string) => {
      const tip = part(f, n).prims.find((p) => p.name === 'Tip');
      if (tip?.kind !== 'ellipsoid') throw new Error('没有足尖');
      return part(f, n).pos[0] + tip.center[0];
    };
    for (let k = 1; k <= 4; k++) expect(tipX(`Leg_0${k}_L`)).toBeGreaterThan(0.4);
  });

  it('每种排法在 3–9 条腿时都能生成，脚都落在地面附近', () => {
    for (const legLayout of LEG_LAYOUTS) {
      for (let legs = 3; legs <= 9; legs++) {
        const f = figure({ legs, tails: 2 }, { legLayout });
        expectSound(f);
        expectMirrored(f);
        expect(ofType(f, 'leg')).toHaveLength(legPlan({ counts: { ...defaultSpec().counts, legs }, legLayout }).total);
        for (const leg of ofType(f, 'leg')) {
          // 挖掉的那块（削平蹄底用的地面）不算
          const lowest = Math.min(
            ...leg.prims.map((p) =>
              p.kind === 'ellipsoid' && !p.cut
                ? leg.pos[1] + p.center[1] - p.radii[1]
                : p.kind === 'cone'
                  ? leg.pos[1] + Math.min(p.a[1] - p.ra, p.b[1] - p.rb)
                  : Number.POSITIVE_INFINITY,
            ),
          );
          expect(lowest, `${legLayout} ${legs} 条：${leg.name}`).toBeGreaterThan(-0.03);
          expect(lowest, `${legLayout} ${legs} 条：${leg.name}`).toBeLessThan(0.03);
        }
      }
    }
  });

  it('人腿人马：上半身不抬高，身后横着一截腰，接着又一副胯和腿；臀长在最后那副胯上', () => {
    const one = figure();
    const f = figure({ legs: 4, tails: 1 }, { legLayout: 'humantaur' });
    expect(f.metrics.legForm).toBe('humantaur');
    expectSound(f);
    expectMirrored(f);
    // 腿是人腿，还是那么长：身高和两条腿时一样，上半身在原地
    expect(part(f, 'Torso').pos).toEqual(part(one, 'Torso').pos);
    expect(f.metrics.height).toBeCloseTo(one.metrics.height, 9);
    expect(part(f, 'Leg_01_L')).toEqual(part(one, 'Leg_01_L'));
    // 后面一对腿和前面一对一模一样，只是在身后四十多厘米
    const rear = part(f, 'Leg_02_L');
    expect(rear.prims).toEqual(part(one, 'Leg_01_L').prims);
    expect(rear.pos[0]).toBe(part(f, 'Leg_01_L').pos[0]);
    expect(rear.pos[1]).toBe(part(f, 'Leg_01_L').pos[1]);
    expect(part(f, 'Leg_01_L').pos[2] - rear.pos[2]).toBeGreaterThan(0.4);
    expect(part(f, 'Leg_01_L').pos[2] - rear.pos[2]).toBeLessThan(0.55);
    // 下身：一副胯、一截腰、把前面的胯顺到腰上的一团，再加两瓣臀和中间那道缝
    expect(names(f, 'lower')).toEqual(['LowerBody']);
    const body = part(f, 'LowerBody');
    expect(body.prims.map((p) => p.name)).toEqual(['Pelvis_02', 'Waist_02', 'Loin_02', 'Glute_L', 'Glute_R', 'Cleft']);
    const blobOf = (name: string) => {
      const p = body.prims.find((q) => q.name === name);
      if (p?.kind !== 'ellipsoid') throw new Error(`没有 ${name}`);
      return p;
    };
    // 腰比胯细，横着（前后最长）；它的前头伸进前面那副胯里，后头伸进后面那副胯里
    const waist = blobOf('Waist_02');
    const pelvis = blobOf('Pelvis_02');
    expect(waist.radii[0]).toBeLessThan(pelvis.radii[0] - 0.02);
    expect(waist.radii[2]).toBeGreaterThan(waist.radii[0] * 1.5);
    expect(body.pos[2] + waist.center[2] + waist.radii[2]).toBeGreaterThan(part(f, 'Leg_01_L').pos[2]);
    expect(body.pos[2] + waist.center[2] - waist.radii[2]).toBeLessThan(rear.pos[2]);
    // 后面那副胯就在后腿的正上方；臀在它后面
    expect(body.pos[2] + pelvis.center[2]).toBeCloseTo(rear.pos[2], 1);
    expect(body.pos[2] + blobOf('Glute_L').center[2]).toBeLessThan(rear.pos[2] - 0.04);
    // 本来的臀（躯干上的）没有了：那里接着腰
    expect(part(f, 'Torso').prims.some((p) => p.name.startsWith('Glute'))).toBe(false);
    expect(part(one, 'Torso').prims.some((p) => p.name.startsWith('Glute'))).toBe(true);
    // 尾巴长在最后那副胯的后面
    expect(part(f, 'Tail_01').pos[2]).toBeLessThan(rear.pos[2] - 0.05);
    // 三对腿：再接一截
    const three = figure({ legs: 6 }, { legLayout: 'humantaur' });
    expect(part(three, 'LowerBody').prims.map((p) => p.name)).toEqual(['Pelvis_02', 'Waist_02', 'Loin_02', 'Pelvis_03', 'Waist_03', 'Loin_03', 'Glute_L', 'Glute_R', 'Cleft']);
    expect(part(three, 'Leg_02_L').pos[2] - part(three, 'Leg_03_L').pos[2]).toBeCloseTo(part(three, 'Leg_01_L').pos[2] - part(three, 'Leg_02_L').pos[2], 9);
    // 自动排法不会选它：要点名
    expect(figure({ legs: 4 }).metrics.legForm).toBe('taur');
  });

  it('单数条腿：多出来的那条长在中线上，不分左右', () => {
    const two = figure();
    const hx = part(two, 'Leg_01_L').pos[0];
    const torsoW = (f: Figure) => {
      const loft = part(f, 'Torso').prims.find((p) => p.kind === 'loft');
      if (loft?.kind !== 'loft') throw new Error('没有躯干');
      return Math.max(...loft.rings.filter((r) => r.y < 1).map((r) => r.w));
    };
    // 单足：胯正下方一条，笔直；胯收窄
    const one = figure({ legs: 1 });
    expectSound(one);
    expectMirrored(one);
    expect(names(one, 'leg')).toEqual(['Leg_01']);
    const mono = part(one, 'Leg_01');
    expect(mono.side).toBe(0);
    expect(mono.pos[0]).toBe(0);
    for (const p of mono.prims) if (p.kind === 'cone') expect([p.a[0], p.b[0]]).toEqual([0, 0]);
    expect(torsoW(one)).toBeLessThan(torsoW(two) - 0.02);
    expect(one.metrics.height).toBeCloseTo(two.metrics.height, 9);
    // 并排三条：正中一条，两边各隔两个髋关节间距
    const row = figure({ legs: 3 }, { legLayout: 'row' });
    expectMirrored(row);
    expect(names(row, 'leg')).toEqual(['Leg_01', 'Leg_01_L', 'Leg_01_R']);
    expect(part(row, 'Leg_01').pos[0]).toBe(0);
    expect(part(row, 'Leg_01_L').pos[0]).toBeCloseTo(2 * hx, 9);
    expect(part(row, 'Leg_01_R').pos[0]).toBeCloseTo(-2 * hx, 9);
    // 自动排法：单数是并排
    expect(figure({ legs: 5 }).metrics.legForm).toBe('row');
    // 前后串联三条：前二后一，后面那条在正中
    const tandem = figure({ legs: 3 }, { legLayout: 'tandem' });
    expect(names(tandem, 'leg')).toEqual(['Leg_01_L', 'Leg_01_R', 'Leg_01']);
    expect(part(tandem, 'Leg_01').pos[0]).toBe(0);
    expect(part(tandem, 'Leg_01').pos[2]).toBeLessThan(part(tandem, 'Leg_01_L').pos[2] - 0.15);
    // 人马、蛛形单数时多补一条
    expect(ofType(figure({ legs: 5 }, { legLayout: 'taur' }), 'leg')).toHaveLength(6);
    expect(ofType(figure({ legs: 7 }, { legLayout: 'spider' }), 'leg')).toHaveLength(8);
  });

  it('人腿人马每副胯几条腿：前三后三是两副胯、每副并排三条；后面那副胯跟着变宽', () => {
    const f = figure({ legs: 6, tails: 1 }, { legLayout: 'humantaur', hipLegs: 3 });
    expect(f.metrics.legForm).toBe('humantaur');
    expectSound(f);
    expectMirrored(f);
    expect(ofType(f, 'leg')).toHaveLength(6);
    const z = (name: string) => part(f, name).pos[2];
    // 前面那副：正中 Leg_01，两边 Leg_01_L / R；后面那副：正中 Leg_02，两边 Leg_02_L / R
    expect(z('Leg_01')).toBe(z('Leg_01_L'));
    expect(z('Leg_02')).toBe(z('Leg_02_L'));
    expect(z('Leg_01') - z('Leg_02')).toBeGreaterThan(0.4);
    expect(part(f, 'Leg_02').pos[0]).toBe(0);
    expect(part(f, 'Leg_02_L').pos[0]).toBeCloseTo(part(f, 'Leg_01_L').pos[0], 9);
    const pelvis = (g: Figure) => {
      const p = part(g, 'LowerBody').prims.find((q) => q.name === 'Pelvis_02');
      if (p?.kind !== 'ellipsoid') throw new Error('没有 Pelvis_02');
      return p.radii[0];
    };
    const pair = figure({ legs: 4 }, { legLayout: 'humantaur' });
    expect(pelvis(f)).toBeGreaterThan(pelvis(pair) + 0.05);
    // 每副胯盖得住最外边那条腿
    expect(pelvis(f)).toBeGreaterThan(part(f, 'Leg_02_L').pos[0]);
    // 前三后二：最后那副少一条，没有正中那条
    const five = figure({ legs: 5 }, { legLayout: 'humantaur', hipLegs: 3 });
    expect(names(five, 'leg')).toEqual(['Leg_01', 'Leg_01_L', 'Leg_01_R', 'Leg_02_L', 'Leg_02_R']);
    // 前一后一：每副胯一条
    const single = figure({ legs: 2 }, { legLayout: 'humantaur', hipLegs: 1 });
    expect(single.metrics.legForm).toBe('humantaur');
    expect(names(single, 'leg')).toEqual(['Leg_01', 'Leg_02']);
    // 每副胯四条、两副：八条腿
    expect(ofType(figure({ legs: 8 }, { legLayout: 'humantaur', hipLegs: 4 }), 'leg')).toHaveLength(8);
    // 前后串联也能选：前三后三，下身宽到盖得住最外边那条
    const tandem = figure({ legs: 6 }, { legLayout: 'tandem', hipLegs: 3 });
    expectSound(tandem);
    expectMirrored(tandem);
    expect(names(tandem, 'leg')).toEqual(['Leg_01', 'Leg_01_L', 'Leg_01_R', 'Leg_02', 'Leg_02_L', 'Leg_02_R']);
    const lower = part(tandem, 'LowerBody').prims[0];
    if (lower.kind !== 'ellipsoid') throw new Error('没有下身');
    expect(lower.radii[0]).toBeGreaterThan(part(tandem, 'Leg_01_L').pos[0]);
  });

  it('胯部聚拢：几副胯一副紧贴一副，腿往下一对比一对往外散开；单数时正中那条在最后，前面几对多散半步', () => {
    const f = figure({ legs: 6, tails: 1 }, { legLayout: 'gather' });
    expect(f.metrics.legForm).toBe('gather');
    expectSound(f);
    expectMirrored(f);
    expect(names(f, 'leg')).toEqual(['Leg_01_L', 'Leg_01_R', 'Leg_02_L', 'Leg_02_R', 'Leg_03_L', 'Leg_03_R']);
    const z = (name: string) => part(f, name).pos[2];
    // 一副紧贴在前一副后面：比前后串联近得多
    expect(z('Leg_01_L') - z('Leg_02_L')).toBeGreaterThan(0.04);
    expect(z('Leg_01_L') - z('Leg_02_L')).toBeLessThan(0.12);
    expect(z('Leg_02_L') - z('Leg_03_L')).toBeCloseTo(z('Leg_01_L') - z('Leg_02_L'), 9);
    // 髋关节都在原来的地方（腿根聚在胯底下），脚踝一对比一对往外，往后越散越开
    const ankle = (g: Figure, name: string) => {
      const shin = part(g, name).prims.find((p) => p.name === 'Shin');
      if (shin?.kind !== 'cone') throw new Error(`${name} 没有小腿`);
      return part(g, name).pos[0] + shin.b[0];
    };
    expect(part(f, 'Leg_02_L').pos[0]).toBeCloseTo(part(f, 'Leg_01_L').pos[0], 9);
    const plain = figure({ legs: 2 });
    expect(ankle(f, 'Leg_01_L')).toBeCloseTo(ankle(plain, 'Leg_01_L'), 9);
    const gap = ankle(f, 'Leg_02_L') - ankle(f, 'Leg_01_L');
    expect(gap).toBeGreaterThan(0.12);
    expect(ankle(f, 'Leg_03_L') - ankle(f, 'Leg_02_L')).toBeGreaterThan(gap);
    expect(ankle(f, 'Leg_02_R')).toBeCloseTo(-ankle(f, 'Leg_02_L'), 9);
    // 脚还是平的、踩在原来的高度上，跟着脚踝挪
    const foot = (g: Figure, name: string) => (part(g, name).prims.find((p) => p.name === 'Foot') as { center: number[] }).center;
    expect(foot(f, 'Leg_03_L')[0]).toBeCloseTo(ankle(f, 'Leg_03_L') - part(f, 'Leg_03_L').pos[0], 9);
    expect(foot(f, 'Leg_03_L')[1]).toBe(foot(plain, 'Leg_01_L')[1]);
    // 后面每副胯照前面那副胯的样子垫一份；最后那副的屁股露在外面，两瓣中间一道缝
    expect(part(f, 'LowerBody').prims.map((p) => p.name)).toEqual(['Pelvis_02', 'Pelvis_03', 'Glute_L', 'Glute_R', 'Cleft']);
    // 单数：最后那副胯正中一条，前面那对也散开半步
    const five = figure({ legs: 5 }, { legLayout: 'gather' });
    expect(names(five, 'leg')).toEqual(['Leg_01_L', 'Leg_01_R', 'Leg_02_L', 'Leg_02_R', 'Leg_01']);
    expect(part(five, 'Leg_01').pos[0]).toBe(0);
    expect(part(five, 'Leg_01').pos[2]).toBeLessThan(part(five, 'Leg_02_L').pos[2] - 0.04);
    expect(ankle(five, 'Leg_01_L') - ankle(plain, 'Leg_01_L')).toBeGreaterThan(0.05);
    expect(ankle(five, 'Leg_01_L') - ankle(plain, 'Leg_01_L')).toBeLessThan(gap * 0.6);
  });

  it('屁股缝：露在外面的屁股上，一副胯几条腿就几瓣，相邻两条腿中间往上一道缝；融合以后真的凹进去', () => {
    const prims = (f: Figure, name: string) => part(f, name).prims;
    const cuts = (list: Prim[]) => list.filter((p) => 'cut' in p && p.cut);
    const cheeks = (list: Prim[]) => list.filter((p) => p.name.startsWith('Glute')).map((p) => p.name);
    const cutX = (list: Prim[]) => cuts(list).map((p) => (p.kind === 'ellipsoid' ? p.center[0] : NaN));
    const legX = (f: Figure) => ofType(f, 'leg').map((p) => p.pos[0]).sort((a, b) => a - b);
    const crotches = (xs: number[]) => xs.slice(1).map((x, i) => (x + xs[i]) / 2);
    // 双足、单足：两瓣一道缝，在正中
    for (const legs of [1, 2]) {
      const f = figure({ legs });
      expect(cheeks(prims(f, 'Torso'))).toEqual(['Glute_L', 'Glute_R']);
      expect(cutX(prims(f, 'Torso'))).toEqual([0]);
    }
    // 左右并排：躯干的胯加宽了，每条腿上面一瓣，胯下往上各一道缝（正对着两条腿中间）
    for (const legs of [3, 4, 6]) {
      const f = figure({ legs }, { legLayout: 'row' });
      expect(cheeks(prims(f, 'Torso'))).toHaveLength(legs);
      const xs = cutX(prims(f, 'Torso'));
      expect(xs).toHaveLength(legs - 1);
      crotches(legX(f)).forEach((x, i) => expect(xs[i]).toBeCloseTo(x, 9));
      expect(cuts(prims(f, 'LowerBody'))).toHaveLength(0);
    }
    // 前后排的：本来那副胯的屁股埋在后面接着的胯里，不开缝；最后那副胯开缝，那副胯上几条腿就几瓣
    for (const [legs, legLayout, hipLegs, rear] of [
      [4, 'humantaur', 2, 2],
      [6, 'humantaur', 3, 3],
      [6, 'tandem', 3, 3],
      [4, 'tandem', 2, 2],
      [4, 'gather', 2, 2],
      [5, 'gather', 2, 2],
    ] as const) {
      const f = figure({ legs }, { legLayout, hipLegs });
      expect(cuts(prims(f, 'Torso')), `${legLayout} ${legs}`).toHaveLength(0);
      expect(cheeks(prims(f, 'LowerBody')), `${legLayout} ${legs}`).toHaveLength(rear);
      expect(cuts(prims(f, 'LowerBody')), `${legLayout} ${legs}`).toHaveLength(rear - 1);
    }
    // 人马、蛛形：上半身坐在兽身上，没有人的屁股
    for (const legLayout of ['taur', 'spider'] as const) expect(cuts(prims(figure({ legs: 4 }, { legLayout }), 'Torso'))).toHaveLength(0);
    // 场里真的凹进去一道：缝正中的后表面比旁边两瓣靠前一厘米多
    const groove = (f: Figure, name: string) => {
      const body = part(f, name);
      const field = compileField({ scale: 1, parts: f.parts }, { blend: 0.02 });
      return cuts(body.prims).map((cut) => {
        if (cut.kind !== 'ellipsoid') throw new Error('缝应该是挖掉的椭球');
        const [x, y] = [body.pos[0] + cut.center[0], body.pos[1] + cut.center[1]];
        const back = (at: number) => -1 + castRay(field, [at, y, -1], [0, 0, 1], 1);
        return back(x) - Math.max(back(x - 0.045), back(x + 0.045));
      });
    };
    for (const depth of groove(figure({ legs: 2 }), 'Torso')) expect(depth).toBeGreaterThan(0.012);
    for (const depth of groove(figure({ legs: 4 }, { legLayout: 'row' }), 'Torso')) expect(depth).toBeGreaterThan(0.012);
    for (const depth of groove(figure({ legs: 6 }, { legLayout: 'humantaur', hipLegs: 3 }), 'LowerBody')) expect(depth).toBeGreaterThan(0.012);
  });

  it('前后串联时后一对腿在前一对后面；左右并排时在外侧', () => {
    const tandem = figure({ legs: 6 }, { legLayout: 'tandem' });
    expect(part(tandem, 'Leg_02_L').pos[2]).toBeLessThan(part(tandem, 'Leg_01_L').pos[2] - 0.15);
    expect(part(tandem, 'Leg_02_L').pos[0]).toBeCloseTo(part(tandem, 'Leg_01_L').pos[0], 9);
    const row = figure({ legs: 6 }, { legLayout: 'row' });
    expect(part(row, 'Leg_02_L').pos[0]).toBeGreaterThan(part(row, 'Leg_01_L').pos[0] + 0.1);
    expect(part(row, 'Leg_02_L').pos[2]).toBeCloseTo(part(row, 'Leg_01_L').pos[2], 9);
  });
});

describe('尾巴和翅膀', () => {
  it('多条尾巴从同一个尾根扇形散开，左右对称', () => {
    const f = figure({ tails: 9 });
    const tips = ofType(f, 'tail').map((p) => {
      const t = p.prims[0];
      if (t.kind !== 'tube') throw new Error('尾巴不是管');
      return t.points[t.points.length - 1];
    });
    expect(new Set(ofType(f, 'tail').map((p) => p.pos.join())).size).toBe(1);
    for (let i = 0; i < 9; i++) {
      expect(tips[i][0]).toBeCloseTo(-tips[8 - i][0], 9);
      expect(tips[i][2]).toBeLessThan(0);
    }
    for (let i = 1; i < 9; i++) expect(tips[i][0]).toBeGreaterThan(tips[i - 1][0]);
    // 上下交替
    expect(tips[1][1]).toBeGreaterThan(tips[0][1]);
    expect(tips[2][1]).toBeLessThan(tips[1][1]);
  });

  it('尾巴长度和蓬松度', () => {
    const tipZ = (f: Figure) => {
      const t = part(f, 'Tail_01').prims[0];
      if (t.kind !== 'tube') throw new Error('尾巴不是管');
      return { z: t.points[t.points.length - 1][2], bulge: t.bulge };
    };
    const short = tipZ(figure({ tails: 1 }, {}, { tailLength: 0.5, tailFluff: 0 }));
    const long = tipZ(figure({ tails: 1 }, {}, { tailLength: 2, tailFluff: 2 }));
    expect(long.z).toBeCloseTo(short.z * 4, 9);
    expect(short.bulge).toBe(0);
    expect(long.bulge).toBeGreaterThan(0.05);
  });

  it('翅膀长在背后，从上往下一对比一对小、一对比一对低', () => {
    const f = figure({ wingPairs: 3 });
    const size = (n: string) => {
      const w = part(f, n).prims[0];
      if (w.kind !== 'wing') throw new Error('不是翅膀');
      return w.size;
    };
    for (const p of ofType(f, 'wing')) expect(p.pos[2]).toBeLessThan(0);
    expect(size('Wing_02_L')).toBeLessThan(size('Wing_01_L'));
    expect(size('Wing_03_L')).toBeLessThan(size('Wing_02_L'));
    expect(part(f, 'Wing_02_L').pos[1]).toBeLessThan(part(f, 'Wing_01_L').pos[1]);
    // 六翼：上扬、平展、下垂 —— 翼尖方向的 Y 分量依次变小
    const tipY = (n: string) => rotate(part(f, n).quat, [1, 0, 0])[1];
    expect(tipY('Wing_01_L')).toBeGreaterThan(tipY('Wing_02_L'));
    expect(tipY('Wing_02_L')).toBeGreaterThan(tipY('Wing_03_L'));
    expect(tipY('Wing_01_L')).toBeGreaterThan(0);
    expect(tipY('Wing_03_L')).toBeLessThan(0);
  });
});

describe('各种组合都能生成', () => {
  it.each(PRESETS.map((p) => [p.name, p] as const))('预设「%s」', (_name, preset) => {
    const f = buildFigure(applyPreset(defaultSpec(), preset));
    expectSound(f);
    expectMirrored(f);
  });

  it('所有部件数量取极值时不出 NaN', () => {
    for (const pick of ['min', 'max'] as const) {
      const counts = Object.fromEntries(COUNT_DEFS.map((d) => [d.key, d[pick]])) as BodyCounts;
      const shape = Object.fromEntries(SHAPE_DEFS.map((d) => [d.key, d[pick]]));
      for (const armLayout of ['stack', 'fan'] as const) {
        for (const legLayout of LEG_LAYOUTS) {
          expectSound(buildFigure(make(counts, { armLayout, legLayout }, shape)));
        }
      }
    }
  });

  it('500 个随机组合', () => {
    const rand = rng(20261004);
    const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
    for (let i = 0; i < 500; i++) {
      const counts = Object.fromEntries(COUNT_DEFS.map((d) => [d.key, int(d.min, d.max)])) as BodyCounts;
      const shape = Object.fromEntries(SHAPE_DEFS.map((d) => [d.key, d.min + rand() * (d.max - d.min)]));
      const f = buildFigure(
        make(
          counts,
          {
            armLayout: rand() < 0.5 ? 'stack' : 'fan',
            legLayout: LEG_LAYOUTS[int(0, LEG_LAYOUTS.length - 1)],
            earShape: (['cat', 'fox', 'rabbit', 'elf'] as const)[int(0, 3)],
          },
          shape,
        ),
      );
      expectSound(f);
      expectMirrored(f);
      // 腿缩到一半时矮一截
      expect(f.metrics.height).toBeGreaterThan(0.8);
      expect(f.metrics.height).toBeLessThan(4.5);
    }
  });
});
