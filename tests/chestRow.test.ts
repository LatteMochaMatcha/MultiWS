// 胸按个数记、每排几个（BodySpec.chestRow）：旧存档的换算、三种身体样式怎么排、描述文字来回
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleCharacter } from '../src/character/assemble';
import { CHARACTER } from '../src/character/load';
import { type CharacterSource, readCharacter } from '../src/character/source';
import { characterParts } from '../src/character/tweak';
import { describeClashes, findClashes } from '../src/geometry/clash';
import type { ChestShape, Figure, Part } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type BodySpec, CHEST_ROW, chestPlan, defaultSpec, normalizeSpec, rowSlots } from '../src/model/spec';
import { applyParse, describeSpec, parseDescription, summarize } from '../src/parser';
import { chestRowMatters } from '../src/parser/describe';
import { compileField, fieldAt } from '../src/sdf/field';
import { useAnimeBody } from './animeBody';

const make = (breasts: number, chestRow: number, rest: Partial<BodySpec> = {}, counts: Partial<BodySpec['counts']> = {}): BodySpec => {
  const d = defaultSpec();
  return normalizeSpec({ ...d, ...rest, chestRow, counts: { ...d.counts, breasts, ...counts } });
};
const chests = (f: Figure): Part[] => f.parts.filter((p) => p.type === 'chest');

describe('胸按个数记、每排几个', () => {
  it('从上往下每排几个：最下面那排少几个', () => {
    expect(chestPlan(0)).toEqual([]);
    expect(chestPlan(1)).toEqual([1]);
    expect(chestPlan(4)).toEqual([2, 2]);
    expect(chestPlan(5)).toEqual([2, 2, 1]);
    expect(chestPlan(6, 3)).toEqual([3, 3]);
    expect(chestPlan(7, 4)).toEqual([4, 3]);
    expect(chestPlan(3, 1)).toEqual([1, 1, 1]);
  });

  it('一排里左右对称：单数时正中一个，成对的从里往外', () => {
    expect(rowSlots(1)).toEqual([{ side: 0, slot: 0 }]);
    expect(rowSlots(2)).toEqual([{ side: 1, slot: 1 }, { side: -1, slot: 1 }]);
    expect(rowSlots(3).map((q) => q.side * q.slot)).toEqual([0, 2, -2]);
    expect(rowSlots(4).map((q) => q.side * q.slot)).toEqual([1, -1, 3, -3]);
  });

  it('默认是一对（两个、每排两个），每排几个收在 1–4', () => {
    const d = defaultSpec();
    expect(d.counts.breasts).toBe(2);
    expect(d.chestRow).toBe(2);
    expect(normalizeSpec({ chestRow: 9 }).chestRow).toBe(CHEST_ROW.max);
    expect(normalizeSpec({ chestRow: 0 }).chestRow).toBe(CHEST_ROW.min);
    expect(normalizeSpec({ chestRow: 'x' }).chestRow).toBe(2);
  });

  it('以前的存档记的是对数：读进来换成个数，每排两个', () => {
    const old = normalizeSpec({ version: 3, counts: { chestPairs: 3 }, torsoCounts: { L: { chestPairs: 0 }, R: { chestPairs: 2, heads: 2 } } });
    expect(old.counts.breasts).toBe(6);
    expect(old.chestRow).toBe(2);
    expect(old.torsoCounts).toEqual({ L: { breasts: 0 }, R: { breasts: 4, heads: 2 } });
    // 新存档照原样
    expect(normalizeSpec({ version: 4, counts: { breasts: 5 }, chestRow: 3 })).toMatchObject({ counts: { breasts: 5 }, chestRow: 3 });
  });
});

