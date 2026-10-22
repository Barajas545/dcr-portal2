// P5b The Books - the pages' own rules, read from their source: accounting.html (the accountant's desk), bill.html
// (the approval) and the home page's approvals card. The owner's standing rules: only an admin, or a manager with
// the approve switch, approves - an accountant NEVER; nobody without the financials switch sees an amount; Q13:
// QuickBooks is a MANUAL CSV hand-off (no QuickBooks call, no key, anywhere in the site).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("../site/", import.meta.url));
const site = (p) => readFileSync(join(SITE, p), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the two pages exist, load their module, and carry no inline script", () => {
  for (const [page, js] of [["accounting.html", "js/pages/accounting.js"], ["bill.html", "js/pages/bill.js"]]) {
    const h = site(page);
    assert.ok(h.includes('<script type="module" src="' + js + '"></script>'), page);
    assert.ok(!/<script>(?!\s*<\/script>)/.test(h.replace(/<script[^>]*src=[^>]*><\/script>/g, "")), page + ": an inline script");
    assert.ok(h.includes('id="dcr2Topbar"'), page + ": the Portal 2 top bar");
  }
});

test("The Books never approves: no approve call, no approve button; approving is the bill page's, for approvers only", () => {
  const acc = code(site("js/pages/accounting.js"));
  assert.ok(!/\.approve\(|approve_bill|setPayMethod|set_bill_pay_method/.test(acc), "accounting.js approves nothing");
  const bill = code(site("js/pages/bill.js"));
  const i = bill.indexOf("} else if (!can.approve) {");
  const j = bill.indexOf('id="blGo"');
  assert.ok(i > 0 && j > i, "the Approve button is drawn only after the 'cannot approve' branch");
  assert.ok(/if \(can\.approve && !d\.payments\.length\)/.test(bill), "'Change how to pay' only for approvers, before any payment");
  assert.ok(/validate: \(x\) => \(\["check", "cash", "both"\]\.includes\(x\.m\)/.test(bill), "the pay method is required in the dialog");
  assert.ok(/value: current \|\| ""/.test(bill) && /pickMethod\("Approve for payment", [^]*?, ""\)/.test(bill), "nothing pre-selected when approving");
  const repo = code(site("js/repo/books.js"));
  assert.match(repo, /c\.rpc\("approve_bill", \{ id: idOf\(bill\.id\), pay_method: method \|\| null, version: bill\.version, note: n \|\| null \}\)/);
  assert.match(repo, /c\.rpc\("set_bill_pay_method", \{ p_id: idOf\(bill\.id\), p_method: method \|\| null, p_version: bill\.version \}\)/);
});

test("nothing is read without the financials switch; the home page's approvals card is for approvers only and loads the money code lazily", () => {
  const repo = code(site("js/repo/books.js"));
  for (const fn of ["loadDesk", "loadBill"]) {
    const body = repo.split("export async function " + fn)[1].split("\n}\n")[0];
    assert.ok(/^\(id, me\) \{\s*if \(!seesBooks\(me\)\) throw noBooks\(\);|^\(me, opts\) \{\s*if \(!seesBooks\(me\)\) throw noBooks\(\);/.test(body.trim()), fn + " refuses first");
  }
  assert.match(repo.split("export async function approvals")[1], /^\(me\) \{\s*if \(!canApprove\(me\)\) return null;/);
  const dash = code(site("js/shell/dashboard.js"));
  assert.ok(!/^import [^\n]*(repo|map)\/books\.js/m.test(dash), "no static import of the money code on the home page");
  assert.match(dash, /if \(!slot \|\| !isApprover\(p\)\) return;/);
  assert.match(dash, /p\.role === "manager" && !!p\.can_approve_payments && !!p\.can_see_financials/);
  assert.ok(!/accountant/.test(dash.split("export function isApprover")[1].split("\n}\n")[0]), "an accountant is never an approver");
  assert.match(dash, /if \(role === "admin" \|\| p\.can_see_financials\) \{\s*sections\.push\(\{ label: "Office"/);
  for (const page of ["js/pages/accounting.js", "js/pages/bill.js"]) {
    assert.match(code(site(page)), /if \(!seesBooks\(me\)\) \{[^]*?location\.replace\("dashboard\.html"\);\s*return;/, page + ": refused and sent home");
  }
});

test("Q13: the CSV is built in the browser (BOM, CRLF, the formula guard) - no QuickBooks call or key anywhere in the site", () => {
  const acc = code(site("js/pages/accounting.js"));
  assert.match(acc, /toCsv\(rows, which === "bills" \? BILL_COLUMNS : INVOICE_COLUMNS\)/);
  assert.match(acc, /new Blob\(\[text\], \{ type: "text\/csv;charset=utf-8" \}\)/);
  assert.ok(!/fetch\(|\/api\//.test(acc), "no server export");
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const f of walk(SITE)) {
    if (/\.(png|jpe?g|ico|webp)$/.test(f)) continue;
    const s = readFileSync(f, "utf8");
    assert.ok(!/intuit\.com|quickbooks\.api|oauth\.platform\.intuit|realmId|qbo_(client|secret|token)/i.test(s), f + ": a QuickBooks connection");
  }
});

test("the CSS takes the tables out of styles.css's one-line clipped cells (phones never scroll sideways)", () => {
  const h = site("accounting.html");
  assert.match(h, /\.ac-t th, \.ac-t td \{ white-space: normal; max-width: none; overflow: visible; text-overflow: clip; \}/);
  assert.match(h, /@media \(max-width: 560px\) \{\s*table\.ac-t \{ table-layout: fixed; \}/);
  assert.ok(!/class="msg"/.test(site("js/pages/bill.js")), "styles.css hides .msg until shown");
});

test("review fix: the open check panel spans the columns shown (a phone hides How - a colspan of 4 added an empty column) and The Books names the real rule, never a 'money switch'", () => {
  const acc = code(site("js/pages/accounting.js"));
  const page = site("accounting.html");
  assert.ok(acc.includes("<td class=\"ck-cell\" colspan=\"' + panelSpan() + '\">"), "the panel cell's span is worked out");
  assert.ok(acc.includes('const NARROW = "(max-width: 560px)";') && acc.includes("matchMedia(NARROW).matches ? 3 : 4"), "3 on a phone, 4 on a desk");
  assert.ok(page.includes("@media (max-width: 560px)") && page.includes(".ac-t .hide-sm { display: none; }"), "the page hides How at the same width");
  assert.ok(acc.includes('state.mq.addEventListener("change", respan)') && acc.includes('window.addEventListener("resize", respan)'),
    "a phone turned sideways re-spans the open panel");
  assert.ok(!/money switch/.test(acc), "no switch that does not exist");
  assert.ok(acc.includes("Only an admin, or a manager or accountant with the financials switch, records payments."));
});
