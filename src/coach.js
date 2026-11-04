// 教练层：把评分引擎的结构化事实，压成"老师会说的话"
//
// 设计原则（和一个真钢琴老师对齐）：
//   1. 一次只说 2 个问题，不列清单。说多了学生记不住。
//   2. 每个问题必须带位置（第几小节），否则学生不知道该去哪儿改。
//   3. 必须给一个能立刻做的动作（降到多少速度、练哪几小节、练几遍）。
//   4. 先给一个具体的肯定，但要具体到事实，不能是"弹得不错"这种空话。
//   5. 识别层的偏差（整体八度偏移）要主动说清，不能让学生以为自己弹错了。
//
// 输出同时给两处用：屏幕上显示的字幕（逐句高亮）+ 语音朗读的文本。
// 以后再接大模型改写话术时，facts 就是喂给它的输入，不用重算。

const MAX_ISSUES = 2; // 最多说几个问题
const SPOKEN_BUDGET = 240; // 口播总字数上限（约 35 秒）

/** 音名的中文念法：语音念 "C#4" 会读成一串怪字符，必须转成"升F" */
const SHARP_CN = { 1: '升C', 3: '升D', 6: '升F', 8: '升G', 10: '升A' };
const PLAIN_CN = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

export function noteName(midi) {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return SHARP_CN[pc] || PLAIN_CN[(pc / 2) | 0] || PLAIN_CN[pc];
}

const fmtMeasure = (m) => `第 ${m} 小节`;

/** 按"问题最集中的小节排前面"排序——老师先说最严重的那一处 */
function rankMeasures(measures) {
  const c = new Map();
  for (const m of measures) {
    if (Number.isFinite(m)) c.set(m, (c.get(m) || 0) + 1);
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([m, n]) => ({ m, n }));
}

/** 文字里说位置：最严重的那一处点名，其余最多再带两个，避免变成流水账 */
function describeMeasures(measures) {
  const r = rankMeasures(measures);
  if (!r.length) return '';
  if (r.length === 1) return `第 ${r[0].m} 小节`;
  const rest = r.slice(1, 3).map((x) => x.m);
  return `第 ${r[0].m} 小节最明显，另外 ${rest.join('、')} 小节也有`;
}

/** 练法用的窄窗口：以最严重的那一小节为中心，最多圈 3 小节（圈太大等于没圈） */
function drillWindow(measures, totalMeasures) {
  const r = rankMeasures(measures);
  if (!r.length) return null;
  const worst = r[0].m;
  let from = Math.max(1, worst - 1);
  let to = worst + 1;
  // 紧挨着的最严重的下一处可以并进来（不比最严重的那处少太多才并）
  if (r[1] && r[1].m === worst + 1 && r[1].n * 2 >= r[0].n) to = worst + 2;
  if (to - from + 1 > 3) to = from + 2;
  if (totalMeasures) {
    from = Math.min(from, totalMeasures);
    to = Math.min(to, totalMeasures);
  }
  if (to <= from) to = Math.min(totalMeasures || from + 1, from + 1);
  return { from, to };
}

const fmtRange = (r) =>
  r.from === r.to ? fmtMeasure(r.from) : `第 ${r.from} 到 ${r.to} 小节`;

/** 均值/标准差 */
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}

/**
 * 从演奏数据里挖出"听起来"能听出来的事。
 * played 里如果有 amplitude，力度也能说；没有就跳过（不编）。
 */
