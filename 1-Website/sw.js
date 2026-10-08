/* Hitech Services service worker — makes the app installable; job data is never cached */
const CACHE = 'hitech-v3'
const SHELL = ['./', './index.html', './offline.html', './config.js', './manifest.json', './manifest-tech.json']

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))) })
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()))
})
self.addEventListener('message', (e) => { if (e.data?.type === 'SKIP_WAITING') self.skipWaiting() })

// Network first for everything on this site (always the latest version), cache only as offline fallback.
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return // Supabase: always live
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
        return res
      })
      .catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? (await caches.match('./index.html')) || caches.match('./offline.html') : Response.error()))
  )
})
