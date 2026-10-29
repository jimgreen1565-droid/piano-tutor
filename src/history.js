// 练习记录：存在本机 localStorage，不上传

const KEY = 'piano-tutor-history-v1';
const LIMIT = 200;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-LIMIT)));
  } catch {
    /* 存储满/隐私模式忽略 */
  }
}

export function addRecord(rec) {
  const list = read();
  list.push({ ...rec, ts: Date.now() });
  write(list);
}

export function recordsFor(pieceId) {
  return read()
    .filter((r) => r.pieceId === pieceId)
    .sort((a, b) => a.ts - b.ts);
}

export function bestFor(pieceId) {
  const list = recordsFor(pieceId);
  if (!list.length) return null;
  return list.reduce((a, b) => (b.overall > a.overall ? b : a));
}

export function summaryFor(pieceId) {
  const list = recordsFor(pieceId);
  if (!list.length) return null;
  const best = list.reduce((a, b) => (b.overall > a.overall ? b : a));
  return {
    count: list.length,
    best: best.overall,
    last: list[list.length - 1].overall,
    lastTs: list[list.length - 1].ts,
  };
}

export function clearPiece(pieceId) {
  write(read().filter((r) => r.pieceId !== pieceId));
}

/**
 * 找出"反复出错"的小节：最近 N 次练习里至少 2 次出问题。
 * 单次出错可能是偶然，连续错才是指法/手位的固定瓶颈。
 */
export function persistentProblems(pieceId, { lastN = 5, minRuns = 2 } = {}) {
  const list = recordsFor(pieceId).slice(-lastN);
  if (list.length < minRuns) return [];

  const counter = new Map();
  for (const rec of list) {
    const seen = new Set();
    for (const m of rec.errorMeasures || []) {
      if (seen.has(m)) continue; // 同一次里只记一次
      seen.add(m);
      counter.set(m, (counter.get(m) || 0) + 1);
    }
  }

  return [...counter.entries()]
    .filter(([, n]) => n >= minRuns)
    .map(([measure, fails]) => ({ measure, fails }))
    .sort((a, b) => b.fails - a.fails || a.measure - b.measure);
}
