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
import { animeGrid } from '../anime/body';
import { chestBulk, chestLayers, chestReach } from '../anime/chest';
import { castRay, compileField } from '../sdf/field';
import { highest, lowest, pointArm } from './conjoined';
import type { BoneHint, Figure, Graft, Part, PartType, Prim, Ring } from './figure';
import { nthName } from './figure';
import { type Quat, type V3, Q_ID, add, len, mat3Mul, mul, quatBetween, quatConj, quatMat3, quatMul, rotate, sub } from './vec';
import { RING_SPREAD_CIRCLE_MIN } from '../model/spec';

export type Ringed = 'hips' | 'fused' | 'rows';
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
  /** 前后排：胯几排（2 是只有前后两排，多出来的是夹在中间、没有头的），不给就是 3 */
  hipRows?: number;
  /** 前后排：每排几个胯；0 或不给是自动（前排、后排跟着人数，中间的排跟着前排） */
  hipsPerRow?: number;
  /** 前后排时每个人的胸每排几个（BodySpec.chestRow）：一面上每排是它 × 这一面的人数，见 packRows；不给就是两个 */
  chestRow?: number;
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
  /**
   * 前后排：下半截（腰以下、腿）照这一份摆好的人做——参考图是宽胯、粗大腿互相贴着，layout.ts 把胯宽、四肢粗细调大了另摆一份。
   * 部件要和 figure 的同名、同数（只有体型不一样）；不给就和上半截用同一份
   */
  lower?: Figure;
}

/**
 * 圈的松紧（spread）：胯那一圈的半径是「所有的腿在圈上隔得一样远」那么大的多少倍。1 是腿隔得一样远，人和人只在肩膀、胯上挨着，
 * 圈心的芯子粗；小于 1 的圈小、相邻两个人的大腿根并在一起、身子叠得多，芯子跟着细；大于 1 的人和人之间拉开。
 * 头在圈上挤得多紧跟着它走（1 是正好挨着，小于 1 是脸颊挤进去一点，画里几个头都是脸贴着脸的）：圈小到 TIGHT 时是 HEAD_TIGHT，
 * 圈到 1 以上都是正好挨着
 */
const TIGHT = 0.76;
/** 围成一圈的松紧最紧到这里；再往下只有前后排接着挤（见 ROWS.squeezed） */
const SPREAD_FLOOR = RING_SPREAD_CIRCLE_MIN;
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
/**
 * 前后排（rows）。他定的：以 refs/rows-front-side.jpg（彩色的正面 + 侧面）为准。几个人分成前后两排、背靠背，单数时前排多一个。
 * 侧面看是三个完整的身子挨在一起：前排的人往后靠、后排的往前靠、中间一排直着，头在正中背靠背；三排胯是分开的
 * （他说「注意中间部分，三排胯是分离的」），缝一直开到裆，脚尖全朝前。
 * - 每个人：**腰以下朝正前、直着站**（自己的胯和腿），**腰以上转过去**——每排正中的人不转，最外面的往外转 yaw，后排的人朝后——
 *   再往背后靠（lean）、往这一排的正中歪（roll，头凑到一起）。做法是把这个人摆两份，一份只留腰以上、一份只留腰以下，接在腰上。
 *   画师的话：「她胸腔实际上是四个斜着的胸腔拼在一起」。
 * - 中间一排（hollow）：和前排一样多，没有头、胸、手臂，只有躯干、脖子和腿；躯干直着、照样往正中歪，并在大家的上身里。
 * 常数：
 * - yaw：每排最外面的人上身往外转多少；heads：一排里相邻两个头隔一个头宽的多少；rollMax：上身最多往正中歪多少；
 *   wideHipRollMax：白模每人一两条腿时可多歪一点，让头靠近。三条腿起胸团更宽，肩膀内收过多会让手腕埋进胸团；
 * - step / tight：一排里相邻两副胯隔「一个人的胯那么宽」的多少——圈的松紧是 TIGHT 时、最紧时；
 * - depth / depthMin：前排、后排的髋关节各离正中（中间那一排）多远（米）。一个人的胯前后有二十厘米厚，三排胯挨着、各留一道缝；
 * - lean：上身最少往背后靠多少；
 * - waist：腰最细的地方在髋关节以上这个范围里找（米），上下两截在那里接、上身绕那里转；
 *   overlap：两截各往对面多留这么多，叠着的一小段圆滑地融合。上下两截不是一类（下半截单独一类，切口才只切它们），
 *   叠着的那一段两层表面差不多重合，圆滑融合会往外鼓一圈，像系了一条皮带；留少了切口磨圆的两头又接不上、凹一道槽。
 *   素体 1.5 cm 正好平（2.5 cm 鼓、0.5 cm 凹、−1 cm 断开）；白模（overlapMannequin）还是 2.5 cm；leanMax：整个人最多往正中靠多少；
 *   collar：中间那一排的躯干在脖子根以下这么多的地方削平（没有头，脖子不要）；
 *   seam：削出来的那一圈棱磨多圆（上身是转过、斜过的，和下身的截面对不齐，棱留着的话腰上一圈台阶）；
 *   bare：每排的胯比人多时，两头上面没有人的那几副胯腰上磨多圆（磨成圆顶，不然是一个平平的切口）。
 *   它的躯干不带脊柱的骨骼（见 copy）：腰那一截跟着脊柱弯的话，一摆姿势像几个弯着腰的无头人；
 *   pelvisRamp：素体的骨盆在髋关节上方多高起开始倾，到多高倾足；下缘仍和直立的腿对齐（legsFollow 时不用）；
 * - slit：素体的下半截相邻两条大腿之间切的缝多宽、从髋关节以下多低起切、刀往地下多伸出去多少（米，见 slits）。
 *   缝至少要比预览的格子（1.2 cm）宽一倍才切得开；soft 是刀口磨多圆；
 *   skew：同一排的缝绕竖直轴斜多少（前、中、后排一正一反）；rowSkew：排与排之间的缝斜多少；deep：同一排的缝前后伸出去多深（米）。
 *   缝要是正对着视线，正面、背面一眼看穿，三排的缝又在同一个左右位置上，是一条从裆通到膝盖下面、笔直透亮的线；
 *   斜过去以后视线穿过一排的厚度就被挡住，看到的是斜切面，暗的，像两条大腿挤出来的折痕；
 *   可同一个人的左右大腿只叠着一两厘米，挨着的那一截很浅，斜过去也挡不住，三排的缝又在同一个左右位置上，正面一眼看穿。
 *   knee：排与排之间那一刀往下只切到脚踝到髋关节的这么多（膝盖上下）；
 *   所以 shift：中间那一排（没有头，正面、背面都藏在前后排后面）整排往 +X 挪这么多（比缝宽一点），前排缝后面正好是中排的大腿；
 * - thigh / thighTaper / knee：下半截的大腿比滑块设的再粗多少倍（参考图是粗大腿、细小腿）。素体的腿是一块格子带加粗变形，
 *   从腿根往下 thighRamp[0] 起渐渐粗、到 thighRamp[1] 粗足，往脚踝那头变回原样的那一段拉长到腿长的 thighTaper（膝盖上面就开始收）；白模的大腿是一根圆台，根上粗 thigh 倍、
 *   膝盖那头只粗 knee 那么多（1 + (thigh − 1) · knee），小腿不动；
 * - legsFollow：前后两排的人连腿一起从髋关节斜过去（脚在脚踝上转平、整个人落回地上）。参考图侧面是一个「人」字：
 *   前后两个人从脚到头一条斜线，脚分得很开、头碰在一起；腿竖直、只有上身斜的话侧面是竖直的腿上顶一个斜身子；
 * - coreFrom：芯子从髋关节以上这么高才有，再往上 coreRamp 这么长渐渐粗到平常那么粗——往下是三排分开的胯，中间不能有东西填着；
 * - wrap：一面的胸从这头绕到那头有多长，是这一排胯宽的多少倍；cover：胸最多排到半圈的这么多，两头留给手臂；
 * - armAz：每侧前后两组手臂，从正侧面各往前、往后偏多少（弧度）；
 * - square：那一面从上面看的形状是「方一点的椭圆」|x/w|^p + |z/d|^p = 1 的 p（正圆是 2）；
 * - 胸照「每排几个」排、照胸围滑块的大小（11-15 他选的）：一面上每排是每人每排几个 × 这一面的人数，从这头到那头等间隔，
 *   每个人的那几只大致在他自己身上；排数是每人几排。以前为了从锁骨盖到裆，把胸放大到最多 2.4 倍、一只压一只、一排比一排少一只，
 *   胸少、胸小的时候（每人 4 只、胸围 1）一排只排得下 3 只，排成正中一竖条，两边的人身上空着；
 * - tuck：胸比「几个身子外面包的那一层」再往里收多少（米）：跨在沟上的那几只，胸根悬着的话底下露一圈毛边；
 * - pad：前后两面的胸后面垫的「胸底」：每排从第一只到最后一只、每半只的间隔量一下身体表面到胸根空多少，空出 least 以上的垫一个扁椭球，
 *   左右、上下是胸宽、胸高的 wide、tall 成，前后从胸根往里 behind 填到身体表面往里 into（米）；最下面一排再往下 under（垫子高的几成）托一排。
 *   人和人之间是凹的，胸小的时候胸和胸之间露出沟、最下面一排胸悬在沟上、底下是空的（11-15 问题单「中部有空洞」「胸部下方的异常空洞」）。
 *   整片垫在胸根后面的话小胸被盖住，所以只垫空的地方；
 * - stump：拿掉手臂的肩膀上垫的圆肩头（STUMP）多大、往里收多少（米）；
 * - coreTop：有胸的那一段芯子粗到差一点到肚皮，往上只到最上面一排胸的中心再往上这么多（米），再往上渐渐变细；
 *   span：跨在沟上的那几只最多比它那么宽的范围里最鼓的身体表面高出胸厚的多少（小胸跨不过沟，再高就和身子分开了）
 *
 * 试过又退掉的：
 * - 腿不跟着人、直着排成两排，上面盖一整块宽胯（胯成了一圈裙摆，腿从底下伸出来）；
 * - 整个人连胯一起斜着 45°、腿再单独转到朝前（胯是斜的，和腿对不齐，正面看不是三副朝前的胯）；
 * - 照草图背面那张把上身挤成正中一根窄躯干、底下九副胯、腰往下撑开一圈裙摆（侧面成了一块板，不是参考图那样三个挨着的身子）
 */
