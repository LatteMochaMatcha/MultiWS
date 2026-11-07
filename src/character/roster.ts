/**
 * 「成品角色」样式能选的角色：每个是一个现成的 VRoid 模型（VRM 0.x）。
 * 这里记着每个角色的文件、来历和许可，以及读文件时要知道的两件事（自带的兽耳、染发改哪种材质）。
 * 文件是 tools/build-characters.ts 从 assets/source/ 里的原件加工出来的（只去掉了工坊用不到的贴图），放在 public/character/。
 *
 * 纯数据，不依赖浏览器。
 */
import { t } from '../i18n';
import type { CharacterId } from '../model/spec';
import { CHARACTER_IDS } from '../model/spec';
import type { ReadOptions } from './source';

export interface RosterEntry extends ReadOptions {
  id: CharacterId;
  /** 选择框里显示的名字：一眼看得出是哪个 */
  label: string;
  /** 她原来的名字（文件里写的） */
  name: string;
  /** 一句话说她长什么样 */
  look: string;
  /** public/character/ 下面的文件名 */
  file: string;
  /** 原件在 assets/source/ 下面的路径（加工脚本用） */
  source: string;
  /** 作者 */
  author: string;
  /** 许可，一句话 */
  license: string;
  /** 来源网页 */
  page: string;
  /** 许可要求署名的角色才有：用她做的东西发出去时要带上的那一句 */
  credit?: string;
}

/** pixiv 以 CC0 发布的 VRoid 旧版样例 */
const CC0 = t('CC0（pixiv 放弃著作权，随便用，不用署名）');
const OGA = 'https://opengameart.org/content/vroid-studio-cc0-models';
/** 作者在 VRoid Hub 上设的条件 */
const HUB = t('VRoid Hub 条件：谁都能用、可改、可再分发、可商用、不用署名');

