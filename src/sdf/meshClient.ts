/**
 * 主线程这边和网格 Worker 打交道的小封装。
 * 一个 Worker 一次只算一个任务；预览用「只留最新」的排队方式：
 * 上一个还没算完时又来了新的，中间那些过时的直接丢掉。正在算的也可以作废（cancel），大活算到一半就停下。
 *
 * 几个网格 Worker 共用一组帮手线程（见 eval.worker.ts、parallel.ts）：头一个网格 Worker 起来时建好，
 * 每个网格 Worker 和每个帮手之间各开一条通道，活直接从网格 Worker 发给帮手，不经过这里。
 */
import type { HairShape } from '../hair/shapes';
import type { PortMessage } from './eval.worker';
import type { FuseJob, FuseResult } from './job';
import type { CancelMessage, GenitalMessage, HairMessage, HelpersMessage, MeshReply, MeshRequest, ShapesMessage, SpreadMessage } from './mesh.worker';

/** 采样好的形状（二次元素体）的数据。主线程载入以后交到这里，每个 Worker 接下一个任务之前先收到一份 */
let shapes: ArrayBuffer | null = null;
export function provideShapes(buffer: ArrayBuffer) {
  shapes = buffer;
  const message: ShapesMessage = { shapes };
  for (const helper of helpers ?? []) helper.postMessage(message);
}

/** 白模戴的头发的数据，一副一份。同样是主线程载入以后交到这里，每个 Worker 用到之前先收到 */
const hairs = new Map<HairShape, ArrayBuffer>();
export function provideHair(style: HairShape, buffer: ArrayBuffer) {
  hairs.set(style, buffer);
  const message: HairMessage = { hair: style, data: buffer };
  for (const helper of helpers ?? []) helper.postMessage(message);
}

/** 阴囊的格子。同样是主线程载入以后交到这里，每个 Worker 用到之前先收到 */
let genital: ArrayBuffer | null = null;
export function provideGenital(buffer: ArrayBuffer) {
  genital = buffer;
  const message: GenitalMessage = { genital };
  for (const helper of helpers ?? []) helper.postMessage(message);
}

/** 帮手线程；还没建是 null */
let helpers: Worker[] | null = null;

/** 开几个帮手：留两个核给界面和网格 Worker 自己；手机上最多 3 个（每个要多占一二十兆内存） */
function helperCount(): number {
  const cores = navigator.hardwareConcurrency || 2;
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return Math.max(0, Math.min(touch ? 3 : 6, cores - 2));
}

function startHelpers(): Worker[] {
  const made: Worker[] = [];
  try {
    for (let i = 0; i < helperCount(); i++) made.push(new Worker(new URL('./eval.worker.ts', import.meta.url), { type: 'module' }));
  } catch {
    // 开不了这么多线程：有几个用几个，一个都没有就网格 Worker 自己算
  }
  for (const helper of made) {
    if (shapes) {
      const message: ShapesMessage = { shapes };
      helper.postMessage(message);
    }
    for (const [hair, data] of hairs) {
      const message: HairMessage = { hair, data };
      helper.postMessage(message);
    }
    if (genital) {
      const message: GenitalMessage = { genital };
      helper.postMessage(message);
    }
  }
  return made;
}

/** 给一个网格 Worker 连上每个帮手：各开一条通道，一头给帮手，一头给它 */
function helperPorts(): MessagePort[] {
  helpers ??= startHelpers();
  return helpers.map((helper) => {
    const channel = new MessageChannel();
    const message: PortMessage = { port: channel.port2 };
    helper.postMessage(message, [channel.port2]);
    return channel.port1;
  });
}

/** 现在活着的网格 Worker；分不分给帮手（开发时对比用，见 spreadWork） */
const live = new Set<Worker>();
let spreading = true;

/** 开发时对比用：false 是每个任务都一个网格 Worker 从头算，不分给帮手、不一份一份地算 */
export function spreadWork(on: boolean) {
  spreading = on;
  const message: SpreadMessage = { spread: on };
  for (const worker of live) worker.postMessage(message);
}

/** 一个融合任务（见 job.ts）。pose 按部件自己的单位 */
export type MeshJob = FuseJob;
export type MeshResult = FuseResult;

interface Waiting {
  job: MeshJob;
  resolve: (result: MeshResult) => void;
  reject: (err: Error) => void;
}

/** 被更新的任务顶替掉时抛出的错误；调用方通常直接忽略 */
export class Superseded extends Error {
  constructor() {
    super('superseded');
  }
}

export class MeshClient {
  private worker: Worker | null = null;
  private running: Waiting | null = null;
  private next: Waiting | null = null;
  private id = 0;
  /** 形状数据给过这个 Worker 了没有 */
  private shapesSent = false;
  /** 哪几副头发的数据给过这个 Worker 了 */
  private hairsSent = new Set<HairShape>();
  /** 阴囊的数据给过这个 Worker 了没有 */
  private genitalSent = false;

  private start(): Worker {
    const worker = new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<MeshReply>) => {
      const done = this.running;
      this.running = null;
      if (done && event.data.id === this.id) {
        if (event.data.ok) done.resolve({ mesh: event.data.mesh, skin: event.data.skin });
        else done.reject(event.data.cancelled ? new Superseded() : new Error(event.data.error));
      }
      this.pump();
    };
    live.add(worker);
    if (!spreading) {
      const message: SpreadMessage = { spread: false };
      worker.postMessage(message);
    }
    const ports = helperPorts();
    if (ports.length) {
      const message: HelpersMessage = { helpers: ports };
      worker.postMessage(message, ports);
    }
    worker.onerror = (event) => {
      const done = this.running;
      this.running = null;
      done?.reject(new Error(event.message || '网格线程出错'));
      this.pump();
    };
    return worker;
  }

  private pump() {
    if (this.running || !this.next) return;
    this.running = this.next;
    this.next = null;
    this.worker ??= this.start();
    if (shapes && !this.shapesSent) {
      // 消息是按顺序处理的：这一条一定排在下面那个任务前面
      const message: ShapesMessage = { shapes };
      this.worker.postMessage(message);
      this.shapesSent = true;
    }
    for (const [hair, data] of hairs) {
      if (this.hairsSent.has(hair)) continue;
      const message: HairMessage = { hair, data };
      this.worker.postMessage(message);
      this.hairsSent.add(hair);
    }
    if (genital && !this.genitalSent) {
      const message: GenitalMessage = { genital };
      this.worker.postMessage(message);
      this.genitalSent = true;
    }
    const request: MeshRequest = { id: ++this.id, ...this.running.job };
    this.worker.postMessage(request);
  }

  /** 排一个任务。还在排队（没开始算）的旧任务会被顶替掉，它的 Promise 以 Superseded 结束。 */
  run(job: MeshJob): Promise<MeshResult> {
    return new Promise((resolve, reject) => {
      this.next?.reject(new Superseded());
      this.next = { job, resolve, reject };
      this.pump();
    });
  }

  /**
   * 作废：排着的、正在算的任务（when 说是的那些）不要了，它们的 Promise 以 Superseded 结束。
   * 正在算的大活算到一半就停下，后面排的能早点开始；小活停不下来，照常算完（结果调用方本来就会丢掉）
   */
  cancel(when: (job: MeshJob) => boolean = () => true) {
    if (this.next && when(this.next.job)) {
      this.next.reject(new Superseded());
      this.next = null;
    }
    if (this.running && this.worker && when(this.running.job)) {
      const message: CancelMessage = { cancel: this.id };
      this.worker.postMessage(message);
    }
  }
}
