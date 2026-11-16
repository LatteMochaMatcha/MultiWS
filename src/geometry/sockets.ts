/**
 * 体块：连接点（接口）——每个部件上能把别的部件接上去的那些点（见 docs/blocks-plan.md 第 5 期）。
 * 接口不另外量，都从已有的数据来：部件自己的骨骼关节，和本来就长在它上面的部件的根（肩、髋、脖子根、尾巴根……）。
 * 把一个部件接到另一个部件上（attach.ts）时可以吸到接口上；记的是接口的名字，以后体型、数量变了接口挪了，接在上面的跟着挪。
 * 纯函数，不碰 three.js 和 DOM。
 */
import { type Part, type PartType, worldTransforms } from './figure';
import { type V3, mul, quatConj, rotate, sub } from './vec';

/** 接口是哪一种：骨骼的关节、骨骼的末端，或者某一类部件本来长的地方 */
export type SocketKind = 'joint' | 'tip' | 'shoulder' | 'hip' | 'neck' | 'tail' | 'wing' | 'chest' | 'detail';

export interface Socket {
  /** 在这个部件上不重名：j:骨骼名（关节）、t:骨骼名（末端）、p:部件名（那个部件本来长的地方） */
  id: string;
  kind: SocketKind;
  /** 在部件自己的坐标里（没算部件被拉伸的那一份，和挂在它上面的部件的 pos 一个意思） */
  pos: V3;
}

/** 这一类部件本来长的地方算哪种接口（头跟着脖子，不另算） */
const SITE: Partial<Record<PartType, SocketKind>> = {
  arm: 'shoulder',
  leg: 'hip',
  neck: 'neck',
  tail: 'tail',
  wing: 'wing',
  chest: 'chest',
  horn: 'detail',
  ear: 'detail',
  eye: 'detail',
};

/** 这一类部件最该接到哪几种接口上（吸附的时候优先；别的接口也能接） */
export const SOCKET_FOR: Partial<Record<PartType, readonly SocketKind[]>> = {
  arm: ['shoulder'],
  leg: ['hip'],
  head: ['neck'],
  tail: ['tail'],
  wing: ['wing', 'shoulder'],
  chest: ['chest'],
  horn: ['detail'],
  ear: ['detail'],
  eye: ['detail'],
};

/**
 * 各个部件上的接口：部件名 → 接口。照「还没套缝合」的那副身体算（attach.ts 的 withAttach 进来的那一份）：
 * 已经接到别处去的部件，它本来长的地方还是一个接口，别的部件可以接上去
 */
export function socketMap(parts: readonly Part[]): Map<string, Socket[]> {
  const out = new Map<string, Socket[]>();
  const push = (host: string, socket: Socket) => {
    const list = out.get(host);
    if (list) list.push(socket);
    else out.set(host, [socket]);
  };
  const owner = new Map<string, string>();
  for (const p of parts) for (const b of p.bones ?? []) owner.set(b.name, p.name);
  const xfs = worldTransforms({ parts: [...parts], scale: 1 });
  for (const p of parts) {
    // 自己的骨骼：每个关节一个，一串骨骼最末那一根的末端一个。手指、脚趾的不算（一只手十几个点挤在一起，也没有东西要接在指节上）：
    // 手那一节就是最末的一根，末端在指根
    const own = (p.bones ?? []).filter((b) => b.strand === undefined);
    const parents = new Set(own.map((b) => b.parent));
    for (const b of own) {
      push(p.name, { id: `j:${b.name}`, kind: 'joint', pos: b.head });
      if (!parents.has(b.name)) push(p.name, { id: `t:${b.name}`, kind: 'tip', pos: b.tail });
    }
    // 本来长在别的部件上的：它的根在那个部件上是一个接口
    const kind = SITE[p.type];
    if (!kind) continue;
    if (p.parent !== undefined) {
      push(p.parent, { id: `p:${p.name}`, kind, pos: p.pos });
      continue;
    }
    // 没有父部件的（腿、尾巴）：照它根上那根骨骼接在谁的骨骼上认
    const root = p.bones?.[0]?.parent;
    const host = root === undefined ? undefined : owner.get(root);
    const at = host === undefined ? undefined : xfs.get(host);
    const mine = xfs.get(p.name);
    if (host === undefined || host === p.name || !at || !mine) continue;
    push(host, { id: `p:${p.name}`, kind, pos: mul(rotate(quatConj(at.quat), sub(mine.pos, at.pos)), 1 / at.scale) });
  }
  return out;
}

/**
 * 离 at 最近的接口（at 和 sockets 里的 world 都是世界里的位置）：只看 reach 以内的；prefer 里的那几种算近一半（优先吸到对得上的接口）。
 * 没有够得着的是 undefined
 */
export function nearestSocket<T extends { kind: SocketKind; world: V3 }>(sockets: readonly T[], at: V3, reach: number, prefer: readonly SocketKind[] = []): T | undefined {
  let best: T | undefined;
  let least = Infinity;
  for (const s of sockets) {
    const far = Math.hypot(s.world[0] - at[0], s.world[1] - at[1], s.world[2] - at[2]);
    if (far > reach) continue;
    const score = prefer.includes(s.kind) ? far / 2 : far;
    if (score < least) {
      least = score;
      best = s;
    }
  }
  return best;
}