describe('白模人台、二次元素体照每排几个摆胸', () => {
  useAnimeBody();

  for (const bodyStyle of ['mannequin', 'anime'] as const) {
    it(`${bodyStyle}：个数对、名字不重复、左右对称、正中的在正中线上`, () => {
      for (const chestRow of [1, 2, 3, 4]) {
        for (const breasts of [1, 2, 3, 5, 6, 7, 8]) {
          const label = `${bodyStyle} ${breasts} 个每排 ${chestRow} 个`;
          const f = buildFigure(make(breasts, chestRow, { bodyStyle }));
          const all = chests(f);
          expect(all, label).toHaveLength(breasts);
          expect(new Set(all.map((p) => p.name)).size, label).toBe(breasts);
          // 每排的个数照 chestPlan：同一个高度上的算一排
          const rows = new Map<string, Part[]>();
          for (const p of all) {
            const prim = p.prims[0] as ChestShape;
            const key = (prim.kind === 'chest' ? (prim.lift ?? 0) : p.pos[1]).toFixed(2);
            rows.set(key, [...(rows.get(key) ?? []), p]);
          }
          const got = [...rows.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).map(([, list]) => list.length);
          // 白模人台的胸往下坠一点（越往下越小，坠得越少）：照高度排好以后每排个数对得上就行
          expect(got, label).toEqual(chestPlan(breasts, chestRow));
          for (const p of all) {
            if (p.side === 0) {
              expect(p.name, label).toMatch(/^Chest_\d+_C$/);
              expect(Math.abs(p.pos[0]), label).toBeLessThan(1e-9);
            } else {
              const twin = all.find((q) => q.name === p.name.replace(/_[LR]$/, p.side > 0 ? '_R' : '_L'));
              expect(twin, `${label} ${p.name}`).toBeDefined();
              expect(twin!.pos[0], label).toBeCloseTo(-p.pos[0], 9);
              expect(twin!.pos[1], label).toBeCloseTo(p.pos[1], 9);
              expect(Math.sign(p.pos[0]), label).toBe(p.side);
            }
          }
        }
      }
    });

    it(`${bodyStyle}：一排三个、四个时每个小一圈，少几个的最下面那排和上面一样大`, () => {
      const size = (p: Part) => {
        const prim = p.prims[0];
        return prim.kind === 'chest' ? (prim.scale?.[0] ?? 1) : prim.kind === 'ellipsoid' ? prim.radii[0] : NaN;
      };
      const pair = size(chests(buildFigure(make(2, 2, { bodyStyle })))[0]);
      for (const [breasts, chestRow] of [[3, 3], [4, 4], [5, 3], [7, 4]] as const) {
        const all = chests(buildFigure(make(breasts, chestRow, { bodyStyle })));
        expect(size(all[0]), `${breasts}/${chestRow}`).toBeLessThan(pair);
        // 二次元素体每排一样大；白模人台往下每排小一成，所以只比第一排
        if (bodyStyle === 'anime') for (const p of all) expect(size(p)).toBeCloseTo(size(all[0]), 9);
      }
    });

    it(`${bodyStyle}：常用的几种排法不穿模`, () => {
      for (const [breasts, chestRow] of [[1, 2], [3, 2], [3, 3], [6, 3], [8, 4], [3, 1]] as const) {
        for (const armLayout of ['stack', 'fan'] as const) {
          const f = buildFigure(make(breasts, chestRow, { bodyStyle, armLayout }, { armPairs: 2 }));
          expect(describeClashes(findClashes(f)), `${bodyStyle} ${breasts}/${chestRow} ${armLayout}`).toBe('');
        }
      }
    });
  }

  it('二次元素体正中的那只左右对称', () => {
    const f = buildFigure(make(1, 2, { bodyStyle: 'anime', shape: { ...defaultSpec().shape, bust: 1.4 } }));
    const part = chests(f)[0];
    expect((part.prims[0] as ChestShape).middle).toBe(true);
    const field = compileField({ scale: 1, parts: [{ ...part, parent: undefined, pos: [0, 0, 0] }] }, { blend: 0 });
    let inside = 0;
    for (let x = 0.005; x < 0.12; x += 0.01) {
      for (let y = -0.08; y <= 0.08; y += 0.02) {
        for (let z = -0.02; z <= 0.12; z += 0.02) {
          const a = fieldAt(field, x, y, z);
          const b = fieldAt(field, -x, y, z);
          // 表面附近（离表面一厘米以内）两边差不到两毫米；离得远的只看里外一样（烤成格子的距离离表面远了不准）
          if (Math.abs(a) < 0.01) expect(Math.abs(b - a), `${x} ${y} ${z}`).toBeLessThan(0.002);
          else expect(Math.sign(b), `${x} ${y} ${z}`).toBe(Math.sign(a));
          if (a < 0) inside++;
        }
      }
    }
    // 真的有东西（不是整个切掉了）
    expect(inside).toBeGreaterThan(20);
  });

  it('好几个上半身：每个上半身各排各的，正中的胸名字不重复', () => {
    const f = buildFigure({ ...make(3, 2, { bodyStyle: 'anime' }, { torsos: 2 }), torsoCounts: { L: { breasts: 5 } } });
    const all = chests(f);
    expect(all).toHaveLength(3 + 5);
    expect(new Set(all.map((p) => p.name)).size).toBe(8);
    expect(all.filter((p) => /_C$/.test(p.name))).toHaveLength(2);
  });

  it('围成一圈时胸还是一对一对的，单数个补成一对', () => {
    const count = (breasts: number, chestRow: number) => chests(buildFigure(make(breasts, chestRow, { bodyStyle: 'anime', ring: 'fused', ringCount: 4, ringChest: 'aligned' }))).length;
    expect(count(4, 2)).toBe(4 * 4);
    expect(count(3, 2)).toBe(4 * 4);
    expect(count(4, 4)).toBe(4 * 4);
  });
});

