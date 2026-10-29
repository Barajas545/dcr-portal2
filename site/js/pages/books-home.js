/* Accounting - books-home.html, the accountant's simple page (the Books program, release B part 2a; design-portal §2-§3
   with the build plan's I14-I24 and I29). An accountant with financials lands here after signing in (common2.js
   landingFor); admins and approvers open it from Home's "Accounting" card or the top bar.

   * The reminder PC's warning (rpc reminder_pc_status: not taking, paused, not heard from - "text or call instead"),
     never its name; my texts not marked sent yet (their number and body as the database stored them).
   * The chip bar: ⏸ Approvals · ✎ Checks · ☎ Pick-ups · ✓ Paid (30 d), each jumping to its list.
   * Needs approval: waiting for an approver - each with its LAST ASK (money_messages: who was asked, how, and what
     became of it) and [Ask to approve] (pages/ask-approval.js: one bill, or the ones ticked); approved but nobody said
     how to pay (the same ask); on her first - the paperwork (the database's reason, [Attach the invoice →] on the bill
     page); the sub submissions to review. An approver's rows also say "Open & approve →" (the bill page approves,
     signed in - nothing here does).
   * Checks to write: the check desk and the "Pay by bank transfer or card" list through the payment panel
     (pages/pay-panel.js - the next check number, the date, the payment's files).
   * Ready to pick up - tell them: one group per payee (pages/tell-payee.js: e-mail by itself, a text by hand, a call,
     in person) and the ones told and waiting at the office ([Picked up]).
   * Paid in the last 30 days (by the date on the check, Q6): filter chips All / Checks / Cash / Transfer / Card, the
     state (told, picked up, cleared), 📎 the payment's files then the bill's (pages/file-viewer.js), [Not picked up].
   * The big "Advanced mode — the Books →" (accounting.html) at the top and the foot; "Message templates"
     (pages/money-templates.js) for the money editors.
   * Refreshed when the page is looked at again, after every action, and every 30 s ONLY while one of my e-mails waits
     for the reminder PC (I32: no Realtime).
   WITHOUT the prices switch (S4) no amount is on the page. Only with the financials switch: anyone else is told so and
   sent home before anything is read. Every database word is escaped (h) or set as text. Nothing here approves. */

import { boot, esc, toast, errorText, confirmBox, D, can, seesPrices } from "./shell.js";
import { markLanded } from "../common2.js";
import { avatarHtml, paintAvatars } from "./avatar.js";
import * as panel from "./pay-panel.js";
import * as books from "../repo/books.js";
import * as checks from "../repo/checks.js";
import * as homeRepo from "../repo/books-home.js";
import * as uploads from "./uploads.js";
import { openViewer } from "./file-viewer.js";
import { chipBar, wireJumps, openSheet, ensureSheetStyle } from "./books-nav.js";
import { openAsk } from "./ask-approval.js";
import { groupHtml, waitingHtml, wireTell, textStep } from "./tell-payee.js";
import { openTemplates } from "./money-templates.js";
import { lastAskedText, PAID_FILTERS, paidState } from "../map/books-home.js";
import { pcWarning } from "../map/money-messages.js";
import { seesBooks, canApprove, fmtMoney, plural, shortDay, billHref } from "../map/books.js";
import { fmtDay } from "../map/pacific.js";

const h = esc;
const POLL_MS = 30000;
const NARROW = "(max-width: 560px)";
const state = { me: null, d: null, openCheck: null, detail: null, picked: {}, filter: "", timer: null, loading: null, again: false, watching: false };

function panelSpan() { return window.matchMedia && matchMedia(NARROW).matches ? 3 : 4; }
function day(v) { const s = fmtDay(v); return s === "—" ? "" : s.replace(/, \d{4}$/, ""); }
function lateText(n) { return n === null || n === undefined || n <= 0 ? "" : n === 1 ? "1 day late" : n + " days late"; }
const prices = () => seesPrices(state.me);
const money = () => can(state.me, "money");
const amount = (v) => (prices() ? h(fmtMoney(v)) : "");

