/* The payment panel (the Books program, release A, design-portal §3.4): what to write on the check - or what the bank
   or the card sent - and everything it is written against. Extracted from accounting.js (checkPanel, doWriteCheck,
   paintMethod, chosenMethod) with the SAME element ids, so the Books' tests and walks keep working; the Accounting page
   of release B uses it too.

   * checkPanel(b, can, which, ctx) -> the panel's markup (every database word escaped): payee (<= 200), amount (capped
     at what is still approved: the database refuses more - acceptance check 2), the check number - PREFILLED from
     next_check_number() (a suggestion: the last recorded check + 1, past every number used or spoiled; she types over
     it) -, the DATE written on it (#ckDate: today by default, today - 400 to today + 31, sent as paidDate), the "how"
     buttons the approver allowed, the memo (<= 100), the payment's files (#ckFiles: js/pages/file-drop.js - several at
     once, drop, Ctrl+V on the panel, a photo on a phone), the bill's paperwork (js/pages/file-viewer.js: a picture in
     place, a PDF in its own tab) and what is already paid;
   * wirePanel(box, ctx)   its controls; the typed values and the picked files survive a redraw of the page (snapshot);
   * the payment's files go into the durable upload queue AFTER the payment row exists: kind "payment" {billId,
     paymentId, projectId} - a paste is named "Payment <time>" by the queue, a picked file keeps its name;
   * a check number already used is refused by the database (23505): its own sentence is shown in the field
     (map/checks.js clashText), with the next free number; while it is typed, check_number_info warns early;
   * watchQueue(el)        "2 files on their way" - the queue's lines for payment files (textContent only).
   Without the prices switch (S4) the panel shows NO amount: the amount is typed from the bill, nothing approved or paid
   is said in money, and the confirm question names none. */

import { esc, toast, confirmBox, errorText, seesPrices } from "./shell.js";
import * as books from "../repo/books.js";
import * as checks from "../repo/checks.js";
import * as uploads from "./uploads.js";
import { mountFileDrop, queueAll } from "./file-drop.js";
import { showIn, openTab, isImage } from "./file-viewer.js";
import {
  fmtMoney, plural, payMethodWords, paymentLabel, parseAmount, amountAllowed, MEMO_MAX, PAYEE_MAX, CHECK_NUMBER_MAX, billHref,
  refField, payDateBounds, payDateProblem, shortDay,
} from "../map/books.js";
import { clashText } from "../map/checks.js";
import { fmtDay } from "../map/pacific.js";

const h = esc;
const money = fmtMoney;

/* a bill's pay method (check | cash | both | transfer | card) or one payment's method (check | cash | ach | wire | card) */
const METHOD_CHIP = { check: ["check", "check"], cash: ["cash", "cash"], both: ["either", "check or cash"], transfer: ["transfer", "bank transfer"],
  card: ["card", "card"], ach: ["transfer", "ACH"], wire: ["transfer", "wire"] };
export function methodChip(m) {
  const x = METHOD_CHIP[m];
  return x ? '<span class="ck-method ' + h(x[0]) + '">' + h(x[1]) + "</span>" : '<span class="ck-method none">not set</span>';
}
/* the panel's "how are you paying this one?" buttons, and what the record button says */
const HOW_LABEL = { check: "By check", cash: "In cash", ach: "By ACH", wire: "By wire", card: "By card" };
const WRITE_LABEL = { check: "✓ Record the check", cash: "✓ Record the cash payment", ach: "✓ Record the ACH transfer",
  wire: "✓ Record the wire transfer", card: "✓ Record the card payment" };
const DONE_WORD = { cash: "Cash payment", ach: "ACH transfer", wire: "Wire transfer", card: "Card payment" };
export const FILES_LABEL = "Add a photo of the check, a scan, or paste a screenshot of the transfer";
const NEXT_KEEP_MS = 60000;

/* the open panel's own state: one bill at a time */
const P = { billId: null, files: [], keep: null, drop: null, next: undefined, nextAt: 0, clash: "", busy: false, watching: false, seq: 0 };

function day(v) {
  const s = fmtDay(v);
  return s === "—" ? "" : s.replace(/, \d{4}$/, "");
}

/** Forget the open bill's typed values and files (after it was recorded, or the panel closed). */
export function resetPanel() {
  if (P.drop) { try { P.drop.destroy(); } catch (e) { /* */ } }
  Object.assign(P, { billId: null, files: [], keep: null, drop: null, clash: "", busy: false });
}

