import './style.css';
import { type Box3, type Raycaster, Matrix4 } from 'three';
import { TORSO_CREDIT, animeGrid, animeReady, loadAnimeBody } from './anime/body';
import { FOOT_CREDIT } from './anime/foot';
import { type CharacterBuild, assembleCharacter } from './character/assemble';
import { characterGlb, characterShape, characterSkeleton, poseBuild } from './character/export';
import { characterVrm } from './character/vrm';
import { type FaceInstance, type FaceWeights, type Gaze, applyFaces, faceLabel, gazeAt, gazeOf, gazeTurns, hasExpression } from './character/face';
import { characterSource, hairDonor, hairLit, lightenHair, loadCharacter, loadHair, loadOwnCharacter, ownFileName, restoreOwnCharacter } from './character/load';
import type { CharacterSource } from './character/source';
import { ROSTER, rosterEntry } from './character/roster';
import { skinInPlace } from './character/pose';
import { type TweakedCharacter, characterPartAt, characterPartGlow, tweakCharacter } from './character/tweak';
import { describeClashes, findClashes } from './geometry/clash';
import { type Figure, type FigureMetrics, type PartType, nthName } from './geometry/figure';
import { buildFigure } from './geometry/layout';
import { partFrame } from './geometry/tweak';
import { type Quat, type V3, Q_ID, UP, len, norm, quatBetween, quatMul, sub } from './geometry/vec';
import { inAndroidShell, saveBlob, saveText } from './io/download';
import { exportGlb } from './io/exportGlb';
import { OfflineError } from './io/fetchFile';
import { type GlbMesh, writeGlb } from './io/glb';
import { forgetFile, keepFile, keptFile } from './io/keepFile';
import { type VrmLicense, type VrmMeta, type VrmSpring, VRM_LICENSES, describeLicense, humanoidMap, writeVrm } from './io/vrm';
import { writeObj, writeStl } from './io/meshFiles';
import { History } from './model/history';
import { activeOverrides, clearAllOverrides, clearOverride, mirrorName, setOverride } from './model/overrides';
import { partLabel } from './model/partLabel';
import { PRESETS, applyPreset } from './model/presets';
import {
  type ArmLayout,
  type BodySpec,
  type BodyStyle,
  type CharacterChoice,
  type CharacterId,
  OWN_CHARACTER,
  type CountKey,
  type Gender,
  type HairSpec,
  type HairStyle,
  type HandStyle,
  type HeadLayout,
  type LegLayout,
  type MeshMode,
  type PartOverride,
  type Pose,
  type ShapeDef,
  type Vec3,
  ARM_LAYOUTS,
  BLEND,
  BODY_STYLES,
  COUNT_DEFS,
  COUNT_HINTS,
  HIP_LEGS,
  EAR_SHAPES,
  GENDERS,
  HAIR_LENGTH,
  HAIR_STYLES,
  HAIR_VOLUME,
  HAND_STYLES,
  HEAD_LAYOUTS,
  LEG_LAYOUTS,
  clampHipLegs,
  perHip,
  MESH_MODES,
  OVERRIDE_LIMITS,
  POSES,
  SHAPE_DEFS,
  clampBlend,
  clampHair,
  clampShape,
  HAIR_UNDYED,
  defaultSpec,
  headHairColor,
  normalizeSpec,
  serializeSpec,
} from './model/spec';
import {
  type MatchTier,
  type ParseMatch,
  EAR_NAME,
  applyParse,
  describeSpec,
  parseDescription,
  summarize,
} from './parser';
import {
  type Hand,
  type HandDials,
  type HandShape,
  FINGER_LABEL,
  FINGER_NAMES,
  GESTURES,
  dialsOf,
  readHand,
  shapeHand,
  withCurl,
  withSpread,
} from './pose/fingers';
import { type Handle, type HandleGroup, HANDLE_GROUPS, buildHandles } from './pose/handles';
import { type BodyDist, clearArms } from './pose/clear';
import { type PoseRegion, POSE_REGIONS, armPairOf, blendPose, regionOf } from './pose/blend';
import { type DrapeKind, BodySurface, boneRadius, drape, drapeBones } from './pose/drape';
import { fitArms, followArms } from './pose/fit';
import { POSE_LIBRARY } from './pose/library';
import { type Posing, POSING_VERSION, cleanPosing, emptyPosing, flipPosing, isPosed } from './pose/posing';
import { type Frame, type PoseRig, type PoseState, cloneState, forward, pointOn, poseMatrices, posedBones, shiftRoot, tailOf } from './pose/rig';
import { type Pin, capturePins, dragAim, dragBend, dragBody, dragReach, turnBone } from './pose/solve';
import { type Solver, makeSolver, mirrorState, posingOf, stateOf } from './pose/solver';
import { type Skeleton, buildSkeleton } from './rig/skeleton';
import { bindPartGrafts, skinVertices } from './rig/skin';
import { type HairShape, hairReady, loadHairShape } from './hair/shapes';
import { compileField, fieldAt } from './sdf/field';
import { provideHair, provideShapes, spreadWork } from './sdf/meshClient';
import { type Picker, makePicker } from './sdf/pick';
import { refusable } from './sdf/posedField';
import { BoneOverlay } from './view/boneOverlay';
import { CharacterModel } from './view/characterModel';
import { type FusedStats, FusedModel } from './view/fusedModel';
import { type GizmoMode, GIZMO_MODES, Gizmo } from './view/gizmo';
import { MATERIAL_INFO } from './view/materials';
import { type BakedMesh, PartsModel, disposeTree } from './view/partsModel';
import { PoseHandles } from './view/poseHandles';
import { type RefSlot, REF_SLOTS, ReferenceImages, loadPicture } from './view/references';
import { Tour } from './view/tour';
import { type SkinSource, FlatParts, PosedMeshes, WHITE_BLEND } from './view/posedMeshes';
import { type CameraState, type ViewName, VIEW_DEFAULTS, VIEW_LIMITS, Viewport } from './view/viewport';

const STORE_KEY = 'oc-basemesh-v2';
const THEME_KEY = 'oc-basemesh-theme';
/** 面板里哪几栏折叠着 */
const UI_KEY = 'oc-basemesh-ui';
const START_TEXT = '两个头，两对手，两对胸';

const HEAD_LABEL: Record<HeadLayout, string> = { cluster: '凑成一簇', faces: '一个头几张脸', wide: '宽躯干' };
const ARM_LABEL: Record<ArmLayout, string> = { stack: '沿躯干上下排', fan: '肩部扇形聚拢' };
const MESH_LABEL: Record<MeshMode, string> = { fused: '融合成一整块', parts: '分部件（v1）' };
const HAND_LABEL: Record<HandStyle, string> = { fingers: '分指', mitten: '并指（手套形）' };
const GENDER_LABEL: Record<Gender, string> = { female: '女性', male: '男性' };
const BODY_LABEL: Record<BodyStyle, string> = { mannequin: '白模人台', anime: '二次元素体', character: '成品角色' };
/** 这几个滑块对这种身体不起作用 */
const FIXED_SHAPES: Record<BodyStyle, ReadonlySet<ShapeDef['key']>> = {
  mannequin: new Set(),
  anime: new Set(),
  character: new Set(['build']),
};
const BODY_NOTE: Record<BodyStyle, string> = {
  mannequin: '',
  anime: '头、躯干、手臂、腿的形状来自 VRoid Studio 旧版的女性素体（CC0）。体型是在她原来的样子上拉宽、压窄、变粗变细：肩宽、腰宽、胯宽、四肢粗细都能调，体格是这几样一起变；胯宽只对站着的那一对人腿起作用（人马、蛛形、单足、一副胯上三条以上腿时不变）。性别、手的样式对她不起作用。',
  character:
    '带头发、衣服和贴图的现成角色，上面「角色」里选是哪一个。多出来的头、手臂、胸是把她自己的复制一份接上去，各块互相插在一起，不融合；尾巴、翅膀、角、兽耳，还有人马的马身、蛛形的蜘蛛身，是另外捏的单色部件。腿选「人腿人马」「前后串联」「胯部聚拢」时，多出来的腿是把她自己的胯和腿（连裙子、鞋）复制一份接上去（胯部聚拢时一副紧贴一副，腿往外散开）；「左右并排」、一副胯上三条以上腿时，是把她的胯中间那一段（两条大腿的里侧加上裆部）照原样复制几份排开。好几个上半身时，是把她腰以上（连头发、衣服、手臂）整个复制一份，从腰那里往两边弯开，两份在腰上互相插着。体型除了「体格」都能调：肩宽、腰宽、胯宽、四肢粗细、手臂长短是直接把她的身体和衣服拉宽、拉长，调得多了贴图上的花纹会跟着变形。',
};
const HAIR_LABEL: Record<HairStyle, string> = { own: '原装', long: '长直发', sidetail: '侧马尾', bob: '波波头', twintails: '双马尾' };
/** 常用的发色，点一下就染过去 */
const HAIR_SWATCHES: readonly [name: string, color: string][] = [
  ['黑', '#23222a'],
  ['棕', '#6b4a32'],
  ['金', '#e8cf7a'],
  ['银', '#d5dbe6'],
  ['粉', '#f0a3bd'],
  ['红', '#c2413b'],
  ['蓝', '#4f7fd1'],
  ['绿', '#5fae86'],
  ['紫', '#8e6ccf'],
];
/** 「原装」那一格在白模上叫什么：白模没有自己的头发，不戴就是光头 */
const HAIR_OWN_LABEL: Record<BodyStyle, string> = { mannequin: '光头', anime: '光头', character: '原装' };
const HAIR_NOTE: Record<'character' | 'clay', string> = {
  character:
    '几种发型是从别的现成模型上取下来的头发（pixiv 以 CC0 发布的 VRoid 样例），整个换到她头上；多出来的头跟着换。发色是染上去的，发夹、丝带、挑染保持原样；几个头的时候先在「染哪个头」里点一个头，就只染它（兽耳跟着它），点「全部」就几个头一起染。长度只管垂在鼻尖以下的那一段。',
  clay: '戴的是和成品角色同一批现成的头发，转成了没有颜色的白模，和头融合成一整块；多出来的头各戴一副，角和兽耳长在头发外面。白模没有颜色，发色只有成品角色用得上。长度只管垂在鼻尖以下的那一段。',
};
const POSE_LABEL: Record<Pose, string> = { A: 'A-pose（手臂下垂）', T: 'T-pose（手臂平举）' };
const GIZMO_LABEL: Record<GizmoMode, string> = { translate: '移动', rotate: '旋转', scale: '缩放' };
const LEG_LABEL: Record<LegLayout, string> = {
  auto: '自动',
  taur: '人马式',
  spider: '蛛形',
  humantaur: '人腿人马',
  tandem: '前后串联',
  row: '左右并排',
  gather: '胯部聚拢',
  abreast: '横排多胯',
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/* ---------------- 状态 ---------------- */

let spec = defaultSpec();
let text = '';
/** 从文字里识别到的部件，对应的标签会亮起来 */
let hits: ReadonlySet<CountKey> = new Set();
let matches: ParseMatch[] = [];

function readText(value: string) {
  text = value;
  const r = parseDescription(text);
  hits = r.hits;
  matches = r.matches;
  return r;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      spec = normalizeSpec(data);
      readText(typeof data.text === 'string' ? data.text : describeSpec(spec));
      return;
    }
  } catch {
    // 存档读不出来就从头开始
  }
  spec = applyParse(defaultSpec(), readText(START_TEXT));
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, serializeSpec(spec, text));
  } catch {
    // 无痕窗口等场景下存不了，不影响使用
  }
}

load();

/* ---------------- 撤销 / 重做 ---------------- */

/** 能撤销的全部状态：设定和描述文字。两样都当作不可变的值，每次修改换新的 */
interface Snapshot {
  spec: BodySpec;
  text: string;
}

const history = new History<Snapshot>(
  { spec, text },
  { equals: (a, b) => a.text === b.text && JSON.stringify(a.spec) === JSON.stringify(b.spec) },
);

/** 正拖着操纵杆（见 gizmo.onDrag）：每动一下只记撤销、重建模型，存档和刷新整个面板等松手再做 */
let tweaking = false;

/**
 * 设定改完了：记进撤销历史、存档、刷新界面。
 * key 相同的连续修改（拖同一个滑块、连着打字）合并成一步。
 */
function commit(key?: string) {
  history.push({ spec, text }, key);
  // 只认操纵杆自己的改动：万一没收到松手，别的改动（滑块、撤销）照常存档、刷新
  if (tweaking && key?.startsWith('gizmo:')) {
    // 拖操纵杆只改了微调：面板上别的都没变，微调那几格数字在重建以后跟着同步（见 syncTweak）
    btnUndo.disabled = !history.canUndo;
    btnRedo.disabled = !history.canRedo;
    scheduleRebuild();
    return;
  }
  save();
  render();
}

function restore(snapshot: Snapshot | null) {
  if (!snapshot) return;
  spec = snapshot.spec;
  readText(snapshot.text);
  desc.value = text;
  save();
  render();
}

const undo = () => restore(history.undo());
const redo = () => restore(history.redo());

/** 用户改了文字：重新解析，文字本身不动 */
function fromText(value: string) {
  spec = applyParse(spec, readText(value));
  commit('text');
}

/** 用户改了部件数量或排布：把描述重写成规范中文 */
function fromParams(next: BodySpec) {
  spec = next;
  readText(describeSpec(spec));
  desc.value = text;
  commit();
}

/** 用户拖了体型滑块：描述里不写体型，文字不动 */
function fromShape(key: ShapeDef['key'], value: number) {
  spec = { ...spec, shape: clampShape({ ...spec.shape, [key]: value }) };
  commit(`shape:${key}`);
}

/* ---------------- 面板 ---------------- */

const desc = $<HTMLTextAreaElement>('desc');
let timer = 0;
desc.addEventListener('input', () => {
  clearTimeout(timer);
  timer = window.setTimeout(() => fromText(desc.value), 300);
});

for (const preset of PRESETS) {
  const btn = el('button', 'btn', preset.name);
  btn.type = 'button';
  btn.addEventListener('click', () => {
    refitNext = true;
    fromParams(applyPreset(spec, preset));
  });
  $('presets').append(btn);
}

const steppers = COUNT_DEFS.map((d) => {
  const row = el('div', 'row');
  const label = el('label');
  label.append(d.label, el('small', '', d.unit));
  const hint = COUNT_HINTS[d.key];
  if (hint) label.title = hint;
  const minus = el('button', '', '−');
  const plus = el('button', '', '+');
  const out = el('output');
  const step = (delta: number) => () =>
    fromParams({ ...spec, counts: { ...spec.counts, [d.key]: spec.counts[d.key] + delta } });
  minus.type = plus.type = 'button';
  minus.setAttribute('aria-label', `${d.label}减一`);
  plus.setAttribute('aria-label', `${d.label}加一`);
  minus.addEventListener('click', step(-1));
  plus.addEventListener('click', step(1));
  const stepper = el('div', 'stepper');
  stepper.append(minus, out, plus);
  row.append(label, stepper);
  $('counts').append(row);
  return () => {
    const v = spec.counts[d.key];
    out.textContent = String(v);
    minus.disabled = v <= d.min;
    plus.disabled = v >= d.max;
  };
});

/** 一排单选按钮；返回的函数用来把它同步到当前状态 */
function buildSeg<T extends string>(
  host: HTMLElement,
  options: readonly T[],
  label: (value: T) => string,
  onPick: (value: T) => void,
) {
  const inputs = options.map((value) => {
    const input = el('input');
    input.type = 'radio';
    input.name = host.id;
    input.value = value;
    input.addEventListener('change', () => onPick(value));
    const wrap = el('label');
    wrap.append(input, label(value));
    host.append(wrap);
    return input;
  });
  return (value: T, enabled: boolean) => {
    for (const input of inputs) {
      input.checked = input.value === value;
      input.disabled = !enabled;
      // 选中的那一格靠这个类名上色（样式里的 :has() 要比较新的浏览器内核才认）
      input.parentElement?.classList.toggle('on', input.checked);
    }
    host.classList.toggle('off', !enabled);
  };
}

const syncHead = buildSeg($('segHead'), HEAD_LAYOUTS, (v) => HEAD_LABEL[v], (headLayout) =>
  fromParams({ ...spec, headLayout }),
);
const syncArm = buildSeg($('segArm'), ARM_LAYOUTS, (v) => ARM_LABEL[v], (armLayout) =>
  fromParams({ ...spec, armLayout }),
);
const syncLeg = buildSeg($('segLeg'), LEG_LAYOUTS, (v) => LEG_LABEL[v], (legLayout) =>
  fromParams({ ...spec, legLayout }),
);
/** 人腿人马、前后串联每副胯上几条腿：只在选了这两种排法时显示 */
const syncHipLegs = (() => {
  const minus = el('button', '', '−');
  const plus = el('button', '', '+');
  const out = el('output');
  minus.type = plus.type = 'button';
  minus.setAttribute('aria-label', '每副胯少一条腿');
  plus.setAttribute('aria-label', '每副胯多一条腿');
  const step = (delta: number) => () => fromParams({ ...spec, hipLegs: clampHipLegs(spec.hipLegs + delta) });
  minus.addEventListener('click', step(-1));
  plus.addEventListener('click', step(1));
  $('hipLegs').append(minus, out, plus);
  return () => {
    $('hipLegsField').hidden = !perHip(spec.legLayout);
    out.textContent = String(spec.hipLegs);
    minus.disabled = spec.hipLegs <= HIP_LEGS.min;
    plus.disabled = spec.hipLegs >= HIP_LEGS.max;
  };
})();
const syncEar = buildSeg($('segEar'), EAR_SHAPES, (v) => EAR_NAME[v], (earShape) =>
  fromParams({ ...spec, earShape }),
);

const syncBody = buildSeg($('segBody'), BODY_STYLES, (v) => BODY_LABEL[v], (bodyStyle) => {
  refitNext = true;
  spec = { ...spec, bodyStyle };
  commit();
});
/** 成品角色选哪一个：一格一个，带一张小头像 */
const characterCards = new Map<CharacterChoice, HTMLButtonElement>();
function pickCharacter(id: CharacterChoice) {
  if (spec.character === id) return;
  refitNext = true;
  spec = { ...spec, character: id };
  commit();
}
for (const entry of ROSTER) {
  const card = el('button', 'card');
  card.type = 'button';
  card.setAttribute('role', 'radio');
  card.title = `${entry.name}：${entry.look}`;
  const face = el('img');
  face.alt = '';
  face.src = `${import.meta.env.BASE_URL}character/thumb/${entry.id}.jpg`;
  // 头像没取回来（或者还没做）就只剩名字
  face.addEventListener('error', () => face.remove());
  card.append(face, el('span', '', entry.label));
  card.addEventListener('click', () => pickCharacter(entry.id));
  characterCards.set(entry.id, card);
  $('characterPick').append(card);
}
/** 自己的 VRM：载入过才有这一格，头像是文件里的缩略图 */
const ownCard = el('button', 'card');
ownCard.type = 'button';
ownCard.setAttribute('role', 'radio');
ownCard.hidden = true;
const ownFace = el('img');
ownFace.alt = '';
const ownLabel = el('span', '', '自己的');
ownCard.append(ownFace, ownLabel);
ownCard.addEventListener('click', () => pickCharacter(OWN_CHARACTER));
characterCards.set(OWN_CHARACTER, ownCard);
$('characterPick').append(ownCard);
let ownThumb = '';
/** 自己的 VRM 读好了（刚选的，或者从这台设备上读回来的）：那一格显示出来 */
function showOwnCard(source: CharacterSource) {
  ownCard.hidden = false;
  ownCard.title = `${source.title}（${ownFileName()}）`;
  ownLabel.textContent = source.title;
  if (ownThumb) URL.revokeObjectURL(ownThumb);
  ownThumb = source.thumbnail ? URL.createObjectURL(new Blob([source.thumbnail.bytes as Uint8Array<ArrayBuffer>], { type: source.thumbnail.mime })) : '';
  if (ownThumb) ownFace.src = ownThumb;
  else ownFace.removeAttribute('src');
  ownFace.hidden = !ownThumb;
}
/** 自己的 VRM 的说明：作者、许可，不是 VRoid 做的提醒一句 */
function ownNote(source: CharacterSource): string {
  const parts = [
    `${source.title}（${ownFileName()}）：你自己载入的 VRM。作者 ${source.author || '文件里没写'}；许可 ${source.license || '文件里没写'}${source.licenseUrl ? `（${source.licenseUrl}）` : ''}，用它做的东西发出去时请照它的许可来。`,
    source.vroid ? '' : '它不是 VRoid 做的：皮肤、衣服、头发是照 VRoid 的材质名认的，认不全时多出来的头、并腿、换发型、染发可能不太对。',
    '文件只存在这台设备的浏览器里，不会写进配置文件。',
  ];
  return parts.filter(Boolean).join('');
}
/** 上次存在这台设备上的那个 VRM：选到成品角色时才去读（文件不小） */
let ownRestored = false;
function syncCharacter() {
  const on = spec.bodyStyle === 'character';
  $('characterRow').hidden = $('characterNote').hidden = !on;
  if (on && !ownRestored) {
    ownRestored = true;
    void restoreOwnCharacter().then((source) => {
      if (!source) return;
      showOwnCard(source);
      syncCharacter();
    });
  }
  for (const [id, card] of characterCards) {
    card.setAttribute('aria-checked', String(id === spec.character));
    card.classList.toggle('on', id === spec.character);
  }
  if (spec.character === OWN_CHARACTER) {
    const source = characterSource(OWN_CHARACTER);
    $('characterNote').textContent = source ? ownNote(source) : '还没有载入自己的 VRM：点「载入自己的 VRM…」选一个文件（VRoid Studio 导出的最好）。';
    return;
  }
  const entry = rosterEntry(spec.character);
  $('characterNote').textContent = `${entry.name}：${entry.look}。作者 ${entry.author}；${entry.license}。${entry.credit ? `用她做的东西发出去时请带上「${entry.credit}」。` : ''}`;
}
const fileVrm = $<HTMLInputElement>('fileVrm');
fileVrm.addEventListener('change', async () => {
  const file = fileVrm.files?.[0];
  fileVrm.value = '';
  if (!file) return;
  setStatus(`正在读 ${file.name}…`);
  try {
    const source = await loadOwnCharacter(file.name, await file.arrayBuffer());
    showOwnCard(source);
    refitNext = true;
    spec = { ...spec, bodyStyle: 'character', character: OWN_CHARACTER };
    commit();
    setStatus(`已载入 ${file.name}（${source.title}）${source.vroid ? '' : '；它不是 VRoid 做的，有些地方可能认不全'}。`);
  } catch (err) {
    setStatus(`这个 VRM 读不了：${err instanceof Error ? err.message : String(err)}`, true);
  }
});

