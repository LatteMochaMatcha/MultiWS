/**
 * 体块：把摆好的 Figure 里的一个部件（连同长在它上面的）复制一份，名字、骨骼用单独的号段（见 docs/blocks-plan.md）。
 * 纯函数，不碰 three.js 和 DOM。
 *
 * 复制出来的部件接在和原来那个一样的父部件上，骨骼也接在同一根父骨骼上；之后和别的部件一样套手动微调。
 * 多个上半身（torsos.ts）、围成一圈（ring.ts）、连体（conjoined.ts）各有自己的一套复制改名，这里不动它们。
 */
import type { AddedBlock, PartOverride } from '../model/spec';
import { chestBulk } from '../anime/chest';
import { plainNeck } from './animeLayout';
import { castRay, compileField } from '../sdf/field';
import { type BoneHint, type ChestShape, type Figure, type Graft, type Part, type Prim, nthName, shapeMatrix, worldTransforms } from './figure';
import { BONE_FIRST, BONE_LAST, BONE_STEP, ordinal } from './cloneNames';
import { hostBoneAt } from './hostBone';
import { isPelvis, isRibcage, isSplit, pelvisOf } from './pelvis';
import { forkWarp } from '../sdf/fork';
import { type V3, Q_ID, add, mul, quatBasis, quatConj, quatMul, rotate, sub } from './vec';

/**
 * 复制出来的部件用的号：第 id 块是 100·id 加上原来的号（Arm_02_L 的第 1 份是 Arm_102_L）。
 * 照数量设定排出来的部件到不了这么大的号，以后改了数量也不会和手工加的撞名
 */
const NUMBER_STEP = 100;

/** 部件名里最后一个编号：Arm_02_L → 「Arm_」「02」「_L」，Head_01_Eye_03_R → 「Head_01_Eye_」「03」「_R」 */
const LAST_NUMBER = /^(.*_)(\d+)((?:_[A-Za-z]+)*)$/;

/**
 * 第 id 块里照 from 复制出来的那个部件叫什么。名字里没有编号的（胸腔 UpperBody、胯 Torso、下身 LowerBody、Hip_L）
 * 在左右的后缀前面加上这一块的第一个号：UpperBody_101、Torso_101、Hip_101_L
 */
export function cloneRootName(from: string, id: number): string {
  const m = LAST_NUMBER.exec(from);
  if (m) return `${m[1]}${String(NUMBER_STEP * id + (Number(m[2]) % NUMBER_STEP)).padStart(2, '0')}${m[3]}`;
  const [, base, side] = /^(.*?)((?:_[LR])?)$/.exec(from)!;
  return `${base}_${NUMBER_STEP * id + 1}${side}`;
}

/** 名字被占了的话，把最后一个编号往后挪到没被占的 */
function freeName(name: string, taken: ReadonlySet<string>): string {
  let out = name;
  for (let guard = 0; taken.has(out) && guard < 1000; guard++) {
    const m = LAST_NUMBER.exec(out);
    if (!m) return out;
    out = `${m[1]}${String(Number(m[2]) + 1).padStart(2, '0')}${m[3]}`;
  }
  return out;
}

/** 复制头的时候带上它底下那根脖子（脖子和头是并排挂在躯干上的，照名字认，和 tweak.ts 的 headOf 一个规矩） */
const neckOf = (head: Part): string | null => (head.type === 'head' && /^Head_\d+$/.test(head.name) ? head.name.replace('Head_', 'Neck_') : null);

/**
 * 一块里有哪些部件：from 自己、长在它上面的（往下任何一层）、头底下的脖子；
 * 胯（躯干分成两块时，见 pelvis.ts）带着跟着它的腿、尾巴、垫在腿根上的那些。照 Figure 里的先后排
 */
function blockParts(parts: readonly Part[], source: Part): Part[] {
  const inside = new Set([source.name]);
  const neck = neckOf(source);
  if (isSplit(parts) && isPelvis(source)) for (const [name, pelvis] of pelvisOf(parts)) if (pelvis === source.name) inside.add(name);
  for (const p of parts) {
    if (p.parent !== undefined && inside.has(p.parent)) inside.add(p.name);
    else if (neck !== null && p.name === neck && p.parent === source.parent) inside.add(p.name);
  }
  return parts.filter((p) => inside.has(p.name));
}

/** 躯干分成两块时能复制的那两种躯干：胸腔（不挂在别的部件上的）和胯 */
export const isTorsoBlock = (parts: readonly Part[], part: Part): boolean =>
  isSplit(parts) && part.type === 'torso' && part.parent === undefined && (isRibcage(part) || isPelvis(part));

