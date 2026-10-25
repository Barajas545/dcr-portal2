/* Project tab Estimate for an Estimator: the web estimate and change-order editor (owner 2026-10-24: Q12 reversed — an
   admin, or a manager with the Estimator switch, edits estimates and change orders on the web too; decisions D1,
   D4-D7; migration 20261028000100_estimator.sql). Loaded by project-estimate.js only for an Estimator, through a lazy
   import: a crew phone never downloads it (site/sw.js keeps the read-only tab only).

   The cards are the read-only tab's (est-render.js estimateCardsHtml with its edit hooks); a tap opens a sheet
   (est-sheet.js): the estimate (name, description, the terms with prices, the status; archive / restore, duplicate
   with prices, delete), a group (rename, code, Up / Down, a new item in it) or an item (name, type, the Labor /
   Material / Sub-contractor boxes its type shows, assigned, the notes and the live total with prices; Up / Down, Move
   to group, Move to estimate, Delete). ＋ Estimate and ＋ Change order make a new one (the database numbers it). On a
   phone (375 px) a sheet is the whole screen with Save always in view; there is no drag and no hover.

   The data: repo/estimate-edit.js (rpc estimate_edit_read; never estimate_print). For a person WITHOUT prices the
   database sends no amount, note or term at all and the words amount-free; a box whose stored words quote an amount is
   shown that way, read only, and never sent; Approved, Duplicate and every price box are not there; an approved
   estimate keeps its status, archive, deletion, its items' type and quantities, and nothing moves in or out of it;
   a group whose name or code quotes an amount is not renamed, recoded, added to or moved into, and groups are not
   reordered while one is (the database refuses each of these anyway: D5, D6).

   Every write carries the versions it was shown. An item saved by someone else first: the same changes go again when
   they touched none of these fields, else the conflict panel ("Riley changed Material qty: theirs 420 · yours 400";
   Keep theirs / Use mine); a rearrangement someone else beat: "Changed by someone else — showing the latest." Live:
   the project's estimates, items, flags and (prices) price rows read again 300 ms after a burst; an open sheet keeps
   what was typed, takes their values into the untouched boxes and says so. A refusal (42501) reads the Estimator
   switch again: switched off, the tab turns read only. */

import * as repo from "../repo/estimate-edit.js";
import { estimateAccess } from "../repo/estimates.js";
import * as M from "../map/estimate-edit.js";
import { estimateCardsHtml, contractStripHtml, esc } from "./est-render.js";
import { itemFormHtml, estimateFormHtml, groupFormHtml, conflictHtml, sheetHtml, liveLineHtml } from "./est-sheet.js";
import { moneyShown, isChangeOrder, wordsFor, estimateEditor, cleanName } from "../map/estimates.js";
import { nameBook } from "../repo/people.js";
import { D, store } from "./shell.js";

let host = null, cx = null, seq = 0, timer = null, fallback = null, nameOf = null;
const state = { model: null, filter: "*", showArchived: false, sheet: null, busy: false };

/* ── the tab ───────────────────────────────────────────────────────── */
export function render(ctx, el, opts) {
  host = el;
  cx = ctx;
  fallback = opts && typeof opts.fallback === "function" ? opts.fallback : null;
  host.classList.add("es-pane", "es-editor");
  host.innerHTML = '<div class="es-bar" id="esBar"></div><div id="esStrip"></div><div id="esList"><div class="pj-empty">Loading estimates…</div></div>' +
    '<div class="es-sheet" id="esSheet" hidden></div>';
  host.addEventListener("click", onClick);
  host.addEventListener("change", onChange);
  host.addEventListener("input", onInput);
  host.addEventListener("keydown", onKey);
  host.addEventListener("submit", onSubmit);
  window.addEventListener("beforeunload", onUnload);
  nameBook().then(function (f) { nameOf = f; }, function () { /* names are a nicety */ });
  load();
}

function $(id) { return document.getElementById(id); }
function prices() { return !!(state.model && state.model.prices); }
function toast(text, kind) { if (cx && cx.toast) cx.toast(text, kind); }
function errorText(e) { return cx && cx.errorText ? cx.errorText(e) : (e && e.message) || "Something went wrong."; }
function firstName(uid) { const n = nameOf ? nameOf(uid) : ""; return (n.split(/\s+/)[0]) || "Someone else"; }
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isConflict = (e) => !!e && (String(e.code) === "PT409" || e.status === 409);
const isGone = (e) => !!e && String(e.code) === "PT404";

/** The read-only tab again (the Estimator switch is off, or the database has no editor read yet). */
function toReadOnly(why) {
  if (!host) return;
  closeSheet(true);
  host.removeEventListener("click", onClick);
  host.removeEventListener("change", onChange);
  host.removeEventListener("input", onInput);
  host.removeEventListener("keydown", onKey);
  host.removeEventListener("submit", onSubmit);
  window.removeEventListener("beforeunload", onUnload);
  host.classList.remove("es-editor");
  host = null;
  if (why) toast(why, "info");
  if (fallback) fallback();
}

