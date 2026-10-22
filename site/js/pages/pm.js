/* The Progress Chart (port of the old pm.html / pm.js; MODULES §5a "pm.html"; BLUEPRINT 3.3.11 "Progress
   Chart (PM)", P5 5a, acceptance check 1).

   No ?id=: the picker (every project by stage, a search, "Resume" the last one this person opened). With
   ?id=: one project's chart - the milestone spine, the estimate items fanning out through bidding and
   execution (js/pm-chart.js, shared with report-pm.html), the money tiles and bands for someone with the
   prices AND financials switches, the project's tasks; ?item=<lane> opens an item's drawer.

   What the page lets people do (Q12: view and print; the estimates, quotes, bills and payments are edited in
   DCR Desktop 2):
   * a milestone: Advance / Put on hold / Resume the project (admin, manager: a versioned status write, the
     database writes the log line);
   * an item: flag it important (with a note and a due date), blocked (with what it waits on), complete, or
     clear the flag (M5a estimate_item_flags: estimate editors and leads; versioned);
   * a quote still open: record a follow-up (rpc quote_follow_up stamps the company day and counts it), then
     the vendor's follow-up e-mail opens as a draft in the person's own mail app (no amount in it);
   * a quick note on the item to the project log (activity: admin, manager, accountant, lead);
   * an item's document: opened through a signed link (cloud), or "On the office computers" (local).
   Not ported: adding / receiving / awarding quotes and their typed invoice and paid amounts, bills, invoices,
   costs and payments, the vendor typeahead, the old approve call (it sent no pay method; P5b's bill page
   approves with one).

   Money (BLUEPRINT 2.1 principle 8): amounts only with the prices switch, the money tiles only with prices
   AND financials; without them nothing that holds an amount is read (repo/pm.js), the tiles are not drawn,
   and the words people typed are masked on screen (Q28). */

import { boot, el, esc, toast, confirmBox, errorText, maskFor, qs, setQs, store, D } from "./shell.js";
import * as pmRepo from "../repo/pm.js";
import * as projectsRepo from "../repo/projects.js";
import * as activityRepo from "../repo/activity.js";
import * as filesRepo from "../repo/files.js";
import * as C from "../pm-chart.js";
import { seesPrices, seesMoney, canFlag, canFollowUp, canStatus, canNote, QUOTE_STATUS_LABELS, FLAG_LABELS, FLAG_NOTE_MAX, followUpMail } from "../map/pm.js";
import { STATUS_ORDER, statusLabel } from "../map/status.js";
import { ymd } from "../map/pacific.js";
import { fmtSize, SIGNED_DOC_S } from "../map/files.js";

const PREF_KEY = "dcr2_pm_prefs";
const SEC_KEY = "dcr2_pm_secs";
const REFRESH_AFTER_MS = 10 * 60 * 1000;
const state = {
  me: null, pid: null, mask: function (t) { return t == null ? "" : String(t); },
  payload: null, model: null, prices: false, money: false,
  filter: "", estFilter: "*", attnOnly: false, density: null, drawerKey: null, fetchedAt: 0, loading: false,
};

/* ── per-device preferences (never a name or an amount) ── */
function readJson(k) { try { return JSON.parse(store.get(k, "{}") || "{}") || {}; } catch (e) { return {}; } }
function projPrefs() { return readJson(PREF_KEY)[String(state.pid)] || {}; }
function setPref(k, v) {
  const all = readJson(PREF_KEY);
  const key = String(state.pid);
  all[key] = all[key] || {};
  all[key][k] = v;
  const keys = Object.keys(all);
  if (keys.length > 60) delete all[keys[0]];               // a long-lived device keeps the last 60 projects
  store.set(PREF_KEY, JSON.stringify(all));
}
function lastKey() { return "dcr2:pm:last:" + ((state.me && state.me.id) || ""); }
function secOpen(key, dflt) { const all = readJson(SEC_KEY); return all[key] === undefined ? dflt : !!all[key]; }
function secSet(key, open) { const all = readJson(SEC_KEY); all[key] = !!open; store.set(SEC_KEY, JSON.stringify(all)); }

function today() { return ymd(new Date()); }
function m$(n) { return C.money(n || 0); }

/* ── data ── */
async function load() {
  state.loading = true;
  try {
    const got = await pmRepo.load(state.pid, state.me, { mask: state.mask, today: today() });
    state.payload = got.payload;
    state.fetchedAt = Date.now();
    const p = got.payload.project;
    store.set(lastKey(), JSON.stringify({ id: p.id, num: p.number }));
    document.title = "DCR Portal 2 — Progress Chart — " + (p.number || "");
    rederive();
  } finally { state.loading = false; }
}
function rederive() {
  const pp = projPrefs();
  state.model = C.derive(state.payload, { expandedA: pp.expandedA, expandedB: pp.expandedB });
  render();
  if (state.drawerKey) renderDrawer();
}

/* ── the picker (no ?id=) ── */
async function renderPicker() {
  const root = el("pmRoot");
  root.innerHTML = '<div class="pm-empty">Loading projects…</div>';
  const projects = await projectsRepo.loadProjects();
  let last = null;
  try { last = JSON.parse(store.get(lastKey(), "null") || "null"); } catch (e) { last = null; }
  const lastP = last ? projects.find(function (p) { return String(p.id) === String(last.id); }) : null;
  const byStatus = {};
  projects.forEach(function (p) { (byStatus[p.status || ""] = byStatus[p.status || ""] || []).push(p); });
  const order = ["new_request", "estimating", "sent", "follow_up", "approved", "in_progress", "on_hold", "completed", "closed"]
    .concat(STATUS_ORDER).filter(function (s, i, a) { return a.indexOf(s) === i; });
  const SHOW = 60;
  let html = '<div class="pm-head"><span class="pm-title">📊 Progress Chart</span>' +
    '<span class="pm-sub">Pick a project — every stage, item and quote on one chart.</span></div>' +
    '<div class="pm-bar"><input type="search" id="pkSearch" placeholder="Search projects…" aria-label="Search projects"></div>' +
    (lastP ? '<div class="pm-banner">Resume: <a href="pm.html?id=' + esc(lastP.id) + '"><b>' +
      esc((lastP.internalIDNumber ? lastP.internalIDNumber + " — " : "") + (lastP.projectName || "")) + "</b></a></div>" : "");
  order.concat(Object.keys(byStatus).filter(function (s) { return order.indexOf(s) === -1; })).forEach(function (s) {
    const list = (byStatus[s] || []).slice().sort(function (a, b) { return String(b.internalIDNumber).localeCompare(String(a.internalIDNumber), "en", { numeric: true }); });
    if (!list.length) return;
    html += '<div class="pm-h">' + esc(statusLabel(s)) + " · " + list.length + "</div>" +
      '<div class="pk-cards" data-status="' + esc(s) + '">' + list.map(function (p, i) {
        return '<a class="pk-card" data-nm="' + esc(((p.internalIDNumber || "") + " " + (p.projectName || "") + " " + (p.projectAddress || "") + " " +
            (p.projectCity || "") + " " + (p.projectClientName || "")).toLowerCase()) + '"' + (i >= SHOW ? " hidden data-more=\"1\"" : "") +
          ' href="pm.html?id=' + esc(p.id) + '"><div class="k">' + esc(p.internalIDNumber || p.id) +
          '</div><div class="v">' + esc(p.projectName || "(unnamed)") + "</div>" +
          '<div class="pm-sub">' + esc([p.projectAddress, p.projectCity].filter(Boolean).join(" · ")) + "</div></a>";
      }).join("") + "</div>" +
      (list.length > SHOW ? '<div class="pk-more"><button class="btn btn-ghost btn-sm" type="button" data-more-of="' + esc(s) + '">Show all ' + list.length + "</button></div>" : "");
  });
  if (!projects.length) html += '<div class="pm-empty">No projects yet.</div>';
  root.innerHTML = html;
  root.querySelectorAll("[data-more-of]").forEach(function (b) {
    b.addEventListener("click", function () {
      const grid = root.querySelector('.pk-cards[data-status="' + b.getAttribute("data-more-of") + '"]');
      if (grid) grid.querySelectorAll("[data-more]").forEach(function (c) { c.hidden = false; c.removeAttribute("data-more"); });
      b.parentNode.remove();
    });
  });
  el("pkSearch").addEventListener("input", function () {
    const q = this.value.trim().toLowerCase();
    root.querySelectorAll(".pk-card").forEach(function (c) {
      c.hidden = q ? c.dataset.nm.indexOf(q) === -1 : !!c.dataset.more;
    });
  });
}

