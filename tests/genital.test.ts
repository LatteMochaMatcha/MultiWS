// 阴茎、阴囊（白模人台，一副胯）：阴茎是缝上去的现成网格，阴囊是距离场格子（见 src/geometry/genital.ts、docs/genital-plan.md）。
import { describe, expect, it } from 'vitest';
import { genitalReady } from '../src/anime/genital';
import { findClashes } from '../src/geometry/clash';
import { buildFigure } from '../src/geometry/layout';
import { buildPartGeometry, triangleCount } from '../src/geometry/partsMesh';
import { withoutAdult } from '../src/model/adult';
import { type BodySpec, PENIS_LAYOUTS, SCROTUM_MODES, defaultSpec } from '../src/model/spec';
import { quatEuler, rotate } from '../src/geometry/vec';
import { buildHandles } from '../src/pose/handles';
import { flipPosing, placedTwins } from '../src/pose/posing';
import { forward, poseMatrices, restState } from '../src/pose/rig';
import { makeSolver, mirrorState } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { compileField } from '../src/sdf/field';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
import { graftMeshes } from '../src/sdf/graft';
import { isSampled } from '../src/sdf/posedField';
import { compilePosedField } from '../src/sdf/posedField';
import { fusePosed } from '../src/sdf/posedFuse';
import { runJob } from '../src/sdf/job';
import { meshField } from '../src/sdf/surfaceNets';
import { useAnimeBody } from './animeBody';
import { useGenital } from './genital';

const make = (counts: Partial<BodySpec['counts']>, rest: Partial<BodySpec> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, ...rest, counts: { ...base.counts, ...counts } };
};
const genitals = (spec: BodySpec) => buildFigure(spec).parts.filter((p) => p.type === 'genital');

describe('数据没载入时', () => {
  it('先不长（数据到了以后界面会重新生成）', () => {
    expect(genitalReady()).toBe(false);
    expect(genitals(make({ penises: 2 }))).toEqual([]);
  });
});

describe('摆位', () => {
  it('每副胯几根、阴囊共用一个还是每根各带一个', () => {
    useGenital();
    for (const penisLayout of PENIS_LAYOUTS)
      for (const scrotum of SCROTUM_MODES)
        for (const n of [1, 2, 3, 4]) {
          const parts = genitals(make({ penises: n }, { penisLayout, scrotum }));
          const names = parts.map((p) => p.name);
          expect(names.filter((name) => name.startsWith('Penis_')), `${penisLayout} ${scrotum} ${n}`).toEqual(Array.from({ length: n }, (_, k) => `Penis_0${k + 1}`));
          expect(names.filter((name) => name.startsWith('Scrotum_')).length).toBe(scrotum === 'each' ? n : 1);
          // 不挂在躯干下面：好几个上半身时躯干那一截会被复制，挂在下面的也会跟着复制（见 torsos.ts）
          for (const p of parts) expect(p.parent).toBeUndefined();
        }
  });

  it('没有阴茎、开关关着（withoutAdult）时不长', () => {
    useGenital();
    expect(genitals(make({ penises: 0 }))).toEqual([]);
    expect(genitals(withoutAdult(make({ penises: 3 })))).toEqual([]);
  });

  it('根部在小腹前面、阴囊在根部底下', () => {
    useGenital();
    const parts = genitals(make({ penises: 1 }));
    const penis = parts.find((p) => p.name === 'Penis_01')!;
    const sac = parts.find((p) => p.name === 'Scrotum_01')!;
    expect(penis.pos[2]).toBeGreaterThan(0.05);
    expect(sac.pos[1]).toBeLessThan(penis.pos[1]);
  });

  it('越大根部隔得越开，上下叠的往小腹上排', () => {
    useGenital();
    const gap = (size: number) => {
      const xs = genitals(make({ penises: 2 }, { shape: { ...defaultSpec().shape, penisSize: size } }))
        .filter((p) => p.name.startsWith('Penis_'))
        .map((p) => p.pos[0]);
      return Math.abs(xs[1] - xs[0]);
    };
    expect(gap(1.5)).toBeGreaterThan(gap(0.8));
    const stack = genitals(make({ penises: 3 }, { penisLayout: 'stack' })).filter((p) => p.name.startsWith('Penis_'));
    expect(stack[1].pos[1]).toBeGreaterThan(stack[0].pos[1]);
    expect(stack[2].pos[1]).toBeGreaterThan(stack[1].pos[1]);
  });
});

