/* DCR Employee Portal 2 service worker (BLUEPRINT 2.2.6).

   - Cache "dcr-portal2-v3". On activate it deletes only OTHER "dcr-portal2-*" caches: never the old
     portal's "dcr-portal-*" nor anything else on the device.
   - Network FIRST for the site's own pages and files (always up to date online; the last copy
     offline). A copy is kept under its path only, never with a query string: an address such as
     "index.html?email=…&password=…" (a sign-in form sent by the browser itself) is never stored,
     and a page with ?id= falls back to its one kept copy. The pinned CDN libraries (exact versions,
     scoped packages included: @supabase/supabase-js@2.117.2) are kept and used first.
   - Never touches *.supabase.co (data, sign-in, Storage, Realtime) and never a non-GET request.
   - Phone reminders (P3, BLUEPRINT 3.3.8): "push" shows {title, body, url, tag} from the Edge Function
     "push"; "notificationclick" opens or focuses that page, and only a page of this site (same origin,
     inside this worker's scope): anything else in a payload opens the home page instead.
   v2 (P3): the push handlers and the task pages; a new name so every installed copy takes them.
   v3 (P6): My Assistant (a phone page) and the home page's new cards. The admins' pages (the DCR Agents 2
   console, about 600 KB of scripts, and Assistants) are not kept ahead on every crew phone: they are kept
   as they are opened, like any page.
   P5a keeps "dcr-portal2-v3" (pages are network first, so nothing goes stale): the Estimate and Takeoffs tabs'
   files and the two printed pages join the list (the next install keeps them; activate deletes only OTHER
   names). The progress chart (pm.html, report-pm.html) is kept as it is opened, like the admins' pages.
   A new name must never cost a phone its offline libraries: install also keeps supabase-js (PINNED_PRECACHE),
   and activate copies every pinned CDN file an older "dcr-portal2-*" cache held into the new one BEFORE
   that cache is deleted (the visit that installs the new worker is still served by the old one, so it
   never fetches them itself). tests/core-sw.test.mjs runs both.
   Part 3 (owner 2026-10-24) keeps "dcr-portal2-v3" the same way: the shared New Project dialog (the Board's and the
   project page's), its OneDrive folder step, the admin page's Access switches and the project picture's maker join
   the list; the Expenses tab's cost dialog and form rules (money code) stay out of it, as the money tabs do.
   Part 4 (the Files tab's OneDrive part, owner 2026-10-24) keeps "dcr-portal2-v3" the same way: its broker module,
   its rules and the uploader join the list (project.html loads them); the admin's self-test (js/pages/
   onedrive-selftest.js, loaded only when an admin clicks it on the test project) stays out of it, as the admins'
   pages do. Nothing of OneDrive is kept for offline use but the code: no listing, link or upload address. */
const CACHE = "dcr-portal2-v3";
const PREFIX = "dcr-portal2-";
// Every page below with every file it loads (its stylesheets and its whole static import graph:
// tests/core-sw.test.mjs checks it), so the installed app also opens offline from a cold start (a
// phone that lost signal before it ever opened that page).
const SHELL = [
  "./", "index.html", "dashboard.html", "change-password.html", "settings.html",
  "board.html", "project.html", "search.html", "logs.html", "capture.html", "report-journal.html",
  "timesheet.html", "timesheet-mobile.html", "timesheet-manager.html", "timesheet-batch.html", "report-timecard.html", "admin.html",
  "my-tasks.html", "tasks-map.html", "my-assistant.html",
  "css/styles.css", "css/tasks.css", "manifest.json",
  "js/config.js", "js/sb.js", "js/common2.js", "js/live.js", "js/money-mask.js", "js/upload-queue2.js",
  "js/install.js", "js/push2.js", "js/timesheet-pdf.js",
  "js/shell/index.js", "js/shell/dashboard.js", "js/shell/settings.js", "js/shell/change-password.js",
  "js/repo/_db.js", "js/repo/activity.js", "js/repo/agents.js", "js/repo/assistant.js", "js/repo/employees.js", "js/repo/files.js", "js/repo/journal.js",
  "js/repo/people.js", "js/repo/projects.js", "js/repo/search.js", "js/repo/tasks.js", "js/repo/timesheets.js",
  "js/map/activity.js", "js/map/agents.js", "js/map/assistant.js", "js/map/files.js", "js/map/geo.js", "js/map/journal.js", "js/map/legacy.js", "js/map/pacific.js",
  "js/map/projects.js", "js/map/search.js", "js/map/status.js", "js/map/tasks.js", "js/map/timesheets.js",
  "js/pages/shell.js", "js/pages/admin.js", "js/pages/board.js", "js/pages/board-model.js", "js/pages/capture.js",
  "js/pages/journal-sync.js", "js/pages/logs.js", "js/pages/my-tasks.js", "js/pages/my-assistant.js", "js/pages/project.js", "js/pages/project-files.js",
  "js/pages/project-journal.js", "js/pages/project-log.js", "js/pages/project-mailing.js", "js/pages/project-overview.js",
  "js/pages/project-tasks.js", "js/pages/report-journal.js", "js/pages/report-timecard.js", "js/pages/search.js",
  "js/pages/task-form.js", "js/pages/tasks-map.js", "js/pages/timesheet.js", "js/pages/timesheet-batch.js",
  "js/pages/timesheet-manager.js", "js/pages/timesheet-mobile.js", "js/pages/ts-shared.js", "js/pages/uploads.js",
  // P5a: the read-only Estimate and Takeoffs tabs of project.html and their printed pages
  "report-estimate.html", "report-takeoff.html", "css/estimates.css", "js/repo/estimates.js", "js/map/estimates.js", "js/map/takeoffs.js",
  "js/pages/est-render.js", "js/pages/project-estimate.js", "js/pages/project-takeoffs.js", "js/pages/report-estimate.js", "js/pages/report-takeoff.js",
  // Part 3: New Project (board.html, project.html), the Access tab (admin.html), the project picture
  "js/pages/new-project.js", "js/repo/onedrive.js", "js/map/access.js", "js/thumb-prep.js",
  // Part 4: the Files tab's OneDrive part (its rules and the uploader; the broker module is listed above)
  "js/map/onedrive.js", "js/onedrive-upload.js", "js/scrub-money.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/logo.png", "icons/logo.jpg",
];

