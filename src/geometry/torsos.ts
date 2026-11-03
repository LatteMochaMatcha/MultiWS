/**
 * 好几个上半身（「两个上半身」，希腊神话里革律翁那种「三个身子在腰上连着」）：一副胯和腿上，从腰往上长出几个上半身，
 * 左右并排、往两边张开（正面看是 Y 字）。头、手臂、胸、翅膀是每个上半身照设定各长一份。
 *
 * 做法：先照一个上半身摆好（layout.ts / animeLayout.ts），再从腰那里把躯干切开——
 * 腰以下那一截（Hips 骨骼、屁股、腿都接在它上面）留在原地，还叫 Torso；腰以上复制几份（UpperBody、UpperBody_L、UpperBody_R），
 * 各自绕腰往外转开，躯干上长着的部件（脖子、头、手臂、胸、翅膀）跟着搬到各自那一份上、换名字：
 * - 上半身自己的脊柱骨骼带上它在哪一边：Spine_L、Chest_L.002、UpperChest_L（正中那个不带）；
 * - 头接着往下数：从角色的右手边那个上半身数起，Head_01 … Head_0n，下一个从 n + 1 数起；
 * - 手臂、胸、翅膀分「外侧」和「里侧」（里侧挨着别的上半身）：外侧那条照它在哪一边起名，左右两个上半身的外侧手臂互为镜像，
 *   名字只差 _L / _R；里侧的另外排在后面几对。这样「左右对称」照名字换边时，换到的正好是对面那个上半身上对应的那一条。
 * 里侧的手臂垂下来、平举出去都会插进旁边那个上半身里：改成往前伸（绕肩关节转过去）。
 * 二次元素体的只往两边歪开一点：直立并排，两个时里侧贴在一起（见 UPRIGHT_OVERLAP），三个时分得开、从胯上面就各是各的腰（见 UPRIGHT_SPREAD_THREE）。
 *
 * 纯函数，不依赖浏览器。
 */
import { castRay, compileField } from '../sdf/field';
import { getGrid, spreadAt } from '../sdf/grids';
import type { TorsoSide } from '../model/spec';
import { type BoneHint, type Figure, type Fork, type Graft, type GridShape, type Part, type Prim, type Tile, type WidenBand, nthName, shapeMatrix } from './figure';
import { HEAD_HALF_WIDTH } from './head';
import { ringAt } from './torso';
import { type Mat3, type Quat, type V3, Q_ID, add, len, mat3Apply, norm, quatBetween, quatConj, quatEuler, quatMul, rotate, sub } from './vec';

/** 最多几个上半身 */
export const MAX_TORSOS = 3;

/** 腰：几个上半身照脊柱第一节（Spine）的起点往上 CUT_RISE 处那么高往外歪（转轴在 Spine 的起点） */
const CUT_RISE = 0.03;
/**
 * 胯不加宽，每个上半身从胯上像树杈一样分出去（见 sdf/fork.ts）：髋关节（屁股缝的顶上）那么高以下还是一个人的胯，
 * 往上渐渐转开、挪开，到腰往上 FORK_ABOVE 分足；最下面那排胸的下沿再往下 FORK_UNDER_CHEST 还够的话，分足的地方往上挪
 * （最多到腰往上 FORK_MAX）：分开的那一段越长，转、挪得越缓（胸、手臂是照分足的样子摆的，分足的地方不能高过它们）。
 * 分叉只改变躯干，胸保留独立胸型、随上半身整体搬动。分开的那一段一直延到腋下（手臂根、翅膀根），
 * 腰往上到肋骨渐渐转开，侧面是一道顺的弧线；只延到胸下面的话，肋骨下沿那里一下子支出去，一道横着的台阶。
 * 上半身从分开的地方往下多留 FORK_OVERLAP，叠着的那一截两边一模一样，直接取并集；胯只留到分开的地方往上一点点（FORK_SEAM）：
 * 再往上上半身已经开始转、挪，两张皮差一点点，并在一起会来回穿插出一道道褶子。
 * 以前是把胯从髋关节往上加宽、几个上半身整个歪着插进去，腰上一圈鼓包，侧面一道台阶
 */
const FORK_ABOVE = 0.12;
/** 分足的地方最高到腰往上多少、离最下面那排胸的下沿至少多远 */
const FORK_MAX = 0.2;
const FORK_UNDER_CHEST = 0.02;
const FORK_OVERLAP = 0.01;
const FORK_SEAM = 0.002;
/**
 * 并成一个宽躯干切成左右两半时（见 splitWide），每一半越过正中线多少：两半叠着。正好切在正中线上的话，正中那个面上场的值正好是 0，
 * 格点落在上面会被当成身体外面，躯干正中勒出一道细缝（正面看一条竖线）
 */
const HALF_OVERLAP = 0.004;
/** 胯上挖掉的、圆滑地融上去的体块（屁股缝、屁股）管到的地方，顶上再往上空出多少才开始分开 */
const FORK_CLEAR = 0.01;
/** 两边的上半身往外歪多少（弧度）、腰那里往外挪多少（按标准人台的米）：歪到两个肩膀之间留出这么宽的空 */
const LEAN_MIN = 18 * (Math.PI / 180);
const LEAN_MAX = 48 * (Math.PI / 180);
const SHOULDER_GAP = 0.12;
/** 量的是肩膀的外表面（不是关节）时，两边之间空出多少 */
const SURFACE_GAP = 0.04;
const SHIFT = 0.06;
/** 三个上半身时两边那两个往外挪 SHIFT 的几倍 */
const SHIFT_THREE = 2;
/**
 * 采样好的躯干（二次元素体）：几个上半身各有各的腰、从胯上就分开（见 SPLIT_HALF），所以往外挪得多一些（差不多挪开一个腰那么宽），
 * 转得少（最少 LEAN_MIN_SAMPLED，肩膀、头之间空出来就行）。转从分开的地方往上一点（TURN_DELAY）开始，一直渐渐加到腋下，
 * 肋骨顺着一道弧线张开（转足的地方低的话，肋骨下沿一下子支出去一道横台阶）。
 * 拼的躯干（白模人台）分开的地方正好在它很细的腰上，在那里往外挪会在腰两侧鼓出一圈，还是照原来的挪少、转多
 */
const SHIFT_SAMPLED = 0.085;
/**
 * 采样好的躯干、两个上半身：从胯上就分开（不是到腰上、肚子上才分）。往外挪的那一段放在分开的地方上下各 SPLIT_HALF：
 * 腰往上已经挪足，两个上半身各有各的腰、肚子，中间那道 V 一直开到胯顶。
 * 胯本身的上半截跟着往两边加宽同样多（GridShape.widenX，离中线 SPLIT_CORE 以内的一段被拉开），
 * 在分开的地方正好和挪了一半的上半身对上：外侧一条顺的线，不起台阶。
 * 三个上半身不这样：两边的要歪得很开（不然肩膀挤不下），从胯上就分的话胯得有三个人那么宽、顶上露出一大片平台；
 * 还是从胯上起渐渐挪、一直挪到腋下
 */
