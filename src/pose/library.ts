/**
 * 现成的姿势：一份一份的姿势数据（posing.ts 现在的记法），点一下就套到现在这个角色身上。
 * 排在前面的几个（softPoses.json）是工坊自己摆的柔和的站姿（tools/build-soft-poses.ts）；
 * 后面的（library.json）是 tools/build-poses.ts 从动作素材里一帧一帧取出来的（素材和许可见 README）。
 */
import data from './library.json';
import soft from './softPoses.json';
import { tk } from '../i18n';
import { type Posing, cleanPosing } from './posing';

/** 现成姿势的分类（面板上一次只看一类，见 main.ts）。other 是没写进 POSE_GROUP_NAMES 的，面板上只在「全部」里看得到 */
export const POSE_GROUPS = ['stand', 'daily', 'move', 'rest', 'fight'] as const;
export type PoseGroup = (typeof POSE_GROUPS)[number];

/** 每一类有哪些姿势（按名字）。新增姿势时在这里归个类，不然只在「全部」里（tests/poseLibrary.test.ts 会查） */
const POSE_GROUP_NAMES: Record<PoseGroup, readonly string[]> = {
  stand: ['自然站立', '双手交叠身前', '双手背在身后', '叉腰', '单手叉腰', '挥手', '比耶', '托腮', '站着', '抱着胳膊', '张开双臂'],
  daily: ['说话', '打电话', '靠着栏杆招手', '靠着栏杆', '伸手够东西', '弯腰拿东西', '提着灯', '举着火把', '抱着东西走', '跳舞', '握方向盘', '跪着干活', '弯腰干活'],
  move: ['走', '优雅地走', '慢跑', '冲刺', '蓄力起跳', '腾空', '落地', '往上爬', '滑铲', '蹲着走', '趴着游'],
  rest: ['蹲着', '单手撑地蹲伏', '坐着', '坐着说话', '坐在地上', '仰面躺着', '倒地'],
  fight: ['直拳', '摆拳', '勾拳', '推', '举枪瞄准', '朝天举枪', '单手施法', '投掷', '持剑戒备', '举盾', '格挡', '突刺', '劈砍', '跳劈', '抡斧头', '被打中', '被打飞', '丧尸'],
};
const GROUP_OF = new Map<string, PoseGroup>(POSE_GROUPS.flatMap((group) => POSE_GROUP_NAMES[group].map((name) => [name, group] as [string, PoseGroup])));

export interface PresetPose {
  /** 给人看的名字 */
  name: string;
  posing: Posing;
  /** 哪一类；没归类的是 null */
  group: PoseGroup | null;
}

export const POSE_LIBRARY: PresetPose[] = [...(soft as unknown as { name: string; posing: unknown }[]), ...(data as unknown as { name: string; posing: unknown }[])].map((entry) => ({
  name: entry.name,
  posing: cleanPosing(entry.posing),
  group: GROUP_OF.get(entry.name) ?? null,
}));

/**
 * 姿势名是数据里的中文（softPoses.json、library.json），它既是按名字找姿势的键，也是译文的键，所以不改；
 * 界面上显示时用 t(name)。这里把名字登记成键让抽键脚本看得到：新增、改名姿势时要同步改这一份。
 */
export const POSE_NAME_KEYS: readonly string[] = [
  tk('自然站立'), tk('双手交叠身前'), tk('双手背在身后'), tk('叉腰'), tk('单手叉腰'), tk('挥手'),
  tk('比耶'), tk('托腮'), tk('站着'), tk('抱着胳膊'), tk('说话'), tk('打电话'),
  tk('靠着栏杆招手'), tk('靠着栏杆'), tk('伸手够东西'), tk('弯腰拿东西'), tk('提着灯'), tk('举着火把'),
  tk('抱着东西走'), tk('跳舞'), tk('走'), tk('优雅地走'), tk('慢跑'), tk('冲刺'),
  tk('蓄力起跳'), tk('腾空'), tk('落地'), tk('往上爬'), tk('滑铲'), tk('蹲着'),
  tk('蹲着走'), tk('单手撑地蹲伏'), tk('跪着干活'), tk('弯腰干活'), tk('坐着'), tk('坐着说话'),
  tk('握方向盘'), tk('坐在地上'), tk('仰面躺着'), tk('趴着游'), tk('张开双臂'), tk('直拳'),
  tk('摆拳'), tk('勾拳'), tk('推'), tk('举枪瞄准'), tk('朝天举枪'), tk('单手施法'),
  tk('投掷'), tk('持剑戒备'), tk('举盾'), tk('格挡'), tk('突刺'), tk('劈砍'),
  tk('跳劈'), tk('抡斧头'), tk('被打中'), tk('被打飞'), tk('倒地'), tk('丧尸'),
];
