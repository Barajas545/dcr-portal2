#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the P5b ledger in the DEMO (development only).

     node tools/e2e-p5b-ledger.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with M5b's ledger rules —
   tools/fake/p5b-ledger.js over p5a-pm.js's money tables; nothing goes to Supabase) and drives a local Chrome or Edge
   headless through Expenses & receipts (ledger.html), the project's Expenses and Payments tabs and the printed expense
   report (report-expenses.html):

   - who: the accountant and the admin (financials) read the ledger and may tag, reconcile and confirm; a manager
     without financials, a lead, field and view-only are told the ledger needs the financials switch, are sent no
     cost row, never see the project's money tabs (a ?tab=expenses link opens the Overview) and get no amount in the
     page's HTML; the demo approver (a manager with approve and financials) reads and tags;
   - the arithmetic: Cost = materials + subcontractors + labour; equipment and other listed apart; billed-out shown
     greyed, never added; every row not on screen counted (outside the period, no amount); a search by amount;
   - the accountant tags "Paid with" on one row and on two at once (bulk), reconciles a row, confirms an inferred
     employee (stored as confirmed) — each stamped in the database, none writing an activity line;
   - receipts: a row with two files, the viewer (an image shown, a PDF opened in its own tab);
   - the CSV, as downloaded: a BOM, CRLF, the formula guard on a description typed with "=", numbers as numbers;
   - the project's Expenses tab: filtered by period and words, Print hands the same view to report-expenses.html
     (the same total to the cent, "Filtered:" said), the CSV of the rows on screen; the Payments tab: bills with their
     states and payments (payee, memo, told), the invoices; the approver sees "Review…";
   - phone (390 px: no page scrolls sideways) and desktop, light and dark;
   - no Content-Security-Policy violation and no console error on any page.
   Screenshots (--shots all): ledger_<what>_<role>_<light|dark>_<desktop|phone>.png into --out.
   Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p5b-ledger")));