async function load() {
  if (!host) return;
  const my = ++seq;
  try {
    const model = await repo.loadEditor(cx.pid);
    if (my !== seq || !host) return;
    if (!model.canEdit) { toReadOnly("Your account does not edit estimates (the Estimator switch): the tab shows them read only."); return; }
    state.model = model;
    draw();
    adoptLive();
  } catch (e) {
    if (my !== seq || !host) return;
    if (e && e.code === "MISSING") { toReadOnly(); return; }
    $("esList").innerHTML = '<div class="pj-empty">' + esc(errorText(e)) + "</div>";
  }
}

/** A change arrived (live): read again, once per burst. */
export function reload() {
  if (!host) return;
  clearTimeout(timer);
  timer = setTimeout(load, 300);
}

/** Whether a changed price row belongs to an item this tab shows. */
export function hasItem(id) {
  return !!state.model && state.model.estimates.some(function (e) { return e.items.some(function (it) { return String(it.id) === String(id); }); });
}

function visible() {
  return state.model.estimates.filter(function (e) { return state.showArchived || !e.archived; });
}
function findEst(id) { return state.model ? state.model.estimates.find(function (e) { return String(e.id) === String(id); }) || null : null; }
function findItem(model, id) {
  for (const e of (model || state.model || { estimates: [] }).estimates) {
    const it = e.items.find(function (x) { return String(x.id) === String(id); });
    if (it) return { est: e, item: it };
  }
  return null;
}

function draw() {
  if (!host || !state.model) return;
  const m = state.model;
  const list = visible();
  if (state.filter !== "*" && !list.some(function (e) { return String(e.id) === String(state.filter); })) state.filter = "*";
  const shown = state.filter === "*" ? list : list.filter(function (e) { return String(e.id) === String(state.filter); });
  const show = moneyShown(m.prices, list);
  const w = wordsFor(show);
  const nEst = list.filter(function (e) { return !isChangeOrder(e); }).length;
  const nCo = list.length - nEst;
  const nArch = m.estimates.filter(function (e) { return e.archived; }).length;
  $("esBar").innerHTML =
    (list.length > 1 ? '<select id="esFilter" aria-label="Which estimate"><option value="*">All estimates (' + list.length + ")</option>" +
      list.map(function (e) {
        return '<option value="' + esc(e.id) + '"' + (String(state.filter) === String(e.id) ? " selected" : "") + ">" + esc(w(e.displayName)) + "</option>";
      }).join("") + "</select>" : "") +
    '<button class="pj-btn pj-btn-sm pj-btn-primary" id="esNewEst" type="button">＋ Estimate</button>' +
    '<button class="pj-btn pj-btn-sm" id="esNewCo" type="button">＋ Change order</button>' +
    '<a class="pj-btn pj-btn-sm" id="esPrint" href="report-estimate.html?id=' + encodeURIComponent(cx.pid) +
      (state.filter !== "*" ? "&amp;est=" + encodeURIComponent(state.filter) : "") + '">🖨 Print' + (state.filter === "*" && list.length > 1 ? " all" : "") + "</a>" +
    '<button class="pj-btn pj-btn-sm" id="esReload" type="button" title="Read again">↻</button>' +
    (nArch ? '<label class="pj-check"><input type="checkbox" id="esArchived"' + (state.showArchived ? " checked" : "") + "> Show archived (" + nArch + ")</label>" : "") +
    '<span class="es-count">' + nEst + " estimate" + (nEst === 1 ? "" : "s") + " · " + nCo + " change order" + (nCo === 1 ? "" : "s") +
      (m.prices ? "" : " · quantities only, prices hidden") + "</span>";
  $("esStrip").innerHTML = state.filter === "*" ? contractStripHtml(list, show) : "";
  $("esList").innerHTML = shown.length ? estimateCardsHtml(shown, { show, pid: cx.pid, edit: true })
    : '<div class="pj-empty">No estimates yet — start one with ＋ Estimate.</div>';
}

/* ── events ────────────────────────────────────────────────────────── */
function onClick(e) {
  const t = e.target && e.target.closest ? e.target.closest("[data-act], #esReload, #esNewEst, #esNewCo") : null;
  if (!t || !host || !host.contains(t)) return;
  if (t.id === "esReload") { load(); return; }
  if (t.id === "esNewEst") { newEstimate("estimate"); return; }
  if (t.id === "esNewCo") { newEstimate("change_order"); return; }
  const act = t.getAttribute("data-act");
  if (t.closest("#esSheet")) { e.preventDefault(); sheetAct(act); return; }
  if (state.busy) return;
  const est = t.getAttribute("data-est");
  if (act === "est") openEstimate(est);
  else if (act === "grp") openGroup(est, t.getAttribute("data-grp"));
  else if (act === "item") openItem(t.getAttribute("data-item"));
  else if (act === "add") openNewItem(est, t.getAttribute("data-grp"), false);
  else if (act === "addgrp") openNewItem(est, null, true);
}

// a sheet's form never submits (it would load the page again): Enter in a one-line box is that box's button
function onSubmit(e) { e.preventDefault(); }
const ENTER_ACT = { ef_group_name: "rename", ef_group_code: "code", efToGroupName: "toGroup" };