const SPLIT_HALF = 0.07;
const SPLIT_CORE = 0.03;
const TURN_DELAY = 0.02;
const LEAN_MIN_SAMPLED = 8 * (Math.PI / 180);
/** 三个上半身时两边的往后退一点（绕竖轴转），扇面不至于排成一条直线 */
export const FAN_YAW = 10 * (Math.PI / 180);
/** 里侧的手臂往前伸：离「垂直向下」多少度起；碰到东西就一档抬多少，最高抬到多少 */
export const INNER_ARM_DROP = 62 * (Math.PI / 180);
export const INNER_ARM_STEP = 6 * (Math.PI / 180);
const INNER_ARM_TOP = 125 * (Math.PI / 180);
/** 里侧的手臂往前伸时，手离胯底下垫的那一大块（左右并排、横排多胯）顶上至少多远 */
const ARM_CLEAR = 0.02;
/** 量碰不碰的时候，手臂当成多粗、多长的一根圆棒（上臂连前臂，按标准人台的米） */
const ARM_RADIUS = 0.045;
const ARM_REACH = 0.5;
const ARM_ROOT = 0.12;
/**
 * 二次元素体两个上半身（B，照 refs/B-2～B-4）：直立并排，里侧贴在一起，各有各的腰，到胯并成一副宽胯（胯宽见 layout.ts 的 UPRIGHT_HIPS）。
 * 两边各往外挪腰最细那里半宽的 UPRIGHT_OVERLAP 倍：两个腰挤进去一点，正中只剩一道浅线（正好挨着的话两个肚子各圆各的，
 * 中间一道一直凹到侧面中间的深沟；挤进去更多的话头更挤，上半身要歪得更多）。
 * 往外歪 UPRIGHT_LEAN（从胯上渐渐歪到腋下）：两个肩膀之间张开一点，给里侧的手臂留地方；只歪到头不撞（3–4 度）的话，
 * 两个肩膀并成一块，里侧手臂挤在两个脖子中间长出来。头还碰头的话再歪到头之间空出 UPRIGHT_HEAD_GAP（每个上半身两三个头的）
 */
const UPRIGHT_OVERLAP = 0.8;
const UPRIGHT_LEAN = 12 * (Math.PI / 180);
const UPRIGHT_HEAD_GAP = 0.01;
/**
 * 二次元素体三个上半身也直立并排，但分得开：两边的往外挪腰最细那里半宽的这么多倍，三个腰之间空出一道缝，从胯上面就各是各的腰
 * （照两个上半身的 UPRIGHT_OVERLAP 挤着的话一个头的像一个窄身子顶三个头；以前往两边扇开、斜着歪出去，腰像树杈，里侧的手臂举到头顶）。
 * 试过 1.2（挤在一起）、2.0（三个腰正好挨着）、2.6（一对腿时胯成了很宽的一大块）
 */
const UPRIGHT_SPREAD_THREE = 2.3;
/**
 * 胯照腿排开了的（二次元素体左右并排、横排多胯，见 GridShape.tile）：每个上半身坐在一个座位上，胯从大腿根往上渐渐换成每个座位上一份
 * 素体原样的胯（见 Tile.seats）：前面 front、后面 rear 这两个高度之间换（屁股鼓得高，后面换得晚），换完了（top）才分开，
 * 上半身坐在那一份上（切口以下就挪足了），切口处是同一张皮；上半身各有各的腰，中间一道 V 从胯顶开出来。
 * 座位：腿平分给几个上半身，坐在每份腿正中（不比照一对腿时直立并排挪得少，见 UPRIGHT_OVERLAP）。每份正好一对腿的，座位上那份素体原样的胯
 * 两个腿根就在那两条腿上；不是一对的（三条腿两个上半身这种），座位上那份的腿根和腿对不上：腿那块本来往上伸进胯里（外胯那里伸到 0.91），
 * 胯往里收的时候它会从胯里支出来一圈，所以改照 late 那两个高度换，从腿那块的顶上才开始（见 seatLevels）。
 * 试过每份正中再往正中收四分之一：每份一对腿的也对不上了，大腿根一圈台阶。试过对不上的腿在 front 往上切掉：大腿外侧那截是腿那块的，
 * 胯那块在那里只有个封口，切开一道沟。
 * 试过照一对腿时那样挤在一起、胯往上收成一个人的胯往两边拉开：四条腿的胯 60 厘米宽，两个腰并起来不到 30 厘米，切口以下收不回来，像条蓬蓬裙
 */
const SEAT = {
  front: [0.86, 0.96] as [number, number],
  rear: [0.9, 0.975] as [number, number],
  late: { front: [0.915, 0.978] as [number, number], rear: [0.93, 0.98] as [number, number] },
  top: 0.995,
};
/** 腿离座位上那份素体原样的胯的腿根差多少以内算对得上（米） */
const LEG_FIT = 0.002;
/**
 * 坐在座位上的胯从哪往座位上那份换（见 SEAT）：每条腿都正好在某个座位的一个腿根上（离座位正好半个腿距），或者最外边的座位
 * 不比最外边那条腿靠里（胯往上是变宽的，腿那块盖得住）的早一点换；不然从腿那块的顶上才开始换。legs、seats、half 都是躯干自己的坐标
 */
function seatLevels(tile: Tile, seats: readonly number[]): Pick<Tile, 'levels' | 'rear'> {
  const { legs, half } = tile;
  const fits = legs.every((x) => seats.some((s) => Math.abs(Math.abs(x - s) - half) < LEG_FIT));
  const covered = seats[seats.length - 1] >= legs[legs.length - 1] - half - LEG_FIT && seats[0] <= legs[0] + half + LEG_FIT;
  return fits || covered ? { levels: SEAT.front, rear: SEAT.rear } : { levels: SEAT.late.front, rear: SEAT.late.rear };
}
/**
 * 直立并排时里侧的手臂：肩关节歪过以后离正中线不到 BESIDE_ROOT 的，挪回自己这边（不然伸到旁边那个身子里，两边的交叉着长出来；
 * 两边的根离得太近，融合、算权重时两条粘成一块，摆姿势时一条被另一个身子拽着走），从两个肩膀之间张开的那道 V 里长出来。
 * 姿势固定，不再碰到东西就一档档往上抬：往前伸，离「垂直向下」BESIDE_DROP，往自己那边偏 BESIDE_YAW（两边的分开）；
 * 一个肩膀上聚拢着好几条的，往后一条比前一条再抬 BESIDE_STEP，前面那几条的肩关节往下挪（见 besideArms）。
 * 试过垂在身前（手落在自己那边的胯前，照参考图）：胸 1 时好看，大胸时穿进里侧挤在一起的胸里，套姿势时手插进大腿
 */
const BESIDE_ROOT = 0.045;
export const BESIDE_DROP = 62 * (Math.PI / 180);
export const BESIDE_YAW = 15 * (Math.PI / 180);
const BESIDE_STEP = 30 * (Math.PI / 180);
/** 一个肩膀上好几条里侧手臂时，前面那几条的肩关节一条比一条往下挪多少；挪下去的碰到胸往上抬，最多抬到比后一条低多少（见 besideArms） */
const BESIDE_LOWER = 0.1;
const BESIDE_APART = 5 * (Math.PI / 180);
/** 往前伸的手臂融合时抬多少：最低的那条正好抬平 */
const INNER_BIND_LIFT = 90 * (Math.PI / 180) - INNER_ARM_DROP;
/** 里侧一个肩膀上最多留几条聚拢的手臂，肩关节离多近算同一个肩膀 */
const INNER_FAN_MAX = 2;
const SAME_SHOULDER = 0.08;

/**
 * 两边的上半身往外歪多少（弧度）：歪到相邻两个的肩膀、头之间都空出 gap（缺省 SHOULDER_GAP）。
 * reach：一个上半身上肩膀（手臂根、脖子根）和头离中线多远（wide，头连自己的半宽）、比腰（转的那一点）高多少（rise）；
 * outward：两边的上半身在腰那里往外挪了多远
 */
export function torsoLean(reach: readonly { wide: number; rise: number; gap?: number }[], three: boolean, outward: number, least = LEAN_MIN): number {
  /** 歪 lean 时，旁边那个上半身里侧的肩膀、头和中线（或正中那个上半身的肩膀、头）之间还空着多少，减去要空出来的：差得最多的那一处 */
  const room = (lean: number) =>
    Math.min(
      ...reach.map(({ wide, rise, gap = SHOULDER_GAP }) =>
        three
          ? Math.max(0.2, rise) * Math.sin(lean) + outward - wide * (1 + Math.cos(lean)) - gap
          : Math.max(0.2, rise) * Math.sin(lean) + outward - wide * Math.cos(lean) - gap / 2,
      ),
    );
  let lean = least;
  while (lean < LEAN_MAX && room(lean) < 0) lean += Math.PI / 360;
  return lean;
}

/** 第几个上半身在哪一边：0 正中，1 角色的左手边（+X），-1 右手边。两个时左右各一，三个时正中、左、右 */
export function torsoSlots(count: number): (0 | 1 | -1)[] {
  return count >= 3 ? [0, 1, -1] : count === 2 ? [1, -1] : [0];
}

