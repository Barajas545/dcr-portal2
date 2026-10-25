/* Estimates and change orders on Portal 2 (BLUEPRINT 3.3.11 "Estimates and change orders"; P5 acceptance check 1;
   owner answer Q12 — view and print only — REVERSED 2026-10-24: an Estimator (an admin, or a manager with the
   Estimator switch) edits them on the web too: estimateEditor below, the editor's own rules in map/estimate-edit.js,
   loaded only for an Estimator).

   The database does the estimate's work (migration M5a, rpc estimate_print — DCR Desktop 2's printing rules):
   the groups in the order the office arranged them, the items in a group, the item money (the
   estimate_item_totals view, rounded to cents), the group totals and a change order's contract figures;
   and, for a person without the prices switch, it sends NO money key at all and scrubs amounts typed into
   the words. This module shapes that answer for the pages and keeps DCR Desktop 2's screen rules
   (dcrdesk/ui/pages/project/est_logic.py: labels, status words, the crew line, the contract summary of the
   Estimates tab; domain/estimate_order.py: archived and deleted estimates never count). Money is integer
   cents from the database's decimal text, never binary floating point.

   Money is shown only when the person may see prices AND every item came with its money (a row without
   it never turns into a misleading $0.00) - Desktop 2's "priced" guard. Amounts a person with prices
   typed are masked on a worksite copy they ask for (Q28: display only).

   Pure module: no DOM, no network (node tests import it). */

import { maskAmounts } from "../money-mask.js";

export const DASH = "—";
export const WORKSITE_TAG = "WORKSITE COPY · NO PRICES";

/* ── exact decimals ─────────────────────────────────────────────────── */

/** A database number (numeric arrives as a JSON number or text) -> {n: BigInt, s: scale}; blanks and
    junk -> null. "1,200.5" -> {n: 12005n, s: 1}. */
export function parseDec(v) {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  let t;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    t = String(v);
    if (/e/i.test(t)) t = v.toFixed(12);
  } else {
    t = String(v).trim().replace(/,/g, "");
  }
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (!m[2] && !m[3])) return null;
  const frac = m[3] || "";
  const n = BigInt((m[2] || "0") + frac) * (m[1] === "-" ? -1n : 1n);
  return { n, s: frac.length };
}

function pow10(k) { let p = 1n; for (let i = 0; i < k; i++) p *= 10n; return p; }

/** a BigInt over 10^scale, rounded half away from zero to 10^-places (Postgres round(x, places)). */
function roundTo(n, scale, places) {
  if (scale <= places) return n * pow10(places - scale);
  const d = pow10(scale - places);
  const q = n / d, r = n % d;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice >= d) return n < 0n ? q - 1n : q + 1n;
  return q;
}

/** Integer cents of a database amount (half away from zero), or null when it is blank. */
export function toCents(v) {
  const d = parseDec(v);
  return d ? Number(roundTo(d.n, d.s, 2)) : null;
}

/** Cents of a × b (a quantity times a unit price), half away from zero; a blank side is 0. */
export function mulCents(a, b) {
  const x = parseDec(a), y = parseDec(b);
  if (!x || !y) return 0;
  return Number(roundTo(x.n * y.n, x.s + y.s, 2));
}

/** Cents of `cents` × pct / 100 (sales tax at 8.25 %), half away from zero. */
export function pctOfCents(cents, pct) {
  const p = parseDec(pct);
  if (!p || cents === null || cents === undefined) return 0;
  const neg = p.n < 0n;
  return Number(roundTo(BigInt(Math.round(cents)) * (neg ? 0n : p.n), p.s + 2, 0));
}

const group3 = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** "$1,234.56" / "-$12.00" from integer cents; null -> ""; 0 -> "—" when blankZero. */
export function moneyText(cents, blankZero) {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return "";
  const c = Math.round(Number(cents));
  if (c === 0 && blankZero) return DASH;
  const abs = Math.abs(c);
  const text = "$" + group3(String(Math.floor(abs / 100))) + "." + String(abs % 100).padStart(2, "0");
  return c < 0 ? "-" + text : text;
}

