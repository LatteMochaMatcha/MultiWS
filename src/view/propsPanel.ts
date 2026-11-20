/**
 * 道具的那一套界面（见 docs/props-plan.md）：「场景」栏里的「道具」一节，3D 视图里的道具、选中和操纵杆，
 * 还有道具自己的撤销历史。main.ts 只管接线：把场景里的道具清单交进来、收回去（PropsHost）。
 */
import * as THREE from 'three';
import { dropHeight } from '../geometry/propMesh';
import { t } from '../i18n';
import { History } from '../model/history';
import {
  PROP_COLOR,
  PROP_KINDS,
  type PropKind,
  type SceneProp,
  addProp,
  clampProp,
  copyProp,
  isPropKind,
  makeAssetProp,
  makeProp,
  poleIsFlat,
  propBaseSize,
  propOf,
  removeProp,
  sameProps,
  turnPole,
  updateProp,
} from '../model/props';
import { type Place, absolutePlace, relativePlace } from '../model/scene';
import type { Vec3 } from '../model/spec';
import { PROP_ASSETS, PROP_ASSET_GROUPS, type PropAssetGroup, REAL_ASSETS, realAsset } from '../props/catalog';
import { loadPropAssets, propAssetsReady, realAssetFile } from '../props/library';
import { loadKeptRealAssets, loadRealAsset, realState, watchRealAssets } from '../props/realLoad';
import { GIZMO_MODES, type GizmoMode } from './gizmo';
import { PropGizmo } from './propGizmo';
import { PROP_GROUP_LABEL, PROP_LABEL, propAssetLabel, propKindLabel, propLabel } from './propNames';
import { renderPropThumbs } from './propThumbs';
import { PropsModel } from './propsModel';
import type { Viewport } from './viewport';

export { propLabel };

export interface PropsHost {
  viewport: Viewport | null;
  /** 面板里放「道具」这一节的地方 */
  panel: HTMLElement;
  /** 工坊自己的文件从哪取（import.meta.env.BASE_URL）：素材的网格在 props/lowpoly.bin */
  base: string;
  /** 场景里现在的道具清单 */
  read(): readonly SceneProp[];
  /** 换成新的清单。live：正拖着，只换屏幕上的，等松手再存档；restored：是撤销、重做放回来的 */
  write(next: readonly SceneProp[], live: boolean, restored?: boolean): void;
  /** 当前角色在场景里站在哪（屏幕上它在原点） */
  here(): Place;
  /** 选中了一件道具：身体上选中的部件、关节该放掉了 */
  picked(id: string): void;
  /** 道具变了。step：记了新的一步撤销（不是并进上一步，也不是撤销、重做带来的） */
  edited(step: boolean): void;
  status(message: string, warn?: boolean): void;
  /** 连着这件道具的：谁的哪里（整个人跟着它的、手脚钉在它上面的） */
  links(prop: string): { figure: string; part: string; label: string }[];
  /** 解开一个连接 */
  unlink(figure: string, part: string): void;
  /** 当前角色叫什么（「让它跟着这件道具」的按钮上写）；它已经整个人跟着这件了返回 null */
  rideLabel(prop: string): string | null;
  /** 让当前角色整个人跟着这件道具 */
  ride(prop: string): void;
  /** 当前角色叫什么（一键动作那一行开头写「让「角色 1」」） */
  actor(): string;
  /** 当前角色能对这件道具做的一键动作：名字、说明；block 是现在做不了的原因（按钮变灰），能做是 null */
  actions(prop: string): { key: string; label: string; tip: string; block: string | null }[];
  /** 做一个一键动作 */
  act(prop: string, key: string): void;
  /** 把「道具」这一节亮出来（点中道具时） */
  reveal(): void;
  /** 镜头退到能看全整个场景（新放的道具落在画面外面时） */
  refit(): void;
  /** 一排单选按钮（main.ts 的 buildSeg） */
  seg<T extends string>(host: HTMLElement, options: readonly T[], label: (value: T) => string, onPick: (value: T) => void): (value: T, enabled: boolean) => void;
}

const PROP_TIP: Record<PropKind, string> = {
  pole: t('一根竖着的杆：能扶、能握，放倒了就是横杆'),
  box: t('一个方箱子：能坐、能踩、能靠'),
  stand: t('一个圆台子：圆凳、圆桌、垫脚的台'),
  ball: t('一个球：压扁、拉长都行'),
  wall: t('一面墙板：能靠、能撑，放平了就是地台、床板'),
};
/** 道具栏里「现成的家具」分的几组：低模的四组，清单里有写实款时再加一组 */
type TileGroup = PropAssetGroup | 'real';
const TILE_GROUPS: readonly TileGroup[] = REAL_ASSETS.length ? [...PROP_ASSET_GROUPS, 'real'] : PROP_ASSET_GROUPS;
const TILE_GROUP_LABEL: Record<TileGroup, string> = { ...PROP_GROUP_LABEL, real: t('写实款') };
/** 文件多大，写给人看 */
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
const GIZMO_LABEL: Record<GizmoMode, string> = { translate: t('移动'), rotate: t('旋转'), scale: t('缩放') };

