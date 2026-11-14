/**
 * 围成一圈：几个人背靠背站成一圈、脸朝外，融合成一个身子。头成一圈，胸环绕身体一周，腿往四周排开。
 * 分两种：
 * - 各有各的胯（hips）：每个人自己的腰、胯都看得出来，人和人之间是一道道竖着的沟；圈心垫一根细芯子，从上面看不到洞；
 * - 并胯融合（fused）：芯子粗到差一点到每个人的肚皮，人和人之间的沟填平，整个身子是一个圆桶，胯并成一圈，腿绕着圆桶排开。
 *
 * 做法（白模人台、二次元素体共用；和 conjoined.ts 一样在摆好的部件上做）：
 * 1. 照一个人摆好（一个上半身、两条人腿、一对手臂）；
 * 2. 手臂只留整个身子左右两侧的（「手臂几对」就是每侧几条），别的肩膀上不长手臂，各垫一个圆肩头（素体的躯干没有手臂时肩膀是一圈毛边）。
 *    留在一圈肩膀里离正左、正右最近的那一个肩膀所在的人身上（摆好的那个人就是照这么多对、这种排法摆的），朝正侧面。
 *    多对手臂两种排法（armLayout）：肩部扇形聚拢（fan）是几条都从那一个肩膀上长出来，上下扇开（举得高的在后、放得低的在前）；
 *    上下排（stack）是几条沿着那个人的身侧往下排成一竖列；
 * 3. 整个人绕髋关节那个高度往圈心靠（上身往里），再往外挪到圈上：胯那一圈的半径照「所有的腿在圈上隔得一样远」定（再乘圈的松紧），
 *    靠多少照「几根脖子的根在圈心挨着」定；脖子再从根上往外歪、头跟着歪一半，几个头在圈上正好挨着（像一束花，画里就是这样），
 *    不靠身子挤、头互相插进去。腿跟着身子一起斜（不跟着的话大腿根和身子对不齐，出一圈棱），脚在脚踝上转回去，脚底是平的（见 flatFoot）；
 * 4. 整份复制 count − 1 份（部件、骨骼接着往下编号），各绕竖轴转过去；骨架还是一根 Hips，挪到圈心、放在芯子里；
 * 5. 相邻两个人算成不同的两类融合（见 Part.fuseAs）：挨着的地方圆滑地过渡，不是一刀切的棱；
 * 6. 圈心垫一根芯子（一摞圆截面），粗细照一个人的后背、肚皮各离圈心多远量。
 * 7. 胸交错成串（stagger）：每个人的胸连成几圈，整圈一个规矩排成一张错开的网——每圈每人几只照胸的大小排满（见 packChest，
 *    胸大的每人两只）、绕圈心等间隔，隔一圈错开半个，
 *    都朝正外、都坐在芯子上（怎么摆见 strung）；圈和圈挨得更紧（错开的两圈互相嵌进去）。交错渐小（taper）再加上越往下的圈越小。
 *    有胸的那一段芯子两种模式都粗到差一点到肚皮。
 * 8. 圈心底下也长腿（innerLegs）：外圈每人两条腿以外，往里一圈圈照同样的间隔再排，排到圈心，正中一条（见 innerLegParts）。
 * 9. 腿的朝向（legFacing）：缺省是绕圈朝外（每条腿跟着它所在的那个人转过去，脚尖朝外）；也能统一朝前——腿长在哪不变，
 *    都转到脚尖朝正前（+Z），像一群人朝一个方向走。往外撇还是照样撇（撇的方向是从圈心朝外，不跟着脚尖），见 legQuat。
 *
 * 纯函数，不依赖浏览器。
 */
import { chestBulk, chestLayers, chestReach } from '../anime/chest';
import { castRay, compileField } from '../sdf/field';
import { highest, lowest, pointArm } from './conjoined';
import type { BoneHint, Figure, Graft, Part, PartType, Prim, Ring } from './figure';
import { nthName } from './figure';
import { type Quat, type V3, add, mat3Mul, quatConj, quatMat3, quatMul, rotate, sub } from './vec';

export type Ringed = 'hips' | 'fused';
/** 胸怎么排：stagger 交错成串（每圈一样大）、taper 交错渐小（越往下越小）、aligned 上下对齐（每个人各自的几排） */
export type RingChest = 'stagger' | 'taper' | 'aligned';
/** 胸交错成串时排成了什么样：摆位该照几排胸摆（躯干照它加长），每一圈每个人几只（从上往下），一只胸多宽、多高、鼓出来多高（算不出来是 0） */
export interface ChestPack {
  rows: number;
  per: number[];
  wide: number;
  tall: number;
  deep: number;
}
/** 腿的朝向：out 绕圈朝外、front 统一朝前 */
export type RingLegFacing = 'out' | 'front';
export interface RingOptions {
  mode: Ringed;
  count: number;
  /** 整个身子左右两侧各留几条手臂 */
  armPairs?: number;
  /** 手臂平举（不然往下垂一点） */
  tPose?: boolean;
  /** 多对手臂怎么排：fan 都从一个肩膀上长出来、上下扇开（缺省），stack 沿着一个人的身侧上下排。摆好的那个人要照这种排法摆好这几对 */
  armLayout?: 'stack' | 'fan';
  chest?: RingChest;
  /** 交错成串时每个人一共几只胸（摆好的那个人身上只有够放的那么多排，圈是照着它们排出来的）；不给就是摆好的有几只 */
  breasts?: number;
  /** 交错成串时上一遍排出来的（见 ringBuild 交出来的 chest）：每圈每人几只照它的不再变，胸多宽多高也不用再量。layout.ts 第二遍摆位时给 */
  chestPack?: ChestPack;
  /** 圈心底下也长腿（不然只有外圈每人两条） */
  innerLegs?: boolean;
  /** 圈的松紧：胯那一圈的半径是「所有的腿在圈上隔得一样远」那么大的多少倍，见 spreadOf；不给就是 1 */
  spread?: number;
  /** 腿的朝向：不给就是绕圈朝外 */
  legFacing?: RingLegFacing;
  /** 一个人只有一条腿时，圈的大小照相邻两条腿隔这么远算（平常两条腿的人两条腿隔多远）；两条以上的照摆好的腿量 */
  legGap?: number;
}

/**
 * 圈的松紧（spread）：胯那一圈的半径是「所有的腿在圈上隔得一样远」那么大的多少倍。1 是腿隔得一样远，人和人只在肩膀、胯上挨着，
 * 圈心的芯子粗；小于 1 的圈小、相邻两个人的大腿根并在一起、身子叠得多，芯子跟着细；大于 1 的人和人之间拉开。
 * 头在圈上挤得多紧跟着它走（1 是正好挨着，小于 1 是脸颊挤进去一点，画里几个头都是脸贴着脸的）：圈小到 TIGHT 时是 HEAD_TIGHT，
 * 圈到 1 以上都是正好挨着
 */
const TIGHT = 0.76;
const HEAD_TIGHT = 0.9;
/**
 * 圈比 TIGHT 还小时，腿比平常往外叉开得多（像三脚架）：胯挤在一处，脚还踩在 TIGHT 那么大的圈上，最多多叉 SPLAY_MAX。
 * 不叉开的话：一个人自己的几条腿隔多远是身体定的、不跟着圈变，圈小了相邻两个人挨着的那两条越靠越近，到 50% 正好叠在一处，
 * 素体的腿是先融合、再照权重搬的，叠着的两条一摆姿势就扯出一大片蹼。
 * 试过又退掉的：把腿绕圈等间隔排开（间隔只有平常的一半，大腿整圈连成一个筒，一摆姿势扯成一圈裙子）；
 * 只让腿留在外面的圈上、身子接着往里缩（腿和胯差出一大截，整个离体，腿根连成一圈帽檐一样的台子）；
 * 胯那一圈干脆不缩、改成上半身多往里倾（倾到头了，滑块拉下去几乎看不出变化）；
 * 一个人自己的几条腿跟着并拢（脚挤在一起，接上去的脚互相插着、缝不上，掉成一只只单独的块）
 */
const SPLAY_MAX = 22 * (Math.PI / 180);
/**
 * 圈比 TIGHT 还紧时，整圈的腿一前一后错开（沿离圈心的方向，一条往外挪 STAGGER、下一条往里挪 STAGGER，米）：
 * 相邻两个人挨着的那两条就不在同一个面上，贴着也不会在摆姿势时连成一片蹼（素体的腿是先融合、再照权重搬的）。
 * 挪的这点距离还在自己的胯里（胯前后有二十厘米厚），看上去像站着时一条腿在前、一条在后
 */
