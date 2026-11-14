/**
 * AI 助手的工具（第 1 期：造型，加单独微调某个部件）。参数用 pi-schema 写；数值不在参数里设上下限
 * （设了的话模型给个越界的数整个调用就被拒），交给 applyPatch 收回范围，再把收回的告诉模型。
 */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { arr, bool, int, num, obj, oneOf, opt, str, union } from '@earendil-works/pi-schema';
import { applyParse, describeSpec, parseDescription } from '../parser';
import { clearOverride, setOverride } from '../model/overrides';
import { partLabel } from '../model/partLabel';
import { type BodySpec, COUNT_DEFS, type CountKey, HAIR_STYLES, PER_TORSO_KEYS, type PartOverride, SHAPE_DEFS, TORSO_SIDES } from '../model/spec';
import { ADULT_CHOICES, ADULT_COUNTS, ADULT_SHAPES, type Adjusted, type BodyPatch, CHOICES, type Change, applyPatch, diffSpec, stateForModel } from './body';
import type { WorkshopApi } from './workshop';

/** 工具执行完交给面板的：这一下改了什么（界面语言的句子） */
export interface ToolDetails {
  changes?: Change[];
  adjusted?: Adjusted[];
}

const text = (value: unknown) => [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }];

/** 改完回给模型的：改了哪些、哪些没照办、现在的规范描述 */
function report(api: WorkshopApi, changes: Change[], adjusted: Adjusted[]) {
  const spec = api.spec();
  return {
    content: text({
      changed: changes.map((c) => ({ field: c.field, from: c.from, to: c.to })),
      ...(adjusted.length ? { notApplied: adjusted } : {}),
      description: describeSpec(spec, 'zh'),
    }),
    details: { changes, adjusted } satisfies ToolDetails,
  };
}

/** 一轮里每次改动都用这个 key 记撤销（见 WorkshopApi.hold） */
export interface ToolContext {
  api: WorkshopApi;
  undoKey: () => string;
}

function countsSchema(adult: boolean) {
  const props: Record<string, ReturnType<typeof opt>> = {};
  for (const d of COUNT_DEFS) {
    if (!adult && ADULT_COUNTS.has(d.key)) continue;
    props[d.key] = opt(int({ description: `${d.min}–${d.max}` }));
  }
  return obj(props);
}

function shapeSchema(adult: boolean) {
  const props: Record<string, ReturnType<typeof opt>> = {};
  for (const d of SHAPE_DEFS) {
    if (!adult && ADULT_SHAPES.has(d.key)) continue;
    props[d.key] = opt(num({ description: `${d.min}–${d.max}, default ${d.def}${d.safe ? `, safe ${d.safe[0]}–${d.safe[1]}` : ''}` }));
  }
  return obj(props);
}

function torsoSchema() {
  const one: Record<string, ReturnType<typeof opt>> = {};
  for (const key of PER_TORSO_KEYS) one[key] = opt(int());
  const sides: Record<string, ReturnType<typeof opt>> = {};
  for (const side of TORSO_SIDES) sides[side] = opt(obj(one));
  return obj(sides);
}

function patchSchema(adult: boolean) {
  const props: Record<string, ReturnType<typeof opt>> = {
    fromDefault: opt(bool({ description: 'Start from the default body (a fresh standard humanoid) before applying the other fields.' })),
    counts: opt(countsSchema(adult)),
    torsoCounts: opt(torsoSchema()),
    shape: opt(shapeSchema(adult)),
    hair: opt(obj({ style: opt(oneOf(HAIR_STYLES)), color: opt(str({ description: '#rrggbb, or "" for the natural colour' })), length: opt(num()), volume: opt(num()) })),
    hipLegs: opt(int()),
    fingers: opt(int()),
    toes: opt(int()),
    blend: opt(num()),
  };
  const choices: Record<string, readonly string[]> = adult ? { ...CHOICES, ...ADULT_CHOICES } : CHOICES;
  for (const [key, values] of Object.entries(choices)) props[key] = opt(oneOf(values as readonly string[]));
  if (adult) {
    props.penisRow = opt(int());
    props.penisSoft = opt(bool());
  }
  return obj(props);
}

