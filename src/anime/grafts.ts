/** 照 Graft.mesh 取对应的那块现成网格（手、脚） */
import type { Graft } from '../geometry/figure';
import { footMesh } from './foot';
import type { GraftMesh } from './graftMesh';
import { handMesh } from './hand';

export const graftMeshOf = (kind: Graft['mesh']): GraftMesh => (kind === 'foot' ? footMesh() : handMesh());
