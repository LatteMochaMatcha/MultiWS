/**
 * 请求怎么发到服务商：浏览器直接连别家的网站常被跨域挡住，所以有外壳的时候交给外壳转发。
 *
 * - exe 外壳（tools/launcher/AiForward.cs）和开发服务器（tools/ai-forward/plugin.mjs）：同一个网站下的 /__ai/fwd/，
 *   照 /__shell/ 的规矩要带 X-Shell 头（别的网站在浏览器里发不出带这种头的跨站请求）。
 * - apk 外壳（MainActivity.java 的 OcAi）：WebView 拦请求时拿不到请求体，所以走网页上挂的 window.OcAi，
 *   这里把发往 /__ai/fwd/ 的 fetch 接过来交给它，流式的回答一段段推回来。
 * - 都没有（放在网站上的网页版）：直接连，只有放行跨域的服务能用（Claude 能）。
 *
 * 接到 pi 上只改模型的 baseUrl：https://api.deepseek.com/v1 → <本站>/__ai/fwd/https/api.deepseek.com/v1。
 */
import type { Api, Model } from '@earendil-works/pi-ai';

export type Route = 'direct' | 'http' | 'android';

const FWD = '__ai/fwd/';

interface AndroidAi {
  start(id: string, url: string, method: string, headers: string, body: string): void;
  abort(id: string): void;
}

declare global {
  interface Window {
    OcAi?: AndroidAi;
    /** apk 外壳往回推结果用的（见 MainActivity.java 的 OcAi） */
    __ocAi?: {
      head(id: string, status: number, headers: string): void;
      chunk(id: string, base64: string): void;
      end(id: string): void;
      fail(id: string, message: string): void;
    };
  }
}

let route: Promise<Route> | null = null;

/** 看有没有能转发的外壳（只问一次） */
export function detectRoute(): Promise<Route> {
  route ??= (async (): Promise<Route> => {
    if (typeof window === 'undefined') return 'direct';
    if (window.OcAi && typeof window.OcAi.start === 'function') {
      installAndroidFetch(window.OcAi);
      return 'android';
    }
    if (!/^https?:$/.test(location.protocol)) return 'direct';
    try {
      const r = await fetch(new URL('__ai/ping', location.href).href, { cache: 'no-store' });
      // 开发服务器把不认识的地址都回成首页：只认它回的这一句
      if (r.ok && (await r.text()).trim() === 'oc-ai') return 'http';
    } catch {
      // 连不上就是没有
    }
    return 'direct';
  })();
  return route;
}

/** 一个服务商地址换成转发地址 */
export function forwardUrl(base: string): string {
  const u = new URL(base);
  const scheme = u.protocol.replace(':', '');
  return new URL(`${FWD}${scheme}/${u.host}${u.pathname.replace(/\/+$/, '')}`, location.href).href;
}

/** 转发地址里 /__ai/fwd/ 后面那段换回服务商的地址：「https/api.deepseek.com/v1/chat/completions」→「https://api.deepseek.com/v1/chat/completions」 */
export function targetOf(rest: string): string {
  const slash = rest.indexOf('/');
  return `${rest.slice(0, slash)}://${rest.slice(slash + 1)}`;
}

/** 模型复制一份，地址改成走转发；exe、开发服务器的转发要带 X-Shell 头 */
export function routeModel<T extends Api>(model: Model<T>, how: Route): Model<T> {
  if (how === 'direct') return model;
  return { ...model, baseUrl: forwardUrl(model.baseUrl), headers: { ...(model.headers ?? {}), ...(how === 'http' ? { 'X-Shell': '1' } : {}) } };
}

/* ---------------- apk：把 /__ai/fwd/ 的 fetch 交给外壳 ---------------- */

function toBytes(base64: string): Uint8Array {
  const s = atob(base64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function installAndroidFetch(bridge: AndroidAi) {
  const prefix = new URL(FWD, location.href).href;
  const pending = new Map<string, {
    resolve: (r: Response) => void;
    reject: (e: unknown) => void;
    controller?: ReadableStreamDefaultController<Uint8Array>;
    stream?: ReadableStream<Uint8Array>;
  }>();
  window.__ocAi = {
    head(id, status, headers) {
      const p = pending.get(id);
      if (!p) return;
      const stream = new ReadableStream<Uint8Array>({
        start: (c) => {
          p.controller = c;
        },
        cancel: () => {
          bridge.abort(id);
          pending.delete(id);
        },
      });
      p.stream = stream;
      let list: [string, string][] = [];
      try {
        list = Object.entries(JSON.parse(headers) as Record<string, string>);
      } catch {
        // 没有就算了
      }
      p.resolve(new Response(stream, { status: status || 502, headers: list }));
    },
    chunk(id, base64) {
      pending.get(id)?.controller?.enqueue(toBytes(base64));
    },
    end(id) {
      pending.get(id)?.controller?.close();
      pending.delete(id);
    },
    fail(id, message) {
      const p = pending.get(id);
      if (!p) return;
      const error = new TypeError(message || 'Failed to fetch');
      if (p.controller) p.controller.error(error);
      else p.reject(error);
      pending.delete(id);
    },
  };
  const original = window.fetch.bind(window);
  let next = 0;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(prefix)) return original(input, init);
    const request = new Request(input, init);
    const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const id = `r${++next}`;
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return new Promise<Response>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }
      pending.set(id, { resolve, reject });
      signal?.addEventListener('abort', () => {
        bridge.abort(id);
        const p = pending.get(id);
        const reason = signal.reason ?? new DOMException('Aborted', 'AbortError');
        if (p?.controller) p.controller.error(reason);
        else p?.reject(reason);
        pending.delete(id);
      }, { once: true });
      bridge.start(id, targetOf(url.slice(prefix.length)), request.method, JSON.stringify(headers), body);
    });
  };
}
