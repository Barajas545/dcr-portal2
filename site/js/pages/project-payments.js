/* Project tab Payments (P5b; MODULES §3 "Project tabs Expenses, Payments" — Redesign; BLUEPRINT 3.3.11
   "The Books", "Bill approval page").

   The old tab mixed two meanings of "payment" in one list. This one keeps them apart:
   * Money out — the project's vendor bills, each with its state as DCR Desktop 2 names it (needs document,
     waiting approval, approved, part paid, paid, overdue, void: map/payments.js), the approved amount, paid,
     still owed, the pay method, and under it every payment (day, method, check number, payee, memo, and who
     was told a check or cash is ready to pick up);
   * Money in — the project's invoices to the client (total of the lines, collected, outstanding) and the
     client's payments.
   Read only. A bill is approved on its own page (bill.html: an admin, or a manager with the approve switch —
   accountants never); payments are recorded on The Books' check desk or in DCR Desktop 2. The database caps
   every payment at the approved amount and checks the method; nothing here can get round it.

   Loaded only for people with the financials switch (project.js imports it on demand). */

import * as repo from "../repo/ledger.js";
import { decorateBill, billOrder, billTotals, decorateInvoice, invoiceTotals, paymentText, toldText, pickupPayment, PAY_METHOD_LABELS } from "../map/payments.js";
import { money } from "../map/ledger.js";
import { ymd, fmtDay } from "../map/pacific.js";

let host = null, seq = 0, timer = null;
const st = { ctx: null };
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** An admin, or a manager holding approve and financials (app.can_approve) — the page's words only. */
function approver(me) {
  return !!me && me.active !== false && (me.role === "admin" || (me.role === "manager" && !!me.can_approve_payments && !!me.can_see_financials));
}

export function render(ctx, el) {
  host = el;
  st.ctx = ctx;
  host.classList.add("pjm");
  host.innerHTML = '<div class="pj-empty">Loading payments…</div>';
  host.addEventListener("click", function (e) {
    const b = e.target && e.target.closest ? e.target.closest("#pyReload") : null;
    if (b) load();
  });
  load();
}

export function reload() {
  if (!host) return;
  clearTimeout(timer);
  timer = setTimeout(load, 400);
}

async function load() {
  if (!host) return;
  const my = ++seq;
  try {
    const got = await repo.projectPayments(st.ctx.pid);
    if (my !== seq) return;
    paint(got);
  } catch (e) {
    if (my !== seq) return;
    host.innerHTML = '<div class="pj-empty">' + esc(st.ctx.errorText(e)) + "</div>";
  }
}

function chip(text, tone) { return '<span class="pjm-chip ' + esc(tone) + '">' + esc(text) + "</span>"; }

