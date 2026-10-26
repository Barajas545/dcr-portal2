#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the plan buttons and the Floor Plans card in the DEMO (development only; owner
   decisions 2026-10-26).

     node tools/e2e-p7-plans.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the broker's stand-in and its made-up takeoff folder:
   tools/fake/p7-onedrive.js plans_for - nothing goes to Supabase or Microsoft) and drives a local Chrome or Edge
   headless:

   - Search as a field person and as an admin (decision 2: the same buttons): A267 gets 📐 beside its result (never
     inside its link), opening takeoff-web at #plans=A267 in a new tab (rel noopener), its accessible name and the count
     in its title; among the A02… results A024 and A024-B each get theirs (apart), A021 none; one plans_for call a search;
   - the project page's header: "📐 Plans ↗" on A267 (every tab), none on A001; the Takeoffs tab keeps its own link;
   - the home page's Floor Plans card for an admin, a manager with prices and an accountant (prices), never for a manager
     without prices, a lead, a field person or a view-only person; a new tab at takeoff-web's #plans;
   - the takeoff folder not set up (the demo's switch, localStorage "dcr2-demo-takeoff" = "off"): no button anywhere,
     nothing said, the page as before;
   - phone (375 px) and desktop, light and dark: never sideways; no Content-Security-Policy violation and no console
     error on any page.
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
          a267.btn.rel === "noopener" && a267.btn.label === "Plans for A267 — open in the takeoff app" && /^3 takeoff files for A267/.test(a267.btn.title) &&
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
