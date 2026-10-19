// Uygulama kabuğunu önbellekte tutar: internet yokken de açılır.
// Supabase ve diğer adreslere giden istekler önbelleğe alınmaz.
const CACHE = 'hk-kabuk-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  // Sayfa: önce ağ, yoksa önbellekteki kabuk
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  // Derlenmiş dosyalar adlarında içerik özeti taşır: önbellekte varsa oradan
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
            return res
          }),
      ),
    )
  }
})

// Telefon bildirimi (Web Push): başlık + metin; dokununca uygulama ilgili sayfada açılır
self.addEventListener('push', (e) => {
  let d = { title: 'HK Kontrol', body: '', link: '#/' }
  try {
    d = { ...d, ...e.data.json() }
  } catch {
    /* boş bildirim */
  }
  e.waitUntil(
    self.registration.showNotification(d.title, { body: d.body, icon: '/icon-192.png', badge: '/icon-192.png', data: { link: d.link } }),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const target = '/' + (e.notification.data?.link || '#/')
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(target)
          return c.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
