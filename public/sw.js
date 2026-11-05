// 离线缓存：让第二次打开几乎瞬时（模型、谱面、脚本都本地化）
// 策略：
//   - 导航请求（HTML）：网络优先，避免卡在旧版本
//   - 静态资源（/assets、/model、/scores）：缓存优先，后台静默更新

// 缓存名要随版本改：activate 只删「名字不等于 CACHE」的缓存，
// 名字不变的话老访客会永远吃旧缓存（v3.10 前踩过：旧 voice/manifest.json 一直生效，
// 新的数字片段 key 全部缺失 → 语音整体退回系统朗读）。
const CACHE = 'piano-tutor-v3.10';
const PRECACHE = ['./', './manifest.json', './icon.svg'];

// 清单类文件不走缓存：必须每次取网络上的最新版本
const isManifest = (pathname) => pathname.endsWith('/voice/manifest.json');

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

  // 片段清单永远走网络（不进缓存、不读缓存）
  if (isManifest(url.pathname)) {
    event.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }

  const isStatic =
    url.pathname.includes('/assets/') ||
    url.pathname.includes('/model/') ||
    url.pathname.includes('/scores/') ||
    url.pathname.includes('/samples/') ||
    url.pathname.includes('/voice/') ||
    url.pathname.includes('/img/');

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
