// 引擎自检页（原 V0 冒烟测试）：验证「听音」链路是否正常
import { ensureModel, startCapture, transcribeBlob, getBackend } from './transcribe.js';
import { midiToName } from './score.js';
import { icons } from './icons.js';

export function mountEngineTest(root) {
  root.innerHTML = `
    <div class="pcard">
      <div class="plabel">引擎状态</div>
      <div class="status" id="eStatus">正在初始化…</div>
      <div class="log" id="eLog"></div>
    </div>

    <div class="pcard">
      <div class="plabel">录制与识别</div>
      <button class="btn btn-primary" id="eBtn" disabled><span class="ic">${icons.mic()}</span>开始录音</button>
      <div class="meter" id="eMeter"><div class="meter-bar" id="eMeterBar"></div></div>
      <div class="notes" id="eNotes"></div>
      <div class="hint">弹几个音，看看能不能被正确识别。这里不做评分，只验证耳朵是否灵。</div>
    </div>
  `;

  const el = {
    status: root.querySelector('#eStatus'),
    log: root.querySelector('#eLog'),
    btn: root.querySelector('#eBtn'),
    meter: root.querySelector('#eMeter'),
    meterBar: root.querySelector('#eMeterBar'),
    notes: root.querySelector('#eNotes'),
  };

  let running = false;
  let capture = null;

  const log = (msg) => {
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    el.log.textContent += `[${t}] ${msg}\n`;
    el.log.scrollTop = el.log.scrollHeight;
  };
  const say = (html) => {
    el.status.innerHTML = html;
  };

  (async () => {
    try {
      await ensureModel(log);
      say(
        `<span class="ok">就绪。</span> 后端 ${getBackend()}，模型已加载。`,
      );
      el.btn.disabled = false;
    } catch (e) {
      say(`<span class="err">初始化失败：${e.message}</span>`);
      log(e.stack || e.message);
    }
  })();

  el.btn.addEventListener('click', async () => {
    if (running) {
      running = false;
      el.btn.disabled = true;
      try {
        const blob = await capture.stop();
        say('正在识别…');
        el.meter.classList.add('active');
        const notes = await transcribeBlob(blob, {
          onProgress: (p) => (el.meterBar.style.width = `${Math.round(p * 100)}%`),
          onLog: log,
        });
        el.meter.classList.remove('active');

        el.notes.innerHTML = notes.length
          ? [...notes]
              .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
              .map(
                (n) =>
                  `<span class="chip"><b>${midiToName(n.pitchMidi)}</b> ` +
                  `<span class="chip-sub">t=${n.startTimeSeconds.toFixed(2)}s</span></span>`,
              )
              .join('')
          : '<div class="hint">没有识别到音符，靠近一点再试。</div>';

        say(`<span class="ok">识别到 ${notes.length} 个音符。</span>`);
      } catch (e) {
        el.meter.classList.remove('active');
        say(`<span class="err">失败：${e.message}</span>`);
        log(e.stack || e.message);
      } finally {
        el.btn.innerHTML = `<span class="ic">${icons.mic()}</span>开始录音`;
        el.btn.classList.remove('btn-stop');
        el.btn.classList.add('btn-primary');
        el.btn.disabled = false;
      }
      return;
    }

    try {
      capture = await startCapture();
      running = true;
      el.btn.innerHTML = `<span class="ic">${icons.stop()}</span>停止并识别`;
      el.btn.classList.remove('btn-primary');
      el.btn.classList.add('btn-stop');
      say('<span class="ok">录音中…</span>');
      log('开始录音');
    } catch (e) {
      say(`<span class="err">麦克风失败：${e.message}</span>`);
    }
  });
}