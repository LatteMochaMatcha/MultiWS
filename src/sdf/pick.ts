/**
 * 点选部件（融合模式）：身体是一整块网格，点到的那一点属于哪个部件，要回到距离场里去查——
 * 离哪个部件自己的表面最近，就算哪个。
 */
import { type Figure, worldTransforms } from '../geometry/figure';
import type { V3 } from '../geometry/vec';
import { compilePartField, fieldAt } from './field';

export type Picker = (point: V3) => string | null;

/** 给一个 Figure 准备好点选用的查询函数。point 是世界坐标（米） */
export function makePicker(figure: Pick<Figure, 'parts' | 'scale'>): Picker {
  const xfs = worldTransforms(figure);
  // 离所有部件都超过这么远的点不算点中（融合圆角会让表面比部件本身鼓出来一点）
  const reach = 0.06 * figure.scale;
  const entries = figure.parts
    .filter((part) => part.material !== 'eye')
    .map((part) => ({ name: part.name, field: compilePartField(part, xfs.get(part.name)!) }));
  return (p) => {
    let best: string | null = null;
    let nearest = reach;
    for (const { name, field } of entries) {
      const { min, max } = field;
      if (
        p[0] < min[0] - nearest || p[0] > max[0] + nearest ||
        p[1] < min[1] - nearest || p[1] > max[1] + nearest ||
        p[2] < min[2] - nearest || p[2] > max[2] + nearest
      ) {
        continue;
      }
      const d = fieldAt(field, p[0], p[1], p[2]);
      if (d < nearest) {
        nearest = d;
        best = name;
      }
    }
    return best;
  };
}
