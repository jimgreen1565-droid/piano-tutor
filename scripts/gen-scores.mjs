import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'public/scores';
mkdirSync(OUT, { recursive: true });

const DIVISIONS = 2; // 半拍为最小单位

const STEP = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function parsePitch(name) {
  const m = name.match(/^([A-G])(#|b)?(\d)$/);
  if (!m) throw new Error('bad pitch: ' + name);
  const step = m[1];
  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = Number(m[3]);
  const midi = (octave + 1) * 12 + SEMITONE[step] + alter;
  return { step, alter, octave, midi };
}

function typeFor(beats) {
  if (beats === 4) return 'whole';
  if (beats === 3) return 'half'; // dotted half handled below
  if (beats === 2) return 'half';
  if (beats === 1.5) return 'quarter'; // dotted quarter
  if (beats === 1) return 'quarter';
  if (beats === 0.5) return 'eighth';
  return 'quarter';
}

function noteXml(name, beats) {
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

/**
 * measures: [[ [pitchName, beats], ... ], ...]
 */
function buildXml(title, measures, opts = {}) {
  const bpm = opts.bpm || 60;
  let body = '';

  measures.forEach((notes, i) => {
    let sum = 0;
    const parts = [];

    if (i === 0) {
      parts.push(`      <attributes>
        <divisions>${DIVISIONS}</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
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
    // 补齐小节
    if (sum < 4) {
      parts.push(restXml(4 - sum));
    }

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

function buildJson(id, title, difficulty, measures, bpm) {
  const notes = [];
  let beat = 0;
  const flat = [];
  measures.forEach((ms, mi) => {
    let sum = 0;
    for (const [name, beats] of ms) {
      flat.push({ pitchMidi: parsePitch(name).midi, beat, durationBeats: beats, measure: mi + 1 });
      beat += beats;
      sum += beats;
    }
    if (sum < 4) beat += 4 - sum;
  });
  return {
    id,
    title,
    difficulty,
    bpm,
    divisions: DIVISIONS,
    timeSignature: { beats: 4, beatType: 4 },
    totalMeasures: measures.length,
    totalBeats: beat,
    notes: flat,
  };
}

// ---------- 曲目定义 ----------

const TWINKLE = [
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
];

const ODE = [
  [['E4', 1], ['E4', 1], ['F4', 1], ['G4', 1]],
  [['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1]],
  [['C4', 1], ['C4', 1], ['D4', 1], ['E4', 1]],
  [['E4', 1.5], ['D4', 0.5], ['D4', 2]],
  [['E4', 1], ['E4', 1], ['F4', 1], ['G4', 1]],
  [['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1]],
  [['C4', 1], ['C4', 1], ['D4', 1], ['E4', 1]],
  [['D4', 1.5], ['C4', 0.5], ['C4', 2]],
];

const MARY = [
  [['E4', 1], ['D4', 1], ['C4', 1], ['D4', 1]],
  [['E4', 1], ['E4', 1], ['E4', 2]],
  [['D4', 1], ['D4', 1], ['D4', 2]],
  [['E4', 1], ['G4', 1], ['G4', 2]],
  [['E4', 1], ['D4', 1], ['C4', 1], ['D4', 1]],
  [['E4', 1], ['E4', 1], ['E4', 1], ['E4', 1]],
  [['D4', 1], ['D4', 1], ['E4', 1], ['D4', 1]],
  [['C4', 4]],
];

const FRERE = [
  [['C4', 1], ['D4', 1], ['E4', 1], ['C4', 1]],
  [['C4', 1], ['D4', 1], ['E4', 1], ['C4', 1]],
  [['E4', 1], ['F4', 1], ['G4', 2]],
  [['E4', 1], ['F4', 1], ['G4', 2]],
  [['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['F4', 0.5], ['E4', 1], ['C4', 1]],
  [['C4', 1], ['D4', 1], ['E4', 1], ['C4', 1]],
  [['G4', 1], ['G4', 1], ['C4', 2]],
];

const pieces = [
  { id: 'twinkle', title: '小星星', difficulty: 1, measures: TWINKLE, bpm: 60 },
  { id: 'mary', title: '玛丽有只小羊羔', difficulty: 1, measures: MARY, bpm: 60 },
  { id: 'frere', title: '两只老虎', difficulty: 2, measures: FRERE, bpm: 60 },
  { id: 'ode', title: '欢乐颂', difficulty: 2, measures: ODE, bpm: 60 },
];

const index = [];

for (const p of pieces) {
  const xml = buildXml(p.title, p.measures, { bpm: p.bpm });
  writeFileSync(join(OUT, `${p.id}.musicxml`), xml, 'utf8');

  const json = buildJson(p.id, p.title, p.difficulty, p.measures, p.bpm);
  writeFileSync(join(OUT, `${p.id}.json`), JSON.stringify(json, null, 2), 'utf8');

  index.push({
    id: p.id,
    title: p.title,
    difficulty: p.difficulty,
    bpm: p.bpm,
    totalMeasures: p.measures.length,
    totalNotes: json.notes.length,
    totalBeats: json.totalBeats,
  });

  console.log(
    `✓ ${p.id}: ${p.title}  ${p.measures.length} 小节 / ${json.notes.length} 音符 / ${json.totalBeats} 拍`,
  );
}

writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
console.log('\n✓ public/scores/index.json');
