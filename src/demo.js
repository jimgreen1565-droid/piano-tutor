// 示范播放：优先用真实钢琴采样（Salamander Grand Piano）弹一遍，
// 采样缺失的音用加法合成兜底；同时回调"当前小节"驱动谱面跟随。
//
// 合成部分保留的理由：① 采样是每三个半音一个，极端音区仍可能没覆盖；
// ② 采样网络加载失败时不能让整首示范哑掉。

import { PianoSampler } from './piano-sampler.js';

// 钢琴谐波模板（谐波序号 1=基频, 比例, 衰减系数）——仅作兜底音色
const OVERTONE_PLAN = {
  bass: [
    [1, 1.0, 0.9],
    [2, 0.7, 0.75],
    [3, 0.45, 0.6],
    [4, 0.28, 0.45],
    [5, 0.18, 0.35],
    [6, 0.12, 0.28],
    [8, 0.06, 0.2],
  ],
  mid: [
    [1, 1.0, 0.75],
    [2, 0.5, 0.5],
    [3, 0.3, 0.35],
    [4, 0.2, 0.25],
    [5, 0.12, 0.18],
    [6, 0.08, 0.12],
  ],
  high: [
    [1, 1.0, 0.55],
    [2, 0.4, 0.3],
    [3, 0.22, 0.2],
    [4, 0.12, 0.12],
    [5, 0.07, 0.08],
  ],
};

function pickPlan(midi) {
  if (midi < 48) return OVERTONE_PLAN.bass;
  if (midi < 72) return OVERTONE_PLAN.mid;
  return OVERTONE_PLAN.high;
}

const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

/** 兜底合成音：返回一个可直接连到输出的 gain 节点 */
function pianoNote(ctx, midi, t0, dur) {
  const plan = pickPlan(midi);
  const f0 = midiToHz(midi);
  const out = ctx.createGain();
  out.gain.value = 1;

  const attack = 0.006;
  const level = 0.32;

  for (const [mul, amp, decay] of plan) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f0 * mul;
    const g = ctx.createGain();
    const peak = level * amp;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    const dur1 = Math.min(dur, dur * 0.35 * decay);
    const dur2 = Math.min(dur, dur * 0.75 * decay);
    if (dur1 > attack) g.gain.exponentialRampToValueAtTime(peak * 0.5, t0 + dur1);
    if (dur2 > dur1) g.gain.exponentialRampToValueAtTime(peak * 0.12, t0 + dur2);
    if (dur > dur2) g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  return out;
}

/**
 * 播一遍示范。
 * @param onStatus 加载/就绪状态回调（用于界面提示"正在准备钢琴音色…"）
 * @returns {{stop: Function}} stop 可在加载完成前调用，会取消本次播放
 */
export function playDemo(scoreJson, bpm, { onMeasure, onEnd, onStatus } = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const spb = 60 / bpm;

  let stopped = false;
  let raf = null;
  let startAt = 0;

  const master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);

  const live = []; // 已排的音（采样节点或合成节点）

  const beatsPerBar = scoreJson.timeSignature?.beats || 4;
  const totalMeasures = scoreJson.totalMeasures;
  let last = -1;

  const loop = () => {
    if (stopped) return;
    const beat = (ctx.currentTime - startAt) / spb;

    if (beat >= 0) {
      const m = Math.min(totalMeasures, Math.floor(beat / beatsPerBar) + 1);
      if (m !== last) {
        last = m;
        onMeasure?.(m);
      }
    }
    if (beat >= scoreJson.totalBeats + 0.3) {
      stop();
      onEnd?.();
      return;
    }
    raf = requestAnimationFrame(loop);
  };

  function stop() {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    for (const n of live) {
      try {
        if (n.src) n.src.stop();
      } catch {
        /* ignore */
      }
    }
    live.length = 0;
    try {
      ctx.close();
    } catch {
      /* ignore */
    }
  }

  // 采样就绪后再排音（加载期间界面显示进度，stop 可随时打断）
  (async () => {
    const midis = scoreJson.notes.map((n) => n.pitchMidi);
    const sampler = new PianoSampler(ctx, master);
    const total = PianoSampler.needed(midis).length;

    onStatus?.('正在准备钢琴音色…');
    try {
      await sampler.loadForMidis(midis, {
        onProgress: (d) => onStatus?.(`正在准备钢琴音色… ${d}/${total}`),
      });
    } catch {
      /* 全部失败也继续，走合成兜底 */
    }
    if (stopped) return;

    if (sampler.loadedCount > 0) {
      const bad = sampler.failures.length;
      onStatus?.(
        bad
          ? `钢琴音色就绪（${sampler.loadedCount}/${total} 段真实采样，${bad} 段加载失败已用合成音代替）`
          : `钢琴音色就绪（${sampler.loadedCount}/${total} 段真实采样）`
      );
    } else {
      onStatus?.(
        `采样加载失败（${sampler.failures[0]?.reason || '未知原因'}），改用合成音`
      );
    }

    startAt = ctx.currentTime + 0.35;

    for (const n of scoreJson.notes) {
      const t0 = startAt + n.beat * spb;
      const dur = Math.max(0.2, n.durationBeats * spb * 0.96);

      const node = sampler.play(n.pitchMidi, t0, dur, 0.9);
      if (node) {
        live.push(node);
        continue;
      }
      try {
        const out = pianoNote(ctx, n.pitchMidi, t0, Math.max(0.25, dur * 1.05));
        out.connect(master);
        live.push({ gain: out });
      } catch {
        /* 单个音失败不中断 */
      }
    }

    loop();
    onMeasure?.(1);
  })();

  return { stop };
}
