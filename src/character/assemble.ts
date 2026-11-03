/**
 * 成品角色的拼装：拿一个现成的、带贴图和蒙皮的角色（见 source.ts），按部件数量把它拼成多肢体的样子。
 *
 * 做法是「直接拼」：
 * - 多出来的手臂、头、胸，是把角色自己的手臂、头、胸那一片网格连同骨骼复制一份，挪到新的位置接上去；
 * - 沿躯干多排手臂时，把腰以上、胸以下那一段连衣服一起拉长；
 * - A-pose、手肘微弯、头的大小、胸部大小，是照蒙皮权重给骨骼摆姿势，再把摆好的样子定成新的静止姿势。
 * - 一个头几张脸时，多出来的脸是把角色自己的脸（耳朵往前的那一半）复制一份，绕着头转到两边、后面去；
 * - 人马、蛛形是把角色自己的腿去掉，胯以下接一个另外捏的兽身（见 beast.ts）。
 * 各块之间是互相插在一起的，不融合；贴图、材质原样保留。
 * 角色自己没有的尾巴、翅膀、角、兽耳，照白模人台的做法现捏一份接上去（见 extras.ts），是单色的。
 *
 * 纯函数：输入角色数据和 BodySpec，输出网格和骨架，不碰 DOM。
 */
import { FACE_OUT, faceTurns, fanShift, gatherOut, headCluster, headShrink, headTurn, shoulderSpan, widenShift } from '../geometry/bodyPlan';
import { type FigureMetrics, nthName } from '../geometry/figure';
import { type HangBlock, GAP, armDirection, hangAngles } from '../geometry/layout';
import { FAN_YAW, INNER_ARM_DROP, torsoLean, torsoSlots } from '../geometry/torsos';
import { type V3, UP, len, norm, quatBetween, quatConj, quatEuler, quatMul, rotate } from '../geometry/vec';
import { t } from '../i18n';
import { type BodySpec, colorToLinear, headHairColor, legPlan, BUST_MAX_OTHER } from '../model/spec';
import { type BeastPiece, beastBody } from './beast';
import { type ExtraHead, type ExtraKind, extraParts } from './extras';
import type { HairDonor } from './hair';
import { type BonePose, posedJoints, skinMatrices, skinVerticesInPlace } from './pose';
import { type FaceInstance, fitFrame } from './face';
import type { CharacterSource, Chunk, FaceMorphs, SourceImage, SourceMaterial } from './source';

export interface CharacterBone {
  /** 工坊的骨骼名：Hips、UpperArm_L、UpperArm_L.002、Head.002 … */
  name: string;
  /** 父骨骼的下标，根是 -1。父骨骼总排在子骨骼前面 */
  parent: number;
  head: V3;
  tail: V3;
}

export interface CharacterBuild {
  bones: CharacterBone[];
  /** 一块块网格，顶点已经在最终的位置上（米）；joints 指向 bones */
  meshes: Chunk[];
  materials: SourceMaterial[];
  images: SourceImage[];
  metrics: FigureMetrics;
  /** 这个样式顾不上的设定，界面上提示用 */
  ignored: string[];
  /** 拼好以后有几张脸（自己的、复制出来的头上的、同一个头上多出来的），各自怎么从原始的脸换算过来 */
  faces: FaceInstance[];
  /** 表情的数据（就是角色文件里读出来的那一份）；角色没有表情就没有这一项 */
  morphs?: FaceMorphs;
  /** 每根骨骼是从文件里哪根骨骼来的（和 bones 一一对应）：导出 VRM 时照它抄弹簧骨骼、碰撞球 */
  origins?: (BoneOrigin | null)[];
}

/** 拼好的一根骨骼是文件里哪根骨骼（复制出来的也算那一根）：body 是角色自己，hair 是换上的发型；工坊后加的（尾巴、兽身、新的锁骨）没有 */
export interface BoneOrigin {
  file: 'body' | 'hair';
  bone: number;
}

const DEG = Math.PI / 180;
const SIDES = [1, -1] as const;
const tag = (side: number) => (side > 0 ? 'L' : 'R');
const pad = (n: number) => String(n).padStart(2, '0');
/** 自然下垂时手肘往前弯多少 */
const ELBOW_BEND = 16 * DEG;
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** 复制出来的脖子根往肩膀里埋多深；脖子根那一圈大概多粗（半径） */
const NECK_BURY = 0.012;
const NECK_RADIUS = 0.045;
/** 脖子加长时，衣领从脖子根往下这么长的一段是过渡：再往上的整个跟着头走，再往下的不动 */
const COLLAR_SLACK = 0.03;
/** 最外面的脖子根离肩关节至少多远 */
const NECK_ROOM = 0.03;
/** 多个头凑在一起时，头的宽度最多按头高的几分之几算 */
const HEAD_ASPECT = 0.76;
/**
 * 复制出来的脖子最底下那一圈怎么藏：跟着脖子的权重不到 RIM_FROM 的点开始往里收，
 * 再少 RIM_SPAN 就收到头；收到头时离脖子轴线的距离缩掉 RIM_SHRINK，往下沉 RIM_SINK
 */
const RIM_FROM = 0.75;
const RIM_SPAN = 0.5;
const RIM_SHRINK = 0.45;
const RIM_SINK = 0.02;
/**
 * 一个头上多出来的脸：从头的竖轴往前这么远（脸的厚度的几分之几）切一刀，前面的那一半算脸；
 * 脸往外挪到这么深的地方（眼睛那一圈）正好露在头发外面
 */
const FACE_CUT = 0.12;
const FACE_SHOW = 0.6;
/** 多出来的脸比正面那张小一圈：三张一样大的脸在一个头上排不开 */
const FACE_SIZE = 0.92;
/** 加宽肩膀时，离中线这么远以内的一段是被拉开的，再往外的（肩头、手臂）整个往外挪 */
const WIDEN_CORE = 0.07;
/**
 * 沿躯干上下排的手臂：肩关节放在躯干侧面往里多深；给它垫肩膀时，躯干鼓到比关节再往外多远、
 * 关节周围多大一圈的躯干跟着鼓出来
 */
const STACK_IN = 0.004;
const PAD_COVER = 0.008;
const PAD_RADIUS = 0.1;
/**
 * 沿躯干上下排的手臂，复制出来的袖子根那一圈切口怎么藏（和脖子的 RIM_* 一个办法）：
 * 跟着手臂的权重不到 SLEEVE_FROM 的点开始往肩关节收，再少 SLEEVE_SPAN 就收到头；
 * 收到头时顺着手臂退到关节往里 SLEEVE_SINK 的地方（躯干里面），离手臂轴线的距离缩掉 SLEEVE_SHRINK。
 * 宽松的袖子（开衫）切口是斜的，腋下那一边离关节有八九厘米，不收的话整圈切口悬在躯干外面。
 */
/**
 * 好几个上半身（见 geometry/torsos.ts）：一个三角面平均有多少权重跟着脊柱才复制；
 * 两边的上半身在腰那里往外挪多少（三个时两倍）；里侧的肩关节离多近算同一个肩膀，好几条时一条比一条多抬多少
 */
const TORSO_SPLIT = 0.5;
const TORSO_SHIFT = 0.03;
const INNER_SHOULDER = 0.08;
const INNER_FAN_STEP = 18 * (Math.PI / 180);
const SLEEVE_FROM = 0.8;
const SLEEVE_SPAN = 0.4;
const SLEEVE_SINK = 0.03;
const SLEEVE_SHRINK = 0.5;
/**
 * 人马 / 蛛形的兽身（见 beast.ts）有多大：它是照白模人台的尺寸捏的，先按腿长换算到角色的个头，再乘上这个倍率。
 * 二次元里兽身比真马小一圈，背差不多齐着人的胯
 */
const BEAST_SIZE = 0.86;
/** 白模人台的髋关节离地多高（兽身是配着它的） */
const BEAST_HIP = 0.9;
/**
 * 调头发的蓬松时以哪里为中心：从下巴到头顶的几分之几高（颅骨的正中）；
 * 调长短时从哪里往下算垂着的：从下巴到头顶的几分之几高（鼻尖那么高）
 */
const HAIR_CENTER = 0.62;
const HAIR_HANG = 0.3;
/** 角色的胯坐进兽身的背里多深：髋关节比背低这么多 */
const SEAT_SINK = 0.06;
/** 去掉腿以后，胯下面剩的那一圈大腿根往髋关节收多少，免得从兽身里支出来 */
const STUMP_TUCK = 0.7;
/**
 * 人腿人马：身后接的那一份（腰、胯、腿）从胸的关节往下这么多的地方切开；
 * 前后两副胯隔多远（腿长的几分之几）；切口并进前面那副胯里多深
 */
const HUMANTAUR_CUT = 0.06;
const HUMANTAUR_SPAN = 0.4;
const HUMANTAUR_BURY = 0.06;
/**
 * 人腿前后串联：后面几副胯从腰往下往后斜出去。从胸的关节往上这么多的地方开始斜（那里是腰最细的地方再往上一点），
 * 到胯的关节往下这么多的地方斜完，再往下整个平移
 */
const ROW_TOP = 0.04;
const ROW_BOTTOM = 0.01;
/** 人腿前后串联：前后两副胯隔多远（腿长的几分之几）。比人腿人马近得多，一副紧挨着一副 */
const TANDEM_SPAN = 0.25;
/**
 * 人腿胯部聚拢：和前后串联一样一副胯接一副胯，只是贴得更紧（隔腿长的这么几分之几，后面几副的腿根藏在前一副的屁股底下），
 * 腿往下往外散开：往后每多一副，脚踝多往外挪这么多个髋关节离中线的距离，正面看是一层层的扇面
 */
const GATHER_SPAN = 0.08;
/**
 * 人腿横排多胯：相邻两副胯的正中隔她两个髋关节之间那么宽的这么多倍（她的胯大约是髋关节外面再宽一截：
 * 隔得比两副胯加起来窄一点，稍微叠着）
 */
const ABREAST_STEP = 1.7;
const GATHER_SPREAD = 1.6;
/** 一副胯上排三条以上腿时，离中线这么近以内的骨骼算正中的，不挪（见 tile） */
const SEAM = 0.01;
/** 一副胯上排三条以上腿时，相邻两份在接缝处叠多宽（盖住缝；见 tile） */
const TILE_OVERLAP = 0.0015;
/** 接缝两边多宽以内把明暗顺过去：中段半宽的几成（见 tile） */
const TILE_ROUND = 0.3;
/**
 * 一副胯上排三条以上腿时整块留着、不切开的小块（见 tileChunk）：髋关节以上、比 TRIM 窄的（蝴蝶结、垂下来的飘带、扣子），
 * 和比 ODD 窄、只有一边有的（左右不对称的腿套、挂件）
 */
const TILE_KEEP = { trim: 0.08, odd: 0.2 };

/**
 * VRoid 的骨骼名 → 工坊的骨骼名：J_Bip_L_UpperArm → UpperArm_L，J_Bip_C_Hips → Hips，
 * J_Sec_L_SkirtBack0 → SkirtBack0_L，J_Opt_L_RabbitEar1_01（配饰的骨骼）→ RabbitEar1_01_L
 */
export function boneName(raw: string): string {
  const sided = /^J_(?:Bip|Sec|Adj|Opt)_([LRC])_(.+)$/.exec(raw);
  if (sided) {
    const base = sided[2] === 'ToeBase' ? 'Toes' : sided[2] === 'FaceEye' ? 'Eye' : sided[2];
    return sided[1] === 'C' ? base : `${base}_${sided[1]}`;
  }
  const plain = /^J_(?:Bip|Sec|Adj|Opt)_(.+)$/.exec(raw);
  return plain ? plain[1] : raw;
}

/**
 * 是不是头发的骨骼（按文件里的名字认）：旧版 VRoid 导出的叫「HairJoint-一长串编号」，
 * 新版的叫 J_Sec_Hair3_07（第 7 缕的第 3 节）
 */
export const isHairBone = (raw: string) => /^HairJoint-|^J_Sec_Hair\d+_\d+$/.test(raw);

/**
 * 整副骨架的名字。一根根照 boneName 换，再处理两种情况：
 * - 有的角色在 J_Bip_L_UpperArm 下面还挂着一根 J_Sec_L_UpperArm，换完会重名：后一根叫 UpperArmSec_L；
 * - 头发的骨骼（见 isHairBone）：按一缕一缕、从根到梢改叫 Hair_01_01、Hair_01_02 …
 */
export function boneNames(bones: readonly { name: string; parent: number }[]): string[] {
  const names: string[] = bones.map(() => '');
  const taken = new Set<string>();
  const isHair = (b: number) => isHairBone(bones[b].name);
  /** 这根头发骨骼属于第几缕（从 1 数起） */
  const strandOf: number[] = [];
  const inStrand: number[] = [0];
  const strand = (b: number): number => {
    if (strandOf[b] === undefined) {
      const up = bones[b].parent;
      strandOf[b] = up >= 0 && isHair(up) ? strand(up) : inStrand.push(0) - 1;
    }
    return strandOf[b];
  };
  const two = (n: number) => String(n).padStart(2, '0');
  // 身体的主骨骼（J_Bip_）先占名字，别的排在后面
  const order = [...bones.keys()].sort((a, b) => Number(!bones[a].name.startsWith('J_Bip_')) - Number(!bones[b].name.startsWith('J_Bip_')));
  for (const b of order) {
    let name: string;
    if (isHair(b)) {
      const s = strand(b);
      name = `Hair_${two(s)}_${two(++inStrand[s])}`;
    } else {
      name = boneName(bones[b].name);
      if (taken.has(name)) name = name.replace(/(_[LR])?$/, `${/^J_(Sec|Adj|Opt)_/.exec(bones[b].name)?.[1] ?? 'Alt'}$1`);
    }
    taken.add(name);
    names[b] = name;
  }
  return names;
}

/** 画骨骼时终点朝哪个子骨骼（左右两边的名字后面带 _L / _R） */
const MAIN_CHILD: Record<string, string> = {
  Hips: 'Spine',
  Spine: 'Chest',
  Chest: 'UpperChest',
  UpperChest: 'Neck',
  Neck: 'Head',
  Shoulder: 'UpperArm',
  UpperArm: 'LowerArm',
  LowerArm: 'Hand',
  Hand: 'Middle1',
  UpperLeg: 'LowerLeg',
  LowerLeg: 'Foot',
  Foot: 'Toes',
};

/** 头发蓬起来的那些面（单独的头发网格）：量头的大小、身高时不算它们 */
const isLooseHair = (chunk: Chunk) => /^Hair/i.test(chunk.name);

/** 头发里面数最多的那种材质：尾巴和兽耳照它上色 */
export function hairMaterial(source: CharacterSource): SourceMaterial | undefined {
  const triangles = new Map<number, number>();
  for (const chunk of source.chunks) {
    if (/HAIR/i.test(source.materials[chunk.material].name)) triangles.set(chunk.material, (triangles.get(chunk.material) ?? 0) + chunk.indices.length / 3);
  }
  let best = -1;
  for (const [material, count] of triangles) if (best < 0 || count > triangles.get(best)!) best = material;
  return best < 0 ? undefined : source.materials[best];
}

/** 后加的东西各用哪种单色材质：尾巴、兽耳、角、翅膀，再加上兽身（马身、蹄子、蜘蛛身） */
type FlatKind = ExtraKind | 'coat' | 'hoof' | 'chitin';
const FLAT_KINDS: readonly FlatKind[] = ['tail', 'ear', 'horn', 'wing', 'coat', 'hoof', 'chitin'];

type Rgb = [number, number, number];

/**
 * 这副头发本来是什么颜色（线性空间）。贴图解出来了就用量好的平均颜色（见 load.ts）；
 * 没解出来的话，头发的材质带底色就用它，不带（颜色全在贴图里）就用深褐色
 */
function hairTone(source: CharacterSource): Rgb {
  if (source.hairColor) return source.hairColor;
  const hair = hairMaterial(source);
  const tinted = hair && Math.min(hair.color[0], hair.color[1], hair.color[2]) < 0.95;
  return tinted ? [hair.color[0], hair.color[1], hair.color[2]] : [0.1, 0.07, 0.06];
}

/** 同一种材质换一个底色的那一份（染发用）。跟着原来的材质走，同一个颜色只建一次 */
const dyedCache = new WeakMap<SourceMaterial, Map<string, SourceMaterial>>();
function dyed(material: SourceMaterial, color: Rgb): SourceMaterial {
  let byColor = dyedCache.get(material);
  if (!byColor) dyedCache.set(material, (byColor = new Map()));
  const key = color.map((v) => v.toFixed(4)).join(',');
  let made = byColor.get(key);
  if (!made) {
    // 拖着调色时颜色一个接一个地换：攒多了就清掉，用到再建
    if (byColor.size > 48) byColor.clear();
    made = { ...material, color: [color[0], color[1], color[2], material.color[3]] };
    byColor.set(key, made);
  }
  return made;
}

/** 同一种材质改个名字的那一份：分开染的头各用一份，导出到 Blender 里分得清是哪个头的。跟着原来的材质走，只建一次 */
const renamedCache = new WeakMap<SourceMaterial, Map<string, SourceMaterial>>();
function renamed(material: SourceMaterial, suffix: string): SourceMaterial {
  let bySuffix = renamedCache.get(material);
  if (!bySuffix) renamedCache.set(material, (bySuffix = new Map()));
  let made = bySuffix.get(suffix);
  if (!made) {
    made = { ...material, name: `${material.name}${suffix}` };
    bySuffix.set(suffix, made);
  }
  return made;
}

/** 头发染成 color（空字符串是不染，跟着 coiffure 这副头发本来的颜色）时，长在这个头上的兽耳用的单色材质 */
const headEar = (source: CharacterSource, color: string, coiffure: CharacterSource) =>
  extraMaterials(source, color ? colorToLinear(color) : hairTone(coiffure)).ear;

/** 贴图的平均颜色是 tone 时，材质的底色设成多少，乘出来才是 want */
const tinted = (want: Rgb, tone: Rgb): Rgb => [Math.min(1, want[0] / Math.max(tone[0], 0.05)), Math.min(1, want[1] / Math.max(tone[1], 0.05)), Math.min(1, want[2] / Math.max(tone[2], 0.05))];

