/* The check register - books-checks.html (the Books program, release A; design-portal §6.1, the build plan's I7-I12,
   I30 and S4; DCR Desktop 2 migration 20261030000300_check_register).

   * One line per physical check (the check_register view: payments grouped by number, date and payee - one check may
     pay several bills of the same payee on the same day), voided ones included, and one per spoiled blank; newest
     first, a month heading between months (a printed page breaks there).
   * The next number (next_check_number(): the last recorded check + 1, past every number used or spoiled - a
     suggestion) and the GAPS: a number missing between two written or spoiled ones, "#1045 missing — spoil it or find
     it", with [Spoil #1045]; a long run is said once and softly (another checkbook, or checks not entered here).
   * Money editors (an admin, or a manager or accountant with financials): Picked up (the day, and who collected it;
     told "in person" too when nobody was told), its undo; Mark cleared for the lines picked (a statement date) with
     the refused lines said in full and [Undo]; Take off cleared; Spoil a blank / take the spoiled mark off; Void - only
     while settings.payments_void_enabled is on (a reason, 3 to 300 characters; FINAL).
   * The admins' "Allow voiding checks" switch (a settings PATCH: settings are admin-write), with the phase-4 words:
     only once every PC runs DCR Desktop 2 2.25 (2.23 / 2.24 count a voided check as paid).
   * Filters (status, month, payee / job / number, number range), the Checks CSV of the lines shown (map/books.js
     toCsv: every cell quoted, the formula guard, a BOM, CRLF) and Print (a header, no buttons; nothing is ever printed
     ON a check).
   * WITHOUT the prices switch (S4): no amount column, no amount in the CSV or the print - and none is even read.
   Only with the financials switch: anyone else is told so and sent home before anything is read. Every database word
   is put on the page escaped (esc) or as text. */

import { boot, esc, toast, confirmBox, errorText, D } from "./shell.js";
import { avatarHtml, paintAvatars } from "./avatar.js";
import { openViewer } from "./file-viewer.js";
import * as repo from "../repo/checks.js";
import {
  buildRegister, filterRegister, monthsOf, monthLabel, statusText, STATUS_ORDER, STATUS_WORDS, rowActions, checkColumns, clashText,
  nextText, printTitle, firstDay, checkKey, gapText,
} from "../map/checks.js";
import { seesBooks, fmtMoney, toCsv, csvName, plural, shortDay } from "../map/books.js";
import { fmtDay } from "../map/pacific.js";

const h = esc;
const state = { me: null, raw: null, d: null, f: { status: "", month: "", q: "", from: "", to: "" }, picked: {}, done: null, busy: false };
const VOID_WHY = "Turn this on only when every office PC runs DCR Desktop 2 2.25 or later (About in DCR Desktop 2 shows the version), " +
  "and no other PC still runs 2.23 or 2.24: those versions count a voided check as paid - they show the bill as paid, cannot record " +
  "the replacement check, and keep the bill locked.";
const VOID_OFF_NOTE = "Voiding checks is switched off until every PC runs DCR Desktop 2 2.25 - an admin turns it on here.";

function modal(o) {
  const M = D().modal;
  return typeof M === "function" ? M(o) : Promise.resolve(null);
}
const prices = () => !!(state.raw && state.raw.prices);
const can = () => (state.raw && state.raw.can) || {};
const year = (d) => (d ? d.slice(0, 4) : "");
const sentenceOf = (e) => clashText(e) || errorText(e);

/* ── drawing ──────────────────────────────────────────────────────────── */

function nextBlock(d) {
  if (!d.next) return "";
  return '<div class="rg-next rg-noprint" id="rgNext">' + (d.next.next ? h(nextText(d.next))
    : "No check in the register yet: the first one written starts the sequence.") + "</div>";
}

