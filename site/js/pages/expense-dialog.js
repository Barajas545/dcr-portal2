/* Add / edit a cost, and its receipts, from the project's Expenses tab (owner decision 2026-10-24 D13; DCR
   Desktop 2's CostDialog and attach_receipt). Loaded on demand by project-expenses.js only: money code never
   reaches a crew phone (tests/p5b-ledger-pages.test.mjs, tests/p7w-pages.test.mjs).

   * openCostDialog(ctx, {costId?, vendors, onSaved}) — Kind (labour for a new cost), Date, Description, Vendor /
     who (this project's vendors offered), Hours and Rate (labour), Amount (negative for a return or a credit;
     filled and locked when hours × rate decide it), Estimate line, Paid with, the COST total, and its receipts -
     several at once (the Books program, release A: js/pages/file-drop.js - choose, drop, paste a screenshot; photos,
     scans or PDFs, at most 25 MB each, 20 at a time; the paste is heard on this dialog, never on the page). An edit
     lists the cost's receipts (opts.receipts: the Expenses tab's row) - look at one, or take a wrong one off (a soft
     delete: any money editor, I4). The rules and the words are map/cost-form.js (Desktop 2's). A new cost is ONE
     insert (an answer that never arrived: "may have been saved", and this dialog sends nothing more); an edit sends
     only what changed, at the version read (someone else's change meanwhile: theirs is shown). The estimate line
     of an edit is sent only when the person changed the select (map/cost-form.js payload, lineShown): the cost's
     own line is always offered, even an archived estimate's, and no select (no lines, a read that failed) sends
     none. There is no delete: a wrong cost is corrected, or a negative credit added.
   * attachReceipt(ctx, costId, file) / attachReceipts(ctx, costId, files, projectId?) — the upload queue (custody on
     this device first): kind receipt, the cost's id, f/{project}/receipts/… (a money editor's); a paste or the
     camera's own name ("IMG_4412.jpg") replaced by the queue's "Receipt <time>[-n]", a real name kept (the database
     makes a clash "name (2)").
   The database decides who may (costs RLS, t01_money_writer: an admin, or a manager or accountant with financials);
   the tab shows the buttons only to them (map/ledger.js canTag). Browser-only module. */

import * as repo from "../repo/ledger.js";
import * as filesRepo from "../repo/files.js";
import * as uploads from "./uploads.js";
import { KINDS, KIND_LABELS, CARDS, money } from "../map/ledger.js";
import { validate, payload, columns, costValue, byTheHour, receiptProblem } from "../map/cost-form.js";
import { ymd } from "../map/pacific.js";
import { mountFileDrop, queueAll } from "./file-drop.js";
import { openViewer } from "./file-viewer.js";

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LOST = "The answer didn't arrive: the cost may have been saved. Close this and check the list before adding it again.";

const st = { ctx: null, before: null, busy: false, lost: false, lines: [], lineShown: undefined, onSaved: null, host: null, drop: null, receipts: [] };

function $(id) { return document.getElementById(id); }

function host() {
  let h = $("exModal");
  if (!h) {
    h = document.createElement("div");
    h.id = "exModal";
    h.className = "pj-overlay";
    h.setAttribute("role", "dialog");
    h.setAttribute("aria-modal", "true");
    h.setAttribute("aria-labelledby", "cfH");
    document.body.appendChild(h);
    h.addEventListener("click", (e) => { if (e.target === h && !st.busy) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && h.classList.contains("open") && !st.busy) close(); });
  }
  return h;
}

function close() {
  if (st.drop) { st.drop.destroy(); st.drop = null; }
  const h = $("exModal");
  if (h) { h.classList.remove("open"); h.innerHTML = ""; }
  st.before = null;
  st.receipts = [];
}

