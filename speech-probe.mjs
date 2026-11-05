// 无头验证「教练语音」：报告页 → 点「听点评」→ 读回 speech() 状态，
// 并逐个解码新生成的关键片段（小节短语 / 整读数字 / 新换的整句），确认真是音频不是错误页。
// 用法: node speech-probe.mjs [url]
import { spawn } from 'node:child_process';
import http from 'node:http';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] || 'http://127.0.0.1:4199/?piece=twinkle&testreport=1&cb=v310';
const PORT = 9336;

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

// 关键片段：小节短语、整读数字（用户抱怨的正是这里）、以及换掉的几句整句
const KEYS = ['q:mof:5', 'q:mt:4', 'q:mof:44', 'n:四十五', 'n:七', 'n:一百', 'f:praise_rhythm_ok', 'f:shift_faster'];

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.cwd()}\\.tmp\\chrome-speech`,
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
  if (r && r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r?.result?.value;
};

const waitFor = async (expr, timeoutMs = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await evaluate(expr);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(300);
  }
};

try {
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

  ws = new globalThis.WebSocket(wsUrl);
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
  await sleep(1500);

  console.log('版本:', await waitFor('(document.querySelector(".ver")||{}).textContent'));
  console.log('语音标签:', await waitFor('(document.getElementById("coachVoice")||{}).textContent'));
  console.log('例句字幕:', await waitFor('(document.getElementById("coachLines")||{}).textContent'));

  // 运行时不该再去拉 voice/manifest.json（清单已内联进 bundle）。
  // 必须在下面探针自己 fetch 之前读，否则会把探针的请求也算进来。
  // 只认片段库清单 voice/manifest.json —— 根目录那个 ./manifest.json 是 PWA 应用清单，不是一回事
  const manifestReqs = await evaluate(
    "performance.getEntriesByType('resource').filter(r=>/voice\\/manifest\\.json/.test(r.name)).map(r=>r.name.split('/').pop())",
  );
  console.log(
    '运行时拉取清单:',
    JSON.stringify(manifestReqs),
    Array.isArray(manifestReqs) && manifestReqs.length === 0
      ? '✅ 没有（清单已内联，不受旧 Service Worker 缓存影响）'
      : '⚠️ 仍在拉取，需检查',
  );

  // 逐个解码关键片段（这一步不依赖播放，直接证明文件本身是真音频）
  const decoded = await evaluate(`(async () => {
    const m = await (await fetch('voice/manifest.json', {cache:'reload'})).json();
    const keys = ${JSON.stringify(KEYS)};
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const out = [];
    for (const k of keys) {
      const c = m.clips[k];
      if (!c) { out.push(k + ' MISSING'); continue; }
      try {
        const b = await ctx.decodeAudioData(await (await fetch('voice/' + c.file)).arrayBuffer());
        out.push(k + ' OK ' + b.duration.toFixed(2) + 's');
      } catch (e) { out.push(k + ' BAD ' + e.message); }
    }
    return out.join(' | ');
  })()`);
  console.log('关键片段解码:', decoded);

  // 点「听点评」→ 播放层状态
  const clicked = await evaluate(
    '(() => { const b = document.getElementById("btnCoach"); if (!b) return "no-button"; b.click(); return "clicked"; })()',
  );
  console.log('点击听点评:', clicked);
  await sleep(2500);
  const st = await evaluate('JSON.stringify(window.__pt.speech())');
  console.log('speech():', st);
  const parsed = JSON.parse(st || '{}');
  const ok = parsed.kind === 'clips' && parsed.clipsReady === 283 && (parsed.failures || []).length === 0;
  console.log(
    '结论:',
    ok
      ? `✅ 真人音色片段库正常（${parsed.clipsReady} 段就绪，本句 ${parsed.loaded} 段已解码，0 失败）`
      : `❌ 期望 kind=clips / clipsReady=283 / failures=[]，实际 ${st}`,
  );
  console.log('当前句高亮:', await evaluate('(() => { const el = document.querySelector("#coachLines .coach-line.on"); return el ? el.textContent.slice(0,18) : "(无)"; })()'));
} catch (e) {
  console.error('探针出错:', e.message);
} finally {
  try {
    ws && ws.close();
  } catch {}
  chrome.kill();
}
