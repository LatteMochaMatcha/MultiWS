// 围成一圈（src/geometry/ring.ts）：几个人背靠背站成一圈，融合成一个身子
import { describe, expect, it } from 'vitest';
import { worldTransforms } from '../src/geometry/figure';
import { add, rotate, sub } from '../src/geometry/vec';
import { RING_PERSON_LEGS, buildFigure } from '../src/geometry/layout';
import { PRESETS, applyPreset } from '../src/model/presets';
import { type BodySpec, RING_COUNT, RING_SPREAD, RING_SPREAD_CIRCLE_MIN, defaultSpec, normalizeSpec, ringActive } from '../src/model/spec';
import { writeGlb } from '../src/io/glb';
import { humanoidMap, writeVrm } from '../src/io/vrm';
import { ringHumanoid } from '../src/io/vrmRig';
import { fitArms, followArms } from '../src/pose/fit';
import { POSE_LIBRARY } from '../src/pose/library';
import { buildHandles } from '../src/pose/handles';
import type { Posing } from '../src/pose/posing';
import { fitRing, isRingRig } from '../src/pose/ring';
import { forward, poseMatrices } from '../src/pose/rig';
import { makeSolver, stateOf } from '../src/pose/solver';
import { refusable } from '../src/sdf/posedField';
import { buildSkeleton } from '../src/rig/skeleton';
import { skinVertices } from '../src/rig/skin';
import { compileField, fieldAt } from '../src/sdf/field';
import { VOXEL } from '../src/sdf/fuse';
import { graftPoints } from '../src/sdf/graft';
import { runJob } from '../src/sdf/job';
import { useAnimeBody } from './animeBody';
import { useGenital } from './genital';

const specOf = (patch: Partial<BodySpec>): BodySpec => normalizeSpec({ ...defaultSpec(), ...patch });