export const ROSTER: readonly RosterEntry[] = [
  {
    id: 'vita',
    label: t('银发猫耳'),
    name: t('ヴィータ'),
    look: t('银色短发、蓝色挑染、异色瞳，自带电子猫耳'),
    file: 'vita.vrm',
    source: 'avatarsample_f/AvatarSample_F.vrm',
    author: t('VRoid 项目（pixiv）'),
    license: CC0,
    page: OGA,
    // 她那副猫耳是做在头发里的，用的是头发的第三种材质；第二种是那几缕蓝色的挑染，染发时留着
    ears: /_HAIR_03$/,
    dye: /_HAIR_01$/,
  },
  {
    id: 'victoria',
    label: t('金发侧马尾'),
    name: t('ヴィクトリア・ルービン'),
    look: t('金发、粉色发梢、侧马尾，粉白洋装'),
    file: 'victoria.vrm',
    source: 'avatarsample_g/AvatarSample_G.vrm',
    author: t('VRoid 项目（pixiv）'),
    license: CC0,
    page: OGA,
    dye: /_HAIR_0[12]$/,
  },
  {
    id: 'shino',
    label: t('黑长直'),
    name: t('千駄ヶ谷篠'),
    look: t('黑蓝色长直发，学生制服'),
    file: 'shino.vrm',
    source: 'sendagaya_shino/Sendagaya Shino.vrm',
    author: t('VRoid 项目（pixiv）'),
    license: CC0,
    page: OGA,
    dye: /_HAIR_01$/,
  },
  {
    id: 'shibu',
    label: t('蓝短发制服'),
    name: t('千駄ヶ谷渋'),
    look: t('深蓝色短发、红色发夹，学生制服'),
    file: 'shibu.vrm',
    source: 'avatarsample_d/AvatarSample_D.vrm',
    author: t('VRoid 项目（pixiv）'),
    license: CC0,
    page: OGA,
    dye: /_HAIR_01$/,
  },
  {
    id: 'vivi',
    label: t('棕发围裙'),
    name: t('ビビ'),
    look: t('棕色短发，绿色围裙裙'),
    file: 'vivi.vrm',
    source: 'avatarsample_e/AvatarSample_E.vrm',
    author: t('VRoid 项目（pixiv）'),
    license: CC0,
    page: OGA,
    dye: /_HAIR_0\d$/,
  },
  {
    id: 'rabbit',
    label: t('兔耳'),
    name: 'Preset Only Rabbit - Aquamarine',
    look: t('黑发麻花辫、兔耳，短上衣短裤'),
    file: 'rabbit.vrm',
    source: 'rabbit_aquamarine/5975234397273575285.vrm',
    author: t('七百屋（なおしま）'),
    license: HUB,
    page: 'https://hub.vroid.com/characters/1717274721342417994/models/7864107620888472526',
    ears: /Accessory_RabbitEar/,
    dye: /_Hair_\d+_HAIR(_\d+)?$/,
  },
  {
    id: 'kuro',
    label: t('狼耳'),
    name: 'Kuro（Preset Nekomimi Girls）',
    look: t('黑色短发、狼耳、小麦肤色，白上衣黑短裤'),
    file: 'kuro.vrm',
    source: 'nekomimi_kuro/3937691808267523746.vrm',
    author: t('七百屋（なおしま）'),
    license: t('VRoid Hub 条件：谁都能用、可改、可再分发、可商用、不用署名；不许用于性表现'),
    page: 'https://hub.vroid.com/characters/6562992088211538595/models/9028223814359507805',
    ears: /Accessory_CatEar/,
    dye: /_Hair_\d+_HAIR(_\d+)?$/,
  },
  {
    id: 'sailor',
    label: t('马尾水手服'),
    name: t('水色（ポニーテルの女の子）'),
    look: t('灰紫色马尾，水手服加开衫'),
    file: 'sailor.vrm',
    source: 'ponytail_sailor/7482151987160479129.vrm',
    author: t('白い白米'),
    license: HUB,
    page: 'https://hub.vroid.com/characters/3437260818058077430/models/1673540765472485601',
    dye: /_Hair_\d+_HAIR(_\d+)?$/,
  },
  {
    id: 'alice',
    label: t('橙发校服'),
    name: 'Alice Chan',
    look: t('橙色长发，灰色开衫校服'),
    file: 'alice.vrm',
    source: 'alice_chan/Alice Chan (Uniform ver) v1.0.4/Alice Chan (Uniform ver) 1.0.2.vrm',
    author: 'edisonlee55（yuna0x0）',
    license: t('CC BY-SA 4.0：要署名；改过再发出去也得用同样的许可'),
    page: 'https://yuna0x0.itch.io/alice-chan',
    credit: 'Alice Chan © edisonlee55，CC BY-SA 4.0',
    dye: /_Hair_\d+_HAIR(_\d+)?$/,
  },
  {
    id: 'kotori',
    label: t('绿发红裙'),
    name: 'Kotori',
    look: t('黄绿色头发，白上衣红裙'),
    file: 'kotori.vrm',
    source: 'kotori/Model/Kotori.vrm',
    author: 'Fox Jump',
    license: t('CC BY（文件里写的）：要署名'),
    page: 'https://fox-jump.itch.io/kotori-anime-character',
    credit: 'Kotori © Fox Jump，CC BY',
    dye: /_HAIR_01$/,
  },
  // 下面两个是男生（2026-11-07 加的，和上面四个 pixiv 样例同一页、同样 CC0）：主要给「好几个上半身」里某一个上半身换成男的用（BodySpec.torsoCharacters）
  {
    id: 'fumiriya',
    label: t('渐变短发男生'),
    name: t('桜田史利矢'),
    look: t('男生：橙色渐变到紫色的短发，白衬衫黑背心'),
    file: 'fumiriya.vrm',
    source: 'sakurada_fumiriya/Sakurada Fumiriya.vrm',
    author: t('VRoid 项目（pixiv）'),
    license: CC0,
    page: OGA,
    // 头发两种材质：浅的那层和紫色的发梢，一起染
    dye: /_Hair_00_HAIR_0[12]$/,
  },
  {
    id: 'haruto',
    label: t('黑短发男生'),
    name: 'HairSample_Male',
    look: t('男生：黑色短发，白色连帽外套'),
    file: 'haruto.vrm',
    source: 'hairsample_male/HairSample_Male.vrm',
    author: t('VRoid 项目（pixiv）'),
    license: CC0,
    page: OGA,
    dye: /_Hair_00_HAIR$/,
  },
  // 再四个男生（2026-11-07 加的）：VRoid Hub 上作者把条件设成谁都能用、可改、可再分发、可商用的，他点名同意、自己登录下载
  {
    id: 'noble',
    label: t('黑发礼服青年'),
    name: t('プリセット/黒髪青年'),
    look: t('男生：黑色短发、红眼睛，黑金礼服'),
    file: 'noble.vrm',
    source: 'hub_noble/6594862416337265358.vrm',
    author: 'sin',
    license: t('VRoid Hub 条件：谁都能用、可改、可再分发、可商用；作者要求改过的要写明有原模型'),
    page: 'https://hub.vroid.com/characters/9103390712787836864/models/1189100618626473688',
    // 作者在说明里写着「改変する場合は元となるモデルがあることを明記して下さい」：工坊拼出来的都算改过，导出时写上
    credit: 'プリセット/黒髪青年 © sin（VRoid Hub）',
    dye: /_Hair_\d+_HAIR(_\d+)?$/,
  },
  {
    id: 'fritz',
    label: t('白衬衫少年'),
    name: t('汎用少年キャラFritz'),
    look: t('男生：黑色中短发，白衬衫'),
    file: 'fritz.vrm',
    source: 'hub_fritz/340860444786907840.vrm',
    author: t('霧太郎'),
    license: t('VRoid Hub 条件：谁都能用、可改、可再分发、可商用、不用署名；不许用于政治、诽谤'),
    page: 'https://hub.vroid.com/characters/256061151319389031/models/2876490360462822712',
    dye: /_Hair_\d+_HAIR(_\d+)?$/,
  },
  {
    id: 'shinya',
    label: t('黑白连帽衫'),
    name: t('モノクロ男性【シンヤ】'),
    look: t('男生：黑白配色，黑色长刘海，黑色连帽衫'),
    file: 'shinya.vrm',
    source: 'hub_shinya/7817070836861794693.vrm',
    author: t('中森あか'),
    license: t('VRoid Hub 条件：谁都能用、可改、可再分发、可商用、不用署名；不许用于犯罪'),
    page: 'https://hub.vroid.com/characters/1318116850280961380/models/5973900355360991383',
    dye: /_Hair_\d+_HAIR(_\d+)?$/,
  },
  {
    id: 'marron',
    label: t('棕发针织背心'),
    name: t('マロン'),
    look: t('男生：棕色短发、绿眼睛，白衬衫米色针织背心'),
    file: 'marron.vrm',
    source: 'hub_marron/2693294445634964331.vrm',
    author: t('ピカピカ'),
    license: t('VRoid Hub 条件：谁都能用、可改、可再分发、可商用、不用署名；不许用于性表现'),
    page: 'https://hub.vroid.com/characters/7459200881471498968/models/4791607087327485063',
    dye: /_Hair_\d+_HAIR(_\d+)?$/,
  },
];

const BY_ID = new Map(ROSTER.map((entry) => [entry.id, entry]));
if (ROSTER.length !== CHARACTER_IDS.length || CHARACTER_IDS.some((id) => !BY_ID.has(id))) throw new Error('角色清单和 CHARACTER_IDS 对不上');

export const rosterEntry = (id: CharacterId): RosterEntry => BY_ID.get(id)!;
/** 角色文件的地址（相对网站根目录） */
export const characterUrl = (id: CharacterId) => `character/${rosterEntry(id).file}`;