/* the bill's own vendor contact (its picture), from the desk's links */
function contactOf(id) {
  const L = state.d && state.d.desk && state.d.desk.links;
  return id !== null && id !== undefined && L && L.contacts ? L.contacts.get(String(id)) || null : null;
}
function payee(x, words) {
  return '<span class="av-name">' + avatarHtml(contactOf(x.vendorContactId), { size: 28, name: words, edit: can(state.me, "contacts") }) +
    '<span class="av-t who">' + h(words || "(no vendor)") + "</span></span>";
}

/* ── needs approval ───────────────────────────────────────────────────── */

export function billRowHtml(b, o) {
  const opt = o || {};
  const late = lateText(b.lateBy);
  const pick = opt.pick && money();
  return '<div class="bh-row" data-bill="' + h(b.id) + '">' +
    (pick ? '<label class="bh-pick"><input type="checkbox" data-askpick="' + h(b.id) + '"' + (state.picked[b.id] ? " checked" : "") +
      ' aria-label="' + h("Pick " + (b.vendor || "this bill")) + '"></label>' : "") +
    '<div class="bh-main">' + payee(b, b.vendor) + (b.invoiceNumber ? ' <span class="meta">#' + h(b.invoiceNumber) + "</span>" : "") +
      '<div class="meta">' + h(b.projectLabel || "(no job)") + (b.dueDate ? " · due " + h(day(b.dueDate)) : "") + (late ? ' · <span class="late">' + h(late) + "</span>" : "") + "</div>" +
      (opt.since && b.loggedDay ? '<div class="meta">waiting since ' + h(day(b.loggedDay)) + "</div>" : "") +
      (opt.decide ? '<div class="meta">approved — needs how to pay</div>' : "") +
      (opt.reason && b.reason ? '<div class="reason">' + h(b.reason) + "</div>" : "") +
      (opt.asked ? '<div class="bh-asked">' + h(lastAskedText(b.lastAsked)) + "</div>" : "") + "</div>" +
    '<div class="bh-side">' + (prices() ? '<div class="num">' + amount(opt.decide ? b.owed : b.amount) + "</div>" : "") +
      '<div class="bh-acts">' +
      (opt.ask && money() ? '<button type="button" class="ac-b" data-ask="' + h(b.id) + '">Ask to approve</button>' : "") +
      (opt.attach && money() ? '<a class="ac-b" href="' + h(billHref(b.id)) + '#attach">Attach the invoice &rarr;</a>' : "") +
      '<a class="ac-b" href="' + h(billHref(b.id)) + '">' + (opt.ask && canApprove(state.me) ? "Open &amp; approve &rarr;" : "Open &rarr;") + "</a>" +
      "</div></div></div>";
}

function approvalsHtml(d) {
  let s = '<div class="ac-sec" id="secApprove"><header><h3>Needs approval</h3><span class="hint">Only an admin, or a manager with approve authority, approves a bill' +
    (state.me && state.me.role === "accountant" ? " — you ask them, and pay once it is approved" : "") + ".</span></header>";
  const nothing = !d.waiting.length && !d.toDecide.length && !d.blocked.length && !d.subs.count;
  if (nothing) return s + '<div class="ac-none">Nothing waiting on an approver.</div></div>';
  if (d.waiting.length) {
    s += '<h4 class="bh-sub" id="bhWaiting">Waiting for an approver · ' + h(String(d.waiting.length)) + "</h4>" +
      d.waiting.map((b) => billRowHtml(b, { pick: true, since: true, asked: true, ask: true })).join("");
  }
  if (d.toDecide.length) {
    s += '<h4 class="bh-sub" id="bhDecide">Approved, needs how to pay · ' + h(String(d.toDecide.length)) + "</h4>" +
      '<div class="ac-note" style="margin:0 0 6px">Saying how a bill is paid is an approver\'s: ask them.</div>' +
      d.toDecide.map((b) => billRowHtml(b, { pick: true, asked: true, ask: true, decide: true })).join("");
  }
  if (money() && (d.waiting.length || d.toDecide.length)) {
    const n = Object.keys(state.picked).length;
    s += '<div class="bh-bar"><button type="button" class="btn-accept" id="bhAskSel"' + (n ? "" : " disabled") + ">Ask to approve (" + h(String(n)) + " selected)</button></div>";
  }
  if (d.blocked.length) {
    s += '<h4 class="bh-sub" id="bhBlocked">On you first · ' + h(String(d.blocked.length)) + "</h4>" +
      d.blocked.map((b) => billRowHtml(b, { reason: true, attach: true })).join("");
  }
  if (d.subs.count) {
    s += '<h4 class="bh-sub" id="bhSubs">Sub submissions to review · ' + h(String(d.subs.count)) + "</h4><ul class=\"bh-subs\">" +
      d.subs.oldest.map((x) => "<li><b>" + h(x.vendor || x.contact || "A sub") + "</b> · " + h(x.kindLabel || "") + (x.reference ? " · " + h(x.reference) : "") +
        (x.projectLabel ? " · " + h(x.projectLabel) : "") + (x.created_at ? ' · <span class="meta">' + h(day(x.created_at)) + "</span>" : "") + "</li>").join("") +
      '</ul><a class="ac-b" href="submissions.html">Review &rarr;</a>';
  }
  return s + "</div>";
}

