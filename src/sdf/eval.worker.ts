/**
 * 帮手线程：帮网格 Worker 算一份一份的活（见 parallel.ts）：小块的格点上求值、算权重的第 1 步和第 3 步。
 * 界面那边建好以后给它几个端口，每个端口连着一个网格 Worker；活从端口来，算好从同一个端口交回去。
 * 场、算权重要用的那些照任务自己准备（和网格 Worker 准备的一模一样），同一个任务后面几份活接着用。
 */
import { installAnimeBody } from '../anime/body';
import { installHairShape } from '../hair/shapes';
import type { HairMessage, ShapesMessage } from './mesh.worker';
import { type ChunkDrop, type ChunkRequest, type SkinRequest, helperDesk } from './parallel';

/** 界面送来的：一个连着网格 Worker 的端口 */
export interface PortMessage {
  port: MessagePort;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<ShapesMessage | HairMessage | PortMessage>) => {
  const data = event.data;
  if ('shapes' in data) installAnimeBody(data.shapes);
  else if ('hair' in data) installHairShape(data.hair, data.data);
  else if ('port' in data) listen(data.port);
};

function listen(port: MessagePort) {
  // 每个端口（网格 Worker）各管各的任务
  const desk = helperDesk();
  port.onmessage = (event: MessageEvent<ChunkRequest | SkinRequest | ChunkDrop>) => {
    const done = desk(event.data);
    if (done) port.postMessage(done.reply, done.transfer);
  };
}
