#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of P5b's books side in the DEMO (development only).

     node tools/e2e-p5b-books.mjs [--out <dir>] [--chrome <path>] [--shots all|none] [--roles a,b,c]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with M5b's books rules -
   tools/fake/p5b-books.js; nothing goes to Supabase) and drives a local Chrome or Edge headless:

   - every role (admin, a manager WITH the approve switch, a manager without it - Q1, accountant, lead, field, view-only): the home
     page (The Books card only with financials; the approvals card only for an approver - never the accountant; no
     amount on the page for anyone without financials); The Books (the desk for financials, a refusal and back home for
     everyone else, before any amount is read); the bill page (Approve only for an admin or an approver; the accountant
     sees the bill and no approve button; the others are refused);
   - P5 acceptance check 2: the approver approves with a REQUIRED pay method (an empty choice is refused in the dialog;
     the approval records who, when, the amount and the method); an admin approves too; the accountant and a manager
     without approve are refused by the database (42501); a stale version is PT409; a missing pay method is 400; an
     edit of an approved bill's amount clears the approval; a payment over the approved amount is refused (23514);
     the approver changes how an approved, unpaid bill is paid (set_bill_pay_method);
   - the check desk: the accountant opens a bill to pay (payee and memo prefilled, the documents), records the check,
     finds how to reach the payee, marks them told by phone (payment_told: DCR Agents 2 never tells them twice);
   - bank transfer and card (owner decision 2026-10-21): the approve dialog offers check, cash, either, bank transfer and
     card; the approver approves a bill for a bank transfer; the accountant finds it on "Pay by bank transfer or card"
     (never the check desk), pays it by wire with its confirmation and no check number, pays a card bill by card, and
     nobody is told about either; any other way is refused in the database's words;
   - P5 acceptance check 3: the CSV (a BOM, CRLF, every cell quoted, a memo beginning with "-" made text), "Mark
     entered" with a bill un-approved meanwhile (refused[] shown in full, the rest marked by the accountant, the QBO
     ref kept), Undo; the invoices' own marker;
   - P5 acceptance check 5: no activity row and no outbox body written during the walk carries an amount;
   - phone (390 px: the pages never scroll sideways) and desktop, light and dark; no Content-Security-Policy
     violation and no console error on any page.
   Screenshots (--shots all): books_<what>_<role>_<light|dark>_<desktop|phone>.png into --out.
   Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p5b-books")));
