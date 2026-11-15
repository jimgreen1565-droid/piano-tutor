// 沉浸式演奏视觉 · 方案1+2 升级版
//   方案1：Canvas 频谱 —— 实时分析麦克风频谱，按能量着色（金色系）。
//   方案2：实时音高检测 —— 用自相关法从麦克风音频里直接算出你正在弹的音，
//          对应琴键立刻发光 + 涟漪，弹每个音屏幕都有反应（无需等录完）。
//   同时保留「转录完成后整体点亮」(applyNotes)，用于收尾闪示。
//   演奏时进入全屏沉浸式 stage，营造"新开一个页面"的炫酷感。

const KB_LOW = 36; // C2（键盘向下延伸到 C2）
const KB_HIGH = 96; // C7（键盘向上延伸到 C7）
const WHITE_PC = new Set([0, 2, 4, 5, 7, 9, 11]);
const BLACK_PC = new Set([1, 3, 6, 8, 10]);

// 自相关检测频率范围（覆盖 C2..C7，与键盘范围一致）
const MIN_FREQ = 60;
const MAX_FREQ = 2100;
const SILENCE_RMS = 0.008;
const CORR_RATIO = 0.45; // 自相关峰值需高于噪声基准的比例
const HOLD_MS = 170; // 琴键点亮保持时长（让延音也持续发光）

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToName(m) {
  const pc = ((m % 12) + 12) % 12;
  const oct = Math.floor(m / 12) - 1;
  return NOTE_NAMES[pc] + oct;
}

