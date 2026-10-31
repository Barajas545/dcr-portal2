// The Books program, release B part 2b (P5): Advanced mode's new pages - books-vendors.html and books-reports.html -
// read from their source, and DRIVEN in node over the demo database (tools/fake/p8-advanced.js on p5b-books.js,
// p8-register.js and p8-books.js) with a small DOM (tests/console/console-page-dom.mjs):
// * the policy word for word, their module, the Books' look, no inline script; out of the offline list (S13);
// * refused before ANY read: the vendor list without financials; the reports without financials AND prices (S3, S4 -
//   money_events carries amounts); no approve call anywhere (S1);
// * S4: a financials-only account (the demo approver: no prices) sees the vendors' facts and not one amount; the reports
//   refuse it before asking the database anything;
// * the vendor details: saved through the sheet as an upsert at the version shown; someone else's save meanwhile
//   (PT409) shows theirs; only money editors are offered it;
// * the 1099 worksheet's threshold is the year's default, and a typed one is sent for that view only (never stored);
// * S17: vendor, contact, invoice, file and actor names of markup are TEXT on both pages;
// * the reports' words, print header and CSV name always name the period of the rows shown (a period picked is read);
// * a database without the reports' functions yet (release B part 2a on its own, or 2b rolled back alone): the vendor
//   list shows the facts and says the sums come later, a report says it is not in the database yet;
// * The Books (accounting.html): the QuickBooks ref typed beside "Mark entered" survives the page's redraw.
// Made-up people and data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as common2 from "../site/js/common2.js";
import { makeDom, scan, EVIL } from "./console/console-page-dom.mjs";
import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import { clearPeople } from "../site/js/repo/people.js";

