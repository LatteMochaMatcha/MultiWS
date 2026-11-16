/**
 * 体块：缝合——把一个部件（连同长在它上面的）接到另一个部件上（见 docs/blocks-plan.md、model/spec.ts 的 Attached）。
 * 这里是摆好的 Figure 上的那一半：改父部件、换成接上去时记下的摆放、骨骼改接；设定上怎么接、怎么解开见 model/attach.ts。
 * 纯函数，不碰 three.js 和 DOM。
 */
import type { Attached } from '../model/spec';
import { domed, isMoundBone, loose, withMoundBone } from './clone';
import { isRibcage } from './pelvis';
import { socketMap } from './sockets';
import { add } from './vec';
import { type Figure, type Part, worldTransforms } from './figure';
import { hostBoneAt } from './hostBone';

type Attach = Readonly<Record<string, Attached>>;

/** 最多往上数这么多层父部件：万一绕成了圈也停得下来 */
const DEEP = 32;

/** name 是不是 ancestor 自己、或者长在它上面（往上数任何一层） */
function under(parentOf: ReadonlyMap<string, string | undefined>, name: string, ancestor: string): boolean {
  for (let at: string | undefined = name, guard = 0; at !== undefined && guard < DEEP; at = parentOf.get(at), guard++) if (at === ancestor) return true;
  return false;
}

/** 这副身体上现在起作用的那几条缝合：两头的部件都在，而且不会绕成圈（接到自己、或者长在自己上面的部件上）。照设定里的先后一条条认 */
export function liveAttach(figure: Pick<Figure, 'parts'>, attach: Attach | undefined): Map<string, Attached> {
  const live = new Map<string, Attached>();
  if (!attach) return live;
  const parentOf = new Map(figure.parts.map((p) => [p.name, p.parent]));
  for (const [name, a] of Object.entries(attach)) {
    if (!parentOf.has(name) || !parentOf.has(a.to) || under(parentOf, a.to, name)) continue;
    parentOf.set(name, a.to);
    live.set(name, a);
  }
  return live;
}

/**
 * 胸腔（躯干分成两块时复制出来的，见 clone.ts）接到 host 上：host 是一块胯的话，它还是从胯上渐渐分出去的（腰照旧由 torsos.ts 的 refork 接顺，
 * 只是换了一块胯）；接到别的部件上，它就是一整块跟着那个部件走——不再从胯上长出来，底下垫一个圆顶
 */
function onto(ribcage: Part, host: Part | undefined): Part {
  if (host && host.type === 'torso' && !isRibcage(host)) return ribcage;
  const { pivot: _pivot, ...rest } = ribcage;
  return domed({ ...rest, prims: rest.prims.map((q) => (q.kind === 'grid' || q.kind === 'loft' ? { ...q, fork: undefined } : q)) }, 'bottom');
}

/** 排成父部件都在子部件前面（worldTransforms 要这个顺序），别的先后不变 */
function parentsFirst(parts: readonly Part[]): Part[] {
  const out: Part[] = [];
  const placed = new Set<string>();
  let rest = [...parts];
  while (rest.length) {
    const later: Part[] = [];
    for (const p of rest) {
      if (p.parent === undefined || placed.has(p.parent)) {
        out.push(p);
        placed.add(p.name);
      } else later.push(p);
    }
    // 父部件不在的（不该有）：照原样接在后面，不死循环
    if (later.length === rest.length) return [...out, ...later];
    rest = later;
  }
  return out;
}

/**
 * 把缝合套到摆好的 Figure 上（在套手动微调之前）：接出去的部件改挂到新的父部件上、换成记下的摆放；
 * 照原位做的形状换成能摆到别处的（素体的手臂、脖子、贴着表面的胸，见 clone.ts 的 loose）；骨骼先接到新的父部件上离它最近的那根
 * （套完微调以后再照最后的位置定一遍，见 rehost）。没有起作用的缝合时原样返回传进来的那个 Figure
 */
