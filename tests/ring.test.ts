// 围成一圈（src/geometry/ring.ts）：几个人背靠背站成一圈，融合成一个身子
import { describe, expect, it } from 'vitest';
import { worldTransforms } from '../src/geometry/figure';
import { rotate, sub } from '../src/geometry/vec';
import { RING_PERSON_LEGS, buildFigure } from '../src/geometry/layout';
import { PRESETS, applyPreset } from '../src/model/presets';
import { type BodySpec, RING_COUNT, RING_SPREAD, defaultSpec, normalizeSpec, ringActive } from '../src/model/spec';
import { writeGlb } from '../src/io/glb';
import { humanoidMap, writeVrm } from '../src/io/vrm';
import { ringHumanoid } from '../src/io/vrmRig';
import { fitArms, followArms } from '../src/pose/fit';
import { POSE_LIBRARY } from '../src/pose/library';
import { buildHandles } from '../src/pose/handles';
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
    expect(RING_SPREAD.min).toBe(0.5);
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
    const tight = measure(RING_SPREAD.min);
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