const syncGender = buildSeg($('segGender'), GENDERS, (v) => GENDER_LABEL[v], (gender) =>
  fromParams({ ...spec, gender }),
);
const syncPose = buildSeg($('segPose'), POSES, (v) => POSE_LABEL[v], (pose) => fromParams({ ...spec, pose }));

const syncHand = buildSeg($('segHand'), HAND_STYLES, (v) => HAND_LABEL[v], (hands) => {
  spec = { ...spec, hands };
  commit();
});

/* ---- 头发：发型、发色、长度、蓬松（只有成品角色用得上） ---- */

/** 用户改了头发：描述里不写头发，文字不动。key 相同的连续修改（拖滑块、拖取色框）合并成一步撤销 */
function fromHair(patch: Partial<HairSpec>, key?: string) {
  spec = { ...spec, hair: clampHair({ ...spec.hair, ...patch }) };
  commit(key);
}

const syncHairStyle = buildSeg($('segHair'), HAIR_STYLES, (v) => HAIR_LABEL[v], (style) => fromHair({ style }));

/**
 * 几个头分开染（成品角色、几个头凑成一簇时）：色块、自选、恢复本色染的是哪个头。
 * null 是全部（几个头一起染，各自单独染过的也换成这个颜色），数字是第几个头（0 是角色自己的头，见 HairSpec.heads）
 */
let dyeHead: number | null = null;

/** 染 dyeHead 选的那个头（或者全部）；color 是空字符串就是恢复本色 */
function dyeHair(color: string, key?: string) {
  if (dyeHead === null) return fromHair({ color, heads: [] }, key);
  const heads = [...spec.hair.heads];
  while (heads.length <= dyeHead) heads.push('');
  // 和「全部」的颜色一样就不单独记；全部染了、这个头要本色，记成「不染」
  heads[dyeHead] = color === spec.hair.color ? '' : color || HAIR_UNDYED;
  fromHair({ heads }, key);
}

const hairColorInput = $<HTMLInputElement>('hairColor');
hairColorInput.addEventListener('input', () => dyeHair(hairColorInput.value, 'hair:color'));
hairColorInput.addEventListener('change', () => history.seal());
const btnHairColor = $<HTMLButtonElement>('btnHairColor');
btnHairColor.addEventListener('click', () => dyeHair(''));
const hairSwatches = HAIR_SWATCHES.map(([name, color]) => {
  const btn = el('button', 'swatch');
  btn.type = 'button';
  btn.title = `${name}发`;
  btn.setAttribute('aria-label', `${name}发`);
  btn.style.background = color;
  btn.addEventListener('click', () => dyeHair(color));
  $('hairSwatches').append(btn);
  return { btn, color };
});

const HAIR_SLIDERS = [
  { key: 'length', label: '长度', range: HAIR_LENGTH },
  { key: 'volume', label: '蓬松', range: HAIR_VOLUME },
] as const;
const hairSliders = HAIR_SLIDERS.map((d) => {
  const row = el('div', 'slider');
  const id = `s-hair-${d.key}`;
  const label = el('label', '', d.label);
  label.htmlFor = id;
  const input = el('input');
  input.type = 'range';
  input.id = id;
  input.min = String(d.range.min);
  input.max = String(d.range.max);
  input.step = String(d.range.step);
  const out = el('output');
  out.htmlFor.add(id);
  input.addEventListener('input', () => fromHair({ [d.key]: Number(input.value) }, `hair:${d.key}`));
  input.addEventListener('change', () => history.seal());
  row.append(label, input, out);
  $('hairSliders').append(row);
  return (enabled: boolean) => {
    const v = spec.hair[d.key];
    if (Number(input.value) !== v) input.value = String(v);
    out.textContent = `${Math.round(v * 100)}%`;
    input.disabled = !enabled;
    row.classList.toggle('off', !enabled);
  };
});

/** 正面看从左往右，几个头各叫什么 */
const HEAD_SLOT_LABEL: Record<number, readonly string[]> = {
  2: ['左', '右'],
  3: ['左', '中', '右'],
  4: ['最左', '左', '右', '最右'],
  5: ['最左', '左', '中', '右', '最右'],
};
/**
 * 第 slot 个位置（正面看从左往右）上是第几个头：角色自己的头（0）在正中（双数时偏右，就是她自己的左边），
 * 复制出来的头从左往右依次是 1、2 …（和 character/assemble.ts 里排头的顺序一样）
 */
function headAtSlot(slot: number, heads: number) {
  const own = Math.ceil((heads - 1) / 2);
  return slot === own ? 0 : slot < own ? slot + 1 : slot;
}

/** 好几个上半身时（正面看从左往右）各叫什么 */
const TORSO_LABEL: Record<number, readonly string[]> = { 2: ['左身', '右身'], 3: ['左身', '中身', '右身'] };

/**
 * 「染哪个头」那一排：全部，加上每个头一格（带一个小圆点，是这个头现在的发色）。
 * 好几个上半身时头是一个上半身一个上半身数的（正面看从左往右，见 geometry/torsos.ts）：「左身 · 右」
 */
const syncHairHeads = (() => {
  const host = $('segHairHead');
  let built = '';
  let cells: { input: HTMLInputElement; dot: HTMLElement | null; head: number | null }[] = [];
  const cell = (head: number | null, text: string) => {
    const input = el('input');
    input.type = 'radio';
    input.name = host.id;
    input.addEventListener('change', () => {
      dyeHead = head;
      syncHair();
    });
    const wrap = el('label');
    const dot = head === null ? null : el('i', 'dot');
    wrap.append(input, ...(dot ? [dot] : []), text);
    host.append(wrap);
    return { input, dot, head };
  };
  return (heads: number, torsos: number) => {
    if (built !== `${heads}×${torsos}`) {
      built = `${heads}×${torsos}`;
      host.replaceChildren();
      cells = [cell(null, '全部')];
      for (let body = 0; body < torsos; body++) {
        (heads > 1 ? (HEAD_SLOT_LABEL[heads] ?? []) : ['']).forEach((text, slot) => {
          const where = torsos > 1 ? (TORSO_LABEL[torsos]?.[body] ?? '') : '';
          cells.push(cell(body * heads + headAtSlot(slot, heads), [where, text].filter(Boolean).join(' · ')));
        });
      }
    }
    for (const { input, dot, head } of cells) {
      input.checked = head === dyeHead;
      input.parentElement?.classList.toggle('on', input.checked);
      if (dot && head !== null) {
        const color = headHairColor(spec.hair, head);
        dot.style.background = color || 'transparent';
        dot.classList.toggle('plain', !color);
      }
    }
  };
})();

/** 「原装」那一格上的字（成品角色是原装，白模是光头） */
const hairOwnLabel = $('segHair').querySelector('label')!.lastChild as Text;

function syncHair() {
  const colored = spec.bodyStyle === 'character';
  syncHairStyle(spec.hair.style, true);
  hairOwnLabel.data = HAIR_OWN_LABEL[spec.bodyStyle];
  // 发色：白模没有颜色
  $('hairDye').classList.toggle('off', !colored);
  hairColorInput.disabled = !colored;
  // 几个头凑成一簇时可以分开染；头少了、换成一个头几张脸，选着的那个头不在了就回到「全部」
  // 一个头几张脸的只有一副头发；好几个上半身时每个上半身各有自己的头
  const perHeads = spec.headLayout === 'faces' ? 1 : spec.counts.heads;
  const apart = colored && perHeads * spec.counts.torsos > 1;
  $('hairHeadsField').hidden = !apart;
  if (!apart || (dyeHead !== null && dyeHead >= perHeads * spec.counts.torsos)) dyeHead = null;
  if (apart) syncHairHeads(perHeads, spec.counts.torsos);
  const current = dyeHead === null ? spec.hair.color : headHairColor(spec.hair, dyeHead);
  // 取色框总得有个值：没染的时候摆一个中性的浅灰
  hairColorInput.value = current || '#c8c8d0';
  btnHairColor.disabled = !colored || !current;
  for (const swatch of hairSwatches) {
    swatch.btn.disabled = !colored;
    swatch.btn.setAttribute('aria-pressed', String(current === swatch.color));
  }
  // 长度、蓬松：白模光着头的时候没有东西可调
  for (const sync of hairSliders) sync(colored || spec.hair.style !== 'own');
  $('hairNote').textContent = HAIR_NOTE[colored ? 'character' : 'clay'];
}

const syncMesh = buildSeg($('segMesh'), MESH_MODES, (v) => MESH_LABEL[v], (meshMode) => {
  spec = { ...spec, meshMode };
  commit();
});

/** 融合圆角：界面上按厘米显示 */
const blendInput = $<HTMLInputElement>('s-blend');
blendInput.min = String(BLEND.min * 100);
blendInput.max = String(BLEND.max * 100);
blendInput.step = String(BLEND.step * 100);
blendInput.addEventListener('input', () => {
  spec = { ...spec, blend: clampBlend(Number(blendInput.value) / 100) };
  commit('blend');
});
blendInput.addEventListener('change', () => history.seal());
function syncBlend() {
  const cm = spec.blend * 100;
  if (Math.abs(Number(blendInput.value) - cm) > 1e-6) blendInput.value = String(cm);
  blendInput.disabled = spec.meshMode !== 'fused';
  $('o-blend').textContent = `${cm.toFixed(1)} cm`;
}

const shapeText = (d: ShapeDef, v: number) =>
  d.key === 'height' ? `${v.toFixed(2)} m` : d.key === 'headRatio' ? v.toFixed(1) : v.toFixed(2);

const sliders = SHAPE_DEFS.map((d) => {
  const row = el('div', 'slider');
  const id = `s-${d.key}`;
  const label = el('label', '', d.label);
  label.htmlFor = id;
  const input = el('input');
  input.type = 'range';
  input.id = id;
  input.min = String(d.min);
  input.max = String(d.max);
  input.step = String(d.step);
  const out = el('output');
  out.htmlFor.add(id);
  input.addEventListener('input', () => fromShape(d.key, Number(input.value)));
  // 松开滑块：这一次拖动到此为止，算一步撤销
  input.addEventListener('change', () => history.seal());
  row.append(label, input, out);
  $('shapes').append(row);
  return () => {
    const v = spec.shape[d.key];
    if (Number(input.value) !== v) input.value = String(v);
    out.textContent = shapeText(d, v);
    const fixed = FIXED_SHAPES[spec.bodyStyle].has(d.key);
    input.disabled = fixed;
    row.classList.toggle('off', fixed);
  };
});

const btnUndo = $<HTMLButtonElement>('btnUndo');
const btnRedo = $<HTMLButtonElement>('btnRedo');
btnUndo.addEventListener('click', undo);
btnRedo.addEventListener('click', redo);

// 还没有现成的姿势可选：那一栏就不出现
if (!POSE_LIBRARY.length) document.querySelector('section[data-key="poses"]')?.remove();

/* ---------- 面板的各栏可以折叠，折叠状态记在浏览器里 ---------- */

const folded = new Set<string>();
try {
  const saved: unknown = JSON.parse(localStorage.getItem(UI_KEY) ?? '[]');
  if (Array.isArray(saved)) for (const key of saved) if (typeof key === 'string') folded.add(key);
} catch {
  // 读不到就全部展开
}

const sections = new Map<string, HTMLElement>();
for (const section of document.querySelectorAll<HTMLElement>('section[data-key]')) {
  sections.set(section.dataset.key!, section);
  section.querySelector('.fold')?.addEventListener('click', () => setFolded(section.dataset.key!, !folded.has(section.dataset.key!)));
}

function setFolded(key: string, closed: boolean) {
  if (closed) folded.add(key);
  else folded.delete(key);
  try {
    localStorage.setItem(UI_KEY, JSON.stringify([...folded]));
  } catch {
    // 存不了也照样折叠
  }
  syncFolds();
}

function syncFolds() {
  for (const [key, section] of sections) {
    const closed = folded.has(key);
    section.classList.toggle('folded', closed);
    section.querySelector('.fold')?.setAttribute('aria-expanded', String(!closed));
  }
}
syncFolds();

/** 把面板里的某一栏展开，并滚到看得见的地方 */
function reveal(key: string) {
  const section = sections.get(key);
  if (!section) return;
  if (folded.has(key)) setFolded(key, false);
  // 手机竖屏上 3D 视图钉在顶上，滚过去模型也还看得见（让开多少位置写在样式里的 scroll-margin）
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  section.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
}

// 手机竖屏上面板很长：3D 视图下面那排栏目名，点一下展开那一栏并滚过去
for (const [key, section] of sections) {
  const jump = el('button', '', section.querySelector('.fold')?.textContent ?? key);
  jump.type = 'button';
  jump.addEventListener('click', () => {
    if (folded.has(key)) setFolded(key, false);
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
  });
  // 只属于「造型」或「摆姿势」的栏目，它的名字也只在那个模式下出现
  if (section.dataset.mode) jump.dataset.mode = section.dataset.mode;
  $('jump').append(jump);
}

/* ---------------- 主题 ---------------- */

const THEMES = ['auto', 'light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
const THEME_LABEL: Record<Theme, string> = { auto: '跟随系统', light: '浅色', dark: '深色' };

let theme: Theme = 'auto';
try {
  const saved = localStorage.getItem(THEME_KEY) as Theme | null;
  if (saved && THEMES.includes(saved)) theme = saved;
} catch {
  // 读不到就跟随系统
}

function applyTheme() {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  $('btnTheme').textContent = `主题：${THEME_LABEL[theme]}`;
}

$('btnTheme').addEventListener('click', () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // 存不了也照样切换
  }
  applyTheme();
});

/* ---------------- 3D 视图 ---------------- */

/** 分部件模式的模型（主线程里直接建） */
const model = new PartsModel();
/** 融合模式的模型（网格在 Worker 里算，算好了通过 onUpdate 通知） */
const fused = new FusedModel();
/** 成品角色（带贴图）的模型 */
const characterModel = new CharacterModel();
/** 现在显示的是成品角色的话，这里是拼好的结果（套上了手动微调）；否则是 null */
let character: CharacterBuild | null = null;
/** 成品角色能单独微调的部件，和它们现在的支点（character 就是它的 build） */
let tweaked: TweakedCharacter | null = null;
/**
 * 上一次拼好、还没套手动微调的成品角色，和拼它用的设定（手动微调、姿势不算）。
 * 只改了微调（拖操纵杆）时不用重拼，把微调重新套上去就行
 */
let characterBase: { key: string; build: CharacterBuild } | null = null;
/** 成品角色每重新套一次微调加一：选中高亮的形状照它换 */
let characterVersion = 0;
/** 骨架的示意线，点「骨骼」按钮才显示 */
const bones = new BoneOverlay();
let showBones = false;
let viewport: Viewport | null = null;
/** 点选、选中高亮和操纵杆 */
let gizmo: Gizmo | null = null;
/** 分部件模式摆姿势时显示的那一组能弯的网格 */
const flatParts = new FlatParts();
/** 摆姿势时关节上的圆点和旋转环 */
let poseHandles: PoseHandles | null = null;
try {
  viewport = new Viewport($('stage'));
  viewport.scene.add(model.root, fused.root, characterModel.root, flatParts.root);
  viewport.overlay.add(bones.root);
  gizmo = new Gizmo(viewport);
  poseHandles = new PoseHandles(viewport);
} catch (err) {
  const msg = $('stageMsg');
  msg.hidden = false;
  msg.textContent = '这个浏览器没能启动 3D 显示（WebGL）。换用新版 Edge 或 Chrome，或在浏览器设置里打开硬件加速后再试。';
  console.error(err);
}

/* ---------- 镜头和灯光 ---------- */

const VIEW_KEY = 'oc-basemesh-view';
/** 透视、灯光方向、地面显不显示：只影响屏幕上和截图里的样子，记在浏览器里，不进配置、不进撤销 */
const view = { fov: VIEW_DEFAULTS.fov as number, lightTurn: VIEW_DEFAULTS.lightTurn as number, lightLift: VIEW_DEFAULTS.lightLift as number, ground: true };
type ViewDial = keyof typeof VIEW_LIMITS;
const dial = (key: ViewDial, value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(VIEW_LIMITS[key][0], Math.min(VIEW_LIMITS[key][1], value))) : VIEW_DEFAULTS[key];
try {
  const saved: unknown = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
  if (typeof saved === 'object' && saved !== null) {
    const s = saved as Record<string, unknown>;
    for (const key of Object.keys(VIEW_LIMITS) as ViewDial[]) view[key] = dial(key, s[key]);
    view.ground = s.ground !== false;
  }
} catch {
  // 读不到就用原样的
}
const VIEW_DIALS: { key: ViewDial; text: (v: number) => string }[] = [
  { key: 'fov', text: (v) => `${v}°` },
  { key: 'lightTurn', text: (v) => (v ? `${v > 0 ? '左' : '右'} ${Math.abs(v)}°` : '正前') },
  { key: 'lightLift', text: (v) => `${v}°` },
];
const viewDials = VIEW_DIALS.map((d) => {
  const input = $<HTMLInputElement>(`s-${d.key}`);
  input.min = String(VIEW_LIMITS[d.key][0]);
  input.max = String(VIEW_LIMITS[d.key][1]);
  input.step = '1';
  input.addEventListener('input', () => {
    view[d.key] = dial(d.key, Number(input.value));
    applyView();
  });
  return () => {
    if (Number(input.value) !== view[d.key]) input.value = String(view[d.key]);
    $(`o-${d.key}`).textContent = d.text(view[d.key]);
  };
});
const viewGround = $<HTMLInputElement>('viewGround');
viewGround.addEventListener('change', () => {
  view.ground = viewGround.checked;
  applyView();
});
/** 把透视、灯光、地面套到 3D 视图上，面板上的数跟着变，顺手存起来 */
function applyView() {
  viewport?.setFov(view.fov);
  viewport?.setLight(view.lightTurn, view.lightLift);
  viewport?.setGround(view.ground);
  for (const sync of viewDials) sync();
  viewGround.checked = view.ground;
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    // 存不了也照样用
  }
}
$('btnViewReset').addEventListener('click', () => {
  Object.assign(view, VIEW_DEFAULTS);
  applyView();
});
const VIEW_BUTTONS: [ViewName, string][] = [
  ['front', '正面'],
  ['side', '左侧'],
  ['right', '右侧'],
  ['back', '背面'],
  ['top', '俯视'],
  ['bottom', '仰视'],
  ['three', '斜侧'],
];
for (const [name, label] of VIEW_BUTTONS) {
  const btn = el('button', 'btn', label);
  btn.type = 'button';
  btn.addEventListener('click', () => viewport?.frame(name));
  $('viewButtons').append(btn);
}
applyView();

/* ---------- 参考图 ---------- */

