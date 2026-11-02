/**
 * 部件实例名 → 给人看的中文名字：Arm_02_L → 「手臂 2 左」，Head_02_Horn_01_L → 「头 2 · 角 1 左」。
 */

const WHOLE: Record<string, string> = {
  Torso: '躯干',
  // 好几个上半身时：躯干只剩腰以下那一截，上面是几份上半身（见 geometry/torsos.ts）
  UpperBody: '上半身 中',
  UpperBody_L: '上半身 左',
  UpperBody_R: '上半身 右',
  LowerBody: '下身',
  Cephalothorax: '蛛形头胸部',
  Abdomen: '蛛形腹部',
};

const WORD: Record<string, string> = {
  Head: '头',
  Neck: '脖子',
  Arm: '手臂',
  Chest: '胸',
  Wing: '翅膀',
  Leg: '腿',
  Tail: '尾巴',
  Eye: '眼睛',
  Horn: '角',
  Ear: '耳朵',
  Hair: '头发',
  Penis: '阴茎',
  Scrotum: '阴囊',
};

const SIDE: Record<string, string> = { L: '左', R: '右', C: '中' };

export function partLabel(name: string): string {
  if (WHOLE[name]) return WHOLE[name];
  const tokens = name.split('_');
  const pieces: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    const word = WORD[tokens[i++]];
    if (!word) return name;
    let piece = word;
    if (/^\d+$/.test(tokens[i] ?? '')) piece += ` ${Number(tokens[i++])}`;
    if (SIDE[tokens[i] ?? '']) piece += ` ${SIDE[tokens[i++]]}`;
    pieces.push(piece);
  }
  return pieces.join(' · ');
}
