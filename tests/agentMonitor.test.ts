// 给 agent 用的监控、测试接口（tools/agent-monitor/plugin.mjs）：起一个真的开发服务器，
// 用 WebSocket 假扮一个页面（跟 src/dev/agentBridge.ts 走同一套消息），从 HTTP 那头读、问、截图。
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ViteDevServer, createServer } from 'vite';
import { Vector3 } from 'three';
import { agentMonitor, refuse } from '../tools/agent-monitor/plugin.mjs';
import { toPlain } from '../src/dev/plain';

/** 假扮的页面：认 snapshot / eval / screenshot 三种请求；mute 时收到请求不回话 */
class FakePage {
  readonly socket: WebSocket;
  mute = false;
  evals: string[] = [];
  triangles = 1000;

  constructor(url: string, readonly id: string) {
    this.socket = new WebSocket(url, 'vite-hmr');
    this.socket.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.type !== 'custom' || msg.event !== 'oc-agent:call' || this.mute) return;
      const { id: callId, op, args } = msg.data;
      const reply = (value: unknown) => this.send('oc-agent:reply', { id: callId, ok: true, value });
      if (op === 'snapshot') reply(this.snapshot());
      else if (op === 'eval') {
        this.evals.push(args.code);
        if (args.code === 'boom') this.send('oc-agent:reply', { id: callId, ok: false, error: 'Error: 炸了' });
        else reply({ echoed: args.code });
      } else if (op === 'screenshot') reply({ base64: btoa('\x89PNG fake'), width: args.width ?? 2, height: args.height ?? 3 });
    });
  }

  opened() {
    return new Promise<void>((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve());
      this.socket.addEventListener('error', () => reject(new Error('WebSocket 连不上')));
    });
  }

  send(event: string, data: unknown) {
    this.socket.send(JSON.stringify({ type: 'custom', event, data }));
  }

  hello() {
    this.send('oc-agent:hello', { id: this.id, url: 'http://localhost/', title: '假页面', visible: true, focused: true, lastInput: null, size: [800, 600], userAgent: 'vitest' });
  }

  snapshot() {
    return {
      ready: true,
      mode: 'shape',
      description: '两个头',
      readout: ['身高 1.70 m', `${this.triangles} 三角面`],
      warnings: [],
      status: '',
      selected: null,
      mesh: { triangles: this.triangles, components: 1 },
      spec: { bodyStyle: 'mannequin', meshMode: 'fused', counts: { heads: 2 } },
    };
  }
}

const until = async (check: () => Promise<boolean> | boolean, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('等太久了');
};

