/**
 * AI 助手的道具工具（见 docs/props-plan.md 第 7 期）：看场景里有什么道具、放一件、挪一件、删一件，
 * 让当前角色对一件道具做一键动作（坐上去、躺上去、手撑着、手扶着、背靠着、吊着、腿缠杆）。
 * 只经过 WorkshopApi.scene 动场景；工坊没给这一块（测试里的假工坊）就一个工具都没有。
 */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { num, obj, opt, str } from '@earendil-works/pi-schema';
import type { PropChange, PropInfo, SceneApi } from './workshop';

const text = (value: unknown) => [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }];
const round = (v: number) => Math.round(v * 1000) / 1000;

/** 回给模型的一件道具：数留到毫米 */
const brief = (p: PropInfo) => ({ id: p.id, name: p.name, kind: p.kind, size: p.size.map(round), pos: p.pos.map(round), rot: p.rot.map(round), color: p.color });

/** 位置、角度、尺寸、颜色、名字：放和挪共用的那几项 */
const PLACING = {
  x: opt(num({ description: 'metres; +x is to the left of a character standing at yaw 0' })),
  y: opt(num({ description: 'metres above the floor (bottom of the prop)' })),
  z: opt(num({ description: 'metres; +z is in front of a character standing at yaw 0' })),
  yaw: opt(num({ description: 'degrees, turn about the vertical axis' })),
  tiltX: opt(num({ description: 'degrees, tilt forward/back (90 lays a wall panel flat)' })),
  tiltZ: opt(num({ description: 'degrees, tilt left/right (90 turns an upright pole into a horizontal bar)' })),
  width: opt(num({ description: 'metres' })),
  height: opt(num({ description: 'metres' })),
  depth: opt(num({ description: 'metres' })),
  color: opt(str({ description: '#rrggbb' })),
  name: opt(str()),
};

interface Placing {
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  tiltX?: number;
  tiltZ?: number;
  width?: number;
  height?: number;
  depth?: number;
  color?: string;
  name?: string;
}

/** 模型给的那几项 → 要改的字段；没给的照 base 留着（放新道具时 base 是空的：没给位置就让工坊自己找空地） */
function changeOf(p: Placing, base?: PropInfo): PropChange {
  const out: PropChange = {};
  const given = (...values: unknown[]) => values.some((v) => typeof v === 'number' && Number.isFinite(v));
  const pick = (v: number | undefined, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  if (given(p.x, p.y, p.z) && (base || given(p.x, p.z))) out.pos = [pick(p.x, base?.pos[0] ?? 0), pick(p.y, base?.pos[1] ?? 0), pick(p.z, base?.pos[2] ?? 0)];
  else if (given(p.y) && !base) out.lift = p.y;
  if (given(p.yaw, p.tiltX, p.tiltZ)) out.rot = [pick(p.tiltX, base?.rot[0] ?? 0), pick(p.yaw, base?.rot[1] ?? 0), pick(p.tiltZ, base?.rot[2] ?? 0)];
  if (given(p.width, p.height, p.depth)) out.size = [pick(p.width, base?.size[0] ?? NaN), pick(p.height, base?.size[1] ?? NaN), pick(p.depth, base?.size[2] ?? NaN)];
  if (typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color)) out.color = p.color.toLowerCase();
  if (typeof p.name === 'string') out.name = p.name;
  return out;
}

