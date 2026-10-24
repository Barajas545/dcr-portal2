#!/usr/bin/env node
/* DCR Portal 2 — the P5c pages end to end on the REAL database rules (development only).

     PGLITE_DIR=<folder with node_modules/@electric-sql/pglite> node tools/e2e-p5c-pglite.mjs [--out <dir>] [--chrome <path>]
       [--shots final|none] [--prefix p5c_final_]

   Starts tools/pglite-serve.mjs in P5c mode (tools/pglite-p5c.mjs: the site, with every page's supabase-js calls replayed
   on PGlite loaded with every DCR Desktop 2 migration - M5c 20261027000100_office_lists included - as the signed-in
   person; the public form's calls answered by DCR Desktop 2's OWN subform Edge Function, handler.ts + sql.ts, as the
   service role) and drives a local Chrome or Edge headless, whose resolver sends *.supabase.co nowhere:

   - drift: the demo database's made-up office lists and sales tools (tools/fake/p5c-lists.js, p5c-sales.js) load into
     the real M5c tables (every constraint and trigger takes them) and are what the pages show here;
   - every role - admin, a manager with approve and financials (no prices), a manager without switches (Q1), the
     accountant (financials, prices and the Sales estimates switch - a reader, not a sales editor), lead, field, view-only
     and Sasha Seller (a manager with the Sales estimates switch, no prices) - on every P5c page: the home page's cards,
     Leads, the Vehicle Board, Marketing Tasks, Sales Estimates, the deck wizard, the Materials Library, the drawing tool
     (CME), the review queue. Without the switch a page says so and every answer the database gave that person from the
     table behind it was empty (or it was never asked); no amount on a page without the money switch;
   - the writes through the real policies and RPCs: a lead added, edited, converted to a project in one step
     (convert_lead -> create_project: the next number; a second convert refused) and deleted; a service scheduled and
     completed as an oil change with its material cost (financials) - complete_vehicle_maintenance; a vehicle retired; a
     marketing task done and priced (financials); a deck estimate from scratch - a photo into the private bucket
     sales-media, a CME drawing saved under the entry's "cme" key and saved again IN PLACE (the bucket's "replace
     drawings" policy), the money only in sales_estimate_prices; Sasha's save leaves the prices untouched; the database
     refuses the rest (a lead writing leads, a manager without financials writing a cost or a price, the accountant
     writing the library, a person writing a NEW "cad" drawing, Sasha reading prices);
   - P5 acceptance check 4: the PUBLIC form (submit.html) signed out on a phone - the five public fields of OPEN jobs
     only (3 characters at least, never the client), every problem at once, the honeypot, the amount limits, the
     signature and the paperwork under f/{job}/receipts/ through ONE signed upload, "attached" once; the function refuses
     another site (403) and answers CORS for portal.dcrframing.com only; anon itself reads nothing; then the review:
     accept is NOT approve (a bill waiting for approval with the paperwork as its document - shown in The Books, on the
     bill page and on the approver's home page, then approved there with a pay method), a second accept says "already
     done", an invoice without paperwork cannot be accepted, a reject with a note, a change order becomes the job's
     awarded change order with its amount under quote_prices;
   - the notices: one amount-free e-mail notice (notifications_outbox kind sub_submission) per admin, accountant and
     approver, never a push; agents_outbox_take hands DCR Agents 2 the waiting ones and sets aside the reviewed ones;
   - P5 acceptance check 5: no activity row and no outbox body written during the walk carries an amount;
   - no Content-Security-Policy violation and no console error on any page.
   Screenshots (--shots final): <prefix><what>_<light|dark>_<desktop|phone>.png into --out. Made-up people and jobs
   only. Prints a JSON summary; exit code 1 when a check failed. */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Cdp, CHROMES, newPage, sleep } from "./cdp.mjs";
import { startPgliteServer, emailOf, passwordOf } from "./pglite-serve.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p5c-pglite")));
const SHOTS = arg("--shots", "final") === "none" ? "none" : "final";
const PREFIX = arg("--prefix", "p5c_final_");
const ROLES = ["admin", "approver", "manager", "accountant", "lead", "field", "viewer", "sales"];
const OFFICE = { admin: true, approver: true, manager: true, accountant: true, viewer: true, sales: true };   // leads, marketing (read)
const WRITERS = { admin: true, approver: true, manager: true, sales: true };                                // leads, vehicles, marketing (write)
const FIN = { admin: true, approver: true, accountant: true };                                              // costs, marketing prices
const SALES = { admin: true, accountant: true, sales: true };                                               // the Sales estimates switch
const SALES_EDIT = { admin: true, sales: true };
const PRICES = { admin: true, accountant: true };
const REVIEW = { admin: true, approver: true, accountant: true };                                           // app.can_edit('money')
const AMOUNT = /\$\s?\d/;
const MONEY_WORDS = /\$\s?\d|\b\d{1,3}(,\d{3})+(\.\d{2})?\b|\b\d+\.\d{2}\b/;

