// 从 public/scores/*.json 重建 index.json（单一事实来源：曲谱文件本身）
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'public/scores';
const LEVELS = { 1: '入门', 2: '初级', 3: '中级', 4: '进阶' };

const index = [];
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  const j = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
  if (!j.id || !Array.isArray(j.notes)) continue;
  index.push({
    id: j.id,
    title: j.title,
    level: j.level,
    levelName: LEVELS[j.level] || '中级',
    kind: j.kind || 'song',
    bpm: j.bpm,
    totalMeasures: j.totalMeasures,
    totalNotes: j.notes.length,
    totalBeats: j.totalBeats,
    durationSec: Math.round((j.totalBeats * 60) / j.bpm),
    timeSignature: j.timeSignature,
  });
}

index.sort((a, b) => a.level - b.level || a.title.localeCompare(b.title, 'zh'));
writeFileSync(`${DIR}/index.json`, JSON.stringify(index, null, 2));

const longs = index.filter((p) => p.durationSec >= 90);
console.log(`✓ index 重建：${index.length} 首，其中 90 秒以上 ${longs.length} 首`);
for (const p of longs) {
  console.log(
    `   ${p.levelName} ${p.title.padEnd(24)} ${p.totalMeasures}小节 ${p.totalNotes}音 ${Math.floor(p.durationSec / 60)}分${String(p.durationSec % 60).padStart(2, '0')}秒 @${p.bpm}`,
  );
}
