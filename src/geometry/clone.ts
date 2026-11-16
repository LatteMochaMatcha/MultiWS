/**
 * 体块：把摆好的 Figure 里的一个部件（连同长在它上面的）复制一份，名字、骨骼用单独的号段（见 docs/blocks-plan.md）。
 * 纯函数，不碰 three.js 和 DOM。
 *
 * 复制出来的部件接在和原来那个一样的父部件上，骨骼也接在同一根父骨骼上；之后和别的部件一样套手动微调。
 * 多个上半身（torsos.ts）、围成一圈（ring.ts）、连体（conjoined.ts）各有自己的一套复制改名，这里不动它们。
 */
import type { AddedBlock } from '../model/spec';
import { chestBulk } from '../anime/chest';
import { plainNeck } from './animeLayout';
import { type BoneHint, type ChestShape, type Figure, type Graft, type Part, type Prim, nthName } from './figure';
import { add } from './vec';

/**
 * 复制出来的部件用的号：第 id 块是 100·id 加上原来的号（Arm_02_L 的第 1 份是 Arm_102_L）。
 * 照数量设定排出来的部件到不了这么大的号，以后改了数量也不会和手工加的撞名
 */
const NUMBER_STEP = 100;
/** 复制出来的骨骼的序号（UpperArm_L.101）：从第 100 个起，每块留 BONE_STEP 个。骨骼的序号只有三位（见 nthName），最多到 999 */
const BONE_FIRST = 100;
const BONE_STEP = 20;
const BONE_LAST = 998;

/** 部件名里最后一个编号：Arm_02_L → 「Arm_」「02」「_L」，Head_01_Eye_03_R → 「Head_01_Eye_」「03」「_R」 */
const LAST_NUMBER = /^(.*_)(\d+)((?:_[A-Za-z]+)*)$/;
/** 骨骼名 → 底名和第几个（Chest.002 → Chest、1） */
const ordinal = (name: string): [string, number] => {
  const m = /^(.*?)(?:\.(\d{3}))?$/.exec(name)!;
  return [m[1], m[2] ? Number(m[2]) - 1 : 0];
};

/** 第 id 块里照 from 复制出来的那个部件叫什么；名字里没有编号的（躯干、下身）复制不了，返回 null */
export function cloneRootName(from: string, id: number): string | null {
  const m = LAST_NUMBER.exec(from);
  if (!m) return null;
  return `${m[1]}${String(NUMBER_STEP * id + (Number(m[2]) % NUMBER_STEP)).padStart(2, '0')}${m[3]}`;
}

/** 复制头的时候带上它底下那根脖子（脖子和头是并排挂在躯干上的，照名字认，和 tweak.ts 的 headOf 一个规矩） */
const neckOf = (head: Part): string | null => (head.type === 'head' && /^Head_\d+$/.test(head.name) ? head.name.replace('Head_', 'Neck_') : null);

/** 一块里有哪些部件：from 自己、长在它上面的（往下任何一层）、头底下的脖子。照 Figure 里的先后排 */
function blockParts(parts: readonly Part[], source: Part): Part[] {
  const inside = new Set([source.name]);
  const neck = neckOf(source);
  for (const p of parts) {
    if (p.parent !== undefined && inside.has(p.parent)) inside.add(p.name);
    else if (neck !== null && p.name === neck && p.parent === source.parent) inside.add(p.name);
  }
  return parts.filter((p) => inside.has(p.name));
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
 * 复制出来的部件不在原来那个位置上，照原位做的形状要换成能摆到别处的：
 * - 贴在躯干表面上的胸（二次元素体）：不贴表面，换成一个圆包（见 mound），和别的部件一样随便挪、转、缩放；
 * - 长在素体本来的肩膀上的手臂：根上连着一圈腋下的皮，挪到别处会支出一圈毛边。换成它举高时用的那一套
 *   （根部切掉、切口上垫一个圆肩头，见 Part.posed）；
 * - 素体原位的脖子：根上带着一圈肩膀的喇叭口。换成几个头时斜着伸出去的那种光溜的圆台（animeLayout.ts 的 plainNeck）；
 * - 素体上从同一个模型切下来、还在原位的那几块（头、脖子、手臂、腿）是当成躯干的一部分直接拼的（fuseAs）：
 *   挪开以后对不上原来的切口，改回圆滑地融进去
 */
function loose(part: Part): Part {
  const { fuseAs, ...rest } = part;
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
  const rootName = cloneRootName(block.from, block.id);
  if (!source || rootName === null) return figure;
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
          : // 名字不跟着父部件的（头底下的脖子、同一个头上多出来的脸）：照自己的号改
            cloneRootName(p.name, block.id);
    if (name === null || partTaken.has(name)) return figure;
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

  const clones = sources.map((p): Part => {
    const out: Part = { ...loose(p), name: partName.get(p.name)! };
    if (p.parent !== undefined) out.parent = partName.get(p.parent) ?? p.parent;
    // 挪开：这一块里领头的那些（父部件在这一块外面的：要复制的那个，和头底下的脖子）一起挪，长在它们上面的跟着走
    if (block.shift && (p.parent === undefined || !partName.has(p.parent))) out.pos = add(p.pos, block.shift);
    if (p.bones) out.bones = p.bones.map((b): BoneHint => ({ ...b, name: bone(b.name), ...(b.parent !== undefined && { parent: bone(b.parent) }) }));
    if (p.grafts) {
      out.grafts = p.grafts.map(
        (g): Graft => ({ ...g, bones: Object.fromEntries(Object.entries(g.bones).map(([mesh, name]) => [mesh, bone(name)])), rigid: g.rigid.map(bone) }),
      );
    }
    return out;
  });
  // 排在最后：父部件（原来就有的、或者这一块里排在前面的）都在它们前面
  return { ...figure, parts: [...figure.parts, ...clones] };
}

/**
 * 把手工加的体块复制进摆好的 Figure（在套手动微调之前）。照 added 的先后一块一块来：后面的可以照前面复制出来的再复制。
 * 一块也没有时原样返回传进来的那个 Figure
 */
export function withBlocks(figure: Figure, added: readonly AddedBlock[] | undefined): Figure {
  if (!added?.length) return figure;
  return added.reduce(cloneBlock, figure);
}

/** 第 id 块里的部件现在都叫什么（照 from 复制出来的那个排第一个）；这一块现在不在就是空的 */
export function blockNames(figure: Pick<Figure, 'parts'>, root: string): string[] {
  const part = figure.parts.find((p) => p.name === root);
  return part ? blockParts(figure.parts, part).map((p) => p.name) : [];
}
