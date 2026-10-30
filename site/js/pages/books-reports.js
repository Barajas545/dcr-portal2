/* Reports - books-reports.html (the Books program, release B part 2b; design-portal §6.3 with the build plan's I25, S3,
   S4 and S17; DCR Desktop 2 migration 20261030000500_books_reports, docs/DATABASE.md §35).

   The report picker on the left (on top on a phone), and one report at a time, each with its period, [Print] (a
   header, no buttons: "Save as PDF" is the browser's) and [CSV] (every cell quoted, the formula guard, a BOM, CRLF):
   * Unpaid bills by age (books_ap_aging, as of a day: not due yet, 1-30, 31-60, 61-90, over 90 days late, no due date,
     and how much of it still waits for an approval);
   * Vendor balances (books_vendor_balances);
   * the 1099 worksheet (books_1099: the year, the threshold - shown, and editable for this view only);
   * Payments by month (books_payments_by_month, per method: live, voided, cleared and not), and the Bill payments CSV
     (one line a payment, for keying in QuickBooks - map/checks.js PAYMENT_COLUMNS);
   * Approval requests (money_messages): when, who asked whom, how, what became of it, the bills, when they were
     approved and how long it took;
   * Money history (money_events): who did what to a bill, a payment, a money file, a vendor's details, a message.
   The math is the database's (I25): the page shapes and words it (map/books-reports.js). AR aging and job profit are not
   here (phase 5): one line says so. THE WHOLE PAGE NEEDS THE FINANCIALS AND PRICES SWITCHES, checked before anything is
   read (money_events carries amounts: S4): anyone else is told so and sent back before any read. Every database word is
   escaped (h) or set as text. Nothing here approves, pays or changes anything. */

import { boot, esc, toast, errorText, D } from "./shell.js";
import * as repo from "../repo/books-reports.js";
import { REPORTS, DEFERRED, PRESETS, periodOf, periodWords, periodProblem, AGING_BUCKETS, toAging, agingTotals, AGING_COLUMNS,
  VENDOR_BALANCE_COLUMNS, toMonth, monthTotals, MONTH_COLUMNS, toPaymentLine, PAYMENT_LINE_COLUMNS, approvalRows, APPROVAL_COLUMNS,
  EVENT_GROUPS, toEvent, filterEvents, HISTORY_COLUMNS, csvFile, printLine } from "../map/books-reports.js";
import { toVendor, threshold1099, thresholdWords, parseThreshold, years1099, to1099, COLUMNS_1099 } from "../map/vendors.js";
import { seesBooks, fmtMoney, toCsv, plural, shortDay } from "../map/books.js";
import { ymd } from "../map/pacific.js";

const h = esc;
const state = { me: null, today: "", report: "aging", asOf: "", preset: "30", from: "", to: "", year: null, threshold: null, group: "", q: "",
  rows: null, extra: null, error: "", busy: false, seq: 0 };
const m = (v) => h(fmtMoney(v));

/* ── the controls of each report ── */

function periodCtl() {
  return '<label>Period<select id="rpPreset">' + PRESETS.map((p) => '<option value="' + h(p.id) + '"' + (state.preset === p.id ? " selected" : "") + ">" + h(p.label) + "</option>").join("") +
    '<option value="custom"' + (state.preset === "custom" ? " selected" : "") + ">Pick the days</option></select></label>" +
    '<label>From<input type="date" id="rpFrom" value="' + h(state.from) + '"></label><label>To<input type="date" id="rpTo" value="' + h(state.to) + '"></label>';
}
function ctlHtml() {
  const go = '<button type="button" class="ac-b" id="rpGo">Show</button>';
  switch (state.report) {
    case "aging": return '<label>As of<input type="date" id="rpAsOf" value="' + h(state.asOf) + '" max="' + h(state.today) + '"></label>' + go;
    case "vendors": return '<span class="hint">Today, ' + h(shortDay(state.today)) + ".</span>";
    case "1099": {
      const years = years1099(state.today);
      const y = state.year || years[0];
      return '<label>Year<select id="rpYear">' + years.map((x) => '<option value="' + h(x) + '"' + (x === y ? " selected" : "") + ">" + h(x) + "</option>").join("") + "</select></label>" +
        '<label>Threshold<input id="rpThreshold" class="num" inputmode="decimal" placeholder="' + h(fmtMoney(threshold1099(y))) + '" value="' + h(state.threshold === null ? "" : state.threshold) + '"></label>' + go;
    }
    case "history":
      return periodCtl() + '<label>Show<select id="rpGroup">' + EVENT_GROUPS.map((g) => '<option value="' + h(g.id) + '"' + (state.group === g.id ? " selected" : "") + ">" + h(g.label) + "</option>").join("") +
        '</select></label><label>Search<input type="search" id="rpQ" class="q" placeholder="Who, vendor, job…" value="' + h(state.q) + '"></label>' + go;
    default: return periodCtl() + go;
  }
}