const SHOTS = arg("--shots", "all");
const ROLES = (arg("--roles", "admin,approver,manager,accountant,lead,field,viewer")).split(",").filter(Boolean);
const BOOKS = { admin: true, approver: true, accountant: true };
const APPROVES = { admin: true, approver: true };
const AMOUNT = /\$\s?\d/;

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
  async function open(p, path, marker, ms) {
    await p.goto(base + path, 150);
    const here = "(location.pathname).indexOf(" + JSON.stringify(path.split("?")[0]) + ") === 0";
    await p.until(here + " && " + TOPBAR + (marker ? " && (" + marker + ")" : ""), ms || 15000);
  }
  async function signIn(p, key, next) {
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
    await p.goto(base + "/index.html" + (next ? "?next=" + encodeURIComponent(next) : ""), 150);
    await p.until("!!document.getElementById('loginForm') && !!window.DCR2Demo && !document.getElementById('loginFields').disabled", 8000);
    await p.eval("document.getElementById('email').value=" + JSON.stringify(key + "@demo.test") + ";document.getElementById('password').value='demo-password-1';" +
      "document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname) && " + TOPBAR, 10000);
  }
  const db = (p, expr) => p.eval("(() => { const R = DCR2Demo.engine.rows; return " + expr + "; })()");
  const html = (p) => p.eval("document.documentElement.outerHTML");
  const modalOpen = "!!document.querySelector('.dcr-mo.open')";
  const modalOk = (p) => p.eval("(() => { const b = document.getElementById('dcrMoYes'); if (b) b.click(); return !!b; })()");
  const DESK = "!!document.getElementById('secQbo') && !!document.getElementById('secPay')";
  const BILL = "!!document.getElementById('blDecision')";
  // the page's own repository, run in the page (its signed-in person): -> {ok, code, status, message, data}
  const repo = (p, call) => p.eval("(async () => { const R = await import('/js/repo/books.js'); const sb = await import('/js/sb.js'); const me = await sb.me(); " +
    "try { const data = await (" + call + "); return { ok: true, data: JSON.parse(JSON.stringify(data === undefined ? null : data)) }; } " +
    "catch (e) { return { ok: false, code: e.code, status: e.status, message: e.message }; } })()");
  const raw = (p, call) => p.eval("(async () => { const c = DCR2.sb(); const r = await (" + call + "); return { data: r.data, error: r.error ? { code: r.error.code, message: r.error.message } : null }; })()");

  async function shoot(p, name, device, dark, full) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1440;
    const base0 = device === "phone" ? 844 : 900;
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: base0, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(500);
    const h = full === false ? base0 : await p.eval("Math.max(" + base0 + ", Math.min(5200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(450);
    const file = "books_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: base0, deviceScaleFactor: 1, mobile: device === "phone" });
    await p.dark(false);
  }
  async function four(p, name, full) {
    await shoot(p, name, "desktop", false, full); await shoot(p, name, "desktop", true, full);
    await shoot(p, name, "phone", false, full); await shoot(p, name, "phone", true, full);
    await p.size(1440, 900, false);
  }

  try {
    /* ── 0. a clean demo database ──────────────────────────────────────── */
    const a = await newPage(cdp, "setup", OUT); pages.push(a);
    await a.size(1440, 900, false);
    await a.goto(base + "/manifest.json", 50);
    await a.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");
    await signIn(a, "admin", "dashboard.html");
    const J = await db(a, `(() => {
      const id = (what) => (R.bills.find((b) => b.description === what) || {}).id;
      return { waiting: id("Footings and stem wall, phase 1"), nodoc: id("Roof framing package (back order)"), retain: id("-10% retainage held until the final walk"),
        cash: id("Slab patch at the roll-up door"), either: id("Telehandler, one week"), porch: id("Porch footings"), told: id("Porch decking and hardware"),
        approver: DCR2Demo.people.find((p) => p.key === "approver").id, accountant: DCR2Demo.people.find((p) => p.key === "accountant").id,
        acts: R.activity.length, outbox: R.notifications_outbox.length, maxAct: R.activity.reduce((m, x) => Math.max(m, x.id), 0) };
    })()`);
    check("demo: the books' made-up bills, payments and invoices and the demo approver (tools/fake/p5b-books.js)",
      J.waiting && J.nodoc && J.retain && J.cash && J.either && J.porch && J.told && J.approver &&
      (await db(a, "R.bills.every(b => 'kind' in b && 'qbo_entered_at' in b) && R.invoices.every(i => 'qbo_entered_at' in i) && R.payments.every(p => 'payee' in p)")),
      JSON.stringify(J));

    /* ── 1. every role: home, The Books, the bill page ─────────────────── */
    for (const role of ROLES) {
      const p = await newPage(cdp, role, OUT); pages.push(p);
      await p.size(1440, 900, false);
      await attempt(role + ": home, The Books, the bill page", async () => {
        await signIn(p, role, "dashboard.html");
        await p.until("document.querySelectorAll('.hm-card').length > 2", 8000);
        if (APPROVES[role]) await p.until("!!document.getElementById('hmApprovalsCard')", 8000).catch(() => null); else await sleep(1200);
        const home = await p.eval("({ cards: Array.from(document.querySelectorAll('.hm-card .tt')).map(n => n.childNodes[0].textContent), ap: !!document.getElementById('hmApprovalsCard'), apText: (document.getElementById('hmApprovals') || {}).innerText || '', h: document.getElementById('hmSections').innerHTML + (document.getElementById('hmApprovals') || {}).innerHTML })");
        check(role + ": home - The Books card " + (BOOKS[role] ? "shown" : "not shown"), home.cards.includes("The Books") === !!BOOKS[role], home.cards.join("|"));
        check(role + ": home - the approvals card " + (APPROVES[role] ? "shown (bills waiting, with amounts and Open links)" : "not shown"),
          home.ap === !!APPROVES[role] && (!APPROVES[role] || (/waiting for approval/.test(home.apText) && AMOUNT.test(home.apText) && /needs the invoice attached/.test(home.apText))), home.apText.slice(0, 200));
        if (!BOOKS[role]) check(role + ": home - no amount on the page", !AMOUNT.test(home.h), (home.h.match(/.{40}\$\s?\d.{20}/) || [""])[0]);
        if (SHOTS !== "none") {
          if (APPROVES[role]) { await shoot(p, "home_" + role, "desktop", false, false); await shoot(p, "home_" + role, "phone", true, false); await p.size(1440, 900, false); }
          else if (role === "accountant" || role === "manager") await shoot(p, "home_" + role, "desktop", false, false);
        }

        // The Books
        await p.goto(base + "/accounting.html", 150);
        if (BOOKS[role]) {
          await p.until(TOPBAR + " && " + DESK, 15000);
          const d = await p.eval("({ todo: document.querySelectorAll('.ac-todo-list li').length, picture: !!document.querySelector('.bk'), pay: document.querySelectorAll('#secPay [data-open]').length, tell: document.querySelectorAll('#secTell .ck-tell').length, ready: document.querySelectorAll('#secQbo [data-pick]').length, mark: !!document.getElementById('acMark'), ar: document.querySelectorAll('#secAr [data-pickinv]').length, approve: document.querySelectorAll('#acBody [id*=pprove], #acBody .bl-approve').length })");
          check(role + ": The Books - the picture, the to-do list, bills to pay, payees to tell, ready to enter (with Mark entered), money in, and no approve button anywhere",
            d.picture && d.todo >= 5 && d.pay >= 3 && d.tell >= 1 && d.ready >= 3 && d.mark && d.ar >= 1 && d.approve === 0, JSON.stringify(d));
          if (SHOTS !== "none" && role !== "admin") await four(p, "desk_" + role, true);
          if (SHOTS !== "none" && role === "admin") { await shoot(p, "desk_" + role, "desktop", false, true); await shoot(p, "desk_" + role, "phone", true, true); await p.size(1440, 900, false); }
          await p.size(390, 844, true);
          await open(p, "/accounting.html", DESK);
          const sw = await p.eval("document.documentElement.scrollWidth");
          check(role + ": The Books on a phone - the page does not scroll sideways", sw <= 391, sw);
          await p.size(1440, 900, false);
        } else {
          await p.until(modalOpen, 10000);
          const t = await p.eval("document.querySelector('.dcr-mo.open').innerText");
          const h0 = await html(p);
          check(role + ": The Books refused ('not available for your role') before any amount is read", /not available for your role/.test(t) && !AMOUNT.test(h0), t.slice(0, 120));
          if (SHOTS !== "none" && (role === "manager" || role === "lead" || role === "field")) {
            await shoot(p, "refused_" + role, "desktop", false, false);
            await shoot(p, "refused_" + role, "phone", true, false);
            await p.size(1440, 900, false);
          }
          await modalOk(p);
          await p.until("/dashboard\\.html/.test(location.pathname)", 8000);
          const asked = await p.eval("performance.getEntriesByType('resource').map(r => r.name).filter(n => /\\/rest\\/v1\\/(bills|payments|invoices|books_desk)/.test(n)).length");
          check(role + ": nothing of the money tables was asked for", asked === 0, asked);
        }

        // the bill page (the waiting bill with its paperwork)
        await p.goto(base + "/bill.html?id=" + J.waiting, 150);
        if (BOOKS[role]) {
          await p.until(TOPBAR + " && " + BILL, 15000);
          const b = await p.eval("({ go: !!document.getElementById('blGo'), no: (document.getElementById('blNoApprove') || {}).textContent || '', state: (document.getElementById('blState') || {}).textContent || '', tabs: document.querySelectorAll('[data-f]').length })");
          check(role + ": the bill page - AWAITING APPROVAL, the paperwork, and " + (APPROVES[role] ? "the Approve button" : "NO approve button (only an admin or a manager with approve authority)"),
            b.state === "AWAITING APPROVAL" && b.tabs >= 1 && b.go === !!APPROVES[role] && (APPROVES[role] || /Only an admin, or a manager with approve authority/.test(b.no)), JSON.stringify(b));
          if (SHOTS !== "none") await four(p, "bill_" + role, true);
          await p.size(390, 844, true);
          await open(p, "/bill.html?id=" + J.waiting, BILL);
          const sw = await p.eval("document.documentElement.scrollWidth");
          check(role + ": the bill page on a phone - no sideways scroll", sw <= 391, sw);
          await p.size(1440, 900, false);
        } else {
          await p.until(modalOpen, 10000);
          const h1 = await html(p);
          check(role + ": the bill page refused, no amount on it", /not available for your role/.test(await p.eval("document.querySelector('.dcr-mo.open').innerText")) && !AMOUNT.test(h1));
          await modalOk(p);
          await p.until("/dashboard\\.html/.test(location.pathname)", 8000);
        }
      }, p);
    }
    const page = (k) => pages.find((x) => x.name === k);

    /* ── 2. approval (P5 acceptance check 2) ───────────────────────────── */
    const ap = page("approver");
    if (ap) await attempt("approver: approve with a required pay method", async () => {
      await open(ap, "/bill.html?id=" + J.waiting, BILL + " && !!document.getElementById('blGo')");
      const v0 = await db(ap, "R.bills.find(b => b.id === " + J.waiting + ").version");
      await ap.eval("document.getElementById('blNote').value = 'Matches the quote'; document.getElementById('blGo').click(); true");
      await ap.until(modalOpen, 5000);
      await modalOk(ap);                         // nothing chosen
      await sleep(300);
      const err = await ap.eval("(document.getElementById('dcrMoErr') || {}).textContent || ''");
      check("approver: the dialog refuses to approve without a pay method", /Choose how it is paid: by check, in cash, either, by bank transfer or by card/.test(err) && !(await db(ap, "!!R.bills.find(b => b.id === " + J.waiting + ").approved_at")), err);
      await ap.eval("(() => { const s = document.querySelector('.dcr-mo.open select'); s.value = 'check'; s.dispatchEvent(new Event('change')); return true; })()");
      await shoot(ap, "approve_dialog_approver", "desktop", false, false);
      await modalOk(ap);
      await ap.until("!!DCR2Demo.engine.rows.bills.find(b => b.id === " + J.waiting + ").approved_at", 6000);
      await ap.until("(document.getElementById('blState') || {}).textContent === 'APPROVED'", 6000);
      const b = await db(ap, "R.bills.find(b => b.id === " + J.waiting + ")");
      check("approver: approved - by the approver, the bill's amount frozen, pay method check, the note kept, the version moved",
        b.approved_by === J.approver && Number(b.approved_amount) === Number(b.amount) && b.pay_method === "check" && b.approval_note === "Matches the quote" && b.version === v0 + 1,
        JSON.stringify({ by: b.approved_by, amt: b.approved_amount, m: b.pay_method, v: b.version }));
      await shoot(ap, "approved_approver", "desktop", false, false);
      // change how an approved, unpaid bill is paid
      await open(ap, "/bill.html?id=" + J.retain, BILL + " && !!document.getElementById('blHow')");
      await ap.eval("document.getElementById('blHow').click(); true");
      await ap.until(modalOpen, 5000);
      await ap.eval("(() => { const s = document.querySelector('.dcr-mo.open select'); s.value = 'cash'; return true; })()");
      await modalOk(ap);
      await ap.until("DCR2Demo.engine.rows.bills.find(b => b.id === " + J.retain + ").pay_method === 'cash'", 6000);
      check("approver: 'Change how to pay' on an approved, unpaid bill (set_bill_pay_method) - now cash", true);
      // a bill with a payment: the method is settled
      await open(ap, "/bill.html?id=" + J.either, BILL);
      check("approver: a part-paid bill offers no change of pay method", !(await ap.eval("!!document.getElementById('blHow')")));
    }, ap);

    const ac = page("accountant"), mg = page("manager"), ad = page("admin");
    if (ac && mg && ad) await attempt("the database's refusals (acceptance check 2)", async () => {
      await open(ac, "/bill.html?id=" + J.nodoc, BILL);
      const nodoc = await db(ac, "R.bills.find(b => b.id === " + J.nodoc + ")");
      const r1 = await repo(ac, "R.approve({ id: " + J.nodoc + ", version: " + nodoc.version + " }, 'check', null)");
      check("accountant: approve_bill refused (42501) - an accountant never approves", !r1.ok && r1.code === "42501", JSON.stringify(r1));
      await open(mg, "/dashboard.html", "document.querySelectorAll('.hm-card').length > 2");
      const r2 = await repo(mg, "R.approve({ id: " + J.nodoc + ", version: " + nodoc.version + " }, 'check', null)");
      check("manager without approve: approve_bill refused (42501)", !r2.ok && r2.code === "42501", JSON.stringify(r2));
      await open(ad, "/bill.html?id=" + J.porch, BILL);
      const sbWait = await db(ad, "R.bills.find(b => !b.approved_at && b.document_file_id && b.id !== " + J.waiting + " && !b.void && !b.deleted_at)");
      const r3 = await repo(ad, "R.approve({ id: " + sbWait.id + ", version: " + (sbWait.version - 1) + " }, 'check', null)");
      check("admin: a stale version is refused (PT409, 409)", !r3.ok && r3.code === "PT409" && r3.status === 409, JSON.stringify(r3));
      const r4 = await repo(ad, "R.approve({ id: " + sbWait.id + ", version: " + sbWait.version + " }, null, null)");
      check("admin: a missing pay method is refused (22023, 400)", !r4.ok && r4.code === "22023" && r4.status === 400, JSON.stringify(r4));
      const r4b = await repo(ad, "R.approve({ id: " + J.nodoc + ", version: " + nodoc.version + " }, 'check', null)");
      check("admin: a bill without its document cannot be approved (23514)", !r4b.ok && r4b.code === "23514" && /document/.test(r4b.message), JSON.stringify(r4b));
      const r5 = await repo(ad, "R.approve({ id: " + sbWait.id + ", version: " + sbWait.version + " }, 'both', 'Admin approved')");
      check("admin: approves (pay method either)", r5.ok && (await db(ad, "R.bills.find(b => b.id === " + sbWait.id + ").pay_method")) === "both", JSON.stringify(r5));
      // an edit of an approved bill's amount clears the approval (Desktop 2 edits bills; the rule is the database's)
      const ab = await db(ad, "R.bills.find(b => b.id === " + sbWait.id + ")");
      const r6 = await raw(ad, "c.from('bills').update({ amount: " + (Number(ab.amount) + 10) + " }).eq('id', " + ab.id + ").eq('version', " + ab.version + ").select('approved_at, pay_method, approved_amount')");
      check("an edit of an approved bill's amount clears the approval", !r6.error && r6.data && r6.data[0] && r6.data[0].approved_at === null && r6.data[0].pay_method === null, JSON.stringify(r6));
      // a payment over the approved amount
      const over = await db(ad, "(() => { const b = R.bills.find(b => b.id === " + J.retain + "); return { id: b.id, projectId: b.project_id, amt: Number(b.approved_amount) }; })()");
      const r7 = await repo(ad, "R.recordPayment({ id: " + over.id + ", projectId: " + over.projectId + " }, { amount: " + (over.amt + 0.01) + ", method: 'cash', checkNumber: '' })");
      check("a payment over the approved amount is refused by the database (23514)", !r7.ok && r7.code === "23514" && /exceed the approved amount/.test(r7.message), JSON.stringify(r7));
      const r8 = await repo(ad, "R.recordPayment({ id: " + over.id + ", projectId: " + over.projectId + " }, { amount: 10, method: 'check', checkNumber: '1' })");
      check("a check against a bill approved for cash is refused (23514)", !r8.ok && r8.code === "23514", JSON.stringify(r8));
    }, ad);

    /* ── 3. the check desk ─────────────────────────────────────────────── */
    if (ac) await attempt("accountant: record the check, reach the payee, mark told", async () => {
      await open(ac, "/accounting.html", DESK + " && !!document.querySelector('#secPay [data-open=\"" + J.waiting + "\"]')");
      await ac.eval("document.querySelector('#secPay [data-open=\"" + J.waiting + "\"]').click(); true");
      await ac.until("!!document.getElementById('ckWrite') && !!document.getElementById('ckPayee')", 8000);
      const f = await ac.eval("({ payee: document.getElementById('ckPayee').value, memo: document.getElementById('ckMemo').value, amount: document.getElementById('ckAmount').value, docs: document.querySelectorAll('#ckPanel [data-doc]').length })");
      check("accountant: the check desk - payee (the vendor's company), memo (job · invoice · what), the amount still owed, the documents",
        f.payee === "Quarryman Concrete" && /^A303 — .+ · Inv INV-\d+ · Footings/.test(f.memo) && f.memo.length <= 100 && Number(f.amount) > 0 && f.docs >= 1, JSON.stringify(f));
      await ac.eval("document.getElementById('ckAmount').value = '999999'; document.getElementById('ckNumber').value = '5401'; document.getElementById('ckWrite').click(); true");
      await sleep(300);
      const over = await ac.eval("document.getElementById('ckMsg').textContent");
      check("accountant: more than is still authorised is refused on the page too", /more than the \$/.test(over), over);
      await ac.eval("document.getElementById('ckAmount').value = " + JSON.stringify(f.amount) + "; true");
      // review fix: on a phone the "How" column is hidden - the open panel must span the columns shown, or the
      // browser adds an empty column and every row of "Bills to pay" shrinks (each row's last cell ends where the
      // table ends, open or not; the panel cell's span is the number of columns shown)
      const fit = "(() => { const t = document.querySelector('#secPay table.ac-t'); const tr = t.getBoundingClientRect().right; " +
        "const rows = Array.from(t.querySelectorAll('tr.ck-row')).map((r) => Math.round(r.lastElementChild.getBoundingClientRect().right)); " +
        "const td = t.querySelector('td.ck-cell'); const shown = Array.from(t.querySelectorAll('thead th')).filter((x) => getComputedStyle(x).display !== 'none').length; " +
        "return { table: Math.round(tr), rows, span: td ? td.colSpan : 0, shown, sw: document.documentElement.scrollWidth, mm: matchMedia('(max-width: 560px)').matches, iw: innerWidth }; })()";
      // the page in front, as a phone's is: a background page runs no rendering step, so it hears no media change
      await ac.call("Page.bringToFront").catch(() => null);
      await ac.size(390, 844, true); await sleep(400);
      await ac.eval("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))");
      const ph = await ac.eval(fit);
      await ac.size(1440, 900, false); await sleep(400);
      await ac.eval("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))");
      const dk = await ac.eval(fit);
      check("the check desk on a phone with a bill open: every 'Bills to pay' row spans the whole table (the panel spans the " + ph.shown + " columns shown, no empty column)",
        ph.span === ph.shown && ph.shown === 3 && ph.rows.length >= 2 && ph.rows.every((x) => Math.abs(x - ph.table) <= 1) && ph.sw <= 391, JSON.stringify(ph));
      check("the check desk on a desk with a bill open: the panel spans the 4 columns, the rows the table",
        dk.span === 4 && dk.shown === 4 && dk.rows.every((x) => Math.abs(x - dk.table) <= 1), JSON.stringify(dk));
      if (SHOTS !== "none") {
        const at = "document.getElementById('ckPanel').scrollIntoView({ block: 'center' }); true";
        await ac.eval(at); await shoot(ac, "checkdesk_accountant", "desktop", false, false);
        await ac.size(390, 844, true); await sleep(300); await ac.eval(at); await shoot(ac, "checkdesk_accountant", "phone", true, false);
        await ac.size(1440, 900, false);
      }
      await ac.eval("document.getElementById('ckWrite').click(); true");
      await ac.until(modalOpen, 5000);
      await modalOk(ac);
      await ac.until("DCR2Demo.engine.rows.payments.some(p => p.bill_id === " + J.waiting + " && p.check_number === '5401')", 8000);
      const pay = await db(ac, "R.payments.find(p => p.bill_id === " + J.waiting + " && p.check_number === '5401')");
      check("accountant: the check is recorded - payee, memo, the method the approver allowed, the full amount",
        pay.payee === "Quarryman Concrete" && pay.memo === f.memo && pay.method === "check" && Number(pay.amount) === Number(f.amount) && pay.created_by === J.accountant, JSON.stringify(pay));
      await ac.until("!!document.querySelector('#secTell [data-load=\"" + pay.id + "\"]')", 8000);
      await ac.eval("document.querySelector('#secTell [data-load=\"" + pay.id + "\"]').click(); true");
      await ac.until("!!document.querySelector('#secTell [data-told=\"" + pay.id + "\"][data-how=\"phone\"]')", 6000);
      const tell = await ac.eval("document.getElementById('secTell').innerText");
      check("accountant: how to reach them (the bill's vendor in Contacts) and the message for THIS check", /The bill's vendor in Contacts/.test(tell) && /Check number: 5401/.test(tell) && /@example\.com/.test(tell), tell.slice(0, 400));
      if (SHOTS !== "none") {
        const at = "document.querySelector('#secTell [data-told=\"" + pay.id + "\"]').closest('.ck-tell').scrollIntoView({ block: 'center' }); true";
        await ac.eval(at); await shoot(ac, "tell_accountant", "desktop", false, false);
        await ac.size(390, 844, true); await sleep(300); await ac.eval(at); await shoot(ac, "tell_accountant", "phone", false, false);
        await ac.size(1440, 900, false);
      }
      await ac.eval("document.querySelector('#secTell [data-told=\"" + pay.id + "\"][data-how=\"phone\"]').click(); true");
      await ac.until("!!(DCR2Demo.engine.rows.payments.find(p => p.id === " + pay.id + ") || {}).pickup_told_at", 6000);
      const told = await db(ac, "R.payments.find(p => p.id === " + pay.id + ")");
      check("accountant: told by phone (payment_told: by the accountant, how phone)", told.pickup_told_how === "phone" && /Casey/.test(told.pickup_told_by), JSON.stringify(told));
      const del = await raw(ac, "c.from('payments').delete().eq('id', " + pay.id + ").select('id')");
      check("a payment once told cannot be deleted (M5b's guard)", !!del.error && del.error.code === "23514", JSON.stringify(del));
    }, ac);

    /* ── 3a. bank transfer and card (owner decision 2026-10-21) ───────────── */
    if (ap && ac) await attempt("bank transfer and card: the approver approves a bank transfer; the accountant pays it by wire and a card bill by card from their own list", async () => {
      const X = await db(ap, "(() => { const f = (id, p) => R.files.some((x) => x.id === id && x.project_id === p && !x.deleted_at); " +
        "const b = R.bills.find((b) => !b.approved_at && !b.void && !b.deleted_at && Number(b.amount) > 0 && f(b.document_file_id, b.project_id) && !R.payments.some((p) => p.bill_id === b.id)); " +
        "return b ? { id: b.id, amount: Number(b.amount) } : null; })()");
      check("set-up: a documented bill waiting for approval", !!X, JSON.stringify(X));
      await open(ap, "/bill.html?id=" + X.id, BILL + " && !!document.getElementById('blGo')");
      await ap.eval("document.getElementById('blGo').click(); true");
      await ap.until(modalOpen, 5000);
      const opts = await ap.eval("Array.from(document.querySelectorAll('.dcr-mo.open select option')).map(o => [o.value, o.textContent])");
      check("approver: the approve dialog offers check, cash, either, bank transfer (ACH or wire) and card - nothing pre-selected",
        JSON.stringify(opts.map((o) => o[0])) === JSON.stringify(["", "check", "cash", "both", "transfer", "card"]) && /bank transfer \(ACH or wire\)/.test(opts[4][1]) &&
        /By card/.test(opts[5][1]) && (await ap.eval("document.querySelector('.dcr-mo.open select').value")) === "", JSON.stringify(opts));
      await ap.eval("(() => { const s = document.querySelector('.dcr-mo.open select'); s.value = 'transfer'; s.dispatchEvent(new Event('change')); return true; })()");
      await shoot(ap, "approve_transfer_approver", "desktop", false, false);
      await modalOk(ap);
      await ap.until("DCR2Demo.engine.rows.bills.find(b => b.id === " + X.id + ").pay_method === 'transfer'", 6000);
      await ap.until("/by bank transfer \\(ACH or wire\\)/.test(document.getElementById('blDecision').innerText)", 6000);
      check("approver: approved to be paid by bank transfer - the bill page says so", true);
      await shoot(ap, "approved_transfer_approver", "desktop", false, false);
      // the accountant: the "Pay by bank transfer or card" list
      await open(ac, "/accounting.html", DESK + " && !!document.querySelector('#secSend [data-open=\"" + X.id + "\"]')");
      const list = await ac.eval("({ send: Array.from(document.querySelectorAll('#secSend [data-open]')).map(r => r.getAttribute('data-open')), " +
        "pay: Array.from(document.querySelectorAll('#secPay [data-open]')).map(r => r.getAttribute('data-open')), " +
        "chips: Array.from(document.querySelectorAll('#secSend .ck-method')).map(c => c.textContent), todo: Array.from(document.querySelectorAll('.ac-todo-list li')).map(li => li.innerText), " +
        "picture: (document.querySelector('.bk') || {}).innerText || '' })");
      check("accountant: the transfer and card bills on 'Pay by bank transfer or card' (never on the check desk), with their chips, to-do lines and picture chips",
        list.send.includes(String(X.id)) && list.send.length >= 4 && !list.send.some((id) => list.pay.includes(id)) && list.chips.includes("bank transfer") &&
        list.chips.includes("card") && list.todo.some((t) => /Send \d+ bank transfers? \(ACH or wire\)/.test(t)) && list.todo.some((t) => /Pay \d+ bills? by card/.test(t)) &&
        /TRANSFERS?|transfers?/.test(list.picture), JSON.stringify(list).slice(0, 600));
      await ac.eval("document.querySelector('#secSend [data-open=\"" + X.id + "\"]').click(); true");
      await ac.until("!!document.getElementById('ckWrite') && !!document.querySelector('#ckHow [data-how=\"wire\"]')", 8000);
      const f = await ac.eval("({ how: Array.from(document.querySelectorAll('#ckHow [data-how]')).map(b => b.getAttribute('data-how')), lab: document.getElementById('ckRefLab').textContent, sub: document.getElementById('ckRefSub').textContent, ph: document.getElementById('ckNumber').placeholder, disabled: document.getElementById('ckWrite').disabled, payee: document.querySelector('label[for=ckPayee]').textContent })");
      check("accountant: the panel asks ACH or wire, nothing chosen yet; 'Paid to', not 'Make it out to'; a confirmation number (optional) from the start, never 'Check number'",
        JSON.stringify(f.how) === '["ach","wire"]' && f.disabled && f.payee === "Paid to" && f.lab === "Confirmation number (optional)" &&
        /bank's confirmation/.test(f.sub) && !/2041/.test(f.ph), JSON.stringify(f));
      await ac.eval("document.querySelector('#ckHow [data-how=\"wire\"]').click(); true");
      const g = await ac.eval("({ lab: document.getElementById('ckRefLab').textContent, go: document.getElementById('ckWrite').textContent, disabled: document.getElementById('ckWrite').disabled })");
      check("accountant: by wire - a confirmation number (optional), no check number; 'Record the wire transfer'",
        /Confirmation number/.test(g.lab) && /wire transfer/.test(g.go) && !g.disabled, JSON.stringify(g));
      await ac.eval("document.getElementById('ckNumber').value = 'WIRE 7781'; true");
      await shoot(ac, "send_panel_accountant", "desktop", false, false);
      await ac.eval("document.getElementById('ckWrite').click(); true");
      await ac.until(modalOpen, 5000);
      const conf = await ac.eval("document.querySelector('.dcr-mo.open').innerText");
      await modalOk(ac);
      let pay = null;
      for (let i = 0; i < 40 && !pay; i++) { pay = await db(ac, "R.payments.find(p => p.bill_id === " + X.id + ")"); if (!pay) await sleep(200); }
      check("accountant: the wire is recorded - method wire, no check number, the confirmation kept, the full amount",
        !!pay && pay.method === "wire" && pay.check_number === null && pay.reference === "WIRE 7781" && Number(pay.amount) === X.amount && /a wire transfer of/.test(conf),
        JSON.stringify(pay) + " " + conf.slice(0, 160));
      await ac.until("!document.querySelector('#secSend [data-open=\"" + X.id + "\"]')", 8000);
      check("accountant: paid in full - off the list; nobody to tell about a wire", !(await ac.eval("!!document.querySelector('#secTell [data-load=\"" + pay.id + "\"]')")));
      // a card bill: nothing to choose
      const C = await db(ac, "(() => { const b = R.bills.find(b => b.pay_method === 'card' && b.approved_at && !R.payments.some(p => p.bill_id === b.id)); return b ? { id: b.id, amount: Number(b.approved_amount) } : null; })()");
      await ac.eval("document.querySelector('#secSend [data-open=\"" + C.id + "\"]').click(); true");
      await ac.until("!!document.getElementById('ckWrite') && !!document.getElementById('ckHowFixed')", 8000);
      check("accountant: a card bill - no choice to make, 'Record the card payment'",
        (await ac.eval("document.getElementById('ckHowFixed').value")) === "card" && /card payment/.test(await ac.eval("document.getElementById('ckWrite').textContent")));
      await ac.eval("document.getElementById('ckNumber').value = 'AUTH 448120'; document.getElementById('ckWrite').click(); true");
      await ac.until(modalOpen, 5000);
      await modalOk(ac);
      let cp = null;
      for (let i = 0; i < 40 && !cp; i++) { cp = await db(ac, "R.payments.find(p => p.bill_id === " + C.id + ")"); if (!cp) await sleep(200); }
      check("accountant: the card payment is recorded (method card, its authorisation as the reference, the full amount)",
        !!cp && cp.method === "card" && cp.reference === "AUTH 448120" && cp.check_number === null && Number(cp.amount) === C.amount, JSON.stringify(cp));
      // any other way is refused by the database (the demo's rules), in its words; nobody is told about a transfer
      const N = await db(ac, "(() => { const b = R.bills.find(b => b.pay_method === 'transfer' && b.approved_at && !R.payments.some(p => p.bill_id === b.id)); return b ? { id: b.id, projectId: b.project_id } : null; })()");
      const r1 = await repo(ac, "R.recordPayment({ id: " + N.id + ", projectId: " + N.projectId + " }, { amount: 1, method: 'card', checkNumber: '' })");
      const r2 = await repo(ac, "R.recordPayment({ id: " + N.id + ", projectId: " + N.projectId + " }, { amount: 1, method: 'check', checkNumber: '1' })");
      check("a card on a bank-transfer bill, or a check, is refused (23514) in the database's words",
        !r1.ok && r1.code === "23514" && /approved to be paid by bank transfer \(ACH or wire\)/.test(r1.message) && !r2.ok && /approved for bank transfer payment/.test(r2.message),
        JSON.stringify([r1, r2]));
      const r3 = await repo(ac, "R.markTold({ paymentId: " + pay.id + ", version: " + pay.version + " }, 'phone')");
      check("payment_told refuses a wire (only a check or cash is picked up)", !r3.ok && r3.code === "22023", JSON.stringify(r3));
    }, ac);

    /* ── 3b. the spend glance and the ledger behind its link: one figure (review fix) ── */
    if (ac) await attempt("accountant: the Books' 30-day line and the ledger it links to agree", async () => {
      await open(ac, "/accounting.html", DESK + " && !!document.querySelector('.ac-glance')");
      const g = await ac.eval("document.querySelector('.ac-glance').innerText");
      await open(ac, "/ledger.html", "!!document.getElementById('lgScope') && /record/.test(document.getElementById('lgScope').innerText)");
      const l = await ac.eval("document.getElementById('lgScope').innerText");
      const pick = (t) => { const m = /(\d+) records? · \$([\d,.]+) cost/.exec(t); return m ? m[1] + "|" + m[2] : ""; };
      const rec = await ac.eval("(() => { const t = document.getElementById('lgTotals').innerText; const m = /(\\d+) without a receipt/.exec(t); return m ? Number(m[1]) : 0; })()");
      const gNo = (/(\d+) with no receipt/.exec(g) || [0, 0])[1];
      check("the Books' 'Last 30 days' line says the ledger's own records, cost and receipts (" + pick(g) + ")",
        !!pick(g) && pick(g) === pick(l) && Number(gNo) === rec, JSON.stringify({ glance: g, ledger: l.split("\n")[0], noReceipt: [gNo, rec] }));
    }, ac);

    /* ── 4. QuickBooks: the CSV, Mark entered with refused[], Undo, invoices ── */
    if (ac && ad) await attempt("accountant: the CSV and Mark entered (acceptance check 3)", async () => {
      await open(ac, "/accounting.html", DESK + " && document.querySelectorAll('#secQbo [data-pick]').length > 0");
      await ac.eval("window.__csv = []; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__csv.push(b); return o(b); }; true");
      await ac.eval("document.getElementById('acCsv').click(); true");
      await ac.until("window.__csv.length > 0", 5000);
      const csv = await ac.eval("window.__csv[0].arrayBuffer().then(b => Array.from(new Uint8Array(b)).slice(0, 3).join(',') + '|' + new TextDecoder().decode(b))");
      const [bom, text] = [csv.split("|")[0], csv.slice(csv.indexOf("|") + 1)];
      const lines = text.replace(/^﻿/, "").split("\r\n");
      check("the bills CSV: a BOM, CRLF, every cell quoted, the Portal Bill ID column",
        bom === "239,187,191" && lines.length >= 3 && lines[lines.length - 1] === "" && /^"Vendor","Bill No","Bill Date","Due Date","Amount","Category","Customer\/Project","Memo","Approved By","Approved On","Pay Method","Portal Bill ID"$/.test(lines[0]) &&
        lines.slice(1, -1).every((l) => /^"([^"]|"")*"(,"([^"]|"")*")*$/.test(l)), lines.slice(0, 3).join(" / "));
      check("the bills CSV: a memo beginning with '-' is made text (the formula guard)", text.includes("\"'-10% retainage held until the final walk\""), text.slice(0, 600));
      // pick every ready bill, then the admin withdraws one approval meanwhile
      await ac.eval("document.getElementById('acAll').click(); true");
      const picked = await ac.eval("Array.from(document.querySelectorAll('#secQbo [data-pick]:checked')).map(c => Number(c.getAttribute('data-pick')))");
      const victim = await db(ac, "(() => { const ids = " + JSON.stringify(picked) + "; const b = R.bills.find(b => ids.includes(b.id) && !R.payments.some(p => p.bill_id === b.id)); return b ? { id: b.id, version: b.version } : null; })()");
      const un = await ad.eval("DCR2Demo.engine.rpc({ uid: DCR2Demo.people.find(p => p.key === 'admin').id }, 'unapprove_bill', { id: " + victim.id + ", version: " + victim.version + " }) && true");
      await ac.until("!DCR2Demo.engine.rows.bills.find(b => b.id === " + victim.id + ").approved_at", 6000);
      await ac.eval("document.getElementById('acRef').value = 'QB batch 17'; true");
      await ac.eval("document.getElementById('acMark').click(); true");
      await ac.until(modalOpen, 5000);
      await modalOk(ac);
      await ac.until("!!document.querySelector('#secQbo .ac-refused')", 8000);
      const box = await ac.eval("document.querySelector('#secQbo .ac-refused').innerText");
      const marked = await db(ac, "R.bills.filter(b => " + JSON.stringify(picked) + ".includes(b.id) && b.qbo_entered_at).map(b => ({ id: b.id, by: b.qbo_entered_by, ref: b.qbo_ref }))");
      check("Mark entered: the un-approved bill is refused - and said so in full (refused[]) - the others are marked by the accountant with the ref",
        un && /1 not/.test(box) && /Waiting for a manager or admin to approve it/.test(box) && marked.length === picked.length - 1 &&
        marked.every((m) => m.by === J.accountant && m.ref === "QB batch 17") && !marked.some((m) => m.id === victim.id), box + " " + JSON.stringify(marked));
      if (SHOTS !== "none") {
        await ac.eval("(document.querySelector('.dcr-mo.open #dcrMoYes') || { click() {} }).click(); document.getElementById('secQbo').scrollIntoView(); true");
        await shoot(ac, "refused_mark_accountant", "desktop", false, false);
      }
      await ac.eval("(document.querySelector('.dcr-mo.open #dcrMoYes') || { click() {} }).click(); true");
      // Undo one
      const undoId = marked[0].id;
      await ac.until("!!document.querySelector('#secEntered [data-undo=\"" + undoId + "\"]')", 6000);
      await ac.eval("document.querySelector('#secEntered [data-undo=\"" + undoId + "\"]').click(); true");
      await ac.until(modalOpen, 5000);
      await modalOk(ac);
      await ac.until("!DCR2Demo.engine.rows.bills.find(b => b.id === " + undoId + ").qbo_entered_at", 6000);
      await ac.until("!!document.querySelector('#secQbo [data-pick=\"" + undoId + "\"]')", 6000);
      check("Undo puts the bill back on the ready list", true);
      // the invoices' own marker
      await ac.eval("document.getElementById('acAllInv').click(); true");
      const invs = await ac.eval("Array.from(document.querySelectorAll('#secAr [data-pickinv]:checked')).map(c => Number(c.getAttribute('data-pickinv')))");
      await ac.eval("document.getElementById('acMarkInv').click(); true");
      await ac.until(modalOpen, 5000);
      await modalOk(ac);
      await ac.until("DCR2Demo.engine.rows.invoices.filter(i => " + JSON.stringify(invs) + ".includes(i.id) && i.qbo_entered_at).length === " + invs.length, 8000);
      await ac.until("document.querySelectorAll('#secAr [data-pickinv]').length === 0", 6000);
      check("the invoices are marked entered with their own marker (" + invs.length + ")", invs.length > 0);
      if (SHOTS !== "none") await four(ac, "desk_after_accountant", true);
    }, ac);

    /* ── 5. acceptance check 5: no amount in an activity row or an outbox body ── */
    if (a) await attempt("no amount in any activity row or outbox body written during the walk", async () => {
      const rows = await db(a, "R.activity.filter(x => x.id > " + J.maxAct + ").map(x => x.text).concat(R.notifications_outbox.slice(" + J.outbox + ").map(o => (o.subject || '') + ' ' + (o.body || '')))");
      const bad = rows.filter((t) => AMOUNT.test(t) || /\b\d{1,3}(,\d{3})*\.\d{2}\b/.test(t));
      check("acceptance check 5: no activity row and no outbox body carries an amount (" + rows.length + " written)", bad.length === 0, bad.slice(0, 5).join(" | "));
    }, a);

    /* ── 6. no security-policy violation, no console error ─────────────── */
    for (const p of pages) {
      const bad = p.log.filter((x) => /CSP-VIOLATION|Content Security Policy/i.test(x.text) || x.level === "exception" ||
        (x.level === "error" && !/favicon\.ico|net::ERR_ABORTED|ERR_INTERNET_DISCONNECTED|Failed to fetch|demo: offline|mailto:|status of 4\d\d/.test(x.text + " " + (x.url || ""))));
      check(p.name + ": no CSP violation, no console error", !bad.length, bad.slice(0, 5).map((x) => x.level + " " + x.text.slice(0, 200) + " @ " + x.url).join(" | "));
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
