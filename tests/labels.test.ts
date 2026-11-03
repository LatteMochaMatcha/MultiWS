// 整块挪（src/sdf/labels.ts）：造型里拖着部件、新网格还没算出来的时候，照每个顶点属于哪个部件，先把屏幕上那张搬过去。
import { describe, expect, it } from 'vitest';
import type { Part } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type BodySpec, defaultSpec } from '../src/model/spec';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
import { runJob } from '../src/sdf/job';
import { NONE, followInto, followMatrices, labelVertices, outline, pieceFrames } from '../src/sdf/labels';
import { useAnimeBody } from './animeBody';

useAnimeBody();

const make = (overrides: BodySpec['overrides'] = {}): BodySpec => ({ ...defaultSpec(), hands: 'fingers', overrides });
const body = (spec: BodySpec): Part[] => buildFigure(spec).parts.filter((p) => p.material !== 'eye');
const voxel = VOXEL.draft;
const blend = 0.02;

/** points 里第 i 个点离 cloud 里最近的点有多远（一个个比，测试用） */
function nearest(points: Float32Array, i: number, cloud: Float32Array, from = 0): number {
  let best = Infinity;
  for (let j = from; j < cloud.length / 3; j++) {
    const d = Math.hypot(points[i * 3] - cloud[j * 3], points[i * 3 + 1] - cloud[j * 3 + 1], points[i * 3 + 2] - cloud[j * 3 + 2]);
    if (d < best) best = d;
  }
  return best;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

describe('整块挪', () => {
  const parts = body(make());
  const arm = parts.find((p) => p.type === 'arm' && p.name.endsWith('_L'))!;
  const torso = parts.find((p) => p.type === 'torso')!;
  const mesh = fuseParts(parts, { voxel, blend });
  const labels = labelVertices(parts, mesh, voxel);
  const count = mesh.positions.length / 3;
  const piece = (name: string) => labels.pieces.indexOf(name);

  it('每个顶点都认得出属于哪一块；接上去的手是它自己那一块', () => {
    expect(labels.first.length).toBe(count);
    expect(labels.first.every((v) => v !== NONE)).toBe(true);
    const hand = piece(`${arm.name}#0`);
    expect(hand).toBeGreaterThanOrEqual(0);
    const start = mesh.bound!.start;
    let onHand = 0;
    for (let v = start; v < count; v++) if (labels.first[v] === hand) onHand++;
    expect(onHand).toBeGreaterThan(500);
    // 身体上的顶点不会认成手
    for (let v = 0; v < start; v++) expect(labels.first[v]).not.toBe(hand);
    let onArm = 0;
    for (let v = 0; v < start; v++) if (labels.first[v] === piece(arm.name)) onArm++;
    expect(onArm).toBeGreaterThan(50);
  });

  it('只是挪了部件、拉长了手臂还算同一副身体；换了样式、多了部件就不是', () => {
    const same = outline(parts);
    expect(outline(body(make({ [arm.name]: { position: [0.04, 0, 0], scale: [1, 1.4, 1] } })))).toBe(same);
    expect(outline(body({ ...make(), shape: { ...make().shape, armLength: 1.2 } }))).toBe(same);
    expect(outline(body({ ...make(), bodyStyle: 'anime' }))).not.toBe(same);
    expect(outline(body({ ...make(), counts: { ...make().counts, armPairs: 2 } }))).not.toBe(same);
  });

  it('融合任务里要了才标，摆姿势的不标', () => {
    expect(runJob({ parts, voxel, blend, labels: true }).labels?.first.length).toBe(count);
    expect(runJob({ parts, voxel, blend }).labels).toBeUndefined();
  });

  it('什么都没动：每一块都不用搬，顶点原样', () => {
    const frames = pieceFrames(parts);
    const moves = followMatrices(labels.pieces, frames, pieceFrames(body(make())));
    expect(moves.every((m) => m === null)).toBe(true);
    const out = new Float32Array(mesh.positions.length);
    const normals = new Float32Array(mesh.normals.length);
    expect(followInto(labels, moves, mesh.positions, mesh.normals, out, normals)).toBe(0);
    expect(out).toEqual(mesh.positions);
  });

  it('手臂挪了、转了：手和手臂照新位置融合出来的对得上，躯干不动', () => {
    const moved = body(make({ [arm.name]: { position: [0.04, 0.03, 0.02], rotation: [0, 0, 25] } }));
    const moves = followMatrices(labels.pieces, pieceFrames(parts), pieceFrames(moved));
    expect(moves[piece(arm.name)]).not.toBeNull();
    expect(moves[piece(torso.name)]).toBeNull();
    const out = new Float32Array(mesh.positions.length);
    const normals = new Float32Array(mesh.normals.length);
    const far = followInto(labels, moves, mesh.positions, mesh.normals, out, normals);
    expect(far).toBeGreaterThan(0.05);

    const fresh = fuseParts(moved, { voxel, blend });
    // 手是现成的网格，照手腕挪过去：和重新融合出来的那只手几乎重合
    const hand = piece(`${arm.name}#0`);
    const handGaps: number[] = [];
    for (let v = mesh.bound!.start; v < count; v += 7) if (labels.first[v] === hand) handGaps.push(nearest(out, v, fresh.positions, fresh.bound!.start));
    expect(median(handGaps)).toBeLessThan(0.001);
    // 手臂中段（不在接缝上的）：离新网格的表面不到半个体素
    const armGaps: number[] = [];
    for (let v = 0; v < mesh.bound!.start; v++) {
      if (labels.first[v] === piece(arm.name) && labels.mix[v] === 0) armGaps.push(nearest(out, v, fresh.positions));
    }
    expect(armGaps.length).toBeGreaterThan(20);
    expect(median(armGaps)).toBeLessThan(voxel * 0.5);
    // 认躯干、不在接缝上的顶点一动不动
    for (let v = 0; v < count; v++) {
      if (labels.first[v] !== piece(torso.name) || labels.mix[v] !== 0) continue;
      expect(out[v * 3]).toBe(mesh.positions[v * 3]);
      expect(out[v * 3 + 1]).toBe(mesh.positions[v * 3 + 1]);
    }
  });
});
