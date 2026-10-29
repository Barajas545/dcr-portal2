#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the Books program's money files, release A (P1), in the DEMO (development only).

     node tools/e2e-p8-files.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with the money files' rules -
   tools/fake/p8-files.js over p5b-books.js: payment_id, no version for a money file but "name (2)", the safe shape,
   money editors remove, the bill's guarded document; nothing goes to Supabase) and drives a local Chrome or Edge
   headless as the demo accountant:

   - the bill page of a blocked bill (no document): a picture PASTED (a synthetic ClipboardEvent with a DataTransfer)
     becomes its document through the upload queue, and the bill moves from blocked to waiting; a PDF DROPPED (a
     synthetic DragEvent) is an extra; "Make this the bill's document" only re-points (the old one stays an extra); a
     wrong paste is removed (a soft delete); the document is never removable;
   - a bill entered in QuickBooks: Replace is refused BEFORE any byte moves (nothing queued); an approved bill: Replace
     asks first ("withdraws the approval"), then the new document is in, the approval gone, the old one removed;
   - a payment's file on a part-paid bill (kind payment: the payment's bill and the payment), labelled on the page;
   - the expense dialog with 3 receipts at once (picked, pasted on the dialog, dropped), each its own row with a distinct
     name; the ledger: a PDF dropped on a row and a screenshot pasted on a selected row attach to that cost;
   - phone (390 px: no page scrolls sideways) and desktop, light and dark; no Content-Security-Policy violation and no
     console error on any page.
   Screenshots (--shots all): files8_<what>_<light|dark>_<desktop|phone>.png into --out (default: the system temp
   folder). Made-up data only. Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p8-files")));
const SHOTS = arg("--shots", "all");