function listeningFacts(report, played) {
  const hits = report.details.filter((d) => d.status === 'hit' && d.deviationSec !== null);

  // 速度漂移：把命中音按时间三等分，比前后段的节奏偏差
  let drift = null;
  if (hits.length >= 6) {
    const third = Math.max(1, Math.floor(hits.length / 3));
    const head = hits.slice(0, third);
    const tail = hits.slice(-third);
    const dh = mean(head.map((d) => d.deviationSec));
    const dt = mean(tail.map((d) => d.deviationSec));
    const diff = dt - dh;
    if (Math.abs(diff) > 0.12) drift = { diff, faster: diff < 0 }; // 偏差变小 = 越来越早 = 赶
  }

  // 力度：Basic Pitch 给的幅度。有才说。
  let dyn = null;
  const amps = (played || []).map((p) => p && p.amplitude).filter((a) => Number.isFinite(a) && a > 0);
  if (amps.length >= 8) {
    const m = mean(amps);
    const sd = std(amps);
    dyn = { mean: m, cv: sd / m };
  }

  return { drift, dyn };
}

/**
 * 主入口。
 * @param report evaluate() 的返回值
 * @param scoreJson 谱面
 * @param played 识别出的演奏音符（含 amplitude 时能讲力度）
 * @param opts { bpm, prev }
 */
