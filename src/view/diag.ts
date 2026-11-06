/**
 * 3D 显示的诊断和兼容模式。
 *
 * 有的手机（低端显卡、偏旧的安卓 WebView）界面都在、3D 视图却一片空白：连地上那圈参照线都没有，又不报错。
 * 用户那边拿不到控制台，所以：
 *   - 页面一打开就把出过的错记下来（脚本错误、网格线程的错、着色器编译不过、显卡掉线、某一帧画不出来）；
 *   - 打开后过几秒真去读一次画面：有东西要画（参照圈、模型）、整个画面却一个点都没有，就自动换成「兼容模式」
 *     （关掉抗锯齿、透明底、保留画面、阴影，分辨率 1 倍）整页重开一次，用的人什么都不用点；只自动换这一次；
 *   - 兼容模式下还是空的、或者等了很久模型还没出来，就在 3D 视图上弹一张卡片，写明 WebView 版本、显卡、出过的错，
 *     能一键复制、能截图发回来。「更多」里也能看诊断、手动开关兼容模式。
 */
import type * as THREE from 'three';
import { t } from '../i18n';
import './diag.css';
import type { Viewport } from './viewport';

/** 兼容模式：'1' 是人在「更多」或卡片上开的，'auto' 是读画面发现全空自动开的 */
const SAFE_KEY = 'oc-gl-safe';
/** 自动换过一次兼容模式了：以后不再自动换（人自己关掉的话就一直关着，不来回重开） */
const TRIED_KEY = 'oc-gl-safe-tried';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const SAFE_MODE = read(SAFE_KEY);
/** 兼容模式开着没有：页面载入时定下来，换了要整页重开 */
export const SAFE_GL: boolean = SAFE_MODE === '1' || SAFE_MODE === 'auto';
const AUTO_SAFE = SAFE_MODE === 'auto';

function setSafe(on: boolean, auto = false): boolean {
  try {
    if (on) localStorage.setItem(SAFE_KEY, auto ? 'auto' : '1');
    else localStorage.removeItem(SAFE_KEY);
    if (auto) localStorage.setItem(TRIED_KEY, '1');
  } catch {
    // 记不住：自动换的那次就不重开了（不然会一直重开）；人点的照样重开，至少看得到没变
    if (auto) return false;
  }
  location.reload();
  return true;
}

/** 出过的问题，最多记 30 条，一样的只记一次 */
const problems: string[] = [];
let renderer: THREE.WebGLRenderer | null = null;
let viewport: Viewport | null = null;
/** 最近一次读画面的结果 */
let lastProbe: { triangles: number; filled: number; sampled: number } | null = null;
/** 最近一次读画面时场景里有没有模型（顶点多的网格） */
let lastModel = false;

/** 记一条问题。urgent：这种问题本身就说明 3D 显示坏了（着色器编译不过、显卡掉线、画帧出错），马上弹卡片 */
export function noteProblem(message: string, urgent = false) {
  const text = message.length > 600 ? `${message.slice(0, 600)}…` : message;
  if (!problems.includes(text) && problems.length < 30) {
    problems.push(text);
    if (card && !card.hidden) fill();
  }
  if (urgent) show(t('3D 显示出错了'));
}

