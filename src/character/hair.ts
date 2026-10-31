/**
 * 换发型用的现成头发：从别的模型上取下来的一块头发网格，连同它的材质、贴图和骨骼（tools/build-hair.mjs 做的）。
 * 文件的读法和成品角色一样（见 source.ts），另外带着一段说明：原主人的头有多大、头的关节在哪——
 * 换到别人头上时照这个对齐、缩放（见 assemble.ts）。
 *
 * 纯函数，不依赖浏览器。
 */
import type { V3 } from '../geometry/vec';
import { readGlb } from '../io/glbRead';
import { type CharacterSource, readCharacter } from './source';

export interface HairMeta {
  id: string;
  /** 原主人的名字 */
  title: string;
  /** 原主人的头：关节的位置，头顶、下巴的高度（米，面朝 +Z） */
  head: { joint: V3; top: number; chin: number };
  /** 贴着头皮的那一层底色（线性空间）；原主人没有这一层就是 null */
  scalp: [number, number, number] | null;
  /**
   * 这副头发的颜色是直接画在贴图里的深色：光改材质的底色只能染得更深，染不浅。
   * 染的时候换用角色自己那张浅色的头发贴图（VRoid 的头发贴图是通用的，哪副头发都对得上）
   */
  dark: boolean;
}

export interface HairDonor {
  meta: HairMeta;
  /** 只有头发的「角色」：第 0 根骨骼是头，其余是头发的骨骼 */
  source: CharacterSource;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numbers = (v: unknown, n: number): number[] | null =>
  Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : null;
const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
/** 按名字认材质：名字原样比，不当正则用 */
const anyOf = (list: string[]): RegExp | undefined =>
  list.length ? new RegExp(`^(?:${list.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`) : undefined;

export function readHair(buffer: ArrayBuffer): HairDonor {
  const extras: unknown = readGlb(buffer).json.extras;
  const info = isRecord(extras) ? extras.ocHair : null;
  const head = isRecord(info) ? info.head : null;
  const joint = isRecord(head) ? numbers(head.joint, 3) : null;
  if (!isRecord(info) || !isRecord(head) || !joint || typeof head.top !== 'number' || typeof head.chin !== 'number' || !(head.top > head.chin)) {
    throw new Error('这不是工坊的头发文件（缺原主人的头的尺寸）');
  }
  // 哪种材质是头发本身、哪种是自带的兽耳，文件里按材质名记着
  const source = readCharacter(buffer, { dye: anyOf(names(info.dye)), ears: anyOf(names(info.ears)) });
  if (source.bones[0]?.parent !== -1 || source.bones.some((bone, i) => i > 0 && bone.parent < 0)) throw new Error('头发文件的骨骼应该都挂在第一根（头）下面');
  const scalp = numbers(info.scalp, 3);
  return {
    meta: {
      id: typeof info.id === 'string' ? info.id : '',
      title: typeof info.title === 'string' ? info.title : '',
      head: { joint: [joint[0], joint[1], joint[2]], top: head.top, chin: head.chin },
      scalp: scalp ? [scalp[0], scalp[1], scalp[2]] : null,
      dark: info.dark === true,
    },
    source,
  };
}
