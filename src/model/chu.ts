/**
 * 楚云萱用体块拼（docs/chu-blocks-plan.md）：九副胯（前、中、后三排，每排三副，都朝正前）各带一双腿，
 * 前排、后排每副胯上接一个胸腔（各带自己的头、脖子、手臂、胸），后排的转过去、两排背靠背；
 * 中间一排接的是光的胸腔（不带头、手臂、胸），夹在两排后背中间。每一块都是能单独选中、挪、转、删的体块，不叠整人。
 * 纯函数，不碰 three.js 和 DOM。
 */
import { animeReady } from '../anime/body';
import { type Part, worldTransforms } from '../geometry/figure';
import { buildFigure } from '../geometry/layout';
import { type Quat, type V3, add, eulerOf, norm, quatBetween, quatConj, quatEuler, quatMul, rotate, sub } from '../geometry/vec';
import { castRay, compileField } from '../sdf/field';
import { addBlock, canSplitTorso, setSplitTorso } from './blocks';
import { type Attached, type BodySpec, type PartOverride, clampShape, cleanOverride } from './spec';

const DEG = Math.PI / 180;

export const CHU = {
  /** 相邻两副胯左右、前后隔多远：一副胯连大腿最宽、最厚的地方的多少倍（1 是正好贴着） */
  fitX: 1,
  fitZ: 1.06,
  /** 前排、后排连腿一起往中间斜多少度（侧面看是「人」字，脚比胯分得开） */
  legLean: 4,
  /** 前排、后排的胸腔绕腰往后靠，靠到头的中心离前后正中这么远（两排头背对背正好碰上） */
  headBack: 0.1,
  /** 两头的胸腔绕腰往中间歪，歪到头的中心离左右正中这么远（头凑成一簇）；往外转多少度 */
  headApart: 0.15,
  yaw: 40,
  /** 中间一排两头的光胸腔：后背朝外，往中间歪多少度 */
  midInward: 10,
  /**
   * 留下的三条手臂从上到下各抬多少度（从水平算，往上为正），各往自己那一排（前排往前、后排往后）偏多少度：前后两把分得开。
   * 最上面一排两头那只胸绕到了肩膀底下的侧面，最下面那条手臂抬到差不多水平、从它上面伸出去（再往下就从胸里穿过去了）
   */
  arms: [40, 16, -8],
  armFront: [14, 5, 0],
};

/**
 * 楚云萱的数量、排法、体型：每个胸腔三对手臂（肩部聚拢）、正中一只胸（左右对称、没有切面的那种，
 * 前后两面的胸都是照它整只复制的，见 chuBlocks）。体型是他在工坊里调好存下来的那一份（楚云萱 ver1）的：高个子、长腿、大胸、粗大腿
 */
export const CHU_BODY = {
  counts: { torsos: 1, heads: 1, armPairs: 3, breasts: 1, legs: 2 },
  armLayout: 'fan',
  chestRow: 1,
  shape: { height: 1.98, headRatio: 7.5, build: 1.1, bust: 3.4, hips: 1, thighs: 1.45, armLength: 1.19, legLength: 1.2 },
} as const;

/** 一面的一只胸：挂在哪一列的胸腔上（背面那一面的；前面是对面那一列），照那个胸腔正中那只原胸型挪多少、再怎么微调，有的还整只缝在胸腔上 */
interface ChuChest {
  row: number;
  col: -1 | 0 | 1;
  shift: V3;
  position?: V3;
  rotation?: V3;
  scale: V3;
  /** 整只缝在胸腔上的（他点「接到…」吸在胸口那个接口上的）：离原胸多远（和 shift 一样跟着原胸走，躯干接长了一起上去）、朝向、大小 */
  sewn?: { offset: V3; quat: Quat; scale: number };
}
/**
 * 一面的 15 只胸（从上到下 6、5、4 只）：他手调好的背面那一面，原样照抄（左右不完全对称也照抄）。
 * 数都在挂着它的那个胸腔自己的坐标里，前后两面共用（见 chuBlocks）
 */