/* the page's own helpers: made-up files, a synthetic paste, drop and pick */
const HELPERS = `(() => {
  window.__png = async (label, w, h) => {
    const c = document.createElement("canvas"); c.width = w || 480; c.height = h || 320;
    const g = c.getContext("2d"); g.fillStyle = "#e8eef5"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#1b2733"; g.font = "28px sans-serif"; g.fillText(label || "made-up receipt", 24, c.height / 2);
    const b = await new Promise((r) => c.toBlob(r, "image/png"));
    return new File([b], "image.png", { type: "image/png", lastModified: Date.now() + Math.random() });
  };
  window.__pdf = (name) => new File(["%PDF-1.4\\n%made-up\\n1 0 obj<<>>endobj\\ntrailer<<>>\\n%%EOF\\n" + name], name, { type: "application/pdf", lastModified: Date.now() });
  const dt = (files) => { const d = new DataTransfer(); files.forEach((f) => d.items.add(f)); return d; };
  window.__paste = (target, files) => {
    const t = typeof target === "string" ? document.querySelector(target) : target;
    const ev = new ClipboardEvent("paste", { clipboardData: dt(files), bubbles: true, cancelable: true });
    t.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  window.__drop = (target, files) => {
    const t = typeof target === "string" ? document.querySelector(target) : target;
    const d = dt(files);
    t.dispatchEvent(new DragEvent("dragover", { dataTransfer: d, bubbles: true, cancelable: true }));
    const ev = new DragEvent("drop", { dataTransfer: d, bubbles: true, cancelable: true });
    t.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  window.__pick = (sel, files) => {
    const i = document.querySelector(sel);
    i.files = dt(files).files;
    i.dispatchEvent(new Event("change", { bubbles: true }));
    return i.files.length;
  };
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
  async function open(p, path, marker, ms) {
    await p.goto(base + path, 150);
    const here = "(location.pathname).indexOf(" + JSON.stringify(path.split("?")[0]) + ") === 0";
    await p.until(here + " && " + TOPBAR + (marker ? " && (" + marker + ")" : ""), ms || 15000);
    await p.eval(HELPERS);
  }
  async function signIn(p, key) {
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
    await p.goto(base + "/index.html?next=dashboard.html", 150);
    await p.until("!!document.getElementById('loginForm') && !!window.DCR2Demo && !document.getElementById('loginFields').disabled", 8000);
    await p.eval("document.getElementById('email').value=" + JSON.stringify(key + "@demo.test") + ";document.getElementById('password').value='demo-password-1';" +
      "document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname) && " + TOPBAR, 10000);
  }
  const db = (p, expr) => p.eval("(() => { const R = DCR2Demo.engine.rows; return " + expr + "; })()");
  const text = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); return n ? n.innerText : ''; })()");
  const modalOpen = "!!document.querySelector('.dcr-mo.open')";
  const modalOk = (p) => p.eval("(() => { const b = document.getElementById('dcrMoYes'); if (b) b.click(); return !!b; })()");
  const BILL = "!!document.getElementById('blDecision') && !!document.getElementById('blPaper')";
  const roles = (p) => p.eval("Array.from(document.querySelectorAll('[data-f]')).map(b => b.getAttribute('data-role') + ':' + b.textContent.replace(/^\\W+/, '').trim())");
  const queued = (p) => p.eval("new Promise((res) => { const r = indexedDB.open('dcr2Uploads', 1); r.onsuccess = () => { try { const t = r.result.transaction('q', 'readonly').objectStore('q').getAll(); t.onsuccess = () => res(t.result.filter((x) => !String(x.id).startsWith('entry:')).length); t.onerror = () => res(-1); } catch (e) { res(0); } }; r.onerror = () => res(-1); })");

  async function shoot(p, name, device, dark, full) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1440;
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    await sleep(350);
    const hgt = full === false ? (device === "phone" ? 844 : 900) : await p.eval("Math.max(" + (device === "phone" ? 844 : 900) + ", Math.min(4200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: hgt, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(450);
    const file = "files8_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: device === "phone" ? 844 : 900, deviceScaleFactor: 1, mobile: device === "phone" });
    await p.dark(false);
  }
  async function bothThemes(p, name, device, full) { await shoot(p, name, device, false, full); await shoot(p, name, device, true, full); }

  try {
    /* ── 0. a clean demo database, the bills by their made-up descriptions ── */
    const acc = await newPage(cdp, "accountant", OUT); pages.push(acc);
    await acc.size(1440, 900, false);
    await acc.goto(base + "/manifest.json", 50);
    await acc.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");
    await signIn(acc, "accountant");
    const J = await db(acc, `(() => {
      const by = (d) => R.bills.find((b) => b.description === d) || {};
      const pay = (b) => R.payments.find((p) => p.bill_id === b.id) || {};
      const c = R.costs.find((x) => x.description === "Simpson hangers, nails and straps") || {};
      return { blocked: by("Roof framing package (back order)").id, approved: by("-10% retainage held until the final walk").id,
        approvedDoc: by("-10% retainage held until the final walk").document_file_id, entered: by("Porch footings").id,
        part: by("Telehandler, one week").id, partPay: pay(by("Telehandler, one week")).id, cost: c.id, costProject: c.project_id,
        files: R.files.length };
    })()`);
    check("demo: the bills the walk needs (blocked, approved, entered, part paid) and a cost", J.blocked && J.approved && J.entered && J.part && J.partPay && J.cost, JSON.stringify(J));
    const fileRows = (expr) => db(acc, "R.files.filter((f) => " + expr + ").map((f) => ({ id: f.id, name: f.name, bill: f.bill_id, pay: f.payment_id, cost: f.cost_id, prev: f.previous_id, v: f.version_no, del: !!f.deleted_at, pv: f.preview_path }))");

    /* ── 1. a blocked bill: paste a picture, drop a PDF ─────────────────── */
    await attempt("the bill page: paste and drop", async () => {
      await open(acc, "/bill.html?id=" + J.blocked, BILL + " && !!document.querySelector('#blDrop .fd')");
      check("blocked bill: the drop box says the first file becomes the bill's document",
        /Attach the invoice: paste, drop or choose/.test(await text(acc, "#blDrop")) && /attach it here \(or in DCR Desktop 2\)/.test(await text(acc, "#blPaper")));
      await bothThemes(acc, "bill_blocked", "desktop", false);
      const took = await acc.eval("(async () => window.__paste('#blDrop .fd', [await window.__png('Made-up back order invoice')]))()");
      check("a pasted picture is taken (the paste's default stopped: never text)", took === true);
      await acc.until("!!DCR2Demo.engine.rows.bills.find((b) => b.id === " + J.blocked + ").document_file_id", 15000);
      const b = await db(acc, "R.bills.find((b) => b.id === " + J.blocked + ")");
      const doc = (await fileRows("f.id === " + b.document_file_id))[0];
      check("the paste is the bill's document: \"Bill <time>.png\", receipts + bill_id, its own row, a preview", doc && /^Bill \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/.test(doc.name) &&
        doc.bill === J.blocked && doc.pay === null && doc.prev === null && doc.v === 1 && /preview-320\.jpg$/.test(doc.pv || ""), JSON.stringify(doc));
      const state = await acc.eval("DCR2Demo.engine.select({ uid: DCR2Demo.engine.rows.profiles.find((p) => p.email === 'accountant@demo.test').id }, 'books_desk', { columns: 'id, state', filters: [{ col: 'id', op: 'eq', val: " + J.blocked + " }] }).data[0].state");
      check("the bill moves from blocked to waiting (books_desk)", state === "waiting", state);
      await acc.until("Array.from(document.querySelectorAll('[data-f]')).some((x) => x.getAttribute('data-role') === 'document')", 8000);
      // a PDF dropped: an extra; the same name twice: the database's "(2)"
      await acc.eval("window.__drop('#blDrop .fd', [window.__pdf('Marlow statement.pdf')])");
      await acc.until("DCR2Demo.engine.rows.files.filter((f) => f.bill_id === " + J.blocked + " && !f.deleted_at).length >= 2", 15000);
      await acc.eval("window.__drop('#blDrop .fd', [window.__pdf('Marlow statement.pdf')])");
      await acc.until("DCR2Demo.engine.rows.files.filter((f) => f.bill_id === " + J.blocked + " && !f.deleted_at).length >= 3", 15000);
      await acc.until("document.querySelectorAll('[data-f]').length >= 3", 8000);
      const extras = await fileRows("f.bill_id === " + J.blocked + " && !f.deleted_at && f.name.indexOf('Marlow statement') === 0");
      check("two dropped PDFs of the same name: two rows, \"Marlow statement.pdf\" and \"Marlow statement (2).pdf\" (never a version)",
        extras.map((f) => f.name).sort().join("|") === "Marlow statement (2).pdf|Marlow statement.pdf" && extras.every((f) => f.prev === null && f.v === 1), JSON.stringify(extras));
      const r = await roles(acc);
      check("the paperwork: the document first, then the extras", r[0].indexOf("document:") === 0 && r.filter((x) => x.indexOf("extra:") === 0).length === 2, r.join(" | "));
      await bothThemes(acc, "bill_paperwork", "desktop");
      // the document has no Remove; an extra has Make document and Remove
      await acc.eval("document.querySelector('[data-f][data-role=document]').click(); true");
      await sleep(300);
      check("the document: Replace…, never Remove", await acc.eval("!!document.getElementById('blReplace') && !document.getElementById('blRemove') && !document.getElementById('blMakeDoc')"));
      // make the first extra the document: only re-pointed
      const firstExtra = extras.find((f) => f.name === "Marlow statement.pdf");
      await acc.eval("Array.from(document.querySelectorAll('[data-f][data-role=extra]')).find((x) => /Marlow statement\\.pdf$/.test(x.textContent)).click(); true");
      await acc.until("!!document.getElementById('blMakeDoc')", 5000);
      await acc.eval("document.getElementById('blMakeDoc').click(); true");
      await acc.until("DCR2Demo.engine.rows.bills.find((b) => b.id === " + J.blocked + ").document_file_id === " + firstExtra.id, 8000);
      const old = (await fileRows("f.id === " + doc.id))[0];
      check("\"Make this the bill's document\" only re-points: the pasted picture stays, an extra", old && !old.del, JSON.stringify(old));
      // remove the second PDF (a wrong paste)
      const second = extras.find((f) => f.name === "Marlow statement (2).pdf");
      await acc.until("Array.from(document.querySelectorAll('[data-f][data-role=extra]')).some((x) => /\\(2\\)\\.pdf$/.test(x.textContent))", 8000);
      await acc.eval("Array.from(document.querySelectorAll('[data-f][data-role=extra]')).find((x) => /\\(2\\)\\.pdf$/.test(x.textContent)).click(); true");
      await acc.until("!!document.getElementById('blRemove')", 5000);
      await acc.eval("document.getElementById('blRemove').click(); true");
      await acc.until(modalOpen, 5000);
      await modalOk(acc);
      await acc.until("!!DCR2Demo.engine.rows.files.find((f) => f.id === " + second.id + ").deleted_at", 8000);
      check("Remove: the wrong paste is gone (a soft delete)", true);
      await acc.size(390, 844, true);
      await open(acc, "/bill.html?id=" + J.blocked, BILL);
      const sw = await acc.eval("document.documentElement.scrollWidth");
      check("the bill page with its paperwork on a phone: no sideways scroll", sw <= 391, sw);
      await bothThemes(acc, "bill_paperwork", "phone");
      await acc.size(1440, 900, false);
    }, acc);

    /* ── 2. entered: refused before upload; approved: asked, then replaced ── */
    await attempt("the bill page: Replace", async () => {
      await open(acc, "/bill.html?id=" + J.entered, BILL);
      const before = await db(acc, "R.files.length");
      await acc.eval("document.querySelector('[data-f][data-role=document]').click(); true");
      await acc.until("!!document.getElementById('blReplace')", 5000);
      await acc.eval("document.getElementById('blReplace').click(); true");
      await sleep(300);
      const msg = await text(acc, "#blFileMsg");
      check("a bill entered in QuickBooks: Replace refused before any byte moves (nothing queued)",
        /marked entered in QuickBooks: unmark it in the Books first/.test(msg) && (await queued(acc)) === 0 && (await db(acc, "R.files.length")) === before, msg);
      await open(acc, "/bill.html?id=" + J.approved, BILL);
      await acc.eval("document.querySelector('[data-f][data-role=document]').click(); true");
      await acc.until("!!document.getElementById('blReplace')", 5000);
      await acc.eval("document.getElementById('blReplace').click(); true");
      await acc.eval("(async () => window.__pick('#blReplaceIn', [window.__pdf('Rosewell corrected bill.pdf')]))()");
      await acc.until(modalOpen, 5000);
      const ask = await acc.eval("document.querySelector('.dcr-mo.open').innerText");
      check("an approved bill: asked first - the new document withdraws the approval", /withdraws the approval/.test(ask), ask);
      await shoot(acc, "replace_ask", "desktop", false, false);
      await modalOk(acc);
      await acc.until("DCR2Demo.engine.rows.bills.find((b) => b.id === " + J.approved + ").document_file_id !== " + J.approvedDoc, 15000);
      await acc.until("!!DCR2Demo.engine.rows.files.find((f) => f.id === " + J.approvedDoc + ").deleted_at", 8000);
      const b = await db(acc, "R.bills.find((b) => b.id === " + J.approved + ")");
      const nd = (await fileRows("f.id === " + b.document_file_id))[0];
      check("replaced: the new document in, the approval withdrawn, the old one removed", nd && nd.name === "Rosewell corrected bill.pdf" && b.approved_at === null,
        JSON.stringify({ nd, approved: b.approved_at }));
      await acc.until("(document.getElementById('blState') || {}).textContent === 'AWAITING APPROVAL'", 6000);
    }, acc);

    /* ── 3. a payment's file ──────────────────────────────────────────── */
    await attempt("the bill page: a payment's file", async () => {
      await open(acc, "/bill.html?id=" + J.part, BILL + " && !!document.querySelector('[data-payfile]')");
      await acc.eval("document.querySelector('[data-payfile=\"" + J.partPay + "\"]').click(); true");
      await acc.eval("(async () => window.__pick('#blPayIn', [await window.__png('Made-up cash slip')]))()");
      await acc.until("DCR2Demo.engine.rows.files.some((f) => f.payment_id === " + J.partPay + ")", 15000);
      const f = (await fileRows("f.payment_id === " + J.partPay))[0];
      check("kind payment: the payment's bill and the payment, \"Payment <time>.png\"", f.bill === J.part && f.pay === J.partPay && /^Payment .+\.png$/.test(f.name), JSON.stringify(f));
      await acc.until("Array.from(document.querySelectorAll('[data-f]')).some((x) => x.getAttribute('data-role') === 'payment')", 8000);
      const title = await acc.eval("document.querySelector('[data-f][data-role=payment]').title");
      check("the page says what it is: \"Proof of payment: Cash · <day>\"", /^Proof of payment: Cash · [A-Z][a-z]{2} \d{1,2}: Payment /.test(title), title);
      await bothThemes(acc, "bill_payment_file", "desktop");
    }, acc);

    /* ── 4. the expense dialog: three receipts at once ────────────────── */
    await attempt("the expense dialog: 3 receipts", async () => {
      await open(acc, "/project.html?id=" + J.costProject + "&tab=expenses", "!!document.getElementById('exAdd')");
      await acc.eval("document.getElementById('exAdd').click(); true");
      await acc.until("!!document.querySelector('#exModal.open #cfFiles .fd')", 8000);
      await acc.eval(HELPERS);
      await acc.eval("(() => { const s = (id, v) => { const n = document.getElementById(id); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); };" +
        " s('cfKind', 'material'); s('cfDesc', 'Made-up hardware run, three stops'); s('cfVendor', 'Made-up Hardware'); s('cfAmount', '84.20'); return true; })()");
      await acc.eval("window.__pick('#cfFiles .fd-in', [window.__pdf('Stop 1 receipt.pdf')])");
      await acc.eval("(async () => window.__paste('#cfDesc', [await window.__png('Made-up stop 2')]))()");
      await acc.eval("window.__drop('#cfFiles .fd', [window.__pdf('Stop 3 receipt.pdf')])");
      await acc.until("document.querySelectorAll('#cfFiles .fd-t').length === 3", 5000);
      check("three tiles: picked, pasted (on the dialog, even with the focus in a text field), dropped", true);
      await shoot(acc, "expense_three", "desktop", false, false);
      await acc.eval("document.getElementById('cfSave').click(); true");
      await acc.until("!!DCR2Demo.engine.rows.costs.find((c) => c.description === 'Made-up hardware run, three stops')", 8000);
      const cid = await db(acc, "R.costs.find((c) => c.description === 'Made-up hardware run, three stops').id");
      await acc.until("DCR2Demo.engine.rows.files.filter((f) => f.cost_id === " + cid + ").length === 3", 20000);
      const rs = await fileRows("f.cost_id === " + cid);
      check("3 receipts on the new cost, each its own row, distinct names (the paste named \"Receipt <time>\")",
        rs.length === 3 && new Set(rs.map((f) => f.name)).size === 3 && rs.some((f) => /^Receipt .+\.png$/.test(f.name)) && rs.every((f) => f.prev === null), JSON.stringify(rs));
      await acc.until("!!document.querySelector('[data-receipt=\"" + cid + ":2\"]')", 10000);
      check("the Expenses tab shows the three", true);
      // a file dropped on another row attaches to that cost
      await acc.eval("window.__drop('tr[data-drop=\"" + J.cost + "\"]', [window.__pdf('Hangers credit memo.pdf')])");
      await acc.until("DCR2Demo.engine.rows.files.some((f) => f.cost_id === " + J.cost + " && f.name === 'Hangers credit memo.pdf')", 15000);
      check("the Expenses tab: a PDF dropped on a row is that cost's receipt", true);
      await acc.size(390, 844, true);
      await open(acc, "/project.html?id=" + J.costProject + "&tab=expenses", "!!document.getElementById('exAdd')");
      check("the Expenses tab on a phone: no sideways scroll", (await acc.eval("document.documentElement.scrollWidth")) <= 391);
      await acc.size(1440, 900, false);
    }, acc);

    /* ── 5. the ledger: drop on a row, paste on a selected row ───────────── */
    await attempt("the ledger: drop and paste on rows", async () => {
      await open(acc, "/ledger.html", "!!document.querySelector('#lgBody tr[data-drop=\"" + J.cost + "\"]')");
      const n0 = await db(acc, "R.files.filter((f) => f.cost_id === " + J.cost + ").length");
      await acc.eval("window.__drop('#lgBody tr[data-drop=\"" + J.cost + "\"]', [window.__pdf('Hangers delivery slip.pdf')])");
      await acc.until("DCR2Demo.engine.rows.files.filter((f) => f.cost_id === " + J.cost + ").length === " + (n0 + 1), 15000);
      // select the row (a click), then paste a screenshot: heard on the table, attached to that row
      await acc.eval("document.querySelector('#lgBody tr[data-drop=\"" + J.cost + "\"] td.desc').click(); true");
      const sel = await acc.eval("document.querySelector('#lgBody tr[data-drop=\"" + J.cost + "\"]').classList.contains('fd-row-sel')");
      await acc.eval("(async () => window.__paste(document.querySelector('#lgBody tr[data-drop=\"" + J.cost + "\"]'), [await window.__png('Made-up yard screenshot')]))()");
      await acc.until("DCR2Demo.engine.rows.files.filter((f) => f.cost_id === " + J.cost + ").length === " + (n0 + 2), 15000);
      const rs = await fileRows("f.cost_id === " + J.cost);
      check("the ledger: a dropped PDF and a pasted screenshot on the selected row are that cost's receipts, distinct names",
        sel && rs.length === n0 + 2 && new Set(rs.map((f) => f.name)).size === rs.length && rs.some((f) => f.name === "Hangers delivery slip.pdf"), JSON.stringify(rs.map((f) => f.name)));
      await acc.until("/" + (n0 + 2) + "/.test((document.querySelector('[data-row=\"" + J.cost + "\"] .lg-rn') || {}).textContent || '')", 10000);
      check("the row's receipt count reads again when they land", true);
      // a paste into the search box is text: left alone
      const typed = await acc.eval("(() => { const q = document.getElementById('lgQ'); q.focus(); return window.__paste(q, []); })()");
      check("a paste into a text field is left alone", typed === false);
      await bothThemes(acc, "ledger_rows", "desktop", false);
      await acc.size(390, 844, true);
      await open(acc, "/ledger.html", "!!document.querySelector('#lgBody table')");
      check("the ledger on a phone: no sideways scroll", (await acc.eval("document.documentElement.scrollWidth")) <= 391);
      await shoot(acc, "ledger_rows", "phone", false, false);
      await acc.size(1440, 900, false);
    }, acc);

    /* ── 6. no security-policy violation, no console error ─────────────── */
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
