// 演奏评分：把「识别到的音符」和「谱面上的音符」对齐后打分
//
// 前提（用户选定）：跟内置节拍器弹，所以谱面每个音都有确定的"应当发声时刻"：
//   应当时刻(秒) = beat × 60 / bpm
//
// 输出不只是总分，而是逐音结论 + 分维度指标 + 可读讲评，
// 这样用户能知道"第几小节错了什么"，而不是只看到一个数字。

const DEFAULT_TOLERANCE_BEATS = 0.6; // 允许的时间偏差（拍）
const EXTRA_PAD_SECONDS = 2; // 谱面结束后的余量（之后多弹的算"多弹"）

export function evaluate(score, played, options = {}) {
  const bpm = options.bpm || score.bpm || 60;
  const toleranceBeats =
    options.toleranceBeats ?? DEFAULT_TOLERANCE_BEATS;
  const spb = 60 / bpm; // 每拍秒数
  const toleranceSec = toleranceBeats * spb;

  const expected = [...score.notes]
    .sort((a, b) => a.beat - b.beat)
    .map((n, i) => ({
      index: i,
      pitchMidi: n.pitchMidi,
      beat: n.beat,
      measure: n.measure,
      durationBeats: n.durationBeats,
      expectedTime: n.beat * spb,
      status: 'miss',
      playedTime: null,
      deviationSec: null,
    }));

  const playedSorted = [...played].sort(
    (a, b) => a.startTimeSeconds - b.startTimeSeconds,
  );
  const used = new Array(playedSorted.length).fill(false);

  const nearest = (targetSec, filterFn) => {
    let best = -1;
    let bestDt = Infinity;
    for (let j = 0; j < playedSorted.length; j++) {
      if (used[j]) continue;
      const p = playedSorted[j];
      if (filterFn && !filterFn(p)) continue;
      const dt = Math.abs(p.startTimeSeconds - targetSec);
      if (dt <= toleranceSec && dt < bestDt) {
        best = j;
        bestDt = dt;
      }
    }
    return best;
  };

  // 第一轮：音高正确的匹配
  for (const e of expected) {
    const j = nearest(e.expectedTime, (p) => p.pitchMidi === e.pitchMidi);
    if (j >= 0) {
      const p = playedSorted[j];
      used[j] = true;
      e.status = 'hit';
      e.playedTime = p.startTimeSeconds;
      e.deviationSec = p.startTimeSeconds - e.expectedTime;
    }
  }

  // 第二轮：音高不对但时间对 → 错音
  for (const e of expected) {
    if (e.status !== 'miss') continue;
    const j = nearest(e.expectedTime);
    if (j >= 0) {
      const p = playedSorted[j];
      used[j] = true;
      e.status = 'wrong';
      e.playedTime = p.startTimeSeconds;
      e.deviationSec = p.startTimeSeconds - e.expectedTime;
      e.playedPitchMidi = p.pitchMidi;
    }
  }

  // 第三轮：没对上的弹奏音符 → 多弹
  const lastExpectedTime =
    expected.length > 0 ? expected[expected.length - 1].expectedTime : 0;
  const extras = [];
  for (let j = 0; j < playedSorted.length; j++) {
    if (used[j]) continue;
    const p = playedSorted[j];
    if (p.startTimeSeconds > lastExpectedTime + EXTRA_PAD_SECONDS) continue;
    const nearestExpected = expected.reduce(
      (acc, e) =>
        Math.abs(e.expectedTime - p.startTimeSeconds) <
        Math.abs(acc.expectedTime - p.startTimeSeconds)
          ? e
          : acc,
      expected[0],
    );
    extras.push({
      pitchMidi: p.pitchMidi,
      time: p.startTimeSeconds,
      nearMeasure: nearestExpected ? nearestExpected.measure : null,
    });
  }

  // ---- 统计 ----
  const total = expected.length;
  const hits = expected.filter((e) => e.status === 'hit');
  const wrongs = expected.filter((e) => e.status === 'wrong');
  const misses = expected.filter((e) => e.status === 'miss');

  const deviations = hits.map((e) => e.deviationSec / spb); // 换算成拍
  const meanDeviation = mean(deviations);
  const timingStd = std(deviations);

  const pitchScore = total > 0 ? hits.length / total : 0;
  const rhythmScore = timingStd === null ? 0 : clamp01(1 - timingStd / 0.5);
  const overall = Math.round(
    clamp01(pitchScore * 0.7 + rhythmScore * 0.3) * 100,
  );

  // ---- 按小节汇总问题 ----
  const measures = new Map();
  for (const e of expected) {
    if (!measures.has(e.measure)) {
      measures.set(e.measure, { measure: e.measure, wrong: 0, miss: 0 });
    }
    const m = measures.get(e.measure);
    if (e.status === 'wrong') m.wrong++;
    if (e.status === 'miss') m.miss++;
  }
  const problemMeasures = [...measures.values()]
    .filter((m) => m.wrong + m.miss > 0)
    .sort((a, b) => b.wrong + b.miss - (a.wrong + a.miss));

  return {
    total,
    hitCount: hits.length,
    wrongCount: wrongs.length,
    missCount: misses.length,
    extraCount: extras.length,
    pitchScore,
    rhythmScore,
    overall,
    timing: {
      meanBeats: meanDeviation,
      stdBeats: timingStd,
      meanMs: meanDeviation === null ? null : Math.round(meanDeviation * spb * 1000),
      stdMs: timingStd === null ? null : Math.round(timingStd * spb * 1000),
    },
    details: expected,
    extras,
    problemMeasures,
    advice: buildAdvice({
      overall,
      pitchScore,
      rhythmScore,
      hits: hits.length,
      wrongs: wrongs.length,
      misses: misses.length,
      extras: extras.length,
      meanDeviation,
      timingStd,
      problemMeasures,
      bpm,
    }),
  };
}

