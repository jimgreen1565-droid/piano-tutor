// 示范播放：用加法合成模拟钢琴音色把曲子弹一遍，同时回调"当前小节"。
// 钢琴音色 = 基频 + 一组谐波，每个谐波有独立的起始时间和衰减时间
// （高次谐波衰减更快，这是钢琴"琴槌敲击-弦共鸣"的音色来源）。

// 钢琴谐波模板（谐波序号 1=基频, 比例, 衰减系数）
// 低音区和弦更丰富、衰减慢；高音区反而清亮。
const OVERTONE_PLAN = {
  bass: [
    // 基频强、前几泛音次强，整体衰减长
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

/** 合成一个钢琴音：返回一个可直接连到输出的 gain 节点 */
function pianoNote(ctx, midi, t0, dur) {
  const plan = pickPlan(midi);
  const f0 = midiToHz(midi);
  const out = ctx.createGain(); // 本音的输出节点，外部连 master
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

export function playDemo(scoreJson, bpm, { onMeasure, onEnd } = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const spb = 60 / bpm;

  const startAt = ctx.currentTime + 0.25;
  const nodes = [];

  const master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);

  for (const n of scoreJson.notes) {
    const t0 = startAt + n.beat * spb;
    const dur = Math.max(0.25, n.durationBeats * spb * 1.05);
    try {
      const out = pianoNote(ctx, n.pitchMidi, t0, dur);
      out.connect(master);
      nodes.push(out);
    } catch (e) {
      // 单个音失败不中断
    }
  }

  // 跟谱：用 rAF 把当前小节回调出去
  const beatsPerBar = scoreJson.timeSignature?.beats || 4;
  const totalMeasures = scoreJson.totalMeasures;
  let raf = null;
  let last = -1;

  const loop = () => {
    const elapsed = ctx.currentTime - startAt;
    const beat = elapsed / spb;

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
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    try {
      ctx.close();
    } catch {
      /* ignore */
    }
  }

  raf = requestAnimationFrame(loop);
  onMeasure?.(1);

  return { stop };
}