/** 三行数字：位置、旋转、尺寸。scale：存的数乘多少显示（米 → 厘米） */
const FIELDS = [
  { key: 'pos', label: t('位置@@道具'), unit: 'cm', scale: 100, step: 1, digits: 1, axes: ['X', 'Y', 'Z'], tips: [t('左右'), t('离地多高'), t('前后')] },
  { key: 'rot', label: t('角度'), unit: '°', scale: 1, step: 1, digits: 1, axes: ['X', 'Y', 'Z'], tips: [t('前后倾'), t('朝向'), t('左右倾')] },
  { key: 'size', label: t('尺寸'), unit: 'cm', scale: 100, step: 1, digits: 1, axes: [t('宽'), t('高'), t('深')], tips: [t('宽'), t('高'), t('深')] },
] as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label: string, title: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  const btn = el('button', className, label);
  btn.type = 'button';
  if (title) btn.title = title;
  btn.addEventListener('click', onClick);
  return btn;
}

export class PropsPanel {
  private readonly view = new PropsModel();
  private readonly gizmo: PropGizmo | null = null;
  private selectedId: string | null = null;
  private mode: GizmoMode = 'translate';
  /** 道具自己的撤销历史：和每个角色的那几条分开 */
  private history: History<readonly SceneProp[]>;
  /** 正拖着操纵杆：拖动中只换屏幕上的，松手时记一步撤销、存档 */
  private dragFrom: readonly SceneProp[] | null = null;

  private readonly list = el('div', 'figure-list');
  private readonly body = el('div', 'tweak');
  private readonly nameBox = el('input');
  private readonly colorBox = el('input');
  private readonly colorField = el('div', 'field');
  /** 写实款才有的一节：刷成灰色；这台设备上还没下载时，下载的按钮 */
  private readonly realBox = el('div', 'field prop-real');
  /** 杆才有的「横过来 / 竖起来」 */
  private readonly turnBtn = button('', '', () => {
    const prop = this.selected;
    if (prop?.kind === 'pole') this.edit(turnPole(prop));
  });
  /** 「连着它的」：谁跟着这件道具、谁的手脚钉在上面 */
  private readonly linkBox = el('div', 'field prop-links');
  /** 一键动作：让当前角色坐上去、躺上去、撑着、扶着、靠着 */
  private readonly actBox = el('div', 'field prop-acts');
  private readonly rows: { field: (typeof FIELDS)[number]; inputs: HTMLInputElement[] }[] = [];
  private readonly syncMode: (value: GizmoMode, enabled: boolean) => void;
  /** 现成的家具：现在看的是哪一组，格子放在哪，小图（素材读进来以后现画的） */
  private group: TileGroup = 'seat';
  private readonly tiles = el('div', 'prop-tiles');
  private thumbs = new Map<string, string>();
  /** 素材的网格取到了、小图画过了、屏幕上顶着的方块换掉了 */
  private assetsShown = false;
  private readonly syncGroup: (value: TileGroup, enabled: boolean) => void;
  /** 场景里的写实款：这台设备上存没存过，已经看过的那几件（不用每次都去翻） */
  private readonly realSeen = new Set<string>();

