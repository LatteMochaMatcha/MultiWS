// 第 5 期：「成品角色」能选的每一个角色。文件读得出来，各种形态拼得起来，表情、视线、摆姿势、换发型都用得上。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CharacterBuild, assembleCharacter, boneName, boneNames, isHairBone } from '../src/character/assemble';
import { characterGlb } from '../src/character/export';
import { applyFaces, gazeTurns, hasExpression } from '../src/character/face';
import { type HairDonor, readHair } from '../src/character/hair';
import { CHARACTER, hairUrl } from '../src/character/load';
import { ROSTER, characterUrl, rosterEntry } from '../src/character/roster';
import { type CharacterSource, readCharacter } from '../src/character/source';
import { readGlb } from '../src/io/glbRead';
import { type BodySpec, type CharacterId, CHARACTER_IDS, colorToLinear, defaultSpec, legPlan, normalizeSpec } from '../src/model/spec';
import { findHands } from '../src/pose/fingers';
import { buildHandles } from '../src/pose/handles';
import { POSE_LIBRARY } from '../src/pose/library';
import { findLimbs } from '../src/pose/limbs';
import { forward } from '../src/pose/rig';
import { makeSolver, stateOf } from '../src/pose/solver';
import { slim } from '../src/io/glbSlim';

const bytes = (path: string) => {
  const file = readFileSync(new URL(`../public/${path}`, import.meta.url));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
};
const sources = new Map<CharacterId, CharacterSource>();
function source(id: CharacterId): CharacterSource {
  let made = sources.get(id);
  if (!made) sources.set(id, (made = readCharacter(bytes(characterUrl(id)), rosterEntry(id))));
  return made;
}
const make = (id: CharacterId, rest: Partial<BodySpec> = {}, counts: Partial<BodySpec['counts']> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, bodyStyle: 'character', character: id, ...rest, counts: { ...base.counts, ...counts } };
};
const build = (id: CharacterId, rest: Partial<BodySpec> = {}, counts: Partial<BodySpec['counts']> = {}, hair: HairDonor | null = null) =>
  assembleCharacter(source(id), make(id, rest, counts), hair);
const vertices = (b: CharacterBuild, material?: RegExp) =>
  b.meshes.reduce((sum, mesh) => sum + (!material || material.test(b.materials[mesh.material].name) ? mesh.positions.length / 3 : 0), 0);
const top = (b: CharacterBuild, material?: RegExp) => {
  let high = -Infinity;
  for (const mesh of b.meshes) {
    if (material && !material.test(b.materials[mesh.material].name)) continue;
    for (let i = 1; i < mesh.positions.length; i += 3) high = Math.max(high, mesh.positions[i]);
  }
  return high;
};
/** 一份拼好的角色是不是「完整」的：没有坏数，权重加起来是 1，骨骼下标有效、名字不重复 */
function sound(b: CharacterBuild) {
  expect(new Set(b.bones.map((bone) => bone.name)).size).toBe(b.bones.length);
  for (const bone of b.bones) for (const v of [...bone.head, ...bone.tail]) expect(Number.isFinite(v)).toBe(true);
  for (const mesh of b.meshes) {
    const count = mesh.positions.length / 3;
    expect(mesh.positions.every(Number.isFinite)).toBe(true);
    let highest = 0;
    for (const index of mesh.indices) if (index > highest) highest = index;
    expect(highest).toBeLessThan(count);
    for (let v = 0; v < count; v += 7) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += mesh.weights[v * 4 + k];
        if (mesh.weights[v * 4 + k]) expect(mesh.joints[v * 4 + k]).toBeLessThan(b.bones.length);
      }
      expect(sum).toBeCloseTo(1, 4);
    }
  }
}
const donors = new Map<string, HairDonor>();
const donor = (style: 'long' | 'sidetail' | 'bob' | 'twintails') => {
  let made = donors.get(style);
  if (!made) donors.set(style, (made = readHair(bytes(hairUrl(style)))));
  return made;
};

