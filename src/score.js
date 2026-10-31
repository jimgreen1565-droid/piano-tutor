// 演奏评分：把「识别到的音符」和「谱面上的音符」对齐后打分
//
// 前提（用户选定）：跟内置节拍器弹，所以谱面每个音都有确定的"应当发声时刻"：
//   应当时刻(秒) = beat × 60 / bpm
//
// 输出不只是总分，而是逐音结论 + 分维度指标 + 可读讲评，
// 这样用户能知道"第几小节错了什么"，而不是只看到一个数字。

import { analyzeScore, categorizeErrors } from './analysis.js';

const DEFAULT_TOLERANCE_BEATS = 0.6; // 允许的时间偏差（拍）
const EXTRA_PAD_SECONDS = 2; // 谱面结束后的余量（之后多弹的算"多弹"）

export function evaluate(score, played, options = {}) {
  const bpm = options.bpm || score.bpm || 60;
  const toleranceBeats =
    options.toleranceBeats ?? DEFAULT_TOLERANCE_BEATS;
  const spb = 60 / bpm; // 每拍秒数
  const toleranceSec = toleranceBeats * spb;

  const sortedNotes = [...score.notes].sort((a, b) => a.beat - b.beat);
  const analysis = analyzeScore({ ...score, notes: sortedNotes });

  const expected = sortedNotes.map((n, i) => ({
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

  const playedSorted = [...(played || [])]
    .filter(
      (p) =>
        p &&
        Number.isFinite(p.startTimeSeconds) &&
        Number.isFinite(p.pitchMidi),
    )
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
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
  //
  // 但要注意：钢琴是持续音，按住一个音时琴弦还在响，
  // 转录模型会把同一个音在它还没衰减完的时候再报一次。
  // 这种"同一音高、落在某个已命中音符发声区间内"的重复，属于识别误报，
  // 不能算成用户多弹了音。
  const lastExpectedTime =
    expected.length > 0 ? expected[expected.length - 1].expectedTime : 0;

  const soundingWindows = expected
    .filter((e) => e.status === 'hit' || e.status === 'wrong')
    .map((e) => {
      const lenSec = (e.durationBeats || 1) * spb;
      return {
        pitchMidi: e.status === 'hit' ? e.pitchMidi : e.playedPitchMidi,
        start: (e.playedTime ?? e.expectedTime) - 0.08,
        end: (e.playedTime ?? e.expectedTime) + lenSec * 1.25 + 0.3,
      };
    });

  const extras = [];
  let retriggers = 0;
  for (let j = 0; j < playedSorted.length; j++) {
    if (used[j]) continue;
    const p = playedSorted[j];
    if (p.startTimeSeconds > lastExpectedTime + EXTRA_PAD_SECONDS) continue;

    const isRetrigger = soundingWindows.some(
      (w) =>
        w.pitchMidi === p.pitchMidi &&
        p.startTimeSeconds >= w.start &&
        p.startTimeSeconds <= w.end,
    );
    if (isRetrigger) {
      retriggers++;
      continue;
    }

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

  // ---- 系统性音高偏移检测 ----
  // 如果是"每个音都高/低了 1~2 个八度"，那是识别层面的问题，不是演奏问题。
  const intervals = [];
  for (const e of expected) {
    if (e.status === 'hit') intervals.push(0);
    else if (e.status === 'wrong' && e.playedPitchMidi != null) {
      intervals.push(e.playedPitchMidi - e.pitchMidi);
    }
  }
  const { value: modeInterval, count: modeCount } = modeOf(intervals);
  const octaveShift =
    intervals.length >= 5 &&
    (Math.abs(modeInterval) === 12 || Math.abs(modeInterval) === 24) &&
    modeCount / intervals.length >= 0.5
      ? modeInterval
      : null;

  // ---- 错音归因 ----
  const errorBuckets = categorizeErrors(expected, analysis);
  const persistentMeasures = options.persistentMeasures || [];

  const diagnosis = {
    bigLeap: errorBuckets.bigLeap.map((e) => e.measure),
    leap: errorBuckets.leap.map((e) => e.measure),
    repeat: errorBuckets.repeat.map((e) => e.measure),
    shortRhythm: errorBuckets.shortRhythm.map((e) => e.measure),
    firstBeat: errorBuckets.firstBeat.map((e) => e.measure),
    plain: errorBuckets.plain.length,
    persistentMeasures,
    stats: analysis.stats,
  };

  return {
    total,
    hitCount: hits.length,
    wrongCount: wrongs.length,
    missCount: misses.length,
    extraCount: extras.length,
    retriggerCount: retriggers,
    pitchScore,
    rhythmScore,
    overall,
    octaveShift,
    intervals,
    analysis,
    diagnosis,
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
      octaveShift,
      diagnosis,
    }),
  };
}

function modeOf(arr) {
  if (!arr.length) return { value: 0, count: 0 };
  const map = new Map();
  for (const v of arr) map.set(v, (map.get(v) || 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [k, c] of map) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return { value: best, count: bestCount };
}

function buildAdvice(s) {
  const tips = [];
  const d = s.diagnosis || {};

  const measureList = (arr) => {
    const uniq = [...new Set(arr)].sort((a, b) => a - b);
    const shown = uniq.slice(0, 4).join('、');
    return uniq.length > 4 ? `${shown} 等 ${uniq.length} 处` : shown;
  };

  // 系统性音高偏移（识别问题，先说清楚，别让用户以为是自己弹错）
  if (s.octaveShift) {
    const dir = s.octaveShift > 0 ? '高' : '低';
    const oct = Math.abs(s.octaveShift) / 12;
    tips.unshift(
      `注意：这次识别出的音整体比谱面${dir}了 ${oct} 个八度，这是识别环节的偏差，不是你弹错。`,
    );
  }

  // 1. 总体评价
  if (s.overall >= 95) {
    tips.push(
      `整体完成度很高（${s.hits}/${s.wrongs + s.hits + s.misses} 个音准确），可以试着提速到 ${Math.round(s.bpm * 1.15)} BPM，或换下一首难度更高的。`,
    );
  } else if (s.overall >= 80) {
    tips.push('整体弹得不错，问题集中在个别位置，把那几处单独拎出来慢练效果最快。');
  } else if (s.overall >= 60) {
    tips.push(
      `基本能顺下来，但准确度还不够。建议把速度从 ${s.bpm} 降到 ${Math.max(40, Math.round(s.bpm * 0.75))} BPM 重新走一遍。`,
    );
  } else {
    tips.push(
      `这首目前对你偏难。把速度降到 ${Math.max(40, Math.round(s.bpm * 0.6))} BPM，先保证每个音找准，别追求完整弹完。`,
    );
  }

  // 2. 错误成因归因（这是这次讲评升级的重点）
  const causes = [];
  if (d.bigLeap && d.bigLeap.length) {
    causes.push(
      `有 ${d.bigLeap.length} 个错音出现在跨八度的大跳处（第 ${measureList(d.bigLeap)} 小节）——说明是手位移动没到位，不是看错谱`,
    );
  }
  if (d.leap && d.leap.length) {
    causes.push(
      `有 ${d.leap.length} 个错音在 5 度以上的跳进处（第 ${measureList(d.leap)} 小节）——手指跨度还没形成肌肉记忆`,
    );
  }
  if (d.repeat && d.repeat.length) {
    causes.push(
      `有 ${d.repeat.length} 个错音在同一音重复的地方（第 ${measureList(d.repeat)} 小节）——容易多按或提前离键`,
    );
  }
  if (d.shortRhythm && d.shortRhythm.length) {
    causes.push(
      `有 ${d.shortRhythm.length} 个错音落在八分音符上（第 ${measureList(d.shortRhythm)} 小节）——节奏型还没弹匀`,
    );
  }
  if (d.firstBeat && d.firstBeat.length) {
    causes.push(
      `有 ${d.firstBeat.length} 个错音在小节第一拍（第 ${measureList(d.firstBeat)} 小节）——起拍容易犹豫半拍`,
    );
  }
  for (const c of causes) tips.push(c);

  // 3. 连续性瓶颈（跨多次练习）
  if (d.persistentMeasures && d.persistentMeasures.length) {
    const list = d.persistentMeasures
      .slice(0, 3)
      .map((m) => `第 ${m.measure} 小节`)
      .join('、');
    tips.push(
      `${list} 在最近几次练习里反复出错，这是你的固定瓶颈，建议单独抽出来慢练，而不是整首反复过。`,
    );
  }

  // 4. 漏音 / 多弹
  if (s.misses > 0 && s.misses >= s.wrongs) {
    tips.push(
      `有 ${s.misses} 个音没弹出来（漏音）。这通常不是不会，而是手跟不上节拍——先不管速度，把每个音按实。`,
    );
  } else if (s.misses > 0) {
    tips.push(`另有 ${s.misses} 个音漏掉了。`);
  }
  if (s.wrongs > 0) {
    tips.push(`有 ${s.wrongs} 个音弹错，对照谱面上标记的红框看具体是哪个音。`);
  }
  if (s.extras > 0) {
    tips.push(
      `有 ${s.extras} 个多余的音。可能是碰响了邻键，也可能是节拍器被麦克风收进去了——试着戴耳机弹。`,
    );
  }

  // 5. 节奏
  if (s.meanDeviation !== null && Math.abs(s.meanDeviation) > 0.15) {
    tips.push(
      s.meanDeviation > 0
        ? '整体比节拍器慢一点，注意跟住拍子，别拖。'
        : '整体比节拍器快一点，稳住，不要抢拍。',
    );
  }
  if (s.timingStd !== null && s.timingStd > 0.18) {
    tips.push('节奏忽快忽慢，稳定性不够，建议用更慢的速度把节奏打匀再加速。');
  } else if (s.timingStd !== null && s.timingStd < 0.1 && s.hits > 20) {
    tips.push('节奏非常稳（波动小于 100ms），这项可以放心提速。');
  }

  // 6. 可执行动作
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
    tips.push(`问题集中：${list}。`);
    tips.push(
      '练法建议：把这 1~2 个小节单独抽出来，用 60~70% 的速度重复 5 遍，连续 3 遍无错再放回整首。',
    );
  } else if (s.overall >= 90) {
    tips.push('这一遍没有明显的错误集中区，可以直接提速或挑战下一首。');
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
