// 教练层：把评分引擎的结构化事实，压成"老师会说的话"
//
// 设计原则（和一个真钢琴老师对齐）：
//   1. 一次只说 2 个问题，不列清单。说多了学生记不住。
//   2. 每个问题必须带位置（第几小节），否则学生不知道该去哪儿改。
//   3. 必须给一个能立刻做的动作（降到多少速度、练哪几小节、练几遍）。
//   4. 先给一个具体的肯定，但它必须基于事实，不能是"弹得不错"这种空话。
//   5. 识别层的偏差（整体八度偏移）要主动说清，不能让学生以为自己弹错了。
//
// 每句话都由「片段模板」拼出来，而不是写死字符串。原因：
//   朗读不是系统合成音，而是本机 Breeze-TTS 预渲染的真人音色片段库
//   （见 gen-voice-clips.mjs）。显示字幕和朗读音频必须来自同一份模板，
//   否则改一句话就会出现"字幕说 5、语音说 4"这种错位。
//   part 类型：{t:'f'}固定片段 / {t:'n'}数字 / {t:'u'}量词 / {t:'note'}音名

const MAX_ISSUES = 2; // 最多说几个问题
const SPOKEN_BUDGET = 240; // 口播总字数上限（约 35 秒）

// ---------- 固定片段表：每个 key 对应一个预渲染音频文件 ----------

export const F = {
  // 识别层 / 设备层（不怪学生的事）
  octave_head: '先说一句，这次听出来的音整体比谱面',
  higher: '高了',
  lower: '低了',
  octave_tail: '个八度，这是麦克风识别的问题，不是你弹错。下面按位置说。',
  shift_head: '另外整体节奏偏',
  faster: '快了',
  slower: '慢了',
  shift_mid: '毫秒，但每次都偏得很一致。',
  shift_tail: '这里面有一部分是录音启动的延迟，不全怪你。',

  // 肯定
  praise_progress_head: '比上次进步了',
  score_unit: '分。',
  praise_pitch_mid: '个音弹对了',
  praise_pitch_tail: '个，音准基本没问题。',
  praise_rhythm_head: '节奏很稳，跟节拍器的偏差只有正负',
  ms_unit: '毫秒。',
  praise_flow: '整首一次顺下来了，中间没有卡壳。',
  praise_head_ok: '开头到',
  praise_head_ok_tail: '是顺的。',

  // 问题：漏音
  measure_unit: '小节',
  ordinal: '第',
  miss_solo_head: '最明显，一共',
  miss_one_head: '最明显，另外',
  miss_one_mid: '也有，一共',
  miss_many_head: '最明显，另外',
  miss_many_unit: '个小节也有，一共',
  note_count_unit: '个音',
  miss_tail: '没弹出来。通常是手位没提前找好，到那儿就顿了一下。',

  // 问题：错音（按成因说，学生才知道怎么改）
  wrong_mid: '错了',
  wrong_tail: '个音，是',
  why_big_leap: '跨八度的大跳，手位移动没到位。',
  why_leap: '五度以上的跳进，跨度还没形成肌肉记忆。',
  why_repeat: '同音重复的地方，容易多按或者提前离键。',
  why_short: '八分音符连着走的地方，节奏型还没弹匀。',
  why_first_beat: '每个小节第一拍容易犹豫。',

  // 音名细节（最能让用户感到"真的在听"的一句）
  note_tail_head: '另外，',
  note_head: '里有个',
  note_mid: '弹成了',

  // 问题：节奏
  rhythm_unstable_head: '节奏忽快忽慢，偏差到正负',
  rhythm_unstable_tail: '毫秒，说明拍子还没吃到心里。',
  drift_faster: '后半段明显赶起来了，越弹越快。',
  drift_faster_tail: '这是最容易听出来的问题。',
  drift_slower: '后半段慢下来了，越弹越拖。',

  // 问题：力度 / 杂音
  dyn_light: '整体弹得有点轻，很多琴键没把琴键送到底。',
  dyn_uneven: '力度忽大忽小，句子的起伏还没控制住。',
  extras_head: '另外还多出',
  extras_unit: '个',
  extras_tail: '音，如果是踩了踏板让弦继续共振，那是正常的，不用管。',

  // 练法
  drill_now: '现在就练',
  drill_speed: '，速度降到',
  drill_tail: '，慢弹三遍，每遍只盯一个地方。',
  drill_fast_head: '保持现在这样，再把速度提到',
  drill_fast_tail: '走一遍，或者换一首更难的。',
  drill_metronome: '开着节拍器再走一遍，后半段刻意压住，听见节拍器再落键，不要往前赶。',
  drill_count: '先不弹，跟着节拍器把整首的拍子拍一遍，再回琴上弹。',
  drill_dynamics: '单独练一遍力度，每个音都弹到底，强的地方真强。',
  drill_extras: '一直有多余的音混进来，注意把手放松，弹完及时离键。',
  drill_slow_head: '先把速度降到',
  drill_slow_tail: '，整首再走一遍，只求把每个音弹准。',

  // 收尾
  next_perfect: '这一遍已经没什么可挑的了，难点都过了。',
  next_plain: '这次没抓到明显的错处，注意把每个音弹到底、声音立起来。',
  closing_ok: '准备好了就再来一遍，我听着。',
  closing_slow: '慢练比多弹有用，先按这个速度来。',
};

