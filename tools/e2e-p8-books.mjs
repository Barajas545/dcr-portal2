#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the Books program's Accounting page and its messages, release B part 2a (P4),
   in the DEMO (development only; design-portal §12.4 steps 1-7 and 10).

     node tools/e2e-p8-books.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with the money messages' rules
   - tools/fake/p8-books.js over p5b-books.js and p8-register.js: the templates, ask_for_approval, tell_payee, the hand
   texts, the reminder PC's status and its __dev.reminderPc hook; nothing goes to Supabase) and drives a local Chrome or
   Edge headless:

   1. landing: the accountant with no ?next lands on the Accounting page; ?next=my-tasks.html still wins; the admin
      lands on Home; the installed app (a fresh session opening Home, kept signed in) is sent there once, and Home from
      the page then stays Home;
   2. roles: the admin and the demo approver open it from Home's "Accounting" card (its "N to do"); a manager without
      financials, a lead, field and view-only have no card, and the page itself refuses them with no amount on it;
   3. Ask to approve: two bills of one job ticked, the usual approver ticked for her; an e-mail to one (one outbox row,
      amount-free), a text to the other (the sms: link carries the database's number and body; I sent it); the last ask
      says both; the reminder PC sends the e-mail ("e-mail ✓ sent"); a bill approved first sets its ask aside;
   4. Record payment: the next check number prefilled, the date yesterday, a picture pasted and a PDF dropped, a used
      number refused in the database's words; recorded - the Paid list shows the files (📎) with distinct names;
   5. Tell: by e-mail (an opt-out on the PC first: "not sent: opted out"; then sent: told by e-mail); by text (sms:
      link, I sent it: told by text); by call (told by phone); in person; Picked up, and Not picked up;
   6. the templates: a text saved; an amount refused in the database's words; reset; a second tab's stale save (PT409);
   7. Advanced mode: the big button opens The Books;
   10. everywhere: 390 px with no sideways scroll, desktop, light and dark; no Content-Security-Policy violation and no
      console error; no amount in any money e-mail or text written in the walk (P5 check 5).
   Screenshots (--shots all): books8_<what>_<role>_<light|dark>_<desktop|phone>.png into --out (default: the system temp
   folder). Made-up data only. Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p8-books")));
const SHOTS = arg("--shots", "all");
const AMOUNT = /\$\s?\d/;
const MONEY = /\$\s?\d|\b\d{1,3}(,\d{3})+\.\d\d\b|\b\d+\.\d\d\b/;

const HELPERS = `(() => {
  window.__png = async (label) => {
    const c = document.createElement("canvas"); c.width = 480; c.height = 320;
    const g = c.getContext("2d"); g.fillStyle = "#e8eef5"; g.fillRect(0, 0, 480, 320);
    g.fillStyle = "#1b2733"; g.font = "28px sans-serif"; g.fillText(label || "made-up check", 24, 160);
    const b = await new Promise((r) => c.toBlob(r, "image/png"));
    return new File([b], "image.png", { type: "image/png", lastModified: Date.now() + Math.random() });
  };
  window.__pdf = (name) => new File(["%PDF-1.4\\n%made-up\\n1 0 obj<<>>endobj\\ntrailer<<>>\\n%%EOF\\n" + name], name, { type: "application/pdf", lastModified: Date.now() });
  const dt = (files) => { const d = new DataTransfer(); files.forEach((f) => d.items.add(f)); return d; };
  window.__paste = (sel, files) => { const ev = new ClipboardEvent("paste", { clipboardData: dt(files), bubbles: true, cancelable: true }); document.querySelector(sel).dispatchEvent(ev); return ev.defaultPrevented; };
  window.__drop = (sel, files) => {
    const t = document.querySelector(sel), d = dt(files);
    t.dispatchEvent(new DragEvent("dragover", { dataTransfer: d, bubbles: true, cancelable: true }));
    const ev = new DragEvent("drop", { dataTransfer: d, bubbles: true, cancelable: true });
    t.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  window.__set = (id, v) => { const n = document.getElementById(id); n.value = v; n.dispatchEvent(new Event("input", { bubbles: true })); n.dispatchEvent(new Event("change", { bubbles: true })); return true; };
  window.__pc = (o) => DCR2Demo.engine.exts.find((x) => x.name === "p8-books").__dev.reminderPc(o || {});
  window.__group = (words) => Array.from(document.querySelectorAll("[data-group]")).find((x) => x.innerText.indexOf(words) !== -1) || null;
  return true;
})()`;

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
  const HOME = "!!document.getElementById('secApprove') && !!document.getElementById('secPaid')";
  async function open(p, path, marker, ms) {
    await p.goto(base + path, 150);
    const here = "(location.pathname).indexOf(" + JSON.stringify(path.split("?")[0]) + ") === 0";
    await p.until(here + " && " + TOPBAR, ms || 15000);
    await p.eval(HELPERS);
    if (marker) await p.until(marker, ms || 15000);
  }
  async function signIn(p, key, o) {
    const opt = o || {};
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); sessionStorage.removeItem('dcr2_landed'); true");
    await p.goto(base + "/index.html" + (opt.next === undefined ? "?next=dashboard.html" : opt.next ? "?next=" + encodeURIComponent(opt.next) : ""), 150);
    await p.until("!!document.getElementById('loginForm') && !!window.DCR2Demo && !document.getElementById('loginFields').disabled", 8000);
    await p.eval("document.getElementById('email').value=" + JSON.stringify(key + "@demo.test") + ";document.getElementById('password').value='demo-password-1';" +
      "document.getElementById('remember').checked=" + (opt.remember ? "true" : "false") + ";document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname) && " + TOPBAR, 10000);
  }
  const db = (p, expr) => p.eval("(() => { const R = DCR2Demo.engine.rows; return " + expr + "; })()");
  const html = (p) => p.eval("document.documentElement.outerHTML");
  const modalOpen = "!!document.querySelector('.dcr-mo.open')";
  const modalOk = (p) => p.eval("(() => { const b = document.querySelector('.dcr-mo.open #dcrMoYes'); if (b) b.click(); return !!b; })()");
  const sheetOpen = "!!document.getElementById('bhSheet') && !document.getElementById('bhSheet').hidden";
  const click = (p, sel) => p.eval("(() => { const b = document.querySelector(" + JSON.stringify(sel) + "); if (b) b.click(); return !!b; })()");

  async function shoot(p, name, device, dark, full) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1440;
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    await sleep(350);
    const hgt = full === false ? (device === "phone" ? 844 : 900) : await p.eval("Math.max(" + (device === "phone" ? 844 : 900) + ", Math.min(4200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: hgt, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(450);
    const file = "books8_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: device === "phone" ? 844 : 900, deviceScaleFactor: 1, mobile: device === "phone" });
    await p.dark(false);
  }
  async function four(p, name, full) {
    await shoot(p, name, "desktop", false, full); await shoot(p, name, "desktop", true, full);
    await p.size(390, 844, true);
    await sleep(300);
    await shoot(p, name, "phone", false, full); await shoot(p, name, "phone", true, full);
    await p.size(1440, 900, false);
  }
  async function phoneWidth(p, path, marker) {
    await p.size(390, 844, true);
    await open(p, path, marker);
    const sw = await p.eval("document.documentElement.scrollWidth");
    await p.size(1440, 900, false);
    return sw;
  }

  try {
    /* ── 0. a clean demo database ─────────────────────────────────────── */
    const acc = await newPage(cdp, "accountant", OUT); pages.push(acc);
    await acc.size(1440, 900, false);
    await acc.goto(base + "/manifest.json", 50);
    await acc.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");
    const start = Date.now();

    /* ── 1. landing ───────────────────────────────────────────────────── */
    await attempt("1. landing", async () => {
      await signIn(acc, "accountant", { next: "" });
      await acc.until("location.pathname === '/books-home.html' && " + HOME, 15000);
      check("1a. the accountant with no ?next lands on the Accounting page", true);
      await signIn(acc, "accountant", { next: "my-tasks.html" });
      await acc.until("location.pathname === '/my-tasks.html'", 10000);
      check("1b. ?next=my-tasks.html still wins", true);
      const ad0 = await newPage(cdp, "admin-landing", OUT); pages.push(ad0);
      await signIn(ad0, "admin", { next: "" });
      await ad0.until("location.pathname === '/dashboard.html' && document.querySelectorAll('.hm-card').length > 2", 10000);
      check("1c. the admin lands on Home", true);
      // the installed app: kept signed in on this device, a fresh session (a new tab: its own sessionStorage) opens Home
      const keep = await newPage(cdp, "kept", OUT); pages.push(keep);
      await signIn(keep, "accountant", { next: "dashboard.html", remember: true });
      await keep.until("location.pathname === '/dashboard.html'", 8000);
      check("1d. an explicit ?next=dashboard.html is Home (the sign-in marks the session landed)", (await keep.eval("location.pathname")) === "/dashboard.html");
      const inst = await newPage(cdp, "installed", OUT); pages.push(inst);
      await inst.size(390, 844, true);
      await inst.goto(base + "/dashboard.html", 300);
      await inst.until("location.pathname === '/books-home.html' && " + HOME, 15000);
      check("1e. the installed app (a fresh session opening Home): sent to the Accounting page once", true);
      await inst.eval(HELPERS);
      await click(inst, ".dcr2-topbar a.brand");
      await sleep(1800);
      check("1f. Home from the page then stays Home", (await inst.eval("location.pathname")) === "/dashboard.html", await inst.eval("location.pathname"));
      await shoot(inst, "home_installed_accountant", "phone", false, false);
      // the kept sign-in goes: the other tabs sign in on their own
      await inst.eval("['dcr2-auth','dcr2-auth-profile'].forEach((k) => localStorage.removeItem(k)); true");
    }, acc);

    /* ── 2. roles ─────────────────────────────────────────────────────── */
    const ad = await newPage(cdp, "admin", OUT); pages.push(ad);
    await ad.size(1440, 900, false);
    await attempt("2. roles", async () => {
      await signIn(ad, "admin");
      await ad.until("!!document.getElementById('hmAccounting')", 8000);
      await ad.until("!!document.querySelector('#hmAccounting .hm-badge')", 8000).catch(() => null);
      const card = await ad.eval("({ t: document.querySelector('#hmAccounting .tt').innerText, books: (document.querySelector('#hmBooks .tt') || {}).innerText || '' })");
      check("2a. the admin: Home's Accounting card with its \"N to do\", and The Books (advanced)", /^Accounting\s*\d+ to do/.test(card.t) && /^The Books \(advanced\)/.test(card.books), JSON.stringify(card));
      await shoot(ad, "home_admin", "desktop", false, false);
      await click(ad, "#hmAccounting a.hm-card-go");
      await ad.until("location.pathname === '/books-home.html' && " + HOME, 15000);
      check("2b. the card opens the Accounting page", true);
      await four(ad, "page_admin", true);
      const ap = await newPage(cdp, "approver", OUT); pages.push(ap);
      await ap.size(1440, 900, false);
      await signIn(ap, "approver");
      await ap.until("!!document.getElementById('hmAccounting')", 8000);
      await click(ap, "#hmAccounting a.hm-card-go");
      await ap.until("location.pathname === '/books-home.html' && " + HOME, 15000);
      await ap.eval("Array.from(document.querySelectorAll('.av img')).forEach((i) => i.remove()); true");
      const h0 = await html(ap);
      check("2c. the demo approver (financials, no prices): the page with no amount on it (S4), \"Open & approve\" on the waiting bills",
        !AMOUNT.test(h0) && /Open &amp; approve/.test(h0), (h0.match(/.{40}\$\s?\d.{20}/) || [""])[0]);
      await four(ap, "page_approver", true);
      const sw = await phoneWidth(ap, "/books-home.html", HOME);
      check("2d. the approver's page on a phone: no sideways scroll", sw <= 391, sw);
      for (const role of ["manager", "lead", "field", "viewer"]) {
        const p = await newPage(cdp, role, OUT); pages.push(p);
        await p.size(390, 844, true);
        await signIn(p, role);
        await sleep(900);
        const noCard = await p.eval("!document.getElementById('hmAccounting') && !Array.from(document.querySelectorAll('#dcr2Nav a')).some((a) => a.getAttribute('href') === 'books-home.html')");
        await p.goto(base + "/books-home.html", 150);
        await p.until(modalOpen, 10000);
        const t = await p.eval("document.querySelector('.dcr-mo.open').innerText");
        const h1 = await html(p);
        check("2e. " + role + ": no card, no top-bar link; the page refused ('not available for your role') with no amount and no list on it",
          noCard && /not available for your role/.test(t) && !AMOUNT.test(h1) && !(await p.eval("!!document.getElementById('secApprove')")), t.slice(0, 120));
        if (role === "lead") await shoot(p, "refused_lead", "phone", false, false);
        await modalOk(p);
        await p.until("/dashboard\\.html/.test(location.pathname)", 8000);
      }
    }, ad);

    /* ── 3. Ask to approve ────────────────────────────────────────────── */
    const J = await db(acc, `(() => ({
      quarry: (R.bills.find((b) => b.description === "Footings and stem wall, phase 1") || {}).id,
      w3301: (R.bills.find((b) => b.invoice_number === "W-3301") || {}).id,
      hillside: (R.bills.find((b) => b.invoice_number === "INV-4105") || {}).id,
      rosewell: (R.bills.find((b) => b.description === "-10% retainage held until the final walk") || {}).id,
      admin: DCR2Demo.people.find((p) => p.key === "admin").id,
      drew: DCR2Demo.people.find((p) => p.key === "approver").id,
      p5310: (R.payments.find((p) => p.check_number === "5310") || {}).id,
      p5202: (R.payments.find((p) => p.check_number === "5202") || {}).id,
      p5201: (R.payments.find((p) => p.check_number === "5201") || {}).id,
      hollis: (R.payments.find((p) => p.reference === "Petty cash slip 22") || {}).id,
      hcash: (R.payments.find((p) => p.method === "cash" && p.reference === "Petty cash slip 18") || {}).id,
      outbox: R.notifications_outbox.length,
    }))()`);
    J.today = await acc.eval("new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())");
    J.yesterday = new Date(Date.UTC(+J.today.slice(0, 4), +J.today.slice(5, 7) - 1, +J.today.slice(8, 10) - 1)).toISOString().slice(0, 10);
    check("demo: the made-up bills and payments of the walk", Object.values(J).every((v) => v !== undefined && v !== null), JSON.stringify(J));

    await attempt("3. Ask to approve", async () => {
      await signIn(acc, "accountant");
      await open(acc, "/books-home.html", HOME + " && !!document.querySelector('[data-askpick=\"" + J.w3301 + "\"]')");
      await click(acc, '[data-askpick="' + J.quarry + '"]');
      await click(acc, '[data-askpick="' + J.w3301 + '"]');
      await acc.until("!document.getElementById('bhAskSel').disabled && /2 selected/.test(document.getElementById('bhAskSel').textContent)", 4000);
      await click(acc, "#bhAskSel");
      await acc.until(sheetOpen + " && !!document.querySelector('#bhSheet [data-pick=\"1\"]')", 8000);
      const dlg = await acc.eval("({ t: document.querySelector('#bhSheet').innerText, p0: document.querySelector('#bhSheet [data-pick=\"0\"]').checked, p1: document.querySelector('#bhSheet [data-pick=\"1\"]').checked, n0: document.querySelector('#bhSheet [data-ap=\"0\"]').innerText })");
      check("3a. two bills of the kitchen job; the usual approver (the job's last) ticked for her, the other not",
        /2 bills/.test(dlg.t) && dlg.p0 && !dlg.p1 && /Avery Admin/.test(dlg.n0) && /Usual for A303/.test(dlg.n0) && /Messages carry no amounts/.test(dlg.t) && !AMOUNT.test(dlg.t), JSON.stringify(dlg).slice(0, 300));
      await four(acc, "ask_dialog_accountant", false);
      await click(acc, '#bhSheet [data-pick="1"]');
      await click(acc, '#bhSheet input[name="bhCh1"][value="sms"]');
      await click(acc, "#bhAskSend");
      await acc.until("!!document.querySelector('#bhSheet .bh-text')", 8000);
      const rows = await db(acc, "R.notifications_outbox.slice(" + J.outbox + ").filter((o) => o.kind === 'approval_request').map((o) => ({ to: o.to_profile_id, body: o.body, subject: o.subject }))");
      check("3b. one outbox row: the e-mail to the usual approver, amount-free, the invoice numbers with their #",
        rows.length === 1 && rows[0].to === J.admin && !MONEY.test(rows[0].body + rows[0].subject) && /invoice #INV-6206/.test(rows[0].body) && /invoice #W-3301/.test(rows[0].body), JSON.stringify(rows).slice(0, 300));
      const t = await acc.eval("({ href: document.querySelector('#bhSheet .bh-text a[data-act=open]').getAttribute('href'), body: document.querySelector('#bhSheet .bh-text-b').textContent })");
      const draft = await db(acc, "R.money_messages.filter((m) => m.channel === 'sms' && m.status === 'draft' && m.to_profile_id === " + JSON.stringify(J.drew) + ").pop()");
      check("3c. the text: an sms: link with the database's number and body (read, not clicked)",
        t.href === "sms:+18055550111?&body=" + encodeURIComponent(draft.body) && t.body === draft.body && !MONEY.test(draft.body), t.href.slice(0, 120));
      await shoot(acc, "ask_sent_accountant", "desktop", false, false);
      await click(acc, '#bhSheet .bh-text [data-act="sent"]');
      await acc.until("DCR2Demo.engine.rows.money_messages.find((m) => m.id === " + draft.id + ").status === 'sent'", 6000);
      check("3d. I sent it: the text is logged sent (by hand)", true);
      await click(acc, "#bhAskDone");
      await acc.until("!(" + sheetOpen + ")", 4000);
      await acc.until("/Asked Avery · e-mail waiting for the reminder PC; Drew · text \\(by hand\\)/.test((document.querySelector('[data-bill=\"" + J.quarry + "\"] .bh-asked') || {}).textContent || '')", 8000);
      check("3e. the last ask names both, the e-mail still waiting", true);
      const sent = await acc.eval("window.__pc({})");
      await open(acc, "/books-home.html", HOME);
      const asked = await acc.eval("(document.querySelector('[data-bill=\"" + J.quarry + "\"] .bh-asked') || {}).textContent || ''");
      check("3f. the reminder PC sends it: \"e-mail ✓ sent\"", sent.sent >= 1 && /Avery · e-mail ✓ sent/.test(asked), asked + " " + JSON.stringify(sent));
      // a bill approved before the PC takes its ask: set aside
      await click(acc, '[data-ask="' + J.hillside + '"]');
      await acc.until(sheetOpen + " && !!document.querySelector('#bhSheet [data-pick=\"0\"]')", 8000);
      await acc.eval("(() => { const s = document.getElementById('bhSheet'); s.querySelectorAll('[data-pick]').forEach((b) => { if (b.checked) b.click(); }); s.querySelector('[data-pick=\"0\"]').click(); return true; })()");
      await click(acc, "#bhAskSend");
      await acc.until("!!document.getElementById('bhAskDone')", 8000);
      await click(acc, "#bhAskDone");
      const v = await db(acc, "R.bills.find((b) => b.id === " + J.hillside + ").version");
      await acc.eval("DCR2Demo.engine.rpc({ uid: " + JSON.stringify(J.admin) + " }, 'approve_bill', { id: " + J.hillside + ", pay_method: 'check', version: " + v + ", note: null }); true");
      await acc.eval("window.__pc({})");
      const aside = await db(acc, "R.money_messages.filter((m) => m.kind === 'approval_request' && (m.bill_ids || []).includes(" + J.hillside + ")).map((m) => [m.status, m.status_note]).pop()");
      check("3g. a bill approved first: its ask is set aside, said why", aside && aside[0] === "not_sent" && /approved, voided or deleted meanwhile/.test(aside[1]), JSON.stringify(aside));
      // the bill page: Ask for a money editor who does not approve, with the last ask; the approvals card's "asked by"
      await open(acc, "/bill.html?id=" + J.w3301, "!!document.getElementById('blAsk') && /Last asked: /.test((document.getElementById('blAsked') || {}).textContent || '')");
      const said = await acc.eval("document.getElementById('blAsked').textContent");
      check("3h. the bill page: [Ask to approve] and \"Last asked\" for the accountant", /^Last asked: Avery · e-mail ✓ sent .+; Drew · text \(by hand\)/.test(said), said);
      await click(acc, "#blAsk");
      await acc.until(sheetOpen + " && !!document.querySelector('#bhSheet [data-pick=\"0\"]')", 8000);
      await shoot(acc, "bill_ask_accountant", "desktop", false, false);
      await click(acc, "#bhAskCancel");
      await open(ad, "/dashboard.html", "!!document.getElementById('hmApprovalsCard') && /asked by/.test((document.querySelector('#hmApprovalsCard [data-asked=\"" + J.quarry + "\"]') || {}).textContent || '')");
      const by = await ad.eval("document.querySelector('#hmApprovalsCard [data-asked=\"" + J.quarry + "\"]').textContent");
      check("3i. Home's approvals card (an approver's): \"asked by Casey · …\"", /^asked by Casey · (just now|\d+ min ago)$/.test(by), by);
      await open(ad, "/bill.html?id=" + J.w3301, "!!document.getElementById('blGo')");
      check("3j. an approver's bill page: Approve, no Ask", !(await ad.eval("!!document.getElementById('blAsk')")));
    }, acc);

    /* ── 4. record a payment ──────────────────────────────────────────── */
    await attempt("4. record a payment", async () => {
      await open(acc, "/books-home.html", HOME + " && !!document.querySelector('#secChecks [data-open=\"" + J.rosewell + "\"]')");
      await click(acc, '#secChecks [data-open="' + J.rosewell + '"]');
      await acc.until("!!document.getElementById('ckWrite') && document.getElementById('ckNumber').value === '5309'", 10000);
      check("4a. the next check number prefilled (#5309)", true);
      await acc.eval("window.__set('ckDate', " + JSON.stringify(J.yesterday) + ")");
      const took = await acc.eval("(async () => window.__paste('#ckPanel', [await window.__png('Made-up check photo')]))()");
      await acc.eval("window.__drop('#ckFiles .fd', [window.__pdf('Rosewell remittance.pdf')])");
      await acc.until("document.querySelectorAll('#ckFiles .fd-t').length === 2", 5000);
      check("4b. a picture pasted, a PDF dropped: two files waiting for the payment", took === true);
      await four(acc, "pay_panel_accountant", false);
      await acc.eval("document.getElementById('ckNumber').value = '5306'; document.getElementById('ckNumber').dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('ckWrite').click(); true");
      await acc.until(modalOpen, 5000);
      await modalOk(acc);
      await acc.until("/check register/.test(document.getElementById('ckMsg').textContent)", 8000);
      const said = await acc.eval("document.getElementById('ckMsg').textContent");
      check("4c. a used number refused in the database's words", /^Check 5306 is already in the check register \(Stonebrook Concrete, /.test(said), said);
      await acc.eval("document.getElementById('ckNumber').value = '5309'; document.getElementById('ckNumber').dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('ckWrite').click(); true");
      await acc.until(modalOpen, 5000);
      await modalOk(acc);
      await acc.until("DCR2Demo.engine.rows.payments.some((p) => p.check_number === '5309')", 10000);
      const pay = await db(acc, "R.payments.find((p) => p.check_number === '5309')");
      await acc.until("DCR2Demo.engine.rows.files.filter((f) => f.payment_id === " + pay.id + ").length === 2", 20000);
      const names = await db(acc, "R.files.filter((f) => f.payment_id === " + pay.id + ").map((f) => f.name)");
      await open(acc, "/books-home.html", HOME + " && !!document.querySelector('[data-paid=\"" + pay.id + "\"]')");
      const row = await acc.eval("(document.querySelector('[data-paid=\"" + pay.id + "\"]') || {}).innerText || ''");
      check("4d. recorded, dated yesterday; Paid in the last 30 days shows it with its files (📎), two with distinct names",
        pay.paid_date === J.yesterday && new Set(names).size === 2 && /📎\s*3/.test(row) && /#5309/.test(row), row.replace(/\s+/g, " ") + " " + JSON.stringify(names));
      await acc.eval("document.querySelector('[data-paid=\"" + pay.id + "\"] [data-files]').click(); true");
      await acc.until("!document.getElementById('fvView').hidden", 6000);
      check("4e. 📎 opens the payment's files, then the bill's, in the viewer", /of 3/.test(await acc.eval("document.getElementById('fvN').textContent")));
      await click(acc, "#fvClose");
    }, acc);

    /* ── 5. tell them ─────────────────────────────────────────────────── */
    await attempt("5. tell them", async () => {
      await open(acc, "/books-home.html", HOME + " && !!window.__group('Brightwater Concrete')");
      await acc.eval("window.__group('Brightwater Concrete').querySelector('[data-tell=email]').click(); true");
      await acc.until("DCR2Demo.engine.rows.money_messages.some((m) => m.kind === 'payment_pickup' && m.status === 'queued' && (m.payment_ids || []).includes(" + J.p5310 + "))", 6000);
      await acc.until("!!window.__group('Brightwater Concrete') && /E-mail waiting for the reminder PC/.test(window.__group('Brightwater Concrete').innerText)", 8000);
      check("5a. by e-mail: queued - \"E-mail waiting for the reminder PC\"", true);
      await shoot(acc, "tell_waiting_accountant", "desktop", false, false);
      await acc.eval("window.__pc({ optOut: true })");
      await open(acc, "/books-home.html", HOME + " && !!window.__group('Brightwater Concrete')");
      check("5b. an opt-out on the PC: \"not sent: opted out\", still to tell", /not sent: opted out/.test(await acc.eval("window.__group('Brightwater Concrete').innerText")));
      await acc.eval("window.__group('Brightwater Concrete').querySelector('[data-tell=email]').click(); true");
      await acc.until("DCR2Demo.engine.rows.money_messages.filter((m) => m.kind === 'payment_pickup' && (m.payment_ids || []).includes(" + J.p5310 + ")).some((m) => m.status === 'queued')", 6000);
      await acc.eval("window.__pc({})");
      const told = await db(acc, "R.payments.find((p) => p.id === " + J.p5310 + ")");
      check("5c. sent by the reminder PC: told by e-mail, by her (e-mail by DCR Agents 2)", told.pickup_told_how === "email" && /^Casey Accounts \(e-mail by DCR Agents 2\)$/.test(told.pickup_told_by), JSON.stringify([told.pickup_told_how, told.pickup_told_by]));
      // by text
      await open(acc, "/books-home.html", HOME + " && !!window.__group('Fernhill Concrete')");
      await acc.eval("window.__group('Fernhill Concrete').querySelector('[data-tell=sms]').click(); true");
      await acc.until(sheetOpen + " && !!document.querySelector('#bhSheet .bh-text a[data-act=open]')", 8000);
      const href = await acc.eval("document.querySelector('#bhSheet .bh-text a[data-act=open]').getAttribute('href')");
      const tx = await db(acc, "R.money_messages.filter((m) => m.kind === 'payment_pickup' && m.channel === 'sms').pop()");
      check("5d. by text: the sms: link with the payee's mobile and the database's text", href === "sms:+18055550151?&body=" + encodeURIComponent(tx.body) && !MONEY.test(tx.body), href.slice(0, 100));
      await four(acc, "tell_text_accountant", false);
      await click(acc, '#bhSheet .bh-text [data-act="sent"]');
      await acc.until("(DCR2Demo.engine.rows.payments.find((p) => p.id === " + J.p5202 + ") || {}).pickup_told_how === 'text message'", 6000);
      check("5e. I sent it: told by text at once", true);
      await acc.until("!(" + sheetOpen + ")", 6000);
      // by call
      await open(acc, "/books-home.html", HOME + " && !!window.__group('Hollis Lumber Supply')");
      await acc.eval("window.__group('Hollis Lumber Supply').querySelector('[data-tell=call]').click(); true");
      await acc.until("!!window.__group('Hollis Lumber Supply').querySelector('.bh-call a[href^=\"tel:\"]')", 4000);
      await acc.eval("Array.from(window.__group('Hollis Lumber Supply').querySelectorAll('.bh-call button')).find((b) => /Told by phone/.test(b.textContent)).click(); true");
      await acc.until("(DCR2Demo.engine.rows.payments.find((p) => p.id === " + J.hollis + ") || {}).pickup_told_how === 'phone'", 6000);
      check("5f. by call: the tel: link, then Told by phone", true);
      // in person (a bill with no contact on file)
      await open(acc, "/books-home.html", HOME + " && !!window.__group('Hillside Equipment Rental')");
      const none = await acc.eval("window.__group('Hillside Equipment Rental').innerText");
      await acc.eval("window.__group('Hillside Equipment Rental').querySelector('[data-tell=person]').click(); true");
      await acc.until(modalOpen, 5000);
      await modalOk(acc);
      await acc.until("(DCR2Demo.engine.rows.payments.find((p) => p.id === " + J.hcash + ") || {}).pickup_told_how === 'in person'", 6000);
      check("5g. no e-mail or phone on file: said so; told in person", /No e-mail or phone on file for them/.test(none), none.slice(0, 160));
      // picked up, and not
      await open(acc, "/books-home.html", HOME + " && !!document.querySelector('[data-picked=\"" + J.p5201 + "\"]')");
      await click(acc, '[data-picked="' + J.p5201 + '"]');
      await acc.until(modalOpen, 5000);
      await acc.eval("document.getElementById('dcrMoF1').value = 'their foreman'; true");
      await modalOk(acc);
      await acc.until("!!(DCR2Demo.engine.rows.payments.find((p) => p.id === " + J.p5201 + ") || {}).picked_up_at", 6000);
      await open(acc, "/books-home.html", HOME + " && !!document.querySelector('[data-unpick=\"" + J.p5201 + "\"]')");
      check("5h. Picked up (who collected it): off the waiting list, \"picked up\" on the Paid list", !(await acc.eval("!!document.querySelector('[data-picked=\"" + J.p5201 + "\"]')")) &&
        /picked up/.test(await acc.eval("document.querySelector('[data-paid=\"" + J.p5201 + "\"]').innerText")));
      await click(acc, '[data-unpick="' + J.p5201 + '"]');
      await acc.until(modalOpen, 5000);
      await modalOk(acc);
      await acc.until("!(DCR2Demo.engine.rows.payments.find((p) => p.id === " + J.p5201 + ") || {}).picked_up_at", 6000);
      check("5i. Not picked up: the mark taken off", true);
      await open(acc, "/books-home.html", HOME);
      await four(acc, "page_after_accountant", true);
    }, acc);

    /* ── 6. the templates ─────────────────────────────────────────────── */
    await attempt("6. the templates", async () => {
      await open(acc, "/books-home.html", HOME);
      await click(acc, "#bhTemplates");
      await acc.until(sheetOpen + " && !!document.getElementById('bhTplBody')", 8000);
      await click(acc, '#bhSheet [data-key="check_ready"]');
      await acc.until("!!document.querySelector('#bhSheet [data-key=\"check_ready\"][aria-selected=\"true\"]')", 4000);
      await four(acc, "templates_accountant", false);
      await acc.eval("window.__set('bhTplSms', 'Hi {{firstName}}, your check is at the front desk. Please bring ID.')");
      await click(acc, '#bhSheet [data-save="sms"]');
      await acc.until("/^Saved/.test(document.getElementById('bhTplMsgS').textContent)", 6000);
      check("6a. a text saved", (await db(acc, "R.message_templates.find((t) => t.key === 'check_ready' && t.channel === 'sms').body")) === "Hi {{firstName}}, your check is at the front desk. Please bring ID.");
      await acc.eval("window.__set('bhTplBody', 'Hello {{payee}}, your check for $1,250.00 is ready.')");
      await click(acc, '#bhSheet [data-save="email"]');
      await acc.until("/amount/.test(document.getElementById('bhTplMsgE').textContent)", 6000);
      check("6b. an amount refused in the database's words", (await acc.eval("document.getElementById('bhTplMsgE').textContent")) === "The text holds an amount: a money message never carries one.");
      await click(acc, '#bhSheet [data-reset="sms"]');
      await acc.until(modalOpen, 5000);
      await modalOk(acc);
      await acc.until("/original/.test(document.getElementById('bhTplMsgS').textContent)", 6000);
      check("6c. reset to the original", /^Hi \{\{firstName\}\}, your check from \{\{company\}\}/.test(await db(acc, "R.message_templates.find((t) => t.key === 'check_ready' && t.channel === 'sms').body")));
      // a second tab, open on the same template, saves after this one: PT409
      const two = await newPage(cdp, "accountant-2", OUT); pages.push(two);
      await two.size(1440, 900, false);
      await signIn(two, "accountant");
      await open(two, "/books-home.html", HOME);
      await click(two, "#bhTemplates");
      await two.until(sheetOpen + " && !!document.getElementById('bhTplBody')", 8000);
      await click(two, '#bhSheet [data-key="check_ready"]');
      await two.until("!!document.querySelector('#bhSheet [data-key=\"check_ready\"][aria-selected=\"true\"]')", 4000);
      await acc.eval("window.__set('bhTplSms', 'Hi {{firstName}}, the first tab wrote this.')");
      await click(acc, '#bhSheet [data-save="sms"]');
      await acc.until("/^Saved/.test(document.getElementById('bhTplMsgS').textContent)", 6000);
      await sleep(600);
      await two.eval("window.__set('bhTplSms', 'Hi {{firstName}}, the second tab wrote this.')");
      await click(two, '#bhSheet [data-save="sms"]');
      await two.until("/someone else/i.test(document.getElementById('bhTplMsgS').textContent)", 8000);
      check("6d. a second tab's stale save: \"Changed by someone else — showing theirs.\" and theirs",
        (await two.eval("document.getElementById('bhTplSms').value")) === "Hi {{firstName}}, the first tab wrote this.", await two.eval("document.getElementById('bhTplMsgS').textContent"));
      await click(acc, "#bhSheetX");
    }, acc);

    /* ── 7. Advanced mode ─────────────────────────────────────────────── */
    await attempt("7. Advanced mode", async () => {
      await open(acc, "/books-home.html", HOME);
      await click(acc, "#bhAdvTop");
      await acc.until("location.pathname === '/accounting.html' && !!document.getElementById('secPay')", 15000);
      check("7. the big button opens The Books (accounting.html)", true);
    }, acc);

    /* ── 10. everywhere ───────────────────────────────────────────────── */
    await attempt("10. phone width, check 5", async () => {
      const sw = await phoneWidth(acc, "/books-home.html", HOME);
      check("10a. the accountant's page on a phone: no sideways scroll", sw <= 391, sw);
      await acc.size(390, 844, true);
      await open(acc, "/books-home.html", HOME);
      await click(acc, "#bhTemplates");
      await acc.until(sheetOpen + " && !!document.getElementById('bhTplBody')", 8000);
      const sw2 = await acc.eval("document.documentElement.scrollWidth");
      check("10b. the templates sheet on a phone: full screen, no sideways scroll", sw2 <= 391, sw2);
      await click(acc, "#bhSheetX");
      await acc.size(1440, 900, false);
      const bad = await db(acc, "R.notifications_outbox.filter((o) => (o.kind === 'approval_request' || o.kind === 'payment_pickup') && Date.parse(o.created_at) >= " + start + ")" +
        ".concat(R.money_messages.filter((m) => Date.parse(m.created_at) >= " + start + ")).map((x) => (x.subject || '') + ' ' + (x.body || ''))");
      check("10c. P5 check 5: no amount in any money e-mail or text written in the walk (" + bad.length + ")", bad.length >= 3 && !bad.some((t) => MONEY.test(t)),
        (bad.find((t) => MONEY.test(t)) || "").slice(0, 200));
    }, acc);

    for (const p of pages) {
      const bad = p.log.filter((x) => /CSP-VIOLATION|Content Security Policy/i.test(x.text) || x.level === "exception" ||
        (x.level === "error" && !/favicon\.ico|net::ERR_ABORTED|ERR_INTERNET_DISCONNECTED|Failed to fetch|demo: offline/.test(x.text + " " + (x.url || ""))));
      check("10d. " + p.name + ": no CSP violation, no console error", !bad.length, bad.slice(0, 5).map((x) => x.level + " " + x.text.slice(0, 200) + " @ " + x.url).join(" | "));
    }
  } finally {
    try { proc.kill(); } catch (e) { /* */ }
    server.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results, shots: shots.length, out: OUT }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