const sideTag = (slot: number) => (slot > 0 ? '_L' : slot < 0 ? '_R' : '');
const SPINE = /^(Spine|Chest|UpperChest)(\.\d+)?$/;
/** 骨骼名拆成「本名」和第几个（.002 是第 2 个） */
const ordinal = (name: string): [string, number] => {
  const m = /^(.*?)(?:\.(\d{3}))?$/.exec(name)!;
  return [m[1], m[2] ? Number(m[2]) - 1 : 0];
};

/** 第几个上半身（torsoSlots）对应 BodySpec.torsoCounts 里哪一边 */
export const SLOT_SIDE: Record<-1 | 0 | 1, TorsoSide> = { [-1]: 'R', 0: 'M', 1: 'L' };

/** 一副身体腰以上那些部件：躯干上长着的，和挂在它们上面的 */
function uppersOf(figure: Figure): Part[] {
  const byName = new Map(figure.parts.map((p) => [p.name, p]));
  const upperOf = (p: Part): boolean => p.parent === 'Torso' || (p.parent !== undefined && upperOf(byName.get(p.parent)!));
  return figure.parts.filter(upperOf);
}

/**
 * sources：每个上半身单独设的数量不一样时，第 slot 个上半身照哪副身体摆（layout.ts 照它自己的数量摆的，腰以上从这副里取）；
 * 不给的照 figure。胯、腿和身高这些照 figure
 */
