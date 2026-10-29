import { readFileSync } from 'node:fs';
import { evaluate } from './src/score.js';

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

console.log('\n[持续音重复触发]');
{
  // 模拟真实场景：每个音在发声途中被模型再报一次
  const played = perfect();
  const dup = [];
  for (const p of played) {
    const mid = p.startTimeSeconds + p.durationSeconds * 0.6;
    if (mid > p.startTimeSeconds) {
      dup.push({
        pitchMidi: p.pitchMidi,
        startTimeSeconds: mid,
        durationSeconds: 0.2,
        amplitude: 0.3,
      });
    }
  }
  const r = evaluate(score, [...played, ...dup]);
  check('全部命中', r.hitCount === 42, `actual ${r.hitCount}`);
  check('重复触发被识别', r.retriggerCount > 0, `actual ${r.retriggerCount}`);
  check('不计为多弹', r.extraCount === 0, `actual ${r.extraCount}`);
  check('仍是满分', r.overall === 100, `actual ${r.overall}`);
}

console.log('\n[真的多弹了别的音]');
{
  const played = perfect();
  played.push({ pitchMidi: 61, startTimeSeconds: 0.5, durationSeconds: 0.4, amplitude: 0.5 });
  played.push({ pitchMidi: 66, startTimeSeconds: 3.5, durationSeconds: 0.4, amplitude: 0.5 });
  const r = evaluate(score, played);
  check('多弹 = 2', r.extraCount === 2, `actual ${r.extraCount}`);
  check('命中仍 42', r.hitCount === 42, `actual ${r.hitCount}`);
}

console.log('\n[回归：漏音/错音/节奏]');
{
  const missed = perfect().filter((_, i) => i !== 0);
  const r1 = evaluate(score, missed);
  check('漏音 1', r1.missCount === 1, `actual ${r1.missCount}`);

  const wrong = perfect();
  wrong[5] = { ...wrong[5], pitchMidi: wrong[5].pitchMidi + 2 };
  const r2 = evaluate(score, wrong);
  check('错音 1', r2.wrongCount === 1, `actual ${r2.wrongCount}`);

  const late = perfect().map((p) => ({ ...p, startTimeSeconds: p.startTimeSeconds + 0.25 * spb }));
  const r3 = evaluate(score, late);
  check('拖拍 0.25 拍', Math.abs(r3.timing.meanBeats - 0.25) < 1e-6, `actual ${r3.timing.meanBeats}`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
