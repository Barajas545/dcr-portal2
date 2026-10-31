/* The Books — the accountant's desk (port of the old accounting.html / accounting.js; MODULES §5b; BLUEPRINT 3.3.11
   "The Books (accountant's desk)", P5 5b, acceptance checks 2, 3 and 5).

   The books live in QuickBooks Online and stay there (Q13: a MANUAL hand-off - no QuickBooks key anywhere). This
   screen makes the hand-off reliable: what is ready to enter, what is already in, what is stuck and on whom - and
   the money leaving the door: the checks and cash to hand over and the payees still to be told.

   * the picture (or the four tiles): money out the door (not ready -> to pay -> paid, tell them) and into QuickBooks
     (bills to key in -> on the books, invoices to key in -> on the books);
   * what needs doing: one line each, with the money, in the order it makes sense to do it;
   * bills to pay: one queue, each row saying how the approver authorised it (check, cash, either); a row opens the
     check desk (js/pages/pay-panel.js, the Books program's release A) - payee (<= 200) and memo (<= 100) prefilled,
     the amount capped at the approved amount still owed (the database refuses more: acceptance check 2), the check
     number prefilled from the register's next one, the date written on it, the payment's files (a photo of the check,
     a pasted screenshot of the transfer), the documents behind it, what is already paid - and records the payment
     (money editors: admin, or a manager / accountant with financials);
   * pay by bank transfer or card (owner decision 2026-10-21): the bills approved to be paid by bank transfer (ACH or
     wire) or by card, on a list of their own with the same panel - no check number (the bank's or the card's
     confirmation instead, optional) and nobody to tell (only a check or cash is picked up);
   * written - tell them it is ready (the Books program, release B: pages/tell-payee.js, shared with the Accounting
     page): one group per payee - the bill's vendor contact, else (a bill with no contact) the quote's vendor contact or
     a contact whose company or name IS the payee (never a guess: the database refuses anyone else, I36) -, and the
     four ways: an e-mail the reminder PC sends by itself (rpc tell_payee: told "(e-mail by DCR Agents 2)" once it has
     gone), a text from her own phone (the database's number and words, an sms: link, [I sent it]), a call, in person;
     then the ones told and waiting at the office, [Picked up]; her texts not marked sent; the reminder PC's warning;
   * paid in the last 30 days (by the date on the check): the date, the payee, the job, how and the number, told /
     picked up / cleared, 📎 the payment's files then the bill's - the amount and the total only with the prices
     switch (S4) - and the way to the check register;
   * ready to enter in QuickBooks: the approved bills with their paperwork, a CSV built here in the browser (the
     formula guard, a BOM, CRLF), "Mark entered" (rpc mark_bills_entered: refused[] is shown in full, never a silent
     partial) with the QuickBooks ref typed beside it - kept on the page's state, so a redraw (back from the QuickBooks
     tab, the 30 s poll) never empties it; money in: the invoices sent, their CSV and their own marker (rpc
     mark_invoices_entered);
   * not ready - and who it is on: waiting for an approval (only an admin or a manager with approve; an accountant
     NEVER approves - the bill page shows them no approve button) or for the paperwork; a money editor ticks the
     waiting ones, sees each one's LAST ASK (money_messages) and asks (pages/ask-approval.js: the usual approver ticked,
     e-mail or a text per person - asking never approves);
   * already entered: Undo (rpc unmark_bills_entered / unmark_invoices_entered).
   * the payees' pictures (Books release A3, pages/avatar.js): the bill's own vendor contact's picture, or initials,
     before the payee; a contact editor's opens the contact card (its picture, phone and e-mail), as does [Add phone /
     e-mail] when nobody can be reached - the desk is read again after a save.

   The page reads what the Accounting page reads (repo/books-home.js loadHome: The Books' own desk - repo/books.js
   loadDesk - plus the money messages, my texts, the reminder PC's status and the templates; I24), and every 30 s
   again ONLY while one of my e-mails waits for the reminder PC (I32). The day's work is on the simple page
   (books-home.html): the tab strip's "← Simple view".

   Only with the financials switch: anyone else is told so and sent home before anything is read. */