export const CHU_CHESTS: readonly ChuChest[] = [
  { row: 0, col: -1, shift: [0.059, 0.0406, -0.0521], position: [-0.0169, 0, 0.0172], rotation: [0, 36, 0], scale: [0.75, 0.75, 1] },
  { row: 0, col: 0, shift: [0.219, 0.0443, -0.0185], position: [-0.0112, 0, 0.0237], rotation: [-3.96, 38.97, 7.09], scale: [0.75, 0.75, 1] },
  { row: 0, col: 0, shift: [0.071, 0.0454, -0.0323], position: [0, 0, 0.0769], rotation: [0, 15.24, 0], scale: [0.75, 0.75, 1] },
  { row: 0, col: 0, shift: [-0.071, 0.0454, -0.0321], position: [0, 0, 0.0735], rotation: [0, -15.24, 0], scale: [0.75, 0.75, 1] },
  { row: 0, col: 0, shift: [-0.219, 0.0443, -0.0187], position: [-0.024, 0, 0.0222], rotation: [-3.96, -38.97, -7.09], scale: [0.75, 0.75, 0.85] },
  { row: 0, col: 1, shift: [-0.0591, 0.0406, -0.0519], position: [0.0249, 0, 0.0072], rotation: [0, -36, 0], scale: [0.75, 0.75, 1] },
  { row: 1, col: -1, shift: [0.0662, -0.1414, -0.0361], position: [-0.0431, 0, 0.0054], scale: [0.909, 0.909, 1.211], sewn: { offset: [0, -0.1278, -0.0924], quat: [0, 0.03106, 0, 0.99952], scale: 0.8263 } },
  { row: 1, col: 0, shift: [0.2026, -0.1257, -0.0069], position: [-0.0398, 0, 0], rotation: [0, 14.93, 0], scale: [0.75, 0.75, 1] },
  { row: 1, col: 0, shift: [0, -0.1246, -0.0203], position: [0, 0, 0.0172], scale: [0.75, 0.75, 1] },
  { row: 1, col: 0, shift: [-0.2026, -0.1257, -0.0073], position: [0.0439, 0, 0], rotation: [0, -18.16, 0], scale: [0.75, 0.75, 1] },
  { row: 1, col: 1, shift: [-0.0663, -0.1414, -0.036], position: [0.0388, 0, 0.0202], scale: [0.909, 0.909, 1.211], sewn: { offset: [0, -0.1278, -0.0924], quat: [0, -0.11121, 0, 0.9938], scale: 0.8258 } },
  { row: 2, col: 0, shift: [0.2672, -0.2937, -0.021], position: [-0.0215, 0.0423, -0.0515], rotation: [12.25, 21.99, -4.45], scale: [0.75, 0.75, 1] },
  { row: 2, col: 0, shift: [0.0882, -0.293, -0.0288], position: [0, 0.0418, 0], rotation: [8.87, 18.73, -2.87], scale: [0.75, 0.75, 0.8] },
  { row: 2, col: 0, shift: [-0.0882, -0.293, -0.0287], position: [0, 0.0356, 0], rotation: [7.67, -18.78, 2.48], scale: [0.75, 0.75, 0.8] },
  { row: 2, col: 0, shift: [-0.2672, -0.2937, -0.021], position: [0, 0.0372, 0], rotation: [10.93, -27.63, 4.92], scale: [0.75, 0.75, 0.75] },
];
/** 一面的胸从上到下每排几只 */
export const CHEST_ROWS = [0, 1, 2].map((r) => CHU_CHESTS.filter((e) => e.row === r).length);

/**
 * 照楚云萱的数量、体型摆好，再拼成体块（别的设定：身高、头发、样式……照 base 的）。
 * 预设「楚云萱」在二次元素体上做的就是这件事（见 presets.ts）；摆位的数都是照二次元素体调的，白模人台上摆出来不对
 * （三列身子分开、手臂方向不对、胸之间有空），那边预设还是用围成一圈里的前后排
 */