function periodText() {
  switch (state.report) {
    case "aging": return "as of " + periodWords(state.asOf, state.asOf);
    case "vendors": return "today, " + periodWords(state.today, state.today);
    case "1099": return String(state.year || years1099(state.today)[0]) + " · threshold " + fmtMoney(state.threshold === null ? threshold1099(state.year || years1099(state.today)[0]) : state.threshold);
    default: return periodWords(state.from, state.to);
  }
}

/* ── the reports' tables ── */

function agingHtml(rows) {
  if (!rows.length) return '<div class="ac-none">Nothing was owed to a vendor on ' + h(periodWords(state.asOf, state.asOf)) + ".</div>";
  const t = agingTotals(rows);
  return '<div class="rp-sum"><b>' + m(t.total) + "</b> owed to " + h(plural(rows.length, "vendor", "vendors")) + " on " + h(plural(t.openBills, "open bill", "open bills")) +
    (t.waiting > 0 ? " · " + m(t.waiting) + " of it still waits for an approval" : "") + ".</div>" +
    '<div class="rp-scroll"><table class="ac-t rp-t" id="rpTable"><thead><tr><th>Vendor</th>' + AGING_BUCKETS.map((b) => '<th class="num">' + h(b[1]) + "</th>").join("") +
    '<th class="num">Total</th></tr></thead><tbody>' +
    rows.map((r) => '<tr><td><span class="who">' + h(r.name) + '</span><span class="sub">' + h(plural(r.openBills, "bill", "bills")) +
      (r.oldestDue ? " · oldest due " + h(shortDay(r.oldestDue)) : "") + (r.linked ? "" : " · not linked to a contact") + "</span></td>" +
      AGING_BUCKETS.map((b) => '<td class="num">' + (r[b[0]] ? m(r[b[0]]) : "") + "</td>").join("") +
      '<td class="num"><b>' + m(r.total) + "</b>" + (r.waiting > 0 ? '<span class="sub">' + m(r.waiting) + " waiting approval</span>" : "") + "</td></tr>").join("") +
    '<tr class="tot"><td>Total</td>' + AGING_BUCKETS.map((b) => '<td class="num">' + m(t[b[0]]) + "</td>").join("") + '<td class="num">' + m(t.total) + "</td></tr>" +
    "</tbody></table></div>";
}

function vendorsHtml(rows) {
  if (!rows.length) return '<div class="ac-none">No vendors yet.</div>';
  const owed = rows.reduce((n, v) => n + (Number(v.owed) || 0), 0);
  return '<div class="rp-sum"><b>' + m(owed) + "</b> owed to " + h(plural(rows.filter((v) => v.owed > 0).length, "vendor", "vendors")) + ".</div>" +
    '<div class="rp-scroll"><table class="ac-t rp-t" id="rpTable"><thead><tr><th>Vendor</th><th class="num">Bills</th><th class="num">Billed</th><th class="num">Paid</th>' +
    '<th class="num">Owed</th><th class="num">Past due</th><th class="num">Paid this year</th><th class="num">Last year</th><th>Facts</th></tr></thead><tbody>' +
    rows.map((v) => '<tr><td><span class="who">' + h(v.name) + "</span>" + (v.kindLabel ? '<span class="sub">' + h(v.kindLabel) + "</span>" : v.linked ? "" : '<span class="sub">not linked to a contact</span>') + "</td>" +
      '<td class="num">' + h(String(v.bills)) + (v.openBills ? '<span class="sub">' + h(String(v.openBills)) + " open</span>" : "") + "</td>" +
      '<td class="num">' + m(v.billed) + '</td><td class="num">' + m(v.paid) + '</td><td class="num"><b>' + m(v.owed) + "</b>" +
        (v.waiting > 0 ? '<span class="sub">' + m(v.waiting) + " waiting</span>" : "") + "</td>" +
      '<td class="num">' + (v.pastDue > 0 ? m(v.pastDue) : "") + '</td><td class="num">' + m(v.paidYtd) + '</td><td class="num">' + m(v.paidLastYear) + "</td>" +
      "<td>" + [v.tax1099 ? "1099" : "", v.linked && v.w9Missing ? "W-9 missing" : "", v.insuranceExpired ? "insurance run out" : "", v.wcExpired ? "workers' comp run out" : ""]
        .filter(Boolean).map((x) => '<span class="vd-f' + (/missing|run out/.test(x) ? " expired" : " t1099") + '">' + h(x) + "</span>").join(" ") + "</td></tr>").join("") +
    "</tbody></table></div>";
}

