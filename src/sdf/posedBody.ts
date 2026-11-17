/**
 * 照姿势变形以后身体（只算身子、头、腿、胸，不算手臂、尾巴、翅膀、头发这些）的距离：套现成姿势时手臂让开要用（见 pose/clear.ts）。
 * 那边平常是照静止姿势的距离场、把每个点照离它最近的那根骨骼换算回去量，两根骨骼交界的地方（弯腰时的屁股、
 * 两个上半身的胯）差得远；这里直接照摆好的姿势编一个距离场量（编一次几毫秒）。
 * 身体的这几类部件只跟着身上的骨骼动，手臂怎么摆都不影响它，所以手臂挪来挪去时这一个场一直能用。
 * 纯函数。
 */
import type { Figure, PartType } from '../geometry/figure';
import { GROUP_INDEX, evalPrims } from './field';
import { type PoseMatrices, compilePosedField, heldLegs } from './posedField';

/** 算进身体的部件 */
const BODY: PartType[] = ['torso', 'lower', 'leg', 'neck', 'head', 'chest'];

/**
 * matrices：照骨架的米算的蒙皮矩阵（poseMatrices(rig, frame, figure.scale)，和照姿势重新融合时一样）。
 * 返回的距离、坐标都是骨架的米，外面是正的。编不出来（骨架对不上）返回 null
 */
export function posedBodyDist(figure: Pick<Figure, 'parts' | 'scale'>, blend: number, matrices: PoseMatrices): ((x: number, y: number, z: number) => number) | null {
  let field: ReturnType<typeof compilePosedField>;
  try {
    field = compilePosedField({ parts: figure.parts, scale: 1 }, { blend }, matrices);
  } catch {
    return null;
  }
  const keep = new Set(BODY.map((type) => GROUP_INDEX.get(type)));
  const list: number[] = [];
  for (let i = 0; i < field.count; i++) if (keep.has(field.group[i])) list.push(i);
  const prims = Int32Array.from(list);
  const unit = figure.scale;
  return (x, y, z) => evalPrims(field, prims, prims.length, x / unit, y / unit, z / unit) * unit;
}

/**
 * 量手腕周围空不空用的（见 pose/clear.ts 的 posed）：照摆好的姿势的距离，和照「融合的时候」的样子的距离里小的那个。
 * 二次元素体的腿不在场里摆：融合时腿整个跟着胯（见 posedFuse.ts），缝完手才搬到摆好的位置。蹲下、迈开腿以后垂在胯旁边的手，
 * 照摆好的姿势量是空着的，融合时却贴着那条还直着的腿——腿又不许挖（挖出的坑会跟着腿搬走），手就缝不上、掉成单独一块。
 * 所以两个样子里手腕周围都得空着。腿没动、或者不是这种腿的，就是 posedBodyDist
 */
export function wristBodyDist(figure: Pick<Figure, 'parts' | 'scale'>, blend: number, matrices: PoseMatrices): ((x: number, y: number, z: number) => number) | null {
  const posed = posedBodyDist(figure, blend, matrices);
  if (!posed) return null;
  let held: ReturnType<typeof heldLegs>;
  try {
    held = heldLegs(figure, matrices);
  } catch {
    return posed;
  }
  const fusing = held && posedBodyDist(figure, blend, held.matrices);
  if (!fusing) return posed;
  return (x, y, z) => Math.min(posed(x, y, z), fusing(x, y, z));
}