import { boot, esc, toast, confirmBox, errorText, store, D, can as allowed, seesPrices } from "./shell.js";
import { avatarHtml, paintAvatars } from "./avatar.js";
import * as books from "../repo/books.js";
import * as homeRepo from "../repo/books-home.js";
import * as panel from "./pay-panel.js";
import { openSheet, ensureSheetStyle } from "./books-nav.js";
import { openAsk } from "./ask-approval.js";
import { groupHtml, waitingHtml, wireTell, textStep } from "./tell-payee.js";
import { openViewer } from "./file-viewer.js";
import {
  fmtMoney, plural, daysLate, toCsv, shortDay,
  BILL_COLUMNS, INVOICE_COLUMNS, csvName, cleanRef, refusedLines, REF_MAX,
  billHref, seesBooks,
} from "../map/books.js";
import { lastAskedText, paidState } from "../map/books-home.js";
import { pcWarning } from "../map/money-messages.js";
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
const POLL_MS = 30000;
// ref / refInv: the QuickBooks refs typed beside "Mark entered" (bills / invoices) - drawn again by every render
const state = { me: null, d: null, home: null, picked: {}, pickedInv: {}, askPicked: {}, openCheck: null, detail: null, refused: null, busy: false, mq: null,
  timer: null, loading: null, again: false, ref: "", refInv: "" };
const REF_IDS = ["acRef", "acRefInv"];
const prices = () => seesPrices(state.me);

function day(v) {
  const s = fmtDay(v);
  return s === "—" ? "" : s.replace(/, \d{4}$/, "");
}
function lateText(n) {
  if (n === null || n === undefined || n <= 0) return "";
  return n === 1 ? "1 day late" : n + " days late";
}

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

