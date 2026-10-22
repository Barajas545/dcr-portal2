/* The Books — the accountant's desk (port of the old accounting.html / accounting.js; MODULES §5b; BLUEPRINT 3.3.11
   "The Books (accountant's desk)", P5 5b, acceptance checks 2, 3 and 5).

   The books live in QuickBooks Online and stay there (Q13: a MANUAL hand-off - no QuickBooks key anywhere). This
   screen makes the hand-off reliable: what is ready to enter, what is already in, what is stuck and on whom - and
   the money leaving the door: the checks and cash to hand over and the payees still to be told.

   * the picture (or the four tiles): money out the door (not ready -> to pay -> paid, tell them) and into QuickBooks
     (bills to key in -> on the books, invoices to key in -> on the books);
   * what needs doing: one line each, with the money, in the order it makes sense to do it;
   * bills to pay: one queue, each row saying how the approver authorised it (check, cash, either); a row opens the
     check desk - payee (<= 200) and memo (<= 100) prefilled, the amount capped at the approved amount still owed
     (the database refuses more: acceptance check 2), the check number, the documents behind it, what is already
     paid - and records the payment (money editors: admin, or a manager / accountant with financials);
   * written - tell them it is ready: the payee's e-mail / phone (the bill's vendor contact, the quote it is billed
     against, or a name match in Contacts - a guess is labelled one), the message as a draft in the accountant's own
     mail, and "Told by email / phone / text / in person" (rpc payment_told, versioned) so DCR Agents 2's check
     pick-up never tells them twice;
   * ready to enter in QuickBooks: the approved bills with their paperwork, a CSV built here in the browser (the
     formula guard, a BOM, CRLF), "Mark entered" (rpc mark_bills_entered: refused[] is shown in full, never a silent
     partial); money in: the invoices sent, their CSV and their own marker (rpc mark_invoices_entered);
   * not ready - and who it is on: waiting for an approval (only an admin or a manager with approve; an accountant
     NEVER approves - the bill page shows them no approve button) or for the paperwork;
   * already entered: Undo (rpc unmark_bills_entered / unmark_invoices_entered).

   Only with the financials switch: anyone else is told so and sent home before anything is read. */

import { boot, esc, toast, confirmBox, errorText, store, D } from "./shell.js";
import * as books from "../repo/books.js";
import * as filesRepo from "../repo/files.js";
import {
  fmtMoney, plural, daysLate, payMethodWords, parseAmount, amountAllowed, resolvePayee, pickupMessage, toCsv,
  BILL_COLUMNS, INVOICE_COLUMNS, csvName, cleanRef, refusedLines, MEMO_MAX, PAYEE_MAX, CHECK_NUMBER_MAX, REF_MAX, TOLD_HOWS,
  billHref, seesBooks,
} from "../map/books.js";
import { SIGNED_DOC_S } from "../map/files.js";
import { fmtDay } from "../map/pacific.js";

const VIEW_KEY = "dcr2_books_view";
/* Who records payments - the database's rule (app.can_edit('money')), in words: there is no "money switch". */
const WHO_PAYS = "Only an admin, or a manager or accountant with the financials switch, records payments.";
const NOT_YOURS = "read only - paid by an admin, or a manager or accountant with financials";
/* The check desk hides its "How" column below 560 px (accounting.html): the open panel spans what is shown. */
const NARROW = "(max-width: 560px)";
function panelSpan() { return window.matchMedia && matchMedia(NARROW).matches ? 3 : 4; }
function respan() { document.querySelectorAll("td.ck-cell").forEach((td) => { td.colSpan = panelSpan(); }); }
const money = fmtMoney;
const h = esc;
const state = { me: null, d: null, picked: {}, pickedInv: {}, openCheck: null, detail: null, tell: {}, refused: null, busy: false, mq: null };

function day(v) {
  const s = fmtDay(v);
  return s === "—" ? "" : s.replace(/, \d{4}$/, "");
}
function lateText(n) {
  if (n === null || n === undefined || n <= 0) return "";
  return n === 1 ? "1 day late" : n + " days late";
}
function company() { return (D().companyInfo && D().companyInfo.name) || (D().company) || "DCR Framing"; }

/* ── the summary: the picture, or the four tiles ── */

function view() { return store.get(VIEW_KEY, "picture") === "cards" ? "cards" : "picture"; }

function cardsHtml(t) {
  const c = [
    ["Ready to enter", money(t.readyAmount), plural(t.readyCount, "bill", "bills"), t.readyCount ? "go" : ""],
    ["Overdue among them", money(t.overdueAmount), t.overdueCount + " past due", t.overdueCount ? "late" : ""],
    ["Waiting on approval", money(t.waitingAmount), t.waitingCount + " not yours to action", t.waitingCount ? "wait" : ""],
    ["Money in to enter", money(t.arReadyAmount), plural(t.arReadyCount, "invoice", "invoices"), ""],
  ];
  return c.map((x) => '<div class="ac-card' + (x[3] ? " " + x[3] : "") + '"><div class="k">' + h(x[0]) + '</div><div class="v">' +
    h(x[1]) + '</div><div class="n">' + h(x[2]) + "</div></div>").join("");
}

function stageHtml(s, top) {
  const has = s.count > 0;
  const cls = !has ? "idle" : s.mine ? "mine" : s.theirs ? "theirs" : s.done ? "done" : "";
  const pct = has && top > 0 && s.amount ? Math.max(4, Math.round((s.amount / top) * 100)) : 0;
  return '<button type="button" class="bk-st ' + cls + '"' + (has ? ' data-jump="' + h(s.to) + '"' : " disabled") +
    ' aria-label="' + h(s.label + ": " + s.big + ", " + s.sub + (s.who ? ". " + s.who : "")) + '">' +
    (has && s.step ? '<span class="bk-step">Step ' + s.step + "</span>" : "") +
    '<span class="k">' + h(s.label) + '</span><span class="v">' + h(s.big) + '</span><span class="n">' + h(s.sub) + "</span>" +
    (has && s.flag ? '<span class="flag">' + h(s.flag) + "</span>" : "") +
    (has && s.chips && s.chips.length ? '<span class="bk-chips">' + s.chips.map((c) => '<span class="bk-chip ' + h(c[0]) + '">' + h(c[1]) + "</span>").join("") + "</span>" : "") +
    (pct ? '<span class="bar"><i style="width:' + pct + '%"></i></span>' : "") +
    (has && s.who ? '<span class="bk-who">' + h(s.who) + "</span>" : "") + "</button>";
}

