// 楚云萱（用体块拼的，docs/chu-blocks-plan.md 第 5 期）套完以后接着改：删体块、拖体型滑块、改头和手臂的数量；
// 分部件时形状一样的部件共用一份网格；一条腿时复制出来的胯各带各的垫块
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { addBlock, removeBlockAt, setSplitTorso } from '../src/model/blocks';
import { chuBlocks, chuRefit, chuSpec } from '../src/model/chu';
import { hidePart, setOverride } from '../src/model/overrides';
import { PRESETS, applyPreset, styledPreset } from '../src/model/presets';
import { type BodySpec, defaultSpec, normalizeSpec, serializeSpec } from '../src/model/spec';
import { PartsModel } from '../src/view/partsModel';
import { useAnimeBody } from './animeBody';

useAnimeBody();

const base = (): BodySpec => normalizeSpec({ ...defaultSpec(), bodyStyle: 'anime' });
const spec = chuSpec(base());
const figure = buildFigure(spec);
const count = (s: BodySpec, type: string) => buildFigure(s).parts.filter((p) => p.type === type).length;
const names = (s: BodySpec) => new Set(buildFigure(s).parts.map((p) => p.name));

describe('楚云萱：删体块', () => {
  it('删一只整只的胸：只少它一只', () => {
    const out = removeBlockAt(spec, figure, 'Chest_2501_C');
    expect(count(out, 'chest')).toBe(29);
    expect(buildFigure(out).parts).toHaveLength(figure.parts.length - 1);
    expect(out.overrides.Chest_2501_C).toBeUndefined();
  });

  it('删一个胸腔：它的头、手臂和挂在它上面的胸一起走，胯和腿还在', () => {
    const out = removeBlockAt(spec, figure, 'UpperBody_901');
    const left = names(out);
    for (const gone of ['UpperBody_901', 'Head_901', 'Neck_901', 'Chest_2501_C']) expect(left.has(gone), gone).toBe(false);
    expect(left.has('Torso_101')).toBe(true);
    expect(count(out, 'head')).toBe(5);
    expect(count(out, 'leg')).toBe(18);
    // 正中那个胸腔上挂着十一只胸（上排四只、中排三只、下排四只）
    expect(count(out, 'chest')).toBe(19);
  });

  it('删一副胯：接在它上面的胸腔（连同头、手臂、胸）跟着走，不会回到正中那副胯上多出一个上半身', () => {
    const out = removeBlockAt(spec, figure, 'Torso_201');
    const left = names(out);
    for (const gone of ['Torso_201', 'Leg_201_L', 'Leg_201_R', 'UpperBody_1001', 'Head_1001', 'Arm_1001_L', 'Chest_2201_C', 'Chest_2701_C']) expect(left.has(gone), gone).toBe(false);
    expect(count(out, 'torso')).toBe(16);
    expect(count(out, 'head')).toBe(5);
    expect(count(out, 'arm')).toBe(9);
    expect(count(out, 'chest')).toBe(28);
    // 记在这些部件上的微调、缝合也清掉了：号以后再用到时不会带着旧的
    expect(Object.keys(out.overrides).filter((k) => /_(2|10)\d\d(_|$)/.test(k))).toEqual([]);
    expect(out.blocks!.attach!.UpperBody_1001).toBeUndefined();
    // 照它上面那只删掉了的胸复制的两块也不留在设定里
    expect(out.blocks!.added.filter((b) => /_10\d\d_/.test(b.from))).toEqual([]);
    expect(out.blocks!.added).toHaveLength(spec.blocks!.added.length - 4);
    // 别的八个人原样
    for (const kept of ['Torso_301', 'UpperBody_1101', 'Head_1101', 'UpperBody_1201']) expect(left.has(kept), kept).toBe(true);
  });

  it('删头、手臂、腿（不是领头的那个部件）是记成「已删除」', () => {
    for (const [name, type] of [['Head_1001', 'head'], ['Arm_1002_L', 'arm'], ['Leg_201_L', 'leg']] as const) {
      const out = hidePart(spec, name);
      expect(count(out, type), name).toBe(count(spec, type) - 1);
      expect(out.blocks).toBe(spec.blocks);
    }
  });
});