/** 页面一开始就装上：脚本错误、没接住的 Promise 都记下来（不弹卡片，等读画面发现空白时一起给人看） */
export function installDiag() {
  window.addEventListener('error', (event) => {
    const where = event.filename ? ` (${event.filename.split('/').pop()}:${event.lineno}:${event.colno})` : '';
    noteProblem(`${event.message || t('脚本出错')}${where}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    noteProblem(`${t('没接住的错误')}：${reason instanceof Error ? reason.message : String(reason)}`);
  });
}

/** 渲染器建好时：着色器编译不过、显卡掉线都记下来 */
export function watchRenderer(r: THREE.WebGLRenderer) {
  renderer = r;
  r.debug.onShaderError = (gl, program, vs, fs) => {
    const logs = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)]
      .map((s) => (s ?? '').trim())
      .filter(Boolean);
    console.error('THREE.WebGLProgram: shader error', ...logs);
    noteProblem(`${t('着色器编译不过')}：${logs.join(' | ') || '?'}`, true);
  };
  const canvas = r.domElement;
  let lost = 0;
  canvas.addEventListener('webglcontextlost', () => {
    noteProblem(t('显卡掉线了（WebGL context lost）'));
    lost = window.setTimeout(() => show(t('3D 显示出错了')), 3000);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    window.clearTimeout(lost);
    noteProblem(t('显卡又连上了（WebGL context restored）'));
  });
}

/** 场景里有没有像模型的东西：顶点多的可见网格（地面 4 个点、参照圈两三百个点都不算） */
function hasModel(scene: THREE.Object3D): boolean {
  let found = false;
  scene.traverseVisible((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!found && mesh.isMesh && (mesh.geometry?.attributes.position?.count ?? 0) > 2000) found = true;
  });
  return found;
}

function probe(): void {
  if (!viewport) return;
  try {
    lastProbe = viewport.probe();
    lastModel = hasModel(viewport.scene);
  } catch (err) {
    noteProblem(`${t('读画面时出错')}：${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 引导、别的弹层开着的时候先不弹：过一会儿再看 */
function busy(): boolean {
  return !!document.querySelector('.tour') || document.visibilityState === 'hidden';
}

/**
 * 读一次画面，看是不是「该有东西却一个点都没画出来」：交给显卡的三角形超过 10 个
 * （地面只有 2 个、还只画影子；参照圈就有两百多个），整个画面却全是空的
 */
function blankNow(): boolean {
  probe();
  return !!lastProbe && lastProbe.sampled > 0 && lastProbe.triangles > 10 && lastProbe.filled === 0;
}

/** 等页面在前台、没被引导之类的盖着再做 */
function whenFree(run: () => void, needFree: boolean) {
  if (document.visibilityState === 'hidden' || (needFree && busy())) {
    window.setTimeout(() => whenFree(run, needFree), 3000);
    return;
  }
  run();
}

/**
 * 3D 视图建好以后：过 5 秒读画面，隔 1.5 秒再读一次，两次都是「该有东西却全空」——
 * 没换过就自动换成兼容模式重开；兼容模式下还空就弹卡片。过 60 秒模型还没出来也弹（多半是网格线程出了问题，或者手机太慢）
 */
export function watchViewport(v: Viewport) {
  viewport = v;
  const blankTwice = () =>
    whenFree(() => {
      if (!blankNow()) return;
      window.setTimeout(() => {
        if (!blankNow()) return;
        noteProblem(t('3D 视图什么都没画出来'));
        if (!SAFE_GL && read(TRIED_KEY) !== '1' && setSafe(true, true)) return;
        whenFree(() => show(t('3D 视图什么都没画出来')), true);
      }, 1500);
    }, false);
  window.setTimeout(blankTwice, 5000);
  window.setTimeout(
    () =>
      whenFree(() => {
        if (blankNow()) show(t('3D 视图什么都没画出来'));
        else if (!lastModel) show(t('等了一分钟，模型还没显示出来'));
      }, true),
    60_000,
  );
}

/* ---------------- 卡片 ---------------- */

let card: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let detailEl: HTMLElement | null = null;
let dismissed = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function btn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** WebView / 浏览器内核版本：UA 里的 Chrome/xx */
function engine(): string {
  const ua = navigator.userAgent;
  const chrome = /Chrome\/([\d.]+)/.exec(ua)?.[1];
  const android = /Android ([\d.]+)/.exec(ua)?.[1];
  const wv = /; wv\)/.test(ua) || /Version\/[\d.]+ Chrome/.test(ua);
  return [android ? `Android ${android}` : '', chrome ? `${wv ? 'WebView' : 'Chrome'} ${chrome}` : ''].filter(Boolean).join(' · ') || ua;
}

function gpu(): string[] {
  if (!renderer) return [t('没有建起 WebGL')];
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const vendor = info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    return [
      `GPU: ${String(vendor)} / ${String(name)}`,
      `GL: ${String(gl.getParameter(gl.VERSION))} · ${String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION))}`,
      `MAX_TEXTURE_SIZE ${String(gl.getParameter(gl.MAX_TEXTURE_SIZE))} · lost ${gl.isContextLost() ? 'yes' : 'no'}`,
    ];
  } catch (err) {
    return [`GPU: ? (${err instanceof Error ? err.message : String(err)})`];
  }
}

/** 卡片上、复制出去的那一大段：设备、显卡、读画面的结果、出过的错 */
export function report(): string {
  const canvas = renderer?.domElement;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory;
  const status = document.getElementById('status')?.textContent?.trim();
  const lines = [
    engine(),
    ...gpu(),
    `CPU ${navigator.hardwareConcurrency ?? '?'}${mem ? ` · RAM ~${mem} GB` : ''} · ${screen.width}×${screen.height} @${devicePixelRatio}`,
    canvas ? `canvas ${canvas.width}×${canvas.height} (${canvas.clientWidth}×${canvas.clientHeight})` : 'canvas -',
    `${t('兼容模式')}: ${AUTO_SAFE ? 'auto' : SAFE_GL ? 'on' : 'off'}${read(TRIED_KEY) === '1' ? ' (tried)' : ''}`,
    lastProbe
      ? `${t('读画面')}: triangles ${lastProbe.triangles}, filled ${lastProbe.filled}/${lastProbe.sampled}, model ${lastModel ? 'yes' : 'no'}`
      : `${t('读画面')}: -`,
    status ? `${t('状态栏')}: ${status}` : '',
    problems.length ? `${t('出过的错')}:` : `${t('出过的错')}: -`,
    ...problems.map((p, i) => `${i + 1}. ${p}`),
    navigator.userAgent,
  ];
  return lines.filter(Boolean).join('\n');
}

function fill() {
  if (detailEl) detailEl.textContent = report();
}

async function copy(button: HTMLButtonElement) {
  const text = report();
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    // 旧 WebView 没有 clipboard：用隐藏的文本框选中再复制
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
  }
  button.textContent = ok ? t('已复制') : t('复制不了，请截图');
}

function build() {
  if (card) return;
  card = el('div', 'diag-card');
  card.setAttribute('role', 'alertdialog');
  const head = el('div', 'diag-head');
  titleEl = el('b', '');
  head.append(
    titleEl,
    btn('×', 'diag-close', () => {
      dismissed = true;
      if (card) card.hidden = true;
    }),
  );
  const tip = el(
    'p',
    'diag-tip',
    AUTO_SAFE
      ? t('刚才 3D 视图什么都没画出来，已经自动换成兼容模式重开过一次，还是不行。请把下面这段复制或截图发给作者。')
      : SAFE_GL
      ? t('兼容模式已经开着。把下面这段复制或截图发给作者；也可以关掉兼容模式重开。')
      : t('可能是这台手机的显卡或系统浏览器内核和 3D 显示不兼容。先点「用兼容模式重开」试试；还不行就把下面这段复制或截图发给作者。'),
  );
  detailEl = el('pre', 'diag-detail');
  const actions = el('div', 'diag-actions');
  const copyBtn = btn(t('复制'), 'btn', () => void copy(copyBtn));
  actions.append(
    copyBtn,
    btn(t('重新检查'), 'btn', () => {
      probe();
      fill();
    }),
    btn(SAFE_GL ? t('关掉兼容模式重开') : t('用兼容模式重开'), 'btn primary', () => setSafe(!SAFE_GL)),
  );
  card.append(head, tip, detailEl, actions);
  card.hidden = true;
  document.body.append(card);
}

/** 弹卡片。自动弹的：人关过一次就不再自动弹（「更多」里还能打开） */
function show(title: string, byHand = false) {
  if (!byHand && dismissed) return;
  build();
  if (!card || !titleEl) return;
  titleEl.textContent = title;
  fill();
  card.hidden = false;
}

/** 「更多」里那一行：看诊断、开关兼容模式 */
export function installDiagRow() {
  const header = document.querySelector('.panel-scroll > header');
  if (!header) return;
  const row = el('div', 'diag-row');
  row.append(
    btn(t('3D 显示诊断'), 'btn ghost', () => {
      probe();
      show(t('3D 显示诊断'), true);
    }),
  );
  const label = el('label', 'diag-safe');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = SAFE_GL;
  box.addEventListener('change', () => setSafe(box.checked));
  label.append(box, document.createTextNode(t('兼容模式（3D 视图空白时打开）')));
  row.append(label);
  const repo = header.querySelector('.repo');
  if (repo) repo.after(row);
  else header.append(row);
}
