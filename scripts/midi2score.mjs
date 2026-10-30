// MIDI → piano-tutor 谱面转换器
// 输入：单乐器 MIDI 文件；输出：.json（评分用）+ .musicxml（渲染用）
//
// 处理链：
//   1. 解析 MIDI，选旋律轨（平均音高最高的轨）
//   2. 秒 → 拍（用文件自带 BPM）
//   3. 量化到八分音符；同一起音点合并（保留最低音=基音）
//   4. 同音连续 → 合并时值；时值上限 4 拍
//   5. 按小节切分，生成 MusicXML + 评分 JSON

import { readFileSync, writeFileSync } from 'node:fs';
import midiPkg from '@tonejs/midi';

const { Midi } = midiPkg;

const [,, inFile, id, title, levelArg] = process.argv;
if (!inFile || !id || !title) {
  console.error('用法: node midi2score.mjs <in.mid> <id> <标题> [level]');
  process.exit(1);
}
const level = Number(levelArg || 3);

const OUT_JSON = `public/scores/${id}.json`;
const OUT_XML = `public/scores/${id}.musicxml`;

const DIVISIONS = 2;
const TS = { beats: 4, beatType: 4 };
const QUANT = 0.5; // 八分量化
const MAX_DUR = 4;
const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToName(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${NAMES_SHARP[pc]}${oct}`;
}

function nameParts(name) {
  const m = name.match(/^([A-G])(#|b)?(-?\d)$/);
  return {
    step: m[1],
    alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0,
    octave: Number(m[3]),
  };
}

function typeFor(beats) {
  if (beats === 4) return 'whole';
  if (beats === 3) return 'half';
  if (beats === 2) return 'half';
  if (beats === 1.5) return 'quarter';
  if (beats === 1) return 'quarter';
  if (beats === 0.5) return 'eighth';
  return null;
}

const midi = new Midi(readFileSync(inFile));

// BPM
const bpm = midi.header.tempos.length
  ? Math.round(midi.header.tempos[0].bpm)
  : 60;

// 选旋律轨：平均音高最高、且音符数 > 20
const candidates = midi.tracks
  .filter((t) => t.notes.length > 20)
  .map((t) => ({
    track: t,
    avg: t.notes.reduce((s, n) => s + n.midi, 0) / t.notes.length,
  }))
  .sort((a, b) => b.avg - a.avg);

if (!candidates.length) {
  console.error('没有含音符的轨道');
  process.exit(1);
}
const melody = candidates[0].track;
console.log(
  `旋律轨: "${melody.name || '(unnamed)'}" 音符=${melody.notes.length} 平均音高=${candidates[0].avg.toFixed(1)} | BPM=${bpm}`,
);

// 秒 → 拍
const beatsPerSec = bpm / 60;
let raw = melody.notes
  .map((n) => ({
    midi: n.midi,
    beat: n.time * beatsPerSec,
    dur: Math.max(QUANT, n.duration * beatsPerSec),
  }))
  .sort((a, b) => a.beat - b.beat || a.midi - b.midi);

// 量化 + 同起音点合并（保留最低音）
const qMap = new Map();
for (const n of raw) {
  const qb = Math.round(n.beat / QUANT) * QUANT;
  const qd = Math.max(QUANT, Math.round(n.dur / QUANT) * QUANT);
  const key = qb;
  const cur = qMap.get(key);
  if (!cur || n.midi < cur.midi) {
    qMap.set(key, { midi: n.midi, beat: qb, dur: qd });
  }
}
raw = [...qMap.values()].sort((a, b) => a.beat - b.beat);

// 同音连续合并；限制时值不超过到下一个音的距离、上限 4 拍
const merged = [];
for (const n of raw) {
  const last = merged[merged.length - 1];
  if (last && last.midi === n.midi && n.beat - (last.beat + last.dur) < 0.26) {
    last.dur = n.beat + n.dur - last.beat;
    continue;
  }
  merged.push({ ...n });
}
for (let i = 0; i < merged.length; i++) {
  const next = merged[i + 1];
  let dur = Math.min(merged[i].dur, MAX_DUR);
  if (next) dur = Math.min(dur, next.beat - merged[i].beat);
  merged[i].dur = Math.max(QUANT, Math.round(dur / QUANT) * QUANT);
}

// 去掉超出小节边界的碎音（量化后 dur 只能是 0.5/1/1.5/2/3/4）
const VALID = new Set([0.5, 1, 1.5, 2, 3, 4]);
const notes = merged.filter((n) => VALID.has(n.dur));

if (!notes.length) {
  console.error('量化后没有音符');
  process.exit(1);
}

// 切小节
const totalBeats = Math.ceil(
  (notes[notes.length - 1].beat + notes[notes.length - 1].dur) / TS.beats,
) * TS.beats;

const measures = [];
let mi = 0;
let cur = [];
let curSum = 0;
for (const n of notes) {
  const mStart = Math.floor(n.beat / TS.beats) * TS.beats;
  while (mi * TS.beats < mStart) {
    if (cur.length) {
      cur.push(['R', TS.beats - curSum]);
      measures.push(cur);
    }
    mi++;
    cur = [];
    curSum = 0;
  }
  let remaining = n.dur;
  let pos = n.beat;
  // 跨小节的音拆成两个（简单处理：截到小节线）
  while (remaining > 0) {
    const barEnd = (Math.floor(pos / TS.beats) + 1) * TS.beats;
    const take = Math.min(remaining, barEnd - pos);
    const t = VALID.has(take) ? take : take > 4 ? 4 : 0.5;
    cur.push([midiToName(n.midi), t]);
    curSum += t;
    pos += t;
    remaining -= t;
    if (pos >= barEnd) {
      // 补休止到小节满
      if (curSum < TS.beats && VALID.has(TS.beats - curSum)) {
        cur.push(['R', TS.beats - curSum]);
      }
      measures.push(cur);
      mi++;
      cur = [];
      curSum = 0;
    }
  }
}
if (cur.length) {
  if (curSum < TS.beats && VALID.has(TS.beats - curSum)) {
    cur.push(['R', TS.beats - curSum]);
  }
  measures.push(cur);
}

// ---------- MusicXML ----------

function noteXml([name, beats]) {
  const dur = Math.round(beats * DIVISIONS);
  const type = typeFor(beats);
  const dotted = beats === 1.5 || beats === 3 ? '<dot/>' : '';
  if (name === 'R') {
    return `      <note>
        <rest/>
        <duration>${dur}</duration>
        <type>${type}</type>${dotted}
      </note>`;
  }
  const p = nameParts(name);
  const alter = p.alter ? `<alter>${p.alter}</alter>` : '';
  return `      <note>
        <pitch><step>${p.step}</step>${alter}<octave>${p.octave}</octave></pitch>
        <duration>${dur}</duration>
        <type>${type}</type>${dotted}
      </note>`;
}

let body = '';
measures.forEach((ms, i) => {
  const parts = [];
  if (i === 0) {
    parts.push(`      <attributes>
        <divisions>${DIVISIONS}</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>${TS.beats}</beats><beat-type>${TS.beatType}</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>`);
    parts.push(`      <direction placement="above">
        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type>
        <sound tempo="${bpm}"/>
      </direction>`);
  }
  parts.push(...ms.map(noteXml));
  body += `    <measure number="${i + 1}">\n${parts.join('\n')}\n    </measure>\n`;
});

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${title}</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
${body}  </part>
</score-partwise>
`;
writeFileSync(OUT_XML, xml, 'utf8');

// ---------- 评分 JSON ----------

const flat = [];
for (const [mi2, ms] of measures.entries()) {
  let b = mi2 * TS.beats;
  for (const [name, beats] of ms) {
    if (name !== 'R') {
      const p = nameParts(name);
      flat.push({
        pitchMidi: (p.octave + 1) * 12 + SEMITONE[p.step] + p.alter,
        beat: b,
        durationBeats: beats,
        measure: mi2 + 1,
      });
    }
    b += beats;
  }
}

const LEVELS = { 1: '入门', 2: '初级', 3: '中级', 4: '进阶' };
const json = {
  id,
  title,
  level,
  levelName: LEVELS[level] || '中级',
  kind: 'song',
  bpm,
  divisions: DIVISIONS,
  timeSignature: TS,
  totalMeasures: measures.length,
  totalBeats: measures.length * TS.beats,
  notes: flat,
};
writeFileSync(OUT_JSON, JSON.stringify(json, null, 2), 'utf8');

const durationSec = Math.round((measures.length * TS.beats * 60) / bpm);
console.log(
  `✓ ${id}: ${title} — ${measures.length} 小节 / ${flat.length} 音 / ${Math.floor(durationSec / 60)}分${durationSec % 60}秒 @ ${bpm}BPM`,
);
