/**
 * 套现成的姿势时手臂让开：现成的姿势是给普通身材、两条手臂的人做的。套到胯宽、胸大的身体上，
 * 垂着的手插进胯里，抱着的胳膊插进胸里；多出来的手臂跟着原来的那条做同样的动作（见 fit.ts 的 followArms），
 * 又会伸进旁边的身子里、和别的手臂打架。
 *
 * 这里一条一条手臂看：上臂、前臂、手当成几段圆棒，取几个点，量它们插进身体多深（身体是静止姿势下的距离场，
 * 不含手臂：每个点照离它最近的那根身上的骨骼换算回静止姿势里去量）。插得比 GRACE 深的，
 * 整条手臂绕肩关节转一点，让插得最深的那一点沿身体表面的法线退出来，反复几轮。
 * 原来的那对只让开身体，最多转 MAX_TURN（姿势本来就是给它们做的）；跟着动的那几条还要让开别的手臂，
 * 这样推不开的（两个上半身之间，往哪边推都是另一个身子），整条往身前抬一点再推（最多抬 LIFT_MAX）；
 * 还碰着就再往前多抬、往身后摆、只照姿势摆几成，让得开又不把肘和手举过肩的里面挑离姿势原意最近的那个，
 * 都不行才退回静止的样子（静止时本来就摆得开，但身子弯下去、走起来它都不动）。原来的那几条里挤在两个身子之间的（三个上半身时正中那个身子的手臂，
 * 见 SQUEEZE）也这样：转到 MAX_TURN 还插着就往身前抬着推，还要让开别的身子上挤着的那几条。
 * 手腕外面那一截要空着，手才缝得上（见 STUB）。
 * 纯函数。
 */
import { type Quat, type V3, add, dot, len, mul, norm, quatBetween, quatConj, quatMul, rotate, sub } from '../geometry/vec';
import { torsoOf } from './fit';
import type { Limb } from './limbs';
import { quatAngle, quatLimit } from './math';
import type { Posing } from './posing';
import { type Frame, forward, setWorldRot, tailOf } from './rig';
import { type Solver, posingOf, stateOf } from './solver';

/** 静止姿势下身体（不含手臂）的距离：外面是正的，单位和骨架一样（米） */
export type BodyDist = (x: number, y: number, z: number) => number;

/** 上臂、前臂、手当成多粗的圆棒（按标准人台的米，取得比实际细：只管明显插进去的） */
const RADIUS = { upper: 0.032, fore: 0.026, hand: 0.016 };
/** 插进去这么深以内不管：手贴着大腿、胳膊贴着身子本来就是这样 */
const GRACE = 0.006;
/** 退出来以后再离开表面这么远 */
const MARGIN = 0.004;
/** 一轮最多转多少；原来的那对一共最多转多少 */
const STEP_TURN = (14 * Math.PI) / 180;
const MAX_TURN = (40 * Math.PI) / 180;
/** 最多几轮 */
const ROUNDS = 10;
/** 跟着动的手臂：每一档往身前抬多少、最多抬多少；每一档上推开的时候最多转多少 */
const LIFT_STEP = (10 * Math.PI) / 180;
const LIFT_MAX = (30 * Math.PI) / 180;
const NUDGE = (20 * Math.PI) / 180;
/** 跟着动的手臂往前抬到 LIFT_MAX 还碰着：往身后最多摆多少；再不行照姿势摆几成（从多到少试） */
const BACK_MAX = (60 * Math.PI) / 180;
/** 再往前多抬最多抬到多少：再高就成了平白举着手（叉腰的那条举到脸前） */
const LIFT_MORE = (60 * Math.PI) / 180;
const PARTLY = [0.75, 0.5, 0.25];
/**
 * 挤在两个身子之间的手臂（三个上半身时正中那个身子的两条）：姿势摆了它，肩关节离另一个身子的哪条手臂的肩关节
 * 又不到上臂长的 SQUEEZE 倍。这几条两边都是别的身子，照姿势垂下去整条埋进旁边那个身子里，往哪边推都推不出来，
 * 只有往身前伸才放得下（三个上半身蹲着时要抬到平举以上）：最多抬 LIFT_STUCK
 */
