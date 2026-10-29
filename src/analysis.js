// 谱面结构分析：把乐谱翻译成"难点特征"，供讲评归因使用
//
// 同一个错音，成因可能完全不同：
//   - 跨 5 度以上的大跳 → 手位移动不准
//   - 同一音重复按 → 手指提前离键/多按
//   - 八分音符密集处 → 节奏跟不上
//   - 小节第一拍 → 起拍犹豫
// 分清楚才能给对建议。

const LEAP_SEMITONES = 5; // 纯四度以上算跳进
const BIG_LEAP_SEMITONES = 12; // 八度以上算大跳

export function analyzeScore(scoreJson) {
  const notes = scoreJson.notes || [];
  const enriched = notes.map((n, i) => {
    const prev = i > 0 ? notes[i - 1] : null;
    const next = i < notes.length - 1 ? notes[i + 1] : null;

    const interval = prev ? n.pitchMidi - prev.pitchMidi : 0;
    const absInterval = Math.abs(interval);

    // 该音在小节内的位置（第几拍，0 起）
    const beatInMeasure = n.beat % (scoreJson.timeSignature?.beats || 4);

    return {
      index: i,
      measure: n.measure,
      beatInMeasure,
      interval,
      absInterval,
      isRepeat: prev ? interval === 0 : false,
      isLeap: absInterval >= LEAP_SEMITONES,
      isBigLeap: absInterval >= BIG_LEAP_SEMITONES,
      isFirstInMeasure: beatInMeasure === 0,
      isShort: (n.durationBeats || 1) < 1, // 八分音符之类
      nextInterval: next ? next.pitchMidi - n.pitchMidi : 0,
    };
  });

  // 小节级特征
  const byMeasure = new Map();
  for (const e of enriched) {
    let m = byMeasure.get(e.measure);
    if (!m) {
      m = { measure: e.measure, notes: 0, leaps: 0, repeats: 0, shorts: 0 };
      byMeasure.set(e.measure, m);
    }
    m.notes++;
    if (e.isLeap) m.leaps++;
    if (e.isRepeat) m.repeats++;
    if (e.isShort) m.shorts++;
  }

  return {
    notes: enriched,
    measures: [...byMeasure.values()].sort((a, b) => a.measure - b.measure),
    stats: {
      total: enriched.length,
      leaps: enriched.filter((e) => e.isLeap).length,
      bigLeaps: enriched.filter((e) => e.isBigLeap).length,
      repeats: enriched.filter((e) => e.isRepeat).length,
      shorts: enriched.filter((e) => e.isShort).length,
    },
  };
}

/** 把错音按成因归类 */
export function categorizeErrors(expectedNotes, analysis) {
  const byIndex = new Map(analysis.notes.map((a) => [a.index, a]));

  const errors = expectedNotes.filter((e) => e.status !== 'hit');
  const bucket = {
    leap: [],
    bigLeap: [],
    repeat: [],
    shortRhythm: [],
    firstBeat: [],
    plain: [],
  };

  for (const e of errors) {
    const a = byIndex.get(e.index);
    if (!a) {
      bucket.plain.push(e);
      continue;
    }
    // 优先级：大跳 > 跳进 > 重复音 > 短时值 > 起拍
    if (a.isBigLeap) bucket.bigLeap.push(e);
    else if (a.isLeap) bucket.leap.push(e);
    else if (a.isRepeat) bucket.repeat.push(e);
    else if (a.isShort) bucket.shortRhythm.push(e);
    else if (a.isFirstInMeasure) bucket.firstBeat.push(e);
    else bucket.plain.push(e);
  }

  return bucket;
}