const REFS_KEY = 'oc-basemesh-refs';
/** 图本身存在 IndexedDB 里（和自己的 VRM 在一起），用这个 key */
const refFileKey = (slot: RefSlot) => `ref-${slot}`;
/** 大小、上下、左右是厘米，不透明度是百分数 */
const REF_LIMITS = { height: [30, 600], up: [-150, 150], shift: [-300, 300], opacity: [10, 100] } as const;
type RefDial = keyof typeof REF_LIMITS;
/** 一张参考图：文件名、显不显示、翻不翻，和怎么摆 */
type RefSettings = { name: string; show: boolean; flip: boolean } & Record<RefDial, number>;
/** 两张参考图怎么摆、现在在调哪张：和「镜头和灯光」一样只记在浏览器里，不进配置、不进撤销 */
const refs: { slot: RefSlot; onTop: boolean } & Record<RefSlot, RefSettings | null> = { slot: 'front', onTop: false, front: null, side: null };
const REF_LABEL: Record<RefSlot, string> = { front: '正面', side: '侧面' };
const refDial = (key: RefDial, value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(REF_LIMITS[key][0], Math.min(REF_LIMITS[key][1], value))) : fallback;
const references = new ReferenceImages();
viewport?.backdrop.add(references.root);
try {
  const saved: unknown = JSON.parse(localStorage.getItem(REFS_KEY) ?? 'null');
  if (typeof saved === 'object' && saved !== null) {
    const s = saved as Record<string, unknown>;
    refs.onTop = s.onTop === true;
    if (s.slot === 'side') refs.slot = 'side';
    for (const slot of REF_SLOTS) {
      const r = s[slot] as Record<string, unknown> | null | undefined;
      if (typeof r !== 'object' || r === null || typeof r.name !== 'string') continue;
      refs[slot] = {
        name: r.name,
        show: r.show !== false,
        flip: r.flip === true,
        height: refDial('height', r.height, 165),
        up: refDial('up', r.up, 0),
        shift: refDial('shift', r.shift, 0),
        opacity: refDial('opacity', r.opacity, 60),
      };
    }
  }
} catch {
  // 读不到就当没有参考图
}

const syncRefSlot = buildSeg($('segRef'), REF_SLOTS, (v) => REF_LABEL[v], (slot) => {
  refs.slot = slot;
  applyRefs();
});
const REF_DIALS: { key: RefDial; text: (v: number) => string }[] = [
  { key: 'height', text: (v) => `${(v / 100).toFixed(2)} m` },
  { key: 'up', text: (v) => (v ? `${v > 0 ? '↑' : '↓'}${Math.abs(v)} cm` : '贴地') },
  { key: 'shift', text: (v) => (v ? `${v > 0 ? '→' : '←'}${Math.abs(v)} cm` : '居中') },
  { key: 'opacity', text: (v) => `${v}%` },
];
const refDials = REF_DIALS.map((d) => {
  const input = $<HTMLInputElement>(`s-ref${d.key[0].toUpperCase()}${d.key.slice(1)}`);
  input.min = String(REF_LIMITS[d.key][0]);
  input.max = String(REF_LIMITS[d.key][1]);
  input.step = d.key === 'opacity' ? '5' : '1';
  input.addEventListener('input', () => {
    const r = refs[refs.slot];
    if (!r) return;
    r[d.key] = refDial(d.key, Number(input.value), r[d.key]);
    applyRefs();
  });
  return (r: RefSettings) => {
    if (Number(input.value) !== r[d.key]) input.value = String(r[d.key]);
    $(`o-${input.id.slice(2)}`).textContent = d.text(r[d.key]);
  };
});
for (const [id, key] of [['refShow', 'show'], ['refFlip', 'flip']] as const) {
  const box = $<HTMLInputElement>(id);
  box.addEventListener('change', () => {
    const r = refs[refs.slot];
    if (!r) return;
    r[key] = box.checked;
    applyRefs();
  });
}
$<HTMLInputElement>('refOnTop').addEventListener('change', (e) => {
  refs.onTop = (e.target as HTMLInputElement).checked;
  applyRefs();
});

/** 把两张参考图摆到 3D 视图里，面板跟着变，顺手存起来 */
function applyRefs() {
  for (const slot of REF_SLOTS) {
    const r = refs[slot];
    const placement = r && { height: r.height / 100, up: r.up / 100, shift: r.shift / 100, opacity: r.opacity / 100, flip: r.flip };
    references.place(slot, placement, !!r?.show);
  }
  if (viewport) viewport.backdropOnTop = refs.onTop;
  syncRefSlot(refs.slot, true);
  const r = refs[refs.slot];
  const label = REF_LABEL[refs.slot];
  $('refName').textContent = r ? `${label}图：${r.name}` : `还没有${label}图。点「选图…」选一张自己画的${label}设定图。`;
  $<HTMLButtonElement>('btnRefClear').disabled = !r;
  $('refBody').hidden = !r;
  if (r) {
    for (const sync of refDials) sync(r);
    $<HTMLInputElement>('refShow').checked = r.show;
    $<HTMLInputElement>('refFlip').checked = r.flip;
  }
  $<HTMLInputElement>('refOnTop').checked = refs.onTop;
  try {
    localStorage.setItem(REFS_KEY, JSON.stringify(refs));
  } catch {
    // 存不了也照样用
  }
}

/** 选图、刚打开时从浏览器里取图：按现在的身高对齐（脚踩在地上、居中） */
const fitHeight = () => refDial('height', Math.round((metrics?.height ?? 1.65) * 100), 165);
const fileRef = $<HTMLInputElement>('fileRef');
fileRef.addEventListener('change', async () => {
  const file = fileRef.files?.[0];
  fileRef.value = '';
  if (!file) return;
  const slot = refs.slot;
  try {
    const bytes = await file.arrayBuffer();
    references.setImage(slot, await loadPicture(bytes));
    refs[slot] = { name: file.name, show: true, flip: refs[slot]?.flip ?? false, height: fitHeight(), up: 0, shift: 0, opacity: refs[slot]?.opacity ?? 60 };
    applyRefs();
    viewport?.frame(slot);
    const kept = await keepFile(refFileKey(slot), { name: file.name, bytes });
    setStatus(`${REF_LABEL[slot]}参考图已垫上：${file.name}${kept ? '' : '。这个浏览器不让存，下次打开要重新选'}。`);
  } catch (err) {
    setStatus(`这张图读不了（${err instanceof Error ? err.message : String(err)}）：换成 PNG 或 JPG 再试。`, true);
  }
});
$('btnRefClear').addEventListener('click', () => {
  const slot = refs.slot;
  refs[slot] = null;
  references.setImage(slot, null);
  applyRefs();
  void forgetFile(refFileKey(slot));
});
$('btnRefFit').addEventListener('click', () => {
  const r = refs[refs.slot];
  if (!r) return;
  Object.assign(r, { height: fitHeight(), up: 0, shift: 0 });
  applyRefs();
});
applyRefs();
// 上次垫过的图从浏览器里取回来；取不回来（清过浏览器数据）就当没有
for (const slot of REF_SLOTS) {
  if (!refs[slot]) continue;
  void keptFile(refFileKey(slot))
    .then((file) => (file ? loadPicture(file.bytes) : null))
    .catch(() => null)
    .then((picture) => {
      if (picture) references.setImage(slot, picture);
      else refs[slot] = null;
      applyRefs();
    });
}

/* ---------- 手机、触屏 ---------- */

// 用手指的屏幕：操作提示换成手指的说法，先亮在 3D 视图上，第一次碰到模型就收起来
const byFinger = Boolean(viewport) && window.matchMedia('(pointer: coarse)').matches;
/** 右下角那句操作提示：两种模式、鼠标和手指，各有各的说法 */
const HINTS = {
  shape: [$('hint').textContent ?? '', '单指拖动旋转 · 双指缩放、平移 · 点一下部件单独调整'],
  pose: ['拖圆点摆姿势 · 点一下圆点出现旋转环 · 拖空白处转视角', '拖圆点摆姿势 · 点一下圆点出现旋转环 · 双指缩放、平移'],
} as const;
function showHint(which: keyof typeof HINTS) {
  const hint = $('hint');
  hint.textContent = HINTS[which][byFinger ? 1 : 0];
  if (!byFinger || !viewport) return;
  hint.classList.add('tip');
  viewport.renderer.domElement.addEventListener('pointerdown', () => hint.classList.remove('tip'), { once: true });
}
if (byFinger) showHint('shape');

// 手机竖屏：把 3D 视图放大到整屏（设定面板先收起来），再点一下还原
const btnZoom = $<HTMLButtonElement>('btnZoom');
/** 放大之前面板滚到了哪里，还原时滚回去 */
let scrollBack = 0;
btnZoom.addEventListener('click', () => {
  const app = btnZoom.closest('.app');
  if (!app) return;
  const big = !app.classList.contains('big');
  if (big) scrollBack = window.scrollY;
  app.classList.toggle('big', big);
  btnZoom.setAttribute('aria-pressed', String(big));
  btnZoom.textContent = big ? '还原' : '放大';
  if (!big) window.scrollTo(0, scrollBack);
});

// 手机浏览器里屏幕键盘是盖在页面上的，页面自己不知道变矮了：看得见的高度比页面矮一大截，就是键盘出来了。
// 记在 <html> 上，样式里把钉着的 3D 视图、栏目名、导出按钮松开，免得挡住正在打字的那一格
const eye = window.visualViewport;
if (eye) {
  eye.addEventListener('resize', () => {
    document.documentElement.classList.toggle('typing', window.innerHeight - eye.height * eye.scale > 140);
  });
}

// 装成安卓应用时（tools/android 的外壳）：做个记号给样式用；
// 按返回键时外壳先来问这里——放大着就还原，选中着部件就取消，都没有才真的退出
if (inAndroidShell) {
  document.documentElement.dataset.shell = 'android';
  (window as unknown as { __ocBack: () => boolean }).__ocBack = () => {
    if (tour.open) {
      tour.close();
      return true;
    }
    if (btnZoom.getAttribute('aria-pressed') === 'true') {
      btnZoom.click();
      return true;
    }
    if (selected) {
      select(null);
      return true;
    }
    if (joint) {
      selectJoint(null);
      return true;
    }
    return false;
  };
}

/** 上一次重建模型在主线程上花了多久（毫秒），调试帧率用 */
let lastBuildMs = 0;
/** 下一次模型更新后把整个模型重新框进画面（刚打开、换预设、载入配置这类大改动） */
let refitNext = true;
/** 现在屏幕上这个角色的摆位结果（已经套上手动微调） */
let figure: Figure | null = null;
let metrics: FigureMetrics | null = null;
let fusedStats: FusedStats | null = null;

const count = (n: number) => Math.round(n).toLocaleString('zh-CN');

/** 左上角读数里「面数」那一格的文字，以及跟在后面的警告 */
let readout = { triangles: '', warning: '' };
/** 开发模式下穿模检查的结果 */
let clashNote = '';
/** 帧率（地址里带 ?fps 时才有） */
let fpsNote = '';

function drawReadout() {
  if (!metrics) return;
  const items = [
    el('span', '', `身高 ${metrics.height.toFixed(2)} m`),
    el('span', '', `约 ${metrics.headRatio.toFixed(1)} 头身`),
    el('span', '', readout.triangles),
  ];
  if (fpsNote) items.push(el('span', '', fpsNote));
  for (const warning of [readout.warning, clashNote]) if (warning) items.push(el('span', 'warn', warning));
  $('readout').replaceChildren(...items);
}

// 地址后面加上 ?fps，读数里就多一格帧率（平时不显示，免得一直跳）
if (viewport && new URLSearchParams(location.search).has('fps')) {
  viewport.onFps = (fps) => {
    fpsNote = `${Math.round(fps)} 帧/秒`;
    drawReadout();
  };
}

function showReadout(triangles: string, warning = '') {
  readout = { triangles, warning };
  drawReadout();
}

/**
 * 开发模式下的穿模检查：参数停下来以后查一遍，有明显互相穿插的部件就在控制台和读数里提醒。
 * 正式打包的版本不跑。
 */
let clashTimer = 0;
function scheduleClashCheck(target: Figure) {
  if (!import.meta.env.DEV) return;
  window.clearTimeout(clashTimer);
  clashTimer = window.setTimeout(() => {
    const clashes = findClashes(target);
    if (clashes.length) console.warn(`[穿模检查] ${clashes.length} 处：${describeClashes(clashes)}`);
    const note = clashes.length
      ? `开发提示：${clashes.length} 处穿模（${describeClashes(clashes.slice(0, 2))}${clashes.length > 2 ? ' …' : ''}）`
      : '';
    if (note !== clashNote) {
      clashNote = note;
      drawReadout();
    }
  }, 400);
}

function showBounds(box: Box3) {
  viewport?.setBounds(box);
  if (refitNext) viewport?.refit();
  refitNext = false;
}

function showFused() {
  if (!fusedStats) return showReadout('正在生成网格…');
  const { triangles, info, draft, fine } = fusedStats;
  showReadout(
    `${count(triangles)} 三角面（${draft ? '粗略预览' : fine ? '精细' : '预览'}）`,
    info.components > 1 ? `网格分成了 ${info.components} 块：有部件没连上身体` : '',
  );
}

fused.onUpdate = (stats) => {
  fusedStats = stats;
  if (spec.meshMode !== 'fused' || character) return;
  showBounds(stats.box);
  showFused();
  // 摆姿势时：新的网格（和它的权重）到了，把姿势套上去
  if (mode === 'pose') syncPosing();
};
fused.onError = (err) => setStatus(`融合网格出错：${err.message}`, true);
// 用手指的设备（手机、平板）算得慢：停下来以后换上的细网格少细一些
if (window.matchMedia('(pointer: coarse)').matches) fused.meshBudget = 60_000;

/**
 * 二次元素体的数据（6 MB）用到时才取。取回来之前先照白模人台显示，取到了再重建一次。
 * 主线程登记一份（摆位、点选、分部件显示要用），再交一份给算网格的 Worker。
 */
let animeLoading = false;
/**
 * 上一次取文件时连不上工坊的程序（多半是它被关掉了：exe 的黑色窗口，或者 npm run dev）。
 * 人把它重新打开、回到这个页面时，自动再取一次。
 */
let retryOnReturn = false;
function retryLoading() {
  if (!retryOnReturn || document.visibilityState !== 'visible') return;
  retryOnReturn = false;
  scheduleRebuild();
}
window.addEventListener('focus', retryLoading);
document.addEventListener('visibilitychange', retryLoading);

function ensureAnimeBody() {
  if (animeLoading || animeReady()) return;
  animeLoading = true;
  setStatus('正在载入二次元素体…');
  loadAnimeBody(import.meta.env.BASE_URL)
    .then((buffer) => {
      provideShapes(buffer);
      setStatus('二次元素体已载入');
      refitNext = true;
      scheduleRebuild();
    })
    .catch((err: unknown) => {
      retryOnReturn = err instanceof OfflineError;
      setStatus(`二次元素体没载入成功，先用白模人台：${err instanceof Error ? err.message : String(err)}`, true);
    })
    .finally(() => {
      animeLoading = false;
    });
}

/** 成品角色的文件（每个十来 MB）也是选到哪个才取哪个，取回来之前先照白模人台显示 */
const characterLoading = new Set<CharacterChoice>();
function ensureCharacter() {
  const id = spec.character;
  if (characterLoading.has(id) || characterSource(id)) return;
  characterLoading.add(id);
  if (id === OWN_CHARACTER) {
    // 自己的 VRM：从这台设备的浏览器里读回上次载入的那个
    restoreOwnCharacter()
      .then((source) => {
        if (spec.character !== OWN_CHARACTER) return;
        if (!source) {
          setStatus('这台设备上没有存着自己的 VRM，先用白模人台：点「载入自己的 VRM…」选一个文件。', true);
          return;
        }
        showOwnCard(source);
        setStatus(`已读回自己的 VRM「${source.title}」`);
        refitNext = true;
        scheduleRebuild();
      })
      .finally(() => characterLoading.delete(id));
    return;
  }
  const label = rosterEntry(id).label;
  setStatus(`正在载入角色「${label}」（十来 MB，稍等）…`);
  loadCharacter(id, import.meta.env.BASE_URL)
    .then(() => {
      // 等的时候又换了别的角色：这一个留着，不抢着显示
      if (spec.character !== id) return;
      setStatus(`角色「${label}」已载入`);
      refitNext = true;
      scheduleRebuild();
    })
    .catch((err: unknown) => {
      retryOnReturn = err instanceof OfflineError;
      setStatus(`角色「${label}」没载入成功，先用白模人台：${err instanceof Error ? err.message : String(err)}`, true);
    })
    .finally(() => {
      characterLoading.delete(id);
    });
}

/** 换发型用的头发（每副一两 MB）也是用到时才取，取回来之前先照原装的头发显示 */
const hairLoading = new Set<HairStyle>();
function ensureHair() {
  const style = spec.hair.style;
  if (style === 'own' || hairDonor(style) || hairLoading.has(style)) return;
  hairLoading.add(style);
  setStatus(`正在载入发型「${HAIR_LABEL[style]}」…`);
  loadHair(style, import.meta.env.BASE_URL)
    .then(() => {
      setStatus(`发型「${HAIR_LABEL[style]}」已载入`);
      scheduleRebuild();
    })
    .catch((err: unknown) => {
      retryOnReturn = err instanceof OfflineError;
      setStatus(`发型「${HAIR_LABEL[style]}」没载入成功，先用原装的头发：${err instanceof Error ? err.message : String(err)}`, true);
    })
    .finally(() => {
      hairLoading.delete(style);
    });
}

/**
 * 染发、换发型时要用的浅色贴图（颜色画在贴图里的头发光改底色染不浅，见 load.ts）：用到时才做，
 * 一张图几百毫秒；做好之前先照老办法染着，做好了再换上
 */
const lightening = new WeakSet<object>();
const hairSources = () => [characterSource(spec.character), hairDonor(spec.hair.style)?.source ?? null];
function ensureHairLight() {
  if (!spec.hair.color && !spec.hair.heads.some((v) => v && v !== HAIR_UNDYED) && spec.hair.style === 'own') return;
  for (const source of hairSources()) {
    if (!source || hairLit(source) || lightening.has(source)) continue;
    lightening.add(source);
    void lightenHair(source).then(() => {
      lightening.delete(source);
      scheduleRebuild();
    });
  }
}

/**
 * 白模人台和二次元素体戴的头发（每副一两 MB）同样是用到时才取，取回来之前先光着头。
 * 和素体的数据一样，主线程登记一份，再交一份给算网格的 Worker。
 */
const hairShapeLoading = new Set<HairShape>();
function ensureHairShape() {
  const style = spec.hair.style;
  if (style === 'own' || hairReady(style) || hairShapeLoading.has(style)) return;
  hairShapeLoading.add(style);
  setStatus(`正在载入发型「${HAIR_LABEL[style]}」…`);
  loadHairShape(style, import.meta.env.BASE_URL)
    .then((buffer) => {
      provideHair(style, buffer);
      setStatus(`发型「${HAIR_LABEL[style]}」已载入`);
      scheduleRebuild();
    })
    .catch((err: unknown) => {
      retryOnReturn = err instanceof OfflineError;
      setStatus(`发型「${HAIR_LABEL[style]}」没载入成功，先光着头：${err instanceof Error ? err.message : String(err)}`, true);
    })
    .finally(() => {
      hairShapeLoading.delete(style);
    });
}

/** 显示成品角色：按部件数量把她拼出来。拼不出来（文件有问题）就返回 false，退回白模人台 */
function showCharacter(): boolean {
  const source = characterSource(spec.character);
  if (!source) return false;
  try {
    const donor = hairDonor(spec.hair.style);
    const key = JSON.stringify([{ ...spec, overrides: null, characterOverrides: null, posing: null }, spec.character, Boolean(donor), hairSources().map((s) => Boolean(s && hairLit(s)))]);
    if (characterBase?.key !== key) characterBase = { key, build: assembleCharacter(source, spec, donor) };
    tweaked = tweakCharacter(characterBase.build, spec.characterOverrides);
    character = tweaked.build;
    characterVersion++;
  } catch (err) {
    character = null;
    tweaked = null;
    setStatus(`成品角色拼不出来，先用白模人台：${err instanceof Error ? err.message : String(err)}`, true);
    return false;
  }
  figure = null;
  picker = null;
  metrics = character.metrics;
  window.clearTimeout(clashTimer);
  clashNote = '';
  model.root.visible = fused.root.visible = false;
  characterModel.root.visible = true;
  const stats = characterModel.update(character);
  showBounds(stats.box);
  showReadout(`${count(stats.triangles)} 三角面`, character.ignored.length ? `成品角色还拼不了：${character.ignored.join('、')}` : '');
  return true;
}

/**
 * 决定身体长什么样的全部设定（姿势不算），加上用到的素材载入了没有。
 * 摆姿势的时候它不变，就不用重建身体，只把姿势套上去。
 */
