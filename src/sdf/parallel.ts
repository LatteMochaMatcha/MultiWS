/**
 * 一次融合里最费时的几段分给几个帮手线程一起算：
 * - 各小块的格点上求值（见 surfaceNets.ts）；
 * - 要权重的：每个顶点离哪些部件近、每个顶点摊到骨骼上（见 rig/skin.ts 的第 1、3 步），按顶点分段。
 *
 * 活分成一份一份，谁空了谁拿下一份；融合线程自己也一份一份地算。
 * 没分出去的都分完了，还有帮手手上的没交回来，融合线程就把最后分出去的那份自己也算一遍（谁先算完用谁的）：
 * 帮手慢（手机上的小核）、出了错、整个线程没了，都不会卡住，最多多算几份。
 * 帮手照同一个任务自己编译场、准备算权重要用的那些（见 job.ts、skin.ts 的 planSkin），算出来的和融合线程自己算的一模一样。
 *
 * 和线程打交道的部分（端口、消息）留给调用的地方，这里只管怎么分：在单元测试里可以用假的帮手。
 */
import { buildSkeleton } from '../rig/skeleton';
import { type NearParts, type SkinPlan, type SkinWeights, finishSkin, gateNear, joinNear, nearParts, planSkin, skinVertices, weighVertices } from '../rig/skin';
import { skinnedFigure, skinnedSteps } from './bindPose';
import { worldTransforms } from '../geometry/figure';
import { type CompiledField, compilePartField } from './field';
import { type Staged, VOXEL } from './fuse';
import { type BakedChest, type ChestPlan, adoptChests, bakeChestLayers, bakedChests, keepChest, neededChests, planChest } from './grids';
import { surfaceLocks, surfaceMoves } from './surfaceQuality';
import { type FuseJob, type FuseResult, stageJob } from './job';
import {
  type BlockMemo,
  type BlockPlan,
  type BlockValues,
  type FusedMesh,
  blocksToEvaluate,
  evaluateBlocks,
  keepBlocks,
  planBlocks,
} from './surfaceNets';

/** 一份多少个小块：精细的网格上一份要算十几到几十毫秒，来回传消息的工夫相比之下可以不计 */
export const CHUNK = 48;
/** 要求值的小块不到这么多的任务不分（拖滑块时那种粗的网格），省得来回传数据反而更慢 */
export const MIN_BLOCKS = 256;
/** 算权重时一份多少个顶点 */
export const SKIN_CHUNK = 4096;
/** 顶点不到这么多的不分 */
export const MIN_VERTICES = 2 * SKIN_CHUNK;
/**
 * 每个帮手手上最多压着几份：融合线程自己在算一份的时候收不到帮手交回来的消息，也就分不出新的；
 * 帮手手上多压一份，算完一份接着算下一份，不用干等
 */
const DEPTH = 2;

/**
 * 交给帮手的一份活：在这几个小块上求值。task：这个任务头一回找这个帮手时带上，帮手照它编译场。
 * chests：融合线程烤好、这个帮手还没收到过的胸（见 grids.ts 的 BakedChest），帮手编译场的时候照用，不用再烤一遍
 */
export interface ChunkRequest {
  job: number;
  chunk: number;
  blocks: Int32Array;
  task?: FuseJob;
  chests?: BakedChest[];
}

/**
 * 交给帮手的一份活：算权重的第 1 步（near：这一段顶点离哪些部件近）或第 3 步（weigh：摊到骨骼上，带着这一段的第 1、2 步的结果）。
 * task、positions：这个任务头一回找这个帮手算权重时带上，帮手照它们准备（见 planSkin）
 */
export interface SkinRequest {
  job: number;
  chunk: number;
  range: [from: number, to: number];
  step: 'near' | 'weigh';
  task?: FuseJob;
  positions?: Float32Array;
  chests?: BakedChest[];
  near?: NearParts;
  gate?: Float32Array;
}

