import { describe, expect, it } from 'vitest';
import { describeClashes, findClashes } from '../src/geometry/clash';
import type { Figure, Part } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { PRESETS, applyPreset } from '../src/model/presets';
import {
  type BodyCounts,
  type BodySpec,
  type LegLayout,
  COUNT_DEFS,
  GENDERS,
  LEG_LAYOUTS,
  POSES,
  SHAPE_DEFS,
  defaultSpec,
} from '../src/model/spec';
import { applyParse, parseDescription } from '../src/parser';
import { rng } from './helpers';

const fromText = (text: string) => buildFigure(applyParse(defaultSpec(), parseDescription(text)));
const clashesOf = (spec: BodySpec) => findClashes(buildFigure(spec));

/** 把一个部件换掉，其余不动 */
function withPart(figure: Figure, name: string, change: (p: Part) => Part): Figure {
  return { ...figure, parts: figure.parts.map((p) => (p.name === name ? change(p) : p)) };
}

describe('穿模检查能发现问题', () => {
  const figure = buildFigure(defaultSpec());

  it('标准人形没有穿模', () => {
    expect(findClashes(figure)).toEqual([]);
  });

  it('把左臂挪到胸口正中：前臂和手插进了躯干', () => {
    const bad = withPart(figure, 'Arm_01_L', (p) => ({ ...p, pos: [-0.2, p.pos[1], p.pos[2]] }));
    const clashes = findClashes(bad);
    expect(clashes.length).toBeGreaterThan(0);
    expect(clashes[0]).toMatchObject({ a: 'Torso', b: 'Arm_01_L' });
    expect(clashes[0].depth).toBeGreaterThan(0.03);
    expect(describeClashes(clashes)).toContain('Torso × Arm_01_L');
  });

  it('把右腿挪到左腿的位置：两条腿整条叠在一起', () => {
    const left = figure.parts.find((p) => p.name === 'Leg_01_L')!;
    const bad = withPart(figure, 'Leg_01_R', (p) => ({ ...p, pos: [left.pos[0] - 0.01, p.pos[1], p.pos[2]] }));
    const pairs = findClashes(bad).map((c) => `${c.a} × ${c.b}`);
    expect(pairs).toContain('Leg_01_L × Leg_01_R');
  });

  it('把第二个头挪到第一个头的位置：两个头叠在一起', () => {
    const two = fromText('两个头');
    const first = two.parts.find((p) => p.name === 'Head_01')!;
    const bad = withPart(two, 'Head_02', (p) => ({ ...p, pos: [first.pos[0] + 0.03, first.pos[1], first.pos[2]], quat: first.quat }));
    const pairs = findClashes(bad).map((c) => `${c.a} × ${c.b}`);
    expect(pairs).toContain('Head_01 × Head_02');
  });

  it('容差：插得不深时不报，把容差调小就报', () => {
    // 把手臂往里挪一点，让手刚好蹭到大腿
    const near = withPart(figure, 'Arm_01_L', (p) => ({ ...p, pos: [p.pos[0] - 0.36, p.pos[1], p.pos[2]] }));
    const strict = findClashes(near, { tolerance: 0.001 });
    const loose = findClashes(near, { tolerance: 0.2 });
    expect(strict.length).toBeGreaterThan(0);
    expect(loose).toEqual([]);
  });

  it('连接处的重叠不算：肩膀埋在躯干里、大腿根挨在一起、尾巴根埋在臀部里', () => {
    const f = fromText('四对手臂，九条尾巴，四对胸');
    expect(findClashes(f)).toEqual([]);
  });

  it('又宽又扁的椭球：两头上方擦过去的不算，真插进去的照样查得出来', () => {
    // 并排好多条腿时加宽的胯就是这样：半宽 0.7、半高 0.13
    const slab: Part = {
      name: 'Slab',
      type: 'lower',
      side: 0,
      pos: [0, 0.9, 0],
      quat: [0, 0, 0, 1],
      material: 'clay',
      prims: [{ kind: 'ellipsoid', name: 'Slab', center: [0, 0, 0], radii: [0.7, 0.13, 0.15] }],
    };
    // 一根横着的细棒，离它自己的根够远（根上的重叠不算）
    const rod = (y: number): Part => ({
      name: 'Rod',
      type: 'arm',
      side: 1,
      pos: [0.3, y, 0],
      quat: [0, 0, 0, 1],
      material: 'clay',
      prims: [{ kind: 'cone', name: 'Rod', a: [0.3, 0, 0], b: [0.4, 0, 0], ra: 0.02, rb: 0.02 }],
    });
    const at = (y: number) => findClashes({ ...figure, parts: [slab, rod(y)] }).map((c) => `${c.a} × ${c.b}`);
    // x = 0.6 处椭球的上沿只有 0.967 高：棒的下沿在 0.98，没碰着
    expect(at(1.0)).toEqual([]);
    // 插进椭球里
    expect(at(0.92)).toEqual(['Slab × Rod']);
  });

  it('结果按深度从大到小排，位置在模型范围内', () => {
    const bad = withPart(
      withPart(figure, 'Arm_01_L', (p) => ({ ...p, pos: [-0.2, p.pos[1], p.pos[2]] })),
      'Arm_01_R',
      (p) => ({ ...p, pos: [0.12, p.pos[1], p.pos[2]] }),
    );
    const clashes = findClashes(bad);
    expect(clashes.length).toBeGreaterThan(1);
    for (let i = 1; i < clashes.length; i++) expect(clashes[i].depth).toBeLessThanOrEqual(clashes[i - 1].depth);
    for (const c of clashes) {
      expect(c.at.every(Number.isFinite)).toBe(true);
      expect(c.at[1]).toBeGreaterThan(0);
      expect(c.at[1]).toBeLessThan(2);
    }
  });
});