/** 复制出来的胯顶上垫的圆顶高多少、和胯融合的圆角多大（米） */
const DOME = { height: 0.05, soft: 0.012 };

/**
 * 切开的躯干在切面上垫一个圆顶：胯是从腰上切下来的，顶上（top）是一个平的切面，原来那块上面接着胸腔，复制出来的上面什么都没有；
 * 胸腔不再从胯上长出来的时候（接到了别的部件上，见 attach.ts）底下（bottom）也是。
 * 量切面那么高上有多宽、多厚，垫一个一样大的扁椭球
 */
export function domed(part: Part, end: 'top' | 'bottom' = 'top'): Part {
  const cuts = part.prims.flatMap((q) =>
    q.kind === 'loft'
      ? [end === 'top' ? q.rings[q.rings.length - 1].y : q.rings[0].y]
      : q.kind === 'grid'
        ? (end === 'top' ? [q.clipAbove] : [q.clipBelow]).filter((v): v is number => v !== undefined)
        : [],
  );
  if (!cuts.length) return part;
  const y = end === 'top' ? Math.max(...cuts) - 0.004 : Math.min(...cuts) + 0.004;
  const field = compileField({ scale: 1, parts: [{ ...part, parent: undefined, pos: [0, 0, 0], quat: Q_ID, scale: 1 }] }, { blend: 0 });
  const FAR = 0.8;
  const hit = (from: V3, dir: V3) => FAR - castRay(field, from, dir, FAR);
  const front = hit([0, y, FAR], [0, 0, -1]);
  const back = -hit([0, y, -FAR], [0, 0, 1]);
  const z = (front + back) / 2;
  const wide = (hit([FAR, y, z], [-1, 0, 0]) + hit([-FAR, y, z], [1, 0, 0])) / 2;
  const deep = (front - back) / 2;
  if (!(wide > 0.01) || !(deep > 0.01)) return part;
  return { ...part, prims: [...part.prims, { kind: 'ellipsoid', name: 'Dome', center: [0, y, z], radii: [wide, DOME.height, deep], soft: DOME.soft }] };
}

/** 复制出来的胸最少鼓出来这么多（米）：平胸照公式算是 0，椭球不能是扁的 */
const MOUND_LEAST = 0.004;

/**
 * 贴在躯干表面上的胸换成一个自己成形的圆包：和这只胸一样宽、鼓出来一样高（anime/chest.ts 的 chestBulk，再乘它沿表面、往外的缩放），
 * 一半埋在身体里。贴着表面的那种胸型是照胸口那一片皮做的，带着周围一大片皮：挪到肚子、后背上就是一块支着边的板
 * （「只取胸根以内」的 ChestShape.piece 也带着这片皮，围成一圈时是一只挨一只排满才看不出来）
 */
function mound(q: ChestShape): Prim {
  const { radius, depth } = chestBulk(q.size);
  const [sx, sy, sz] = q.scale ?? [1, 1, 1];
  return { kind: 'ellipsoid', name: q.name, center: [0, 0, 0], radii: [radius * sx, radius * 0.96 * sy, Math.max(depth * sz, MOUND_LEAST)] };
}

/**
 * 点明了保持原胸型的胸（AddedBlock.piece）是坐进身体表面、一只挨一只排满的，和底下的胯、旁边的胸腔、肩膀底下的手臂根挨着是摆出来的样子：
 * 穿模检查不算（Part.rootFree 给得比整个人还大，和围成一圈里坐在芯子上的胸一样，见 ring.ts 的 EMBEDDED）
 */
const PIECE_FREE = 10;

/**
 * 复制出来的部件不在原来那个位置上，照原位做的形状要换成能摆到别处的：
 * - 贴在躯干表面上的胸（二次元素体）：不贴表面，换成一个圆包（见 mound），和别的部件一样随便挪、转、缩放；
 * - 长在素体本来的肩膀上的手臂：根上连着一圈腋下的皮，挪到别处会支出一圈毛边。换成它举高时用的那一套
 *   （根部切掉、切口上垫一个圆肩头，见 Part.posed）；
 * - 素体原位的脖子：根上带着一圈肩膀的喇叭口。换成几个头时斜着伸出去的那种光溜的圆台（animeLayout.ts 的 plainNeck）；
 * - 素体上从同一个模型切下来、还在原位的那几块（头、脖子、手臂、腿）是当成躯干的一部分直接拼的（fuseAs）：
 *   挪开以后对不上原来的切口，改回圆滑地融进去
 */