const SQUEEZE = 0.5;
const LIFT_STUCK = (120 * Math.PI) / 180;
/** 这几条摆回静止的样子时，插得不比 GRACE 的这么多倍深就算让开了 */
const REST_GRACE = 2;
/** 量的点：上臂离肩关节近的那一截埋在身子里，从 UPPER_FROM 起取 */
const UPPER_FROM = 0.4;
/**
 * 手腕外面那一截：手是缝上去的现成网格（见 sdf/graft.ts），前臂的距离场伸出手腕外面 3 cm 左右、越来越细（顺着前臂，也连着手掌根顺着手折过去），
 * 缝手时在这一截上切开，找一圈干净的开口。它贴着身体、别的手臂的话，切开的那一片连到它们身上，就缝不上
 * （叉腰时手腕搭在胯上最常见：只好把手腕周围挖空再融合一两遍，还不一定缝得上，缝不上手就掉成单独一块）。
 * 所以沿前臂、沿手往手腕外面再取几个点（离手腕多远、这一截在那里多粗），周围要空出 WRIST_ROOM，不管 GRACE
 */
const STUB = [
  { at: 0.01, r: 0.014 },
  { at: 0.02, r: 0.01 },
  { at: 0.03, r: 0.004 },
];
const WRIST_ROOM = 0.016;
/** 手腕外面那一截没有照姿势的距离（见 clearArms 的 posed）时，照离它最近的几根骨骼换算着量（见 intoBody） */
const STUB_BONES = 2;
/** 让开以后手腕外面那一截还贴着身体的，再补着转这么多（只管这一截，不改让开没让开） */
const STUB_TURN = (10 * Math.PI) / 180;
/** 身上的骨骼：手臂以外、量身体时用来换算的那些 */
const BODY_BONE = /^(?:Hips|Spine|Chest|UpperChest|Neck|Head|UpperLeg|LowerLeg|Foot|Toes|LowerBody|Abdomen)(?:_[LR])?(?:\.\d+)?$/;

interface Rod {
  a: V3;
  b: V3;
  r: number;
}

/**
 * 让开（见文件开头）。scale：骨架比标准人台大多少倍（圆棒跟着粗）；thick：四肢粗细的倍数；
 * followers：跟着原来那条动的手臂（solver.limbs 的下标）；posed：照这个姿势变形以后身体的距离（世界坐标，见 sdf/posedBody.ts），
 * 有的话手腕外面那一截照它量（照静止姿势换算，两根骨骼交界的地方差得远）。没有要让的就返回原来那份
 */
