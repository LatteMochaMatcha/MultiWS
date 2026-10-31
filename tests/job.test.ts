// 融合分成前后两半：小块先在别处算好、交回去收尾（src/sdf/job.ts、surfaceNets.ts 的 planBlocks / evaluateBlocks / keepBlocks）
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type BodyCounts, type BodySpec, defaultSpec } from '../src/model/spec';
import { POSE_LIBRARY } from '../src/pose/library';
import { forward, poseMatrices } from '../src/pose/rig';
import { makeSolver, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { VOXEL } from '../src/sdf/fuse';
import { type FuseJob, type FuseResult, runJob, stageJob } from '../src/sdf/job';
import { type BlockValues, blocksToEvaluate, evaluateBlocks, keepBlocks, planBlocks } from '../src/sdf/surfaceNets';
import { useAnimeBody } from './animeBody';

const make = (counts: Partial<BodyCounts> = {}, rest: Partial<BodySpec> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, ...rest, counts: { ...base.counts, ...counts } };
};
const partsOf = (spec: BodySpec) => buildFigure(spec).parts.filter((part) => part.material !== 'eye');

/** 照现成的姿势摆好以后每根骨骼的蒙皮矩阵 */
function posed(spec: BodySpec, name: string): Float64Array {
  const parts = partsOf(spec);
  const solver = makeSolver(buildSkeleton({ parts, scale: 1 }).bones);
  const pose = POSE_LIBRARY.find((one) => one.name === name)!;
  return poseMatrices(solver.rig, forward(solver.rig, stateOf(solver, pose.posing)));
}

/**
 * 像几个帮手线程那样分开算：每一份各自从任务编译一个场（不和收尾用的那个共用），算分到的小块。
 * skip：第几份不交回去（算丢了）
 */
function shards(job: FuseJob, count: number, skip = -1): BlockValues[] {
  const own = stageJob(job);
  const blocks = blocksToEvaluate(planBlocks(own.field, own.voxel));
  const out: BlockValues[] = [];
  for (let s = 0; s < count; s++) {
    if (s === skip) continue;
    const helper = stageJob(job).field;
    const plan = planBlocks(helper, job.voxel);
    out.push(evaluateBlocks(helper, plan, blocks.filter((_, i) => i % count === s)));
  }
  return out;
}

/** 两次融合的结果逐个数一样 */
function expectSame(a: FuseResult, b: FuseResult, label: string) {
  expect(a.mesh.positions, label).toEqual(b.mesh.positions);
  expect(a.mesh.normals, label).toEqual(b.mesh.normals);
  expect(a.mesh.quads, label).toEqual(b.mesh.quads);
  expect(a.mesh.triangles, label).toEqual(b.mesh.triangles);
  expect(a.mesh.tris, label).toEqual(b.mesh.tris);
  expect(a.mesh.bound?.joints, label).toEqual(b.mesh.bound?.joints);
  expect(a.mesh.bound?.weights, label).toEqual(b.mesh.bound?.weights);
  expect(a.skin?.joints, label).toEqual(b.skin?.joints);
  expect(a.skin?.weights, label).toEqual(b.skin?.weights);
}

describe('融合分成前后两半，小块在别处算好再交回去', () => {
  const jobs = (): [string, FuseJob][] => {
    useAnimeBody();
    const fan = make({ armPairs: 3 }, { armLayout: 'fan' });
    const anime = make({ armPairs: 2 }, { armLayout: 'fan', bodyStyle: 'anime' });
    return [
      ['白模 静止', { parts: partsOf(make()), voxel: VOXEL.preview, blend: 0.02 }],
      ['白模 三对手臂 带权重', { parts: partsOf(fan), voxel: VOXEL.preview, blend: 0.02, skin: true }],
      // 手按在大腿上：手腕周围空出来再融合第二遍
      ['白模 坐着', { parts: partsOf(make()), voxel: VOXEL.preview, blend: 0.02, pose: posed(make(), '坐着') }],
      // 二次元素体的腿融合时留在胯上，收尾时照权重搬过去
      ['二次元素体 坐着', { parts: partsOf(anime), voxel: VOXEL.preview, blend: 0.02, pose: posed(anime, '坐着') }],
    ];
  };

  it('分三份算、各自编译各自的场：收尾出来的网格（和权重）和一个线程从头算的逐个数一样，收尾时几乎不用再求值', () => {
    for (const [label, job] of jobs()) {
      const whole = runJob(job);
      const staged = stageJob(job);
      const plan = planBlocks(staged.field, job.voxel);
      const split = staged.finish(keepBlocks(plan, shards(job, 3)));
      expectSame(split, whole, label);
      // 手腕空出来再融合的第二遍：两边都只重算手腕附近那些（交回来的是没空出来时的值）；别的情况收尾时一块都不用算
      if (label === '白模 坐着') {
        expect(split.mesh.info.blocks, label).toBe(whole.mesh.info.blocks);
        expect(split.mesh.info.blocks, label).toBeLessThan(blocksToEvaluate(plan).length / 3);
      } else expect(split.mesh.info.blocks, label).toBe(0);
    }
  }, 120_000);

  it('有一份没交回来：缺的那些小块收尾时自己算，结果还是一样', () => {
    const [label, job] = jobs()[3];
    const whole = runJob(job);
    const staged = stageJob(job);
    const plan = planBlocks(staged.field, job.voxel);
    const split = staged.finish(keepBlocks(plan, shards(job, 3, 1)));
    expectSame(split, whole, label);
    expect(split.mesh.info.blocks).toBeGreaterThan(0);
  }, 60_000);

  it('排法不一样的（别的体素、别的身体）不抄', () => {
    const [label, job] = jobs()[0];
    const whole = runJob(job);
    const staged = stageJob(job);
    const plan = planBlocks(staged.field, job.voxel);
    const coarse = shards({ ...job, voxel: VOXEL.draft }, 1);
    const other = shards({ ...job, parts: partsOf(make({ heads: 2 })) }, 1);
    expect(coarse[0].key).not.toBe(plan.key);
    expect(other[0].key).not.toBe(plan.key);
    const split = staged.finish(keepBlocks(plan, [...coarse, ...other]));
    expectSame(split, whole, label);
    expect(split.mesh.info.blocks).toBe(whole.mesh.info.blocks);
  }, 60_000);

  it('一批小块打包成几个大数组：哪几块、各是哪一类、有表面的各带 9³ 个值', () => {
    const [, job] = jobs()[0];
    const staged = stageJob(job);
    const plan = planBlocks(staged.field, job.voxel);
    const blocks = blocksToEvaluate(plan);
    expect(blocks.length).toBeGreaterThan(100);
    for (let i = 1; i < blocks.length; i++) expect(blocks[i]).toBeGreaterThan(blocks[i - 1]);
    const batch = evaluateBlocks(staged.field, plan, blocks);
    expect(batch.blocks).toEqual(blocks);
    const surface = batch.kinds.filter((kind) => kind === 2).length;
    expect(surface).toBeGreaterThan(50);
    expect(batch.kinds.some((kind) => kind === 0)).toBe(true);
    expect(batch.data).toHaveLength(surface * 729);
  }, 60_000);
});