// The pinned library every page needs before it can reach the database (js/sb.js SUPABASE_JS_URL - the
// same address: tests/core-sw.test.mjs compares them), kept at install so a cold start with no signal works
// even on a phone that never loaded it under this cache's name.
const PINNED_PRECACHE = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js",
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
    await Promise.all(PINNED_PRECACHE.map(async (url) => {
      try {
        if (await cache.match(url)) return;
        const res = await fetch(url, { mode: "cors", credentials: "omit" });
        if (res && res.ok) await cache.put(url, res);
      } catch (e) { /* offline: activate copies it from the previous cache, or the first page load keeps it */ }
    }));
  })());
});

/** The pinned CDN files an older "dcr-portal2-*" cache holds, copied into `cache` (what it has already stays). */
async function keepPinned(cache, oldNames) {
  for (const name of oldNames) {
    try {
      const old = await caches.open(name);
      for (const req of await old.keys()) {
        if (!PINNED_CDN.test(req.url) || (await cache.match(req))) continue;
        const res = await old.match(req);
        if (res) await cache.put(req, res);
      }
    } catch (e) { /* one cache that cannot be read must not stop the others */ }
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const older = keys.filter((k) => k.indexOf(PREFIX) === 0 && k !== CACHE);
    try { await keepPinned(await caches.open(CACHE), older); } catch (e) { /* the first online page load keeps them again */ }
    await Promise.all(older.map((k) => caches.delete(k)));
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
   The payload {title, body, url, tag}: the tag makes a second notice about the same thing (the same task,
   the same missing day) replace the first instead of stacking. A push with no readable payload still
   shows something: iOS does not allow a silent push and would end the subscription. */
const HOME = "dashboard.html";
const TEXT_MAX = { title: 80, body: 400, tag: 60 };

/** The page a notice may open: a page of this site (same origin, inside the scope), else the home page. */
function safeTarget(raw) {
  const scope = self.registration.scope;
  try {
    if (typeof raw === "string" && raw) {
      const u = new URL(raw, scope);
      if (u.origin === self.location.origin && u.href.indexOf(scope) === 0) return u.href;
    }
  } catch (e) { /* not a URL */ }
  return new URL(HOME, scope).href;
}
function text(v, max) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {
    try { data = { body: event.data.text() }; } catch (e2) { data = {}; }
  }
  if (!data || typeof data !== "object") data = {};
  const scope = self.registration.scope;
  event.waitUntil(self.registration.showNotification(text(data.title, TEXT_MAX.title) || "DCR Framing", {
    body: text(data.body, TEXT_MAX.body),
    icon: new URL("icons/icon-192.png", scope).href,
    badge: new URL("icons/icon-192.png", scope).href,
    tag: text(data.tag, TEXT_MAX.tag) || "dcr-portal2",
    renotify: true,
    data: { url: safeTarget(data.url) },
  }));
});

/* Tapping a notice: a window already showing that page is focused; else an open Portal 2 window is
   taken to it; else a new window opens. Never a page of another site. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeTarget(event.notification.data && event.notification.data.url);
  const scope = self.registration.scope;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const ours = all.filter((c) => c.url && c.url.indexOf(scope) === 0 && "focus" in c);
    const same = ours.find((c) => c.url === url);
    if (same) return same.focus();
    for (const c of ours) {
      try {
        if ("navigate" in c) {
          const moved = await c.navigate(url);
          return (moved || c).focus();
        }
      } catch (e) { /* a window we may not steer: try the next, or open one */ }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
    return undefined;
  })());
});