export function withAttach(figure: Figure, attach: Attach | undefined): Figure {
  const live = liveAttach(figure, attach);
  if (!live.size) return figure;
  const taken = new Set(figure.parts.flatMap((p) => (p.bones ?? []).map((b) => b.name)));
  const byName = new Map(figure.parts.map((p) => [p.name, p]));
  // 吸在接口上的（见 sockets.ts）：位置照接口现在在哪算，接口不在了照记下的位置
  const sockets = [...live.values()].some((a) => a.socket !== undefined) ? socketMap(figure.parts) : undefined;
  const moved = figure.parts.map((p): Part => {
    const a = live.get(p.name);
    if (!a) return p;
    const { scale: _scale, ...rest } = isRibcage(p) ? onto(p, byName.get(a.to)) : loose(p);
    const socket = a.socket === undefined ? undefined : sockets?.get(a.to)?.find((s) => s.id === a.socket);
    const pos = socket ? add(socket.pos, a.offset ?? [0, 0, 0]) : a.pos;
    return { ...rest, parent: a.to, pos, quat: a.quat, ...(Math.abs(a.scale - 1) > 1e-12 ? { scale: a.scale } : {}) };
  });
  const parts = parentsFirst(moved);
  const xfs = worldTransforms({ parts, scale: 1 });
  // 接出去的胸原来没有骨骼的：带上自己的一根（见 clone.ts 的 withMoundBone）
  const boned = parts.map((p) => (live.has(p.name) ? withMoundBone(p, hostBoneAt(parts, xfs, p.parent, p.pos), taken) : p));
  return rehost({ ...figure, parts: boned }, new Set(live.keys()));
}

/**
 * 接出去的部件、复制出来的胸，骨骼该接在哪：它现在底下那块身体（父部件，没有骨骼就再往上）离它最近的那根骨骼。
 * 套手动微调前后各定一遍（挪到别处以后改接）。只改这些部件「根上」的骨骼：父骨骼不在这个部件自己里面、也不在和它接在同一个部件上的
 * 另一个接出去的部件里的那些（头的骨骼接着它自己的脖子，一起接出去以后还是接着那根脖子）。
 * 改接会让骨骼绕成圈的不改。没有要改的时候原样返回传进来的那个 Figure
 */
export function rehost(figure: Figure, attached: ReadonlySet<string>): Figure {
  const mine = (p: Part) => attached.has(p.name) || (p.type === 'chest' && p.bones?.length === 1 && isMoundBone(p.bones[0].name));
  if (!figure.parts.some(mine)) return figure;
  const xfs = worldTransforms({ parts: figure.parts, scale: 1 });
  const owner = new Map<string, Part>();
  const boneParent = new Map<string, string | undefined>();
  for (const p of figure.parts) for (const b of p.bones ?? []) {
    owner.set(b.name, p);
    boneParent.set(b.name, b.parent);
  }
  const partParent = new Map(figure.parts.map((p) => [p.name, p.parent]));
  let changed = false;
  const parts = figure.parts.map((part) => {
    if (!mine(part) || !part.bones?.length) return part;
    const own = new Set(part.bones.map((b) => b.name));
    /** 长在这个部件上的那些部件的骨骼不能当它的父骨骼（不然绕成圈） */
    const below = (bone: string) => {
      const at = owner.get(bone);
      return at !== undefined && under(partParent, at.name, part.name);
    };
    const host = hostBoneAt(figure.parts, xfs, part.parent, part.pos, below);
    if (host === undefined) return part;
    // host 往上数到根，路上不能有这个部件自己的骨骼
    for (let up: string | undefined = host, guard = 0; up !== undefined && guard < 4096; up = boneParent.get(up), guard++) if (own.has(up)) return part;
    let touched = false;
    const bones = part.bones.map((b) => {
      const from = b.parent === undefined ? undefined : owner.get(b.parent);
      // 父骨骼在自己里面、或者在一起接到同一个部件上的另一个部件里（头接着自己的脖子）：不动
      const kept = b.parent !== undefined && (own.has(b.parent) || (from !== undefined && from !== part && attached.has(from.name) && from.parent === part.parent));
      if (kept || b.parent === host) return b;
      touched = true;
      return { ...b, parent: host };
    });
    if (!touched) return part;
    changed = true;
    return { ...part, bones };
  });
  return changed ? { ...figure, parts } : figure;
}