/** 第 1 期的三个工具。adult 变了要重新建（参数里有没有成人部件那几项） */
export function bodyTools(ctx: ToolContext, adult: boolean): AgentTool[] {
  const { api } = ctx;
  const apply = (patch: BodyPatch) => {
    const before = api.spec();
    const { spec: next, adjusted } = applyPatch(before, patch, api.adultOn());
    const after = api.apply(next, ctx.undoKey());
    return report(api, diffSpec(before, after), adjusted);
  };

  const getState: AgentTool = {
    name: 'get_state',
    label: 'get_state',
    description: 'Read the current character: all editable settings and the canonical description. Call this before editing if you are unsure of the current state.',
    parameters: obj({}),
    executionMode: 'sequential',
    execute: async () => ({
      content: text({ settings: stateForModel(api.spec(), api.adultOn()), description: describeSpec(api.spec(), 'zh') }),
      details: {},
    }),
  };

  const parse: AgentTool = {
    name: 'parse_description',
    label: 'parse_description',
    description:
      'Run the workshop\'s own rule-based parser on a short description (Chinese, English or Japanese), e.g. "三头六臂，九条尾巴" or "4 arms, 2 heads, centaur". ' +
      'mode "replace": every part count not mentioned goes back to its default (use for describing a whole new body). ' +
      'mode "merge": only the parts the text mentions change (use for "add a pair of wings"). ' +
      'The result lists what changed; if the parser did not recognise something, use set_body instead.',
    parameters: obj({ text: str(), mode: oneOf(['replace', 'merge'] as const) }),
    executionMode: 'sequential',
    execute: async (_id, params) => {
      const { text: words, mode } = params as { text: string; mode: 'replace' | 'merge' };
      const r = parseDescription(words);
      const before = api.spec();
      let next = applyParse(before, r);
      if (mode === 'merge') {
        // 只认文字里提到的部件；排布只在说了不是默认的时候改
        const counts = { ...before.counts };
        for (const key of r.hits) counts[key as CountKey] = r.counts[key as CountKey];
        next = {
          ...next,
          counts,
          torsoCounts: Object.keys(r.torsoCounts).length ? r.torsoCounts : before.torsoCounts,
          headLayout: r.headLayout !== 'cluster' ? r.headLayout : before.headLayout,
          armLayout: r.armLayout !== 'stack' ? r.armLayout : before.armLayout,
          legLayout: r.legLayout !== 'auto' ? r.legLayout : before.legLayout,
          hipLegs: r.hits.has('legs') ? r.hipLegs : before.hipLegs,
          penisLayout: r.penisLayout !== 'row' ? r.penisLayout : before.penisLayout,
          penisRow: r.penisRow,
          scrotum: r.scrotum !== 'shared' ? r.scrotum : before.scrotum,
        };
      }
      const { spec: clean, adjusted } = applyPatch(next, {}, api.adultOn());
      const after = api.apply(clean, ctx.undoKey());
      const out = report(api, diffSpec(before, after), adjusted);
      const recognised = r.matches.map((m) => m.text);
      out.content = text({ recognised, ...JSON.parse(out.content[0].text) });
      return out;
    },
  };

  const setBody: AgentTool = {
    name: 'set_body',
    label: 'set_body',
    description:
      'Change body settings. Only include the fields you want to change; everything else stays. ' +
      'Out-of-range numbers are clamped and unsupported values are dropped; the result reports them under "notApplied" — tell the user when something could not be done.',
    parameters: patchSchema(adult),
    executionMode: 'sequential',
    execute: async (_id, params) => apply(params as BodyPatch),
  };

  return [getState, parse, setBody, ...partTools(ctx)];
}

/* ---------------- 单独微调某个部件（和「微调」那一栏一样的数据：BodySpec.overrides / characterOverrides） ---------------- */

const vec3 = () => arr(num(), { minItems: 3, maxItems: 3 });

interface TweakParams {
  part: string;
  move?: number[];
  rotate?: number[];
  scale?: number | number[];
  mirror?: boolean;
  reset?: boolean;
}

export function partTools(ctx: ToolContext): AgentTool[] {
  const { api } = ctx;
  const current = () => {
    const spec = api.spec();
    return spec.bodyStyle === 'character' ? spec.characterOverrides : spec.overrides;
  };

  const listParts: AgentTool = {
    name: 'list_parts',
    label: 'list_parts',
    description:
      'List the parts that can be tweaked one by one (the same list as the "Tweak" panel), with a readable label and any tweak already applied. ' +
      'Names look like Arm_02_L (second arm, on the character’s own left), Leg_01_R, Head_01, Tail_03, Wing_01_L.',
    parameters: obj({}),
    executionMode: 'sequential',
    execute: async () => {
      const tweaks = current();
      return { content: text(api.parts().map((name) => ({ name, label: partLabel(name), ...(tweaks[name] ? { tweak: tweaks[name] } : {}) }))), details: {} };
    },
  };

  const tweakPart: AgentTool = {
    name: 'tweak_part',
    label: 'tweak_part',
    description:
      'Move, rotate or scale ONE part (use for requests about a specific part, e.g. the part the user circled). The values are the whole tweak of the part, replacing what it had: ' +
      'move = [x, y, z] metres relative to its parent part (x = toward the character’s left, y = up, z = forward); ' +
      'rotate = [x, y, z] degrees around its own joint; scale = a single number (uniform, about its joint) or [x, y, z]. ' +
      'Omit a field to keep it. reset = true puts the part back where the generator placed it. ' +
      'mirror (default true) applies the mirrored tweak to the left/right twin too; set false to change only this side. ' +
      'Call list_parts first if you are unsure of names or current values.',
    parameters: obj({
      part: str(),
      move: opt(vec3()),
      rotate: opt(vec3()),
      scale: opt(union([num(), vec3()])),
      mirror: opt(bool()),
      reset: opt(bool()),
    }),
    executionMode: 'sequential',
    execute: async (_id, params) => {
      const p = params as TweakParams;
      const names = api.parts();
      if (!names.includes(p.part)) {
        throw new Error(`Unknown part "${p.part}". Parts: ${names.join(', ')}`);
      }
      const mirror = p.mirror !== false;
      const before = api.spec();
      let next: BodySpec;
      if (p.reset) next = clearOverride(before, p.part, mirror);
      else {
        const patch: PartOverride = {};
        if (p.move) patch.position = [p.move[0], p.move[1], p.move[2]];
        if (p.rotate) patch.rotation = [p.rotate[0], p.rotate[1], p.rotate[2]];
        if (p.scale !== undefined) patch.scale = typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : [p.scale[0], p.scale[1], p.scale[2]];
        next = setOverride(before, p.part, patch, mirror);
      }
      const after = api.apply(next, ctx.undoKey());
      const out = report(api, diffSpec(before, after), []);
      const tweaks = after.bodyStyle === 'character' ? after.characterOverrides : after.overrides;
      out.content = text({ part: p.part, label: partLabel(p.part), tweak: tweaks[p.part] ?? null, ...JSON.parse(out.content[0].text) });
      return out;
    },
  };

  return [listParts, tweakPart];
}

