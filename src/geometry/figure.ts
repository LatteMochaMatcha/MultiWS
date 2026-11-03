/**
 * Figure —— 摆位的结果：一串部件实例，每个部件由几种基本体组成。
 * 纯数据，可 JSON 化。分部件网格、融合网格（SDF）、骨骼、穿模检查都从这里读。
 *
 * 约定：Y 朝上，角色面朝 +Z，side = 1 是角色自己的左手边（+X）。
 * 基本体写在部件自己的局部坐标里；部件的 pos / quat / scale 是相对父部件的摆放。
 * 乘上 Figure.scale 之后单位是米。
 */
import { t } from '../i18n';
import type { LegForm } from '../model/spec';
import type { Stretch } from '../sdf/stretch';
import { type Mat3, type Quat, type V3, add, mat3Apply, mat3Mul, mul, quatMul, rotate, scaleAlong } from './vec';

export type PartType =
  | 'torso'
  | 'neck'
  | 'head'
  | 'eye'
  | 'horn'
  | 'ear'
  | 'hair'
  | 'arm'
  | 'chest'
  | 'wing'
  | 'leg'
  | 'lower'
  | 'tail'
  | 'genital';

export type Side = 0 | 1 | -1;
export type Material = 'clay' | 'eye' | 'wing';

/**
 * 「体块」的两个可选属性，只在融合网格里起作用：
 * soft —— 这块东西不是硬接上去，而是以这个半径圆滑地融进同类部件（小腿肚、臀、下巴）；
 * cut  —— 这块东西是挖掉的（眼窝），挖出的边缘同样按 soft 的半径倒圆。分部件模式下不显示。
 * fade —— soft 只在根部管用：离部件原点（关节）from 以内按 soft 的半径融，往外越来越小，到 to 就是硬接（或者 rest 那么大的圆角）。
 *         聚在同一个肩膀上的几条手臂用它：根部互相融成一片，伸出去以后还是各是各的，不会粘成蹼。
 */
interface Mass {
  soft?: number;
  cut?: boolean;
  /** [from, to, rest]：rest 是出了 to 以后的圆角（缺省 0，硬接） */
  fade?: [from: number, to: number, rest?: number];
  /** fade 的范围以部件里的这一点为中心（部件自己的坐标），不给就是部件的原点（关节） */
  fadeAt?: V3;
}

/** 椭球 */
export interface Ellipsoid extends Mass {
  kind: 'ellipsoid';
  name: string;
  center: V3;
  radii: V3;
  quat?: Quat;
}

/** 圆台，两端各带一个球：a 端半径 ra，b 端半径 rb */
export interface Cone extends Mass {
  kind: 'cone';
  name: string;
  a: V3;
  b: V3;
  ra: number;
  rb: number;
}

/** 沿曲线渐细的管（尾巴、角）：半径从 r0 到 r1，中段再鼓出 bulge；两端有球封口 */
export interface Tube {
  kind: 'tube';
  name: string;
  points: V3[];
  r0: number;
  r1: number;
  bulge: number;
}

/** 躯干的一圈椭圆截面：高度 y，半宽 w，半厚 d，前后偏移 z */
export interface Ring {
  y: number;
  w: number;
  d: number;
  z: number;
}

/** 一摞椭圆截面放样出来的躯干 */
export interface Loft {
  kind: 'loft';
  name: string;
  rings: Ring[];
  /** 从胯往上渐渐分开（好几个上半身），见 sdf/fork.ts */
  fork?: Fork;
}

/** 翅膀：一片有厚度的轮廓，翼根在局部原点，向 side 一侧展开 */
export interface Wing {
  kind: 'wing';
  name: string;
  side: 1 | -1;
  size: number;
  thickness: number;
}

/**
 * 一块采样好的形状（从现成的模型加工来的距离场，见 sdf/grids.ts），按名字引用。
 * 这块形状自己的坐标就是部件的坐标：原点一般在关节上。
 */