function w1099Html(rows) {
  const y = state.year || years1099(state.today)[0];
  let s = '<div class="vd-words"><b>' + h(thresholdWords(y, state.threshold)) + "</b> For this view only: it is never saved. Card payments and materials suppliers' bills don't count. " +
    "A worksheet, not a filing.</div>";
  if (!rows.length) return s + '<div class="ac-none">Nobody was paid in ' + h(y) + ".</div>";
  const n = rows.filter((r) => r.reportable).length;
  s += '<div class="rp-sum"><b>' + h(plural(n, "vendor gets", "vendors get")) + " a 1099</b> for " + h(y) + ".</div>";
  return s + '<div class="rp-scroll"><table class="ac-t rp-t" id="rpTable"><thead><tr><th>Vendor</th><th class="num">Check</th><th class="num">Cash</th><th class="num">Transfer</th>' +
    '<th class="num">Other</th><th class="num">Counts</th><th class="num">Card</th><th class="num">Materials</th><th>1099</th></tr></thead><tbody>' +
    rows.map((r) => '<tr><td><span class="who">' + h(r.name) + "</span>" + (r.legalName ? '<span class="sub">W-9: ' + h(r.legalName) + "</span>" : "") + "</td>" +
      '<td class="num">' + m(r.check) + '</td><td class="num">' + m(r.cash) + '</td><td class="num">' + m(r.transfer) + '</td><td class="num">' + m(r.other) + "</td>" +
      '<td class="num"><b>' + m(r.total) + '</b></td><td class="num">' + m(r.card) + '</td><td class="num">' + m(r.materials) + "</td>" +
      "<td>" + (r.reportable ? '<span class="vd-f t1099">reportable</span>' : r.total >= r.threshold ? '<span class="vd-f">over · not flagged 1099</span>' : '<span class="vd-f">under</span>') +
        (r.needsW9 ? ' <span class="vd-f missing">needs a W-9</span>' : "") + "</td></tr>").join("") +
    "</tbody></table></div>";
}

function monthsHtml(rows) {
  if (!rows.length) return '<div class="ac-none">No payment is dated ' + h(periodWords(state.from, state.to)) + ".</div>";
  const groups = monthTotals(rows);
  const all = groups.reduce((n, g) => n + g.total, 0), count = groups.reduce((n, g) => n + g.payments, 0);
  let s = '<div class="rp-sum"><b>' + m(all) + "</b> in " + h(plural(count, "payment", "payments")) + " · " + h(periodWords(state.from, state.to)) + ".</div>" +
    '<div class="rp-scroll"><table class="ac-t rp-t" id="rpTable"><thead><tr><th>Method</th><th class="num">Payments</th><th class="num">Total</th>' +
    '<th class="num">Voided</th><th class="num">Cleared</th><th class="num">Not cleared</th></tr></thead><tbody>';
  groups.forEach((g) => {
    s += '<tr class="rp-month"><td colspan="6">' + h(g.monthLabel) + " · " + m(g.total) + "</td></tr>";
    g.lines.forEach((r) => {
      s += "<tr><td>" + h(r.methodLabel) + '</td><td class="num">' + h(String(r.payments)) + '</td><td class="num"><b>' + m(r.total) + "</b></td>" +
        '<td class="num">' + (r.voided ? h(String(r.voided)) + '<span class="sub">' + m(r.voidedTotal) + "</span>" : "") + "</td>" +
        '<td class="num">' + (r.cleared === null ? '<span class="sub">cash</span>' : h(String(r.cleared)) + '<span class="sub">' + m(r.clearedTotal) + "</span>") + "</td>" +
        '<td class="num">' + (r.notCleared === null ? "" : h(String(r.notCleared)) + '<span class="sub">' + m(r.notClearedTotal) + "</span>") + "</td></tr>";
    });
  });
  return s + "</tbody></table></div>";
}

