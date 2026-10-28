/* Project tab Expenses (P5b; MODULES §3 "Project tabs Expenses, Payments" — Redesign; BLUEPRINT 3.3.11
   "Expenses and Receipts (ledger)", "Printed expense report").

   The project's cost rows (DCR Desktop 2 `costs`, read with the financials switch), the old Expenses tab's
   flow: filter by estimate line, date period (company days) and words; sort by any column; grouped by line
   with a subtotal each and the grand (or filtered) total; Print hands exactly this view to
   report-expenses.html (the filter rides on the link with the window already resolved); CSV downloads exactly
   the rows on screen (formula guard, BOM, CRLF). Matching, sorting, grouping and totals are js/expense-filter.js
   — the printed sheet runs the very same code, so the paper cannot disagree with the screen.

   Cost = materials + subcontractor + labour; equipment and other rows have their own column and are not in
   Cost; billed-out money is not on this tab (Payments). Costs are added and corrected here or in DCR Desktop 2
   (owner decision 2026-10-24 D13): "＋ Add expense", ✎ on a row and ＋📎 (another receipt) for money editors
   (map/ledger.js canTag: an admin, or a manager or accountant with financials — the database refuses anyone
   else), in expense-dialog.js, fetched when first used. There is no delete: a wrong cost is corrected, or a
   negative credit added. A receipt goes through the upload queue (kept on this device until it is up; its
   progress shows in the row). Reconciled and the employee are kept on Expenses & receipts (ledger.html).
   Receipts (files.cost_id) open in a new tab.

   Loaded only for people with the financials switch (project.js imports it on demand). */

import * as EF from "../expense-filter.js";
import * as repo from "../repo/ledger.js";
import { ledgerCsvRows, csvText, canTag, cardLabel } from "../map/ledger.js";
import { ymd } from "../map/pacific.js";
import * as uploads from "./uploads.js";
import { RECEIPT_ACCEPT } from "../map/cost-form.js";

let host = null, seq = 0, timer = null, qTimer = null;
const st = { ctx: null, rows: null, f: EF.defaults(), view: [], queue: [], attachFor: null, unqueue: null };
/** the cost dialog and the receipt step (money code: fetched when first used) */
const dialog = () => import("./expense-dialog.js");

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = EF.money;
const num = EF.num;

export function render(ctx, el) {
  host = el;
  st.ctx = ctx;
  host.classList.add("pjm");
  // the filter: from the address first (a reload, Back, the report's ← Back), then this tab's memory
  let f = null;
  try { f = EF.fromQuery(new URLSearchParams(location.search)); } catch (e) { f = null; }
  st.f = f || EF.load(ctx.pid) || EF.defaults();
  host.innerHTML = '<div class="pj-empty">Loading expenses…</div>';
  host.addEventListener("click", onClick);
  host.addEventListener("change", onChange);
  host.addEventListener("input", onInput);
  load();
  if (canTag(ctx.me) && !st.unqueue) {
    // receipts on their way (the upload queue, kind receipt): their progress in the row; one landed: read again
    st.unqueue = true;
    uploads.onProgress(function (items, evt) {
      st.queue = items.filter((i) => i.costId !== null && String(i.projectId) === String(ctx.pid));
      paintQueue();
      if (evt && evt.type === "done" && evt.item && evt.item.costId !== null && evt.item.costId !== undefined) reload();
    }).then(function (off) { st.unqueue = off; }, function () {});
  }
}

/* the receipts still on their way, in each row's receipt cell (only those spans change: typing in the search box
   is not disturbed) */
function paintQueue() {
  if (!host) return;
  host.querySelectorAll("[data-rq]").forEach(function (n) {
    const mine = st.queue.filter((i) => String(i.costId) === n.getAttribute("data-rq"));
    if (!mine.length) { n.textContent = ""; n.title = ""; n.classList.remove("bad"); return; }
    const failed = mine.filter((i) => i.state === "failed");
    n.textContent = failed.length ? "⚠" : "⏳" + (mine.length === 1 ? " " + uploads.itemLabel(mine[0], navigator.onLine !== false) : " " + mine.length);
    n.title = failed.length ? (failed[0].error || "The receipt did not go up") + " — click to try again" : "A receipt is on its way";
    n.classList.toggle("bad", failed.length > 0);
  });
}