function onKey(e) {
  if (e.key === "Escape" && state.sheet) { e.preventDefault(); closeSheet(false); return; }
  const t = e.target;
  if (e.key === "Enter" && state.sheet && t && t.tagName === "INPUT" && t.closest && t.closest("#esSheet")) {
    e.preventDefault();
    const act = ENTER_ACT[t.id] || (state.sheet.kind === "grp" ? null : "save");
    if (act) sheetAct(act);
    return;
  }
  if ((e.key === "Enter" || e.key === " ") && t && t.getAttribute && t.getAttribute("data-act") === "item" && !t.closest("#esSheet")) {
    e.preventDefault();
    openItem(t.getAttribute("data-item"));
  }
}

function onChange(e) {
  const t = e.target;
  if (!t) return;
  if (t.id === "esFilter") { state.filter = t.value; draw(); return; }
  if (t.id === "esArchived") { state.showArchived = !!t.checked; draw(); return; }
  if (t.id === "ef_item_type") { switchType(t); return; }
  if (t.id === "efToGroup") { const n = $("efToGroupName"); if (n) n.hidden = t.value !== "*new"; return; }
  if (t.id === "ef_status") markTouched("status");
}

function onInput(e) {
  const t = e.target;
  if (!t || !state.sheet || !t.closest || !t.closest("#esSheet")) return;
  const key = t.getAttribute("data-key");
  if (key) markTouched(key);
  if (state.sheet.kind === "item") drawLive();
}

function onUnload(e) {
  if (state.sheet && state.sheet.dirty) { e.preventDefault(); e.returnValue = ""; }
}

function markTouched(key) {
  const s = state.sheet;
  if (!s) return;
  s.touched.add(key);
  if (!s.dirty) { s.dirty = true; if (cx.setEditing) cx.setEditing(true); }
}

/* ── the sheet ─────────────────────────────────────────────────────── */
function mountSheet(title, body, opts) {
  const box = $("esSheet");
  box.innerHTML = sheetHtml(title, body, opts);
  box.hidden = false;
  document.body.classList.add("es-sheet-open");
  const first = box.querySelector(".es-sheet-bd input:not([disabled]), .es-sheet-bd textarea:not([disabled]), .es-sheet-bd select:not([disabled])");
  setTimeout(function () { try { (first || box.querySelector(".es-x")).focus(); } catch (e) { /* */ } }, 20);
}

async function closeSheet(force) {
  const s = state.sheet;
  if (!s) return;
  if (!force && s.dirty && cx.confirm) {
    const ok = await cx.confirm("Leave without saving? What you changed in this sheet is not kept.", { title: "Unsaved changes", okText: "Leave", danger: true });
    if (!ok || state.sheet !== s) return;
  }
  state.sheet = null;
  const box = $("esSheet");
  if (box) { box.hidden = true; box.innerHTML = ""; }
  document.body.classList.remove("es-sheet-open");
  if (cx && cx.setEditing) cx.setEditing(false);
}

function showErr(text) {
  const n = $("esSheetErr");
  if (n) n.textContent = text || "";
  else if (text) toast(text, "error");
}
function notice(text) {
  const n = $("esSheetNotice");
  if (!n) return;
  n.hidden = !text;
  n.textContent = text || "";
}
function setBusy(on) {
  state.busy = on;
  if (host) { host.classList.toggle("es-busy", !!on); host.setAttribute("aria-busy", on ? "true" : "false"); }
  const box = $("esSheet");
  if (box) box.querySelectorAll(".es-sheet-ft button, .es-moves button, .es-clash button").forEach(function (b) {
    if (on) { b.dataset.wasDisabled = b.disabled ? "1" : ""; b.disabled = true; }
    else if (b.dataset.wasDisabled !== undefined) { b.disabled = b.dataset.wasDisabled === "1"; delete b.dataset.wasDisabled; }
  });
}

function sheetAct(act) {
  const s = state.sheet;
  if (act === "close") { closeSheet(false); return; }
  if (!s || state.busy) return;
  if (act === "keepTheirs") { closeSheet(true); load(); return; }
  if (act === "useMine") { useMine(); return; }
  if (s.kind === "item") {
    if (act === "save") saveItemSheet();
    else if (act === "up" || act === "down") stepItem(act === "up" ? -1 : 1);
    else if (act === "toGroup") moveToGroup();
    else if (act === "toEst") moveToEstimate();
    else if (act === "deleteItem") deleteItemSheet();
    else if (act === "clearContact") {
      s.clearContact = true;
      const c = $("efContact");
      if (c) c.hidden = true;
      markTouched("assigned_contact_id");
    }
  } else if (s.kind === "est") {
    if (act === "save") saveEstimateSheet();
    else if (act === "archive") archiveEstimate();
    else if (act === "duplicate") duplicateEstimate();
    else if (act === "delete") deleteEstimateSheet();
  } else if (s.kind === "grp") {
    if (act === "rename") renameGroup();
    else if (act === "code") codeGroup();
    else if (act === "gup" || act === "gdown") stepGroup(act === "gup" ? -1 : 1);
    else if (act === "addHere") { const gid = s.gid, est = s.estId; closeSheet(true).then(function () { openNewItem(est, gid, false); }); }
  }
}