function band(title, caption, total, stages, extra, seps) {
  const top = stages.reduce((n, s) => (s.count && s.amount > n ? s.amount : n), 0);
  let flow = "";
  stages.forEach((s, i) => {
    if (i) flow += '<span class="bk-arrow" aria-hidden="true">' + ((seps && seps[i - 1]) || "&rarr;") + "</span>";
    flow += stageHtml(s, top);
  });
  return '<div class="bk-band"><div class="bk-bh"><h4>' + h(title) + '</h4><span class="cap">' + h(caption) + "</span>" +
    (total ? '<span class="tot">' + h(total) + "</span>" : "") + '</div><div class="bk-flow">' + flow + "</div>" + (extra || "") + "</div>";
}

const AGE = [["late", "Already past due"], ["soon", "Due within 7 days"], ["later", "Later"], ["undated", "No due date"]];
function agingHtml(rows, today) {
  const b = { late: { n: 0, amt: 0 }, soon: { n: 0, amt: 0 }, later: { n: 0, amt: 0 }, undated: { n: 0, amt: 0 } };
  rows.forEach((r) => {
    const late = daysLate(r.dueDate, today);
    const until = late === null ? null : -late;
    const k = until === null ? "undated" : until < 0 ? "late" : until <= 7 ? "soon" : "later";
    b[k].n += 1;
    b[k].amt += Number(r.owed) || 0;
  });
  const total = AGE.reduce((n, a) => n + b[a[0]].amt, 0);
  if (!total) return "";
  const line = b.late.amt
    ? '<b class="late">' + money(b.late.amt) + "</b> of the " + money(total) + " approved and still owed is already past due."
    : "Nothing approved and still owed is past due yet.";
  return '<div class="bk-age"><div class="ln">' + line + '</div><div class="bk-agebar" role="img" aria-label="' +
    h(AGE.map((a) => b[a[0]].n + " " + a[1].toLowerCase()).join(", ")) + '">' +
    AGE.map((a) => { const w = (b[a[0]].amt / total) * 100; return w > 0 ? '<span class="' + a[0] + '" style="width:' + w.toFixed(2) + '%"></span>' : ""; }).join("") +
    '</div><div class="bk-legend">' + AGE.map((a) => (b[a[0]].n ? '<span><i class="' + a[0] + '"></i>' + h(a[1]) + " — " +
      h(plural(b[a[0]].n, "bill", "bills")) + ", " + money(b[a[0]].amt) + "</span>" : "")).join("") + "</div></div>";
}

const STAGE_OF = { check: "pay", cash: "pay", either: "pay", tell: "tell", waiting: "decide", qbo: "qbo", ar: "ar" };

function picture(d) {
  const t = d.totals, c = d.checks.totals, can = d.can || {};
  const step = {};
  let n = 0;
  d.todo.forEach((x) => { const s = STAGE_OF[x.kind]; if (s && !step[s]) step[s] = ++n; });
  const stuck = d.waiting.concat(d.blocked);
  const stuckAmount = stuck.reduce((s, b) => s + b.amount, 0);
  const chips = [];
  if (c.checkCount) chips.push(["check", plural(c.checkCount, "check", "checks")]);
  if (c.cashCount) chips.push(["cash", c.cashCount + " cash"]);
  if (c.eitherCount) chips.push(["either", c.eitherCount + " either"]);
  const out = [
    { to: "secWaiting", label: "Not ready", theirs: true, count: stuck.length, amount: stuckAmount, big: money(stuckAmount),
      sub: plural(stuck.length, "bill", "bills"), flag: t.blockedCount ? plural(t.blockedCount, "bill needs", "bills need") + " paperwork first" : "",
      who: "with a manager" },
    { to: "secPay", label: "To pay", step: step.pay, mine: !!can.pay, count: c.toPayCount, amount: c.toPayAmount, big: money(c.toPayAmount),
      sub: plural(c.toPayCount, "bill", "bills"), chips, who: can.pay ? "yours to do" : NOT_YOURS },
    { to: "secTell", label: "Paid — tell them to collect", step: step.tell, mine: !!can.pay, count: c.toTellCount, amount: c.toTellAmount,
      big: money(c.toTellAmount), sub: plural(c.toTellCount, "payment", "payments"), who: can.pay ? "yours to do" : NOT_YOURS },
  ];
  const keyed = [
    { to: "secQbo", label: "Bills to key in", step: step.qbo, mine: !!can.mark, count: t.readyCount, amount: t.readyAmount, big: money(t.readyAmount),
      sub: plural(t.readyCount, "bill", "bills"), who: can.mark ? "yours to do" : "read only",
      flag: t.overdueCount ? t.overdueCount + " past due · " + money(t.overdueAmount) : "" },
    { to: "secEntered", label: "Bills on the books", done: true, count: t.enteredCount, amount: 0, big: String(t.enteredCount),
      sub: plural(t.enteredCount, "bill keyed", "bills keyed"), who: "done" },
    { to: "secAr", label: "Invoices to key in", step: step.ar, mine: !!can.mark, count: t.arReadyCount, amount: t.arReadyAmount, big: money(t.arReadyAmount),
      sub: plural(t.arReadyCount, "invoice", "invoices"), who: can.mark ? "yours to do" : "read only" },
    { to: "secEntered", label: "Invoices on the books", done: true, count: t.arEnteredCount, amount: 0, big: String(t.arEnteredCount),
      sub: plural(t.arEnteredCount, "invoice keyed", "invoices keyed"), who: "done" },
  ];
  const owed = d.checks.toPay.concat(d.checks.toDecide);
  const owedOut = c.toPayAmount + c.toDecideAmount;
  const held = c.toDecideCount
    ? '<button type="button" class="bk-st theirs" data-jump="secDecide" style="width:100%;margin-top:12px"><span class="k">Held up</span><span class="n">' +
      h(plural(c.toDecideCount, "approved bill", "approved bills") + " — " + money(c.toDecideAmount) +
        " — cannot be paid: nobody recorded check or cash. A manager or admin sets it on the bill.") + "</span></button>"
    : "";
  let s = '<div class="bk">' +
    band("Money out the door", "Left to right, what happens to a bill.", owedOut ? money(owedOut) + " approved and still owed" : "", out,
      held + agingHtml(owed, d.today)) +
    band("Into QuickBooks", "Keying, not money — a bill can be keyed before it is paid. Bills and invoices each get a done marker.", "",
      keyed, "", ["&rarr;", "+", "&rarr;"]);
  const nothing = !stuck.length && !c.toPayCount && !c.toDecideCount && !c.toTellCount && !t.readyCount && !t.arReadyCount;
  if (nothing) s += '<div class="bk-quiet">Nothing anywhere. No bill and no invoice is waiting on anybody.</div>';
  return s + '<div class="bk-foot"><b>Blue</b> is yours to do. <b>Gold</b> is waiting on a manager and is not yours to action. ' +
    "Click any box to jump to it.</div></div>";
}

