/* DCR Employee Portal 2 service worker (BLUEPRINT 2.2.6).

   - Cache "dcr-portal2-v1". On activate it deletes only OTHER "dcr-portal2-*" caches: never the old
     portal's "dcr-portal-*" nor anything else on the device.
   - Network FIRST for the site's own pages and files (always up to date online; the last copy
     offline). A copy is kept under its path only, never with a query string: an address such as
     "index.html?email=…&password=…" (a sign-in form sent by the browser itself) is never stored,
     and a page with ?id= falls back to its one kept copy. The pinned CDN libraries (exact versions,
     scoped packages included: @supabase/supabase-js@2.117.2) are kept and used first.
   - Never touches *.supabase.co (data, sign-in, Storage, Realtime) and never a non-GET request.
   - Phone reminders: the push and notificationclick handlers of the old sw.js (P3 turns them on). */
const CACHE = "dcr-portal2-v1";
const PREFIX = "dcr-portal2-";
const SHELL = [
  "./", "index.html", "dashboard.html", "change-password.html", "settings.html",
  "board.html", "project.html", "search.html", "logs.html", "capture.html", "report-journal.html",
  "timesheet.html", "timesheet-mobile.html", "timesheet-manager.html", "timesheet-batch.html", "report-timecard.html", "admin.html",
  "css/styles.css", "manifest.json",
  "js/config.js", "js/sb.js", "js/common2.js", "js/live.js", "js/money-mask.js", "js/upload-queue2.js",
  "js/install.js", "js/push2.js",
  "js/shell/index.js", "js/shell/dashboard.js", "js/shell/settings.js", "js/shell/change-password.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/logo.png", "icons/logo.jpg",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const scope = self.registration.scope;
    // one by one: a page that is not there yet must not stop the others from being kept
    await Promise.all(SHELL.map(async (path) => {
      try {
        const url = new URL(path, scope).href;
        const res = await fetch(url, { cache: "no-cache" });
        if (res && res.ok && res.type === "basic") await cache.put(url, res);
      } catch (e) { /* offline or missing: kept when first visited */ }
    }));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.indexOf(PREFIX) === 0 && k !== CACHE).map((k) => caches.delete(k)));
    // a copy kept with a query string by an earlier worker is dropped (it could hold a typed sign-in)
    try {
      const cache = await caches.open(CACHE);
      const kept = await cache.keys();
      await Promise.all(kept.filter((r) => sameOriginWithQuery(r.url)).map((r) => cache.delete(r)));
    } catch (e) { /* nothing kept yet */ }
    await self.clients.claim();
  })());
});

/* jsDelivr at an exact version: "leaflet@1.9.4/…" and scoped packages "@supabase/supabase-js@2.117.2/…". */
const PINNED_CDN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(?:@[^/@]+\/)?[^/@]+@\d+\.\d+\.\d+\//;

function sameOriginWithQuery(href) {
  try { const u = new URL(href); return u.origin === self.location.origin && u.search !== ""; } catch (e) { return false; }
}
/** The cache key of one of the site's own files: its path, never its query string. */
function keyOf(url) { return url.origin + url.pathname; }

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (/\.supabase\.(co|in|net)$/i.test(url.hostname)) return;          // the database: never cached

  if (url.origin !== self.location.origin) {
    if (!PINNED_CDN.test(req.url)) return;
    // an exact version never changes: the kept copy first, the network once
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const kept = await cache.match(req);
      if (kept) return kept;
      const res = await fetch(req);
      if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      // "no-cache" revalidates with the server, so a shipped fix never looks unshipped
      const fresh = await fetch(req, { cache: "no-cache" });
      if (fresh && fresh.ok && fresh.type === "basic") {
        const copy = fresh.clone();
        caches.open(CACHE).then((c) => c.put(keyOf(url), copy)).catch(() => {});
      }
      return fresh;
    } catch (err) {
      const kept = await caches.match(keyOf(url), { ignoreSearch: true });
      if (kept) return kept;
      throw err;
    }
  })());
});

/* ── phone reminders (P3) ─────────────────────────────────────────────────
   {title, body, url, tag}: the tag makes a second reminder for the same thing replace the first;
   a push with no readable payload still shows something (iOS does not allow a silent push). */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    try { data = { body: event.data.text() }; } catch (e2) { data = {}; }
  }
  const scope = self.registration.scope;
  const url = data.url ? new URL(data.url, scope).href : new URL("dashboard.html", scope).href;
  event.waitUntil(self.registration.showNotification(data.title || "DCR Framing", {
    body: data.body || "",
    icon: new URL("icons/icon-192.png", scope).href,
    badge: new URL("icons/icon-192.png", scope).href,
    tag: data.tag || "dcr-portal2",
    renotify: true,
    data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const scope = self.registration.scope;
  let url = (event.notification.data && event.notification.data.url) || new URL("dashboard.html", scope).href;
  if (url.indexOf(scope) !== 0) url = new URL("dashboard.html", scope).href;    // only this site's pages
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url && c.url.indexOf(scope) === 0 && "focus" in c) {
        try { if ("navigate" in c) await c.navigate(url); } catch (e) { /* a window we may not steer */ }
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
    return undefined;
  })());
});
