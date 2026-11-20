// AI 助手的道具工具（src/ai/sceneTools.ts）：列出、放、挪、删道具，让当前角色做一键动作
import { describe, expect, it } from 'vitest';
import { sceneTools } from '../src/ai/sceneTools';
import type { PropChange, PropInfo, SceneApi } from '../src/ai/workshop';

/** 假场景：只记道具和做过的动作 */
function fakeScene() {
  const props: PropInfo[] = [];
  const acted: string[] = [];
  let next = 1;
  const apply = (p: PropInfo, c: PropChange) => {
    if (c.pos) p.pos = c.pos;
    if (c.rot) p.rot = c.rot;
    if (c.size) p.size = c.size.map((v, i) => (Number.isFinite(v) ? v : p.size[i])) as PropInfo['size'];
    if (c.color) p.color = c.color;
    if (c.name !== undefined) p.name = c.name;
  };
  const scene: SceneApi = {
    props: () => props.map((p) => ({ ...p })),
    kinds: () => [
      { kind: 'pole', name: '杆', size: [0.05, 2.4, 0.05] },
      { kind: 'chair', name: '椅子', size: [0.4, 0.8, 0.4] },
      { kind: 'sofaLeather', name: '皮面沙发', size: [1.8, 0.7, 0.8], real: true },
    ],
    figure: () => ({ name: '角色 1', x: 0, z: 0, yaw: 0, y: 0 }),
    async add(kind, change) {
      const base = scene.kinds().find((k) => k.kind === kind);
      if (!base) throw new Error(`没有「${kind}」这种道具`);
      const made: PropInfo = { id: `p${next++}`, name: base.name, kind, size: [...base.size], pos: [-0.8, change.lift ?? 0, 0], rot: [0, 0, 0], color: '#e7eaeb' };
      apply(made, change);
      props.push(made);
      return { ...made };
    },
    change(id, change) {
      const p = props.find((q) => q.id === id);
      if (!p) throw new Error('场景里没有这件道具');
      apply(p, change);
      return { ...p };
    },
    remove(id) {
      props.splice(props.findIndex((p) => p.id === id), 1);
    },
    actions: (id) => {
      const p = props.find((q) => q.id === id)!;
      return [
        { key: 'sit', label: '坐上去', block: p.kind === 'chair' ? null : '这件道具上没有能坐的地方' },
        { key: 'hold', label: '手扶着', block: null },
        { key: 'hang', label: '吊着', block: p.kind === 'pole' && p.rot[2] === 90 ? null : '杆要横着才吊得上去' },
      ];
    },
    act(id, action) {
      acted.push(`${id}:${action}`);
      return `做了 ${action}`;
    },
  };
  return { scene, props, acted };
}

const tool = (scene: SceneApi, name: string) => sceneTools(scene).find((t) => t.name === name)!;
async function call(scene: SceneApi, name: string, params: Record<string, unknown>) {
  const out = await tool(scene, name).execute('t1', params as never);
  return JSON.parse((out.content[0] as { text: string }).text) as Record<string, unknown>;
}

describe('AI 助手的道具工具', () => {
  it('工坊没给场景那一块：一个工具都没有；给了是五个', () => {
    expect(sceneTools(undefined)).toEqual([]);
    expect(sceneTools(fakeScene().scene).map((t) => t.name)).toEqual(['list_props', 'add_prop', 'move_prop', 'remove_prop', 'prop_action']);
  });

  it('list_props：角色站在哪、每件道具和它上面能做的动作；要了才带种类清单', async () => {
    const { scene } = fakeScene();
    await scene.add('chair', {});
    const got = await call(scene, 'list_props', {});
    expect(got.character).toEqual({ name: '角色 1', x: 0, z: 0, yaw: 0, y: 0 });
    expect(got.props).toEqual([{ id: 'p1', name: '椅子', kind: 'chair', size: [0.4, 0.8, 0.4], pos: [-0.8, 0, 0], rot: [0, 0, 0], color: '#e7eaeb', actions: ['sit', 'hold'] }]);
    expect(got.kinds).toBeUndefined();
    expect(((await call(scene, 'list_props', { kinds: 'true' })).kinds as unknown[]).length).toBe(3);
  });

  it('add_prop：没给位置的让工坊找空地（只给高度也行），给了的照给的；尺寸只改给了的那几项', async () => {
    const { scene, props } = fakeScene();
    const a = await call(scene, 'add_prop', { kind: 'pole', y: 2.1, tiltZ: 90 });
    expect((a.added as PropInfo).pos).toEqual([-0.8, 2.1, 0]);
    expect((a.added as PropInfo).rot).toEqual([0, 0, 90]);
    expect(a.actions).toEqual(['hold', 'hang']);
    await call(scene, 'add_prop', { kind: 'chair', x: 1, z: 2, yaw: 45, height: 1, color: '#FF0000', name: '红椅子' });
    expect(props[1]).toMatchObject({ pos: [1, 0, 2], rot: [0, 45, 0], size: [0.4, 1, 0.4], color: '#ff0000', name: '红椅子' });
    await expect(call(scene, 'add_prop', { kind: 'spaceship' })).rejects.toThrow(/spaceship/);
  });

  it('move_prop：只动给了的那几项；什么都没给、没有这件都报错', async () => {
    const { scene, props } = fakeScene();
    await scene.add('chair', { pos: [1, 0, 2], rot: [0, 30, 0] });
    await call(scene, 'move_prop', { id: 'p1', x: -2 });
    expect(props[0].pos).toEqual([-2, 0, 2]);
    expect(props[0].rot).toEqual([0, 30, 0]);
    await call(scene, 'move_prop', { id: 'p1', yaw: 90, width: 0.6 });
    expect(props[0].rot).toEqual([0, 90, 0]);
    expect(props[0].size).toEqual([0.6, 0.8, 0.4]);
    await expect(call(scene, 'move_prop', { id: 'p1' })).rejects.toThrow(/Nothing to change/);
    await expect(call(scene, 'move_prop', { id: 'p9', x: 1 })).rejects.toThrow(/No prop "p9"/);
  });

  it('remove_prop、prop_action：做不了的把原因告诉模型，没做', async () => {
    const { scene, props, acted } = fakeScene();
    await scene.add('chair', {});
    await scene.add('pole', {});
    expect((await call(scene, 'prop_action', { id: 'p1', action: 'sit' })).done).toBe('做了 sit');
    await expect(call(scene, 'prop_action', { id: 'p2', action: 'hang' })).rejects.toThrow(/横着/);
    await expect(call(scene, 'prop_action', { id: 'p2', action: 'fly' })).rejects.toThrow(/Unknown action/);
    expect(acted).toEqual(['p1:sit']);
    expect((await call(scene, 'remove_prop', { id: 'p1' })).props).toEqual(['p2']);
    expect(props.map((p) => p.id)).toEqual(['p2']);
  });
});