const STAGGER = 0.05;
const spreadOf = (spread: number): { radius: number; head: number } => ({
  radius: spread,
  head: Math.max(HEAD_TIGHT, Math.min(1, HEAD_TIGHT + ((spread - TIGHT) / (1 - TIGHT)) * (1 - HEAD_TIGHT))),
});
/** 相邻两根脖子的根隔多远（一根脖子那么粗多一点）：身子往圈心靠到脖子根挨着为止 */
const NECK_GAP = 0.085;
/** 脖子从根上最多往外歪多少（弧度，从竖直算起）；头跟着歪脖子的几成 */
const FAN_MAX = 40 * (Math.PI / 180);
const HEAD_FOLLOW = 0.5;
/** 芯子的粗细沿高度磨平几遍（每遍和上下各一圈平均）：照肚皮量出来的粗细带着肚皮上的小起伏，和肚皮几乎重合，融合出来是一道道横印子 */
const CORE_SMOOTH = 6;
/** 头的半宽大约是头高的多少 */
const HEAD_HALF = 0.4;
/** 最多往圈心靠多少（弧度）：再多脚底就斜得厉害 */
const LEAN_MAX = 16 * (Math.PI / 180);
/** 各有各的胯：芯子粗到后背往前多少（0 是后背，1 是肚皮） */
const CORE_HIPS = 0.35;
/** 并胯融合：芯子比肚皮往里收多少，每个人的肚子在圆桶上只凸出这么一点 */
const CORE_MARGIN = 0.025;
/** 各有各的胯：从肩关节往下这么多起，芯子渐渐粗到和并胯融合的一样（肩膀并成一个圆顶，脖子从圆顶上长出来） */
const CORE_SHOULDER = 0.1;
/** 芯子顶上收成圆顶：离最后一圈多高、半径剩几成 */
const CORE_DOME: [dy: number, k: number][] = [[0.02, 0.93], [0.04, 0.78], [0.06, 0.55], [0.075, 0.25]];
/**
 * 芯子在髋关节以下渐渐收细（keep 是收到几成，drop 是往下这么深收到头）：
 * 以前一直粗到大腿中段（照肚皮量的，整圈那么粗），从下往上看是一个很大的半圆球扣在腿中间。
 * 收细以后底下是一根细锭子，夹在腿当中看不出来；人和人是在胯、肚子那一段连起来的，这里细一点不影响
 */
const CORE_UNDER = { drop: 0.2, keep: 0.24 };
/** 圆肩头：盖住素体躯干上手臂接口那一圈毛边。比肩关节往里、往下挪多少，三个方向各多大，和躯干之间圆角多大 */
const STUMP = { inset: 0.012, drop: 0.03, radii: [0.046, 0.066, 0.056] as V3, soft: 0.02 };
/**
 * 腿统一朝前时垫在胯上接腿的口子里的圆头（只有素体的躯干要）：腿转走以后口子露出一圈毛边。
 * 比髋关节往下挪多少，三个方向各多大（比大腿根小一圈，不鼓出来），和躯干之间圆角多大
 */
const HIP_PLUG = { drop: 0.045, radii: [0.062, 0.095, 0.07] as V3, soft: 0.02 };
/**
 * 肩部扇形聚拢的几条手臂上下扇开：最上面一条比水平高多少（A 字站姿、T 字站姿），往下相邻两条隔多少（最多 step，
 * 条数多了整把一共不超过 span），从上面看相邻两条前后错开多少（举得高的在后、放得低的在前）。只有一条时照 ARM_DROP
 */
const ARM_FAN = {
  top: { A: 15 * (Math.PI / 180), T: 35 * (Math.PI / 180) },
  step: 20 * (Math.PI / 180),
  span: 60 * (Math.PI / 180),
  splay: { A: 0.18, T: 0.3 },
};
/** 手臂从水平往下垂多少（弧度）：A 字站姿、T 字站姿 */
const ARM_DROP = { A: 25 * (Math.PI / 180), T: 0 };
/** 上下排的手臂（A 字站姿）：往下每一条多垂多少、从上面看相邻两条前后错开多少（弧度）。平举时都朝正侧面 */
const ARM_STACK = { drop: 6 * (Math.PI / 180), splay: 0.2 };
/** 交错渐小：往下每一圈是上一圈的多大；圈数多时缩得慢一点，最下面一圈不小于第一圈的 CHEST_SMALLEST */
const CHEST_SHRINK = 0.88;
const CHEST_SMALLEST = 0.45;
/** 胸交错成串：圈和圈的间隔是摆位时相邻两排间隔的多少（错开的两圈互相嵌进去）；交错渐小的再照两圈的大小缩 */
const CHEST_NEST = { stagger: 0.76, taper: 0.86 };
/** 胸交错成串：错开的那一圈，胸根比它坐的那层表面（正中的是这个人的肚皮，交界上的是芯子）再往里沉多少 */
const CHEST_SINK = 0.008;
/** 胸交错成串：有胸的那一段芯子比肚皮只往里收这么多（别处是 CORE_MARGIN）：胸都坐在芯子上，芯子离肚皮近，胸才不比身子矮一截 */
const CHEST_MARGIN = 0.008;
/**
 * 胸交错成串：最下面一圈胸的中心往下 below 起，往上芯子都粗到差一点到肚皮；再往下 ramp 这么长渐渐变回平常的粗细
 * （各有各的胯时是一个往下收的漏斗，不是一圈平台）
 */
const CHEST_ZONE = { below: 0.08, ramp: 0.22 };
/**
 * 胸交错成串照胸的大小排满，不留大空隙：
 * - gap：一圈上相邻两只的间隔最多是胸根直径的这么多倍，再宽就每人多排一只（挤着不要紧，画里就是挤着的）。
 *   胸根那一圈是缓坡，看上去鼓起来的只有中间八九成，所以不到 1；
 * - nest：圈和圈的间隔是「错开的两圈正好挨着」的这么多倍（往里嵌一点）；
 * - min / max：每圈每人最少、最多几只；
 * - squeeze / loose：个数不是每圈只数的整数倍时，每圈多排一只（挤到放得下的这么多倍以内）或者少排一只
 *   （相邻两只的间隔到 gap 的这么多倍以内）能排成整圈的话，就那样排；还不行的话最下面只剩一只的去掉、剩两只以上的那一圈补满；
 * - taperRoom：交错渐小的（每圈只数本来就不一样）最下面剩的不到半圈时，上面的圈每圈最多再挤进这么多倍（挤不进去也是去掉或补满）；
 * - buried：白模的胸是半埋在身子里的椭球，露在外面的那一片是它直径的这么多；
 * - faint：素体的小胸是和平胸混出来的（anime/chest.ts 的 fade），看得出鼓起来的那一片比胸根窄：最平的时候只算这么多
 */
const CHEST_PACK = { gap: 0.88, nest: 0.9, min: 2, max: 8, squeeze: 1.4, loose: 1.1, taperRoom: 1.25, buried: 0.88, faint: 0.4 };
/**
 * 胸交错成串：胸鼓出来不到这么高（米）的不沉那么深。胸根本来沉在肚皮里面 CHEST_MARGIN + CHEST_SINK（一厘米半），
 * 小胸一共才鼓出来一两厘米，照样沉的话只剩一圈小鼓包；照鼓出来多高按比例少沉，最少还沉 CHEST_BURY_LEAST 那么多成（胸根不能浮在肚皮外面）
 */
const CHEST_DEEP = 0.05;
const CHEST_BURY_LEAST = 0.3;
/**
 * 圈心底下的腿排得比外圈紧：相邻两条隔外圈的这么多（外圈一个人自己的两条腿隔多远，是身体定的，底下照它排的话一圈圈稀稀拉拉的，
 * 腿和腿之间露着一条条缝）。大腿根本来就比这个间隔粗，挨着的两条在根部融成一片，往下还是各是各的
 */
const INNER_GAP = 0.68;
/** 本来就挤着、埋在别人身子里的部件（芯子、胸）穿模检查不算：Part.rootFree 给得比整个人还大 */
const EMBEDDED = 10;
/** 复制出来的躯干叫 Torso_B、Torso_C …… */
const LETTERS = 'BCDEFGHIJKLMNOP';
/** 接着往下编号的部件 */
const NUMBERED = /^(Neck|Head|Arm|Chest|Wing|Leg|Penis|Scrotum)_(\d+)(.*)$/;
/** 名字跟着部件编号走的骨骼：阴茎的几节（Penis_02_01）、阴囊（Scrotum_03）。pose/posing.ts、model/adult.ts 都照这个样子认它们 */
const PLACED_BONE = /^(Penis|Scrotum)_(\d+)(_\d+)?$/;

/** 骨骼名 → 底名和第几个（Chest.002 → Chest、1） */
const ordinal = (name: string): [string, number] => {
  const m = /^(.*?)(?:\.(\d{3}))?$/.exec(name)!;
  return [m[1], m[2] ? Number(m[2]) - 1 : 0];
};
const aboutX = (angle: number): Quat => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
const aboutY = (angle: number): Quat => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];

/** 一共 rings 圈时，往下每一圈是上一圈的多大：交错成串的一样大，交错渐小的越往下越小 */
function shrinkOf(rings: number, chest: RingChest): number {
  if (chest !== 'taper') return 1;
  return rings > 2 ? Math.max(CHEST_SHRINK, CHEST_SMALLEST ** (1 / (rings - 1))) : CHEST_SHRINK;
}