const SHOTS = arg("--shots", "all");
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
  async function open(p, path, marker, ms, noBar) {
    await p.goto(base + path, 150);
    const here = "(location.pathname).indexOf(" + JSON.stringify(path.split("?")[0].split("#")[0]) + ") === 0";
    await p.until(here + (noBar ? "" : " && " + TOPBAR) + (marker ? " && (" + marker + ")" : ""), ms || 15000);
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
  const text = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); return n ? n.innerText : ''; })()");
  const html = (p) => p.eval("document.documentElement.outerHTML");
  const setVal = (p, id, value, ev) => p.eval("(() => { const i = document.getElementById(" + JSON.stringify(id) + "); i.focus(); i.value = " + JSON.stringify(value) +
    "; i.dispatchEvent(new Event(" + JSON.stringify(ev || "input") + ", { bubbles: true })); return true; })()");
  const LEDGER = "!!document.querySelector('#lgBody table.lg-t2') && document.querySelectorAll('#lgTotals .lg-t').length >= 9";
  // the CSV as downloaded: the Blob a page hands to URL.createObjectURL, and the file name it gives the link
  const CATCH = "window.__blobs = []; window.__names = []; (() => { const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__blobs.push(b); return o(b); };" +
    " const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__names.push(this.download); return; } return c.call(this); }; })(); true";
  const csvBytes = (p) => p.eval("window.__blobs.slice(-1)[0].arrayBuffer().then(b => Array.from(new Uint8Array(b)))");
  const decode = (bytes) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(bytes));

  async function shoot(p, name, device, dark, full) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1440;
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    await sleep(350);
    const h = full === false ? (device === "phone" ? 844 : 900) : await p.eval("Math.max(" + (device === "phone" ? 844 : 900) + ", Math.min(4200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(450);
    const file = "ledger_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: device === "phone" ? 844 : 900, deviceScaleFactor: 1, mobile: device === "phone" });
    await p.dark(false);
  }
  async function bothThemes(p, name, device, full) { await shoot(p, name, device, false, full); await shoot(p, name, device, true, full); }

  try {
    /* ── 0. a clean demo database ──────────────────────────────────────── */
    const setup = await newPage(cdp, "setup", OUT); pages.push(setup);
    await setup.size(1440, 900, false);
    await setup.goto(base + "/manifest.json", 50);
    await setup.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");
    await signIn(setup, "admin", "dashboard.html");
    const J = await db(setup, `(() => {
      const sb = R.projects.find((p) => p.number === "A267");
      const of = (d) => R.costs.find((c) => c.description === d) || {};
      return { sb: sb.id, sbNumber: sb.number, costs: R.costs.length, sbCosts: R.costs.filter((c) => c.project_id === sb.id).length,
        two: of("Simpson hangers, nails and straps").id, alex: of("Alex - pick up hangers and nails at the yard").id,
        formula: of("=2x6 studs, 40 more for the north wall").id, pump: of("Concrete pump operator, half day").id,
        receipts: R.files.filter((f) => f.cost_id).length, approver: !!R.profiles.find((p) => p.email === "approver@demo.test") };
    })()`);
    check("demo: costs on the sandbox and five other made-up jobs, receipts linked by cost_id (tools/fake/p5b-ledger.js)",
      J.costs >= 20 && J.sbCosts >= 10 && J.two && J.alex && J.formula && J.receipts >= 7, JSON.stringify(J));
    await setup.call("Page.navigate", { url: "about:blank" }).catch(() => null);

    /* ── 1. who may open the ledger ───────────────────────────────────── */
    const ROLES = ["manager", "lead", "field", "viewer"].concat(J.approver ? ["approver"] : []);
    for (const role of ROLES) {
      const p = await newPage(cdp, role, OUT); pages.push(p);
      await p.size(1440, 900, false);
      await attempt(role + ": the ledger and the project's money tabs", async () => {
        await signIn(p, role, "dashboard.html");
        const fin = role === "approver";
        if (!fin) {
          await open(p, "/ledger.html", "!document.getElementById('lgDenied').hidden");
          const h = await html(p);
          check(role + ": the ledger says it needs the financials switch, asks for nothing, shows no amount",
            /financials switch/.test(await text(p, "#lgDenied")) && (await p.eval("document.getElementById('lgMain').hidden")) && !AMOUNT.test(h),
            (h.match(/.{40}\$\s?\d.{20}/) || [""])[0]);
          if (role === "manager") await shoot(p, "denied_manager", "desktop", false, false);
          await open(p, "/project.html?id=" + J.sb + "&tab=expenses", "!!document.querySelector('.pj-tab.active')");
          const tabs = await p.eval("({ shown: Array.from(document.querySelectorAll('.pj-tab')).filter(t => !t.hidden).map(t => t.dataset.tab), active: document.querySelector('.pj-tab.active').dataset.tab })");
          check(role + ": the project page shows no Expenses or Payments tab; ?tab=expenses opens the Overview",
            !tabs.shown.includes("expenses") && !tabs.shown.includes("payments") && tabs.active === "overview", JSON.stringify(tabs));
          await open(p, "/report-expenses.html?id=" + J.sb, "/financials switch/.test(document.getElementById('rpSheet').innerText)", 15000, true);
          check(role + ": the printed expense report says it needs the financials switch, no amount", !AMOUNT.test(await html(p)));
        } else {
          await open(p, "/ledger.html", LEDGER);
          check("approver (a manager with approve and financials): the ledger, with 'Paid with' to set",
            (await p.eval("document.querySelectorAll('select[data-card]').length")) > 0);
          await open(p, "/project.html?id=" + J.sb + "&tab=payments", "!!document.querySelector('#pane-payments table.pjm-tbl')");
          check("approver: the Payments tab offers 'Review…' on a bill waiting for approval", /Review…/.test(await text(p, "#pane-payments")));
          await shoot(p, "payments_approver", "desktop", false);
        }
      }, p);
    }

    /* ── 2. the accountant at the ledger ──────────────────────────────── */
    const acc = await newPage(cdp, "accountant", OUT); pages.push(acc);
    await acc.size(1440, 900, false);
    await attempt("accountant: the ledger", async () => {
      await signIn(acc, "accountant", "dashboard.html");
      await open(acc, "/ledger.html", LEDGER);
      const tiles = await acc.eval("Object.fromEntries(Array.from(document.querySelectorAll('#lgTotals .lg-t')).map(t => [t.querySelector('.k').textContent, { v: t.querySelector('.v').textContent, muted: t.classList.contains('muted') }]))");
      const n = (s) => Number(String(s).replace(/[$,]/g, ""));
      const cost = n(tiles["Cost this period"].v), parts = n(tiles.Materials.v) + n(tiles.Labour.v) + n(tiles.Subcontractors.v);
      check("accountant: Cost = materials + labour + subcontractors; equipment & other and billed out greyed apart",
        Math.abs(cost - parts) < 0.005 && tiles["Equipment & other"].muted && tiles["Billed out"].muted && n(tiles["Billed out"].v) > 0, JSON.stringify(tiles));
      const scope = await text(acc, "#lgScope");
      check("accountant: what is not on screen is counted (outside the period, no amount)", /Not shown: \d+ outside this period, 1 with no amount recorded/.test(scope), scope);
      const chips = await acc.eval("Array.from(document.querySelectorAll('[data-period]')).map(b => b.dataset.period + ':' + b.querySelector('.n').textContent)");
      check("accountant: every period chip carries its count", chips.length === 5 && chips.every((c) => /:\d+$/.test(c)), chips.join(" "));
      const rows30 = await acc.eval("document.querySelectorAll('#lgBody tbody tr').length");
      check("accountant: the 30-day table lists the chip's count", String(rows30) === chips[0].split(":")[1], rows30 + " vs " + chips[0]);
      await bothThemes(acc, "main_accountant", "desktop");
      // search by an amount typed off a statement
      await setVal(acc, "lgQ", "$311.60");
      await acc.until("document.querySelectorAll('#lgBody tbody tr').length === 1", 5000);
      check("accountant: a search by amount finds the row", /studs/.test(await text(acc, "#lgBody")));
      await setVal(acc, "lgQ", "");
      await acc.until("document.querySelectorAll('#lgBody tbody tr').length === " + rows30, 5000);
      // group by card: "Not tagged yet" on top
      await setVal(acc, "lgGroup", "card", "change");
      await acc.until("!!document.querySelector('tr.lg-grp')", 5000);
      check("accountant: grouped by card, 'Not tagged yet' on top", /^Not tagged yet/.test(await text(acc, "tr.lg-grp")));
      await shoot(acc, "by_card_accountant", "desktop", false);
      await setVal(acc, "lgGroup", "employee", "change");
      await acc.until("/inferred/i.test(document.getElementById('lgBody').innerText)", 5000);
      await shoot(acc, "by_employee_accountant", "desktop", false);
      await setVal(acc, "lgGroup", "none", "change");
      await acc.until("!document.querySelector('tr.lg-grp')", 5000);

      // writes: one row's "Paid with", then two at once; reconcile; confirm the inferred employee
      const act0 = await db(acc, "R.activity.length");
      await acc.eval("(() => { const s = document.querySelector('select[data-card=\"" + J.two + "\"]'); s.value = 'card-amex'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
      await acc.until("(DCR2Demo.engine.rows.costs.find(c => c.id === " + J.two + ") || {}).card === 'card-amex'", 6000);
      const tagged = await db(acc, "R.costs.find(c => c.id === " + J.two + ")");
      const me = await acc.eval("DCR2Demo.people.find(p => p.key === 'accountant').id");
      check("accountant: 'Paid with' on one row - stored with who and when", tagged.card_by === me && !!tagged.card_at, JSON.stringify(tagged));
      // the table is read again after a write: wait for it to show the stored card
      await acc.until("(document.querySelector('select[data-card=\"" + J.two + "\"]') || {}).value === 'card-amex' && !document.querySelector('select[data-card=\"" + J.two + "\"]').classList.contains('untagged')", 6000);
      const pickIds = await acc.eval("Array.from(document.querySelectorAll('select.lg-card.untagged')).map(s => Number(s.dataset.card)).filter(id => id !== " + J.two + ").slice(0, 2)");
      for (const id of pickIds) await acc.eval("(() => { const c = document.querySelector('[data-pick=\"" + id + "\"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
      await acc.until("!document.getElementById('lgBulk').hidden", 4000);
      await shoot(acc, "bulk_accountant", "desktop", false, false);
      await setVal(acc, "lgBulkCard", "card-visa", "change");
      await acc.eval("document.getElementById('lgBulkApply').click(); true");
      await acc.until("[" + pickIds.join(",") + "].every(id => (DCR2Demo.engine.rows.costs.find(c => c.id === id) || {}).card === 'card-visa')", 6000);
      await acc.until("document.getElementById('lgBulk').hidden && [" + pickIds.join(",") + "].every(id => (document.querySelector('select[data-card=\"' + id + '\"]') || {}).value === 'card-visa')", 6000);
      check("accountant: two rows tagged at once (bulk), the selection cleared", pickIds.length === 2, pickIds.join(","));
      await acc.eval("(() => { const c = document.querySelector('[data-rec=\"" + J.two + "\"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
      await acc.until("!!(DCR2Demo.engine.rows.costs.find(c => c.id === " + J.two + ") || {}).reconciled_at", 6000);
      check("accountant: a row reconciled (by, at)", (await db(acc, "R.costs.find(c => c.id === " + J.two + ").reconciled_by")) === me);
      await acc.until("!!document.querySelector('[data-confirm=\"" + J.alex + "\"]')", 5000);
      await acc.eval("document.querySelector('[data-confirm=\"" + J.alex + "\"]').click(); true");
      await acc.until("!!document.querySelector('.dcr-mo.open') && !!document.getElementById('dcrMoF0')", 5000);
      const pre = await acc.eval("document.getElementById('dcrMoF0').selectedOptions[0].textContent");
      await shoot(acc, "confirm_accountant", "desktop", false, false);
      await acc.eval("document.getElementById('dcrMoYes').click(); true");
      await acc.until("(DCR2Demo.engine.rows.costs.find(c => c.id === " + J.alex + ") || {}).employee_source === 'confirmed'", 6000);
      await acc.until("/confirmed/i.test(((document.querySelector('[data-rec=\"" + J.alex + "\"]') || {}).closest || (() => null)).call(document.querySelector('[data-rec=\"" + J.alex + "\"]'), 'tr').innerText)", 6000);
      check("accountant: the inferred employee (offered first) is recorded as confirmed", pre === "Alex Juniper" &&
        (await db(acc, "R.employees.find(e => e.id === R.costs.find(c => c.id === " + J.alex + ").employee_id).full_name")) === "Alex Juniper", pre);
      const acts = await db(acc, "R.activity.slice(" + act0 + ").map(a => a.text)");
      check("accountant: tagging, reconciling and confirming wrote no activity line (no amount in the log)", acts.length === 0, JSON.stringify(acts));
      // the rows the system writes (status, system); a note is what a person typed (principle 8: masked on screen, Q28)
      const allActs = await db(acc, "R.activity.filter(a => a.kind !== 'note' && /\\$\\s?\\d/.test(a.text || '')).map(a => a.kind + ' ' + a.text)");
      check("no amount in any activity row the system wrote in the demo database (P5 check 5)", allActs.length === 0, JSON.stringify(allActs.slice(0, 3)));

      // receipts: the viewer (an image), a row with two files, a PDF in its own tab
      await acc.until("!!document.querySelector('[data-row=\"" + J.two + "\"]')", 5000);
      await acc.eval("document.querySelector('[data-row=\"" + J.two + "\"]').click(); true");
      await acc.until("!document.getElementById('lgView').hidden", 5000);
      check("accountant: a row with two receipts - the viewer says 1 of 2", /1 of 2/.test(await text(acc, "#lgViewN")));
      await acc.eval("document.getElementById('lgViewNext').click(); true");
      await acc.until("!!document.querySelector('#lgViewBody img') && document.querySelector('#lgViewBody img').complete", 6000);
      check("accountant: the receipt photo shows in the viewer (a signed URL)", /2 of 2/.test(await text(acc, "#lgViewN")));
      await bothThemes(acc, "viewer_accountant", "desktop", false);
      await acc.eval("document.getElementById('lgViewPrev').click(); true");
      await acc.until("/opens in its own tab/.test(document.getElementById('lgViewBody').innerText)", 5000);
      check("accountant: a PDF receipt is opened in its own tab (no page frames another site)", true);
      await acc.eval("document.getElementById('lgViewClose').click(); true");
      // the hover peek of a photo receipt
      await acc.eval("(() => { const a = document.querySelector('[data-row=\"" + J.two + "\"]'); a.dispatchEvent(new MouseEvent('mouseenter')); return true; })()");
      await acc.until("!document.getElementById('lgPeek').hidden", 4000);
      await acc.eval("document.querySelector('[data-row=\"" + J.two + "\"]').dispatchEvent(new MouseEvent('mouseleave')); true");

      // the CSV as downloaded
      await acc.eval(CATCH);
      await acc.eval("document.getElementById('lgCsv').click(); true");
      await acc.until("window.__blobs.length === 1", 4000);
      const bytes = await csvBytes(acc);
      const csv = decode(bytes);
      const lines = csv.slice(1).split("\r\n");
      check("accountant: the CSV - a BOM, CRLF, one line per row on screen", bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf &&
        lines.length === rows30 + 2 && lines[lines.length - 1] === "" && !/[^\r]\n/.test(csv), bytes.slice(0, 3) + " / " + lines.length + " / " + rows30);
      check("accountant: the CSV guards a description typed with '=' and keeps amounts as numbers",
        /,"'=2x6 studs, 40 more for the north wall",/.test(csv) && /,-64\.25,/.test(csv) && /"inferred"|"confirmed"/.test(csv), lines.slice(1, 4).join(" | "));
      check("accountant: the CSV file name", /^dcr-expenses-\d{4}-\d{2}-\d{2}\.csv$/.test(await acc.eval("window.__names[0]")));

      // a phone: the page never scrolls sideways (the table scrolls in its box)
      await acc.size(390, 844, true);
      await open(acc, "/ledger.html", LEDGER);
      const sw = await acc.eval("({ page: document.documentElement.scrollWidth, win: innerWidth, box: document.querySelector('.lg-wrap').scrollWidth > document.querySelector('.lg-wrap').clientWidth })");
      check("accountant: phone - the ledger page does not scroll sideways; the table scrolls in its own box", sw.page <= sw.win + 1 && sw.box, JSON.stringify(sw));
      await bothThemes(acc, "main_accountant", "phone", false);
      await acc.size(1440, 900, false);
    }, acc);

    /* ── 3. the project's Expenses and Payments tabs, and the printed report ── */
    await attempt("accountant: the project's Expenses tab, Print and CSV", async () => {
      await open(acc, "/project.html?id=" + J.sb + "&tab=expenses", "!!document.querySelector('#pane-expenses table.pjm-tbl')");
      const tabs = await acc.eval("Array.from(document.querySelectorAll('.pj-tab')).filter(t => !t.hidden).map(t => t.dataset.tab)");
      check("accountant: the project page shows Expenses and Payments", tabs.includes("expenses") && tabs.includes("payments"), tabs.join(","));
      const sum = await acc.eval("Object.fromEntries(Array.from(document.querySelectorAll('#pane-expenses .pjm-sum > div')).map(d => [d.querySelector('span').textContent, d.querySelector('b').textContent]))");
      const grand = await acc.eval("(() => { const r = document.querySelector('#pane-expenses tr.grand'); return r ? Array.from(r.cells).map(c => c.textContent) : []; })()");
      check("accountant: the tab's grand total is the cost to date; equipment and other apart", grand[0] === "GRAND TOTAL" && grand[5] === sum["Cost to date"] &&
        grand[4] === sum["Equipment & other"].replace(/listed.*$/, ""), JSON.stringify({ sum, grand }));
      await bothThemes(acc, "project_expenses_accountant", "desktop");
      // filter: this month and a word; Print hands the same view to the report
      await setVal(acc, "exRange", "last30", "change");
      await acc.until("/FILTERED TOTAL/.test(document.querySelector('#pane-expenses tr.grand').textContent)", 5000);
      await setVal(acc, "exSearch", "lumber");
      await acc.until("new URL(location.href).searchParams.get('q') === 'lumber' && document.querySelectorAll('#pane-expenses tbody tr').length > 2", 5000);
      const tabTotal = await acc.eval("Array.from(document.querySelector('#pane-expenses tr.grand').cells).map(c => c.textContent)");
      const href = await acc.eval("document.getElementById('exPrint').getAttribute('href')");
      check("accountant: Print carries the filter and the resolved window", /range=last30/.test(href) && /q=lumber/.test(href) && /pa=\d{4}-\d{2}-\d{2}/.test(href), href);
      await acc.eval(CATCH);
      await acc.eval("document.getElementById('exCsv').click(); true");
      await acc.until("window.__blobs.length === 1", 4000);
      const tabCsv = decode(await csvBytes(acc));
      const shown = await acc.eval("document.querySelectorAll('#pane-expenses tbody tr:not(.grp):not(.sub):not(.grand)').length");
      check("accountant: the tab's CSV holds exactly the rows on screen", tabCsv.slice(1).split("\r\n").length === shown + 2, shown);
      await open(acc, "/" + href, "!!document.querySelector('#rpSheet table.ex')", 15000, true);
      const rep = await acc.eval("Array.from(document.querySelector('#rpSheet tr.grand').cells).map(c => c.textContent)");
      check("accountant: the printed report's FILTERED TOTAL matches the tab to the cent, and says what it covers",
        JSON.stringify(rep) === JSON.stringify(tabTotal.slice(0, 6)) && /Filtered:.*Last 30 days.*Search: "lumber"/.test(await text(acc, ".filt")), JSON.stringify({ rep, tabTotal }));
      await shoot(acc, "report_accountant", "desktop", false);
      await acc.size(390, 844, true);
      await open(acc, "/" + href, "!!document.querySelector('#rpSheet table.ex')", 15000, true);
      const fit = await acc.eval("({ page: document.documentElement.scrollWidth, win: innerWidth })");
      check("accountant: report on a phone - the page does not scroll sideways (the table scrolls in its sheet)", fit.page <= fit.win + 1, JSON.stringify(fit));
      await shoot(acc, "report_accountant", "phone", false);
      await open(acc, "/project.html?id=" + J.sb + "&tab=expenses", "!!document.querySelector('#pane-expenses table.pjm-tbl')");
      const psw = await acc.eval("document.documentElement.scrollWidth");
      check("accountant: phone - the Expenses tab does not scroll sideways", psw <= 391, psw);
      await shoot(acc, "project_expenses_accountant", "phone", false, false);
      await acc.size(1440, 900, false);
      // the back link of the report keeps the filter
      await open(acc, "/project.html?id=" + J.sb + "&tab=payments", "!!document.querySelector('#pane-payments table.pjm-tbl')");
      const pay = await text(acc, "#pane-payments");
      check("accountant: the Payments tab - bills with their states, the payments (payee, memo, told), the client's invoices",
        /Money out/i.test(pay) && /Waiting approval|Needs document/i.test(pay) && /\bPaid\b/.test(pay) && /Told it is ready/.test(pay) && /memo “Floor package”/.test(pay) &&
        /Money in/i.test(pay) && /Outstanding/i.test(pay) && !/Review…/.test(pay), pay.slice(0, 600));
      await bothThemes(acc, "project_payments_accountant", "desktop");
      await acc.size(390, 844, true);
      await open(acc, "/project.html?id=" + J.sb + "&tab=payments", "!!document.querySelector('#pane-payments table.pjm-tbl')");
      check("accountant: phone - the Payments tab does not scroll sideways", (await acc.eval("document.documentElement.scrollWidth")) <= 391);
      await shoot(acc, "project_payments_accountant", "phone", false, false);
      await acc.size(1440, 900, false);
    }, acc);

    /* ── 4. the admin ─────────────────────────────────────────────────── */
    const ad = await newPage(cdp, "admin", OUT); pages.push(ad);
    await ad.size(1440, 900, false);
    await attempt("admin: the ledger, all records, by project", async () => {
      await signIn(ad, "admin", "dashboard.html");
      await open(ad, "/ledger.html?period=all&group=project", LEDGER + " && !!document.querySelector('tr.lg-grp')");
      const groups = await ad.eval("document.querySelectorAll('tr.lg-grp').length");
      check("admin: all records grouped by project (six made-up jobs)", groups >= 6, groups);
      const t = await ad.eval("document.querySelector('[data-period=all]').getAttribute('aria-pressed')");
      check("admin: the period from the address (?period=all)", t === "true");
      await bothThemes(ad, "by_project_admin", "desktop");
    }, ad);

    /* ── 5. no security-policy violation, no console error ─────────────── */
    for (const p of pages) {
      const bad = p.log.filter((x) => /CSP-VIOLATION|Content Security Policy/i.test(x.text) || x.level === "exception" ||
        (x.level === "error" && !/favicon\.ico|net::ERR_ABORTED|ERR_INTERNET_DISCONNECTED|Failed to fetch|demo: offline/.test(x.text + " " + (x.url || ""))));
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