function buildAdvice(s) {
  const tips = [];

  if (s.overall >= 95) {
    tips.push('音准和节奏都很稳，这首可以试着提速到 ' + Math.round(s.bpm * 1.15) + ' BPM。');
  } else if (s.overall >= 80) {
    tips.push('整体不错，个别地方有瑕疵，把出错的小节单独慢练 2~3 遍。');
  } else if (s.overall >= 60) {
    tips.push('基本能弹下来，但准确度还不够，建议把速度降到 ' + Math.max(40, Math.round(s.bpm * 0.75)) + ' BPM 再练。');
  } else {
    tips.push('这首现在对你偏难，先把速度降到 ' + Math.max(40, Math.round(s.bpm * 0.6)) + ' BPM，一小节一小节地练。');
  }

  if (s.misses > 0) {
    tips.push(`有 ${s.misses} 个音没弹出来（漏音），多半是手还没跟上，先慢速把音找准。`);
  }
  if (s.wrongs > 0) {
    tips.push(`有 ${s.wrongs} 个音弹错了，注意看谱上的音高位置。`);
  }
  if (s.extras > 0) {
    tips.push(`有 ${s.extras} 个多余的音（可能是碰响了别的键，或泛音被识别），弹的时候手抬干净一点。`);
  }

  if (s.meanDeviation !== null && Math.abs(s.meanDeviation) > 0.15) {
    tips.push(
      s.meanDeviation > 0
        ? '整体比节拍慢了一点，注意跟着节拍器走，别拖。'
        : '整体比节拍快了一点，稳住，不要抢拍。',
    );
  }
  if (s.timingStd !== null && s.timingStd > 0.18) {
    tips.push('节奏忽快忽慢，稳定性不够，建议先用更慢的速度把节奏打匀。');
  }

  if (s.problemMeasures.length > 0) {
    const list = s.problemMeasures
      .slice(0, 4)
      .map((m) => {
        const parts = [];
        if (m.wrong) parts.push(`错 ${m.wrong}`);
        if (m.miss) parts.push(`漏 ${m.miss}`);
        return `第 ${m.measure} 小节（${parts.join('、')}）`;
      })
      .join('、');
    tips.push(`问题集中在：${list}。`);
  }

  return tips;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

export function midiToName(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