export interface GridShape extends Mass {
  kind: 'grid';
  name: string;
  /** 登记时用的名字，例如 anime/arm */
  grid: string;
  /** 左右镜像：右手、右腿用左边那一份翻过来 */
  mirror?: boolean;
  /** 把 [from, to] 这一段沿 Y 拉长 extra，上面的部分整体上移（多排手臂、多排胸时加长胸腔）；第四个数是两头渐变多长（见 sdf/stretch.ts） */
  stretchY?: Stretch;
  /** 只留下 x ≥ clipX 的部分（镜像之前的坐标）：手臂接在别处时，把连着肩膀的那一圈切掉 */
  clipX?: number;
  /** 只留下 y ≥ clipBelow 的部分：腿只留最上面一截（素体单足时胯底下的两个腿根） */
  clipBelow?: number;
  /** 只留下 y ≤ clipAbove 的部分：好几个上半身时，躯干只留腰以下那一截（见 torsos.ts） */
  clipAbove?: number;
  /** 切口的棱倒多大的圆角。不给就是一刀切平，切口斜着擦过表面的地方会留下一片薄薄的毛边 */
  clipRound?: number;
  /** 只留下 x ≤ clipTo 的部分（镜像、弯之前的坐标）：手另外用现成的网格接（见 Part.grafts），手臂切到手腕外面一点为止 */
  clipTo?: number;
  /** 弯一下（手肘）：从 (x, z) 这根竖轴往外的部分绕它往前转 angle 弧度，轴两边各 width 宽平滑过渡 */
  bend?: [x: number, z: number, angle: number, width: number];
  /** 和另一块一模一样大小的格子按比例混合：t = 0 是自己，t = 1 是另一块（原样的躯干 ↔ 平胸的躯干） */
  morph?: [grid: string, t: number];
  /**
   * 往两边加宽、收窄（肩宽、腰宽、胯宽，多个头时把肩膀加宽）：每一段从高度 from 起逐渐变，到 to 每边宽出 amount（负的是收窄），
   * to 比 from 低就是往下变；离中线 core 以内的一段是被拉开（压窄）的，再往外的整个挪。几段的挪动加在一起
   */
  widenX?: WidenBand[];
  /** 绕一根轴变粗变细（四肢粗细），见 sdf/grids.ts 的 GridUse.thicken */
  thicken?: Thicken;
  /** 离身体中线的距离按比例拉宽、压窄（胯宽），见 sdf/grids.ts 的 GridUse.spreadX */
  spreadX?: SpreadX;
  /** 再一份按比例压窄（多排胸时胸下面接长的那截肋骨往下收），见 sdf/grids.ts 的 GridUse.taperX */
  taperX?: SpreadX;
  /** 背那半边另照一种加长（多排胸时接长的那截背照素体的背整段拉长），见 sdf/grids.ts 的 GridUse.backStretch */
  backStretch?: BackStretch;
  /** 斜过去（腿胯部聚拢时往外散开），见 sdf/grids.ts 的 GridUse.lean */
  lean?: [out: number, depth: number];
  /** 从胯往上渐渐分开（好几个上半身），见 sdf/grids.ts 的 GridUse.fork */
  fork?: Fork;
  /** 左右各放一份、腰那一段并成一整块（两个人并成一个宽躯干），见 sdf/grids.ts 的 GridUse.twin */
  twin?: Twin;
  /**
   * 这块格子存的是到一层面片的距离（头发），没有里外：离面片 shell 以内的地方算实心。
   * 融合网格比较粗的时候会自动加厚，免得薄薄的一层在体素网格上破洞
   */
  shell?: number;
}

/** 加宽、收窄的一段：见 GridShape.widenX */
export type WidenBand = [amount: number, from: number, to: number, core: number];

/** 两个人并成一个宽躯干：见 sdf/grids.ts 的 GridUse.twin */
export interface Twin {
  /** 两份各离中线多远 */
  d: number;
  /**
   * 并成一整块的那一段，从下往上几个高度上各往两边拉开多少、离中线多远以内是被拉开的（再往外的整个挪；前面、后面各一个），之间渐变；
   * 最下面那个以下、最上面那个以上照它们
   */
  steps: [y: number, amount: number, front: number, back: number][];
  /** 前后在 depth 这两个 z 之间从后面的 core 渐渐换成前面的 */
  depth: [back: number, front: number];
  /**
   * 从下往上四个高度：bottom 以下两份各是各的，到 full 并成一整块，到 fullTo 还是一整块，到 top 以上又各是各的。
   * 不给就一直各是各的、不并
   */
  levels?: [bottom: number, full: number, fullTo: number, top: number];
}

