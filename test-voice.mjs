// 语音片段库自检：
//   1. coach.js 模板表里每个片段是否都有音频（不缺句）
//   2. manifest 里每个文件是否真的在磁盘上、且不是错误页/空文件
//   3. 真实话术（几种典型演奏）里用到的片段是否全部就绪（否则播放会断句）
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { clipInventory, coachScript } from './src/coach.js';
import { evaluate } from './src/score.js';

const DIR = 'public/voice';
const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, 'utf8'));

let pass = 0;
let fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log('  ✗', m)));

// ---------- 1. 期望的片段集合（和生成器读同一份清单）----------
const inv = clipInventory();
const expect = new Set(inv.map((c) => c.key));

console.log(`期望片段 ${expect.size} 个，清单 ${Object.keys(manifest.clips).length} 条，音色 ${manifest.voice}`);
const missing = [...expect].filter((k) => !manifest.clips[k]);
ok(missing.length === 0, `缺片段 ${missing.length} 个: ${missing.slice(0, 8).join(', ')}`);
// 反向：清单里不该有模板表已经不用的碎片（改了模板却忘了重生成）
const stale = Object.keys(manifest.clips).filter((k) => !expect.has(k));
ok(stale.length === 0, `清单里有 ${stale.length} 个模板表已不用的旧片段: ${stale.slice(0, 8).join(', ')}`);
// 片段文本必须和模板表一致（防止改文案只改了字幕没改音频）
const textMismatch = inv.filter((c) => manifest.clips[c.key] && manifest.clips[c.key].text !== c.text);
ok(textMismatch.length === 0, `${textMismatch.length} 个片段音频文本与模板表不一致（需重生成）`);

// ---------- 2. 文件是否都在 ----------
let bytes = 0;
for (const [key, info] of Object.entries(manifest.clips)) {
  const p = `${DIR}/${info.file}`;
  if (!existsSync(p)) {
    ok(false, `${key} → ${info.file} 文件不存在`);
    continue;
  }
  const sz = statSync(p).size;
  bytes += sz;
  ok(sz > 400, `${key} → ${info.file} 只有 ${sz} 字节（多半是错误页/空文件）`);
  ok(info.dur > 0.05, `${key} 时长异常 ${info.dur}s`);
}
console.log(`音频总体积 ${(bytes / 1024).toFixed(0)} KB`);
const onDisk = readdirSync(`${DIR}/clips`).filter((f) => f.endsWith('.mp3'));
ok(onDisk.length === Object.keys(manifest.clips).length, `目录里 ${onDisk.length} 个 mp3，清单里 ${Object.keys(manifest.clips).length} 条`);

// ---------- 3. 真实话术能否整句拼出 ----------
const twinkle = JSON.parse(readFileSync('public/scores/twinkle.json', 'utf8'));
const spb = 60 / twinkle.bpm;
const perform = (mutate = () => ({})) =>
  twinkle.notes
    .map((n, i) => {
      const o = mutate(n, i) || {};
      if (o.drop) return null;
      return {
        pitchMidi: n.pitchMidi + (o.semitone || 0),
        startTimeSeconds: n.beat * spb + (o.timeShiftSec || 0),
        durationSeconds: (n.durationBeats || 1) * spb * 0.9,
        amplitude: o.amplitude ?? 0.6,
      };
    })
    .filter(Boolean);

const cases = {
  满分: perform(),
  漏音: perform((n) => (n.measure >= 5 && n.measure <= 6 ? { drop: true } : {})),
  高八度: perform(() => ({ semitone: 12 })),
  慢起: perform((n, i) => (i % 9 === 0 ? { timeShiftSec: 0.25 } : {})),
  轻: perform(() => ({ amplitude: 0.12 })),
};
for (const [name, played] of Object.entries(cases)) {
  const r = evaluate(twinkle, played, { bpm: twinkle.bpm });
  const c = coachScript(r, twinkle, played, { bpm: twinkle.bpm });
  const keys = [];
  for (const l of c.lines) for (const k of l.say) if (!keys.includes(k)) keys.push(k);
  const bad = keys.filter((k) => !manifest.clips[k]);
  ok(bad.length === 0, `[${name}] 话术里 ${bad.length} 个片段没有音频: ${bad.join(', ')}`);
  if (name === '漏音') {
    console.log('\n  例句字幕：' + c.lines.map((l) => l.text).join(' / '));
    const dur = c.lines.reduce(
      (n, l) => n + (l.say.reduce((m, k) => m + (manifest.clips[k]?.dur || 0), 0) + 0.24),
      0,
    );
    console.log(`  同上，拼成语音约 ${dur.toFixed(1)} 秒（${c.lines.reduce((n, l) => n + l.say.length, 0)} 个片段）`);
    ok(dur < 45, `点评太长了：${dur.toFixed(1)} 秒`);
  }
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
