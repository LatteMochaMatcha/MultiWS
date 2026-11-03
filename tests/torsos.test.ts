// 好几个上半身（geometry/torsos.ts）：从腰那里分开，左右并排往两边张开；头、手臂、胸、翅膀每个上半身各一份
import { describe, expect, it } from 'vitest';
import { describeClashes, findClashes } from '../src/geometry/clash';
import { animeGrid } from '../src/anime/body';
import { type Figure, type Fork, type Part, worldTransforms } from '../src/geometry/figure';
import { layoutAnime } from '../src/geometry/animeLayout';
import { buildFigure } from '../src/geometry/layout';
import { type V3, add, quatConj, quatEuler, rotate, sub } from '../src/geometry/vec';
import { type BodyCounts, type BodySpec, type PartOverride, LEG_LAYOUTS, defaultSpec } from '../src/model/spec';
import { applyParse, describeSpec, parseDescription } from '../src/parser';
import { buildHandles } from '../src/pose/handles';
import { makeSolver } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { skinVertices } from '../src/rig/skin';
import { bindParts } from '../src/sdf/bindPose';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
import { castRay, compileField, compilePartField, fieldAt } from '../src/sdf/field';
import { forkWarp } from '../src/sdf/fork';
import { getGrid, gridDist } from '../src/sdf/grids';
import { useAnimeBody } from './animeBody';

const make = (counts: Partial<BodyCounts> = {}, rest: Partial<BodySpec> = {}): BodySpec => ({
  ...defaultSpec(),
  ...rest,
  counts: { ...defaultSpec().counts, ...counts },
});
const part = (f: Figure, name: string): Part => {
  const found = f.parts.find((p) => p.name === name);
  if (!found) throw new Error(`没有部件 ${name}`);
  return found;
};
const names = (f: Figure, type: Part['type']) => f.parts.filter((p) => p.type === type).map((p) => p.name).sort();