function bodyKeyOf(): string {
  const style = spec.hair.style;
  return JSON.stringify([
    { ...spec, posing: null },
    mode,
    animeReady(),
    Boolean(characterSource(spec.character)),
    Boolean(hairDonor(style)),
    spec.bodyStyle === 'character' && hairSources().map((source) => Boolean(source && hairLit(source))),
    style === 'own' || hairReady(style),
  ]);
}
let bodyKey = '';

function rebuild() {
  // 不在摆姿势：先把网格放回静止的样子，下面照平时那样重建
  if (mode !== 'pose') leavePose();
  const key = bodyKeyOf();
  if (mode !== 'pose' || key !== bodyKey || (!figure && !character)) {
    bodyKey = key;
    rebuildBody();
  }
  if (mode === 'pose') syncPosing();
}

function rebuildBody() {
  const t0 = performance.now();
  if (spec.bodyStyle === 'character') {
    ensureCharacter();
    ensureHair();
    ensureHairLight();
    if (showCharacter()) {
      syncTweak();
      syncBones();
      lastBuildMs = performance.now() - t0;
      return;
    }
  }
  character = null;
  tweaked = null;
  characterModel.root.visible = false;
  if (spec.bodyStyle === 'anime') ensureAnimeBody();
  if (spec.bodyStyle !== 'character') ensureHairShape();
  figure = buildFigure(spec);
  picker = null;
  metrics = figure.metrics;
  scheduleClashCheck(figure);
  const isFused = spec.meshMode === 'fused';
  model.root.visible = !isFused;
  fused.root.visible = isFused;
  if (isFused) {
    // 摆姿势时屏幕上的网格要跟着骨骼动：让它顺便把权重算出来
    fused.request(figure, spec.blend, mode === 'pose');
    showFused();
  } else {
    const stats = model.update(figure);
    showBounds(stats.box);
    showReadout(`${count(stats.triangles)} 三角面`);
  }
  syncTweak();
  syncBones();
  lastBuildMs = performance.now() - t0;
}

/** 骨架的示意线跟上现在的角色（没开「骨骼」就收起来） */
function syncBones() {
  bones.update(!showBones ? null : character ? characterSkeleton(character) : figure ? buildSkeleton(figure) : null);
}

const btnBones = $<HTMLButtonElement>('btnBones');
btnBones.addEventListener('click', () => {
  showBones = !showBones;
  btnBones.setAttribute('aria-pressed', String(showBones));
  syncBones();
  // 摆姿势时画的是摆好以后的骨架
  if (mode === 'pose') showPose();
});

/** 一帧里不管参数变了几次，模型只重建一次 */
let pending = false;
function scheduleRebuild() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    rebuild();
  });
}

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  btn.addEventListener('click', () => viewport?.frame(btn.dataset.view as ViewName));
}

/* ---------------- 手动微调 ---------------- */

/** 选中的部件实例名。选中状态不进撤销历史，也不存档 */
let selected: string | null = null;
/** 左右成对的部件：改一侧时对侧同时改成镜像的样子 */
let mirror = true;
/** 缩放时锁定比例 */
let lockRatio = true;
let gizmoMode: GizmoMode = 'translate';
/** 融合模式下查「这一点属于哪个部件」用的，按需生成，模型一变就作废 */
let picker: Picker | null = null;
/** 位置偏移存的是摆位用的单位；乘上这个数就是屏幕上这个角色身上的厘米 */
let cmPerUnit = 100;

const TWEAK_FIELDS = [
  { key: 'position', label: '位置', unit: 'cm', step: 0.5, digits: 1 },
  { key: 'rotation', label: '角度', unit: '°', step: 1, digits: 1 },
  { key: 'scale', label: '大小', unit: '倍', step: 0.05, digits: 2 },
] as const;
type TweakKey = (typeof TWEAK_FIELDS)[number]['key'];

/** 「大小」的三个方向各是什么意思 */
const SCALE_HINT: Partial<Record<PartType, string>> = {
  arm: 'Y 是手臂的长短，X、Z 是粗细',
  leg: 'Y 是上下的长短，X、Z 是粗细',
  tail: 'Z 是前后的长短，X 宽、Y 高',
  wing: 'X 是翼展，Y 高、Z 厚',
  ear: 'X 宽、Y 长、Z 厚',
};

/** 选中部件现在的微调，换成面板上显示的单位（位置是厘米） */
function shownValues(key: TweakKey): Vec3 {
  const o = selected ? activeOverrides(spec)[selected] : undefined;
  const v = o?.[key] ?? (key === 'scale' ? [1, 1, 1] : [0, 0, 0]);
  return key === 'position' ? [v[0] * cmPerUnit, v[1] * cmPerUnit, v[2] * cmPerUnit] : [v[0], v[1], v[2]];
}

/** 改选中部件的微调。key 用来把连续的小改动并成一步撤销 */
function applyTweak(patch: PartOverride, key?: string) {
  if (!selected) return;
  spec = setOverride(spec, selected, patch, mirror);
  commit(key);
}

function select(name: string | null) {
  if (name === selected) return;
  selected = name;
  history.seal();
  syncTweak();
}

const tweakPart = $<HTMLSelectElement>('tweakPart');
tweakPart.addEventListener('change', () => select(tweakPart.value || null));

const syncGizmoMode = buildSeg($('segGizmo'), GIZMO_MODES, (v) => GIZMO_LABEL[v], (mode) => {
  gizmoMode = mode;
  gizmo?.setMode(mode);
});

const tweakRows = TWEAK_FIELDS.map((field) => {
  const row = el('div', 'triple');
  const name = el('span', '', field.label);
  name.append(el('small', '', field.unit));
  row.append(name);
  const inputs = ['X', 'Y', 'Z'].map((axisName, axis) => {
    const wrap = el('label', '', axisName);
    const input = el('input');
    input.type = 'number';
    input.step = String(field.step);
    input.setAttribute('aria-label', `${field.label} ${axisName}`);
    input.addEventListener('input', () => {
      if (!selected || input.value.trim() === '') return;
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      // 「0.5」是一个字一个字敲出来的：敲到一半的「0」不算数
      if (field.key === 'scale' && v < OVERRIDE_LIMITS.scaleMin) return;
      const cur = shownValues(field.key);
      let next: Vec3 = [cur[0], cur[1], cur[2]];
      next[axis] = v;
      if (field.key === 'scale' && lockRatio) {
        const k = v / cur[axis];
        next = [cur[0] * k, cur[1] * k, cur[2] * k];
      }
      if (field.key === 'position') next = [next[0] / cmPerUnit, next[1] / cmPerUnit, next[2] / cmPerUnit];
      applyTweak({ [field.key]: next }, `tweak:${selected}:${field.key}:${axis}`);
    });
    // 输完以后把显示整理一遍（超出范围的数会被收回来）；下一次再改这一格另算一步撤销
    input.addEventListener('change', () => {
      history.seal();
      syncTweakFields(true);
    });
    wrap.append(input);
    row.append(wrap);
    return input;
  });
  $('tweakFields').append(row);
  return { field, inputs };
});

/** 把数值框同步到选中部件现在的微调。正在输入的那一格不动，除非 force */
function syncTweakFields(force = false) {
  for (const { field, inputs } of tweakRows) {
    const values = shownValues(field.key);
    inputs.forEach((input, axis) => {
      if (!force && document.activeElement === input) return;
      const shown = String(Number(values[axis].toFixed(field.digits)));
      if (input.value !== shown) input.value = shown;
    });
  }
}

const lockInput = $<HTMLInputElement>('tweakLock');
lockInput.addEventListener('change', () => {
  lockRatio = lockInput.checked;
  if (gizmo) gizmo.lockRatio = lockRatio;
});

const mirrorInput = $<HTMLInputElement>('tweakMirror');
mirrorInput.addEventListener('change', () => {
  mirror = mirrorInput.checked;
});

const btnTweakReset = $<HTMLButtonElement>('btnTweakReset');
btnTweakReset.addEventListener('click', () => {
  if (!selected) return;
  spec = clearOverride(spec, selected, mirror);
  commit();
});
$('btnTweakDone').addEventListener('click', () => select(null));

/** 部件列表上一次画出来时的内容，没变就不重画（重画会打断正在展开的下拉框） */
let partListKey = '';

/** 能单独微调的部件：白模人台、二次元素体是摆好的部件，成品角色是按骨骼分的部件（见 character/tweak.ts） */
function tweakable(): readonly { name: string; type: PartType }[] {
  return figure ? figure.parts : (tweaked?.parts ?? []);
}

function renderTweak() {
  const names = tweakable().map((p) => p.name);
  const key = names.map((n) => (activeOverrides(spec)[n] ? `${n}*` : n)).join('|');
  if (key !== partListKey) {
    partListKey = key;
    const options = [new Option('（在模型上点一个部件，或者在这里选）', '')];
    for (const n of names) {
      options.push(new Option(`${partLabel(n)}${activeOverrides(spec)[n] ? '（已微调）' : ''} · ${n}`, n));
    }
    tweakPart.replaceChildren(...options);
  }
  tweakPart.value = selected ?? '';

  const part = selected ? tweakable().find((p) => p.name === selected) : undefined;
  $('tweakBody').hidden = !part;
  if (part) {
    syncGizmoMode(gizmoMode, Boolean(gizmo));
    syncTweakFields();
    lockInput.checked = lockRatio;
    mirrorInput.checked = mirror;
    const twin = mirrorName(part.name);
    $('tweakMirrorRow').hidden = !twin;
    if (twin) $('tweakMirrorText').textContent = `同时调整对侧（${partLabel(twin)}）`;
    btnTweakReset.disabled = !activeOverrides(spec)[part.name];
    const frame = part.type === 'eye' || part.type === 'horn' || part.type === 'ear' ? '这个头的' : '角色的';
    $('tweakNote').textContent =
      `X 是${frame}左手边，Y 朝上，Z 朝前；角度绕这三根轴转，以关节为中心。` +
      `大小：${SCALE_HINT[part.type] ?? 'X 宽、Y 高、Z 厚'}。` +
      (character
        ? '成品角色的部件是照骨骼分的：和身体连着的地方（肩膀、腿根、脖子）跟着拉长；复制出来的手臂、角、尾巴、翅膀是整块挪的。'
        : '');
  } else {
    $('tweakNote').textContent = '在模型上点一下某个部件，或者在上面选，就能单独调它的位置、角度和大小。';
  }
  // 舞台左下角也标出选中的是谁：面板滚走了也看得见
  syncPicked();

  // 已经微调过的部件：点名字可以直接选中
  const all = Object.keys(activeOverrides(spec));
  const changed = names.filter((n) => activeOverrides(spec)[n]);
  const host = $('tweaked');
  host.hidden = all.length === 0;
  if (all.length) {
    const items: HTMLElement[] = [el('span', '', '已微调：')];
    for (const n of changed) {
      const chip = el('button', n === selected ? 'chip hit' : 'chip', partLabel(n));
      chip.type = 'button';
      chip.title = n;
      chip.addEventListener('click', () => select(n));
      items.push(chip);
    }
    if (all.length > changed.length) {
      items.push(el('span', '', `另有 ${all.length - changed.length} 条对应的部件现在不存在`));
    }
    const clear = el('button', 'btn ghost', '全部还原');
    clear.type = 'button';
    clear.addEventListener('click', () => {
      spec = clearAllOverrides(spec);
      commit();
    });
    items.push(clear);
    host.replaceChildren(...items);
  }
}

/** 模型重建、或者换了选中的部件以后：把高亮、操纵杆和面板同步过来 */
function syncTweak() {
  if (selected && !tweakable().some((p) => p.name === selected)) selected = null;
  const frame = !selected ? null : figure ? partFrame(figure, selected) : (tweaked?.frames.get(selected) ?? null);
  cmPerUnit = frame ? frame.parentScale * 100 : 100;
  const override = selected ? activeOverrides(spec)[selected] : undefined;
  if (tweaked && character) {
    // 成品角色：高亮的形状跟着微调变，拖着的时候每次都要换
    const at = tweaked;
    gizmo?.syncFrame(frame, () => characterPartGlow(at, selected!), `${selected}|${characterVersion}`, override);
  } else {
    gizmo?.sync(figure, selected, override);
  }
  renderTweak();
}

/** 屏幕上的一条射线点中了哪个部件 */
function pickPart(ray: Raycaster): string | null {
  if (tweaked && character) {
    // 成品角色：看点中的那一点离哪个部件的顶点最近
    const hit = ray.intersectObject(characterModel.root, true)[0];
    return hit ? characterPartAt(tweaked, [hit.point.x, hit.point.y, hit.point.z]) : null;
  }
  if (!figure) return null;
  const isFused = spec.meshMode === 'fused';
  const hit = ray.intersectObject(isFused ? fused.root : model.root, true)[0];
  if (!hit) return null;
  // 分部件模式、以及融合模式下的眼睛：点中的物体就是部件
  if (!isFused || hit.object.name !== 'Body') return hit.object.name || null;
  // 融合模式下身体是一整块：看这一点离哪个部件最近
  picker ??= makePicker(figure);
  return picker([hit.point.x, hit.point.y, hit.point.z]);
}

$('pickedClear').addEventListener('click', () => {
  select(null);
  selectJoint(null);
});

if (gizmo) {
  gizmo.pick = pickPart;
  gizmo.onPick = (name) => {
    select(name);
    // 在模型上点中了部件：把「手动微调」那一栏亮出来
    if (name) reveal('tweak');
  };
  gizmo.onChange = (patch) => applyTweak(patch, `gizmo:${selected}`);
  gizmo.onDrag = (active) => {
    // 每次拖动单独算一步撤销
    history.seal();
    tweaking = active;
    // 松手以后存档、刷新面板，再同步一次：操纵杆回到按存下来的数值算出的位置（数值被取整、限幅过）
    if (!active) {
      save();
      render();
    }
  };
}

window.addEventListener('keydown', (e) => {
  const target = e.target;
  // 在文字框、数字框里时，Ctrl+Z 留给浏览器自己撤销输入
  const typing =
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && (target.type === 'number' || target.type === 'text'));
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (typing) return;
    const k = e.key.toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (k === 'y') {
      e.preventDefault();
      redo();
    }
    return;
  }
  if (e.key === 'Escape') {
    if (selected) select(null);
    else if (joint) selectJoint(null);
  }
});

/* ---------------- 摆姿势 ---------------- */

/** 现在在做哪一件事：造型（定身体）还是摆姿势。不进撤销历史，也不存档：每次打开都从造型开始 */
type Mode = 'shape' | 'pose';
let mode: Mode = 'shape';

/** 现在这个身体摆姿势要用的东西：骨架、手臂和腿、关节上的圆点。身体一变就重算 */
interface PoseKit {
  solver: Solver;
  handles: Handle[];
  /** 融合模式下眼睛的标记各跟着哪根骨骼（键是部件名） */
  eyeBone: Map<string, number>;
  /** 是照哪个身体算的（摆位结果或者拼好的成品角色）：换了就要重算 */
  body: unknown;
}
let kit: PoseKit | null = null;
/** 屏幕上现在的姿势（拖着的时候是还没存的） */
let poseState: PoseState | null = null;
let poseFrame: Frame | null = null;
/** 跟着骨骼动的那几张网格，以及它们是照哪张网格记下来的 */
let posed: PosedMeshes | null = null;
let posedFor: unknown = null;
/** 正在等网格的权重算出来 */
let poseWaiting = false;
/** 选中的圆点（Handle.id）。和选中的部件一样，不进撤销历史、不存档 */
let joint: string | null = null;
/** 拖别处的时候留在原地的手脚（名字是末端那根骨骼）。新长出来的腿、手照下面两个开关定 */
const pinned = new Set<string>();
let pinFeet = true;
let pinHands = false;
/** 哪几组圆点亮着。指尖、头发衣摆的点又小又密，平时收着，要用的时候再打开 */
const shownGroups = new Set<HandleGroup>(HANDLE_GROUPS.filter((group) => group !== 'hair' && group !== 'finger'));
/** 一次拖动：按下去那一刻的姿势，和那一刻钉着的手脚 */
let grab: { start: PoseState; frame: Frame; pins: Pin[] } | null = null;

const GROUP_LABEL: Record<HandleGroup, string> = {
  torso: '躯干',
  head: '头',
  arm: '手臂',
  leg: '腿',
  finger: '手指',
  tail: '尾巴、翅膀',
  hair: '头发、衣摆',
};

$('poseNote').textContent =
  '拖模型上的圆点摆姿势。青色的大圆点是手、脚和胯：拖手脚，肘和膝自己跟着弯，够不着时身体会跟过去。' +
  '黄色的菱形是手肘、膝盖朝哪边顶。白色的小圆点是别的关节。' +
  '点一下圆点会出现旋转环，转的是从这个关节往外的那一段。拖空白的地方是转视角。';

const pickedHandle = (): Handle | undefined => (joint && kit ? kit.handles.find((h) => h.id === joint) : undefined);
/** 这个圆点管的是哪条手臂、腿（不是手脚上的点就没有） */
const limbOf = (handle: Handle) => (kit && handle.limb >= 0 ? kit.solver.limbs[handle.limb] : undefined);

/** 照现在的身体把骨架、圆点备好 */
function ensureKit(): PoseKit | null {
  const body = character ?? figure;
  if (!body) return null;
  if (kit?.body === body) return kit;
  const skeleton: Skeleton = character ? characterSkeleton(character) : buildSkeleton(figure!);
  const solver = makeSolver(skeleton.bones);
  const { limbs } = solver;
  // 原来有的手脚钉没钉保持原样；新长出来的照开关定；没有了的去掉
  const before = new Set(kit?.solver.limbs.map((l) => l.name));
  for (const limb of limbs) {
    if (!before.has(limb.name) && (limb.kind === 'leg' ? pinFeet : pinHands)) pinned.add(limb.name);
  }
  for (const name of [...pinned]) if (!limbs.some((l) => l.name === name)) pinned.delete(name);
  // 眼睛的标记不在融合的网格里：各自跟着所在的那个头的骨骼
  const eyeBone = new Map<string, number>();
  if (figure && !character) {
    const byName = new Map(figure.parts.map((p) => [p.name, p]));
    for (const part of figure.parts) {
      if (part.material !== 'eye') continue;
      for (let p = part.parent ? byName.get(part.parent) : undefined; p; p = p.parent ? byName.get(p.parent) : undefined) {
        const owned = skeleton.bones.findIndex((b) => b.part === p!.name);
        if (owned < 0) continue;
        eyeBone.set(part.name, owned);
        break;
      }
    }
  }
  kit = { solver, handles: buildHandles(solver), eyeBone, body };
  poseHandles?.setHandles(kit.handles);
  if (joint && !kit.handles.some((h) => h.id === joint)) joint = null;
  return kit;
}

/** 分部件：所有部件的顶点、三角面接成一份（算蒙皮权重用：权重沿着表面传，要知道哪些顶点是连着的） */
function joinMeshes(meshes: readonly BakedMesh[]): { positions: Float32Array; triangles: Uint32Array } {
  const positions = new Float32Array(meshes.reduce((n, m) => n + m.positions.length, 0));
  const triangles = new Uint32Array(meshes.reduce((n, m) => n + m.indices.length, 0));
  let vertex = 0;
  let corner = 0;
  for (const m of meshes) {
    positions.set(m.positions, vertex * 3);
    for (let i = 0; i < m.indices.length; i++) triangles[corner++] = m.indices[i] + vertex;
    vertex += m.positions.length / 3;
  }
  return { positions, triangles };
}

/** 把屏幕上的网格备成能跟着骨骼动的。还没备好（融合网格的权重还在算）返回 false */
function ensurePosed(): boolean {
  let sources: SkinSource[] | null = null;
  let from: unknown = null;
  if (character) {
    sources = characterModel.skinSources();
    from = character;
  } else if (figure && spec.meshMode === 'fused') {
    const body = fused.skinSource();
    sources = body ? [body] : null;
    from = body?.geometry ?? null;
  } else if (figure) {
    from = figure;
    if (posedFor !== from) {
      // 分部件：所有部件的顶点放在一起算一次权重，换成一组不分父子、能弯的网格
      const meshes = model.bakedMeshes();
      const { positions, triangles } = joinMeshes(meshes);
      const skeleton = buildSkeleton(figure);
      sources = flatParts.set(meshes, bindPartGrafts(skinVertices(figure, skeleton, positions, triangles, meshes), figure, skeleton, meshes));
    }
  }
  if (!from) {
    posed = null;
    posedFor = null;
    return false;
  }
  if (posedFor !== from && sources) {
    posed = new PosedMeshes(sources);
    posedFor = from;
    const build = character;
    if (build?.morphs) {
      // 成品角色的表情：加在静止的样子上，再跟着骨骼搬
      const chunks = characterModel.chunks();
      posed.edit = (index, position, normal) => {
        applyFaces(build, chunks[index], spec.posing.faces, position, normal);
      };
    }
  }
  return Boolean(posed);
}