function paintView() {
  const g = document.getElementById("acView");
  if (!g) return;
  const as = view();
  g.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b.getAttribute("data-view") === as ? "true" : "false"));
}

function summary(d) {
  const box = document.getElementById("acCards");
  const as = view();
  box.className = as === "picture" ? "" : "ac-cards";
  box.innerHTML = as === "picture" ? picture(d) : cardsHtml(d.totals);
  paintView();
  box.querySelectorAll("[data-jump]").forEach((b) => b.addEventListener("click", () => jump(b.getAttribute("data-jump"))));
}

/* Scrolled to AND marked, once the scrolling has stopped. */
function jump(id) {
  const s = document.getElementById(id);
  if (!s) return;
  const easy = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  s.scrollIntoView({ behavior: easy ? "auto" : "smooth", block: "start" });
  let last = null, tries = 0;
  (function settle() {
    const y = Math.round(window.scrollY);
    if (y === last || ++tries > 40) {
      s.classList.remove("ac-flash");
      void s.offsetWidth;
      s.classList.add("ac-flash");
      return;
    }
    last = y;
    setTimeout(settle, 60);
  })();
}

/* ── rows ── */

function kindTag(b) { return b.kindLabel ? '<span class="kind">' + h(b.kindLabel) + "</span>" : ""; }

function billRow(b, opts) {
  const o = opts || {};
  const late = o.entered ? "" : lateText(b.lateBy);
  return "<tr>" +
    (o.pick ? '<td><input type="checkbox" data-pick="' + h(b.id) + '" aria-label="Pick ' + h(b.vendor || "this bill") + '"' +
      (state.picked[b.id] ? " checked" : "") + "></td>" : "") +
    '<td><span class="who">' + h(b.vendor || "(no vendor)") + "</span>" +
      (b.invoiceNumber ? ' <span class="meta">#' + h(b.invoiceNumber) + "</span>" : "") + kindTag(b) +
      '<div class="meta">' + h(b.projectLabel || "(no job)") + (b.dueDate ? " · due " + h(day(b.dueDate)) : "") + "</div>" +
      (late ? '<span class="late">' + h(late) + "</span>" : "") +
      (o.reason && b.reason ? '<div class="reason">' + h(b.reason) + "</div>" : "") +
      (o.entered ? '<div class="meta">entered ' + h(day(b.enteredDay)) + (b.enteredByName ? " by " + h(b.enteredByName) : "") +
        (b.qboRef ? " · " + h(b.qboRef) : "") + "</div>" : "") +
    "</td>" +
    '<td class="num">' + money(b.amount) + "</td>" +
    '<td class="num"><a href="' + h(billHref(b.id)) + '">Open &rarr;</a></td>' +
    (o.entered ? '<td class="num">' + (o.undo ? '<a href="#" data-undo="' + h(b.id) + '">Undo</a>' : "") + "</td>" : "") +
    "</tr>";
}

function invoiceRow(iv, opts) {
  const o = opts || {};
  const late = o.entered ? "" : lateText(iv.lateBy);
  return "<tr>" +
    (o.pick ? '<td><input type="checkbox" data-pickinv="' + h(iv.id) + '" aria-label="Pick invoice ' + h(iv.number) + '"' +
      (state.pickedInv[iv.id] ? " checked" : "") + "></td>" : "") +
    '<td><span class="who">' + h(iv.customer || iv.number || "Invoice") + "</span>" +
      (iv.number ? ' <span class="meta">#' + h(iv.number) + "</span>" : "") +
      '<div class="meta">' + h(iv.projectLabel || "") + (iv.sentDate ? " · sent " + h(day(iv.sentDate)) : "") +
        (iv.dueDate ? " · due " + h(day(iv.dueDate)) : "") + "</div>" +
      (late ? '<span class="late">' + h(late) + "</span>" : "") +
      (o.entered ? '<div class="meta">entered ' + h(day(iv.enteredDay)) + (iv.enteredByName ? " by " + h(iv.enteredByName) : "") +
        (iv.qboRef ? " · " + h(iv.qboRef) : "") + "</div>" : "") +
    "</td>" +
    '<td class="num">' + money(iv.amount) + "</td>" +
    '<td class="num">' + (iv.isPaid ? "Paid" : iv.paid > 0 ? "Part paid" : "Unpaid") + "</td>" +
    (o.entered ? '<td class="num">' + (o.undo ? '<a href="#" data-undoinv="' + h(iv.id) + '">Undo</a>' : "") + "</td>" : "") +
    "</tr>";
}

/* head: [label, numeric, phone width class (c-pick | c-go | c-undo | c-st)] - on a phone the table is laid out fixed, so the
   first column takes what is left and wraps instead of pushing the page sideways */
function table(rows, head, render) {
  return '<table class="ac-t"><thead><tr>' + head.map((x) => '<th class="' + [x[1] ? "num" : "", x[2] || ""].join(" ").trim() + '">' + h(x[0]) + "</th>").join("") +
    "</tr></thead><tbody>" + rows.map(render).join("") + "</tbody></table>";
}

function refusedBox(which) {
  const r = state.refused;
  if (!r || r.which !== which) return "";
  return '<div class="ac-refused" role="status"><b>' + h(r.title) + "</b>" +
    (r.lines.length ? "<ul>" + r.lines.map((l) => "<li>" + h(l) + "</li>").join("") + "</ul>" : "") + "</div>";
}

/* ── checks ── */

const METHOD_CHIP = { check: ["check", "check"], cash: ["cash", "cash"], both: ["either", "check or cash"] };
function methodChip(m) {
  const x = METHOD_CHIP[m];
  return x ? '<span class="ck-method ' + h(x[0]) + '">' + h(x[1]) + "</span>" : '<span class="ck-method none">not set</span>';
}

const PILES = {
  pay: { key: "toPay", id: "secPay", title: "Bills to pay", act: "Pay",
    hint: "Approved and still owed. Each row says how it was authorised — open it to see the paperwork and record the payment.",
    empty: "Nothing owed. Every approved bill has been paid." },
  decide: { key: "toDecide", id: "secDecide", title: "Approved — but nobody said how to pay", act: "Open",
    hint: "A manager or admin sets the payment method on the bill; it is not yours to choose.", empty: "" },
};

