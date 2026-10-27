/* The web estimate and change-order editor's rules (owner 2026-10-24: Q12 reversed — an Estimator edits estimates and
   change orders on the web too; decisions D1, D4-D7; migration 20261028000100_estimator.sql, DCR Desktop 2
   docs/DATABASE.md §27). The rules of DCR Desktop 2's editor (ui/pages/project/est_logic.py, est_save.py,
   estimates.py; domain/estimate_order.py, domain/estimate_math.py), pure, for the lazily loaded editor
   (pages/project-estimate-edit.js): a crew phone never downloads this module (site/sw.js keeps only the read-only tab).

   * fromEditRead(answer, flagsOf)   rpc estimate_edit_read -> the model the cards (pages/est-render.js) and the sheets
                                     (pages/est-sheet.js) draw. The database decides per caller: with prices the words
                                     as typed, the item notes, the terms, each price row (with its version) and the
                                     money; without, NO money key, note or term at all, the words amount-free and each
                                     row's "locked" columns (their stored text quotes an amount: the database refuses
                                     changing them). Groups are the database's, by its opaque gid (g1, g2 ... per read),
                                     empty ones too (owner 2026-10-27, migration 20261029000100: a name the group
                                     order lists with no item - "empty", no total);
   * the item types                  ITEM_TYPES, shownKeys / hiddenKeys / holdsValue / clearedValue / valuesLost /
                                     unseenPricesCleared / switchQuestion (est_logic.py): a type switch clears what the
                                     new type hides (asked first); without prices the database clears the hidden prices
                                     (t25), and a hidden word that quotes an amount cannot be cleared (Rule A);
   * diffItem / validateItem / wordsProblem   what a sheet sends — only what changed, never a locked box, a note or a
                                     price without prices — and what it refuses before anything is sent (the columns'
                                     sizes, markups above -100 %, a rate of 0 or more; without prices words that quote
                                     an amount, Rule C, or hold the hidden copy, Rule B);
   * statusesFor / approvedLock      Approved only with prices; an approved one keeps its status, dates, archive, type
                                     and quantities without prices (D5);
   * the planners                    planItemStep / planItemDrop / planGroupStep / planRename / planNewGroup /
                                     planDeleteGroup / planMoveToEstimate over the database's groups (slotsOf, by
                                     gid; an empty group - a name the group order lists with no item, owner
                                     2026-10-27 - is one of them), -> the reorder_estimate / move_estimate_items
                                     moves; wordsRefusal (estimates.py _words_refusal): a rearrangement the database
                                     refuses a person without prices. The group code is no longer shown or set here
                                     (owner 2026-10-27): the column stays, and the database still gives an item moved
                                     into a group that group's code;
   * itemMath                        one item's money in integer cents (estimate_math.py, BigInt; the database's view
                                     rounds the same way: tests/vectors/estimate-math.json);
   * conflictPlan                    a save refused as stale (PT409) -> done / resend / clash (est_save.py).
   No DOM, no network. */

import {
  parseDec, toCents, moneyText, qtyText, pctText, cleanName, lowerPg, statusWord, statusText, estimateLabel, estimateTitle,
  estimateName, priced, sumOf,
} from "./estimates.js";
import { scrubMoney } from "../scrub-money.js";
import { maskAmounts } from "../money-mask.js";
import { LOCKED_TITLE } from "./masked-form.js";

export { LOCKED_TITLE };
export const LOCKED_HINT = "Words that quote an amount are changed by someone who sees prices.";
export const APPROVED_HINT = "Approved: someone who sees prices changes its type and quantities.";
export const LAST_TYPE_KEY = "dcr2EstLastType";      // shell.js store: the type this person last saved (est_logic LAST_TYPE_SETTING)
export const GROUP_NAME_MAX = 200;
export const GROUP_ORDER_MAX = 500;

/* ── the item types (est_logic.py, owner request 2026-10-12) ─────────── */
export const ITEM_TYPES = Object.freeze(["both", "labor", "material", "sub"]);
export const ITEM_TYPE_LABELS = Object.freeze({ both: "Labor & Material", labor: "Labor", material: "Material", sub: "Sub-contractor" });
export const DEFAULT_ITEM_TYPE = "labor";
export const LABOR_KEYS = Object.freeze(["description", "labor_area", "labor_rate", "labor_guys", "labor_days", "labor_qty", "labor_unit_price",
  "labor_markup_pct"]);
export const MATERIAL_KEYS = Object.freeze(["material_description", "material_area", "material_qty", "material_unit_price", "material_markup_pct"]);
// a sub-contractor's line: its scope and area, qty × unit price × (1 + markup) — the labor columns, no hours
export const SUB_KEYS = Object.freeze(["description", "labor_area", "labor_qty", "labor_unit_price", "labor_markup_pct"]);
export const TYPED_KEYS = Object.freeze(LABOR_KEYS.concat(MATERIAL_KEYS));
// what save_estimate_item takes (p_fields; never estimate_id, group_name, group_code or sort - moves are their own RPCs)
export const ROW_KEYS = Object.freeze(["name", "item_type", "description", "labor_area", "labor_guys", "labor_days", "labor_qty",
  "material_description", "material_qty", "material_area", "assigned_contact_id", "assigned_text", "notes"]);
