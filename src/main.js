import './style.css';
import * as tf from '@tensorflow/tfjs';
import {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
} from '@spotify/basic-pitch';

const MODEL_URL = `${import.meta.env.BASE_URL}model/model.json`;

const NOTE_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F',
  'F#', 'G', 'G#', 'A', 'A#', 'B',
];

function midiToName(m) {
  const name = NOTE_NAMES[((m % 12) + 12) % 12];
  const oct = Math.floor(m / 12) - 1;
  return `${name}${oct}`;
}

const el = {};
const state = {
  backend: 'unknown',
  modelReady: false,
  basicPitch: null,
  stream: null,
  mediaRecorder: null,
  chunks: [],
  recording: false,
  processing: false,
};

function $(id) {
  return document.getElementById(id);
}

function log(msg) {
  const box = el.log;
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  box.textContent += `[${time}] ${msg}\n`;
  box.scrollTop = box.scrollHeight;
}

function setStatus(html) {
  el.status.innerHTML = html;
}

function setMeter(pct) {
  el.meter.classList.add('active');
  el.meterBar.style.width = `${Math.round(pct * 100)}%`;
}

function hideMeter() {
  el.meter.classList.remove('active');
}

async function initBackend() {
  await tf.ready();
  for (const name of ['webgl', 'cpu']) {
    if (tf.findBackend(name)) {
      try {
        await tf.setBackend(name);
        state.backend = name;
        log(`TF.js 后端：${name}`);
        return;
      } catch (e) {
        log(`后端 ${name} 不可用：${e.message}`);
      }
    }
  }
  throw new Error('没有可用的 TF.js 后端');
}

async function loadModel() {
  if (state.modelReady) return;
  log(`加载模型：${MODEL_URL}`);
  const bp = new BasicPitch(MODEL_URL);
  await bp.model; // 等待加载完成
  state.basicPitch = bp;
  state.modelReady = true;
  log('模型加载完成');
}

function pickMimeType() {
  const candidates = [
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) {
      return m;
    }
  }
  return '';
}

async function startRecording() {
  try {
    setStatus('请求麦克风权限…');
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    log('麦克风已获取');
  } catch (e) {
    setStatus(`<span class="err">无法获取麦克风：${e.message}</span>`);
    log(`getUserMedia 失败：${e.name} ${e.message}`);
    return;
  }

  const mimeType = pickMimeType();
  log(`录音格式：${mimeType || '默认'}`);

  try {
    state.mediaRecorder = mimeType
      ? new MediaRecorder(state.stream, { mimeType })
      : new MediaRecorder(state.stream);
  } catch (e) {
    setStatus(`<span class="err">MediaRecorder 初始化失败：${e.message}</span>`);
    log(`MediaRecorder 失败：${e.message}`);
    return;
  }

  state.chunks = [];
  state.mediaRecorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) state.chunks.push(ev.data);
  };
  state.mediaRecorder.onstop = () => {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
    processRecording();
  };

  state.mediaRecorder.start();
  state.recording = true;
  el.btnRecord.textContent = '⏹ 停止并分析';
  el.btnRecord.classList.remove('btn-primary');
  el.btnRecord.classList.add('btn-stop');
  setStatus('<span class="ok">录音中…</span> 弹几个音，然后点「停止并分析」。');
}

function stopRecording() {
  if (state.mediaRecorder && state.recording) {
    state.recording = false;
    state.mediaRecorder.stop();
    setStatus('正在处理音频…');
  }
}

async function decodeToMono22050(arrayBuffer) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  let audioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    ctx.close();
  }

  // 重采样到 22050 并降为单声道
  const targetRate = 22050;
  const duration = audioBuffer.duration;
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(duration * targetRate),
    targetRate,
  );
  const source = offline.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