/* ── main render ── */
function visibleLanes() {
  const m = state.model;
  const q = state.filter.trim().toLowerCase();
  return m.lanes.filter(function (l) {
    if (state.estFilter !== "*" && String(l.estimateId) !== state.estFilter) return false;
    if (state.attnOnly && !l.attention) return false;
    if (!q) return true;
    const hay = (l.name + " " + l.groupName + " " + l.estimateName + " " + (l.laborNames || []).join(" ") + " " + (l.materialNames || []).join(" ") + " " +
      l.assignees.map(function (a) { return a.name; }).join(" ") + " " + l.quotes.map(function (x) { return x.vendor; }).join(" ")).toLowerCase();
    return hay.indexOf(q) !== -1;
  });
}

function rollOf(quoteId) {
  const list = state.model.commitments;
  if (!list) return null;
  return list.find(function (x) { return String(x.quoteId) === String(quoteId); }) || null;
}

/* Billed and paid against the agreed price, as one bar: billed sits behind paid, so the gap IS the money
   owed; over-billing paints it red rather than stopping at full. */
function paidBarHtml(r) {
  if (!r || r.pctPaid === null) return "";
  const billed = Math.min(100, Math.max(0, r.pctBilled || 0)), paid = Math.min(100, Math.max(0, r.pctPaid || 0));
  const cls = r.overBilled ? " over" : "";
  const note = r.overBilled ? "Billed " + m$(r.overBilledBy) + " past the agreed price"
    : m$(r.paid) + " paid of " + m$(r.committed) + (r.billed > r.paid ? " · " + m$(r.billed - r.paid) + " billed and unpaid" : "");
  return '<div class="pm-paidbar' + cls + '" title="' + esc(note) + '"><span class="b" style="width:' + billed.toFixed(1) + '%"></span>' +
    '<span class="p" style="width:' + paid.toFixed(1) + '%"></span></div>' +
    '<div class="pm-sub pm-paidnote' + cls + '">' + esc(Math.round(r.pctPaid) + "% paid" +
      (r.waitingCount ? " · " + r.waitingCount + " awaiting approval" : "") +
      (r.paidUnapproved > 0 ? " · " + m$(r.paidUnapproved) + " paid unapproved" : "") +
      (r.overPaid ? " · PAID PAST APPROVED" : "") +
      (r.overBilled ? " · OVER by " + m$(r.overBilledBy) : "")) + "</div>";
}

function billState(b) {
  if (!b.approved) return { cls: "wait", text: "Waiting for approval" };
  if (b.owed <= 0) return { cls: "ok", text: "Paid" };
  if (b.dueDate && b.dueDate < state.model.today) return { cls: "bad", text: "Overdue since " + C.fmtDay(b.dueDate) };
  return { cls: "due", text: b.dueDate ? "Due " + C.fmtDay(b.dueDate) : "Approved" };
}
function invState(iv) {
  if (iv.status === "paid") return { cls: "ok", text: "Paid" };
  if (iv.status === "sent") {
    const over = iv.dueDate && iv.dueDate < state.model.today;
    return { cls: over ? "bad" : "due", text: over ? "Overdue since " + C.fmtDay(iv.dueDate) : "Sent" + (iv.sentDate ? " " + C.fmtDay(iv.sentDate) : "") };
  }
  return { cls: "", text: "Not sent yet" };
}

