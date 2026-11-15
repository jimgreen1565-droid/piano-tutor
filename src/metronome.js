// 节拍器：用 WebAudio 精确调度，而不是 setInterval
// 因为 JS 定时器有抖动，60BPM 下抖动几十毫秒就会让"节奏准不准"的评分失真。

export class Metronome {
  constructor({ bpm = 60, beatsPerBar = 4, countInBeats = 8, muteAfterCountIn = false } = {}) {
    this.bpm = bpm;
    this.beatsPerBar = beatsPerBar;
    this.countInBeats = countInBeats;
    // 正式演奏段是否静音节拍器：预备拍照常响，进入演奏后不再从扬声器出声。
    // 原因：iPad 没有耳机时，扬声器节拍声会被麦克风录进去混进转录 → 假音符/错评分。
    this.muteAfterCountIn = muteAfterCountIn;
    this.ctx = null;
    this.timer = null;
    this.nextBeat = 0; // 0 = 第一个预备拍
    this.nextBeatTime = 0;
    this.originTime = 0; // 正式第 0 拍的音频时间
    this.running = false;

    this.onBeat = () => {};
    this.onStart = () => {};
  }

  get secondsPerBeat() {
    return 60 / this.bpm;
  }

  /** 已进行的拍数（以正式第 0 拍为 0，可为负=准备中） */
  elapsedBeats() {
    if (!this.ctx) return 0;
    return (this.ctx.currentTime - this.originTime) / this.secondsPerBeat;
  }

  async start() {
    if (this.running) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    await this.ctx.resume();

    this.running = true;
    this.nextBeat = 0;
    this.nextBeatTime = this.ctx.currentTime + 0.2;
    this.originTime =
      this.nextBeatTime + this.countInBeats * this.secondsPerBeat;

    this._tick();
    this.timer = setInterval(() => this._tick(), 25);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch {
        /* ignore */
      }
      this.ctx = null;
    }
  }

  _tick() {
    if (!this.running || !this.ctx) return;
    const horizon = this.ctx.currentTime + 0.2;
    while (this.nextBeatTime < horizon) {
      const beatIndex = this.nextBeat;
      this._scheduleClick(this.nextBeatTime, beatIndex);

      const delayMs = Math.max(
        0,
        (this.nextBeatTime - this.ctx.currentTime) * 1000,
      );
      const isPieceStart = beatIndex === this.countInBeats;
      const beatInBar =
        (beatIndex - this.countInBeats + this.beatsPerBar * 100) %
        this.beatsPerBar;

      setTimeout(() => {
        if (!this.running) return;
        this.onBeat({
          beatIndex,
          beatInBar,
          countIn: beatIndex < this.countInBeats,
          countdown: this.countInBeats - beatIndex,
          isPieceStart,
        });
        if (isPieceStart) this.onStart();
      }, delayMs);

      this.nextBeat += 1;
      this.nextBeatTime += this.secondsPerBeat;
    }
  }

  _scheduleClick(time, beatIndex) {
    const isCountIn = beatIndex < this.countInBeats;
    const beatInBar =
      (beatIndex - this.countInBeats + this.beatsPerBar * 100) %
      this.beatsPerBar;
    const isLastCountIn = isCountIn && beatIndex === this.countInBeats - 1;
    const strong = !isCountIn && beatInBar === 0;

    // 演奏段静音：预备拍照常响（给节奏），正式演奏不再从扬声器出声，
    // 避免被麦克风录进去污染转录。onBeat/onStart 仍照常触发，节奏与录音不受影响。
    if (this.muteAfterCountIn && !isCountIn) return;

    if (isCountIn) {
      // 预备拍：保留原来的「哔」音（音高明显，容易听清倒数）
      this._beep(time, {
        freq: isLastCountIn ? 1760 : 880,
        peak: isLastCountIn ? 0.4 : 0.22,
      });
    } else {
      // 演奏段：木鱼式「嗒」——宽带噪声瞬态，没有固定音高，
      // Basic Pitch 不会把它转录成音符，麦克风录进去也不影响评分。
      this._tick2(time, { strong });
    }
  }

  /** 短促「哔」声（正弦+方波混合，带音高） */
  _beep(time, { freq, peak }) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.07);
  }

  /** 木鱼式「嗒」声：白噪声 burst 过带通滤波（中心~2000Hz），无固定音高 */
  _tick2(time, { strong }) {
    // 增大音量：更长的 burst + 更强峰值 + 慢衰
    const dur = 0.08;              // 从 0.03 → 0.08s（更易被听见）
    const buf = this.ctx.createBuffer(1, Math.ceil(dur * this.ctx.sampleRate), this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      // 指数衰减的白噪声，衰减系数改为 -20 让尾巴更长
      data[i] = (Math.random() * 2 - 1) * Math.exp(-20 * (i / data.length));
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    // 稍微降低中心频率、稍宽Q，让更多能量通过
    filter.frequency.value = 1800;
    filter.Q.value = 1.2;

    const gain = this.ctx.createGain();
    const peak = strong ? 0.8 : 0.5;      // 增大峰值：强拍 0.5→0.8，弱拍 0.3→0.5
    gain.gain.setValueAtTime(peak, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08); // 增大尾部衰减时长

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start(time);
    src.stop(time + dur + 0.01);
  }
}