describe('楚云萱：套完以后拖体型滑块、改头和手臂的数量', () => {
  const fat: BodySpec = { ...spec, shape: { ...spec.shape, thighs: 1.8 } };

  it('没手动动过：照新的体型重新摆（大腿粗了，九副胯隔得开了）', () => {
    const out = chuRefit(spec, fat);
    expect(out.blocks).not.toBe(spec.blocks);
    expect(out.shape.thighs).toBe(1.8);
    const step = (s: BodySpec) => s.blocks!.added.find((b) => b.from === 'Torso' && (b.shift?.[0] ?? 0) > 0)!.shift![0];
    expect(step(out)).toBeGreaterThan(step(spec) + 0.01);
    expect(out.blocks!.added).toHaveLength(spec.blocks!.added.length);
    expect(buildFigure(out).parts).toHaveLength(figure.parts.length);
    // 和直接照新体型拼出来的一样
    expect(JSON.stringify(out.blocks)).toBe(JSON.stringify(chuBlocks(fat).blocks));
  });

  it('存档读回来（微调、缝合的数去掉了多余的小数）以后照样认得出是原样', () => {
    const loaded = normalizeSpec(JSON.parse(serializeSpec(spec)));
    const out = chuRefit(loaded, { ...loaded, shape: { ...loaded.shape, thighs: 1.1 } });
    expect(out.blocks).not.toBe(loaded.blocks);
  });

  it('手动挪过、删过、加过体块的不重摆（重摆会把这些改动冲掉）', () => {
    for (const touched of [
      setOverride(spec, 'Chest_2501_C', { ...spec.overrides.Chest_2501_C, position: [0, 0, 0.05] }),
      hidePart(spec, 'Arm_1002_L'),
      removeBlockAt(spec, figure, 'Chest_2501_C'),
      addBlock(spec, [{ from: 'Arm_1003_L', shift: [0, -0.11, 0] }]).spec,
    ]) {
      const now = { ...touched, shape: { ...touched.shape, thighs: 1.1 } };
      expect(chuRefit(touched, now)).toBe(now);
    }
  });

  it('不是楚云萱的体块、没有体块的照旧', () => {
    const plain = base();
    const now = { ...plain, shape: { ...plain.shape, thighs: 1.1 } };
    expect(chuRefit(plain, now)).toBe(now);
    const own = addBlock(setSplitTorso(plain, true), [{ from: 'Torso', shift: [0.3, 0, 0] }]).spec;
    const next = { ...own, shape: { ...own.shape, thighs: 1.1 } };
    expect(chuRefit(own, next)).toBe(next);
  });

  it('头、手臂的数量改了也重摆：中间一排的光胸腔不长头和手臂，手臂只留朝外那一侧的', () => {
    const heads = chuRefit(spec, { ...spec, counts: { ...spec.counts, heads: 2 } });
    expect(count(heads, 'head')).toBe(12);
    for (const [pairs, arms] of [[1, 4], [2, 8], [4, 16]] as const) {
      const out = chuRefit(spec, { ...spec, counts: { ...spec.counts, armPairs: pairs } });
      expect(count(out, 'arm'), `${pairs} 对`).toBe(arms);
      expect(count(out, 'chest')).toBe(30);
    }
  });

  it('腿、胸的数量改了不重摆（换了一种下身、一种胸，预设的摆法套不上去）；改成围成一圈也不动它', () => {
    for (const now of [
      { ...spec, counts: { ...spec.counts, legs: 4 } },
      { ...spec, counts: { ...spec.counts, breasts: 2 } },
      { ...spec, ring: 'rows' as const },
    ]) expect(chuRefit(spec, now)).toBe(now);
  });
});

