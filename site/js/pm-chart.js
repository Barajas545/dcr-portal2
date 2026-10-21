/* The Progress Chart engine (port of the old portal's pm-chart.js; MODULES §5a "pm.html, report-pm.html").
   Pure: no fetch, no DOM events. Shared by pm.html (live) and report-pm.html (print), so every rule about
   what a node MEANS lives here and nowhere else.

     derive(payload, prefs) -> model      layout(model, opts) -> geometry      svg(model, layout, opts) -> text

   The shape is the old one: a milestone spine for the workflow the office runs
     Plans received → Setup → Estimating → Estimate sent → Follow-up → Accepted → Complete
   with the estimate items fanning out in parallel twice - once while quotes come in (region A: Requested →
   Quotes in → Priced), once while the work runs (region B: Awarded → Billed to us → Approved → Paid out →
   Invoiced → Collected). A PERT-style network, not a schedule: the percentages are completion of tracked
   facts, not dates.

   What changed with DCR Desktop 2's data (BLUEPRINT 3.3.11 "Progress Chart (PM)", M5a):
   * the project's status is Desktop 2's word (new_request … follow_up); the status-to-milestone map is
     STATUS_IDX below, and the milestone dates come from the status rows of the project log (payload
     .statusDates, worked out by map/pm.js), not from parsing "Status changed: X → Y" text;
   * a lane is ONE estimate item (estimate_items; quotes, bills, costs, tasks, takeoffs and the item flags
     of M5a all hang off an item), coloured by its group, ordered as the estimate orders it;
   * quotes and change orders are read by everyone (Q11) - their amounts only with the prices switch
     (quote_prices); the money tiles (bills, payments, invoices, quote_commitments) only for someone who may
     see both prices and financials. Without them the tiles are not drawn at all: a lead sees "Awarded"
     and the item flags, never an amount, never a percentage an amount could be worked back from
     (BLUEPRINT 2.1 principle 8);
   * the company day (payload.today, America/Los_Angeles) is "today" everywhere: a quote's age, an
     overdue flag, an overdue bill.

   Pure module: node tests import it. */

import { statusColor, statusLabel } from "./map/status.js";

/* How long a quote may sit unanswered before the chart asks about it. Two weeks is a starting point, not
   a rule of the trade - it is one number in one place so it can be argued with. */
export const QUOTE_CHASE_DAYS = 14;

/* ── status → milestone index (Desktop 2's words; on_hold is "known: no") ── */
export const STATUS_IDX = Object.freeze({
  new_request: 2,
  estimating: 3,
  sent: 4,
  follow_up: 5,
  approved: 6, in_progress: 6,
  completed: 7, closed: 7,
});
/* the status each middle milestone is reached by (its date: when the project last moved there) */
export const MS_STATUS = Object.freeze({ 2: "new_request", 3: "estimating", 4: "sent", 5: "follow_up", 6: "approved" });
export const MS_DEFS = Object.freeze([
  { n: 1, label: "Plans received" },
  { n: 2, label: "Setup" },
  { n: 3, label: "Estimating" },       // region A hangs here
  { n: 4, label: "Estimate sent" },
  { n: 5, label: "Follow-up" },
  { n: 6, label: "Accepted" },         // region B hangs here
  { n: 7, label: "Complete" },
]);
/* The next stage from the milestone popover (projects editors only; the database decides). */
export const NEXT_STATUS = Object.freeze({
  new_request: "estimating", estimating: "sent", sent: "approved", follow_up: "approved",
  approved: "in_progress", in_progress: "completed",
});

/* The tiles each region fans into: the whole vocabulary of the chart, in one place. `kind` is WHAT A TILE
   IS; the node's own state is HOW IT IS GOING. `money` tiles exist only for someone who may see prices
   and financials. */
export const A_NODES = Object.freeze([
  { key: "A0", label: "Requested", kind: "quote" },
  { key: "A1", label: "Quotes in", kind: "quote" },
  { key: "A2", label: "Priced", kind: "price" },
]);
export const B_NODES = Object.freeze([
  { key: "B1", label: "Awarded", kind: "award" },
  { key: "B2", label: "Billed to us", kind: "cost", money: true },
  { key: "B3", label: "Approved", kind: "cost", money: true },
  { key: "B4", label: "Paid out", kind: "cost", money: true },
  { key: "B5", label: "Invoiced", kind: "income", money: true },
  { key: "B6", label: "Collected", kind: "income", money: true },
]);
export const NODE_DEFS = Object.freeze(A_NODES.concat(B_NODES).reduce(function (m, d) { m[d.key] = d; return m; }, {}));
/* Money out is not the same colour as money in, and neither is the same as asking a vendor what something
   costs. */
export const KIND_COLOR = Object.freeze({
  quote: "#8e6fd8", price: "#2f80d8", award: "#d6a13a", cost: "#d9614f", income: "#2fa679",
});
export const KIND_LABEL = Object.freeze({
  quote: "Quote requests", price: "Our price", award: "Awarded", cost: "Money out · subs & bills", income: "Money in · client",
});
export const FLAG_STATES = Object.freeze(["blocked", "complete", "important"]);

export function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/* Two forms, deliberately. `compact` is for the chart chips, where a node is ~130px wide and "$12k" is all
   that fits. Everywhere a figure is read as money - the tiles, the quote rows, the printed report - it is
   exact to the cent. */