// 量词 / 连接词（每项也各有一个音频片段）
export const U = {
  measure: '小节',
  ordinal: '第',
  to: '到',
  positive_negative: '正负',
};

// 音名（朗读用中文念法；语音念 "C#4" 会读成一串怪字符）
const SHARP_CN = { 1: '升C', 3: '升D', 6: '升F', 8: '升G', 10: '升A' };
const PLAIN_CN = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const NOTE_KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B', '升', '降'];

/** 音名的中文念法：C / 升F …… */
export function noteName(midi) {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return SHARP_CN[pc] || PLAIN_CN[pc / 2] || 'C';
}

/** 音名 → 片段序列（升F = 升 + F） */
function noteParts(midi) {
  const name = noteName(midi);
  const out = [];
  if (/^升/.test(name)) out.push({ t: 'note', k: '升' });
  const letter = name.replace(/^[升降]/, '');
  out.push({ t: 'note', k: letter });
  return out;
}

/** 数字 → 中文读法（一 / 十二 / 二十 / 一百零五） */
export function numToCn(n) {
  n = Math.abs(Math.round(n));
  const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n === 0) return '零';
  if (n < 10) return d[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + d[n - 10];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return d[t] + '十' + (o ? d[o] : '');
  }
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (r === 0) return d[h] + '百';
  if (r < 10) return d[h] + '百零' + d[r];
  return d[h] + '百' + numToCn(r);
}

/** 中文数字 → 可复用的最小音频片段（[一百][二十][三]） */
export function numClips(n) {
  const cn = numToCn(n);
  const out = [];
  let i = 0;
  while (i < cn.length) {
    const two = cn.slice(i, i + 2);
    if (two.length === 2 && (two[1] === '百' || two[1] === '十') && /[一二三四五六七八九]/.test(two[0])) {
      out.push(two);
      i += 2;
      continue;
    }
    out.push(cn[i]);
    i += 1;
  }
  return out;
}

// ---------- 片段渲染 ----------

const frag = (k) => ({ t: 'f', k });
const unit = (k) => ({ t: 'u', k });
const num = (v) => ({ t: 'n', v: Math.round(v) });
// 纯标点：只出现在字幕里，不占音频片段（"。" 单独合成出来是空的）
const punct = (s = '。') => ({ t: 'p', s });

/** 显示字幕（数字与汉字之间留半个空格，读起来不挤） */
export function partsToText(parts) {
  const raw = parts
    .map((p) => {
      if (p.t === 'f') return F[p.k] ?? '';
      if (p.t === 'u') return U[p.k] ?? '';
      if (p.t === 'n') return String(p.v);
      if (p.t === 'note') return p.k;
      if (p.t === 'p') return p.s;
      return '';
    })
    .join('');
  return raw
    .replace(/(\d)([\u4e00-\u9fa5])/g, '$1 $2')
    .replace(/([\u4e00-\u9fa5])(\d)/g, '$1 $2');
}

/** 朗读片段 key 序列（交给 voice-clips.js 取音频） */
export function partsToSay(parts) {
  const out = [];
  for (const p of parts) {
    if (p.t === 'f') out.push('f:' + p.k);
    else if (p.t === 'u') out.push('u:' + p.k);
    else if (p.t === 'n') for (const tok of numClips(p.v)) out.push('n:' + tok);
    else if (p.t === 'note') out.push('k:' + p.k);
  }
  return out;
}

/** 小节区间 → 片段（第 5 到 6 小节 / 第 5 小节） */
const rangeParts = (r) =>
  r.from === r.to
    ? [unit('ordinal'), num(r.from), unit('measure')]
    : [unit('ordinal'), num(r.from), unit('to'), num(r.to), unit('measure')];

const rangeText = (r) => (r.from === r.to ? `第 ${r.from} 小节` : `第 ${r.from} 到 ${r.to} 小节`);

