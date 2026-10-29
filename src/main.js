import './style.css';
import { mountPractice } from './practice.js';
import { mountEngineTest } from './enginetest.js';

const app = document.getElementById('app');

app.innerHTML = `
  <header class="app-head">
    <h1>🎹 钢琴陪练</h1>
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