function pile(c, can, which) {
  const P = PILES[which];
  const rows = c[P.key] || [];
  const amount = rows.reduce((n, b) => n + (Number(b.owed) || 0), 0);
  if (!rows.length && which === "decide") return "";
  let s = '<div class="ac-sec" id="' + P.id + '"><header><h3>' + h(P.title) + '</h3><span class="hint">' + h(P.hint) +
    '</span><span class="grow"></span><span class="hint">' + rows.length + " waiting · " + money(amount) + "</span></header>";
  if (!rows.length) return s + '<div class="ac-none">' + h(P.empty) + "</div></div>";
  if (!can.pay && which !== "decide") {
    s += '<div class="ac-note">These are approved and waiting to be paid. ' + h(WHO_PAYS) + "</div>";
  }
  s += '<table class="ac-t ck-t"><thead><tr><th>Pay to</th><th class="hide-sm">How</th><th class="num">Amount</th><th class="num c-go"></th></tr></thead><tbody>';
  rows.forEach((b) => {
    const open = String(state.openCheck) === String(b.id);
    s += '<tr class="ck-row" data-open="' + h(b.id) + '" tabindex="0" aria-expanded="' + open + '">' +
      '<td><div class="ck-payee">' + h(b.payee || "(no payee on file)") + "</div>" +
        '<div class="ck-for">' + h(b.memo || b.projectLabel || "") + (b.partial ? '<span class="ck-part">part paid</span>' : "") + "</div></td>" +
      '<td class="hide-sm">' + methodChip(b.payMethod) + "</td>" +
      '<td class="num"><b>' + money(b.owed) + "</b>" + (b.partial ? '<div class="ck-for">of ' + money(b.approvedFor) + "</div>" : "") + "</td>" +
      '<td class="num">' + (open ? "Close" : h(P.act) + " &rarr;") + "</td></tr>";
    // the panel spans exactly the columns shown (a phone hides "How": a colspan of 4 there adds an empty column)
    if (open) s += '<tr class="ck-open"><td class="ck-cell" colspan="' + panelSpan() + '">' + checkPanel(b, can, which) + "</td></tr>";
  });
  return s + "</tbody></table></div>";
}

/* The panel: what to write on the check, and everything it is written against. */
function checkPanel(b, can, which) {
  const d = state.detail;
  if (!d || String(d.bill.id) !== String(b.id)) return '<div class="ck-panel"><div class="ac-none">Loading the paperwork…</div></div>';
  if (which === "decide") {
    return '<div class="ck-panel"><div class="ac-note">This bill was approved for ' + money(b.approvedFor) + ", but nobody recorded whether to " +
      "pay it by check or in cash. A manager or admin sets that on the bill — it is an authorisation, not a bookkeeping choice." +
      '</div><div class="ck-acts"><a class="ac-b" href="' + h(billHref(b.id)) + '">Open the bill &rarr;</a><button type="button" class="ac-b" id="ckClose">Close</button></div></div>';
  }
  const allowed = b.allowed || [];
  let s = '<div class="ck-panel" id="ckPanel">';
  s += '<div class="ck-grid">' +
    '<div class="ck-f"><label for="ckPayee">Make it out to</label><input id="ckPayee" class="big" value="' + h(b.payee) + '" maxlength="' + PAYEE_MAX + '">' +
      (b.payeeNote ? '<div class="sub warn">' + h(b.payeeNote) + "</div>"
        : b.payeePerson && b.payeePerson !== b.payee ? '<div class="sub">Their contact person: ' + h(b.payeePerson) + ".</div>" : "") + "</div>" +
    '<div class="ck-f"><label for="ckAmount">Amount</label><input id="ckAmount" class="big" inputmode="decimal" value="' + h(Number(b.owed).toFixed(2)) + '">' +
      '<div class="sub">' + (b.alreadyPaid > 0 ? money(b.alreadyPaid) + " already paid of " + money(b.approvedFor) + " approved."
        : "Approved for " + money(b.approvedFor) + ".") + "</div></div>" +
    '<div class="ck-f"><label for="ckNumber" id="ckRefLab">Check number</label><input id="ckNumber" placeholder="e.g. 2041" maxlength="' + CHECK_NUMBER_MAX + '">' +
      '<div class="sub" id="ckRefSub">So it can be found again.</div></div></div>' +
    (allowed.length > 1
      ? '<div class="ck-f" style="margin-bottom:14px"><span class="lab">How are you paying this one?</span><div class="ck-methods" id="ckHow">' +
        allowed.map((m) => '<button type="button" class="ck-mbtn" data-how="' + h(m) + '" aria-pressed="false">' + (m === "cash" ? "In cash" : "By check") + "</button>").join("") +
        '</div><div class="sub">Approved either way. Pay part of it now and the rest the other way if that suits — each payment is recorded separately.</div></div>'
      : '<input type="hidden" id="ckHowFixed" value="' + h(allowed[0] || "") + '">') +
    '<div class="ck-f" style="margin-bottom:14px"><label for="ckMemo">Memo — what the payment is for</label><input id="ckMemo" value="' + h(b.memo) +
      '" maxlength="' + MEMO_MAX + '"></div>';

  s += '<div class="ck-docs"><h4>What you are paying against</h4>';
  if (d.quote) {
    s += '<div class="ck-commit"><b>' + h(d.quote.kind) + "</b> — " + h(d.quote.vendor || b.vendor) +
      (d.quote.amount !== null && d.quote.amount !== undefined ? " · " + money(d.quote.amount) : "") +
      (d.quote.status ? " · " + h(d.quote.status) : "") + '<div class="ck-for">This bill names this ' + h(d.quote.kind.toLowerCase()) + ".</div></div>";
  }
  if (d.files.length) {
    d.files.forEach((f, i) => {
      s += '<div class="ck-doc">' + (f.cloud && f.storagePath
        ? '<button type="button" class="lnk" data-doc="' + i + '">' + h(f.name) + "</button>"
        : '<span class="nm">' + h(f.name) + "</span>") +
        '<span class="tag">' + (f.primary ? "the bill's document" : "attached to the bill") + (f.cloud ? "" : " · on the office computers") + "</span></div>";
    });
    // images are shown here; a PDF opens in its own tab (the page's policy lets no other site's file into a frame)
    if (d.files.some((f) => isImage(f) && f.cloud && f.storagePath)) s += '<div class="ck-viewer" id="ckViewer">Pick a picture to look at it here.</div>';
    else s += '<div class="ck-none-note">A PDF opens in its own tab.</div>';
  } else {
    s += '<div class="ck-none-note">No files are attached to this bill.</div>';
  }
  s += '<div style="margin-top:10px"><a class="ac-b" href="' + h(billHref(b.id)) + '">Open the full bill screen &rarr;</a></div></div>';

  const written = d.payments || [];
  if (written.length) {
    const paid = written.reduce((n, w) => n + w.amount, 0);
    s += '<div class="ck-docs"><h4>Already paid on this bill</h4>';
    written.forEach((w) => {
      const cash = w.method === "cash";
      s += '<div class="ck-doc"><span class="nm">' + (cash ? "Cash" : w.method === "check" ? "Check #" + h(w.checkNumber) : h(w.method)) + " · " + money(w.amount) +
        "</span>" + methodChip(cash ? "cash" : "check") + '<span class="tag">' + h(day(w.paidDate)) +
        (w.collectable ? (w.toldAt ? " · told " + h(w.toldHow) + " " + h(day(w.toldDay)) : " · not told yet") : "") + "</span></div>";
    });
    s += '<div class="ck-doc"><span class="nm">' + money(paid) + " paid · " + money(b.owed) + " still owed</span></div></div>";
  }
  s += '<div class="ck-acts">' +
    (can.pay ? '<button type="button" class="btn-accept" id="ckWrite">&#10003; Record the payment</button>' : "") +
    '<button type="button" class="ac-b" id="ckClose">Close</button><span class="ac-msg" id="ckMsg"></span></div>';
  return s + "</div>";
}