/** 交错的两种、一共 rings 圈时，第 r 圈（从 0 起）比第一圈低多少，单位是摆位时相邻两排的间隔 */
function ringDrop(r: number, rings: number, chest: RingChest): number {
  const shrink = shrinkOf(rings, chest);
  const nest = chest === 'taper' ? CHEST_NEST.taper : CHEST_NEST.stagger;
  let drop = 0;
  for (let j = 1; j <= r; j++) drop += ((shrink ** (j - 1) + shrink ** j) / 2) * nest;
  return drop;
}

/**
 * 胸一共 rings 圈时，摆位要照几排胸摆：躯干是照排数加长的，交错的圈比排挨得紧（交错渐小的还越往下越小），
 * 十圈只占六七排的高度。照圈数摆的话胸底下会露出长长一截光肚子。上下对齐的就是圈数
 */
export function ringRows(rings: number, chest: RingChest): number {
  if (chest === 'aligned' || rings < 2) return rings;
  return Math.min(rings, 1 + Math.max(1, Math.round(ringDrop(rings - 1, rings, chest))));
}

/** 圈上第几个人算哪一类融合：相邻两个不一样（单数个人时最后一个另算一类） */
function classOf(k: number, count: number): PartType {
  if (count % 2 && k === count - 1) return 'neck';
  return k % 2 ? 'leg' : 'torso';
}

/**
 * 腿整条往圈心那边斜了（脚往外撇）以后，脚在脚踝上转回去、脚底还是平的：q 是在腿自己的坐标里把斜的那一下转回去的旋转。
 * 脚踝往下的都绕脚踝转：接上去的脚（二次元素体），腿末端接的手（手脚互换：现成的手，或者白模自己拼的手），
 * 脚、脚趾、手指的骨骼，白模的脚（腿上的几个椭球、圆台）。只返回改了的几项
 */
/** 腿上不跟着脚转的：大腿、小腿的骨骼和形状 */
const SHANK_BONE = /^(UpperLeg|LowerLeg)/;
const SHANK_PRIM = /^(Thigh|Shin|Calf)/;
function flatFoot(leg: Part, q: Quat): Partial<Pick<Part, 'grafts' | 'bones' | 'prims'>> {
  const ankle = leg.bones?.find((b) => /^Foot/.test(b.name))?.head;
  if (!ankle || Math.abs(q[3]) > 1 - 1e-9) return {};
  const m = quatMat3(q);
  const about = (at: V3): V3 => add(ankle, rotate(q, sub(at, ankle)));
  return {
    ...(leg.grafts
      ? { grafts: leg.grafts.map((g): Graft => (g.mesh === 'foot' || g.mesh === 'palm' ? { ...g, matrix: mat3Mul(m, g.matrix) as Graft['matrix'], offset: about(g.offset) } : g)) }
      : {}),
    ...(leg.bones ? { bones: leg.bones.map((b) => (SHANK_BONE.test(b.name) ? b : { ...b, head: about(b.head), tail: about(b.tail) })) } : {}),
    prims: leg.prims.map((prim) => {
      if (SHANK_PRIM.test(prim.name)) return prim;
      if (prim.kind === 'ellipsoid') return { ...prim, center: about(prim.center), quat: quatMul(q, prim.quat ?? [0, 0, 0, 1]) };
      if (prim.kind === 'cone') return { ...prim, a: about(prim.a), b: about(prim.b) };
      return prim;
    }),
  };
}

/** 把摆好的一个人（一个上半身、两条人腿、一对手臂）改成围成一圈的 count 个人 */
export function ringFigure(figure: Figure, options: RingOptions): Figure {
  return ringBuild(figure, options).figure;
}

/**
 * 同 ringFigure，另外交出胸交错成串时实际排成了什么样（不交错就是 null）。layout.ts 照它再摆一遍
 */
