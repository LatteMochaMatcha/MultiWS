// 阴茎、阴囊（白模人台，一副胯）：阴茎是缝上去的现成网格，阴囊是距离场格子（见 src/geometry/genital.ts、docs/genital-plan.md）。
import { describe, expect, it } from 'vitest';
import { genitalReady } from '../src/anime/genital';
import { findClashes } from '../src/geometry/clash';
import { buildFigure } from '../src/geometry/layout';
import { buildPartGeometry, triangleCount } from '../src/geometry/partsMesh';
import { withoutAdult } from '../src/model/adult';
import { type BodySpec, PENIS_LAYOUTS, SCROTUM_MODES, defaultSpec } from '../src/model/spec';
import { buildSkeleton } from '../src/rig/skeleton';
import { compileField } from '../src/sdf/field';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
import { graftMeshes } from '../src/sdf/graft';
import { isSampled } from '../src/sdf/posedField';
import { meshField } from '../src/sdf/surfaceNets';
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