/** 练法用的窄窗口：只圈最该练的 2~3 小节，圈太大等于没圈 */
function drillWindow(measures, totalMeasures) {
  const uniq = [...new Set(measures)].filter((m) => Number.isFinite(m)).sort((a, b) => a - b);
  if (!uniq.length) return null;
  const worst = uniq[0];
  const cap = totalMeasures || worst + 2;
  let from = Math.max(1, worst - 1);
  let to = Math.min(cap, worst + 1);
  if (uniq[1] !== undefined && uniq[1] <= to + 1) to = Math.min(cap, uniq[1] + 1);
  if (to - from + 1 > 3) to = from + 2;
  to = Math.min(to, cap);
  if (to <= from) to = Math.min(cap, from + 1);
  return { from, to };
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
}

/** 只有"真的听了"才有的事实：段落速度漂移 / 力度分布 */
function listeningFacts(report, played) {
  const hits = report.details.filter((d) => d.status === 'hit' && Number.isFinite(d.deviationSec));

  let drift = null;
  if (hits.length >= 6) {
    const third = Math.max(1, Math.floor(hits.length / 3));
    const dh = mean(hits.slice(0, third).map((d) => d.deviationSec));
    const dt = mean(hits.slice(-third).map((d) => d.deviationSec));
    const diff = dt - dh;
    if (Math.abs(diff) > 0.12) drift = { diffSeconds: diff, faster: diff < 0 };
  }

  let dyn = null;
  const amps = (played || []).map((p) => p && p.amplitude).filter((a) => Number.isFinite(a) && a > 0);
  if (amps.length >= 8) {
    const m = mean(amps);
    dyn = { mean: m, cv: m ? std(amps) / m : 0 };
  }

  return { drift, dyn };
}

/** 一行 = 字幕 + 朗读片段 + 元信息，三者同源 */
function makeLine(kind, parts, extra = {}) {
  return { kind, parts, text: partsToText(parts), say: partsToSay(parts), ...extra };
}

/**
 * 主入口。
 * @param report  evaluate() 的返回值
 * @param scoreJson 谱面
 * @param played 识别出的演奏音符（带 amplitude 时才能讲力度）
 * @param opts { bpm, prev }
 */