/* An edit's receipts: each name opens the viewer; ✕ takes a wrong one off (a soft delete, after a question). */
function drawHave() {
  const box = $("cfHave");
  if (!box) return;
  box.textContent = "";
  if (!st.receipts.length) return;
  const head = document.createElement("div");
  head.className = "pj-sub";
  head.textContent = st.receipts.length === 1 ? "Its receipt:" : "Its " + st.receipts.length + " receipts:";
  box.appendChild(head);
  st.receipts.forEach((f, i) => {
    const line = document.createElement("div");
    line.className = "fd-have";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lg-r on";
    b.setAttribute("data-have", String(i));
    b.textContent = "📎 " + f.name;
    b.title = "Look at " + f.name;
    line.appendChild(b);
    const x = document.createElement("button");
    x.type = "button";
    x.className = "lg-r on";
    x.setAttribute("data-unhave", String(i));
    x.textContent = "✕";
    x.title = "Take this receipt off the cost";
    x.setAttribute("aria-label", "Take " + f.name + " off this cost");
    line.appendChild(x);
    box.appendChild(line);
  });
}

async function onHave(e) {
  const t = e.target && e.target.closest ? e.target.closest("[data-have], [data-unhave]") : null;
  if (!t || st.busy) return;
  if (t.hasAttribute("data-have")) { openViewer(st.receipts, Number(t.getAttribute("data-have")), { errorText: st.ctx.errorText }); return; }
  const f = st.receipts[Number(t.getAttribute("data-unhave"))];
  if (!f) return;
  const ask = st.ctx.confirm || ((m) => Promise.resolve(window.confirm(m)));
  if (!(await ask("Take the receipt “" + f.name + "” off this cost? It is kept in the history; an admin can bring it back.",
    { title: "Remove the receipt", okText: "Remove", danger: true }))) return;
  try {
    await filesRepo.removeFile({ id: f.id, version: f.version });
    st.receipts = st.receipts.filter((x) => x !== f);
    drawHave();
    st.ctx.toast("Receipt removed.", "ok");
    if (st.onSaved && st.before) st.onSaved(st.before);
  } catch (err) {
    say(st.ctx.errorText(err));
  }
}

function form() {
  const v = (id) => { const n = $(id); return n ? n.value : ""; };
  // no line select drawn: undefined, so an edit leaves the cost's line as it is (never "": that would untie it)
  return { kind: v("cfKind"), cost_date: v("cfDate"), description: v("cfDesc"), vendor: v("cfVendor"), hours: v("cfHours"),
    rate: v("cfRate"), amount: v("cfAmount"), estimate_item_id: $("cfLine") ? $("cfLine").value : undefined, card: v("cfCard") };
}

/** The labour boxes, the locked amount and the COST line follow what is typed (Desktop 2's _update_total). */
function update() {
  const f = form();
  const labor = f.kind === "labor";
  $("cfHoursBox").hidden = !labor;
  $("cfRateBox").hidden = !labor;
  const hourly = byTheHour(f);
  const amt = $("cfAmount");
  amt.disabled = hourly || st.busy;
  if (hourly) amt.value = costValue(f).toFixed(2);
  $("cfBasis").textContent = hourly ? Number(columns(f).hours) + " h × " + money(columns(f).rate) : "";
  $("cfTotal").textContent = money(costValue(f));
}

function say(text) { $("cfMsg").textContent = text || ""; }

function fill(row) {
  const r = row || {};
  $("cfKind").value = r.kind || "labor";
  $("cfDate").value = r.cost_date ? String(r.cost_date).slice(0, 10) : ymd(new Date());
  $("cfDesc").value = r.description || "";
  $("cfVendor").value = r.vendor || "";
  $("cfHours").value = r.hours === null || r.hours === undefined ? "" : String(Number(r.hours));
  $("cfRate").value = r.rate === null || r.rate === undefined ? "" : Number(r.rate).toFixed(2);
  $("cfAmount").value = row && r.amount !== null && r.amount !== undefined ? Number(r.amount).toFixed(2) : "";
  const sel = $("cfLine");
  if (sel) {
    const line = r.estimate_item_id === null || r.estimate_item_id === undefined ? "" : String(r.estimate_item_id);
    if (line && !Array.from(sel.options).some((o) => o.value === line)) {     // a line not offered: still the one shown
      const o = document.createElement("option");
      o.value = line;
      o.textContent = "Its present line (not on a live estimate)";
      sel.appendChild(o);
    }
    sel.value = line;
  }
  st.lineShown = sel ? sel.value : undefined;
  $("cfCard").value = r.card || "untagged";
  $("cfWarn").hidden = !(row && row.reconciled_at);
  update();
}