/* Money in on the left, money out on the right - read only here (P5b's pages approve and pay). */
function moneyPanel() {
  const m = state.model;
  if (!m.showMoney) return "";
  const invs = m.invoices || [], bills = m.bills || [];
  const inRows = invs.length ? invs.map(function (iv) {
    const st = invState(iv);
    return '<div class="mn-row"><span class="mn-dot ' + st.cls + '"></span><span class="mn-main"><b>' + esc(iv.number ? "#" + iv.number : "Invoice") + "</b>" +
      '<span class="mn-sub">' + esc(iv.invoiceDate ? C.fmtDay(iv.invoiceDate) : "") + "</span></span>" +
      '<span class="mn-amt">' + m$(iv.total) + (iv.paid > 0 && iv.paid < iv.total ? '<span class="mn-sub">' + m$(iv.paid) + " paid</span>" : "") + "</span>" +
      '<span class="mn-st ' + st.cls + '">' + esc(st.text) + "</span></div>";
  }).join("") : '<div class="mn-none">Nothing invoiced to the client yet.</div>';
  const outRows = bills.length ? bills.map(function (b) {
    const st = billState(b);
    // P5b: the bill page (approve with a pay method; the paperwork) - the old chart's bill rows opened it too
    return '<div class="mn-row"><span class="mn-dot ' + st.cls + '"></span><span class="mn-main"><b><a class="mn-bill" href="bill.html?id=' +
      encodeURIComponent(b.id) + '">' + esc(b.vendor) + "</a></b>" +
      '<span class="mn-sub">' + esc([b.invoiceNumber ? "#" + b.invoiceNumber : "", b.description, b.hasDocument ? "" : "no document yet"].filter(Boolean).join(" · ")) + "</span></span>" +
      '<span class="mn-amt">' + m$(b.amount) + (b.paid > 0 && b.owed > 0 ? '<span class="mn-sub">' + m$(b.paid) + " paid</span>" : "") + "</span>" +
      '<span class="mn-st ' + st.cls + '">' + esc(st.text) + (b.approved ? '<span class="mn-by">' + esc(b.approvedBy || "") + "</span>" : "") + "</span></div>";
  }).join("") : '<div class="mn-none">No bills recorded yet.</div>';
  const sum = function (rows, fn) { return rows.reduce(function (t, r) { return t + (Number(fn(r)) || 0); }, 0); };
  const inSent = sum(invs, function (i) { return i.status === "sent" || i.status === "paid" ? i.total : 0; });
  const inPaid = sum(invs, function (i) { return i.paid; });
  const outAll = sum(bills, function (b) { return b.amount; });
  const outWait = sum(bills, function (b) { return b.approved ? 0 : b.amount; });
  const outOwed = sum(bills, function (b) { return b.approved ? b.owed : 0; });
  return '<div class="pm-money-band">' +
    '<section class="mn-col"><header><h3>Money in <span>invoices we sent the client</span></h3></header>' +
      '<div class="mn-list">' + inRows + "</div>" +
      "<footer><span>Invoiced <b>" + m$(inSent) + "</b></span><span>Collected <b>" + m$(inPaid) + "</b></span>" +
      '<span class="mn-gap">Outstanding <b>' + m$(inSent - inPaid) + "</b></span></footer></section>" +
    '<section class="mn-col"><header><h3>Money out <span>bills from subs &amp; suppliers</span></h3></header>' +
      '<div class="mn-list">' + outRows + "</div>" +
      "<footer><span>Billed to us <b>" + m$(outAll) + "</b></span>" +
      '<span class="' + (outWait > 0 ? "warn" : "") + '">Awaiting approval <b>' + m$(outWait) + "</b></span>" +
      '<span class="mn-gap ' + (outOwed > 0 ? "warn" : "") + '">Still to pay <b>' + m$(outOwed) + "</b></span></footer>" +
      '<div class="mn-note">Bills are entered in DCR Desktop 2; open one to see its paperwork and approve it. ' +
      '<a class="mn-bill" href="accounting.html">The Books</a> pay them.</div></section></div>';
}

/* Costs and bills no estimate item accounts for - the concrete pump nobody priced - and quotes not tied to
   an item. */
function extrasPanel() {
  const m = state.model;
  const rows = m.showMoney ? m.unassignedRows : [];
  const bills = m.showMoney ? m.unlinkedBills : [];
  const qs2 = m.unlinkedQuotes || [];
  if (!rows.length && !bills.length && !qs2.length) return "";
  const open = !!projPrefs().extrasOpen;
  const total = m.showMoney ? m.unassignedCosts + bills.reduce(function (s, b) { return s + b.amount; }, 0) : 0;
  const n = rows.length + bills.length + qs2.length;
  const body = open ? '<div style="padding:2px 14px 12px">' +
    (qs2.length ? '<div class="pm-h">Quotes and change orders not tied to an item</div>' + qs2.map(function (q) {
      return '<div class="pm-ln"><span>' + esc(q.vendor) + (q.kind === "change_order" ? ' <span class="pm-co">CHANGE ORDER</span>' : "") +
        ' <span class="pm-st ' + esc(q.status) + '">' + esc(QUOTE_STATUS_LABELS[q.status]) + "</span></span>" +
        "<b>" + (state.prices && q.amount != null ? m$(q.amount) : "") + "</b></div>";
    }).join("") : "") +
    (bills.length ? '<div class="pm-h">Bills not tied to an item</div>' + bills.map(function (b) {
      return '<div class="pm-ln"><span>' + esc((b.invoiceDate ? C.fmtDay(b.invoiceDate) + " · " : "") + b.vendor + (b.invoiceNumber ? " #" + b.invoiceNumber : "")) +
        ' <span class="pm-sub">' + (b.approved ? "approved" : "awaiting approval") + "</span></span><b>" + m$(b.amount) + "</b></div>";
    }).join("") : "") +
    (rows.length ? '<div class="pm-h">Costs with no estimate item behind them</div>' + rows.map(function (c) {
      return '<div class="pm-ln"><span>' + esc((c.date ? C.fmtDay(c.date) + " · " : "") + (c.description || c.vendor || "cost")) +
        (c.kind ? ' <span class="pm-sub">' + esc(c.kind) + "</span>" : "") + "</span><b>" + m$(c.amount) + "</b></div>";
    }).join("") : "") + "</div>" : "";
  return '<div class="pm-tk" id="pmExtras"><button type="button" class="tk-hd" id="pmExHd" aria-expanded="' + (open ? "true" : "false") + '">💸 Not on an estimate item — ' + n +
    (m.showMoney && total ? " · " + m$(total) : "") + " <span>" + (open ? "▾" : "▸") + "</span></button>" + body + "</div>";
}

/* The project's tasks, per person (the old Access Tasks tab). */
function tasksPanel() {
  const tasks = (state.payload && state.payload.tasks) || [];
  if (!tasks.length) return "";
  const pend = tasks.filter(function (t) { return !t.done; });
  const pp = projPrefs();
  const open = pp.tasksOpen !== undefined ? pp.tasksOpen : pend.length > 0;
  let body = "";
  if (open) {
    const byEmp = {};
    tasks.forEach(function (t) { const k = t.assignee || "(unassigned)"; (byEmp[k] = byEmp[k] || []).push(t); });
    body = '<div class="tk-body">' + Object.keys(byEmp).sort().map(function (emp) {
      return '<div class="tk-grp"><div class="tk-emp">' + esc(emp) + "</div>" + byEmp[emp].slice().sort(function (a, b) {
        return (a.done ? 1 : 0) - (b.done ? 1 : 0) || String(a.requested).localeCompare(String(b.requested));
      }).map(taskRow).join("") + "</div>";
    }).join("") + "</div>";
  }
  return '<div class="pm-tk" id="pmTasksPanel"><button type="button" class="tk-hd" id="pmTkHd" aria-expanded="' + (open ? "true" : "false") + '">📋 Project tasks — ' +
    pend.length + " pending · " + (tasks.length - pend.length) + " done <span>" + (open ? "▾" : "▸") + "</span></button>" +
    '<div style="padding:0 14px 6px"><a class="pm-sub" href="project.html?id=' + esc(state.pid) + '&amp;tab=tasks">Open the Tasks tab →</a></div>' + body + "</div>";
}
function taskRow(t) {
  return '<div class="tk-row' + (t.done ? " done" : "") + '"><span class="tk-ic">' + (t.done ? "✓" : t.urgent ? "⚑" : "◌") + "</span>" +
    '<div class="tk-b"><div class="tk-t">' + esc(t.title) + (t.urgent ? ' <span class="tk-urg">URGENT</span>' : "") + "</div>" +
    '<div class="tk-m">' + esc([t.category, t.done ? "done" + (t.completed ? " " + C.fmtDay(t.completed) : "") : (t.requested ? "requested " + C.fmtDay(t.requested) : "")]
      .filter(Boolean).join(" · ")) + "</div>" +
    (t.description ? '<div class="tk-d">' + esc(t.description) + "</div>" : "") + "</div></div>";
}

