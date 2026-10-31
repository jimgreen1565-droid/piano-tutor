import './style.css';
import { mountPractice } from './practice.js';
import { mountEngineTest } from './enginetest.js';
import { icons } from './icons.js';
import { loadTheme, applyTheme, mountThemePicker } from './theme.js';

const app = document.getElementById('app');

// 版本号：用来确认 iPad 上跑的确实是新版（缓存排查）
const VERSION = 'v3.6';

app.innerHTML = `
  <div class="bg-layer"></div>
  <header class="app-head">
    <div class="titlebar">
      <h1><span class="logo">${icons.piano()}</span>钢琴陪练 <span class="ver">${VERSION}</span></h1>
      <div id="themePicker"></div>
    </div>
    <div class="tabs">
      <button class="tab active" data-tab="practice">练习</button>
      <button class="tab" data-tab="engine">引擎自检</button>
    </div>
  </header>
  <main id="view"></main>
`;

// 应用保存的主题
applyTheme(loadTheme());
mountThemePicker(document.getElementById('themePicker'));

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
