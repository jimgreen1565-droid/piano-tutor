// 从 bitmidi.com 批量下载 MIDI 源文件
// 用法: node scripts/fetch-midi.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const TARGETS = [
  { q: 'fur elise', id: 'furelise', title: '致爱丽丝', level: 4 },
  { q: 'canon in d major', id: 'canon_d', title: '卡农 · D大调', level: 3 },
  { q: 'mariage damour', id: 'mariage', title: '梦中的婚礼', level: 4 },
  { q: 'summer hisaishi', id: 'summer', title: 'Summer · 菊次郎的夏天', level: 4 },
  { q: 'one summers day', id: 'onesummersday', title: '那个夏天 · 千与千寻', level: 4 },
  { q: 'always with me', id: 'itsumo', title: '永远同在 · 千与千寻', level: 3 },
  { q: 'moon river', id: 'moonriver', title: 'Moon River', level: 3 },
  { q: 'let it be', id: 'letitbe', title: 'Let It Be', level: 3 },
  { q: 'yesterday once more', id: 'yesterday', title: '昨日重现', level: 3 },
  { q: 'pathetique second movement', id: 'pathetique', title: '悲怆 · 第二乐章', level: 4 },
  { q: 'nocturne op 9 no 2 chopin', id: 'nocturne', title: '夜曲 Op.9-2', level: 4 },
  { q: 'air on the g string bach', id: 'airg', title: 'G弦上的咏叹调', level: 3 },
  { q: 'river flows in you', id: 'riverflows', title: 'River Flows in You', level: 4 },
];

async function getText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function getBuffer(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function pickDetail(html, q) {
  const kw = q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .split('-')
    .filter((w) => w.length > 2);
  const links = [
    ...new Set(
      [...html.matchAll(/href="(\/[a-z0-9][a-z0-9-]*-mid)"/gi)].map((m) => m[1]),
    ),
  ];
  let best = null;
  let bestScore = 0;
  for (const u of links) {
    const s = u.toLowerCase();
    let score = 0;
    for (const k of kw) if (s.includes(k)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = u;
    }
  }
  return bestScore > 0 ? { link: best, score: bestScore } : null;
}

mkdirSync('midi-src', { recursive: true });

const ok = [];
for (const t of TARGETS) {
  try {
    const search = await getText(
      `https://bitmidi.com/search?q=${encodeURIComponent(t.q)}`,
    );
    const picked = pickDetail(search, t.q);
    if (!picked) {
      console.log(`✗ ${t.q}: 没有匹配结果`);
      continue;
    }
    const page = await getText('https://bitmidi.com' + picked.link);
    const dl = page.match(/href="(\/uploads\/\d+\.mid)"/);
    if (!dl) {
      console.log(`✗ ${t.q}: 详情页没有下载链接`);
      continue;
    }
    const buf = await getBuffer('https://bitmidi.com' + dl[1]);
    const pageTitle = (page.match(/<title>([^<]+)</) || [])[1] || '';
    writeFileSync(`midi-src/${t.id}.mid`, buf);
    console.log(`✓ ${t.q} → midi-src/${t.id}.mid (${buf.length}B) [${pageTitle.slice(0, 60)}]`);
    ok.push(t);
  } catch (e) {
    console.log(`✗ ${t.q}: ${e.message}`);
  }
}

console.log(`\n下载成功 ${ok.length}/${TARGETS.length}，开始转换…\n`);
for (const t of ok) {
  try {
    const out = execSync(
      `node scripts/midi2score.mjs midi-src/${t.id}.mid ${t.id} "${t.title}" ${t.level}`,
      { encoding: 'utf8' },
    );
    console.log(out.trim());
  } catch (e) {
    console.log(`✗ 转换失败 ${t.id}: ${String(e.message).split('\n')[0]}`);
  }
}