export function loose(part: Part, piece = false): Part {
  const { fuseAs, ...rest } = part;
  // 保持原胸型的（AddedBlock.piece）：只取胸根以内的那一块整只搬走，还和躯干算同一类直接取并集——
  // 算成别的类，胸根和底下的身体几乎重合的那一片之间出圆角，整片顶起来像一块盾牌（见 ring.ts 的 strung）
  if (piece && part.surface && part.prims.some((q) => q.kind === 'chest')) {
    return { ...part, surface: false, rootFree: PIECE_FREE, prims: part.prims.map((q) => (q.kind === 'chest' ? { ...q, piece: true } : q)) };
  }
  // 白模人台的胸本来就是一个圆包，没有「原胸型」这回事；点明了 piece 的也是一只挨一只坐在身体上的，穿模检查一样不算
  if (piece && part.type === 'chest') return { ...part, rootFree: PIECE_FREE };
  const free: Part = fuseAs === 'torso' && part.type !== 'torso' ? rest : part;
  if (free.surface) return { ...free, surface: false, prims: free.prims.map((q) => (q.kind === 'chest' ? mound(q) : q)) };
  if (free.type === 'arm' && free.posed) {
    const { posed, ...arm } = free;
    return { ...arm, prims: posed.prims };
  }
  const span = free.bones?.[0]?.tail;
  if (free.type === 'neck' && span && free.prims.some((q) => q.kind === 'grid')) return { ...free, prims: plainNeck(span) };
  return free;
}

/** 把一块复制进去；照着的那个部件现在不在、或者名字排不开，就原样返回 */
function cloneBlock(figure: Figure, block: AddedBlock): Figure {
  const source = figure.parts.find((p) => p.name === block.from);
  if (!source) return figure;
  // 躯干只有分成两块以后的胸腔、胯能复制
  const torso = source.type === 'torso';
  if (torso && !isTorsoBlock(figure.parts, source)) return figure;
  const rootName = cloneRootName(block.from, block.id);
  const sources = blockParts(figure.parts, source);

  /* ---- 部件名 ---- */
  const partTaken = new Set(figure.parts.map((p) => p.name));
  const partName = new Map<string, string>();
  for (const p of sources) {
    const parent = p.parent === undefined ? undefined : partName.get(p.parent);
    const name =
      p === source
        ? rootName
        : // 长在上面的照父部件的名字改：Head_01_Eye_01_L → Head_101_Eye_01_L
          parent !== undefined && p.name.startsWith(`${p.parent}_`)
          ? parent + p.name.slice(p.parent!.length)
          : // 名字不跟着父部件的（头底下的脖子、同一个头上多出来的脸、胸腔上的手臂）：照自己的号改。
            // 这一块里有两个部件落到同一个号上的（胸腔上既有 Arm_01_L、又有以前复制出来的 Arm_101_L），后一个往后挪到没被占的号
            freeName(cloneRootName(p.name, block.id), partTaken);
    if (partTaken.has(name)) return figure;
    partTaken.add(name);
    partName.set(p.name, name);
  }

  /* ---- 骨骼名 ---- */
  const boneTaken = new Set(figure.parts.flatMap((p) => (p.bones ?? []).map((b) => b.name)));
  const boneName = new Map<string, string>();
  const first = BONE_FIRST + BONE_STEP * ((block.id - 1) % Math.floor((BONE_LAST - BONE_FIRST + 1) / BONE_STEP));
  for (const p of sources) {
    for (const b of p.bones ?? []) {
      let name: string | null = null;
      if (b.name.startsWith(p.name)) {
        // 名字跟着部件走的骨骼（Tail_01_03、Wing_02_L、Penis_01_02）
        name = partName.get(p.name)! + b.name.slice(p.name.length);
        if (boneTaken.has(name)) name = null;
      } else {
        const [base, index] = ordinal(b.name);
        // 这一块的号段里被占了的往后挪；挪到头了从号段开头接着找
        for (let n = 0, at = first + (index % BONE_STEP); n <= BONE_LAST - BONE_FIRST; n++, at = at >= BONE_LAST ? BONE_FIRST : at + 1) {
          const candidate = nthName(base, at);
          if (!boneTaken.has(candidate)) {
            name = candidate;
            break;
          }
        }
      }
      if (name === null) return figure;
      boneTaken.add(name);
      boneName.set(b.name, name);
    }
  }
  const bone = (name: string) => boneName.get(name) ?? name;
  const xfs = worldTransforms({ parts: figure.parts, scale: 1 });

  const clones = sources.map((p): Part => {
    /** 这一块里领头的（父部件在这一块外面的：要复制的那个、头底下的脖子、胯带着的腿） */
    const top = p.parent === undefined || !partName.has(p.parent);
    // 复制胸腔、胯的时候整块连同上面长的都照原样（它们相互之间还在原位）；别的部件领头的那几个换成能摆到别处的形状
    const shaped = torso ? (p === source && isPelvis(p) ? domed(p) : p) : top ? loose(p, block.piece) : p;
    const out: Part = { ...shaped, name: partName.get(p.name)! };
    if (p.parent !== undefined) out.parent = partName.get(p.parent) ?? p.parent;
    // 挪开：领头的那些一起挪，长在它们上面的跟着走
    if (block.shift && top) out.pos = add(p.pos, block.shift);
    // 骨架只能有一根根骨骼：复制出来的 Hips 接在原来那根 Hips 上
    if (p.bones) out.bones = p.bones.map((b): BoneHint => ({ ...b, name: bone(b.name), parent: b.parent !== undefined ? bone(b.parent) : b.name }));
    if (p.grafts) {
      out.grafts = p.grafts.map(
        (g): Graft => ({ ...g, bones: Object.fromEntries(Object.entries(g.bones).map(([mesh, name]) => [mesh, bone(name)])), rigid: g.rigid.map(bone) }),
      );
    }
    // 复制出来的胸自己带一根骨骼（见 MOUND_BONE）；跟着胸腔一起复制的胸还贴在它自己那块胸腔上，不带
    return torso ? out : withMoundBone(out, hostBoneAt(figure.parts, xfs, out.parent, out.pos), boneTaken, first);
  });
  // 排在最后：父部件（原来就有的、或者这一块里排在前面的）都在它们前面
  return { ...figure, parts: [...figure.parts, ...clones] };
}