async function load() {
  if (!host) return;
  const my = ++seq;
  try {
    const rows = await repo.projectExpenses(st.ctx.pid, { prices: !!st.ctx.prices });   // the line's words (lineLabel)
    if (my !== seq) return;
    st.rows = rows;
    paint();
  } catch (e) {
    if (my !== seq) return;
    host.innerHTML = '<div class="pj-empty">' + esc(st.ctx.errorText(e)) + "</div>";
  }
}

/** A change arrived (live): read again, once per burst. */
export function reload() {
  if (!host) return;
  clearTimeout(timer);
  timer = setTimeout(load, 400);
}

function active() {
  const t = document.querySelector(".pj-tab.active");
  return t && t.getAttribute("data-tab") === "expenses";
}

// Remember the filter for this project: in the address (reload, Back and the report's ← Back land on the same
// view) and in sessionStorage (a plain refresh restores it too). Called from one place: paint.
function persist() {
  EF.save(st.ctx.pid, st.f);
  try {
    if (!active()) return;
    const u = new URL(location.href);
    u.searchParams.set("tab", "expenses");
    EF.applyToUrl(u, st.f);
    history.replaceState(history.state, "", u);
  } catch (e) { /* not important */ }
}

function paint() {
  if (!host || !st.rows) return;
  const all = st.rows, f = st.f, ctx = st.ctx;
  const today = ymd(new Date());
  const groups = [];
  all.forEach((r) => { const g = EF.groupOf(r); if (groups.indexOf(g) === -1) groups.push(g); });
  groups.sort((a, b) => (a === EF.NO_GROUP ? 1 : b === EF.NO_GROUP ? -1 : a < b ? -1 : a > b ? 1 : 0));
  if (f.group !== "*" && groups.indexOf(f.group) === -1) f.group = "*";
  persist();

  const p = ctx.project || {};
  const ledgerHref = "ledger.html?period=all&q=" + encodeURIComponent(p.internalIDNumber || "");
  const bar = '<div class="pj-bar">' +
    '<select class="pj-btn pj-btn-sm" id="exGroup" title="Filter by estimate line" aria-label="Estimate line">' +
      '<option value="*">All lines (' + groups.length + ")</option>" +
      groups.map((g) => '<option value="' + esc(g) + '"' + (f.group === g ? " selected" : "") + ">" + esc(g) + "</option>").join("") + "</select>" +
    '<select class="pj-btn pj-btn-sm" id="exRange" title="Filter by date" aria-label="Period">' +
      EF.PERIODS.map((x) => '<option value="' + x[0] + '"' + (f.range === x[0] ? " selected" : "") + ">" + esc(x[1]) + "</option>").join("") + "</select>" +
    '<span id="exCustom" style="' + (f.range === "custom" ? "display:inline-flex" : "display:none") + ';gap:6px;align-items:center;flex-wrap:wrap">' +
      '<input type="date" id="exFrom" class="pj-btn pj-btn-sm" value="' + esc(f.from) + '" aria-label="From">' +
      '<span class="pj-sub">to</span>' +
      '<input type="date" id="exTo" class="pj-btn pj-btn-sm" value="' + esc(f.to) + '" aria-label="To"></span>' +
    '<input class="pj-search" id="exSearch" placeholder="Search description, vendor, line…" value="' + esc(f.q) + '" aria-label="Search the expenses">' +
    (EF.isActive(f, today) ? '<button class="pj-btn pj-btn-sm" id="exClear" type="button">✕ Clear filters</button>' : "") +
    '<a class="pj-btn pj-btn-sm" id="exPrint" href="' + esc(EF.hrefWith("report-expenses.html", { id: ctx.pid }, f, true, today)) + '" title="Print what you see">🖨 Print</a>' +
    '<button class="pj-btn pj-btn-sm" id="exCsv" type="button" title="Download what you see as a spreadsheet">⤓ CSV</button>' +
    '<a class="pj-btn pj-btn-sm" href="' + esc(ledgerHref) + '" title="Paid with, reconciled, employees and receipts across every job">Expenses &amp; receipts →</a>' +
    (canTag(ctx.me) ? '<button class="pj-btn pj-btn-sm pj-btn-primary" id="exAdd" type="button">＋ Add expense</button>' +
      '<input type="file" id="exAttachIn" accept="' + RECEIPT_ACCEPT + '" hidden>' : "") +
    "</div>";
  const note = '<p class="pjm-note">Costs can be added here or in DCR Desktop 2 (the project\'s Money tab). Costs have no delete: correct one, ' +
    "or add a negative credit. Cost is materials, subcontractors and labour; " +
    "equipment and other rows are listed on their own. Vendor bills and client invoices are on the Payments tab." +
    (canTag(ctx.me) ? " Reconciled and the employee are kept on Expenses &amp; receipts." : "") + "</p>";

  if (!all.length) {
    host.innerHTML = bar + note + '<div class="pj-empty">No expense records for this project.' +
      (canTag(ctx.me) ? " “＋ Add expense” adds the first." : "") + "</div>";
    st.view = [];
    return;
  }
  // filter and sort ONCE, keep the result: the table, the CSV and the printed report read this same array
  const rows = EF.sort(EF.filter(all, f, today), f);
  st.view = rows;
  const t = EF.totals(rows);
  const filtered = EF.isActive(f, today);
  const summary = '<div class="pjm-sum">' +
    "<div><span>Records</span><b>" + rows.length + (rows.length !== all.length ? ' <small style="display:inline">of ' + all.length + "</small>" : "") + "</b></div>" +
    "<div><span>Materials</span><b>" + esc(money(t.mat)) + "</b></div>" +
    "<div><span>Subcontractors</span><b>" + esc(money(t.con)) + "</b></div>" +
    "<div><span>Labour</span><b>" + esc(money(t.lab)) + "</b></div>" +
    '<div class="hi"><span>' + (filtered ? "Cost shown" : "Cost to date") + "</span><b>" + esc(money(t.cost)) + "</b></div>" +
    '<div class="muted"><span>Equipment &amp; other</span><b>' + esc(money(t.oth)) + "</b><small>listed, not in cost</small></div>" +
    "</div>";
  if (!rows.length) {
    host.innerHTML = bar + note + summary + '<div class="pj-empty">No expenses match these filters.</div>';
    return;
  }

  const COLS = 8;
  const editor = canTag(ctx.me);
  let body = "";
  EF.group(rows).forEach((grp) => {
    const gt = EF.totals(grp.rows);
    body += '<tr class="grp"><td colspan="' + COLS + '">' + esc(grp.name) + ' <span class="pj-sub" style="font-weight:400;display:inline">· ' +
      grp.rows.length + " record" + (grp.rows.length === 1 ? "" : "s") + "</span></td></tr>";
    grp.rows.forEach((r) => {
      const desc = EF.stripML(EF.descOf(r));
      body += "<tr>" +
        '<td class="dt">' + esc(EF.fmtDay(r.date)) + "</td>" +
        "<td>" + esc(desc) + (r.kind !== "material" ? ' <span class="lg-kind">' + esc(r.kindLabel) + "</span>" : "") +
          (r.vendor && r.description ? '<span class="vd">' + esc(r.vendor) + "</span>" : "") +
          (r.kind === "labor" && r.hours && r.rate ? '<span class="vd">' + esc(r.hours + " h × " + money(r.rate)) + "</span>" : "") +
          (r.card !== "untagged" || r.reconciledAt ? '<span class="vd">' + esc([r.card !== "untagged" ? "Paid with " + cardLabel(r.card) : "",
            r.reconciledAt ? "reconciled" : ""].filter(Boolean).join(" · ")) + "</span>" : "") + "</td>" +
        '<td class="num">' + (num(r.materials) ? esc(money(r.materials)) : "") + "</td>" +
        '<td class="num">' + (num(r.contractors) ? esc(money(r.contractors)) : "") + "</td>" +
        '<td class="num">' + (num(r.labor) ? esc(money(r.labor)) : "") + "</td>" +
        '<td class="num" style="color:var(--mute)">' + (num(r.other) ? esc(money(r.other)) : "") + "</td>" +
        '<td class="num"><b>' + (num(r.cost) ? esc(money(r.cost)) : "—") + "</b></td>" +
        '<td style="white-space:nowrap">' + (r.receipts || []).map((fl, i) =>
          '<button type="button" class="lg-r on" data-receipt="' + esc(r.id) + ":" + i + '" title="' + esc(fl.name + " — open") + '" aria-label="' +
            esc("Open the receipt " + fl.name) + '">📎' + ((r.receipts.length > 1) ? '<sup class="lg-rn">' + (i + 1) + "</sup>" : "") + "</button>").join("") +
          (editor ? '<button type="button" class="lg-rq" data-rq="' + esc(r.id) + '" title=""></button>' +
            '<button type="button" class="lg-r on" data-attach="' + esc(r.id) + '" title="Add a receipt" aria-label="Add a receipt to this cost">＋📎</button>' +
            '<button type="button" class="lg-r on" data-edit="' + esc(r.id) + '" title="Correct this cost" aria-label="Correct this cost">✎</button>' : "") + "</td>" +
        "</tr>";
    });
    body += '<tr class="sub"><td colspan="2">Subtotal — ' + esc(grp.name) + '</td><td class="num">' + esc(money(gt.mat)) + '</td><td class="num">' +
      esc(money(gt.con)) + '</td><td class="num">' + esc(money(gt.lab)) + '</td><td class="num" style="color:var(--mute)">' + esc(money(gt.oth)) +
      '</td><td class="num">' + esc(money(gt.cost)) + "</td><td></td></tr>";
  });
  body += '<tr class="grand"><td colspan="2">' + (filtered ? "FILTERED TOTAL" : "GRAND TOTAL") + '</td><td class="num">' + esc(money(t.mat)) +
    '</td><td class="num">' + esc(money(t.con)) + '</td><td class="num">' + esc(money(t.lab)) + '</td><td class="num" style="color:var(--mute)">' +
    esc(money(t.oth)) + '</td><td class="num">' + esc(money(t.cost)) + "</td><td></td></tr>";
  const th = (key, label, cls) => {
    const on = f.sort === key;
    return '<th class="' + (cls || "") + '" data-sort="' + key + '" title="Sort" aria-sort="' + (on ? (f.dir > 0 ? "ascending" : "descending") : "none") + '">' +
      esc(label) + (on ? ' <span class="sortarrow">' + (f.dir > 0 ? "▲" : "▼") + "</span>" : "") + "</th>";
  };
  host.innerHTML = bar + note + summary + '<div class="pj-tblwrap"><table class="pj-tbl pjm-tbl"><thead><tr>' +
    th("date", "Date") + th("desc", "Description") + th("mat", "Materials", "num") + th("con", "Subs", "num") + th("lab", "Labour", "num") +
    th("oth", "Equip. / other", "num") + th("cost", "Cost", "num") + "<th>Receipt</th></tr></thead><tbody>" + body + "</tbody></table></div>";
  paintQueue();
}

