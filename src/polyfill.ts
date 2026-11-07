/**
 * 旧内核补丁：页面和几个线程最先载入的就是它。
 *
 * 没装 Google Play 的国行安卓手机，系统 WebView 一直停在出厂时的版本（2026-11 一台 vivo Y30 标准版是 Chrome 83）。
 * 打包时语法会改写成老内核读得懂的（vite.config.ts 的 build.target），可新加的函数改写不了：
 * 用到一个 83 里没有的（当时是 replaceChildren），主程序开头就抛错停下，后面的模型、镜头都没建，3D 视图一片空白。
 * 这里把常用的几样补上；已经有的不动。再用到别的新函数（Chrome 84 以后才有的），在这里补一个。
 */

function define(target: object, name: string, value: unknown) {
  if (name in target) return;
  Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
}

// Chrome 86：清空子节点再放进新的
if (typeof Element !== 'undefined') {
  function replaceChildren(this: ParentNode, ...nodes: (Node | string)[]) {
    const self = this as unknown as Node;
    while (self.lastChild) self.removeChild(self.lastChild);
    this.append(...nodes);
  }
  define(Element.prototype, 'replaceChildren', replaceChildren);
  define(Document.prototype, 'replaceChildren', replaceChildren);
  define(DocumentFragment.prototype, 'replaceChildren', replaceChildren);
}

// Chrome 85
define(String.prototype, 'replaceAll', function replaceAll(this: string, search: string | RegExp, replacement: string) {
  if (search instanceof RegExp) {
    if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp');
    return this.replace(search, replacement);
  }
  return this.split(search).join(replacement);
});

// Chrome 92：负数从后往前数
function at(this: ArrayLike<unknown>, index: number) {
  const n = Math.trunc(index) || 0;
  const i = n < 0 ? this.length + n : n;
  return i >= 0 && i < this.length ? this[i] : undefined;
}
define(Array.prototype, 'at', at);
define(String.prototype, 'at', at);
define(Object.getPrototypeOf(Int8Array.prototype) as object, 'at', at);

// Chrome 93
define(Object, 'hasOwn', (obj: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(obj, key));

// Chrome 97
function findLastIndex(this: ArrayLike<unknown>, test: (v: unknown, i: number, a: ArrayLike<unknown>) => unknown, self?: unknown) {
  for (let i = this.length - 1; i >= 0; i--) if (test.call(self, this[i], i, this)) return i;
  return -1;
}
function findLast(this: ArrayLike<unknown>, test: (v: unknown, i: number, a: ArrayLike<unknown>) => unknown, self?: unknown) {
  const i = findLastIndex.call(this, test, self);
  return i < 0 ? undefined : this[i];
}
for (const proto of [Array.prototype, Object.getPrototypeOf(Int8Array.prototype) as object]) {
  define(proto, 'findLast', findLast);
  define(proto, 'findLastIndex', findLastIndex);
}

export {};