function paint(got) {
  const today = ymd(new Date());
  const ctx = st.ctx;
  const bills = got.bills.map((b) => decorateBill(b, today)).sort(billOrder);
  const invoices = got.invoices.map((i) => decorateInvoice(i, today));
  const bt = billTotals(bills), it = invoiceTotals(invoices);
  const canApprove = approver(ctx.me);

  const summary = '<div class="pjm-sum">' +
    "<div><span>Billed to us</span><b>" + esc(money(bt.billed)) + "</b><small>" + bt.count + " bill" + (bt.count === 1 ? "" : "s") + "</small></div>" +
    "<div><span>Paid out</span><b>" + esc(money(bt.paid)) + "</b></div>" +
    '<div class="' + (bt.overdue ? "warn" : "") + '"><span>Still owed</span><b>' + esc(money(bt.owed)) + "</b>" + (bt.overdue ? "<small>some overdue</small>" : "<small>approved, not paid</small>") + "</div>" +
    '<div class="' + (bt.waitingCount ? "warn" : "") + '"><span>Waiting approval</span><b>' + esc(money(bt.waiting)) + "</b><small>" + bt.waitingCount + " bill" + (bt.waitingCount === 1 ? "" : "s") + "</small></div>" +
    '<div class="hi"><span>Invoiced to the client</span><b>' + esc(money(it.invoiced)) + "</b><small>" + it.sentCount + " sent" +
      (it.draftCount ? " · " + esc(money(it.drafts)) + " in " + it.draftCount + " draft" + (it.draftCount === 1 ? "" : "s") + ", not sent" : "") + "</small></div>" +
    "<div><span>Collected</span><b>" + esc(money(it.collected)) + "</b></div>" +
    '<div class="' + (it.overdue ? "warn" : "") + '"><span>Outstanding</span><b>' + esc(money(it.outstanding)) + "</b>" +
      (it.overdue ? "<small>" + it.overdue + " overdue</small>" : "") + "</div>" +
    "</div>";

  let billRows = "";
  bills.forEach((b) => {
    const open = b.voided ? "" : '<a href="bill.html?id=' + encodeURIComponent(b.id) + '">' + (canApprove && !b.approved ? "Review…" : "Open") + "</a>";
    billRows += "<tr>" +
      "<td><b>" + esc(b.vendor) + "</b>" + (b.number ? ' <span class="pj-sub" style="display:inline">' + esc(b.number) + "</span>" : "") +
        (b.kind ? ' <span class="lg-kind">' + esc(b.kind) + "</span>" : "") +
        (b.description ? '<span class="vd">' + esc(b.description) + "</span>" : "") + "</td>" +
      '<td class="dt">' + esc(b.invoiceDate ? fmtDay(b.invoiceDate) : "") + (b.dueDate ? '<span class="vd">due ' + esc(fmtDay(b.dueDate)) + "</span>" : "") + "</td>" +
      "<td>" + chip(b.stateText, b.tone) + (b.payMethod && b.approved ? '<span class="vd">' + esc(PAY_METHOD_LABELS[b.payMethod] || b.payMethod) + "</span>" : "") + "</td>" +
      '<td class="num">' + esc(money(b.amount)) + "</td>" +
      '<td class="num">' + (b.approved ? esc(money(b.approvedAmount)) : "—") + "</td>" +
      '<td class="num">' + (b.paid ? esc(money(b.paid)) : "") + "</td>" +
      '<td class="num">' + (b.owed ? "<b>" + esc(money(b.owed)) + "</b>" : "") + "</td>" +
      "<td>" + open + "</td></tr>";
    b.payments.forEach((p) => {
      const told = toldText(p, fmtDay);
      billRows += '<tr class="pay"><td colspan="3">' + esc(paymentText(p, fmtDay)) +
        (p.payee ? " · to " + esc(p.payee) : "") + (p.memo ? " · memo “" + esc(p.memo) + "”" : "") +
        (pickupPayment(p) ? '<span class="vd">' + esc(told || "Not told it is ready yet") + "</span>" : "") +
        '</td><td class="num" colspan="3">' + esc(money(p.amount)) + "</td><td></td><td></td></tr>";
    });
  });
  const billsHtml = '<div class="pjm-h"><h3>Money out — vendor bills</h3><span class="pj-sub">' +
    (canApprove ? "You may approve: a bill is approved on its own page, with how it will be paid." :
      "Bills are approved by an admin, or a manager with the approve switch.") + " Payments are recorded on " +
    '<a href="accounting.html">The Books</a>.</span></div>' +
    (bills.length ? '<div class="pj-tblwrap"><table class="pj-tbl pjm-tbl"><thead><tr><th>Vendor · invoice</th><th>Date</th><th>State</th>' +
      '<th class="num">Amount</th><th class="num">Approved</th><th class="num">Paid</th><th class="num">Owed</th><th></th></tr></thead><tbody>' +
      billRows + '<tr class="grand"><td colspan="3">TOTALS (void bills count for nothing)</td><td class="num">' + esc(money(bt.billed)) +
      '</td><td></td><td class="num">' + esc(money(bt.paid)) + '</td><td class="num">' + esc(money(bt.owed)) + "</td><td></td></tr></tbody></table></div>"
      : '<div class="pj-empty">No vendor bills for this project.</div>');

  let invRows = "";
  invoices.forEach((iv) => {
    invRows += "<tr><td><b>" + esc(iv.number) + "</b>" + (iv.description ? '<span class="vd">' + esc(iv.description) + "</span>" : "") + "</td>" +
      '<td class="dt">' + esc(iv.date ? fmtDay(iv.date) : "") + (iv.dueDate ? '<span class="vd">due ' + esc(fmtDay(iv.dueDate)) + "</span>" : "") + "</td>" +
      "<td>" + chip(iv.overdue ? "Overdue" : iv.statusText, iv.overdue ? "danger" : iv.status === "paid" ? "success" : iv.voided ? "muted" : iv.status === "sent" ? "info" : "warning") + "</td>" +
      '<td class="num">' + esc(money(iv.total)) + '</td><td class="num">' + (iv.paid ? esc(money(iv.paid)) : "") + '</td><td class="num">' +
      // a draft was never sent: nothing is outstanding on it yet (Desktop 2's figures)
      (iv.draft ? '<span class="pj-sub" style="display:inline">not sent</span>' : iv.balance ? "<b>" + esc(money(iv.balance)) + "</b>" : "") + "</td></tr>";
    iv.payments.forEach((p) => {
      invRows += '<tr class="pay"><td colspan="3">' + esc(paymentText(p, fmtDay)) + '</td><td class="num" colspan="2">' + esc(money(p.amount)) + "</td><td></td></tr>";
    });
  });
  const invHtml = '<div class="pjm-h"><h3>Money in — invoices to the client</h3><span class="pj-sub">Written and sent from DCR Desktop 2.</span></div>' +
    (invoices.length ? '<div class="pj-tblwrap"><table class="pj-tbl pjm-tbl"><thead><tr><th>Invoice</th><th>Date</th><th>Status</th>' +
      '<th class="num">Total</th><th class="num">Collected</th><th class="num">Outstanding</th></tr></thead><tbody>' + invRows +
      '<tr class="grand"><td colspan="3">TOTALS (sent and paid invoices; drafts and void ones count for nothing)</td><td class="num">' + esc(money(it.invoiced)) + '</td><td class="num">' +
      esc(money(it.collected)) + '</td><td class="num">' + esc(money(it.outstanding)) + "</td></tr></tbody></table></div>"
      : '<div class="pj-empty">No invoices for this project.</div>');

  host.innerHTML = '<div class="pj-bar"><button class="pj-btn pj-btn-sm" id="pyReload" type="button" title="Read again">↻</button>' +
    '<span class="pj-sub" style="margin:0">Read only here: the database caps every payment at the approved amount and checks how it is paid.</span></div>' +
    summary + billsHtml + invHtml;
}