// the prices a sheet writes (p_prices; quoted_price is DCR Desktop 2's, never edited here)
export const PRICE_KEYS = Object.freeze(["labor_rate", "labor_unit_price", "labor_markup_pct", "material_unit_price", "material_markup_pct"]);
export const QTY_KEYS = Object.freeze(["labor_area", "labor_guys", "labor_days", "labor_qty", "material_qty", "material_area"]);   // numeric(12,3)
export const MONEY_FIELDS = Object.freeze(["labor_rate", "labor_unit_price", "material_unit_price", "quoted_price"]);            // numeric(12,2)
export const PCT_FIELDS = Object.freeze(["labor_markup_pct", "material_markup_pct"]);                                          // numeric(6,2)
export const WORD_KEYS = Object.freeze(["name", "description", "material_description", "assigned_text"]);
const TEXT_KEYS = ["description", "material_description"];
const COUNTED_PRICE_KEYS = ["labor_unit_price", "labor_markup_pct", "material_unit_price", "material_markup_pct"];

export const FIELD_LABELS = Object.freeze({
  estimate_id: "Estimate", group_name: "Group", group_code: "Group code", sort: "Order", name: "Item name",
  description: "Labor description", labor_area: "Labor area", labor_guys: "Guys", labor_days: "Days", labor_qty: "Labor qty",
  material_description: "Material description", material_qty: "Material qty", material_area: "Material area",
  assigned_contact_id: "Assigned contact", assigned_text: "Assigned to", notes: "Notes", labor_rate: "Rate / hour",
  labor_unit_price: "Labor unit price", labor_markup_pct: "Labor markup", material_unit_price: "Material unit price",
  material_markup_pct: "Material markup", quoted_price: "Quoted price", client_notes: "Terms & notes", status: "Status",
  item_type: "Type",
});

export function itemType(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return ITEM_TYPES.indexOf(s) !== -1 ? s : null;
}
export function typeLabel(v) { const t = itemType(v); return t ? ITEM_TYPE_LABELS[t] : "—"; }

const SHOWN = { both: TYPED_KEYS, labor: LABOR_KEYS, material: MATERIAL_KEYS, sub: SUB_KEYS };
/** The labor / material fields an item of this type shows (a type not known shows them all). */
export function shownKeys(kind) { return new Set(SHOWN[itemType(kind) || "both"]); }
export function hiddenKeys(kind) { const s = shownKeys(kind); return new Set(TYPED_KEYS.filter(function (k) { return !s.has(k); })); }

function num(v) { const d = parseDec(v); return d ? Number(d.n) / Math.pow(10, d.s) : 0; }

/** Whether a field holds something a type switch would clear: words that are not blank, a number that is not 0 — but
    a Qty of 1 is the default and the hourly rate is the project's (neither counts). */
export function holdsValue(key, value) {
  if (TEXT_KEYS.indexOf(key) !== -1) return value != null && String(value).trim() !== "";
  if (key === "labor_rate") return false;
  const n = num(value);
  if (key === "labor_qty" || key === "material_qty") return n !== 0 && n !== 1;
  return Math.abs(n) > 1e-9;
}
/** What a cleared field holds: no words, Qty 1, else 0. */
export function clearedValue(key) {
  if (TEXT_KEYS.indexOf(key) !== -1) return null;
  return key === "labor_qty" || key === "material_qty" ? 1 : 0;
}
/** The fields (screen order) a switch to `kind` hides that hold something. */
export function valuesLost(kind, values) {
  const hide = hiddenKeys(kind), v = values || {};
  return TYPED_KEYS.filter(function (k) { return hide.has(k) && Object.prototype.hasOwnProperty.call(v, k) && holdsValue(k, v[k]); });
}
/** The prices a switch from `current` to `kind` clears — for a person without prices the database clears them (t25),
    so the question says so. */
export function unseenPricesCleared(kind, current) {
  const was = hiddenKeys(current), now = hiddenKeys(kind);
  return COUNTED_PRICE_KEYS.filter(function (k) { return now.has(k) && !was.has(k); });
}

/** One field for a sentence: Material description “Studs”, Material qty 400, Labor unit price $4.25, Labor markup 15%. */
export function describeValue(key, value) {
  const label = FIELD_LABELS[key] || key;
  if (TEXT_KEYS.indexOf(key) !== -1) {
    const words = maskAmounts(String(value == null ? "" : value).replace(/\s+/g, " ").trim());
    return label + " “" + (words.length > 40 ? words.slice(0, 40) + "…" : words) + "”";
  }
  if (PCT_FIELDS.indexOf(key) !== -1) return label + " " + pctText(value);
  if (MONEY_FIELDS.indexOf(key) !== -1) return label + " " + moneyText(toCents(value) || 0);
  return label + " " + (qtyText(value, false) || "0");
}
function joined(parts) { return parts.length === 1 ? parts[0] : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]; }

/** The question before a switch to `kind` that clears `keys` (and, without prices, the `unseen` prices): {title, text}. */
export function switchQuestion(kind, keys, values, unseen) {
  const t = itemType(kind) || "both";
  const k = (keys || []).slice(), u = (unseen || []).slice();
  const every = k.concat(u);
  const material = every.some(function (x) { return MATERIAL_KEYS.indexOf(x) !== -1; });
  const labor = every.some(function (x) { return LABOR_KEYS.indexOf(x) !== -1; });
  let what = { labor: "the material", material: "the labor", sub: "the hours and the material" }[t] || "";
  if (t === "sub" && !material) what = "the hours";
  else if (t === "sub" && !labor) what = "the material";
  const head = { labor: "Labor only", material: "Material only", sub: "Sub-contractor" }[t] || ITEM_TYPE_LABELS[t];
  const side = [["labor", u.some(function (x) { return LABOR_KEYS.indexOf(x) !== -1; })], ["material", u.some(function (x) { return MATERIAL_KEYS.indexOf(x) !== -1; })]]
    .filter(function (s) { return s[1]; }).map(function (s) { return s[0]; }).join(" and ");
  const hidden = u.length ? "any " + side + " prices on it (your account can't see prices)" : "";
  const text = k.length
    ? "Switching to " + head + " clears " + what + " on this item: " + joined(k.map(function (x) { return describeValue(x, (values || {})[x]); })) +
      (hidden ? " — and " + hidden + "." : ".")
    : "Switching to " + head + " clears " + what + " on this item, including " + hidden + ".";
  return { title: "Switch to " + ITEM_TYPE_LABELS[t] + "?", text };
}

