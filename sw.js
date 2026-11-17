// sw.js — Service Worker von fableOS: macht die Seite offline nutzbar und hält sie aktuell.
//
// · Beim Installieren folgt er von den Einstiegsseiten aus allen <script>/<link>-Verweisen und
//   import-Anweisungen und legt alles in den Cache – ohne Dateiliste, die jemand pflegen müsste.
// · Danach antwortet er aus dem Cache und prüft im Hintergrund, ob sich etwas geändert hat. Wenn ja,
//   lädt er alles neu und meldet der Seite „Update bereit“ (Systemeinstellungen → Softwareupdate).
// · Store-Apps liegen in einem eigenen Cache, den die Seite beim Installieren einer App füllt.

const CORE = 'fableos-core-v1';
const APPS = 'fableos-apps';
const SCOPE = self.registration.scope;
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);
const ENTRIES = ['./', 'index.html', 'os.html', '404.html', 'manifest.webmanifest',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/maskable-512.png', 'assets/icons/apple-touch-icon.png'];
const isApp = (url) => url.includes('/store/apps/');

/** Verweise auf weitere eigene Dateien in HTML bzw. JavaScript finden. */
function links(text, base, type) {
  const out = [];
  const add = (ref) => {
    try {
      const url = new URL(ref, base);
      url.hash = '';
      url.search = '';
      if (url.href.startsWith(SCOPE) && !isApp(url.href)) out.push(url.href);
    } catch { /* keine Adresse */ }
  };
  if (type.includes('html')) for (const m of text.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"#?]+)"/g)) add(m[1]);
  else if (type.includes('javascript')) for (const m of text.matchAll(/(?:^|[\s;])(?:import|export)\b[^'"`;]*?['"](\.{1,2}\/[^'"]+)['"]/g)) add(m[1]);
  return out;
}

/** Lädt alles, was von den Einstiegsseiten aus erreichbar ist, frisch in einen Cache. */
async function crawl(cache) {
  const seen = new Set();
  let queue = ENTRIES.map((u) => new URL(u, SCOPE).href);
  while (queue.length) {
    const batch = queue.filter((u) => !seen.has(u)).slice(0, 8);
    queue = queue.filter((u) => !batch.includes(u) && !seen.has(u));
    await Promise.all(batch.map(async (url) => {
      seen.add(url);
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok || res.redirected && !res.url.startsWith(SCOPE)) return;
        await cache.put(url, res.clone());
        const type = res.headers.get('content-type') || '';
        if (/html|javascript/.test(type)) queue.push(...links(await res.text(), url, type));
      } catch { /* einzelne Datei nicht erreichbar – der Rest zählt trotzdem */ }
    }));
  }
  return seen.size;
}

const tell = async (msg) => { for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage(msg); };
const keyOf = (url) => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; };
const body = async (res) => new Uint8Array(await res.clone().arrayBuffer());
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CORE).then(crawl).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== CORE && name !== APPS) await caches.delete(name);
    await self.clients.claim();
    await tell({ type: 'offline-ready' });
  })());
});

// ---------- Aktualität ----------
let checking = null;
const checked = new Map();     // Adresse → Zeitpunkt der letzten Prüfung

/** Vergleicht den ganzen Bestand mit dem Server. Bei Unterschieden: alles ersetzen und der Seite Bescheid geben. */
function checkAll() {
  if (!checking) {
    checking = (async () => {
      const fresh = await caches.open('fableos-next');
      await crawl(fresh);
      const core = await caches.open(CORE);
      let changed = false;
      const reqs = await fresh.keys();
      if (reqs.length < 5) return false;                    // Netz weg oder Server gestört: Bestand behalten
      for (const req of reqs) {
        const [neu, alt] = await Promise.all([fresh.match(req), core.match(req)]);
        if (!alt || !same(await body(neu), await body(alt))) changed = true;
      }
      const apps = await caches.open(APPS);
      for (const req of await apps.keys()) {
        try {
          const res = await fetch(req.url, { cache: 'no-cache' });
          if (!res.ok) continue;
          if (!same(await body(res), await body(await apps.match(req)))) { changed = true; await apps.put(req, res); }
        } catch { /* offline */ }
      }
      if (changed) for (const req of reqs) await core.put(req, await fresh.match(req));
      return changed;
    })().catch(() => false).finally(async () => { await caches.delete('fableos-next'); checking = null; });
  }
  return checking;
}

/** Prüft eine einzelne Datei im Hintergrund (höchstens einmal pro Minute). */
async function revalidate(key) {
  if (checking || Date.now() - (checked.get(key) || 0) < 60000) return;
  checked.set(key, Date.now());
  try {
    const cached = await caches.match(key);
    const res = await fetch(key, { cache: 'no-cache' });
    if (!cached || !res.ok || same(await body(res), await body(cached))) return;
    if (await checkAll()) await tell({ type: 'update-ready' });
  } catch {
    checked.delete(key);        // offline – beim nächsten Abruf wieder versuchen
  }
}

async function respond(e) {
  const key = keyOf(e.request.url);
  if (LOCAL) {
    // Entwicklung: immer frisch vom Server, der Cache springt nur ohne Server ein
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(isApp(key) ? APPS : CORE)).put(key, res.clone());
      return res;
    } catch {
      return (await caches.match(key)) || Response.error();
    }
  }
  const hit = await caches.match(key);
  if (hit) {
    e.waitUntil(revalidate(key));
    return hit;
  }
  try {
    const res = await fetch(e.request);
    if (res.ok && res.type === 'basic') (await caches.open(isApp(key) ? APPS : CORE)).put(key, res.clone());
    return res;
  } catch {
    if (e.request.mode === 'navigate') return (await caches.match(new URL('os.html', SCOPE).href)) || Response.error();
    return Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  if (e.request.method !== 'GET' || !url.startsWith(SCOPE) || e.request.headers.has('range')) return;
  e.respondWith(respond(e));
});

self.addEventListener('message', (e) => {
  if (e.data?.type !== 'check') return;
  e.waitUntil(checkAll().then((changed) => tell({ type: changed ? 'update-ready' : 'up-to-date' })));
});

// Klick auf eine System-Mitteilung holt fableOS nach vorn
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (list.length) return list[0].focus();
    return self.clients.openWindow(new URL('os.html', SCOPE).href);
  })());
});