/** Every box of the open sheet that may be sent: {column: value} (a locked box and a read-only one are left out). */
function formValues(formId) {
  const out = {};
  const f = $(formId);
  if (!f) return out;
  f.querySelectorAll("[data-key]").forEach(function (n) {
    if (n.disabled || (n.dataset && n.dataset.masked === "1")) return;
    out[n.getAttribute("data-key")] = n.value;
  });
  return out;
}

/** After a write: read again; a sheet left open shows the row as it is now. */
async function afterWrite(message, keepOpen) {
  if (message) toast(message, "ok");
  if (!keepOpen) await closeSheet(true);
  await load();
}

/** A write refused: the sentence, and what it means for this tab. */
function refused(e, where) {
  if (isConflict(e) || isGone(e)) {
    toast("Changed by someone else — showing the latest.", "info");
    closeSheet(true).then(load);
    return;
  }
  if (where === "sheet") showErr(errorText(e)); else toast(errorText(e), "error");
  if (String(e && e.code) === "42501") recheckAccess();
}

async function recheckAccess() {
  try {
    const access = await estimateAccess(cx.me);
    if (!estimateEditor(cx.me, access)) toReadOnly("Your Estimator switch is off: the tab shows the estimates read only.");
  } catch (x) { /* the next read decides */ }
}

/* ── new estimate / change order ───────────────────────────────────── */
async function newEstimate(kind) {
  if (state.busy || !state.model) return;
  const co = kind === "change_order";
  const withPrices = prices();
  const modal = D().modal;
  if (typeof modal !== "function") return;
  const v = await modal({
    title: co ? "New change order" : "New estimate", okText: "Create",
    message: co ? "The database gives it the next change-order number." : "The database gives it the next estimate number.",
    fields: [{ name: "name", label: "Name", placeholder: co ? "e.g. Extra window on the north wall" : "e.g. Main house framing" },
      { name: "description", label: "Description (optional)", type: "textarea", rows: 3 }],
    validate: function (x) {
      if (withPrices) return null;
      return M.wordsProblem(x.name) || M.wordsProblem(x.description) || null;
    },
  });
  if (!v || !host) return;
  setBusy(true);
  try {
    const row = await repo.createEstimate(cx.pid, kind, { name: v.name, description: cleanName(v.description) ? v.description : null });
    state.filter = String(row.id);
    await afterWrite((co ? "Change order #" + row.co_number : "Estimate #" + row.number) + " created.", true);
  } catch (e) { refused(e, "toast"); }
  finally { setBusy(false); }
}

/* ── the estimate sheet ────────────────────────────────────────────── */
function openEstimate(id) {
  const est = findEst(id);
  if (!est) return;
  state.sheet = { kind: "est", estId: est.id, base: clone(est), dirty: false, touched: new Set() };
  mountSheet(est.label + (cleanName(est.name) ? " — " + est.name : ""), estimateFormHtml(est, { prices: prices() }), { save: "Save" });
}

async function saveEstimateSheet() {
  const s = state.sheet;
  const form = formValues("esEstForm");
  const why = M.validateEstimate(s.base, form, { prices: prices() });
  if (why) { showErr(why); return; }
  const d = M.diffEstimate(s.base, form, { prices: prices() });
  if (!Object.keys(d).length) { closeSheet(true); return; }
  await sendEstimate(s.base, d, 1);
}

async function sendEstimate(base, changes, attempt) {
  setBusy(true);
  try {
    await repo.updateEstimate(base, changes, { prices: prices() });
    await afterWrite("Saved.");
  } catch (e) {
    if (isConflict(e) && attempt <= 3) { await estimateConflict(base, changes, attempt); return; }
    refused(e, "sheet");
  } finally { setBusy(false); }
}

async function estimateConflict(base, changes, attempt) {
  await load();
  const cur = findEst(base.id);
  if (!cur) { notice("This estimate was deleted."); return; }
  const mine = Object.assign({}, changes);
  if (!prices()) Object.keys(mine).forEach(function (k) { if (M.isLocked(cur, k)) delete mine[k]; });
  const plan = M.conflictPlan(base, cur, mine);
  if (plan.kind === "done") { await afterWrite("Saved — it was already so."); return; }
  if (plan.kind === "resend") { await sendEstimate(cur, plan.mine, attempt + 1); return; }
  if (!state.sheet) return;
  state.sheet.pending = { kind: "est", cur, mine: plan.mine, attempt };
  showClash(plan.clash, cur, plan.mine, cur.updated_by);
}

async function archiveEstimate() {
  const s = state.sheet;
  if (s.dirty) { showErr("Save or cancel your changes first."); return; }
  setBusy(true);
  try {
    await repo.setArchived(s.base, !s.base.archived);
    await afterWrite(s.base.archived ? s.base.label + " taken out of the archive." : s.base.label + " archived.");
  } catch (e) { refused(e, "sheet"); } finally { setBusy(false); }
}

async function duplicateEstimate() {
  const s = state.sheet;
  if (s.dirty) { showErr("Save or cancel your changes first."); return; }
  setBusy(true);
  try {
    const copy = await repo.duplicateEstimate(s.base);
    state.filter = String(copy.id);
    await afterWrite("Copied: " + (copy.name || "the copy") + ".");
  } catch (e) { refused(e, "sheet"); } finally { setBusy(false); }
}