/** 离身体中线的距离按比例拉宽、压窄：见 sdf/grids.ts 的 GridUse.spreadX */
export interface SpreadX {
  mid: number;
  rise: number;
  k: number;
  levels: [top: number, full: number, fullTo: number, bottom: number];
}

/** 背那半边另照一种加长：见 sdf/grids.ts 的 GridUse.backStretch */
export interface BackStretch {
  /** 背那半边怎么加长（加长的总长和 stretchY 一样） */
  stretch: Stretch;
  /** 前后 z 在 front 以前照 stretchY，到 back 全照 stretch，中间渐变 */
  front: number;
  back: number;
}

/** 从胯往上渐渐分开：见 sdf/grids.ts 的 GridUse.fork */
export interface Fork {
  pivot: V3;
  quat: Quat;
  shift: V3;
  /** 上半身的完整缩放矩阵；在分叉区逐渐加上，腰根仍留在未缩放的胯上。 */
  reshape?: Mat3;
  from: number;
  to: number;
  /**
   * 挪（shift）里往两边的那一份（x）另有一段：从 shiftFrom 起挪，到 shiftTo 挪足；上下、前后的那一份（手动微调挪的）跟着转那一段走。
   * 不给就整个挪和转是同一段
   */
  shiftFrom?: number;
  shiftTo?: number;
  /**
   * 和旁边的上半身在哪分界：每一项是旁边那一个怎么转、怎么挪（同一个 pivot、from、to），dir 是它在这一个的哪一侧（+X / -X）。
   * 各留自己那一半（分界是两条中线正中间）：三个上半身时中间那个不动、两边的挪开，叠在一起的地方两张皮来回穿插，肚子上一道道褶子
   */
  split?: { part: string; quat: Quat; shift: V3; dir: 1 | -1 }[];
  /**
   * 不照每一点自己的高度，全照这个高度上转、挪了多少整块退回去（二次元素体的胸贴着的那块躯干，见 torsos.ts 的 refork）：
   * 胸长在分开的那一段里，照各点自己的高度的话胸的上半截比下半截多转几度，整只胸被扭扁
   */
  freeze?: number;
  /**
   * 格子不在上半身自己的坐标里，在挂在它上面的一个部件（胸）的坐标里：上面这些数都还是上半身坐标里的，
   * 部件里的一点 p 在上半身里是 pos + quat · (scale · shape · p)（inverse 是 shape 的逆）。
   * 分开的那一段一直延到胸口时，胸跟着躯干一起渐渐转、挪，和底下的皮对得上
   */
  frame?: { pos: V3; quat: Quat; scale: number; shape?: Mat3; inverse?: Mat3 };
}

/** 绕一根轴变粗变细：见 sdf/grids.ts 的 GridUse.thicken */
export interface Thicken {
  from: V3;
  to: V3;
  k: number;
  ramp: [from: number, to: number, tip: number];
  /** 到 to 那一头（以及过了 to 的）乘的倍数，缺省是 1（变回原样）：很细的手臂上手跟着小一点，手腕也就细一点 */
  end?: number;
}

/**
 * 二次元素体的胸：不是拼上去的一块，而是贴着躯干表面的一层（见 anime/chest.ts）。
 * 求值时用躯干那一块格子（body：平胸，带着和躯干部件里一样的加宽、加长这些变形），把这一边胸那一片换成贴好胸的样子；
 * 融合时和躯干取并集。胸部件不转不缩放，挂在躯干上，原点就是 origin（躯干坐标里胸的中心）。
 * 手动微调不挪部件，换算成这里沿表面的挪动、缩放、转动（见 animeLayout.ts）
 */
