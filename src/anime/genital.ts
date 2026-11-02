/**
 * 现成的阴茎、阴囊：DJP Male Base Mesh Mark 03（Death Joe Productions，CC BY 4.0），由 tools/build-genital.ts 取下来。
 * 阴茎不过距离场：融合完以后缝到身体上伸出来的一小截圆柱上（见 sdf/graft.ts），龟头的细节才保得住。
 * 阴囊采成了距离场格子（public/genital.bin），和身体融在一起。
 *
 * 两样都写在素体模型自己的坐标里（米，面朝 +Z，左手边是 +X；素体身高 1.48 米）。
 */
import type { V3 } from '../geometry/vec';
import { registerGrid } from '../sdf/grids';
import meta from './genitalMeta.json';
import { type GraftMesh, decodeGraftMesh } from './graftMesh';
import penis from './penisMesh.json';

/** 导出时写进去的署名（CC BY 4.0 要求） */
export const GENITAL_CREDIT = meta.credit;
/** 数据文件（阴囊的格子）：public 下面的路径 */
export const GENITAL_URL = 'genital.bin';
/** 阴囊的格子登记用的名字 */
export const SCROTUM_GRID = 'genital/scrotum';

/** 阴茎根部（横截面开始变粗的地方）的中心、那里中心线的方向（朝龟头） */
export const PENIS_BASE = penis.base as V3;
export const PENIS_BASE_DIR = penis.baseDir as V3;
/** 切口的中心、那里中心线的方向：距离场里伸出来的圆柱要过了它再收住 */
export const PENIS_CUT = penis.cut as V3;
export const PENIS_CUT_DIR = penis.cutDir as V3;
/** 阴茎的平均半径、切口一圈的平均半径、从根部到龟头沿中心线多长 */
export const PENIS_RADIUS = penis.radius;
export const PENIS_RIM = penis.rim;
export const PENIS_LENGTH = penis.length;
/** 三节骨骼的关节：根部、两个中间、龟头 */
export const PENIS_JOINTS = penis.jointsAt as V3[];
/** 阴囊格子的原点（敞口一圈的中心）在模型里的位置 */
export const SCROTUM_ROOT = meta.scrotum.root as V3;

let cached: GraftMesh | null = null;

/** 现成的阴茎：切口那一头的关节（end）是切口的中心，往里一节（root）是根部；骨骼名 Penis1、Penis2、Penis3 */
export function penisMesh(): GraftMesh {
  cached ??= decodeGraftMesh(penis, PENIS_CUT, PENIS_BASE);
  return cached;
}

/** 网格里的骨骼名 → 这一根的全名（name 把「Penis1」换成 Penis_01_01 这样的） */
export const penisBones = (name: (base: string) => string): Record<string, string> =>
  Object.fromEntries(penis.bones.map((bone) => [bone, name(bone)]));

let installed = false;

/** 把阴囊的格子登记好（浏览器里 fetch 回来，测试和工具里从磁盘读） */
export function installGenital(buffer: ArrayBuffer) {
  const s = meta.scrotum;
  registerGrid(SCROTUM_GRID, {
    min: s.min as V3,
    dims: s.dims as [number, number, number],
    cell: s.cell,
    band: s.band,
    data: new Int16Array(buffer, s.offset * 2, s.length),
    bounds: { min: s.bounds.min as V3, max: s.bounds.max as V3 },
  });
  installed = true;
}

export const genitalReady = () => installed;
