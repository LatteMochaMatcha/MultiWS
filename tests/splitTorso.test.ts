// 体块第 2 期：一个上半身的躯干也能分成「胸腔」（UpperBody）和「胯和小腹」（Torso）两块（见 docs/blocks-plan.md）
import { describe, expect, it } from 'vitest';
import { type Figure, type Part, worldTransforms } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type V3, add, len, mul, rotate, sub } from '../src/geometry/vec';
import { PELVIS, RIBCAGE, addBlock, canSplitTorso, setSplitTorso, torsoSplit } from '../src/model/blocks';
import { labelSplitTorso, partLabel } from '../src/model/partLabel';
import { type BodySpec, defaultSpec, normalizeSpec, parseSpecJson, serializeSpec } from '../src/model/spec';
import { buildSkeleton } from '../src/rig/skeleton';
import { castRay, compileField } from '../src/sdf/field';
import { useAnimeBody } from './animeBody';

useAnimeBody();

const STYLES = ['mannequin', 'anime'] as const;
const specOf = (patch: Partial<BodySpec> = {}): BodySpec => normalizeSpec({ ...defaultSpec(), ...patch });
const split = (spec: BodySpec, overrides: BodySpec['overrides'] = {}): BodySpec => ({ ...setSplitTorso(spec, true), overrides });
const part = (figure: Figure, name: string): Part => {
  const found = figure.parts.find((p) => p.name === name);
  if (!found) throw new Error(`没有部件 ${name}`);
  return found;
};
/** 部件自己坐标里的一点在世界里（米） */
const worldOf = (figure: Figure, name: string, p: V3 = [0, 0, 0]): V3 => {
  const xf = worldTransforms(figure).get(name)!;
  return add(xf.pos, mul(rotate(xf.quat, p), xf.scale));
};
const far = (a: V3, b: V3) => len(sub(a, b));

describe.each(STYLES)('躯干分成胸腔和胯（%s）', (bodyStyle) => {
  const spec = specOf({ bodyStyle });
  const whole = buildFigure(spec);
  const two = buildFigure(split(spec));

  it('多出一个胸腔，别的部件、骨骼一个不少，名字都不变', () => {
    expect(two.parts.map((p) => p.name).sort()).toEqual([...whole.parts.map((p) => p.name), RIBCAGE].sort());
    const bones = (f: Figure) => f.parts.flatMap((p) => (p.bones ?? []).map((b) => `${b.name}<${b.parent ?? ''}`)).sort();
    expect(bones(two)).toEqual(bones(whole));
    expect(() => buildSkeleton(two)).not.toThrow();
    // 脊柱在胸腔上，Hips 留在胯上；胸腔不挂在胯上，是各自独立的两块
    expect(part(two, RIBCAGE).bones!.map((b) => b.name)).toContain('Spine');
    expect(part(two, PELVIS).bones!.map((b) => b.name)).toEqual(['Hips']);
    expect(part(two, RIBCAGE).parent).toBeUndefined();
    expect(part(two, PELVIS).parent).toBeUndefined();
  });

  it('腰以上的部件改挂到胸腔上，位置没变；腿还是没有父部件', () => {
    for (const p of whole.parts) {
      const now = part(two, p.name);
      if (p.parent === 'Torso') expect(now.parent).toBe(RIBCAGE);
      else expect(now.parent).toBe(p.parent);
      expect(far(worldOf(two, p.name), worldOf(whole, p.name))).toBeLessThan(1e-9);
    }
    expect(two.metrics.height).toBeCloseTo(whole.metrics.height, 9);
  });

  it('没动的时候表面和没分开时一样', () => {
    const a = compileField(whole, { blend: spec.blend });
    const b = compileField(two, { blend: spec.blend });
    let worst = 0;
    let rays = 0;
    // 从四周朝躯干的中轴打射线（胯到脖子根，每 3 厘米一圈、一圈 16 条）：两边打到表面的地方差不到 0.3 毫米
    for (let y = 0.8; y <= 1.42; y += 0.03) {
      for (let k = 0; k < 16; k++) {
        const [c, sn] = [Math.cos((k * Math.PI) / 8), Math.sin((k * Math.PI) / 8)];
        const hit = (f: typeof a) => castRay(f, [0.5 * c, y, 0.5 * sn], [-c, 0, -sn], 0.5);
        worst = Math.max(worst, Math.abs(hit(a) - hit(b)));
        rays++;
      }
    }
    expect(rays).toBeGreaterThan(300);
    expect(worst).toBeLessThan(0.0003);
  });

  it('挪、转胸腔：它上面长的跟着走，胯和腿不动', () => {
    const moved = buildFigure(split(spec, { [RIBCAGE]: { position: [0.05, 0.08, 0], rotation: [0, 0, 15] } }));
    for (const name of ['Leg_01_L', 'Leg_01_R', PELVIS]) expect(far(worldOf(moved, name), worldOf(two, name))).toBeLessThan(1e-9);
    // 头跟着胸腔：离胸腔支点的距离没变，位置变了
    const pivot = part(two, RIBCAGE).pivot!;
    const head = (f: Figure) => far(worldOf(f, 'Head_01'), worldOf(f, RIBCAGE, pivot));
    expect(head(moved)).toBeCloseTo(head(two), 6);
    expect(far(worldOf(moved, 'Head_01'), worldOf(two, 'Head_01'))).toBeGreaterThan(0.05);
    expect(moved.metrics.height).not.toBeCloseTo(two.metrics.height, 3);
  });

  it('挪、转、放大胯：腿跟着它，胸腔和它上面长的不动，脚还踩在地上', () => {
    const feet = (f: Figure) => {
      let low = Infinity;
      for (const p of f.parts) if (p.type === 'leg') for (const b of p.bones ?? []) low = Math.min(low, worldOf(f, p.name, b.tail)[1]);
      return low;
    };
    // 往旁边、往后挪：胯和腿一起挪过去，胸腔、头原地不动
    const shifted = buildFigure(split(spec, { [PELVIS]: { position: [0.06, 0, -0.05] } }));
    for (const name of ['Leg_01_L', 'Leg_01_R']) {
      const d = sub(worldOf(shifted, name), worldOf(two, name));
      expect(d[0] / two.scale).toBeCloseTo(0.06, 6);
      expect(d[2] / two.scale).toBeCloseTo(-0.05, 6);
    }
    for (const name of [RIBCAGE, 'Head_01', 'Arm_01_L']) expect(far(worldOf(shifted, name), worldOf(two, name))).toBeLessThan(1e-9);
    // 往上挪：脚还在地上，等于腰短了——胸腔相对脚低了那么多
    const raised = buildFigure(split(spec, { [PELVIS]: { position: [0, 0.05, 0] } }));
    expect(feet(raised)).toBeCloseTo(feet(two), 6);
    expect((worldOf(two, RIBCAGE)[1] - worldOf(raised, RIBCAGE)[1]) / two.scale).toBeCloseTo(0.05, 6);
    // 转、放大：腿跟着转、跟着变大，胸腔不变大
    const turned = buildFigure(split(spec, { [PELVIS]: { rotation: [0, 0, 12], scale: [1.2, 1.2, 1.2] } }));
    expect(part(turned, 'Leg_01_L').scale ?? 1).toBeCloseTo(1.2, 9);
    expect(part(turned, RIBCAGE).scale ?? 1).toBeCloseTo(part(two, RIBCAGE).scale ?? 1, 9);
    expect(part(turned, 'Leg_01_L').quat).not.toEqual(part(two, 'Leg_01_L').quat);
    // 脚底还贴着地（这里量的是脚上骨骼的末端，歪过、放大过以后和脚底差一点）
    expect(Math.abs(feet(turned) - feet(two))).toBeLessThan(0.02);
    expect(() => buildSkeleton(turned)).not.toThrow();
  });

  it('分开以后照样能复制部件', () => {
    const more = addBlock(split(spec), [{ from: 'Arm_01_L' }]).spec;
    const figure = buildFigure(more);
    expect(part(figure, 'Arm_101_L').parent).toBe(RIBCAGE);
    expect(() => buildSkeleton(figure)).not.toThrow();
  });
});

