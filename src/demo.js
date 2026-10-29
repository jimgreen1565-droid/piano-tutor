// 示范播放：用合成音把曲子弹一遍，同时回调"当前小节"，让谱面跟着走。
// 这不是 MIDI 音频，是现场合成的音色，但足够听清"每个音应该在哪一拍"。

export function playDemo(scoreJson, bpm, { onMeasure, onEnd } = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const spb = 60 / bpm;
  const bevel = 0.02;

  const startAt = ctx.currentTime + 0.25;
  const nodes = [];

  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

  for (const n of scoreJson.notes) {
    const t0 = startAt + n.beat * spb;
    const dur = Math.max(0.12, n.durationBeats * spb * 0.92);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = midiToHz(n.pitchMidi);

    // 简单的钢琴式包络：快起、缓落
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.28, t0 + bevel);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    nodes.push(osc);
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
    nodes.forEach((o) => {
      try {
        o.stop();
      } catch {
        /* ignore */
      }
    });
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