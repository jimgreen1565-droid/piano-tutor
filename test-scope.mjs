// 「只练这一段」的自检：裁剪后的谱面必须与完整谱面在小节号、拍位、评分上一致。
//
// 这里测的是最容易静默出错的地方：
//   - 小节号被重排 → 点评说"第 1 小节"，而谱上是第 5 小节
//   - 拍位被平移错 → beatInMeasure 变了，"起拍犹豫"这类归因就判错
//   - 应当时刻算错 → 全部音符被判成"漏音/多弹"，用户看到 0 分
//
// 用法: node test-scope.mjs

import { readFileSync } from 'node:fs';
import { evaluate, scopeScore } from './src/score.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('  ✗ ' + msg);
  }
};

const twinkle = JSON.parse(readFileSync('public/scores/twinkle.json', 'utf8'));
const beats = twinkle.timeSignature?.beats || 4;

console.log('小星星: %d 音 / %d 小节 / %d 拍每小节', twinkle.notes.length, twinkle.totalMeasures, beats);

// ---------- 1. 裁剪边界 ----------
const from = 4;
const to = 6;
const sc = scopeScore(twinkle, from, to);
ok(!!sc, '能裁出 4–6 小节');
ok(sc.notes.length > 0, '裁出的段里有音符');
ok(
  sc.notes.every((n) => n.measure >= from && n.measure <= to),
  '裁出的音符都在 4–6 小节内',
);
const outsideCount = twinkle.notes.filter((n) => n.measure >= from && n.measure <= to).length;
ok(sc.notes.length === outsideCount, '音符数 = 原谱该范围内的音符数');
ok(sc.notes.length < twinkle.notes.length, '确实变少了（不是整首）');

// ---------- 2. 节拍重定基准、小节号保持原样 ----------
ok(Math.min(...sc.notes.map((n) => n.beat)) === 0, '最小 beat 归零');
ok(
  sc.notes.some((n) => n.measure === from),
  '小节号保持原样（仍能看到第 4 小节）',
);
ok(
  Math.max(...sc.notes.map((n) => n.measure)) === Math.min(to, twinkle.totalMeasures),
  '最大小节号 = 段末小节',
);

// 拍位（beatInMeasure）必须和原谱一致：这是"起拍犹豫/八分音符"归因的基础
const full = twinkle.notes.filter((n) => n.measure >= from && n.measure <= to);
const beatInMeasureOk = full.every((orig, i) => {
  const moved = sc.notes[i];
  return Math.abs((orig.beat % beats) - (moved.beat % beats)) < 1e-9;
});
ok(beatInMeasureOk, '每个音的"小节内第几拍"没变');
ok(Math.abs(sc.totalBeats * (60 / 60) - (Math.max(...full.map((n) => n.beat + (n.durationBeats || 1))) - Math.min(...full.map((n) => n.beat)))) < 1e-9, 'totalBeats = 这一段的长度');

// ---------- 3. 满分演奏：按重定基准后的时刻喂进去，应当全中 ----------
const bpm = 60;
const spb = 60 / bpm;
const perfect = sc.notes.map((n) => ({
  pitchMidi: n.pitchMidi,
  startTimeSeconds: n.beat * spb,
  durationSeconds: (n.durationBeats || 1) * spb,
  amplitude: 0.6,
}));
const rPerfect = evaluate(sc, perfect, { bpm });
ok(rPerfect.overall === 100, `满分演奏应该 100 分，实得 ${rPerfect.overall}`);
ok(rPerfect.missCount === 0 && rPerfect.wrongCount === 0, '满分演奏没有漏音/错音');
ok(rPerfect.total === sc.notes.length, `评分基数 = 这一段音符数（${sc.notes.length}）`);

// ---------- 4. 漏掉段内最后一小节：只该影响那一段 ----------
const dropFrom = sc.notes.filter((n) => n.measure !== to).map((n) => ({
  pitchMidi: n.pitchMidi,
  startTimeSeconds: n.beat * spb,
  durationSeconds: (n.durationBeats || 1) * spb,
  amplitude: 0.6,
}));
const rMiss = evaluate(sc, dropFrom, { bpm });
ok(rMiss.missCount > 0, '漏弹小节被算成漏音');
ok(
  rMiss.problemMeasures.every((m) => m.measure >= from && m.measure <= to),
  '问题小节号落在这一段的真实编号里',
);
ok(
  rMiss.problemMeasures.some((m) => m.measure === to),
  `问题小节里包含第 ${to} 小节（真实编号，不是重排后的 3）`,
);

// ---------- 5. 段内弹对、另外多弹了几个音：多的算"多弹"，不该影响段内命中 ----------
const withExtras = perfect.concat([
  { pitchMidi: 30, startTimeSeconds: 0.5 * spb, durationSeconds: spb, amplitude: 0.6 },
  { pitchMidi: 31, startTimeSeconds: 3.5 * spb, durationSeconds: spb, amplitude: 0.6 },
  { pitchMidi: 99, startTimeSeconds: 8.2 * spb, durationSeconds: 0.1, amplitude: 0.6 },
]);
const rAll = evaluate(sc, withExtras, { bpm });
ok(rAll.hitCount === sc.notes.length, '段内音符仍然全部命中');
ok(rAll.extraCount > 0, '多出来的音被记为"多弹"，不会被当成涨分理由');

// ---------- 6. 越界与空段 ----------
ok(scopeScore(twinkle, 1, 1) !== null, '单小节也能裁');
ok(scopeScore(twinkle, 999, 1000) === null, '不存在的范围返回 null');
ok(scopeScore(twinkle, 5, 4) === null, '反向范围返回 null');

console.log('\n结果: %d 通过 / %d 失败', pass, fail);
process.exit(fail ? 1 : 0);
