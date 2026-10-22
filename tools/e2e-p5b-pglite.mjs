#!/usr/bin/env node
/* DCR Portal 2 — the P5b pages end to end on the REAL database rules (development only).

     PGLITE_DIR=<folder with node_modules/@electric-sql/pglite> node tools/e2e-p5b-pglite.mjs [--out <dir>] [--chrome <path>]
       [--shots final|none] [--prefix p5b_final_]

   Starts tools/pglite-serve.mjs (the site, with every page's supabase-js calls replayed on PGlite loaded with every
   DCR Desktop 2 migration - M5a 20261025000100_office_pm and M5b 20261026000100_books_ledger included - as the
   signed-in person) and drives a local Chrome or Edge headless, whose resolver sends *.supabase.co nowhere:

   - every role - admin, a manager WITH the approve switch (and financials, no prices), a manager without either (Q1),
     accountant, lead, field, view-only - on every P5b page: the home page (The Books card with financials; the
     approvals card for an approver only - never the accountant), The Books, the bill page, Expenses & receipts, the
     printed expense report, the project's Expenses and Payments tabs. Without financials: refused or hidden, no
     amount on any page, and every answer the database gave them from a money table was empty;
   - P5 acceptance check 2 through the pages: the approver approves with a REQUIRED pay method (an empty choice is
     refused in the dialog), changes how an approved unpaid bill is paid; the database refuses the accountant and a
     manager without approve (42501, 403), a stale version (PT409, 409 - and the page shows the bill again), a
     missing pay method (22023, 400), a bill without its document (23514); an edit of an approved bill's amount
     clears the approval; a payment over the approved amount, or by a method the approver did not allow, is refused;
   - the check desk: payee and memo, the check recorded, the payee told by phone (payment_told), a told payment
     cannot be deleted (M5b's guard);
   - bank transfer and card (owner decision 2026-10-21): the approver approves a bill for a bank transfer through the
     bill page; the accountant pays it by ACH from "Pay by bank transfer or card" (no check number, its confirmation
     kept, never on the check desk, nobody told) and a card bill by card; anything else refused by the database;
   - P5 acceptance check 3: the bills CSV (a BOM, CRLF, every cell quoted, the formula guard), Mark entered with a
     bill un-approved meanwhile (refused[] said in full; the rest stamped by the accountant with the ref), Undo,
     the invoices' own marker;
   - the ledger: "Paid with" on a row and on two at once, reconciled, the database's inferred employee confirmed,
     the receipts (files.cost_id) in the viewer, the CSV (BOM, CRLF, the formula guard, amounts as numbers);
   - P5 acceptance check 5: no activity row and no outbox body carries an amount;
   - no Content-Security-Policy violation and no console error on any page.
   Screenshots (--shots final): <prefix><what>_<light|dark>_<desktop|phone>.png into --out. Made-up people and jobs
   only. Prints a JSON summary; exit code 1 when a check failed. */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Cdp, CHROMES, newPage, sleep } from "./cdp.mjs";
