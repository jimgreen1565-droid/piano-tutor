// 教练层校验：给几段"人造演奏"，看它有没有说对、说短、说到点子上
//
// 校验思路：不比对固定文案（话术会改），而是校验"该说的信息有没有出现、
// 不该出现的有没有出现、长度有没有超"。这才是讲评层的正确性。

import { readFileSync } from 'node:fs';
import { evaluate } from './src/score.js';
import { coachScript } from './src/coach.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) pass++;
  else {
    fail++;
    console.log('  ✗', msg);
  }
};

const load = (id) => JSON.parse(readFileSync(`public/scores/${id}.json`, 'utf8'));
const spbOf = (score) => 60 / score.bpm;

/** 按谱面"正确弹一遍"，可选注入毛病 */
function perform(score, mutate = () => ({})) {
  const spb = spbOf(score);
  const out = [];
  score.notes.forEach((n, i) => {
    const o = mutate(n, i) || {};
    if (o.drop) return;
    out.push({
      pitchMidi: n.pitchMidi + (o.semitone || 0),
      startTimeSeconds: n.beat * spb + (o.timeShiftSec || 0),
      durationSeconds: (n.durationBeats || 1) * spb * 0.9,
      amplitude: o.amplitude ?? 0.6,
    });
  });
  return out;
}

const twinkle = load('twinkle');
const fur = load('furelise');

console.log(`小星星: ${twinkle.notes.length} 音 / ${twinkle.totalMeasures} 小节, furelise: ${fur.notes.length} 音`);

// ---------- 用例 1：弹得很好 ----------
{
  const played = perform(twinkle);
  const r = evaluate(twinkle, played, { bpm: twinkle.bpm });
  const c = coachScript(r, twinkle, played, { bpm: twinkle.bpm });
  console.log(`\n[1] 满分演奏 → overall=${r.overall} 句数=${c.lines.length} 字数=${c.totalChars}`);
  console.log('    ' + c.lines.map((l) => `〔${l.kind}〕${l.text}`).join('\n    '));
  ok(r.overall >= 90, `满分演奏得分只有 ${r.overall}`);
  ok(c.totalChars <= 240, `口播超预算: ${c.totalChars} 字`);
  ok(c.lines.some((l) => l.kind === 'praise'), '弹得好却没给肯定');
  ok(c.lines.some((l) => l.kind === 'drill'), '没有给出练法');
  ok(!c.lines.some((l) => /第 \d+ 小节.*错/.test(l.text)), '满分却报了错音小节');
}

// ---------- 用例 2：第 5-6 小节漏音（卡壳）----------
{
  const played = perform(twinkle, (n) => (n.measure >= 5 && n.measure <= 6 ? { drop: true } : {}));
  const r = evaluate(twinkle, played, { bpm: twinkle.bpm });
  const c = coachScript(r, twinkle, played, { bpm: twinkle.bpm });
  console.log(`\n[2] 第5-6小节漏音 → miss=${r.missCount} focus=${JSON.stringify(c.focus)}`);
  console.log('    ' + c.lines.map((l) => `〔${l.kind}〕${l.text}`).join('\n    '));
  const issueText = c.lines.filter((l) => l.kind === 'issue').map((l) => l.text).join(' ');
  ok(r.missCount > 3, `漏音数不对: ${r.missCount}`);
  ok(/漏|没弹出来|卡/.test(issueText), '漏音没有被说成漏音');
  ok(c.focus && c.focus.from <= 5 && c.focus.to >= 6, `练法没指向第 5-6 小节: ${JSON.stringify(c.focus)}`);
  ok(c.focus.bpm < twinkle.bpm, `练法速度没降下来: ${c.focus.bpm} vs ${twinkle.bpm}`);
}

// ---------- 用例 3：整体高一个八度（识别层问题）----------
{
  const played = perform(twinkle, () => ({ semitone: 12 }));
  const r = evaluate(twinkle, played, { bpm: twinkle.bpm });
  const c = coachScript(r, twinkle, played, { bpm: twinkle.bpm });
  console.log(`\n[3] 整体高八度 → octaveShift=${r.octaveShift} 首句kind=${c.lines[0].kind}`);
  console.log('    ' + c.lines.map((l) => `〔${l.kind}〕${l.text}`).join('\n    '));
  ok(c.lines[0].kind === 'caution', '识别层偏差没有放在最前面说');
  ok(/识别|麦克风/.test(c.lines[0].text), '识别层说明没讲清是设备问题');
}