/* ── the money words (migration 20261028000100 §5: the database's own rules, before anything is sent) ── */
const MASK = /\[amount\]|amount hidden/i;
/** app.quotes_amount: app.scrub_money changes it (scrub-money.js is the same rule: tests/vectors/scrub-money.json). */
export function quotesAmount(t) { return t !== null && t !== undefined && scrubMoney(String(t)) !== String(t); }
/** app.holds_amount_mask: "[amount]" or "amount hidden", any case. */
export function holdsMask(t) { return MASK.test(String(t == null ? "" : t)); }
/** Why the database refuses these words from a person without prices (Rule B, then C), or null. */
export function wordsProblem(t) {
  if (holdsMask(t)) return "That is the hidden copy of an amount, not the words — someone who sees prices writes them.";
  if (quotesAmount(t)) return "Amounts go in the price boxes — someone who sees prices adds them.";
  return null;
}

/* ── names and groups (estimate_order.py; the database's app.tidy_name / app.group_key) ── */
export function groupKey(name) { return lowerPg(cleanName(name)); }
export function cleanGroupOrder(names) {
  const out = [], seen = new Set();
  (names || []).forEach(function (n) { const c = cleanName(n), k = lowerPg(c); if (!seen.has(k)) { seen.add(k); out.push(c); } });
  return out;
}
/** Why the database refuses this group order (22023), or null. */
export function groupOrderProblem(names) {
  const c = cleanGroupOrder(names);
  if (c.length > GROUP_ORDER_MAX) return "An estimate can keep the order of at most " + GROUP_ORDER_MAX + " groups.";
  if (c.some(function (n) { return n.length > GROUP_NAME_MAX; })) return "A group name has at most " + GROUP_NAME_MAX + " characters.";
  return null;
}
/** A group name typed into a sheet: the size, and (without prices) the money words. */
export function groupNameProblem(name, prices) {
  if (cleanName(name).length > GROUP_NAME_MAX) return "A group name has at most " + GROUP_NAME_MAX + " characters.";
  return prices ? null : wordsProblem(name);
}
// app.natural_key: digit runs as numbers ("9" < "10"), letters lower case, an empty value last (compared as C text)
function naturalKey(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "1";
  return "0" + (s.match(/[0-9]+|[^0-9]+/g) || []).map(function (m) {
    return /^[0-9]+$/.test(m) ? "0" + (m.replace(/^0+/, "") || "0").padStart(40, "0") : "1" + lowerPg(m);
  }).join("\u0001");
}
function sortCmp(a, b) {
  const x = parseDec(a.sort), y = parseDec(b.sort);
  if (!x || !y) { if (x || y) return x ? -1 : 1; }
  else { const c = decCmp(x, y); if (c) return c; }
  return Number(a.id) - Number(b.id);
}
/** groups_in_order: items grouped by name (tidy, any case), listed groups first in the group order, then by code
    naturally, then by name ("" last); a group's name is its first item's, its code its first coded item's.
    opts.includeEmpty (estimate_order.py include_empty): a listed name with no item (not "") is an empty group in its
    listed place, spelled as listed - as the database's estimate_edit_read sends it. */
export function groupsInOrder(items, groupOrder, opts) {
  const listed = {};
  const names = cleanGroupOrder(groupOrder);
  names.forEach(function (n, i) { listed[groupKey(n)] = i; });
  const slots = {}, list = [];
  (items || []).slice().sort(sortCmp).forEach(function (it) {
    const k = groupKey(it.group_name);
    let s = slots[k];
    if (!s) { s = slots[k] = { key: k, name: cleanName(it.group_name), code: "", items: [], listed: k in listed ? listed[k] : null }; list.push(s); }
    s.items.push(it);
    if (!s.code) s.code = String(it.group_code == null ? "" : it.group_code).trim();
  });
  if (opts && opts.includeEmpty) {
    names.forEach(function (n, i) {
      const k = groupKey(n);
      if (k && !slots[k]) { slots[k] = { key: k, name: n, code: "", items: [], listed: i }; list.push(slots[k]); }
    });
  }
  return list.sort(function (a, b) {
    if ((a.listed === null) !== (b.listed === null)) return a.listed === null ? 1 : -1;
    if (a.listed !== null) return a.listed - b.listed;
    const x = naturalKey(a.code), y = naturalKey(b.code);
    if (x !== y) return x < y ? -1 : 1;
    if (!a.name !== !b.name) return a.name ? -1 : 1;
    const p = lowerPg(a.name), q = lowerPg(b.name);
    return p < q ? -1 : p > q ? 1 : 0;
  });
}

