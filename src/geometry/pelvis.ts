/**
 * 体块：躯干分成胸腔和胯两块以后（torsos.ts 的 one），哪块是胸腔、哪块是胯、哪些部件跟着哪块胯（见 docs/blocks-plan.md）。
 * 胯可以复制（clone.ts），一副身体上能有好几块胯，各带各的腿。
 */
import type { Part } from './figure';

/** 胸腔：带着从胯上渐渐分出去的那一段的躯干（见 figure.ts 的 Fork） */
export const isRibcage = (part: Part): boolean => part.type === 'torso' && part.prims.some((q) => (q.kind === 'grid' || q.kind === 'loft') && !!q.fork);

/** 这副身体的躯干是不是分成了各自独立的胸腔和胯：有不挂在别的部件上的那块胸腔（UpperBody） */
export const isSplit = (parts: readonly Part[]): boolean => parts.some((p) => p.name === 'UpperBody' && p.parent === undefined);

/** 胯（躯干分成两块时）：没有父部件、不是胸腔的那些躯干 */
export const isPelvis = (part: Part): boolean => part.type === 'torso' && part.parent === undefined && !isRibcage(part);

/** 部件名里最后一个编号是第几块复制出来的（clone.ts 的 cloneRootName：第 id 块是 100·id 加原来的号）；不是复制出来的是 0 */
const blockOf = (name: string): number => {
  const m = /_(\d+)(?:_[A-Za-z]+)*$/.exec(name);
  return m ? Math.floor(Number(m[1]) / 100) : 0;
};

/**
 * 躯干分成两块时，没有父部件、不是躯干的那些部件（腿、尾巴、垫在腿根上的那些）各跟着哪块胯：
 * 顺着它根上那根骨骼往上找，先碰到哪块胯的骨骼就是哪块；没有骨骼、找不到的（一条腿时垫在腿根两边的 Hip_L、Hip_R）照名字认——
 * 和哪块胯是同一块复制出来的就跟着哪块，认不出来的跟着本来的那块（Torso）。
 * （以前没有骨骼的一律跟着 Torso：复制出来的垫块也算在 Torso 头上，再复制一副胯就把它们又带一份，九副胯垫块翻到五百多个）
 * 不是分成两块的身体是空的
 */
export function pelvisOf(parts: readonly Part[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!isSplit(parts)) return out;
  const pelvises = parts.filter(isPelvis);
  const main = pelvises.find((p) => p.name === 'Torso') ?? pelvises[0];
  if (!main) return out;
  const owner = new Map<string, string>();
  const up = new Map<string, string | undefined>();
  const byBlock = new Map<number, string>();
  for (const p of pelvises) if (!byBlock.has(blockOf(p.name))) byBlock.set(blockOf(p.name), p.name);
  for (const p of parts) for (const b of p.bones ?? []) {
    up.set(b.name, b.parent);
    if (isPelvis(p)) owner.set(b.name, p.name);
  }
  for (const p of parts) {
    if (p.parent !== undefined || p.type === 'torso') continue;
    let found = byBlock.get(blockOf(p.name)) ?? main.name;
    for (let at = p.bones?.[0]?.parent, guard = 0; at !== undefined && guard < 4096; at = up.get(at), guard++) {
      const pelvis = owner.get(at);
      if (pelvis !== undefined) {
        found = pelvis;
        break;
      }
    }
    out.set(p.name, found);
  }
  return out;
}