describe('围成一圈', () => {
  for (const style of ['mannequin', 'anime'] as const) {
    for (const mode of ['hips', 'fused'] as const) {
      it(`${style} ${mode}：六个人一整块，头、胸、腿都是六份，手臂只有两侧各两条；骨骼接着往下编号`, () => {
        if (style === 'anime') useAnimeBody();
        const d = defaultSpec();
        const spec = specOf({ bodyStyle: style, ring: mode, ringCount: 6, ringSpread: 1, counts: { ...d.counts, breasts: 4, armPairs: 2, tails: 3 } });
        const figure = buildFigure(spec);
        const count = (type: string) => figure.parts.filter((p) => p.type === type).length;
        expect(count('head')).toBe(6);
        // 外圈每人两条，圈心底下再往里排几圈（排得比外圈密，见 INNER_GAP）
        expect(count('leg')).toBe(30);
        expect(count('chest')).toBe(24);
        expect(count('arm')).toBe(4);
        expect(count('tail')).toBe(0);
        expect(new Set(figure.parts.map((p) => p.name)).size).toBe(figure.parts.length);
        const { mesh } = runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: spec.blend });
        expect(mesh.info.components).toBe(1);
        const skeleton = buildSkeleton(figure);
        const names = skeleton.bones.map((b) => b.name);
        for (const name of ['Hips', 'Spine', 'Spine.006', 'Head', 'Head.006', 'UpperLeg_L', 'UpperLeg_L.006', 'Foot_R.006', 'UpperArm_L', 'UpperArm_R', 'UpperArm_L.002', 'Hand_R.002']) expect(names).toContain(name);
        expect(names.filter((n) => n === 'Hips').length).toBe(1);
        expect(names.filter((n) => /^UpperArm/.test(n)).length).toBe(4);
        // 摆姿势用的骨架搭得起来：三十条腿、四条手臂
        const solver = makeSolver(skeleton.bones);
        expect(solver.limbs.filter((l) => l.kind === 'leg').length).toBe(30);
        expect(solver.limbs.filter((l) => l.kind === 'arm').length).toBe(4);
      });
    }
  }

  it('头成一圈：离圈心一样远、隔得一样开，脸朝外；脚踩在地上', () => {
    useAnimeBody();
    // 只看外圈每人两条腿（圈心底下的腿另有一条测试）
    const figure = buildFigure(specOf({ bodyStyle: 'anime', ring: 'hips', ringCount: 5, ringLegs: 'rim' }));
    const xfs = worldTransforms({ parts: figure.parts, scale: 1 });
    const heads = figure.parts.filter((p) => p.type === 'head').map((p) => xfs.get(p.name)!);
    expect(heads.length).toBe(5);
    const radius = heads.map((h) => Math.hypot(h.pos[0], h.pos[2]));
    for (const r of radius) expect(r).toBeCloseTo(radius[0], 6);
    expect(radius[0]).toBeGreaterThan(0.05);
    const angles = heads.map((h) => Math.atan2(h.pos[0], h.pos[2])).sort((a, b) => a - b);
    for (let i = 1; i < angles.length; i++) expect(angles[i] - angles[i - 1]).toBeCloseTo((2 * Math.PI) / 5, 6);
    // 头都比胯靠近圈心（上身往圈心靠）
    const hips = figure.parts.filter((p) => p.type === 'leg').map((p) => Math.hypot(xfs.get(p.name)!.pos[0], xfs.get(p.name)!.pos[2]));
    expect(radius[0]).toBeLessThan(Math.min(...hips));
    const feet = graftPoints(figure.parts);
    let low = Infinity;
    for (let i = 1; i < feet.length; i += 3) low = Math.min(low, feet[i]);
    expect(Math.abs(low)).toBeLessThan(0.003);
  });

  it('手臂只长在整个身子的左右两侧：每侧「手臂几对」那么多条，左右对称，朝外伸；零对就没有', () => {
    useAnimeBody();
    const d = defaultSpec();
    for (const armLayout of ['fan', 'stack'] as const) for (const ringCount of [3, 4, 5, 6, 8]) {
      for (const armPairs of [0, 1, 2, 4]) {
        const figure = buildFigure(specOf({ bodyStyle: 'anime', ring: 'hips', ringCount, armLayout, counts: { ...d.counts, armPairs } }));
        const xfs = worldTransforms({ parts: figure.parts, scale: 1 });
        const arms = figure.parts.filter((p) => p.type === 'arm');
        // 都长在两侧的那两个人身上，要几条有几条
        expect(arms.length, `${armLayout} ${ringCount} ${armPairs}`).toBe(2 * armPairs);
        /** 肩到手腕朝哪（世界里） */
        const reachOf = (arm: (typeof arms)[number]) => {
          const upper = arm.bones!.find((b) => /^UpperArm/.test(b.name))!;
          const lower = arm.bones!.find((b) => /^LowerArm/.test(b.name))!;
          return rotate(xfs.get(arm.name)!.quat, sub(lower.tail, upper.head));
        };
        for (const side of ['L', 'R']) {
          // 一侧的几条都在同一个人身上
          const column = arms.filter((p) => p.name.endsWith(`_${side}`)).sort((a, b) => a.name.localeCompare(b.name));
          expect(new Set(column.map((p) => p.parent)).size).toBeLessThanOrEqual(1);
          for (let i = 1; i < column.length; i++) {
            const [above, below] = [xfs.get(column[i - 1].name)!.pos, xfs.get(column[i].name)!.pos];
            if (armLayout === 'stack') {
              // 上下排：肩关节从上往下排
              expect(below[1]).toBeLessThan(above[1] - 0.03);
            } else {
              // 肩部扇形聚拢：肩关节挤在一个肩膀上，手臂上下扇开（前一条举得比后一条高）
              expect(Math.hypot(below[0] - above[0], below[1] - above[1], below[2] - above[2])).toBeLessThan(0.08);
              const up = (arm: (typeof arms)[number]) => reachOf(arm)[1] / Math.hypot(...reachOf(arm));
              expect(up(column[i])).toBeLessThan(up(column[i - 1]) - 0.15);
            }
          }
        }
        expect(new Set(figure.parts.map((p) => p.name)).size).toBe(figure.parts.length);
        buildSkeleton(figure);
        for (const arm of arms) {
          const at = xfs.get(arm.name)!;
          // 肩关节在哪一侧，手就往那一侧伸（肩到手腕）
          const upper = arm.bones!.find((b) => /^UpperArm/.test(b.name))!;
          const lower = arm.bones!.find((b) => /^LowerArm/.test(b.name))!;
          const reach = rotate(at.quat, sub(lower.tail, upper.head));
          expect(Math.sign(reach[0])).toBe(Math.sign(at.pos[0]));
          // 往下垂一点（肩部扇形聚拢好几条时上面的是举着的）
          if (armLayout === 'stack' || armPairs < 2) expect(reach[1]).toBeLessThan(0);
          // 另一侧有一条和它镜像的：名字只差左右，位置左右相反
          const twin = arms.find((q) => q.name === arm.name.replace(/_([LR])$/, (_m, side: string) => (side === 'L' ? '_R' : '_L')))!;
          const other = xfs.get(twin.name)!;
          expect(other.pos[0]).toBeCloseTo(-at.pos[0], 6);
          expect(other.pos[1]).toBeCloseTo(at.pos[1], 6);
          expect(other.pos[2]).toBeCloseTo(at.pos[2], 6);
        }
      }
    }
    // T 字站姿：手臂平举
    const flat = buildFigure(specOf({ bodyStyle: 'anime', ring: 'fused', ringCount: 6, pose: 'T' }));
    const arm = flat.parts.find((p) => p.type === 'arm')!;
    const at = worldTransforms({ parts: flat.parts, scale: 1 }).get(arm.name)!;
    const reach = rotate(at.quat, sub(arm.bones!.find((b) => /^LowerArm/.test(b.name))!.tail, arm.bones!.find((b) => /^UpperArm/.test(b.name))!.head));
    expect(Math.abs(reach[1]) / Math.hypot(...reach)).toBeLessThan(0.02);
  });

  it('胸交错成串：隔一圈错开半个（一只在这个人正中、一只在和旁边那个人的交界上），每圈一样大；交错渐小的越往下越小；上下对齐的不动', () => {
    useAnimeBody();
    const d = defaultSpec();
    // 胸大（一个人占的那一段只放得下两只）：每圈每人两只
    const build = (ringChest: 'stagger' | 'taper' | 'aligned') =>
      buildFigure(specOf({ bodyStyle: 'anime', ring: 'fused', ringCount: 6, ringChest, shape: { ...d.shape, bust: 2.3 }, counts: { ...d.counts, breasts: 6 } }));
    const azimuth = (figure: ReturnType<typeof build>, name: string) => {
      const at = worldTransforms({ parts: figure.parts, scale: 1 }).get(name)!.pos;
      return Math.atan2(at[0], at[2]);
    };
    const sizeOf = (figure: ReturnType<typeof build>, name: string) => {
      const prim = figure.parts.find((p) => p.name === name)!.prims.find((q) => q.kind === 'chest');
      return prim?.kind === 'chest' ? (prim.scale?.[0] ?? 1) : 1;
    };
    const strung = build('stagger');
    const aligned = build('aligned');
    // 第一个人（脸朝正前）：第一圈、第三圈左右各一只，第二圈一只在正中、一只在交界上（离正前方 30°）
    expect(azimuth(strung, 'Chest_01_R')).toBeLessThan(-0.05);
    expect(azimuth(strung, 'Chest_01_L')).toBeGreaterThan(0.05);
    expect(azimuth(strung, 'Chest_02_R')).toBeCloseTo(0, 3);
    expect(azimuth(strung, 'Chest_02_L')).toBeCloseTo(Math.PI / 6, 3);
    expect(azimuth(strung, 'Chest_03_L')).toBeCloseTo(azimuth(strung, 'Chest_01_L'), 1);
    // 越往下越小
    // 交错成串：每圈一样大；交错渐小：一样错开，越往下越小
    for (const name of ['Chest_01_L', 'Chest_02_L', 'Chest_03_L']) expect(sizeOf(strung, name)).toBe(1);
    const taper = build('taper');
    expect(azimuth(taper, 'Chest_02_R')).toBeCloseTo(0, 3);
    expect(sizeOf(taper, 'Chest_01_L')).toBe(1);
    expect(sizeOf(taper, 'Chest_02_L')).toBeLessThan(1);
    expect(sizeOf(taper, 'Chest_03_L')).toBeLessThan(sizeOf(taper, 'Chest_02_L'));
    // 上下对齐：每一排都在自己那一边，一样大
    expect(azimuth(aligned, 'Chest_02_L')).toBeCloseTo(azimuth(aligned, 'Chest_01_L'), 1);
    expect(sizeOf(aligned, 'Chest_03_L')).toBe(1);
    // 两种都是一整块，胸的个数一样
    for (const figure of [strung, aligned]) {
      expect(figure.parts.filter((p) => p.type === 'chest').length).toBe(36);
      expect(runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: 0.02 }).mesh.info.components).toBe(1);
    }
    // 白模人台也一样摆
    const plain = buildFigure(specOf({ bodyStyle: 'mannequin', ring: 'hips', ringCount: 4, shape: { ...d.shape, bust: 2.3 }, counts: { ...d.counts, breasts: 4 } }));
    expect(azimuth(plain, 'Chest_02_R')).toBeCloseTo(0, 3);
    expect(azimuth(plain, 'Chest_02_L')).toBeCloseTo(Math.PI / 4, 3);
    expect(runJob({ parts: plain.parts, voxel: VOXEL.preview, blend: 0.02 }).mesh.info.components).toBe(1);
  });

  it('胸照大小排满：胸小的每圈多排几只、圈数少、躯干短，各圈一样多、整张网对齐；排不成整圈的剩一只去掉、剩两只以上补满', () => {
    useAnimeBody();
    const d = defaultSpec();
    const build = (bust: number, breasts: number, ringSpread = 0.76, bodyStyle: BodySpec['bodyStyle'] = 'anime') =>
      buildFigure(specOf({ bodyStyle, ring: 'fused', ringCount: 6, ringSpread, shape: { ...d.shape, bust }, counts: { ...d.counts, breasts } }));
    /** 第一个人的胸一圈圈的（从上往下），每圈里各只从上面看的方向（从小到大） */
    const ringsOf = (figure: ReturnType<typeof build>) => {
      const at = worldTransforms({ parts: figure.parts, scale: 1 });
      const own = figure.parts.filter((p) => p.type === 'chest').slice(0, figure.parts.filter((p) => p.type === 'chest').length / 6);
      // 素体的胸上下挪是记在形状里的（ChestShape.shift），部件自己的位置只到它照着做的那一排
      const seen = own
        .map((p) => {
          const pos = at.get(p.name)!.pos;
          const prim = p.prims.find((q) => q.kind === 'chest');
          return { y: pos[1] + (prim?.kind === 'chest' ? (prim.shift?.[1] ?? 0) : 0), angle: Math.atan2(pos[0], pos[2]) };
        })
        .sort((a, b) => b.y - a.y);
      const rows: number[][] = [];
      seen.forEach((one, i) => {
        if (i === 0 || seen[i - 1].y - one.y > 0.015) rows.push([]);
        rows[rows.length - 1].push(one.angle);
      });
      return rows.map((angles) => angles.sort((a, b) => a - b));
    };
    const big = build(2.3, 8);
    const small = build(1, 8);
    // 胸大的正好 6 × 8；名字不重复，一整块
    expect(big.parts.filter((p) => p.type === 'chest').length).toBe(48);
    for (const figure of [big, small]) {
      expect(new Set(figure.parts.map((p) => p.name)).size).toBe(figure.parts.length);
      expect(runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: 0.02 }).mesh.info.components).toBe(1);
    }
    // 胸大的每圈每人两只、四圈；胸小的每圈排得多、圈数少，整个人矮（躯干不用接那么长）
    expect(ringsOf(big).map((ring) => ring.length)).toEqual([2, 2, 2, 2]);
    const rings = ringsOf(small);
    expect(rings[0].length).toBeGreaterThan(2);
    expect(rings.length).toBeLessThan(4);
    expect(small.metrics.height).toBeLessThan(big.metrics.height - 0.05);
    // 整张网一个间隔：一个人占 60°，整圈排 n 只就隔 60° / n，不满的那一圈也照这个间隔挨着排
    for (const ring of rings) for (let i = 1; i < ring.length; i++) expect(ring[i] - ring[i - 1]).toBeCloseTo(Math.PI / 3 / rings[0].length, 3);
    // 各圈一样多（排不成整圈的：剩一只的去掉、剩两只以上的那一圈补满，最多少一只、多不出一圈），隔一圈错开半格
    for (const ring of rings) expect(ring.length).toBe(rings[0].length);
    const made = small.parts.filter((p) => p.type === 'chest').length / 6;
    expect(made).toBe(rings.length * rings[0].length);
    expect(made).toBeGreaterThanOrEqual(7);
    expect(made).toBeLessThan(8 + rings[0].length);
    if (rings.length > 1) expect(Math.abs(rings[1][0] - rings[0][0])).toBeCloseTo(Math.PI / 3 / rings[0].length / 2, 3);
    // 圈放松以后每个人占的那一段更长，每圈排得更多
    expect(ringsOf(build(1, 8, 1.3))[0].length).toBeGreaterThan(rings[0].length);
    // 排不成整圈的（每圈三只）：每人八只剩两只，最下面那一圈补满、没有缺口；每人十只剩一只，孤零零的那一只去掉
    expect(ringsOf(build(1.3, 8)).map((ring) => ring.length)).toEqual([3, 3, 3]);
    expect(ringsOf(build(1.3, 10)).map((ring) => ring.length)).toEqual([3, 3, 3]);
    expect(build(1.3, 10).parts.filter((p) => p.type === 'chest').length).toBe(54);
    // 小胸也看得见、还是一整块（不沉成一圈小鼓包，也不浮在肚皮外面掉成单独的块）
    for (const bust of [0.5, 0.8]) expect(runJob({ parts: build(bust, 8).parts, voxel: VOXEL.preview, blend: 0.02 }).mesh.info.components, String(bust)).toBe(1);
    // 每圈两只、单数个：多出来的那一只去掉
    expect(build(2.3, 5).parts.filter((p) => p.type === 'chest').length).toBe(24);
    expect(ringsOf(build(2.3, 5)).map((ring) => ring.length)).toEqual([2, 2]);
    // 白模人台一样
    const plain = build(1, 8, 0.76, 'mannequin');
    expect(plain.parts.filter((p) => p.type === 'chest').length).toBeGreaterThanOrEqual(42);
    expect(ringsOf(plain)[0].length).toBeGreaterThan(2);
    expect(runJob({ parts: plain.parts, voxel: VOXEL.preview, blend: 0.02 }).mesh.info.components).toBe(1);
  });

  it('胸能排到十圈：交错的两种躯干只照放得下这些圈的排数加长；交错渐小的一圈比一圈小', () => {
    useAnimeBody();
    const d = defaultSpec();
    const build = (ringChest: 'stagger' | 'taper' | 'aligned', chestPairs: number) =>
      buildFigure(specOf({ bodyStyle: 'anime', ring: 'fused', ringCount: 6, ringChest, shape: { ...d.shape, bust: 2.3 }, counts: { ...d.counts, breasts: chestPairs * 2 } }));
    const tall = build('aligned', 10).metrics.height;
    // 交错成串（一样大）：比上下对齐排十排矮（对齐的躯干要接九排那么长），还是一整块
    const same = build('stagger', 10);
    expect(same.parts.filter((p) => p.type === 'chest').length).toBe(120);
    expect(same.metrics.height).toBeLessThan(tall - 0.1);
    expect(runJob({ parts: same.parts, voxel: VOXEL.preview, blend: 0.02 }).mesh.info.components).toBe(1);
    const ten = build('taper', 10);
    expect(ten.parts.filter((p) => p.type === 'chest').length).toBe(120);
    expect(new Set(ten.parts.map((p) => p.name)).size).toBe(ten.parts.length);
    // 交错渐小的更矮
    expect(ten.metrics.height).toBeLessThan(same.metrics.height);
    expect(ten.metrics.height).toBeLessThan(tall - 0.3);
    // 第一个人左边的那些：名字从上往下编，越往下越小（同一圈的一样大），最下面的不小于第一圈的四成
    const sizeOf = (name: string) => {
      const prim = ten.parts.find((p) => p.name === name)!.prims.find((q) => q.kind === 'chest');
      return prim?.kind === 'chest' ? (prim.scale?.[0] ?? 1) : 1;
    };
    const lefts = ten.parts.filter((p) => /^Chest_\d+_L$/.test(p.name)).length / 6;
    const name = (n: number) => `Chest_${String(n).padStart(2, '0')}_L`;
    for (let n = 2; n <= lefts; n++) expect(sizeOf(name(n))).toBeLessThanOrEqual(sizeOf(name(n - 1)));
    expect(sizeOf(name(lefts))).toBeLessThan(sizeOf(name(1)) * 0.8);
    expect(sizeOf(name(lefts))).toBeGreaterThan(0.4);
    expect(runJob({ parts: ten.parts, voxel: VOXEL.preview, blend: 0.02 }).mesh.info.components).toBe(1);
    buildSkeleton(ten);
  });

  it('圈心底下也长腿：往里一圈圈排到圈心，左右对称，脚都踩在地上；选只在外圈就只有每人两条', () => {
    useAnimeBody();
    for (const style of ['anime', 'mannequin'] as const) {
      for (const ringCount of [3, 4, 6, 8]) {
        const rim = buildFigure(specOf({ bodyStyle: style, ring: 'fused', ringCount, ringSpread: 1, ringLegs: 'rim' }));
        expect(rim.parts.filter((p) => p.type === 'leg').length).toBe(2 * ringCount);
        const figure = buildFigure(specOf({ bodyStyle: style, ring: 'fused', ringCount, ringSpread: 1, ringLegs: 'fill' }));
        const legs = figure.parts.filter((p) => p.type === 'leg');
        expect(legs.length).toBeGreaterThan(2 * ringCount);
        expect(new Set(figure.parts.map((p) => p.name)).size).toBe(figure.parts.length);
        const xfs = worldTransforms({ parts: figure.parts, scale: 1 });
        const hips = legs.map((p) => xfs.get(p.name)!.pos);
        const far = Math.max(...hips.map((at) => Math.hypot(at[0], at[2])));
        const inner = legs.filter((_, i) => Math.hypot(hips[i][0], hips[i][2]) < far - 0.05);
        expect(inner.length).toBe(legs.length - 2 * ringCount);
        for (const leg of inner) {
          const at = xfs.get(leg.name)!.pos;
          // 不在中线上的，另一边有一条镜像的
          if (Math.abs(at[0]) > 1e-6) expect(inner.some((q) => q !== leg && Math.abs(xfs.get(q.name)!.pos[0] + at[0]) < 1e-6 && Math.abs(xfs.get(q.name)!.pos[2] - at[2]) < 1e-6)).toBe(true);
        }
        // 骨架搭得起来，每条腿都认得
        const solver = makeSolver(buildSkeleton(figure).bones);
        expect(solver.limbs.filter((l) => l.kind === 'leg').length).toBe(legs.length);
        // 二次元素体的脚是接上去的网格：每只脚最低的那一点都在地上
        if (style === 'anime') {
          for (const leg of legs) {
            const pts = graftPoints(figure.parts.map((p) => (p === leg ? p : { ...p, grafts: undefined })));
            let low = Infinity;
            for (let i = 1; i < pts.length; i += 3) low = Math.min(low, pts[i]);
            expect(Math.abs(low)).toBeLessThan(0.004);
          }
        }
      }
    }
    const figure = buildFigure(specOf({ bodyStyle: 'anime', ring: 'hips', ringCount: 6 }));
    expect(runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: 0.02 }).mesh.info.components).toBe(1);
  });

  it('套现成姿势：每个人、每条腿照自己朝外的方向摆，两侧的手臂照整个身子的左右；松手后照姿势重新融合还是一整块', () => {
    useAnimeBody();
    const d = defaultSpec();
    // 这里不走「手臂让开身体」那一步（pose/clear.ts）：胸小的排成一圈、躯干短，蹲着的手正好插在身子里、缝不上，所以用大胸（两圈）
    const spec = specOf({ bodyStyle: 'anime', ring: 'fused', ringCount: 6, armLayout: 'fan', shape: { ...d.shape, bust: 2.3 }, counts: { ...d.counts, breasts: 4, armPairs: 2 } });
    const figure = buildFigure(spec);
    const skeleton = buildSkeleton(figure);
    const solver = makeSolver(skeleton.bones);
    const { rig } = solver;
    const squat = POSE_LIBRARY.find((p) => p.name === '蹲着')!.posing;
    // 上下排的几条手臂：下面几条相对自己静止时转得和最上面那条一样多（不叠在一条线上），都登记成「跟着动的」让 clear.ts 让开
    {
      const stacked = makeSolver(buildSkeleton(buildFigure(specOf({ bodyStyle: 'anime', ring: 'fused', ringCount: 6, armLayout: 'stack', counts: { ...d.counts, armPairs: 3 } }))).bones);
      const stand = POSE_LIBRARY.find((p) => p.name === '站着')!.posing;
      const own = fitRing(stacked, stand);
      for (const name of ['UpperArm_L', 'UpperArm_L.002', 'UpperArm_L.003', 'UpperArm_R.003']) expect(own.bones[name], name).toBeDefined();
      expect(fitArms(stacked, own)).toBe(own);
      const { posing, followers } = followArms(stacked, own);
      expect(posing).toBe(own);
      expect(followers.map((i) => stacked.rig.names[stacked.limbs[i].upper]).sort()).toEqual(['UpperArm_L', 'UpperArm_L.002', 'UpperArm_L.003', 'UpperArm_R', 'UpperArm_R.002', 'UpperArm_R.003']);
      const posed = forward(stacked.rig, stateOf(stacked, own));
      const hand = (name: string) => posed.pos[stacked.rig.index.get(name)!];
      // 三只左手各在各的地方、都比静止时低
      for (const [a, b] of [['Hand_L', 'Hand_L.002'], ['Hand_L.002', 'Hand_L.003'], ['Hand_L', 'Hand_L.003']]) {
        expect(Math.hypot(hand(a)[0] - hand(b)[0], hand(a)[1] - hand(b)[1], hand(a)[2] - hand(b)[2]), `${a} ${b}`).toBeGreaterThan(0.08);
      }
      for (const name of ['Hand_L', 'Hand_L.002', 'Hand_L.003']) {
        expect(hand(name)[1]).toBeLessThan(stacked.rig.head[stacked.rig.index.get(name)!][1] - 0.1);
        // 右边的也都垂下来了（这个姿势左右手本来就不一样，不比位置）
        expect(hand(name.replace('_L', '_R'))[0]).toBeLessThan(0);
        expect(hand(name.replace('_L', '_R'))[1]).toBeLessThan(stacked.rig.head[stacked.rig.index.get(name)!][1] - 0.1);
      }
    }
    const own = fitRing(solver, squat);
    // 每个人的头，每条腿都写了；胯不转，整个人只上下挪；背不弯（脊柱一节都不写）
    for (const name of ['Head.003', 'UpperLeg_L', 'UpperLeg_R.006', 'UpperLeg', 'UpperArm_L', 'UpperArm_R.002']) expect(own.bones[name], name).toBeDefined();
    for (const name of Object.keys(own.bones)) expect(/^(Spine|Chest|UpperChest)/.test(name), name).toBe(false);
    // 摆姿势的圆点里没有腰和胸（躯干那一组只剩胯），拖肩膀时脊柱不跟着转
    const handles = buildHandles(solver);
    expect(handles.filter((h) => h.group === 'torso').map((h) => rig.names[h.anchor])).toEqual(['Hips']);
    for (const h of handles) for (const link of h.links) expect(/^(Spine|Chest|UpperChest)/.test(rig.names[link.bone]), h.id).toBe(false);
    expect(isRingRig(rig)).toBe(true);
    expect(own.bones.Hips).toBeUndefined();
    expect(own.root?.[0]).toBe(0);
    expect(own.root?.[1]).toBeLessThan(0);
    const frame = forward(rig, stateOf(solver, followArms(solver, fitArms(solver, own)).posing));
    const at = (name: string) => frame.pos[rig.index.get(name)!];
    const rest = (name: string) => rig.head[rig.index.get(name)!];
    // 蹲下：每条外圈的腿膝盖都比静止时更朝外（离圈心更远）；六个人的头都低了
    for (let k = 0; k < 6; k++) {
      const suffix = k ? `.00${k + 1}` : '';
      for (const side of ['L', 'R']) {
        const knee = at(`LowerLeg_${side}${suffix}`);
        const was = rest(`LowerLeg_${side}${suffix}`);
        expect(Math.hypot(knee[0], knee[2])).toBeGreaterThan(Math.hypot(was[0], was[2]) + 0.05);
      }
      expect(at(`Head${suffix}`)[1]).toBeLessThan(rest(`Head${suffix}`)[1] - 0.1);
    }
    // 整个身子左、右两侧的手（第一对）还在各自那一侧：左手在 +X、右手在 −X（这个姿势两只手本来就不一样高）
    const left = at('Hand_L');
    const right = at('Hand_R');
    expect(left[0]).toBeGreaterThan(0);
    expect(right[0]).toBeLessThan(0);
    // 围成一圈摆了姿势以后重新融合（照权重弯的话几个人连着的地方被扯成长条）
    const exact = poseMatrices(rig, frame, figure.scale);
    expect(refusable(figure, exact)).toBe(true);
    const { mesh } = runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: spec.blend, pose: exact });
    expect(mesh.info.components).toBe(1);
    // 不是围成一圈的骨架原样返回，腰和胸的圆点照旧有
    const plain = makeSolver(buildSkeleton(buildFigure(specOf({ bodyStyle: 'anime' }))).bones);
    expect(fitRing(plain, squat)).toBe(squat);
    expect(isRingRig(plain.rig)).toBe(false);
    expect(buildHandles(plain).filter((h) => h.group === 'torso').length).toBeGreaterThan(1);
  });

  it('蒙皮：每个人的头只跟自己的骨骼；带骨骼导出 GLB、VRM 都写得出来', () => {
    useAnimeBody();
    const d = defaultSpec();
    const spec = specOf({ bodyStyle: 'anime', ring: 'fused', ringCount: 6, counts: { ...d.counts, breasts: 4, armPairs: 1 } });
    const figure = buildFigure(spec);
    const unit = { parts: figure.parts, scale: 1 };
    const { mesh } = runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: spec.blend });
    const rig = buildSkeleton(unit);
    const skin = skinVertices(unit, rig, mesh.positions);
    // 每个人头顶附近的顶点：权重里只有这个人自己的骨骼（名字带同一个序号），没有旁边那个人的
    const owner = (name: string) => /\.(\d{3})$/.exec(name)?.[1] ?? '001';
    for (const k of [0, 2, 5]) {
      const head = rig.bones.find((b) => b.name === (k ? `Head.00${k + 1}` : 'Head'))!;
      let checked = 0;
      for (let v = 0; v < mesh.positions.length / 3; v++) {
        const far = Math.hypot(mesh.positions[v * 3] - head.tail[0], mesh.positions[v * 3 + 1] - head.tail[1], mesh.positions[v * 3 + 2] - head.tail[2]);
        if (far > 0.06) continue;
        checked++;
        for (let j = 0; j < 4; j++) {
          if (skin.weights[v * 4 + j] < 0.02) continue;
          const bone = rig.bones[skin.joints[v * 4 + j]];
          expect(owner(bone.name), bone.name).toBe(owner(head.name));
        }
      }
      expect(checked).toBeGreaterThan(10);
    }
    // 胯只有一根，在圈心的芯子里
    expect(rig.bones[0].name).toBe('Hips');
    expect(rig.bones[0].part).toBe('Core');
    expect(Math.hypot(rig.bones[0].head[0], rig.bones[0].head[2])).toBeLessThan(1e-9);
    // GLB：骨骼、权重都写得进去
    const skeleton = buildSkeleton(figure);
    const glb = writeGlb([{ name: 'OC_BaseMesh', positions: mesh.positions.map((v) => v * figure.scale), normals: mesh.normals, indices: mesh.triangles, joints: skin.joints, weights: skin.weights }], { skeleton, rigName: 'OC_Rig' });
    expect(glb.byteLength).toBeGreaterThan(1000);
    // VRM：两侧的手臂各长在不同的人身上，原样对不上人形骨骼；改接到第一个人的脊柱上以后对得上
    expect(() => humanoidMap(skeleton)).toThrow();
    const humanoid = ringHumanoid(skeleton);
    const map = humanoidMap(humanoid);
    const name = (slot: string) => humanoid.bones[map.get(slot)!].name;
    expect(['hips', 'spine', 'head', 'leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg'].map(name)).toEqual(['Hips', 'Spine', 'Head', 'UpperArm_L', 'UpperArm_R', 'UpperLeg_L', 'UpperLeg_R']);
    humanoid.bones.forEach((b, i) => expect(b.parent).toBeLessThan(i));
    const vrm = writeVrm({ positions: mesh.positions, normals: mesh.normals, indices: mesh.triangles, joints: skin.joints, weights: skin.weights, color: 0xcccccc }, humanoid, { title: '围成一圈', author: '测试', license: 'private' });
    expect(vrm.byteLength).toBeGreaterThan(1000);
    // 不是围成一圈的骨架原样返回
    const plain = buildSkeleton(buildFigure(specOf({ bodyStyle: 'anime' })));
    expect(ringHumanoid(plain)).toBe(plain);
  });

  it('腿的条数和圈联动：「腿」几条就是每个人几条，腿多了圈跟着大；一条腿的圈照平常的胯宽算；每个人最多 RING_PERSON_LEGS 条', () => {
    useAnimeBody();
    const d = defaultSpec();
    for (const style of ['anime', 'mannequin'] as const) {
      const build = (legs: number, ringLegs: BodySpec['ringLegs'] = 'rim') => buildFigure(specOf({ bodyStyle: style, ring: 'fused', ringCount: 5, ringLegs, counts: { ...d.counts, legs } }));
      /** 外圈的腿离圈心多远（最远的那条） */
      const far = (figure: ReturnType<typeof build>) => Math.max(...figure.parts.filter((p) => p.type === 'leg' && !p.parent).map((p) => Math.hypot(p.pos[0], p.pos[2])));
      const two = build(2);
      for (const legs of [1, 3, 4]) {
        const figure = build(legs);
        // 只在外圈：五个人每人 legs 条；名字、骨骼都不重复
        expect(figure.parts.filter((p) => p.type === 'leg').length, `${style} ${legs}`).toBe(5 * legs);
        expect(new Set(figure.parts.map((p) => p.name)).size).toBe(figure.parts.length);
        const bones = buildSkeleton(figure).bones.map((b) => b.name);
        expect(new Set(bones).size).toBe(bones.length);
        // 腿多了圈跟着大；一条腿的圈不比两条腿的小多少（胯还是平常那么宽，腿在这个人正中）
        if (legs > 2) expect(far(figure)).toBeGreaterThan(far(two) * (legs / 2) * 0.8);
        else expect(far(figure)).toBeGreaterThan(far(two) * 0.7);
        // 每条外圈的腿记着自己长在哪个人身上（摆了姿势重新融合时腿根跟着这个人）：每个人正好 legs 条，都在这个人朝外的那一段里
        const torsos = figure.parts.filter((p) => p.type === 'torso' && /^Torso(_[A-Z])?$/.test(p.name)).map((p) => p.name);
        expect(torsos.length).toBe(5);
        for (const [k, torso] of torsos.entries()) {
          const own = figure.parts.filter((p) => p.type === 'leg' && p.ringOf === torso);
          expect(own.length, `${style} ${legs} ${torso}`).toBe(legs);
          for (const leg of own) {
            const off = Math.atan2(leg.pos[0], leg.pos[2]) - (k * 2 * Math.PI) / 5;
            expect(Math.abs(Math.atan2(Math.sin(off), Math.cos(off))), `${style} ${legs} ${leg.name}`).toBeLessThan(Math.PI / 5 + 1e-6);
          }
        }
      }
      // 圈心底下的腿接着编号，也不重复；三条腿的圈大，底下排得更多
      const filled = build(3, 'fill');
      expect(new Set(filled.parts.map((p) => p.name)).size).toBe(filled.parts.length);
      const names = buildSkeleton(filled).bones.map((b) => b.name);
      expect(new Set(names).size).toBe(names.length);
      // 圈心底下的腿不在哪个人身上
      expect(filled.parts.filter((p) => p.type === 'leg' && p.ringOf).length).toBe(5 * 3);
      expect(filled.parts.filter((p) => p.type === 'leg').length).toBeGreaterThan(buildFigure(specOf({ bodyStyle: style, ring: 'fused', ringCount: 5 })).parts.filter((p) => p.type === 'leg').length);
      // 每个人最多这么多条
      expect(build(12).parts.filter((p) => p.type === 'leg').length).toBe(5 * RING_PERSON_LEGS);
      expect(runJob({ parts: build(3).parts, voxel: VOXEL.preview, blend: 0.02 }).mesh.info.components, style).toBe(1);
      expect(runJob({ parts: build(1).parts, voxel: VOXEL.preview, blend: 0.02 }).mesh.info.components, style).toBe(1);
    }
  });

  it('阴茎和圈联动：每副胯几根就是每个人的胯上各长几根，跟着这个人朝外；部件、骨骼接着编号', () => {
    useAnimeBody();
    useGenital();
    const d = defaultSpec();
    for (const style of ['anime', 'mannequin'] as const) {
      for (const mode of ['hips', 'fused'] as const) {
        const figure = buildFigure(specOf({ bodyStyle: style, ring: mode, ringCount: 4, counts: { ...d.counts, penises: 2 } }));
        const penises = figure.parts.filter((p) => /^Penis_\d+$/.test(p.name));
        // 四个人每人两根，编号 1 到 8；骨骼的名字跟着部件的号（摆姿势、成人开关都照这个样子认）
        expect(penises.map((p) => p.name).sort(), `${style} ${mode}`).toEqual(Array.from({ length: 8 }, (_, i) => `Penis_0${i + 1}`));
        expect(new Set(figure.parts.map((p) => p.name)).size).toBe(figure.parts.length);
        for (const p of figure.parts.filter((q) => q.type === 'genital')) {
          for (const b of p.bones ?? []) expect(b.name.startsWith(p.name), b.name).toBe(true);
          for (const g of p.grafts ?? []) for (const name of Object.values(g.bones)) expect(name.startsWith(p.name), name).toBe(true);
        }
        const bones = buildSkeleton(figure).bones.map((b) => b.name);
        expect(new Set(bones).size).toBe(bones.length);
        // 每根都在自己那个人的前面：从圈心往外数，根部比这个人的髋关节靠外
        for (const p of penises) expect(Math.hypot(p.pos[0], p.pos[2])).toBeGreaterThan(0.05);
        expect(runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: 0.02 }).mesh.info.components, `${style} ${mode}`).toBe(1);
      }
    }
    // 没有阴茎时一个也不长
    expect(buildFigure(specOf({ bodyStyle: 'anime', ring: 'fused', ringCount: 4 })).parts.some((p) => p.type === 'genital')).toBe(false);
  });

  it('前后排：胯几排、每排几个胯单独设；部件、骨骼不重名，腿数是排数 × 每排几个 × 两条，头还照人数；中间几排的上身只在人底下；两头多出来的胯不带脊柱', () => {
    useAnimeBody();
    const d = defaultSpec();
    for (const [rows, per] of [
      [2, 0],
      [5, 6],
      [4, 2],
      [3, 1],
    ] as const) {
      const f = buildFigure(specOf({ bodyStyle: 'anime', ring: 'rows', ringCount: 6, ringHipRows: rows, ringHipsPerRow: per, counts: { ...d.counts, breasts: 4, armPairs: 2 } }));
      const label = `${rows} 排 × ${per}`;
      expect(new Set(f.parts.map((p) => p.name)).size, label).toBe(f.parts.length);
      const bones = buildSkeleton(f).bones.map((b) => b.name);
      expect(new Set(bones).size, label).toBe(bones.length);
      const hips = per || 3;
      expect(f.parts.filter((p) => p.type === 'leg' && !p.parent).length, label).toBe(rows * hips * 2);
      expect(f.parts.filter((p) => p.type === 'head').length, label).toBe(6);
      // 一排三个人站多宽：最外面的人的中心再往外半个人；胯比人多时，这以外的胯上面没有人
      const under = Array.from({ length: hips }, (_, i) => i - (hips - 1) / 2).filter((t) => hips < 3 || Math.abs(t) <= 1.5 + 1e-6).length;
      expect(f.parts.filter((p) => /^Torso/.test(p.name) && p.fuseAs === 'tail').length, label).toBe((rows - 2) * under);
      const bare = f.parts.filter((p) => /^Torso/.test(p.name) && p.fuseAs === 'wing' && !p.bones?.length).length;
      expect(bare, label).toBe(rows * (hips - under));
    }
  });

  it('前后排的胸：隔一排错开半只、少一只，每一列左右照最上面一排对齐（前后两面都是）', () => {
    useAnimeBody();
    const d = defaultSpec();
    const figure = buildFigure(specOf({ bodyStyle: 'anime', ring: 'rows', ringCount: 6, ringSpread: 0.5, armLayout: 'fan', chestRow: 2, counts: { ...d.counts, breasts: 6, armPairs: 3 }, shape: { ...d.shape, bust: 1.87 } }));
    const xfs = worldTransforms({ parts: figure.parts, scale: 1 });
    const chests = figure.parts.filter((p) => p.type === 'chest').map((p) => xfs.get(p.name)!.pos);
    // 每面三排：6、5、6
    expect(chests.length).toBe(2 * (6 + 5 + 6));
    for (const side of [1, -1]) {
      const face = chests.filter((p) => p[2] * side > 0);
      const heights = [...new Set(face.map((p) => Math.round(p[1] * 100)))].sort((a, b) => b - a);
      expect(heights.length).toBe(3);
      const rows = heights.map((y) => face.filter((p) => Math.round(p[1] * 100) === y).map((p) => p[0]).sort((a, b) => a - b));
      expect(rows.map((row) => row.length)).toEqual([6, 5, 6]);
      // 交错渐小：一排比一排少一只（6、5、4）
      const tapered = buildFigure(specOf({ bodyStyle: 'anime', ring: 'rows', ringChest: 'taper', ringCount: 6, ringSpread: 0.5, armLayout: 'fan', chestRow: 2, counts: { ...d.counts, breasts: 6, armPairs: 3 }, shape: { ...d.shape, bust: 1.87 } }));
      const txf = worldTransforms({ parts: tapered.parts, scale: 1 });
      const tface = tapered.parts.filter((p) => p.type === 'chest').map((p) => txf.get(p.name)!.pos).filter((p) => p[2] * side > 0);
      const theights = [...new Set(tface.map((p) => Math.round(p[1] * 100)))].sort((a, b) => b - a);
      expect(theights.map((y) => tface.filter((p) => Math.round(p[1] * 100) === y).length)).toEqual([6, 5, 4]);
      // 第三排和第一排一列对一列；第二排的每一只在第一排相邻两只的正中间（差不到 1.5 cm）
      rows[2].forEach((x, i) => expect(Math.abs(x - rows[0][i])).toBeLessThan(0.015));
      rows[1].forEach((x, i) => expect(Math.abs(x - (rows[0][i] + rows[0][i + 1]) / 2)).toBeLessThan(0.015));
    }
  });

  it('围出来的胸能手动微调：挪哪只动哪只，别的不动（前后排、围成一圈交错成串的都是）', () => {
    useAnimeBody();
    const d = defaultSpec();
    for (const ring of ['rows', 'fused', 'hips'] as const) {
      const spec = { bodyStyle: 'anime', ring, ringCount: 6, armLayout: 'fan', chestRow: 2, counts: { ...d.counts, breasts: 6, armPairs: 3 }, shape: { ...d.shape, bust: 1.6 } } as const;
      const at = (overrides: BodySpec['overrides']) => {
        const figure = buildFigure(specOf({ ...spec, overrides }));
        const xfs = worldTransforms({ parts: figure.parts, scale: 1 });
        return new Map(figure.parts.filter((p) => p.type === 'chest').map((p) => [p.name, xfs.get(p.name)!.pos]));
      };
      const base = at({});
      const moved = at({ Chest_01_L: { position: [0, 0.1, 0] }, Chest_05_L: { position: [0.05, 0, 0.05] } });
      expect(moved.size, ring).toBe(base.size);
      expect(base.has('Chest_05_L'), ring).toBe(true);
      for (const [name, was] of base) {
        const now = moved.get(name)!;
        const by = [now[0] - was[0], now[1] - was[1], now[2] - was[2]];
        const want = name === 'Chest_01_L' ? [0, 0.1, 0] : name === 'Chest_05_L' ? [0.05, 0, 0.05] : [0, 0, 0];
        by.forEach((v, k) => expect(Math.abs(v - want[k]), `${ring} ${name}`).toBeLessThan(1e-6));
      }
    }
  });

  it('松紧到 30%：前后排的腿只贴着、不叠着（左右不再往里挤，靠胯收窄变窄），围成一圈的到 50% 为止', () => {
    useAnimeBody();
    const d = defaultSpec();
    expect(RING_SPREAD.min).toBe(0.3);
    const size = (ring: BodySpec['ring'], ringSpread: number) => {
      const figure = buildFigure(specOf({ bodyStyle: 'anime', ring, ringCount: 6, ringSpread, counts: { ...d.counts, breasts: 0, armPairs: 0 } }));
      const xfs = worldTransforms({ parts: figure.parts, scale: 1 });
      const legs = figure.parts.filter((p) => p.type === 'leg' && !p.parent).map((p) => xfs.get(p.name)!.pos);
      const span = (k: number) => Math.max(...legs.map((p) => p[k])) - Math.min(...legs.map((p) => p[k]));
      return [span(0), span(2)];
    };
    const [w5, d5] = size('rows', 0.5);
    const [w4, d4] = size('rows', 0.4);
    const [w3, d3] = size('rows', 0.3);
    // 腿根左右占的范围不随松紧变大；前后也是——三排胯已经贴着了，每一排的胯都是完整的。
    // 相邻两个人最近到大腿贴着大腿：叠着的话腿之间的缝把叠的部分削成平面
    expect(w4).toBeLessThanOrEqual(w5 + 1e-6);
    expect(w3).toBeLessThanOrEqual(w4 + 1e-6);
    const tight = buildFigure(specOf({ bodyStyle: 'anime', ring: 'rows', ringCount: 6, ringSpread: 0.3, counts: { ...d.counts, breasts: 0, armPairs: 0 } }));
    const txf = worldTransforms({ parts: tight.parts, scale: 1 });
    const front = tight.parts.filter((p) => p.type === 'leg' && !p.parent).map((p) => txf.get(p.name)!.pos).filter((p) => p[2] > 0.1).map((p) => p[0]).sort((a, b) => a - b);
    expect(front.length).toBe(6);
    // 六条腿的根相邻两条都隔着十厘米以上（一条大腿那么宽）
    for (let i = 1; i < front.length; i++) expect(front[i] - front[i - 1]).toBeGreaterThan(0.1);
    expect(d4).toBeLessThanOrEqual(d5 + 1e-6);
    expect(d3).toBeLessThanOrEqual(d4 + 1e-6);
    // 胯收窄以后一副胯前后也薄一点，三排跟着贴近几厘米
    expect(d5 - d3).toBeLessThan(0.05);
    // 围成一圈的：30% 和 50% 摆出来一样
    for (const ring of ['fused', 'hips'] as const) expect(size(ring, 0.3)).toEqual(size(ring, 0.5));
  });

  it('前后排：前后两排背靠背（单数时前排多一个），每个人腰以下朝正前、腰以上转过去，头凑在一起；中间多一排没有头的；三排胯分开、腿都朝前；每侧前后两组手臂，前后各一团胸', () => {
    useAnimeBody();
    const d = defaultSpec();
    for (const style of ['anime', 'mannequin'] as const) {
      const build = (ringCount: number, counts: Partial<BodySpec['counts']> = {}) =>
        buildFigure(specOf({ bodyStyle: style, ring: 'rows', ringCount, armLayout: 'fan', counts: { ...d.counts, breasts: 5, armPairs: 3, ...counts }, shape: { ...d.shape, bust: 2.3 } }));
      const at = (figure: ReturnType<typeof build>) => worldTransforms({ parts: figure.parts, scale: 1 });
      const headsAhead = (figure: ReturnType<typeof build>) => {
        const xfs = at(figure);
        const heads = figure.parts.filter((p) => p.type === 'head').map((p) => xfs.get(p.name)!.pos[2]);
        return [heads.filter((z) => z > 0).length, heads.filter((z) => z < 0).length];
      };
      // 人数跟着「围几个人」走，单数时前排多一个
      expect(headsAhead(build(6)), style).toEqual([3, 3]);
      expect(headsAhead(build(5))).toEqual([3, 2]);
      expect(headsAhead(build(3))).toEqual([2, 1]);
      expect(headsAhead(build(8))).toEqual([4, 4]);
      const six = build(6);
      const xfs = at(six);
      expect(new Set(six.parts.map((p) => p.name)).size).toBe(six.parts.length);
      const bones = buildSkeleton(six).bones.map((b) => b.name);
      expect(new Set(bones).size).toBe(bones.length);
      const legs = six.parts.filter((p) => p.type === 'leg' && !p.parent);
      const legY = Math.max(...legs.map((p) => p.pos[1]));
      // 躯干：每个人的上身（只留腰以上，照有没有头认）、九份下身（只留腰以下：前排三个人的、中间一排、后排三个人的），
      // 加上中间一排没有头的上身
      const necked = new Set(six.parts.filter((p) => p.type === 'head').map((p) => p.parent));
      const hollow = six.parts.filter((p) => /^Torso/.test(p.name) && p.fuseAs === 'tail');
      expect(hollow.length).toBe(3);
      const torsos = six.parts
        .filter((p) => /^Torso/.test(p.name))
        .map((p) => {
          const way = rotate(xfs.get(p.name)!.quat, [0, 0, 1]);
          const right = rotate(xfs.get(p.name)!.quat, [1, 0, 0]);
          const up = rotate(xfs.get(p.name)!.quat, [0, 1, 0]);
          // 髋关节那么高的地方它在哪（躯干的原点在脚底那么低）
          const rise = (legY - xfs.get(p.name)!.pos[1]) / up[1];
          // 摆位先转朝向，再前后靠、左右歪。用两根轴的 Z 分量还原第一步的朝向。
          const yaw = (Math.atan2(-right[2], way[2]) * 180) / Math.PI;
          return { upper: necked.has(p.name), x: xfs.get(p.name)!.pos[0] + up[0] * rise, z: xfs.get(p.name)!.pos[2] + up[2] * rise, yaw, up, part: p };
        });
      const uppers = torsos.filter((t) => t.upper);
      const lowers = torsos.filter((t) => !t.upper && t.part.fuseAs === 'wing');
      expect(uppers.length).toBe(6);
      expect(lowers.length).toBe(9);
      const waistCut = (part: (typeof uppers)[number]['part']) => {
        const cut = part.prims.find((q) => q.name === 'Half');
        if (cut?.kind !== 'ellipsoid' || !cut.cut) throw new Error(`${part.name} 没有腰部切面`);
        const { pos, quat } = xfs.get(part.name)!;
        return add(pos, rotate(quat, cut.center));
      };
      // 上身：从自己那副胯上长出来（腰上拧了一下）；每排正中的朝正前（正后），最外面的往外转 45° 上下；都往自己背后靠
      const wide = (2 * 0.4 * six.metrics.headHeight) / six.scale;
      for (const one of uppers) {
        const ahead = one.z > 0;
        const turned = ahead ? one.yaw : 180 - Math.abs(one.yaw);
        // 两截在腰上接。切面中心的 X、Z 相同，不能把上身的轴往下延长到髋关节来量。
        const [x, , z] = waistCut(one.part);
        expect(lowers.some((t) => {
          const [lx, , lz] = waistCut(t.part);
          return Math.hypot(lx - x, lz - z) < 1e-6;
        }), style).toBe(true);
        if (Math.abs(one.x) < 0.02) expect(Math.abs(turned)).toBeLessThan(1);
        else {
          expect(Math.sign(Math.sin((one.yaw * Math.PI) / 180))).toBe(Math.sign(one.x));
          expect(Math.abs(turned)).toBeGreaterThan(35);
          expect(Math.abs(turned)).toBeLessThan(55);
        }
        expect(one.up[2] * (ahead ? 1 : -1)).toBeLessThan(-0.05);
        // 削掉了腰以下
        expect(one.part.prims.some((q) => q.name === 'Half' && q.kind === 'ellipsoid' && q.cut)).toBe(true);
      }
      // 下身：三排三列的方阵，都朝正前、直着站；每副带着自己的腿（一共 18 条），三排前后隔开
      // （前排、后排的骨盆跟着上身一起往正中靠：前排往后、后排往前，中间一排直着；左右不歪）
      for (const one of lowers) {
        expect(Math.abs(one.yaw)).toBeLessThan(1);
        expect(Math.abs(one.up[0])).toBeLessThan(1e-6);
        expect(one.up[1]).toBeGreaterThan(0.95);
        const row = one.z > 0.1 ? 1 : one.z < -0.1 ? -1 : 0;
        if (row) expect(one.up[2] * row).toBeLessThan(-0.05);
        else expect(Math.abs(one.up[2])).toBeLessThan(1e-6);
        expect(one.part.fuseAs).toBe('wing');
      }
      // 上下两截在腰上接：下身（胯和腿）只斜一点点（腿差不多是直的），上身绕腰朝同一边靠得更多，头才凑得到一起
      for (const one of uppers) {
        const own = lowers.reduce((a, b) => (Math.hypot(b.x - one.x, b.z - one.z) < Math.hypot(a.x - one.x, a.z - one.z) ? b : a));
        if (Math.abs(one.x) >= 0.02) continue;
        expect(Math.abs(own.up[2])).toBeLessThan(0.08);
        expect(one.up[2] * own.up[2]).toBeGreaterThan(0);
        expect(Math.abs(one.up[2])).toBeGreaterThanOrEqual(Math.abs(own.up[2]) - 1e-6);
      }
      const rowOf = (z: number) => (z > 0.1 ? 1 : z < -0.1 ? -1 : 0);
      for (const row of [1, 0, -1]) {
        const mine = lowers.filter((t) => rowOf(t.z) === row).sort((a, b) => a.x - b.x);
        expect(mine.length, String(row)).toBe(3);
        expect(mine[1].x - mine[0].x).toBeGreaterThan(wide);
        expect(mine[2].x - mine[1].x).toBeCloseTo(mine[1].x - mine[0].x, 5);
      }
      expect(legs.length).toBe(18);
      for (const row of [1, 0, -1]) expect(legs.filter((p) => rowOf(p.pos[2]) === row).length, String(row)).toBe(6);
      for (const leg of legs) {
        const own = lowers.reduce((a, b) => (Math.hypot(b.x - leg.pos[0], b.z - leg.pos[2]) < Math.hypot(a.x - leg.pos[0], a.z - leg.pos[2]) ? b : a));
        // （下半截的胯加宽了，白模的两条腿跟着分开）
        expect(Math.hypot(own.x - leg.pos[0], own.z - leg.pos[2]), leg.name).toBeLessThan(0.16);
      }
      // 腿的名字、骨骼从头编（上身没有腿）：第一副是 Leg_01_L、UpperLeg_L，带骨骼导出、VRM 都认它
      expect(legs.some((p) => p.name === 'Leg_01_L')).toBe(true);
      expect(bones).toContain('UpperLeg_L');
      expect(bones).toContain('UpperLeg_R');
      const rig = makeSolver(buildSkeleton(six).bones).rig;
      expect(isRingRig(rig)).toBe(true);
      rig.names.forEach((name, j) => {
        if (!/^Foot/.test(name)) return;
        const toe = sub(rig.tail[j], rig.head[j]);
        const flat = Math.hypot(toe[0], toe[2]);
        if (flat > 1e-3) expect(toe[2] / flat, name).toBeGreaterThan(0.94);
      });
      // 头：一排三个挨着，前排、后排分在前后两边
      const heads = six.parts.filter((p) => p.type === 'head').map((p) => xfs.get(p.name)!.pos);
      for (const side of [1, -1]) {
        const row = heads.filter((h) => h[2] * side > 0).sort((a, b) => a[0] - b[0]);
        expect(row.length).toBe(3);
        for (let i = 1; i < row.length; i++) expect(row[i][0] - row[i - 1][0], style).toBeLessThan(wide * 1.2);
        const heights = row.map((h) => h[1]);
        expect(Math.max(...heights) - Math.min(...heights), style).toBeLessThan(wide * 0.32);
      }
      // 手臂：每侧六条，长在前排、后排最外面那两个人身上（两组）
      const arms = six.parts.filter((p) => p.type === 'arm');
      expect(arms.length).toBe(12);
      for (const side of [1, -1]) {
        const mine = arms.filter((p) => xfs.get(p.name)!.pos[0] * side > 0);
        expect(mine.length).toBe(6);
        const parents = new Set(mine.map((p) => p.parent));
        expect(parents.size).toBe(2);
        for (const parent of parents) {
          const slopes = mine.filter((p) => p.parent === parent).map((p) => {
            const shoulder = p.bones!.find((b) => /^UpperArm/.test(b.name))!.head;
            const wrist = p.bones!.find((b) => /^LowerArm/.test(b.name))!.tail;
            const [x, y, z] = rotate(xfs.get(p.name)!.quat, sub(wrist, shoulder));
            return Math.atan2(y, Math.hypot(x, z));
          });
          expect(Math.max(...slopes)).toBeGreaterThan(Math.PI / 7);
          expect(Math.min(...slopes)).toBeLessThan(-Math.PI / 7);
        }
      }
      // 胸：前后两面一样多，每只一样大
      const chests = six.parts.filter((p) => p.type === 'chest');
      expect(chests.length).toBeGreaterThanOrEqual(24);
      expect(chests.length % 2).toBe(0);
      expect(chests.every((p) => p.fuseAs === 'lower')).toBe(true);
      const sizes = chests.map((p) => {
        const prim = p.prims.find((q) => q.kind === 'chest');
        return prim?.kind === 'chest' ? (prim.scale?.[0] ?? 1) : (p.scale ?? 1);
      });
      expect(new Set(sizes.map((v) => v.toFixed(4))).size).toBe(1);
      // 都是一整块；没有胸、没有手臂、每人一条或三条腿也是
      expect(runJob({ parts: six.parts, voxel: VOXEL.preview, blend: 0.02 }).mesh.info.components, style).toBe(1);
      for (const counts of [{ breasts: 0, armPairs: 0 }, { legs: 1 }, { legs: 3 }]) {
        const figure = build(5, counts);
        expect(new Set(figure.parts.map((p) => p.name)).size).toBe(figure.parts.length);
        expect(runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: 0.02 }).mesh.info.components, `${style} ${JSON.stringify(counts)}`).toBe(1);
      }
    }
  }, 180_000);

  it('前后排套现成姿势：所有的腿朝一个方向迈，斜着的人的头照他自己的朝向转，每侧两组手臂各摆各的；重新融合还是一整块', () => {
    useAnimeBody();
    const d = defaultSpec();
    const spec = specOf({ bodyStyle: 'anime', ring: 'rows', ringCount: 6, counts: { ...d.counts, breasts: 4, armPairs: 2 }, shape: { ...d.shape, bust: 2.3 } });
    const figure = buildFigure(spec);
    const solver = makeSolver(buildSkeleton(figure).bones);
    const { rig } = solver;
    const walk = POSE_LIBRARY.find((p) => p.name === '走')!.posing;
    const own = fitRing(solver, walk);
    // 腿：照原样套，左右照长在整个身子的哪一边
    let sided = 0;
    rig.names.forEach((name, j) => {
      if (!/^UpperLeg/.test(name)) return;
      const x = rig.head[j][0];
      if (Math.abs(x) < 0.03) return;
      expect(own.bones[name], name).toEqual(walk.bones[x > 0 ? 'UpperLeg_L' : 'UpperLeg_R']);
      sided++;
    });
    expect(sided).toBe(18);
    // 背不弯
    for (const name of Object.keys(own.bones)) expect(/^(Spine|Chest|UpperChest)/.test(name), name).toBe(false);
    // 头：六个都写了。低头（绕自己的左右轴往前转）以后每个头都是朝自己脸的方向低下去的——斜着的那个朝斜外
    const nod: Posing = { version: 3, bones: { Head: [Math.sin(0.25), 0, 0, Math.cos(0.25)] } };
    const nodded = fitRing(solver, nod);
    const before = forward(rig, stateOf(solver, { version: 3, bones: {} }));
    const after = forward(rig, stateOf(solver, nodded));
    const heads = rig.names.flatMap((name, j) => (/^Head(\.\d{3})?$/.test(name) ? [j] : []));
    expect(heads.length).toBe(6);
    for (const j of heads) {
      const tip = (frame: typeof before) => rotate(frame.rot[j], sub(rig.tail[j], rig.head[j]));
      const moved = sub(tip(after), tip(before));
      const flat = Math.hypot(moved[0], moved[2]);
      expect(flat, rig.names[j]).toBeGreaterThan(0.01);
      // 头顶往哪边倒：就是这个人脸朝的方向。从上面看和「从正中朝外」差不到 40°，正中的两个正好朝正前、正后
      const out = Math.hypot(rig.head[j][0], rig.head[j][2]);
      const cos = (moved[0] * rig.head[j][0] + moved[2] * rig.head[j][2]) / (flat * out);
      expect(cos, rig.names[j]).toBeGreaterThan(0.75);
      if (Math.abs(rig.head[j][0]) < 0.02) expect(Math.abs(moved[0]) / flat).toBeLessThan(0.05);
      // 斜着的人：朝斜外 45° 上下，不是正对着从正中朝外的方向（那个方向偏得更多）
      else expect(Math.abs(Math.atan2(Math.abs(moved[0]), Math.abs(moved[2])) - Math.PI / 4)).toBeLessThan(0.2);
    }
    // 手臂：每侧两组（前排、后排最外面的人身上各一组），四组都写了，都登记成「跟着动的」
    const posed = followArms(solver, fitArms(solver, own));
    expect(posed.followers.length).toBe(8);
    for (const name of ['UpperArm_L', 'UpperArm_L.002', 'UpperArm_R.003', 'UpperArm_R.004', 'UpperArm_L.003', 'UpperArm_R']) expect(own.bones[name], name).toBeDefined();
    // 重新融合还是一整块（这里不走「手臂让开身体」那一步，手臂不摆）
    const still: Posing = { ...own, bones: Object.fromEntries(Object.entries(own.bones).filter(([name]) => !/^(Shoulder|UpperArm|LowerArm|Hand|Thumb|Index|Middle|Ring|Little|Finger)/.test(name))) };
    const frame = forward(rig, stateOf(solver, still));
    const exact = poseMatrices(rig, frame, figure.scale);
    expect(refusable(figure, exact)).toBe(true);
    expect(runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: spec.blend, pose: exact }).mesh.info.components).toBe(1);
  });

  it('圈的松紧到 50%：整圈跟着缩，腿还长在自己的胯上；腿比平常往外叉开得多、一前一后错开，摆姿势时腿之间不扯蹼', () => {
    useAnimeBody();
    const build = (ringSpread: number, style: BodySpec['bodyStyle'] = 'anime') => buildFigure(specOf({ bodyStyle: style, ring: 'fused', ringCount: 6, ringSpread, ringLegs: 'rim' }));
    const at = (figure: ReturnType<typeof build>, name: string) => worldTransforms({ parts: figure.parts, scale: 1 }).get(name)!.pos;
    const far = (figure: ReturnType<typeof build>, name: string) => Math.hypot(at(figure, name)[0], at(figure, name)[2]);
    /** 一条腿的脚（最低那根骨骼的末端）离圈心多远 */
    const foot = (figure: ReturnType<typeof build>, name: string) => {
      const part = figure.parts.find((p) => p.name === name)!;
      const low = part.bones!.reduce((lo, b) => (b.tail[1] < lo.tail[1] ? b : lo));
      const tip = rotate(part.quat, low.tail);
      return Math.hypot(part.pos[0] + tip[0], part.pos[2] + tip[2]);
    };
    expect(RING_SPREAD_CIRCLE_MIN).toBe(0.5);
    for (const style of ['anime', 'mannequin'] as const) {
      const tight = build(0.5, style);
      const usual = build(0.76, style);
      // 整圈跟着缩：胯、头都更靠圈心
      expect(far(tight, 'Leg_01_L'), style).toBeLessThan(far(usual, 'Leg_01_L') * 0.8);
      expect(far(tight, 'Head_01'), style).toBeLessThan(far(usual, 'Head_01'));
      // 腿根还在自己的胯里（以前让腿留在外面的圈上，差出一大截，整个离体）
      expect(Math.abs(far(tight, 'Leg_01_L') - far(tight, 'Torso')), style).toBeLessThan(0.2);
      // 腿往外叉开得多：脚比胯远出一截，比平常远
      expect(foot(tight, 'Leg_01_L') - far(tight, 'Leg_01_L'), style).toBeGreaterThan(foot(usual, 'Leg_01_L') - far(usual, 'Leg_01_L') + 0.03);
      expect(runJob({ parts: tight.parts, voxel: VOXEL.preview, blend: 0.02 }).mesh.info.components, style).toBe(1);
    }
    // 整圈的腿一前一后错开：绕圈数过去，离圈心的远近一高一低（平常不错开）
    const around = (figure: ReturnType<typeof build>) =>
      figure.parts
        .filter((p) => p.type === 'leg' && !p.parent)
        .map((p) => ({ a: Math.atan2(p.pos[0], p.pos[2]), r: Math.hypot(p.pos[0], p.pos[2]) }))
        .sort((p, q) => p.a - q.a)
        .map((p) => p.r);
    const zig = around(build(0.5));
    for (let i = 1; i < zig.length; i++) expect(Math.abs(zig[i] - zig[i - 1]), String(i)).toBeGreaterThan(0.05);
    const flat = around(build(0.76));
    for (let i = 1; i < flat.length; i++) expect(Math.abs(flat[i] - flat[i - 1]), String(i)).toBeLessThan(1e-6);
  });

  it('圈的松紧：数值小的圈小、头靠得近、圈心的芯子细；从最紧到最松都是一整块', () => {
    useAnimeBody();
    const d = defaultSpec();
    const measure = (ringSpread: number) => {
      const spec = specOf({ bodyStyle: 'anime', ring: 'fused', ringCount: 6, ringSpread, counts: { ...d.counts, breasts: 4 } });
      const figure = buildFigure(spec);
      const xfs = worldTransforms({ parts: figure.parts, scale: 1 });
      const far = (name: string) => Math.hypot(xfs.get(name)!.pos[0], xfs.get(name)!.pos[2]);
      const core = figure.parts.find((p) => p.name === 'Core')!.prims.find((q) => q.kind === 'loft');
      const thick = core?.kind === 'loft' ? Math.max(...core.rings.map((r) => r.w)) : 0;
      const whole = runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: spec.blend }).mesh.info.components;
      return { hip: far('Leg_01_L'), head: far('Head_01'), thick, whole };
    };
    const tight = measure(RING_SPREAD_CIRCLE_MIN);
    const medium = measure(0.88);
    const loose = measure(1);
    const wide = measure(RING_SPREAD.max);
    for (const key of ['hip', 'head', 'thick'] as const) {
      expect(tight[key], key).toBeLessThan(medium[key]);
      expect(medium[key], key).toBeLessThan(loose[key]);
      // 再松头不跟着散开：几个头还是在圈上正好挨着
      if (key === 'head') expect(Math.abs(wide.head - loose.head)).toBeLessThan(0.02);
      else expect(loose[key], key).toBeLessThan(wide[key]);
    }
    expect(tight.hip).toBeLessThan(loose.hip * 0.8);
    for (const one of [tight, medium, loose, wide]) expect(one.whole).toBe(1);
    // 设定：缺省最紧；夹在范围里；以前三档的字还认
    expect(defaultSpec().ringSpread).toBe(RING_SPREAD.def);
    expect(specOf({ ringSpread: 0.1 }).ringSpread).toBe(RING_SPREAD.min);
    expect(specOf({ ringSpread: 9 }).ringSpread).toBe(RING_SPREAD.max);
    expect(specOf({ ringSpread: 'loose' as never }).ringSpread).toBe(1);
    expect(specOf({ ringSpread: 'medium' as never }).ringSpread).toBe(0.88);
    expect(specOf({ ringSpread: 'what' as never }).ringSpread).toBe(RING_SPREAD.def);
  });

  it('并胯融合把人和人之间的沟填平，各有各的胯留着沟', () => {
    useAnimeBody();
    const gap = (mode: 'hips' | 'fused') => {
      const spec = specOf({ bodyStyle: 'anime', ring: mode, ringCount: 6, ringSpread: 1 });
      const figure = buildFigure(spec);
      const xfs = worldTransforms({ parts: figure.parts, scale: 1 });
      const leg = xfs.get('Leg_01_L')!;
      // 相邻两个人正中间那个方向、腰那么高、离圈心和髋关节一样远的一点
      const r = Math.hypot(leg.pos[0], leg.pos[2]);
      const field = compileField({ parts: figure.parts, scale: 1 }, { blend: spec.blend });
      return fieldAt(field, r * Math.sin(Math.PI / 6), leg.pos[1] + 0.2, r * Math.cos(Math.PI / 6));
    };
    expect(gap('hips')).toBeGreaterThan(0.01);
    expect(gap('fused')).toBeLessThan(0);
  });

  it('腿统一朝前：腿长在哪不变，脚尖都朝正前；套姿势时所有的腿朝一个方向迈，重新融合还是一整块', () => {
    useAnimeBody();
    const d = defaultSpec();
    for (const style of ['mannequin', 'anime'] as const) {
      for (const mode of ['hips', 'fused'] as const) {
        const base = { bodyStyle: style, ring: mode, ringCount: 6, counts: { ...d.counts, breasts: 4 } };
        const out = buildFigure(specOf({ ...base, ringLegFacing: 'out' }));
        const front = buildFigure(specOf({ ...base, ringLegFacing: 'front' }));
        const legsOf = (figure: typeof out) => figure.parts.filter((p) => p.type === 'leg' && !p.parent);
        // 腿一样多、名字一样、髋关节从上面看在同一个地方
        expect(legsOf(front).map((p) => p.name)).toEqual(legsOf(out).map((p) => p.name));
        legsOf(front).forEach((leg, i) => {
          expect(leg.pos[0]).toBeCloseTo(legsOf(out)[i].pos[0], 6);
          expect(leg.pos[2]).toBeCloseTo(legsOf(out)[i].pos[2], 6);
        });
        // 每只脚从脚踝到脚尖都朝正前；绕圈朝外的有朝后的
        const feet = (figure: typeof out) =>
          buildSkeleton(figure).bones.filter((b) => /^Foot/.test(b.name)).map((b) => {
            const flat = Math.hypot(b.tail[0] - b.head[0], b.tail[2] - b.head[2]);
            return (b.tail[2] - b.head[2]) / flat;
          });
        expect(feet(front).length).toBe(legsOf(front).length);
        for (const z of feet(front)) expect(z, `${style} ${mode}`).toBeGreaterThan(0.97);
        expect(Math.min(...feet(out))).toBeLessThan(-0.5);
        // 脚底是平的、都落在地上：外圈每条腿的脚踝一样高（圈心底下的腿斜得不一样，不算）
        const ankles = buildSkeleton(front).bones.filter((b) => /^Foot_[LR](\.00[1-6])?$/.test(b.name)).map((b) => b.head[1]);
        expect(ankles.length).toBe(12);
        expect(Math.max(...ankles) - Math.min(...ankles), `${style} ${mode}`).toBeLessThan(0.004);
      }
    }
    const spec = specOf({ bodyStyle: 'anime', ring: 'fused', ringCount: 6, ringLegFacing: 'front', counts: { ...d.counts, breasts: 4, armPairs: 0 } });
    const figure = buildFigure(spec);
    expect(runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: spec.blend }).mesh.info.components).toBe(1);
    const solver = makeSolver(buildSkeleton(figure).bones);
    const { rig } = solver;
    const walk = POSE_LIBRARY.find((p) => p.name === '走')!.posing;
    const own = fitRing(solver, walk);
    // 照原样套，左右照这条腿长在整个身子的哪一边：左半边的都是姿势里的左腿，右半边的都是右腿
    let sided = 0;
    rig.names.forEach((name, j) => {
      if (!/^UpperLeg/.test(name)) return;
      const x = rig.head[j][0];
      if (Math.abs(x) < 0.03) return;
      expect(own.bones[name], name).toEqual(walk.bones[x > 0 ? 'UpperLeg_L' : 'UpperLeg_R']);
      sided++;
    });
    expect(sided).toBe(18);
    // 迈步：同一边的腿膝盖都往同一个方向（前后）挪
    const frame = forward(rig, stateOf(solver, followArms(solver, fitArms(solver, own)).posing));
    const moved = (half: 1 | -1) =>
      rig.names.flatMap((name, j) => {
        if (!/^LowerLeg/.test(name)) return [];
        const top = rig.parent[j];
        return rig.head[top][0] * half > 0.03 ? [frame.pos[j][2] - rig.head[j][2]] : [];
      });
    for (const half of [1, -1] as const) {
      const dz = moved(half);
      expect(dz.length).toBe(9);
      expect(Math.min(...dz) * Math.max(...dz), `哪一边 ${half}`).toBeGreaterThan(0);
    }
    const { mesh } = runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: spec.blend, pose: poseMatrices(rig, frame, figure.scale) });
    expect(mesh.info.components).toBe(1);
    expect(defaultSpec().ringLegFacing).toBe('out');
    expect(specOf({ ringLegFacing: 'what' as never }).ringLegFacing).toBe('out');
  });

  it('腿末端接手（手脚互换）围成一圈也起作用：每条腿都接着手，手心贴地，一整块', () => {
    useAnimeBody();
    for (const style of ['mannequin', 'anime'] as const) {
      for (const ringLegFacing of ['out', 'front'] as const) {
        const spec = specOf({ bodyStyle: style, ring: 'fused', ringCount: 6, legEnd: 'hand', ringLegFacing });
        const figure = buildFigure(spec);
        const legs = figure.parts.filter((p) => p.type === 'leg' && !p.parent);
        expect(legs.length).toBe(20);
        for (const leg of legs) expect(leg.bones?.some((b) => /^Leg(Thumb|Index|Middle|Ring|Little|Finger)/.test(b.name)), `${style} ${leg.name}`).toBe(true);
        // 手是平的：外圈每条腿从手腕（脚踝那个关节）到指根都一样高
        const wrists = buildSkeleton(figure).bones.filter((b) => /^Foot_[LR](\.00[1-6])?$/.test(b.name));
        expect(wrists.length).toBe(12);
        for (const end of ['head', 'tail'] as const) {
          const ys = wrists.map((b) => b[end][1]);
          expect(Math.max(...ys) - Math.min(...ys), `${style} ${ringLegFacing} ${end}`).toBeLessThan(0.004);
        }
        if (ringLegFacing === 'out') expect(runJob({ parts: figure.parts, voxel: VOXEL.preview, blend: spec.blend }).mesh.info.components, style).toBe(1);
      }
    }
    // 单独设一条腿接手也认（别的还是脚）
    const d = defaultSpec();
    const mixed = buildFigure(specOf({ bodyStyle: 'anime', ring: 'fused', ringCount: 6, perLimb: { ...d.perLimb, Leg_03_L: { end: 'hand' } } as never }));
    const handed = mixed.parts.filter((p) => p.type === 'leg' && p.bones?.some((b) => /^Leg(Thumb|Index|Middle|Ring|Little|Finger)/.test(b.name))).map((p) => p.name);
    expect(handed).toEqual(['Leg_03_L']);
  });

  it('连体、成品角色时不围：设定留着，摆出来的是连体；点预设回到不围、胸每排两个', () => {
    const d = defaultSpec();
    const both = specOf({ ring: 'hips', ringCount: 6, conjoined: 'same' });
    expect(both.ring).toBe('hips');
    expect(ringActive(both)).toBe(false);
    expect(ringActive(specOf({ ring: 'hips', bodyStyle: 'character' }))).toBe(false);
    expect(ringActive(specOf({ ring: 'hips' }))).toBe(true);
    // 和没开围成一圈的连体一模一样：两个上半身，不是一整圈人
    const names = (spec: BodySpec) => buildFigure(spec).parts.map((p) => p.name);
    expect(names(both)).toEqual(names(specOf({ conjoined: 'same' })));
    const preset = applyPreset(specOf({ ring: 'fused', chestRow: 3, counts: { ...d.counts, breasts: 6 } }), PRESETS[0]);
    expect(preset.ring).toBe('none');
    expect(preset.chestRow).toBe(2);
  });

  it('设定：不认识的值回到不围，人数夹在范围里', () => {
    expect(specOf({ ring: 'what' as never }).ring).toBe('none');
    expect(specOf({ ringCount: 99 }).ringCount).toBe(RING_COUNT.max);
    expect(specOf({ ringCount: 1 }).ringCount).toBe(RING_COUNT.min);
    expect(defaultSpec().ring).toBe('none');
    expect(defaultSpec().ringChest).toBe('stagger');
    expect(defaultSpec().ringLegs).toBe('fill');
    expect(specOf({ ringLegs: 'what' as never }).ringLegs).toBe('fill');
    expect(specOf({ ringChest: 'what' as never }).ringChest).toBe('stagger');
  });
});