describe('角色清单', () => {
  it('清单和设定里的名单对得上，默认的是一开始就有的那个', () => {
    expect(ROSTER.map((entry) => entry.id)).toEqual([...CHARACTER_IDS]);
    expect(defaultSpec().character).toBe('vita');
    expect(CHARACTER.url).toBe('character/vita.vrm');
    expect(new Set(ROSTER.map((entry) => entry.file)).size).toBe(ROSTER.length);
    expect(new Set(ROSTER.map((entry) => entry.label)).size).toBe(ROSTER.length);
  });

  it('每个角色的文件和小头像都在；来历、许可都写着', () => {
    for (const entry of ROSTER) {
      // 文件开头是 GLB 的标记「glTF」；头像是 JPEG
      expect([...new Uint8Array(bytes(`character/${entry.file}`), 0, 4)], entry.file).toEqual([0x67, 0x6c, 0x54, 0x46]);
      expect([...new Uint8Array(bytes(`character/thumb/${entry.id}.jpg`), 0, 2)], `${entry.id}.jpg`).toEqual([0xff, 0xd8]);
      for (const text of [entry.label, entry.name, entry.look, entry.author, entry.license]) expect(text.length).toBeGreaterThan(1);
      expect(entry.page).toMatch(/^https:\/\//);
    }
    // 要求署名的两个带着署名的那一句
    expect(rosterEntry('alice').credit).toContain('CC BY-SA');
    expect(rosterEntry('kotori').credit).toContain('CC BY');
    expect(ROSTER.filter((entry) => entry.credit).map((entry) => entry.id)).toEqual(['alice', 'kotori']);
  });

  it('设定里选了哪个角色会存下来；不认识的名字退回默认的', () => {
    expect(normalizeSpec({ bodyStyle: 'character', character: 'kuro' }).character).toBe('kuro');
    expect(normalizeSpec({ character: 'nobody' }).character).toBe('vita');
    expect(normalizeSpec({}).character).toBe('vita');
    expect(normalizeSpec(JSON.parse(JSON.stringify(make('alice')))).character).toBe('alice');
  });

  it('文件里写的许可和清单上记的一致', () => {
    // pixiv 的样例和 VRoid Hub 上的：文件里是「Other」加一个条件页；另外两个直接写着 CC 许可
    for (const id of ['vita', 'victoria', 'shino', 'shibu', 'vivi', 'rabbit', 'kuro', 'sailor'] as const) expect(source(id).license, id).toBe('Other');
    expect(source('alice').license).toBe('CC_BY_SA');
    expect(source('kotori').license).toBe('CC_BY');
  });

  it('加工过的文件再加工一遍不变（用不到的图已经都换掉了）', () => {
    const file = new Uint8Array(bytes(characterUrl('vita')));
    const again = slim(file);
    expect(again.dropped).toBeGreaterThan(5);
    expect(again.out.length).toBe(file.length);
    const a = readCharacter(bytes(characterUrl('vita')), rosterEntry('vita'));
    const b = readCharacter(again.out.buffer.slice(0) as ArrayBuffer, rosterEntry('vita'));
    expect(b.chunks.length).toBe(a.chunks.length);
    expect(b.images.map((image) => image.bytes.length)).toEqual(a.images.map((image) => image.bytes.length));
  });
});

describe('新版 VRoid 导出的命名', () => {
  it('骨骼：配饰的 J_Opt_ 也换成工坊的名字；两种头发骨骼都认', () => {
    expect(boneName('J_Opt_L_RabbitEar1_01')).toBe('RabbitEar1_01_L');
    expect(boneName('J_Sec_L_CoatSkirtBack_01')).toBe('CoatSkirtBack_01_L');
    expect(isHairBone('HairJoint-245c78de-5156-428a-a204-d0d365e05ba6')).toBe(true);
    expect(isHairBone('J_Sec_Hair3_07')).toBe(true);
    expect(isHairBone('J_Sec_L_SkirtBack0')).toBe(false);
    // 新版的头发骨骼也按一缕一缕、从根到梢叫 Hair_缕_节
    const names = boneNames(source('rabbit').bones);
    const hair = names.filter((name) => /^Hair/.test(name));
    expect(hair.length).toBeGreaterThan(20);
    for (const name of hair) expect(name).toMatch(/^Hair_\d\d_\d\d$/);
    expect(new Set(names).size).toBe(names.length);
  });

  it('材质名后面的「 (Instance)」去掉了；表情变形的名字不带 Fcl_', () => {
    for (const id of CHARACTER_IDS) {
      const s = source(id);
      for (const material of s.materials) expect(material.name).not.toMatch(/\(Instance\)/);
      for (const name of s.face!.names) expect(name, id).not.toMatch(/^Fcl_|M_[A-Z]\d\d_/);
      expect(s.face!.names, id).toContain('ALL_Joy');
      expect(s.face!.names, id).toContain('HA_Fung1');
    }
  });
});

describe.each(CHARACTER_IDS.map((id) => [id] as const))('角色 %s', (id) => {
  it('文件读得出来：身体的主要骨骼、眼睛、表情、染发的材质都有', () => {
    const s = source(id);
    const names = boneNames(s.bones);
    for (const name of ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head', 'UpperArm_L', 'LowerArm_R', 'Hand_L', 'UpperLeg_R', 'LowerLeg_L', 'Foot_R', 'Eye_L', 'Eye_R', 'Index1_L', 'Thumb3_R']) {
      expect(names, name).toContain(name);
    }
    expect(s.dyeMaterials.length).toBeGreaterThan(0);
    for (const key of ['joy', 'angry', 'sorrow', 'fun', 'surprised', 'blink', 'blink_l', 'blink_r', 'a', 'i', 'u', 'e', 'o']) expect(hasExpression(s.face, key), key).toBe(true);
    expect(s.face!.look.outer).toBeGreaterThan(2);
  });

  it('一个人的样子拼得起来：一张脸、两只眼，个头正常', () => {
    const b = build(id);
    sound(b);
    expect(b.faces.map((face) => face.key)).toEqual(['Head']);
    expect(b.faces[0].eyes).not.toBeNull();
    expect(b.metrics.height).toBeGreaterThan(1.3);
    expect(b.metrics.height).toBeLessThan(1.9);
    expect(b.ignored).toEqual([]);
  });

  it('三个头、三对手臂：每个头一张脸，手臂和头的骨骼各三份', () => {
    const b = build(id, {}, { heads: 3, armPairs: 3 });
    sound(b);
    expect(b.faces.map((face) => face.key)).toEqual(['Head', 'Head.002', 'Head.003']);
    for (const face of b.faces) expect(face.eyes).not.toBeNull();
    for (const name of ['UpperArm_L.002', 'Hand_R.003', 'Head.003', 'Eye_L.002']) expect(b.bones.some((bone) => bone.name === name), name).toBe(true);
    // 多出来的两个头差不多各带一份头发（紧挨着别的头的那一侧会少几缕）
    expect(vertices(b, /_HAIR/)).toBeGreaterThan(vertices(build(id), /_HAIR/) * 2);
  });

  it('腿左右并排：两对、三对都拼得起来，腿等距排成一排，每条都能摆', () => {
    for (const pairs of [2, 3]) {
      const b = build(id, { legLayout: 'row' }, { legs: pairs * 2, tails: 1 });
      sound(b);
      expect(b.ignored).toEqual([]);
      expect(b.metrics.legForm).toBe('row');
      const hips = b.bones.filter((bone) => /^UpperLeg_[LR](\.\d+)?$/.test(bone.name)).map((bone) => bone.head[0]).sort((p, q) => p - q);
      expect(hips).toHaveLength(pairs * 2);
      // 角色的左右髋关节本来就差一点：等距到毫米
      for (let i = 2; i < hips.length; i++) expect(hips[i] - hips[i - 1]).toBeCloseTo(hips[1] - hips[0], 2);
      expect(hips[0]).toBeCloseTo(-hips[hips.length - 1], 2);
      const legs = findLimbs(makeSolver(b.bones).rig).filter((limb) => limb.kind === 'leg');
      expect(legs).toHaveLength(pairs * 2);
    }
  });

  it('单数条腿、人腿人马每副胯几条腿：都拼得起来，每条腿都能摆，正中那条不分左右', () => {
    for (const [legs, legLayout, hipLegs] of [[1, 'auto', 2], [3, 'row', 2], [3, 'tandem', 2], [6, 'humantaur', 3]] as const) {
      const label = `${legs} ${legLayout} ${hipLegs}`;
      const b = build(id, { legLayout, hipLegs }, { legs, tails: 1 });
      sound(b);
      expect(b.ignored, label).toEqual([]);
      const found = findLimbs(makeSolver(b.bones).rig).filter((limb) => limb.kind === 'leg');
      expect(found, label).toHaveLength(legs);
      expect(found.filter((limb) => limb.side === 0), label).toHaveLength(legPlan({ counts: { ...defaultSpec().counts, legs }, legLayout, hipLegs }).stations.filter((n) => n % 2).length);
    }
  });

  it('一个头三张脸、人马、蛛形、人腿人马、加兽耳尾巴翅膀角，都拼得起来', () => {
    sound(build(id, { headLayout: 'faces' }, { heads: 3 }));
    const taur = build(id, { legLayout: 'taur' }, { legs: 4 });
    sound(taur);
    expect(taur.bones.some((bone) => /^LowerBody_/.test(bone.name))).toBe(true);
    sound(build(id, { legLayout: 'spider' }, { legs: 8 }));
    sound(build(id, { legLayout: 'humantaur' }, { legs: 4 }));
    // 人腿前后串联：后面的胯各有一根骨骼，腿都接得上、都能摆
    const tandem = build(id, { legLayout: 'tandem' }, { legs: 6, tails: 1 });
    sound(tandem);
    expect(tandem.ignored).toEqual([]);
    expect(tandem.bones.filter((bone) => /^LowerBody_\d+$/.test(bone.name))).toHaveLength(2);
    expect(findLimbs(makeSolver(tandem.bones).rig).filter((limb) => limb.kind === 'leg')).toHaveLength(6);
    const extras = build(id, {}, { tails: 3, wingPairs: 1, hornsPerHead: 2, earPairsPerHead: 1 });
    sound(extras);
    for (const name of ['OC_Tail', 'OC_Ear', 'OC_Horn', 'OC_Wing']) expect(vertices(extras, new RegExp(`^${name}$`)), name).toBeGreaterThan(0);
  });

  it('表情套得上脸，眼睛转得动', () => {
    const b = build(id);
    const face = b.meshes.find((mesh) => mesh.faceVertex && /Face.*SKIN/.test(b.materials[mesh.material].name))!;
    const positions = face.positions.slice();
    const normals = face.normals.slice();
    expect(applyFaces(b, face, { Head: { joy: 1 } }, positions, normals)).toBe(true);
    let moved = 0;
    for (let i = 0; i < positions.length; i++) moved = Math.max(moved, Math.abs(positions[i] - face.positions[i]));
    expect(moved).toBeGreaterThan(0.002);
    expect(moved).toBeLessThan(0.05);
    const [left, right] = gazeTurns([0.6, 0.3], b.morphs!.look, b.faces[0]);
    for (const q of [left, right]) expect(Math.abs(q[3])).toBeLessThan(0.9999);
  });

  it('摆姿势用得上：找得到手脚和十根手指，现成的姿势套上去不出坏数', () => {
    const b = build(id);
    const solver = makeSolver(b.bones);
    const limbs = findLimbs(solver.rig);
    expect(limbs.filter((limb) => limb.kind === 'arm')).toHaveLength(2);
    expect(limbs.filter((limb) => limb.kind === 'leg')).toHaveLength(2);
    const { hands } = findHands(solver.rig, limbs);
    expect(hands).toHaveLength(2);
    for (const hand of hands) expect(hand.fingers.map((chain) => chain.length)).toEqual([3, 3, 3, 3, 3]);
    const crossed = POSE_LIBRARY.find((pose) => pose.name === '抱着胳膊')!;
    const frame = forward(solver.rig, stateOf(solver, crossed.posing));
    for (const p of frame.pos) for (const v of p) expect(Number.isFinite(v)).toBe(true);
    // 抱着胳膊：两只手都收到身体前面、肩膀以里
    const at = (name: string) => frame.pos[solver.rig.index.get(name)!];
    for (const side of ['L', 'R']) {
      expect(Math.abs(at(`Hand_${side}`)[0])).toBeLessThan(Math.abs(at('UpperArm_L')[0]) + 0.1);
      expect(at(`Hand_${side}`)[2]).toBeGreaterThan(at('Chest')[2]);
    }
  });
});

describe('角色自己戴的兽耳（兔耳、狼耳）', () => {
  const EAR = /Accessory_(Rabbit|Cat)Ear/;

  it('认得出来；量头的大小时不算它', () => {
    for (const id of ['rabbit', 'kuro'] as const) {
      const s = source(id);
      expect(s.earMaterials).toHaveLength(1);
      expect(s.materials[s.earMaterials[0]].name).toMatch(EAR);
      const b = build(id);
      // 耳朵尖比头顶高出一截，身高是量到头顶的
      expect(top(b, EAR)).toBeGreaterThan(top(b, /Face.*SKIN/) + 0.08);
    }
  });

  it('多出来的头也各戴一副；衣领的碎片照旧不跟过去', () => {
    for (const id of ['rabbit', 'kuro'] as const) {
      const one = vertices(build(id), EAR);
      expect(one).toBeGreaterThan(100);
      expect(vertices(build(id, {}, { heads: 3 }), EAR)).toBe(one * 3);
      // 一个头几张脸：只有正面那个头戴着
      expect(vertices(build(id, { headLayout: 'faces' }, { heads: 3 }), EAR)).toBe(one);
    }
  });

  it('加了工坊的兽耳，自己那副就摘掉；换了发型还戴着，新头发里自带的猫耳不要', () => {
    for (const id of ['rabbit', 'kuro'] as const) {
      expect(vertices(build(id, {}, { earPairsPerHead: 1 }), EAR)).toBe(0);
      const hair = { ...defaultSpec().hair, style: 'twintails' as const };
      const swapped = build(id, { hair }, {}, donor('twintails'));
      sound(swapped);
      expect(vertices(swapped, EAR)).toBe(vertices(build(id), EAR));
      expect(vertices(swapped, /_EAR$/)).toBe(0);
      // 新头发是照她头本身的大小戴的：没有被耳朵撑大，耳朵尖露在头发上面
      expect(top(swapped, EAR)).toBeGreaterThan(top(swapped, /_HAIR_0\d$/) + 0.03);
    }
    // 没戴兽耳的角色换上双马尾，头发里自带的那副猫耳留着
    const plain = build('shino', { hair: { ...defaultSpec().hair, style: 'twintails' } }, {}, donor('twintails'));
    expect(vertices(plain, /_EAR$/)).toBeGreaterThan(0);
  });

  it('摆姿势时耳朵、外套下摆各有一个点，叫得出名字', () => {
    const labels = (id: CharacterId) => buildHandles(makeSolver(build(id).bones)).map((handle) => handle.label);
    expect(labels('rabbit')).toEqual(expect.arrayContaining(['耳朵 左', '耳朵 右']));
    expect(labels('kuro')).toEqual(expect.arrayContaining(['耳朵 左', '耳朵 右']));
    expect(labels('alice').some((label) => /^衣摆/.test(label))).toBe(true);
    expect(labels('alice').some((label) => /^头发 \d+/.test(label))).toBe(true);
  });
});

describe('导出', () => {
  it('许可要求署名的角色：署名写进 GLB 里；别的角色不写', () => {
    const b = build('kotori');
    const signed = readGlb(characterGlb(b, { rig: true, copyright: rosterEntry('kotori').credit })).json;
    expect(signed.asset.copyright).toBe('Kotori © Fox Jump，CC BY');
    expect(signed.asset.generator).toContain('OC Basemesh');
    expect(signed.skins).toHaveLength(1);
    // 贴图只带用到的那些
    expect(signed.images.length).toBe(new Set(b.meshes.map((mesh) => b.materials[mesh.material].image).filter((i) => i >= 0)).size);
    expect(readGlb(characterGlb(b, { rig: false })).json.asset.copyright).toBeUndefined();
  });
});

describe('染发：颜色画在贴图里的头发', () => {
  it('有做好的浅色贴图就换上它再染，底色照它的平均颜色算', () => {
    const base = source('rabbit');
    const dyeIndex = base.dyeMaterials[0];
    const back = base.materials.findIndex((material) => /HairBack/.test(material.name));
    // 界面那边会给这种贴图各做一张浅色的（见 load.ts）；这里拿两张现成的图顶替
    const s: CharacterSource = {
      ...base,
      hairLight: new Map([
        [dyeIndex, { image: 0, tone: [0.5, 0.5, 0.5] }],
        [back, { image: 1, tone: [0.8, 0.8, 0.8] }],
      ]),
    };
    const want = colorToLinear('#3f7fd9');
    const b = assembleCharacter(s, make('rabbit', { hair: { ...defaultSpec().hair, color: '#3f7fd9' } }));
    expect(b.materials[dyeIndex].image).toBe(0);
    expect(b.materials[back].image).toBe(1);
    for (let k = 0; k < 3; k++) {
      expect(b.materials[dyeIndex].color[k]).toBeCloseTo(Math.min(1, want[k] / 0.5), 4);
      expect(b.materials[back].color[k]).toBeCloseTo(Math.min(1, want[k] / 0.8), 4);
    }
    // 不染的时候什么都不换
    const plain = assembleCharacter(s, make('rabbit'));
    expect(plain.materials[dyeIndex]).toBe(s.materials[dyeIndex]);
    expect(plain.materials[back]).toBe(s.materials[back]);
  });

  it('换上去的深色头发自己带着浅色贴图时，不再借角色的贴图', () => {
    const twin = donor('twintails');
    expect(twin.meta.dark).toBe(true);
    const lit: HairDonor = { ...twin, source: { ...twin.source, hairLight: new Map(twin.source.dyeMaterials.map((index) => [index, { image: 0, tone: [0.6, 0.6, 0.6] }])) } };
    const s = source('kuro');
    const b = assembleCharacter(s, make('kuro', { hair: { ...defaultSpec().hair, style: 'twintails', color: '#d9486e' } }), lit);
    const dyedHair = b.materials.find((material) => /_HAIR_01$/.test(material.name) && material.image === s.images.length)!;
    expect(dyedHair).toBeDefined();
    const want = colorToLinear('#d9486e');
    for (let k = 0; k < 3; k++) expect(dyedHair.color[k]).toBeCloseTo(Math.min(1, want[k] / 0.6), 4);
  });
});

describe('上下排的手臂：袖子根的切口', () => {
  /** 第二排左手臂的袖子根上，没封口的那一圈边上的点：各自比肩关节靠外多少（米；负的是在关节里侧，也就是躯干里面） */
  function rootRim(b: CharacterBuild): number[] {
    const joint = b.bones.find((bone) => bone.name === 'UpperArm_L.002')!.head;
    const elbow = b.bones.find((bone) => bone.name === 'LowerArm_L.002')!.head;
    const near = 0.75 * Math.hypot(elbow[0] - joint[0], elbow[1] - joint[1], elbow[2] - joint[2]);
    const out: number[] = [];
    for (const mesh of b.meshes) {
      // 只看成片的袖子、皮肤；搭在肩上的领子被连带着切下来的几个面不算
      if (!mesh.name.endsWith('_Arm_02_L') || mesh.positions.length < 300) continue;
      const p = mesh.positions;
      // 位置一样的点并成一个，再找只属于一个三角面的边
      const rep = new Int32Array(p.length / 3);
      const seen = new Map<string, number>();
      for (let v = 0; v < rep.length; v++) {
        const key = `${Math.round(p[v * 3] * 1e4)},${Math.round(p[v * 3 + 1] * 1e4)},${Math.round(p[v * 3 + 2] * 1e4)}`;
        if (!seen.has(key)) seen.set(key, v);
        rep[v] = seen.get(key)!;
      }
      const used = new Map<number, number>();
      for (let t = 0; t < mesh.indices.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const a = rep[mesh.indices[t + e]];
          const c = rep[mesh.indices[t + ((e + 1) % 3)]];
          const key = a < c ? a * 1e6 + c : c * 1e6 + a;
          used.set(key, (used.get(key) ?? 0) + 1);
        }
      }
      for (const [key, times] of used) {
        if (times !== 1) continue;
        for (const v of [Math.floor(key / 1e6), key % 1e6]) {
          if (Math.hypot(p[v * 3] - joint[0], p[v * 3 + 1] - joint[1], p[v * 3 + 2] - joint[2]) < near) out.push(p[v * 3] - joint[0]);
        }
      }
    }
    return out.sort((x, y) => x - y);
  }

  it('宽松的开衫（sailor、alice）：切口是斜的，腋下那边离关节八九厘米——也都收进了躯干里，不悬在外面', () => {
    for (const id of ['sailor', 'alice'] as const) {
      const b = build(id, { armLayout: 'stack' }, { armPairs: 2 });
      sound(b);
      const rim = rootRim(b);
      expect(rim.length, id).toBeGreaterThan(30);
      // 肩关节贴在躯干侧面：切口上的点差不多都在关节里侧（没收的时候 sailor 的整圈都在关节外面两厘米开外）
      expect(rim[rim.length >> 1], id).toBeLessThan(-0.005);
      expect(rim.filter((x) => x < 0.01).length / rim.length, id).toBeGreaterThan(0.8);
    }
  });

  it('贴身的袖子本来就接得上：照样接得上，手臂别处没被动过', () => {
    for (const id of ['vita', 'shino', 'kotori'] as const) {
      const b = build(id, { armLayout: 'stack' }, { armPairs: 2 });
      sound(b);
      const rim = rootRim(b);
      expect(rim.filter((x) => x < 0.01).length / rim.length, id).toBeGreaterThan(0.95);
      // 手还在原来的位置：第二排的手相对它的肩关节，和第一排的一样远
      const reach = (tail: string) => {
        const from = b.bones.find((bone) => bone.name === `UpperArm_L${tail}`)!.head;
        const to = b.bones.find((bone) => bone.name === `Hand_L${tail}`)!.head;
        return Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      };
      expect(reach('.002'), id).toBeCloseTo(reach(''), 6);
    }
  });
});
