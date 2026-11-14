// Offline support: precache the app shell, then stale-while-revalidate every GET
// (incl. Tailwind/FontAwesome CDN). Bump CACHE to force-drop old caches.
const CACHE = 'pillpal-v26.0';
const SHELL = [
    './', 'index.html', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png',
    'js_modules/app.js', 'js_modules/state.js', 'js_modules/ui.js', 'js_modules/actions.js',
    'js_modules/scheduler.js', 'js_modules/audio.js', 'js_modules/watchdog.js', 'js_modules/settings.js',
];
const CDN = [
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6/css/all.min.css',
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(async c => {
        await c.addAll(SHELL);
        // CDN responses are opaque (no-cors), so addAll would reject; put them one by one
        await Promise.all(CDN.map(u => fetch(u, { mode: 'no-cors' }).then(r => c.put(u, r)).catch(() => {})));
    }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    e.respondWith(caches.open(CACHE).then(async c => {
        const cached = await c.match(e.request, { ignoreSearch: true });
        const fresh = fetch(e.request)
            .then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; })
            .catch(() => cached);
        return cached || fresh;
    }));
});