/**
 * 复制出来的胸自己带一根骨骼（Bust_L.101），接在它底下那块身体离它最近的那根骨骼上。
 * 胸本来没有骨骼，蒙皮时跟着躯干的几节脊柱一起弯：长在胸口的弯腰时被挤着，看不大出来；挪到背上的鼓出去离脊柱很远，
 * 一弯腰就被几节脊柱扯开，鼓成一个大球（素体的胸放到 1.6、蹲着时，胸那一片从 13.6 厘米被撑到 18.7 厘米）。
 * 有了自己的骨骼，整只胸跟着一根骨骼走，不变形；摆姿势时还能单独转它
 */
const MOUND_BONE = 'Bust';
export const isMoundBone = (name: string) => /^Bust(_[LR])?\.\d{3}$/.test(name);

/** 胸鼓出来多高（它自己的 +Z 方向）：骨骼就伸这么长 */
function moundReach(part: Part): number {
  const q = part.prims.find((p) => p.kind === 'ellipsoid' && !p.cut);
  return q?.kind === 'ellipsoid' ? Math.max(q.radii[2], MOUND_LEAST) : 0.03;
}

/**
 * 整只搬过去的胸（AddedBlock.piece）贴着的那块躯干不带「从胯上分出去的那一段」（Fork）。
 * torsos.ts 的 refork 给每只胸各记一个高度（Fork.freeze，照胸现在摆在多高）：分出去的那一段照这个高度上转、挪了多少整块退回去，
 * 是一个不变形的转动加挪动。同一个胸腔上的十几只胸摆在不同的高度，形状的参数就各不一样，要各烤一份
 * （sdf/grids.ts 的 chestDist，一份十几 MB、两秒）：楚云萱三十只胸有十六种，缓存装不下，每融合一次、每套一个姿势都在重烤。
 * 这里把那个转动、挪动算出来挪到部件自己的摆放上，形状里不留——摆出来和原来一模一样，三十只是同一种形状。
 * 在 refork 之后做（见 layout.ts 的 buildFigure）。部件被压扁拉长过的、分叉带着别的坐标系或者和旁边的上半身有分界的照旧不动
 */