function approvalsHtml(rows) {
  if (!rows.length) return '<div class="ac-none">Nobody was asked to approve a bill ' + h(periodWords(state.from, state.to)) + ".</div>";
  return '<div class="rp-sum"><b>' + h(plural(rows.length, "request", "requests")) + "</b> · " + h(periodWords(state.from, state.to)) + ".</div>" +
    '<div class="rp-scroll"><table class="ac-t rp-t" id="rpTable"><thead><tr><th>Asked</th><th>Who</th><th>How</th><th>Outcome</th><th>Bills</th><th>Approved</th></tr></thead><tbody>' +
    rows.map((r) => "<tr><td>" + h(r.atWords) + '<span class="sub">by ' + h(r.byName || "someone") + "</span></td>" +
      '<td><span class="who">' + h(r.toName) + "</span></td><td>" + h(r.how) + '</td><td class="st ' + h(r.outcomeCls) + '">' + h(r.outcome) + "</td>" +
      "<td>" + r.bills.map((b) => h(b)).join("<br>") + "</td>" +
      "<td>" + (r.approvedWords ? h(r.approvedWords) + (r.took ? '<span class="sub">' + h(r.took) + " after the ask</span>" : "") : '<span class="sub">not yet</span>') + "</td></tr>").join("") +
    "</tbody></table></div>";
}

function historyHtml(rows, capped) {
  const list = filterEvents(rows, { group: state.group, q: state.q });
  if (!list.length) return '<div class="ac-none">' + (rows.length ? "None of these." : "Nothing changed " + h(periodWords(state.from, state.to)) + ".") + "</div>";
  return '<div class="rp-sum"><b>' + h(plural(list.length, "change", "changes")) + "</b> · " + h(periodWords(state.from, state.to)) +
    (capped ? " · the newest " + h(String(repo.HISTORY_MAX)) + " only: pick a shorter period" : "") + ".</div>" +
    '<div class="rp-scroll"><table class="ac-t rp-t" id="rpTable"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Bill or vendor</th><th class="num">Amount</th><th>Detail</th></tr></thead><tbody>' +
    list.map((e) => "<tr><td>" + h(e.atWords) + '</td><td>' + h(e.actor) + '</td><td><span class="who">' + h(e.what) + "</span></td>" +
      "<td>" + h(e.bill || e.vendor || e.job) + '</td><td class="num">' + (e.amount === null ? "" : m(e.amount)) + "</td><td>" + h(e.detail) + "</td></tr>").join("") +
    "</tbody></table></div>";
}

/** The shown report's lines, as its CSV takes them. */
function csvRows() {
  const r = state.rows || [];
  if (state.report === "history") return filterEvents(r, { group: state.group, q: state.q });
  return r;
}
const COLUMNS = { aging: AGING_COLUMNS, vendors: VENDOR_BALANCE_COLUMNS, 1099: COLUMNS_1099, months: MONTH_COLUMNS, approvals: APPROVAL_COLUMNS, history: HISTORY_COLUMNS };

export function outHtml() {
  if (state.error) return '<div class="ac-msg err" role="status">' + h(state.error) + "</div>";
  if (state.busy || !state.rows) return '<div class="ac-none rp-busy" role="status">Working it out…</div>';
  switch (state.report) {
    case "aging": return agingHtml(state.rows);
    case "vendors": return vendorsHtml(state.rows);
    case "1099": return w1099Html(state.rows);
    case "months": return monthsHtml(state.rows);
    case "approvals": return approvalsHtml(state.rows);
    default: return historyHtml(state.rows, !!(state.extra && state.extra.capped));
  }
}

function titleOf() { const r = REPORTS.find((x) => x.id === state.report); return r ? r.label : ""; }

export function bodyHtml() {
  return '<div class="rp-wrap"><nav class="rp-pick" role="tablist" aria-label="Reports">' + REPORTS.map((r) =>
      '<button type="button" role="tab" data-report="' + h(r.id) + '" aria-selected="' + (state.report === r.id) + '">' + h(r.label) + "</button>").join("") + "</nav>" +
    '<section class="ac-sec rp-main" id="rpMain"><header><h3 id="rpTitle">' + h(titleOf()) + '</h3><span class="grow"></span>' +
      '<button type="button" class="ac-b rp-noprint" id="rpPrint">Print</button>' +
      '<button type="button" class="ac-b rp-noprint" id="rpCsv">&#8615; CSV</button>' +
      (state.report === "months" ? '<button type="button" class="ac-b rp-noprint" id="rpCsvLines" title="One line a payment, for keying in QuickBooks">&#8615; Bill payments CSV</button>' : "") +
    '</header><div class="rp-ctl" id="rpCtl">' + ctlHtml() + '</div><div id="rpOut">' + outHtml() + "</div></section></div>" +
    '<p class="ac-note rp-deferred rg-noprint" id="rpDeferred">' + h(DEFERRED) + "</p>";
}

