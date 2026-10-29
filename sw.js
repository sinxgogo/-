const CACHE_NAME = 'hkd-cny-shell-v1';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg'];
const DB_NAME = 'hkd-cny-alerts';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    return response;
  }).catch(async () => (await caches.match(event.request)) || Response.error()));
});

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveSettings(settings) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('state', 'readwrite');
    transaction.objectStore('state').put(settings, 'settings');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function loadSettings() {
  const db = await openDb();
  const value = await new Promise((resolve, reject) => {
    const request = db.transaction('state').objectStore('state').get('settings');
    request.onsuccess = () => resolve(request.result || {});
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SAVE_SETTINGS') event.waitUntil(saveSettings(event.data.settings));
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'daily-rate-check') event.waitUntil(checkRate());
});

async function checkRate() {
  const settings = await loadSettings();
  if (settings.enabled === false || !Number.isFinite(Number(settings.target))) return;
  const response = await fetch('https://api.frankfurter.app/latest?from=HKD&to=CNY', { cache: 'no-store' });
  if (!response.ok) throw new Error('Rate service unavailable');
  const data = await response.json();
  const rate = data.rates?.CNY;
  if (!Number.isFinite(rate) || rate < Number(settings.target)) return;
  const today = new Date().toLocaleDateString('en-CA');
  if (settings.lastNotifiedDay === today) return;
  settings.lastNotifiedDay = today;
  await saveSettings(settings);
  await self.registration.showNotification('港币汇率达到目标', {
    body: `当前参考价 1 HKD = ${rate.toFixed(4)} CNY，已达到你的目标 ${Number(settings.target).toFixed(4)}。`,
    icon: './icon.svg',
    badge: './icon.svg',
    tag: 'hkd-cny-target',
    renotify: true,
    data: { url: './' },
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) if ('focus' in client) return client.focus();
    if (self.clients.openWindow) return self.clients.openWindow(event.notification.data?.url || './');
  }));
});