/** "12" · "12.5" · "1,200"; blank for nothing (and for 0 by default: a header row with no quantity is
    not an order for none) — printing/common.py qty_text. */
export function qtyText(v, blankZero) {
  if (v === null || v === undefined || v === "") return "";
  const d = parseDec(v);
  if (!d) return "";
  let n = roundTo(d.n, d.s, 3);
  if (n === 0n && blankZero !== false) return "";
  const neg = n < 0n;
  if (neg) n = -n;
  let whole = (n / 1000n).toString();
  let frac = (n % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + group3(whole) + (frac ? "." + frac : "");
}

/** 8 -> "8%", 8.25 -> "8.25%". */
export function pctText(v) {
  const d = parseDec(v);
  if (!d) return "0%";
  const n = roundTo(d.n, d.s, 2);
  const neg = n < 0n;
  const a = neg ? -n : n;
  const frac = (a % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + (a / 100n).toString() + (frac ? "." + frac : "") + "%";
}

/* ── names ──────────────────────────────────────────────────────────── */

// Python's str.split() white space (the database's app.tidy_name lists the same by hand)
const WS = /[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

/** A name tidy: runs of white space as one space, trimmed (null -> ""). */
export function cleanName(name) {
  return String(name == null ? "" : name).replace(WS, " ").trim();
}

/** Lower case one letter at a time, as PostgreSQL's lower() (never a two-letter result). */
export function lowerPg(text) {
  let out = "";
  for (const ch of String(text)) {
    const lo = ch.toLowerCase();
    out += lo.length === ch.length ? lo : ch === "İ" ? "i" : ch;
  }
  return out;
}

/* ── estimates ──────────────────────────────────────────────────────── */

export const STATUS_LABELS = Object.freeze({ draft: "Draft", sent: "Sent", approved: "Approved", declined: "Declined" });

export function statusWord(s) { return STATUS_LABELS[s] ? s : "draft"; }
export function statusText(s) { return STATUS_LABELS[statusWord(s)]; }

export function isChangeOrder(e) { return !!e && e.kind === "change_order"; }

/** Whether the project page offers this person the estimate editor (it only shows the controls - the database decides
    every write, app.can_edit('estimates')): an active admin, or an active manager whose Estimator switch is on as the
    database has it (access: repo/estimates.js estimateAccess). The agents account never. */
export function estimateEditor(me, access) {
  if (!me || me.active === false || me.role === "agents") return false;
  if (me.role === "admin") return true;
  return me.role === "manager" && !!(access && access.can_estimate);
}
export function isArchived(e) { return !!(e && e.archived_at); }
export function isDeleted(e) { return !!(e && e.deleted_at); }
/** An estimate counts in totals, print lists and the contract only when neither archived nor deleted. */
export function counts(e) { return !!e && typeof e === "object" && !isArchived(e) && !isDeleted(e); }

/** "Estimate #3" / "Change Order #2" (the numbers the database gives). */
export function estimateLabel(e) {
  e = e || {};
  if (isChangeOrder(e)) return e.co_number !== null && e.co_number !== undefined ? "Change Order #" + e.co_number : "Change Order";
  return e.number !== null && e.number !== undefined ? "Estimate #" + e.number : "Estimate";
}

/** The estimate's name, else its label. */
export function estimateTitle(e) {
  const n = cleanName(e && e.name);
  return n || estimateLabel(e);
}

/** What people call it on screen: "Framing"; "CO #2 — Extra window"; an unnamed one by its number. */
export function estimateName(e) {
  e = e || {};
  const name = cleanName(e.name);
  if (isChangeOrder(e)) {
    const head = e.co_number !== null && e.co_number !== undefined ? "CO #" + e.co_number : "Change order";
    return name ? head + " — " + name : estimateLabel(e);
  }
  return name || estimateLabel(e);
}

/** Estimates first by number, then change orders by CO number (Desktop 2's list order). */
export function estimateOrder(a, b) {
  const ka = isChangeOrder(a) ? 1 : 0, kb = isChangeOrder(b) ? 1 : 0;
  if (ka !== kb) return ka - kb;
  const ca = Number(a.co_number || 0), cb = Number(b.co_number || 0);
  if (ca !== cb) return ca - cb;
  const na = Number(a.number || 0), nb = Number(b.number || 0);
  if (na !== nb) return na - nb;
  return Number(a.id || 0) - Number(b.id || 0);
}

/** One plural word: 1 guy, 2 guys (exactly one is singular). */
function plural(v, one, many) { const d = parseDec(v); return d && roundTo(d.n, d.s, 3) === 1000n ? one : many; }

function decText(n, s) {
  const neg = n < 0n;
  const a = (neg ? -n : n).toString().padStart(s + 1, "0");
  return (neg ? "-" : "") + (s ? a.slice(0, a.length - s) + "." + a.slice(a.length - s) : a);
}

/** The screen's crew line: "4 guys × 3 days · 96 men-hours" — quantities, safe for every role
    (est_logic.crew_text: shown when either is set). */
export function crewText(item) {
  const g = parseDec(item && item.labor_guys), d = parseDec(item && item.labor_days);
  const gz = !g || g.n === 0n, dz = !d || d.n === 0n;
  if (gz && dz) return "";
  const gs = qtyText(item.labor_guys, false) || "0", ds = qtyText(item.labor_days, false) || "0";
  let text = gs + " " + plural(item.labor_guys, "guy", "guys") + " × " + ds + " " + plural(item.labor_days, "day", "days");
  if (!gz && !dz) {
    const hours = qtyText(decText(g.n * d.n * 8n, g.s + d.s), true);
    if (hours) text += " · " + hours + " men-hours";
  }
  return text;
}

/** The printed crew bit: "4 guys × 3 days", only when both are set (printing/estimates.py). */
export function crewPrint(item) {
  const g = parseDec(item && item.labor_guys), d = parseDec(item && item.labor_days);
  if (!g || g.n === 0n || !d || d.n === 0n) return "";
  return qtyText(item.labor_guys) + " " + plural(item.labor_guys, "guy", "guys") + " × " +
    qtyText(item.labor_days) + " " + plural(item.labor_days, "day", "days");
}

export const ITEM_TYPES = Object.freeze({ both: "", labor: "Labor", material: "Material", sub: "Sub-contractor" });

/** Every amount the person may not see hidden from free text (display only, Q28). */
export function wordsFor(show) {
  return show ? function (t) { return t == null ? "" : String(t); } : function (t) { return maskAmounts(t == null ? "" : String(t)); };
}

/* ── shaping what the database answered ─────────────────────────────── */

function itemMoney(it) {
  const t = it && it.totals;
  if (!t || typeof t !== "object" || t.total === null || t.total === undefined) return null;
  return { labor: toCents(t.labor) || 0, material: toCents(t.material) || 0, total: toCents(t.total) || 0 };
}

/**
 * One answer of rpc estimate_print (M5a: {prices, project, estimate, groups [{key, name, title, code, items
 * [...] [, total]}], totals {men_hours [, labor, material, total]} [, contract {original, previous, this,
 * new_total}]}) -> the estimate as the pages use it: {...estimate, label, title, displayName, status,
 * statusText, archived, groups [{key, name, title, label, code, items, total}], items (in order, each with
 * money {labor, material, total} in cents or null, and its flags), priced, total {labor, material, total} |
 * null, contract (cents) | null}. Without the prices switch the database sent no money key at all and
 * scrubbed the typed words: every money here is null.
 * flagsOf: {itemId: [flag rows]} (estimate_item_flags).
 */
export function fromEstimatePrint(answer, flagsOf) {
  const a = answer || {};
  const e = a.estimate || {};
  const fl = flagsOf || {};
  const groups = (Array.isArray(a.groups) ? a.groups : []).map(function (g) {
    const items = (Array.isArray(g.items) ? g.items : []).map(function (it) {
      return Object.assign({}, it, { money: itemMoney(it), flags: fl[String(it.id)] || [] });
    });
    const name = cleanName(g.name);
    return { key: g.key, name, title: g.title || name || "General", label: name || "(no group)", code: String(g.code || "").trim(),
      items, total: sumOf(items) };
  });
  const items = [];
  groups.forEach(function (g) { g.items.forEach(function (it) { items.push(it); }); });
  const c = a.contract && typeof a.contract === "object" ? a.contract : null;
  return Object.assign({}, e, {
    label: e.label || estimateLabel(e), title: estimateTitle(e), displayName: estimateName(e),
    status: statusWord(e.status), statusText: statusText(e.status), archived: isArchived(e),
    groups, items, priced: priced(items), total: sumOf(items),
    contract: c ? { original: c.original === null || c.original === undefined ? null : toCents(c.original),
      previous: toCents(c.previous) || 0, self: toCents(c.this) || 0,
      newTotal: c.new_total === null || c.new_total === undefined ? null : toCents(c.new_total) } : null,
  });
}

/** Flag rows -> {itemId: [rows]}. */
export function flagsByItem(rows) {
  const out = {};
  (rows || []).forEach(function (f) {
    if (f && f.item_id !== null && f.item_id !== undefined) (out[String(f.item_id)] = out[String(f.item_id)] || []).push(f);
  });
  return out;
}

/** Every item carries its money (an empty list counts as priced: nothing is hidden). */
export function priced(items) {
  return (items || []).every(function (it) { return it && it.money; });
}

/** {labor, material, total} in cents over items with money; null when any item has none. */
export function sumOf(items) {
  let labor = 0, material = 0, total = 0;
  for (const it of items || []) {
    if (!it || !it.money) return null;
    labor += it.money.labor; material += it.money.material; total += it.money.total;
  }
  return { labor, material, total };
}

/** Money is shown only for a person with prices whose items ALL carry it. */
export function moneyShown(prices, estimates) {
  return !!prices && (estimates || []).every(function (e) { return e && e.priced; });
}

/** Desktop 2's contract summary (Estimates tab): original estimates (not declined) + approved change
    orders = contract; open change orders (draft, sent) apart. Archived ones do not count. null when any
    counted estimate has no money (no prices). Counts are always given. */
export function contractSummary(estimates) {
  let original = 0, approved = 0, pending = 0, nEst = 0, nApp = 0, nPen = 0, hidden = false;
  for (const e of estimates || []) {
    if (!counts(e)) continue;
    const t = e.total;
    if (!t) hidden = true;
    const status = statusWord(e.status);
    if (isChangeOrder(e)) {
      if (status === "approved") { approved += t ? t.total : 0; nApp++; }
      else if (status === "draft" || status === "sent") { pending += t ? t.total : 0; nPen++; }
    } else if (status !== "declined") { original += t ? t.total : 0; nEst++; }
  }
  return { money: hidden ? null : { original, approved, pending, contract: original + approved },
    estimates: nEst, approvedCount: nApp, pendingCount: nPen };
}

/** The estimates a print shows: one by id, or every one that counts (archived and deleted left out). */
export function pickForPrint(estimates, which) {
  const list = estimates || [];
  if (which && which !== "all") {
    const hit = list.find(function (e) { return String(e.id) === String(which); });
    return hit ? [hit] : [];
  }
  return list.filter(counts);
}

/* ── item flags (estimate_item_flags, M5a) ──────────────────────────── */

export const FLAG_LABELS = Object.freeze({ blocked: "Blocked", complete: "Complete", important: "Important" });
export const FLAG_ICONS = Object.freeze({ blocked: "⛔", complete: "✓", important: "★" });

/** The flags worth showing (known states), in a fixed order. */
export function itemFlags(item) {
  const order = ["blocked", "important", "complete"];
  return ((item && item.flags) || []).filter(function (f) { return f && FLAG_LABELS[f.state]; })
    .slice().sort(function (a, b) { return order.indexOf(a.state) - order.indexOf(b.state); });
}