/** 同一种材质换一张贴图的那一份。跟着原来的材质走，只建一次 */
const retexturedCache = new WeakMap<SourceMaterial, Map<number, SourceMaterial>>();
function retextured(material: SourceMaterial, image: number): SourceMaterial {
  let byImage = retexturedCache.get(material);
  if (!byImage) retexturedCache.set(material, (byImage = new Map()));
  let made = byImage.get(image);
  if (!made) {
    made = { ...material, image };
    byImage.set(image, made);
  }
  return made;
}

/**
 * 换上去的头发带来的材质和贴图，接在角色自己的后面（材质里的贴图下标跟着挪）。
 * 跟着头发文件走，只建一次：贴图的那个数组不换，显示那边就不用重新解码
 */
const donorCache = new WeakMap<HairDonor, { base: CharacterSource; count: number; materials: SourceMaterial[]; images: SourceImage[] }>();
function donorAssets(source: CharacterSource, donor: HairDonor) {
  let made = donorCache.get(donor);
  // 两边的贴图后来又多了（染发用的浅色贴图是用到时才做的，见 load.ts）就重新接一遍
  const count = source.images.length * 4096 + donor.source.images.length;
  if (!made || made.base !== source || made.count !== count) {
    made = {
      base: source,
      count,
      materials: donor.source.materials.map((m) => ({ ...m, image: m.image < 0 ? -1 : m.image + source.images.length })),
      images: [...source.images, ...donor.source.images],
    };
    donorCache.set(donor, made);
  }
  return made;
}

/** 后加的部件用的单色材质，fur 是头发的颜色。跟着角色文件走，同一个发色只建一次 */
const extraMaterialCache = new WeakMap<CharacterSource, Map<string, Record<FlatKind, SourceMaterial>>>();
function extraMaterials(source: CharacterSource, tone: Rgb): Record<FlatKind, SourceMaterial> {
  let byColor = extraMaterialCache.get(source);
  if (!byColor) extraMaterialCache.set(source, (byColor = new Map()));
  const key = tone.map((v) => v.toFixed(4)).join(',');
  let made = byColor.get(key);
  if (!made) {
    if (byColor.size > 48) byColor.clear();
    // 尾巴和兽耳跟头发一个颜色
    const fur: [number, number, number, number] = [tone[0], tone[1], tone[2], 1];
    const flat = (name: string, color: [number, number, number, number], doubleSided = false): SourceMaterial => ({
      name,
      color,
      image: -1,
      alpha: 'OPAQUE',
      cutoff: 0.5,
      doubleSided,
    });
    made = {
      tail: flat('OC_Tail', fur),
      ear: flat('OC_Ear', fur),
      horn: flat('OC_Horn', [0.78, 0.72, 0.58, 1]),
      wing: flat('OC_Wing', [0.72, 0.78, 0.84, 1], true),
      // 马身的毛色跟头发走，蹄子是深色的角质；蜘蛛身是带一点发色的深色甲壳
      coat: flat('OC_Coat', fur),
      hoof: flat('OC_Hoof', [0.05, 0.05, 0.06, 1]),
      chitin: flat('OC_Chitin', [0.02 + fur[0] * 0.07, 0.02 + fur[1] * 0.07, 0.03 + fur[2] * 0.09, 1]),
    };
    byColor.set(key, made);
  }
  return made;
}

/** 同一种材质、但两面都画的那一份（切下来的半个壳用）。跟着角色文件走，只建一次 */
const twoSidedCache = new WeakMap<SourceMaterial, SourceMaterial>();
function twoSided(material: SourceMaterial): SourceMaterial {
  let made = twoSidedCache.get(material);
  if (!made) {
    made = { ...material, name: `${material.name}_Both`, doubleSided: true };
    twoSidedCache.set(material, made);
  }
  return made;
}

/** 只留下 keep 说要的三角面，用不到的顶点一起去掉。一个面都不剩就返回 null；一个面都没去掉就原样返回 */
function keepTriangles(chunk: Chunk, keep: (a: number, b: number, c: number) => boolean): Chunk | null {
  const remap = new Map<number, number>();
  const indices: number[] = [];
  for (let t = 0; t < chunk.indices.length; t += 3) {
    const tri = [chunk.indices[t], chunk.indices[t + 1], chunk.indices[t + 2]];
    if (!keep(tri[0], tri[1], tri[2])) continue;
    for (const v of tri) {
      let id = remap.get(v);
      if (id === undefined) {
        id = remap.size;
        remap.set(v, id);
      }
      indices.push(id);
    }
  }
  if (!indices.length) return null;
  if (indices.length === chunk.indices.length) return chunk;
  const count = remap.size;
  const made: Chunk = {
    name: chunk.name,
    material: chunk.material,
    positions: new Float32Array(count * 3),
    normals: new Float32Array(count * 3),
    uvs: new Float32Array(count * 2),
    joints: new Uint16Array(count * 4),
    weights: new Float32Array(count * 4),
    indices: Uint32Array.from(indices),
  };
  if (chunk.faceVertex) made.faceVertex = new Int32Array(count);
  for (const [v, id] of remap) {
    if (chunk.faceVertex) made.faceVertex![id] = chunk.faceVertex[v];
    made.positions.set(chunk.positions.subarray(v * 3, v * 3 + 3), id * 3);
    made.normals.set(chunk.normals.subarray(v * 3, v * 3 + 3), id * 3);
    made.uvs.set(chunk.uvs.subarray(v * 2, v * 2 + 2), id * 2);
    made.joints.set(chunk.joints.subarray(v * 4, v * 4 + 4), id * 4);
    made.weights.set(chunk.weights.subarray(v * 4, v * 4 + 4), id * 4);
  }
  return made;
}

const copyChunk = (chunk: Chunk): Chunk => ({
  ...chunk,
  positions: chunk.positions.slice(),
  normals: chunk.normals.slice(),
  uvs: chunk.uvs.slice(),
  joints: chunk.joints.slice(),
  weights: chunk.weights.slice(),
  indices: chunk.indices.slice(),
});

/**
 * 朝一堆三角面沿坐标轴打射线找表面用。triangles 每 9 个数一个面。
 * extreme(axis, p, q, sign)：沿 axis 轴、另外两个坐标是 (p, q) 的那条线上，最靠 sign 一侧的交点；没碰到返回 fallback。
 */
function makeProbe(triangles: Float32Array) {
  return (axis: 0 | 1 | 2, p: number, q: number, sign: 1 | -1, fallback: number): number => {
    const b = (axis + 1) % 3;
    const c = (axis + 2) % 3;
    let best = -Infinity;
    for (let t = 0; t < triangles.length; t += 9) {
      const b0 = triangles[t + b] - p;
      const b1 = triangles[t + 3 + b] - p;
      const b2 = triangles[t + 6 + b] - p;
      if ((b0 > 0 && b1 > 0 && b2 > 0) || (b0 < 0 && b1 < 0 && b2 < 0)) continue;
      const c0 = triangles[t + c] - q;
      const c1 = triangles[t + 3 + c] - q;
      const c2 = triangles[t + 6 + c] - q;
      if ((c0 > 0 && c1 > 0 && c2 > 0) || (c0 < 0 && c1 < 0 && c2 < 0)) continue;
      // (p, q) 在不在这个面的投影里：三条边的叉积同号
      const e0 = b0 * c1 - b1 * c0;
      const e1 = b1 * c2 - b2 * c1;
      const e2 = b2 * c0 - b0 * c2;
      const area = e0 + e1 + e2;
      if (Math.abs(area) < 1e-12) continue;
      if ((e0 < 0 || e1 < 0 || e2 < 0) && (e0 > 0 || e1 > 0 || e2 > 0)) continue;
      const at = (e1 * triangles[t + axis] + e2 * triangles[t + 3 + axis] + e0 * triangles[t + 6 + axis]) / area;
      if (at * sign > best) best = at * sign;
    }
    return best === -Infinity ? fallback : best * sign;
  };
}

/**
 * hair：换发型用的那副头发（见 hair.ts）。设定里选的不是原装、而这副头发还没取回来（或者给的不是选的那一副）时，
 * 先照原装的头发拼。
 */
