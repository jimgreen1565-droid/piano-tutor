// 节拍器：用 WebAudio 精确调度，而不是 setInterval
// 因为 JS 定时器有抖动，60BPM 下抖动几十毫秒就会让"节奏准不准"的评分失真。

export class Metronome {
  constructor({ bpm = 60, beatsPerBar = 4, countInBeats = 8 } = {}) {
    this.bpm = bpm;
    this.beatsPerBar = beatsPerBar;
    this.countInBeats = countInBeats;

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

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';

    // 最后一拍预备用更高更亮的音，明确"立刻开始"
    osc.frequency.value = isLastCountIn ? 1760 : isCountIn ? 880 : strong ? 1320 : 990;

    const peak = isLastCountIn ? 0.4 : isCountIn ? 0.22 : strong ? 0.4 : 0.24;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.07);
  }
}