export interface ChestShape {
  kind: 'chest';
  name: string;
  body: GridShape;
  origin: V3;
  side: 1 | -1;
  /** 「胸部大小」滑块 */
  size: number;
  /** 胸整个往上挪多少（加长过的胸腔上胸跟着上移；下排胸往下） */
  lift?: number;
  /** 沿表面往外（离正中线）挪、往上挪、往外推（离表面）多少，米 */
  shift?: V3;
  /** 沿表面横着、竖着、往外各放大几倍 */
  scale?: V3;
  /** 转多少度：绕左右的轴（正的胸尖往下）、绕竖轴（正的往 +X）、在表面上绕胸中心 */
  tilt?: V3;
  /**
   * 再切一刀（躯干的坐标里 n·p > d 的不要，n 是单位向量）：两个上半身里侧的胸在两个身子正中间切齐，
   * 和旁边那只挤在一起，中间一道沟（见 torsos.ts 的 refork）
   */
  seam?: [nx: number, ny: number, nz: number, d: number];
  /**
   * 胸要贴的展开图照 body 现量（并成一个宽躯干的，见 sdf/grids.ts 的 wideFrame）：胸贴在并好的宽躯干外面，高度照加长以后的。
   * 不给就照素体的平胸躯干（anime/chest.ts 的 chestFrame），贴在 body 那一份上
   */
  wide?: boolean;
}

export type Prim = Ellipsoid | Cone | Tube | Loft | Wing | GridShape | ChestShape;

/**
 * 重复的骨骼加上 Blender 式的序号后缀：第 1 个（index 0）不加，第 2 个是 .002，第 3 个是 .003 ……
 * 例如第二对手臂的上臂是 UpperArm_L.002，第二个头是 Head.002。
 */
export const nthName = (name: string, index: number) =>
  index ? `${name}.${String(index + 1).padStart(3, '0')}` : name;

/**
 * 骨骼的一节，写在所属部件自己的坐标里（部件挪动、转动、缩放时骨骼跟着走）。
 * 把所有部件的这些小节收集起来、按 parent 连成树，就是整副骨架。
 */
export interface BoneHint {
  /** 骨骼名，全身唯一：Hips、UpperArm_L、UpperArm_L.002、Head.002、Tail_01_03、Wing_02_L … */
  name: string;
  /** 父骨骼的名字。整副骨架里只有根骨骼（Hips）没有 */
  parent?: string;
  /** 骨骼的起点（关节所在的位置）和终点 */
  head: V3;
  tail: V3;
  /**
   * 这根骨骼属于哪一「股」（一根手指的几节是一股，写手指的名字）。
   * 同一个部件里并排着几股时，蒙皮权重主要跟着最近的那一股，不会被旁边的带着走（见 rig/skin.ts）
   */
  strand?: string;
}

/**
 * 接在部件上的一块现成的网格（手）。它不进距离场：融合出身体以后，在它的切口处和身体缝成一整块（见 sdf/graft.ts）。
 * 分部件模式下就是这个部件里多出来的一片网格。
 */
export interface Graft {
  /** 哪一块网格：手（anime/hand.ts）、脚（anime/foot.ts）或者阴茎（anime/genital.ts） */
  mesh: 'hand' | 'foot' | 'penis';
  /** 摆放：网格自己坐标里的点 p 在部件的坐标里是 matrix · p + offset。带镜像的（右手）行列式是负的 */
  matrix: Mat3;
  offset: V3;
  /** 网格里的骨骼名（不带左右：Hand、Thumb1 …）→ 骨架里的骨骼名（Hand_L.002 …） */
  bones: Record<string, string>;
  /**
   * 手腕的关节在网格自己坐标里的位置。部件被手动拉伸时（把手臂拉长、加粗），这块网格不跟着变形：
   * 它跟着这个点挪到新的位置，自己还是原来的比例（见 graftFrame）
   */
  pivot: V3;
  /** 网格自己坐标里顺着前臂的方向（手肘 → 手腕）：部件被拉伸时，网格的大小照这个方向横截面的粗细变（见 graftFrame） */
  reach: V3;
  /** 跟着这块网格一起保持原样的骨骼（骨架里的名字：手和手指）。前臂不在里面：它是照部件的拉伸走的 */
  rigid: string[];
  /**
   * 距离场里接它的那一截和这块网格是照同一个素材取的形（阴茎），切口两边本来就对得上：
   * 缝的时候开口附近不照切口的大小收（往根部变粗的，一收就凹下去一圈）。部件被拉得各方向不成比例时照旧收
   */
  matched?: boolean;
}