/* ── checks to write (the payment panel) ──────────────────────────────── */

const PILES = {
  pay: { key: "toPay", title: "Checks & cash", hint: "Approved to be paid by check or in cash. Open one to write it." },
  send: { key: "toSend", title: "Transfers & card payments to send", hint: "Approved to be sent from the bank or put on the card: no check number, nobody to tell." },
};

function pileHtml(d, which) {
  const P = PILES[which];
  const rows = d[P.key] || [];
  if (!rows.length) return "";
  let s = '<h4 class="bh-sub" id="' + (which === "pay" ? "bhPay" : "bhSend") + '">' + h(P.title) + " · " + h(String(rows.length)) + '</h4><div class="ac-note" style="margin:0 0 6px">' + h(P.hint) + "</div>";
  s += '<table class="ac-t ck-t"><thead><tr><th>Pay to</th><th class="hide-sm">How</th><th class="num">' + (prices() ? "Amount" : "") + '</th><th class="num c-go"></th></tr></thead><tbody>';
  rows.forEach((b) => {
    const open = String(state.openCheck) === String(b.id);
    s += '<tr class="ck-row" data-open="' + h(b.id) + '" tabindex="0" aria-expanded="' + open + '">' +
      '<td><div class="ck-payee">' + payee(b, b.payee || "(no payee on file)") + "</div>" +
        '<div class="ck-for">' + h(b.memo || b.projectLabel || "") + (b.partial ? '<span class="ck-part">part paid</span>' : "") + "</div></td>" +
      '<td class="hide-sm">' + panel.methodChip(b.payMethod) + "</td>" +
      '<td class="num">' + (prices() ? "<b>" + amount(b.owed) + "</b>" : "") + "</td>" +
      '<td class="num">' + (open ? "Close" : "Pay &rarr;") + "</td></tr>";
    if (open) {
      s += '<tr class="ck-open"><td class="ck-cell" colspan="' + panelSpan() + '">' +
        panel.checkPanel(b, d.can || {}, which, { detail: state.detail, me: state.me, today: d.today }) + "</td></tr>";
    }
  });
  return s + "</tbody></table>";
}

function checksHtml(d) {
  let s = '<div class="ac-sec" id="secChecks"><header><h3>Checks to write</h3><span class="hint">Checks are written by hand; record each one here with its number and date.</span></header>';
  if (!d.toPay.length && !d.toSend.length) return s + '<div class="ac-none">Nothing approved is waiting to be paid.</div></div>';
  if (!money()) s += '<div class="ac-note">Only an admin, or a manager or accountant with financials, records payments.</div>';
  return s + pileHtml(d, "pay") + pileHtml(d, "send") + "</div>";
}

/* ── ready to pick up ─────────────────────────────────────────────────── */