async function deleteEstimateSheet() {
  const s = state.sheet;
  const ok = await cx.confirm("Delete " + s.base.label + (cleanName(s.base.name) ? " (" + s.base.name + ")" : "") +
    "? Its items go with it. An admin can bring it back in DCR Desktop 2.", { title: "Delete", okText: "Delete", danger: true });
  if (!ok || state.sheet !== s) return;
  setBusy(true);
  try {
    await repo.deleteEstimate(s.base);
    await afterWrite(s.base.label + " deleted.");
  } catch (e) { refused(e, "sheet"); } finally { setBusy(false); }
}

/* ── the group sheet ───────────────────────────────────────────────── */
function openGroup(estId, gid) {
  const est = findEst(estId);
  const g = est && est.groups.find(function (x) { return x.gid === gid; });
  if (!g) return;
  state.sheet = { kind: "grp", estId: est.id, gid, key: M.groupKey(g.name), base: clone(g), dirty: false, touched: new Set() };
  mountSheet("Group: " + g.title, groupFormHtml(g, { prices: prices(), est }), { save: false, cancel: "Close" });
}

async function arrange(est, groupOrder, moves, message, keepOpen) {
  const why = M.wordsRefusal(est, groupOrder, moves, { prices: prices() }) || (groupOrder ? M.groupOrderProblem(groupOrder) : null);
  if (why) { showErr(why); return false; }
  setBusy(true);
  try {
    await repo.reorder(est, groupOrder, moves, { prices: prices() });
    await afterWrite(message, keepOpen);
    return true;
  } catch (e) { refused(e, "sheet"); return false; } finally { setBusy(false); }
}

async function renameGroup() {
  const s = state.sheet, est = findEst(s.estId);
  const input = $("ef_group_name");
  const name = input ? input.value : "";
  const why = M.groupNameProblem(name, prices());
  if (why) { showErr(why); return; }
  if (!cleanName(name)) { showErr("Type the group's new name."); return; }
  const plan = M.planRename(M.slotsOf(est), est.group_order, s.gid, name);
  if (!plan) { closeSheet(true); return; }
  await arrange(est, plan.groupOrder, plan.moves, "Group renamed to " + cleanName(name) + ".");
}

async function codeGroup() {
  const s = state.sheet, est = findEst(s.estId);
  const input = $("ef_group_code");
  const code = input ? input.value : "";
  const why = M.groupNameProblem(code, prices());
  if (why) { showErr(why); return; }
  const slot = M.slotsOf(est).find(function (x) { return x.gid === s.gid; });
  const moves = M.planCode(slot, code);
  if (!moves.length) { closeSheet(true); return; }
  await arrange(est, null, moves, cleanName(code) ? "Group code set." : "Group code taken off.");
}

async function stepGroup(dir) {
  const s = state.sheet, est = findEst(s.estId);
  const order = M.planGroupStep(M.slotsOf(est), s.gid, dir);
  if (!order) { showErr(dir < 0 ? "It is the first group already." : "It is the last group already."); return; }
  if (await arrange(est, order, [], "", true)) {
    // gids are per read: the same group, found again by its name
    const now = findEst(s.estId);
    const g = now && now.groups.find(function (x) { return M.groupKey(x.name) === s.key; });
    if (g && state.sheet === s) { s.gid = g.gid; openGroup(now.id, g.gid); }
    else closeSheet(true);
  }
}

/* ── the item sheet ────────────────────────────────────────────────── */
function openItem(itemId) {
  const hit = findItem(null, itemId);
  if (!hit) return;
  const { est, item } = hit;
  state.sheet = { kind: "item", estId: est.id, itemId: item.id, base: clone(item), type: item.item_type || "both", dirty: false, touched: new Set() };
  mountItemSheet();
}

function mountItemSheet() {
  const s = state.sheet;
  const est = findEst(s.estId);
  const it = s.base;
  const title = s.isNew ? (s.newGroup ? "New item in a new group" : "New item") : (cleanName(it.name) || "Item");
  mountSheet(title, itemFormHtml(it, { prices: prices(), est, estimates: state.model.estimates, isNew: !!s.isNew, gid: s.gid, newGroup: !!s.newGroup, type: s.type }), {
    save: s.isNew ? "Add item" : "Save",
    danger: s.isNew ? null : { act: "deleteItem", text: "Delete", disabled: !!(est && est.approvedLock), title: est && est.approvedLock ? M.APPROVED_HINT : null },
  });
}

function openNewItem(estId, gid, newGroup) {
  const est = findEst(estId);
  if (!est || !est.addable) return;
  const type = M.itemType(store.get(M.LAST_TYPE_KEY, M.DEFAULT_ITEM_TYPE)) || M.DEFAULT_ITEM_TYPE;
  const base = { item_type: type, name: "", labor_qty: 1, material_qty: 1, locked: [] };
  if (prices()) base.prices = { labor_markup_pct: 0, material_markup_pct: 0 };
  state.sheet = { kind: "item", estId: est.id, isNew: true, gid: gid || null, newGroup: !!newGroup, base, type, dirty: false, touched: new Set() };
  mountItemSheet();
}

