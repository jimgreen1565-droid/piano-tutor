// 教练语音的播放层：用 gen-voice-clips.mjs 预渲染的真人音色片段拼出整句话。
//
// 为什么不用 speechSynthesis：那是"语音助手腔"，用户明确说"别那么机器人感"。
// 片段库是本机 Breeze-TTS 用真人音色克隆合成的，等于把配音演员录好的句子存下来，
// 运行时按句拼装 —— 离线、无 Key、无后端，音质和音色都稳定。
//
// 拼装单位是"片段"，不是"字"：一条话术 = 若干固定片段 + 数字片段 + 音名片段。
// coach.js 已经把每条话术算成 say: ['f:xxx','n:六十','n:九','u:measure',...]，
// 这里只负责按顺序把音频接起来播。
//
// 兜底：任何片段缺失（清单没拉到 / 文件 404 / 解码失败）→ 调用方退回 speechSynthesis，
// 不能出现"点了没声也没提示"。

const BASE = 'voice/';
const CONCURRENCY = 4;
const GAP_IN_LINE = 0.045; // 片段之间：留一点点气口，数字和量词才不粘连
const GAP_BETWEEN = 0.24; // 两句之间：像人说话换气

export class ClipVoice {
  constructor(ctx) {
    this.ctx = ctx || null;
    this.manifest = null;
    this.buffers = new Map();
    this.failures = [];
    this.srcs = [];
    this.playing = false;
    this._timer = null;
  }

  get ctxRef() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = AC ? new AC() : null;
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /**
   * iOS 规定 AudioContext 必须在用户手势的同步调用栈里创建/恢复，
   * 否则后面在 await 之后播放是没声音的（而且不报错，最难查）。
   * 所以在点击处理函数的第一行就同步调它。
   */
  prime() {
    return this.ctxRef;
  }

  /** 拉清单（失败返回 null，调用方据此退回系统语音） */
  async load() {
    if (this.manifest) return this.manifest;
    try {
      const r = await fetch(BASE + 'manifest.json', { cache: 'force-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const m = await r.json();
      if (!m || !m.clips) throw new Error('清单格式不对');
      this.manifest = m;
      return m;
    } catch (e) {
      this.failures.push('manifest: ' + e.message);
      return null;
    }
  }

  /** 每句需要的片段（去重） */
  keysFor(lines) {
    const out = [];
    for (const l of lines) for (const k of l.say || []) if (!out.includes(k)) out.push(k);
    return out;
  }

  /** 清单里有没有这些片段（少一个就整体退回系统语音，避免半句真人半句机器） */
  missing(keys) {
    if (!this.manifest) return keys;
    return keys.filter((k) => !this.manifest.clips[k]);
  }

  async fetchClip(key) {
    const info = this.manifest.clips[key];
    if (!info) throw new Error('no clip ' + key);
    if (this.buffers.has(key)) return this.buffers.get(key);
    const r = await fetch(BASE + info.file, { cache: 'force-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + info.file);
    const bytes = await r.arrayBuffer();
    const buf = await this.ctxRef.decodeAudioData(bytes);
    this.buffers.set(key, buf);
    return buf;
  }

  /** 预取（并发 N，进度回调给界面显示"N/M"） */
  async prepare(keys, onProgress) {
    const todo = keys.filter((k) => !this.buffers.has(k));
    let done = 0;
    const total = todo.length;
    if (onProgress) onProgress(0, total);
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const k = todo[i++];
        try {
          await this.fetchClip(k);
        } catch (e) {
          this.failures.push(k + ': ' + e.message);
        }
        done++;
        if (onProgress) onProgress(done, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length || 1) }, worker));
    return total - this.failures.length;
  }

  stop() {
    this.playing = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    for (const s of this.srcs) {
      try {
        s.stop();
      } catch (_) {}
    }
    this.srcs = [];
  }

  get isSpeaking() {
    return this.playing;
  }

  /**
   * 按句播放。
   * lines: [{ say: [clipKey...] }]
   * onLine(index) 在每句开始时回调（界面高亮用它）
   */
  speakLines(lines, { onLine, onEnd, onError, gain = 1.15 } = {}) {
    const ctx = this.ctxRef;
    if (!ctx) {
      onError && onError('浏览器不支持音频播放');
      return;
    }
    this.stop();
    this.playing = true;

    const master = ctx.createGain();
    master.gain.value = gain; // 片段是 -20dB 上下，抬一点更像"在耳边说"
    master.connect(ctx.destination);

    let li = 0;
    const playLine = () => {
      if (!this.playing) return;
      if (li >= lines.length) {
        this.playing = false;
        onEnd && onEnd();
        return;
      }
      const idx = li++;
      const keys = (lines[idx].say || []).filter((k) => this.buffers.has(k));
      onLine && onLine(idx);
      if (!keys.length) {
        this._timer = setTimeout(playLine, 120);
        return;
      }
      let when = ctx.currentTime + 0.04;
      let last = when;
      for (const k of keys) {
        const buf = this.buffers.get(k);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(master);
        src.start(when);
        this.srcs.push(src);
        last = when + buf.duration;
        when = last + GAP_IN_LINE;
      }
      // 这一句播完 → 下一句
      const waitMs = Math.max(60, (last - ctx.currentTime) * 1000 + GAP_BETWEEN * 1000);
      this._timer = setTimeout(playLine, waitMs);
    };

    playLine();
  }
}

/** 播放前的完整准备：拉清单 → 查缺失 → 预取。返回 true 表示可以真播 */
export async function prepareClips(clipVoice, lines, onStatus) {
  const m = await clipVoice.load();
  if (!m) return false;
  const keys = clipVoice.keysFor(lines);
  const miss = clipVoice.missing(keys);
  if (miss.length) {
    clipVoice.failures.push('缺少片段 ' + miss.length + ' 个: ' + miss.slice(0, 3).join(','));
    return false;
  }
  await clipVoice.prepare(keys, (done, total) => {
    if (onStatus && total) onStatus(`正在准备真人语音… ${done}/${total}`);
  });
  // 有片段解码失败也退回系统语音（宁可是机器腔，也不能半句没声）
  const bad = keys.filter((k) => !clipVoice.buffers.has(k));
  return bad.length === 0;
}
