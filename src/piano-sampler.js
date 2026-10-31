// 真实钢琴采样回放器（Salamander Grand Piano，Alexander Holm，CC-BY 3.0）
//
// 采样集是每 3 个半音一个真实录音（小三度间距，A0→C8 共 30 个文件）。
// 回放时取最近的采样、用 playbackRate 变速补到目标音高
// （最大偏移 ±1.5 半音，音色几乎听不出差别）。
//
// 按需加载：只下载"这首曲子用得到的"采样，一首 40 音的小曲通常只要 3~6 个文件。

const SAMPLE_MIDIS = [
  21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75,
  78, 81, 84, 87, 90, 93, 96, 99, 102, 105, 108,
];

/** midi → 采样文件名（升号写成 s，避免 URL 里出现 #） */
export function sampleFileName(midi) {
  const names = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
  const oct = Math.floor(midi / 12) - 1;
  return names[midi % 12] + oct + '.mp3';
}

/** 采样集覆盖的音高（导出供校验） */
export const SAMPLE_SET = SAMPLE_MIDIS;

/** 找离目标最近的那个采样音 */
export function nearestSampleMidi(midi) {
  let best = SAMPLE_MIDIS[0];
  let bestD = Infinity;
  for (const s of SAMPLE_MIDIS) {
    const d = Math.abs(s - midi);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

const BASE = import.meta.env?.BASE_URL || './';

// 已下载的原始字节缓存（跨多次示范复用；解码后的 AudioBuffer 绑定 context，不跨 context 复用）
const rawCache = new Map();

async function fetchRaw(midi) {
  if (rawCache.has(midi)) return rawCache.get(midi);
  const url = `${BASE}samples/piano/${sampleFileName(midi)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  // 拿到 HTML（比如 404 页）时给出明确原因，而不是等到解码才报 EncodingError
  if (buf.byteLength < 256 || new Uint8Array(buf)[0] === 0x3c) {
    throw new Error(`不是音频数据（${buf.byteLength}B，疑似错误页）`);
  }
  rawCache.set(midi, buf);
  return buf;
}

/** 采样回放器：一个实例绑定一个 AudioContext */
export class PianoSampler {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.dest = dest || ctx.destination;
    this.buffers = new Map(); // sampleMidi -> AudioBuffer
    this.failures = []; // {midi, name, reason} —— 不静默：加载失败要在界面上看得见
    this.pending = null;
  }

  get loadedCount() {
    return this.buffers.size;
  }

  /** 目标音高需要哪些采样文件 */
  static needed(midis) {
    const set = new Set();
    for (const m of midis) set.add(nearestSampleMidi(m));
    return [...set].sort((a, b) => a - b);
  }

  /** 加载这批音高需要的采样；已加载的跳过 */
  async loadForMidis(midis, { onProgress } = {}) {
    const need = PianoSampler.needed(midis).filter((m) => !this.buffers.has(m));
    if (!need.length) return this;

    let done = 0;
    const total = need.length;
    const report = () => onProgress?.(done, total);

    // 并发 4 个，iPad Safari 上比全并发稳
    const queue = [...need];
    const worker = async () => {
      while (queue.length) {
        const m = queue.shift();
        try {
          const raw = await fetchRaw(m);
          const buf = await this.ctx.decodeAudioData(raw.slice(0));
          this.buffers.set(m, buf);
        } catch (e) {
          // 单个采样失败不影响其它音（回放时退到合成音），但要记下来
          this.failures.push({ midi: m, name: sampleFileName(m), reason: e?.message || String(e) });
        }
        done++;
        report();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return this;
  }

  /** 有对应采样可播吗 */
  canPlay(midi) {
    return this.buffers.has(nearestSampleMidi(midi));
  }

  /**
   * 排一个音。
   * @param midi 音高
   * @param when AudioContext 时间轴上的起播时刻
   * @param duration 音符时值（秒）；到点后做一次短释放，模拟抬手
   * @param velocity 0~1
   */
  play(midi, when, duration, velocity = 0.85) {
    const s = nearestSampleMidi(midi);
    const buf = this.buffers.get(s);
    if (!buf) return null;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 2 ** ((midi - s) / 12);

    const g = this.ctx.createGain();
    const peak = 0.5 * velocity;
    const rel = 0.22; // 抬手释放时长

    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.004); // 4ms 起音，防爆音
    const end = when + Math.max(duration, 0.12);
    g.gain.setValueAtTime(peak, end);
    g.gain.linearRampToValueAtTime(0.0001, end + rel);

    src.connect(g);
    g.connect(this.dest);
    src.start(when);

    // 音符结束 + 释放 + 余韵后停掉
    const stopAt = end + rel + 0.05;
    try {
      src.stop(stopAt);
    } catch {
      /* ignore */
    }
    return { src, gain: g, stopAt };
  }
}