describe('分部件：形状一样的部件共用一份网格', () => {
  it('楚云萱三十只胸只算一份，十八条腿两份', () => {
    const model = new PartsModel();
    model.update(figure);
    const geometries = (type: string) => {
      const wanted = new Set(figure.parts.filter((p) => p.type === type).map((p) => p.name));
      const seen = new Set<unknown>();
      model.root.traverse((o) => {
        if (wanted.has(o.name)) seen.add((o as unknown as { geometry: unknown }).geometry);
      });
      return seen.size;
    };
    expect(geometries('chest')).toBe(1);
    expect(geometries('leg')).toBe(2);
    // 再画一遍照用上一遍的
    const before = new Set<unknown>();
    model.root.traverse((o) => before.add((o as unknown as { geometry?: unknown }).geometry));
    model.update(figure);
    model.root.traverse((o) => expect(before.has((o as unknown as { geometry?: unknown }).geometry)).toBe(true));
  });
});

describe('一条腿的二次元素体复制胯', () => {
  it('每副胯各带自己的一条腿和腿根两边的垫块，不把别的胯的垫块又带一份', () => {
    let s = setSplitTorso(normalizeSpec({ ...base(), counts: { ...base().counts, legs: 1 } }), true);
    for (let i = 1; i <= 4; i++) {
      s = addBlock(s, [{ from: 'Torso', shift: [0.3 * i, 0, 0] }]).spec;
      const parts = buildFigure(s).parts;
      expect(parts.filter((p) => p.type === 'lower'), `${i + 1} 副胯`).toHaveLength(2 * (i + 1));
      expect(parts.filter((p) => p.type === 'leg')).toHaveLength(i + 1);
    }
    // 楚云萱的腿改成一条：九副胯十八个垫块（以前是五百多个）
    const one = buildFigure(normalizeSpec({ ...spec, counts: { ...spec.counts, legs: 1 } })).parts;
    expect(one.filter((p) => p.type === 'lower')).toHaveLength(18);
  });
});

describe('换身体样式：楚云萱照新的样式重新套', () => {
  const chu = PRESETS.find((p) => p.build)!;
  const plain = normalizeSpec(defaultSpec());

  it('刚套上去的原样认得出来（两种拼法都认，存档读回来也认）；别的预设、默认的身体、套完又改过的不认', () => {
    const rows = applyPreset(plain, chu);
    expect(rows.ring).toBe('rows');
    expect(styledPreset(rows)).toBe(chu);
    // 页面上是点预设套出来的（预设自己的围成一圈那几项也带着），不是直接 chuSpec 的
    const built = applyPreset(base(), chu);
    expect(built.blocks!.added.length).toBe(spec.blocks!.added.length);
    expect(styledPreset(built)).toBe(chu);
    expect(styledPreset(normalizeSpec(JSON.parse(serializeSpec(built))))).toBe(chu);
    expect(styledPreset(normalizeSpec(JSON.parse(serializeSpec(rows))))).toBe(chu);
    expect(styledPreset(plain)).toBeNull();
    expect(styledPreset(applyPreset(plain, PRESETS[1]))).toBeNull();
    expect(styledPreset({ ...rows, counts: { ...rows.counts, heads: 2 } })).toBeNull();
    expect(styledPreset(hidePart(built, 'Arm_1002_L'))).toBeNull();
    expect(styledPreset({ ...built, shape: { ...built.shape, thighs: 1.2 } })).toBeNull();
  });

  it('白模人台上的前后排换到二次元素体是体块拼的，换回去又是前后排', () => {
    const rows = applyPreset(plain, chu);
    const blocks = applyPreset({ ...rows, bodyStyle: 'anime' }, styledPreset(rows)!);
    expect(blocks.ring).toBe('none');
    expect(blocks.blocks!.added.length).toBe(spec.blocks!.added.length);
    const back = applyPreset({ ...blocks, bodyStyle: 'mannequin' }, styledPreset(blocks)!);
    expect(back.ring).toBe('rows');
    expect(back.blocks!.added).toEqual([]);
    expect(back.overrides).toEqual({});
  });
});

