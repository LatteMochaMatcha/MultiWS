// 楚云萱用体块拼（docs/chu-blocks-plan.md）：九副胯、六个带头的胸腔、三个光胸腔，都是能单独动的体块
import { describe, expect, it } from 'vitest';
import { findClashes } from '../src/geometry/clash';
import { type Figure, worldTransforms } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { isPelvis } from '../src/geometry/pelvis';
import { rotate } from '../src/geometry/vec';
import { CHEST_ROWS, CHU, CHU_CHESTS, chuRefit, chuSpec } from '../src/model/chu';
import { PRESETS, applyPreset } from '../src/model/presets';
import { type BodySpec, defaultSpec, normalizeSpec } from '../src/model/spec';
import { buildSkeleton } from '../src/rig/skeleton';
import { useAnimeBody } from './animeBody';

useAnimeBody();

const base = (bodyStyle: BodySpec['bodyStyle'] = 'anime'): BodySpec => normalizeSpec({ ...defaultSpec(), bodyStyle });
const spec = chuSpec(base());
const figure = buildFigure(spec);
const at = worldTransforms(figure);
const of = (f: Figure, type: string) => f.parts.filter((p) => p.type === type);
/** 胸腔（原来那个和复制出来的；整块接在胯上的那些不带「从胯上分出去」那一段，照名字认） */
const isRib = (p: { name: string; type: string }) => p.type === 'torso' && /^UpperBody(_\d+)?$/.test(p.name);

