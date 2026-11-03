/**
 * 现成的姿势：一份一份的姿势数据（posing.ts 现在的记法），点一下就套到现在这个角色身上。
 * 排在前面的几个（softPoses.json）是工坊自己摆的柔和的站姿（tools/build-soft-poses.ts）；
 * 后面的（library.json）是 tools/build-poses.ts 从动作素材里一帧一帧取出来的（素材和许可见 README）。
 */
import data from './library.json';
import soft from './softPoses.json';
import { tk } from '../i18n';
import { type Posing, cleanPosing } from './posing';

export interface PresetPose {
  /** 给人看的名字 */
  name: string;
  posing: Posing;
}

export const POSE_LIBRARY: PresetPose[] = [...(soft as unknown as { name: string; posing: unknown }[]), ...(data as unknown as { name: string; posing: unknown }[])].map((entry) => ({
  name: entry.name,
  posing: cleanPosing(entry.posing),
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
