/**
 * 现成的姿势：一份一份的姿势数据（posing.ts 现在的记法），点一下就套到现在这个角色身上。
 * 排在前面的几个（softPoses.json）是工坊自己摆的柔和的站姿（tools/build-soft-poses.ts）；
 * 后面的（library.json）是 tools/build-poses.ts 从动作素材里一帧一帧取出来的（素材和许可见 README）。
 */
import data from './library.json';
import soft from './softPoses.json';
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
