import { readFileSync } from 'node:fs';
import { evaluate } from './src/score.js';

const score = JSON.parse(readFileSync('./public/scores/twinkle.json', 'utf8'));
const spb = 60 / score.bpm; // 60bpm → 1 拍 = 1 秒

let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

// 由谱面生成"完美演奏"
function perfect(offsetSec = 0, pitchShift = () => 0) {
  return score.notes.map((n) => ({
    pitchMidi: n.pitchMidi + pitchShift(n),
    startTimeSeconds: n.beat * spb + offsetSec,
    durationSeconds: n.durationBeats * spb * 0.9,
    amplitude: 0.6,
  }));
}

console.log('\n[1] 完美演奏');
{
  const r = evaluate(score, perfect());
  check('满分', r.overall === 100, `actual ${r.overall}`);
  check('42 个音全对', r.hitCount === 42, `actual ${r.hitCount}`);
  check('无错音/漏音/多弹', r.wrongCount + r.missCount + r.extraCount === 0);
  check('无问题小节', r.problemMeasures.length === 0);
  check('有讲评文字', r.advice.length > 0);
}

console.log('\n[2] 漏弹 3 个音');
{
  const played = perfect().filter((_, i) => ![0, 5, 11].includes(i));
  const r = evaluate(score, played);
  check('漏音数 = 3', r.missCount === 3, `actual ${r.missCount}`);
  check('命中 = 39', r.hitCount === 39, `actual ${r.hitCount}`);
  check('准确率 = 39/42', Math.abs(r.pitchScore - 39 / 42) < 1e-6);
  check('点出漏音', r.advice.some((t) => t.includes('漏音')));
}

console.log('\n[3] 弹错 2 个音（音高升高 2 个半音）');
{
  const played = perfect(0, (n) => (n.beat === 0 || n.beat === 20 ? 2 : 0));
  const r = evaluate(score, played);
  check('错音数 = 2', r.wrongCount === 2, `actual ${r.wrongCount}`);
  check('命中 = 40', r.hitCount === 40, `actual ${r.hitCount}`);
  check('点出问题小节', r.problemMeasures.length === 2, `actual ${r.problemMeasures.length}`);
}

console.log('\n[4] 多弹 1 个音');
{
  const played = perfect();
  played.push({ pitchMidi: 61, startTimeSeconds: 10.0, durationSeconds: 0.5, amplitude: 0.5 });
  const r = evaluate(score, played);
  check('多弹数 = 1', r.extraCount === 1, `actual ${r.extraCount}`);
  check('命中仍 42', r.hitCount === 42, `actual ${r.hitCount}`);
}

console.log('\n[5] 整体慢 0.25 拍（拖拍）');
{
  const r = evaluate(score, perfect(0.25 * spb));
  check('平均偏差 ≈ +0.25 拍', Math.abs(r.timing.meanBeats - 0.25) < 1e-6, `actual ${r.timing.meanBeats}`);
  check('仍全部命中', r.hitCount === 42, `actual ${r.hitCount}`);
  check('提示偏慢', r.advice.some((t) => t.includes('慢')), JSON.stringify(r.advice));
}

console.log('\n[6] 节奏不稳（交替 ±0.2 拍）');
{
  const played = score.notes.map((n, i) => ({
    pitchMidi: n.pitchMidi,
    startTimeSeconds: n.beat * spb + (i % 2 ? 0.2 : -0.2) * spb,
    durationSeconds: n.durationBeats * spb * 0.9,
    amplitude: 0.6,
  }));
  const r = evaluate(score, played);
  check('全部命中', r.hitCount === 42, `actual ${r.hitCount}`);
  check('节奏分数 < 1', r.rhythmScore < 1, `actual ${r.rhythmScore}`);
  check('提示节奏不稳', r.advice.some((t) => t.includes('忽快忽慢')), JSON.stringify(r.advice));
}

console.log('\n[7] 完全不弹');
{
  const r = evaluate(score, []);
  check('全部漏音', r.missCount === 42, `actual ${r.missCount}`);
  check('总分 0', r.overall === 0, `actual ${r.overall}`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);