function tellHtml(d) {
  const ctx = { me: state.me, links: d.desk && d.desk.links, pc: d.pc };
  let s = '<div class="ac-sec" id="secTell"><header><h3>Ready to pick up — tell them</h3><span class="hint">A check or the cash is ready at the office.</span></header>';
  if (!d.tellGroups.length && !d.atOffice.length) return s + '<div class="ac-none">Nobody is waiting to hear about a check or cash.</div></div>';
  if (d.tellGroups.length) {
    s += '<h4 class="bh-sub" id="bhNotTold">Not told yet · ' + h(String(d.counts.pickups)) + "</h4>" +
      (pcWarning(d.pc) && money() ? '<div class="bh-pc sm">' + h(pcWarning(d.pc)) + "</div>" : "") +
      d.tellGroups.map((g) => groupHtml(g, ctx)).join("");
  }
  if (d.atOffice.length) {
    s += '<h4 class="bh-sub" id="bhAtOffice">Told, waiting for pickup · ' + h(String(d.atOffice.length)) + "</h4>" +
      d.atOffice.map((p) => waitingHtml(p, ctx)).join("");
  }
  return s + "</div>";
}

/* ── paid in the last 30 days ─────────────────────────────────────────── */

const METHOD_WORD = { check: "check", cash: "cash", ach: "ACH", wire: "wire", card: "card", other: "other" };

export function paidRowHtml(p) {
  const st = paidState(p);
  const unpick = money() && p.pickedUpAt && !p.clearedOn && p.collectable;
  return '<div class="bh-row bh-paid" data-paid="' + h(p.id) + '">' +
    '<div class="bh-date">' + h(shortDay(p.paidDate)) + "</div>" +
    '<div class="bh-main">' + payee(p, p.payee) +
      '<div class="meta">' + h(p.projectLabel || "") + "</div>" +
      '<div class="meta"><span class="ck-method ' + h(p.kind === "transfer" ? "transfer" : p.kind) + '">' + h(METHOD_WORD[p.method] || p.method) + "</span>" +
        (p.ref ? " " + (p.method === "check" ? "#" : "") + h(p.ref) : "") + " · " + h(st) + "</div></div>" +
    '<div class="bh-side">' + (prices() ? '<div class="num">' + amount(p.amount) + "</div>" : "") +
      '<div class="bh-acts">' + (p.fileCount ? '<button type="button" class="ac-b" data-files="' + h(p.id) + '" aria-label="' + h(plural(p.fileCount, "file", "files")) + '">&#128206; ' + h(String(p.fileCount)) + "</button>" : "") +
      (unpick ? '<button type="button" class="ac-b" data-unpick="' + h(p.id) + '">Not picked up</button>' : "") + "</div></div></div>";
}

function paidHtml(d) {
  const rows = d.paid30.filter((p) => !state.filter || p.kind === state.filter);
  let s = '<div class="ac-sec" id="secPaid"><header><h3>Paid in the last 30 days</h3><span class="hint">By the date on the check.</span></header>' +
    '<div class="bh-filters" role="group" aria-label="Show">' + PAID_FILTERS.map((f) => '<button type="button" data-filter="' + h(f.id) + '" aria-pressed="' +
      (state.filter === f.id) + '">' + h(f.label) + "</button>").join("") + "</div>";
  if (!rows.length) s += '<div class="ac-none">' + (d.paid30.length ? "None of these." : "Nothing paid in the last 30 days.") + "</div>";
  else s += rows.map(paidRowHtml).join("");
  const total = rows.reduce((n, p) => n + (Number(p.amount) || 0), 0);
  s += '<div class="bh-foot2">' + (prices() && rows.length ? "<b>" + h(fmtMoney(total)) + "</b> · " : "") + h(plural(rows.length, "payment", "payments")) +
    ' · <a href="books-checks.html">See every check in the check register &rarr;</a></div>';
  return s + "</div>";
}

/* ── the page ─────────────────────────────────────────────────────────── */

