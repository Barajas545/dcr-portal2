/* The Progress Chart's data: DCR Desktop 2 rows -> the payload pm-chart.js derives from (port of what the old
   server's doPM put together; BLUEPRINT 3.3.11 "Progress Chart (PM)", Appendix A "pm").

   * statusDates(activity)        {status: "YYYY-MM-DD"} - the company day the project LAST moved to each status,
                                  from the status rows of the project log (to_status), or an imported line's
                                  "Status changed: Recived → Estimating" read with the old words;
   * liveEstimates(estimates)     the estimates the chart tracks (live, not archived, not declined), in order;
   * orderItems(items, order)     an estimate's items in the estimate's own order (estimate_order.py);
   * estimateName(e)              "Framing" / "CO #2 — Extra window" / "Estimate #3" (est_logic.estimate_label);
   * toPayload(rows, ctx)         every lane, quote, flag, bill, invoice, cost, commitment and task, mapped;
   * the UI-only gates (canFlag, canFollowUp, canStatus, canNote): they hide controls, the database decides.

   The money rule (BLUEPRINT 2.1 principle 8, Q11, Appendix D): ctx.prices says the person has the prices
   switch (amounts on items and quotes, and a quote's notes - they name its price: quote_prices since the M5a review);
   ctx.money says they may see prices AND financials (bills, payments, invoices, costs, quote_commitments). Without
   them no amount is copied into the payload even if a row carried one, and the free text people typed (item names
   and notes, flag notes, task words, document names) goes through ctx.mask - the amount mask of Desktop 2
   (money-mask.js; Q28: on screen only). "priced" is the database's (estimate_item_totals.priced, the same yes / no
   for every reader), so the bidding steps read the same for everyone. worksitePayload takes the amounts out of a
   price person's payload AND masks every typed word again (the worksite copy carries no "$" at all).

   Pure module: no DOM, no network (node tests import it). */

import { ymd } from "./pacific.js";
import { toNewStatus, isStatus } from "./status.js";
import { FLAG_STATES } from "../pm-chart.js";
import { maskAmounts } from "../money-mask.js";
import { scrubMoney } from "../scrub-money.js";

const ident = function (t) { return t == null ? "" : String(t); };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const FLAG_NOTE_MAX = 300;
export const QUOTE_STATUSES = Object.freeze(["requested", "received", "declined", "awarded", "self"]);
export const QUOTE_STATUS_LABELS = Object.freeze({ requested: "Requested", received: "Received", declined: "Declined", awarded: "Awarded", self: "Self-performed" });
export const FLAG_LABELS = Object.freeze({ blocked: "Blocked", complete: "Complete", important: "Important" });

function trim(v) { return v == null ? "" : String(v).trim(); }
function num(v) { return v === null || v === undefined || v === "" || !isFinite(Number(v)) ? 0 : Number(v); }
function numOrNull(v) { return v === null || v === undefined || v === "" || !isFinite(Number(v)) ? null : Number(v); }
function one(v) { return Array.isArray(v) ? (v[0] || null) : (v && typeof v === "object" ? v : null); }
function pick(r, keys) { for (const k of keys) if (r && r[k] !== undefined) return r[k]; return undefined; }

