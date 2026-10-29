// 离线缓存：让第二次打开几乎瞬时（模型、谱面、脚本都本地化）
// 策略：
//   - 导航请求（HTML）：网络优先，避免卡在旧版本
//   - 静态资源（/assets、/model、/scores）：缓存优先，后台静默更新

const CACHE = 'piano-tutor-v1';
const PRECACHE = ['./', './manifest.json', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation =
    req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./'))),
    );
    return;
  }

  const isStatic =
    url.pathname.includes('/assets/') ||
    url.pathname.includes('/model/') ||
    url.pathname.includes('/scores/');

  if (isStatic) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) {
          // 后台更新，不阻塞
          fetch(req)
            .then((res) => {
              if (res && res.status === 200) {
                caches.open(CACHE).then((c) => c.put(req, res)).catch(() => {});
              }
            })
            .catch(() => {});
          return hit;
        }
        return fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        });
      }),
    );
  }
});
