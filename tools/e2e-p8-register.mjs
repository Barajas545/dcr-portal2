#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the Books program's check register and payment panel, release A (P3), in the
   DEMO (development only).

     node tools/e2e-p8-register.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with the check register's rules
   - tools/fake/p8-register.js over p5b-books.js: a check number used once, the date bounds, the next number, void /
   picked up / cleared as system code's stamps, spoiled blanks, check_register; nothing goes to Supabase) and drives a
   local Chrome or Edge headless:

   - the register as the accountant: the next number, the gap flag ("#5309 missing — spoil it or find it"), a check
     paying two bills on one line; Void hidden while the switch is off (and no switch: an admin's);
   - the payment panel (accounting.html): the number prefilled from the register (#5309), the date set to yesterday, a
     picture PASTED on the panel and a PDF DROPPED on its files box; a used number refused in the database's words (and
     the next free one said); then recorded - the files queued after the payment, two rows with distinct names; the gap
     closes;
   - the register again: the new check's files in the viewer; Picked up (a day, who collected it); Mark cleared for the
     lines picked, its Undo; Spoil a blank (a written number refused in the dialog, in the database's words), its undo;
     the Checks CSV (BOM, CRLF, the formula guard, the amount); print (a header, no buttons);
   - the admin: the "Allow voiding checks" switch (the phase-4 words), on; Void a check (a reason, FINAL): the line says
     void, the bill is owed again on The Books; the switch off again;
   - the demo approver (financials, NO prices - S4): no amount in the register, its CSV, its print, nor in the payment
     panel; a lead: refused before anything is read;
   - phone (390 px: no page scrolls sideways) and desktop, light and dark; no Content-Security-Policy violation and no
     console error on any page.
   Screenshots (--shots all): register8_<what>_<light|dark>_<desktop|phone>.png into --out (default: the system temp
   folder). Made-up data only. Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p8-register")));
const SHOTS = arg("--shots", "all");
const AMOUNT = /\$\s?\d/;

/* the page's own helpers: made-up files, a synthetic paste and drop, the CSV a click makes */
const HELPERS = `(() => {
  window.__png = async (label, w, h) => {
    const c = document.createElement("canvas"); c.width = w || 480; c.height = h || 320;
    const g = c.getContext("2d"); g.fillStyle = "#e8eef5"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#1b2733"; g.font = "28px sans-serif"; g.fillText(label || "made-up check", 24, c.height / 2);
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
  if (!window.__blobs) {
    window.__blobs = [];
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { if (b && /csv/.test(b.type || "")) window.__blobs.push(b); return make(b); };
  }
  window.__set = (id, v) => { const n = document.getElementById(id); n.value = v; n.dispatchEvent(new Event("input", { bubbles: true })); n.dispatchEvent(new Event("change", { bubbles: true })); return true; };
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
  const html = (p) => p.eval("document.documentElement.outerHTML");
  const modalOpen = "!!document.querySelector('.dcr-mo.open')";
  const modalOk = (p) => p.eval("(() => { const b = document.querySelector('.dcr-mo.open #dcrMoYes'); if (b) b.click(); return !!b; })()");
  const modalNo = (p) => p.eval("(() => { const b = document.querySelector('.dcr-mo.open #dcrMoNo'); if (b) b.click(); return !!b; })()");
  const modalClosed = "!document.querySelector('.dcr-mo.open')";
  const REG = "!!document.getElementById('rgTable')";
  const DESK = "!!document.getElementById('secPay')";
  const line = (p, number) => p.eval("(() => { const rows = Array.from(document.querySelectorAll('#rgTable tbody tr')).filter((tr) => !tr.classList.contains('rg-month')); " +
    "const tr = rows.find((x) => { const w = x.querySelector('.who'); return w && w.textContent === '#" + number + "'; }); " +
    "return tr ? { cls: tr.className, text: tr.innerText.replace(/\\s+/g, ' '), acts: Array.from(tr.querySelectorAll('td.acts-c [data-act]')).map((b) => b.getAttribute('data-act')) } : null; })()");
  const act = (p, number, what) => p.eval("(() => { const tr = Array.from(document.querySelectorAll('#rgTable tbody tr')).find((x) => { const w = x.querySelector('.who'); return w && w.textContent === '#" + number + "'; }); " +
    "const b = tr && tr.querySelector('[data-act=\"" + what + "\"]'); if (b) b.click(); return !!b; })()");
  const csv = (p) => p.eval("(async () => { const b = window.__blobs[window.__blobs.length - 1]; if (!b) return null; const buf = new Uint8Array(await b.arrayBuffer()); return { bom: Array.from(buf.slice(0, 3)).join(','), text: new TextDecoder().decode(buf) }; })()");

  async function shoot(p, name, device, dark, full) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1440;
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    await sleep(350);
    const hgt = full === false ? (device === "phone" ? 844 : 900) : await p.eval("Math.max(" + (device === "phone" ? 844 : 900) + ", Math.min(4200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: hgt, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(450);
    const file = "register8_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: device === "phone" ? 844 : 900, deviceScaleFactor: 1, mobile: device === "phone" });
    await p.dark(false);
  }
  /* the printed page as the printer gets it (print media, light; the dark helper would reset the media type) */
  async function printShot(p, name) {
    if (SHOTS === "none") return;
    await p.call("Page.bringToFront").catch(() => null);
    await p.call("Emulation.setEmulatedMedia", { media: "print", features: [{ name: "prefers-color-scheme", value: "light" }] });
    await p.eval("window.dispatchEvent(new Event('beforeprint')); true");
    const hgt = await p.eval("Math.max(900, Math.min(4200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: 1100, height: hgt, deviceScaleFactor: 1, mobile: false });
    await sleep(450);
    const file = "register8_" + name + "_print.png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setEmulatedMedia", { media: "", features: [{ name: "prefers-color-scheme", value: "light" }] });
    await p.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  async function bothThemes(p, name, device, full) { await shoot(p, name, device, false, full); await shoot(p, name, device, true, full); }
  async function phone(p, path, marker, name) {
    await p.size(390, 844, true);
    await open(p, path, marker);
    const sw = await p.eval("document.documentElement.scrollWidth");
    if (name) await bothThemes(p, name, "phone", true);
    await p.size(1440, 900, false);
    return sw;
  }

  try {
    /* ── 0. a clean demo database ─────────────────────────────────────── */
    const acc = await newPage(cdp, "accountant", OUT); pages.push(acc);
    await acc.size(1440, 900, false);
    await acc.goto(base + "/manifest.json", 50);
    await acc.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");
    await signIn(acc, "accountant");
    const J = await db(acc, `(() => {
      const by = (d) => R.bills.find((b) => b.description === d) || {};
      const pay = (n) => R.payments.find((p) => p.check_number === n) || {};
      return { rosewell: by("-10% retainage held until the final walk").id, brightwater: pay("5310").bill_id, p5310: pay("5310").id,
        kestrel: R.payments.filter((p) => p.check_number === "5308").map((p) => p.id), spoiled: R.spoiled_checks.length, today: DCR2Demo.engine.rows && null };
    })()`);
    J.today = await acc.eval("new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())");
    J.yesterday = new Date(Date.UTC(+J.today.slice(0, 4), +J.today.slice(5, 7) - 1, +J.today.slice(8, 10) - 1)).toISOString().slice(0, 10);
    check("demo: the register's made-up checks (5306 cleared, 5307 spoiled, 5308 for two bills, 5310 written) and the bill to pay",
      J.rosewell && J.brightwater && J.p5310 && J.kestrel.length === 2 && J.spoiled === 1, JSON.stringify(J));

    /* ── 1. the register as the accountant ──────────────────────────────── */
    await attempt("the register: next number, gaps, one line per check", async () => {
      await open(acc, "/books-checks.html", REG);
      const next = await text(acc, "#rgNext");
      check("the next number: \"Next check: #5309 — after #5308 to Kestrel Lumber Supply, <day>\"", /^Next check: #5309 — after #5308 to Kestrel Lumber Supply, [A-Z][a-z]{2} \d{1,2}$/.test(next), next);
      const gaps = await text(acc, "#rgGaps");
      check("the gap flag: \"#5309 missing — spoil it or find it\" with [Spoil #5309]; the long runs said softly",
        /#5309 missing — spoil it or find it/.test(gaps) && /are not in the register \(\d+ numbers\): another checkbook/.test(gaps) &&
        (await acc.eval("!!document.querySelector('#rgGaps [data-spoil=\"5309\"]')")), gaps);
      const k = await line(acc, "5308");
      check("#5308: one line for the check that paid two bills of one supplier on one day - told by e-mail, with its amount (prices)",
        k && /Kestrel Lumber Supply/.test(k.text) && /2 bills/.test(k.text) && /Told by e-mail/.test(k.text) && /\$651\.75/.test(k.text), JSON.stringify(k));
      const c = await line(acc, "5306");
      check("#5306: cleared (picked up first); #5307: a spoiled blank with its reason", c && /Cleared/.test(c.text) && c.acts.join() === "unclear" &&
        /Torn in the printer/.test(((await line(acc, "5307")) || {}).text || ""), JSON.stringify(c));
      const v = await acc.eval("({ voids: document.querySelectorAll('[data-act=void]').length, sw: !!document.getElementById('rgVoidSwitch'), note: document.getElementById('rgBody').innerText })");
      check("Void hidden while the switch is off; no switch for the accountant (an admin's), the note says why",
        v.voids === 0 && !v.sw && /Voiding checks is switched off until every PC runs DCR Desktop 2 2\.25/.test(v.note), JSON.stringify({ voids: v.voids, sw: v.sw }));
      await bothThemes(acc, "register", "desktop", true);
    }, acc);

    /* ── 2. the payment panel: the next number, the date, files, a used number ── */
    await attempt("the payment panel: number, date, files", async () => {
      await open(acc, "/accounting.html", DESK + " && !!document.querySelector('#secPay [data-open=\"" + J.rosewell + "\"]')");
      await acc.eval("document.querySelector('#secPay [data-open=\"" + J.rosewell + "\"]').click(); true");
      await acc.until("!!document.getElementById('ckWrite') && document.getElementById('ckNumber').value === '5309'", 10000);
      const f = await acc.eval("({ n: document.getElementById('ckNumber').value, sub: document.getElementById('ckRefSub').textContent, d: document.getElementById('ckDate').value, min: document.getElementById('ckDate').min, max: document.getElementById('ckDate').max, box: !!document.querySelector('#ckFiles .fd') })");
      const plus = (d) => new Date(Date.UTC(+J.today.slice(0, 4), +J.today.slice(5, 7) - 1, +J.today.slice(8, 10) + d)).toISOString().slice(0, 10);
      check("the number prefilled from the register (#5309), said as a suggestion; the date today, -400 / +31; the files box",
        f.n === "5309" && /The next check by the register \(after #5308/.test(f.sub) && f.d === J.today && f.min === plus(-400) && f.max === plus(31) && f.box, JSON.stringify(f));
      await acc.eval("window.__set('ckDate', " + JSON.stringify(J.yesterday) + ")");
      const took = await acc.eval("(async () => window.__paste('#ckPanel', [await window.__png('Made-up check photo')]))()");
      await acc.eval("window.__drop('#ckFiles .fd', [window.__pdf('Rosewell remittance.pdf')])");
      await acc.until("document.querySelectorAll('#ckFiles .fd-t').length === 2", 5000);
      check("a picture pasted on the panel and a PDF dropped on its box: two tiles, nothing uploaded yet (no payment row yet)",
        took === true && (await db(acc, "R.files.filter((f) => f.payment_id != null).length")) === 0);
      await bothThemes(acc, "pay_panel", "desktop", true);
      // a used number: the database's words in the field, and the next free one
      await acc.eval("document.getElementById('ckNumber').value = '5306'; document.getElementById('ckNumber').dispatchEvent(new Event('change', { bubbles: true })); true");
      await acc.until("/already in the register/.test(document.getElementById('ckRefSub').textContent)", 6000);
      const warn = await text(acc, "#ckRefSub");
      check("typed: check_number_info warns early (\"Check #5306 is already in the register (Stonebrook Concrete, …)\")", /^Check #5306 is already in the register \(Stonebrook Concrete, /.test(warn), warn);
      await acc.eval("document.getElementById('ckWrite').click(); true");
      await acc.until(modalOpen, 5000);
      const ask = await acc.eval("document.querySelector('.dcr-mo.open').innerText");
      await modalOk(acc);
      await acc.until("/check register/.test(document.getElementById('ckMsg').textContent)", 8000);
      const said = await acc.eval("({ msg: document.getElementById('ckMsg').textContent, sub: document.getElementById('ckRefSub').textContent, tiles: document.querySelectorAll('#ckFiles .fd-t').length })");
      check("refused: the database's own sentence in the field (never 'already used by another record'), the next free number, the files kept",
        /^Check 5306 is already in the check register \(Stonebrook Concrete, [A-Z][a-z]{2} \d{1,2}, \d{4}\): a check number is used once/.test(said.msg) &&
        /The next free number is #5309\./.test(said.sub) && said.tiles === 2 && !/another record/.test(said.msg) && /2 files go with it/.test(ask), JSON.stringify(said));
      await shoot(acc, "pay_panel_used_number", "desktop", false, false);
      // recorded at #5309, dated yesterday; the files queued after the row
      await acc.eval("document.getElementById('ckNumber').value = '5309'; document.getElementById('ckNumber').dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('ckWrite').click(); true");
      await acc.until(modalOpen, 5000);
      await modalOk(acc);
      await acc.until("DCR2Demo.engine.rows.payments.some((p) => p.check_number === '5309')", 10000);
      const pay = await db(acc, "R.payments.find((p) => p.check_number === '5309')");
      check("recorded: check #5309, dated yesterday (paidDate sent), the bill and the amount owed", pay.bill_id === J.rosewell && pay.paid_date === J.yesterday && Number(pay.amount) === 2400, JSON.stringify(pay));
      await acc.until("DCR2Demo.engine.rows.files.filter((f) => f.payment_id === " + pay.id + ").length === 2", 20000);
      const fs = await db(acc, "R.files.filter((f) => f.payment_id === " + pay.id + ").map((f) => ({ name: f.name, bill: f.bill_id, folder: f.folder, prev: f.previous_id }))");
      check("its two files: kind payment (the payment's bill and the payment), receipts, distinct names, the paste \"Payment <time>.png\"",
        fs.length === 2 && fs.every((x) => x.bill === J.rosewell && x.folder === "receipts" && x.prev === null) && new Set(fs.map((x) => x.name)).size === 2 &&
        fs.some((x) => /^Payment \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/.test(x.name)) && fs.some((x) => x.name === "Rosewell remittance.pdf"), JSON.stringify(fs));
      J.p5309 = pay.id;
      const sw = await phone(acc, "/accounting.html", DESK);
      check("The Books on a phone: no sideways scroll", sw <= 391, sw);
    }, acc);

    /* ── 3. the register again: files, picked up, cleared + undo, spoil + unspoil, CSV, print ── */
    await attempt("the register: the line's files, picked up, cleared, spoiled, CSV, print", async () => {
      await open(acc, "/books-checks.html", REG);
      const gaps = await text(acc, "#rgGaps");
      check("the gap at #5309 is closed; the next number moves past #5310", !/#5309 missing/.test(gaps) && /^Next check: #5311/.test(await text(acc, "#rgNext")), gaps);
      await acc.eval("Array.from(document.querySelectorAll('#rgTable tbody tr')).find((x) => (x.querySelector('.who') || {}).textContent === '#5309').querySelector('[data-files]').click(); true");
      await acc.until("!document.getElementById('fvView').hidden && /of 2/.test(document.getElementById('fvN').textContent)", 6000);
      check("📎 2 opens the check's files in the viewer (\"1 of 2\")", true);
      await acc.eval("document.getElementById('fvClose').click(); true");
      // picked up
      await act(acc, "5310", "pickup");
      await acc.until(modalOpen, 5000);
      const mt = await acc.eval("document.querySelector('.dcr-mo.open').innerText");
      await acc.eval("document.getElementById('dcrMoF1').value = 'their foreman'; true");
      await modalOk(acc);
      await acc.until("!!DCR2Demo.engine.rows.payments.find((x) => x.id === " + J.p5310 + ").picked_up_at && (Array.from(document.querySelectorAll('#rgTable tbody tr.picked_up .who')).some((x) => x.textContent === '#5310'))", 8000);
      const p = await db(acc, "R.payments.find((x) => x.id === " + J.p5310 + ")");
      check("Picked up: the day and who collected it; nobody was told, so told in person too", /When did they collect it/.test(mt) && p.picked_up_at && p.picked_up_note === "their foreman" &&
        p.pickup_told_how === "in person", JSON.stringify({ at: p.picked_up_at, note: p.picked_up_note, how: p.pickup_told_how }));
      // mark cleared (5308's two payments) and undo
      await acc.eval("Array.from(document.querySelectorAll('#rgTable tbody tr')).find((x) => (x.querySelector('.who') || {}).textContent === '#5308').querySelector('[data-pick]').click(); true");
      await acc.until("!document.getElementById('rgClear').disabled", 4000);
      await acc.eval("document.getElementById('rgClear').click(); true");
      await acc.until(modalOpen, 5000);
      await modalOk(acc);
      await acc.until("!!document.getElementById('rgUndo')", 8000);
      const done = await text(acc, ".rg-done");
      const cl = await db(acc, "R.payments.filter((x) => x.check_number === '5308').map((x) => x.cleared_on)");
      check("Mark cleared: both payments of #5308 cleared on the statement date, said in full, with Undo", /2 payments marked cleared on/.test(done) && cl.every((x) => x === J.today), done + " " + JSON.stringify(cl));
      await shoot(acc, "register_cleared", "desktop", false, false);
      await acc.eval("document.getElementById('rgUndo').click(); true");
      await acc.until("/Undone/.test((document.querySelector('.rg-done') || {}).textContent || '')", 8000);
      check("Undo: no longer cleared", (await db(acc, "R.payments.filter((x) => x.check_number === '5308').every((x) => !x.cleared_on)")) === true);
      // spoil: a written number refused in the dialog; a blank spoiled; then taken off
      await acc.eval("document.getElementById('rgSpoil').click(); true");
      await acc.until(modalOpen, 5000);
      const pre = await acc.eval("document.getElementById('dcrMoF0').value");
      await acc.eval("document.getElementById('dcrMoF0').value = '5306'; document.getElementById('dcrMoF1').value = 'Torn'; true");
      await modalOk(acc);
      await acc.until("/was written/.test(document.getElementById('dcrMoErr').textContent)", 6000);
      const err = await text(acc, "#dcrMoErr");
      check("Spoil a blank: prefilled with the next number; a written one refused in the dialog in the database's words",
        pre === "5311" && /^Check 5306 was written \(Stonebrook Concrete, .+\): only a blank never used is spoiled - void the check instead\.$/.test(err), pre + " / " + err);
      await acc.eval("document.getElementById('dcrMoF0').value = '5311'; document.getElementById('dcrMoF1').value = 'Printed crooked'; true");
      await modalOk(acc);
      await acc.until(modalClosed + " && Array.from(document.querySelectorAll('#rgTable tr.spoiled .who')).some((x) => x.textContent === '#5311')", 6000);
      const sp = await line(acc, "5311");
      check("#5311 spoiled, with its reason; the next number past it", sp && /Spoiled/.test(sp.text) && /Printed crooked/.test(sp.text) && /^Next check: #5312/.test(await text(acc, "#rgNext")), JSON.stringify(sp));
      await act(acc, "5311", "unspoil");
      await acc.until(modalOpen, 5000);
      await modalOk(acc);
      await acc.until("!(Array.from(document.querySelectorAll('#rgTable .who')).some((x) => x.textContent === '#5311'))", 6000);
      check("Not spoiled: the mark taken off", true);
      // the Checks CSV
      await acc.eval("window.__blobs.length = 0; document.getElementById('rgCsv').click(); true");
      await acc.until("window.__blobs.length === 1", 4000);
      const c = await csv(acc);
      const lines = c.text.replace(/^\uFEFF/, "").split("\r\n");
      check("the Checks CSV: a BOM, CRLF, every cell quoted, the amount (prices), one line a check",
        c.bom === "239,187,191" && lines[lines.length - 1] === "" && /^"Check No","Date","Payee","Jobs","Amount","Status",/.test(lines[0]) &&
        lines.slice(1, -1).every((l) => /^"([^"]|"")*"(,"([^"]|"")*")*$/.test(l)) && lines.some((l) => /^"5308",.*"651\.75"/.test(l)) && !/[^\r]\n/.test(c.text), lines.slice(0, 3).join(" / "));
      // print: the header, no buttons, no filters
      await acc.call("Emulation.setEmulatedMedia", { media: "print" });
      await sleep(250);
      const pr = await acc.eval("({ head: getComputedStyle(document.getElementById('rgPrintHead')).display, bar: getComputedStyle(document.querySelector('.rg-bar')).display, f: getComputedStyle(document.getElementById('rgFilters')).display, top: getComputedStyle(document.getElementById('dcr2Topbar')).display })");
      await acc.eval("window.dispatchEvent(new Event('beforeprint')); true");
      const ph = await text(acc, "#rgPrintHead");
      check("print: the header \"Check register · <from>–<to> · printed <day> by <name>\"; no top bar, buttons or filters",
        pr.head === "block" && pr.bar === "none" && pr.f === "none" && pr.top === "none" && /^Check register · .+ · printed [A-Z][a-z]{2} \d{1,2}, \d{4} by Casey Accounts · \d+ lines$/.test(ph), JSON.stringify(pr) + " " + ph);
      await acc.call("Emulation.setEmulatedMedia", { media: "" });
      await printShot(acc, "register");
      const sw = await phone(acc, "/books-checks.html", REG, "register");
      check("the register on a phone: no sideways scroll", sw <= 391, sw);
    }, acc);

    /* ── 4. the admin: the void switch, a void ─────────────────────────── */
    const ad = await newPage(cdp, "admin", OUT); pages.push(ad);
    await ad.size(1440, 900, false);
    await attempt("the admin: Allow voiding checks; Void", async () => {
      await signIn(ad, "admin");
      await open(ad, "/books-checks.html", REG + " && !!document.getElementById('rgVoidSwitch')");
      const words = await text(ad, "#rgVoid");
      check("the switch: an admin's, off, with the phase-4 words (every PC on DCR Desktop 2 2.25; 2.23 / 2.24 count a voided check as paid)",
        !(await ad.eval("document.getElementById('rgVoidSwitch').checked")) && /every office PC runs DCR Desktop 2 2\.25 or later/.test(words) && /count a voided check as paid/.test(words), words);
      await shoot(ad, "void_switch_off", "desktop", false, false);
      await ad.eval("document.getElementById('rgVoidSwitch').click(); true");
      await ad.until(modalOpen, 5000);
      const ask = await ad.eval("document.querySelector('.dcr-mo.open').innerText");
      await modalOk(ad);
      await ad.until("DCR2Demo.engine.rows.settings[0].payments_void_enabled === true && !!document.querySelector('[data-act=void]')", 8000);
      check("turned on after the question (\"Is every PC on DCR Desktop 2 2.25 or later?\"): Void appears on written checks, never on a cleared one",
        /Is every PC on DCR Desktop 2 2\.25 or later/.test(ask) && !((await line(ad, "5306")) || { acts: [] }).acts.includes("void") && ((await line(ad, "5310")) || { acts: [] }).acts.includes("void"), ask);
      await act(ad, "5310", "void");
      await ad.until(modalOpen, 5000);
      const vt = await ad.eval("document.querySelector('.dcr-mo.open').innerText");
      await ad.eval("document.getElementById('dcrMoF0').value = 'no'; true");
      await modalOk(ad);
      await ad.until("/3 to 300/.test(document.getElementById('dcrMoErr').textContent)", 4000);
      await ad.eval("document.getElementById('dcrMoF0').value = 'Lost in the mail - a new check is written'; true");
      await modalOk(ad);
      await ad.until("!!DCR2Demo.engine.rows.payments.find((x) => x.id === " + J.p5310 + ").voided_at", 8000);
      await ad.until("Array.from(document.querySelectorAll('#rgTable tbody tr.void .who')).some((x) => x.textContent === '#5310')", 8000);
      const vl = await line(ad, "5310");
      check("Void (FINAL, a reason): the line says void with its reason and offers nothing more", /FINAL/.test(vt) && vl.cls === "void" && /Lost in the mail/.test(vl.text) && vl.acts.length === 0, JSON.stringify(vl));
      await bothThemes(ad, "register_void", "desktop", false);
      await open(ad, "/accounting.html", DESK + " && !!document.querySelector('#secPay [data-open=\"" + J.brightwater + "\"]')");
      check("The Books: the voided check's bill is owed again (on Bills to pay), and nobody is to be told about it",
        !(await ad.eval("Array.from(document.querySelectorAll('#secTell .ck-tell')).some((x) => /5310/.test(x.innerText))")));
      await open(ad, "/books-checks.html", REG + " && !!document.getElementById('rgVoidSwitch')");
      await ad.eval("document.getElementById('rgVoidSwitch').click(); true");
      await ad.until(modalOpen, 5000);
      await modalOk(ad);
      await ad.until("DCR2Demo.engine.rows.settings[0].payments_void_enabled === false && !document.querySelector('[data-act=void]')", 8000);
      check("turned off again: no Void anywhere; the void stays", (await db(ad, "!!R.payments.find((x) => x.id === " + J.p5310 + ").voided_at")) === true);
    }, ad);

    /* ── 5. the approver (financials, NO prices - S4) and a lead ───────── */
    const ap = await newPage(cdp, "approver", OUT); pages.push(ap);
    await ap.size(1440, 900, false);
    await attempt("the approver (no prices): no amount anywhere", async () => {
      await signIn(ap, "approver");
      await open(ap, "/books-checks.html", REG);
      await ap.eval("Array.from(document.querySelectorAll('.av img')).forEach((i) => i.remove()); true");
      const h0 = await html(ap);
      const th = await ap.eval("Array.from(document.querySelectorAll('#rgTable thead th')).map((x) => x.textContent)");
      check("the register without prices: no Amount column, no amount on the page", !th.includes("Amount") && !AMOUNT.test(h0), (h0.match(/.{40}\$\s?\d.{20}/) || [""])[0]);
      await ap.eval("window.__blobs.length = 0; document.getElementById('rgCsv').click(); true");
      await ap.until("window.__blobs.length === 1", 4000);
      const c = await csv(ap);
      check("its CSV without prices: no Amount column, no amount", !/Amount/.test(c.text) && !/"\d+\.\d\d"/.test(c.text), c.text.split("\r\n")[0]);
      await ap.call("Emulation.setEmulatedMedia", { media: "print" });
      await sleep(200);
      check("its print: no amount", !AMOUNT.test(await ap.eval("document.body.innerText")));
      await ap.call("Emulation.setEmulatedMedia", { media: "" });
      await printShot(ap, "register_no_prices");
      await bothThemes(ap, "register_no_prices", "desktop", true);
      // the payment panel without prices
      await open(ap, "/accounting.html", DESK + " && !!document.querySelector('#secPay [data-open]')");
      await ap.eval("document.querySelector('#secPay [data-open]').click(); true");
      await ap.until("!!document.getElementById('ckPanel') && !!document.getElementById('ckWrite')", 10000);
      const panel = await ap.eval("({ h: document.getElementById('ckPanel').innerHTML, amount: document.getElementById('ckAmount').value, ph: document.getElementById('ckAmount').placeholder })");
      check("the payment panel without prices: no amount in it (the amount is typed from the bill)", !AMOUNT.test(panel.h) && panel.amount === "" && panel.ph === "Type the amount",
        (panel.h.match(/.{40}\$\s?\d.{20}/) || [""])[0]);
      await shoot(ap, "pay_panel_no_prices", "desktop", false, false);
    }, ap);
    const le = await newPage(cdp, "lead", OUT); pages.push(le);
    await le.size(390, 844, true);
    await attempt("a lead: the register refused before any read", async () => {
      await signIn(le, "lead");
      await le.goto(base + "/books-checks.html", 150);
      await le.until(modalOpen, 10000);
      const t = await le.eval("document.querySelector('.dcr-mo.open').innerText");
      const h0 = await html(le);
      check("refused ('not available for your role'), no amount, no line", /not available for your role/.test(t) && !AMOUNT.test(h0) && !(await le.eval("!!document.getElementById('rgTable')")), t.slice(0, 120));
      await shoot(le, "register_refused_lead", "phone", false, false);
      await modalOk(le);
      await le.until("/dashboard\\.html/.test(location.pathname)", 8000);
      const asked = await le.eval("performance.getEntriesByType('resource').map(r => r.name).filter(n => /\\/rest\\/v1\\/(check_register|payments|spoiled_checks|settings)|next_check_number/.test(n)).length");
      check("a lead: nothing of the register was asked for", asked === 0, asked);
    }, le);

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