/* ── exact numbers ───────────────────────────────────────────────────── */
function pow10(k) { let p = 1n; for (let i = 0; i < k; i++) p *= 10n; return p; }
function decCmp(x, y) {
  const s = Math.max(x.s, y.s);
  const a = x.n * pow10(s - x.s), b = y.n * pow10(s - y.s);
  return a < b ? -1 : a > b ? 1 : 0;
}
/** Two numbers the same (blank and blank are; blank and 0 are not). */
export function sameNumber(a, b) {
  const x = parseDec(a === "" ? null : a), y = parseDec(b === "" ? null : b);
  if (!x || !y) return !x && !y;
  return decCmp(x, y) === 0;
}
function sameText(a, b) { return String(a == null ? "" : a) === String(b == null ? "" : b); }
// words as a box hands them back: a text area's value breaks its lines with "\n" whatever the stored words used, so
// "\r\n" and "\n" are the same words (an item name or a description opened and saved as it was is never sent)
function sameWords(a, b) {
  const lf = function (v) { return String(v == null ? "" : v).replace(/\r\n?/g, "\n"); };
  return lf(a) === lf(b);
}
/** Two values of one column the same (numbers as numbers, words as words). */
export function sameValue(key, a, b) {
  if (QTY_KEYS.indexOf(key) !== -1 || MONEY_FIELDS.indexOf(key) !== -1 || PCT_FIELDS.indexOf(key) !== -1 ||
      key === "assigned_contact_id" || key === "sort" || key === "estimate_id") return sameNumber(a, b);
  return sameText(a, b);
}

/** A number box: "" -> {ok, value: null}; "1,200.5", "$12.50", "15%" -> the number; anything else not ok. places: the
    decimals typed. */
export function parseNum(text) {
  if (text === null || text === undefined) return { ok: true, value: null, places: 0 };
  if (typeof text === "number") return Number.isFinite(text) ? { ok: true, value: text, places: (String(text).split(".")[1] || "").length } : { ok: false };
  const t = String(text).trim().replace(/^\$\s*/, "").replace(/\s*%$/, "").replace(/,/g, "");
  if (!t) return { ok: true, value: null, places: 0 };
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return { ok: false };
  return { ok: true, value: Number(t), places: (t.split(".")[1] || "").length };
}
/** What a number box shows: a quantity up to 3 decimals, money with 2 when it has cents, a markup as typed. */
export function numText(key, v) {
  if (v === null || v === undefined || v === "") return "";
  const d = parseDec(v);
  if (!d) return "";
  if (MONEY_FIELDS.indexOf(key) !== -1) {
    const c = toCents(v);
    const abs = Math.abs(c);
    return (c < 0 ? "-" : "") + Math.floor(abs / 100) + (abs % 100 ? "." + String(abs % 100).padStart(2, "0") : "");
  }
  return (qtyText(v, false) || "0").replace(/,/g, "");
}

/* ── the model the cards and the sheets draw ─────────────────────────── */
function itemMoney(it) {
  const t = it && it.totals;
  if (!t || typeof t !== "object" || t.total === null || t.total === undefined) return null;
  return { labor: toCents(t.labor) || 0, material: toCents(t.material) || 0, total: toCents(t.total) || 0 };
}

/**
 * rpc estimate_edit_read's answer -> {projectId, prices, canEdit, estimates}: each estimate as fromEstimatePrint shapes
 * it (label, title, displayName, status, statusText, archived, groups [{gid, key, name, title, label, code, locked,
 * addable, items, total, empty}], items in order, priced, total) plus locked (its locked words), groupOrderLocked,
 * approvedLock (approved and no prices) and addable; each item with money (cents, prices only), flags, locked (its
 * locked columns: none with prices). flagsOf: {itemId: [estimate_item_flags rows]}.
 */
export function fromEditRead(answer, flagsOf) {
  const a = answer || {};
  const prices = a.prices === true;
  const fl = flagsOf || {};
  return {
    projectId: a.project_id, prices, canEdit: a.can_edit === true,
    estimates: (Array.isArray(a.estimates) ? a.estimates : []).map(function (e) { return estimateModel(e, prices, fl); }),
  };
}

function estimateModel(e, prices, fl) {
  const items = (Array.isArray(e.items) ? e.items : []).map(function (it) {
    return Object.assign({}, it, { money: prices ? itemMoney(it) : null, flags: fl[String(it.id)] || [],
      locked: prices ? [] : (Array.isArray(it.locked) ? it.locked.slice() : []) });
  });
  const status = statusWord(e.status);
  const approved = !prices && status === "approved";
  const groups = (Array.isArray(e.groups) ? e.groups : []).map(function (g) {
    const gi = items.filter(function (it) { return it.gid === g.gid; });
    const name = cleanName(g.name);
    const locked = !prices && !!g.locked;
    return { gid: g.gid, key: g.gid, name, title: g.title || name || "General", label: name || "(no group)", code: String(g.code == null ? "" : g.code).trim(),
      locked, addable: !approved && !locked, items: gi, total: prices && gi.length ? sumOf(gi) : null, empty: !gi.length };
  });
  const ordered = [];
  groups.forEach(function (g) { g.items.forEach(function (it) { ordered.push(it); }); });
  return Object.assign({}, e, {
    label: e.label || estimateLabel(e), title: estimateTitle(e), displayName: estimateName(e),
    status, statusText: statusText(status), archived: !!e.archived,
    groups, items: ordered, priced: prices ? priced(ordered) : false, total: prices ? sumOf(ordered) : null,
    locked: prices ? [] : (Array.isArray(e.locked) ? e.locked.slice() : []),
    groupOrderLocked: !prices && !!e.group_order_locked,
    approvedLock: approved, addable: !approved,
  });
}

