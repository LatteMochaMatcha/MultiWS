/**
 * 道具的接触面（见 docs/props-plan.md 的「一键动作」）：哪里能坐、哪里能躺、哪里是能撑手的台面。
 * 一键动作（scene/propActions.ts）照它找地方。纯数据。
 *
 * 只标「在哪一块、朝哪边」，都写成占宽、深的几成（道具自己的坐标：左右、前后各是 -0.5–0.5，原点在底面正中），
 * 所以道具拉宽、拉长了照样对得上。面有多高不标：用的时候从上往下照网格量（scene/follow.ts 的 topUnder）。
 * 基本体照种类自动认；现成的家具逐件标（照 tools 里量出来的顶面高度图标的：靠背都在后面，也就是 -Z 那一头）。
 * 手扶、背靠不用标：哪件道具都行，照网格找最近的面。
 * 用户自己导入的素材没人标：照它的分类和形状自己找（autoContacts.ts），找不出来就什么都没有。
 */
import type { SceneProp } from '../model/props';
import { autoContacts } from './autoContacts';
import { type PropAssetGroup, userAsset } from './catalog';
import { propTouchShape } from './library';

/** 一块长方形的地方：左右从哪到哪、前后从哪到哪（占宽、深的几成） */
export interface ContactRect {
  x: readonly [number, number];
  z: readonly [number, number];
}

export interface SitSpot {
  rect: ContactRect;
  face?: number;
  round?: boolean;
  under?: number;
  /** 没靠背的只能坐这几边（度，和 face 一个意思）：床头板、床尾板挡着的那两头不能坐。不写是四边都行 */
  sides?: readonly number[];
}

export interface PropContacts {
  /**
   * 能坐。face：有靠背的，坐下来脸朝哪（度，相对道具自己的朝向；0 是朝它的前面 +Z）。
   * 没有 face 是没靠背的：坐在离角色现在站的地方最近的那一边，脸朝外。round：圆的（凳子、台子、球），朝角色现在那一边。
   * under：从道具多高的地方往下量坐面（占高度的几成）；不写是从最上面量（上下铺的下铺要写）。
   * also：别的能坐的地方（野餐桌的另一条凳）；坐离角色现在站的地方最近的那一处
   */
  sit?: SitSpot & { also?: readonly SitSpot[] };
  /** 能躺。turn：躺下来以后角色的朝向（度，相对道具；0 是头朝道具的后面 -Z、脚朝前面） */
  lie?: { rect: ContactRect; turn: number; under?: number };
  /** 能撑手的台面。round：圆桌 */
  top?: { rect: ContactRect; round?: boolean };
}

const FULL: ContactRect = { x: [-0.5, 0.5], z: [-0.5, 0.5] };
/** 椅子那一类：靠背占后面两成多，坐面是前面那一块 */
const SEAT: ContactRect = { x: [-0.5, 0.5], z: [-0.28, 0.5] };
/** 带扶手的：坐面两边各让出一成 */
const SEAT_ARMS: ContactRect = { x: [-0.39, 0.39], z: [-0.28, 0.5] };
/** 床垫：床头板后面那一条不算 */
const MATTRESS: ContactRect = { x: [-0.5, 0.5], z: [-0.39, 0.5] };

const TABLE: PropContacts = { top: { rect: FULL }, sit: { rect: FULL } };

