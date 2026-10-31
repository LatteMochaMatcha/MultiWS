/**
 * 从动作素材里取姿势：读 assets/source/quaternius-animation 里的两个 GLB（Quaternius 的 Universal Animation Library，CC0），
 * 照 tools/poses.json 列的「哪个动作、放到第几成的地方」一帧一帧取出来，换成工坊的姿势数据，写到 src/pose/library.json。
 *
 *   node tools/run.mjs tools/build-poses.ts              重新生成 src/pose/library.json
 *   node tools/run.mjs tools/build-poses.ts --all 文件    每个动作取几帧写到指定的文件里（挑姿势的时候看的，不进工坊）
 *
 * 素材的骨架是 Unreal 那套名字（pelvis、spine_01、upperarm_l …），静止姿势是 A-pose；怎么换算见 src/pose/retarget.ts。
 *
 * 手指也一起取。素材里很多动作没有特意摆手，手是攥着拳的（站着、走路也是）：
 * poses.json 里给这样的姿势写上 "hands": "relax"，那只攥着拳的手就换成自然放松的样子（特意摆过的手不动）；
 * "relax-left" / "relax-right" 是只换一只手（另一只拳头是握着东西的）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { type Quat, type V3, add, mul, quatConj, quatMul, rotate } from '../src/geometry/vec';
import { type GlbDoc, readAccessor, readGlb } from '../src/io/glbRead';
import { RELAXED, posingHand, withPosingHand } from '../src/pose/fingers';
import { quatUnit } from '../src/pose/math';
import type { Posing } from '../src/pose/posing';
import { type SourceBone, posingFromBones } from '../src/pose/retarget';

const SOURCE = 'assets/source/quaternius-animation';
const FILES: Record<string, string> = {
  ual1: 'Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb',
  ual2: 'Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb',
};

/** 素材里的骨骼名 → 工坊的骨骼名 */
const NAMES: Record<string, string> = {
  pelvis: 'Hips',
  spine_01: 'Spine',
  spine_02: 'Chest',
  spine_03: 'UpperChest',
  neck_01: 'Neck',
  Head: 'Head',
};
for (const [side, tag] of [['l', 'L'], ['r', 'R']]) {
  Object.assign(NAMES, {
    [`clavicle_${side}`]: `Shoulder_${tag}`,
    [`upperarm_${side}`]: `UpperArm_${tag}`,
    [`lowerarm_${side}`]: `LowerArm_${tag}`,
    [`hand_${side}`]: `Hand_${tag}`,
    [`thigh_${side}`]: `UpperLeg_${tag}`,
    [`calf_${side}`]: `LowerLeg_${tag}`,
    [`foot_${side}`]: `Foot_${tag}`,
    [`ball_${side}`]: `Toes_${tag}`,
  });
  // 手指：每根三节（素材里叫 index_01_l …；小指叫 pinky）
  for (const [from, to] of [['thumb', 'Thumb'], ['index', 'Index'], ['middle', 'Middle'], ['ring', 'Ring'], ['pinky', 'Little']]) {
    for (const k of [1, 2, 3]) NAMES[`${from}_0${k}_${side}`] = `${to}${k}_${tag}`;
  }
}
/** 骨骼的终点：素材里每根手指的末梢有一个不带权重的小骨骼（index_04_leaf_l），拿它当最后一节的终点 */
const LEAF = /_leaf_[lr]$/;

interface Track {
  path: 'translation' | 'rotation' | 'scale';
  times: Float32Array;
  values: Float32Array;
  /** CUBICSPLINE 的每个关键帧是「入切线、值、出切线」三份，只用中间那份 */
  spline: boolean;
}

interface Clip {
  duration: number;
  /** 节点下标 → 它的几条轨道 */
  tracks: Map<number, Track[]>;
}

/** 每个节点在世界里的位置、朝向和（等比的）缩放 */
interface World {
  pos: V3[];
  rot: Quat[];
}

class Library {
  readonly doc: GlbDoc;
  readonly parent: number[];
  /** 父节点排在子节点前面的一个顺序 */
  readonly order: number[] = [];
  readonly clips = new Map<string, Clip>();
  readonly rest: World;