/* ── telling them it is ready ── */
function checksToTell(c, can) {
  let s = '<div class="ac-sec" id="secTell"><header><h3>Written — tell them it is ready</h3><span class="hint">The check or cash is ready. ' +
    "Nobody has told the payee to come and collect it.</span></header>";
  if (!c.toTell.length) return s + '<div class="ac-none">Everyone with a check or cash waiting has been told.</div></div>';
  c.toTell.forEach((t) => {
    const k = state.tell[t.paymentId] || {};
    s += '<div class="ck-tell"><div class="top"><div><span class="ck-payee">' + h(t.payee || "(no payee)") + "</span>" +
      '<div class="ck-for">' + (t.isCash ? "Cash" + (t.checkNumber ? " · " + h(t.checkNumber) : "") : "Check #" + h(t.checkNumber)) +
        " · " + h(day(t.writtenDate)) + '<span class="ck-method' + (t.isCash ? " cash" : "") + '">' + (t.isCash ? "cash" : "check") + "</span></div>" +
      '<div class="ck-for">' + h(t.projectLabel) + "</div></div>" +
      '<div class="ck-payee">' + money(t.amount) + "</div></div>";
    if (!k.loaded) {
      s += '<div class="ck-acts"><button type="button" class="ac-b" data-load="' + h(t.paymentId) + '">How do I reach them?</button></div></div>';
      return;
    }
    const w = k.contact || {};
    if (!w.email && !w.phone) {
      s += '<div class="ck-how none">No email or phone on file for them.</div><div class="ck-none-note">The payment is ready and waiting. ' +
        "Add a contact in DCR Desktop 2, or tell them next time they call.</div>";
    } else {
      s += '<div class="ck-how ' + (w.needsConfirming ? "guess" : "certain") + '">' + h(w.why || "") + "</div>" +
        '<div class="ck-none-note">' + (w.email ? "Email: " + h(w.email) : "") + (w.email && w.phone ? " · " : "") + (w.phone ? "Phone: " + h(w.phone) : "") + "</div>";
    }
    s += '<div class="ck-msg-box">' + h(k.message.body) + '</div><div class="ck-acts">';
    if (w.email) s += '<a class="btn-accept" data-mail="' + h(t.paymentId) + '" href="#">Open the email</a>';
    if (w.phone) s += '<a class="ac-b" href="tel:' + h(String(w.phone).replace(/[^0-9+]/g, "")) + '">Call ' + h(w.phone) + "</a>";
    s += '<button type="button" class="ac-b" data-copy="' + h(t.paymentId) + '">Copy the message</button>';
    if (can.pay) {
      TOLD_HOWS.forEach((x) => {
        if ((x.id === "email" && !w.email) || ((x.id === "phone" || x.id === "text") && !w.phone)) return;
        s += '<button type="button" class="ac-b go" data-told="' + h(t.paymentId) + '" data-how="' + h(x.id) + '">&#10003; ' + h(x.label) + "</button>";
      });
    }
    s += '<span class="ac-msg" id="tellMsg' + h(t.paymentId) + '"></span></div><div class="ck-none-note" style="margin-top:6px">Portal 2 sends no email ' +
      "itself — this opens the message in your own email, already written. Press Send there, then mark it here.</div></div>";
  });
  return s + "</div>";
}

/* ── what needs doing ── */
const TODO_ICON = { check: "✎", cash: "◉", either: "◐", tell: "☎", waiting: "⏸", qbo: "⇨", ar: "⇦" };

function todoBlock(d) {
  const items = d.todo || [];
  const sp = d.spend;
  let s = '<div class="ac-sec ac-todo" id="secTodo"><header><h3>What needs doing</h3><span class="hint">' +
    (items.length ? "In the order it makes sense to do it." : "Nothing is waiting on you right now.") + "</span></header>";
  if (items.length) {
    s += '<ul class="ac-todo-list">' + items.map((t) => '<li class="' + h(t.kind) + '"><span class="ic" aria-hidden="true">' + (TODO_ICON[t.kind] || "•") +
      '</span><span class="tx"><a href="#' + h(t.to) + '" data-jumpto="' + h(t.to) + '">' + h(t.text) + '</a></span><span class="am">' + money(t.amount) + "</span></li>").join("") + "</ul>";
  }
  if (sp && sp.count) {
    // the ledger's own words and sums for the same 30 days (map/books.js spendGlance)
    s += '<div class="ac-glance">Last ' + sp.days + " days: " + plural(sp.count, "record", "records") + " · <b>" + money(sp.cost) + "</b> cost" +
      (sp.other ? " · " + money(sp.other) + " equipment &amp; other" : "") +
      (sp.noReceipt ? ' · <span class="warn">' + sp.noReceipt + " with no receipt</span>" : "") + ' · <a href="ledger.html">See all expenses &rarr;</a></div>';
  } else if (sp) {
    s += '<div class="ac-glance">No costs recorded in the last ' + sp.days + ' days. <a href="ledger.html">See all expenses &rarr;</a></div>';
  }
  return s + "</div>";
}

/* ── the page ── */