function voidBlock(d) {
  const c = can();
  if (c.admin && state.raw.voidReady) {
    return '<div class="rg-void rg-noprint' + (d.voidEnabled ? " on" : "") + '" id="rgVoid"><label><input type="checkbox" id="rgVoidSwitch"' +
      (d.voidEnabled ? " checked" : "") + "> Allow voiding checks</label>" +
      '<div class="why">' + h(VOID_WHY) + "</div>" +
      '<div class="why">' + (d.voidEnabled ? "On: money editors can void a written check here, saying why. A void is final - only a check that has not cleared the bank."
        : "Off: no check can be voided. A check recorded by mistake and never told, picked up or cleared can still be deleted in DCR Desktop 2.") + "</div></div>";
  }
  return c.money && !d.voidEnabled ? '<div class="ac-note rg-noprint" style="margin:0 0 12px">' + h(VOID_OFF_NOTE) + "</div>" : "";
}

function gapsBlock(d) {
  if (!d.gaps.length) return "";
  const small = d.gaps.filter((g) => g.small);
  const missing = small.reduce((n, g) => n + g.count, 0);
  return '<div class="rg-gaps rg-noprint" id="rgGaps"><b>' + h(missing ? plural(missing, "number is", "numbers are") + " missing between checks" : "Gaps in the numbers") +
    "</b><ul>" + d.gaps.map((g) => "<li" + (g.small ? "" : ' class="soft"') + ">" + h(gapText(g)) +
      (g.small && can().money ? ' <button type="button" class="ac-b" data-spoil="' + h(g.from) + '" style="padding:2px 9px;font-size:12px">Spoil #' + h(g.from) + "</button>" : "") +
      "</li>").join("") + "</ul></div>";
}

function filtersBlock(d) {
  const f = state.f;
  const opt = (v, label, cur) => '<option value="' + h(v) + '"' + (v === cur ? " selected" : "") + ">" + h(label) + "</option>";
  return '<div class="rg-filters rg-noprint" id="rgFilters">' +
    '<label>Status<select id="rgStatus">' + opt("", "Every status", f.status) +
      STATUS_ORDER.filter((s) => d.counts[s]).map((s) => opt(s, STATUS_WORDS[s] + " (" + d.counts[s] + ")", f.status)).join("") + "</select></label>" +
    '<label>Month<select id="rgMonth">' + opt("", "Every month", f.month) + monthsOf(d.rows).map((m) => opt(m.id, m.label, f.month)).join("") + "</select></label>" +
    '<label>Payee, job or number<input class="q" id="rgQ" value="' + h(f.q) + '" placeholder="e.g. Kestrel" autocomplete="off"></label>' +
    '<label>From #<input class="num" id="rgFrom" value="' + h(f.from) + '" inputmode="numeric" autocomplete="off"></label>' +
    '<label>To #<input class="num" id="rgTo" value="' + h(f.to) + '" inputmode="numeric" autocomplete="off"></label>' +
    "</div>";
}

