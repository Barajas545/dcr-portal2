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
  // before any LIVE payment: a voided one settles nothing (set_bill_pay_method counts app.bill_paid_total, live only)
  assert.ok(/if \(can\.approve && !livePays\.length\)/.test(bill), "'Change how to pay' only for approvers, before any payment");
  assert.ok(/validate: \(x\) => \(isPayMethod\(x\.m\) \? "" : "Choose how it is paid/.test(bill), "the pay method is required in the dialog");
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
  // the Books' look moved out of accounting.html into css/books.css (the Books program, release A), shared by every Books page
  assert.ok(site("accounting.html").includes('<link rel="stylesheet" href="css/books.css" />') && !/<style>/.test(site("accounting.html")), "accounting.html links css/books.css");
  const h = site("accounting.html") + site("css/books.css");
  assert.match(h, /\.ac-t th, \.ac-t td \{ white-space: normal; max-width: none; overflow: visible; text-overflow: clip; \}/);
  assert.match(h, /@media \(max-width: 560px\) \{\s*table\.ac-t \{ table-layout: fixed; \}/);
  assert.ok(!/class="msg"/.test(site("js/pages/bill.js")), "styles.css hides .msg until shown");
});

test("review fix: the open check panel spans the columns shown (a phone hides How - a colspan of 4 added an empty column) and The Books names the real rule, never a 'money switch'", () => {
  const acc = code(site("js/pages/accounting.js"));
  const page = site("accounting.html") + site("css/books.css");
  assert.ok(acc.includes("<td class=\"ck-cell\" colspan=\"' + panelSpan() + '\">"), "the panel cell's span is worked out");
  assert.ok(acc.includes('const NARROW = "(max-width: 560px)";') && acc.includes("matchMedia(NARROW).matches ? 3 : 4"), "3 on a phone, 4 on a desk");
  assert.ok(page.includes("@media (max-width: 560px)") && page.includes(".ac-t .hide-sm { display: none; }"), "the page hides How at the same width");
  assert.ok(acc.includes('state.mq.addEventListener("change", respan)') && acc.includes('window.addEventListener("resize", respan)'),
    "a phone turned sideways re-spans the open panel");
  assert.ok(!/money switch/.test(acc), "no switch that does not exist");
  assert.ok(acc.includes("Only an admin, or a manager or accountant with the financials switch, records payments."));
});

/* ── the Books program, release B (P5): Advanced mode ── */

test("Advanced mode: ONE tab strip of six links on every Books page (← Simple view · The Books · Checks · Vendors · Reports · Expenses & receipts), static markup, each page marking itself", () => {
  const want = [["books-home.html", "← Simple view"], ["accounting.html", "The Books"], ["books-checks.html", "Checks"], ["books-vendors.html", "Vendors"],
    ["books-reports.html", "Reports"], ["ledger.html", "Expenses & receipts"]];
  const words = (s) => s.replace(/<[^>]+>/g, "").replace(/&larr;/g, "←").replace(/&amp;/g, "&").trim();
  for (const [page, cls, current] of [["accounting.html", "ac-tabs", "accounting.html"], ["books-checks.html", "ac-tabs", "books-checks.html"],
    ["books-vendors.html", "ac-tabs", "books-vendors.html"], ["books-reports.html", "ac-tabs", "books-reports.html"], ["ledger.html", "lg-tabs", "ledger.html"],
    ["bill.html", "bl-nav", null]]) {
    const html = site(page);
    const nav = new RegExp('<nav class="' + cls + '" aria-label="The office\'s money pages">([\\s\\S]*?)</nav>').exec(html);
    assert.ok(nav, page + ": the strip");
    const links = Array.from(nav[1].matchAll(/<a href="([^"]+)"([^>]*)>([^<]*)<\/a>/g)).map((m) => [m[1], words(m[3]), /aria-current="page"/.test(m[2])]);
    assert.deepEqual(links.map((l) => [l[0], l[1]]), want, page + ": the six links in order");
    assert.deepEqual(links.filter((l) => l[2]).map((l) => l[0]), current ? [current] : [], page + ": marks itself");
    assert.equal((html.match(/aria-label="The office's money pages"/g) || []).length, 1, page + ": one strip");
  }
  // the simple page stays simple: no tab strip there, the big Advanced button instead
  assert.ok(!/aria-label="The office's money pages"/.test(site("books-home.html")));
  // bill.js redraws its root: the strip sits outside it
  const bill = site("bill.html");
  assert.ok(bill.indexOf('class="bl-nav"') < bill.indexOf('id="blRoot"'), "the bill page's strip is outside the root bill.js redraws");
});

test("Advanced mode: The Books uses the shared tell and ask panels, has \"Paid — last 30 days\", says where today's work is, and never says Portal 2 sends no e-mail", () => {
  const acc = code(site("js/pages/accounting.js"));
  const html = site("accounting.html");
  assert.ok(!/sends no email|sends no e-mail/i.test(acc + html), "the line \"Portal 2 sends no email itself\" is gone");
  assert.ok(!/mailto:|pickupMessage|resolvePayee|data-told=|data-mail=/.test(acc), "no hand-made e-mail, no own pick-up message");
  assert.match(acc, /import \{ groupHtml, waitingHtml, wireTell, textStep \} from "\.\/tell-payee\.js";/);
  assert.match(acc, /import \{ openAsk \} from "\.\/ask-approval\.js";/);
  assert.match(acc, /state\.home = await homeRepo\.loadHome\(state\.me\);\s*state\.d = state\.home\.desk;/, "The Books' desk plus the money messages (I24)");
  assert.match(acc, /data-askpick="/);
  assert.match(acc, /data-ask="' \+ h\(b\.id\) \+ '">Ask to approve<\/button>/);
  assert.match(acc, /h\(lastAskedText\(askedOf\(b\)\)\)/, "the last ask, escaped");
  assert.match(acc, /<h3>Paid — last 30 days<\/h3>/);
  assert.match(acc, /\(prices\(\) \? '<td class="num">' \+ h\(money\(p\.amount\)\) \+ "<\/td>" : ""\)/, "S4: the amount only with prices");
  assert.match(acc, /<a href="books-checks\.html">See every check in the check register &rarr;<\/a>/);
  assert.match(html, /Today's work is on the simple page \(<a href="books-home\.html">Accounting<\/a>\)\./);
  assert.ok(!/\.approve\(|approve_bill|setPayMethod|set_bill_pay_method/.test(acc), "asking never approves");
});