export function splitTorsos(figure: Figure, count: number, sources: Partial<Record<-1 | 0 | 1, Figure>> = {}): Figure {
  const slots = torsoSlots(Math.max(1, Math.min(MAX_TORSOS, Math.round(count))));
  if (slots.length < 2) return figure;
  const torso = figure.parts.find((p) => p.name === 'Torso');
  const spineBone = torso?.bones?.find((b) => b.name === 'Spine');
  if (!torso || !spineBone) return figure;

  const upper = uppersOf(figure);
  const upperSet = new Set(upper);
  /** 第 slot 个上半身照哪副身体摆、它腰以上的部件、它的躯干 */
  const sourceOf = (slot: number): Figure => sources[slot as -1 | 0 | 1] ?? figure;
  const uppers = new Map<number, Part[]>(slots.map((slot) => [slot, sourceOf(slot) === figure ? upper : uppersOf(sourceOf(slot))]));
  const torsoOf = (slot: number): Part => sourceOf(slot).parts.find((p) => p.name === 'Torso') ?? torso;
  const allUpper = slots.flatMap((slot) => uppers.get(slot)!);
  const cutY = spineBone.head[1] + CUT_RISE;
  const pivot: V3 = [0, spineBone.head[1], spineBone.head[2]];
  const three = slots.length === 3;
  const sampled = torso.prims.some((p) => p.kind === 'grid');
  // 两个上半身并成一个宽躯干的（C）：躯干那一块切成胯和左右两半（见 splitWide）
  const wide = slots.length === 2 ? torso.prims.find((p): p is GridShape => p.kind === 'grid' && !!p.twin?.levels) : undefined;
  if (wide) return splitWide(figure, torso, wide, spineBone.head[1] + CUT_RISE);
  /** 直立并排（见 UPRIGHT_OVERLAP、UPRIGHT_SPREAD_THREE）：二次元素体都是；白模人台三个时往两边扇开 */
  const upright = sampled;
  /** 两边的上半身往外挪多远（从分开的地方起渐渐挪过去）；直立并排的照腰的宽度，下面量 */
  let outward = (three ? SHIFT_THREE : 1) * (sampled ? SHIFT_SAMPLED : SHIFT);
  const hipY = torso.bones?.find((b) => b.name === 'Hips')?.head[1] ?? cutY - 0.12;

  /**
   * 从哪么高起分开：髋关节那么高，并且胯上别的体块管到的地方都在它下面——
   * 挖掉的（屁股缝）只挖排在它前面的，上半身插下来的那一截要在它上面，不然把缝的上头又填上了、留一个坑；
   * 圆滑地融上去的（白模人台的屁股）鼓起来的那一圈要在胯的切口下面，不然切口那里一道台阶
   */
  const influence = (p: Prim) => {
    if (p.kind !== 'ellipsoid' || (!p.cut && !p.soft)) return -Infinity;
    return carveTop(p) + (p.soft ?? 0) + FORK_CLEAR + (p.cut ? FORK_OVERLAP : 0);
  };
  /** 胯照腿排开了的（见 SEAT） */
  const seated = sampled ? torso.prims.find((p): p is GridShape => p.kind === 'grid' && !!p.tile) : undefined;
  const forkFrom = Math.min(cutY, Math.max(hipY, ...torso.prims.map(influence), seated ? SEAT.top : -Infinity));
  // 躯干过渡的上限：拼的胸、手臂根、翅膀根以下。采样胸单独接在胸壁上，保留较长的躯干过渡。
  const rigid = allUpper.filter(
    (p) => p.parent === 'Torso' && (p.type === 'chest' ? !p.prims.some((q) => q.kind === 'grid' || q.kind === 'chest') : sampled && (p.type === 'arm' || p.type === 'wing')),
  );
  const rigidLow = Math.min(...rigid.map(partBottom));
  const forkTo = Math.max(cutY + FORK_ABOVE, Math.min(cutY + FORK_MAX, rigidLow - FORK_UNDER_CHEST));
  if (upright) {
    // 腰最细那里多宽（分开的那一段里，从正中往两边量）
    const whole = compileField({ scale: 1, parts: [{ ...torso, parent: undefined, pos: [0, 0, 0], quat: Q_ID }] }, { blend: 0 });
    let waist = Infinity;
    for (let y = forkFrom; y <= forkTo; y += 0.005) waist = Math.min(waist, 0.6 - castRay(whole, [0.6, y, 0], [-1, 0, 0], 0.6));
    outward = waist * (three ? UPRIGHT_SPREAD_THREE : UPRIGHT_OVERLAP);
  }
  if (seated) {
    // 腿平分给几个上半身：从最右边那条腿外面半个腿距到最左边那条腿外面半个腿距，等分几段，座位在每段正中（见 SEAT）；
    // 不比最外边那条腿往外挪的多（不然往座位上那份换的时候外胯反而往外顶出一个角）。比它靠里的（每个上半身分到三条腿这种）
    // 往它那边挪一半：胯从腿那块的顶上才开始往里收（见 seatLevels），要收的少一半，外胯上沿不至于一下子折进去
    // 每个上半身坐一副完整的胯的（Tile.pairs）：座位就在最外边那副胯的正中
    const { legs, half, pairs } = seated.tile!;
    const span = legs[legs.length - 1] - legs[0] + 2 * half;
    const center = (span / 2) * (1 - 1 / slots.length);
    const edge = legs[legs.length - 1] - half;
    outward = pairs ? (legs[legs.length - 1] + legs[legs.length - 2]) / 2 : Math.max(outward, center < edge ? (center + edge) / 2 : edge);
  }
  /** 座位（见 SEAT）：每个上半身的腰在哪，从 -X 到 +X */
  const seats = slots.map((slot) => slot * outward).sort((a, b) => a - b);

  /* ---- 躯干切成两截：分开的地方以下是胯，往上（多留一截）是复制用的那一份 ---- */
  const pelvisTop = forkFrom + FORK_SEAM;
  const copyBottom = forkFrom - FORK_OVERLAP;
  const cut = (prims: readonly Prim[]) => {
  const below: Prim[] = [];
  const above: Prim[] = [];
  // 叠着的那一截两边是同一张皮，切口都埋在对方里面：不用倒圆（倒了反而在那一圈凹进去一道）
  for (const p of prims) {
    if (p.kind === 'loft') {
      below.push({ ...p, rings: [...p.rings.filter((r) => r.y < pelvisTop), ringAt(p.rings, pelvisTop)] });
      above.push({ ...p, rings: [ringAt(p.rings, copyBottom), ...p.rings.filter((r) => r.y > copyBottom)] });
    } else if (p.kind === 'grid' && p.tile) {
      // 胯照腿排开了：往上换成每个座位上一份（见 SEAT），不另外加宽；上半身那几份不排开
      below.push({ ...p, clipAbove: pelvisTop, clipRound: 0, tile: { ...p.tile, seats, ...seatLevels(p.tile, seats) } });
      above.push({ ...p, clipBelow: copyBottom, clipRound: 0, tile: undefined });
    } else if (p.kind === 'grid') {
      // 两个上半身：胯的上半截跟着上半身往两边挪开的那么多加宽（见 SPLIT_HALF）。胯宽（spreadX）是在加宽以后再乘的：先除掉
      const f = p.spreadX ? spreadAt(p.spreadX, forkFrom) : 1;
      const band: WidenBand = [outward / f, forkFrom - SPLIT_HALF, forkFrom + SPLIT_HALF, SPLIT_CORE];
      below.push({ ...p, clipAbove: pelvisTop, clipRound: 0, ...(three && !upright ? {} : { widenX: [...(p.widenX ?? []), band] }) });
      above.push({ ...p, clipBelow: copyBottom, clipRound: 0 });
    } else {
      // 别的体块（屁股、屁股缝、脖子根那一团）看它在腰的哪一边
      const y = p.kind === 'ellipsoid' ? p.center[1] : p.kind === 'cone' ? (p.a[1] + p.b[1]) / 2 : cutY + 1;
      (y < cutY ? below : above).push(p);
    }
  }
  return { below, above };
  };
  const { below } = cut(torso.prims);
  /** 第 slot 个上半身复制用的那一截躯干、它的脊柱骨骼（数量不一样时胸腔加长的多少不一样，各取各的） */
  const aboves = new Map<number, Prim[]>(slots.map((slot) => [slot, cut(torsoOf(slot).prims).above]));
  const spines = new Map<number, BoneHint[]>(slots.map((slot) => [slot, (torsoOf(slot).bones ?? []).filter((b) => SPINE.test(b.name))]));
  const hips = (torso.bones ?? []).filter((b) => !SPINE.test(b.name));
  const pelvis: Part = { ...torso, prims: below, bones: hips };

  /* ---- 每个上半身歪多少：歪到相邻两个的肩膀之间、头之间都空出 SHOULDER_GAP ---- */
  /**
   * 肩膀（手臂根、脖子根）和头离中线最远多远、多高：一个头多的上半身，那一簇头比肩膀宽。
   * 肩膀不只看手臂的关节：二次元素体的肩关节埋在身体里面，躯干本身在那个高度上比关节宽出一截——
   * 朝躯干打射线量它在那个高度上实际有多宽，再和关节外面一条手臂的粗细比，取宽的
   */
  const reach: { wide: number; rise: number; gap?: number }[] = [];
  let shoulderY = cutY + 0.3;
  let shoulderWide = 0;
  for (const slot of new Set(slots.map(sourceOf)).size === 1 ? [slots[0]] : slots) {
  const probe = compileField({ scale: 1, parts: [{ ...torso, parent: undefined, pos: [0, 0, 0], quat: Q_ID, prims: aboves.get(slot)! }] }, { blend: 0 });
  const torsoWide = (y: number, z: number) => 0.6 - castRay(probe, [0.6, y, z], [-1, 0, 0], 0.6);
  for (const p of uppers.get(slot)!) {
    if (p.parent !== 'Torso') continue;
    if (p.type === 'arm' || p.type === 'neck') {
      const wide = p.type === 'arm' ? Math.max(Math.abs(p.pos[0]) + ARM_RADIUS, torsoWide(p.pos[1], p.pos[2])) : Math.abs(p.pos[0]);
      reach.push({ wide, rise: p.pos[1] - pivot[1], gap: p.type === 'arm' ? SURFACE_GAP : SHOULDER_GAP });
      if (Math.abs(p.pos[0]) > shoulderWide) [shoulderWide, shoulderY] = [Math.abs(p.pos[0]), p.pos[1]];
    } else if (p.type === 'head') {
      reach.push({ wide: Math.abs(p.pos[0]) + HEAD_HALF_WIDTH * (p.scale ?? 1), rise: p.pos[1] - pivot[1] });
    }
  }
  }
  // 直立并排的只看头（肩膀见 UPRIGHT_LEAN）
  const heads = reach.filter((r) => r.gap === undefined).map((r) => ({ ...r, gap: UPRIGHT_HEAD_GAP }));
  const lean = upright ? torsoLean(heads, three, outward, UPRIGHT_LEAN) : torsoLean(reach, three, outward, sampled ? LEAN_MIN_SAMPLED : LEAN_MIN);
  /** 三个上半身往两边扇开（转过去一点）；直立并排的不扇 */
  const yaw = three && !upright ? FAN_YAW : 0;
  /** 三个时两边的往后挪一点；直立并排的不挪 */
  const back = three && !upright ? -0.02 : 0;
  // 里侧的手臂往前伸时手不往下伸到哪儿：腰；腿左右并排、横排多胯时胯底下垫的那一大块比腰还高的话，到它顶上
  const lowerTop = Math.max(
    ...figure.parts
      .filter((p) => p.type === 'lower' && !p.parent)
      .flatMap((p) => p.prims.map((q) => (q.kind === 'ellipsoid' && !q.cut ? p.pos[1] + (q.center[1] + q.radii[1]) * (p.scale ?? 1) : -Infinity))),
  );
  const floor = Math.max(cutY, lowerTop + ARM_CLEAR);

  /* ---- 复制、换名字 ---- */
  /** 第 slot 个上半身有几个头、几对手臂（胸、翅膀） */
  const per = (slot: number, type: Part['type'], pattern: RegExp) => {
    let most = 0;
    for (const p of uppers.get(slot)!) {
      const m = p.type === type ? pattern.exec(p.name) : null;
      if (m) most = Math.max(most, Number(m[1]));
    }
    return most;
  };
  const headsPer = (slot: number) => per(slot, 'head', /^Head_(\d+)$/);
  const pairsPer = (slot: number, kind: string) => per(slot, kind === 'Arm' ? 'arm' : kind === 'Chest' ? 'chest' : 'wing', new RegExp(`^${kind}_(\\d+)_[LR]$`));

  const out: Part[] = [pelvis];
  slots.forEach((slot) => {
    const tag = sideTag(slot);
    const q: Quat = quatMul(quatEuler(0, slot * yaw, 0), quatEuler(0, 0, -slot * lean));
    const shift: V3 = [slot * outward, 0, slot ? back : 0];
    const name = `UpperBody${tag}`;
    const upper = uppers.get(slot)!;
    const above = aboves.get(slot)!;
    const spine = spines.get(slot)!;
    const own = torsoOf(slot);
    /** 骨骼换名字：脊柱带上边，头接着往下数，手臂、胸、翅膀分外侧、里侧 */
    const boneMap = new Map<string, string>();
    for (const b of spine) {
      const [base, k] = ordinal(b.name);
      boneMap.set(b.name, nthName(`${base}${tag}`, k));
    }
    /** 这一边挨着别的上半身吗（side 是 1 / -1） */
    const inner = (side: number) => (slot === 0 ? three : side === -slot);
    /**
     * 第几对（从 0 数）的手臂、胸、翅膀在 side 这一边，换成第几对：同一个后缀（_L / _R）上先排正中那个上半身的，
     * 再排外侧在这一边的那个上半身的，最后是里侧在这一边的（照它们各自有几对往后排，名字不重复）
     */
    const pairAt = (k: number, side: number, kind: string) => {
      if (slot === 0) return k;
      const middle = three ? pairsPer(0, kind) : 0;
      return inner(side) ? k + middle + pairsPer(-slot, kind) : k + middle;
    };
    // 头照从右往左（-X 到 +X）一个上半身一个上半身地数：一个上半身里的头本来就是这么数的，镜像的那个头是倒着数的同一个号
    const headAt = (k: number) => k + slots.filter((other) => other < slot).reduce((sum: number, other) => sum + headsPer(other), 0);

    /** 一个部件和它的骨骼在这个上半身上叫什么 */
    const rename = (p: Part): { part: string; bone: (b: string) => string } => {
      let m: RegExpExecArray | null;
      if ((m = /^(Neck|Head)_(\d+)(.*)$/.exec(p.name))) {
        const k = headAt(Number(m[2]) - 1);
        return {
          part: `${m[1]}_${String(k + 1).padStart(2, '0')}${m[3]}`,
          bone: (b) => {
            const [base] = ordinal(b);
            return nthName(base, k);
          },
        };
      }
      if ((m = /^(Arm|Chest|Wing)_(\d+)_([LR])$/.exec(p.name))) {
        const side = m[3] === 'L' ? 1 : -1;
        const k = pairAt(Number(m[2]) - 1, side, m[1]);
        const part = `${m[1]}_${String(k + 1).padStart(2, '0')}_${m[3]}`;
        return {
          part,
          // 翅膀的骨骼就叫部件的名字；手臂、手指照 Shoulder_L.002 那样带序号
          bone: (b) => (m![1] === 'Wing' ? part : nthName(ordinal(b)[0], k)),
        };
      }
      return { part: `${p.name}${tag}`, bone: (b) => `${b}${tag}` };
    };

    const partMap = new Map<string, string>([['Torso', name]]);
    const children: Part[] = [];
    for (const p of upper) {
      const { part, bone } = rename(p);
      partMap.set(p.name, part);
      for (const b of p.bones ?? []) boneMap.set(b.name, bone(b.name));
      children.push(p);
    }
    const boneName = (b: string | undefined) => (b === undefined ? undefined : (boneMap.get(b) ?? b));
    const bones = (list: BoneHint[] | undefined) => list?.map((b) => ({ ...b, name: boneName(b.name)!, parent: boneName(b.parent) }));
    const grafts = (list: Graft[] | undefined) =>
      list?.map((g) => ({ ...g, bones: Object.fromEntries(Object.entries(g.bones).map(([k, v]) => [k, boneName(v)!])), rigid: g.rigid.map((b) => boneName(b)!) }));

    // 这一份上半身：绕腰转 q，再往外挪 shift。部件的位置写在父部件（胯）的坐标里
    const copyPos = add(sub(pivot, rotate(q, pivot)), shift);
    // 躯干从胯上渐渐分出去（转、挪都从 forkFrom 起渐渐加上），和胯是同一张皮，直接取并集。
    // 两个上半身是左右镜像，叠在一起的地方直接取并集，交线就在正中；三个时中间那个不动、两边的挪开，
    // 交线来回穿插出一道道褶子，所以和相邻的各留自己那一半
    const neighbor = (other: number) => {
      const turn: Quat = quatMul(quatEuler(0, other * yaw, 0), quatEuler(0, 0, -other * lean));
      return { part: `UpperBody${sideTag(other)}`, quat: turn, shift: [other * outward, 0, other ? back : 0] as V3, dir: (other > slot ? 1 : -1) as 1 | -1 };
    };
    const split = three ? slots.filter((other) => Math.abs(other - slot) === 1).map(neighbor) : undefined;
    const fork: Fork = sampled
      ? {
          pivot,
          quat: q,
          shift,
          from: forkFrom + TURN_DELAY,
          to: forkTo,
          // 坐在座位上的（见 SEAT）：切口以下就挪足了，切口处坐在胯上座位那一份上
          ...(seated
            ? { shiftFrom: copyBottom - 2 * FORK_OVERLAP, shiftTo: copyBottom - FORK_SEAM }
            : three && !upright
              ? { shiftFrom: forkFrom, shiftTo: forkTo }
              : { shiftFrom: forkFrom - SPLIT_HALF, shiftTo: forkFrom + SPLIT_HALF }),
          ...(split ? { split } : {}),
        }
      : { pivot, quat: q, shift, from: forkFrom, to: forkTo, ...(split ? { split } : {}) };
    out.push({
      ...own,
      name,
      side: slot,
      parent: 'Torso',
      pos: copyPos,
      quat: q,
      pivot,
      prims: above.map((p) => (p.kind === 'grid' || p.kind === 'loft' ? { ...p, fork } : p)),
      bones: bones(spine),
    });
    for (const p of children) {
      const made: Part = {
        ...p,
        name: partMap.get(p.name)!,
        parent: partMap.get(p.parent!) ?? p.parent,
        ...(p.bones ? { bones: bones(p.bones) } : {}),
        ...(p.grafts ? { grafts: grafts(p.grafts) } : {}),
      };
      // 直立并排时里侧的肩关节挪回自己这边（见 BESIDE_ROOT）
      if (upright && p.type === 'arm' && p.parent === 'Torso' && inner(p.side)) {
        // 歪过以后肩关节在胯的坐标里离正中线多远（往自己那边是正的）；不够 BESIDE_ROOT 的沿上半身的左右挪过去
        const room = slot * add(copyPos, rotate(q, p.pos))[0];
        if (room < BESIDE_ROOT) made.pos = [p.pos[0] + (slot * (BESIDE_ROOT - room)) / Math.cos(lean), p.pos[1], p.pos[2]];
      }
      out.push(made);
    }
    // 里侧的手臂：直立并排的摆一个固定的姿势（见 besideArms），别的往前伸、碰到东西往上抬（见 reachForward）
    for (const side of [1, -1]) {
      if (!inner(side)) continue;
      if (upright) {
        besideArms(
          out.filter((p) => p.parent === name && p.side === side && p.type === 'arm'),
          q,
          slot,
          out.filter((p) => p.parent === name && p.side === side && p.type === 'chest'),
        );
        continue;
      }
      const mine = out.filter((p) => p.parent === name && p.side === side);
      const extra = reachForward(
        mine.filter((p) => p.type === 'arm'),
        mine.filter((p) => p.type === 'chest'),
        q,
        (p) => add(copyPos, rotate(q, p)),
        floor,
      );
      for (const p of extra) out.splice(out.indexOf(p), 1);
    }
  });
  for (const p of figure.parts) if (p !== torso && !upperSet.has(p)) out.push(p);
  // 直立并排的里侧的胸、手臂都留着（胸挤在一起，手臂见 besideArms）
  const kept = upright ? out : crowded(out, slots, [0, shoulderY, pivot[2]]);

  // 头顶低了一点（上半身歪过去了）：身高照最高的那个头顶重新量
  const crown = (parts: Part[]) => {
    const xf = new Map<string, { pos: V3; quat: Quat }>();
    let top = -Infinity;
    for (const p of parts) {
      const parent = p.parent ? xf.get(p.parent) : { pos: [0, 0, 0] as V3, quat: Q_ID };
      if (!parent) continue;
      const me = { pos: add(parent.pos, rotate(parent.quat, p.pos)), quat: quatMul(parent.quat, p.quat) };
      xf.set(p.name, me);
      if (p.type === 'head') top = Math.max(top, me.pos[1]);
    }
    return top;
  };
  const drop = (crown(figure.parts) - crown(kept)) * figure.scale;
  const height = figure.metrics.height - (Number.isFinite(drop) ? drop : 0);
  return { ...figure, parts: kept, metrics: { ...figure.metrics, height, headRatio: height / figure.metrics.headHeight } };
}