/** The live line: the crew and (prices) the money as the boxes are now. */
function drawLive() {
  const s = state.sheet;
  const n = $("esLive");
  if (!s || !n) return;
  const v = Object.assign(M.flatItem(s.base), formValues("esItemForm"));
  qtyNumbers(v);
  const p = prices() ? M.PRICE_KEYS.reduce(function (o, k) { o[k] = v[k]; return o; }, {}) : null;
  if (p) { const parse = function (x) { const r = M.parseNum(x); return r.ok ? r.value : null; }; Object.keys(p).forEach(function (k) { p[k] = parse(p[k]); }); }
  n.innerHTML = liveLineHtml(v, p);
}
function qtyNumbers(v) {
  M.QTY_KEYS.forEach(function (k) { if (typeof v[k] === "string") { const r = M.parseNum(v[k]); v[k] = r.ok ? r.value : null; } });
}

/** A type switch: what the new type hides is cleared (asked first, est_logic switch_question); without prices the
    database clears the hidden prices, and a hidden word that quotes an amount cannot be cleared at all. */
async function switchType(sel) {
  const s = state.sheet;
  if (!s) return;
  const next = M.itemType(sel.value) || "both";
  const prev = s.type;
  if (next === prev) return;
  const values = Object.assign(M.flatItem(s.base), formValues("esItemForm"));
  const withPrices = prices();
  const lost = M.valuesLost(next, values);
  if (!withPrices && lost.some(function (k) { return M.isLocked(s.base, k); })) {
    sel.value = prev;
    showErr(M.LOCKED_HINT + " This item keeps its type.");
    return;
  }
  // the item may have prices nobody here can see (DCR Desktop 2 asks too); a new item has none
  const unseen = !withPrices && !s.isNew ? M.unseenPricesCleared(next, prev) : [];
  if (lost.length || unseen.length) {
    const q = M.switchQuestion(next, lost, values, unseen);
    const ok = await cx.confirm(q.text, { title: q.title, okText: "Switch" });
    if (!ok || state.sheet !== s) { sel.value = prev; return; }
  }
  s.type = next;
  markTouched("item_type");
  const shown = M.shownKeys(next);
  const form = $("esItemForm");
  M.hiddenKeys(next).forEach(function (k) {
    if (k === "labor_rate") return;              // the project's: never cleared
    const n = form.querySelector('[data-key="' + k + '"]');
    if (n && !n.disabled && M.holdsValue(k, values[k])) { n.value = M.clearedValue(k) === null ? "" : String(M.clearedValue(k)); s.touched.add(k); }
  });
  form.querySelectorAll(".es-f[data-f]").forEach(function (w) {
    const k = w.getAttribute("data-f");
    if (M.TYPED_KEYS.indexOf(k) !== -1) w.hidden = !shown.has(k);
  });
  form.querySelector('[data-part="labor"]').hidden = !(shown.has("description") || shown.has("labor_qty"));
  form.querySelector('[data-part="material"]').hidden = !shown.has("material_qty");
  $("efLaborLegend").textContent = next === "sub" ? "Sub-contractor" : "Labor";
  $("efDescLabel").textContent = next === "sub" ? "Scope of work" : "Labor description";
  form.setAttribute("data-type", next);
  drawLive();
}

/** The sheet's boxes as the item's columns (the hidden boxes of the type left out of a new item). */
function itemForm() {
  const s = state.sheet;
  const form = formValues("esItemForm");
  form.item_type = s.type;
  if (s.clearContact) form.assigned_contact_id = null;
  return form;
}

async function saveItemSheet() {
  const s = state.sheet;
  const withPrices = prices();
  const form = itemForm();
  const why = M.validateItem(s.base, form, { prices: withPrices });
  if (why) { showErr(why); return; }
  if (s.isNew) { await addNewItem(form); return; }
  const d = M.diffItem(s.base, form, { prices: withPrices });
  if (!Object.keys(d.fields).length && !Object.keys(d.prices).length) { closeSheet(true); return; }
  await sendItem(s.base, d, 1);
}

async function sendItem(base, d, attempt) {
  setBusy(true);
  try {
    await repo.saveItem(base, d.fields, d.prices, { prices: prices() });
    if (d.fields.item_type) store.set(M.LAST_TYPE_KEY, d.fields.item_type);
    await afterWrite("Saved.");
  } catch (e) {
    if (isConflict(e) && attempt <= 3) { await itemConflict(base, d, attempt); return; }
    if (isGone(e)) { notice("This item was deleted — nothing was saved."); disableSave(); return; }
    showErr(errorText(e));
    if (String(e && e.code) === "42501") recheckAccess();
  } finally { setBusy(false); }
}

function disableSave() { const b = $("esSave"); if (b) b.disabled = true; }

function splitChanges(flat) {
  const fields = {}, money = {};
  Object.keys(flat).forEach(function (k) { if (M.PRICE_KEYS.indexOf(k) !== -1) money[k] = flat[k]; else fields[k] = flat[k]; });
  return { fields, prices: money };
}