function moneyCards() {
  const m = state.model;
  if (!state.prices) return "";
  const cards = [["Estimate", m.totals.estimate]];
  if (m.showMoney) {
    const committed = (m.commitments || []).reduce(function (s, c) { return s + c.committed; }, 0);
    cards.push(["Committed to subs", m.commitments ? committed : m.totals.awarded]);
    const invs = m.invoices || [];
    cards.push(["Billed to client", invs.reduce(function (s, i) { return s + (i.status === "sent" || i.status === "paid" ? i.total : 0); }, 0)],
      ["Collected", invs.reduce(function (s, i) { return s + i.paid; }, 0)]);
    let billedIn = 0, waitAmt = 0, waitN = 0, dueAmt = 0, overdueAmt = 0;
    (m.bills || []).forEach(function (b) {
      billedIn += b.amount;
      if (!b.approved) { waitAmt += b.amount; waitN += 1; return; }
      dueAmt += b.owed;
      if (b.owed > 0 && b.dueDate && b.dueDate < m.today) overdueAmt += b.owed;
    });
    cards.push(["Billed to us", billedIn]);
    cards.push(["⚑ Invoices to approve", waitAmt, waitN ? waitN + (waitN === 1 ? " invoice waiting" : " invoices waiting") : "none waiting", waitN ? "due" : ""]);
    cards.push(["Due to pay", dueAmt, overdueAmt > 0 ? m$(overdueAmt) + " overdue" : "", overdueAmt > 0 ? "bad" : ""]);
  } else {
    cards.push(["Awarded to subs", m.totals.awarded]);
  }
  return '<div class="pm-cards">' + cards.map(function (c) {
    return '<div class="pm-card' + (c[3] ? " " + c[3] : "") + '"><div class="k">' + esc(c[0]) + '</div><div class="v">' + m$(c[1]) + "</div>" +
      (c[2] ? '<div class="n">' + esc(c[2]) + "</div>" : "") + "</div>";
  }).join("") + "</div>";
}

function render() {
  const m = state.model, root = el("pmRoot");
  const proj = m.project;
  const lanes = visibleLanes();
  const compact = state.density !== null ? state.density === "compact" : lanes.length > 18;
  const L = C.layout(m, { compact: compact, lanes: lanes });
  const ests = [];
  m.lanes.forEach(function (l) { if (!ests.some(function (e) { return e.id === String(l.estimateId); })) ests.push({ id: String(l.estimateId), name: l.estimateName }); });

  const segW = [4, 6, 25, 5, 10, 45, 5];
  const segVals = [m.milestones[0].done ? 100 : 0, m.milestones[1].done ? 100 : 0, m.regions.pctA,
    m.milestones[3].done ? 100 : 0, m.milestones[4].done ? 100 : 0, m.regions.pctB, m.milestones[6].done ? 100 : 0];
  const curSeg = { M2: 1, bandA: 2, M4: 3, M5: 4, bandB: 5, M7: 6 }[m.pulseAt];
  const strip = '<div class="pm-progress" title="Completion of tracked facts — not schedule">' + segW.map(function (w, i) {
    const bg = segVals[i] >= 100 ? "var(--ok)" : i === curSeg ? "var(--acc)" : "var(--surface-2)";
    return '<span style="flex:' + w + ";background:" + bg + '"></span>';
  }).join("") + "</div>";

  const holdBar = m.onHold ? '<div class="pm-hold">⏸ ON HOLD — the chart shows history' + (canStatus(state.me) ? "; resume the project from any milestone." : ".") + "</div>" : "";
  const x = L.x;
  const pd = function (which) { return m.pulseAt === which ? '<span class="pdot"></span>' : ""; };
  const bandTitles =
    '<button type="button" class="pm-bandtitle" data-band="A" style="left:' + x.Astart + 'px" aria-expanded="' + (m.regions.expandedA ? "true" : "false") + '">' + pd("bandA") +
      "BIDDING <span class='pct'>" + m.regions.pctA + "% · " + esc(m.regions.humanA) + "</span> " + (m.regions.expandedA ? "▾" : "▸") + "</button>" +
    '<button type="button" class="pm-bandtitle" data-band="B" style="left:' + x.Bstart + 'px" aria-expanded="' + (m.regions.expandedB ? "true" : "false") + '">' + pd("bandB") +
      "EXECUTION <span class='pct'>" + m.regions.pctB + "% · " + esc(m.regions.humanB) + "</span> " + (m.regions.expandedB ? "▾" : "▸") + "</button>";
  const chart = m.lanes.length || m.known
    ? '<div class="pm-scroll" id="pmScroll"><div class="pm-stage"><div class="pm-svgwrap">' + bandTitles + C.svg(m, L, { interactive: true }) + "</div></div></div>"
    : "";
  const empty = !m.lanes.length
    ? '<div class="pm-empty">No estimate items yet — items are added to the estimates in DCR Desktop 2, and each becomes a track here.' +
      ' <a href="project.html?id=' + esc(state.pid) + '&amp;tab=estimate">Open the Estimate tab</a></div>'
    : "";
  const kinds = {};
  m.aNodes.concat(m.bNodes).forEach(function (d) { kinds[d.kind] = 1; });
  const scroll = el("pmScroll") ? el("pmScroll").scrollLeft : 0;

  root.innerHTML =
    '<div class="pm-head">' +
      '<span class="pm-title">' + esc((proj.number ? proj.number + " — " : "") + (proj.name || "Project")) + "</span>" +
      '<span class="pm-pill" style="background:' + esc(m.statusColor || "var(--surface-2)") + '">' + esc(m.statusLabel) + "</span>" +
      '<span class="pm-sub">' + esc([proj.address, proj.city, proj.client].filter(Boolean).join(" · ")) + "</span>" +
      '<span class="sp"></span><b class="pm-overall">Overall ' + m.overall + "%</b>" +
      '<button class="btn btn-ghost btn-sm" id="pmRefresh" type="button" title="Refresh" aria-label="Refresh">↻</button>' +
      '<a class="btn btn-ghost btn-sm" href="report-pm.html?id=' + esc(state.pid) + '">🖨 Print report</a>' +
      '<a class="btn btn-ghost btn-sm" href="project.html?id=' + esc(state.pid) + '">Open project →</a>' +
    "</div>" + strip + moneyCards() + holdBar +
    '<div class="pm-bar">' +
      '<input type="search" id="pmSearch" placeholder="Find item, assignee, vendor…" aria-label="Find item, assignee or vendor" value="' + esc(state.filter) + '">' +
      (ests.length > 1 ? '<select id="pmEst" aria-label="Estimate"><option value="*">All estimates</option>' + ests.map(function (e) {
        return '<option value="' + esc(e.id) + '"' + (state.estFilter === e.id ? " selected" : "") + ">" + esc(e.name) + "</option>";
      }).join("") + "</select>" : "") +
      '<span class="pm-count">' + lanes.length + (lanes.length === m.lanes.length ? "" : " of " + m.lanes.length) + " items</span>" +
      '<button class="pm-chip' + (state.attnOnly ? " on" : "") + '" id="pmAttn" type="button" aria-pressed="' + (state.attnOnly ? "true" : "false") + '">⚠ Needs attention (' + m.attentionCount + ")</button>" +
      '<button class="pm-chip" id="pmDensity" type="button">' + (compact ? "Comfortable view" : "Compact view") + "</button>" +
      '<button class="pm-chip" id="pmFs" type="button" title="Use the whole monitor">' + (document.fullscreenElement ? "✕ Exit full screen" : "⛶ Full screen") + "</button>" +
      '<span class="pm-legend">✓ Done · ● In progress · ⚠ Waiting · ◌ Not started</span>' +
    "</div>" +
    '<div class="pm-bar pm-kindbar"><span class="pm-legend" style="margin-left:0">Tiles:</span>' +
      Object.keys(kinds).map(function (k) {
        return '<span class="pm-kind"><i style="background:' + C.KIND_COLOR[k] + '"></i>' + esc(C.KIND_LABEL[k]) + "</span>";
      }).join("") +
      (!m.showMoney ? '<span class="pm-kind">' + (state.prices ? "Bills, payments and invoices need the financials switch too." : "Prices and money are not shown to you.") + "</span>" : "") +
    "</div>" +
    chart + moneyPanel() + extrasPanel() + tasksPanel() + empty;
  if (scroll && el("pmScroll")) el("pmScroll").scrollLeft = scroll;
  wire(compact);
}