/**
 * 两个上半身并成一个宽躯干（C，照 refs/CD-1～3）：layout.ts 照「一个上半身两个头」并成宽躯干摆好（layoutAnime 带 twin），骨骼、部件再按两个上半身来——
 * 躯干那一块（带 Twin）在腰上（cutY）切开：以下是胯，还叫 Torso（带着 Hips、屁股）；以上从正中线切成左右两半，各是一个上半身
 * （UpperBody_L / _R），带着自己那一份正中的脊柱（Spine_L、Chest_L、UpperChest_L …），长在那一边的头、脖子、手臂、胸、翅膀搬过去。
 * 网格和 D 一模一样（几块切开的叠在一起的那一截两边是同一张皮，直接取并集）；摆姿势时两根脊柱各弯各的
 */
function splitWide(figure: Figure, torso: Part, wide: GridShape, cutY: number): Figure {
  const d = wide.twin!.d;
  const byName = new Map(figure.parts.map((p) => [p.name, p]));
  // 长在腰以上的（脖子、手臂、胸、翅膀）和挂在它们上面的跟着上半身走；屁股缝、尾巴根这些留在胯上
  const ownTop = (p: Part) => p.parent === 'Torso' && p !== torso && p.pos[1] > cutY;
  const rootOf = (p: Part): Part | undefined => (ownTop(p) ? p : p.parent ? (byName.get(p.parent) ? rootOf(byName.get(p.parent)!) : undefined) : undefined);
  const hips = (torso.bones ?? []).filter((b) => !SPINE.test(b.name));
  const spine = (torso.bones ?? []).filter((b) => SPINE.test(b.name));
  const above = (p: Prim) => (p.kind === 'ellipsoid' ? p.center[1] : p.kind === 'cone' ? (p.a[1] + p.b[1]) / 2 : 0) > cutY;
  const pelvis: Part = {
    ...torso,
    prims: torso.prims.filter((p) => p === wide || !above(p)).map((p) => (p === wide ? { ...wide, clipAbove: cutY + FORK_SEAM, clipRound: 0 } : p)),
    bones: hips,
  };
  const out: Part[] = [pelvis];
  for (const slot of [1, -1] as const) {
    const tag = sideTag(slot);
    const name = `UpperBody${tag}`;
    const boneMap = new Map<string, string>();
    for (const b of spine) {
      const [base, k] = ordinal(b.name);
      boneMap.set(b.name, nthName(`${base}${tag}`, k));
    }
    const rename = (b: string | undefined) => (b === undefined ? undefined : (boneMap.get(b) ?? b));
    const moved = (v: V3): V3 => [v[0] + slot * d, v[1], v[2]];
    out.push({
      ...torso,
      name,
      side: slot,
      parent: 'Torso',
      pos: [0, 0, 0],
      quat: Q_ID,
      // 这一边那一半：右边的照镜像取（宽躯干左右对称），切口都在正中线上（越过一点，两半叠着，见 HALF_OVERLAP）
      prims: [
        { ...wide, clipBelow: cutY - FORK_OVERLAP, clipRound: 0, clipX: -HALF_OVERLAP, ...(slot < 0 ? { mirror: true } : {}) },
        ...torso.prims.filter((p) => p !== wide && above(p) && Math.sign(p.kind === 'ellipsoid' ? p.center[0] : 0) !== -slot),
      ],
      bones: spine.map((b) => ({ ...b, name: rename(b.name)!, parent: rename(b.parent), head: moved(b.head), tail: moved(b.tail) })),
    });
    for (const p of figure.parts) {
      const root = rootOf(p);
      if (!root || Math.sign(root.pos[0]) !== slot) continue;
      out.push({
        ...p,
        ...(p === root ? { parent: name } : {}),
        ...(p.bones ? { bones: p.bones.map((b) => ({ ...b, parent: rename(b.parent) })) } : {}),
        ...(p.grafts ? { grafts: p.grafts.map((g) => ({ ...g, bones: Object.fromEntries(Object.entries(g.bones).map(([k, v]) => [k, rename(v)!])), rigid: g.rigid.map((b) => rename(b)!) })) } : {}),
      });
    }
  }
  for (const p of figure.parts) if (p !== torso && !rootOf(p)) out.push(p);
  return { ...figure, parts: out };
}