export function chuSpec(base: BodySpec): BodySpec {
  if (!buildable({ ...base, conjoined: 'none', ring: 'none' })) return base;
  const shaped: BodySpec = { ...base, counts: { ...base.counts, ...CHU_BODY.counts }, armLayout: CHU_BODY.armLayout, chestRow: CHU_BODY.chestRow, shape: clampShape({ ...base.shape, ...CHU_BODY.shape }) };
  return chuBlocks({
    ...shaped,
    shape: clampShape({ ...shaped.shape, torso: evenTorso(shaped) }),
  });
}

/** 这副身体现在拼不拼得了体块：成品角色拼不了；素体的数据还没取回来（刚打开页面）量不了身体，也先不拼 */
const buildable = (spec: BodySpec): boolean => canSplitTorso(spec) && (spec.bodyStyle !== 'anime' || animeReady());

/** 一把手臂里第 i 条（共 n 条）取多少：正好是 list 那么多条时就是 list 里的数，别的条数在头尾之间匀开（一条取中间那个） */
const spread = (list: readonly number[], i: number, n: number): number =>
  n === list.length ? list[i] : n <= 1 ? list[list.length >> 1] : list[0] + ((list[list.length - 1] - list[0]) * i) / (n - 1);

const aboutY = (a: number): Quat => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
/** 每排三副胯从哪一副起排：正中、左、右 */
const COLS = [0, 1, -1];
/** 前排、中间一排、后排 */
const ROWS = [1, 0, -1];

/**
 * 一副胯连它的两条腿左右多宽、前后多厚（胯到大腿中段最宽、最厚的地方）：九副胯照它排成正好贴着——
 * 每副胯、臀、腿都是完整的，不叠在一起，也不留空
 */
function hipBulk(parts: readonly Part[]): { wide: number; thick: number } {
  const own = parts.filter((p) => p.name === 'Torso' || (p.type === 'leg' && p.parent === undefined));
  const legs = own.filter((p) => p.type === 'leg');
  if (!legs.length) return { wide: 0.3, thick: 0.2 };
  const field = compileField({ scale: 1, parts: own }, { blend: 0 });
  const FAR = 1;
  const hipY = legs[0].pos[1];
  let wide = 0;
  let thick = 0;
  for (let y = hipY - 0.32; y <= hipY + 0.08; y += 0.02) {
    const right = castRay(field, [FAR, y, legs[0].pos[2]], [-1, 0, 0], 2 * FAR);
    const left = castRay(field, [-FAR, y, legs[0].pos[2]], [1, 0, 0], 2 * FAR);
    if (right < 2 * FAR && left < 2 * FAR) wide = Math.max(wide, 2 * FAR - right - left);
    for (const x of [0, legs[0].pos[0]]) {
      const front = castRay(field, [x, y, FAR], [0, 0, -1], 2 * FAR);
      const back = castRay(field, [x, y, -FAR], [0, 0, 1], 2 * FAR);
      if (front < 2 * FAR && back < 2 * FAR) thick = Math.max(thick, 2 * FAR - front - back);
    }
  }
  return { wide: wide > 0.05 ? wide : 0.3, thick: thick > 0.05 ? thick : 0.2 };
}

/**
 * 一副没拼体块的身体（一个头、直着站）头顶到裆比裆到地面长多少（负的是短）。
 * 头顶是从头的正上方照下来碰到的地方；裆只量胯自己的底——大腿粗的时候两条腿在膝盖上面一点就并在一起了，连腿一起量会量到那里去
 */
