// 旧内核（安卓 WebView 83 之类）缺的函数先补上，必须在最前面
import './polyfill';
import './style.css';
import { type Lang, LANG, LANGS, setLang, t, tk, translatePage, variants } from './i18n';
import { type Box3, type Raycaster, Matrix4 } from 'three';
import { TORSO_CREDIT, animeGrid, animeReady, loadAnimeBody } from './anime/body';
import { FOOT_CREDIT } from './anime/foot';
import { GENITAL_CREDIT, genitalReady, loadGenital } from './anime/genital';
import { adultOn, keepAdult, restoreAdult, setAdult, withoutAdult } from './model/adult';
import { type CharacterBuild, assembleCharacter } from './character/assemble';
import { characterGlb, characterShape, characterSkeleton, poseBuild } from './character/export';
import { characterVrm } from './character/vrm';
import { type FaceInstance, type FaceWeights, type Gaze, applyFaces, faceLabel, gazeAt, gazeOf, gazeTurns, hasExpression } from './character/face';
import { characterSource, hairDonor, hairLit, lightenHair, loadCharacter, loadHair, loadOwnCharacter, ownFileName, restoreOwnCharacter } from './character/load';
import type { CharacterSource } from './character/source';
import { ROSTER, rosterEntry } from './character/roster';
import { skinInPlace } from './character/pose';
import { type TweakedCharacter, characterPartAt, characterPartGlow, characterParts, tweakCharacter } from './character/tweak';
import { describeClashes, findClashes } from './geometry/clash';
import { type Figure, type FigureMetrics, type PartType, nthName } from './geometry/figure';
import { buildFigure } from './geometry/layout';
import { partFrame } from './geometry/tweak';
import { type V3, Q_ID, UP, len, norm, quatBetween, quatMul, sub } from './geometry/vec';
import { cleanFileName, inAndroidShell, saveBlob, saveText } from './io/download';
import { exportGlb } from './io/exportGlb';
import { OfflineError } from './io/fetchFile';
import { type GlbMesh, writeGlb } from './io/glb';
import { forgetFile, keepFile, keptFile } from './io/keepFile';
import { type VrmLicense, type VrmMeta, VRM_LICENSES, describeLicense, humanoidMap, writeVrm } from './io/vrm';
import { tPosing, tailSprings } from './io/vrmRig';
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
  type PenisLayout,
  type ScrotumMode,
  type PartOverride,
  type Pose,
  type ShapeDef,
  type ShapeKey,
  type Vec3,
  ARM_LAYOUTS,
  BLEND,
  BODY_STYLES,
  BUST_MAX_OTHER,
  COUNT_DEFS,
  COUNT_HINTS,
  HIP_LEGS,
  PENIS_ROW,
  EAR_SHAPES,
  GENDERS,
  HAIR_LENGTH,
  HAIR_STYLES,
  HAIR_VOLUME,
  HAND_STYLES,
  HEAD_LAYOUTS,
  LEG_LAYOUTS,
  PENIS_LAYOUTS,
  SCROTUM_MODES,
  clampHipLegs,
  clampPenisRow,
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
  type PerTorsoKey,
  type TorsoCounts,
  type TorsoSide,
  PER_TORSO_KEYS,
  countsOf,
  torsoSides,
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
import { rootReach, settleCollars } from './pose/collar';
import { type PoseRegion, POSE_REGIONS, armPairOf, blendPose, regionOf } from './pose/blend';
import { type DrapeKind, BodySurface, boneRadius, drape, drapeBones } from './pose/drape';
import { fitArms, followArms } from './pose/fit';
import { fitLegs } from './pose/fitLegs';
import { armOfBone, armPairCount, followPair } from './pose/follow';
import { POSE_LIBRARY } from './pose/library';
import { type Posing, POSING_VERSION, cleanPosing, emptyPosing, flipPosing, isPosed, placedTwins } from './pose/posing';
import { type Frame, type PoseRig, type PoseState, cloneState, forward, pointOn, poseMatrices, posedBones, shiftRoot, tailOf } from './pose/rig';
import { type Pin, capturePins, dragAim, dragBend, dragBody, dragReach, plantFeet, turnBone } from './pose/solve';
import { type Solver, makeSolver, mirrorState, posingOf, stateOf } from './pose/solver';
import { type Skeleton, buildSkeleton } from './rig/skeleton';
import { bindPartGrafts, skinVertices } from './rig/skin';
import { type HairShape, hairReady, loadHairShape } from './hair/shapes';
import { compileField, fieldAt } from './sdf/field';
import { provideGenital, provideHair, provideShapes, spreadWork } from './sdf/meshClient';
import { type Picker, makePicker } from './sdf/pick';
import { posedBodyDist } from './sdf/posedBody';
import { refusable } from './sdf/posedField';
import { BoneOverlay } from './view/boneOverlay';
import { CharacterModel } from './view/characterModel';
import { type FusedStats, FusedModel } from './view/fusedModel';
import { type GizmoMode, GIZMO_MODES, Gizmo } from './view/gizmo';
import { MATERIAL_INFO } from './view/materials';
import { type BakedMesh, PartsModel, disposeTree } from './view/partsModel';
import { Phone, jumpLabel } from './view/phone';
import { PoseHandles } from './view/poseHandles';
import { type RefSlot, REF_SLOTS, ReferenceImages, loadPicture } from './view/references';
import { Tour } from './view/tour';
import { type SkinSource, FlatParts, PosedMeshes, WHITE_BLEND } from './view/posedMeshes';
import { type CameraState, type ViewName, VIEW_DEFAULTS, VIEW_LIMITS, Viewport } from './view/viewport';
import { installUpdateUi } from './update/ui';
import { installDiag, installDiagRow, noteProblem, watchViewport } from './view/diag';

// 写死在 index.html 里的文字先换成当前语言，后面的代码再往页面上加东西
translatePage();
// 在 exe 里打开时：有新版的提示卡片、面板顶上的版本号和「检查更新」（开发服务器上什么都不加）
installUpdateUi();
// 3D 视图空白时的诊断卡片和兼容模式（见 view/diag.ts）：先装上，后面出的错都记得到
installDiag();
installDiagRow();

const STORE_KEY = 'oc-basemesh-v2';
const THEME_KEY = 'oc-basemesh-theme';
const START_TEXT = t('两个头，两对手，两对胸');