// ---------- 用例 4：后半段越弹越快 ----------
{
  const spb = spbOf(twinkle);
  const total = twinkle.notes.length;
  const played = twinkle.notes.map((n, i) => {
    const rush = i > total * 0.5 ? -0.16 : 0; // 后半段越来越早
    return {
      pitchMidi: n.pitchMidi,
      startTimeSeconds: n.beat * spb + rush,
      durationSeconds: (n.durationBeats || 1) * spb * 0.9,
      amplitude: 0.6,
    };
  });
  const r = evaluate(twinkle, played, { bpm: twinkle.bpm });
  const c = coachScript(r, twinkle, played, { bpm: twinkle.bpm });
  console.log(`\n[4] 后半段赶拍 → stdMs=${r.timing.stdMs} meanMs=${r.timing.meanMs}`);
  console.log('    ' + c.lines.map((l) => `〔${l.kind}〕${l.text}`).join('\n    '));
  const all = c.lines.map((l) => l.text).join(' ');
  const saidRush = /赶|越弹越快|忽快忽慢|偏快/.test(all);
  ok(saidRush, '后半段明显赶拍却没说');
}

// ---------- 用例 5：长曲（致爱丽丝）+ 结构与长度守门 ----------
{
  const played = perform(fur, (n, i) => ({
    semitone: i % 17 === 3 ? 2 : 0,
    drop: i % 23 === 7,
    timeShiftSec: i % 11 === 5 ? 0.14 : 0,
    amplitude: i % 7 === 0 ? 0.15 : 0.55,
  }));
  const r = evaluate(fur, played, { bpm: fur.bpm });
  const c = coachScript(r, fur, played, { bpm: fur.bpm });
  console.log(`\n[5] 致爱丽丝(混合毛病) → overall=${r.overall} 句数=${c.lines.length} 字数=${c.totalChars}`);
  console.log('    ' + c.lines.map((l) => `〔${l.kind}〕${l.text}`).join('\n    '));
  const issues = c.lines.filter((l) => /issue|next|plain/.test(l.kind));
  ok(issues.length <= 2, `问题条数超上限: ${issues.length}`);
  ok(c.totalChars <= 240, `口播超预算: ${c.totalChars} 字`);
  ok(c.lines.every((l) => l.text && l.text.length > 4), '有空句子');
  ok(
    c.lines.every((l) => !/[*#`<]|\n/.test(l.text)),
    '有句子含 markdown/HTML/换行，念出来会出戏',
  );
  ok(c.lines.filter((l) => l.kind === 'drill').length === 1, '练法不是恰好一条');
  if (c.focus) {
    ok(c.focus.from >= 1 && c.focus.to <= fur.totalMeasures, `focus 越界: ${JSON.stringify(c.focus)}`);
    ok(c.focus.to >= c.focus.from, 'focus 区间反了');
    ok(c.focus.to - c.focus.from + 1 <= 3, `练法区间超过 3 小节: ${JSON.stringify(c.focus)}`);
  }
  // 证据链：facts 里要说得出"为什么这么评"
  ok(c.facts && typeof c.facts.hitRate === 'number', 'facts 缺失');
  ok(c.facts.topIssues.length <= 2, 'facts 里问题条数超上限');
}

// ---------- 用例 6：力度明显偏轻 ----------
{
  const played = perform(twinkle, () => ({ amplitude: 0.12 }));
  const r = evaluate(twinkle, played, { bpm: twinkle.bpm });
  const c = coachScript(r, twinkle, played, { bpm: twinkle.bpm });
  const all = c.lines.map((l) => l.text).join(' ');
  console.log(`\n[6] 力度很轻 → ${/轻/.test(all) ? '说了' : '没说'}  | ${all.slice(0, 60)}`);
  // 音都对了，此时应当只说音色/力度层面的事，或直接给下一步
  ok(r.overall >= 80, `力度不影响音准分，得分应仍高: ${r.overall}`);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