/** Keep what was typed in the open panel (the page is about to be drawn again). */
export function snapshot() {
  const panel = document.getElementById("ckPanel");
  if (!panel || String(panel.getAttribute("data-bill")) !== String(P.billId)) return;
  const v = (id) => { const n = document.getElementById(id); return n ? n.value : null; };
  const num = document.getElementById("ckNumber");
  P.keep = { payee: v("ckPayee"), amount: v("ckAmount"), number: v("ckNumber"), memo: v("ckMemo"), date: v("ckDate"),
    how: chosenMethod(), prefill: num ? num.getAttribute("data-prefill") || "" : "" };
  if (P.drop) { try { P.drop.destroy(); } catch (e) { /* */ } P.drop = null; }
}

/* ── the markup ───────────────────────────────────────────────────────── */

/** The panel for bill `b` (a deskChecks entry). ctx: {detail (repo/books.js loadBill), me, today, which: pay | send |
    decide}. */
export function checkPanel(b, can, which, ctx) {
  const c = ctx || {};
  const d = c.detail;
  const prices = seesPrices(c.me);
  if (!d || String(d.bill.id) !== String(b.id)) return '<div class="ck-panel"><div class="ac-none">Loading the paperwork…</div></div>';
  if (String(P.billId) !== String(b.id)) { resetPanel(); P.billId = b.id; }
  if (which === "decide") {
    return '<div class="ck-panel"><div class="ac-note">This bill was approved' + (prices ? " for " + money(b.approvedFor) : "") + ", but nobody recorded how to " +
      "pay it — by check, in cash, by bank transfer or by card. A manager or admin sets that on the bill — it is an authorisation, not a bookkeeping choice." +
      '</div><div class="ck-acts"><a class="ac-b" href="' + h(billHref(b.id)) + '">Open the bill &rarr;</a><button type="button" class="ac-b" id="ckClose">Close</button></div></div>';
  }
  const allowed = b.allowed || [];
  const sent = which === "send";
  const bounds = payDateBounds(c.today);
  // the reference field as the method picked asks for it (one allowed: that one; none picked yet: by the bill's pile)
  const rf = refField(allowed.length === 1 ? allowed[0] : "", allowed);
  let s = '<div class="ck-panel" id="ckPanel" data-bill="' + h(b.id) + '">';
  s += '<div class="ck-grid">' +
    '<div class="ck-f"><label for="ckPayee">' + (sent ? "Paid to" : "Make it out to") + '</label><input id="ckPayee" class="big" value="' + h(b.payee) + '" maxlength="' + PAYEE_MAX + '">' +
      (b.payeeNote ? '<div class="sub warn">' + h(b.payeeNote) + "</div>"
        : b.payeePerson && b.payeePerson !== b.payee ? '<div class="sub">Their contact person: ' + h(b.payeePerson) + ".</div>" : "") + "</div>" +
    '<div class="ck-f"><label for="ckAmount">Amount</label><input id="ckAmount" class="big" inputmode="decimal" value="' + (prices ? h(Number(b.owed).toFixed(2)) : "") + '"' +
      (prices ? "" : ' placeholder="Type the amount"') + ">" +
      '<div class="sub">' + (!prices ? "Type it from the bill: the database takes no more than is still approved on it."
        : b.alreadyPaid > 0 ? money(b.alreadyPaid) + " already paid of " + money(b.approvedFor) + " approved."
          : "Approved for " + money(b.approvedFor) + ".") + "</div></div>" +
    '<div class="ck-f"><label for="ckNumber" id="ckRefLab">' + h(rf.label) + '</label><input id="ckNumber" placeholder="' + h(rf.placeholder) + '" maxlength="' + CHECK_NUMBER_MAX + '" autocomplete="off">' +
      '<div class="sub" id="ckRefSub">' + h(rf.sub) + "</div></div>" +
    '<div class="ck-f"><label for="ckDate" id="ckDateLab">' + (sent ? "Date it was sent" : "Date on the check") + '</label><input id="ckDate" type="date" value="' + h(bounds.today) +
      '" min="' + h(bounds.min) + '" max="' + h(bounds.max) + '">' +
      '<div class="sub" id="ckDateSub">' + (sent ? "Today, unless it went out on another day." : "Today, unless the check is dated otherwise (up to a month ahead).") + "</div></div>" +
    "</div>" +
    (allowed.length > 1
      ? '<div class="ck-f" style="margin-bottom:14px"><span class="lab">' + (sent ? "How did the bank send it?" : "How are you paying this one?") +
        '</span><div class="ck-methods" id="ckHow">' +
        allowed.map((m) => '<button type="button" class="ck-mbtn" data-how="' + h(m) + '" aria-pressed="false">' + h(HOW_LABEL[m] || m) + "</button>").join("") +
        '</div><div class="sub">' + (sent ? "Approved as a bank transfer: ACH or wire, whichever the bank sent. Each payment is recorded separately."
          : "Approved either way. Pay part of it now and the rest the other way if that suits — each payment is recorded separately.") + "</div></div>"
      : '<input type="hidden" id="ckHowFixed" value="' + h(allowed[0] || "") + '">' +
        (sent ? '<div class="ck-f" style="margin-bottom:14px"><span class="lab">How</span><div>' + methodChip(allowed[0]) +
          ' <span class="sub">Approved to be paid ' + h(payMethodWords(b.payMethod)) + ".</span></div></div>" : "")) +
    '<div class="ck-f" style="margin-bottom:14px"><label for="ckMemo">Memo — what the payment is for</label><input id="ckMemo" value="' + h(b.memo) +
      '" maxlength="' + MEMO_MAX + '"></div>';
  if (can.pay) s += '<div class="ck-f ck-files" style="margin-bottom:14px"><span class="lab">The payment\'s files (optional)</span><div id="ckFiles"></div></div>';

  s += '<div class="ck-docs"><h4>What you are paying against</h4>';
  if (d.quote) {
    s += '<div class="ck-commit"><b>' + h(d.quote.kind) + "</b> — " + h(d.quote.vendor || b.vendor) +
      (prices && d.quote.amount !== null && d.quote.amount !== undefined ? " · " + money(d.quote.amount) : "") +
      (d.quote.status ? " · " + h(d.quote.status) : "") + '<div class="ck-for">This bill names this ' + h(d.quote.kind.toLowerCase()) + ".</div></div>";
  }
  if (d.files.length) {
    d.files.forEach((f, i) => {
      s += '<div class="ck-doc">' + (f.cloud && f.storagePath
        ? '<button type="button" class="lnk" data-doc="' + i + '">' + h(f.name) + "</button>"
        : '<span class="nm">' + h(f.name) + "</span>") +
        '<span class="tag">' + (f.primary ? "the bill's document" : f.paymentId != null ? "a payment's file" : "attached to the bill") +
        (f.cloud ? "" : " · on the office computers") + "</span></div>";
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
    const live = written.filter((w) => w.live !== false);
    s += '<div class="ck-docs"><h4>Already paid on this bill</h4>';
    written.forEach((w) => {
      const ref = w.method === "check" ? (w.checkNumber ? " #" + w.checkNumber : "") : w.reference ? " · " + w.reference : "";
      s += '<div class="ck-doc"><span class="nm">' + h(paymentLabel(w.method) + ref) + (prices ? " · " + money(w.amount) : "") +
        "</span>" + methodChip(w.method) + '<span class="tag">' + h(day(w.paidDate)) +
        (w.voided ? " · void" : w.clearedOn ? " · cleared " + h(day(w.clearedOn)) : w.pickedUpAt ? " · picked up " + h(day(w.pickedUpDay))
          : w.collectable ? (w.toldAt ? " · told " + h(w.toldHow) + " " + h(day(w.toldDay)) : " · not told yet") : "") + "</span></div>";
    });
    s += '<div class="ck-doc"><span class="nm">' + (prices ? money(live.reduce((n, w) => n + w.amount, 0)) + " paid · " + money(b.owed) + " still owed"
      : h(plural(live.length, "payment", "payments") + " recorded")) + "</span></div></div>";
  }
  s += '<div class="ck-acts">' +
    (can.pay ? '<button type="button" class="btn-accept" id="ckWrite">&#10003; Record the payment</button>' : "") +
    '<button type="button" class="ac-b" id="ckClose">Close</button><span class="ac-msg" id="ckMsg"></span></div>';
  return s + "</div>";
}

/* ── the open panel's controls ────────────────────────────────────────── */

export function chosenMethod() {
  const fixed = document.getElementById("ckHowFixed");
  if (fixed) return fixed.value || "";
  const on = document.querySelector("#ckHow [data-how][aria-pressed='true']");
  return on ? on.getAttribute("data-how") : "";
}

/* the methods the open panel offers (its buttons, or the one fixed method) */
function panelMethods() {
  const fixed = document.getElementById("ckHowFixed");
  if (fixed) return fixed.value ? [fixed.value] : [];
  return Array.from(document.querySelectorAll("#ckHow [data-how]")).map((x) => x.getAttribute("data-how"));
}

function setSub(text, cls) {
  const sub = document.getElementById("ckRefSub");
  if (!sub) return;
  sub.textContent = text;
  sub.className = "sub" + (cls ? " " + cls : "");
}

/* the next number's words under the field (a suggestion: she types over it) */
function nextWords() {
  const n = P.next;
  if (n === null || n === undefined) return "";
  if (!n.next) return "Type the number on the next blank check: the first one starts the sequence.";
  const l = n.last;
  return "The next check by the register" + (l && l.number ? " (after #" + l.number + (l.paidDate ? ", " + shortDay(l.paidDate) : "") + ")" : "") +
    ". Change it if the check in hand has another number.";
}

export function paintMethod() {
  const m = chosenMethod();
  const lab = document.getElementById("ckRefLab"), num = document.getElementById("ckNumber");
  if (!lab) return;
  const rf = refField(m, panelMethods());
  lab.textContent = rf.label;
  if (num) num.placeholder = rf.placeholder;
  // the check number: the register's next one, prefilled while nothing else was typed; taken off again for cash
  if (num) {
    const pre = num.getAttribute("data-prefill") || "";
    if (m === "check" && P.next && P.next.next && (!num.value || num.value === pre)) {
      num.value = P.next.next;
      num.setAttribute("data-prefill", P.next.next);
    } else if (m !== "check" && pre && num.value === pre) {
      num.value = "";
      num.removeAttribute("data-prefill");
    }
  }
  if (P.clash && m === "check") setSub(P.clash, "err");
  else setSub(m === "check" && nextWords() ? nextWords() : rf.sub, m === "check" && P.next && !P.next.next ? "warn" : "");
  const go = document.getElementById("ckWrite");
  if (go) {
    go.textContent = WRITE_LABEL[m] || "✓ Record the payment";
    go.disabled = !m || P.busy;
  }
}

/* next_check_number(), kept a minute (asked again after a payment or a refused number) */
async function loadNext(force) {
  if (!force && P.next !== undefined && Date.now() - P.nextAt < NEXT_KEEP_MS) return P.next;
  const seq = ++P.seq;
  let n;
  try { n = await checks.nextCheckNumber(); } catch (e) { n = null; }
  if (seq !== P.seq) return P.next;
  P.next = n;
  P.nextAt = Date.now();
  return n;
}

/* check_number_info while the number is typed: an early word, the database still judges it on save */
async function warnNumber() {
  const num = document.getElementById("ckNumber");
  if (!num || chosenMethod() !== "check") return;
  const typed = num.value.trim();
  P.clash = "";
  if (!typed || typed === (num.getAttribute("data-prefill") || "")) { paintMethod(); return; }
  let info = null;
  try { info = await checks.checkNumberInfo(typed, null); } catch (e) { info = null; }
  if (!info || info.free || !info.clash || num.value.trim() !== typed) { paintMethod(); return; }
  const k = info.clash;
  const where = k.spoiled ? "a spoiled blank" + (k.paidDate ? ", " + fmtDay(k.paidDate) : "")
    : (k.payee || "no payee") + (k.paidDate ? ", " + fmtDay(k.paidDate) : "") + (k.voided ? ", voided" : "");
  setSub("Check #" + (k.number || typed) + " is already in the register (" + where + ")." +
    (k.spoiled || k.voided ? "" : " One check may pay several bills of the same payee on the same day.") +
    (info.next ? " The next free number is #" + info.next + "." : ""), "warn");
}

async function showDoc(i, detail) {
  const f = detail && detail.files[i];
  if (!f) return;
  const box = document.getElementById("ckViewer");
  if (isImage(f) && box) { await showIn(box, f, { errorText, onOpen: (x) => openTab(x, (e) => toast(errorText(e), "error")) }); return; }
  // "opened" only when it was: a refused link (a sign-in run out, no connection) keeps its words in the box
  const sent = await openTab(f, (e) => { if (box) box.textContent = errorText(e); else toast(errorText(e), "error"); });
  if (box && sent) box.textContent = f.name + " opened in a new tab.";
}

/** Wire the open panel inside `box`. ctx: {bill (the deskChecks entry), which, me, today, detail, onClose(),
    onDone(payment)}. */
export function wirePanel(box, ctx) {
  const c = ctx || {};
  const panel = document.getElementById("ckPanel");
  box.querySelectorAll("[data-doc]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); showDoc(Number(b.getAttribute("data-doc")), c.detail); }));
  box.querySelectorAll("#ckHow [data-how]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    box.querySelectorAll("#ckHow [data-how]").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    paintMethod();
  }));
  const close = document.getElementById("ckClose");
  if (close) close.addEventListener("click", (e) => { e.stopPropagation(); resetPanel(); if (c.onClose) c.onClose(); });
  // the panel sits inside the row's table: a click in it must not close it
  box.querySelectorAll(".ck-panel").forEach((p) => p.addEventListener("click", (e) => e.stopPropagation()));
  if (!panel || !c.bill || String(panel.getAttribute("data-bill")) !== String(c.bill.id)) { paintMethod(); return; }

  // what was typed before the page was drawn again
  const k = P.keep;
  P.keep = null;
  if (k) {
    const put = (id, v) => { const n = document.getElementById(id); if (n && v !== null && v !== undefined) n.value = v; };
    put("ckPayee", k.payee); put("ckAmount", k.amount); put("ckNumber", k.number); put("ckMemo", k.memo); put("ckDate", k.date);
    const num = document.getElementById("ckNumber");
    if (num && k.prefill) num.setAttribute("data-prefill", k.prefill);
    if (k.how) box.querySelectorAll("#ckHow [data-how]").forEach((x) => x.setAttribute("aria-pressed", x.getAttribute("data-how") === k.how ? "true" : "false"));
  }
  const host = document.getElementById("ckFiles");
  if (host) {
    P.drop = mountFileDrop(host, { label: FILES_LABEL, onChange: (list) => { P.files = list; }, pasteOn: panel,
      hint: "Drop them here, or press Ctrl+V on this panel. They are saved with the payment, once it is recorded." });
    if (P.files.length) P.drop.add(P.files);
  }
  const num = document.getElementById("ckNumber");
  if (num) {
    num.addEventListener("change", () => { warnNumber(); });
    num.addEventListener("input", () => { if (P.clash) { P.clash = ""; paintMethod(); } });
  }
  const date = document.getElementById("ckDate");
  if (date) date.addEventListener("change", () => {
    const bad = payDateProblem(date.value, c.today);
    const sub = document.getElementById("ckDateSub");
    if (sub) { sub.textContent = bad || (date.value === payDateBounds(c.today).today ? "Today." : "Dated " + fmtDay(date.value) + "."); sub.className = "sub" + (bad ? " err" : ""); }
  });
  const write = document.getElementById("ckWrite");
  if (write) write.addEventListener("click", (e) => { e.stopPropagation(); doWriteCheck(c); });
  paintMethod();
  // the register's next number, when a check can be written on this bill
  if (panelMethods().includes("check")) {
    const bill = c.bill.id;
    loadNext(false).then(() => { if (document.getElementById("ckPanel") && String(P.billId) === String(bill)) paintMethod(); });
  }
}

/* ── recording it ─────────────────────────────────────────────────────── */

async function doWriteCheck(c) {
  const msg = document.getElementById("ckMsg");
  const b = c.bill;
  if (!b || P.busy) return;
  const prices = seesPrices(c.me);
  const payee = (document.getElementById("ckPayee").value || "").trim();
  const amount = parseAmount(document.getElementById("ckAmount").value);
  const number = (document.getElementById("ckNumber").value || "").trim();
  const memo = (document.getElementById("ckMemo").value || "").trim();
  const dateEl = document.getElementById("ckDate");
  const paidDate = (dateEl && dateEl.value) || payDateBounds(c.today).today;
  const method = chosenMethod();
  const cash = method === "cash";
  const allowed = amountAllowed(amount, b.owed);
  const over = !allowed.ok && Number.isFinite(amount) && allowed.amount > 0;
  const bad = !method ? (b.pile === "transfer_card" ? "Say whether the bank sent it by ACH or by wire." : "Say whether this is by check or in cash.")
    : !number && method === "check" ? "Enter the check number."
      : !Number.isFinite(amount) ? "That is not an amount. Type it like 4500.00."
        : !allowed.ok ? (over && !prices ? "That is more than is still approved on this bill." : allowed.reason)
          : payDateProblem(paidDate, c.today);
  if (bad) { msg.textContent = bad; msg.className = "ac-msg err"; return; }
  const dated = paidDate === payDateBounds(c.today).today ? "" : ", dated " + fmtDay(paidDate);
  const what = method === "check" ? "check #" + number + (prices ? " for " + money(amount) : "")
    : (cash ? "a cash payment" : method === "card" ? "a card payment" : method === "ach" ? "an ACH transfer" : "a wire transfer") +
      (prices ? " of " + money(amount) : "") + (!cash && number ? " (" + number + ")" : "");
  const files = P.files.slice();
  const sure = await confirmBox("Record " + what + " to " + (payee || b.payee || "the vendor") + dated + "?" +
    (files.length ? " " + plural(files.length, "file goes", "files go") + " with it." : ""), { okText: "Record it" });
  if (!sure) return;
  P.busy = true;
  const go = document.getElementById("ckWrite");
  if (go) go.disabled = true;
  msg.className = "ac-msg";
  msg.textContent = "Recording…";
  let pay;
  try {
    pay = await books.recordPayment(b, { amount: allowed.amount, method, checkNumber: number, payee: payee || b.payee, memo: memo || b.memo, paidDate });
  } catch (e) {
    P.busy = false;
    if (go) go.disabled = false;
    const clash = clashText(e);
    if (clash && method === "check") {
      const n = await loadNext(true);
      P.clash = clash + (n && n.next ? " The next free number is #" + n.next + "." : "");
      paintMethod();
      msg.textContent = P.clash;
    } else {
      msg.textContent = errorText(e);
    }
    msg.className = "ac-msg err";
    return;
  }
  // the payment's files, now that the payment exists (the durable queue: they survive a closed tab)
  let res = { queued: 0, failed: [] };
  if (files.length && pay && pay.id != null) {
    res = await queueAll(files, uploads.enqueue, () => ({ projectId: b.projectId, kind: "payment", billId: b.id, paymentId: pay.id }));
    uploads.drain();
  }
  P.next = undefined;
  resetPanel();
  const done = (DONE_WORD[method] || "Check #" + number) + " recorded." +
    (res.queued ? " " + (res.queued === 1 ? "Its file is on its way." : res.queued + " files are on their way.") : "");
  toast(done, "ok");
  if (res.failed.length) toast("A file could not be queued: " + errorText(res.failed[0].error) + " Add it on the bill page.", "error");
  if (c.onDone) await c.onDone(pay, res);
}

/* ── the queue's lines for payment files ──────────────────────────────── */

/** Show the payment files still on their way in `el` (hidden when there are none). */
export async function watchQueue(el) {
  if (!el || P.watching) return;
  P.watching = true;
  await uploads.onProgress((items) => {
    const mine = items.filter((it) => it.kind === "payment");
    el.textContent = "";
    el.hidden = !mine.length;
    if (!mine.length) return;
    const head = document.createElement("div");
    head.className = "ck-q-h";
    head.textContent = plural(mine.length, "payment file", "payment files") + " on " + (mine.length === 1 ? "its" : "their") + " way";
    el.appendChild(head);
    mine.forEach((it) => {
      const line = document.createElement("div");
      line.className = "ck-q-i" + (it.state === "failed" ? " bad" : "");
      line.textContent = (it.state === "failed" ? "⚠ " : "⏳ ") + it.name + " — " + uploads.itemLabel(it, navigator.onLine !== false);
      if (it.state === "failed") {
        const again = document.createElement("button");
        again.type = "button";
        again.className = "lnk";
        again.textContent = "Try again";
        again.addEventListener("click", () => uploads.retryAll());
        line.appendChild(document.createTextNode(" "));
        line.appendChild(again);
      }
      el.appendChild(line);
    });
  });
  uploads.drain();
}

export const _test = { P, nextWords };
