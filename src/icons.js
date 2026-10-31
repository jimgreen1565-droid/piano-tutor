// 统一图标：单色线框 SVG（lucide 风格），currentColor 继承文字色
// 规范：同套风格、描边 2px、尺寸 16/20/24

const S = (body, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  // 钢琴（品牌图标，标题用）
  piano: (size = 22) =>
    S(
      '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 6v7M10 6v7M14 6v7M18 6v7"/>',
      size,
    ),
  play: () => S('<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/>'),
  stop: () => S('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>'),
  headphones: () =>
    S('<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="3" y="14" width="4" height="6" rx="2"/><rect x="17" y="14" width="4" height="6" rx="2"/>'),
  mic: () =>
    S('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="17" x2="12" y2="22"/>'),
  refresh: () =>
    S('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>'),
  loop: () =>
    S('<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
  alert: () =>
    S('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  chevronDown: (size = 16) => S('<polyline points="6 9 12 15 18 9"/>', size),
  search: () => S('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  note: (size = 16) =>
    S('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>', size),
};