export interface Part {
  /** 实例名，全身唯一，导出后就是 Blender 里的物体名，例如 Arm_02_L */
  name: string;
  type: PartType;
  side: Side;
  /** 父部件的实例名；没有就是直接放在世界里 */
  parent?: string;
  pos: V3;
  quat: Quat;
  /** 等比缩放，子部件跟着一起缩放（头身比就是靠缩放头来实现的）。缺省为 1 */
  scale?: number;
  /** 只作用在自己基本体上的各轴缩放（比如把耳朵压扁），不传给子部件 */
  stretch?: V3;
  /**
   * 手动微调带来的各轴缩放：在 stretch 之后，沿 axes 这组轴再拉伸自己的基本体。
   * 子部件的大小不受影响，它们的位置在套用微调时已经跟着挪好了。
   */
  resize?: V3;
  /** resize 沿哪组轴，写在部件自己的坐标里。缺省就是部件自己的轴；手臂的 Y 轴沿着手臂的方向 */
  axes?: Quat;
  /** 手动旋转、缩放时保持不动的那个点（部件自己的坐标）。缺省是原点，也就是关节所在的位置 */
  pivot?: V3;
  material: Material;
  prims: Prim[];
  /**
   * 照摆好的姿势重新融合时（见 sdf/posedField.ts），这个部件转得离 home 这个方向超过 beyond（弧度）以后改用的一套基本体。
   * home 写在父部件的坐标里，是这个部件本来的形状正好合得上的那个方向。
   * 素体本来那对手臂是照平举的样子做的，根上连着一圈腋下的皮（边缘是毛的）：手臂垂着、平举时它埋在肩膀里看不见，
   * 举高了就整圈翻出来。所以举高以后换成「根部切掉、垫一个圆肩头」的那一种；没举高时还是本来的肩膀
   */
  posed?: { prims: Prim[]; home: V3; beyond: number };
  /** 接在这个部件上的现成网格（手），和基本体一样跟着部件摆放、拉伸 */
  grafts?: Graft[];
  /** 这个部件里的骨骼。没有的话（胸、角、眼睛），它的网格跟着父部件的骨骼动 */
  bones?: BoneHint[];
  /**
   * 做摆姿势用的网格时，这个部件先绕自己的原点（关节）多转这么多再融合（写在父部件的坐标里），
   * 权重算好以后再照权重转回来（见 sdf/bindPose.ts）。
   * 手臂静止时垂着，贴着躯干、几条聚在一个肩膀上的还互相挨着：直接融合的话它们从肩膀往下长长的一段是长在一起的一张皮，
   * 一摆开就扯出一片蹼；先摆开再融合，它们就只在肩头连着（摆成什么样见 layout.ts 的 bindAngles）。
   */
  bind?: Quat;
  /**
   * 穿模检查时，离根部这么远以内和别的部件重叠不算（部件自己的单位；缺省按部件的种类定）。
   * 马腿的上半截整个长在马身里，要放得比人腿宽
   */
  rootFree?: number;
  /**
   * 穿模检查时，和同类部件（别的腿）之间离根部这么远以内重叠不算（部件自己的单位；缺省是 rootFree 放宽一些）。
   * 胯部聚拢的腿是一束长出来的，大腿挤在一起是设计如此，只查膝盖以下
   */
  siblingFree?: number;
  /** 贴在躯干表面上的部件（胸）：手动微调由摆位时换算成沿表面的挪动（见 ChestShape），套微调时不再挪这个部件 */
  surface?: boolean;
  /**
   * 融合时算作哪一类部件（缺省就是自己的 type）。同一类之间是直接取并集、不出圆角：
   * 从同一个模型上切下来、还摆在原位的几块（素体的躯干和腿）要这样接，不然重叠的地方会鼓起一圈。
   */
  fuseAs?: PartType;
}

type Shaped = Pick<Part, 'stretch' | 'resize' | 'axes'>;
const inverse = (s: V3): V3 => [1 / s[0], 1 / s[1], 1 / s[2]];

/** 部件自己的基本体要乘的矩阵（stretch 和 resize 合在一起）；两样都没有就返回 null */
export function shapeMatrix(part: Shaped): Mat3 | null {
  const s = part.stretch ? scaleAlong(part.stretch) : null;
  if (!part.resize) return s;
  const r = scaleAlong(part.resize, part.axes);
  return s ? mat3Mul(r, s) : r;
}

/** shapeMatrix 的逆矩阵 */
export function shapeInverse(part: Shaped): Mat3 | null {
  const s = part.stretch ? scaleAlong(inverse(part.stretch)) : null;
  if (!part.resize) return s;
  const r = scaleAlong(inverse(part.resize), part.axes);
  return s ? mat3Mul(s, r) : r;
}

