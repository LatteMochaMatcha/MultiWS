/**
 * 部件实例名 → 给人看的中文名字：Arm_02_L → 「手臂 2 左」，Head_02_Horn_01_L → 「头 2 · 角 1 左」。
 */
import { t } from '../i18n';

/**
 * 首字母大写。io 的译文里「头、脖子、胯、腰」是句中用的小写词（head、neck …），拿来当标签时用它；中文、日文没有大小写，不受影响
 */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const WHOLE: Record<string, string> = {
  Torso: t('躯干'),
  // 好几个上半身时：躯干只剩腰以下那一截，上面是几份上半身（见 geometry/torsos.ts）
  UpperBody: t('上半身 中'),
  UpperBody_L: t('上半身 左'),
  UpperBody_R: t('上半身 右'),
  LowerBody: t('下身'),
  Cephalothorax: t('蛛形头胸部'),
  Abdomen: t('蛛形腹部'),
};

const WORD: Record<string, string> = {
  Head: cap(t('头')),
  Neck: cap(t('脖子')),
  Arm: t('手臂'),
  Chest: t('胸'),
  Wing: t('翅膀'),
  Leg: t('腿'),
  Tail: t('尾巴'),
  Eye: t('眼睛'),
  Horn: t('角'),
  Ear: t('耳朵'),
  Hair: t('头发'),
  Penis: t('阴茎'),
  Scrotum: t('阴囊'),
};

const SIDE: Record<string, string> = { L: t('左'), R: t('右'), C: t('中') };

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