describe('好几个上半身', () => {
  useAnimeBody();

  describe('每个上半身单独设数量（BodySpec.torsoCounts）', () => {
    /** 这个部件长在哪个上半身上（往上找到 UpperBody…） */
    const bodyOf = (f: Figure, p: Part): string => (p.name.startsWith('UpperBody') ? p.name : p.parent ? bodyOf(f, part(f, p.parent)) : '');
    const tally = (f: Figure, body: string, type: Part['type']) => f.parts.filter((p) => p.type === type && bodyOf(f, p) === body).length;

    it('单独设的和「全部一样」的数一样（或者没设）：和以前一模一样', () => {
      for (const style of ['anime', 'mannequin'] as const) {
        const base = make({ torsos: 2, heads: 2, armPairs: 2 }, { bodyStyle: style, armLayout: 'fan' });
        const same = { ...base, torsoCounts: { L: { heads: 2, armPairs: 2 }, R: { chestPairs: 1 } } };
        expect(buildFigure(same), style).toEqual(buildFigure(base));
        // 上半身减到一个时单独设的不管用
        expect(buildFigure({ ...base, counts: { ...base.counts, torsos: 1 }, torsoCounts: { L: { heads: 3 } } }), style).toEqual(buildFigure({ ...base, counts: { ...base.counts, torsos: 1 } }));
      }
    });

    it('两边不一样多：每个上半身照自己的数量长头、手臂、胸，部件名、骨骼名不重复，融合出来是一整块', () => {
      const cases: [string, BodySpec][] = [
        ['二次元素体 两个', { ...make({ torsos: 2 }, { bodyStyle: 'anime', armLayout: 'fan' }), torsoCounts: { L: { heads: 2, armPairs: 2, chestPairs: 2 } } }],
        ['二次元素体 三个', { ...make({ torsos: 3 }, { bodyStyle: 'anime' }), torsoCounts: { M: { heads: 2 }, L: { armPairs: 2, chestPairs: 0 }, R: { heads: 3 } } }],
        ['白模人台 两个', { ...make({ torsos: 2, armPairs: 2 }, { armLayout: 'stack' }), torsoCounts: { R: { heads: 3, armPairs: 1 } } }],
        ['白模人台 三个', { ...make({ torsos: 3 }), torsoCounts: { M: { heads: 3 }, R: { armPairs: 3 } } }],
      ];
      for (const [label, spec] of cases) {
        const f = buildFigure(spec);
        const sides = spec.counts.torsos === 3 ? (['R', 'M', 'L'] as const) : (['R', 'L'] as const);
        for (const side of sides) {
          const body = side === 'M' ? 'UpperBody' : `UpperBody_${side}`;
          const own = { ...spec.counts, ...spec.torsoCounts?.[side] };
          expect(tally(f, body, 'head'), `${label} ${side} 头`).toBe(own.heads);
          // 里侧挤不下的手臂、胸会去掉（见 crowded）：不比设的多，外侧那一边一个不少
          expect(tally(f, body, 'arm'), `${label} ${side} 手臂`).toBeLessThanOrEqual(own.armPairs * 2);
          expect(tally(f, body, 'arm'), `${label} ${side} 手臂`).toBeGreaterThanOrEqual(own.armPairs);
          expect(tally(f, body, 'chest'), `${label} ${side} 胸`).toBeLessThanOrEqual(own.chestPairs * 2);
          expect(tally(f, body, 'chest'), `${label} ${side} 胸`).toBeGreaterThanOrEqual(own.chestPairs);
        }
        const partNames = f.parts.map((p) => p.name);
        expect(new Set(partNames).size, label).toBe(partNames.length);
        const bones = buildSkeleton(f).bones.map((b) => b.name);
        expect(new Set(bones).size, label).toBe(bones.length);
        const mesh = fuseParts(f.parts.filter((p) => p.material !== 'eye'), { voxel: VOXEL.preview, blend: spec.blend });
        expect(mesh.info.components, label).toBe(1);
      }
    }, 120_000);

    it('二次元素体两个上半身配横排两副胯，两边不一样多：不并成宽躯干，两个上半身各自直立', () => {
      const base = make({ torsos: 2, legs: 4 }, { bodyStyle: 'anime', legLayout: 'abreast' });
      const isWide = (spec: BodySpec) => {
        const grid = part(buildFigure(spec), 'Torso').prims[0];
        return grid.kind === 'grid' && !!grid.twin?.levels;
      };
      expect(isWide(base)).toBe(true);
      expect(isWide({ ...base, torsoCounts: { L: { armPairs: 2 } } })).toBe(false);
      expect(isWide({ ...base, torsoCounts: { L: { armPairs: 1 } } })).toBe(true);
    });
  });

  it('一个上半身时和原来一模一样', () => {
    expect(buildFigure(make({ torsos: 1, heads: 2, armPairs: 2 }))).toEqual(buildFigure(make({ heads: 2, armPairs: 2 })));
  });

  it('二次元素体的胸贴着它挂着的那个上半身的躯干：和上半身的躯干同一个分叉（只是定在胸中心的高度），手动挪过上半身也跟着', () => {
    const cases: Record<string, PartOverride>[] = [{}, { UpperBody_L: { position: [0.03, 0.08, 0], rotation: [0, 12, 8] } }];
    for (const overrides of cases) {
      const f = buildFigure(make({ torsos: 2, heads: 2, armPairs: 2, chestPairs: 2 }, { bodyStyle: 'anime', armLayout: 'fan', overrides }));
      const chests = f.parts.filter((p) => p.type === 'chest');
      expect(chests.length).toBeGreaterThan(0);
      for (const chest of chests) {
        const prim = chest.prims[0];
        const body = part(f, chest.parent!).prims.find((q) => q.kind === 'grid');
        if (prim.kind !== 'chest' || body?.kind !== 'grid') throw new Error(`${chest.name} 不是贴在躯干上的胸`);
        expect(prim.body.fork, chest.name).toEqual({ ...body.fork, freeze: chest.pos[1] });
        expect(prim.body.clipBelow).toBeUndefined();
      }
    }
  });

  it('大胸的胸壁连接不依赖手臂：移除手臂以后，下排胸在精细网格里也不脱开', () => {
    const spec=make({torsos:2,heads:2,armPairs:2,chestPairs:2},{bodyStyle:'anime',armLayout:'stack',shape:{...defaultSpec().shape,bust:2.2}});
    const f=buildFigure(spec);
    const mesh=fuseParts(f.parts.filter(p=>p.type!=='arm'&&p.material!=='eye'),{voxel:0.008,blend:spec.blend});
    expect(mesh.info.components).toBe(1);
  },60_000);

  it('微调上半身的宽高时，腰背接口保持原位，不把连接根部一起缩放', () => {
    const base = make({ torsos: 2, heads: 2, armPairs: 2, chestPairs: 2, legs: 4 }, { bodyStyle: 'anime', armLayout: 'fan', legLayout: 'abreast' });
    const before = buildFigure(base);
    const after = buildFigure({ ...base, overrides: { UpperBody_L: { scale: [1.41, 0.9, 1] }, UpperBody_R: { scale: [1.41, 0.9, 1] } } });
    const [a, b] = [before, after].map((f) => compilePartField(part(f, 'UpperBody_L'), worldTransforms({ ...f, scale: 1 }).get('UpperBody_L')!));
    const grid = part(before, 'UpperBody_L').prims.find((q) => q.kind === 'grid')!;
    if (grid.kind !== 'grid' || !grid.fork) throw new Error('没有分叉');
    const h = grid.clipBelow! + 0.004;
    // 挪的那一段可能在切口以下就挪足了（胯照腿排开、上半身坐在座位上的，见 torsos.ts 的 SEAT）
    const u = Math.min(1, Math.max(0, (h - grid.fork.shiftFrom!) / (grid.fork.shiftTo! - grid.fork.shiftFrom!)));
    const move = u * u * u * (u * (6 * u - 15) + 10);
    for (const x of [0.02, 0.06, 0.09]) {
      const from: V3 = [x + grid.fork.shift[0] * move, h + part(before, 'Torso').pos[1], -0.5];
      const old = castRay(a, from, [0, 0, 1], 0.8), now = castRay(b, from, [0, 0, 1], 0.8);
      expect(old).toBeLessThan(0.6);
      expect(Math.abs(now - old), `${x}`).toBeLessThan(0.0002);
    }
  });

  it('缩放渐变与分叉的正反变换一致，接口及过渡区的范围都包得住', () => {
    const pivot: V3 = [0, 0.96, 0.015], size: V3 = [1.41, 0.9, 1.08];
    const fork: Fork = { pivot, quat: quatEuler(0, 0, -0.3), shift: [0.085, 0.02, 0], from: 1.01, to: 1.24, shiftFrom: 0.92, shiftTo: 1.08, reshape: [size[0],0,0,0,size[1],0,0,0,size[2]] };
    const ramp = (h: number, a: number, b: number) => {
      const t=Math.max(0,Math.min(1,(h-a)/(b-a)));
      return t*t*t*(t*(6*t-15)+10);
    };
    const warp=forkWarp(fork), out=new Float64Array(4), lo: V3=[-0.15,0.94,-0.12], hi: V3=[0.15,1.4,0.13];
    warp.grow(lo,hi);
    for (let i=0;i<=50;i++) {
      const p: V3=[0.1*Math.sin(i),0.95+i*0.008,0.08*Math.cos(i)];
      const s=ramp(p[1],fork.from,fork.to);
      const shaped=p.map((v,k)=>pivot[k]+(v-pivot[k])*(1+s*(size[k]-1))) as V3;
      const turn=ramp(shaped[1],fork.from,fork.to), move=ramp(shaped[1],fork.shiftFrom!,fork.shiftTo!);
      const world=add(add(pivot,rotate(quatEuler(0,0,-0.3*turn),sub(shaped,pivot))),[fork.shift[0]*move,fork.shift[1]*turn,0]);
      const local=add(pivot,rotate(quatConj(fork.quat),sub(world,add(pivot,fork.shift))));
      const input=local.map((v,k)=>pivot[k]+(v-pivot[k])/size[k]) as V3;
      const lip=warp.map(...input,out);
      expect(Number.isFinite(lip)).toBe(true);
      for(let k=0;k<3;k++) {
        expect(out[k], `${i} ${k}`).toBeCloseTo(p[k],6);
        expect(input[k]).toBeGreaterThanOrEqual(lo[k]);
        expect(input[k]).toBeLessThanOrEqual(hi[k]);
      }
    }
  });

  it('胸部跳过分叉变形后，小胸、大胸和多排胸仍连在两三个上半身上，网格封闭', () => {
    for (const torsos of [2, 3]) for (const bust of [1, 2.2]) for (const chestPairs of [1, 3]) {
      const spec = make({ torsos, heads: 2, armPairs: 2, chestPairs }, {
        bodyStyle: 'anime', armLayout: 'fan', shape: { ...defaultSpec().shape, bust },
      });
      const mesh = fuseParts(buildFigure(spec).parts, { voxel: VOXEL.preview, blend: spec.blend });
      const label = `${torsos} 身 ${bust} 胸 ${chestPairs} 排`;
      expect(mesh.info.components, label).toBe(1);
      // cavities 记录的是清理时已删除的内壁数；这里验证最终网格，每条边必须由两个反向面共用。
      const n = mesh.positions.length / 3;
      const edges = new Map<number, number>();
      for (let i = 0; i < mesh.triangles.length; i += 3) for (let j = 0; j < 3; j++) {
        const a = mesh.triangles[i + j], b = mesh.triangles[i + (j + 1) % 3];
        edges.set(a * n + b, (edges.get(a * n + b) ?? 0) + 1);
      }
      let invalid = 0;
      for (const [key, count] of edges) {
        const a = Math.floor(key / n), b = key % n;
        if (count !== 1 || edges.get(b * n + a) !== 1) invalid++;
      }
      expect(invalid, label).toBe(0);
    }
  }, 60_000);

  it('二次元素体两个上半身（每个一个头）、横排两副胯：并成一个宽躯干（胸按一个人算摆在正中），切成两个上半身各带脊柱，网格一整块', () => {
    const counts = { armPairs: 2, chestPairs: 2, legs: 4 };
    const rest = { bodyStyle: 'anime', armLayout: 'fan', legLayout: 'abreast' } as const;
    const spec = make({ ...counts, torsos: 2, heads: 1 }, rest);
    const f = buildFigure(spec);
    // 照「一个上半身两个头」并成宽躯干摆的那一个（切开之前）；真的一个上半身两个头（D）不并
    const d = layoutAnime(make({ ...counts, torsos: 1, heads: 2 }, rest), true);
    const torso = part(f, 'Torso');
    const pelvis = torso.prims[0];
    if (pelvis.kind !== 'grid' || !pelvis.twin?.levels) throw new Error('不是并成一个宽躯干');
    expect(torso.bones?.map((b) => b.name)).toEqual(['Hips']);
    expect(torso.prims.filter((p) => p.name.startsWith('Cleft_')).length).toBe(2);
    for (const [name, side] of [
      ['UpperBody_L', 1],
      ['UpperBody_R', -1],
    ] as const) {
      const body = part(f, name);
      expect(body.parent).toBe('Torso');
      expect(body.bones?.map((b) => b.name)).toEqual(['Spine', 'Chest', 'Chest.002', 'UpperChest'].map((b) => b.replace(/^(\w+)/, `$1${name.slice(-2)}`)));
      // 脊柱在自己那一份的正中
      expect(body.bones![0].head[0]).toBeCloseTo(side * pelvis.twin.d, 3);
      const grid = body.prims[0];
      if (grid.kind !== 'grid') throw new Error('上半身不是格子');
      // 切口在正中线上，越过一点（两半叠着，正中没有一道缝）
      expect(grid.clipX).toBeLessThan(0);
      expect(grid.clipX).toBeGreaterThan(-0.01);
      expect(!!grid.mirror).toBe(side < 0);
    }
    // 头、手臂、胸按在哪一边分给两个上半身；胸按一个人算（两排各一对），贴在宽躯干外面
    const owner = (p: Part): string => (!p.parent || p.parent.startsWith('UpperBody') || p.parent === 'Torso' ? p.parent ?? '' : owner(part(f, p.parent)));
    expect(owner(part(f, 'Head_01'))).toBe('UpperBody_R');
    expect(owner(part(f, 'Head_02'))).toBe('UpperBody_L');
    expect(names(f, 'chest')).toEqual(['Chest_01_L', 'Chest_01_R', 'Chest_02_L', 'Chest_02_R']);
    for (const c of f.parts.filter((p) => p.type === 'chest')) {
      expect(c.parent, c.name).toBe(c.side > 0 ? 'UpperBody_L' : 'UpperBody_R');
      expect((c.prims[0] as { wide?: boolean }).wide, c.name).toBe(true);
    }
    expect(names(f, 'arm')).toEqual(names(d, 'arm'));
    // 网格和切开之前差不多一模一样，一整块
    const mesh = fuseParts(f.parts, { voxel: VOXEL.preview, blend: spec.blend });
    const twin = fuseParts(d.parts, { voxel: VOXEL.preview, blend: spec.blend });
    expect(mesh.info.components).toBe(1);
    expect(Math.abs(mesh.positions.length - twin.positions.length) / twin.positions.length).toBeLessThan(0.02);
  }, 60_000);

  it('两个上半身挤在一起的胸各跟各的上半身（摆姿势时不被另一个扯成长条）；躯干上两个上半身连着的那一圈照常过渡', () => {
    const spec = make({ torsos: 2, heads: 1, legs: 4 }, { bodyStyle: 'anime', legLayout: 'abreast', shape: { ...defaultSpec().shape, bust: 2.2 } });
    const figure = { parts: buildFigure(spec).parts, scale: 1 };
    const mesh = fuseParts(figure.parts, { voxel: VOXEL.preview, blend: spec.blend });
    const skeleton = buildSkeleton(figure);
    const skin = skinVertices(figure, skeleton, mesh.positions, mesh.triangles);
    // 每根骨骼接在哪个上半身的脊柱上（1：左边那个，-1：右边那个，0：都不是）
    const body = skeleton.bones.map((_, i) => {
      for (let b = i; b >= 0; b = skeleton.bones[b].parent) {
        if (skeleton.bones[b].name === 'Spine_L') return 1;
        if (skeleton.bones[b].name === 'Spine_R') return -1;
      }
      return 0;
    });
    // 离躯干表面多远（胸上的顶点离得远，躯干上的贴着）
    const flat = compileField({ ...figure, parts: figure.parts.filter((p) => p.type === 'torso') }, { blend: 0 });
    const chest = figure.parts.find((p) => p.name === 'Chest_01_L')!;
    const y0 = part(buildFigure(spec), 'Torso').pos[1] + chest.pos[1];
    let onChest = 0;
    let mixedChest = 0;
    let mixedTorso = 0;
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const [x, y, z] = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
      if (Math.abs(x) > 0.06 || Math.abs(y - y0) > 0.1) continue;
      let l = 0;
      let r = 0;
      for (let k = 0; k < 4; k++) {
        const s = body[skin.joints[v * 4 + k]];
        if (s > 0) l += skin.weights[v * 4 + k];
        else if (s < 0) r += skin.weights[v * 4 + k];
      }
      const off = fieldAt(flat, x, y, z);
      if (off > 0.03) {
        onChest++;
        if (Math.min(l, r) > 0.01) mixedChest++;
      } else if (Math.abs(off) < 0.004 && z < 0 && Math.min(l, r) > 0.2) mixedTorso++;
    }
    expect(onChest).toBeGreaterThan(50);
    expect(mixedChest).toBe(0);
    expect(mixedTorso).toBeGreaterThan(5);
  }, 60_000);

  it('两个：胯那一截还叫 Torso（带着 Hips、屁股），上面两份 UpperBody_L / _R 往两边歪开，各有脊柱、头、手臂、胸', () => {
    const f = buildFigure(make({ torsos: 2 }));
    const torso = part(f, 'Torso');
    expect(torso.bones?.map((b) => b.name)).toEqual(['Hips']);
    expect(torso.prims.some((p) => p.name === 'Cleft')).toBe(true);
    for (const [name, side] of [
      ['UpperBody_L', 1],
      ['UpperBody_R', -1],
    ] as const) {
      const body = part(f, name);
      expect(body.parent).toBe('Torso');
      expect(body.bones?.map((b) => b.name)).toEqual(['Spine', 'Chest', 'UpperChest'].map((b) => `${b}${name.slice(-2)}`));
      expect(body.bones?.[0].parent).toBe('Hips');
      // 往自己那一边歪：头顶比腰往外
      const up = worldTransforms(f).get(name)!;
      const tilt = up.quat;
      const top = [2 * (tilt[0] * tilt[1] - tilt[3] * tilt[2]), 0, 0][0];
      expect(Math.sign(top)).toBe(side);
    }
    expect(names(f, 'head')).toEqual(['Head_01', 'Head_02']);
    // 手臂：外侧的照平常起名（两个上半身的外侧手臂互为镜像），里侧的排在后面一对
    expect(part(f, 'Arm_01_L').parent).toBe('UpperBody_L');
    expect(part(f, 'Arm_01_R').parent).toBe('UpperBody_R');
    expect(part(f, 'Arm_02_R').parent).toBe('UpperBody_L');
    expect(part(f, 'Arm_02_L').parent).toBe('UpperBody_R');
    expect(names(f, 'chest')).toEqual(['Chest_01_L', 'Chest_01_R', 'Chest_02_L', 'Chest_02_R']);
    // 腿还是那两条；胯宽了一成（好几个上半身站在一副宽胯上），腿根跟着往外挪了一点，高低前后不变
    const one = buildFigure(make());
    const [leg, solo] = [part(f, 'Leg_01_L'), part(one, 'Leg_01_L')];
    expect(leg.prims.length).toBe(solo.prims.length);
    expect(leg.pos[0]).toBeGreaterThan(solo.pos[0]);
    expect(leg.pos[0]).toBeLessThan(solo.pos[0] * 1.15);
    expect(leg.pos[1]).toBeCloseTo(solo.pos[1], 9);
    expect(leg.pos[2]).toBeCloseTo(solo.pos[2], 9);
    // 身高量的是歪过去以后的头顶：比一个上半身时矮一点
    expect(f.metrics.height).toBeLessThan(one.metrics.height);
    expect(f.metrics.height).toBeGreaterThan(one.metrics.height * 0.9);
  });

  it('里侧的手臂往前伸（两个上半身中间垂不下去），外侧的照平常垂着', () => {
    const f = buildFigure(make({ torsos: 2 }));
    const world = worldTransforms(f);
    const reach = (name: string) => {
      const arm = part(f, name);
      const bone = arm.bones!.find((b) => b.name.startsWith('UpperArm'))!;
      const xf = world.get(name)!;
      const dir = [bone.tail[0] - bone.head[0], bone.tail[1] - bone.head[1], bone.tail[2] - bone.head[2]];
      const q = xf.quat;
      // 只要方向：把骨骼的方向转到世界里
      const rot = (v: number[]) => {
        const [x, y, z, w] = q;
        const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
        return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])];
      };
      return rot(dir);
    };
    // 里侧：往前（+Z）伸，左右基本不偏（不往正中凑）
    for (const name of ['Arm_02_R', 'Arm_02_L']) {
      const d = reach(name);
      expect(d[2], name).toBeGreaterThan(Math.abs(d[0]) * 3);
    }
    // 外侧：往外垂
    expect(reach('Arm_01_L')[0]).toBeGreaterThan(0);
    expect(reach('Arm_01_R')[0]).toBeLessThan(0);
  });

  it('三个：正中一个，两边各一个；头照从右往左一个上半身一个上半身地数', () => {
    const f = buildFigure(make({ torsos: 3, heads: 2 }));
    expect(['UpperBody', 'UpperBody_L', 'UpperBody_R'].every((name) => part(f, name).parent === 'Torso')).toBe(true);
    expect(part(f, 'UpperBody').bones?.map((b) => b.name)).toEqual(['Spine', 'Chest', 'UpperChest']);
    expect(names(f, 'head')).toHaveLength(6);
    const x = (name: string) => worldTransforms(f).get(name)!.pos[0];
    const heads = names(f, 'head').sort();
    for (let i = 1; i < heads.length; i++) expect(x(heads[i]), heads[i]).toBeGreaterThan(x(heads[i - 1]));
    // 正中那个两边都挨着别的上半身：两条手臂都往前伸，名字是第 1 对
    expect(part(f, 'Arm_01_L').parent).toBe('UpperBody');
  });

  it('骨架：名字不重复，只有一根根骨骼；摆姿势时每个上半身有自己的腰和胸', () => {
    for (const torsos of [2, 3]) {
      const s = buildSkeleton(buildFigure(make({ torsos, armPairs: 2, wingPairs: 1 }, { armLayout: 'fan' })));
      const all = s.bones.map((b) => b.name);
      expect(new Set(all).size).toBe(all.length);
      expect(s.bones.filter((b) => b.parent < 0).map((b) => b.name)).toEqual(['Hips']);
      const handles = buildHandles(makeSolver(s.bones));
      const labels = handles.filter((h) => h.group === 'torso').map((h) => h.label);
      expect(labels).toContain('腰 左');
      expect(labels).toContain('胸 右');
      if (torsos === 3) expect(labels).toContain('胸');
      expect(new Set(handles.map((h) => h.id)).size).toBe(handles.length);
    }
  });

  it('两种白模都融合成一整块封闭网格', () => {
    for (const bodyStyle of ['mannequin', 'anime'] as const) {
      for (const torsos of [2, 3]) {
        for (const extra of [{}, { heads: 2, armPairs: 2 }, { wingPairs: 1, tails: 1, legs: 4 }]) {
          const spec = make({ torsos, ...extra }, { bodyStyle, armLayout: 'fan', legLayout: 'humantaur' });
          const mesh = fuseParts(buildFigure(spec).parts, { voxel: VOXEL.preview, blend: spec.blend });
          expect(mesh.info.components, `${bodyStyle} ${torsos} ${JSON.stringify(extra)}`).toBe(1);
        }
      }
    }
  });

  it('二次元素体三个上半身直立并排、分得开：不扇开，两边的只往外歪一点，三个腰之间空出一道缝；里侧的手臂往前伸、不举过头', () => {
    for (const legs of [2, 4]) {
      const spec = make({ torsos: 3, legs, armPairs: 2, heads: 2, chestPairs: 2 }, { bodyStyle: 'anime', legLayout: legs > 2 ? 'abreast' : 'auto' });
      const f = buildFigure(spec);
      const xfs = worldTransforms(f);
      const bodies = ['UpperBody_R', 'UpperBody', 'UpperBody_L'].map((n) => part(f, n));
      // 正中那个不转不挪；两边的不绕竖轴转（不扇开），往外歪不到 20°
      expect(bodies[1].quat.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 0, 0, 1]);
      for (const b of [bodies[0], bodies[2]]) {
        const up = rotate(b.quat, [0, 1, 0]);
        const front = rotate(b.quat, [0, 0, 1]);
        expect(Math.abs(front[0]), `${legs} ${b.name}`).toBeLessThan(1e-6);
        expect((Math.acos(up[1]) * 180) / Math.PI, `${legs} ${b.name}`).toBeLessThan(20);
      }
      // 腰那么高、正中那个和旁边的之间是空的
      const field = compileField({ scale: 1, parts: f.parts }, { blend: spec.blend });
      const torso = part(f, 'Torso');
      const waistY = torso.pos[1] + torso.bones!.find((b) => b.name === 'Hips')!.head[1] + 0.14;
      // 只数正中那个上半身的脊柱和旁边那个的脊柱之间（照各自的 Spine 骨骼起点）
      const spineX = (name: string, bone: string) => {
        const b = part(f, name);
        return add(xfs.get(name)!.pos, rotate(xfs.get(name)!.quat, b.bones!.find((x) => x.name === bone)!.head))[0];
      };
      for (const [name, bone] of [['UpperBody_L', 'Spine_L'], ['UpperBody_R', 'Spine_R']] as const) {
        const to = spineX(name, bone);
        let empty = 0;
        for (let x = 0.03; x < Math.abs(to) - 0.03; x += 0.003) if (fieldAt(field, Math.sign(to) * x, waistY, torso.pos[2]) > 0) empty++;
        expect(empty, `${legs} ${name}`).toBeGreaterThan(0);
      }
      // 手不举过头：每只手都比这个上半身最低的那个头的下巴低
      for (const arm of f.parts.filter((p) => p.type === 'arm')) {
        const hand = xfs.get(arm.name)!;
        const tip = add(hand.pos, rotate(hand.quat, sub(arm.bones!.find((b) => b.name.startsWith('Hand'))!.tail, [0, 0, 0])));
        const heads = f.parts.filter((p) => p.type === 'head').map((p) => xfs.get(p.name)!.pos[1]);
        expect(tip[1], arm.name).toBeLessThan(Math.min(...heads));
      }
    }
  });

  it('从胯上像树杈一样分出去：上半身在髋关节（屁股缝的顶上）以下和胯是同一张皮，往上渐渐转开、挪开；二次元素体（直立并排）胯的上半截加宽', () => {
    for (const bodyStyle of ['mannequin', 'anime'] as const) {
      for (const torsos of [2, 3]) {
        const f = buildFigure(make({ torsos }, { bodyStyle }));
        const pelvis = part(f, 'Torso');
        const shape = pelvis.prims.find((p) => p.kind === 'grid' || p.kind === 'loft')!;
        const copy = f.parts.find((p) => p.parent === 'Torso' && p.type === 'torso')!;
        const own = (copy.prims[0] as { fork?: Fork }).fork!;
        if (bodyStyle === 'anime') {
          // 二次元素体直立并排，从胯上就分开：胯的上半截跟着往两边加宽，加宽的那一段就是上半身往外挪的那一段
          const bands = (shape as { widenX?: [number, number, number, number][] }).widenX!;
          expect(bands.at(-1)!.slice(1, 3)).toEqual([own.shiftFrom, own.shiftTo]);
          expect(own.shiftTo!).toBeLessThan(own.to - 0.05);
        } else {
          expect(shape, `${bodyStyle} ${torsos}`).not.toHaveProperty('widenX');
        }
        // 屁股缝还挖在胯上（摆姿势时跟着胯走），上半身插下来的那一截不碰它
        const cleft = pelvis.prims.find((p) => p.name === 'Cleft');
        expect(cleft?.kind, bodyStyle).toBe('ellipsoid');
        for (const copy of f.parts.filter((p) => p.parent === 'Torso' && p.type === 'torso')) {
          const fork = (copy.prims[0] as { fork?: Fork }).fork!;
          expect(fork, copy.name).toBeDefined();
          expect(fork.from).toBeLessThan(fork.to);
          if (cleft?.kind === 'ellipsoid') expect(fork.from - 0.01, copy.name).toBeGreaterThan(cleft.center[1]);
          const chests = f.parts.filter((p) => p.parent === copy.name && p.type === 'chest');
          expect(copy.fuseAs).toBeUndefined();
          if (bodyStyle === 'anime') {
            // 二次元素体：挪比转先开始，在胯上面一小段里挪足（两个、三个都是）；转一直渐渐加到腋下（手臂根下面）
            expect(fork.shiftFrom!, copy.name).toBeLessThan(fork.from);
            expect(fork.shiftTo!, copy.name).toBeLessThan(fork.to - 0.05);
            for (const arm of f.parts.filter((p) => p.parent === copy.name && p.type === 'arm')) expect(fork.to, arm.name).toBeLessThan(arm.pos[1] - 0.05);
            for (const chest of chests) {
              // 胸只跟着所属上半身整体搬动，保留胸型，不套躯干的非线性分叉。
              expect(chest.prims[0], chest.name).not.toHaveProperty('fork');
            }
          } else {
            // 拼的胸（椭球）分不了：分足的地方在这个上半身最下面那排胸的下面
            for (const chest of chests) expect(fork.to, chest.name).toBeLessThan(chest.pos[1]);
            expect(fork.shiftFrom, copy.name).toBeUndefined();
          }
        }
      }
    }
  });

  it('手动把一个上半身挪高、转开：分出去的那一段跟着改，腰被拉长、拧过去，还和胯连着（不是断开悬在上面）', () => {
    for (const bodyStyle of ['mannequin', 'anime'] as const) {
      const base = make({ torsos: 2 }, { bodyStyle });
      const moved = buildFigure({ ...base, overrides: { UpperBody_L: { position: [0, 0.2, 0], rotation: [0, 0, 15] } } });
      const copy = part(moved, 'UpperBody_L');
      const fork = (copy.prims[0] as { fork?: Fork }).fork!;
      // 分足的样子就是挪过、转过以后的摆放（绕同一个 pivot 换算）
      fork.quat.forEach((v, k) => expect(v, bodyStyle).toBeCloseTo(copy.quat[k], 9));
      const at = add(fork.shift, sub(fork.pivot, rotate(copy.quat, fork.pivot)));
      at.forEach((v, k) => expect(v, bodyStyle).toBeCloseTo(copy.pos[k], 9));
      // 旁边那个照它挪过以后的样子分界（两个上半身时没有分界，三个时有）
      const mesh = fuseParts(moved.parts, { voxel: VOXEL.preview, blend: base.blend });
      expect(mesh.info.components, bodyStyle).toBe(1);
    }
    const three = buildFigure({ ...make({ torsos: 3 }), overrides: { UpperBody_L: { position: [0, 0.1, 0] } } });
    const middle = (part(three, 'UpperBody').prims[0] as { fork?: Fork }).fork!;
    const left = middle.split!.find((s) => s.part === 'UpperBody_L')!;
    const leftNow = (part(three, 'UpperBody_L').prims[0] as { fork?: Fork }).fork!;
    expect(left.shift).toEqual(leftNow.shift);
  });

  it('分开的那一段：from 以下和原样一模一样，to 以上就是部件整个转、挪过的样子，中间是连着的（腰两侧没有台阶、没有一圈鼓包）', () => {
    const grid = getGrid(animeGrid('torso'));
    const plain = gridDist(grid);
    const turn = quatEuler(0, 0, -0.35);
    const fork: Fork = { pivot: [0, 0.96, 0.015], quat: turn, shift: [0.06, 0, 0], from: 0.98, to: 1.11 };
    const forked = gridDist(grid, { fork });
    // 部件坐标里的一点 ↔ 胯的坐标里的一点（部件整个转了 turn、挪了 shift，绕 pivot）
    const toLocal = (w: [number, number, number]) => add(rotate(quatConj(turn), sub(sub(w, fork.shift), fork.pivot)), fork.pivot);
    for (const w of [[0.1, 0.9, 0], [-0.08, 0.95, 0.05], [0.05, 0.97, -0.08]] as [number, number, number][]) {
      expect(forked.fn(...toLocal(w)), `${w}`).toBeCloseTo(plain.fn(...w), 6);
    }
    for (const p of [[0.05, 1.2, 0], [-0.1, 1.15, 0.03]] as [number, number, number][]) expect(forked.fn(...p)).toBeCloseTo(plain.fn(...p), 6);
    // 外侧的轮廓（胯的坐标里，z = 0）随高度连续变化：每升高 5 毫米最多往外挪 1.5 厘米（斜着张出去），不会忽进忽出
    const edge = (y: number) => {
      let x = 0.45;
      while (x > -0.2 && forked.fn(...toLocal([x, y, 0])) > 0) x -= 0.0005;
      return x;
    };
    let last = edge(0.97);
    for (let y = 0.975; y <= 1.12; y += 0.005) {
      const x = edge(y);
      expect(Math.abs(x - last), `y=${y.toFixed(3)}`).toBeLessThan(0.015);
      last = x;
    }
  });

  it('二次元素体两个上半身直立并排：胯顶往上两个肚子挤在一起，正中一道浅沟（不是一直凹到侧面），胯里还是一整块，外侧在接口处不起台阶', () => {
    useAnimeBody();
    for (const shape of [{}, { waist: 1.16, hips: 1.28 }]) {
      const spec = make({ torsos: 2 }, { bodyStyle: 'anime', shape: { ...defaultSpec().shape, ...shape } });
      const f = buildFigure(spec);
      // 不算手臂（垂在两边、伸在身前，会挡住）
      const kept = new Set<string>();
      const parts = f.parts.filter((p) => {
        const keep = p.type !== 'arm' && p.material !== 'eye' && (!p.parent || kept.has(p.parent));
        if (keep) kept.add(p.name);
        return keep;
      });
      const field = compileField({ scale: 1, parts }, { blend: spec.blend });
      const fork = (part(f, 'UpperBody_L').prims[0] as { fork?: Fork }).fork!;
      const lift = part(f, 'Torso').pos[1];
      // 胯顶（胯只留到这里）
      const split = (part(f, 'Torso').prims[0] as { clipAbove?: number }).clipAbove!;
      const s = fork.shift[0];
      const label = JSON.stringify(shape);
      /** 高度 y（躯干的坐标）上，离中线 x 处身体前面在哪 */
      const front = (x: number, y: number) => 1 - castRay(field, [x, y + lift, 1], [0, 0, -1], 1);
      /** 高度 y 上，左边那个上半身外侧的表面在哪 */
      const outer = (y: number) => 1 - castRay(field, [1, y + lift, 0.01], [-1, 0, 0], 1);
      // 胯顶往上：正中比两个肚子凹进去一点（两个身子），但不到 4 厘米（正好挨着的话一直凹到侧面中间，十来厘米）
      const waist = split + 0.09;
      expect(front(0, waist), label).toBeLessThan(front(s, waist) - 0.005);
      expect(front(0, waist), label).toBeGreaterThan(front(s, waist) - 0.04);
      // 胯里：正中不凹
      expect(front(0, split - 0.04), label).toBeGreaterThan(front(s, split - 0.04) - 0.006);
      // 外侧：接口上下各几毫米没有一下子跳出去
      for (let y = split - 0.03; y < split + 0.03; y += 0.0025) expect(Math.abs(outer(y + 0.0025) - outer(y)), `${label} ${y}`).toBeLessThan(0.004);
    }
  });

  it('二次元素体两个上半身直立并排：只歪开一点（给里侧手臂留地方）；里侧的胸、手臂都留着，里侧手臂往前伸、往自己那边偏，两边的根隔开', () => {
    for (const shape of [{}, { bust: 2.2, waist: 1.16, hips: 1.28 }]) {
      const f = buildFigure(make({ torsos: 2 }, { bodyStyle: 'anime', shape: { ...defaultSpec().shape, ...shape } }));
      const world = worldTransforms(f);
      const label = JSON.stringify(shape);
      for (const name of ['UpperBody_L', 'UpperBody_R']) {
        const q = world.get(name)!.quat;
        const lean = 2 * Math.asin(Math.hypot(q[0], q[1], q[2]));
        expect(lean, `${label} ${name}`).toBeGreaterThan((10 * Math.PI) / 180);
        expect(lean, `${label} ${name}`).toBeLessThan((15 * Math.PI) / 180);
      }
      expect(names(f, 'chest'), label).toEqual(['Chest_01_L', 'Chest_01_R', 'Chest_02_L', 'Chest_02_R']);
      /** 上臂在世界里朝哪 */
      const reach = (name: string): V3 => {
        const bone = part(f, name).bones!.find((b) => b.name.startsWith('UpperArm'))!;
        return rotate(world.get(name)!.quat, sub(bone.tail, bone.head));
      };
      // 里侧的：左边那个上半身的是 Arm_02_R，右边的是 Arm_02_L；肩关节在自己这边，往前伸，往自己那边偏一点
      for (const [name, side] of [
        ['Arm_02_R', 1],
        ['Arm_02_L', -1],
      ] as const) {
        expect(part(f, name).parent, name).toBe(side > 0 ? 'UpperBody_L' : 'UpperBody_R');
        expect(Math.sign(world.get(name)!.pos[0]), `${label} ${name}`).toBe(side);
        const d = reach(name);
        expect(d[2], `${label} ${name}`).toBeGreaterThan(Math.abs(d[0]) * 2);
        expect(Math.sign(d[0]), `${label} ${name}`).toBe(side);
      }
      expect(world.get('Arm_02_R')!.pos[0] - world.get('Arm_02_L')!.pos[0], label).toBeGreaterThan(0.09);
    }
    // 两个头的：歪到头分开，不穿模
    const two = buildFigure(make({ torsos: 2, heads: 2, armPairs: 2, chestPairs: 2 }, { bodyStyle: 'anime', armLayout: 'fan' }));
    expect(describeClashes(findClashes(two))).toBe('');
  });

  it('二次元素体两个上半身的胸：贴着的躯干照胸中心那个高度整块转（不被扭扁）；里侧的胸在两个身子正中间切齐，外侧的不切', () => {
    const f = buildFigure(make({ torsos: 2 }, { bodyStyle: 'anime', shape: { ...defaultSpec().shape, bust: 2.2 } }));
    for (const p of f.parts.filter((q) => q.type === 'chest')) {
      const shape = p.prims[0] as Extract<Part['prims'][number], { kind: 'chest' }>;
      expect(shape.body.fork?.freeze, p.name).toBeCloseTo(p.pos[1], 9);
      const up = part(f, p.parent!);
      const inner = p.side === -up.side;
      expect(!!shape.seam, p.name).toBe(inner);
      if (!shape.seam) continue;
      // 切面就是胯上的正中线：上半身坐标里切面上的点换到胯的坐标里 x 是 0（两个上半身左右对称）
      const [nx, ny, nz, d] = shape.seam;
      for (const along of [-0.1, 0, 0.1]) {
        const onPlane: V3 = [nx * d + along * ny, ny * d - along * nx, nz * d + 0.05];
        expect(Math.abs(add(up.pos, rotate(up.quat, onPlane))[0]), p.name).toBeLessThan(1e-9);
      }
    }
  });

  it('胸跟着躯干一起分：在胸自己的坐标里分，和换到上半身的坐标里分是一回事', () => {
    const fork: Fork = { pivot: [0, 0.96, 0.015], quat: quatEuler(0, 0, -0.3), shift: [0.08, -0.01, 0], from: 1.0, to: 1.2, shiftFrom: 0.98, shiftTo: 1.2 };
    const frame = { pos: [0.05, 1.17, 0.07] as V3, quat: quatEuler(0.1, 0.2, 0), scale: 1.7 };
    const bare = forkWarp(fork);
    const framed = forkWarp({ ...fork, frame });
    const up = (p: V3): V3 => add(frame.pos, rotate(frame.quat, [p[0] * frame.scale, p[1] * frame.scale, p[2] * frame.scale]));
    const a = new Float64Array(4);
    const b = new Float64Array(4);
    let inside = 0;
    for (const p of [[0, -0.04, 0], [0.03, -0.02, 0.02], [-0.04, 0.01, -0.01], [0.01, -0.08, 0.03], [0, 0.06, 0]] as V3[]) {
      const lipBare = bare.map(...up(p), a);
      const lipFramed = framed.map(...p, b);
      if (lipBare > 1) inside++;
      up([b[0], b[1], b[2]]).forEach((v, k) => expect(v, `${p}`).toBeCloseTo(a[k], 9));
      expect(lipFramed, `${p}`).toBeCloseTo(lipBare, 9);
    }
    expect(inside).toBeGreaterThan(1);
  });

  it('不穿模：两三个上半身 × 头 1–5 × 手臂 0–4 对 × 胸 0–4 对 × 上下排 / 肩部聚拢 × A / T', () => {
    for (const torsos of [2, 3])
      for (const heads of [1, 3, 5])
        for (const armPairs of [0, 1, 2, 3, 4])
          for (const chestPairs of [0, 2, 4])
            for (const armLayout of ['stack', 'fan'] as const)
              for (const pose of ['A', 'T'] as const) {
                if (armLayout === 'fan' && armPairs < 2) continue;
                const spec = make({ torsos, heads, armPairs, chestPairs }, { armLayout, pose });
                expect(describeClashes(findClashes(buildFigure(spec))), JSON.stringify({ torsos, heads, armPairs, chestPairs, armLayout, pose })).toBe('');
              }
  }, 120_000);

  it('不穿模：各种腿的排法（四条腿以内）、翅膀、尾巴、男女', () => {
    for (const torsos of [2, 3])
      for (const legLayout of LEG_LAYOUTS)
        for (const legs of [1, 2, 3, 4])
          for (const gender of ['female', 'male'] as const) {
            const spec = make({ torsos, legs, armPairs: 2, wingPairs: 1, tails: 2 }, { legLayout, gender });
            expect(describeClashes(findClashes(buildFigure(spec))), JSON.stringify({ torsos, legLayout, legs, gender })).toBe('');
          }
  }, 120_000);

  it('挨着旁边那个上半身、长不下的里侧胸不长；最上面一排留着', () => {
    const f = buildFigure(make({ torsos: 3, chestPairs: 4 }));
    // 外侧的四排都在
    expect(f.parts.filter((p) => p.type === 'chest' && p.parent === 'UpperBody_L' && p.side === 1)).toHaveLength(4);
    const inner = f.parts.filter((p) => p.type === 'chest' && p.parent === 'UpperBody_L' && p.side === -1);
    expect(inner.length).toBeGreaterThan(0);
    expect(inner.length).toBeLessThan(4);
  });

  it('算权重时另摆的姿势里，两个上半身里侧的手臂也不碰在一起（碰了会融成一块，摆姿势时一条被另一个身子拽成长条）', () => {
    type P = [number, number, number];
    const gap = (a: P, b: P, c: P, d: P) => {
      let best = Infinity;
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const p: P = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        const cd: P = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
        const s = Math.max(0, Math.min(1, ((p[0] - c[0]) * cd[0] + (p[1] - c[1]) * cd[1] + (p[2] - c[2]) * cd[2]) / (cd[0] ** 2 + cd[1] ** 2 + cd[2] ** 2 || 1)));
        best = Math.min(best, Math.hypot(p[0] - c[0] - cd[0] * s, p[1] - c[1] - cd[1] * s, p[2] - c[2] - cd[2] * s));
      }
      return best;
    };
    for (const bodyStyle of ['mannequin', 'anime'] as const) {
      for (const armPairs of [1, 2]) {
        for (const armLayout of ['stack', 'fan'] as const) {
          if (armLayout === 'fan' && armPairs < 2) continue;
          const f = buildFigure(make({ torsos: 2, armPairs, chestPairs: 2 }, { bodyStyle, armLayout }));
          const s = buildSkeleton({ ...f, parts: bindParts(f.parts) });
          const at = (n: string) => s.bones.find((b) => b.name === n);
          const chain = (side: string, k: number): P[] => {
            const names = ['UpperArm', 'LowerArm', 'Hand'].map((b) => `${b}_${side}.00${k}`);
            return [...names.map((n) => at(n)!.head as P), at(names[2])!.tail as P];
          };
          for (let k = armPairs + 1; k <= 2 * armPairs; k++) {
            if (!at(`UpperArm_R.00${k}`) || !at(`UpperArm_L.00${k}`)) continue;
            const a = chain('R', k);
            const b = chain('L', k);
            let best = Infinity;
            for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) best = Math.min(best, gap(a[i], a[i + 1], b[j], b[j + 1]));
            expect(best, `${bodyStyle} ${armPairs} ${armLayout} 第 ${k} 对`).toBeGreaterThan(0.09);
          }
        }
      }
    }
  });

  it('文字：「两个上半身」「三个上半身」「革律翁」「two torsos」；规范描述往返一致', () => {
    expect(parseDescription('两个上半身，四条腿').counts.torsos).toBe(2);
    expect(parseDescription('双上半身').counts.torsos).toBe(2);
    expect(parseDescription('三个上身').counts.torsos).toBe(3);
    expect(parseDescription('革律翁').counts.torsos).toBe(3);
    expect(parseDescription('two torsos, 2 heads').counts.torsos).toBe(2);
    expect(parseDescription('上身穿着衬衫').counts.torsos).toBe(1);
    const spec = make({ torsos: 3, heads: 2 });
    const text = describeSpec(spec);
    expect(text.startsWith('三个上半身')).toBe(true);
    expect(applyParse(defaultSpec(), parseDescription(text)).counts).toEqual(spec.counts);
  });
});