function rowHtml(r) {
  const c = can();
  const a = rowActions(r, { voidEnabled: state.d.voidEnabled });
  const spoiled = r.kind === "spoiled";
  const pickable = c.money && a.clear;
  const job = r.jobs.length ? r.jobs.join(", ") : "";
  let st = h(statusText(r));
  if (r.status === "void" && r.voidReason) st += '<div class="meta">' + h(r.voidReason) + "</div>";
  else if (spoiled && r.voidReason) st += '<div class="meta">' + h(r.voidReason) + "</div>";
  else if (r.status === "picked_up") {
    const note = (r.live.find((p) => p.pickedUpNote) || {}).pickedUpNote;
    if (note) st += '<div class="meta">by ' + h(note) + "</div>";
  }
  if (r.files.length) st += '<div><button type="button" class="rg-files" data-files="' + h(r.key) + '" title="The check\'s files">&#128206; ' + r.files.length + "</button></div>";
  let acts = "";
  if (c.money) {
    const b = (k, text, cls) => '<button type="button" data-act="' + k + '" data-key="' + h(r.key) + '"' + (cls ? ' class="' + cls + '"' : "") + ">" + h(text) + "</button>";
    if (a.pickUp) acts += b("pickup", "Picked up");
    if (a.undoPickUp) acts += b("unpickup", "Not picked up");
    if (a.unclear) acts += b("unclear", "Take off cleared");
    if (a.void) acts += b("void", "Void", "bad");
    if (a.unspoil) acts += b("unspoil", "Not spoiled");
  }
  const amount = r.status === "void" ? r.writtenAmount : r.amount;
  return '<tr class="' + h(r.status) + '">' +
    (c.money ? '<td class="pick">' + (pickable ? '<input type="checkbox" data-pick="' + h(r.key) + '" aria-label="Pick check #' + h(r.number) + '"' +
      (state.picked[r.key] ? " checked" : "") + ">" : "") + "</td>" : "") +
    '<td><span class="who">#' + h(r.number) + "</span>" + (r.numberReused ? '<span class="reused" title="Another check or blank has this number">used twice</span>' : "") +
      '<div class="meta">' + h(shortDay(r.paidDate)) + ", " + h(year(r.paidDate)) + "</div>" +
      (prices() && !spoiled && amount != null ? '<div class="meta show-sm">' + h(fmtMoney(amount)) + "</div>" : "") + "</td>" +
    "<td>" + (spoiled ? '<span class="meta">A blank, spoiled</span>'
      : '<span class="av-name">' + avatarHtml(r.contact, { size: 24, name: r.payee || "?" }) + '<span class="av-t">' + h(r.payee || "(no payee)") + "</span></span>" +
        (job ? '<div class="meta show-sm">' + h(job) + "</div>" : "")) + "</td>" +
    '<td class="hide-sm">' + h(job) + (r.billIds.length > 1 ? '<div class="meta">' + h(plural(r.billIds.length, "bill", "bills")) + "</div>" : "") + "</td>" +
    (prices() ? '<td class="num hide-sm">' + (spoiled || amount == null ? "" : h(fmtMoney(amount))) + "</td>" : "") +
    // the line's buttons: their own column on a desk, under the status on a phone (one is hidden by css/books.css)
    '<td class="st ' + h(r.status) + '">' + st + (c.money && acts ? '<div class="acts show-sm">' + acts + "</div>" : "") + "</td>" +
    (c.money ? '<td class="acts-c hide-sm"><div class="acts">' + acts + "</div></td>" : "") +
    "</tr>";
}

function tableBlock(shown) {
  const c = can();
  // a month heading: one cell per column, the phone's hidden ones hidden with theirs (a colspan over a hidden column
  // would make the fixed phone layout share the payee's width with it)
  const monthCells = (label) => (c.money ? '<td class="pick"></td>' : "") + '<td colspan="2">' + h(label) + "</td>" + '<td class="hide-sm"></td>' +
    (prices() ? '<td class="hide-sm"></td>' : "") + "<td></td>" + (c.money ? '<td class="hide-sm"></td>' : "");
  if (!shown.length) {
    return '<div class="ac-none">' + (state.d.rows.length ? "No check matches these filters." : "No check is in the register yet.") + "</div>";
  }
  const allPicked = shown.filter((r) => rowActions(r, {}).clear).every((r) => state.picked[r.key]);
  let s = '<table class="ac-t rg-t" id="rgTable"><thead><tr>' +
    (c.money ? '<th class="c-pick"><input type="checkbox" id="rgAll" aria-label="Pick every check shown"' + (allPicked && shown.some((r) => rowActions(r, {}).clear) ? " checked" : "") + "></th>" : "") +
    '<th class="c-no">Check</th><th>Payee</th><th class="hide-sm">Job</th>' + (prices() ? '<th class="num hide-sm c-amt">Amount</th>' : "") +
    '<th class="c-st">Status</th>' + (c.money ? '<th class="c-acts hide-sm"></th>' : "") + "</tr></thead><tbody>";
  let month = null, first = true;
  shown.forEach((r) => {
    if (r.month !== month) {
      month = r.month;
      s += '<tr class="rg-month' + (first ? " first" : "") + '">' + monthCells(monthLabel(month) || "No date") + "</tr>";
      first = false;
    }
    s += rowHtml(r);
  });
  return s + "</tbody></table>";
}

