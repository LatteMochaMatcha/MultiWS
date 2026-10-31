/**
 * 第二种身体的摆位：头、脖子、躯干、胸、手臂、腿用二次元少女素体的形状（见 anime/body.ts），
 * 多出来的头和手臂照样往上拼；尾巴、翅膀、角、兽耳、兽身沿用白模的做法。
 *
 * 素体本来只有一种体型（女性，身高约 1.6 m 的比例）。肩宽、腰宽是把躯干那一块格子分几段往两边拉开、压窄，
 * 胯宽是躯干和腿根一起照离中线的远近按比例拉宽，四肢粗细是把手臂、腿的格子绕骨头那根轴变粗变细，
 * 体格是这几样一起乘上去（见 SHAPE）。
 * 手臂是直的：A-pose 就是整条手臂绕肩关节放下来。
 * 调用之前素体的数据要先登记好（animeReady()）。
 */
import { ANIME_HEAD, ANIME_HEIGHT, BUST_LARGE, animeBounds, animeCaps, animeGrid, animeJoint, animeOrigin } from '../anime/body';
import { FOOT_ANKLE, FOOT_CUFF, FOOT_SOLE, FOOT_STUMP, FOOT_TOE, FOOT_TOE_END, footGraft } from '../anime/foot';
import { FINGER_JOINTS, HAND_STUMP, handGraft } from '../anime/hand';
import { type BodySpec, legPlan } from '../model/spec';
import { type CompiledField, GROUP_BLEND, castRay, compileField } from '../sdf/field';
import { type Figure, type Graft, type GridShape, type Part, type Prim, type WidenBand, nthName } from './figure';
import { type CustomHead, type HeadHair, makeFace, makeHead } from './head';
import {
  type HangBlock,
  DEG,
  GAP,
  SIDES,
  TAUR_LEVEL,
  armDirection,
  bindAngles,
  ball,
  beastLift,
  bone,
  cheekRadii,
  abreastSpots,
  cleft,
  cone,
  hangAngles,
  legBones,
  lowerParts,
  mass,
  pad,
  spiderFloor,
  tag,
  tailParts,
  wingParts,
} from './layout';
import { FACE_OUT, faceTurns, fanShift, headCluster, headShrink, headTurn, shoulderSpan, widenBy } from './bodyPlan';
import { type Quat, type V3, Q_ID, UP, add, len, mat3Apply, mat3Mul, mul, norm, quatBetween, quatConj, quatEuler, quatMat3, rotate, sub } from './vec';
import { ANIME_SKULL, wigOf } from './wig';

const O: V3 = [0, 0, 0];
const DOWN: V3 = [0, -1, 0];
const TORSO = 'Torso';

/* ---- 素体上的关节（模型自己的坐标：脚踩在 y = 0，面朝 +Z，角色的左手边是 +X） ---- */
const HIPS = animeJoint('C_Hips');
const SPINE = animeJoint('C_Spine');
const NECK = animeJoint('C_Neck');
const HEAD_JOINT = animeJoint('C_Head');
const SHOULDER = animeJoint('L_UpperArm');
const ELBOW = animeJoint('L_LowerArm');
const WRIST = animeJoint('L_Hand');
const KNUCKLE = animeJoint('L_Middle1');
const HIP = animeJoint('L_UpperLeg');
const KNEE = animeJoint('L_LowerLeg');
const ANKLE = animeJoint('L_Foot');
/** 素体的脚底离地有一点高度（原来是留给鞋底的）：用人腿站着时整个人往下放这么多 */
const SOLE = HIP[1] + animeBounds('leg').min[1];
/** 现成的脚（anime/foot.ts）的脚底比素体自己的脚底高多少：摆的时候往下挪这么多，正好踩在地上 */
const FOOT_LIFT = FOOT_SOLE - SOLE;
/** 腿的距离场在脚踝以下切掉（多留一小截伸进脚里），脚另外用现成的网格接；切口那一圈在脚踝往上这么高的地方 */
const LEG_CLIP = ANKLE[1] - HIP[1] - FOOT_STUMP;
const FOOT_RIM: V3 = [ANKLE[0], ANKLE[1] + FOOT_CUFF, ANKLE[2]];
const BUST = animeOrigin('bust');
/** 「胸」那一块背面的切口：中心离中线多远、相对胸关节靠前多少 */
const BUST_CAP = animeCaps('bust')[0].center;
const HEAD_ORIGIN = animeOrigin('head');

/** 头的半高、半宽 */
const HEAD_H = (ANIME_HEAD.top - ANIME_HEAD.chin) / 2;
const HEAD_W = 0.09;
/** 脖子：从脖子根到头关节；头关节到头正中有多高 */
const NECK_SPAN = sub(HEAD_JOINT, NECK);
const NECK_REACH = Math.hypot(NECK_SPAN[0], NECK_SPAN[1], NECK_SPAN[2]);
const HEAD_REACH = HEAD_ORIGIN[1] - HEAD_JOINT[1];
/** 多个头时：最外面的脖子根离肩关节至少多远 */
const NECK_ROOM = 0.03;
/** 头的竖轴（后脑勺和脸的正中间）在头自己坐标里的位置：一个头上多出来的脸绕着它转过去 */
const FACE_PIVOT: V3 = [0, 0, -0.012];
/** 加宽肩膀：从哪个高度开始、到哪个高度加到最宽、离中线多远以内是被拉开的（素体自己的坐标） */
const WIDEN: [number, number, number] = [BUST[1] - 0.05, SHOULDER[1] - 0.015, 0.07];
/**
 * 体型滑块（素体自己的坐标）。
 * waist —— 腰：最细的地方多高、半宽多少；往下 below、往上 above 那么远渐回原样；离中线 core 以内是被拉开的（比腰还宽，整个腰身匀着变）；
 * hips  —— 胯：离身体中线的距离按比例拉宽（见 GridShape.spreadX），从腰往下逐渐变，到髋关节上面一点变足，
 *          到大腿根下面渐渐变回原样。躯干和腿根照同一份拉（腿的格子往上伸进了胯里，和躯干叠着），腿和骨骼都不挪；
 * arm、leg —— 四肢粗细沿手臂、腿的轴从哪到哪变足、到手腕、脚踝之前多长变回原样（见 GridShape.thicken）。
 *          腿从躯干那块的底下（大腿根上叠着的那一截）往下才开始变，不然变细的时候那一截会凸出来
 */
