/**
 * 把页面里随便什么值变成能 JSON.stringify 的样子，给 agent 的监控接口回话用（src/dev/agentBridge.ts）。
 * three.js 的对象、类型数组、Map、DOM 元素都化成简短的说明；绕回自己的引用、太深的、太长的截断。
 */

export interface PlainOptions {
  /** 往下最多展开几层 */
  depth?: number;
  /** 数组最多留几项 */
  items?: number;
  /** 一个对象最多留几个键 */
  keys?: number;
}

type Plain = null | boolean | number | string | Plain[] | { [key: string]: Plain };

export function toPlain(value: unknown, options: PlainOptions = {}): Plain {
  const { depth = 8, items = 500, keys = 200 } = options;
  const seen = new WeakSet<object>();

  const walk = (v: unknown, left: number): Plain => {
    if (v === null || v === undefined) return null;
    switch (typeof v) {
      case 'boolean':
      case 'string':
        return v;
      case 'number':
        return Number.isFinite(v) ? v : String(v);
      case 'bigint':
        return String(v);
      case 'symbol':
        return v.toString();
      case 'function':
        return `[function ${v.name || '匿名'}]`;
    }
    const o = v as Record<string, unknown> & object;
    if (o instanceof Date) return o.toISOString();
    if (o instanceof Error) return { name: o.name, message: o.message, stack: o.stack ?? null };
    if (ArrayBuffer.isView(o)) {
      if (o instanceof DataView) return { type: 'DataView', byteLength: o.byteLength };
      const arr = o as unknown as ArrayLike<number>;
      return { type: o.constructor.name, length: arr.length, head: Array.from({ length: Math.min(arr.length, 8) }, (_, i) => Number(arr[i])) };
    }
    if (o instanceof ArrayBuffer) return { type: 'ArrayBuffer', byteLength: o.byteLength };
    if (typeof Node !== 'undefined' && o instanceof Node) {
      const el = o as unknown as Element;
      return el.tagName ? `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}>` : `[${o.nodeName}]`;
    }
    // three.js：向量、四元数、包围盒、颜色写成数，场景里的物体只写个名字
    if (o.isVector3 || o.isVector2 || o.isVector4 || o.isQuaternion || o.isEuler) {
      return ['x', 'y', 'z', 'w'].filter((k) => typeof o[k] === 'number').map((k) => o[k] as number);
    }
    if (o.isBox3) return { min: walk(o.min, left), max: walk(o.max, left) };
    if (o.isColor) return `#${(o as unknown as { getHexString(): string }).getHexString()}`;
    if (o.isMatrix4 || o.isMatrix3) return Array.from((o as unknown as { elements: number[] }).elements);
    if (o.isObject3D || o.isBufferGeometry || o.isMaterial || o.isTexture) {
      const tag = o as unknown as { type?: string; name?: string; children?: unknown[]; uuid?: string };
      return { three: tag.type ?? 'object', name: tag.name ?? '', ...(tag.children ? { children: tag.children.length } : {}) };
    }
    if (seen.has(o)) return '[绕回自己]';
    if (left <= 0) return Array.isArray(o) ? `[数组 ${o.length} 项]` : '[…]';
    seen.add(o);
    try {
      if (o instanceof Map) {
        const out: Plain[] = [];
        for (const [k, val] of o) {
          if (out.length >= items) break;
          out.push([walk(k, left - 1), walk(val, left - 1)]);
        }
        return { type: 'Map', size: o.size, entries: out };
      }
      if (o instanceof Set) return { type: 'Set', size: o.size, values: [...o].slice(0, items).map((x) => walk(x, left - 1)) };
      if (Array.isArray(o)) {
        const out = o.slice(0, items).map((x) => walk(x, left - 1));
        if (o.length > items) out.push(`[还有 ${o.length - items} 项]`);
        return out;
      }
      const out: { [key: string]: Plain } = {};
      const names = Object.keys(o);
      for (const name of names.slice(0, keys)) {
        let item: unknown;
        try {
          item = o[name];
        } catch (err) {
          item = `[读不了：${(err as Error).message}]`;
        }
        if (item === undefined || typeof item === 'function') continue;
        out[name] = walk(item, left - 1);
      }
      if (names.length > keys) out['…'] = `还有 ${names.length - keys} 个键`;
      return out;
    } finally {
      seen.delete(o);
    }
  };

  return walk(value, depth);
}