  constructor(buffer: ArrayBuffer) {
    this.doc = readGlb(buffer);
    const nodes: { children?: number[] }[] = this.doc.json.nodes;
    this.parent = nodes.map(() => -1);
    nodes.forEach((node, i) => (node.children ?? []).forEach((c) => (this.parent[c] = i)));
    const visit = (i: number) => {
      this.order.push(i);
      (nodes[i].children ?? []).forEach(visit);
    };
    nodes.forEach((_, i) => this.parent[i] < 0 && visit(i));
    for (const animation of this.doc.json.animations ?? []) {
      const tracks = new Map<number, Track[]>();
      let duration = 0;
      for (const channel of animation.channels) {
        const sampler = animation.samplers[channel.sampler];
        const times = readAccessor(this.doc, sampler.input);
        duration = Math.max(duration, times[times.length - 1] ?? 0);
        const list = tracks.get(channel.target.node) ?? [];
        list.push({ path: channel.target.path, times, values: readAccessor(this.doc, sampler.output), spline: sampler.interpolation === 'CUBICSPLINE' });
        tracks.set(channel.target.node, list);
      }
      this.clips.set(animation.name, { duration, tracks });
    }
    this.rest = this.world(null, 0);
  }

  /** 某个动作放到 time 秒时，每个节点在世界里的位置和朝向；clip 是 null 就是文件里摆着的静止姿势 */
  world(clip: Clip | null, time: number): World {
    const nodes: { translation?: number[]; rotation?: number[]; scale?: number[] }[] = this.doc.json.nodes;
    const pos: V3[] = [];
    const rot: Quat[] = [];
    const scale: number[] = [];
    for (const i of this.order) {
      const node = nodes[i];
      let t = (node.translation ?? [0, 0, 0]) as V3;
      let r = (node.rotation ?? [0, 0, 0, 1]) as Quat;
      let s = node.scale ? (node.scale[0] + node.scale[1] + node.scale[2]) / 3 : 1;
      for (const track of clip?.tracks.get(i) ?? []) {
        const v = sample(track, time);
        if (track.path === 'translation') t = [v[0], v[1], v[2]];
        else if (track.path === 'rotation') r = quatUnit([v[0], v[1], v[2], v[3]]);
        else s = (v[0] + v[1] + v[2]) / 3;
      }
      const p = this.parent[i];
      if (p < 0) {
        pos[i] = t;
        rot[i] = r;
        scale[i] = s;
      } else {
        pos[i] = add(pos[p], rotate(rot[p], mul(t, scale[p])));
        rot[i] = quatUnit(quatMul(rot[p], r));
        scale[i] = scale[p] * s;
      }
    }
    return { pos, rot };
  }

  /** 某个动作放到第 at 成（0–1）的地方，换成工坊的姿势 */
  posing(clipName: string, at: number): Posing {
    const clip = this.clips.get(clipName);
    if (!clip) throw new Error(`没有叫 ${clipName} 的动作`);
    const now = this.world(clip, clip.duration * Math.max(0, Math.min(1, at)));
    const names: { name?: string; children?: number[] }[] = this.doc.json.nodes;
    const index = new Map<number, number>();
    const bones: SourceBone[] = [];
    for (const i of this.order) {
      const name = NAMES[names[i].name ?? ''];
      if (!name) continue;
      const leaf = (names[i].children ?? []).find((c) => LEAF.test(names[c].name ?? ''));
      // 父骨骼：往上找最近的一根对得上名字的
      let p = this.parent[i];
      while (p >= 0 && !index.has(p)) p = this.parent[p];
      index.set(i, bones.length);
      bones.push({
        name,
        parent: p >= 0 ? index.get(p)! : -1,
        rest: this.rest.pos[i],
        posed: now.pos[i],
        turn: quatUnit(quatMul(now.rot[i], quatConj(this.rest.rot[i]))),
        ...(leaf !== undefined ? { tail: this.rest.pos[leaf] } : {}),
      });
    }
    return posingFromBones(bones);
  }

