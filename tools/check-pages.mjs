#!/usr/bin/env node
/* DCR Portal 2 — a headless look at the demo site (development only).

     node tools/check-pages.mjs [--out <dir>] [--chrome <path>] [--pages all|core]

   Starts tools/devserve.mjs on a free 127.0.0.1 port, runs a local Chrome or Edge headless with a
   throw-away profile (no account, no extensions), signs in as the demo roles and walks the pages:
   - every Content-Security-Policy violation, console error and uncaught exception is collected
     (BLUEPRINT P1 check 11 "no page logs a CSP violation");
   - the service worker registers and keeps only "dcr-portal2-*" caches;
   - sign-in rules: ?next=, keep me signed in, temporary password, inactive and agents accounts;
   - the offline overlay; the upload queue in a real browser (IndexedDB, XMLHttpRequest, preview);
   - screenshots (core_*.png) into --out.
   Pages are served with the demo stand-in: nothing is sent to Supabase. Prints a JSON summary and
   exits 1 when a check failed. Talks to Chrome over the DevTools protocol with Node's own WebSocket. */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch as launchChrome, newPage as openPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-check-pages")));
const PAGES = arg("--pages", "all");
const launch = () => launchChrome(arg("--chrome"));
// the worker's cache name, read from site/sw.js (it is bumped when the worker changes: v2 = P3 push)
const SW_CACHE = /const CACHE = "([^"]+)"/.exec(readFileSync(new URL("../site/sw.js", import.meta.url), "utf8"))[1];
const newPage = (cdp, name) => openPage(cdp, name, OUT);