export function ringBuild(
  figure: Figure,
  { mode, count, armPairs = 0, tPose = false, armLayout = 'fan', chest = 'aligned', breasts: asked, chestPack, innerLegs = false, spread = 1, legFacing = 'out', legGap }: RingOptions,
): { figure: Figure; chest: ChestPack | null } {
  const loose = spreadOf(spread);
  const torso = figure.parts.find((p) => p.name === 'Torso');
  const legs = figure.parts.filter((p) => p.type === 'leg' && !p.parent);
  if (!torso || !legs.length || count < 2) return { figure, chest: null };
  // 手臂从复制的那一份里拿掉（连同挂在它上面的），后面只给左右两侧的肩膀装回去
  const arms = figure.parts.filter((p) => p.type === 'arm' && p.parent === 'Torso' && p.side !== 0);
  const gone = new Set(figure.parts.filter((p) => p.type === 'arm').map((p) => p.name));
  for (const p of figure.parts) if (p.parent && gone.has(p.parent)) gone.add(p.name);
  const sampled = torso.prims.some((p) => p.kind === 'grid');
  const shoulderY = arms.length ? Math.max(...arms.map((p) => p.pos[1])) : null;
  const plain = figure.parts.filter((p) => !gone.has(p.name));

  /* ---- 圈多大、往圈心靠多少 ---- */
  const hipY = legs.reduce((sum, p) => sum + p.pos[1], 0) / legs.length;
  // 所有的腿在圈上隔得一样远：一个人的几条腿并排着、相邻两条隔 gap，这个人占圈上 1 / count。腿多了圈跟着大，少了跟着小
  // （两条腿时就是以前的「两条腿各离正中 half，半径 half / sin(π / 2N)」）。
  // 一个人只有一条腿时胯还是平常那么宽，圈照两条腿的算（照一条算的话几个人的大腿根全叠在圈心，一摆姿势腿和腿之间扯出一大片蹼）
  const across = legs.map((p) => p.pos[0]).sort((a, b) => a - b);
  const wide = Math.max(0.1, legs.length > 1 ? (across[across.length - 1] - across[0]) / (legs.length - 1) : (legGap ?? 0.1));
  /** 相邻两条腿隔多远（圈心底下的腿照它排） */
  const gap = wide;
  const radius = (loose.radius * Math.max(2, legs.length) * wide) / 4 / Math.sin(Math.PI / (2 * count));
  const heads = plain.filter((p) => p.type === 'head' && p.parent === 'Torso');
  const stems = plain.filter((p) => p.type === 'neck' && p.parent === 'Torso');
  const headHeight = figure.metrics.headHeight / figure.scale;
  const headY = torso.pos[1] + (heads.length ? heads.reduce((sum, p) => sum + p.pos[1], 0) / heads.length : hipY + 0.7) + headHeight * 0.4;
  const headRadius = (loose.head * HEAD_HALF * headHeight * Math.max(1, heads.length)) / Math.sin(Math.PI / count);
  // 一个人一个头的：身子靠到脖子根在圈心挨着，脖子再往外歪到头在圈上挨着（见 fan）。一个人好几个头的还照头挤不挤定
  const single = heads.length === 1 && stems.length === 1 ? { neck: stems[0], head: heads[0] } : null;
  const neckY = single ? torso.pos[1] + single.neck.pos[1] : 0;
  const neckZ = single ? torso.pos[2] + single.neck.pos[2] : 0;
  /** 圈的半径是 r 时身子往圈心倾多少（倾到几根脖子的根在圈心挨着为止，最多 LEAN_MAX） */
  const leanAt = (r: number) =>
    Math.asin(
      Math.max(
        0,
        Math.min(
          Math.sin(LEAN_MAX),
          single ? (r + neckZ - NECK_GAP / (2 * Math.sin(Math.PI / count))) / Math.max(0.2, neckY - hipY) : (r - headRadius) / Math.max(0.2, headY - hipY),
        ),
      ),
    );
  const lean = leanAt(radius);
  /** 脖子从竖直往外歪多少：脖子根（身子靠过去以后）离圈心 from，头的中心要到 headRadius */
  let fan = 0;
  if (single) {
    const from = radius + neckZ * Math.cos(lean) - (neckY - hipY) * Math.sin(lean);
    const reach = Math.hypot(single.head.pos[0] - single.neck.pos[0], single.head.pos[1] - single.neck.pos[1], single.head.pos[2] - single.neck.pos[2]);
    const out = (a: number) => reach * Math.sin(a) + HEAD_HALF * headHeight * Math.sin(a * HEAD_FOLLOW);
    const need = headRadius - from;
    if (need > 0) {
      let lo = 0;
      let hi = FAN_MAX;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (out(mid) < need) lo = mid;
        else hi = mid;
      }
      fan = hi;
    }
  }
  // 身子是往圈心靠的：脖子、头相对身子要多转回 lean 才是从竖直算起的
  const base =
    single && fan > 0
      ? plain.map((p) => {
          if (p === single.neck) return { ...p, quat: quatMul(aboutX(fan + lean), p.quat) };
          if (p === single.head) {
            return {
              ...p,
              pos: add(single.neck.pos, rotate(aboutX(fan + lean), sub(p.pos, single.neck.pos))),
              quat: quatMul(aboutX(fan * HEAD_FOLLOW + lean), p.quat),
            };
          }
          return p;
        })
      : plain;
  const pivot: V3 = [0, hipY, 0];
  const leanQ = aboutX(-lean);
  /**
   * 腿跟着身子一起斜，圈比 TIGHT 还紧的再往外多叉开一点（见 SPLAY_MAX）：胯挤在一处，脚还踩在 TIGHT 那么大的圈上。
   * 脚在脚踝上照这个角度转平
   */
  // 多叉开多少：叉到脚踩在 TIGHT 那么大的圈上（那时身子也倾得多，一起算进去），最多多叉 SPLAY_MAX
  const roomy = spread < TIGHT ? (radius * TIGHT) / Math.max(0.01, spread) : radius;
  const splay =
    spread < TIGHT
      ? Math.max(0, Math.min(SPLAY_MAX, Math.asin(Math.max(0, Math.min(0.99, Math.sin(leanAt(roomy)) + (roomy - radius) / Math.max(0.2, hipY)))) - lean))
      : 0;
  const legLean = lean + splay;
  /** 整圈的腿一前一后错开多少（见 STAGGER）：圈越紧错得越多 */
  const zigzag = spread < TIGHT ? STAGGER * Math.min(1, (TIGHT - spread) / (TIGHT - 0.5)) : 0;
  /** 这个人身上的腿从圈上第几条数起（整圈挨着数，一条往外、一条往里） */
  const legOrder = new Map([...legs].sort((p, q) => p.pos[0] - q.pos[0]).map((p, i) => [p.name, i]));
  /** 一个人自己的坐标 → 圈上第 k 个人的位置 */
  const place = (p: V3, k: number): V3 => rotate(aboutY((k * 2 * Math.PI) / count), add(add(rotate(leanQ, sub(p, pivot)), pivot), [0, 0, radius]));
  const turn = (k: number): Quat => quatMul(aboutY((k * 2 * Math.PI) / count), leanQ);
  const front = legFacing === 'front';
  /**
   * 长在圈上 at 这个方向（从上面看，弧度）的一条腿在世界里怎么转：往外撇（leaned，正中那条不撇）都是朝着从圈心往外的方向撇；
   * 绕圈朝外的再绕竖轴转到脚尖朝外，统一朝前的不转（脚尖还朝 +Z）
   */
  const legQuat = (at: number, tilt = legLean): Quat => {
    const tilted = quatMul(aboutY(at), aboutX(-tilt));
    return front ? quatMul(tilted, aboutY(-at)) : tilted;
  };
  /**
   * 这条腿的脚在脚踝上怎么转回去（腿自己的坐标里）：见 flatFoot。只转回身子斜的那一下（lean），
   * 多叉开的那一下（splay）不转回来——脚踝上转得太多的话，接上去的脚那一圈就离开小腿、缝不上，掉成单独一块。
   * 脚底跟着往外歪 splay，踩在地上像一只只八字脚，比腿之间扯出蹼好得多
   */
  const footBack = (leg: Part, at: number, tilt = lean): Quat =>
    front ? quatMul(quatMul(quatConj(leg.quat), quatMul(quatMul(aboutY(at), aboutX(tilt)), aboutY(-at))), leg.quat) : aboutX(tilt);

  /* ---- 复制：部件、骨骼接着往下编号 ---- */
  const last = new Map<string, number>();
  for (const p of base) {
    const m = NUMBERED.exec(p.name);
    if (m) last.set(m[1], Math.max(last.get(m[1]) ?? 0, Number(m[2])));
  }
  const boneCount = new Map<string, number>();
  for (const p of base) for (const b of p.bones ?? []) {
    const [base] = ordinal(b.name);
    boneCount.set(base, (boneCount.get(base) ?? 0) + 1);
  }
  const partName = (name: string, k: number): string => {
    if (!k) return name;
    if (name === 'Torso') return `Torso_${LETTERS[k - 1]}`;
    const m = NUMBERED.exec(name);
    if (!m) return `${name}_${LETTERS[k - 1]}`;
    // 头上长的（眼睛、角、耳朵）跟着头的号：Head_01_Eye_01_L → Head_03_Eye_01_L
    return `${m[1]}_${String(Number(m[2]) + (last.get(m[1]) ?? 0) * k).padStart(2, '0')}${m[3]}`;
  };
  const boneName = (name: string, k: number): string => {
    if (!k || name === 'Hips') return name;
    // 阴茎、阴囊的骨骼跟着部件的号（Penis_01_02 → Penis_03_02）
    const placed = PLACED_BONE.exec(name);
    if (placed) return `${placed[1]}_${String(Number(placed[2]) + (last.get(placed[1]) ?? 0) * k).padStart(2, '0')}${placed[3] ?? ''}`;
    const [base, index] = ordinal(name);
    return nthName(base, (boneCount.get(base) ?? 0) * k + index);
  };
  // Hips 只留一根，挪到圈心（各人的脊柱、腿都接在它上面）。有芯子的话放在芯子里：芯子跟着胯，不跟着哪一个人的脊柱；
  // 没有芯子就留在第一个人的躯干里，下面是它在躯干自己的坐标里的位置
  const hips = torso.bones?.find((b) => b.name === 'Hips');
  const center = rotate(quatConj(torso.quat), sub(add(rotate(quatConj(leanQ), sub([0, hipY, -radius], pivot)), pivot), torso.pos));
  let hipsInCore = false;

  /* ---- 哪几个肩膀留手臂：从上面看离正左（+X）最近的几个，右边照镜像取 ---- */
  // 摆好的那个人身上有好几对手臂（上下排的从肩膀往下排，肩部扇形聚拢的挤在肩膀上），都留在离正左最近的那一个肩膀所在的人身上
  const stacked = armLayout === 'stack';
  /** 长在本来的肩膀上的那一对（躯干上接手臂的口子在那里）：上下排的是第一对，肩部扇形聚拢的是最后一对 */
  const nativePair = stacked ? 1 : Math.max(1, arms.length / 2);
  const native = (arm: Part) => Number(/^Arm_(\d+)_/.exec(arm.name)?.[1]) === nativePair;
  const azimuth = (arm: Part, k: number) => {
    const at = place(add(torso.pos, rotate(torso.quat, arm.pos)), k);
    return Math.atan2(at[0], at[2]);
  };
  /** 一个肩膀从上面看离正左有多远（弧度，量到万分之一），左手形状的算近一点点 */
  const near = (spot: { arm: Part; at: number }) => Math.round(Math.abs(spot.at - Math.PI / 2) * 1e4) - (spot.arm.side > 0 ? 0.5 : 0);
  const twinOf = (arm: Part) => arms.find((q) => q !== arm && q.side === -arm.side && q.name.replace(/_[LR]$/, '') === arm.name.replace(/_[LR]$/, ''));
  const left = Array.from({ length: count }, (_, k) => arms.map((arm) => ({ k, arm, at: azimuth(arm, k) })))
    .flat()
    .filter((s) => Math.sin(s.at) > 1e-6 && twinOf(s.arm) && native(s.arm))
    // 一样近的（六个人时相邻两个人挨着的一左一右）先留左手形状的那条：整个身子左边的第一条是左手、右边的第一条是右手
    .sort((a, b) => near(a) - near(b) || a.at - b.at)
    .slice(0, Math.max(0, Math.min(1, armPairs)));
  /** 留下的手臂：「第几个人:哪条」→ 第几对（从 0 起）、朝哪（世界里） */
  const kept = new Map<string, { rank: number; dir: V3 }>();
  const drop = tPose ? ARM_DROP.T : ARM_DROP.A;
  const aim = (az: number, down: number): V3 => [Math.sin(az) * Math.cos(down), -Math.sin(down), Math.cos(az) * Math.cos(down)];
  const keep = (k: number, arm: Part, rank: number, dir: V3) => {
    kept.set(`${k}:${arm.name}`, { rank, dir });
    kept.set(`${(count - k) % count}:${twinOf(arm)!.name}`, { rank, dir: [-dir[0], dir[1], dir[2]] });
  };
  if (left.length) {
    // 那个人这一边的几条手臂都留着，朝正侧面
    const host = left[0];
    const column = arms
      .filter((arm) => arm.side === host.arm.side && twinOf(arm))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, armPairs);
    const n = column.length;
    column.forEach((arm, i) => {
      const mid = i - (n - 1) / 2;
      if (n < 2) keep(host.k, arm, i, aim(Math.PI / 2, drop));
      // 上下排：往下垂的时候下面的多垂一点、前后稍微错开；平举时都朝正侧面
      else if (stacked) keep(host.k, arm, i, tPose ? aim(Math.PI / 2, 0) : aim(Math.PI / 2 - mid * ARM_STACK.splay, drop + i * ARM_STACK.drop));
      // 肩部扇形聚拢：上下扇开，举得高的在后、放得低的在前
      else {
        const up = (tPose ? ARM_FAN.top.T : ARM_FAN.top.A) - i * Math.min(ARM_FAN.step, ARM_FAN.span / (n - 1));
        keep(host.k, arm, i, aim(Math.PI / 2 - mid * (tPose ? ARM_FAN.splay.T : ARM_FAN.splay.A), -up));
      }
    });
  }
  /** 第 k 个人身上留下的手臂：改名（Arm_02_L、UpperArm_L.002 照第几对编）、朝外摆 */
  const armsOf = (k: number): Part[] =>
    arms.flatMap((arm): Part[] => {
      const keep = kept.get(`${k}:${arm.name}`);
      if (!keep) return [];
      const mine = new Set((arm.bones ?? []).map((b) => b.name));
      const rename = (name: string) => (mine.has(name) ? nthName(ordinal(name)[0], keep.rank) : boneName(name, k));
      const { bind: _bind, ...rest } = arm;
      const local = rotate(quatConj(quatMul(turn(k), torso.quat)), keep.dir);
      return [
        pointArm(
          {
            ...rest,
            name: `Arm_${String(keep.rank + 1).padStart(2, '0')}_${arm.side < 0 ? 'R' : 'L'}`,
            parent: partName('Torso', k),
            ...(arm.bones ? { bones: arm.bones.map((b) => ({ ...b, name: rename(b.name), ...(b.parent ? { parent: rename(b.parent) } : {}) })) } : {}),
            ...(arm.grafts ? { grafts: arm.grafts.map((g) => ({ ...g, bones: Object.fromEntries(Object.entries(g.bones).map(([key, v]) => [key, rename(v)])), rigid: g.rigid.map(rename) })) } : {}),
          },
          local,
        ),
      ];
    });
  /** 第 k 个人没留手臂的肩膀上垫的圆肩头（只有素体的躯干要） */
  const stumpsOf = (k: number): Prim[] =>
    sampled
      ? arms
          // 只有本来的肩膀上有接手臂的口子；别的几对是贴在身侧、挤在肩膀后面的，没留的不用垫
          .filter((arm) => native(arm) && !kept.has(`${k}:${arm.name}`))
          .map((arm) => ({ kind: 'ellipsoid', name: `Stump_${arm.side < 0 ? 'R' : 'L'}`, center: [arm.pos[0] - Math.sign(arm.pos[0]) * STUMP.inset, arm.pos[1] - STUMP.drop, arm.pos[2]], radii: STUMP.radii, soft: STUMP.soft }))
      : [];

  /** 腿统一朝前时，第 k 个人胯上接腿的口子里垫的圆头（第一个人的腿没转，不用） */
  const plugsOf = (k: number): Prim[] =>
    sampled && front && k > 0
      ? legs.map((leg, i) => {
          const at = rotate(quatConj(torso.quat), sub(leg.pos, torso.pos));
          return { kind: 'ellipsoid', name: `Plug_${i + 1}`, center: [at[0], at[1] - HIP_PLUG.drop, at[2]], radii: HIP_PLUG.radii, soft: HIP_PLUG.soft };
        })
      : [];

  /* ---- 胸交错成串：每一圈多大、往上挪多少、隔一圈的绕圈心转多少 ---- */
  // 圈心那根竖轴在一个人躯干自己的坐标里：过哪一点、朝哪
  const back = quatConj(torso.quat);
  const axisAt = rotate(back, sub(add(rotate(quatConj(leanQ), [0, 0, -radius]), pivot), torso.pos));
  const axisUp = rotate(back, rotate(quatConj(leanQ), [0, 1, 0]));
  const rowOf = (p: Part) => Number(/^Chest_(\d+)/.exec(p.name)?.[1] ?? 1) - 1;
  const breasts = base.filter((p) => p.type === 'chest' && p.parent === 'Torso');
  const rowY: number[] = [];
  for (const p of breasts) rowY[rowOf(p)] = p.pos[1];
  /** 每个人一共几只 */
  const total = Math.max(0, Math.round(asked ?? breasts.length));
  // 每个人只有一两只时没有要错开的：照平常的摆，芯子也不用加粗
  const stagger = chest !== 'aligned' && total > 2 && breasts.length > 0;
  const pitch = rowY.length > 1 ? rowY[0] - rowY[1] : 0;
  const probe = compileField({ scale: 1, parts: [torso, ...legs] }, { blend: 0 });
  const FAR = 0.8;
  /** 一个人自己的坐标里，(x, y) 那里从正前方看过去表面在多靠前；没有东西就是 null */
  const frontOf = (field: typeof probe, x: number, y: number): number | null => {
    const t = castRay(field, [x, y, FAR], [0, 0, -1], 2 * FAR);
    return t < 2 * FAR ? FAR - t : null;
  };
  /**
   * 一只胸鼓出来的那一片多宽、多高、鼓出来多高（摆好的第一排的一只）。照胸的形状直接算：素体的是胸根那一圈的直径、
   * 从中心往上往下各伸多远、胸尖离平胸多远（anime/chest.ts 的 chestBulk、chestReach，再乘手动微调的缩放；小胸再照 CHEST_PACK.faint 收窄），
   * 白模的是那个椭球露在外面的那一截（CHEST_PACK.buried）。
   * 不对着带胸的距离场量：素体的胸一求值就要先烤一遍（几十到两百毫秒），拖滑块时摆位会卡
   */
  const footprint = (): { wide: number; tall: number; deep: number } => {
    const sample = breasts.find((p) => rowOf(p) === 0) ?? breasts[0];
    for (const prim of sample.prims) {
      if (prim.kind === 'chest') {
        const [up, down] = chestReach(prim.size);
        const bulk = chestBulk(prim.size);
        const seen = CHEST_PACK.faint + (1 - CHEST_PACK.faint) * Math.max(0, Math.min(1, chestLayers(prim.size).fade));
        return { wide: 2 * bulk.radius * seen * (prim.scale?.[0] ?? 1), tall: (up + down) * seen * (prim.scale?.[1] ?? 1), deep: bulk.depth * (prim.scale?.[2] ?? 1) };
      }
      if (prim.kind === 'ellipsoid') {
        const s = sample.scale ?? 1;
        return { wide: 2 * prim.radii[0] * s * CHEST_PACK.buried, tall: 2 * prim.radii[1] * s * CHEST_PACK.buried, deep: prim.radii[2] * s };
      }
    }
    return { wide: 0, tall: 0, deep: 0 };
  };
  let foot = { wide: 0, tall: 0, deep: 0 };
  /** 一圈怎么排：比第一圈低多少、每个人几只（在这个人占的那一段里等间隔，隔一圈错开半个）、是第一圈的多大 */
  type Circle = { drop: number; per: number; size: number };
  /**
   * 交错成串时每一圈怎么排（从上往下）。照胸的大小排满（见 CHEST_PACK）：
   * - 一只胸多宽、多高见 footprint；
   * - 每圈每人几只：胸坐的地方绕圈心一周除以人数是每个人占的弧长，放得下几只就排几只（至少两只）。交错成串的各圈都排一样多
   *   （照中间那一圈的弧长算：上面的圈身子往圈心靠、周长小一点，挤一点），整张网对得齐；交错渐小的各圈照自己的大小、弧长算；
   * - 每个人的个数不是每圈只数的整数倍：每圈多排一只、少排一只能排成整圈的就那样排（CHEST_PACK.squeeze / loose）；
   *   不行的话最下面不满的那一圈：只剩一只的去掉（不然每个人底下挂着孤零零的一只），剩两只以上的补满
   *   （不补的话那一圈在人和人交界的地方空着一个个缺口）。所以每个人实际的只数可能比设的少一只、或者多几只；
   * - 圈和圈的间隔：错开的两圈正好嵌进去那么多（一圈上挤得紧的，上下就松一点），不超过原来照摆位的排距定的间隔。
   * 胸多大算不出来（没有胸）就还是每圈每人两只、照排距排
   */
  const packChest = (): Circle[] => {
    foot = chestPack ? { wide: chestPack.wide, tall: chestPack.tall, deep: chestPack.deep } : footprint();
    const wide = { size: foot.wide };
    const tall = { size: foot.tall };
    const known = wide.size > 0.01 && tall.size > 0.01;
    /** 那个高度（比第一圈低 drop）上胸坐的地方离圈心多远：有胸的那一段芯子粗到差一点到肚皮 */
    const seat = (drop: number) => {
      const y = torso.pos[1] + rowY[0] - drop;
      const z = Math.max(frontOf(probe, 0, y) ?? -Infinity, frontOf(probe, 0.03, y) ?? -Infinity);
      return Number.isFinite(z) ? Math.max(0.03, place([0, y, z], 0)[2] - CHEST_MARGIN - CHEST_SINK) : radius;
    };
    const nest = chest === 'taper' ? CHEST_NEST.taper : CHEST_NEST.stagger;
    const clampPer = (n: number) => Math.max(CHEST_PACK.min, Math.min(CHEST_PACK.max, n));
    /** 那个高度上每个人占的那一段放得下几只（不取整） */
    const wantAt = (drop: number, size: number) => (known ? (2 * Math.PI * seat(drop)) / count / (wide.size * size * CHEST_PACK.gap) : CHEST_PACK.min);
    /** 上一圈相邻两只隔 apart、两圈平均是第一圈的 mean 那么大：下一圈比它低多少 */
    const stepDown = (apart: number, mean: number) => {
      const loose = mean * nest * pitch;
      // 错开的两圈正好挨着：照胸宽是直径的圆算，再照胸的高宽比压扁
      const w = wide.size * mean;
      const tight = known ? CHEST_PACK.nest * (tall.size / wide.size) * Math.sqrt(Math.max(w * w * 0.25, w * w - apart * apart * 0.25)) : loose;
      return pitch > 0 ? Math.min(loose, tight) : tight;
    };
    type Laid = { drop: number; per: number; size: number; fit: number };
    /** 从上往下一圈圈排：给了 fixed 就照它每圈几只，不给就每圈放得下几只排几只 */
    const lay = (fixed?: number[]): Laid[] => {
      let plan: Laid[] = [];
      // 交错渐小的每圈缩多少要看一共几圈，圈数又要排了才知道：来回两三遍就不变了
      let guess = fixed?.length ?? Math.ceil(total / 2);
      for (let round = 0; round < 3; round++) {
        const shrink = shrinkOf(guess, chest);
        plan = [];
        let left = fixed ? fixed.reduce((sum, n) => sum + n, 0) : total;
        let drop = 0;
        /** 上一圈相邻两只隔多远 */
        let apart = 0;
        for (let r = 0; left > 0 && r < 40; r++) {
          const size = shrink ** r;
          if (r > 0) drop += stepDown(apart, (shrink ** (r - 1) + size) / 2);
          const fit = clampPer(Math.ceil(wantAt(drop, size) - 1e-6));
          const per = Math.min(left, fixed?.[r] ?? fit);
          if (per < 1) break;
          plan.push({ drop, per, size, fit });
          apart = (2 * Math.PI * seat(drop)) / count / Math.max(per, fixed ? fixed[0] : per);
          left -= per;
        }
        if (plan.length === guess) break;
        guess = plan.length;
      }
      return plan;
    };
    /** 交错成串：各圈都排一样多，每圈几只 */
    const evenPer = (): number[] => {
      let want = wantAt(0, 1);
      let m = Math.min(total, clampPer(Math.ceil(want - 1e-6)));
      // 照中间那一圈的弧长算：圈数要先知道每圈几只，来回两遍
      for (let round = 0; round < 2; round++) {
        const rings = Math.ceil(total / m);
        const low = (rings - 1) * stepDown((2 * Math.PI * seat(0)) / count / m, 1);
        want = wantAt(low / 2, 1);
        m = Math.min(total, clampPer(Math.ceil(want - 1e-6)));
      }
      // 排不成整圈：多排一只、少排一只能排成整圈的就那样排
      if (total % m) {
        if (m < CHEST_PACK.max && total % (m + 1) === 0 && m + 1 <= want * CHEST_PACK.squeeze) m += 1;
        else if (m > CHEST_PACK.min && total % (m - 1) === 0 && want <= (m - 1) * CHEST_PACK.loose) m -= 1;
      }
      // 还排不成整圈：最下面只剩一只的去掉，剩两只以上的那一圈补满
      const whole = Math.floor(total / m);
      return Array.from({ length: Math.max(1, whole + (total % m >= 2 ? 1 : 0)) }, () => m);
    };
    /** 交错渐小：各圈照自己的大小排；最下面剩的不到半圈、上面的圈多挤一点放得下的并进去 */
    const taperPer = (): number[] => {
      const plan = lay();
      const last = plan[plan.length - 1];
      if (plan.length > 1 && last.per * 2 <= last.fit) {
        const per = plan.slice(0, -1).map((ring) => ring.per);
        const room = plan.slice(0, -1).map((ring) => Math.floor(ring.fit * CHEST_PACK.taperRoom));
        let extra = last.per;
        for (let moved = true; extra > 0 && moved; ) {
          moved = false;
          for (let r = per.length - 1; r >= 0 && extra > 0; r--) {
            if (per[r] < room[r]) {
              per[r]++;
              extra--;
              moved = true;
            }
          }
        }
        if (extra === 0) return per;
      }
      // 并不进去：最下面只剩一只的去掉，剩两只以上的那一圈补满（只有一圈的照数等间隔排）
      if (plan.length > 1 && last.per === 1 && last.fit > 1) return plan.slice(0, -1).map((ring) => ring.per);
      return plan.map((ring, r) => (r > 0 && r === plan.length - 1 ? Math.max(ring.per, ring.fit) : ring.per));
    };
    const per = chestPack?.per ?? (chest === 'taper' ? taperPer() : evenPer());
    return lay(per).map((ring) => ({ drop: ring.drop, per: ring.per, size: ring.size }));
  };
  const packed = stagger ? packChest() : [];
  /** 交错成串时一共几圈；每一圈比第一圈低多少（躯干自己的单位） */
  const circles = stagger ? packed.length : rowY.length;
  const drops = stagger ? packed.map((ring) => ring.drop) : Array.from({ length: circles }, (_, r) => ringDrop(r, circles, chest) * pitch);
  /** 第 r 圈照摆好的哪一排做（离它最近的那一排）、比那一排再往上挪多少（负的是往下） */
  const hosts = drops.map((drop) => {
    let host = 0;
    for (let i = 1; i < rowY.length; i++) if (Math.abs(rowY[0] - rowY[i] - drop) < Math.abs(rowY[0] - rowY[host] - drop)) host = i;
    return host;
  });
  const lift = drops.map((drop, r) => rowY[0] - rowY[hosts[r]] - drop);
  /** 有胸的那一段从哪个高度往上（躯干自己的坐标）；不交错就没有 */
  const chestFrom = stagger ? rowY[0] - drops[circles - 1] - CHEST_ZONE.below : null;
  /** 量芯子时顺带记下的：各个高度（落地以前）上肚皮、芯子各离圈心多远 */
  const measured: { y: number; front: number; core: number }[] = [];
  const levelAt = (y: number) => {
    if (!measured.length) return null;
    let i = 1;
    while (i < measured.length - 1 && measured[i].y < y) i++;
    const a = measured[Math.max(0, i - 1)];
    const b = measured[Math.min(measured.length - 1, i)];
    const t = b.y > a.y ? Math.max(0, Math.min(1, (y - a.y) / (b.y - a.y))) : 0;
    return { front: a.front + (b.front - a.front) * t, core: a.core + (b.core - a.core) * t };
  };
  /**
   * 交错成串时第 r 圈的一只胸怎么摆（p 是摆好的那一排里的一只，target 是它从上面看在这个人正前方偏多少）。整圈一个规矩，排成一张错开的网：
   * - 每圈每人几只见 packChest，绕圈心等间隔，隔一圈错开半个（每人两只时：没错开的圈在这个人正前方左右各四分之一个人的角度上，
   *   错开的圈一只在正中、一只在和旁边那个人的交界上）；
   * - 都转到脸朝正外（长在身上时胸口的皮是朝两边撇的，照原样的话每个人的两只各朝各的，一圈高高低低）；
   * - 都坐在芯子上、再往圈心沉一点（CHEST_SINK），挂在芯子上跟着胯；有胸的那一段芯子粗到差一点到肚皮（CHEST_MARGIN）。
   * 二次元素体的胸是连着底下一片皮的一块，整只转过去的话那片皮带不过去（它的弧度是照胸口偏一边的肋骨取的，和芯子、和别处的皮都对不齐，
   * 露出一圈方印子），所以用只取胸、不带皮的那一块（ChestShape.piece），和芯子算同一类、直接取并集：胸根那一圈本来就是缓缓抬起来的，
   * 不用圆角；算成别的类的话，胸根和芯子几乎重合的那一片之间出圆角，整片顶起来像一块盾牌。缩小、沿圈心上下挪用 ChestShape.scale / shift。
   * 白模的胸是一个椭球，整只挪、转
   */
  const strung = (p: Part, r: number, target: number): Part => {
    const size = packed[r].size;
    const shaped = p.prims.some((q) => q.kind === 'chest');
    // 这只胸现在从上面看偏在这个人正前方的哪一边、偏多少
    const own = add(torso.pos, rotate(torso.quat, p.pos));
    const at = place(own, 0);
    const now = Math.atan2(at[0], at[2]);
    const about = (angle: number): Quat => [axisUp[0] * Math.sin(angle / 2), axisUp[1] * Math.sin(angle / 2), axisUp[2] * Math.sin(angle / 2), Math.cos(angle / 2)];
    /** 沿着离圈心的方向挪 by（负的是往圈心沉） */
    const outward = (from: V3, by: number): V3 => {
      const out = sub(from, axisAt);
      const along = out[0] * axisUp[0] + out[1] * axisUp[1] + out[2] * axisUp[2];
      const flat: V3 = [out[0] - axisUp[0] * along, out[1] - axisUp[1] * along, out[2] - axisUp[2] * along];
      const far = Math.hypot(flat[0], flat[1], flat[2]) || 1;
      return [from[0] + (flat[0] / far) * by, from[1] + (flat[1] / far) * by, from[2] + (flat[2] / far) * by];
    };
    // 这一圈的高度上，胸底下那一点的躯干表面：朝哪边偏、离圈心多远
    const y = own[1] + lift[r];
    const surface = (x: number) => {
      const t = castRay(probe, [x, y, FAR], [0, 0, -1], 2 * FAR);
      return t < 2 * FAR ? FAR - t : own[2];
    };
    const under = place([own[0], y, shaped ? surface(own[0]) : own[2]], 0);
    const far = Math.hypot(under[0], under[2]);
    const level = levelAt(under[1]);
    // 小胸少沉一点（见 CHEST_DEEP）：鼓出来够高的沉在芯子里面 CHEST_SINK，最平的胸根差不多到肚皮
    const bury = foot.deep > 0 ? Math.max(CHEST_BURY_LEAST, Math.min(1, (foot.deep * size) / CHEST_DEEP)) : 1;
    const seat = (level ? level.core : far - CORE_MARGIN) + CHEST_MARGIN - (CHEST_MARGIN + CHEST_SINK) * bury;
    if (!shaped) {
      const lifted = add(p.pos, [axisUp[0] * lift[r], axisUp[1] * lift[r], axisUp[2] * lift[r]]);
      return { ...p, pos: outward(add(axisAt, rotate(about(target - now), sub(lifted, axisAt))), seat - far), quat: quatMul(about(target - now), p.quat), scale: (p.scale ?? 1) * size };
    }
    // 胸口那里的皮本来朝外偏着（facing）：转到脸朝正外
    const facing = Math.atan2(surface(own[0] - 0.02) - surface(own[0] + 0.02), 0.04);
    return {
      ...p,
      pos: outward(add(axisAt, rotate(about(target - now), sub(p.pos, axisAt))), seat - far),
      quat: quatMul(about(target - facing), p.quat),
      fuseAs: 'lower',
      prims: p.prims.map((q) =>
        q.kind === 'chest'
          ? {
              ...q,
              piece: true,
              scale: [(q.scale?.[0] ?? 1) * size, (q.scale?.[1] ?? 1) * size, (q.scale?.[2] ?? 1) * size] as V3,
              shift: [q.shift?.[0] ?? 0, (q.shift?.[1] ?? 0) + lift[r], q.shift?.[2] ?? 0] as V3,
            }
          : q,
      ),
    };
  };
  /** 交错成串时一个人身上的部件：胸换成一圈一圈排好的（Chest_01 是第一圈） */
  let strungParts: Part[] | null = null;
  /** 坐在芯子上的胸（交错成串时是全部）：一个人身上的名字 */
  const onCore = new Set<string>();
  const ownParts = (): Part[] => {
    if (!stagger) return base;
    if (strungParts) return strungParts;
    /** 左边、右边的各编到第几只了（名字照摆好的那只的左右：每人两只时就是 Chest_01_L、Chest_01_R 一圈一对） */
    const made = new Map<string, number>();
    const chests = hosts.flatMap((host, r) => {
      const row = breasts.filter((p) => rowOf(p) === host);
      const isLeft = (p: Part) => add(torso.pos, rotate(torso.quat, p.pos))[0] > 0;
      const lefts = row.find(isLeft) ?? row[0];
      const rights = row.find((p) => !isLeft(p)) ?? row[0];
      const per = packed[r].per;
      // 一个人占的角度里等间隔排 per 只，隔一圈错开半个
      const slot = (2 * Math.PI) / (count * per);
      return Array.from({ length: per }, (_, j) => {
        const target = (j - (per - 1) / 2 + (r % 2 ? 0.5 : 0)) * slot;
        // 偏在左边的照左边那只做，正中、偏在右边的照右边那只
        const p = target > 1e-9 ? lefts : rights;
        const tail = /^Chest_\d+(.*)$/.exec(p.name)?.[1] ?? '';
        const n = (made.get(tail) ?? 0) + 1;
        made.set(tail, n);
        const name = 'Chest_' + String(n).padStart(2, '0') + tail;
        // 都坐在芯子上：记下来，下面挂到芯子上（见 copy）
        onCore.add(name);
        return { ...strung(p, r, target), name };
      });
    });
    last.set('Chest', Math.max(1, ...made.values()));
    strungParts = [...base.filter((p) => !breasts.includes(p)), ...chests];
    return strungParts;
  };
  const copy = (k: number): Part[] => [
    ...ownParts().map((given): Part => {
      // 腿先把脚转平，下面改名用转平以后的骨骼、接上去的脚
      const legAt = (k * 2 * Math.PI) / count;
      const p: Part = given.type === 'leg' && !given.parent ? { ...given, ...flatFoot(given, footBack(given, legAt)) } : given;
      const own = (b: BoneHint): BoneHint => {
        const moved = b === hips ? { head: center, tail: add(center, sub(b.tail, b.head)) } : {};
        return { ...b, ...moved, name: boneName(b.name, k), ...(b.parent ? { parent: boneName(b.parent, k) } : {}) };
      };
      const group = p.fuseAs ?? p.type;
      const { bind: _bind, ...rest } = p;
      return {
        ...rest,
        name: partName(p.name, k),
        ...(p.parent
          ? { parent: partName(p.parent, k) }
          : p.type === 'leg'
            ? {
                pos: add(place(p.pos, k), rotate(aboutY(legAt), [0, 0, ((k * legs.length + (legOrder.get(given.name) ?? 0)) % 2 ? -1 : 1) * zigzag])),
                quat: quatMul(legQuat(legAt), p.quat),
              }
            : { pos: place(p.pos, k), quat: quatMul(turn(k), p.quat) }),
        // 坐在芯子上的胸挂在芯子上、跟着胯（不跟着哪个人的脊柱）
        ...(hipsInCore && onCore.has(p.name) ? { parent: 'Core', pos: place(add(torso.pos, rotate(torso.quat, p.pos)), k), quat: quatMul(quatMul(turn(k), torso.quat), p.quat) } : {}),
        ...(given === torso ? { prims: [...p.prims, ...stumpsOf(k), ...plugsOf(k)] } : {}),
        // 统一朝前的腿转了方向，和自己的胯对不齐：不和躯干直接取并集（接口是一圈锯齿），另算一类、圆滑地融合。
        // 第一个人本来就朝前，腿没转，还照原样直接取并集（圆滑地融合的话胯底下鼓起一道棱）
        ...(group === 'torso' ? { fuseAs: front && p.type === 'leg' && k > 0 ? ('tail' as const) : classOf(k, count) } : {}),
        // 胸挤着旁边那个人是围成一圈本来的样子：不算穿模
        ...(p.type === 'chest' ? { rootFree: EMBEDDED } : {}),
        // 外圈的腿也是：一个人并排的几条、相邻两个人挨着的那两条本来就挤着（圈紧的时候叠得更多）
        ...(p.type === 'leg' && !p.parent ? { rootFree: EMBEDDED, ringOf: partName('Torso', k) } : {}),
        ...(p.bones ? { bones: p.bones.filter((b) => b.name !== 'Hips' || (k === 0 && !hipsInCore)).map(own) } : {}),
        ...(p.grafts ? { grafts: p.grafts.map((g) => ({ ...g, bones: Object.fromEntries(Object.entries(g.bones).map(([key, v]) => [key, boneName(v, k)])), rigid: g.rigid.map((n) => boneName(n, k)) })) } : {}),
      };
    }),
    ...armsOf(k),
  ];

  /* ---- 圈心的芯子：照一个人的后背、肚皮各离圈心多远量 ---- */
  const necks = base.filter((p) => p.type === 'neck' && p.parent === 'Torso');
  const top = torso.pos[1] + (necks.length ? Math.min(...necks.map((p) => p.pos[1])) : headY - hipY) - 0.02;
  const rings: Ring[] = [];
  for (let y = hipY - 0.2; y <= top; y += 0.02) {
    // 肚皮：正中线两边各看一点，取最靠前的（肚脐、胸口正中是凹进去的）
    let front = -Infinity;
    for (const x of [0, 0.03]) {
      const t = castRay(probe, [x, y, FAR], [0, 0, -1], 2 * FAR);
      if (t < 2 * FAR) front = Math.max(front, FAR - t);
    }
    const t = castRay(probe, [0, y, -FAR], [0, 0, 1], 2 * FAR);
    if (front === -Infinity || t >= 2 * FAR) continue;
    const back = -FAR + t;
    // 胯底下两条腿之间是空的：只量到躯干还是一整块的高度
    if (front - back < 0.06) continue;
    const f = place([0, y, front], 0);
    const b = place([0, y, back], 0);
    // 各有各的胯：到肩膀渐渐粗到和并胯融合的一样
    const ramp = (from: number, length: number) => {
      const t = Math.max(0, Math.min(1, (y - torso.pos[1] - from) / length));
      return t * t * (3 - 2 * t);
    };
    // 有胸的那一段（交错成串时）：两种模式都粗到差一点到肚皮
    const zone = chestFrom === null ? 0 : ramp(chestFrom - CHEST_ZONE.ramp, CHEST_ZONE.ramp);
    const up = mode === 'fused' ? 1 : Math.max(zone, shoulderY === null ? 1 : ramp(shoulderY - CORE_SHOULDER, CORE_SHOULDER));
    const full = f[2] - (CORE_MARGIN + (CHEST_MARGIN - CORE_MARGIN) * zone);
    const thin = b[2] + (f[2] - b[2]) * CORE_HIPS;
    const r = thin + (full - thin) * up;
    // 髋关节以下渐渐收细（见 CORE_UNDER）
    const under = Math.min(1, Math.max(0, (hipY - (f[1] + b[1]) / 2) / CORE_UNDER.drop));
    const slim = r * (1 + (CORE_UNDER.keep - 1) * under * under * (3 - 2 * under));
    rings.push({ y: (f[1] + b[1]) / 2, w: Math.max(0.03, slim), d: Math.max(0.03, slim), z: 0 });
    measured.push({ y: f[1], front: f[2], core: Math.max(0.03, slim) });
  }
  hipsInCore = rings.length > 1 && hips !== undefined;
  const parts = Array.from({ length: count }, (_, k) => copy(k));
  if (front) {
    // 统一朝前时腿往外撇的方向和脚尖的方向不一样，各条腿的脚踝高低差一点（白模人台差两三厘米）：
    // 各自上下挪到和第一个人（他本来就朝前）的脚一样低
    const floor = lowest(parts[0].filter((p) => p.type === 'leg' && !p.parent));
    for (const own of parts) {
      own.forEach((p, i) => {
        if (p.type !== 'leg' || p.parent) return;
        const low = lowest([p]);
        if (Number.isFinite(low) && Number.isFinite(floor)) own[i] = { ...p, pos: [p.pos[0], p.pos[1] + floor - low, p.pos[2]] };
      });
    }
  }
  if (rings.length > 1) {
    rings.sort((a, b) => a.y - b.y);
    // 粗细沿高度磨平（见 CORE_SMOOTH）；量的时候记下的那份跟着改
    for (let round = 0; round < CORE_SMOOTH; round++) {
      const was = rings.map((ring) => ring.w);
      for (let i = 1; i < rings.length - 1; i++) rings[i].w = rings[i].d = (was[i - 1] + 2 * was[i] + was[i + 1]) / 4;
    }
    rings.forEach((ring, i) => {
      if (measured[i]) measured[i].core = ring.w;
    });
    const low = rings[0];
    const high = rings[rings.length - 1];
    const dome = (from: Ring, sign: 1 | -1) => CORE_DOME.map(([dy, k]): Ring => ({ y: from.y + sign * dy, w: from.w * k, d: from.d * k, z: 0 }));
    const all = [...dome(low, -1).reverse(), ...rings, ...dome(high, 1)];
    // 芯子放在圈心，带着 Hips，排在最前面（坐在它上面的胸挂在它上面）；没有 Hips 的话挂在第一个人的躯干上，跟着他的骨骼。
    // 它本来就埋在每个人身子里：穿模检查不算它
    const span = hips ? sub(hips.tail, hips.head) : ([0, 0.06, 0] as V3);
    const first = parts[0].find((p) => p.name === 'Torso')!;
    const upright = quatConj(first.quat);
    parts[0][hipsInCore ? 'unshift' : 'push']({
      name: 'Core',
      type: 'lower',
      side: 0,
      ...(hipsInCore ? { pos: [0, 0, 0] as V3, quat: [0, 0, 0, 1] as Quat } : { parent: 'Torso', pos: rotate(upright, sub([0, 0, 0], first.pos)), quat: upright }),
      material: 'clay',
      prims: [{ kind: 'loft', name: 'Core', rings: all }],
      ...(hipsInCore ? { bones: [{ name: 'Hips', head: [0, hipY, 0] as V3, tail: [span[0], hipY + span[1], span[2]] as V3 }] } : {}),
      rootFree: EMBEDDED,
    });
  }

  /* ---- 圈心底下的腿：往里一圈圈排到圈心，正中一条 ---- */
  const innerLegParts = (): Part[] => {
    if (!innerLegs) return [];
    const left = legs.find((p) => p.side > 0) ?? legs[0];
    const right = legs.find((p) => p.side < 0) ?? left;
    // 挨得比外圈紧（见 INNER_GAP）：照外圈那样隔开的话，底下看上去一圈圈稀稀拉拉的
    const inner = gap * INNER_GAP;
    // 外圈每个人身上的腿编到第几号：里面的腿接着往下编
    const legBase = (last.get('Leg') ?? 1) * count;
    // 外圈那些腿最低到哪：里面的腿斜得不一样（正中那条是直的），各自挪到脚和外圈的一样低
    const floor = lowest(parts[0].filter((p) => p.type === 'leg'));
    let pairs = 0;
    let middles = 0;
    /** 照 from 做一条腿：髋关节离圈心 r、在 at 这个方向上，往外斜得和外圈的一样（正中那条不斜）；suffix 是名字和骨骼的左右 */
    const make = (source: Part, r: number, at: number, suffix: '_L' | '_R' | '', index: number): Part => {
      // 先把脚转平，下面改名用转平以后的骨骼、接上去的脚
      const from: Part = r > 0 ? { ...source, ...flatFoot(source, footBack(source, at, lean)) } : source;
      const number = legBase + 1 + index;
      const mine = new Set((from.bones ?? []).map((b) => b.name));
      // 骨骼也接着外圈的往下编：外圈每个人身上这种骨骼有几根（左腿的、右腿的、中线上的各算各的）
      const rename = (name: string) => {
        if (!mine.has(name)) return name;
        const base = ordinal(name)[0].replace(/_[LR]$/, '') + suffix;
        return nthName(base, (boneCount.get(base) ?? 0) * count + index);
      };
      // 圈心底下的腿不在哪个人身上（照外圈的腿做的，把它身上记的那个人去掉）
      const { bind: _bind, ringOf: _ringOf, ...rest } = from;
      const leg: Part = {
        ...rest,
        name: `Leg_${String(number).padStart(2, '0')}${suffix}`,
        pos: [r * Math.sin(at), hipY, r * Math.cos(at)],
        // 圈心底下的腿不跟着往外多叉开（见 SPLAY_MAX）：它们长在芯子底下，不在谁的胯上，叉开了根部就离开芯子
        quat: quatMul(legQuat(at, r > 0 ? lean : 0), from.quat),
        // 素体的腿本来和自己的躯干直接取并集：这里接在芯子底下，另算一类，和芯子圆滑地融合
        ...((from.fuseAs ?? from.type) === 'torso' ? { fuseAs: 'neck' as const } : {}),
        // 一圈圈的腿本来就挨着：不算穿模
        rootFree: EMBEDDED,
        ...(from.bones ? { bones: from.bones.map((b) => ({ ...b, name: rename(b.name), ...(b.parent ? { parent: rename(b.parent) } : {}) })) } : {}),
        ...(from.grafts ? { grafts: from.grafts.map((g) => ({ ...g, bones: Object.fromEntries(Object.entries(g.bones).map(([key, v]) => [key, rename(v)])), rigid: g.rigid.map(rename) })) } : {}),
      };
      const low = lowest([leg]);
      return Number.isFinite(low) && Number.isFinite(floor) ? { ...leg, pos: [leg.pos[0], leg.pos[1] + floor - low, leg.pos[2]] } : leg;
    };
    const made: Part[] = [];
    let innermost = radius;
    for (let r = radius - inner; r > inner * 0.75; r -= inner) {
      innermost = r;
      const n = Math.max(3, Math.round((2 * Math.PI * r) / inner));
      for (let i = 0; i < n; i++) {
        // 左半边（+X）的每一条配右半边镜像的一条；正后方中线上的单独一条
        const at = ((i + 0.5) * 2 * Math.PI) / n;
        if (Math.abs(Math.sin(at)) < 1e-6) made.push(make(left, r, at, '', middles++));
        else if (Math.sin(at) > 0) {
          made.push(make(left, r, at, '_L', pairs), make(right, r, -at, '_R', pairs));
          pairs++;
        }
      }
    }
    // 最里面那一圈离圈心还放得下一条：正中再放一条直的
    if (innermost > inner * 0.75) made.push(make(left, 0, 0, '', middles++));
    // 中线上的腿排在成对的后面编号
    return made.map((p) => (/_[LR]$/.test(p.name) ? p : { ...p, name: `Leg_${String(legBase + 1 + pairs + Number(/^Leg_(\d+)/.exec(p.name)![1]) - legBase - 1).padStart(2, '0')}` }));
  };

  /* ---- 落到地上，量身高 ---- */
  let out = [...parts.flat(), ...innerLegParts()];
  const ground = lowest(out);
  out = out.map((p) => (p.parent ? p : { ...p, pos: [p.pos[0], p.pos[1] - ground, p.pos[2]] as V3 }));
  const height = highest(out) * figure.scale;
  return {
    figure: { ...figure, parts: out, metrics: { ...figure.metrics, height, headRatio: height / figure.metrics.headHeight } },
    // 摆位该照几排胸摆：最下面一圈比第一圈低几个排距，躯干就加长几排
    chest: stagger ? { rows: 1 + (circles > 1 && pitch > 0 ? Math.max(1, Math.round(drops[circles - 1] / pitch)) : 0), per: packed.map((ring) => ring.per), ...foot } : null,
  };
}