const ROWS = {
  yaw: 45 * (Math.PI / 180),
  hollowYaw: Math.PI / 2,
  heads: 0.8,
  rollMax: 24 * (Math.PI / 180),
  wideHipRollMax: 38 * (Math.PI / 180),
  neckLift: 0.028,
  step: 0.96,
  tight: 0.8,
  depth: 0.215,
  depthMin: 0.185,
  squeezed: { at: 0.3, step: 0.6, depth: 0.11 },
  hipGap: 0,
  chestFloor: 0.05,
  chestTight: 0.5,
  fill: { least: 0.01, into: 0.6, tall: 0.16, deep: 0.62, lift: 0.01, soft: 0.02 },
  coreWaist: 0.04,
  lean: 6 * (Math.PI / 180),
  waist: [0.1, 0.34] as [number, number],
  overlap: 0.015,
  overlapMannequin: 0.025,
  seam: 0.03,
  bare: 0.09,
  pelvisRamp: [0.04, 0.18] as const,
  legsFollow: true,
  thighFit: 1.02,
  thighLap: 0.1,
  legLean: 4 * (Math.PI / 180),
  thigh: 1.5,
  slit: { gap: 0.03, top: 0.08, reach: 0.2, soft: 0.012, skew: 10 * (Math.PI / 180), rowSkew: 3 * (Math.PI / 180), deep: 0.2, shift: 0, knee: 0.5, waist: 0.3, rowGap: 0.06, rowShare: 0.33, rowBack: 0.03, marker: 0.014, touch: 0.03, rowSoft: 0.025 },
  thighRamp: [0.02, 0.3] as const,
  thighTaper: 0.62,
  knee: 0.35,
  leanMax: 16 * (Math.PI / 180),
  upperLeanMax: 24 * (Math.PI / 180),
  collar: 0.02,
  coreFrom: 0.1,
  coreRamp: 0.22,
  wrap: 1.25,
  cover: 0.86,
  flank: 0.08,
  armAz: 0.32,
  armApart: 0.11,
  armFanTop: 32 * (Math.PI / 180),
  armFanSpan: 66 * (Math.PI / 180),
  square: 3.2,
  tuck: 0.022,
  span: 0.4,
  coreTop: 0.02,
  stump: { size: 0.88, inset: 0.02 },
  profile: { out: 0.045, back: 0.015, show: 0.05, bury: 0.7 },
  pad: { wide: 0.55, tall: 0.6, behind: 0.006, into: 0.03, least: 0.008, most: 0.07, rampTop: 0.3, rampInto: 0.015, rampThick: 0.022, soft: 0.015 },
};
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
const LETTERS = 'BCDEFGHIJKLMNOPQRSTUVWXYZ';
/** 第 k 份（从 1 数）的字母：B…Z，用完了接着 AB…AZ、AAB…（前后排胯多的时候一份份能有五十来份；单个的 A 是第一个人，不带字母） */
const letter = (k: number): string => (k <= LETTERS.length ? LETTERS[k - 1] : 'A' + letter(k - LETTERS.length));
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
const aboutZ = (angle: number): Quat => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
const norm2 = (x: number, y: number): [number, number] => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};

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
  { mode, count, armPairs = 0, tPose = false, armLayout = 'fan', chest = 'aligned', breasts: asked, chestRow = 2, hipRows = 3, hipsPerRow = 0, chestPack, innerLegs = false, spread: asSet = 1, legFacing = 'out', legGap, lower }: RingOptions,
): { figure: Figure; chest: ChestPack | null } {
  // 松紧比 SPREAD_FLOOR 还小的只有前后排认（见 ROWS.squeezed）；围成一圈的到 SPREAD_FLOOR 为止
  const spread = mode === 'rows' ? asSet : Math.max(SPREAD_FLOOR, asSet);
  const loose = spreadOf(spread);
  const rowsMode = mode === 'rows';
  const torso = figure.parts.find((p) => p.name === 'Torso');
  // 前后排：腿、下半截照 lower 那一份（见 RingOptions.lower）
  const below = rowsMode && lower?.parts.some((p) => p.name === 'Torso') ? lower : figure;
  const lowTorso = below.parts.find((p) => p.name === 'Torso')!;
  const legs = below.parts.filter((p) => p.type === 'leg' && !p.parent);
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
  /**
   * 前后排：腰最细的地方多高、截面的中心在前后的哪里（上半截、下半截在这里接，上身绕这个中心拧、往正中歪）。
   * 腰的截面接近圆，上身拧过去也和下身对得上；在胯上接的话那里又宽又扁，一拧 45° 就对不齐，腰上一圈棱。
   * 往背后靠不在腰上折：整个人从髋关节起一起靠（下半截的骨盆跟着倾，腿还是直的），像真人往后靠那样——
   * 试过上身绕腰往后折二十度，肚子上折出一道棱，看着像衣服的下摆。两份里取上半截那一份量（腰宽是一样的）
   */
  const waist = (() => {
    if (!rowsMode) return { y: hipY, z: 0, half: 0.1, deep: 0.08 };
    const field = compileField({ scale: 1, parts: [torso] }, { blend: 0 });
    let best = hipY + ROWS.waist[0];
    let narrow = Infinity;
    for (let y = hipY + ROWS.waist[0]; y <= hipY + ROWS.waist[1]; y += 0.01) {
      const t = castRay(field, [1, y, torso.pos[2]], [-1, 0, 0], 2);
      if (t < 2 && 1 - t < narrow - 1e-4) {
        narrow = 1 - t;
        best = y;
      }
    }
    // 腰的截面中心在前后的哪里：后腰是往里收的，中心比髋关节那根竖线靠前（素体靠前五厘米）。
    // 上身要绕这个中心拧——绕髋关节那根竖线拧的话，上身一拧（后排的人拧半圈）腰就甩到另一边，和下身的腰错开一截，腰上一圈台阶
    const front = castRay(field, [0, best, 1], [0, 0, -1], 2);
    const back = castRay(field, [0, best, -1], [0, 0, 1], 2);
    // half：腰最细的地方半个宽；deep：前后半个厚
    const cut = front < 2 && back < 2;
    return { y: best, z: cut ? (1 - front + (-1 + back)) / 2 : 0, half: Number.isFinite(narrow) ? narrow : 0.1, deep: cut ? (1 - front - (-1 + back)) / 2 : 0.08 };
  })();
  /** 腰的截面中心（一个人自己的坐标） */
  const waistC: V3 = [0, waist.y, waist.z];
  /** 往圈心靠是绕哪一点：髋关节那么高、髋关节那根竖线上 */
  const pivotY = hipY;
  const pivotZ = 0;
  /** 前后排：前排几个人（单数时前排多一个），一排里相邻两条腿隔多远，两排的髋关节各离正中多远 */
  const frontCount = Math.ceil(count / 2);
  /**
   * 前后排：一条没加粗的大腿左右多宽（大腿中段，髋关节往下 18–30 cm 最宽的地方；再往上是胯，本来就并在一起）。大腿加粗多少、左右相邻两个人能挨多近都照它定：
   * 腿和腿只能贴着、不能叠着——叠着的话大腿之间那道缝（见 slits）把叠的部分削成一片片薄板（他问「为什么腿部被削平了」）
   */
  const thighWide = ((): number => {
    if (!rowsMode || !legs.length) return 0.1;
    const leg = legs[0];
    const field = compileField({ scale: 1, parts: [leg] }, { blend: 0 });
    let most = 0;
    for (let y = hipY - 0.3; y <= hipY - 0.18; y += 0.02) {
      const a = castRay(field, [leg.pos[0] + 0.5, y, leg.pos[2]], [-1, 0, 0], 1);
      const b = castRay(field, [leg.pos[0] - 0.5, y, leg.pos[2]], [1, 0, 0], 1);
      if (a < 1 && b < 1) most = Math.max(most, 1 - a - b);
    }
    return most > 0.02 ? most : 0.1;
  })();
  /** 大腿加粗到几倍：最多 ROWS.thigh，一个人自己的两条大腿（中段）正好贴上为止；不收细 */
  const thighK = rowsMode && legs.length > 1 ? Math.max(1, Math.min(ROWS.thigh, (wide * ROWS.thighFit) / thighWide)) : ROWS.thigh;
  /** 前后排下半截的腿：大腿加粗（见 thighK）。只改形状，骨骼、接上去的脚不动 */
  const thighen = (leg: Part): Part => {
    const ankle = leg.bones?.find((b) => /^Foot/.test(b.name))?.head;
    if (!ankle) return leg;
    const span = Math.hypot(ankle[0], ankle[1], ankle[2]);
    return {
      ...leg,
      prims: leg.prims.map((q): Prim => {
        if (q.kind === 'grid') {
          const base = q.thicken?.k ?? 1;
          const from = q.thicken?.ramp ?? [0.1, 0.2, 0.08];
          // 从腿根起就渐渐粗起来、拉长到 thighRamp 才粗足：一下子粗起来的话大腿根上鼓出一圈，像穿了灯笼裤
          return { ...q, thicken: { from: [0, 0, 0], to: q.thicken?.to ?? ankle, k: base * thighK, ramp: [Math.min(from[0], ROWS.thighRamp[0]), Math.max(from[1], ROWS.thighRamp[1]), span * ROWS.thighTaper], end: base } };
        }
        if (q.kind === 'cone' && /^Thigh/.test(q.name)) return { ...q, ra: q.ra * thighK, rb: q.rb * (1 + (thighK - 1) * ROWS.knee) };
        return q;
      }),
    };
  };
  /**
   * 下半截的一副胯（连加粗过的大腿）前后各鼓到哪（摆位的坐标里的 z；一个朝正前、直着站的人）：
   * 从髋关节往下 0.38 到往上 0.14 这一段里，肚皮、大腿前面最靠前，屁股、大腿后面最靠后的地方
   */
  const hipBulk = ((): { front: number; back: number; thick: number } => {
    if (!rowsMode) return { front: 0.09, back: -0.11, thick: 0.2 };
    const far = 0.8;
    const field = compileField({ scale: 1, parts: [lowTorso, ...legs.map(thighen)] }, { blend: 0 });
    let front = -Infinity;
    let back = Infinity;
    // thick：同一个高度上最厚的地方有多厚。肚皮最鼓、屁股最鼓不在一个高度上，前后两排要贴着照它算（照 front − back 算会多隔出两三厘米）
    let thick = 0;
    for (let y = hipY - 0.38; y <= hipY + 0.14; y += 0.02) {
      let [f1, b1] = [-Infinity, Infinity];
      for (const x of [0, ...legs.map((leg) => leg.pos[0])]) {
        const f = castRay(field, [x, y, far], [0, 0, -1], 2 * far);
        const b = castRay(field, [x, y, -far], [0, 0, 1], 2 * far);
        if (f < 2 * far) f1 = Math.max(f1, far - f);
        if (b < 2 * far) b1 = Math.min(b1, -far + b);
      }
      if (f1 === -Infinity || b1 === Infinity) continue;
      front = Math.max(front, f1);
      back = Math.min(back, b1);
      thick = Math.max(thick, f1 - b1);
    }
    return Number.isFinite(front) && Number.isFinite(back) ? { front, back, thick } : { front: 0.09, back: -0.11, thick: 0.2 };
  })();
  // 松紧到 SPREAD_FLOOR 以下接着往里挤（0 是还没挤，1 是挤到 ROWS.squeezed.at）：左右、前后都更近
  const squeeze = Math.max(0, Math.min(1, (SPREAD_FLOOR - spread) / (SPREAD_FLOOR - ROWS.squeezed.at)));
  // 左右相邻两个人最近挨到「里侧那两条大腿贴着」（叠 ROWS.thighLap 以内）：再近就叠在一起了。
  // 松紧再小靠下半截的胯、大腿一起收窄来变窄（见 layout.ts 的 ROWS_LOWER），不靠人和人叠得更多
  const rowStep = Math.max(
    (wide + thighWide * thighK * (1 - ROWS.thighLap)) / 2,
    wide * (Math.max(ROWS.tight, (ROWS.step * spread) / TIGHT) * (1 - squeeze) + ROWS.squeezed.step * squeeze),
  );
  // 前后相邻两排胯至少隔「一副完整的胯那么厚 + ROWS.hipGap」：每一排的胯、臀、腰都是完整的，不靠切掉一片来分开
  // （他说「三个胯和臀部都要是完整的」；参考图里胯和胯也隔着二十几厘米）。松紧再小，前后也不再往里挤，只有左右接着挤
  const rowDepth = Math.max(
    hipBulk.thick + ROWS.hipGap,
    Math.max(ROWS.depthMin, (ROWS.depth * spread) / TIGHT) * (1 - squeeze) + ROWS.squeezed.depth * squeeze,
  );
  // 前后排时「半径」是正前方那个人离正中多远：下面量芯子、摆胸都照「站在正前方、不转的一个人」算（见 place0）
  // （前后排：正前方那个人的髋关节离正中多远，见 rowSpots 的 rowZ）
  /** 前后排：最前面那排胯离正中多远（几排胯前后挨着，隔 rowDepth） */
  const rowHalf = ((Math.max(2, hipRows) - 1) / 2) * rowDepth;
  const radius = rowsMode ? rowHalf - waist.z : (loose.radius * Math.max(2, legs.length) * wide) / 4 / Math.sin(Math.PI / (2 * count));
  const heads = plain.filter((p) => p.type === 'head' && p.parent === 'Torso');
  const stems = plain.filter((p) => p.type === 'neck' && p.parent === 'Torso');
  const headHeight = figure.metrics.headHeight / figure.scale;
  const headY = torso.pos[1] + (heads.length ? heads.reduce((sum, p) => sum + p.pos[1], 0) / heads.length : hipY + 0.7) + headHeight * 0.4;
  // 前后排：头的中心至少离正中半个头（前后两排的后脑勺挨着）
  const headRadius = rowsMode ? loose.head * HEAD_HALF * headHeight : (loose.head * HEAD_HALF * headHeight * Math.max(1, heads.length)) / Math.sin(Math.PI / count);
  /** 脖子根离正中多远算挨着 */
  const neckBack = rowsMode ? NECK_GAP / 2 : NECK_GAP / (2 * Math.sin(Math.PI / count));
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
          Math.sin(rowsMode ? ROWS.leanMax : LEAN_MAX),
          single ? (r + neckZ - neckBack) / Math.max(0.2, neckY - pivotY) : (r - headRadius) / Math.max(0.2, headY - pivotY),
        ),
      ),
    );
  const lean = rowsMode ? Math.max(ROWS.lean, leanAt(radius)) : leanAt(radius);
  // 前后排：胯和腿最多斜这么多，剩下的由上身绕腰往背后靠（参考图侧面：腿差不多是直的，胯往前顶、肩往后靠，头才凑到一起）。
  // 整个人连腿一起斜到底的话，三排胯隔开以后脚往前后撇得很开，侧面太宽
  const rowLegLean = rowsMode ? Math.min(lean, ROWS.legLean) : lean;
  /** 前后排：下半截斜 rowLegLean、上身绕腰靠 b 时，正前方那个人身上（自己的坐标里高 y、前后 z）的一点离正中多远 */
  const reachAt = (y: number, z: number, b: number) =>
    radius + waist.z * Math.cos(rowLegLean) - (waist.y - pivotY) * Math.sin(rowLegLean) + (z - waist.z) * Math.cos(b) - (y - waist.y) * Math.sin(b);
  // 上身绕腰往背后靠多少：靠到脖子根挨着正中（没有脖子的照头的中心离正中半个头），最少 ROWS.lean，最多 ROWS.upperLeanMax
  const upperLean = ((): number => {
    if (!rowsMode) return lean;
    const short = (b: number) => (single ? reachAt(neckY, neckZ, b) - neckBack : reachAt(headY, 0, b) - headRadius);
    let lo = Math.max(rowLegLean, ROWS.lean);
    let hi = Math.max(lo, ROWS.upperLeanMax);
    if (short(lo) <= 0) return lo;
    if (short(hi) > 0) return hi;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (short(mid) > 0) lo = mid;
      else hi = mid;
    }
    return hi;
  })();
  /** 脖子从竖直往外歪多少：脖子根（身子靠过去以后）离圈心 from，头的中心要到 headRadius */
  let fan = 0;
  if (single) {
    const from = rowsMode ? reachAt(neckY, neckZ, upperLean) : radius + neckZ * Math.cos(lean) - (neckY - pivotY) * Math.sin(lean);
    const reach = Math.hypot(single.head.pos[0] - single.neck.pos[0], single.head.pos[1] - single.neck.pos[1], single.head.pos[2] - single.neck.pos[2]);
    const out = (a: number) => reach * Math.sin(a) + HEAD_HALF * headHeight * Math.sin(a * HEAD_FOLLOW);
    const need = headRadius - from;
    // 前后排：上身绕腰靠得多（见 upperLean），脖子根离正中比半个头还远的话脖子不用往外歪——但也不能跟着身子一直往正中倒
    // （头会扎进对面那排的头里）：往正中歪到头的中心正好离正中半个头为止（fan 是负的，最多歪到和身子一样斜）
    if (need > 0 || rowsMode) {
      let lo = rowsMode ? -upperLean : 0;
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
  const bodyLean = rowsMode ? upperLean : lean;
  const base =
    single && (fan > 0 || rowsMode)
      ? plain.map((p) => {
          if (p === single.neck) return { ...p, quat: quatMul(aboutX(fan + bodyLean), p.quat) };
          if (p === single.head) {
            return {
              ...p,
              pos: add(single.neck.pos, rotate(aboutX(fan + bodyLean), sub(p.pos, single.neck.pos))),
              quat: quatMul(aboutX(fan * HEAD_FOLLOW + bodyLean), p.quat),
            };
          }
          return p;
        })
      : plain;
  const pivot: V3 = [0, pivotY, pivotZ];
  const leanQ = aboutX(-lean);
  // 前后排：上身是绕腰靠的（下半截只斜 rowLegLean）。upQ 是上身靠了多少，waist0 是正前方那个人的腰在世界里哪
  const upQ = rowsMode ? aboutX(-upperLean) : leanQ;
  const waist0: V3 = add(add(rotate(aboutX(-rowLegLean), sub(waistC, pivot)), pivot), [0, 0, radius]);
  /** place0 反过来：世界里的一点 → 正前方那个人自己的坐标 */
  const unplace0 = (w: V3): V3 => (rowsMode ? add(waistC, rotate(quatConj(upQ), sub(w, waist0))) : add(rotate(quatConj(leanQ), sub(sub(w, [0, 0, radius]), pivot)), pivot));
  /**
   * 腿跟着身子一起斜，圈比 TIGHT 还紧的再往外多叉开一点（见 SPLAY_MAX）：胯挤在一处，脚还踩在 TIGHT 那么大的圈上。
   * 脚在脚踝上照这个角度转平
   */
  // 多叉开多少：叉到脚踩在 TIGHT 那么大的圈上（那时身子也倾得多，一起算进去），最多多叉 SPLAY_MAX
  const roomy = spread < TIGHT ? (radius * TIGHT) / Math.max(0.01, spread) : radius;
  const splay =
    !rowsMode && spread < TIGHT
      ? Math.max(0, Math.min(SPLAY_MAX, Math.asin(Math.max(0, Math.min(0.99, Math.sin(leanAt(roomy)) + (roomy - radius) / Math.max(0.2, hipY)))) - lean))
      : 0;
  const legLean = lean + splay;
  /** 整圈的腿一前一后错开多少（见 STAGGER）：圈越紧错得越多 */
  const zigzag = !rowsMode && spread < TIGHT ? STAGGER * Math.min(1, (TIGHT - spread) / (TIGHT - 0.5)) : 0;
  /** 这个人身上的腿从圈上第几条数起（整圈挨着数，一条往外、一条往里） */
  const legOrder = new Map([...legs].sort((p, q) => p.pos[0] - q.pos[0]).map((p, i) => [p.name, i]));
  /**
   * 每个人站哪（髋关节那一点从上面看在哪）、朝哪（绕竖轴转多少）；row、rank 是前后排时第几排、这一排从右往左第几个；
   * mirror 是左右镜像的那个人。第一个人在正前方（前后排的前排是双数时在正中偏左）
   */
  /**
   * half：前后排时这一份是上身（upper，只留腰以上）还是下身（lower，只留腰以下）；hollow 是中间那一排的上身（row 是 2，
   * 没有头、胸、手臂）。nth：下身里它是第几份（腿照它编号）
   */
  /** y：整个人上下挪多少（前后排斜着的人连腿一起斜，脚抬起来一点，挪回地上） */
  /**
   * line：前后排时下身、中间那几排的上身在第几排胯上（从前往后数，0 是前排）；
   * bare：前后排每排的胯比人多时，两头多出来、上面没有人的那几副下身（腰上那一刀磨成圆顶，见 ROWS.bare）
   */
  type Spot = { x: number; z: number; yaw: number; row: number; rank: number; mirror: number; roll: number; lean: number; half?: 'upper' | 'lower'; hollow?: boolean; nth?: number; y?: number; line?: number; bare?: boolean };
  const rowSpots = (): Spot[] => {
    const span = Math.max(2, legs.length) * rowStep;
    // 几排胯照腰的截面中心前后对称（前排 +rowHalf，往后每排隔 rowDepth）：下半截都朝正前，腰的截面中心比髋关节那根竖线
    // 靠前 waist.z，所以几排的髋关节都再往后这么多。照髋关节对称的话，后排的上身（拧了半圈）比前排的多往正中靠两个 waist.z
    const lines = Math.max(2, hipRows);
    const lineZ = Array.from({ length: lines }, (_, i) => rowHalf - i * rowDepth - waist.z);
    const rowZ = [lineZ[0], 0, lineZ[lines - 1]];
    /** 一排 m 个从正中往两边排：正中的（或者正中偏左的）排在前面 */
    const across = (m: number) => Array.from({ length: m }, (_, i) => i - (m - 1) / 2).sort((a, b) => Math.abs(a) - Math.abs(b) || b - a);
    // 上身往这一排的正中歪多少：歪到头（脖子顶上那一点）离正中是「第几个 × 头宽 × ROWS.heads」那么远
    const top = single ? add(torso.pos, rotate(torso.quat, base.find((p) => p.name === single.head.name)!.pos)) : ([0, neckY, neckZ] as V3);
    const rollOf = (t: number, yaw: number, pitch: number) => {
      if (!single || !t) return 0;
      const side = Math.sign(t);
      const [x, y] = rotate(quatMul(aboutX(-pitch), aboutY(yaw)), sub(top, waistC));
      const want = Math.abs(t) * 2 * HEAD_HALF * headHeight * ROWS.heads;
      // 头绕腰走的是圆弧。先照已经拧过、往背后靠过的高度和横向偏移求角度。
      const reach = Math.hypot(x, y);
      const target = Math.max(-1, Math.min(1, (want - Math.abs(t) * span) / reach));
      const roll = Math.atan2(side * x, y) - Math.asin(target);
      const limit = !sampled && legs.length <= 2 ? ROWS.wideHipRollMax : ROWS.rollMax;
      return side * Math.max(0, Math.min(limit, roll));
    };
    const made: (Omit<Spot, 'mirror'> & { t: number })[] = [];
    // 每个人的上身
    [frontCount, count - frontCount].forEach((m, row) => {
      for (const t of across(m)) {
        const out = m > 1 ? t / ((m - 1) / 2) : 0;
        const yaw = row ? Math.PI - out * ROWS.yaw : out * ROWS.yaw;
        const pitch = row ? -upperLean : upperLean;
        made.push({ t, row, rank: Math.round(t + (m - 1) / 2), x: t * span, z: row ? rowZ[2] : rowZ[0], yaw, roll: rollOf(t, yaw, pitch), lean: pitch, half: 'upper' });
      }
    });
    // 带腿的：前排、中间几排、后排的下身，都朝正前、直着站；每排几个胯见 hipsPerRow（胯和人分开设，11-15 他选的）。
    // 胯比这一排的人少的，照这一排的人站多宽铺开（上身坐在那一片上面），胯和胯之间隔得比平常远
    let nth = 0;
    const hipsOf = (people: number) => (hipsPerRow > 0 ? hipsPerRow : people);
    const spacing = (hips: number, people: number) => (hips > 1 && hips < people ? (span * (people - 1)) / (hips - 1) : span);
    // （前排、后排的骨盆跟着上身一起往正中靠：lean 是往世界的 −Z 靠多少，后排是负的）
    /** 这一排的人站多宽（最外面那个人的中心离正中多远，再加半个人）：胯比人多时，这以外的胯上面没有人 */
    const under = (people: number, x: number) => Math.abs(x) <= ((people - 1) / 2) * span + span / 2 + 1e-6;
    for (let i = 0; i < lines; i++) {
      const row = i === 0 ? 0 : i === lines - 1 ? 1 : 2;
      const people = row === 1 ? count - frontCount : frontCount;
      const hips = hipsOf(people);
      for (const t of across(hips)) {
        const x = t * spacing(hips, people);
        made.push({ t, row, line: i, rank: -1, x, z: lineZ[i], yaw: 0, roll: 0, lean: row === 0 ? rowLegLean : row === 1 ? -rowLegLean : 0, half: 'lower', nth: nth++, ...(under(people, x) ? {} : { bare: true }) });
      }
    }
    // 中间几排的上身：没有头、胸、手臂，直着、照样往正中歪；人底下的每副胯上一个（两头多出来的胯不放，不然像几根没头的柱子）
    for (let i = 1; i < lines - 1; i++) {
      const hips = hipsOf(frontCount);
      const held = across(hips).filter((t) => under(frontCount, t * spacing(hips, frontCount)));
      const outermost = Math.max(0, ...held.map(Math.abs));
      for (const t of held) {
        const x = t * spacing(hips, frontCount);
        // 两头那两个背朝外（脸朝正中）：正面朝前站着的话，肩膀横着从前后两排斜着的人中间顶出来，侧面看是一块方疙瘩；
        // 转过去以后侧面看是一个后背夹在前后两个人中间（参考图的侧面就是这样），两个肩膀一个接前排、一个接后排
        const yaw = outermost > 0 && Math.abs(t) === outermost ? -Math.sign(t) * ROWS.hollowYaw : 0;
        made.push({ t, row: 2, line: i, rank: Math.round(t + (hips - 1) / 2), x, z: lineZ[i], yaw, roll: rollOf(t, yaw, 0), lean: 0, half: 'upper', hollow: true });
      }
    }
    // 前后两排连腿一起斜（见 ROWS.legsFollow）：脚踝绕髋关节转了 lean，抬起来一点，整个人（上下两截）落回地上
    const sink = ROWS.legsFollow ? -(hipY - ankleY) * (1 - Math.cos(rowLegLean)) : 0;
    // 隔一排错开半道缝多一点（见 ROWS.slit.shift；只有素体切缝）：第 1、3 排；错开的是后排的话，后排的上身跟着一起挪
    const shifted = (s: (typeof made)[number]) => sampled && ((s.line ?? (s.row === 1 ? lines - 1 : 0)) % 2 === 1);
    for (const s of made) {
      if (s.row !== 2) s.y = sink;
      if (shifted(s)) s.x += ROWS.slit.shift;
    }
    return made.map((s) => ({ ...s, mirror: made.findIndex((o) => o.row === s.row && o.half === s.half && !!o.hollow === !!s.hollow && o.line === s.line && Math.abs(o.t + s.t) < 1e-6) }));
  };
  /** 脚踝多高（腿上那根 Foot 骨骼的起点） */
  const ankleY = (() => {
    const leg = legs[0];
    const foot = leg.bones?.find((b) => /^Foot/.test(b.name));
    return foot ? leg.pos[1] + rotate(leg.quat, foot.head)[1] : 0.08;
  })();
  const spots: Spot[] = rowsMode
    ? rowSpots()
    : Array.from({ length: count }, (_, k) => {
        const at = (k * 2 * Math.PI) / count;
        return { x: radius * Math.sin(at), z: radius * Math.cos(at), yaw: at, row: 0, rank: k, mirror: (count - k) % count, roll: 0, lean };
      });
  /** 一个人自己的坐标 → 站在正前方、不转的一个人的位置（量芯子、摆胸照它算；围成一圈时就是第一个人） */
  const place0 = (p: V3): V3 => (rowsMode ? add(waist0, rotate(upQ, sub(p, waistC))) : add(add(rotate(leanQ, sub(p, pivot)), pivot), [0, 0, radius]));
  /** 一个人自己的坐标 → 第 k 个人的位置 */
  /** 第 k 个人整个怎么转：往背后靠、绕竖轴转到他朝的方向，前后排外面的人再往这一排的正中歪（绕世界的前后轴：在 +X 的往 −X 歪） */
  const turn = (k: number): Quat =>
    rowsMode
      ? // 前后排：先拧到他朝的方向，再整个往世界的前后靠（上下两截靠得一样，腰上不折），外面的上身再往这一排的正中歪
        quatMul(aboutZ(spots[k].roll), quatMul(aboutX(-spots[k].lean), aboutY(spots[k].yaw)))
      : quatMul(aboutZ(spots[k].roll), quatMul(aboutY(spots[k].yaw), aboutX(-spots[k].lean)));
  /** 前后排：第 k 份的腰的截面中心在世界里哪（下半截从髋关节起靠过去以后的） */
  // 腰在哪照下半截斜了多少算（下半截最多斜 ROWS.legLean，见 rowLegLean）；上身再绕腰多往背后靠一些
  const hipLean = (k: number) => (spots[k].half === 'upper' ? Math.sign(spots[k].lean) * Math.min(Math.abs(spots[k].lean), rowLegLean) : spots[k].lean);
  const waistAt = (k: number): V3 => add(add(rotate(aboutX(-hipLean(k)), sub(waistC, pivot)), pivot), [spots[k].x, spots[k].y ?? 0, spots[k].z]);
  const place = (p: V3, k: number): V3 =>
    rowsMode && spots[k].half === 'upper'
      ? // 上身：腰的截面中心落在下半截的腰上，绕它拧、歪
        add(waistAt(k), rotate(turn(k), sub(p, waistC)))
      : add(add(rotate(turn(k), sub(p, pivot)), pivot), [spots[k].x, spots[k].y ?? 0, spots[k].z]);
  // 外侧的上身向内歪时，头会绕腰下沉。沿脖子自己的轴略微伸长，缩小落差，脖子根仍在肩上。
  const neck = single && base.find((p) => p.name === single.neck.name);
  const neckBone = neck && neck.bones?.[0];
  const neckAxis = neckBone ? sub(neckBone.tail, neckBone.head) : null;
  const neckRise = (k: number) => Math.min(ROWS.neckLift, (1 - Math.cos(spots[k].roll)) * (headY - waist.y) * 0.8);
  /** 相邻两个人算成不同的两类融合 */
  // （前后排的上身：左右、前后挨着的不一样。用 torso、chest 两类，不用 leg：上身削掉腰以下是把那一类里腰以下的都挖掉，
  // 白模下身的腿算在 leg 那一类里，会跟着被挖掉；胸都坐在芯子上、算 lower 那一类，chest 这一类是空着的）
  const classAt = (k: number): PartType => (rowsMode ? ((spots[k].row + spots[k].rank) % 2 ? 'chest' : 'torso') : classOf(k, count));
  // 前后排的腿都朝正前
  const front = legFacing === 'front' || rowsMode;
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
  /** 前后排：下身的腿、腿上的骨骼照「第几副下身」编号（上身没有腿：这样第一副就是 Leg_01_L、UpperLeg_L，带骨骼导出、VRM 都认它） */
  const LEG_BONE = /^(UpperLeg|LowerLeg|Foot|Toes|Leg(Thumb|Index|Middle|Ring|Little|Finger[A-C])\d|Toe)/;
  const legIndex = (k: number) => spots[k]?.nth ?? k;
  const partName = (name: string, at: number): string => {
    const k = /^Leg_/.test(name) ? legIndex(at) : at;
    if (!k) return name;
    if (name === 'Torso') return `Torso_${letter(k)}`;
    const m = NUMBERED.exec(name);
    if (!m) return `${name}_${letter(k)}`;
    // 头上长的（眼睛、角、耳朵）跟着头的号：Head_01_Eye_01_L → Head_03_Eye_01_L
    return `${m[1]}_${String(Number(m[2]) + (last.get(m[1]) ?? 0) * k).padStart(2, '0')}${m[3]}`;
  };
  const boneName = (name: string, at: number): string => {
    const k = LEG_BONE.test(name) ? legIndex(at) : at;
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
  const center = rotate(quatConj(torso.quat), sub(unplace0([0, hipY, 0]), torso.pos));
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
    .slice(0, rowsMode ? 0 : Math.max(0, Math.min(1, armPairs)));
  /** 留下的手臂：「第几个人:哪条」→ 第几对（从 0 起）、朝哪（世界里） */
  const kept = new Map<string, { rank: number; dir: V3 }>();
  const drop = tPose ? ARM_DROP.T : ARM_DROP.A;
  const aim = (az: number, down: number): V3 => [Math.sin(az) * Math.cos(down), -Math.sin(down), Math.cos(az) * Math.cos(down)];
  const keep = (k: number, arm: Part, rank: number, dir: V3) => {
    kept.set(`${k}:${arm.name}`, { rank, dir });
    kept.set(`${spots[k].mirror}:${twinOf(arm)!.name}`, { rank, dir: [-dir[0], dir[1], dir[2]] });
  };
  /** 第 k 个人 side 这一边的几条手臂都留着，从上面看朝 az（π/2 是正侧面）；rank 从 first 起编 */
  const hang = (k: number, side: number, az: number, first: number) => {
    const column = arms
      .filter((arm) => arm.side === side && twinOf(arm))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, armPairs);
    const n = column.length;
    column.forEach((arm, i) => {
      const mid = i - (n - 1) / 2;
      if (n < 2) keep(k, arm, first + i, aim(az, drop));
      // 上下排：往下垂的时候下面的多垂一点、前后稍微错开；平举时都朝正侧面
      else if (stacked) keep(k, arm, first + i, tPose ? aim(az, 0) : aim(az - mid * ARM_STACK.splay, drop + i * ARM_STACK.drop));
      // 肩部扇形聚拢：上下扇开，举得高的在后、放得低的在前
      else {
        // 对称的两排照参考图上下打开。奇数人两组肩膀横向错位，低处的手腕容易被胸团埋住。
        const open = rowsMode && count % 2 === 0 && !tPose && legs.length <= 2 && n === 3;
        const up = open ? ROWS.armFanTop - (i * ROWS.armFanSpan) / (n - 1) : (tPose ? ARM_FAN.top.T : ARM_FAN.top.A) - i * Math.min(ARM_FAN.step, ARM_FAN.span / (n - 1));
        keep(k, arm, first + i, aim(az - mid * (tPose ? ARM_FAN.splay.T : ARM_FAN.splay.A), -up));
      }
    });
  };
  // 围成一圈：那个人这一边的几条手臂都留着，朝正侧面
  if (left.length) hang(left[0].k, left[0].arm.side, Math.PI / 2, 0);
  if (rowsMode && armPairs > 0) {
    // 前后排：每侧两组——前排最外面那个人朝外的肩膀上一组、后排最外面那个人朝外的肩膀上一组，接着往下编号。
    // 这两个人是斜着的，朝外的肩膀转到了侧面、前后交叉着挨在一起：肩膀靠前的那组往前偏，靠后的往后偏
    const outer = (row: number) =>
      spots
        .map((_, k) => k)
        .filter((k) => spots[k].half === 'upper' && spots[k].row === row)
        .sort((a, b) => spots[b].x - spots[a].x)[0];
    // 朝外（+X）的是这个人的哪一边：他自己的左手边转过去以后朝 (cos yaw, 0, −sin yaw)
    const outside = (k: number) => (Math.cos(spots[k].yaw) >= 0 ? 1 : -1);
    const shoulderZ = (k: number) => {
      const arm = arms.find((a) => a.side === outside(k) && native(a));
      return arm ? place(add(torso.pos, rotate(torso.quat, arm.pos)), k)[2] : spots[k].z;
    };
    const hosts2 = [outer(0), outer(1)].filter((k): k is number => k !== undefined);
    const frontmost = hosts2.length > 1 && shoulderZ(hosts2[1]) > shoulderZ(hosts2[0]) ? 1 : 0;
    hosts2.forEach((k, i) => hang(k, outside(k), Math.PI / 2 + (hosts2.length < 2 ? 0 : i === frontmost ? -ROWS.armAz : ROWS.armAz), i * armPairs));
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
      // 前后排：两头的人斜着 45°，朝外的肩膀转到了正侧面的正中，前后两组手臂的根挤在一处，像从两排人中间长出来的。
      // 整组往自己那排挪 armApart（前排的往前、后排的往后），根落在前后两个躯干各自的侧面上；空出来的肩膀口子垫圆肩头（见 stumpsOf）
      const apart = rowsMode ? rotate(quatConj(quatMul(turn(k), torso.quat)), [0, 0, spots[k].row === 1 ? -ROWS.armApart : ROWS.armApart]) : ([0, 0, 0] as V3);
      const made =
        pointArm(
          {
            ...rest,
            pos: add(rest.pos, apart),
            name: `Arm_${String(keep.rank + 1).padStart(2, '0')}_${arm.side < 0 ? 'R' : 'L'}`,
            parent: partName('Torso', k),
            ...(arm.bones ? { bones: arm.bones.map((b) => ({ ...b, name: rename(b.name), ...(b.parent ? { parent: rename(b.parent) } : {}) })) } : {}),
            ...(arm.grafts ? { grafts: arm.grafts.map((g) => ({ ...g, bones: Object.fromEntries(Object.entries(g.bones).map(([key, v]) => [key, rename(v)])), rigid: g.rigid.map(rename) })) } : {}),
          },
          local,
        );
      // 手臂挪开了，锁骨那根骨骼的起点还留在原来的地方（躯干里面）：跟着挪的话白模的起点露到身子外面
      const stay = rotate(quatConj(made.quat), mul(apart, 1 / (made.scale ?? 1)));
      return [rowsMode && made.bones?.length ? { ...made, bones: made.bones.map((b, n) => (n === 0 ? { ...b, head: sub(b.head, stay) } : b)) } : made];
    });
  /** 第 k 个人没留手臂的肩膀上垫的圆肩头（只有素体的躯干要） */
  const stumpsOf = (k: number): Prim[] =>
    sampled
      ? arms
          // 只有本来的肩膀上有接手臂的口子；别的几对是贴在身侧、挤在肩膀后面的，没留的不用垫
          .filter((arm) => native(arm) && (rowsMode || !kept.has(`${k}:${arm.name}`)))
          // 前后排的圆肩头小一点、往里收一点（ROWS.stump）：两头的人斜着，靠里的那个肩膀转到前后两面上，整个圆肩头露在外面，像肩膀上鼓出一坨
          .map((arm) => {
            const [size, inset] = rowsMode ? [ROWS.stump.size, ROWS.stump.inset] : [1, STUMP.inset];
            return { kind: 'ellipsoid', name: `Stump_${arm.side < 0 ? 'R' : 'L'}`, center: [arm.pos[0] - Math.sign(arm.pos[0]) * inset, arm.pos[1] - STUMP.drop, arm.pos[2]] as V3, radii: mul(STUMP.radii, size), soft: STUMP.soft };
          })
      : [];

  /** 腿统一朝前时（前后排也是），第 k 个人胯上接腿的口子里垫的圆头（第一个人的腿没转，不用） */
  const plugsOf = (k: number): Prim[] =>
    sampled && front && (k > 0 || rowsMode)
      ? legs.map((leg, i) => {
          const at = rotate(quatConj(torso.quat), sub(leg.pos, torso.pos));
          return { kind: 'ellipsoid', name: `Plug_${i + 1}`, center: [at[0], at[1] - HIP_PLUG.drop, at[2]], radii: HIP_PLUG.radii, soft: HIP_PLUG.soft };
        })
      : [];

  /* ---- 胸交错成串：每一圈多大、往上挪多少、隔一圈的绕圈心转多少 ---- */
  // 圈心那根竖轴在一个人躯干自己的坐标里：过哪一点、朝哪
  const back = quatConj(torso.quat);
  // （世界里过正中 (0, ·, 0) 的那根竖轴：支点不在髋关节那根竖线上时——前后排是绕腰的截面中心转的——要把它前后那一截也减掉）
  const axisAt = rotate(back, sub(unplace0([0, pivotY, 0]), torso.pos));
  const axisUp = rotate(back, rotate(quatConj(upQ), [0, 1, 0]));
  const rowOf = (p: Part) => Number(/^Chest_(\d+)/.exec(p.name)?.[1] ?? 1) - 1;
  const breasts = base.filter((p) => p.type === 'chest' && p.parent === 'Torso');
  const rowY: number[] = [];
  for (const p of breasts) rowY[rowOf(p)] = p.pos[1];
  /** 每个人一共几只 */
  const total = Math.max(0, Math.round(asked ?? breasts.length));
  // 每个人只有一两只时没有要错开的：照平常的摆，芯子也不用加粗。前后排的胸是整面一起排的，一只也照这样排
  const stagger = chest !== 'aligned' && breasts.length > 0 && (rowsMode ? total > 0 : total > 2);
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
      return Number.isFinite(z) ? Math.max(0.03, place0([0, y, z])[2] - CHEST_MARGIN - CHEST_SINK) : radius;
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
  /** 前后排：一面上最长的那一排几只（两面各一个：前面、后面） */
  const rowFirst = [2, 2];
  /** 前后排：每个人每排几只（chestPlan） */
  const perPerson = Array.from({ length: Math.ceil(total / Math.max(1, chestRow)) }, (_, k) => Math.min(chestRow, total - k * chestRow));
  /**
   * 前后排时前面那一面怎么排：每人每排几只 × 前排的人数（per 是那一排一共几只）；后面那一面照后排的人数排，见 faceChests。
   * 上下两排隔一只胸那么高（叠一点）
   */
  const packRows = (): Circle[] => {
    foot = footprint();
    const known = foot.wide > 0.01 && foot.tall > 0.01;
    let step = known ? foot.tall * CHEST_PACK.gap : CHEST_NEST.stagger * pitch;
    // 最下面一排的下沿不低过裆（髋关节以下 ROWS.chestFloor）：再低就盖到大腿上，前后排的大腿糊成一片（参考图里胸到裆为止、
    // 大腿一条条露着）。排不下就各排挨紧一点（一排压着一排，像瓦片），最紧到隔胸高的 ROWS.chestTight
    const rows = perPerson.length;
    const first = breasts.find((p) => rowOf(p) === 0) ?? breasts[0];
    if (known && rows > 1 && first) {
      const topY = place0(add(torso.pos, rotate(torso.quat, first.pos)))[1];
      const lowest = hipY - ROWS.chestFloor + foot.tall * 0.5;
      step = Math.min(step, Math.max(foot.tall * ROWS.chestTight, (topY - lowest) / (rows - 1)));
    }
    rowFirst[0] = Math.max(...perPerson) * frontCount;
    rowFirst[1] = Math.max(...perPerson) * (count - frontCount);
    return perPerson.map((n, r) => ({ drop: r * step, per: n * frontCount, size: 1 }));
  };
  const packed = stagger ? (rowsMode ? packRows() : packChest()) : [];
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
  const measured: { y: number; front: number; core: number; wide: number }[] = [];
  const levelAt = (y: number) => {
    if (!measured.length) return null;
    let i = 1;
    while (i < measured.length - 1 && measured[i].y < y) i++;
    const a = measured[Math.max(0, i - 1)];
    const b = measured[Math.min(measured.length - 1, i)];
    const t = b.y > a.y ? Math.max(0, Math.min(1, (y - a.y) / (b.y - a.y))) : 0;
    return { front: a.front + (b.front - a.front) * t, core: a.core + (b.core - a.core) * t, wide: a.wide + (b.wide - a.wide) * t };
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
  const strung = (p: Part, r: number, target: number, on?: { seat: number; face: number }): Part => {
    const size = packed[r].size;
    const shaped = p.prims.some((q) => q.kind === 'chest');
    // 这只胸现在从上面看偏在这个人正前方的哪一边、偏多少
    const own = add(torso.pos, rotate(torso.quat, p.pos));
    const at = place0(own);
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
    // （前后排：胸是整只往下搬的，不是沿着躯干表面往下挪，见下面 —— 表面照它原来那个高度量）
    const y = on ? own[1] : own[1] + lift[r];
    const surface = (x: number) => {
      const t = castRay(probe, [x, y, FAR], [0, 0, -1], 2 * FAR);
      return t < 2 * FAR ? FAR - t : own[2];
    };
    const under = place0([own[0], y, shaped ? surface(own[0]) : own[2]]);
    const far = Math.hypot(under[0], under[2]);
    const level = levelAt(under[1]);
    // 小胸少沉一点（见 CHEST_DEEP）：鼓出来够高的沉在芯子里面 CHEST_SINK，最平的胸根差不多到肚皮
    const bury = foot.deep > 0 ? Math.max(CHEST_BURY_LEAST, Math.min(1, (foot.deep * size) / CHEST_DEEP)) : 1;
    // 前后排的那一面不是圆的：坐在哪（离正中多远）、脸朝哪由 faceChests 算好了给进来
    const seat = on ? on.seat : (level ? level.core : far - CORE_MARGIN) + CHEST_MARGIN - (CHEST_MARGIN + CHEST_SINK) * bury;
    const face = on ? on.face : target;
    if (!shaped) {
      const lifted = add(p.pos, [axisUp[0] * lift[r], axisUp[1] * lift[r], axisUp[2] * lift[r]]);
      return { ...p, pos: outward(add(axisAt, rotate(about(target - now), sub(lifted, axisAt))), seat - far), quat: quatMul(about(face - now), p.quat), scale: (p.scale ?? 1) * size };
    }
    // 胸口那里的皮本来朝外偏着（facing）：转到脸朝正外
    const facing = Math.atan2(surface(own[0] - 0.02) - surface(own[0] + 0.02), 0.04);
    // 前后排：整只照它在胸口上的样子往下搬（沿圈心那根竖轴）。围成一圈时是沿着躯干表面往下挪的（ChestShape.shift），
    // 躯干照圈数加长过、每一圈离它照着做的那一排不远；前后排的躯干不加长，最下面一排要挪三十厘米到胯上，
    // 挪出了胸那片形状贴得上的范围，整只瘪下去、底下一圈毛边
    const carried = on ? add(p.pos, [axisUp[0] * lift[r], axisUp[1] * lift[r], axisUp[2] * lift[r]]) : p.pos;
    return {
      ...p,
      // 整只搬过来的胸（下面的 piece）不再贴着哪个人的胸口：手动微调照平常的部件挪、转、放大（不去掉这个标记的话套微调时整个跳过，挪不动）
      surface: false,
      pos: outward(add(axisAt, rotate(about(target - now), sub(carried, axisAt))), seat - far),
      quat: quatMul(about(face - facing), p.quat),
      fuseAs: 'lower',
      prims: p.prims.map((q) =>
        q.kind === 'chest'
          ? {
              ...q,
              piece: true,
              scale: [(q.scale?.[0] ?? 1) * size, (q.scale?.[1] ?? 1) * size, (q.scale?.[2] ?? 1) * size] as V3,
              shift: [q.shift?.[0] ?? 0, (q.shift?.[1] ?? 0) + (on ? 0 : lift[r]), q.shift?.[2] ?? 0] as V3,
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
    // 前后排：胸不跟着哪个人，整面一起排（见 faceChests）
    if (rowsMode) {
      strungParts = base.filter((p) => !breasts.includes(p));
      return strungParts;
    }
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
  /** 前后排：上身留下的部件是除了腿和腿上挂的；下身只留躯干、腿（和阴茎）；中间那一排的上身只留躯干（脖子、胸磨平，见 halved） */
  const LOWER = new Set<PartType>(['torso', 'lower', 'leg', 'genital']);
  const HOLLOW = new Set<PartType>(['torso']);
  const legged = new Set(base.filter((p) => p.type === 'leg' || p.type === 'genital').map((p) => p.name));
  for (const p of base) if (p.parent && legged.has(p.parent)) legged.add(p.name);
  const partsOf = (k: number): Part[] => {
    const half = spots[k].half;
    if (spots[k].hollow) return plain.filter((p) => HOLLOW.has(p.type));
    if (half === 'lower') return below.parts.filter((p) => LOWER.has(p.type));
    return half === 'upper' ? ownParts().filter((p) => !legged.has(p.name)) : ownParts();
  };
  /**
   * 前后排：第 k 份的躯干只留一半（世界里水平地削一刀；上身削掉腰以下，下身削掉腰以上）。
   * 削是把这一份所在的那一类融合里那一侧的都挖掉：上身、下身分在不同的类里（见 classAt 和下面的 fuseAs）
   */
  /**
   * 前后排、素体的下半截：相邻两条大腿之间切一道缝（ROWS.slit）。大腿加粗以后，自己的左右腿、旁边那个人的腿、前后排的腿静止时都贴着，
   * 融合成一块；摆姿势时素体的腿是先跟着胯融合、再照权重搬的（sdf/posedFuse.ts），贴着的那片皮同时带着两条腿的权重，
   * 腿一分开就被扯成一片蹼。切开以后看着还是贴在一起，其实是两块表面，摆姿势时各走各的。只切到髋关节以下 top 那么低，胯还连着。
   * 一刀是一个扁到只有缝那么厚的大椭球（引擎里没有平板），世界里的坐标；记在第一副下半截上（削的是下半截那一整类）。
   * 同一排左右相邻两条腿之间竖着切，前后两排之间横着切
   */
  const slits = (): { center: V3; radii: V3; quat: Quat; soft?: number }[] => {
    if (!rowsMode || !sampled) return [];
    const { gap, top, reach, skew, deep } = ROWS.slit;
    const high = hipY - top;
    // 只切大腿贴着的那一段：上沿在 high，下沿到膝盖再往下 reach（髋关节到脚踝的 ROWS.slit.knee 那么高）。
    // 以前一直切到地底下：小腿本来就不挨着，白白被削出一道平面（他问「为什么腿部被削平了」）
    const low = ankleY + (hipY - ankleY) * ROWS.slit.knee - reach;
    const cy = (high + low) / 2;
    const ry = (high - low) / 2;
    const lows = spots.map((s, k) => ({ s, k })).filter(({ s }) => s.half === 'lower');
    const out: { center: V3; radii: V3; quat: Quat; soft?: number }[] = [];
    let lines0 = 0;
    const lines = Math.max(...lows.map(({ s }) => s.line ?? 0)) + 1;
    for (let line = 0; line < lines; line++) {
      const mine = lows.filter(({ s }) => s.line === line);
      if (!mine.length) continue;
      const hips = mine.flatMap(({ k }) => legs.map((leg) => place(leg.pos, k))).sort((a, b) => a[0] - b[0]);
      const { k } = mine[0];
      lines0++;
      // 跟着这一排的腿一起斜（和 copy 里腿的 legQuat 一样转；前后两排往外斜，后排小腿肚伸出去十几厘米，竖着的刀够不着），
      // 再绕腿的方向斜 skew
      const tilt = ROWS.legsFollow ? spots[k].lean : 0;
      const along = quatMul(aboutY(spots[k].yaw), aboutX(-tilt));
      const turned = quatMul(along, aboutY(lines0 % 2 ? skew : -skew));
      for (let i = 1; i < hips.length; i++) {
        const mid: V3 = [(hips[i - 1][0] + hips[i][0]) / 2, hipY + (spots[k].y ?? 0), (hips[i - 1][2] + hips[i][2]) / 2];
        out.push({ center: add(mid, rotate(along, [0, cy - hipY, 0])), radii: [gap / 2, ry, deep], quat: turned });
      }
    }
    // 排与排之间不切：每一排的胯、臀、腰都是完整的（他说「三排胯每个胯的屁股都是完整的」，以彩色正面 + 侧面那张参考图为准）。
    // 前后相邻两排隔一副胯那么厚（见 rowDepth），屁股贴着后面那排的小腹，贴上的地方直接融在一起。
    // 试过又去掉的：两排正中一道 6 cm 的缝、贴着中间那排切、空当里放一道 1.4 cm 的薄刀——都是平的一刀，
    // 前面那排的屁股、后面那排的小腹最鼓的地方不在一个高度上（是错着嵌在一起的），平着切总要削平一块
    return out;
  };
  const halved = (k: number): Prim[] => {
    const half = spots[k].half;
    if (!half) return [];
    const own = half === 'lower' ? lowTorso : torso;
    const q = quatMul(turn(k), own.quat);
    const at = place(own.pos, k);
    // 在腰上接（世界里水平的一刀，过这一份的腰的截面中心）：上身留到腰以下一点，下身留到腰以上一点，叠着的那一小段圆滑地融合
    const mid = waistAt(k);
    // 两截各往对面多留多少：素体少留（见 ROWS.overlap），白模还照原来的
    const lap = sampled ? ROWS.overlap : ROWS.overlapMannequin;
    const level = half === 'upper' ? mid[1] - lap - 0.9 : mid[1] + lap + 0.9;
    const center = rotate(quatConj(q), sub([mid[0], level, mid[2]], at));
    const waist: Prim = { kind: 'ellipsoid', name: 'Half', center, radii: [2.5, 0.9, 2.5], quat: quatConj(q), cut: true, soft: spots[k].bare ? ROWS.bare : ROWS.seam };
    // 第一副下半截带着几刀缝（见 slits）
    if (half === 'lower' && spots[k].nth === 0) {
      const cuts = slits().map(({ center: c, radii, quat: turned, soft }, i): Prim => ({ kind: 'ellipsoid', name: `Slit_${i + 1}`, center: rotate(quatConj(q), sub(c, at)), radii, quat: quatMul(quatConj(q), turned), cut: true, soft: soft ?? ROWS.slit.soft, parting: true }));
      if (cuts.length) return [waist, ...cuts];
    }
    if (!spots[k].hollow || !stems.length) return [waist];
    // 中间那一排没有头：脖子根那里平着削掉、磨圆（他说「需要把脖颈和胸部磨平」）；胸见 copy 里换成平胸的那一句
    const collar = place([0, torso.pos[1] + Math.min(...stems.map((p) => p.pos[1])), torso.pos[2]], k)[1] - ROWS.collar;
    const above = rotate(quatConj(q), sub([spots[k].x, collar + 0.9, spots[k].z], at));
    return [waist, { kind: 'ellipsoid', name: 'Collar', center: above, radii: [2.5, 0.9, 2.5], quat: quatConj(q), cut: true, soft: ROWS.seam }];
  };
  const copy = (k: number): Part[] => [
    ...partsOf(k).map((given): Part => {
      // 腿先把脚转平，下面改名用转平以后的骨骼、接上去的脚
      const legAt = spots[k].yaw;
      // 腿跟着身子一起斜，脚在脚踝上转平。前后排：前后两排的人连腿一起往正中斜（spots[k].lean，后排是负的），中间一排直着
      const tilt = rowsMode ? (ROWS.legsFollow && spots[k].half === 'lower' ? spots[k].lean : 0) : lean;
      const thick = rowsMode && spots[k].half === 'lower' && given.type === 'leg' && !given.parent ? thighen(given) : given;
      let p: Part = thick.type === 'leg' && !thick.parent ? { ...thick, ...flatFoot(thick, footBack(thick, legAt, tilt)) } : thick;
      if (rowsMode && neck && neckAxis && (given === neck || given.name === single?.head.name)) {
        const extra = neckRise(k);
        if (extra > 1e-6) {
          const factor = extra / len(neckAxis);
          p = given === neck
            ? { ...given, resize: [1, 1 + factor, 1], axes: quatBetween([0, 1, 0], neckAxis) }
            : { ...given, pos: add(given.pos, mul(rotate(neck.quat, neckAxis), factor)) };
        }
      }
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
                quat: quatMul(legQuat(legAt, tilt + splay), p.quat),
              }
            : { pos: place(p.pos, k), quat: quatMul(turn(k), p.quat) }),
        // 坐在芯子上的胸挂在芯子上、跟着胯（不跟着哪个人的脊柱）
        ...(hipsInCore && onCore.has(p.name) ? { parent: 'Core', pos: place(add(torso.pos, rotate(torso.quat, p.pos)), k), quat: quatMul(quatMul(turn(k), torso.quat), p.quat) } : {}),
        ...(given === torso || given === lowTorso
          ? {
              prims: [
                // 中间那一排的躯干换成平胸的（素体的躯干上自带一点胸；白模的胸是单独的部件，本来就没带）
                ...p.prims.map((q): Prim => {
                  if (q.kind !== 'grid' || q.grid !== animeGrid('torso')) return q;
                  if (spots[k].hollow) return { ...q, morph: [animeGrid('torsoFlat'), 1] };
                  if (spots[k].half !== 'lower' || !spots[k].lean || ROWS.legsFollow) return q;
                  // 胯的下缘和直立的大腿沿用素体原来的接面，往上才随腰倾斜。
                  const joint = sub(pivot, p.pos);
                  return {
                    ...q,
                    fork: {
                      pivot: joint,
                      quat: turn(k),
                      shift: [0, 0, 0],
                      from: joint[1] + ROWS.pelvisRamp[0],
                      to: joint[1] + ROWS.pelvisRamp[1],
                      // 渐变写在这块格子里。整副胯被微调时，渐变一起移动，不重新锚到世界原点。
                      frame: { pos: [0, 0, 0], quat: Q_ID, scale: 1 },
                    },
                  };
                }),
                ...(spots[k].half === 'lower' ? [] : stumpsOf(k)),
                ...(rowsMode ? [] : plugsOf(k)),
                ...halved(k),
              ],
            }
          : {}),
        // 统一朝前的腿转了方向，和自己的胯对不齐：不和躯干直接取并集（接口是一圈锯齿），另算一类、圆滑地融合。
        // 第一个人本来就朝前，腿没转，还照原样直接取并集（圆滑地融合的话胯底下鼓起一道棱）
        ...(group === 'torso' ? { fuseAs: front && p.type === 'leg' && k > 0 && !rowsMode ? ('tail' as const) : classAt(k) } : {}),
        // 前后排的下身、中间那一排：下身都算 wing 那一类、中间那一排算 tail 那一类（围成一圈时没有翅膀、尾巴，这两类空着），
        // 同一类里互相直接取并集——胯和胯之间是一道清楚的缝。不能留在上身那两类里：上身削掉腰以下是把那一类里腰以下的都挖掉。
        // 素体的腿本来就和自己的胯直接取并集，跟着算进去；白模的腿还是自己那一类，和胯圆滑地融合
        ...((spots[k].half === 'lower' || spots[k].hollow) && (group === 'torso' || p.type === 'torso') ? { fuseAs: spots[k].hollow ? ('tail' as const) : ('wing' as const) } : {}),
        // 胸挤着旁边那个人是围成一圈本来的样子：不算穿模
        ...(p.type === 'chest' ? { rootFree: EMBEDDED } : {}),
        // 中间一排没有头的上身整个并在大家的上身里：两头那两个挨着手臂的根，不算穿模
        ...(spots[k].hollow && p.type === 'torso' ? { rootFree: EMBEDDED } : {}),
        // 外圈的腿也是：一个人并排的几条、相邻两个人挨着的那两条本来就挤着（圈紧的时候叠得更多）
        ...(p.type === 'leg' && !p.parent ? { rootFree: EMBEDDED, ringOf: partName('Torso', k) } : {}),
        // 上面没有人的胯（bare）：躯干不带脊柱，跟着胯（见 ROWS.bare）
        ...(p.bones ? { bones: spots[k].bare && p.type === 'torso' ? [] : p.bones.filter((b) => b.name !== 'Hips' || (k === 0 && !hipsInCore)).map(own) } : {}),
        ...(p.grafts ? { grafts: p.grafts.map((g) => ({ ...g, bones: Object.fromEntries(Object.entries(g.bones).map(([key, v]) => [key, boneName(v, k)])), rigid: g.rigid.map((n) => boneName(n, k)) })) } : {}),
      };
    }),
    ...armsOf(k),
  ];

  /* ---- 圈心的芯子：照一个人的后背、肚皮各离圈心多远量 ---- */
  const necks = base.filter((p) => p.type === 'neck' && p.parent === 'Torso');
  const top = torso.pos[1] + (necks.length ? Math.min(...necks.map((p) => p.pos[1])) : headY - hipY) - 0.02;
  const rings: Ring[] = [];
  // 前后排：芯子从腰往上才有（腰上那条接缝再高 ROWS.coreWaist）。排与排之间的缝切到腰以后，伸到腰以下的那一截从缝里露出来，
  // 侧面看是腰底下挂着的一块方板、一条小舌头
  const coreStart = rowsMode ? Math.max(hipY + ROWS.coreFrom, Math.max(...spots.map((s, k) => (s.half === 'upper' ? waistAt(k)[1] : -Infinity))) + ROWS.coreWaist) : 0;
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
    const f = place0([0, y, front]);
    const b = place0([0, y, back]);
    // 各有各的胯：到肩膀渐渐粗到和并胯融合的一样
    const ramp = (from: number, length: number) => {
      const t = Math.max(0, Math.min(1, (y - torso.pos[1] - from) / length));
      return t * t * (3 - 2 * t);
    };
    // 有胸的那一段（交错成串时）：两种模式都粗到差一点到肚皮
    // 前后排：只到最上面一排胸的中心再往上 ROWS.coreTop，再往上 CHEST_ZONE.ramp 这么长渐渐变回平常的粗细——
    // 一直粗到肩膀的话，后排几个人往中间靠、肩膀之间是凹的，芯子在肩膀一圈鼓出一圈疙瘩
    const zone =
      chestFrom === null
        ? 0
        : ramp(chestFrom - CHEST_ZONE.ramp, CHEST_ZONE.ramp) * (rowsMode && rowY.length ? 1 - ramp(rowY[0] + ROWS.coreTop, CHEST_ZONE.ramp) : 1);
    // 前后排和各有各的胯一样：腰那一段芯子是细的，每个人自己的腰看得出来
    const up = mode === 'fused' ? 1 : Math.max(zone, shoulderY === null ? 1 : ramp(shoulderY - CORE_SHOULDER, CORE_SHOULDER));
    const full = f[2] - (CORE_MARGIN + (CHEST_MARGIN - CORE_MARGIN) * zone);
    const thin = b[2] + (f[2] - b[2]) * CORE_HIPS;
    const r = thin + (full - thin) * up;
    // 髋关节以下渐渐收细（见 CORE_UNDER）
    if (rowsMode) {
      // 前后排：胸排在哪照没收细的宽、厚定方向（measured 记没收细的，下面磨平以后也不照芯子改回去）；
      // 芯子从髋关节以上 ROWS.coreFrom 才有，往下是三排分开的胯
      const reachFull =
        Math.max(...spots.map((s, k) => (s.half === 'upper' ? Math.abs(place([0, y, front], k)[0]) : 0))) - (CORE_MARGIN + (CHEST_MARGIN - CORE_MARGIN) * zone);
      measured.push({ y: f[1], front: f[2], core: Math.max(0.03, r), wide: Math.max(0.03, thin + (Math.max(full, reachFull) - thin) * up) });
      if ((f[1] + b[1]) / 2 < coreStart) continue;
    }
    const under = rowsMode
      ? Math.min(1, Math.max(0, (coreStart + ROWS.coreRamp - (f[1] + b[1]) / 2) / ROWS.coreRamp))
      : Math.min(1, Math.max(0, (hipY - (f[1] + b[1]) / 2) / CORE_UNDER.drop));
    const slim = r * (1 + (CORE_UNDER.keep - 1) * under * under * (3 - 2 * under));
    // 前后排的芯子是扁的：前后照正前方那个人的肚皮，左右照最外面那个人的肚皮
    const reach = rowsMode
      ? Math.max(...spots.map((s, k) => (s.half === 'upper' ? Math.abs(place([0, y, front], k)[0]) : 0))) - (CORE_MARGIN + (CHEST_MARGIN - CORE_MARGIN) * zone)
      : r;
    // 左右也是从细到粗：细的时候和前后一样细，粗的时候到最外面那个人的肚皮
    const slimWide = (thin + (Math.max(full, reach) - thin) * up) * (slim / Math.max(1e-6, r));
    rings.push({ y: (f[1] + b[1]) / 2, w: Math.max(0.03, slimWide), d: Math.max(0.03, slim), z: 0 });
    if (!rowsMode) measured.push({ y: f[1], front: f[2], core: Math.max(0.03, slim), wide: Math.max(0.03, slimWide) });
  }
  hipsInCore = rings.length > 1 && hips !== undefined;
  const parts = spots.map((_, k) => copy(k));
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
      const wasW = rings.map((ring) => ring.w);
      const wasD = rings.map((ring) => ring.d);
      for (let i = 1; i < rings.length - 1; i++) {
        rings[i].w = (wasW[i - 1] + 2 * wasW[i] + wasW[i + 1]) / 4;
        rings[i].d = (wasD[i - 1] + 2 * wasD[i] + wasD[i + 1]) / 4;
      }
    }
    if (!rowsMode) {
      rings.forEach((ring, i) => {
        if (measured[i]) measured[i].wide = ring.w;
        if (measured[i]) measured[i].core = ring.d;
      });
    }
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
    if (!innerLegs || rowsMode) return [];
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

  /* ---- 前后排：前后两面的胸 ---- */
  /**
   * 整面一起排，不跟着哪个人：那一面照芯子那个高度上的椭圆（左右宽、前后扁），从正中往两头照弧长等间隔排，
   * 每只坐在椭圆上、脸朝椭圆的外法线（正中的朝正前，两头的朝斜外）。几排几只见 packRows；挂在芯子上跟着胯
   */
  const faceChests = (): Part[] => {
    if (!rowsMode || !stagger || !packed.length) return [];
    const made = new Map<string, number>();
    const world = quatMul(upQ, torso.quat);
    const bury = foot.deep > 0 ? Math.max(CHEST_BURY_LEAST, Math.min(1, (foot.deep * packed[0].size) / CHEST_DEEP)) : 1;
    const sink = CHEST_MARGIN - (CHEST_MARGIN + CHEST_SINK) * bury;
    // 每只胸坐在身体实际的表面上：从外面朝正中那根竖轴打一条线，碰到的第一层躯干。
    // 光照椭圆摆的话，两边斜着的人比椭圆鼓，下面几排的胸陷在他们身子里
    // 连大腿一起量：胸多的时候最下面几排排到髋关节以下，那里的表面是大腿。只量躯干的话照椭圆估，腿差不多是直的以后
    // （见 ROWS.legLean）大腿比估的靠里，小胸浮在大腿前面、掉成一颗颗单独的
    // 同一排相邻两人腰之间填的那块（rowFill）也算：不算的话腰那么高的地方人和人之间一直空到中间那排，
    // 胸底的垫子照「空多少填多少」把这一整段填成一大块，底下齐着裆削平——胸和胯之间多出一个台子
    const shell = compileField(
      { scale: 1, parts: [...parts.flat().filter((p) => (/^Torso/.test(p.name) || p.name === 'Core' || p.type === 'leg') && !p.parent), ...rowFill().map((p) => ({ ...p, parent: undefined }))] },
      { blend: 0 },
    );
    const REACH = 1.2;
    const surfaceAt = (x: number, y: number, z: number): number | null => {
      const far = Math.hypot(x, z) || 1;
      const t = castRay(shell, [(x / far) * REACH, y, (z / far) * REACH], [-x / far, 0, -z / far], REACH);
      return t < REACH - 1e-3 ? REACH - t : null;
    };
    /** 胸底的垫子（见 ROWS.pad）：世界里的椭球，挂在芯子上 */
    const pads: Prim[] = [];
    const chests = [1, -1].flatMap((side) => {
      // 交错成串：隔一排错开半只（砖墙那样），错开的那排少一只，正好嵌在上面一排两只之间（6、5、6）。
      // 交错渐小：一排比一排少一只、每排都嵌在上面一排两只之间，上宽下尖的一串（6、5、4；参考图是这样的）
      const counts = (side > 0 ? packed.map((ring) => ring.per) : perPerson.map((n) => n * (count - frontCount))).map((n, r, all) =>
        chest === 'taper' ? Math.max(1, Math.min(n, all[0] - r)) : r % 2 && n > 1 ? n - 1 : n,
      );
      /** 第 r 排那个高度上这一面的样子：椭圆、弧长、身体表面那一层 */
      const geom = (r: number) => {
        const row = breasts.filter((p) => rowOf(p) === hosts[r]);
        const isLeft = (p: Part) => add(torso.pos, rotate(torso.quat, p.pos))[0] > 0;
        const lefts = row.find(isLeft) ?? row[0];
        const rights = row.find((p) => !isLeft(p)) ?? row[0];
        // 这一排的高度上芯子多宽、多扁
        const own = add(torso.pos, rotate(torso.quat, lefts.pos));
        const rowHeight = place0([own[0], own[1] + lift[r], own[2]])[1];
        const level = levelAt(rowHeight);
        const w = level ? level.wide : radius * 2;
        const d = level ? level.core : radius;
        // 那一面从上面看是「方一点的椭圆」（见 ROWS.square）：从正前（t = 0）到正侧面（t = π/2）的弧长表
        const bend = 2 / ROWS.square;
        const at = (t: number): [number, number] => [w * Math.sin(t) ** bend, d * Math.cos(t) ** bend];
        const STEPS = 64;
        const along: number[] = [0];
        for (let i = 1; i <= STEPS; i++) {
          const a = at(((i - 1) / STEPS) * (Math.PI / 2));
          const b = at((i / STEPS) * (Math.PI / 2));
          along.push(along[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
        }
        const half = along[STEPS];
        const wraps = ROWS.cover;
        // 最外面那只不越过侧面正中：它的后沿（照胸宽算）离正中那个竖面至少 ROWS.flank。越过去的话前后两面最上面一排在侧面
        // 连成一条带子，把两排人的后背、手臂的根全盖住（参考图里侧面中间露着后背和手臂）。排不下就整排挤紧一点
        const reachZ = (i: number) => {
          const t = (i / STEPS) * (Math.PI / 2);
          const on = at(t);
          const n = norm2((on[0] / w) ** (ROWS.square - 1) / w, (on[1] / d) ** (ROWS.square - 1) / d);
          return on[1] - 0.5 * foot.wide * packed[0].size * Math.abs(n[0]);
        };
        let last = STEPS;
        while (last > 0 && reachZ(last) < ROWS.flank) last--;
        const most = rowFirst[side > 0 ? 0 : 1];
        const slot = Math.min((2 * half * wraps) / most, most > 1 ? along[last] / ((most - 1) / 2) : Infinity);
        /** 沿着那一面离正中 s 远（弧长，带左右的正负）的那一点：在椭圆上的位置、外法线 */
        const pointAt = (s: number) => {
          const far = Math.min(Math.abs(s), half);
          let i = 1;
          while (i < STEPS && along[i] < far) i++;
          const t = ((i - 1 + (along[i] > along[i - 1] ? (far - along[i - 1]) / (along[i] - along[i - 1]) : 0)) / STEPS) * (Math.PI / 2);
          const on = at(t);
          const way = Math.sign(s) || 1;
          // 外法线：|x/w|^p + |z/d|^p 的梯度
          return { x: way * on[0], z: side * on[1], normal: norm2((way * (on[0] / w) ** (ROWS.square - 1)) / w, (side * (on[1] / d) ** (ROWS.square - 1)) / d) };
        };
        // 这一排坐在哪：几个身子外面包的一层。沿这一面密密地量身体表面离正中多远，每一处取附近（大半只胸宽以内）最鼓的，再磨平——
        // 人和人之间的沟就被跨过去了，整团胸连成一片；直接照量到的坐的话，沟里的胸陷下去，一团胸散成一颗颗的
        const SAMPLES = 49;
        const span = half * wraps;
        const gauge = Array.from({ length: SAMPLES }, (_, i) => {
          const q = pointAt(-span + (2 * span * i) / (SAMPLES - 1));
          const out = Math.hypot(q.x, q.z) || 1;
          return Math.max(out * 0.6, surfaceAt(q.x, rowHeight, q.z) ?? out);
        });
        // 附近多远以内：一只胸那么宽（左右各半只）。照两只之间的间隔取的话，小胸、间隔大的时候够不着那么远，浮在沟上
        const reachOf = Math.max(1, Math.round((foot.wide * packed[0].size * 0.5) / ((2 * span) / (SAMPLES - 1))));
        const near = (list: number[], i: number) => list.slice(Math.max(0, i - reachOf), i + reachOf + 1);
        /** 胸那么宽的范围里身体表面最鼓的那一处：胸坐在它上面就碰得到身子 */
        const touch = gauge.map((_, i) => Math.max(...near(gauge, i)));
        let hull = touch.slice();
        for (let pass = 0; pass < 2; pass++) hull = hull.map((_, i) => near(hull, i).reduce((sum, v) => sum + v, 0) / near(hull, i).length);
        // 磨平会把鼓的地方削低：不能比那里的身体表面还低，不然小胸整只埋在身子里
        hull = hull.map((v, i) => Math.max(v, gauge[i]));
        const lerpAt = (list: number[], s: number) => {
          const u = Math.max(0, Math.min(SAMPLES - 1, ((s + span) / (2 * span)) * (SAMPLES - 1)));
          const i = Math.min(SAMPLES - 2, Math.floor(u));
          return list[i] + (list[i + 1] - list[i]) * (u - i);
        };
        // 跨在沟上的胸照外面那一层坐（整团连成一片），可比它自己那么宽的范围里最鼓的表面最多高出胸厚的 SPAN 那么多：
        // 再高就碰不到身子、浮在沟上。照正下方那一点量的话，正下方是沟的大胸整只沉进沟里、被两边的挡住
        const hullAt = (s: number) => Math.min(lerpAt(hull, s), lerpAt(touch, s) + foot.deep * packed[0].size * ROWS.span);
        /** 椭圆上左右离正中 x 那一点的弧长（带正负）；比这一排的椭圆宽的就在正侧面 */
        const sOfX = (x: number) => {
          const t = Math.asin(Math.min(1, (Math.abs(x) / w) ** (1 / bend)));
          const u = (t / (Math.PI / 2)) * STEPS;
          const i = Math.min(STEPS - 1, Math.floor(u));
          return (Math.sign(x) || 1) * (along[i] + (along[i + 1] - along[i]) * (u - i));
        };
        return { lefts, rights, pointAt, sOfX, slot, hullAt, rowHeight, gaugeAt: (s: number) => lerpAt(gauge, s) };
      };
      // 各排照最上面那一排定左右位置（每一列上下对齐）：各排照自己那个高度的宽度排的话，腰上那排挤成一团、
      // 胯上那排最宽、两头的绕到侧面吊在身子外面，上下对不齐
      const top = geom(0);
      const faces = counts.map((_, r) => (r ? geom(r) : top));
      const tuck = Math.min(ROWS.tuck, foot.deep * packed[0].size * 0.3);
      /**
       * 第 r 排从正中数第 u 只（可以是半只）坐在哪：at 是这一排椭圆上的位置，reach 是胸根离正中那根竖轴多远。
       * - 左右照最上面那排那一只实际落在的地方。胸是从正中那根竖轴往外推到身体表面的，推得远的排（胯上、后排往后斜的下半截）
       *   左右也跟着撑开：只对椭圆上的位置的话，同一列在腰上挤、在胯上散开，中间空出档；
       * - 离竖轴多远跟着上面一排走（见 ROWS.profile）：各坐各的表面的话，背面那一面腰上那排陷在腰窝里、最下面那排坐在
       *   后排人的屁股上（腿都朝前，屁股朝后）比上面多突出十厘米，三排成了三级台阶，不是一团
       */
      type Seat = { at: number; reach: number };
      const memo = [0, 1].map(() => faces.map(() => new Map<number, Seat>()));
      /** 在第 r 排上找左右落在 wanted 的那一点：离竖轴多远由 root 给（跟着位置变） */
      const settle = (r: number, start: number, wanted: number, root: (at: number) => number): Seat => {
        let at = faces[r].sOfX(start);
        for (let pass = 0; pass < 4; pass++) {
          const q = faces[r].pointAt(at);
          at = faces[r].sOfX((wanted * (Math.hypot(q.x, q.z) || 1)) / Math.max(0.01, root(at)));
        }
        return { at, reach: root(at) };
      };
      /** 从上往下一排一排定：比上面一排最多多突出 out、最多缩进 back */
      const capped = (r: number, u: number): Seat => {
        const known = memo[0][r].get(u);
        if (known) return known;
        const first = top.pointAt(u * top.slot);
        const own = (at: number) => faces[r].hullAt(at) + sink - tuck;
        let found: Seat = { at: top.sOfX(first.x), reach: own(top.sOfX(first.x)) };
        if (r) {
          const wanted = (first.x / (Math.hypot(first.x, first.z) || 1)) * capped(0, u).reach;
          const above = capped(r - 1, u).reach;
          found = settle(r, first.x, wanted, (at) => Math.max(above - ROWS.profile.back, own(at) - Math.max(0, foot.deep * packed[0].size - ROWS.profile.show) * ROWS.profile.bury, Math.min(above + ROWS.profile.out, own(at))));
        }
        memo[0][r].set(u, found);
        return found;
      };
      /** 夹在中间的排不比上下两排连成的线凹：凹的垫起来（底下空的由胸底垫上） */
      const seat = (r: number, u: number): Seat => {
        const known = memo[1][r].get(u);
        if (known) return known;
        let found = capped(r, u);
        if (r > 0 && r < faces.length - 1) {
          const bridge = (capped(r - 1, u).reach + capped(r + 1, u).reach) / 2;
          if (bridge > found.reach) {
            const first = top.pointAt(u * top.slot);
            found = settle(r, first.x, (first.x / (Math.hypot(first.x, first.z) || 1)) * capped(0, u).reach, () => bridge);
          }
        }
        memo[1][r].set(u, found);
        return found;
      };
      return counts.flatMap((n, r) => {
        const { lefts, rights, pointAt, rowHeight, gaugeAt } = faces[r];
        // 胸底：这一排从第一只到最后一只，每半只的间隔量一下真的身体表面到胸根有多空，空的（人和人之间的沟、
        // 跨在沟上的胸底下）垫一个扁圆块，正好填满这一段；身子本来就鼓到胸根的地方不垫（垫了小胸就被盖住）。最下面一排再往下托半排
        const size = packed[0].size;
        const [padW, padH] = [foot.wide * size * ROWS.pad.wide, foot.tall * size * ROWS.pad.tall];
        const lowest = r === counts.length - 1;
        // 垫子也不低过裆：低过去的那一截垫在大腿前面，把几条大腿连成一块平板
        const floorY = hipY - ROWS.chestFloor;
        const tall = Math.min(padH, rowHeight - floorY);
        for (let h = 0; tall >= 0.02 && h < 2 * n - 1; h++) {
          const { at, reach: rooted } = seat(r, h / 2 - (n - 1) / 2);
          const q = pointAt(at);
          const out = Math.hypot(q.x, q.z) || 1;
          const front = rooted - ROWS.pad.behind;
          if (lowest) {
            // 只垫在每只胸自己后面（两只之间的不垫）：小胸之间垫了的话，一片片斜着的垫子露在外面像鱼鳍
            if (h % 2) continue;
            // 最下面一排：垫子是一块斜着的——上头贴着胸根，下头收到裆那么高的身体表面上，像胸底下那道往肚子收的褶。
            // 竖着垫的话，胸根比底下的肚子、裆靠前好几厘米，一排垫子连成一条底下削平的板，胸和胯之间多出一个台子
            // 不伸出这只胸自己的范围：下头只到胸的下沿以里，往里收也不超过胸鼓出来那么多——小胸的话收得又长又深，
            // 两头的垫子像两片耳朵支在外面
            const [topY, lowY] = [rowHeight + tall * ROWS.pad.rampTop, Math.max(floorY, rowHeight - foot.tall * size * 0.45)];
            const body = surfaceAt(q.x, lowY, q.z);
            if (body === null) continue;
            const [rTop, rLow] = [front, Math.max(Math.min(front, body - ROWS.pad.rampInto), front - Math.max(0.03, foot.deep * size))];
            if (rTop - rLow < ROWS.pad.least) continue;
            const mid = (rTop + rLow) / 2 - ROWS.pad.rampThick;
            pads.push({
              kind: 'ellipsoid',
              name: `Pad_${pads.length + 1}`,
              center: [(q.x / out) * mid, (topY + lowY) / 2, (q.z / out) * mid],
              radii: [foot.wide * size * 0.4, Math.hypot(topY - lowY, rTop - rLow) / 2 + ROWS.pad.rampThick, ROWS.pad.rampThick],
              quat: quatMul(aboutY(Math.atan2(q.x, q.z)), aboutX(Math.atan2(rTop - rLow, topY - lowY))),
              soft: ROWS.pad.soft,
            });
            continue;
          }
          // 垫子最厚 ROWS.pad.most：后面空得再多（量不到身子的地方）也只垫这么厚，贴着胸根，不往里填成一大块
          const back = Math.max(gaugeAt(at) - ROWS.pad.into, front - ROWS.pad.most);
          if (front - back < ROWS.pad.least + ROWS.pad.into) continue;
          const mid = (front + back) / 2;
          pads.push({
            kind: 'ellipsoid',
            name: `Pad_${pads.length + 1}`,
            center: [(q.x / out) * mid, rowHeight, (q.z / out) * mid],
            radii: [padW, tall, Math.max(0.005, (front - back) / 2)],
            quat: aboutY(Math.atan2(q.normal[0], q.normal[1])),
            soft: ROWS.pad.soft,
          });
        }
        return Array.from({ length: n }, (_, j): Part => {
          const { at: s, reach } = seat(r, j - (n - 1) / 2);
          // 椭圆只管它在哪个方向上、脸朝哪；离正中多远照那一层外形
          const q = pointAt(s);
          const normal = q.normal;
          const out = Math.hypot(q.x, q.z) || 1;
          const x = (q.x / out) * reach;
          const z = (q.z / out) * reach;
          // 照这个人自己的左右取样子：前面的在 +X 的是左胸，后面那排的人脸朝后，在 −X 的是左胸
          const p = side * x > 1e-9 ? lefts : rights;
          const part = strung(p, r, Math.atan2(x, z), { seat: Math.hypot(x, z), face: Math.atan2(normal[0], normal[1]) });
          const tail = x > 1e-9 ? '_L' : '_R';
          const number = (made.get(tail) ?? 0) + 1;
          made.set(tail, number);
          const { parent: _parent, ...rest } = part;
          return {
            ...rest,
            name: 'Chest_' + String(number).padStart(2, '0') + tail,
            ...(hipsInCore ? { parent: 'Core' } : {}),
            pos: place0(add(torso.pos, rotate(torso.quat, part.pos))),
            quat: quatMul(world, part.quat),
            // 上身用 chest 组裁掉腰以下；两面的整团胸和芯子一组，不能被上身的切面削平。
            fuseAs: 'lower',
            rootFree: EMBEDDED,
          };
        });
      });
    });
    if (!pads.length) return chests;
    // 挂在芯子上（跟着胯）；和芯子、胸一组，垫子之间、和胸之间圆滑地融
    const pad: Part = { name: 'ChestPad', type: 'lower', side: 0, ...(hipsInCore ? { parent: 'Core' } : {}), pos: [0, 0, 0], quat: [0, 0, 0, 1], material: 'clay', fuseAs: 'lower', rootFree: EMBEDDED, prims: pads };
    return [...chests, pad];
  };

  /* ---- 落到地上，量身高 ---- */
  /**
   * 前后排：同一排左右相邻两个人的腰之间是空的（胯挨着胯、肋挨着肋，腰细，中间漏一个透光的洞）。每个洞里填一块竖着的扁肉
   * （见 ROWS.fill）：比两边的腰薄一点，左右伸进两边的腰里，上下从胯到肋。挂在芯子上跟着胯，和芯子、胸一类
   */
  const rowFill = (): Part[] => {
    if (!rowsMode) return [];
    const lows = spots.map((s, k) => ({ s, k })).filter(({ s }) => s.half === 'lower' && !s.bare);
    const fills: Prim[] = [];
    for (const line of new Set(lows.map(({ s }) => s.line ?? 0))) {
      const row = lows.filter(({ s }) => (s.line ?? 0) === line).sort((a, b) => a.s.x - b.s.x);
      for (let i = 1; i < row.length; i++) {
        const [a, b] = [waistAt(row[i - 1].k), waistAt(row[i].k)];
        const gap = Math.abs(b[0] - a[0]) - 2 * waist.half;
        if (gap < ROWS.fill.least) continue;
        fills.push({
          kind: 'ellipsoid',
          name: `Fill_${fills.length + 1}`,
          center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + ROWS.fill.lift, (a[2] + b[2]) / 2],
          radii: [gap / 2 + waist.half * ROWS.fill.into, ROWS.fill.tall, waist.deep * ROWS.fill.deep],
          quat: aboutX(-(row[i - 1].s.lean + row[i].s.lean) / 2),
          soft: ROWS.fill.soft,
        });
      }
    }
    if (!fills.length) return [];
    return [{ name: 'RowFill', type: 'lower', side: 0, ...(hipsInCore ? { parent: 'Core' } : {}), pos: [0, 0, 0], quat: [0, 0, 0, 1], material: 'clay', fuseAs: 'lower', rootFree: EMBEDDED, prims: fills }];
  };
  let out = [...parts.flat(), ...innerLegParts(), ...faceChests(), ...rowFill()];
  const ground = lowest(out);
  out = out.map((p) => (p.parent ? p : { ...p, pos: [p.pos[0], p.pos[1] - ground, p.pos[2]] as V3 }));
  const height = highest(out) * figure.scale;
  return {
    figure: { ...figure, parts: out, metrics: { ...figure.metrics, height, headRatio: height / figure.metrics.headHeight } },
    // 摆位该照几排胸摆：最下面一圈比第一圈低几个排距，躯干就加长几排
    chest: stagger && !rowsMode ? { rows: 1 + (circles > 1 && pitch > 0 ? Math.max(1, Math.round(drops[circles - 1] / pitch)) : 0), per: packed.map((ring) => ring.per), ...foot } : null,
  };
}