export function isLocked(row, key) { return !!row && Array.isArray(row.locked) && row.locked.indexOf(key) !== -1; }
/** Any group of this estimate whose name or code quotes an amount (without prices). */
export function anyGroupLocked(est) { return !!est && (est.groupOrderLocked || (est.groups || []).some(function (g) { return g.locked; })); }

/** The statuses a person may give `e`: with prices all four; without, never Approved, and none for an approved one. */
export function statusesFor(e, prices) {
  if (prices) return ["draft", "sent", "approved", "declined"];
  if (e && statusWord(e.status) === "approved") return [];
  return ["draft", "sent", "declined"];
}
/** Without prices an approved estimate keeps its status, dates, archive, deletion, items' type and quantities (D5). */
export function approvedLock(e, prices) { return !prices && !!e && statusWord(e.status) === "approved"; }

/** One item's values in one flat object (its row columns and its price columns, the price row's version apart). */
export function flatItem(it) {
  const out = Object.assign({}, it || {});
  delete out.prices;
  const p = it && it.prices && typeof it.prices === "object" ? it.prices : null;
  if (p) { PRICE_KEYS.concat(["quoted_price"]).forEach(function (k) { out[k] = p[k]; }); out.price_version = p.version; }
  return out;
}

/* ── what a sheet sends ──────────────────────────────────────────────── */
function textOrNull(v) { const s = String(v == null ? "" : v); return s.trim() === "" ? null : s; }

/**
 * The changes of an item sheet: base = the item as the sheet opened (the model's), form = {column: what its box holds}
 * (only the boxes the sheet has). -> {fields (save_estimate_item p_fields), prices (p_prices: with prices only)}, each
 * holding only what differs. Without prices a locked box, the notes and every price are never included. A markup left
 * blank is 0 (the column is not null); a name left blank is "".
 */
export function diffItem(base, form, opts) {
  const prices = !!(opts && opts.prices);
  const b = base || {}, f = form || {};
  const has = function (k) { return Object.prototype.hasOwnProperty.call(f, k); };
  const fields = {}, money = {};
  ROW_KEYS.forEach(function (k) {
    if (!has(k)) return;
    if (!prices && (k === "notes" || isLocked(b, k))) return;
    if (k === "item_type") {
      const t = itemType(f[k]);
      if (t && t !== (itemType(b[k]) || "both")) fields[k] = t;
      return;
    }
    if (k === "assigned_contact_id") {
      const v = f[k] === "" || f[k] == null ? null : Number(f[k]);
      if (!sameNumber(v, b[k])) fields[k] = v;
      return;
    }
    if (QTY_KEYS.indexOf(k) !== -1) {
      const v = parseNum(f[k]).value;
      if (!sameNumber(v, b[k])) fields[k] = v === undefined ? null : v;
      return;
    }
    const v = k === "name" ? String(f[k] == null ? "" : f[k]) : textOrNull(f[k]);
    if (!sameWords(v, b[k])) fields[k] = v;
  });
  if (prices) {
    const p = b.prices && typeof b.prices === "object" ? b.prices : {};
    PRICE_KEYS.forEach(function (k) {
      if (!has(k)) return;
      let v = parseNum(f[k]).value;
      if (v === undefined) v = null;
      if (v === null && PCT_FIELDS.indexOf(k) !== -1) v = 0;
      if (!sameNumber(v, p[k])) money[k] = v;
    });
  }
  return { fields, prices: money };
}

const LIMITS = { qty: [1e9, 3], money: [1e10, 2], pct: [1e4, 2] };
/** Why the database would refuse this sheet (a sentence), or null: numbers that are numbers and fit their columns, a
    markup above -100 %, a rate of 0 or more; without prices the words it changes never quote an amount. */
export function validateItem(base, form, opts) {
  const prices = !!(opts && opts.prices);
  const f = form || {};
  for (const k of Object.keys(f)) {
    const kind = QTY_KEYS.indexOf(k) !== -1 ? "qty" : MONEY_FIELDS.indexOf(k) !== -1 ? "money" : PCT_FIELDS.indexOf(k) !== -1 ? "pct" : null;
    if (!kind || (kind !== "qty" && !prices)) continue;
    const label = FIELD_LABELS[k] || k;
    const p = parseNum(f[k]);
    if (!p.ok) return label + ": type a number.";
    if (p.value === null) continue;
    if (p.places > LIMITS[kind][1]) return label + ": at most " + LIMITS[kind][1] + " decimal places.";
    if (Math.abs(p.value) >= LIMITS[kind][0]) return label + " is too large.";
    if (kind === "pct" && p.value <= -100) return label + " must be above -100%.";
    if (k === "labor_rate" && p.value < 0) return "The rate per hour cannot be below 0.";
  }
  if (!prices) {
    const d = diffItem(base, f, opts).fields;
    for (const k of WORD_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(d, k)) continue;
      const why = wordsProblem(d[k]);
      if (why) return (FIELD_LABELS[k] || k) + ": " + why;
    }
  }
  return null;
}

/** An estimate sheet's changes ({name, description, client_notes, status}): only what differs, never the terms or a
    locked word without prices. */
