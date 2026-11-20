/**
 * 道具在界面上叫什么（见 model/props.ts、props/catalog.ts）：五种基本体、现成的家具、家具的分组。
 * 单独一个文件：面板、导出时的物体名、测试都用，不用带上整个面板。
 */
import { t } from '../i18n';
import type { PropKind, SceneProp } from '../model/props';
import type { PropAssetGroup } from '../props/catalog';

export const PROP_LABEL: Record<PropKind, string> = { pole: t('杆'), box: t('箱子'), stand: t('台子'), ball: t('球'), wall: t('墙板') };

/** 现成的素材（props/catalog.ts 清单里的）叫什么 */
const ASSET_LABEL: Record<string, string> = {
  chair: t('椅子'),
  chairCushion: t('软垫椅'),
  chairRounded: t('圆背椅'),
  chairDesk: t('办公椅'),
  stoolBar: t('吧台凳'),
  bench: t('长凳'),
  loungeChair: t('单人沙发'),
  loungeSofa: t('双人沙发'),
  loungeSofaLong: t('贵妃沙发'),
  ottoman: t('脚凳'),
  bedSingle: t('单人床'),
  bedDouble: t('双人床'),
  bedBunk: t('上下铺'),
  pillow: t('枕头'),
  table: t('餐桌'),
  tableRound: t('圆桌'),
  tableCoffee: t('茶几'),
  desk: t('书桌'),
  kitchenBar: t('吧台'),
  bookcase: t('书架'),
  bathtub: t('浴缸'),
  toilet: t('马桶'),
  stairs: t('楼梯'),
  doorway: t('门框'),
  // 写实款
  armchairModern: t('现代扶手椅'),
  schoolChair: t('学生椅'),
  schoolDesk: t('课桌'),
  sofaLeather: t('皮面沙发'),
  bedGothic: t('复古双人床'),
  tableCloth: t('铺桌布的餐桌'),
  stoolWood: t('圆木凳'),
  benchWood: t('木长椅'),
  dayBed: t('单人躺床'),
  swivelChair: t('皮转椅'),
  rockingChair: t('摇椅'),
  picnicTable: t('野餐桌'),
  tableRoundWood: t('小圆桌'),
  armchairChinese: t('中式扶手椅'),
  deskMetal: t('铁皮办公桌'),
  sofaFabric: t('布面长沙发'),
};

export const PROP_GROUP_LABEL: Record<PropAssetGroup, string> = { seat: t('坐的'), bed: t('躺的'), table: t('桌柜'), other: t('别的@@道具') };

/** 素材的名字；清单里有、这里没写的返回空（测试会拦住） */
export const propAssetLabel = (id: string): string => ASSET_LABEL[id] ?? '';

/** 这件道具是哪一种：杆、箱子……，素材是它的名字 */
export const propKindLabel = (prop: Pick<SceneProp, 'kind' | 'asset'>): string =>
  prop.kind === 'asset' ? propAssetLabel(prop.asset ?? '') || (prop.asset ?? '') : PROP_LABEL[prop.kind];

/** 道具在界面上叫什么：起了名字用名字，没起就是「杆 3」（3 是它的编号） */
export const propLabel = (prop: SceneProp): string => prop.name || `${propKindLabel(prop)} ${prop.id.slice(1)}`;
