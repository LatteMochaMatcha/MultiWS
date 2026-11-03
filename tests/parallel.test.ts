// 大活分给帮手线程一起算（src/sdf/parallel.ts）：这里的帮手是假的，在同一个线程里隔一拍交回去
import { describe, expect, it } from 'vitest';
import { buildFigure } from '../src/geometry/layout';
import { type BodyCounts, type BodySpec, defaultSpec } from '../src/model/spec';
import { POSE_LIBRARY } from '../src/pose/library';
import { forward, poseMatrices } from '../src/pose/rig';
import { makeSolver, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { VOXEL } from '../src/sdf/fuse';
import { type FuseJob, type FuseResult, runJob, stageJob } from '../src/sdf/job';
import {
  type BakeRequest,
  type ChunkDrop,
  type ChunkRequest,
  type HelperLink,
  MIN_BLOCKS,
  type RefineRequest,
  type SkinRequest,
  fuseSpread,
  helperDesk,
} from '../src/sdf/parallel';
import { neededChests } from '../src/sdf/grids';
import { planBlocks } from '../src/sdf/surfaceNets';
import { useAnimeBody } from './animeBody';

const make = (counts: Partial<BodyCounts> = {}, rest: Partial<BodySpec> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, ...rest, counts: { ...base.counts, ...counts } };
};
const partsOf = (spec: BodySpec) => buildFigure(spec).parts.filter((part) => part.material !== 'eye');
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * 假帮手：和真的帮手线程照同一个办法算（helperDesk），隔一拍交回去。
 * dead：一份都不交回；broken：交回出错；late：慢几拍；slow：慢得多（上一批的交回来时已经在算下一批了）
 */
function fakeHelper(kind: 'ok' | 'dead' | 'broken' | 'late' | 'slow' = 'ok') {
  const desk = helperDesk();
  const got: (ChunkRequest | SkinRequest | RefineRequest | BakeRequest | ChunkDrop)[] = [];
  const helper: HelperLink = {
    onReply: null,
    send(message) {
      got.push(message);
      if ('drop' in message) {
        desk(message);
        return;
      }
      if (kind === 'dead') return;
      const reply = () => {
        if (kind === 'broken') return helper.onReply?.({ job: message.job, chunk: message.chunk, error: '坏了' });
        const done = desk(message);
        if (done) helper.onReply?.(done.reply);
      };
      setTimeout(reply, kind === 'late' ? 5 : kind === 'slow' ? 60 : 0);
    },
  };
  return {
    helper,
    got,
    chunks: () => got.filter((m): m is ChunkRequest => 'blocks' in m),
    skin: () => got.filter((m): m is SkinRequest => 'step' in m && m.step !== 'refine'),
    refine: () => got.filter((m): m is RefineRequest => 'step' in m && m.step === 'refine'),
    bakes: () => got.filter((m): m is BakeRequest => 'bake' in m),
  };
}

function expectSame(a: FuseResult, b: FuseResult, label: string) {
  expect(a.mesh.positions, label).toEqual(b.mesh.positions);
  expect(a.mesh.normals, label).toEqual(b.mesh.normals);
  expect(a.mesh.quads, label).toEqual(b.mesh.quads);
  expect(a.mesh.triangles, label).toEqual(b.mesh.triangles);
  expect(a.mesh.tris, label).toEqual(b.mesh.tris);
  expect(a.mesh.bound?.weights, label).toEqual(b.mesh.bound?.weights);
  expect(a.skin?.joints, label).toEqual(b.skin?.joints);
  expect(a.skin?.weights, label).toEqual(b.skin?.weights);
}

const plain: FuseJob = { parts: partsOf(make()), voxel: VOXEL.preview, blend: 0.02 };
const never = { cancelled: () => false, pause: tick };