function render() {
  const d = state.d, can = d.can || {};
  summary(d);
  let s = todoBlock(d);
  s += pile(d.checks, can, "pay");
  s += pile(d.checks, can, "decide");
  s += checksToTell(d.checks, can);

  // ready to enter (bills)
  s += '<div class="ac-sec" id="secQbo"><header><h3>Ready to enter in QuickBooks</h3><span class="hint">Approved, with the paperwork behind it.</span>' +
    '<span class="grow"></span><button type="button" class="ac-b" id="acCsv"' + (d.ready.length ? "" : " disabled") + '>&#8615; Export CSV</button></header>';
  if (!d.ready.length) {
    s += '<div class="ac-none">Nothing waiting to be entered. The books are up to date.</div>';
  } else {
    s += table(d.ready, can.mark ? [["", 0, "c-pick"], ["Bill", 0], ["Amount", 1], ["", 1, "c-go"]] : [["Bill", 0], ["Amount", 1], ["", 1, "c-go"]], (b) => billRow(b, { pick: !!can.mark }));
    if (can.mark) {
      s += '<div class="ac-actions"><button type="button" class="ac-b" id="acAll">Select all</button>' +
        '<input class="ac-ref" id="acRef" placeholder="QuickBooks ref (optional)" maxlength="' + REF_MAX + '" aria-label="QuickBooks reference">' +
        '<button type="button" class="ac-b go" id="acMark" disabled>&#10003; Mark entered</button><span class="hint" id="acCount"></span></div>';
    }
    s += '<div class="ac-note"><b>Before you import:</b> QuickBooks Online only imports bills from a spreadsheet on Advanced (Spreadsheet Sync) or through a ' +
      "third-party importer — Essentials and Plus have no native bill import, so on those plans this file is for keying from, not uploading. Vendor " +
      "names must already match QuickBooks exactly or an import creates duplicates. The <b>Portal Bill ID</b> column is how a row is matched back here.</div>";
  }
  s += refusedBox("bills") + '<div class="ac-msg" id="acMsg"></div></div>';

  // money in (invoices) - now with their own marker (M5b)
  s += '<div class="ac-sec" id="secAr"><header><h3>Money in — invoices we sent</h3><span class="hint">Sent to the client and not yet in the books.</span>' +
    '<span class="grow"></span><button type="button" class="ac-b" id="acCsvInv"' + (d.ar.ready.length ? "" : " disabled") + '>&#8615; Export CSV</button></header>';
  if (!d.ar.ready.length) {
    s += '<div class="ac-none">Nothing to enter on the money-in side.</div>';
  } else {
    s += table(d.ar.ready, can.mark ? [["", 0, "c-pick"], ["Invoice", 0], ["Amount", 1], ["Status", 1, "c-st"]] : [["Invoice", 0], ["Amount", 1], ["Status", 1, "c-st"]],
      (iv) => invoiceRow(iv, { pick: !!can.mark }));
    if (can.mark) {
      s += '<div class="ac-actions"><button type="button" class="ac-b" id="acAllInv">Select all</button>' +
        '<input class="ac-ref" id="acRefInv" placeholder="QuickBooks ref (optional)" maxlength="' + REF_MAX + '" aria-label="QuickBooks reference for the invoices">' +
        '<button type="button" class="ac-b go" id="acMarkInv" disabled>&#10003; Mark entered</button><span class="hint" id="acCountInv"></span></div>';
    }
  }
  s += '<div class="ac-note">QuickBooks Online does import invoices from CSV natively (Settings &rarr; Import data &rarr; Invoices). ' +
    "Customers must exist there first.</div>" + refusedBox("invoices") + "</div>";

  // not yours to action
  if (d.waiting.length || d.blocked.length) {
    s += '<div class="ac-sec" id="secWaiting"><header><h3>Not ready — and who it is on</h3><span class="hint">Nothing here is yours to action; ' +
      "it is here so you are not waiting on it blind. Only an admin or a manager with approve authority approves a bill.</span></header>";
    s += table(d.waiting.concat(d.blocked), [["Bill", 0], ["Amount", 1], ["", 1, "c-go"]], (b) => billRow(b, { reason: true }));
    s += "</div>";
  }

  // already entered
  s += '<div class="ac-sec" id="secEntered"><header><h3>Already entered</h3><span class="hint">' +
    h(plural(d.entered.length, "bill", "bills") + " and " + plural(d.ar.entered.length, "invoice", "invoices")) + " on the books." +
    (can.mark ? " Undo if you marked one by mistake." : "") + "</span></header>";
  s += d.entered.length
    ? table(d.entered.slice(0, 40), [["Bill", 0], ["Amount", 1], ["", 1, "c-go"], ["", 1, "c-undo"]], (b) => billRow(b, { entered: true, undo: !!can.mark }))
    : '<div class="ac-none">No bill marked as entered yet.</div>';
  if (d.ar.entered.length) {
    s += '<div style="margin-top:12px">' + table(d.ar.entered.slice(0, 20), [["Invoice", 0], ["Amount", 1], ["Status", 1, "c-st"], ["", 1, "c-undo"]],
      (iv) => invoiceRow(iv, { entered: true, undo: !!can.mark })) + "</div>";
  }
  s += refusedBox("undo") + "</div>";

  document.getElementById("acBody").innerHTML = s;
  wire();
}

