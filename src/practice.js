import { Metronome } from './metronome.js';
import { evaluate, midiToName } from './score.js';
import { ensureModel, startCapture, transcribeBlob, getBackend } from './transcribe.js';

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
  capture: null,
  phase: 'idle', // idle | counting | recording | processing | report
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
      <div class="hint">黄色高亮 = 现在该弹的小节</div>
    </div>

    <div class="pcard">
      <div class="prow">
        <div class="plabel">速度</div>
        <div class="pvalue" id="bpmLabel">60 BPM</div>
      </div>
      <input type="range" id="bpm" min="40" max="120" step="5" value="60" class="slider" />
      <div class="hint">刚开始学建议 50~60 BPM，弹稳了再加速</div>
    </div>

    <button class="btn btn-primary btn-lg" id="btnPractice">▶ 开始练习</button>
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
  state.ui.scoreCard.hidden = true;
  state.ui.pieceTitle.textContent = '—';
  state.ui.pieceMeta.textContent = '';

  const list = state.index
    .map(
      (p) => `
      <button class="piece-item" data-id="${p.id}">
        <span class="piece-name">${p.title}</span>
        <span class="piece-tag">${'★'.repeat(p.difficulty)}${'☆'.repeat(3 - p.difficulty)}</span>
        <span class="piece-sub">${p.totalMeasures} 小节 · ${p.totalNotes} 音符</span>
      </button>`,
    )
    .join('');

  root.querySelector('#report').innerHTML = `
    <div class="pcard">
      <div class="plabel" style="margin-bottom:10px">选择曲目</div>
      ${list}
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
  state.ui.pieceMeta.textContent =
    `${item.totalMeasures} 小节 · ${item.totalNotes} 音符 · 难度 ${'★'.repeat(item.difficulty)}`;

  clearReport();

  const [xmlRes, jsonRes] = await Promise.all([
    fetch(`${BASE}scores/${id}.musicxml`),
    fetch(`${BASE}scores/${id}.json`),
  ]);
  const xml = await xmlRes.text();
  state.scoreJson = await jsonRes.json();

  state.ui.scoreCard.hidden = false;
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

  // 诊断用：?hl=3 可单独验证高亮是否渲染（不影响正常使用）
  const hl = new URLSearchParams(location.search).get('hl');
  if (hl) highlightMeasure(Number(hl));

  status('<span class="ok">谱面已就绪。戴耳机点「开始练习」，会先响 8 下预备拍。</span>');
}

async function startPractice() {
  if (!state.scoreJson) {
    status('<span class="err">先选一首曲子。</span>');
    return;
  }

  clearReport();
  state.phase = 'counting';
  state.ui.btnPractice.textContent = '⏹ 结束';
  state.ui.btnPractice.classList.remove('btn-primary');
  state.ui.btnPractice.classList.add('btn-stop');
  state.ui.pMeter.classList.remove('active');
  status('准备…');
  showCue('准备');

  state.metronome = new Metronome({ bpm: state.bpm, countInBeats: COUNT_IN });
  state.metronome.onBeat = ({ countIn, countdown, beatInBar }) => {
    if (countIn) {
      showCue(String(countdown));
      status(`预备… 还有 <b>${countdown}</b> 拍`);
    } else {
      status(`<span class="ok">练习中</span> · 第 ${beatInBar + 1} 拍 / 小节`);
    }
  };
  state.metronome.onStart = async () => {
    state.phase = 'recording';
    showCue('开始！', true);
    setTimeout(() => hideCueIfRunning(), 900);
    startFollow();
    try {
      state.capture = await startCapture();
    } catch (e) {
      status(`<span class="err">麦克风打开失败：${e.message}</span>`);
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
      highlightRect.setAttribute('fill', 'rgba(245, 158, 11, 0.25)');
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

  const capture = state.capture;
  state.capture = null;

  if (!capture) {
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
    const blob = await capture.stop();
    const notes = await transcribeBlob(blob, {
      onProgress: (p) => {
        state.ui.pMeterBar.style.width = `${Math.round(p * 100)}%`;
      },
    });
    state.ui.pMeter.classList.remove('active');

    const report = evaluate(state.scoreJson, notes, { bpm: state.bpm });
    renderReport(report, notes);
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
  state.ui.btnPractice.textContent = '▶ 开始练习';
  state.ui.btnPractice.classList.remove('btn-stop');
  state.ui.btnPractice.classList.add('btn-primary');
}

function clearReport() {
  state.ui.report.innerHTML = '';
  state.ui.pMeter.classList.remove('active');
}

function renderReport(r, notes) {
  const grade =
    r.overall >= 95 ? '优秀' : r.overall >= 80 ? '良好' : r.overall >= 60 ? '及格' : '继续加油';
  const color =
    r.overall >= 80 ? 'var(--accent2)' : r.overall >= 60 ? 'var(--warn)' : 'var(--danger)';

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
          <div class="score-sub">共 ${r.total} 个音 · 识别到 ${notes.length} 个</div>
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