/**
 * 交给帮手的一份活：表面校正里这一段顶点各挪到哪（见 surfaceQuality.ts 的 surfaceMoves）。
 * task、rough：这个任务头一回找这个帮手做表面校正时带上（校正之前的顶点、法线、哪些顶点不动、体素）
 */
export interface RefineRequest {
  job: number;
  chunk: number;
  range: [from: number, to: number];
  step: 'refine';
  task?: FuseJob;
  chests?: BakedChest[];
  rough?: { positions: Float32Array; normals: Float32Array; locked: Uint8Array; voxel: number };
}

/** 交给帮手的一份活：烤一个胸的第 from 到 to（不含）层（见 grids.ts 的 bakeChestLayers） */
export interface BakeRequest {
  job: number;
  chunk: number;
  bake: ChestPlan;
  layers: [from: number, to: number];
}

/** 帮手交回来的：算好的那一份，或者出了什么错 */
export interface ChunkReply {
  job: number;
  chunk: number;
  values?: BlockValues;
  near?: NearParts;
  weights?: SkinWeights;
  moved?: Float32Array;
  layers?: Float32Array;
  error?: string;
}

/** 这个任务算完（或者作废）了，帮手可以把编译好的场、准备好的那些扔了 */
export interface ChunkDrop {
  drop: number;
}

/** 一个帮手：能发活给它（transfer：随消息整个移交的大数组）；它交回来的由调用的地方转给 onReply */
export interface HelperLink {
  send(message: ChunkRequest | SkinRequest | RefineRequest | BakeRequest | ChunkDrop, transfer?: Transferable[]): void;
  onReply: ((reply: ChunkReply) => void) | null;
}

export interface SpreadOptions {
  /** 作废了没有（每算完一份看一眼） */
  cancelled: () => boolean;
  /** 让出一下，好把帮手交回来的消息、作废的消息收进来 */
  pause: () => Promise<void>;
}

/**
 * 同一个任务里先后有几批活（小块、算权重的第 1 步、第 3 步），每一批的份各从这里起编号：
 * 上一批里慢了的帮手交回来的，下一批不会错认成自己的
 */
const BATCH = { blocks: 0, near: 1 << 20, weigh: 2 << 20, refine: 3 << 20, bake: 4 << 20 } as const;
/** 烤胸时一份大约多少个格点（一层的格点数乘上几层）：精细的那档一份要算十几毫秒 */
const BAKE_CHUNK = 32768;

/** 每个帮手收到过哪些烤好的胸（BakedChest.shape） */
const given = new WeakMap<HelperLink, Set<string>>();

/**
 * 融合线程烤好、这个帮手还没收到过的胸（没有就是 undefined）。
 * 帮手那边的烤好的胸多了也会扔掉旧的：扔掉了它就自己再烤一遍，算出来的一样，只是慢些
 */
function newChests(helper: HelperLink): BakedChest[] | undefined {
  let sent = given.get(helper);
  if (!sent) given.set(helper, (sent = new Set()));
  const fresh = bakedChests().filter((chest) => !sent.has(chest.shape));
  for (const chest of fresh) sent.add(chest.shape);
  return fresh.length ? fresh : undefined;
}

/** 一批要分的活 */
interface Work<T> {
  /** 这一批的份从几起编号（见 BATCH） */
  base: number;
  /** 一共几份 */
  count: number;
  /** 第 chunk 份交给第 h 个帮手（发出去的编号是 base + chunk） */
  lend(chunk: number, h: number): void;
  /** 自己算第 chunk 份 */
  compute(chunk: number): T;
  /** 帮手交回来的第 chunk 份；出了错、对不上的返回 undefined */
  take(reply: ChunkReply, chunk: number): T | undefined;
}