function upperOverLegs(spec: BodySpec): number | null {
  const figure = buildFigure({ ...spec, conjoined: 'none', ring: 'none', torsoCounts: {}, blocks: undefined, overrides: {} });
  const body = figure.parts.filter((p) => p.type === 'torso' || p.type === 'leg' || p.type === 'neck' || p.type === 'head');
  const leg = body.find((p) => p.type === 'leg' && p.parent === undefined);
  const head = worldTransforms({ parts: figure.parts, scale: 1 }).get('Head_01')?.pos;
  if (!leg || !head) return null;
  const all = compileField({ scale: 1, parts: body }, { blend: 0 });
  const hips = compileField({ scale: 1, parts: body.filter((p) => p.type === 'torso') }, { blend: 0 });
  const FAR = 3;
  const above = castRay(all, [head[0], head[1] + 1, head[2]], [0, -1, 0], FAR);
  const below = castRay(hips, [0, -0.5, leg.pos[2]], [0, 1, 0], FAR);
  if (!(above < FAR && below < FAR)) return null;
  const top = head[1] + 1 - above;
  const crotch = below - 0.5;
  return top - crotch - crotch;
}

/**
 * 「躯干长短」取多少，上半身和腿才一样长（头顶到裆 = 裆到地面，参考的线稿就是这个比例）：三排胸排在肩膀和裆之间，
 * 最下面一排不压在屁股上。躯干是在小腹那一段接长的（见 animeLayout.ts 的 TORSO_BAND），差多少和滑块是一条直线，量两个值就解得出
 */
function evenTorso(spec: BodySpec): number {
  const at = (torso: number) => upperOverLegs({ ...spec, shape: { ...spec.shape, torso } });
  const [a, b] = [at(1), at(1.3)];
  if (a === null || b === null || Math.abs(b - a) < 1e-6) return spec.shape.torso;
  return Math.round((1 - (a * 0.3) / (b - a)) * 100) / 100;
}