export function bodyHtml(d) {
  let s = "";
  const w = pcWarning(d.pc);
  if (w) s += '<div class="bh-pc" id="bhPc" role="status">' + h(w) + "</div>";
  if (!d.ready) s += '<div class="ac-note" id="bhNoMessages">The money messages are not in the database yet: asking and telling by e-mail or text come with its update.</div>';
  if (d.drafts.length) {
    s += '<div class="ac-sec bh-drafts" id="secDrafts"><header><h3>Texts not marked sent</h3><span class="hint">Did you send these? Say so, so the log is right.</span></header>' +
      '<div id="bhDraftList"></div></div>';
  }
  const c = d.counts;
  s += chipBar([
    { to: "secApprove", icon: "⏸", label: "Approvals", count: c.approvals },
    { to: "secChecks", icon: "✎", label: "Checks", count: c.checks },
    { to: "secTell", icon: "☎", label: "Pick-ups", count: c.pickups + c.atOffice },
    { to: "secPaid", icon: "✓", label: "Paid (30 d)", count: c.paid },
  ]);
  return s + approvalsHtml(d) + checksHtml(d) + tellHtml(d) + paidHtml(d);
}

function render() {
  const d = state.d;
  const box = document.getElementById("bhBody");
  if (!d || !box) return;
  panel.snapshot();
  box.innerHTML = bodyHtml(d);
  const list = document.getElementById("bhDraftList");
  if (list) d.drafts.forEach((m) => list.appendChild(textStep(m, { onDone: () => setTimeout(() => load(), 700) })));
  wire(box);
}

function billOf(id) {
  const d = state.d;
  return d ? d.waiting.concat(d.toDecide).find((b) => String(b.id) === String(id)) || null : null;
}

function syncPick() {
  const n = Object.keys(state.picked).length;
  const b = document.getElementById("bhAskSel");
  if (b) { b.disabled = !n; b.textContent = "Ask to approve (" + n + " selected)"; }
}

function ask(bills) {
  if (!bills.length) return;
  openAsk({ bills, me: state.me, templates: state.d.templates, today: state.d.today, onDone: () => { state.picked = {}; load(); } });
}

function openBill() {
  const d = state.d;
  if (!d || state.openCheck == null) return null;
  for (const which of ["pay", "send"]) {
    const b = (d[PILES[which].key] || []).find((x) => String(x.id) === String(state.openCheck));
    if (b) return { b, which };
  }
  return null;
}

function wire(box) {
  const d = state.d;
  wireJumps(box);
  // asks
  box.querySelectorAll("[data-askpick]").forEach((cb) => cb.addEventListener("change", () => {
    const id = cb.getAttribute("data-askpick");
    if (cb.checked) state.picked[id] = true; else delete state.picked[id];
    syncPick();
  }));
  box.querySelectorAll("[data-ask]").forEach((b) => b.addEventListener("click", () => { const x = billOf(b.getAttribute("data-ask")); if (x) ask([x]); }));
  const sel = document.getElementById("bhAskSel");
  if (sel) sel.addEventListener("click", () => ask(Object.keys(state.picked).map(billOf).filter(Boolean)));
  // the payment panel (js/pages/pay-panel.js): the open row's controls, the payment's files, recording it
  const open = openBill();
  panel.wirePanel(box, { bill: open ? open.b : null, which: open ? open.which : "", me: state.me, today: d.today, detail: state.detail,
    onClose: () => { state.openCheck = null; state.detail = null; render(); },
    onDone: async () => { state.openCheck = null; state.detail = null; await load(); } });
  const openRow = async (tr) => {
    const id = tr.getAttribute("data-open");
    if (String(state.openCheck) === String(id)) { panel.resetPanel(); state.openCheck = null; state.detail = null; render(); return; }
    state.openCheck = id; state.detail = null; render();
    try { state.detail = await books.loadBill(id, state.me); } catch (e) {
      state.openCheck = null; render(); toast(errorText(e), "error"); return;
    }
    if (String(state.openCheck) === String(id)) render();
  };
  box.querySelectorAll("[data-open]").forEach((tr) => {
    tr.addEventListener("click", () => openRow(tr));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRow(tr); } });
  });
  // telling (js/pages/tell-payee.js)
  wireTell(box, { me: state.me, links: d.desk && d.desk.links, groups: d.tellGroups, waiting: d.atOffice, today: d.today, sheet: openSheet, onChanged: () => load() });
  // paid
  box.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { state.filter = b.getAttribute("data-filter"); render(); }));
  box.querySelectorAll("[data-files]").forEach((b) => b.addEventListener("click", () => {
    const p = d.paid30.find((x) => String(x.id) === b.getAttribute("data-files"));
    if (p && p.files.length) openViewer(p.files, 0, { errorText });
  }));
  box.querySelectorAll("[data-unpick]").forEach((b) => b.addEventListener("click", async () => {
    const p = d.paid30.find((x) => String(x.id) === b.getAttribute("data-unpick"));
    if (!p) return;
    if (!(await confirmBox("Take the picked-up mark off " + (p.method === "check" ? "check #" + p.ref : "this cash payment") + "? They are still told.", { title: "Not picked up", okText: "Not picked up" }))) return;
    try { await checks.pickedUp(p, false); toast("No longer marked picked up.", "ok"); } catch (e) { toast(errorText(e), "error"); }
    load();
  }));
  paintAvatars(box, { me: state.me, onSaved: () => load() });
}