/** 把一批活分给帮手和自己一起算完，按份的先后返回结果；作废了返回 null */
async function share<T>(id: number, work: Work<T>, helpers: readonly HelperLink[], options: SpreadOptions): Promise<T[] | null> {
  const results = new Array<T | undefined>(work.count);
  let remaining = work.count;
  let next = 0;
  /** 分给帮手、还没交回来的（按分出去的先后），和各自在哪个帮手手上 */
  const lent: number[] = [];
  const holder = new Map<number, number>();
  /** 每个帮手手上压着几份；出过错的帮手这一批里不再给它 */
  const busy = new Uint8Array(helpers.length);
  const broken = new Uint8Array(helpers.length);
  const keep = (chunk: number, result: T) => {
    if (results[chunk] !== undefined) return;
    results[chunk] = result;
    remaining--;
  };
  const lend = () => {
    for (let round = 0; round < DEPTH; round++) {
      for (let h = 0; h < helpers.length && next < work.count; h++) {
        if (broken[h] || busy[h] > round) continue;
        const chunk = next++;
        busy[h]++;
        lent.push(chunk);
        holder.set(chunk, h);
        work.lend(chunk, h);
      }
    }
  };
  helpers.forEach((helper, h) => {
    helper.onReply = (reply) => {
      const chunk = reply.chunk - work.base;
      if (reply.job !== id || chunk < 0 || chunk >= work.count) return;
      if (holder.get(chunk) === h) {
        holder.delete(chunk);
        busy[h]--;
      }
      // 出了错的不收，那一份留着没算完，后面自己算
      const result = work.take(reply, chunk);
      if (result !== undefined) keep(chunk, result);
      else broken[h] = 1;
      lend();
    };
  });
  try {
    while (remaining > 0) {
      if (options.cancelled()) return null;
      lend();
      let chunk: number | undefined;
      if (next < work.count) chunk = next++;
      else {
        // 都分出去了：最后分出去、还没交回来的那份自己也算（离它交回来最远）
        while (lent.length && results[lent[lent.length - 1]] !== undefined) lent.pop();
        chunk = lent.pop();
      }
      if (chunk !== undefined && results[chunk] === undefined) keep(chunk, work.compute(chunk));
      await options.pause();
    }
  } finally {
    for (const helper of helpers) helper.onReply = null;
  }
  return results as T[];
}

/**
 * 把 blocks（plan 里要求值的小块）分给帮手和自己一起算完。返回算好的几批（交给 keepBlocks）；作废了返回 null。
 * id：任务的编号（同一个帮手上不同的任务各编各的场）；job：帮手照它编译场
 */
export function spreadBlocks(
  id: number,
  job: FuseJob,
  field: CompiledField,
  plan: BlockPlan,
  blocks: Int32Array,
  helpers: readonly HelperLink[],
  options: SpreadOptions,
): Promise<BlockValues[] | null> {
  const chunks: Int32Array[] = [];
  for (let at = 0; at < blocks.length; at += CHUNK) chunks.push(blocks.subarray(at, at + CHUNK));
  const told = new Uint8Array(helpers.length);
  return share<BlockValues>(
    id,
    {
      base: BATCH.blocks,
      count: chunks.length,
      lend(chunk, h) {
        // 子数组不能整个移交（会把别的份也带走）：复制一份小的
        const message: ChunkRequest = { job: id, chunk: BATCH.blocks + chunk, blocks: chunks[chunk].slice() };
        if (!told[h]) {
          // 帮手只编译场，用不着摆姿势时带着的那张网格（见 FuseJob.bind；一两兆，每个帮手复制一份不值）
          message.task = job.bind ? { ...job, bind: undefined } : job;
          message.chests = newChests(helpers[h]);
        }
        told[h] = 1;
        helpers[h].send(message, [message.blocks.buffer]);
      },
      compute: (chunk) => evaluateBlocks(field, plan, chunks[chunk]),
      // 排法对不上也算出错
      take: (reply) => (reply.values?.key === plan.key ? reply.values : undefined),
    },
    helpers,
    options,
  );
}

