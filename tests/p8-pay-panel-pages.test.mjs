// The Books program, release A (P3): the payment panel (site/js/pages/pay-panel.js, extracted from accounting.js with
// the same element ids) and the check register's page (books-checks.html, js/pages/books-checks.js) - read from their
// source, the panel's markup drawn in node, and the payments it records over the demo database (tools/fake/p8-register.js:
// the check number used once, the date bounds, the next number). tools/schema-check-p8-register.mjs runs the same repos
// against the REAL migration (20261030000300_check_register) in PGlite. Made-up people and jobs only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { available, loadFake, freshEngine, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import { clearPeople } from "../site/js/repo/people.js";
import * as books from "../site/js/repo/books.js";
import * as checks from "../site/js/repo/checks.js";
import { checkPanel, resetPanel, FILES_LABEL } from "../site/js/pages/pay-panel.js";
import { clashText } from "../site/js/map/checks.js";
import { payDateBounds } from "../site/js/map/books.js";

const skip = !available && "the demo database (tools/fake) is not here";
const read = (rel) => readFileSync(new URL("../site/" + rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const AMOUNT = /\$\s?\d/;
const EVIL = "<img src=x onerror=alert(1)>";

/* ── the page's own rules, read from the source ── */

test("the panel is extracted with the SAME ids (the p5b tests and walks keep working); accounting.js draws it and uses the viewer through it", () => {
  const pp = code(read("js/pages/pay-panel.js"));
  for (const id of ["ckPanel", "ckPayee", "ckAmount", "ckNumber", "ckRefLab", "ckRefSub", "ckHow", "ckHowFixed", "ckMemo", "ckWrite", "ckClose", "ckMsg", "ckViewer", "ckDate", "ckFiles"]) {
    assert.ok(pp.includes('id="' + id + '"'), id);
  }
  assert.ok(pp.includes('data-doc="') && pp.includes('data-how="'));
  const acc = code(read("js/pages/accounting.js"));
  assert.match(acc, /import \* as panel from "\.\/pay-panel\.js";/);
  assert.match(acc, /panel\.checkPanel\(b, can, which, \{ detail: state\.detail, me: state\.me, today: state\.d && state\.d\.today \}\)/);
  assert.match(acc, /panel\.wirePanel\(box, \{/);
  assert.match(acc, /panel\.snapshot\(\);/, "typed values survive a redraw");
  assert.ok(!/function doWriteCheck|function paintMethod|function chosenMethod|filesRepo\.signedUrl/.test(acc), "the panel's code lives in pay-panel.js only");
  assert.match(pp, /import \{ showIn, openTab, isImage \} from "\.\/file-viewer\.js";/, "the bill's paperwork through js/pages/file-viewer.js");
  assert.ok(!/approve_bill|\.approve\(|setPayMethod/.test(pp + code(read("js/pages/books-checks.js")) + code(read("js/repo/checks.js"))), "nothing here approves");
});

test("recording: the date is sent as paidDate; the payment's files go into the queue only AFTER the payment row exists (kind payment, its bill and the payment)", () => {
  const pp = code(read("js/pages/pay-panel.js"));
  assert.match(pp, /books\.recordPayment\(b, \{ amount: allowed\.amount, method, checkNumber: number, payee: payee \|\| b\.payee, memo: memo \|\| b\.memo, paidDate \}\)/);
  const at = pp.indexOf("books.recordPayment(");
  const q = pp.indexOf('kind: "payment", billId: b.id, paymentId: pay.id');
  assert.ok(at > 0 && q > at, "queued after the row");
  assert.match(pp, /queueAll\(files, uploads\.enqueue, \(\) => \(\{ projectId: b\.projectId, kind: "payment", billId: b\.id, paymentId: pay\.id \}\)\)/);
  assert.match(pp, /mountFileDrop\(host, \{ label: FILES_LABEL, onChange: \(list\) => \{ P\.files = list; \}, pasteOn: panel,/, "paste heard on the panel, never on document");
  assert.ok(!/document\.addEventListener\("paste"/.test(pp));
  assert.match(pp, /const clash = clashText\(e\);/, "a reused number: the database's own words in the field");
  assert.match(pp, /checks\.nextCheckNumber\(\)/);
  assert.match(pp, /checks\.checkNumberInfo\(typed, null\)/);
  assert.equal(FILES_LABEL, "Add a photo of the check, a scan, or paste a screenshot of the transfer");
});

test("CSS: the Books' look moved out of accounting.html into css/books.css, shared by the register; both pages carry the standard policy", () => {
  const acc = read("accounting.html"), reg = read("books-checks.html"), css = read("css/books.css");
  assert.ok(!/<style>/.test(acc) && acc.includes('<link rel="stylesheet" href="css/books.css" />'));
  assert.ok(reg.includes('<link rel="stylesheet" href="css/books.css" />') && reg.includes('<script type="module" src="js/pages/books-checks.js"></script>'));
  const csp = (h) => (/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(h) || [])[1];
  assert.equal(csp(reg), csp(acc), "the same policy word for word");
  for (const rule of [".ac-t th, .ac-t td { white-space: normal;", ".ck-panel {", ".bk-st {", ".rg-t td.st", "@media print"]) assert.ok(css.includes(rule), rule);
  assert.ok(acc.includes('<a href="books-checks.html">Checks</a>') && reg.includes('<a href="books-checks.html" aria-current="page">Checks</a>'));
  const sw = read("sw.js");
  assert.ok(!sw.includes('"books-checks.html"') && !sw.includes("js/pages/books-checks.js") && !sw.includes("js/pages/pay-panel.js") && !sw.includes("js/repo/checks.js"),
    "money pages stay out of the offline cache");
});

test("the register page: refused before anything is read; write controls only for money editors; Void only while the switch is on; the switch an admin's", () => {
  const js = code(read("js/pages/books-checks.js"));
  assert.match(js, /if \(!seesBooks\(me\)\) \{[^]*?location\.replace\("dashboard\.html"\);\s*return;/);
  const start = js.slice(js.indexOf("async function start()"));
  assert.ok(start.indexOf("seesBooks(me)") < start.indexOf("await load()"), "the gate comes first");
  assert.match(js, /if \(c\.money\) \{\s*const b = /, "the line's buttons only for money editors");
  assert.match(js, /if \(c\.admin && state\.raw\.voidReady\)/, "the switch only for an admin");
  assert.match(js, /rowActions\(r, \{ voidEnabled: state\.d\.voidEnabled \}\)/);
  assert.match(code(read("js/map/checks.js")), /void: !!x\.voidEnabled && !cleared,/);
  assert.ok(js.includes("only when every office PC runs DCR Desktop 2 2.25 or later") && js.includes("count a voided check as paid"), "the phase-4 words");
  assert.match(js, /toCsv\(rows, checkColumns\(prices\(\)\)\)/, "the CSV's amount only with prices");
  assert.match(js, /\(prices\(\) \? '<th class="num hide-sm c-amt">Amount<\/th>' : ""\)/, "the amount column only with prices");
  assert.match(code(read("js/repo/checks.js")), /const cols = REGISTER_COLS \+ \(prices \? ", " \+ REGISTER_AMOUNT_COLS : ""\);/, "no amount even read without prices");
  // every database word through esc() or textContent
  assert.ok(!/innerHTML = [^;]*\b(r|row|x)\.(payee|number|voidReason|jobs)/.test(js));
});

/* ── the panel's markup (drawn in node) ── */

const entry = { id: 5, payee: EVIL, owed: 980, alreadyPaid: 300, approvedFor: 1280, partial: true, allowed: ["check"], memo: "A900 · Inv " + EVIL, payMethod: "check", projectId: 7,
  vendor: "Made-up Framing LLC", payeeNote: "", pile: "check_desk" };
const detail = { bill: { id: 5 }, quote: { kind: "Quote", vendor: "Made-up Framing LLC", amount: 1500, status: "accepted" },
  files: [{ name: EVIL + ".pdf", cloud: true, storagePath: "f/7/receipts/x/a.pdf", primary: true, mime: "application/pdf" }, { name: "check.jpg", cloud: true, storagePath: "f/7/receipts/y/c.jpg", paymentId: 9, mime: "image/jpeg" }],
  payments: [{ id: 9, method: "check", checkNumber: "1043", amount: 300, paidDate: "2026-10-01", live: true, collectable: true, toldAt: null },
    { id: 8, method: "check", checkNumber: "1041", amount: 250, paidDate: "2026-09-20", live: false, voided: true, collectable: true }] };
const ACCOUNTANT = { role: "accountant", can_see_prices: true, can_see_financials: true };
const APPROVER = { role: "manager", can_see_prices: false, can_see_financials: true, can_approve_payments: true };

test("checkPanel: the date (today, -400 / +31), the payment's files for money editors, every database word escaped", () => {
  resetPanel();
  const s = checkPanel(entry, { pay: true }, "pay", { detail, me: ACCOUNTANT, today: "2026-10-28" });
  assert.match(s, /<input id="ckDate" type="date" value="2026-10-28" min="2025-09-23" max="2026-11-28">/);
  assert.ok(s.includes('id="ckFiles"') && s.includes('id="ckWrite"'));
  assert.ok(!s.includes("<img") && !/onerror=alert/.test(s.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, "")), "escaped");
  assert.match(s, /\$980\.00|980\.00/, "the amount owed, with prices");
  assert.match(s, /\$300\.00 already paid of \$1,280\.00 approved/);
  assert.match(s, /· void/, "a voided payment is said");
  assert.match(s, /\$300\.00 paid · \$980\.00 still owed/, "the void counts in no sum");
  const ro = checkPanel(entry, { pay: false }, "pay", { detail, me: ACCOUNTANT, today: "2026-10-28" });
  assert.ok(!ro.includes('id="ckFiles"') && !ro.includes('id="ckWrite"'), "no write control without the money switch");
  const sent = checkPanel(Object.assign({}, entry, { allowed: ["ach", "wire"], pile: "transfer_card", payMethod: "transfer" }), { pay: true }, "send", { detail, me: ACCOUNTANT, today: "2026-10-28" });
  assert.match(sent, /Date it was sent/);
  assert.ok(payDateBounds("2026-10-28").max === "2026-11-28");
});

test("checkPanel WITHOUT the prices switch (S4): no amount anywhere in the panel - typed from the bill, the confirm names none", () => {
  resetPanel();
  const s = checkPanel(entry, { pay: true }, "pay", { detail, me: APPROVER, today: "2026-10-28" });
  assert.ok(!AMOUNT.test(s), "no amount: " + (s.match(/.{30}\$\s?\d.{20}/) || [""])[0]);
  assert.ok(!/980|1,280|1280|300\.00|1,500/.test(s.replace(/1043|1041/g, "")), "no figure at all");
  assert.match(s, /<input id="ckAmount" class="big" inputmode="decimal" value="" placeholder="Type the amount">/);
  assert.match(s, /1 payment recorded/);
  const pp = code(read("js/pages/pay-panel.js"));
  assert.match(pp, /\(prices \? " for " \+ money\(amount\) : ""\)/, "the confirm question without the amount");
  assert.match(pp, /over && !prices \? "That is more than is still approved on this bill\." : allowed\.reason/, "the cap without its figure");
  const decide = checkPanel(entry, { pay: true }, "decide", { detail, me: APPROVER, today: "2026-10-28" });
  assert.ok(!AMOUNT.test(decide));
});

/* ── over the demo database ── */

let F, E;
async function setup() { F = await loadFake(); E = await freshEngine(new Date()); }
const uid = (key) => F.PEOPLE.find((p) => p.key === key).id;
function as(key) { useClient(clientAs(E, uid(key))); clearPeople(); }
async function refused(fn, code, re) {
  try { await fn(); } catch (e) { assert.equal(e.code, code, e.message); if (re) assert.match(e.message, re); return e; }
  assert.fail("expected " + code);
}
const bill = (desc) => E.rows.bills.find((b) => b.description === desc);
const shape = (b) => ({ id: b.id, projectId: b.project_id });
const today = () => F.companyDay(new Date());

test("the next number: the last recorded all-digit check + 1, past every number used or spoiled; a TEST- check never moves it", { skip }, async () => {
  await setup();
  as("accountant");
  const n = await checks.nextCheckNumber();
  assert.equal(n.next, "5309", "after #5308, the demo's last recorded check (#5310 was recorded earlier)");
  assert.deepEqual([n.last.number, n.last.payee], ["5308", "Kestrel Lumber Supply"]);
  const b = bill("Retainage per the contract") || bill("-10% retainage held until the final walk");
  await books.recordPayment(shape(b), { amount: 10, method: "check", checkNumber: "TEST-1", payee: "Rosewell Concrete" });
  assert.equal((await checks.nextCheckNumber()).next, "5309", "a smoke-test number never moves it");
  await books.recordPayment(shape(b), { amount: 10, method: "check", checkNumber: "5309", payee: "Rosewell Concrete" });
  assert.equal((await checks.nextCheckNumber()).next, "5311", "past #5310, already used");
  const info = await checks.checkNumberInfo("05306", null);
  assert.deepEqual([info.free, info.clash.number, info.clash.payee, info.next], [false, "5306", "Stonebrook Concrete", "5311"]);
  assert.equal((await checks.checkNumberInfo("5307", null)).clash.spoiled, true, "a spoiled blank");
  assert.equal((await checks.checkNumberInfo("9001", null)).free, true);
  as("manager");
  await refused(() => checks.nextCheckNumber(), "42501");
});

test("recording a check: the date written on it (paidDate) between today - 400 and today + 31; a number used once, its own sentence", { skip }, async () => {
  await setup();
  as("accountant");
  const b = bill("-10% retainage held until the final walk");
  const t = today();
  const ahead = payDateBounds(t).max;
  const p = await books.recordPayment(shape(b), { amount: 100, method: "check", checkNumber: "7001", payee: "Rosewell Concrete", paidDate: ahead });
  assert.equal(p.paidDate, ahead, "post-dated to 31 days ahead");
  await refused(() => books.recordPayment(shape(b), { amount: 100, method: "check", checkNumber: "7002", paidDate: addDays(ahead, 1) }), "22023",
    /at most 400 days back and 31 days ahead/);
  await refused(() => books.recordPayment(shape(b), { amount: 100, method: "check", checkNumber: "7002", paidDate: addDays(payDateBounds(t).min, -1) }), "22023");
  const e = await refused(() => books.recordPayment(shape(b), { amount: 100, method: "check", checkNumber: " 05306 ", payee: "Rosewell Concrete" }), "23505");
  assert.match(clashText(e), /^Check 5306 is already in the check register \(Stonebrook Concrete, [A-Z][a-z]{2} \d{1,2}, \d{4}\): a check number is used once/);
  await refused(() => books.recordPayment(shape(b), { amount: 100, method: "check", checkNumber: "5307" }), "23505", /a spoiled blank/);
  // one check may pay several bills (or parts) of the same payee on the same day - never another payee's
  await books.recordPayment(shape(b), { amount: 50, method: "check", checkNumber: "7003", payee: "Rosewell Concrete" });
  await books.recordPayment(shape(b), { amount: 50, method: "check", checkNumber: "7003", payee: "Rosewell Concrete" });
  const ash = E.rows.bills.find((x) => x.vendor_name === "Ashgrove Concrete" && x.approved_at);
  await refused(() => books.recordPayment(shape(ash), { amount: 10, method: "check", checkNumber: "7003", payee: "Ashgrove Concrete" }), "23505", /Rosewell Concrete/);
  const d = await books.loadDesk(meOf("accountant"));
  assert.ok(!d.checks.toTell.some((x) => x.checkNumber === "5306"), "a picked-up check is not to tell");
  assert.ok(d.checks.toTell.some((x) => x.checkNumber === "7003"), "a new check is");
});

function addDays(k, n) { const d = new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) + n)); return d.toISOString().slice(0, 10); }
function meOf(key) {
  const p = E.rows.profiles.find((x) => x.id === uid(key));
  const admin = p.role === "admin";
  return { id: p.id, name: p.full_name, role: p.role, active: p.active !== false, can_see_prices: admin || !!p.can_see_prices,
    can_see_financials: admin || !!p.can_see_financials, can_approve_payments: admin || !!p.can_approve_payments };
}