/** 现成的家具（编号见 tools/build-props.ts 的 PIECES）。没写的那几件（书架、楼梯、门框、枕头）只能扶、能靠 */
const ASSET_CONTACTS: Record<string, PropContacts> = {
  chair: { sit: { rect: SEAT, face: 0 } },
  chairCushion: { sit: { rect: SEAT, face: 0 } },
  chairRounded: { sit: { rect: SEAT, face: 0 } },
  chairDesk: { sit: { rect: SEAT_ARMS, face: 0 } },
  stoolBar: { sit: { rect: { x: [-0.33, 0.33], z: [-0.33, 0.33] }, round: true } },
  bench: { sit: { rect: SEAT, face: 0 } },
  loungeChair: { sit: { rect: { x: [-0.28, 0.28], z: [-0.28, 0.5] }, face: 0 } },
  // 双人沙发：坐着朝前；躺是顺着沙发躺，头朝它的右手边（-X）
  loungeSofa: { sit: { rect: SEAT_ARMS, face: 0 }, lie: { rect: SEAT_ARMS, turn: 90 } },
  // 贵妃沙发：坐在没有脚踏的那一半，躺在伸出来的那一半上
  loungeSofaLong: { sit: { rect: { x: [-0.39, -0.06], z: [-0.39, 0.05] }, face: 0 }, lie: { rect: { x: [-0.056, 0.389], z: [-0.39, 0.5] }, turn: 0 } },
  ottoman: { sit: { rect: FULL } },
  bedSingle: { lie: { rect: MATTRESS, turn: 0 }, sit: { rect: { x: [-0.5, 0.5], z: [-0.28, 0.5] } } },
  bedDouble: { lie: { rect: MATTRESS, turn: 0 }, sit: { rect: { x: [-0.5, 0.5], z: [-0.28, 0.5] } } },
  // 上下铺：躺下铺（从一半多一点的高度往下量）。坐在下铺头会顶到上铺，不标
  bedBunk: { lie: { rect: { x: [-0.28, 0.28], z: [-0.39, 0.5] }, turn: 0, under: 0.6 } },
  table: TABLE,
  tableRound: { top: { rect: FULL, round: true }, sit: { rect: FULL, round: true } },
  tableCoffee: TABLE,
  desk: TABLE,
  kitchenBar: TABLE,
  // 浴缸：躺在里面，头朝没有龙头的那一头
  bathtub: { lie: { rect: { x: [-0.39, 0.33], z: [-0.3, 0.3] }, turn: 90 } },
  toilet: { sit: { rect: SEAT_ARMS, face: 0 } },

  /* ---- 写实款（编号见 tools/build-props-real.ts 的 PIECES） ---- */
  armchairModern: { sit: { rect: { x: [-0.4, 0.4], z: [-0.15, 0.5] }, face: 0 } },
  schoolChair: { sit: { rect: { x: [-0.42, 0.42], z: [-0.17, 0.5] }, face: 0 } },
  schoolDesk: TABLE,
  // 皮面双人沙发：坐垫和靠背之间有一道缝，坐面从缝前面算起；躺是顺着沙发躺，头朝它的右手边（-X）
  sofaLeather: { sit: { rect: { x: [-0.42, 0.42], z: [-0.08, 0.5] }, face: 0 }, lie: { rect: { x: [-0.42, 0.42], z: [-0.08, 0.45] }, turn: 90 } },
  // 复古双人床：四根柱子、床头板、床尾板里面那一块是床垫；枕头堆得厚，躺下来只有头枕在枕头的前半截上
  bedGothic: { lie: { rect: { x: [-0.42, 0.42], z: [-0.36, 0.47] }, turn: 0 }, sit: { rect: { x: [-0.5, 0.5], z: [-0.2, 0.47] }, sides: [90, -90] } },
  // 铺桌布的餐桌：桌布垂下来的那一圈不算台面
  tableCloth: { top: { rect: { x: [-0.4, 0.42], z: [-0.4, 0.42] } }, sit: { rect: { x: [-0.4, 0.42], z: [-0.4, 0.42] } } },
  // 圆木凳后面有一小截靠背：朝前坐
  stoolWood: { sit: { rect: { x: [-0.36, 0.36], z: [-0.33, 0.42] }, face: 0 } },
  benchWood: { sit: { rect: { x: [-0.44, 0.44], z: [-0.44, 0.5] }, face: 0 } },
  // 单人躺床：枕头、堆着的毯子在它的左手边（+X）那一头，坐在没有枕头的那一截；躺下来只有头枕在枕头边上（再往里枕头堆得太高）
  dayBed: { sit: { rect: { x: [-0.46, 0.08], z: [-0.33, 0.42] }, face: 0 }, lie: { rect: { x: [-0.5, 0.27], z: [-0.3, 0.42] }, turn: -90 } },
  swivelChair: { sit: { rect: { x: [-0.27, 0.27], z: [-0.02, 0.46] }, face: 0 } },
  rockingChair: { sit: { rect: { x: [-0.33, 0.33], z: [-0.15, 0.4] }, face: 0 } },
  // 野餐桌：中间是桌面，两边各一条凳，坐下来脸朝桌子
  picnicTable: {
    top: { rect: { x: [-0.25, 0.25], z: [-0.5, 0.5] } },
    sit: { rect: { x: [-0.5, -0.34], z: [-0.5, 0.5] }, face: 90, also: [{ rect: { x: [0.34, 0.5], z: [-0.5, 0.5] }, face: -90 }] },
  },
  tableRoundWood: { top: { rect: FULL, round: true }, sit: { rect: FULL, round: true } },
  armchairChinese: { sit: { rect: { x: [-0.33, 0.33], z: [-0.33, 0.42] }, face: 0 } },
  deskMetal: TABLE,
  // 布面长沙发：靠背前面堆着靠垫，坐面是靠垫前面那一条
  sofaFabric: { sit: { rect: { x: [-0.33, 0.33], z: [0, 0.46] }, face: 0 }, lie: { rect: { x: [-0.33, 0.33], z: [0.08, 0.5] }, turn: 90 } },
};

/** 多长的箱子才躺得下（米）：再短就只能坐 */
const LIE_MIN = 1.2;

/** 导入的素材找过的接触面：照网格记着（文件换了网格就是新的），分类改了重找 */
const found = new WeakMap<object, { group: PropAssetGroup; contacts: PropContacts }>();

/** 导入的素材的接触面：文件读进来了才找得出来 */
function userContacts(id: string): PropContacts {
  const entry = userAsset(id);
  const shape = propTouchShape(id);
  if (!entry || !shape) return {};
  const had = found.get(shape);
  if (had && had.group === entry.group) return had.contacts;
  const contacts = autoContacts(shape, entry.size, entry.group);
  found.set(shape, { group: entry.group, contacts });
  return contacts;
}

/** 这件道具的接触面。基本体照种类和尺寸定；现成的家具照上面标的；导入的自己找；别的什么都没有 */
export function propContacts(prop: Pick<SceneProp, 'kind' | 'asset' | 'size'>): PropContacts {
  if (prop.kind === 'asset') return (prop.asset && (ASSET_CONTACTS[prop.asset] ?? userContacts(prop.asset))) || {};
  if (prop.kind === 'box') {
    const long = Math.max(prop.size[0], prop.size[2]);
    return {
      sit: { rect: FULL },
      top: { rect: FULL },
      // 够长的箱子（床板、长台）能躺：顺着长的那一边
      ...(long >= LIE_MIN ? { lie: { rect: FULL, turn: prop.size[2] >= prop.size[0] ? 0 : 90 } } : {}),
    };
  }
  if (prop.kind === 'stand') return { sit: { rect: FULL, round: true }, top: { rect: FULL, round: true } };
  if (prop.kind === 'ball') return { sit: { rect: FULL, round: true } };
  return {};
}
