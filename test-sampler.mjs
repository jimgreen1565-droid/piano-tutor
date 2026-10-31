// 采样回放器校验：文件名映射是否与磁盘文件一一对应（映射错 = 静默 404 = 悄悄退回合成音）
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { nearestSampleMidi, sampleFileName, SAMPLE_SET, PianoSampler } from './src/piano-sampler.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('  FAIL:', msg);
  }
};

// 1. 磁盘上每个采样文件都能被 sampleFileName 生成出来
const dir = 'public/samples/piano';
const onDisk = readdirSync(dir).filter((f) => f.endsWith('.mp3'));
console.log(`磁盘采样 ${onDisk.length} 个，采样集声明 ${SAMPLE_SET.length} 个`);
ok(onDisk.length === SAMPLE_SET.length, `数量不一致: ${onDisk.length} vs ${SAMPLE_SET.length}`);

const expected = SAMPLE_SET.map(sampleFileName);
const missing = expected.filter((f) => !onDisk.includes(f));
ok(missing.length === 0, `这些声明文件磁盘上没有: ${missing.join(', ')}`);

const extra = onDisk.filter((f) => !expected.includes(f));
ok(extra.length === 0, `磁盘多余文件: ${extra.join(', ')}`);

// 2. 每个文件都非空
let tiny = [];
for (const f of onDisk) {
  if (statSync(`${dir}/${f}`).size < 2000) tiny.push(f);
}
ok(tiny.length === 0, `文件过小(疑似损坏): ${tiny.join(', ')}`);

// 3. 全键盘 21..108：就近采样存在且偏移 ≤ 1 半音
let maxOff = 0;
let bad = 0;
for (let m = 21; m <= 108; m++) {
  const s = nearestSampleMidi(m);
  if (!SAMPLE_SET.includes(s)) bad++;
  maxOff = Math.max(maxOff, Math.abs(m - s));
}
ok(bad === 0, `${bad} 个音高没有对应采样`);
ok(maxOff <= 1, `最大音高偏移 ${maxOff} 半音，超过 1`);
console.log(`  全键盘就近采样最大偏移 ${maxOff} 半音（变速 ±${(100 * (2 ** (maxOff / 12) - 1)).toFixed(1)}%）`);

// 4. 移动端实际会加载多少：小星星的音域
const twinkle = JSON.parse(readFileSync('public/scores/twinkle.json', 'utf8'));
const need = PianoSampler.needed(twinkle.notes.map((n) => n.pitchMidi));
console.log(`  小星星(${twinkle.notes.length}音, 音域 ${Math.min(...twinkle.notes.map(n => n.pitchMidi))}-${Math.max(...twinkle.notes.map(n => n.pitchMidi))}) 需载采样 ${need.length} 个 → ${need.map(sampleFileName).join(', ')}`);
ok(need.length <= 6, `小星星要载 ${need.length} 个采样，过多`);

// 5. 大音域长曲的上限
const idx = JSON.parse(readFileSync('public/scores/index.json', 'utf8'));
let worst = 0;
let worstId = '';
for (const p of idx.pieces || idx) {
  const id = p.id || p;
  try {
    const sc = JSON.parse(readFileSync(`public/scores/${id}.json`, 'utf8'));
    const n = PianoSampler.needed(sc.notes.map((x) => x.pitchMidi)).length;
    if (n > worst) {
      worst = n;
      worstId = id;
    }
  } catch {
    /* 跳过没有 json 的条目 */
  }
}
console.log(`  全曲库最多需要采样数: ${worst}（${worstId}）→ 约 ${(worst * 40 / 1024).toFixed(2)}MB`);
ok(worst <= 30, `单曲最多需要 ${worst} 个采样，超过采样集总量`);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