const STAGE_OF = { check: "pay", cash: "pay", either: "pay", transfer: "pay", card: "pay", tell: "tell", waiting: "decide", qbo: "qbo", ar: "ar" };

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
  if (c.transferCount) chips.push(["transfer", plural(c.transferCount, "transfer", "transfers")]);
  if (c.cardCount) chips.push(["card", c.cardCount + " card"]);
  const out = [
    { to: "secWaiting", label: "Not ready", theirs: true, count: stuck.length, amount: stuckAmount, big: money(stuckAmount),
      sub: plural(stuck.length, "bill", "bills"), flag: t.blockedCount ? plural(t.blockedCount, "bill needs", "bills need") + " paperwork first" : "",
      who: "with a manager" },
    { to: c.toPayCount || !c.toSendCount ? "secPay" : "secSend", label: "To pay", step: step.pay, mine: !!can.pay, count: c.outCount,
      amount: c.outAmount, big: money(c.outAmount), sub: plural(c.outCount, "bill", "bills"), chips, who: can.pay ? "yours to do" : NOT_YOURS },
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
  const owed = d.checks.toPay.concat(d.checks.toSend, d.checks.toDecide);
  const owedOut = c.outAmount + c.toDecideAmount;
  const held = c.toDecideCount
    ? '<button type="button" class="bk-st theirs" data-jump="secDecide" style="width:100%;margin-top:12px"><span class="k">Held up</span><span class="n">' +
      h(plural(c.toDecideCount, "approved bill", "approved bills") + " — " + money(c.toDecideAmount) +
        " — cannot be paid: nobody recorded how to pay it. A manager or admin sets it on the bill.") + "</span></button>"
    : "";
  let s = '<div class="bk">' +
    band("Money out the door", "Left to right, what happens to a bill.", owedOut ? money(owedOut) + " approved and still owed" : "", out,
      held + agingHtml(owed, d.today)) +
    band("Into QuickBooks", "Keying, not money — a bill can be keyed before it is paid. Bills and invoices each get a done marker.", "",
      keyed, "", ["&rarr;", "+", "&rarr;"]);
  const nothing = !stuck.length && !c.outCount && !c.toDecideCount && !c.toTellCount && !t.readyCount && !t.arReadyCount;
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

/* The payee with the bill's own vendor contact's picture (or initials) before it: a contact editor's opens the card. */
function vendorContact(x) {
  return x && x.vendorContactId != null && state.d && state.d.links ? state.d.links.contacts.get(String(x.vendorContactId)) || null : null;
}
function payeeHtml(x, words, shown) {
  if (!words) return h(shown);
  return '<span class="av-name">' + avatarHtml(vendorContact(x), { size: 28, name: words, edit: allowed(state.me, "contacts") }) +
    '<span class="av-t">' + h(words) + "</span></span>";
}

/* the latest ask about a waiting bill (money_messages, through loadHome's buildHome) */
function askedOf(b) {
  const w = state.home && state.home.waiting ? state.home.waiting.find((x) => String(x.id) === String(b.id)) : null;
  return w ? w.lastAsked : null;
}

function billRow(b, opts) {
  const o = opts || {};
  const late = o.entered ? "" : lateText(b.lateBy);
  const askable = !!o.ask && allowed(state.me, "money") && b.state === "waiting";
  return "<tr>" +
    (o.pick ? '<td><input type="checkbox" data-pick="' + h(b.id) + '" aria-label="Pick ' + h(b.vendor || "this bill") + '"' +
      (state.picked[b.id] ? " checked" : "") + "></td>" : "") +
    (o.askPick ? "<td>" + (askable ? '<input type="checkbox" data-askpick="' + h(b.id) + '" aria-label="' + h("Ask about " + (b.vendor || "this bill")) + '"' +
      (state.askPicked[b.id] ? " checked" : "") + ">" : "") + "</td>" : "") +
    '<td><span class="who">' + h(b.vendor || "(no vendor)") + "</span>" +
      (b.invoiceNumber ? ' <span class="meta">#' + h(b.invoiceNumber) + "</span>" : "") + kindTag(b) +
      '<div class="meta">' + h(b.projectLabel || "(no job)") + (b.dueDate ? " · due " + h(day(b.dueDate)) : "") + "</div>" +
      (late ? '<span class="late">' + h(late) + "</span>" : "") +
      (o.reason && b.reason ? '<div class="reason">' + h(b.reason) + "</div>" : "") +
      (askable ? '<div class="ac-asked">' + h(lastAskedText(askedOf(b))) + "</div>" +
        '<div class="ac-actions" style="margin-top:6px"><button type="button" class="ac-b" data-ask="' + h(b.id) + '">Ask to approve</button></div>' : "") +
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

/* a bill's pay method or one payment's method, as a chip (js/pages/pay-panel.js) */
const methodChip = panel.methodChip;

const PILES = {
  pay: { key: "toPay", id: "secPay", title: "Bills to pay", act: "Pay",
    hint: "Approved to be paid by check or in cash, and still owed. Each row says how it was authorised — open it to see the paperwork and record the payment.",
    empty: "Nothing owed by check or cash. Every such bill has been paid." },
  send: { key: "toSend", id: "secSend", title: "Pay by bank transfer or card", act: "Pay",
    hint: "Approved to be sent from the bank (ACH or wire) or put on the card, and still owed. No check number and nobody to tell — record the confirmation once it has gone.",
    empty: "" },
  decide: { key: "toDecide", id: "secDecide", title: "Approved — but nobody said how to pay", act: "Open",
    hint: "A manager or admin sets the payment method on the bill; it is not yours to choose.", empty: "" },
};

function pile(c, can, which) {
  const P = PILES[which];
  const rows = c[P.key] || [];
  const amount = rows.reduce((n, b) => n + (Number(b.owed) || 0), 0);
  if (!rows.length && (which === "decide" || which === "send")) return "";
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
      '<td><div class="ck-payee">' + payeeHtml(b, b.payee, "(no payee on file)") + "</div>" +
        '<div class="ck-for">' + h(b.memo || b.projectLabel || "") + (b.partial ? '<span class="ck-part">part paid</span>' : "") + "</div></td>" +
      '<td class="hide-sm">' + methodChip(b.payMethod) + "</td>" +
      '<td class="num"><b>' + money(b.owed) + "</b>" + (b.partial ? '<div class="ck-for">of ' + money(b.approvedFor) + "</div>" : "") + "</td>" +
      '<td class="num">' + (open ? "Close" : h(P.act) + " &rarr;") + "</td></tr>";
    // the panel spans exactly the columns shown (a phone hides "How": a colspan of 4 there adds an empty column)
    if (open) s += '<tr class="ck-open"><td class="ck-cell" colspan="' + panelSpan() + '">' + checkPanel(b, can, which) + "</td></tr>";
  });
  return s + "</tbody></table></div>";
}

