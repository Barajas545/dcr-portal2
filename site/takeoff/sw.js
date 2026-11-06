/**
 * Service worker — so the app runs with no signal.
 *
 * A takeoff happens in a site trailer, in a truck, or in a house with no
 * roof on it yet. So the whole program — the page, the stylesheet and every
 * module js/main.js can load — is cached when this worker installs, all or
 * nothing (PROGRAM, below). Once one visit on a connection has let that
 * install finish, the app opens offline, including on a device that had
 * never run it before. pdf.js, the materials catalog and the icons are added
 * on top, best-effort (EXTRAS). The copy lasts until the browser clears the
 * site's storage or the next version installs in its place.
 *
 * Project files are never put in this cache: they are the estimator's own
 * documents and run to gigabytes. Plans saved for offline use are kept by
 * the portal's Plans Library, in the origin-private file system, or read
 * straight off the disk from the Plans Archive folder — never here.
 *
 * Bump CACHE whenever the app changes, or an installed copy will keep
 * serving the old one. A new module goes in PROGRAM: tests/sw-precache.mjs
 * fails when one main.js can reach is missing, and when an entry names a
 * file that does not exist — that would fail every install.
 */
const CACHE = 'ptt-web-v21';

/**
 * The program, precached on install: the page, the stylesheet, and every
 * module js/main.js can load — its static import graph, plus the one module
 * it only imports on demand.
 *
 * All of it, up front, because nothing else would cache it in time. The
 * worker registers at `load`, after the page has fetched every module
 * without it, so on a first visit the fetch handler sees none of them. With
 * only the old seven-file shell precached, a device that had never run the
 * app before could not open a saved plan offline: index.html and main.js
 * came from the cache, ./core/takeoff-file.js and the rest got this worker's
 * 503.
 *
 * Relative, every one of them: this app is served from a project subpath on
 * GitHub Pages, not from a domain root.
 */
const PROGRAM = [
  './',
  'index.html',
  'css/app.css',
  'js/main.js',
  // Not an import: the page's own <script> in its <head>, the layout decided before the stylesheet paints.
  'js/ui-mode-boot.js',
  'js/site-config.js',
  'js/core/canvas-limits.js',
  'js/core/counting.js',
  'js/core/drafts.js',
  'js/core/embedded.js',
  'js/core/geom.js',
  'js/core/measure.js',
  'js/core/page-store.js',
  'js/core/pdf-import.js',
  'js/core/plans-folder.js',
  'js/core/device-plans.js',
  'js/core/plans-link.js',
  'js/core/portal-handoff.js',
  'js/core/project.js',
  'js/core/remote-file.js',
  'js/core/revisions.js',
  'js/core/save-route.js',
  'js/core/scratch.js',
  'js/core/takeoff-file.js',
  'js/core/units.js',
  'js/core/xlsx.js',
  'js/core/zlib.js',
  'js/render/callouts.js',
  'js/render/labels.js',
  'js/render/markers.js',
  'js/render/renderer.js',
  'js/render/theme.js',
  'js/render/viewport.js',
  'js/render/zoom-floor.js',
  'js/tools/controller.js',
  'js/tools/markup.js',
  'js/ui/callout-preview.js',
  'js/ui/catalog.js',
  'js/ui/dialogs.js',
  'js/ui/items-panel.js',
  'js/ui/plans-archive.js',
  'js/ui/report-html.js',
  'js/ui/reports.js',
  'js/ui/revisions-panel.js',
  'js/ui/settings.js',
  'js/ui/thumbnails.js',
  'js/ui/version-bar.js',
  'js/ui/assemblies.js',          // imported on demand by the materials manager
  // A worker, not an import: started by Keep on This Device where the page has
  // no createWritable (Safari before 26), so offline it must be here too.
  'js/core/opfs-write-worker.js',
];

/**
 * Worth having offline, not worth failing an install over: the PDF engine
 * (starting a job from a PDF), the catalog behind the name box's suggestions,
 * the manifest and the icons. pdf.js's cmaps and standard fonts are left to
 * the fetch handler — only some PDFs ever ask for them.
 */