  /** 检查素材是不是我们以为的那个样子：Y 朝上、面朝 +Z、左手边是 +X，该有的骨骼都有 */
  check(label: string) {
    const names: { name?: string }[] = this.doc.json.nodes;
    const at = (name: string) => {
      const i = names.findIndex((n) => n.name === name);
      if (i < 0) throw new Error(`${label}：没有骨骼 ${name}`);
      return this.rest.pos[i];
    };
    for (const name of Object.keys(NAMES)) at(name);
    const problems: string[] = [];
    if (at('Head')[1] < at('pelvis')[1] + 0.3) problems.push('头不在胯的上面（不是 Y 朝上？）');
    if (at('upperarm_l')[0] < 0.05) problems.push('左手臂不在 +X 那一侧');
    if (at('ball_l')[2] < at('foot_l')[2] + 0.02) problems.push('脚尖不朝 +Z');
    if (problems.length) throw new Error(`${label}：${problems.join('；')}`);
  }
}

/** 一条轨道在 time 秒时的值（两个关键帧之间直线过渡；旋转过渡完再归一） */
function sample(track: Track, time: number): number[] {
  const { times, values, path } = track;
  const size = path === 'rotation' ? 4 : 3;
  const stride = track.spline ? size * 3 : size;
  const skip = track.spline ? size : 0;
  const at = (k: number) => Array.from(values.subarray(k * stride + skip, k * stride + skip + size));
  if (time <= times[0]) return at(0);
  const last = times.length - 1;
  if (time >= times[last]) return at(last);
  let k = 0;
  while (k < last && times[k + 1] < time) k++;
  const a = at(k);
  const b = at(k + 1);
  const f = (time - times[k]) / (times[k + 1] - times[k] || 1);
  // 旋转：两个四元数隔着半个球的话把其中一个反号，走近的那一边
  const flip = path === 'rotation' && a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  return a.map((v, i) => v + (b[i] * flip - v) * f);
}

interface Pick {
  /** 给人看的名字 */
  name: string;
  /** 哪个素材文件（FILES 的键） */
  from: string;
  /** 动作的名字 */
  clip: string;
  /** 放到第几成的地方，0–1 */
  at: number;
  /** 攥着拳的手要不要换成放松的（见文件开头） */
  hands?: 'relax' | 'relax-left' | 'relax-right';
}

/** 四指每根三节加起来弯了这么多度以上，就算是素材里那个「没摆手」的拳头 */
const FIST = 215;

function relaxHands(posing: Posing, which: Pick['hands']): Posing {
  let out = posing;
  for (const tag of ['L', 'R']) {
    if (!which || (which === 'relax-left' && tag !== 'L') || (which === 'relax-right' && tag !== 'R')) continue;
    const shape = posingHand(out, tag);
    if (shape?.fingers.every((f) => f.curl[0] + f.curl[1] + f.curl[2] > FIST)) out = withPosingHand(out, tag, RELAXED);
  }
  return out;
}

export async function main(args: string[], root: string) {
  const libraries = new Map<string, Library>();
  for (const [key, path] of Object.entries(FILES)) {
    const file = readFileSync(`${root}/${SOURCE}/${path}`);
    const library = new Library(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
    library.check(key);
    libraries.set(key, library);
  }
  const line = (entry: { name: string; posing: Posing }) => `  ${JSON.stringify(entry)}`;

  if (args[0] === '--all') {
    // 每个动作在开头、四分之一、一半、四分之三的地方各取一帧，名字里写明出处
    const out: { name: string; posing: Posing }[] = [];
    for (const [key, library] of libraries) {
      for (const [clip, info] of library.clips) {
        if (clip === 'A_TPose') continue;
        for (const at of [0, 0.25, 0.5, 0.75]) out.push({ name: `${key} ${clip} ${at} (${info.duration.toFixed(2)}s)`, posing: library.posing(clip, at) });
      }
    }
    writeFileSync(args[1], `[\n${out.map(line).join(',\n')}\n]\n`);
    console.log(`写了 ${out.length} 个候选姿势到 ${args[1]}`);
    return;
  }

  const picks = JSON.parse(new TextDecoder().decode(readFileSync(`${root}/tools/poses.json`))) as Pick[];
  const out = picks.map((pick) => {
    const library = libraries.get(pick.from);
    if (!library) throw new Error(`「${pick.name}」：没有叫 ${pick.from} 的素材`);
    return { name: pick.name, posing: relaxHands(library.posing(pick.clip, pick.at), pick.hands) };
  });
  writeFileSync(`${root}/src/pose/library.json`, `[\n${out.map(line).join(',\n')}\n]\n`);
  console.log(`写了 ${out.length} 个姿势到 src/pose/library.json`);
}