/** 把 poseState 这个姿势显示出来：网格、眼睛、圆点、旋转环、骨架线 */
function showPose() {
  if (!kit || !poseState) return;
  const { rig } = kit.solver;
  const frame = (poseFrame = forward(rig, poseState));
  const matrices = poseMatrices(rig, frame);
  // 正拖着圆点、转着旋转环时，包围盒不逐个顶点重算（松手以后同步那一次再算准的）
  posed?.apply(matrices, Boolean(grab));
  if (figure && !character && spec.meshMode === 'fused') {
    const unit = figure.scale;
    // 屏幕上先是照权重跟着骨骼动的那张；姿势停下来以后，后台照它重新融合一张换上（见 FusedModel.pose）。
    // 有的身体不这么办（见 refusable）：那就一直是照权重的这一张
    if (posed) {
      const exact = poseMatrices(rig, frame, unit);
      fused.pose(refusable(figure, exact) ? exact : null);
    }
    const eyes = kit.eyeBone;
    fused.poseEyes((part) => {
      const b = eyes.get(part);
      if (b === undefined) return null;
      const o = b * 12;
      const m = matrices;
      return new Matrix4().set(
        m[o], m[o + 1], m[o + 2], m[o + 9] / unit,
        m[o + 3], m[o + 4], m[o + 5], m[o + 10] / unit,
        m[o + 6], m[o + 7], m[o + 8], m[o + 11] / unit,
        0, 0, 0, 1,
      );
    });
  }
  poseHandles?.place(
    kit.handles.map((h) => pointOn(rig, frame, h.anchor, h.rest)),
    (h) => shownGroups.has(h.group),
  );
  placeRing();
  if (showBones) bones.update({ bones: posedBones(rig, frame).map((b) => ({ ...b, part: '' })) });
}

/** 旋转环摆到选中的关节上：绿色那一圈正好绕着骨头自己转 */
function placeRing() {
  const handle = pickedHandle();
  if (!handle || !kit || !poseFrame) {
    poseHandles?.ring(null);
    return;
  }
  const { rig } = kit.solver;
  const along = sub(rig.tail[handle.turn], rig.head[handle.turn]);
  const base = len(along) > 1e-9 ? quatBetween(UP, norm(along)) : Q_ID;
  poseHandles?.ring({ pos: poseFrame.pos[handle.turn], quat: quatMul(poseFrame.rot[handle.turn], base) });
}

/** 圆点的样子（选中的、钉着的）跟上现在的状态 */
function markHandles() {
  poseHandles?.mark(joint, (h) => {
    const limb = limbOf(h);
    return Boolean(limb && pinned.has(limb.name));
  });
}

/** 摆姿势时：模型重建了、姿势变了、撤销了……把屏幕上的一切同步到 spec.posing */
function syncPosing() {
  const k = ensureKit();
  if (!k) return;
  const ready = ensurePosed();
  // 融合网格的权重要算一小会儿：算好之前圆点先亮着，网格等一下才跟上
  if (!ready && !poseWaiting) setStatus('正在给网格配上骨骼，马上就能摆…');
  else if (ready && poseWaiting) setStatus('可以摆姿势了：拖模型上的圆点。');
  poseWaiting = !ready;
  // 分部件模式：摆姿势时显示的是另一组能弯的网格
  const flat = !character && spec.meshMode === 'parts';
  flatParts.root.visible = flat && ready;
  if (flat) model.root.visible = !ready;
  // 正拖着的时候屏幕上是还没存的姿势，不去动它
  if (!poseHandles?.busy) poseState = stateOf(k.solver, spec.posing);
  showPose();
  markHandles();
  if (ready && !poseHandles?.busy) {
    const box = posed!.bounds();
    if (!box.isEmpty()) viewport?.setBounds(box);
  }
  renderPosePanel();
}

/** 离开摆姿势：网格放回静止的样子 */
function leavePose() {
  if (posed) posed.restore();
  posed = null;
  posedFor = null;
  flatParts.root.visible = false;
  flatParts.clear();
  fused.poseEyes(null);
  fused.pose(null);
  poseState = null;
  poseFrame = null;
  poseWaiting = false;
  grab = null;
}

const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('.mode [data-go]')];
function setMode(next: Mode) {
  if (next === mode) return;
  mode = next;
  document.querySelector<HTMLElement>('.app')!.dataset.mode = next;
  for (const btn of modeButtons) btn.setAttribute('aria-pressed', String(btn.dataset.go === next));
  // 两边各有各的选中：换过去的时候都清掉
  select(null);
  joint = null;
  if (gizmo) gizmo.enabled = next === 'shape';
  if (poseHandles) poseHandles.enabled = next === 'pose';
  showHint(next);
  history.seal();
  syncPicked();
  renderPosePanel();
  scheduleRebuild();
}
for (const btn of modeButtons) btn.addEventListener('click', () => setMode(btn.dataset.go as Mode));

function selectJoint(id: string | null) {
  if (id === joint) return;
  joint = id;
  markHandles();
  placeRing();
  syncPicked();
  renderPosePanel();
}

/** 舞台左下角的小牌子：造型时写选中的部件，摆姿势时写选中的关节 */
function syncPicked() {
  const part = mode === 'shape' && selected ? tweakable().find((p) => p.name === selected) : undefined;
  const handle = mode === 'pose' ? pickedHandle() : undefined;
  $('picked').hidden = !part && !handle;
  if (part) $('pickedName').textContent = `${partLabel(part.name)} · ${part.name}`;
  if (handle) $('pickedName').textContent = handle.label;
}

/** 按下圆点、或者开始转旋转环：记下这一刻的姿势和钉着的手脚 */
function beginGrab() {
  if (!kit || !poseState) return;
  const frame = forward(kit.solver.rig, poseState);
  grab = { start: poseState, frame, pins: capturePins(kit.solver, frame, pinned) };
}

/**
 * 屏幕上的姿势定下来：存进设定，记一步撤销。
 * keep：这副骨架上没有的骨骼照它留着（平时就是原来的姿势；整份换掉的时候是新的那一份）
 */
function commitPose(keep: Posing = spec.posing, key?: string) {
  if (!kit || !poseState) return;
  // key：拖滑块的时候连着的修改算一步撤销
  if (!key) history.seal();
  spec = { ...spec, posing: posingOf(kit.solver, poseState, keep) };
  commit(key);
}

/** 直接换一个姿势（对称、翻转、还原） */
function editPosing(next: Posing, key?: string) {
  spec = { ...spec, posing: next };
  commit(key);
}

if (poseHandles) {
  poseHandles.onGrab = beginGrab;
  poseHandles.onDrag = (handle, target) => {
    if (!kit || !grab) return;
    const { solver } = kit;
    if (handle.kind === 'reach') poseState = dragReach(solver, grab.start, handle.limb, target, grab.pins);
    else if (handle.kind === 'bend') poseState = dragBend(solver, grab.start, handle.limb, target);
    else if (handle.kind === 'body') poseState = dragBody(solver, grab.start, target, grab.pins);
    else if (handle.links.length) poseState = dragAim(solver, grab.start, handle.links, { bone: handle.anchor, rest: handle.rest }, target, grab.pins);
    showPose();
  };
  poseHandles.onRelease = (_handle, moved) => {
    grab = null;
    if (moved) commitPose();
  };
  poseHandles.onPick = (handle) => selectJoint(handle?.id ?? null);
  poseHandles.onTurnStart = beginGrab;
  poseHandles.onTurn = (delta) => {
    const handle = pickedHandle();
    if (!kit || !grab || !handle) return;
    poseState = turnBone(kit.solver, grab.start, handle.turn, quatMul(delta, grab.frame.rot[handle.turn]), grab.pins);
    showPose();
  };
  poseHandles.onTurnEnd = () => {
    grab = null;
    commitPose();
  };
}

/** 现在的姿势，照现在的记法写（以前的版本存下来的姿势先换算过来，再做对称、翻转） */
const posingNow = (): Posing =>
  kit && spec.posing.version !== POSING_VERSION ? posingOf(kit.solver, stateOf(kit.solver, spec.posing), spec.posing) : spec.posing;
/** 把一侧照到另一侧：对侧相对身体摆成镜像 */
function mirrorSide(from: 'L' | 'R') {
  if (!kit) return;
  const { solver } = kit;
  editPosing(posingOf(solver, mirrorState(solver, stateOf(solver, spec.posing), from), spec.posing));
}
$('btnPoseL2R').addEventListener('click', () => mirrorSide('L'));
$('btnPoseR2L').addEventListener('click', () => mirrorSide('R'));
$('btnPoseFlip').addEventListener('click', () => editPosing(flipPosing(posingNow())));
$('btnPoseReset').addEventListener('click', () => editPosing(emptyPosing()));
/** 整个人上下挪一下，让最低的地方正好贴着地面。只改屏幕上的姿势，还没存；没什么可挪的返回 false */
function dropToGround(): boolean {
  if (!kit || !poseState || !posed) return false;
  const low = posed.bounds().min.y;
  if (!Number.isFinite(low) || Math.abs(low) < 1e-4) return false;
  const { rig } = kit.solver;
  const next = cloneState(poseState);
  const drop: V3 = [0, -low, 0];
  shiftRoot(rig, next, forward(rig, next), drop);
  poseState = next;
  showPose();
  return true;
}
$('btnPoseGround').addEventListener('click', () => {
  if (dropToGround()) commitPose();
});

/* ---- 自然下垂：头发、裙摆、衣摆、袖子（勾上的话还有尾巴）照重力垂下来 ---- */

const DRAPE_LABEL: Record<DrapeKind, string> = { hair: '头发', cloth: '裙摆、衣摆、袖子', tail: '尾巴' };
$('btnPoseDrape').addEventListener('click', () => {
  if (!kit || !poseState || !posed) return;
  const { rig } = kit.solver;
  const tails = $<HTMLInputElement>('poseDrapeTails').checked;
  const bones = drapeBones(rig, tails);
  if (!bones.size) {
    const hasTails = !tails && drapeBones(rig, true).size > 0;
    setStatus(
      `${character ? '这个角色没有会垂下来的头发、裙摆' : '白模的头发没有骨骼（整个跟着头动），垂不下来'}${hasTails ? '；要尾巴垂下来，先勾上「尾巴也垂」' : ''}。`,
    );
    return;
  }
  // 身体表面：现在摆着的和静止时的，头发、裙摆自己不算
  const { now, rest, own } = posed.sample(new Set(bones.keys()));
  poseState = drape(rig, poseState, bones, {
    now: new BodySurface(now.points, now.normals),
    rest: new BodySurface(rest.points, rest.normals),
    floor: 0,
    radius: boneRadius(rig, own),
  });
  showPose();
  commitPose();
  const kinds = [...new Set(bones.values())].map((kind) => DRAPE_LABEL[kind]).join('、');
  setStatus(`${kinds}照重力垂下来了；身体再动以后，再点一次「自然下垂」。`);
});

/** 换成另一份姿势（现成的姿势、姿势文件）。ground：套上以后落到地面（换了角色腿长不一样，脚会悬空或者陷下去） */
function usePosing(posing: Posing, ground: boolean) {
  if (!kit) return;
  const before = stateOf(kit.solver, spec.posing);
  poseState = stateOf(kit.solver, posing);
  // 换上去的那份里没有眼睛（现成的姿势都没有）：视线照原来的留着
  for (const face of allFaces()) {
    const eyes = eyesOf(face);
    if (!eyes || face.eyes!.some((name) => name in posing.bones)) continue;
    for (const eye of eyes) poseState.local[eye] = before.local[eye];
  }
  showPose();
  if (ground) dropToGround();
  // 表情也是：换上去的那份里没有，脸上原来的就留着
  commitPose(posing.faces || !spec.posing.faces ? posing : { ...posing, faces: spec.posing.faces });
}

/* ---- 姿势文件：单独存一份姿势，连同看的角度 ---- */

const readTriple = (v: unknown): [number, number, number] | null =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [v[0], v[1], v[2]] : null;

$('btnPoseSave').addEventListener('click', async () => {
  if (!kit) return;
  const { solver } = kit;
  const file = {
    app: 'oc-basemesh',
    kind: 'pose',
    posing: posingOf(solver, stateOf(solver, spec.posing), spec.posing),
    ...(viewport ? { camera: viewport.cameraState() } : {}),
  };
  try {
    const where = await saveText('oc_pose.json', JSON.stringify(file, null, 2));
    setStatus(`已保存姿势 oc_pose.json，${where}。`);
  } catch (err) {
    setStatus(`姿势没存成：${err instanceof Error ? err.message : err}`, true);
  }
});

const filePose = $<HTMLInputElement>('filePose');
filePose.addEventListener('change', async () => {
  const file = filePose.files?.[0];
  filePose.value = '';
  if (!file) return;
  try {
    const data: unknown = JSON.parse(await file.text());
    // 姿势文件，或者整份配置（用里面的姿势）
    if (typeof data !== 'object' || data === null || !('posing' in data)) throw new Error('no pose');
    const posing = cleanPosing((data as { posing: unknown }).posing);
    if (!isPosed(posing)) throw new Error('empty pose');
    usePosing(posing, false);
    // 存的时候是从哪个角度看的，也摆回去
    const camera = (data as { camera?: { position?: unknown; target?: unknown; fov?: unknown } }).camera;
    const position = readTriple(camera?.position);
    const target = readTriple(camera?.target);
    if (viewport && position && target) {
      const state: CameraState = { position, target, fov: dial('fov', camera?.fov) };
      viewport.setCamera(state);
      view.fov = state.fov;
      applyView();
    }
    setStatus(`已载入姿势 ${file.name}。`);
  } catch {
    setStatus('这个文件里没有读到姿势。', true);
  }
});

/* ---- 手势：选几只手，点一个现成的手势，或者一根根手指调 ---- */

type HandSide = 'both' | 'L' | 'R';
const HAND_SIDES: readonly HandSide[] = ['both', 'L', 'R'];
const HAND_SIDE_LABEL: Record<HandSide, string> = { both: '两只手', L: '左手', R: '右手' };
/** 「哪一对手臂」：全部，或者第几对 */
const HAND_PAIRS = ['all', '1', '2', '3', '4'] as const;
type HandPair = (typeof HAND_PAIRS)[number];
/** 手势这一栏现在管哪几只手。和圆点的选中一样，不进撤销历史、不存档 */
let handSide: HandSide = 'both';
let handPair: HandPair = 'all';

const pickedHands = (): Hand[] =>
  (kit?.solver.hands ?? []).filter(
    (hand) => (handSide === 'both' || (handSide === 'L') === hand.side > 0) && (handPair === 'all' || hand.pair === Number(handPair) - 1),
  );

/** 把选中的几只手各自改一下：change 拿到这只手现在的手势，给出新的。key 相同的连续修改（拖同一个滑块）算一步撤销 */
function reshapeHands(change: (shape: HandShape) => HandShape, key?: string) {
  if (!kit || !poseState) return;
  const { solver } = kit;
  let next = poseState;
  for (const hand of pickedHands()) next = shapeHand(solver, next, hand, change(readHand(solver, next, hand)));
  poseState = next;
  showPose();
  commitPose(spec.posing, key);
}

const syncHandSide = buildSeg($('segHandSide'), HAND_SIDES, (v) => HAND_SIDE_LABEL[v], (side) => {
  handSide = side;
  renderPosePanel();
});
const syncHandPair = buildSeg($('segHandPair'), HAND_PAIRS, (v) => (v === 'all' ? '全部' : `第 ${v} 对`), (pair) => {
  handPair = pair;
  renderPosePanel();
});
const handPairLabels = [...$('segHandPair').querySelectorAll('label')];

const gestureButtons = GESTURES.map((gesture) => {
  const btn = el('button', 'btn', gesture.name);
  btn.type = 'button';
  btn.addEventListener('click', () => reshapeHands(() => gesture.shape));
  $('handGestures').append(btn);
  return btn;
});

/** 正拖着的那个滑块：拖的时候不把它拉回量出来的位置 */
let handDragging: HTMLInputElement | null = null;
/** 六个滑块：五根手指各弯多少，再加四指张开多少（finger 是 -1） */
const handDials = [...FINGER_NAMES.map((name, finger) => ({ label: FINGER_LABEL[name], finger })), { label: '张开', finger: -1 }].map((d) => {
  const row = el('div', 'slider');
  const id = `s-hand-${d.finger < 0 ? 'spread' : FINGER_NAMES[d.finger].toLowerCase()}`;
  const label = el('label', '', d.label);
  label.htmlFor = id;
  const input = el('input');
  input.type = 'range';
  input.id = id;
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  const out = el('output');
  out.htmlFor.add(id);
  input.addEventListener('input', () => {
    handDragging = input;
    const v = Number(input.value);
    reshapeHands((shape) => (d.finger < 0 ? withSpread(shape, v) : withCurl(shape, d.finger, v)), `hand:${d.finger}`);
  });
  input.addEventListener('change', () => {
    handDragging = null;
    history.seal();
    renderPosePanel();
  });
  row.append(label, input, out);
  $('handSliders').append(row);
  return (dials: HandDials | null) => {
    const v = dials ? (d.finger < 0 ? dials.spread : dials.curl[d.finger]) : 0;
    if (input !== handDragging && Math.abs(Number(input.value) - v) > 0.004) input.value = String(Math.round(v * 100) / 100);
    out.textContent = `${Math.round(Number(input.value) * 100)}%`;
    input.disabled = !dials;
    row.classList.toggle('off', !dials);
  };
});

const HAND_NOTE = {
  none: '这个身体上没有带手指的手。',
  mitten:
    '并指的手，四根手指是连成一片的：握拳、张开这类整只手一起动的手势像样，「剪刀手」「指」这种一根根分开的摆不出来。' +
    '要分开摆，到「造型 → 排布 → 手」里换成「分指」。',
  usual:
    '点一个手势，上面选中的手就摆成那样（不分左右）；再用滑块一根手指一根手指地调。' +
    '想直接拖指尖：在「姿势」栏的「显示哪些圆点」里打开「手指」，把手放大了再拖。',
};

function renderHand() {
  const all = kit?.solver.hands ?? [];
  const pairs = all.reduce((n, hand) => Math.max(n, hand.pair + 1), 0);
  // 选着的那一对没有了（手臂减掉了）：回到全部
  if (handPair !== 'all' && Number(handPair) > pairs) handPair = 'all';
  $('handBody').hidden = all.length === 0;
  $('handPairRow').hidden = pairs < 2;
  handPairLabels.forEach((label, i) => (label.hidden = i > pairs));
  syncHandSide(handSide, true);
  syncHandPair(handPair, true);
  const hands = pickedHands();
  const dials = kit && poseState && hands.length ? dialsOf(readHand(kit.solver, poseState, hands[0])) : null;
  for (const sync of handDials) sync(dials);
  for (const btn of gestureButtons) btn.disabled = !hands.length;
  const mitten = spec.bodyStyle === 'mannequin' && spec.hands === 'mitten';
  $('handNote').textContent = all.length === 0 ? HAND_NOTE.none : mitten ? HAND_NOTE.mitten : HAND_NOTE.usual;
}

/* ---- 表情和视线：只有成品角色有 ---- */

/** 表情栏现在管哪张脸：全部，或者某一张（FaceInstance.key）。不进撤销历史、不存档 */
let faceTarget = 'all';
/** 整张脸的表情（一次一种）；嘴型（一次一种）。名字是 VRM 里规定的那几个 */
const MOODS = [
  { key: '', label: '自然' },
  { key: 'joy', label: '开心' },
  { key: 'fun', label: '得意' },
  { key: 'angry', label: '生气' },
  { key: 'sorrow', label: '难过' },
  { key: 'surprised', label: '惊讶' },
  { key: 'extra', label: '> <' },
];
const MOUTHS = [
  { key: '', label: '闭着' },
  { key: 'a', label: '啊' },
  { key: 'i', label: '衣' },
  { key: 'u', label: '呜' },
  { key: 'e', label: '诶' },
  { key: 'o', label: '哦' },
];
/** 尖牙不是规定的表情，是这一批角色的脸上都有的一个变形 */
const FANG = 'HA_Fung1';

const allFaces = (): readonly FaceInstance[] => (character?.morphs ? character.faces : []);
const pickedFaces = (): FaceInstance[] => allFaces().filter((face) => faceTarget === 'all' || face.key === faceTarget);
/** 一张脸上，几个互相顶替的名字里现在开着的是哪个（开得最多的那个），和它开到多少 */
function leading(face: FaceWeights, keys: readonly { key: string }[]): { key: string; weight: number } {
  let best = { key: '', weight: 0 };
  for (const { key } of keys) if (key && (face[key] ?? 0) > best.weight) best = { key, weight: face[key] };
  return best;
}