async function processRecording() {
  if (state.processing) return;
  state.processing = true;
  el.btnRecord.disabled = true;
  try {
    const type = state.mediaRecorder.mimeType || 'audio/webm';
    const blob = new Blob(state.chunks, { type });
    log(`录音大小：${(blob.size / 1024).toFixed(1)} KB`);

    if (!state.modelReady) await loadModel();

    const arrayBuffer = await blob.arrayBuffer();
    setStatus('解码音频…');
    const mono = await decodeToMono22050(arrayBuffer);
    log(`解码完成，样本数：${mono.length}（${(mono.length / 22050).toFixed(2)}s）`);

    setStatus('正在转录（本地推理，不上传）…');
    const frames = [];
    const onsets = [];
    const contours = [];

    await state.basicPitch.evaluateModel(
      mono,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      (p) => setMeter(p),
    );

    hideMeter();
    log(`推理完成，frames=${frames.length}`);

    const notes = noteFramesToTime(
      addPitchBendsToNoteEvents(
        contours,
        outputToNotesPoly(frames, onsets, 0.25, 0.25, 5),
      ),
    );

    renderNotes(notes);
    setStatus(
      `<span class="ok">识别完成，共 ${notes.length} 个音符。</span>`,
    );
  } catch (e) {
    hideMeter();
    console.error(e);
    setStatus(`<span class="err">处理失败：${e.message}</span>`);
    log(`处理失败：${e.stack || e.message}`);
  } finally {
    state.processing = false;
    state.mediaRecorder = null;
    state.chunks = [];
    el.btnRecord.disabled = false;
    el.btnRecord.textContent = '🎙 开始录音';
    el.btnRecord.classList.remove('btn-stop');
    el.btnRecord.classList.add('btn-primary');
  }
}

function renderNotes(notes) {
  const box = el.notes;
  box.innerHTML = '';
  if (notes.length === 0) {
    box.innerHTML = '<div class="hint">没有识别到音符，请靠近麦克风再试一次。</div>';
    return;
  }
  const sorted = [...notes].sort(
    (a, b) => a.startTimeSeconds - b.startTimeSeconds,
  );
  for (const n of sorted) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML =
      `<span class="pitch">${midiToName(n.pitchMidi)}</span> ` +
      `<span class="time">t=${n.startTimeSeconds.toFixed(2)}s · ` +
      `len=${n.durationSeconds.toFixed(2)}s</span>`;
    box.appendChild(chip);
  }
}

function buildDom() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <h1>🎹 钢琴陪练 · 冒烟测试</h1>
    <p class="subtitle">验证 iPad 本地转录引擎能否工作（V0）</p>

    <div class="card">
      <h2>① 引擎状态</h2>
      <div class="status" id="status">正在初始化…</div>
      <div class="log" id="log"></div>
    </div>

    <div class="card">
      <h2>② 录制与识别</h2>
      <button class="btn btn-primary" id="btnRecord" disabled>🎙 开始录音</button>
      <div class="meter" id="meter"><div class="meter-bar" id="meterBar"></div></div>
      <div class="notes" id="notes"></div>
      <p class="hint">
        点「开始录音」，弹几个音（单音或和弦），再点「停止并分析」。
        识别出的音高会以标签形式显示在下方。
      </p>
    </div>
  `;

  for (const k of ['status', 'log', 'btnRecord', 'meter', 'meterBar', 'notes']) {
    el[k] = $(k);
  }
}

async function main() {
  buildDom();
  try {
    await initBackend();
    await loadModel();
    setStatus(
      `<span class="ok">就绪。</span> 后端 ${state.backend}，模型已加载。点下面开始录音。`,
    );
    el.btnRecord.disabled = false;
  } catch (e) {
    setStatus(`<span class="err">初始化失败：${e.message}</span>`);
    log(`初始化失败：${e.stack || e.message}`);
  }

  el.btnRecord.addEventListener('click', () => {
    if (state.processing) return;
    if (state.recording) {
      stopRecording();
    } else {
      startRecording();
    }
  });
}

main();