  constructor(private readonly host: PropsHost) {
    this.history = new History<readonly SceneProp[]>(host.read(), { equals: sameProps });
    if (host.viewport) {
      host.viewport.scene.add(this.view.root);
      this.gizmo = new PropGizmo(host.viewport, this.view.root);
      this.gizmo.onDrag = (active) => this.dragging(active);
      this.gizmo.onChange = (patch) => {
        if (!this.selectedId) return;
        this.host.write(updateProp(this.host.read(), this.selectedId, patch), true);
        this.show(false);
      };
    }

    /* ---- 面板 ---- */
    const add = el('div', 'presets');
    for (const kind of PROP_KINDS) add.append(button(PROP_LABEL[kind], PROP_TIP[kind], () => this.add(kind)));
    const addField = el('div', 'field');
    addField.append(el('span', '', t('放一个')), add);

    const assetField = el('div', 'field');
    const groups = el('div', 'seg');
    groups.id = 'segPropGroup';
    groups.setAttribute('role', 'radiogroup');
    groups.setAttribute('aria-label', t('现成的家具分组'));
    assetField.append(el('span', '', t('现成的家具')), groups, this.tiles);
    this.syncGroup = host.seg(groups, TILE_GROUPS, (v) => TILE_GROUP_LABEL[v], (v) => {
      this.group = v;
      this.syncGroup(v, true);
      this.renderTiles();
    });

    this.body.hidden = true;
    const nameField = el('label', 'field');
    this.nameBox.className = 'prop-name';
    this.nameBox.maxLength = 40;
    this.nameBox.autocomplete = 'off';
    this.nameBox.spellcheck = false;
    this.nameBox.addEventListener('input', () => this.edit({ name: this.nameBox.value }, 'name'));
    this.nameBox.addEventListener('change', () => {
      this.history.seal();
      this.show(true);
    });
    nameField.append(el('span', '', t('名字')), this.nameBox);

    const modeField = el('div', 'field');
    const seg = el('div', 'seg');
    seg.id = 'segPropGizmo';
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', t('操纵杆的模式'));
    modeField.append(el('span', '', t('在场景里拖动')), seg);
    this.syncMode = host.seg(seg, GIZMO_MODES, (v) => GIZMO_LABEL[v], (v) => this.setMode(v));

    const triples = el('div', 'triples');
    for (const field of FIELDS) {
      const row = el('div', 'triple');
      const name = el('span', '', field.label);
      name.append(el('small', '', field.unit));
      row.append(name);
      const inputs = field.axes.map((axisName, axis) => {
        const wrap = el('label', '', axisName);
        wrap.title = field.tips[axis];
        const input = el('input');
        input.type = 'number';
        input.step = String(field.step);
        input.setAttribute('aria-label', `${field.label} ${field.tips[axis]}`);
        input.addEventListener('input', () => {
          const prop = this.selected;
          if (!prop || input.value.trim() === '') return;
          const v = Number(input.value);
          if (!Number.isFinite(v)) return;
          // 尺寸是一个字一个字敲出来的：敲到一半的「0」不算数
          if (field.key === 'size' && v <= 0) return;
          const next: Vec3 = [...prop[field.key]];
          next[axis] = v / field.scale;
          this.edit({ [field.key]: next }, `${field.key}:${axis}`);
        });
        // 输完以后把显示整理一遍（超出范围的数会被收回来）；下一次再改这一格另算一步撤销
        input.addEventListener('change', () => {
          this.history.seal();
          this.show(true);
        });
        wrap.append(input);
        row.append(wrap);
        return input;
      });
      triples.append(row);
      this.rows.push({ field, inputs });
    }

    const colorField = this.colorField;
    const dye = el('div', 'dye');
    const pick = el('label', 'pick');
    pick.title = t('自己挑一个颜色');
    this.colorBox.type = 'color';
    this.colorBox.setAttribute('aria-label', t('道具的颜色'));
    this.colorBox.addEventListener('input', () => this.edit({ color: this.colorBox.value }, 'color'));
    this.colorBox.addEventListener('change', () => this.history.seal());
    pick.append(this.colorBox, el('span', '', t('自选')));
    dye.append(pick, button(t('恢复灰色'), t('换回白模的灰色'), () => this.edit({ color: PROP_COLOR }), 'btn ghost'));
    colorField.append(el('span', '', t('颜色')), dye);

    const actions = el('div', 'actions');
    actions.append(
      button(t('落到下面'), t('竖直落下去：落到地面，或者正下方别的道具上（箱子叠箱子、东西放到台面上）'), () => this.drop()),
      button(t('摆正'), t('倾斜归零，立正；朝哪边不变'), () => {
        const prop = this.selected;
        if (prop) this.edit({ rot: [0, prop.rot[1], 0] });
      }),
      this.turnBtn,
      button(t('原来的尺寸'), t('宽、高、深都变回刚放下时的大小'), () => {
        const prop = this.selected;
        if (prop) this.edit({ size: propBaseSize(prop) });
      }),
      button(t('复制一份'), t('照选中的道具再做一个，放在它旁边'), () => this.copy()),
      button(t('删除这件道具'), t('从场景里拿掉；点撤销能放回来'), () => this.remove()),
      button(t('取消选择'), '', () => this.select(null)),
    );
    this.body.append(nameField, modeField, triples, this.realBox, colorField, this.actBox, this.linkBox, actions);

    const note = el(
      'p',
      'note',
      t(
        '道具是给姿势当依托的：坐的、扶的、靠的、踩的。它归整个场景，不跟着哪个角色；「保存场景」会带上，「保存配置」不带。在 3D 视图里点一件道具就选中它，拖箭头挪、拖圆环转、拖方块改大小（按住 Shift 每 5 cm、每 15° 一档；键盘 W 移动、E 旋转、R 缩放，Delete 删除）。撤销、重做和角色的改动排在一起，照先后顺序来。',
      ),
    );
    host.panel.append(addField, assetField, this.list, this.body, note);
    this.syncMode(this.mode, true);
    this.syncGroup(this.group, true);
    this.renderTiles();
    this.refresh();
    // 素材的网格一开始就去取（一百多 KB）：取到了画小图，场景里已经有的素材道具从方块换成真的样子
    this.loadAssets().catch(() => {});
    // 写实款开始下、下了一截、下完：格子上的字跟着换，屏幕上顶着的方块换成真的样子
    watchRealAssets(() => {
      if (this.group === 'real') this.renderTiles();
      this.show(false);
      const prop = this.selected;
      if (!prop) return;
      this.renderReal(prop);
      this.renderActions(prop);
    });
  }