const EXTRAS = [
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'data/materials_catalog.json',
  'vendor/pdfjs/build/pdf.min.js',
  'vendor/pdfjs/build/pdf.worker.min.js',
];

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // All or nothing. addAll stores none of it unless every request succeeds,
    // and its rejection fails this install — so a version that cannot cache
    // itself whole never replaces one that could, and the old worker keeps
    // serving its own complete copy. `no-cache` revalidates against the
    // server, or the browser's HTTP cache would hand this installer the very
    // copies the new version exists to replace.
    await cache.addAll(PROGRAM.map(u => new Request(u, { cache: 'no-cache' })));
    // Best-effort, once the program is safely in: one of these failing costs
    // a feature offline, not the app.
    await Promise.all(EXTRAS.map(async u => {
      try {
        const res = await fetch(u, { cache: 'no-cache' });
        if (res && res.ok) await cache.put(u, res);
      } catch { /* left to the fetch handler */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const names = await caches.keys();
    // Same origin as the portal: delete only this app's old caches, never its "dcr-portal-*" one.
    await Promise.all(names
      .filter(n => n.startsWith('ptt-web-') && n !== CACHE)
      .map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', ev => {
  if (ev.data === 'skip-waiting') self.skipWaiting();
});

/**
 * The program is fetched fresh when there is a network; everything else is
 * served from the cache.
 *
 * Cache-first for everything was the obvious choice and it is wrong here.
 * The HTML, the CSS and the modules have to agree with each other: serve a
 * new index.html beside a cached stylesheet from the previous version and
 * you get a broken app with nothing in the console to explain it. That is
 * not hypothetical — it happened during development, and the symptom was a
 * page where no button could be clicked.
 *
 * So the shell is network-first with a short timeout, falling back to cache
 * the moment the network is slow or absent. Offline still works; a stale
 * mixture cannot happen. Assets that never change without changing their
 * name — pdf.js, the icons, the catalog — stay cache-first, which is where
 * nearly all the bytes are anyway.
 */
const SHELL_RE = /\.(?:html|css|js|webmanifest)$|\/$/;
const NET_TIMEOUT_MS = 2500;

function withTimeout(promise, ms) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), ms);
    promise.then(v => { clearTimeout(t); resolve(v); },
                 () => { clearTimeout(t); resolve(null); });
  });
}

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never proxy elsewhere
  // A range request is how a media element asks for part of a file; the
  // Cache API cannot answer one, and answering it wrong breaks playback.
  if (req.headers.has('range')) return;

  ev.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: false });

    // vendor/ is a pinned third-party release: its contents never change
    // without the version in the path changing, so it stays cache-first
    // and 1.4 MB of pdf.js is not re-fetched on every launch.
    const isShell = req.mode === 'navigate'
      || (SHELL_RE.test(url.pathname) && !url.pathname.includes('/vendor/'));

    // The browser's own HTTP cache sits UNDERNEATH this worker, and GitHub
    // Pages serves with a max-age. So a plain fetch() can hand back the very
    // copy we are trying to replace, and "network first" quietly means "HTTP
    // cache first" — which is exactly how a stale stylesheet survived a
    // redeploy and left the app with no clickable buttons. Shell requests
    // revalidate against the server; a 304 makes that nearly free.
    const go = () => fetch(req, isShell ? { cache: 'no-cache' } : undefined)
      .then(res => {
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      })
      .catch(() => null);

    if (isShell) {
      const fresh = await withTimeout(go(), NET_TIMEOUT_MS);
      if (fresh) return fresh;
      if (hit) return hit;
    } else if (hit) {
      ev.waitUntil(go());                 // refresh for next time
      return hit;
    }
    const res = await go();
    if (res) return res;

    // Offline and never cached. A navigation still has somewhere to go.
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html') || await cache.match('./');
      if (shell) return shell;
    }
    return new Response('Offline, and this part of the app was never cached.',
                        { status: 503, headers: { 'Content-Type': 'text/plain' } });
  })());
});
