/**
 * 成品角色身上后加的部件：尾巴、翅膀、角、兽耳。
 * 角色自己没有这些东西，沿用白模人台的做法现捏（见 geometry/layout.ts、head.ts），
 * 摆到角色身上对应的位置，交给 assemble.ts 接到骨架上。它们没有贴图，是单色的。
 */
import { type Part, worldTransforms } from '../geometry/figure';
import { makeHead } from '../geometry/head';
import { tailParts, wingParts } from '../geometry/layout';
import { buildPartGeometry } from '../geometry/partsMesh';
import { type Quat, type V3, Q_ID, add, mul, rotate } from '../geometry/vec';
import type { BodySpec } from '../model/spec';
import { compileField } from '../sdf/field';

export type ExtraKind = 'tail' | 'wing' | 'horn' | 'ear';

export interface ExtraHead {
  /** 这个头是第几个（0 是角色自己的头，1 是 Head.002 …），角和耳朵的骨骼名跟着它编号 */
  index: number;
  /** 头骨骼的名字：没有自己骨骼的部件（角）整个跟着它 */
  bone: string;
  /** 头的正中（下巴和头顶的中点）、朝向、缩放 */
  center: V3;
  quat: Quat;
  scale: number;
  /** 哪一侧紧挨着别的头（left 是角色的左手边）：那一侧的角和耳朵收拢着长 */
  beside: { left: boolean; right: boolean };
}

export interface ExtraInput {
  spec: BodySpec;
  heads: ExtraHead[];
  /** 头的半宽、半高、半厚（缩放之前） */
  headSize: V3;
  /** 尾根的位置，尾巴接在哪根骨骼上（人马、蛛形时是兽身后端的那一根） */
  tailRoot: V3;
  tailParent: string;
  /** 第 i 对翅膀、side 一侧的翼根 */
  wingRoot: (i: number, side: 1 | -1) => V3;
}

export interface ExtraPart {
  name: string;
  kind: ExtraKind;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** 这个部件自己的骨骼（尾巴一节节的、翅膀和耳朵各一根）；parent 是骨骼名 */
  bones: { name: string; parent: string; head: V3; tail: V3 }[];
  /** 没有自己骨骼的话，整个跟着哪根骨骼 */
  attach: string;
}

const O: V3 = [0, 0, 0];
const ANCHOR = 'Anchor';

export function extraParts(input: ExtraInput): ExtraPart[] {
  const c = input.spec.counts;
  const sh = input.spec.shape;
  if (!c.tails && !c.wingPairs && !c.hornsPerHead && !c.earPairsPerHead) return [];

  // 一个放在原点、什么都不画的部件：翅膀、头的位置都相对它写
  const parts: Part[] = [{ name: ANCHOR, type: 'torso', side: 0, pos: O, quat: Q_ID, material: 'clay', prims: [] }];
  /** 部件名 → 没有自己骨骼时跟着哪根骨骼 */
  const attach = new Map<string, string>();

  parts.push(...wingParts(c.wingPairs, ANCHOR, input.wingRoot));

  if (c.hornsPerHead || c.earPairsPerHead) {
    // 角和耳朵贴着头的表面放：把头近似成一个椭球，朝它打射线找表面
    const [w, h, d] = input.headSize;
    const skull = compileField(
      {
        scale: 1,
        parts: [
          {
            name: 'Skull',
            type: 'head',
            side: 0,
            pos: O,
            quat: Q_ID,
            material: 'clay',
            prims: [{ kind: 'ellipsoid', name: 'Skull', center: [0, h * 0.17, -0.012], radii: [w * 0.9, h * 0.83, d] }],
          },
        ],
      },
      { blend: 0 },
    );
    for (const head of input.heads) {
      const name = `Head_${String(head.index + 1).padStart(2, '0')}`;
      const made = makeHead(name, ANCHOR, head.center, head.quat, head.scale, c, input.spec.earShape, 'female', { index: head.index, neckTop: O, beside: head.beside }, { prims: [], field: skull });
      for (const part of made) attach.set(part.name, head.bone);
      parts.push(...made);
    }
  }

  parts.push(...tailParts(c.tails, sh, 1, input.tailRoot, input.tailParent));

  const xfs = worldTransforms({ parts, scale: 1 });
  const out: ExtraPart[] = [];
  for (const part of parts) {
    if (!part.prims.length || (part.type !== 'tail' && part.type !== 'wing' && part.type !== 'horn' && part.type !== 'ear')) continue;
    const xf = xfs.get(part.name)!;
    const place = (p: V3): V3 => add(xf.pos, mul(rotate(xf.quat, p), xf.scale));
    const geometry = buildPartGeometry(part);
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const count = position.count;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) {
      positions.set(place([position.getX(v), position.getY(v), position.getZ(v)]), v * 3);
      normals.set(rotate(xf.quat, [normal.getX(v), normal.getY(v), normal.getZ(v)]), v * 3);
    }
    // 有的几何体（翅膀）没有顶点下标，每三个顶点就是一个面
    const indices = geometry.index ? Uint32Array.from(geometry.index.array) : Uint32Array.from({ length: count }, (_, i) => i);
    geometry.dispose();
    out.push({
      name: part.name,
      kind: part.type,
      positions,
      normals,
      indices,
      bones: (part.bones ?? []).map((b) => ({ name: b.name, parent: b.parent ?? 'Hips', head: place(b.head), tail: place(b.tail) })),
      attach: attach.get(part.name) ?? (part.type === 'wing' ? 'UpperChest' : 'Hips'),
    });
  }
  return out;
}