/**
 * 算权重（同 skinVertices）：第 1 步、第 3 步按顶点分段分给帮手和自己一起算，第 2 步（沿着表面量远近）自己算。
 * job：帮手照它准备（它的部件、和 mesh 的顶点）。作废了返回 null
 */
export async function spreadSkin(
  id: number,
  job: FuseJob,
  plan: SkinPlan,
  mesh: FusedMesh,
  helpers: readonly HelperLink[],
  options: SpreadOptions,
): Promise<SkinWeights | null> {
  const ranges: [number, number][] = [];
  for (let at = 0; at < plan.count; at += SKIN_CHUNK) ranges.push([at, Math.min(plan.count, at + SKIN_CHUNK)]);
  const told = new Uint8Array(helpers.length);
  /** 这一份活带不带上任务：这个帮手头一回算这个任务的权重时带上 */
  const ask = (h: number, message: SkinRequest, transfer: Transferable[]) => {
    if (!told[h]) {
      message.task = job;
      message.positions = Float32Array.from(mesh.positions);
      // 算权重时各部件的场照最细一档烤胸（见 skin.ts 的 planSkin）：融合线程刚烤好的一并带上
      message.chests = newChests(helpers[h]);
      transfer.push(message.positions.buffer);
      told[h] = 1;
    }
    helpers[h].send(message, transfer);
  };
  const parts = await share<NearParts>(
    id,
    {
      base: BATCH.near,
      count: ranges.length,
      lend: (chunk, h) => ask(h, { job: id, chunk: BATCH.near + chunk, range: ranges[chunk], step: 'near' }, []),
      compute: (chunk) => nearParts(plan, ...ranges[chunk]),
      take: (reply, chunk) => (reply.near?.first === ranges[chunk][0] ? reply.near : undefined),
    },
    helpers,
    options,
  );
  if (!parts) return null;
  const near = joinNear(plan, parts);
  const gate = gateNear(plan, near);
  /** 一段顶点的第 1、2 步的结果（各项的下标从这一段的头一项算起） */
  const slice = ([from, to]: [number, number]) => {
    const lo = near.offsets[from];
    const hi = near.offsets[to];
    const offsets = near.offsets.slice(from, to + 1);
    for (let i = 0; i < offsets.length; i++) offsets[i] -= lo;
    const piece: NearParts = { first: from, offsets, entry: near.entry.slice(lo, hi), dist: near.dist.slice(lo, hi), owner: new Int32Array(0) };
    return { near: piece, gate: gate ? gate.slice(lo, hi) : undefined };
  };
  const pieces = await share<SkinWeights>(
    id,
    {
      base: BATCH.weigh,
      count: ranges.length,
      lend(chunk, h) {
        const { near: piece, gate: cut } = slice(ranges[chunk]);
        const transfer: Transferable[] = [piece.offsets.buffer, piece.entry.buffer, piece.dist.buffer];
        if (cut) transfer.push(cut.buffer);
        ask(h, { job: id, chunk: BATCH.weigh + chunk, range: ranges[chunk], step: 'weigh', near: piece, ...(cut ? { gate: cut } : {}) }, transfer);
      },
      compute(chunk) {
        const [from, to] = ranges[chunk];
        const out = { joints: new Uint16Array((to - from) * 4), weights: new Float32Array((to - from) * 4) };
        weighVertices(plan, near, gate, from, to, out.joints, out.weights);
        return out;
      },
      take: (reply, chunk) => (reply.weights?.joints.length === (ranges[chunk][1] - ranges[chunk][0]) * 4 ? reply.weights : undefined),
    },
    helpers,
    options,
  );
  if (!pieces) return null;
  const joints = new Uint16Array(plan.count * 4);
  const weights = new Float32Array(plan.count * 4);
  pieces.forEach((piece, chunk) => {
    joints.set(piece.joints, ranges[chunk][0] * 4);
    weights.set(piece.weights, ranges[chunk][0] * 4);
  });
  return finishSkin(plan, joints, weights);
}

