import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'public/scores';
mkdirSync(OUT, { recursive: true });

const DIVISIONS = 2;
const TS4 = { beats: 4, beatType: 4 };
const TS3 = { beats: 3, beatType: 3 };

const LEVELS = { 1: '入门', 2: '初级', 3: '中级', 4: '进阶' };

const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// ---------- 音名工具 ----------

function parsePitch(name) {
  const m = name.match(/^([A-G])(#|b)?(-?\d)$/);
  if (!m) throw new Error('bad pitch: ' + name);
  const step = m[1];
  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = Number(m[3]);
  const midi = (octave + 1) * 12 + SEMITONE[step] + alter;
  return { step, alter, octave, midi };
}

function nameFromMidi(midi, preferFlat = false) {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${(preferFlat ? FLAT_NAMES : SHARP_NAMES)[pc]}${oct}`;
}

// 各调音阶的正确拼写（Bb 不能写成 A#）
const MAJOR_SPELL = {
  C: [['C', 0], ['D', 0], ['E', 0], ['F', 0], ['G', 0], ['A', 0], ['B', 0]],
  G: [['G', 0], ['A', 0], ['B', 0], ['C', 0], ['D', 0], ['E', 0], ['F', 1]],
  D: [['D', 0], ['E', 0], ['F', 1], ['G', 0], ['A', 0], ['B', 0], ['C', 1]],
  A: [['A', 0], ['B', 0], ['C', 1], ['D', 0], ['E', 0], ['F', 1], ['G', 1]],
  E: [['E', 0], ['F', 1], ['G', 1], ['A', 0], ['B', 0], ['C', 1], ['D', 1]],
  F: [['F', 0], ['G', 0], ['A', 0], ['B', -1], ['C', 0], ['D', 0], ['E', 0]],
  Bb: [['B', -1], ['C', 0], ['D', 0], ['E', -1], ['F', 0], ['G', 0], ['A', 0]],
  Eb: [['E', -1], ['F', 0], ['G', 0], ['A', -1], ['B', -1], ['C', 0], ['D', 0]],
};

const MINOR_SPELL = {
  A: [['A', 0], ['B', 0], ['C', 0], ['D', 0], ['E', 0], ['F', 0], ['G', 1]],
  E: [['E', 0], ['F', 1], ['G', 0], ['A', 0], ['B', 0], ['C', 0], ['D', 1]],
};

const KEY_ROOT = {
  C: 'C4', G: 'G4', D: 'D4', A: 'A4', E: 'E4', F: 'F4', Bb: 'Bb4', Eb: 'Eb4',
};

const FLAT_KEYS = ['F', 'Bb', 'Eb'];

// ---------- MusicXML ----------

function typeFor(beats) {
  if (beats === 4) return 'whole';
  if (beats === 3) return 'half';
  if (beats === 2) return 'half';
  if (beats === 1.5) return 'quarter';
  if (beats === 1) return 'quarter';
  if (beats === 0.5) return 'eighth';
  return 'quarter';
}

const VALID_BEATS = new Set([0.5, 1, 1.5, 2, 3, 4]);

function noteXml(name, beats) {
  if (!VALID_BEATS.has(beats)) throw new Error(`非法时值 ${beats} in ${name}`);
  const p = parsePitch(name);
  const dur = Math.round(beats * DIVISIONS);
  const type = typeFor(beats);
  const dotted = beats === 1.5 || beats === 3 ? '<dot/>' : '';
  const alter = p.alter ? `<alter>${p.alter}</alter>` : '';
  return `      <note>
        <pitch><step>${p.step}</step>${alter}<octave>${p.octave}</octave></pitch>
        <duration>${dur}</duration>
        <type>${type}</type>${dotted}
      </note>`;
}

function restXml(beats) {
  const dur = Math.round(beats * DIVISIONS);
  return `      <note>
        <rest/>
        <duration>${dur}</duration>
        <type>${typeFor(beats)}</type>
      </note>`;
}

function buildXml(title, measures, { bpm, ts }) {
  let body = '';

  measures.forEach((notes, i) => {
    let sum = 0;
    const parts = [];

    if (i === 0) {
      parts.push(`      <attributes>
        <divisions>${DIVISIONS}</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>${ts.beats}</beats><beat-type>${ts.beatType}</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>`);
      parts.push(`      <direction placement="above">
        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type>
        <sound tempo="${bpm}"/>
      </direction>`);
    }

    for (const [name, beats] of notes) {
      parts.push(noteXml(name, beats));
      sum += beats;
    }
    if (sum < ts.beats - 1e-9) parts.push(restXml(ts.beats - sum));

    body += `    <measure number="${i + 1}">\n${parts.join('\n')}\n    </measure>\n`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
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
}

// ---------- 音符序列 → 小节 ----------

function toMeasures(seq, tsBeats) {
  const measures = [];
  let cur = [];
  let sum = 0;

  for (const n of seq) {
    cur.push([n.name, n.beats]);
    sum += n.beats;
    if (Math.abs(sum - tsBeats) < 1e-9) {
      measures.push(cur);
      cur = [];
      sum = 0;
    } else if (sum > tsBeats + 1e-9) {
      throw new Error(`小节溢出 ${sum} > ${tsBeats}`);
    }
  }

  if (cur.length) {
    const need = tsBeats - sum;
    const last = cur[cur.length - 1];
    const extended = last[1] + need;
    if (VALID_BEATS.has(extended)) last[1] = extended;
    measures.push(cur);
  }

  return measures;
}

// ---------- 练习生成器 ----------

const q = (name) => ({ name, beats: 1 });

function scaleSeq(key, octaves) {
  const root = parsePitch(KEY_ROOT[key]).midi;
  const spell = MAJOR_SPELL[key];
  const offsets = [0, 2, 4, 5, 7, 9, 11];
  const up = [];
  for (let o = 0; o < octaves; o++) {
    for (let d = 0; d < 7; d++) {
      const midi = root + o * 12 + offsets[d];
      const [step, alter] = spell[d];
      const oct = Math.floor(midi / 12) - 1;
      up.push(q(`${step}${alter > 0 ? '#' : alter < 0 ? 'b' : ''}${oct}`));
    }
  }
  up.push(q(nameFromMidi(root + octaves * 12, FLAT_KEYS.includes(key))));
  const down = [...up].reverse().slice(1);
  return [...up, ...down];
}

function minorSeq(key, octaves) {
  const root = parsePitch(KEY_ROOT[key]).midi;
  const spell = MINOR_SPELL[key];
  const offsets = [0, 2, 3, 5, 7, 8, 11];
  const up = [];
  for (let o = 0; o < octaves; o++) {
    for (let d = 0; d < 7; d++) {
      const midi = root + o * 12 + offsets[d];
      const [step, alter] = spell[d];
      const oct = Math.floor(midi / 12) - 1;
      up.push(q(`${step}${alter > 0 ? '#' : alter < 0 ? 'b' : ''}${oct}`));
    }
  }
  up.push(q(nameFromMidi(root + octaves * 12, FLAT_KEYS.includes(key))));
  const down = [...up].reverse().slice(1);
  return [...up, ...down];
}

function arpSeq(key, octaves) {
  const root = parsePitch(KEY_ROOT[key]).midi;
  const flat = FLAT_KEYS.includes(key);
  const up = [];
  for (let o = 0; o < octaves; o++) {
    for (const d of [0, 4, 7]) up.push(q(nameFromMidi(root + o * 12 + d, flat)));
  }
  up.push(q(nameFromMidi(root + octaves * 12, flat)));
  const down = [...up].reverse().slice(1);
  return [...up, ...down];
}

function fiveFingerSeq(key) {
  const root = parsePitch(KEY_ROOT[key]).midi;
  const flat = FLAT_KEYS.includes(key);
  const names = [0, 2, 4, 5, 7].map((d) => nameFromMidi(root + d, flat));
  return [...names.map(q), ...[...names].reverse().slice(1).map(q)];
}

function brokenSeq(key) {
  const root = parsePitch(KEY_ROOT[key]).midi;
  const flat = FLAT_KEYS.includes(key);
  const n = (d) => nameFromMidi(root + d, flat);
  return [n(0), n(4), n(7), n(4), n(12), n(7), n(4), n(0)].map(q);
}

function intervalSeq(key, semitones) {
  const root = parsePitch(KEY_ROOT[key]).midi;
  const flat = FLAT_KEYS.includes(key);
  const out = [];
  for (let i = 0; i < 7; i++) {
    out.push(q(nameFromMidi(root + i * 2, flat)));
    out.push(q(nameFromMidi(root + i * 2 + semitones, flat)));
  }
  out.push(q(nameFromMidi(root, flat)));
  return out;
}

function chromaticSeq(key, octaves) {
  const root = parsePitch(KEY_ROOT[key]).midi;
  const flat = FLAT_KEYS.includes(key);
  const up = [];
  for (let o = 0; o < octaves; o++) {
    for (let s = 0; s < 12; s++) up.push(q(nameFromMidi(root + o * 12 + s, flat)));
  }
  up.push(q(nameFromMidi(root + octaves * 12, flat)));
  const down = [...up].reverse().slice(1);
  return [...up, ...down];
}

function dominant7Seq(key) {
  const root = parsePitch(KEY_ROOT[key]).midi;
  const flat = FLAT_KEYS.includes(key);
  const n = (d) => nameFromMidi(root + d, flat);
  return [n(0), n(4), n(7), n(10), n(12), n(10), n(7), n(4), n(0)].map(q);
}

function dottedSeq() {
  return [
    ['C4', 1.5], ['D4', 0.5], ['E4', 1.5], ['F4', 0.5],
    ['G4', 1.5], ['A4', 0.5], ['B4', 1.5], ['C5', 0.5],
    ['C5', 1], ['B4', 1], ['A4', 1], ['G4', 1],
  ].map(([name, beats]) => ({ name, beats }));
}

function eighthSeq() {
  return [
    ['C4', 0.5], ['D4', 0.5], ['E4', 0.5], ['F4', 0.5],
    ['G4', 0.5], ['F4', 0.5], ['E4', 0.5], ['D4', 0.5],
    ['C4', 0.5], ['E4', 0.5], ['G4', 0.5], ['E4', 0.5],
    ['C5', 0.5], ['G4', 0.5], ['E4', 0.5], ['C4', 0.5],
    ['C4', 4],
  ].map(([name, beats]) => ({ name, beats }));
}

// ---------- 长曲生成器 ----------

const MAJOR_OFFSETS = [0, 2, 4, 5, 7, 9, 11];

/** 音阶级数（可超出 7）→ 带正确拼写的音名 */
function degreeName(key, degree) {
  const root = parsePitch(KEY_ROOT[key]).midi;
  const oct = Math.floor(degree / 7);
  const idx = ((degree % 7) + 7) % 7;
  const midi = root + oct * 12 + MAJOR_OFFSETS[idx];
  const [step, alter] = MAJOR_SPELL[key][idx];
  const nameOct = Math.floor(midi / 12) - 1;
  return `${step}${alter > 0 ? '#' : alter < 0 ? 'b' : ''}${nameOct}`;
}

/** 手指跑动练习：固定阶数型逐级上行 */
function fingerRunSeq(key, pattern, lastStart) {
  const out = [];
  for (let s = 0; s <= lastStart; s++) {
    for (const p of pattern) out.push(q(degreeName(key, s + p)));
  }
  out.push(q(degreeName(key, 0)));
  return out;
}

/** 多调音阶串联 */
function scaleCycleSeq(keys, octaves) {
  const out = [];
  for (const k of keys) out.push(...scaleSeq(k, octaves));
  return out;
}

/** 多调琶音串联 */
function arpCycleSeq(keys, octaves) {
  const out = [];
  for (const k of keys) out.push(...arpSeq(k, octaves));
  return out;
}

// ---------- 曲目表 ----------

function ex(id, title, level, seq, ts = TS4, bpm = 60) {
  return { id, title, level, kind: 'exercise', measures: toMeasures(seq, ts.beats), ts, bpm };
}

const songs = [
  {
    id: 'twinkle', title: '小星星', level: 1, kind: 'song', ts: TS4, bpm: 60,
    measures: [
      [['C4', 1], ['C4', 1], ['G4', 1], ['G4', 1]],
      [['A4', 1], ['A4', 1], ['G4', 2]],
      [['F4', 1], ['F4', 1], ['E4', 1], ['E4', 1]],
      [['D4', 1], ['D4', 1], ['C4', 2]],
      [['G4', 1], ['G4', 1], ['F4', 1], ['F4', 1]],
      [['E4', 1], ['E4', 1], ['D4', 2]],
      [['G4', 1], ['G4', 1], ['F4', 1], ['F4', 1]],
      [['E4', 1], ['E4', 1], ['D4', 2]],
      [['C4', 1], ['C4', 1], ['G4', 1], ['G4', 1]],
      [['A4', 1], ['A4', 1], ['G4', 2]],
      [['F4', 1], ['F4', 1], ['E4', 1], ['E4', 1]],
      [['D4', 1], ['D4', 1], ['C4', 2]],
    ],
  },
  {
    id: 'mary', title: '玛丽有只小羊羔', level: 1, kind: 'song', ts: TS4, bpm: 60,
    measures: [
      [['E4', 1], ['D4', 1], ['C4', 1], ['D4', 1]],
      [['E4', 1], ['E4', 1], ['E4', 2]],
      [['D4', 1], ['D4', 1], ['D4', 2]],
      [['E4', 1], ['G4', 1], ['G4', 2]],
      [['E4', 1], ['D4', 1], ['C4', 1], ['D4', 1]],
      [['E4', 1], ['E4', 1], ['E4', 1], ['E4', 1]],
      [['D4', 1], ['D4', 1], ['E4', 1], ['D4', 1]],
      [['C4', 4]],
    ],
  },
  {
    id: 'frere', title: '两只老虎', level: 2, kind: 'song', ts: TS4, bpm: 60,
    measures: [
      [['C4', 1], ['D4', 1], ['E4', 1], ['C4', 1]],
      [['C4', 1], ['D4', 1], ['E4', 1], ['C4', 1]],
      [['E4', 1], ['F4', 1], ['G4', 2]],
      [['E4', 1], ['F4', 1], ['G4', 2]],
      [['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['F4', 0.5], ['E4', 1], ['C4', 1]],
      [['C4', 1], ['D4', 1], ['E4', 1], ['C4', 1]],
      [['G4', 1], ['G4', 1], ['C4', 2]],
    ],
  },
  {
    id: 'ode', title: '欢乐颂', level: 2, kind: 'song', ts: TS4, bpm: 60,
    measures: [
      [['E4', 1], ['E4', 1], ['F4', 1], ['G4', 1]],
      [['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1]],
      [['C4', 1], ['C4', 1], ['D4', 1], ['E4', 1]],
      [['E4', 1.5], ['D4', 0.5], ['D4', 2]],
      [['E4', 1], ['E4', 1], ['F4', 1], ['G4', 1]],
      [['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1]],
      [['C4', 1], ['C4', 1], ['D4', 1], ['E4', 1]],
      [['D4', 1.5], ['C4', 0.5], ['C4', 2]],
    ],
  },
  {
    id: 'jingle', title: '铃儿响叮当', level: 2, kind: 'song', ts: TS4, bpm: 60,
    measures: [
      [['E4', 1], ['E4', 1], ['E4', 2]],
      [['E4', 1], ['E4', 1], ['E4', 2]],
      [['E4', 1], ['G4', 1], ['C4', 1], ['D4', 1]],
      [['E4', 4]],
      [['F4', 1], ['F4', 1], ['F4', 1], ['F4', 1]],
      [['F4', 1], ['E4', 1], ['E4', 1], ['E4', 1]],
      [['E4', 1], ['D4', 1], ['D4', 1], ['E4', 1]],
      [['D4', 2], ['G4', 2]],
    ],
  },
  {
    id: 'birthday', title: '生日快乐', level: 3, kind: 'song', ts: TS3, bpm: 66,
    measures: [
      [['G4', 0.5], ['G4', 0.5], ['A4', 1], ['G4', 1]],
      [['C5', 1], ['B4', 2]],
      [['G4', 0.5], ['G4', 0.5], ['A4', 1], ['G4', 1]],
      [['D5', 1], ['C5', 2]],
      [['G4', 0.5], ['G4', 0.5], ['G5', 1], ['E5', 1]],
      [['C5', 1], ['B4', 1], ['A4', 1]],
      [['F5', 0.5], ['F5', 0.5], ['E5', 1], ['C5', 1]],
      [['D5', 1], ['C5', 2]],
    ],
  },
];

const exercises = [
  // 入门（10）
  ex('fivefinger_c', '五指练习 · C 位', 1, fiveFingerSeq('C')),
  ex('fivefinger_g', '五指练习 · G 位', 1, fiveFingerSeq('G')),
  ex('fivefinger_f', '五指练习 · F 位', 1, fiveFingerSeq('F')),
  ex('fivefinger_d', '五指练习 · D 位', 1, fiveFingerSeq('D')),
  ex('scale_c', 'C 大调音阶', 1, scaleSeq('C', 1)),
  ex('scale_f', 'F 大调音阶', 1, scaleSeq('F', 1)),
  ex('scale_g', 'G 大调音阶', 1, scaleSeq('G', 1)),
  ex('arp_c', 'C 大调琶音', 1, arpSeq('C', 1)),
  ex('arp_g', 'G 大调琶音', 1, arpSeq('G', 1)),
  ex('rhythm_eighth', '八分音符练习', 1, eighthSeq()),

  // 初级（10）
  ex('scale_d', 'D 大调音阶', 2, scaleSeq('D', 1)),
  ex('scale_a', 'A 大调音阶', 2, scaleSeq('A', 1)),
  ex('scale_e', 'E 大调音阶', 2, scaleSeq('E', 1)),
  ex('arp_f', 'F 大调琶音', 2, arpSeq('F', 1)),
  ex('arp_d', 'D 大调琶音', 2, arpSeq('D', 1)),
  ex('broken_c', 'C 分解和弦', 2, brokenSeq('C')),
  ex('broken_g', 'G 分解和弦', 2, brokenSeq('G')),
  ex('thirds_c', '三度模进 · C', 2, intervalSeq('C', 4)),
  ex('fifths_c', '五度模进 · C', 2, intervalSeq('C', 7)),
  ex('rhythm_dotted', '附点节奏练习', 2, dottedSeq()),

  // 中级（12）
  ex('scale_c_2o', 'C 大调音阶 · 两个八度', 3, scaleSeq('C', 2)),
  ex('scale_g_2o', 'G 大调音阶 · 两个八度', 3, scaleSeq('G', 2)),
  ex('scale_bb', '降 B 大调音阶', 3, scaleSeq('Bb', 1)),
  ex('arp_c_2o', 'C 大调琶音 · 两个八度', 3, arpSeq('C', 2)),
  ex('arp_g_2o', 'G 大调琶音 · 两个八度', 3, arpSeq('G', 2)),
  ex('broken_f', 'F 分解和弦', 3, brokenSeq('F')),
  ex('broken_d', 'D 分解和弦', 3, brokenSeq('D')),
  ex('thirds_g', '三度模进 · G', 3, intervalSeq('G', 4)),
  ex('sixths_c', '六度模进 · C', 3, intervalSeq('C', 9)),
  ex('chromatic_c', 'C 半音阶', 3, chromaticSeq('C', 1)),
  ex('minor_a', 'a 和声小调音阶', 3, minorSeq('A', 1)),
  ex('octave_c', '八度跳进练习', 3, intervalSeq('C', 12)),

  // 进阶（12）
  ex('scale_eb', '降 E 大调音阶', 4, scaleSeq('Eb', 1)),
  ex('scale_f_2o', 'F 大调音阶 · 两个八度', 4, scaleSeq('F', 2)),
  ex('scale_a_2o', 'A 大调音阶 · 两个八度', 4, scaleSeq('A', 2)),
  ex('arp_f_2o', 'F 大调琶音 · 两个八度', 4, arpSeq('F', 2)),
  ex('broken_c_2o', 'C 分解和弦 · 两个八度', 4, [...brokenSeq('C'), ...brokenSeq('C')]),
  ex('thirds_c_2o', '三度模进 · C 两个八度', 4, [...intervalSeq('C', 4), ...intervalSeq('C', 4)]),
  ex('sixths_f', '六度模进 · F', 4, intervalSeq('F', 9)),
  ex('dom7_c', 'C 属七分解', 4, dominant7Seq('C')),
  ex('dom7_g', 'G 属七分解', 4, dominant7Seq('G')),
  ex('minor_e', 'e 和声小调音阶', 4, minorSeq('E', 1)),
  ex('chromatic_g', 'G 半音阶', 4, chromaticSeq('G', 1)),
  ex('fifths_g', '五度模进 · G', 4, intervalSeq('G', 7)),
];

const pieces = [...songs, ...exercises];

// ---------- 长曲（2 分钟量级） ----------

const songById = Object.fromEntries(songs.map((s) => [s.id, s]));

const ALL_KEYS_8 = ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb'];

const longPieces = [
  {
    id: 'medley_kids',
    title: '儿歌串烧 · 四首连弹',
    level: 2,
    kind: 'song',
    ts: TS4,
    bpm: 60,
    measures: [
      ...songById.twinkle.measures,
      ...songById.mary.measures,
      ...songById.frere.measures,
      ...songById.ode.measures,
    ],
  },
  ex(
    'finger_run1_3o',
    '手指跑动练习 · 顺进（三个八度）',
    3,
    fingerRunSeq('C', [0, 1, 2, 3, 4, 3, 2, 1], 20),
  ),
  ex(
    'finger_run2_2o',
    '手指跑动练习 · 折返（两个八度）',
    3,
    fingerRunSeq('C', [0, 2, 4, 5, 4, 2, 1, 0], 13),
  ),
  ex('scale_cycle8', '八个大调音阶串联', 4, scaleCycleSeq(ALL_KEYS_8, 1)),
  ex('arp_cycle8', '八个大调琶音串联', 4, arpCycleSeq(ALL_KEYS_8, 1)),
  ex(
    'finger_run3_3o',
    '手指跑动练习 · 三度折返（三个八度）',
    4,
    fingerRunSeq('C', [0, 2, 4, 6, 4, 2, 0, 2], 18),
  ),
];

// ---------- 输出 ----------

const index = [];
const seen = new Set();

for (const p of [...pieces, ...longPieces]) {
  if (seen.has(p.id)) throw new Error('重复 id: ' + p.id);
  seen.add(p.id);

  const xml = buildXml(p.title, p.measures, { bpm: p.bpm, ts: p.ts });
  writeFileSync(join(OUT, `${p.id}.musicxml`), xml, 'utf8');

  const flat = [];
  let beat = 0;
  p.measures.forEach((ms, mi) => {
    let sum = 0;
    for (const [name, beats] of ms) {
      flat.push({
        pitchMidi: parsePitch(name).midi,
        beat,
        durationBeats: beats,
        measure: mi + 1,
      });
      beat += beats;
      sum += beats;
    }
    if (sum < p.ts.beats) beat += p.ts.beats - sum;
  });

  if (beat % p.ts.beats !== 0) throw new Error(`${p.id} 拍数不整: ${beat}`);

  const json = {
    id: p.id,
    title: p.title,
    level: p.level,
    levelName: LEVELS[p.level],
    kind: p.kind,
    bpm: p.bpm,
    divisions: DIVISIONS,
    timeSignature: p.ts,
    totalMeasures: p.measures.length,
    totalBeats: beat,
    notes: flat,
  };
  writeFileSync(join(OUT, `${p.id}.json`), JSON.stringify(json, null, 2), 'utf8');

  index.push({
    id: p.id,
    title: p.title,
    level: p.level,
    levelName: LEVELS[p.level],
    kind: p.kind,
    bpm: p.bpm,
    totalMeasures: p.measures.length,
    totalNotes: flat.length,
    totalBeats: beat,
    durationSec: Math.round((beat * 60) / p.bpm),
    timeSignature: p.ts,
  });
}

writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2), 'utf8');

const byLevel = {};
for (const p of index) byLevel[p.level] = (byLevel[p.level] || 0) + 1;

console.log(`✓ 共 ${index.length} 首（曲子 ${songs.length} / 练习 ${exercises.length}）`);
for (const lv of [1, 2, 3, 4]) {
  console.log(`   ${LEVELS[lv]}: ${byLevel[lv] || 0} 首`);
}
