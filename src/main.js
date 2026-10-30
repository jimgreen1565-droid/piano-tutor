import './style.css';
import { mountPractice } from './practice.js';
import { mountEngineTest } from './enginetest.js';

const app = document.getElementById('app');

// 版本号：用来确认 iPad 上跑的确实是新版（缓存排查）
const VERSION = 'v1.9';

app.innerHTML = `
  <header class="app-head">
    <h1>🎹 钢琴陪练 <span class="ver">${VERSION}</span></h1>
    <div class="tabs">
      <button class="tab active" data-tab="practice">练习</button>
      <button class="tab" data-tab="engine">引擎自检</button>
    </div>
  </header>
  <main id="view"></main>
`;

const view = document.getElementById('view');
const tabs = [...app.querySelectorAll('.tab')];

let practiceApi = null;

function render(tab) {
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  view.innerHTML = '';

  if (tab === 'practice') {
    practiceApi = mountPractice(view);
    practiceApi.load().then(() => {
      const want = new URLSearchParams(location.search).get('piece');
      if (want) practiceApi.openPiece(want);
      else practiceApi.showPicker();
    });
  } else {
    practiceApi = null;
    mountEngineTest(view);
  }
}

tabs.forEach((t) => {
  t.addEventListener('click', () => {
    if (t.dataset.tab === 'practice' && practiceApi) return;
    render(t.dataset.tab);
  });
});

render('practice');

// 注册离线缓存：第二次打开几乎瞬时（脚本/模型/谱面都本地化）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      })
      .catch(() => {});
  });
}