/** 把选中的几张脸的表情各自改一下。key 相同的连续修改（拖同一个滑块）算一步撤销 */
function editFaces(change: (face: FaceWeights) => FaceWeights, key?: string) {
  const targets = pickedFaces();
  if (!targets.length) return;
  const faces: Record<string, FaceWeights> = { ...(spec.posing.faces ?? {}) };
  for (const target of targets) {
    const next = Object.fromEntries(Object.entries(change({ ...(faces[target.key] ?? {}) })).filter(([, weight]) => weight > 0));
    if (Object.keys(next).length) faces[target.key] = next;
    else delete faces[target.key];
  }
  const { faces: _old, ...rest } = posingNow();
  if (!key) history.seal();
  editPosing(Object.keys(faces).length ? { ...rest, faces } : rest, key);
}

/** 一排「选一个」的按钮；返回的函数把它同步到当前状态（available：哪几个这个角色有） */
function buildChoices(host: HTMLElement, options: readonly { key: string; label: string }[], onPick: (key: string) => void) {
  const buttons = options.map((option) => {
    const btn = el('button', 'btn', option.label);
    btn.type = 'button';
    btn.addEventListener('click', () => onPick(option.key));
    host.append(btn);
    return { btn, key: option.key };
  });
  return (picked: string, available: (key: string) => boolean) => {
    for (const { btn, key } of buttons) {
      btn.hidden = !available(key);
      btn.setAttribute('aria-pressed', String(key === picked));
    }
  };
}

const syncMoods = buildChoices($('faceMoods'), MOODS, (mood) => editFaces(() => (mood ? { [mood]: 1 } : {})));
const syncMouths = buildChoices($('faceMouths'), MOUTHS, (mouth) =>
  editFaces((face) => {
    const open = leading(face, MOUTHS).weight;
    for (const { key } of MOUTHS) delete face[key];
    // 换一种嘴型：张多大照原来的；原来闭着的就张到头
    if (mouth) face[mouth] = open || 1;
    return face;
  }),
);

/** 正拖着的那个滑块：拖的时候不把它拉回量出来的位置 */
let faceDragging: HTMLInputElement | null = null;
/** 一个 0–1（或者 -1–1）的滑块：read 给出现在的值（null 是用不上），write 在拖的时候改 */
function buildDial(host: HTMLElement, id: string, label: string, range: [number, number], text: (v: number) => string, write: (v: number) => void) {
  const row = el('div', 'slider');
  const name = el('label', '', label);
  name.htmlFor = id;
  const input = el('input');
  input.type = 'range';
  input.id = id;
  input.min = String(range[0]);
  input.max = String(range[1]);
  input.step = '0.01';
  const out = el('output');
  out.htmlFor.add(id);
  input.addEventListener('input', () => {
    faceDragging = input;
    write(Number(input.value));
  });
  input.addEventListener('change', () => {
    faceDragging = null;
    history.seal();
    renderPosePanel();
  });
  row.append(name, input, out);
  host.append(row);
  return (value: number | null) => {
    const v = value ?? 0;
    if (input !== faceDragging && Math.abs(Number(input.value) - v) > 0.004) input.value = String(Math.round(v * 100) / 100);
    out.textContent = text(Number(input.value));
    input.disabled = value === null;
    row.classList.toggle('off', value === null);
    row.hidden = false;
    return row;
  };
}
const percent = (v: number) => `${Math.round(v * 100)}%`;
const syncMoodDial = buildDial($('faceSliders'), 's-face-mood', '表情强度', [0, 1], percent, (v) =>
  editFaces((face) => {
    const mood = leading(face, MOODS).key;
    return mood ? { ...face, [mood]: v } : face;
  }, 'face:mood'),
);
const syncBlinkL = buildDial($('faceSliders'), 's-face-blink-l', '闭左眼', [0, 1], percent, (v) => editFaces((face) => ({ ...face, blink_l: v }), 'face:blink_l'));
const syncBlinkR = buildDial($('faceSliders'), 's-face-blink-r', '闭右眼', [0, 1], percent, (v) => editFaces((face) => ({ ...face, blink_r: v }), 'face:blink_r'));
const syncFang = buildDial($('faceSliders'), 's-face-fang', '尖牙', [0, 1], percent, (v) => editFaces((face) => ({ ...face, [FANG]: v }), 'face:fang'));
const syncMouthDial = buildDial($('mouthSliders'), 's-face-mouth', '张多大', [0, 1], percent, (v) =>
  editFaces((face) => {
    const mouth = leading(face, MOUTHS).key;
    return mouth ? { ...face, [mouth]: v } : face;
  }, 'face:mouth'),
);

/** 这张脸的眼睛骨骼在骨架里是第几根（[左, 右]）；没有眼睛骨骼就是 null */
function eyesOf(face: FaceInstance): [number, number] | null {
  if (!kit || !face.eyes) return null;
  const left = kit.solver.rig.index.get(face.eyes[0]);
  const right = kit.solver.rig.index.get(face.eyes[1]);
  return left === undefined || right === undefined ? null : [left, right];
}
/** 选中的脸里第一张有眼睛骨骼的：视线的滑块显示的是它 */
const gazeFace = (): FaceInstance | undefined => pickedFaces().find((face) => eyesOf(face));

/** 把选中的几张脸的视线各自定一下：gaze 给出每张脸要看哪 */
function setGaze(gaze: (face: FaceInstance, eyes: [number, number]) => Gaze, key?: string) {
  const look = character?.morphs?.look;
  if (!kit || !poseState || !look) return;
  const next = cloneState(poseState);
  let any = false;
  for (const face of pickedFaces()) {
    const eyes = eyesOf(face);
    if (!eyes) continue;
    const turns = gazeTurns(gaze(face, eyes), look, face);
    next.local[eyes[0]] = turns[0];
    next.local[eyes[1]] = turns[1];
    any = true;
  }
  if (!any) return;
  poseState = next;
  showPose();
  commitPose(spec.posing, key);
}
const gazeNow = (): Gaze | null => {
  const face = gazeFace();
  const eyes = face && eyesOf(face);
  const look = character?.morphs?.look;
  return face && eyes && poseState && look ? gazeOf(poseState.local[eyes[0]], look, face) : null;
};
const gazeText = (words: [string, string]) => (v: number) => (Math.abs(v) < 0.005 ? '正中' : `${v > 0 ? words[0] : words[1]} ${Math.round(Math.abs(v) * 100)}%`);
const syncGazeSide = buildDial($('gazeSliders'), 's-gaze-side', '左右', [-1, 1], gazeText(['她的左', '她的右']), (v) =>
  setGaze(() => [v, gazeNow()?.[1] ?? 0], 'gaze:side'),
);
const syncGazeUp = buildDial($('gazeSliders'), 's-gaze-up', '上下', [-1, 1], gazeText(['上', '下']), (v) => setGaze(() => [gazeNow()?.[0] ?? 0, v], 'gaze:up'));
$('btnGazeCamera').addEventListener('click', () => {
  const camera = viewport?.cameraState().position;
  if (!camera || !kit || !poseFrame) return;
  const frame = poseFrame;
  const { rig } = kit.solver;
  setGaze((face, eyes) => {
    const a = frame.pos[eyes[0]];
    const b = frame.pos[eyes[1]];
    const head = rig.index.get(face.bone);
    const facing = head === undefined ? face.quat : quatMul(frame.rot[head], face.quat);
    return gazeAt([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], facing, camera);
  });
});
$('btnGazeReset').addEventListener('click', () => setGaze(() => [0, 0]));
$('btnFaceReset').addEventListener('click', () => {
  // 表情和视线一起还原，算一步
  const look = character?.morphs?.look;
  const targets = pickedFaces();
  if (!kit || !poseState || !look || !targets.length) return;
  const next = cloneState(poseState);
  for (const face of targets) {
    const eyes = eyesOf(face);
    if (eyes) for (const eye of eyes) next.local[eye] = Q_ID;
  }
  poseState = next;
  const faces = Object.fromEntries(Object.entries(spec.posing.faces ?? {}).filter(([name]) => !targets.some((face) => face.key === name)));
  const { faces: _old, ...rest } = posingNow();
  commitPose(Object.keys(faces).length ? { ...rest, faces } : rest);
});

const FACE_NOTE = {
  none: '表情和视线只有「成品角色」有：白模人台、二次元素体没有嘴和眼球。',
  usual:
    '点一个表情，上面选中的脸就换成它；再用滑块调强度、单独闭一只眼、张嘴。「左眼」「右眼」是她自己的左右。' +
    '「看镜头」是让眼睛看向你现在看她的这个角度，转了视角要再点一次。',
  extra: '同一个头上多出来的那几张脸，表情可以各摆各的，眼睛转不了（它们没有自己的眼睛骨骼）。',
};
/** 「哪张脸」那一排按钮是照哪几张脸做的 */
let faceWhichFor = '';

function renderFace() {
  const faces = allFaces();
  $('faceBody').hidden = faces.length === 0;
  $('faceNote').textContent = faces.length === 0 ? FACE_NOTE.none : FACE_NOTE.usual + (faces.some((face) => !face.eyes) ? FACE_NOTE.extra : '');
  if (!faces.length) return;
  if (faceTarget !== 'all' && !faces.some((face) => face.key === faceTarget)) faceTarget = 'all';
  // 「哪张脸」：脸的数目变了才重做这一排
  const keys = faces.map((face) => face.key).join('|');
  if (keys !== faceWhichFor) {
    faceWhichFor = keys;
    $('faceWhich').replaceChildren(
      ...[{ key: 'all', label: '全部' }, ...faces.map((face) => ({ key: face.key, label: faceLabel(face.key) }))].map((option) => {
        const btn = el('button', 'btn', option.label);
        btn.type = 'button';
        btn.dataset.face = option.key;
        btn.addEventListener('click', () => {
          faceTarget = option.key;
          renderPosePanel();
        });
        return btn;
      }),
    );
  }
  $('faceWhichRow').hidden = faces.length < 2;
  for (const btn of $('faceWhich').querySelectorAll<HTMLButtonElement>('button')) btn.setAttribute('aria-pressed', String(btn.dataset.face === faceTarget));

  const morphs = character?.morphs;
  const has = (key: string) => !key || hasExpression(morphs, key);
  const shown = spec.posing.faces?.[pickedFaces()[0]?.key ?? ''] ?? {};
  const mood = leading(shown, MOODS);
  const mouth = leading(shown, MOUTHS);
  syncMoods(mood.key, has);
  syncMouths(mouth.key, has);
  syncMoodDial(mood.key ? mood.weight : null);
  syncBlinkL(has('blink_l') ? (shown.blink_l ?? 0) : null).hidden = !has('blink_l');
  syncBlinkR(has('blink_r') ? (shown.blink_r ?? 0) : null).hidden = !has('blink_r');
  syncFang(has(FANG) ? (shown[FANG] ?? 0) : null).hidden = !has(FANG);
  syncMouthDial(mouth.key ? mouth.weight : null);
  const gaze = gazeNow();
  syncGazeSide(gaze ? gaze[0] : null);
  syncGazeUp(gaze ? gaze[1] : null);
  $<HTMLButtonElement>('btnGazeCamera').disabled = !gaze;
  $<HTMLButtonElement>('btnGazeReset').disabled = !gaze;
}

/* ---- 现成的姿势 ---- */

/** 套现成的姿势时量手臂插没插进身体（见 pose/clear.ts）：只算身子、头、腿、胸，不算手臂、尾巴、翅膀、头发这些 */
const ARM_ROOM_PARTS = new Set<PartType>(['torso', 'lower', 'leg', 'neck', 'head', 'chest']);
let armRoom: { figure: Figure; dist: BodyDist } | null = null;
/** 静止姿势下身体的距离场，换了身体就重算。成品角色没有（它的身体不是距离场拼的），不让 */
function bodyDist(): BodyDist | null {
  if (character || !figure) return null;
  if (armRoom?.figure !== figure) {
    // 父部件没留下的也不留（距离场照父子关系摆部件）
    const kept = new Set<string>();
    const parts = figure.parts.filter((p) => {
      const keep = ARM_ROOM_PARTS.has(p.type) && (!p.parent || kept.has(p.parent));
      if (keep) kept.add(p.name);
      return keep;
    });
    const field = compileField({ scale: figure.scale, parts }, { blend: spec.blend });
    armRoom = { figure, dist: (x, y, z) => fieldAt(field, x, y, z) };
  }
  return armRoom.dist;
}

/* ---- 现成的姿势：套到哪些部位、手臂套给哪一对、套几成。只记在这一页里，不进配置 ---- */

const POSE_REGION_LABEL: Record<PoseRegion, string> = { head: '头和脖子', torso: '躯干', armL: '左手臂', armR: '右手臂', legs: '腿' };
const presetParts = new Set<PoseRegion>(POSE_REGIONS);
/** 手臂套给第几对（0 是第一对）；null 是全部（多出来的手臂照原来的办法跟着第一对，见 pose/fit.ts） */
let presetPair: number | null = null;
/** 套几成，百分数 */
let presetAmount = 100;
/**
 * 上一次点的现成姿势：点之前的样子、点的是哪个、存下来的是哪一份。
 * 接着拖「强度」、改部位时，设定里的姿势还是 result（中间没拖过圆点、没撤销），就从点之前的样子重新套
 */
let lastPreset: { name: string; preset: Posing; base: PoseState; key: string; result: Posing | null } | null = null;
/** 「手臂套给哪一对」照现在的身体排好（手臂有几对就几格） */
let syncPresetPanel = () => {};

if (POSE_LIBRARY.length) {
  $('poseLibraryNote').textContent =
    '点一下就套到现在这个角色身上，并且落到地面；不满意接着拖圆点改。这些姿势取自 Quaternius 的 Universal Animation Library（CC0），' +
    '是给普通人形做的：手指也跟着摆（握着的、张着的、放松的）。套上去时手臂插进身体的（胯宽、胸大时常见），绕肩膀往外让一点。' +
    '肩部聚拢的几条手臂：姿势和垂着差不多时一起摆（还是散开着），差得多时只摆方向最接近的那一条。' +
    '别的多出来的手臂跟着原来的那条做同样的动作（上下排的还是错开着；好几个上半身时，每个上半身各自做一整套），' +
    '碰到身体、别的手臂就让开，让不开的保持自己静止时的样子。尾巴、翅膀保持自己静止时的样子。';
  /**
   * 现成的姿势是给两条腿的人摆的。人马、蛛形的腿和胯不照它摆（马腿照人腿的样子弯会很怪，马身也不该跟着躺下去）：
   * 只套腰以上，下半身保持静止的样子。
   * 腿左右并排、胯部聚拢、横排多胯时，多出来的几对是同样的腿排在旁边、挤在后面：左边的都照左腿摆，右边的都照右腿摆
   * （横排多胯是每副胯自己的左腿、右腿）。
   * 长在中线上的腿（单足、单数条并排的正中那条）不照它摆，保持站着。
   */
  const fittedLegs = (posing: Posing): Posing => {
    if (metrics?.legForm === 'row' || metrics?.legForm === 'gather' || metrics?.legForm === 'abreast') {
      const bones = { ...posing.bones };
      for (const [name, turn] of Object.entries(posing.bones)) {
        if (!/^(UpperLeg|LowerLeg|Foot|Toes)_[LR]$/.test(name)) continue;
        for (let k = 1; k < Math.ceil(spec.counts.legs / 2); k++) bones[nthName(name, k)] = turn;
      }
      return { ...posing, bones };
    }
    if (metrics?.legForm !== 'taur' && metrics?.legForm !== 'spider') return posing;
    const bones = Object.fromEntries(Object.entries(posing.bones).filter(([name]) => !/^(Hips|UpperLeg|LowerLeg|Foot|Toe)/.test(name)));
    return { version: posing.version, bones };
  };
  /** 好几个上半身：每个的脊柱（Spine_L、Chest_R …）都照姿势里那一串摆；外侧的手臂名字和平常一样，本来就套得上 */
  const fittedTorsos = (posing: Posing): Posing => {
    if (spec.counts.torsos < 2) return posing;
    const bones = { ...posing.bones };
    for (const [name, turn] of Object.entries(posing.bones)) {
      const m = /^(Spine|Chest|UpperChest)(\.\d+)?$/.exec(name);
      if (m) for (const side of ['_L', '_R']) bones[`${m[1]}${side}${m[2] ?? ''}`] = turn;
    }
    return { ...posing, bones };
  };
  // 同一个肩膀上挤着几条手臂时，挑最接近的那一条正好摆成这个姿势，别的跟着转或者不动；
  // 别的多出来的手臂跟着原来的那条动（见 pose/fit.ts）。然后手臂让开身体、让开别的手臂（见 pose/clear.ts）
  const fitted = (posing: Posing): Posing => {
    const own = fittedTorsos(fittedLegs(posing));
    if (!kit) return own;
    const { posing: next, followers } = followArms(kit.solver, fitArms(kit.solver, own));
    const body = bodyDist();
    return body && figure ? clearArms(kit.solver, next, body, figure.scale, spec.shape.limbs, followers) : next;
  };

  /* ---- 只套一部分、只套几成（照 Blender 姿态库，见 pose/blend.ts） ---- */

  /** 只把姿势里的手臂套给第 pair 对：姿势里第一对的手臂骨骼换成那一对的名字（别的手臂不动，见 presetPick） */
  const pairPosing = (posing: Posing, pair: number): Posing => {
    const own = fittedTorsos(fittedLegs(posing));
    const bones = { ...own.bones };
    for (const [name, turn] of Object.entries(posing.bones)) if (armPairOf(name) === 0) bones[nthName(name, pair)] = turn;
    return { ...own, bones };
  };
  /** 点的姿势套到这副骨架上的样子；眼睛照原来的留着（和 usePosing 一样） */
  const presetState = (preset: Posing, base: PoseState): PoseState => {
    const posing = presetPair === null ? fitted(preset) : pairPosing(preset, presetPair);
    const target = stateOf(kit!.solver, posing);
    for (const face of allFaces()) {
      const eyes = eyesOf(face);
      if (!eyes || face.eyes!.some((name) => name in posing.bones)) continue;
      for (const eye of eyes) target.local[eye] = base.local[eye];
    }
    return target;
  };
  /** 全选、手臂是全部：整个换成这个姿势（头发、尾巴这些挂着的也照它，和以前点一下一样） */
  const whole = () => presetParts.size === POSE_REGIONS.length && presetPair === null;
  /** 哪些骨骼照姿势摆：全选时是全部骨骼，不然是选中的部位（手臂只是选中的那一对） */
  const presetPick = (rig: PoseRig) => {
    if (whole()) return () => true;
    return (j: number) => {
      const region = regionOf(rig.names[j]);
      const pair = armPairOf(rig.names[j]);
      return region !== null && presetParts.has(region) && (presetPair === null || pair < 0 || pair === presetPair);
    };
  };
  /** 照现在的部位、强度，把上一次点的姿势从点之前的样子重新套一遍 */
  const blendPreset = () => {
    if (!kit || !lastPreset) return;
    const { rig } = kit.solver;
    const target = presetState(lastPreset.preset, lastPreset.base);
    poseState = blendPose(rig, lastPreset.base, target, presetAmount / 100, presetPick(rig), whole() || presetParts.has('torso'));
    showPose();
    dropToGround();
    commitPose(spec.posing, lastPreset.key);
    lastPreset.result = spec.posing;
  };
  let clicks = 0;
  /** 点了一个现成的姿势。返回给状态栏的说明 */
  const applyPreset = (preset: (typeof POSE_LIBRARY)[number]): string => {
    if (!kit || !poseState) return '';
    if (!presetParts.size) return '「套到哪些部位」一个都没勾，先勾上要套的部位。';
    // 每点一次是新的一步撤销；接着拖强度、改部位的几下合在这一步后面
    lastPreset = { name: preset.name, preset: preset.posing, base: cloneState(poseState), key: `preset-${++clicks}`, result: null };
    history.seal();
    blendPreset();
    if (whole() && presetAmount === 100) return `姿势：${preset.name}`;
    const parts = POSE_REGIONS.filter((r) => presetParts.has(r)).map((r) => POSE_REGION_LABEL[r]);
    const where = parts.length === POSE_REGIONS.length ? '整套' : `只套到${parts.join('、')}`;
    return `姿势：${preset.name}，${where}${presetPair === null ? '' : `（手臂是第 ${presetPair + 1} 对）`}，强度 ${presetAmount}%。`;
  };
  /** 拖强度、改部位时：上一次点的姿势之后没拖过圆点、没撤销，就照新的设定重新套 */
  const reblend = () => {
    if (lastPreset && lastPreset.result === spec.posing && mode === 'pose') blendPreset();
  };

  for (const region of POSE_REGIONS) {
    const input = el('input');
    input.type = 'checkbox';
    input.checked = true;
    input.addEventListener('change', () => {
      if (input.checked) presetParts.add(region);
      else presetParts.delete(region);
      if (presetParts.size) reblend();
    });
    const wrap = el('label', 'check');
    wrap.append(input, ` ${POSE_REGION_LABEL[region]}`);
    $('posePartChecks').append(wrap);
  }
  const amountInput = $<HTMLInputElement>('s-poseAmount');
  amountInput.addEventListener('input', () => {
    presetAmount = Number(amountInput.value);
    $('o-poseAmount').textContent = `${presetAmount}%`;
    reblend();
  });
  // 手臂有几对，「手臂套给哪一对」就有几格（一对的时候不显示）。身体变了才重排
  let pairCount = 0;
  let syncPair: ((value: string, enabled: boolean) => void) | null = null;
  syncPresetPanel = () => {
    const count = kit ? Math.max(0, ...kit.solver.rig.names.map(armPairOf)) + 1 : 1;
    if (count !== pairCount) {
      pairCount = count;
      if (presetPair !== null && presetPair >= count) presetPair = null;
      const host = $('segPosePair');
      host.replaceChildren();
      const options = ['all', ...Array.from({ length: count }, (_, k) => String(k))];
      syncPair = buildSeg(host, options, (v) => (v === 'all' ? '全部' : `第 ${Number(v) + 1} 对`), (v) => {
        presetPair = v === 'all' ? null : Number(v);
        syncPresetPanel();
        reblend();
      });
    }
    $('posePairRow').hidden = count < 2;
    syncPair?.(presetPair === null ? 'all' : String(presetPair), true);
  };

  for (const preset of POSE_LIBRARY) {
    const btn = el('button', 'btn', preset.name);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      const note = applyPreset(preset);
      if (note) setStatus(note, !presetParts.size);
    });
    $('poseLibrary').append(btn);
  }
  let last = -1;
  $('btnPoseRandom').addEventListener('click', () => {
    // 不和上一次的重样
    let pick = Math.floor(Math.random() * POSE_LIBRARY.length);
    if (pick === last) pick = (pick + 1) % POSE_LIBRARY.length;
    last = pick;
    const note = applyPreset(POSE_LIBRARY[pick]);
    if (note) setStatus(note, !presetParts.size);
  });
}
$('btnPoseJointDone').addEventListener('click', () => selectJoint(null));
$('btnPoseJointReset').addEventListener('click', () => {
  const handle = pickedHandle();
  if (!handle || !kit) return;
  const { rig } = kit.solver;
  const limb = limbOf(handle);
  // 手、脚上的点：整条手臂、腿放回去；胯：连整个人的位置一起；别的：只放回这一段
  const names = new Set(limb ? [limb.upper, limb.lower, limb.end].map((b) => rig.names[b]) : [rig.names[handle.turn]]);
  const next: Posing = {
    version: spec.posing.version,
    bones: Object.fromEntries(Object.entries(spec.posing.bones).filter(([name]) => !names.has(name))),
  };
  if (handle.kind !== 'body' && spec.posing.root) next.root = spec.posing.root;
  editPosing(next);
});

