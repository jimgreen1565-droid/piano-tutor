import { cleanNotes } from './src/notes.js';

// iPad 实测的 11 个原始音符（Basic Pitch 输出）
const raw = [
  ['C5', 1.54, 0.41],
  ['C4', 1.54, 0.07],
  ['C4', 1.61, 0.78],
  ['D6', 2.39, 0.21],
  ['D4', 2.39, 0.56],
  ['D4', 2.95, 0.22],
  ['E5', 3.29, 0.09],
  ['E4', 3.3, 0.83],
  ['F4', 4.12, 0.07],
  ['F4', 4.21, 0.79],
  ['G4', 5.04, 0.99],
].map(([name, t, len]) => ({
  name,
  startTimeSeconds: t,
  durationSeconds: len,
  amplitude: 0.5,
  pitchMidi: midi(name),
}));

function midi(n) {
  const m = n.match(/^([A-G])(#?)(\d)$/);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  return base + (m[2] ? 1 : 0) + (Number(m[3]) + 1) * 12;
}

const out = cleanNotes(raw);

console.log(`原始 ${raw.length} 个 → 清理后 ${out.length} 个\n`);
console.log('原始：', raw.map((n) => `${n.name}@${n.startTimeSeconds}`).join(' '));
console.log('清理：', out.map((n) => `${n.name}@${n.startTimeSeconds}`).join(' '));

const ok = out.length === 6;
console.log(`\n${ok ? '✓ 期望 6 个，符合' : '✗ 期望 6 个，实际 ' + out.length}`);
process.exit(ok ? 0 : 1);
