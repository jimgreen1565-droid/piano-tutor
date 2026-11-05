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
//   part 类型：{t:'f'}固定片段 / {t:'n'}数字 / {t:'q'}小节短语 / {t:'u'}量词 / {t:'note'}音名
//   数字与小节短语都整块预渲染（不把「四十」「五」或「第」「到」拆开念），
//   否则听感是「四 十 五」一顿一顿的（用户 m04572）。

const MAX_ISSUES = 2; // 最多说几个问题
const SPOKEN_BUDGET = 240; // 口播总字数上限（约 35 秒）

// ---------- 固定片段表：每个 key 对应一个预渲染音频文件 ----------

export const F = {
  // 识别层 / 设备层（不怪学生的事）
  octave_head: '先说一句，这次听出来的音整体比谱面',
  higher: '高了',
  lower: '低了',
  octave_tail: '个八度，这是麦克风识别的问题，不是你弹错。下面按位置说。',
  // 这两个是整句，不再拆成「偏」+「快了」+「毫秒」——
  // 拆碎拼起来会变成播报腔，而且"正负 38 毫秒"这种说法对学琴的人也没意义。
  shift_faster: '另外整体速度偏快，而且每次都偏得差不多，这里面有一部分是录音启动的延迟，不全怪你。',
  shift_slower: '另外整体速度偏慢，而且每次都偏得差不多，这也可能是录音启动带来的延迟。',

  // 肯定
  praise_progress_head: '比上次进步了',
  score_unit: '分。',
  praise_pitch_mid: '个音弹对了',
  praise_pitch_tail: '个，音准基本没问题。',
  praise_all_ok: '整首都弹下来了，音准基本没问题。',
  praise_rhythm_ok: '节奏挺稳的，拍子基本都落在该落的地方。',
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
  miss_count_many: '漏的地方不少，通常是手位没提前找好，到那儿就顿了一下。',
  miss_solo_big: '最明显，漏的地方不少，通常是手位没提前找好，到那儿就顿了一下。',
  miss_one_big_mid: '也有，同样漏得不少，多半也是手位没提前找好。',
  miss_many_big_unit: '个小节也有，漏得不少，通常都是手位没提前找好。',
  miss_tail: '没弹出来。通常是手位没提前找好，到那儿就顿了一下。',

  // 问题：错音（按成因说，学生才知道怎么改）
  wrong_mid: '错了',
  wrong_mid_many: '错得比较多，',
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
  rhythm_unstable: '节奏忽快忽慢，说明拍子还没吃到心里。',
  drift_faster: '后半段明显赶起来了，越弹越快。',
  drift_faster_tail: '这是最容易听出来的问题。',
  drift_slower: '后半段慢下来了，越弹越拖。',

  // 问题：力度 / 杂音
  dyn_light: '整体弹得有点轻，很多琴键没把琴键送到底。',
  dyn_uneven: '力度忽大忽小，句子的起伏还没控制住。',
  extras_head: '另外还多出',
  extras_unit: '个',
  extras_many: '另外还混进来不少多余的声音，踩踏板让弦共振是正常的，不用管。',
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

// 数字整读成一个片段，而不是拆成[四十][五]再拼。
// 拆块拼接的问题（用户 m04572「每次到数字的时候很怪异」）：
//   ① 每个块是独立合成的，语调各自「落地」，拼起来像念清单；
//   ② 块之间要插 45ms 静音，听感是「四 十 五」一顿一顿；
//   ③ 四十/五十 这类块的音高走向在别的数字里根本不合适。
// 代价是片段数量变多（见 NUM_DOMAIN），换来的是像真人一口气说出来的。
export function numClips(n) {
  return [numToCn(n)];
}

// ---------- 常用数值 / 小节短语：整块预渲染（数量与音质之间取的折中）----------

/** 出现概率高的数值：1–100 全覆盖，速度类（5 的倍数）补到 190 */
export const NUM_DOMAIN = [
  ...Array.from({ length: 100 }, (_, i) => i + 1),
  ...Array.from({ length: 18 }, (_, i) => 105 + i * 5),
];

/** 小节短语最多覆盖到第几小节（更长的曲子退回「第」+数字+「小节」拼接） */
export const Q_MEASURE_MAX = 44;

/** 小节短语槽位：整块合成，避免把「第」「到」当成孤立字念 */
export const Q_SLOTS = {
  mof: { pre: '第', post: '小节' }, // 第 7 小节
  mt: { pre: '第', post: '到' }, // 第 4 到…
};

/** 片段清单（coach.js 是唯一事实源：生成音频、自检、运行时都读它） */
export function clipInventory() {
  const out = [];
  for (const k of Object.keys(F)) if (F[k]) out.push({ key: 'f:' + k, text: F[k] });
  for (const k of Object.keys(U)) if (U[k]) out.push({ key: 'u:' + k, text: U[k] });
  for (const n of NUM_DOMAIN) out.push({ key: 'n:' + numToCn(n), text: numToCn(n) });
  for (const k of NOTE_KEYS) out.push({ key: 'k:' + k, text: k });
  for (const slot of Object.keys(Q_SLOTS)) {
    const s = Q_SLOTS[slot];
    for (let v = 1; v <= Q_MEASURE_MAX; v++) {
      out.push({ key: `q:${slot}:${v}`, text: s.pre + numToCn(v) + s.post });
    }
  }
  return out;
}

// ---------- 片段渲染 ----------

const frag = (k) => ({ t: 'f', k });
const unit = (k) => ({ t: 'u', k });
const num = (v) => ({ t: 'n', v: Math.round(v) });
// 小节短语：整块片段（q 槽位），字幕显示成「第 5 小节」
const mof = (v) => ({ t: 'q', slot: 'mof', v });
const mt = (v) => ({ t: 'q', slot: 'mt', v });
// 纯标点：只出现在字幕里，不占音频片段（"。" 单独合成出来是空的）
const punct = (s = '。') => ({ t: 'p', s });

const inQRange = (v) => Number.isFinite(v) && v >= 1 && v <= Q_MEASURE_MAX;

/** 「第 5 小节」；超出预渲染范围时退回 第+5+小节 拼接（老曲子也不至于哑掉） */
const measureParts = (v) => (inQRange(v) ? [mof(v)] : [unit('ordinal'), num(v), unit('measure')]);

/** 小节区间 → 片段（第 5 小节 / 第 5 到 6 小节） */
function rangeParts(r) {
  if (r.from === r.to) return measureParts(r.from);
  if (inQRange(r.from) && inQRange(r.to)) return [mt(r.from), mof(r.to)];
  return [unit('ordinal'), num(r.from), unit('to'), num(r.to), unit('measure')];
}

/** 显示字幕（数字与汉字之间留半个空格，读起来不挤） */
export function partsToText(parts) {
  const raw = parts
    .map((p) => {
      if (p.t === 'f') return F[p.k] ?? '';
      if (p.t === 'u') return U[p.k] ?? '';
      if (p.t === 'n') return String(p.v);
      if (p.t === 'q') {
        const s = Q_SLOTS[p.slot];
        return s.pre + p.v + s.post;
      }
      if (p.t === 'note') return p.k;
      if (p.t === 'p') return p.s;
      return '';
    })
    .join('');
  return raw
    .replace(/(\d)([\u4e00-\u9fa5])/g, '$1 $2')
    .replace(/([\u4e00-\u9fa5])(\d)/g, '$1 $2')
    .replace(/([\u4e00-\u9fa5])([A-G])/g, '$1 $2'); // 音名（拉丁字母）也隔开
}

/** 朗读片段 key 序列（交给 voice-clips.js 取音频） */
export function partsToSay(parts) {
  const out = [];
  for (const p of parts) {
    if (p.t === 'f') out.push('f:' + p.k);
    else if (p.t === 'u') out.push('u:' + p.k);
    else if (p.t === 'n') for (const tok of numClips(p.v)) out.push('n:' + tok);
    else if (p.t === 'q') out.push(`q:${p.slot}:${p.v}`);
    else if (p.t === 'note') out.push('k:' + p.k);
  }
  return out;
}

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
    // 音符总数可能是几百（长曲子），数值片段只预渲染到 100 以内 → 大曲子改说整句
    praise.push(
      makeLine(
        'praise',
        total <= 100
          ? [num(total), frag('praise_pitch_mid'), num(report.hitCount), frag('praise_pitch_tail')]
          : [frag('praise_all_ok')],
      ),
    );
  } else if (stdMs !== null && stdMs < 120 && stdMs >= 5) {
    // 不报毫秒：对学琴的人没意义，而且「正负 38 毫秒」是最像播报的一句
    praise.push(makeLine('praise', [frag('praise_rhythm_ok')]));
  } else if (total && report.missCount === 0) {
    praise.push(makeLine('praise', [frag('praise_flow')]));
  } else if (report.hitCount >= 8 && totalMeasures) {
    const m = Math.max(1, Math.floor(totalMeasures / 3));
    praise.push(makeLine('praise', [frag('praise_head_ok'), ...measureParts(m), frag('praise_head_ok_tail')]));
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
    // 漏音数可能是几百（长曲），数值片段只到 100 → 超过就改说「漏的地方不少」
    const cnt = report.missCount <= 100 ? [num(report.missCount), frag('note_count_unit'), frag('miss_tail')] : [];
    let parts;
    let body;
    if (!rest.length) {
      parts = [...measureParts(lead), frag('miss_solo_head'), ...cnt];
      if (!cnt.length) parts = [...measureParts(lead), frag('miss_solo_big')];
      body = `第 ${lead} 小节最明显，一共 ${report.missCount} 个音没弹出来。`;
    } else if (rest.length === 1) {
      parts = cnt.length
        ? [...measureParts(lead), frag('miss_one_head'), ...measureParts(rest[0]), frag('miss_one_mid'), ...cnt]
        : [...measureParts(lead), frag('miss_one_head'), ...measureParts(rest[0]), frag('miss_one_big_mid')];
      body = `第 ${lead} 小节最明显，另外第 ${rest[0]} 小节也有，一共 ${report.missCount} 个音没弹出来。`;
    } else {
      parts = [
        ...measureParts(lead),
        frag('miss_many_head'),
        num(rest.length),
        frag(cnt.length ? 'miss_many_unit' : 'miss_many_big_unit'),
        ...cnt,
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
      [
        ...rangeParts(win),
        ...(arr.length <= 100 ? [frag('wrong_mid'), num(arr.length), frag('wrong_tail')] : [frag('wrong_mid_many')]),
        frag(whyKey),
      ],
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
      [frag('rhythm_unstable')],
      report.problemMeasures.map((m) => m.measure),
      `节奏忽快忽慢，偏差到正负 ${stdMs} 毫秒，拍子还没吃到心里。`,
    );
  } else if (meanMs !== null && Math.abs(meanMs) > 120 && (stdMs === null || stdMs < 160)) {
    cautions.push(
      makeLine('caution', [frag(meanMs > 0 ? 'shift_slower' : 'shift_faster')], { subtype: 'timing-shift' }),
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
      report.extraCount <= 100
        ? [frag('extras_head'), num(report.extraCount), frag('extras_unit'), frag('extras_tail')]
        : [frag('extras_many')],
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
        ...measureParts(w.measure),
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
    drill = makeLine('drill', [frag('drill_fast_head'), num(Math.round((bpm * 1.15) / 5) * 5), frag('drill_fast_tail')]);
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