describe('几副胯各一套', () => {
  const count = (spec: BodySpec, prefix: string) => genitals(spec).filter((p) => p.name.startsWith(prefix)).length;

  it('站着的人腿几副胯各一套，胯部聚拢、人马、蛛形一套', () => {
    useGenital();
    const cases: [BodySpec['legLayout'], number, number][] = [
      ['abreast', 4, 2],
      ['abreast', 6, 3],
      ['tandem', 6, 3],
      // 胯部聚拢几副胯挤在一起，只长一套
      ['gather', 6, 1],
      ['humantaur', 4, 2],
      ['row', 4, 1],
      ['taur', 4, 1],
      ['spider', 8, 1],
    ];
    for (const [legLayout, legs, hips] of cases)
      for (const penises of [1, 2]) {
        const spec = make({ legs, penises }, { legLayout });
        expect(count(spec, 'Penis_'), `${legLayout} ${legs} ${penises}`).toBe(hips * penises);
        expect(count(spec, 'Scrotum_'), `${legLayout} ${legs} ${penises}`).toBe(hips);
      }
  });

  it('后面几副胯的接在那副胯的骨骼上，挂在身体底下、往前下方伸', () => {
    useGenital();
    const figure = buildFigure(make({ legs: 6, penises: 1 }, { legLayout: 'tandem' }));
    const bones = new Map(buildSkeleton(figure).bones.map((b, _, all) => [b.name, b.parent >= 0 ? all[b.parent].name : null]));
    expect(bones.get('Penis_01_01')).toBe('Hips');
    expect(bones.get('Penis_02_01')).toBe('LowerBody_01');
    expect(bones.get('Penis_03_01')).toBe('LowerBody_02');
    const front = figure.parts.find((p) => p.name === 'Penis_01')!;
    const rear = figure.parts.find((p) => p.name === 'Penis_02')!;
    // 站着的那根朝前，后面的朝下（素体里朝外的方向转到身上）
    const out = (q: typeof front.quat) => rotate(q, [0, 0, 1]);
    expect(out(front.quat)[2]).toBeGreaterThan(0.99);
    expect(out(rear.quat)[1]).toBeLessThan(-0.9);
    expect(rear.pos[2]).toBeLessThan(front.pos[2] - 0.1);
  });

  // 每种腿的排法单独一项：一起跑的时候机器忙，十几次融合放在一项里会超时
  for (const [legLayout, legs] of [['abreast', 4], ['tandem', 4], ['humantaur', 4], ['taur', 4], ['spider', 6]] as [BodySpec['legLayout'], number][])
    it(`${legLayout} ${legs} 条腿、每副胯一两根：融合出来是一整块，不穿模`, () => {
      useGenital();
      for (const penises of [1, 2]) {
        const spec = make({ legs, penises }, { legLayout });
        const figure = buildFigure(spec);
        expect(fuseParts(figure.parts, { voxel: VOXEL.fine, blend: spec.blend }).info.components, `${penises}`).toBe(1);
        const mine = findClashes(figure).filter((c) => /^(Penis|Scrotum)_/.test(c.a) || /^(Penis|Scrotum)_/.test(c.b));
        expect(mine, `${penises}`).toEqual([]);
      }
    });
});

