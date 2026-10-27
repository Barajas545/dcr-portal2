/* Takeoffs and the Material List on Portal 2 (BLUEPRINT 3.3.11 "Takeoffs and material list"; Q12: view and
   print only — the takeoff grid stays in DCR Desktop 2; Q20: the old .takeoff plan files stay on the old
   portal).

   Ports of DCR Desktop 2's dcrdesk/printing/figures.py (takeoff_levels, unit_price, row_total, quote_totals)
   and printing/takeoffs.py (the Material List and the Material Quote), so the paper a crew or a lumber
   yard reads is the same from the office or a phone:
   * rows -> groups -> categories -> sub-categories (owner 2026-10-27: a line's group is its level, "Group" on
     every screen; migration 20261029000200_takeoff_groups): the groups in the takeoff's group_order (the
     estimates' rule - names tidied, any case; "" = the lines without a group), the groups it does not list
     after them in the order their first row comes (rows by sort, then id); categories and sub-categories
     (older lines only: they left DCR Desktop 2's grid) in the order their first row comes; blank names are
     their own group ("(no group)", no band for a blank category or sub-category unless something under it is
     named); a listed group with no line is not printed;
   * the Material Quote (people with prices only): line total = qty × unit price in cents, a subtotal
     per level, then Subtotal, Sales tax at settings.tax_rate percent and GRAND TOTAL. A row without its
     price (no prices switch, or the price row missing) never prints as $0.00: the sheet is the Material
     List then.
   The Material List itself never shows money, and amounts typed into its words are masked: it goes to
   the yard and the crew.

   Pure module: no DOM, no network. */

import { toCents, mulCents, pctOfCents, parseDec, lowerPg, cleanName } from "./estimates.js";

function sortNum(v) {
  const d = parseDec(v);
  return d ? Number(d.n) / Math.pow(10, d.s) : Infinity;
}

/** Rows by sort (blank last), then id. */
export function rowOrder(a, b) {
  const x = sortNum(a && a.sort), y = sortNum(b && b.sort);
  if (x !== y) return x < y ? -1 : 1;
  return Number((a && a.id) || 0) - Number((b && b.id) || 0);
}

function trimmed(v) { return String(v == null ? "" : v).trim(); }
function bucket(name) { return { name, rows: [], children: [] }; }
function child(b, name) {
  const k = lowerPg(name);
  let c = b.children.find(function (x) { return lowerPg(x.name) === k; });
  if (!c) { c = bucket(name); b.children.push(c); }
  return c;
}

/** Every row of a bucket, in order (its own, then its children's). */
export function allRows(b) {
  let out = b.rows.slice();
  b.children.forEach(function (c) { out = out.concat(allRows(c)); });
  return out;
}

/** A group's key: its name tidied (runs of white space as one space), lower case - app.group_key. */
export function groupKey(name) { return lowerPg(cleanName(name)); }

/** Rows -> [{name (group: the level), children: [{name (category), children: [{name (sub), rows}]}]}], the groups in
    the takeoff's group order (groupOrder: takeoffs.group_order; listed names first in that order, then the others by
    their first row). A listed group is named as the order spells it (tidy; the first spelling of a name listed
    twice), another by its first row - figures.takeoff_levels, so a band reads the same as DCR Desktop 2's. */
export function takeoffLevels(rows, groupOrder) {
  const root = bucket("");
  // keys are group names: no inherited key ("constructor") may answer for one
  const byKey = Object.create(null), listed = Object.create(null), spelled = Object.create(null);
  (Array.isArray(groupOrder) ? groupOrder : []).forEach(function (n, i) {
    const k = groupKey(n);
    if (!(k in listed)) { listed[k] = i; spelled[k] = cleanName(n); }
  });
  (rows || []).filter(function (r) { return r && typeof r === "object"; }).slice().sort(rowOrder).forEach(function (r) {
    const k = groupKey(r.level);
    let level = byKey[k];
    if (!level) { level = byKey[k] = bucket(spelled[k] || cleanName(r.level)); root.children.push(level); }
    const cat = child(level, trimmed(r.category));
    const sub = child(cat, trimmed(r.subcategory));
    sub.rows.push(r);
  });
  const at = function (b) { const k = groupKey(b.name); return k in listed ? listed[k] : Infinity; };
  return root.children.map(function (b, i) { return { b, i, at: at(b) }; })
    .sort(function (x, y) { return x.at !== y.at ? (x.at < y.at ? -1 : 1) : x.i - y.i; })
    .map(function (x) { return x.b; });
}

