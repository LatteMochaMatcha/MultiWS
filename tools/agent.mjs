#!/usr/bin/env node
/**
 * 读正在跑的工坊：开发服务器上 /__agent/ 那组接口的命令行版（接口在 tools/agent-monitor/plugin.mjs）。
 * 说明见 docs/agent-monitor.md。
 *
 *   node tools/agent.mjs model           页面里现在的模型
 *   npm run agent -- logs --errors       同样能用
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HELP = `用法：node tools/agent.mjs <命令> [参数] [选项]      （或 npm run agent -- <命令> …）

命令
  servers                找本机 5173–5179 上开着的工坊开发服务器
  server                 开发服务器：进程、端口、运行多久、内存、最近改过的文件
  pages                  连着服务器的页面：哪个在前台、多久没人动、模型的摘要
  model                  页面里现在的模型（实时问页面；没回就给最后一次的快照）
  spec                   只要设定（BodySpec）
  settle                 等模型算完（网格不再变）再给快照
  history [条数]          最近的模型变化
  logs                   服务器和页面的日志（--errors 只看出错，--warn 看警告以上，--since 序号）
  eval <代码>             在页面里跑一段 JS，打印结果；能用 oc（= window.__oc）、settle()、snapshot()
  eval -f <文件>          同上，代码从文件里读
  shot [文件.png]         截 3D 视图（缺省存成 agent-shot.png）；--view front|side|back|three|…，--width / --height
                         页面藏着也能截（临时按 900×1200 画一张），画完镜头还原

选项
  --url <地址>            开发服务器，缺省看环境变量 OC_AGENT_URL，再不行在 5173–5179 上找
  --page <id>             选页面（id 的开头几位就行），缺省选前台、最近有人动过的那个
  --timeout <毫秒>        等页面回话多久
  --cached                model 不问页面，直接给最后一次的快照
  -n <条数>               logs、history 要几条

例子
  node tools/agent.mjs model
  node tools/agent.mjs eval "oc.spec().heads"
  node tools/agent.mjs eval "oc.set({ heads: 2 }); return await settle()"
  node tools/agent.mjs logs --errors -n 20
  node tools/agent.mjs shot front.png --view front`;

const args = process.argv.slice(2);
const flags = {};
const rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--errors' || a === '--warn' || a === '--cached' || a === '-h' || a === '--help') flags[a.replace(/^-+/, '')] = true;
  else if (a === '-f' || a === '-n' || a.startsWith('--')) flags[a.replace(/^-+/, '')] = args[++i];
  else rest.push(a);
}
const [command, ...params] = rest;

if (!command || flags.h || flags.help) {
  console.log(HELP);
  process.exit(command ? 0 : 1);
}

const PORTS = [5173, 5174, 5175, 5176, 5177, 5178, 5179];

/** 这个地址上是不是开着带监控接口的开发服务器；是就给它的 /server */
async function probe(base, ms = 1500) {
  try {
    const res = await fetch(`${base}/__agent/server`, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    const body = await res.json();
    return body && typeof body.pid === 'number' ? body : null;
  } catch {
    return null;
  }
}

async function findServers() {
  const found = await Promise.all(PORTS.map(async (port) => [`http://localhost:${port}`, await probe(`http://localhost:${port}`)]));
  return found.filter(([, info]) => info);
}

async function baseUrl() {
  const given = flags.url ?? process.env.OC_AGENT_URL;
  if (given) return given.replace(/\/+$/, '');
  const found = await findServers();
  if (!found.length) fail('本机 5173–5179 上没找到带监控接口的工坊开发服务器：先 npm run serve，或用 --url 指定地址');
  if (found.length > 1) console.error(`（找到 ${found.length} 个开发服务器，用的是 ${found[0][0]}；别的用 --url 指定：${found.slice(1).map(([u]) => u).join('、')}）`);
  return found[0][0];
}

function query(extra = {}) {
  const q = new URLSearchParams();
  if (flags.page) q.set('page', flags.page);
  if (flags.timeout) q.set('timeout', flags.timeout);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function request(path, init) {
  const base = await baseUrl();
  let res;
  try {
    res = await fetch(`${base}/__agent${path}`, init);
  } catch (err) {
    fail(`连不上 ${base}：${err.cause?.code ?? err.message}`);
  }
  return res;
}

async function getJson(path, init) {
  const res = await request(path, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    fail(`服务器回的不是 JSON（${res.status}）：${text.slice(0, 300)}`);
  }
  if (!res.ok) fail(`${res.status}：${body.error ?? text}`);
  return body;
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

switch (command) {
  case 'servers': {
    const found = await findServers();
    print(found.map(([url, info]) => ({ url, pid: info.pid, root: info.root, uptimeSec: info.uptimeSec, pages: info.pages })));
    break;
  }
  case 'server':
    print(await getJson('/server'));
    break;
  case 'pages':
    print(await getJson('/pages'));
    break;
  case 'model':
    print(await getJson(`/model${query({ cached: flags.cached ? 1 : undefined })}`));
    break;
  case 'spec':
    print(await getJson(`/spec${query({ cached: flags.cached ? 1 : undefined })}`));
    break;
  case 'settle':
    print(await getJson(`/settle${query({ quiet: flags.quiet })}`));
    break;
  case 'history':
    print(await getJson(`/history${query({ limit: params[0] ?? flags.n })}`));
    break;
  case 'logs': {
    const level = flags.errors ? 'error' : flags.warn ? 'warn' : flags.level;
    const body = await getJson(`/logs${query({ level, source: flags.source, since: flags.since, limit: flags.n })}`);
    for (const l of body.logs) console.log(`#${l.seq} ${l.at.slice(11, 19)} ${l.source}${l.page ? `:${l.page}` : ''} ${l.level.toUpperCase()} ${l.text}`);
    console.error(`（最后一条的序号 ${body.lastSeq}：下次用 --since ${body.lastSeq} 只看新的）`);
    break;
  }
  case 'eval': {
    const code = flags.f ? readFileSync(resolve(flags.f), 'utf8') : params.join(' ');
    if (!code.trim()) fail('eval 后面要跟一段代码，或者 -f 文件');
    const body = await getJson(`/eval${query()}`, { method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8' }, body: code });
    print(body.value);
    console.error(`（在页面 ${body.page} 里跑的）`);
    break;
  }
  case 'shot': {
    const out = resolve(params[0] ?? 'agent-shot.png');
    const res = await request(`/screenshot${query({ view: flags.view, width: flags.width, height: flags.height })}`);
    if (!res.ok) fail(`${res.status}：${(await res.json().catch(() => ({}))).error ?? res.statusText}`);
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log(out);
    console.error(`（页面 ${res.headers.get('x-oc-page')}，${res.headers.get('x-oc-size')}）`);
    break;
  }
  default:
    fail(`不认识的命令：${command}\n\n${HELP}`);
}