export function sceneTools(scene: SceneApi | undefined): AgentTool[] {
  if (!scene) return [];
  const find = (id: string): PropInfo => {
    const prop = scene.props().find((p) => p.id === id);
    if (!prop) throw new Error(`No prop "${id}". Props in the scene: ${scene.props().map((p) => p.id).join(', ') || '(none)'}.`);
    return prop;
  };
  const state = () => ({
    character: scene.figure(),
    props: scene.props().map((p) => ({
      ...brief(p),
      actions: scene
        .actions(p.id)
        .filter((a) => !a.block)
        .map((a) => a.key),
    })),
  });

  const listProps: AgentTool = {
    name: 'list_props',
    label: 'list_props',
    description:
      'Read the scene: where the current character stands (x, z, yaw, y = height above the floor) and every prop (id, kind, size [width, height, depth], pos [x, y, z] of the bottom centre, rot [tiltX, yaw, tiltZ]) ' +
      'with the one-click actions the current character can do on it. Set kinds: true to also list every kind of prop that can be added.',
    parameters: obj({ kinds: opt(str({ description: '"true" to include the catalogue of prop kinds' })) }),
    executionMode: 'sequential',
    execute: async (_id, params) => {
      const want = (params as { kinds?: unknown }).kinds;
      return { content: text({ ...state(), ...(want === true || want === 'true' ? { kinds: scene.kinds() } : {}) }), details: {} };
    },
  };

  const addProp: AgentTool = {
    name: 'add_prop',
    label: 'add_prop',
    description:
      'Put a prop into the scene. kind is a basic shape (pole, box, stand, ball, wall) or a furniture id from list_props kinds (chair, bedSingle, sofaLeather, …). ' +
      'Without x/z the workshop finds a free spot beside the current character. Sizes are optional (the default is life-size). Realistic furniture is downloaded the first time it is used.',
    parameters: obj({ kind: str(), ...PLACING }),
    executionMode: 'sequential',
    execute: async (_id, params) => {
      const p = params as Placing & { kind: string };
      const made = await scene.add(p.kind, changeOf(p));
      return { content: text({ added: brief(made), actions: scene.actions(made.id).filter((a) => !a.block).map((a) => a.key) }), details: {} };
    },
  };

  const moveProp: AgentTool = {
    name: 'move_prop',
    label: 'move_prop',
    description: 'Move, turn, resize, recolour or rename ONE prop; only the fields you pass change. A character attached to the prop (sitting on it, hanging from it, a hand pinned to it) follows.',
    parameters: obj({ id: str(), ...PLACING }),
    executionMode: 'sequential',
    execute: async (_id, params) => {
      const p = params as Placing & { id: string };
      const change = changeOf(p, find(p.id));
      if (!Object.keys(change).length) throw new Error('Nothing to change: pass at least one of x, y, z, yaw, tiltX, tiltZ, width, height, depth, color, name.');
      return { content: text({ prop: brief(scene.change(p.id, change)) }), details: {} };
    },
  };

  const removeProp: AgentTool = {
    name: 'remove_prop',
    label: 'remove_prop',
    description: 'Remove ONE prop from the scene (anything attached to it is released).',
    parameters: obj({ id: str() }),
    executionMode: 'sequential',
    execute: async (_id, params) => {
      const p = params as { id: string };
      find(p.id);
      scene.remove(p.id);
      return { content: text({ removed: p.id, props: scene.props().map((q) => q.id) }), details: {} };
    },
  };

  const propAction: AgentTool = {
    name: 'prop_action',
    label: 'prop_action',
    description:
      'Make the CURRENT character use a prop in one step: sit (sit on it), lie (lie on it), top (stand and lean both hands on a table top), hold (one hand on it; call again for the other hand), ' +
      'lean (lean the back against it), hang (hang from a horizontal bar by both hands), wrap (climb an upright pole with both legs wrapped around it). ' +
      'The character is moved, posed and attached to the prop. Only actions listed for the prop by list_props are possible; the error says why not otherwise.',
    parameters: obj({ id: str(), action: str({ description: 'sit | lie | top | hold | lean | hang | wrap' }) }),
    executionMode: 'sequential',
    execute: async (_id, params) => {
      const p = params as { id: string; action: string };
      find(p.id);
      const known = scene.actions(p.id).find((a) => a.key === p.action);
      if (!known) throw new Error(`Unknown action "${p.action}". Use one of: ${scene.actions(p.id).map((a) => a.key).join(', ')}.`);
      if (known.block) throw new Error(known.block);
      const done = scene.act(p.id, p.action);
      return { content: text({ done, character: scene.figure() }), details: {} };
    },
  };

  return [listProps, addProp, moveProp, removeProp, propAction];
}