function wire() {
  const box = document.getElementById("acBody");
  box.querySelectorAll("[data-jumpto]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); jump(a.getAttribute("data-jumpto")); }));
  box.querySelectorAll("[data-pick]").forEach((cb) => cb.addEventListener("change", () => {
    const id = cb.getAttribute("data-pick");
    if (cb.checked) state.picked[id] = true; else delete state.picked[id];
    syncPick();
  }));
  box.querySelectorAll("[data-pickinv]").forEach((cb) => cb.addEventListener("change", () => {
    const id = cb.getAttribute("data-pickinv");
    if (cb.checked) state.pickedInv[id] = true; else delete state.pickedInv[id];
    syncPick();
  }));
  const all = document.getElementById("acAll");
  if (all) all.addEventListener("click", () => {
    const want = Object.keys(state.picked).length < state.d.ready.length;
    state.picked = {};
    if (want) state.d.ready.forEach((b) => { state.picked[b.id] = true; });
    box.querySelectorAll("[data-pick]").forEach((cb) => { cb.checked = !!state.picked[cb.getAttribute("data-pick")]; });
    syncPick();
  });
  const allInv = document.getElementById("acAllInv");
  if (allInv) allInv.addEventListener("click", () => {
    const want = Object.keys(state.pickedInv).length < state.d.ar.ready.length;
    state.pickedInv = {};
    if (want) state.d.ar.ready.forEach((iv) => { state.pickedInv[iv.id] = true; });
    box.querySelectorAll("[data-pickinv]").forEach((cb) => { cb.checked = !!state.pickedInv[cb.getAttribute("data-pickinv")]; });
    syncPick();
  });
  const mark = document.getElementById("acMark");
  if (mark) mark.addEventListener("click", () => doMark("bills"));
  const markInv = document.getElementById("acMarkInv");
  if (markInv) markInv.addEventListener("click", () => doMark("invoices"));
  box.querySelectorAll("[data-undo]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); doUnmark("bills", a.getAttribute("data-undo")); }));
  box.querySelectorAll("[data-undoinv]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); doUnmark("invoices", a.getAttribute("data-undoinv")); }));
  const csv = document.getElementById("acCsv");
  if (csv) csv.addEventListener("click", () => download("bills"));
  const csvI = document.getElementById("acCsvInv");
  if (csvI) csvI.addEventListener("click", () => download("invoices"));
  wireChecks();
  syncPick();
}

function syncPick() {
  const d = state.d;
  const one = (picked, rows, markId, countId) => {
    const n = Object.keys(picked).length;
    const mark = document.getElementById(markId), count = document.getElementById(countId);
    if (mark) mark.disabled = n === 0 || state.busy;
    if (count) {
      const amt = rows.filter((r) => picked[r.id]).reduce((t, r) => t + r.amount, 0);
      count.textContent = n ? n + " selected · " + money(amt) : "";
    }
  };
  one(state.picked, d.ready, "acMark", "acCount");
  one(state.pickedInv, d.ar.ready, "acMarkInv", "acCountInv");
}

/* The CSV, built here in the browser (Q13): every cell quoted, a formula-looking cell made text, a BOM, CRLF. */
function download(which) {
  const d = state.d;
  const rows = which === "bills" ? d.ready : d.ar.ready;
  if (!rows.length) return;
  const text = toCsv(rows, which === "bills" ? BILL_COLUMNS : INVOICE_COLUMNS);
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = csvName(which, d.today);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast("The CSV is downloading: " + plural(rows.length, which === "bills" ? "bill" : "invoice", which === "bills" ? "bills" : "invoices") + ".", "ok");
}

async function doMark(which) {
  const bills = which === "bills";
  const picked = bills ? state.picked : state.pickedInv;
  const rows = bills ? state.d.ready : state.d.ar.ready;
  const ids = Object.keys(picked);
  if (!ids.length || state.busy) return;
  const amt = rows.filter((r) => picked[r.id]).reduce((t, r) => t + r.amount, 0);
  const noun = bills ? plural(ids.length, "bill", "bills") : plural(ids.length, "invoice", "invoices");
  const sure = await confirmBox("Mark " + noun + " (" + money(amt) + ") as entered in QuickBooks? This records that you have keyed them — " +
    "it does not send anything to Intuit.", { title: "Mark entered", okText: "Mark entered" });
  if (!sure) return;
  const ref = cleanRef((document.getElementById(bills ? "acRef" : "acRefInv") || {}).value || "");
  const msg = document.getElementById("acMsg");
  state.busy = true;
  syncPick();
  if (msg && bills) { msg.textContent = "Recording…"; msg.className = "ac-msg"; }
  let r;
  try {
    r = bills ? await books.markBillsEntered(ids, ref) : await books.markInvoicesEntered(ids, ref);
  } catch (e) {
    state.busy = false;
    syncPick();
    toast(errorText(e), "error");
    if (msg && bills) { msg.textContent = errorText(e); msg.className = "ac-msg err"; }
    return;
  }
  const byId = bills ? state.d.byId : state.d.invoicesById;
  if (bills) state.picked = {}; else state.pickedInv = {};
  state.refused = r.refused.length
    ? { which: bills ? "bills" : "invoices", title: r.count + " marked, " + r.refused.length + " not:", lines: refusedLines(r.refused, byId) }
    : null;
  state.busy = false;
  await load();
  /* A partial result is reported in full. Silently marking eight of ten is how two of them get entered twice. */
  if (r.refused.length) {
    const al = D().alert;
    if (typeof al === "function") al(refusedLines(r.refused, byId).join("\n"), { title: r.count + " marked, " + r.refused.length + " not" });
  } else {
    toast(plural(r.count, bills ? "bill" : "invoice", bills ? "bills" : "invoices") + " marked entered.", "ok");
  }
}

async function doUnmark(which, id) {
  const bills = which === "bills";
  const sure = await confirmBox("Put this " + (bills ? "bill" : "invoice") + " back on the ready list?", { title: "Undo", okText: "Undo" });
  if (!sure) return;
  let r;
  try {
    r = bills ? await books.unmarkBillsEntered([id]) : await books.unmarkInvoicesEntered([id]);
  } catch (e) { toast(errorText(e), "error"); return; }
  const byId = bills ? state.d.byId : state.d.invoicesById;
  state.refused = r.refused.length ? { which: "undo", title: "Not undone:", lines: refusedLines(r.refused, byId) } : null;
  await load();
  if (!r.refused.length) toast("Back on the ready list.", "ok");
}

/* ── the check desk ── */

function chosenMethod() {
  const fixed = document.getElementById("ckHowFixed");
  if (fixed) return fixed.value || "";
  const on = document.querySelector("#ckHow [data-how][aria-pressed='true']");
  return on ? on.getAttribute("data-how") : "";
}

function paintMethod() {
  const m = chosenMethod();
  const lab = document.getElementById("ckRefLab"), sub = document.getElementById("ckRefSub"), num = document.getElementById("ckNumber");
  if (!lab) return;
  if (m === "cash") {
    lab.textContent = "Reference (optional)";
    sub.textContent = "Cash has no number of its own. Anything that helps you find it later.";
    if (num) num.placeholder = "e.g. petty cash slip";
  } else {
    lab.textContent = "Check number";
    sub.textContent = "So it can be found again.";
    if (num) num.placeholder = "e.g. 2041";
  }
  const go = document.getElementById("ckWrite");
  if (go) {
    go.textContent = m === "cash" ? "✓ Record the cash payment" : m === "check" ? "✓ Record the check" : "✓ Record the payment";
    go.disabled = !m;
  }
}

function isImage(f) { return /^image\/(jpeg|png|gif|webp)$/i.test(f.mime || "") || /\.(jpe?g|png|gif|webp)$/i.test(f.name || ""); }

async function showDoc(i) {
  const d = state.detail;
  const f = d && d.files[i];
  const box = document.getElementById("ckViewer");
  const image = !!f && isImage(f) && !!box;
  if (!f) return;
  if (box) box.textContent = "Opening…";
  const w = image ? null : window.open("", "_blank");
  try {
    const url = await filesRepo.signedUrl(f.storagePath, SIGNED_DOC_S);
    if (!url) throw new Error("No link for this file.");
    if (image) {
      box.innerHTML = "";
      const img = document.createElement("img");
      img.alt = f.name;
      img.src = url;
      box.appendChild(img);
    } else {
      if (w) w.location.href = url; else location.href = url;
      if (box) box.textContent = f.name + " opened in a new tab.";
    }
  } catch (e) {
    if (w) w.close();
    if (box) box.textContent = errorText(e); else toast(errorText(e), "error");
  }
}

function wireChecks() {
  const box = document.getElementById("acBody");
  box.querySelectorAll("[data-doc]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); showDoc(Number(b.getAttribute("data-doc"))); }));
  box.querySelectorAll("#ckHow [data-how]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    box.querySelectorAll("#ckHow [data-how]").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    paintMethod();
  }));
  paintMethod();
  const openRow = async (tr) => {
    const id = tr.getAttribute("data-open");
    if (String(state.openCheck) === String(id)) { state.openCheck = null; state.detail = null; render(); return; }
    state.openCheck = id; state.detail = null; render();
    try {
      state.detail = await books.loadBill(id, state.me);
    } catch (e) {
      state.openCheck = null;
      render();
      toast(errorText(e), "error");
      return;
    }
    if (String(state.openCheck) === String(id)) render();
  };
  box.querySelectorAll("[data-open]").forEach((tr) => {
    tr.addEventListener("click", () => openRow(tr));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRow(tr); } });
  });
  const close = document.getElementById("ckClose");
  if (close) close.addEventListener("click", (e) => { e.stopPropagation(); state.openCheck = null; state.detail = null; render(); });
  const write = document.getElementById("ckWrite");
  if (write) write.addEventListener("click", (e) => { e.stopPropagation(); doWriteCheck(); });
  // the panel sits inside the row's table: a click in it must not close it
  box.querySelectorAll(".ck-panel").forEach((p) => p.addEventListener("click", (e) => e.stopPropagation()));

  box.querySelectorAll("[data-load]").forEach((btn) => btn.addEventListener("click", () => {
    const pid = btn.getAttribute("data-load");
    const t = state.d.checks.toTell.find((x) => String(x.paymentId) === String(pid));
    if (!t) return;
    const contact = resolvePayee(t, state.d.links);
    /* THIS payment's message, never the bill's balance: the amount on a pick-up notice is one piece of paper. */
    const message = pickupMessage({ company: contact.company || t.vendorCompany, payee: t.payee, amount: t.amount, checkNumber: t.checkNumber,
      projectLabel: t.projectLabel, invoiceNumber: t.invoiceNumber, isCash: t.isCash, from: company() });
    state.tell[pid] = { loaded: true, contact, message };
    render();
  }));
  box.querySelectorAll("[data-mail]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const k = state.tell[a.getAttribute("data-mail")] || {};
    if (!k.contact || !k.contact.email) return;
    const link = document.createElement("a");
    link.href = "mailto:" + encodeURIComponent(k.contact.email) + "?subject=" + encodeURIComponent(k.message.subject) + "&body=" + encodeURIComponent(k.message.body);
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }));
  box.querySelectorAll("[data-copy]").forEach((btn) => btn.addEventListener("click", async () => {
    const k = state.tell[btn.getAttribute("data-copy")] || {};
    try {
      await navigator.clipboard.writeText((k.message && k.message.body) || "");
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = "Copy the message"; }, 1500);
    } catch (e) {
      toast("Could not copy it. Select the message above and copy it by hand.", "error");
    }
  }));
  box.querySelectorAll("[data-told]").forEach((btn) => btn.addEventListener("click", async () => {
    const pid = btn.getAttribute("data-told");
    const how = btn.getAttribute("data-how");
    const t = state.d.checks.toTell.find((x) => String(x.paymentId) === String(pid));
    if (!t) return;
    btn.disabled = true;
    try {
      await books.markTold(t, how);
    } catch (e) {
      btn.disabled = false;
      toast(errorText(e), "error");
      if (e && (e.code === "PT409" || e.status === 409)) load();
      return;
    }
    delete state.tell[pid];
    state.refused = null;
    toast("Marked told (" + how + ").", "ok");
    await load();
  }));
}