/* The panel: what to write on the check, and everything it is written against (js/pages/pay-panel.js). */
function checkPanel(b, can, which) {
  return panel.checkPanel(b, can, which, { detail: state.detail, me: state.me, today: state.d && state.d.today });
}

/* ── telling them it is ready (js/pages/tell-payee.js, the Accounting page's own panels) ── */
function checksToTell() {
  const H = state.home || {};
  const groups = H.tellGroups || [], office = H.atOffice || [], drafts = H.drafts || [];
  const ctx = { me: state.me, links: state.d && state.d.links, pc: H.pc };
  let s = '<div class="ac-sec" id="secTell"><header><h3>Written — tell them it is ready</h3><span class="hint">The check or cash is ready at the office. ' +
    "E-mail them (the reminder PC sends it by itself), text them from your phone, call, or tell them in person — then mark it picked up when they collect it.</span></header>";
  const warn = pcWarning(H.pc);
  if (warn && allowed(state.me, "money") && groups.length) s += '<div class="bh-pc sm" id="acPc" role="status">' + h(warn) + "</div>";
  if (H.ready === false) s += '<div class="ac-note">The money messages are not in the database yet: telling by e-mail or text comes with its update.</div>';
  if (drafts.length) {
    s += '<h4 class="bh-sub" id="acDrafts">Texts not marked sent · ' + h(String(drafts.length)) + '</h4><div class="ac-note" style="margin:0 0 6px">Did you send these? Say so, so the log is right.</div>' +
      '<div id="acDraftList"></div>';
  }
  if (!groups.length && !office.length) return s + '<div class="ac-none">Everyone with a check or cash waiting has been told.</div></div>';
  if (groups.length) {
    const n = groups.reduce((x, g) => x + g.payments.length, 0);
    s += '<h4 class="bh-sub" id="acNotTold">Not told yet · ' + h(String(n)) + "</h4>" + groups.map((g) => groupHtml(g, ctx)).join("");
  }
  if (office.length) {
    s += '<h4 class="bh-sub" id="acAtOffice">Told, waiting for pickup · ' + h(String(office.length)) + "</h4>" + office.map((p) => waitingHtml(p, ctx)).join("");
  }
  return s + "</div>";
}

/* ── paid in the last 30 days (by the date on the check, Q6): the amounts only with the prices switch (S4) ── */
const METHOD_WORD = { check: "check", cash: "cash", ach: "ACH", wire: "wire", card: "card", other: "other" };
export function paidRowHtml(p) {
  const st = paidState(p);
  const stCls = p.clearedOn || p.pickedUpAt ? "ok" : p.toldAt ? "told" : "";
  return '<tr data-paid="' + h(p.id) + '"><td class="meta">' + h(shortDay(p.paidDate)) + "</td>" +
    "<td>" + payeeHtml(p, p.payee, "(no payee)") +
      '<div class="meta">' + h(p.projectLabel || "") + "</div>" +
      '<div class="meta"><span class="ck-method ' + h(p.kind === "transfer" ? "transfer" : p.kind) + '" style="margin-left:0">' + h(METHOD_WORD[p.method] || p.method) + "</span>" +
        (p.ref ? " " + (p.method === "check" ? "#" : "") + h(p.ref) : "") + ' · <span class="st ' + stCls + '">' + h(st) + "</span></div></td>" +
    (prices() ? '<td class="num">' + h(money(p.amount)) + "</td>" : "") +
    '<td class="num">' + (p.fileCount ? '<button type="button" class="lnk" data-files="' + h(p.id) + '" aria-label="' + h(plural(p.fileCount, "file", "files")) + '">&#128206; ' +
      h(String(p.fileCount)) + "</button>" : "") + "</td></tr>";
}
function paid30() {
  const rows = (state.home && state.home.paid30) || [];
  let s = '<div class="ac-sec ac-paid" id="secPaid"><header><h3>Paid — last 30 days</h3><span class="hint">By the date on the check: told, picked up, cleared.</span>' +
    '<span class="grow"></span><span class="hint">' + h(plural(rows.length, "payment", "payments")) + (prices() && rows.length ? " · " + h(money(state.home.paid30Total)) : "") + "</span></header>";
  if (!rows.length) return s + '<div class="ac-none">Nothing paid in the last 30 days.</div><div class="ac-glance"><a href="books-checks.html">See every check in the check register &rarr;</a></div></div>';
  s += table(rows, [["Date", 0, "c-st"], ["Paid to", 0]].concat(prices() ? [["Amount", 1]] : [], [["", 1, "c-undo"]]), paidRowHtml);
  return s + '<div class="ac-glance">' + (prices() ? "<b>" + h(money(state.home.paid30Total)) + "</b> · " : "") + h(plural(rows.length, "payment", "payments")) +
    ' · <a href="books-checks.html">See every check in the check register &rarr;</a>' +
    (prices() ? ' · <a href="books-reports.html#months">Payments by month &rarr;</a>' : "") + "</div></div>";
}