function doneBlock() {
  const x = state.done;
  if (!x) return "";
  if (x.kind === "undone") return '<div class="rg-done" role="status">' + h(x.text) + "</div>";
  return '<div class="rg-done" role="status"><b>' + h(x.text) + "</b>" +
    (x.lines.length ? "<ul>" + x.lines.map((l) => "<li>" + h(l) + "</li>").join("") + "</ul>" : "") +
    (x.changed && x.changed.length ? '<div class="ac-actions"><button type="button" class="ac-b" id="rgUndo">Undo</button></div>' : "") + "</div>";
}

function shownRows() { return filterRegister(state.d.rows, state.f); }

function render() {
  const d = state.d;
  const c = can();
  const shown = shownRows();
  const picked = d.rows.filter((r) => state.picked[r.key]);
  let s = nextBlock(d) + voidBlock(d) + gapsBlock(d);
  s += '<div class="ac-sec" id="rgSec"><div class="rg-bar rg-noprint">' +
    (c.money ? '<button type="button" class="ac-b" id="rgSpoil">Spoil a blank…</button>' +
      '<button type="button" class="ac-b go" id="rgClear"' + (picked.length ? "" : " disabled") + ">&#10003; Mark cleared" +
        (picked.length ? " (" + picked.length + ")" : "") + "…</button>" : "") +
    '<span class="grow"></span><span class="hint">' + h(plural(shown.length, "line", "lines") + (shown.length !== d.rows.length ? " of " + d.rows.length : "")) + "</span>" +
    '<button type="button" class="ac-b" id="rgCsv"' + (shown.length ? "" : " disabled") + ">&#8615; Checks CSV</button>" +
    '<button type="button" class="ac-b" id="rgPrint">Print</button></div>' +
    filtersBlock(d) + tableBlock(shown) + doneBlock() + "</div>";
  document.getElementById("rgBody").innerHTML = s;
  wire();
}

/* ── the controls ─────────────────────────────────────────────────────── */

const rowOf = (key) => state.d.rows.find((r) => r.key === key) || null;

function wire() {
  const box = document.getElementById("rgBody");
  const on = (id, ev, fn) => { const n = document.getElementById(id); if (n) n.addEventListener(ev, fn); };
  on("rgStatus", "change", (e) => { state.f.status = e.target.value; render(); });
  on("rgMonth", "change", (e) => { state.f.month = e.target.value; render(); });
  ["rgQ", "rgFrom", "rgTo"].forEach((id) => on(id, "change", (e) => {
    state.f[id === "rgQ" ? "q" : id === "rgFrom" ? "from" : "to"] = e.target.value;
    render();
  }));
  box.querySelectorAll("[data-pick]").forEach((cb) => cb.addEventListener("change", () => {
    const k = cb.getAttribute("data-pick");
    if (cb.checked) state.picked[k] = true; else delete state.picked[k];
    render();
  }));
  on("rgAll", "change", (e) => {
    const list = shownRows().filter((r) => rowActions(r, {}).clear);
    list.forEach((r) => { if (e.target.checked) state.picked[r.key] = true; else delete state.picked[r.key]; });
    render();
  });
  on("rgSpoil", "click", () => spoil(""));
  box.querySelectorAll("[data-spoil]").forEach((b) => b.addEventListener("click", () => spoil(b.getAttribute("data-spoil"))));
  on("rgClear", "click", markCleared);
  on("rgUndo", "click", undoCleared);
  on("rgCsv", "click", download);
  on("rgPrint", "click", print);
  on("rgVoidSwitch", "change", (e) => voidSwitch(e.target));
  box.querySelectorAll("[data-files]").forEach((b) => b.addEventListener("click", () => {
    const r = rowOf(b.getAttribute("data-files"));
    if (r) openViewer(r.files, 0, { errorText, onError: (e) => toast(errorText(e), "error") });
  }));
  box.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
    const r = rowOf(b.getAttribute("data-key"));
    if (!r || state.busy) return;
    const k = b.getAttribute("data-act");
    if (k === "pickup") pickUp(r);
    else if (k === "unpickup") unPickUp(r);
    else if (k === "unclear") unclearRow(r);
    else if (k === "void") voidRow(r);
    else if (k === "unspoil") unspoil(r);
  }));
  paintAvatars(box, { me: state.me });
}

