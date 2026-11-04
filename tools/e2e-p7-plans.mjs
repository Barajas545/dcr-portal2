#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the plan buttons and the Floor Plans card in the DEMO (development only; owner
   decisions 2026-10-26).

     node tools/e2e-p7-plans.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the broker's stand-in and its made-up takeoff folder:
   tools/fake/p7-onedrive.js plans_for - nothing goes to Supabase or Microsoft) and drives a local Chrome or Edge
   headless:

   - Search as a field person and as an admin (decision 2: the same buttons): A267 gets 📐 beside its result (never
     inside its link), opening takeoff-web at #plans=A267 in a new tab (rel noopener), its accessible name and the count
     in its title (the admin's names the Plans Library's menu of files it opens: the people who see prices); among the A02… results A024 and A024-B each get theirs (apart), A021 none; one plans_for call a search;
   - the project page's header: "📐 Plans ↗" on A267 (every tab), none on A001; the Takeoffs tab keeps its own link;
   - the home page's Floor Plans card for an admin, a manager with prices and an accountant (prices), never for a manager
     without prices, a lead, a field person or a view-only person; a new tab at takeoff-web's #plans;
   - the takeoff folder not set up (the demo's switch, localStorage "dcr2-demo-takeoff" = "off"): no button anywhere,
     nothing said, the page as before;
   - a tablet (an iPad that calls itself a Mac, with touch; owner decisions Q1-Q4, 2026-11-04; contract C2/C3) with the
     REAL takeoff app - the vendored copy at /takeoff/, nothing standing in for it - and a made-up but real .takeoff as
     the demo's A267 plan (two made-up sheets, written in the page by the copy's own js/core/takeoff-file.js;
     tools/fake/p7-onedrive.js setPlanFixture): the Floor Plans card and the header's 📐 lead to the Plans Library
     (never github.io), the menu's foot has no Plans Archive; (i) Open saves the plan on the device first, then the
     frame shows /takeoff/ over a page held still, and the app says ready, gets ptt-open with the File and canSave, and
     shows the two sheets; a ready from the page itself or with another word is never answered; (vii) a first visit:
     the frame's page never reloads (the copy's own worker first) and its #portal=<word> arrives; (ii) an edit (the
     app's own undoable step), and Close asks first; (iii) the app's own File › Save -> "Saving to the portal…" with
     "keeping" -> "kept" -> the app marks the project saved -> the demo's OneDrive gets it (plan_save_session /
     plan_save_done) -> "sent" on the app's status line; the record holds exactly the bytes the app saved and OneDrive
     got, the edit in them (no plan_link, no download), and a later check takes OneDrive's hash with no plan_link; a
     ptt-save from the page itself is never heard; (iv) the office saves the plan (officeSave), and the next Save of
     the same opening becomes a separate file: said on the frame's bar and on the app's status line, the plan's record
     untouched, the copy a record of its own; the menu's row says so after Close. (v) A person with prices but without
     "Can upload to OneDrive" (the accountant): the app opens without canSave and its Save goes to the share sheet (a
     stand-in: headless Chrome has none, and the frame is given Safari's lack of file pickers), nothing handed to the
     portal or sent. (vi) A tablet without prices: 📐 says "Plans are for the people who see prices", and nothing is
     asked of the broker;
   - phone (375 px) and desktop, light and dark: never sideways; no Content-Security-Policy violation and no console
     error on any page (the frame's page included).
   Screenshots (--shots all): plans_<what>_<light|dark>_<desktop|phone>.png into --out.
   Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p7-plans")));
const SHOTS = arg("--shots", "all");
const HOME = "https://barajas545.github.io/takeoff-web/index.html#plans";
const CARD = { admin: true, manager: false, manager_prices: true, accountant: true, lead: false, field: false, viewer: false };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = startServer(0);
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const { cdp, proc } = await launch(arg("--chrome"));
  const results = [];
  const shots = [];
  const pages = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail: detail === undefined ? "" : detail });
    process.stderr.write((ok ? "  ok   " : "  FAIL ") + name + (ok ? "" : " :: " + String(detail).slice(0, 300)) + "\n");
  };
  const attempt = async (name, fn, page) => {
    try { await fn(); } catch (e) {
      let where = "";
      if (page) {
        try { where = " @ " + await page.eval("location.href + ' :: ' + (document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(-500) : '')"); }
        catch (x) { where = " @ (page not answering: " + x.message + ")"; }
      }
      check(name, false, String(e && e.message || e).slice(0, 400) + where);
    }
  };
  const TOPBAR = "!!document.querySelector('.dcr2-topbar .p2-badge')";
  async function signIn(p, key, next) {
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
    await p.goto(base + "/index.html" + (next ? "?next=" + encodeURIComponent(next) : ""), 150);
    await p.until("!!document.getElementById('loginForm') && !!window.DCR2Demo && !document.getElementById('loginFields').disabled", 8000);
    await p.eval("document.getElementById('email').value=" + JSON.stringify(key + "@demo.test") + ";document.getElementById('password').value='demo-password-1';" +
      "document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname) && " + TOPBAR, 10000);
  }
  const emailOf = { admin: "admin", manager: "manager", manager_prices: "manager2", accountant: "accountant", lead: "lead", field: "field", viewer: "viewer" };
  const db = (p, expr) => p.eval("(() => { const R = DCR2Demo.engine.rows; return " + expr + "; })()");
  const sideways = (p) => p.eval("document.documentElement.scrollWidth - window.innerWidth");
  async function shoot(p, name, device, dark, at) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 375 : 1440;
    const h = device === "phone" ? 812 : 900;
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    await p.size(w, h, device === "phone");
    await sleep(500);
    if (at) await p.eval("(() => { const e = document.querySelector(" + JSON.stringify(at) + "); if (e) e.scrollIntoView({ block: 'center' }); return true; })()");
    await sleep(200);
    const file = "plans_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.dark(false);
  }
  /** count the broker calls a page makes (the demo's functions.invoke), from the page itself */
  const countCalls = (p) => p.eval("(() => { const c = DCR2Demo && DCR2Demo.engine; if (!c || c.__plansCount) return true; const inv = c.invoke; window.__plans = 0;" +
    " c.invoke = function (ctx, name, body) { if (name === 'onedrive' && body && body.op === 'plans_for') window.__plans++; return inv.apply(this, arguments); }; c.__plansCount = true; return true; })()");
  /** the Search results: each project's title and its button (or none) */
  const searchRows = (p) => p.eval("Array.from(document.querySelectorAll('#seResults .se-proj')).map(r => { const a = r.querySelector('.se-plan:not([hidden]) a');" +
    " return { title: r.querySelector('.se-title').textContent, inLink: !!r.querySelector('a.se-item .se-plan'), btn: a ? { href: a.href, target: a.target, rel: a.rel," +
    " label: a.getAttribute('aria-label'), title: a.title, text: a.textContent } : null }; })");
  const search = async (p, q) => {
    await p.goto(base + "/search.html?q=" + encodeURIComponent(q), 400);
    await p.until("document.querySelectorAll('#seResults .se-proj').length > 0", 10000);
    await sleep(900);                                   // the plans_for answer (the demo's is at once; the paint follows)
  };

  let J = null;
  try {
    /* ── 0. a clean demo database; the projects the walk uses ─────────────── */
    const A = await newPage(cdp, "setup", OUT); pages.push(A);
    await A.size(1440, 900, false);
    await A.goto(base + "/manifest.json", 50);
    await A.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");
    await signIn(A, "admin", "dashboard.html");
    J = await db(A, "({ sandbox: R.projects.find(p => p.number === 'A267').id, a001: R.projects.find(p => p.number === 'A001').id })");
    check("demo: the sandbox A267 and A001 are there", J.sandbox && J.a001, JSON.stringify(J));

    /* ── 1. Search: a field person and an admin see the same buttons ──────── */
    for (const key of ["field", "admin"]) {
      const p = await newPage(cdp, "search-" + key, OUT); pages.push(p);
      await attempt(key + ": Search draws 📐 beside the projects whose takeoff folder holds a takeoff file", async () => {
        await p.size(1440, 900, false);
        await signIn(p, emailOf[key], "dashboard.html");
        await search(p, "A267");
        const rows = await searchRows(p);
        const a267 = rows.find((r) => /^A267\b/.test(r.title));
        check(key + ": A267's button - takeoff-web at #plans=A267 in a new tab, its name, the count in its title, beside the link",
          a267 && a267.btn && a267.btn.href === "https://barajas545.github.io/takeoff-web/index.html#plans=A267" && a267.btn.target === "_blank" &&
          a267.btn.rel === "noopener" && /^3 takeoff files for A267/.test(a267.btn.title) &&
          a267.btn.label === (key === "admin" ? "Plans for A267 — open or save the plan files" : "Plans for A267 — open in the takeoff app") &&
          !a267.inLink && /📐/.test(a267.btn.text), JSON.stringify(rows));
        await countCalls(p);
        await p.eval("(() => { const b = document.getElementById('seInput'); b.value = 'A02'; b.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
        await p.until("Array.from(document.querySelectorAll('#seResults .se-proj .se-title')).some(t => /^A024-B\\b/.test(t.textContent))", 10000);
        await sleep(900);
        const two = await searchRows(p);
        const by = (n) => two.find((r) => new RegExp("^" + n + " ").test(r.title));
        check(key + ": A024 and A024-B each get theirs (a suffix number's folder apart), A021 none",
          by("A024") && by("A024").btn && /^1 takeoff file for A024 /.test(by("A024").btn.title) && by("A024-B") && by("A024-B").btn &&
          /#plans=A024-B$/.test(by("A024-B").btn.href) && /^2 takeoff files/.test(by("A024-B").btn.title) && by("A021") && !by("A021").btn,
          JSON.stringify(two.map((r) => [r.title.slice(0, 8), r.btn && r.btn.title.slice(0, 22)])));
        check(key + ": one plans_for call for the search", (await p.eval("window.__plans")) === 1, await p.eval("window.__plans"));
        if (key === "field" && SHOTS !== "none") { await shoot(p, "search", "desktop", false); await shoot(p, "search", "phone", false); await shoot(p, "search", "phone", true); }
        await p.size(375, 812, true);
        await sleep(400);
        check(key + ": Search with the buttons never scrolls sideways at 375 px", (await sideways(p)) <= 0, await sideways(p));
        const box = await p.eval("(() => { const a = document.querySelector('.se-plan:not([hidden]) a'); const r = a.getBoundingClientRect(); return { w: r.width, h: r.height }; })()");
        check(key + ": the phone's button is a finger's target (44 px high at least)", box.h >= 44 && box.w >= 44, JSON.stringify(box));
        await p.size(1440, 900, false);
      }, p);
    }

    /* ── 2. the project page's header ───────────────────────────────────── */
    const P = await newPage(cdp, "project-field", OUT); pages.push(P);
    await attempt("field: the project header's 📐 Plans on A267 (every tab), none on A001; the Takeoffs tab keeps its link", async () => {
      await P.size(1440, 900, false);
      await signIn(P, "field", "dashboard.html");
      await P.goto(base + "/project.html?id=" + J.sandbox, 400);
      await P.until("!!document.querySelector('#pjPlans:not([hidden]) a')", 10000);
      const btn = await P.eval("(() => { const a = document.querySelector('#pjPlans a'); return { href: a.href, target: a.target, rel: a.rel, text: a.textContent, label: a.getAttribute('aria-label'), cls: a.className }; })()");
      check("field: A267's header button", btn.href === "https://barajas545.github.io/takeoff-web/index.html#plans=A267" && btn.target === "_blank" &&
        btn.rel === "noopener" && /📐 Plans ↗/.test(btn.text) && btn.label === "Plans for A267 — open in the takeoff app" && btn.cls === "pj-btn", JSON.stringify(btn));
      await P.eval("document.querySelector('.pj-tab[data-tab=\"takeoffs\"]').click(); true");
      await P.until("/Plans Archive \\(takeoff-web\\)/.test((document.getElementById('tkoBar') || {}).innerText || '')", 8000);
      check("field: on the Takeoffs tab the header button is still there, and the tab's own link too",
        await P.eval("!document.getElementById('pjPlans').hidden && /#plans=A267$/.test(document.querySelector('#tkoBar a').href)"));
      if (SHOTS !== "none") { await shoot(P, "project", "desktop", false); await shoot(P, "project", "phone", true); }
      await P.size(375, 812, true);
      await sleep(400);
      check("field: the project header never scrolls sideways at 375 px", (await sideways(P)) <= 0);
      await P.size(1440, 900, false);
      await P.goto(base + "/project.html?id=" + J.a001, 400);
      await P.until("/A001/.test(document.getElementById('pjTitle').textContent)", 8000);
      await sleep(1200);
      check("field: no button on A001 (no takeoff folder)", await P.eval("document.getElementById('pjPlans').hidden && !document.querySelector('#pjPlans a')"));
    }, P);

    /* ── 3. the home page's Floor Plans card per role ──────────────────── */
    for (const key of Object.keys(CARD)) {
      const p = await newPage(cdp, "home-" + key, OUT); pages.push(p);
      await attempt(key + ": the Floor Plans card " + (CARD[key] ? "is there" : "is not there"), async () => {
        await p.size(1440, 900, false);
        await signIn(p, emailOf[key], "dashboard.html");
        await p.until("document.querySelectorAll('.hm-card').length > 3", 8000);
        const card = await p.eval("(() => { const c = Array.from(document.querySelectorAll('.hm-card')).find(x => /Floor Plans/.test(x.textContent)); if (!c) return null;" +
          " const a = c.querySelector('a.hm-card-go'); return { href: a.href, target: a.target, rel: a.rel, ic: c.querySelector('.ic').textContent, ds: c.querySelector('.ds').textContent }; })()");
        check(key + ": Floor Plans " + (CARD[key] ? "opens takeoff-web's #plans in a new tab" : "is not offered"),
          CARD[key] ? !!card && card.href === HOME && card.target === "_blank" && card.rel === "noopener" && card.ic === "📐" && /Plans Archive/.test(card.ds) : card === null,
          JSON.stringify(card));
        if (key === "admin" && SHOTS !== "none") { await shoot(p, "home", "desktop", false, ".hm-card a[target]"); await shoot(p, "home", "phone", true, ".hm-card a[target]"); }
      }, p);
    }

    /* ── 4. the takeoff folder not set up: nothing anywhere, nothing said ── */
    const O = await newPage(cdp, "off-admin", OUT); pages.push(O);
    await attempt("the takeoff folder not set up: no button in Search or on the project page, nothing said", async () => {
      await O.size(1440, 900, false);
      await signIn(O, "admin", "dashboard.html");
      await O.eval("localStorage.setItem('dcr2-demo-takeoff', 'off'); true");
      await search(O, "A267");
      const rows = await searchRows(O);
      const note = await O.eval("document.getElementById('seNote').textContent");
      check("off: Search draws its results and no button, and says nothing about plans", rows.length > 0 && rows.every((r) => !r.btn) && !/plan|takeoff|OneDrive/i.test(note),
        JSON.stringify({ rows: rows.length, note }));
      await O.goto(base + "/project.html?id=" + J.sandbox, 400);
      await O.until("/A267/.test(document.getElementById('pjTitle').textContent)", 8000);
      await sleep(1200);
      check("off: no header button on A267, no notice", await O.eval("document.getElementById('pjPlans').hidden && !document.getElementById('pjNotice').textContent"));
      await O.eval("localStorage.removeItem('dcr2-demo-takeoff'); true");
    }, O);

    /* ── 4b. a tablet with the REAL takeoff app (owner decisions Q1-Q4, 2026-11-04; contract C2/C3): an iPad that calls
       itself a Mac, touch. A made-up but real .takeoff (two made-up sheets, written by the vendored copy's own
       js/core/takeoff-file.js) is the demo's A267 plan. 📐 saves it on the device first, the frame loads /takeoff/ - the
       vendored takeoff-web itself, nothing stands in for it - which says ready, gets the File with canSave and shows the
       plan; an edit, Close asks; the app's own Save -> "Saving to the portal…" -> kept (spooled here) -> saved in the
       app -> sent to the demo's OneDrive -> "sent" on the app's status line; the record holds the saved bytes (no
       download, and a later check needs no plan_link); then the office saves the plan and the next Save becomes a copy,
       said in the portal and in the app ── */
    const TABLET_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
    /** the records of the Plans Library on this device */
    const records = (p) => p.eval("(async () => { const d = await new Promise((res, rej) => { const r = indexedDB.open('dcr2-plan-library'); r.onsuccess = () => res(r.result); r.onerror = rej; });" +
      " const all = await new Promise((res) => { const q = d.transaction('plans').objectStore('plans').getAll(); q.onsuccess = () => res(q.result); }); d.close();" +
      " return all.map(r => ({ key: r.key, itemId: r.itemId, name: r.name, file: r.file, size: r.size, version: r.version, local: r.local || null, sent: r.sent || null," +
      " adopted: r.adopted || null, expect: !!r.expect, dl: r.dl || null })); })()");
    /** every broker op the page asks from now on (the demo's functions.invoke) */
    const watchOps = (p) => p.eval("(() => { const c = DCR2Demo.engine; if (!c.__opsWatched) { const inv = c.invoke; c.invoke = function (ctx, name, body) {" +
      " if (name === 'onedrive' && body) window.__ops.push(body.op); return inv.apply(this, arguments); }; c.__opsWatched = true; } window.__ops = []; return true; })()");
    /** a made-up but real takeoff project as the demo's plan of `number` (this page): composed by the copy's own writer */
    const putFixture = (p, number, title) => p.eval("(async () => { const { writeProject } = await import('/takeoff/js/core/takeoff-file.js');" +
      " const sheet = async (label, hue) => { const c = new OffscreenCanvas(1200, 800); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1200, 800);" +
      " g.strokeStyle = 'hsl(' + hue + ' 60% 35%)'; g.lineWidth = 6; g.strokeRect(40, 40, 1120, 720); g.fillStyle = '#111'; g.font = 'bold 40px sans-serif'; g.fillText(label, 70, 110);" +
      " return { kind: 'png', data: new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()) }; };" +
      " const blob = await writeProject({ metadata: { project_name: " + JSON.stringify(title) + ", annotations: {}, measurements: {}, page_labels: ['A1', 'A2'] }," +
      " pageSources: [await sheet('A1 MADE UP', 210), await sheet('A2 MADE UP', 20)] });" +
      " return DCR2Demo.engine.exts.find(x => x.name === 'p7-onedrive').setPlanFixture(" + JSON.stringify(number) + ", blob); })()");
    /** a JS dialog in the walk (the app's or the portal's) is answered at once and noted (never blocks the walk) */
    const answerDialogs = (p) => {
      p.dialogs = [];
      cdp.handlers.add((m) => {
        if (m.sessionId !== p.s || m.method !== "Page.javascriptDialogOpening") return;
        p.dialogs.push(m.params.type + ": " + m.params.message);
        p.call("Page.handleJavaScriptDialog", { accept: false }).catch(() => null);
      });
    };
    /** the frame's app (its window, from the page: one site) */
    const APP = "document.getElementById('ptfFrame').contentWindow";
    /** the project page of the sandbox A267, its 📐 there */
    async function openReal(p) {
      await p.goto(base + "/project.html?id=" + J.sandbox, 400);
      await p.until("!!document.querySelector('#pjPlans:not([hidden]) a[data-plan-menu]')", 10000);
    }
    const T = await newPage(cdp, "tablet-admin", OUT); pages.push(T);
    answerDialogs(T);
    await attempt("a tablet with the real takeoff app: open from 📐 (saved here first), an edit, Close asks, Save -> kept -> saved -> sent; then the office's save makes the next one a copy", async () => {
      await T.call("Emulation.setUserAgentOverride", { userAgent: TABLET_UA, platform: "MacIntel" });
      await T.size(1024, 768, true);
      await signIn(T, "admin", "dashboard.html");
      const card = await T.eval("(() => { const c = Array.from(document.querySelectorAll('.hm-card')).find(x => /Floor Plans/.test(x.textContent)); const a = c && c.querySelector('a.hm-card-go'); return a ? { href: a.getAttribute('href'), target: a.target } : null; })()");
      check("tablet: the Floor Plans card opens the Plans Library (no Plans Archive on a tablet)", card && card.href === "plans-library.html" && !card.target, JSON.stringify(card));
      await openReal(T);
      const btn = await T.eval("(() => { const a = document.querySelector('#pjPlans a'); return { href: a.getAttribute('href'), target: a.target }; })()");
      check("tablet: the header's 📐 leads to the Plans Library, never github.io", btn.href === "plans-library.html" && !btn.target, JSON.stringify(btn));
      // (vii) a first visit: no worker of the copy's on this device yet
      const first = await T.eval("navigator.serviceWorker.getRegistration('/takeoff/').then(r => !r || !/\\/takeoff\\//.test(r.scope))");
      const fx = await putFixture(T, "A267", "A267 made-up plan (e2e)");
      check("tablet: the demo's A267 plan is a made-up but real takeoff project now", fx && fx.size > 1000 && /\.takeoff$/.test(fx.name), JSON.stringify(fx));
      await T.eval("document.querySelector('#pjPlans a[data-plan-menu]').click(); true");
      await T.until("!!document.querySelector('.pl-sheet [data-pl-act=\"open\"][data-id=" + JSON.stringify(fx.id) + "]')", 10000);
      const foot = await T.eval("document.querySelector('.pl-sheet .pl-ft').innerText");
      check("tablet: the menu's foot has no Plans Archive", /Plans Library/.test(foot) && !/Plans Archive/.test(foot), foot);
      // the conversation, watched from the page: every message the frame's app sends (a save's File kept to compare)
      await T.eval("window.__heard = []; window.__saveFiles = []; window.addEventListener('message', (e) => { const f = document.getElementById('ptfFrame');" +
        " const fromFrame = !!f && e.source === f.contentWindow; window.__heard.push({ type: e.data && e.data.type, origin: e.origin, fromFrame, nonce: e.data && e.data.nonce, req: e.data && e.data.req });" +
        " if (fromFrame && e.data && e.data.type === 'ptt-save') window.__saveFiles.push(e.data.file); }); true");
      await watchOps(T);
      // (i) Open: saved on the device first, then the frame with the portal's copy of the app
      await T.eval("document.querySelector('.pl-sheet [data-pl-act=\"open\"][data-id=" + JSON.stringify(fx.id) + "]').click(); true");
      await T.until("!!document.querySelector('#ptfShell.open #ptfFrame[src]')", 20000);
      const shown = await T.eval("(() => { const f = document.getElementById('ptfFrame'); return { src: f.getAttribute('src'), title: document.getElementById('ptfTitle').textContent," +
        " inert: !!document.getElementById('dcr2Topbar').inert, overflow: document.body.style.overflow }; })()");
      const word = shown.src.split("#portal=")[1];
      check("tablet: the frame shows the portal's copy at #portal=<word>, over a page held still", /^takeoff\/index\.html#portal=[A-Za-z0-9_-]{24}$/.test(shown.src) &&
        shown.title === "📐 " + fx.name && shown.inert && shown.overflow === "hidden", JSON.stringify(shown));
      const saved = (await records(T)).filter((r) => r.itemId === fx.id);
      check("tablet: the plan was saved on the device first (the fixture's bytes, whole, in the Plans Library)", saved.length === 1 && saved[0].file && saved[0].size === fx.size &&
        !saved[0].dl && saved[0].version === fx.version, JSON.stringify(saved));
      // the real app: ready -> ptt-open with the File and canSave -> the plan's two sheets shown
      await T.until("(() => { try { const t = " + APP + ".TakeoffApp; return !!(t && t.app.portal && t.app.portal.kind === 'file' && t.app.project.pageCount === 2); } catch (e) { return false; } })()", 30000);
      const app = await T.eval("(() => { const w = " + APP + "; const t = w.TakeoffApp; return { canSave: t.app.portal.canSave, name: t.app.portal.name, nonce: t.app.portal.nonce," +
        " via: t.app.portal.peer && t.app.portal.peer.via, pages: t.app.project.pageCount, dirty: t.app.project.dirty, project: t.app.project.metadata.project_name," +
        " status: w.document.getElementById('statusText').textContent, nav: (w.performance.getEntriesByType('navigation')[0] || {}).type," +
        " controller: w.navigator.serviceWorker.controller ? new URL(w.navigator.serviceWorker.controller.scriptURL).pathname : null, path: w.location.pathname }; })()");
      check("tablet (i): the real app got the plan from the portal - a File, canSave, the frame's parent as its peer - and shows its two sheets",
        app.canSave === true && app.name === fx.name && app.nonce === word && app.via === "frame" && app.pages === 2 && app.dirty === false &&
        app.project === "A267 made-up plan (e2e)" && app.path === "/takeoff/index.html", JSON.stringify(app));
      const heard = await T.eval("window.__heard");
      check("tablet: the portal heard the app's ready from the frame's own window, on this site, with the word",
        heard.some((h) => h.type === "ptt-ready" && h.fromFrame && h.origin === base && h.nonce === word), JSON.stringify(heard));
      // (vii) never reloaded: the copy's own worker was registered and active before the page loaded, and the word arrived
      check("tablet (vii): a first visit, and the frame's page never reloaded - its own worker (takeoff/sw.js) from the start, #portal=<word> taken",
        first === true && app.nav === "navigate" && (app.controller === null || app.controller === "/takeoff/sw.js") && app.nonce === word,
        JSON.stringify({ first, nav: app.nav, controller: app.controller }));
      // a stranger is never answered: a ready from the page itself, or from the frame with another word (code run as the
      // frame's own page, an isolated world of it: what it posts comes from the frame's window)
      const tree = await T.call("Page.getFrameTree");
      const child = (tree.frameTree.childFrames || []).find((c) => /\/takeoff\/index\.html/.test(c.frame.url));
      let world = null;
      const inFrame = async (expr) => {
        for (let i = 0; i < 2; i++) {
          if (!world) world = await T.call("Page.createIsolatedWorld", { frameId: child.frame.id, worldName: "e2e-stranger" });
          try {
            const r = await T.call("Runtime.evaluate", { expression: expr, contextId: world.executionContextId, awaitPromise: true, returnByValue: true });
            if (r.exceptionDetails) throw new Error("in the frame: " + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
            return r.result.value;
          } catch (e) {
            if (i || !/Cannot find context/.test(e.message)) throw e;
            world = null;
          }
        }
        return undefined;
      };
      await T.eval("(() => { const w = " + APP + "; w.__opens = 0; w.__states = []; w.addEventListener('message', (e) => { if (!e.data) return;" +
        " if (e.data.type === 'ptt-open') w.__opens++; if (e.data.type === 'ptt-save-state' && e.source === w.parent) w.__states.push({ req: e.data.req, state: e.data.state, pct: e.data.pct, name: e.data.name }); }); return true; })()");
      await T.eval("window.postMessage({ type: 'ptt-ready', v: 1, nonce: " + JSON.stringify(word) + " }, location.origin); true");
      await inFrame("window.parent.postMessage({ type: 'ptt-ready', v: 1, nonce: 'Zk3pQ9_x-7LmN2aBcD4e' }, location.origin); true");
      await sleep(800);
      check("tablet: a ready from the page itself, or with another word, is never answered (one plan, once)", (await T.eval(APP + ".__opens")) === 0);
      if (SHOTS !== "none") {
        await T.call("Page.bringToFront").catch(() => null);
        const took = await Promise.race([T.shot("plans_frame_real_open_tablet.png"), sleep(25000).then(() => null)]);
        if (took) shots.push(took);
      }
      // (ii) a real edit (the app's own undoable step), then Close asks first and Cancel keeps it open
      await T.eval("(() => { const p = " + APP + ".TakeoffApp.app.project; p.transact('e2e: a made-up client', () => { p.metadata.client_name = 'Made-up client (e2e)'; }); return p.dirty; })()");
      await T.eval("document.getElementById('ptfClose').click(); true");
      await T.until("!!document.querySelector('#dcrModalHost .dcr-mo-t')", 5000);
      const ask = await T.eval("({ title: document.querySelector('#dcrModalHost .dcr-mo-t').textContent, yes: document.getElementById('dcrMoYes').textContent })");
      await T.eval("document.getElementById('dcrMoNo').click(); true");
      await sleep(300);
      check("tablet (ii): with an unsaved edit in the app, Close asks first; Cancel keeps the app open", ask.title === "Close the takeoff app?" &&
        ask.yes === "Close without saving" && (await T.eval("!!document.querySelector('#ptfShell.open #ptfFrame') && " + APP + ".TakeoffApp.app.project.dirty === true")), JSON.stringify(ask));
      // (iii) the app's own Save (its File › Save button): "Saving to the portal…" -> kept -> saved -> sent
      await T.eval("(() => { const w = " + APP + "; w.__bar = []; w.__status = []; const d = w.document; const watch = (id, to) => new w.MutationObserver(() => to.push(d.getElementById(id).textContent))" +
        ".observe(d.getElementById(id), { childList: true, characterData: true, subtree: true }); watch('progressLabel', w.__bar); watch('statusText', w.__status); return true; })()");
      await T.eval("window.__ops = []; true");
      // a ptt-save from the page itself (this site, the word - but not the frame's window) is never heard
      await T.eval("window.postMessage({ type: 'ptt-save', v: 1, nonce: " + JSON.stringify(word) + ", req: 'sPAGE00000', name: 'x.takeoff', size: 9," +
        " file: new Blob(['PDFCACHE1']) }, location.origin); true");
      await T.eval(APP + ".document.querySelector('button[data-act=\"save\"]').click(); true");
      await T.until(APP + ".__states.some(s => s.state === 'sent' || s.state === 'copy' || s.state === 'failed' || s.state === 'refused')", 30000);
      await sleep(500);
      const s1 = await T.eval("(() => { const w = " + APP + "; return { states: w.__states, bar: w.__bar, status: w.__status, dirty: w.TakeoffApp.app.project.dirty," +
        " now: w.document.getElementById('statusText').textContent }; })()");
      const words = s1.states.map((x) => x.state);
      const req = (s1.states[0] || {}).req;
      check("tablet (iii): the app's Save goes to the portal - 'Saving to the portal…' on its bar while the portal keeps it ('keeping'), then 'kept', then the send's news, 'sent'",
        s1.bar.some((t) => /^Saving to the portal…/.test(t)) && words.indexOf("keeping") !== -1 && words.indexOf("keeping") < words.indexOf("kept") &&
        words[words.length - 1] === "sent" && s1.states.every((x) => x.req === req), JSON.stringify({ words, bar: s1.bar.slice(0, 6) }));
      check("tablet: a ptt-save from the page itself is never heard (nothing said about it to the frame)", s1.states.every((x) => x.req !== "sPAGE00000") &&
        (await T.eval("window.__heard")).filter((h) => h.type === "ptt-save" && h.fromFrame).length === 1, JSON.stringify(s1.states));
      check("tablet (iii): the app marked the project saved once the portal kept it, and its status line says it was sent",
        s1.dirty === false && s1.status.some((t) => /the portal sends it to OneDrive/.test(t)) && /^The portal sent .+ to OneDrive\.$/.test(s1.now), JSON.stringify({ status: s1.status, now: s1.now }));
      const r1 = (await records(T)).find((r) => r.itemId === fx.id);
      const ops1 = await T.eval("window.__ops");
      check("tablet (iii): sent with one session and its check - no plan_link, no download", ops1.indexOf("plan_save_session") !== -1 && ops1.indexOf("plan_save_done") !== -1 &&
        ops1.indexOf("plan_link") === -1, JSON.stringify(ops1));
      const same1 = await T.eval("(async () => { const L = await import('/js/plan-library.js'); const f = await (await (await (await navigator.storage.getDirectory())" +
        ".getDirectoryHandle('plan-library')).getFileHandle(" + JSON.stringify(r1 ? r1.file : "x") + ")).getFile();" +
        " const sent = window.__saveFiles[window.__saveFiles.length - 1]; const od = DCR2Demo.engine.exts.find(x => x.name === 'p7-onedrive').planBlobOf(" + JSON.stringify(fx.id) + ");" +
        " const b = async (x) => new Uint8Array(await x.arrayBuffer()); const [a, s, o] = [await b(f), await b(sent), await b(od)];" +
        " const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);" +
        " const { openProject } = await import('/takeoff/js/core/takeoff-file.js'); const meta = (await openProject(f)).metadata;" +
        " return { size: a.length, appSaved: eq(a, s), inOneDrive: eq(a, o), client: meta.client_name, project: meta.project_name, L: typeof L.checkUpdates }; })()");
      check("tablet (iii): the record now holds the saved bytes - exactly what the app saved, exactly what OneDrive got, the edit in them; no save waiting, a new version",
        !!r1 && !r1.local && r1.sent && r1.sent.mode === "replace" && r1.file !== saved[0].file && /^sm:/.test(r1.version) && r1.adopted && r1.adopted.file === r1.file &&
        same1.appSaved && same1.inOneDrive && same1.size === r1.size && same1.client === "Made-up client (e2e)", JSON.stringify({ r1, same1 }));
      check("tablet (iii): the frame's bar says it is in OneDrive", /in OneDrive/.test(await T.eval("document.getElementById('ptfSay').textContent")));
      if (SHOTS !== "none") {
        await T.call("Page.bringToFront").catch(() => null);
        const took = await Promise.race([T.shot("plans_frame_tablet.png"), sleep(25000).then(() => null)]);
        if (took) shots.push(took);
      }
      // a later check (the Plans Library's Check now, here in the page): OneDrive's hash of the same bytes is taken as the
      // version - no plan_link, nothing downloaded
      await T.eval("window.__ops = []; true");
      const chk = await T.eval("(async () => { const L = await import('/js/plan-library.js'); const s = await L.checkUpdates(); await L.clearHolds(); await L.autoWork(); return s; })()");
      const r2 = (await records(T)).find((r) => r.itemId === fx.id);
      const ops2 = await T.eval("window.__ops");
      check("tablet (iii): a later check takes OneDrive's hash of the saved bytes as the version, and needs no plan_link",
        !!r2 && /^qx:demo-saved-/.test(r2.version) && !r2.expect && r2.file === r1.file && ops2.indexOf("plan_link") === -1 && ops2.indexOf("plans_list") !== -1,
        JSON.stringify({ chk, ops2, version: r2 && r2.version }));
      // (iv) the office saves the plan; the next Save of this opening becomes a separate file - said in the portal and the app
      const office = await T.eval("DCR2Demo.engine.exts.find(x => x.name === 'p7-onedrive').officeSave(" + JSON.stringify(fx.full) + ")");
      await T.eval("(() => { const p = " + APP + ".TakeoffApp.app.project; p.transact('e2e: a second edit', () => { p.metadata.client_name = 'Made-up client (e2e), second edit'; });" +
        " const w = " + APP + "; w.__states.length = 0; w.__status.length = 0; return true; })()");
      await T.eval("window.__ops = []; true");
      await T.eval(APP + ".document.querySelector('button[data-act=\"save\"]').click(); true");
      await T.until(APP + ".__states.some(s => s.state === 'sent' || s.state === 'copy' || s.state === 'failed' || s.state === 'refused')", 30000);
      await sleep(500);
      const s2 = await T.eval("(() => { const w = " + APP + "; return { states: w.__states, status: w.document.getElementById('statusText').textContent, dirty: w.TakeoffApp.app.project.dirty }; })()");
      const copyWord = s2.states.find((x) => x.state === "copy");
      const bar2 = await T.eval("document.getElementById('ptfSay').textContent");
      check("tablet (iv): the plan changed in OneDrive before the send - the save went as a separate file (mode copy), and both the portal and the app say so",
        !!office && !!copyWord && /^A267 .+ - iPad \d{4}-\d{2}-\d{2} \d{4}\.takeoff$/.test(copyWord.name || "") && s2.dirty === false &&
        /Someone saved this plan in the office after your iPad got it\. Your work was saved as '.+' next to it - nothing was overwritten\./.test(bar2) &&
        /^Someone saved this plan in the office after this iPad got it\. Your work was saved as “.+” next to it — nothing was overwritten\.$/.test(s2.status),
        JSON.stringify({ office, states: s2.states, bar2, status: s2.status }));
      const after = await records(T);
      const planRec = after.find((r) => r.itemId === fx.id);
      const copyRec = after.find((r) => r.name === (copyWord && copyWord.name));
      check("tablet (iv): the plan's record keeps the plan (nothing overwritten); the copy has a record of its own holding the saved bytes",
        !!planRec && planRec.file === r1.file && !planRec.local && planRec.sent && planRec.sent.mode === "copy" && !!copyRec && copyRec.file && !copyRec.local,
        JSON.stringify(after.map((r) => ({ itemId: r.itemId, name: r.name, file: r.file, version: r.version, sent: r.sent && r.sent.mode }))));
      if (SHOTS !== "none") {
        await T.call("Page.bringToFront").catch(() => null);
        const took = await Promise.race([T.shot("plans_frame_copy_tablet.png"), sleep(25000).then(() => null)]);
        if (took) shots.push(took);
      }
      // Close: nothing unsaved in the app -> at once; the page under it comes back, and the menu says what became of it
      await T.eval("document.getElementById('ptfClose').click(); true");
      await T.until("!document.querySelector('#ptfShell.open') && !document.getElementById('ptfFrame')", 5000);
      const back = await T.eval("({ inert: !!document.getElementById('dcr2Topbar').inert, overflow: document.body.style.overflow, menu: !!document.querySelector('.pl-sheet') })");
      check("tablet: Close with nothing unsaved closes at once, and the page (and the menu) come back", !back.inert && back.overflow === "" && back.menu, JSON.stringify(back));
      await T.until("/Saved as a separate file/.test(document.querySelector('.pl-sheet .pl-list').innerText)", 5000).catch(() => null);
      const rowText = await T.eval("document.querySelector('.pl-sheet .pl-list').innerText");
      check("tablet: the 📐 menu's row says the save became a separate file", /Saved as a separate file/.test(rowText), rowText);
      if (SHOTS !== "none") {
        await T.call("Page.bringToFront").catch(() => null);
        const took = await Promise.race([T.shot("plans_menu_copy_tablet.png"), sleep(25000).then(() => null)]);
        if (took) shots.push(took);
      }
      check("tablet: no dialog of the browser's own was opened by the app or the portal", !T.dialogs.length, JSON.stringify(T.dialogs));
    }, T);

    /* ── 4c. a person with prices but WITHOUT "Can upload to OneDrive" (Q2): the real app opens without canSave, and its
       Save stays on the device (the share sheet or a download) - nothing is handed to the portal or sent ── */
    const TA = await newPage(cdp, "tablet-accountant", OUT); pages.push(TA);
    answerDialogs(TA);
    // the frame as Safari on an iPad has it: no File System Access (Chrome's pickers would take the Save there instead)
    await TA.call("Page.addScriptToEvaluateOnNewDocument", { source: "if (location.pathname.indexOf('/takeoff/') === 0) { for (const k of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) { try { delete window[k]; } catch (e) { /* */ } } }" });
    await attempt("a tablet, prices without the upload switch: the real app opens without canSave; Save goes to the share sheet, nothing is sent", async () => {
      await TA.call("Emulation.setUserAgentOverride", { userAgent: TABLET_UA, platform: "MacIntel" });
      await TA.size(1024, 768, true);
      await signIn(TA, "accountant", "dashboard.html");
      const me = await TA.eval("(async () => { const sb = await import('/js/sb.js'); const P = await import('/js/map/plans.js'); const p = await sb.me(); return { prices: P.planFilesFor(p), save: P.saveBackFor(p) }; })()").catch((e) => ({ error: e.message }));
      await openReal(TA);
      const fx = await putFixture(TA, "A267", "A267 made-up plan (e2e, accountant)");
      await TA.eval("document.querySelector('#pjPlans a[data-plan-menu]').click(); true");
      await TA.until("!!document.querySelector('.pl-sheet [data-pl-act=\"open\"][data-id=" + JSON.stringify(fx.id) + "]')", 10000);
      await TA.eval("window.__heard = []; window.addEventListener('message', (e) => window.__heard.push(e.data && e.data.type)); true");
      await watchOps(TA);
      await TA.eval("document.querySelector('.pl-sheet [data-pl-act=\"open\"][data-id=" + JSON.stringify(fx.id) + "]').click(); true");
      await TA.until("(() => { try { const t = " + APP + ".TakeoffApp; return !!(t && t.app.portal && t.app.project.pageCount === 2); } catch (e) { return false; } })()", 30000);
      const app = await TA.eval("(() => { const t = " + APP + ".TakeoffApp; return { canSave: t.app.portal.canSave, kind: t.app.portal.kind }; })()");
      check("tablet, no upload switch (v): the real app got the plan as a file WITHOUT canSave", app.kind === "file" && app.canSave === false &&
        (!me || me.error || (me.prices === true && me.save === false)), JSON.stringify({ app, me }));
      // the share sheet stands in for the device's own (headless Chrome has none): what the app hands it is noted
      await TA.eval("(() => { const w = " + APP + "; w.__shared = []; w.navigator.canShare = () => true; w.navigator.share = (d) => { w.__shared.push((d.files || []).map(f => ({ name: f.name, size: f.size })));" +
        " return Promise.resolve(); }; const p = w.TakeoffApp.app.project; p.transact('e2e: an edit', () => { p.metadata.client_name = 'Made-up client (no upload)'; }); return true; })()");
      await TA.eval("window.__ops = []; true");
      await TA.eval(APP + ".document.querySelector('button[data-act=\"save\"]').click(); true");
      // the app may ask first (a dialog of its own, a div): its button that shares or saves is pressed
      for (let i = 0; i < 20; i++) {
        const done = await TA.eval("(() => { const w = " + APP + "; if (w.__shared.length) return 'shared'; const d = w.document;" +
          " const b = Array.from(d.querySelectorAll('button')).find(x => x.offsetParent !== null && /^(Share|Save a copy|Save to Files|Save|OK|Continue)\\b/i.test(x.textContent.trim()) && x.closest('.dlg, .dialog, [role=dialog], .modal, .sheet'));" +
          " if (b) { b.click(); return 'clicked ' + b.textContent.trim(); } return ''; })()");
        if (done === "shared") break;
        await sleep(300);
      }
      await sleep(800);
      const out = await TA.eval("(() => { const w = " + APP + "; return { shared: w.__shared, status: w.document.getElementById('statusText').textContent }; })()");
      const heardSave = (await TA.eval("window.__heard")).filter((t) => t === "ptt-save").length;
      const ops = await TA.eval("window.__ops");
      const who = await TA.eval("(async () => (await import('/js/plan-library.js')).owner())()");
      const recs = (await records(TA)).filter((r) => r.itemId === fx.id && r.key.split("|")[0] === who);     // (a shared tablet: the admin's too)
      check("tablet, no upload switch (v): Save went to the share sheet (the project file), nothing was handed to the portal or sent to OneDrive",
        out.shared.length === 1 && out.shared[0].length === 1 && /\.takeoff$/.test(out.shared[0][0].name) && out.shared[0][0].size > 1000 &&
        heardSave === 0 && ops.indexOf("plan_save_session") === -1 && recs.length === 1 && !recs[0].local, JSON.stringify({ out, heardSave, ops, recs }));
      await TA.eval("(() => { const p = " + APP + ".TakeoffApp.app.project; return p.dirty; })()");
      if (SHOTS !== "none") {
        await TA.call("Page.bringToFront").catch(() => null);
        const took = await Promise.race([TA.shot("plans_frame_noupload_tablet.png"), sleep(25000).then(() => null)]);
        if (took) shots.push(took);
      }
      check("tablet, no upload switch: no dialog of the browser's own", !TA.dialogs.length, JSON.stringify(TA.dialogs));
    }, TA);
    const TF = await newPage(cdp, "tablet-field", OUT); pages.push(TF);
    await attempt("a tablet without prices: 📐 says 'Plans are for the people who see prices' (no dead end, nothing asked of the broker)", async () => {
      await TF.call("Emulation.setUserAgentOverride", { userAgent: TABLET_UA, platform: "MacIntel" });
      await TF.size(1024, 768, true);
      await signIn(TF, "field", "dashboard.html");
      await TF.goto(base + "/project.html?id=" + J.sandbox, 400);
      await TF.until("!!document.querySelector('#pjPlans:not([hidden]) a[data-plan-none]')", 10000);
      await TF.eval("(() => { const c = DCR2Demo.engine; const inv = c.invoke; window.__lists = 0; c.invoke = function (ctx, name, body) {" +
        " if (name === 'onedrive' && body && (body.op === 'plans_list' || body.op === 'plan_link')) window.__lists++; return inv.apply(this, arguments); }; return true; })()");
      await TF.eval("document.querySelector('#pjPlans a[data-plan-none]').click(); true");
      await TF.until("!!document.querySelector('.pl-sheet .pl-lead')", 5000);
      const text = await TF.eval("document.querySelector('.pl-sheet').innerText");
      check("tablet, no prices: the plain sentence, no list, no Plans Archive", /Plans are for the people who see prices/.test(text) && !/Plans Archive|Open/.test(text), text);
      check("tablet, no prices: no plans_list or plan_link asked", (await TF.eval("window.__lists")) === 0);
      await TF.eval("document.querySelector('.pl-sheet .pl-x').click(); true");
    }, TF);

    /* ── 5. no security-policy violation, no console error ─────────────── */
    for (const p of pages) {
      const bad = p.log.filter((x) => /CSP-VIOLATION|Content Security Policy/i.test(x.text) || x.level === "exception" ||
        (x.level === "error" && !/favicon\.ico|net::ERR_ABORTED/.test(x.text + " " + (x.url || ""))));
      check(p.name + ": no CSP violation, no console error", !bad.length, bad.slice(0, 5).map((x) => x.level + " " + x.text.slice(0, 200) + " @ " + x.url).join(" | "));
    }
  } finally {
    try { proc.kill(); } catch (e) { /* */ }
    server.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results: failed, shots: shots.length, out: OUT }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
