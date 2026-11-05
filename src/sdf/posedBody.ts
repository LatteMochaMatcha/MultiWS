/**
 * 照姿势变形以后身体（只算身子、头、腿、胸，不算手臂、尾巴、翅膀、头发这些）的距离：套现成姿势时手臂让开要用（见 pose/clear.ts）。
 * 那边平常是照静止姿势的距离场、把每个点照离它最近的那根骨骼换算回去量，两根骨骼交界的地方（弯腰时的屁股、
 * 两个上半身的胯）差得远；这里直接照摆好的姿势编一个距离场量（编一次几毫秒）。
 * 身体的这几类部件只跟着身上的骨骼动，手臂怎么摆都不影响它，所以手臂挪来挪去时这一个场一直能用。
 * 纯函数。
 */
import type { Figure, PartType } from '../geometry/figure';
import { GROUP_INDEX, evalPrims } from './field';
import { type PoseMatrices, compilePosedField } from './posedField';

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