/* ── events (delegated on the pane: the table is redrawn often) ── */
function onChange(e) {
  const t = e.target, f = st.f;
  if (!t || !t.id) return;
  if (t.id === "exAttachIn") { const file = t.files && t.files[0]; t.value = ""; attachPicked(file); return; }
  if (t.id === "exGroup") { f.group = t.value; paint(); }
  else if (t.id === "exRange") {
    f.range = t.value;
    f.pa = ""; f.pb = "";
    if (f.range === "custom" && !f.from && !f.to) {          // this month so far, in company days
      const today = ymd(new Date());
      f.from = today.slice(0, 8) + "01";
      f.to = today;
    }
    paint();
  } else if (t.id === "exFrom") { f.from = t.value; paint(); }
  else if (t.id === "exTo") { f.to = t.value; paint(); }
}
function onInput(e) {
  const t = e.target;
  if (!t || t.id !== "exSearch") return;
  st.f.q = t.value;
  clearTimeout(qTimer);
  qTimer = setTimeout(function () {
    paint();
    const box = document.getElementById("exSearch");
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  }, 250);
}
function onClick(e) {
  const t = e.target && e.target.closest ? e.target.closest("button, th[data-sort]") : null;
  if (!t || !host.contains(t)) return;
  const f = st.f;
  if (t.matches("th[data-sort]")) {
    const k = t.getAttribute("data-sort");
    if (f.sort === k) f.dir = -f.dir; else { f.sort = k; f.dir = k === "desc" ? 1 : -1; }
    paint();
  } else if (t.id === "exClear") {
    const d = EF.defaults();                     // keep the column they were sorting by
    d.sort = f.sort; d.dir = f.dir;
    st.f = d;
    paint();
  } else if (t.id === "exCsv") {
    const rows = st.view || [];
    if (!rows.length) return;
    const blob = new Blob(["\ufeff" + csvText(ledgerCsvRows(rows))], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "expenses-" + ((st.ctx.project && st.ctx.project.internalIDNumber) || st.ctx.pid) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  } else if (t.hasAttribute("data-receipt")) {
    const [rid, i] = t.getAttribute("data-receipt").split(":");
    const r = (st.rows || []).find((x) => String(x.id) === rid);
    openReceipt(r && r.receipts[Number(i)]);
  } else if (t.id === "exAdd") {
    openDialog(null);
  } else if (t.hasAttribute("data-edit")) {
    openDialog(t.getAttribute("data-edit"));
  } else if (t.hasAttribute("data-attach")) {
    st.attachFor = t.getAttribute("data-attach");
    const inp = document.getElementById("exAttachIn");
    if (inp) inp.click();
  } else if (t.hasAttribute("data-rq") && t.classList.contains("bad")) {
    uploads.retryAll();                           // a receipt that did not go up: try again
  }
}

/* Add / edit (expense-dialog.js, fetched now): this project's vendors are offered; after a save the list reads again
   (the costs watch does too) */
async function openDialog(costId) {
  const ctx = st.ctx;
  try {
    const m = await dialog();
    const vendors = (st.rows || []).map((r) => r.vendor).filter(Boolean);
    await m.openCostDialog(ctx, { costId: costId === null ? undefined : costId, vendors, onSaved: function () { reload(); } });
  } catch (e) { ctx.toast(ctx.errorText(e), "error"); }
}

async function attachPicked(file) {
  const id = st.attachFor;
  st.attachFor = null;
  if (!file || !id) return;
  try { const m = await dialog(); await m.attachReceipt(st.ctx, id, file); } catch (e) { st.ctx.toast(st.ctx.errorText(e), "error"); }
}

/* A new tab opened on the click itself (a pop-up blocker allows it), then sent to the signed URL (120 s). */
async function openReceipt(fl) {
  if (!fl) return;
  if (fl.storage === "local") { st.ctx.toast("This receipt is on the office computers.", "info"); return; }
  const w = window.open("", "_blank");
  try {
    const url = await repo.receiptUrl(fl, 120, false);
    if (!url) throw new Error("No link for this file.");
    if (w) { try { w.opener = null; } catch (x) { /* */ } w.location.href = url; } else location.href = url;
  } catch (err) {
    if (w) w.close();
    st.ctx.toast(st.ctx.errorText(err), "error");
  }
}