/** The row's unit price in cents, or null (no prices, or none set). */
export function unitPrice(row) {
  const p = row && row.prices;
  if (!p || typeof p !== "object" || p.unit_price === null || p.unit_price === undefined) return null;
  return toCents(p.unit_price);
}

/** qty × unit price in cents (blank qty or price: 0): the database's line_total when it sent one. */
export function rowTotal(row) {
  const p = row && row.prices;
  if (!p || typeof p !== "object" || p.unit_price === null || p.unit_price === undefined) return 0;
  if (p.line_total !== null && p.line_total !== undefined) return toCents(p.line_total) || 0;
  return mulCents(row.qty, p.unit_price);
}

/** Every row carries its price row (an empty list counts as priced). */
export function rowsPriced(rows) {
  return (rows || []).every(function (r) { return r && r.prices && typeof r.prices === "object"; });
}

/** {subtotal, ratePct, tax, total} in cents; a negative rate counts as 0. */
export function quoteTotals(rows, ratePct) {
  const subtotal = (rows || []).reduce(function (s, r) { return s + rowTotal(r); }, 0);
  const d = parseDec(ratePct);
  const rate = d && d.n > 0n ? ratePct : 0;
  const tax = pctOfCents(subtotal, rate);
  return { subtotal, ratePct: rate, tax, total: subtotal + tax };
}

/** The words of a row: the item name as typed, else the catalog material's code. */
export function rowItemName(row) {
  const own = String((row && row.item_name) || "").trim();
  if (own) return row.item_name;
  return (row && row.material_code) || "";
}

/** The unit as typed. */
export function rowUnit(row) {
  return String((row && row.unit) || "");
}

/**
 * The answer of rpc takeoff_print (M5a: {prices, project, takeoffs [{takeoff {..., group_order}, item {id,
 * estimate_id, name, estimate_label} | null, rows [...] [, subtotal]}] [, totals {subtotal, tax_rate, tax,
 * total}]}) -> {prices, project, taxRate, takeoffs: [{...takeoff, item, rows (in print order, each with prices
 * {unit_price, line_total} only when the database sent them), lines, levels (by its group order), priced}] newest
 * first (date, then id)}. Without the prices switch the database sent no price key and scrubbed the typed words
 * (the group order's names too). A database before migration 20261029000200 sends no group_order: the groups come
 * in the order their first row does.
 */
export function fromTakeoffPrint(answer) {
  const a = answer || {};
  const list = (Array.isArray(a.takeoffs) ? a.takeoffs : []).filter(function (x) { return x && x.takeoff; }).map(function (x) {
    const rows = (Array.isArray(x.rows) ? x.rows : []).map(function (r) {
      const out = Object.assign({}, r);
      delete out.unit_price; delete out.line_total;
      if ("unit_price" in r) out.prices = { unit_price: r.unit_price, line_total: r.line_total };
      return out;
    }).sort(rowOrder);
    return Object.assign({}, x.takeoff, { item: x.item || null, rows, lines: rows.length, levels: takeoffLevels(rows, x.takeoff.group_order),
      priced: rowsPriced(rows) });
  });
  list.sort(function (p, q) {
    const x = String(p.takeoff_date || ""), y = String(q.takeoff_date || "");
    if (x !== y) return x < y ? 1 : -1;
    return Number(q.id || 0) - Number(p.id || 0);
  });
  const t = a.totals && typeof a.totals === "object" ? a.totals : null;
  return { prices: !!a.prices, project: a.project || null, taxRate: t ? t.tax_rate : null, takeoffs: list };
}

/** A group band's words: "(no group)" for the lines without a group (a blank level). */
export function levelName(name) { return name ? name : "(no group)"; }

/** Whether a category band is drawn: it is named, or one of its sub-categories is. */
export function categoryBand(cat) {
  return !!cat.name || cat.children.some(function (s) { return !!s.name; });
}