describe('成品角色的胸', () => {
  let cached: CharacterSource | null = null;
  const source = () => {
    if (!cached) {
      const file = readFileSync(new URL(`../public/${CHARACTER.url}`, import.meta.url));
      cached = readCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, CHARACTER);
    }
    return cached;
  };
  const build = (breasts: number, chestRow: number) => assembleCharacter(source(), make(breasts, chestRow, { bodyStyle: 'character' }));
  const names = (breasts: number, chestRow: number) =>
    characterParts(build(breasts, chestRow))
      .filter((p) => p.type === 'chest')
      .map((p) => p.name)
      .sort();

  it('单数个：多出来的那个摆在正中', () => {
    expect(names(2, 2)).toEqual(['Chest_01_L', 'Chest_01_R']);
    expect(names(4, 2)).toEqual(['Chest_01_L', 'Chest_01_R', 'Chest_02_L', 'Chest_02_R']);
    expect(names(3, 2)).toEqual(['Chest_01_C', 'Chest_01_L', 'Chest_01_R']);
    expect(names(5, 2)).toEqual(['Chest_01_C', 'Chest_01_L', 'Chest_01_R', 'Chest_02_L', 'Chest_02_R']);
    expect(build(3, 2).ignored).toEqual([]);
  });

  it('每排一个：自带的那一对留着、算两个，往下每排正中一个，总数和设的一样', () => {
    expect(names(2, 1)).toEqual(['Chest_01_L', 'Chest_01_R']);
    expect(names(3, 1)).toEqual(['Chest_01_C', 'Chest_01_L', 'Chest_01_R']);
    expect(names(4, 1)).toEqual(['Chest_01_C', 'Chest_01_L', 'Chest_01_R', 'Chest_02_C']);
    expect(build(3, 1).ignored).toEqual([]);
    // 只要一个的时候自带的那一对去不掉：说一声
    expect(build(1, 1).ignored).toContain('第一排只有一个胸');
  });

  it('一排三个、四个排不了：照每排两个排，并说一声', () => {
    const b = build(6, 3);
    expect(b.ignored).toContain('一排三个以上的胸');
    expect(names(6, 3)).toEqual(names(6, 2));
    // 只有一排（两个以内）时没有排不了的
    expect(build(2, 4).ignored).toEqual([]);
  });
});

describe('描述文字里的胸', () => {
  const back = (text: string) => applyParse(defaultSpec(), parseDescription(text));

  it('双数按对写，单数按个写；不是一对一对排的写出每排几个', () => {
    expect(describeSpec(make(4, 2))).toContain('两对胸');
    expect(describeSpec(make(3, 2))).toContain('三个胸');
    expect(describeSpec(make(6, 3))).toBe('一个头，一对手臂，三对胸，一对腿，胸每排三个');
    expect(describeSpec(make(6, 3), 'en')).toBe('1 head, 1 pair of arms, 3 pairs of breasts, 1 pair of legs, breasts in rows of 3');
    expect(describeSpec(make(5, 3), 'ja')).toBe('頭1つ、腕1対、胸5つ、脚1対、胸は段ごとに3つ');
    // 排出来和每排两个一样的不写
    expect(describeSpec(make(2, 4))).toBe('一个头，一对手臂，一对胸，一对腿');
    expect(chestRowMatters(make(2, 4))).toBe(false);
    expect(chestRowMatters(make(2, 1))).toBe(true);
  });

  it('读得懂：几个胸、几对胸、每排几个', () => {
    expect(back('三个胸').counts.breasts).toBe(3);
    expect(back('三对胸').counts.breasts).toBe(6);
    expect(back('五个乳房').counts.breasts).toBe(5);
    expect(back('六个胸，胸每排三个')).toMatchObject({ counts: { breasts: 6 }, chestRow: 3 });
    expect(back('每排三个胸，一共六个胸')).toMatchObject({ counts: { breasts: 6 }, chestRow: 3 });
    expect(back('8 breasts, breasts in rows of 4')).toMatchObject({ counts: { breasts: 8 }, chestRow: 4 });
    expect(back('6 breasts, 3 per row')).toMatchObject({ counts: { breasts: 6 }, chestRow: 3 });
    expect(back('胸6つ、胸は段ごとに3つ')).toMatchObject({ counts: { breasts: 6 }, chestRow: 3 });
    // 没说每排几个就是一对一对的
    expect(back('三对胸').chestRow).toBe(2);
    // 「每排两根」是阴茎的，不是胸的
    expect(back('两对胸，四根阴茎，阴茎每排两根')).toMatchObject({ counts: { breasts: 4, penises: 4 }, chestRow: 2, penisRow: 2 });
  });

  it('写出来再读回去还是同一个设定（三种语言）', () => {
    for (const lang of ['zh', 'en', 'ja'] as const) {
      for (let breasts = 0; breasts <= 20; breasts++) {
        for (const chestRow of [1, 2, 3, 4]) {
          const spec = make(breasts, chestRow);
          const text = describeSpec(spec, lang);
          const got = applyParse(defaultSpec(), parseDescription(text));
          expect(got.counts.breasts, text).toBe(breasts);
          if (chestRowMatters(spec)) expect(got.chestRow, text).toBe(chestRow);
          expect(describeSpec(got, lang), text).toBe(text);
        }
      }
    }
  });

  it('识别标签：一对一对的写几对，别的写出每排几个', () => {
    const chip = (spec: BodySpec) => summarize(spec).find((c) => c.key === 'breasts')?.label;
    expect(chip(make(4, 2))).toBe('胸 2 对');
    expect(chip(make(3, 2))).toBe('胸 2+1 个');
    expect(chip(make(6, 3))).toBe('胸 3+3 个');
    expect(chip(make(1, 2))).toBe('胸 1 个');
    expect(chip(make(0, 2))).toBe('平胸');
  });
});