function toggleBand(which) {
  setPref(which === "A" ? "expandedA" : "expandedB", !(which === "A" ? state.model.regions.expandedA : state.model.regions.expandedB));
  rederive();
}

function wire(compact) {
  el("pmRefresh").addEventListener("click", function () { load().catch(showErr); });
  el("pmSearch").addEventListener("input", function () {
    state.filter = this.value;
    const pos = this.selectionStart;
    render();
    const s = el("pmSearch");
    s.focus();
    try { s.setSelectionRange(pos, pos); } catch (e) { /* */ }
  });
  const est = el("pmEst");
  if (est) est.addEventListener("change", function () { state.estFilter = this.value; render(); });
  el("pmAttn").addEventListener("click", function () { state.attnOnly = !state.attnOnly; render(); });
  el("pmDensity").addEventListener("click", function () { state.density = compact ? "comfortable" : "compact"; render(); });
  el("pmFs").addEventListener("click", function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
  });
  wireOne("pmTkHd");
  wireOne("pmExHd");
  const root = el("pmRoot");
  root.querySelectorAll("[data-band]").forEach(function (b) {
    b.addEventListener("click", function () { toggleBand(b.dataset.band); });
  });
  const stage = root.querySelector(".pm-svgwrap");
  if (stage) {
    const act = function (e) {
      const g = e.target.closest ? e.target.closest("[data-pm]") : null;
      if (!g) return;
      const sel = g.getAttribute("data-pm");
      if (sel.indexOf("lane:") === 0) {
        const parts = sel.split(":");
        openDrawer(parts.slice(1, -1).join(":"), parts[parts.length - 1]);
      } else if (sel.indexOf("ms:") === 0) {
        openPopover(g, Number(sel.slice(3)));
      } else if (sel.indexOf("band:") === 0) {
        toggleBand(sel.slice(5));
      }
    };
    stage.addEventListener("click", act);
    stage.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(e); } });
  }
}
// a panel header folds its panel: only that panel is drawn again (a whole render would reset the chart's
// scroll and restart the milestone pulse for nothing)
function wireOne(id) {
  const n = el(id);
  if (!n) return;
  n.addEventListener("click", function () {
    const tasks = id === "pmTkHd";
    setPref(tasks ? "tasksOpen" : "extrasOpen", this.getAttribute("aria-expanded") !== "true");
    const holder = document.createElement("div");
    holder.innerHTML = tasks ? tasksPanel() : extrasPanel();
    const panel = el(tasks ? "pmTasksPanel" : "pmExtras");
    if (panel && holder.firstChild) { panel.parentNode.replaceChild(holder.firstChild, panel); wireOne(id); }
  });
}

/* ── milestone popover ── */
function closePopover() { el("pmPop").classList.remove("open"); }
function openPopover(anchor, n) {
  const m = state.model, pop = el("pmPop");
  const ms = m.milestones[n - 1];
  const can = canStatus(state.me);
  const next = C.NEXT_STATUS[m.status];
  pop.innerHTML = "<b>" + esc(ms.label) + "</b>" +
    '<div class="pm-sub" style="margin:4px 0 8px">' + esc(ms.date ? ms.date + " · from the project log" : ms.done ? "Done" : ms.current ? "Current stage" : "Not reached yet") + "</div>" +
    (can ? (m.onHold
      ? '<button class="btn btn-sm" type="button" id="ppResume">▶ Resume project</button>'
      : (next ? '<button class="btn btn-sm" type="button" id="ppAdvance">Advance to ' + esc(statusLabel(next)) + " →</button>" : "") +
        (m.status !== "completed" && m.status !== "closed" ? '<button class="btn btn-ghost btn-sm" type="button" id="ppHold">⏸ Put on hold</button>' : "")) +
      '<div class="pm-msg" id="ppMsg"></div>' : "");
  pop.classList.add("open");
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
  pop.style.top = Math.min(r.bottom + 8, window.innerHeight - pop.offsetHeight - 8) + "px";
  const close = function (e) {
    if (e && pop.contains(e.target)) return;
    closePopover();
    document.removeEventListener("pointerdown", close, true);
  };
  setTimeout(function () { document.addEventListener("pointerdown", close, true); }, 30);
  async function setStatus(st, label) {
    if (!(await confirmBox(label + "?", { title: "Change the project stage", okText: "Yes" }))) return;
    const msgEl = el("ppMsg");
    try {
      const p = state.payload.project;
      await projectsRepo.setStatus({ id: p.id, version: p.version }, st);
      closePopover();
      toast("The project is now " + statusLabel(st) + ".", "ok");
      await load();
    } catch (e) {
      if (msgEl) msgEl.textContent = errorText(e);
      if (e && e.code === "PT409") load().catch(function () {});
    }
  }
  const adv = el("ppAdvance"), hd = el("ppHold"), rs = el("ppResume");
  if (adv) adv.addEventListener("click", function () { setStatus(next, "Move the project to " + statusLabel(next)); });
  if (hd) hd.addEventListener("click", function () { setStatus("on_hold", "Put this project on hold"); });
  if (rs) rs.addEventListener("click", function () { setStatus("in_progress", "Resume this project (In progress)"); });
}

