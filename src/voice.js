// 语音播报：用 iPad / 浏览器自带的语音合成（Web Speech API）念点评
//
// 为什么不用云端 TTS：页面是公开静态站，任何 API Key 都会暴露；
// 而且用户的要求是"只带平板去练琴"，不能依赖家里的电脑。
// 系统自带中文语音（iOS 上是婷婷/美佳这类）免费、离线、无需密钥，
// 首次发声需要用户手势触发（点了按钮就是手势）。

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

export function ttsSupported() {
  return !!synth && typeof window.SpeechSynthesisUtterance === 'function';
}

let cachedVoice = null;
let voicesReady = false;

/** 挑一个中文语音：优先 zh-CN，其次任何 zh */
export function pickZhVoice() {
  if (!ttsSupported()) return null;
  if (cachedVoice) return cachedVoice;

  const voices = synth.getVoices() || [];
  if (voices.length) voicesReady = true;

  const zh = voices.filter((v) => /^zh/i.test(v.lang || ''));
  if (!zh.length) return null;

  const prefer = [
    /zh[-_]CN/i,
    /Ting[-_]?Ting/i,
    /Mei[-_]?Jia/i,
    /Sin[-_]?ji/i,
    /Xiaoxiao/i,
    /Google 普通话/i,
  ];
  let picked = null;
  for (const p of prefer) {
    picked = zh.find((v) => p.test(v.name || '') || p.test(v.lang || ''));
    if (picked) break;
  }
  cachedVoice = picked || zh[0];
  return cachedVoice;
}

/** iOS 的语音列表是异步填的，第一次可能为空 */
export function onVoicesReady(cb) {
  if (!ttsSupported()) return;
  if ((synth.getVoices() || []).length) {
    voicesReady = true;
    cb();
    return;
  }
  const handler = () => {
    voicesReady = true;
    cachedVoice = null;
    cb();
    synth.removeEventListener?.('voiceschanged', handler);
  };
  synth.addEventListener?.('voiceschanged', handler);
}

export function voiceName() {
  const v = pickZhVoice();
  if (!v) return '系统默认语音';
  return `${v.name}（${v.lang}）`;
}

/**
 * iOS 解锁：必须在用户手势里调一次，之后才允许自动播报。
 * 用几乎无声的极短文本，避免用户听到多余声音。
 */
let unlocked = false;
export function unlock() {
  if (!ttsSupported() || unlocked) return;
  try {
    const u = new SpeechSynthesisUtterance('　');
    u.volume = 0;
    u.rate = 2;
    synth.speak(u);
    unlocked = true;
  } catch {
    /* ignore */
  }
}

export function stopSpeaking() {
  if (!ttsSupported()) return;
  try {
    synth.cancel();
  } catch {
    /* ignore */
  }
}

export function isSpeaking() {
  return ttsSupported() && synth.speaking;
}

/**
 * 逐句念。
 * @param lines [{text, kind}]
 * @param opts { rate, pitch, onLine(index), onEnd(), onError(msg) }
 * @returns {stop()}
 */
export function speakLines(lines, opts = {}) {
  if (!ttsSupported()) {
    opts.onError?.('这台设备/浏览器不支持语音合成');
    opts.onEnd?.();
    return { stop() {} };
  }
  const items = (lines || []).filter((l) => l && l.text);
  if (!items.length) {
    opts.onEnd?.();
    return { stop() {} };
  }

  stopSpeaking();
  const voice = pickZhVoice();
  const rate = opts.rate ?? 1.02;
  const pitch = opts.pitch ?? 1;
  let cancelled = false;
  let started = 0;
  let warned = false;
  let watchdog = null;

  const clearWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
  };

  // 只报一次：一句话失败会连续触发多条 error，全弹到界面上就成了刷屏
  const warn = (msg) => {
    if (warned) return;
    warned = true;
    opts.onError?.(msg);
  };

  // iOS 上如果发声被静音开关/策略拦住，speak 会静默失败：
  // 起播 1.2 秒还没进入第一条就报错，让界面给出可操作提示，而不是假装在读。
  watchdog = setTimeout(() => {
    if (!cancelled && started === 0) {
      warn('语音没能发出声（iOS 需要先点一次屏幕，或检查侧边静音开关）');
    }
  }, 1200);

  items.forEach((line, i) => {
    const u = new SpeechSynthesisUtterance(line.text);
    if (voice) u.voice = voice;
    u.lang = (voice && voice.lang) || 'zh-CN';
    u.rate = rate;
    u.pitch = pitch;
    u.volume = 1;
    u.onstart = () => {
      started++;
      clearWatchdog();
      opts.onLine?.(i);
    };
    u.onend = () => {
      if (cancelled) return;
      if (i === items.length - 1) {
        opts.onEnd?.();
      }
    };
    u.onerror = (ev) => {
      // 用户主动打断不算错误
      if (cancelled) return;
      // 真出错时要说出来：以前这里只调 onEnd，用户会以为"念完了"，
      // 实际一句都没出声 —— 静默失败比报错更难查。
      if (started === 0) {
        const reason = ev && ev.error ? ev.error : 'unknown';
        warn(`系统朗读失败（${reason}），下面文字同样可以看`);
      }
      if (i === items.length - 1) opts.onEnd?.();
    };
    try {
      synth.speak(u);
    } catch (e) {
      opts.onError?.(String(e && e.message ? e.message : e));
    }
  });

  return {
    stop() {
      cancelled = true;
      clearWatchdog();
      stopSpeaking();
    },
  };
}