/* every 30 s, only while one of my e-mails waits for the reminder PC (I32); never over an open panel or dialog */
function schedule() {
  clearTimeout(state.timer);
  state.timer = null;
  if (!state.d || !state.d.waitingEmail) return;
  state.timer = setTimeout(() => {
    const sheet = document.getElementById("bhSheet");
    if (state.openCheck != null || (sheet && !sheet.hidden) || document.visibilityState === "hidden") { schedule(); return; }
    load();
  }, POLL_MS);
}

export async function load() {
  if (state.loading) { state.again = true; return state.loading; }
  state.loading = (async () => {
    try {
      state.d = await homeRepo.loadHome(state.me);
      Object.keys(state.picked).forEach((k) => { if (!billOf(k)) delete state.picked[k]; });
      render();
      schedule();
    } catch (e) {
      /* nothing from before a failed read is drawn again */
      state.d = null;
      const box = document.getElementById("bhBody");
      if (box) box.innerHTML = '<div class="ac-sec" style="color:var(--err)">' + h(errorText(e)) + "</div>";
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
  markLanded();                 // this session landed: Home stays Home from now on (common2.js landingFor)
  state.me = me;
  if (!seesBooks(me)) {
    document.getElementById("bhBody").innerHTML = '<div class="ac-none">The Accounting page is not available for your account.</div>';
    const al = D().alert;
    if (typeof al === "function") await al("The Accounting page is not available for your role: it needs the financials switch. Ask an admin.", { title: "Not available" });
    location.replace("dashboard.html");
    return;
  }
  document.title = "DCR Portal 2 — Accounting";
  ensureSheetStyle();
  // the chip bar sticks under the top bar, whatever its height
  const topH = () => { const t = document.getElementById("dcr2Topbar"); if (t) document.documentElement.style.setProperty("--bh-top", (t.offsetHeight || 0) + "px"); };
  topH();
  window.addEventListener("resize", topH);
  const first = String(me.name || "").split(" ")[0].split("@")[0];
  document.getElementById("bhGreeting").textContent = first ? "— " + first : "";
  const tpl = document.getElementById("bhTemplates");
  if (tpl && money()) {
    tpl.hidden = false;
    tpl.addEventListener("click", () => openTemplates({ me: state.me, templates: state.d && state.d.templates, onDone: () => load() }));
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.openCheck == null) load(); });
  // the payment files still on their way, and a reload when one has landed (its 📎 on the Paid list)
  panel.watchQueue(document.getElementById("ckQueue")).catch(() => {});
  uploads.onProgress((items, evt) => { if (evt && evt.type === "done" && evt.item && evt.item.kind === "payment") setTimeout(() => load(), 400); }).catch(() => {});
  window.addEventListener("resize", () => { document.querySelectorAll("td.ck-cell").forEach((td) => { td.colSpan = panelSpan(); }); });
  await load();
}

if (typeof document !== "undefined" && typeof window !== "undefined" && document.getElementById && !(window && window.__BH_TEST__)) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}

export const _test = { state, render: () => render(), bodyHtml, billRowHtml, paidRowHtml, wire: (b) => wire(b) };