describe('二次元素体', () => {
  it('一副胯、两个上半身（B）一套，横排两副胯（C）、宽躯干（D）各一套；融合出来是一整块，不穿模', () => {
    useAnimeBody();
    useGenital();
    const cases: [string, BodySpec, number][] = [
      ['一根', make({ penises: 1 }, { bodyStyle: 'anime' }), 1],
      ['三根扇形', make({ penises: 3 }, { bodyStyle: 'anime', penisLayout: 'fan', scrotum: 'each' }), 1],
      ['B', make({ torsos: 2, penises: 1 }, { bodyStyle: 'anime' }), 1],
      ['C', make({ torsos: 2, legs: 4, penises: 1 }, { bodyStyle: 'anime', legLayout: 'abreast' }), 2],
      ['D', make({ heads: 2, legs: 4, penises: 1 }, { bodyStyle: 'anime', legLayout: 'abreast', headLayout: 'wide' }), 2],
      ['人腿人马', make({ legs: 4, penises: 1 }, { bodyStyle: 'anime', legLayout: 'humantaur' }), 2],
    ];
    for (const [name, spec, hips] of cases) {
      const figure = buildFigure(spec);
      const parts = figure.parts.filter((p) => p.type === 'genital');
      expect(parts.filter((p) => p.name.startsWith('Penis_')).length, name).toBe(hips * spec.counts.penises);
      // 好几个上半身时躯干那一截会被复制（见 torsos.ts）：阴茎、阴囊不挂在下面，不跟着复制
      for (const p of parts) expect(p.parent, name).toBeUndefined();
      expect(fuseParts(figure.parts, { voxel: VOXEL.fine, blend: spec.blend }).info.components, name).toBe(1);
      const mine = findClashes(figure).filter((c) => /^(Penis|Scrotum)_/.test(c.a) || /^(Penis|Scrotum)_/.test(c.b));
      expect(mine, name).toEqual([]);
    }
  });

  it('根部在她的小腹前面、阴囊在根部底下', () => {
    useAnimeBody();
    useGenital();
    const parts = genitals(make({ penises: 1 }, { bodyStyle: 'anime' }));
    const penis = parts.find((p) => p.name === 'Penis_01')!;
    const sac = parts.find((p) => p.name === 'Scrotum_01')!;
    expect(penis.pos[2]).toBeGreaterThan(0.08);
    expect(sac.pos[1]).toBeLessThan(penis.pos[1]);
  });
});

describe('骨骼', () => {
  it('每根三节接在 Hips 上，阴囊一节', () => {
    useGenital();
    const figure = buildFigure(make({ penises: 2 }, { scrotum: 'each' }));
    const bones = new Map(buildSkeleton(figure).bones.map((b, _, all) => [b.name, b.parent >= 0 ? all[b.parent].name : null]));
    for (const k of ['01', '02']) {
      expect(bones.get(`Penis_${k}_01`)).toBe('Hips');
      expect(bones.get(`Penis_${k}_02`)).toBe(`Penis_${k}_01`);
      expect(bones.get(`Penis_${k}_03`)).toBe(`Penis_${k}_02`);
      expect(bones.get(`Scrotum_${k}`)).toBe('Hips');
    }
  });

  it('根部挨着；几乘几是几排、每排几根，最上面那排少几根', () => {
    useGenital();
    const penises = (spec: BodySpec) => genitals(spec).filter((p) => p.name.startsWith('Penis_'));
    const two = penises(make({ penises: 2 }));
    expect(Math.abs(two[1].pos[0] - two[0].pos[0])).toBeLessThan(0.05);
    /** 照高低分排：隔开一厘米以上的算两排，返回每排几根 */
    const rowsOf = (spec: BodySpec) => {
      const ys = penises(spec)
        .map((p) => p.pos[1])
        .sort((a, b) => a - b);
      const rows: number[] = [];
      ys.forEach((y, k) => (k && y - ys[k - 1] < 0.01 ? rows[rows.length - 1]++ : rows.push(1)));
      return rows;
    };
    expect(rowsOf(make({ penises: 4 }, { penisLayout: 'grid', penisRow: 2 }))).toEqual([2, 2]);
    expect(rowsOf(make({ penises: 6 }, { penisLayout: 'grid', penisRow: 3 }))).toEqual([3, 3]);
    expect(rowsOf(make({ penises: 5 }, { penisLayout: 'grid', penisRow: 2 }))).toEqual([2, 2, 1]);
    expect(rowsOf(make({ penises: 3 }, { penisLayout: 'grid', penisRow: 4 }))).toEqual([3]);
  });
});