/* ── what needs doing ── */
const TODO_ICON = { check: "✎", cash: "◉", either: "◐", transfer: "⇄", card: "▭", tell: "☎", waiting: "⏸", qbo: "⇨", ar: "⇦" };

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
  panel.snapshot();          // the open panel's typed values and picked files outlive the redraw
  summary(d);
  let s = todoBlock(d);
  s += pile(d.checks, can, "pay");
  s += pile(d.checks, can, "send");
  s += pile(d.checks, can, "decide");
  s += checksToTell();
  s += paid30();

  // ready to enter (bills)
  s += '<div class="ac-sec" id="secQbo"><header><h3>Ready to enter in QuickBooks</h3><span class="hint">Approved, with the paperwork behind it.</span>' +
    '<span class="grow"></span><button type="button" class="ac-b" id="acCsv"' + (d.ready.length ? "" : " disabled") + '>&#8615; Export CSV</button></header>';
  if (!d.ready.length) {
    s += '<div class="ac-none">Nothing waiting to be entered. The books are up to date.</div>';
  } else {
    s += table(d.ready, can.mark ? [["", 0, "c-pick"], ["Bill", 0], ["Amount", 1], ["", 1, "c-go"]] : [["Bill", 0], ["Amount", 1], ["", 1, "c-go"]], (b) => billRow(b, { pick: !!can.mark }));
    if (can.mark) {
      s += '<div class="ac-actions"><button type="button" class="ac-b" id="acAll">Select all</button>' +
        '<input class="ac-ref" id="acRef" placeholder="QuickBooks ref (optional)" maxlength="' + REF_MAX + '" aria-label="QuickBooks reference" value="' + h(state.ref) + '">' +
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
        '<input class="ac-ref" id="acRefInv" placeholder="QuickBooks ref (optional)" maxlength="' + REF_MAX + '" aria-label="QuickBooks reference for the invoices" value="' + h(state.refInv) + '">' +
        '<button type="button" class="ac-b go" id="acMarkInv" disabled>&#10003; Mark entered</button><span class="hint" id="acCountInv"></span></div>';
    }
  }
  s += '<div class="ac-note">QuickBooks Online does import invoices from CSV natively (Settings &rarr; Import data &rarr; Invoices). ' +
    "Customers must exist there first.</div>" + refusedBox("invoices") + "</div>";

  // not yours to approve: chase it (release B: the asks; asking never approves)
  if (d.waiting.length || d.blocked.length) {
    const asks = allowed(state.me, "money") && d.waiting.length > 0;
    s += '<div class="ac-sec" id="secWaiting"><header><h3>Not ready — and who it is on</h3><span class="hint">Only an admin or a manager with approve ' +
      "authority approves a bill." + (asks ? " Tick the ones to chase and ask them: an e-mail the reminder PC sends, or a text from your phone." : " It is here so you are not waiting on it blind.") +
      "</span></header>";
    s += table(d.waiting.concat(d.blocked), (asks ? [["", 0, "c-pick"]] : []).concat([["Bill", 0], ["Amount", 1], ["", 1, "c-go"]]),
      (b) => billRow(b, { reason: true, askPick: asks, ask: asks }));
    if (asks) {
      const n = Object.keys(state.askPicked).length;
      s += '<div class="ac-actions"><button type="button" class="btn-accept" id="acAskSel"' + (n ? "" : " disabled") + ">Ask to approve (" + h(String(n)) + " selected)</button></div>";
    }
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

  // a ref box being typed in keeps its focus and caret over the redraw (its words are on the state)
  const act = document.activeElement;
  const typing = act && REF_IDS.indexOf(act.id) !== -1 ? { id: act.id, a: act.selectionStart, b: act.selectionEnd } : null;
  document.getElementById("acBody").innerHTML = s;
  // my texts not marked sent: the database's number and words, as text (js/pages/tell-payee.js)
  const list = document.getElementById("acDraftList");
  if (list && state.home) state.home.drafts.forEach((m) => list.appendChild(textStep(m, { onDone: () => setTimeout(() => load(), 700) })));
  wire();
  const back = typing ? document.getElementById(typing.id) : null;
  if (back) { try { back.focus(); back.setSelectionRange(typing.a, typing.b); } catch (e) { /* the caret only */ } }
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
  // the QuickBooks refs live on the state: a redraw draws them again
  const ref = document.getElementById("acRef");
  if (ref) ref.addEventListener("input", () => { state.ref = ref.value; });
  const refInv = document.getElementById("acRefInv");
  if (refInv) refInv.addEventListener("input", () => { state.refInv = refInv.value; });
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
  // asking (js/pages/ask-approval.js: one bill, or the ones ticked)
  box.querySelectorAll("[data-askpick]").forEach((cb) => cb.addEventListener("change", () => {
    const id = cb.getAttribute("data-askpick");
    if (cb.checked) state.askPicked[id] = true; else delete state.askPicked[id];
    syncAsk();
  }));
  box.querySelectorAll("[data-ask]").forEach((b) => b.addEventListener("click", () => { const x = waitingBill(b.getAttribute("data-ask")); if (x) ask([x]); }));
  const sel = document.getElementById("acAskSel");
  if (sel) sel.addEventListener("click", () => ask(Object.keys(state.askPicked).map(waitingBill).filter(Boolean)));
  // paid in the last 30 days: the payment's files, then the bill's
  box.querySelectorAll("[data-files]").forEach((b) => b.addEventListener("click", () => {
    const p = ((state.home && state.home.paid30) || []).find((x) => String(x.id) === b.getAttribute("data-files"));
    if (p && p.files.length) openViewer(p.files, 0, { errorText });
  }));
  wireChecks();
  syncPick();
}

