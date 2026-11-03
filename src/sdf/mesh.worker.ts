/**
 * Web Worker：在后台线程里把部件融合成网格，主线程只管显示，拖滑块不会卡。
 * 导出带骨骼的模型时，蒙皮权重也在这里算（几十万个顶点，放主线程会卡一下）。
 * 大活里最费时的一段分给几个帮手线程一起算（见 parallel.ts、eval.worker.ts）；算到一半作废了就停下。
 */
import { installAnimeBody } from '../anime/body';
import { installGenital } from '../anime/genital';
import { type HairShape, installHairShape } from '../hair/shapes';
import type { SkinWeights } from '../rig/skin';
import { onPhone } from './grids';
import { type FuseJob, runJob } from './job';
import type { VertexLabels } from './labels';
import { type ChunkReply, type HelperLink, fuseSpread } from './parallel';
import type { FusedMesh } from './surfaceNets';

export interface MeshRequest extends FuseJob {
  id: number;
}

/** 开工前先送来的数据：采样好的形状（二次元素体），登记以后部件里才能按名字引用 */
export interface ShapesMessage {
  shapes: ArrayBuffer;
}

/** 开工前先送来的数据：白模戴的一副头发（见 hair/shapes.ts） */
export interface HairMessage {
  hair: HairShape;
  data: ArrayBuffer;
}

/** 开工前先送来的数据：阴囊的格子（见 anime/genital.ts） */
export interface GenitalMessage {
  genital: ArrayBuffer;
}

/** 界面送来的：连着几个帮手线程的端口 */
export interface HelpersMessage {
  helpers: MessagePort[];
}

/** 第 cancel 号任务不要了（还在算的话停下） */
export interface CancelMessage {
  cancel: number;
}

/** 开发时对比用：false 是一律一个线程从头算 */
export interface SpreadMessage {
  spread: boolean;
}

/** 在手机上：烤好的胸少留一些（见 grids.ts 的 onPhone；帮手线程也收这个） */
export interface PhoneMessage {
  phone: true;
}

export type MeshReply =
  | { id: number; ok: true; mesh: FusedMesh; skin?: SkinWeights; labels?: VertexLabels }
  | { id: number; ok: false; error: string; cancelled?: boolean };

const scope = self as unknown as DedicatedWorkerGlobalScope;

let helpers: HelperLink[] = [];
let spread = true;
/** 正在算的任务；它作废了没有 */
let current = -1;
let dropped = false;

/** 让出一下，好把排着的消息（帮手交回来的、作废的）收进来。用端口不用 setTimeout：连着让好多次也不会被拖慢 */
const pause = (() => {
  const channel = new MessageChannel();
  const waiting: (() => void)[] = [];
  channel.port1.onmessage = () => waiting.shift()?.();
  return () =>
    new Promise<void>((resolve) => {
      waiting.push(resolve);
      channel.port2.postMessage(0);
    });
})();

function link(port: MessagePort): HelperLink {
  const helper: HelperLink = {
    send: (message, transfer = []) => port.postMessage(message, transfer),
    onReply: null,
  };
  port.onmessage = (event: MessageEvent<ChunkReply>) => helper.onReply?.(event.data);
  return helper;
}

scope.onmessage = (event: MessageEvent<MeshRequest | ShapesMessage | HairMessage | GenitalMessage | HelpersMessage | CancelMessage | SpreadMessage | PhoneMessage>) => {
  const data = event.data;
  if ('shapes' in data) installAnimeBody(data.shapes);
  else if ('hair' in data) installHairShape(data.hair, data.data);
  else if ('genital' in data) installGenital(data.genital);
  else if ('helpers' in data) helpers = data.helpers.map(link);
  else if ('cancel' in data) dropped ||= data.cancel === current;
  else if ('spread' in data) spread = data.spread;
  else if ('phone' in data) onPhone();
  else void serve(data);
};

async function serve(request: MeshRequest) {
  const { id } = request;
  current = id;
  dropped = false;
  const t0 = performance.now();
  try {
    const made = spread ? await fuseSpread(id, request, helpers, { cancelled: () => dropped, pause }) : runJob(request);
    if (!made) {
      const reply: MeshReply = { id, ok: false, error: '作废了', cancelled: true };
      scope.postMessage(reply);
      return;
    }
    const mesh = made.mesh;
    // 用时记整个任务的：分给帮手算的那段不在网格化里（界面照它决定拖动时先出粗的还是直接出预览）
    mesh.info.ms = performance.now() - t0;
    // 把大数组直接移交给主线程，不复制
    const transfer: Transferable[] = [mesh.positions.buffer, mesh.normals.buffer, mesh.quads.buffer, mesh.triangles.buffer];
    if (mesh.tris) transfer.push(mesh.tris.buffer);
    if (mesh.bound) transfer.push(mesh.bound.joints.buffer, mesh.bound.weights.buffer);
    const reply: MeshReply = { id, ok: true, mesh };
    if (made.skin) {
      reply.skin = made.skin;
      transfer.push(reply.skin.joints.buffer, reply.skin.weights.buffer);
    }
    if (made.labels) {
      reply.labels = made.labels;
      transfer.push(made.labels.first.buffer, made.labels.second.buffer, made.labels.mix.buffer);
    }
    scope.postMessage(reply, transfer);
  } catch (err) {
    const reply: MeshReply = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    scope.postMessage(reply);
  }
}
