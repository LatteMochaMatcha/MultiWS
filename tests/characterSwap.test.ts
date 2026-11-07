// 成品角色的手指数、手脚互换（src/character/limbEnds.ts，docs/digits-plan.md 第 5 期）
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CharacterBuild, assembleCharacter } from '../src/character/assemble';
import { characterSkeleton } from '../src/character/export';
import { CHARACTER } from '../src/character/load';
import { type CharacterSource, readCharacter } from '../src/character/source';
import { humanoidMap } from '../src/io/vrm';
import { type BodySpec, defaultSpec } from '../src/model/spec';
import { makeSolver } from '../src/pose/solver';

let cached: CharacterSource | null = null;
function source(): CharacterSource {
  if (!cached) {
    const file = readFileSync(new URL(`../public/${CHARACTER.url}`, import.meta.url));
    cached = readCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, CHARACTER);
  }
  return cached;
}
const build = (rest: Partial<BodySpec>, counts: Partial<BodySpec['counts']> = {}): CharacterBuild => {
  const base = defaultSpec();
  return assembleCharacter(source(), { ...base, bodyStyle: 'character', ...rest, counts: { ...base.counts, ...counts } });
};
const bonesOf = (b: CharacterBuild) => b.bones.map((x) => x.name);
const lowest = (b: CharacterBuild) => Math.min(...b.meshes.flatMap((c) => Array.from(c.positions.filter((_, i) => i % 3 === 1))));

describe('成品角色：手指数、手脚互换', () => {
  it('手指 7 根多出 FingerA、FingerB，3 根没有中指、无名指；多出来的一对手臂跟着', () => {
    const seven = bonesOf(build({ fingers: 7 }, { armPairs: 2 }));
    for (const name of ['FingerA1_L', 'FingerB3_R', 'FingerA1_L.002', 'Ring1_L', 'Little3_R']) expect(seven).toContain(name);
    expect(seven).not.toContain('FingerC1_L');
    const three = bonesOf(build({ fingers: 3 }));
    for (const name of ['Thumb1_L', 'Index1_L', 'Little1_R']) expect(three).toContain(name);
    for (const name of ['Middle1_L', 'Ring1_R']) expect(three).not.toContain(name);
  });

  it('手臂接脚：手臂末端是她自己的鞋，手没了、手指的骨骼也清掉了，手那根还在', () => {
    const b = build({ armEnd: 'foot' });
    const names = bonesOf(b);
    expect(names).toContain('Hand_L');
    for (const name of ['Thumb1_L', 'Index1_R']) expect(names).not.toContain(name);
    expect(b.meshes.some((c) => c.name.includes('FootOnArm_L'))).toBe(true);
    expect(lowest(b)).toBeCloseTo(0, 4);
  });

  it('腿接手：脚上是她自己的手（手指叫 LegThumb1_L …），鞋和脚趾没了，手心踩在地上，身高照旧', () => {
    const plain = build({});
    const b = build({ legEnd: 'hand', fingers: 6 });
    const names = bonesOf(b);
    for (const name of ['Foot_L', 'LegThumb1_L', 'LegIndex3_R', 'LegFingerA2_L', 'Thumb1_L']) expect(names).toContain(name);
    expect(names).not.toContain('Toes_L');
    expect(lowest(b)).toBeCloseTo(0, 4);
    expect(b.metrics.height).toBeCloseTo(plain.metrics.height, 2);
    // 摆姿势：腿上的手认成腿上的手；导出 VRM：腿上的手指不进对照表
    const skeleton = characterSkeleton(b);
    const solver = makeSolver(skeleton.bones);
    expect(solver.hands.filter((h) => h.limb === 'leg').length).toBe(2);
    expect(solver.hands.filter((h) => h.limb === 'arm').length).toBe(2);
    const map = humanoidMap(skeleton);
    expect(map.has('leftFoot')).toBe(true);
    expect(map.has('leftToes')).toBe(false);
    expect([...map.values()].some((i) => skeleton.bones[i].name.startsWith('Leg'))).toBe(false);
  });

  it('两样一起换：手臂上的鞋、腿上的手都在', () => {
    const b = build({ armEnd: 'foot', legEnd: 'hand' });
    expect(b.meshes.some((c) => c.name.includes('FootOnArm_R'))).toBe(true);
    expect(b.meshes.some((c) => c.name.includes('HandOnLeg_R'))).toBe(true);
    expect(bonesOf(b)).toContain('LegLittle3_R');
    expect(bonesOf(b)).not.toContain('Little3_R');
  });
});
