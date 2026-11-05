// 无头验证「就练这一段」：加载报告页 → 点「就练 第 X–Y 小节」→ 读回 scope/bpm/进度条。
// 用法: node drill-probe.mjs [url]
import { spawn } from 'node:child_process';
import http from 'node:http';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] || 'http://127.0.0.1:4188/?piece=twinkle&testreport=1&cb=drill';
const PORT = 9334;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (path) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path }, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve(b));
      })
      .on('error', reject);
  });

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--mute-audio',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.cwd()}\\.tmp\\chrome-drill`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let ws;
let id = 0;
const pending = new Map();
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const myId = ++id;
    pending.set(myId, { resolve, reject });
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) {
    return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  }
  return r?.result?.value;
};

const waitFor = async (expr, timeoutMs = 15000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await evaluate(expr);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(300);
  }
};

try {
  // 打开页面
  let wsUrl = null;
  const t0 = Date.now();
  while (!wsUrl && Date.now() - t0 < 15000) {
    try {
      const list = JSON.parse(await get('/json/list'));
      const page = list.find((t) => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await sleep(400);
  }
  if (!wsUrl) throw new Error('Chrome 没起来');

  const { WebSocket } = await import('node:worker_threads').then(() => globalThis);
  ws = new (globalThis.WebSocket)(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  await sleep(1200);

  const ver = await waitFor('(document.querySelector(".ver")||{}).textContent');
  console.log('版本:', ver);

  const drill = await waitFor('(() => { const b = document.getElementById("btnCoachDrill"); return b ? (b.textContent||"").trim() : ""; })()');
  console.log('练法按钮:', JSON.stringify(drill));

  const before = await evaluate('JSON.stringify(window.__pt.scope())');
  const barBefore = await evaluate('!!(document.getElementById("scopeBar")||{}).hidden');
  console.log('点击前 scope:', before, 'bar hidden:', barBefore);
  console.log('点击前 activeNotes:', await evaluate('window.__pt.activeNotes()'));

  const clicked = await evaluate('(() => { const b = document.getElementById("btnCoachDrill"); if (!b) return "no-button"; b.click(); return "clicked"; })()');
  console.log('点击:', clicked);
  await sleep(1500);

  console.log('点击后 scope:', await evaluate('JSON.stringify(window.__pt.scope())'));
  console.log('点击后 bpm:', await evaluate('window.__pt.bpm()'));
  console.log('点击后 activeNotes:', await evaluate('window.__pt.activeNotes()'));
  console.log('点击后 bar 文本:', await evaluate('(() => { const b = document.getElementById("scopeBar"); return b ? (b.textContent||"").replace(/\\s+/g," ").trim() : "none"; })()'));
  console.log('点击后 bar hidden:', await evaluate('(() => { const b = document.getElementById("scopeBar"); return b ? b.hasAttribute("hidden") : null; })()'));
  console.log('状态行:', await evaluate('window.__pt.statusText()'));

  // 「练整首」必须能把范围清掉，否则用户会被困在只练一段里
  const cleared = await evaluate('(() => { const b = document.getElementById("btnScopeClear"); if (!b) return "no-button"; b.click(); return "clicked"; })()');
  console.log('练整首点击:', cleared);
  await sleep(800);
  console.log('练整首后 scope:', await evaluate('JSON.stringify(window.__pt.scope())'));
  console.log('练整首后 activeNotes:', await evaluate('window.__pt.activeNotes()'));
  console.log('练整首后 bar hidden:', await evaluate('(() => { const b = document.getElementById("scopeBar"); return b ? b.hasAttribute("hidden") : null; })()'));
  console.log('练整首后 bpm:', await evaluate('window.__pt.bpm()'));
} catch (e) {
  console.log('探测失败:', e.message);
} finally {
  try {
    ws?.close();
  } catch {}
  chrome.kill();
  process.exit(0);
}