export function money(n, compact) {
  if (n == null || n === "" || !isFinite(Number(n))) return "";
  n = Number(n);
  if (compact) {
    const a = Math.abs(n);
    if (a >= 1000000) return "$" + (Math.round(n / 100000) / 10) + "M";
    if (a >= 10000) return "$" + Math.round(n / 1000) + "k";
    if (a >= 1000) return "$" + (Math.round(n / 100) / 10) + "k";
    return "$" + Math.round(n);
  }
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Stable group-identity colour slot (0..7). The 8 hues live in CSS as --gc0..--gc7; the group NAME is always
// printed beside the colour, never colour alone.
export function groupSlot(name) {
  const s = String(name || "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 8;
}

// Deterministic avatar tint for a person (identity, not status).
export function avatarColor(name) {
  let h = 0;
  const s = String(name || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return "hsl(" + (h % 360) + ",45%,45%)";
}

// SVG has no text-overflow, so clip by an estimated advance width.
export function clip(str, maxPx, fontPx) {
  const s = String(str == null ? "" : str);
  const max = Math.max(3, Math.floor(maxPx / (fontPx * 0.55)));
  return s.length > max ? s.slice(0, max - 1).replace(/[\s·]+$/, "") + "…" : s;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;
function dayNum(v) {
  const m = DAY_RE.exec(String(v || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null;
}
/** Whole company days from `day` to `today` (both "YYYY-MM-DD"); null when either is missing. */
export function daysBetween(day, today) {
  const a = dayNum(day), b = dayNum(today);
  return a === null || b === null ? null : Math.round(b - a);
}
/** "10/7/26" for a "YYYY-MM-DD" (taken as written: never through the browser's zone). */
export function fmtDay(day) {
  const m = DAY_RE.exec(String(day || ""));
  return m ? (+m[2]) + "/" + (+m[3]) + "/" + m[1].slice(2) : "";
}

function num(v) { return v === null || v === undefined || v === "" || !isFinite(Number(v)) ? 0 : Number(v); }
function firstWord(s) { return String(s || "").trim().split(/\s+/)[0] || ""; }
function answered(q) { return q.status === "received" || q.status === "awarded" || q.status === "declined" || !!q.receivedDate; }

/* ── derive ──────────────────────────────────────────────────────────── */
export function derive(payload, prefs) {
  prefs = prefs || {};
  const P = payload || {};
  const p = P.project || {};
  const today = String(P.today || "").slice(0, 10);
  const status = String(p.status || "").trim();
  const idx = STATUS_IDX[status];
  const onHold = status === "on_hold";
  const known = idx !== undefined;
  const effIdx = known ? idx : 0;
  // Amounts only with the prices switch; the money tiles only with prices AND financials (principle 8).
  const hidden = !!P.pricesHidden;
  const showMoney = !hidden && !P.moneyHidden && Array.isArray(P.bills);
  const statusDates = Object.assign({}, P.statusDates || {});
  const reached = function (st) { return !!statusDates[st]; };

  const msDates = {
    1: p.createdDay || "", 2: statusDates.new_request || "", 3: statusDates.estimating || "",
    4: statusDates.sent || "", 5: statusDates.follow_up || "", 6: statusDates.approved || statusDates.in_progress || "",
    7: statusDates.completed || p.completedDate || statusDates.closed || "",
  };
  const milestones = MS_DEFS.map(function (d) {
    const done =
      d.n === 1 ? true :
      d.n === 7 ? effIdx >= 7 :
      (effIdx > d.n || (!known && reached(MS_STATUS[d.n])));
    return {
      n: d.n, label: d.label, done: done,
      current: !done && known && !onHold && effIdx === d.n && d.n !== 3 && d.n !== 6,
      date: msDates[d.n] ? fmtDay(msDates[d.n]) : "",
    };
  });

  /* ── lanes: one per estimate item ── */
  const items = P.items || [];
  const quotes = Array.isArray(P.quotes) ? P.quotes : null;
  const bills = showMoney ? P.bills : null;
  const invoices = showMoney && Array.isArray(P.invoices) ? P.invoices : null;
  const commitments = showMoney && Array.isArray(P.commitments) ? P.commitments : null;
  const laneOfItem = {};
  items.forEach(function (it) { laneOfItem[String(it.itemId)] = it.key; });
  const quoteItem = {};
  (quotes || []).forEach(function (q) { quoteItem[String(q.id)] = q.itemId == null ? null : String(q.itemId); });

  const quotesBy = {}, billsBy = {}, invoicesBy = {};
  const unlinkedQuotes = [], unlinkedBills = [];
  items.forEach(function (it) { quotesBy[it.key] = []; billsBy[it.key] = []; invoicesBy[it.key] = []; });
  (quotes || []).forEach(function (q) {
    const k = q.itemId == null ? null : laneOfItem[String(q.itemId)];
    if (k) quotesBy[k].push(q); else unlinkedQuotes.push(q);
  });
  /* A bill lands on its item, else on the item of the quote it is billed against; anything else is money
     owed on this project that is not attached to an item - kept and surfaced, never dropped. */
  (bills || []).forEach(function (b) {
    let k = b.itemId == null ? null : laneOfItem[String(b.itemId)];
    if (!k && b.quoteId != null && quoteItem[String(b.quoteId)]) k = laneOfItem[quoteItem[String(b.quoteId)]];
    if (k) billsBy[k].push(b); else unlinkedBills.push(b);
  });
  /* Money in is invoiced per ESTIMATE (invoice lines carry the estimate), so every item of an estimate on
     an invoice shares that invoice. */
  (invoices || []).forEach(function (iv) {
    const ests = (iv.estimateIds || []).map(String);
    items.forEach(function (it) { if (ests.indexOf(String(it.estimateId)) !== -1) invoicesBy[it.key].push(iv); });
  });

  /* The clock runs from the last time somebody CHASED the vendor, not from when the request went out:
     the follow-up restarts it, so a quote still ignored two weeks after the chase shouts again by itself. */
  function waitingDays(q) {
    if (answered(q)) return null;
    return daysBetween(q.lastFollowUp || q.requestedDate, today);
  }
  function vendorShort(q) { return firstWord(q.vendor); }

  const lanes = items.map(function (it) {
    const qs = quotesBy[it.key] || [];
    const requests = qs.filter(function (q) { return q.status !== "self"; });
    const hasSelf = qs.some(function (q) { return q.status === "self"; });
    const awardedRows = qs.filter(function (q) { return q.status === "awarded"; });
    const selfOnly = hasSelf && !awardedRows.length;
    const nAnswered = requests.filter(answered).length;
    const overdue = requests.some(function (q) { const d = waitingDays(q); return d != null && d > QUOTE_CHASE_DAYS; });
    const chases = requests.reduce(function (n, q) { return n + num(q.followUps); }, 0);
    let awarded = 0;
    const awardedNames = [];
    awardedRows.forEach(function (q) {
      if (!hidden) awarded += num(q.amount);
      const nm = firstWord(q.vendor);
      if (nm) awardedNames.push(nm);
    });
    const estTotal = hidden ? null : (it.estTotal == null ? null : num(it.estTotal));
    const quotedPrice = hidden ? null : (it.quotedPrice == null ? null : num(it.quotedPrice));

    /* Money out for this item, from the bills actually received: `billed` is what was invoiced to us,
       `approvedAmt` the part somebody authorized, `paidOut` what has left. */
    const laneBills = billsBy[it.key] || [];
    let billed = 0, approvedAmt = 0, paidOut = 0, waiting = 0, owed = 0, overdueBill = false;
    laneBills.forEach(function (b) {
      const amt = num(b.amount);
      billed += amt;
      paidOut += num(b.paid);
      if (b.approved) { approvedAmt += num(b.approvedAmount) || amt; owed += num(b.owed); }
      else waiting += 1;
      if (b.dueDate && today && String(b.dueDate) < today && num(b.owed) > 0) overdueBill = true;
    });
    const hasBills = laneBills.length > 0;

    /* Money in: the client invoices that carry this item's estimate. An invoice past its due date with
       nothing against it is the one a project manager chases. */
    const laneInvoices = invoicesBy[it.key] || [];
    const sentInv = laneInvoices.filter(function (iv) { return iv.status === "sent" || iv.status === "paid"; });
    const paidInv = laneInvoices.filter(function (iv) { return iv.status === "paid"; });
    const overdueInv = sentInv.some(function (iv) { return iv.status !== "paid" && iv.dueDate && today && String(iv.dueDate) < today; });
    const partInv = sentInv.some(function (iv) { return iv.status !== "paid" && num(iv.paid) > 0; });

    function st(node) {
      /* A0 - the request went out. "Nobody asked" and "three asked, none answered" are opposite problems:
         one is your move, the other is theirs. */
      if (node === "A0") {
        if (quotes === null) return { s: "na", chip: "—" };
        if (!requests.length) {
          if (hasSelf) return { s: "skipped", chip: "Self" };
          if (it.priced) return { s: "skipped", chip: "" };
          return { s: "notStarted", chip: "none sent" };
        }
        const dated = requests.filter(function (q) { return q.requestedDate; });
        const names = requests.map(vendorShort).filter(Boolean);
        const who = names.length ? " · " + names[0] + (names.length > 1 ? " +" + (names.length - 1) : "") : "";
        const chased = chases ? " · chased" + (chases > 1 ? " ×" + chases : "") : "";
        if (overdue) {
          let waited = 0;
          requests.forEach(function (q) { const d = waitingDays(q); if (d != null && d > waited) waited = d; });
          return { s: "attention", chip: requests.length + " sent" + chased + " · " + waited + "d" };
        }
        if (dated.length >= requests.length) return { s: "done", chip: requests.length + " sent" + (chased || who) };
        return { s: "inProgress", chip: dated.length + " of " + requests.length + " sent" };
      }
      if (node === "A1") {
        if (quotes === null) return { s: "na", chip: "—" };
        if (!requests.length) {
          if (hasSelf || it.priced) return { s: "skipped", chip: hasSelf ? "Self" : "" };
          return { s: "notStarted", chip: "no quotes" };
        }
        if (nAnswered >= requests.length) return { s: "done", chip: requests.length + " in" };
        if (overdue) return { s: "attention", chip: nAnswered + " of " + requests.length + " in" };
        return { s: "inProgress", chip: nAnswered + " of " + requests.length + " in" };
      }
      if (node === "A2") {
        if (it.priced) {
          const v = estTotal || quotedPrice;
          return { s: "done", chip: hidden || !v ? "priced" : money(v, true) };
        }
        const a1 = st("A1");
        if (a1.s === "done" || a1.s === "skipped") return { s: "inProgress", chip: "price it" };
        return { s: "notStarted", chip: "" };
      }
      if (node === "B1") {
        if (awardedRows.length) {
          return { s: "done", chip: (!hidden && awarded > 0 ? money(awarded, true) + " " : "") +
            (awardedNames[0] || "") + (awardedRows.length > 1 ? " ×" + awardedRows.length : "") };
        }
        if (selfOnly) return { s: "done", chip: "Self" };
        if (effIdx >= 6) return { s: "inProgress", chip: "pick vendor" };
        return { s: "notStarted", chip: "" };
      }
      if (!showMoney) return { s: "na", chip: "—" };       // never drawn without the money switches
      if (node === "B2") {
        if (selfOnly && !hasBills) return { s: "skipped", chip: "" };
        const b1 = st("B1");
        if (b1.s !== "done" && !hasBills) return { s: "notStarted", chip: "" };
        if (hasBills) {
          const label = money(billed, true) + (laneBills.length > 1 ? " ×" + laneBills.length : "");
          if (awarded > 0 && billed > 1.001 * awarded) return { s: "attention", chip: label + " over" };
          return { s: "done", chip: label };
        }
        return { s: "inProgress", chip: "no invoice" };
      }
      /* B3 - authorized to pay: is money sitting here that nobody has signed off? */
      if (node === "B3") {
        if (!hasBills) return selfOnly ? { s: "skipped", chip: "" } : { s: "notStarted", chip: "" };
        if (waiting) return { s: "attention", chip: waiting + " waiting" };
        return { s: "done", chip: money(approvedAmt, true) };
      }
      if (node === "B4") {
        if (!hasBills) return selfOnly ? { s: "skipped", chip: "" } : { s: "notStarted", chip: "" };
        if (approvedAmt > 0 && paidOut >= 0.999 * approvedAmt && !waiting) return { s: "done", chip: money(paidOut, true) };
        if (overdueBill) return { s: "attention", chip: money(owed, true) + " overdue" };
        if (owed > 0) return { s: "inProgress", chip: money(owed, true) + " due" };
        return { s: "notStarted", chip: "" };
      }
      /* B5 / B6 - what we asked the client for, and what arrived. Invoiced per estimate, so the chips name
         the invoices rather than an amount that would really be the whole estimate's. */
      if (node === "B5") {
        if (invoices === null) return { s: "na", chip: "—" };
        if (!laneInvoices.length) return { s: "notStarted", chip: "" };
        if (!sentInv.length) return { s: "inProgress", chip: laneInvoices.length + " draft" };
        return { s: "done", chip: sentInv.length === 1 ? (sentInv[0].number || "1 sent") : sentInv.length + " sent" };
      }
      if (node === "B6") {
        if (invoices === null) return { s: "na", chip: "—" };
        if (!sentInv.length) return { s: "notStarted", chip: "" };
        if (paidInv.length >= sentInv.length) return { s: "done", chip: "collected" };
        if (overdueInv) return { s: "attention", chip: "overdue" };
        if (partInv || paidInv.length) return { s: "inProgress", chip: "part paid" };
        return { s: "inProgress", chip: "unpaid" };
      }
      return { s: "notStarted", chip: "" };
    }

    const nodes = {};
    A_NODES.concat(B_NODES).forEach(function (d) { nodes[d.key] = st(d.key); });
    const flag = it.flag || null;
    /* "Complete" on site closes the item's own steps - but not the client's money (B5 / B6: invoiced per estimate,
       which the flag does not control: an overdue invoice stays "⚠ overdue"), and a step it closes loses the chip of
       the state it had ("price it", "2 waiting" under a ✓ would contradict itself). */
    if (flag && flag.state === "complete") {
      Object.keys(nodes).forEach(function (k) {
        if (k === "B5" || k === "B6") return;
        const n = nodes[k];
        if (n.s !== "skipped" && n.s !== "na" && n.s !== "done") nodes[k] = { s: "done", chip: "" };
      });
    }
    let pctA = (it.priced || nodes.A1.s === "skipped") ? 100 : nodes.A1.s === "done" ? 60 : requests.length ? 30 : 0;
    if (it.priced) pctA = 100;
    /* Execution progress in four equal steps: awarded, billed, approved, paid - with the money switches.
       Without them only the award is known: a quarter, all of it once the project is complete. */
    let pctB = 0;
    if (awardedRows.length || selfOnly || hasBills) {
      pctB = 25;
      if (showMoney && hasBills) {
        pctB += 25 * Math.min(1, awarded > 0 ? billed / awarded : 1);
        if (billed > 0) pctB += 25 * Math.min(1, approvedAmt / billed);
        if (approvedAmt > 0) pctB += 25 * Math.min(1, paidOut / approvedAmt);
      } else if (!showMoney && effIdx >= 7) {
        pctB = 100;
      }
    }
    if (flag && flag.state === "complete") { pctA = 100; pctB = 100; }
    const attention = Boolean((!flag || flag.state !== "complete") &&
      (overdue || nodes.B2.s === "attention" || nodes.B3.s === "attention" || nodes.B4.s === "attention" ||
        nodes.B6.s === "attention" || (flag && (flag.state === "blocked" || flag.state === "important"))));

    const assignees = (it.assignees || []).filter(function (a) { return a && a.name; });
    let initials = "";
    if (assignees.length) {
      const words = String(assignees[0].name).trim().split(/[\s@]+/);
      initials = ((words[0] ? words[0][0] : "") + (words[1] ? words[1][0] : "")).toUpperCase();
    }

    return {
      key: it.key, itemId: it.itemId, estimateId: it.estimateId, estimateName: it.estimateName || "",
      estimateKind: it.estimateKind || "estimate", groupName: it.groupName || "", name: it.name || "(unnamed item)",
      assignees: assignees, initials: initials,
      estTotal: estTotal, quotedPrice: quotedPrice, priced: !!it.priced,
      laborNames: it.laborNames || [], materialNames: it.materialNames || [],
      colorSlot: groupSlot(it.groupName || it.name), takeoff: it.takeoff || null,
      quotes: qs, requests: requests.length, awarded: hidden ? null : awarded,
      bills: laneBills, billed: billed, approvedAmt: approvedAmt, paidOut: paidOut, owed: owed, waiting: waiting,
      overdueBill: overdueBill, invoices: laneInvoices,
      nodes: nodes, pctA: pctA, pctB: Math.round(pctB), flag: flag, attention: attention,
    };
  });

  // region roll-up
  const n = lanes.length;
  const pctA = n ? Math.round(lanes.reduce(function (s, l) { return s + l.pctA; }, 0) / n) : (effIdx >= 4 ? 100 : 0);
  let pctB;
  if (!n) pctB = effIdx >= 7 ? 100 : 0;
  else if (showMoney) {
    let wTot = 0, wSum = 0;
    lanes.forEach(function (l) { const w = l.estTotal || 0; wTot += w; wSum += w * l.pctB; });
    pctB = wTot > 0 ? Math.round(wSum / wTot) : Math.round(lanes.reduce(function (s, l) { return s + l.pctB; }, 0) / n);
  } else {
    pctB = Math.round(lanes.reduce(function (s, l) { return s + l.pctB; }, 0) / n);
  }

  const msDone = {};
  milestones.forEach(function (m) { msDone[m.n] = m.done ? 100 : 0; });
  const overall = Math.round(
    (msDone[1] * 4 + msDone[2] * 6 + pctA * 25 + msDone[4] * 5 + msDone[5] * 10 + pctB * 45 + msDone[7] * 5) / 100
  );

  // expansion defaults by phase; the person's own choice wins
  let expandedA = prefs.expandedA !== undefined ? prefs.expandedA : effIdx <= 4 && effIdx >= 2;
  let expandedB = prefs.expandedB !== undefined ? prefs.expandedB : effIdx >= 6 && effIdx < 7;
  if (!known) {
    expandedA = prefs.expandedA !== undefined ? prefs.expandedA : true;
    expandedB = prefs.expandedB !== undefined ? prefs.expandedB : false;
  }

  let pulseAt = null;
  if (known && !onHold) {
    if (!milestones[1].done) pulseAt = "M2";
    else if (pctA < 100 && effIdx === 3) pulseAt = "bandA";
    else if (!milestones[3].done) pulseAt = effIdx === 3 ? "bandA" : "M4";
    else if (effIdx === 4 || effIdx === 5) pulseAt = "M5";
    else if (effIdx === 6) pulseAt = "bandB";
    else if (!milestones[6].done) pulseAt = "M7";
  }

  // costs on this project that no estimate item accounts for (money view only)
  let unassignedCosts = 0;
  const unassignedRows = [];
  if (showMoney) {
    (P.costs || []).forEach(function (c) {
      if (c.itemId == null || !laneOfItem[String(c.itemId)]) { unassignedCosts += num(c.amount); unassignedRows.push(c); }
    });
  }

  const bNodes = showMoney ? B_NODES.slice() : B_NODES.filter(function (d) { return !d.money; });
  const doneB = lanes.filter(function (l) { return l.pctB >= 100; }).length;
  const totals = {
    estimate: hidden ? null : lanes.reduce(function (s, l) { return s + (l.estTotal || 0); }, 0),
    awarded: hidden ? null : lanes.reduce(function (s, l) { return s + (l.awarded || 0); }, 0),
    billed: showMoney ? lanes.reduce(function (s, l) { return s + l.billed; }, 0) : null,
    paidOut: showMoney ? lanes.reduce(function (s, l) { return s + l.paidOut; }, 0) : null,
  };
  return {
    project: p, status: status, statusLabel: status ? statusLabel(status) : "No status",
    statusColor: status ? statusColor(status) : null,
    onHold: onHold, known: known, idx: effIdx, today: today,
    milestones: milestones, lanes: lanes, aNodes: A_NODES.slice(), bNodes: bNodes,
    regions: {
      pctA: pctA, pctB: pctB, expandedA: expandedA, expandedB: expandedB,
      humanA: n ? lanes.filter(function (l) { return l.pctA >= 100; }).length + " of " + n + " items priced" : "no items",
      humanB: !n ? "no items"
        : showMoney && totals.awarded > 0
          ? money(totals.paidOut, true) + " of " + money(totals.awarded, true) + " paid to subs"
          : doneB + " of " + n + " items done",
    },
    overall: overall, pulseAt: pulseAt,
    pricesHidden: hidden, showMoney: showMoney,
    unlinkedQuotes: unlinkedQuotes, unlinkedBills: unlinkedBills,
    invoices: invoices, bills: bills, commitments: commitments,
    unassignedCosts: unassignedCosts, unassignedRows: unassignedRows,
    statusDates: statusDates, totals: totals,
    attentionCount: lanes.filter(function (l) { return l.attention; }).length,
  };
}

/* ── layout ──────────────────────────────────────────────────────────────
   Each expanded region carries its own item-identity column (colour, who it is assigned to, the item and
   its group, flags), so the item is legible right where its nodes are - no separate rail. */
export function layout(model, opts) {
  opts = opts || {};
  const compact = !!opts.compact;
  // Text is portal-normal size and never scaled: a bigger screen shows more of the chart, not larger type.
  const LANE_H = compact ? 44 : 62, NODE_H = compact ? 30 : 40, NODE_W = compact ? 112 : 132;
  const GAP = compact ? 16 : 22, MS_R = compact ? 16 : 18;
  // The print report opts out (labels:false): its chart is scaled to the page and the item table below
  // carries the same facts at full size.
  const withLabels = opts.labels !== false;
  const LABEL_W = withLabels ? (compact ? 330 : 380) : 0;
  const LEAD = withLabels ? LABEL_W + GAP : 0;
  const lanes = opts.lanes || model.lanes;
  const n = lanes.length;
  const aN = (model.aNodes || A_NODES).length, bN = (model.bNodes || B_NODES).length;
  const expA = model.regions.expandedA, expB = model.regions.expandedB;
  const spanOf = function (count) { return LEAD + count * NODE_W + (count - 1) * GAP; };
  const spanA = expA ? spanOf(aN) : 210;
  const spanB = expB ? Math.max(spanOf(bN), withLabels ? 0 : 210) : 210;
  const x = {};
  x.M1 = 62; x.M2 = 172; x.M3 = 282;          // room for "Plans received" left of the first circle
  x.Astart = x.M3 + 46;
  x.M4 = x.Astart + spanA + 56;
  x.M5 = x.M4 + 110; x.M6 = x.M5 + 110;
  x.Bstart = x.M6 + 46;
  x.M7 = x.Bstart + spanB + 56;
  const W = x.M7 + 70;
  // node columns, computed once so the combs and the nodes can never disagree
  const ax = x.Astart + LEAD, bx = x.Bstart + LEAD;
  const nodeX = {
    A: Array.from({ length: aN }, function (_, i) { return ax + i * (NODE_W + GAP); }),
    B: Array.from({ length: bN }, function (_, i) { return bx + i * (NODE_W + GAP); }),
  };
  const cy = 58, y0 = 168;   // room for the milestone label + date at body size
  const showLanes = (expA || expB) && n > 0;
  const H = showLanes ? y0 + n * LANE_H + 40 : y0 + 40;
  function laneY(i) { return y0 + i * LANE_H + LANE_H / 2; }
  return { x: x, W: W, H: H, cy: cy, y0: y0, laneY: laneY, LANE_H: LANE_H, NODE_H: NODE_H, NODE_W: NODE_W, GAP: GAP,
    MS_R: MS_R, compact: compact, LABEL_W: LABEL_W, nodeX: nodeX, showLanes: showLanes, lanes: lanes };
}

/* ── svg ─────────────────────────────────────────────────────────────── */
export function svg(model, L, opts) {
  opts = opts || {};
  const s = [];
  const x = L.x, cy = L.cy, MS = L.MS_R;
  const lanes = L.lanes, n = lanes.length;
  const expA = model.regions.expandedA, expB = model.regions.expandedB;
  const interactive = opts.interactive !== false;
  const aNodes = model.aNodes || A_NODES, bNodes = model.bNodes || B_NODES;
  const today = model.today || "";

  function attr(sel) { return interactive ? ' role="button" tabindex="0" data-pm="' + esc(sel) + '" style="cursor:pointer"' : ""; }

  s.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + L.W + '" height="' + L.H +
    '" viewBox="0 0 ' + L.W + " " + L.H + '" role="img" aria-label="Project progress network" font-family="system-ui,Segoe UI,Arial">');

  // region tints
  s.push('<rect x="' + (x.Astart - 10) + '" y="10" width="' + (x.M4 - x.Astart - 36) +
    '" height="' + (L.H - 20) + '" rx="10" fill="var(--tint)" opacity="' + (expA ? ".35" : ".18") + '"/>');
  s.push('<rect x="' + (x.Bstart - 10) + '" y="10" width="' + (x.M7 - x.Bstart - 36) +
    '" height="' + (L.H - 20) + '" rx="10" fill="rgba(47,166,121,.09)"' + (expB ? "" : ' opacity=".5"') + "/>");

  // spine segments
  const msX = [x.M1, x.M2, x.M3, x.M4, x.M5, x.M6, x.M7];
  for (let i = 0; i < 6; i++) {
    const a = msX[i], b = msX[i + 1];
    const mA = model.milestones[i], mB = model.milestones[i + 1];
    let col, dash = "";
    if (mB.done) col = "var(--ok)";
    else if (mB.current || mA.done) col = mA.done && (mB.current || model.pulseAt) ? "var(--acc)" : "var(--border)";
    else { col = "var(--border)"; dash = ' stroke-dasharray="4 4"'; }
    if (!mB.done && !mB.current && !mA.done) dash = ' stroke-dasharray="4 4"';
    s.push('<line x1="' + (a + MS) + '" y1="' + cy + '" x2="' + (b - MS) + '" y2="' + cy +
      '" stroke="' + col + '" stroke-width="2.5"' + dash + "/>");
  }

  // region trunks + lane stubs (comb edges, right angles only)
  function comb(anchorX, startX, endX, region, pct) {
    if (!L.showLanes || !(region === "A" ? expA : expB) || !n) return;
    const col = pct >= 100 ? "var(--ok)" : (model.pulseAt === "band" + region ? "var(--acc)" : "var(--border)");
    const lastY = L.laneY(n - 1);
    s.push('<path d="M ' + anchorX + " " + (cy + MS) + " L " + anchorX + " " + lastY + '" fill="none" stroke="' + col + '" stroke-width="1.5"/>');
    const conv = endX;
    s.push('<path d="M ' + conv + " " + lastY + " L " + conv + " " + (cy + MS) + '" fill="none" stroke="' + col + '" stroke-width="1.5"/>');
    s.push('<path d="M ' + (conv - 4) + " " + (cy + MS + 8) + " L " + conv + " " + (cy + MS) +
      " L " + (conv + 4) + " " + (cy + MS + 8) + '" fill="none" stroke="' + col + '" stroke-width="1.5"/>');
    const cols = L.nodeX[region];
    const lastRight = cols.length ? cols[cols.length - 1] + L.NODE_W : startX;
    for (let i = 0; i < n; i++) {
      const y = L.laneY(i);
      s.push('<line x1="' + anchorX + '" y1="' + y + '" x2="' + startX + '" y2="' + y + '" stroke="' + col + '" stroke-width="1.2"/>');
      s.push('<line x1="' + lastRight + '" y1="' + y + '" x2="' + conv + '" y2="' + y + '" stroke="' + col + '" stroke-width="1.2"/>');
    }
  }
  comb(x.M3, x.Astart, x.M4, "A", model.regions.pctA);
  comb(x.M6, x.Bstart, x.M7, "B", model.regions.pctB);

  // lane pass-through when both are expanded
  if (L.showLanes && expA && expB) {
    for (let pi = 0; pi < n; pi++) {
      const py = L.laneY(pi);
      s.push('<line x1="' + x.M4 + '" y1="' + py + '" x2="' + x.M6 + '" y2="' + py +
        '" stroke="var(--border)" stroke-width="1" stroke-dasharray="2 4"/>');
    }
  }

  // collapsed region aggregate nodes
  function aggregate(startX, region, pct, human) {
    if (region === "A" ? expA : expB) return;
    const w = 210, h = 38, y = cy - h / 2;
    s.push("<g" + attr("band:" + region) + '><rect x="' + startX + '" y="' + y + '" width="' + w +
      '" height="' + h + '" rx="10" fill="var(--surface)" stroke="' + (pct >= 100 ? "var(--ok)" : "var(--acc)") + '" stroke-width="1.5"/>');
    s.push('<text x="' + (startX + w / 2) + '" y="' + (cy - 3) + '" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)">' +
      esc((region === "A" ? "Bidding" : "Execution") + " · " + pct + "%") + "</text>");
    s.push('<text x="' + (startX + w / 2) + '" y="' + (cy + 12) + '" text-anchor="middle" font-size="12" fill="var(--text-muted)">' +
      esc(clip(human, w - 24, 12)) + " ▾</text></g>");
  }
  aggregate(x.Astart, "A", model.regions.pctA, model.regions.humanA);
  aggregate(x.Bstart, "B", model.regions.pctB, model.regions.humanB);

  // milestones
  let hintChip = "";
  model.milestones.forEach(function (m, i) {
    const mx = msX[i];
    const ring = m.done ? "var(--ok)" : m.current ? "var(--acc)" : "var(--border)";
    const rw = m.done ? 2.5 : m.current ? 3 : 1.5;
    s.push("<g" + attr("ms:" + m.n) + ">");
    if (model.pulseAt === "M" + m.n) {
      s.push('<circle cx="' + mx + '" cy="' + cy + '" r="' + MS + '" fill="none" stroke="var(--acc)" stroke-width="2" class="pm-pulse"/>');
    }
    s.push('<circle cx="' + mx + '" cy="' + cy + '" r="' + MS + '" fill="var(--surface)" stroke="' + ring + '" stroke-width="' + rw + '"/>');
    if (m.done) {
      s.push('<text x="' + mx + '" y="' + (cy + 6) + '" text-anchor="middle" font-size="17" font-weight="800" fill="var(--ok)">✓</text>');
    } else {
      s.push('<text x="' + mx + '" y="' + (cy + 5) + '" text-anchor="middle" font-size="13" font-weight="700" fill="' +
        (m.current ? "var(--acc)" : "var(--text-muted)") + '">' + m.n + "</text>");
    }
    s.push('<text x="' + mx + '" y="88" text-anchor="middle" font-size="13" font-weight="700" fill="' +
      (m.done || m.current ? "var(--text)" : "var(--text-muted)") + '">' + esc(m.label) + "</text>");
    if (m.date) s.push('<text x="' + mx + '" y="104" text-anchor="middle" font-size="12" fill="var(--text-muted)">' + esc(m.date) + "</text>");
    if (m.n === 5 && m.current && model.statusDates.sent) {
      const d = daysBetween(model.statusDates.sent, today);
      if (d != null) hintChip = '<text x="' + mx + '" y="120" text-anchor="middle" font-size="12" fill="var(--gold)">Sent ' + d + "d ago</text>";
    }
    s.push("</g>");
  });
  if (hintChip) s.push(hintChip);

  // lane nodes
  if (L.showLanes) {
    const GLYPH = { done: "✓", inProgress: "●", attention: "⚠", notStarted: "◌", skipped: "·", na: "—" };
    const STROKE = { done: "var(--ok)", inProgress: "var(--acc)", attention: "var(--gold)", notStarted: "var(--border)", skipped: "var(--border)", na: "var(--border)" };
    const FILL = { done: "rgba(47,166,121,.10)", inProgress: "var(--tint)", attention: "rgba(214,161,58,.14)", notStarted: "transparent", skipped: "transparent", na: "transparent" };

    // The item's identity at the head of each region's lane: the group colour, who it is assigned to, the
    // item and its group, its scope and any flag.
    function laneLabel(lx, y, l) {
      const h = L.LANE_H - 6, top = y - h / 2;
      const nameF = 13, subF = 12;
      const textX = lx + 38, textW = L.LABEL_W - 46;
      const who = l.assignees.map(function (a) { return a.name; }).join(", ");
      const scope = [l.groupName].concat(l.laborNames || [], l.materialNames || []).filter(Boolean).join(" · ");
      const overdue = l.flag && l.flag.due && today && l.flag.due < today;
      const full = l.name + (l.estimateName ? " — " + l.estimateName : "") +
        "\n" + (who ? "Assigned: " + who : "Unassigned") + (scope ? "\n" + scope : "") +
        (l.flag ? "\n" + l.flag.state.toUpperCase() + (l.flag.note ? ": " + l.flag.note : "") +
          (l.flag.due ? " (due " + l.flag.due + (overdue ? ", OVERDUE" : "") + ")" : "") : "");

      s.push("<g" + attr("lane:" + l.key + ":label") + "><title>" + esc(full) + "</title>");
      s.push('<rect x="' + lx + '" y="' + top + '" width="' + L.LABEL_W + '" height="' + h +
        '" rx="8" fill="var(--surface-2)" stroke="var(--border)" stroke-width="1"/>');
      s.push('<rect x="' + lx + '" y="' + top + '" width="5" height="' + h + '" rx="2.5" fill="var(--gc' + (l.colorSlot || 0) + ')"/>');
      const avY = top + h / 2, avR = 13;
      if (l.initials) {
        s.push('<circle cx="' + (lx + 22) + '" cy="' + avY + '" r="' + avR + '" fill="' + avatarColor(l.assignees[0].name) + '"/>');
        s.push('<text x="' + (lx + 22) + '" y="' + (avY + 4) + '" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">' +
          esc(l.initials) + "</text>");
      } else {
        s.push('<circle cx="' + (lx + 22) + '" cy="' + avY + '" r="' + avR + '" fill="none" stroke="var(--border)" stroke-width="1.5" stroke-dasharray="3 2"/>');
        s.push('<text x="' + (lx + 22) + '" y="' + (avY + 4) + '" text-anchor="middle" font-size="11.5" fill="var(--text-muted)">?</text>');
      }
      // flag / attention badge, right-aligned on the first line
      let badgeW = 0;
      const bx2 = lx + L.LABEL_W - 8;
      function badge(txt, bg, fg) {
        const w = txt.length * 6.2 + 12;
        badgeW = w + 8;
        s.push('<rect x="' + (bx2 - w) + '" y="' + (top + 6) + '" width="' + w + '" height="17" rx="8.5" fill="' + bg + '"/>');
        s.push('<text x="' + (bx2 - w / 2) + '" y="' + (top + 18) + '" text-anchor="middle" font-size="10.5" font-weight="800" fill="' + fg + '">' +
          esc(txt) + "</text>");
      }
      if (l.flag && l.flag.state === "blocked") badge("BLOCKED", "var(--err)", "#fff");
      else if (l.flag && l.flag.state === "complete") badge("DONE", "var(--ok)", "#fff");
      else if (l.flag && l.flag.state === "important") badge(overdue ? "⚑ OVERDUE" : "⚑ " + (l.flag.due ? fmtDay(l.flag.due) : "IMPORTANT"), overdue ? "var(--err)" : "var(--gold)", "#fff");
      else if (l.attention) badge("⚠", "var(--gold)", "#fff");

      s.push('<text x="' + textX + '" y="' + (top + 18) + '" font-size="' + nameF +
        '" font-weight="700" fill="var(--text)">' + esc(clip(l.name, textW - badgeW, nameF)) + "</text>");
      if (L.compact) {
        s.push('<text x="' + textX + '" y="' + (top + 34) + '" font-size="' + subF + '" fill="var(--text-muted)">' +
          esc(clip((who ? "👤 " + who : "unassigned") + (scope ? "  ·  " + scope : ""), textW, subF)) + "</text>");
      } else {
        s.push('<text x="' + textX + '" y="' + (top + 36) + '" font-size="' + subF +
          '" fill="' + (who ? "var(--text-muted)" : "var(--border)") + '">' + esc(clip(who ? "👤 " + who : "unassigned", textW, subF)) + "</text>");
        if (scope) {
          s.push('<text x="' + textX + '" y="' + (top + 51) + '" font-size="' + subF +
            '" fill="var(--text-muted)" opacity=".8">' + esc(clip(scope, textW, subF)) + "</text>");
        }
      }
      s.push("</g>");
    }

    lanes.forEach(function (l, i) {
      const y = L.laneY(i);
      function node(nx, def) {
        const stt = l.nodes[def.key] || { s: "notStarted", chip: "" }, st = stt.s;
        if (st === "skipped") {
          s.push('<circle cx="' + (nx + L.NODE_W / 2) + '" cy="' + y + '" r="4" fill="var(--border)"/>');
          return;
        }
        const dash = st === "notStarted" ? ' stroke-dasharray="4 3"' : "";
        s.push("<g" + attr("lane:" + l.key + ":" + def.key) + ">");
        s.push('<rect x="' + nx + '" y="' + (y - L.NODE_H / 2) + '" width="' + L.NODE_W + '" height="' + L.NODE_H +
          '" rx="7" fill="' + FILL[st] + '" stroke="' + STROKE[st] + '" stroke-width="1.5"' + dash + "/>");
        // the type bar: state owns the border and the glyph, so the kind gets its own channel
        if (KIND_COLOR[def.kind]) {
          s.push('<rect x="' + (nx + 1.5) + '" y="' + (y - L.NODE_H / 2 + 5) + '" width="3" height="' + (L.NODE_H - 10) +
            '" rx="1.5" fill="' + KIND_COLOR[def.kind] + '" opacity="' + (st === "notStarted" || st === "na" ? ".35" : ".95") + '"/>');
        }
        const glyph = GLYPH[st] || "";
        if (L.compact) {
          s.push('<text x="' + (nx + L.NODE_W / 2) + '" y="' + (y + 4.5) + '" text-anchor="middle" font-size="12" fill="var(--text)">' +
            glyph + " " + esc(clip(stt.chip || def.label, L.NODE_W - 18, 12)) + "</text>");
        } else {
          s.push('<text x="' + (nx + 12) + '" y="' + (y - 3) + '" font-size="12" font-weight="700" fill="var(--text-muted)">' +
            glyph + " " + esc(def.label) + "</text>");
          s.push('<text x="' + (nx + 12) + '" y="' + (y + 13) + '" font-size="12.5" fill="var(--text)" style="font-variant-numeric:tabular-nums">' +
            esc(clip(stt.chip || "", L.NODE_W - 22, 12.5)) + "</text>");
        }
        s.push("</g>");
      }
      if (expA) {
        if (L.LABEL_W) laneLabel(x.Astart, y, l);
        aNodes.forEach(function (d, k) { node(L.nodeX.A[k], d); });
      }
      if (expB) {
        if (L.LABEL_W) laneLabel(x.Bstart, y, l);
        bNodes.forEach(function (d, k) { node(L.nodeX.B[k], d); });
      }
    });
  }

  s.push("</svg>");
  return s.join("");
}

/* The status line a report table prints for one lane (old report-pm's words, without amounts). */
export function laneStatus(l, showMoney) {
  if (l.flag && l.flag.state === "blocked") return "BLOCKED" + (l.flag.note ? " — " + l.flag.note : "");
  if (l.flag && l.flag.state === "complete") return "Complete";
  if (showMoney) {
    if (l.pctB >= 100) return "Paid";
    if (l.bills.length) return "Invoicing";
  }
  if (l.nodes.B1.s === "done") return "In progress";
  if (l.requests) return "Bidding";
  if (l.priced) return "Priced";
  return "Not started";
}
