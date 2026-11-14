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

/* ---- 下面几样是 AI 助手用的库（pi-ai、pi-agent-core 和它们带的官方 SDK）要的，2026-11-13 在 Chromium 83 上一样样试出来的 ---- */

// Chrome 84：只用来在对象被回收时顺手清理，旧内核上不清理也不影响结果
define(globalThis, 'FinalizationRegistry', class FinalizationRegistry {
  register() {}
  unregister() {
    return false;
  }
});
define(globalThis, 'WeakRef', class WeakRef<T extends object> {
  constructor(private readonly target: T) {}
  deref(): T | undefined {
    return this.target;
  }
});

// Chrome 98（reason）、100（throwIfAborted）、103（timeout）、116（any）：取消请求用的几样
if (typeof AbortController !== 'undefined') {
  if (!('reason' in AbortSignal.prototype)) {
    const reasons = new WeakMap<AbortSignal, unknown>();
    Object.defineProperty(AbortSignal.prototype, 'reason', {
      configurable: true,
      get(this: AbortSignal) {
        return reasons.get(this);
      },
    });
    const abort = AbortController.prototype.abort;
    AbortController.prototype.abort = function (this: AbortController, reason?: unknown) {
      if (!this.signal.aborted) reasons.set(this.signal, reason === undefined ? new DOMException('signal is aborted without reason', 'AbortError') : reason);
      abort.call(this);
    };
  }
  define(AbortSignal.prototype, 'throwIfAborted', function throwIfAborted(this: AbortSignal) {
    if (this.aborted) throw this.reason;
  });
  define(AbortSignal, 'timeout', (ms: number) => {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('signal timed out', 'TimeoutError')), ms);
    return c.signal;
  });
  define(AbortSignal, 'any', (signals: Iterable<AbortSignal>) => {
    const c = new AbortController();
    for (const s of signals) {
      if (s.aborted) {
        c.abort(s.reason);
        break;
      }
      s.addEventListener('abort', () => c.abort(s.reason), { once: true });
    }
    return c.signal;
  });
}

// Chrome 98：深拷贝。只管那几个库用到的：普通对象、数组、日期、正则、Map、Set、二进制、错误
define(globalThis, 'structuredClone', function structuredClone(value: unknown) {
  const seen = new Map<object, unknown>();
  const clone = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    if (v instanceof Date) return new Date(v.getTime());
    if (v instanceof RegExp) return new RegExp(v.source, v.flags);
    if (v instanceof ArrayBuffer) return v.slice(0);
    if (ArrayBuffer.isView(v)) {
      const view = v as unknown as { constructor: new (b: ArrayBuffer) => unknown; buffer: ArrayBuffer; byteOffset: number; byteLength: number };
      return new view.constructor(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    }
    if (v instanceof Error) {
      const e = new (v.constructor as ErrorConstructor)(v.message);
      e.stack = v.stack;
      return e;
    }
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      seen.set(v, out);
      for (const x of v) out.push(clone(x));
      return out;
    }
    if (v instanceof Map) {
      const out = new Map();
      seen.set(v, out);
      v.forEach((x, k) => out.set(clone(k), clone(x)));
      return out;
    }
    if (v instanceof Set) {
      const out = new Set();
      seen.set(v, out);
      v.forEach((x) => out.add(clone(x)));
      return out;
    }
    const out: Record<string, unknown> = {};
    seen.set(v, out);
    for (const k of Object.keys(v)) out[k] = clone((v as Record<string, unknown>)[k]);
    return out;
  };
  return clone(value);
});

// Chrome 92
if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
  define(crypto, 'randomUUID', () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  });
}

// Chrome 124：for await 一段段读 ReadableStream（读流式回答用）
if (typeof ReadableStream !== 'undefined' && !(Symbol.asyncIterator in ReadableStream.prototype)) {
  const values = function values(this: ReadableStream, options?: { preventCancel?: boolean }) {
    const reader = this.getReader();
    return {
      next: () => reader.read(),
      async return(value?: unknown) {
        if (!options?.preventCancel) await reader.cancel();
        reader.releaseLock();
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
  define(ReadableStream.prototype, 'values', values);
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, { value: values, writable: true, configurable: true });
}

export {};
