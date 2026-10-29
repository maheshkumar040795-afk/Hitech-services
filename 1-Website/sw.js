/* Hitech Services service worker — makes the app installable; job data is never cached */
const CACHE = 'hitech-v8'
const SHELL = ['./', './index.html', './offline.html', './config.js', './manifest.json', './manifest-tech.json', './logo.png', './logo-160.png', './tech/']

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

// ── New-job alerts (web push from the "notify-assign" Supabase Edge Function) ──
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: 'HT Jobs', body: e.data && e.data.text() } }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const visible = wins.filter((c) => c.visibilityState === 'visible')
    // App open on screen → it rings and shows its own alert; just tell it to refresh
    if (visible.length) { visible.forEach((c) => c.postMessage({ type: 'NEW_JOBS' })); return }
    await self.registration.showNotification(d.title || 'New job assigned', {
      body: d.body || 'Open HT Jobs to see it',
      icon: d.icon || './icons/tech-192.png',
      badge: './icons/tech-192.png',
      tag: 'ht-new-jobs',          // a newer alert replaces the older one…
      renotify: true,              // …and still rings again
      requireInteraction: true,    // stays until the technician taps it
      vibrate: [700, 400, 700, 400, 700, 400, 700, 400, 700, 400, 700, 400, 700, 400, 700],   // ~10 s on Android
      data: { url: d.url || './tech/' },
    })
  })())
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL(e.notification.data?.url || './tech/', self.registration.scope).href
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const tech = wins.find((c) => c.url.includes('/tech/'))
    if (tech) { await tech.focus(); tech.postMessage({ type: 'NEW_JOBS' }); return }
    await self.clients.openWindow(url)
  })())
})
