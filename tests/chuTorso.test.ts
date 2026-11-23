// 「楚云萱躯干」：预设「楚云萱」的上半身换成一整块（见 src/geometry/trunk.ts、docs/chu-blocks-plan.md）
import { describe, expect, it } from 'vitest';
import { CHU_TORSO_GRID } from '../src/anime/chuTorso';
import { type Figure, worldTransforms } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { TRUNK_PART } from '../src/geometry/trunk';
import { len, sub } from '../src/geometry/vec';
import { chuRefit, chuSpec } from '../src/model/chu';
import { setOverride } from '../src/model/overrides';
import { type BodySpec, defaultSpec, normalizeSpec, parseSpecJson, serializeSpec } from '../src/model/spec';
import { buildSkeleton } from '../src/rig/skeleton';
import { runJob } from '../src/sdf/job';
import { useAnimeBody } from './animeBody';
import { useChuTorso } from './chuTorso';

useAnimeBody();
useChuTorso();

const spec = chuSpec(normalizeSpec({ ...defaultSpec(), bodyStyle: 'anime' }));
const figure = buildFigure(spec);
/** 同一份设定、上半身还是九个胸腔各是各的 */
const nine = (s: BodySpec): BodySpec => ({ ...s, blocks: { ...s.blocks!, trunk: undefined } });
const usesTrunk = (f: Figure) => f.parts.some((p) => p.name === TRUNK_PART && p.prims.some((q) => q.kind === 'grid' && q.grid === CHU_TORSO_GRID));
const ghosts = (f: Figure) => f.parts.filter((p) => p.type === 'torso' && p.parent === TRUNK_PART);
const posOf = (f: Figure, name: string) => worldTransforms(f).get(name)!.pos;

describe('楚云萱躯干', () => {
  it('二次元素体上的预设用一整块上半身：九个胸腔的骨骼都归它，另外八个只剩落脚处', () => {
    expect(spec.blocks?.trunk).toBe('chu');
    expect(usesTrunk(figure)).toBe(true);
    const rest = ghosts(figure);
    expect(rest).toHaveLength(8);
    for (const p of rest) {
      expect(p.prims).toHaveLength(0);
      expect(p.bones ?? []).toHaveLength(0);
    }
    expect(figure.parts.find((p) => p.name === TRUNK_PART)!.bones).toHaveLength(27);
    // 骨架照样建得起来，骨骼数和九块时一样
    expect(buildSkeleton(figure).bones.length).toBe(buildSkeleton(buildFigure(nine(spec))).bones.length);
  });

  it('换成一整块以后头、手臂、胸、胯都还在原来的地方', () => {
    const plain = buildFigure(nine(spec));
    const a = worldTransforms(figure);
    const b = worldTransforms(plain);
    for (const p of plain.parts) {
      if (!/^(Head|Arm|Chest|Torso|Leg)_/.test(p.name)) continue;
      expect(len(sub(a.get(p.name)!.pos, b.get(p.name)!.pos)), p.name).toBeLessThan(1e-6);
    }
  });

  it('融合出来是一整块、没有破面', () => {
    const { mesh } = runJob({ parts: figure.parts, voxel: 0.02, blend: spec.blend });
    expect(mesh.info.components).toBe(1);
  });

  it('挪、转、拉宽这一整块，整个上半身一起走，胯不动', () => {
    const moved = buildFigure(setOverride(spec, TRUNK_PART, { position: [0, 0, 0.1] }));
    expect(usesTrunk(moved)).toBe(true);
    for (const name of ['Head_901', 'Head_1501', 'Arm_1001_L', 'Chest_1901_C']) {
      const d = sub(posOf(moved, name), posOf(figure, name));
      // 挪的距离和身体一起照全身的缩放（腿长短、身高）换算
      expect(len(sub(d, [0, 0, 0.1 * moved.scale])), name).toBeLessThan(1e-6);
    }
    expect(len(sub(posOf(moved, 'Torso_101'), posOf(figure, 'Torso_101')))).toBeLessThan(1e-9);

    const turned = buildFigure(setOverride(spec, TRUNK_PART, { rotation: [0, 30, 0] }));
    expect(usesTrunk(turned)).toBe(true);
    expect(len(sub(posOf(turned, 'Head_901'), posOf(figure, 'Head_901')))).toBeGreaterThan(0.02);

    // 左右拉宽两成：两边的头往外挪，正中那个不动
    const wide = buildFigure(setOverride(spec, TRUNK_PART, { scale: [1.2, 1, 1] }));
    expect(usesTrunk(wide)).toBe(true);
    expect(Math.abs(posOf(wide, 'Head_1001')[0])).toBeGreaterThan(Math.abs(posOf(figure, 'Head_1001')[0]) + 0.02);
    expect(Math.abs(posOf(wide, 'Head_901')[0] - posOf(figure, 'Head_901')[0])).toBeLessThan(0.01);
  });

  it('存档读回来还是一整块', () => {
    const back = parseSpecJson(serializeSpec(spec));
    expect(back.blocks?.trunk).toBe('chu');
    expect(usesTrunk(buildFigure(back))).toBe(true);
  });

  it('大腿调粗、九副胯排开：上半身跟着拉宽，还是一整块', () => {
    const was = spec;
    const now = chuRefit(was, { ...was, shape: { ...was.shape, thighs: 1.7 } });
    const f = buildFigure(now);
    expect(usesTrunk(f)).toBe(true);
    expect(f.parts.find((p) => p.name === TRUNK_PART)!.stretch?.[0]).toBeGreaterThan(1.02);
  });

  it('单独挪走一副胯（上面的胸腔跟着走了）：对不上，退回九个胸腔各是各的', () => {
    const f = buildFigure(setOverride(spec, 'Torso_201', { position: [0.15, 0, 0] }));
    expect(usesTrunk(f)).toBe(false);
    expect(ghosts(f)).toHaveLength(0);
  });
});
