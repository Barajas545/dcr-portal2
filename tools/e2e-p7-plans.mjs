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
     "keeping" -> "kept" -> the app marks the project saved -> the demo's OneDrive gets it as DCR Desktop 2's broker
     takes a replace since the review round (contract addendum 2): plan_save_session with the plan's name, every chunk
     202, plan_save_commit with the session's own address and the save's quickXorHash -> "sent" on the app's status
     line; the record holds exactly the bytes the app saved and OneDrive got, the edit in them (no plan_link, no
     download), and a later check takes OneDrive's REAL hash of them with no plan_link; a ptt-save from the page itself
     is never heard; (iv) the office saves the plan (officeSave), and the next Save of the same opening becomes a
     separate file: said on the frame's bar and on the app's status line, the plan's record untouched, the copy a record
     of its own; the menu's row says so after Close; (viii) a second opening on that page (the portal's dialog host made
     already): Close's question answered by real taps, and the app's own TakeoffApp.saveDraftNow keeps its draft before
     its frame goes. (ix) the review round's walks, each on a plan of its own: an office save that lands WHILE the save
     goes up -> the same upload becomes a copy, said in the portal and the app, the office's save still the plan; a
     desktop-style save (the old item into Backups, a new one on the name) before the Save -> a copy found by name; a
     byte-identical re-save -> saved, one session and one commit, no loop; two openings of one plan in two tabs -> the
     second Save refused in plain words while the first's kept save waits, which then goes whole; Close while dirty
     during a running send -> the danger question, the send finishes, and the draft survives (the admin's reopen offers
     it); and the per-person word: a second price person on the same tablet is not offered the first's draft; the second
     opening's refusal (contract addendum 3 D7) promises nothing, and the plan reopened - the first opening's save by then -
     offers its work back as an earlier version's. (x) the repair round's walks (contract addendum 3): the broker's switch
     (the demo's localStorage "dcr2-demo-plan-save") off - no Save to OneDrive offered, the app's Save goes to the share
     sheet - and "only:A267" - offered on A267's plans only, never on A024's; OneDrive ignoring the deferral with an office
     save during the upload - the office save stays the plan, the work arrives as a copy with the copy words (the broker
     told landed, the crossing put back); the PUT commit refused - the POST commits it, verified; both refused - a copy in
     neutral words, and the app is never told the office saved. (v) A person with prices but without
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
      " adopted: r.adopted || null, expect: !!r.expect, dl: r.dl || null, saveBack: r.saveBack === true })); })()");
    /** every broker op the page asks from now on (the demo's functions.invoke) */
    const watchOps = (p) => p.eval("(() => { const c = DCR2Demo.engine; if (!c.__opsWatched) { const inv = c.invoke; c.invoke = function (ctx, name, body) {" +
      " const r = inv.apply(this, arguments); if (name === 'onedrive' && body) { window.__ops.push(body.op);" +
      " window.__opsSeen.push({ op: body.op, body: JSON.parse(JSON.stringify(body)), status: r && r.status, data: r && r.data ? JSON.parse(JSON.stringify(r.data)) : null }); }" +
      " return r; }; c.__opsWatched = true; } window.__ops = []; window.__opsSeen = []; return true; })()");
    /** the quickXorHash (site/js/quickxor.js, in the demo's bundle) of a stored or posted Blob, in the page */
    const QXOF = "(async (b) => { const h = new DCR2QuickXor.QuickXorHash(); for (let a = 0; a < b.size; a += 8388608) h.update(new Uint8Array(await b.slice(a, a + 8388608).arrayBuffer())); return h.base64(); })";
    /** a made-up but real takeoff project as the demo's plan of `number` (this page): composed by the copy's own writer */
    const putFixture = (p, number, title, plan) => p.eval("(async () => { const { writeProject } = await import('/takeoff/js/core/takeoff-file.js');" +
      " const sheet = async (label, hue) => { const c = new OffscreenCanvas(1200, 800); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1200, 800);" +
      " g.strokeStyle = 'hsl(' + hue + ' 60% 35%)'; g.lineWidth = 6; g.strokeRect(40, 40, 1120, 720); g.fillStyle = '#111'; g.font = 'bold 40px sans-serif'; g.fillText(label, 70, 110);" +
      " return { kind: 'png', data: new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()) }; };" +
      " const blob = await writeProject({ metadata: { project_name: " + JSON.stringify(title) + ", annotations: {}, measurements: {}, page_labels: ['A1', 'A2'] }," +
      " pageSources: [await sheet('A1 MADE UP', 210), await sheet('A2 MADE UP', 20)] });" +
      " return DCR2Demo.engine.exts.find(x => x.name === 'p7-onedrive').setPlanFixture(" + JSON.stringify(number) + ", blob" + (plan ? ", " + JSON.stringify(plan) : "") + "); })()");
    /** a JS dialog in the walk (the app's or the portal's) is answered at once and noted (never blocks the walk) */
    const answerDialogs = (p) => {
      p.dialogs = [];
      cdp.handlers.add((m) => {
        if (m.sessionId !== p.s || m.method !== "Page.javascriptDialogOpening") return;
        p.dialogs.push(m.params.type + ": " + m.params.message);
        p.call("Page.handleJavaScriptDialog", { accept: false }).catch(() => null);
      });
    };
    /** the takeoff app's drafts on this site (takeoff-web js/core/drafts.js): [{key, client}] */
    const DRAFTS = "(async () => { const d = await new Promise((res, rej) => { const r = indexedDB.open('ptt-drafts'); r.onsuccess = () => res(r.result); r.onerror = rej; });" +
      " if (!d.objectStoreNames.contains('drafts')) { d.close(); return []; } const keys = await new Promise((res) => { const q = d.transaction('drafts').objectStore('drafts').getAllKeys(); q.onsuccess = () => res(q.result); });" +
      " const vals = await new Promise((res) => { const q = d.transaction('drafts').objectStore('drafts').getAll(); q.onsuccess = () => res(q.result); }); d.close();" +
      " return keys.map((k, i) => ({ key: String(k), client: vals[i] && vals[i].payload ? vals[i].payload.client_name || null : null })); })";
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
      const seen1 = await T.eval("window.__opsSeen.filter(x => /^plan_save_/.test(x.op))");
      const sess1 = seen1.find((x) => x.op === "plan_save_session");
      const comm1 = seen1.find((x) => x.op === "plan_save_commit");
      const hash1 = await T.eval("(async () => " + QXOF + "(window.__saveFiles[window.__saveFiles.length - 1]))()");
      check("tablet (iii): sent as the broker takes a replace now - one session (the plan's name with it, commit 'broker'), then the broker's commit with the session's own address and the save's quickXorHash; no plan_save_done, no plan_link",
        JSON.stringify(seen1.map((x) => x.op)) === JSON.stringify(["plan_save_session", "plan_save_commit"]) && ops1.indexOf("plan_link") === -1 &&
        sess1.body.name === fx.name && sess1.data.mode === "replace" && sess1.data.commit === "broker" &&
        comm1.body.upload_url === sess1.data.upload_url && comm1.body.ticket === sess1.data.ticket && comm1.body.hash === hash1 && comm1.data.mode === "replace",
        JSON.stringify({ ops1, sess: sess1 && { name: sess1.body.name, mode: sess1.data && sess1.data.mode, commit: sess1.data && sess1.data.commit },
          commit: comm1 && { same: comm1.body.upload_url === (sess1 && sess1.data.upload_url), hash: comm1.body.hash, mode: comm1.data && comm1.data.mode }, hash1 }));
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
      await T.eval("DCR2Demo.engine.exts.find(x => x.name === 'p7-onedrive').hashed().then(() => true)");
      const chk = await T.eval("(async () => { const L = await import('/js/plan-library.js'); const s = await L.checkUpdates(); await L.clearHolds(); await L.autoWork(); return s; })()");
      const r2 = (await records(T)).find((r) => r.itemId === fx.id);
      const ops2 = await T.eval("window.__ops");
      check("tablet (iii): a later check takes OneDrive's hash of the saved bytes as the version, and needs no plan_link",
        !!r2 && r2.version === "qx:" + hash1 && !r2.expect && r2.file === r1.file && ops2.indexOf("plan_link") === -1 && ops2.indexOf("plans_list") !== -1,
        JSON.stringify({ chk, ops2, version: r2 && r2.version, hash1 }));
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
      // (viii) a second opening on the same page - the portal's dialog host already made by (ii)'s question - and Close
      // answered by TAPS (real input at each button's centre, not .click(), which an inert element still takes): the
      // question takes them, and the app keeps its draft before its frame goes (review FRAME-1 / FRAME-2)
      const tap = async (sel) => {
        const box = await T.eval("(() => { const r = document.querySelector(" + JSON.stringify(sel) + ").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
        await T.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
        await T.call("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
        await T.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
        return box;
      };
      // (the copy's row: the person's own work, a real project - the plan itself now holds the office's made-up bytes)
      await T.eval("document.querySelector('.pl-sheet [data-pl-act=\"open\"][data-id=" + JSON.stringify(copyRec ? copyRec.itemId : "") + "]').click(); true");
      await T.until("(() => { try { const t = " + APP + ".TakeoffApp; return !!(t && t.app.portal && t.app.project.pageCount === 2); } catch (e) { return false; } })()", 30000);
      const hostNow = await T.eval("(() => { const h = document.getElementById('dcrModalHost'); return h ? { there: true, inert: !!h.inert } : { there: false }; })()");
      // takeoff-web's own TakeoffApp.saveDraftNow (contract C2b; the copy has it since b634dd6), watched: when it is called
      // (the frame still there) and what it answered
      await T.eval("(() => { const w = " + APP + "; window.__draft = null; const real = w.TakeoffApp.saveDraftNow;" +
        " window.__draftReal = typeof real === 'function'; w.TakeoffApp.saveDraftNow = async () => { const at = { frameThere: !!document.getElementById('ptfFrame'), dirty: w.TakeoffApp.app.project.dirty };" +
        " const kept = await real(); window.__draft = Object.assign(at, { kept }); return kept; };" +
        " const p = w.TakeoffApp.app.project; p.transact('e2e: an edit before Close', () => { p.metadata.client_name = 'Made-up client (e2e), third edit'; }); return p.dirty; })()");
      await tap("#ptfClose");
      await T.until("!!document.querySelector('#dcrModalHost.open #dcrMoYes')", 5000);
      const ask2 = await T.eval("({ title: document.querySelector('#dcrModalHost .dcr-mo-t').textContent, yes: document.getElementById('dcrMoYes').textContent," +
        " hit: (() => { const b = document.getElementById('dcrMoYes').getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return e ? (e.id || e.tagName) : ''; })() })");
      await tap("#dcrMoYes");
      const closedByTap = await T.until("!document.getElementById('ptfFrame')", 6000).then(() => true, () => false);
      const draft = await T.eval("window.__draft");
      check("tablet (viii): a second opening on the same page - Close's question takes taps (the portal's dialog host is never made inert), and the frame closes",
        hostNow.there && !hostNow.inert && ask2.title === "Close the takeoff app?" && ask2.yes === "Close without saving" && ask2.hit === "dcrMoYes" && closedByTap,
        JSON.stringify({ hostNow, ask2, closedByTap }));
      const drafts8 = await T.eval(DRAFTS + "()");
      check("tablet (viii): before its frame goes, the app keeps its draft - its own TakeoffApp.saveDraftNow, waited for: the draft is in its store, with the edit",
        (await T.eval("window.__draftReal")) === true && !!draft && draft.frameThere === true && draft.dirty === true && draft.kept === true &&
        drafts8.some((d) => d.client === "Made-up client (e2e), third edit"), JSON.stringify({ draft, drafts8 }));
      if (!closedByTap) await T.eval("(() => { const m = document.querySelector('#dcrModalHost.open #dcrMoNo'); if (m) m.click(); return true; })()");
      check("tablet: no dialog of the browser's own was opened by the app or the portal", !T.dialogs.length, JSON.stringify(T.dialogs));
    }, T);

    /* ── 4d (ix). the review round's walks (contract addendum 2; review Q3-1, Q3-2, BRK-1, BRK-4, BRK-5, LW-1, FRAME-1,
       PRICE-4) with the REAL app on the same shared tablet, each on a plan of A267 of its own (a made-up real .takeoff):
       an office save WHILE the save goes up; a desktop save before it; an identical re-save; two openings in two tabs;
       Close while dirty during a running send; and the per-person word on the drafts ── */
    const OD = "DCR2Demo.engine.exts.find(x => x.name === 'p7-onedrive')";
    const shotOf = async (p, file) => {
      if (SHOTS === "none") return;
      await p.call("Page.bringToFront").catch(() => null);
      const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
      if (took) shots.push(took);
    };
    /** the page hears the frame's ptt-saves (their Files kept to compare) */
    const hearSaves = (p) => p.eval("(() => { if (window.__hearing) return true; window.__hearing = true; window.__saveFiles = window.__saveFiles || [];" +
      " window.addEventListener('message', (e) => { const f = document.getElementById('ptfFrame'); if (f && e.source === f.contentWindow && e.data && e.data.type === 'ptt-save') window.__saveFiles.push(e.data.file); }); return true; })()");
    const APP_READY = "(() => { try { const t = " + APP + ".TakeoffApp; return !!(t && t.app.portal && t.app.project.pageCount === 2); } catch (e) { return false; } })()";
    const DRAFT_ASKED = "(() => { try { const h = " + APP + ".document.querySelector('.dlg-head'); return !!h && h.textContent === 'Unsaved work found'; } catch (e) { return false; } })()";
    /** the plan `id` opened from the project page's 📐 menu (opened afresh) in the frame; the app's news and status watched.
        `ready`: what to wait for (the app with the plan, by default) */
    async function openPlan(p, id, ready) {
      await p.eval("(() => { const x = document.querySelector('.pl-sheet .pl-x'); if (x) x.click(); return true; })()");
      await sleep(300);
      await p.eval("document.querySelector('#pjPlans a[data-plan-menu]').click(); true");
      await p.until("!!document.querySelector('.pl-sheet [data-pl-act=\"open\"][data-id=" + JSON.stringify(id) + "]')", 10000);
      await p.eval("document.querySelector('.pl-sheet [data-pl-act=\"open\"][data-id=" + JSON.stringify(id) + "]').click(); true");
      await p.until(ready || APP_READY, 30000);
      await p.eval("(() => { const w = " + APP + "; w.__states = []; w.__status = []; w.addEventListener('message', (e) => { if (e.data && e.data.type === 'ptt-save-state' && e.source === w.parent)" +
        " w.__states.push({ req: e.data.req, state: e.data.state, pct: e.data.pct, name: e.data.name, why: e.data.why }); });" +
        " new w.MutationObserver(() => w.__status.push(w.document.getElementById('statusText').textContent)).observe(w.document.getElementById('statusText'), { childList: true, characterData: true, subtree: true }); return true; })()");
    }
    const editApp = (p, client) => p.eval("(() => { const q = " + APP + ".TakeoffApp.app.project; q.transact('e2e: an edit', () => { q.metadata.client_name = " + JSON.stringify(client) + "; }); return q.dirty; })()");
    /** the app's own File › Save -> {states, status, dirty} once one of `ends` came (sent, copy, failed, refused by default) */
    async function saveApp(p, ends) {
      const e = JSON.stringify(ends || ["sent", "copy", "failed", "refused", "no-room"]);
      await p.eval("(() => { const w = " + APP + "; w.__states.length = 0; w.__status.length = 0; return true; })()");
      await p.eval(APP + ".document.querySelector('button[data-act=\"save\"]').click(); true");
      await p.until(APP + ".__states.some(s => " + e + ".indexOf(s.state) !== -1)", 60000);
      await sleep(500);
      return p.eval("(() => { const w = " + APP + "; return { states: w.__states, status: w.document.getElementById('statusText').textContent, dirty: w.TakeoffApp.app.project.dirty }; })()");
    }
    /** the frame's ✕ Close, and "Close without saving" when it asks */
    async function closeFrame(p) {
      if (!(await p.eval("!!document.getElementById('ptfFrame')"))) return;
      await p.eval("document.getElementById('ptfClose').click(); true");
      await p.until("!!document.querySelector('#dcrModalHost.open #dcrMoYes') || !document.getElementById('ptfFrame')", 6000).catch(() => null);
      if (await p.eval("!!document.querySelector('#dcrModalHost.open #dcrMoYes')")) await p.eval("document.getElementById('dcrMoYes').click(); true");
      await p.until("!document.getElementById('ptfFrame')", 8000);
    }
    const lastSaveSame = (p, other) => p.eval("(async () => { const f = window.__saveFiles; const b = async (x) => new Uint8Array(await x.arrayBuffer()); const eq = (x, y) => !!x && !!y && x.length === y.length && x.every((v, i) => v === y[i]);" +
      " const s = await b(f[f.length - 1]); const o = " + other + "; return o ? eq(s, await b(o)) : false; })()");
    const planOps = (p) => p.eval("window.__opsSeen.filter(x => /^plan_save_/.test(x.op)).map(x => ({ op: x.op, item: x.body.item_id, name: x.body.name, bodyMode: x.body.mode," +
      " hash: x.body.hash || null, url: x.body.upload_url || null, status: x.status, mode: x.data && x.data.mode, commit: x.data && x.data.commit, upload: x.data && x.data.upload_url || null, id: x.data && x.data.id, answerName: x.data && x.data.name," +
      " landed: x.body.landed === true, verified: x.data ? x.data.verified : undefined, error: x.data && x.data.error, why: x.data && x.data.why }))");
    const COPY_BAR = /Someone saved this plan in the office after your iPad got it\. Your work was saved as '.+' next to it - nothing was overwritten\./;
    const COPY_APP = /^Someone saved this plan in the office after this iPad got it\. Your work was saved as “.+” next to it — nothing was overwritten\.$/;
    const plansNow = (p) => p.eval("(async () => { const od = await import('/js/repo/onedrive.js'); return ((await od.plansList([" + J.sandbox + "]))[" + JSON.stringify(String(J.sandbox)) + "] || { files: [] }).files; })()");
    /** a tap: real input at the element's centre */
    const tapOn = async (p, sel) => {
      const box = await p.eval("(() => { const r = document.querySelector(" + JSON.stringify(sel) + ").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await p.call("Input.dispatchMouseEvent", Object.assign({ type, x: box.x, y: box.y }, type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }));
    };
    const whoOf = (p) => p.eval("(async () => { const L = await import('/js/plan-library.js'); const P = await import('/js/map/plans.js'); return P.whoWord(L.owner()); })()");

    await attempt("a tablet, the review round's walks (ix): office save during the upload, desktop save, identical re-save, two openings, Close during a send, the per-person drafts", async () => {
      await closeFrame(T);
      await openReal(T);
      await hearSaves(T);
      await watchOps(T);

      // (ix-a) the office saves the plan WHILE the iPad's replace goes up: the broker commits the SAME upload as a copy beside
      // it (review Q3-2, BRK-1) - said in the portal and the app; the office's save is still the plan
      const fa = await putFixture(T, "A267", "A267 Rev 2 made-up plan (e2e)", "A267 Rev 2.takeoff");
      await openPlan(T, fa.id);
      await editApp(T, "Made-up client (e2e, office during the upload)");
      await T.eval(OD + ".duringUpload(" + JSON.stringify(fa.full) + ", 'office'); window.__ops = []; window.__opsSeen = []; true");
      const sa = await saveApp(T);
      const ca = sa.states.find((x) => x.state === "copy");
      const opsA = await planOps(T);
      const commitA = opsA.find((x) => x.op === "plan_save_commit");
      const bytesA = await T.eval("(async () => { const ext = " + OD + "; const sent = window.__saveFiles[window.__saveFiles.length - 1]; const b = async (x) => new Uint8Array(await x.arrayBuffer());" +
        " const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]); const s = await b(sent); const c = ext.planBlobOf(" + JSON.stringify((commitA && commitA.id) || "") + ");" +
        " return { copyIsSave: !!c && eq(s, await b(c)), planIsSave: eq(s, await b(ext.planBlobOf(" + JSON.stringify(fa.id) + "))) }; })()");
      const barA = await T.eval("document.getElementById('ptfSay').textContent");
      check("tablet (ix-a): an office save landing WHILE the save went up - the broker committed the same upload as a copy (one session, its commit), the office's save still the plan",
        !!ca && /^A267 Rev 2 - iPad \d{4}-\d{2}-\d{2} \d{4}\.takeoff$/.test(ca.name || "") && sa.dirty === false &&
        JSON.stringify(opsA.map((x) => [x.op, x.mode])) === JSON.stringify([["plan_save_session", "replace"], ["plan_save_commit", "copy"]]) &&
        opsA[0].commit === "broker" && bytesA.copyIsSave && !bytesA.planIsSave, JSON.stringify({ states: sa.states, opsA, bytesA }));
      check("tablet (ix-a): ...and both the portal and the app say so (nothing was overwritten)", COPY_BAR.test(barA) && COPY_APP.test(sa.status), JSON.stringify({ barA, status: sa.status }));
      await shotOf(T, "plans_frame_during_copy_tablet.png");
      await closeFrame(T);

      // (ix-b) the office's DESKTOP app saved the plan while the iPad had it open (the old item moved into Backups, a new
      // item on the name): the session names the plan, the broker finds it by name - a copy beside it (review Q3-1, BRK-4)
      const fb = await putFixture(T, "A267", "L1 walls - made-up plan (e2e)", "L1 walls.takeoff");
      await openPlan(T, fb.id);
      await editApp(T, "Made-up client (e2e, after a desktop save)");
      const dk = await T.eval(OD + ".desktopSave(" + JSON.stringify(fb.full) + ")");
      await T.eval("window.__ops = []; window.__opsSeen = []; true");
      const sb = await saveApp(T);
      const cb = sb.states.find((x) => x.state === "copy");
      const opsB = await planOps(T);
      const listedB = await plansNow(T);
      const barB = await T.eval("document.getElementById('ptfSay').textContent");
      check("tablet (ix-b): a desktop-style save (a new item on the name) - the save went as a copy beside the plan, found by its name; never a 404 left on the device",
        !!dk && !!cb && /^L1 walls - iPad \d{4}-\d{2}-\d{2} \d{4}\.takeoff$/.test(cb.name || "") &&
        JSON.stringify(opsB.map((x) => [x.op, x.mode])) === JSON.stringify([["plan_save_session", "copy"], ["plan_save_done", "copy"]]) &&
        opsB[0].item === fb.id && opsB[0].name === fb.name && !!opsB[1].hash &&
        !listedB.some((f) => f.id === fb.id) && listedB.some((f) => f.id === dk.id && f.name === fb.name && f.version === dk.version) &&
        listedB.some((f) => f.name === cb.name) && COPY_BAR.test(barB) && COPY_APP.test(sb.status), JSON.stringify({ dk, states: sb.states, opsB, status: sb.status }));

      // (ix-c) Save again with nothing changed (the same opening: now on its copy): byte-identical saves are saved - one
      // session and the broker's commit, never not_saved, never sent again and again (review BRK-5)
      let pair = null;
      for (let i = 0; i < 3 && !pair; i++) {
        await T.eval("window.__ops = []; window.__opsSeen = []; true");
        const r = await saveApp(T);
        if (await lastSaveSame(T, "f[f.length - 2]")) pair = { r, ops: await planOps(T) };
      }
      await T.eval(OD + ".hashed().then(() => true)");
      const copyNow = pair ? (await plansNow(T)).find((f) => f.name === cb.name) : null;
      const hashC = await T.eval("(async () => " + QXOF + "(window.__saveFiles[window.__saveFiles.length - 1]))()");
      check("tablet (ix-c): a byte-identical re-save is saved - a replace committed by the broker, its version OneDrive's hash of those same bytes; no not_saved, no second upload",
        !!pair && pair.r.states[pair.r.states.length - 1].state === "sent" && !pair.r.states.some((x) => x.state === "failed") &&
        JSON.stringify(pair.ops.map((x) => [x.op, x.mode])) === JSON.stringify([["plan_save_session", "replace"], ["plan_save_commit", "replace"]]) &&
        !!copyNow && copyNow.version === "qx:" + hashC, JSON.stringify({ pair, copyNow, hashC }));
      await closeFrame(T);

      // (ix-d) two openings of one plan, two tabs of this tablet (review LW-1): the first's Save is kept here (no signal: it
      // waits), the second's is refused in plain words - its app keeps its work - and the first's save is intact, then sent
      const fc = await putFixture(T, "A267", "A267 Rev 2 - two openings of one plan (e2e, made up)", "A267 Rev 2.takeoff");
      const b64 = await T.eval("(async () => { const u = new Uint8Array(await " + OD + ".planBlobOf(" + JSON.stringify(fc.id) + ").arrayBuffer()); let s = '';" +
        " for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); })()");
      const T2 = await newPage(cdp, "tablet-admin-2", OUT); pages.push(T2);
      answerDialogs(T2);
      await T2.call("Emulation.setUserAgentOverride", { userAgent: TABLET_UA, platform: "MacIntel" });
      await T2.size(1024, 768, true);
      await signIn(T2, "admin", "dashboard.html");
      await openReal(T2);
      await watchOps(T2);
      // the demo's OneDrive is this tab's own: the same made-up plan file there too
      await T2.eval("(() => { const u = Uint8Array.from(atob(" + JSON.stringify(b64) + "), (c) => c.charCodeAt(0)); return " + OD + ".setPlanFixture('A267', new Blob([u]), 'A267 Rev 2.takeoff'); })()");
      await hearSaves(T2);
      await openPlan(T, fc.id);
      await openPlan(T2, fc.id);
      // the first opening's save goes to OneDrive slowly (a big plan on a slow line): it waits on this tablet meanwhile
      await T.eval("DCR2Demo.setUploadDelay(15000); window.__ops = []; true");
      let firstFile = null;
      try {
        await editApp(T, "Made-up client (e2e, the first opening)");
        const s1 = await saveApp(T, ["kept", "refused", "failed", "no-room"]);
        await T.until("window.__ops.indexOf('plan_save_session') !== -1", 10000);
        const rec1 = (await records(T)).find((r) => r.itemId === fc.id);
        firstFile = rec1 && rec1.local ? rec1.local.file : null;
        check("tablet (ix-d): the first opening's Save is kept on the tablet, and is on its way to OneDrive", s1.states.some((x) => x.state === "kept") && !!firstFile &&
          rec1.local.state === "sending", JSON.stringify({ states: s1.states, local: rec1 && rec1.local }));
        await editApp(T2, "Made-up client (e2e, the second opening, whose save the portal will not take)");
        const s2 = await saveApp(T2, ["kept", "refused", "failed", "no-room"]);
        const ref = s2.states.find((x) => x.state === "refused");
        const said2 = await T2.eval(APP + ".document.body.innerText");
        const rec2 = (await records(T2)).find((r) => r.itemId === fc.id);
        check("tablet (ix-d): the second opening's Save is refused in plain words - its app keeps its work and says it was not saved - and the first's save is still the one waiting",
          !!ref && /another window or tab on this iPad that is not in OneDrive yet/.test(ref.why || "") && /Not saved: the portal did not take this save \(/.test(said2) && !/offers? (them|it) back/.test(said2) &&
          s2.dirty === true && !!rec2 && rec2.local && rec2.local.file === firstFile, JSON.stringify({ states: s2.states, dirty: s2.dirty, local: rec2 && rec2.local && rec2.local.file, firstFile }));
        await shotOf(T2, "plans_frame_refused_tablet.png");
        const intact = await T.eval("(async () => { const f = await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('plan-library')).getFileHandle(" +
          JSON.stringify(firstFile || "x") + ")).getFile(); const a = new Uint8Array(await f.arrayBuffer()); const s = window.__saveFiles[window.__saveFiles.length - 1];" +
          " const b = new Uint8Array(await s.arrayBuffer()); return a.length === b.length && a.every((v, i) => v === b[i]); })()");
        check("tablet (ix-d): the first opening's kept save is intact (its bytes are exactly what its app saved)", intact === true);
        await T.until("(async () => { const L = await import('/js/plan-library.js'); const r = (await L.list()).find(x => x.itemId === " + JSON.stringify(fc.id) + "); return !!r && !!r.save && r.save.state === 'sent'; })()", 40000);
      } finally {
        await T.eval("DCR2Demo.setUploadDelay(0); true").catch(() => null);
      }
      const odD = await lastSaveSame(T, OD + ".planBlobOf(" + JSON.stringify(fc.id) + ")");
      const recD = (await records(T)).find((r) => r.itemId === fc.id);
      check("tablet (ix-d): ...and it reached OneDrive whole (the plan replaced by exactly those bytes)", odD === true && !!recD && !recD.local && recD.sent && recD.sent.mode === "replace",
        JSON.stringify({ odD, sent: recD && recD.sent }));
      // (contract addendum 3 D7) the refused opening was promised nothing - and its work is not lost: its Close keeps its
      // draft, and the plan reopened (the first opening's save by now, another size) offers it back as an earlier version's
      await closeFrame(T2);
      await closeFrame(T);
      await openPlan(T, fc.id, "(" + DRAFT_ASKED + " || " + APP_READY + ")");
      await T.until(DRAFT_ASKED, 8000).catch(() => null);
      const offerD = await T.eval("(() => { const w = " + APP + "; const h = w.document.querySelector('.dlg-head'); let d = h; for (let i = 0; d && i < 4 && !/Restore/.test(d.innerText || ''); i++) d = d.parentElement;" +
        " return { head: h ? h.textContent : '', text: d ? d.innerText : '', size: w.TakeoffApp.app.fileSize }; })()");
      check("tablet (ix-d, D7): reopened - handed the first opening's save - the plan offers the refused opening's work back, in the earlier version's words",
        offerD.head === "Unsaved work found" && /These are your unsaved changes from an earlier version of this plan \(.+\)\. Restoring them replaces what is open now\./.test(offerD.text) &&
        offerD.size === (recD && recD.size), JSON.stringify(offerD));
      await shotOf(T, "plans_frame_earlier_draft_tablet.png");
      await T.eval("(() => { const b = Array.from(" + APP + ".document.querySelectorAll('.dlg-foot button')).find(x => /Restore it/.test(x.textContent)); if (b) b.click(); return !!b; })()");
      await T.until(APP_READY, 15000).catch(() => null);
      await sleep(600);
      check("tablet (ix-d, D7): restored, the refused opening's edit is back in the app",
        (await T.eval(APP + ".TakeoffApp.app.project.metadata.client_name")) === "Made-up client (e2e, the second opening, whose save the portal will not take)");
      await closeFrame(T);

      // (ix-e) Close while there are unsaved changes AND a save is being sent (review FRAME-1): the danger question with the
      // send's sentence after it; the app keeps its draft before its frame goes; the send finishes in the page; and the
      // draft survives - the admin's reopening offers it
      const who1 = await whoOf(T);
      const fd = await putFixture(T, "A267", "A267 Bid - Close while it is sent (e2e, made up)", "A267 Bid.takeoff");
      await openPlan(T, fd.id);
      await editApp(T, "Made-up client (e2e, saved, then closed while it went)");
      await T.eval("DCR2Demo.setUploadDelay(10000); window.__ops = []; true");
      await T.eval("(() => { const w = " + APP + "; w.__states.length = 0; return true; })()");
      await T.eval(APP + ".document.querySelector('button[data-act=\"save\"]').click(); true");
      let sizeE = 0;
      try {
        await T.until(APP + ".__states.some(s => s.state === 'kept') && window.__ops.indexOf('plan_save_session') !== -1", 30000);
        await sleep(300);
        sizeE = await T.eval("window.__saveFiles[window.__saveFiles.length - 1].size");
        await editApp(T, "Made-up client (e2e, an edit after the Save)");
        await tapOn(T, "#ptfClose");
        await T.until("!!document.querySelector('#dcrModalHost.open #dcrMoYes')", 5000);
        const askE = await T.eval("({ title: document.querySelector('#dcrModalHost .dcr-mo-t').textContent, text: (document.querySelector('#dcrModalHost .dcr-mo-m') || {}).textContent || '', yes: document.getElementById('dcrMoYes').textContent," +
          " danger: document.getElementById('dcrMoYes').className })");
        await shotOf(T, "plans_frame_close_sending_tablet.png");
        await tapOn(T, "#dcrMoYes");
        await T.until("!document.getElementById('ptfFrame')", 8000);
        const sendingStill = await T.eval("(async () => { const L = await import('/js/plan-library.js'); return ((await L.list()).find(r => r.itemId === " + JSON.stringify(fd.id) + ") || {}).save; })()");
        check("tablet (ix-e): Close with unsaved changes while the save is sent - the danger question first, the send's sentence after it; the frame closes at the tap",
          askE.title === "Close the takeoff app?" && askE.yes === "Close without saving" && /dcr-mo-danger/.test(askE.danger) && /being sent to OneDrive/.test(askE.text),
          JSON.stringify({ askE, sendingStill }));
        await T.until("(async () => { const L = await import('/js/plan-library.js'); const r = (await L.list()).find(x => x.itemId === " + JSON.stringify(fd.id) + "); return !!r && !!r.save && r.save.state === 'sent'; })()", 30000);
      } finally {
        await T.eval("DCR2Demo.setUploadDelay(0); true").catch(() => null);
      }
      const draftsE = await T.eval(DRAFTS + "()");
      const keyE = fd.name + "|" + sizeE + "|@" + who1;
      check("tablet (ix-e): the send went on after the frame closed (Sent), and the app's draft with the later edit is kept under the saved file and this person's word",
        draftsE.some((d) => d.key === keyE && d.client === "Made-up client (e2e, an edit after the Save)"), JSON.stringify({ keyE, draftsE }));

      // (ix-f) the per-person word (review PRICE-4): a second person with prices on this same tablet opens the same plan -
      // the same name and size - and is NOT offered the first person's draft
      const T3 = await newPage(cdp, "tablet-manager-prices", OUT); pages.push(T3);
      answerDialogs(T3);
      await T3.call("Emulation.setUserAgentOverride", { userAgent: TABLET_UA, platform: "MacIntel" });
      await T3.size(1024, 768, true);
      await signIn(T3, emailOf.manager_prices, "dashboard.html");
      await openReal(T3);
      const b64e = await T.eval("(async () => { const u = new Uint8Array(await " + OD + ".planBlobOf(" + JSON.stringify(fd.id) + ").arrayBuffer()); let s = '';" +
        " for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); })()");
      await T3.eval("(() => { const u = Uint8Array.from(atob(" + JSON.stringify(b64e) + "), (c) => c.charCodeAt(0)); return " + OD + ".setPlanFixture('A267', new Blob([u]), " + JSON.stringify(fd.name) + "); })()");
      await openPlan(T3, fd.id);
      await sleep(2500);
      const offer3 = await T3.eval("(() => { const w = " + APP + "; const h = w.document.querySelector('.dlg-head'); return { dialog: h ? h.textContent : '', who: w.TakeoffApp.app.draftWho," +
        " size: w.TakeoffApp.app.fileSize, name: w.TakeoffApp.app.fileName }; })()");
      const who3 = await whoOf(T3);
      check("tablet (ix-f): a second price person on this tablet opens the same plan (same name, same size) and is not offered the first person's draft",
        offer3.dialog !== "Unsaved work found" && offer3.who === who3 && who3 !== who1 && offer3.size === sizeE && offer3.name === fd.name &&
        (await T3.eval(DRAFTS + "()")).some((d) => d.key === keyE), JSON.stringify({ offer3, who1, who3 }));
      await closeFrame(T3);
      // ...and the first person's own reopening offers it (it was kept all along)
      // (the app asks before it is ready: the question holds the opening)
      await openPlan(T, fd.id, "(" + DRAFT_ASKED + " || " + APP_READY + ")");
      await T.until(DRAFT_ASKED, 8000).catch(() => null);
      const offer1 = await T.eval("(() => { const h = " + APP + ".document.querySelector('.dlg-head'); return h ? h.textContent : ''; })()");
      await shotOf(T, "plans_frame_draft_offer_tablet.png");
      check("tablet (ix-e/f): the first person's own reopening offers the draft back", offer1 === "Unsaved work found", offer1);
      await T.eval("(() => { const b = Array.from(" + APP + ".document.querySelectorAll('.dlg-foot button')).find(x => /Restore it/.test(x.textContent)); if (b) b.click(); return !!b; })()");
      await T.until(APP_READY, 15000).catch(() => null);
      await sleep(600);
      check("tablet (ix-e): restored, the later edit is back in the app", (await T.eval(APP + ".TakeoffApp.app.project.metadata.client_name")) === "Made-up client (e2e, an edit after the Save)");
      await closeFrame(T);
      check("tablet (ix): no dialog of the browser's own in the second tabs", !T2.dialogs.length && !T3.dialogs.length, JSON.stringify([T2.dialogs, T3.dialogs]));
    }, T);

    /* ── 4e (x). the repair round's walks (contract addendum 3) with the REAL app: the broker's switch (D1), and every
       replace checked by the plan's version history (D2, D3, D5) - the demo broker as DCR Desktop 2's since its repair
       round, its Microsoft in the modes the pages leave open (graphModes) ── */
    /** openPlan, and an offer of unsaved work (a draft an earlier walk left of this plan's name, offered since takeoff-web
        bc69633 as an earlier version's) declined: these walks are about the save, not the drafts */
    async function openPlanNoDraft(p, id) {
      await openPlan(p, id, "(" + DRAFT_ASKED + " || " + APP_READY + ")");
      if (await p.eval(DRAFT_ASKED)) {
        await p.eval("(() => { const b = Array.from(" + APP + ".document.querySelectorAll('.dlg-foot button')).find(x => !/Restore it/.test(x.textContent)); if (b) b.click(); return !!b; })()");
        await p.until(APP_READY, 15000);
      }
    }
    const NOPICKERS = "if (location.pathname.indexOf('/takeoff/') === 0) { for (const k of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) { try { delete window[k]; } catch (e) { /* */ } } }";
    const TS = await newPage(cdp, "tablet-admin-switch", OUT); pages.push(TS);
    answerDialogs(TS);
    // the frame as Safari on an iPad has it: no File System Access (the share sheet takes a Save the portal is not offered)
    await TS.call("Page.addScriptToEvaluateOnNewDocument", { source: NOPICKERS });
    await attempt("a tablet, the broker's switch (x, D1): off - no Save to OneDrive offered, the app's Save goes to the share sheet; only:A267 - offered on A267's plans, never on A024's", async () => {
      await TS.call("Emulation.setUserAgentOverride", { userAgent: TABLET_UA, platform: "MacIntel" });
      await TS.size(1024, 768, true);
      await signIn(TS, "admin", "dashboard.html");
      const share = (p) => p.eval("(() => { const w = " + APP + "; w.__shared = []; w.navigator.canShare = () => true; w.navigator.share = (d) => { w.__shared.push((d.files || []).map(f => ({ name: f.name, size: f.size }))); return Promise.resolve(); }; return true; })()");
      const canSave = (p) => p.eval("(() => { const t = " + APP + ".TakeoffApp; return { canSave: t.app.portal.canSave, kind: t.app.portal.kind, name: t.app.portal.name }; })()");
      try {
        // off (the broker's default): plans_list / plan_link say save_back false - the frame offers nothing
        await TS.eval("localStorage.setItem('dcr2-demo-plan-save', 'off'); true");
        await openReal(TS);
        await hearSaves(TS);
        await watchOps(TS);
        const fx = await putFixture(TS, "A267", "A267 Bid - the switch off (e2e, made up)", "A267 Bid.takeoff");
        await openPlanNoDraft(TS, fx.id);
        const off = await canSave(TS);
        const recOff = (await records(TS)).find((r) => r.itemId === fx.id);
        await share(TS);
        await editApp(TS, "Made-up client (e2e, the switch off)");
        await TS.eval("window.__ops = []; window.__opsSeen = []; true");
        await TS.eval(APP + ".document.querySelector('button[data-act=\"save\"]').click(); true");
        for (let i = 0; i < 20; i++) {
          const done = await TS.eval("(() => { const w = " + APP + "; if (w.__shared.length) return 'shared'; const b = Array.from(w.document.querySelectorAll('button')).find(x => x.offsetParent !== null &&" +
            " /^(Share|Save a copy|Save to Files|Save|OK|Continue)\\b/i.test(x.textContent.trim()) && x.closest('.dlg, .dialog, [role=dialog], .modal, .sheet')); if (b) { b.click(); return 'clicked'; } return ''; })()");
          if (done === "shared") break;
          await sleep(300);
        }
        await sleep(600);
        const outOff = await TS.eval("(() => { const w = " + APP + "; return { shared: w.__shared }; })()");
        const opsOff = await TS.eval("window.__ops");
        check("tablet (x, D1): the switch off - the app got the plan without canSave (the record's save_back false), and its Save went to the share sheet: nothing handed to the portal, nothing sent",
          off.kind === "file" && off.canSave === false && !!recOff && recOff.saveBack === false && outOff.shared.length === 1 && /\.takeoff$/.test(outOff.shared[0][0].name) &&
          (await TS.eval("window.__saveFiles.length")) === 0 && opsOff.indexOf("plan_save_session") === -1, JSON.stringify({ off, saveBack: recOff && recOff.saveBack, outOff, opsOff }));
        await shotOf(TS, "plans_frame_switch_off_tablet.png");
        await closeFrame(TS);
        // only:A267 - offered on A267's plan...
        await TS.eval("localStorage.setItem('dcr2-demo-plan-save', 'only:A267'); true");
        await openPlanNoDraft(TS, fx.id);
        const onA = await canSave(TS);
        const recOn = (await records(TS)).find((r) => r.itemId === fx.id);
        await closeFrame(TS);
        // ...never on another project's (A024's plan, a made-up real one)
        const a024 = await db(TS, "R.projects.find(p => p.number === 'A024').id");
        await TS.goto(base + "/project.html?id=" + a024, 400);
        await TS.until("!!document.querySelector('#pjPlans:not([hidden]) a[data-plan-menu]')", 10000);
        const fy = await putFixture(TS, "A024", "A024 Framing - only:A267 (e2e, made up)");
        await openPlanNoDraft(TS, fy.id);
        const onB = await canSave(TS);
        const recB = (await records(TS)).find((r) => r.itemId === fy.id);
        check("tablet (x, D1): only:A267 - the Save to OneDrive is offered on A267's plan (canSave), never on A024's",
          onA.canSave === true && !!recOn && recOn.saveBack === true && onB.kind === "file" && onB.canSave === false && !!recB && recB.saveBack === false,
          JSON.stringify({ onA, onB, a: recOn && recOn.saveBack, b: recB && recB.saveBack }));
        await closeFrame(TS);
      } finally {
        await TS.eval("localStorage.removeItem('dcr2-demo-plan-save'); true").catch(() => null);
      }
      check("tablet (x): no dialog of the browser's own", !TS.dialogs.length, JSON.stringify(TS.dialogs));
    }, TS);

    await attempt("a tablet, the version check (x, D2/D3/D5): OneDrive ignoring the deferral with an office save during the upload - the office save stays the plan, the work a copy in the copy words; the PUT refused - the POST commits it; both refused - a copy in neutral words", async () => {
      await closeFrame(T);
      await T.call("Page.bringToFront").catch(() => null);
      await openReal(T);
      await hearSaves(T);
      await watchOps(T);
      const bytesOf = (id) => "(async () => { const ext = " + OD + "; const sent = window.__saveFiles[window.__saveFiles.length - 1]; const b = async (x) => new Uint8Array(await x.arrayBuffer());" +
        " const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]); const s = await b(sent); const c = ext.planBlobOf(" + JSON.stringify(id || "") + ");" +
        " return !!c && eq(s, await b(c)); })()";
      try {
        // (x-a) OneDrive commits at the last chunk itself, and an office save landed during the upload
        await T.eval(OD + ".graphModes({ reset: true, deferCommit: 'ignored' }); true");
        const fa = await putFixture(T, "A267", "A267 Rev 2 - the deferral ignored (e2e, made up)", "A267 Rev 2.takeoff");
        await openPlanNoDraft(T, fa.id);
        await editApp(T, "Made-up client (e2e, OneDrive committed at the last chunk)");
        await sleep(2500);                                    // the office's save comes later than the version the app has
        await T.eval(OD + ".duringUpload(" + JSON.stringify(fa.full) + ", 'office'); " + OD + ".logLines(true); window.__ops = []; window.__opsSeen = []; true");
        const sa = await saveApp(T);
        const ca = sa.states.find((x) => x.state === "copy");
        const opsA = await planOps(T);
        const logA = await T.eval(OD + ".logLines()");
        const planIsSave = await T.eval(bytesOf(fa.id));
        const copyIsSave = await T.eval(bytesOf((opsA.find((x) => x.op === "plan_save_done") || {}).id));
        const barA = await T.eval("document.getElementById('ptfSay').textContent");
        const nowA = (await plansNow(T)).find((f) => f.id === fa.id);
        check("tablet (x-a, D3): OneDrive committed at the last chunk over an office save - the portal told the broker (landed), which put the office save back; the work went again as a copy",
          JSON.stringify(opsA.map((x) => [x.op, x.landed, x.mode || x.error])) === JSON.stringify([["plan_save_session", false, "replace"], ["plan_save_commit", true, "plan_changed"],
            ["plan_save_session", false, "copy"], ["plan_save_done", false, "copy"]]) && opsA[1].why === "changed" &&
          logA.indexOf("onedrive plan_save_commit: OneDrive committed at the last chunk: deferCommit not honoured here") !== -1 &&
          logA.indexOf("onedrive plan_save_commit: crossed: the office save was put back") !== -1, JSON.stringify({ opsA, logA }));
        check("tablet (x-a): ...the office save stays the plan, the iPad's work is the copy - and both the portal and the app say so in the copy words",
          !!ca && /^A267 Rev 2 - iPad \d{4}-\d{2}-\d{2} \d{4}(?: \(\d\))?\.takeoff$/.test(ca.name || "") && !planIsSave && copyIsSave && !!nowA && /^qx:demo-office-/.test(nowA.version) &&
          COPY_BAR.test(barA) && COPY_APP.test(sa.status) && sa.dirty === false, JSON.stringify({ states: sa.states, planIsSave, copyIsSave, version: nowA && nowA.version, barA, status: sa.status }));
        await shotOf(T, "plans_frame_landed_copy_tablet.png");
        await closeFrame(T);
        // (x-b) Example 7's PUT refused (a OneDrive that commits a deferred session by its POST only): the POST commits it
        await T.eval(OD + ".graphModes({ reset: true, putCommit: 'refused' }); " + OD + ".logLines(true); true");
        const fb = await putFixture(T, "A267", "A267 Rev 2 - the PUT refused (e2e, made up)", "A267 Rev 2.takeoff");
        await openPlanNoDraft(T, fb.id);
        await editApp(T, "Made-up client (e2e, the PUT refused)");
        await T.eval("window.__ops = []; window.__opsSeen = []; true");
        const sb = await saveApp(T);
        const opsB = await planOps(T);
        const logB = await T.eval(OD + ".logLines()");
        check("tablet (x-b, D2): the PUT commit refused - the broker's POST commits it: a replace, verified by the version history, the plan is the save",
          sb.states[sb.states.length - 1].state === "sent" && JSON.stringify(opsB.map((x) => [x.op, x.mode])) === JSON.stringify([["plan_save_session", "replace"], ["plan_save_commit", "replace"]]) &&
          opsB[1].verified === true && logB.indexOf("onedrive plan_save_commit: the PUT commit was refused (400): the POST commit") !== -1 && (await T.eval(bytesOf(fb.id))) === true,
          JSON.stringify({ states: sb.states, opsB, logB }));
        await closeFrame(T);
        // (x-c) both commit forms refused: plan_changed {why: "refused"} - a copy, told without blaming the office, and the
        // app never hears a "copy" (its words say the office saved)
        await T.eval(OD + ".graphModes({ reset: true, putCommit: 'refused', postStatus: 400 }); true");
        const fc2 = await putFixture(T, "A267", "A267 Rev 2 - both refused (e2e, made up)", "A267 Rev 2.takeoff");
        await openPlanNoDraft(T, fc2.id);
        await editApp(T, "Made-up client (e2e, OneDrive would not replace it)");
        await T.eval("window.__ops = []; window.__opsSeen = []; true");
        const sc = await saveApp(T, ["kept", "refused", "failed", "no-room"]);
        await T.until("(async () => { const L = await import('/js/plan-library.js'); const r = (await L.list()).find(x => x.itemId === " + JSON.stringify(fc2.id) + "); return !!r && !!r.save && (r.save.state === 'copy' || r.save.state === 'failed'); })()", 30000);
        await sleep(500);
        const opsC = await planOps(T);
        const barC = await T.eval("document.getElementById('ptfSay').textContent");
        const appC = await T.eval("(() => { const w = " + APP + "; return { states: w.__states.map(x => x.state), status: w.document.getElementById('statusText').textContent }; })()");
        check("tablet (x-c, D5): both commit forms refused - the work went as a copy, and the portal says so in neutral words; the app hears 'sent', never 'copy', and never says the office saved",
          sc.states.some((x) => x.state === "kept") && JSON.stringify(opsC.map((x) => [x.op, x.mode || x.error])) === JSON.stringify([["plan_save_session", "replace"], ["plan_save_commit", "plan_changed"],
            ["plan_save_session", "copy"], ["plan_save_done", "copy"]]) && opsC[1].why === "refused" &&
          /^OneDrive would not replace the plan, so your work was saved as 'A267 Rev 2 - iPad \d{4}-\d{2}-\d{2} \d{4}(?: \(\d\))?\.takeoff' next to it - nothing was overwritten\.$/.test(barC) &&
          appC.states.indexOf("copy") === -1 && appC.states[appC.states.length - 1] === "sent" && /^The portal sent .+ to OneDrive\.$/.test(appC.status) &&
          !/office/i.test(appC.status), JSON.stringify({ opsC, barC, appC }));
        await shotOf(T, "plans_frame_refused_copy_tablet.png");
        await closeFrame(T);
      } finally {
        await T.eval(OD + ".graphModes({ reset: true }); true").catch(() => null);
      }
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