const posePin = $<HTMLInputElement>('posePin');
posePin.addEventListener('change', () => {
  const handle = pickedHandle();
  const limb = handle && limbOf(handle);
  if (!limb) return;
  if (posePin.checked) pinned.add(limb.name);
  else pinned.delete(limb.name);
  markHandles();
  renderPosePanel();
});
/** 「脚」「手」两个开关：一下子全钉上、全放开 */
function pinAll(kind: 'arm' | 'leg', on: boolean) {
  if (kind === 'leg') pinFeet = on;
  else pinHands = on;
  for (const limb of kit?.solver.limbs ?? []) {
    if (limb.kind !== kind) continue;
    if (on) pinned.add(limb.name);
    else pinned.delete(limb.name);
  }
  markHandles();
  renderPosePanel();
}
const posePinFeet = $<HTMLInputElement>('posePinFeet');
const posePinHands = $<HTMLInputElement>('posePinHands');
posePinFeet.addEventListener('change', () => pinAll('leg', posePinFeet.checked));
posePinHands.addEventListener('change', () => pinAll('arm', posePinHands.checked));

const groupChecks = HANDLE_GROUPS.map((group) => {
  const input = el('input');
  input.type = 'checkbox';
  input.checked = true;
  input.addEventListener('change', () => {
    if (input.checked) shownGroups.add(group);
    else shownGroups.delete(group);
    // 这一组收起来了，里面选中的那个点也放开
    const handle = pickedHandle();
    if (handle && !shownGroups.has(handle.group)) selectJoint(null);
    showPose();
  });
  const wrap = el('label', 'check');
  wrap.append(input, ` ${GROUP_LABEL[group]}`);
  $('poseGroups').append(wrap);
  return { group, input };
});

function renderPosePanel() {
  const handle = pickedHandle();
  const limb = handle && limbOf(handle);
  $('poseJoint').hidden = !handle;
  if (handle) $('poseJointName').textContent = handle.label;
  // 只有手、脚那个点能钉
  $('posePinRow').hidden = !(handle?.kind === 'reach' && limb);
  posePin.checked = Boolean(limb && pinned.has(limb.name));
  posePinFeet.checked = pinFeet;
  posePinHands.checked = pinHands;
  for (const { group, input } of groupChecks) input.checked = shownGroups.has(group);
  syncPresetPanel();
  renderHand();
  renderFace();
  const any = isPosed(spec.posing);
  for (const id of ['btnPoseL2R', 'btnPoseR2L', 'btnPoseFlip', 'btnPoseReset']) $<HTMLButtonElement>(id).disabled = !any;
}

/* ---------------- 导出 ---------------- */

const statusEl = $('status');
function setStatus(message: string, warn = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('warn', warn);
  // 一开始那句提示在手机上是收着的；有了新消息就亮出来
  delete statusEl.dataset.idle;
}

const sizeText = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** 四种模型文件：不带骨骼的 GLB、带骨骼和蒙皮的 GLB、OBJ、STL */
type ExportKind = 'glb' | 'rig' | 'obj' | 'stl';
const EXPORT_FILE: Record<ExportKind, string> = {
  glb: 'oc_basemesh.glb',
  rig: 'oc_basemesh_rigged.glb',
  obj: 'oc_basemesh.obj',
  stl: 'oc_basemesh.stl',
};
/** 成品角色导出的文件另起名字，免得和白模的混在一起 */
const CHARACTER_FILE: Record<ExportKind, string> = {
  glb: 'oc_character.glb',
  rig: 'oc_character_rigged.glb',
  obj: 'oc_character.obj',
  stl: 'oc_character.stl',
};
/** 导出按钮上的字和悬停提示：白模和成品角色导出来的东西不一样 */
const EXPORT_HINT: Record<'base' | 'character', Record<ExportKind, [label: string, title: string]>> = {
  base: {
    glb: ['导出白模（GLB）', '一整块网格，拿去雕刻'],
    rig: ['带骨骼 GLB', '网格 + 骨架 + 权重'],
    obj: ['OBJ', '保留四边面'],
    stl: ['STL', '3D 打印用'],
  },
  character: {
    glb: ['导出角色（GLB）', '带贴图，不带骨骼'],
    rig: ['带骨骼 GLB', '带贴图 + 骨架 + 权重'],
    obj: ['OBJ', '只有形状，没有贴图'],
    stl: ['STL', '只有形状，没有贴图'],
  },
};
const exportButtons: Record<ExportKind, HTMLButtonElement> = {
  glb: $<HTMLButtonElement>('btnGlb'),
  rig: $<HTMLButtonElement>('btnRig'),
  obj: $<HTMLButtonElement>('btnObj'),
  stl: $<HTMLButtonElement>('btnStl'),
};
const glbBlob = (data: ArrayBuffer) => new Blob([data], { type: 'model/gltf-binary' });

/** 要导出的姿势：骨架、摆好以后每根骨骼在哪、蒙皮矩阵（米） */
interface ExportPose {
  rig: PoseRig;
  frame: Frame;
  matrices: Float64Array;
}

/** 现在导出的是不是摆好的样子：在摆姿势那一页里、而且真的摆过，才是 */
function exportPose(): ExportPose | null {
  if (mode !== 'pose' || !kit || !isPosed(spec.posing)) return null;
  const { rig } = kit.solver;
  const frame = forward(rig, stateOf(kit.solver, spec.posing));
  return { rig, frame, matrices: poseMatrices(rig, frame) };
}

/** 摆好以后的骨架：把这个样子当成新的静止姿势写进文件，进了 Blender 还能接着摆 */
const posedSkeleton = (pose: ExportPose, rest: Skeleton): Skeleton => ({
  bones: posedBones(pose.rig, pose.frame).map((b, i) => ({ ...b, part: rest.bones[i].part })),
});

/** 融合模式：一整块网格，在 Worker 里按导出精度重新算一遍 */
async function exportFused(kind: ExportKind, target: Figure, pose: ExportPose | null): Promise<{ blob: Blob; what: string }> {
  setStatus('正在生成精细网格，稍等几秒…');
  // 摆过姿势、不带骨骼的：照摆好的姿势重新融合（各部件的形状照骨骼搬过去再融合），不是把静止的网格扯过去——
  // 和屏幕上松手以后换上的那张一样；不这么办的身体（见 refusable）屏幕上是照权重的那张，导出也是。
  // 带骨骼的要权重：还是静止的那张网格照权重搬过去，这样权重、骨架、网格是配套的
  const posedMatrices = pose && kind !== 'rig' ? poseMatrices(pose.rig, pose.frame, target.scale) : undefined;
  const exact = posedMatrices && refusable(target, posedMatrices) ? posedMatrices : undefined;
  const data = await fused.exportData({ skin: kind === 'rig' || Boolean(pose && !exact), pose: exact });
  if (pose && !exact) {
    if (!data.skin) throw new Error('没有拿到蒙皮数据');
    skinInPlace(WHITE_BLEND, data.positions, data.normals, data.skin.joints, data.skin.weights, pose.matrices);
  }
  const extra = data.tris ? data.tris.length / 3 : 0;
  let what = `一整块网格，${kind === 'obj' ? `${count(data.info.quads)} 四边面${extra ? `、${count(extra)} 三角面` : ''}` : `${count(data.info.triangles)} 三角面`}`;
  if (data.info.components > 1) what += `；注意它分成了 ${data.info.components} 块`;
  const credit = footCredit(target);
  if (credit) what += `；发出去时请署名「${credit}」`;
  if (kind === 'obj') {
    // OBJ 存得下四边面：导进 Blender 布线更干净
    const text = writeObj([{ name: 'OC_BaseMesh', positions: data.positions, normals: data.normals, faces: data.quads, faceSize: 4, triangles: data.tris }]);
    return { blob: new Blob([text], { type: 'text/plain' }), what };
  }
  if (kind === 'stl') {
    return { blob: new Blob([writeStl([{ positions: data.positions, triangles: data.triangles }])], { type: 'model/stl' }), what };
  }
  const mesh: GlbMesh = {
    name: 'OC_BaseMesh',
    positions: data.positions,
    normals: data.normals,
    indices: data.triangles,
    material: MATERIAL_INFO.clay,
  };
  const signed = credit ? { copyright: credit } : {};
  if (kind === 'glb') return { blob: glbBlob(writeGlb([mesh], signed)), what };
  if (!data.skin) throw new Error('没有拿到蒙皮数据');
  const rest = buildSkeleton(target);
  const skeleton = pose ? posedSkeleton(pose, rest) : rest;
  const glb = writeGlb([{ ...mesh, joints: data.skin.joints, weights: data.skin.weights }], { skeleton, rigName: 'OC_Rig', ...signed });
  return { blob: glbBlob(glb), what: `${what}，${skeleton.bones.length} 根骨骼` };
}

/**
 * 用到了要求署名的素材就返回要带的署名：二次元素体接的是 Kotori 的脚（CC BY），躯干的起伏参考了 Fly_jkey 的「Woman」（CC BY，见 tools/build-torso.ts）
 */
const footCredit = (target: Figure) => {
  const list: string[] = [];
  if (target.parts.some((p) => p.grafts?.some((g) => g.mesh === 'foot'))) list.push(FOOT_CREDIT);
  if (target.parts.some((p) => p.prims.some((q) => q.kind === 'grid' && q.grid === animeGrid('torso')))) list.push(TORSO_CREDIT);
  return list.length ? list.join('；') : undefined;
};

/** 分部件模式：每个部件一个物体 */
async function exportParts(kind: ExportKind, target: Figure, pose: ExportPose | null): Promise<{ blob: Blob; what: string }> {
  setStatus('正在导出…');
  const credit = footCredit(target);
  const note = credit ? `；发出去时请署名「${credit}」` : '';
  if (kind === 'glb' && !pose) {
    // 不带骨骼的 GLB 保留父子关系：眼睛、角、耳朵挂在各自的头下面
    const tree = model.baked();
    try {
      return { blob: await exportGlb(tree), what: `每个部件一个物体${note}` };
    } finally {
      disposeTree(tree);
    }
  }
  const meshes = model.bakedMeshes();
  // 带骨骼的、摆过姿势的：所有部件的顶点放在一起算一次权重，再分回各个部件
  const rest = buildSkeleton(target);
  let skinned: GlbMesh[] = [];
  if (kind === 'rig' || pose) {
    const { positions, triangles } = joinMeshes(meshes);
    const skin = bindPartGrafts(skinVertices(target, rest, positions, triangles, meshes), target, rest, meshes);
    let first = 0;
    skinned = meshes.map((m): GlbMesh => {
      const n = m.positions.length / 3;
      const joints = skin.joints.slice(first * 4, (first + n) * 4);
      const weights = skin.weights.slice(first * 4, (first + n) * 4);
      first += n;
      // 摆过姿势的：顶点搬到摆好的位置
      if (pose) skinInPlace(WHITE_BLEND, m.positions, m.normals, joints, weights, pose.matrices);
      return { name: m.name, positions: m.positions, normals: m.normals, indices: m.indices, joints, weights, material: MATERIAL_INFO[m.material] };
    });
  }
  if (kind === 'obj') {
    const text = writeObj(meshes.map((m) => ({ name: m.name, positions: m.positions, normals: m.normals, faces: m.indices, faceSize: 3 })));
    return { blob: new Blob([text], { type: 'text/plain' }), what: `每个部件一个物体${note}` };
  }
  if (kind === 'stl') {
    const stl = writeStl(meshes.map((m) => ({ positions: m.positions, triangles: m.indices })));
    return { blob: new Blob([stl], { type: 'model/stl' }), what: `所有部件的面写在一起；部件之间互相穿插，没有融合${note}` };
  }
  const signed = credit ? { copyright: credit } : {};
  // 摆过姿势、不带骨骼的 GLB：每个部件一个物体，不分父子（一个部件里面弯过了，没法再用父子关系表示）
  if (kind === 'glb') return { blob: glbBlob(writeGlb(skinned, signed)), what: `每个部件一个物体${note}` };
  const skeleton = pose ? posedSkeleton(pose, rest) : rest;
  return {
    blob: glbBlob(writeGlb(skinned, { skeleton, rigName: 'OC_Rig', ...signed })),
    what: `每个部件一个物体，${skeleton.bones.length} 根骨骼${note}`,
  };
}

/** 成品角色摆好姿势以后的样子：顶点搬过去，骨架换成摆好的 */
const posedCharacter = (build: CharacterBuild, pose: ExportPose): CharacterBuild =>
  poseBuild(build, pose.matrices, posedBones(pose.rig, pose.frame), spec.posing.faces);

/** 成品角色：GLB 带贴图（和骨骼）；OBJ、STL 存不了贴图，只有形状 */
function exportCharacter(kind: ExportKind, rest: CharacterBuild, pose: ExportPose | null): { blob: Blob; what: string } {
  const build = pose ? posedCharacter(rest, pose) : rest;
  if (kind === 'glb' || kind === 'rig') {
    // 许可要求署名的角色：署名写进文件里，状态栏上也提一句。自己的 VRM：作者和许可照文件里写的记进去
    const own = spec.character === OWN_CHARACTER ? characterSource(OWN_CHARACTER) : null;
    const credit = own ? undefined : rosterEntry(spec.character as CharacterId).credit;
    const copyright = own ? [own.title, own.author, own.license].filter(Boolean).join(' / ') : credit;
    const glb = characterGlb(build, { rig: kind === 'rig', ...(copyright ? { copyright } : {}) });
    const what = kind === 'rig' ? `带贴图的成品角色，${build.bones.length} 根骨骼` : '带贴图的成品角色';
    return { blob: glbBlob(glb), what: credit ? `${what}；发出去时请署名「${credit}」` : what };
  }
  const shape = characterShape(build);
  const what = '只有形状，没有贴图和骨骼；各块互相穿插，没有融合';
  if (kind === 'obj') {
    const text = writeObj([{ name: 'OC_Character', positions: shape.positions, normals: shape.normals, faces: shape.triangles, faceSize: 3 }]);
    return { blob: new Blob([text], { type: 'text/plain' }), what };
  }
  return { blob: new Blob([writeStl([{ positions: shape.positions, triangles: shape.triangles }])], { type: 'model/stl' }), what };
}

async function exportModel(kind: ExportKind) {
  // 参数刚改、还没来得及重建时，先同步一次，保证导出的是现在看到的设定
  if (pending || (!figure && !character)) rebuild();
  const target = figure;
  const build = character;
  if (!target && !build) return;
  for (const button of Object.values(exportButtons)) button.disabled = true;
  try {
    // 在摆姿势那一页里导出的是摆好的样子，在造型那一页里是静止姿势：看到什么导出什么
    const pose = exportPose();
    const { blob, what } = build
      ? exportCharacter(kind, build, pose)
      : await (spec.meshMode === 'fused' ? exportFused(kind, target!, pose) : exportParts(kind, target!, pose));
    const fileName = (build ? CHARACTER_FILE : EXPORT_FILE)[kind];
    const where = await saveBlob(fileName, blob);
    setStatus(`已导出 ${fileName}（${pose ? '摆好的姿势，' : ''}${what}，${sizeText(blob.size)}），${where}。`);
  } catch (err) {
    setStatus(`导出失败：${err instanceof Error ? err.message : err}`, true);
  } finally {
    for (const button of Object.values(exportButtons)) button.disabled = false;
  }
}

for (const kind of Object.keys(exportButtons) as ExportKind[]) {
  exportButtons[kind].addEventListener('click', () => exportModel(kind));
}

$('btnPng').addEventListener('click', async () => {
  if (!viewport) return;
  try {
    const where = await saveBlob('oc_basemesh.png', await viewport.snapshot());
    setStatus(`已保存截图 oc_basemesh.png（透明背景），${where}。`);
  } catch (err) {
    setStatus(`截图失败：${err instanceof Error ? err.message : err}`, true);
  }
});

/* ---- VRM：给 VTuber 软件、VRoid Hub 用（见 io/vrm.ts）。现在只有融合模式的白模（成品角色见 docs/vrm-plan.md 第 2 期） ---- */

const VRM_KEY = 'oc-basemesh-vrm';
/**
 * VRM 的静止姿势是 T-pose：第一对手臂平举、手心朝下、五指并拢伸直。
 * 姿势数据里上臂、前臂、手、手指本来就是从这个样子算起的（见 pose/posing.ts），这几根不转就是 T-pose。
 * 平举的是进了人形骨骼对照表的那一对（好几个上半身时右手臂是第一个上半身里侧的那条，UpperArm_R.002），
 * 再加上不带序号的那一对（两边对称）；别的骨骼（多出来的手臂、头、腿）保持静止时的样子
 */
function tPosing(humanoid: Map<string, number>, rest: Skeleton): Posing {
  const bones: Record<string, Quat> = {};
  for (const s of ['L', 'R']) {
    for (const name of ['UpperArm', 'LowerArm', 'Hand']) bones[`${name}_${s}`] = Q_ID;
    for (const finger of FINGER_NAMES) for (let k = 1; k <= 3; k++) bones[`${finger}${k}_${s}`] = Q_ID;
  }
  for (const [slot, i] of humanoid) {
    if (/^(left|right)(UpperArm|LowerArm|Hand|Thumb|Index|Middle|Ring|Little)/.test(slot)) bones[rest.bones[i].name] = Q_ID;
  }
  return { version: POSING_VERSION, bones };
}
/** 尾巴是会晃的弹簧骨骼：每条一串，从尾根晃到尾尖 */
function tailSprings(skeleton: Skeleton): VrmSpring[] {
  const roots = skeleton.bones.flatMap((b, i) => (/^Tail_\d+_01$/.test(b.name) ? [i] : []));
  return roots.length ? [{ comment: 'Tail', roots, stiffness: 1, gravity: 0.05, drag: 0.4, hitRadius: 0.03 }] : [];
}

