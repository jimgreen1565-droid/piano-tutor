// 主题偏好：存本地，简单持久化
const KEY = 'piano-tutor-theme';

export const THEMES = [
  { id: 'default', name: '暖白', swatch: '#f6f4f0', ring: '#2563eb' },
  { id: 'warm', name: '暖棕', swatch: '#c2571d', ring: '#c2571d' },
  { id: 'dark', name: '深蓝', swatch: '#1a1d24', ring: '#5b8def' },
  { id: 'sky', name: '天蓝', swatch: '#1e88c8', ring: '#1e88c8' },
  { id: 'rose', name: '樱花', swatch: '#c2456a', ring: '#c2456a' },
];

export function loadTheme() {
  try {
    return localStorage.getItem(KEY) || 'default';
  } catch {
    return 'default';
  }
}

export function saveTheme(id) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

export function applyTheme(id) {
  document.body.dataset.theme = id;
}

/** 渲染主题切换色块到指定容器 */
export function mountThemePicker(container) {
  container.innerHTML = `
    <div class="theme-picker" role="radiogroup" aria-label="选择主题">
      ${THEMES.map((t) => {
        const active = (loadTheme() === t.id ? ' active' : '');
        return `<button class="theme-swatch${active}" data-theme="${t.id}" style="--sw:${t.swatch}" title="${t.name}" aria-label="${t.name}" role="radio" aria-checked="${!!active}"></button>`;
      }).join('')}
    </div>
  `;
  container.querySelectorAll('.theme-swatch').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.theme;
      saveTheme(id);
      applyTheme(id);
      container
        .querySelectorAll('.theme-swatch')
        .forEach((s) => s.classList.toggle('active', s === b));
    }),
  );
}