async function itemConflict(base, d, attempt) {
  const s = state.sheet;
  await load();
  const hit = findItem(null, base.id);
  if (!hit) { notice("This item was deleted — nothing was saved."); disableSave(); return; }
  const cur = hit.item;
  const mine = Object.assign({}, d.fields, d.prices);
  const dropped = [];
  if (!prices()) Object.keys(mine).forEach(function (k) { if (M.isLocked(cur, k)) { delete mine[k]; dropped.push(M.FIELD_LABELS[k] || k); } });
  const plan = M.conflictPlan(M.flatItem(base), M.flatItem(cur), mine);
  if (dropped.length) notice(dropped.join(", ") + " now quote" + (dropped.length === 1 ? "s" : "") + " an amount: kept as it is.");
  if (plan.kind === "done") { await afterWrite("Saved — it was already so."); return; }
  if (plan.kind === "resend") { await sendItem(cur, splitChanges(plan.mine), attempt + 1); return; }
  if (state.sheet !== s) return;
  s.pending = { kind: "item", cur, mine: plan.mine, attempt };
  showClash(plan.clash, M.flatItem(cur), plan.mine, cur.updated_by);
}

function showClash(keys, theirs, mine, by) {
  const lines = keys.map(function (k) {
    return { label: M.FIELD_LABELS[k] || k, theirs: M.shownValue(k, theirs[k]), mine: M.shownValue(k, mine[k]) };
  });
  const bd = document.querySelector("#esSheet .es-sheet-bd");
  if (!bd) return;
  const old = $("esClash");
  if (old) old.remove();
  bd.insertAdjacentHTML("afterbegin", conflictHtml(lines, firstName(by)));
}

async function useMine() {
  const s = state.sheet;
  const p = s && s.pending;
  if (!p) return;
  s.pending = null;
  const clash = $("esClash");
  if (clash) clash.remove();
  if (p.kind === "item") await sendItem(p.cur, splitChanges(p.mine), p.attempt + 1);
  else await sendEstimate(p.cur, p.mine, p.attempt + 1);
}

async function addNewItem(form) {
  const s = state.sheet;
  const est = findEst(s.estId);
  const withPrices = prices();
  const shown = M.shownKeys(s.type);
  const fields = { item_type: s.type };
  M.ROW_KEYS.forEach(function (k) {
    if (k === "item_type" || k === "assigned_contact_id" || !(k in form)) return;
    if (M.TYPED_KEYS.indexOf(k) !== -1 && !shown.has(k)) return;
    if (k === "notes" && !withPrices) return;
    if (M.QTY_KEYS.indexOf(k) !== -1) {
      const v = M.parseNum(form[k]).value;
      if (v !== null && v !== undefined) fields[k] = v;
      return;
    }
    const v = String(form[k] == null ? "" : form[k]);
    if (k === "name" || v.trim()) fields[k] = v;
  });
  if (s.newGroup) {
    const name = form.group_name || "", code = form.group_code || "";
    const why = M.groupNameProblem(name, withPrices) || M.groupNameProblem(code, withPrices);
    if (why) { showErr(why); return; }
    if (cleanName(name)) fields.group_name = cleanName(name);
    if (String(code).trim()) fields.group_code = String(code).trim();
  } else {
    const g = est.groups.find(function (x) { return x.gid === s.gid; });
    if (g && g.name) fields.group_name = g.name;
    if (g && g.code) fields.group_code = g.code;
  }
  const money = {};
  if (withPrices) {
    M.PRICE_KEYS.forEach(function (k) {
      if (!(k in form) || (M.TYPED_KEYS.indexOf(k) !== -1 && !shown.has(k))) return;
      const v = M.parseNum(form[k]).value;
      if (v !== null && v !== undefined) money[k] = v;
    });
  }
  setBusy(true);
  try {
    await repo.addItem(est.id, fields, money, { prices: withPrices });
    store.set(M.LAST_TYPE_KEY, s.type);
    await afterWrite("Item added.");
  } catch (e) {
    if (isGone(e)) { refused(e, "sheet"); return; }
    showErr(errorText(e));
    if (String(e && e.code) === "42501") recheckAccess();
  } finally { setBusy(false); }
}

/** Up / Down, Move to group: one reorder_estimate, then the sheet shows the item as it is now. */
async function rearrangeItem(moves, message) {
  const s = state.sheet;
  if (s.dirty) { showErr("Save or cancel your changes first."); return; }
  const est = findEst(s.estId);
  if (!moves.length) return;
  if (await arrange(est, null, moves, message, true)) {
    const hit = findItem(null, s.itemId);
    if (hit && state.sheet === s) { s.base = clone(hit.item); s.estId = hit.est.id; s.type = hit.item.item_type; mountItemSheet(); }
    else closeSheet(true);
  }
}

function stepItem(dir) {
  const s = state.sheet;
  const est = findEst(s.estId);
  const moves = M.planItemStep(M.slotsOf(est), s.itemId, dir);
  if (!moves.length) { showErr(dir < 0 ? "It is at the top already." : "It is at the bottom already."); return; }
  rearrangeItem(moves, "");
}

