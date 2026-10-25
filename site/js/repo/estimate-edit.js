/* The web estimate and change-order editor's data (owner 2026-10-24: Q12 reversed — an Estimator edits on the web too;
   migration 20261028000100_estimator.sql, DCR Desktop 2 docs/DATABASE.md §27). Loaded only for an Estimator, by the
   lazily imported pages/project-estimate-edit.js: a crew phone never downloads it (site/sw.js keeps the read-only tab).

   Every gate is the database's: app.can_edit('estimates') (an admin, or a manager with the Estimator switch), the
   prices switch for prices, and for a person without prices the approval gate, the approved lock and the words guard
   (D5, D6) - this module only never sends what they refuse anyway.

   Read
   * loadEditor(projectId, {flags})  rpc estimate_edit_read -> map/estimate-edit.js fromEditRead (+ the item flags):
                                     every live estimate and change order (archived ones flagged), groups by the
                                     database's opaque gid, items, versions; prices, totals, notes and terms with the
                                     prices switch only - without it NO money key, note or term reaches the browser and
                                     the words come amount-free with each row's "locked" columns (D7). Never
                                     estimate_print (its words are scrubbed for everyone without prices and its prices
                                     carry no version). A database without the RPC: err.code "MISSING" (the tab stays
                                     read only).
   Writes (each on the versions it was shown: PT409 {table, id, version} when someone was faster - conflictInfo)
   * createEstimate(projectId, kind, {name, description})   a plain insert as DCR Desktop 2 makes one (the database
                                     numbers it, an estimate or a change order); -> the new row's ids and numbers;
   * updateEstimate(est, patch, {prices})   a versioned PATCH of name, description, status (and the terms with prices);
   * setArchived(est, on)            archived_at (the database stamps the moment); deleteEstimate(est): rpc soft_delete
                                     (its items go with it); duplicateEstimate(est): rpc duplicate_estimate (prices);
   * addItem(estimateId, fields, prices, {prices})   rpc add_estimate_item (the price row gets the project's rate;
                                     prices only with the switch);
   * saveItem(item, fields, prices, {prices})   rpc save_estimate_item: the row and its price row in ONE transaction,
                                     both versions checked; never prices without the switch;
   * deleteItem(item)                rpc soft_delete; reorder(est, groupOrder, moves): rpc reorder_estimate (the
                                     estimate's version with a group order); moveItems(moves): rpc move_estimate_items.
   The answers are stripped of anything a person without prices must not hold (noMoney) - the database already sends
   none since migration 20261028000100; the editor reads again after every write. */

import { db, must, idOf, versioned } from "./_db.js";
import { insertOne } from "./_rows.js";
import { itemFlags } from "./estimates.js";
import { flagsByItem } from "../map/estimates.js";
import { fromEditRead } from "../map/estimate-edit.js";

// an estimate row as the editor's writes return it: no words, no money (the words come from estimate_edit_read)
export const EST_WRITE_COLS = "id, project_id, number, kind, co_number, status, sent_date, approved_date, archived_at, deleted_at, version, updated_at, updated_by";
const MONEY_KEYS = ["prices", "totals", "notes", "client_notes", "labor_total", "material_total", "total", "labor_per_area", "material_per_area"];

/** Whatever an answer carries that a person without prices must not hold, taken out (every level). */
export function noMoney(v) {
  if (Array.isArray(v)) return v.map(noMoney);
  if (!v || typeof v !== "object") return v;
  const out = {};
  Object.keys(v).forEach(function (k) { if (MONEY_KEYS.indexOf(k) === -1) out[k] = noMoney(v[k]); });
  return out;
}

/** The {table, id, version} a refusal names (PT409 / PT404 details), or null. */
export function conflictInfo(err) {
  if (!err || !err.details) return null;
  try {
    const d = typeof err.details === "string" ? JSON.parse(err.details) : err.details;
    return d && typeof d === "object" && d.table ? { table: String(d.table), id: d.id, version: d.version === undefined ? null : d.version } : null;
  } catch (e) { return null; }
}