describe('分开、合回去的设定', () => {
  const spec = specOf();

  it('只有一个上半身的白模人台、二次元素体能分', () => {
    expect(canSplitTorso(spec)).toBe(true);
    expect(canSplitTorso(specOf({ counts: { ...spec.counts, torsos: 2 } }))).toBe(false);
    expect(canSplitTorso(specOf({ conjoined: 'same' }))).toBe(false);
    expect(canSplitTorso(specOf({ ring: 'rows' }))).toBe(false);
    expect(canSplitTorso(specOf({ bodyStyle: 'character' }))).toBe(false);
    // 设定里记着「分开」、但这副身体分不了的：照没分开的摆
    const kept = { ...specOf({ counts: { ...spec.counts, torsos: 2 } }), blocks: { added: [], splitTorso: true } };
    expect(torsoSplit(kept)).toBe(false);
    expect(buildFigure(kept).parts.filter((p) => /^UpperBody/.test(p.name)).map((p) => p.parent)).toEqual(['Torso', 'Torso']);
    for (const patch of [{ conjoined: 'same' }, { ring: 'rows' }, { ring: 'hips' }, { ring: 'fused' }] as Partial<BodySpec>[]) {
      const figure = buildFigure({ ...specOf(patch), blocks: { added: [], splitTorso: true } });
      expect(figure.parts.some((p) => p.name === RIBCAGE && p.parent === undefined)).toBe(false);
    }
  });

  it('整块躯干的微调分开时挪到胸腔上，合回去时挪回来；胯自己的微调合回去时丢掉', () => {
    const tweaked: BodySpec = { ...spec, overrides: { Torso: { rotation: [10, 0, 0] }, Arm_01_L: { scale: [1, 1.1, 1] } } };
    const on = setSplitTorso(tweaked, true);
    expect(on.blocks!.splitTorso).toBe(true);
    expect(on.overrides).toEqual({ [RIBCAGE]: { rotation: [10, 0, 0] }, Arm_01_L: { scale: [1, 1.1, 1] } });
    expect(setSplitTorso(on, true)).toBe(on);
    const off = setSplitTorso({ ...on, overrides: { ...on.overrides, [PELVIS]: { position: [0, 0, 0.1] } } }, false);
    expect(off.blocks!.splitTorso).toBeUndefined();
    expect(off.overrides).toEqual(tweaked.overrides);
  });

  it('存档读回来还是分开的；加的体块留着', () => {
    const on = setSplitTorso(addBlock(spec, [{ from: 'Arm_01_L' }]).spec, true);
    const back = parseSpecJson(serializeSpec(on));
    expect(back.blocks).toEqual({ added: [{ id: 1, from: 'Arm_01_L' }], splitTorso: true });
    expect(parseSpecJson(serializeSpec(setSplitTorso(spec, true))).blocks).toEqual({ added: [], splitTorso: true });
  });

  it('两块在界面上叫「胸腔」「胯和小腹」', () => {
    labelSplitTorso(true);
    expect(partLabel(RIBCAGE)).toBe('胸腔');
    expect(partLabel(PELVIS)).toBe('胯和小腹');
    labelSplitTorso(false);
    expect(partLabel(RIBCAGE)).toBe('上半身 中');
    expect(partLabel(PELVIS)).toBe('躯干');
  });
});