describe('楚云萱用体块拼', () => {
  it('九副胯各带一双腿，排成前、中、后三排、每排三副，都朝正前', () => {
    const pelvises = figure.parts.filter(isPelvis);
    expect(pelvises).toHaveLength(9);
    for (const p of pelvises) {
      // 腿根上那根骨骼接在这副胯自己的骨骼上
      const own = new Set((p.bones ?? []).map((b) => b.name));
      expect(of(figure, 'leg').filter((leg) => leg.parent === undefined && own.has(leg.bones?.[0]?.parent ?? '')), p.name).toHaveLength(2);
      // 朝正前：自己的 +Z 在世界里还是朝前的，只是连腿往中间斜了一点
      const front = rotate(at.get(p.name)!.quat, [0, 0, 1]);
      expect(front[2], p.name).toBeGreaterThan(0.99);
      expect(Math.abs(front[0]), p.name).toBeLessThan(1e-6);
    }
    const xs = [...new Set(pelvises.map((p) => Math.round(at.get(p.name)!.pos[0] * 100)))].sort((a, b) => a - b);
    expect(xs).toHaveLength(3);
    expect(xs[1]).toBe(0);
    expect(xs[0]).toBe(-xs[2]);
  });

  it('相邻两副胯贴着、不叠：左右隔一副胯连大腿那么宽，前后隔一副那么厚', () => {
    const legs = of(figure, 'leg').filter((p) => p.parent === undefined && p.side > 0);
    const xs = [...new Set(legs.map((p) => Math.round(at.get(p.name)!.pos[0] * 1000)))].sort((a, b) => a - b);
    const zs = [...new Set(legs.map((p) => Math.round(at.get(p.name)!.pos[2] * 1000)))].sort((a, b) => a - b);
    expect(xs).toHaveLength(3);
    expect(zs).toHaveLength(3);
    // 一副胯连大腿三十厘米上下宽、十几二十厘米厚（髋关节那么高上量；脚比这分得开，连腿往中间斜着）
    expect((xs[2] - xs[1]) / 1000).toBeGreaterThan(0.27);
    expect((xs[2] - xs[1]) / 1000).toBeLessThan(0.36);
    expect((zs[2] - zs[1]) / 1000).toBeGreaterThan(0.14);
    expect((zs[2] - zs[1]) / 1000).toBeLessThan(0.24);
  });

  it('六个头：前排三个朝前、后排三个朝后，背对背凑成一簇，落在定好的位置上', () => {
    const heads = of(figure, 'head');
    expect(heads).toHaveLength(6);
    expect(of(figure, 'neck')).toHaveLength(6);
    for (const head of heads) {
      const { pos, quat } = at.get(head.name)!;
      const row = Math.sign(pos[2]);
      // 两边的胸腔往里挪了半列（CHU.ribX），头的前后跟着差一两厘米
      expect(Math.abs(Math.abs(pos[2]) - CHU.headBack), head.name).toBeLessThan(0.025);
      // 正中两个在正中；两边四个本来落在离正中 headApart 的地方，脖子扳成竖直以后（chu.ts 的 upright）往外让了几厘米
      const x = Math.abs(pos[0]);
      // （每面两个胸腔的时候两边的胸腔差不多直着，脖子本来就差不多竖直，几乎不让）
      // （往里挪得多的时候脖子扳竖直反而往里收两三厘米）
      expect(x < 0.01 || (x > CHU.headApart - 0.03 && x < CHU.headApart + 0.06), head.name).toBe(true);
      // 脸朝自己那一排的外面
      expect(rotate(quat, [0, 0, 1])[2] * row, head.name).toBeGreaterThan(0.5);
    }
    expect(heads.filter((h) => at.get(h.name)!.pos[2] > 0)).toHaveLength(3);
  });

  it('九个胸腔各接在自己那副胯上；中间一排的是光的（没有头、手臂、胸）', () => {
    const ribs = figure.parts.filter(isRib);
    expect(ribs).toHaveLength(9);
    expect(new Set(ribs.map((p) => p.parent)).size).toBe(9);
    for (const rib of ribs) expect(isPelvis(figure.parts.find((p) => p.name === rib.parent)!), rib.name).toBe(true);
    const bare = ribs.filter((rib) => !figure.parts.some((p) => p.parent === rib.name));
    expect(bare).toHaveLength(3);
    for (const rib of bare) expect(Math.abs(at.get(rib.parent!)!.pos[2]), rib.name).toBeLessThan(0.02);
  });

  it('手臂十二条：左右各六条（前排三条、后排三条），都长在两头的胸腔上', () => {
    const arms = of(figure, 'arm').filter((p) => isRib(figure.parts.find((q) => q.name === p.parent)!));
    expect(arms).toHaveLength(12);
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        expect(arms.filter((p) => Math.sign(at.get(p.name)!.pos[0]) === sx && Math.sign(at.get(at.has(p.parent!) ? figure.parts.find((q) => q.name === p.parent)!.parent! : p.parent!)!.pos[2]) === sz)).toHaveLength(3);
      }
    }
  });

  it('胸前后两面各 15 只：从上到下 6、5、4 只，都是整只的原胸型；照他手调好的那一面摆，前面和背面一样', () => {
    const chests = of(figure, 'chest');
    expect(chests).toHaveLength(30);
    for (const p of chests) {
      // 整只搬过去的原胸型：不贴在哪个胸腔的表面上，只取胸根以内的那一块
      expect(p.surface, p.name).toBeFalsy();
      expect(p.prims.map((q) => q.kind), p.name).toEqual(['chest']);
      expect(p.prims.every((q) => q.kind === 'chest' && q.piece === true && q.middle === true), p.name).toBe(true);
      // 挂在一个带头的胸腔上，跟着它动
      expect(isRib(figure.parts.find((q) => q.name === p.parent)!), p.name).toBe(true);
    }
    const faces = [1, -1].map((side) => chests.filter((p) => Math.sign(at.get(p.name)!.pos[2]) === side).sort((a, b) => at.get(b.name)!.pos[1] - at.get(a.name)!.pos[1]));
    for (const face of faces) {
      expect(face).toHaveLength(15);
      // 从高到低分成 6、5、4 只的三排，一排比一排低
      let from = 0;
      const rows = CHEST_ROWS.map((count) => face.slice(from, (from += count)));
      const yOf = (p: { name: string }) => at.get(p.name)!.pos[1];
      rows.forEach((row, r) => {
        expect(Math.max(...row.map(yOf)) - Math.min(...row.map(yOf)), `第 ${r + 1} 排`).toBeLessThan(0.08);
        if (r > 0) expect(Math.min(...rows[r - 1].map(yOf)) - Math.max(...row.map(yOf)), `第 ${r + 1} 排`).toBeGreaterThan(0.03);
      });
    }
    // 后排是前排整个绕竖轴转了半圈：前面每一只在背面都有一只在转过去的那个位置上
    // （前排的胸腔是从胯上渐渐分出去的，带着那一段退回去的一点挪动，见 clone.ts 的 plainPieces：差两三厘米）
    for (const p of faces[0]) {
      const [x, y, z] = at.get(p.name)!.pos;
      const twin = Math.min(...faces[1].map((q) => Math.hypot(at.get(q.name)!.pos[0] + x, at.get(q.name)!.pos[1] - y, at.get(q.name)!.pos[2] + z)));
      expect(twin, p.name).toBeLessThan(0.06);
    }
    // 位置、朝向、大小是照抄的：每一只的微调就是 CHU_CHESTS 里的那一条，前后两面各用一遍
    const tuned = Object.entries(spec.overrides).filter(([name, o]) => /^Chest_/.test(name) && !o.hidden);
    expect(tuned).toHaveLength(30);
    for (const e of CHU_CHESTS) expect(tuned.filter(([, o]) => JSON.stringify(o.scale) === JSON.stringify(e.scale) && JSON.stringify(o.rotation) === JSON.stringify(e.rotation) && JSON.stringify(o.position) === JSON.stringify(e.position)).length % 2, JSON.stringify(e)).toBe(0);
    // 每个胸腔本来正中的那一只都不要了
    expect(Object.entries(spec.overrides).filter(([name, o]) => /^Chest_/.test(name) && o.hidden)).toHaveLength(9);
  });

  it('上半身是腿的 CHU.upper 倍：躯干在小腹那一段接长（躯干长短），身高还是设定的那么高；最下面一排胸在屁股上面', () => {
    expect(spec.shape.torso).toBeGreaterThan(1.2);
    expect(figure.metrics.height).toBeCloseTo(spec.shape.height, 1);
    // 头顶到裆、裆到地面（米）：裆比髋关节低四五厘米
    const hipY = Math.max(...of(figure, 'leg').filter((p) => p.parent === undefined).map((p) => at.get(p.name)!.pos[1]));
    const crotch = hipY - 0.045;
    const top = Math.max(...of(figure, 'head').map((p) => at.get(p.name)!.pos[1])) + 0.11;
    expect(Math.abs(top - crotch - CHU.upper * crotch)).toBeLessThan(0.06);
    // 屁股最鼓的地方在髋关节上下：最下面一排胸的中心比髋关节高出十厘米以上，不压在屁股上
    const ys = of(figure, 'chest').map((p) => at.get(p.name)!.pos[1]);
    expect(Math.min(...ys) - hipY).toBeGreaterThan(0.1);
    // 躯干长短调回 1（照体块平常的规矩重新摆）：胸跟着胸口落回去，又到胯那么高了
    const short = buildFigure(chuRefit(spec, { ...spec, shape: { ...spec.shape, torso: 1 } }));
    const low = Math.min(...of(short, 'chest').map((p) => worldTransforms(short).get(p.name)!.pos[1]));
    expect(low - Math.max(...of(short, 'leg').filter((p) => p.parent === undefined).map((p) => worldTransforms(short).get(p.name)!.pos[1]))).toBeLessThan(0.08);
  });

  it('静止时没有穿模报警；骨架只有一根根骨骼', () => {
    // 整只搬过去的胸是坐进身体表面、一只挨一只排的，和胯、旁边的胸腔、肩膀底下的手臂根挨着不算穿模（见 clone.ts 的 PIECE_FREE）
    expect(findClashes(figure).map((c) => `${c.a}×${c.b}`)).toEqual([]);
    const bones = buildSkeleton(figure).bones;
    expect(bones.filter((b) => b.parent === undefined || b.parent === null || (b.parent as unknown) === -1)).toHaveLength(1);
  });

  it('转过去的胸腔（中间一排两头、后排）整块接在胯上，腰不拧；没转多少的（前排、中间一排正中）还是从胯上渐渐分出去', () => {
    const forked = (name: string) => figure.parts.find((p) => p.name === name)!.prims.some((q) => (q.kind === 'grid' || q.kind === 'loft') && !!q.fork);
    // 只看胸腔的（另外有四只胸是整只缝在胸腔上的，见下一条）
    const entries = Object.entries(spec.blocks!.attach!).filter(([name]) => /^UpperBody/.test(name));
    expect(entries).toHaveLength(9);
    expect(entries.filter(([, a]) => a.whole)).toHaveLength(5);
    for (const [name, a] of entries) {
      // 相对它那副胯转了多少：胸腔自己的正前在胯的正前上还剩多少
      const turned = rotate(a.quat, [0, 0, 1])[2] < 0.5;
      expect(!!a.whole, name).toBe(turned);
      expect(forked(name), name).toBe(!turned);
      // 转、缩放还是绕着腰
      expect(figure.parts.find((p) => p.name === name)!.pivot, name).toBeDefined();
    }
  });

  it('每一块都是体块：胯、胸腔是照原来那副复制的，摆位记在缝合和手动微调里，没有用围成一圈', () => {
    expect(spec.ring).toBe('none');
    expect(spec.blocks?.splitTorso).toBe(true);
    expect(spec.blocks!.added.filter((b) => b.from === 'Torso')).toHaveLength(8);
    expect(spec.blocks!.added.filter((b) => b.from === 'UpperBody')).toHaveLength(8);
    // 30 只胸都是照胸腔正中那只整只复制的
    expect(spec.blocks!.added.filter((b) => b.piece)).toHaveLength(30);
    // 九个胸腔各接在自己那副胯上；每面第二排两头那只胸是整只缝在胸腔上的（他手调时接上去的），前后一共四只
    expect(Object.keys(spec.blocks!.attach ?? {}).filter((name) => /^UpperBody/.test(name))).toHaveLength(9);
    // 缝在胸腔上的 4 只，加上挂在往里挪过的胸腔上、照原位换算过去的 8 只（chu.ts 的 shifted；有 4 只两样都是）
    expect(Object.keys(spec.blocks!.attach ?? {}).filter((name) => /^Chest_/.test(name))).toHaveLength(8);
    // 存成设定再读回来还是一样的
    expect(buildFigure(normalizeSpec(JSON.parse(JSON.stringify(spec)))).parts.length).toBe(figure.parts.length);
  });

  it('预设「楚云萱」：二次元素体上是体块拼的这一套，白模人台、成品角色还是围成一圈里的前后排', () => {
    const preset = PRESETS.find((p) => p.name === '楚云萱')!;
    const made = applyPreset(base(), preset);
    expect(made.ring).toBe('none');
    expect(made.blocks).toEqual(spec.blocks);
    expect(made.overrides).toEqual(spec.overrides);
    expect(made.counts).toEqual(spec.counts);
    expect(made.shape).toEqual(spec.shape);
    // 套预设以前手工加的体块、微调不带过来
    const dirty = applyPreset({ ...base(), overrides: { Head_01: { hidden: true } }, blocks: { added: [{ id: 7, from: 'Arm_01_L' }] } }, preset);
    expect(dirty.blocks).toEqual(spec.blocks);
    expect(dirty.overrides).toEqual(spec.overrides);
    for (const style of ['mannequin', 'character'] as const) {
      const old = applyPreset(base(style), preset);
      expect(old.ring, style).toBe('rows');
      expect(old.blocks, style).toEqual({ added: [] });
      expect(old.counts.breasts, style).toBe(6);
    }
  });

  it('白模人台也拼得出来（摆位没照它调过，预设里不用）：九副胯、六个头', () => {
    const f = buildFigure(chuSpec(base('mannequin')));
    expect(f.parts.filter(isPelvis)).toHaveLength(9);
    expect(of(f, 'head')).toHaveLength(6);
  });
});