const SHAPE = {
  waist: { y: 1.07, half: 0.072, below: 0.12, above: 0.13, core: 0.1 },
  hips: [1.06, 0.92, 0.82, 0.58] as [number, number, number, number],
  arm: [0.05, 0.12, 0.05] as [number, number, number],
  leg: [0.1, 0.2, 0.08] as [number, number, number],
};
/** 四肢加粗时，根上那一段渐变每多粗一倍拉长多少倍 */
const RAMP_GROW = 0.8;
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** 素体本来是几头身 */
const NATIVE_RATIO = ANIME_HEIGHT / (2 * HEAD_H);
/** 多排手臂、多排胸时，把腰以上、胸以下的这一段拉长 */
const STRETCH: [number, number] = [1.04, 1.12];
/** 腰最细的地方大概多高（人腿人马后面接的那截腰照这里的粗细） */
const WAIST_Y = 1.0;
/** 这一块就摆在素体原来的位置上时，和躯干直接取并集，接缝处还原成素体本来的样子 */
const NATIVE = { fuseAs: 'torso' } as const;

/** 左边的关节换到 side 一侧 */
const mirror = (p: V3, side: number): V3 => [p[0] * side, p[1], p[2]];
/**
 * 素体的腿是往脚并拢的（脚踝比髋关节靠里三厘米）。长在中线上的腿用左腿那一份，
 * 绕髋关节转这么多（绕 Z 轴），让脚踝落在髋关节正下方，整条腿是竖直的
 */
const STRAIGHTEN = quatEuler(0, 0, Math.atan2(HIP[0] - ANKLE[0], HIP[1] - ANKLE[1]));
/** 单足时素体原来的两条腿留到髋关节往下多少（腿自己的坐标） */
const HIP_STUMP = -0.1;
/** 素体一瓣屁股的正中离中线多远（找屁股最鼓的那一圈用） */
const CHEEK_X = 0.055;
/** 单足时那条腿左右、前后各粗多少倍 */
const SINGLE_LEG: V3 = [1.3, 1, 1.12];

const grid = (name: string, piece: Parameters<typeof animeGrid>[0], side: number = 1, extra?: Partial<GridShape>): GridShape => ({
  kind: 'grid',
  name,
  grid: animeGrid(piece),
  ...(side < 0 ? { mirror: true } : {}),
  ...extra,
});

/**
 * 手的网格（写在素体模型的坐标里）摆到手臂这个部件里：挪到以肩关节为原点，
 * 手肘弯了的话绕过手肘的那根竖轴转过去（elbow 是手肘相对肩关节的位置），右手再左右翻过来。
 */
function handPlace(side: number, bend: number, elbow: V3, size = 1): Pick<Graft, 'matrix' | 'offset'> {
  const cos = Math.cos(bend);
  const sin = Math.sin(bend);
  const from: V3 = [SHOULDER[0] + elbow[0], SHOULDER[1], SHOULDER[2] + elbow[2]];
  const matrix: Graft['matrix'] = [side * cos, 0, -side * sin, 0, 1, 0, sin, 0, cos];
  const offset: V3 = [side * (elbow[0] - (cos * from[0] - sin * from[2])), -from[1], elbow[2] - (sin * from[0] + cos * from[2])];
  if (size === 1) return { matrix, offset };
  // 绕手腕缩放：p → 手腕 + size·(p − 手腕)
  const wrist: V3 = [
    matrix[0] * WRIST[0] + matrix[1] * WRIST[1] + matrix[2] * WRIST[2],
    matrix[3] * WRIST[0] + matrix[4] * WRIST[1] + matrix[5] * WRIST[2],
    matrix[6] * WRIST[0] + matrix[7] * WRIST[1] + matrix[8] * WRIST[2],
  ];
  return { matrix: matrix.map((v) => v * size) as Graft['matrix'], offset: [0, 1, 2].map((k) => offset[k] + (1 - size) * wrist[k]) as V3 };
}

/**
 * 脚的网格（写在素体模型的坐标里）摆到腿这个部件里：挪到以髋关节为原点，右脚左右翻过来，
 * 胯部聚拢时跟着往外斜（out，见 GridShape.lean：脚整个在斜满了的那一段里），脚底踩在地上
 */
function footPlace(side: number, out: number, turn: Quat = Q_ID): Pick<Graft, 'matrix' | 'offset'> {
  const m = side < 0 ? -1 : 1;
  const matrix: Graft['matrix'] = [m, 0, 0, 0, 1, 0, 0, 0, 1];
  const offset: V3 = [m * (out - HIP[0]), -FOOT_LIFT - HIP[1], -HIP[2]];
  if (turn === Q_ID) return { matrix, offset };
  // 腿整个转过（单足时转直）：脚反着转回去，还是平踩在地上（绕脚踝正下方的脚底转）
  const back = quatMat3(quatConj(turn));
  const sole: V3 = add(offset, [m * FOOT_ANKLE[0], FOOT_SOLE, FOOT_ANKLE[2]]);
  const turned = mat3Mul(back, matrix);
  return { matrix: turned, offset: sub(sole, mat3Apply(back, sole)).map((v, k) => v + mat3Apply(back, offset)[k]) as V3 };
}

/** 腿上的骨骼名：name 把「Foot」换成这条腿上的全名（Foot_L.002 这样的；长在中线上的不分左右）。和 legBones 一个规矩 */
const legName = (side: number, pair: number) => (base: string) => nthName(side ? `${base}_${tag(side)}` : base, pair);

/** 只有这一个部件、放在原点时的距离场：摆位时朝它打射线找表面用 */
const fieldOf = (prims: Prim[]): CompiledField =>
  compileField({ scale: 1, parts: [{ name: 'Probe', type: 'torso', side: 0, pos: O, quat: Q_ID, material: 'clay', prims }] }, { blend: 0 });

/** 只留一只人耳时，从带耳朵的头上切下离中线这么远以外的一条（耳朵连着一点鬓角）贴到光头上 */
const EAR_CUT = 0.075;
type HumanEars = 'both' | 'left' | 'right' | 'none';
const headProbes: Partial<Record<HumanEars, CustomHead>> = {};
/**
 * 素体的头：形状，以及贴着它的表面放角、耳朵用的距离场。
 * ears：留哪边的人耳。加了兽耳、精灵耳时两边都不留，不然就是四只耳朵；
 * 多个头凑在一起时，挨着别的头的那一侧不留，夹在两个头中间只会支出一道棱
 */
