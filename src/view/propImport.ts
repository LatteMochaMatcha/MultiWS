/**
 * 导入自己的素材的那个框（见 docs/import-plan.md）：读文件、预览、定大小和朝向、起名字、选分类，
 * 点「导入」以后转成工坊的素材文件、画小图、存到这台设备上。
 */
import { t } from '../i18n';
import type { Vec3 } from '../model/spec';
import { PROP_ASSET_GROUPS, type PropAssetGroup, type UserAsset } from '../props/catalog';
import type { ImportEntry } from '../props/importBundle';
import { readImportFbx } from '../props/importFbx';
import { type ImportFiles, type ImportSource, type ImportUnit, buildImport, guessUnit, importExtent } from '../props/importMesh';
import { importKind, readImportFile } from '../props/importShape';
import { type RealAssetFile, type RealTexture, encodeRealAsset } from '../props/realFile';
import { addUserAsset, userAssetId } from '../props/userStore';
import { PROP_GROUP_LABEL } from './propNames';
import { renderAssetImage } from './propThumbs';

/** 导入以后最长的一边在这个范围里（米）：和道具能设的尺寸一样 */
const LONGEST: readonly [number, number] = [0.01, 10];
/** 预览图一边多少像素 */
const PREVIEW = 360;
/** 贴图最长的一边超过这么多像素就缩到这么多（省地方，手机上也带得动） */
const TEXTURE_MAX = 2048;
/** 文件、面数超过这么多先问一句（会卡，手机上可能带不动） */
const BIG_BYTES = 50 * 1048576;
const BIG_FACES = 200_000;
const NAME_MAX = 40;

const UNIT_NOTE: Record<ImportUnit, string> = {
  m: '',
  cm: t('文件里的数看着是厘米，已经换成米。不对的话改下面的大小。'),
  mm: t('文件里的数看着是毫米，已经换成米。不对的话改下面的大小。'),
  fit: t('看不出文件用的是什么单位，先缩放到半米。照实际的大小改下面的数。'),
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * 贴图收拾一遍：不是 JPG、PNG 的（WebP）转成 PNG（导出的文件别的软件才认），太大的缩到 TEXTURE_MAX。
 * 解不开的那张不要了
 */
async function plainTextures(source: ImportSource): Promise<void> {
  let shrunk = 0;
  for (const [i, texture] of source.textures.entries()) {
    const fixed = await tidyTexture(texture);
    if (fixed) {
      if (fixed.shrunk) shrunk++;
      source.textures[i] = fixed.texture;
      continue;
    }
    for (const m of source.materials) {
      if (m.map === i) delete m.map;
      if (m.normal === i) delete m.normal;
      if (m.arm === i) {
        delete m.arm;
        delete m.ao;
      }
    }
    const note = t('有的贴图是工坊不认的格式，没带上');
    if (!source.notes.includes(note)) source.notes.push(note);
  }
  if (shrunk) source.notes.push(t('有 {n} 张贴图太大，缩到了 {max} 像素', { n: shrunk, max: TEXTURE_MAX }));
}

/** 一张贴图收拾好的样子：不用动的原样返回；解不开返回 null */
function tidyTexture(texture: RealTexture): Promise<{ texture: RealTexture; shrunk: boolean } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([texture.bytes as Uint8Array<ArrayBuffer>], { type: texture.mime }));
    const image = new Image();
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const longest = Math.max(image.naturalWidth, image.naturalHeight);
        const plain = texture.mime === 'image/jpeg' || texture.mime === 'image/png';
        if (!(longest > 0)) return resolve(null);
        if (plain && longest <= TEXTURE_MAX) return resolve({ texture, shrunk: false });
        const k = Math.min(1, TEXTURE_MAX / longest);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * k));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * k));
        canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
        // 照片那种（JPG）还存成 JPG，别的存成 PNG（带透明的不丢）
        const mime = texture.mime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
        canvas.toBlob(
          (blob) => {
            if (!blob) return resolve(null);
            void blob.arrayBuffer().then((bytes) => resolve({ texture: { mime, bytes: new Uint8Array(bytes) }, shrunk: k < 1 }));
          },
          mime,
          0.9,
        );
      } catch {
        resolve(null);
      }
    };
    image.src = url;
  });
}

/** 文件名去掉后缀，当默认的名字 */
const baseName = (file: string) =>
  file
    .replace(/\.[^.]*$/, '')
    .replace(/[_\s]+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);

export interface ImportOutcome {
  asset: UserAsset;
  /** 存到这台设备上了没有（没存上这一次照样能用） */
  kept: boolean;
  /** 是这一次新导入的；false 是这个文件以前导入过、文件还在，直接用的原来那一件 */
  fresh: boolean;
}