/** 躯干分成两块、手工的体块清空以后，照前后排的样子把胯、胸腔一块一块复制出来摆好 */
export function chuBlocks(given: BodySpec): BodySpec {
  // 连体、围成一圈、每个上半身单独设的数量和体块拼不到一起：先去掉
  const base: BodySpec = { ...given, conjoined: 'none', ring: 'none', torsoCounts: {} };
  if (!buildable(base)) return given;
  let spec = setSplitTorso({ ...base, blocks: { added: [] }, overrides: {} }, true);
  const plain = buildFigure(spec);
  const xfs = worldTransforms({ parts: plain.parts, scale: 1 });
  const hip = xfs.get('Torso')!;
  const rib = xfs.get('UpperBody')!;
  const back = quatConj(hip.quat);
  /** 胸腔本来坐在胯上的位置（胯的坐标里） */
  const seat = { pos: rotate(back, sub(rib.pos, hip.pos)) as V3, quat: quatMul(back, rib.quat) };
  /** 腰上那一点（胸腔绕它歪、转），胯的坐标里 */
  const ribGrid = plain.parts.find((p) => p.name === 'UpperBody')!.prims.find((q) => q.kind === 'grid');
  const fork = ribGrid?.kind === 'grid' ? ribGrid.fork : undefined;
  /**
   * 「躯干长短」接长的那一截在腰下面，是直的；胸腔从它顶上才往中间斜（斜的支点抬这么高）：
   * 往上斜成什么样和没接长时一样（ver1 那样，侧面看中间一排的后背露得出来），只是整个上半身高了这一截
   */
  const lift = ribGrid?.kind === 'grid' ? (ribGrid.stretchY?.[2] ?? 0) : 0;
  const waist = add(seat.pos, rotate(seat.quat, add(fork?.pivot ?? [0, 0.96, 0], [0, lift, 0])));

  const bulk = hipBulk(plain.parts);
  const stepX = bulk.wide * CHU.fitX;
  const stepZ = bulk.thick * CHU.fitZ;
  /** 胯连腿一起斜是绕哪一点转的（胯自己的坐标里；见 tweak.ts 的 place） */
  const hinge: V3 = plain.parts.find((p) => p.name === 'Torso')?.pivot ?? [0, 0, 0];
  /**
   * 前排、后排连腿一起往中间斜：髋关节那么高上相邻两排正好贴着（隔 stepZ），脚比胯分得开——
   * 斜是绕 hinge 转的，髋关节跟着往中间挪了这么多，摆的时候先往外让出来
   */
  const hipY = (plain.parts.find((p) => p.type === 'leg' && p.parent === undefined)?.pos[1] ?? waist[1]) - hip.pos[1] - hinge[1];
  const drift = Math.tan(CHU.legLean * DEG) * hipY;

  /* 九副胯：原来那副在正中（中间一排的中间），另外八副照它复制 */
  const pelvis: string[][] = ROWS.map(() => []);
  const overrides: Record<string, PartOverride> = {};
  ROWS.forEach((rz, r) => {
    COLS.forEach((cx, c) => {
      let name = 'Torso';
      if (!(rz === 0 && cx === 0)) {
        const made = addBlock(spec, [{ from: 'Torso', shift: [cx * stepX, 0, rz * (stepZ + drift)] }]);
        spec = made.spec;
        name = made.names[0];
      }
      pelvis[r][c] = name;
      if (rz !== 0 && CHU.legLean) overrides[name] = { rotation: [-rz * CHU.legLean, 0, 0] };
    });
  });

  /**
   * 胸腔绕腰转 yaw、再歪到 dir 这个方向，接在 to 这副胯上。转得多的（中间一排、后排）整块接（Attached.whole）：
   * 从胯上渐渐分出去的那种接法腰是渐渐拧的，转了半圈看着像拧麻花
   */
  const seated = (to: string, yaw: number, dir: V3): Attached => {
    const turn = quatMul(quatBetween([0, 1, 0], norm(dir)), aboutY(yaw));
    const q = quatMul(turn, seat.quat);
    const quat: Quat = q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q;
    return { to, pos: add(waist, rotate(turn, sub(seat.pos, waist))), quat, scale: 1, ...(Math.cos(yaw) < 0.5 ? { whole: true } : {}) };
  };
  /** 从腰到头的中心（胯的坐标里，胸腔还直着坐在胯上时） */
  const toHead = sub(xfs.get('Head_01')?.pos ?? add(waist, [0, 0.7, 0]), add(hip.pos, waist));
  const reach = Math.hypot(...toHead);
  /**
   * 胸腔绕腰转 yaw 以后往哪歪（胯的坐标里），头的中心才落在离这副胯没斜时的腰 (dx, dz) 的地方（水平方向）。
   * 胯连腿斜了 tilt，胸腔跟着它斜；头不在脊柱正上方，转过以后偏的方向也跟着转——所以量着头实际落在哪再修正几遍
   */
  const aimed = (yaw: number, tilt: Quat, dx: number, dz: number): V3 => {
    // 腰跟着胯斜过去挪了多少
    const moved = sub(add(hinge, rotate(tilt, sub(waist, hinge))), waist);
    let ax = dx;
    let az = dz;
    let dir: V3 = [0, 1, 0];
    for (let i = 0; i < 8; i++) {
      dir = norm([ax, Math.sqrt(Math.max(reach * reach - ax * ax - az * az, 1e-4)), az]);
      const head = add(moved, rotate(tilt, rotate(quatMul(quatBetween([0, 1, 0], dir), aboutY(yaw)), toHead)));
      ax += dx - head[0];
      az += dz - head[2];
    }
    return dir;
  };
  const attach: Record<string, Attached> = {};
  /** 每个胸腔：名字、在哪一列、哪一排 */
  const ribs: { name: string; cx: number; rz: number }[] = [];
  ROWS.forEach((rz, r) => {
    COLS.forEach((cx, c) => {
      let name = 'UpperBody';
      if (!(rz === 0 && cx === 0)) {
        const made = addBlock(spec, [{ from: 'UpperBody' }]);
        spec = made.spec;
        name = made.names[0];
      }
      ribs.push({ name, cx, rz });
      if (rz !== 0) {
        const yaw = rz > 0 ? cx * CHU.yaw * DEG : Math.PI - cx * CHU.yaw * DEG;
        // 头要落在哪（离这副胯的腰多远）：左右离正中 headApart（正中那列就在正中）、前后离正中 headBack
        attach[name] = seated(pelvis[r][c], yaw, aimed(yaw, quatEuler(-rz * CHU.legLean * DEG, 0, 0), cx * (CHU.headApart - stepX) - waist[0], rz * (CHU.headBack - stepZ - drift) - waist[2]));
      } else attach[name] = seated(pelvis[r][c], (-cx * Math.PI) / 2, [-cx * Math.tan(CHU.midInward * DEG), 1, 0]);
    });
  });
  spec = { ...spec, blocks: { ...spec.blocks!, attach }, overrides: { ...spec.overrides, ...overrides } };

  /* 手臂只留两头的胸腔朝外那一侧的；中间一排的胸腔是光的：头、手臂、胸都不要 */
  const figure = buildFigure(spec);
  const hidden: Record<string, PartOverride> = {};
  for (const p of figure.parts) {
    const on = ribs.find((b) => b.name === p.parent);
    if (!on) continue;
    const outer = on.cx * on.rz;
    const gone = on.rz === 0 ? p.type === 'head' || p.type === 'arm' || p.type === 'chest' : p.type === 'arm' && (outer === 0 || Math.sign(p.side) !== Math.sign(outer));
    if (gone) hidden[p.name] = { ...spec.overrides[p.name], hidden: true };
  }
  /*
   * 胸：每个带头的胸腔正中那只原胸型不要了，照它整只复制。前后两面各 15 只（从上到下 6、5、4 只），
   * 位置、朝向、大小是他在工坊里手调好的背面那一面（CHU_CHESTS，量在挂着它的那个胸腔自己的坐标里）；
   * 后排是前排整个绕竖轴转了半圈，所以前面照同一份数摆在对面那一列的胸腔上，两面一样。
   * 胸跟着胸口走：躯干在小腹那一段接长（「躯干长短」，见 chuSpec）以后整片胸一起上去，不压在屁股上
   */
  const placed = worldTransforms({ parts: figure.parts, scale: 1 });
  const heads = ribs.filter((b) => b.rz !== 0);
  const sources = new Map(heads.map((b) => [b.name, figure.parts.find((p) => p.parent === b.name && p.type === 'chest')]));
  const turned: Record<string, PartOverride> = {};
  const sewn: Record<string, Attached> = {};
  for (const rz of [1, -1]) {
    const row = heads.filter((b) => b.rz === rz);
    if (row.some((b) => !sources.get(b.name))) continue;
    for (const e of CHU_CHESTS) {
      const host = row.find((b) => b.cx === (rz < 0 ? e.col : -e.col));
      if (!host) continue;
      const source = sources.get(host.name)!;
      const made = addBlock(spec, [{ from: source.name, shift: e.shift, plain: true, piece: true }]);
      spec = made.spec;
      turned[made.names[0]] = { ...(e.position && { position: e.position }), ...(e.rotation && { rotation: e.rotation }), scale: e.scale };
      if (e.sewn) sewn[made.names[0]] = { to: host.name, pos: add(source.pos, e.sewn.offset), quat: e.sewn.quat, scale: e.sewn.scale };
    }
    for (const b of row) hidden[sources.get(b.name)!.name] = { hidden: true };
  }
  if (Object.keys(sewn).length) spec = { ...spec, blocks: { ...spec.blocks!, attach: { ...spec.blocks!.attach, ...sewn } } };
  /* 留下的手臂：每个胸腔朝外那一侧三条，朝整个身子的正侧面排成上、中、下一把（照整个身子的方向定，不照歪着、转过的胸腔定） */
  for (const on of ribs) {
    const kept = figure.parts.filter((p) => p.parent === on.name && p.type === 'arm' && !hidden[p.name]).sort((a, b) => a.name.localeCompare(b.name));
    const frame = placed.get(on.name);
    if (!frame) continue;
    kept.forEach((arm, i) => {
      const bone = arm.bones?.[0];
      if (!bone) return;
      const now = norm(rotate(arm.quat, sub(bone.tail, bone.head)));
      const up = spread(CHU.arms, i, kept.length) * DEG;
      const front = spread(CHU.armFront, i, kept.length) * DEG;
      const want = rotate(quatConj(frame.quat), [on.cx * Math.cos(up) * Math.cos(front), Math.sin(up), on.rz * Math.cos(up) * Math.sin(front)]);
      const e = eulerOf(quatBetween(now, norm(want)));
      hidden[arm.name] = { ...spec.overrides[arm.name], rotation: [e[0] / DEG, e[1] / DEG, e[2] / DEG] };
    });
  }
  /*
   * 两边四个头的脖子竖起来：胸腔往中间歪，脖子跟着歪了十几度，看着是歪的。脖子绕根部转到竖直，
   * 头接在脖子上（和手动「接到…」一样，见 Attached），跟着一起转
   */
  const upright: Record<string, Attached> = {};
  for (const on of ribs) {
    if (on.rz === 0 || on.cx === 0) continue;
    const neck = figure.parts.find((p) => p.parent === on.name && p.type === 'neck');
    const head = figure.parts.find((p) => p.parent === on.name && p.type === 'head');
    const frame = placed.get(on.name);
    const bone = neck?.bones?.[0];
    if (!neck || !head || !frame || !bone) continue;
    const now = norm(rotate(neck.quat, sub(bone.tail, bone.head)));
    const e = eulerOf(quatBetween(now, norm(rotate(quatConj(frame.quat), [0, 1, 0]))));
    hidden[neck.name] = { ...spec.overrides[neck.name], rotation: [e[0] / DEG, e[1] / DEG, e[2] / DEG] };
    const back = quatConj(neck.quat);
    const k = neck.scale ?? 1;
    const pos = rotate(back, sub(head.pos, neck.pos));
    upright[head.name] = { to: neck.name, pos: [pos[0] / k, pos[1] / k, pos[2] / k], quat: quatMul(back, head.quat), scale: (head.scale ?? 1) / k };
  }
  if (Object.keys(upright).length) spec = { ...spec, blocks: { ...spec.blocks!, attach: { ...spec.blocks!.attach, ...upright } } };
  // 和存档读回来的一样去掉多余的小数、等于没改的分量（spec.ts 的 cleanOverride）：存一遍再读，拼出来的还是这一份
  const tidy: Record<string, PartOverride> = {};
  for (const [name, o] of Object.entries({ ...spec.overrides, ...hidden, ...turned })) {
    const clean = cleanOverride(o);
    if (clean) tidy[name] = clean;
  }
  // 二次元素体上整个上半身换成一整块「楚云萱躯干」（数据取回来以后；见 geometry/trunk.ts）
  return { ...spec, blocks: { ...spec.blocks!, ...(spec.bodyStyle === 'anime' && { trunk: 'chu' as const }) }, overrides: tidy };
}

