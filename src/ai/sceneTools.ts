/**
 * AI 助手的道具工具（见 docs/props-plan.md 第 7 期）：看场景里有什么道具、放一件、挪一件、删一件，
 * 让当前角色对一件道具做一键动作（坐上去、躺上去、手撑着、手扶着、背靠着、吊着、腿缠杆；拿着、两手端着、抱着、举过头顶），
 * 让一只手抓住（一只脚踩住）道具、松开、换方向（道具不动手留在上面 ↔ 道具跟着手走，见 docs/grab-plan.md 第 6 期）。
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
    // limbs：grab_prop 能用的手脚；attached：现在连着道具的地方和方向
    character: { ...scene.figure(), limbs: scene.limbs().map((l) => l.part), attached: scene.attached().map((a) => ({ part: a.part, prop: a.prop, mode: a.mode, ...(a.way ? { way: a.way } : {}) })) },
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
      'with the one-click actions the current character can do on it. character.limbs are the hands and feet grab_prop accepts; character.attached lists what is attached to props right now ' +
      '(mode holds: the limb stays on the prop and the prop does not move; carries: the prop follows that hand, foot or chest; rides: the whole character follows the prop; way, on hands that grip a bar: over = overhand, under = underhand). ' +
      'Set kinds: true to also list every kind of prop that can be added (mine: true marks models the user imported themselves).',
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
      'Put a prop into the scene. kind is a basic shape (pole, box, stand, ball, wall) or a furniture id from list_props kinds (chair, bedSingle, sofaLeather, …; ids starting with my- are models the user imported). ' +
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
      'For these the character is moved, posed and attached to the prop. Four actions do the opposite and bring the prop to the character, who stays where they stand: ' +
      'carry (one hand: a stick is gripped, anything else rests on the palm; call again for the other hand), both (carried in front with both hands), hug (held against the chest), lift (held above the head with both hands). ' +
      'After those the prop follows the hand or chest. Only actions listed for the prop by list_props are possible; the error says why not otherwise.',
    parameters: obj({ id: str(), action: str({ description: 'sit | lie | top | hold | lean | hang | wrap | carry | both | hug | lift' }) }),
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

  const part = (name: string): string => {
    const known = scene.limbs().map((l) => l.part);
    if (!known.includes(name)) throw new Error(`No limb "${name}" on the current character. Use one of: ${known.join(', ') || '(none)'}.`);
    return name;
  };
  const attachedPart = (name: string): string => {
    const now = scene.attached();
    if (!now.some((a) => a.part === name)) throw new Error(`Nothing is attached at "${name}". Attached now: ${now.map((a) => `${a.part} (${a.mode} ${a.prop})`).join(', ') || '(nothing)'}.`);
    return name;
  };
  const bool = (v: unknown) => v === true || v === 'true';
  const attachedNow = () => scene.attached().map((a) => ({ part: a.part, prop: a.prop, mode: a.mode, ...(a.way ? { way: a.way } : {}) }));

  const grabProp: AgentTool = {
    name: 'grab_prop',
    label: 'grab_prop',
    description:
      'Make ONE hand of the current character grab a prop (or one foot stand on it). The limb reaches for the nearest spot on the prop without moving the body, the palm turns onto the surface and the fingers close; ' +
      'if it cannot reach, the error says so (move the prop or the character closer, or use prop_action hold, which walks there). part is one of character.limbs from list_props. ' +
      'carry: "true" makes the prop follow that hand afterwards (carried); otherwise the prop stays put and the hand stays on it.',
    parameters: obj({ id: str(), part: str({ description: 'a limb from list_props character.limbs, e.g. Hand_L, Hand_R, Foot_L' }), carry: opt(str({ description: '"true" to carry the prop with that limb' })) }),
    executionMode: 'sequential',
    execute: async (_id, params) => {
      const p = params as { id: string; part: string; carry?: unknown };
      find(p.id);
      const done = scene.grab(part(p.part), p.id, bool(p.carry));
      return { content: text({ done, attached: attachedNow() }), details: {} };
    },
  };

  const releaseProp: AgentTool = {
    name: 'release_prop',
    label: 'release_prop',
    description:
      'Release ONE attachment of the current character: a hand or foot lets go, a hugged prop is put down (it stays where it is), or with part "body" the character stops following the prop it sits, lies or hangs on. ' +
      'part is a part from list_props character.attached.',
    parameters: obj({ part: str() }),
    executionMode: 'sequential',
    execute: async (_id, params) => {
      const p = params as { part: string };
      const done = scene.release(attachedPart(p.part));
      return { content: text({ done, attached: attachedNow() }), details: {} };
    },
  };

  const carryProp: AgentTool = {
    name: 'carry_prop',
    label: 'carry_prop',
    description:
      'Switch the direction of ONE attachment of the current character without moving anything: on "true" = the prop follows that hand or foot from now on (carried: dragging the hand, moving the character or changing the pose takes the prop along); ' +
      'on "false" = the prop stays where it is and the hand stays on it (like holding a handrail). For a hugged prop (a chest part), "false" puts it down. A prop can follow only one place at a time.',
    parameters: obj({ part: str(), on: str({ description: '"true" or "false"' }) }),
    executionMode: 'sequential',
    execute: async (_id, params) => {
      const p = params as { part: string; on: unknown };
      const done = scene.setCarry(attachedPart(p.part), bool(p.on));
      return { content: text({ done, attached: attachedNow() }), details: {} };
    },
  };

  const gripWay: AgentTool = {
    name: 'grip_way',
    label: 'grip_way',
    description:
      'Switch how ONE hand of the current character grips a bar (a pole, a stick, a rail, a chair leg): "over" = overhand (thumbs towards each other on a horizontal bar, as in a pull-up; thumb on top on an upright stick), ' +
      '"under" = underhand (as in a chin-up; reverse grip on a stick or knife). The wrist stays where it is and the palm flips over. Only hands whose entry in character.attached has a way can be switched.',
    parameters: obj({ part: str(), way: str({ description: '"over" or "under"' }) }),
    executionMode: 'sequential',
    execute: async (_id, params) => {
      const p = params as { part: string; way: string };
      if (p.way !== 'over' && p.way !== 'under') throw new Error('way must be "over" or "under".');
      const done = scene.gripWay(attachedPart(p.part), p.way);
      return { content: text({ done, attached: attachedNow() }), details: {} };
    },
  };

  return [listProps, addProp, moveProp, removeProp, propAction, grabProp, releaseProp, carryProp, gripWay];
}