export function assembleCharacter(source: CharacterSource, spec: BodySpec, hair: HairDonor | null = null): CharacterBuild {
  const c = spec.counts;
  const sh = { ...spec.shape, bust: Math.min(spec.shape.bust, BUST_MAX_OTHER) };
  const tPose = spec.pose === 'T';
  const ignored: string[] = [];

  /* ---- 头发是谁的、什么颜色；材质和贴图的清单 ---- */
  // 换发型：她原装的头发（连同做在头发里的那副猫耳）不要了，换上从别的模型取下来的那一副
  const donor = spec.hair.style !== 'own' && hair?.meta.id === spec.hair.style ? hair : null;
  /** 现在头上这副头发的来历：染发改哪种材质、自带的兽耳是哪种材质，都记在它那里 */
  const coiffure = donor ? donor.source : source;
  /** 第 index 个头的发色（Head_01 是角色自己的头）。几个头凑成一簇时可以分开染（见 HairSpec.heads），一个头几张脸的只有一副头发 */
  const apart = (spec.headLayout !== 'faces' ? c.heads : 1) * c.torsos > 1;
  const headColor = (index: number) => (apart ? headHairColor(spec.hair, index) : spec.hair.color);
  const dye = spec.hair.color ? colorToLinear(spec.hair.color) : null;
  // 后加的尾巴、兽耳、马身跟头发一个颜色（兽耳跟着它长在的那个头）
  const flatMaterials = { ...extraMaterials(source, dye ?? hairTone(coiffure)), ear: headEar(source, headColor(0), coiffure) };
  /** 材质的清单：角色自己的，后加部件的单色材质，换上去的头发带来的；最后再接上「两面都画」的那几份（见 bothSides） */
  const materials: SourceMaterial[] = [...source.materials, ...FLAT_KINDS.map((kind) => flatMaterials[kind])];
  const flatIndex = (kind: FlatKind) => source.materials.length + FLAT_KINDS.indexOf(kind);
  /** 换上去的头发的材质从第几个开始 */
  const donorBase = materials.length;
  if (donor) materials.push(...donorAssets(source, donor).materials);
  const images = donor ? donorAssets(source, donor).images : source.images;
  /** 现在这副头发的材质在清单里排第几 */
  const hairIndex = (i: number) => (donor ? donorBase + i : i);
  /** 还没染过的材质 */
  const undyed = materials.slice();
  /** 头发染成 color（#rrggbb，空字符串是不染）时要换掉哪些材质：清单里的下标 → 换成的那一份 */
  const dyeing = (color: string): Map<number, SourceMaterial> => {
    const out = new Map<number, SourceMaterial>();
    const want = color ? colorToLinear(color) : null;
    if (want) {
      // 染发：头发的颜色是「贴图 × 材质的底色」，把底色换成能让平均颜色落在要的颜色上的那个值。
      // 颜色画在贴图里的头发染不浅：换上给它做好的那张浅色贴图（hairLight，见 load.ts）；
      // 没做出来的话（不在浏览器里），深色的那副借角色自己那张浅色的头发贴图
      const borrowed = donor?.meta.dark && !coiffure.hairLight?.size ? hairMaterial(source) : undefined;
      const owner = borrowed ? source : coiffure;
      const main = borrowed ?? hairMaterial(coiffure);
      // 贴图本身的平均颜色解出来了才知道（见 load.ts），不知道就当它是白的
      const texture: Rgb =
        owner.hairColor && main
          ? [owner.hairColor[0] / Math.max(main.color[0], 1e-3), owner.hairColor[1] / Math.max(main.color[1], 1e-3), owner.hairColor[2] / Math.max(main.color[2], 1e-3)]
          : [1, 1, 1];
      const factor = want.map((v, k) => Math.min(1, v / Math.max(texture[k], 0.05))) as Rgb;
      for (const i of coiffure.dyeMaterials) {
        const material = undyed[hairIndex(i)];
        const light = coiffure.hairLight?.get(i);
        out.set(
          hairIndex(i),
          light
            ? dyed(retextured(material, donor ? source.images.length + light.image : light.image), tinted(want, light.tone))
            : dyed(borrowed ? retextured(material, borrowed.image) : material, factor),
        );
      }
    }
    // 贴着头皮的那一层底色（画在她身体的网格上）跟着头发的颜色走
    const scalp = want ?? (donor ? (donor.meta.scalp ?? hairTone(donor.source)) : null);
    if (scalp) {
      source.materials.forEach((m, i) => {
        if (!/HairBack/i.test(m.name)) return;
        const light = source.hairLight?.get(i);
        out.set(i, light ? dyed(retextured(m, light.image), tinted(scalp, light.tone)) : dyed(m, scalp));
      });
    }
    return out;
  };
  const firstDye = dyeing(headColor(0));
  for (const [i, m] of firstDye) materials[i] = m;
  /**
   * 复制出来的头染的颜色和角色自己的头不一样：它的头发、头皮、兽耳各用一份自己的材质（接在清单后面，名字带上是哪个头的）。
   * 第几个头 → 原来的下标 → 换成的下标；复制那个头、给它长兽耳的时候换上
   */
  const headDyes = new Map<number, Map<number, number>>();
  /** 另加的那几份染好的材质是照哪一个染的（好几个上半身时要照头重新挑，见那一段） */
  const dyedFrom = new Map<number, number>();
  for (let index = 1; apart && index < c.heads; index++) {
    const color = headColor(index);
    if (color === headColor(0)) continue;
    const mine = dyeing(color);
    const tag = `_Head_${pad(index + 1)}`;
    const swap = new Map<number, number>();
    for (const i of new Set([...firstDye.keys(), ...mine.keys()])) swap.set(i, materials.push(renamed(mine.get(i) ?? undyed[i], tag)) - 1);
    swap.set(flatIndex('ear'), materials.push(renamed(headEar(source, color, coiffure), tag)) - 1);
    for (const [from, to] of swap) dyedFrom.set(to, from);
    headDyes.set(index, swap);
  }
  /** 头发里自带的兽耳是哪几种材质 */
  const builtInEars = new Set(coiffure.earMaterials.map(hairIndex));
  const materialName = (index: number) => materials[index]?.name ?? '';

  /* ---- 骨架和网格的工作副本（后面一路往里加、往上改） ---- */
  const names = boneNames(source.bones);
  /** 每根骨骼是从文件里哪根来的（见 BoneOrigin）：往骨架里加骨骼的地方都跟着加一项 */
  const origin: (BoneOrigin | null)[] = source.bones.map((_, bone) => ({ file: 'body', bone }));
  /**
   * 只是标记位置用的骨骼，最后不导出：末端的 xxx_end、Hips 上面那几层 Root 之类的，
   * 还有不带任何顶点的梢（比如头发每一缕的最后一节）
   */
  const marker = source.bones.map((b) => /_end(_\d+)?$/.test(b.name) || b.parent < 0);
  const parent = source.bones.map((b) => b.parent);
  for (let b = parent[names.indexOf('Hips')] ?? -1; b >= 0; b = parent[b]) marker[b] = true;
  const idle = source.bones.map(() => true);
  for (const p of parent) if (p >= 0) idle[p] = false;
  for (const chunk of source.chunks) for (let i = 0; i < chunk.joints.length; i++) if (chunk.weights[i]) idle[chunk.joints[i]] = false;
  idle.forEach((yes, b) => {
    if (yes) marker[b] = true;
  });
  const rest: V3[] = source.bones.map((b) => [b.pos[0], b.pos[1], b.pos[2]]);
  // 加了工坊的兽耳，头发里自带的那副（做在头发里的装饰）就不要了，免得长两副耳朵
  const ownEars = c.earPairsPerHead > 0 ? new Set(source.earMaterials) : null;
  const chunks = source.chunks.filter((chunk) => !ownEars?.has(chunk.material) && !(donor && isLooseHair(chunk))).map(copyChunk);
  /** 角色本来的网格有几块（后面复制出来的、后加的都排在它们后面） */
  let original = chunks.length;

  const find = (name: string) => names.indexOf(name);
  const need = (name: string) => {
    const index = find(name);
    if (index < 0) throw new Error(t('角色里没有骨骼 {name}', { name }));
    return index;
  };
  /** root 和它下面所有的骨骼，root 排第一个，父骨骼总在子骨骼前面 */
  const subtree = (root: number): number[] => {
    const list = [root];
    for (let i = 0; i < list.length; i++) {
      for (let b = 0; b < parent.length; b++) if (parent[b] === list[i]) list.push(b);
    }
    return list;
  };
  /** 每个顶点有多少权重落在 set 这些骨骼上 */
  const share = (chunk: Chunk, set: ReadonlySet<number>) => {
    const out = new Float32Array(chunk.positions.length / 3);
    for (let v = 0; v < out.length; v++) {
      for (let k = 0; k < 4; k++) if (set.has(chunk.joints[v * 4 + k])) out[v] += chunk.weights[v * 4 + k];
    }
    return out;
  };
  /** 这块网格是不是皮肤（不是衣服、头发） */
  const isSkinMaterial = (index: number) => /_SKIN$/i.test(materialName(index));
  const isSkin = (chunk: Chunk) => isSkinMaterial(chunk.material);
  /** 用到的「两面都画」的材质（见 twoSided），排在清单的最后 */
  const sided: SourceMaterial[] = [];
  const bothSides = (index: number): number => {
    if (materials[index].doubleSided) return index;
    const made = twoSided(materials[index]);
    let at = sided.indexOf(made);
    if (at < 0) at = sided.push(made) - 1;
    return materials.length + at;
  };
  /** 这块网格是不是衣服 */
  const isCloth = (chunk: Chunk) => /_CLOTH(_\d+)?$/i.test(materialName(chunk.material));

  const hips = need('Hips');
  const upperChest = need('UpperChest');
  const neck = need('Neck');
  const head = need('Head');
  const spineLevels = ['Spine', 'Chest', 'UpperChest'].map(need);
  const upperArm = { 1: need('UpperArm_L'), [-1]: need('UpperArm_R') } as Record<number, number>;
  const lowerArm = { 1: need('LowerArm_L'), [-1]: need('LowerArm_R') } as Record<number, number>;
  const busts = ['Bust1_L', 'Bust1_R'].map(find).filter((b) => b >= 0);

  /* ---- 体型：腰宽、胯宽、四肢粗细、手臂长短、腿长短 ---- */
  // 趁还是文件里原样的 T-pose（手臂平举、腿竖直），直接改顶点和关节的位置：
  // 后面量尺寸、复制手臂和头、摆姿势，用的都是改过以后的样子。衣服和皮肤一起变，贴图会跟着拉开一点。
  {
    const hand = { 1: need('Hand_L'), [-1]: need('Hand_R') } as Record<number, number>;
    const legRoot = { 1: need('UpperLeg_L'), [-1]: need('UpperLeg_R') } as Record<number, number>;
    const knee = { 1: need('LowerLeg_L'), [-1]: need('LowerLeg_R') } as Record<number, number>;
    const ankle = { 1: need('Foot_L'), [-1]: need('Foot_R') } as Record<number, number>;
    /** 一条手臂、一条腿各是哪些骨骼。有的角色把裙摆的骨骼挂在大腿上：它们不算腿 */
    const armOf = (side: number) => new Set(subtree(upperArm[side]));
    const handOf = (side: number) => new Set(subtree(hand[side]));
    const legOf = (side: number) => new Set(subtree(legRoot[side]).filter((b) => /^(UpperLeg|LowerLeg|Foot|Toe)/.test(names[b])));
    const footOf = (side: number) => new Set(subtree(ankle[side]).filter((b) => /^(Foot|Toe)/.test(names[b])));
    const arms = SIDES.map((side) => ({ side, all: armOf(side), hand: handOf(side) }));
    const legs = SIDES.map((side) => ({ side, all: legOf(side), foot: footOf(side) }));
    const offBody = new Set([...subtree(neck), ...arms.flatMap((a) => [...a.all]), ...legs.flatMap((l) => [...l.all])]);
    const mix = (a: number, b: number, t: number) => a + (b - a) * t;
    /** 每块网格的每个顶点改一下：move 拿到这个点和「有多少权重落在某一组骨骼上」的函数，直接改 p */
    const reshape = (move: (p: V3, on: (set: ReadonlySet<number>) => number) => void) => {
      for (const chunk of chunks) {
        for (let v = 0; v < chunk.positions.length / 3; v++) {
          const p: V3 = [chunk.positions[v * 3], chunk.positions[v * 3 + 1], chunk.positions[v * 3 + 2]];
          move(p, (set) => {
            let sum = 0;
            for (let k = 0; k < 4; k++) if (chunk.weights[v * 4 + k] && set.has(chunk.joints[v * 4 + k])) sum += chunk.weights[v * 4 + k];
            return sum;
          });
          chunk.positions.set(p, v * 3);
        }
      }
      // 关节：整个算在自己那根骨骼上
      rest.forEach((p, b) => move(p, (set) => (set.has(b) ? 1 : 0)));
    };

    // 手臂长短：肩到手腕这一段沿手臂拉长、缩短，手腕往外的（手、手指）整个跟着挪，大小不变
    if (Math.abs(sh.armLength - 1) > 1e-6) {
      const reach = arms.map(({ side }) => ({ from: rest[upperArm[side]][0], span: (rest[hand[side]][0] - rest[upperArm[side]][0]) * side }));
      reshape((p, on) => {
        arms.forEach(({ side, all }, i) => {
          const share = on(all);
          if (!share) return;
          const out = (p[0] - reach[i].from) * side;
          if (out <= 0) return;
          const grown = out <= reach[i].span ? out * sh.armLength : reach[i].span * sh.armLength + (out - reach[i].span);
          p[0] += (grown - out) * side * share;
        });
      });
    }

    // 腿长短：髋关节到脚踝这一段沿高度拉长、缩短，脚踝往下的（脚、鞋）整个跟着挪，大小不变；最后照样踩回地面上
    if (Math.abs(sh.legLength - 1) > 1e-6) {
      const reach = legs.map(({ side }) => ({ from: rest[legRoot[side]][1], span: rest[legRoot[side]][1] - rest[ankle[side]][1] }));
      reshape((p, on) => {
        legs.forEach(({ all }, i) => {
          const share = on(all);
          if (!share) return;
          const down = reach[i].from - p[1];
          if (down <= 0) return;
          const grown = down <= reach[i].span ? down * sh.legLength : reach[i].span * sh.legLength + (down - reach[i].span);
          p[1] -= (grown - down) * share;
        });
      });
    }

    // 四肢粗细：上臂、前臂绕手臂的轴变粗变细，大腿、小腿绕腿的轴；手和脚不变
    if (Math.abs(sh.limbs - 1) > 1e-6) {
      const grow = sh.limbs - 1;
      const armAxis = arms.map(({ side }) => ({ a: [...rest[upperArm[side]]] as V3, k: [...rest[lowerArm[side]]] as V3, b: [...rest[hand[side]]] as V3 }));
      const legAxis = legs.map(({ side }) => ({ a: [...rest[legRoot[side]]] as V3, k: [...rest[knee[side]]] as V3, b: [...rest[ankle[side]]] as V3 }));
      /** 两条大腿之间那条缝在哪：大腿变粗是往外长，里侧不动，不然两条腿会长到一起去 */
      const crotch = rest[legRoot[1]][1];
      reshape((p, on) => {
        arms.forEach(({ all, hand: palm }, i) => {
          const share = on(all) - on(palm);
          if (share <= 0) return;
          const { a, k: mid, b } = armAxis[i];
          // 手臂的轴：肩 → 肘 → 腕，照离肩多远在中间取（关节正好在轴上，不会被挪动）
          const upper = Math.abs(p[0] - a[0]) <= Math.abs(mid[0] - a[0]);
          const t = upper ? Math.min(1, Math.max(0, (p[0] - a[0]) / (mid[0] - a[0] || 1))) : Math.min(1, Math.max(0, (p[0] - mid[0]) / (b[0] - mid[0] || 1)));
          const ay = upper ? mix(a[1], mid[1], t) : mix(mid[1], b[1], t);
          const az = upper ? mix(a[2], mid[2], t) : mix(mid[2], b[2], t);
          const scale = 1 + grow * share;
          p[1] = ay + (p[1] - ay) * scale;
          p[2] = az + (p[2] - az) * scale;
        });
        legs.forEach(({ side, all, foot }, i) => {
          const share = on(all) - on(foot);
          if (share <= 0) return;
          const { a, k: mid, b } = legAxis[i];
          // 腿的轴：髋 → 膝 → 踝，照高度在中间取
          const upper = p[1] >= mid[1];
          const t = upper ? Math.min(1, Math.max(0, (a[1] - p[1]) / (a[1] - mid[1] || 1))) : Math.min(1, Math.max(0, (mid[1] - p[1]) / (mid[1] - b[1] || 1)));
          const ax = upper ? mix(a[0], mid[0], t) : mix(mid[0], b[0], t);
          const az = upper ? mix(a[2], mid[2], t) : mix(mid[2], b[2], t);
          // 越靠近腿根，左右方向越是以两腿之间那条缝为准（里侧不动、往外长）；到膝盖就是绕着腿的轴了
          const inner = smooth((p[1] - mid[1]) / (crotch - mid[1] || 1));
          const pivot = mix(ax, side * 0.006, inner);
          const scale = 1 + grow * share;
          p[0] = pivot + (p[0] - pivot) * scale;
          p[2] = az + (p[2] - az) * scale;
        });
      });
    }

    // 腰宽、胯宽：躯干（连裙子）在腰、胯那个高度的一段左右拉宽，前后也跟着厚一点；胯宽时大腿根跟着往外
    const waistY = (rest[need('Spine')][1] + rest[need('Chest')][1]) / 2;
    const hipY = rest[legRoot[1]][1];
    const chestY = rest[upperChest][1];
    const kneeY = rest[knee[1]][1];
    const centerZ = rest[hips][2];
    const band = (y: number, at: number, below: number, above: number) => (y >= at ? smooth(1 - (y - at) / (above - at)) : smooth(1 - (at - y) / (at - below)));
    if (Math.abs(sh.waist - 1) > 1e-6) {
      reshape((p, on) => {
        const share = 1 - on(offBody);
        const amount = band(p[1], waistY, hipY, chestY) * share;
        if (amount <= 0) return;
        p[0] *= 1 + (sh.waist - 1) * amount;
        p[2] = centerZ + (p[2] - centerZ) * (1 + (sh.waist - 1) * 0.7 * amount);
      });
    }
    if (Math.abs(sh.hips - 1) > 1e-6) {
      const upperBody = new Set([...subtree(neck), ...arms.flatMap((a) => [...a.all])]);
      reshape((p, on) => {
        const share = 1 - on(upperBody);
        const amount = band(p[1], hipY, mix(hipY, kneeY, 0.85), waistY) * share;
        if (amount <= 0) return;
        p[0] *= 1 + (sh.hips - 1) * amount;
        p[2] = centerZ + (p[2] - centerZ) * (1 + (sh.hips - 1) * 0.5 * amount);
      });
    }
  }

  /* ---- 这个样式顾不上的设定 ---- */
  const armPairs = Math.max(1, c.armPairs);
  if (c.armPairs === 0) ignored.push(t('去掉手臂'));
  const legs = legPlan(spec);
  /** 从前往后每副胯上几条腿（人马、蛛形是每对腿一站，恒为 2） */
  const stations = legs.stations;
  // 人马、蛛形：胯以下换成兽身
  const legForm = legs.form;
  const form = legForm === 'taur' || legForm === 'spider' ? legForm : 'biped';
  // 人腿人马：身后再接一副她自己的腰、胯和腿。前后串联：她自己的胯和腿复制几份，接在同一截腰下面。
  // 左右并排：她自己的胯中间那一段复制几份排开（见 tile）
  const humantaur = legForm === 'humantaur';
  const row = legForm === 'row';
  const tandem = legForm === 'tandem';
  // 胯部聚拢：做法和前后串联一样，只是几副胯贴得更紧，腿往外散开
  const gather = legForm === 'gather';
  // 横排多胯：她自己的胯和腿复制几份，左右排成一排
  const abreast = legForm === 'abreast';
  /**
   * 几对腿：人马、蛛形是几对；左右并排是条数的一半（单数条时进一）；
   * 人腿前后排的（串联、人腿人马）是几副胯
   */
  const legPairs = row ? Math.ceil(legs.total / 2) : stations.length;
  if (c.eyesPerHead !== 2) ignored.push(t('眼睛数量'));

  /* ---- 头身比：滑块在默认位置（7.5）时就是角色本来的比例 ---- */
  let top = -Infinity;
  let chin = Infinity;
  let sole = Infinity;
  /** 头最宽、最靠前、最靠后到哪。量的是头本身（连贴着头皮的那层头发），蓬起来的头发不算 */
  let headWide = 0;
  let headFront = -Infinity;
  let headBack = Infinity;
  const skull = new Set(subtree(head));
  for (const chunk of chunks) {
    const onHead = share(chunk, skull);
    const face = /Face.*SKIN/i.test(materialName(chunk.material));
    // 蓬起来的头发、戴在头上的兽耳都不算头本身
    const loose = isLooseHair(chunk) || source.earMaterials.includes(chunk.material);
    for (let v = 0; v < onHead.length; v++) {
      const y = chunk.positions[v * 3 + 1];
      if (y < sole) sole = y;
      if (face && y < chin) chin = y;
      if (loose || onHead[v] <= 0.5) continue;
      if (y > top) top = y;
      headWide = Math.max(headWide, Math.abs(chunk.positions[v * 3]));
      headFront = Math.max(headFront, chunk.positions[v * 3 + 2]);
      headBack = Math.min(headBack, chunk.positions[v * 3 + 2]);
    }
  }
  if (chin === Infinity) chin = rest[head][1];

  /* ---- 头发：换发型，再调长短和蓬松 ---- */
  /** 现在头上这副头发的骨骼 */
  let hairBones = source.bones.flatMap((bone, b) => (isHairBone(bone.name) ? [b] : []));
  if (donor) {
    // 她自己的头发骨骼不要了，名字让给新的
    for (const b of hairBones) {
      marker[b] = true;
      names[b] = `${names[b]}~`;
    }
    // 新头发照原主人的头对齐：头的关节对上头的关节，再按两个头的大小之比缩放
    const from = donor.meta.head;
    const fit = (top - chin) / (from.top - from.chin);
    const joint = rest[head];
    const place = (x: number, y: number, z: number): V3 => [
      joint[0] + (x - from.joint[0]) * fit,
      joint[1] + (y - from.joint[1]) * fit,
      joint[2] + (z - from.joint[2]) * fit,
    ];
    const bones = donor.source.bones;
    // 不带任何顶点的梢只是标位置用的（和角色自己的头发一样，见上面的 marker）
    const idleTip = bones.map(() => true);
    for (const bone of bones) if (bone.parent >= 0) idleTip[bone.parent] = false;
    for (const chunk of donor.source.chunks) for (let i = 0; i < chunk.joints.length; i++) if (chunk.weights[i]) idleTip[chunk.joints[i]] = false;
    const donorNames = boneNames(bones);
    // 文件里第 0 根骨骼是头：接的时候换成她自己的那根，其余的照原样加进骨架
    const boneOf = bones.map((bone, i) => {
      if (i === 0) return head;
      names.push(donorNames[i]);
      origin.push({ file: 'hair', bone: i });
      marker.push(idleTip[i] || bone.name.endsWith('_end'));
      parent.push(-1);
      rest.push(place(bone.pos[0], bone.pos[1], bone.pos[2]));
      return names.length - 1;
    });
    bones.forEach((bone, i) => {
      if (i) parent[boneOf[i]] = boneOf[bone.parent];
    });
    hairBones = boneOf.slice(1);
    // 角色自己戴着一副兽耳（不是做在头发里的，换了头发还在）：新头发里自带的那副也不要
    const wearsEars = source.chunks.some((chunk) => source.earMaterials.includes(chunk.material) && !isLooseHair(chunk));
    for (const piece of donor.source.chunks) {
      // 加了工坊的兽耳，这副头发里自带的那副就不要了
      if ((c.earPairsPerHead > 0 || wearsEars) && donor.source.earMaterials.includes(piece.material)) continue;
      const made = copyChunk(piece);
      made.material = donorBase + piece.material;
      for (let i = 0; i < made.positions.length; i += 3) made.positions.set(place(made.positions[i], made.positions[i + 1], made.positions[i + 2]), i);
      for (let k = 0; k < made.joints.length; k++) made.joints[k] = made.weights[k] ? boneOf[made.joints[k]] : 0;
      chunks.push(made);
    }
    original = chunks.length;
  }
  if (spec.hair.volume !== 1 || spec.hair.length !== 1) {
    // 蓬松：整副头发以颅骨的正中为中心放大、缩小；长短：鼻尖以下垂着的那一段上下拉长、缩短。
    // 头发里自带的兽耳不跟着变
    const center: V3 = [rest[head][0], chin + HAIR_CENTER * (top - chin), (headFront + headBack) / 2];
    const line = chin + HAIR_HANG * (top - chin);
    const reshape = (p: { [index: number]: number }, at: number) => {
      for (let k = 0; k < 3; k++) p[at + k] = center[k] + (p[at + k] - center[k]) * spec.hair.volume;
      if (p[at + 1] < line) p[at + 1] = line + (p[at + 1] - line) * spec.hair.length;
    };
    for (const chunk of chunks) {
      if (!isLooseHair(chunk) || builtInEars.has(chunk.material)) continue;
      for (let i = 0; i < chunk.positions.length; i += 3) reshape(chunk.positions, i);
    }
    for (const b of hairBones) reshape(rest[b], 0);
  }

  // 后加的角和兽耳贴着哪里长：头发蓬起来的话，根埋进头发一半（头本身和头发外沿的正中间）。
  // 只看头的上半截，垂下来的长发不算；头发里自带的兽耳也不算
  const headSet = new Set(subtree(head));
  const crest = { top, wide: headWide, front: headFront, back: headBack };
  for (const chunk of chunks) {
    if (!isLooseHair(chunk) || builtInEars.has(chunk.material)) continue;
    const onHead = share(chunk, headSet);
    for (let v = 0; v < onHead.length; v++) {
      const y = chunk.positions[v * 3 + 1];
      if (onHead[v] <= 0.5 || y < (chin + top) / 2) continue;
      crest.top = Math.max(crest.top, y);
      crest.wide = Math.max(crest.wide, Math.abs(chunk.positions[v * 3]));
      crest.front = Math.max(crest.front, chunk.positions[v * 3 + 2]);
      crest.back = Math.min(crest.back, chunk.positions[v * 3 + 2]);
    }
  }
  /** 戴在头上的配饰：材质算衣服，但每个点都跟着头（或者头下面的骨骼）走 */
  const headGear = new Set(chunks.filter((chunk) => isCloth(chunk) && share(chunk, headSet).every((w) => w > 0.5)));
  /** 头发的外沿（头的上半截）：最宽、最靠前、最靠后到哪 */
  const puff = { ...crest };
  crest.top = (crest.top + top) / 2;
  crest.wide = (crest.wide + headWide) / 2;
  crest.front = (crest.front + headFront) / 2;
  crest.back = (crest.back + headBack) / 2;
  const headHeight = top - chin;
  const headJoint = rest[head][1];
  const nativeRatio = (top - sole) / headHeight;
  const ratio = nativeRatio + (sh.headRatio - 7.5);
  const above = top - headJoint;
  const hsOne = (headJoint - sole) / (headHeight * ratio - above);
  /** 标准人形（一个头、不加长）的身高：按它来定整体的缩放 */
  const standard = headJoint - sole + above * hsOne;
  // 一个头上几张脸：只有一个头、一根脖子，多出来的脸长在这个头的两边和后面
  const faces = spec.headLayout === 'faces' && c.heads > 1;
  const necks = faces ? 1 : c.heads;
  // 头多了每个头小一圈（见 bodyPlan.ts）
  const hs = hsOne * headShrink(necks);

  /* ---- 人马 / 蛛形：角色自己的腿不要了，胯坐在兽身前端的背上（兽身到最后才接上去，见 beast.ts） ---- */
  const beast = form === 'biped' ? null : beastBody(form, legPairs);
  const hipJoint = rest[need('UpperLeg_L')];
  /** 腿左右并排时，相邻两副胯的中心隔多远：她两个髋关节间隔的两倍，所有的腿就是等距的一排 */
  const rowPitch = 2 * (hipJoint[0] - rest[need('UpperLeg_R')][0]);
  /** 最外面那一副胯的中心离中线多远 */
  const rowReach = row ? (Math.max(0, legs.total - 2) * rowPitch) / 4 : 0;
  /** 腿左右并排到三对以上，胯张得很宽：手臂多抬起来这么多度，才不会搭在胯（裙子）上 */
  const rowLift = row ? 12 * Math.max(0, legPairs - 2) : 0;
  const beastScale = (BEAST_SIZE * (hipJoint[1] - sole)) / BEAST_HIP;
  /** 兽身上的座位摆到角色身上是哪里 */
  const seatAt: V3 = [0, hipJoint[1] + SEAT_SINK, rest[hips][2]];
  /** 兽身自己坐标里的一点（见 beast.ts）摆到角色身上是哪里 */
  const onBeast = (p: V3): V3 => {
    const from = beast ? beast.seat : p;
    return [seatAt[0] + (p[0] - from[0]) * beastScale, seatAt[1] + (p[1] - from[1]) * beastScale, seatAt[2] + (p[2] - from[2]) * beastScale];
  };
  if (beast) {
    const legs = new Set<number>();
    const shins = new Set<number>();
    for (const root of [need('UpperLeg_L'), need('UpperLeg_R')]) {
      for (const b of subtree(root)) {
        // 有的角色把裙摆的骨骼挂在大腿上：它们不算腿，留着
        if (!/^(UpperLeg|LowerLeg|Foot|Toe)/.test(names[b])) continue;
        legs.add(b);
        if (!/^UpperLeg/.test(names[b])) shins.add(b);
      }
    }
    const kept: Chunk[] = [];
    for (const chunk of chunks) {
      const skin = isSkin(chunk);
      // 皮肤：大半跟着腿的面都去掉。衣服：只去掉膝盖以下的（鞋、袜）；裙子、短裤的下摆哪怕绑在大腿上也留着
      const gone = share(chunk, skin ? legs : shins);
      const made = keepTriangles(chunk, (a, b, d) => gone[a] + gone[b] + gone[d] < 1.5);
      if (!made) continue;
      const onLeg = share(made, legs);
      for (let v = 0; v < onLeg.length; v++) {
        if (!onLeg[v]) continue;
        // 留下来的点里还跟着腿的那部分权重，改成跟着胯
        let slot = -1;
        for (let k = 0; k < 4; k++) {
          if (!made.weights[v * 4 + k]) continue;
          if (legs.has(made.joints[v * 4 + k])) made.weights[v * 4 + k] = 0;
          else if (made.joints[v * 4 + k] === hips) slot = k;
        }
        for (let k = 0; slot < 0; k++) if (!made.weights[v * 4 + k]) slot = k;
        made.joints[v * 4 + slot] = hips;
        made.weights[v * 4 + slot] += onLeg[v];
        if (!skin) continue;
        // 大腿根剩下的那一圈切口是参差的：往髋关节收一收，藏在胯里面
        const t = STUMP_TUCK * smooth(onLeg[v] / 0.6);
        const to: V3 = [Math.sign(made.positions[v * 3]) * hipJoint[0] * 0.6, hipJoint[1] + 0.01, hipJoint[2]];
        for (let k = 0; k < 3; k++) made.positions[v * 3 + k] += (to[k] - made.positions[v * 3 + k]) * t;
      }
      kept.push(made);
    }
    chunks.length = 0;
    chunks.push(...kept);
    original = chunks.length;
    // 腿的骨骼不要了（名字让给兽身的腿）；挂在大腿上的裙摆骨骼最后会改接到胯上
    for (const b of legs) {
      marker[b] = true;
      names[b] = `${names[b]}~`;
    }
  }

  /* ---- 多排手臂、多排胸：把腰以上、胸以下的一段拉长 ---- */
  const stacked = spec.armLayout === 'stack';
  const rows = Math.max(stacked ? armPairs : 1, c.chestPairs, 1);
  const extra = GAP * (rows - 1);
  const bustY = busts.length ? rest[busts[0]][1] : rest[upperChest][1];
  const bustX = busts.length ? Math.abs(rest[busts[0]][0]) : 0.05;
  const zoneTop = bustY - 0.055;
  const zoneBottom = zoneTop - 0.08;
  const lift = (y: number) => y + extra * smooth((y - zoneBottom) / (zoneTop - zoneBottom));
  if (extra) {
    for (const chunk of chunks) for (let i = 1; i < chunk.positions.length; i += 3) chunk.positions[i] = lift(chunk.positions[i]);
    for (const p of rest) p[1] = lift(p[1]);
  }

  /* ---- 多个头：凑成一簇，脖子根并排挤在肩膀中间（见 bodyPlan.ts）；实在排不下，肩膀才稍微加宽一点 ---- */
  // 加宽是从胸口往上逐渐加宽，到肩膀加到最宽。手臂整个跟着肩头往外挪，脖子和头不动。
  /**
   * 头有多宽：蓬起来的头发不算（头和头之间头发是互相搭着的），支出去的耳朵也不算。
   * 量出来的最宽处常常是耳朵尖，所以不超过头高的四分之三（二次元的脸差不多是这个比例）
   */
  const headWidth = Math.min(2 * headWide, HEAD_ASPECT * headHeight) * hs;
  // 「肩宽」也是在这里加宽、收窄的：收窄的时候脖子根照样要排得下
  const span = shoulderSpan(necks, headWidth, rest[upperArm[1]][0] * sh.shoulders, NECK_ROOM);
  const widen = span - rest[upperArm[1]][0];
  if (Math.abs(widen) > 1e-6) {
    const from = bustY + extra - 0.05;
    const to = rest[upperArm[1]][1] - 0.015;
    const armL = new Set(subtree(upperArm[1]));
    const armR = new Set(subtree(upperArm[-1]));
    const neckSet = new Set(subtree(neck));
    /** 躯干上的一点往外挪多少（带正负号） */
    const pushed = (x: number, y: number) => Math.sign(x) * widenShift(x, y, widen, from, to, WIDEN_CORE);
    for (const chunk of chunks) {
      for (let v = 0; v < chunk.positions.length / 3; v++) {
        let left = 0;
        let right = 0;
        let fixed = 0;
        for (let k = 0; k < 4; k++) {
          const w = chunk.weights[v * 4 + k];
          if (!w) continue;
          const b = chunk.joints[v * 4 + k];
          if (armL.has(b)) left += w;
          else if (armR.has(b)) right += w;
          else if (neckSet.has(b)) fixed += w;
        }
        const torso = 1 - left - right - fixed;
        chunk.positions[v * 3] += widen * (left - right) + (torso > 0 ? torso * pushed(chunk.positions[v * 3], chunk.positions[v * 3 + 1]) : 0);
      }
    }
    rest.forEach((p, b) => {
      if (armL.has(b)) p[0] += widen;
      else if (armR.has(b)) p[0] -= widen;
      else if (!neckSet.has(b)) p[0] += pushed(p[0], p[1]);
    });
  }

  /* ---- 找表面：躯干（不算手臂，也不算头和垂下来的头发）的侧面、前面、后面在哪 ---- */
  const offTorso = new Set([...subtree(upperArm[1]), ...subtree(upperArm[-1]), ...headSet]);
  const torsoTriangles: number[] = [];
  for (const chunk of chunks) {
    const off = share(chunk, offTorso);
    for (let t = 0; t < chunk.indices.length; t += 3) {
      const [a, b, d] = [chunk.indices[t], chunk.indices[t + 1], chunk.indices[t + 2]];
      if (off[a] + off[b] + off[d] >= 1.5) continue;
      for (const v of [a, b, d]) torsoTriangles.push(chunk.positions[v * 3], chunk.positions[v * 3 + 1], chunk.positions[v * 3 + 2]);
    }
  }
  const probe = makeProbe(new Float32Array(torsoTriangles));
  const sideAt = (y: number, z: number) => probe(0, y, z, 1, 0.08);
  const frontAt = (x: number, y: number) => probe(2, x, y, 1, 0.06);
  const backAt = (x: number, y: number) => probe(2, x, y, -1, -0.06);
  /** 这个高度该接在脊柱的哪一节上 */
  const spineAt = (y: number) => {
    let best = spineLevels[0];
    for (const b of spineLevels) if (rest[b][1] <= y && rest[b][1] >= rest[best][1]) best = b;
    return best;
  };

  /**
   * 把 roots 这几根骨骼带着的那一片网格复制一份。
   * place / turn：复制出来的点和法线怎么挪。place 的第二个参数：这个点是不是皮肤上的；
   * 第三个：这个点有多少权重跟着 roots（骨骼的关节按「皮肤上、整个跟着 roots」算）；
   * anchor：这一片里原来跟着别的骨骼的权重，改成跟着谁（也可以从「原来的骨骼 → 复制出来的骨骼」里挑一根）。
   * threshold：一个面上平均有多少权重跟着 roots 才算这一片的。
   * 其余的选项：
   * - bones：骨骼要不要也复制一份（index 是第几份，名字后面的序号；复制出来的 root 接在 rootParent 下面；
   *   shared 说是的那些不复制，复制出来的网格照旧跟着原来那一根）；不复制的话整片都跟着 anchor；
   * - only：roots 下面的骨骼里只算哪些（缺省全算）；
   * - skip：哪些网格不要复制；within：只复制三个顶点都在这个范围里的面；material：复制出来的换用哪种材质。
   * 返回「原来的骨骼 → 复制出来的骨骼」。
   */
  const clone = (
    roots: number[],
    label: string,
    place: (p: V3, skin: boolean, on: number) => V3,
    turn: (n: V3, p: V3) => V3,
    anchor: number | ((made: Map<number, number>) => number),
    threshold: number,
    options: {
      bones?: { index: number; rootParent: number; shared?: (bone: number) => boolean };
      only?: (bone: number) => boolean;
      skip?: (chunk: Chunk) => boolean;
      within?: (x: number, y: number, z: number) => boolean;
      material?: (index: number) => number;
    } = {},
  ): Map<number, number> => {
    const { bones, only, skip, within, material } = options;
    const members = roots.flatMap(subtree).filter((b) => !only || only(b));
    const map = new Map<number, number>();
    if (bones) {
      for (const b of members) {
        if (bones.shared?.(b)) {
          map.set(b, b);
          continue;
        }
        map.set(b, names.length);
        names.push(nthName(names[b], bones.index));
        origin.push(origin[b]);
        marker.push(marker[b]);
        parent.push(roots.includes(b) ? bones.rootParent : map.get(parent[b])!);
        rest.push(place(rest[b], true, 1));
      }
    }
    const fallback = typeof anchor === 'function' ? anchor(map) : anchor;
    const set = new Set(members);
    for (let n = 0; n < original; n++) {
      const from = chunks[n];
      if (skip?.(from)) continue;
      const on = share(from, set);
      const skin = isSkin(from);
      const remap = new Map<number, number>();
      const indices: number[] = [];
      for (let t = 0; t < from.indices.length; t += 3) {
        const tri = [from.indices[t], from.indices[t + 1], from.indices[t + 2]];
        if ((on[tri[0]] + on[tri[1]] + on[tri[2]]) / 3 < threshold) continue;
        if (within && !tri.every((v) => within(from.positions[v * 3], from.positions[v * 3 + 1], from.positions[v * 3 + 2]))) continue;
        for (const v of tri) {
          let id = remap.get(v);
          if (id === undefined) {
            id = remap.size;
            remap.set(v, id);
          }
          indices.push(id);
        }
      }
      if (!indices.length) continue;
      const count = remap.size;
      const made: Chunk = {
        name: `${from.name}_${label}`,
        material: material ? material(from.material) : from.material,
        positions: new Float32Array(count * 3),
        normals: new Float32Array(count * 3),
        uvs: new Float32Array(count * 2),
        joints: new Uint16Array(count * 4),
        weights: new Float32Array(count * 4),
        indices: Uint32Array.from(indices),
      };
      if (from.faceVertex) {
        made.faceVertex = new Int32Array(count);
        copyOf.set(made, label);
      }
      cloned.set(made, from);
      for (const [v, id] of remap) {
        if (from.faceVertex) made.faceVertex![id] = from.faceVertex[v];
        const p: V3 = [from.positions[v * 3], from.positions[v * 3 + 1], from.positions[v * 3 + 2]];
        made.positions.set(place(p, skin, on[v]), id * 3);
        made.normals.set(turn([from.normals[v * 3], from.normals[v * 3 + 1], from.normals[v * 3 + 2]], p), id * 3);
        made.uvs[id * 2] = from.uvs[v * 2];
        made.uvs[id * 2 + 1] = from.uvs[v * 2 + 1];
        // 原来跟着好几根别的骨骼的权重现在都归到 anchor 上：同一根骨骼只占一格，权重加在一起
        let filled = 0;
        for (let k = 0; k < 4; k++) {
          const w = from.weights[v * 4 + k];
          if (!w) continue;
          const bone = map.get(from.joints[v * 4 + k]) ?? fallback;
          let slot = 0;
          while (slot < filled && made.joints[id * 4 + slot] !== bone) slot++;
          if (slot === filled) made.joints[id * 4 + filled++] = bone;
          made.weights[id * 4 + slot] += w;
        }
      }
      chunks.push(made);
    }
    return map;
  };
  /** 复制出来的脸各是哪一份（clone 的 label）：最后给每张脸算「原始的脸 → 这张脸」时用 */
  const copyOf = new Map<Chunk, string>();
  /** 复制出来的那一片 → 照哪一片复制的 */
  const cloned = new Map<Chunk, Chunk>();

  const pose = new Map<number, BonePose>();

  /* ---- 手臂 ---- */
  const shoulder = rest[upperArm[1]];
  /**
   * 肩部扇形聚拢时，第 i 对手臂的肩关节放在哪：第一对是角色本来的肩，
   * 多出来的从它后面长出来，一对比一对靠后、稍低、往里收一点（见 bodyPlan.ts）。
   * 这样多出来的肩头都藏在肩膀后面，不会从胸前顶出来。
   */
  const fanJoint = (i: number): V3 => {
    const shift = fanShift(i, armPairs);
    return [shoulder[0] + shift[0], shoulder[1] + shift[1], shoulder[2] + shift[2]];
  };
  /**
   * 沿躯干上下排时，第 i 排（i ≥ 1）的肩关节：贴着躯干侧面，前后在躯干厚度的正中。
   * 关节在躯干表面上，肩头朝外的半边就整个露在外面，像一副真的肩膀。
   */
  const stackJoint = (y: number): V3 => {
    const mid = (frontAt(0, y) + backAt(0, y)) / 2;
    return [Math.max(sideAt(y, mid) - STACK_IN, 0.06), y, mid];
  };
  /**
   * 给下面一排手臂垫出一副肩膀：把肩关节周围的躯干往两边鼓出来一块，鼓到快够着关节，
   * 正好包住肩头朝里的那一圈切口。at 是左边那个肩关节，右边对称着一起鼓。
   */
  const padShoulders = (at: V3) => {
    const reach = at[0] + PAD_COVER;
    for (let n = 0; n < original; n++) {
      const chunk = chunks[n];
      const off = share(chunk, offTorso);
      for (let v = 0; v < off.length; v++) {
        const x = chunk.positions[v * 3];
        const wide = Math.abs(x);
        if (off[v] >= 1 || wide >= reach) continue;
        const fall = smooth(1 - Math.hypot(chunk.positions[v * 3 + 1] - at[1], chunk.positions[v * 3 + 2] - at[2]) / PAD_RADIUS);
        // 正中间那一条不动，免得把胸口的花纹扯开
        const push = (reach - wide) * fall * (1 - off[v]) * smooth((wide - 0.02) / 0.04);
        if (push > 0) chunk.positions[v * 3] = Math.sign(x) * (wide + push);
      }
    }
  };
  let hang: number[] = [];
  if (!stacked && !tPose) {
    // 自然下垂时，最贴身的一对要让开胯（连裙子）和下面几排胸
    // 腿左右并排时胯是并排的好几副，最外面那一副的外沿才是要让开的
    const blocks: HangBlock[] = [{ wide: sideAt(rest[hips][1], 0) + rowReach, level: rest[hips][1] }];
    // 兽身最宽的地方也要让开
    if (beast) blocks.push({ wide: beast.wide * beastScale, level: onBeast([0, beast.level, 0])[1] });
    for (let j = 0; j < c.chestPairs; j++) blocks.push({ wide: bustX + 0.095 * sh.bust * (1 - 0.1 * j), level: bustY + extra - j * GAP });
    // 蛛腿在两侧高高拱起，手臂垂不下去，只能停在腿的上方
    hang = hangAngles(armPairs, 48 + rowLift, { x: shoulder[0], y: shoulder[1] }, blocks, form === 'spider' ? 45 : 18, 0.065);
  }
  for (let i = 0; i < armPairs; i++) {
    const mid = i - (armPairs - 1) / 2;
    let at: V3;
    let theta: number;
    let phi: number;
    if (stacked) {
      at = i === 0 ? [shoulder[0], shoulder[1], shoulder[2]] : stackJoint(shoulder[1] - i * GAP);
      if (i > 0) padShoulders(at);
      // 越往下越收拢，前后错开。蛛形下身的腿在两侧高高拱起，手臂就少收拢、少前摆一些
      theta = tPose ? 90 * DEG : Math.min(90, 48 - i * (form === 'spider' ? 2 : 6) + rowLift + (i && row ? 12 : 0)) * DEG;
      phi = tPose ? 0 : mid * (form === 'spider' ? 0.1 : 0.2);
    } else if (tPose) {
      // 本来的那一对在最前面、放得最低；后面的一对比一对举得高。靠前的往前摆，靠后的往后摆
      const high = 125 - (faces ? 1 : c.heads - 1) * 8;
      const low = Math.max(45, Math.min(180 - high, high - 20 * (armPairs - 1)));
      at = fanJoint(i);
      theta = (armPairs === 1 ? 90 : low + (i * (high - low)) / (armPairs - 1)) * DEG;
      phi = -mid * 0.35;
    } else {
      // 本来的那一对在最前面，垂得最直、最贴身；后面的一对比一对张得开，正面看是一层层的扇面
      at = fanJoint(i);
      theta = hang[armPairs - 1 - i] * DEG;
      phi = -mid * 0.18;
    }
    const [x, y, jz] = at;
    for (const side of SIDES) {
      let upper = upperArm[side];
      let lower = lowerArm[side];
      if (i > 0) {
        const from = rest[upperArm[side]];
        const delta: V3 = [side * x - from[0], y - from[1], jz - from[2]];
        // 新的锁骨：从脊柱旁边伸到新的肩关节；复制出来的手臂接在它下面
        const collar = names.length;
        names.push(nthName(`Shoulder_${tag(side)}`, i));
        origin.push(null);
        marker.push(false);
        parent.push(stacked ? spineAt(y) : upperChest);
        rest.push([side * 0.025, y + 0.012, jz]);
        // 上下排：袖子根那一圈切口收拢、退进躯干里（这时手臂还是平举着的，顺着手臂就是左右方向）
        const tucked = (p: V3, on: number): V3 => {
          const rim = stacked ? smooth((SLEEVE_FROM - on) / SLEEVE_SPAN) : 0;
          if (!rim) return p;
          const along = side * (p[0] - from[0]);
          const keep = 1 - SLEEVE_SHRINK * rim;
          return [
            from[0] + side * Math.min(along, along + (-SLEEVE_SINK - along) * rim),
            from[1] + (p[1] - from[1]) * keep,
            from[2] + (p[2] - from[2]) * keep,
          ];
        };
        const map = clone(
          [upperArm[side]],
          `Arm_${pad(i + 1)}_${tag(side)}`,
          (p, _skin, on) => {
            const q = tucked(p, on);
            return [q[0] + delta[0], q[1] + delta[1], q[2] + delta[2]];
          },
          (n) => n,
          collar,
          0.5,
          { bones: { index: i, rootParent: collar } },
        );
        upper = map.get(upper)!;
        lower = map.get(lower)!;
      }
      // 角色的手臂是平举着的：上臂绕肩关节转到要的方向；放下来时手肘再往前弯一点
      const turn = quatBetween([side, 0, 0], armDirection(side, theta, phi));
      const straight = tPose && Math.abs(theta - 90 * DEG) < 1e-9 && Math.abs(phi) < 1e-9;
      if (!straight) pose.set(upper, { rotation: turn });
      if (!tPose) pose.set(lower, { rotation: quatEuler(0, -side * ELBOW_BEND, 0) });
    }
  }

  /* ---- 头：正中的（或者偏左的那个）是角色自己的头，其余的是复制出来的 ---- */
  const own = Math.ceil((necks - 1) / 2);
  const heads: number[] = [];
  /** 每个头摆在哪：后面给它们放角和耳朵用 */
  const headSpots: ExtraHead[] = [];
  // 头的正中（下巴和头顶的中点，前后取中间再往前一点），以及头放大缩小以后它到了哪
  const neckBase: V3 = [rest[neck][0], rest[neck][1], rest[neck][2]];
  const headPivot = rest[head];
  const middle: V3 = [0, (chin + crest.top) / 2 + extra, (crest.front + crest.back) / 2 + 0.012];
  const scaled: V3 = [
    headPivot[0] + (middle[0] - headPivot[0]) * hs,
    headPivot[1] + (middle[1] - headPivot[1]) * hs,
    headPivot[2] + (middle[2] - headPivot[2]) * hs,
  ];
  /** 脖子本来的样子：从脖子根到头的关节 */
  const nativeNeck: V3 = [headPivot[0] - neckBase[0], headPivot[1] - neckBase[1], headPivot[2] - neckBase[2]];
  const places = headCluster(necks, { width: headWidth, neck: len(nativeNeck), rise: scaled[1] - headPivot[1] }, shoulder[0] - NECK_ROOM);
  /**
   * 脖子加长 amount：脖子根不动，下巴以上整个抬高。
   * 皮肤是从脖子根到下巴均匀拉开；围在脖子上的衣领不拉长（拉长了花纹会扯成一条条的），整个跟着头往上走。
   */
  const chinAt = chin + extra;
  const raise = (y: number, amount: number, skin: boolean) =>
    amount * (skin ? smooth((y - neckBase[1]) / (chinAt - neckBase[1])) : smooth((y - neckBase[1] + COLLAR_SLACK) / COLLAR_SLACK));
  /** 肩膀顶上离中线 x 的地方比脖子根低多少：复制出来的脖子挪到那里要往下埋这么多，不然底下露缝 */
  const slope = (x: number) =>
    Math.max(0, neckBase[1] - shoulder[1] - 0.03) * smooth((Math.abs(x) - NECK_RADIUS * 0.6) / Math.max(shoulder[0] - NECK_RADIUS * 0.6, 1e-6));
  /**
   * 复制出来的脖子，最底下那一圈（一半跟着脖子、一半跟着胸的那些点）是照着三角面切下来的，边缘是参差的：
   * 把这一圈往脖子的轴线收拢、再往下沉一点，藏进肩膀里面，露在外面的就只有光溜的脖子。
   * on：这个点有多少权重跟着脖子和头。
   */
  const tuck = (p: V3, on: number): V3 => {
    const rim = smooth((RIM_FROM - on) / RIM_SPAN);
    if (!rim) return p;
    const keep = 1 - RIM_SHRINK * rim;
    return [neckBase[0] + (p[0] - neckBase[0]) * keep, p[1] - RIM_SINK * rim, neckBase[2] + (p[2] - neckBase[2]) * keep];
  };
  let ownStretch = 0;
  for (let k = 0; k < necks; k++) {
    const place = places[k];
    // 脖子的骨骼带着整个头斜过去（不拧），头的骨骼再把头转到排好的朝向：脖子上的皮肤跟着顺过去
    const lean = quatBetween(UP, norm(place.neck));
    const turn = headTurn(place);
    const upright = quatMul(quatConj(lean), turn);
    const moved = place.x !== 0 || place.z !== 0 || place.tilt !== 0 || place.turn !== 0;
    // k 越大越靠角色的左手边。两边长着脸的时候，两侧也算挨着东西
    const beside = faces ? { left: c.heads > 2, right: c.heads > 2 } : { left: k < c.heads - 1, right: k > 0 };
    /** 这个头摆好以后的正中：脖子根挪 move、脖子加长 stretch */
    const centerAt = (move: V3, stretch: number): V3 => {
      const joint = rotate(lean, [nativeNeck[0], nativeNeck[1] + stretch, nativeNeck[2]]);
      const up = rotate(turn, [scaled[0] - headPivot[0], scaled[1] - headPivot[1], scaled[2] - headPivot[2]]);
      return [neckBase[0] + move[0] + joint[0] + up[0], neckBase[1] + move[1] + joint[1] + up[1], neckBase[2] + move[2] + joint[2] + up[2]];
    };
    if (k === own) {
      // 自己的头不拆下来
      const move: V3 = [place.x, 0, place.z];
      if (moved) {
        pose.set(neck, { rotation: lean, move });
        pose.set(head, { rotation: upright });
      }
      ownStretch = len(place.neck) - len(nativeNeck);
      heads.push(head);
      headSpots.push({ index: 0, bone: 'Head', center: centerAt(move, ownStretch), quat: turn, scale: hs, beside });
      continue;
    }
    // 复制出来的脖子根顺着脖子的方向往下埋一点，插进肩膀里，不留缝；埋下去的那一截靠加长补回来，头还在排好的位置
    const along = norm(place.neck);
    const bury = (NECK_BURY + slope(place.x)) / Math.max(along[1], 0.5);
    const move: V3 = [place.x - bury * along[0], -bury * along[1], place.z - bury * along[2]];
    const stretch = len(place.neck) - len(nativeNeck) + bury;
    // 复制出来的头依次是第 2、3 … 个（Head.002、Head.003 …）
    const index = k < own ? k + 1 : k;
    const map = clone(
      [neck],
      `Head_${pad(index + 1)}`,
      (p, skin, on) => {
        // 头发、五官整个跟着头走；脖子的皮肤从脖子根到下巴均匀拉开，最底下那一圈收进肩膀里
        const q = skin ? tuck(p, on) : p;
        return [q[0] + move[0], q[1] + (skin ? raise(q[1], stretch, true) : stretch) + move[1], q[2] + move[2]];
      },
      (n) => n,
      upperChest,
      0.5,
      // 衣领不复制：它是从连衣裙上切下来的，只能切成一片片参差的碎片。多出来的脖子是光着的。
      // 戴在头上的配饰（兔耳、狼耳这种）材质也算衣服，但整个跟着头：照样复制
      // 这个头分开染了别的颜色：头发、头皮换用它自己那一份材质
      { bones: { index, rootParent: upperChest }, skip: (chunk) => isCloth(chunk) && !headGear.has(chunk), material: (m) => headDyes.get(index)?.get(m) ?? m },
    );
    pose.set(map.get(neck)!, { rotation: lean });
    pose.set(map.get(head)!, { rotation: upright });
    heads.push(map.get(head)!);
    headSpots.push({ index, bone: nthName('Head', index), center: centerAt(move, stretch), quat: turn, scale: hs, beside });
  }
  if (faces) {
    // 一个头上多出来的脸：把角色自己的脸（耳朵往前的那一半，连刘海）复制一份，绕头的竖轴转到两边、后面去。
    // 它们没有自己的骨骼，整片跟着头
    const axisZ = (headFront + headBack) / 2;
    const depth = headFront - axisZ;
    const cut = axisZ + depth * FACE_CUT;
    const midY = (chin + top) / 2 + extra;
    // 往外挪多少：眼睛那一圈要露在正面那个头的头发外面
    const sideOut = Math.max(FACE_OUT * headWide, puff.wide - depth * FACE_SHOW * FACE_SIZE);
    const backOut = Math.max(FACE_OUT * headWide, axisZ - puff.back - depth * FACE_SHOW * FACE_SIZE);
    // 只要头上的东西（脸、头发）：脖子的皮肤有一截也跟着头，切下来是一片片挂在下巴底下的碎片
    const onHead = new Set(chunks.slice(0, original).filter((chunk) => share(chunk, headSet).reduce((sum, w) => sum + w, 0) > 0.9 * (chunk.positions.length / 3)));
    faceTurns(c.heads).forEach((yaw, i) => {
      if (!i) return;
      const q = quatEuler(0, yaw, 0);
      const out = backOut + (sideOut - backOut) * Math.abs(Math.sin(yaw));
      clone(
        [head],
        `Face_${pad(i + 1)}`,
        (p) => {
          const r = rotate(q, [p[0] * FACE_SIZE, 0, (p[2] - axisZ) * FACE_SIZE + out]);
          return [r[0], midY + (p[1] - midY) * FACE_SIZE, r[2] + axisZ];
        },
        (n) => rotate(q, n),
        head,
        0.5,
        {
          // 头发里自带的那副兽耳只留正面那个头上的
          skip: (chunk) => !onHead.has(chunk) || builtInEars.has(chunk.material),
          within: (_x, _y, z) => z > cut,
          // 切下来的脸是半个壳：皮肤两面都画，从后面看过去才不是透的
          material: (index) => (isSkinMaterial(index) ? bothSides(index) : index),
        },
      );
    });
  }
  if (ownStretch) {
    // 自己的头也要加长脖子：趁还没摆姿势，把跟着脖子、头走的点沿脖子抬高（复制的那几个已经复制完了，不受影响）
    const neckSet = new Set(subtree(neck));
    for (let n = 0; n < original; n++) {
      const chunk = chunks[n];
      const on = share(chunk, neckSet);
      const skin = isSkin(chunk);
      for (let v = 0; v < on.length; v++) if (on[v] > 0) chunk.positions[v * 3 + 1] += raise(chunk.positions[v * 3 + 1], ownStretch, skin) * on[v];
    }
    for (const b of neckSet) if (b !== neck) rest[b][1] += raise(rest[b][1], ownStretch, true);
  }
  if (Math.abs(hs - 1) > 1e-6) for (const b of heads) pose.set(b, { ...pose.get(b), scale: hs });

  /* ---- 胸：第一排是角色自带的，大小靠胸的骨骼来缩放；往下每排是复制出来的一片 ---- */
  if (busts.length) {
    if (Math.abs(sh.bust - 1) > 1e-6) for (const b of busts) pose.set(b, { scale: sh.bust });
    const under = frontAt(bustX, bustY + extra - 0.07);
    for (let j = 1; j < c.chestPairs; j++) {
      const down = j * GAP;
      const size = sh.bust * (1 - 0.1 * j);
      const center: V3 = [0, bustY + extra, rest[busts[0]][2]];
      // 贴着这一排所在高度的躯干前面，稍微埋进去一点
      const dz = frontAt(bustX, bustY + extra - 0.07 - down) - under - 0.006;
      // 这一片不带骨骼：整片跟着所在高度的那节脊柱
      clone(
        busts,
        `Chest_${pad(j + 1)}`,
        (p) => [center[0] + (p[0] - center[0]) * size, center[1] + (p[1] - center[1]) * size - down, center[2] + (p[2] - center[2]) * size + dz],
        (n) => n,
        spineAt(bustY + extra - down),
        0.25,
      );
    }
  } else if (c.chestPairs > 1 || Math.abs(sh.bust - 1) > 1e-6) {
    ignored.push(t('胸'));
  }

  /* ---- 单数条腿、一副胯上好几条腿用的几样做法 ---- */
  /** 腿上的骨骼（有的角色把裙摆的骨骼挂在大腿上：它们不算腿） */
  const LEG_BONE = /^(UpperLeg|LowerLeg|Foot|Toe)/;
  /** 一条腿的整串骨骼：腿上的，加上标位置的梢（脚尖的 _end，骨骼的终点照它定） */
  const legTree = (root: number) => {
    const tree = new Set<number>();
    // subtree 里父骨骼总在子骨骼前面：梢只要接在腿上的（裙摆骨骼的梢不算）
    for (const b of subtree(root)) if (LEG_BONE.test(names[b]) || (marker[b] && tree.has(parent[b]))) tree.add(b);
    return [...tree];
  };
  /** 骨骼名去掉序号和左右：UpperLeg_L.002 → UpperLeg */
  const legBase = (b: number) => names[b].replace(/\.\d+$/, '').replace(/_[LR]$/, '');
  const hipX = hipJoint[0];
  const hipLevel = hipJoint[1];
  const waistLevel = (rest[need('Spine')][1] + rest[need('Chest')][1]) / 2;
  /** 腿的骨骼要不要最后照位置重新起名（有并成一条的、一副胯上不是一对的） */
  let renameLegs = false;
  /** 同一个顶点上同一根骨骼只占一格：把重复的那几格的权重加到第一格上 */
  const mergeSlots = (chunk: Chunk, v: number) => {
    for (let a = 0; a < 4; a++) {
      if (!chunk.weights[v * 4 + a]) continue;
      for (let b = a + 1; b < 4; b++) {
        if (chunk.weights[v * 4 + b] && chunk.joints[v * 4 + b] === chunk.joints[v * 4 + a]) {
          chunk.weights[v * 4 + a] += chunk.weights[v * 4 + b];
          chunk.weights[v * 4 + b] = 0;
          chunk.joints[v * 4 + b] = 0;
        }
      }
    }
  };
  /**
   * 把一副胯上的两条腿（left、right 是两条腿的大腿根骨骼）并成一条长在 cx 上的腿。
   * 每条腿以自己的中轴为界：外侧那一半往 cx 挪过去，两条腿的外侧在 cx 上对上，拼成一条左右对称的腿；
   * 里侧那一半压扁在 cx 那个竖面上，藏在拼好的腿里面。不用切开、不添面，短裤、袜子、鞋都跟着并；
   * 裙摆这些不跟着腿走的不动。大腿根那一圈照它跟着腿的多少过渡。
   * right 那条腿的权重改给 left 那一套骨骼，left 那一套就是并好的这条腿的骨骼（最后照位置起名）
   */
  const fold = (left: number, right: number, cx: number) => {
    const L = legTree(left);
    const R = legTree(right);
    const mate = new Map<number, number>();
    for (const r of R) {
      if (marker[r]) continue;
      const l = L.find((b) => !marker[b] && legBase(b) === legBase(r));
      if (l !== undefined) mate.set(r, l);
    }
    const weighted = new Set([...L, ...R].filter((b) => !marker[b]));
    // 腿的中轴离 cx 多远：照高度在髋、膝、踝三个关节之间取（她的腿往脚并拢，越往下离 cx 越近）
    const joint = (base: string) => rest[L.find((b) => !marker[b] && legBase(b) === base)!];
    const [hip, knee, ankle] = ['UpperLeg', 'LowerLeg', 'Foot'].map(joint);
    const axis = (y: number) => {
      const [a, b] = y >= knee[1] ? [hip, knee] : [knee, ankle];
      const t = Math.min(1, Math.max(0, (a[1] - y) / (a[1] - b[1] || 1)));
      return Math.abs(a[0] + (b[0] - a[0]) * t - cx);
    };
    const move = (x: number, y: number, amount: number) => {
      const u = x - cx;
      const a = axis(y);
      const to = Math.abs(u) >= a ? u - Math.sign(u) * a : 0;
      return cx + u + (to - u) * amount;
    };
    for (const chunk of chunks) {
      const on = share(chunk, weighted);
      for (let v = 0; v < on.length; v++) {
        if (!on[v]) continue;
        chunk.positions[v * 3] = move(chunk.positions[v * 3], chunk.positions[v * 3 + 1], Math.min(1, on[v]));
        for (let k = 0; k < 4; k++) {
          const to = mate.get(chunk.joints[v * 4 + k]);
          if (to !== undefined && chunk.weights[v * 4 + k]) chunk.joints[v * 4 + k] = to;
        }
        mergeSlots(chunk, v);
      }
    }
    for (const b of [...L, ...R]) rest[b] = [move(rest[b][0], rest[b][1], 1), rest[b][1], rest[b][2]];
    // 右边那一套骨骼不要了
    for (const b of R) {
      marker[b] = true;
      names[b] = `${names[b]}~`;
    }
    renameLegs = true;
  };
  /**
   * 一条腿（root 是大腿根）斜过去：从髋关节往下斜着挪，到脚踝挪满 amount（x 方向），脚踝以下整个平移，
   * 膝盖、脚踝还是水平的，鞋不变形、平踩在地上
   */
  const lean = (root: number, amount: number) => {
    const ankleY = rest[need('Foot_L')][1];
    const drop = (y: number) => Math.min(1, Math.max(0, (hipLevel - y) / (hipLevel - ankleY)));
    const tree = legTree(root);
    const on = new Set(tree.filter((b) => !marker[b]));
    for (const chunk of chunks) {
      const weight = share(chunk, on);
      for (let v = 0; v < weight.length; v++) if (weight[v]) chunk.positions[v * 3] += amount * weight[v] * drop(chunk.positions[v * 3 + 1]);
    }
    for (const b of tree) rest[b] = [rest[b][0] + amount * drop(rest[b][1]), rest[b][1], rest[b][2]];
  };
  /**
   * 腿改成笔直朝下（脚踝在髋关节正下方）：她自己的腿是往脚并拢的，照原样排一排的话相邻两条的脚会凑在一起。
   * roots：这几条腿的大腿根
   */
  const straighten = (roots: number[]) => {
    for (const root of roots) {
      const foot = legTree(root).find((b) => !marker[b] && legBase(b) === 'Foot');
      if (foot === undefined) continue;
      const amount = rest[root][0] - rest[foot][0];
      if (Math.abs(amount) >= 1e-6) lean(root, amount);
    }
  };
  /** 一副胯：带着它的骨骼（Hips 或者复制出来的那一根）、两条腿的大腿根，它的网格是哪几块、骨骼是哪些 */
  interface Pelvis {
    hips: number;
    left: number;
    right: number;
    chunks: number[];
    bones: number[];
  }
  const aboveChest = new Set(subtree(upperChest));
  const ownPelvis = (): Pelvis => ({
    hips,
    left: need('UpperLeg_L'),
    right: need('UpperLeg_R'),
    chunks: Array.from({ length: original }, (_, i) => i),
    bones: subtree(hips).filter((b) => b < source.bones.length && !aboveChest.has(b)),
  });
  /** 胯从腰往下渐渐挪开，到髋关节那么高挪足（见 tile）：挪了几成，和它随高度变多快 */
  const band = (y: number) => smooth((waistLevel - y) / (waistLevel - hipLevel));
  const bandRate = (y: number) => {
    const t = (waistLevel - y) / (waistLevel - hipLevel);
    return t <= 0 || t >= 1 ? 0 : (-6 * t * (1 - t)) / (waistLevel - hipLevel);
  };
  /** 中间补的腿用的序号（名字后面的 .0xx，最后照位置重新起名） */
  let spareLegs = 0;
  /**
   * 一副胯上并排 n 条腿（三条以上）：照原样复制胯中间那一段，一份挨着一份排开，每两条腿之间都是一个原样的裆部。
   * 「中段」是离中线 c 以内的那一段：c 随高度变，腰上是 0，往下渐渐变宽，到髋关节那么高是髋关节离中线的距离，
   * 腿上一直是这么宽——也就是两条腿各自的里侧一半，加上它们中间的裆部。
   * 负 x 那半边连着中段往负 x 挪，正 x 那半边连着中段往正 x 挪，中间再排 n - 3 份中段，一份挨着一份（相邻两份隔 2c），
   * 一共 n - 1 份。接缝都在离中线 ±c 的那两个面上：左右对称，两份的切面对得上；在腿上就是腿的正中，
   * 中间的腿是一条腿的里侧一半和另一条腿的里侧一半拼的（骨骼照正 x 那条腿复制一套）。
   * 没有拉宽的地方，衣服花纹、褶子、裆部都是原样的；腰往下渐渐挪开的那一段是斜着挪的。手臂、头、头发不动。
   * 腿要先照直（见 straighten），切面才一直在腿的正中
   */
  const tile = (pelvis: Pelvis, n: number) => {
    straighten([pelvis.left, pelvis.right]);
    const D = (n - 2) * hipX;
    const plus = legTree(pelvis.left);
    const minus = legTree(pelvis.right);
    const plusSet = new Set(plus);
    const minusSet = new Set(minus);
    // 中间那几条腿（从负 x 数第 1 … n - 2 条，在 (2k - (n - 1)) 个髋关节间距的地方）：照正 x 那条腿复制一套骨骼
    const chains: Map<number, number>[] = [new Map()];
    for (let k = 1; k < n - 1; k++) {
      const dx = (2 * k - n) * hipX;
      const index = 40 + spareLegs++;
      const chain = clone([pelvis.left], `Leg_${pad(index)}`, (p) => [p[0] + dx, p[1], p[2]], (m) => m, pelvis.hips, 1, {
        bones: { index, rootParent: pelvis.hips },
        only: (b) => plusSet.has(b),
        skip: () => true,
      });
      // 后面几副胯的腿本来就带着序号（UpperLeg_L.002）：换成这一套的，不叠两个
      for (const [from, to] of chain) names[to] = nthName(names[from].replace(/\.\d+$/, ''), index);
      chains.push(chain);
    }
    // 负 x 那条腿的骨骼 → 正 x 那条腿上对应的那一根
    const mate = new Map<number, number>();
    for (const r of minus) {
      const l = plus.find((b) => marker[b] === marker[r] && legBase(b) === legBase(r));
      if (l !== undefined) mate.set(r, l);
    }
    /** 第 t 份（从负 x 数）里跟着腿的权重改给哪根骨骼：它里面正 x 那条腿是第 t + 1 条，负 x 那条是第 t 条 */
    const remap = (t: number, bone: number) => {
      if (plusSet.has(bone)) return t + 1 === n - 1 ? bone : (chains[t + 1].get(bone) ?? bone);
      if (minusSet.has(bone)) return t === 0 ? bone : (chains[t].get(mate.get(bone) ?? -1) ?? bone);
      return bone;
    };
    for (const i of pelvis.chunks) tileChunk(chunks[i], n, remap);
    for (const b of pelvis.bones) {
      const [x, y, z] = rest[b];
      // 正中的骨骼（胯、脊柱）不动；别的跟着它那半边挪
      const dx = plusSet.has(b) ? D : minusSet.has(b) ? -D : Math.abs(x) < SEAM ? 0 : Math.sign(x) * D * band(y);
      if (dx) rest[b] = [x + dx, y, z];
    }
    renameLegs = true;
  };
  /**
   * 把一块网格照 tile 说的切开、复制成 n - 1 份排开。remap(t, bone)：第 t 份里的权重改给哪根骨骼。
   * 腰以上的、跟着手臂和头的面不动，只留一份。
   * 小块的配件不切开（切开的话一块会碎成好几片，或者只剩半块；见 TILE_KEEP）：整块留着，
   * 在中段里的胯以上的配件留一份在原处（正中的蝴蝶结还在正中），别的整块跟着它所在的那几份挪
   */
  const tileChunk = (chunk: Chunk, n: number, remap: (t: number, bone: number) => number) => {
    const count = chunk.positions.length / 3;
    const off = share(chunk, offTorso);
    const piece = islandsOf(chunk);
    /** 每个点：中段的半宽 c、c 随高度变多快、两份在接缝处各往外多留多少 */
    const c = new Float64Array(count);
    const dc = new Float64Array(count);
    const lap = new Float64Array(count);
    for (let v = 0; v < count; v++) {
      const y = chunk.positions[v * 3 + 1];
      const keep = 1 - Math.min(1, off[v]);
      c[v] = hipX * band(y) * keep;
      dc[v] = hipX * bandRate(y) * keep;
      lap[v] = (TILE_OVERLAP * c[v]) / hipX;
    }
    const x = (v: number) => chunk.positions[v * 3];
    /** 第 t 份往 x 挪 c 的几倍 */
    const shift = (t: number) => 2 * t - (n - 2);
    /** 切面：side = 1 是这一份正 x 那边的（离中线 c 以内的留下），-1 是负 x 那边的；>= 0 的留下 */
    const inside = (side: number, v: number) => c[v] + lap[v] - side * x(v);
    /** 多边形的一个点：在原来的边 a → b 上、从 a 走了 s；原来的点 a === b。cut：它是哪个切面切出来的（0：不是切出来的） */
    interface Point {
      a: number;
      b: number;
      s: number;
      cut: number;
    }
    const value = (side: number, p: Point) => (p.a === p.b ? inside(side, p.a) : (1 - p.s) * inside(side, p.a) + p.s * inside(side, p.b));
    /** 切面和线段 p → q 的交点：线段总在原来的一条边上 */
    const cross = (side: number, p: Point, q: Point): Point => {
      const ids = [...new Set([p.a, p.b, q.a, q.b])];
      const [a, b] = ids[0] < ids[1] ? [ids[0], ids[1]] : [ids[1], ids[0]];
      const ga = inside(side, a);
      const gb = inside(side, b);
      return { a, b, s: ga / (ga - gb), cut: side };
    };
    const clip = (poly: Point[], side: number) => {
      const kept: Point[] = [];
      for (let k = 0; k < poly.length; k++) {
        const p = poly[k];
        const q = poly[(k + 1) % poly.length];
        const gp = value(side, p);
        const gq = value(side, q);
        if (gp >= 0) kept.push(p);
        if (gp >= 0 !== gq >= 0) kept.push(cross(side, p, q));
      }
      return kept;
    };
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const joints: number[] = [];
    const weights: number[] = [];
    const face: number[] = [];
    const indices: number[] = [];
    const made = new Map<string, number>();
    /** 第 t 份里的这个点（t = -1：不动的那一份），新的下标。rigid：整块挪的配件，照这个 c 挪 */
    const vertex = (t: number, p: Point, rigid?: number): number => {
      const key = p.a === p.b ? `${t}|${p.a}` : `${t}|${p.cut}|${p.a}|${p.b}`;
      const known = made.get(key);
      if (known !== undefined) return known;
      const id = positions.length / 3;
      made.set(key, id);
      const s = p.a === p.b ? 0 : p.s;
      const mix = (array: ArrayLike<number>, size: number, k: number) => (1 - s) * array[p.a * size + k] + s * array[p.b * size + k];
      const k = t < 0 ? 0 : shift(t);
      const cv = rigid ?? (1 - s) * c[p.a] + s * c[p.b];
      const dcv = rigid === undefined ? (1 - s) * dc[p.a] + s * dc[p.b] : 0;
      positions.push(mix(chunk.positions, 3, 0) + k * cv, mix(chunk.positions, 3, 1), mix(chunk.positions, 3, 2));
      const m: V3 = [mix(chunk.normals, 3, 0), mix(chunk.normals, 3, 1), mix(chunk.normals, 3, 2)];
      if (t >= 0 && rigid === undefined) {
        // 接缝两边是左右对称的两片，法线的 x 一正一负，明暗在那里断开：离接缝 TILE_ROUND 倍 c 以内，法线的 x 渐渐收到 0
        const xv = mix(chunk.positions, 3, 0);
        const gap = Math.min(t < n - 2 ? Math.abs(xv - cv) : Infinity, t > 0 ? Math.abs(xv + cv) : Infinity);
        if (gap < TILE_ROUND * cv) m[0] *= gap / (TILE_ROUND * cv);
      }
      // 斜着挪（x 随高度变）：法线的 y 跟着补
      m[1] -= k * dcv * m[0];
      const l = Math.hypot(m[0], m[1], m[2]) || 1;
      normals.push(m[0] / l, m[1] / l, m[2] / l);
      uvs.push(mix(chunk.uvs, 2, 0), mix(chunk.uvs, 2, 1));
      // 权重：两头的合在一起，同一根骨骼加在一起，留最重的四根
      const slots = new Map<number, number>();
      for (const [v, f] of [
        [p.a, 1 - s],
        [p.b, s],
      ] as const) {
        if (!f) continue;
        for (let j = 0; j < 4; j++) {
          const w = chunk.weights[v * 4 + j];
          if (!w) continue;
          const bone = t < 0 ? chunk.joints[v * 4 + j] : remap(t, chunk.joints[v * 4 + j]);
          slots.set(bone, (slots.get(bone) ?? 0) + w * f);
        }
      }
      const top = [...slots].sort((u, w) => w[1] - u[1]).slice(0, 4);
      const sum = top.reduce((total, [, w]) => total + w, 0) || 1;
      for (let j = 0; j < 4; j++) {
        joints.push(top[j]?.[0] ?? 0);
        weights.push(top[j] ? top[j][1] / sum : 0);
      }
      if (chunk.faceVertex) face.push(chunk.faceVertex[s < 0.5 ? p.a : p.b]);
      return id;
    };
    const emit = (t: number, poly: Point[], rigid?: number) => {
      if (poly.length < 3) return;
      const ids = poly.map((p) => vertex(t, p, rigid));
      for (let k = 1; k + 1 < ids.length; k++) indices.push(ids[0], ids[k], ids[k + 1]);
    };
    // 整块留着的小块：留在原处（null），或者整块放进哪几份、照哪个 c 挪
    const whole = new Map<number, { tiles: number[]; c: number } | null>();
    const moving = piece.boxes.filter((box) => box.vertices.some((v) => c[v]));
    /** 另一边有没有和它左右对称的一片（照包着它的盒子比，差不到半厘米；正中左右对称的一片算它自己） */
    const mirrored = (a: Box) =>
      moving.some((b) => {
        const lo: V3 = [-a.hi[0], a.lo[1], a.lo[2]];
        const hi: V3 = [-a.lo[0], a.hi[1], a.hi[2]];
        return [0, 1, 2].every((k) => Math.abs(b.lo[k] - lo[k]) < 0.005 && Math.abs(b.hi[k] - hi[k]) < 0.005);
      });
    for (const box of moving) {
      const wide = box.hi[0] - box.lo[0];
      const trim = box.lo[1] > hipLevel && wide < TILE_KEEP.trim;
      if (!trim && !(wide < TILE_KEEP.odd && !mirrored(box))) continue;
      const [cx, cy] = box.center;
      const cc = hipX * band(cy);
      const tiles = Array.from({ length: n - 1 }, (_, t) => t).filter((t) => (t === 0 || cx > -cc) && (t === n - 2 || cx < cc));
      whole.set(box.id, (trim && Math.abs(cx) < cc) || !tiles.length ? null : { tiles, c: cc });
    }
    let changed = false;
    for (let f = 0; f < chunk.indices.length; f += 3) {
      const tri = [chunk.indices[f], chunk.indices[f + 1], chunk.indices[f + 2]];
      const poly = tri.map((v): Point => ({ a: v, b: v, s: 0, cut: 0 }));
      const kept = whole.get(piece.of[tri[0]]);
      if (tri.every((v) => !c[v]) || kept === null) {
        emit(-1, poly);
        continue;
      }
      changed = true;
      if (kept) {
        for (const t of kept.tiles) emit(t, poly, kept.c);
        continue;
      }
      for (let t = 0; t < n - 1; t++) {
        let kept = poly;
        // 最负 x 那一份没有负 x 那边的切面，最正 x 那一份没有正 x 那边的
        if (t > 0) kept = clip(kept, -1);
        if (t < n - 2) kept = clip(kept, 1);
        emit(t, kept);
      }
    }
    if (!changed) return;
    chunk.positions = Float32Array.from(positions);
    chunk.normals = Float32Array.from(normals);
    chunk.uvs = Float32Array.from(uvs);
    chunk.joints = Uint16Array.from(joints);
    chunk.weights = Float32Array.from(weights);
    chunk.indices = Uint32Array.from(indices);
    if (chunk.faceVertex) chunk.faceVertex = Int32Array.from(face);
  };
  /** 网格里连在一起的一片 */
  interface Box {
    id: number;
    lo: V3;
    hi: V3;
    /** 点的平均位置 */
    center: V3;
    vertices: number[];
  }
  /** 网格分成连在一起的一片一片（位置一样的点算连着的：贴图接缝处的点是拆开的）。of：每个点在第几片 */
  const islandsOf = (chunk: Chunk) => {
    const count = chunk.positions.length / 3;
    const root = Int32Array.from({ length: count }, (_, i) => i);
    const find = (v: number) => {
      while (root[v] !== v) v = root[v] = root[root[v]];
      return v;
    };
    const join = (a: number, b: number) => {
      const [ra, rb] = [find(a), find(b)];
      if (ra !== rb) root[ra] = rb;
    };
    const same = new Map<string, number>();
    for (let v = 0; v < count; v++) {
      const key = [0, 1, 2].map((k) => Math.round(chunk.positions[v * 3 + k] * 1e4)).join(',');
      const was = same.get(key);
      if (was === undefined) same.set(key, v);
      else join(v, was);
    }
    for (let t = 0; t < chunk.indices.length; t += 3) {
      join(chunk.indices[t], chunk.indices[t + 1]);
      join(chunk.indices[t], chunk.indices[t + 2]);
    }
    const of = new Int32Array(count);
    const boxes = new Map<number, Box>();
    for (let v = 0; v < count; v++) {
      const id = (of[v] = find(v));
      let box = boxes.get(id);
      if (!box) boxes.set(id, (box = { id, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], center: [0, 0, 0], vertices: [] }));
      box.vertices.push(v);
      for (let k = 0; k < 3; k++) {
        const p = chunk.positions[v * 3 + k];
        box.lo[k] = Math.min(box.lo[k], p);
        box.hi[k] = Math.max(box.hi[k], p);
        box.center[k] += p;
      }
    }
    for (const box of boxes.values()) for (let k = 0; k < 3; k++) box.center[k] /= box.vertices.length;
    return { of, boxes: [...boxes.values()] };
  };
  /** 几副胯各摆上该有的腿：一条的把它的两条腿并成一条；三条以上的照原样复制胯中间那一段排开（见 tile） */
  const arrange = (pelves: Pelvis[]) => {
    pelves.forEach((pelvis, k) => {
      if (stations[k] >= 3) tile(pelvis, stations[k]);
      if (stations[k] === 1) fold(pelvis.left, pelvis.right, 0);
    });
  };

  /* ---- 单足：她的两条腿并成一条 ---- */
  if (form === 'biped' && !humantaur && !row && !tandem && !gather && !abreast) arrange([ownPelvis()]);

  /* ---- 人腿人马（humantaur）：把她自己的腰、胯和腿（连裙子、鞋）复制一份接在身后 ---- */
  // 复制出来的那一份像一个人弯腰九十度：胯和腿原样立着，腰从 Spine 关节往前折平，切口并进前面那副胯的后腰里。
  // 每多一对腿，往后再接一份
  /** 最后一副胯的骨骼，它在本来的胯后面多远（尾巴长在那里） */
  let rearHips = hips;
  let rearBack = 0;
  if (humantaur) {
    const spine = need('Spine');
    const chest = need('Chest');
    const above = new Set(subtree(upperChest));
    // 切在胸底下：再往上是胸和手臂
    const cut = bustY + extra - HUMANTAUR_CUT;
    const span = HUMANTAUR_SPAN * (hipJoint[1] - sole);
    // 腰折平以后，从折的地方到切口有 reach 那么长；要够着前面那副胯（并进去一点），差多少就把腰拉长多少
    const reach = cut - rest[spine][1];
    // 折平的腰比胯高一点，是从后腰那个高度并进去的：照那里的后背往里算
    const seam = backAt(0, rest[spine][1] + 0.04) + HUMANTAUR_BURY;
    const stretch = Math.max(0, span + seam - rest[spine][2] - reach);
    const from = rest[spine][1] + 0.02;
    const to = cut - 0.01;
    const longer = (y: number) => y + stretch * smooth((y - from) / (to - from));
    const pelves: Pelvis[] = [ownPelvis()];
    for (let k = 1; k < legPairs; k++) {
      const start = chunks.length;
      const map = clone(
        [hips],
        `Lower_${pad(k + 1)}`,
        (p) => [p[0], longer(p[1]), p[2] - k * span],
        (n) => n,
        // 切口附近有些点还带着一点胸以上的权重：都归到这一份自己的 Chest 上，跟着一起折过去
        (made) => made.get(chest)!,
        0.5,
        // 只算角色本来的骨骼：前面复制出来的那几份也挂在 Hips 下面，不能再复制一遍
        { bones: { index: k, rootParent: rearHips }, only: (b) => b < source.bones.length && !above.has(b), within: (_x, y) => y < cut },
      );
      pose.set(map.get(spine)!, { rotation: quatEuler(Math.PI / 2, 0, 0) });
      rearHips = map.get(hips)!;
      rearBack = k * span;
      pelves.push({
        hips: rearHips,
        left: map.get(need('UpperLeg_L'))!,
        right: map.get(need('UpperLeg_R'))!,
        chunks: Array.from({ length: chunks.length - start }, (_, i) => start + i),
        bones: [...new Set(map.values())],
      });
    }
    // 每副胯上不是一对腿的：并腿，或者排开
    arrange(pelves);
  }

  /* ---- 人腿左右并排：她自己的胯中间那一段照原样复制几份排开，腿挪到最外边，中间的腿是拼出来的 ---- */
  // 和人腿人马每副胯三条以上一样的做法（见 tile）：只有一副胯，所有的腿都照直
  if (row) tile(ownPelvis(), legs.total);

  /* ---- 人腿前后串联：把她自己的胯和腿（连裙子、鞋）复制几份，一副紧挨着一副排在身后 ---- */
  // 和人腿人马不一样的地方：没有横着的那截腰，后面的胯紧贴在前一副的后面。同人画里紧凑的那种人腿人马就是这样：
  // 后背从腰往后斜下去，接着第二副胯。做法和左右并排一样，只是换了方向：每一份从腰往下往后斜出去，
  // 到胯的关节斜完，再往下整个平移；腰那一圈和她自己的身体是重合的。
  // 后面每副胯各有一根骨骼（LowerBody_01、LowerBody_02 …，和白模人台一样的名字），它那一对腿和尾巴接在上面
  // 胯部聚拢也是这么拼的，只是几副胯贴得更紧（见 GATHER_SPAN），拼好以后腿往外散开
  /** 后面那几根骨骼的终点（那副胯的正中）：等后面记终点的地方准备好了再登记 */
  const chained: [bone: number, tail: V3][] = [];
  if (tandem || gather) {
    const spine = need('Spine');
    const chest = need('Chest');
    const above = new Set(subtree(upperChest));
    const lowerSet = new Set(subtree(hips).filter((b) => b < source.bones.length && !above.has(b)));
    const top = rest[chest][1] + ROW_TOP;
    const bottom = rest[hips][1] - ROW_BOTTOM;
    const sway = (y: number) => smooth((top - y) / (top - bottom));
    const swayRate = (y: number) => {
      const t = (top - y) / (top - bottom);
      return t <= 0 || t >= 1 ? 0 : (-6 * t * (1 - t)) / (top - bottom);
    };
    const span = (gather ? GATHER_SPAN : TANDEM_SPAN) * (hipJoint[1] - sole);
    const center: V3 = [rest[hips][0], rest[hips][1], rest[hips][2]];
    const pelves: Pelvis[] = [ownPelvis()];
    for (let k = 1; k < legPairs; k++) {
      const back = k * span;
      const start = chunks.length;
      const map = clone(
        [hips],
        `Lower_${pad(k + 1)}`,
        (p, _skin, on) => [p[0], p[1], p[2] - back * sway(p[1]) * on],
        // 斜过去以后表面朝哪：z 随高度变，法线的 y 跟着补回来
        (m, p) => {
          const y = m[1] + back * swayRate(p[1]) * m[2];
          const l = Math.hypot(m[0], y, m[2]) || 1;
          return [m[0] / l, y / l, m[2] / l];
        },
        hips,
        0.5,
        {
          // 脊柱那两节大家共用；胯的那根骨骼每份各有一根（下面改名、挪位置）
          bones: { index: k, rootParent: rearHips, shared: (b) => b === spine || b === chest },
          only: (b) => lowerSet.has(b),
          within: (_x, y) => y < top + 0.02,
        },
      );
      const made = map.get(hips)!;
      names[made] = `LowerBody_${pad(k)}`;
      // 从前一副胯的正中伸到这一副胯的正中
      rest[made] = [center[0], center[1], center[2] - (k - 1) * span];
      chained.push([made, [center[0], center[1], center[2] - back]]);
      rearHips = made;
      pelves.push({
        hips: made,
        left: map.get(need('UpperLeg_L'))!,
        right: map.get(need('UpperLeg_R'))!,
        chunks: Array.from({ length: chunks.length - start }, (_, i) => start + i),
        bones: [...new Set(map.values())],
      });
    }
    rearBack = (legPairs - 1) * span * sway(rest[hips][1] + 0.02);
    // 单数条：最后那副胯上只有一条
    arrange(pelves);
    // 胯部聚拢：第 k 副胯的两条腿往两边散开，前面那一对照原样站着。
    // 单数时最后那副胯上是正中一条（不动），前面几对都多散开半步，正面看左右对称
    if (gather) {
      const odd = stations[stations.length - 1] === 1;
      const depth = hipLevel - rest[need('Foot_L')][1];
      pelves.forEach((pelvis, k) => {
        const out = gatherOut(k, GATHER_SPREAD * hipX, depth, odd);
        for (const root of [pelvis.left, pelvis.right]) {
          const x = rest[root][0];
          if (Math.abs(x) > 1e-3 && out) lean(root, Math.sign(x) * out);
        }
      });
    }
  }

  /* ---- 人腿横排多胯：她自己的胯和腿（连裙子、鞋）复制几份，左右排成一排 ---- */
  // 做法和前后串联一样，只是换成往两边挪：每一份从腰往下渐渐挪开，到髋关节那么高挪足，再往下整个平移；腰那一圈还是她自己的。
  // 几副胯左右对称地排：单数副时她自己那副在正中，双数副时她自己那副也挪到一边。
  // 后面每副胯各有一根骨骼（LowerBody_01 …），那一对腿接在上面；每副胯的两条腿是这副胯自己的左右
  if (abreast) {
    const spine = need('Spine');
    const chest = need('Chest');
    const above = new Set(subtree(upperChest));
    const lowerSet = new Set(subtree(hips).filter((b) => b < source.bones.length && !above.has(b)));
    const count = stations.length;
    const step = ABREAST_STEP * 2 * hipX;
    const xs = Array.from({ length: count }, (_, k) => (k - (count - 1) / 2) * step);
    /** 她自己那副排在第几：正中，双数时左边（+X）那一副 */
    const own = Math.floor(count / 2);
    // 往两边挪了以后表面朝哪：x 随高度变，法线的 y 跟着补回来
    const turned = (dx: number) => (m: V3, p: V3): V3 => {
      const y = m[1] - dx * bandRate(p[1]) * m[0];
      const l = Math.hypot(m[0], y, m[2]) || 1;
      return [m[0] / l, y / l, m[2] / l];
    };
    const pelves: Pelvis[] = [];
    let made = 0;
    xs.forEach((dx, k) => {
      if (k === own) return;
      const start = chunks.length;
      made++;
      const map = clone(
        [hips],
        `Lower_${pad(made + 1)}`,
        (p, _skin, on) => [p[0] + dx * band(p[1]) * on, p[1], p[2]],
        turned(dx),
        hips,
        0.5,
        {
          bones: { index: made, rootParent: hips, shared: (b) => b === spine || b === chest },
          only: (b) => lowerSet.has(b),
          within: (_x, y) => y < waistLevel + 0.02,
        },
      );
      const root = map.get(hips)!;
      names[root] = `LowerBody_${pad(made)}`;
      rest[root] = [rest[hips][0] + dx, rest[hips][1], rest[hips][2]];
      chained.push([root, [rest[hips][0] + dx, rest[hips][1] - 0.05, rest[hips][2]]]);
      pelves[k] = {
        hips: root,
        left: map.get(need('UpperLeg_L'))!,
        right: map.get(need('UpperLeg_R'))!,
        chunks: Array.from({ length: chunks.length - start }, (_, i) => start + i),
        bones: [...new Set(map.values())],
      };
    });
    // 她自己那副：双数副时也挪到一边（照上面一样从腰往下渐渐挪）
    const shift = xs[own];
    if (Math.abs(shift) > 1e-9) {
      for (let c = 0; c < original; c++) {
        const chunk = chunks[c];
        const weight = share(chunk, lowerSet);
        const turn = turned(shift);
        for (let v = 0; v < weight.length; v++) {
          if (!weight[v]) continue;
          const p: V3 = [chunk.positions[v * 3], chunk.positions[v * 3 + 1], chunk.positions[v * 3 + 2]];
          chunk.positions[v * 3] += shift * band(p[1]) * weight[v];
          if (chunk.normals) {
            const n = turn([chunk.normals[v * 3], chunk.normals[v * 3 + 1], chunk.normals[v * 3 + 2]], p);
            const w = weight[v];
            const m = [chunk.normals[v * 3] * (1 - w) + n[0] * w, chunk.normals[v * 3 + 1] * (1 - w) + n[1] * w, chunk.normals[v * 3 + 2] * (1 - w) + n[2] * w];
            const l = Math.hypot(m[0], m[1], m[2]) || 1;
            chunk.normals.set([m[0] / l, m[1] / l, m[2] / l], v * 3);
          }
        }
      }
      for (const b of lowerSet) if (b !== spine && b !== chest) rest[b] = [rest[b][0] + shift * band(rest[b][1]), rest[b][1], rest[b][2]];
    }
    pelves[own] = ownPelvis();
    arrange(pelves);
  }

  /* ---- 腿的骨骼照位置起名（有并成一条的、一副胯上不是一对的时候） ---- */
  // 和白模人台一样：每副胯从前往后，中线上的腿不分左右（UpperLeg、UpperLeg.002 …），
  // 成对的从中线往外、从前往后数（UpperLeg_L、UpperLeg_L.002 …）
  if (renameLegs) {
    const roots = names.flatMap((name, b) => (!marker[b] && /^UpperLeg(_[LR])?(\.\d+)?$/.test(name) ? [b] : []));
    const groups = new Map<number, number[]>();
    for (const b of roots) {
      const list = groups.get(parent[b]);
      if (list) list.push(b);
      else groups.set(parent[b], [b]);
    }
    const meanZ = (list: number[]) => list.reduce((sum, b) => sum + rest[b][2], 0) / list.length;
    const renamed: [number, string][] = [];
    const call = (root: number, name: (base: string) => string) => {
      for (const b of legTree(root)) if (!marker[b]) renamed.push([b, name(legBase(b))]);
    };
    let pairs = 0;
    let middles = 0;
    for (const list of [...groups.values()].sort((a, b) => meanZ(b) - meanZ(a))) {
      const middle = list.filter((b) => Math.abs(rest[b][0]) < 1e-3);
      const lefts = list.filter((b) => rest[b][0] >= 1e-3).sort((a, b) => rest[a][0] - rest[b][0]);
      const rights = list.filter((b) => rest[b][0] <= -1e-3).sort((a, b) => rest[b][0] - rest[a][0]);
      for (const b of middle) {
        const index = middles++;
        call(b, (base) => nthName(base, index));
      }
      for (let i = 0; i < Math.max(lefts.length, rights.length); i++) {
        const index = pairs++;
        if (lefts[i] !== undefined) call(lefts[i], (base) => nthName(`${base}_L`, index));
        if (rights[i] !== undefined) call(rights[i], (base) => nthName(`${base}_R`, index));
      }
    }
    for (const [b, name] of renamed) names[b] = name;
  }

  /* ---- 摆姿势，并把摆好的样子定成新的静止姿势 ---- */
  if (pose.size) {
    const matrices = skinMatrices({ parent, rest }, pose);
    for (const chunk of chunks) skinVerticesInPlace(chunk.positions, chunk.normals, chunk.joints, chunk.weights, matrices);
    const moved = posedJoints({ parent, rest }, matrices);
    for (let b = 0; b < rest.length; b++) rest[b] = moved[b];
  }

  // 实际身高看的是头顶（所有头里最高的那个），不算蓬起来的头发，也不算后加的角和耳朵：趁它们还没加上先量好
  const headBones = new Set(heads.flatMap(subtree));
  let crownAt = -Infinity;
  for (const chunk of chunks) {
    if (isLooseHair(chunk)) continue;
    const onHead = share(chunk, headBones);
    for (let v = 0; v < onHead.length; v++) if (onHead[v] > 0.5 && chunk.positions[v * 3 + 1] > crownAt) crownAt = chunk.positions[v * 3 + 1];
  }

  /** 后加的骨骼自己带着终点（别的骨骼的终点是从子骨骼推出来的） */
  const ends = new Map<number, V3>();
  for (const [b, tail] of chained) ends.set(b, tail);

  /* ---- 兽身：缩放到角色的个头，座位对准她的胯，接到骨架上 ---- */
  if (beast) {
    // 兽身的第 0 根骨骼就是角色的胯，其余的照原样加进骨架
    const boneOf = beast.bones.map((b, i) => {
      if (i === 0) return hips;
      ends.set(names.length, onBeast(b.tail));
      names.push(b.name);
      origin.push(null);
      marker.push(false);
      parent.push(-1);
      rest.push(onBeast(b.head));
      return names.length - 1;
    });
    beast.bones.forEach((b, i) => {
      if (i) parent[boneOf[i]] = boneOf[b.parent];
    });
    const [sx, sy, sz] = beast.seat;
    const piece = (name: string, kind: FlatKind, from: BeastPiece | null) => {
      if (!from) return;
      // 位置和骨骼下标各算一份新的（后面还要缩放、重新编号）；法线、权重、面是记下来的那份，原样用，不改
      const positions = new Float32Array(from.positions.length);
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] = seatAt[0] + (from.positions[i] - sx) * beastScale;
        positions[i + 1] = seatAt[1] + (from.positions[i + 1] - sy) * beastScale;
        positions[i + 2] = seatAt[2] + (from.positions[i + 2] - sz) * beastScale;
      }
      const joints = new Uint16Array(from.joints.length);
      for (let k = 0; k < joints.length; k++) joints[k] = from.weights[k] ? boneOf[from.joints[k]] : 0;
      chunks.push({ name, material: flatIndex(kind), positions, normals: from.normals, uvs: from.uvs, joints, weights: from.weights, indices: from.indices });
    };
    piece(form === 'taur' ? 'Horse' : 'Spider', form === 'taur' ? 'coat' : 'chitin', beast.body);
    piece('Hooves', 'hoof', beast.hoof);
  }

  /* ---- 尾巴、翅膀、角、兽耳：现捏一份，接到对应的骨骼上 ---- */
  const wingY = (i: number) => shoulder[1] - 0.07 - i * 0.13;
  const extras = extraParts({
    spec,
    heads: headSpots,
    headSize: [crest.wide, (crest.top - chin) / 2, (crest.front - crest.back) / 2],
    // 有兽身的话尾巴长在兽身的后端；人腿人马长在最后那副胯上
    tailRoot: beast
      ? onBeast(beast.tailRoot)
      : [0, rest[hips][1] + 0.02, backAt(0, rest[hips][1] + 0.02) + 0.02 - rearBack],
    tailParent: beast ? beast.tailParent : names[rearHips],
    wingRoot: (i, side) => [side * 0.05, wingY(i), backAt(0.05, wingY(i)) + 0.015],
  });
  for (const part of extras) {
    const own: number[] = [];
    for (const b of part.bones) {
      const to = find(b.parent);
      own.push(names.length);
      ends.set(names.length, b.tail);
      names.push(b.name);
      origin.push(null);
      marker.push(false);
      parent.push(to >= 0 ? to : hips);
      rest.push(b.head);
    }
    const follow = own.length ? own : [find(part.attach) >= 0 ? find(part.attach) : hips];
    const count = part.positions.length / 3;
    const joints = new Uint16Array(count * 4);
    const weights = new Float32Array(count * 4);
    for (let v = 0; v < count; v++) {
      if (follow.length === 1) {
        joints[v * 4] = follow[0];
        weights[v * 4] = 1;
        continue;
      }
      // 离哪节骨骼近就跟着哪节，隔壁两节之间平滑过渡
      const px = part.positions[v * 3];
      const py = part.positions[v * 3 + 1];
      const pz = part.positions[v * 3 + 2];
      const near = follow.map((b) => {
        const a = rest[b];
        const e = ends.get(b)!;
        const ab: V3 = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
        const t = Math.max(0, Math.min(1, ((px - a[0]) * ab[0] + (py - a[1]) * ab[1] + (pz - a[2]) * ab[2]) / (ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1)));
        const d = Math.hypot(px - a[0] - ab[0] * t, py - a[1] - ab[1] * t, pz - a[2] - ab[2] * t);
        return { b, w: 1 / (d + 0.004) ** 4 };
      });
      near.sort((p, q) => q.w - p.w);
      const best = near.slice(0, 4).filter((n) => n.w > near[0].w * 0.02);
      const sum = best.reduce((s, n) => s + n.w, 0);
      best.forEach((n, k) => {
        joints[v * 4 + k] = n.b;
        weights[v * 4 + k] = n.w / sum;
      });
    }
    // 兽耳跟着它长在的那个头的发色（分开染的头见 headDyes）
    const onHead = part.kind === 'ear' ? /^Head_(\d+)_/.exec(part.name) : null;
    chunks.push({
      name: part.name,
      material: (onHead && headDyes.get(Number(onHead[1]) - 1)?.get(flatIndex('ear'))) ?? flatIndex(part.kind),
      positions: part.positions,
      normals: part.normals,
      uvs: new Float32Array(count * 2),
      joints,
      weights,
      indices: part.indices,
    });
  }

  /* ---- 好几个上半身：腰以上（连头、头发、手臂、胸、衣服、后加的兽耳和翅膀）复制几份，各自从腰那里往两边歪开 ---- */
  // 排法、名字和两种白模一样（见 geometry/torsos.ts）：头从右往左一个上半身一个上半身地数，脊柱带上它在哪一边，
  // 手臂、翅膀分外侧（照原名，左右两个互为镜像）和里侧（排在后面几对）；里侧的手臂往前伸。
  // 歪开是摆姿势摆出来的（第二次烘焙）：腰那一圈一半跟着胯、一半跟着脊柱的点自然地弯过去，不用切开再接
  if (c.torsos > 1) {
    const slots = torsoSlots(c.torsos);
    const three = slots.length === 3;
    /** 她自己的上半身在哪一边：两个时在左边，三个时在正中 */
    const ownSlot = slots[0];
    const spine = need('Spine');
    const pivot = rest[spine];
    const was = names.slice();
    const stem = (name: string) => name.replace(/\.\d+$/, '');
    const nth = (name: string) => {
      const m = /\.(\d+)$/.exec(name);
      return m ? Number(m[1]) - 1 : 0;
    };
    const kidsOf = (b: number) => parent.flatMap((p, k) => (p === b ? [k] : []));

    /* 上半身上的骨骼各属于哪一样：脊柱、第几个头（连脖子、头发、耳朵）、哪一对手臂 / 翅膀，别的（胸、衣服的辅助骨骼） */
    type Kind = { type: 'spine' } | { type: 'head'; index: number } | { type: 'arm' | 'wing'; pair: number; side: 1 | -1 } | { type: 'other' };
    const kind = new Map<number, Kind>();
    const body = subtree(spine);
    for (const b of body) kind.set(b, /^(Spine|Chest|UpperChest)(\.\d+)?$/.test(was[b]) ? { type: 'spine' } : { type: 'other' });
    heads.forEach((h, i) => {
      const neckBone = parent[h] >= 0 && /^Neck(\.\d+)?$/.test(was[parent[h]]) ? parent[h] : h;
      for (const b of subtree(neckBone)) kind.set(b, { type: 'head', index: headSpots[i].index });
    });
    for (const b of body) {
      const arm = /^Shoulder_([LR])(?:\.(\d+))?$/.exec(was[b]);
      const wing = /^Wing_(\d+)_([LR])$/.exec(was[b]);
      if (arm) for (const k of subtree(b)) kind.set(k, { type: 'arm', pair: arm[2] ? Number(arm[2]) - 1 : 0, side: arm[1] === 'L' ? 1 : -1 });
      if (wing) for (const k of subtree(b)) kind.set(k, { type: 'wing', pair: Number(wing[1]) - 1, side: wing[2] === 'L' ? 1 : -1 });
    }
    /** 一个上半身有几个头（一个头几张脸时就一个） */
    const perHeads = faces ? 1 : c.heads;
    const order: number[] = [...slots].sort((a, b) => a - b);
    /** 第 slot 个上半身上，这一边挨着别的上半身吗 */
    const inner = (slot: number, side: number) => (slot === 0 ? three : side === -slot);
    /** 原来的骨骼 b 在 slot 那个上半身上叫什么 */
    const nameIn = (slot: number, b: number): string => {
      const tag = slot > 0 ? '_L' : slot < 0 ? '_R' : '';
      const k = kind.get(b)!;
      const name = was[b];
      if (k.type === 'spine') return nthName(`${stem(name)}${tag}`, nth(name));
      if (k.type === 'head') return nthName(stem(name), k.index + order.indexOf(slot) * perHeads);
      if (k.type === 'arm' || k.type === 'wing') {
        const per = k.type === 'arm' ? armPairs : c.wingPairs;
        const pair = slot === 0 ? k.pair : k.pair + (inner(slot, k.side) ? (three ? 2 : 1) : three ? 1 : 0) * per;
        return k.type === 'wing' ? `Wing_${pad(pair + 1)}_${k.side > 0 ? 'L' : 'R'}` : nthName(stem(name), pair);
      }
      // 别的：左边、右边那个上半身上的，名字里带上是哪一边的（放在左右前面）：Bust1_L → Bust1_R_L
      if (!tag) return name;
      const [, base, side = ''] = /^(.*?)(_[LR])?$/.exec(stem(name))!;
      return nthName(`${base}${tag}${side}`, nth(name));
    };

    /* 复制 */
    original = chunks.length;
    /** 复制出来的那几片在哪个上半身上 */
    const copiedTo = new Map<Chunk, number>();
    /** 每个上半身的骨骼：原来的骨骼 → 这个上半身上的那一根 */
    const boneIn = new Map<number, Map<number, number>>();
    boneIn.set(ownSlot, new Map(body.map((b) => [b, b])));
    for (const slot of slots) {
      if (slot === ownSlot) continue;
      const from = chunks.length;
      const map = clone([spine], `Torso${slot > 0 ? '_L' : slot < 0 ? '_R' : ''}`, (p) => p, (n) => n, hips, TORSO_SPLIT, {
        bones: { index: 1, rootParent: hips },
      });
      for (let n = from; n < chunks.length; n++) copiedTo.set(chunks[n], slot);
      for (const [b, made] of map) {
        names[made] = nameIn(slot, b);
        // 后加的骨骼（兽耳、翅膀）自己带着终点
        const tail = ends.get(b);
        if (tail) ends.set(made, [tail[0], tail[1], tail[2]]);
      }
      boneIn.set(slot, map);
    }
    for (const b of body) names[b] = nameIn(ownSlot, b);
    // 里侧的翅膀（挨着旁边那个上半身的那一边）和旁边那一对交叉在一起：不要了（两种白模也是这样，见 torsos.ts 的 crowded）
    const innerWings = new Set<number>();
    for (const [slot, map] of boneIn) {
      for (const b of body) {
        const k = kind.get(b)!;
        if (k.type === 'wing' && inner(slot, k.side)) innerWings.add(map.get(b)!);
      }
    }
    if (innerWings.size) {
      const onWing = (chunk: Chunk) => chunk.joints.every((j, i) => !chunk.weights[i] || innerWings.has(j));
      for (let n = chunks.length - 1; n >= 0; n--) if (onWing(chunks[n])) chunks.splice(n, 1);
      for (const b of innerWings) marker[b] = true;
    }
    const slotOf = (chunk: Chunk) => copiedTo.get(chunk) ?? ownSlot;
    const sourceOf = (chunk: Chunk) => (copiedTo.has(chunk) ? cloned.get(chunk)! : chunk);
    /** 这一片长在它那个上半身的第几个头上（不在头上的算第一个：染发只改头发、头皮、兽耳那几种材质） */
    const localHead = (chunk: Chunk) => {
      const from = sourceOf(chunk);
      const m = /^Head_(\d+)_/.exec(from.name) ?? /_Head_(\d+)$/.exec(from.name);
      return m ? Number(m[1]) - 1 : 0;
    };
    const globalHead = (chunk: Chunk) => order.indexOf(slotOf(chunk)) * perHeads + localHead(chunk);

    /* 每个头的发色照全身的第几个头重新挑（分开染的见 HairSpec.heads） */
    const dyeKeys = new Set([...dyeing('#808080').keys(), flatIndex('ear')]);
    const madeFor = new Map<string, number>();
    for (const chunk of chunks) {
      const base = dyedFrom.get(chunk.material) ?? chunk.material;
      if (!dyeKeys.has(base)) continue;
      const g = globalHead(chunk);
      const color = headColor(g);
      if (color === headColor(0)) {
        chunk.material = base;
        continue;
      }
      const key = `${color}|${base}`;
      let at = madeFor.get(key);
      if (at === undefined) {
        const made = base === flatIndex('ear') ? headEar(source, color, coiffure) : (dyeing(color).get(base) ?? undyed[base]);
        at = materials.length + sided.push(renamed(made, `_Head_${pad(g + 1)}`)) - 1;
        madeFor.set(key, at);
      }
      chunk.material = at;
    }

    /* 表情：每张脸照全身的第几个头重新记 */
    const labelWas = new Map(copyOf);
    for (const chunk of chunks) {
      if (!chunk.faceVertex) continue;
      const label = labelWas.get(sourceOf(chunk)) ?? '';
      const m = /^(Head|Face)_(\d+)$/.exec(label);
      const local = m?.[1] === 'Head' ? Number(m[2]) - 1 : 0;
      const face = m?.[1] === 'Face' ? Number(m[2]) : 0;
      const g = order.indexOf(slotOf(chunk)) * perHeads + local;
      const head = g ? `Head_${pad(g + 1)}` : '';
      const made = face ? `${head}${head ? '/' : ''}Face_${pad(face)}` : head;
      if (made) copyOf.set(chunk, made);
      else copyOf.delete(chunk);
    }

    /* 歪开：每个上半身的脊柱绕腰转开，往外挪一点；里侧的手臂往前伸 */
    const reach: { wide: number; rise: number }[] = [];
    for (const b of body) {
      const k = kind.get(b)!;
      if (k.type === 'arm' && /^UpperArm_/.test(was[b])) reach.push({ wide: Math.abs(rest[b][0]), rise: rest[b][1] - pivot[1] });
      if (k.type === 'head' && /^Head(\.\d+)?$/.test(was[b])) reach.push({ wide: Math.abs(rest[b][0]) + crest.wide * hs, rise: rest[b][1] - pivot[1] });
    }
    const outward = (three ? 2 : 1) * TORSO_SHIFT;
    const lean = torsoLean(reach, three, outward);
    const second = new Map<number, BonePose>();
    for (const slot of slots) {
      const map = boneIn.get(slot)!;
      const q = quatMul(quatEuler(0, three ? slot * FAN_YAW : 0, 0), quatEuler(0, 0, -slot * lean));
      second.set(map.get(spine)!, { rotation: q, move: [slot * outward, 0, three && slot ? -0.02 : 0] });
      // 里侧的手臂：同一个肩膀上的几条（肩部聚拢的）肩关节靠前的放低，往后一条比一条抬高
      const uppers = body.filter((b) => {
        const k = kind.get(b)!;
        return k.type === 'arm' && inner(slot, k.side) && /^UpperArm_/.test(was[b]);
      });
      const done = new Set<number>();
      for (const first of uppers) {
        if (done.has(first)) continue;
        const group = uppers.filter((b) => !done.has(b) && len([rest[b][0] - rest[first][0], rest[b][1] - rest[first][1], rest[b][2] - rest[first][2]]) < INNER_SHOULDER);
        group.sort((a, b) => rest[b][2] - rest[a][2]);
        group.forEach((b, i) => {
          done.add(b);
          const lower = kidsOf(b).find((k) => /^LowerArm_/.test(was[k]));
          if (lower === undefined) return;
          const along = norm([rest[lower][0] - rest[b][0], rest[lower][1] - rest[b][1], rest[lower][2] - rest[b][2]]);
          const drop = INNER_ARM_DROP + i * INNER_FAN_STEP;
          const want = rotate(quatConj(q), [0, -Math.cos(drop), Math.sin(drop)]);
          second.set(map.get(b)!, { rotation: quatBetween(along, want) });
        });
      }
    }
    const matrices = skinMatrices({ parent, rest }, second);
    for (const chunk of chunks) skinVerticesInPlace(chunk.positions, chunk.normals, chunk.joints, chunk.weights, matrices);
    const moved = posedJoints({ parent, rest }, matrices);
    for (let b = 0; b < rest.length; b++) rest[b] = moved[b];
    // 后加的骨骼自己带着的终点也跟着搬
    for (const [b, tail] of ends) {
      const o = b * 12;
      ends.set(b, [0, 1, 2].map((r) => matrices[o + r * 3] * tail[0] + matrices[o + r * 3 + 1] * tail[1] + matrices[o + r * 3 + 2] * tail[2] + matrices[o + 9 + r]) as V3);
    }
    // 头顶低了一点：身高重新量（所有上半身上的头）
    const allHeads = new Set(names.flatMap((name, b) => (/^Head(\.\d+)?$/.test(name) ? subtree(b) : [])));
    crownAt = -Infinity;
    for (const chunk of chunks) {
      if (isLooseHair(sourceOf(chunk))) continue;
      const onHead = share(chunk, allHeads);
      for (let v = 0; v < onHead.length; v++) if (onHead[v] > 0.5 && chunk.positions[v * 3 + 1] > crownAt) crownAt = chunk.positions[v * 3 + 1];
    }
  }

  /* ---- 脚踩到地面上，整体缩放到设定的身高 ---- */
  let low = Infinity;
  for (const chunk of chunks) for (let i = 1; i < chunk.positions.length; i += 3) if (chunk.positions[i] < low) low = chunk.positions[i];
  const scale = sh.height / standard;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.positions.length; i += 3) {
      chunk.positions[i] *= scale;
      chunk.positions[i + 1] = (chunk.positions[i + 1] - low) * scale;
      chunk.positions[i + 2] *= scale;
    }
  }
  for (const p of [...rest, ...ends.values()]) {
    p[0] *= scale;
    p[1] = (p[1] - low) * scale;
    p[2] *= scale;
  }
  const crown = (crownAt - low) * scale;
  const finalHead = headHeight * hs * scale;

  /* ---- 整理骨架：去掉只用来标位置的骨骼，父骨骼排到子骨骼前面 ---- */
  const used = new Uint8Array(names.length);
  for (const chunk of chunks) for (let i = 0; i < chunk.joints.length; i++) if (chunk.weights[i]) used[chunk.joints[i]] = 1;
  const keep = names.map((_, b) => !marker[b] || Boolean(used[b]));
  /** 骨骼的终点：朝主要的那个子骨骼；没有子骨骼就用标位置的骨骼，再没有就顺着父骨骼的方向伸一小段 */
  const children: number[][] = names.map(() => []);
  parent.forEach((p, b) => {
    if (p >= 0) children[p].push(b);
  });
  const stem = (name: string) => name.replace(/\.\d+$/, '');
  const tailOf = (b: number): V3 => {
    const given = ends.get(b);
    if (given) return given;
    const kids = children[b];
    const [, base, side = ''] = /^(.*?)(_[LR])?$/.exec(stem(names[b]))!;
    const wanted = MAIN_CHILD[base] === undefined ? undefined : MAIN_CHILD[base] + side;
    const main = kids.find((k) => stem(names[k]) === wanted) ?? (kids.length === 1 ? kids[0] : kids.find((k) => marker[k]));
    if (main !== undefined) {
      const to = rest[main];
      if (Math.hypot(to[0] - rest[b][0], to[1] - rest[b][1], to[2] - rest[b][2]) > 1e-4) return [to[0], to[1], to[2]];
    }
    if (stem(names[b]) === 'Head') return [rest[b][0], rest[b][1] + finalHead * 0.75, rest[b][2]];
    const p = parent[b];
    const along: V3 = p >= 0 ? [rest[b][0] - rest[p][0], rest[b][1] - rest[p][1], rest[b][2] - rest[p][2]] : [0, 1, 0];
    const length = Math.hypot(along[0], along[1], along[2]) || 1;
    const reach = Math.max(0.02 * scale, Math.min(0.06 * scale, length * 0.5));
    return [rest[b][0] + (along[0] / length) * reach, rest[b][1] + (along[1] / length) * reach, rest[b][2] + (along[2] / length) * reach];
  };
  const order: number[] = [];
  const visit = (b: number) => {
    if (keep[b]) order.push(b);
    for (const k of children[b]) visit(k);
  };
  parent.forEach((p, b) => {
    if (p < 0) visit(b);
  });
  const newIndex = new Map(order.map((b, i) => [b, i]));
  /** 留下来的最近的祖先 */
  const keptParent = (b: number): number => {
    let p = parent[b];
    while (p >= 0 && !keep[p]) p = parent[p];
    return p >= 0 ? newIndex.get(p)! : -1;
  };
  const bones: CharacterBone[] = order.map((b) => ({ name: names[b], parent: keptParent(b), head: [rest[b][0], rest[b][1], rest[b][2]], tail: tailOf(b) }));
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.joints.length; i++) chunk.joints[i] = chunk.weights[i] ? newIndex.get(chunk.joints[i])! : 0;
  }
  const seen = new Set<string>();
  for (const bone of bones) {
    if (seen.has(bone.name)) throw new Error(t('骨骼重名：{name}', { name: bone.name }));
    seen.add(bone.name);
  }

  /* ---- 表情：自己的脸、复制出来的头上的脸、同一个头上多出来的脸，各是一张 ---- */
  const faceList: FaceInstance[] = [];
  if (source.face) {
    const groups = new Map<string, Chunk[]>();
    for (const chunk of chunks) {
      if (!chunk.faceVertex) continue;
      const label = copyOf.get(chunk) ?? '';
      const list = groups.get(label);
      if (list) list.push(chunk);
      else groups.set(label, [chunk]);
    }
    for (const [label, list] of groups) {
      // 这张脸现在的样子和原始的脸比：转了多少、放大了多少
      const fit = fitFrame(source.face.rest, list.map((chunk) => ({ positions: chunk.positions, vertex: chunk.faceVertex! })));
      if (!fit || faceList.length >= 255) {
        for (const chunk of list) delete chunk.faceVertex;
        continue;
      }
      // Head_02 是第 2 个头（复制出来的，骨骼也复制了一份）；Face_02 是同一个头上的第 2 张脸（整片跟着头，没有自己的眼睛骨骼）；
      // 好几个上半身时，别的上半身上那个头的第 2 张脸是 Head_03/Face_02
      const copy = /^(?:Head_(\d+))?\/?(?:Face_(\d+))?$/.exec(label);
      const suffix = copy?.[1] ? nthName('', Number(copy[1]) - 1) : '';
      const face = copy?.[2] ? Number(copy[2]) : 0;
      const eyes: [string, string] = [`Eye_L${suffix}`, `Eye_R${suffix}`];
      const instance: FaceInstance = {
        key: face ? `Head${suffix}/${face}` : `Head${suffix}`,
        bone: `Head${suffix}`,
        eyes: !face && eyes.every((name) => seen.has(name)) ? eyes : null,
        ...fit,
      };
      for (const chunk of list) chunk.faceOf = new Uint8Array(chunk.faceVertex!.length).fill(faceList.length);
      faceList.push(instance);
    }
  }

  return {
    bones,
    meshes: chunks,
    materials: [...materials, ...sided],
    images,
    metrics: { height: crown, headHeight: finalHead, headRatio: crown / finalHead, legForm: humantaur || row || tandem || gather || abreast ? legForm : form },
    ignored,
    faces: faceList,
    ...(source.face && faceList.length ? { morphs: source.face } : {}),
    origins: order.map((b) => origin[b]),
  };
}
