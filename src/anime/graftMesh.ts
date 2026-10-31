/**
 * 缝到身体上的现成网格（手、脚）共用的数据格式和解码。
 * 它们不过距离场，融合完以后在切口处直接缝到身体上（见 sdf/graft.ts）；右边的是左边的翻过来。
 */
import type { V3 } from '../geometry/vec';

export interface GraftMesh {
  /** 顶点，写在素体模型自己的坐标里（面朝 +Z，左手边是 +X） */
  positions: Float32Array;
  normals: Float32Array;
  /** 三角面，逆时针朝外 */
  triangles: Uint16Array;
  /** 切口那一圈上的顶点，顺着切口边上那些面的方向走一圈 */
  loop: number[];
  /** 每个顶点跟着哪几根骨骼（bones 里的下标，每个顶点 4 个）、各占多少（加起来是 1） */
  joints: Uint8Array;
  weights: Float32Array;
  /** 骨骼名，不带左右（手：LowerArm、Hand、Thumb1 …；脚：LowerLeg、Foot、Toes） */
  bones: string[];
  /** 切口那一头的关节（手腕、脚踝）在模型里的位置 */
  end: V3;
  /** 往身体里再一节的关节（手肘、膝盖）：root → end 是顺着前臂、小腿往外的方向 */
  root: V3;
}

/** 打包在 JSON 里的样子（tools/build-hand.ts、build-foot.ts 写的） */
export interface PackedGraftMesh {
  vertices: number;
  loop: number[];
  bones: string[];
  positions: string;
  normals: string;
  joints: string;
  weights: string;
  faces: string;
}

const decode = (text: string) => {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < out.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

export function decodeGraftMesh(meta: PackedGraftMesh, end: V3, root: V3): GraftMesh {
  const count = meta.vertices;
  const packed = new Int8Array(decode(meta.normals).buffer);
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = [packed[i * 3], packed[i * 3 + 1], packed[i * 3 + 2]];
    const l = Math.hypot(x, y, z) || 1;
    normals.set([x / l, y / l, z / l], i * 3);
  }
  return {
    positions: new Float32Array(decode(meta.positions).buffer),
    normals,
    triangles: new Uint16Array(decode(meta.faces).buffer),
    loop: meta.loop,
    joints: decode(meta.joints),
    weights: Float32Array.from(decode(meta.weights), (w) => w / 255),
    bones: meta.bones,
    end,
    root,
  };
}