describe('各种组合下都没有明显穿模', () => {
  it.each(['两个头，两对手，两对胸', '阿修罗', '半人马', '蜘蛛女', '九尾 六翼', '三头六臂'])('验收用例「%s」', (text) => {
    expect(describeClashes(findClashes(fromText(text)))).toBe('');
  });

  it.each(PRESETS.map((p) => [p.name, p] as const))('预设「%s」', (_name, preset) => {
    expect(describeClashes(clashesOf(applyPreset(defaultSpec(), preset)))).toBe('');
  });

  it('每种部件数量逐个取遍，配上每种手臂和腿的排法、男女体型、A / T 两种姿势', () => {
    const base = defaultSpec();
    for (const d of COUNT_DEFS) {
      for (let v = d.min; v <= d.max; v++) {
        for (const armLayout of ['stack', 'fan'] as const) {
          for (const legLayout of LEG_LAYOUTS) {
            for (const gender of GENDERS) {
              for (const pose of POSES) {
                const spec = { ...base, armLayout, legLayout, gender, pose, counts: { ...base.counts, [d.key]: v } };
                const label = `${d.key}=${v} ${armLayout} ${legLayout} ${gender} ${pose}`;
                expect(describeClashes(clashesOf(spec)), label).toBe('');
              }
            }
          }
        }
      }
    }
  }, 60_000);

  it('每个体型滑块拉到两头（男女各一遍）', () => {
    const base = defaultSpec();
    const counts = { ...base.counts, armPairs: 2, chestPairs: 2, tails: 3 };
    for (const gender of GENDERS) {
      for (const d of SHAPE_DEFS) {
        for (const v of [d.min, d.max]) {
          const spec = { ...base, gender, counts, shape: { ...base.shape, [d.key]: v } };
          expect(describeClashes(clashesOf(spec)), `${gender} ${d.key}=${v}`).toBe('');
        }
      }
    }
  });

  /** 随机组合：seed 定随机数，layouts 是排法从哪几种里抽 */
  const randomCombos = (count: number, seed: number, layouts: readonly LegLayout[]) => {
    const base = defaultSpec();
    const rand = rng(seed);
    const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
    for (let i = 0; i < count; i++) {
      const counts = Object.fromEntries(COUNT_DEFS.map((d) => [d.key, int(d.min, d.max)])) as BodyCounts;
      // 一个上半身的；好几个上半身的另有测试（torsos.test.ts），那边的组合范围小一些
      counts.torsos = 1;
      const shape = { ...base.shape };
      // 体型只取「常用的」那一段（ShapeDef.safe）：滑块拉得比它更大、更小的那一截不保证不穿模
      if (i % 2) for (const d of SHAPE_DEFS) shape[d.key] = [d.safe?.[0] ?? d.min, d.def, d.safe?.[1] ?? d.max][int(0, 2)];
      const spec: BodySpec = {
        ...base,
        counts,
        shape,
        hands: rand() < 0.5 ? 'mitten' : 'fingers',
        gender: rand() < 0.5 ? 'female' : 'male',
        pose: rand() < 0.5 ? 'A' : 'T',
        armLayout: rand() < 0.5 ? 'stack' : 'fan',
        legLayout: layouts[int(0, layouts.length - 1)],
        earShape: (['cat', 'fox', 'rabbit', 'elf'] as const)[int(0, 3)],
      };
      const found = describeClashes(clashesOf(spec));
      const label = JSON.stringify({ ...spec, overrides: undefined });
      expect(found, label).toBe('');
    }
  };
  it('600 个随机组合（部件数量、排法、耳形、手型、性别、姿势随机，一半带极端体型）', () => {
    randomCombos(600, 20261004, LEG_LAYOUTS);
  }, 60_000);
  it('腿胯部聚拢：200 个随机组合', () => {
    randomCombos(200, 20261030, ['gather']);
  }, 60_000);
  it('横排多胯：200 个随机组合', () => {
    randomCombos(200, 20261031, ['abreast']);
  }, 60_000);
});
