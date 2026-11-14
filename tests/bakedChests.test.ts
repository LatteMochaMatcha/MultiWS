// 烤好的胸（src/sdf/grids.ts 的 chestDist）：粗、预览、精细三档都留得住，拖手臂、腿（胸没变）的时候不重烤
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { forward, poseMatrices } from '../src/pose/rig';
import { makeSolver, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { type BodySpec, defaultSpec } from '../src/model/spec';
import type { ChestShape } from '../src/geometry/figure';
import { bakeChestLayers, bakedChests, bakedSize, planChest } from '../src/sdf/grids';
import { stageJob } from '../src/sdf/job';
import { useAnimeBody } from './animeBody';

useAnimeBody();

describe('烤好的胸', () => {
  it('两个上半身、两对胸：三档精细度一共二十几份都留着，再编译一遍一份都不用烤', () => {
    const base = defaultSpec();
    const spec: BodySpec = { ...base, bodyStyle: 'anime', counts: { ...base.counts, torsos: 2, breasts: 4 } };
    const parts = buildFigure(spec).parts.filter((p) => p.material !== 'eye');
    const voxels = [0.02, 0.012, 0.0065];
    for (const voxel of voxels) stageJob({ parts, voxel, blend: spec.blend });
    const after = bakedSize();
    // 以前按个数只留 12 份：三档轮着编译的时候互相挤掉
    expect(after.count).toBeGreaterThan(12);
    const shapes = new Set(bakedChests().map((chest) => chest.shape));
    for (const voxel of voxels) stageJob({ parts, voxel, blend: spec.blend });
    expect(bakedSize()).toEqual(after);
    expect(new Set(bakedChests().map((chest) => chest.shape))).toEqual(shapes);
  }, 60_000);

  it('先试编译一遍看要烤哪些胸（有帮手时 bakeAhead 这么做），照姿势正式编译出来的场和没试过的逐值一样：两个上半身、一个歪开', async () => {
    const base = defaultSpec();
    const spec: BodySpec = { ...base, bodyStyle: 'anime', counts: { ...base.counts, torsos: 2, breasts: 4 } };
    const parts = buildFigure(spec).parts.filter((p) => p.material !== 'eye');
    const solver = makeSolver(buildSkeleton({ parts, scale: 1 }).bones);
    // 左边那个上半身往外歪 30°：胸上的点跟躯干还是跟自己的上半身，照它离躯干多远定（见 posedField.ts 的 torsoNearChests）
    const lean = { ...spec.posing, bones: { Spine_L: [0, 0, -0.2588, 0.9659] as [number, number, number, number] } };
    const job = { parts, voxel: 0.012, blend: spec.blend, pose: poseMatrices(solver.rig, forward(solver.rig, stateOf(solver, lean))) };
    /** 一份新的模块（相当于一个刚开的线程）：烤好的胸、躯干格子都还没有 */
    const fresh = async () => {
      vi.resetModules();
      const bytes = readFileSync(new URL('../public/anime/body.bin', import.meta.url));
      (await import('../src/anime/body')).installAnimeBody(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      return { job: await import('../src/sdf/job'), grids: await import('../src/sdf/grids'), field: await import('../src/sdf/field') };
    };
    const tried = await fresh();
    expect(tried.grids.neededChests(() => void tried.job.stageJob(job)).bake.length).toBeGreaterThan(0);
    const after = tried.job.stageJob(job).field;
    const plain = await fresh();
    const want = plain.job.stageJob(job).field;
    let near = 0;
    for (let x = -0.4; x <= 0.4; x += 0.02) {
      for (let y = 0.8; y <= 1.6; y += 0.02) {
        for (let z = -0.3; z <= 0.4; z += 0.02) {
          const v = plain.field.fieldAt(want, x, y, z);
          if (Math.abs(v) > 0.03) continue;
          near++;
          expect(tried.field.fieldAt(after, x, y, z), `${x} ${y} ${z}`).toBe(v);
        }
      }
    }
    expect(near).toBeGreaterThan(1000);
  }, 120_000);

  it('手机上每个线程留得少：两个上半身、两对胸三档都烤过，留着的不超过 32 MB', async () => {
    vi.resetModules();
    const bytes = readFileSync(new URL('../public/anime/body.bin', import.meta.url));
    (await import('../src/anime/body')).installAnimeBody(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const grids = await import('../src/sdf/grids');
    const job = await import('../src/sdf/job');
    grids.onPhone();
    const base = defaultSpec();
    const spec: BodySpec = { ...base, bodyStyle: 'anime', counts: { ...base.counts, torsos: 2, breasts: 4 } };
    const parts = buildFigure(spec).parts.filter((p) => p.material !== 'eye');
    for (const voxel of [0.02, 0.012, 0.0065]) job.stageJob({ parts, voxel, blend: spec.blend });
    const { count, bytes: kept } = grids.bakedSize();
    expect(count).toBeGreaterThan(4);
    expect(kept).toBeLessThanOrEqual(32 * 2 ** 20);
  }, 120_000);

  it('分几段烤（分给几个线程）拼起来和一整块烤的逐值一样', () => {
    // 上面那项一整块烤好的：粗、预览、精细三档各挑一个
    const chests = bakedChests();
    const picks = [chests[0], chests[Math.floor(chests.length / 2)], chests[chests.length - 1]];
    for (const chest of picks) {
      const space = chest.shape.indexOf(' ');
      const plan = planChest({ shape: chest.shape, cell: Number(chest.shape.slice(0, space)), p: JSON.parse(chest.shape.slice(space + 1)) as ChestShape })!;
      const { grid } = chest;
      expect([plan.nx, plan.ny, plan.nz]).toEqual([grid.nx, grid.ny, grid.nz]);
      expect(plan.lo).toEqual(chest.min);
      // 长短不一的几段，有的从粗点那一层切开，有的从两层粗点中间切开
      const cuts = [0, 1, 4, 7, Math.floor(grid.nz / 2), grid.nz - 1, grid.nz].filter((v, i, all) => i === 0 || v > all[i - 1]);
      const layers = new Float32Array(grid.data.length);
      for (let i = 0; i + 1 < cuts.length; i++) layers.set(bakeChestLayers(plan, cuts[i], cuts[i + 1]), cuts[i] * grid.nx * grid.ny);
      expect(layers).toEqual(grid.data);
    }
  }, 60_000);
});