/* every live payment of a check through one RPC, in order; -> the first error (the rest are not tried) */
async function each(list, fn) {
  for (const p of list) {
    try { await fn(p); } catch (e) { return e; }
  }
  return null;
}

async function finish(e, ok) {
  state.busy = false;
  if (e) {
    toast((e.code === "PT409" || e.status === 409) ? "Someone changed this check meanwhile: here it is as it is now. Try again." : sentenceOf(e), "error");
  } else if (ok) {
    toast(ok, "ok");
  }
  await load();
}

async function pickUp(r) {
  const today = state.d.today;
  const todo = r.live.filter((p) => !p.pickedUpAt && !p.clearedOn);
  if (!todo.length) return;
  const from = todo.map(firstDay).filter(Boolean).sort()[todo.length - 1] || today;
  const v = await modal({
    title: "Picked up — check #" + r.number,
    message: "To " + (r.payee || "the payee") + ", dated " + fmtDay(r.paidDate) + ". When did they collect it? If nobody told them it was ready, it is marked told in person too.",
    okText: "Mark picked up",
    fields: [{ name: "d", label: "Picked up on", type: "date", value: today },
      { name: "n", label: "Who collected it (if not the payee)", placeholder: "e.g. their foreman", value: "" }],
    validate: (x) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.d || "")) return "Pick the day it was collected.";
      if (x.d > today) return "The day it was collected is today or earlier.";
      if (x.d < from) return "The day it was collected is " + fmtDay(from) + " or later.";
      if (String(x.n || "").trim().length > repo.NOTE_MAX) return "Who collected it: at most " + repo.NOTE_MAX + " characters.";
      return "";
    },
  });
  if (!v) return;
  state.busy = true;
  const e = await each(todo, (p) => repo.pickedUp(p, true, { date: v.d === today ? null : v.d, note: v.n }));
  await finish(e, "Check #" + r.number + " is marked picked up.");
}

async function unPickUp(r) {
  const todo = r.live.filter((p) => p.pickedUpAt && !p.clearedOn);
  if (!todo.length) return;
  if (!(await confirmBox("Take the picked-up mark off check #" + r.number + "? It goes back to waiting at the office.", { title: "Not picked up", okText: "Take it off" }))) return;
  state.busy = true;
  const e = await each(todo, (p) => repo.pickedUp(p, false));
  await finish(e, "Check #" + r.number + " is back to waiting at the office.");
}

async function voidRow(r) {
  const todo = r.live.filter((p) => !p.voided);
  if (!todo.length || !state.d.voidEnabled) return;
  const v = await modal({
    title: "Void check #" + r.number,
    message: "To " + (r.payee || "the payee") + ", dated " + fmtDay(r.paidDate) + ". Voiding is FINAL: the check stays in the register as void, " +
      "it counts as paid on no bill, and the bill is owed again - write a new check for it. A check that cleared the bank cannot be voided.",
    okText: "Void the check", danger: true,
    fields: [{ name: "r", label: "Why (3 to 300 characters)", type: "textarea", rows: 2, placeholder: "e.g. lost in the mail - a new check is written" }],
    validate: (x) => {
      const t = String(x.r || "").replace(/\s+/g, " ").trim();
      return t.length < repo.REASON_MIN || t.length > repo.REASON_MAX ? "Say why it is voided, in 3 to 300 characters." : "";
    },
  });
  if (!v) return;
  state.busy = true;
  const e = await each(todo, (p) => repo.voidPayment(p, v.r));
  await finish(e, "Check #" + r.number + " is void. The bill is owed again.");
}

