/**
 * 编辑「手工加的体块」用的小工具（见 docs/blocks-plan.md）。都是纯函数，返回新的 BodySpec。
 * 只管白模人台、二次元素体：成品角色不看 BodySpec.blocks
 */
import { cloneRootName } from '../geometry/clone';
import type { PartType } from '../geometry/figure';
import { dropAttach } from './attach';
import { type AddedBlock, type BodySpec, type PartOverride, type Vec3, ringActive } from './spec';

const added = (spec: Pick<BodySpec, 'blocks'>): readonly AddedBlock[] => spec.blocks?.added ?? [];

/** 能复制的那几类。躯干、下身还不能；脖子跟着头走；头发、成人部件不在里面 */
export const COPYABLE: ReadonlySet<PartType> = new Set<PartType>(['head', 'arm', 'leg', 'chest', 'tail', 'wing', 'horn', 'ear', 'eye']);
/** 复制出来先往哪挪开多少（沿父部件的轴，摆位用的米），免得和原来那个叠在一起看不见 */
export const COPY_SHIFT: Partial<Record<PartType, Vec3>> = {
  head: [0.17, 0, 0],
  arm: [0, -0.11, 0],
  leg: [0, 0, -0.15],
  chest: [0, -0.12, -0.015],
  tail: [0.07, 0, 0],
  wing: [0, -0.13, 0],
  horn: [0, 0, -0.035],
  ear: [0, 0, -0.035],
  eye: [0, 0.034, 0],
};

/** 手工加出来的部件（每一块里照 from 复制出来的那个）→ 它是哪一条 */
export function blockRoots(spec: Pick<BodySpec, 'blocks'>): Map<string, AddedBlock> {
  const out = new Map<string, AddedBlock>();
  for (const block of added(spec)) {
    const name = cloneRootName(block.from, block.id);
    if (name !== null) out.set(name, block);
  }
  return out;
}

/** 这个部件是不是手工加出来的（一块里领头的那个；长在它上面的不算） */
export const isBlockRoot = (spec: Pick<BodySpec, 'blocks'>, name: string): boolean => blockRoots(spec).has(name);

/** 要复制的一个部件 */
export interface BlockSource {
  from: string;
  /** 复制出来先挪开多少（见 AddedBlock.shift） */
  shift?: Vec3;
  /**
   * 原来那个部件的微调不照搬到复制出来的那个上：贴在躯干表面上的胸，微调在摆位时已经换算进它的形状里了
   * （见 animeLayout.ts），复制的是换算以后的样子，再搬一遍就动了两份
   */
  plain?: boolean;
}

/**
 * 加一块：照 sources 里的部件各复制一份，用同一个 id（左右一对一起加时两个都给进来）。
 * 原来那个部件、长在它上面的那些的微调（挪过、放大过、删掉的）照搬到复制出来的上面：复制出来的和它现在的样子一样。
 * 返回新的设定和复制出来的部件名（复制不了的不在里面）
 */
export function addBlock(spec: BodySpec, sources: readonly BlockSource[]): { spec: BodySpec; names: string[] } {
  const used = new Set(added(spec).map((b) => b.id));
  let id = 1;
  while (used.has(id)) id++;
  const blocks: AddedBlock[] = [...added(spec)];
  const overrides: Record<string, PartOverride> = { ...spec.overrides };
  const names: string[] = [];
  for (const source of sources) {
    const name = cloneRootName(source.from, id);
    if (name === null) continue;
    blocks.push({ id, from: source.from, ...(source.shift && { shift: source.shift }) });
    names.push(name);
    for (const [key, o] of Object.entries(spec.overrides)) {
      if (key === source.from) {
        if (!source.plain) overrides[name] = o;
      } else if (key.startsWith(`${source.from}_`)) overrides[name + key.slice(source.from.length)] = o;
    }
    // 头底下的脖子跟着头一起复制（见 geometry/clone.ts）
    const neck = /^Head_\d+$/.test(source.from) ? source.from.replace('Head_', 'Neck_') : null;
    const neckClone = neck === null ? null : cloneRootName(neck, id);
    if (neck !== null && neckClone !== null && spec.overrides[neck]) overrides[neckClone] = spec.overrides[neck];
  }
  if (!names.length) return { spec, names };
  return { spec: { ...spec, blocks: { ...spec.blocks, added: blocks }, overrides }, names };
}

/**
 * 拿掉手工加的一块（name 是它领头的那个部件）：连同照它、照它上面长的再复制出来的那些，以及记在这些部件上的微调。
 * under 是这一块现在都有哪些部件（geometry/clone.ts 的 blockNames）：名字不跟着领头那个走的（头底下的脖子）靠它认
 */
export function removeBlock(spec: BodySpec, name: string, under: readonly string[] = []): BodySpec {
  const roots = blockRoots(spec);
  if (!roots.has(name)) return spec;
  /** 要拿掉的部件：这一块，和照它们再复制出来的那些块 */
  const gone = new Set<string>([name, ...under]);
  const inside = (part: string) => [...gone].some((g) => part === g || part.startsWith(`${g}_`));
  const dropped = new Set<AddedBlock>([roots.get(name)!]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [root, block] of roots) {
      if (dropped.has(block) || !inside(block.from)) continue;
      dropped.add(block);
      gone.add(root);
      grew = true;
    }
  }
  const overrides = Object.fromEntries(Object.entries(spec.overrides).filter(([key]) => !inside(key)));
  // 接在这一块上的、这一块自己接出去的缝合一起去掉
  return dropAttach({ ...spec, blocks: { ...spec.blocks, added: added(spec).filter((b) => !dropped.has(b)) }, overrides }, inside);
}

/* ---------------- 躯干分成胸腔和胯两块 ---------------- */

/** 分开以后的两块叫什么（见 geometry/torsos.ts 的 one）：胸腔是 UpperBody，胯和小腹还叫 Torso */
export const RIBCAGE = 'UpperBody';
export const PELVIS = 'Torso';

/** 这副身体的躯干能不能分成两块：一个上半身的白模人台、二次元素体（几个上半身本来就是分开的；连体、围成一圈、成品角色不分） */
export const canSplitTorso = (spec: Pick<BodySpec, 'bodyStyle' | 'counts' | 'conjoined' | 'ring'>): boolean =>
  spec.bodyStyle !== 'character' && spec.counts.torsos === 1 && spec.conjoined === 'none' && !ringActive(spec);

/** 躯干现在是不是分成两块的 */
export const torsoSplit = (spec: Pick<BodySpec, 'bodyStyle' | 'counts' | 'conjoined' | 'ring' | 'blocks'>): boolean => !!spec.blocks?.splitTorso && canSplitTorso(spec);

/**
 * 把躯干分成胸腔和胯两块，或者合回一整块。
 * 整块躯干的微调带着的是腰以上那些（腿不跟着）：分开时挪到胸腔上，合回去时胸腔的挪回躯干上；胯自己的微调合回去时丢掉
 */
export function setSplitTorso(spec: BodySpec, on: boolean): BodySpec {
  if (on === !!spec.blocks?.splitTorso) return spec;
  const { [RIBCAGE]: ribcage, [PELVIS]: whole, ...rest } = spec.overrides;
  const moved = on ? whole : ribcage;
  const overrides = moved ? { ...rest, [on ? RIBCAGE : PELVIS]: moved } : rest;
  const { splitTorso: _was, ...blocks } = spec.blocks ?? { added: [] };
  return { ...spec, blocks: on ? { ...blocks, splitTorso: true } : blocks, overrides };
}