function waitingBill(id) { return state.d ? state.d.waiting.find((b) => String(b.id) === String(id)) || null : null; }
function syncAsk() {
  const n = Object.keys(state.askPicked).length;
  const b = document.getElementById("acAskSel");
  if (b) { b.disabled = !n; b.textContent = "Ask to approve (" + n + " selected)"; }
}
function ask(bills) {
  if (!bills.length) return;
  openAsk({ bills, me: state.me, templates: state.home && state.home.templates, today: state.d.today, onDone: () => { state.askPicked = {}; load(); } });
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
  const box = document.getElementById(bills ? "acRef" : "acRefInv");
  if (box) { if (bills) state.ref = box.value; else state.refInv = box.value; }
  const amt = rows.filter((r) => picked[r.id]).reduce((t, r) => t + r.amount, 0);
  const noun = bills ? plural(ids.length, "bill", "bills") : plural(ids.length, "invoice", "invoices");
  const sure = await confirmBox("Mark " + noun + " (" + money(amt) + ") as entered in QuickBooks? This records that you have keyed them — " +
    "it does not send anything to Intuit.", { title: "Mark entered", okText: "Mark entered" });
  if (!sure) return;
  // the ref as typed (the state: a reload while the question was open drew the page again)
  const ref = cleanRef((bills ? state.ref : state.refInv) || "");
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
  // marked: the picks and their ref are done with (never carried into the next batch)
  if (bills) { state.picked = {}; state.ref = ""; } else { state.pickedInv = {}; state.refInv = ""; }
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

/* the open bill, as the pile shows it (the check desk or the "Pay by bank transfer or card" list) */
function openBill() {
  const c = state.d && state.d.checks;
  if (!c || state.openCheck == null) return null;
  for (const which of ["pay", "send", "decide"]) {
    const b = (c[PILES[which].key] || []).find((x) => String(x.id) === String(state.openCheck));
    if (b) return { b, which };
  }
  return null;
}

function wireChecks() {
  const box = document.getElementById("acBody");
  // the open panel (js/pages/pay-panel.js): its controls, the payment's files, recording it
  const open = openBill();
  panel.wirePanel(box, { bill: open ? open.b : null, which: open ? open.which : "", me: state.me, today: state.d.today, detail: state.detail,
    onClose: () => { state.openCheck = null; state.detail = null; render(); },
    onDone: async () => { state.openCheck = null; state.detail = null; state.refused = null; await load(); } });
  const openRow = async (tr) => {
    const id = tr.getAttribute("data-open");
    if (String(state.openCheck) === String(id)) { panel.resetPanel(); state.openCheck = null; state.detail = null; render(); return; }
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

  // the payees' pictures; the card from a picture (Books release A3)
  paintAvatars(box, { me: state.me, onSaved: contactSaved });
  // telling (js/pages/tell-payee.js): e-mail by the reminder PC, a text by hand, a call, in person; picked up; and
  // [Add phone / e-mail] - the page is read again after each
  const H = state.home || {};
  wireTell(box, { me: state.me, links: state.d.links, groups: H.tellGroups || [], waiting: H.atOffice || [], today: state.d.today, sheet: openSheet,
    onChanged: () => { state.refused = null; return load(); } });
}

/* A contact's picture, phone or e-mail was saved from the card: everything is read again (a phone just added is
   offered at once). */
function contactSaved() { return load(); }

/* every 30 s, only while one of my e-mails waits for the reminder PC (I32); never over an open panel or dialog */
function schedule() {
  clearTimeout(state.timer);
  state.timer = null;
  if (!state.home || !state.home.waitingEmail) return;
  state.timer = setTimeout(() => {
    const sheet = document.getElementById("bhSheet");
    if (state.openCheck != null || (sheet && !sheet.hidden) || document.visibilityState === "hidden") { schedule(); return; }
    load();
  }, POLL_MS);
}

async function load() {
  if (state.loading) { state.again = true; return state.loading; }
  state.loading = (async () => {
    try {
      // The Books' own desk (repo/books.js loadDesk) and the money messages on top (repo/books-home.js loadHome: I24)
      state.home = await homeRepo.loadHome(state.me);
      state.d = state.home.desk;
      Object.keys(state.askPicked).forEach((k) => { if (!waitingBill(k)) delete state.askPicked[k]; });
      render();
      schedule();
    } catch (e) {
      /* The payload is dropped, not kept: figures from before a failed reload must never be drawn again. */
      state.d = null;
      state.home = null;
      document.getElementById("acBody").innerHTML = '<div class="ac-sec" style="color:var(--err)">' + h(errorText(e)) + "</div>";
      const cards = document.getElementById("acCards");
      cards.innerHTML = "";
      cards.className = "ac-cards";
    } finally {
      state.loading = null;
      if (state.again) { state.again = false; load(); }
    }
  })();
  return state.loading;
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
  ensureSheetStyle();
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
  // the payment files still on their way (js/pages/pay-panel.js: the durable upload queue's lines)
  panel.watchQueue(document.getElementById("ckQueue")).catch(() => {});
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.openCheck == null && state.d) load(); });
  await load();
}

if (typeof document !== "undefined" && typeof window !== "undefined" && document.getElementById && !(window && window.__AC_TEST__)) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}

export const _test = { picture, cardsHtml, render: () => render(), state, panelSpan, checksToTell, paid30, billRow, doMark: (w) => doMark(w), load: () => load() };
