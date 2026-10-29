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
      <div id="scoreHost" class="score-host"></div>
      <div class="hint">黄色高亮 = 当前该弹的小节</div>
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
  status('<span class="ok">谱面已就绪。戴上耳机或外放，点「开始练习」。</span>');
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

  state.metronome = new Metronome({ bpm: state.bpm, countInBeats: 4 });
  state.metronome.onBeat = ({ countIn, countdown, beatInBar }) => {
    if (countIn) {
      status(`预备… <b>${countdown}</b>`);
    } else {
      status(
        `<span class="ok">练习中</span> · 第 ${beatInBar + 1} 拍 / 小节`,
      );
    }
  };
  state.metronome.onStart = async () => {
    state.phase = 'recording';
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

async function stopPractice(silent = false) {
  if (state.autoStopTimer) {
    clearInterval(state.autoStopTimer);
    state.autoStopTimer = null;
  }

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
      </div>

      <div class="block">
        <div class="plabel">问题小节</div>
        <div class="chips">${measureChips}</div>
      </div>

      ${extrasBlock(extraChips)}

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

function extrasBlock(chips) {
  if (!chips) return '';
  return `
    <div class="block">
      <div class="plabel">多出来的音</div>
      <div class="chips">${chips}</div>
    </div>`;
}