/**
 * 里侧的手臂改成往前伸：每条绕自己的肩关节转到身体正前方、离「垂直向下」INNER_ARM_DROP（照世界的方向算，不跟着上半身歪：
 * 跟着歪的话两个上半身里侧的手都往正中凑，碰在一起）。
 * 碰到同一边的胸、或者同一个肩膀上已经摆好的那几条（肩部聚拢的），就一档一档往上抬，抬到碰不着为止：
 * 手臂当成一根圆棒，胸当成一个球，在这个上半身自己的坐标里量。上下排的各在各的肩膀上，各抬各的。
 * q：这个上半身转了多少（手臂的朝向写在它的坐标里）；chests：这一边的胸
 */
function reachForward(arms: Part[], chests: Part[], q: Quat, toTorso: (p: V3) => V3, floor: number): Set<Part> {
  const placedRods: { from: V3; dir: V3; r: number }[] = [];
  // 肩关节靠前的先摆、放得低；靠后的往前伸要从前面那条上面过去
  const order = [...arms].sort((a, b) => b.pos[2] - a.pos[2]);
  // 一个肩膀上聚拢着三条以上的：往前伸的时候挤不下，只留最靠前的两条
  const extra = new Set<Part>();
  for (const part of order) {
    const crowd = order.filter((p) => !extra.has(p) && len(sub(p.pos, part.pos)) < SAME_SHOULDER);
    for (const p of crowd.slice(INNER_FAN_MAX)) extra.add(p);
  }
  for (const part of order) {
    if (extra.has(part)) continue;
    const from = part.pos;
    // 手臂多粗：照它自己的圆台（四肢调粗了跟着粗）
    const r = Math.max(ARM_RADIUS, ...part.prims.map((p) => (p.kind === 'cone' ? Math.max(p.ra, p.rb) : 0))) * (part.scale ?? 1);
    const dir0 = armDir(part);
    let drop = INNER_ARM_DROP;
    let dir = rotate(quatConj(q), [0, -Math.cos(drop), Math.sin(drop)]);
    const hits = (d: V3) =>
      // 伸到腰以下：靠下几排的会插进胯、大腿、马背里
      toTorso([from[0] + d[0] * ARM_REACH, from[1] + d[1] * ARM_REACH, from[2] + d[2] * ARM_REACH])[1] - r < floor ||
      chests.some((c) => segmentGap(from, d, ARM_REACH, c.pos) < r + bulk(c) - CROWD_MARGIN) ||
      placedRods.some((rod) => rodGap(from, d, rod.from, rod.dir) < r + rod.r - CROWD_MARGIN);
    while (hits(dir) && drop < INNER_ARM_TOP) {
      drop += INNER_ARM_STEP;
      dir = rotate(quatConj(q), [0, -Math.cos(drop), Math.sin(drop)]);
    }
    const turn = quatBetween(dir0, dir);
    part.quat = quatMul(turn, part.quat);
    // 融合、算权重时另摆的姿势（Part.bind）：原来是往两边平举张开，往前伸的手臂照那样转的话正好横着伸到旁边那个上半身那边，
    // 两个上半身里侧的手臂在那个姿势里交叉在一起，融成一块、权重混在一起（摆姿势时一条被另一个身子拽成长条）。
    // 改成往前抬平：每条抬一样多，同一个肩膀上的几条还是上下错开
    if (part.bind) {
      const lift = Math.min(drop + INNER_BIND_LIFT, INNER_ARM_TOP);
      part.bind = quatBetween(dir, rotate(quatConj(q), [0, -Math.cos(lift), Math.sin(lift)]));
    }
    placedRods.push({ from, dir, r });
  }
  return extra;
}

/**
 * 直立并排时一个上半身里侧的手臂（见 BESIDE_DROP）：往前伸、往自己那边（slot）偏一点，肩关节靠前的先摆，
 * 一个肩膀上往后一条再抬 BESIDE_STEP。方向照世界算（上半身歪的那一两度不跟着）。
 * 一个肩膀上聚拢着好几条的（肩部聚拢）：除了最后（抬得最高）那条，前面的肩关节一条比一条往下挪 BESIDE_LOWER——都从一个点出来的话，
 * 两条只差 BESIDE_STEP，根部融在一起，中间连成一片扁的蹼（正面看一道薄片，斜着看一把扇子）。
 * 挪下去的离胸近了，碰到同一边的胸（chests）就一档档往上抬，最多抬到比后一条低 BESIDE_APART。
 * 融合、算权重时另摆的姿势（Part.bind）抬到平举往前（和别的里侧手臂一样）
 */
