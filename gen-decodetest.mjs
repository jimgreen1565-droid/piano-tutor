// 生成 dist/__decodetest.html：一次性验证全部 30 个钢琴采样在浏览器里能否 fetch + decode
import { writeFileSync, readdirSync } from 'node:fs';

const files = readdirSync('public/samples/piano').filter((f) => f.endsWith('.mp3'));

const html = `<!doctype html>
<meta charset="utf-8">
<title>decode test</title>
<pre id="out">running…</pre>
<script>
const FILES = ${JSON.stringify(files)};
const ctx = new (window.AudioContext || window.webkitAudioContext)();
const lines = [];
let ok = 0, bad = 0;

async function one(name) {
  const t0 = performance.now();
  try {
    const res = await fetch('./samples/piano/' + name);
    if (!res.ok) { lines.push(\`FAIL fetch \${name} status=\${res.status}\`); bad++; return; }
    const raw = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(raw.slice(0));
    ok++;
    lines.push(\`OK \${name} \${raw.byteLength}B \${buf.numberOfChannels}ch \${buf.sampleRate}Hz \${buf.duration.toFixed(2)}s \${Math.round(performance.now()-t0)}ms\`);
  } catch (e) {
    bad++;
    lines.push(\`FAIL \${name} -> \${e && (e.name + ': ' + e.message)}\`);
  }
}

(async () => {
  // 与 App 相同的并发度（4）
  const q = [...FILES];
  const worker = async () => { while (q.length) await one(q.shift()); };
  await Promise.all([worker(), worker(), worker(), worker()]);
  document.getElementById('out').textContent =
    'ctx.state=' + ctx.state + ' sampleRate=' + ctx.sampleRate + '\\n' +
    'OK=' + ok + ' BAD=' + bad + '\\n' + lines.join('\\n');
  document.title = 'DONE ok=' + ok + ' bad=' + bad;
})();
<\/script>`;

writeFileSync('dist/__decodetest.html', html);
console.log('wrote dist/__decodetest.html with', files.length, 'files');
