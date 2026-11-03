// 二次元素体胯上好几条腿时照素体原样的胯排开（animeLayout.ts 的 tileLegs，sdf/grids.ts 的 GridUse.tile）：
// 每两条腿中间一份素体正中的胯下，最外边接素体原样的外胯；往上渐渐并成一整块，腰上还是一个人的。
// 好几个上半身的往上换成每个座位上一份素体原样的胯（Tile.seats，geometry/torsos.ts 的 SEAT）
import { describe, expect, it } from 'vitest';
import type { GridShape, Part, Tile } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { rotate } from '../src/geometry/vec';
import { type BodyCounts, type BodySpec, defaultSpec } from '../src/model/spec';
import { castRay, compileField, fieldAt } from '../src/sdf/field';
import { fuseParts } from '../src/sdf/fuse';
import { useAnimeBody } from './animeBody';

const make = (counts: Partial<BodyCounts> = {}, rest: Partial<BodySpec> = {}): BodySpec => ({
  ...defaultSpec(),
  bodyStyle: 'anime',
  legLayout: 'row',
  ...rest,
  counts: { ...defaultSpec().counts, legs: 4, ...counts },
});
const torsoOf = (spec: BodySpec) => buildFigure(spec).parts.find((p) => p.name === 'Torso')!;
const tileOf = (spec: BodySpec) => (torsoOf(spec).prims[0] as GridShape).tile;
/** 躯干那块格子自己的距离场（放在原点）：照腿排开的，和不排开的素体原样 */
const fields = (torso: Part) => {
  const grid = torso.prims[0] as GridShape;
  const at = (prim: GridShape) => {
    const field = compileField({ scale: 1, parts: [{ ...torso, prims: [prim], pos: [0, 0, 0] }] }, { blend: 0 });
    return (x: number, y: number, z: number) => fieldAt(field, x, y, z);
  };
  return { tiled: at(grid), native: at({ ...grid, tile: undefined }), tile: grid.tile as Tile };
};