/**
 * 表面校正（见 surfaceQuality.ts）里最费时的那步：各顶点挪回表面，按顶点分段分给帮手和自己一起算。
 * mesh 是校正之前的网格，field 是这个任务的场（帮手照 job 自己编译，一模一样）。返回全部顶点挪好以后的位置；作废了返回 null
 */
export async function spreadRefine(
  id: number,
  job: FuseJob,
  field: CompiledField,
  mesh: FusedMesh,
  helpers: readonly HelperLink[],
  options: SpreadOptions,
): Promise<Float32Array | null> {
  const count = mesh.positions.length / 3;
  const plan = planBlocks(field, mesh.info.voxel);
  const locked = surfaceLocks(mesh);
  const ranges: [number, number][] = [];
  for (let at = 0; at < count; at += SKIN_CHUNK) ranges.push([at, Math.min(count, at + SKIN_CHUNK)]);
  const told = new Uint8Array(helpers.length);
  const pieces = await share<Float32Array>(
    id,
    {
      base: BATCH.refine,
      count: ranges.length,
      lend(chunk, h) {
        const message: RefineRequest = { job: id, chunk: BATCH.refine + chunk, range: ranges[chunk], step: 'refine' };
        const transfer: Transferable[] = [];
        if (!told[h]) {
          message.task = job;
          message.chests = newChests(helpers[h]);
          message.rough = { positions: mesh.positions.slice(), normals: mesh.normals.slice(), locked: locked.slice(), voxel: mesh.info.voxel };
          transfer.push(message.rough.positions.buffer, message.rough.normals.buffer, message.rough.locked.buffer);
          told[h] = 1;
        }
        helpers[h].send(message, transfer);
      },
      compute: (chunk) => surfaceMoves(field, plan, mesh, locked, ...ranges[chunk]),
      take: (reply, chunk) => (reply.moved?.length === (ranges[chunk][1] - ranges[chunk][0]) * 3 ? reply.moved : undefined),
    },
    helpers,
    options,
  );
  if (!pieces) return null;
  const moved = new Float32Array(count * 3);
  pieces.forEach((piece, chunk) => moved.set(piece, ranges[chunk][0] * 3));
  return moved;
}

/**
 * 几个要烤的胸（见 grids.ts 的 ChestPlan）按层分段，分给帮手和自己一起烤，烤好的收下（这个线程里以后直接用）。
 * 拼起来和一个线程从头烤的逐值一样。作废了返回 false
 */
export async function spreadBake(id: number, plans: readonly ChestPlan[], helpers: readonly HelperLink[], options: SpreadOptions): Promise<boolean> {
  const chunks: { plan: number; from: number; to: number }[] = [];
  plans.forEach((plan, i) => {
    const depth = Math.max(2, Math.ceil(BAKE_CHUNK / (plan.nx * plan.ny)));
    for (let from = 0; from < plan.nz; from += depth) chunks.push({ plan: i, from, to: Math.min(plan.nz, from + depth) });
  });
  const pieces = await share<Float32Array>(
    id,
    {
      base: BATCH.bake,
      count: chunks.length,
      lend(chunk, h) {
        const { plan, from, to } = chunks[chunk];
        const message: BakeRequest = { job: id, chunk: BATCH.bake + chunk, bake: plans[plan], layers: [from, to] };
        helpers[h].send(message);
      },
      compute: (chunk) => bakeChestLayers(plans[chunks[chunk].plan], chunks[chunk].from, chunks[chunk].to),
      take: (reply, chunk) => {
        const { plan, from, to } = chunks[chunk];
        return reply.layers?.length === plans[plan].nx * plans[plan].ny * (to - from) ? reply.layers : undefined;
      },
    },
    helpers,
    options,
  );
  if (!pieces) return false;
  plans.forEach((plan, i) => {
    const layers = new Float32Array(plan.nx * plan.ny * plan.nz);
    chunks.forEach((chunk, c) => {
      if (chunk.plan === i) layers.set(pieces[c], chunk.from * plan.nx * plan.ny);
    });
    keepChest(plan, layers);
  });
  return true;
}

