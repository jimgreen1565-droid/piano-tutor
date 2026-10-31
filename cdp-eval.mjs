// 极简 CDP 驱动：用无头 Chrome 打开一个页面，轮询一段表达式直到满足条件，打印结果。
// 为什么需要它：--virtual-time-budget 会在真实 CPU 异步工作（解码 mp3）完成前就结束，
// 拿它测异步任务会得到假失败。这个脚本用真实时间等待 + Runtime.evaluate 取结果。
//
// 用法: node cdp-eval.mjs <url> <pollExpr> [timeoutMs] [expectSubstr]

import { spawn } from 'node:child_process';
import http from 'node:http';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const [, , url, pollExpr, timeoutArg, expectArg] = process.argv;
const timeoutMs = Number(timeoutArg || 30000);
const expect = expectArg || '';
const PORT = 9333;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.cwd()}\\.tmp\\chrome-cdp`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const errors = [];
let ws;
let id = 0;
const pending = new Map();

function send(method, params) {
  const myId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(myId, { resolve, reject });
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });
}

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: false,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval error');
  return r.result?.value;
}

const cleanup = (code) => {
  try {
    ws?.close();
  } catch {}
  try {
    chrome.kill();
  } catch {}
  process.exit(code);
};

(async () => {
  // 等 devtools 就绪
  let ver = null;
  for (let i = 0; i < 60; i++) {
    try {
      ver = JSON.parse(await get('/json/version'));
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!ver) throw new Error('Chrome DevTools 未就绪');

  // 复用启动时的 about:blank 页面目标（新版 Chrome 的 /json/new 只接受 PUT）
  await sleep(400);
  const list = JSON.parse(await get('/json/list'));
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('/json/list 里没有 page 目标');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params?.exceptionDetails;
      errors.push(d?.exception?.description || d?.text || '(unknown)');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      errors.push('[console.error] ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  };
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('WS 连接失败'));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });

  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      last = await evaluate(pollExpr);
      if (typeof last === 'string' && last.includes(expect)) break;
      if (last === 'DONE') break;
    } catch (e) {
      last = `(eval 异常: ${e.message})`;
    }
    await sleep(300);
  }
  if (errors.length) console.log("[JS 异常]\n" + errors.slice(0,5).join("\n"));
  console.log(typeof last === 'string' ? last : JSON.stringify(last, null, 2));
  console.log(`\n[等 ${Math.round((Date.now() - t0) / 1000)}s / 上限 ${timeoutMs / 1000}s]`);
  cleanup(0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  cleanup(1);
});
