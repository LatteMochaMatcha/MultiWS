// 楚云萱用体块拼（docs/chu-blocks-plan.md）：九副胯、六个带头的胸腔、三个光胸腔，都是能单独动的体块
import { describe, expect, it } from 'vitest';
import { findClashes } from '../src/geometry/clash';
import { type Figure, worldTransforms } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { isPelvis } from '../src/geometry/pelvis';
import { rotate } from '../src/geometry/vec';
import { CHEST_ROWS, CHU, chuSpec } from '../src/model/chu';
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
      expect(Math.abs(pos[2]), head.name).toBeCloseTo(CHU.headBack, 2);
      expect([0, CHU.headApart].some((x) => Math.abs(Math.abs(pos[0]) - x) < 0.01), head.name).toBe(true);
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

  it('胸前后两面各 15 只：从上到下 6、5、4 只，隔一排错开，都是整只的原胸型（不是圆包）；照各自的胸腔往外撇、绕到身子两侧', () => {
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
    for (const side of [1, -1]) {
      const face = chests.filter((p) => Math.sign(at.get(p.name)!.pos[2]) === side).sort((a, b) => at.get(b.name)!.pos[1] - at.get(a.name)!.pos[1]);
      expect(face).toHaveLength(15);
      // 从高到低分成 6、5、4 只的三排，每排里从左到右
      let from = 0;
      const rows = CHEST_ROWS.map((count) => face.slice(from, (from += count)).sort((a, b) => at.get(a.name)!.pos[0] - at.get(b.name)!.pos[0]));
      const xOf = (p: { name: string }) => at.get(p.name)!.pos[0];
      const yOf = (p: { name: string }) => at.get(p.name)!.pos[1];
      /** 这只胸的脸朝哪 */
      const out = (p: { name: string }) => rotate(at.get(p.name)!.quat, [0, 0, 1]);
      rows.forEach((row, r) => {
        // 一排差不多一样高，和下一排分得开
        expect(Math.max(...row.map(yOf)) - Math.min(...row.map(yOf))).toBeLessThan(0.03);
        if (r > 0) expect(Math.min(...rows[r - 1].map(yOf)) - Math.max(...row.map(yOf))).toBeGreaterThan(0.1);
        // 左右对称，一只挨一只（不叠在一起、也不隔开一只多）
        row.forEach((p, i) => expect(xOf(p) + xOf(row[row.length - 1 - i]), p.name).toBeCloseTo(0, 2));
        for (let i = 1; i < row.length; i++) {
          expect(xOf(row[i]) - xOf(row[i - 1]), row[i].name).toBeGreaterThan(0.08);
          // 一只胸鼓出来的那一块二十厘米上下宽（第二排照 chestGrow 放大了）：一只挨一只，中间不露身体
          expect(xOf(row[i]) - xOf(row[i - 1]), row[i].name).toBeLessThan(0.2 * CHU.chestGrow[r]);
        }
        // 和上一排错开：每只都在上一排相邻两只的中间（两头那只绕到侧面去了，从正面量不出来，不算）
        if (r > 0) row.slice(1, -1).forEach((p, n) => {
          expect(xOf(p), p.name).toBeGreaterThan(xOf(rows[r - 1][n + 1]));
          expect(xOf(p), p.name).toBeLessThan(xOf(rows[r - 1][n + 2]));
        });
        // 上面两排排到身子两边（外扩）：两头那只在两头那副胯的正前方；最下面一排不放大、往中间收到挨着，窄一些
        expect(xOf(row[row.length - 1]), `第 ${r + 1} 排`).toBeGreaterThan(r < 2 ? 0.3 : 0.25);
        // 脸朝这一面的外面；越靠两头越往外撇，两头那只朝着旁边——上面两排的快到正侧面了（七十多度），最下面一排五十多度
        const half = row.slice(Math.floor(row.length / 2));
        for (const p of row) expect(out(p)[2] * side, p.name).toBeGreaterThan(0.1);
        // （长在从胯上渐渐分出去的胸腔上的胸，部件的摆放里带着那一段在它那个高度上退回去的一点转动，见 clone.ts 的 plainPieces：
        //   和摆位时定的朝向差几度，所以相邻两只之间让 0.15）
        for (let i = 1; i < half.length; i++) expect(out(half[i])[0], half[i].name).toBeGreaterThan(out(half[i - 1])[0] - 0.15);
        // 正面第二排两头那只实际只撇到三十多度：它长在从胯上渐渐分出去的胸腔上、摆在腰那么高，那一段在这个高度上还没分足，
        // 把它往回转了四十来度（他认可的图里就是这样，没动；背面的胸腔是整块接的，没有这回事）
        const turned = r === 1 && side > 0 ? 0.5 : r < 2 ? 0.9 : 0.6;
        expect(out(row[row.length - 1])[0], `第 ${r + 1} 排`).toBeGreaterThan(turned);
        expect(out(row[0])[0], `第 ${r + 1} 排`).toBeLessThan(-turned);
        // 每排多大照 chestGrow：第二排大一点，最下面一排和第一排一样大
        for (const p of row) expect(figure.parts.find((q) => q.name === p.name)!.scale, p.name).toBeCloseTo(CHU.chestScale * CHU.chestGrow[r], 9);
      });
    }
    // 每个胸腔本来正中的那一只都不要了
    expect(Object.entries(spec.overrides).filter(([name, o]) => /^Chest_/.test(name) && o.hidden)).toHaveLength(9);
  });

  it('上半身不拉长：胸腔上不排胸，头和只有一排胸的人一样高；最下面一排胸的中心在大腿根那么高', () => {
    const hipY = Math.max(...of(figure, 'leg').filter((p) => p.parent === undefined).map((p) => at.get(p.name)!.pos[1]));
    const ys = of(figure, 'chest').map((p) => at.get(p.name)!.pos[1]);
    // 裆比髋关节低几厘米：最下面一排的中心比髋关节高 chestLow
    // （同上，带着退回去的那一点挪动：差不到一厘米）
    expect(Math.abs(Math.min(...ys) - hipY - CHU.chestLow * figure.scale)).toBeLessThan(0.01);
    const top = Math.max(...of(figure, 'head').map((p) => at.get(p.name)!.pos[1])) + 0.11;
    expect(hipY / top).toBeGreaterThan(0.52);
    const single = buildFigure(normalizeSpec({ ...base(), counts: { ...base().counts, breasts: 2 }, shape: spec.shape }));
    const natural = worldTransforms(single);
    expect(Math.abs(top - 0.11 - natural.get('Head_01')!.pos[1])).toBeLessThan(0.03);
    // 最上面一排比本来的胸口高 chestTop
    const chest = single.parts.find((p) => p.type === 'chest')!;
    expect(Math.max(...ys) - natural.get(chest.name)!.pos[1]).toBeCloseTo(CHU.chestTop * figure.scale, 2);
  });

  it('静止时没有穿模报警；骨架只有一根根骨骼', () => {
    // 整只搬过去的胸是坐进身体表面、一只挨一只排的，和胯、旁边的胸腔、肩膀底下的手臂根挨着不算穿模（见 clone.ts 的 PIECE_FREE）
    expect(findClashes(figure).map((c) => `${c.a}×${c.b}`)).toEqual([]);
    const bones = buildSkeleton(figure).bones;
    expect(bones.filter((b) => b.parent === undefined || b.parent === null || (b.parent as unknown) === -1)).toHaveLength(1);
  });

  it('转过去的胸腔（中间一排两头、后排）整块接在胯上，腰不拧；没转多少的（前排、中间一排正中）还是从胯上渐渐分出去', () => {
    const forked = (name: string) => figure.parts.find((p) => p.name === name)!.prims.some((q) => (q.kind === 'grid' || q.kind === 'loft') && !!q.fork);
    const entries = Object.entries(spec.blocks!.attach!);
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
    expect(Object.keys(spec.blocks!.attach ?? {})).toHaveLength(9);
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