const vrmDialog = $<HTMLDialogElement>('vrmDialog');
const vrmName = $<HTMLInputElement>('vrmName');
const vrmAuthor = $<HTMLInputElement>('vrmAuthor');
const vrmLicense = $<HTMLSelectElement>('vrmLicense');
for (const [key, terms] of Object.entries(VRM_LICENSES)) vrmLicense.append(new Option(terms.label, key));
const isLicense = (v: unknown): v is VrmLicense => typeof v === 'string' && v in VRM_LICENSES;

/** 弹出小框填名字、作者、许可；取消返回 null。上次填的记在这个浏览器里 */
function askVrmMeta(credits?: string, character?: { title: string; terms: string }): Promise<VrmMeta | null> {
  let saved: Record<string, unknown> = {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(VRM_KEY) ?? '{}');
    if (typeof raw === 'object' && raw !== null) saved = raw as Record<string, unknown>;
  } catch {
    // 读不到就空着
  }
  vrmName.value = character ? character.title : typeof saved.title === 'string' ? saved.title : 'OC';
  vrmAuthor.value = typeof saved.author === 'string' ? saved.author : '';
  vrmLicense.value = isLicense(saved.license) ? saved.license : 'private';
  // 成品角色：许可照原角色，不能改；填的名字写成「改」，跟在原作者后面
  $('vrmLicenseRow').hidden = Boolean(character);
  $('vrmTerms').hidden = !character;
  if (character) $('vrmTerms').textContent = `许可照原角色：${character.terms}。不能改，导出的文件里原样写着。`;
  $('vrmAuthorLabel').textContent = character ? '你的名字（写成「改」，跟在原作者后面）' : '作者';
  // 用到了要求署名的素材（二次元素体的脚、躯干）：选什么许可都照样写上署名
  const showCredit = () => {
    const note = $('vrmCredit');
    note.hidden = !credits;
    if (credits) note.textContent = `会自动写上署名：${credits}。${vrmLicense.value === 'cc0' ? '选了 CC0 也一样：这几样素材要求署名。' : ''}`;
  };
  vrmLicense.onchange = showCredit;
  showCredit();
  vrmDialog.returnValue = '';
  vrmDialog.showModal();
  return new Promise((resolve) => {
    vrmDialog.addEventListener(
      'close',
      () => {
        if (vrmDialog.returnValue !== 'ok') {
          resolve(null);
          return;
        }
        const license = isLicense(vrmLicense.value) ? vrmLicense.value : 'private';
        const meta: VrmMeta = { title: vrmName.value.trim() || 'OC', author: vrmAuthor.value.trim(), license, ...(credits ? { credits } : {}) };
        try {
          // 成品角色的名字是原角色的，不记（下次导白模还是白模上次填的）
          localStorage.setItem(VRM_KEY, JSON.stringify({ title: character ? saved.title : meta.title, author: meta.author, license: character ? saved.license : license }));
        } catch {
          // 存不了下次重新填
        }
        resolve(meta);
      },
      { once: true },
    );
  });
}

/** 成品角色：贴图、卡通着色、表情、视线照原角色，许可原样带上（见 character/vrm.ts） */
async function exportCharacterVrm(build: CharacterBuild) {
  const source = characterSource(spec.character);
  if (!source) {
    setStatus('角色的数据还没载入完，等一下再导出。', true);
    return;
  }
  // 许可照原文件：0.x 的原样抄，1.0 的换成 0.x 的写法（见 io/vrm.ts 的 metaFromV1）
  const license = source.vrmMeta ?? source.vrm1Meta ?? {};
  const rest = characterSkeleton(build);
  let humanoid: Map<string, number>;
  try {
    humanoid = humanoidMap(rest);
  } catch (err) {
    setStatus(`这个角色导不了 VRM：${err instanceof Error ? err.message : err}`, true);
    return;
  }
  const own = spec.character === OWN_CHARACTER;
  const credit = own ? undefined : rosterEntry(spec.character as CharacterId).credit;
  const meta = await askVrmMeta(credit, { title: source.title, terms: describeLicense(license) });
  if (!meta) return;
  const buttons = [...Object.values(exportButtons), $<HTMLButtonElement>('btnVrm')];
  for (const button of buttons) button.disabled = true;
  try {
    setStatus('正在写 VRM（表情一个个算成形态键），稍等几秒…');
    // 让上面那行字先显示出来
    await new Promise((resolve) => setTimeout(resolve, 30));
    const solver = makeSolver(rest.bones);
    const frame = forward(solver.rig, stateOf(solver, tPosing(humanoid, rest)));
    const springs = tailSprings(rest);
    const file = characterVrm(build, source, {
      matrices: poseMatrices(solver.rig, frame),
      bones: posedBones(solver.rig, frame),
      title: meta.title,
      editor: meta.author,
      ...(credit ? { credit } : {}),
      springs,
    });
    const where = await saveBlob('oc_character.vrm', new Blob([file], { type: 'model/gltf-binary' }));
    const faces = build.morphs?.expressions.length ?? 0;
    const notes = [
      'T-pose',
      `${build.bones.length} 根骨骼`,
      ...(faces ? [`${faces} 种表情`] : []),
      ...(source.springs?.length || hairDonor(spec.hair.style) ? ['头发、裙摆照原角色会晃'] : []),
      ...(springs.length ? ['尾巴会晃'] : []),
      ...(mode === 'pose' && isPosed(spec.posing) ? ['摆的姿势、表情不进 VRM'] : []),
      `许可照原角色：${describeLicense(license)}`,
      ...(credit ? [`发出去时请署名「${credit}」`] : []),
    ];
    setStatus(`已导出 oc_character.vrm（${notes.join('，')}），${where}。`);
  } catch (err) {
    setStatus(`导出失败：${err instanceof Error ? err.message : err}`, true);
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}

/** 分部件的白模点 VRM 时说的话（按钮的悬停提示也是它） */
const VRM_PARTS = 'VRM 要一整块网格：先在「网格」一栏换成「融合成一整块」';

async function exportVrm() {
  if (pending || (!figure && !character)) rebuild();
  if (character) {
    await exportCharacterVrm(character);
    return;
  }
  const target = figure;
  if (!target) return;
  if (spec.meshMode !== 'fused') {
    setStatus(`${VRM_PARTS}。`, true);
    return;
  }
  // 先看人形骨骼对不对得上：对不上就不用问名字了
  const rest = buildSkeleton(target);
  let humanoid: Map<string, number>;
  try {
    humanoid = humanoidMap(rest);
  } catch (err) {
    setStatus(`这个身体导不了 VRM：${err instanceof Error ? err.message : err}`, true);
    return;
  }
  const credit = footCredit(target);
  const meta = await askVrmMeta(credit);
  if (!meta) return;
  const buttons = [...Object.values(exportButtons), $<HTMLButtonElement>('btnVrm')];
  for (const button of buttons) button.disabled = true;
  try {
    setStatus('正在生成精细网格，稍等几秒…');
    const data = await fused.exportData({ skin: true });
    if (!data.skin) throw new Error('没有拿到蒙皮数据');
    // 静止的网格照权重搬成 T-pose（权重本来就是手臂平举着算的，搬过去几乎就是算权重时的那张），骨架也换成 T-pose 的
    const solver = makeSolver(rest.bones);
    const frame = forward(solver.rig, stateOf(solver, tPosing(humanoid, rest)));
    const matrices = poseMatrices(solver.rig, frame);
    skinInPlace(WHITE_BLEND, data.positions, data.normals, data.skin.joints, data.skin.weights, matrices);
    const skeleton = posedSkeleton({ rig: solver.rig, frame, matrices }, rest);
    const springs = tailSprings(skeleton);
    const file = writeVrm(
      { positions: data.positions, normals: data.normals, indices: data.triangles, joints: data.skin.joints, weights: data.skin.weights, color: MATERIAL_INFO.clay.color },
      skeleton,
      meta,
      springs,
    );
    const where = await saveBlob('oc_basemesh.vrm', new Blob([file], { type: 'model/gltf-binary' }));
    const notes = [
      'T-pose',
      `${count(data.info.triangles)} 三角面`,
      `${skeleton.bones.length} 根骨骼`,
      ...(springs.length ? ['尾巴会晃'] : []),
      ...(mode === 'pose' && isPosed(spec.posing) ? ['摆的姿势不进 VRM'] : []),
      ...(data.info.components > 1 ? [`注意它分成了 ${data.info.components} 块`] : []),
      ...(credit ? [`发出去时请署名「${credit}」`] : []),
    ];
    setStatus(`已导出 oc_basemesh.vrm（${notes.join('，')}），${where}。`);
  } catch (err) {
    setStatus(`导出失败：${err instanceof Error ? err.message : err}`, true);
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}
$('btnVrm').addEventListener('click', () => void exportVrm());

$('btnJson').addEventListener('click', async () => {
  try {
    const where = await saveText('oc_config.json', serializeSpec(spec, text));
    setStatus(`已保存配置 oc_config.json，${where}。`);
  } catch (err) {
    setStatus(`配置没存成：${err instanceof Error ? err.message : err}`, true);
  }
});

const fileJson = $<HTMLInputElement>('fileJson');
fileJson.addEventListener('change', async () => {
  const file = fileJson.files?.[0];
  fileJson.value = '';
  if (!file) return;
  try {
    const data: unknown = JSON.parse(await file.text());
    if (typeof data !== 'object' || data === null || !('counts' in data)) throw new Error('not a config');
    spec = normalizeSpec(data);
    const saved = (data as { text?: unknown }).text;
    readText(typeof saved === 'string' ? saved : describeSpec(spec));
    desc.value = text;
    refitNext = true;
    commit();
    setStatus(`已载入 ${file.name}。`);
  } catch {
    setStatus('这个文件不是有效的配置文件。', true);
  }
});

/* ---------------- 渲染 ---------------- */

const TIER_RANK: Record<MatchTier, number> = { measure: 1, keyword: 2, tag: 3, number: 4 };

/** 把原文按识别到的片段上色；片段互相重叠时取优先级高的那一层 */
function renderEcho() {
  const host = $('echo');
  host.replaceChildren();
  if (!text.trim()) {
    host.append(el('span', 'empty', '（还没有写描述）'));
    return;
  }
  const tier = new Array<MatchTier | null>(text.length).fill(null);
  for (const m of matches) {
    for (let i = m.start; i < m.end; i++) {
      const cur = tier[i];
      if (!cur || TIER_RANK[m.tier] > TIER_RANK[cur]) tier[i] = m.tier;
    }
  }
  for (let i = 0; i < text.length; ) {
    let j = i + 1;
    while (j < text.length && tier[j] === tier[i]) j++;
    const piece = text.slice(i, j);
    const t = tier[i];
    if (t) {
      const mark = el('mark', '', piece);
      mark.dataset.tier = t;
      host.append(mark);
    } else {
      host.append(piece);
    }
    i = j;
  }
}

function render() {
  const chips = summarize(spec).map((c) => el('span', hits.has(c.key) ? 'chip hit' : 'chip', c.label));
  if (text.trim() && matches.length === 0) chips.unshift(el('span', 'chip', '没认出部件，试试「三对手」「九条尾巴」'));
  $('chips').replaceChildren(...chips);
  for (const sync of steppers) sync();
  for (const sync of sliders) sync();
  syncHead(spec.headLayout, spec.counts.heads > 1);
  syncArm(spec.armLayout, spec.counts.armPairs > 1);
  syncLeg(spec.legLayout, spec.counts.legs > 1);
  syncHipLegs();
  syncEar(spec.earShape, spec.counts.earPairsPerHead > 0);
  const ready = spec.bodyStyle !== 'mannequin';
  const finished = spec.bodyStyle === 'character';
  syncHand(spec.hands, spec.counts.armPairs > 0 && !ready);
  syncHair();
  syncBody(spec.bodyStyle, true);
  syncCharacter();
  $('bodyNote').hidden = !ready;
  $('bodyNote').textContent = BODY_NOTE[spec.bodyStyle];
  syncGender(spec.gender, !ready);
  syncPose(spec.pose, spec.counts.armPairs > 0);
  syncMesh(spec.meshMode, !finished);
  syncBlend();
  if (finished) blendInput.disabled = true;
  for (const kind of Object.keys(exportButtons) as ExportKind[]) {
    const [label, title] = EXPORT_HINT[finished ? 'character' : 'base'][kind];
    exportButtons[kind].textContent = label;
    exportButtons[kind].title = title;
  }
  // VRM 要一整块网格：分部件的白模把按钮淡下去。不真的禁用——手机上没有悬停提示，点了要能说为什么（见 exportVrm）
  const vrmBlocked = !finished && spec.meshMode !== 'fused';
  const btnVrm = $<HTMLButtonElement>('btnVrm');
  btnVrm.classList.toggle('unavailable', vrmBlocked);
  btnVrm.setAttribute('aria-disabled', String(vrmBlocked));
  btnVrm.title = vrmBlocked ? VRM_PARTS : finished ? '给 VTuber 软件、VRoid Hub 用的 VRM：T-pose、人形骨骼、表情，头发、裙摆会晃' : '给 VTuber 软件、VRoid Hub 用的 VRM：T-pose、人形骨骼，尾巴会晃';
  btnUndo.disabled = !history.canUndo;
  btnRedo.disabled = !history.canRedo;
  renderPosePanel();
  $('meshNote').textContent = finished
    ? '成品角色用的是她自带的网格和贴图：各块互相插在一起，不融合，这一栏对它不起作用。'
    : spec.meshMode === 'fused'
      ? '一整块封闭的网格，导进 Blender 可以直接雕刻。拖动时屏幕上是较粗的预览，停下来会换成细的，导出时另算精细的；眼睛只是位置标记，不导出。'
      : 'v1 的做法：每个部件是一个独立的物体，互相穿插，没有融合。';
  renderEcho();
  scheduleRebuild();

  if (import.meta.env.DEV) {
    const canon = describeSpec(spec);
    if (describeSpec(applyParse(spec, parseDescription(canon))) !== canon) {
      console.warn('[parser] 规范描述再解析一遍，结果变了', canon, spec);
    }
  }
}

/* ---------------- 新手引导 ---------------- */

/** 看完或跳过新手引导就记一笔，以后不再自动弹出（标题旁的「新手引导」可以再看） */
const TOUR_KEY = 'oc-basemesh-tour';
/** 指着面板里的某一栏之前：回到造型，把那一栏展开、滚到看得见（手机上让开钉着的 3D 视图，见样式里的 scroll-margin） */
const tourShape = (key?: string) => () => {
  setMode('shape');
  if (!key) return;
  if (folded.has(key)) setFolded(key, false);
  sections.get(key)?.scrollIntoView({ block: 'start' });
};
const tour = new Tour([
  {
    title: '欢迎来到 OC 白模工坊',
    text: '写一句身体设定，就能生成能导进 Blender 的多肢体角色模型。下面花半分钟认一认几个地方；不想看就点「跳过」，以后点标题旁边的「新手引导」可以再看。',
    before: () => {
      if (btnZoom.getAttribute('aria-pressed') === 'true') btnZoom.click();
    },
  },
  {
    title: '身体描述',
    text: '用中文写想要的身体，比如「三个头，两对手臂，九条尾巴」，写完模型马上跟着变。下面亮起来的小标签是认出来的部件；展开「能认哪些写法」能看到全部说法。',
    target: () => $('desc'),
    before: tourShape('desc'),
  },
  {
    title: '预设',
    text: '不想写字就点一个现成的：双头、阿修罗、半人马、蜘蛛女……点完还能接着改。',
    target: () => sections.get('presets') ?? null,
    before: tourShape('presets'),
  },
  {
    title: '部件数量',
    text: '用 − 和 + 一样一样地调：头、手臂、胸、腿、尾巴、翅膀、角、眼睛、兽耳。下面的「排布」管多出来的怎么长（比如腿是人马还是蛛形）。',
    target: () => sections.get('counts') ?? null,
    before: tourShape('counts'),
  },
  {
    title: '身体样式',
    text: '三种：白模人台是素白的人台；二次元素体是现成的二次元裸素体；成品角色带头发、衣服和贴图，能换角色、换发型、染发。',
    target: () => $('segBody').closest('.field'),
    before: tourShape('shape'),
  },
  {
    title: '3D 视图',
    text: byFinger
      ? '单指拖动旋转，双指缩放、平移。点一下某个部件（一条手臂、一个头），可以单独挪动、旋转、缩放它。'
      : '拖动旋转，滚轮缩放，右键平移。点一下某个部件（一条手臂、一个头），可以单独挪动、旋转、缩放它。',
    target: () => $('stage'),
    before: tourShape(),
  },
  {
    title: '造型和摆姿势',
    text: '身体定好了切到「摆姿势」：拖关节上的圆点摆动作，还有现成的姿势、手势和表情。',
    target: () => document.querySelector('.mode'),
  },
  {
    title: '视角和撤销',
    text: '一下切到正面、侧面、背面看；改错了点「撤销」（Ctrl+Z）。「骨骼」把骨架显示出来。',
    target: () => document.querySelector('.dock'),
  },
  {
    title: '导出',
    text: '「导出白模」是一整块网格，拿去雕刻；「带骨骼 GLB」进了 Blender 能直接摆姿势；还有 OBJ、3D 打印用的 STL 和截图。Blender 里用「文件 → 导入 → glTF 2.0」。',
    target: () => document.querySelector('.export'),
  },
  {
    title: '就这些',
    text: '设定会自动存在这个浏览器里，下次打开还在。想再看一遍引导，点这里。',
    target: () => $('btnTour'),
    before: () => $('btnTour').closest('header')?.scrollIntoView({ block: 'center' }),
  },
]);
tour.onClose = () => {
  try {
    localStorage.setItem(TOUR_KEY, 'done');
  } catch {
    // 存不了就下次再弹一遍
  }
};
$('btnTour').addEventListener('click', () => tour.start());

desc.value = text;
applyTheme();
render();
rebuild();
viewport?.frame('three');

// 第一次打开：等模型出来再开始引导
let tourSeen = true;
try {
  tourSeen = localStorage.getItem(TOUR_KEY) === 'done';
} catch {
  // 读不到就不弹，免得每次都弹
}
if (!tourSeen) window.setTimeout(() => tour.start(), 600);

if (import.meta.env.DEV) {
  // 开发时在控制台里看状态用：__oc.spec()、__oc.buildMs()
  Object.assign(window, {
    __oc: {
      spec: () => spec,
      // __oc.set({ bodyStyle: 'anime' })：直接改几项设定
      set: (patch: Partial<BodySpec>) => fromParams(normalizeSpec({ ...spec, ...patch })),
      figure: () => figure,
      // 现在显示的成品角色（没显示成品角色就是 null）
      character: () => character,
      selected: () => selected,
      select,
      buildMs: () => lastBuildMs,
      fusedStats: () => fusedStats,
      rebuild,
      undo,
      redo,
      mode: () => mode,
      setMode,
      // 摆姿势：__oc.pose.drag('Hand_L', [x, y, z]) 相当于把那个圆点拖到那里再松手
      pose: {
        handles: poseHandles,
        kit: () => kit,
        state: () => poseState,
        frame: () => poseFrame,
        posed: () => posed,
        pinned,
        pick: selectJoint,
        show: showPose,
        use: usePosing,
        view,
        applyView,
        // 手势：__oc.pose.gesture('握拳') 把手势栏里选中的手摆成那样；__oc.pose.hand(0) 量第几只手现在的手势
        gesture: (name: string | HandShape) =>
          reshapeHands(() => (typeof name === 'string' ? GESTURES.find((g) => g.name === name)!.shape : name)),
        hand: (i = 0) => (kit && poseState ? readHand(kit.solver, poseState, kit.solver.hands[i]) : null),
        // 第 i 只手要是摆成这个手势，五个指尖各在哪（相对手腕，米）：调手势的数字用，不改屏幕上的姿势
        tips(shape: HandShape, i = 0) {
          if (!kit || !poseState) return null;
          const { rig } = kit.solver;
          const one = kit.solver.hands[i];
          const frame = forward(rig, shapeHand(kit.solver, poseState, one, shape));
          return one.fingers.map((chain) => (chain.length ? sub(tailOf(rig, frame, chain[chain.length - 1]), frame.pos[one.bone]) : null));
        },
        drag(id: string, target: V3, keep = true) {
          const handle = kit?.handles.find((h) => h.id === id);
          if (!handle || !poseHandles) return false;
          poseHandles.onGrab(handle);
          poseHandles.onDrag(handle, target);
          if (keep) poseHandles.onRelease(handle, true);
          return true;
        },
      },
      model,
      fused,
      tour,
      // __oc.spread(false)：融合不分给帮手线程（对比结果、量时间用）
      spread: spreadWork,
      viewport,
      gizmo,
    },
  });
}