describe('agent 监控接口', () => {
  /** 问题单存到临时文件夹，不往项目里写 */
  const notesDir = mkdtempSync(join(tmpdir(), 'oc-agent-notes-'));
  let server: ViteDevServer;
  let base: string;
  let wsUrl: string;
  const pages: FakePage[] = [];

  const get = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${base}/__agent${path}`, init);
    return { status: res.status, body: await res.json() };
  };
  const connect = async (id: string) => {
    const page = new FakePage(wsUrl, id);
    pages.push(page);
    await page.opened();
    page.hello();
    await until(async () => (await get('/pages')).body.some((p: { id: string; connected: boolean }) => p.id === id && p.connected));
    return page;
  };

  beforeAll(async () => {
    server = await createServer({
      configFile: false,
      root: 'tests',
      cacheDir: 'node_modules/.vite-agent-test',
      logLevel: 'silent',
      plugins: [agentMonitor({ notesDir })],
      server: { host: '127.0.0.1', port: 0, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    await server.listen();
    base = server.resolvedUrls!.local[0].replace(/\/$/, '');
    wsUrl = `${base.replace('http', 'ws')}/?token=${server.config.webSocketToken}`;
  });

  afterAll(async () => {
    for (const page of pages) page.socket.close();
    await server?.close();
    rmSync(notesDir, { recursive: true, force: true });
  });

  it('列出接口，报服务器自己的状态', async () => {
    const index = await get('/');
    expect(index.status).toBe(200);
    expect(Object.keys(index.body.endpoints).some((k) => k.includes('/__agent/model'))).toBe(true);
    const info = (await get('/server')).body;
    expect(info.pid).toBeTypeOf('number');
    expect(info.vite).toMatch(/^\d+\./);
    expect(info.pages.connected).toBe(0);
  });

  it('还没有页面时问模型：503，说清楚要先打开页面', async () => {
    const { status, body } = await get('/model');
    expect(status).toBe(503);
    expect(body.error).toContain('打开工坊页面');
  });

  it('页面连上以后：实时问到模型，记进历史', async () => {
    const page = await connect('aaa111');
    const model = await get('/model');
    expect(model.status).toBe(200);
    expect(model.body).toMatchObject({ page: 'aaa111', stale: false, description: '两个头', mesh: { triangles: 1000 } });
    expect((await get('/spec')).body.spec.counts.heads).toBe(2);

    page.triangles = 2000;
    await get('/model');
    const history = (await get('/history')).body;
    expect(history.at(-1)).toMatchObject({ page: 'aaa111', change: { triangles: 2000 } });
  });

  it('eval：请求体原样送到页面，页面里的出错带回来', async () => {
    const page = pages.find((p) => p.id === 'aaa111')!;
    const ok = await get('/eval?page=aaa', { method: 'POST', body: 'oc.spec().counts' });
    expect(ok.body).toEqual({ page: 'aaa111', value: { echoed: 'oc.spec().counts' } });
    expect(page.evals).toContain('oc.spec().counts');

    const bad = await get('/eval', { method: 'POST', body: 'boom' });
    expect(bad.status).toBe(500);
    expect(bad.body.error).toContain('炸了');

    expect((await get('/eval')).status).toBe(405);
  });

  it('截图：回 PNG 的字节，大小写在响应头里', async () => {
    const res = await fetch(`${base}/__agent/screenshot?width=640&height=480&view=front`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-oc-size')).toBe('640x480');
    expect([...new Uint8Array(await res.arrayBuffer())].slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('页面不回话：超时后给最后一次的快照，标上 stale', async () => {
    const page = pages.find((p) => p.id === 'aaa111')!;
    page.mute = true;
    const { status, body } = await get('/model?timeout=600');
    page.mute = false;
    expect(status).toBe(200);
    expect(body.stale).toBe(true);
    expect(body.staleReason).toContain('没回话');
    expect(body.mesh.triangles).toBe(2000);
  });

  it('几个页面时：缺省选在前台的，?page= 按 id 开头选', async () => {
    const other = await connect('bbb222');
    other.send('oc-agent:page', { id: 'bbb222', visible: false, focused: false });
    await until(async () => (await get('/pages')).body.find((p: { id: string }) => p.id === 'bbb222').visible === false);
    expect((await get('/model')).body.page).toBe('aaa111');
    expect((await get('/model?page=bbb')).body.page).toBe('bbb222');
    expect((await get('/model?page=zzz')).status).toBe(404);
  });

  it('页面的日志、断开都记下来', async () => {
    const page = pages.find((p) => p.id === 'bbb222')!;
    page.send('oc-agent:log', { id: 'bbb222', level: 'error', text: '页面里出错了' });
    await until(async () => (await get('/logs?level=error')).body.logs.some((l: { text: string }) => l.text === '页面里出错了'));
    const errors = (await get('/logs?level=error&source=page')).body.logs;
    expect(errors.every((l: { level: string; source: string }) => l.level === 'error' && l.source === 'page')).toBe(true);

    page.socket.close();
    await until(async () => (await get('/pages')).body.find((p: { id: string }) => p.id === 'bbb222').connected === false);
    expect((await get('/model?page=bbb222')).body).toMatchObject({ stale: true });
  });

  it('别的网页借浏览器发来的请求一律拒绝', async () => {
    const cross = await get('/eval', { method: 'POST', body: '1', headers: { origin: 'https://evil.example' } });
    expect(cross.status).toBe(403);
    expect(pages.find((p) => p.id === 'aaa111')!.evals).not.toContain('1');
    expect(refuse({ socket: { remoteAddress: '192.168.1.5' }, headers: { host: 'localhost:5173' } })).toContain('只接受本机');
    expect(refuse({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'evil.example:5173' } })).toContain('Host');
    expect(refuse({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:5173', 'sec-fetch-site': 'cross-site' } })).toContain('别的网页');
    expect(refuse({ socket: { remoteAddress: '::1' }, headers: { host: 'localhost:5173', origin: 'http://localhost:5173' } })).toBeNull();
  });

  it('页面送来问题单：存进 notes 文件夹，回话说存在哪，/notes 列得出来', async () => {
    const page = pages.find((p) => p.id === 'aaa111')!;
    const saved = new Promise<{ ok: boolean; dir: string }>((resolve) => {
      page.socket.addEventListener('message', (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.type === 'custom' && msg.event === 'oc-agent:note-saved') resolve(msg.data);
      });
    });
    const png = Buffer.from('\x89PNG fake', 'latin1').toString('base64');
    page.send('oc-agent:note', { note: { text: '肩头鼓包', strokes: [[[0.2, 0.3], [0.4, 0.5]]], snapshot: { mode: 'pose' } }, images: { 'screen.png': png } });
    const reply = await saved;
    expect(reply.ok).toBe(true);
    expect(readdirSync(join(notesDir, reply.dir.split('/').pop()!)).sort()).toEqual(['note.json', 'screen.png']);
    const list = (await get('/notes')).body;
    expect(list[0]).toMatchObject({ text: '肩头鼓包', mode: 'pose', strokes: 1, files: ['screen.png'] });
  });
});

describe('toPlain：页面里的值变成能 JSON 的样子', () => {
  it('绕回自己的引用、类型数组、Map、three 的向量', () => {
    const loop: Record<string, unknown> = { name: '环' };
    loop.self = loop;
    const plain = toPlain({
      loop,
      shared: [loop, loop],
      floats: new Float32Array([1, 2, 3]),
      map: new Map([['a', 1]]),
      set: new Set([1, 2]),
      vec: new Vector3(1, 2, 3),
      fn() {},
      nan: Number.NaN,
      when: new Date(0),
    }) as Record<string, unknown>;
    expect(plain.loop).toEqual({ name: '环', self: '[绕回自己]' });
    // 同一个对象出现两次不算绕回自己
    expect(plain.shared).toEqual([{ name: '环', self: '[绕回自己]' }, { name: '环', self: '[绕回自己]' }]);
    expect(plain.floats).toEqual({ type: 'Float32Array', length: 3, head: [1, 2, 3] });
    expect(plain.map).toEqual({ type: 'Map', size: 1, entries: [['a', 1]] });
    expect(plain.set).toEqual({ type: 'Set', size: 2, values: [1, 2] });
    expect(plain.vec).toEqual([1, 2, 3]);
    expect('fn' in plain).toBe(false);
    expect(plain.nan).toBe('NaN');
    expect(plain.when).toBe('1970-01-01T00:00:00.000Z');
    expect(() => JSON.stringify(plain)).not.toThrow();
  });

  it('太深、太长的截断', () => {
    expect(toPlain({ a: { b: { c: 1 } } }, { depth: 2 })).toEqual({ a: { b: '[…]' } });
    expect(toPlain([1, 2, 3, 4], { items: 2 })).toEqual([1, 2, '[还有 2 项]']);
  });
});
