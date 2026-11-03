// 烤好的胸（src/sdf/grids.ts 的 chestDist）：粗、预览、精细三档都留得住，拖手臂、腿（胸没变）的时候不重烤
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type BodySpec, defaultSpec } from '../src/model/spec';
import type { ChestShape } from '../src/geometry/figure';
import { bakeChestLayers, bakedChests, bakedSize, planChest } from '../src/sdf/grids';
import { stageJob } from '../src/sdf/job';
import { useAnimeBody } from './animeBody';

useAnimeBody();

describe('烤好的胸', () => {
  it('两个上半身、两对胸：三档精细度一共二十几份都留着，再编译一遍一份都不用烤', () => {
    const base = defaultSpec();
    const spec: BodySpec = { ...base, bodyStyle: 'anime', counts: { ...base.counts, torsos: 2, chestPairs: 2 } };
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