function besideArms(arms: Part[], q: Quat, slot: number, chests: Part[]) {
  /** 离「垂直向下」drop、往自己那边偏 BESIDE_YAW 的方向，换到上半身的坐标里 */
  const toward = (drop: number) => rotate(quatConj(q), [slot * Math.sin(BESIDE_YAW) * Math.sin(drop), -Math.cos(drop), Math.cos(BESIDE_YAW) * Math.sin(drop)]);
  const order = [...arms].sort((a, b) => b.pos[2] - a.pos[2]);
  order.forEach((part, i) => {
    let drop = BESIDE_DROP + i * BESIDE_STEP;
    // 同一个肩膀上排在它后面的还有几条（上下排的各在各的肩膀上，不挪）
    const below = order.slice(i + 1).filter((other) => len(sub(other.pos, part.pos)) < SAME_SHOULDER).length;
    if (below > 0) {
      // 照竖直方向往下挪（上半身歪着，照它自己的「往下」挪的话往正中线凑，两个上半身里侧的肩关节靠得太近）
      part.pos = add(part.pos, rotate(quatConj(q), [0, -BESIDE_LOWER * below, 0]));
      const r = Math.max(ARM_RADIUS, ...part.prims.map((p) => (p.kind === 'cone' ? Math.max(p.ra, p.rb) : 0))) * (part.scale ?? 1);
      const top = drop + BESIDE_STEP - BESIDE_APART;
      while (drop < top && chests.some((c) => segmentGap(part.pos, toward(drop), ARM_REACH, c.pos) < r + bulk(c) - CROWD_MARGIN)) drop += INNER_ARM_STEP;
      drop = Math.min(drop, top);
    }
    const dir = toward(drop);
    part.quat = quatMul(quatBetween(armDir(part), dir), part.quat);
    if (part.bind) part.bind = quatBetween(dir, toward(Math.max(drop, Math.PI / 2)));
  });
}

/** 从 from 沿单位向量 dir 走 length 那一段，离点 p 最近多远 */
function segmentGap(from: V3, dir: V3, length: number, p: V3): number {
  const v = sub(p, from);
  const t = Math.max(0, Math.min(length, v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]));
  return len(sub(v, [dir[0] * t, dir[1] * t, dir[2] * t]));
}

/**
 * 两根圆棒（从各自的肩关节伸出 ARM_REACH 那么长）离得最近多远：沿 a 取几个点量，够用。
 * 肩头那一段（ARM_ROOT 以内）不算：同一个肩膀上的几条本来就挨在一起长出来
 */
function rodGap(a: V3, da: V3, b: V3, db: V3): number {
  let best = Infinity;
  for (let i = 0; i <= 8; i++) {
    const t = ARM_ROOT + ((ARM_REACH - ARM_ROOT) * i) / 8;
    best = Math.min(best, segmentGap(b, db, ARM_REACH, [a[0] + da[0] * t, a[1] + da[1] * t, a[2] + da[2] * t]));
  }
  return best;
}

/** 手臂（上臂）现在朝哪，写在父部件的坐标里 */
function armDir(part: Part): V3 {
  const upperArm = part.bones?.find((b) => b.name.startsWith('UpperArm'));
  const along = upperArm ? sub(upperArm.tail, upperArm.head) : ([0, -1, 0] as V3);
  return rotate(part.quat, len(along) > 1e-9 ? norm(along) : [0, -1, 0]);
}

/** 部件的世界变换（不算整体缩放）：父部件排在前面 */
function placed(parts: readonly Part[]): Map<string, { pos: V3; quat: Quat }> {
  const xf = new Map<string, { pos: V3; quat: Quat }>();
  for (const p of parts) {
    const parent = p.parent ? xf.get(p.parent) : { pos: [0, 0, 0] as V3, quat: Q_ID };
    if (parent) xf.set(p.name, { pos: add(parent.pos, rotate(parent.quat, p.pos)), quat: quatMul(parent.quat, p.quat) });
  }
  return xf;
}

/** 部件大概多大（离它自己的原点多远以内有东西）：胸、手臂根、翅膀根用 */
const bulk = (p: Part) =>
  Math.max(
    0.02,
    // 二次元素体的胸（ChestShape）不缩放部件，大小在基本体里：和以前照胸的大小缩放那一块一样量
    ...p.prims.map((q) => (q.kind === 'ellipsoid' ? Math.max(...q.radii) : q.kind === 'cone' ? Math.max(q.ra, q.rb) : q.kind === 'chest' ? 0.03 * Math.max(1, q.size) : 0.03)),
  ) * (p.scale ?? 1);
/** 离分界面至少留多远 */
const CROWD_MARGIN = 0.01;

/**
 * 挨着旁边那个上半身、长不下的去掉：两个上半身之间有一道分界面（法线是两个各自「往左」的方向的平均，过两个肩膀正中间），
 * 里侧的胸、翅膀从根部起就越过（或者贴着）这道面的、里侧的手臂肩关节已经过了这道面的——靠下几排的，插在两个身子合在一起的地方——不长。
 * 最上面一排的手臂、胸照 SHOULDER_GAP 歪开以后离这道面还有一段，留得下。
 * shoulder：躯干自己的坐标里两个肩膀正中间那一点
 */
function crowded(parts: Part[], slots: readonly number[], shoulder: V3): Part[] {
  const xf = placed(parts);
  const order = [...slots].sort((a, b) => a - b);
  const gone = new Set<string>();
  for (let i = 0; i + 1 < order.length; i++) {
    const [right, left] = [`UpperBody${sideTag(order[i])}`, `UpperBody${sideTag(order[i + 1])}`];
    const a = xf.get(right);
    const b = xf.get(left);
    if (!a || !b) continue;
    const n = norm(add(rotate(a.quat, [1, 0, 0]), rotate(b.quat, [1, 0, 0])));
    const mid = mulAdd(add(a.pos, rotate(a.quat, shoulder)), add(b.pos, rotate(b.quat, shoulder)), 0.5);
    for (const p of parts) {
      // 右边那个上半身的左侧、左边那个的右侧
      const facing = p.parent === right ? 1 : p.parent === left ? -1 : 0;
      if (!facing || p.side !== facing || (p.type !== 'chest' && p.type !== 'arm' && p.type !== 'wing')) continue;
      const at = xf.get(p.name)!.pos;
      const d = facing * (at[0] * n[0] + at[1] * n[1] + at[2] * n[2] - (mid[0] * n[0] + mid[1] * n[1] + mid[2] * n[2]));
      // 手臂只看肩关节是不是已经过了这道面（插进旁边那个身子里了）：没过的往前伸，留着（见 reachForward）
      if (p.type === 'arm' ? d > 0 : d > -(bulk(p) + CROWD_MARGIN)) gone.add(p.name);
    }
  }
  if (!gone.size) return parts;
  // 连同长在它上面的
  const dropped = (p: Part): boolean => gone.has(p.name) || (p.parent !== undefined && gone.has(p.parent));
  return parts.filter((p) => !dropped(p));
}

const mulAdd = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * 胯照腿排开了的（GridShape.tile）：腿手动左右挪过的，胯上排开的地方跟着腿现在在哪（不然胯里的大腿根还在原处，和腿错开一截）。
 * 照这副胯上和躯干直接取并集的那几条腿（见 Part.fuseAs），躯干自己的坐标
 */
function followLegs(figure: Figure): Figure {
  const torso = figure.parts.find((p) => p.name === 'Torso');
  const grid = torso?.prims.find((q): q is GridShape => q.kind === 'grid' && !!q.tile);
  if (!torso || !grid) return figure;
  const xs = figure.parts
    .filter((p) => p.type === 'leg' && p.fuseAs === 'torso')
    .map((p) => p.pos[0] - torso.pos[0])
    .sort((a, b) => a - b);
  const legs = grid.tile!.legs;
  if (xs.length !== legs.length || xs.every((x, k) => Math.abs(x - legs[k]) < 1e-9)) return figure;
  const moved: GridShape = { ...grid, tile: { ...grid.tile!, legs: xs } };
  return { ...figure, parts: figure.parts.map((p) => (p === torso ? { ...p, prims: p.prims.map((q) => (q === grid ? moved : q)) } : p)) };
}