async function spoil(number) {
  const prefill = number || (state.d.next && state.d.next.next) || "";
  const v = await modal({
    title: "Spoil a blank check",
    message: "For a blank check torn, misprinted or lost before it was written. Its number is never used again; the register says why it is missing.",
    okText: "Mark it spoiled",
    fields: [{ name: "n", label: "Check number", value: prefill }, { name: "r", label: "Why", placeholder: "e.g. torn in the printer" }],
    validate: async (x) => {
      if (!checkKey(x.n) || String(x.n).trim().length > 40) return "Type the number printed on the blank check.";
      const t = String(x.r || "").replace(/\s+/g, " ").trim();
      if (t.length < repo.REASON_MIN || t.length > repo.REASON_MAX) return "Say why, in 3 to 300 characters.";
      try { await repo.spoilCheck(x.n, x.r); } catch (e) { return sentenceOf(e); }
      return "";
    },
  });
  if (!v) return;
  toast("Blank #" + String(v.n).trim() + " is marked spoiled.", "ok");
  await load();
}

async function unspoil(r) {
  if (!(await confirmBox("Take the spoiled mark off blank #" + r.number + "? Only when it was marked by mistake: the number can then be written on a check.",
    { title: "Not spoiled", okText: "Take it off" }))) return;
  state.busy = true;
  let e = null;
  try { await repo.unspoilCheck(r.spoiledId); } catch (x) { e = x; }
  await finish(e, "Blank #" + r.number + " is no longer marked spoiled.");
}

/* "Mark cleared": the picked lines' live payments on a statement date; the refused ones said in full; Undo. */
async function markCleared() {
  const rows = state.d.rows.filter((r) => state.picked[r.key]);
  const ids = [];
  rows.forEach((r) => r.live.filter((p) => !p.clearedOn).forEach((p) => ids.push(p.id)));
  if (!ids.length) return;
  const today = state.d.today;
  const v = await modal({
    title: "Mark cleared",
    message: plural(rows.length, "check", "checks") + " picked. The day they cleared the bank (the statement date):",
    okText: "Mark cleared",
    fields: [{ name: "d", label: "Cleared on", type: "date", value: today }],
    validate: (x) => (!/^\d{4}-\d{2}-\d{2}$/.test(x.d || "") ? "Pick the statement date." : x.d > today ? "A check clears today or earlier." : ""),
  });
  if (!v) return;
  state.busy = true;
  let res;
  try { res = await repo.clearPayments(ids, true, v.d); } catch (e) { await finish(e); return; }
  state.picked = {};
  state.done = { kind: "clear", changed: res.changed, text: plural(res.changed.length, "payment", "payments") + " marked cleared on " + fmtDay(res.clearedOn || v.d) +
    (res.unchanged.length ? " (" + res.unchanged.length + " already were)" : "") + (res.refused.length ? "; " + res.refused.length + " not:" : "."),
    lines: refusedLines(res.refused) };
  state.busy = false;
  await load();
}

async function undoCleared() {
  const x = state.done;
  if (!x || !x.changed || !x.changed.length || state.busy) return;
  state.busy = true;
  let res;
  try { res = await repo.clearPayments(x.changed, false); } catch (e) { await finish(e); return; }
  state.done = { kind: "undone", text: "Undone: " + plural(res.changed.length, "payment is", "payments are") + " no longer marked cleared." };
  state.busy = false;
  await load();
}

async function unclearRow(r) {
  const ids = r.live.filter((p) => p.clearedOn).map((p) => p.id);
  if (!ids.length) return;
  if (!(await confirmBox("Take the cleared mark off check #" + r.number + "? Only when the bank returned it, or it was marked by mistake.",
    { title: "Take off cleared", okText: "Take it off" }))) return;
  state.busy = true;
  let res;
  try { res = await repo.clearPayments(ids, false); } catch (e) { await finish(e); return; }
  state.done = res.refused.length ? { kind: "clear", changed: [], text: "Not taken off:", lines: refusedLines(res.refused) } : null;
  await finish(null, "Check #" + r.number + " is no longer marked cleared.");
}