describe('摆姿势', () => {
  const solverOf = (spec: BodySpec) => makeSolver(buildSkeleton({ parts: buildFigure(spec).parts, scale: 1 }).bones);

  it('阴茎、阴囊各有一个圆点，归在「阴茎」那一组', () => {
    useGenital();
    const handles = buildHandles(solverOf(make({ penises: 2 }, { scrotum: 'each' }))).filter((h) => h.group === 'genital');
    expect(handles.map((h) => h.label).sort()).toEqual(['阴囊 1', '阴囊 2', '阴茎 1', '阴茎 2']);
    // 阴茎的点在龟头那一节的末端，拖它三节一起弯
    const penis = handles.find((h) => h.label === '阴茎 1')!;
    expect(penis.id).toBe('Penis_01_03:tip');
    expect(penis.links.length).toBe(3);
  });

  it('左右翻转、照到另一侧：照根部的位置配对，正中那根不配', () => {
    useGenital();
    const rig = solverOf(make({ penises: 3 }, { penisLayout: 'grid', penisRow: 2, scrotum: 'each' })).rig;
    const twins = placedTwins(rig);
    // 几乘几、每排两根：下排两根是一对，上排正中那根自己一个
    expect(twins.get('Penis_01_02')).toEqual({ side: 'R', twin: 'Penis_02_02' });
    expect(twins.get('Penis_02_03')).toEqual({ side: 'L', twin: 'Penis_01_03' });
    expect(twins.has('Penis_03_01')).toBe(false);
    expect(twins.get('Scrotum_01')?.twin).toBe('Scrotum_02');
    const q = quatEuler(0.3, 0.2, 0);
    const flipped = flipPosing({ version: 3, bones: { Penis_01_02: q, Penis_03_02: q } }, twins);
    expect(Object.keys(flipped.bones).sort()).toEqual(['Penis_02_02', 'Penis_03_02']);
    // 照到另一侧：左边那根的姿势照到右边那根
    const solver = solverOf(make({ penises: 2 }));
    const state = restState(solver.rig);
    const left = solver.rig.index.get('Penis_02_02')!;
    state.local[left] = q;
    const mirrored = mirrorState(solver, state, 'L');
    expect(mirrored.local[solver.rig.index.get('Penis_01_02')!]).toEqual([q[0], -q[1] + 0, -q[2] + 0, q[3]]);
  });

  it('带骨骼导出：每根各带的小阴囊跟着自己的骨骼，不跟着大腿', () => {
    useGenital();
    const spec = make({ penises: 2 }, { scrotum: 'each' });
    const figure = buildFigure(spec);
    // 融合网格按标准人台的尺寸，骨架也照这个尺寸比
    const skeleton = buildSkeleton({ parts: figure.parts, scale: 1 });
    const { mesh, skin } = runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: spec.blend, skin: true });
    const pos = mesh.positions;
    for (const name of ['Scrotum_01', 'Scrotum_02']) {
      const index = skeleton.bones.findIndex((b) => b.name === name);
      const tip = skeleton.bones[index].tail;
      // 离这根骨骼末端最近的那个顶点（阴囊前面那一块）
      let nearest = 0;
      for (let v = 1; v < pos.length / 3; v++)
        if (Math.hypot(pos[v * 3] - tip[0], pos[v * 3 + 1] - tip[1], pos[v * 3 + 2] - tip[2]) < Math.hypot(pos[nearest * 3] - tip[0], pos[nearest * 3 + 1] - tip[1], pos[nearest * 3 + 2] - tip[2])) nearest = v;
      let own = 0;
      for (let k = 0; k < 4; k++) if (skin!.joints[nearest * 4 + k] === index) own += skin!.weights[nearest * 4 + k];
      expect(own, name).toBeGreaterThan(0.8);
    }
  });

  it('弯中间那一节、龟头、转根部：缝口还在，一整块', () => {
    useGenital();
    const spec = make({ penises: 2 });
    const parts = buildFigure(spec).parts;
    const { rig } = makeSolver(buildSkeleton({ parts, scale: 1 }).bones);
    const state = restState(rig);
    const turn = (name: string, x: number, y: number) => (state.local[rig.index.get(name)!] = quatEuler(x, y, 0));
    turn('Penis_01_02', 0.7, 0);
    turn('Penis_01_03', 0.4, 0);
    turn('Penis_02_01', -0.35, -0.25);
    turn('Penis_02_02', 0, 0.5);
    const pose = poseMatrices(rig, forward(rig, state));
    const field = compilePosedField({ parts, scale: 1 }, { blend: spec.blend, minRadius: VOXEL.fine }, pose);
    const report = { loose: [] as number[] };
    graftMeshes(meshField(field, VOXEL.fine), parts, VOXEL.fine, pose, report);
    expect(report.loose).toEqual([]);
    expect(fusePosed(parts, { voxel: VOXEL.preview, blend: spec.blend, pose }).info.components).toBe(1);
  });
});