  /* ---------------- 给 main.ts 用的 ---------------- */

  get selected(): SceneProp | undefined {
    return propOf(this.host.read(), this.selectedId);
  }

  /** 正拖着操纵杆，或者光标正指着它 */
  get busy(): boolean {
    return this.gizmo?.busy ?? false;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** 全部道具占的盒子（屏幕上的坐标）；一件都没有是空的 */
  box(): THREE.Box3 {
    return this.view.box();
  }

  /** 场景变了（切了当前角色、角色挪了位置、读了存档）：屏幕上、面板上都跟上 */
  refresh() {
    if (this.selectedId && !this.selected) this.selectedId = null;
    this.view.setOrigin(this.host.here());
    this.show(true);
    this.renderList();
    void this.wakeReal();
  }

  /** 场景里用到的写实款：这台设备上存过的读进来（不联网）；没存过的先用方块顶着，说一声 */
  private async wakeReal() {
    const ids = this.host.read().flatMap((p) => (p.kind === 'asset' && p.asset && realAsset(p.asset) && !realAssetFile(p.asset) && !this.realSeen.has(p.asset) ? [p.asset] : []));
    if (!ids.length) return;
    for (const id of ids) this.realSeen.add(id);
    const missing = await loadKeptRealAssets(ids);
    this.show(true);
    if (this.group === 'real') this.renderTiles();
    if (missing.length) this.host.status(t('场景里有 {n} 件写实款这台设备上还没下载，先用方块顶着：选中它，点「下载」。', { n: missing.length }), true);
  }

  /** 当前角色的身体变了（加了腿、没了手臂）：一键动作哪些能点跟着变 */
  syncActions() {
    const prop = this.selected;
    if (prop) this.renderActions(prop);
  }

  /** 当前角色挪了位置（拖着底座圈的每一下）：只把屏幕上的道具和操纵杆挪过去，面板不动 */
  follow() {
    this.view.setOrigin(this.host.here());
    this.gizmo?.sync(this.selected ?? null);
  }

  /** 道具这一条撤销历史现在这一步的记号（AI 助手核对「这一轮之后有没有人改过」用） */
  get stamp(): object {
    return this.history.current;
  }

  /**
   * 不经过面板放一件（AI 助手用）：kind 是基本体的种类或家具的编号；change 里给了的位置、角度、尺寸、颜色、名字照它来，
   * 没给位置的放在当前角色旁边的空地上（lift：离地多高）。size 里的 NaN 是照默认的。放不了抛出原因
   */
  async create(kind: string, change: Partial<Pick<SceneProp, 'pos' | 'rot' | 'size' | 'color' | 'name'>> & { lift?: number } = {}): Promise<SceneProp> {
    const zero = { x: 0, z: 0, yaw: 0 };
    let make: (at: { x: number; z: number; yaw: number }) => SceneProp | null;
    if (isPropKind(kind)) make = (at) => makeProp(this.host.read(), kind, at);
    else {
      if (realAsset(kind)) {
        // 写实款：这台设备上没有就先下（联网没取到会抛出原因）
        if (!realAssetFile(kind)) await loadRealAsset(kind);
      } else if (PROP_ASSETS.some((a) => a.id === kind)) await this.loadAssets();
      else throw new Error(t('没有「{kind}」这种道具', { kind }));
      make = (at) => makeAssetProp(this.host.read(), kind, at);
    }
    const fresh = make(zero);
    if (!fresh) throw new Error(t('没有「{kind}」这种道具', { kind }));
    const size = (change.size ? change.size.map((v, i) => (Number.isFinite(v) ? v : fresh.size[i])) : fresh.size) as Vec3;
    const base = make(this.spot(kind === 'wall', size))!;
    const { lift, ...rest } = change;
    this.place(clampProp({ ...base, ...rest, size, pos: change.pos ?? [base.pos[0], lift ?? base.pos[1], base.pos[2]] }));
    return this.selected!;
  }

  /** 改一件（不用先选中）：没有这件返回 null */
  change(id: string, patch: Partial<Pick<SceneProp, 'pos' | 'rot' | 'size' | 'color' | 'name'>>): SceneProp | null {
    const was = propOf(this.host.read(), id);
    if (!was) return null;
    const size = patch.size ? (patch.size.map((v, i) => (Number.isFinite(v) ? v : was.size[i])) as Vec3) : undefined;
    this.history.seal();
    this.commit(updateProp(this.host.read(), id, { ...patch, ...(size ? { size } : {}) }));
    this.history.seal();
    return propOf(this.host.read(), id) ?? null;
  }

  /** 删一件（不用先选中） */
  discard(id: string): boolean {
    if (!propOf(this.host.read(), id)) return false;
    this.history.seal();
    if (this.selectedId === id) this.selectedId = null;
    this.commit(removeProp(this.host.read(), id));
    this.show(true);
    return true;
  }

  /** 一次放进几件摆好了的道具（载入带道具的姿势时）：记成一步撤销 */
  insert(items: readonly SceneProp[]) {
    if (!items.length) return;
    this.history.seal();
    this.commit(items.reduce((list, prop) => addProp(list, prop), this.host.read()));
    this.history.seal();
    if (items.some((p) => p.kind === 'asset' && !realAsset(p.asset))) void this.loadAssets().catch(() => undefined);
    void this.wakeReal();
  }

  /** 整个场景换了一份（打开场景文件）：撤销历史从头开始 */
  reset() {
    this.selectedId = null;
    this.history = new History<readonly SceneProp[]>(this.host.read(), { equals: sameProps });
    this.refresh();
  }

  /** 选中一件（null 是都不选） */
  select(id: string | null) {
    const next = id && propOf(this.host.read(), id) ? id : null;
    if (next === this.selectedId) return;
    this.selectedId = next;
    if (next) this.host.picked(next);
    this.show(true);
    this.renderList();
  }

  /**
   * 在 3D 视图里点了一下。nearest：这条线上离镜头最近的角色有多远（没点中是 Infinity）。
   * 返回 true 是这一下归道具了（点中了道具，或者点在操纵杆上）：别的点选不用再管
   */
  click(ray: THREE.Raycaster, nearest: number): boolean {
    if (this.busy) return true;
    const hit = this.view.hit(ray);
    if (hit && hit.distance < nearest) {
      this.select(hit.id);
      this.host.reveal();
      // 「道具」这一节在那一栏的下半截：把选中那一件的几格数字滚到看得见的地方
      this.body.scrollIntoView({ block: 'nearest' });
      return true;
    }
    this.select(null);
    return false;
  }

  /** 键盘：选中道具时 W / E / R 换操纵杆、Delete 删除、Esc 取消选择。返回是不是用掉了这个键 */
  key(e: KeyboardEvent): boolean {
    if (!this.selectedId) return false;
    const k = e.key.toLowerCase();
    if (k === 'escape') this.select(null);
    else if (k === 'delete' || k === 'backspace') this.remove();
    else if (k === 'w') this.setMode('translate');
    else if (k === 'e') this.setMode('rotate');
    else if (k === 'r') this.setMode('scale');
    else return false;
    return true;
  }

  undo(): boolean {
    return this.restore(this.history.undo());
  }

  redo(): boolean {
    return this.restore(this.history.redo());
  }

  /* ---------------- 里面的 ---------------- */

  private restore(state: readonly SceneProp[] | null): boolean {
    if (!state) return false;
    this.host.write(state, false, true);
    this.host.edited(false);
    this.refresh();
    return true;
  }

  /** 清单改完了：存档、记一步撤销、刷新。key 相同的连续修改（连着敲数字、拖颜色）合并成一步 */
  private commit(next: readonly SceneProp[], key?: string) {
    this.host.write(next, false);
    const steps = this.history.steps;
    this.history.push(next, key);
    this.host.edited(this.history.steps > steps);
    this.show(false);
    // 转了、改了尺寸：哪些一键动作能做跟着变（歪了要先摆正、杆横过来才能吊）
    const prop = this.selected;
    if (prop) this.renderActions(prop);
    this.renderList();
  }

  private edit(patch: Partial<Omit<SceneProp, 'id' | 'kind' | 'asset'>>, key?: string) {
    if (!this.selectedId) return;
    this.commit(updateProp(this.host.read(), this.selectedId, patch), key && `${this.selectedId}:${key}`);
  }

  /** 操纵杆开始拖 / 松手 */
  private dragging(active: boolean) {
    if (active) {
      this.dragFrom = this.host.read();
      return;
    }
    const from = this.dragFrom;
    this.dragFrom = null;
    const now = this.host.read();
    if (!from || sameProps(from, now)) return this.show(true);
    this.history.seal();
    this.commit(now);
    this.show(true);
  }

  private setMode(mode: GizmoMode) {
    this.mode = mode;
    this.gizmo?.setMode(mode);
    this.syncMode(mode, true);
    this.show(false);
  }

  /** 新放的道具在哪：当前角色的左手边（屏幕上正面看是左边），墙板放在身后；那里已经有道具了就再往外挪 */
  private spot(wall: boolean, size: Vec3): { x: number; z: number; yaw: number } {
    const here = this.host.here();
    // 已经有的道具各在当前角色看来的哪里、从上往下看占多宽（转过的照宽的那一边算）
    const taken = this.host.read().map((p) => {
      const at = relativePlace(here, { x: p.pos[0], z: p.pos[2], yaw: 0 });
      return { x: at.x, z: at.z, half: Math.max(p.size[0], p.size[2]) / 2 };
    });
    const gap = 0.1;
    const local = wall ? { x: 0, z: -0.6, yaw: 0 } : { x: -(0.55 + size[0] / 2), z: 0, yaw: 0 };
    const [mine, step] = wall ? ([size[2] / 2, 'z'] as const) : ([size[0] / 2, 'x'] as const);
    const side = step === 'x' ? 'z' : 'x';
    const reach = (step === 'x' ? size[2] : size[0]) / 2;
    for (let i = 0; i < 40; i++) {
      // 挡在这个位置上的：同一排（另一个方向上挨着）、这个方向上又叠在一起
      const block = taken.find((o) => Math.abs(o[side] - local[side]) < reach + o.half && Math.abs(o[step] - local[step]) < mine + o.half + gap - 1e-6);
      if (!block) break;
      local[step] = block[step] - (block.half + mine + gap);
    }
    return absolutePlace(here, local);
  }

  private add(kind: PropKind) {
    const props = this.host.read();
    const fresh = makeProp(props, kind, { x: 0, z: 0, yaw: 0 });
    this.place(makeProp(props, kind, this.spot(kind === 'wall', fresh.size)));
  }

  /** 放一件现成的家具。素材的网格还没取到就先取（取不到就不放，说一声） */
  private async addAsset(id: string) {
    if (realAsset(id)) {
      // 写实款：这台设备上没有就先下；正在下的时候再点同一件不重复放
      if (realState(id).state === 'loading') return this.host.status(t('「{name}」还在下载，下完会自己放进场景。', { name: propAssetLabel(id) || id }));
      if (!(await this.fetchReal(id))) return;
    } else {
      try {
        await this.loadAssets();
      } catch (error) {
        this.host.status(error instanceof Error ? error.message : String(error), true);
        return;
      }
    }
    const props = this.host.read();
    const fresh = makeAssetProp(props, id, { x: 0, z: 0, yaw: 0 });
    if (!fresh) return;
    const prop = makeAssetProp(props, id, this.spot(false, fresh.size));
    if (prop) this.place(prop);
  }

  /** 把一件写实款取到手（本机存过就不联网）。没取到说明原因，返回 false */
  private async fetchReal(id: string): Promise<boolean> {
    const entry = realAsset(id);
    if (!entry) return false;
    if (realAssetFile(id)) return true;
    const name = propAssetLabel(id) || id;
    this.host.status(t('正在取「{name}」（{size}）…', { name, size: megabytes(entry.bytes) }));
    try {
      await loadRealAsset(id);
    } catch (error) {
      this.host.status(error instanceof Error ? error.message : String(error), true);
      return false;
    }
    this.host.status(t('「{name}」取到了，存在这台设备上，下次不用再下。', { name }));
    return true;
  }

  /** 新做好的一件放进场景、选中它 */
  private place(prop: SceneProp) {
    const props = this.host.read();
    this.history.seal();
    this.selectedId = prop.id;
    this.host.picked(prop.id);
    this.commit(addProp(props, prop));
    this.show(true);
    if (!this.inView(this.view.boxOf(prop.id))) this.host.refit();
    this.host.status(
      realAsset(prop.asset)
        ? t('放了一件{kind}。在 3D 视图里拖箭头挪它，面板里能改尺寸；勾上「刷成灰色」就和别的道具一样能挑颜色。', { kind: propKindLabel(prop) })
        : t('放了一个{kind}。在 3D 视图里拖箭头挪它，面板里能改尺寸、颜色。', { kind: propKindLabel(prop) }),
    );
  }

  /** 取素材的网格；取到以后画小图、把屏幕上顶着的方块换掉 */
  private async loadAssets() {
    if (this.assetsShown) return;
    await loadPropAssets(this.host.base);
    if (this.assetsShown || !propAssetsReady()) return;
    this.assetsShown = true;
    this.thumbs = renderPropThumbs();
    this.renderTiles();
    this.show(false);
  }

  /** 「现成的家具」那几格：只摆现在这一组的 */
  private renderTiles() {
    if (this.group === 'real') return this.renderRealTiles();
    const tiles = PROP_ASSETS.filter((a) => a.group === this.group).map((asset) => {
      const label = propAssetLabel(asset.id) || asset.id;
      const size = asset.size.map((v) => Math.round(v * 100)).join(' × ');
      const tile = button('', t('放一件{name}（{size} 厘米）', { name: label, size }), () => void this.addAsset(asset.id), 'prop-tile');
      const thumb = this.thumbs.get(asset.id);
      if (thumb) {
        const img = el('img');
        img.src = thumb;
        img.alt = '';
        tile.append(img);
      }
      tile.append(el('span', '', label));
      return tile;
    });
    this.tiles.replaceChildren(...tiles);
  }

  /** 「写实款」那几格：小图是随安装包带的，网格和贴图点了才下；没下的写着要下多大，正在下的写着下了几成 */
  private renderRealTiles() {
    const tiles = REAL_ASSETS.map((asset) => {
      const label = propAssetLabel(asset.id) || asset.id;
      const size = asset.size.map((v) => Math.round(v * 100)).join(' × ');
      const state = realState(asset.id);
      const tip =
        state.state === 'ready'
          ? t('放一件{name}（{size} 厘米）', { name: label, size })
          : t('下载并放一件{name}（{size} 厘米；要下 {bytes}，只下这一次）', { name: label, size, bytes: megabytes(asset.bytes) });
      const tile = button('', tip, () => void this.addAsset(asset.id), 'prop-tile');
      const img = el('img');
      img.src = `${this.host.base}props/real/${asset.id}.webp`;
      img.alt = '';
      tile.append(img, el('span', '', label));
      if (state.state === 'loading') tile.append(el('small', '', `${Math.round(state.done * 100)}%`));
      else if (state.state === 'none') tile.append(el('small', '', `↓ ${megabytes(asset.bytes)}`));
      return tile;
    });
    const note = el('p', 'note', t('写实款带贴图，不在安装包里：点哪件才下载哪件，下过的留在这台设备上，之后不联网也能用。'));
    this.tiles.replaceChildren(...tiles, note);
  }

  /** 选中的是写实款时的那一节：刷成灰色的开关；这台设备上还没有它的文件时说一声、给个下载的按钮 */
  private renderReal(prop: SceneProp) {
    const entry = realAsset(prop.asset);
    this.realBox.hidden = !entry;
    // 带着贴图时颜色用不上：刷成灰色以后才能挑
    this.colorField.hidden = Boolean(entry) && !prop.gray;
    if (!entry) return;
    const check = el('label', 'check');
    check.title = t('不用它自己的贴图，和别的道具一样刷成一个颜色；导出的文件里也是');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = Boolean(prop.gray);
    box.addEventListener('change', () => {
      this.history.seal();
      this.edit({ gray: box.checked ? true : undefined });
      this.history.seal();
      this.show(true);
    });
    check.append(box, ` ${t('刷成灰色')}`);
    const nodes: HTMLElement[] = [check];
    if (!realAssetFile(entry.id)) {
      const state = realState(entry.id);
      const row = el('div', 'link-row');
      if (state.state === 'loading') row.append(el('span', '', t('正在下载… {percent}%', { percent: Math.round(state.done * 100) })));
      else
        row.append(
          el('span', '', t('这台设备上还没有这件的文件，先用方块顶着')),
          button(t('下载（{size}）', { size: megabytes(entry.bytes) }), t('从下载站取这一件，只下这一次'), () => void this.fetchReal(entry.id)),
        );
      nodes.push(row);
    }
    this.realBox.replaceChildren(el('span', '', t('写实款')), ...nodes);
  }

  /** 这个盒子是不是整个在画面里 */
  private inView(box: THREE.Box3): boolean {
    const camera = this.host.viewport?.camera;
    if (!camera || box.isEmpty()) return true;
    camera.updateMatrixWorld();
    const p = new THREE.Vector3();
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          p.set(x, y, z).project(camera);
          if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1) return false;
        }
      }
    }
    return true;
  }

  private copy() {
    const prop = this.selected;
    if (!prop) return;
    // 往它自己的右边挪一个身位
    const yaw = (prop.rot[1] * Math.PI) / 180;
    const step = prop.size[0] + 0.1;
    const { props, id } = copyProp(this.host.read(), prop.id, { x: Math.cos(yaw) * step, z: -Math.sin(yaw) * step });
    if (!id) return;
    this.history.seal();
    this.selectedId = id;
    this.commit(props);
    this.show(true);
    if (!this.inView(this.view.boxOf(id))) this.host.refit();
    this.host.status(t('复制了一份「{name}」，放在它旁边。', { name: propLabel(prop) }));
  }

  private remove() {
    const prop = this.selected;
    if (!prop) return;
    this.history.seal();
    this.selectedId = null;
    this.commit(removeProp(this.host.read(), prop.id));
    this.show(true);
    this.host.status(t('删掉了「{name}」。点撤销能放回来。', { name: propLabel(prop) }));
  }

  private drop() {
    const prop = this.selected;
    if (!prop) return;
    const y = dropHeight(prop, this.host.read());
    if (Math.abs(y - prop.pos[1]) < 0.0005) return this.host.status(t('「{name}」已经落在下面的东西上了。', { name: propLabel(prop) }));
    this.history.seal();
    this.edit({ pos: [prop.pos[0], y, prop.pos[2]] });
    this.host.status(y > 0.0005 ? t('「{name}」落到了下面的道具上。', { name: propLabel(prop) }) : t('「{name}」落到了地面上。', { name: propLabel(prop) }));
  }

  /** 屏幕上的道具、操纵杆、选中那一件的几格数字跟上现在的清单。force：正在输入的那一格也照样换 */
  private show(force: boolean) {
    const props = this.host.read();
    const prop = this.selected ?? null;
    this.view.sync(props, this.selectedId);
    this.gizmo?.sync(prop);
    this.body.hidden = !prop;
    if (!prop) return;
    if (force) {
      this.renderReal(prop);
      this.renderActions(prop);
      this.renderLinks(prop);
    }
    if (force || document.activeElement !== this.nameBox) this.nameBox.value = prop.name;
    this.nameBox.placeholder = propLabel({ ...prop, name: '' });
    if (this.colorBox.value !== prop.color) this.colorBox.value = prop.color;
    for (const { field, inputs } of this.rows) {
      inputs.forEach((input, axis) => {
        if (!force && document.activeElement === input) return;
        const k = 10 ** field.digits;
        input.value = String(Math.round(prop[field.key][axis] * field.scale * k) / k);
      });
    }
  }

  /** 一键动作那一排按钮：做不了的是灰的，原因写在提示里。杆的「横过来 / 竖起来」也在这里跟着换 */
  private renderActions(prop: SceneProp) {
    this.turnBtn.hidden = prop.kind !== 'pole';
    if (prop.kind === 'pole') {
      const flat = poleIsFlat(prop);
      this.turnBtn.textContent = flat ? t('竖起来') : t('横过来');
      this.turnBtn.title = flat ? t('把杆竖回去，立在地面上') : t('把杆转成横的、抬到 2.1 米高：角色能吊在上面（一键动作「吊着」）');
    }
    const row = el('div', 'presets');
    for (const action of this.host.actions(prop.id)) {
      const btn = button(action.label, action.block ?? action.tip, () => this.host.act(prop.id, action.key));
      btn.disabled = Boolean(action.block);
      btn.dataset.act = action.key;
      row.append(btn);
    }
    this.actBox.replaceChildren(el('span', '', t('让「{name}」', { name: this.host.actor() })), row);
  }

  /** 「连着它的」那几行：每个连接一行，能单独解开；下面是「让当前角色跟着它」 */
  private renderLinks(prop: SceneProp) {
    const rows = this.host.links(prop.id).map((link) => {
      const row = el('div', 'link-row');
      const off = button(t('解开'), t('解开以后，挪这件道具它不再跟着'), () => this.host.unlink(link.figure, link.part));
      row.append(el('span', '', link.label), off);
      return row;
    });
    const who = this.host.rideLabel(prop.id);
    const ride = who
      ? button(t('让「{name}」跟着它', { name: who }), t('坐着、躺着、站在这件道具上时用：挪它、转它，整个人跟着走。只让一只手、一只脚跟着：在「摆姿势」里点中那只手脚，再点「钉在…上」'), () =>
          this.host.ride(prop.id),
        )
      : null;
    this.linkBox.replaceChildren(el('span', '', t('连着它的')), ...rows, ...(ride ? [ride] : []));
  }

  private renderList() {
    const props = this.host.read();
    const rows = props.map((prop) => {
      const on = prop.id === this.selectedId;
      const row = el('div', on ? 'figure-row prop-row on' : 'figure-row prop-row');
      const pick = el('button', 'figure-pick');
      pick.type = 'button';
      pick.title = on ? t('现在选中的就是它') : t('选中它');
      pick.setAttribute('aria-pressed', String(on));
      pick.addEventListener('click', () => this.select(on ? null : prop.id));
      pick.append(el('span', 'figure-name', propLabel(prop)), el('span', 'figure-style', propKindLabel(prop)));
      const del = button('✕', t('删掉这件道具'), () => {
        this.selectedId = prop.id;
        this.remove();
      }, 'icon');
      del.setAttribute('aria-label', del.title);
      row.append(pick, del);
      return row;
    });
    this.list.replaceChildren(...rows);
    this.list.hidden = !rows.length;
  }
}
