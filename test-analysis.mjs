import { readFileSync } from 'node:fs';
import { evaluate } from './src/score.js';
import { analyzeScore, categorizeErrors } from './src/analysis.js';

const score = JSON.parse(readFileSync('./public/scores/twinkle.json', 'utf8'));
const spb = 60 / score.bpm;

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

function perfect() {
  return score.notes.map((n) => ({
    pitchMidi: n.pitchMidi,
    startTimeSeconds: n.beat * spb,
    durationSeconds: n.durationBeats * spb * 0.9,
    amplitude: 0.6,
  }));
}

console.log('\n[谱面结构分析]');
{
  const a = analyzeScore(score);
  check('音符数一致', a.notes.length === score.notes.length);
  check('第一节首音无前音', a.notes[0].interval === 0);
  check('识别出重复音', a.stats.repeats > 0, `actual ${a.stats.repeats}`);
  check('小节数正确', a.measures.length === 12, `actual ${a.measures.length}`);
}

console.log('\n[错误归因：跳进]');
{
  // 小星星 G4→C4 是下行五度，人造一个跳跃位置的错音
  const a = analyzeScore(score);
  const leapIdx = a.notes.findIndex((n) => n.isLeap);
  check('谱面存在跳进音', leapIdx >= 0, `idx=${leapIdx}`);

  const played = perfect();
  played[leapIdx] = { ...played[leapIdx], pitchMidi: played[leapIdx].pitchMidi + 3 };
  const r = evaluate(score, played);
  const total = r.diagnosis.leap.length + r.diagnosis.bigLeap.length;
  check('错音被归到跳进类', total >= 1, JSON.stringify({
    leap: r.diagnosis.leap,
    big: r.diagnosis.bigLeap,
  }));
  check('讲评提到跳进', r.advice.some((t) => t.includes('跳进') || t.includes('大跳')), JSON.stringify(r.advice));
}

console.log('\n[错误归因：同音重复]');
{
  const a = analyzeScore(score);
  const repIdx = a.notes.findIndex((n) => n.isRepeat);
  check('谱面存在重复音', repIdx >= 0, `idx=${repIdx}`);

  const played = perfect();
  played[repIdx] = { ...played[repIdx], pitchMidi: played[repIdx].pitchMidi + 5 };
  const r = evaluate(score, played);
  const hit = r.diagnosis.repeat.length + r.diagnosis.leap.length + r.diagnosis.bigLeap.length;
  check('被归因', hit >= 1);
  check('讲评给了具体成因', r.advice.some((t) => /重复|跳进|大跳|八分|第一拍/.test(t)), JSON.stringify(r.advice));
}

console.log('\n[连续性瓶颈]');
{
  const played = perfect().filter((_, i) => i !== 3 && i !== 7);
  const r1 = evaluate(score, played);
  const badMeasures = r1.problemMeasures.map((m) => m.measure);
  check('首次出现错误小节', badMeasures.length > 0, JSON.stringify(badMeasures));

  const persistent = badMeasures.map((m) => ({ measure: m, fails: 3 }));
  const r2 = evaluate(score, played, { persistentMeasures: persistent });
  check('讲评提示瓶颈', r2.advice.some((t) => t.includes('瓶颈')), JSON.stringify(r2.advice));
  check('诊断带出瓶颈数据', r2.diagnosis.persistentMeasures.length === persistent.length);
}

console.log('\n[回归：基础评分]');
{
  const r = evaluate(score, perfect());
  check('满分', r.overall === 100, `actual ${r.overall}`);
  check('全对', r.hitCount === 42, `actual ${r.hitCount}`);

  const missed = perfect().filter((_, i) => i !== 0);
  check('漏音 1', evaluate(score, missed).missCount === 1);

  const wrong = perfect();
  wrong[5] = { ...wrong[5], pitchMidi: wrong[5].pitchMidi + 2 };
  check('错音 1', evaluate(score, wrong).wrongCount === 1);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