export function coachScript(report, scoreJson, played, opts = {}) {
  const bpm = opts.bpm || scoreJson?.bpm || 60;
  const total = report.total || 0;
  const totalMeasures = scoreJson?.totalMeasures || 0;
  const { drift, dyn } = listeningFacts(report, played);

  const cautions = [];
  const praise = [];
  const issues = [];

  // ---------- 0. 识别层偏差：必须最先说 ----------
  if (report.octaveShift) {
    const dir = report.octaveShift > 0 ? '高' : '低';
    const oct = Math.abs(report.octaveShift) / 12;
    cautions.push({
      kind: 'caution',
      subtype: 'recognition',
      text: `先说一句：这次听出来的音整体比谱面${dir}了 ${oct} 个八度，这是麦克风识别的问题，不是你弹错。下面按位置说。`,
    });
  }

  // ---------- 1. 具体的肯定 ----------
  const hitRate = total ? report.hitCount / total : 0;
  const stdMs = report.timing.stdMs;
  const meanMs = report.timing.meanMs;

  if (opts.prev && typeof opts.prev.last === 'number' && report.overall > opts.prev.last + 2) {
    praise.push(`比上次进步了 ${report.overall - opts.prev.last} 分。`);
  } else if (hitRate >= 0.9 && total) {
    praise.push(`${total} 个音弹对了 ${report.hitCount} 个，音准基本没问题。`);
  } else if (stdMs !== null && stdMs >= 5 && stdMs < 120) {
    praise.push(`节奏很稳，跟节拍器的偏差只有正负 ${stdMs} 毫秒。`);
  } else if (report.missCount === 0 && total) {
    praise.push('整首一次顺下来了，中间没有卡壳。');
  } else if (report.hitCount >= 8) {
    praise.push(`开头到第 ${Math.max(1, Math.floor(totalMeasures / 3))} 小节是顺的。`);
  }

  // ---------- 2. 问题（按影响排序，最多说两条）----------
  const cands = [];
  const push = (kind, count, denom, weight, text, measures) => {
    cands.push({ kind, impact: weight * (denom ? count / denom : 0), count, text, measures });
  };

  // 漏音：卡壳，比弹错更值得说
  if (report.missCount > 0) {
    const ms = report.details.filter((d) => d.status === 'miss').map((d) => d.measure);
    push(
      'miss',
      report.missCount,
      total,
      1.25,
      `${describeMeasures(ms)}，一共 ${report.missCount} 个音没弹出来——通常是手位没提前找好，到那儿就顿了一下。`,
      ms,
    );
  }

  // 错音：按成因分（大跳 > 跳进 > 同音重复 > 八分 > 起拍）
  const wrongByReason = [
    ['bigLeap', report.diagnosis?.bigLeap, 1.15, '跨八度的大跳，是手位移动没到位，不是看错谱'],
    ['leap', report.diagnosis?.leap, 1.05, '五度以上的跳进，跨度还没形成肌肉记忆'],
    ['repeat', report.diagnosis?.repeat, 0.95, '同一个音重复的地方，容易多按或者提前离键'],
    ['shortRhythm', report.diagnosis?.shortRhythm, 1.0, '八分音符连着走的地方，节奏型还没弹匀'],
    ['firstBeat', report.diagnosis?.firstBeat, 0.85, '每个小节第一拍容易犹豫'],
  ];
  for (const [kind, arr, w, why] of wrongByReason) {
    if (!arr || !arr.length) continue;
    push(
      `wrong-${kind}`,
      arr.length,
      total,
      w,
      `${describeMeasures(arr)}，错了 ${arr.length} 个音，是${why}。`,
      arr,
    );
  }

  // 具体到某个音名（最能体现"真的听了"）
  const worstM = report.problemMeasures[0];
  let namedNote = null;
  if (worstM) {
    const w = report.details.find(
      (d) => d.measure === worstM.measure && d.status === 'wrong' && d.playedPitchMidi != null,
    );
    if (w && noteName(w.pitchMidi) !== noteName(w.playedPitchMidi)) {
      namedNote = {
        measure: w.measure,
        text: `${fmtMeasure(w.measure)}里有个 ${noteName(w.pitchMidi)} 弹成了 ${noteName(
          w.playedPitchMidi,
        )}。`,
      };
    }
  }

  // 节奏：忽快忽慢 / 整体偏
  if (stdMs !== null && stdMs >= 250) {
    push(
      'rhythm-unstable',
      stdMs,
      1000,
      1.1,
      `节奏忽快忽慢，偏差到正负 ${stdMs} 毫秒，说明拍子还没吃到心里。`,
      report.problemMeasures.map((m) => m.measure),
    );
  } else if (meanMs !== null && Math.abs(meanMs) > 120 && (stdMs === null || stdMs < 160)) {
    const dir = meanMs > 0 ? '慢' : '快';
    cautions.push({
      kind: 'caution',
      subtype: 'timing-shift',
      text: `另外节奏整体偏${dir}了 ${Math.abs(meanMs)} 毫秒，但每次偏得都很一致——这里面有一部分是录音启动的延迟，不全怪你。`,
    });
  }

  // 速度漂移（越弹越快是初学者最典型的毛病，老师一定会说）
  if (drift) {
    push(
      'tempo-drift',
      Math.abs(drift.diff) * 1000,
      1000,
      drift.faster ? 1.2 : 1.0,
      drift.faster
        ? '后半段明显赶起来了，越弹越快——这是最容易听出来的问题。'
        : '后半段慢下来了，越弹越拖。',
      [],
    );
  }

  // 力度
  if (dyn) {
    if (dyn.mean < 0.22) {
      push('dynamics-light', dyn.mean, 0.6, 0.8, '整体弹得有点轻，很多音没把琴键送到底。', []);
    } else if (dyn.cv > 0.55) {
      push('dynamics-uneven', dyn.cv, 1, 0.75, '力度忽大忽小，句子的起伏还没控制住。', []);
    }
  }

  // 多弹（可能是踏板/环境音，说清楚）
  if (report.extraCount >= Math.max(3, total * 0.12)) {
    push(
      'extras',
      report.extraCount,
      total,
      0.7,
      `另外还多出 ${report.extraCount} 个音，如果是踩了踏板让弦继续共振，那是正常的，不用管。`,
      [],
    );
  }

  cands.sort((a, b) => b.impact - a.impact);
  for (const c of cands.slice(0, MAX_ISSUES)) issues.push(c);

  // 两条问题落在同几小节就别说了：一次只让学生改一件事
  if (
    issues.length === 2 &&
    issues[1].measures.length &&
    issues[0].measures.length &&
    issues[1].measures.every((m) => issues[0].measures.includes(m))
  ) {
    issues.pop();
  }

  // 把最有代表性的音名插到第一条问题后面（只在"说错音"的那条上补，且要同一个小节）
  if (namedNote && issues.length && /^wrong-/.test(issues[0].kind)) {
    const first = issues[0];
    if (!first.measures.length || first.measures.includes(namedNote.measure)) {
      first.text += `　${namedNote.text}`;
    }
  }

  // 完全没有问题时也要说点什么，不能空着（但别和练法重复）
  if (!issues.length) {
    if (report.overall >= 95) {
      issues.push({
        kind: 'next',
        impact: 0,
        text: '这一遍已经没什么可挑的了，难点都过了。',
        measures: [],
      });
    } else if (!praise.length) {
      issues.push({
        kind: 'plain',
        impact: 0,
        text: '这次没抓到明显的错处，注意把每个音弹到底、声音立起来。',
        measures: [],
      });
    }
  }

  // ---------- 3. 练法（一个能立刻做的动作）----------
  const drillBpm = Math.max(40, Math.round((bpm * 0.75) / 5) * 5);
  const top = issues[0];
  const focusSource =
    (top && top.measures.length && top.measures) ||
    (report.problemMeasures[0] && [report.problemMeasures[0].measure]) ||
    null;
  const focus = focusSource ? drillWindow(focusSource, totalMeasures) : null;

  // 问题不是"某个小节的问题"时，练法要换个练法（节奏/力度类）
  const drillByKind = {
    'tempo-drift': '开着节拍器再走一遍，后半段刻意压住，听见 click 再落键，不要往前赶。',
    'rhythm-unstable': '先不弹，跟着节拍器把整首的拍子拍一遍，再回琴上按同样的速度弹。',
    'dynamics-light': '把速度放下，每个音都保证弹到底、听声音立住，再连起来。',
    'dynamics-uneven': '单独练两遍力度：该强的地方真给上去，弱的地方收住，别一条直线。',
    extras: '弹的时候留意手上有没有带响别的音，踏板和手肘离键都干净一点。',
  };

  let drill;
  if (focus) {
    focus.bpm = drillBpm;
    drill = `现在就练 ${fmtRange(focus)}：速度降到 ${drillBpm}，慢弹三遍，每遍只盯一个地方。`;
  } else if (top && drillByKind[top.kind]) {
    drill = drillByKind[top.kind];
  } else if (report.overall >= 95) {
    drill = `保持现在这样，再把速度提到 ${Math.round(bpm * 1.15)} 走一遍，或者换一首更难的。`;
  } else {
    drill = `先把速度降到 ${drillBpm}，整首再走一遍，只求把每个音弹准。`;
  }

  const closing = report.overall >= 80 ? '准备好了就再来一遍，我听着。' : '慢练比多弹有用，先按这个速度来。';

  // ---------- 组装 + 长度守门 ----------
  const lines = [
    ...cautions,
    ...praise.map((t) => ({ kind: 'praise', text: t })),
    ...issues.map((i) => ({ kind: i.kind === 'plain' || i.kind === 'next' ? i.kind : 'issue', text: i.text, measures: i.measures })),
    { kind: 'drill', text: drill, focus },
    { kind: 'closing', text: closing },
  ];

  // 超预算就先砍第二条问题，再砍肯定，保证练法不被砍掉
  let spoken = lines.reduce((n, l) => n + l.text.length, 0);
  if (spoken > SPOKEN_BUDGET && lines.filter((l) => l.kind === 'issue').length > 1) {
    const idx = lines.map((l) => l.kind).lastIndexOf('issue');
    spoken -= lines[idx].text.length;
    lines.splice(idx, 1);
  }
  if (spoken > SPOKEN_BUDGET) {
    const i = lines.findIndex((l) => l.kind === 'praise');
    if (i >= 0) lines.splice(i, 1);
  }

  return {
    lines,
    focus,
    totalChars: lines.reduce((n, l) => n + l.text.length, 0),
    facts: {
      hitRate,
      stdMs,
      meanMs,
      drift,
      dynamics: dyn,
      worstMeasures: report.problemMeasures.slice(0, 3).map((m) => m.measure),
      topIssues: issues.map((i) => i.kind),
    },
  };
}
