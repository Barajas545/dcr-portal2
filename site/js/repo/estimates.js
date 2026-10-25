/* Estimates, change orders and takeoffs as everyone reads them (BLUEPRINT 3.3.11, Appendix A "project money and
   estimate parts"). Owner answer Q12 (view and print only) is REVERSED 2026-10-24: an Estimator edits estimates and
   change orders on the web — the editor's reads and writes are repo/estimate-edit.js (rpc estimate_edit_read and the
   write RPCs of migration 20261028000100), loaded only for an Estimator; this module keeps the read-only tab's and the
   printed pages' reads, and says who gets the editor:
   * estimateAccess(me) -> {can_estimate, missing}: the person's Estimator switch as the database has it
     (profiles.can_estimate; an admin always; missing: the column is not there yet - the tab stays read only).

   Price gating is in the DATA, not only on screen (2.1 principle 8, P5 acceptance check 1). Everything an
   estimate or a takeoff says comes through migration M5a's read functions, which run as the caller (row
   level security applies) and decide per caller:
   * rpc estimate_print(p_estimate_id) — one estimate or change order with its groups and items in DCR
     Desktop 2's order, the item / group / estimate money, the terms, the internal item notes and a change
     order's contract figures ONLY for a caller with the prices switch; for anybody else those keys are
     absent and amounts typed into the words are scrubbed ("[amount]") by the database;
   * rpc takeoff_print(p_takeoff_id | p_project_id) — the takeoffs with their rows; unit prices, line
     totals, subtotals and the sales tax rate only with prices, the words scrubbed otherwise.
   The list of a project's estimates is read from the estimates table with columns that carry no words and
   no money (which ones exist, their kind, number, status, archived): the words come from estimate_print.

   * listEstimates(projectId, {archived}) -> {estimates (map/estimates.js fromEstimatePrint, in list order),
     archived (how many are archived), prices (what the database decided)}; deleted ones are never read,
     archived ones only with {archived: true};
   * listTakeoffs(projectId) -> map/takeoffs.js fromTakeoffPrint(...) ({prices, project, taxRate, takeoffs});
   * item flags (estimate_item_flags, M5a: whoever reads the item reads its flags) come with the items. */

import { db, must, pageAll, idOf } from "./_db.js";
import { fromEstimatePrint, flagsByItem, estimateOrder } from "../map/estimates.js";
import { fromTakeoffPrint } from "../map/takeoffs.js";

// which estimates exist: no words, no money
export const LIST_COLS = "id, project_id, number, kind, co_number, status, archived_at, deleted_at, version";
const IDS_PER_READ = 150;

function isMissingColumn(error) {
  const code = String((error && error.code) || "");
  return code === "42703" || code === "PGRST204" || /can_estimate/.test(String((error && error.message) || ""));
}

/** The Estimator switch (migration 20261028000100), read fresh: only a manager's can be on or off; an admin always
    edits, nobody else ever does (the CHECK profiles_estimate_needs_manager). */
export async function estimateAccess(me) {
  if (!me || !me.id || me.active === false || me.role === "agents") return { can_estimate: false, missing: false };
  if (me.role === "admin") return { can_estimate: true, missing: false };
  if (me.role !== "manager") return { can_estimate: false, missing: false };
  const c = await db();
  const res = await c.from("profiles").select("role, can_estimate").eq("id", me.id);
  if (res && res.error) {
    if (isMissingColumn(res.error)) return { can_estimate: false, missing: true };
    must(res);
  }
  const row = Array.isArray(res && res.data) ? res.data[0] : (res && res.data);
  return { can_estimate: !!(row && row.role === "manager" && row.can_estimate === true), missing: false };
}

/** The flags of these estimate items (estimate_item_flags). */
export async function itemFlags(itemIds) {
  const ids = Array.from(new Set((itemIds || []).map(idOf)));
  if (!ids.length) return [];
  const c = await db();
  const out = [];
  for (let i = 0; i < ids.length; i += IDS_PER_READ) {
    // M5a ships the table with estimate_print: a missing one is an error to show, never "no flags"
    const res = await c.from("estimate_item_flags").select("*").in("item_id", ids.slice(i, i + IDS_PER_READ));
    (must(res) || []).forEach(function (r) { out.push(r); });
  }
  return out;
}

/** rpc estimate_print -> its answer; an estimate deleted (or no longer readable) meanwhile -> null. */
export async function printEstimate(estimateId) {
  const c = await db();
  const res = await c.rpc("estimate_print", { p_estimate_id: idOf(estimateId) });
  if (res && res.error && String(res.error.code) === "PT404") return null;
  return must(res);
}

export async function listEstimates(projectId, opts) {
  const o = opts || {};
  const pid = idOf(projectId);
  const rows = await pageAll(function (c) {
    return c.from("estimates").select(LIST_COLS).eq("project_id", pid).is("deleted_at", null).order("id", { ascending: true });
  });
  const live = (rows || []).filter(function (e) { return !e.deleted_at; });
  const shown = live.filter(function (e) { return o.archived || !e.archived_at; }).sort(estimateOrder);
  const answers = (await Promise.all(shown.map(function (e) { return printEstimate(e.id); }))).filter(Boolean);
  const itemIds = [];
  answers.forEach(function (a) { (a.groups || []).forEach(function (g) { (g.items || []).forEach(function (it) { itemIds.push(it.id); }); }); });
  const flags = o.flags === false ? [] : flagsByItem(await itemFlags(itemIds));
  return {
    estimates: answers.map(function (a) { return fromEstimatePrint(a, flags); }),
    archived: live.filter(function (e) { return !!e.archived_at; }).length,
    prices: answers.length ? answers.every(function (a) { return !!a.prices; }) : null,
  };
}

/** Every takeoff of the project with its rows (rpc takeoff_print). */
export async function listTakeoffs(projectId) {
  const c = await db();
  return fromTakeoffPrint(must(await c.rpc("takeoff_print", { p_takeoff_id: null, p_project_id: idOf(projectId) })));
}