/** A timestamp's company day ("YYYY-MM-DD"); a date stays as written. */
export function dayOf(v) {
  if (!v) return "";
  const s = String(v);
  if (DAY_RE.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? "" : ymd(d);
}

/* "Status changed: Recived → Estimating" (the old portal's log line, kept by the import) or Desktop 2's
   "Status: New Request → Sent — note" when a row has no to_status. */
const STATUS_TEXT = /Status(?: changed)?:\s*(.+?)\s*(?:→|->)\s*(.+?)(?:\s+[—-]\s+.*)?$/;

export function statusDates(activity) {
  const out = {};
  (activity || []).forEach(function (a) {
    let target = trim(a.to_status);
    if (!target) {
      const m = STATUS_TEXT.exec(String(a.text || "").split("\n")[0]);
      if (!m) return;
      target = toNewStatus(m[2].trim());
      if (!isStatus(target) || (target === "new_request" && !/^(recived|new request|new_request|to do)$/i.test(m[2].trim()))) return;
    }
    if (!isStatus(target)) return;
    const d = dayOf(a.created_at);
    if (d && (!out[target] || d > out[target])) out[target] = d;
  });
  return out;
}

/* ── the estimate's order (dcrdesk/domain/estimate_order.py: groups listed in group_order first, then by code
   naturally, then named before unnamed, then by name; inside a group by sort - blank last - then id) ── */
// Python's str.split() white space (the database's app.tidy_name lists the same by hand)
const WS = /[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;
export function cleanName(n) { return String(n == null ? "" : n).replace(WS, " ").trim(); }
/** lower case one letter at a time, as PostgreSQL's lower() */
function lowerPg(t) {
  let out = "";
  for (const ch of String(t)) { const lo = ch.toLowerCase(); out += lo.length === ch.length ? lo : ch === "\u0130" ? "i" : ch; }
  return out;
}
export function groupKey(n) { return lowerPg(cleanName(n)); }

/** Natural order for group codes ("06.11.00" before "06.17.00", "9" before "10"; blank last). */
export function naturalCmp(a, b) {
  const x = String(a == null ? "" : a).trim(), y = String(b == null ? "" : b).trim();
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  const px = x.split(/(\d+)/).filter(Boolean), py = y.split(/(\d+)/).filter(Boolean);
  for (let i = 0; i < Math.min(px.length, py.length); i++) {
    const dx = /^\d+$/.test(px[i]), dy = /^\d+$/.test(py[i]);
    if (dx !== dy) return dx ? -1 : 1;
    if (dx) {
      const u = px[i].replace(/^0+/, ""), v = py[i].replace(/^0+/, "");
      if (u.length !== v.length) return u.length - v.length;
      if (u !== v) return u < v ? -1 : 1;
    } else {
      const u = px[i].toLowerCase(), v = py[i].toLowerCase();
      if (u !== v) return u < v ? -1 : 1;
    }
  }
  return px.length - py.length;
}

function sortCmp(a, b) {
  const sa = numOrNull(a.sort), sb = numOrNull(b.sort);
  if ((sa === null) !== (sb === null)) return sa === null ? 1 : -1;
  if (sa !== null && sa !== sb) return sa - sb;
  return num(a.id) - num(b.id);
}

/** An estimate's items in the estimate's own order. */
export function orderItems(items, groupOrder) {
  // keys are group names: no inherited key ("constructor") may answer for one
  const listed = Object.create(null);
  let n = 0;
  (groupOrder || []).forEach(function (g) { const k = groupKey(g); if (!(k in listed)) listed[k] = n++; });
  const slots = Object.create(null), list = [];
  (items || []).slice().sort(sortCmp).forEach(function (it) {
    const k = groupKey(it.group_name);
    let s = slots[k];
    if (!s) { s = slots[k] = { name: cleanName(it.group_name), code: "", items: [], listed: k in listed ? listed[k] : null, at: list.length }; list.push(s); }
    s.items.push(it);
    if (!s.code) s.code = trim(it.group_code);
  });
  list.sort(function (a, b) {
    if ((a.listed === null) !== (b.listed === null)) return a.listed === null ? 1 : -1;
    if (a.listed !== null) return a.listed - b.listed;
    const c = naturalCmp(a.code, b.code);
    if (c) return c;
    if (!a.name !== !b.name) return a.name ? -1 : 1;
    const x = a.name.toLowerCase(), y = b.name.toLowerCase();
    return x < y ? -1 : x > y ? 1 : a.at - b.at;
  });
  return list.reduce(function (out, s) { return out.concat(s.items); }, []);
}

/** What people call an estimate (est_logic.estimate_label): "Framing"; "CO #2 — Extra window"; an unnamed one by
    its number ("Estimate #3", "Change order #2"). */
export function estimateName(e) {
  e = e || {};
  const name = cleanName(e.name);
  const hasCo = e.co_number !== null && e.co_number !== undefined && e.co_number !== "";
  if (e.kind === "change_order") return name ? (hasCo ? "CO #" + e.co_number : "Change order") + " — " + name : hasCo ? "Change order #" + e.co_number : "Change order";
  return name || (e.number !== null && e.number !== undefined && e.number !== "" ? "Estimate #" + e.number : "Estimate");
}

/** Estimates that count on the chart: live, not archived, not declined; estimates first, then change orders. */
export function liveEstimates(estimates) {
  return (estimates || []).filter(function (e) { return e && !e.deleted_at && !e.archived_at && e.status !== "declined"; })
    .sort(function (a, b) {
      const ka = a.kind === "change_order" ? 1 : 0, kb = b.kind === "change_order" ? 1 : 0;
      return ka - kb || num(a.number) - num(b.number) || num(a.id) - num(b.id);
    });
}

export function contactName(c) {
  c = one(c);
  return c ? (trim(c.company) || trim(c.name)) : "";
}

export function toFlag(row, ctx) {
  if (!row || FLAG_STATES.indexOf(row.state) === -1) return null;
  const c = ctx || {};
  const mask = c.mask || ident;
  const nameOf = c.nameOf || function () { return ""; };
  const by = pick(row, ["by", "updated_by", "created_by"]);         // M5a: by / at are the database's
  const at = pick(row, ["at", "updated_at", "created_at"]);
  return {
    itemId: row.item_id,
    state: row.state,
    note: mask(trim(row.note)),
    due: DAY_RE.test(String(row.due_date || "")) ? String(row.due_date) : "",
    by: nameOf(by) || "",
    at: dayOf(at),
    version: row.version == null ? null : Number(row.version),
  };
}

export function toQuote(row, ctx) {
  const c = ctx || {};
  const mask = c.mask || ident;
  const vendor = one(row.vendor) || (c.contacts && row.vendor_contact_id != null ? c.contacts[String(row.vendor_contact_id)] || null : null);
  const prices = one(row.prices);
  // the amount, the vendor's priced document and the quote's notes live in quote_prices (M5a, Q11): prices people only
  const doc = c.prices && prices ? trim(prices.document_url) : "";
  const status = QUOTE_STATUSES.indexOf(row.status) !== -1 ? row.status : "requested";
  const q = {
    id: row.id,
    itemId: row.estimate_item_id == null ? null : row.estimate_item_id,
    kind: row.kind === "change_order" ? "change_order" : "quote",
    status: status,
    vendor: trim(row.vendor_name) || contactName(vendor) || "(vendor)",
    vendorEmail: vendor ? trim(vendor.email) : "",
    requestedDate: DAY_RE.test(String(row.requested_date || "")) ? String(row.requested_date) : "",
    receivedDate: DAY_RE.test(String(row.received_date || "")) ? String(row.received_date) : "",
    followUps: num(row.follow_ups),
    lastFollowUp: DAY_RE.test(String(row.last_follow_up || "")) ? String(row.last_follow_up) : "",
    notes: c.prices && prices ? mask(trim(prices.notes)) : "",
    documentUrl: /^https:\/\//i.test(doc) ? doc : "",
    version: row.version == null ? null : Number(row.version),
  };
  // the amount only with the prices switch, and only from quote_prices (M5a); never a stray column
  if (c.prices && prices && prices.amount !== undefined) q.amount = numOrNull(prices.amount);
  return q;
}

export function toBill(row, ctx) {
  const c = ctx || {};
  const nameOf = c.nameOf || function () { return ""; };
  const amount = num(row.amount);
  const paid = (row.payments || []).reduce(function (s, p) { return s + num(p.amount); }, 0);
  const approved = !!row.approved_at;
  return {
    id: row.id, itemId: row.estimate_item_id == null ? null : row.estimate_item_id,
    quoteId: row.quote_id == null ? null : row.quote_id,
    vendor: trim(row.vendor_name) || contactName(row.vendor) || "(no vendor)",
    invoiceNumber: trim(row.invoice_number), invoiceDate: DAY_RE.test(String(row.invoice_date || "")) ? String(row.invoice_date) : "",
    dueDate: DAY_RE.test(String(row.due_date || "")) ? String(row.due_date) : "",
    description: trim(row.description),
    amount: amount, approved: approved, approvedAmount: approved ? num(row.approved_amount) : 0,
    approvedBy: approved ? nameOf(row.approved_by) : "", approvedDay: dayOf(row.approved_at),
    payMethod: trim(row.pay_method),
    paid: Math.round(paid * 100) / 100,
    owed: Math.round(Math.max(0, amount - paid) * 100) / 100,
    hasDocument: row.document_file_id != null,
  };
}

export function toInvoice(row) {
  const lines = row.invoice_lines || [];
  const ests = [];
  lines.forEach(function (l) { if (l.estimate_id != null && ests.indexOf(l.estimate_id) === -1) ests.push(l.estimate_id); });
  return {
    id: row.id, number: trim(row.number), status: trim(row.status) || "draft",
    invoiceDate: DAY_RE.test(String(row.invoice_date || "")) ? String(row.invoice_date) : "",
    sentDate: DAY_RE.test(String(row.sent_date || "")) ? String(row.sent_date) : "",
    dueDate: DAY_RE.test(String(row.due_date || "")) ? String(row.due_date) : "",
    total: Math.round(lines.reduce(function (s, l) { return s + num(l.amount); }, 0) * 100) / 100,
    paid: Math.round((row.client_payments || []).reduce(function (s, p) { return s + num(p.amount); }, 0) * 100) / 100,
    estimateIds: ests,
  };
}

export function toCost(row) {
  return {
    id: row.id, itemId: row.estimate_item_id == null ? null : row.estimate_item_id,
    date: DAY_RE.test(String(row.cost_date || "")) ? String(row.cost_date) : "",
    kind: trim(row.kind), description: trim(row.description), vendor: trim(row.vendor), amount: num(row.amount),
  };
}

/** One quote_commitments row (M5a: quote_id, committed (prices, else null), billed, approved, paid, waiting_count,
    pct_billed / pct_paid, over_billed / over_billed_by, over_paid, paid_unapproved - the roll-up of the old
    lib/commitments.js, never clamped). */
export function toCommitment(row) {
  const committed = num(row.committed), billed = num(row.billed), approved = num(row.approved), paid = num(row.paid);
  const flag = function (keys, dflt) { const v = pick(row, keys); return v === undefined || v === null ? dflt : !!v; };
  return {
    quoteId: pick(row, ["quote_id", "id"]),
    kind: row.kind === "change_order" ? "change_order" : "quote",
    committed: committed, billed: billed, approved: approved, paid: paid,
    outstanding: approved - paid,
    pctBilled: numOrNull(row.pct_billed) !== null ? Number(row.pct_billed) : committed > 0 ? (billed / committed) * 100 : null,
    pctPaid: numOrNull(row.pct_paid) !== null ? Number(row.pct_paid) : committed > 0 ? (paid / committed) * 100 : null,
    overBilled: flag(["over_billed", "overbilled"], committed > 0 && billed > committed),
    overBilledBy: numOrNull(row.over_billed_by) !== null ? Number(row.over_billed_by) : committed > 0 ? Math.max(0, billed - committed) : 0,
    overPaid: flag(["over_paid", "overpaid"], paid > approved + 0.005),
    paidUnapproved: num(pick(row, ["paid_unapproved", "paidunapproved"])),
    waitingCount: num(pick(row, ["waiting_count", "bills_waiting", "waiting"])),
    billCount: num(pick(row, ["bill_count", "bills"])),
  };
}

export function toPmTask(row, ctx) {
  const c = ctx || {};
  const mask = c.mask || ident;
  const nameOf = c.nameOf || function () { return ""; };
  const done = trim(row.status).toLowerCase() === "done";
  return {
    id: row.id, itemId: row.estimate_item_id == null ? null : row.estimate_item_id,
    title: mask(trim(row.title)) || "Task", description: mask(trim(row.description)),
    category: trim(row.category), assignee: nameOf(row.assigned_to) || (row.assigned_to ? "" : "(unassigned)"),
    done: done, urgent: !done && trim(row.priority).toLowerCase() === "urgent",
    requested: dayOf(row.created_at), completed: dayOf(row.completed_at),
  };
}

/** An item's document; its name is typed words too (masked without prices, as on the Files tab and in search). */
export function toItemFile(row, ctx) {
  const mask = (ctx && ctx.mask) || ident;
  return {
    id: row.id, itemId: row.estimate_item_id, name: mask(trim(row.name)) || "(file)", storage: row.storage === "local" ? "local" : "cloud",
    path: row.storage_path || null, size: num(row.size), day: dayOf(row.modified_at || row.created_at),
  };
}

/** The whole chart payload. rows: {project, activity, estimates, items, totals, itemPrices, flags, quotes, contacts,
    takeoffs, bills, invoices, costs, commitments, tasks, files}; ctx: {today, prices, money, nameOf, mask}. */
export function toPayload(rows, ctx) {
  const r = rows || {};
  const c = Object.assign({}, ctx || {});
  // without the prices switch the words people typed are masked even when the caller forgot to say so (Q28)
  if (typeof c.mask !== "function") c.mask = c.prices ? ident : function (t) { return maskAmounts(t == null ? "" : String(t)); };
  if (typeof c.nameOf !== "function") c.nameOf = function () { return ""; };
  const prices = !!c.prices;
  const money = prices && !!c.money;
  const mask = c.mask;
  const p = r.project || {};

  const contacts = {};
  (r.contacts || []).forEach(function (x) { if (x && x.id != null) contacts[String(x.id)] = x; });
  const ests = liveEstimates(r.estimates);
  const estById = {};
  ests.forEach(function (e) { estById[String(e.id)] = e; });
  const totalOf = {}, quotedOf = {}, pricedOf = {};
  // "priced" is the database's (estimate_item_totals.priced, M5a): the same yes / no for every reader
  (r.totals || []).forEach(function (t) { if (typeof t.priced === "boolean") pricedOf[String(t.item_id)] = t.priced; });
  if (prices) {
    (r.totals || []).forEach(function (t) { totalOf[String(t.item_id)] = numOrNull(t.total); });
    (r.itemPrices || []).forEach(function (t) { quotedOf[String(t.item_id)] = numOrNull(t.quoted_price); });
  }
  // one flag per item on the chart; were there ever several, the loudest wins (blocked, important, complete)
  const flagOf = {};
  const RANK = { blocked: 0, important: 1, complete: 2 };
  (r.flags || []).forEach(function (f) {
    const x = toFlag(f, c);
    if (!x) return;
    const k = String(f.item_id), cur = flagOf[k];
    if (!cur || RANK[x.state] < RANK[cur.state]) flagOf[k] = x;
  });
  const takeoffOf = {};
  (r.takeoffs || []).forEach(function (t) {
    if (t.estimate_item_id == null) return;
    const k = String(t.estimate_item_id);
    const cur = takeoffOf[k] || { lines: 0, names: [] };
    cur.lines += Array.isArray(t.takeoff_rows) ? t.takeoff_rows.length : num(t.rows);
    if (trim(t.name)) cur.names.push(mask(trim(t.name)));
    takeoffOf[k] = cur;
  });

  const byEstimate = {};
  (r.items || []).forEach(function (it) {
    if (!it || it.deleted_at || !estById[String(it.estimate_id)]) return;
    (byEstimate[String(it.estimate_id)] = byEstimate[String(it.estimate_id)] || []).push(it);
  });
  const items = [];
  ests.forEach(function (e) {
    const ordered = orderItems(byEstimate[String(e.id)] || [], e.group_order);
    // a group's name is its first item's spelling (estimate_order.py), whatever case or spaces the others typed
    const groupNameOf = Object.create(null);
    ordered.forEach(function (it) { const k = groupKey(it.group_name); if (!(k in groupNameOf)) groupNameOf[k] = cleanName(it.group_name); });
    ordered.forEach(function (it) {
      const k = String(it.id);
      const total = prices && k in totalOf ? totalOf[k] : null;
      const quoted = prices && k in quotedOf ? quotedOf[k] : null;
      const who = contactName(it.contact || (it.assigned_contact_id != null ? contacts[String(it.assigned_contact_id)] : null)) || trim(it.assigned_text);
      const type = trim(it.item_type) || "both";
      // priced: the database's yes / no (a total or a quoted price above zero - every reader gets the same one), or its
      // estimate went to the client (everyone can tell that); a database without the column: the prices person's figures
      const hasPrice = k in pricedOf ? pricedOf[k] : (prices && ((total || 0) > 0 || (quoted || 0) > 0));
      items.push({
        key: "i" + it.id, itemId: it.id, estimateId: e.id, estimateName: mask(estimateName(e)), estimateKind: e.kind || "estimate",
        estimateStatus: e.status || "draft",
        groupName: mask(groupNameOf[groupKey(it.group_name)] || ""), name: mask(cleanName(it.name)) || "(unnamed item)",
        // how the project log names the item (a quick note): the database's scrub rule for every role - never an amount,
        // never a display mask stored for everyone (P5 check 5)
        logName: scrubMoney(cleanName(it.name)) || "(unnamed item)",
        assignees: who ? [{ name: mask(who) }] : [],
        priced: hasPrice || e.status === "sent" || e.status === "approved",
        estTotal: prices ? total : null, quotedPrice: prices ? quoted : null,
        laborNames: type !== "material" && trim(it.description) ? [mask(cleanName(it.description))] : [],
        materialNames: type !== "labor" && type !== "sub" && trim(it.material_description) ? [mask(cleanName(it.material_description))] : [],
        flag: flagOf[k] || null,
        takeoff: takeoffOf[k] || null,
      });
    });
  });

  return {
    project: {
      id: p.id, number: trim(p.number), name: trim(p.name), address: trim(p.address), city: trim(p.city),
      client: trim(p.client_name), status: trim(p.status), statusNote: mask(trim(p.status_note)), plansUrl: trim(p.plans_url),
      createdDay: dayOf(p.created_at), completedDate: DAY_RE.test(String(p.completed_date || "")) ? String(p.completed_date) : "",
      version: p.version == null ? 1 : Number(p.version),
    },
    today: c.today || ymd(new Date()),
    statusDates: statusDates(r.activity),
    items: items,
    quotes: Array.isArray(r.quotes) ? r.quotes.map(function (q) { return toQuote(q, Object.assign({}, c, { prices: prices, contacts: contacts })); }) : null,
    bills: money && Array.isArray(r.bills)
      ? r.bills.filter(function (b) { return !b.void && !b.deleted_at; }).map(function (b) { return toBill(b, c); }) : null,
    invoices: money && Array.isArray(r.invoices)
      ? r.invoices.filter(function (i) { return i.status !== "void" && !i.deleted_at; }).map(toInvoice) : null,
    costs: money && Array.isArray(r.costs) ? r.costs.map(toCost) : null,
    commitments: money && Array.isArray(r.commitments) ? r.commitments.map(toCommitment) : null,
    tasks: (r.tasks || []).map(function (t) { return toPmTask(t, c); }),
    files: (r.files || []).filter(function (f) { return f.estimate_item_id != null; }).map(function (f) { return toItemFile(f, c); }),
    pricesHidden: !prices,
    moneyHidden: !money,
  };
}

/** The payload with every amount taken out: what a worksite copy is drawn from. The money fields go, and every word
    people typed is masked AGAIN - a price person's payload carries their words as typed ("credit asked $1,200"), and
    the worksite copy promises no price at all (as the estimate's worksite copy and DCR Desktop 2's printing do). */
export function worksitePayload(p) {
  const m = function (t) { return maskAmounts(t == null ? "" : String(t)); };
  const all = function (list) { return (list || []).map(m); };
  const pj = p.project || {};
  return Object.assign({}, p, {
    pricesHidden: true, moneyHidden: true, bills: null, invoices: null, costs: null, commitments: null,
    project: p.project ? Object.assign({}, pj, { name: m(pj.name), address: m(pj.address), city: m(pj.city), client: m(pj.client),
      statusNote: m(pj.statusNote) }) : p.project,
    items: (p.items || []).map(function (it) {
      return Object.assign({}, it, {
        estTotal: null, quotedPrice: null,
        name: m(it.name), groupName: m(it.groupName), estimateName: m(it.estimateName),
        assignees: (it.assignees || []).map(function (a) { return Object.assign({}, a, { name: m(a.name) }); }),
        laborNames: all(it.laborNames), materialNames: all(it.materialNames),
        flag: it.flag ? Object.assign({}, it.flag, { note: m(it.flag.note) }) : it.flag,
        takeoff: it.takeoff ? Object.assign({}, it.takeoff, { names: all(it.takeoff.names) }) : it.takeoff,
      });
    }),
    quotes: Array.isArray(p.quotes) ? p.quotes.map(function (q) {
      const x = Object.assign({}, q, { notes: "", documentUrl: "", vendor: m(q.vendor) });
      delete x.amount;
      return x;
    }) : p.quotes,
    tasks: (p.tasks || []).map(function (t) { return Object.assign({}, t, { title: m(t.title), description: m(t.description) }); }),
    files: (p.files || []).map(function (f) { return Object.assign({}, f, { name: m(f.name) }); }),
  });
}

/* ── who may do what on this page (hiding controls only; the database decides every write) ── */
function active(me) { return !!me && me.active !== false && me.role && me.role !== "agents"; }
/** prices switch (admin always) */
export function seesPrices(me) { return active(me) && (me.role === "admin" || !!me.can_see_prices); }
/** the money tiles: prices AND financials */
export function seesMoney(me) { return seesPrices(me) && (me.role === "admin" || !!me.can_see_financials); }
/** item flags: estimate editors and leads (M5a) */
export function canFlag(me) { return active(me) && ["admin", "manager", "lead"].indexOf(me.role) !== -1; }
/** a quote follow-up: whoever may edit quotes (app.can_edit('quotes')) */
export function canFollowUp(me) {
  return active(me) && (me.role === "admin" || ((me.role === "manager" || me.role === "accountant") && !!me.can_see_prices));
}
/** the project's stage (projects editors) */
export function canStatus(me) { return active(me) && (me.role === "admin" || me.role === "manager"); }
/** a quick note to the project log (activity area) */
export function canNote(me) { return active(me) && ["admin", "manager", "accountant", "lead"].indexOf(me.role) !== -1; }

/** A flag as the database takes it: the state, the note (trimmed, at most 300 characters), the due date. */
export function cleanFlag(state, note, due) {
  if (FLAG_STATES.indexOf(state) === -1) throw Object.assign(new Error("That is not an item flag."), { code: "22023", status: 400 });
  const n = String(note == null ? "" : note).replace(/\s+/g, " ").trim().slice(0, FLAG_NOTE_MAX);
  const d = String(due == null ? "" : due).trim();
  if (d && !DAY_RE.test(d)) throw Object.assign(new Error("The due date must be a date."), { code: "22023", status: 400 });
  return { state: state, note: n || null, due_date: d || null };
}

/** The follow-up mail: subject and body (no amount: the vendor sees our words, nobody's price - an amount typed into
    the item's or the project's name is masked, as DCR Desktop 2 masks the scope of a quote request). */
export function followUpMail(project, lane, q) {
  const m = function (t) { return maskAmounts(t == null ? "" : String(t)); };
  const pj = project || {};
  const item = m((lane && lane.name) || "");
  const subj = "Follow-up: quote request — " + m([pj.number, pj.name].filter(Boolean).join(" ")) + " — " + item;
  const body = "Hello" + (q && q.vendor && q.vendor !== "(vendor)" ? " " + q.vendor : "") + ",\n\n" +
    "Following up on our quote request for " + (item || "the work") + (pj.address ? " at " + m(pj.address) + (pj.city ? ", " + pj.city : "") : "") +
    (q && q.requestedDate ? " (sent " + q.requestedDate + ")" : "") + ". Could you let us know when we can expect it?\n\nThank you,";
  return { subject: subj, body: body };
}