function draw(editing, vendors, hasLine) {
  const h = host();
  const lines = st.lines;
  h.innerHTML = '<div class="pj-modal" style="max-width:600px">' +
    '<h3 id="cfH">' + (editing ? "✎ Edit cost" : "＋ Add expense") + "</h3>" +
    '<div class="pj-clash" id="cfWarn" hidden>This cost is reconciled: changing the amount or “Paid with” un-reconciles it.</div>' +
    '<form id="cfForm" novalidate autocomplete="off"><div class="pj-grid">' +
    '<div class="pj-f"><label for="cfKind">Kind</label><select id="cfKind">' + KINDS.map((k) => '<option value="' + k + '">' + esc(KIND_LABELS[k]) + "</option>").join("") + "</select></div>" +
    '<div class="pj-f"><label for="cfDate">Date</label><input id="cfDate" type="date"></div>' +
    '<div class="pj-f full"><label for="cfDesc">Description</label><input id="cfDesc" maxlength="500" placeholder="What was it? e.g. Lumber delivery"></div>' +
    '<div class="pj-f full"><label for="cfVendor">Vendor / who</label><input id="cfVendor" maxlength="200" list="cfVendors" placeholder="Supplier, sub or crew member">' +
      '<datalist id="cfVendors">' + vendors.map((v) => '<option value="' + esc(v) + '"></option>').join("") + "</datalist></div>" +
    '<div class="pj-f" id="cfHoursBox"><label for="cfHours">Hours</label><input id="cfHours" inputmode="decimal"></div>' +
    '<div class="pj-f" id="cfRateBox"><label for="cfRate">Rate per hour ($)</label><input id="cfRate" inputmode="decimal"></div>' +
    '<div class="pj-f"><label for="cfAmount">Amount ($)</label><input id="cfAmount" inputmode="decimal">' +
      '<div class="pj-sub">Negative for a return or a credit</div></div>' +
    (lines.length || hasLine ? '<div class="pj-f full"><label for="cfLine">Estimate line (optional)</label><select id="cfLine"><option value="">Not tied to a line</option>' +
      lines.map((l) => '<option value="' + esc(l.id) + '">' + esc(l.label) + "</option>").join("") + "</select></div>" : "") +
    '<div class="pj-f full"><label for="cfCard">Paid with</label><select id="cfCard">' + CARDS.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.label) + "</option>").join("") +
      "</select></div>" +
    '<div class="pj-f full"><span class="pj-sub" style="font-weight:600">Receipts (optional: photos, scans or PDFs — several at once)</span>' +
      '<div id="cfHave"></div><div id="cfFiles"></div></div>' +
    '</div><div style="display:flex;align-items:baseline;gap:10px;margin-top:12px"><span class="pj-sub" style="font-weight:700;letter-spacing:.06em">COST</span>' +
    '<span class="pj-sub" id="cfBasis" style="flex:1"></span><b id="cfTotal" style="font-size:18px">$0.00</b></div>' +
    '<div class="pj-msg err" id="cfMsg" role="alert"></div>' +
    '<div class="pj-modal-actions"><button class="pj-btn" id="cfCancel" type="button">Cancel</button>' +
    '<button class="pj-btn pj-btn-primary" id="cfSave" type="submit">' + (editing ? "Save changes" : "Add cost") + "</button></div></form></div>";
  h.classList.add("open");
  // the receipts: one picker (several at once, drop, paste - heard on this dialog only)
  st.drop = mountFileDrop($("cfFiles"), { label: editing ? "Add receipts: drop, paste or choose" : "Receipts: drop, paste or choose" });
  $("cfHave").addEventListener("click", onHave);
  $("cfCancel").addEventListener("click", () => { if (!st.busy) close(); });
  $("cfForm").addEventListener("submit", (e) => { e.preventDefault(); save(); });
  $("cfForm").addEventListener("input", update);
  $("cfForm").addEventListener("change", update);
}

function lock(on) {
  st.busy = on;
  const b = $("cfSave");
  if (b) b.disabled = on;
  if (!on) update();
  else if ($("cfAmount")) $("cfAmount").disabled = true;
}