/** Chrome or Edge, headless, a throw-away profile; Supabase's hosts resolve nowhere (nothing can reach the real project). */
async function launch(chrome) {
  const exe = [chrome].concat(CHROMES).find((p) => p && existsSync(p));
  if (!exe) throw new Error("no Chrome or Edge found (use --chrome <path>)");
  const profile = mkdtempSync(join(tmpdir(), "dcr2-chrome-"));
  const proc = spawn(exe, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile, "--no-first-run",
    "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--disable-default-apps", "--disable-extensions", "--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication",
    "--host-resolver-rules=MAP *.supabase.co ~NOTFOUND, MAP *.supabase.in ~NOTFOUND, MAP nominatim.openstreetmap.org ~NOTFOUND, MAP cdn.jsdelivr.net ~NOTFOUND",
    "--metrics-recording-only", "--mute-audio", "--password-store=basic", "about:blank"], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const [port, path] = readFileSync(portFile, "utf8").trim().split(/\r?\n/);
  const cdp = new Cdp("ws://127.0.0.1:" + port + path);
  await cdp.ready;
  return { cdp, proc, profile };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const S = await startPgliteServer({ p5c: true });
  const { base, sql, one, asPerson, J, calls } = S;
  const { cdp, proc, profile } = await launch(arg("--chrome"));
  const results = [];
  const shots = [];
  const pages = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail: detail === undefined ? "" : detail });
    process.stderr.write((ok ? "  ok   " : "  FAIL ") + name + (ok ? "" : " :: " + String(detail).slice(0, 400)) + "\n");
  };
  const attempt = async (name, fn, page) => {
    try { await fn(); } catch (e) {
      let where = "";
      if (page) {
        try { where = " @ " + await page.eval("location.href + ' :: ' + (document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(-400) : '')"); }
        catch (x) { where = " @ (page not answering: " + x.message + ")"; }
      }
      check(name, false, String(e && e.message || e).slice(0, 400) + where);
    }
  };
  const TOPBAR = "!!document.querySelector('.dcr2-topbar .p2-badge')";
  async function open(p, path, marker, ms, noBar) {
    await p.goto(base + path, 150);
    const here = "(location.pathname).indexOf(" + JSON.stringify(path.split("?")[0].split("#")[0]) + ") === 0";
    await p.until(here + (noBar ? "" : " && " + TOPBAR) + (marker ? " && (" + marker + ")" : ""), ms || 20000);
  }
  async function signIn(p, key, next) {
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
    await p.goto(base + "/index.html?next=" + encodeURIComponent(next || "dashboard.html"), 150);
    await p.until("!!document.getElementById('loginForm') && !!window.DCR2PGlite && !document.getElementById('loginFields').disabled", 10000);
    await p.eval("document.getElementById('email').value=" + JSON.stringify(emailOf(key)) + ";document.getElementById('password').value=" + JSON.stringify(passwordOf(key)) + ";" +
      "document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname) && " + TOPBAR, 15000);
  }
  const html = (p) => p.eval("document.documentElement.outerHTML");
  const text = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); return n ? n.innerText : ''; })()");
  const click = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); if (!n) throw new Error('no ' + " + JSON.stringify(sel) + "); n.click(); return true; })()");
  const setVal = (p, id, value, ev) => p.eval("(() => { const i = document.getElementById(" + JSON.stringify(id) + "); i.focus(); i.value = " + JSON.stringify(value) +
    "; i.dispatchEvent(new Event(" + JSON.stringify(ev || "input") + ", { bubbles: true })); return true; })()");
  const modalOpen = "!!document.querySelector('.dcr-mo.open')";
  const modalOk = (p) => p.eval("(() => { const b = document.getElementById('dcrMoYes'); if (b) b.click(); return !!b; })()");
  const sideways = (p) => p.eval("document.documentElement.scrollWidth - window.innerWidth");
  // the page's own supabase-js client (sb.js), as its signed-in person: -> {data, status, error: {code, message}}
  const raw = (p, call) => p.eval("(async () => { const c = (await import('/js/sb.js')).sb(); const r = await (" + call + "); return { data: r.data === undefined ? null : r.data, status: r.status, error: r.error ? { code: r.error.code || String(r.error.statusCode || ''), message: r.error.message } : null }; })()");
  const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  /** what the database answered this person from these tables since call index `from`: {asked, rows} */
  const answered = (uid, tables, from) => {
    const mine = calls.slice(from || 0).filter((c) => c.uid === uid && tables.includes(c.table));
    return { asked: mine.length, rows: mine.reduce((n, c) => n + (c.rows || 0), 0) };
  };

  async function shoot(p, name, device, dark, full) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1440;
    const h0 = device === "phone" ? 844 : 900;
    await p.call("Page.bringToFront").catch(() => null);
    await p.call("Emulation.setEmulatedMedia", { media: "", features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: h0, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(500);
    const h = full === false ? h0 : await p.eval("Math.max(" + h0 + ", Math.min(5200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(450);
    const file = PREFIX + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setEmulatedMedia", { media: "", features: [{ name: "prefers-color-scheme", value: "light" }] });
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: h0, deviceScaleFactor: 1, mobile: device === "phone" });
  }
  /** desktop light + dark, phone light + dark (the phone never scrolls sideways); back to the desktop size */
  async function four(p, name, full, marker) {
    await shoot(p, name, "desktop", false, full);
    await shoot(p, name, "desktop", true, full);
    await p.size(390, 844, true);
    await sleep(350);
    if (marker) await p.until(marker, 8000).catch(() => null);
    const sw = await sideways(p);
    check(name + ": on a phone (390 px) the page does not scroll sideways", sw <= 1, String(sw));
    await shoot(p, name, "phone", false, full);
    await shoot(p, name, "phone", true, full);
    await p.size(1440, 900, false);
    await sleep(250);
  }
  /* a made-up photo, dropped on a gallery (the drop path of js/sales/gallery.js) */
  const dropPhoto = (p, sel, name, hue) => p.eval(`(async () => {
    const c = document.createElement('canvas'); c.width = 960; c.height = 640;
    const x = c.getContext('2d'); x.fillStyle = 'hsl(${hue || 30}, 45%, 55%)'; x.fillRect(0, 0, 960, 640);
    x.fillStyle = '#fff'; x.fillRect(120, 380, 720, 60); x.fillStyle = '#333'; x.font = '48px Arial'; x.fillText(${JSON.stringify(name)}, 140, 300);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const dt = new DataTransfer(); dt.items.add(new File([blob], ${JSON.stringify(name)}, { type: 'image/jpeg' }));
    document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return true; })()`);

  const LEADS = "!document.getElementById('ldMain').hidden && !!document.querySelector('#ldList .ld-card')";
  const LEADS_DENIED = "!document.getElementById('ldDenied').hidden";
  const VEH = "!!document.querySelector('#vbAllList .vb-row')";
  const MK = "!document.getElementById('mkMain').hidden && !!document.querySelector('#mkList table.mk-tbl')";
  const MK_DENIED = "!document.getElementById('mkDenied').hidden";
  const HUB = "!document.getElementById('seMain').hidden && document.querySelectorAll('#seList tr.row').length > 0 && document.querySelectorAll('#refList tr.row').length > 0";
  const LIB = "document.querySelectorAll('.ml-card').length > 0";
  const DECK = "!!document.getElementById('f_client')";
  const CME_UP = "!!document.querySelector('.model-canvas')";
  const CME_DENIED = "getComputedStyle(document.getElementById('cmeBootError')).display === 'block'";
  const QUEUE = "!!document.getElementById('sbList') && !document.getElementById('sbList').hidden";

  try {
    const acts0 = Number((await one("select coalesce(max(id), 0) as n from public.activity")).n);
    const outbox0 = Number((await one("select coalesce(max(id), 0) as n from public.notifications_outbox")).n);
    const D = await one(`select (select count(*) from public.leads)::int as leads, (select count(*) from public.leads where converted_project_id is null)::int as open_leads,
        (select count(*) from public.vehicles where active)::int as live, (select count(*) from public.marketing_tasks)::int as tasks,
        (select coalesce(json_agg(material_cost), '[]') from public.vehicle_maintenance_costs where material_cost is not null) as costs,
        (select coalesce(json_agg(price), '[]') from public.marketing_task_prices where price is not null) as prices,
        (select string_agg(client_name, '|') from public.leads) as names,
        (select count(*) from public.sales_estimates)::int as ests, (select count(*) from public.sales_materials)::int as mats`);
    const L = J.p5c.loaded;
    check("drift: the demo's made-up office lists and sales tools load into the REAL M5c tables (every constraint and trigger took them; the money rows M5c makes with each row hold the demo's amounts)",
      L.leads >= 5 && L.vehicles >= 5 && L.vehicle_maintenance >= 5 && L.marketing_tasks >= 6 && L.sales_reference_projects >= 5 && L.sales_estimates >= 3 &&
      L.sales_materials >= 10 && L.vehicle_maintenance_costs === L.vehicle_maintenance && L.marketing_task_prices === L.marketing_tasks && J.p5c.objects >= 15 &&
      D.costs.length >= 2 && D.prices.length >= 5, JSON.stringify({ L, objects: J.p5c.objects }));
    const NAMES = String(D.names || "").split("|").filter(Boolean);

    /* ── 1. every role on every P5c page ───────────────────────────────── */
    const byRole = {};
    for (const role of ROLES) {
      const p = await newPage(cdp, role, OUT); pages.push(p);
      byRole[role] = p;
      await p.size(1440, 900, false);
      const uid = J.people[role];
      await attempt(role + ": every P5c page", async () => {
        await signIn(p, role);
        await p.until("document.querySelectorAll('.hm-card').length > 2", 10000);
        await p.until("!!document.querySelector('#hmVehicles .hm-badge')", 8000).catch(() => null);
        if (SALES[role] && role !== "admin") await p.until("!!document.getElementById('hmSales')", 8000).catch(() => null);
        if (REVIEW[role]) await p.until("!!document.querySelector('#hmSubs')", 8000).catch(() => null);
        const cards = await p.eval("Array.from(document.querySelectorAll('.hm-card .tt')).map(n => n.childNodes[0].textContent.trim())");
        check(role + ": home - Leads and Marketing Tasks " + (OFFICE[role] ? "shown" : "not shown") + ", Vehicles shown, Sales Estimates " +
          (SALES[role] ? "shown" : "not shown") + ", Sub submissions " + (REVIEW[role] ? "shown" : "not shown"),
          cards.includes("Leads") === !!OFFICE[role] && cards.includes("Marketing Tasks") === !!OFFICE[role] && cards.includes("Vehicles") &&
          cards.includes("Sales Estimates") === !!SALES[role] && cards.includes("Sub submissions") === !!REVIEW[role], cards.join("|"));
        if (role === "admin") await four(p, "home_admin", true, "!!document.querySelector('#hmVehicles')");

        // Leads
        if (OFFICE[role]) {
          await open(p, "/leads.html", LEADS);
          const n = await p.eval("document.querySelectorAll('#ldList .ld-card').length");
          const acts = await p.eval("({ newBtn: !document.getElementById('ldNewBtn').hidden, conv: document.querySelectorAll('[data-conv]').length })");
          check(role + ": Leads - the open leads from the database (" + D.open_leads + "); New / Convert " + (WRITERS[role] ? "offered" : "not offered"),
            n === D.open_leads && (WRITERS[role] ? acts.newBtn && acts.conv === D.open_leads : !acts.newBtn && !acts.conv), JSON.stringify({ n, acts }));
          if (role === "admin") await four(p, "leads_admin", true, LEADS);
        } else {
          const f0 = calls.length;
          await open(p, "/leads.html", LEADS_DENIED);
          const h = await html(p);
          const leaked = NAMES.filter((nm) => h.indexOf(nm) !== -1 || h.indexOf(nm.replace(/&/g, "&amp;")) !== -1);
          const a = answered(uid, ["leads"], f0);
          const r = await raw(p, "c.from('leads').select('id, client_name')");
          check(role + ": Leads - told the list is the office's; the page asked the database nothing, no client's name in it; asked directly, the database answers no row",
            /kept by the office/.test(await text(p, "#ldDenied")) && !leaked.length && a.asked === 0 && !r.error && (r.data || []).length === 0, JSON.stringify({ a, leaked, r: r.error || (r.data || []).length }));
          if (role === "lead") await four(p, "leads_denied_lead", false, LEADS_DENIED);
        }

        // the Vehicle Board, T-01's panel with its history
        const f1 = calls.length;
        await open(p, "/vehicles.html?id=" + J.p5c.t01, VEH + " && !document.getElementById('vbPanel').hidden && !!document.querySelector('#vpHistory .vb-maint')");
        const vh = await html(p);
        const shownCosts = D.costs.filter((c) => vh.indexOf(money(c)) !== -1);
        const vAll = await p.eval("document.querySelectorAll('#vbAllList .vb-row').length");
        const vActs = await p.eval("({ sched: !document.getElementById('vbSchedBtn').hidden, done: document.querySelectorAll('[data-done]').length })");
        const ca = answered(uid, ["vehicle_maintenance_costs"], f1);
        check(role + ": Vehicles - every vehicle in service (" + D.live + "), T-01's history; material costs " + (FIN[role] ? "shown" : "never sent (no amount on the page)") +
          "; Schedule / Complete " + (WRITERS[role] ? "offered" : "not offered"),
          vAll === D.live && (FIN[role] ? shownCosts.length >= 1 : !shownCosts.length && !AMOUNT.test(vh) && ca.rows === 0) &&
          (WRITERS[role] ? vActs.sched && vActs.done >= 1 : !vActs.sched && !vActs.done), JSON.stringify({ vAll, shownCosts, vActs, ca }));
        if (!FIN[role]) {
          const r = await raw(p, "c.from('vehicle_maintenance_costs').select('maintenance_id, material_cost')");
          check(role + ": Vehicles - asked directly, the database answers no material cost (financials)", !r.error && (r.data || []).length === 0, JSON.stringify(r).slice(0, 200));
        }
        if (role === "admin") await four(p, "vehicles_admin", true, VEH);
        if (role === "field") await four(p, "vehicles_field", true, VEH);

        // Marketing Tasks
        if (OFFICE[role]) {
          const f2 = calls.length;
          await open(p, "/marketing.html", MK);
          await click(p, "[data-f=all]");
          await p.until("document.querySelectorAll('#mkList tr.mk-row').length === " + D.tasks, 6000);
          const mh = await html(p);
          const priceCol = await p.eval("Array.from(document.querySelectorAll('#mkList th')).some(t => /price/i.test(t.textContent))");
          const shownPrices = D.prices.filter((x) => mh.indexOf(money(x)) !== -1);
          const pa = answered(uid, ["marketing_task_prices"], f2);
          check(role + ": Marketing - every task (" + D.tasks + "); " + (FIN[role] ? "the price column with every price" : "no price column, no price, no amount in the page; the database answered no price row (Q17)"),
            FIN[role] ? priceCol && shownPrices.length === D.prices.length : !priceCol && !shownPrices.length && !AMOUNT.test(mh) && pa.rows === 0,
            JSON.stringify({ priceCol, shown: shownPrices.length, of: D.prices.length, pa }));
          if (role === "admin") await four(p, "marketing_admin", true, MK);
          if (role === "viewer") await four(p, "marketing_viewer", true, MK);
        } else {
          const f2 = calls.length;
          await open(p, "/marketing.html", MK_DENIED);
          const a = answered(uid, ["marketing_tasks", "marketing_task_prices"], f2);
          check(role + ": Marketing - told the list is the office's; nothing asked", /kept by the office/.test(await text(p, "#mkDenied")) && a.asked === 0, JSON.stringify(a));
        }

        // Sales Estimates, the deck wizard, the Materials Library, the drawing tool (Q10)
        const f3 = calls.length;
        if (SALES[role]) {
          await open(p, "/estimates.html", HUB);
          const head = await p.eval("Array.from(document.querySelectorAll('#seList th, #refList th')).map(t => t.textContent).join('|')");
          const sh = await html(p);
          const edit = await p.eval("({ newEst: !document.getElementById('seNew').hidden, add: !document.getElementById('refAdd').hidden, del: document.querySelectorAll('.delEst').length })");
          check(role + ": Sales Estimates - the saved estimates (" + D.ests + ") and the comps; " + (PRICES[role] ? "Benchmark, Range, Price and $/SF with amounts" : "no money column and no amount anywhere") +
            "; " + (SALES_EDIT[role] ? "New / Add / Delete offered" : "read only (no New, Add or Delete)"),
            (await p.eval("document.querySelectorAll('#seList tr.row').length")) === D.ests &&
            (PRICES[role] ? /Benchmark/.test(head) && /Price/.test(head) && AMOUNT.test(sh) : !/Benchmark|Range|Price|\$\/SF/.test(head) && !AMOUNT.test(sh)) &&
            (SALES_EDIT[role] ? edit.newEst && edit.add && edit.del === D.ests : !edit.newEst && !edit.add && !edit.del), JSON.stringify({ head, edit }));
          await p.until("Array.from(document.querySelectorAll('img[data-refpic]')).some(i => i.complete && i.naturalWidth > 0)", 8000);
          check(role + ": Sales Estimates - the comps' photos load through signed URLs of sales-media (the bucket's read policy)", true);
          if (role === "admin") await four(p, "estimates_admin", true, HUB);
          if (role === "sales") await four(p, "estimates_sales", true, HUB);
          await open(p, "/materials-library.html", LIB);
          check(role + ": Materials Library - the lines (" + D.mats + " rows)" + (SALES_EDIT[role] ? " with Add" : " read only"),
            (await p.eval("document.getElementById('mlAdd').hidden")) === !SALES_EDIT[role]);
          if (role === "admin") await four(p, "materials_library_admin", true, LIB);
          await open(p, "/estimate-deck.html?id=" + J.p5c.sent, DECK);
          const dh = await html(p);
          check(role + ": the deck wizard opens the sent estimate" + (PRICES[role] ? "" : " without an amount") + (SALES_EDIT[role] ? "" : " - read only"),
            (PRICES[role] || !AMOUNT.test(dh)) && (SALES_EDIT[role] || /Read only/.test(await text(p, "#edApp"))));
          await open(p, "/cme.html", CME_UP, 25000, true);
          check(role + ": the drawing tool (CME) starts for the switch", true);
          if (role === "admin") await four(p, "cme_admin", false);
          if (!PRICES[role]) {
            const r1 = await raw(p, "c.from('sales_reference_prices').select('reference_id, reference_price')");
            const r2 = await raw(p, "c.from('sales_estimate_prices').select('estimate_id, benchmark_total')");
            check(role + ": asked directly, the database answers no comp price and no benchmark (the prices switch)",
              !r1.error && !r2.error && !(r1.data || []).length && !(r2.data || []).length, JSON.stringify([r1.error, r2.error]));
          }
        } else {
          await open(p, "/estimates.html", "!document.getElementById('seDenied').hidden");
          const sh = await html(p);
          check(role + ": Sales Estimates says it needs the switch, shows nothing and no amount", /Sales estimates switch/.test(await text(p, "#seDenied")) && !AMOUNT.test(sh));
          if (role === "manager") await four(p, "estimates_denied_manager", false, "!document.getElementById('seDenied').hidden");
          await open(p, "/estimate-deck.html?id=" + J.p5c.sent, "/Sales estimates switch/.test(document.getElementById('edApp').innerText)");
          await open(p, "/materials-library.html", "/Sales estimates switch/.test(document.getElementById('mlGroups').innerText)");
          await open(p, "/cme.html", CME_DENIED, 20000, true);
          check(role + ": the deck wizard, the Materials Library and the drawing tool say so too", /Sales estimates switch/.test(await text(p, "#cmeBootWhy")) && !(await p.eval(CME_UP)));
          const a = answered(uid, ["sales_reference_projects", "sales_reference_prices", "sales_estimates", "sales_estimate_prices", "sales_materials"], f3);
          const r = await raw(p, "c.from('sales_estimates').select('id, client_name')");
          check(role + ": every answer the database gave from the sales tables was empty; asked directly it answers no estimate",
            a.rows === 0 && !r.error && !(r.data || []).length, JSON.stringify({ a, r: r.error || (r.data || []).length }));
        }

        // the review queue
        await p.goto(base + "/submissions.html", 400);
        if (REVIEW[role]) {
          await p.until(TOPBAR + " && " + QUEUE, 15000);
          check(role + ": Sub submissions - the review queue opens (money editors)", true);
        } else {
          await p.until("/dashboard\\.html/.test(location.pathname) || " + modalOpen, 12000);
          if (await p.eval(modalOpen)) { await modalOk(p); await p.until("/dashboard\\.html/.test(location.pathname)", 8000); }
          const r = await raw(p, "c.from('sub_submissions').select('id')");
          check(role + ": Sub submissions refused and sent home; asked directly, the database answers no row", /dashboard\.html/.test(await p.eval("location.pathname")) &&
            !r.error && !(r.data || []).length, JSON.stringify(r.error));
        }
      }, p);
    }

    /* ── 2. the writes, through the real policies and RPCs ─────────────── */
    const mg = byRole.manager, ap = byRole.approver, ad = byRole.admin, sa = byRole.sales, ac = byRole.accountant, ld = byRole.lead;
    await attempt("manager: a lead added, edited, converted to a project in one step, and a second convert refused", async () => {
      await open(mg, "/leads.html", LEADS);
      await click(mg, "#ldNewBtn");
      await mg.until("document.getElementById('ldModal').classList.contains('open')", 3000);
      await setVal(mg, "lf_leadClientName", "Pippa Larkspur");
      await setVal(mg, "lf_leadClientPhone", "805.555.0190");
      await setVal(mg, "lf_leadClientAddress", "14 Larkspur Ct, Oak Vista, CA 93422");
      await setVal(mg, "lf_leadCategory", "Pergola");
      await click(mg, "#ldSave");
      await mg.until("!document.getElementById('ldModal').classList.contains('open')", 6000);
      const lead = await one("select id, client_name, client_phone, lead_date::text as d, created_by, version from public.leads where client_name = 'Pippa Larkspur'");
      check("manager: a new lead in the database - as typed, the phone the DCR way, today's company day, by the manager",
        lead && lead.client_phone === "(805) 555-0190" && lead.d === J.today && lead.created_by === J.people.manager, JSON.stringify(lead));
      await click(mg, "[data-edit='" + lead.id + "']");
      await mg.until("document.getElementById('ldModal').classList.contains('open')", 3000);
      await setVal(mg, "lf_leadSource", "Home show");
      await click(mg, "#ldSave");
      await mg.until("!document.getElementById('ldModal').classList.contains('open')", 6000);
      const ed = await one("select source, version from public.leads where id = $1", [lead.id]);
      check("manager: the lead edited - a versioned update", ed.source === "Home show" && ed.version === lead.version + 1, JSON.stringify(ed));
      const next = await one("select 'A' || next_project_number as n from public.settings where id = 1");
      await click(mg, "[data-conv='" + lead.id + "']");
      await mg.until("document.getElementById('cvModal').classList.contains('open')", 3000);
      await setVal(mg, "cvName", "Larkspur pergola");
      await shoot(mg, "leads_convert_manager", "desktop", false, false);
      await click(mg, "#cvGo");
      await mg.until("!document.getElementById('cvModal').classList.contains('open')", 8000);
      const cv = await one(`select l.converted_project_id as pid, l.converted_by, p.number, p.name, p.city, p.client_phone,
          (select string_agg(a.text, '|' order by a.id) from public.activity a where a.project_id = p.id) as log
        from public.leads l join public.projects p on p.id = l.converted_project_id where l.id = $1`, [lead.id]);
      check("manager: convert_lead - the project (the next number " + next.n + ", the client's phone) and the lead linked, in one step; its log says so, without an amount",
        cv && cv.number === next.n && cv.name === "Larkspur pergola" && cv.city === "Oak Vista" && cv.client_phone === "(805) 555-0190" && cv.converted_by === J.people.manager &&
        /created/.test(cv.log || "") && !MONEY_WORDS.test(cv.log || ""), JSON.stringify(cv));
      const again = await raw(mg, "c.rpc('convert_lead', { p_lead_id: " + lead.id + ", p_project_fields: { name: 'Twice' } })");
      check("manager: a second convert is refused by the database ('already converted') and makes nothing",
        again.error && /already converted/i.test(again.error.message) && Number((await one("select count(*) as n from public.projects where name = 'Twice'")).n) === 0, JSON.stringify(again.error));
      J.converted = cv;
      // a lead's own account writes nothing (the database, whatever the page)
      const li = await raw(ld, "c.from('leads').insert({ client_name: 'Not allowed' }).select('id')");
      check("lead: an insert into leads is refused by the database (RLS)", li.error && /42501|row-level/.test(li.error.code + " " + li.error.message), JSON.stringify(li.error));
      await setVal(mg, "ldShow", "all", "change");
      await mg.until("!!document.querySelector('[data-del=\"" + lead.id + "\"]')", 5000);
      await click(mg, "[data-del='" + lead.id + "']");
      await mg.until("!!document.getElementById('dcrMoYes')", 3000);
      await click(mg, "#dcrMoYes");
      await mg.until("!document.querySelector('[data-lead=\"" + lead.id + "\"]')", 6000);
      check("manager: the lead deleted (the project it became stays)", !(await one("select 1 as x from public.leads where id = $1", [lead.id])) &&
        !!(await one("select 1 as x from public.projects where id = $1", [cv.pid])));
    }, mg);

    await attempt("approver (financials): a service scheduled and completed with its cost; a vehicle retired; a task done and priced", async () => {
      await open(ap, "/vehicles.html?id=" + J.p5c.t01, VEH + " && !document.getElementById('vbPanel').hidden");
      await click(ap, "[data-sched='" + J.p5c.t01 + "']");
      await ap.until("document.getElementById('schedModal').classList.contains('open')", 3000);
      await setVal(ap, "smReq", "Oil change and filter");
      await click(ap, "#smSave");
      await ap.until("!document.getElementById('schedModal').classList.contains('open')", 6000);
      const sid = Number((await one("select max(id) as id from public.vehicle_maintenance where vehicle_id = $1", [J.p5c.t01])).id);
      const v0 = await one("select current_mileage from public.vehicles where id = $1", [J.p5c.t01]);
      await click(ap, "[data-done='" + sid + "']");
      await ap.until("document.getElementById('doneModal').classList.contains('open')", 3000);
      await setVal(ap, "dmWork", "Oil and filter, 10 qt");
      await setVal(ap, "dmMiles", String(Number(v0.current_mileage || 0) + 120));
      await setVal(ap, "dmLabor", "1 h");
      await setVal(ap, "dmCost", "$84.20");
      await shoot(ap, "vehicles_complete_approver", "desktop", false, false);
      await click(ap, "#dmSave");
      await ap.until("!document.getElementById('doneModal').classList.contains('open')", 6000);
      const st = await one(`select m.completed_date::text as done, m.labor_time, v.last_oil_date::text as oil, v.last_oil_mileage, v.current_mileage, c.material_cost::text as cost, c.updated_by
        from public.vehicle_maintenance m join public.vehicles v on v.id = m.vehicle_id join public.vehicle_maintenance_costs c on c.maintenance_id = m.id where m.id = $1`, [sid]);
      check("approver: complete_vehicle_maintenance - done today (company day), the oil change stamped on the vehicle, the cost under financials",
        st.done === J.today && st.oil === J.today && st.labor_time === "1 h" && st.last_oil_mileage === Number(v0.current_mileage || 0) + 120 && st.cost === "84.20" &&
        st.updated_by === J.people.approver, JSON.stringify(st));
      const mc = await raw(mg, "c.from('vehicle_maintenance_costs').update({ material_cost: 1 }).eq('maintenance_id', " + sid + ").select('material_cost')");
      check("manager (no financials): writing that cost changes nothing (the database answers no row)", !(mc.data || []).length &&
        (await one("select material_cost::text as c from public.vehicle_maintenance_costs where maintenance_id = $1", [sid])).c === "84.20", JSON.stringify(mc));
      // a vehicle retired
      await open(ap, "/vehicles.html?id=" + J.p5c.spare, VEH + " && !document.getElementById('vbPanel').hidden");
      await click(ap, "[data-editv='" + J.p5c.spare + "']");
      await ap.until("document.getElementById('vehModal').classList.contains('open')", 3000);
      await ap.eval("document.getElementById('vf_vehicleActive').checked = false; true");
      await click(ap, "#vfSave");
      await ap.until("!document.getElementById('vehModal').classList.contains('open')", 6000);
      check("approver: a vehicle retired (a versioned update, kept - never deleted)", (await one("select active from public.vehicles where id = $1", [J.p5c.spare])).active === false);
      // marketing: done, then priced
      await open(ap, "/marketing.html", MK);
      const t = await one("select id from public.marketing_tasks where name = 'Client testimonial interview'");
      await click(ap, "button[data-tgl='" + t.id + "'][data-field=marketingTaskMarkComplete]");
      await sleep(400);
      const done = await one("select done, completed_date::text as d from public.marketing_tasks where id = $1", [t.id]);
      check("approver: a marketing task marked Done - the database stamps the company day", done.done === true && done.d === J.today, JSON.stringify(done));
      await click(ap, "[data-f=all]");
      await ap.until("!!document.querySelector('[data-edit=\"" + t.id + "\"]')", 5000);
      await click(ap, "[data-edit='" + t.id + "']");
      await ap.until("document.getElementById('mkModal').classList.contains('open') && !document.getElementById('mfPriceRow').hidden", 3000);
      await setVal(ap, "mf_marketingTaskPrice", "275");
      await click(ap, "#mkSave");
      await ap.until("!document.getElementById('mkModal').classList.contains('open')", 6000);
      const pr = await one("select price::text as p from public.marketing_task_prices where task_id = $1", [t.id]);
      check("approver: the price kept in its own row (marketing_task_prices, financials - Q17)", pr.p === "275.00", JSON.stringify(pr));
      const mp = await raw(mg, "c.from('marketing_task_prices').update({ price: 1 }).eq('task_id', " + t.id + ").select('price')");
      check("manager (no financials): writing a marketing price changes nothing (no row answered)", !(mp.data || []).length &&
        (await one("select price::text as p from public.marketing_task_prices where task_id = $1", [t.id])).p === "275.00", JSON.stringify(mp));
    }, ap);

    await attempt("admin: a deck estimate from scratch - a photo in sales-media, a CME drawing saved and saved again in place, the money apart", async () => {
      await open(ad, "/estimate-deck.html?new=1", DECK);
      await setVal(ad, "f_client", "Gwendolyn Ashby");
      await setVal(ad, "f_addr", "44 Willow Creek Rd");
      await setVal(ad, "f_city", "Willow Creek");
      await click(ad, ".ed-pick-card.pt[data-id='new-deck']");
      await setVal(ad, "f_deck", "400");
      await setVal(ad, "f_rail", "50");
      await click(ad, ".ed-pick-card.cx[data-id='moderate']");
      await dropPhoto(ad, "#edGallery .dg-wrap", "Back yard.jpg", 30);
      await ad.until("document.querySelectorAll('#edGallery .dg-tile img').length === 1", 10000);
      await ad.until("/auto-saved/.test(document.getElementById('autoSaveMsg').textContent)", 10000);
      const st = await ad.eval("({ id: DCR2DeckEstimate.state.estimateId, ref: DCR2DeckEstimate.state.estimateRef, photo: DCR2DeckEstimate.state.media.photos[0] })");
      const obj = await one("select owner_id, metadata->>'mimetype' as mime from storage.objects where bucket_id = 'sales-media' and name = $1", [st.photo.path]);
      const row = await one("select status, client_name, media from public.sales_estimates where id = $1", [st.id]);
      check("admin: the photo is an object of sales-media under the estimate's folder (put by the admin under the bucket's policy), and the draft row is auto-saved with it",
        /^estimates\/EST-[A-Z0-9]+\/[0-9a-f]{32}\/Back_yard\.jpg$/.test(st.photo.path) && obj && obj.owner_id === J.people.admin && obj.mime === "image/jpeg" &&
        row.status === "draft" && row.client_name === "Gwendolyn Ashby" && row.media.photos[0].path === st.photo.path, JSON.stringify({ path: st.photo.path, obj }));
      await click(ad, "#edNewDrawing");
      await ad.until("document.getElementById('cmeShell').classList.contains('open') && !!(document.getElementById('cmeFrame').contentDocument || {}).querySelector && !!document.getElementById('cmeFrame').contentDocument.querySelector('.model-canvas')", 25000);
      await ad.eval("document.getElementById('cmeFrame').contentDocument.querySelector('[data-action=\"save-step-one\"]').click(); true");
      await ad.until("!document.getElementById('cmeShell').classList.contains('open') && DCR2DeckEstimate.state.media.photos.some(p => p.cme)", 25000);
      const dr = await ad.eval("DCR2DeckEstimate.state.media.photos.find(p => p.cme)");
      const o1 = await one("select id, updated_at::text as at from storage.objects where bucket_id = 'sales-media' and name = $1", [dr.path]);
      check("admin: the CME drawing - its PNG at estimates/<ref>/cme/cme-<id>.png in sales-media, the entry's 'cme' key (never 'cad')",
        !("cad" in dr) && !!dr.cme && new RegExp("^estimates/" + st.ref + "/cme/cme-[0-9a-z-]{8,64}\\.(png|jpg)$", "i").test(dr.path) && !!o1, dr.path);
      await sleep(1200);
      await ad.eval("(() => { const t = Array.from(document.querySelectorAll('#edGallery .dg-act')).find(b => /model/.test(b.textContent)); t.click(); return true; })()");
      await ad.until("!!(document.getElementById('cmeFrame').contentDocument || {}).querySelector && !!document.getElementById('cmeFrame').contentDocument.querySelector('.model-canvas')", 25000);
      await ad.eval("document.getElementById('cmeFrame').contentDocument.querySelector('[data-action=\"save-step-one\"]').click(); true");
      await ad.until("!document.getElementById('cmeShell').classList.contains('open')", 25000);
      await sleep(800);
      const dr2 = await ad.eval("DCR2DeckEstimate.state.media.photos.filter(p => p.cme)");
      const o2 = await one("select id, updated_at::text as at from storage.objects where bucket_id = 'sales-media' and name = $1", [dr.path]);
      const nCme = Number((await one("select count(*) as n from storage.objects where bucket_id = 'sales-media' and name like $1", ["estimates/" + st.ref + "/%cme%"])).n);
      check("admin: re-saving the drawing replaces the SAME object in place (the bucket's 'replace drawings' policy) - one drawing, one file",
        dr2.length === 1 && dr2[0].path === dr.path && o2 && o2.id === o1.id && nCme === 1, JSON.stringify({ n: dr2.length, nCme, same: o2 && o2.id === o1.id }));
      await four(ad, "deck_step1_admin", true, DECK);
      // steps 2 to 5: a reference, a product, the rates; saved with its money apart
      await click(ad, "#s1next");
      await ad.until("document.querySelectorAll('.ed-match').length >= 3", 8000);
      await click(ad, ".pickRef[data-ref='DEMO-DECK-101']");
      await click(ad, "#s2next");
      await ad.until("document.querySelectorAll('.ed-mat').length >= 3", 8000);
      await click(ad, ".ed-mat[data-mat='brightwood-ridge'] .hd");
      await click(ad, "#s3next");
      await ad.until("document.querySelectorAll('.rateIn').length >= 1", 8000);
      await ad.eval("(() => { const i = document.querySelector('.rateIn[data-rate=\"framingSF\"]'); i.value = '18'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
      await click(ad, "#s4next");
      await ad.until("/Benchmark total/.test(document.getElementById('edApp').innerText)", 8000);
      await setVal(ad, "s5status", "preliminary", "change");
      await click(ad, "#s5save");
      await ad.until("/Saved \\(/.test(document.getElementById('s5msg').textContent)", 10000);
      const saved = await one("select to_jsonb(e) - 'media' as e, to_jsonb(p) as p from public.sales_estimates e join public.sales_estimate_prices p on p.estimate_id = e.id where e.id = $1", [st.id]);
      check("admin: saved - the estimate (preliminary, its reference) with no money in it; the benchmark and the rates only in sales_estimate_prices",
        saved.e.status === "preliminary" && saved.e.reference_project_id && !/"(rates|benchmark|laborRate|pricing|output|range)"/.test(JSON.stringify(saved.e)) &&
        Number(saved.p.benchmark_total) > 0 && saved.p.pricing && saved.p.pricing.rates && saved.p.pricing.rates.framingSF === "18", JSON.stringify({ s: saved.e.status, b: saved.p.benchmark_total }));
      await four(ad, "deck_step5_admin", true, "/Benchmark total/.test(document.getElementById('edApp').innerText)");
      J.newEst = st;
    }, ad);

    await attempt("Sasha Seller (the switch, no prices): her draft saved without touching its prices; the database refuses the rest", async () => {
      const before = JSON.stringify(await one("select to_jsonb(p) - 'updated_at' - 'version' as p from public.sales_estimate_prices p where estimate_id = $1", [J.p5c.draft]));
      await open(sa, "/estimate-deck.html?id=" + J.p5c.draft, "!!document.getElementById('f_notes')");
      const notes = await sa.eval("({ v: document.getElementById('f_notes').value, d: document.getElementById('f_notes').disabled })");
      check("sales: the notes' typed amount is masked and read only", /amount hidden/.test(notes.v) && notes.d && !AMOUNT.test(await html(sa)), JSON.stringify(notes));
      await sa.eval("document.querySelector('.ed-step[data-step=\"3\"]').click(); true");
      await sa.until("document.querySelectorAll('.ed-mat').length >= 3", 8000);
      await click(sa, ".ed-mat[data-mat='brightwood-trailhead'] .hd");
      await sa.until("!!document.querySelector('.ed-mat.sel')", 4000);
      await click(sa, "#s3next");
      await sa.until("!!document.getElementById('s4next')", 6000);
      check("sales: step 4 has no rate editor (the rates need the prices switch)", (await sa.eval("document.querySelectorAll('.rateIn').length")) === 0);
      await click(sa, "#s4next");
      await sa.until("!!document.getElementById('s5save')", 8000);
      check("sales: step 5 shows no benchmark, no range and no amount", !/Benchmark total|Comparable range/.test(await text(sa, "#edApp")) && !AMOUNT.test(await html(sa)));
      await click(sa, "#s5save");
      await sa.until("/Saved \\(/.test(document.getElementById('s5msg').textContent)", 10000);
      const after = JSON.stringify(await one("select to_jsonb(p) - 'updated_at' - 'version' as p from public.sales_estimate_prices p where estimate_id = $1", [J.p5c.draft]));
      const e = await one("select notes, updated_by from public.sales_estimates where id = $1", [J.p5c.draft]);
      check("sales: saved by her - the notes' words untouched (the masked copy never sent), the prices row untouched", after === before && /\$9,500/.test(e.notes || "") &&
        e.updated_by === J.people.sales, JSON.stringify({ same: after === before, by: e.updated_by === J.people.sales }));
      const cad = await raw(sa, "c.from('sales_estimates').select('id, version, media').eq('id', " + J.p5c.draft + ").single().then(async (r) => { const m = r.data.media; m.photos = (m.photos || []).concat([{ path: 'estimates/EST-DEMO2/x/cad.png', name: 'cad.png', cad: { v: 1 } }]); return c.from('sales_estimates').update({ media: m }).eq('id', r.data.id).eq('version', r.data.version).select('id'); })");
      check("sales: a NEW 'cad' drawing is refused by the database (CME output lives under 'cme')", cad.error && cad.error.code === "23514", JSON.stringify(cad.error));
      const lib = await raw(ac, "c.from('sales_materials').insert({ item_key: 'not-allowed', item_name: 'Not allowed' }).select('id')");
      check("accountant (the switch, not a sales editor): an insert into the Materials Library is refused by the database", lib.error && /42501|row-level/.test(lib.error.code + " " + lib.error.message), JSON.stringify(lib.error));
    }, sa);

    await attempt("admin: the Materials Library - a new line with a photo in sales-media", async () => {
      await open(ad, "/materials-library.html", LIB);
      await click(ad, "#mlAdd");
      await ad.until("document.getElementById('mlModal').classList.contains('open')", 4000);
      await setVal(ad, "mName", "Kestrel Ridge Hardwood");
      await setVal(ad, "mBrand", "Kestrel");
      await setVal(ad, "mSubCat", "Hardwood Decking");
      await dropPhoto(ad, "#mGallery .dg-wrap", "Kestrel board.jpg", 20);
      await ad.until("document.querySelectorAll('#mGallery .dg-tile img').length === 1", 10000);
      await click(ad, "#mSave");
      await ad.until("!document.getElementById('mlModal').classList.contains('open') && /Kestrel Ridge Hardwood/.test(document.getElementById('mlGroups').innerText)", 10000);
      const row = await one("select item_key, pictures from public.sales_materials where item_name = 'Kestrel Ridge Hardwood'");
      const obj = row && row.pictures[0] && await one("select 1 as x from storage.objects where bucket_id = 'sales-media' and name = $1", [row.pictures[0].path]);
      check("admin: the line saved (kestrel-ridge-hardwood) with its photo's object in sales-media/materials/", row && row.item_key === "kestrel-ridge-hardwood" &&
        /^materials\//.test(row.pictures[0].path) && !!obj, JSON.stringify(row && row.pictures[0]));
    }, ad);

    /* ── 3. the PUBLIC form, signed out, on a phone (acceptance check 4) ── */
    const P = await newPage(cdp, "public", OUT); pages.push(P);
    const fill = (p, f) => p.eval("(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; " +
      Object.entries(f).map(([k, v]) => "set(" + JSON.stringify(k) + ", " + JSON.stringify(v) + ");").join(" ") + " return true; })()");
    const sign = (p) => p.eval(`(() => {
      const cv = document.getElementById('sfSig'); const r = cv.getBoundingClientRect();
      const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true,
        clientX: r.left + x * r.width, clientY: r.top + y * r.height }));
      ev('pointerdown', 0.08, 0.6);
      for (let i = 1; i <= 40; i++) ev('pointermove', 0.08 + i * 0.018, 0.6 - Math.sin(i / 3) * 0.18);
      ev('pointerup', 0.8, 0.55);
      return document.getElementById('sfSigState').textContent; })()`);
    const attach = (p, name, type, size) => p.eval(`(() => {
      const input = document.getElementById('sfFile'); const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(${size}).fill(37)], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
      input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      return document.getElementById('sfDocName').textContent; })()`);
    const msg = (p) => p.eval("document.getElementById('sfMsg').textContent");
    let REF = null;
    const subs0 = Number((await one("select count(*) as n from public.sub_submissions")).n);
    await attempt("the public form: no sign-in, the real subform function, a submission with its paperwork", async () => {
      await P.size(390, 844, true);
      await P.goto(base + "/submit.html", 600);
      await P.until("!!document.getElementById('sfForm') && !!window.DCR2PGlite", 10000);
      const where = await P.eval("({ path: location.pathname, bar: !!document.querySelector('.dcr2-topbar'), auth: Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter(k => k.indexOf('dcr2-auth') === 0) })");
      check("public form: opens with no sign-in (no bounce, no top bar, no session)", where.path === "/submit.html" && !where.bar && !where.auth.length, JSON.stringify(where));
      const anon = await P.eval("(async () => { const c = supabase.createClient('https://x.supabase.co', 'k', { auth: { persistSession: false } }); const a = await c.rpc('subform_projects', { p_q: 'Madeup' }); const b = await c.from('sub_submissions').select('id'); const d = await c.from('projects').select('id'); return { a: a.error && a.error.code, b: b.error ? b.error.code : (b.data || []).length, d: d.error ? d.error.code : (d.data || []).length }; })()");
      check("signed out, the database itself answers nothing: subform_projects refused (the service role's only), no submission, no project",
        anon.a === "42501" && (anon.b === 0 || anon.b === "42501") && (anon.d === 0 || anon.d === "42501"), JSON.stringify(anon));
      await fill(P, { sfSearch: J.p1.number.slice(0, 2) });
      await sleep(700);
      check("search: fewer than 3 characters shows and asks nothing", await P.eval("document.getElementById('sfHits').hidden"));
      for (const shut of [J.closed, J.completed]) {
        await fill(P, { sfSearch: shut.number });
        await P.until("!document.getElementById('sfHits').hidden && /No open job matches/.test(document.getElementById('sfHits').textContent)", 6000);
      }
      check("search: a closed job and a completed one are not offered (subform_projects: open jobs only)", true);
      await fill(P, { sfSearch: "Pat Example" });
      await P.until("document.querySelectorAll('#sfHits .hit').length > 0", 6000);
      const byClient = await P.eval("document.getElementById('sfHits').innerText");
      check("search: the client's name finds the job but is never shown", byClient.includes(J.p1.number) && !/Pat Example/.test(byClient), byClient);
      await fill(P, { sfSearch: J.p1.number });
      await P.until("document.querySelectorAll('#sfHits .hit').length === 1", 6000);
      await shoot(P, "submit_search_anonymous", "phone", false, false);
      await P.size(390, 844, true);
      await P.eval("document.querySelector('#sfHits .hit').click(); true");
      await sign(P);
      await attach(P, "invoice-1042.pdf", "application/pdf", 48000);
      await P.eval("document.getElementById('sfGo').click(); true");
      await P.until("/Enter your company name/.test(document.getElementById('sfMsg').textContent)", 6000);
      const all = await msg(P);
      check("submit: every problem at once, in the function's words", ["company", "your name", "email", "amount", "Describe", "full name", "declaration"].every((w) => all.toLowerCase().includes(w.toLowerCase())), all);
      const good = { sfCompany: "Juniper Glass", sfContact: "Jun Iper", sfEmail: "jun@juniper-glass.example", sfPhone: "(805) 555-0190", sfAmount: "1,375.50",
        sfNumber: "G-12", sfDesc: "Shower glass, first fitting at the main bath.", sfSigName: "Jun Iper" };
      await fill(P, Object.assign({}, good, { sfWebsite: "http://spam.example" }));
      await P.eval("document.getElementById('sfAgree').checked = true; document.getElementById('sfGo').click(); true");
      await P.until("/could not be accepted/.test(document.getElementById('sfMsg').textContent)", 6000);
      check("submit: the honeypot - the generic refusal, nothing stored", Number((await one("select count(*) as n from public.sub_submissions")).n) === subs0);
      for (const bad of ["5000000.01", "0"]) {
        await fill(P, Object.assign({}, good, { sfWebsite: "", sfAmount: bad }));
        await P.eval("document.getElementById('sfGo').click(); true");
        await P.until("document.getElementById('sfMsg').textContent.length > 5 && /amount/i.test(document.getElementById('sfMsg').textContent)", 6000);
      }
      check("submit: amounts over 5,000,000 and of 0 are refused, nothing stored", Number((await one("select count(*) as n from public.sub_submissions")).n) === subs0);
      await shoot(P, "submit_form_anonymous", "phone", false, true);
      await shoot(P, "submit_form_anonymous", "phone", true, true);
      await P.size(390, 844, true);
      await fill(P, good);
      await P.eval("document.getElementById('sfGo').click(); true");
      await P.until("!document.getElementById('sfDone').hidden", 12000);
      REF = await P.eval("(document.getElementById('sfRef') || {}).textContent");
      const s = await one(`select state, kind, amount::text as amount, project_id, document_path, signature_path, document_attached_at is not null as attached, document_size, document_mime,
          submitted_ip, bill_id from public.sub_submissions where reference = $1`, [REF]);
      const objs = await sql("select name, metadata->>'mimetype' as mime from storage.objects where bucket_id = 'project-files' and name in ($1, $2)", [s && s.document_path, s && s.signature_path]);
      const inbox = Number((await one("select count(*) as n from storage.objects where bucket_id = 'subform-inbox'")).n);
      check("in the database: a PENDING invoice on that job (never a bill), its signature and paperwork objects under f/" + J.p1.id + "/receipts/ - the paperwork through ONE signed upload, attached",
        s && s.state === "pending" && s.kind === "invoice" && s.amount === "1375.50" && Number(s.project_id) === Number(J.p1.id) && s.attached && Number(s.document_size) === 48000 &&
        s.document_mime === "application/pdf" && new RegExp("^f/" + J.p1.id + "/receipts/[0-9a-f]{32}/SUB INVOICE " + REF + "\\.pdf$").test(s.document_path) &&
        new RegExp("^f/" + J.p1.id + "/receipts/[0-9a-f]{32}/SUB INVOICE " + REF + " signature\\.png$").test(s.signature_path) && objs.length === 2 && s.bill_id === null &&
        S.p5c.tokens.size === 0 && inbox === 0, JSON.stringify({ s, objs: objs.length, tokens: S.p5c.tokens.size, inbox }));
      check("the paperwork went to the private inbox (subform-inbox) and reached project-files only through 'attached' (checked, copied, the inbox emptied)",
        inbox === 0 && objs.some((o) => o.name === s.document_path), String(inbox));
      const again = await S.p5c.call({ op: "attached", reference: REF, path: s.document_path });
      check("'attached' only once (the second answers 400, nothing changes)", again.status === 400 && /already attached/.test(again.body && again.body.message), JSON.stringify(again.body));
      await four(P, "submit_done_anonymous", false, "!document.getElementById('sfDone').hidden");
    }, P);

    await attempt("the function itself: CORS for portal.dcrframing.com only, another site refused, the rate limit", async () => {
      const pre = await S.p5c.call(null, { method: "OPTIONS" });
      const other = await S.p5c.call({ op: "projects", q: J.p1.number }, { origin: "https://evil.example" });
      const none = await S.p5c.call({ op: "projects", q: J.p1.number }, { origin: false });
      check("CORS: OPTIONS 204 with Access-Control-Allow-Origin https://portal.dcrframing.com; a browser on another site 403 with no CORS header",
        pre.status === 204 && pre.headers["access-control-allow-origin"] === "https://portal.dcrframing.com" && other.status === 403 && !other.headers["access-control-allow-origin"] &&
        none.status === 200, JSON.stringify({ pre: pre.status, acao: pre.headers["access-control-allow-origin"], other: other.status, none: none.status }));
      let last = null;
      for (let i = 0; i < S.p5c.fn.RATE.projects.limit + 1; i++) last = await S.p5c.call({ op: "projects", q: J.p1.number }, { ip: "198.51.100.77" });
      const elsewhere = await S.p5c.call({ op: "projects", q: J.p1.number }, { ip: "198.51.100.78" });
      check("the IP rate limit: over " + S.p5c.fn.RATE.projects.limit + " searches -> 429 with Retry-After; another address goes through",
        last.status === 429 && Number(last.headers["retry-after"]) > 0 && elsewhere.status === 200, JSON.stringify({ last: last.status, ra: last.headers["retry-after"], other: elsewhere.status }));
    });

    // two more from the form (another address): a change order without paperwork, an invoice whose paperwork never came
    const pngSig = async () => P.eval("(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 60; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 200, 60); x.strokeStyle = '#000'; x.beginPath(); x.moveTo(10, 40); x.lineTo(190, 20); x.stroke(); return c.toDataURL('image/png'); })()");
    let CO = null, NODOC = null;
    await attempt("two more submissions through the function: a change order, an invoice whose paperwork never came", async () => {
      const sig = await pngSig();
      const base0 = { projectId: String(J.p1.id), vendorCompany: "Madeup Electric", contactName: "Eli Madeup", email: "eli@madeup-electric.example", phone: "",
        invoiceDate: "", dueDate: "", signatureName: "Eli Madeup", signature: sig, agree: true, website: "" };
      const co = await S.p5c.call(Object.assign({ op: "submit", kind: "Change order", amount: "860", invoiceNumber: "CO-3", description: "Six more outlets in the garage.", document: null }, base0), { ip: "198.51.100.90" });
      const nd = await S.p5c.call(Object.assign({ op: "submit", kind: "Invoice", amount: "420", invoiceNumber: "E-9", description: "Trenching for the conduit.", document: { type: "application/pdf", size: 3000 } }, base0), { ip: "198.51.100.90" });
      CO = co.body && co.body.reference; NODOC = nd.body && nd.body.reference;
      check("the change order (no paperwork asked) and the invoice (its signed upload never used) are pending", co.status === 201 && nd.status === 201 && !co.body.upload && !!nd.body.upload,
        JSON.stringify({ co: co.status, nd: nd.status }));
    });

    /* ── 4. the notices: amount-free e-mails to the reviewers, for DCR Agents 2 ── */
    await attempt("the notices: one amount-free e-mail per admin, accountant and approver; never a push", async () => {
      const rows = await sql(`select o.kind, o.to_profile_id, o.subject, o.body, o.email_wanted, o.push_result, o.submission_ids from public.notifications_outbox o
        where o.id > $1 order by o.id`, [outbox0]);
      const ids = (await sql("select id, reference from public.sub_submissions where reference in ($1, $2, $3)", [REF, CO, NODOC]));
      const idOf = (ref) => Number((ids.find((x) => x.reference === ref) || {}).id);
      const forRef = (ref) => rows.filter((r) => (r.submission_ids || []).map(Number).indexOf(idOf(ref)) !== -1);
      const to = forRef(REF).map((r) => Object.keys(J.people).find((k) => J.people[k] === r.to_profile_id)).sort();
      check("the new invoice's notices: to the admin, the accountant and the approver only (not a manager without approve, Sasha, a lead, field or view-only)",
        JSON.stringify(to) === JSON.stringify(["accountant", "admin", "approver"]), to.join(","));
      check("ONE waiting e-mail per person for the three submissions (the later two folded into the first: '3 new subcontractor submissions waiting for review', each reference listed), e-mail wanted, never a push ('e-mail only'), the review link, no amount and no description",
        rows.length === 3 && rows.every((r) => r.kind === "sub_submission" && r.email_wanted && r.push_result === "e-mail only" && (r.submission_ids || []).length === 3 &&
          r.subject === "3 new subcontractor submissions waiting for review" && [REF, CO, NODOC].every((x) => r.body.includes(x)) && r.body.includes("/submissions.html") &&
          !MONEY_WORDS.test(r.subject + " " + r.body) && !/Shower glass|outlets|Trenching/.test(r.body)), JSON.stringify(rows.map((r) => [r.subject, (r.submission_ids || []).length, r.push_result])));
    });

    /* ── 5. the review (acceptance check 4) and The Books ─────────────── */
    const rv = await newPage(cdp, "accountant-review", OUT); pages.push(rv);
    const stale = await newPage(cdp, "admin-stale", OUT); pages.push(stale);
    let BILL = null;
    await attempt("the review: accept is not approve; a second accept is already done; no paperwork, no accept; reject; the change order", async () => {
      await rv.size(1440, 900, false);
      await signIn(rv, "accountant", "submissions.html?ref=" + REF);
      await rv.until("!!document.querySelector('.sb-card.focus')", 12000);
      check("the e-mail's link (?ref=) shows that submission first", (await rv.eval("document.querySelector('.sb-card').id")) === "sub-" + REF);
      await stale.size(1440, 900, false);
      await signIn(stale, "admin", "submissions.html");
      await stale.until("!!document.querySelector('#sub-" + REF + " [data-accept]')", 12000);
      await four(rv, "submissions_accountant", true, "!!document.querySelector('.sb-card')");
      const noDoc = await rv.eval("(() => { const c = document.getElementById('sub-" + NODOC + "'); return c ? { disabled: c.querySelector('[data-accept]').disabled, why: (c.querySelector('.sb-warn') || {}).textContent || '' } : null; })()");
      check("an invoice without its paperwork cannot be accepted, and the page says why", noDoc && noDoc.disabled && /No document is attached/.test(noDoc.why), JSON.stringify(noDoc));
      const nd = await one("select id, version from public.sub_submissions where reference = $1", [NODOC]);
      const forced = await raw(rv, "c.rpc('accept_submission', { p_id: " + nd.id + ", p_version: " + nd.version + ", p_quote_id: null })");
      check("...and the database refuses it too (23514)", forced.error && forced.error.code === "23514" && /no document attached/.test(forced.error.message), JSON.stringify(forced.error));
      const mgr = await raw(mg, "c.rpc('accept_submission', { p_id: " + nd.id + ", p_version: " + nd.version + ", p_quote_id: null })");
      check("a manager without financials may not review (42501)", mgr.error && mgr.error.code === "42501", JSON.stringify(mgr.error));
      await rv.eval("document.querySelector('#sub-" + REF + " [data-accept]').click(); true");
      await rv.until(modalOpen, 5000);
      await modalOk(rv);
      for (let i = 0; i < 40 && !(await one("select bill_id from public.sub_submissions where reference = $1", [REF])).bill_id; i++) await sleep(250);
      const b = await one(`select b.id, b.amount::text as amount, b.approved_at, b.approved_by, b.kind, b.vendor_name, b.invoice_number, f.storage_path, f.folder, f.source, s.state, s.reviewed_by
        from public.sub_submissions s join public.bills b on b.id = s.bill_id join public.files f on f.id = b.document_file_id where s.reference = $1`, [REF]);
      const sd = await one("select document_path from public.sub_submissions where reference = $1", [REF]);
      check("accepted by the accountant: a bill that is NOT approved (kind Subcontractor), its document the uploaded paperwork (files.source subform, receipts)",
        b && b.state === "accepted" && b.reviewed_by === J.people.accountant && b.amount === "1375.50" && b.approved_at === null && b.approved_by === null && b.kind === "Subcontractor" &&
        b.storage_path === sd.document_path && b.folder === "receipts" && b.source === "subform", JSON.stringify(b));
      BILL = b && b.id;
      await stale.eval("document.querySelector('#sub-" + REF + " [data-accept]').click(); true");
      await stale.until(modalOpen, 5000);
      await modalOk(stale);
      await stale.until("/Already done/.test(document.body.innerText)", 8000);
      check("a second accept from a page opened before says 'already done' and files nothing more",
        Number((await one("select count(*) as n from public.bills where description like $1", ["%" + REF + "%"])).n) === 1);
      await rv.goto(base + "/submissions.html", 400);
      await rv.until("!!document.querySelector('#sub-" + NODOC + " [data-reject]')", 12000);
      await rv.eval("document.querySelector('#sub-" + NODOC + " [data-reject]').click(); true");
      await rv.until(modalOpen, 5000);
      await rv.eval("document.getElementById('dcrMoF0').value = 'Sent to the wrong company'; true");
      await modalOk(rv);
      for (let i = 0; i < 40 && (await one("select state from public.sub_submissions where reference = $1", [NODOC])).state === "pending"; i++) await sleep(250);
      const rj = await one("select state, review_note, reviewed_by from public.sub_submissions where reference = $1", [NODOC]);
      check("rejected with its note (reject_submission)", rj.state === "rejected" && rj.review_note === "Sent to the wrong company" && rj.reviewed_by === J.people.accountant, JSON.stringify(rj));
      await rv.until("!!document.querySelector('#sub-" + CO + " [data-accept]')", 8000);
      await rv.eval("document.querySelector('#sub-" + CO + " [data-accept]').click(); true");
      await rv.until(modalOpen, 5000);
      await modalOk(rv);
      for (let i = 0; i < 40 && (await one("select state from public.sub_submissions where reference = $1", [CO])).state === "pending"; i++) await sleep(250);
      const q = await one("select q.kind, q.status, q.project_id, p.amount::text as amount from public.sub_submissions s join public.quotes q on q.id = s.quote_id join public.quote_prices p on p.quote_id = q.id where s.reference = $1", [CO]);
      check("the change order became the job's own change order (awarded), its amount under quote_prices", q && q.kind === "change_order" && q.status === "awarded" &&
        Number(q.project_id) === Number(J.p1.id) && q.amount === "860.00", JSON.stringify(q));
      await rv.eval("document.getElementById('sbTab-accepted').click(); true");
      await sleep(500);
      await four(rv, "submissions_accepted_accountant", true);
    }, rv);

    await attempt("The Books: the accepted bill waits for approval - in The Books, on the bill page and on the approver's home page; approved there with a pay method", async () => {
      await open(rv, "/accounting.html", "!!document.getElementById('secQbo')");
      await rv.until("/Juniper Glass/.test((document.getElementById('secWaiting') || {}).innerText || '')", 10000);
      check("The Books (accountant): the bill is under 'Not ready - and who it is on' (waiting for approval), not ready to enter", !/Juniper Glass/.test(await text(rv, "#secQbo")));
      await rv.eval("document.getElementById('secWaiting').scrollIntoView({ block: 'start' }); true");
      await shoot(rv, "books_waiting_accountant", "desktop", false, false);
      await open(rv, "/bill.html?id=" + BILL, "!!document.getElementById('blState')");
      check("the bill page: AWAITING APPROVAL, the accountant cannot approve", (await rv.eval("document.getElementById('blState').textContent")) === "AWAITING APPROVAL" &&
        !(await rv.eval("!!document.getElementById('blGo')")));
      await shoot(rv, "bill_awaiting_accountant", "desktop", false, false);
      await open(ap, "/dashboard.html", "!!document.getElementById('hmApprovalsCard')");
      check("the approver's home page: the bill in the approvals card", /Juniper Glass/.test(await text(ap, "#hmApprovalsCard")));
      await open(ap, "/bill.html?id=" + BILL, "!!document.getElementById('blGo')");
      await ap.eval("document.getElementById('blGo').click(); true");
      await ap.until(modalOpen, 5000);
      await ap.eval("(() => { const s = document.querySelector('.dcr-mo.open select'); s.value = 'check'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
      await modalOk(ap);
      for (let i = 0; i < 40 && !(await one("select approved_at from public.bills where id = $1", [BILL])).approved_at; i++) await sleep(250);
      const bb = await one("select approved_by, pay_method, approved_amount::text as a from public.bills where id = $1", [BILL]);
      check("approved by the approver (approve_bill: a pay method, the amount frozen) - accepting was not approving; approving is its own step",
        bb.approved_by === J.people.approver && bb.pay_method === "check" && bb.a === "1375.50", JSON.stringify(bb));
      // the review queue's Accepted tab follows the bill as it is now (never a status it cannot know)
      await open(rv, "/submissions.html", "!!document.getElementById('sbTab-accepted')");
      await rv.eval("document.getElementById('sbTab-accepted').click(); true");
      await rv.until("!!document.querySelector('#sub-" + REF + " .sb-done')", 8000);
      const line = await text(rv, "#sub-" + REF + " .sb-done");
      check("the Accepted tab: the invoice's line says its bill is approved now (not 'waiting for approval')",
        line.indexOf("bill #" + BILL + " (approved)") !== -1 && !/waiting for approval/.test(line), line);
      await four(rv, "submissions_accepted_accountant", true);
    }, rv);

    await attempt("DCR Agents 2's take: the waiting notices handed over, the reviewed ones set aside", async () => {
      const agents = "e5c00000-0000-4000-8000-0000000000a9";
      await sql("insert into auth.users (id, email) values ($1, 'agents@e2e.test')", [agents]);
      await asPerson(J.people.admin, "insert into public.profiles (id, full_name, email, role) values ($1, 'DCR Office (made up)', 'agents@e2e.test', 'agents')", [agents]);
      const got = (await asPerson(agents, "select public.agents_outbox_take(50) as r"))[0].r;
      const set = await sql(`select o.error from public.notifications_outbox o where o.id > $1`, [outbox0]);
      check("agents_outbox_take (the agents account): every notice was about submissions all reviewed since - all set aside ('already reviewed'), none handed over to e-mail",
        Array.isArray(got.items) && got.items.length === 0 && set.length === 3 && set.every((x) => /already reviewed/.test(x.error || "")), JSON.stringify({ items: got.items.length, set: set.map((x) => x.error) }));
      // a fresh one, not reviewed: handed over (amount-free, the masking flag per recipient)
      const sig = await pngSig();
      const fresh = await S.p5c.call({ op: "submit", kind: "Invoice", projectId: String(J.p2.id), vendorCompany: "Madeup Paint", contactName: "Pia Madeup", email: "pia@madeup-paint.example",
        phone: "", invoiceNumber: "P-4", amount: "2,000", description: "Primer coat.", invoiceDate: "", dueDate: "", signatureName: "Pia Madeup", signature: sig, agree: true,
        website: "", document: null }, { ip: "198.51.100.95" });
      const got2 = (await asPerson(agents, "select public.agents_outbox_take(50) as r"))[0].r;
      check("a fresh submission's three notices are handed to DCR Agents 2 (kind sub_submission, submission_id, no amount)",
        fresh.status === 201 && got2.items.length === 3 && got2.items.every((x) => x.kind === "sub_submission" && x.submission_id && x.to_email && !MONEY_WORDS.test(x.subject + " " + x.body)),
        JSON.stringify(got2.items.map((x) => [x.kind, !!x.submission_id, x.masked])));
    });

    /* ── 6. P5 acceptance check 5 ──────────────────────────────────────── */
    await attempt("acceptance check 5: no amount in any activity row or outbox body written during the walk", async () => {
      const acts = await sql("select text from public.activity where id > $1", [acts0]);
      const box = await sql("select subject, body from public.notifications_outbox where id > $1", [outbox0]);
      const bad = acts.map((x) => x.text).concat(box.map((x) => x.subject + " " + x.body)).filter((t) => MONEY_WORDS.test(String(t)));
      check("acceptance check 5: " + acts.length + " activity rows and " + box.length + " outbox rows written, none with an amount", bad.length === 0, bad.slice(0, 4).join(" | "));
    });

    /* ── 7. no security-policy violation, no console error ─────────────── */
    for (const p of pages) {
      const bad = p.log.filter((x) => /CSP-VIOLATION|Content Security Policy/i.test(x.text) || x.level === "exception" ||
        (x.level === "error" && !/favicon\.ico|net::ERR_ABORTED/.test(x.text + " " + (x.url || ""))));
      check(p.name + ": no CSP violation, no console error", !bad.length, bad.slice(0, 5).map((x) => x.level + " " + x.text.slice(0, 220) + " @ " + x.url).join(" | "));
    }
  } finally {
    try { proc.kill(); } catch (e) { /* */ }
    await S.close().catch(() => {});
    void profile;
  }
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results, shots, out: OUT }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