export function diffEstimate(base, form, opts) {
  const prices = !!(opts && opts.prices);
  const b = base || {}, f = form || {};
  const out = {};
  ["name", "description", "client_notes", "status"].forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(f, k)) return;
    if (!prices && (k === "client_notes" || isLocked(b, k))) return;
    const v = k === "name" ? String(f[k] == null ? "" : f[k]) : k === "status" ? statusWord(f[k]) : textOrNull(f[k]);
    if (!sameWords(v, b[k])) out[k] = v;
  });
  return out;
}
/** Why an estimate sheet is refused before it is sent, or null. */
export function validateEstimate(base, form, opts) {
  const prices = !!(opts && opts.prices);
  const d = diffEstimate(base, form, opts);
  if (d.status && statusesFor(base, prices).indexOf(d.status) === -1) return "Only someone who sees prices marks an estimate approved, or takes the approval back.";
  if (!prices) {
    for (const k of ["name", "description"]) {
      if (d[k] === undefined) continue;
      const why = wordsProblem(d[k]);
      if (why) return (k === "name" ? "Name" : "Description") + ": " + why;
    }
  }
  return null;
}

/* ── the planners: one rearrangement -> one write (estimate_order.py over the database's groups) ── */
function sid(v) { return String(v == null ? "" : v); }

/** The estimate's groups as the planners see them: the database's order and gids, each group's items in order. */
export function slotsOf(est) {
  return ((est && est.groups) || []).map(function (g) {
    return { gid: g.gid, key: groupKey(g.name), name: g.name, code: g.code, locked: !!g.locked,
      items: g.items.map(function (it) {
        return { id: it.id, version: it.version, sort: it.sort, group_name: it.group_name, group_code: it.group_code, locked: it.locked || [] };
      }) };
  });
}

// sorts are kept to 3 decimals (estimate_order.py SORT_PLACES); a new one between two neighbours, or null when none fits
function thousandths(v) {
  const d = parseDec(v);
  if (!d) return null;
  if (d.s <= 3) return d.n * pow10(3 - d.s);
  const div = pow10(d.s - 3), q = d.n / div, r = d.n % div;
  const twice = (r < 0n ? -r : r) * 2n;
  return twice > div || (twice === div && (q % 2n !== 0n)) ? q + (d.n < 0n ? -1n : 1n) : q;    // half to even (Decimal.quantize)
}
function fromThousandths(t) { return Number(t) / 1000; }
function place(lines, index) {
  const sorts = lines.map(function (r) { return thousandths(r.sort); });
  if (sorts.some(function (s) { return s === null; }) || new Set(sorts.map(String)).size !== sorts.length) return null;
  const lo = index - 1 >= 0 ? sorts[index - 1] : null;
  const hi = index < sorts.length ? sorts[index] : null;
  let n;
  if (lo === null && hi === null) n = 1000n;
  else if (lo === null) n = hi - 1000n;
  else if (hi === null) n = lo + 1000n;
  else {
    const sum = lo + hi;
    n = sum / 2n;
    if (sum % 2n !== 0n && n % 2n !== 0n) n += sum < 0n ? -1n : 1n;     // half to even
  }
  if ((lo !== null && n <= lo) || (hi !== null && n >= hi)) return null;
  return fromThousandths(n);
}

/**
 * The reorder_estimate moves when item `itemId` goes into group `target` ({gid} of a group the estimate has, or {name}
 * for a new one) before item `beforeId` (null: at the end). Only what changes: the item's new sort (and its new
 * group_name when the group changes — the database gives it that group's code), or the target group renumbered 1, 2,
 * 3 … when no sort fits between the neighbours. [] when nothing changes.
 */
export function planItemDrop(slots, itemId, target, beforeId) {
  let dragged = null, from = null;
  (slots || []).forEach(function (s) { s.items.forEach(function (it) { if (sid(it.id) === sid(itemId)) { dragged = it; from = s; } }); });
  if (!dragged) return [];
  const t = target || {};
  let to = t.gid ? (slots || []).find(function (s) { return s.gid === t.gid; }) || null : null;
  if (!to && t.name !== undefined) to = (slots || []).find(function (s) { return s.key === groupKey(t.name); }) || null;
  const targetName = (to ? to.name : cleanName(t.name)) || null;
  const lines = (to ? to.items : []).filter(function (r) { return sid(r.id) !== sid(itemId); });
  const ids = lines.map(function (r) { return sid(r.id); });
  const index = beforeId != null && ids.indexOf(sid(beforeId)) !== -1 ? ids.indexOf(sid(beforeId)) : lines.length;
  const regroup = to ? to !== from : groupKey(targetName) !== from.key;
  if (!regroup && beforeId != null && sid(beforeId) === sid(itemId)) return [];
  const current = (to ? to.items : []).map(function (r) { return sid(r.id); });
  const wanted = ids.slice(0, index).concat([sid(itemId)], ids.slice(index));
  if (!regroup && current.join("\u0001") === wanted.join("\u0001")) return [];
  const ns = place(lines, index);
  if (ns !== null) {
    const m = { id: dragged.id, version: dragged.version, sort: ns };
    if (regroup) m.group_name = targetName;
    return [m];
  }
  const order = lines.slice(0, index).concat([dragged], lines.slice(index));
  const moves = [];
  order.forEach(function (r, i) {
    const n = i + 1, isDragged = r === dragged;
    if (sameNumber(r.sort, n) && !(isDragged && regroup)) return;
    const m = { id: r.id, version: r.version, sort: n };
    if (isDragged && regroup) m.group_name = targetName;
    moves.push(m);
  });
  return moves;
}

/** Up (dir < 0) / Down: one place in its group; at the top / bottom of its group into the group above (at its end) /
    below (at its start). [] at the very top / bottom. */