/* clear_payments' refused[] in words: "#5306 Stonebrook Concrete: It was written after that day." */
function refusedLines(refused) {
  return (refused || []).map((x) => {
    const id = Number(x && x.id);
    const r = state.d.rows.find((row) => row.paymentIds.includes(id));
    return (r ? "#" + r.number + (r.payee ? " " + r.payee : "") : "Payment " + id) + ": " + String((x && x.reason) || "not marked.");
  });
}

/* the admin's switch (settings are admin-write; the database's own words if refused) */
async function voidSwitch(input) {
  const want = !!input.checked;
  const sure = await confirmBox(want
    ? "Is every PC on DCR Desktop 2 2.25 or later? Check About on both office PCs, and that no other PC still runs 2.23 or 2.24 - they would count a voided check as paid."
    : "Stop new voids? Checks voided already stay void.",
  { title: want ? "Allow voiding checks" : "Stop voiding checks", okText: want ? "Yes - allow voiding" : "Stop voiding", danger: want });
  if (!sure) { input.checked = !want; return; }
  input.disabled = true;
  try {
    await repo.setVoidEnabled(want, state.raw.settingsVersion);
    toast(want ? "Voiding checks is on." : "Voiding checks is off.", "ok");
  } catch (e) {
    toast((e.code === "PT409" || e.status === 409) ? "The settings were changed meanwhile: here they are as they are now." : errorText(e), "error");
  }
  await load();
}

/* the Checks CSV of the lines shown: the amount only with the prices switch (S4) */
function download() {
  const rows = shownRows();
  if (!rows.length) return;
  const text = toCsv(rows, checkColumns(prices()));
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = csvName("checks", state.d.today);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast("The CSV is downloading: " + plural(rows.length, "line", "lines") + ".", "ok");
}

function print() {
  const head = document.getElementById("rgPrintHead");
  if (head) head.textContent = printTitle(shownRows(), state.d.today, state.me && state.me.name);
  window.print();
}

/* ── the page ─────────────────────────────────────────────────────────── */

async function load() {
  try {
    state.raw = await repo.loadRegister(state.me);
    state.d = buildRegister(state.raw, { today: state.raw.today });
    // a picked line that is gone, or no longer clears, is unpicked
    Object.keys(state.picked).forEach((k) => { const r = rowOf(k); if (!r || !rowActions(r, {}).clear) delete state.picked[k]; });
    render();
  } catch (e) {
    /* nothing from before a failed read is drawn again */
    state.d = null;
    document.getElementById("rgBody").innerHTML = '<div class="ac-sec" style="color:var(--err)">' + h(errorText(e)) + "</div>";
  }
}

async function start() {
  let me;
  try { me = await boot("books"); } catch (e) { return; }
  state.me = me;
  if (!seesBooks(me)) {
    document.getElementById("rgBody").innerHTML = '<div class="ac-none">The check register is not available for your account.</div>';
    const al = D().alert;
    if (typeof al === "function") await al("The check register is not available for your role: it needs the financials switch. Ask an admin.", { title: "Not available" });
    location.replace("dashboard.html");
    return;
  }
  document.title = "DCR Portal 2 — Check register";
  const first = String(me.name || "").split(" ")[0].split("@")[0];
  document.getElementById("rgGreeting").textContent = first ? "— " + first : "";
  // a printed page always carries its header, whichever way it was printed (Ctrl+P too)
  window.addEventListener("beforeprint", () => {
    const head = document.getElementById("rgPrintHead");
    if (head && state.d) head.textContent = printTitle(shownRows(), state.d.today, state.me && state.me.name);
  });
  await load();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}

export const _test = { state, rowHtml, tableBlock, render: () => render() };