export interface ImportHints {
  /** 场景里已经有几件在等这个文件（存档里用了它、这台设备上没有） */
  waiting?: (id: string) => number;
  /** 这个文件以前导入过、文件还在的话，它在「我的」里的那一条（那就不用再问一遍了） */
  known?: (id: string) => Promise<UserAsset | null>;
  /** 问一句「要不要」（文件很大时）；不给就不问 */
  confirm?: (message: string, ok: string) => Promise<boolean>;
}

/**
 * 导入一个模型文件（GLB、glTF、OBJ、STL、FBX）：出导入框，用户点了「导入」返回导进来的那一件，点了取消返回 null。
 * files 是和它一起选的别的文件（.bin、.mtl、贴图），只选了它一个就不给。读不了的抛出原因。
 * 编号只看模型文件自己：同一个模型，贴图带没带上都是同一件
 */
export async function importPropFile(main: ImportEntry, files: ImportFiles | null, hints: ImportHints = {}): Promise<ImportOutcome | null> {
  const fileName = main.path.split('/').pop() ?? main.path;
  const kind = importKind(fileName);
  if (!kind) throw new Error(t('没找到能导入的模型文件：认 GLB、glTF、OBJ、STL、FBX，和装着它们的 zip 包'));
  const bytes = main.bytes.buffer.slice(main.bytes.byteOffset, main.bytes.byteOffset + main.bytes.byteLength) as ArrayBuffer;
  const id = await userAssetId(bytes);
  const had = await hints.known?.(id);
  if (had) return { asset: had, kept: true, fresh: false };
  const source = kind === 'fbx' ? await readImportFbx(bytes, files) : readImportFile(kind, bytes, files);
  if (hints.confirm && (bytes.byteLength > BIG_BYTES || source.faceMaterial.length > BIG_FACES)) {
    const sure = await hints.confirm(
      t('这个文件很大（{mb} MB，{n} 万个面）：导进来拖动时会卡，手机上可能带不动。还要导吗？', {
        mb: (bytes.byteLength / 1048576).toFixed(1),
        n: (source.faceMaterial.length / 10000).toFixed(1),
      }),
      t('照样导入'),
    );
    if (!sure) return null;
  }
  await plainTextures(source);

  // STL 是给打印机用的，差不多都是 Z 朝上：先替用户转正
  const state = { upright: kind === 'stl' ? 1 : 0, yaw: 0, scale: 1, name: baseName(fileName) || t('导入的素材'), group: 'other' as PropAssetGroup };
  const longest = Math.max(...importExtent(source, state.upright, state.yaw));
  // 文件自己写着单位（FBX）、照它算出来的大小也像样：信它；不然照大小猜
  const stated = source.unit && longest * source.unit >= 0.02 && longest * source.unit <= LONGEST[1] ? source.unit : 0;
  const first: { scale: number; unit: ImportUnit } = stated ? { scale: stated, unit: 'm' } : guessUnit(longest);
  state.scale = first.scale;

  const dialog = el('dialog', 'vrm-dialog prop-import');
  const form = el('form');
  form.method = 'dialog';
  form.addEventListener('submit', (e) => e.preventDefault());
  const title = el('h2', '', t('导入素材'));
  const stage = el('div', 'prop-import-stage');
  const image = el('img');
  image.alt = t('预览');
  const busy = el('span', 'note', t('正在算…'));
  stage.append(image, busy);

  const turns = el('div', 'actions');
  const flip = el('button', 'btn', t('转正'));
  flip.type = 'button';
  flip.title = t('模型躺着的时候点：往上翻 90°');
  const spin = el('button', 'btn', t('转 90°'));
  spin.type = 'button';
  spin.title = t('正面没朝前的时候点：绕竖直的轴转 90°');
  turns.append(flip, spin);

  const nameField = el('label', 'field');
  const nameBox = el('input');
  nameBox.maxLength = NAME_MAX;
  nameBox.autocomplete = 'off';
  nameBox.spellcheck = false;
  nameBox.value = state.name;
  nameField.append(el('span', '', t('名字')), nameBox);

  const groupField = el('label', 'field');
  groupField.title = t('选了「坐的」「躺的」「桌柜」，一键动作会照形状自己找坐面、床面、台面');
  const groupBox = el('select');
  for (const g of PROP_ASSET_GROUPS) {
    const option = el('option', '', PROP_GROUP_LABEL[g]);
    option.value = g;
    groupBox.append(option);
  }
  groupBox.value = state.group;
  groupField.append(el('span', '', t('分类')), groupBox);

  const sizeRow = el('div', 'triple');
  const sizeName = el('span', '', t('尺寸'));
  sizeName.append(el('small', '', 'cm'));
  sizeRow.append(sizeName);
  const sizeBoxes = [t('宽'), t('高'), t('深')].map((axis) => {
    const wrap = el('label', '', axis);
    const input = el('input');
    input.type = 'number';
    input.step = '1';
    input.min = '0';
    input.setAttribute('aria-label', `${t('尺寸')} ${axis}`);
    wrap.append(input);
    sizeRow.append(wrap);
    return input;
  });
  const sizeNote = el('p', 'note', t('三个数锁着比例：改一个，另两个跟着变。'));

  const notes = el('ul', 'note prop-import-notes');
  const waiting = hints.waiting?.(id) ?? 0;
  const lines = [
    ...(UNIT_NOTE[first.unit] ? [UNIT_NOTE[first.unit]] : []),
    ...(kind === 'stl' ? [t('STL 一般是竖的那根轴朝着自己，已经先转正了；不对就再点「转正」。')] : []),
    ...(source.plain && !source.notes.length ? [t('这种文件只有形状：放下来是一个颜色，能挑。')] : []),
    ...(waiting ? [t('场景里有 {n} 件在等这个文件：朝向照原来的选，大小不用管（照存档里的）。', { n: waiting })] : []),
    ...source.notes,
    t('{faces} 个面，{textures} 张贴图。文件存在这台设备上，不上传。', { faces: source.faceMaterial.length, textures: source.textures.length }),
  ];
  for (const line of lines) notes.append(el('li', '', line));

  const actions = el('div', 'actions');
  const cancel = el('button', 'btn', t('取消'));
  cancel.type = 'button';
  const ok = el('button', 'btn primary', t('导入'));
  ok.type = 'button';
  actions.append(cancel, ok);
  form.append(title, stage, turns, nameField, groupField, sizeRow, sizeNote, notes, actions);
  dialog.append(form);
  document.body.append(dialog);

  /** 现在这个朝向下占多大（文件自己的单位） */
  const extent = (): Vec3 => importExtent(source, state.upright, state.yaw);
  const clampScale = () => {
    const longest = Math.max(...extent());
    if (!(longest > 0)) return;
    state.scale = Math.max(LONGEST[0] / longest, Math.min(LONGEST[1] / longest, state.scale));
  };
  const showSize = (skip?: HTMLInputElement) => {
    const e = extent();
    sizeBoxes.forEach((input, k) => {
      if (input !== skip) input.value = String(Math.round(e[k] * state.scale * 1000) / 10);
    });
  };
  sizeBoxes.forEach((input, k) => {
    input.addEventListener('input', () => {
      const v = Number(input.value);
      const e = extent()[k];
      if (!(v > 0) || !(e > 0)) return;
      state.scale = v / 100 / e;
      showSize(input);
    });
    input.addEventListener('change', () => {
      clampScale();
      showSize();
    });
  });

  const build = (): RealAssetFile => buildImport(source, { id, scale: state.scale, upright: state.upright, yaw: state.yaw });
  let drawing = 0;
  const preview = async () => {
    const mine = ++drawing;
    busy.hidden = false;
    // 让「正在算…」先画出来
    await new Promise((resolve) => setTimeout(resolve, 0));
    let url = '';
    try {
      url = await renderAssetImage(build(), PREVIEW);
    } catch {
      // 预览画不出来不拦着导入
    }
    if (mine !== drawing) return;
    if (url) image.src = url;
    image.hidden = !url;
    busy.hidden = true;
    if (!url) {
      busy.textContent = t('预览画不出来，不影响导入');
      busy.hidden = false;
    }
  };
  flip.addEventListener('click', () => {
    state.upright = (state.upright + 1) % 4;
    clampScale();
    showSize();
    void preview();
  });
  spin.addEventListener('click', () => {
    state.yaw = (state.yaw + 1) % 4;
    showSize();
    void preview();
  });

  clampScale();
  showSize();
  dialog.showModal();
  void preview();

  const go = await new Promise<boolean>((resolve) => {
    // 点了哪个按钮当场作数（不等 close 事件：页面藏着时它不来）；按 Esc 关掉是取消
    ok.addEventListener('click', () => resolve(true));
    cancel.addEventListener('click', () => resolve(false));
    dialog.addEventListener('close', () => resolve(false));
  });
  try {
    if (!go) return null;
    ok.disabled = true;
    ok.textContent = t('正在导入…');
    await new Promise((resolve) => setTimeout(resolve, 0));
    clampScale();
    const built = build();
    const encoded = encodeRealAsset(built);
    const thumb = await renderAssetImage(built).catch(() => '');
    const asset: UserAsset = {
      id,
      name: nameBox.value.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || state.name,
      group: (PROP_ASSET_GROUPS as readonly string[]).includes(groupBox.value) ? (groupBox.value as PropAssetGroup) : 'other',
      size: built.size,
      vertices: built.positions.length / 3,
      triangles: built.indices.length / 3,
      bytes: encoded.byteLength,
      ...(thumb ? { thumb } : {}),
      ...(source.plain ? { plain: true as const } : {}),
      added: Date.now(),
    };
    const { kept } = await addUserAsset(asset, encoded);
    return { asset, kept, fresh: true };
  } finally {
    if (dialog.open) dialog.close();
    dialog.remove();
  }
}