export function planItemStep(slots, itemId, dir) {
  const list = slots || [];
  for (let gi = 0; gi < list.length; gi++) {
    const slot = list[gi];
    const ids = slot.items.map(function (r) { return sid(r.id); });
    const i = ids.indexOf(sid(itemId));
    if (i === -1) continue;
    if (dir < 0) {
      if (i > 0) return planItemDrop(list, itemId, { gid: slot.gid }, slot.items[i - 1].id);
      if (gi === 0) return [];
      return planItemDrop(list, itemId, { gid: list[gi - 1].gid }, null);
    }
    if (i + 1 < ids.length) return planItemDrop(list, itemId, { gid: slot.gid }, i + 2 < ids.length ? slot.items[i + 2].id : null);
    if (gi + 1 >= list.length) return [];
    const next = list[gi + 1];
    return planItemDrop(list, itemId, { gid: next.gid }, next.items.length ? next.items[0].id : null);
  }
  return [];
}

/** Group Up / Down: the new group_order (every group by name, in the new order), or null at the top / bottom. */
export function planGroupStep(slots, gid, dir) {
  const list = slots || [];
  const i = list.findIndex(function (s) { return s.gid === gid; });
  const j = dir < 0 ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= list.length) return null;
  const names = list.map(function (s) { return s.name; });
  const x = names[i]; names[i] = names[j]; names[j] = x;
  return names;
}

/** The other group already called `name` (any case, any spacing), or null: an empty group is never renamed onto it (the
    tidy group order would keep one of the two names and the empty group would be gone). */
export function renameTaken(slots, gid, name) {
  const k = groupKey(name);
  return (slots || []).find(function (s) { return s.gid !== gid && s.key === k; }) || null;
}

/** Rename a group: every item under the new name in one write; the group keeps its place (the group order says so when
    the new name alone would move it). An empty group (owner 2026-10-27) is renamed in the group order alone - never
    onto another group's name (renameTaken). -> {groupOrder | null, moves} or null when nothing changes. */
export function planRename(slots, groupOrder, gid, newName) {
  const list = slots || [];
  const slot = list.find(function (s) { return s.gid === gid; });
  const name = cleanName(newName);
  if (!slot || !name || name === slot.name) return null;
  const listed = cleanGroupOrder(groupOrder);
  const isListed = listed.some(function (n) { return groupKey(n) === slot.key; });
  if (!slot.items.length) {
    if (!isListed || renameTaken(list, gid, name)) return null;
    return { groupOrder: listed.map(function (n) { return groupKey(n) === slot.key ? name : n; }), moves: [] };
  }
  const moves = slot.items.map(function (it) { return { id: it.id, version: it.version, group_name: name }; });
  if (isListed) {
    return { groupOrder: listed.map(function (n) { return groupKey(n) === slot.key ? name : n; }), moves };
  }
  const ids = new Set(slot.items.map(function (it) { return sid(it.id); }));
  const items = [];
  list.forEach(function (s) {
    s.items.forEach(function (it) { items.push(Object.assign({}, it, ids.has(sid(it.id)) ? { group_name: name } : {})); });
  });
  const expected = [];
  list.forEach(function (s) { const k = s === slot ? groupKey(name) : s.key; if (expected.indexOf(k) === -1) expected.push(k); });
  const after = groupsInOrder(items, groupOrder, { includeEmpty: true }).map(function (s) { return s.key; });
  if (after.join("\u0001") === expected.join("\u0001")) return { groupOrder: null, moves };
  const order = list.map(function (s) { return s === slot ? name : s.name; });
  if (groupOrderProblem(order)) return { groupOrder: null, moves };     // another name too long to be listed: renamed all the same
  return { groupOrder: order, moves };
}

/** A new group (owner 2026-10-27: a name only, no first item): an empty group at the end - the whole order as the
    estimate shows it plus the new name, so no other group moves. -> {groupOrder, taken: null}, or {groupOrder: null,
    taken: gid} when a group has that name already (any case, any spacing); null for a blank name. */
export function planNewGroup(slots, newName) {
  const name = cleanName(newName);
  if (!name) return null;
  const list = slots || [];
  const taken = list.find(function (s) { return s.key === groupKey(name); });
  if (taken) return { groupOrder: null, taken: taken.gid };
  return { groupOrder: list.map(function (s) { return s.name; }).concat([name]), taken: null };
}

/** Delete an empty group (owner 2026-10-27): the group order without its name. null when the group has items (they are
    moved or deleted first) or the order does not list it. */
export function planDeleteGroup(slots, groupOrder, gid) {
  const slot = (slots || []).find(function (s) { return s.gid === gid; });
  if (!slot || slot.items.length || !slot.key) return null;
  const listed = cleanGroupOrder(groupOrder);
  if (!listed.some(function (n) { return groupKey(n) === slot.key; })) return null;
  return listed.filter(function (n) { return groupKey(n) !== slot.key; });
}

/** move_estimate_items for one item to another estimate: last in its own group there (or last of all when that
    estimate has no such group), on the version shown. */
export function planMoveToEstimate(item, target) {
  const k = groupKey(item && item.group_name);
  const there = ((target && target.items) || []);
  const same = there.filter(function (it) { return groupKey(it.group_name) === k; });
  const pool = same.length ? same : there;
  const top = pool.reduce(function (m, it) { const n = num(it.sort); return n > m ? n : m; }, 0);
  return [{ id: item.id, version: item.version, estimate_id: target.id, sort: Math.floor(top) + 1 }];
}