export function clearArms(
  solver: Solver,
  posing: Posing,
  body: BodyDist,
  scale = 1,
  thick = 1,
  followers: readonly number[] = [],
  posed: BodyDist | null = null,
): Posing {
  const { rig, limbs } = solver;
  const arms = limbs.map((limb, i) => ({ limb, i })).filter(({ limb }) => limb.kind === 'arm');
  if (!arms.length) return posing;
  const state = stateOf(solver, posing);
  const bodyBones = rig.names.map((name, j) => (BODY_BONE.test(name) ? j : -1)).filter((j) => j >= 0);
  const k = scale * thick;
  const grace = GRACE * scale;
  const margin = MARGIN * scale;
  const room = WRIST_ROOM * scale + grace;
  const h = 0.004 * scale;
  let frame = forward(rig, state);
  let changed = false;

  /** 一条手臂现在的几段圆棒：上臂、前臂、手（手指尖：有中指就到中指尖，没有就把手掌那一节加长一半） */
  const rods = (limb: Limb, f: Frame): Rod[] => {
    const s = f.pos[limb.upper];
    const e = f.pos[limb.lower];
    const w = f.pos[limb.end];
    const tag = rig.names[limb.end].replace(/^Hand/, '');
    const tip = rig.index.get(`Middle3${tag}`);
    const end = tip !== undefined ? tailOf(rig, f, tip) : add(w, mul(sub(tailOf(rig, f, limb.end), w), 1.5));
    return [
      { a: s, b: e, r: RADIUS.upper * k },
      { a: e, b: w, r: RADIUS.fore * k },
      { a: w, b: end, r: RADIUS.hand * k },
    ];
  };
  /**
   * 量的点（不含上臂靠肩膀的那一截）。手腕外面那一截（stub，见 STUB）多算上 WRIST_ROOM 再减掉 GRACE（插进去多深都算），
   * 只在所有手臂都摆好以后补着推的时候量（见 freeStub）：算进让开没让开的话，挨着别的手臂垂着的几条（肩部聚拢）全都让不开、
   * 退回静止的样子
   */
  const samples = (limb: Limb, f: Frame): { p: V3; r: number; stub?: boolean }[] => {
    const [upper, fore, hand] = rods(limb, f);
    const out: { p: V3; r: number; stub?: boolean }[] = [];
    for (const t of [UPPER_FROM, 0.6, 0.8, 1]) out.push({ p: lerp3(upper.a, upper.b, t), r: upper.r });
    for (const t of [0.25, 0.5, 0.75, 1]) out.push({ p: lerp3(fore.a, fore.b, t), r: fore.r });
    for (const t of [0.5, 1]) out.push({ p: lerp3(hand.a, hand.b, t), r: hand.r });
    // 顺着前臂伸出去，也连着手掌根顺着手折过去：两个方向都取
    for (const way of [norm(sub(fore.b, fore.a)), norm(sub(hand.b, hand.a))]) {
      for (const { at, r } of STUB) out.push({ p: add(fore.b, mul(way, at * scale)), r: r * k + room, stub: true });
    }
    return out;
  };
  /**
   * 一点在身体里多深（负的是在外面）、往外的方向。nearest：照离它最近的几根身上的骨骼各换算一遍，取插得最深的
   * （两根骨骼交界的地方只照最近的那根换算会差得远：弯腰时屁股跟着胯转，屁股后面的点却离大腿骨更近）
   */
  const intoBody = (p: V3, r: number, f: Frame, nearest = 1): { depth: number; out: V3 } => {
    const near: { b: number; d: number }[] = [];
    for (const b of bodyBones) {
      const d = segmentGap(p, f.pos[b], tailOf(rig, f, b));
      if (near.length < nearest || d < near[near.length - 1].d) {
        near.push({ b, d });
        near.sort((x, y) => x.d - y.d);
        if (near.length > nearest) near.pop();
      }
    }
    let hit = { depth: -Infinity, out: [0, 1, 0] as V3 };
    for (const { b } of near) {
      const probe = intoBodyVia(p, r, f, b);
      if (probe.depth > hit.depth) hit = probe;
    }
    return hit;
  };
  /** 照摆好的姿势量（见 posed） */
  const intoPosed = (p: V3, r: number, dist: BodyDist): { depth: number; out: V3 } => {
    const g: V3 = [dist(p[0] + h, p[1], p[2]) - dist(p[0] - h, p[1], p[2]), dist(p[0], p[1] + h, p[2]) - dist(p[0], p[1] - h, p[2]), dist(p[0], p[1], p[2] + h) - dist(p[0], p[1], p[2] - h)];
    return { depth: r - dist(p[0], p[1], p[2]), out: len(g) > 1e-12 ? norm(g) : [0, 1, 0] };
  };
  /** 照身上的骨骼 best 换算回静止姿势里量 */
  const intoBodyVia = (p: V3, r: number, f: Frame, best: number): { depth: number; out: V3 } => {
    const back = quatConj(f.rot[best]);
    const q = add(rig.head[best], rotate(back, sub(p, f.pos[best])));
    const d = body(q[0], q[1], q[2]);
    const g: V3 = [
      body(q[0] + h, q[1], q[2]) - body(q[0] - h, q[1], q[2]),
      body(q[0], q[1] + h, q[2]) - body(q[0], q[1] - h, q[2]),
      body(q[0], q[1], q[2] + h) - body(q[0], q[1], q[2] - h),
    ];
    return { depth: r - d, out: len(g) > 1e-12 ? rotate(f.rot[best], norm(g)) : [0, 1, 0] };
  };
  /** 一点插进别的手臂多深、往外的方向 */
  const intoArms = (p: V3, r: number, others: Rod[]): { depth: number; out: V3 } => {
    let depth = -Infinity;
    let out: V3 = [0, 1, 0];
    for (const rod of others) {
      const c = closest(p, rod.a, rod.b);
      const away = sub(p, c);
      const d = r + rod.r - len(away);
      if (d > depth && len(away) > 1e-9) [depth, out] = [d, norm(away)];
    }
    return { depth, out };
  };
  /** 一条手臂插得最深的那一点（withStub：手腕外面那一截也量） */
  const worst = (limb: Limb, others: Rod[] | null, withStub = false): { p: V3; depth: number; out: V3 } => {
    let hit = { p: [0, 0, 0] as V3, depth: -Infinity, out: [0, 1, 0] as V3 };
    for (const { p, r, stub } of samples(limb, frame)) {
      if (stub && !withStub) continue;
      const inBody = stub && posed ? intoPosed(p, r, posed) : intoBody(p, r, frame, stub ? STUB_BONES : 1);
      for (const probe of [inBody, others ? intoArms(p, r, others) : null]) {
        if (probe && probe.depth > hit.depth) hit = { p, ...probe };
      }
    }
    return hit;
  };
  /** 整条手臂绕肩关节转 turn（世界坐标里的旋转） */
  const swing = (limb: Limb, turn: Quat) => {
    setWorldRot(rig, state, frame, limb.upper, quatMul(turn, frame.rot[limb.upper]));
    frame = forward(rig, state);
  };
  /** 一条手臂让开：返回最后还插着多深 */
  const relieve = (limb: Limb, others: Rod[] | null, limit: number, withStub = false): number => {
    let turned = 0;
    let hit = worst(limb, others, withStub);
    for (let round = 0; round < ROUNDS && hit.depth > grace && turned < limit; round++) {
      const s = frame.pos[limb.upper];
      const from = sub(hit.p, s);
      const to = add(from, mul(hit.out, hit.depth + margin));
      if (len(from) < 1e-6 || len(to) < 1e-6) break;
      const turn = quatLimit(quatBetween(norm(from), norm(to)), Math.min(STEP_TURN, limit - turned));
      if (quatAngle(turn) < 1e-4) break;
      swing(limb, turn);
      turned += quatAngle(turn);
      changed = true;
      hit = worst(limb, others, withStub);
    }
    return hit.depth;
  };
  /**
   * 让开以后手腕外面那一截还贴着身体、别的手臂的，再补着推一点（最多转 STUB_TURN）；推了以后别处（身体、别的手臂）又插进去的，退回去。
   */
  const freeStub = (limb: Limb, chain: number[], others: Rod[] | null) => {
    const before = worst(limb, others).depth;
    if (worst(limb, others, true).depth <= grace) return;
    const locals = chain.map((j) => state.local[j]);
    relieve(limb, others, STUB_TURN, true);
    if (worst(limb, others).depth > Math.max(before, grace)) put(chain, locals);
  };

  /** 一条手臂的上臂、前臂现在朝哪（单位向量） */
  const armWays = (limb: Limb, f: Frame): [V3, V3] => [norm(sub(f.pos[limb.lower], f.pos[limb.upper])), norm(sub(f.pos[limb.end], f.pos[limb.lower]))];
  /** 一条手臂（chain：锁骨往外的骨骼）摆回 locals（null 是静止的样子） */
  const put = (chain: number[], locals: readonly Quat[] | null) => {
    chain.forEach((j, n) => (state.local[j] = locals ? locals[n] : [0, 0, 0, 1]));
    frame = forward(rig, state);
  };
  /**
   * 推不开的：从 start 起整条往身前抬 angle（绕手臂长在上面的那个上半身现在的左右方向转），再推开（最多转 NUDGE）。
   * others：还要让开的别的手臂（只让开身体的是 null）。返回最后还插着多深
   */
  const lifted = (limb: Limb, chain: number[], start: readonly Quat[], angle: number, others: Rod[] | null): number => {
    put(chain, start);
    const top = rig.parent[chain[0]];
    if (angle) swing(limb, axisTurn(rotate(top >= 0 ? frame.rot[top] : [0, 0, 0, 1], [1, 0, 0]), -angle));
    return relieve(limb, others, NUDGE);
  };

  const following = new Set(followers);
  /**
   * 挤在两个身子之间的（见 SQUEEZE）：原来的那几条里，姿势摆了它、肩关节旁边又有另一个身子的手臂的。
   * 姿势没摆的（只套了脊柱，或者挤在别的手臂旁边没跟着动的）本来就是静止的样子，照旧：硬往前抬反而伸到旁边那个身子前面去
   */
  const squeezed = new Set(
    arms
      .filter(({ limb, i }) => {
        if (following.has(i) || !posing.bones[rig.names[limb.upper]]) return false;
        const mine = torsoOf(rig, limb.upper);
        const at = rig.head[limb.upper];
        return arms.some(({ limb: other }) => {
          const p = rig.head[other.upper];
          return other !== limb && torsoOf(rig, other.upper) !== mine && Math.hypot(at[0] - p[0], at[1] - p[1], at[2] - p[2]) < SQUEEZE * limb.len1;
        });
      })
      .map(({ i }) => i),
  );
  // 先是原来的那几条：只让开身体，最多转 MAX_TURN。
  // 挤在两个身子之间的还要让开已经摆好的、别的身子上挤着的那几条；转到 MAX_TURN 还插着，就往身前抬着推，
  // 还不行就试试静止的样子（静止时本来就摆得开），再不行接着抬（最多抬 LIFT_STUCK），都不行照插得最浅的那样摆
  const settled: { limb: Limb; torso: string }[] = [];
  for (const { limb, i } of arms) {
    if (following.has(i)) continue;
    if (!squeezed.has(i)) {
      relieve(limb, null, MAX_TURN);
      continue;
    }
    const torso = torsoOf(rig, limb.upper);
    // 只让开别的那几条的前臂和手（凑到一起的是手）：上臂在肩膀那里本来就挨着（肩关节只隔 1 cm），照上臂的粗细算总是插着的
    const near = settled.filter((other) => other.torso !== torso).flatMap((other) => rods(other.limb, frame).slice(1));
    const others = near.length ? near : null;
    settled.push({ limb, torso });
    const chain = armChain(solver, limb);
    const start = chain.map((j) => state.local[j]);
    let depth = relieve(limb, others, MAX_TURN);
    let best = { depth, locals: chain.map((j) => state.local[j]) };
    const keep = () => {
      if (depth < best.depth) best = { depth, locals: chain.map((j) => state.local[j]) };
    };
    // 先抬一点（到 LIFT_MAX）；不行先回静止的样子（这几条静止时本来就排开了，手在胸前）：再往上抬的话，
    // 弯着胳膊的姿势（叉腰）前臂会举到脸前，后面挤着的那条还要给它让开、被顶到头那么高；静止也不行（蹲着）才接着抬
    // 静止的样子多让一点：静止时这几条本来就是贴着摆的（静止融合也缝得上），插得不比 REST_GRACE 深就用它
    const tryRest = () => {
      put(chain, null);
      depth = worst(limb, others).depth;
      if (depth <= REST_GRACE * grace) depth = Math.min(depth, grace);
      else depth = relieve(limb, others, NUDGE);
      keep();
    };
    for (let angle = LIFT_STEP; angle <= LIFT_STUCK + 1e-9 && best.depth > grace; angle += LIFT_STEP) {
      if (angle > LIFT_MAX + 1e-9 && angle - LIFT_STEP <= LIFT_MAX + 1e-9) {
        tryRest();
        if (best.depth <= grace) break;
      }
      depth = lifted(limb, chain, start, angle, others);
      keep();
    }
    if (best.depth > grace) tryRest();
    put(chain, best.locals);
    if (best.locals.some((q, n) => q !== start[n])) changed = true;
  }
  // 再是跟着动的：还要让开别的手臂
  const resting = new Set<number>();
  for (const { limb, i } of arms) {
    if (!following.has(i)) continue;
    const chain = armChain(solver, limb);
    const start = chain.map((j) => state.local[j]);
    const others = () => arms.filter((other) => other.i !== i).flatMap((other) => rods(other.limb, frame));
    let clear = false;
    for (let angle = 0; angle <= LIFT_MAX + 1e-9 && !clear; angle += LIFT_STEP) clear = lifted(limb, chain, start, angle, others()) <= grace;
    // 往前抬到头还碰着（两个上半身中间的两条照姿势垂下去，两边都是身子）：再往前多抬、往身后摆（搭在另一个身子背后）、
    // 只照姿势摆几成（剩下的照静止的样子，手在另一个身子胸前、腰前），让得开的里面挑离姿势原意最近的那个；都不行才整条退回静止的样子。
    // 退回静止的话，这条手臂一直横在胸前，身子弯下去、走起来它都不动（看着就像姿势没套上）
    if (!clear) {
      put(chain, start);
      const want = armWays(limb, frame);
      // 肘、手最高到哪：姿势里的肘、手和肩关节里高的那个。往身后摆、往前抬的时候举起来的（手肘从两个头中间翘上去），不要
      const shoulder = frame.pos[limb.upper][1] + 0.02 * scale;
      const ceiling = [Math.max(frame.pos[limb.lower][1] + 0.02 * scale, shoulder), Math.max(frame.pos[limb.end][1] + 0.02 * scale, shoulder)];
      let best: { off: number; locals: Quat[] } | null = null;
      const consider = (depth: number) => {
        if (depth > grace || frame.pos[limb.lower][1] > ceiling[0] || frame.pos[limb.end][1] > ceiling[1]) return;
        const now = armWays(limb, frame);
        const off = Math.acos(Math.max(-1, Math.min(1, dot(now[0], want[0])))) + 0.5 * Math.acos(Math.max(-1, Math.min(1, dot(now[1], want[1]))));
        if (!best || off < best.off) best = { off, locals: chain.map((j) => state.local[j]) };
      };
      for (let angle = LIFT_MAX + LIFT_STEP; angle <= LIFT_MORE + 1e-9; angle += LIFT_STEP) consider(lifted(limb, chain, start, angle, others()));
      for (let angle = LIFT_STEP; angle <= BACK_MAX + 1e-9; angle += LIFT_STEP) consider(lifted(limb, chain, start, -angle, others()));
      for (const keep of PARTLY) {
        put(chain, start.map((q) => nlerpQuat([0, 0, 0, 1], q, keep)));
        consider(relieve(limb, others(), NUDGE));
      }
      const found = best as { off: number; locals: Quat[] } | null;
      if (found) {
        put(chain, found.locals);
        clear = true;
      }
    }
    // 抬到头还碰着：这条手臂（锁骨往外）退回静止的样子
    if (!clear) {
      put(chain, null);
      resting.add(i);
    }
    changed = true;
  }
  // 都摆好以后，手腕外面那一截还贴着身体的补着推一点（见 freeStub）。放在最后：边摆边推的话，推开的那条挤占了后面那条的地方，
  // 后面那条就让不开了。推了以后碰到别的手臂的退回去（跟着动的看所有别的手臂，挤着的看别的身子上挤着的，别的只看身体）
  for (const { limb, i } of arms) {
    if (resting.has(i)) continue;
    const torso = torsoOf(rig, limb.upper);
    const others = following.has(i)
      ? arms.filter((other) => other.i !== i).flatMap((other) => rods(other.limb, frame))
      : squeezed.has(i)
        ? arms.filter((other) => squeezed.has(other.i) && torsoOf(rig, other.limb.upper) !== torso).flatMap((other) => rods(other.limb, frame).slice(1))
        : null;
    freeStub(limb, armChain(solver, limb), others?.length ? others : null);
  }
  return changed ? posingOf(solver, state, posing) : posing;
}

