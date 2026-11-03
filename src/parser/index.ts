import { type BodySpec, clampShape } from '../model/spec';
import type { ParseResult } from './parse';

export { cnNum, zhCount } from './numerals';
export { type ParseMatch, type ParseResult, type MatchTier, normalizeText, parseDescription } from './parse';
export { type Chip, type Describable, EAR_NAME, describeSpec, summarize } from './describe';

/**
 * 把解析结果写进 BodySpec：部件数量和排布（连人腿人马每副胯几条腿）整体替换（没提到的回到默认，与 v1 一致），
 * 耳形、身高、头身比、性别、姿势、发型、发色只在文字里提到时才改，其余设置不动。
 */
export function applyParse(spec: BodySpec, r: ParseResult): BodySpec {
  return {
    ...spec,
    hair: { ...spec.hair, ...r.hair },
    counts: { ...r.counts },
    headLayout: r.headLayout,
    armLayout: r.armLayout,
    legLayout: r.legLayout,
    hipLegs: r.hipLegs,
    penisLayout: r.penisLayout,
    penisRow: r.penisRow,
    scrotum: r.scrotum,
    earShape: r.earShape ?? spec.earShape,
    gender: r.gender ?? spec.gender,
    pose: r.pose ?? spec.pose,
    shape: clampShape({ ...spec.shape, ...r.shape }),
  };
}
