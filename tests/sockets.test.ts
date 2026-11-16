// 体块第 5 期：连接点（接口）——接的时候吸到接口上，体型变了跟着走（见 docs/blocks-plan.md）
import { describe, expect, it } from 'vitest';
import { type Figure, worldTransforms } from '../src/geometry/figure';
import { beforeAttach, buildFigure } from '../src/geometry/layout';
import { nearestSocket, socketMap } from '../src/geometry/sockets';
import { type V3, add, len, sub } from '../src/geometry/vec';
import { SNAP_REACH, attachParts, detachParts, placedSockets } from '../src/model/attach';
import { addBlock } from '../src/model/blocks';
import { setOverride } from '../src/model/overrides';
import { type BodySpec, defaultSpec, normalizeSpec, parseSpecJson, serializeSpec } from '../src/model/spec';
import { buildSkeleton } from '../src/rig/skeleton';
import { useAnimeBody } from './animeBody';

useAnimeBody();

const STYLES = ['mannequin', 'anime'] as const;
const specOf = (patch: Partial<BodySpec> = {}): BodySpec => normalizeSpec({ ...defaultSpec(), ...patch });
const at = (figure: Figure, name: string) => worldTransforms(figure).get(name)!.pos;

describe.each(STYLES)('接口（%s）', (bodyStyle) => {
  const spec = specOf({ bodyStyle, counts: { ...defaultSpec().counts, tails: 1 } });
  const figure = buildFigure(spec);
  const placed = placedSockets(spec, figure);
  const on = (host: string, id: string) => {
    const found = placed.find((s) => s.host === host && s.id === id);
    if (!found) throw new Error(`${host} 上没有接口 ${id}`);
    return found;
  };

  it('躯干上有肩、髋、脖子根、尾巴根、胸的接口，就在这些部件本来长的地方', () => {
    const sockets = socketMap(beforeAttach(spec).parts).get('Torso')!;
    const kinds = new Map(sockets.map((s) => [s.id, s.kind]));
    expect(kinds.get('p:Arm_01_L')).toBe('shoulder');
    expect(kinds.get('p:Arm_01_R')).toBe('shoulder');
    expect(kinds.get('p:Leg_01_L')).toBe('hip');
    expect(kinds.get('p:Neck_01')).toBe('neck');
    expect(kinds.get('p:Tail_01')).toBe('tail');
    expect(kinds.get('p:Chest_01_L')).toBe('chest');
    expect(kinds.get('j:Hips')).toBe('joint');
    for (const name of ['Arm_01_L', 'Leg_01_R', 'Neck_01', 'Tail_01']) expect(len(sub(on('Torso', `p:${name}`).world, at(figure, name)))).toBeLessThan(1e-6);
    // 手臂上有肩、肘、腕的关节，末端在指尖或者手那一节的头上
    const arm = socketMap(beforeAttach(spec).parts).get('Arm_01_L')!;
    expect(arm.filter((s) => s.kind === 'joint').length).toBeGreaterThanOrEqual(3);
    expect(arm.some((s) => s.kind === 'tip')).toBe(true);
  });

  it('找最近的接口：只看够得着的，对得上的那一种优先', () => {
    const torso = placed.filter((s) => s.host === 'Torso');
    const shoulder = on('Torso', 'p:Arm_01_L');
    expect(nearestSocket(torso, add(shoulder.world, [0.01, 0, 0]), 0.1)?.id).toBe('p:Arm_01_L');
    expect(nearestSocket(torso, add(shoulder.world, [3, 0, 0]), 0.1)).toBeUndefined();
    // 离脖子根近一点、离肩远一点的地方：手臂还是吸到肩上
    const neck = on('Torso', 'p:Neck_01');
    const between: V3 = [neck.world[0] + (shoulder.world[0] - neck.world[0]) * 0.4, neck.world[1] + (shoulder.world[1] - neck.world[1]) * 0.4, neck.world[2] + (shoulder.world[2] - neck.world[2]) * 0.4];
    expect(nearestSocket([neck, shoulder], between, 1)?.id).toBe('p:Neck_01');
    expect(nearestSocket([neck, shoulder], between, 1, ['shoulder'])?.id).toBe('p:Arm_01_L');
  });

  it('接的时候点在接口附近：吸到接口上；点得远就留在原地', () => {
    const copied = addBlock(spec, [{ from: 'Arm_01_L', shift: [0.1, -0.3, 0.1] }]).spec;
    const before = buildFigure(copied);
    const hip = placedSockets(copied, before).find((s) => s.host === 'Torso' && s.id === 'p:Leg_01_L')!;
    // 点在左髋旁边 3 厘米：复制出来的手臂根吸到左髋上
    const near = attachParts(copied, ['Arm_101_L'], 'Torso', { at: add(hip.world, [0.03 * before.scale, 0, 0]) });
    expect(near.snapped).toEqual(['Arm_101_L']);
    expect(near.spec.blocks!.attach!.Arm_101_L.socket).toBe('p:Leg_01_L');
    expect(near.spec.blocks!.attach!.Arm_101_L.offset).toBeUndefined();
    const snapped = buildFigure(near.spec);
    expect(len(sub(at(snapped, 'Arm_101_L'), hip.world))).toBeLessThan(1e-4);
    expect(() => buildSkeleton(snapped)).not.toThrow();
    // 点得离哪个接口都远（躯干前面半米）：不吸，留在原地
    const far = attachParts(copied, ['Arm_101_L'], 'Torso', { at: [0, hip.world[1], 0.5 + SNAP_REACH] });
    expect(far.snapped).toEqual([]);
    expect(far.spec.blocks!.attach!.Arm_101_L.socket).toBeUndefined();
    expect(len(sub(at(buildFigure(far.spec), 'Arm_101_L'), at(before, 'Arm_101_L')))).toBeLessThan(1e-4);
    // 不给点中的地方：和以前一样留在原地
    expect(attachParts(copied, ['Arm_101_L'], 'Torso').spec.blocks!.attach!.Arm_101_L.socket).toBeUndefined();
  });

  it('吸在接口上的：体型变了接口挪了，它跟着挪；没吸在接口上的留在老地方', () => {
    const copied = addBlock(spec, [{ from: 'Arm_01_L', shift: [0.1, -0.3, 0.1] }]).spec;
    const hip = placedSockets(copied).find((s) => s.host === 'Torso' && s.id === 'p:Leg_01_L')!;
    const snapped = attachParts(copied, ['Arm_101_L'], 'Torso', { at: hip.world }).spec;
    const loose = attachParts(copied, ['Arm_101_L'], 'Torso').spec;
    // 胯加宽：髋关节往外挪了
    const wider = (s: BodySpec): BodySpec => ({ ...s, shape: { ...s.shape, hips: s.shape.hips * 1.4 } });
    const [a, b] = [buildFigure(wider(snapped)), buildFigure(wider(loose))];
    const moved = len(sub(at(a, 'Leg_01_L'), at(buildFigure(snapped), 'Leg_01_L')));
    // 吸在髋上的手臂还在髋关节上
    expect(len(sub(at(a, 'Arm_101_L'), at(a, 'Leg_01_L')))).toBeLessThan(1e-4);
    // 白模人台的髋关节跟着胯宽挪；挪了的话，没吸在接口上的那条没跟过去
    if (moved > 1e-3) expect(len(sub(at(b, 'Arm_101_L'), at(b, 'Leg_01_L')))).toBeGreaterThan(1e-3);
    // 之后再手动挪它：是在接口那里再挪
    const nudged = buildFigure(setOverride(snapped, 'Arm_101_L', { position: [0, 0.05, 0] }, false));
    expect((at(nudged, 'Arm_101_L')[1] - at(nudged, 'Leg_01_L')[1]) / nudged.scale).toBeCloseTo(0.05, 4);
  });

  it('头吸到接口上：脖子根对上接口，头跟着挪一样多；接口不在了照记下的位置', () => {
    const copied = addBlock(spec, [{ from: 'Head_01', shift: [0.3, 0, 0] }]).spec;
    const before = buildFigure(copied);
    const wrist = placedSockets(copied, before).filter((s) => s.host === 'Arm_01_L' && s.kind === 'joint').sort((p, q) => at(before, 'Arm_01_L')[1] - p.world[1] - (at(before, 'Arm_01_L')[1] - q.world[1])).pop()!;
    const joined = attachParts(copied, ['Head_101'], 'Arm_01_L', { at: wrist.world });
    expect(joined.snapped).toEqual(['Head_101']);
    const figure = buildFigure(joined.spec);
    expect(len(sub(at(figure, 'Neck_101'), wrist.world))).toBeLessThan(1e-4);
    // 头和脖子之间还是原来那么远
    expect(len(sub(at(figure, 'Head_101'), at(figure, 'Neck_101')))).toBeCloseTo(len(sub(at(before, 'Head_101'), at(before, 'Neck_101'))), 4);
    expect(joined.spec.blocks!.attach!.Head_101.socket).toBe(wrist.id);
    expect(joined.spec.blocks!.attach!.Head_101.offset).toBeDefined();
    // 存档读回来一样
    const back = buildFigure(parseSpecJson(serializeSpec(joined.spec)));
    expect(len(sub(at(back, 'Head_101'), at(figure, 'Head_101')))).toBeLessThan(1e-9);
    // 接口的名字对不上了（存档里手改的）：照记下的位置，不出错
    const broken: BodySpec = { ...joined.spec, blocks: { ...joined.spec.blocks!, attach: { ...joined.spec.blocks!.attach!, Neck_101: { ...joined.spec.blocks!.attach!.Neck_101, socket: 'j:Nothing' } } } };
    expect(len(sub(at(buildFigure(broken), 'Neck_101'), wrist.world))).toBeLessThan(1e-4);
    // 解开：回到原来的父部件上，留在原地
    const freed = buildFigure(detachParts(joined.spec, ['Head_101']));
    expect(len(sub(at(freed, 'Head_101'), at(figure, 'Head_101')))).toBeLessThan(3e-4);
  });
});
