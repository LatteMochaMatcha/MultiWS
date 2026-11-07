/** 照 Graft.mesh 取对应的那块现成网格（手、脚、阴茎；接在腿上、手腕弯过去的手） */
import type { Graft } from '../geometry/figure';
import { footMesh } from './foot';
import { penisMesh } from './genital';
import type { GraftMesh } from './graftMesh';
import { handMesh } from './hand';
import { bentHand } from './swap';

export const graftMeshOf = (kind: Graft['mesh'], digits?: number): GraftMesh =>
  kind === 'foot' ? footMesh(digits) : kind === 'penis' ? penisMesh() : kind === 'palm' ? bentHand(digits).mesh : handMesh(digits);