/**
 * Why the database would refuse this rearrangement from a person without prices (estimates.py _words_refusal), or
 * null: a group name or code that quotes an amount never changes on an item (Rule A), none is written new (Rules B, C
 * — an item moved into another group takes that group's code too), and a group order keeps every such name as it is
 * and adds none (this person never has their stored text: no group order is sent while one is locked).
 */
export function wordsRefusal(est, groupOrder, moves, opts) {
  if (opts && opts.prices) return null;
  const items = {};
  ((est && est.items) || []).forEach(function (it) { items[sid(it.id)] = it; });
  const slots = slotsOf(est);
  for (const m of moves || []) {
    const it = items[sid(m.id)];
    if (!it) continue;
    const changed = ["group_name", "group_code"].filter(function (col) { return col in m && !sameText(m[col], it[col]); });
    if (changed.some(function (col) { return isLocked(it, col); })) return LOCKED_HINT;
    if ("group_name" in m && groupKey(m.group_name) !== groupKey(it.group_name)) {
      const target = slots.find(function (s) { return s.key === groupKey(m.group_name); });
      if (target && target.locked) return LOCKED_HINT;
    }
    for (const col of changed) {
      const why = wordsProblem(m[col]);
      if (why) return why;
    }
  }
  if (groupOrder) {
    if (est && est.groupOrderLocked) return LOCKED_HINT;
    const old = ((est && est.group_order) || []).map(String);
    if (groupOrder.some(function (g) { return old.indexOf(String(g)) === -1 && (quotesAmount(g) || holdsMask(g)); })) return LOCKED_HINT;
  }
  return null;
}

/* ── one item's money (estimate_math.py: labor, material and the total each half away from zero to cents; the total
      from the unrounded sum; per area None when the area is blank or 0) ── */
function D(v) { return parseDec(v) || { n: 0n, s: 0 }; }
function mulD(a, b) { return { n: a.n * b.n, s: a.s + b.s }; }
function addD(a, b) { const s = Math.max(a.s, b.s); return { n: a.n * pow10(s - a.s) + b.n * pow10(s - b.s), s }; }
function factorD(pct) { const d = D(pct); return addD({ n: 1n, s: 0 }, { n: d.n, s: d.s + 2 }); }
function divRound(num, den) {                 // num / den, half away from zero, as an integer
  const q = num / den, r = num % den;
  const twice = (r < 0n ? -r : r) * 2n, d = den < 0n ? -den : den;
  if (twice >= d) return q + ((num < 0n) !== (den < 0n) ? -1n : 1n);
  return q;
}
function centsD(a) { return Number(a.s <= 2 ? a.n * pow10(2 - a.s) : divRound(a.n, pow10(a.s - 2))); }
function perArea(x, area) {
  const a = D(area);
  if (a.n === 0n) return null;
  return Number(divRound(x.n * pow10(a.s) * 100n, a.n * pow10(x.s)));
}
/** -> {menHours (a number), labor, material, total, laborPerArea, materialPerArea}: integer cents; the money null when
    prices is null (a person without prices: never a misleading 0). */
export function itemMath(item, prices) {
  const i = item || {};
  const men = mulD(mulD(D(i.labor_guys), D(i.labor_days)), { n: 8n, s: 0 });
  const menHours = Number(men.n) / Math.pow(10, men.s);
  if (!prices || typeof prices !== "object") return { menHours, labor: null, material: null, total: null, laborPerArea: null, materialPerArea: null };
  const lf = factorD(prices.labor_markup_pct), mf = factorD(prices.material_markup_pct);
  const labor = addD(mulD(mulD(men, D(prices.labor_rate)), lf), mulD(mulD(D(i.labor_qty), D(prices.labor_unit_price)), lf));
  const material = mulD(mulD(D(i.material_qty), D(prices.material_unit_price)), mf);
  return { menHours, labor: centsD(labor), material: centsD(material), total: centsD(addD(labor, material)),
    laborPerArea: perArea(labor, i.labor_area), materialPerArea: perArea(material, i.material_area) };
}

/* ── conflicts (est_save.py): a save refused as stale ─────────────────── */
/**
 * base: the row (flat: flatItem) the sheet started from; current: the row as it is now; changes: {column: value} this
 * save sends. -> {kind: "done" (it is already so), "resend" (they changed none of these: the same changes go again on
 * the current versions) or "clash" (they changed these too), mine: what still differs from the current row, clash:
 * [columns]}.
 */
export function conflictPlan(base, current, changes) {
  const b = base || {}, c = current || {}, ch = changes || {};
  const mine = {};
  Object.keys(ch).forEach(function (k) { if (!sameValue(k, ch[k], c[k])) mine[k] = ch[k]; });
  const keys = Object.keys(mine);
  if (!keys.length) return { kind: "done", mine, clash: [] };
  const clash = keys.filter(function (k) { return !sameValue(k, b[k], c[k]); });
  return { kind: clash.length ? "clash" : "resend", mine, clash };
}
/** A value for the conflict panel: money in dollars, a markup in percent, a type by its label, a blank as "—". */
export function shownValue(key, v) {
  if (v === null || v === undefined || v === "") return "—";
  if (key === "item_type") return typeLabel(v);
  if (key === "status") return statusText(v);
  if (MONEY_FIELDS.indexOf(key) !== -1) return moneyText(toCents(v));
  if (PCT_FIELDS.indexOf(key) !== -1) return pctText(v);
  if (QTY_KEYS.indexOf(key) !== -1) return qtyText(v, false) || "0";
  const s = String(v).replace(/\s+/g, " ").trim();
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}