/* ---------------- 套完以后又拖了体型滑块：照新的体型重新摆 ---------------- */

/** 存档读回来时微调、缝合的数会去掉多余的小数（spec.ts 的 cleanOverride、cleanBlocks），差这么一点算一样 */
const NEAR = { position: 2e-4, rotation: 0.02, scale: 2e-3 };
const near = (a: readonly number[] | undefined, b: readonly number[] | undefined, zero: number, tol: number, n = 3): boolean => {
  for (let i = 0; i < n; i++) if (!(Math.abs((a?.[i] ?? zero) - (b?.[i] ?? zero)) <= tol)) return false;
  return true;
};

/** 两份设定的体块（加了哪些、谁接在谁上、每个部件的微调）是不是一样 */
function sameBuild(a: BodySpec, b: BodySpec): boolean {
  const [x, y] = [a.blocks, b.blocks];
  if (!x || !y || x.added.length !== y.added.length || !!x.splitTorso !== !!y.splitTorso) return false;
  for (let i = 0; i < x.added.length; i++) {
    const [p, q] = [x.added[i], y.added[i]];
    if (p.id !== q.id || p.from !== q.from || !!p.piece !== !!q.piece || !near(p.shift, q.shift, 0, NEAR.position)) return false;
  }
  const [s, t] = [x.attach ?? {}, y.attach ?? {}];
  if (Object.keys(s).length !== Object.keys(t).length) return false;
  for (const [name, p] of Object.entries(s)) {
    const q = t[name];
    if (!q || p.to !== q.to || !!p.whole !== !!q.whole || p.socket !== q.socket || Math.abs(p.scale - q.scale) > NEAR.scale) return false;
    if (!near(p.pos, q.pos, 0, NEAR.position) || !near(p.quat, q.quat, 0, NEAR.position, 4)) return false;
  }
  for (const name of new Set([...Object.keys(a.overrides), ...Object.keys(b.overrides)])) {
    const [p, q] = [a.overrides[name] ?? {}, b.overrides[name] ?? {}];
    if (!!p.hidden !== !!q.hidden) return false;
    if (!near(p.position, q.position, 0, NEAR.position) || !near(p.rotation, q.rotation, 0, NEAR.rotation) || !near(p.scale, q.scale, 1, NEAR.scale)) return false;
  }
  return true;
}

