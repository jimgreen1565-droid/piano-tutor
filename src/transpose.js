// 移调：整体平移音高（正值升 / 负值降，单位半音，含八度 ±12）
// 同时作用在 MusicXML（渲染用）与 scoreJson.notes（评分/示范用），保证一致。

const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function nameFromMidi(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  // 优先用升号系；B/F 调这类用降号系由调用方传入
  return { step: SHARP[pc][0], alter: SHARP[pc].length > 1 ? 1 : 0, octave: oct, pc };
}

/** 平移一个 pitchMidi（用升降号适配） */
export function pitchMidiToName(midi, { preferFlat = false } = {}) {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  const n = (preferFlat ? FLAT : SHARP)[pc];
  return { step: n[0], alter: n.length > 1 ? (n[1] === '#' ? 1 : -1) : 0, octave: oct };
}

/** 平移 MusicXML 字符串：把所有 <step>..</step><octave>..</octave> 按 shift 半音重写 */
export function transposeMusicXml(xml, shift) {
  if (!shift) return xml;
  return xml.replace(
    /<pitch>\s*<step>([A-G])<\/step>\s*(?:<alter>(-?[0-9]+)<\/alter>\s*)?<octave>(-?[0-9]+)<\/octave>\s*<\/pitch>/g,
    (_all, step, alter, octave) => {
      const midi = (Number(octave) + 1) * 12 + SEMITONE[step] + (alter ? Number(alter) : 0);
      const nm = pitchMidiToName(midi + shift);
      const alt = nm.alter ? `<alter>${nm.alter}</alter>` : '';
      return `<pitch><step>${nm.step}</step>${alt}<octave>${nm.octave}</octave></pitch>`;
    },
  );
}

/** 平移 scoreJson.notes 的 pitchMidi */
export function transposeScore(scoreJson, shift) {
  if (!shift || !scoreJson || !scoreJson.notes) return scoreJson;
  return {
    ...scoreJson,
    notes: scoreJson.notes.map((n) => ({ ...n, pitchMidi: n.pitchMidi + shift })),
  };
}