/**
 * 这个任务要烤、这个线程里还没烤过的胸：先分给帮手一起烤好（一个线程烤要好几秒：精细那档一个胸两三百毫秒，几个上半身、几排胸有七八个）。
 * 编译场的时候就都是烤好的了。作废了返回 false
 */
async function bakeAhead(id: number, job: FuseJob, helpers: readonly HelperLink[], options: SpreadOptions): Promise<boolean> {
  const orders = neededChests(() => {
    stageJob(job);
    // 要权重的：算权重时各部件的场也照最细一档烤胸（见 skin.ts 的 planSkin）
    if (job.skin && !job.pose) {
      const figure = skinnedFigure(job.parts);
      const xfs = worldTransforms(figure);
      for (const part of figure.parts) if (part.material !== 'eye') compilePartField(part, xfs.get(part.name)!);
    }
  });
  const plans = orders.map(planChest).filter((plan): plan is ChestPlan => plan !== null);
  return !plans.length || spreadBake(id, plans, helpers, options);
}

/**
 * 照一个任务融合：大活（预览精度以上、要求值的小块够多）分给帮手一起算（帮手一个都没有也一份一份地算，好随时作废）；
 * 拖动时那种粗的小活照旧一口气算完。要烤的胸先分给帮手一起烤（见 bakeAhead）。作废了返回 null
 */
export async function fuseSpread(id: number, job: FuseJob, helpers: readonly HelperLink[], options: SpreadOptions): Promise<FuseResult | null> {
  if (helpers.length && !(await bakeAhead(id, job, helpers, options))) return null;
  if (job.voxel > VOXEL.preview) return stageJob(job).finish();
  let shared = false;
  /** 场的小块分给帮手算好，放进 memo；小块不多的不分（返回 undefined：收尾时照常现算）；作废了返回 null */
  const spreadField = async (field: CompiledField, voxel: number): Promise<BlockMemo | undefined | null> => {
    const plan = planBlocks(field, voxel);
    const blocks = blocksToEvaluate(plan);
    if (blocks.length < MIN_BLOCKS) return undefined;
    shared = helpers.length > 0;
    const batches = await spreadBlocks(id, job, field, plan, blocks, helpers, options);
    return batches && keepBlocks(plan, batches);
  };
  /** 收尾。最后一步是表面校正的（静止的二次元素体），校正也分给帮手（顶点不多、没有帮手的照常一口气算完）；作废了返回 null */
  const finish = async <T>(staged: Staged<T>, memo: BlockMemo | undefined): Promise<T | null> => {
    const refine = staged.refine;
    if (!refine || !helpers.length) return staged.finish(memo);
    const mesh = refine.rough(memo);
    if (mesh.positions.length / 3 < MIN_VERTICES) {
      return refine.polish(mesh, surfaceMoves(staged.field, planBlocks(staged.field, mesh.info.voxel), mesh, surfaceLocks(mesh), 0, mesh.positions.length / 3));
    }
    shared = true;
    const moved = await spreadRefine(id, job, staged.field, mesh, helpers, options);
    return moved && refine.polish(mesh, moved);
  };
  try {
    if (!job.skin || job.pose) {
      const staged = stageJob(job);
      const memo = await spreadField(staged.field, staged.voxel);
      return memo === null ? null : finish(staged, memo);
    }
    // 要权重的（不摆姿势）：网格融合好以后，权重也分开算
    const steps = skinnedSteps(job.parts, job);
    const memo = await spreadField(steps.fused.field, steps.fused.voxel);
    if (memo === null) return null;
    const mesh = await finish(steps.fused, memo);
    if (!mesh) return null;
    if (mesh.positions.length / 3 < MIN_VERTICES) return steps.settle(mesh, skinVertices(steps.figure, steps.skeleton, mesh.positions, mesh.triangles));
    shared = helpers.length > 0;
    const weights = await spreadSkin(id, job, planSkin(steps.figure, steps.skeleton, mesh.positions, mesh.triangles), mesh, helpers, options);
    return weights && steps.settle(mesh, weights);
  } finally {
    // 帮手那边这个任务编译好的场、准备好的那些都扔了
    if (shared) for (const helper of helpers) helper.send({ drop: id });
  }
}