function paintOut() {
  const out = document.getElementById("rpOut");
  if (out) out.innerHTML = outHtml();
  const csv = document.getElementById("rpCsv");
  if (csv) csv.disabled = !(state.rows && csvRows().length);
}

function render() {
  const box = document.getElementById("rpBody");
  if (!box) return;
  box.innerHTML = bodyHtml();
  box.querySelectorAll("[data-report]").forEach((b) => b.addEventListener("click", () => pick(b.getAttribute("data-report"))));
  const on = (id, ev, fn) => { const n = document.getElementById(id); if (n) n.addEventListener(ev, fn); };
  on("rpGo", "click", () => { readCtl(); run(); });
  on("rpPreset", "change", () => {
    const v = document.getElementById("rpPreset").value;
    state.preset = v;
    if (v !== "custom") { const p = periodOf(v, state.today); state.from = p.from; state.to = p.to; document.getElementById("rpFrom").value = p.from; document.getElementById("rpTo").value = p.to; }
  });
  ["rpFrom", "rpTo"].forEach((id) => on(id, "change", () => { state.preset = "custom"; const s = document.getElementById("rpPreset"); if (s) s.value = "custom"; }));
  on("rpYear", "change", () => { const s = document.getElementById("rpYear"), t = document.getElementById("rpThreshold"); if (t) t.placeholder = fmtMoney(threshold1099(Number(s.value))); });
  on("rpGroup", "change", () => { state.group = document.getElementById("rpGroup").value; paintOut(); });
  on("rpQ", "input", () => { state.q = document.getElementById("rpQ").value; paintOut(); });
  ["rpAsOf", "rpThreshold"].forEach((id) => on(id, "keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); readCtl(); run(); } }));
  on("rpPrint", "click", () => { printHead(); window.print(); });
  on("rpCsv", "click", downloadCsv);
  on("rpCsvLines", "click", downloadLines);
  paintOut();
}

/* what the controls hold now (no read) */
function readCtl() {
  const v = (id) => { const n = document.getElementById(id); return n ? n.value : null; };
  if (state.report === "aging") { const a = v("rpAsOf"); if (a !== null) state.asOf = a; }
  if (state.report === "1099") { const y = v("rpYear"); if (y !== null) state.year = Number(y); const t = v("rpThreshold"); if (t !== null) state.threshold = parseThreshold(t); }
  if (["months", "approvals", "history"].indexOf(state.report) !== -1) {
    const f = v("rpFrom"), t = v("rpTo");
    if (f !== null) state.from = f;
    if (t !== null) state.to = t;
  }
}

function pick(id) {
  if (!REPORTS.some((r) => r.id === id) || id === state.report) return;
  state.report = id;
  state.rows = null; state.extra = null; state.error = "";
  // payments by month opens on this year, unless the days were picked by hand
  if (id === "months" && state.preset !== "custom") { state.preset = "year"; const y = periodOf("year", state.today); state.from = y.from; state.to = y.to; }
  try { history.replaceState(null, "", "#" + id); } catch (e) { /* */ }
  render();
  run();
}

/** Read the shown report (the database's functions and plain reads, as me). */
export async function run() {
  const seq = ++state.seq;
  const me = state.me;
  state.error = "";
  if (state.report === "aging" && !/^\d{4}-\d{2}-\d{2}$/.test(state.asOf)) { state.error = "Pick the day."; state.rows = null; paintOut(); return; }
  if (state.report === "1099" && Number.isNaN(state.threshold)) { state.error = "Type the threshold as dollars, e.g. 2000."; state.rows = null; paintOut(); return; }
  if (["months", "approvals", "history"].indexOf(state.report) !== -1) {
    const p = periodProblem(state.from, state.to);
    if (p) { state.error = p; state.rows = null; paintOut(); return; }
  }
  state.busy = true;
  paintOut();
  let rows = null, extra = null;
  try {
    switch (state.report) {
      case "aging": rows = (await repo.apAging(me, state.asOf)).map(toAging); break;
      case "vendors": rows = (await repo.vendorBalances(me)).map(toVendor); break;
      case "1099": {
        if (!state.year) state.year = years1099(state.today)[0];
        rows = (await repo.worksheet1099(me, state.year, state.threshold)).map(to1099);
        break;
      }
      case "months": rows = (await repo.paymentsByMonth(me, state.from, state.to)).map(toMonth); break;
      case "approvals": {
        const x = await repo.approvalLog(me, state.from, state.to);
        rows = approvalRows(x.messages, x);
        break;
      }
      default: {
        const x = await repo.moneyHistory(me, state.from, state.to);
        rows = x.events.map((e) => toEvent(e, x));
        extra = { capped: x.capped };
      }
    }
  } catch (e) {
    if (seq !== state.seq) return;
    state.busy = false;
    state.rows = null;
    state.error = errorText(e);
    paintOut();
    return;
  }
  if (seq !== state.seq) return;
  state.busy = false;
  state.rows = rows;
  state.extra = extra;
  paintOut();
}

function printHead() {
  const head = document.getElementById("rpPrintHead");
  if (head) head.textContent = printLine(titleOf(), periodText(), state.today, state.me && state.me.name, state.rows ? csvRows().length : undefined);
}

function save(text, name, n) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast("The CSV is downloading: " + plural(n, "line", "lines") + ".", "ok");
}

function downloadCsv() {
  const rows = csvRows();
  if (!rows.length) return;
  const span = state.report === "aging" ? [state.asOf] : state.report === "vendors" || state.report === "1099" ? [state.today] : [state.from, state.to];
  const name = state.report === "1099" ? "1099-" + (state.year || "") : (REPORTS.find((r) => r.id === state.report) || {}).label || state.report;
  save(toCsv(rows, COLUMNS[state.report]), csvFile(name, span[0], span[1]), rows.length);
}

/* the Bill payments CSV of the period: one line a live payment (for keying in QuickBooks) */
async function downloadLines() {
  readCtl();
  const p = periodProblem(state.from, state.to);
  if (p) { toast(p, "error"); return; }
  let x;
  try { x = await repo.paymentLines(state.me, state.from, state.to); } catch (e) { toast(errorText(e), "error"); return; }
  const lines = x.payments.map((r) => toPaymentLine(r, x));
  if (!lines.length) { toast("No payment is dated in that period.", "error"); return; }
  save(toCsv(lines, PAYMENT_LINE_COLUMNS), csvFile("bill-payments", state.from, state.to), lines.length);
}

async function start() {
  let me;
  try { me = await boot("books"); } catch (e) { return; }
  state.me = me;
  // BOTH switches before anything is read: the four reports need them, and money_events carries amounts (S4)
  if (!repo.seesReports(me)) {
    const books = seesBooks(me);
    document.getElementById("rpBody").innerHTML = '<div class="ac-none">The reports are not available for your account.</div>';
    const al = D().alert;
    if (typeof al === "function") {
      await al(books ? "The reports carry amounts: they need the prices switch as well as financials. Ask an admin." :
        "The reports are not available for your role: they need the financials and prices switches. Ask an admin.", { title: "Not available" });
    }
    location.replace(books ? "accounting.html" : "dashboard.html");
    return;
  }
  document.title = "DCR Portal 2 — Reports";
  const first = String(me.name || "").split(" ")[0].split("@")[0];
  document.getElementById("rpGreeting").textContent = first ? "— " + first : "";
  state.today = ymd(new Date());
  state.asOf = state.today;
  const p = periodOf(state.preset, state.today);
  state.from = p.from; state.to = p.to;
  const want = String(location.hash || "").replace(/^#/, "");
  if (REPORTS.some((r) => r.id === want)) state.report = want;
  // the months report opens on this year
  if (state.report === "months") { state.preset = "year"; const y = periodOf("year", state.today); state.from = y.from; state.to = y.to; }
  window.addEventListener("beforeprint", printHead);
  // books-reports.html#months (The Books' "Payments by month →") and the like, on this page too
  window.addEventListener("hashchange", () => { const id = String(location.hash || "").replace(/^#/, ""); if (id !== state.report) pick(id); });
  render();
  await run();
}

if (typeof document !== "undefined" && typeof window !== "undefined" && document.getElementById && !(window && window.__RP_TEST__)) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}

export const _test = { state, render: () => render(), bodyHtml, outHtml, run };