import { startPgliteServer, emailOf, passwordOf } from "./pglite-serve.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p5b-pglite")));
const SHOTS = arg("--shots", "final") === "none" ? "none" : "final";   // "all" (tools/e2e-demo.mjs) = final
const PREFIX = arg("--prefix", "p5b_final_");
const ROLES = ["admin", "approver", "manager", "accountant", "lead", "field", "viewer"];
const FIN = { admin: true, approver: true, accountant: true };
const APPROVES = { admin: true, approver: true };
const AMOUNT = /\$\s?\d/;
const MONEY_TABLES = ["bills", "payments", "invoices", "invoice_lines", "client_payments", "costs", "books_desk", "quote_commitments"];

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
  const S = await startPgliteServer({});
  const { base, sql, one, J, calls } = S;
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
  async function signIn(p, key) {
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
    await p.goto(base + "/index.html?next=" + encodeURIComponent("dashboard.html"), 150);
    await p.until("!!document.getElementById('loginForm') && !!window.DCR2PGlite && !document.getElementById('loginFields').disabled", 10000);
    await p.eval("document.getElementById('email').value=" + JSON.stringify(emailOf(key)) + ";document.getElementById('password').value=" + JSON.stringify(passwordOf(key)) + ";" +
      "document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname) && " + TOPBAR, 15000);
  }
  const html = (p) => p.eval("document.documentElement.outerHTML");
  const text = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); return n ? n.innerText : ''; })()");
  const modalOpen = "!!document.querySelector('.dcr-mo.open')";
  const modalOk = (p) => p.eval("(() => { const b = document.getElementById('dcrMoYes'); if (b) b.click(); return !!b; })()");
  const setVal = (p, id, value, ev) => p.eval("(() => { const i = document.getElementById(" + JSON.stringify(id) + "); i.focus(); i.value = " + JSON.stringify(value) +
    "; i.dispatchEvent(new Event(" + JSON.stringify(ev || "input") + ", { bubbles: true })); return true; })()");
  // the page's own repository, run in the page as its signed-in person: -> {ok, code, status, message, data}
  const repo = (p, mod, call) => p.eval("(async () => { const R = await import('/js/repo/" + mod + ".js'); " +
    "try { const data = await (" + call + "); return { ok: true, data: JSON.parse(JSON.stringify(data === undefined ? null : data)) }; } " +
    "catch (e) { return { ok: false, code: e.code, status: e.status, message: e.message }; } })()");
  const raw = (p, call) => p.eval("(async () => { const c = DCR2.sb(); const r = await (" + call + "); return { data: r.data, status: r.status, error: r.error ? { code: r.error.code, message: r.error.message } : null }; })()");
  const bill = (id) => one("select * from public.bills where id = $1", [id]);
  const DESK = "!!document.getElementById('secQbo') && !!document.getElementById('secPay')";
  const BILL = "!!document.getElementById('blDecision')";
  const LEDGER = "!!document.querySelector('#lgBody table.lg-t2') && document.querySelectorAll('#lgTotals .lg-t').length >= 9";
  const CATCH = "window.__blobs = []; window.__names = []; (() => { const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__blobs.push(b); return o(b); };" +
    " const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__names.push(this.download); return; } return c.call(this); }; })(); true";
  const lastCsv = async (p) => {
    const bytes = await p.eval("window.__blobs.slice(-1)[0].arrayBuffer().then(b => Array.from(new Uint8Array(b)))");
    return { bytes, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(bytes)) };
  };

  async function shoot(p, name, device, dark, full, print) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1440;
    const h0 = device === "phone" ? 844 : 900;
    await p.call("Page.bringToFront").catch(() => null);
    await p.call("Emulation.setEmulatedMedia", { media: print ? "print" : "", features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
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
  async function four(p, name, full, before) {
    for (const [device, dark] of [["desktop", false], ["desktop", true], ["phone", false], ["phone", true]]) {
      if (before) { await p.size(device === "phone" ? 390 : 1440, device === "phone" ? 844 : 900, device === "phone"); await sleep(250); await before(device); }
      await shoot(p, name, device, dark, full);
    }
    await p.size(1440, 900, false);
  }

  try {
    const acts0 = Number((await one("select coalesce(max(id), 0) as n from public.activity")).n);
    const outbox0 = Number((await one("select count(*) as n from public.notifications_outbox")).n);
    check("PGlite: every DCR Desktop 2 migration loaded (M5b's books_desk, the markers, costs.card, files.cost_id) and the made-up job seeded",
      !!S.catalog.tables.books_desk && !!S.catalog.functions.mark_bills_entered && !!S.catalog.tables.costs.cols.card && !!S.catalog.tables.files.cols.cost_id &&
      J.waiting && J.ready && J.mat, JSON.stringify({ p1: J.p1, waiting: J.waiting }));

    /* ── 1. every role on every P5b page ───────────────────────────────── */
    for (const role of ROLES) {
      const p = await newPage(cdp, role, OUT); pages.push(p);
      await p.size(1440, 900, false);
      const uid = J.people[role];
      await attempt(role + ": every P5b page", async () => {
        await signIn(p, role);
        await p.until("document.querySelectorAll('.hm-card').length > 2", 10000);
        if (APPROVES[role]) await p.until("!!document.getElementById('hmApprovalsCard')", 10000); else await sleep(1500);
        const home = await p.eval("({ cards: Array.from(document.querySelectorAll('.hm-card .tt')).map(n => n.childNodes[0].textContent), ap: !!document.getElementById('hmApprovalsCard'), apText: (document.getElementById('hmApprovals') || {}).innerText || '', h: document.getElementById('hmSections').innerHTML })");
        check(role + ": home - The Books card " + (FIN[role] ? "shown" : "not shown") + "; the approvals card " + (APPROVES[role] ? "shown (bills waiting, with amounts)" : "not shown"),
          home.cards.includes("The Books") === !!FIN[role] && home.ap === !!APPROVES[role] && (!APPROVES[role] || (/waiting for approval/.test(home.apText) && AMOUNT.test(home.apText))),
          home.cards.join("|") + " / " + home.apText.slice(0, 160));
        if (!FIN[role]) check(role + ": home - no amount on the page", !AMOUNT.test(home.h + home.apText));
        if (APPROVES[role] && role === "approver") await four(p, "home_approvals_approver", false);

        const from = calls.length;
        // The Books
        await p.goto(base + "/accounting.html", 150);
        if (FIN[role]) {
          await p.until(TOPBAR + " && " + DESK, 20000);
          const d = await p.eval("({ pay: document.querySelectorAll('#secPay [data-open]').length, ready: document.querySelectorAll('#secQbo [data-pick]').length, mark: !!document.getElementById('acMark'), approve: document.querySelectorAll('#acBody [id*=pprove], #acBody .bl-approve').length, todo: document.querySelectorAll('.ac-todo-list li').length })");
          check(role + ": The Books from the database (books_desk) - bills to pay, ready to enter with Mark entered, the to-do list, no approve button",
            d.pay >= 2 && d.ready >= 3 && d.mark && d.approve === 0 && d.todo >= 3, JSON.stringify(d));
          await p.size(390, 844, true);
          await open(p, "/accounting.html", DESK);
          const sw = await p.eval("document.documentElement.scrollWidth");
          check(role + ": The Books on a phone - no sideways scroll", sw <= 391, sw);
          await p.size(1440, 900, false);
        } else {
          await p.until(modalOpen, 12000);
          const t = await p.eval("document.querySelector('.dcr-mo.open').innerText");
          check(role + ": The Books refused ('not available for your role'), no amount", /not available for your role/.test(t) && !AMOUNT.test(await html(p)), t.slice(0, 120));
          await modalOk(p);
          await p.until("/dashboard\\.html/.test(location.pathname)", 8000);
        }
        // the bill page
        await p.goto(base + "/bill.html?id=" + J.waiting, 150);
        if (FIN[role]) {
          await p.until(TOPBAR + " && " + BILL, 20000);
          const b = await p.eval("({ go: !!document.getElementById('blGo'), no: (document.getElementById('blNoApprove') || {}).textContent || '', state: (document.getElementById('blState') || {}).textContent || '', tabs: document.querySelectorAll('[data-f]').length })");
          check(role + ": the bill page - AWAITING APPROVAL, its document, and " + (APPROVES[role] ? "the Approve button" : "NO approve button"),
            b.state === "AWAITING APPROVAL" && b.tabs >= 1 && b.go === !!APPROVES[role] && (APPROVES[role] || /Only an admin, or a manager with approve authority/.test(b.no)), JSON.stringify(b));
          if (role === "accountant") await four(p, "bill_accountant", true);
        } else {
          await p.until(modalOpen, 12000);
          check(role + ": the bill page refused, no amount", /not available for your role/.test(await p.eval("document.querySelector('.dcr-mo.open').innerText")) && !AMOUNT.test(await html(p)));
          await modalOk(p);
          await p.until("/dashboard\\.html/.test(location.pathname)", 8000);
        }
        // Expenses & receipts
        if (FIN[role]) {
          await open(p, "/ledger.html", LEDGER);
          const n = await p.eval("document.querySelectorAll('#lgBody tbody tr').length");
          check(role + ": the ledger - the costs of the last 30 days from the database", n >= 6, n);
        } else {
          await open(p, "/ledger.html", "!document.getElementById('lgDenied').hidden");
          check(role + ": the ledger says it needs the financials switch, shows no amount",
            /financials switch/.test(await text(p, "#lgDenied")) && (await p.eval("document.getElementById('lgMain').hidden")) && !AMOUNT.test(await html(p)));
        }
        // the printed expense report
        if (FIN[role]) {
          await open(p, "/report-expenses.html?id=" + J.p1.id, "!!document.querySelector('#rpSheet table.ex')", 20000, true);
          check(role + ": the printed expense report", /GRAND TOTAL/.test(await text(p, "#rpSheet")));
        } else {
          await open(p, "/report-expenses.html?id=" + J.p1.id, "/financials switch/.test(document.getElementById('rpSheet').innerText)", 20000, true);
          check(role + ": the printed expense report says it needs the financials switch, no amount", !AMOUNT.test(await html(p)));
        }
        // the project's money tabs
        for (const tab of ["expenses", "payments"]) {
          if (FIN[role]) {
            await open(p, "/project.html?id=" + J.p1.id + "&tab=" + tab, "!!document.querySelector('#pane-" + tab + " table.pjm-tbl')");
            check(role + ": the project's " + tab + " tab", true);
          } else {
            await open(p, "/project.html?id=" + J.p1.id + "&tab=" + tab, "!!document.querySelector('.pj-tab.active')");
            await sleep(600);
            const tabs = await p.eval("({ shown: Array.from(document.querySelectorAll('.pj-tab')).filter(t => !t.hidden).map(t => t.dataset.tab), active: document.querySelector('.pj-tab.active').dataset.tab })");
            check(role + ": no " + tab + " tab on the project page; ?tab=" + tab + " opens the Overview",
              !tabs.shown.includes("expenses") && !tabs.shown.includes("payments") && tabs.active === "overview", JSON.stringify(tabs));
          }
        }
        const mine = calls.slice(from).filter((c) => c.uid === uid);
        if (!FIN[role]) {
          const asked = mine.filter((c) => c.op === "from" && MONEY_TABLES.includes(c.table));
          const answered = asked.filter((c) => c.rows > 0);
          check(role + ": the P5b pages asked the database for no money table (" + asked.map((c) => c.table).join(",") + ") and were answered no money row",
            asked.length === 0 && answered.length === 0, JSON.stringify(asked.slice(0, 8)));
        } else {
          check(role + ": read through books_desk and costs", mine.some((c) => c.table === "books_desk" && c.rows > 0) && mine.some((c) => c.table === "costs" && c.rows > 0));
        }
      }, p);
    }
    const page = (k) => pages.find((x) => x.name === k);
    const ap = page("approver"), ac = page("accountant"), ad = page("admin"), mg = page("manager");

    /* ── 2. approval: the approver through the page (acceptance check 2) ─ */
    if (ap) await attempt("approver: approve with a required pay method; change how to pay", async () => {
      await open(ap, "/bill.html?id=" + J.waiting, BILL + " && !!document.getElementById('blGo')");
      const v0 = (await bill(J.waiting)).version;
      await ap.eval("document.getElementById('blNote').value = 'Matches the quote'; document.getElementById('blGo').click(); true");
      await ap.until(modalOpen, 5000);
      await modalOk(ap);
      await sleep(400);
      const err = await ap.eval("(document.getElementById('dcrMoErr') || {}).textContent || ''");
      check("approver: the dialog refuses to approve without a pay method (nothing pre-selected)", /Choose how it is paid: by check, in cash, either, by bank transfer or by card/.test(err) && !(await bill(J.waiting)).approved_at, err);
      await ap.eval("(() => { const s = document.querySelector('.dcr-mo.open select'); s.value = 'check'; s.dispatchEvent(new Event('change')); return true; })()");
      await four(ap, "approve_dialog_approver", false);
      await modalOk(ap);
      await ap.until("(document.getElementById('blState') || {}).textContent === 'APPROVED'", 10000);
      const b = await bill(J.waiting);
      check("approver: approved in the database - by the approver, the amount frozen, pay method check, the note, the version moved",
        b.approved_by === J.people.approver && Number(b.approved_amount) === 3850 && b.pay_method === "check" && b.approval_note === "Matches the quote" && b.version === v0 + 1,
        JSON.stringify({ by: b.approved_by, amt: b.approved_amount, m: b.pay_method, v: b.version, v0 }));
      await four(ap, "approved_approver", true);
      await open(ap, "/bill.html?id=" + J.ready, BILL + " && !!document.getElementById('blHow')");
      await ap.eval("document.getElementById('blHow').click(); true");
      await ap.until(modalOpen, 5000);
      await ap.eval("(() => { const s = document.querySelector('.dcr-mo.open select'); s.value = 'cash'; return true; })()");
      await modalOk(ap);
      await ap.until("/in cash/.test(document.getElementById('blDecision').innerText)", 10000);
      check("approver: 'Change how to pay' on an approved, unpaid bill - set_bill_pay_method stored cash", (await bill(J.ready)).pay_method === "cash");
      await open(ap, "/bill.html?id=" + J.either, BILL);
      check("approver: a part-paid bill offers no change of pay method", !(await ap.eval("!!document.getElementById('blHow')")));
    }, ap);

    /* ── 3. the database's refusals, through the pages' own code ───────── */
    if (ac && mg && ad) await attempt("the database's refusals (acceptance check 2)", async () => {
      await open(ac, "/bill.html?id=" + J.nodoc, BILL);
      const nd = await bill(J.nodoc);
      const r1 = await repo(ac, "books", "R.approve({ id: " + J.nodoc + ", version: " + nd.version + " }, 'check', null)");
      check("accountant: approve_bill refused (42501, 403) - an accountant never approves", !r1.ok && r1.code === "42501" && r1.status === 403, JSON.stringify(r1));
      const r1b = await repo(ac, "books", "R.setPayMethod({ id: " + J.ready + ", version: " + (await bill(J.ready)).version + " }, 'check')");
      check("accountant: set_bill_pay_method refused (42501)", !r1b.ok && r1b.code === "42501", JSON.stringify(r1b));
      const r2 = await repo(mg, "books", "R.approve({ id: " + J.second + ", version: " + (await bill(J.second)).version + " }, 'check', null)");
      check("manager without approve: approve_bill refused (42501, 403)", !r2.ok && r2.code === "42501" && r2.status === 403, JSON.stringify(r2));
      await open(ad, "/bill.html?id=" + J.second, BILL);
      const s0 = await bill(J.second);
      const r3 = await repo(ad, "books", "R.approve({ id: " + J.second + ", version: " + (s0.version - 1) + " }, 'check', null)");
      check("admin: a stale version is refused (PT409, 409)", !r3.ok && r3.code === "PT409" && r3.status === 409, JSON.stringify(r3));
      const r4 = await repo(ad, "books", "R.approve({ id: " + J.second + ", version: " + s0.version + " }, null, null)");
      check("admin: a missing pay method is refused (22023, 400)", !r4.ok && r4.code === "22023" && r4.status === 400, JSON.stringify(r4));
      const r4b = await repo(ad, "books", "R.approve({ id: " + J.nodoc + ", version: " + nd.version + " }, 'check', null)");
      check("admin: a bill without its document cannot be approved (23514, 400)", !r4b.ok && r4b.code === "23514" && r4b.status === 400 && /document/.test(r4b.message), JSON.stringify(r4b));
      const r5 = await repo(ad, "books", "R.approve({ id: " + J.second + ", version: " + s0.version + " }, 'both', 'Admin approved')");
      const s1 = await bill(J.second);
      check("admin: approves (pay method either)", r5.ok && s1.pay_method === "both" && s1.approved_by === J.people.admin, JSON.stringify(r5).slice(0, 200));
      const r6 = await raw(ad, "c.from('bills').update({ amount: " + (Number(s1.amount) + 10) + " }).eq('id', " + J.second + ").eq('version', " + s1.version + ").select('approved_at, pay_method, approved_amount')");
      check("an edit of an approved bill's amount clears the approval (the database's trigger)",
        !r6.error && r6.data && r6.data[0] && r6.data[0].approved_at === null && r6.data[0].pay_method === null && r6.data[0].approved_amount === null, JSON.stringify(r6));
      const rb = await bill(J.ready);
      const r7 = await repo(ac, "books", "R.recordPayment({ id: " + J.ready + ", projectId: " + J.p1.id + " }, { amount: " + (Number(rb.approved_amount) + 0.01) + ", method: 'cash', checkNumber: '' })");
      check("a payment over the approved amount is refused by the database (23514, 400)", !r7.ok && r7.code === "23514" && r7.status === 400, JSON.stringify(r7));
      const r8 = await repo(ac, "books", "R.recordPayment({ id: " + J.ready + ", projectId: " + J.p1.id + " }, { amount: 10, method: 'check', checkNumber: '1' })");
      check("a check against a bill approved for cash is refused by the database (23514)", !r8.ok && r8.code === "23514", JSON.stringify(r8));
      // a stale version on the page itself: the bill changed after it was opened
      await open(ad, "/bill.html?id=" + J.porch, BILL + " && !!document.getElementById('blGo')");
      await sql("update public.bills set description = 'Porch footings and piers' where id = $1", [J.porch]);
      await ad.eval("document.getElementById('blGo').click(); true");
      await ad.until(modalOpen, 5000);
      await ad.eval("(() => { const s = document.querySelector('.dcr-mo.open select'); s.value = 'check'; return true; })()");
      await modalOk(ad);
      await ad.until("/Someone changed this bill/.test(document.body.innerText) || /changed this bill/.test((document.getElementById('blMsg') || {}).textContent || '')", 10000);
      const pb = await bill(J.porch);
      check("admin: a bill changed after the page opened is refused (409) and shown again - not approved", !pb.approved_at, JSON.stringify({ at: pb.approved_at }));
      await ad.until("/Porch footings and piers/.test(document.body.innerText) && !!document.getElementById('blGo')", 10000);
      await ad.eval("document.getElementById('blGo').click(); true");
      await ad.until(modalOpen, 5000);
      await ad.eval("(() => { const s = document.querySelector('.dcr-mo.open select'); s.value = 'check'; return true; })()");
      await modalOk(ad);
      await ad.until("(document.getElementById('blState') || {}).textContent === 'APPROVED'", 10000);
      check("admin: approved once read again", (await bill(J.porch)).approved_by === J.people.admin);
    }, ad);

    /* ── 4. the check desk ─────────────────────────────────────────────── */
    let toldId = null;
    if (ac) await attempt("accountant: record the check, reach the payee, mark told", async () => {
      await open(ac, "/accounting.html", DESK + " && !!document.querySelector('#secPay [data-open=\"" + J.waiting + "\"]')");
      await four(ac, "books_accountant", true);
      await ac.eval("document.querySelector('#secPay [data-open=\"" + J.waiting + "\"]').click(); true");
      await ac.until("!!document.getElementById('ckWrite') && !!document.getElementById('ckPayee')", 8000);
      const f = await ac.eval("({ payee: document.getElementById('ckPayee').value, memo: document.getElementById('ckMemo').value, amount: document.getElementById('ckAmount').value, docs: document.querySelectorAll('#ckPanel [data-doc]').length })");
      check("accountant: the check desk - payee (the vendor's company), memo (job · invoice · what, <= 100), the amount owed, the documents",
        f.payee === "Madeup Framing LLC" && /Inv S-1/.test(f.memo) && f.memo.length <= 100 && Number(f.amount) === 3850 && f.docs >= 1, JSON.stringify(f));
      await ac.eval("document.getElementById('ckAmount').value = '999999'; document.getElementById('ckNumber').value = '5401'; document.getElementById('ckWrite').click(); true");
      await sleep(300);
      const over = await ac.eval("document.getElementById('ckMsg').textContent");
      check("accountant: more than is still authorised is refused on the page too", /more than the \$/.test(over), over);
      await ac.eval("document.getElementById('ckAmount').value = " + JSON.stringify(f.amount) + "; true");
      await four(ac, "checkdesk_accountant", false, async () => { await ac.eval("document.getElementById('ckPanel').scrollIntoView({ block: 'center' }); true"); });
      await ac.eval("document.getElementById('ckWrite').click(); true");
      await ac.until(modalOpen, 5000);
      await modalOk(ac);
      let pay = null;
      for (let i = 0; i < 40 && !pay; i++) { pay = await one("select * from public.payments where bill_id = $1 and check_number = '5401'", [J.waiting]); if (!pay) await sleep(250); }
      check("accountant: the check is recorded in the database - payee, memo, the allowed method, the full amount, by the accountant",
        pay && pay.payee === "Madeup Framing LLC" && pay.memo === f.memo && pay.method === "check" && Number(pay.amount) === 3850 && pay.created_by === J.people.accountant, JSON.stringify(pay));
      await ac.until("!!document.querySelector('#secTell [data-load=\"" + pay.id + "\"]')", 10000);
      await ac.eval("document.querySelector('#secTell [data-load=\"" + pay.id + "\"]').click(); true");
      await ac.until("!!document.querySelector('#secTell [data-told=\"" + pay.id + "\"][data-how=\"phone\"]')", 8000);
      const tell = await ac.eval("document.getElementById('secTell').innerText");
      check("accountant: how to reach them (the bill's vendor in Contacts) and the message for THIS check", /The bill's vendor in Contacts/.test(tell) && /5401/.test(tell) && /rory@example\.com/.test(tell), tell.slice(0, 400));
      await ac.eval("document.querySelector('#secTell [data-told=\"" + pay.id + "\"][data-how=\"phone\"]').click(); true");
      let told = null;
      for (let i = 0; i < 40; i++) { told = await one("select * from public.payments where id = $1", [pay.id]); if (told.pickup_told_at) break; await sleep(250); }
      check("accountant: told by phone (payment_told: the accountant's name, how phone)", told.pickup_told_how === "phone" && /Ace Accountant/.test(told.pickup_told_by || ""), JSON.stringify(told));
      toldId = pay.id;
      const del = await raw(ac, "c.from('payments').delete().eq('id', " + pay.id + ").select('id')");
      check("a payment once told cannot be deleted (M5b's guard, 23514)", !!del.error && del.error.code === "23514" && !!(await one("select id from public.payments where id = $1", [pay.id])), JSON.stringify(del));
    }, ac);

    /* ── 4b. bank transfer and card (owner decision 2026-10-21) ──────────── */
    if (ap && ac) await attempt("bank transfer and card: approved through the bill page, paid by ACH and by card from their own list", async () => {
      await open(ap, "/bill.html?id=" + J.wire, BILL + " && !!document.getElementById('blGo')");
      await ap.eval("document.getElementById('blGo').click(); true");
      await ap.until(modalOpen, 5000);
      const opts = await ap.eval("Array.from(document.querySelectorAll('.dcr-mo.open select option')).map(o => o.value)");
      check("approver: the approve dialog offers check, cash, either, bank transfer and card (the database's five)",
        JSON.stringify(opts) === JSON.stringify(["", "check", "cash", "both", "transfer", "card"]), JSON.stringify(opts));
      await ap.eval("(() => { const s = document.querySelector('.dcr-mo.open select'); s.value = 'transfer'; s.dispatchEvent(new Event('change')); return true; })()");
      await four(ap, "approve_transfer_approver", false);
      await modalOk(ap);
      await ap.until("/by bank transfer \\(ACH or wire\\)/.test(document.getElementById('blDecision').innerText)", 10000);
      const w = await bill(J.wire);
      check("approver: approved in the database to be paid by bank transfer", w.pay_method === "transfer" && w.approved_by === J.people.approver, JSON.stringify({ m: w.pay_method }));
      await open(ac, "/accounting.html", DESK + " && !!document.querySelector('#secSend [data-open=\"" + J.wire + "\"]')");
      const l = await ac.eval("({ send: Array.from(document.querySelectorAll('#secSend [data-open]')).map(r => Number(r.getAttribute('data-open'))), pay: Array.from(document.querySelectorAll('#secPay [data-open]')).map(r => Number(r.getAttribute('data-open'))) })");
      check("accountant: the transfer and the card bill on 'Pay by bank transfer or card' (books_desk pay_pile), never on the check desk",
        l.send.includes(J.wire) && l.send.includes(J.cardBill) && !l.pay.includes(J.wire) && !l.pay.includes(J.cardBill), JSON.stringify(l));
      await ac.eval("document.querySelector('#secSend [data-open=\"" + J.wire + "\"]').click(); true");
      await ac.until("!!document.getElementById('ckWrite') && !!document.querySelector('#ckHow [data-how=\"ach\"]')", 8000);
      const rf = await ac.eval("({ lab: document.getElementById('ckRefLab').textContent, ph: document.getElementById('ckNumber').placeholder, disabled: document.getElementById('ckWrite').disabled })");
      check("accountant: the transfer bill's panel asks for a confirmation number (optional) before ACH or wire is picked - never 'Check number'",
        rf.lab === "Confirmation number (optional)" && !/2041/.test(rf.ph) && rf.disabled, JSON.stringify(rf));
      await ac.eval("document.querySelector('#ckHow [data-how=\"ach\"]').click(); document.getElementById('ckAmount').value = '1000'; document.getElementById('ckNumber').value = 'ACH 0041-7781'; true");
      await four(ac, "send_panel_accountant", false, async () => { await ac.eval("document.getElementById('ckPanel').scrollIntoView({ block: 'center' }); true"); });
      await ac.eval("document.getElementById('ckWrite').click(); true");
      await ac.until(modalOpen, 5000);
      await modalOk(ac);
      let pa = null;
      for (let i = 0; i < 40 && !pa; i++) { pa = await one("select * from public.payments where bill_id = $1", [J.wire]); if (!pa) await sleep(250); }
      check("accountant: the ACH payment in the database - method ach, no check number, the confirmation, 1,000 of 1,800, by the accountant",
        pa && pa.method === "ach" && pa.check_number === null && pa.reference === "ACH 0041-7781" && Number(pa.amount) === 1000 && pa.created_by === J.people.accountant, JSON.stringify(pa));
      const desk = await one("select pay_pile, to_tell, owed from public.books_desk where id = $1", [J.wire]);
      check("books_desk: the transfer bill on transfer_card, nobody to tell, 800 still owed", desk.pay_pile === "transfer_card" && desk.to_tell === 0 && Number(desk.owed) === 800, JSON.stringify(desk));
      await ac.until("!!document.querySelector('#secSend [data-open=\"" + J.wire + "\"]') && !document.querySelector('#secTell [data-load=\"" + pa.id + "\"]')", 10000);
      const r1 = await repo(ac, "books", "R.recordPayment({ id: " + J.wire + ", projectId: " + J.p2.id + " }, { amount: 10, method: 'card', checkNumber: '' })");
      const r2 = await repo(ac, "books", "R.recordPayment({ id: " + J.wire + ", projectId: " + J.p2.id + " }, { amount: 10, method: 'check', checkNumber: '1' })");
      check("the database refuses a card or a check on the transfer bill, in its words (23514)",
        !r1.ok && r1.code === "23514" && /approved to be paid by bank transfer \(ACH or wire\)/.test(r1.message) && !r2.ok && /approved for bank transfer payment/.test(r2.message), JSON.stringify([r1, r2]));
      const r3 = await repo(ac, "books", "R.markTold({ paymentId: " + pa.id + ", version: " + pa.version + " }, 'phone')");
      check("payment_told refuses an ACH payment (only a check or cash is picked up)", !r3.ok && r3.code === "22023", JSON.stringify(r3));
      await ac.eval("document.querySelector('#secSend [data-open=\"" + J.cardBill + "\"]').click(); true");
      await ac.until("!!document.getElementById('ckWrite') && (document.getElementById('ckHowFixed') || {}).value === 'card'", 8000);
      await ac.eval("document.getElementById('ckNumber').value = 'AUTH 448120'; document.getElementById('ckWrite').click(); true");
      await ac.until(modalOpen, 5000);
      await modalOk(ac);
      let cp = null;
      for (let i = 0; i < 40 && !cp; i++) { cp = await one("select * from public.payments where bill_id = $1", [J.cardBill]); if (!cp) await sleep(250); }
      check("accountant: the card payment in the database (method card, its authorisation, the full amount)",
        cp && cp.method === "card" && cp.reference === "AUTH 448120" && cp.check_number === null && Number(cp.amount) === 386.5, JSON.stringify(cp));
    }, ac);

    /* ── 5. QuickBooks: the CSV, Mark entered with refused[], Undo, invoices (acceptance check 3) ── */
    if (ac && ad) await attempt("accountant: the CSV and Mark entered (acceptance check 3)", async () => {
      await open(ac, "/accounting.html", DESK + " && document.querySelectorAll('#secQbo [data-pick]').length > 0");
      await ac.eval(CATCH);
      await ac.eval("document.getElementById('acCsv').click(); true");
      await ac.until("window.__blobs.length > 0", 5000);
      const { bytes, text: csv } = await lastCsv(ac);
      const lines = csv.replace(/^﻿/, "").split("\r\n");
      check("the bills CSV: a BOM, CRLF, every cell quoted, the Portal Bill ID column",
        bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && lines.length >= 3 && lines[lines.length - 1] === "" && !/[^\r]\n/.test(csv) &&
        /^"Vendor","Bill No","Bill Date","Due Date","Amount","Category","Customer\/Project","Memo","Approved By","Approved On","Pay Method","Portal Bill ID"$/.test(lines[0]) &&
        lines.slice(1, -1).every((l) => /^"([^"]|"")*"(,"([^"]|"")*")*$/.test(l)), lines.slice(0, 3).join(" / "));
      check("the bills CSV: a memo beginning with '-' is made text (the formula guard); the database's kind words", csv.includes("\"'-10% retainage held until the final walk\"") && csv.includes("\"Subcontractor\""), csv.slice(0, 700));
      await ac.eval("document.getElementById('acAll').click(); true");
      const picked = await ac.eval("Array.from(document.querySelectorAll('#secQbo [data-pick]:checked')).map(c => Number(c.getAttribute('data-pick')))");
      const v = await bill(J.victim);
      await S.asPerson(J.people.admin, "select public.unapprove_bill($1, $2)", [J.victim, v.version]);
      check("set-up: the admin withdraws one picked bill's approval meanwhile", picked.includes(J.victim) && !(await bill(J.victim)).approved_at, JSON.stringify(picked));
      await ac.eval("document.getElementById('acRef').value = '  QB   batch 17 '; true");
      await ac.eval("document.getElementById('acMark').click(); true");
      await ac.until(modalOpen, 5000);
      await modalOk(ac);
      await ac.until("!!document.querySelector('#secQbo .ac-refused')", 10000);
      const box = await ac.eval("document.querySelector('#secQbo .ac-refused').innerText");
      const marked = await sql("select id, qbo_entered_by as by, qbo_ref as ref from public.bills where id = any($1::bigint[]) and qbo_entered_at is not null order by id", [picked]);
      check("Mark entered: the un-approved bill refused and said in full (refused[] with the database's reason); the others stamped by the accountant with the ref (one line)",
        /1 not/.test(box) && /Waiting for a manager or admin to approve it/.test(box) && marked.length === picked.length - 1 &&
        marked.every((m) => m.by === J.people.accountant && m.ref === "QB batch 17") && !marked.some((m) => Number(m.id) === J.victim), box + " " + JSON.stringify(marked));
      await shoot(ac, "books_refused_accountant", "desktop", false, false);
      await ac.eval("(document.querySelector('.dcr-mo.open #dcrMoYes') || { click() {} }).click(); true");
      const locked = await raw(ac, "c.from('bills').update({ amount: 1 }).eq('id', " + marked[0].id + ").select('id')");
      check("a bill marked entered is locked (23514: unmark it first)", !!locked.error && locked.error.code === "23514", JSON.stringify(locked));
      const undoId = Number(marked[0].id);
      await ac.until("!!document.querySelector('#secEntered [data-undo=\"" + undoId + "\"]')", 8000);
      await ac.eval("document.querySelector('#secEntered [data-undo=\"" + undoId + "\"]').click(); true");
      await ac.until(modalOpen, 5000);
      await modalOk(ac);
      await ac.until("!!document.querySelector('#secQbo [data-pick=\"" + undoId + "\"]')", 10000);
      check("Undo: unmarked in the database, back on the ready list", !(await bill(undoId)).qbo_entered_at);
      await ac.eval("document.getElementById('acAllInv').click(); true");
      const invs = await ac.eval("Array.from(document.querySelectorAll('#secAr [data-pickinv]:checked')).map(c => Number(c.getAttribute('data-pickinv')))");
      await ac.eval("document.getElementById('acMarkInv').click(); true");
      await ac.until(modalOpen, 5000);
      await modalOk(ac);
      await ac.until("document.querySelectorAll('#secAr [data-pickinv]').length === 0", 10000);
      const inv = await sql("select id, status, qbo_entered_at from public.invoices order by id");
      check("the invoices: the sent one marked entered with its own marker, the draft not offered", invs.includes(J.inv) && !invs.includes(J.draft) &&
        inv.find((i) => Number(i.id) === J.inv).qbo_entered_at && !inv.find((i) => Number(i.id) === J.draft).qbo_entered_at, JSON.stringify({ invs, inv }));
    }, ac);

    /* ── 6. the ledger ─────────────────────────────────────────────────── */
    if (ac) await attempt("accountant: the ledger", async () => {
      await open(ac, "/ledger.html", LEDGER);
      await four(ac, "ledger_accountant", true);
      const tiles = await ac.eval("Object.fromEntries(Array.from(document.querySelectorAll('#lgTotals .lg-t')).map(t => [t.querySelector('.k').textContent, t.querySelector('.v').textContent]))");
      const n = (s) => Number(String(s).replace(/[$,]/g, ""));
      check("accountant: Cost = materials + labour + subcontractors from the database (" + tiles["Cost this period"] + ")",
        Math.abs(n(tiles["Cost this period"]) - (n(tiles.Materials) + n(tiles.Labour) + n(tiles.Subcontractors))) < 0.005 && n(tiles["Cost this period"]) > 0, JSON.stringify(tiles));
      await ac.eval("(() => { const s = document.querySelector('select[data-card=\"" + J.mat + "\"]'); s.value = 'card-amex'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
      let c = null;
      for (let i = 0; i < 40; i++) { c = await one("select card, card_by, card_at from public.costs where id = $1", [J.mat]); if (c.card === "card-amex") break; await sleep(250); }
      check("accountant: 'Paid with' on one row - the database stamped who and when", c.card === "card-amex" && c.card_by === J.people.accountant && !!c.card_at, JSON.stringify(c));
      await ac.until("(document.querySelector('select[data-card=\"" + J.mat + "\"]') || {}).value === 'card-amex'", 8000);
      for (const id of [J.sub, J.formula]) await ac.eval("(() => { const c = document.querySelector('[data-pick=\"" + id + "\"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
      await ac.until("!document.getElementById('lgBulk').hidden", 5000);
      await setVal(ac, "lgBulkCard", "card-visa", "change");
      await ac.eval("document.getElementById('lgBulkApply').click(); true");
      let two = [];
      for (let i = 0; i < 40; i++) { two = await sql("select card from public.costs where id = any($1::bigint[])", [[J.sub, J.formula]]); if (two.every((x) => x.card === "card-visa")) break; await sleep(250); }
      check("accountant: two rows tagged at once (tag_costs)", two.length === 2 && two.every((x) => x.card === "card-visa"), JSON.stringify(two));
      await ac.until("document.getElementById('lgBulk').hidden && (document.querySelector('select[data-card=\"" + J.sub + "\"]') || {}).value === 'card-visa'", 8000);
      await ac.eval("(() => { const c = document.querySelector('[data-rec=\"" + J.mat + "\"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
      let r = null;
      for (let i = 0; i < 40; i++) { r = await one("select reconciled_by from public.costs where id = $1", [J.mat]); if (r.reconciled_by) break; await sleep(250); }
      check("accountant: a row reconciled (reconcile_costs: by the accountant)", r.reconciled_by === J.people.accountant);
      const inf = await one("select employee_id, employee_source from public.costs where id = $1", [J.lab]);
      check("the database inferred the labour row's crew member from its words ('Quill - cut rafters')", Number(inf.employee_id) === J.emp && inf.employee_source === "inferred", JSON.stringify(inf));
      await ac.until("!!document.querySelector('[data-confirm=\"" + J.lab + "\"]')", 8000);
      check("accountant: the page labels the guess 'inferred'", /inferred/i.test(await ac.eval("document.querySelector('[data-confirm=\"" + J.lab + "\"]').closest('tr').innerText")));
      await ac.eval("document.querySelector('[data-confirm=\"" + J.lab + "\"]').click(); true");
      await ac.until("!!document.querySelector('.dcr-mo.open') && !!document.getElementById('dcrMoF0')", 5000);
      const pre = await ac.eval("document.getElementById('dcrMoF0').selectedOptions[0].textContent");
      await shoot(ac, "ledger_confirm_accountant", "desktop", false, false);
      await ac.eval("document.getElementById('dcrMoYes').click(); true");
      let e2 = null;
      for (let i = 0; i < 40; i++) { e2 = await one("select employee_id, employee_source from public.costs where id = $1", [J.lab]); if (e2.employee_source === "confirmed") break; await sleep(250); }
      check("accountant: the inferred employee (offered first) stored as confirmed (confirm_cost_employee)", pre === "Quill Ledgerton" && Number(e2.employee_id) === J.emp && e2.employee_source === "confirmed", pre + " " + JSON.stringify(e2));
      // receipts: two on the material row (files.cost_id), the picture in the viewer
      await ac.until("!!document.querySelector('[data-row=\"" + J.mat + "\"]')", 8000);
      await ac.eval("document.querySelector('[data-row=\"" + J.mat + "\"]').click(); true");
      await ac.until("!document.getElementById('lgView').hidden", 6000);
      await ac.until("!!document.querySelector('#lgViewBody img') && document.querySelector('#lgViewBody img').complete && document.querySelector('#lgViewBody img').naturalWidth > 0", 8000);
      check("accountant: the receipts linked by files.cost_id - 1 of 2, the picture shown through a signed URL", /1 of 2/.test(await text(ac, "#lgViewN")));
      await shoot(ac, "ledger_receipt_accountant", "desktop", false, false);
      await ac.eval("document.getElementById('lgViewClose').click(); true");
      await ac.eval(CATCH);
      await ac.eval("document.getElementById('lgCsv').click(); true");
      await ac.until("window.__blobs.length === 1", 5000);
      const { bytes, text: csv } = await lastCsv(ac);
      check("accountant: the ledger CSV - a BOM, CRLF, the formula guard on '=2x6 studs…', a credit as a plain number, 'inferred'/'confirmed' said",
        bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && !/[^\r]\n/.test(csv) && /,"'=2x6 studs, 40 more for the north wall",/.test(csv) && /,-40\.50,/.test(csv) && /"confirmed"/.test(csv),
        csv.slice(0, 500));
      await ac.size(390, 844, true);
      await open(ac, "/ledger.html", LEDGER);
      const sw = await ac.eval("({ page: document.documentElement.scrollWidth, win: innerWidth })");
      check("accountant: the ledger on a phone does not scroll sideways", sw.page <= sw.win + 1, JSON.stringify(sw));
      await ac.size(1440, 900, false);
    }, ac);

    /* ── 7. the project's tabs and the printed report ───────────────────── */
    if (ac) await attempt("accountant: the project's Expenses and Payments tabs, the printed report", async () => {
      await open(ac, "/project.html?id=" + J.p1.id + "&tab=payments", "!!document.querySelector('#pane-payments table.pjm-tbl')");
      const pay = await text(ac, "#pane-payments");
      check("accountant: the Payments tab - the bills with their states and payments (payee, memo, told), the client's invoice",
        /Money out/i.test(pay) && /Told it is ready/.test(pay) && /Madeup Framing LLC/.test(pay) && /Money in/i.test(pay) && !/Review…/.test(pay), pay.slice(0, 500));
      // review fix: the invoice figures are DCR Desktop 2's (inv_logic.figures / status_of) - the sent invoice (8,400, 1,000
      // collected) is invoiced and outstanding; the draft (900, past its due day) is said apart and is never overdue
      const sum = await ac.eval("(() => { const s = {}; document.querySelectorAll('#pane-payments .pjm-sum > div').forEach((d) => { const k = d.querySelector('span'); " +
        "const v = d.querySelector('b'); const n = d.querySelector('small'); if (k && v) s[k.textContent] = [v.textContent, n ? n.textContent : '']; }); return s; })()");
      const chips = await ac.eval("Array.from(document.querySelectorAll('#pane-payments table.pjm-tbl')[1].querySelectorAll('tbody tr')).filter((r) => !r.classList.contains('pay') && !r.classList.contains('grand')).map((r) => r.cells[2].textContent.trim())");
      check("accountant: the Payments tab's invoice figures are DCR Desktop 2's - invoiced and outstanding over the sent invoice only, the draft said apart and never overdue",
        sum["Invoiced to the client"] && sum["Invoiced to the client"][0] === "$8,400.00" && /1 sent · \$900\.00 in 1 draft, not sent/.test(sum["Invoiced to the client"][1]) &&
        sum["Outstanding"] && sum["Outstanding"][0] === "$7,400.00" && sum["Collected"][0] === "$1,000.00" && chips.includes("Draft") && !chips.includes("Overdue"), JSON.stringify({ sum, chips }));
      await four(ac, "payments_accountant", true);
      await open(ac, "/project.html?id=" + J.p1.id + "&tab=expenses", "!!document.querySelector('#pane-expenses table.pjm-tbl')");
      const grand = await ac.eval("(() => { const r = document.querySelector('#pane-expenses tr.grand'); return r ? Array.from(r.cells).map(c => c.textContent) : []; })()");
      await open(ac, "/report-expenses.html?id=" + J.p1.id, "!!document.querySelector('#rpSheet table.ex')", 20000, true);
      const rep = await ac.eval("Array.from(document.querySelector('#rpSheet tr.grand').cells).map(c => c.textContent)");
      check("accountant: the printed report's GRAND TOTAL is the tab's, to the cent", JSON.stringify(rep) === JSON.stringify(grand.slice(0, rep.length)) && /GRAND TOTAL/.test(rep[0]), JSON.stringify({ rep, grand }));
      await four(ac, "expense_report_accountant", true);
      await shoot(ac, "expense_report_print_accountant", "desktop", false, true, true);
    }, ac);

    /* ── 8. acceptance check 5 ─────────────────────────────────────────── */
    await attempt("no amount in any activity row or outbox body", async () => {
      const acts = await sql("select kind, text from public.activity where id > $1 or kind <> 'note'", [acts0]);
      const box = await sql("select coalesce(subject, '') || ' ' || coalesce(body, '') as t from public.notifications_outbox");
      const all = acts.map((a) => a.text).concat(box.map((b) => b.t));
      const bad = all.filter((t) => AMOUNT.test(t) || /\b\d{1,3}(,\d{3})*\.\d{2}\b/.test(t) || /\b(3850|2400|1264|812\.4|680|950|2950|8400)\b/.test(t));
      check("acceptance check 5: no activity row (" + acts.length + " system rows and rows written during the walk) and no outbox body (" + box.length + ") carries an amount",
        bad.length === 0, bad.slice(0, 5).join(" | "));
      const newRows = Number((await one("select count(*) as n from public.activity where id > $1", [acts0])).n);
      const newBox = Number((await one("select count(*) as n from public.notifications_outbox")).n) - outbox0;
      check("acceptance check 5: the books' and the ledger's writes added no activity row and no outbox row", newRows === 0 && newBox === 0, JSON.stringify({ newRows, newBox }));
    });

    /* ── 9. no CSP violation, no console error, nothing sent to Supabase ── */
    for (const p of pages) {
      const bad = p.log.filter((x) => /CSP-VIOLATION|Content Security Policy/i.test(x.text) || x.level === "exception" ||
        (x.level === "error" && !/favicon\.ico|net::ERR_ABORTED|mailto:/.test(x.text + " " + (x.url || ""))));
      check(p.name + ": no CSP violation, no console error", !bad.length, bad.slice(0, 5).map((x) => x.level + " " + x.text.slice(0, 200) + " @ " + x.url).join(" | "));
      const supa = p.log.filter((x) => /supabase\.co/.test(x.text));
      check(p.name + ": nothing was sent to Supabase", !supa.length, supa.slice(0, 3).map((x) => x.text.slice(0, 160)).join(" | "));
    }
  } finally {
    try { await cdp.send("Browser.close"); } catch (e) { /* */ }
    try { proc.kill(); } catch (e) { /* */ }
    await S.close();
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Chrome may hold a file a moment longer */ }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results, shots, out: OUT }, null, 1));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 2; });
