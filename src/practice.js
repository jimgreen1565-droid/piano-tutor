import { Metronome } from './metronome.js';
import { evaluate, midiToName } from './score.js';
import { ensureModel, prepareMic, transcribeBlob, getBackend } from './transcribe.js';
import { playDemo } from './demo.js';
import { addRecord, summaryFor, persistentProblems } from './history.js';
import { icons } from './icons.js';

// 谱面库体积较大，按需加载，避免首屏就下载
let OSMDClass = null;
async function loadOSMD() {
  if (OSMDClass) return OSMDClass;
  const mod = await import('opensheetmusicdisplay');
  OSMDClass = mod.OpenSheetMusicDisplay;
  return OSMDClass;
}

const BASE = import.meta.env.BASE_URL;

// 预备拍：两小节，给足时间把手放好
const COUNT_IN = 8;

const state = {
  index: [],
  piece: null, // 当前曲目 index 项
  scoreJson: null, // 含逐音时间信息
  osmd: null,
  bpm: 60,
  metronome: null,
  mic: null,
  recordStartedAt: 0,
  recordDelayMs: 0,
  demo: null,
  phase: 'idle', // idle | counting | recording | processing | report | demo
  ui: {},
};

export function mountPractice(root) {
  root.innerHTML = `
    <div class="pcard">
      <div class="prow">
        <div>
          <div class="plabel">当前曲子</div>
          <div class="pvalue" id="pieceTitle">—</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="btnSwitch">换一首</button>
      </div>
      <div id="pieceMeta" class="pmeta"></div>
    </div>

    <div class="pcard" id="scoreCard" hidden>
      <div class="score-wrap">
        <div id="scoreHost" class="score-host"></div>
        <div id="cue" class="cue"></div>
      </div>
      <div class="hint">蓝色高亮 = 现在该弹的小节</div>
    </div>

    <div class="pcard">
      <div class="prow">
        <div class="plabel">速度</div>
        <div class="pvalue" id="bpmLabel">60 BPM</div>
      </div>
      <input type="range" id="bpm" min="40" max="120" step="5" value="60" class="slider" />

      <div class="prow" style="margin-top:14px">
        <div class="plabel">预备拍</div>
        <select id="countIn" class="select">
          <option value="4">4 拍（快）</option>
          <option value="8" selected>8 拍（推荐）</option>
          <option value="12">12 拍（慢）</option>
        </select>
      </div>

      <button class="btn btn-ghost" id="btnDemo" style="margin-top:14px">
        <span class="ic">${icons.headphones()}</span>先听一遍示范
      </button>
      <div class="hint">示范会把每个音弹出来，谱面同步高亮，用来先建立"手感位置"</div>
    </div>

    <button class="btn btn-primary btn-lg" id="btnPractice">
      <span class="ic">${icons.play()}</span>开始练习
    </button>
    <div class="status" id="pStatus"></div>
    <div class="meter" id="pMeter"><div class="meter-bar" id="pMeterBar"></div></div>

    <div id="report"></div>
  `;

  const ui = state.ui;
  for (const id of [
    'pieceTitle',
    'pieceMeta',
    'scoreCard',
    'scoreHost',
    'cue',
    'bpm',
    'bpmLabel',
    'countIn',
    'btnDemo',
    'btnPractice',
    'btnSwitch',
    'pStatus',
    'pMeter',
    'pMeterBar',
    'report',
  ]) {
    ui[id] = root.querySelector('#' + id);
  }

  ui.bpm.addEventListener('input', () => {
    state.bpm = Number(ui.bpm.value);
    ui.bpmLabel.textContent = `${state.bpm} BPM`;
  });

  ui.btnDemo.addEventListener('click', () => toggleDemo());

  ui.btnPractice.addEventListener('click', () => {
    if (state.phase === 'idle' || state.phase === 'report') startPractice();
    else if (state.phase === 'counting' || state.phase === 'recording') stopPractice();
  });

  ui.btnSwitch.addEventListener('click', () => {
    if (state.phase === 'counting' || state.phase === 'recording') return;
    showPicker(root);
  });

  return {
    load: loadIndex,
    showPicker: () => showPicker(root),
    openPiece: (id) => openPiece(id, root),
    root,
  };
}

function status(html) {
  state.ui.pStatus.innerHTML = html;
}