const skip = !available && "the demo database (tools/fake) is not here";
const read = (rel) => readFileSync(new URL("../site/" + rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const AMOUNT = /\$\s?\d/;
const LINK = "<a href=//evil.example>x</a>";
const NEW = ["js/pages/books-vendors.js", "js/pages/books-reports.js", "js/repo/vendors.js", "js/repo/books-reports.js", "js/map/vendors.js", "js/map/books-reports.js"];

globalThis.Node = class { static [Symbol.hasInstance](x) { return !!x && typeof x.nodeType === "number"; } };
globalThis.window = { DCR2: common2.DCR2, addEventListener() {}, removeEventListener() {}, matchMedia: null, __VD_TEST__: true, __RP_TEST__: true, __AC_TEST__: true };
globalThis.document = makeDom("<!doctype html><html><head></head><body><div id=\"vdBody\"></div><div id=\"rpBody\"></div></body></html>");
const tick = () => new Promise((r) => setTimeout(r, 5));
async function until(fn, ms) {
  const end = Date.now() + (ms || 3000);
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error("timed out"); await tick(); }
}
const vpage = await import("../site/js/pages/books-vendors.js");
const rpage = await import("../site/js/pages/books-reports.js");
const nav = await import("../site/js/pages/books-nav.js");
const vrepo = await import("../site/js/repo/vendors.js");
const rrepo = await import("../site/js/repo/books-reports.js");
const apage = await import("../site/js/pages/accounting.js");
const rmap = await import("../site/js/map/books-reports.js");

/** As `key`: the client over the engine, and the profile the pages are given. A counter of what was asked. */
async function as(e, key) {
  const p = await person(key);
  const row = e.rows.profiles.find((x) => x.id === p.id);
  const c = clientAs(e, p.id);
  const asked = [];
  const from = c.from, rpc = c.rpc;
  c.from = (t) => { asked.push(t); return from(t); };
  c.rpc = (n, a) => { asked.push("rpc:" + n); return rpc(n, a); };
  useClient(c);
  clearPeople();
  return { me: { id: p.id, name: p.name, role: p.role, active: true, can_see_financials: p.role === "admin" || !!row.can_see_financials,
    can_see_prices: p.role === "admin" || !!row.can_see_prices, can_approve_payments: !!row.can_approve_payments }, asked };
}
function sheet() { return document.getElementById("bhSheet"); }

/* ── the pages' own rules, read from the source ── */

test("books-vendors.html / books-reports.html: the standard policy word for word, their module, the Books' look, the top bar, no inline script", () => {
  const csp = (x) => (/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(x) || [])[1];
  const acc = read("accounting.html");
  for (const [page, js, root] of [["books-vendors.html", "js/pages/books-vendors.js", "vdRoot"], ["books-reports.html", "js/pages/books-reports.js", "rpRoot"]]) {
    const h = read(page);
    assert.equal(csp(h), csp(acc), page + ": the same policy");
    assert.ok(h.includes('<script type="module" src="' + js + '"></script>') && h.includes('id="dcr2Topbar"') && h.includes('<main class="ac" id="' + root + '">'), page);
    assert.ok(h.includes('<link rel="stylesheet" href="css/books.css" />'), page + ": the Books' look");
    assert.ok(!/<script>(?!\s*<\/script>)/.test(h.replace(/<script[^>]*src=[^>]*><\/script>/g, "")), page + ": no inline script");
  }
  const sw = read("sw.js");
  const shell = JSON.parse("[" + /const SHELL = \[([\s\S]*?)\];/.exec(sw)[1].replace(/\/\/[^\n]*/g, "").replace(/,\s*$/, "") + "]");
  for (const f of ["books-vendors.html", "books-reports.html"].concat(NEW)) assert.ok(!shell.includes(f), f + " is not precached (S13)");
  const css = read("css/books.css");
  for (const rule of [".vd-row {", ".rp-wrap {", ".rp-scroll {", "#vdRoot.ac, #rpRoot.ac { max-width: none; padding: 0; }", ".vd-row, .rp-t tr { break-inside: avoid;"]) {
    assert.ok(css.includes(rule) || css.includes(rule.replace(" {", ",")), rule);
  }
});

test("S1 / S3 / S4: no approve call; the vendor list refuses without financials and the reports without financials AND prices - before any read", () => {
  // (the money history's WORDS name the kinds bill_approved / bill_unapproved: only a call counts)
  for (const f of NEW) assert.ok(!/["']approve_bill["']|["']unapprove_bill["']|\.approve\(|setPayMethod|set_bill_pay_method/.test(code(read(f))), f + ": approves nothing");
  const vp = code(read("js/pages/books-vendors.js"));
  assert.match(vp, /if \(!seesBooks\(me\)\) \{[^]*?location\.replace\("dashboard\.html"\);\s*return;\s*\}[^]*?await load\(\);/);
  assert.match(code(read("js/repo/vendors.js")), /export async function loadVendors\(me\) \{\s*if \(!seesBooks\(me\)\) throw noBooks\(\);/);
  const rp = code(read("js/pages/books-reports.js"));
  const refuse = rp.indexOf("if (!repo.seesReports(me)) {"), first = rp.indexOf("await run();", refuse), render = rp.indexOf("render();", refuse);
  assert.ok(refuse > 0 && first > refuse && render > refuse, "refused before anything is drawn or read");
  assert.match(rp, /location\.replace\(books \? "accounting\.html" : "dashboard\.html"\);\s*return;/);
  const rr = code(read("js/repo/books-reports.js"));
  for (const fn of ["apAging", "vendorBalances", "worksheet1099", "paymentsByMonth", "paymentLines", "approvalLog", "moneyHistory"]) {
    assert.match(rr, new RegExp("export async function " + fn + "\\(me[^)]*\\) \\{\\s*if \\(!seesReports\\(me\\)\\) throw noReports\\(\\);"), fn + " refuses first");
  }
  assert.match(rr, /return seesBooks\(me\) && !!me && \(me\.role === "admin" \|\| !!me\.can_see_prices\);/);
  assert.match(rp, /'<p class="ac-note rp-deferred rg-noprint" id="rpDeferred">' \+ h\(DEFERRED\) \+ "<\/p>"/, "AR aging and job profit: one line");
});

test("S17: every innerHTML of the new pages is built from escaped words (h) or the pages' own builders", () => {
  for (const f of ["js/pages/books-vendors.js", "js/pages/books-reports.js"]) {
    const s = code(read(f));
    for (const m of s.matchAll(/\.innerHTML = ([^;]+);/g)) {
      const x = m[1].trim();
      assert.ok(/^"[^"]*"$|^'[^']*'$|^\w+Html\([^)]*\)$|^listHtml\(shown\(\), state\.d\.today\)$|^bodyHtml\((?:state\.d)?\)$|^outHtml\(\)$|^'[^']*' \+ h\([^;]*\) \+ (['"])[^'"]*\1$/.test(x), f + ": innerHTML = " + x.slice(0, 120));
    }
    assert.ok(!/document\.write|insertAdjacentHTML|outerHTML =/.test(s), f + ": no other way in");
  }
});

/* ── driven over the demo database ── */

test("Vendors as the accountant: the database's sums, the facts and colours, the 1099 worksheet with the year's threshold; a typed threshold is sent for that view only", { skip }, async () => {
  const e = await freshEngine();
  const { me } = await as(e, "accountant");
  vpage._test.state.me = me;
  await vpage._test.load();
  const body = document.getElementById("vdBody");
  await until(() => body.querySelector("#vd1099Table"));
  assert.ok(body.querySelectorAll(".vd-row").length >= 10, "a line per vendor");
  assert.ok(AMOUNT.test(body.textContent), "amounts with the prices switch");
  assert.ok(body.querySelector(".vd-f.expired") && body.querySelector(".vd-f.soon") && body.querySelector(".vd-f.missing"), "red, gold and a missing W-9");
  const y = new Date().getFullYear();
  const words = body.querySelector("#vd1099Words").textContent;
  assert.match(words, new RegExp("\\$" + (y <= 2025 ? "600" : "2,000") + " is the default for " + y + " — confirm it with the CPA\\."));
  assert.match(words, /never saved/);
  // a typed threshold: sent as p_threshold, nothing stored
  const sent = [];
  const c = (await import("../site/js/repo/_db.js")).db;
  const cl = await c();
  const rpc = cl.rpc;
  cl.rpc = (n, a) => { sent.push([n, a]); return rpc(n, a); };
  body.querySelector("#vdThreshold").value = "1,000";
  body.querySelector("#vd1099Go").click();
  await until(() => sent.some((x) => x[0] === "books_1099") && body.querySelector("#vd1099Words") && /\$1,000 for this view only/.test(body.querySelector("#vd1099Words").textContent));
  assert.deepEqual(sent.find((x) => x[0] === "books_1099")[1], { p_year: y, p_threshold: 1000 });
  cl.rpc = rpc;
  // the filters
  body.querySelector('[data-show="coi"]').click();
  const shown = body.querySelectorAll(".vd-row").length;
  assert.ok(shown >= 1 && shown < 10, "insurance to renew: a few");
  body.querySelector('[data-show=""]').click();
});

test("S4: the demo approver (financials, no prices) sees the vendors' facts and NOT one amount; no 1099 worksheet; the reports refuse before asking anything", { skip }, async () => {
  const e = await freshEngine();
  const { me, asked } = await as(e, "approver");
  vpage._test.state.me = me;
  vpage._test.state.w = null;
  await vpage._test.load();
  const body = document.getElementById("vdBody");
  assert.ok(body.querySelectorAll(".vd-row").length >= 5);
  assert.ok(!AMOUNT.test(body.textContent), "no amount: " + (body.textContent.match(/.{20}\$\s?\d.{10}/) || [""])[0]);
  assert.ok(!body.querySelector("#vd1099Table") && /needs the prices switch/.test(body.querySelector("#vd1099").textContent));
  assert.ok(!body.querySelector('[data-show="owed"]'), "no 'We owe them' filter");
  assert.ok(!asked.includes("rpc:books_vendor_balances") && !asked.includes("rpc:books_1099"), "the priced functions are not even asked: " + asked.join(","));
  // a manager with financials is a money editor (app.can_edit('money')): the details are offered, still with no amount
  assert.ok(body.querySelector("[data-details]"), "Details for a money editor");
  // a lead: no Details anywhere (the page refuses a lead before reading, so only the markup is checked here)
  vpage._test.state.me = Object.assign({}, me, { role: "lead", can_see_financials: true });
  vpage._test.render();
  assert.ok(!body.querySelector("[data-details]"), "no write control without the money switch");
  vpage._test.state.me = me;
  asked.length = 0;
  await assert.rejects(rrepo.apAging(me, null), (x) => x.code === "42501");
  await assert.rejects(rrepo.moneyHistory(me, "2026-01-01", "2026-12-31"), (x) => x.code === "42501");
  await assert.rejects(rrepo.approvalLog(me, "2026-01-01", "2026-12-31"), (x) => x.code === "42501");
  assert.deepEqual(asked, [], "nothing asked");
  // a manager without financials: the vendor list refuses before any read
  const m = await as(e, "manager");
  await assert.rejects(vrepo.loadVendors(m.me), (x) => x.code === "42501");
  assert.deepEqual(m.asked, []);
});

test("the vendor details: saved through the sheet (an upsert at the version shown); someone else's save meanwhile shows theirs (PT409)", { skip }, async () => {
  const e = await freshEngine();
  const { me } = await as(e, "accountant");
  vpage._test.state.me = me;
  vpage._test.state.w = null;
  await vpage._test.load();
  const body = document.getElementById("vdBody");
  const v = vpage._test.state.d.vendors.find((x) => x.linked && x.profileVersion === null);
  const btn = body.querySelectorAll("[data-details]").find((b) => b.getAttribute("data-details") === v.key);
  btn.click();
  let s = sheet();
  await until(() => s.querySelector("#vdFSave"));
  s.querySelector("#vdF1099").checked = true;
  s.querySelector("#vdFW9").value = "2026-10-01";
  s.querySelector("#vdFLegal").value = "Madeup Legal LLC";
  s.querySelector("#vdFSave").click();
  await until(() => e.rows.vendor_profiles.some((p) => p.contact_id === v.contactId));
  const row = e.rows.vendor_profiles.find((p) => p.contact_id === v.contactId);
  assert.deepEqual([row.tax_1099, row.w9_received_on, row.legal_name, row.version], [true, "2026-10-01", "Madeup Legal LLC", 1]);
  await until(() => sheet().hidden);
  // someone else saves meanwhile: this page still holds version 1
  await until(() => vpage._test.state.d.vendors.find((x) => x.key === v.key).profileVersion === 1);
  const admin = await person("admin");
  e.update({ uid: admin.id }, "vendor_profiles", { license_number: "C-0000777" }, { filters: [{ col: "contact_id", op: "eq", val: v.contactId, neg: false }], orders: [], foreignLimits: {} });
  await as(e, "accountant");
  body.querySelectorAll("[data-details]").find((b) => b.getAttribute("data-details") === v.key).click();
  s = sheet();
  await until(() => s.querySelector("#vdFSave"));
  s.querySelector("#vdFNotes").value = "mine";
  s.querySelector("#vdFSave").click();
  await until(() => /Someone else changed these details meanwhile/.test(s.querySelector("#vdFMsg").textContent));
  assert.equal(s.querySelector("#vdFLic").value, "C-0000777", "theirs is shown");
  assert.equal(e.rows.vendor_profiles.find((p) => p.contact_id === v.contactId).notes, null, "mine was not written over theirs");
  nav.closeSheet();
});

test("Reports as the accountant: each report reads the database's own function or log and shows a table; names of markup are text (the CSVs: p8-reports-map)", { skip }, async () => {
  const e = await freshEngine();
  const { me, asked } = await as(e, "accountant");
  const S = rpage._test.state;
  S.me = me;
  const today = new Date().toISOString().slice(0, 10);
  S.today = today; S.asOf = today; S.from = today.slice(0, 4) + "-01-01"; S.to = today; S.year = Number(today.slice(0, 4)); S.threshold = null;
  for (const [id, fn] of [["aging", "rpc:books_ap_aging"], ["vendors", "rpc:books_vendor_balances"], ["1099", "rpc:books_1099"], ["months", "rpc:books_payments_by_month"],
    ["approvals", "money_messages"], ["history", "money_events"]]) {
    S.report = id; S.rows = null; S.error = "";
    asked.length = 0;
    rpage._test.render();
    await rpage._test.run();
    assert.ok(asked.includes(fn), id + " asked " + fn + ": " + asked.join(","));
    assert.equal(S.error, "", id + ": " + S.error);
    const out = document.getElementById("rpOut");
    assert.ok(out.querySelector("#rpTable"), id + ": a table");
    assert.deepEqual(scan(out), [], id);
  }
  // S17: the history and the approval log show names as text
  e.rows.bills[0].vendor_name = EVIL;
  e.rows.money_messages.forEach((m) => { m.to_name = LINK; });
  e.rows.profiles.find((p) => p.id === me.id).full_name = EVIL;
  for (const id of ["history", "approvals", "aging"]) {
    S.report = id; S.rows = null;
    rpage._test.render();
    await rpage._test.run();
    const out = document.getElementById("rpOut");
    assert.deepEqual(scan(out), [], id + ": no element from the data");
    assert.ok(!out.querySelectorAll("a").length, id + ": no link from the data");
  }
  S.report = "history"; S.rows = null;
  rpage._test.render();
  await rpage._test.run();
  assert.ok(document.getElementById("rpOut").textContent.includes(EVIL), "the actor's name shown as it is");
});

test("Reports: a period picked is read at once - the rows, their sentence, the print header and the CSV's name all name ONE period; days typed and not shown yet name none", { skip }, async () => {
  const e = await freshEngine();
  const { me } = await as(e, "accountant");
  const S = rpage._test.state;
  S.me = me;
  const today = new Date().toISOString().slice(0, 10);
  const ly = rmap.periodOf("lastyear", today), p30 = rmap.periodOf("30", today);
  S.today = today; S.asOf = today; S.preset = "lastyear"; S.from = ly.from; S.to = ly.to; S.year = null; S.threshold = null; S.group = ""; S.q = "";
  if (!document.getElementById("rpPrintHead")) { const ph = document.createElement("div"); ph.id = "rpPrintHead"; document.body.appendChild(ph); }
  window.print = () => {};
  // the CSV's link: its file name (the small DOM's <a> has no href to set)
  const names = [];
  const make = URL.createObjectURL, mk = document.createElement, add = document.body.appendChild;
  URL.createObjectURL = () => "blob:made-up";
  document.createElement = (tag) => (tag === "a" ? { href: "", download: "", click() { names.push(this.download); }, remove() {}, stub: true } : mk.call(document, tag));
  document.body.appendChild = function (n) { return n && n.stub ? n : add.call(this, n); };
  try {
    for (const id of ["approvals", "history"]) {
      S.report = id; S.rows = null; S.shown = null; S.error = ""; S.preset = "lastyear"; S.from = ly.from; S.to = ly.to;
      rpage._test.render();
      await rpage._test.run();
      // the 30 days picked in Period, and nothing else pressed
      const sel = document.getElementById("rpPreset");
      sel.value = "30";
      sel.dispatchEvent({ type: "change" });
      await until(() => !S.busy && S.rows && S.shown && S.shown.from === p30.from);
      const words = rmap.periodWords(p30.from, p30.to);
      const out = document.getElementById("rpOut").textContent;
      assert.ok(out.includes(words), id + ": the rows' sentence names the period picked: " + out.slice(0, 120));
      document.getElementById("rpPrint").click();
      const head = document.getElementById("rpPrintHead").textContent;
      assert.ok(head.includes(words) && !head.includes(rmap.periodWords(ly.from, ly.to)), id + ": the print header: " + head);
      names.length = 0;
      if (id === "history") assert.ok(!document.getElementById("rpCsv").disabled, "the demo's last 30 days have money changes to save");
      if (!document.getElementById("rpCsv").disabled) {
        document.getElementById("rpCsv").click();
        assert.ok(names.length === 1 && names[0].includes(p30.from + "-to-" + p30.to), id + ": the CSV's name: " + names.join(","));
      }
      // days typed in From / To, not shown yet: the shown rows keep naming the period they were read for
      const from = document.getElementById("rpFrom");
      from.value = ly.from;
      from.dispatchEvent({ type: "change" });
      if (id === "history") { const g = document.getElementById("rpGroup"); g.value = g.querySelectorAll("option")[1].getAttribute("value"); g.dispatchEvent({ type: "change" }); }
      assert.ok(document.getElementById("rpOut").textContent.includes(words), id + ": still the period read");
      document.getElementById("rpPrint").click();
      assert.ok(document.getElementById("rpPrintHead").textContent.includes(words), id + ": the print header still names the period read");
      S.group = "";
    }
  } finally {
    URL.createObjectURL = make;
    document.createElement = mk;
    delete document.body.appendChild;
    if (document.body.appendChild !== add) document.body.appendChild = add;
  }
});

/* As `key` over a database WITHOUT the reports' four functions (20261030000500 not pushed yet, or rolled back alone):
   PostgREST answers PGRST202 for each. */
async function asBeforeReports(e, key) {
  const p = await person(key);
  const row = e.rows.profiles.find((x) => x.id === p.id);
  const c = clientAs(e, p.id);
  const asked = [];
  const from = c.from, rpc = c.rpc;
  c.from = (t) => { asked.push(t); return from(t); };
  c.rpc = (n, a) => {
    asked.push("rpc:" + n);
    if (/^books_(ap_aging|vendor_balances|1099|payments_by_month)$/.test(n)) {
      return Promise.resolve({ data: null, status: 404, error: { code: "PGRST202", message: "Could not find the function public." + n + " in the schema cache", details: "", hint: null } });
    }
    return rpc(n, a);
  };
  useClient(c);
  clearPeople();
  return { me: { id: p.id, name: p.name, role: p.role, active: true, can_see_financials: p.role === "admin" || !!row.can_see_financials,
    can_see_prices: p.role === "admin" || !!row.can_see_prices, can_approve_payments: !!row.can_approve_payments }, asked };
}

test("release B part 2a on its own (no reports' functions in the database yet): the vendor list shows the facts and says the sums come later; a report says it is not there yet; the approval log works", { skip }, async () => {
  const e = await freshEngine();
  const { me, asked } = await asBeforeReports(e, "accountant");
  assert.ok(me.can_see_prices, "the accountant sees prices: the sums are asked for");
  const V = vpage._test.state;
  V.me = me; V.w = null; V.wError = ""; V.wBusy = false; V.show = ""; V.q = "";
  await vpage._test.load();
  const body = document.getElementById("vdBody");
  assert.ok(V.d && V.d.noSums && !V.d.prices, "the facts only");
  assert.ok(body.querySelectorAll(".vd-row").length >= 5, "a line per vendor");
  assert.ok(!AMOUNT.test(body.textContent), "no amount was read, none is shown");
  assert.match(body.querySelector("#vdNoSums").textContent, /come with the next database update/);
  assert.ok(!/do not match/.test(body.textContent), "never \"the website and the database do not match\"");
  assert.ok(asked.includes("rpc:books_vendor_balances") && !asked.includes("rpc:books_1099"), "the worksheet is not asked: " + asked.join(","));
  assert.match(body.querySelector("#vd1099").textContent, /come with the next database update/);
  const S = rpage._test.state;
  S.me = me;
  const today = new Date().toISOString().slice(0, 10);
  S.today = today; S.asOf = today; S.from = today.slice(0, 4) + "-01-01"; S.to = today; S.year = Number(today.slice(0, 4)); S.threshold = null; S.group = ""; S.q = "";
  for (const id of ["aging", "vendors", "1099", "months"]) {
    S.report = id; S.rows = null; S.shown = null; S.error = "";
    rpage._test.render();
    await rpage._test.run();
    assert.equal(S.error, rrepo.NOT_YET, id);
    const out = document.getElementById("rpOut").textContent;
    assert.ok(/not in the database yet/.test(out) && !/do not match/.test(out), id + ": " + out);
  }
  for (const id of ["approvals", "history"]) {
    S.report = id; S.rows = null; S.shown = null; S.error = "";
    rpage._test.render();
    await rpage._test.run();
    assert.equal(S.error, "", id + " works without them");
    assert.ok(document.getElementById("rpOut").querySelector("#rpTable"), id + ": a table");
  }
  // any other refusal is still said as it is
  assert.equal(rrepo.reportsMissing({ code: "42501" }), false);
  assert.equal(rrepo.reportsMissing({ code: "PGRST202" }), true);
  assert.equal(rrepo.reportsMissing({ code: "42883" }), true);
});

test("The Books: the QuickBooks ref typed beside \"Mark entered\" survives the page's redraw (back from the QuickBooks tab, the 30 s poll) and is the one recorded", { skip }, async () => {
  const e = await freshEngine();
  const { me } = await as(e, "accountant");
  if (!document.getElementById("acBody")) {
    const host = document.createElement("div");
    host.innerHTML = '<div class="ac-cards" id="acCards"></div><div class="ck-queue" id="ckQueue" hidden></div><div id="acBody"></div>';
    document.body.appendChild(host);
  }
  const A = apage._test.state;
  A.me = me; A.picked = {}; A.ref = ""; A.refInv = ""; A.openCheck = null;
  await apage._test.load();
  assert.ok(A.d && A.d.ready.length > 0, "bills ready to enter");
  const bill = A.d.ready[0];
  let ref = document.getElementById("acRef");
  ref.focus();
  ref.value = "QB-7781";
  ref.dispatchEvent({ type: "input" });
  document.querySelectorAll("[data-pick]").find((cb) => cb.getAttribute("data-pick") === String(bill.id)).click();
  assert.equal(document.getElementById("acMark").disabled, false);
  // she comes back from QuickBooks: the page reads everything again and draws it again
  await apage._test.load();
  ref = document.getElementById("acRef");
  assert.equal(ref.value, "QB-7781", "the ref typed is drawn again");
  assert.equal(document.activeElement && document.activeElement.id, "acRef", "and keeps the focus");
  assert.equal(document.getElementById("acMark").disabled, false, "the pick too");
  common2.DCR2.confirm = async () => true;
  document.getElementById("acMark").click();
  await until(() => e.rows.bills.find((b) => b.id === bill.id).qbo_entered_at);
  await until(() => !A.busy && A.d && !A.d.ready.some((b) => b.id === bill.id));
  assert.equal(e.rows.bills.find((b) => b.id === bill.id).qbo_ref, "QB-7781", "marked with the ref she typed");
  assert.equal(A.ref, "", "the ref is done with: never carried into the next batch");
  assert.equal(document.getElementById("acRef") ? document.getElementById("acRef").value : "", "");
  // a ref put in the box by a script (no input event) is read at the click, as before
  if (A.d.ready.length) {
    const b2 = A.d.ready[0];
    document.getElementById("acRef").value = "QB batch 18";
    document.querySelectorAll("[data-pick]").find((cb) => cb.getAttribute("data-pick") === String(b2.id)).click();
    document.getElementById("acMark").click();
    await until(() => e.rows.bills.find((b) => b.id === b2.id).qbo_entered_at);
    assert.equal(e.rows.bills.find((b) => b.id === b2.id).qbo_ref, "QB batch 18");
  }
});

/* ── release B review fixes 2 ── */

test("Vendors: the 1099 worksheet's CSV is off while another year is read, and is named for the year its rows were read for; only the latest Show is drawn", { skip }, async () => {
  const e = await freshEngine();
  const { me } = await as(e, "accountant");
  const S = vpage._test.state;
  Object.assign(S, { me, year: null, threshold: null, w: null, wYear: null, wBusy: false, wError: "" });
  await vpage._test.load();
  const body = document.getElementById("vdBody");
  await until(() => !S.wBusy && body.querySelector("#vd1099Table"));
  const y = Number(body.querySelector("#vdYear").value);
  assert.ok(S.w.length > 0 && S.w.every((r) => r.year === y), "this year's rows");
  // the CSV's link: its file name (the small DOM's <a> has no href to set)
  const names = [];
  const make = URL.createObjectURL, mk = document.createElement, add = document.body.appendChild;
  URL.createObjectURL = () => "blob:made-up";
  document.createElement = (tag) => (tag === "a" ? { href: "", download: "", click() { names.push(this.download); }, remove() {}, stub: true } : mk.call(document, tag));
  document.body.appendChild = function (n) { return n && n.stub ? n : add.call(this, n); };
  // last year's read is held open
  const cl = await (await import("../site/js/repo/_db.js")).db();
  const rpc = cl.rpc;
  const held = [];
  cl.rpc = (n, a) => (n === "books_1099" && a && a.p_year === y - 1 ? new Promise((res) => { held.push(() => res(rpc(n, a))); }) : rpc(n, a));
  try {
    body.querySelector("#vdYear").value = String(y - 1);
    body.querySelector("#vd1099Go").click();
    await until(() => held.length === 1);
    assert.ok(S.wBusy && /Working it out/.test(body.querySelector("#vd1099").textContent));
    assert.equal(body.querySelector("#vd1099Csv").disabled, true, "the CSV is off while the read runs");
    body.querySelector("#vd1099Csv").click();
    assert.deepEqual(names, [], "nothing downloads");
    // she picks this year again before last year's answer comes: this year's is drawn, and last year's, late, is not
    body.querySelector("#vdYear").value = String(y);
    body.querySelector("#vd1099Go").click();
    await until(() => !S.wBusy && body.querySelector("#vd1099Table"));
    held.forEach((go) => go());
    for (let i = 0; i < 10; i++) await tick();
    assert.ok(S.wYear === y && S.w.every((r) => r.year === y), "the rows are the latest Show's: " + S.wYear);
    assert.match(body.querySelector(".rp-sum").textContent, new RegExp("for " + y));
    body.querySelector("#vd1099Csv").click();
    assert.equal(names.length, 1);
    assert.ok(names[0].startsWith("dcr-1099-" + y + "-"), "named for the rows' year: " + names[0]);
    // last year, read to the end: its rows, its name
    cl.rpc = rpc;
    body.querySelector("#vdYear").value = String(y - 1);
    body.querySelector("#vd1099Go").click();
    await until(() => !S.wBusy && S.wYear === y - 1);
    if (S.w.length) {
      body.querySelector("#vd1099Csv").click();
      assert.ok(names[1].startsWith("dcr-1099-" + (y - 1) + "-") && S.w.every((r) => r.year === y - 1), names.join(","));
    } else {
      assert.equal(body.querySelector("#vd1099Csv").disabled, true);
      assert.match(body.querySelector("#vd1099").textContent, new RegExp("Nobody was paid in " + (y - 1)));
    }
  } finally {
    cl.rpc = rpc;
    URL.createObjectURL = make;
    document.createElement = mk;
    delete document.body.appendChild;
    if (document.body.appendChild !== add) document.body.appendChild = add;
    Object.assign(S, { year: null, threshold: null, w: null, wYear: null, wBusy: false, wError: "" });
  }
});