describe('大活分给帮手一起算', () => {
  it('三个帮手：和一个线程从头算的逐个数一样；帮手都分到了活，任务只在头一份里带上；算完叫它们把场扔了；权重也分开算', async () => {
    useAnimeBody();
    const anime = make({ armPairs: 2 }, { armLayout: 'fan', bodyStyle: 'anime' });
    const parts = partsOf(anime);
    const solver = makeSolver(buildSkeleton({ parts, scale: 1 }).bones);
    const sit = POSE_LIBRARY.find((one) => one.name === '坐着')!;
    const still: FuseJob = { parts, voxel: VOXEL.preview, blend: 0.02, labels: true };
    const cases: [string, FuseJob][] = [
      ['白模 静止', plain],
      ['白模 三对手臂 带权重', { parts: partsOf(make({ armPairs: 3 }, { armLayout: 'fan' })), voxel: VOXEL.preview, blend: 0.02, skin: true }],
      ['二次元素体 坐着', { parts, voxel: VOXEL.preview, blend: 0.02, pose: poseMatrices(solver.rig, forward(solver.rig, stateOf(solver, sit.posing))) }],
      // 静止的二次元素体：收尾的表面校正也分开算
      ['二次元素体 静止', still],
      ['二次元素体 带权重', { parts, voxel: VOXEL.preview, blend: 0.02, skin: true }],
    ];
    for (const [label, job] of cases) {
      const fakes = [fakeHelper(), fakeHelper(), fakeHelper()];
      const made = await fuseSpread(7, job, fakes.map((f) => f.helper), never);
      expectSame(made!, runJob(job), label);
      if (job.labels) expect(made!.labels, label).toEqual(runJob(job).labels);
      for (const fake of fakes) {
        const chunks = fake.chunks();
        expect(chunks.length, label).toBeGreaterThan(0);
        expect(chunks[0].task, label).toBe(job);
        expect(chunks.slice(1).every((m) => !m.task && !m.chests), label).toBe(true);
        expect(chunks.every((m) => m.job === 7), label).toBe(true);
        expect(fake.got[fake.got.length - 1], label).toEqual({ drop: 7 });
        // 二次元素体：融合线程烤好的胸随头一份交给帮手
        if (job.parts === parts && !job.pose) expect(chunks[0].chests?.length, label).toBeGreaterThan(0);
        // 表面校正：分到了；校正之前的网格只在头一份里带上
        const refine = fake.refine();
        if (job.parts === parts && !job.pose) {
          expect(refine.length, label).toBeGreaterThan(0);
          expect(refine[0].rough?.positions, label).toHaveLength(made!.mesh.positions.length);
          expect(refine.slice(1).every((m) => !m.task && !m.rough), label).toBe(true);
        } else {
          expect(refine, label).toEqual([]);
        }
        // 要权重的：第 1 步、第 3 步都分到了；算权重的任务（连同顶点）也只在头一份里带上
        const skin = fake.skin();
        if (!job.skin) {
          expect(skin, label).toEqual([]);
          continue;
        }
        expect(skin.some((m) => m.step === 'near') && skin.some((m) => m.step === 'weigh'), label).toBe(true);
        expect(skin[0].task, label).toBe(job);
        expect(skin[0].positions, label).toHaveLength(made!.mesh.positions.length);
        expect(skin.slice(1).every((m) => !m.task && !m.positions), label).toBe(true);
      }
    }
  }, 120_000);

  it('帮手一份都不交回、交回来是错的、交得慢：剩下的自己算，照样算完，结果一样（权重也是）', async () => {
    const skinned: FuseJob = { ...plain, skin: true };
    const odd = [fakeHelper('dead'), fakeHelper('broken'), fakeHelper('late'), fakeHelper()];
    expectSame((await fuseSpread(2, skinned, odd.map((f) => f.helper), never))!, runJob(skinned), '帮手出毛病 带权重');
    const fakes = [fakeHelper('dead'), fakeHelper('broken'), fakeHelper('late'), fakeHelper()];
    const made = await fuseSpread(1, plain, fakes.map((f) => f.helper), never);
    expectSame(made!, runJob(plain), '帮手出毛病');
    // 出过错的帮手这个任务里只给过开头那一两份
    expect(fakes[1].chunks().length).toBeLessThanOrEqual(2);
    // 一直不交回的帮手：手上压着的就那两份，没再给它
    expect(fakes[0].chunks().length).toBe(2);
  }, 60_000);

  it('帮手交得特别慢：上一批（小块、权重第 1 步）的晚到了，下一批不认错，结果一样', async () => {
    const skinned: FuseJob = { ...plain, skin: true };
    const fakes = [fakeHelper('slow'), fakeHelper('slow'), fakeHelper()];
    expectSame((await fuseSpread(5, skinned, fakes.map((f) => f.helper), never))!, runJob(skinned), '慢的帮手');
    // 等晚到的都交回来（这时任务已经算完了，没人收）
    await new Promise((resolve) => setTimeout(resolve, 200));
  }, 60_000);

  it('胸没烤过：先按层分给帮手一起烤，再融合，结果和一个线程从头算的一样', async () => {
    useAnimeBody();
    // 这副胸别的测试没用过：这个线程里还没烤
    const job: FuseJob = { parts: partsOf(make({ chestPairs: 2 }, { bodyStyle: 'anime', shape: { ...defaultSpec().shape, bust: 1.37 } })), voxel: VOXEL.preview, blend: 0.02 };
    const fakes = [fakeHelper(), fakeHelper(), fakeHelper()];
    const made = await fuseSpread(11, job, fakes.map((f) => f.helper), never);
    const bakes = fakes.flatMap((f) => f.bakes());
    expect(bakes.length).toBeGreaterThan(3);
    expect(fakes.every((f) => f.bakes().length > 0)).toBe(true);
    expectSame(made!, runJob(job), '分开烤胸');
  }, 120_000);

  it('交给帮手的胸只有这个任务用到的：这个线程里先前烤的别的胸（拖着胸围滑块时一路烤的）不交', async () => {
    useAnimeBody();
    const anime = (bust: number) => partsOf(make({}, { bodyStyle: 'anime', shape: { ...defaultSpec().shape, bust } }));
    // 别的胸围：粗的、预览的都烤过
    const other = anime(0.83);
    for (const voxel of [VOXEL.draft, VOXEL.preview]) stageJob({ parts: other, voxel, blend: 0.02 });
    const job: FuseJob = { parts: anime(1.91), voxel: VOXEL.preview, blend: 0.02 };
    const fakes = [fakeHelper(), fakeHelper()];
    expectSame((await fuseSpread(13, job, fakes.map((f) => f.helper), never))!, runJob(job), '只交用到的胸');
    const { used } = neededChests(() => void stageJob(job));
    const { used: unused } = neededChests(() => void stageJob({ parts: other, voxel: VOXEL.preview, blend: 0.02 }));
    for (const fake of fakes) {
      const sent = (fake.chunks()[0].chests ?? []).map((chest) => chest.shape);
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.every((shape) => used.has(shape))).toBe(true);
      expect(sent.some((shape) => unused.has(shape))).toBe(false);
    }
  }, 120_000);

  it('一个帮手都没有：自己一份一份地算完，结果一样', async () => {
    const made = await fuseSpread(1, plain, [], never);
    expectSame(made!, runJob(plain), '没有帮手');
  }, 60_000);

  it('算到一半作废：停下返回 null，叫帮手把场扔了', async () => {
    const fake = fakeHelper();
    let pauses = 0;
    const made = await fuseSpread(3, plain, [fake.helper], { cancelled: () => pauses > 2, pause: () => (pauses++, tick()) });
    expect(made).toBeNull();
    expect(fake.got[fake.got.length - 1]).toEqual({ drop: 3 });
    // 没算完：分出去的份数远没到全部
    const blocks = planBlocks(stageJob(plain).field, plain.voxel).lists.filter(Boolean).length;
    expect(fake.chunks().length * 48).toBeLessThan(blocks);
  }, 60_000);

  it('拖动时那种粗的网格、要求值的小块很少的：不分，一口气算完', async () => {
    const coarse: FuseJob = { ...plain, voxel: VOXEL.draft };
    const fake = fakeHelper();
    expectSame((await fuseSpread(1, coarse, [fake.helper], never))!, runJob(coarse), '粗的');
    // 只有一个小球
    const torso = partsOf(make()).find((part) => !part.parent)!;
    const ball = { ...torso, prims: [{ kind: 'ellipsoid' as const, name: 'Ball', center: [0, 0, 0] as const, radii: [0.08, 0.08, 0.08] as const }] };
    const small: FuseJob = { parts: [ball] as FuseJob['parts'], voxel: VOXEL.preview, blend: 0.02 };
    expect(planBlocks(stageJob(small).field, small.voxel).lists.filter(Boolean).length).toBeLessThan(MIN_BLOCKS);
    expectSame((await fuseSpread(2, small, [fake.helper], never))!, runJob(small), '小的');
    expect(fake.got).toEqual([]);
  }, 60_000);
});
