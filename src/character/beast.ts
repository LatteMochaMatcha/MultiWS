/**
 * 成品角色的兽身：人马的马身、蛛形的蜘蛛身。
 * 角色自己没有这些东西，沿用白模人台的做法捏出来（见 geometry/layout.ts 的 lowerParts），
 * 融合成一整块网格、算好蒙皮，交给 assemble.ts 接在角色的胯下面。它没有贴图，是单色的。
 *
 * 这里的坐标是白模人台的那一套（地面在 y = 0，面朝 +Z，没有缩放）；摆到角色身上时由 assemble.ts 缩放、挪位置。
 * 兽身只跟腿的对数有关，算一次就记下来，拖别的滑块时不用重算。
 */
import { t } from '../i18n';
import type { Part } from '../geometry/figure';
import { beastLift, bone, lowerParts } from '../geometry/layout';
import { type V3, Q_ID } from '../geometry/vec';
import { buildSkeleton } from '../rig/skeleton';
import { skinVertices } from '../rig/skin';
import { castRay, compileField } from '../sdf/field';
import { fuseParts } from '../sdf/fuse';

export type BeastForm = 'taur' | 'spider';

/** 兽身的一块网格。这些数组是记下来反复用的，拿去用的人不能改它们 */
export interface BeastPiece {
  positions: Float32Array;
  normals: Float32Array;
  /** 没有贴图：贴图坐标全是 0 */
  uvs: Float32Array;
  /** 每个顶点 4 个骨骼下标（指向 BeastBody.bones）和 4 个权重 */
  joints: Uint16Array;
  weights: Float32Array;
  indices: Uint32Array;
}

export interface BeastBody {
  /** 身子 */
  body: BeastPiece;
  /** 蹄子（另上一种颜色；蛛形没有蹄子） */
  hoof: BeastPiece | null;
  /** 第 0 根是 Hips：接的时候换成角色自己的那根。父骨骼总排在子骨骼前面 */
  bones: { name: string; parent: number; head: V3; tail: V3 }[];
  /** 角色的胯坐在哪：兽身前端的背上 */
  seat: V3;
  /** 兽身最宽处离中线多远、在多高的地方（手臂自然下垂时要让开它） */
  wide: number;
  level: number;
  /** 尾根的位置，尾巴接在哪根骨骼上 */
  tailRoot: V3;
  tailParent: string;
}

/**
 * 体素大小。马腿细的地方半径只有三厘米，再粗就糊了；
 * 蜘蛛的八条腿又长又没什么细节，粗一点省下一半的面
 */
const VOXEL: Record<BeastForm, number> = { taur: 0.01, spider: 0.013 };
/** 腿和身子交界处的圆角 */
const BLEND = 0.03;
/** 地面以上这么高以内的面算蹄子 */
const HOOF_TOP = 0.088;

const cache = new Map<string, BeastBody>();

export function beastBody(form: BeastForm, pairs: number): BeastBody {
  const key = `${form}/${pairs}`;
  let made = cache.get(key);
  if (!made) {
    made = build(form, pairs);
    cache.set(key, made);
  }
  return made;
}

function build(form: BeastForm, pairs: number): BeastBody {
  const lower = lowerParts({
    form,
    stations: Array.from({ length: pairs }, () => 2),
    b: 1,
    hips: 1,
    limb: 1,
    hx: 0.088,
    hipY: 0.9,
    pelvisY: 0.93,
    tailRoot: [0, 0.99, -0.11],
    humanLeg: () => {
      throw new Error(t('兽身上没有人腿'));
    },
  });
  // 座位：上半身在白模人台上抬高、前移到的那个位置，正上方打一条射线下来碰到的背
  const lift = beastLift(form);
  const field = compileField({ parts: lower.parts, scale: 1 }, { blend: BLEND });
  const seat: V3 = [0, 2 - castRay(field, [0, 2, lift[2]], [0, -1, 0], 2), lift[2]];
  // 一个什么都不画的部件，带着根骨骼：兽身前端没有自己骨骼的那一块跟着它
  const anchor: Part = {
    name: 'Seat',
    type: 'torso',
    side: 0,
    pos: [0, 0, 0],
    quat: Q_ID,
    material: 'clay',
    prims: [],
    bones: [bone('Hips', seat, [seat[0], seat[1] + 0.1, seat[2]])],
  };
  const figure = { parts: [anchor, ...lower.parts], scale: 1 };
  const mesh = fuseParts(lower.parts, { voxel: VOXEL[form], blend: BLEND });
  const skeleton = buildSkeleton(figure);
  const skin = skinVertices(figure, skeleton, mesh.positions, mesh.triangles);

  // 蹄子：三个顶点都在蹄冠以下的面
  const body: number[] = [];
  const hoof: number[] = [];
  const low = (v: number) => mesh.positions[v * 3 + 1] < HOOF_TOP;
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const [a, b, c] = [mesh.triangles[t], mesh.triangles[t + 1], mesh.triangles[t + 2]];
    (form === 'taur' && low(a) && low(b) && low(c) ? hoof : body).push(a, b, c);
  }
  /** 这批面用到的顶点单独存成一块（身子和蹄子各一块，各用各的材质） */
  const piece = (triangles: number[]): BeastPiece => {
    const remap = new Map<number, number>();
    const indices = new Uint32Array(triangles.length);
    triangles.forEach((v, i) => {
      let id = remap.get(v);
      if (id === undefined) {
        id = remap.size;
        remap.set(v, id);
      }
      indices[i] = id;
    });
    const count = remap.size;
    const made: BeastPiece = {
      positions: new Float32Array(count * 3),
      normals: new Float32Array(count * 3),
      uvs: new Float32Array(count * 2),
      joints: new Uint16Array(count * 4),
      weights: new Float32Array(count * 4),
      indices,
    };
    for (const [v, id] of remap) {
      made.positions.set(mesh.positions.subarray(v * 3, v * 3 + 3), id * 3);
      made.normals.set(mesh.normals.subarray(v * 3, v * 3 + 3), id * 3);
      made.joints.set(skin.joints.subarray(v * 4, v * 4 + 4), id * 4);
      made.weights.set(skin.weights.subarray(v * 4, v * 4 + 4), id * 4);
    }
    return made;
  };
  let wide = 0;
  let level = 0;
  for (const part of lower.parts) {
    if (part.type !== 'lower') continue;
    for (const prim of part.prims) {
      if (prim.kind !== 'ellipsoid' || prim.cut || prim.radii[0] <= wide) continue;
      wide = prim.radii[0];
      level = part.pos[1] + prim.center[1];
    }
  }
  return {
    body: piece(body),
    hoof: hoof.length ? piece(hoof) : null,
    bones: skeleton.bones.map((b) => ({ name: b.name, parent: b.parent, head: b.head, tail: b.tail })),
    seat,
    wide,
    level,
    tailRoot: lower.tailRoot,
    tailParent: lower.tailParent,
  };
}