// 带图标的按钮文案（图标+文字同语言，切换状态时整块替换）
function setBtn(el, icon, text) {
  el.innerHTML = `<span class="ic">${icon}</span>${text}`;
}

function fmtDuration(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`;
}

async function loadIndex() {
  const res = await fetch(`${BASE}scores/index.json`);
  state.index = await res.json();
  await ensureModel();
  status(
    `<span class="ok">准备就绪（引擎后端 ${getBackend()}）。选一首曲子开始。</span>`,
  );
}

function showPicker(root) {
  clearReport();
  clearMarks();
  clearHighlight();
  state.ui.scoreCard.hidden = true;
  state.ui.pieceTitle.textContent = '—';
  state.ui.pieceMeta.textContent = '';

  const LEVEL_ORDER = [1, 2, 3, 4];
  const LEVEL_NAMES = { 1: '入门', 2: '初级', 3: '中级', 4: '进阶' };
  const LEVEL_DESC = {
    1: '刚认识键盘，五指之内',
    2: '能完整弹短旋律',
    3: '有八分音符 / 三拍子',
    4: '开始有升降号',
  };

  const groups = LEVEL_ORDER.map((lv) => ({
    level: lv,
    name: LEVEL_NAMES[lv],
    desc: LEVEL_DESC[lv],
    pieces: state.index.filter((p) => (p.level || p.difficulty) === lv),
  })).filter((g) => g.pieces.length);

  const sections = groups
    .map((g) => {
      const items = g.pieces
        .map((p) => {
          const hist = summaryFor(p.id);
          const kindTag =
            p.kind === 'exercise'
              ? '<span class="kind-tag">练习</span>'
              : '';
          const isLong = (p.durationSec || 0) >= 90;
          const longTag = isLong ? '<span class="kind-tag long">长曲</span>' : '';
          return `
          <button class="piece-item" data-id="${p.id}">
            <span class="piece-line">
              <span class="piece-name">${p.title}</span>
              ${kindTag}${longTag}
              ${hist ? `<span class="piece-best">最好 ${hist.best} 分</span>` : ''}
            </span>
            <span class="piece-sub">${p.totalMeasures} 小节 · ${p.totalNotes} 音符 · ${
              p.timeSignature?.beats || 4
            }/4 拍 · 约 ${fmtDuration(p.durationSec)}</span>
          </button>`;
        })
        .join('');

      return `
        <details class="level-group" ${g.level === 1 ? 'open' : ''}>
          <summary class="level-head">
            <span class="level-badge">${g.name}</span>
            <span class="level-count">${g.pieces.length} 首</span>
            <span class="level-desc">${g.desc}</span>
            <span class="level-chevron">${icons.chevronDown()}</span>
          </summary>
          <div class="level-body">${items}</div>
        </details>`;
    })
    .join('');

  root.querySelector('#report').innerHTML = `
    <div class="pcard hero">
      <img class="hero-img" src="${BASE}img/keys.jpg" alt="钢琴黑白键特写" />
      <div class="hero-scrim"></div>
      <div class="hero-text">
        <div class="hero-title">今天练哪一首？</div>
        <div class="hero-sub">${state.index.length} 首已按难度排好 · 从入门到进阶</div>
      </div>
    </div>
    <div class="pcard">
      <div class="plabel" style="margin-bottom:12px">选择曲目 · 共 ${state.index.length} 首（按等级分组，点等级展开）</div>
      ${sections}
    </div>
  `;

  root.querySelectorAll('.piece-item').forEach((el) => {
    el.addEventListener('click', () => openPiece(el.dataset.id, root));
  });
}

async function openPiece(id, root) {
  const item = state.index.find((p) => p.id === id);
  if (!item) return;

  state.piece = item;
  state.bpm = item.bpm;
  state.ui.bpm.value = String(item.bpm);
  state.ui.bpmLabel.textContent = `${item.bpm} BPM`;
  state.ui.pieceTitle.textContent = item.title;
  const hist = summaryFor(item.id);
  const level = item.level || item.difficulty || 1;
  state.ui.pieceMeta.textContent =
    `${item.levelName || ''} · ${item.totalMeasures} 小节 · ${item.totalNotes} 音符 · ${item.timeSignature?.beats || 4}/4 拍 · 约 ${fmtDuration(item.durationSec)}` +
    (hist ? `　|　最好 ${hist.best} 分 · 练过 ${hist.count} 次` : '');

  clearReport();
  clearMarks();
  clearHighlight();

  // 先把"加载中"放出来，避免点完没反应
  state.ui.scoreCard.hidden = false;
  state.ui.scoreHost.innerHTML =
    '<div class="score-loading">正在加载谱面…</div>';
  status('正在加载谱面…');

  const t0 = performance.now();
  const [xmlRes, jsonRes] = await Promise.all([
    fetch(`${BASE}scores/${id}.musicxml`),
    fetch(`${BASE}scores/${id}.json`),
  ]);
  const xml = await xmlRes.text();
  state.scoreJson = await jsonRes.json();

  const host = state.ui.scoreHost;
  host.innerHTML = '';

  if (!state.osmd) {
    const OpenSheetMusicDisplay = await loadOSMD();
    state.osmd = new OpenSheetMusicDisplay(host, {
      autoResize: true,
      backend: 'svg',
      drawingParameters: 'compacttight',
      disableCursor: true,
    });
  }

  await state.osmd.load(xml);
  state.osmd.render();
  state.currentMeasure = null;
  clearHighlight();

  // 诊断用：?hl=3 单独验证高亮；?testmarks=1 验证错音标注
  const qs = new URLSearchParams(location.search);
  const hl = qs.get('hl');
  if (hl) highlightMeasure(Number(hl));
  if (qs.get('testmarks')) {
    const fake = {
      details: state.scoreJson.notes.map((n, i) => ({
        ...n,
        status: i % 7 === 0 ? 'wrong' : i % 11 === 0 ? 'miss' : 'hit',
        playedPitchMidi: n.pitchMidi + 2,
        playedTime: n.beat,
        expectedTime: n.beat,
      })),
    };
    markErrors(fake);
    return;
  }

  // 诊断用：?testreport=1 用模拟演奏跑一遍完整报告（验证 UI 与归因逻辑）
  if (qs.get('testreport')) {
    const bpm = state.bpm;
    const spb = 60 / bpm;
    const played = state.scoreJson.notes
      .filter((_, i) => i % 9 !== 4)
      .map((n, i) => ({
        pitchMidi: i % 13 === 3 ? n.pitchMidi + 2 : n.pitchMidi,
        startTimeSeconds: n.beat * spb + (i % 5 === 0 ? 0.12 : 0),
        durationSeconds: n.durationBeats * spb * 0.9,
        amplitude: 0.6,
      }));
    const report = evaluate(state.scoreJson, played, {
      bpm,
      persistentMeasures: [{ measure: 3, fails: 3 }],
    });
    renderReport(report, played, { last: report.overall - 6, count: 4, best: report.overall });
    markErrors(report);
    return;
  }

  status('<span class="ok">谱面已就绪。可以先「听一遍示范」，再点「开始练习」。</span>');
  console.debug(`谱面加载耗时 ${Math.round(performance.now() - t0)}ms`);
}

async function startPractice() {
  if (!state.scoreJson) {
    status('<span class="err">先选一首曲子。</span>');
    return;
  }

  if (state.demo) {
    state.demo.stop();
    state.demo = null;
    setBtn(state.ui.btnDemo, icons.headphones(), '先听一遍示范');
  }
  clearMarks();
  clearReport();
  state.phase = 'counting';
  setBtn(state.ui.btnPractice, icons.stop(), '结束');
  state.ui.btnPractice.classList.remove('btn-primary');
  state.ui.btnPractice.classList.add('btn-stop');
  state.ui.pMeter.classList.remove('active');
  status('准备麦克风…');
  showCue('准备');

  // 先拿到麦克风（授权弹窗如果出现在预备拍中途，会打乱起始时间）
  try {
    state.mic = await prepareMic();
  } catch (e) {
    state.phase = 'idle';
    resetButton();
    hideCue();
    status(`<span class="err">麦克风打开失败：${e.message}</span>`);
    return;
  }

  const countIn = Number(state.ui.countIn?.value || COUNT_IN);

  const beatsPerBar = state.scoreJson.timeSignature?.beats || 4;
  state.metronome = new Metronome({
    bpm: state.bpm,
    beatsPerBar,
    countInBeats: countIn,
  });
  state.metronome.onBeat = ({ countIn: isCountIn, countdown, beatInBar }) => {
    if (isCountIn) {
      showCue(String(countdown));
      status(`预备… 还有 <b>${countdown}</b> 拍`);
    } else {
      status(`<span class="ok">练习中</span> · 第 ${beatInBar + 1} 拍 / 小节`);
    }
  };

  state.metronome.onStart = () => {
    state.phase = 'recording';
    showCue('开始！', true);
    setTimeout(() => hideCueIfRunning(), 900);
    startFollow();

    // 关键：记录"正式第 0 拍"到"录音真正开始"之间的延迟，
    // 之后把所有识别到的音符时间整体补偿回去，否则会表现为系统性"抢拍"。
    const beat0At = performance.now();
    try {
      state.recordStartedAt = state.mic.start();
      state.recordDelayMs = state.recordStartedAt - beat0At;
    } catch (e) {
      status(`<span class="err">录音启动失败：${e.message}</span>`);
      stopPractice(true);
    }
  };

  await state.metronome.start();

  // 到曲子结束自动收
  const totalBeats = state.scoreJson.totalBeats;
  state.autoStopTimer = setInterval(() => {
    if (!state.metronome || state.phase !== 'recording') return;
    if (state.metronome.elapsedBeats() > totalBeats + 1.5) {
      stopPractice();
    }
  }, 200);
}

// ---------- 谱面跟随高亮 ----------

let highlightRect = null;

function clearHighlight() {
  if (highlightRect && highlightRect.parentNode) {
    highlightRect.parentNode.removeChild(highlightRect);
  }
  highlightRect = null;
  state.currentMeasure = null;
}

function highlightMeasure(measureNo) {
  try {
    const svg = state.ui.scoreHost.querySelector('svg');
    if (!svg) return;
    const g = svg.querySelector(`g.vf-measure[id="${measureNo}"]`);
    if (!g) return;

    const bbox = g.getBBox();
    if (!highlightRect || highlightRect.ownerSVGElement !== svg) {
      highlightRect = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'rect',
      );
      highlightRect.setAttribute('fill', 'rgba(37, 99, 235, 0.10)');
      highlightRect.setAttribute('rx', '5');
      highlightRect.setAttribute('pointer-events', 'none');
      // 插入到最前面，保证在音符下面
      svg.insertBefore(highlightRect, svg.firstChild);
    }
    highlightRect.setAttribute('x', String(bbox.x - 8));
    highlightRect.setAttribute('y', String(bbox.y - 8));
    highlightRect.setAttribute('width', String(bbox.width + 16));
    highlightRect.setAttribute('height', String(bbox.height + 16));
  } catch {
    /* 高亮失败不影响练习 */
  }
}

function startFollow() {
  stopFollow();
  const beatsPerBar = state.scoreJson.timeSignature?.beats || 4;
  const totalMeasures = state.scoreJson.totalMeasures;

  const loop = () => {
    if (!state.metronome || state.phase !== 'recording') return;
    const b = state.metronome.elapsedBeats();
    if (b >= 0) {
      const m = Math.min(totalMeasures, Math.floor(b / beatsPerBar) + 1);
      if (m !== state.currentMeasure) {
        state.currentMeasure = m;
        highlightMeasure(m);
      }
    }
    state.followRaf = requestAnimationFrame(loop);
  };
  state.followRaf = requestAnimationFrame(loop);
}

function stopFollow() {
  if (state.followRaf) cancelAnimationFrame(state.followRaf);
  state.followRaf = null;
}

// ---------- 开始提示 ----------

function showCue(text, big = false) {
  const cue = state.ui.cue;
  if (!cue) return;
  cue.textContent = text;
  cue.classList.add('show');
  cue.classList.toggle('big', big);
}

// ---------- 示范播放 ----------

function toggleDemo() {
  if (state.demo) {
    state.demo.stop();
    state.demo = null;
    setBtn(state.ui.btnDemo, icons.headphones(), '先听一遍示范');
    state.phase = 'idle';
    clearHighlight();
    status('示范已停止。');
    return;
  }
  if (
    state.phase === 'counting' ||
    state.phase === 'recording' ||
    state.phase === 'processing'
  ) {
    return;
  }
  if (!state.scoreJson) return;

  state.phase = 'demo';
  setBtn(state.ui.btnDemo, icons.stop(), '停止示范');
  status(`示范播放中（${state.bpm} BPM）…`);

  state.demo = playDemo(state.scoreJson, state.bpm, {
    onMeasure: (m) => {
      state.currentMeasure = m;
      highlightMeasure(m);
    },
    onEnd: () => {
      state.demo = null;
      setBtn(state.ui.btnDemo, icons.headphones(), '先听一遍示范');
      state.phase = 'idle';
      clearHighlight();
      status('<span class="ok">示范结束，可以开始练了。</span>');
    },
  });
}

// ---------- 错音标注 ----------

let markGroup = null;

function clearMarks() {
  if (markGroup && markGroup.parentNode) {
    markGroup.parentNode.removeChild(markGroup);
  }
  markGroup = null;
}

function markErrors(report) {
  try {
    clearMarks();
    const svg = state.ui.scoreHost.querySelector('svg');
    if (!svg) return;

    const noteEls = [...svg.querySelectorAll('g.vf-stavenote')];
    const details = report.details;
    if (!noteEls.length || !details.length) return;

    // 单声部旋律：DOM 里的音符顺序 = 谱面音符顺序，数量一致时可直接一一对应
    if (noteEls.length !== details.length) return;

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', 'err-marks');
    svg.insertBefore(group, svg.firstChild);
    markGroup = group;

    let count = 0;
    details.forEach((e, i) => {
      if (e.status === 'hit') return;
      const el = noteEls[i];
      if (!el || !el.getBBox) return;

      let bbox;
      try {
        bbox = el.getBBox();
      } catch {
        return;
      }
      if (!bbox || !bbox.width) return;

      const wrong = e.status === 'wrong';
      const rect = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'rect',
      );
      rect.setAttribute('fill', wrong ? 'rgba(220, 38, 38, 0.14)' : 'rgba(217, 119, 6, 0.14)');
      rect.setAttribute('stroke', wrong ? '#dc2626' : '#d97706');
      rect.setAttribute('stroke-width', '1.2');
      rect.setAttribute('rx', '3');
      rect.setAttribute('pointer-events', 'none');
      rect.setAttribute('x', String(bbox.x - 3));
      rect.setAttribute('y', String(bbox.y - 3));
      rect.setAttribute('width', String(bbox.width + 6));
      rect.setAttribute('height', String(bbox.height + 6));
      group.appendChild(rect);
      count++;
    });

    if (count) {
      state.ui.scoreCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch {
    /* 标注失败不影响评分 */
  }
}

function hideCueIfRunning() {
  if (state.phase === 'recording') {
    state.ui.cue?.classList.remove('show', 'big');
  }
}

function hideCue() {
  state.ui.cue?.classList.remove('show', 'big');
}

async function stopPractice(silent = false) {
  if (state.autoStopTimer) {
    clearInterval(state.autoStopTimer);
    state.autoStopTimer = null;
  }

  stopFollow();
  clearHighlight();
  hideCue();

  if (state.metronome) {
    state.metronome.stop();
    state.metronome = null;
  }

  const mic = state.mic;
  state.mic = null;
  const recordDelayMs = state.recordDelayMs || 0;

  if (!mic) {
    resetButton();
    state.phase = 'idle';
    if (silent) status('<span class="err">已停止。</span>');
    return;
  }

  state.phase = 'processing';
  state.ui.btnPractice.disabled = true;
  status('正在识别你的演奏…');
  state.ui.pMeter.classList.add('active');
  state.ui.pMeterBar.style.width = '0%';

  try {
    const blob = await mic.stop();
    let notes = await transcribeBlob(blob, {
      onProgress: (p) => {
        state.ui.pMeterBar.style.width = `${Math.round(p * 100)}%`;
      },
    });
    state.ui.pMeter.classList.remove('active');

    // 补偿"录音真正开始的时刻晚于第 0 拍"造成的整体偏移
    if (recordDelayMs > 5) {
      notes = notes.map((n) => ({
        ...n,
        startTimeSeconds: n.startTimeSeconds + recordDelayMs / 1000,
      }));
    }

    const persistentMeasures = persistentProblems(state.piece.id, { lastN: 5 });
    const report = evaluate(state.scoreJson, notes, {
      bpm: state.bpm,
      persistentMeasures,
    });
    const prev = summaryFor(state.piece.id);
    addRecord({
      pieceId: state.piece.id,
      title: state.piece.title,
      bpm: state.bpm,
      overall: report.overall,
      hitCount: report.hitCount,
      total: report.total,
      extraCount: report.extraCount,
      errorMeasures: report.problemMeasures.map((m) => m.measure),
    });
    renderReport(report, notes, prev);
    markErrors(report);
    state.phase = 'report';
  } catch (e) {
    console.error(e);
    status(`<span class="err">识别失败：${e.message}</span>`);
    state.phase = 'idle';
  } finally {
    state.ui.btnPractice.disabled = false;
    resetButton();
  }
}

function resetButton() {
  setBtn(state.ui.btnPractice, icons.play(), '开始练习');
  state.ui.btnPractice.classList.remove('btn-stop');
  state.ui.btnPractice.classList.add('btn-primary');
}

function clearReport() {
  state.ui.report.innerHTML = '';
  state.ui.pMeter.classList.remove('active');
}

function renderReport(r, notes, prev) {
  const grade =
    r.overall >= 95 ? '优秀' : r.overall >= 80 ? '良好' : r.overall >= 60 ? '及格' : '继续加油';
  const color =
    r.overall >= 80 ? 'var(--success)' : r.overall >= 60 ? 'var(--warning)' : 'var(--danger)';

  const deltaText =
    prev && typeof prev.last === 'number'
      ? `　本次 ${r.overall >= prev.last ? '+' : ''}${r.overall - prev.last}（上次 ${prev.last}）`
      : '';

  const stat = (label, value, sub) => `
    <div class="stat">
      <div class="stat-value">${value}</div>
      <div class="stat-label">${label}${sub ? `<span class="stat-sub">${sub}</span>` : ''}</div>
    </div>`;

  const timingText =
    r.timing.meanMs === null
      ? '—'
      : `${r.timing.meanMs > 0 ? '+' : ''}${r.timing.meanMs}ms`;
  const timingSub =
    r.timing.meanMs === null
      ? ''
      : Math.abs(r.timing.meanMs) < 60
        ? '很贴节拍'
        : r.timing.meanMs > 0
          ? '整体偏慢'
          : '整体偏快';

  const measureChips = r.problemMeasures.length
    ? r.problemMeasures
        .slice(0, 6)
        .map(
          (m) =>
            `<span class="chip chip-bad">第${m.measure}小节 ${
              m.wrong ? `错${m.wrong}` : ''
            }${m.miss ? `漏${m.miss}` : ''}</span>`,
        )
        .join('')
    : '<span class="chip chip-ok">没有明显问题小节</span>';

  const extraChips = r.extras.length
    ? r.extras
        .slice(0, 6)
        .map(
          (x) =>
            `<span class="chip">${midiToName(x.pitchMidi)} @${x.time.toFixed(1)}s${
              x.nearMeasure ? ` (近第${x.nearMeasure}小节)` : ''
            }</span>`,
        )
        .join('')
    : '';

  state.ui.report.innerHTML = `
    <div class="pcard report">
      <div class="score-row">
        <div class="score-big" style="color:${color}">${r.overall}</div>
        <div class="score-meta">
          <div class="score-grade" style="color:${color}">${grade}</div>
          <div class="score-sub">共 ${r.total} 个音 · 识别到 ${notes.length} 个${deltaText}</div>
        </div>
      </div>

      <div class="stats">
        ${stat('弹对', r.hitCount, `/${r.total}`)}
        ${stat('弹错', r.wrongCount)}
        ${stat('漏音', r.missCount)}
        ${stat('多弹', r.extraCount)}
      </div>

      <div class="stat-wide">
        <div class="stat-label">节奏偏差（相对节拍器）</div>
        <div class="stat-value-sm">${timingText} <span class="stat-sub">${timingSub}</span></div>
        <div class="stat-label" style="margin-top:8px">稳定性</div>
        <div class="stat-value-sm">${
          r.timing.stdMs === null ? '—' : `±${r.timing.stdMs}ms`
        } <span class="stat-sub">${
          r.timing.stdMs === null
            ? ''
            : r.timing.stdMs < 120
              ? '很稳'
              : r.timing.stdMs < 250
                ? '略有起伏'
                : '忽快忽慢'
        }</span></div>
        ${
          r.timing.stdMs !== null &&
          r.timing.stdMs < 100 &&
          Math.abs(r.timing.meanMs) > 120
            ? `<div class="hint">整体偏移很一致（±${r.timing.stdMs}ms），<b>很可能包含录音设备延迟</b>，不完全是你在抢拍或拖拍。</div>`
            : ''
        }
      </div>

      <div class="block">
        <div class="plabel">问题小节</div>
        <div class="chips">${measureChips}</div>
      </div>

      ${diagnosisBlock(r.diagnosis)}

      ${extrasBlock(extraChips)}

      ${debugBlock(r)}

      <div class="block">
        <div class="plabel">讲评</div>
        <ul class="advice">
          ${r.advice.map((t) => `<li>${t}</li>`).join('')}
        </ul>
      </div>

      <button class="btn btn-primary" id="btnAgain">再练一遍</button>
    </div>
  `;

  state.ui.report.querySelector('#btnAgain').addEventListener('click', () => {
    state.phase = 'idle';
    clearReport();
    startPractice();
  });
}

function diagnosisBlock(d) {
  if (!d) return '';

  const rows = [
    ['跨八度大跳', d.bigLeap, '手位移动没到位'],
    ['5 度以上跳进', d.leap, '跨度还没形成记忆'],
    ['同音重复', d.repeat, '容易多按 / 提前离键'],
    ['八分音符', d.shortRhythm, '节奏型没弹匀'],
    ['小节第一拍', d.firstBeat, '起拍容易犹豫'],
  ].filter(([, arr]) => arr && arr.length);

  if (!rows.length && !(d.persistentMeasures || []).length) return '';

  const list = (arr) => {
    const uniq = [...new Set(arr)].sort((a, b) => a - b);
    return `第 ${uniq.slice(0, 5).join('、')} 小节`;
  };

  const causeHtml = rows
    .map(
      ([label, arr, why]) => `
      <div class="cause-row">
        <span class="cause-count">${arr.length}</span>
        <span class="cause-body">
          <b>${label}</b> · ${list(arr)}
          <span class="cause-why">${why}</span>
        </span>
      </div>`,
    )
    .join('');

  const bottleneck = (d.persistentMeasures || []).length
    ? `<div class="bottleneck">
         反复卡住：${d.persistentMeasures
           .slice(0, 3)
           .map((m) => `第 ${m.measure} 小节（近几次错了 ${m.fails} 次）`)
           .join('、')}
       </div>`
    : '';

  return `
    <div class="block">
      <div class="plabel">错误归因</div>
      ${bottleneck}
      ${rows.length ? `<div class="causes">${causeHtml}</div>` : ''}
    </div>`;
}

function debugBlock(r) {
  const lines = r.details
    .filter((e) => e.status !== 'hit')
    .slice(0, 24)
    .map((e) => {
      const want = midiToName(e.pitchMidi);
      if (e.status === 'miss') {
        return `第${e.measure}小节  要 ${want}  @${e.expectedTime.toFixed(2)}s → 没弹到`;
      }
      const got = midiToName(e.playedPitchMidi);
      const dt = Math.round((e.playedTime - e.expectedTime) * 1000);
      return `第${e.measure}小节  要 ${want}  @${e.expectedTime.toFixed(2)}s → 弹成 ${got}  (${
        dt > 0 ? '+' : ''
      }${dt}ms)`;
    });

  if (!lines.length) return '';

  const shift = r.octaveShift
    ? `<div class="warnline">检出系统性偏移：整体${r.octaveShift > 0 ? '偏高' : '偏低'} ${Math.abs(
        r.octaveShift,
      ) / 12} 个八度</div>`
    : '';

  return `
    <details class="block debug">
      <summary>详细对照（排查用）</summary>
      ${shift}
      <pre class="debug-pre">${lines.join('\n')}</pre>
    </details>`;
}

function extrasBlock(chips) {
  if (!chips) return '';
  return `
    <div class="block">
      <div class="plabel">多出来的音</div>
      <div class="chips">${chips}</div>
    </div>`;
}