/* ── item drawer ── */
function laneOf(key) { return state.model ? state.model.lanes.find(function (l) { return l.key === key; }) || null : null; }
const KIND_SECTION = { quote: "quotes", price: "fin", award: "quotes", cost: "costs", income: "costs" };

function openDrawer(key, nodeKey) {
  const def = nodeKey ? C.NODE_DEFS[nodeKey] : null;
  if (def && KIND_SECTION[def.kind]) secSet(KIND_SECTION[def.kind], true);
  state.drawerKey = key;
  setQs("item", key);
  renderDrawer();
  el("pmOvl").classList.add("open");
  el("pmDrawer").classList.add("open");
  const x = el("pmDrawerX");
  if (x) x.focus();
}
function closeDrawer() {
  const was = state.drawerKey;
  state.drawerKey = null;
  setQs("item", null);
  el("pmOvl").classList.remove("open");
  el("pmDrawer").classList.remove("open");
  el("pmDrawer").innerHTML = "";
  if (was) {
    const g = document.querySelector('[data-pm="lane:' + was + ':label"]');
    if (g && g.focus) g.focus();
  }
}

function section(key, title, count, body, dflt) {
  if (!body) return "";
  const open = secOpen(key, dflt);
  return '<section class="pm-sec' + (open ? " open" : "") + '" data-sec="' + esc(key) + '">' +
    '<button type="button" class="pm-sec-hd" aria-expanded="' + (open ? "true" : "false") + '"><span class="cav">▾</span>' + esc(title) +
    ' <span class="n">' + esc(String(count || "")) + "</span></button><div class=\"pm-sec-bd\">" + body + "</div></section>";
}

function quoteRows(l) {
  const canChase = canFollowUp(state.me);
  return l.quotes.map(function (q) {
    const open = q.status === "requested" && !q.receivedDate;
    const dates = [q.requestedDate ? "req " + C.fmtDay(q.requestedDate) : "",
      q.lastFollowUp ? "chased " + C.fmtDay(q.lastFollowUp) + (q.followUps > 1 ? " ×" + q.followUps : "") : "",
      q.receivedDate ? "rec " + C.fmtDay(q.receivedDate) : ""].filter(Boolean).join(" · ");
    const amt = state.prices ? (q.amount != null ? m$(q.amount) : "No amount yet") : "";
    return "<tr><td><b>" + esc(q.vendor) + "</b>" +
      (q.kind === "change_order" ? ' <span class="pm-co" title="A change order — extra work at an agreed price">CHANGE ORDER</span>' : "") +
      (dates ? '<div class="pm-sub">' + esc(dates) + "</div>" : "") +
      (q.notes ? '<div class="pm-sub">' + esc(q.notes) + "</div>" : "") +
      (q.documentUrl ? '<a href="' + esc(q.documentUrl) + '" target="_blank" rel="noopener noreferrer">📎 quote document</a>' : "") +
      (state.model.showMoney ? paidBarHtml(rollOf(q.id)) : "") +
      (canChase && open ? '<div class="pm-acts"><button class="btn btn-ghost btn-sm" type="button" data-chase="' + esc(q.id) + '">✉ Record a follow-up</button></div>' : "") +
      '</td><td class="r">' + esc(amt) + '<div><span class="pm-st ' + esc(q.status) + '">' + esc(QUOTE_STATUS_LABELS[q.status] || q.status) + "</span></div></td></tr>";
  }).join("");
}

