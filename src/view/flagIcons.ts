/**
 * 锁定（一把锁）、冻结（一片雪花）的小图标和开关按钮：场景里的角色清单、角色条、道具清单共用。
 * 线条用 currentColor，跟着按钮的字色走
 */
export type FlagKind = 'lock' | 'freeze';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PATHS: Record<FlagKind, string[]> = {
  // 锁身是圆角方块，上面一个锁梁
  lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  // 雪花：三根交叉的线，每根两头各一个小叉
  freeze: ['M12 3v18', 'M4.2 7.5l15.6 9', 'M4.2 16.5l15.6-9', 'M9.5 4.5 12 6l2.5-1.5', 'M9.5 19.5 12 18l2.5 1.5'],
};

export function flagIcon(kind: FlagKind): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('flag-ico');
  for (const d of PATHS[kind]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** 清单行上的开关按钮：on 时是按下去的样子 */
export function flagButton(kind: FlagKind, on: boolean, title: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `icon flag ${kind}`;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.setAttribute('aria-pressed', String(on));
  btn.disabled = disabled;
  btn.append(flagIcon(kind));
  btn.addEventListener('click', onClick);
  return btn;
}
