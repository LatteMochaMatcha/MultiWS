// 人腿横排多胯：几副完整的胯左右并排，每副胯两条腿（单数时正中那副一条）；三种身体样式、描述文字
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleCharacter } from '../src/character/assemble';
import { CHARACTER } from '../src/character/load';
import { type CharacterSource, readCharacter } from '../src/character/source';
import { buildFigure } from '../src/geometry/layout';
import { type BodyCounts, type BodySpec, defaultSpec, legPlan } from '../src/model/spec';
import { applyParse, describeSpec, parseDescription } from '../src/parser';
import { summarize } from '../src/parser/describe';
import { fuseParts } from '../src/sdf/fuse';
import { useAnimeBody } from './animeBody';

const make = (counts: Partial<BodyCounts>, rest: Partial<BodySpec> = {}): BodySpec => ({
  ...defaultSpec(),
  legLayout: 'abreast',
  ...rest,
  counts: { ...defaultSpec().counts, ...counts },
});

describe('横排多胯', () => {
  it('每副胯两条腿，单数时正中那副一条，左右对称；两条腿以下还是双足', () => {
    expect(legPlan(make({ legs: 4 }))).toEqual({ form: 'abreast', stations: [2, 2], total: 4 });
    expect(legPlan(make({ legs: 5 }))).toEqual({ form: 'abreast', stations: [2, 1, 2], total: 5 });
    expect(legPlan(make({ legs: 6 })).stations).toEqual([2, 2, 2]);
    // 单数条、两边对数不一样多的：正中三副各一条，还是左右对称
    expect(legPlan(make({ legs: 3 })).stations).toEqual([1, 1, 1]);
    expect(legPlan(make({ legs: 7 })).stations).toEqual([2, 1, 1, 1, 2]);
    expect(legPlan(make({ legs: 2 })).form).toBe('biped');
  });

  it('两种白模：几副胯左右并排、左右对称，每副胯上的腿在它两边；融合出来是一整块', () => {
    useAnimeBody();
    for (const bodyStyle of ['mannequin', 'anime'] as const) {
      for (const legs of [4, 5, 6]) {
        const spec = make({ legs }, { bodyStyle });
        const f = buildFigure(spec);
        const label = `${bodyStyle} ${legs}`;
        expect(f.metrics.legForm, label).toBe('abreast');
        // 二次元素体两副胯、每副两条腿的：躯干那块格子自己在胯上分成两副（见 twin.test.ts），两副胯的正中在 ±twin.d
        const twin = (f.parts.find((p) => p.name === 'Torso')!.prims[0] as { twin?: { d: number } }).twin;
        expect(!!twin, label).toBe(bodyStyle === 'anime' && legs === 4);
        const lower = f.parts.find((p) => p.name === 'LowerBody');
        const pelves = twin ? [-twin.d, twin.d] : lower!.prims.filter((p) => /^Pelvis_\d+$/.test(p.name)).map((p) => (p.kind === 'ellipsoid' ? p.center[0] : NaN));
        expect(pelves.length, label).toBe(legPlan(spec).stations.length);
        // 左右对称
        const sorted = [...pelves].sort((a, b) => a - b);
        sorted.forEach((x, k) => expect(x, label).toBeCloseTo(-sorted[sorted.length - 1 - k], 9));
        const legX = f.parts.filter((p) => p.type === 'leg').map((p) => p.pos[0]);
        expect(legX.length, label).toBe(legs);
        // 每条腿都在某副胯的范围里，每副胯上的腿数照 stations
        const per = sorted.map((x) => legX.filter((lx) => Math.abs(lx - x) < (sorted[1] - sorted[0]) / 2).length);
        expect(per, label).toEqual(legPlan(spec).stations);
        // 每副胯自己的左右：Leg_0k_L 在 Leg_0k_R 的左边（+X），两条在同一副胯上
        const near = (x: number) => sorted.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
        for (const left of f.parts.filter((p) => /^Leg_\d+_L$/.test(p.name))) {
          const right = f.parts.find((p) => p.name === left.name.replace(/_L$/, '_R'))!;
          expect(left.pos[0], left.name).toBeGreaterThan(right.pos[0]);
          expect(near(left.pos[0]), left.name).toBe(near(right.pos[0]));
        }
        const mesh = fuseParts(f.parts.filter((p) => p.material !== 'eye'), { voxel: 0.012, blend: spec.blend });
        expect(mesh.info.components, label).toBe(1);
      }
    }
  });

  it('描述：「四条腿，横排多胯」「胯左右并排」「side by side hips」；规范描述往返一致；识别结果写几副胯', () => {
    for (const text of ['四条腿，横排多胯', '六条腿 胯左右并排', 'four legs, side by side hips']) {
      expect(applyParse(defaultSpec(), parseDescription(text)).legLayout, text).toBe('abreast');
    }
    // 「腿横排」还是腿左右并排
    expect(applyParse(defaultSpec(), parseDescription('四条腿，腿横排')).legLayout).toBe('row');
    const spec = make({ legs: 6 });
    const text = describeSpec(spec);
    expect(text).toContain('横排多胯');
    expect(applyParse(defaultSpec(), parseDescription(text)).legLayout).toBe('abreast');
    expect(summarize(spec).find((chip) => chip.key === 'legs')?.label).toBe('横排 3 副胯 6 腿');
  });

  it('成品角色：她自己的胯和腿复制几份左右排开，每副胯的腿是它自己的左右，脚都踩在地上', () => {
    const file = readFileSync(new URL(`../public/${CHARACTER.url}`, import.meta.url));
    const source: CharacterSource = readCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, CHARACTER);
    const plain = assembleCharacter(source, { ...defaultSpec(), bodyStyle: 'character' });
    for (const legs of [4, 6]) {
      const b = assembleCharacter(source, make({ legs }, { bodyStyle: 'character' }));
      expect(b.metrics.legForm).toBe('abreast');
      const roots = b.bones.filter((bone) => /^UpperLeg_[LR](\.\d+)?$/.test(bone.name));
      expect(roots.length, `${legs}`).toBe(legs);
      // 每副胯：UpperLeg_L.00k 在 UpperLeg_R.00k 的左边
      for (const left of roots.filter((bone) => bone.name.startsWith('UpperLeg_L'))) {
        const right = roots.find((bone) => bone.name === left.name.replace('_L', '_R'))!;
        expect(left.head[0], left.name).toBeGreaterThan(right.head[0]);
      }
      // 左右对称：最左边的腿和最右边的腿离中线一样远
      const xs = roots.map((bone) => bone.head[0]);
      expect(Math.max(...xs)).toBeCloseTo(-Math.min(...xs), 2);
      // 脚底和原来一样高
      const sole = (build: typeof b) => Math.min(...build.meshes.map((m) => Math.min(...Array.from({ length: m.positions.length / 3 }, (_, i) => m.positions[i * 3 + 1]))));
      expect(sole(b)).toBeCloseTo(sole(plain), 2);
    }
  }, 60_000);
});
