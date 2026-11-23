// 旧内核（安卓 WebView 83 之类）缺的函数先补上，必须在最前面
import './polyfill';
import './style.css';
import { type Lang, LANG, LANGS, setLang, t, tk, translatePage, variants } from './i18n';
import { Box3, Group, Matrix4, type Mesh, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { TORSO_CREDIT, animeGrid, animeReady, loadAnimeBody } from './anime/body';
import { FOOT_CREDIT } from './anime/foot';
import { chuTorsoReady, loadChuTorso } from './anime/chuTorso';
import { GENITAL_CREDIT, genitalReady, loadGenital } from './anime/genital';
import { adultOn, keepAdult, restoreAdult, setAdult, withoutAdult } from './model/adult';
import type { AiDock } from './ai/dock';
import { aiOn, setAiOn } from './ai/settings';
import type { PropInfo, WorkshopApi } from './ai/workshop';
import { type CharacterBuild, assembleCharacter } from './character/assemble';
import { characterGlb, characterShape, characterSkeleton, poseBuild } from './character/export';
import { characterVrm } from './character/vrm';
import { type FaceInstance, type FaceWeights, type Gaze, applyFaces, faceLabel, gazeAt, gazeOf, gazeTurns, hasExpression } from './character/face';
import { characterSource, hairDonor, hairLit, keepCharacters, lightenHair, loadCharacter, loadHair, loadOwnCharacter, ownFileName, restoreOwnCharacter } from './character/load';
import type { CharacterSource } from './character/source';
import { ROSTER, rosterEntry } from './character/roster';
import { skinInPlace } from './character/pose';
import { type TweakedCharacter, characterPartAt, characterPartGlow, characterParts, tweakCharacter } from './character/tweak';
import { describeClashes, findClashes } from './geometry/clash';
import { SOCKET_FOR, nearestSocket } from './geometry/sockets';
import { type Figure, type FigureMetrics, type Part, type PartType, nthName, worldTransforms } from './geometry/figure';
import { buildFigure } from './geometry/layout';
import { isTrunkGhost, wantsTrunk } from './geometry/trunk';
import { type PartFrame, deletable, partFrame } from './geometry/tweak';
import { type Quat, type V3, Q_ID, UP, len, norm, quatBetween, quatConj, quatEuler, quatMul, rotate, sub } from './geometry/vec';
import { cleanFileName, inAndroidShell, saveBlob, saveText } from './io/download';
import { exportGlb } from './io/exportGlb';
import { OfflineError } from './io/fetchFile';
import { type GlbMesh, writeGlb } from './io/glb';
import { forgetFile, keepFile, keptFile } from './io/keepFile';
import { type VrmLicense, type VrmMeta, VRM_LICENSES, describeLicense, humanoidMap, writeVrm } from './io/vrm';
import { ringHumanoid, tPosing, tailSprings } from './io/vrmRig';
import { writeObj, writeStl } from './io/meshFiles';
import { History } from './model/history';
import {
  type Place,
  type Scene,
  type SceneFigure,
  ORIGIN,
  PLACE_LIMITS,
  absolutePlace,
  addFigure,
  besideAll,
  cleanName,
  currentOf,
  figureOf,
  indexOf,
  isSceneData,
  moveFigure,
  normalizeScene,
  placeY,
  relativePlace,
  removeFigure,
  restoreFigure,
  serializeScene,
  setCurrent,
  singleScene,
  updateFigure,
} from './model/scene';
import { type Baked, bakeFigure, bakedGlb, bakedView, charactersOf, skeletonFor } from './scene/bake';
import { type Capsule, type Clash as FigureClash, type PairPreset, PAIR_PRESETS, PART_LABEL, capsulesOf, findClashes as figureClashes, fromScene, heightOf, placeCapsules, pushOut, solvePair, toScene } from './scene/interact';
import { mergeGlbs } from './io/mergeGlb';
import { SceneFigures } from './view/sceneFigures';
import {
  type TweakDelta,
  activeOverrides,
  clearAllOverrides,
  clearOverride,
  hiddenParts,
  hidePart,
  mirrorDelta,
  mirrorName,
  nudgeOverride,
  rigidDelta,
  setOverride,
  showPart,
  sideOf,
  topMost,
} from './model/overrides';
import { SNAP_NEAR, attachParts, attachedTo, canAttach, detachParts, isAttachable, placedSockets } from './model/attach';
import { PELVIS, RIBCAGE, addBlock, canCopy, canSplitTorso, copyShift, isBlockRoot, removeBlockAt, setSplitTorso, torsoSplit } from './model/blocks';
import { labelSplitTorso, labelTrunk, partLabel } from './model/partLabel';
import { chuRefit } from './model/chu';
import { PRESETS, applyPreset, styledPreset } from './model/presets';
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
  COUNT_DEF_BY_KEY,
  COUNT_HINTS,
  HIP_LEGS,
  FINGERS,
  clampFingers,
  TOES,
  clampToes,
  PENIS_ROW,
  CHEST_ROW,
  EAR_SHAPES,
  GENDERS,
  HAIR_LENGTH,
  HAIR_STYLES,
  HAIR_VOLUME,
  HAND_STYLES,
  CONJOINS,
  CONJOIN_POSES,
  RINGS,
  RING_CHESTS,
  RING_COUNT,
  RING_HIP_ROWS,
  RING_HIPS_PER_ROW,
  RING_LEGS,
  RING_LEG_FACINGS,
  RING_SPREAD,
  RING_SPREAD_CIRCLE_MIN,
  type RingChestMode,
  type RingLegFacingMode,
  type RingLegMode,
  type RingMode,
  type ConjoinMode,
  type ConjoinPose,
  LIMB_ENDS,
  LIMB_PART,
  type LimbEnd,
  type LimbSetting,
  limbOf as limbSettingOf,
  legPlan,
  HEAD_LAYOUTS,
  LEG_LAYOUTS,
  PENIS_LAYOUTS,
  SCROTUM_MODES,
  clampHipLegs,
  clampPenisRow,
  clampChestRow,
  chestPlan,
  perHip,
  MESH_MODES,
  OVERRIDE_LIMITS,
  POSES,
  SHAPE_DEFS,
  clampBlend,
  clampRingSpread,
  ringActive,
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
import { fitConjoined } from './pose/conjoined';
import { fitRing, isBlockRig, isRingRig } from './pose/ring';
import { POSE_GROUPS, POSE_LIBRARY, type PoseGroup, type PresetPose } from './pose/library';
import { type Posing, POSING_VERSION, cleanPosing, emptyPosing, flipPosing, isPosed, placedTwins } from './pose/posing';
import { type Frame, type PoseRig, type PoseState, type RigBone, cloneState, forward, pointOn, poseMatrices, posedBones, shiftRoot, tailOf } from './pose/rig';
import { type Pin, capturePins, dragAim, dragBend, dragBody, dragReach, plantFeet, turnBone, turnSpine } from './pose/solve';
import { type Solver, makeSolver, mirrorState, posingOf, stateOf } from './pose/solver';
import { type Skeleton, buildSkeleton } from './rig/skeleton';
import { bindPartGrafts, skinVertices } from './rig/skin';
import { type HairShape, hairReady, loadHairShape } from './hair/shapes';
import { compileField, fieldAt } from './sdf/field';
import { provideChuTorso, provideGenital, provideHair, provideShapes, spreadWork } from './sdf/meshClient';
import { type Picker, makePicker } from './sdf/pick';
import { posedBodyDist, wristBodyDist } from './sdf/posedBody';
import { refusable } from './sdf/posedField';
import { BoneOverlay } from './view/boneOverlay';
import { SocketOverlay } from './view/socketOverlay';
import { CharacterModel } from './view/characterModel';
import { type FusedStats, FusedModel } from './view/fusedModel';
import { type GizmoMode, GIZMO_MODES, Gizmo } from './view/gizmo';
import { MATERIAL_INFO } from './view/materials';
import { type BakedMesh, PartsModel, disposeTree } from './view/partsModel';
import { installChangelog } from './view/changelog';
import { PHONE_QUERY, Phone, jumpLabel } from './view/phone';
import { PoseHandles } from './view/poseHandles';
import { type RefSlot, REF_SLOTS, ReferenceImages, loadPicture } from './view/references';
import { Tour } from './view/tour';
import { type SkinSource, FlatParts, PosedMeshes, WHITE_BLEND } from './view/posedMeshes';
import { type CameraState, type ViewName, VIEW_DEFAULTS, VIEW_LIMITS, Viewport } from './view/viewport';
import { installUpdateUi } from './update/ui';
import { installDiag, installDiagRow, noteProblem, watchViewport } from './view/diag';
import { droppedFiles } from './view/dropFiles';
import { PropsPanel, propLabel } from './view/propsPanel';
import { propGlbParts, propTriangles, propWorldShapes } from './io/propFiles';
import { PROP_ASSETS, REAL_ASSETS, isUserAssetId, realAsset, skinnedAsset, userAssets } from './props/catalog';
import { PROP_LABEL, propAssetLabel } from './view/propNames';
import { loadPropAssets } from './props/library';
import { loadRealAsset } from './props/realLoad';
import { loadUserAssets } from './props/userStore';
import { type PropClash, type PropSolid, propClashes, propSolid, pushOutOfSolids, slideOutOfSolids, solidDistance } from './scene/propTouch';
import { PROP_KINDS, PROP_SIZE, type SceneProp, propOf, propPoint } from './model/props';
import { BODY_LINK, type PropLink, dropLink, isLimbPart, linkOf, linkPoint, liveLinks, putDown, sameLinks, setLink, turnLink, withCarry, withGrip } from './model/links';
import { type Carrier, carrierIn, carryLoops, placeCarried, samePose } from './scene/carry';
import { type GripWay, type HoldTarget, barGripWay, chestBone, flipGrip, followPlace, grabLink, holdPosing, holdState, holdTargets, linkTo, nearestSolid, rideLink, sceneRot, snapReach, swingReach, topUnder } from './scene/follow';
import type { SeatMark } from './scene/grip';
import { packPoseProps, placePoseProps, readPoseProps } from './scene/poseProps';
import { type ActionResult, PROP_ACTIONS, type PropAction, actionBlock, isPickAction, solveGrab, solvePropAction } from './scene/propActions';

// 写死在 index.html 里的文字先换成当前语言，后面的代码再往页面上加东西
translatePage();
// 在 exe 里打开时：有新版的提示卡片、面板顶上的版本号和「检查更新」（开发服务器上什么都不加）
installUpdateUi();
// 3D 视图空白时的诊断卡片和兼容模式（见 view/diag.ts）：先装上，后面出的错都记得到
installDiag();
installDiagRow();

const STORE_KEY = 'oc-basemesh-v2';
/** 场景里的全部角色（见 model/scene.ts）。当前角色另外照旧存在 STORE_KEY 里：退回旧版本也还在 */
const SCENE_KEY = 'oc-basemesh-scene';
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
  mannequin: new Set(['torso']),
  anime: new Set(),
  character: new Set(['build', 'thighs', 'torso']),
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
/** AI 助手的窗口（打开过才载入；render 时刷新它的「撤回这一轮」） */
let aiDock: AiDock | null = null;

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
function restoredText(saved: unknown, s: BodySpec = spec): string {
  if (typeof saved !== 'string') return describeSpec(s);
  if (variants('两个头，两对手，两对胸').includes(saved)) return START_TEXT;
  return LANGS.some((l) => describeSpec(s, l.key) === saved) ? describeSpec(s) : saved;
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

/* 「道具跟着手」（见下面「道具跟着手」那一段）用到的状态：放在这里，是因为存档、道具面板、重建在文件跑到那一段之前就可能用到 */

/** 带着的道具里，刚自己被挪了的那几件（操纵杆正拖着、改了数、撤销）：这一下是手跟着它们，它们的位置照清单 */
const propLed = new Set<string>();
/** 道具面板正在写清单（它紧跟着要记撤销）：这时候不往清单里补写，等它记完（见 propsPanel 的 edited） */
let propWriting = false;
/** 道具面板刚写完的这一步里，自己被挪了的带着的道具（记完撤销以后看它们有没有被拉回手上，见 edited） */
let ledJust: string[] = [];
/** 存档的时候当前角色的身体还没照新的设定重建：带着的道具等重建完再写回清单 */
let settleDue = false;
/** 屏幕上的姿势（showPose 刚算的）、存着的姿势各是哪根骨骼在哪；别的角色的照它的设定记着 */
let liveFrame: { key: PoseState; solver: Solver; frame: Frame } | null = null;
let savedFrame: { key: Posing; solver: Solver; frame: Frame } | null = null;
/**
 * 屏幕上的姿势（poseState）是照哪一份存着的姿势来的。存着的那份换了（撤销、套了现成姿势）而屏幕上还没跟上的那一小会儿，
 * 带着的道具照存着的算，不照屏幕上那份过时的
 */
let posedFrom: Posing | null = null;
const otherFrames = new Map<string, { spec: BodySpec; solver: Solver; frame: Frame }>();
/** 上一回照哪份清单算出来的；屏幕上的道具是照哪一份摆的 */
let carriedView: { base: readonly SceneProp[]; out: readonly SceneProp[] } | null = null;
let carriedShown: readonly SceneProp[] | null = null;
/** 正在把带着的道具写回清单（里面又会存档：别绕回来） */
let settling = false;

function save() {
  scene = updateFigure(scene, scene.current, { spec, text });
  // 带着的道具：现在在哪写回清单（见 settleCarried）
  settleCarried();
  try {
    localStorage.setItem(STORE_KEY, serializeSpec(spec, text));
    localStorage.setItem(SCENE_KEY, serializeScene(scene, specData));
  } catch {
    // 无痕窗口等场景下存不了，不影响使用
  }
}

/** 存档、场景文件里一个角色的设定：和「保存配置」的文件一样的格式 */
const specData = (s: BodySpec, tx: string): object => JSON.parse(serializeSpec(s, tx)) as object;
/** 读场景里的一份设定（存档、场景文件）：整理好，描述照 restoredText 换成现在的语言 */
function readFigureSpec(raw: unknown): { spec: BodySpec; text: string } {
  const s = gate(normalizeSpec(raw));
  return { spec: s, text: restoredText((raw as { text?: unknown } | null)?.text, s) };
}

load();
/** 场景：当前角色就是上面读出来的那份（STORE_KEY 总是最新的），别的从 SCENE_KEY 读 */
let scene: Scene = singleScene(spec, text);
try {
  const raw = localStorage.getItem(SCENE_KEY);
  const stored = raw ? normalizeScene(JSON.parse(raw), readFigureSpec) : null;
  if (stored) scene = updateFigure(stored, stored.current, { spec, text });
} catch {
  // 读不出来就只有这一个角色
}

/* ---------------- 撤销 / 重做 ---------------- */

/** 能撤销的全部状态：设定和描述文字。两样都当作不可变的值，每次修改换新的 */
interface Snapshot {
  spec: BodySpec;
  text: string;
  /** 在场景里站在哪（好几个角色时，见 model/scene.ts） */
  place: Place;
  /** 和道具的连接（见 model/links.ts） */
  links: readonly PropLink[];
  /** 这一步是一键动作把道具拿到了身上（「拿着」「抱着」这类）：那几件道具原来在哪。撤销这一步时放回去（见 stepEdit） */
  picked?: Picked;
}
type Picked = Readonly<Record<string, { pos: Vec3; rot: Vec3 }>>;
/** 当前角色现在这一步记着的 picked：中途把这一步换掉（amend）时带着；记新的一步时换成 tookNext（一般是空的） */
let tookNow: Picked | undefined;
let tookNext: Picked | undefined;

const samePlace = (a: Place, b: Place) => a.x === b.x && a.z === b.z && a.yaw === b.yaw && placeY(a) === placeY(b);
const HISTORY_OPTIONS = {
  equals: (a: Snapshot, b: Snapshot) =>
    a.text === b.text && samePlace(a.place, b.place) && sameLinks(a.links, b.links) && JSON.stringify(a.spec) === JSON.stringify(b.spec),
};
/** 场景里一个角色现在的样子（别人的撤销历史里记的就是这个） */
const snapOf = (f: SceneFigure): Snapshot => ({ spec: f.spec, text: f.text, place: f.place, links: f.links ?? [] });
/** 当前角色现在的样子：设定、文字是界面上的，摆放和连接是场景里记着的 */
const snapNow = (): Snapshot => ({ spec, text, place: currentOf(scene).place, links: currentOf(scene).links ?? [], ...(tookNow ? { picked: tookNow } : {}) });
/** 别的角色的历史里现在这一步换成它现在的样子（那一步记着的 picked 留着） */
const amendOf = (h: History<Snapshot> | undefined, f: SceneFigure) => h?.amend({ ...snapOf(f), ...(h.current.picked ? { picked: h.current.picked } : {}) });
/** 当前角色的撤销历史。场景里每个角色各有一份：切走时存在 histories 里，切回来接着用 */
let history = new History<Snapshot>(snapNow(), HISTORY_OPTIONS);
const histories = new Map<string, History<Snapshot>>();

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
  const steps = history.steps;
  const was = tookNow;
  tookNow = tookNext;
  tookNext = undefined;
  history.push(snapNow(), key);
  if (history.steps > steps) noteEdit('figure');
  else if (!tookNow && was) {
    // 没记成新的一步（并进了上一步，或者没变）：还是原来那一步，它记着的 picked 留着
    tookNow = was;
    history.amend(snapNow());
  }
  // 只认操纵杆自己的改动：万一没收到松手，别的改动（滑块、撤销）照常存档、刷新
  if (tweaking && key?.startsWith('gizmo:')) {
    // 拖操纵杆只改了微调：面板上别的都没变，微调那几格数字在重建以后跟着同步（见 syncTweak）
    syncUndo();
    scheduleRebuild();
    return;
  }
  if (sliding && key === `shape:${sliding}`) {
    syncUndo();
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
  tookNow = snapshot.picked;
  spec = gate(snapshot.spec);
  readText(snapshot.text);
  const linked = !sameLinks(snapshot.links, currentOf(scene).links);
  if (linked) scene = updateFigure(scene, scene.current, { links: snapshot.links });
  if (!samePlace(snapshot.place, currentOf(scene).place)) movePlace(scene.current, snapshot.place);
  desc.value = text;
  save();
  render();
  // 连着道具的：道具现在在哪就跟到哪（照先后顺序撤的话本来就对得上，这里只是兜底）
  followCurrent(false);
  if (linked) propsPanel.refresh();
}

/**
 * 角色和道具各有各的撤销历史（道具的见 view/propsPanel.ts）。这里记着每一步动的是哪一边，
 * 撤销、重做照先后顺序来：先挪椅子、再摆姿势、又挪椅子，撤三次就是椅子、姿势、椅子
 */
type EditSide = 'figure' | 'props';
const editOrder: EditSide[] = [];
const redoOrder: EditSide[] = [];
/** 记了新的一步：排到最后；能重做的那几步作废 */
function noteEdit(side: EditSide) {
  editOrder.push(side);
  if (editOrder.length > 400) editOrder.shift();
  redoOrder.length = 0;
}
const canStep = (side: EditSide, back: boolean) =>
  side === 'figure' ? (back ? history.canUndo : history.canRedo) : back ? propsPanel.canUndo : propsPanel.canRedo;
/** 往回（或往前）走一步：照记下的先后挑是哪一边；那一边已经没得走了（换过角色、换过场景）就看下一个，都没有就哪边有走哪边 */
function stepEdit(back: boolean) {
  const from = back ? editOrder : redoOrder;
  let side = from.pop();
  while (side && !canStep(side, back)) side = from.pop();
  side ??= canStep('figure', back) ? 'figure' : 'props';
  if (!canStep(side, back)) return;
  if (side === 'figure' && back) {
    // 撤销的这一步把道具拿到了身上：道具放回原来的地方
    const left = history.current.picked;
    restore(history.undo());
    if (left) putBack(left);
  } else if (side === 'figure') {
    const next = history.redo();
    // 重做一步「拿起来」：道具这会儿在哪，就是再撤销这一步时要放回的地方
    if (next?.picked) history.amend({ ...next, picked: posesOf(Object.keys(next.picked)) });
    restore(history.current);
  } else if (back) propsPanel.undo();
  else propsPanel.redo();
  (back ? redoOrder : editOrder).push(side);
  syncUndo();
}
const undo = () => stepEdit(true);
const redo = () => stepEdit(false);
/** 撤销、重做两个按钮：角色的、道具的哪一边有得撤都亮着 */
function syncUndo() {
  btnUndo.disabled = !(history.canUndo || propsPanel.canUndo);
  btnRedo.disabled = !(history.canRedo || propsPanel.canRedo);
}

/** 用户改了文字：重新解析，文字本身不动 */
function fromText(value: string) {
  spec = applyParse(spec, readText(value));
  commit('text');
}

/** 用户改了部件数量或排布：把描述重写成规范中文 */
function fromParams(next: BodySpec) {
  // 「楚云萱」的体块：套完没手动动过的话，头、手臂的数量变了照新的重新摆（见 model/chu.ts 的 chuRefit）
  spec = chuRefit(spec, next);
  readText(describeSpec(spec));
  desc.value = text;
  commit();
}

/** 用户拖了体型滑块：描述里不写体型，文字不动 */
function fromShape(key: ShapeDef['key'], value: number) {
  // 「楚云萱」的体块是照体型量着摆的：套完没手动动过的话，照新的体型重新摆（见 model/chu.ts 的 chuRefit）
  spec = chuRefit(spec, { ...spec, shape: clampShape({ ...spec.shape, [key]: value }) });
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
    const apply = () => {
      refitNext = true;
      fromParams(applyPreset(spec, preset));
    };
    // 「楚云萱」是量着素体的身体拼出来的：刚切到二次元素体、数据还在路上时等它到了再套，不然套出来的是旧的那一套
    if (preset.build && spec.bodyStyle === 'anime' && !animeReady()) {
      setStatus(t('正在载入二次元素体…'));
      loadAnimeBody(import.meta.env.BASE_URL).then(giveShapes, () => {}).then(apply);
    } else apply();
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
  // 两列小格子里单位（对、条、只 / 每个头）放不下、不显示：鼠标停上去能看到
  label.title = hint ?? `${d.label} · ${d.unit}`;
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
  // 往哪放（index.html 里的 data-count）：卡片标题上的只放加减号，名字和单位写在卡片的标题按钮上；别的是卡片里的一行
  const host = document.querySelector<HTMLElement>(`[data-count~="${d.key}"]`)!;
  const card = host.classList.contains('part-count') ? host.closest<HTMLElement>('.part') : null;
  if (card) {
    const fold = card.querySelector<HTMLElement>('.part-fold')!;
    fold.title = label.title;
    fold.append(el('span', 'part-name', d.label), el('small', 'part-unit', d.unit), el('small', 'part-sum'));
    row.append(stepper);
  } else row.append(label, stepper);
  host.append(row);
  return () => {
    const v = value();
    out.textContent = String(v);
    // 全部一样时有上半身单独设过这一样：数后面加个星号
    const mixed = perTorso && !side() && torsoSides(spec.counts.torsos).some((s) => countsOf(spec, s)[d.key] !== spec.counts[d.key]);
    out.classList.toggle('mixed', mixed);
    out.title = mixed ? t('有的上半身单独设过；在「全部一样」下加减会把它们都改成一样') : '';
    row.classList.toggle('per-torso', !!side());
    card?.classList.toggle('per-torso', !!side());
    minus.disabled = v <= d.min;
    plus.disabled = v >= d.max;
  };
});

/** 几个上半身里这一样最多的那个有几个（每个上半身单独设的也算）：卡片里「两个以上才有」的选项看它 */
const most = (key: PerTorsoKey) => Math.max(spec.counts[key], ...torsoSides(spec.counts.torsos).map((side) => countsOf(spec, side)[key]));

/**
 * 「部件」栏的卡片：点标题收起、展开，开合记在浏览器里（没记过的：电脑上都展开，手机竖屏都收着）。
 * 收起时标题下面一行小字写现在选的；里面一样东西都没有的（没有尾巴、翅膀）不给展开
 */
const CARDS_KEY = 'oc-basemesh-cards';
const partCards = [...document.querySelectorAll<HTMLElement>('#counts .part')];
const cardsOpen: Record<string, boolean> = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(CARDS_KEY) ?? 'null');
    return saved && typeof saved === 'object' ? (saved as Record<string, boolean>) : {};
  } catch {
    return {};
  }
})();
const cardOpen = (card: HTMLElement) => cardsOpen[card.dataset.part!] ?? !window.matchMedia(PHONE_QUERY).matches;
for (const card of partCards) {
  card.querySelector('.part-fold')!.addEventListener('click', () => {
    if (card.classList.contains('empty')) return;
    cardsOpen[card.dataset.part!] = !cardOpen(card);
    try {
      localStorage.setItem(CARDS_KEY, JSON.stringify(cardsOpen));
    } catch {
      // 记不住就下次照缺省的开合
    }
    syncCards();
  });
}
/** 每张卡片收起时那一行小字：现在选的排法、样式 */
const CARD_SUMMARY: Record<string, () => (string | false)[]> = {
  head: () => [
    most('heads') > 1 && HEAD_LABEL[spec.headLayout],
    `${COUNT_DEF_BY_KEY.eyesPerHead.label} ${spec.counts.eyesPerHead}`,
    spec.counts.hornsPerHead > 0 && `${COUNT_DEF_BY_KEY.hornsPerHead.label} ${spec.counts.hornsPerHead}`,
    most('earPairsPerHead') > 0 && EAR_NAME[spec.earShape],
  ],
  arm: () => [
    most('armPairs') > 1 && ARM_LABEL[spec.armLayout],
    spec.counts.armPairs > 0 && spec.bodyStyle === 'mannequin' && HAND_LABEL[spec.hands],
    spec.counts.armPairs > 0 && spec.armEnd !== 'hand' && LIMB_END_LABEL[spec.armEnd],
  ],
  chest: () => [most('breasts') > 1 && !ringActive(spec) && t('每排 {n} 个', { n: spec.chestRow })],
  leg: () => [spec.counts.legs > 2 && !ringActive(spec) && LEG_LABEL[spec.legLayout], humanLegs() && spec.legEnd !== 'foot' && LIMB_END_LABEL[spec.legEnd]],
  tail: () => [],
  wing: () => [],
  penis: () => [spec.counts.penises > 0 && PENIS_STATE_LABEL[spec.penisSoft ? 'soft' : 'hard'], spec.counts.penises > 1 && PENIS_LABEL[spec.penisLayout]],
};
function syncCards() {
  /** 手机竖屏收着的卡片两个一排：这一排左边已经放了一张收着的（右边还空着） */
  let left: HTMLElement | null = null;
  for (const card of partCards) {
    const body = card.querySelector<HTMLElement>('.part-body')!;
    // 说明那几段不算内容（平时收着）
    const empty = ![...body.children].some((child) => !(child as HTMLElement).hidden && !child.classList.contains('note') && child.childElementCount > 0 && [...child.children].some((c) => !(c as HTMLElement).hidden));
    const open = !empty && cardOpen(card);
    card.classList.toggle('empty', empty);
    card.classList.toggle('open', open);
    card.querySelector('.part-fold')!.setAttribute('aria-expanded', String(open));
    card.querySelector('.part-sum')!.textContent = open ? '' : CARD_SUMMARY[card.dataset.part!]().filter(Boolean).join(' · ');
    // 点开的卡片占一整行：它前面那张要是单独在左边，也拉成一整行，免得右边空一格（样式只在手机竖屏用得上）
    card.classList.remove('lone');
    if (card.hidden) continue;
    if (open) {
      left?.classList.add('lone');
      left = null;
    } else left = left ? null : card;
  }
}

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
  // 场景里别的角色：照开关重算（设定里的原样留着）
  void bakeOthers();
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
  $('adultPart').hidden = !adultShown();
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

/** 胸每排几个：有两个以上的胸才显示（某个上半身单独设的也算）；围成一圈时胸还是一对一对的，不显示 */
const syncChestRow = (() => {
  const minus = el('button', '', '−');
  const plus = el('button', '', '+');
  const out = el('output');
  minus.type = plus.type = 'button';
  minus.setAttribute('aria-label', t('每排少一个胸'));
  plus.setAttribute('aria-label', t('每排多一个胸'));
  const step = (delta: number) => () => fromParams({ ...spec, chestRow: clampChestRow(spec.chestRow + delta) });
  minus.addEventListener('click', step(-1));
  plus.addEventListener('click', step(1));
  $('chestRow').append(minus, out, plus);
  return () => {
    const most = Math.max(spec.counts.breasts, ...torsoSides(spec.counts.torsos).map((side) => countsOf(spec, side).breasts));
    $('chestRowField').hidden = most < 2 || ringActive(spec);
    const rows = chestPlan(spec.counts.breasts, spec.chestRow);
    out.textContent = t('{n}（{rows} 排）', { n: spec.chestRow, rows: rows.length });
    minus.disabled = spec.chestRow <= CHEST_ROW.min;
    plus.disabled = spec.chestRow >= CHEST_ROW.max;
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
    $('hipLegsField').hidden = !perHip(spec.legLayout) || ringActive(spec);
    out.textContent = String(spec.hipLegs);
    minus.disabled = spec.hipLegs <= HIP_LEGS.min;
    plus.disabled = spec.hipLegs >= HIP_LEGS.max;
  };
})();
/** 每只手几根手指（连拇指）：分指的手才有（白模人台选了分指、二次元素体），成品角色照她自己的手指复制、拿掉 */
const syncFingers = (() => {
  const minus = el('button', '', '−');
  const plus = el('button', '', '+');
  const out = el('output');
  minus.type = plus.type = 'button';
  minus.setAttribute('aria-label', t('每只手少一根手指'));
  plus.setAttribute('aria-label', t('每只手多一根手指'));
  const step = (delta: number) => () => {
    spec = { ...spec, fingers: clampFingers(spec.fingers + delta) };
    commit();
  };
  minus.addEventListener('click', step(-1));
  plus.addEventListener('click', step(1));
  $('fingers').append(minus, out, plus);
  return () => {
    // 分指的手（二次元素体、白模选了分指）和成品角色自己的手
    const split = spec.bodyStyle !== 'mannequin' || spec.hands === 'fingers';
    // 手长在手臂末端，手脚互换时也可能长在腿末端
    const own = Object.values(spec.perLimb);
    const hands = (spec.counts.armPairs > 0 && spec.armEnd === 'hand') || (humanLegs() && spec.legEnd === 'hand') || own.some((l) => l.end === 'hand');
    $('fingersField').hidden = !split || !hands;
    out.textContent = String(spec.fingers);
    minus.disabled = spec.fingers <= FINGERS.min;
    plus.disabled = spec.fingers >= FINGERS.max;
  };
})();
/** 每只脚几个脚趾：只有二次元素体的脚有脚趾（白模人台的脚是一整块，成品角色的脚是角色自己的） */
const syncToes = (() => {
  const minus = el('button', '', '−');
  const plus = el('button', '', '+');
  const out = el('output');
  minus.type = plus.type = 'button';
  minus.setAttribute('aria-label', t('每只脚少一个脚趾'));
  plus.setAttribute('aria-label', t('每只脚多一个脚趾'));
  const step = (delta: number) => () => {
    spec = { ...spec, toes: clampToes(spec.toes + delta) };
    commit();
  };
  minus.addEventListener('click', step(-1));
  plus.addEventListener('click', step(1));
  $('toes').append(minus, out, plus);
  return () => {
    // 脚长在腿末端，手脚互换时也可能长在手臂末端
    const feet = (humanLegs() && spec.legEnd === 'foot') || (spec.counts.armPairs > 0 && spec.armEnd === 'foot') || Object.values(spec.perLimb).some((l) => l.end === 'foot');
    $('toesField').hidden = spec.bodyStyle !== 'anime' || !feet;
    out.textContent = String(spec.toes);
    minus.disabled = spec.toes <= TOES.min;
    plus.disabled = spec.toes >= TOES.max;
  };
})();
const syncEar = buildSeg($('segEar'), EAR_SHAPES, (v) => EAR_NAME[v], (earShape) =>
  fromParams({ ...spec, earShape }),
);