async function doWriteCheck() {
  const msg = document.getElementById("ckMsg");
  const b = state.d.checks.toPay.find((x) => String(x.id) === String(state.openCheck));
  if (!b || state.busy) return;
  const payee = (document.getElementById("ckPayee").value || "").trim();
  const amount = parseAmount(document.getElementById("ckAmount").value);
  const number = (document.getElementById("ckNumber").value || "").trim();
  const memo = (document.getElementById("ckMemo").value || "").trim();
  const method = chosenMethod();
  const cash = method === "cash";
  const allowed = amountAllowed(amount, b.owed);
  const bad = !method ? "Say whether this is by check or in cash."
    : !number && !cash ? "Enter the check number."
      : !Number.isFinite(amount) ? "That is not an amount. Type it like 4500.00."
        : !allowed.ok ? allowed.reason : "";
  if (bad) { msg.textContent = bad; msg.className = "ac-msg err"; return; }
  const sure = await confirmBox((cash ? "Record a cash payment of " + money(amount) : "Record check #" + number + " for " + money(amount)) +
    " to " + (payee || b.payee || "the vendor") + "?", { okText: "Record it" });
  if (!sure) return;
  state.busy = true;
  const go = document.getElementById("ckWrite");
  if (go) go.disabled = true;
  msg.className = "ac-msg";
  msg.textContent = "Recording…";
  try {
    await books.recordPayment(b, { amount: allowed.amount, method, checkNumber: number, payee: payee || b.payee, memo: memo || b.memo });
  } catch (e) {
    state.busy = false;
    if (go) go.disabled = false;
    msg.textContent = errorText(e);
    msg.className = "ac-msg err";
    return;
  }
  state.busy = false;
  state.openCheck = null;
  state.detail = null;
  state.refused = null;
  toast((cash ? "Cash payment" : "Check #" + number) + " recorded.", "ok");
  await load();
}

async function load() {
  try {
    state.d = await books.loadDesk(state.me);
    render();
  } catch (e) {
    /* The payload is dropped, not kept: figures from before a failed reload must never be drawn again. */
    state.d = null;
    document.getElementById("acBody").innerHTML = '<div class="ac-sec" style="color:var(--err)">' + h(errorText(e)) + "</div>";
    const cards = document.getElementById("acCards");
    cards.innerHTML = "";
    cards.className = "ac-cards";
  }
}

async function start() {
  let me;
  try { me = await boot("books"); } catch (e) { return; }
  state.me = me;
  if (!seesBooks(me)) {
    document.getElementById("acBody").innerHTML = '<div class="ac-none">The Books are not available for your account.</div>';
    const al = D().alert;
    if (typeof al === "function") await al("The Books are not available for your role: they need the financials switch. Ask an admin.", { title: "Not available" });
    location.replace("dashboard.html");
    return;
  }
  document.title = "DCR Portal 2 — The Books";
  const first = String(me.name || "").split(" ")[0].split("@")[0];
  document.getElementById("acGreeting").textContent = first ? "— " + first : "";
  const g = document.getElementById("acView");
  if (g) g.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
    store.set(VIEW_KEY, b.getAttribute("data-view"));
    paintView();
    if (state.d) summary(state.d);
  }));
  paintView();
  // a phone turned sideways (or a window narrowed) re-spans the open check panel without redrawing what was typed (the
  // media query list is kept on the state: a collected one forgets its listener)
  if (window.matchMedia) {
    state.mq = matchMedia(NARROW);
    if (state.mq.addEventListener) state.mq.addEventListener("change", respan); else if (state.mq.addListener) state.mq.addListener(respan);
  }
  window.addEventListener("resize", respan);
  await load();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();

export const _test = { picture, cardsHtml, render: () => render(), state, panelSpan };
