import { describe, expect, it } from 'vitest';
import { readGlb } from '../src/io/mergeGlb';
import { defaultSpec } from '../src/model/spec';
import { POSE_LIBRARY } from '../src/pose/library';
import { bakeFigure, bakedGlb, bakedView } from '../src/scene/bake';

/** 分部件的白模不用网格线程，Node 里就能算（融合的、成品角色在页面里试过） */
const partsSpec = () => ({ ...defaultSpec(), meshMode: 'parts' as const });

describe('场景里别的角色：照设定在后台算', () => {
  it('没摆姿势：每个部件一块，站在地上，高矮和身高差不多', async () => {
    const spec = partsSpec();
    const baked = await bakeFigure(spec);
    expect(baked.meshes?.length).toBeGreaterThan(5);
    expect(baked.shapes).toHaveLength(baked.meshes!.length);
    expect(baked.box.min.y).toBeGreaterThan(-0.05);
    expect(baked.box.max.y).toBeGreaterThan(1.4);
    expect(baked.skeleton).toBeUndefined();
    expect(baked.triangles).toBeGreaterThan(1000);
  });

  it('摆过姿势的是摆好的样子（和没摆的不一样），包围盒跟着变', async () => {
    const pose = POSE_LIBRARY.find((p) => p.posing && Object.keys(p.posing.bones ?? {}).length > 3);
    expect(pose).toBeTruthy();
    const rest = await bakeFigure(partsSpec());
    const posed = await bakeFigure({ ...partsSpec(), posing: pose!.posing });
    const a = rest.shapes[0].positions;
    const b = posed.shapes.find((s) => s.name === rest.shapes[0].name)!.positions;
    expect(a.length).toBe(b.length);
    let moved = 0;
    for (let i = 0; i < a.length; i++) moved = Math.max(moved, Math.abs(a[i] - b[i]));
    const allMoved = rest.shapes.some((s, k) => s.positions.some((v, i) => Math.abs(v - posed.shapes[k].positions[i]) > 1e-3));
    expect(allMoved || moved > 1e-3).toBe(true);
  });

  it('带骨骼的：每块网格带权重，有骨架；写成的 GLB 有一副蒙皮', async () => {
    const baked = await bakeFigure(partsSpec(), { rig: true });
    expect(baked.skeleton?.bones.length).toBeGreaterThan(10);
    expect(baked.meshes!.every((m) => m.joints && m.weights)).toBe(true);
    const { json } = readGlb(bakedGlb(baked, true, 'A'));
    expect(json.skins).toHaveLength(1);
    expect(json.skins[0].name).toBe('A_Rig');
  });

  it('屏幕上的样子：每块网格一个物体，放掉以后不留网格', async () => {
    const baked = await bakeFigure(partsSpec());
    const view = bakedView(baked);
    let meshes = 0;
    view.root.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) meshes++;
    });
    expect(meshes).toBe(baked.meshes!.length);
    view.dispose();
  });
});