function renderDrawer() {
  const l = laneOf(state.drawerKey);
  const d = el("pmDrawer");
  if (!l) { d.innerHTML = ""; return; }
  const m = state.model, p = state.payload;
  const t = m.today;
  const itemTasks = (p.tasks || []).filter(function (x) { return String(x.itemId) === String(l.itemId); });
  const itemFiles = (p.files || []).filter(function (x) { return String(x.itemId) === String(l.itemId); });
  const costs = m.showMoney ? (p.costs || []).filter(function (c) { return String(c.itemId) === String(l.itemId); }) : [];
  const costTotal = costs.reduce(function (s, c) { return s + c.amount; }, 0) + l.billed;

  const fin = state.prices ? '<div class="pm-money">' +
    [["Estimate", l.estTotal], ["Awarded", l.awarded]].concat(m.showMoney ? [["Billed to us", l.billed], ["Paid out", l.paidOut], ["Costs recorded", costTotal]] : [])
      .map(function (c) { return '<div class="pm-card"><div class="k">' + esc(c[0]) + '</div><div class="v">' + m$(c[1]) + "</div></div>"; }).join("") + "</div>" : "";

  const li = function (arr) { return arr.map(function (s) { return '<div style="padding:2px 0;font-size:12px">• ' + esc(s) + "</div>"; }).join(""); };
  const scope = (l.groupName ? '<div class="pm-sub" style="font-weight:700">Group</div><div style="font-size:12px;margin-bottom:6px">' + esc(l.groupName) + "</div>" : "") +
    (l.laborNames.length ? '<div class="pm-sub" style="font-weight:700">Labor</div>' + li(l.laborNames) : "") +
    (l.materialNames.length ? '<div class="pm-sub" style="font-weight:700;margin-top:4px">Materials</div>' + li(l.materialNames) : "") +
    (l.takeoff ? '<div class="pm-h">Material takeoff</div><div style="font-size:12.5px">📐 ' + l.takeoff.lines + " line" + (l.takeoff.lines === 1 ? "" : "s") +
      (l.takeoff.names.length ? ' <span class="pm-sub">· ' + esc(l.takeoff.names.join(", ")) + "</span>" : "") + "</div>" +
      '<a class="pm-sub" href="project.html?id=' + esc(state.pid) + '&amp;tab=takeoffs">Open the Takeoffs tab →</a>' : "");

  const qRows = quoteRows(l);
  const quotes = (qRows ? '<table class="pm-qt">' + qRows + "</table>" : '<div class="pm-sub">No quote requests yet.</div>') +
    '<div class="pm-hint">Quotes and change orders are requested, received and awarded in DCR Desktop 2 (the item\'s Quotes tab).</div><div class="pm-msg" id="qtMsg"></div>';

  const costRows = m.showMoney ? l.bills.map(function (b) {
    return '<div class="pm-ln"><span>' + esc((b.invoiceDate ? C.fmtDay(b.invoiceDate) + " · " : "") + b.vendor + (b.invoiceNumber ? " #" + b.invoiceNumber : "")) +
      ' <span class="pm-sub">' + (b.approved ? "invoice · approved" : "invoice · awaiting approval") + "</span></span><b>" + m$(b.amount) + "</b></div>";
  }).concat(costs.map(function (c) {
    return '<div class="pm-ln"><span>' + esc((c.date ? C.fmtDay(c.date) + " · " : "") + (c.description || c.vendor || "cost")) +
      (c.kind ? ' <span class="pm-sub">' + esc(c.kind) + "</span>" : "") + "</span><b>" + m$(c.amount) + "</b></div>";
  })).join("") : "";
  const costsSec = m.showMoney ? (costRows || '<div class="pm-sub">Nothing recorded yet.</div>') + '<div class="pm-hint">Bills and costs are entered in DCR Desktop 2.</div>' : "";

  const tasksSec = (itemTasks.length ? itemTasks.map(function (x) {
    return '<div class="pm-ln"' + (x.done ? ' style="opacity:.65"' : "") + "><span>" + (x.done ? "✓ " : x.urgent ? "⚑ " : "◌ ") + "<b>" + esc(x.title) + "</b>" +
      (x.assignee ? ' <span class="pm-sub">· ' + esc(x.assignee) + "</span>" : "") + (x.description ? '<div class="pm-sub">' + esc(x.description) + "</div>" : "") + "</span></div>";
  }).join("") : '<div class="pm-sub">No tasks for this item.</div>') +
    '<div style="margin-top:6px"><a class="pm-sub" href="project.html?id=' + esc(state.pid) + '&amp;tab=tasks">Open the Tasks tab →</a></div>';

  const docsSec = itemFiles.length ? itemFiles.map(function (f) {
    return '<div class="pm-file">' + (f.storage === "cloud" && f.path
      ? '<button type="button" class="lnk" data-doc="' + esc(f.id) + '">📄 ' + esc(f.name) + "</button>"
      : "<span>📄 " + esc(f.name) + "</span>") +
      '<span class="pm-sub" style="white-space:nowrap">' + (f.storage === "local" ? "On the office computers" : esc(fmtSize(f.size))) + "</span></div>";
  }).join("") : '<div class="pm-sub">No documents for this item.</div>';

  const flagger = canFlag(state.me);
  const f = l.flag;
  const late = f && f.due && f.due < t;
  const flagSec = (f ? '<div class="pm-flagtext' + (late ? " late" : "") + '">' + esc((f.state === "blocked" ? "⛔ BLOCKED" : f.state === "complete" ? "✓ COMPLETE" : "⚑ IMPORTANT") +
      (f.note ? " — " + f.note : "") + (f.due ? " · due " + C.fmtDay(f.due) + (late ? " · OVERDUE" : "") : "") +
      (f.by || f.at ? " · " + [f.by, f.at ? C.fmtDay(f.at) : ""].filter(Boolean).join(" ") : "")) + "</div>" : '<div class="pm-sub">No flag on this item.</div>') +
    (flagger ? '<div class="pm-acts" style="margin-top:8px">' +
      (f && f.state === "important" ? '<button class="btn btn-ghost btn-sm" type="button" data-flag="clear">Clear ⚑ important</button>' : '<button class="btn btn-ghost btn-sm" type="button" data-flag="important">⚑ Mark important…</button>') +
      (f && f.state === "blocked" ? '<button class="btn btn-ghost btn-sm" type="button" data-flag="clear">Clear BLOCKED</button>' : '<button class="btn btn-ghost btn-sm" type="button" data-flag="blocked">⛔ Mark blocked…</button>') +
      (f && f.state === "complete" ? '<button class="btn btn-ghost btn-sm" type="button" data-flag="clear">Un-mark complete</button>' : '<button class="btn btn-ghost btn-sm" type="button" data-flag="complete">✓ Mark item complete</button>') +
      "</div>" : "") +
    (canNote(state.me) ? '<div class="pm-h">Quick note (goes to the project log)</div><div class="pm-note-row">' +
      '<input id="pmNote" maxlength="1000" placeholder="e.g. rebar inspection passed" aria-label="Quick note">' +
      '<button class="btn btn-sm" type="button" id="pmNoteSave">Add</button></div>' : "") +
    '<div class="pm-msg" id="pmNoteMsg" role="status"></div>';

  d.innerHTML =
    '<div class="dh" style="border-left:4px solid var(--gc' + (l.colorSlot || 0) + ')"><div style="flex:1;min-width:0">' +
      '<div class="pm-dt">' + esc(l.name) + "</div>" +
      '<div class="pm-sub">' + esc([l.estimateName, l.groupName].filter(Boolean).join(" · ")) +
        (l.assignees.length ? " · " + esc(l.assignees.map(function (a) { return a.name; }).join(", ")) : " · unassigned") + "</div>" +
      '<a class="pm-sub" href="project.html?id=' + esc(state.pid) + '&amp;tab=estimate">See it in the Estimate tab →</a>' +
    "</div>" +
    '<button class="btn btn-ghost btn-sm" type="button" id="pmCopyLink" title="Copy the link to this item" aria-label="Copy the link to this item">🔗</button>' +
    '<button class="btn btn-ghost btn-sm" type="button" id="pmDrawerX" aria-label="Close">✕</button></div>' +
    '<div class="db">' +
      section("fin", "Financial overview", "", fin, true) +
      section("scope", "Scope", "", scope, false) +
      section("quotes", "Quotes & change orders", l.quotes.length || "", quotes, true) +
      section("costs", "Bills & costs", m.showMoney && (l.bills.length + costs.length) ? (l.bills.length + costs.length) + " · " + m$(costTotal) : "", costsSec, l.bills.length + costs.length > 0) +
      section("tasks", "Tasks", itemTasks.length || "", tasksSec, itemTasks.length > 0) +
      section("docs", "Documents", itemFiles.length || "", docsSec, false) +
      section("flag", "Flags & notes", f ? FLAG_LABELS[f.state] : "", flagSec, !!f || flagger) +
    "</div>";

  d.querySelectorAll(".pm-sec-hd").forEach(function (h) {
    h.addEventListener("click", function () {
      const sec = h.parentNode;
      sec.classList.toggle("open");
      h.setAttribute("aria-expanded", sec.classList.contains("open") ? "true" : "false");
      secSet(sec.dataset.sec, sec.classList.contains("open"));
    });
  });
  el("pmDrawerX").addEventListener("click", closeDrawer);
  el("pmCopyLink").addEventListener("click", function () {
    const url = location.origin + location.pathname + "?id=" + encodeURIComponent(state.pid) + "&item=" + encodeURIComponent(l.key);
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast("Link copied.", "ok"); }, function () {});
    this.textContent = "✓";
  });
  wireDrawer(l);
}