function midiFromFreq(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

export class PracticeVisual {
  constructor() {
    this.phase = 'idle';
    this.enabled = false;
    this.rafId = 0;
    this.audioCtx = null;
    this.source = null;
    this.analyser = null;
    this.freqData = null;
    this.timeData = null;
    this.keys = new Map(); // midi -> element
    this.currentMidi = -1;
    this.currentKind = 'play';
    this.holdTimer = 0;
    this.judge = null; // 演奏时由 practice.js 注入：midi => 'right' | 'wrong' | null
    this.demoTimer = 0;
    this.loopBound = this.loop.bind(this);

    this.buildStage();
  }

  buildStage() {
    const stage = document.createElement('div');
    stage.className = 'stage';
    stage.style.display = 'none';

    stage.innerHTML = `
      <div class="stage-glow"></div>
      <canvas class="stage-spectrum"></canvas>
      <div class="stage-note" id="stageNote"><span class="sn-name">—</span><span class="sn-label">等待你的第一个音</span></div>
      <div class="stage-kb"></div>
      <div class="stage-tag">钢琴陪练 · 演奏中</div>
    `;
    document.body.appendChild(stage);
    this.stage = stage;
    this.canvas = stage.querySelector('.stage-spectrum');
    this.ctx = this.canvas.getContext('2d');
    this.noteNameEl = stage.querySelector('.sn-name');
    this.noteLabelEl = stage.querySelector('.sn-label');
    this.kbEl = stage.querySelector('.stage-kb');

    this.buildKeyboard();
  }

  buildKeyboard() {
    // 先收集白键，确定白键宽度
    const whites = [];
    for (let m = KB_LOW; m <= KB_HIGH; m++) {
      if (WHITE_PC.has(((m % 12) + 12) % 12)) whites.push(m);
    }
    const whiteW = 100 / whites.length;
    const blackW = whiteW * 0.62;
    const whiteIndex = new Map();
    whites.forEach((m, i) => whiteIndex.set(m, i));

    // 白键
    for (const m of whites) {
      const el = document.createElement('div');
      el.className = 'kb-white';
      el.style.left = `${whiteIndex.get(m) * whiteW}%`;
      el.style.width = `${whiteW}%`;
      el.dataset.midi = String(m);
      this.kbEl.appendChild(el);
      this.keys.set(m, el);
    }
    // 黑键（落在前一个白键右侧边界上）
    for (let m = KB_LOW; m <= KB_HIGH; m++) {
      if (!BLACK_PC.has(((m % 12) + 12) % 12)) continue;
      let prev = m - 1;
      while (!WHITE_PC.has(((prev % 12) + 12) % 12)) prev--;
      const wi = whiteIndex.get(prev);
      const el = document.createElement('div');
      el.className = 'kb-black';
      el.style.left = `${(wi + 1) * whiteW - blackW / 2}%`;
      el.style.width = `${blackW}%`;
      el.dataset.midi = String(m);
      this.kbEl.appendChild(el);
      this.keys.set(m, el);
    }
  }

  // 必须在「用户手势」里调用：创建并恢复 AudioContext。
  // iOS 规定 AudioContext 只能在用户手势调用栈内创建/恢复，
  // 否则会被置为 suspended，analyser 读到的全是静音 → 琴键永远不亮。
  ensureAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!this.audioCtx) this.audioCtx = new AC();
    const ctx = this.audioCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  }

  // 进入演奏：stream 为麦克风 MediaStream
  start(stream) {
    if (this.enabled) return;
    // 复用 ensureAudio（已在 btnPractice 手势里创建并恢复），确保 ctx 是 running 状态
    if (!this.ensureAudio()) return;
    const ctx = this.audioCtx;

    if (!this.analyser) {
      this.source = ctx.createMediaStreamSource(stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.6;
      this.source.connect(this.analyser);
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeData = new Float32Array(this.analyser.fftSize);
    }
    this.sampleRate = ctx.sampleRate;

    this.enabled = true;
    this.phase = 'recording';
    this.stage.style.display = 'block';
    document.body.classList.add('stage-open');
    requestAnimationFrame(() => this.resize());
    this.resize();
    this.loopBound();
  }

  resize() {
    const w = Math.min(window.innerWidth, 900);
    const h = Math.round(w * 0.16);
    this.canvas.width = w;
    this.canvas.height = h || 120;
  }

  stop() {
    this.enabled = false;
    this.phase = 'idle';
    this.judge = null;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = 0;
    }
    this.clearKeys();
    this.clearExpected();
    this.currentMidi = -1;
    this.currentKind = 'play';
    this.noteNameEl.style.color = '';
    this.stage.style.display = 'none';
    document.body.classList.remove('stage-open');
  }

  // ---------- 示范阶段：显示「应弹」的正确按键 ----------
  // 仅展示，不参与麦克风分析；键盘以蓝色高亮当前应弹音
  startDemo() {
    if (this.stage.style.display !== 'block') {
      this.stage.style.display = 'block';
      document.body.classList.add('stage-open');
    }
    this.phase = 'demo';
  }

  stopDemo() {
    this.clearExpected();
    this.clearKeys();
    this.noteNameEl.textContent = '—';
    this.noteLabelEl.textContent = '等待你的第一个音';
    this.noteNameEl.style.color = '';
    this.stage.style.display = 'none';
    document.body.classList.remove('stage-open');
    this.phase = 'idle';
  }

  clearExpected() {
    for (const el of this.keys.values()) el.classList.remove('show');
    if (this.demoTimer) {
      clearTimeout(this.demoTimer);
      this.demoTimer = 0;
    }
  }

  // 示范时高亮某个「应弹」音（蓝色），短暂保持后自动熄灭
  showExpected(midi) {
    this.clearExpected();
    const el = this.keys.get(midi);
    if (!el) return;
    el.classList.add('show');
    this.noteNameEl.textContent = midiToName(Math.round(midi));
    this.noteLabelEl.textContent = '应弹';
    this.noteNameEl.style.color = '#9fd0ff';
    this.demoTimer = setTimeout(() => this.clearExpected(), 450);
  }

  // 用自相关法从时域波形里检测基频
  detectPitch() {
    const buf = this.timeData;
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < SILENCE_RMS) return -1;

    const sr = this.sampleRate;
    const minLag = Math.floor(sr / MAX_FREQ);
    const maxLag = Math.floor(sr / MIN_FREQ);
    let bestLag = -1;
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < SIZE - lag; i++) corr += buf[i] * buf[i + lag];
      corr /= SIZE - lag;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
    if (bestLag <= 0 || bestCorr < rms * CORR_RATIO) return -1;

    // 抛物线插值，提升精度
    let x1 = bestLag - 1;
    let x2 = bestLag + 1;
    let y1 = this.correlAt(buf, x1, SIZE);
    let y2 = this.correlAt(buf, x2, SIZE);
    let y0 = bestCorr;
    const denom = y1 + y2 - 2 * y0;
    let lagF = bestLag;
    if (denom !== 0) lagF = bestLag + ((y1 - y2) / (2 * denom));

    const freq = sr / lagF;
    if (freq < MIN_FREQ || freq > MAX_FREQ) return -1;
    return midiFromFreq(freq);
  }

  // 自相关失败时，用频域主峰兜底：钢琴谐波丰富，频谱里仍有清晰的主峰，
  // 足以判断正在弹哪个音（精度略低但能点亮琴键，保证"弹了就有反应"）。
  fftPeakMidi() {
    const data = this.freqData;
    if (!data) return -1;
    let maxV = 0;
    let maxI = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i] > maxV) {
        maxV = data[i];
        maxI = i;
      }
    }
    if (maxV < 30 || maxI <= 0) return -1;
    const freq = (maxI * this.sampleRate) / this.analyser.fftSize;
    if (freq < MIN_FREQ || freq > MAX_FREQ) return -1;
    return midiFromFreq(freq);
  }

  correlAt(buf, lag, SIZE) {
    let corr = 0;
    for (let i = 0; i < SIZE - lag; i++) corr += buf[i] * buf[i + lag];
    return corr / (SIZE - lag);
  }

  // 点亮某个音对应的琴键
  // kind: 'play' 金色(默认) | 'right' 绿色(弹对) | 'wrong' 红色(弹错)
  lightKey(midi, kind = 'play') {
    if (this.currentMidi === midi && this.currentKind === kind) return;
    this.clearKeys();
    this.currentMidi = midi;
    this.currentKind = kind;
    const el = this.keys.get(midi);
    if (!el) {
      this.noteNameEl.textContent = midiToName(Math.round(midi));
      return;
    }
    const cls = kind === 'right' ? 'right' : kind === 'wrong' ? 'wrong' : 'on';
    el.classList.add(cls);
    this.noteNameEl.textContent = midiToName(Math.round(midi));
    if (kind === 'right') {
      this.noteLabelEl.textContent = '✓ 弹对了';
      this.noteNameEl.style.color = '#7ef0a0';
    } else if (kind === 'wrong') {
      this.noteLabelEl.textContent = '✗ 音不对';
      this.noteNameEl.style.color = '#ff9a9a';
    } else {
      this.noteLabelEl.textContent = '♪';
      this.noteNameEl.style.color = '';
    }
    // 涟漪
    const ripple = document.createElement('div');
    ripple.className = 'kb-ripple';
    el.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => {
      this.holdTimer = 0;
      this.clearKeys();
      this.currentMidi = -1;
      this.currentKind = 'play';
    }, HOLD_MS);
  }

  clearKeys() {
    for (const el of this.keys.values()) {
      el.classList.remove('on', 'right', 'wrong', 'show');
    }
  }

  loop() {
    if (!this.enabled) return;
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getFloatTimeDomainData(this.timeData);
    this.drawSpectrum();

    let midi = this.detectPitch();
    if (midi <= 0) midi = this.fftPeakMidi(); // 自相关失败时用频谱主峰兜底
    if (midi > 0) {
      const rounded = Math.round(midi);
      if (this.keys.has(rounded)) {
        let kind = 'play';
        if (this.judge) {
          const j = this.judge(rounded);
          if (j === 'right') kind = 'right';
          else if (j === 'wrong') kind = 'wrong';
        }
        this.lightKey(rounded, kind);
      }
    }
    this.rafId = requestAnimationFrame(this.loopBound);
  }

  drawSpectrum() {
    const c = this.canvas;
    const ctx = this.ctx;
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const bins = this.freqData.length;
    const BARS = 72;
    const step = Math.floor(bins / BARS) || 1;
    const bw = w / BARS;
    let max = 1;
    for (let i = 0; i < BARS; i++) {
      let v = 0;
      for (let j = 0; j < step; j++) v += this.freqData[i * step + j] || 0;
      v = v / step;
      if (v > max) max = v;
    }
    for (let i = 0; i < BARS; i++) {
      let v = 0;
      for (let j = 0; j < step; j++) v += this.freqData[i * step + j] || 0;
      v = v / step;
      const t = v / 255;
      const bh = Math.max(1, t * h);
      const hue = 34 + (i / BARS) * 22;
      const sat = 60 + t * 25;
      const lum = 26 + t * 70;
      ctx.fillStyle = `hsla(${hue}, ${sat}%, ${lum}%, 0.92)`;
      ctx.fillRect(i * bw, h - bh, Math.max(1, bw - 0.6), bh);
    }
  }

  // 收尾：把转录结果整体闪示（保留接口）
  applyNotes(notes) {
    if (!notes || !notes.length) return;
    let i = 0;
    const flash = () => {
      if (i >= notes.length) return;
      const m = notes[i].pitchMidi;
      if (m != null && this.keys.has(m)) {
        const el = this.keys.get(m);
        el.classList.add('on');
        setTimeout(() => el.classList.remove('on'), 120);
      }
      i++;
      setTimeout(flash, 60);
    };
    flash();
  }
}
