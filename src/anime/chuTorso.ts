/**
 * 「楚云萱躯干」：预设「楚云萱」的整个上半身（九个胸腔拼成的一整块）烤成的一块距离场格子，由 tools/build-chu-torso.ts 生成。
 * 界面上没有它的入口：只有体块设定里写了要用它（Blocks.trunk，预设「楚云萱」套上去的）才取回来、换上去（见 geometry/trunk.ts）。
 * 坐标是正中那个胸腔（UpperBody）自己的（米，面朝 +Z；和素体的躯干一个坐标）。
 */
import type { V3 } from '../geometry/vec';
import { t } from '../i18n';
import { fetchFile } from '../io/fetchFile';
import { registerGrid } from '../sdf/grids';
import meta from './chuTorsoMeta.json';

/** 数据文件：public 下面的路径 */
export const CHU_TORSO_URL = 'anime/chu-torso.bin';
/** 格子登记用的名字 */
export const CHU_TORSO_GRID = 'anime/chuTorso';
/** 烤的时候躯干在哪一段（from、to）接长了多少 */
export const CHU_TORSO_STRETCH = meta.stretch as [number, number, number];
/** 烤的时候九个胸腔的腰各在哪（这块躯干自己的坐标里） */
export const CHU_TORSO_WAISTS = meta.waists as unknown as Record<string, V3>;

let installed = false;

/** 把格子登记好（浏览器里 fetch 回来，测试和工具里从磁盘读） */
export function installChuTorso(buffer: ArrayBuffer) {
  registerGrid(CHU_TORSO_GRID, {
    min: meta.min as V3,
    dims: meta.dims as [number, number, number],
    cell: meta.cell,
    band: meta.band,
    data: new Int16Array(buffer, 0, meta.length),
    bounds: { min: meta.bounds.min as V3, max: meta.bounds.max as V3 },
  });
  installed = true;
}

export const chuTorsoReady = () => installed;

let loading: Promise<ArrayBuffer> | null = null;

/** 浏览器里用：把数据取回来登记好，只取一次。返回取到的数据：算网格的 Worker 那边也要登记一份（见 sdf/meshClient 的 provideChuTorso） */
export function loadChuTorso(base = '/'): Promise<ArrayBuffer> {
  loading ??= fetchFile(`${base}${CHU_TORSO_URL}`, t('楚云萱躯干数据'))
    .then((buffer) => {
      installChuTorso(buffer);
      return buffer;
    })
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}
