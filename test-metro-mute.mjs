// 一次性单测：验证 Metronome 的 muteAfterCountIn 逻辑
// mock 掉 AudioContext，检查 _scheduleClick 在预备拍/演奏拍是否创建 oscillator
import { Metronome } from './src/metronome.js';

function makeMockCtx() {
  const created = [];
  const mkOsc = () => {
    const o = {
      type: '',
      frequency: { value: 0 },
      connect: () => {},
      start: () => {},
      stop: () => {},
    };
    created.push(o);
    return o;
  };
  const mkGain = () => ({
    gain: {
      setValueAtTime: () => {},
      linearRampToValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
    },
    connect: () => {},
  });
  return {
    ctx: {
      createOscillator: mkOsc,
      createGain: mkGain,
      destination: {},
      currentTime: 0,
    },
    created,
  };
}

function runCase({ muteAfterCountIn }) {
  const m = new Metronome({ bpm: 60, beatsPerBar: 4, countInBeats: 8, muteAfterCountIn });
  const { ctx, created } = makeMockCtx();
  m.ctx = ctx;
  // 预备拍第 1 拍、最后预备拍、正式第 0 拍、正式第 1 拍
  for (const bi of [0, 7, 8, 9]) m._scheduleClick(1 + bi, bi);
  return created.length;
}

const withMute = runCase({ muteAfterCountIn: true });
const noMute = runCase({ muteAfterCountIn: false });

console.log(`muteAfterCountIn=true  → oscillator created: ${withMute} (期望 2 = 仅预备拍 0,7)`);
console.log(`muteAfterCountIn=false → oscillator created: ${noMute} (期望 4 = 全部)`);
const ok = withMute === 2 && noMute === 4;
console.log(ok ? 'PASS ✅' : 'FAIL ❌');
process.exit(ok ? 0 : 1);