/**
 * 手动微调挪过、转过某个上半身以后（见 tweak.ts）：它从胯上分出去的那一段照它现在的摆放重新定——分足以后就是挪过、转过的样子，
 * 分开之前还在胯上，腰跟着拉长、拧过去，不会和胯断开、错出一道台阶。旁边的上半身照它们现在的摆放分界。
 * 没有微调的时候算出来和原来一样
 */
export function refork(given: Figure): Figure {
  const figure = followLegs(given);
  // 只从躯干自身的分叉取摆放，忽略挂载格子坐标系中的分叉。
  const forkOf = (p: Part): Fork | undefined => {
    for (const q of p.prims) if ((q.kind === 'grid' || q.kind === 'loft') && q.fork && !q.fork.frame) return q.fork;
    return undefined;
  };
  /** 这个上半身现在怎么摆：照同一个 pivot 换算成转了多少、挪了多少 */
  const placement = (p: Part, fork: Fork) => {
    const shape = shapeMatrix(p) ?? [1,0,0,0,1,0,0,0,1] as const;
    const reshape = shape.map(v => v * (p.scale ?? 1)) as Mat3;
    const changed = reshape.some((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)) > 1e-9);
    return { quat: p.quat, shift: sub(p.pos, sub(fork.pivot, rotate(p.quat, mat3Apply(reshape, fork.pivot)))), reshape: changed ? reshape : undefined };
  };
  const now = new Map<string, ReturnType<typeof placement>>();
  for (const p of figure.parts) {
    const fork = forkOf(p);
    if (fork) now.set(p.name, placement(p, fork));
  }
  if (!now.size) return figure;
  /** 每个上半身重新定好的那一份 */
  const forks = new Map<string, Fork>();
  const bodies = figure.parts.map((p) => {
    const mine = now.get(p.name);
    if (!mine) return p;
    const prims = p.prims.map((q): Prim => {
      if ((q.kind !== 'grid' && q.kind !== 'loft') || !q.fork) return q;
      const split = q.fork.split?.map((s) => ({ ...s, ...(now.get(s.part) ?? {}) }));
      const fork = { ...q.fork, ...mine, ...(split ? { split } : {}) };
      forks.set(p.name, fork);
      return { ...q, fork };
    });
    return { ...p, prims };
  });
  // 胯上半截加宽的那一段（见 SPLIT_HALF）照几个上半身现在实际往两边挪了多少改（手动挪过的）
  const outward = [...forks.values()].map((fork) => Math.abs(fork.shift[0])).filter((x) => x > 1e-6);
  // 坐在座位上的（见 SEAT）：座位照几个上半身的腰现在实际往两边挪了多少（上下、前后挪的跟着转那一段走，切口那里没挪，见 Fork.shiftFrom）
  const seats = bodies
    .filter((p) => forks.has(p.name))
    .map((p) => add(p.pos, rotate(p.quat, forks.get(p.name)!.pivot))[0])
    .sort((a, b) => a - b);
  const pelvised = bodies.map((p): Part => {
    if (!outward.length || p.name !== 'Torso') return p;
    const amount = outward.reduce((a, b) => a + b, 0) / outward.length;
    const one = [...forks.values()][0];
    const prims = p.prims.map((q): Prim => {
      if (q.kind === 'grid' && q.tile?.seats) return { ...q, tile: { ...q.tile, seats, ...seatLevels(q.tile, seats) } };
      if (q.kind !== 'grid' || !q.widenX || one.shiftFrom === undefined) return q;
      const mid = (one.shiftFrom + one.shiftTo!) / 2;
      const f = q.spreadX ? spreadAt(q.spreadX, mid) : 1;
      const widenX = q.widenX.map((band): WidenBand => (band[1] === one.shiftFrom && band[2] === one.shiftTo ? [amount / f, band[1], band[2], band[3]] : band));
      return { ...q, widenX };
    });
    return { ...p, prims };
  });
  // 二次元素体的胸（ChestShape）贴着的那块躯干，换成它挂着的那个上半身的躯干（带着从胯上分出去的那一段，不要切口）：
  // 胸部件不转不缩放，它的坐标挪回 origin 就是上半身的坐标。分出去的那一段照胸中心那个高度整块转、挪（见 Fork.freeze）
  const bodiesOf = new Map(pelvised.filter((p) => forks.has(p.name)).map((p) => [p.name, p.prims.find((q): q is GridShape => q.kind === 'grid')]));
  // 两个上半身：里侧的胸在两个身子正中间（照两个上半身现在摆在胯上哪儿）切齐，和旁边那只挤在一起（见 ChestShape.seam）
  /** 上半身的腰（分叉的支点）摆在胯上哪儿（离正中线多远） */
  const waistAt = (p: Part) => add(p.pos, rotate(p.quat, forks.get(p.name)!.pivot))[0];
  const bodyList = pelvised.filter((p) => forks.has(p.name));
  /** 直立并排的（两个、三个都是）：这个上半身 side 那一边挨着的那个上半身和它的腰正中间在哪；没挨着的是 undefined */
  const seamAt = (up: Part, side: number): number | undefined => {
    const me = waistAt(up);
    const next = bodyList.filter((q) => q !== up && Math.sign(waistAt(q) - me) === side).sort((a, b) => Math.abs(waistAt(a) - me) - Math.abs(waistAt(b) - me))[0];
    return next ? (me + waistAt(next)) / 2 : undefined;
  };
  const parts = pelvised.map((p): Part => {
    const body = p.parent ? bodiesOf.get(p.parent) : undefined;
    if (p.type !== 'chest' || !body) return p;
    const up = pelvised.find((q) => q.name === p.parent)!;
    /** 这只胸那一边挨着别的上半身的话，在两个腰正中间切 */
    const middle = seamAt(up, p.side);
    const toward = middle === undefined ? 0 : p.side;
    const r0 = rotate(quatConj(up.quat), [1, 0, 0]);
    const seam: [number, number, number, number] | undefined =
      toward ? [toward * r0[0], toward * r0[1], toward * r0[2], toward * (middle! - up.pos[0])] : undefined;
    const own: GridShape = {
      ...body,
      name: 'Torso',
      clipBelow: undefined,
      clipAbove: undefined,
      clipRound: undefined,
      twin: undefined,
      ...(body.fork ? { fork: { ...body.fork, freeze: p.pos[1] } } : {}),
    };
    return { ...p, prims: p.prims.map((q): Prim => (q.kind === 'chest' ? { ...q, body: own, ...(seam ? { seam } : {}) } : q)) };
  });
  return { ...figure, parts };
}

/** 一个椭球最高到哪（转过的照转过以后的样子量） */
function carveTop(p: Prim): number {
  if (p.kind !== 'ellipsoid') return -Infinity;
  const axes: V3[] = [
    [p.radii[0], 0, 0],
    [0, p.radii[1], 0],
    [0, 0, p.radii[2]],
  ];
  const up = axes.map((a) => (p.quat ? rotate(p.quat, a) : a)[1]);
  return p.center[1] + Math.hypot(up[0], up[1], up[2]);
}

/**
 * 一个挂在躯干上的部件（胸、手臂根、翅膀根）的下沿多高，不算它自己的转动：采样好的照它的格子量，拼的照椭球、圆台量。
 * 手臂的格子是平举着存的，量出来的就是肩头那一截的下沿（腋下）
 */
function partBottom(p: Part): number {
  const s = p.scale ?? 1;
  let low = Infinity;
  for (const q of p.prims) {
    if (q.kind === 'ellipsoid') low = Math.min(low, p.pos[1] + (q.center[1] - q.radii[1]) * s);
    else if (q.kind === 'grid') low = Math.min(low, p.pos[1] + getGrid(q.grid).bounds.min[1] * s);
    else if (q.kind === 'cone') low = Math.min(low, p.pos[1] + (Math.min(q.a[1] - q.ra, q.b[1] - q.rb)) * s);
  }
  return Number.isFinite(low) ? low : p.pos[1] - 0.03 * s;
}