export function coachScript(report, scoreJson, played, opts = {}) {
  const bpm = opts.bpm || (scoreJson && scoreJson.bpm) || 60;
  const total = report.total || 0;
  const totalMeasures = (scoreJson && scoreJson.totalMeasures) || 0;
  const { drift, dyn } = listeningFacts(report, played);
  const diag = report.diagnosis || {};

  const cautions = [];
  const praise = [];
  const cands = [];

  // ---------- 0. 识别层偏差：必须最先说 ----------
  if (report.octaveShift) {
    cautions.push(
      makeLine(
        'caution',
        [
          frag('octave_head'),
          frag(report.octaveShift > 0 ? 'higher' : 'lower'),
          num(Math.abs(report.octaveShift) / 12),
          frag('octave_tail'),
        ],
        { subtype: 'recognition' },
      ),
    );
  }

  // ---------- 1. 具体的肯定 ----------
  const hitRate = total ? report.hitCount / total : 0;
  const stdMs = Number.isFinite(report.timing.stdMs) ? report.timing.stdMs : null;
  const meanMs = Number.isFinite(report.timing.meanMs) ? report.timing.meanMs : null;
  const prev = opts.prev || {};

  if (typeof prev.last === 'number' && report.overall > prev.last + 2) {
    praise.push(makeLine('praise', [frag('praise_progress_head'), num(report.overall - prev.last), frag('score_unit')]));
  } else if (total && hitRate >= 0.9) {
    praise.push(makeLine('praise', [num(total), frag('praise_pitch_mid'), num(report.hitCount), frag('praise_pitch_tail')]));
  } else if (stdMs !== null && stdMs < 120 && stdMs >= 5) {
    praise.push(makeLine('praise', [frag('praise_rhythm_head'), num(stdMs), frag('ms_unit')]));
  } else if (total && report.missCount === 0) {
    praise.push(makeLine('praise', [frag('praise_flow')]));
  } else if (report.hitCount >= 8 && totalMeasures) {
    const m = Math.max(1, Math.floor(totalMeasures / 3));
    praise.push(makeLine('praise', [frag('praise_head_ok'), num(m), unit('measure'), frag('praise_head_ok_tail')]));
  }

  // ---------- 2. 问题候选（按影响排序，最多说两条）----------
  const add = (kind, count, denom, weight, parts, measures, bodyText) => {
    cands.push({ kind, impact: weight * (denom ? count / denom : 0), parts, measures, bodyText });
  };

  if (report.missCount > 0) {
    const ms = report.details.filter((d) => d.status === 'miss').map((d) => d.measure);
    const uniq = [...new Set(ms)].sort((a, b) => a - b);
    const lead = uniq[0];
    const rest = uniq.slice(1);
    let parts;
    let body;
    if (!rest.length) {
      parts = [unit('ordinal'), num(lead), unit('measure'), frag('miss_solo_head'), num(report.missCount), frag('note_count_unit'), frag('miss_tail')];
      body = `第 ${lead} 小节最明显，一共 ${report.missCount} 个音没弹出来。`;
    } else if (rest.length === 1) {
      parts = [
        unit('ordinal'), num(lead), unit('measure'), frag('miss_one_head'),
        unit('ordinal'), num(rest[0]), unit('measure'), frag('miss_one_mid'),
        num(report.missCount), frag('note_count_unit'), frag('miss_tail'),
      ];
      body = `第 ${lead} 小节最明显，另外第 ${rest[0]} 小节也有，一共 ${report.missCount} 个音没弹出来。`;
    } else {
      parts = [
        unit('ordinal'), num(lead), unit('measure'), frag('miss_many_head'),
        num(rest.length), frag('miss_many_unit'),
        num(report.missCount), frag('note_count_unit'), frag('miss_tail'),
      ];
      body = `第 ${lead} 小节最明显，另外 ${rest.length} 个小节也有，一共 ${report.missCount} 个音没弹出来。`;
    }
    add('miss', report.missCount, total, 1.25, parts, ms, body);
  }

  const wrongReasons = [
    ['bigLeap', diag.bigLeap, 1.15, 'why_big_leap', '跨八度的大跳，手位移动没到位'],
    ['leap', diag.leap, 1.05, 'why_leap', '五度以上的跳进，跨度还没形成肌肉记忆'],
    ['repeat', diag.repeat, 0.95, 'why_repeat', '同音重复，容易多按或者提前离键'],
    ['shortRhythm', diag.shortRhythm, 1.0, 'why_short', '八分音符连着走，节奏型还没弹匀'],
    ['firstBeat', diag.firstBeat, 0.85, 'why_first_beat', '小节第一拍容易犹豫'],
  ];
  for (const [kind, arr, w, whyKey, whyText] of wrongReasons) {
    if (!arr || !arr.length) continue;
    const win = drillWindow(arr, totalMeasures);
    add(
      `wrong-${kind}`,
      arr.length,
      total,
      w,
      [...rangeParts(win), frag('wrong_mid'), num(arr.length), frag('wrong_tail'), frag(whyKey)],
      arr,
      `${rangeText(win)}错了 ${arr.length} 个音，是${whyText}。`,
    );
  }

  if (stdMs !== null && stdMs >= 250) {
    add(
      'rhythm-unstable',
      stdMs,
      1000,
      1.1,
      [frag('rhythm_unstable_head'), num(stdMs), frag('rhythm_unstable_tail')],
      report.problemMeasures.map((m) => m.measure),
      `节奏忽快忽慢，偏差到正负 ${stdMs} 毫秒，拍子还没吃到心里。`,
    );
  } else if (meanMs !== null && Math.abs(meanMs) > 120 && (stdMs === null || stdMs < 160)) {
    cautions.push(
      makeLine(
        'caution',
        [
          frag('shift_head'),
          frag(meanMs > 0 ? 'slower' : 'faster'),
          num(Math.abs(meanMs)),
          frag('shift_mid'),
          frag('shift_tail'),
        ],
        { subtype: 'timing-shift' },
      ),
    );
  }

  if (drift) {
    add(
      'tempo-drift',
      Math.abs(drift.diffSeconds) * 1000,
      1000,
      drift.faster ? 1.2 : 1.0,
      drift.faster ? [frag('drift_faster'), frag('drift_faster_tail')] : [frag('drift_slower')],
      [],
      drift.faster ? '后半段明显赶起来了，越弹越快。' : '后半段慢下来了，越弹越拖。',
    );
  }

  if (dyn) {
    if (dyn.mean < 0.22) add('dynamics-light', dyn.mean, 0.6, 0.8, [frag('dyn_light')], [], '整体弹得有点轻。');
    else if (dyn.cv > 0.55) add('dynamics-uneven', dyn.cv, 1, 0.75, [frag('dyn_uneven')], [], '力度忽大忽小。');
  }

  if (report.extraCount >= Math.max(3, total * 0.12)) {
    add(
      'extras',
      report.extraCount,
      total,
      0.7,
      [frag('extras_head'), num(report.extraCount), frag('extras_unit'), frag('extras_tail')],
      [],
      `另外还多出 ${report.extraCount} 个音，可能是踏板共振。`,
    );
  }

  cands.sort((a, b) => b.impact - a.impact);
  const issues = cands
    .slice(0, MAX_ISSUES)
    .map((c) => makeLine('issue', c.parts, { subtype: c.kind, measures: c.measures }));

  // 两条问题落在同一批小节只留一条（说两遍没意义）
  if (issues.length === 2 && issues[0].measures.length && issues[1].measures.length) {
    const a = new Set(issues[0].measures);
    const overlap = issues[1].measures.filter((m) => a.has(m)).length;
    if (overlap >= Math.min(issues[1].measures.length, 2)) issues.pop();
  }

  // ---------- 音名细节：最能让用户感到"它真的在听" ----------
  if (issues.length) {
    const target = issues.find((l) => /^wrong-/.test(l.subtype || '')) || issues[0];
    const pool = report.details.filter(
      (d) =>
        d.status === 'wrong' &&
        d.playedPitchMidi != null &&
        noteName(d.pitchMidi) !== noteName(d.playedPitchMidi) &&
        (!target.measures.length || target.measures.includes(d.measure)),
    );
    const w = pool[0];
    if (w) {
      const extra = [
        frag('note_tail_head'),
        unit('ordinal'),
        num(w.measure),
        unit('measure'),
        frag('note_head'),
        ...noteParts(w.pitchMidi),
        frag('note_mid'),
        ...noteParts(w.playedPitchMidi),
        punct('。'),
      ];
      const merged = makeLine(target.kind, [...target.parts, ...extra], {
        subtype: target.subtype,
        measures: target.measures,
      });
      Object.assign(target, merged);
    }
  }

  if (!issues.length) {
    if (report.overall >= 95) issues.push(makeLine('next', [frag('next_perfect')]));
    else if (!praise.length) issues.push(makeLine('plain', [frag('next_plain')]));
  }

  // ---------- 3. 练法 ----------
  const drillBpm = Math.max(40, Math.round((bpm * 0.75) / 5) * 5);
  const focusSource =
    (issues[0] && issues[0].measures && issues[0].measures.length && issues[0].measures) ||
    (report.problemMeasures[0] ? [report.problemMeasures[0].measure] : null);
  const focus = focusSource ? drillWindow(focusSource, totalMeasures) : null;

  const topKind = issues[0] ? issues[0].subtype || '' : '';
  let drill;
  if (focus) {
    focus.bpm = drillBpm;
    drill = makeLine('drill', [frag('drill_now'), ...rangeParts(focus), frag('drill_speed'), num(drillBpm), frag('drill_tail')], { focus });
  } else if (/tempo-drift/.test(topKind)) {
    drill = makeLine('drill', [frag('drill_metronome')]);
  } else if (/rhythm-unstable/.test(topKind)) {
    drill = makeLine('drill', [frag('drill_count')]);
  } else if (/dynamics/.test(topKind)) {
    drill = makeLine('drill', [frag('drill_dynamics')]);
  } else if (/extras/.test(topKind)) {
    drill = makeLine('drill', [frag('drill_extras')]);
  } else if (report.overall >= 95) {
    drill = makeLine('drill', [frag('drill_fast_head'), num(bpm * 1.15), frag('drill_fast_tail')]);
  } else {
    drill = makeLine('drill', [frag('drill_slow_head'), num(drillBpm), frag('drill_slow_tail')]);
  }

  const closing = makeLine('closing', [frag(report.overall >= 80 ? 'closing_ok' : 'closing_slow')]);

  // ---------- 4. 组装 + 长度守门（宁可少说，不能说不完）----------
  const lines = [...cautions, ...praise, ...issues, drill, closing];
  const charCount = () => lines.reduce((n, l) => n + l.text.length, 0);

  if (charCount() > SPOKEN_BUDGET && lines.filter((l) => l.kind === 'issue').length > 1) {
    lines.splice(lines.map((l) => l.kind).lastIndexOf('issue'), 1);
  }
  if (charCount() > SPOKEN_BUDGET) {
    const i = lines.findIndex((l) => l.kind === 'praise');
    if (i >= 0) lines.splice(i, 1);
  }

  return {
    lines,
    focus,
    totalChars: charCount(),
    facts: {
      hitRate,
      stdMs,
      meanMs,
      drift,
      dynamics: dyn,
      worstMeasures: report.problemMeasures.slice(0, 3).map((m) => m.measure),
      topIssues: issues.map((i) => i.subtype || i.kind),
    },
  };
}