function animeHead(ears: HumanEars): CustomHead {
  let probe = headProbes[ears];
  if (!probe) {
    const prims: Prim[] =
      ears === 'both'
        ? [grid('Head', 'head')]
        : ears === 'none'
          ? [grid('Head', 'headBare')]
          : [grid('Head', 'headBare'), grid('Ear', 'head', ears === 'left' ? 1 : -1, { clipX: EAR_CUT })];
    probe = { prims, field: fieldOf(prims) };
    headProbes[ears] = probe;
  }
  return probe;
}

/**
 * 自然下垂时手肘往前弯多少（弧度），以及弯的那一段有多宽。
 * 这里不能用 layout.ts 的 DEG：两个文件互相引用，这一行执行时 layout.ts 还没准备好
 */
const ELBOW_BEND = (16 * Math.PI) / 180;
const ELBOW_WIDTH = 0.04;
/** 胸部大小调到多少算全平 */
const BUST_FLAT = 0.3;
/**
 * 肩部聚拢：几条手臂挤在一个肩膀上。
 * inset —— 最靠后的那个肩关节也要留在身体里面，离后背表面至少这么深（不然肩头整个悬在背后）；
 * clip  —— 多出来的手臂从离肩关节这么远的地方切开，只要外面那一截。素体的手臂根部连着一片腋下的皮，
 *          边上是毛的；手臂在本来的位置上时它埋在躯干里，转到别的方向就支出来了。切口的棱倒圆；
 * cap   —— 切口上垫一个比断面大一圈的球当肩头，把切口整个包住（手臂自己的坐标）；
 * fuse  —— 几条手臂的根部互相圆滑地融在一起：圆角多大，离肩关节多远以内融、到多远完全分开。
 */
/**
 * 本来那对手臂的肩膀在哪个范围里合得上（见 Part.posed）：以「比平举低 35°」为中心、50° 以内——
 * 也就是往上到比平举高 15°，往下到差不多贴着身体，往前往后各四十来度。出了这个范围，重新融合时换成根部切掉、垫圆肩头的那一种。
 * 往上留得少：手臂是照平举做的，再往上抬，根上那圈腋下的皮就翻出来了
 */
const SHOULDER_HOME = (35 * Math.PI) / 180;
const SHOULDER_SWAP = (50 * Math.PI) / 180;
/**
 * 换上的那个圆肩头（手臂自己的坐标）。一个肩膀上只有这一条手臂时用：正好包住切口，不比手臂粗——
 * 手臂的断面不在关节的轴线上（偏下 1.3 厘米、偏前一点），上下半径 3.5 厘米、前后 3.2 厘米。
 * 聚在肩膀上的几条还是用 FAN.cap 那个大一圈的（要盖住旁边几条的根）
 */
const RAISED_CAP = { center: [0.03, -0.013, 0.004] as V3, radius: 0.037 };
/**
 * 长在素体本来的肩膀上、没有聚拢的那条手臂：肩头垫的那一块（手臂放下来以后肩膀上面不缺一块）。
 * 扁一点、往里往下挪一点，圆滑地融进去：太大太圆的话肩膀上顶着一个球
 */
/** 素体的脖子细得像一根棍：加粗这么多倍（根上连着斜方肌的那一截不变，和躯干还是对得上） */
const NECK_THICK = 1.15;
/** 手臂变细时手跟着缩小的比例（细到四成粗时，手缩到原来的七成六） */
const HAND_SHRINK = 0.4;
/** 第一排胸的大小调开多少（倍数差）以后，完全换回圆滑地融 */
const CHEST_EASE = 0.3;
/**
 * 胸放大到 LARGE_FROM 以上，渐渐换成大胸的胸型（anime/body.ts 的 BUST_LARGE），再大 LARGE_EASE 换足：
 * 素体自带的是小胸，照原样放大像一个放大的尖圆锥，背面那块薄盖子还从锁骨上、腋下支出来（看着是空壳）。
 * 大胸的胸型下半截饱满、往下坠，背面是实心的。原样大小、往小调的时候不换
 */
const LARGE_FROM = 1.1;
const LARGE_EASE = 0.5;
const SHOULDER_CAP = { center: [-0.006, -0.006, 0] as V3, radii: [0.038, 0.03, 0.034] as V3, soft: 0.015 };
const FAN = {
  inset: 0.02,
  clip: { clipX: 0.035, clipRound: 0.012 },
  cap: { center: [0.035, -0.01, 0.003] as V3, radius: 0.043 },
  // 根部互相圆滑地融合：离肩关节 4 厘米以内是完整的圆角，到 8 厘米减到没有。
  // 再往外还圆滑的话，几条手臂摆开一点（还没分开多远）时，它们之间会扯出一片蹼（以前到 15 厘米）
  fuse: { soft: 0.025, fade: [0.04, 0.08] as [number, number] },
};

/**
 * 头身比：滑块在默认位置（7.5）时就是素体本来的比例，往两边拖是在这个基础上加减。
 * 返回头的缩放倍率，以及标准人形在缩放到设定身高之前的高度。
 */
function headProportion(headRatio: number) {
  const ratio = NATIVE_RATIO + (headRatio - 7.5);
  const above = ANIME_HEAD.top - HEAD_JOINT[1];
  const hs = HEAD_JOINT[1] / (2 * HEAD_H * ratio - above);
  return { hs, baseHeight: HEAD_JOINT[1] + above * hs };
}