export function plainPieces(figure: Figure): Figure {
  const out = new Float64Array(4);
  let changed = false;
  const parts = figure.parts.map((part): Part => {
    const shape = part.type === 'chest' ? part.prims.find((q): q is ChestShape => q.kind === 'chest') : undefined;
    const fork = shape?.piece ? shape.body.fork : undefined;
    if (!shape || !fork || fork.freeze === undefined || fork.frame || fork.split?.length || shapeMatrix(part)) return part;
    // 胸腔里的一点 x 退回去是 R·x + t：照四个点量出来
    const warp = forkWarp(fork);
    const at = (x: number, y: number, z: number): V3 => {
      warp.map(x, y, z, out);
      return [out[0], out[1], out[2]];
    };
    const t = at(0, 0, 0);
    const turn = quatBasis(sub(at(1, 0, 0), t), sub(at(0, 1, 0), t), sub(at(0, 0, 1), t));
    const back = quatConj(turn);
    // 部件里的一点 p 原来量的是 d(R·(p + o) + t)，现在量 d(p′ + o)：p′ = R·(p + o) + t − o，部件的摆放跟着换
    const quat = part.quat ?? Q_ID;
    const o = shape.origin;
    const pos = add(part.pos, rotate(quat, mul(sub(rotate(back, sub(o, t)), o), part.scale ?? 1)));
    changed = true;
    return {
      ...part,
      pos,
      quat: quatMul(quat, back),
      prims: part.prims.map((q): Prim => (q === shape ? { ...q, body: { ...q.body, fork: undefined } } : q)),
    };
  });
  return changed ? { ...figure, parts } : figure;
}

/**
 * 没有骨骼的胸带上自己的那根骨骼（接在 host 这根上；host 没有就不带）。名字从这一类骨骼的第 from 个起找没被占的，占上记进 taken。
 * 之后套完手动微调，它被挪到了别处的话骨骼会改接到现在离它最近的那根上（见 attach.ts 的 rehost）
 */
export function withMoundBone(part: Part, host: string | undefined, taken: Set<string>, from = BONE_FIRST): Part {
  if (part.type !== 'chest' || part.bones?.length || host === undefined) return part;
  const base = part.side > 0 ? `${MOUND_BONE}_L` : part.side < 0 ? `${MOUND_BONE}_R` : MOUND_BONE;
  for (let at = from; at <= BONE_LAST; at++) {
    const name = nthName(base, at);
    if (taken.has(name)) continue;
    taken.add(name);
    return { ...part, bones: [{ name, parent: host, head: [0, 0, 0], tail: [0, 0, moundReach(part)] }] };
  }
  return part;
}

/**
 * 把手工加的体块复制进摆好的 Figure（在套手动微调之前）。照 added 的先后一块一块来：后面的可以照前面复制出来的再复制。
 * 一块也没有时原样返回传进来的那个 Figure
 */
export function withBlocks(figure: Figure, added: readonly AddedBlock[] | undefined, overrides: Readonly<Record<string, PartOverride>> = {}): Figure {
  if (!added?.length) return figure;
  const made = added.reduce(cloneBlock, figure);
  if (made === figure) return figure;
  // 跟着胸腔一起复制出来的、还贴在躯干表面上的胸：手动微调照摆位时的办法换算进它的形状里（原来那些是 animeLayout.ts 摆位时换算的）
  const was = new Set(figure.parts.map((p) => p.name));
  return { ...made, parts: made.parts.map((p) => (!was.has(p.name) && p.surface && overrides[p.name] ? onSurface(p, overrides[p.name]) : p)) };
}

/**
 * 贴在躯干表面上的胸照一条手动微调改：不挪这个部件（见 Part.surface），换算成沿表面的——往外（离正中线）、往上、往前挪，
 * 沿表面横、竖、往外放大，转（和 animeLayout.ts 摆位时给原来那些胸换算的办法一样，叠在它本来就有的上面）
 */
function onSurface(part: Part, o: PartOverride): Part {
  const move = o.position ?? [0, 0, 0];
  const pos: V3 = [part.pos[0] + move[0], part.pos[1] + move[1], part.pos[2] + move[2]];
  return {
    ...part,
    pos,
    prims: part.prims.map((q): Prim => {
      if (q.kind !== 'chest') return q;
      const shift = q.shift ?? [0, 0, 0];
      const scale = q.scale ?? [1, 1, 1];
      const tilt = q.tilt ?? [0, 0, 0];
      return {
        ...q,
        origin: pos,
        ...(o.position ? { shift: [shift[0] + move[0] * q.side, shift[1] + move[1], shift[2] + move[2]] as V3 } : {}),
        ...(o.scale ? { scale: [scale[0] * o.scale[0], scale[1] * o.scale[1], scale[2] * o.scale[2]] as V3 } : {}),
        ...(o.rotation ? { tilt: [tilt[0] + o.rotation[0], tilt[1] + o.rotation[1], tilt[2] + o.rotation[2]] as V3 } : {}),
      };
    }),
  };
}

/** 第 id 块里的部件现在都叫什么（照 from 复制出来的那个排第一个）；这一块现在不在就是空的 */
export function blockNames(figure: Pick<Figure, 'parts'>, root: string): string[] {
  const part = figure.parts.find((p) => p.name === root);
  return part ? blockParts(figure.parts, part).map((p) => p.name) : [];
}