/**
 * 接在部件上的现成网格（手）在部件自己的坐标里（部件的拉伸已经算进去）怎么摆：
 * 网格自己坐标里的点 p 在 matrix · p + offset。
 *
 * 部件的拉伸（手动把手臂拉长、加粗）不照搬到手上：手臂拉长一倍，手要是也跟着细长一倍，
 * 手指就成了几根长条，一握拳全是拧的。手只跟着手腕挪到新的位置，大小照手腕那里横截面的粗细等比变
 * （手臂只是拉长、缩短时手不变，加粗了手跟着变大）：这样手的切口和前臂的断口一直对得上，缝得起来。
 * place：手和手指的骨骼（写在部件拉伸之前的坐标里）照同一套换算搬过去。
 */
export function graftFrame(part: Shaped, graft: Graft): { matrix: Mat3; offset: V3; place: (p: V3) => V3 } {
  const shape = shapeMatrix(part);
  if (!shape) return { matrix: graft.matrix, offset: graft.offset, place: (p) => p };
  const det =
    shape[0] * (shape[4] * shape[8] - shape[5] * shape[7]) -
    shape[1] * (shape[3] * shape[8] - shape[5] * shape[6]) +
    shape[2] * (shape[3] * shape[7] - shape[4] * shape[6]);
  // 横截面的粗细：体积的倍数除以顺着前臂的长度倍数，再开平方
  const along = mat3Apply(shape, mat3Apply(graft.matrix, graft.reach));
  const base = mat3Apply(graft.matrix, graft.reach);
  const stretch = Math.hypot(along[0], along[1], along[2]) / (Math.hypot(base[0], base[1], base[2]) || 1);
  const size = Math.sqrt(Math.abs(det) / (stretch || 1));
  // 手腕：拉伸之前在哪、拉伸之后在哪
  const turned = mat3Apply(graft.matrix, graft.pivot);
  const from = add(turned, graft.offset);
  const to = mat3Apply(shape, from);
  return {
    matrix: graft.matrix.map((v) => v * size) as Mat3,
    offset: [to[0] - turned[0] * size, to[1] - turned[1] * size, to[2] - turned[2] * size],
    place: (p) => [to[0] + (p[0] - from[0]) * size, to[1] + (p[1] - from[1]) * size, to[2] + (p[2] - from[2]) * size],
  };
}

/** 拉伸以后，最薄的那个方向缩成了原来的多少（宁小勿大） */
export function shapeThin(part: Shaped): number {
  const min = (s?: V3) => (s ? Math.min(s[0], s[1], s[2]) : 1);
  return min(part.stretch) * min(part.resize);
}

export interface FigureMetrics {
  /** 实际身高：最高的头顶离地高度 */
  height: number;
  /** 头高（下巴到头顶） */
  headHeight: number;
  /** 实际头身比 = 身高 / 头高 */
  headRatio: number;
  legForm: LegForm;
}

export interface Figure {
  parts: Part[];
  /**
   * 整个人的等比缩放：部件是按一个固定大小的人台摆的，最后乘上它得到设定的身高。
   * 分开存是为了拖「身高」时不用重建任何网格；导出时再把缩放烘焙进顶点。
   */
  scale: number;
  metrics: FigureMetrics;
}

/** 部件在世界里的位置、朝向和缩放（米） */
export interface WorldXf {
  pos: V3;
  quat: Quat;
  scale: number;
}

/** 沿父子链算出每个部件的世界变换。父部件必须排在子部件前面。 */
export function worldTransforms(figure: Pick<Figure, 'parts' | 'scale'>): Map<string, WorldXf> {
  const root: WorldXf = { pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: figure.scale };
  const out = new Map<string, WorldXf>();
  for (const part of figure.parts) {
    const parent = part.parent ? out.get(part.parent) : root;
    if (!parent) throw new Error(t('部件 {name} 的父部件 {parent} 不存在或排在它后面', { name: part.name, parent: part.parent ?? '' }));
    out.set(part.name, {
      pos: add(parent.pos, mul(rotate(parent.quat, part.pos), parent.scale)),
      quat: quatMul(parent.quat, part.quat),
      scale: parent.scale * (part.scale ?? 1),
    });
  }
  return out;
}