const HEAD_LABEL: Record<HeadLayout, string> = { cluster: t('凑成一簇'), faces: t('一个头几张脸'), wide: t('宽躯干') };
const ARM_LABEL: Record<ArmLayout, string> = { stack: t('沿躯干上下排'), fan: t('肩部扇形聚拢') };
const MESH_LABEL: Record<MeshMode, string> = { fused: t('融合成一整块'), parts: t('分部件（v1）') };
const HAND_LABEL: Record<HandStyle, string> = { fingers: t('分指'), mitten: t('并指（手套形）') };
const PENIS_LABEL: Record<PenisLayout, string> = { row: t('左右并排'), stack: t('上下叠'), fan: t('扇形散开'), grid: t('几乘几') };
const SCROTUM_LABEL: Record<ScrotumMode, string> = { shared: t('几根共用一个'), each: t('每根各带一个') };
const PENIS_STATES = ['hard', 'soft'] as const;
const PENIS_STATE_LABEL: Record<(typeof PENIS_STATES)[number], string> = { hard: t('硬'), soft: t('软') };
const GENDER_LABEL: Record<Gender, string> = { female: t('女性'), male: t('男性') };
const BODY_LABEL: Record<BodyStyle, string> = { mannequin: t('白模人台'), anime: t('二次元素体'), character: t('成品角色') };
/** 这几个滑块对这种身体不起作用 */
const FIXED_SHAPES: Record<BodyStyle, ReadonlySet<ShapeDef['key']>> = {
  mannequin: new Set(),
  anime: new Set(),
  character: new Set(['build']),
};
const BODY_NOTE: Record<BodyStyle, string> = {
  mannequin: '',
  anime: t('头、躯干、手臂、腿的形状来自 VRoid Studio 旧版的女性素体（CC0）。体型是在她原来的样子上拉宽、压窄、变粗变细：肩宽、腰宽、胯宽、四肢粗细都能调，体格是这几样一起变；胯宽只对站着的那一对人腿起作用（人马、蛛形、单足、一副胯上三条以上腿时不变）。性别、手的样式对她不起作用。'),
  character:
    t('带头发、衣服和贴图的现成角色，上面「角色」里选是哪一个。多出来的头、手臂、胸是把她自己的复制一份接上去，各块互相插在一起，不融合；尾巴、翅膀、角、兽耳，还有人马的马身、蛛形的蜘蛛身，是另外捏的单色部件。腿选「人腿人马」「前后串联」「胯部聚拢」时，多出来的腿是把她自己的胯和腿（连裙子、鞋）复制一份接上去（胯部聚拢时一副紧贴一副，腿往外散开）；「左右并排」、一副胯上三条以上腿时，是把她的胯中间那一段（两条大腿的里侧加上裆部）照原样复制几份排开。好几个上半身时，是把她腰以上（连头发、衣服、手臂）整个复制一份，从腰那里往两边弯开，两份在腰上互相插着。体型除了「体格」都能调：肩宽、腰宽、胯宽、四肢粗细、手臂长短是直接把她的身体和衣服拉宽、拉长，调得多了贴图上的花纹会跟着变形。'),
};
const HAIR_LABEL: Record<HairStyle, string> = { own: t('原装'), long: t('长直发'), sidetail: t('侧马尾'), bob: t('波波头'), twintails: t('双马尾') };
/** 常用的发色，点一下就染过去 */
const HAIR_SWATCHES: readonly [name: string, color: string][] = [
  [t('黑'), '#23222a'],
  [t('棕'), '#6b4a32'],
  [t('金'), '#e8cf7a'],
  [t('银'), '#d5dbe6'],
  [t('粉'), '#f0a3bd'],
  [t('红'), '#c2413b'],
  [t('蓝'), '#4f7fd1'],
  [t('绿'), '#5fae86'],
  [t('紫'), '#8e6ccf'],
];
/** 「原装」那一格在白模上叫什么：白模没有自己的头发，不戴就是光头 */
const HAIR_OWN_LABEL: Record<BodyStyle, string> = { mannequin: t('光头'), anime: t('光头'), character: t('原装') };
const HAIR_NOTE: Record<'character' | 'clay', string> = {
  character:
    t('几种发型是从别的现成模型上取下来的头发（pixiv 以 CC0 发布的 VRoid 样例），整个换到她头上；多出来的头跟着换。发色是染上去的，发夹、丝带、挑染保持原样；几个头的时候先在「染哪个头」里点一个头，就只染它（兽耳跟着它），点「全部」就几个头一起染。长度只管垂在鼻尖以下的那一段。'),
  clay: t('戴的是和成品角色同一批现成的头发，转成了没有颜色的白模，和头融合成一整块；多出来的头各戴一副，角和兽耳长在头发外面。白模没有颜色，发色只有成品角色用得上。长度只管垂在鼻尖以下的那一段。'),
};
const POSE_LABEL: Record<Pose, string> = { A: t('A-pose（手臂下垂）'), T: t('T-pose（手臂平举）') };
const GIZMO_LABEL: Record<GizmoMode, string> = { translate: t('移动'), rotate: t('旋转'), scale: t('缩放') };
const LEG_LABEL: Record<LegLayout, string> = {
  auto: t('自动'),
  taur: t('人马式'),
  spider: t('蛛形'),
  humantaur: t('人腿人马'),
  tandem: t('前后串联'),
  row: t('左右并排'),
  gather: t('胯部聚拢'),
  abreast: t('横排多胯'),
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** 几句话接成一段：中文、日文的句子之间不留空，英文要空一格 */
const joinSentences = (parts: readonly string[]) => parts.filter(Boolean).join(LANG === 'en' ? ' ' : '');
/** 错误对象里给人看的那句话 */
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

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

/**
 * 成人部件只在开关打开时有：关着时设定里一律去掉（文字里写了、载入的配置里有也一样），
 * 免得开关关着时看不见的设定还留在存档、撤销历史里（见 model/adult.ts）。
 * 成品角色时设定照留（切回白模还在），只是不长、几项也不显示（见 adultShown）
 */
const gate = (next: BodySpec): BodySpec => (adultOn() ? next : withoutAdult(next));
/** 成人部件的几项要不要显示 */
const adultShown = () => adultOn() && spec.bodyStyle !== 'character';

/**
 * 存档、配置文件里的描述：没手改过的规范描述换成现在界面语言的写法（换了语言描述框跟着换），
 * 手写的原样留着（三种语言解析器都认）
 */
function restoredText(saved: unknown): string {
  if (typeof saved !== 'string') return describeSpec(spec);
  if (variants('两个头，两对手，两对胸').includes(saved)) return START_TEXT;
  return LANGS.some((l) => describeSpec(spec, l.key) === saved) ? describeSpec(spec) : saved;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      spec = gate(normalizeSpec(data));
      readText(restoredText(data.text));
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
 * 正按着拖的体型滑块（见 sliders）：和拖操纵杆一样，每动一下只记撤销、更新滑块旁的数、重建模型，存档和刷新面板等松手再做。
 * 拖着胸部大小时成品角色也不每次重拼（见 showCharacter）
 */
let sliding: ShapeKey | null = null;
/** 拖滑块时攒下了没存档、没刷新面板的改动 */
let slid = false;

/**
 * 设定改完了：记进撤销历史、存档、刷新界面。
 * key 相同的连续修改（拖同一个滑块、连着打字）合并成一步。
 */
function commit(key?: string) {
  spec = gate(spec);
  history.push({ spec, text }, key);
  // 只认操纵杆自己的改动：万一没收到松手，别的改动（滑块、撤销）照常存档、刷新
  if (tweaking && key?.startsWith('gizmo:')) {
    // 拖操纵杆只改了微调：面板上别的都没变，微调那几格数字在重建以后跟着同步（见 syncTweak）
    btnUndo.disabled = !history.canUndo;
    btnRedo.disabled = !history.canRedo;
    scheduleRebuild();
    return;
  }
  if (sliding && key === `shape:${sliding}`) {
    btnUndo.disabled = !history.canUndo;
    btnRedo.disabled = !history.canRedo;
    for (const sync of sliders) sync();
    slid = true;
    scheduleRebuild();
    return;
  }
  save();
  render();
}

/** 松开体型滑块：攒下的改动存档、刷新面板（拖着胸部大小时成品角色只是照比例放大的，这时重拼一次） */
function endSlide() {
  if (!sliding) return;
  const was = sliding;
  sliding = null;
  if (!slid) return;
  slid = false;
  save();
  render();
  if (was === 'bust') scheduleRebuild();
}

function restore(snapshot: Snapshot | null) {
  if (!snapshot) return;
  spec = gate(snapshot.spec);
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

/**
 * 部件数量里头、手臂、胸、角、眼睛、兽耳改的是哪个上半身：'all' 是全部一样（改 counts，并把各个上半身单独设的这一样清掉），
 * 别的是那一个上半身（改 torsoCounts，见 docs/per-torso-plan.md）。只是界面上的状态，不进配置
 */
let torsoEdit: 'all' | TorsoSide = 'all';
const TORSO_EDIT_LABEL: Record<'all' | TorsoSide, string> = { all: tk('全部一样'), L: tk('左@@上半身'), M: tk('中@@上半身'), R: tk('右@@上半身') };
const syncTorsoEdit = buildSeg($('segTorso'), ['all', 'L', 'M', 'R'] as const, (v) => t(TORSO_EDIT_LABEL[v]), (side) => {
  torsoEdit = side;
  render();
});
/** 正在单独改的那个上半身（全部一样、上半身不够那么多时是 null） */
const editingSide = (): TorsoSide | null => (torsoEdit !== 'all' && torsoSides(spec.counts.torsos).includes(torsoEdit) ? torsoEdit : null);

const steppers = COUNT_DEFS.map((d) => {
  const row = el('div', 'row');
  const label = el('label');
  label.append(d.label, el('small', '', d.unit));
  const hint = COUNT_HINTS[d.key];
  if (hint) label.title = hint;
  const minus = el('button', '', '−');
  const plus = el('button', '', '+');
  const out = el('output');
  const perTorso = (PER_TORSO_KEYS as readonly CountKey[]).includes(d.key);
  const key = d.key as PerTorsoKey;
  /** 这一行现在改的是哪个上半身（不是每个上半身单独设的那几样、或者全部一样时是 null） */
  const side = () => (perTorso ? editingSide() : null);
  const value = () => {
    const own = side();
    return own ? countsOf(spec, own)[d.key] : spec.counts[d.key];
  };
  const step = (delta: number) => () => {
    const own = side();
    if (own) {
      // 单独改一个上半身：和全部一样的数一样了就不记
      const v = Math.max(d.min, Math.min(d.max, value() + delta));
      const mine: Partial<Record<PerTorsoKey, number>> = { ...spec.torsoCounts?.[own], [key]: v };
      if (v === spec.counts[d.key]) delete mine[key];
      const torsoCounts: TorsoCounts = { ...spec.torsoCounts, [own]: mine };
      if (!Object.keys(mine).length) delete torsoCounts[own];
      fromParams({ ...spec, torsoCounts });
      return;
    }
    // 全部一样：各个上半身单独设的这一样清掉
    const torsoCounts: TorsoCounts = {};
    for (const [s, mine] of Object.entries(spec.torsoCounts ?? {}) as [TorsoSide, Partial<Record<PerTorsoKey, number>>][]) {
      const rest = { ...mine };
      if (perTorso) delete rest[key];
      if (Object.keys(rest).length) torsoCounts[s] = rest;
    }
    fromParams({ ...spec, counts: { ...spec.counts, [d.key]: spec.counts[d.key] + delta }, torsoCounts });
  };
  minus.type = plus.type = 'button';
  minus.setAttribute('aria-label', t('{label}减一', { label: d.label }));
  plus.setAttribute('aria-label', t('{label}加一', { label: d.label }));
  minus.addEventListener('click', step(-1));
  plus.addEventListener('click', step(1));
  const stepper = el('div', 'stepper');
  stepper.append(minus, out, plus);
  row.append(label, stepper);
  $('counts').append(row);
  return () => {
    const v = value();
    if (d.key === 'penises') row.hidden = !adultShown();
    out.textContent = String(v);
    // 全部一样时有上半身单独设过这一样：数后面加个星号
    const mixed = perTorso && !side() && torsoSides(spec.counts.torsos).some((s) => countsOf(spec, s)[d.key] !== spec.counts[d.key]);
    out.classList.toggle('mixed', mixed);
    out.title = mixed ? t('有的上半身单独设过；在「全部一样」下加减会把它们都改成一样') : '';
    row.classList.toggle('per-torso', !!side());
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
const syncPenis = buildSeg($('segPenis'), PENIS_LAYOUTS, (v) => PENIS_LABEL[v], (penisLayout) =>
  fromParams({ ...spec, penisLayout }),
);
const syncScrotum = buildSeg($('segScrotum'), SCROTUM_MODES, (v) => SCROTUM_LABEL[v], (scrotum) =>
  fromParams({ ...spec, scrotum }),
);
// 软硬一键换：只换这一项，几根、排法、大小、姿势、微调照旧（描述里不写）
const syncPenisState = buildSeg($('segPenisState'), PENIS_STATES, (v) => PENIS_STATE_LABEL[v], (state) => {
  spec = { ...spec, penisSoft: state === 'soft' };
  commit();
});
/** 成人部件的开关和两排选项：开关关着、成品角色、没有阴茎时都藏起来 */
const adultBox = $<HTMLInputElement>('adultOn');
adultBox.checked = adultOn();
adultBox.addEventListener('change', () => {
  // 关上：先把阴茎的设定（几根、大小、排法、姿势、微调）收起来，再去掉已有的（commit 里去），描述原样留着，写了也不长。
  // 打开：照现在的描述重新认一遍（之前写了「两根阴茎」的，这时才长出来），再把关之前收起来的原样放回去——只是藏起来，不用重新捏
  if (!adultBox.checked) keepAdult(spec);
  setAdult(adultBox.checked);
  if (!adultBox.checked) commit();
  else {
    const parsed = applyParse(spec, readText(desc.value));
    const back = normalizeSpec(restoreAdult(parsed));
    // 收起来的放回来了：描述重写成带阴茎的规范写法（不然下次改描述又认成没有）
    if (back.counts.penises !== parsed.counts.penises) fromParams(back);
    else {
      spec = back;
      commit('text');
    }
  }
});
function syncAdult() {
  // 别的标签页里拨过的：这一页的勾跟着
  adultBox.checked = adultOn();
  const shown = adultShown() && spec.counts.penises > 0;
  $('penisStateField').hidden = !shown;
  $('penisLayoutField').hidden = !shown;
  $('scrotumField').hidden = !shown;
  syncPenisState(spec.penisSoft ? 'soft' : 'hard', true);
  syncPenis(spec.penisLayout, spec.counts.penises > 1);
  syncScrotum(spec.scrotum, true);
  syncPenisRow(shown && spec.counts.penises > 1 && spec.penisLayout === 'grid');
}

/** 阴茎排成几乘几时每排几根：只在选了「几乘几」时显示 */
const syncPenisRow = (() => {
  const minus = el('button', '', '−');
  const plus = el('button', '', '+');
  const out = el('output');
  minus.type = plus.type = 'button';
  minus.setAttribute('aria-label', t('每排少一根'));
  plus.setAttribute('aria-label', t('每排多一根'));
  const step = (delta: number) => () => fromParams({ ...spec, penisRow: clampPenisRow(spec.penisRow + delta) });
  minus.addEventListener('click', step(-1));
  plus.addEventListener('click', step(1));
  $('penisRow').append(minus, out, plus);
  return (shown: boolean) => {
    $('penisRowField').hidden = !shown;
    const rows = Math.ceil(spec.counts.penises / spec.penisRow);
    out.textContent = t('{n}（{rows} 排）', { n: spec.penisRow, rows });
    minus.disabled = spec.penisRow <= PENIS_ROW.min;
    plus.disabled = spec.penisRow >= PENIS_ROW.max;
  };
})();

/** 人腿人马、前后串联每副胯上几条腿：只在选了这两种排法时显示 */
const syncHipLegs = (() => {
  const minus = el('button', '', '−');
  const plus = el('button', '', '+');
  const out = el('output');
  minus.type = plus.type = 'button';
  minus.setAttribute('aria-label', t('每副胯少一条腿'));
  plus.setAttribute('aria-label', t('每副胯多一条腿'));
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
  card.title = t('{name}：{look}', { name: entry.name, look: entry.look });
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
const ownLabel = el('span', '', t('自己的'));
ownCard.append(ownFace, ownLabel);
ownCard.addEventListener('click', () => pickCharacter(OWN_CHARACTER));
characterCards.set(OWN_CHARACTER, ownCard);
$('characterPick').append(ownCard);
let ownThumb = '';
/** 自己的 VRM 读好了（刚选的，或者从这台设备上读回来的）：那一格显示出来 */
function showOwnCard(source: CharacterSource) {
  ownCard.hidden = false;
  ownCard.title = t('{title}（{file}）', { title: source.title, file: ownFileName() });
  ownLabel.textContent = source.title;
  if (ownThumb) URL.revokeObjectURL(ownThumb);
  ownThumb = source.thumbnail ? URL.createObjectURL(new Blob([source.thumbnail.bytes as Uint8Array<ArrayBuffer>], { type: source.thumbnail.mime })) : '';
  if (ownThumb) ownFace.src = ownThumb;
  else ownFace.removeAttribute('src');
  ownFace.hidden = !ownThumb;
}
/** 自己的 VRM 的说明：作者、许可，不是 VRoid 做的提醒一句 */
function ownNote(source: CharacterSource): string {
  const blank = t('文件里没写');
  return joinSentences([
    t('{title}（{file}）：你自己载入的 VRM。作者 {author}；许可 {license}{url}，用它做的东西发出去时请照它的许可来。', {
      title: source.title,
      file: ownFileName(),
      author: source.author || blank,
      license: source.license || blank,
      url: source.licenseUrl ? t('（{url}）', { url: source.licenseUrl }) : '',
    }),
    source.vroid ? '' : t('它不是 VRoid 做的：皮肤、衣服、头发是照 VRoid 的材质名认的，认不全时多出来的头、并腿、换发型、染发可能不太对。'),
    t('文件只存在这台设备的浏览器里，不会写进配置文件。'),
  ]);
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
    $('characterNote').textContent = source ? ownNote(source) : t('还没有载入自己的 VRM：点「载入自己的 VRM…」选一个文件（VRoid Studio 导出的最好）。');
    return;
  }
  const entry = rosterEntry(spec.character);
  $('characterNote').textContent = joinSentences([
    t('{name}：{look}。作者 {author}；{license}。', { name: entry.name, look: entry.look, author: entry.author, license: entry.license }),
    entry.credit ? t('用她做的东西发出去时请带上「{credit}」。', { credit: entry.credit }) : '',
  ]);
}
const fileVrm = $<HTMLInputElement>('fileVrm');
fileVrm.addEventListener('change', async () => {
  const file = fileVrm.files?.[0];
  fileVrm.value = '';
  if (!file) return;
  setStatus(t('正在读 {name}…', { name: file.name }));
  try {
    const source = await loadOwnCharacter(file.name, await file.arrayBuffer());
    showOwnCard(source);
    refitNext = true;
    spec = { ...spec, bodyStyle: 'character', character: OWN_CHARACTER };
    commit();
    setStatus(
      source.vroid
        ? t('已载入 {name}（{title}）。', { name: file.name, title: source.title })
        : t('已载入 {name}（{title}）；它不是 VRoid 做的，有些地方可能认不全。', { name: file.name, title: source.title }),
    );
  } catch (err) {
    setStatus(t('这个 VRM 读不了：{err}', { err: errText(err) }), true);
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
  btn.title = t('{name}发', { name });
  btn.setAttribute('aria-label', t('{name}发', { name }));
  btn.style.background = color;
  btn.addEventListener('click', () => dyeHair(color));
  $('hairSwatches').append(btn);
  return { btn, color };
});

const HAIR_SLIDERS = [
  { key: 'length', label: t('长度'), range: HAIR_LENGTH },
  { key: 'volume', label: t('蓬松'), range: HAIR_VOLUME },
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
  2: [t('左'), t('右')],
  3: [t('左'), t('中'), t('右')],
  4: [t('最左'), t('左'), t('右'), t('最右')],
  5: [t('最左'), t('左'), t('中'), t('右'), t('最右')],
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
const TORSO_LABEL: Record<number, readonly string[]> = { 2: [t('左身'), t('右身')], 3: [t('左身'), t('中身'), t('右身')] };

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
  /** heads：每个上半身（正面看从左往右）各有几个头 */
  return (heads: readonly number[]) => {
    if (built !== heads.join('×')) {
      built = heads.join('×');
      host.replaceChildren();
      cells = [cell(null, t('全部'))];
      let first = 0;
      heads.forEach((count, body) => {
        (count > 1 ? (HEAD_SLOT_LABEL[count] ?? []) : ['']).forEach((text, slot) => {
          const where = heads.length > 1 ? (TORSO_LABEL[heads.length]?.[body] ?? '') : '';
          cells.push(cell(first + headAtSlot(slot, count), [where, text].filter(Boolean).join(' · ')));
        });
        first += count;
      });
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
  // 一个头几张脸的只有一副头发；好几个上半身时每个上半身各有自己的头（单独设过的照它自己的数）
  const per = (heads: number) => (spec.headLayout === 'faces' ? 1 : heads);
  const sides = torsoSides(spec.counts.torsos);
  const heads = sides.length ? sides.map((side) => per(countsOf(spec, side).heads)) : [per(spec.counts.heads)];
  const total = heads.reduce((sum, n) => sum + n, 0);
  const apart = colored && total > 1;
  $('hairHeadsField').hidden = !apart;
  if (!apart || (dyeHead !== null && dyeHead >= total)) dyeHead = null;
  if (apart) syncHairHeads(heads);
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
  // 按住拖：松手前每动一下只重建模型（见 commit）
  input.addEventListener('pointerdown', () => {
    endSlide();
    sliding = d.key;
  });
  // 松开滑块：这一次拖动到此为止，算一步撤销
  input.addEventListener('change', () => {
    history.seal();
    endSlide();
  });
  // 没拖动（值没变就没有 change）、拖到一半被系统手势打断
  input.addEventListener('pointerup', endSlide);
  input.addEventListener('pointercancel', endSlide);
  row.append(label, input, out);
  $('shapes').append(row);
  return () => {
    const v = spec.shape[d.key];
    if (Number(input.value) !== v) input.value = String(v);
    out.textContent = shapeText(d, v);
    const fixed = FIXED_SHAPES[spec.bodyStyle].has(d.key);
    input.disabled = fixed;
    row.classList.toggle('off', fixed);
    if (d.key === 'penisSize') row.hidden = !adultShown() || spec.counts.penises === 0;
  };
});

const btnUndo = $<HTMLButtonElement>('btnUndo');
const btnRedo = $<HTMLButtonElement>('btnRedo');
btnUndo.addEventListener('click', undo);
btnRedo.addEventListener('click', redo);

// 还没有现成的姿势可选：那一栏就不出现
if (!POSE_LIBRARY.length) document.querySelector('section[data-key="poses"]')?.remove();

/* ---------- 面板的各栏：一次只看一栏，左边（手机上是上沿、底下）的栏目名按钮换栏 ---------- */

const sections = new Map<string, HTMLElement>();
for (const section of document.querySelectorAll<HTMLElement>('section[data-key]')) sections.set(section.dataset.key!, section);

/** 上一次 syncPicked 时选中的是什么（只在变了的时候告诉 phone） */
let pickedNow = '';
/** 手机上点中部件前镜头在哪：取消选择时飞回来 */
let viewBeforePick: CameraState | null = null;

/** 换到面板里的某一栏 */
function reveal(key: string) {
  if (!sections.has(key)) return;
  // 点中部件时换到「微调」由 phone.picked 管（它记着点中之前在看哪一栏，取消选择时回去）
  if (key !== 'tweak' || !selected) phone.open(key);
}

// 栏目名按钮：电脑上面板左边一竖排图标，手机竖屏上抽屉上沿一排字（摆姿势时是底下那条图标）
for (const [key, section] of sections) {
  const jump = el('button', '');
  jump.type = 'button';
  jumpLabel(jump, key, section.querySelector('.fold')?.textContent ?? key);
  // 人点的就照点的换（选着部件时从别的栏点回「微调」也要换过去）；reveal 只管程序替人换栏
  jump.addEventListener('click', () => phone.open(key));
  // 只属于「造型」或「摆姿势」的栏目，它的名字也只在那个模式下出现
  if (section.dataset.mode) jump.dataset.mode = section.dataset.mode;
  $('jump').append(jump);
}
/** 面板的版面（一次一栏、弹出层、冒出来的状态；手机竖屏上还有底下的抽屉），见 view/phone.ts。栏目名按钮要先有 */
const phone = new Phone(sections);

/* ---------------- 主题 ---------------- */

const THEMES = ['auto', 'light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
const THEME_LABEL: Record<Theme, string> = { auto: t('跟随系统'), light: t('浅色'), dark: t('深色') };

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
  $('btnTheme').textContent = t('主题：{name}', { name: THEME_LABEL[theme] });
}

const langPick = $<HTMLSelectElement>('lang');
for (const l of LANGS) langPick.append(new Option(l.label, l.key));
langPick.value = LANG;
langPick.addEventListener('change', () => {
  save();
  setLang(langPick.value as Lang);
});

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
let characterBase: { key: string; bust: number; build: CharacterBuild } | null = null;
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
  watchViewport(viewport);
} catch (err) {
  noteProblem(`WebGL: ${err instanceof Error ? err.message : String(err)}`);
  const msg = $('stageMsg');
  msg.hidden = false;
  msg.textContent = t('这个浏览器没能启动 3D 显示（WebGL）。换用新版 Edge 或 Chrome，或在浏览器设置里打开硬件加速后再试。');
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
  { key: 'lightTurn', text: (v) => (v ? (v > 0 ? t('左 {n}°', { n: Math.abs(v) }) : t('右 {n}°', { n: Math.abs(v) })) : t('正前')) },
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
  ['front', t('正面')],
  ['side', t('左侧')],
  ['right', t('右侧')],
  ['back', t('背面')],
  ['top', t('俯视')],
  ['bottom', t('仰视')],
  ['three', t('斜侧')],
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
const REF_LABEL: Record<RefSlot, string> = { front: t('正面'), side: t('侧面') };
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
  { key: 'up', text: (v) => (v ? `${v > 0 ? '↑' : '↓'}${Math.abs(v)} cm` : t('贴地')) },
  { key: 'shift', text: (v) => (v ? `${v > 0 ? '→' : '←'}${Math.abs(v)} cm` : t('居中')) },
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
  $('refName').textContent = r
    ? t('{label}图：{name}', { label, name: r.name })
    : t('还没有{label}图。点「选图…」选一张自己画的{label}设定图。', { label });
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
    const label = REF_LABEL[slot];
    setStatus(
      kept
        ? t('{label}参考图已垫上：{name}。', { label, name: file.name })
        : t('{label}参考图已垫上：{name}。这个浏览器不让存，下次打开要重新选。', { label, name: file.name }),
    );
  } catch (err) {
    setStatus(t('这张图读不了（{err}）：换成 PNG 或 JPG 再试。', { err: errText(err) }), true);
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
  shape: [$('hint').textContent ?? '', t('单指拖动旋转 · 双指缩放、平移 · 点一下部件单独调整')],
  pose: [t('拖圆点摆姿势 · 点一下圆点出现旋转环 · 拖空白处转视角'), t('拖圆点摆姿势 · 点一下圆点出现旋转环 · 双指缩放、平移')],
} as const;
/** 在模型上点中过部件没有（看过新手引导里调肢体那一步也算）。好多人不知道部件能单独挪：没点过之前，造型时的提示换成这一句，亮在 3D 视图正中 */
const PICKED_KEY = 'oc-basemesh-picked';
let pickedOnce = true;
try {
  pickedOnce = localStorage.getItem(PICKED_KEY) === '1';
} catch {
  // 读不到就当点过，不一直亮着
}
function showHint(which: keyof typeof HINTS) {
  const hint = $('hint');
  const nudge = which === 'shape' && !pickedOnce && Boolean(viewport);
  hint.textContent = nudge ? t('点一下手臂、头、腿这些部件，就能单独挪动、旋转、缩放它') : HINTS[which][byFinger ? 1 : 0];
  hint.classList.toggle('tip', nudge);
  if (nudge || !byFinger || !viewport) return;
  hint.classList.add('tip');
  viewport.renderer.domElement.addEventListener('pointerdown', () => hint.classList.remove('tip'), { once: true });
}
if (byFinger || !pickedOnce) showHint('shape');
/** 知道部件能点了：记下来，造型时的提示换回平常那句 */
function learnedPick() {
  if (pickedOnce) return;
  pickedOnce = true;
  try {
    localStorage.setItem(PICKED_KEY, '1');
  } catch {
    // 记不住就这一次不亮
  }
  if (mode === 'shape') {
    $('hint').textContent = HINTS.shape[byFinger ? 1 : 0];
    $('hint').classList.remove('tip');
  }
}

// 手机浏览器里屏幕键盘是盖在页面上的，页面自己不知道变矮了：看得见的高度比页面矮一大截，就是键盘出来了。
// 记在 <html> 上，样式里把抽屉拉到整屏，正在打字的那一格不被键盘挡住
const eye = window.visualViewport;
if (eye) {
  eye.addEventListener('resize', () => {
    document.documentElement.classList.toggle('typing', window.innerHeight - eye.height * eye.scale > 140);
  });
}

// 装成安卓应用时（tools/android 的外壳）：做个记号给样式用；
// 按返回键时外壳先来问这里——一层一层退：引导、弹出的菜单和面板、选中的部件和关节、摆姿势的卡片、拉高的抽屉，
// 都没有才真的退出
if (inAndroidShell) {
  document.documentElement.dataset.shell = 'android';
  (window as unknown as { __ocBack: () => boolean }).__ocBack = () => {
    if (tour.open) {
      tour.close();
      return true;
    }
    if (phone.pop) {
      phone.setPop(null);
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
    return phone.back();
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

/** 读数（电脑上在顶栏，手机上在顶上一行小字）里「面数」那一格的文字，以及跟在后面的警告 */
let readout = { triangles: '', warning: '' };
/** 开发模式下穿模检查的结果 */
let clashNote = '';
/** 帧率（地址里带 ?fps 时才有） */
let fpsNote = '';

function drawReadout() {
  if (!metrics) return;
  const items = [
    el('span', '', t('身高 {h} m', { h: metrics.height.toFixed(2) })),
    el('span', '', t('约 {n} 头身', { n: metrics.headRatio.toFixed(1) })),
    el('span', '', readout.triangles),
  ];
  if (fpsNote) items.push(el('span', '', fpsNote));
  for (const warning of [readout.warning, clashNote]) if (warning) items.push(el('span', 'warn', warning));
  $('readout').replaceChildren(...items);
}

// 地址后面加上 ?fps，读数里就多一格帧率（平时不显示，免得一直跳）
if (viewport && new URLSearchParams(location.search).has('fps')) {
  viewport.onFps = (fps) => {
    fpsNote = t('{n} 帧/秒', { n: Math.round(fps) });
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
  if (!fusedStats) return showReadout(t('正在生成网格…'));
  const { triangles, info, draft, fine } = fusedStats;
  showReadout(
    t('{n} 三角面（{kind}）', { n: count(triangles), kind: draft ? t('粗略预览') : fine ? t('精细') : t('预览') }),
    info.components > 1 ? t('网格分成了 {n} 块：有部件没连上身体', { n: info.components }) : '',
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
fused.onError = (err) => setStatus(t('融合网格出错：{err}', { err: err.message }), true);
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
  setStatus(t('正在载入二次元素体…'));
  loadAnimeBody(import.meta.env.BASE_URL)
    .then((buffer) => {
      provideShapes(buffer);
      setStatus(t('二次元素体已载入'));
      refitNext = true;
      scheduleRebuild();
    })
    .catch((err: unknown) => {
      retryOnReturn = err instanceof OfflineError;
      setStatus(t('二次元素体没载入成功，先用白模人台：{err}', { err: errText(err) }), true);
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
          setStatus(t('这台设备上没有存着自己的 VRM，先用白模人台：点「载入自己的 VRM…」选一个文件。'), true);
          return;
        }
        showOwnCard(source);
        setStatus(t('已读回自己的 VRM「{title}」', { title: source.title }));
        refitNext = true;
        scheduleRebuild();
      })
      .finally(() => characterLoading.delete(id));
    return;
  }
  const label = rosterEntry(id).label;
  setStatus(t('正在载入角色「{label}」（十来 MB，稍等）…', { label }));
  loadCharacter(id, import.meta.env.BASE_URL)
    .then(() => {
      // 等的时候又换了别的角色：这一个留着，不抢着显示
      if (spec.character !== id) return;
      setStatus(t('角色「{label}」已载入', { label }));
      refitNext = true;
      scheduleRebuild();
    })
    .catch((err: unknown) => {
      retryOnReturn = err instanceof OfflineError;
      setStatus(t('角色「{label}」没载入成功，先用白模人台：{err}', { label, err: errText(err) }), true);
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
  setStatus(t('正在载入发型「{name}」…', { name: HAIR_LABEL[style] }));
  loadHair(style, import.meta.env.BASE_URL)
    .then(() => {
      setStatus(t('发型「{name}」已载入', { name: HAIR_LABEL[style] }));
      scheduleRebuild();
    })
    .catch((err: unknown) => {
      retryOnReturn = err instanceof OfflineError;
      setStatus(t('发型「{name}」没载入成功，先用原装的头发：{err}', { name: HAIR_LABEL[style], err: errText(err) }), true);
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
  setStatus(t('正在载入发型「{name}」…', { name: HAIR_LABEL[style] }));
  loadHairShape(style, import.meta.env.BASE_URL)
    .then((buffer) => {
      provideHair(style, buffer);
      setStatus(t('发型「{name}」已载入', { name: HAIR_LABEL[style] }));
      scheduleRebuild();
    })
    .catch((err: unknown) => {
      retryOnReturn = err instanceof OfflineError;
      setStatus(t('发型「{name}」没载入成功，先光着头：{err}', { name: HAIR_LABEL[style], err: errText(err) }), true);
    })
    .finally(() => {
      hairShapeLoading.delete(style);
    });
}

/** 阴囊的数据（不到 0.5 MB）也是用到时才取，取回来之前先不长阴茎、阴囊（见 geometry/layout.ts） */
let genitalLoading = false;
function ensureGenital() {
  if (genitalLoading || genitalReady() || !spec.counts.penises) return;
  genitalLoading = true;
  loadGenital(import.meta.env.BASE_URL)
    .then((buffer) => {
      provideGenital(buffer);
      scheduleRebuild();
    })
    .catch((err: unknown) => {
      retryOnReturn = err instanceof OfflineError;
      setStatus(t('阴囊的数据没载入成功，先不长：{err}', { err: errText(err) }), true);
    })
    .finally(() => {
      genitalLoading = false;
    });
}

/** 成品角色的几排胸（Chest_01_L …）在手动微调之外再放大 k 倍：拖胸部大小滑块时先这样顶着，松手再照新的大小重拼 */
function grownChests(build: CharacterBuild, overrides: Readonly<Record<string, PartOverride>>, k: number): Record<string, PartOverride> {
  const out = { ...overrides };
  for (const part of characterParts(build)) {
    if (part.type !== 'chest') continue;
    const o = overrides[part.name];
    const s = o?.scale ?? [1, 1, 1];
    out[part.name] = { ...o, scale: [s[0] * k, s[1] * k, s[2] * k] };
  }
  return out;
}

/** 显示成品角色：按部件数量把她拼出来。拼不出来（文件有问题）就返回 false，退回白模人台 */
function showCharacter(): boolean {
  const source = characterSource(spec.character);
  if (!source) return false;
  try {
    const donor = hairDonor(spec.hair.style);
    // 胸部大小单独比：拖着它的滑块时不重拼（一次几十到一百多毫秒，滑块跟着卡），照上一次拼好的把胸按比例放大，松手再重拼
    const bust = Math.min(spec.shape.bust, BUST_MAX_OTHER);
    const key = JSON.stringify([
      { ...spec, shape: { ...spec.shape, bust: null }, overrides: null, characterOverrides: null, posing: null },
      spec.character,
      Boolean(donor),
      hairSources().map((s) => Boolean(s && hairLit(s))),
    ]);
    if (characterBase?.key !== key || (characterBase.bust !== bust && sliding !== 'bust')) {
      characterBase = { key, bust, build: assembleCharacter(source, spec, donor) };
    }
    const grow = bust / characterBase.bust;
    tweaked = tweakCharacter(characterBase.build, grow === 1 ? spec.characterOverrides : grownChests(characterBase.build, spec.characterOverrides, grow));
    character = tweaked.build;
    characterVersion++;
  } catch (err) {
    character = null;
    tweaked = null;
    setStatus(t('成品角色拼不出来，先用白模人台：{err}', { err: errText(err) }), true);
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
  showReadout(
    t('{n} 三角面', { n: count(stats.triangles) }),
    character.ignored.length ? t('成品角色还拼不了：{list}', { list: character.ignored.join(t('、')) }) : '',
  );
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
    genitalReady(),
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
  ensureGenital();
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
    showReadout(t('{n} 三角面', { n: count(stats.triangles) }));
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
  { key: 'position', label: t('位置'), unit: 'cm', step: 0.5, digits: 1 },
  { key: 'rotation', label: t('角度'), unit: '°', step: 1, digits: 1 },
  { key: 'scale', label: t('大小'), unit: t('倍'), step: 0.05, digits: 2 },
] as const;
type TweakKey = (typeof TWEAK_FIELDS)[number]['key'];

/** 「大小」的三个方向各是什么意思 */
const SCALE_HINT: Partial<Record<PartType, string>> = {
  arm: t('Y 是手臂的长短，X、Z 是粗细'),
  leg: t('Y 是上下的长短，X、Z 是粗细'),
  tail: t('Z 是前后的长短，X 宽、Y 高'),
  wing: t('X 是翼展，Y 高、Z 厚'),
  ear: t('X 宽、Y 长、Z 厚'),
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
  focusPicked();
}

/** 手机上屏幕小：点中部件时镜头凑过去，取消选择时飞回原来的地方 */
function focusPicked() {
  if (!viewport || !phone.on) {
    viewBeforePick = null;
    return;
  }
  const box = selected ? gizmo?.selectionBox() : null;
  if (box) {
    viewBeforePick ??= viewport.cameraState();
    viewport.focusOn(box);
  } else if (!selected && viewBeforePick) {
    viewport.flyToState(viewBeforePick);
    viewBeforePick = null;
  }
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
    const options = [new Option(t('（在模型上点一个部件，或者在这里选）'), '')];
    for (const n of names) {
      const label = activeOverrides(spec)[n] ? t('{name}（已微调）', { name: partLabel(n) }) : partLabel(n);
      options.push(new Option(`${label} · ${n}`, n));
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
    if (twin) $('tweakMirrorText').textContent = t('同时调整对侧（{name}）', { name: partLabel(twin) });
    btnTweakReset.disabled = !activeOverrides(spec)[part.name];
    const frame = part.type === 'eye' || part.type === 'horn' || part.type === 'ear' ? t('这个头的') : t('角色的');
    $('tweakNote').textContent = joinSentences([
      t('X 是{frame}左手边，Y 朝上，Z 朝前；角度绕这三根轴转，以关节为中心。', { frame }),
      t('大小：{hint}。', { hint: SCALE_HINT[part.type] ?? t('X 宽、Y 高、Z 厚') }),
      character ? t('成品角色的部件是照骨骼分的：和身体连着的地方（肩膀、腿根、脖子）跟着拉长；复制出来的手臂、角、尾巴、翅膀是整块挪的。') : '',
    ]);
  } else {
    $('tweakNote').textContent = t('在模型上点一下某个部件，或者在上面选，就能单独调它的位置、角度和大小。');
  }
  // 舞台左下角也标出选中的是谁：面板滚走了也看得见
  syncPicked();

  // 已经微调过的部件：点名字可以直接选中
  const all = Object.keys(activeOverrides(spec));
  const changed = names.filter((n) => activeOverrides(spec)[n]);
  const host = $('tweaked');
  host.hidden = all.length === 0;
  if (all.length) {
    const items: HTMLElement[] = [el('span', '', t('已微调：'))];
    for (const n of changed) {
      const chip = el('button', n === selected ? 'chip hit' : 'chip', partLabel(n));
      chip.type = 'button';
      chip.title = n;
      chip.addEventListener('click', () => select(n));
      items.push(chip);
    }
    if (all.length > changed.length) {
      items.push(el('span', '', t('另有 {n} 条对应的部件现在不存在', { n: all.length - changed.length })));
    }
    const clear = el('button', 'btn ghost', t('全部还原'));
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
    if (!name) return;
    reveal('tweak');
    learnedPick();
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
  torso: t('躯干'),
  head: t('头'),
  arm: t('手臂'),
  leg: t('腿'),
  finger: t('手指'),
  tail: t('尾巴、翅膀'),
  hair: t('头发、衣摆'),
  genital: t('阴茎'),
};

$('poseNote').textContent =
  t('拖模型上的圆点摆姿势。青色的大圆点是手、脚和胯：拖手脚，肘和膝自己跟着弯，够不着时身体会跟过去。黄色的菱形是手肘、膝盖朝哪边顶。白色的小圆点是别的关节。点一下圆点会出现旋转环，转的是从这个关节往外的那一段。拖空白的地方是转视角。');

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

/**
 * 以前存下来的姿势里转过头的锁骨（把肩关节带出了身子，见 pose/collar.ts）：退回到贴着身子。
 * 直接换掉设定里的姿势并存档，不进撤销（撤销回去的那一步再打开时照样退回来）
 */
function settleOldCollars(solver: Solver) {
  const next = settleCollars(
    solver,
    spec.posing,
    () => {
      const dist = bodyDist();
      return dist && figure ? { dist, reach: rootReach(figure) } : null;
    },
    figure?.scale ?? 1,
  );
  if (next === spec.posing) return;
  spec = { ...spec, posing: next };
  save();
}

/** 摆姿势时：模型重建了、姿势变了、撤销了……把屏幕上的一切同步到 spec.posing */
function syncPosing() {
  const k = ensureKit();
  if (!k) return;
  const ready = ensurePosed();
  // 融合网格的权重要算一小会儿：算好之前圆点先亮着，网格等一下才跟上
  if (!ready && !poseWaiting) setStatus(t('正在给网格配上骨骼，马上就能摆…'));
  else if (ready && poseWaiting) setStatus(t('可以摆姿势了：拖模型上的圆点。'));
  poseWaiting = !ready;
  // 分部件模式：摆姿势时显示的是另一组能弯的网格
  const flat = !character && spec.meshMode === 'parts';
  flatParts.root.visible = flat && ready;
  if (flat) model.root.visible = !ready;
  // 正拖着的时候屏幕上是还没存的姿势，不去动它
  if (!poseHandles?.busy) {
    settleOldCollars(k.solver);
    poseState = stateOf(k.solver, spec.posing);
  }
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
  phone.setMode(next);
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
  // 小牌子亮着时，3D 视图正中那句提示收起来，免得叠在一起（新手引导替人选中部件时没碰过屏幕，它还亮着）
  if (part || handle) $('hint').classList.remove('tip');
  if (part) $('pickedName').textContent = `${partLabel(part.name)} · ${part.name}`;
  if (handle) $('pickedName').textContent = handle.label;
  // 手机上：选中、换了选中、取消选中的那一下，抽屉换到「微调」、摆姿势弹出关节的小卡片
  const now = part ? `part:${part.name}` : handle ? `joint:${handle.id}` : '';
  if (now !== pickedNow) {
    pickedNow = now;
    phone.picked(part ? 'part' : handle ? 'joint' : null);
  }
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

/** 直接换一个姿势（对称、翻转、还原）。打开了「几对手臂一起动」的话，别的几对照领头的那一对摆好再存 */
function editPosing(next: Posing, key?: string) {
  if (kit && followOn) next = posingOf(kit.solver, following(stateOf(kit.solver, next)), next);
  spec = { ...spec, posing: next };
  commit(key);
}

/* ---- 几对手臂一起动（见 pose/follow.ts）：只是界面上的状态，不进撤销、不存档 ---- */

/** 打开了的话，别的几对手臂一直照领头的那一对摆 */
let followOn = false;
/** 左右各是哪一对领头（从 0 数）：最后拖过、转过的那一对，没拖过是第一对。关着的时候也记 */
const followLeads = { left: 0, right: 0 };
/** 打开了时，别的几对照领头的那一对摆 */
const following = (state: PoseState): PoseState => (kit && followOn ? followPair(kit.solver, state, followLeads) : state);
/** 拖、转的是哪一对手臂上的点，就让那一对领头 */
function takeLead(handle: Handle | null | undefined) {
  if (!kit || !handle) return;
  const { solver } = kit;
  const limb = handle.limb >= 0 ? solver.limbs[handle.limb] : null;
  const arm = limb ? (limb.kind === 'arm' ? { pair: limb.pair, side: limb.side } : null) : (armOfBone(solver, handle.turn) ?? armOfBone(solver, handle.anchor));
  if (!arm) return;
  if (arm.side > 0) followLeads.left = arm.pair;
  else followLeads.right = arm.pair;
}
const FOLLOW_CHOICES = ['off', 'on'] as const;
const syncFollow = buildSeg($('segPoseFollow'), FOLLOW_CHOICES, (v) => (v === 'off' ? t('各摆各的') : t('一起动')), (v) => {
  followOn = v === 'on';
  // 打开就照领头的那一对摆一遍，记一步撤销
  if (kit && poseState && followOn) {
    poseState = following(poseState);
    showPose();
    commitPose();
  } else renderPosePanel();
});

if (poseHandles) {
  poseHandles.onGrab = (handle) => {
    takeLead(handle);
    beginGrab();
  };
  poseHandles.onDrag = (handle, target) => {
    if (!kit || !grab) return;
    const { solver } = kit;
    if (handle.kind === 'reach') poseState = dragReach(solver, grab.start, handle.limb, target, grab.pins);
    else if (handle.kind === 'bend') poseState = dragBend(solver, grab.start, handle.limb, target);
    else if (handle.kind === 'body') poseState = dragBody(solver, grab.start, target, grab.pins);
    else if (handle.links.length) poseState = dragAim(solver, grab.start, handle.links, { bone: handle.anchor, rest: handle.rest }, target, grab.pins);
    if (poseState) poseState = following(poseState);
    showPose();
  };
  poseHandles.onRelease = (_handle, moved) => {
    grab = null;
    if (moved) commitPose();
  };
  poseHandles.onPick = (handle) => selectJoint(handle?.id ?? null);
  poseHandles.onTurnStart = () => {
    takeLead(pickedHandle());
    beginGrab();
  };
  poseHandles.onTurn = (delta) => {
    const handle = pickedHandle();
    if (!kit || !grab || !handle) return;
    poseState = following(turnBone(kit.solver, grab.start, handle.turn, quatMul(delta, grab.frame.rot[handle.turn]), grab.pins));
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
$('btnPoseFlip').addEventListener('click', () => editPosing(flipPosing(posingNow(), kit ? placedTwins(kit.solver.rig) : undefined)));
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
/** 脚全部踩到地上（见 pose/solve.ts 的 plantFeet）：腿重新弯、脚掌放平，够不着的整个人往下落 */
$('btnPosePlant').addEventListener('click', () => {
  if (!kit || !poseState) return;
  if (!kit.solver.limbs.some((limb) => limb.kind === 'leg')) {
    setStatus(t('这个身体没有腿。'));
    return;
  }
  poseState = following(plantFeet(kit.solver, poseState));
  showPose();
  commitPose();
  setStatus(t('脚都踩到地上了，脚掌放平；有腿够不着地面的话，整个人往下落一些。'));
});

/* ---- 自然下垂：头发、裙摆、衣摆、袖子（勾上的话还有尾巴）照重力垂下来 ---- */

const DRAPE_LABEL: Record<DrapeKind, string> = { hair: t('头发'), cloth: t('裙摆、衣摆、袖子'), tail: t('尾巴') };
$('btnPoseDrape').addEventListener('click', () => {
  if (!kit || !poseState || !posed) return;
  const { rig } = kit.solver;
  const tails = $<HTMLInputElement>('poseDrapeTails').checked;
  const bones = drapeBones(rig, tails);
  if (!bones.size) {
    const hasTails = !tails && drapeBones(rig, true).size > 0;
    setStatus(
      character
        ? hasTails
          ? t('这个角色没有会垂下来的头发、裙摆；要尾巴垂下来，先勾上「尾巴也垂」。')
          : t('这个角色没有会垂下来的头发、裙摆。')
        : hasTails
          ? t('白模的头发没有骨骼（整个跟着头动），垂不下来；要尾巴垂下来，先勾上「尾巴也垂」。')
          : t('白模的头发没有骨骼（整个跟着头动），垂不下来。'),
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
  const kinds = [...new Set(bones.values())].map((kind) => DRAPE_LABEL[kind]).join(t('、'));
  setStatus(t('{kinds}照重力垂下来了；身体再动以后，再点一次「自然下垂」。', { kinds }));
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

/* ---- 保存配置、姿势时问文件名：上次用的名字记在这个浏览器里，下次照它填好 ---- */

const SAVE_NAME_KEY = 'oc-basemesh-save-names';
const SAVE_DEFAULT = { config: 'oc_config', pose: 'oc_pose' } as const;
const SAVE_TITLE = { config: tk('保存配置'), pose: tk('保存姿势') } as const;
const nameDialog = $<HTMLDialogElement>('nameDialog');
const saveName = $<HTMLInputElement>('saveName');
// 名字框里按回车就是「保存」（表单里第一个提交按钮是「取消」，不拦的话回车等于取消）
saveName.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  nameDialog.close('ok');
});

/** 弹出小框问存成什么名字（不带扩展名，后面加 .json）；取消返回 null */
function askFileName(kind: keyof typeof SAVE_DEFAULT): Promise<string | null> {
  let saved: Record<string, unknown> = {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SAVE_NAME_KEY) ?? '{}');
    if (typeof raw === 'object' && raw !== null) saved = raw as Record<string, unknown>;
  } catch {
    // 读不到就用默认的名字
  }
  const last = typeof saved[kind] === 'string' ? cleanFileName(saved[kind]) : '';
  $('nameTitle').textContent = t(SAVE_TITLE[kind]);
  saveName.value = last || SAVE_DEFAULT[kind];
  nameDialog.returnValue = '';
  nameDialog.showModal();
  saveName.select();
  return new Promise((resolve) => {
    nameDialog.addEventListener(
      'close',
      () => {
        if (nameDialog.returnValue !== 'ok') {
          resolve(null);
          return;
        }
        const name = cleanFileName(saveName.value) || SAVE_DEFAULT[kind];
        try {
          localStorage.setItem(SAVE_NAME_KEY, JSON.stringify({ ...saved, [kind]: name }));
        } catch {
          // 存不了下次还是默认的名字
        }
        resolve(`${name}.json`);
      },
      { once: true },
    );
  });
}

$('btnPoseSave').addEventListener('click', async () => {
  if (!kit) return;
  const { solver } = kit;
  const file = {
    app: 'oc-basemesh',
    kind: 'pose',
    posing: posingOf(solver, stateOf(solver, spec.posing), spec.posing),
    ...(viewport ? { camera: viewport.cameraState() } : {}),
  };
  const name = await askFileName('pose');
  if (!name) return;
  try {
    const where = await saveText(name, JSON.stringify(file, null, 2));
    setStatus(t('已保存姿势 {file}，{where}。', { file: name, where }));
  } catch (err) {
    setStatus(t('姿势没存成：{err}', { err: errText(err) }), true);
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
    setStatus(t('已载入姿势 {name}。', { name: file.name }));
  } catch {
    setStatus(t('这个文件里没有读到姿势。'), true);
  }
});

/* ---- 手势：选几只手，点一个现成的手势，或者一根根手指调 ---- */

type HandSide = 'both' | 'L' | 'R';
const HAND_SIDES: readonly HandSide[] = ['both', 'L', 'R'];
const HAND_SIDE_LABEL: Record<HandSide, string> = { both: t('两只手'), L: t('左手'), R: t('右手') };
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
  for (const hand of pickedHands()) {
    next = shapeHand(solver, next, hand, change(readHand(solver, next, hand)));
    // 只改了某一对的手：几对手臂一起动时就让那一对领头
    if (handPair !== 'all') followLeads[hand.side > 0 ? 'left' : 'right'] = hand.pair;
  }
  poseState = following(next);
  showPose();
  commitPose(spec.posing, key);
}

const syncHandSide = buildSeg($('segHandSide'), HAND_SIDES, (v) => HAND_SIDE_LABEL[v], (side) => {
  handSide = side;
  renderPosePanel();
});
const syncHandPair = buildSeg($('segHandPair'), HAND_PAIRS, (v) => (v === 'all' ? t('全部') : t('第 {n} 对', { n: v })), (pair) => {
  handPair = pair;
  renderPosePanel();
});
const handPairLabels = [...$('segHandPair').querySelectorAll('label')];

const gestureButtons = GESTURES.map((gesture) => {
  const btn = el('button', 'btn', t(gesture.name));
  btn.type = 'button';
  btn.addEventListener('click', () => reshapeHands(() => gesture.shape));
  $('handGestures').append(btn);
  return btn;
});

/** 正拖着的那个滑块：拖的时候不把它拉回量出来的位置 */
let handDragging: HTMLInputElement | null = null;
/** 六个滑块：五根手指各弯多少，再加四指张开多少（finger 是 -1） */
const handDials = [...FINGER_NAMES.map((name, finger) => ({ label: FINGER_LABEL[name], finger })), { label: t('张开'), finger: -1 }].map((d) => {
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
  none: t('这个身体上没有带手指的手。'),
  mitten:
    t('并指的手，四根手指是连成一片的：握拳、张开这类整只手一起动的手势像样，「剪刀手」「指」这种一根根分开的摆不出来。要分开摆，到「造型 → 排布 → 手」里换成「分指」。'),
  usual:
    t('点一个手势，上面选中的手就摆成那样（不分左右）；再用滑块一根手指一根手指地调。想直接拖指尖：在「姿势」栏的「显示哪些圆点」里打开「手指」，把手放大了再拖。'),
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
  { key: '', label: t('自然') },
  { key: 'joy', label: t('开心') },
  { key: 'fun', label: t('得意') },
  { key: 'angry', label: t('生气') },
  { key: 'sorrow', label: t('难过') },
  { key: 'surprised', label: t('惊讶') },
  { key: 'extra', label: '> <' },
];
const MOUTHS = [
  { key: '', label: t('闭着') },
  { key: 'a', label: t('啊') },
  { key: 'i', label: t('衣') },
  { key: 'u', label: t('呜') },
  { key: 'e', label: t('诶') },
  { key: 'o', label: t('哦') },
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
const syncMoodDial = buildDial($('faceSliders'), 's-face-mood', t('表情强度'), [0, 1], percent, (v) =>
  editFaces((face) => {
    const mood = leading(face, MOODS).key;
    return mood ? { ...face, [mood]: v } : face;
  }, 'face:mood'),
);
const syncBlinkL = buildDial($('faceSliders'), 's-face-blink-l', t('闭左眼'), [0, 1], percent, (v) => editFaces((face) => ({ ...face, blink_l: v }), 'face:blink_l'));
const syncBlinkR = buildDial($('faceSliders'), 's-face-blink-r', t('闭右眼'), [0, 1], percent, (v) => editFaces((face) => ({ ...face, blink_r: v }), 'face:blink_r'));
const syncFang = buildDial($('faceSliders'), 's-face-fang', t('尖牙'), [0, 1], percent, (v) => editFaces((face) => ({ ...face, [FANG]: v }), 'face:fang'));
const syncMouthDial = buildDial($('mouthSliders'), 's-face-mouth', t('张多大'), [0, 1], percent, (v) =>
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
const gazeText = (words: [string, string]) => (v: number) => (Math.abs(v) < 0.005 ? t('正中') : `${v > 0 ? words[0] : words[1]} ${Math.round(Math.abs(v) * 100)}%`);
const syncGazeSide = buildDial($('gazeSliders'), 's-gaze-side', t('左右'), [-1, 1], gazeText([t('她的左'), t('她的右')]), (v) =>
  setGaze(() => [v, gazeNow()?.[1] ?? 0], 'gaze:side'),
);
const syncGazeUp = buildDial($('gazeSliders'), 's-gaze-up', t('上下'), [-1, 1], gazeText([t('上'), t('下')]), (v) => setGaze(() => [gazeNow()?.[0] ?? 0, v], 'gaze:up'));
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
  none: t('表情和视线只有「成品角色」有：白模人台、二次元素体没有嘴和眼球。'),
  usual:
    t('点一个表情，上面选中的脸就换成它；再用滑块调强度、单独闭一只眼、张嘴。「左眼」「右眼」是她自己的左右。「看镜头」是让眼睛看向你现在看她的这个角度，转了视角要再点一次。'),
  extra: t('同一个头上多出来的那几张脸，表情可以各摆各的，眼睛转不了（它们没有自己的眼睛骨骼）。'),
};
/** 「哪张脸」那一排按钮是照哪几张脸做的 */
let faceWhichFor = '';

function renderFace() {
  const faces = allFaces();
  $('faceBody').hidden = faces.length === 0;
  $('faceNote').textContent = faces.length === 0 ? FACE_NOTE.none : joinSentences([FACE_NOTE.usual, faces.some((face) => !face.eyes) ? FACE_NOTE.extra : '']);
  if (!faces.length) return;
  if (faceTarget !== 'all' && !faces.some((face) => face.key === faceTarget)) faceTarget = 'all';
  // 「哪张脸」：脸的数目变了才重做这一排
  const keys = faces.map((face) => face.key).join('|');
  if (keys !== faceWhichFor) {
    faceWhichFor = keys;
    $('faceWhich').replaceChildren(
      ...[{ key: 'all', label: t('全部') }, ...faces.map((face) => ({ key: face.key, label: faceLabel(face.key) }))].map((option) => {
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

const POSE_REGION_LABEL: Record<PoseRegion, string> = { head: t('头和脖子'), torso: t('躯干'), armL: t('左手臂'), armR: t('右手臂'), legs: t('腿') };
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
    t('点一下就套到现在这个角色身上，并且落到地面；不满意接着拖圆点改。这些姿势取自 Quaternius 的 Universal Animation Library（CC0），是给普通人形做的：手指也跟着摆（握着的、张着的、放松的）。套上去时手臂插进身体的（胯宽、胸大时常见），绕肩膀往外让一点。肩部聚拢的几条手臂：姿势和垂着差不多时一起摆（还是散开着），差得多时只摆方向最接近的那一条。别的多出来的手臂跟着原来的那条做同样的动作（上下排的还是错开着；好几个上半身时，每个上半身各自做一整套），碰到身体、别的手臂就让开，让不开的保持自己静止时的样子。尾巴、翅膀保持自己静止时的样子。');
  /** 现成的姿势是给两条腿的人摆的：多条腿时腿怎么摆见 pose/fitLegs.ts */
  const fittedLegs = (posing: Posing): Posing => fitLegs(posing, metrics?.legForm, spec.counts.legs, kit?.solver.rig);
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
    if (!body || !figure) return next;
    // 手腕外面那一截照摆好的姿势量（见 sdf/posedBody.ts）
    const posed = posedBodyDist(figure, spec.blend, poseMatrices(kit.solver.rig, forward(kit.solver.rig, stateOf(kit.solver, next)), figure.scale));
    return clearArms(kit.solver, next, body, figure.scale, spec.shape.limbs, followers, posed);
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
    // 几对手臂一起动时：套给哪一对，就让那一对领头（套给全部时是第一对，姿势本来就是照它写的），别的几对照它摆
    followLeads.left = followLeads.right = presetPair ?? 0;
    poseState = following(blendPose(rig, lastPreset.base, target, presetAmount / 100, presetPick(rig), whole() || presetParts.has('torso')));
    showPose();
    dropToGround();
    commitPose(spec.posing, lastPreset.key);
    lastPreset.result = spec.posing;
  };
  let clicks = 0;
  /** 点了一个现成的姿势。返回给状态栏的说明 */
  const applyPreset = (preset: (typeof POSE_LIBRARY)[number]): string => {
    if (!kit || !poseState) return '';
    if (!presetParts.size) return t('「套到哪些部位」一个都没勾，先勾上要套的部位。');
    // 每点一次是新的一步撤销；接着拖强度、改部位的几下合在这一步后面
    lastPreset = { name: preset.name, preset: preset.posing, base: cloneState(poseState), key: `preset-${++clicks}`, result: null };
    history.seal();
    blendPreset();
    if (whole() && presetAmount === 100) return t('姿势：{name}', { name: t(preset.name) });
    const parts = POSE_REGIONS.filter((r) => presetParts.has(r)).map((r) => POSE_REGION_LABEL[r]);
    const where = parts.length === POSE_REGIONS.length ? t('整套') : t('只套到{parts}', { parts: parts.join(t('、')) });
    const arm = presetPair === null ? '' : t('（手臂是第 {n} 对）', { n: presetPair + 1 });
    return t('姿势：{name}，{where}{arm}，强度 {amount}%。', { name: t(preset.name), where, arm, amount: presetAmount });
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
      syncPair = buildSeg(host, options, (v) => (v === 'all' ? t('全部') : t('第 {n} 对', { n: Number(v) + 1 })), (v) => {
        presetPair = v === 'all' ? null : Number(v);
        syncPresetPanel();
        reblend();
      });
    }
    $('posePairRow').hidden = count < 2;
    syncPair?.(presetPair === null ? 'all' : String(presetPair), true);
  };

  for (const preset of POSE_LIBRARY) {
    const btn = el('button', 'btn', t(preset.name));
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
  // 几对手臂一起动时：放回去的那一对领头，别的几对也跟着放回去（不然马上又被领头的那一对拽回原样）
  takeLead(handle);
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
  return { group, input, wrap };
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
  for (const { group, input, wrap } of groupChecks) {
    input.checked = shownGroups.has(group);
    // 阴茎那一组只在打开了「显示成人部件」、身上有阴茎时出现
    if (group === 'genital') wrap.hidden = !(adultShown() && spec.counts.penises > 0);
  }
  // 几对手臂一起动：有两对以上手臂才显示；领头的那一对没有了（手臂减掉了）就回到第一对
  const pairs = kit ? armPairCount(kit.solver) : 0;
  if (followLeads.left >= pairs) followLeads.left = 0;
  if (followLeads.right >= pairs) followLeads.right = 0;
  $('poseFollowRow').hidden = pairs < 2;
  syncFollow(followOn ? 'on' : 'off', true);
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
  if (warn) noteProblem(message);
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
    glb: [t('导出白模（GLB）'), t('一整块网格，拿去雕刻')],
    rig: [t('带骨骼 GLB'), t('网格 + 骨架 + 权重')],
    obj: ['OBJ', t('保留四边面')],
    stl: ['STL', t('3D 打印用')],
  },
  character: {
    glb: [t('导出角色（GLB）'), t('带贴图，不带骨骼')],
    rig: [t('带骨骼 GLB'), t('带贴图 + 骨架 + 权重')],
    obj: ['OBJ', t('只有形状，没有贴图')],
    stl: ['STL', t('只有形状，没有贴图')],
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
  setStatus(t('正在生成精细网格，稍等几秒…'));
  // 摆过姿势、不带骨骼的：照摆好的姿势重新融合（各部件的形状照骨骼搬过去再融合），不是把静止的网格扯过去——
  // 和屏幕上松手以后换上的那张一样；不这么办的身体（见 refusable）屏幕上是照权重的那张，导出也是。
  // 带骨骼的要权重：还是静止的那张网格照权重搬过去，这样权重、骨架、网格是配套的
  const posedMatrices = pose && kind !== 'rig' ? poseMatrices(pose.rig, pose.frame, target.scale) : undefined;
  const exact = posedMatrices && refusable(target, posedMatrices) ? posedMatrices : undefined;
  const data = await fused.exportData({ skin: kind === 'rig' || Boolean(pose && !exact), pose: exact });
  if (pose && !exact) {
    if (!data.skin) throw new Error(t('没有拿到蒙皮数据'));
    skinInPlace(WHITE_BLEND, data.positions, data.normals, data.skin.joints, data.skin.weights, pose.matrices);
  }
  const extra = data.tris ? data.tris.length / 3 : 0;
  const faces =
    kind !== 'obj'
      ? t('{n} 三角面', { n: count(data.info.triangles) })
      : extra
        ? t('{quads} 四边面、{tris} 三角面', { quads: count(data.info.quads), tris: count(extra) })
        : t('{quads} 四边面', { quads: count(data.info.quads) });
  let what = t('一整块网格，{faces}', { faces });
  if (data.info.components > 1) what += t('；注意它分成了 {n} 块', { n: data.info.components });
  const credit = footCredit(target);
  if (credit) what += t('；发出去时请署名「{credit}」', { credit });
  if (kind === 'obj') {
    // OBJ 存得下四边面：导进 Blender 布线更干净
    const text = writeObj([{ name: 'OC_BaseMesh', positions: data.positions, normals: data.normals, faces: data.quads, faceSize: 4, triangles: data.tris }], credit);
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
  if (!data.skin) throw new Error(t('没有拿到蒙皮数据'));
  const rest = buildSkeleton(target);
  const skeleton = pose ? posedSkeleton(pose, rest) : rest;
  const glb = writeGlb([{ ...mesh, joints: data.skin.joints, weights: data.skin.weights }], { skeleton, rigName: 'OC_Rig', ...signed });
  return { blob: glbBlob(glb), what: t('{what}，{n} 根骨骼', { what, n: skeleton.bones.length }) };
}

/**
 * 用到了要求署名的素材就返回要带的署名：二次元素体接的是 Kotori 的脚（CC BY），躯干的起伏参考了 Fly_jkey 的「Woman」（CC BY，见 tools/build-torso.ts），
 * 阴茎、阴囊取自 Death Joe Productions 的男性素体（CC BY，见 tools/build-genital.ts）
 */
const footCredit = (target: Figure) => {
  const list: string[] = [];
  if (target.parts.some((p) => p.grafts?.some((g) => g.mesh === 'foot'))) list.push(FOOT_CREDIT);
  if (target.parts.some((p) => p.prims.some((q) => q.kind === 'grid' && q.grid === animeGrid('torso')))) list.push(TORSO_CREDIT);
  if (target.parts.some((p) => p.type === 'genital')) list.push(GENITAL_CREDIT);
  return list.length ? list.join('；') : undefined;
};

/** 分部件模式：每个部件一个物体 */
async function exportParts(kind: ExportKind, target: Figure, pose: ExportPose | null): Promise<{ blob: Blob; what: string }> {
  setStatus(t('正在导出…'));
  const credit = footCredit(target);
  const note = credit ? t('；发出去时请署名「{credit}」', { credit }) : '';
  if (kind === 'glb' && !pose) {
    // 不带骨骼的 GLB 保留父子关系：眼睛、角、耳朵挂在各自的头下面
    const tree = model.baked();
    try {
      return { blob: await exportGlb(tree, credit), what: t('每个部件一个物体{note}', { note }) };
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
    const text = writeObj(
      meshes.map((m) => ({ name: m.name, positions: m.positions, normals: m.normals, faces: m.indices, faceSize: 3 })),
      credit,
    );
    return { blob: new Blob([text], { type: 'text/plain' }), what: t('每个部件一个物体{note}', { note }) };
  }
  if (kind === 'stl') {
    const stl = writeStl(meshes.map((m) => ({ positions: m.positions, triangles: m.indices })));
    return { blob: new Blob([stl], { type: 'model/stl' }), what: t('所有部件的面写在一起；部件之间互相穿插，没有融合{note}', { note }) };
  }
  const signed = credit ? { copyright: credit } : {};
  // 摆过姿势、不带骨骼的 GLB：每个部件一个物体，不分父子（一个部件里面弯过了，没法再用父子关系表示）
  if (kind === 'glb') return { blob: glbBlob(writeGlb(skinned, signed)), what: t('每个部件一个物体{note}', { note }) };
  const skeleton = pose ? posedSkeleton(pose, rest) : rest;
  return {
    blob: glbBlob(writeGlb(skinned, { skeleton, rigName: 'OC_Rig', ...signed })),
    what: t('每个部件一个物体，{n} 根骨骼{note}', { n: skeleton.bones.length, note }),
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
    const what = kind === 'rig' ? t('带贴图的成品角色，{n} 根骨骼', { n: build.bones.length }) : t('带贴图的成品角色');
    return { blob: glbBlob(glb), what: credit ? t('{what}；发出去时请署名「{credit}」', { what, credit }) : what };
  }
  const shape = characterShape(build);
  const what = t('只有形状，没有贴图和骨骼；各块互相穿插，没有融合');
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
    setStatus(
      t('已导出 {file}（{pose}{what}，{size}），{where}。', {
        file: fileName,
        pose: pose ? t('摆好的姿势，') : '',
        what,
        size: sizeText(blob.size),
        where,
      }),
    );
  } catch (err) {
    setStatus(t('导出失败：{err}', { err: errText(err) }), true);
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
    setStatus(t('已保存截图 oc_basemesh.png（透明背景），{where}。', { where }));
  } catch (err) {
    setStatus(t('截图失败：{err}', { err: errText(err) }), true);
  }
});

/* ---- VRM：给 VTuber 软件、VRoid Hub 用（写文件见 io/vrm.ts，成品角色见 character/vrm.ts）。白模要融合模式；成品角色、载入的 VRM（0.x、1.0）都能导 ---- */

const VRM_KEY = 'oc-basemesh-vrm';

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
  if (character) $('vrmTerms').textContent = t('许可照原角色：{terms}。不能改，导出的文件里原样写着。', { terms: character.terms });
  $('vrmAuthorLabel').textContent = character ? t('你的名字（写成「改」，跟在原作者后面）') : t('作者');
  // 用到了要求署名的素材（二次元素体的脚、躯干）：选什么许可都照样写上署名
  const showCredit = () => {
    const note = $('vrmCredit');
    note.hidden = !credits;
    if (credits) {
      note.textContent = joinSentences([
        t('会自动写上署名：{credits}。', { credits }),
        vrmLicense.value === 'cc0' ? t('选了 CC0 也一样：这几样素材要求署名。') : '',
      ]);
    }
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
    setStatus(t('角色的数据还没载入完，等一下再导出。'), true);
    return;
  }
  // 许可照原文件：0.x 的原样抄，1.0 的换成 0.x 的写法（见 io/vrm.ts 的 metaFromV1）
  const license = source.vrmMeta ?? source.vrm1Meta ?? {};
  const rest = characterSkeleton(build);
  let humanoid: Map<string, number>;
  try {
    humanoid = humanoidMap(rest);
  } catch (err) {
    setStatus(t('这个角色导不了 VRM：{err}', { err: errText(err) }), true);
    return;
  }
  const own = spec.character === OWN_CHARACTER;
  const credit = own ? undefined : rosterEntry(spec.character as CharacterId).credit;
  const meta = await askVrmMeta(credit, { title: source.title, terms: describeLicense(license) });
  if (!meta) return;
  const buttons = [...Object.values(exportButtons), $<HTMLButtonElement>('btnVrm')];
  for (const button of buttons) button.disabled = true;
  try {
    setStatus(t('正在写 VRM（表情一个个算成形态键），稍等几秒…'));
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
      t('{n} 根骨骼', { n: build.bones.length }),
      ...(faces ? [t('{n} 种表情', { n: faces })] : []),
      ...(source.springs?.length || hairDonor(spec.hair.style) ? [t('头发、裙摆照原角色会晃')] : []),
      ...(springs.length ? [t('尾巴会晃')] : []),
      ...(mode === 'pose' && isPosed(spec.posing) ? [t('摆的姿势、表情不进 VRM')] : []),
      t('许可照原角色：{terms}', { terms: describeLicense(license) }),
      ...(credit ? [t('发出去时请署名「{credit}」', { credit })] : []),
    ];
    setStatus(t('已导出 oc_character.vrm（{notes}），{where}。', { notes: notes.join(t('，')), where }));
  } catch (err) {
    setStatus(t('导出失败：{err}', { err: errText(err) }), true);
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}

/** 分部件的白模点 VRM 时说的话（按钮的悬停提示也是它） */
const VRM_PARTS = t('VRM 要一整块网格：先在「网格」一栏换成「融合成一整块」');

async function exportVrm() {
  if (pending || (!figure && !character)) rebuild();
  if (character) {
    await exportCharacterVrm(character);
    return;
  }
  const target = figure;
  if (!target) return;
  if (spec.meshMode !== 'fused') {
    setStatus(t('VRM 要一整块网格：先在「网格」一栏换成「融合成一整块」。'), true);
    return;
  }
  // 先看人形骨骼对不对得上：对不上就不用问名字了
  const rest = buildSkeleton(target);
  let humanoid: Map<string, number>;
  try {
    humanoid = humanoidMap(rest);
  } catch (err) {
    setStatus(t('这个身体导不了 VRM：{err}', { err: errText(err) }), true);
    return;
  }
  const credit = footCredit(target);
  const meta = await askVrmMeta(credit);
  if (!meta) return;
  const buttons = [...Object.values(exportButtons), $<HTMLButtonElement>('btnVrm')];
  for (const button of buttons) button.disabled = true;
  try {
    setStatus(t('正在生成精细网格，稍等几秒…'));
    const data = await fused.exportData({ skin: true });
    if (!data.skin) throw new Error(t('没有拿到蒙皮数据'));
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
      t('{n} 三角面', { n: count(data.info.triangles) }),
      t('{n} 根骨骼', { n: skeleton.bones.length }),
      ...(springs.length ? [t('尾巴会晃')] : []),
      ...(mode === 'pose' && isPosed(spec.posing) ? [t('摆的姿势不进 VRM')] : []),
      ...(data.info.components > 1 ? [t('注意它分成了 {n} 块', { n: data.info.components })] : []),
      ...(credit ? [t('发出去时请署名「{credit}」', { credit })] : []),
    ];
    setStatus(t('已导出 oc_basemesh.vrm（{notes}），{where}。', { notes: notes.join(t('，')), where }));
  } catch (err) {
    setStatus(t('导出失败：{err}', { err: errText(err) }), true);
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}
$('btnVrm').addEventListener('click', () => void exportVrm());

$('btnJson').addEventListener('click', async () => {
  const name = await askFileName('config');
  if (!name) return;
  try {
    const where = await saveText(name, serializeSpec(spec, text));
    setStatus(t('已保存配置 {file}，{where}。', { file: name, where }));
  } catch (err) {
    setStatus(t('配置没存成：{err}', { err: errText(err) }), true);
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
    spec = gate(normalizeSpec(data));
    readText(restoredText((data as { text?: unknown }).text));
    desc.value = text;
    refitNext = true;
    commit();
    setStatus(t('已载入 {name}。', { name: file.name }));
  } catch {
    setStatus(t('这个文件不是有效的配置文件。'), true);
  }
});

/* ---------------- 渲染 ---------------- */

const TIER_RANK: Record<MatchTier, number> = { measure: 1, keyword: 2, tag: 3, number: 4 };

/** 把原文按识别到的片段上色；片段互相重叠时取优先级高的那一层 */
function renderEcho() {
  const host = $('echo');
  host.replaceChildren();
  if (!text.trim()) {
    host.append(el('span', 'empty', t('（还没有写描述）')));
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
    const here = tier[i];
    if (here) {
      const mark = el('mark', '', piece);
      mark.dataset.tier = here;
      host.append(mark);
    } else {
      host.append(piece);
    }
    i = j;
  }
}

function render() {
  const chips = summarize(spec).map((c) => el('span', hits.has(c.key) ? 'chip hit' : 'chip', c.label));
  if (text.trim() && matches.length === 0) chips.unshift(el('span', 'chip', t('没认出部件，试试「三对手」「九条尾巴」')));
  $('chips').replaceChildren(...chips);
  // 改哪个上半身：两个以上才有；上半身少了、改的那个不在了就回到全部一样
  const sides = torsoSides(spec.counts.torsos);
  if (torsoEdit !== 'all' && !sides.includes(torsoEdit)) torsoEdit = 'all';
  $('torsoEditField').hidden = sides.length < 2;
  $('segTorso').querySelector<HTMLElement>('input[value="M"]')!.parentElement!.hidden = !sides.includes('M');
  syncTorsoEdit(torsoEdit, sides.length >= 2);
  for (const sync of steppers) sync();
  for (const sync of sliders) sync();
  syncHead(spec.headLayout, spec.counts.heads > 1);
  syncArm(spec.armLayout, spec.counts.armPairs > 1);
  syncLeg(spec.legLayout, spec.counts.legs > 1);
  syncHipLegs();
  syncAdult();
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
  btnVrm.title = vrmBlocked ? VRM_PARTS : finished ? t('给 VTuber 软件、VRoid Hub 用的 VRM：T-pose、人形骨骼、表情，头发、裙摆会晃') : t('给 VTuber 软件、VRoid Hub 用的 VRM：T-pose、人形骨骼，尾巴会晃');
  btnUndo.disabled = !history.canUndo;
  btnRedo.disabled = !history.canRedo;
  renderPosePanel();
  $('meshNote').textContent = finished
    ? t('成品角色用的是她自带的网格和贴图：各块互相插在一起，不融合，这一栏对它不起作用。')
    : spec.meshMode === 'fused'
      ? t('一整块封闭的网格，导进 Blender 可以直接雕刻。拖动时屏幕上是较粗的预览，停下来会换成细的，导出时另算精细的；眼睛只是位置标记，不导出。')
      : t('v1 的做法：每个部件是一个独立的物体，互相穿插，没有融合。');
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

/** 看完或跳过新手引导就记一笔，以后不再自动弹出（右上角「⋯」菜单里的「新手引导」可以再看） */
const TOUR_KEY = 'oc-basemesh-tour';
/** 在引导第一步换了语言要整页重新载入：记下载入后接着从第几步看（只记在这个标签页里） */
const TOUR_AT_KEY = 'oc-basemesh-tour-at';
/** 开始引导时在做哪件事；引导里切去摆姿势了，关掉时切回来 */
let tourFrom: Mode = 'shape';
/** 引导替人选中的部件：关掉时它还选着就取消 */
let tourPicked: string | null = null;
/** 开始引导时两个模式各停在哪一栏：引导会换栏，关掉时回去 */
let tourTabs: Phone['tabState'] | null = null;
/** 指着面板里的某一栏之前：回到造型，换到那一栏 */
const tourShape = (key?: string) => () => {
  setMode('shape');
  phone.setPop(null);
  if (key) phone.open(key);
};
/** 教调肢体之前：回到造型，还没选中部件就先替人选一条手臂（没有手臂挑腿、尾巴、头），模型上就有箭头可以拖 */
const tourLimb = (key?: string) => () => {
  tourShape(key)();
  learnedPick();
  if (selected) return;
  const parts = tweakable();
  const part = (['arm', 'leg', 'tail', 'head'] as const).map((type) => parts.find((p) => p.type === type)).find(Boolean) ?? parts[0];
  if (!part) return;
  select(part.name);
  tourPicked = part.name;
};
/** 引导第一步的三个语言按钮：点现在的语言就是下一步，点别的换过去（整页重新载入后接着看第二步） */
function tourLangs() {
  const row = el('div', 'tour-langs');
  for (const l of LANGS) {
    const btn = el('button', 'btn', l.label);
    btn.type = 'button';
    btn.lang = l.key === 'zh' ? 'zh-CN' : l.key;
    btn.setAttribute('aria-pressed', String(l.key === LANG));
    btn.addEventListener('click', () => {
      if (l.key === LANG) return tour.next();
      try {
        sessionStorage.setItem(TOUR_AT_KEY, '1');
      } catch {
        // 记不住就从头再看一遍
      }
      save();
      setLang(l.key);
    });
    row.append(btn);
  }
  return row;
}
const tour = new Tour([
  {
    title: t('选择语言'),
    text: t('界面用哪种语言？点一下就换。以后在右上角「⋯」菜单里也能改。'),
    extra: tourLangs,
    before: () => phone.setPop(null),
  },
  {
    title: t('欢迎来到 OC 白模工坊'),
    text: t('写一句身体设定，就能生成能导进 Blender 的多肢体角色模型。下面花半分钟认一认几个地方；不想看就点「跳过」，以后在右上角「⋯」菜单里点「新手引导」可以再看。'),
  },
  {
    title: t('身体描述'),
    text: t('用中文写想要的身体，比如「三个头，两对手臂，九条尾巴」，写完模型马上跟着变。下面亮起来的小标签是认出来的部件；展开「能认哪些写法」能看到全部说法。'),
    target: () => $('desc'),
    before: tourShape('desc'),
  },
  {
    title: t('预设'),
    text: t('不想写字就点一个现成的：双头、阿修罗、半人马、蜘蛛女……点完还能接着改。'),
    target: () => sections.get('presets') ?? null,
    before: tourShape('presets'),
  },
  {
    title: t('部件数量'),
    text: t('用 − 和 + 一样一样地调：头、手臂、胸、腿、尾巴、翅膀、角、眼睛、兽耳。下面的「排布」管多出来的怎么长（比如腿是人马还是蛛形）。'),
    target: () => sections.get('counts') ?? null,
    before: tourShape('counts'),
  },
  {
    title: t('身体样式'),
    text: t('三种：白模人台是素白的人台；二次元素体是现成的二次元裸素体；成品角色带头发、衣服和贴图，能换角色、换发型、染发。'),
    target: () => $('segBody').closest('.field'),
    before: tourShape('shape'),
  },
  {
    title: t('3D 视图'),
    text: byFinger
      ? t('单指拖动旋转视角，双指缩放、平移，现在就可以试试。下一步教你单独调一条手臂、一个头。')
      : t('拖动旋转视角，滚轮缩放，右键拖动平移，现在就可以试试。下一步教你单独调一条手臂、一个头。'),
    target: () => $('stage'),
    before: tourShape(),
    live: true,
  },
  {
    title: t('单独调整肢体'),
    text: () =>
      joinSentences([
        t('手臂、腿、尾巴、头……每个部件都能单独挪动、旋转、放大缩小：在模型上点一下就选中它，再拖它身上红、绿、蓝的箭头。'),
        selected
          ? t('现在先替你选中了「{name}」，直接拖箭头试试；点空白处取消选择。', { name: partLabel(selected) })
          : t('现在就可以试试；点空白处取消选择。'),
      ]),
    target: () => $('stage'),
    before: tourLimb(),
    live: true,
  },
  {
    title: t('手动微调'),
    text: t('选中部件以后，这一栏能把拖动换成「旋转」「缩放」，也能直接填位置、角度、大小的数字；勾上「同时调整对侧」左右一起改，调坏了点「还原这个部件」。'),
    target: () => sections.get('tweak') ?? null,
    before: tourLimb('tweak'),
  },
  {
    title: t('造型和摆姿势'),
    text: t('身体定好了就切到左上角的「摆姿势」（现在已经切过去了）：拖关节上的圆点摆动作，点一下圆点出现旋转环，现在就可以试试。面板里还有现成的姿势、手势和表情。'),
    target: () => $('stage'),
    before: () => {
      phone.setPop(null);
      setMode('pose');
    },
    live: true,
  },
  {
    title: t('视角和撤销'),
    text: t('一下切到正面、侧面、背面看；「骨骼」把骨架显示出来。改错了点顶上的「撤销」（Ctrl+Z）。'),
    // 撤销、重做在顶栏；手机上 .dock 拆开了：指着浮出来的那一排视角
    target: () => document.querySelector(phone.on ? '.dock .views' : '.dock'),
    // 手机上视角、骨骼收在右边「视角」按钮里：先打开
    before: () => phone.setPop(phone.on ? 'views' : null),
  },
  {
    title: t('导出'),
    text: t('「导出白模」是一整块网格，拿去雕刻；「带骨骼 GLB」进了 Blender 能直接摆姿势；还有 OBJ、3D 打印用的 STL 和截图。Blender 里用「文件 → 导入 → glTF 2.0」。'),
    target: () => document.querySelector('.export'),
    // 导出收在「导出」按钮里（电脑在顶栏右边，手机在右边那一竖排）：先打开那张面板
    before: () => phone.setPop('export'),
  },
  {
    title: t('就这些'),
    text: t('设定会自动存在这个浏览器里，下次打开还在。想再看一遍引导，点这里。'),
    target: () => $('btnTour'),
    // 「新手引导」在右上角「更多」菜单里
    before: () => phone.setPop('menu'),
  },
]);
tour.onClose = () => {
  try {
    localStorage.setItem(TOUR_KEY, 'done');
  } catch {
    // 存不了就下次再弹一遍
  }
  phone.setPop(null);
  setMode(tourFrom);
  if (tourPicked && selected === tourPicked) select(null);
  tourPicked = null;
  if (tourTabs) phone.tabState = tourTabs;
  tourTabs = null;
};
function startTour(at = 0) {
  if (tour.open) return;
  tourFrom = mode;
  tourPicked = null;
  tourTabs = phone.tabState;
  tour.start(at);
}
$('btnTour').addEventListener('click', () => startTour());

desc.value = text;
applyTheme();
render();
rebuild();
viewport?.frame('three');

// 第一次打开：等模型出来再开始引导；刚在引导里换了语言的，接着往下看
let tourSeen = true;
let tourAt = 0;
try {
  tourSeen = localStorage.getItem(TOUR_KEY) === 'done';
  const at = sessionStorage.getItem(TOUR_AT_KEY);
  if (at !== null) {
    sessionStorage.removeItem(TOUR_AT_KEY);
    tourSeen = false;
    tourAt = Number(at) || 0;
  }
} catch {
  // 读不到就不弹，免得每次都弹
}
if (!tourSeen) window.setTimeout(() => startTour(tourAt), 600);

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