function wireDrawer(l) {
  const d = el("pmDrawer");
  d.querySelectorAll("[data-chase]").forEach(function (b) {
    b.addEventListener("click", async function () {
      const q = l.quotes.find(function (x) { return String(x.id) === String(b.dataset.chase); });
      if (!q) return;
      // record the chase FIRST (the date restarts the overdue clock), then open the mail - never the other way
      b.disabled = true;
      try { await pmRepo.followUp(q.id); }
      catch (e) { const m = el("qtMsg"); if (m) m.textContent = errorText(e); b.disabled = false; return; }
      toast("Follow-up recorded.", "ok");
      if (q.vendorEmail) {
        const mail = followUpMail(state.payload.project, l, q);
        const a = document.createElement("a");
        a.href = "mailto:" + encodeURIComponent(q.vendorEmail) + "?subject=" + encodeURIComponent(mail.subject) + "&body=" + encodeURIComponent(mail.body);
        a.hidden = true;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { a.remove(); }, 0);
      }
      await load().catch(showErr);
    });
  });
  d.querySelectorAll("[data-doc]").forEach(function (b) {
    b.addEventListener("click", async function () {
      const f = (state.payload.files || []).find(function (x) { return String(x.id) === String(b.dataset.doc); });
      if (!f) return;
      const w = window.open("", "_blank");
      try {
        const url = await filesRepo.signedUrl(f.path, SIGNED_DOC_S);
        if (!url) throw new Error("That document could not be opened.");
        if (w) { w.opener = null; w.location.href = url; } else location.href = url;
      } catch (e) { if (w) w.close(); toast(errorText(e), "error"); }
    });
  });
  d.querySelectorAll("[data-flag]").forEach(function (b) {
    b.addEventListener("click", function () { flagAction(l, b.dataset.flag); });
  });
  const save = el("pmNoteSave");
  if (save) save.addEventListener("click", async function () {
    const v = String(el("pmNote").value || "").trim();
    if (!v) return;
    save.disabled = true;
    try {
      // the item's name as the project log keeps it: the database's scrub rule for every role (map/pm.js logName) -
      // never an amount typed into the name, never this person's display mask stored for everyone (P5 check 5)
      const it = (state.payload.items || []).find(function (x) { return x.key === l.key; });
      await activityRepo.addNote(state.pid, "[" + ((it && it.logName) || "item") + "] " + v);
      el("pmNote").value = "";
      const m = el("pmNoteMsg");
      if (m) { m.textContent = "✓ Added to the project log"; m.classList.add("ok"); }
    } catch (e) {
      const m = el("pmNoteMsg");
      if (m) { m.textContent = errorText(e); m.classList.remove("ok"); }
    } finally { save.disabled = false; }
  });
}

async function flagAction(l, what) {
  const DCR2 = D();
  const msg = function (t) { const m = el("pmNoteMsg"); if (m) { m.textContent = t || ""; m.classList.remove("ok"); } };
  try {
    if (what === "clear") {
      await pmRepo.clearFlag(l.itemId, l.flag);
    } else if (what === "important") {
      const r = await DCR2.modal({
        title: "⚑ Mark important", message: "It shows on the chart, and turns red once the date passes.", okText: "Flag it",
        fields: [
          { name: "note", label: "What needs to happen?", placeholder: "e.g. inspection, order materials" },
          { name: "due", label: "Due date (optional)", type: "date" },
        ],
        validate: function (v) {
          if (!String(v.note || "").trim()) return "Say what needs to happen.";
          if (String(v.note).trim().length > FLAG_NOTE_MAX) return "Keep it under " + FLAG_NOTE_MAX + " characters.";
          return "";
        },
      });
      if (!r) return;
      await pmRepo.setFlag(l.itemId, "important", r.note, r.due || null, l.flag);
    } else if (what === "blocked") {
      const note = await DCR2.ask("What is it blocked on?", {
        title: "⛔ Mark blocked", okText: "Mark blocked", danger: true, placeholder: "e.g. waiting on the permit",
        validate: function (v) {
          const s = String(v.v || "").trim();
          return !s ? "Say what it is waiting on." : s.length > FLAG_NOTE_MAX ? "Keep it under " + FLAG_NOTE_MAX + " characters." : "";
        },
      });
      if (note === null) return;
      await pmRepo.setFlag(l.itemId, "blocked", note, null, l.flag);
    } else if (what === "complete") {
      if (!(await confirmBox("Every stage of this item will read as done.", { title: "Mark this whole item complete?", okText: "Mark complete" }))) return;
      await pmRepo.setFlag(l.itemId, "complete", null, null, l.flag);
    }
    await load();
  } catch (e) {
    msg(errorText(e));
    if (e && (e.code === "PT409" || e.status === 409)) { toast("Someone else changed this flag — showing theirs.", "error"); load().catch(function () {}); }
  }
}

function showErr(e) {
  el("pmRoot").innerHTML = '<div class="pm-empty">⚠ ' + esc(errorText(e)) +
    '<div style="margin-top:10px"><button class="btn btn-sm" type="button" id="pmRetry">Retry</button></div></div>';
  el("pmRetry").addEventListener("click", function () { start(); });
}

async function start() {
  if (!state.pid) { renderPicker().catch(showErr); return; }
  try {
    await load();
    const item = qs("item");
    if (item && laneOf(item)) openDrawer(item);
  } catch (e) { showErr(e); }
}

async function init() {
  const me = await boot("pm");
  state.me = me;
  state.mask = maskFor(me);
  state.prices = seesPrices(me);
  state.money = seesMoney(me);
  const id = qs("id");
  state.pid = id && /^\d{1,15}$/.test(id) ? id : null;
  el("pmOvl").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (el("pmPop").classList.contains("open")) { closePopover(); return; }
    if (el("pmDrawer").classList.contains("open")) closeDrawer();
  });
  document.addEventListener("fullscreenchange", function () {
    const b = el("pmFs");
    if (b) b.textContent = document.fullscreenElement ? "✕ Exit full screen" : "⛶ Full screen";
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && state.pid && state.fetchedAt && !state.loading && Date.now() - state.fetchedAt > REFRESH_AFTER_MS) load().catch(function () {});
  });
  await start();
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  const r = document.getElementById("pmRoot");
  if (r) r.innerHTML = '<div class="pm-empty">' + esc(errorText(e)) + "</div>";
});