const syncBody = buildSeg($('segBody'), BODY_STYLES, (v) => BODY_LABEL[v], (bodyStyle) => {
  // 「楚云萱」各种身体样式拼法不一样：还是刚套上去的原样的话，换了样式照新的样式重新套一遍（见 presets.ts 的 styledPreset）
  const again = styledPreset(spec);
  refitNext = true;
  if (again && !(bodyStyle === 'anime' && !animeReady())) {
    fromParams(applyPreset({ ...spec, bodyStyle }, again));
    return;
  }
  spec = { ...spec, bodyStyle };
  commit();
  // 素体的数据还在路上：先照旧的显示，等它到了再套（这中间又改了别的就不套了）
  if (again) {
    const shown = spec;
    loadAnimeBody(import.meta.env.BASE_URL)
      .then(giveShapes, () => {})
      .then(() => {
        if (spec !== shown || !animeReady()) return;
        refitNext = true;
        fromParams(applyPreset(spec, again));
      });
  }
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
/**
 * 好几个上半身时每个上半身用哪个角色（BodySpec.torsoCharacters）：一个上半身一个下拉框，
 * 选「跟身子一样」就是不单独设
 */
const torsoCharPicks = new Map<TorsoSide, HTMLSelectElement>();
for (const side of ['L', 'M', 'R'] as const) {
  const label = el('label', 'torso-char');
  const pick = el('select');
  pick.setAttribute('aria-label', t('{side}边的上半身用哪个角色', { side: t(TORSO_EDIT_LABEL[side]) }));
  pick.append(new Option(t('跟身子一样'), ''), ...ROSTER.map((entry) => new Option(entry.label, entry.id)));
  pick.addEventListener('change', () => {
    const next = { ...spec.torsoCharacters };
    if (pick.value) next[side] = pick.value as CharacterId;
    else delete next[side];
    spec = { ...spec, torsoCharacters: next };
    commit();
  });
  label.append(el('span', '', t(TORSO_EDIT_LABEL[side])), pick);
  torsoCharPicks.set(side, pick);
  $('torsoChars').append(label);
}
function syncTorsoCharacters() {
  const sides = torsoSides(spec.counts.torsos);
  $('torsoCharRow').hidden = spec.bodyStyle !== 'character' || sides.length < 2;
  for (const [side, pick] of torsoCharPicks) {
    pick.parentElement!.hidden = !sides.includes(side);
    const id = spec.torsoCharacters?.[side];
    pick.value = id && id !== spec.character ? id : '';
  }
}
/** 上次存在这台设备上的那个 VRM：选到成品角色时才去读（文件不小） */
let ownRestored = false;
function syncCharacter() {
  const on = spec.bodyStyle === 'character';
  $('characterRow').hidden = $('characterNote').hidden = !on;
  syncTorsoCharacters();
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

/** queen conjoined 连体：不连 / 同向 / 反向（见 geometry/conjoined.ts） */
const CONJOIN_LABEL: Record<ConjoinMode, string> = { none: t('不连'), same: t('同向'), opposite: t('反向') };
const syncConjoin = buildSeg($('segConjoin'), CONJOINS, (v) => CONJOIN_LABEL[v], (conjoined) => {
  spec = { ...spec, conjoined };
  commit();
});

/** 围成一圈：不围 / 各有各的胯 / 并胯融合（见 geometry/ring.ts） */
const RING_LABEL: Record<RingMode, string> = { none: t('不围'), hips: t('各有各的胯'), fused: t('并胯融合'), rows: t('前后排') };
const syncRing = buildSeg($('segRing'), RINGS, (v) => RING_LABEL[v], (ring) => {
  spec = { ...spec, ring };
  commit();
});
// 「不连」「不围」由上面的四选一管，这两排里不出
for (const id of ['segConjoin', 'segRing']) $(id).querySelector<HTMLElement>('input[value="none"]')!.parentElement!.hidden = true;

/**
 * 形态：整个身体是哪一种——普通、多个上半身、连体、围成一圈，四选一。
 * 只是界面上的说法：存进配置的还是上半身个数、连体、围成一圈那三项，谁压过谁照旧（连体压过围成一圈，围成一圈压过几个上半身）。
 * 选一种就是把另外两项设回「没有」；每种切走以前选的是什么记在这一页里，切回来还在
 */
const FORMS = ['normal', 'torsos', 'conjoined', 'ring'] as const;
type Form = (typeof FORMS)[number];
const FORM_LABEL: Record<Form, string> = { normal: t('普通@@形态'), torsos: t('多个上半身@@形态'), conjoined: t('连体@@形态'), ring: t('围成一圈@@形态') };
const formOf = (s: BodySpec): Form => (s.conjoined !== 'none' ? 'conjoined' : ringActive(s) ? 'ring' : s.counts.torsos > 1 ? 'torsos' : 'normal');
const formKept: { torsos: number; conjoined: ConjoinMode; ring: RingMode } = { torsos: 2, conjoined: 'same', ring: 'hips' };
const syncForm = buildSeg($('segForm'), FORMS, (v) => FORM_LABEL[v], (form) => {
  if (form === formOf(spec)) return;
  if (spec.counts.torsos > 1) formKept.torsos = spec.counts.torsos;
  if (spec.conjoined !== 'none') formKept.conjoined = spec.conjoined;
  if (spec.ring !== 'none') formKept.ring = spec.ring;
  const torsos = form === 'torsos' ? formKept.torsos : 1;
  const next: BodySpec = {
    ...spec,
    conjoined: form === 'conjoined' ? formKept.conjoined : 'none',
    ring: form === 'ring' ? formKept.ring : 'none',
    counts: { ...spec.counts, torsos },
  };
  refitNext = true;
  // 上半身个数写在描述里：变了就把描述重写成规范写法；连体、围成一圈描述里不写，文字不动
  if (torsos !== spec.counts.torsos) fromParams(next);
  else {
    spec = next;
    commit();
  }
});
const RING_CHEST_LABEL: Record<RingChestMode, string> = { stagger: t('交错成串'), taper: t('交错渐小'), aligned: t('上下对齐') };
/** 圈的松紧：界面上按百分之几显示（100% 是所有的腿隔得一样远） */
const ringSpreadInput = $<HTMLInputElement>('s-ringSpread');
ringSpreadInput.min = String(RING_SPREAD.min * 100);
ringSpreadInput.max = String(RING_SPREAD.max * 100);
ringSpreadInput.step = String(RING_SPREAD.step * 100);
ringSpreadInput.addEventListener('input', () => {
  spec = { ...spec, ringSpread: clampRingSpread(Number(ringSpreadInput.value) / 100) };
  commit('ringSpread');
});
ringSpreadInput.addEventListener('change', () => history.seal());
function syncRingSpread(value: number, enabled: boolean, rows: boolean) {
  // 前后排能挤到 RING_SPREAD.min；围成一圈的到 RING_SPREAD_CIRCLE_MIN 为止（存着更小的数也照它摆）
  const least = rows ? RING_SPREAD.min : RING_SPREAD_CIRCLE_MIN;
  ringSpreadInput.min = String(least * 100);
  const percent = Math.round(Math.max(least, value) * 100);
  if (Math.abs(Number(ringSpreadInput.value) - percent) > 1e-6) ringSpreadInput.value = String(percent);
  ringSpreadInput.disabled = !enabled;
  $('o-ringSpread').textContent = `${percent}%`;
}
const RING_LEGS_LABEL: Record<RingLegMode, string> = { fill: t('中间也有'), rim: t('只在外圈') };
const syncRingLegs = buildSeg($('segRingLegs'), RING_LEGS, (v) => RING_LEGS_LABEL[v], (ringLegs) => {
  spec = { ...spec, ringLegs };
  commit();
});
const RING_LEG_FACING_LABEL: Record<RingLegFacingMode, string> = { out: t('绕圈朝外'), front: t('统一朝前') };
const syncRingLegFacing = buildSeg($('segRingLegFacing'), RING_LEG_FACINGS, (v) => RING_LEG_FACING_LABEL[v], (ringLegFacing) => {
  spec = { ...spec, ringLegFacing };
  commit();
});
const syncRingChest = buildSeg($('segRingChest'), RING_CHESTS, (v) => RING_CHEST_LABEL[v], (ringChest) => {
  spec = { ...spec, ringChest };
  commit();
});
/** 前后排：胯几排、每排几个胯（0 是自动，跟着这一排的人数） */
const RING_HIP_ROW_CHOICES = Array.from({ length: RING_HIP_ROWS.max - RING_HIP_ROWS.min + 1 }, (_, i) => String(RING_HIP_ROWS.min + i));
const syncRingHipRows = buildSeg($('segRingHipRows'), RING_HIP_ROW_CHOICES, (v) => v, (n) => {
  spec = { ...spec, ringHipRows: Number(n) };
  commit();
});
const RING_HIPS_PER_ROW_CHOICES = Array.from({ length: RING_HIPS_PER_ROW.max - RING_HIPS_PER_ROW.min + 1 }, (_, i) => String(RING_HIPS_PER_ROW.min + i));
const syncRingHipsPerRow = buildSeg($('segRingHipsPerRow'), RING_HIPS_PER_ROW_CHOICES, (v) => (v === '0' ? t('自动') : v), (n) => {
  spec = { ...spec, ringHipsPerRow: Number(n) };
  commit();
});
const RING_COUNTS = Array.from({ length: RING_COUNT.max - RING_COUNT.min + 1 }, (_, i) => String(RING_COUNT.min + i));
const syncRingCount = buildSeg($('segRingCount'), RING_COUNTS, (v) => v, (n) => {
  spec = { ...spec, ringCount: Number(n) };
  commit();
});

const CONJOIN_POSE_LABEL: Record<ConjoinPose, string> = { prone: t('趴着'), lie: t('侧躺'), flat: t('平躺'), stand: t('站着') };
const syncConjoinPose = buildSeg($('segConjoinPose'), CONJOIN_POSES, (v) => CONJOIN_POSE_LABEL[v], (conjoinPose) => {
  spec = { ...spec, conjoinPose };
  commit();
});

/** 手脚互换：手臂末端接手还是脚、腿末端接脚还是手（腿的那一栏脚排在前面） */
const LIMB_END_LABEL: Record<LimbEnd, string> = { hand: t('手'), foot: t('脚') };
const syncArmEnd = buildSeg($('segArmEnd'), LIMB_ENDS, (v) => LIMB_END_LABEL[v], (armEnd) => {
  spec = { ...spec, armEnd };
  commit();
});
const syncLegEnd = buildSeg($('segLegEnd'), ['foot', 'hand'] as const, (v) => LIMB_END_LABEL[v], (legEnd) => {
  spec = { ...spec, legEnd };
  commit();
});
/** 有没有人腿（人马、蛛形的兽腿不接手） */
const humanLegs = () => spec.conjoined === 'none' && spec.counts.legs > 0 && !['taur', 'spider'].includes(legPlan(spec).form);

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

/**
 * 一个体型滑块。只管一个部件的那几个（胸部大小、手臂长短、腿长短、尾巴、阴茎）摆两处：「体型」里一份，
 * 它那个部件的卡片里一份（index.html 里的 data-shape，id 带 -part），两份拖哪个都一样
 */
function shapeSlider(d: ShapeDef, host: HTMLElement, id: string, inCard: boolean) {
  const row = el('div', 'slider');
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
  host.append(row);
  return () => {
    const v = spec.shape[d.key];
    if (Number(input.value) !== v) input.value = String(v);
    out.textContent = shapeText(d, v);
    const fixed = FIXED_SHAPES[spec.bodyStyle].has(d.key);
    input.disabled = fixed;
    row.classList.toggle('off', fixed);
    if (d.key === 'penisSize') row.hidden = !adultShown() || spec.counts.penises === 0;
    if (!inCard) return;
    // 卡片里的那一份：没有这个部件就不出
    if (d.key === 'tailFluff' || d.key === 'tailLength') row.hidden = spec.counts.tails === 0;
    if (d.key === 'armLength') row.hidden = most('armPairs') === 0;
  };
}
const sliders = SHAPE_DEFS.flatMap((d) => {
  const main = document.querySelector<HTMLElement>(`[data-shape-main~="${d.key}"]`) ?? $('shapes');
  const card = document.querySelector<HTMLElement>(`[data-shape~="${d.key}"]`);
  return [shapeSlider(d, main, `s-${d.key}`, false), ...(card ? [shapeSlider(d, card, `s-${d.key}-part`, true)] : [])];
});
const btnUndo = $<HTMLButtonElement>('btnUndo');
const btnRedo = $<HTMLButtonElement>('btnRedo');
btnUndo.addEventListener('click', undo);
btnRedo.addEventListener('click', redo);

/**
 * 一键初始化：当前角色的设定（部件数量、体型、样式、微调、姿势……）和描述全部回到刚打开工坊时的样子（同 load() 没存档时），
 * 记成一步撤销，点「撤销」能改回来。场景里别的角色、站的位置、视角、语言主题这些不动
 */
$<HTMLButtonElement>('btnReset').addEventListener('click', async () => {
  if (!(await askConfirm(t('把这个角色的设定全部恢复成刚打开时的样子？点「撤销」能改回来。'), t('初始化')))) return;
  // 正拖着姿势时不动；描述框里还没解析的输入作废（不然 300 毫秒以后又照它改回去）
  if (poseHandles?.busy) return;
  clearTimeout(timer);
  select(null);
  selectJoint(null);
  torsoEdit = 'all';
  spec = applyParse(defaultSpec(), readText(START_TEXT));
  desc.value = text;
  refitNext = true;
  commit();
});

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

/* ---------------- AI 助手（默认关；打开后面板里多一栏。界面和 pi 在 src/ai/，打开了才载入） ---------------- */

/** AI 助手这一轮开始时撤销排到了第几步、这一轮一共记了几步（见 workshop.hold / release / undo） */
let aiFrom = 0;
let aiSteps = 0;
/** 角色、道具两条撤销历史现在各在哪一步，合成一个记号（两边都没动过就是同一个对象） */
const editMarks = new WeakMap<object, WeakMap<object, object>>();
function editMark(): object {
  const a = history.current as object;
  const b = propsPanel.stamp;
  let inner = editMarks.get(a);
  if (!inner) editMarks.set(a, (inner = new WeakMap()));
  let mark = inner.get(b);
  if (!mark) inner.set(b, (mark = {}));
  return mark;
}
/** 一件道具写给 AI 助手看 */
const propInfo = (p: SceneProp): PropInfo => ({ id: p.id, name: propLabel(p), kind: p.kind === 'asset' ? (p.asset ?? '') : p.kind, size: p.size, pos: p.pos, rot: p.rot, color: p.color });

/** AI 助手改设定只走这里（见 ai/workshop.ts）：和人点面板一样记撤销、存档、刷新 */
const workshop: WorkshopApi = {
  spec: () => spec,
  apply(next, key) {
    spec = next;
    readText(describeSpec(spec));
    desc.value = text;
    commit(key);
    return spec;
  },
  adultOn,
  hold(key) {
    history.hold(key);
    aiFrom = editOrder.length;
    aiSteps = 0;
  },
  release() {
    history.release();
    // 这一轮记了几步撤销（改造型的并成一步；放道具、挪道具、一键动作各算各的）：「撤回这一轮」要撤这么多步
    aiSteps = Math.max(0, editOrder.length - aiFrom);
  },
  mark: () => editMark(),
  undo() {
    const steps = Math.max(1, aiSteps);
    aiSteps = 0;
    for (let i = 0; i < steps; i++) undo();
  },
  scene: {
    props: () => propsNow().map(propInfo),
    kinds: () => [
      ...PROP_KINDS.map((kind) => ({ kind, name: PROP_LABEL[kind], size: PROP_SIZE[kind] })),
      ...PROP_ASSETS.map((a) => ({ kind: a.id, name: propAssetLabel(a.id) || a.id, size: a.size })),
      ...REAL_ASSETS.map((a) => ({ kind: a.id, name: propAssetLabel(a.id) || a.id, size: a.size, real: true as const })),
      // 用户自己导入的（「我的」）
      ...userAssets().map((a) => ({ kind: a.id, name: a.name, size: a.size, mine: true as const })),
    ],
    figure() {
      const me = currentOf(scene);
      return { name: figureLabel(me), x: me.place.x, z: me.place.z, yaw: me.place.yaw, y: placeY(me.place) };
    },
    add: async (kind, change) => propInfo(await propsPanel.create(kind, change)),
    change(id, change) {
      const { lift: _lift, ...patch } = change;
      const next = propsPanel.change(id, patch);
      if (!next) throw new Error(t('场景里没有这件道具'));
      return propInfo(next);
    },
    remove(id) {
      if (!propsPanel.discard(id)) throw new Error(t('场景里没有这件道具'));
    },
    actions: (id) => propActionList(id).map((a) => ({ key: a.key, label: a.label, block: a.block })),
    act(id, action) {
      const got = applyPropAction(id, action as PropAction);
      if (!got.ok) throw new Error(got.text);
      return got.text;
    },
    limbs: () => grabParts(),
    attached: () =>
      (currentOf(scene).links ?? []).map((l) => {
        const way = gripWayNow(l.part);
        return { part: l.part, label: linkPartLabel(l.part), prop: l.prop, mode: l.part === BODY_LINK ? ('rides' as const) : l.carry ? ('carries' as const) : ('holds' as const), ...(way ? { way } : {}) };
      }),
    grab(part, id, carry) {
      if (!propOf(propsNow(), id)) throw new Error(t('场景里没有这件道具'));
      const got = applyGrab(part, id, carry);
      if (!got.ok) throw new Error(got.text);
      return got.text;
    },
    release(part) {
      const me = currentOf(scene);
      if (!linkOf(me.links, part)) throw new Error(t('这里没有抓着、带着道具'));
      unlinkPart(me.id, part);
      return $('status').textContent ?? '';
    },
    setCarry(part, on) {
      const got = applyCarry(part, on);
      if (!got.ok) throw new Error(got.text);
      return got.text;
    },
    gripWay(part, way) {
      const got = applyGripWay(part, way);
      if (!got.ok) throw new Error(got.text);
      return got.text;
    },
  },
  stage: () => document.getElementById('stage'),
  pickAt(x, y) {
    if (!viewport) return null;
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(x * 2 - 1, -(y * 2 - 1)), viewport.camera);
    return pickPart(ray);
  },
  snapshot: () => (viewport ? viewport.snapshot() : Promise.reject(new Error(t('3D 视图现在没有显示出来')))),
  viewSide() {
    if (!viewport) return 'front';
    // 镜头在角色的哪边（角色面朝 +Z，+X 是她自己的左手边）
    const d = viewport.camera.position.clone().sub(viewport.controls.target).normalize();
    if (d.y > 0.8) return 'top';
    if (d.y < -0.8) return 'bottom';
    const turn = (Math.atan2(d.x, d.z) * 180) / Math.PI;
    if (Math.abs(turn) <= 25) return 'front';
    if (Math.abs(turn) >= 155) return 'back';
    if (turn >= 65 && turn <= 115) return 'left';
    if (turn <= -65 && turn >= -115) return 'right';
    return 'angled';
  },
  parts: () => tweakable().map((p) => p.name),
};

const aiBox = $<HTMLInputElement>('aiOn');
const btnAi = $<HTMLButtonElement>('btnAi');
let aiLoading: Promise<AiDock | null> | null = null;

/** 载入 AI 窗口（连带 pi）：第一次点开时才下载 */
function loadAi(): Promise<AiDock | null> {
  aiLoading ??= import('./ai/dock')
    .then((m) => {
      aiDock = m.mountDock($('aiDock'), workshop, {
        toggled: (open) => {
          btnAi.setAttribute('aria-pressed', String(open));
          document.querySelector('.app')?.classList.toggle('ai-open', open);
        },
      });
      return aiDock;
    })
    .catch((err: unknown) => {
      aiLoading = null;
      setStatus(t('AI 助手载入失败：{message}', { message: errText(err) }), true);
      return null;
    });
  return aiLoading;
}

/** 开关关着：顶上的按钮和窗口都藏起来 */
function syncAi() {
  const on = aiOn();
  aiBox.checked = on;
  btnAi.hidden = !on;
  // 关掉开关：正在干活的那一轮也停下，不在看不见的地方接着改、接着花钱
  if (!on) {
    aiDock?.stop();
    aiDock?.close();
  }
}

btnAi.addEventListener('click', async () => (await loadAi())?.toggle());
aiBox.addEventListener('change', async () => {
  setAiOn(aiBox.checked);
  syncAi();
  if (aiBox.checked) (await loadAi())?.open();
});
syncAi();

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
/** 接口的小圆点：挑「接到哪」的时候、勾着「吸到接口上」拖着部件的时候显示（见 syncSockets） */
const socketDots = new SocketOverlay();
let showBones = false;
let viewport: Viewport | null = null;
/** 点选、选中高亮和操纵杆 */
let gizmo: Gizmo | null = null;
/** 分部件模式摆姿势时显示的那一组能弯的网格 */
const flatParts = new FlatParts();
/** 摆姿势时关节上的圆点和旋转环 */
let poseHandles: PoseHandles | null = null;
/** 场景里别的角色（定住的网格）和每个角色脚下的底座圈，见 view/sceneFigures.ts */
const sceneView = new SceneFigures();
/** 当前角色的那几个模型放在一组里：场景里刚切过来、网格还没算出来时整组先藏着（见 holdLive） */
const live = new Group();
live.add(model.root, fused.root, characterModel.root, flatParts.root);
try {
  viewport = new Viewport($('stage'));
  viewport.scene.add(live, sceneView.root);
  viewport.overlay.add(bones.root);
  viewport.overlay.add(socketDots.root);
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

/** 场景里的道具：3D 视图里的显示、选中、操纵杆，面板上「道具」那一节，道具自己的撤销（见 view/propsPanel.ts） */
const propsPanel = new PropsPanel({
  viewport,
  panel: $('propsPanel'),
  base: import.meta.env.BASE_URL,
  read: () => propsNow(),
  write: (next, dragging, restored) => {
    const had = scene.props.length > 0;
    const before = scene.props;
    // 带着的道具自己被挪了（操纵杆、改数、撤销）：这一下是手跟着它，不是它跟着手
    leadCarried(next);
    propWriting = true;
    try {
      scene = { ...scene, props: next };
      if (!restored) forgetLinks(before);
      followProps(dragging);
      if (!dragging) {
        ledJust = [...propLed];
        propLed.clear();
        save();
      }
    } finally {
      propWriting = false;
    }
    sceneBounds();
    scheduleSceneClash();
    // 有了第一件道具、最后一件没了：「看全部」那一行跟着出现、收起
    if (had !== next.length > 0) {
      syncScenePanel();
      renderPosePanel();
    }
  },
  here: () => currentOf(scene).place,
  picked: () => {
    select(null);
    selectJoint(null);
  },
  edited: (step) => {
    // 道具那一步记完了：手够不着、被拉回手上的那几件，照手现在在哪写回清单（并进刚记的这一步）
    const led = propOf(scene.props, ledJust[0] ?? null);
    ledJust = [];
    if (settleCarried() && led) {
      setStatus(t('「{name}」挪到了手够不着的地方：它回到手上了。要它留在那边，先去掉「道具跟着这只手」的勾（脚是「道具跟着这只脚」）。', { name: propLabel(led) }), true);
    }
    if (step) noteEdit('props');
    syncUndo();
  },
  status: (message, warn) => setStatus(message, warn),
  confirm: (message, ok) => askConfirm(message, ok),
  links: (prop) => linksTo(prop),
  unlink: (figure, part) => unlinkPart(figure, part),
  rideLabel: (prop) => (linkOf(myLinks(), BODY_LINK)?.prop === prop ? null : figureLabel(currentOf(scene))),
  ride: (prop) => rideProp(prop),
  hugLabel: (prop) => (hugging(prop) ? null : figureLabel(currentOf(scene))),
  hug: (prop) => hugProp(prop),
  actor: () => figureLabel(currentOf(scene)),
  actions: (prop) => propActionList(prop),
  act: (prop, key) => applyPropAction(prop, key as PropAction),
  reveal: () => reveal('scene'),
  refit: () => refitAll(),
  seg: buildSeg,
});

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
    if (changelog.close()) return true;
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
/** 场景里和别的角色穿插（见 checkSceneClash） */
let sceneClashNote = '';
/** 身体插进了哪件道具里（见 checkSceneClash） */
let propClashNote = '';
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
  for (const warning of [readout.warning, clashNote, sceneClashNote, propClashNote]) if (warning) items.push(el('span', 'warn', warning));
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

/** 当前角色自己的包围盒（场景里别的角色不算） */
const ownBox = new Box3();
/** 包围盒加上场景里别的角色、道具：阴影、取景照整个场景 */
const withScene = (box: Box3) => box.clone().union(sceneView.othersBox()).union(propsPanel.box());
/**
 * 阴影、取景的范围换成「当前角色加上场景里别人」。都还没有网格（刚打开、融合网格还在算）时不换：
 * 空的包围盒会让取景算出 NaN，镜头就再也框不回来了
 */
function sceneBounds(box: Box3 = ownBox) {
  const all = withScene(box);
  if (!all.isEmpty()) viewport?.setBounds(all);
}
function showBounds(box: Box3) {
  ownBox.copy(box);
  sceneView.setActiveBox(box);
  if (scene.figures.length > 1 || scene.props.length) scheduleSceneClash();
  sceneBounds(box);
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
  if (fused.caughtUp) releaseLive();
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

/**
 * 素体、头发、阴囊的数据交给网格线程：只交一次（当前角色和后台算场景里别的角色的都会取，见 loadAssetsFor）
 */
let shapesGiven = false;
const hairsGiven = new Set<HairShape>();
let genitalGiven = false;
function giveShapes(buffer: ArrayBuffer) {
  if (shapesGiven) return;
  shapesGiven = true;
  provideShapes(buffer);
}
function giveHair(style: HairShape, buffer: ArrayBuffer) {
  if (hairsGiven.has(style)) return;
  hairsGiven.add(style);
  provideHair(style, buffer);
}
function giveGenital(buffer: ArrayBuffer) {
  if (genitalGiven) return;
  genitalGiven = true;
  provideGenital(buffer);
}
let chuTorsoGiven = false;
function giveChuTorso(buffer: ArrayBuffer) {
  if (chuTorsoGiven) return;
  chuTorsoGiven = true;
  provideChuTorso(buffer);
}

function ensureAnimeBody() {
  if (animeLoading || animeReady()) return;
  animeLoading = true;
  setStatus(t('正在载入二次元素体…'));
  loadAnimeBody(import.meta.env.BASE_URL)
    .then((buffer) => {
      giveShapes(buffer);
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
/** 好几个上半身时换成了别的角色的那几个上半身用的角色（见 BodySpec.torsoCharacters），和身子的角色一样的不算 */
function torsoCharacterIds(): CharacterId[] {
  if (spec.bodyStyle !== 'character') return [];
  const ids = torsoSides(spec.counts.torsos).map((side) => spec.torsoCharacters?.[side]);
  return [...new Set(ids.filter((id): id is CharacterId => Boolean(id) && id !== spec.character))];
}
/** 拼这个成品角色用到的所有角色：身子的，加上换了角色的上半身的 */
const usedCharacters = (): CharacterChoice[] => [spec.character, ...torsoCharacterIds()];
// 读好的角色只留几个（见 character/load.ts）：后台算场景里别的角色时，当前角色用的那几个不放掉
keepCharacters(usedCharacters);
/** 用到的角色里许可要求署名的那几句 */
const usedCredits = () => usedCharacters().flatMap((id) => (id === OWN_CHARACTER ? [] : rosterEntry(id).credit ?? []));
function ensureCharacter() {
  for (const id of torsoCharacterIds()) ensureTorsoCharacter(id);
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
/** 某个上半身换成的角色：取回来之前那个上半身先照身子的角色拼 */
function ensureTorsoCharacter(id: CharacterId) {
  if (characterLoading.has(id) || characterSource(id)) return;
  characterLoading.add(id);
  const label = rosterEntry(id).label;
  setStatus(t('正在载入角色「{label}」（十来 MB，稍等）…', { label }));
  loadCharacter(id, import.meta.env.BASE_URL)
    .then(() => {
      if (!torsoCharacterIds().includes(id)) return;
      setStatus(t('角色「{label}」已载入', { label }));
      scheduleRebuild();
    })
    .catch((err: unknown) => {
      retryOnReturn = err instanceof OfflineError;
      setStatus(t('角色「{label}」没载入成功，那个上半身先照身子的角色拼：{err}', { label, err: errText(err) }), true);
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
const hairSources = () => [characterSource(spec.character), hairDonor(spec.hair.style)?.source ?? null, ...torsoCharacterIds().map(characterSource)];
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
      giveHair(style, buffer);
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

/** 「楚云萱躯干」的数据（6 MB）只有预设「楚云萱」用，用到时才取；取回来之前上半身还是九个胸腔各是各的（见 geometry/trunk.ts） */
let chuTorsoLoading = false;
function ensureChuTorso() {
  if (chuTorsoLoading || chuTorsoReady() || !wantsTrunk(spec)) return;
  chuTorsoLoading = true;
  loadChuTorso(import.meta.env.BASE_URL)
    .then((buffer) => {
      giveChuTorso(buffer);
      scheduleRebuild();
    })
    .catch((err: unknown) => {
      retryOnReturn = err instanceof OfflineError;
      setStatus(t('楚云萱躯干的数据没载入成功，上半身先照九块拼：{err}', { err: errText(err) }), true);
    })
    .finally(() => {
      chuTorsoLoading = false;
    });
}

/** 阴囊的数据（不到 0.5 MB）也是用到时才取，取回来之前先不长阴茎、阴囊（见 geometry/layout.ts） */
let genitalLoading = false;
function ensureGenital() {
  if (genitalLoading || genitalReady() || !spec.counts.penises) return;
  genitalLoading = true;
  loadGenital(import.meta.env.BASE_URL)
    .then((buffer) => {
      giveGenital(buffer);
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
      torsoCharacterIds().map((id) => Boolean(characterSource(id))),
    ]);
    if (characterBase?.key !== key || (characterBase.bust !== bust && sliding !== 'bust')) {
      characterBase = { key, bust, build: assembleCharacter(source, spec, donor, characterSource) };
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
    torsoCharacterIds().map((id) => Boolean(characterSource(id))),
    Boolean(hairDonor(style)),
    spec.bodyStyle === 'character' && hairSources().map((source) => Boolean(source && hairLit(source))),
    style === 'own' || hairReady(style),
    genitalReady(),
    chuTorsoReady(),
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
    // 身体变了（加了腿、没了手臂）：选中的道具上哪些一键动作能点跟着变
    propsPanel.syncActions();
  }
  if (mode === 'pose') syncPosing();
  // 身体变了（手臂长了、换了样式）：带着的道具跟到手现在的地方；存档那会儿身体还没重建的，现在补上
  showCarried();
  if (settleDue && settleCarried()) save();
}

function rebuildBody() {
  const t0 = performance.now();
  if (spec.bodyStyle === 'character') {
    labelSplitTorso(false);
    labelTrunk(false);
    ensureCharacter();
    ensureHair();
    ensureHairLight();
    if (showCharacter()) {
      syncTweak();
      syncBones();
      releaseLive();
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
  ensureChuTorso();
  figure = buildFigure(spec);
  labelSplitTorso(figure.parts.some((p) => p.name === RIBCAGE && p.parent === undefined));
  labelTrunk(figure.parts.some(isTrunkGhost));
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
    releaseLive();
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

/**
 * 选中的部件实例名。选中状态不进撤销历史，也不存档。
 * 多选时是操纵杆摆在上面、面板上显示数值的那一个（见 picks）
 */
let selected: string | null = null;
/** 选中的全部部件，照选的先后排；只选了一个时就是 [selected] */
let picks: string[] = [];
/** 「多选」开着：在模型上点部件是往选中的里加一个、再点去掉（电脑上按着 Ctrl 或 Shift 点也一样） */
let multiPick = false;
/** 刚复制出来的部件（见 btnTweakCopy）：等模型重建好、它们出现了再选中（见 syncTweak） */
let pendingPicks: string[] | null = null;
/** 正在等着点「接到哪个部件上」（见 btnTweakAttach）：要接的那几个部件；没在等是 null */
let attaching: string[] | null = null;
/** 上一次「接到…」没接上的原因，显示在面板的说明里，换了选中的部件就清掉 */
let attachNote = '';
/** 多选时一起转、一起缩放是不是像一整块（都绕操纵杆所在的那个部件）；不是的话各自绕自己的关节 */
let rigidGroup = false;
/** 接部件的时候吸到接口上（见 geometry/sockets.ts）：点「接到…」时点在接口附近、拖着松手时离接口很近，都吸过去 */
let snapSockets = true;
/** 上一次在模型上点中的地方（世界里的位置，米）；没点中是 null。「接到…」时照它找最近的接口 */
let pickPoint: V3 | null = null;
/** 多选时正拖着操纵杆：按下那一刻各个部件的微调和操作坐标，拖动中都从它算起 */
let dragFrom: Map<string, { override: PartOverride | undefined; frame: PartFrame }> | null = null;
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

/** 一个部件跟着哪个父部件动 */
function parentOfPart(name: string): string | undefined {
  return figure ? figure.parts.find((p) => p.name === name)?.parent : tweaked?.parents.get(name);
}

/** 一个部件的操作坐标：支点在哪、父部件朝哪 */
function frameOfPart(name: string): PartFrame | null {
  return figure ? partFrame(figure, name) : (tweaked?.frames.get(name) ?? null);
}

/** 多选时真正要改的那些：父部件也选中了的不算，它跟着父部件动（见 topMost） */
const tweakTargets = () => topMost(picks, parentOfPart);

/** 改这个部件时对侧要不要跟着镜像：对侧自己也选中了的话各改各的 */
function mirrorFor(name: string): boolean {
  const twin = mirror ? mirrorName(name) : null;
  if (twin === null || picks.includes(twin)) return false;
  // 对侧那个带着哪个要改的部件、或者跟着哪个要改的部件动：不镜像，不然那个部件动了两份（一份跟着父部件，一份自己的）
  return !tweakTargets().some((target) => isUnder(target, twin) || isUnder(twin, target));
}

/** name 是不是长在 ancestor 上（往上数任何一层） */
function isUnder(name: string, ancestor: string): boolean {
  for (let up = parentOfPart(name), guard = 0; up !== undefined && guard < 32; up = parentOfPart(up), guard++) if (up === ancestor) return true;
  return false;
}

/**
 * 改选中部件的微调。key 用来把连续的小改动并成一步撤销。
 * 多选时给 delta：别的选中部件各自照这同一份改动改（from 给了就从那时的微调算起，不给从现在的算起）。
 * 勾着「对称」时，和操纵杆所在的部件不在同一侧的照镜像改：左右两边的手臂都选中了，一起抬、一起张开，不是一边抬一边垂
 */
function applyTweak(patch: PartOverride, key?: string, delta?: TweakDelta, from?: typeof dragFrom) {
  if (!selected) return;
  spec = setOverride(spec, selected, patch, mirrorFor(selected));
  if (delta) {
    const side = mirror ? sideOf(selected) : null;
    const flipped = side ? mirrorDelta(delta) : delta;
    for (const name of tweakTargets()) {
      if (name === selected) continue;
      const base = from?.get(name);
      const frame = base?.frame ?? frameOfPart(name);
      if (!frame) continue;
      const other = side !== null && sideOf(name) !== null && sideOf(name) !== side;
      // 像一整块那样：别的部件除了自己转、缩放，还绕着操纵杆所在的那个部件的支点挪过去
      const anchor = rigidGroup ? (from?.get(selected)?.frame ?? frameOfPart(selected)) : null;
      const own = anchor ? rigidDelta(delta, anchor.pivot, frame.pivot) : other ? flipped : delta;
      spec = setOverride(spec, name, nudgeOverride(base ? base.override : activeOverrides(spec)[name], frame, own), mirrorFor(name));
    }
  }
  commit(key);
}

/** 操纵杆摆在哪个部件上：最后选的那个；它的父部件也选中了，就摆在父部件上（子部件跟着父部件动） */
function anchorOf(names: readonly string[]): string | null {
  let anchor = names[names.length - 1] ?? null;
  for (let up = anchor ? parentOfPart(anchor) : undefined, guard = 0; up !== undefined && guard < 32; up = parentOfPart(up), guard++) {
    if (names.includes(up)) anchor = up;
  }
  return anchor;
}

/** 换选中的部件（一个或好几个） */
function setPicks(next: string[]) {
  pendingPicks = null;
  attaching = null;
  attachNote = '';
  const anchor = anchorOf(next);
  if (anchor === selected && next.length === picks.length && next.every((n, i) => n === picks[i])) return;
  picks = next;
  selected = anchor;
  history.seal();
  syncTweak();
  focusPicked();
}

function select(name: string | null) {
  if (name) propsPanel.select(null);
  setPicks(name ? [name] : []);
}

/** 多选：没选中的加进来，已经选中的去掉 */
function togglePick(name: string) {
  propsPanel.select(null);
  setPicks(picks.includes(name) ? picks.filter((n) => n !== name) : [...picks, name]);
}

/** 在列表、小牌子上点了一个部件：开着「多选」是加一个、去一个，否则只选它 */
function pickPartName(name: string | null) {
  if (multiPick && name) togglePick(name);
  else select(name);
}

function setMultiPick(on: boolean) {
  multiPick = on;
  tweakMulti.checked = on;
  pickedMulti.setAttribute('aria-pressed', String(on));
}

/** 面板上改了一格数字，换成别的选中部件也照着改的那一份改动（世界坐标里的）。cur、next 是摆位用的单位、度、倍 */
function fieldDelta(key: TweakKey, cur: Vec3, next: Vec3): TweakDelta | undefined {
  const frame = selected && picks.length > 1 ? frameOfPart(selected) : null;
  if (!frame) return undefined;
  if (key === 'position') {
    const k = frame.parentScale;
    return { move: rotate(frame.parentQuat, [(next[0] - cur[0]) * k, (next[1] - cur[1]) * k, (next[2] - cur[2]) * k]) };
  }
  if (key === 'rotation') {
    const turn = (v: Vec3) => quatEuler((v[0] * Math.PI) / 180, (v[1] * Math.PI) / 180, (v[2] * Math.PI) / 180);
    return { turn: quatMul(quatMul(quatMul(frame.parentQuat, turn(next)), quatConj(turn(cur))), quatConj(frame.parentQuat)) };
  }
  return { ratio: [next[0] / cur[0], next[1] / cur[1], next[2] / cur[2]] };
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
tweakPart.addEventListener('change', () => {
  // 正等着点「接到哪个部件上」：在这里选也算
  if (attaching) {
    finishAttach(tweakPart.value || null);
    tweakPart.value = selected ?? '';
    return;
  }
  pickPartName(tweakPart.value || null);
  // 多选时下拉框回到操纵杆所在的那个部件上
  tweakPart.value = selected ?? '';
});
const tweakMulti = $<HTMLInputElement>('tweakMulti');
const pickedMulti = $<HTMLButtonElement>('pickedMulti');
tweakMulti.addEventListener('change', () => setMultiPick(tweakMulti.checked));
pickedMulti.addEventListener('click', () => setMultiPick(!multiPick));
/** 同类全选：和选中的这个同一类的部件（全部手臂、全部腿……）都选上；已经选中的别的类的留着 */
$('btnTweakKind').addEventListener('click', () => {
  const type = tweakable().find((p) => p.name === selected)?.type;
  if (!selected || !type) return;
  const kind = tweakable()
    .filter((p) => p.type === type && p.name !== selected)
    .map((p) => p.name);
  const rest = picks.filter((name) => name !== selected && !kind.includes(name));
  setPicks([...rest, ...kind, selected]);
});

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
      let cur = shownValues(field.key);
      let next: Vec3 = [cur[0], cur[1], cur[2]];
      next[axis] = v;
      if (field.key === 'scale' && lockRatio) {
        const k = v / cur[axis];
        next = [cur[0] * k, cur[1] * k, cur[2] * k];
      }
      if (field.key === 'position') {
        cur = [cur[0] / cmPerUnit, cur[1] / cmPerUnit, cur[2] / cmPerUnit];
        next = [next[0] / cmPerUnit, next[1] / cmPerUnit, next[2] / cmPerUnit];
      }
      applyTweak({ [field.key]: next }, `tweak:${selected}:${field.key}:${axis}`, fieldDelta(field.key, cur, next));
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

/* ---- 删除部件：记在微调里（PartOverride.hidden），套微调时从身上拿掉；成品角色不支持 ---- */
const btnTweakDelete = $<HTMLButtonElement>('btnTweakDelete');
/** 选中的里面能删的（躯干、下身、脖子不能删） */
const deletablePicks = (): string[] => (character ? [] : picks.filter((n) => tweakable().some((p) => p.name === n && (deletable(p.type) || isBlockRoot(spec, n)))));
btnTweakDelete.addEventListener('click', () => {
  const names = deletablePicks();
  if (!names.length) return;
  // 手工加出来的那一块是真的拿掉（连同记在它上面的微调），别的是记成「已删除」、点一下能恢复
  for (const name of names) spec = isBlockRoot(spec, name) ? removeBlockAt(spec, figure ?? { parts: [] }, name) : hidePart(spec, name);
  select(null);
  commit();
});

/* ---- 缝合：把选中的部件接到另一个部件上、解开（BodySpec.blocks.attach，见 model/attach.ts）；成品角色不支持 ---- */
const btnTweakAttach = $<HTMLButtonElement>('btnTweakAttach');
const btnTweakDetach = $<HTMLButtonElement>('btnTweakDetach');
/** 选中的里面能接到别的部件上的（多选时父部件也选中了的不算：它跟着父部件一起接过去） */
const attachablePicks = (): string[] => (character || !figure ? [] : tweakTargets().filter((n) => figure!.parts.some((p) => p.name === n && isAttachable(p))));
/** 选中的里面现在接着别的部件的 */
const attachedPicks = (): string[] => (character ? [] : picks.filter((n) => attachedTo(spec, n) !== undefined));
btnTweakAttach.addEventListener('click', () => {
  // 再点一次是不接了
  if (attaching) {
    finishAttach(null);
    return;
  }
  const names = attachablePicks();
  if (!names.length) return;
  attaching = names;
  attachNote = '';
  syncSockets();
  renderTweak();
});
/** 点了要接到的那个部件（target 是 null 就是不接了） */
function finishAttach(target: string | null, point: V3 | null = null) {
  const names = attaching;
  attaching = null;
  syncSockets();
  if (!names || !target || !figure) {
    renderTweak();
    return;
  }
  // 勾着「吸到接口上」、又是在模型上点的目标：照点中的地方找最近的接口（够不着就留在原地）
  const snap = snapSockets && point ? { at: point } : undefined;
  let next = spec;
  const done: string[] = [];
  for (const name of names) {
    const out = attachParts(next, [name], target, snap);
    next = out.spec;
    if (!out.attached.length) continue;
    done.push(name);
    // 勾着「同时调整对侧」：对侧那个接到对面对应的部件上（目标不分左右的话就是同一个）
    const twin = mirror ? mirrorName(name) : null;
    if (twin === null || names.includes(twin) || !figure.parts.some((p) => p.name === twin)) continue;
    const across = mirrorName(target);
    // 对侧的照镜像过去的那一点找接口
    next = attachParts(next, [twin], across !== null && figure.parts.some((p) => p.name === across) ? across : target, snap && { at: [-snap.at[0], snap.at[1], snap.at[2]] }).spec;
  }
  if (!done.length) {
    attachNote = t('接不上「{name}」：不能接到自己、或者长在自己上面的部件上。', { name: partLabel(target) });
    renderTweak();
    return;
  }
  spec = next;
  commit();
}
btnTweakDetach.addEventListener('click', () => {
  const names = attachedPicks();
  if (!names.length) return;
  const twins = mirror ? names.map(mirrorName).filter((n): n is string => n !== null && !names.includes(n) && attachedTo(spec, n) !== undefined) : [];
  spec = detachParts(spec, [...names, ...twins]);
  commit();
});
const snapInput = $<HTMLInputElement>('tweakSnap');
snapInput.checked = snapSockets;
snapInput.addEventListener('change', () => {
  snapSockets = snapInput.checked;
  syncSockets();
});
/** 接口的小圆点跟上现在的状态：挑「接到哪」的时候、勾着「吸到接口上」拖着部件的时候显示（选中的部件自己和长在它上面的那些的接口不显示） */
function syncSockets() {
  const moving = attaching ?? (tweaking && snapSockets && picks.length === 1 ? picks : null);
  if (character || !figure || !moving || (!attaching && !snapSockets)) {
    socketDots.update(null);
    return;
  }
  const parts = figure.parts;
  socketDots.update(placedSockets(spec, figure).filter((s) => moving.every((n) => canAttach(parts, n, s.host))).map((s) => s.world));
}
/**
 * 拖着一个部件松手：勾着「吸到接口上」、它的根离别的部件上的接口很近（SNAP_NEAR），就接到那个接口上。
 * 只管接到「别的」部件上：本来就长在这个部件上的，在它上面随便挪，不会被吸住。接上了返回 true
 */
function snapOnDrop(): boolean {
  if (!snapSockets || character || picks.length !== 1 || !selected) return false;
  const now = buildFigure(spec);
  const part = now.parts.find((p) => p.name === selected);
  if (!part || !isAttachable(part)) return false;
  // 头是带着脖子的：照脖子根找
  const neck = part.type === 'head' ? now.parts.find((p) => p.name === selected!.replace('Head_', 'Neck_') && p.parent === part.parent) : undefined;
  const at = worldTransforms(now).get((neck ?? part).name)?.pos;
  if (!at) return false;
  const native = attachedTo(spec, selected) === undefined ? part.parent : undefined;
  const near = nearestSocket(
    placedSockets(spec, now).filter((s) => s.host !== native && canAttach(now.parts, selected!, s.host)),
    at,
    SNAP_NEAR * now.scale,
    SOCKET_FOR[part.type],
  );
  if (!near) return false;
  const out = attachParts(spec, [selected], near.host, { at: near.world, reach: 1e-6 * now.scale + 1e-9 });
  if (!out.snapped.length) return false;
  spec = out.spec;
  return true;
}
const rigidInput = $<HTMLInputElement>('tweakRigid');
rigidInput.addEventListener('change', () => {
  rigidGroup = rigidInput.checked;
  renderTweak();
});

/* ---- 躯干分成胸腔和胯两块、合回一整块（BodySpec.blocks.splitTorso） ---- */
const btnTweakSplit = $<HTMLButtonElement>('btnTweakSplit');
btnTweakSplit.addEventListener('click', () => {
  if (character || !canSplitTorso(spec)) return;
  const on = !torsoSplit(spec);
  spec = setSplitTorso(spec, on);
  // 分开以后接着选中胸腔（最常动的那一块）；合回去选中整块躯干
  select(null);
  pendingPicks = [on ? RIBCAGE : PELVIS];
  commit();
});

/* ---- 复制部件：手工加一块（BodySpec.blocks，见 docs/blocks-plan.md）；成品角色不支持 ---- */
const btnTweakCopy = $<HTMLButtonElement>('btnTweakCopy');
/** 选中的里面能复制的（多选时父部件也选中了的不算：它跟着父部件一起复制） */
const copyablePicks = (): Part[] => (character || !figure ? [] : tweakTargets().flatMap((n) => figure!.parts.filter((p) => p.name === n && canCopy(figure!.parts, p))));
btnTweakCopy.addEventListener('click', () => {
  const sources = copyablePicks();
  if (!sources.length || !figure) return;
  const picked = new Set(sources.map((p) => p.name));
  const done = new Set<string>();
  const made: string[] = [];
  for (const part of sources) {
    if (done.has(part.name)) continue;
    // 左右成对的：对侧也选中了，或者勾着「同时调整对侧」，就两个一起复制、用同一个号——复制出来的还是一对
    const twinName = mirrorName(part.name);
    const twin = twinName !== null && (picked.has(twinName) || mirror) ? figure.parts.find((p) => p.name === twinName && canCopy(figure!.parts, p)) : undefined;
    const pair = twin ? [part, twin] : [part];
    const out = addBlock(
      spec,
      // 贴在躯干表面上的胸：微调已经换算进它的形状里了，不再照搬一遍
      pair.map((p) => ({ from: p.name, shift: copyShift(p), ...(p.surface && { plain: true }) })),
    );
    spec = out.spec;
    made.push(...out.names.filter((_, i) => picked.has(pair[i].name)));
    for (const p of pair) done.add(p.name);
  }
  if (!made.length) return;
  pendingPicks = made;
  commit();
});

const btnTweakReset = $<HTMLButtonElement>('btnTweakReset');
btnTweakReset.addEventListener('click', () => {
  if (!selected) return;
  for (const name of picks) spec = clearOverride(spec, name, mirrorFor(name));
  commit();
});
$('btnTweakDone').addEventListener('click', () => select(null));

/* ---- 选中一条手臂、人腿：这一条单独设末端接手还是脚、几根手指、几个脚趾（BodySpec.perLimb） ---- */

/** 改选中的那一条（勾着「同时调整对侧」时对侧一起改）。值是 undefined 的那一项回到跟着统一的 */
function setLimb(patch: LimbSetting) {
  if (!selected) return;
  const perLimb = { ...spec.perLimb };
  for (const name of [selected, ...(mirror && mirrorName(selected) ? [mirrorName(selected)!] : [])]) {
    const next: LimbSetting = { ...perLimb[name], ...patch };
    for (const key of Object.keys(next) as (keyof LimbSetting)[]) if (next[key] === undefined) delete next[key];
    if (Object.keys(next).length) perLimb[name] = next;
    else delete perLimb[name];
  }
  spec = { ...spec, perLimb };
  commit();
  // 面板马上跟上（模型要重建一会儿，不等它）：换了末端，下面那一行就从手指换成脚趾
  syncLimbTip(tweakable().find((p) => p.name === selected));
}

const LIMB_END_PICKS = ['all', 'hand', 'foot'] as const;
const syncLimbEnd = buildSeg($('segLimbEnd'), LIMB_END_PICKS, (v) => (v === 'all' ? t('跟着全部') : LIMB_END_LABEL[v]), (v) =>
  setLimb({ end: v === 'all' ? undefined : v }),
);
/** 这一条的手指 / 脚趾数：− 数 +，单独设过的后面多一个「跟着全部」 */
const syncLimbDigits = (() => {
  const minus = el('button', '', '−');
  const plus = el('button', '', '+');
  const out = el('output');
  const reset = el('button', 'btn ghost', t('跟着全部'));
  minus.type = plus.type = reset.type = 'button';
  minus.setAttribute('aria-label', t('少一个'));
  plus.setAttribute('aria-label', t('多一个'));
  /** 现在调的是手指还是脚趾 */
  let key: 'fingers' | 'toes' = 'fingers';
  const step = (delta: number) => () => {
    if (!selected) return;
    const now = limbSettingOf(spec, selected)[key];
    setLimb({ [key]: key === 'fingers' ? clampFingers(now + delta) : clampToes(now + delta) });
  };
  minus.addEventListener('click', step(-1));
  plus.addEventListener('click', step(1));
  reset.addEventListener('click', () => setLimb({ [key]: undefined }));
  $('limbDigits').append(minus, out, plus, reset);
  return (name: string, end: LimbEnd) => {
    key = end === 'hand' ? 'fingers' : 'toes';
    // 手指：分指的手才有（二次元素体、白模选了分指）；脚趾：只有二次元素体的脚有
    const shown = end === 'hand' ? spec.bodyStyle === 'anime' || spec.hands === 'fingers' : spec.bodyStyle === 'anime';
    $('limbDigitsField').hidden = !shown;
    $('limbDigitsLabel').textContent = end === 'hand' ? t('这一条的手指') : t('这一条的脚趾');
    const value = limbSettingOf(spec, name)[key];
    const limits = key === 'fingers' ? FINGERS : TOES;
    out.textContent = String(value);
    minus.disabled = value <= limits.min;
    plus.disabled = value >= limits.max;
    reset.hidden = spec.perLimb[name]?.[key] === undefined;
  };
})();

/** 选中的部件是手臂、人腿（不是成品角色）时显示这一块 */
function syncLimbTip(part: { name: string; type: PartType } | undefined) {
  const limb = !!part && !character && LIMB_PART.test(part.name) && (part.type === 'arm' || (part.type === 'leg' && humanLegs()));
  $('limbTip').hidden = !limb;
  if (!limb) return;
  const own = spec.perLimb[part!.name];
  syncLimbEnd(own?.end ?? 'all', true);
  syncLimbDigits(part!.name, limbSettingOf(spec, part!.name).end);
}

/** 部件列表上一次画出来时的内容，没变就不重画（重画会打断正在展开的下拉框） */
let partListKey = '';

/** 能单独微调的部件：白模人台、二次元素体是摆好的部件，成品角色是按骨骼分的部件（见 character/tweak.ts） */
function tweakable(): readonly { name: string; type: PartType }[] {
  // 换成「楚云萱躯干」以后另外八个胸腔只剩落脚处，不列出来（见 geometry/trunk.ts）
  return figure ? figure.parts.filter((p) => !isTrunkGhost(p)) : (tweaked?.parts ?? []);
}

/** 「已删除」「已微调」的名字多过这么多个就先收着（体块拼的预设一套就是上百个，全摊开面板拉得老长），点一下再展开 */
const TWEAKED_FOLD = 12;
const tweakedOpen = { removed: false, changed: false };
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
  const many = picks.length > 1;
  $('tweakBody').hidden = !part;
  // 多选时列出选中的都有谁：点名字把它从里面去掉
  const picksHost = $('tweakPicks');
  picksHost.hidden = !many;
  if (many) {
    const items: HTMLElement[] = [el('span', '', t('选中了 {n} 个：', { n: picks.length }))];
    for (const n of picks) {
      const chip = el('button', n === selected ? 'chip hit' : 'chip', `${partLabel(n)} ✕`);
      chip.type = 'button';
      chip.title = t('从选中的里去掉（{name}）', { name: n });
      chip.addEventListener('click', () => togglePick(n));
      items.push(chip);
    }
    picksHost.replaceChildren(...items);
  }
  if (part) {
    syncGizmoMode(gizmoMode, Boolean(gizmo));
    syncTweakFields();
    lockInput.checked = lockRatio;
    mirrorInput.checked = mirror;
    const twin = mirrorName(part.name);
    // 多选：选中的里有分左右的部件，才有「对称」可言
    $('tweakMirrorRow').hidden = many ? !tweakTargets().some((n) => sideOf(n)) : !twin;
    if (many) $('tweakMirrorText').textContent = t('左右对称着改（另一侧照镜像）');
    else if (twin) $('tweakMirrorText').textContent = t('同时调整对侧（{name}）', { name: partLabel(twin) });
    btnTweakReset.textContent = many ? t('还原选中的部件') : t('还原这个部件');
    btnTweakReset.disabled = !picks.some((n) => activeOverrides(spec)[n]);
    btnTweakDelete.textContent = many ? t('删除选中的部件') : t('删除这个部件');
    btnTweakDelete.disabled = deletablePicks().length === 0;
    // 选中的是躯干（或者分开以后的胸腔、胯）：能分成两块、合回一整块
    const splittable = !character && !many && canSplitTorso(spec) && (part.name === PELVIS || part.name === RIBCAGE);
    btnTweakSplit.hidden = !splittable;
    if (splittable) btnTweakSplit.textContent = torsoSplit(spec) ? t('合回一整块躯干') : t('分成胸腔和胯');
    btnTweakAttach.textContent = attaching ? t('取消（不接了）') : t('接到…');
    btnTweakAttach.disabled = !attaching && attachablePicks().length === 0;
    btnTweakDetach.hidden = attachedPicks().length === 0;
    $('tweakRigidRow').hidden = !many || !!character;
    rigidInput.checked = rigidGroup;
    btnTweakCopy.textContent = many ? t('复制选中的部件') : t('复制一份');
    btnTweakCopy.disabled = copyablePicks().length === 0;
    $<HTMLButtonElement>('btnTweakKind').disabled = !tweakable().some((p) => p.type === part.type && !picks.includes(p.name));
    // 这一条的末端、手指数只对单独选中的一条说得通；手工复制出来的照着原来那条，不单独设
    syncLimbTip(many || isBlockRoot(spec, part.name) ? undefined : part);
    const frame = part.type === 'eye' || part.type === 'horn' || part.type === 'ear' ? t('这个头的') : t('角色的');
    const host = many ? undefined : attachedTo(spec, part.name);
    $('tweakNote').textContent = joinSentences([
      attaching ? t('现在在模型上点一下要接到的那个部件（也可以在上面的列表里选）；点空白处、按 Esc 或者再点一次按钮是不接了。') : '',
      attachNote,
      host !== undefined ? t('它接在「{name}」上：挪、转、缩放「{name}」的时候它跟着走，摆姿势时也跟着。', { name: partLabel(host) }) : '',
      host !== undefined && spec.blocks?.attach?.[part.name]?.socket !== undefined ? t('它吸在那里的一个接口上：以后体型变了接口挪了，它跟着挪。') : '',
      many && rigidGroup
        ? t('选中的 {n} 个部件像一整块那样改：转动、等比缩放都绕着「{name}」的支点，互相之间的位置不变。', { n: picks.length, name: partLabel(part.name) })
        : many
        ? t('选中的 {n} 个部件一起改：各自绕自己的关节移动、转动、缩放；操纵杆和数字是「{name}」的，别的照同样的量跟着改。', {
            n: picks.length,
            name: partLabel(part.name),
          })
        : '',
      many && tweakTargets().length < picks.length ? t('父部件也选中了的（比如躯干和它上面的手臂）只改父部件，子部件跟着它动。') : '',
      t('X 是{frame}左手边，Y 朝上，Z 朝前；角度绕这三根轴转，以关节为中心。', { frame }),
      t('大小：{hint}。', { hint: SCALE_HINT[part.type] ?? t('X 宽、Y 高、Z 厚') }),
      character ? t('成品角色的部件是照骨骼分的：和身体连着的地方（肩膀、腿根、脖子）跟着拉长；复制出来的手臂、角、尾巴、翅膀是整块挪的。') : '',
      !character && torsoSplit(spec) && picks.some((n) => n === PELVIS || n === RIBCAGE)
        ? t('胸腔和胯是分开的两块：动其中一块，另一块不动，中间的腰跟着接顺；胯带着腿一起动，脚还踩在地上。')
        : '',
    ]);
  } else {
    $('tweakNote').textContent = joinSentences([
      t('在模型上点一下某个部件，或者在上面选，就能单独调它的位置、角度和大小。'),
      t('要好几个一起调：勾上「多选」再一个个点，或者按住 Ctrl、Shift 点。'),
      character ? '' : t('点中头、手臂、腿、胸、尾巴这些部件以后可以「复制一份」：多出来的那个想挪到哪就挪到哪。'),
    ]);
  }
  // 舞台左下角也标出选中的是谁：面板滚走了也看得见
  syncPicked();

  // 已经微调过的部件：点名字可以直接选中
  const removed = character ? [] : hiddenParts(spec);
  const all = Object.keys(activeOverrides(spec)).filter((n) => !removed.includes(n));
  const changed = names.filter((n) => activeOverrides(spec)[n]);
  const host = $('tweaked');
  host.hidden = all.length === 0 && removed.length === 0;
  if (all.length || removed.length) {
    const items: HTMLElement[] = [];
    // 删掉的部件：点名字恢复
    /** 一组名字：多过 TWEAKED_FOLD 个时先收着，只留一个「N 个，点开看」的按钮 */
    const group = (key: keyof typeof tweakedOpen, label: string, chips: HTMLElement[], always = false) => {
      if (!chips.length && !always) return;
      items.push(el('span', '', label));
      if (chips.length <= TWEAKED_FOLD) {
        items.push(...chips);
        return;
      }
      if (tweakedOpen[key]) items.push(...chips);
      const toggle = el('button', 'chip fold', tweakedOpen[key] ? t('收起') : t('{n} 个，点开看', { n: chips.length }));
      toggle.type = 'button';
      toggle.addEventListener('click', () => {
        tweakedOpen[key] = !tweakedOpen[key];
        renderTweak();
      });
      items.push(toggle);
    };
    group(
      'removed',
      t('已删除（点一下恢复）：'),
      removed.map((n) => {
        const chip = el('button', 'chip', partLabel(n));
        chip.type = 'button';
        chip.title = n;
        chip.addEventListener('click', () => {
          spec = showPart(spec, n);
          commit();
        });
        return chip;
      }),
    );
    group(
      'changed',
      t('已微调：'),
      changed.map((n) => {
        const chip = el('button', picks.includes(n) ? 'chip hit' : 'chip', partLabel(n));
        chip.type = 'button';
        chip.title = n;
        chip.addEventListener('click', () => pickPartName(n));
        return chip;
      }),
      all.length > 0,
    );
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
  // 刚复制出来的部件：模型重建好、它们出现了，就选中它们（操纵杆直接摆在新的那个上，接着就能拖走）
  if (pendingPicks?.some((n) => tweakable().some((p) => p.name === n))) {
    picks = pendingPicks.filter((n) => tweakable().some((p) => p.name === n));
    selected = anchorOf(picks);
    pendingPicks = null;
    history.seal();
  }
  // 部件数变了以后已经不存在的，从选中的里去掉
  if (picks.some((n) => !tweakable().some((p) => p.name === n))) {
    picks = picks.filter((n) => tweakable().some((p) => p.name === n));
    selected = anchorOf(picks);
  }
  const frame = selected ? frameOfPart(selected) : null;
  cmPerUnit = frame ? frame.parentScale * 100 : 100;
  const override = selected ? activeOverrides(spec)[selected] : undefined;
  if (tweaked && character) {
    // 成品角色：高亮的形状跟着微调变，拖着的时候每次都要换。多选时选中的几个部件的面并在一起
    const at = tweaked;
    const names = [...picks];
    const glow = () => {
      const each = names.map((n) => characterPartGlow(at, n));
      const out = new Float32Array(each.reduce((sum, a) => sum + a.length, 0));
      let offset = 0;
      for (const a of each) {
        out.set(a, offset);
        offset += a.length;
      }
      return out;
    };
    gizmo?.syncFrame(frame, glow, `${names.join(',')}|${characterVersion}`, override);
  } else {
    gizmo?.sync(
      figure,
      selected,
      override,
      picks.filter((n) => n !== selected),
    );
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
  pickPoint = null;
  if (!figure) return null;
  const isFused = spec.meshMode === 'fused';
  const hit = ray.intersectObject(isFused ? fused.root : model.root, true)[0];
  if (!hit) return null;
  pickPoint = [hit.point.x, hit.point.y, hit.point.z];
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
  gizmo.onPick = (name, add) => {
    // 这一下点中的是道具（见 release）：身体上的部件不动
    if (clickTaken) return;
    // 正等着点「接到哪个部件上」：这一下点的是目标（点在空白处就是不接了）
    if (attaching) {
      finishAttach(name, name ? pickPoint : null);
      return;
    }
    // 多选（开着开关，或者按着 Ctrl、Shift）：点中的加进来、再点去掉；点在空白处不动，免得一下全丢了
    if (add || multiPick) {
      if (name) togglePick(name);
    } else select(name);
    // 在模型上点中了部件：把「手动微调」那一栏亮出来
    if (!name) return;
    reveal('tweak');
    learnedPick();
  };
  gizmo.onChange = (patch, delta) => applyTweak(patch, `gizmo:${selected}`, dragFrom ? delta : undefined, dragFrom);
  gizmo.onDrag = (active) => {
    // 每次拖动单独算一步撤销
    history.seal();
    tweaking = active;
    // 多选：记下按下这一刻各个部件的样子，拖动中都从它算起
    dragFrom = null;
    if (active && picks.length > 1) {
      dragFrom = new Map();
      for (const name of tweakTargets()) {
        const frame = frameOfPart(name);
        if (frame) dragFrom.set(name, { override: activeOverrides(spec)[name], frame });
      }
    }
    syncSockets();
    // 松手以后存档、刷新面板，再同步一次：操纵杆回到按存下来的数值算出的位置（数值被取整、限幅过）
    if (!active) {
      // 松手的地方离别的部件上的接口很近：接上去（单独记一步撤销）
      if (snapOnDrop()) commit();
      else {
        save();
        render();
      }
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
  // 选中了道具：W / E / R 换操纵杆、Delete 删除、Esc 取消选择（见 view/propsPanel.ts）
  if (!typing && !e.altKey && !e.shiftKey && !e.repeat && !attaching && propsPanel.key(e)) {
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape') {
    if (attaching) finishAttach(null);
    else if (selected) select(null);
    else if (joint) selectJoint(null);
  }
  // W 移动、E 旋转（R 缩放，只有造型时有）：和 Blender、Unity 的习惯一样
  if (typing || e.altKey || e.shiftKey || e.repeat) return;
  const k = e.key.toLowerCase();
  if (mode === 'pose' && (k === 'w' || k === 'e')) {
    if (poseHandles?.busy) return;
    setPoseTool(k === 'w' ? 'move' : 'turn');
  } else if (mode === 'shape' && selected && gizmo && (k === 'w' || k === 'e' || k === 'r')) {
    const next: GizmoMode = k === 'w' ? 'translate' : k === 'e' ? 'rotate' : 'scale';
    gizmoMode = next;
    gizmo.setMode(next);
    syncGizmoMode(next, true);
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
let grab: { start: PoseState; frame: Frame; pins: Pin[]; swing?: { carrier: number; slack: number } } | null = null;
/** 这一次拖动里，上一下是不是把道具绕着主手转过去了（两只手拿，见 swingFor） */
let swung = false;

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
  if (scene.figures.length > 1 || scene.props.length) scheduleSceneClash();
  // 手上带着道具的：道具跟到手现在的地方
  liveFrame = { key: poseState, solver: kit.solver, frame };
  showCarried();
}

/**
 * 选中的点能不能用移动箭头挪：手、脚、胯（拖到哪都行），还有白色的小圆点（指尖、脚尖、头顶、尾巴梢 …）——
 * 它们挪一挪其实是带着它的骨头转过去，沿一根箭头挪就是只往一个方向偏，手指、脚尖朝哪能一点点调。
 * 肘、膝没有（拖它是换一边弯，不是挪到哪）
 */
const movable = (handle: Handle | undefined): handle is Handle =>
  handle?.kind === 'reach' || handle?.kind === 'body' || (handle?.kind === 'aim' && handle.links.length > 0);
/** 选中的点上出的是旋转环还是移动箭头（能挪的点才有箭头） */
const showsArrows = (handle: Handle | undefined): boolean => poseTool === 'move' && movable(handle);

/** 旋转环（或移动箭头）摆到选中的关节上：绿色那一圈正好绕着骨头自己转；箭头照身体的前后、左右、上下 */
function placeRing() {
  const handle = pickedHandle();
  if (!handle || !kit || !poseFrame) {
    poseHandles?.ring(null);
    poseHandles?.arrows(null);
    return;
  }
  const { rig } = kit.solver;
  if (showsArrows(handle)) {
    poseHandles?.ring(null);
    // 只取胯朝哪边（水平转了多少），不跟着弯腰、侧倾歪
    const ahead = rotate(poseFrame.rot[rig.hips], [0, 0, 1]);
    const half = Math.hypot(ahead[0], ahead[2]) > 1e-6 ? Math.atan2(ahead[0], ahead[2]) / 2 : 0;
    poseHandles?.arrows({ pos: pointOn(rig, poseFrame, handle.anchor, handle.rest), quat: [0, Math.sin(half), 0, Math.cos(half)] });
    return;
  }
  poseHandles?.arrows(null);
  // 腰、胸：环沿着这串脊柱摆（从最下面那节的起点到最上面那节的末端），拖它就是绕脊柱扭（见 pose/solve.ts 的 turnSpine）；
  // 沿胸那节自己摆的话，它往后斜着二十几度，扭的时候还带着往前后倒
  const chain = handle.twist;
  const along = chain.length > 1 ? sub(rig.tail[chain[chain.length - 1]], rig.head[chain[0]]) : sub(rig.tail[handle.turn], rig.head[handle.turn]);
  const base = len(along) > 1e-9 ? quatBetween(UP, norm(along)) : Q_ID;
  poseHandles?.ring({ pos: poseFrame.pos[handle.turn], quat: quatMul(poseFrame.rot[handle.turn], base) });
}

/** 圆点的样子（选中的、钉着的）跟上现在的状态 */
function markHandles() {
  poseHandles?.mark(joint, (h) => {
    const limb = limbOf(h);
    return Boolean(limb && (pinned.has(limb.name) || linkOf(myLinks(), limb.name)));
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

/** 一键动作、双人动作摆好了要说的话：这时候才切进摆姿势的，等网格配好骨骼以后还说它（不换成「可以摆姿势了」） */
let poseNote: { text: string; warn: boolean } | null = null;

/** 摆姿势时：模型重建了、姿势变了、撤销了……把屏幕上的一切同步到 spec.posing */
function syncPosing() {
  const k = ensureKit();
  if (!k) return;
  const ready = ensurePosed();
  // 融合网格的权重要算一小会儿：算好之前圆点先亮着，网格等一下才跟上
  if (!ready && !poseWaiting) {
    if (!poseNote) setStatus(t('正在给网格配上骨骼，马上就能摆…'));
  } else if (ready && poseWaiting) {
    if (poseNote) setStatus(poseNote.text, poseNote.warn);
    else setStatus(t('可以摆姿势了：拖模型上的圆点。'));
    // 配好之前查穿插照的是静止的骨架（坐着的人还「站」在椅子里）：现在照摆好的再查一遍
    scheduleSceneClash();
  }
  if (ready) poseNote = null;
  poseWaiting = !ready;
  // 分部件模式：摆姿势时显示的是另一组能弯的网格
  const flat = !character && spec.meshMode === 'parts';
  flatParts.root.visible = flat && ready;
  if (flat) model.root.visible = !ready;
  // 正拖着的时候屏幕上是还没存的姿势，不去动它
  if (!poseHandles?.busy) {
    settleOldCollars(k.solver);
    poseState = stateOf(k.solver, spec.posing);
    posedFrom = spec.posing;
  }
  showPose();
  markHandles();
  if (ready && !poseHandles?.busy) {
    const box = posed!.bounds();
    if (!box.isEmpty()) {
      ownBox.copy(box);
      sceneBounds(box);
    }
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
  if (id) propsPanel.select(null);
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
  if (part) {
    $('pickedName').textContent =
      picks.length > 1 ? t('{name} 等 {n} 个部件', { name: partLabel(part.name), n: picks.length }) : `${partLabel(part.name)} · ${part.name}`;
  }
  // 「多选」只在造型时有（摆姿势时这块牌子写的是关节）
  pickedMulti.hidden = !part;
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
  // 抓着、踩着道具的手脚也留在原地：留的是道具上那一点、那个朝向（手现在没够着的话，照样朝那一点去）
  // 抓在自己带着的道具上的不算：道具跟着身体走，它们跟着道具走（见 rideCarried）
  const riding = new Set(ridingHolds().map((h) => h.part));
  const held = new Map(
    myHolds()
      .filter((h) => !h.carried && !riding.has(h.part))
      .map((h) => [h.part, h]),
  );
  const pins = capturePins(kit.solver, frame, held.size || riding.size ? new Set([...pinned, ...held.keys()].filter((name) => !riding.has(name))) : pinned);
  const on = HOLD_ON * linkScale();
  for (const pin of pins) {
    const hold = held.get(kit.solver.limbs[pin.limb].name);
    if (!hold) continue;
    // 手这会儿就在道具上：手臂伸直了把身体拉住（和钉着的脚拉住胯一样）。
    // 本来就够不着、悬着的不拉：不然一碰身体，整个人就被拽过去
    pin.firm = len(sub(pin.pos, hold.target)) < on;
    pin.pos = hold.target;
    if (hold.rot) pin.rot = hold.rot;
  }
  grab = { start: poseState, frame, pins };
  swung = false;
}
/** 手脚离抓着的那一点不到这么远（标准身高 1.7 米时，米），算是「还在道具上」 */
const HOLD_ON = 0.01;

/**
 * 屏幕上的姿势定下来：存进设定，记一步撤销。
 * keep：这副骨架上没有的骨骼照它留着（平时就是原来的姿势；整份换掉的时候是新的那一份）
 */
function commitPose(keep: Posing = spec.posing, key?: string) {
  if (!kit || !poseState) return;
  // key：拖滑块的时候连着的修改算一步撤销
  if (!key) history.seal();
  // 抓着、踩着道具的手脚：身体别处怎么动，它们都回到抓着的点上；刚换了地方、换了角度抓的，手指重新握一遍
  poseState = holdState(kit.solver, poseState, myHolds(), { grip: regripDue ? 'always' : 'moved' });
  regripDue = false;
  spec = { ...spec, posing: posingOf(kit.solver, poseState, keep) };
  posedFrom = spec.posing;
  commit(key);
}

/** 下一次存姿势时，抓着道具的手的手指都重新握一遍（刚在道具上换了地方、换了角度抓） */
let regripDue = false;

/** 直接换一个姿势（对称、翻转、还原）。打开了「几对手臂一起动」的话，别的几对照领头的那一对摆好再存 */
function editPosing(next: Posing, key?: string) {
  if (kit && followOn) next = posingOf(kit.solver, following(stateOf(kit.solver, next)), next);
  // 整个姿势换了：抓着道具的手回到道具上，手指重新握
  if (kit) next = holdPosing(kit.solver, next, myHolds(), { grip: 'always' });
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

/* ---- 点中圆点以后出旋转环还是移动箭头（肘、膝只有旋转环）：只是界面上的偏好，记在这台设备上，不进撤销、不存档 ---- */

type PoseTool = 'move' | 'turn';
const POSE_TOOLS = ['move', 'turn'] as const;
const POSE_TOOL_KEY = 'oc-basemesh-pose-tool';
let poseTool: PoseTool = 'turn';
try {
  if (localStorage.getItem(POSE_TOOL_KEY) === 'move') poseTool = 'move';
} catch {
  // 读不到就用旋转环
}
function setPoseTool(next: PoseTool) {
  if (next === poseTool) return;
  poseTool = next;
  try {
    localStorage.setItem(POSE_TOOL_KEY, next);
  } catch {
    // 记不住就这一次
  }
  placeRing();
  renderPosePanel();
}
const syncPoseTool = buildSeg($('segPoseTool'), POSE_TOOLS, (v) => (v === 'move' ? t('移动') : t('旋转')), setPoseTool);

if (poseHandles) {
  poseHandles.onGrab = (handle) => {
    takeLead(handle);
    beginGrab();
    grabTouch(handle);
    swingFor(handle);
  };
  poseHandles.onDrag = (handle, target) => {
    if (!kit || !grab) return;
    const { solver } = kit;
    /** 照平常拖手脚时，手脚要去的地方（给 tether 用） */
    let reached: V3 | null = null;
    // 手脚碰到场景里别的角色、碰到道具：停在表面（见 touchTarget）；拖胯坐下去、躺下去也停在道具表面
    if (handle.kind === 'reach') {
      const limb = solver.limbs[handle.limb];
      // 两只手拿着一件道具、拖的是不带着它的那只：道具绕着主手转过去（拖开了就不转，照平常的拖）
      const swing = grab.swing ? swingReach(solver, grab.start, grab.swing.carrier, handle.limb, target, grab.swing.slack) : null;
      swung = Boolean(swing);
      if (swing) {
        poseState = swing;
        gripSnap = null;
      } else {
        const to = touchTarget(target, limb.kind === 'leg' ? 'foot' : 'hand', grab.frame.pos[limb.end]);
        // 拖到道具跟前：吸上去（见 snapDrag）
        poseState = snapDrag(handle.limb, to, dragReach(solver, grab.start, handle.limb, to, grab.pins));
        reached = to;
      }
    }
    else if (handle.kind === 'bend') poseState = dragBend(solver, grab.start, handle.limb, target);
    else if (handle.kind === 'body') poseState = dragBody(solver, grab.start, touchTarget(target, 'body', grab.frame.pos[solver.rig.hips]), grab.pins);
    else if (handle.links.length) poseState = dragAim(solver, grab.start, handle.links, { bone: handle.anchor, rest: handle.rest }, target, grab.pins);
    if (poseState) poseState = following(poseState);
    // 抓在自己带着的道具上的别的手脚：跟到道具现在的地方（正拖着的这只不管，转道具的时候它已经在了）
    rideCarried(handle.kind === 'reach' && !swung ? solver.limbs[handle.limb].name : undefined);
    // 拖的是带着道具的那只手：别的手够不着了，道具停在它们还够得着的地方
    if (reached && handle.kind === 'reach') tether(handle.limb, reached);
    showPose();
    poseHandles?.snap(gripSnap?.mark ?? null);
  };
  poseHandles.onRelease = (handle, moved) => {
    grab = null;
    if (moved) {
      // 道具绕着主手转过去了：两只手都还抓在原处，连接不用动。
      // 不然：松手时吸在道具上就抓住它；再不然照老规矩（还挨着就换个地方抓，拖开了就松开）
      if (swung) snapRelease(undefined);
      else if (!snapRelease(handle)) relinkDragged(handle);
      freeGripOf(handle);
      dropStretched();
      commitPose();
    } else snapRelease(undefined);
    swung = false;
  };
  poseHandles.onPick = (handle) => {
    // 这一下点中的是道具（见 release）：选中的关节已经放掉了
    if (clickTaken) return;
    selectJoint(handle?.id ?? null);
  };
  poseHandles.onTurnStart = () => {
    takeLead(pickedHandle());
    beginGrab();
  };
  poseHandles.onTurn = (delta) => {
    const handle = pickedHandle();
    if (!kit || !grab || !handle) return;
    // 腰、胸：绕脊柱拧的那一部分分给整串脊柱，不挤在一个关节上（见 pose/solve.ts 的 turnSpine）
    const turned = handle.twist.length > 1
      ? turnSpine(kit.solver, grab.start, handle.turn, handle.twist, delta, grab.pins)
      : turnBone(kit.solver, grab.start, handle.turn, quatMul(delta, grab.frame.rot[handle.turn]), grab.pins);
    poseState = following(turned);
    // 弯腰、转身、转带着道具的手：抓在这件道具上的手脚跟着它（正转着的那只手脚不管）
    rideCarried(kit.solver.limbs.find((l) => l.end === handle.turn)?.name);
    showPose();
  };
  poseHandles.onTurnEnd = () => {
    grab = null;
    relinkTurned(pickedHandle());
    freeGripOf(pickedHandle());
    dropStretched();
    commitPose();
  };
  // 移动箭头：和拖圆点一样解，只是位置是沿箭头挪出来的
  poseHandles.onMoveStart = () => {
    const handle = pickedHandle();
    takeLead(handle);
    beginGrab();
    if (handle) grabTouch(handle);
    swingFor(handle);
  };
  poseHandles.onMove = (target) => {
    const handle = pickedHandle();
    if (handle) poseHandles?.onDrag(handle, target);
  };
  poseHandles.onMoveEnd = (moved) => {
    grab = null;
    if (moved) {
      if (swung) snapRelease(undefined);
      else if (!snapRelease(pickedHandle())) relinkDragged(pickedHandle());
      freeGripOf(pickedHandle());
      dropStretched();
      commitPose();
    } else snapRelease(undefined);
    swung = false;
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
  // 整个姿势换了：抓着、拿着道具的手，手指都重新握一遍（换上去的那份里手是张着的）
  regripDue = true;
  // 表情也是：换上去的那份里没有，脸上原来的就留着
  commitPose(posing.faces || !spec.posing.faces ? posing : { ...posing, faces: spec.posing.faces });
}

/* ---- 姿势文件：单独存一份姿势，连同看的角度 ---- */

const readTriple = (v: unknown): [number, number, number] | null =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [v[0], v[1], v[2]] : null;

/* ---- 保存配置、姿势时问文件名：上次用的名字记在这个浏览器里，下次照它填好 ---- */

const SAVE_NAME_KEY = 'oc-basemesh-save-names';
const SAVE_DEFAULT = { config: 'oc_config', pose: 'oc_pose', scene: 'oc_scene' } as const;
const SAVE_TITLE = { config: tk('保存配置'), pose: tk('保存姿势'), scene: tk('保存场景') } as const;
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
  // 角色连着道具（坐着、吊着、手钉着）：那几件道具一起带上，载入时能连道具一起放
  const me = currentOf(scene);
  const carried = packPoseProps(me.place, me.links, propsNow());
  const file = {
    app: 'oc-basemesh',
    kind: 'pose',
    posing: posingOf(solver, stateOf(solver, spec.posing), spec.posing),
    ...(viewport ? { camera: viewport.cameraState() } : {}),
    ...(carried ? { props: carried } : {}),
  };
  const name = await askFileName('pose');
  if (!name) return;
  try {
    const where = await saveText(name, JSON.stringify(file, null, 2));
    setStatus(
      carried
        ? t('已保存姿势 {file}（带着连着的 {n} 件道具），{where}。', { file: name, n: carried.props.length, where })
        : t('已保存姿势 {file}，{where}。', { file: name, where }),
    );
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
    // 存的时候连着道具的：问一句要不要连道具一起放
    const carried = readPoseProps((data as { props?: unknown }).props);
    const withProps =
      carried !== null &&
      (await askConfirm(
        t('这个姿势是连着 {n} 件道具一起存的（{names}）。连道具一起放进场景吗？', { n: carried.props.length, names: carried.props.map((p) => propLabel(p)).join('、') }),
        t('连道具一起放'),
        t('只要姿势'),
      ));
    if (withProps && carried) {
      const me = currentOf(scene);
      const got = placePoseProps(carried, me.place, propsNow());
      propsPanel.insert(got.props);
      history.seal();
      movePlace(me.id, got.place, true);
      scene = updateFigure(scene, me.id, { links: got.links });
    }
    usePosing(posing, false);
    if (withProps) {
      propsPanel.refresh();
      scheduleSceneClash();
    }
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
    setStatus(withProps && carried ? t('已载入姿势 {name}，连着的 {n} 件道具也放进场景了。', { name: file.name, n: carried.props.length }) : t('已载入姿势 {name}。', { name: file.name }));
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

/** 手势这一栏管的手：手臂上的（手脚互换时腿上接的手不算，它的手指拖指尖的圆点摆） */
const armHands = (): Hand[] => (kit?.solver.hands ?? []).filter((hand) => hand.limb === 'arm');

const pickedHands = (): Hand[] =>
  armHands().filter(
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
  freeGrip(pickedHands());
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
  legs: t('手臂末端接的是脚，没有手；腿末端接的手不归这一栏管：在「姿势」栏的「显示哪些圆点」里打开「手指」，拖指尖摆。'),
  mitten:
    t('并指的手，四根手指是连成一片的：握拳、张开这类整只手一起动的手势像样，「剪刀手」「指」这种一根根分开的摆不出来。要分开摆，到「造型 → 部件 → 手臂」里把「手」换成「分指」。'),
  usual:
    t('点一个手势，上面选中的手就摆成那样（不分左右）；再用滑块一根手指一根手指地调。想直接拖指尖：在「姿势」栏的「显示哪些圆点」里打开「手指」，把手放大了再拖。'),
};

function renderHand() {
  const all = armHands();
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
  const onLegs = (kit?.solver.hands ?? []).some((hand) => hand.limb === 'leg');
  $('handNote').textContent = all.length === 0 ? (onLegs ? HAND_NOTE.legs : HAND_NOTE.none) : mitten ? HAND_NOTE.mitten : HAND_NOTE.usual;
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
/** 「套用选项」收着时那一行小字：套到哪些部位、强度 */
let syncPresetSummary = () => {};

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
  /** 连体：姿势换到每个上半身自己的朝向里去套，胯不动，撑着身子的手留在原处（见 pose/conjoined.ts） */
  const fittedConjoined = (posing: Posing): Posing => (spec.conjoined !== 'none' && kit ? fitConjoined(kit.solver, posing, spec.conjoinPose) : posing);
  /**
   * 围成一圈：姿势换到每个人、每条腿自己朝外的方向里去套，两侧的手臂照整个身子的左右（见 pose/ring.ts）。
   * 用体块拼的、有上半身背对背的身体（楚云萱）也照这一套。都不是的返回 null
   */
  const fittedRing = (posing: Posing): Posing | null =>
    kit && (ringActive(spec) || isRingRig(kit.solver.rig)) ? fitRing(kit.solver, posing) : null;
  const fitted = (posing: Posing): Posing => {
    const own = fittedRing(posing) ?? fittedConjoined(fittedTorsos(fittedLegs(posing)));
    if (!kit) return own;
    const { posing: next, followers } = followArms(kit.solver, fitArms(kit.solver, own));
    const body = bodyDist();
    if (!body || !figure) return next;
    // 手腕外面那一截照摆好的姿势量（见 sdf/posedBody.ts）；用体块拼的（楚云萱）连融合时腿还跟着胯的样子也量
    const posed = (isBlockRig(kit.solver.rig) ? wristBodyDist : posedBodyDist)(figure, spec.blend, poseMatrices(kit.solver.rig, forward(kit.solver.rig, stateOf(kit.solver, next)), figure.scale));
    return clearArms(kit.solver, next, body, figure.scale, spec.shape.limbs, followers, posed);
  };

  /* ---- 只套一部分、只套几成（照 Blender 姿态库，见 pose/blend.ts） ---- */

  /** 只把姿势里的手臂套给第 pair 对：姿势里第一对的手臂骨骼换成那一对的名字（别的手臂不动，见 presetPick） */
  const pairPosing = (posing: Posing, pair: number): Posing => {
    // 连体：每一对手臂都照第一对换好了，只摆哪一对由 presetPick 挑
    if (spec.conjoined !== 'none') return fittedConjoined(posing);
    // 围成一圈：两侧的手臂都照整个身子的左右换好了
    const ringed = fittedRing(posing);
    if (ringed) return ringed;
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
      syncPresetSummary();
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
    syncPresetSummary();
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
    syncPresetSummary();
  };

  /* ---- 分类：一次只看一类（记在浏览器里），「全部」是所有的 ---- */
  const POSE_GROUP_KEY = 'oc-basemesh-pose-group';
  const POSE_GROUP_LABEL: Record<PoseGroup | 'all', string> = {
    stand: t('站姿@@姿势分类'),
    daily: t('日常@@姿势分类'),
    move: t('走跑跳@@姿势分类'),
    rest: t('蹲坐躺@@姿势分类'),
    fight: t('打斗@@姿势分类'),
    all: t('全部@@姿势分类'),
  };
  const groupOptions = [...POSE_GROUPS, 'all'] as const;
  let poseGroup: PoseGroup | 'all' = 'stand';
  try {
    const saved = localStorage.getItem(POSE_GROUP_KEY);
    if ((groupOptions as readonly string[]).includes(saved ?? '')) poseGroup = saved as PoseGroup | 'all';
  } catch {
    // 读不到就从第一类开始
  }
  const inGroup = (preset: PresetPose) => poseGroup === 'all' || preset.group === poseGroup;
  const presetButtons = POSE_LIBRARY.map((preset) => {
    const btn = el('button', 'btn', t(preset.name));
    btn.type = 'button';
    btn.addEventListener('click', () => {
      const note = applyPreset(preset);
      if (note) setStatus(note, !presetParts.size);
    });
    $('poseLibrary').append(btn);
    return () => (btn.hidden = !inGroup(preset));
  });
  const syncGroup = buildSeg($('segPoseGroup'), groupOptions, (v) => POSE_GROUP_LABEL[v], (group) => {
    poseGroup = group;
    try {
      localStorage.setItem(POSE_GROUP_KEY, group);
    } catch {
      // 记不住就下次从第一类开始
    }
    showGroup();
  });
  const showGroup = () => {
    syncGroup(poseGroup, true);
    for (const sync of presetButtons) sync();
  };
  showGroup();

  /** 「套用选项」那一行收着时写现在的设定：套到哪些部位、强度 */
  syncPresetSummary = () => {
    const parts = POSE_REGIONS.filter((r) => presetParts.has(r)).map((r) => POSE_REGION_LABEL[r]);
    const where = parts.length === POSE_REGIONS.length ? t('整套') : parts.length ? parts.join(t('、')) : t('一个部位都没勾');
    const arm = presetPair === null ? '' : t('（手臂是第 {n} 对）', { n: presetPair + 1 });
    $('poseApplyNow').textContent = `${where}${arm} · ${presetAmount}%`;
  };
  syncPresetSummary();

  let last = -1;
  $('btnPoseRandom').addEventListener('click', () => {
    // 在现在看的这一类里挑，不和上一次的重样
    const pool = POSE_LIBRARY.map((preset, i) => (inGroup(preset) ? i : -1)).filter((i) => i >= 0);
    if (!pool.length) return;
    let pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick === last) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
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
  syncPoseLink();
  $('poseToolRow').hidden = !movable(handle);
  syncPoseTool(poseTool, true);
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
  // 「吸附」：场景里有道具才用得上
  $('poseSnapRow').hidden = !propsNow().length;
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
    const credit = usedCredits().join(t('；')) || undefined;
    const copyright = own ? [[own.title, own.author, own.license].filter(Boolean).join(' / '), credit].filter(Boolean).join(t('；')) : credit;
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
  // 场景里好几个角色、或者放了道具，选了「整个场景」：每个角色各算一遍，连道具写在一个文件里
  if (exportWhat === 'scene' && (scene.figures.length > 1 || scene.props.length)) return exportScene(kind);
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
    // 场景里的底座圈不进截图（和地上那一圈参照线一样）
    sceneView.showRings(false);
    const shot = viewport.snapshot();
    placeAll();
    const where = await saveBlob('oc_basemesh.png', await shot);
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
  const credit = usedCredits().join(t('；')) || undefined;
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
  // 先看人形骨骼对不对得上：对不上就不用问名字了。围成一圈的把两侧的手臂改接到第一个人的脊柱上（见 ringHumanoid）
  const rest = ringHumanoid(buildSkeleton(target));
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

/* ---------------- 场景：好几个角色（见 docs/scene-plan.md、model/scene.ts） ----------------
 * 同一时间只改一个（当前角色）：spec、text、history 这些全局的都是它的。别的角色在屏幕上是定住的网格（sceneView），
 * 照它们各自的设定在后台算好（scene/bake.ts）。当前角色永远站在原点，别人照相对它的位置摆；切换时镜头跟着挪，画面不跳。
 */

/** 角色在列表、文件里叫什么：起了名字就用名字，没起就是「角色 n」 */
const figureLabel = (f: SceneFigure) => f.name || t('角色 {n}', { n: indexOf(scene, f.id) + 1 });

/** 场景里别的角色是照哪份设定算的（屏幕上定住的那张）；没算过、算过以后又改了的要重算 */
const bakedFor = new Map<string, string>();
/** 算过、算失败了的：同一份设定不再试 */
const bakeFailed = new Map<string, string>();
/** 算别人用的设定：成人部件关着时照样藏起来（设定里留着，打开又回来，和当前角色一样） */
const bakeSpec = (f: SceneFigure) => gate(f.spec);
const bakeKey = (f: SceneFigure) => JSON.stringify([bakeSpec(f), adultOn()]);

/** 把一份设定用到的素材（素体、头发、成品角色的文件）载入好；载不进来的不管（算的时候照退回去的样子算） */
async function loadAssetsFor(s: BodySpec): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const jobs: Promise<unknown>[] = [];
  const style = s.hair.style;
  if (s.bodyStyle !== 'mannequin' && !animeReady()) jobs.push(loadAnimeBody(base).then(giveShapes));
  if (s.bodyStyle !== 'character' && style !== 'own' && !hairReady(style)) jobs.push(loadHairShape(style, base).then((b) => giveHair(style, b)));
  if (s.counts.penises && !genitalReady()) jobs.push(loadGenital(base).then(giveGenital));
  if (wantsTrunk(s) && !chuTorsoReady()) jobs.push(loadChuTorso(base).then(giveChuTorso));
  if (s.bodyStyle === 'character') {
    for (const id of charactersOf(s)) {
      if (characterSource(id)) continue;
      jobs.push(id === OWN_CHARACTER ? restoreOwnCharacter() : loadCharacter(id, base));
    }
    if (style !== 'own' && !hairDonor(style)) jobs.push(loadHair(style, base));
  }
  await Promise.allSettled(jobs);
  // 染了色的头发要浅色的贴图（见 ensureHairLight）
  if (s.bodyStyle === 'character' && (s.hair.color || s.hair.heads.some((v) => v && v !== HAIR_UNDYED) || style !== 'own')) {
    const sources = [...charactersOf(s).map(characterSource), hairDonor(style)?.source ?? null];
    await Promise.allSettled(
      sources.map((source) => {
        if (!source || hairLit(source) || lightening.has(source)) return null;
        lightening.add(source);
        return lightenHair(source).finally(() => lightening.delete(source));
      }),
    );
  }
}

/** 正在后台算别人 */
let bakingOthers = false;
/** 场景里还没算好（或者设定改过了）的别人，挨个在后台算；当前角色不算 */
async function bakeOthers() {
  if (bakingOthers) return;
  bakingOthers = true;
  try {
    for (;;) {
      const next = scene.figures.find((f) => f.id !== scene.current && bakedFor.get(f.id) !== bakeKey(f) && bakeFailed.get(f.id) !== bakeKey(f));
      if (!next) break;
      const key = bakeKey(next);
      try {
        await loadAssetsFor(bakeSpec(next));
        const baked = await bakeFigure(bakeSpec(next));
        const now = figureOf(scene, next.id);
        // 算的时候删掉了、又改了：这一份不要（改了的下一圈重算）
        if (!now || bakeKey(now) !== key) continue;
        sceneView.setView(next.id, bakedView(baked), baked.box);
        othersBones.set(next.id, { bones: baked.bones, height: baked.height });
        scheduleSceneClash();
        bakedFor.set(next.id, key);
        bakeFailed.delete(next.id);
        // 成品角色的文件这时才载进来：它的骨架重新取，手上带着的道具跟到位
        otherFrames.delete(next.id);
        showCarried();
        sceneBounds();
        renderSceneBar();
        renderFigureList();
      } catch (err) {
        bakeFailed.set(next.id, key);
        setStatus(t('场景里的「{name}」没算出来：{err}', { name: figureLabel(next), err: errText(err) }), true);
      }
    }
  } finally {
    bakingOthers = false;
  }
}

/** 摆放换成矩阵：先绕竖直轴转，再挪到地上那一点 */
const placeMatrix = (p: Place) => new Matrix4().makeRotationY((p.yaw * Math.PI) / 180).setPosition(p.x, placeY(p), p.z);

/** 当前角色在场景里换了位置（或者换了当前角色）：镜头跟着挪，屏幕上别的东西看起来不动 */
function shiftView(from: Place, to: Place) {
  if (!viewport || samePlace(from, to)) return;
  const m = placeMatrix(to).invert().multiply(placeMatrix(from));
  viewport.camera.position.applyMatrix4(m);
  viewport.controls.target.applyMatrix4(m);
  viewport.controls.update();
}

/** 每个别人摆到相对当前角色的位置；底座圈跟着场景里有几个人显示 */
function placeAll() {
  const here = currentOf(scene).place;
  for (const f of scene.figures) sceneView.place(f.id, relativePlace(here, f.place));
  // 当前角色站在原点：它站在台子上的话，地面在它脚下那么多
  viewport?.setFloor(-placeY(here));
  sceneView.setActive(scene.current);
  sceneView.showRings(ringsOn && scene.figures.length > 1);
  propsPanel.follow();
  sceneBounds();
  scheduleSceneClash();
  // 角色挪了：它手上带着的道具跟着走
  showCarried();
}

/**
 * 挪一个角色（场景里的绝对位置）。挪的是当前角色：别人和镜头反着挪（屏幕上看是它自己走过去）。
 * live：拖着的时候，只挪屏幕上的，不记撤销、不存档（当前角色松手时 commitPlace）
 */
function movePlace(id: string, place: Place, live = false) {
  const f = figureOf(scene, id);
  if (!f) return;
  const was = f.place;
  scene = updateFigure(scene, id, { place });
  const now = figureOf(scene, id)!.place;
  if (id === scene.current) shiftView(was, now);
  placeAll();
  syncPlaceDials();
  if (live || id === scene.current) return;
  // 别人：记进它自己的撤销历史（切到它时能撤回来），存档
  const h = histories.get(id) ?? new History<Snapshot>({ ...snapOf(f), place: was }, HISTORY_OPTIONS);
  // 它自己挪了：整个人跟着道具的照新位置重新记，钉在道具上的手脚留在道具上
  const posed = resettle(id);
  h.seal();
  h.push(snapOf(figureOf(scene, id)!));
  histories.set(id, h);
  save();
  if (posed) void bakeOthers();
}

/** 当前角色的摆放改完了：记一步撤销、存档 */
function commitPlace(key?: string) {
  // 它自己挪了：整个人跟着道具的照新位置重新记，钉在道具上的手脚留在道具上
  resettle(scene.current);
  if (!key) history.seal();
  commit(key);
}

/** 屏幕上现在显示当前角色的那几个模型（复制成灰色的人影用） */
const shownRoots = () => [model.root, fused.root, characterModel.root, flatParts.root];

/** 切走前：当前角色变成定住的。设定和上次算的一样就直接用算好的那张，不一样就先摆灰色的人影，后台重算 */
function freezeCurrent() {
  const f = currentOf(scene);
  if (bakedFor.get(f.id) !== bakeKey(f) || !sceneView.has(f.id)) sceneView.setGhost(f.id, shownRoots(), ownBox.clone());
}

/** 切走（新建、复制、切换、删掉前）：当前角色的设定、撤销存回场景，变成定住的 */
function stashCurrent() {
  if (pending) rebuild();
  endSlide();
  history.seal();
  scene = updateFigure(scene, scene.current, { spec, text });
  histories.set(scene.current, history);
  freezeCurrent();
}

/** 换成另一个角色：存好当前的，读进那一个（和撤销恢复走同一条路），重建 */
function switchFigure(id: string) {
  if (id === scene.current || !figureOf(scene, id)) return;
  if (poseHandles?.busy || placing) return;
  stashCurrent();
  loadFigure(id, true);
  void bakeOthers();
}

/** 切过来的角色自己的网格还没算出来：屏幕上先接着显示它定住的那份（最多等这么久） */
let holdTimer = 0;
function holdLive() {
  live.visible = false;
  sceneView.holdActive(true);
  window.clearTimeout(holdTimer);
  holdTimer = window.setTimeout(releaseLive, 15_000);
}
function releaseLive() {
  if (live.visible) return;
  window.clearTimeout(holdTimer);
  live.visible = true;
  sceneView.holdActive(false);
}

/**
 * 把场景里的这个角色读进界面，当成当前的（上一个已经存好了）。
 * follow：镜头照「从上一个当前角色到它」挪（画面不跳）；不挪的话镜头停在原处（对着它自己的原点）
 */
function loadFigure(id: string, follow: boolean) {
  const from = currentOf(scene).place;
  scene = setCurrent(scene, id);
  const to = currentOf(scene);
  spec = gate(to.spec);
  readText(to.text);
  desc.value = text;
  tookNow = histories.get(id)?.current.picked;
  history = histories.get(id) ?? new History<Snapshot>(snapNow(), HISTORY_OPTIONS);
  carry(null);
  // 只属于上一个角色的东西清掉：选中的部件和关节、摆姿势的骨架、钉住的手脚、刚套的现成姿势、染哪个头……
  // （手机上取消选中会让镜头飞回选中前的地方：那是上一个角色的坐标，不飞）
  viewBeforePick = null;
  select(null);
  selectJoint(null);
  leavePose();
  kit = null;
  pinned.clear();
  lastPreset = null;
  presetPair = null;
  dyeHead = null;
  torsoEdit = 'all';
  bodyKey = '';
  if (follow) shiftView(from, to.place);
  holdLive();
  placeAll();
  save();
  render();
  renderSceneBar();
  syncScenePanel();
}

/** 新角色站在哪：场景里所有人的右手边 */
function freeSpot(radius: number): Place {
  return besideAll(
    scene.figures.map((f) => ({ x: f.place.x, z: f.place.z, radius: sceneView.radiusOf(f.id) })),
    radius,
  );
}

/** 加一个角色并切过去 */
function addAndSwitch(figure: Omit<SceneFigure, 'id'>, ghostFromScreen: boolean) {
  const fromId = scene.current;
  scene = setCurrent(addFigure(scene, figure), fromId);
  const added = scene.figures[scene.figures.length - 1];
  sceneView.setGhost(added.id, ghostFromScreen ? shownRoots() : [], ghostFromScreen ? ownBox.clone() : new Box3());
  loadFigure(added.id, true);
  refitAll();
  return added;
}

/** 加一个角色并切过去。copy：复制当前的（连姿势；名字后面加「副本」）；不然是一个默认的白模 */
function newFigure(copy: boolean) {
  if (poseHandles?.busy || placing) return;
  stashCurrent();
  const me = currentOf(scene);
  const fresh = defaultSpec();
  if (copy) {
    addAndSwitch({ name: me.name ? t('{name} 副本', { name: me.name }) : '', spec, text, place: { ...freeSpot(sceneView.radiusOf(me.id)), yaw: me.place.yaw } }, true);
    setStatus(t('复制了一份「{name}」，站在右手边。', { name: figureLabel(me) }));
  } else {
    addAndSwitch({ name: '', spec: fresh, text: describeSpec(fresh), place: freeSpot(0.3) }, false);
    setStatus(t('新加了一个角色，站在右手边。'));
  }
  void bakeOthers();
}

/** 刚删掉的那个：能「恢复刚删的」（只记最后一个） */
let lastRemoved: { figure: SceneFigure; at: number; label: string; history: History<Snapshot> | undefined } | null = null;

async function deleteFigure(id: string) {
  const f = figureOf(scene, id);
  if (!f || scene.figures.length <= 1) return;
  if (!(await askConfirm(t('删掉「{name}」？', { name: figureLabel(f) }), t('删掉')))) return;
  const wasCurrent = id === scene.current;
  if (wasCurrent) {
    if (pending) rebuild();
    endSlide();
    history.seal();
    scene = updateFigure(scene, id, { spec, text });
  }
  const gone = figureOf(scene, id)!;
  const label = figureLabel(gone);
  lastRemoved = { figure: gone, at: indexOf(scene, id), label, history: wasCurrent ? history : histories.get(id) };
  // 删的是当前的：镜头照「从它到接替它的那个」挪
  const from = gone.place;
  scene = removeFigure(scene, id);
  histories.delete(id);
  bakedFor.delete(id);
  bakeFailed.delete(id);
  sceneView.remove(id);
  othersBones.delete(id);
  if (wasCurrent) {
    shiftView(from, currentOf(scene).place);
    loadFigure(scene.current, false);
  } else {
    placeAll();
    save();
    renderSceneBar();
    syncScenePanel();
  }
  setStatus(t('删掉了「{name}」。点「恢复刚删的」能放回来。', { name: label }));
  void bakeOthers();
}

function undoRemove() {
  const gone = lastRemoved;
  if (!gone || poseHandles?.busy || placing) return;
  lastRemoved = null;
  stashCurrent();
  const fromId = scene.current;
  scene = setCurrent(restoreFigure(scene, gone.figure, gone.at), fromId);
  if (gone.history) histories.set(gone.figure.id, gone.history);
  sceneView.setGhost(gone.figure.id, [], new Box3());
  loadFigure(gone.figure.id, true);
  setStatus(t('「{name}」放回来了。', { name: gone.label }));
  void bakeOthers();
}

/** 镜头框住整个场景 */
function refitAll() {
  if (withScene(ownBox).isEmpty()) return;
  sceneBounds();
  viewport?.refit();
}
/** 镜头只框住当前角色（别的角色照样显示） */
function refitCurrent() {
  if (!viewport || ownBox.isEmpty()) return;
  viewport.setBounds(ownBox);
  viewport.refit();
  sceneBounds();
}

/** 读进一整个场景（场景文件）：换掉现在的全部角色 */
function useScene(next: Scene) {
  if (pending) rebuild();
  endSlide();
  sceneView.clear();
  histories.clear();
  bakedFor.clear();
  bakeFailed.clear();
  lastRemoved = null;
  scene = next;
  // 换了一整个场景：上一个场景里道具各在哪、多大不算数了（不然新场景的道具正好挪到同一处时，连着的手脚不跟）
  followedKey = '';
  followedSizes.clear();
  noteSizes();
  propLed.clear();
  otherFrames.clear();
  carriedView = null;
  carriedShown = null;
  propsPanel.reset();
  for (const f of scene.figures) if (f.id !== scene.current) sceneView.setGhost(f.id, [], new Box3());
  refitNext = true;
  loadFigure(scene.current, false);
  void bakeOthers();
}

/* ---- 小框：要不要删、要不要换掉整个场景 ---- */

const askDialog = $<HTMLDialogElement>('askDialog');
/** 上一个还没答的小框：再弹新的时当作取消 */
let asking: ((ok: boolean) => void) | null = null;
function askConfirm(message: string, ok: string, no = t('取消')): Promise<boolean> {
  asking?.(false);
  $('askText').textContent = message;
  $('askOk').textContent = ok;
  $('askNo').textContent = no;
  askDialog.returnValue = '';
  if (!askDialog.open) askDialog.showModal();
  return new Promise((resolve) => {
    asking = (answer) => {
      asking = null;
      resolve(answer);
    };
  });
}
// 点了哪个按钮就当场作数（不等 close 事件：它跟着页面重绘走，页面藏着时不来）；按 Esc、点外面关掉是取消
for (const btn of askDialog.querySelectorAll<HTMLButtonElement>('button')) {
  btn.addEventListener('click', () => asking?.(btn.value === 'ok'));
}
askDialog.addEventListener('close', () => asking?.(askDialog.returnValue === 'ok'));

/* ---- 把模型文件拖进窗口：当成道具导入（见 docs/import-plan.md） ---- */

window.addEventListener('dragover', (e) => {
  // 不拦的话松手时浏览器会把页面换成那个文件
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  // 松手以后这份东西就读不到了：要的先当场取出来
  const picked = droppedFiles(e.dataTransfer);
  void picked.then((files) => {
    if (!files.some((f) => propsPanel.accepts(f.path))) return setStatus(t('拖进来的东西里没有工坊认的模型：当道具导入的话要 GLB、glTF、OBJ、STL、FBX，或者装着它们的 zip 包。'), true);
    void propsPanel.importFiles(files);
  });
});

/* ---- 3D 视图上：脚下的底座圈拖着挪、转；点别的角色切过去 ---- */

const RINGS_KEY = 'oc-basemesh-rings';
let ringsOn = true;
try {
  ringsOn = localStorage.getItem(RINGS_KEY) !== 'off';
} catch {
  // 读不到就显示
}
const ringsBox = $<HTMLInputElement>('sceneRings');
ringsBox.checked = ringsOn;
ringsBox.addEventListener('change', () => {
  ringsOn = ringsBox.checked;
  try {
    localStorage.setItem(RINGS_KEY, ringsOn ? 'on' : 'off');
  } catch {
    // 记不住也照样用
  }
  placeAll();
});

/** 正在拖的底座圈：拖的是谁、拖圈还是小球、按下时它在哪、按下的那一点在地上的哪（场景的绝对坐标） */
let placing: { id: string; part: 'ring' | 'knob'; start: Place; grabbed: Place; pointer: number } | null = null;
/** 这一下点中的是道具：后面部件、关节的点选不用再管（按下时清掉） */
let clickTaken = false;
const ground = new Plane(new Vector3(0, 1, 0), 0);

function rayAt(e: PointerEvent): Raycaster | null {
  if (!viewport) return null;
  const rect = viewport.renderer.domElement.getBoundingClientRect();
  const ndc = new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new Raycaster();
  ray.setFromCamera(ndc, viewport.camera);
  return ray;
}

/** 光标指着地上的哪一点（场景的绝对坐标） */
function groundAt(e: PointerEvent, id: string): Place | null {
  // 圈在那个角色脚下：它离地多高，就在多高的平面上找
  const here = currentOf(scene).place;
  const f = figureOf(scene, id);
  ground.constant = -(f ? placeY(f.place) - placeY(here) : 0);
  const hit = rayAt(e)?.ray.intersectPlane(ground, new Vector3());
  if (!hit) return null;
  return absolutePlace({ ...here, y: 0 }, { x: hit.x, z: hit.z, yaw: 0 });
}

/** 网格自己和所有上级都显示着 */
function isShownObject(o: { visible: boolean; parent: unknown }): boolean {
  for (let p = o as { visible: boolean; parent: unknown } | null; p; p = p.parent as typeof p) if (!p.visible) return false;
  return true;
}

if (viewport) {
  const dom = viewport.renderer.domElement;
  let down: { x: number; y: number; time: number } | null = null;
  // 抢在操纵杆、摆姿势的圆点、转视角前面（捕获阶段）：按在底座圈上就是拖圈，别的不管
  dom.addEventListener(
    'pointerdown',
    (e) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY, time: performance.now() } : null;
      clickTaken = false;
      if (e.button !== 0 || scene.figures.length < 2) return;
      const ray = rayAt(e);
      const hit = ray && sceneView.hitRing(ray);
      const at = hit && groundAt(e, hit.id);
      if (!hit || !at) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      try {
        dom.setPointerCapture(e.pointerId);
      } catch {
        // 指针已经没了（极少见）：不抓也照样能拖，只是拖出画布外就收不到
      }
      viewport!.controls.enabled = false;
      placing = { id: hit.id, part: hit.part, start: figureOf(scene, hit.id)!.place, grabbed: at, pointer: e.pointerId };
      down = null;
    },
    { capture: true },
  );
  dom.addEventListener(
    'pointermove',
    (e) => {
      if (!placing || e.pointerId !== placing.pointer) return;
      e.stopImmediatePropagation();
      const at = groundAt(e, placing.id);
      if (!at) return;
      const { start, grabbed } = placing;
      const next =
        placing.part === 'ring'
          ? { ...start, x: start.x + at.x - grabbed.x, z: start.z + at.z - grabbed.z }
          : { ...start, yaw: (Math.atan2(at.x - start.x, at.z - start.z) * 180) / Math.PI };
      // 转方向时按住 Shift：每 15° 一档
      if (placing.part === 'knob' && e.shiftKey) next.yaw = Math.round(next.yaw / 15) * 15;
      movePlace(placing.id, next, true);
    },
    { capture: true },
  );
  const release = (e: PointerEvent) => {
    if (placing && e.pointerId === placing.pointer) {
      e.stopImmediatePropagation();
      const { id, start } = placing;
      placing = null;
      viewport!.controls.enabled = true;
      const now = figureOf(scene, id)?.place;
      if (!now || samePlace(now, start)) return;
      if (id === scene.current) commitPlace();
      else {
        // 别人：拖着的时候屏幕上已经挪到了，这里照「从 start 挪到 now」记一步
        scene = updateFigure(scene, id, { place: start });
        movePlace(id, now);
      }
      return;
    }
    // 点一下（没怎么动）：点中的是道具就选中它，是别的角色就切过去
    const d = down;
    down = null;
    if (e.type !== 'pointerup' || !d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.time > 600) return;
    const ray = rayAt(e);
    if (!ray) return;
    const other = scene.figures.length > 1 ? sceneView.hitFigure(ray) : null;
    const mine = ray.intersectObjects(shownRoots(), true).find((h) => isShownObject(h.object));
    // 道具：比角色都近才算点中它；按在部件的操纵杆、姿势的圆点和旋转环上的不算。点在别处，选中的道具放掉
    if (!gizmo?.busy && !poseHandles?.engaged && propsPanel.click(ray, Math.min(mine?.distance ?? Infinity, other?.distance ?? Infinity))) {
      clickTaken = true;
      return;
    }
    if (!other) return;
    if (mine && mine.distance < other.distance) return;
    switchFigure(other.id);
  };
  dom.addEventListener('pointerup', release, { capture: true });
  dom.addEventListener('pointercancel', release, { capture: true });
}

/* ---- 面板：「场景」那一栏，3D 视图上的角色条 ---- */

const figureList = $('figureList');
const figureName = $<HTMLInputElement>('figureName');
figureName.addEventListener('input', () => {
  scene = updateFigure(scene, scene.current, { name: figureName.value });
  save();
  renderSceneBar();
  renderFigureList();
});
figureName.addEventListener('change', () => syncScenePanel());

/** 摆放的三个滑块：左右、前后（厘米）、朝向（度） */
const PLACE_DIALS = [
  { key: 'x', id: 's-placeX', scale: 100, text: (v: number) => (v ? `${v > 0 ? '→' : '←'}${Math.abs(v)} cm` : t('正中')) },
  { key: 'z', id: 's-placeZ', scale: 100, text: (v: number) => (v ? (v > 0 ? t('往前 {n} cm', { n: v }) : t('往后 {n} cm', { n: -v })) : t('正中')) },
  { key: 'yaw', id: 's-placeYaw', scale: 1, text: (v: number) => (v ? (v > 0 ? t('左转 {n}°', { n: Math.abs(v) }) : t('右转 {n}°', { n: Math.abs(v) })) : t('朝前')) },
  // 离地：滑块只管 -1–3 米（再高再低的在道具带着走时照样记得住）
  { key: 'y', id: 's-placeY', scale: 100, range: [-1, 3], text: (v: number) => (v ? (v > 0 ? t('离地 {n} cm', { n: v }) : t('地面以下 {n} cm', { n: -v })) : t('在地上')) },
] as const;
const placeDials = PLACE_DIALS.map((d) => {
  const input = $<HTMLInputElement>(d.id);
  const [lo, hi] = 'range' in d ? d.range : PLACE_LIMITS[d.key];
  input.min = String(lo * d.scale);
  input.max = String(hi * d.scale);
  input.step = '1';
  input.addEventListener('input', () => {
    const p = currentOf(scene).place;
    movePlace(scene.current, { ...p, [d.key]: Number(input.value) / d.scale }, true);
  });
  input.addEventListener('change', () => commitPlace());
  return () => {
    const v = Math.round((currentOf(scene).place[d.key] ?? 0) * d.scale);
    if (Number(input.value) !== v) input.value = String(v);
    $(`o-${d.id.slice(2)}`).textContent = d.text(v);
  };
});
function syncPlaceDials() {
  for (const sync of placeDials) sync();
}
$('btnPlaceReset').addEventListener('click', () => {
  const p = currentOf(scene).place;
  if (!p.yaw) return;
  movePlace(scene.current, { ...p, yaw: 0 });
  commitPlace();
});
$('btnPlaceDrop').addEventListener('click', () => dropFigure());

function iconButton(label: string, title: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const btn = el('button', 'icon', label);
  btn.type = 'button';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

function renderFigureList() {
  const rows = scene.figures.map((f, i) => {
    const on = f.id === scene.current;
    const row = el('div', on ? 'figure-row on' : 'figure-row');
    const pick = el('button', 'figure-pick');
    pick.type = 'button';
    pick.title = on ? t('现在改的就是它') : t('切过去改它');
    pick.setAttribute('aria-pressed', String(on));
    pick.addEventListener('click', () => switchFigure(f.id));
    const waiting = !on && sceneView.waiting(f.id);
    pick.append(el('span', 'figure-name', figureLabel(f)), el('span', 'figure-style', waiting ? t('正在算…') : BODY_LABEL[f.spec.bodyStyle]));
    const reorder = (step: -1 | 1) => () => {
      scene = moveFigure(scene, f.id, step);
      save();
      renderSceneBar();
      syncScenePanel();
    };
    row.append(
      pick,
      iconButton('↑', t('往前挪一格'), reorder(-1), i === 0),
      iconButton('↓', t('往后挪一格'), reorder(1), i === scene.figures.length - 1),
      iconButton('✕', t('删掉这个角色'), () => void deleteFigure(f.id), scene.figures.length <= 1),
    );
    return row;
  });
  figureList.replaceChildren(...rows);
}

/** 「场景」那一栏跟上现在的场景 */
function syncScenePanel() {
  renderFigureList();
  const me = currentOf(scene);
  if (document.activeElement !== figureName) figureName.value = me.name;
  figureName.placeholder = t('角色 {n}', { n: indexOf(scene, me.id) + 1 });
  syncPlaceDials();
  const many = scene.figures.length > 1;
  // 只有一个角色时这一组一样都没有，小标题也不出
  $('scenePlaceHead').hidden = !many && !scene.props.length;
  // 有道具时一个角色也能挪：站到道具旁边、上面
  $('placeField').hidden = !many && !scene.props.length;
  // 「看全部」「看当前」：好几个角色、或者放了道具时才有
  $('sceneViewRow').hidden = !many && !scene.props.length;
  ringsBox.closest('label')!.hidden = !many;
  const restore = $<HTMLButtonElement>('btnFigureRestore');
  restore.hidden = !lastRemoved;
  if (lastRemoved) restore.textContent = t('恢复刚删的「{name}」', { name: lastRemoved.label });
  syncPairPanel();
  // 「导出哪些」：好几个角色、或者放了道具时才问（只导当前角色不带道具）
  const whole = many || scene.props.length > 0;
  $('exportWhatField').hidden = !whole;
  if (!whole) exportWhat = 'current';
  syncExportWhat(exportWhat, whole);
  syncExportProps();
}

/** 3D 视图上方的角色条：好几个角色时才有，点一下切过去 */
function renderSceneBar() {
  const bar = $('sceneBar');
  bar.hidden = scene.figures.length < 2;
  if (bar.hidden) return;
  const chips = scene.figures.map((f) => {
    const on = f.id === scene.current;
    const chip = el('button', 'scene-chip', figureLabel(f));
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(on));
    if (!on && sceneView.waiting(f.id)) chip.classList.add('waiting');
    chip.title = on ? t('现在改的就是它') : t('切过去改它');
    chip.addEventListener('click', () => switchFigure(f.id));
    return chip;
  });
  const more = el('button', 'scene-chip add', '+');
  more.type = 'button';
  more.title = t('加角色、摆位置');
  more.setAttribute('aria-label', more.title);
  more.addEventListener('click', () => phone.open('scene'));
  bar.replaceChildren(...chips, more);
}

$('btnFigureNew').addEventListener('click', () => newFigure(false));
$('btnFigureCopy').addEventListener('click', () => newFigure(true));
$('btnFigureRestore').addEventListener('click', undoRemove);
$('btnSceneAll').addEventListener('click', refitAll);
$('btnSceneCurrent').addEventListener('click', refitCurrent);

/** 导出的是当前角色还是整个场景（好几个角色、或者放了道具时才问） */
type ExportWhat = 'current' | 'scene';
const EXPORT_WHATS = ['current', 'scene'] as const;
let exportWhat: ExportWhat = 'current';
const syncExportWhat = buildSeg(
  $('segExportWhat'),
  EXPORT_WHATS,
  (v) => (v === 'current' ? t('当前角色') : t('整个场景')),
  (v) => {
    exportWhat = v;
    syncExportWhat(v, true);
    syncExportProps();
  },
);
/** 「带上道具」：导出整个场景、场景里又有道具时才出现，默认勾着 */
const exportPropsBox = $<HTMLInputElement>('exportProps');
function syncExportProps() {
  $('exportPropsRow').hidden = exportWhat !== 'scene' || !scene.props.length;
}

/* ---- 场景文件：保存、打开 ---- */

async function saveSceneFile() {
  const name = await askFileName('scene');
  if (!name) return;
  try {
    save();
    const where = await saveText(name, serializeScene(scene, specData, true));
    setStatus(t('已保存场景 {file}（{n} 个角色），{where}。', { file: name, n: scene.figures.length, where }));
  } catch (err) {
    setStatus(t('场景没存成：{err}', { err: errText(err) }), true);
  }
}
$('btnSceneSave').addEventListener('click', () => void saveSceneFile());

/** 读到的文件是场景：问一声再换掉现在的全部角色。返回是不是场景文件 */
async function openSceneData(data: unknown, fileName: string): Promise<boolean> {
  if (!isSceneData(data)) return false;
  const next = normalizeScene(data, readFigureSpec);
  if (!next) throw new Error('bad scene');
  const ask = t('换成「{name}」里的 {n} 个角色？现在场景里的 {m} 个会被换掉（想留着的话先「保存场景」）。', { name: fileName, n: next.figures.length, m: scene.figures.length });
  if (scene.figures.length > 1 && !(await askConfirm(ask, t('换掉')))) return true;
  useScene(next);
  setStatus(t('已打开场景 {name}（{n} 个角色）。', { name: fileName, n: next.figures.length }));
  return true;
}

/** 「打开场景…」：场景文件换掉整个场景；一个角色的配置文件加进场景，站在右手边 */
const fileScene = $<HTMLInputElement>('fileScene');
fileScene.addEventListener('change', async () => {
  const file = fileScene.files?.[0];
  fileScene.value = '';
  if (!file) return;
  try {
    const data: unknown = JSON.parse(await file.text());
    if (await openSceneData(data, file.name)) return;
    if (typeof data !== 'object' || data === null || !('counts' in data)) throw new Error('not a scene');
    if (poseHandles?.busy || placing) return;
    const { spec: s, text: tx } = readFigureSpec(data);
    stashCurrent();
    addAndSwitch({ name: cleanName(file.name.replace(/\.json$/i, '')), spec: s, text: tx, place: freeSpot(0.35) }, false);
    setStatus(t('把 {name} 加进了场景，站在右手边。', { name: file.name }));
    void bakeOthers();
  } catch {
    setStatus(t('这个文件不是有效的场景或配置文件。'), true);
  }
});

/* ---- 导出整个场景 ---- */

const SCENE_FILE: Record<ExportKind, string> = { glb: 'oc_scene.glb', rig: 'oc_scene_rig.glb', obj: 'oc_scene.obj', stl: 'oc_scene.stl' };
/** 文件里的物体名：字母、数字、汉字留着，别的换成下划线 */
const objectName = (f: SceneFigure) => figureLabel(f).replace(/[^\p{L}\p{N}_-]+/gu, '_') || f.id;
const propObjectName = (p: SceneProp) => propLabel(p).replace(/[^\p{L}\p{N}_-]+/gu, '_') || p.id;

/** 一块形状照摆放搬到场景里（米） */
function placedShape(positions: Float32Array, normals: Float32Array | undefined, place: Place) {
  const a = (place.yaw * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const p = new Float32Array(positions.length);
  const n = normals ? new Float32Array(normals.length) : undefined;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];
    p[i] = c * x + s * z + place.x;
    p[i + 1] = positions[i + 1] + placeY(place);
    p[i + 2] = -s * x + c * z + place.z;
    if (n && normals) {
      const nx = normals[i];
      const nz = normals[i + 2];
      n[i] = c * nx + s * nz;
      n[i + 1] = normals[i + 1];
      n[i + 2] = -s * nx + c * nz;
    }
  }
  return { positions: p, normals: n };
}

/**
 * 导出整个场景：每个角色照它自己的设定按导出精度重算一遍（摆过姿势的是摆好的样子，不管现在在哪一页），
 * 摆到场景里各自的位置。GLB 每个角色一个父节点；带骨骼的每个角色一副骨架；OBJ、STL 写在一起。
 * 勾着「带上道具」时道具也写进去：GLB 里每件一个父节点（带着位置、朝向），OBJ、STL 里是搬到位的面
 */
/** 整个场景写成一个文件：文件名、内容、给状态栏的说明（不存，见 exportScene） */
async function sceneFile(kind: ExportKind): Promise<{ fileName: string; blob: Blob; what: string }> {
  if (pending) rebuild();
  save();
  const figures = scene.figures;
  const done: { figure: SceneFigure; baked: Baked }[] = [];
  for (const [i, f] of figures.entries()) {
    setStatus(t('正在算场景里的第 {i} 个角色（共 {n} 个）…', { i: i + 1, n: figures.length }));
    const s = f.id === scene.current ? spec : bakeSpec(f);
    await loadAssetsFor(s);
    done.push({ figure: f, baked: await bakeFigure(s, { rig: kind === 'rig', fine: true }) });
  }
  const props = exportPropsBox.checked ? propsNow() : [];
  // 素材道具的网格要先取到：没取到时屏幕上是方块顶着的，不能把方块导出去
  if (props.some((p) => p.kind === 'asset' && !skinnedAsset(p.asset))) await loadPropAssets(import.meta.env.BASE_URL);
  // 写实款这台设备上没有的先下回来（下不了就停在这，说明原因）
  for (const id of new Set(props.flatMap((p) => (p.kind === 'asset' && realAsset(p.asset) ? [p.asset as string] : [])))) await loadRealAsset(id);
  // 导入的素材这台设备上没有的：导出去就是个方块，先拦住
  const lost = await loadUserAssets(props.flatMap((p) => (p.kind === 'asset' && isUserAssetId(p.asset) ? [p.asset] : [])));
  if (lost.length) {
    const names = [...new Set(props.flatMap((p) => (p.asset && lost.includes(p.asset) ? [propLabel(p)] : [])))];
    throw new Error(t('场景里有导入的素材这台设备上没有（{names}）：先重新导入，或者导出时不带道具', { names: names.join(t('、')) }));
  }
  const credits = [...new Set(done.flatMap((d) => d.baked.credits))];
  const credit = credits.length ? credits.join(t('；')) : undefined;
  let blob: Blob;
  if (kind === 'glb' || kind === 'rig') {
    const glb = mergeGlbs([
      ...done.map(({ figure, baked }) => ({ glb: bakedGlb(baked, kind === 'rig', objectName(figure)), name: objectName(figure), ...figure.place })),
      ...propGlbParts(props, propObjectName),
    ]);
    blob = glbBlob(glb);
  } else {
    const shapes = [
      ...done.flatMap(({ figure, baked }) =>
        baked.shapes.map((m) => ({ name: `${objectName(figure)}_${m.name}`, ...placedShape(m.positions, m.normals, figure.place), triangles: m.triangles })),
      ),
      ...propWorldShapes(props, propObjectName),
    ];
    blob =
      kind === 'obj'
        ? new Blob([writeObj(shapes.map((m) => ({ name: m.name, positions: m.positions, normals: m.normals, faces: m.triangles, faceSize: 3 })), credit)], { type: 'text/plain' })
        : new Blob([writeStl(shapes.map((m) => ({ positions: m.positions, triangles: m.triangles })))], { type: 'model/stl' });
  }
  const triangles = done.reduce((n, d) => n + d.baked.triangles, 0) + propTriangles(props);
  const what = [
    t('整个场景 {n} 个角色', { n: figures.length }),
    ...(props.length ? [t('{n} 件道具', { n: props.length })] : []),
    t('{n} 三角面', { n: count(triangles) }),
    ...(kind === 'rig' ? [t('每个角色一副骨架')] : []),
    ...(credit ? [t('发出去时请署名「{credit}」', { credit })] : []),
  ].join(t('，'));
  return { fileName: SCENE_FILE[kind], blob, what };
}

async function exportScene(kind: ExportKind) {
  for (const button of Object.values(exportButtons)) button.disabled = true;
  try {
    const { fileName, blob, what } = await sceneFile(kind);
    const where = await saveBlob(fileName, blob);
    setStatus(t('已导出 {file}（{what}，{size}），{where}。', { file: fileName, what, size: sizeText(blob.size), where }));
  } catch (err) {
    setStatus(t('导出失败：{err}', { err: errText(err) }), true);
  } finally {
    for (const button of Object.values(exportButtons)) button.disabled = false;
  }
}

/* ---- 角色之间的肢体互动（见 scene/interact.ts）：穿插提示、手脚碰到别人停在表面、双人动作 ---- */

/** 别人摆好以后的骨架（照它们屏幕上定住的那张算的），和静止时的身高 */
const othersBones = new Map<string, { bones: RigBone[]; height: number }>();

/** 当前角色屏幕上的骨架：摆姿势时是摆好的，造型时是静止的（和屏幕上一样） */
let restBonesFor: { body: unknown; bones: RigBone[] } | null = null;
function currentBones(): { bones: RigBone[]; height: number } | null {
  const body = character ?? figure;
  if (!body) return null;
  if (restBonesFor?.body !== body) restBonesFor = { body, bones: character ? characterSkeleton(character).bones : buildSkeleton(figure!).bones };
  const rest = restBonesFor.bones;
  const height = heightOf(rest);
  if (mode === 'pose' && kit && poseFrame) return { bones: posedBones(kit.solver.rig, poseFrame), height };
  return { bones: rest, height };
}

/** 别人的胶囊体，摆到当前角色的坐标里（当前角色站在原点） */
function othersCapsules(except?: string): { id: string; caps: Capsule[] }[] {
  const here = currentOf(scene).place;
  const out: { id: string; caps: Capsule[] }[] = [];
  for (const f of scene.figures) {
    if (f.id === scene.current || f.id === except) continue;
    const got = othersBones.get(f.id);
    if (got) out.push({ id: f.id, caps: placeCapsules(capsulesOf(got.bones, got.height), relativePlace(here, f.place)) });
  }
  return out;
}

/** 现在和谁穿插：插得最深的那个人和那几处 */
let sceneClash: { id: string; clashes: FigureClash[] } | null = null;
let sceneClashTimer = 0;
/** 姿势、位置、谁是当前的变了：停一下再查一遍穿插（拖着的时候不每帧查） */
function scheduleSceneClash() {
  window.clearTimeout(sceneClashTimer);
  sceneClashTimer = window.setTimeout(checkSceneClash, 250);
}
function checkSceneClash() {
  let worst: { id: string; clashes: FigureClash[] } | null = null;
  const me = scene.figures.length > 1 ? currentBones() : null;
  if (me) {
    const mine = capsulesOf(me.bones, me.height);
    for (const { id, caps } of othersCapsules()) {
      const clashes = figureClashes(mine, caps);
      if (clashes.length && (!worst || clashes[0].depth > worst.clashes[0].depth)) worst = { id, clashes };
    }
  }
  sceneClash = worst;
  const note = $('sceneClash');
  const row = $('sceneClashRow');
  row.hidden = !worst;
  if (worst) {
    const other = figureOf(scene, worst.id);
    const where = worst.clashes
      .slice(0, 3)
      .map((c) => t('{mine} × {theirs}', { mine: t(PART_LABEL[c.mine]), theirs: t(PART_LABEL[c.theirs]) }))
      .join(t('、'));
    note.textContent = t('和「{name}」穿插：{where}（最深 {cm} 厘米）', { name: other ? figureLabel(other) : '', where, cm: Math.round(worst.clashes[0].depth * 100) });
  }
  const text = worst ? note.textContent ?? '' : '';
  // 身体插进了道具里：说插得最深的那一件
  const mine = scene.props.length ? currentBones() : null;
  propClash = mine ? propClashes(capsulesOf(mine.bones, mine.height), propSolids()) : [];
  const first = propClash[0];
  const prop = first && propsNow().find((p) => p.id === first.id);
  const propText = prop
    ? t('和「{name}」穿插：{where}（最深 {cm} 厘米）', {
        name: propLabel(prop),
        where: propClash
          .filter((c) => c.id === first.id)
          .slice(0, 3)
          .map((c) => t(PART_LABEL[c.part]))
          .join(t('、')),
        cm: Math.round(first.depth * 100),
      })
    : '';
  const propNote = $('propClash');
  propNote.hidden = !propText;
  propNote.textContent = propText;
  if (text !== sceneClashNote || propText !== propClashNote) {
    sceneClashNote = text;
    propClashNote = propText;
    drawReadout();
  }
}

/** 身体现在插进了哪些道具里（见 scene/propTouch.ts） */
let propClash: PropClash[] = [];
/** 场景里的道具，换到当前角色的坐标里（它站在原点） */
function propSolids(): PropSolid[] {
  const here = currentOf(scene).place;
  return propsNow().map((p) => propSolid(p, here));
}

/** 挪开到不穿插：当前角色顺着「从那个人到自己」的方向一点点往外挪，挪到和他不穿插为止（最多 3 米） */
function stepAway() {
  const clash = sceneClash;
  const me = currentBones();
  const other = clash && figureOf(scene, clash.id);
  if (!clash || !me || !other) return;
  const here = currentOf(scene).place;
  const rel = relativePlace(here, other.place);
  // 当前角色的坐标里：从那个人指向自己（原点）的水平方向；站在同一点上就往自己的右手边（-X）挪
  let dir: [number, number] = [-rel.x, -rel.z];
  const d = Math.hypot(dir[0], dir[1]);
  dir = d > 1e-3 ? [dir[0] / d, dir[1] / d] : [-1, 0];
  const mine = capsulesOf(me.bones, me.height);
  const theirs = othersCapsules().find((o) => o.id === clash.id)?.caps ?? [];
  let step = 0;
  for (; step < 150; step++) {
    const shift = (step + 1) * 0.02;
    const moved = mine.map((c) => ({ ...c, a: [c.a[0] + dir[0] * shift, c.a[1], c.a[2] + dir[1] * shift] as V3, b: [c.b[0] + dir[0] * shift, c.b[1], c.b[2] + dir[1] * shift] as V3 }));
    if (!figureClashes(moved, theirs).length) break;
  }
  const shift = (step + 1) * 0.02;
  const to = absolutePlace(here, { x: dir[0] * shift, z: dir[1] * shift, yaw: 0 });
  movePlace(scene.current, { ...here, x: to.x, z: to.z });
  commitPlace();
  setStatus(t('挪开了 {cm} 厘米。', { cm: Math.round(shift * 100) }));
  scheduleSceneClash();
}
$('btnStepAway').addEventListener('click', stepAway);

/** 摆姿势时手脚碰到别人就停在表面（这台设备记着） */
const TOUCH_KEY = 'oc-basemesh-touch';
let touchStop = true;
try {
  touchStop = localStorage.getItem(TOUCH_KEY) !== 'off';
} catch {
  // 读不到就开着
}
const touchBox = $<HTMLInputElement>('sceneTouch');
touchBox.checked = touchStop;
touchBox.addEventListener('change', () => {
  touchStop = touchBox.checked;
  try {
    localStorage.setItem(TOUCH_KEY, touchStop ? 'on' : 'off');
  } catch {
    // 记不住也照样用
  }
});
/** 这一次拖动里，别人的身体（按下时取一次） */
let touchCaps: Capsule[] | null = null;
/** 这一次拖动里，场景里的道具（换到当前角色的坐标，按下时取一次） */
let touchSolids: PropSolid[] = [];
/** 这一次拖动里，上一下停在了哪（道具那一步之后的） */
let touchLast: V3 | null = null;
function grabTouch(handle?: Handle) {
  touchCaps = touchStop && scene.figures.length > 1 ? othersCapsules().flatMap((o) => o.caps) : null;
  // 自己手上带着的道具会跟着身体走：按下时它在哪不算数，不挡、不吸。
  // 只有拖别的手脚时（带着道具的那只手这时不动）才算它，好让另一只手也抓上去
  const limb = handle?.kind === 'reach' ? limbOf(handle) : undefined;
  const mine = myLinks().filter((l) => l.carry);
  const skip = new Set(limb && !mine.some((l) => l.part === limb.name) ? [] : mine.map((l) => l.prop));
  const solids = touchStop || snapOn ? propSolids().filter((s) => !skip.has(s.id)) : [];
  touchSolids = touchStop ? solids : [];
  touchLast = null;
  // 带着道具的手不吸：一只手只抓一件，吸上别的就等于把手上的放下了
  snapSolids = snapOn && !(limb && mine.some((l) => l.part === limb.name)) ? solids : [];
  gripSnap = null;
}
/**
 * 拖的那个点离道具表面留多少（标准身高 1.7 米时，米）：拖的是手腕、脚踝、胯的关节，不是皮肤。
 * 手留一个手掌厚；脚踝离脚底有一截；胯到屁股底下更厚
 */
const TOUCH_ROOM = { hand: 0.03, foot: 0.07, body: 0.1 } as const;
/**
 * 拖手脚、拖胯的目标点：在别人身体里面、在道具里面就推到表面上。
 * 拖胯只看道具（坐到椅子上、躺到床上）；两个人的身子挨多近照旧随便摆，有穿插提示管着
 */
function touchTarget(target: V3, what: keyof typeof TOUCH_ROOM = 'hand', start?: V3): V3 {
  if (!touchCaps?.length && !touchSolids.length) return target;
  const k = (currentBones()?.height ?? 1.7) / 1.7;
  let out = target;
  if (touchCaps?.length && what !== 'body') out = pushOut(out, touchCaps, TOUCH_ROOM.hand * k);
  if (touchSolids.length) {
    // 道具有薄板（桌面、坐面）：要记着是从哪一边来的，从上一下停的地方接着走（见 slideOutOfSolids）
    const from = touchLast ?? start;
    out = from ? slideOutOfSolids(from, out, touchSolids, TOUCH_ROOM[what] * k) : pushOutOfSolids(out, touchSolids, TOUCH_ROOM[what] * k);
    touchLast = out;
  }
  return out;
}

/* ---- 吸附：拖手脚拖到道具跟前自己吸上去，松手就抓住（见 docs/grab-plan.md 第 3 期；这台设备记着开没开） ---- */

const SNAP_KEY = 'oc-basemesh-snap';
let snapOn = true;
try {
  snapOn = localStorage.getItem(SNAP_KEY) !== 'off';
} catch {
  // 读不到就开着
}
const snapBox = $<HTMLInputElement>('poseSnap');
snapBox.checked = snapOn;
snapBox.addEventListener('change', () => {
  snapOn = snapBox.checked;
  try {
    localStorage.setItem(SNAP_KEY, snapOn ? 'on' : 'off');
  } catch {
    // 记不住也照样用
  }
});
/**
 * 拖的那个点（手腕、脚踝）离道具表面不到这么远就吸上去（标准身高 1.7 米时，米）。
 * 脚踝离脚底有一截、「停在表面」时就离着 7 厘米，所以脚的放宽些。
 * 吸着以后要再拖出 SNAP_OUT 才放开，免得在边上来回跳
 */
const SNAP_IN = { hand: 0.06, foot: 0.1 } as const;
const SNAP_OUT = 0.03;
/** 这一次拖动里能吸的道具（当前角色的坐标，按下时取一次） */
let snapSolids: PropSolid[] = [];
/** 这会儿吸在哪件道具上：哪条肢体、道具上亮的那一圈、手脚落位以后朝哪、在哪 */
let gripSnap: { prop: string; part: string; mark: SeatMark; rot: Quat; end: V3 } | null = null;

/**
 * 拖手脚的这一下要不要吸到道具上。to 是照鼠标该去的地方，dragged 是照它拖到的姿势；
 * 吸上了返回落到道具上的姿势（并记在 gripSnap 里），没吸返回 dragged
 */
function snapDrag(limb: number, to: V3, dragged: PoseState): PoseState {
  const was = gripSnap;
  gripSnap = null;
  if (!kit || !grab || !snapSolids.length) return dragged;
  const one = kit.solver.limbs[limb];
  const k = linkScale();
  let best: PropSolid | null = null;
  let least = Infinity;
  for (const solid of snapSolids) {
    const reach = (SNAP_IN[one.kind === 'leg' ? 'foot' : 'hand'] + (was?.prop === solid.id && was.part === one.name ? SNAP_OUT : 0)) * k;
    // 先看盒子够不够近
    if (to.some((v, i) => v < solid.min[i] - reach || v > solid.max[i] + reach)) continue;
    const dist = solidDistance(solid, to);
    if (dist <= reach && dist < least) {
      least = dist;
      best = solid;
    }
  }
  const prop = best && propOf(propsNow(), best.id);
  if (!best || !prop) return dragged;
  // 上一下就吸在这件道具上：照上一下落位的朝向接着算（不然手跟着前臂一转，就在杆的两边来回换着握）
  const sticky = was && was.prop === prop.id && was.part === one.name ? was.rot : null;
  const from = sticky ? dragReach(kit.solver, grab.start, limb, to, grab.pins, sticky) : dragged;
  const got = snapReach(kit.solver, grab.start, limb, grab.pins, from, currentOf(scene).place, prop, best);
  if (!got) return dragged;
  gripSnap = { prop: prop.id, part: one.name, mark: got.mark, rot: got.rot, end: forward(kit.solver.rig, got.state).pos[one.end] };
  return got.state;
}

/**
 * 松手：手脚吸在道具上的话抓住（踩住）它，返回 true；没吸着返回 false。
 * 只改场景里记的连接和屏幕上的姿势，这一步的撤销由紧跟着的 commitPose 记
 */
function snapRelease(handle: Handle | undefined): boolean {
  const snap = gripSnap;
  gripSnap = null;
  poseHandles?.snap(null);
  const limb = handle?.kind === 'reach' ? limbOf(handle) : undefined;
  const prop = snap && propOf(propsNow(), snap.prop);
  if (!snap || !limb || limb.name !== snap.part || !prop || !kit || !poseState) return false;
  // 屏幕上的姿势中途被重摆过（后台重建完了正好插进来）、手已经不在吸着的地方：不算吸着
  if (len(sub(forward(kit.solver.rig, poseState).pos[limb.end], snap.end)) > HOLD_ON * linkScale()) return false;
  const me = currentOf(scene);
  const old = linkOf(myLinks(), limb.name);
  // 原来就抓着的：握紧度照旧（拖到过 0、自己摆过手指的还是不自己握）；新抓的握到碰着
  const got = grabLink(kit.solver, poseState, me.place, prop, limb.name, old ? old.grip : 1);
  if (!got) return false;
  poseState = following(got.state);
  scene = updateFigure(scene, me.id, { links: setLink(me.links, got.link) });
  regripDue = true;
  if (old?.prop !== prop.id) {
    setStatus(
      isFootPart(limb.name)
        ? t('{part}踩住「{name}」了：挪它、转它，这只脚跟着走。不想让它自己踩住：把脚拖开，或者关掉「姿势」里的「吸附」。', { part: limbLabel(limb.name), name: propLabel(prop) })
        : twoHandNote(limb.name, prop)
          ? t('{part}也抓住「{name}」了。', { part: limbLabel(limb.name), name: propLabel(prop) }) + twoHandNote(limb.name, prop)
          : t('{part}抓住「{name}」了：挪它、转它，这只手跟着走。不想让它自己抓住：把手拖开，或者关掉「姿势」里的「吸附」。', { part: limbLabel(limb.name), name: propLabel(prop) }),
    );
  }
  markHandles();
  propsPanel.refresh();
  return true;
}

/* ---- 钉住和跟随：角色和道具的连接（见 model/links.ts、scene/follow.ts） ---- */

/**
 * 场景里的道具现在各在哪：显示、导出、查穿插、跟随、一键动作都问它，不直接读清单（见 docs/grab-plan.md 第 0 期）。
 * 「道具跟着手」的那几件照手现算（见 scene/carry.ts）；别的就是清单。没变时返回的是同一份（sceneSolids 靠这个认变没变）。
 * live：当前角色照屏幕上的姿势算（拖着的时候是还没存的）；false 是照存着的姿势算（写回清单时用）
 */
function propsNow(live = true): readonly SceneProp[] {
  const base = scene.props;
  // carryReady：这个文件从上往下跑到「道具跟着手」那一段之前，下面用到的东西还没备好（那时候也还没有屏幕）
  if (!carryReady || !base.length) return base;
  const by = carriers(live);
  if (!by.length) return base;
  const out = placeCarried(base, by, live && carriedView?.base === base ? carriedView.out : undefined);
  if (live) carriedView = { base, out };
  return out;
}
// 用 var：要在这一行跑到之前就能读（读到的是 undefined，当作还没备好）
var carryReady: boolean | undefined;

/** 当前角色现在用得上的连接（道具还在的） */
const myLinks = (): PropLink[] => liveLinks(currentOf(scene).links, propsNow());
/** 当前角色抓着、踩着道具的手脚各该在哪、朝哪（它自己的坐标） */
const myHolds = () => holdTargets(currentOf(scene).place, currentOf(scene).links, propsNow(), propLed);

/** 场景里的道具（场景的坐标）：找最近的道具、往下找落脚的面用。清单没变就用上次算的 */
let sceneSolidsFor: { props: readonly SceneProp[]; solids: PropSolid[] } | null = null;
function sceneSolids(): PropSolid[] {
  const props = propsNow();
  if (sceneSolidsFor?.props !== props) sceneSolidsFor = { props, solids: props.map((p) => propSolid(p)) };
  return sceneSolidsFor.solids;
}

/** 一条手臂、腿叫什么（Hand_L → 左手，Foot_R.002 → 右脚 2） */
function limbLabel(part: string): string {
  const m = /^(Hand|Foot)(?:_([LR]))?(?:\.(\d+))?$/.exec(part);
  if (!m) return part;
  const base = m[1] === 'Hand' ? (m[2] === 'L' ? t('左手') : t('右手')) : m[2] === 'L' ? t('左脚') : m[2] === 'R' ? t('右脚') : t('中间的脚');
  return m[3] ? `${base} ${Number(m[3])}` : base;
}
const linkPartLabel = (part: string): string => (part === BODY_LINK ? t('整个人') : /^(UpperChest|Chest|Spine)/.test(part) ? t('胸口') : limbLabel(part));

/** 连着这件道具的：谁的哪里（面板上「连着它的」那几行） */
function linksTo(prop: string): { figure: string; part: string; label: string }[] {
  return scene.figures.flatMap((f) =>
    (f.links ?? [])
      .filter((l) => l.prop === prop)
      .map((l) => ({ figure: f.id, part: l.part, label: `${figureLabel(f)} · ${linkPartLabel(l.part)}${l.carry ? t('（带着它）') : t('（跟着它）')}` })),
  );
}

/** 新放的道具用了删掉的那件的编号：原来连着那件的连接不算数了（不然会连到新的这件上） */
function forgetLinks(before: readonly SceneProp[]) {
  const fresh = scene.props.filter((p) => !propOf(before, p.id)).map((p) => p.id);
  if (!fresh.length) return;
  for (const f of scene.figures) {
    if (!f.links?.some((l) => fresh.includes(l.prop))) continue;
    scene = updateFigure(scene, f.id, { links: f.links.filter((l) => !fresh.includes(l.prop)) });
    if (f.id === scene.current) history.amend(snapNow());
    else amendOf(histories.get(f.id), figureOf(scene, f.id)!);
  }
}

/** 拖道具时当前角色在屏幕上被带到了哪（场景里的摆放）：只是屏幕上的，松手才真的改；没在带着是 null */
let carried: Place | null = null;
function carry(to: Place | null) {
  if (!to && !carried) return;
  carried = to;
  const rel = to ? relativePlace(currentOf(scene).place, to) : ORIGIN;
  live.position.set(rel.x, placeY(rel), rel.z);
  live.rotation.set(0, (rel.yaw * Math.PI) / 180, 0);
  // 圆点、旋转环没跟着挪：先收起来，松手落位以后再出来
  if (poseHandles) poseHandles.veiled = Boolean(to);
}

/* ---- 道具跟着手（见 scene/carry.ts、docs/grab-plan.md 第 4 期） ---- */

const anyCarried = () => scene.figures.some((f) => f.links?.some((l) => l.carry));

/** 当前角色的骨架现在各根骨骼在哪（它自己的坐标）。身体还没照现在的设定建好返回 null */
function myFrame(live: boolean): { solver: Solver; frame: Frame } | null {
  // 刚换了当前角色：屏幕上的身体还是上一个角色的
  if (!bodyKey) return null;
  if (live && mode === 'pose' && kit && poseState && posedFrom === spec.posing) {
    if (liveFrame?.key !== poseState || liveFrame.solver !== kit.solver) liveFrame = { key: poseState, solver: kit.solver, frame: forward(kit.solver.rig, poseState) };
    return liveFrame;
  }
  if (!live && bodyKey !== bodyKeyOf()) return null;
  const solver = ensureKit()?.solver;
  if (!solver) return null;
  if (savedFrame?.key !== spec.posing || savedFrame.solver !== solver) savedFrame = { key: spec.posing, solver, frame: forward(solver.rig, stateOf(solver, spec.posing)) };
  return savedFrame;
}

/** 别的角色的骨架现在各根骨骼在哪（它自己的坐标）；算不出来返回 null */
function frameOf(f: SceneFigure): { solver: Solver; frame: Frame } | null {
  const had = otherFrames.get(f.id);
  if (had?.spec === f.spec) return had;
  try {
    const solver = makeSolver(skeletonFor(bakeSpec(f)));
    const got = { spec: f.spec, solver, frame: forward(solver.rig, stateOf(solver, f.spec.posing)) };
    otherFrames.set(f.id, got);
    return got;
  } catch {
    return null;
  }
}

/** 现在带着道具的那几只手、脚各在场景里的哪、朝哪 */
function carriers(live: boolean): Carrier[] {
  const out: Carrier[] = [];
  for (const f of scene.figures) {
    const links = f.links?.filter((l) => l.carry && l.rot && !propLed.has(l.prop));
    if (!links?.length) continue;
    const mine = f.id === scene.current;
    const got = mine ? myFrame(live) : frameOf(f);
    if (!got) continue;
    // 当前角色正被拖着的道具带着走（坐在椅子上、椅子在拖）：照屏幕上它被带到的地方
    const place = mine && live && carried ? carried : f.place;
    for (const link of links) {
      // 手、脚的连接写的是末端那根骨骼的名字；抱着的写的是胸口那根骨骼的名字
      const bone = got.solver.rig.index.get(link.part);
      if (bone !== undefined) out.push({ link, point: toScene(place, got.frame.pos[bone]), rot: sceneRot(place, got.frame.rot[bone]) });
    }
  }
  return out;
}

/** 带着的道具可能挪了（手动了、角色挪了、身体变了）：屏幕上的道具、连在它上面的别的角色跟上。只动屏幕，不存 */
function showCarried() {
  if (!carryReady || (carriedShown === null && !anyCarried())) return;
  const now = propsNow();
  if (now === carriedShown) return;
  carriedShown = anyCarried() ? now : null;
  propsPanel.moved();
  // 别的角色坐在它上面、抓着它的：跟着挪（当前角色自己别的手留到落定时再摆）
  followProps(true, false);
  sceneBounds();
  scheduleSceneClash();
}

/**
 * 落定：带着的道具现在在哪，写回清单——不另记一步撤销，是角色那一步（或者道具那一步）的后果。
 * 这样放下、松开、删掉角色的那一下，道具就留在原地；撤销回到拿起来之前，道具也在那时候的地方。
 * 返回清单改了没有
 */
function settleCarried(): boolean {
  if (!carryReady || settling || propWriting || propLed.size || !anyCarried()) return false;
  // 当前角色的身体还没照现在的设定重建：它带着的那几件等重建完再写（见 rebuild）
  settleDue = Boolean(currentOf(scene).links?.some((l) => l.carry)) && (!bodyKey || bodyKey !== bodyKeyOf());
  const now = propsNow(false);
  if (now === scene.props) return false;
  settling = true;
  try {
    scene = { ...scene, props: now };
    carriedView = null;
    propsPanel.amend(now);
    // 连在这件道具上的（别的角色、这个角色别的手脚）跟过去
    followProps(false);
  } finally {
    settling = false;
  }
  carriedShown = propsNow();
  sceneBounds();
  scheduleSceneClash();
  return true;
}

/** 这几件道具现在各在哪（记进快照的 picked 用） */
function posesOf(ids: readonly string[]): Picked {
  const now = propsNow();
  const out: Record<string, { pos: Vec3; rot: Vec3 }> = {};
  for (const id of ids) {
    const prop = propOf(now, id);
    if (prop) out[id] = { pos: prop.pos, rot: prop.rot };
  }
  return out;
}

/**
 * 撤销了一步「把道具拿到身上」：那几件道具放回拿起来之前的地方——不另记撤销，是那一步的另一半。
 * 这会儿又被谁带着的（撤回去以后还是拿着，只是换了拿法）不动：它照带着它的那一处算
 */
function putBack(picked: Picked) {
  const held = new Set(scene.figures.flatMap((f) => (f.links ?? []).flatMap((l) => (l.carry ? [l.prop] : []))));
  let changed = false;
  const next = scene.props.map((p) => {
    const was = picked[p.id];
    if (!was || held.has(p.id) || samePose(p, was)) return p;
    changed = true;
    return { ...p, pos: was.pos, rot: was.rot };
  });
  if (!changed) return;
  scene = { ...scene, props: next };
  carriedView = null;
  propsPanel.amend(next);
  // 连在这件道具上的（别的角色、这个角色别的手脚）跟过去
  followProps(false);
  carriedShown = anyCarried() ? propsNow() : null;
  sceneBounds();
  scheduleSceneClash();
  save();
}

/** 道具面板要把清单换成 next：带着的道具里，这一下自己被挪了、改了尺寸的记进 propLed（手跟着它们去） */
function leadCarried(next: readonly SceneProp[]) {
  if (!anyCarried()) return;
  const view = propsNow();
  for (const f of scene.figures) {
    for (const l of f.links ?? []) {
      if (!l.carry) continue;
      const to = propOf(next, l.prop);
      const from = propOf(view, l.prop);
      if (to && from && to !== from && !(samePose(to, from) && to.size.join() === from.size.join())) propLed.add(l.prop);
    }
  }
  carriedView = null;
}

/** 当前角色的连接里绕圈的「带着」去掉（人整个跟着的道具不能又跟着这个人的手，见 carryLoops） */
function untangle(id: string) {
  const f = figureOf(scene, id);
  if (!f?.links?.some((l) => l.carry)) return;
  const looped = f.links.filter((l) => l.carry && carryLoops(scene.figures, id, l.prop));
  if (looped.length) scene = updateFigure(scene, id, { links: looped.reduce((links, l) => putDown(links, l.prop), [...f.links]) });
}

/** 这只手、这只脚现在不能带着这件道具的原因；能带返回 null */
function carryBlock(part: string, prop: SceneProp): string | null {
  const me = currentOf(scene);
  const by = carrierIn(
    scene.figures.filter((f) => f.id !== me.id),
    prop.id,
  );
  if (by) return t('「{who}」的{part}正带着「{name}」：一件道具只能跟着一处，先让那边放下', { who: figureLabel(figureOf(scene, by.figure)!), part: linkPartLabel(by.link.part), name: propLabel(prop) });
  if (carryLoops(scene.figures, me.id, prop.id)) return t('「{who}」整个人正跟着「{name}」（坐在、站在它上面），它不能再跟着{part}走', { who: figureLabel(me), name: propLabel(prop), part: linkPartLabel(part) });
  return null;
}

/**
 * 选中的那只抓着道具的手（踩着道具的脚）：换成道具跟着它走（拿着），或者换回道具不动（抓着）。
 * 记的是同一份相对位置，换的那一下手和道具都不动
 */
function setCarry(on: boolean) {
  const choice = linkChoice();
  const limb = choice && kit?.solver.limbs.find((l) => l.name === choice.part);
  if (!choice?.link || !limb || !kit || !poseState) return syncPoseLink();
  const { part, prop } = choice;
  const me = currentOf(scene);
  const names = { part: limbLabel(part), name: propLabel(prop) };
  if (!on) {
    // 道具留在现在的地方（清单里已经是这个位置：每次存档都写回去了）
    settleCarried();
    scene = updateFigure(scene, me.id, { links: setLink(me.links, withCarry(choice.link, false)) });
    commitLinks();
    return setStatus(t('「{name}」放下了，留在现在的地方；{part}还抓在它上面，挪它、转它{part}跟着走。', names));
  }
  const block = carryBlock(part, prop);
  if (block) {
    syncPoseLink();
    return setStatus(block, true);
  }
  // 手这会儿没在抓着的那一点上（够不着悬着的、老存档里没记朝向的）：照手现在在哪重新记，不然一勾上道具就跳到手上
  const frame = forward(kit.solver.rig, poseState);
  const point = toScene(me.place, frame.pos[limb.end]);
  let link = choice.link;
  if (!link.rot || len(sub(point, linkPoint(prop, link))) > 1e-3) link = withGrip(linkTo(prop, part, point, undefined, sceneRot(me.place, frame.rot[limb.end])), link.grip ?? 0);
  // 这个角色别的手脚原来带着它的：换成这一只带，那一只改成抓着（原来是抱着的，就不抱了）
  scene = updateFigure(scene, me.id, { links: setLink(putDown(me.links, prop.id), withCarry(link, true)) });
  commitLinks();
  setStatus(
    isFootPart(part)
      ? t('「{name}」跟着{part}了：拖这只脚、拖身体、挪角色，它都跟着走、跟着转。要它留在原地：去掉「道具跟着这只脚」的勾。', names)
      : t('「{name}」拿在{part}上了：拖这只手、拖身体、挪角色、换姿势，它都跟着走、跟着转。要它留在原地：去掉「道具跟着这只手」的勾。', names),
  );
}

/* ---- 两只手拿、抱着（见 docs/grab-plan.md 第 5 期） ---- */

/** 当前角色自己带着的道具（跟着它的手、脚、胸口走的那几件） */
const myCarried = (): Set<string> => new Set(myLinks().flatMap((l) => (l.carry ? [l.prop] : [])));

/**
 * 抓在、踩在自己带着的道具上的手脚各该在哪：道具跟着身体走，它们跟着道具走（不算钉在原地）。
 * skip：不算这一只（正拖着、正转着的）
 */
function ridingHolds(skip?: string): HoldTarget[] {
  const mine = myCarried();
  return mine.size ? myHolds().filter((h) => !h.carried && mine.has(h.prop) && h.part !== skip) : [];
}

/** 屏幕上的姿势刚算出来（拖着、转着的每一下）：抓在自己带着的道具上的手脚，跟到道具现在的地方 */
function rideCarried(skip?: string) {
  if (!kit || !poseState) return;
  const targets = ridingHolds(skip);
  if (targets.length) poseState = holdState(kit.solver, poseState, targets, { grip: 'never' });
}

/**
 * 按下的是不是「两只手拿」里不带着道具的那只手：道具跟着这个角色的另一只手（脚），这个角色抓在它上面的只有这一只。
 * 是的话记下主手是哪条肢体：拖这只手，道具绕着主手抓的那一点转（见 swingReach）。
 * 三只以上的手抓着、道具跟着胸口的（抱着）：不转，这只手只在道具上换地方抓
 */
function swingFor(handle: Handle | undefined) {
  if (!grab || !kit || handle?.kind !== 'reach') return;
  const limb = limbOf(handle);
  const links = myLinks();
  const mine = limb && linkOf(links, limb.name);
  if (!limb || !mine || mine.carry) return;
  const on = links.filter((l) => l.prop === mine.prop);
  const by = on.find((l) => l.carry);
  const carrier = by ? kit.solver.limbs.findIndex((l) => l.name === by.part) : -1;
  if (carrier < 0 || on.length !== 2) return;
  grab.swing = { carrier, slack: LINK_NEAR[limb.kind === 'leg' ? 'foot' : 'hand'] * linkScale() };
}

/** 抓在自己带着的道具上的手脚，离它该在的那一点差得比这个还多（米，照身高缩放）：松手时算够不着、放开 */
const RIDE_SLIP = 0.03;
/** 拖带着道具的那只手时，别的手离道具差得比这个还多（米）：道具停在这之前 */
const RIDE_MISS = 2e-3;

/** 屏幕上的姿势里，抓在自己带着的道具上的手脚离它们该在的那一点最远差多少（米）、是哪一只；先 rideCarried 再量 */
function rideMiss(skip?: string): { miss: number; hold: HoldTarget | null } {
  let worst: { miss: number; hold: HoldTarget | null } = { miss: 0, hold: null };
  if (!kit || !poseState) return worst;
  const targets = ridingHolds(skip);
  if (!targets.length) return worst;
  const frame = forward(kit.solver.rig, poseState);
  for (const hold of targets) {
    const limb = kit.solver.limbs.find((l) => l.name === hold.part);
    const miss = limb ? len(sub(frame.pos[limb.end], hold.target)) : 0;
    if (miss > worst.miss) worst = { miss, hold };
  }
  return worst;
}

/**
 * 拖的是带着道具的那只手（脚）、别的手脚还抓在道具上：它们伸直了也够不着道具要去的地方时，
 * 道具停在它们还够得着的最远处（几只手之间的距离是定死的）。
 * 硬拉开、差得比「挨着」还远了就不拦：道具跟着主手走，够不着的那只手松手时放开（见 dropStretched）。
 * to：这一下手要去的地方（角色自己的坐标）
 */
function tether(index: number, to: V3) {
  if (!kit || !grab || !poseState) return;
  const { solver } = kit;
  const limb = solver.limbs[index];
  if (!myLinks().some((l) => l.part === limb.name && l.carry)) return;
  const worst = rideMiss(limb.name);
  if (worst.miss <= RIDE_MISS || worst.miss > LINK_NEAR.hand * linkScale()) return;
  const { start, pins } = grab;
  const from = grab.frame.pos[limb.end];
  /** 手只走到 k 成（0–1）：摆好，量别的手差多少 */
  const at = (k: number) => {
    const point: V3 = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k];
    poseState = following(dragReach(solver, start, index, point, pins));
    rideCarried(limb.name);
    return rideMiss(limb.name).miss;
  };
  // 按下那一刻就有悬着的：不管，照手要去的地方摆
  if (at(0) > RIDE_MISS) {
    at(1);
    return;
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) <= RIDE_MISS) lo = mid;
    else hi = mid;
  }
  at(lo);
  // 说一声，不然像是拖不动
  const prop = worst.hold && propOf(propsNow(), worst.hold.prop);
  if (worst.hold && prop) setStatus(t('{part}伸直了，拉住了「{name}」；再往外拖，这只手就松开。', { part: limbLabel(worst.hold.part), name: propLabel(prop) }));
}

/**
 * 松手前：抓在自己带着的道具上的手脚，够不着道具现在的地方、差出 RIDE_SLIP 的，松开
 * （几只手之间的距离是定死的，硬拉开、转过头就是放手；手不悬在半空）。
 * 只改场景里记的连接，这一步的撤销由紧跟着的 commitPose 记
 */
function dropStretched() {
  if (!kit || !poseState) return;
  const targets = ridingHolds();
  if (!targets.length) return;
  poseState = holdState(kit.solver, poseState, targets, { grip: 'never' });
  const frame = forward(kit.solver.rig, poseState);
  const me = currentOf(scene);
  let links = me.links;
  let lost: HoldTarget | null = null;
  for (const hold of targets) {
    const limb = kit.solver.limbs.find((l) => l.name === hold.part);
    if (!limb || len(sub(frame.pos[limb.end], hold.target)) <= RIDE_SLIP * linkScale()) continue;
    links = dropLink(links, hold.part);
    lost = hold;
  }
  if (!lost) return;
  scene = updateFigure(scene, me.id, { links });
  const prop = propOf(propsNow(), lost.prop);
  setStatus(t('{part}够不着「{name}」了，松开了。', { part: limbLabel(lost.part), name: prop ? propLabel(prop) : '' }), true);
  markHandles();
  propsPanel.refresh();
}

/** 另一只手也抓上了自己拿着的道具：说一句拖哪只手是什么效果；不是这种情况返回 '' */
function twoHandNote(part: string, prop: SceneProp): string {
  const on = myLinks().filter((l) => l.prop === prop.id);
  const by = on.find((l) => l.carry);
  if (!by || by.part === part) return '';
  const main = linkPartLabel(by.part);
  if (on.length === 2 && kit?.solver.limbs.some((l) => l.name === by.part)) return t('拖这只手，「{name}」绕着{main}转；拖{main}，它带着这只手走。', { name: propLabel(prop), main });
  return t('「{name}」跟着{main}走，这只手跟着它；拖这只手是在它上面换个地方抓。', { name: propLabel(prop), main });
}

/** 当前角色的胸口正带着这件道具（抱着） */
const hugging = (prop: string): boolean => myLinks().some((l) => l.carry && l.prop === prop && !isLimbPart(l.part));

/**
 * 抱着：这件道具跟着当前角色的胸口走（弯腰、转身、挪角色都带着）。照现在的相对位置记，点的那一下道具不动。
 * 这个角色原来用手拿着它的，改成手抓着它（跟着它走）
 */
function hugProp(propId: string) {
  const prop = propOf(propsNow(), propId);
  const got = myFrame(true);
  if (!prop || !got) return setStatus(t('正在生成网格…'));
  const me = currentOf(scene);
  const bone = chestBone(got.solver.rig, got.frame, fromScene(me.place, propPoint(prop, [0, prop.size[1] / 2, 0])));
  if (bone < 0) return setStatus(t('这个身体上没找到胸口，抱不了。'), true);
  const part = got.solver.rig.names[bone];
  const block = carryBlock(part, prop);
  if (block) return setStatus(block, true);
  const link = withCarry(linkTo(prop, part, toScene(me.place, got.frame.pos[bone]), undefined, sceneRot(me.place, got.frame.rot[bone])), true);
  scene = updateFigure(scene, me.id, { links: setLink(putDown(me.links, prop.id), link) });
  commitLinks();
  setStatus(
    t('「{who}」抱着「{name}」了：弯腰、转身、拖胯、挪角色，它都跟着胸口走。把手拖到它上面抓住，手也跟着它。不抱了：在「连着它的」里点「解开」。', {
      who: figureLabel(me),
      name: propLabel(prop),
    }),
  );
}

// 到这里上面用到的东西都备好了：propsNow 可以照手算了
carryReady = true;

/**
 * 当前角色照连接摆好：整个人跟着道具的挪到位，钉在道具上的手脚回到钉着的点。
 * dragging：正拖着道具，只挪屏幕上的（镜头和坐标这时候不能动：操纵杆正照着它们算）；松手时才真的改，改的并进角色现在这一步里
 */
function followCurrent(dragging: boolean) {
  const me = currentOf(scene);
  const links = liveLinks(me.links, propsNow());
  if (!links.length) return carry(null);
  const to = followPlace(me.place, links, propsNow());
  // 带着道具的手：手在哪道具就在哪，这里不用摆（刚被挪了的那几件除外，见 propLed）
  const targets = holdTargets(to, links, propsNow(), propLed).filter((h) => !h.carried);
  if (dragging) {
    carry(samePlace(to, me.place) ? null : to);
    if (mode === 'pose' && kit && poseState && targets.length && !poseHandles?.busy) {
      // 每一下都从存着的姿势算起：拖出去再拖回来，回到原样
      poseState = holdState(kit.solver, stateOf(kit.solver, spec.posing), targets, { grip: 'never' });
      posedFrom = spec.posing;
      showPose();
    }
    // 人被拖着的道具带着走（坐在椅子上、椅子在拖）：他手上拿着的道具也跟着
    showCarried();
    return;
  }
  carry(null);
  let changed = false;
  if (!samePlace(to, me.place)) {
    movePlace(me.id, to, true);
    changed = true;
  }
  const solver = targets.length ? ensureKit()?.solver : null;
  if (solver) {
    // 道具落定了（挪了、转了、改了尺寸）：手指照它现在的形状重新握
    let posing = spec.posing;
    const reseat = links.filter((l) => l.grip && resizedProps.has(l.prop));
    if (reseat.length) {
      // 改了尺寸的（杆粗了、细了）：抓着它的手先重新落位，再握——不然手还照原来的粗细摆着，手指握不实
      let state = holdState(solver, stateOf(solver, posing), targets, { grip: 'never' });
      let mine = currentOf(scene).links;
      for (const link of reseat) {
        const got = grabLink(solver, state, to, propOf(propsNow(), link.prop)!, link.part, link.grip);
        if (!got) continue;
        state = got.state;
        mine = setLink(mine, withCarry(got.link, Boolean(link.carry)));
      }
      scene = updateFigure(scene, me.id, { links: mine });
      posing = posingOf(solver, holdState(solver, state, holdTargets(to, mine, propsNow(), propLed), { grip: 'always' }), posing);
      changed = true;
    } else posing = holdPosing(solver, posing, targets, { grip: 'always' });
    if (posing !== spec.posing) {
      spec = { ...spec, posing };
      changed = true;
    }
  }
  if (!changed) return;
  history.amend(snapNow());
  save();
  render();
}

/** 别的角色照连接摆好。返回：挪了没有、姿势变了没有（变了要重新算它定住的那张网格） */
function followOther(f: SceneFigure, dragging: boolean): { moved: boolean; posed: boolean } {
  const links = liveLinks(f.links, propsNow());
  if (!links.length) return { moved: false, posed: false };
  const to = followPlace(f.place, links, propsNow());
  const moved = !samePlace(to, f.place);
  if (moved) scene = updateFigure(scene, f.id, { place: to });
  let posed = false;
  // 手脚重新摆要重算网格：拖着的时候不做，松手再做
  const targets = dragging ? [] : holdTargets(to, links, propsNow(), propLed).filter((h) => !h.carried);
  if (targets.length) {
    try {
      const posing = holdPosing(makeSolver(skeletonFor(bakeSpec(f))), f.spec.posing, targets, { grip: 'always' });
      if (posing !== f.spec.posing) {
        scene = updateFigure(scene, f.id, { spec: { ...f.spec, posing } });
        posed = true;
      }
    } catch {
      // 它用的素材还没载进来：先不摆，下次道具动的时候再摆
    }
  }
  if ((moved || posed) && !dragging) amendOf(histories.get(f.id), figureOf(scene, f.id)!);
  return { moved, posed };
}

/** 上一次跟着道具摆好时，道具各在哪、多大（没变就不用再摆）；拖着的时候跟过、还没落定 */
let followedKey = '';
let followLoose = false;
/** 上一次落定时每件道具多大；这一次落定时改了尺寸的是哪几件（抓着它们的手要重新落位，见 followCurrent） */
const followedSizes = new Map<string, string>();
let resizedProps: ReadonlySet<string> = new Set();
/** 记下每件道具现在多大；返回比上一次记的时候改了尺寸的那几件 */
function noteSizes(): Set<string> {
  const resized = new Set<string>();
  for (const p of propsNow()) {
    const size = p.size.join();
    const was = followedSizes.get(p.id);
    if (was !== undefined && was !== size) resized.add(p.id);
    followedSizes.set(p.id, size);
  }
  return resized;
}
noteSizes();
/**
 * 道具清单变了（拖着、改了数、撤销、删了），或者带着的道具跟着手挪了：连在道具上的角色跟着。
 * mine：当前角色也跟（手上带着的道具跟着手挪的那几下不跟：它别的手脚留到落定时再摆）
 */
function followProps(dragging: boolean, mine = true) {
  // 落定的时候（不是正拖着）：记下哪几件改了尺寸
  if (!dragging) resizedProps = noteSizes();
  if (!scene.figures.some((f) => f.links?.length)) return;
  const key = JSON.stringify(propsNow().map((p) => [p.id, p.pos, p.rot, p.size]));
  if (key === followedKey && !(followLoose && !dragging)) return;
  followedKey = key;
  followLoose = dragging;
  let moved = false;
  let posed = false;
  for (const f of scene.figures) {
    if (f.id === scene.current) continue;
    const got = followOther(f, dragging);
    moved ||= got.moved;
    posed ||= got.posed;
  }
  if (moved) placeAll();
  if (mine) followCurrent(dragging);
  if (posed) void bakeOthers();
}

/**
 * 角色自己挪了（拖底座圈、改了位置的数）：整个人跟着道具的，照新站的地方重新记（还跟着）；
 * 钉在道具上的手脚留在道具上。返回姿势变了没有
 */
function resettle(id: string): boolean {
  const f = figureOf(scene, id);
  const links = f && liveLinks(f.links, propsNow());
  if (!f || !links?.length) return false;
  const ride = linkOf(links, BODY_LINK);
  const prop = ride && propOf(propsNow(), ride.prop);
  if (prop) scene = updateFigure(scene, id, { links: setLink(f.links, rideLink(prop, f.place)) });
  const targets = holdTargets(f.place, links, propsNow(), propLed).filter((h) => !h.carried);
  if (!targets.length) return false;
  if (id === scene.current) {
    const solver = ensureKit()?.solver;
    const posing = solver ? holdPosing(solver, spec.posing, targets) : spec.posing;
    if (posing === spec.posing) return false;
    spec = { ...spec, posing };
    return true;
  }
  try {
    const posing = holdPosing(makeSolver(skeletonFor(bakeSpec(f))), f.spec.posing, targets);
    if (posing === f.spec.posing) return false;
    scene = updateFigure(scene, id, { spec: { ...f.spec, posing } });
    return true;
  } catch {
    return false;
  }
}

/** 当前角色的连接改完了：记一步撤销，面板上跟着变 */
function commitLinks() {
  history.seal();
  commit();
  markHandles();
  propsPanel.refresh();
}

/** 离多近才算「挨着道具」（标准身高 1.7 米时，米）：手腕、脚踝、胯到道具表面 */
const LINK_NEAR = { hand: 0.12, foot: 0.16, body: 0.45 } as const;
const linkScale = () => (currentBones()?.height ?? 1.7) / 1.7;

/** 手、脚上的连接叫「抓住」还是「踩住」：脚是踩 */
const isFootPart = (part: string) => /^Foot/.test(part);

/** 当前角色的一只手抓住、一只脚踩住道具（不说哪件就是最近的那件）：记下那一点和这会儿的朝向。返回连上了没有 */
function holdPart(part: string, propId?: string): boolean {
  const limb = kit?.solver.limbs.find((l) => l.name === part);
  if (!kit || !poseState || !poseFrame || !limb) return false;
  const me = currentOf(scene);
  const point = toScene(me.place, poseFrame.pos[limb.end]);
  const prop = propOf(propsNow(), propId ?? nearestSolid(sceneSolids(), point)?.id ?? null);
  if (!prop) return false;
  // 落位：手掌转过去对着道具（杆是握在四指根部）、脚底贴着面；带手指的手照道具的形状握上
  const got = grabLink(kit.solver, poseState, me.place, prop, part, 1);
  if (!got) return false;
  scene = updateFigure(scene, me.id, { links: setLink(me.links, got.link) });
  poseState = following(holdState(kit.solver, got.state, myHolds(), { grip: 'always' }));
  showPose();
  commitPose();
  markHandles();
  propsPanel.refresh();
  setStatus(
    isFootPart(part)
      ? t('{part}踩住「{name}」了：挪它、转它，这只脚跟着走；拖身体别处时脚留在上面。', { part: limbLabel(part), name: propLabel(prop) })
      : twoHandNote(part, prop)
        ? t('{part}也抓住「{name}」了。', { part: limbLabel(part), name: propLabel(prop) }) + twoHandNote(part, prop)
        : t('{part}抓住「{name}」了：挪它、转它，这只手跟着走；拖身体别处时手留在上面，手臂伸直了身体就被拉住。', { part: limbLabel(part), name: propLabel(prop) }),
  );
  return true;
}

/** 让当前角色整个人跟着一件道具（坐、躺、站在上面的） */
function rideProp(propId: string) {
  const prop = propOf(propsNow(), propId);
  if (!prop) return;
  const me = currentOf(scene);
  scene = updateFigure(scene, me.id, { links: setLink(me.links, rideLink(prop, me.place)) });
  // 人整个跟着它了：它不能又跟着这个人的手（原来拿着的改成抓着）
  untangle(me.id);
  commitLinks();
  setStatus(t('「{who}」整个人跟着「{name}」了：挪它、转它，人跟着走。', { who: figureLabel(me), name: propLabel(prop) }));
}

/** 解开一个连接（谁的、哪里）。别人的记进它自己的撤销历史 */
function unlinkPart(figureId: string, part: string) {
  const f = figureOf(scene, figureId);
  const link = linkOf(f?.links, part);
  if (!f || !link) return;
  const prop = propOf(propsNow(), link.prop);
  const h = figureId === scene.current ? null : (histories.get(figureId) ?? new History<Snapshot>(snapOf(f), HISTORY_OPTIONS));
  scene = updateFigure(scene, figureId, { links: dropLink(f.links, part) });
  if (h) {
    h.seal();
    h.push(snapOf(figureOf(scene, figureId)!));
    histories.set(figureId, h);
    save();
    propsPanel.refresh();
  } else commitLinks();
  setStatus(
    part === BODY_LINK
      ? t('「{who}」不跟着「{name}」了。', { who: figureLabel(f), name: prop ? propLabel(prop) : '' })
      : link.carry
        ? t('「{name}」放下了，留在现在的地方。', { name: prop ? propLabel(prop) : '' })
        : t('{part}从「{name}」上松开了。', { part: limbLabel(part), name: prop ? propLabel(prop) : '' }),
  );
}

/**
 * 拖完一只抓着、踩着道具的手、脚：还挨着那件道具就照新的地方、新的朝向重新记，拖开了就松开。
 * 只改场景里记的连接，这一步的撤销由紧跟着的 commitPose 记
 */
function relinkDragged(handle: Handle | undefined) {
  const limb = handle?.kind === 'reach' ? limbOf(handle) : undefined;
  const me = currentOf(scene);
  const link = limb && linkOf(myLinks(), limb.name);
  const prop = link && propOf(propsNow(), link.prop);
  // 道具跟着这只手的：手到哪它到哪，不用重新记
  if (!limb || !link || link.carry || !prop || !kit || !poseState) return;
  const frame = forward(kit.solver.rig, poseState);
  const point = toScene(me.place, frame.pos[limb.end]);
  const near = LINK_NEAR[limb.kind === 'leg' ? 'foot' : 'hand'] * linkScale();
  if (solidDistance(propSolid(prop), point) <= near) {
    // 换个地方抓：重新落位，握紧度照旧（紧跟着的 commitPose 里手指重新握）
    const got = grabLink(kit.solver, poseState, me.place, prop, limb.name, link.grip);
    if (got) {
      poseState = following(got.state);
      scene = updateFigure(scene, me.id, { links: setLink(me.links, got.link) });
      regripDue = true;
    }
  } else {
    scene = updateFigure(scene, me.id, { links: dropLink(me.links, limb.name) });
    setStatus(t('{part}从「{name}」上松开了。', { part: limbLabel(limb.name), name: propLabel(prop) }));
  }
  markHandles();
  propsPanel.refresh();
}

/**
 * 用旋转环转完一只抓着道具的手、踩着道具的脚：照转完的朝向重新记（不然一存就被转回原来的朝向）。
 * 抓在哪不变。只改场景里记的连接，这一步的撤销由紧跟着的 commitPose 记
 */
function relinkTurned(handle: Handle | undefined) {
  if (!handle || !kit || !poseState) return;
  const limb = kit.solver.limbs.find((l) => l.end === handle.turn);
  const me = currentOf(scene);
  const link = limb && linkOf(myLinks(), limb.name);
  const prop = link && propOf(propsNow(), link.prop);
  // 道具跟着这只手的：手转了它跟着转，不用重新记
  if (!limb || !link || link.carry || !prop) return;
  const rot = sceneRot(me.place, forward(kit.solver.rig, poseState).rot[limb.end]);
  scene = updateFigure(scene, me.id, { links: setLink(me.links, turnLink(prop, link, rot)) });
  regripDue = true;
}

/**
 * 自己摆了一只抓着道具的手的手指（手势栏、拖指尖、转指节）：这只手的手指以后不自己握了，
 * 不然下一回道具一动又被握回去。只改场景里记的连接，这一步的撤销由紧跟着的 commitPose 记
 */
function freeGrip(hands: readonly Hand[]) {
  const me = currentOf(scene);
  let links = me.links;
  let freed = '';
  for (const hand of hands) {
    const link = linkOf(links, hand.name);
    if (!link?.grip) continue;
    links = setLink(links, withGrip(link, 0));
    freed = hand.name;
  }
  if (!freed) return;
  scene = updateFigure(scene, me.id, { links });
  setStatus(t('{part}的手指改成自己摆了，不再自己握。要它再握上：点中这只手，拖「握紧」。', { part: limbLabel(freed) }));
}
/** 拖的、转的是哪只手的手指上的点，就放开那只手 */
function freeGripOf(handle: Handle | undefined) {
  if (!handle || !kit) return;
  const hand = kit.solver.hands.find((h) => [...h.fingers, ...h.extras].some((chain) => chain.includes(handle.anchor) || chain.includes(handle.turn)));
  if (hand) freeGrip([hand]);
}

/** 选中的那只抓着道具的手：改握紧度（拖到 0 手指就不自己握了，留着现在的样子归用户自己摆） */
function setGrip(tight: number) {
  const choice = linkChoice();
  if (!choice?.link || choice.part === BODY_LINK || !kit || !poseState) return;
  const me = currentOf(scene);
  scene = updateFigure(scene, me.id, { links: setLink(me.links, withGrip(choice.link, tight)) });
  poseState = following(holdState(kit.solver, poseState, myHolds(), { grip: 'always' }));
  showPose();
  commitPose(spec.posing, `grip:${choice.part}`);
}

/** 选中的点能连到哪：手是抓住道具、脚是踩住，胯是整个人跟着。已经连着的给出那个连接；旁边没有道具返回 null */
function linkChoice(): { part: string; link?: PropLink; prop: SceneProp } | null {
  const handle = pickedHandle();
  if (!handle || !kit || !poseFrame || !scene.props.length) return null;
  const limb = handle.kind === 'reach' ? limbOf(handle) : undefined;
  if (!limb && handle.kind !== 'body') return null;
  const part = limb ? limb.name : BODY_LINK;
  const link = linkOf(myLinks(), part);
  if (link) return { part, link, prop: propOf(propsNow(), link.prop)! };
  const me = currentOf(scene);
  const frame = poseFrame;
  const k = linkScale();
  const solids = sceneSolids();
  const near = (bone: number, room: number) => {
    const got = nearestSolid(solids, toScene(me.place, frame.pos[bone]));
    return got && got.dist <= room * k ? got : null;
  };
  // 整个人：胯挨着的那件（坐着、躺着）；没有就看脚踩着的那件（站在上面）
  const got = limb
    ? near(limb.end, LINK_NEAR[limb.kind === 'leg' ? 'foot' : 'hand'])
    : (near(kit.solver.rig.hips, LINK_NEAR.body) ??
      kit.solver.limbs
        .filter((l) => l.kind === 'leg')
        .map((l) => near(l.end, LINK_NEAR.foot))
        .find(Boolean) ??
      null);
  const prop = got && propOf(propsNow(), got.id);
  return prop ? { part, prop } : null;
}

const poseLinkBtn = $<HTMLButtonElement>('btnPoseLink');
const poseCarry = $<HTMLInputElement>('poseCarry');
poseCarry.addEventListener('change', () => setCarry(poseCarry.checked));
const poseGripRow = $('poseGripRow');
poseGripRow.title = t('手指照道具的形状自己握上：100% 是握到碰着，往左手指越来越直；拖到 0 手指就不自己握了，归你在「手势」里摆');
const syncGripDial = buildDial(poseGripRow, 's-pose-grip', t('握紧'), [0, 1], percent, setGrip);
const GRIP_WAYS = ['over', 'under'] as const;
const syncPoseWay = buildSeg($('segPoseWay'), GRIP_WAYS, (v) => (v === 'over' ? t('正手') : t('反手')), (way) => {
  const choice = linkChoice();
  const got = choice?.link ? applyGripWay(choice.part, way) : null;
  if (got && !got.ok) setStatus(got.text, true);
  if (!got?.ok) syncPoseLink();
});
function syncPoseLink() {
  const choice = linkChoice();
  $('poseLinkRow').hidden = !choice;
  // 「握紧」：抓着道具、带手指的手才有
  const gripping = Boolean(choice?.link && choice.part !== BODY_LINK && kit?.solver.hands.some((h) => h.name === choice.part));
  poseGripRow.hidden = !gripping;
  if (gripping) syncGripDial(choice!.link!.grip ?? 0);
  // 「握法」：握着杆（椅子腿、栏杆这类细的一截也算）的手才有
  const way = gripping ? gripWayNow(choice!.part) : null;
  $('poseWayRow').hidden = !way;
  if (way) syncPoseWay(way, true);
  // 「道具跟着这只手」：抓着、踩着道具的手脚才有
  const held = Boolean(choice?.link && choice.part !== BODY_LINK);
  $('poseCarryRow').hidden = !held;
  if (!choice) return;
  const name = propLabel(choice.prop);
  const body = choice.part === BODY_LINK;
  const foot = !body && isFootPart(choice.part);
  const carrying = Boolean(choice.link?.carry);
  if (held) {
    const block = carrying ? null : carryBlock(choice.part, choice.prop);
    poseCarry.checked = carrying;
    poseCarry.disabled = Boolean(block);
    $('poseCarryText').textContent = foot ? t('道具跟着这只脚') : t('道具跟着这只手');
    $('poseCarryRow').title =
      block ??
      (foot
        ? t('勾上：拖这只脚、拖身体、挪角色，道具都跟着走、跟着转。不勾：道具不动，脚踩在它上面。来回换的那一下脚和道具都不动')
        : t('勾上是拿着：拖这只手、拖身体、挪角色、换姿势，道具都跟着走、跟着转。不勾是道具不动，手抓在它上面（像公交车的拉杆）。来回换的那一下手和道具都不动'));
  }
  $('poseLinkNote').textContent = !choice.link
    ? ''
    : body
      ? t('整个人跟着「{name}」', { name })
      : carrying
        ? foot
          ? t('带着「{name}」', { name })
          : t('拿着「{name}」', { name })
        : foot
          ? t('踩着「{name}」', { name })
          : t('抓着「{name}」', { name });
  poseLinkBtn.textContent = choice.link
    ? body
      ? t('不跟了')
      : t('松开')
    : body
      ? t('整个人跟着「{name}」', { name })
      : foot
        ? t('踩住「{name}」', { name })
        : t('抓住「{name}」', { name });
  poseLinkBtn.title = choice.link
    ? carrying
      ? t('松开以后道具留在现在的地方，不再跟着走')
      : t('解开以后，挪这件道具它不再跟着')
    : body
      ? t('坐着、躺着、站在这件道具上时用：挪它、转它，整个人跟着走')
      : foot
        ? t('踩着这件道具时用：点了以后脚底贴到面上；挪它、转它，这只脚跟着走、脚掌跟着转；拖身体别处时脚留在上面')
        : t('握着、扶着、撑着这件道具时用：点了以后手掌转过去对着它，手指照它的形状握上；挪它、转它，这只手跟着走、手掌跟着转；拖身体别处时手留在上面，手臂伸直了身体就被拉住');
}
poseLinkBtn.addEventListener('click', () => {
  const choice = linkChoice();
  if (!choice) return;
  if (choice.link) unlinkPart(scene.current, choice.part);
  else if (choice.part === BODY_LINK) rideProp(choice.prop.id);
  else holdPart(choice.part, choice.prop.id);
});

/** 当前角色屏幕上的网格最低的那一点有多高（它自己的坐标）。包围盒（ownBox）是给镜头取景用的，会宽出几厘米，这里逐点量 */
function ownBottom(): number | null {
  if (mode === 'pose' && posed) {
    const y = posed.bounds().min.y;
    if (Number.isFinite(y)) return y;
  }
  let low = Infinity;
  for (const root of shownRoots()) {
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      const mesh = o as Mesh;
      const at = mesh.isMesh && isShownObject(mesh) ? mesh.geometry.getAttribute('position') : null;
      if (!at) return;
      const e = mesh.matrixWorld.elements;
      for (let i = 0; i < at.count; i++) low = Math.min(low, e[1] * at.getX(i) + e[5] * at.getY(i) + e[9] * at.getZ(i) + e[13]);
    });
  }
  return Number.isFinite(low) ? low : null;
}

/** 当前角色整个人竖直落下去：落到地面，或者脚下的道具上（和道具的「落到下面」一个意思） */
function dropFigure() {
  const me = currentOf(scene);
  const bones = currentBones();
  if (!bones || ownBox.isEmpty()) return;
  // 刚切过来、它自己的网格还没算出来：这时候量不准脚底在哪
  if (!live.visible) return setStatus(t('正在生成网格…'));
  // 身上最低的那几处（脚、坐着时的屁股……）各自往下找，取最高的那个面
  const caps = capsulesOf(bones.bones, bones.height);
  const lowest = Math.min(...caps.flatMap((c) => [c.a[1], c.b[1]]));
  const probes: V3[] = [[0, 0, 0], ...caps.flatMap((c) => [c.a, c.b]).filter((p) => p[1] < lowest + 0.08)];
  const bottom = placeY(me.place) + (ownBottom() ?? ownBox.min.y);
  let top = 0;
  for (const probe of probes) {
    const at = toScene(me.place, probe);
    const y = topUnder(sceneSolids(), at[0], at[2], bottom + 0.02);
    if (y !== null && y > top) top = y;
  }
  const shift = top - bottom;
  if (Math.abs(shift) < 0.0005) return setStatus(t('已经落在下面的东西上了。'));
  movePlace(me.id, { ...me.place, y: placeY(me.place) + shift });
  commitPlace();
  setStatus(top > 0.0005 ? t('落到了下面的道具上（离地 {cm} 厘米）。', { cm: Math.round(top * 100) }) : t('落到了地面上。'));
}

/* ---- 一键动作（见 scene/propActions.ts）：让当前角色坐到、躺到、撑着、扶着、靠着选中的道具 ---- */

/** 面板上那一排按钮：现在做不了的带上原因 */
function propActionList(propId: string): { key: string; label: string; tip: string; block: string | null }[] {
  const prop = propOf(propsNow(), propId);
  const solver = ensureKit()?.solver;
  return PROP_ACTIONS.map((a) => {
    const block = prop && solver ? actionBlock(a.key, solver, prop) : tk('正在生成网格…');
    return { key: a.key, label: t(a.name), tip: t(a.tip), block: block ? t(block) : null };
  });
}

/** 做一个一键动作：当前角色换位置、换姿势、连到道具上，记成一步撤销。返回做没做成和那句话（做不了的是原因） */
function applyPropAction(propId: string, action: PropAction): { ok: boolean; text: string } {
  const prop = propOf(propsNow(), propId);
  const notNow = { ok: false, text: t('现在做不了：正在拖动，或者模型还在生成') };
  if (!prop || poseHandles?.busy || placing || propsPanel.busy) return notNow;
  if (pending) rebuild();
  endSlide();
  const solver = ensureKit()?.solver;
  if (!solver) return notNow;
  const me = currentOf(scene);
  // 把道具拿到身上来的：别的角色正带着它，或者它正带着这个角色，拿不了
  const block = isPickAction(action) ? carryBlock(action === 'hug' ? 'UpperChest' : 'Hand_R', prop) : null;
  if (block) {
    setStatus(block, true);
    return { ok: false, text: block };
  }
  const got = solvePropAction(action, { solver, place: me.place, posing: spec.posing, links: me.links, prop, props: propsNow(), follow: followOn });
  if ('error' in got) {
    setStatus(t(got.error), true);
    return { ok: false, text: t(got.error) };
  }
  const names = { who: figureLabel(me), name: propLabel(prop) };
  const done =
    action === 'carry'
      ? t('「{who}」的{part}拿着「{name}」了：拖这只手、拖身体、挪角色，它都跟着走。要放下：点中这只手，去掉「道具跟着这只手」的勾。', { ...names, part: limbLabel(got.part ?? '') })
      : action === 'both'
        ? t('「{who}」两手端着「{name}」了：它跟着右手走，左手抓在它上面；拖手、拖身体、挪角色都带着。', names)
        : action === 'hug'
          ? t('「{who}」把「{name}」抱在胸前了：弯腰、转身、挪角色，它都跟着胸口走。不抱了：在「连着它的」里点「解开」。', names)
          : action === 'lift'
            ? t('「{who}」把「{name}」举过头顶了：它跟着右手走，左手抓在它上面；拖手、拖身体、挪角色都带着。', names)
            : action === 'sit'
      ? t('「{who}」坐到「{name}」上了：挪这件道具、转它，人跟着走。', names)
      : action === 'lie'
        ? t('「{who}」躺到「{name}」上了：挪这件道具、转它，人跟着走。', names)
        : action === 'top'
          ? t('「{who}」两手撑在「{name}」上了：挪这件道具，手跟着走。', names)
          : action === 'hold'
            ? t('「{who}」的{part}扶在「{name}」上了：挪这件道具，这只手跟着走。', { ...names, part: limbLabel(got.part ?? '') })
            : action === 'hang'
              ? t('「{who}」吊在「{name}」上了：挪这件道具、转它，人跟着走。', names)
              : action === 'wrap'
                ? t('「{who}」缠在「{name}」上了：挪这件道具、转它，人跟着走。要换成另一条腿在上，点「摆姿势」里的「左右翻转」。', names)
                : t('「{who}」背靠在「{name}」上了：挪这件道具、转它，人跟着走。', names);
  const note = { text: done + (got.missed ? t('有 {n} 处够不着，照够得着的摆了。', { n: got.missed }) : ''), warn: Boolean(got.missed) };
  // 道具要离开原来的地方了：记下它原来在哪，撤销这一步时放回去
  return settleAction(got, note, isPickAction(action) ? { [prop.id]: { pos: prop.pos, rot: prop.rot } } : undefined);
}

/** 一键动作、伸手抓住算好了：当前角色换位置、换姿势、换连接，记成一步撤销，说一句 */
function settleAction(got: ActionResult, note: { text: string; warn: boolean }, picked?: Picked): { ok: boolean; text: string } {
  const me = currentOf(scene);
  history.seal();
  movePlace(me.id, got.place, true);
  scene = updateFigure(scene, me.id, { links: got.links });
  untangle(me.id);
  spec = { ...spec, posing: keepFaces(got.posing, spec.posing) };
  poseNote = note;
  tookNext = picked;
  commit();
  tookNext = undefined;
  history.seal();
  if (mode !== 'pose') setMode('pose');
  markHandles();
  propsPanel.refresh();
  setStatus(note.text, note.warn);
  scheduleSceneClash();
  return { ok: true, text: note.text };
}

/* ---- AI 助手的抓住、松开、切方向（见 ai/sceneTools.ts） ---- */

/** 当前角色能抓东西的手、能踩东西的脚 */
const grabParts = (): { part: string; label: string }[] => (ensureKit()?.solver.limbs ?? []).map((l) => ({ part: l.name, label: limbLabel(l.name) }));

/** 当前角色的一只手抓住（脚踩住）一件道具：挨着就在原处抓，远了先伸过去；carry 是道具跟着它走。记一步撤销 */
function applyGrab(part: string, propId: string, carry: boolean): { ok: boolean; text: string } {
  const prop = propOf(propsNow(), propId);
  const notNow = { ok: false, text: t('现在做不了：正在拖动，或者模型还在生成') };
  if (!prop || poseHandles?.busy || placing || propsPanel.busy) return notNow;
  if (pending) rebuild();
  endSlide();
  const solver = ensureKit()?.solver;
  if (!solver) return notNow;
  const me = currentOf(scene);
  const block = carry ? carryBlock(part, prop) : null;
  if (block) return { ok: false, text: block };
  const got = solveGrab({ solver, place: me.place, posing: spec.posing, links: me.links, prop, props: propsNow(), part, carry });
  if ('error' in got) return { ok: false, text: t(got.error) };
  const names = { part: limbLabel(part), name: propLabel(prop) };
  const text = carry
    ? isFootPart(part)
      ? t('「{name}」跟着{part}了：拖这只脚、拖身体、挪角色，它都跟着走、跟着转。要它留在原地：去掉「道具跟着这只脚」的勾。', names)
      : t('「{name}」拿在{part}上了：拖这只手、拖身体、挪角色、换姿势，它都跟着走、跟着转。要它留在原地：去掉「道具跟着这只手」的勾。', names)
    : isFootPart(part)
      ? t('{part}踩住「{name}」了：挪它、转它，这只脚跟着走；拖身体别处时脚留在上面。', names)
      : t('{part}抓住「{name}」了：挪它、转它，这只手跟着走；拖身体别处时手留在上面，手臂伸直了身体就被拉住。', names);
  return settleAction(got, { text, warn: false });
}

/** 当前角色这只手握着杆的话，是正手还是反手（摆姿势时照屏幕上的姿势）；不是握着杆的返回 null */
function gripWayNow(part: string): GripWay | null {
  const me = currentOf(scene);
  const link = isLimbPart(part) ? linkOf(me.links, part) : undefined;
  const prop = link && propOf(propsNow(), link.prop);
  const solver = kit?.solver ?? ensureKit()?.solver;
  if (!link || !prop || !solver) return null;
  return barGripWay(solver, mode === 'pose' && poseState ? poseState : stateOf(solver, spec.posing), me.place, prop, part);
}

/** 当前角色握着杆的一只手换握法（正手、反手）：手腕留在原处，手掌翻过去，手指重新握。记一步撤销 */
function applyGripWay(part: string, way: GripWay): { ok: boolean; text: string } {
  const me = currentOf(scene);
  const link = isLimbPart(part) ? linkOf(me.links, part) : undefined;
  const prop = link && propOf(propsNow(), link.prop);
  if (!link || !prop) return { ok: false, text: t('这里没有抓着、带着道具') };
  const notNow = { ok: false, text: t('现在做不了：正在拖动，或者模型还在生成') };
  if (poseHandles?.busy || placing || propsPanel.busy) return notNow;
  if (pending) rebuild();
  endSlide();
  const solver = ensureKit()?.solver;
  if (!solver) return notNow;
  const state = stateOf(solver, spec.posing);
  const now = barGripWay(solver, state, me.place, prop, part);
  const names = { part: limbLabel(part), name: propLabel(prop) };
  if (!now) return { ok: false, text: t('{part}没有握着杆：贴在面上、扣在棱上的手没有正手、反手之分', names) };
  if (now === way) return { ok: true, text: way === 'over' ? t('{part}已经是正手握了。', names) : t('{part}已经是反手握了。', names) };
  const got = flipGrip(solver, state, me.place, prop, link);
  if (!got) return { ok: false, text: t('{part}在这里换不了握法：换过去那一面握不住。把手沿着杆挪一点再试', names) };
  const links = setLink(me.links, got.link);
  const held = holdState(solver, got.state, holdTargets(me.place, links, propsNow(), propLed), { grip: 'always' });
  const text = way === 'over' ? t('{part}换成正手握「{name}」了。', names) : t('{part}换成反手握「{name}」了。', names);
  const picked = pickedHandle()?.id ?? null;
  const done = settleAction({ place: me.place, posing: posingOf(solver, held, spec.posing), links, missed: 0 }, { text, warn: false });
  if (picked && !pickedHandle()) selectJoint(picked);
  syncPoseLink();
  return done;
}

/** 当前角色的一个连接换方向：on 是道具跟着这一处走（拿着），不然道具不动、这一处留在它上面（抓着）；胸口的只有带着，关掉就是不抱了 */
function applyCarry(part: string, on: boolean): { ok: boolean; text: string } {
  const me = currentOf(scene);
  const link = linkOf(me.links, part);
  const prop = link && propOf(propsNow(), link.prop);
  if (!link || !prop || part === BODY_LINK) return { ok: false, text: t('这里没有抓着、带着道具') };
  if (poseHandles?.busy || placing || propsPanel.busy) return { ok: false, text: t('现在做不了：正在拖动，或者模型还在生成') };
  const names = { part: linkPartLabel(part), name: propLabel(prop) };
  if (on === Boolean(link.carry)) return { ok: true, text: on ? t('「{name}」已经跟着{part}走了。', names) : t('「{name}」本来就没跟着{part}走。', names) };
  if (!on) {
    settleCarried();
    scene = updateFigure(scene, me.id, { links: isLimbPart(part) ? setLink(me.links, withCarry(link, false)) : dropLink(me.links, part) });
    commitLinks();
    const text = isLimbPart(part) ? t('「{name}」放下了，留在现在的地方；{part}还抓在它上面，挪它、转它{part}跟着走。', names) : t('「{name}」放下了，留在现在的地方。', names);
    setStatus(text);
    return { ok: true, text };
  }
  const block = carryBlock(part, prop);
  if (block) return { ok: false, text: block };
  // 手这会儿没在抓着的那一点上（够不着悬着的、老存档里没记朝向的）：照手现在在哪重新记，不然道具一下跳到手上
  const got = myFrame(false);
  const bone = got?.solver.rig.index.get(part);
  if (!got || bone === undefined) return { ok: false, text: t('现在做不了：正在拖动，或者模型还在生成') };
  const point = toScene(me.place, got.frame.pos[bone]);
  let next = link;
  if (!next.rot || len(sub(point, linkPoint(prop, next))) > 1e-3) next = withGrip(linkTo(prop, part, point, undefined, sceneRot(me.place, got.frame.rot[bone])), link.grip ?? 0);
  scene = updateFigure(scene, me.id, { links: setLink(putDown(me.links, prop.id), withCarry(next, true)) });
  commitLinks();
  const text = t('「{name}」跟着{part}走了：拖它、拖身体、挪角色，道具都带着。', names);
  setStatus(text);
  return { ok: true, text };
}

/* ---- 双人动作 ---- */

/** 和谁一起摆（场景里别的角色的 id）；不在了就换成第一个别人 */
let pairPartner = '';
const pairSelect = $<HTMLSelectElement>('pairPartner');
pairSelect.addEventListener('change', () => {
  pairPartner = pairSelect.value;
});
function syncPairPanel() {
  const others = scene.figures.filter((f) => f.id !== scene.current);
  $('pairField').hidden = !others.length;
  if (!others.some((f) => f.id === pairPartner)) pairPartner = others[0]?.id ?? '';
  pairSelect.replaceChildren(...others.map((f) => new Option(figureLabel(f), f.id, false, f.id === pairPartner)));
}
for (const preset of PAIR_PRESETS) {
  const btn = el('button', 'btn', t(preset.name));
  btn.type = 'button';
  btn.addEventListener('click', () => void applyPair(preset));
  $('pairPresets').append(btn);
}

const libraryPosing = (name: string | null): Posing | null => (name ? POSE_LIBRARY.find((p) => p.name === name)?.posing ?? null : null);
/** 套上新姿势时表情照原来的留着（底子姿势里没有表情） */
const keepFaces = (next: Posing, was: Posing): Posing => (next.faces || !was.faces ? next : { ...next, faces: was.faces });

/** 摆一个双人动作：现在这个角色（A）和选的那个人（B）。B 挪到 A 旁边，两人都换姿势；各记一步撤销 */
async function applyPair(preset: PairPreset) {
  const partner = figureOf(scene, pairPartner);
  if (!partner || partner.id === scene.current || poseHandles?.busy || placing) return;
  if (pending) rebuild();
  endSlide();
  if (!figure && !character) return;
  setStatus(t('正在摆「{name}」…', { name: t(preset.name) }));
  await loadAssetsFor(bakeSpec(partner));
  const restA = character ? characterSkeleton(character).bones : buildSkeleton(figure!).bones;
  const restB = skeletonFor(bakeSpec(partner));
  const here = currentOf(scene);
  const result = solvePair(
    preset,
    { bones: restA, place: here.place, base: libraryPosing(preset.base.A) },
    { bones: restB, place: partner.place, base: libraryPosing(preset.base.B) },
  );
  // B：设定、位置一起改，记进它自己的撤销历史
  const now = figureOf(scene, partner.id)!;
  const nextB = { ...now.spec, posing: keepFaces(result.posing.B, now.spec.posing) };
  const h = histories.get(now.id) ?? new History<Snapshot>(snapOf(now), HISTORY_OPTIONS);
  h.seal();
  // B 走过来、换了姿势：原来和道具的连接都解开；A 站着不动，只是手脚换了地方：钉着的手脚解开，整个人跟着的那一件留着
  h.push({ spec: nextB, text: now.text, place: result.placeB, links: [] });
  histories.set(now.id, h);
  scene = updateFigure(scene, now.id, { spec: nextB, place: result.placeB, links: [] });
  scene = updateFigure(scene, scene.current, { links: (currentOf(scene).links ?? []).filter((l) => l.part === BODY_LINK) });
  placeAll();
  // A：换上新姿势，切到「摆姿势」看
  history.seal();
  spec = { ...spec, posing: keepFaces(result.posing.A, spec.posing) };
  commit();
  if (mode !== 'pose') setMode('pose');
  refitAll();
  const missed = result.missed ? t('有 {n} 处够不着，照够得着的摆了。', { n: result.missed }) : '';
  const said = t('「{a}」和「{b}」摆好了「{name}」。', { a: figureLabel(here), b: figureLabel(now), name: t(preset.name) }) + missed;
  // 刚切进摆姿势、网格还在配骨骼：配好以后还说这一句
  if (poseWaiting) poseNote = { text: said, warn: Boolean(result.missed) };
  setStatus(said, Boolean(result.missed));
  void bakeOthers();
  scheduleSceneClash();
}

/** 打开页面时：场景里别的角色先摆上人影，再在后台挨个算 */
function startScene() {
  for (const f of scene.figures) if (f.id !== scene.current) sceneView.setGhost(f.id, [], new Box3());
  placeAll();
  renderSceneBar();
  syncScenePanel();
  void bakeOthers();
}

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
  aiDock?.refresh();
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
  // 「部件」卡片里的选项：用不上的不出（两个头以上才有头的排法，有兽耳才有兽耳形状……）
  syncHead(spec.headLayout, spec.counts.heads > 1);
  $('headLayoutField').hidden = most('heads') < 2;
  syncArm(spec.armLayout, spec.counts.armPairs > 1);
  $('armLayoutField').hidden = most('armPairs') < 2;
  // 围成一圈时腿是每个人几条、并排长在这个人的胯上（见 layout.ts）：排法不起作用
  syncLeg(spec.legLayout, spec.counts.legs > 1 && !ringActive(spec));
  // 两条腿时排法基本用不上（只有每副胯一条腿的人腿人马、前后串联用得上）：选过别的排法才留着，好改回来
  $('legLayoutField').hidden = ringActive(spec) || spec.counts.legs < 2 || (spec.counts.legs < 3 && spec.legLayout === 'auto');
  syncHipLegs();
  syncChestRow();
  syncAdult();
  syncEar(spec.earShape, spec.counts.earPairsPerHead > 0);
  $('earShapeField').hidden = most('earPairsPerHead') === 0;
  const ready = spec.bodyStyle !== 'mannequin';
  const finished = spec.bodyStyle === 'character';
  // 手的样式只有白模人台能选
  syncHand(spec.hands, spec.counts.armPairs > 0 && !ready);
  $('handStyleField').hidden = ready || most('armPairs') === 0;
  $('fingersNote').hidden = finished || most('armPairs') === 0 || (!ready && spec.hands !== 'fingers');
  $('armEndField').hidden = most('armPairs') === 0;
  $('legEndField').hidden = !humanLegs();
  $('legNote').hidden = $('legLayoutField').hidden;
  // 形态四选一：选了哪种才出它的选项；成品角色不能围
  const form = formOf(spec);
  syncForm(form, true);
  const ringOption = $('segForm').querySelector<HTMLInputElement>('input[value="ring"]')!;
  ringOption.disabled = finished;
  ringOption.parentElement!.classList.toggle('off', finished);
  ringOption.parentElement!.title = finished ? t('成品角色不能围成一圈') : '';
  $('formNormalNote').hidden = form !== 'normal';
  $('formTorsos').hidden = form !== 'torsos';
  $('formConjoin').hidden = form !== 'conjoined';
  $('formRing').hidden = form !== 'ring';
  syncConjoin(spec.conjoined, true);
  $('conjoinPoseField').hidden = spec.conjoined === 'none';
  syncConjoinPose(spec.conjoinPose, spec.conjoined !== 'none');
  // 围成一圈：成品角色、连体时不围
  const ringable = !finished && spec.conjoined === 'none';
  syncRing(spec.ring, ringable);
  $('ringCountField').hidden = spec.ring === 'none';
  syncRingCount(String(spec.ringCount), ringable && spec.ring !== 'none');
  $('ringChestField').hidden = spec.ring === 'none';
  syncRingChest(spec.ringChest, ringable && spec.ring !== 'none' && (spec.ring === 'rows' ? spec.counts.breasts > 0 : spec.counts.breasts > 2));
  $('ringLegsField').hidden = spec.ring === 'none';
  $('ringSpreadField').hidden = spec.ring === 'none';
  syncRingSpread(spec.ringSpread, ringable && spec.ring !== 'none', spec.ring === 'rows');
  $('ringHipRowsField').hidden = spec.ring !== 'rows';
  syncRingHipRows(String(spec.ringHipRows), ringable && spec.ring === 'rows');
  $('ringHipsPerRowField').hidden = spec.ring !== 'rows';
  syncRingHipsPerRow(String(spec.ringHipsPerRow), ringable && spec.ring === 'rows');
  // 前后排的腿都在前后两排上、都朝正前：「中间的腿」「腿的朝向」不起作用
  syncRingLegs(spec.ringLegs, ringable && spec.ring !== 'none' && spec.ring !== 'rows');
  $('ringLegFacingField').hidden = spec.ring === 'none';
  syncRingLegFacing(spec.ringLegFacing, ringable && spec.ring !== 'none' && spec.ring !== 'rows');
  syncArmEnd(spec.armEnd, spec.counts.armPairs > 0);
  syncLegEnd(spec.legEnd, humanLegs());
  syncFingers();
  syncToes();
  syncCards();
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
  syncUndo();
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
    title: t('身体样式'),
    text: t('三种：白模人台是素白的人台；二次元素体是现成的二次元裸素体；成品角色带头发、衣服和贴图，能换角色、换发型、染发。'),
    target: () => sections.get('style') ?? null,
    before: tourShape('style'),
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
    title: t('部件@@栏目'),
    text: t('一个部件一张卡片：头、手臂、胸、腿、尾巴、翅膀。标题上用 − 和 + 调数量；展开是它自己的排法、样式和大小（比如腿是人马还是蛛形）。'),
    target: () => sections.get('counts') ?? null,
    before: tourShape('counts'),
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
    text: t('选中部件以后，这一栏能把拖动换成「旋转」「缩放」，也能直接填位置、角度、大小的数字；勾上「同时调整对侧」左右一起改，调坏了点「还原这个部件」。还能「复制一份」多做一个、「接到…」别的部件上跟着它动；选中躯干能「分成胸腔和胯」两块。'),
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
    title: t('好几个角色'),
    text: t('「场景」这一栏能加角色、复制现在这个，几个角色站在一起各摆各的姿势。同一时间只改一个，点场景里别的角色就切过去；拖脚下的圈挪位置。导出时可以把整个场景写进一个文件。'),
    target: () => sections.get('scene') ?? null,
    before: () => {
      phone.setPop(null);
      phone.open('scene');
    },
  },
  {
    title: t('道具@@引导'),
    text: t('还是「场景」这一栏，往下是「道具」：杆、箱子、台子，还有现成的椅子、沙发、床、桌子，放进场景给姿势当依托。选中一件道具，点「坐上去」「躺上去」「手撑着」「吊着」这些按钮，角色一下就摆到上面；之后挪道具，人跟着走。') + t('点「拿着」「两手端着」「抱着」「举过头顶」是反过来：道具到角色手上，之后跟着人走。摆姿势时把手拖到道具跟前，它自己吸上去抓住。') + t('自己的模型文件也能导进来当道具：「现成的家具」最后一组「我的」。'),
    target: () => $('propsPanel'),
    before: () => {
      phone.setPop(null);
      phone.open('scene');
      $('propsTitle').scrollIntoView({ block: 'start' });
    },
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
startScene();
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

// 更新日志：每次打开弹一次（勾了「不再提醒」的那一版不弹）。第一次打开的人先看新手引导，这一次不弹
const changelog = installChangelog(() => tourSeen && !tour.open);

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
      // 多选：__oc.picks() 现在选中的全部部件；__oc.togglePick('Arm_02_L') 加一个、去一个
      picks: () => picks,
      togglePick,
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
        // 手脚这会儿吸在哪件道具上（拖着的时候才有）
        snapped: () => gripSnap,
        // 一只手、一只脚的末端这会儿在哪（角色自己的坐标；拖着的时候也是当下的）
        end(part: string) {
          const limb = kit?.solver.limbs.find((l) => l.name === part);
          return kit && poseState && limb ? forward(kit.solver.rig, poseState).pos[limb.end] : null;
        },
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
        // 拖着不松手的那一个点松开（__oc.pose.drag(id, to, false) 之后用）
        drop(id: string) {
          const handle = kit?.handles.find((h) => h.id === id);
          if (!handle || !poseHandles) return false;
          poseHandles.onRelease(handle, true);
          return true;
        },
      },
      // 场景：__oc.scene.add(true) 复制当前的、__oc.scene.go('f2') 切过去、__oc.scene.move('f2', { x: 1, z: 0, yaw: 90 })
      scene: {
        get: () => scene,
        view: sceneView,
        add: newFigure,
        go: switchFigure,
        remove: deleteFigure,
        move: movePlace,
        // 挪当前角色并记一步撤销（和拖完底座圈松手一样）
        moveMe: (place: Place) => {
          movePlace(scene.current, place, true);
          commitPlace();
        },
        exportScene,
        // 只生成整个场景的文件、不存（试导出用）：__oc.scene.sceneFile('glb')
        sceneFile,
        open: openSceneData,
        // 角色之间：别人的胶囊体（当前角色的坐标）、拖手脚的目标推到表面以后在哪、现在的穿插
        others: () => othersCapsules(),
        // 道具：__oc.scene.touch(目标, 'hand' | 'foot' | 'body', 从哪来) 给了「从哪来」就照拖动时那样沿路停
        touch: (p: V3, what?: 'hand' | 'foot' | 'body', from?: V3) => { grabTouch(); return touchTarget(p, what, from); },
        clash: () => { checkSceneClash(); return sceneClash; },
        // 道具：身体现在插进了哪些道具里（__oc.scene.propClash()），查一遍用了多少毫秒
        propClash: () => { const t0 = performance.now(); checkSceneClash(); return { clashes: propClash, ms: Math.round((performance.now() - t0) * 10) / 10 }; },
        file: () => serializeScene(scene, specData, true),
        // 连接：__oc.scene.links()、__oc.scene.hold('Hand_L', 'p1')、__oc.scene.ride('p1')、__oc.scene.unlink('f1', 'body')
        links: () => scene.figures.map((f) => ({ id: f.id, links: f.links ?? [] })),
        // 一键动作：__oc.scene.actions('p1') 看哪些能做，__oc.scene.act('p1', 'sit')
        actions: (prop: string) => propActionList(prop),
        act: (prop: string, key: PropAction) => applyPropAction(prop, key),
        hold: (part: string, prop?: string) => holdPart(part, prop),
        // 道具跟着手：__oc.scene.carry('Hand_L', true)（先 __oc.pose.pick('Hand_L') 选中它）；__oc.scene.propsNow() 是道具现在各在哪
        carry: (part: string, on: boolean) => {
          selectJoint(kit?.handles.find((h) => h.kind === 'reach' && limbOf(h)?.name === part)?.id ?? null);
          setCarry(on);
          return linkOf(myLinks(), part)?.carry === true;
        },
        propsNow: () => propsNow(),
        // 正手、反手：__oc.scene.way('Hand_L') 看现在是哪种（不是握着杆是 null），__oc.scene.setWay('Hand_L', 'under') 换
        way: (part: string) => gripWayNow(part),
        setWay: (part: string, way: GripWay) => applyGripWay(part, way),
        // 抱着：__oc.scene.hug('p1')（道具跟着当前角色的胸口）
        hug: (prop: string) => hugProp(prop),
        // 道具面板本身（模拟拖操纵杆：panel.select(id)，再 panel.gizmo.onDrag(true)、.onChange({ pos })、.onDrag(false)）
        panel: propsPanel,
        propsList: () => scene.props,
        ride: rideProp,
        unlink: unlinkPart,
        baking: () => bakingOthers,
        waiting: () => scene.figures.filter((f) => f.id !== scene.current && sceneView.waiting(f.id)).map((f) => f.id),
      },
      model,
      fused,
      tour,
      // __oc.spread(false)：融合不分给帮手线程（对比结果、量时间用）
      spread: spreadWork,
      // AI 助手改设定用的那一套：__oc.ai.apply({...}, 'key')
      ai: workshop,
      viewport,
      gizmo,
    },
  });
}