/** 像不像楚云萱的体块（八副复制的胯、八个复制的胸腔）：不像的不用拼一遍来比 */
const chuLike = (spec: BodySpec): boolean => {
  const from = (name: string) => spec.blocks?.added.filter((b) => b.from === name).length ?? 0;
  return !!spec.blocks?.splitTorso && canSplitTorso(spec) && from('Torso') === COLS.length * ROWS.length - 1 && from('UpperBody') === COLS.length * ROWS.length - 1;
};

/**
 * 套完预设又拖了体型滑块（was 是拖之前的，now 是只改了体型的）：体块是照当时的体型量着摆的——九副胯隔多远、胸坐在身体表面的哪——
 * 体型变了不重摆的话，大腿调细三列之间就空出缝，调粗就叠在一起。
 * 只在体块还是预设摆出来的原样时重摆（was 照它自己的体型再拼一遍，和它现在的一样）：手动挪过、转过、删过、加过体块的不动，
 * 重摆会把这些改动冲掉。头、手臂的数量改了也重摆（中间一排的光胸腔不长头和手臂，手臂只留朝外那一侧的、照条数匀开）；
 * 腿、胸的数量和排法改了的不重摆：那是换了一种下身、一种胸，预设的摆法套不上去，照体块平常的规矩各跟各的原件变
 */
export function chuRefit(was: BodySpec, now: BodySpec): BodySpec {
  if (now.blocks !== was.blocks || now.overrides !== was.overrides || !chuLike(was) || !canSplitTorso(now)) return now;
  const fixed = (spec: BodySpec) => JSON.stringify([spec.counts.legs, spec.counts.breasts, spec.chestRow, spec.legLayout, spec.hipLegs, spec.bodyStyle]);
  if (fixed(was) !== fixed(now)) return now;
  if (!sameBuild(chuBlocks(was), was)) return now;
  const next = chuBlocks(now);
  // 以前存下来的（上半身还是九个胸腔各是各的那种）不趁机换成一整块
  if (was.blocks?.trunk || !next.blocks?.trunk) return next;
  const { trunk: _trunk, ...blocks } = next.blocks;
  return { ...next, blocks };
}