describe('胯上好几条腿：照素体原样的胯排开', () => {
  it('左右并排、横排多胯（两副胯各两条的除外）、人腿人马前面那副胯三四条时排开；一对腿、好几个上半身的不排开', () => {
    useAnimeBody();
    for (const [label, spec, legs] of [
      ['左右并排三条', make({ legs: 3 }), 3],
      ['左右并排六条', make({ legs: 6 }), 6],
      ['横排多胯六条', make({ legs: 6 }, { legLayout: 'abreast' }), 6],
      ['横排多胯三条', make({ legs: 3 }, { legLayout: 'abreast' }), 3],
      ['人腿人马前三后三', make({ legs: 6 }, { legLayout: 'humantaur', hipLegs: 3 }), 3],
    ] as const) {
      const tile = tileOf(spec);
      expect(tile, label).toBeDefined();
      expect(tile!.legs, label).toHaveLength(legs);
      // 排开的地方就是那副胯上各条腿的髋关节
      const figure = buildFigure(spec);
      const xs = figure.parts.filter((p) => p.type === 'leg' && p.fuseAs === 'torso').map((p) => p.pos[0]).sort((a, b) => a - b);
      tile!.legs.forEach((x, k) => expect(x, label).toBeCloseTo(xs[k], 9));
      // 不另外垫胯
      expect(figure.parts.find((p) => p.name === 'LowerBody')?.prims.some((p) => /^(LowerBody|Pelvis_01)$/.test(p.name)) ?? false, label).toBe(false);
    }
    expect(tileOf(make({ legs: 2 }, { legLayout: 'auto' }))).toBeUndefined();
    expect(tileOf(make({ legs: 4 }, { legLayout: 'abreast' }))).toBeUndefined();
    // 两个上半身、横排两副胯各两条：不是一个上半身的那种分成两份（twin），也照腿排开
    expect(tileOf(make({ legs: 4, torsos: 2, heads: 2 }, { legLayout: 'abreast' }))).toBeDefined();
  });

  it('好几个上半身：胯往上换成每个座位上一份素体原样的，上半身坐在那一份上；切口那一截两边是同一张皮', () => {
    useAnimeBody();
    for (const spec of [make({ legs: 4, torsos: 2 }), make({ legs: 3, torsos: 2 }), make({ legs: 6, torsos: 3 }, { legLayout: 'abreast' })]) {
      const label = `${spec.counts.torsos} 个上半身 ${spec.counts.legs} 条腿`;
      const figure = buildFigure(spec);
      const pelvis = figure.parts.find((p) => p.name === 'Torso')!;
      const grid = pelvis.prims.find((p): p is GridShape => p.kind === 'grid')!;
      const uppers = figure.parts.filter((p) => p.name.startsWith('UpperBody'));
      expect(uppers, label).toHaveLength(spec.counts.torsos);
      // 座位就是每个上半身的腰在哪，左右对称；上半身那几份不排开
      const waists = uppers.map((p) => {
        const g = p.prims.find((q): q is GridShape => q.kind === 'grid')!;
        expect(g.tile, label).toBeUndefined();
        return p.pos[0] + rotate(p.quat, g.fork!.pivot)[0];
      });
      const seats = grid.tile!.seats!;
      expect(seats, label).toHaveLength(spec.counts.torsos);
      [...waists].sort((a, b) => a - b).forEach((x, k) => expect(x, label).toBeCloseTo(seats[k], 9));
      seats.forEach((x, k) => expect(x, label).toBeCloseTo(-seats[seats.length - 1 - k], 9));
      // 切口那一截（胯和上半身叠着的地方）：表面附近两边的距离场一样
      const top = grid.clipAbove!;
      const bottom = (uppers[0].prims.find((q) => q.kind === 'grid') as GridShape).clipBelow!;
      const y = (top + bottom) / 2 + pelvis.pos[1];
      const unclip = (p: Part): Part => ({ ...p, prims: p.prims.filter((q) => q.kind === 'grid').map((q) => ({ ...q, clipAbove: undefined, clipBelow: undefined }) as GridShape) });
      const below = compileField({ scale: 1, parts: [unclip(pelvis)] }, { blend: 0 });
      const above = compileField({ scale: 1, parts: [{ ...pelvis, prims: [] }, ...uppers.map(unclip)] }, { blend: 0 });
      let worst = 0;
      for (let x = -0.3; x <= 0.3; x += 0.01) {
        for (let z = -0.15; z <= 0.15; z += 0.01) {
          const a = fieldAt(below, x, y, z);
          const b = fieldAt(above, x, y, z);
          if (Math.abs(a) < 0.02 || Math.abs(b) < 0.02) worst = Math.max(worst, Math.abs(a - b));
        }
      }
      expect(worst, label).toBeLessThan(0.0005);
      const mesh = fuseParts(figure.parts.filter((p) => p.material !== 'eye'), { voxel: 0.012, blend: spec.blend });
      expect(mesh.info.components, label).toBe(1);
    }
  });

  it('好几个上半身：大腿根往上外轮廓是顺的，腿那块不从胯里支出来一圈', () => {
    useAnimeBody();
    for (const spec of [
      make({ legs: 4, torsos: 2, heads: 2 }, { legLayout: 'abreast' }),
      make({ legs: 4, torsos: 2 }),
      make({ legs: 3, torsos: 2 }),
      make({ legs: 6, torsos: 2 }),
      make({ legs: 4, torsos: 3 }),
    ]) {
      const label = `${spec.legLayout} ${spec.counts.torsos} 个上半身 ${spec.counts.legs} 条腿`;
      const figure = buildFigure(spec);
      const field = compileField({ scale: 1, parts: figure.parts.filter((p) => p.material !== 'eye') }, { blend: spec.blend });
      const legY = figure.parts.find((p) => p.type === 'leg')!.pos[1];
      for (const z of [0, -0.04]) {
        // 从外边朝里打射线，量最外边那一圈在每个高度上到哪，每 5 毫米一个
        const side = (y: number) => 0.8 - castRay(field, [0.8, y, z], [-1, 0, 0], 0.8);
        const ys = Array.from({ length: 33 }, (_, k) => legY - 0.06 + k * 0.005);
        const steps = ys.slice(1).map((y, k) => side(y) - side(ys[k]));
        steps.forEach((step, k) => {
          const at = `${label} z=${z} y=${ys[k + 1].toFixed(3)}`;
          expect(Math.abs(step), at).toBeLessThan(0.01);
          // 腿那块支出来的那一圈：往上走到它的顶，外轮廓一下子往里缩 7 毫米上下，前后两段变化量差 6 毫米；顺的弧线不到 2 毫米
          if (k) expect(Math.abs(step - steps[k - 1]), at).toBeLessThan(0.003);
        });
      }
    }
  });

  it('横排多胯、每个上半身坐一副胯：几副胯照 D 的两副胯那样挨着，腿是每副胯原装的那对', () => {
    useAnimeBody();
    const figure = buildFigure(make({ legs: 4, torsos: 2, heads: 2 }, { legLayout: 'abreast' }));
    const grid = figure.parts.find((p) => p.name === 'Torso')!.prims.find((q): q is GridShape => q.kind === 'grid')!;
    const tile = grid.tile!;
    expect(tile.pairs).toBe(true);
    // 每副胯的两条腿隔得和素体那一对一样远，座位就在两条腿正中
    for (let k = 0; k < tile.seats!.length; k++) {
      expect(tile.legs[2 * k + 1] - tile.legs[2 * k]).toBeCloseTo(2 * tile.half, 9);
      expect((tile.legs[2 * k + 1] + tile.legs[2 * k]) / 2).toBeCloseTo(tile.seats![k], 9);
    }
    // 两副胯叠着：座位隔得比两个素体的胯宽近
    expect(tile.seats![1] - tile.seats![0]).toBeLessThan(2 * 0.145);
  });

  it('手动往两边挪了腿：胯里排开的地方跟着腿走', () => {
    useAnimeBody();
    const spec = make({ legs: 4 });
    const legsOf = (f: ReturnType<typeof buildFigure>) => f.parts.find((p) => p.name === 'Torso')!.prims.find((q): q is GridShape => q.kind === 'grid')!.tile!.legs;
    const before = legsOf(buildFigure(spec));
    const moved = buildFigure({ ...spec, overrides: { Leg_02_L: { position: [0.02, 0, 0] } } });
    const after = legsOf(moved);
    const leg = moved.parts.find((p) => p.name === 'Leg_02_L')!;
    const torso = moved.parts.find((p) => p.name === 'Torso')!;
    expect(after[3]).toBeCloseTo(before[3] + 0.02, 6);
    expect(after[3]).toBeCloseTo(leg.pos[0] - torso.pos[0], 9);
    expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
  });

  it('手动往两边挪了上半身：座位跟着挪', () => {
    useAnimeBody();
    const spec = make({ legs: 4, torsos: 2 });
    const moved = buildFigure({ ...spec, overrides: { UpperBody_L: { position: [0.04, 0, 0] }, UpperBody_R: { position: [-0.04, 0, 0] } } });
    const seats = (part: Part) => (part.prims.find((q): q is GridShape => q.kind === 'grid')!.tile!.seats ?? []);
    const before = seats(buildFigure(spec).parts.find((p) => p.name === 'Torso')!);
    const after = seats(moved.parts.find((p) => p.name === 'Torso')!);
    expect(after[1]).toBeCloseTo(before[1] + 0.04, 6);
    expect(after[0]).toBeCloseTo(before[0] - 0.04, 6);
  });

  it('大腿根那一截：每个胯下、每条大腿根都和素体原样的一样，最外边是素体原样的外胯挪过去；接缝两边表面连着', () => {
    useAnimeBody();
    for (const legs of [3, 4, 6]) {
      const { tiled, native, tile } = fields(torsoOf(make({ legs })));
      const { half } = tile;
      const y = tile.levels[0] - 0.02;
      for (const z of [-0.07, 0, 0.06]) {
        // 每两条腿中间对着素体正中，每条腿对着素体的一条腿
        tile.legs.slice(1).forEach((x, i) => expect(tiled((x + tile.legs[i]) / 2, y, z), `${legs} 胯下 ${i}`).toBeCloseTo(native(0, y, z), 6));
        for (const x of tile.legs) expect(tiled(x, y, z), `${legs} 腿 ${x}`).toBeCloseTo(native(x < 0 ? -half : half, y, z), 6);
        // 最外边那条腿外面：素体那条腿外面整个挪过去
        const last = tile.legs[tile.legs.length - 1];
        for (const out of [0.03, 0.06, 0.1]) expect(tiled(last + out, y, z), `${legs} 外胯`).toBeCloseTo(native(half + out, y, z), 6);
        // 从最右边到最左边一路量过去，相邻两点差得不比它们隔的远（距离场是连着的）
        const step = 0.002;
        let prev = tiled(-last - 0.12, y, z);
        for (let x = -last - 0.12 + step; x <= last + 0.12; x += step) {
          const v = tiled(x, y, z);
          expect(Math.abs(v - prev), `${legs} x=${x.toFixed(3)}`).toBeLessThan(step * 1.05);
          prev = v;
        }
      }
    }
  });

  it('往上渐渐并成一整块：屁股上沿以上背后只剩正中一道缝；再往上和素体原样一样', () => {
    useAnimeBody();
    const { tiled, native, tile } = fields(torsoOf(make({ legs: 4 })));
    // 腰上（并好、也不拉开了的地方）和素体原样一模一样
    const top = Math.max(tile.levels[1], tile.rear[1], tile.steps[tile.steps.length - 1][0]);
    for (const [x, z] of [[0, 0.05], [0.06, -0.05], [0.1, 0]] as const) expect(tiled(x, top + 0.02, z)).toBe(native(x, top + 0.02, z));
    // 背后：排开的那一截里，离正中一副胯远的那个胯下（x = 2 half）后面是凹的（缝），并好以后那道缝没了
    const back = (f: (x: number, y: number, z: number) => number, x: number, y: number) => {
      let z = -0.2;
      while (f(x, y, z) > 0 && z < 0) z += 0.0005;
      return z;
    };
    const low = tile.rear[0] - 0.04;
    const high = tile.rear[1] + 0.01;
    const groove = (y: number, x: number) => back(tiled, x, y) - (back(tiled, x - 0.03, y) + back(tiled, x + 0.03, y)) / 2;
    expect(groove(low, 2 * tile.half)).toBeGreaterThan(0.003);
    expect(groove(high, 2 * tile.half)).toBeLessThan(groove(low, 2 * tile.half) / 3);
  });

  it('融合出来是一整块', () => {
    useAnimeBody();
    for (const spec of [make({ legs: 3 }), make({ legs: 5 }), make({ legs: 6 }, { legLayout: 'abreast' }), make({ legs: 6 }, { legLayout: 'humantaur', hipLegs: 3 })]) {
      const figure = buildFigure(spec);
      const mesh = fuseParts(figure.parts.filter((p) => p.material !== 'eye'), { voxel: 0.012, blend: spec.blend });
      expect(mesh.info.components, `${spec.legLayout} ${spec.counts.legs}`).toBe(1);
    }
  });
});
