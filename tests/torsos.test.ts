// 好几个上半身（geometry/torsos.ts）：从腰那里分开，左右并排往两边张开；头、手臂、胸、翅膀每个上半身各一份
import { describe, expect, it } from 'vitest';
import { describeClashes, findClashes } from '../src/geometry/clash';
import { animeGrid } from '../src/anime/body';
import { type Figure, type Fork, type Part, worldTransforms } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type V3, add, quatConj, quatEuler, rotate, sub } from '../src/geometry/vec';
import { type BodyCounts, type BodySpec, LEG_LAYOUTS, defaultSpec } from '../src/model/spec';
import { applyParse, describeSpec, parseDescription } from '../src/parser';
import { buildHandles } from '../src/pose/handles';
import { makeSolver } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { bindParts } from '../src/sdf/bindPose';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
import { castRay, compileField } from '../src/sdf/field';
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

  it('一个上半身时和原来一模一样', () => {
    expect(buildFigure(make({ torsos: 1, heads: 2, armPairs: 2 }))).toEqual(buildFigure(make({ heads: 2, armPairs: 2 })));
  });

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

  it('从胯上像树杈一样分出去：上半身在髋关节（屁股缝的顶上）以下和胯是同一张皮，往上渐渐转开、挪开；只有二次元素体两个上半身时胯的上半截加宽', () => {
    for (const bodyStyle of ['mannequin', 'anime'] as const) {
      for (const torsos of [2, 3]) {
        const f = buildFigure(make({ torsos }, { bodyStyle }));
        const pelvis = part(f, 'Torso');
        const shape = pelvis.prims.find((p) => p.kind === 'grid' || p.kind === 'loft')!;
        const copy = f.parts.find((p) => p.parent === 'Torso' && p.type === 'torso')!;
        const own = (copy.prims[0] as { fork?: Fork }).fork!;
        if (bodyStyle === 'anime' && torsos === 2) {
          // 二次元素体两个上半身从胯上就分开：胯的上半截跟着往两边加宽，加宽的那一段就是上半身往外挪的那一段
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
            // 二次元素体：挪比转先开始；转一直渐渐加到腋下（手臂根下面），三个上半身时挪也是；胸是采样好的，跟着躯干一起分（换到胸自己的坐标里）
            expect(fork.shiftFrom!, copy.name).toBeLessThan(fork.from);
            if (torsos === 3) expect(fork.shiftTo!, copy.name).toBeCloseTo(fork.to, 9);
            for (const arm of f.parts.filter((p) => p.parent === copy.name && p.type === 'arm')) expect(fork.to, arm.name).toBeLessThan(arm.pos[1] - 0.05);
            for (const chest of chests) {
              const own = (chest.prims[0] as { fork?: Fork }).fork;
              if (torsos === 2) expect(own?.frame, chest.name).toEqual({ pos: chest.pos, quat: chest.quat, scale: chest.scale ?? 1 });
              if (own) expect({ ...own, frame: undefined }, chest.name).toEqual({ ...fork, split: undefined, frame: undefined });
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

  it('二次元素体两个上半身从胯上就分开：胯顶往上两个肚子是分开的（中间一道 V），胯里还是一整块，外侧在接口处不起台阶', () => {
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
      // 胯顶往上：正中比两个肚子凹进去一大截
      const waist = split + 0.09;
      expect(front(0, waist), label).toBeLessThan(front(s, waist) - 0.02);
      // 胯里：正中不凹
      expect(front(0, split - 0.04), label).toBeGreaterThan(front(s, split - 0.04) - 0.006);
      // 外侧：接口上下各几毫米没有一下子跳出去
      for (let y = split - 0.03; y < split + 0.03; y += 0.0025) expect(Math.abs(outer(y + 0.0025) - outer(y)), `${label} ${y}`).toBeLessThan(0.004);
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