async function save() {
  if (st.busy) return;
  if (st.lost) { say(LOST); return; }
  const editing = !!st.before;
  const f = form();
  const errs = validate(f, editing);
  if (errs) { say(errs.cost_date || errs.hours || errs.rate || errs.amount || errs.description || errs.card); return; }
  const files = st.drop ? st.drop.files() : [];
  if (st.drop && st.drop.busy()) { say("Still reading the clipboard: try again in a moment."); return; }
  const ctx = st.ctx;
  lock(true);
  say("");
  let saved = null;
  try {
    if (editing) {
      const patch = payload(f, { editing: true, before: st.before, lineShown: st.lineShown });
      saved = Object.keys(patch).length ? await repo.updateCost(st.before, patch) : st.before;
    } else {
      saved = await repo.addCost(payload(f, { projectId: ctx.pid }));
    }
  } catch (e) {
    lock(false);
    if (editing && e && e.code === "PT409" && e.current) {
      st.before = e.current;
      fill(e.current);
      say("Someone else changed this cost: showing theirs. Change it again if it still needs it.");
      return;
    }
    const lost = !editing && (!e || ((!e.code || e.code === "NETWORK") && !(Number(e.status) >= 400)));
    if (lost) { st.lost = true; say(LOST); return; }
    say(ctx.errorText(e));
    return;
  }
  lock(false);
  const onSaved = st.onSaved;
  close();
  ctx.toast(editing ? "Cost saved." : "Cost added.", "ok");
  if (files.length && saved && saved.id != null) await attachReceipts(ctx, saved.id, files);
  if (onSaved) onSaved(saved);
}

/** Hand a receipt to the upload queue for the cost `costId` (the bytes are kept on this device until they are up). */
export async function attachReceipt(ctx, costId, file) {
  return (await attachReceipts(ctx, costId, [file])) === 1;
}

/** Hand receipts to the upload queue for the cost `costId` (of the project `projectId`, else ctx.pid) -> how many were
    queued. Each is checked first (a photo, a scan or a PDF, at most 25 MB); one refused never stops the others. */
export async function attachReceipts(ctx, costId, files, projectId) {
  const list = Array.from(files || []).filter(Boolean);
  const bad = list.map((f) => [f, receiptProblem(f)]).filter((x) => x[1]);
  const good = list.filter((f) => !receiptProblem(f));
  const pid = projectId === undefined || projectId === null ? ctx.pid : projectId;
  const res = await queueAll(good, uploads.enqueue, () => ({ projectId: pid, kind: "receipt", costId }));
  const problems = bad.map((x) => (x[0].name ? x[0].name + ": " : "") + x[1]).concat(res.failed.map((x) => ctx.errorText(x.error)));
  if (problems.length) ctx.toast(problems[0] + (problems.length > 1 ? " (and " + (problems.length - 1) + " more)" : ""), "error");
  if (res.queued) ctx.toast(res.queued === 1 ? "Receipt on its way." : res.queued + " receipts on their way.", "info");
  return res.queued;
}

/** opts: {costId (an edit) | nothing (a new cost), vendors: [names], receipts: [the cost's receipts] (an edit), onSaved(row)} */
export async function openCostDialog(ctx, opts) {
  const o = opts || {};
  if (st.drop) { st.drop.destroy(); st.drop = null; }
  st.ctx = ctx;
  st.onSaved = o.onSaved || null;
  st.lost = false;
  st.busy = false;
  st.before = null;
  st.lineShown = undefined;
  let row = null;
  if (o.costId !== undefined && o.costId !== null) {
    try { row = await repo.getCost(o.costId); } catch (e) { ctx.toast(ctx.errorText(e), "error"); return; }
    if (!row) { ctx.toast("That cost was not found — it may have been removed in DCR Desktop 2.", "error"); return; }
  }
  const line = row && row.estimate_item_id !== null && row.estimate_item_id !== undefined ? row.estimate_item_id : null;
  // the financials switch without prices: the lines' words amount-free (map/ledger.js lineLabel)
  try { st.lines = await repo.lineChoices(ctx.pid, line, !!ctx.prices); } catch (e) { st.lines = []; }
  const vendors = Array.from(new Set((o.vendors || []).map((v) => String(v || "").trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  draw(!!row, vendors, line !== null);
  st.before = row;
  st.receipts = row ? (o.receipts || []).slice() : [];
  drawHave();
  fill(row);
  setTimeout(() => { const n = $(row ? "cfDesc" : "cfKind"); if (n) n.focus(); }, 0);
}