function moveToGroup() {
  const s = state.sheet;
  const est = findEst(s.estId);
  const sel = $("efToGroup");
  if (!sel || !sel.value) { showErr("Pick the group first."); return; }
  let target;
  if (sel.value === "*new") {
    const name = ($("efToGroupName") || {}).value || "";
    const why = M.groupNameProblem(name, prices());
    if (why) { showErr(why); return; }
    if (!cleanName(name)) { showErr("Type the new group's name."); return; }
    target = { name };
  } else target = { gid: sel.value };
  const moves = M.planItemDrop(M.slotsOf(est), s.itemId, target, null);
  if (!moves.length) { showErr("It is in that group already."); return; }
  rearrangeItem(moves, "Moved.");
}

async function moveToEstimate() {
  const s = state.sheet;
  if (s.dirty) { showErr("Save or cancel your changes first."); return; }
  const sel = $("efToEst");
  const target = sel && sel.value ? findEst(sel.value) : null;
  if (!target) { showErr("Pick the estimate first."); return; }
  const est = findEst(s.estId);
  const it = est.items.find(function (x) { return String(x.id) === String(s.itemId); });
  if (!prices() && (est.approvedLock || target.approvedLock)) { showErr(M.APPROVED_HINT); return; }
  setBusy(true);
  try {
    await repo.moveItems(M.planMoveToEstimate(it, target), { prices: prices() });
    await afterWrite("Moved to " + target.label + ".");
  } catch (e) { refused(e, "sheet"); } finally { setBusy(false); }
}

async function deleteItemSheet() {
  const s = state.sheet;
  const ok = await cx.confirm("Delete this item" + (cleanName(s.base.name) ? " (" + s.base.name + ")" : "") + "?", { title: "Delete the item", okText: "Delete", danger: true });
  if (!ok || state.sheet !== s) return;
  setBusy(true);
  try {
    await repo.deleteItem(s.base);
    await afterWrite("Item deleted.");
  } catch (e) { refused(e, "sheet"); } finally { setBusy(false); }
}

/* ── live: an open sheet meets someone else's save ─────────────────── */
function adoptLive() {
  const s = state.sheet;
  if (!s || s.isNew || s.pending) return;
  if (s.kind === "grp") {
    // gids are per read: the same group again by its name (gone or renamed elsewhere: nothing here acts on it)
    const est = findEst(s.estId);
    const g = est && est.groups.find(function (x) { return M.groupKey(x.name) === s.key; });
    if (g) { s.gid = g.gid; return; }
    notice("This group was renamed or emptied by someone else — close it and open it again.");
    const box = $("esSheet");
    if (box) box.querySelectorAll(".es-sheet-bd button").forEach(function (b) { b.disabled = true; });
    return;
  }
  if (s.kind === "item") {
    const hit = findItem(null, s.itemId);
    if (!hit) { notice("This item was deleted."); disableSave(); return; }
    const cur = hit.item;
    s.estId = hit.est.id;
    const priceMoved = prices() && cur.prices && s.base.prices && cur.prices.version !== s.base.prices.version;
    if (cur.version === s.base.version && !priceMoved) return;
    if (!s.dirty) { s.base = clone(cur); s.estId = hit.est.id; s.type = cur.item_type; mountItemSheet(); notice(firstName(cur.updated_by) + " saved this item: shown as it is now."); return; }
    adoptInto(s, M.flatItem(cur), cur);
    notice(firstName(cur.updated_by) + " saved this item — your Save checks for clashes.");
  } else if (s.kind === "est") {
    const cur = findEst(s.estId);
    if (!cur) { notice("This estimate was deleted."); disableSave(); return; }
    if (cur.version === s.base.version) return;
    if (!s.dirty) { openEstimate(cur.id); notice(firstName(cur.updated_by) + " saved this estimate: shown as it is now."); return; }
    adoptInto(s, cur, cur);
    notice(firstName(cur.updated_by) + " saved this estimate — your Save checks for clashes.");
  }
}

/** The untouched boxes take their values (through the lock again); the sheet's base keeps its versions, so Save meets
    the conflict rule for what was typed. */
function adoptInto(s, flat, row) {
  const box = $("esSheet");
  if (!box) return;
  box.querySelectorAll("[data-key]").forEach(function (n) {
    const k = n.getAttribute("data-key");
    if (s.touched.has(k)) return;
    const v = flat[k];
    if (n.tagName === "SELECT") n.value = v == null ? n.value : String(v);
    else if (M.QTY_KEYS.indexOf(k) !== -1 || M.MONEY_FIELDS.indexOf(k) !== -1 || M.PCT_FIELDS.indexOf(k) !== -1) n.value = M.numText(k, v);
    else n.value = v == null ? "" : String(v);
    const locked = !prices() && M.isLocked(row, k);
    if (locked) { n.disabled = true; n.dataset.masked = "1"; n.title = M.LOCKED_TITLE; }
    if (M.PRICE_KEYS.indexOf(k) !== -1) { if (s.base.prices) s.base.prices[k] = v; }
    else s.base[k] = v;
  });
  if (row.locked) s.base.locked = row.locked.slice();
  if (s.kind === "item") drawLive();
}