/** 一条手臂上的骨骼：锁骨（有的话）、上臂，以及它们往下所有的骨骼 */
function armChain(solver: Solver, limb: Limb): number[] {
  const { rig } = solver;
  const top = rig.parent[limb.upper] >= 0 && /^Shoulder/.test(rig.names[rig.parent[limb.upper]]) ? rig.parent[limb.upper] : limb.upper;
  const out = [top];
  for (let j = 0; j < rig.names.length; j++) {
    if (j === top) continue;
    for (let p = rig.parent[j]; p >= 0; p = rig.parent[p]) {
      if (p === top) {
        out.push(j);
        break;
      }
    }
  }
  return out;
}

/** 绕单位向量 axis 转 angle 弧度 */
function axisTurn(axis: V3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/** 从 a 转到 b 的 t 那么多（归一化的线性插值，先换到同一边） */
function nlerpQuat(a: Quat, b: Quat, t: number): Quat {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const m: Quat = [a[0] + (s * b[0] - a[0]) * t, a[1] + (s * b[1] - a[1]) * t, a[2] + (s * b[2] - a[2]) * t, a[3] + (s * b[3] - a[3]) * t];
  const l = Math.hypot(m[0], m[1], m[2], m[3]) || 1;
  return [m[0] / l, m[1] / l, m[2] / l, m[3] / l];
}

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 线段 ab 上离 p 最近的点 */
function closest(p: V3, a: V3, b: V3): V3 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return lerp3(a, b, t);
}

const segmentGap = (p: V3, a: V3, b: V3) => len(sub(p, closest(p, a, b)));