/* ── the walk ───────────────────────────────────────────────────────── */
async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = startServer(0);
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const { cdp, proc, profile } = await launch();
  const results = [];
  const shots = [];
  const pages = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail === undefined ? "" : detail });
  const signIn = async (p, email, keep, next) => {
    // the tabs share one browser profile: forget the last person first (the sign-in page would
    // otherwise go straight on, as it should for someone already signed in)
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
    await p.goto(base + "/index.html" + (next ? "?next=" + encodeURIComponent(next) : ""));
    await p.until("document.getElementById('loginFields') && !document.getElementById('loginFields').disabled", 8000).catch(() => null);
    await p.eval("document.getElementById('email').value=" + JSON.stringify(email) + ";document.getElementById('password').value='demo-password-1';" +
      "document.getElementById('remember').checked=" + (keep ? "true" : "false") + ";document.getElementById('loginForm').requestSubmit();true");
    await sleep(1800);
  };
  try {
    // 0. the sign-in form before its script has taken over (a slow phone, an old browser): Enter or
    //    Sign In must not send anything — no password in the address (the first tab: no service worker yet)
    {
      const h = await newPage(cdp, "held"); pages.push(h);
      await h.size(390, 800, true);
      let navigatedTo = "";
      cdp.handlers.add((msg) => {
        if (msg.sessionId === h.s && msg.method === "Page.frameNavigated" && !msg.params.frame.parentId) navigatedTo = msg.params.frame.url;
      });
      await h.call("Fetch.enable", { patterns: [{ urlPattern: "*js/shell/index.js*", requestStage: "Request" }] });   // never answered
      await h.call("Page.navigate", { url: base + "/index.html" });
      await h.until("!!document.getElementById('loginForm') && document.readyState !== 'loading'", 8000);
      const form = await h.eval("({ disabled: document.getElementById('loginFields').disabled, method: document.getElementById('loginForm').method," +
        " names: Array.from(document.querySelectorAll('#loginForm input[name]')).map(i => i.name) })");
      check("sign-in before its script: the form is inert (disabled, POST, no field names)", form.disabled === true && form.method === "post" && form.names.length === 0, JSON.stringify(form));
      await h.eval("document.getElementById('email').focus(); true");
      await h.call("Input.insertText", { text: "field@demo.test" });
      await h.eval("document.getElementById('password').focus(); true");
      await h.call("Input.insertText", { text: "Made-up-Pass-2026" });
      const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
      await h.call("Input.dispatchKeyEvent", Object.assign({ type: "keyDown", text: "\r" }, key));
      await h.call("Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, key));
      await h.eval("document.getElementById('submitBtn').click(); true").catch(() => null);
      await sleep(1200);
      const where = String(await h.eval("location.href").catch(() => "")) + " " + navigatedTo;
      check("sign-in before its script: Enter / Sign In send nothing (no password in the address)", !/password|Made-up-Pass/.test(where), where);
      await h.call("Fetch.disable").catch(() => null);
      await h.call("Page.navigate", { url: "about:blank" }).catch(() => null);
    }

    // 1. desktop, light: sign-in, home, settings
    const d = await newPage(cdp, "desktop"); pages.push(d);
    await d.size(1280, 860, false);
    await d.dark(false);
    await d.goto(base + "/index.html");
    shots.push(await d.shot("core_signin_desktop.png"));
    await signIn(d, "manager@demo.test", true, "dashboard.html");
    check("sign-in goes to ?next= (dashboard)", /dashboard\.html$/.test(await d.eval("location.pathname")), await d.eval("location.href"));
    await d.until("document.querySelectorAll('.hm-card').length > 3");
    // the card's own words (the My Tasks card also carries its badge, P3; My Assistant for everyone, P6 - a
    // manager has no DCR Agents 2 nor Assistants card: an admin's)
    check("home cards for a manager", (await d.eval("Array.from(document.querySelectorAll('.hm-card .tt')).map(n=>n.childNodes[0].textContent).join('|')")) ===
      "Project Board|Progress Chart|Search|Log History|Leads|Marketing Tasks|My Tasks|Tasks on Map|Site Photos|Time Sheet|Team Sheets|Batch Entry|Vehicles|" +
      "My Assistant|Settings|Employees & crews");    // P5c: Leads and Marketing Tasks (the office's lists), Vehicles (everyone's)
    check("kept signed in: the session is in localStorage", await d.eval("!!localStorage.getItem('dcr2-auth') && !sessionStorage.getItem('dcr2-auth')"));
    check("top bar: Portal 2 badge and the user", await d.eval("document.querySelector('.dcr2-topbar .p2-badge') && document.getElementById('userPill').textContent.includes('Morgan')"));
    await sleep(800);
    check("presence: colleagues drawn in the top bar", (await d.eval("document.querySelectorAll('#dcr2Presence .dcr2-av').length")) >= 1);
    shots.push(await d.shot("core_dashboard_manager.png"));
    const sw = await d.until("navigator.serviceWorker.getRegistration().then(r => r && r.active ? r.active.state : null)", 8000).catch(() => null);
    check("service worker registered and active", sw === "activated" || sw === "activating", sw);
    const caches = await d.eval("caches.keys()");
    check("caches: only " + SW_CACHE, JSON.stringify(caches) === JSON.stringify([SW_CACHE]), JSON.stringify(caches));
    await d.goto(base + "/index.html?email=x%40example.com&next=dashboard.html", 1200);   // a query on a kept page
    const kept = await d.eval("caches.open('" + SW_CACHE + "').then(c => c.keys()).then(l => l.map(r => r.url))");
    check("service worker: no kept address carries a query string (never a typed sign-in)", kept.length > 5 && kept.every((u) => !/\?/.test(u)),
      kept.filter((u) => /\?/.test(u)).join(" ") || String(kept.length));
    await d.goto(base + "/index.html?next=" + encodeURIComponent("search.html?q=A24"), 1500);
    check("already signed in: the sign-in page goes straight on to ?next=", /search\.html\?q=A24$/.test(await d.eval("location.href")), await d.eval("location.href"));
    await d.goto(base + "/index.html?next=" + encodeURIComponent("https://example.com/x.html"), 1500);
    check("?next= never leaves the site", /\/dashboard\.html$/.test(await d.eval("location.href")), await d.eval("location.href"));
    await d.goto(base + "/settings.html");
    await d.until("document.getElementById('stName').value.length > 0");
    shots.push(await d.shot("core_settings.png"));
    await d.eval("document.getElementById('stPhone').value='(805) 555-0177'; document.getElementById('stSave').click(); true");
    await sleep(900);
    check("settings: details saved (versioned PATCH)", /Saved/.test(await d.eval("document.getElementById('stMsg').textContent")),
      await d.eval("document.getElementById('stMsg').textContent"));
    await d.dark(true);
    await d.goto(base + "/dashboard.html");
    shots.push(await d.shot("core_dashboard_dark.png"));
    await d.dark(false);

    // 2. not kept: sessionStorage; a lead on the home page
    const l = await newPage(cdp, "lead"); pages.push(l);
    await l.size(1280, 860, false);
    await signIn(l, "lead@demo.test", false, "dashboard.html");
    check("not kept: the session is in sessionStorage only", await l.eval("!!sessionStorage.getItem('dcr2-auth') && !localStorage.getItem('dcr2-auth')"));
    await l.eval("DCR2.logout(); true");
    await sleep(800);
    check("log out: back to sign-in, this device signed out", (await l.eval("location.pathname")) === "/index.html" && !(await l.eval("sessionStorage.getItem('dcr2-auth')")));

    // 3. phone: field crew, menu
    const m = await newPage(cdp, "phone"); pages.push(m);
    await m.size(390, 844, true);
    await m.eval("localStorage.clear(); sessionStorage.clear(); true").catch(() => {});
    await signIn(m, "field@demo.test", true, "dashboard.html");
    await m.until("document.querySelectorAll('.hm-card').length > 3");
    shots.push(await m.shot("core_dashboard_field_phone.png"));
    await m.eval("document.querySelector('.dcr2-menu-btn').click(); true");
    await sleep(300);
    check("phone: the menu opens", await m.eval("document.getElementById('dcr2Nav').classList.contains('open')"));
    shots.push(await m.shot("core_menu_phone.png"));
    check("phone: no horizontal scroll", await m.eval("document.documentElement.scrollWidth <= innerWidth + 1"),
      await m.eval("document.documentElement.scrollWidth + ' > ' + innerWidth"));

    // 4. the upload queue in a real browser: a camera JPEG with its preview, then a video by TUS
    await m.eval(`(async () => {
      const c = document.createElement('canvas'); c.width = 1600; c.height = 1200;
      const g = c.getContext('2d'); g.fillStyle = '#2a6'; g.fillRect(0, 0, 1600, 1200); g.fillStyle = '#fff'; g.fillRect(200, 300, 900, 500);
      const jpg = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
      const q = await import('/js/upload-queue2.js');
      window.__done = [];
      q.onProgress((items, evt) => { if (evt && evt.type === 'done') window.__done.push(evt.row); });
      await q.enqueue({ projectId: 268, file: new File([jpg], 'image.jpg', { type: 'image/jpeg' }), kind: 'photo', caption: 'From the headless check' });
      await q.enqueue({ projectId: 268, file: new File([new Uint8Array(13 * 1024 * 1024)], 'clip.mov', { type: 'video/quicktime' }), kind: 'video' });
      return true; })()`);
    await m.until("window.__done && window.__done.length === 2", 40000).catch(() => null);
    const done = await m.eval("JSON.stringify(window.__done || [])");
    const rows = JSON.parse(done);
    check("upload: photo row with preview and caption", rows.some((r) => r.folder === "photos" && r.preview_path && r.description === "From the headless check"), done.slice(0, 300));
    check("upload: video by TUS", rows.some((r) => /^VID /.test(r.name) && r.size === 13 * 1024 * 1024));
    check("upload: IndexedDB dcr2Uploads used", await m.eval("indexedDB.databases ? indexedDB.databases().then(l => l.some(x => x.name === 'dcr2Uploads')) : true"));

    // 5. temporary password -> change page -> on to ?next=
    const n = await newPage(cdp, "newhire"); pages.push(n);
    await n.size(1280, 860, false);
    await signIn(n, "newhire@demo.test", false, "settings.html");
    check("temporary password: sent to change-password.html", /change-password\.html/.test(await n.eval("location.href")), await n.eval("location.href"));
    await n.until("!document.getElementById('cpForm').hidden");
    shots.push(await n.shot("core_change_password.png"));
    await n.eval("document.getElementById('cpCur').value='temporary1'; document.getElementById('cpNew').value='framing2026x'; document.getElementById('cpNew2').value='framing2026x'; document.getElementById('cpForm').requestSubmit(); true");
    await sleep(1600);
    check("after the change: on to ?next= (settings)", /settings\.html$/.test(await n.eval("location.pathname")), await n.eval("location.href"));

    // 6. refused accounts, wrong password
    const r = await newPage(cdp, "refused"); pages.push(r);
    await r.size(1280, 860, false);
    await signIn(r, "inactive@demo.test", false);
    check("deactivated: refused with \"not active\"", /not active/.test(await r.eval("document.getElementById('err').textContent")));
    shots.push(await r.shot("core_signin_inactive.png"));
    await signIn(r, "agents@demo.test", false);
    check("agents account: refused", /not active/.test(await r.eval("document.getElementById('err').textContent")) && !(await r.eval("localStorage.getItem('dcr2-auth') || sessionStorage.getItem('dcr2-auth')")));
    await r.goto(base + "/index.html");
    await r.eval("document.getElementById('email').value='lead@demo.test';document.getElementById('password').value='wrong';document.getElementById('loginForm').requestSubmit();true");
    await sleep(900);
    check("wrong password: said plainly", /Wrong e-mail address or password/.test(await r.eval("document.getElementById('err').textContent")));
    await r.goto(base + "/settings.html");
    check("signed out: a page bounces to sign-in with ?next=", /index\.html\?next=settings\.html/.test(await r.eval("location.href")), await r.eval("location.href"));

    // 7. offline: the overlay holds the page, the sign-in is kept
    const o = await newPage(cdp, "offline"); pages.push(o);
    await o.size(1280, 860, false);
    await signIn(o, "lead@demo.test", true, "dashboard.html");
    await o.eval("DCR2Demo.setOffline(true); true");
    await o.goto(base + "/dashboard.html", 4500);
    check("offline: the overlay shows", await o.eval("!!document.getElementById('dcrOffline')"));
    check("offline: still signed in", await o.eval("!!localStorage.getItem('dcr2-auth')"));
    shots.push(await o.shot("core_offline_overlay.png"));
    await o.eval("DCR2Demo.setOffline(false); true");

    // 8. every page as admin: CSP violations and errors only (the project pages are another builder's)
    if (PAGES === "all") {
      const a = await newPage(cdp, "admin"); pages.push(a);
      await a.size(1280, 860, false);
      await signIn(a, "admin@demo.test", true, "dashboard.html");
      for (const path of ["dashboard.html", "settings.html", "board.html", "project.html?id=268", "search.html?q=A24", "logs.html",
        "capture.html", "report-journal.html?id=268", "my-tasks.html", "my-tasks.html?task=1", "tasks-map.html", "project.html?id=268&tab=tasks",
        "agents-console.html", "agents-console.html#/photo", "my-assistant.html", "assistant-admin.html",
        // P5b: The Books, the bill page (the demo's first bill), Expenses & receipts, the printed expense report and
        // the project's money tabs
        "accounting.html", "bill.html?id=1", "ledger.html", "report-expenses.html?id=268", "project.html?id=268&tab=expenses",
        "project.html?id=268&tab=payments",
        // the Books program, release A: the check register; release B: the Accounting page
        "books-checks.html", "books-home.html",
        // release B part 2b: the vendor list and the reports (the money history too)
        "books-vendors.html", "books-reports.html", "books-reports.html#history",
        // P5c: the office lists
        "leads.html", "vehicles.html", "vehicles.html?id=1", "marketing.html",
        // P5c sales (Q10: the admin holds the Sales estimates switch): the hub, a saved estimate on its last step's
        // way in, a new one, the Materials Library and the drawing tool on its own
        "estimates.html", "estimate-deck.html?id=1", "estimate-deck.html?new=1", "materials-library.html", "cme.html",
        // P5c sub form: the review queue, and the public form (its own client: a signed-in browser changes nothing)
        "submissions.html", "submit.html"]) {
        await a.goto(base + "/" + path, 1500);
      }
      // P5a: the Estimate and Takeoffs tabs and their printed pages, as the admin (prices) and, on a phone, as a lead
      // (the worksite copy: not one amount on the page, typed ones included)
      const EST_PAGES = ["project.html?id=268&tab=estimate", "project.html?id=268&tab=takeoffs", "report-estimate.html?id=268",
        "report-estimate.html?id=268&est=3", "report-takeoff.html?id=268", "report-takeoff.html?id=268&tk=1&kind=quote"];
      for (const path of EST_PAGES) await a.goto(base + "/" + path, 1500);
      const le = await newPage(cdp, "lead-estimates"); pages.push(le);
      await le.size(390, 844, true);
      await signIn(le, "lead@demo.test", true, "dashboard.html");
      const seen = [];
      for (const path of EST_PAGES) {
        await le.goto(base + "/" + path, 1800);
        const t = await le.eval("document.body.innerText");
        if (/\$\s?\d/.test(t) || !/Sandbox/.test(t)) seen.push(path + ": " + ((t.match(/.{0,30}\$\s?\d.{0,12}/) || ["(not drawn)"])[0]));
      }
      check("P5a: a lead's Estimate and Takeoffs tabs and printed pages carry no amount", seen.length === 0, seen.join(" | "));
      // P5b: the money pages, as the same lead on a phone - refused or hidden, not one amount (the refusal dialogs
      // send them home: what is checked is every page as it was drawn)
      const seen5b = [];
      for (const path of ["accounting.html", "bill.html?id=1", "ledger.html", "report-expenses.html?id=268", "project.html?id=268&tab=expenses",
        "project.html?id=268&tab=payments", "books-checks.html", "books-home.html", "books-vendors.html", "books-reports.html"]) {
        await le.goto(base + "/" + path, 1800);
        const t = await le.eval("document.documentElement.outerHTML");
        if (/\$\s?\d/.test(t)) seen5b.push(path + ": " + ((t.match(/.{0,30}\$\s?\d.{0,12}/) || [""])[0]));
      }
      check("P5b: a lead's view of The Books, a bill, the ledger, the expense report and the money tabs carries no amount", seen5b.length === 0, seen5b.join(" | "));
      // P5c: the office lists, as the same lead on a phone - Leads and Marketing are the office's (no row of either in the
      // page), the Vehicle Board without a service's material cost
      const seen5c = [];
      for (const path of ["leads.html", "marketing.html", "vehicles.html?id=1"]) {
        await le.goto(base + "/" + path, 1800);
        const t = await le.eval("document.documentElement.outerHTML");
        const rows = await le.eval("document.querySelectorAll('.ld-card, tr.mk-row').length");
        if (/\$\s?\d/.test(t) || rows) seen5c.push(path + ": " + rows + " rows " + ((t.match(/.{0,30}\$\s?\d.{0,12}/) || [""])[0]));
      }
      check("P5c: a lead's view of Leads, Marketing Tasks and the Vehicle Board carries no lead, no task and no amount", seen5c.length === 0, seen5c.join(" | "));
      // P5c sales (Q10): the same lead has no Sales estimates switch - every sales page says so and shows no saved
      // estimate, no comp, no material and no amount (the database answers no row; the page asks for nothing more)
      const seenSales = [];
      for (const path of ["estimates.html", "estimate-deck.html?id=1", "materials-library.html"]) {
        await le.goto(base + "/" + path, 1800);
        const t = await le.eval("document.documentElement.outerHTML");
        const rows = await le.eval("document.querySelectorAll('#seList tr.row, #refList tr.row, .ml-card, #f_client').length");
        const said = await le.eval("/Sales estimates switch/.test(document.body.innerText)");
        if (/\$\s?\d/.test(t) || rows || !said) seenSales.push(path + ": " + rows + " rows, told " + said + " " + ((t.match(/.{0,30}\$\s?\d.{0,12}/) || [""])[0]));
      }
      check("P5c sales: a lead without the Sales estimates switch is told so on Sales Estimates, the deck wizard and the Materials Library: no estimate, comp, material or amount", seenSales.length === 0, seenSales.join(" | "));
    }
  } finally {
    const all = pages.flatMap((p) => p.log.map((e) => Object.assign({ page: p.name }, e)));
    const csp = all.filter((e) => /CSP-VIOLATION|Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(e.text));
    const errors = all.filter((e) => (e.level === "error" || e.level === "exception") && !/CSP-VIOLATION/.test(e.text) &&
      !/Failed to load resource: net::ERR_INTERNET_DISCONNECTED|demo: offline|Failed to fetch/i.test(e.text));
    results.push({ name: "no Content-Security-Policy violation on any page", ok: csp.length === 0, detail: csp.slice(0, 20) });
    const summary = { base, out: OUT, passed: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length,
      results, consoleErrors: errors.slice(0, 40), screenshots: shots };
    console.log(JSON.stringify(summary, null, 1));
    try { await cdp.send("Browser.close"); } catch (e) { /* */ }
    try { proc.kill(); } catch (e) { /* */ }
    server.close();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Chrome may hold a file a moment longer */ }
    process.exitCode = summary.failed ? 1 : 0;
  }
}

main().catch((e) => { console.error(e); process.exit(2); });