/**
 * 帮手那一头：收到一份活，算好，返回要交回去的（和随它整个移交的大数组）；叫它扔掉一个任务的返回 null。
 * 真的帮手线程（eval.worker.ts）和测试里的假帮手都用它
 */
export function helperDesk(): (message: ChunkRequest | SkinRequest | RefineRequest | BakeRequest | ChunkDrop) => { reply: ChunkReply; transfer: Transferable[] } | null {
  /** 各个任务编译好的场、准备好的算权重要用的那些、表面校正要用的那些 */
  type Rough = NonNullable<RefineRequest['rough']> & { plan: BlockPlan };
  const jobs = new Map<number, { field?: CompiledField; plan?: BlockPlan; skin?: SkinPlan; rough?: Rough }>();
  return (message) => {
    if ('drop' in message) {
      jobs.delete(message.drop);
      return null;
    }
    const { job, chunk } = message;
    try {
      // 烤胸的几层：不用编译场，照着胸自己现算
      if ('bake' in message) {
        const layers = bakeChestLayers(message.bake, ...message.layers);
        return { reply: { job, chunk, layers }, transfer: [layers.buffer] };
      }
      if (message.chests) adoptChests(message.chests);
      let made = jobs.get(job);
      if (!made) jobs.set(job, (made = {}));
      if ('blocks' in message) {
        if (!made.field || !made.plan) {
          if (!message.task) throw new Error('没收到这个任务');
          made.field = stageJob(message.task).field;
          made.plan = planBlocks(made.field, message.task.voxel);
        }
        const values = evaluateBlocks(made.field, made.plan, message.blocks);
        return { reply: { job, chunk, values }, transfer: [values.blocks.buffer, values.kinds.buffer, values.data.buffer] };
      }
      if (message.step === 'refine') {
        if (!made.field) {
          if (!message.task) throw new Error('没收到这个任务');
          made.field = stageJob(message.task).field;
        }
        if (!made.rough) {
          if (!message.rough) throw new Error('没收到校正之前的网格');
          made.rough = { ...message.rough, plan: planBlocks(made.field, message.rough.voxel) };
        }
        const { rough } = made;
        const moved = surfaceMoves(made.field, rough.plan, { positions: rough.positions, normals: rough.normals, info: { voxel: rough.voxel } }, rough.locked, ...message.range);
        return { reply: { job, chunk, moved }, transfer: [moved.buffer] };
      }
      if (!made.skin) {
        if (!message.task || !message.positions) throw new Error('没收到这个任务');
        const figure = skinnedFigure(message.task.parts);
        made.skin = planSkin(figure, buildSkeleton(figure), message.positions);
      }
      const [from, to] = message.range;
      if (message.step === 'near') {
        const near = nearParts(made.skin, from, to);
        return { reply: { job, chunk, near }, transfer: [near.offsets.buffer, near.entry.buffer, near.dist.buffer, near.owner.buffer] };
      }
      if (!message.near) throw new Error('没带上这一段的第 1、2 步');
      const weights = { joints: new Uint16Array((to - from) * 4), weights: new Float32Array((to - from) * 4) };
      weighVertices(made.skin, message.near, message.gate ?? null, from, to, weights.joints, weights.weights);
      return { reply: { job, chunk, weights }, transfer: [weights.joints.buffer, weights.weights.buffer] };
    } catch (err) {
      return { reply: { job, chunk, error: err instanceof Error ? err.message : String(err) }, transfer: [] };
    }
  };
}
