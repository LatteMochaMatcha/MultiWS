import { describe, expect, it } from 'vitest';
import { POSE_GROUPS, POSE_LIBRARY } from '../src/pose/library';

describe('现成姿势的分类', () => {
  it('每个姿势都归了类', () => {
    expect(POSE_LIBRARY.filter((p) => !p.group).map((p) => p.name)).toEqual([]);
  });

  it('每一类都有姿势', () => {
    for (const group of POSE_GROUPS) expect(POSE_LIBRARY.some((p) => p.group === group), group).toBe(true);
  });
});