function missing(err) {
  const code = String((err && err.code) || "");
  return code === "PGRST202" || code === "42883" || (code === "PGRST200" && /estimate_edit_read/.test(String(err.message || "")));
}

async function call(name, args) {
  const c = await db();
  return must(await c.rpc(name, args));
}

/** rpc estimate_edit_read as the database answers it. */
export async function readEditor(projectId) {
  const c = await db();
  const res = await c.rpc("estimate_edit_read", { p_project_id: idOf(projectId) });
  if (res && res.error && missing(res.error)) {
    throw Object.assign(new Error("The estimate editor needs a newer database (migration 20261028000100)."), { code: "MISSING" });
  }
  return must(res);
}

/** The editor's model: map/estimate-edit.js fromEditRead with the items' flags (estimate_item_flags). */
export async function loadEditor(projectId, opts) {
  const o = opts || {};
  const answer = await readEditor(projectId);
  const ids = [];
  ((answer && answer.estimates) || []).forEach(function (e) { (e.items || []).forEach(function (it) { ids.push(it.id); }); });
  const flags = o.flags === false ? {} : flagsByItem(await itemFlags(ids));
  return fromEditRead(answer, flags);
}

/* ── estimates ───────────────────────────────────────────────────────── */
export async function createEstimate(projectId, kind, fields) {
  const f = fields || {};
  return insertOne("estimates", {
    project_id: idOf(projectId), kind: kind === "change_order" ? "change_order" : "estimate",
    name: String(f.name == null ? "" : f.name).trim(), description: f.description ? String(f.description) : null,
  }, EST_WRITE_COLS);
}

export async function updateEstimate(est, patch, opts) {
  const p = {};
  ["name", "description", "status"].concat(opts && opts.prices ? ["client_notes"] : []).forEach(function (k) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, k)) p[k] = patch[k];
  });
  return versioned("estimates", idOf(est.id), est.version, p, EST_WRITE_COLS);
}

export async function setArchived(est, on) {
  return versioned("estimates", idOf(est.id), est.version, { archived_at: on ? new Date().toISOString() : null }, EST_WRITE_COLS);
}

export async function deleteEstimate(est) {
  await call("soft_delete", { tbl: "estimates", id: idOf(est.id), version: est.version });
  return true;
}

export async function duplicateEstimate(est) {
  return call("duplicate_estimate", { estimate_id: idOf(est.id), new_name: null });
}

/* ── items ───────────────────────────────────────────────────────────── */
export async function addItem(estimateId, fields, prices, opts) {
  const withPrices = !!(opts && opts.prices) && prices && Object.keys(prices).length ? prices : null;
  const r = await call("add_estimate_item", { estimate_id: idOf(estimateId), fields: fields || {}, prices: withPrices });
  return opts && opts.prices ? r : noMoney(r);
}

export async function saveItem(item, fields, prices, opts) {
  const p = !!(opts && opts.prices);
  const f = fields && Object.keys(fields).length ? fields : null;
  const money = p && prices && Object.keys(prices).length ? prices : null;
  const args = { p_item_id: idOf(item.id), p_item_version: item.version, p_fields: f, p_prices: money,
    p_price_version: money ? (item.prices ? item.prices.version : null) : null };
  const r = await call("save_estimate_item", args);
  return p ? r : noMoney(r);
}

export async function deleteItem(item) {
  await call("soft_delete", { tbl: "estimate_items", id: idOf(item.id), version: item.version });
  return true;
}

export async function reorder(est, groupOrder, moves, opts) {
  const r = await call("reorder_estimate", { estimate_id: idOf(est.id), estimate_version: groupOrder ? est.version : null,
    group_order: groupOrder || null, moves: moves || [] });
  return opts && opts.prices ? r : noMoney(r);
}

export async function moveItems(moves, opts) {
  const r = await call("move_estimate_items", { moves });
  return opts && opts.prices ? r : noMoney(r);
}
