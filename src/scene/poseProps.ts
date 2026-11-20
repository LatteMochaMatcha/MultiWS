/**
 * 「保存姿势」带上道具（见 docs/props-plan.md）：角色连着道具时（坐着、吊着、手钉着），
 * 姿势文件里把那几件道具和连接一起带上；载入时照现在这个角色站的地方放回场景。纯函数。
 *
 * 文件里道具的左右、前后、朝向是「相对存的时候那个角色」的（角色站在原点、朝向 0）；离地多高照原样记，
 * 角色自己离地多高也记着（lift）：站在台子上、吊在杆上的，载入以后还在那个高度。
 */
import { BODY_LINK, type PropLink, linkOf, liveLinks, normalizeLinks, ridePlace } from '../model/links';
import { type SceneProp, clampProp, nextPropId, normalizeProps, propOf } from '../model/props';
import { type Place, clampPlace, placeY } from '../model/scene';
import { fromScene, toScene } from './interact';

export interface PoseProps {
  props: SceneProp[];
  links: PropLink[];
  /** 角色离地多高（米） */
  lift: number;
}

const wrap = (deg: number) => {
  const w = ((((deg + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
};
const flat = (place: Place): Place => ({ x: place.x, z: place.z, yaw: place.yaw });

/** 存姿势时：这个角色连着的道具和连接；一件都没连着返回 null */
export function packPoseProps(place: Place, links: readonly PropLink[] | undefined, props: readonly SceneProp[]): PoseProps | null {
  const live = liveLinks(links, props);
  if (!live.length) return null;
  const used = props.filter((p) => live.some((l) => l.prop === p.id));
  const here = flat(place);
  return {
    props: used.map((p) => clampProp({ ...p, pos: fromScene(here, p.pos), rot: [p.rot[0], wrap(p.rot[1] - place.yaw), p.rot[2]] })),
    links: live.map((l) => ({ ...l })),
    lift: placeY(place),
  };
}

/** 姿势文件里带的道具读出来；没有、读不懂返回 null */
export function readPoseProps(raw: unknown): PoseProps | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as { props?: unknown; links?: unknown; lift?: unknown };
  const props = normalizeProps(data.props);
  const links = normalizeLinks(data.links, props);
  if (!props.length || !links.length) return null;
  const lift = typeof data.lift === 'number' && Number.isFinite(data.lift) ? data.lift : 0;
  return { props: props.filter((p) => links.some((l) => l.prop === p.id)), links, lift };
}

/**
 * 载入时：道具照现在这个角色站的地方放回场景（编号接着场景里已有的往下起），连接跟着换成新编号。
 * 返回要加进场景的道具、角色的新连接、角色该站在哪（整个人跟着道具的照道具算，别的只换离地多高）
 */
export function placePoseProps(carried: PoseProps, place: Place, existing: readonly SceneProp[]): { props: SceneProp[]; links: PropLink[]; place: Place } {
  const here = flat(place);
  const all = [...existing];
  const renamed = new Map<string, string>();
  const props = carried.props.map((p) => {
    const id = nextPropId(all);
    renamed.set(p.id, id);
    const placed = clampProp({ ...p, id, pos: toScene(here, p.pos), rot: [p.rot[0], wrap(p.rot[1] + place.yaw), p.rot[2]] });
    all.push(placed);
    return placed;
  });
  const links = carried.links.flatMap((l) => (renamed.has(l.prop) ? [{ ...l, prop: renamed.get(l.prop)! }] : []));
  const ride = linkOf(links, BODY_LINK);
  const on = ride && propOf(props, ride.prop);
  return { props, links, place: clampPlace(on ? ridePlace(on, ride) : { ...here, y: carried.lift }) };
}
