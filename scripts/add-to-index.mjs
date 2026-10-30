import { readFileSync, writeFileSync } from 'node:fs';

const idx = JSON.parse(readFileSync('public/scores/index.json', 'utf8'));

for (const id of ['castle', 'laputa']) {
  const j = JSON.parse(readFileSync(`public/scores/${id}.json`, 'utf8'));
  if (!idx.some((p) => p.id === id)) {
    idx.push({
      id: j.id,
      title: j.title,
      level: j.level,
      levelName: j.levelName,
      kind: j.kind,
      bpm: j.bpm,
      totalMeasures: j.totalMeasures,
      totalNotes: j.notes.length,
      totalBeats: j.totalBeats,
      durationSec: Math.round((j.totalBeats * 60) / j.bpm),
      timeSignature: j.timeSignature,
    });
    console.log('加入索引:', j.title);
  } else {
    console.log('已存在:', id);
  }
}

writeFileSync('public/scores/index.json', JSON.stringify(idx, null, 2));
console.log('总数:', idx.length);