describe('融合', () => {
  it('每种排法、两种阴囊、一到四根：一整块，每根都缝上了', () => {
    useGenital();
    for (const penisLayout of PENIS_LAYOUTS)
      for (const scrotum of SCROTUM_MODES)
        for (const n of [1, 4]) {
          const spec = make({ penises: n }, { penisLayout, scrotum });
          const parts = buildFigure(spec).parts;
          const field = compileField({ scale: 1, parts }, { blend: spec.blend, minRadius: VOXEL.fine });
          const report = { loose: [] as number[] };
          const mesh = graftMeshes(meshField(field, VOXEL.fine), parts, VOXEL.fine, undefined, report);
          expect(report.loose, `${penisLayout} ${scrotum} ${n}`).toEqual([]);
          expect(mesh.info.components, `${penisLayout} ${scrotum} ${n}`).toBe(1);
        }
  });

  it('预览的粗网格上也缝得上（第一遍缝不上时退回去重来，最后还是一整块）', () => {
    useGenital();
    for (const size of [0.5, 1, 1.6]) {
      const spec = make({ penises: 3 }, { penisLayout: 'fan', shape: { ...defaultSpec().shape, penisSize: size } });
      expect(fuseParts(buildFigure(spec).parts, { voxel: VOXEL.preview, blend: spec.blend }).info.components, `大小 ${size}`).toBe(1);
    }
  });

  it('阴囊不让白模人台算成采样的素体（不然摆姿势时不重新融合）', () => {
    useGenital();
    expect(isSampled(buildFigure(make({ penises: 1 })).parts)).toBe(false);
  });
});

describe('分部件、穿模', () => {
  it('分部件模式：阴茎（圆台加缝上去的网格）、阴囊各是一块', () => {
    useGenital();
    for (const part of genitals(make({ penises: 2 }, { scrotum: 'each' }))) expect(triangleCount(buildPartGeometry(part)), part.name).toBeGreaterThan(100);
  });

  it('穿模检查：根部埋进身体、并排挨着都不算', () => {
    useGenital();
    for (const penisLayout of PENIS_LAYOUTS)
      for (const scrotum of SCROTUM_MODES)
        for (const n of [1, 2, 3, 4]) {
          const figure = buildFigure(make({ penises: n }, { penisLayout, scrotum }));
          const mine = findClashes(figure).filter((c) => /^(Penis|Scrotum)_/.test(c.a) || /^(Penis|Scrotum)_/.test(c.b));
          expect(mine, `${penisLayout} ${scrotum} ${n}`).toEqual([]);
        }
  });
});