export function layoutAnime(spec: BodySpec): Figure {
  const c = spec.counts;
  const sh = spec.shape;
  // 体格：肩宽、腰宽、胯宽、四肢粗细一起乘上去
  const b = sh.build;
  const tPose = spec.pose === 'T';
  const plan = legPlan(spec);
  const form = plan.form;
  const proportion = headProportion(sh.headRatio);
  const baseHeight = proportion.baseHeight;
  // 一个头上几张脸：只有一个头、一根脖子，多出来的脸长在这个头的两边和后面
  const faces = spec.headLayout === 'faces' && c.heads > 1;
  const necks = faces ? 1 : c.heads;
  // 头多了每个头小一圈（见 bodyPlan.ts）
  const hs = proportion.hs * headShrink(necks);
  const parts: Part[] = [];

  /* ---- 躯干 ---- */
  const stacked = spec.armLayout === 'stack';
  const rows = Math.max(stacked ? c.armPairs : 1, c.chestPairs, 1);
  const extra = GAP * (rows - 1);
  const shoulderY = SHOULDER[1] + extra;
  // 多个头：凑成一簇，脸贴着脸；脖子根并排挤在肩膀中间（见 bodyPlan.ts）。
  // 素体的肩膀窄、头大：四五个头时脖子根排不下，肩膀会稍微加宽一点
  const headSize = { width: 2 * HEAD_W * hs, neck: NECK_REACH, rise: HEAD_REACH * hs };
  const shoulderX = shoulderSpan(necks, headSize.width, SHOULDER[0] * sh.shoulders * b, NECK_ROOM);
  /** 肩膀每边加宽了多少（负的是收窄了） */
  const widen = shoulderX - SHOULDER[0];
  /** 腰每边宽出多少：腰侧在拉开的那一段里，挪得比 amount 少一点 */
  const waistWide = ((sh.waist * b - 1) * SHAPE.waist.half) / smooth(SHAPE.waist.half / SHAPE.waist.core);
  /** 胯宽的倍数。只在胯上还是素体原来那一对腿时拉（别的腿不是照素体的腿根接的，拉了对不上） */
  const hipWide = plan.stations[0] === 2 && (form === 'biped' || form === 'humantaur') ? sh.hips * b : 1;
  /** 胯按比例拉宽（见 SHAPE.hips）：躯干、腿各自的格子里身体中线在哪、高度差多少 */
  const spread = (mid: number, rise: number) => (Math.abs(hipWide - 1) > 1e-6 ? { spreadX: { mid, rise, k: hipWide, levels: SHAPE.hips } } : {});
  /** 躯干那一块分几段往两边拉开、压窄（见 GridShape.widenX）：肩、腰、胯 */
  const bands: WidenBand[] = [];
  if (Math.abs(widen) > 1e-6) bands.push([widen, WIDEN[0], WIDEN[1], WIDEN[2]]);
  if (Math.abs(waistWide) > 1e-6) {
    // 从下面渐渐宽出来，过了最细的地方再渐渐收回去
    const { y, below, above, core } = SHAPE.waist;
    bands.push([waistWide, y - below, y, core], [-waistWide, y, y + above, core]);
  }
  /** 四肢粗细的倍数 */
  const limb = sh.limbs * b;
  // 加粗得多时，从根上不变到变足的那一段跟着拉长：不然腿根、肩头那里一下子鼓出一圈，像穿了灯笼裤
  const grown = ([from, full, tip]: [number, number, number]): [number, number, number] => [from, full + (full - from) * RAMP_GROW * Math.max(0, limb - 1), tip];
  const thick = (to: V3, ramp: [number, number, number], end = 1) =>
    Math.abs(limb - 1) > 1e-6 ? { thicken: { from: O, to, k: limb, ramp: grown(ramp), end } } : {};
  /** 手臂很细时手也小一点（按手腕缩放），手腕跟着细到一样：不然一只原样大的手接在一根细棍上，也缝不上 */
  const handSize = limb < 1 ? 1 + HAND_SHRINK * (limb - 1) : 1;
  const headPlaces = headCluster(necks, headSize, shoulderX - NECK_ROOM);
  // 人马 / 蛛形：上半身抬高、前移，坐在兽身的前端
  const lift = beastLift(form);

  // 胸部大小往小调：躯干在「原样」和「平胸」两份形状之间混合
  const flat = Math.min(1, Math.max(0, (1 - sh.bust) / (1 - BUST_FLAT)));
  const torsoShape = grid('Torso', 'torso', 1, {
    ...(extra ? { stretchY: [STRETCH[0], STRETCH[1], extra] as [number, number, number] } : {}),
    ...(flat ? { morph: [animeGrid('torsoFlat'), flat] as [string, number] } : {}),
    // 肩膀加宽：从胸口往上逐渐加宽；腰在那一段加宽、收窄；胯按比例拉宽
    ...(bands.length ? { widenX: bands } : {}),
    ...spread(0, 0),
  });
  /** 躯干上离中线 x、高度 y（加长之前）的一点，因为肩膀、腰加宽往外挪了多少 */
  const pushed = (x: number, y: number) => widenBy(x, y, bands);
  const torso: Prim[] = [torsoShape];
  if (necks % 2 === 0) {
    // 双数个头：正中间没有脖子，露出素体自己那截脖子根的断面，垫一小块把它抹圆
    torso.push(mass('Saddle', [0.05, 0.024, 0.046], [0, NECK[1] + extra + 0.006, NECK[2] + 0.004], 0.025));
  }

  // 朝躯干打射线找表面（躯干自己的坐标）
  const probe = fieldOf([torsoShape]);
  /** 高度 y、前后 z 处，躯干往左（+X）最远到哪 */
  const sideAt = (y: number, z: number) => 0.5 - castRay(probe, [0.5, y, z], [-1, 0, 0], 0.5);
  /** 左右 x、高度 y 处，躯干前、后表面的位置 */
  const frontAt = (x: number, y: number) => 0.5 - castRay(probe, [x, y, 0.5], [0, 0, -1], 0.5);
  const backAt = (x: number, y: number) => -0.5 + castRay(probe, [x, y, -0.5], [0, 0, 1], 0.5);
  // 屁股缝：素体自己的屁股上有一道浅的，照着挖深（多出来的胯、加宽的胯上的屁股见 lowerParts）。
  // 照一瓣屁股的正中往下找最鼓的那一圈，缝就开在那个高度的正中
  if (form === 'biped') {
    const radii = cheekRadii(b, 1);
    let apex: V3 = [0, HIP[1], backAt(CHEEK_X, HIP[1])];
    for (let y = HIP[1] - 0.06; y <= HIP[1] + 0.08; y += 0.005) {
      const z = backAt(CHEEK_X, y);
      if (z < apex[2]) apex = [0, y, z];
    }
    torso.push(cleft('Cleft', [0, apex[1], apex[2] + radii[2]], radii, b));
  }

  // 脊柱：Hips → Spine → Chest →（每多一排多一节）→ UpperChest
  const chestTop = STRETCH[1] + extra;
  const levels: [name: string, at: V3][] = [
    ['Hips', HIPS],
    ['Spine', SPINE],
    ['Chest', [0, STRETCH[0], 0.02]],
  ];
  for (let i = rows - 1; i >= 1; i--) levels.push([nthName('Chest', i), [0, chestTop - i * GAP, 0.02]]);
  levels.push(['UpperChest', [0, chestTop, 0.02]]);
  const neckBase: V3 = [NECK[0], NECK[1] + extra, NECK[2]];
  const spine = levels.map(([name, at], j) =>
    bone(name, at, j + 1 < levels.length ? levels[j + 1][1] : neckBase, j ? levels[j - 1][0] : undefined),
  );
  parts.push({
    name: TORSO,
    type: 'torso',
    side: 0,
    pos: lift,
    quat: Q_ID,
    pivot: HIPS,
    material: 'clay',
    prims: torso,
    bones: spine,
  });

  /* ---- 脖子和头 ---- */
  /** 头关节（脖子顶端）在头自己坐标里的位置 */
  const headPivot = sub(HEAD_JOINT, HEAD_ORIGIN);
  // 头发：每个头各戴一副。头发的数据就是照素体的头摆的，直接戴上（见 wig.ts）
  const wig = wigOf(spec.hair);
  const hair: HeadHair | undefined = wig ? { spec: wig, skull: ANIME_SKULL } : undefined;
  let crown = 0;
  for (let k = 0; k < necks; k++) {
    const place = headPlaces[k];
    const base: V3 = [neckBase[0] + place.x, neckBase[1], neckBase[2] + place.z];
    const single = necks === 1;
    // 没挪位置的脖子（只有一个头，或者单数个头正中间的那个）：用素体的，连着斜方肌，和躯干严丝合缝。
    // 挪了位置、斜着伸出去的：素体那块带着肩膀的喇叭口会支出来，改用一根光溜的圆台。
    // 肩膀加宽过的话躯干上脖子根那一片被拉开了，素体的脖子对不上，也用圆台
    const inPlace = single || (!place.x && !place.z && !place.tilt && !place.turn && Math.abs(widen) < 1e-6);
    // 素体的脖子本来略微前倾：照着排好的方向斜过去，够不着的时候按排好的长度加长
    const neckSpan = inPlace ? NECK_SPAN : mul(rotate(quatBetween(UP, norm(place.neck)), NECK_SPAN), len(place.neck) / NECK_REACH);
    parts.push({
      name: `Neck_${pad(k + 1)}`,
      type: 'neck',
      side: 0,
      parent: TORSO,
      pos: base,
      quat: Q_ID,
      material: 'clay',
      prims: inPlace
        ? [grid('Neck', 'neck', 1, { thicken: { from: O, to: NECK_SPAN, k: NECK_THICK, ramp: [0.012, 0.035, 0.035] } })]
        : [
            // 往下多伸一截埋进肩膀里；根部垫一团软的，像斜方肌那样顺着肩线铺开
            cone('Neck', mul(neckSpan, -0.06 / len(neckSpan)), neckSpan, 0.04, 0.03),
            mass('NeckRoot', [0.046, 0.028, 0.042], [0, -0.014, 0], 0.03),
          ],
      bones: [bone(nthName('Neck', k), O, neckSpan, 'UpperChest')],
      ...(inPlace ? NATIVE : {}),
    });
    // 头关节正好落在脖子顶端；头放大、缩小都以它为中心
    const turn = headTurn(place);
    const neckTop = add(base, neckSpan);
    const center = sub(neckTop, mul(rotate(turn, headPivot), hs));
    // 人耳：加了兽耳就都不要；挨着别的头的那一侧也不要（k 越大越靠角色的左手边）；两边长着脸的时候也不要
    const sideFaces = faces && c.heads > 2;
    const ears: HumanEars =
      c.earPairsPerHead > 0 || sideFaces || (k > 0 && k < c.heads - 1) ? 'none' : single ? 'both' : k ? 'left' : 'right';
    const beside = faces ? { left: sideFaces, right: sideFaces } : { left: k < c.heads - 1, right: k > 0 };
    const name = `Head_${pad(k + 1)}`;
    const made = makeHead(name, TORSO, center, turn, hs, c, spec.earShape, 'female', { index: k, neckTop: headPivot, beside }, animeHead(ears), hair);
    // 头没有放大缩小时，和素体的脖子也是原样接上的
    if (single && Math.abs(hs - 1) < 1e-6) Object.assign(made[0], NATIVE);
    parts.push(...made);
    if (faces) {
      // 多出来的脸：长在同一个头上，朝着两边和后面（见 bodyPlan.ts）
      faceTurns(c.heads).forEach((yaw, i) => {
        if (i) parts.push(...makeFace(`Head_${pad(i + 1)}`, name, yaw, FACE_PIVOT, FACE_OUT * HEAD_W, c, spec.earShape, 'female', i, animeHead('none')));
      });
    }
    const top = hs * Math.hypot(HEAD_W * Math.sin(place.tilt), HEAD_H * Math.cos(place.tilt));
    crown = Math.max(crown, lift[1] + center[1] + top);
  }

  /* ---- 手臂 ---- */
  const armLift = form === 'row' ? 6 * Math.max(0, plan.stations[0] - 2) : form === 'abreast' ? 6 * Math.max(0, plan.total - 2) : 0;
  /** 素体本来的肩关节（肩膀加宽以后跟着往外挪了） */
  const shoulder: V3 = [shoulderX, shoulderY, SHOULDER[2]];
  /** 聚在一个肩膀上的几条手臂（肩部聚拢、不止一对） */
  const fanned = !stacked && c.armPairs > 1;
  /** 肩部聚拢时肩关节最多往后排多深：素体的身子薄，排到后背表面往里一点为止 */
  const fanDepth = Math.max(0.02, shoulder[2] - backAt(shoulder[0] - 0.02, shoulderY - 0.02) - FAN.inset);
  /**
   * 肩部聚拢时，第 i 对手臂的肩关节在哪（左边的）：垂得最直、最贴身的最后一对在本来的肩膀上，
   * 其余的从它后面长出来，张得越开的越靠后、稍低、往里收一点（见 bodyPlan.ts）。前胸是干净的。
   */
  const fanJoint = (i: number): V3 => add(shoulder, fanShift(c.armPairs - 1 - i, c.armPairs, fanDepth));
  /**
   * 沿躯干上下排时，第 i 排（i ≥ 1）的肩关节：贴着躯干侧面，前后在躯干厚度的正中。
   * 关节在躯干表面上，肩头朝外的半边就露在外面，像一副真的肩膀。
   */
  const stackJoint = (y: number): V3 => {
    // 沿正中线量厚度：那里前面没有胸挡着
    const mid = (frontAt(0, y) + backAt(0, y)) / 2;
    return [Math.max(sideAt(y, mid) - 0.004, 0.06), y, mid];
  };
  /** 手臂自己的粗细加一点余量：垂下来时要让开别的东西这么远（手臂调粗了跟着多让） */
  const clearance = 0.035 + 0.03 * limb;
  /** 肩关节在 joint 时手臂最少要张开多少度：蛛形下身要从两侧拱起的蛛腿上面过去 */
  const floorAt = (joint: V3) => (form === 'spider' ? spiderFloor(joint, plan.stations.length, b, limb, lift, clearance) : 18);
  let hang: number[] = [];
  if (!stacked && !tPose) {
    // 自然下垂时，最贴身的一对要让开胯、下面几排胸、马身。
    // 胯上三条以上腿（左右并排、人腿人马前面那副胯）时胯底下垫着一副更宽的胯（见下半身 frontCover），要让开它
    const cover = plan.stations[0] > 2 && (form === 'row' || form === 'biped' || form === 'humantaur') ? HIP[0] * (plan.stations[0] - 1) + 0.07 * b : 0;
    const blocks: HangBlock[] = [
      form === 'taur'
        ? { wide: 0.21 * b, level: TAUR_LEVEL - lift[1] }
        : { wide: form === 'abreast' ? abreastSpots(plan.stations, sideAt(HIP[1] + 0.03, 0), HIP[0]).wide : sideAt(HIPS[1], 0), level: HIPS[1] },
    ];
    // 垫的那副胯是个椭球（正中在 HIP[1] + 0.03，半高 0.1 b）：上半截也很宽，沿着它的上沿多量几个高度
    if (cover) for (const s of [0, 0.4, 0.7, 0.9]) blocks.push({ wide: cover * Math.sqrt(1 - s * s), level: HIP[1] + 0.03 + s * 0.1 * b });
    for (let j = 0; j < c.chestPairs; j++) {
      blocks.push({ wide: BUST[0] + 0.095 * sh.bust * (1 - 0.1 * j), level: BUST[1] + extra - j * GAP });
    }
    hang = hangAngles(c.armPairs, Math.max(48 + armLift, form === 'spider' ? floorAt(shoulder) : 0), { x: shoulder[0], y: shoulder[1] }, blocks, floorAt(shoulder), clearance);
  }
  // 做摆姿势用的网格时手臂先摆开再融合（见 Part.bind）
  const bindTo = bindAngles(c.armPairs, stacked, tPose);
  // 手臂放下来时手肘自然往前弯一点；平举（T-pose）时保持素体原样的直臂
  const bend = tPose ? 0 : ELBOW_BEND;
  const elbow = sub(ELBOW, SHOULDER);
  for (let i = 0; i < c.armPairs; i++) {
    const mid = i - (c.armPairs - 1) / 2;
    let joint: V3;
    let theta: number;
    let phi: number;
    if (stacked) {
      joint = i ? stackJoint(shoulderY - i * GAP) : shoulder;
      theta = tPose ? 90 * DEG : (form === 'spider' ? Math.max(48 - i * 2 + armLift, floorAt(joint)) : 48 - i * 6 + armLift) * DEG;
      phi = tPose ? 0 : mid * (form === 'spider' ? 0.1 : 0.2);
    } else if (tPose) {
      // 举得高的在后面、往后摆，放得低的在前面、往前摆
      const top = 125 - (faces ? 1 : c.heads - 1) * 8;
      const lowest = Math.max(45 + armLift, form === 'spider' ? floorAt(shoulder) : 0);
      const bottom = Math.max(lowest, Math.min(180 - top, top - 20 * (c.armPairs - 1)));
      joint = fanJoint(i);
      theta = (c.armPairs === 1 ? 90 : top - (i * (top - bottom)) / (c.armPairs - 1)) * DEG;
      phi = mid * 0.35;
    } else {
      joint = fanJoint(i);
      theta = hang[i] * DEG;
      phi = mid * 0.18;
    }
    const [x, y, z] = joint;
    /** 这一对是不是长在素体本来的肩膀上 */
    const onShoulder = stacked ? i === 0 : i === c.armPairs - 1;
    const armParent = stacked && i ? nthName('Chest', i) : 'UpperChest';
    // 最上面一对平举着：就是素体本来的样子（肩膀加宽过就不是了：躯干上的肩口被拉斜了一点，要靠圆滑过渡接上）
    const native = i === 0 && tPose && (stacked || c.armPairs === 1) && Math.abs(widen) < 1e-6 && Math.abs(limb - 1) < 1e-6;
    for (const side of SIDES) {
      const dir = armDirection(side, theta, phi);
      const name = (base: string) => nthName(`${base}_${tag(side)}`, i);
      // 关节在手臂自己坐标里的位置；手肘弯了的话，肘以下的跟着转过去
      const local = (joint: V3) => {
        const p = sub(joint, SHOULDER);
        if (bend && p[0] > elbow[0]) {
          const dx = p[0] - elbow[0];
          const dz = p[2] - elbow[2];
          p[0] = elbow[0] + dx * Math.cos(bend) - dz * Math.sin(bend);
          p[2] = elbow[2] + dx * Math.sin(bend) + dz * Math.cos(bend);
        }
        return mirror(p, side);
      };
      /** 手上的关节：先照手的大小绕手腕缩放 */
      const handLocal = (joint: V3) => local(add(WRIST, mul(sub(joint, WRIST), handSize)));
      const armShape = grid('Arm', 'arm', side, {
        ...(onShoulder ? {} : fanned ? FAN.clip : { clipX: -0.008 }),
        ...(bend ? { bend: [elbow[0], elbow[2], bend, ELBOW_WIDTH] as [number, number, number, number] } : {}),
        // 四肢粗细：肩头、手腕两头不变（手缩小了的话手腕跟着细到一样），手接得上
        ...thick(sub(WRIST, SHOULDER), SHAPE.arm, handSize),
        // 手不过距离场（手指比体素还细，过一遍就粘成一团）：手臂只做到手腕外面一点，手另外接现成的网格
        clipTo: WRIST[0] - SHOULDER[0] + HAND_STUMP,
        // 聚在一个肩膀上的：根部互相融成一片，不留一道道硬棱；伸出去以后各是各的
        ...(fanned ? FAN.fuse : {}),
      });
      // 肩头垫一个球：手臂放下来以后，肩膀上面不会缺一块。
      // 聚在一个肩膀上、又不在本来那个位置的：球要大到把切口整个包住，并且圆滑地融进旁边的手臂
      const cap = !fanned
        ? onShoulder
          ? mass('Shoulder', SHOULDER_CAP.radii, mirror(SHOULDER_CAP.center, side), SHOULDER_CAP.soft)
          : ball('Shoulder', 0.036, O)
        : onShoulder
          ? mass('Shoulder', [0.04, 0.04, 0.04], O, FAN.fuse.soft)
          : mass('Shoulder', [FAN.cap.radius, FAN.cap.radius, FAN.cap.radius], mirror(FAN.cap.center, side), FAN.fuse.soft);
      // 长在本来的肩膀上的那条，根上连着一圈腋下的皮：摆姿势时手一举高它就翻出来。
      // 照摆好的姿势重新融合时换成聚在肩膀上的手臂的做法：根部切掉，切口上垫一个圆肩头。
      // 一个肩膀上只有这一条时，肩头和手臂一样粗、直接拼上（圆滑地融的话，两个面贴得近的地方会整圈鼓出去半厘米，像套了个袖箍）
      const posed: Prim[] | null = onShoulder
        ? [
            grid('Arm', 'arm', side, {
              ...FAN.clip,
              ...(bend ? { bend: [elbow[0], elbow[2], bend, ELBOW_WIDTH] as [number, number, number, number] } : {}),
              ...thick(sub(WRIST, SHOULDER), SHAPE.arm, handSize),
              clipTo: WRIST[0] - SHOULDER[0] + HAND_STUMP,
              ...(fanned ? FAN.fuse : {}),
            }),
            fanned
              ? mass('Shoulder', [FAN.cap.radius, FAN.cap.radius, FAN.cap.radius], mirror(FAN.cap.center, side), FAN.fuse.soft)
              : ball('Shoulder', RAISED_CAP.radius, mirror(RAISED_CAP.center, side)),
          ]
        : null;
      // 素体的手臂是平举着的：整条绕肩关节转到要的方向
      const turn = quatBetween([side, 0, 0], dir);
      // 锁骨从脊柱旁边伸到肩关节，它不跟着手臂转：先把它转回去
      const collar = rotate(quatConj(turn), [-side * Math.max(x - 0.025, 0.02), 0.012, 0]);
      parts.push({
        name: `Arm_${pad(i + 1)}_${tag(side)}`,
        type: 'arm',
        side,
        parent: TORSO,
        pos: [side * x, y, z],
        quat: turn,
        axes: quatBetween(DOWN, [side, 0, 0]),
        material: 'clay',
        // 不在本来的肩膀上的那些：把连着肩膀的那一圈切掉（上面的 clipX），不然会从后背顶出来
        prims: native ? [armShape] : [armShape, cap],
        ...(posed ? { posed: { prims: posed, home: [side * Math.cos(SHOULDER_HOME), -Math.sin(SHOULDER_HOME), 0] as V3, beyond: SHOULDER_SWAP } } : {}),
        // 手：素体模型上现成的那只手，和上面 local() 一样摆（挪到肩关节为原点，跟着手肘弯过去，右手是翻过来的）
        grafts: [{ ...handGraft(name), ...handPlace(side, bend, elbow, handSize) }],
        bones: [
          bone(name('Shoulder'), collar, O, armParent),
          bone(name('UpperArm'), O, local(ELBOW), name('Shoulder')),
          bone(name('LowerArm'), local(ELBOW), local(WRIST), name('UpperArm')),
          bone(name('Hand'), local(WRIST), handLocal(KNUCKLE), name('LowerArm')),
          // 手指：素体自带的关节位置，每根三节
          ...FINGER_JOINTS.flatMap(({ finger, joints }) =>
            [0, 1, 2].map((k) => ({
              ...bone(name(`${finger}${k + 1}`), handLocal(joints[k]), handLocal(joints[k + 1]), k ? name(`${finger}${k}`) : name('Hand')),
              strand: finger,
            })),
          ),
        ],
        ...(native ? NATIVE : {}),
        ...(bindTo[i] ? { bind: quatBetween(dir, armDirection(side, bindTo[i]!.theta, bindTo[i]!.phi)) } : {}),
      });
    }
  }

  /* ---- 胸：第一排就是素体自带的（躯干上本来就有，这一块叠在原位，放大时才看得出来）；
          往下每排小一点，背面的切口埋进加长的胸腔前面一点点 ---- */
  for (let j = 0; j < c.chestPairs; j++) {
    const y = BUST[1] + extra - j * GAP;
    // 第一排往小调时，躯干上自带的胸已经在变平了：这一块跟着缩小、往里收，不要反过来顶出一个小包
    // 往大调时这一块的边沿会从胸口支出来一圈：放大多少就往里收一点，让边沿留在皮肤下面
    const z = j
      ? frontAt(BUST[0] + BUST_CAP[0], y + BUST_CAP[1]) - BUST_CAP[2] - 0.008
      : BUST[2] - 0.03 * flat - 0.03 * Math.max(0, sh.bust - 1);
    const size = j ? sh.bust * (1 - 0.1 * j) : sh.bust < 1 ? Math.max(0.15, 1 - flat) : sh.bust;
    // 肩膀加宽时，躯干上自带的胸跟着往两边挪了一点：叠在上面的这一块也跟着挪（下面几排在加宽的范围以外）
    const x = BUST[0] + (j ? 0 : pushed(BUST[0], BUST[1]));
    for (const side of SIDES) {
      const name = `Chest_${pad(j + 1)}_${tag(side)}`;
      // 第一排叠在原位时，和躯干上自带的那对是同一张皮：圆滑地融的话两张皮贴在一起的地方整个鼓起一层、边上一圈棱。
      // 所以当成躯干的一部分直接取并集；大小往两头调开以后，渐渐换回圆滑地融。
      // 手动挪过的、肩宽腰宽调过的（躯干上自带的胸被拉得挪了一点，两张皮对不齐了）照旧圆滑地融
      const inPlace = !j && !spec.overrides[name] && !bands.length;
      const ease = Math.min(1, Math.abs(size - 1) / CHEST_EASE);
      const large = Math.min(1, Math.max(0, (size - LARGE_FROM) / LARGE_EASE));
      parts.push({
        name,
        type: 'chest',
        side,
        parent: TORSO,
        pos: [side * x, y, z],
        quat: Q_ID,
        scale: size,
        material: 'clay',
        ...(inPlace ? { fuseAs: 'torso' as const } : {}),
        prims: [
          grid('Breast', 'bust', side, {
            ...(inPlace && ease > 0 ? { soft: (spec.blend * (GROUP_BLEND.chest ?? 1) * ease) / size } : {}),
            ...(large > 0 ? { morph: [BUST_LARGE, large] as [string, number] } : {}),
          }),
        ],
      });
    }
  }

  /* ---- 翅膀 ---- */
  parts.push(
    ...wingParts(c.wingPairs, TORSO, (i, side) => {
      const y = shoulderY - 0.07 - i * 0.13;
      return [side * 0.05, y, backAt(0.05, y) + 0.015];
    }),
  );

  /* ---- 下半身 ---- */
  /** 腿往外斜（胯部聚拢）时，往下多深斜满：在脚的切口上面一点就斜满了，再往下（缝脚的那一截、脚）整个平移，切口是平的 */
  const legDepth = HIP[1] - ANKLE[1] - FOOT_CUFF - 0.03;
  /** 腿的几个关节（髋关节在原点）；out：往外斜多少（胯部聚拢时散开），见 GridShape.lean */
  const legJoints = (side: number, out = 0): V3[] =>
    // 脚趾的关节是现成的脚上的：跟着脚一样往下挪一点（见 footPlace）
    [O, KNEE, ANKLE, add(FOOT_TOE, [0, -FOOT_LIFT, 0]), add(FOOT_TOE_END, [0, -FOOT_LIFT, 0])].map((p) => {
      if (p === O) return O;
      const q = mirror(sub(p, HIP), side);
      return [q[0] + (side || 1) * out * Math.min(1, -q[1] / legDepth), q[1], q[2]];
    });
  /** 胯（躯干）上正好一对腿时，那一对就在素体原来的位置上 */
  const frontPair = plan.stations[0] === 2;
  /** 胯上只有一条腿（单足；人腿人马每副胯一条）：最前面那条 */
  const single = plan.stations[0] === 1 && (form === 'biped' || form === 'humantaur');
  /** 胯上三条以上腿时垫在胯底下的那副胯（见 LowerOptions.cover）：和腿左右并排时的胯一样 */
  const frontCover = (n: number): { radii: V3; center: V3 } => ({
    radii: [HIP[0] * (n - 1) + 0.07 * b, 0.1 * b, 0.115 * b],
    center: [0, 0, -0.007],
  });
  const pelvisY = HIP[1] + 0.03;
  /** 还在素体原来位置上的腿：双足站立，或者人腿人马最前面那一对（那副胯上正好一对时） */
  const nativeLegs = (pair: number) => frontPair && pair === 0 && (form === 'biped' || form === 'humantaur');
  /** 素体在高度 y 处的半厚（前后） */
  const thickAt = (y: number) => (frontAt(0, y) - backAt(0, y)) / 2;
  const lowerBody = lowerParts({
    form,
    stations: plan.stations,
    b,
    hips: 1,
    limb,
    hx: HIP[0],
    hipY: HIP[1],
    hipZ: HIP[2],
    pelvisY,
    tailRoot: [0, 0.93, backAt(0, 0.93) + 0.02],
    // 人腿人马：后面接的腰和胯照素体自己的腰、胯那么粗；胯部聚拢垫的胯也是
    ...(form === 'humantaur'
      ? { waist: [sideAt(WAIST_Y, 0) + 0.008, thickAt(WAIST_Y) + 0.008] as [number, number], pelvis: [sideAt(pelvisY, 0), 0.1, thickAt(pelvisY) + 0.01] as V3 }
      : form === 'gather' || form === 'abreast'
        ? { pelvis: [sideAt(pelvisY, 0), 0.1, thickAt(pelvisY) + 0.01] as V3 }
        : {}),
    rowSeat: true,
    // 胯上三条以上腿（人腿人马每副胯好几条）：两个腿根的切口露在外面，垫一副胯包住
    ...(plan.stations[0] > 2 && (form === 'biped' || form === 'humantaur') ? { cover: frontCover(plan.stations[0]) } : {}),
    humanLeg: (side, pair, parent, out) =>
      side
        ? {
            // 还在素体原来位置上的那一对，腿根跟着胯一起拉宽；胯部聚拢时往外斜
            prims: [
              grid('Leg', 'leg', side, {
                // 四肢粗细：腿根、脚的切口两头不变，脚接得上
                ...thick(sub(FOOT_RIM, HIP), SHAPE.leg),
                ...(nativeLegs(pair) ? spread(-HIP[0], HIP[1]) : {}),
                ...(out ? { lean: [out, legDepth] as [number, number] } : {}),
                clipBelow: LEG_CLIP,
              }),
            ],
            bones: legBones(side, pair, parent, legJoints(side, out)),
            // 还在素体原来位置上的腿：双足站立，或者人腿人马最前面那一对（那副胯上正好一对时）
            native: nativeLegs(pair),
            part: { grafts: [{ ...footGraft(legName(side, pair)), ...footPlace(side, out) }] },
          }
        : {
            prims: [grid('Leg', 'leg', 1, { ...thick(sub(FOOT_RIM, HIP), SHAPE.leg), clipBelow: LEG_CLIP })],
            bones: legBones(0, pair, parent, legJoints(1)),
            // 胯上只有这一条（单足）：粗一圈，把两个腿根中间填满
            part: {
              quat: STRAIGHTEN,
              ...(single ? { stretch: SINGLE_LEG } : {}),
              grafts: [{ ...footGraft(legName(0, pair)), ...footPlace(1, 0, STRAIGHTEN) }],
            },
          },
  });
  parts.push(...lowerBody.parts);
  // 胯上只有一条腿（单足；人腿人马每副胯一条）：素体原来的两条腿只留最上面一截（Hip_L、Hip_R），
  // 和躯干合得严丝合缝，腿根的切口就不露出来；中间那条腿从它们中间长出来。它们没有骨骼，跟着胯
  if (plan.stations[0] === 1 && (form === 'biped' || form === 'humantaur')) {
    for (const side of SIDES) {
      parts.push({
        name: `Hip_${tag(side)}`,
        type: 'lower',
        side,
        pos: [side * HIP[0], HIP[1], HIP[2]],
        quat: Q_ID,
        material: 'clay',
        prims: [grid('Thigh', 'leg', side, { clipBelow: HIP_STUMP, clipRound: 0.05 })],
        ...NATIVE,
      });
    }
  }

  /* ---- 尾巴 ---- */
  parts.push(...tailParts(c.tails, sh, b, lowerBody.tailRoot, lowerBody.tailParent));

  // 人腿：脚底踩到地面上（兽腿本来就是按地面摆的）
  const drop = form === 'taur' || form === 'spider' ? 0 : SOLE;
  if (drop) for (const part of parts) if (!part.parent) part.pos = [part.pos[0], part.pos[1] - drop, part.pos[2]];

  const scale = sh.height / (baseHeight - SOLE);
  const height = (crown - drop) * scale;
  const headHeight = 2 * HEAD_H * hs * scale;
  return { parts, scale, metrics: { height, headHeight, headRatio: height / headHeight, legForm: form } };
}
