/* Expenses & receipts — the accountant's ledger (port of the old ledger.html / ledger.js; BLUEPRINT 3.3.11
   "Expenses and Receipts (ledger)", MODULES §6 "ledger.html"; Redesign: DCR Desktop 2's costs + M5b).

   One dense table of every cost row the person may read, foldable by project, employee, card, month or kind.
   The summaries are group headers over these same rows (map/ledger.js groupRows / summarize), so a header
   and its rows are one piece of arithmetic. Cost = materials + subcontractor + labour; equipment and other
   rows are listed and totalled apart; billed-out money is shown greyed and never added.

   What changed from the old page:
   * the data is read once (repo/ledger.js loadLedger) and every period, search and grouping is worked out in
     the browser (map/ledger.js ledgerView) — the old server did the same over the same rows;
   * receipts come with the rows (files.cost_id): a row has its receipts or none — no second request, no
     folder walk, no "not checked yet"; images show in the viewer, other files open in a new tab (signed URLs,
     120 s; the security policy lets no page frame another site);
   * "Paid with", reconciled and the employee are written through M5b's RPCs (tag_costs, reconcile_costs,
     confirm_cost_employee), which the database allows to an admin, or a manager or accountant with
     financials; rows a write could not change are said, never dropped;
   * the CSV is built here, from exactly the rows on screen, with the formula guard, a BOM and CRLF.

   Who: the financials switch (app.can_financials — costs are read with it). Anyone else is told so and the
   page asks the database for nothing. */

import { boot, el, esc, toast, confirmBox, errorText, qs, setQs, seesPrices, D } from "./shell.js";
import * as repo from "../repo/ledger.js";
import {
  ledgerView, PERIODS, DIMENSIONS, CARDS, cardLabel, money, seesLedger, canTag, billedOut, ledgerCsvRows, csvText, stampDay,
} from "../map/ledger.js";
import { ymd, fmtDay } from "../map/pacific.js";

const state = {
  me: null, can: { tag: false }, data: null, view: null, period: "30", group: "none", q: "", zero: false,
  picked: {}, busy: false, hours: {}, today: ymd(new Date()),
};

function day(v) { const s = String(v || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? fmtDay(s) : ""; }
function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }

/* ── the controls ───────────────────────────────────────────────────── */
function chips() {
  const v = state.view;
  el("lgPeriods").innerHTML = PERIODS.map(function (p) {
    const n = v.counts[p.id];
    return '<button type="button" class="lg-chip" data-period="' + esc(p.id) + '" aria-pressed="' + (v.period === p.id ? "true" : "false") + '"><b>' +
      esc(p.label) + '</b><span class="n">' + (n === undefined ? "" : n) + "</span></button>";
  }).join("");
  const sel = el("lgGroup");
  if (!sel.options.length) {
    sel.innerHTML = DIMENSIONS.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.label) + "</option>"; }).join("");
  }
  sel.value = v.group;
}

/* Everything the screen is NOT showing, with its exact count: a hidden row on a money screen is a wrong number. */
function scope() {
  const v = state.view, x = v.excluded, bits = [];
  bits.push("<b>" + plural(v.totals.count, "record") + "</b> · <b>" + esc(money(v.totals.cost)) + "</b> cost" +
    (v.totals.other ? " · " + esc(money(v.totals.other)) + " equipment &amp; other, not in cost" : "") +
    (v.span ? " · " + esc(day(v.span.from)) + " – " + esc(day(v.span.to)) : ""));
  const hid = [];
  if (x.outsidePeriod) hid.push(x.outsidePeriod + " outside this period");
  if (x.noAmount) hid.push(x.noAmount + " with no amount recorded");
  if (hid.length) bits.push("Not shown: " + esc(hid.join(", ")) + ".");
  if (x.undated) {
    bits.push('<span class="warn">' + plural(x.undated, "record") + (x.undated === 1 ? " has" : " have") +
      " no date, so no period can include " + (x.undated === 1 ? "it" : "them") + " — use All records.</span>");
  }
  if (v.q && v.totals.count === 0 && v.matchesAllTime) {
    bits.push('<span class="warn">Nothing here for “' + esc(v.q) + "”, but " + v.matchesAllTime +
      ' in all records — <a href="#" id="lgAll">search all dates</a>.</span>');
  }
  el("lgScope").innerHTML = bits.join("<br>");
  const a = el("lgAll");
  if (a) a.addEventListener("click", function (e) { e.preventDefault(); state.period = "all"; refresh(); });
}

function totals() {
  const v = state.view, t = v.totals;
  const out = billedOut(state.data.invoices, v.bounds ? { from: v.bounds.from, to: v.bounds.to } : null);
  const cards = [
    ["Cost this period", money(t.cost), plural(t.count, "record"), ""],
    ["Materials", money(t.materials), "", ""],
    ["Labour", money(t.labor), "", ""],
    ["Subcontractors", money(t.contractors), "", ""],
    // listed and totalled, kept out of Cost (BLUEPRINT 3.3.11): dashed and grey, like billed out
    ["Equipment & other", money(t.other), "listed, not in cost", "muted"],
    // shown because she will look for it, greyed because adding it to a spend figure is how this data gets misread
    ["Billed out", money(out.total), "revenue, not a cost" + (out.count ? " · " + plural(out.count, "invoice") : ""), "muted"],
    ["Receipts", t.withReceipt + " of " + t.count, t.count ? (t.noReceipt ? t.noReceipt + " without a receipt" : "every row has one") : "",
      t.count && !t.withReceipt ? "muted" : ""],
    ["Paid-with tagged", t.tagged + " of " + t.count, t.tagged === 0 && t.count ? "nothing tagged yet" : "", t.tagged === 0 && t.count ? "muted" : ""],
    ["Reconciled", t.reconciled + " of " + t.count, "", ""],
  ];
  if (t.inferred) cards.push(["Employees inferred", String(t.inferred), "the database read them from the row's words — confirm them", "warn"]);
  el("lgTotals").innerHTML = cards.map(function (c) {
    return '<div class="lg-t' + (c[3] ? " " + c[3] : "") + '"><div class="k">' + esc(c[0]) + '</div><div class="v">' + esc(c[1]) + "</div>" +
      (c[2] ? '<div class="n">' + esc(c[2]) + "</div>" : "") + "</div>";
  }).join("");
}

/* ── the table ──────────────────────────────────────────────────────── */
const HEAD = [["Date", ""], ["Project", ""], ["Description", ""], ["Materials", "num"], ["Subs", "num"], ["Labour", "num"],
  ["Equip. / other", "num"], ["Cost", "num"], ["Paid with", ""], ["Employee", ""], ["Receipt", "ctr"], ["Rec.", "ctr"]];
function span() { return HEAD.length + (state.can.tag ? 1 : 0); }
function head() {
  return "<thead><tr>" + (state.can.tag ? '<th style="width:30px" aria-label="Pick"></th>' : "") +
    HEAD.map(function (h) { return "<th" + (h[1] ? ' class="' + h[1] + '"' : "") + ">" + esc(h[0]) + "</th>"; }).join("") + "</tr></thead>";
}
function amt(v, cls) { return '<td class="num' + (cls ? " " + cls : "") + '">' + (Number(v) ? esc(money(v)) : "") + "</td>"; }

function whoCell(r) {
  if (!r.employeeName) return "";
  const conf = r.employeeSource === "confirmed";
  let h = esc(r.employeeName) + ' <span class="lg-tag ' + (conf ? "rec" : "inf") + '" title="' +
    (conf ? "Recorded against this employee" : "Inferred by the database from the row's words — a lead, not a fact") + '">' +
    (conf ? "confirmed" : "inferred") + "</span>";
  if (!conf && state.can.tag) h += ' <button type="button" class="lg-conf" data-confirm="' + esc(r.id) + '" title="Record this row against an employee">confirm</button>';
  return h;
}
function receiptCell(r) {
  const n = (r.receipts || []).length;
  if (!n) return '<span class="lg-r none" title="No receipt is linked to this row">–</span>';
  return '<button type="button" class="lg-r on" data-row="' + esc(r.id) + '" aria-label="' + esc(plural(n, "receipt") + " — open") + '" title="' +
    esc(r.receipts.map(function (f) { return f.name; }).join("\n")) + (n > 1 ? "\n" + n + " files — click to open them" : "\nClick to open") + '">&#128206;' +
    (n > 1 ? '<sup class="lg-rn">' + n + "</sup>" : "") + "</button>";
}
function cardCell(r) {
  if (!state.can.tag) return esc(r.card === "untagged" ? "" : cardLabel(r.card));
  return '<select class="lg-card' + (r.card === "untagged" ? " untagged" : "") + '" data-card="' + esc(r.id) + '" aria-label="Paid with"' +
    (r.cardBy ? ' title="' + esc("Set by " + r.cardBy + (r.cardAt ? " · " + day(stampDay(r.cardAt)) : "")) + '"' : "") + ">" +
    CARDS.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === r.card ? " selected" : "") + ">" + esc(c.label) + "</option>"; }).join("") +
    (CARDS.some(function (c) { return c.id === r.card; }) ? "" : '<option value="' + esc(r.card) + '" selected>' + esc(r.card) + "</option>") + "</select>";
}
function recCell(r) {
  const tip = r.reconciledAt ? "Reconciled " + day(stampDay(r.reconciledAt)) + (r.reconciledBy ? " by " + r.reconciledBy : "") : "Mark reconciled";
  if (!state.can.tag) return r.reconciledAt ? '<span title="' + esc(tip) + '">&#10003;</span>' : "";
  return '<input type="checkbox" data-rec="' + esc(r.id) + '"' + (r.reconciledAt ? " checked" : "") + ' title="' + esc(tip) + '" aria-label="' + esc(tip) + '">';
}
function row(r) {
  const kind = r.kind === "material" ? "" : '<span class="lg-kind">' + esc(r.kindLabel) + "</span>";
  const basis = r.kind === "labor" && r.hours && r.rate ? '<span class="vd">' + esc(r.hours + " h × " + money(r.rate)) + "</span>" : "";
  return "<tr" + (r.amount ? "" : ' class="zero"') + ">" +
    (state.can.tag ? '<td class="ctr"><input type="checkbox" data-pick="' + esc(r.id) + '"' + (state.picked[r.id] ? " checked" : "") +
      ' aria-label="Pick this row"></td>' : "") +
    '<td class="dt">' + esc(day(r.date) || "no date") + "</td>" +
    '<td class="proj"><a href="project.html?id=' + encodeURIComponent(r.projectId) + '&amp;tab=expenses">' + esc(r.projectLabel) + "</a></td>" +
    '<td class="desc">' + esc(r.description || r.vendor || r.kindLabel) + kind +
      (r.vendor && r.description ? '<span class="vd">' + esc(r.vendor) + "</span>" : "") + basis +
      (r.group ? '<span class="vd">Line: ' + esc(r.group) + "</span>" : "") + "</td>" +
    amt(r.materials) + amt(r.contractors) + amt(r.labor) + amt(r.other, "out") +
    '<td class="num cost">' + (r.cost ? esc(money(r.cost)) : "—") + "</td>" +
    '<td class="pw">' + cardCell(r) + "</td>" +
    '<td class="who">' + whoCell(r) + "</td>" +
    '<td class="ctr">' + receiptCell(r) + "</td>" +
    '<td class="ctr">' + recCell(r) + "</td></tr>";
}

function render() {
  const d = state.data;
  state.view = ledgerView(d.rows, { period: state.period, q: state.q, group: state.group, zero: state.zero, today: state.today });
  const v = state.view;
  chips();
  scope();
  totals();
  if (!v.rows.length) {
    el("lgBody").innerHTML = '<div class="lg-none">' + (v.q ? "Nothing matches that in this period." : "No expenses recorded in this period.") + "</div>";
  } else if (v.groups) {
    el("lgBody").innerHTML = '<table class="lg-t2">' + head() + "<tbody>" + v.groups.map(function (g) {
      return '<tr class="lg-grp' + (g.pinned ? " pin" : "") + '"><td colspan="' + span() + '"><span class="lbl">' + esc(g.label) + "</span>" +
        '<span class="sub">' + esc(money(g.cost)) + " cost" + (g.other ? " · " + esc(money(g.other)) + " equipment &amp; other" : "") +
        " · " + plural(g.count, "record") + (g.withReceipt ? " · " + g.withReceipt + " with a receipt" : "") +
        (g.reconciled ? " · " + g.reconciled + " reconciled" : "") + (g.source === "inferred" ? " · inferred, not confirmed" : "") + "</span></td></tr>" +
        g.rows.map(row).join("");
    }).join("") + "</tbody></table>";
  } else {
    el("lgBody").innerHTML = '<table class="lg-t2">' + head() + "<tbody>" + v.rows.map(row).join("") + "</tbody></table>";
  }
  el("lgSpan").textContent = v.span ? day(v.span.from) + " – " + day(v.span.to) : "no dated records";
  el("lgSpan").hidden = false;
  cant();
  hours();
  bulk();
  wire();
  setQs("period", state.period === "30" ? "" : state.period);
  setQs("group", state.group === "none" ? "" : state.group);
  setQs("q", state.q);
}

/* Said once, plainly, rather than leaving her to discover each absence by looking for it and finding nothing. */
function cant() {
  el("lgCant").innerHTML = [
    "Employee spend, except where a row is <b>confirmed</b>. A name the database read from a labour row's words is a lead and says <b>inferred</b>.",
    "Labour cost from hours. No employee pay rate is stored, so hours stay hours.",
    "Card spend, until rows are tagged. Set “Paid with” on a row and this screen starts answering it.",
    "Vendor bills. They are on The Books and on each project's Payments tab — this ledger is the job cost rows.",
    "Equipment and other rows are listed and totalled on their own; Cost is materials, subcontractors and labour.",
    "Sales tax, mileage and depreciation — none of it is recorded.",
    "Anything from QuickBooks. Nothing here talks to Intuit; The Books is where the hand-off lives.",
  ].map(function (c) { return "<li>" + c + "</li>"; }).join("");
}

/* Hours by employee for the same period, beside the money and never mixed into it. */
async function hours() {
  const box = el("lgHours");
  const b = state.view.bounds;
  const key = b ? b.from + "|" + b.to : "all";
  const paint = function (h) {
    if (key !== (state.view.bounds ? state.view.bounds.from + "|" + state.view.bounds.to : "all")) return;
    box.innerHTML = h.rows.length
      ? h.rows.map(function (x) { return '<div class="lg-hrow"><span>' + esc(x.name) + "</span><b>" + esc(x.hours.toFixed(2)) + " h</b></div>"; }).join("") +
        '<div class="lg-hrow" style="border:0"><span><b>Total</b></span><b>' + esc(h.total.toFixed(2)) + " h</b></div>"
      : '<div class="lg-cant" style="padding:0">No timesheet hours in this period.</div>';
  };
  if (state.hours[key]) { paint(state.hours[key]); return; }
  box.innerHTML = '<div class="lg-cant" style="padding:0">Reading the timesheets…</div>';
  try {
    state.hours[key] = await repo.hoursBetween(b ? b.from : null, b ? b.to : null);
    paint(state.hours[key]);
  } catch (e) {
    box.innerHTML = '<div class="lg-cant" style="padding:0">' + esc(errorText(e)) + "</div>";
  }
}

/* Tagging a hundred rows one at a time is how a column stays empty forever, so "Paid with" and reconciled are
   also bulk actions (up to 1,000 rows at a time, M5b's limit). The selection is cleared on every reload, so a tag can never
   land on rows she scrolled away from two filters ago. */
function bulk() {
  const ids = Object.keys(state.picked);
  const bar = el("lgBulk");
  bar.hidden = !state.can.tag || ids.length === 0;
  if (bar.hidden) return;
  const sum = state.data.rows.filter(function (r) { return state.picked[r.id]; }).reduce(function (t, r) { return t + Math.round(r.cost * 100); }, 0) / 100;
  el("lgBulkN").textContent = plural(ids.length, "row") + " selected · " + money(sum) + " cost";
  const sel = el("lgBulkCard");
  if (!sel.options.length) {
    sel.innerHTML = '<option value="">Set “Paid with”…</option>' + CARDS.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.label) + "</option>";
    }).join("");
  }
  el("lgBulkApply").disabled = ids.length > repo.MAX_IDS;
  el("lgBulkRec").disabled = ids.length > repo.MAX_IDS;
  el("lgBulkMsg").textContent = ids.length > repo.MAX_IDS ? "At most " + repo.MAX_IDS + " rows at a time." : "";
}

/* ── actions ────────────────────────────────────────────────────────── */
function rowById(id) { return state.data.rows.find(function (r) { return String(r.id) === String(id); }) || null; }

function wire() {
  document.querySelectorAll("[data-period]").forEach(function (b) {
    b.addEventListener("click", function () { state.period = b.getAttribute("data-period"); refresh(); });
  });
  if (!state.can.tag) { wireReceipts(); return; }
  document.querySelectorAll("[data-card]").forEach(function (s) {
    s.addEventListener("change", function () { write("tag", [s.getAttribute("data-card")], s.value); });
  });
  document.querySelectorAll("[data-rec]").forEach(function (c) {
    c.addEventListener("change", function () { write("reconcile", [c.getAttribute("data-rec")], c.checked); });
  });
  document.querySelectorAll("[data-pick]").forEach(function (c) {
    c.addEventListener("change", function () {
      const id = c.getAttribute("data-pick");
      if (c.checked) state.picked[id] = true; else delete state.picked[id];
      bulk();
    });
  });
  document.querySelectorAll("[data-confirm]").forEach(function (a) {
    a.addEventListener("click", function () { confirmWho(rowById(a.getAttribute("data-confirm"))); });
  });
  wireReceipts();
}

async function confirmWho(r) {
  if (!r) return;
  const list = (state.data.employees || []).filter(function (e) { return e.active !== false || String(e.id) === String(r.employeeId); });
  let empId = r.employeeId;
  const modal = D().modal;
  if (typeof modal === "function") {
    const got = await modal({
      title: "Record the employee",
      message: "“" + (r.description || r.kindLabel) + "” (" + day(r.date) + "). It stops being a guess and becomes the stored employee.",
      fields: [{ name: "emp", type: "select", label: "Employee", value: r.employeeId == null ? "" : String(r.employeeId),
        options: [{ value: "", label: "Choose…" }].concat(list.map(function (e) { return { value: String(e.id), label: e.full_name }; })) }],
      okText: "Record it",
      validate: function (v) { return v.emp ? "" : "Choose the employee."; },
    });
    if (!got) return;
    empId = got.emp;
  } else if (!(await confirmBox("Record this row against " + r.employeeName + "? It stops being a guess and becomes the stored employee.", { okText: "Record it" }))) {
    return;
  }
  await write("employee", [r.id], empId, r);
}

/* Writes go one after the other: a box ticked while the last change is still saving is saved next, never
   dropped (the control already shows it). Each reads the rows again before the next one starts. */
let queue = Promise.resolve();
function write(op, ids, value, row) {
  queue = queue.then(function () { return doWrite(op, ids, value, row); }, function () { return doWrite(op, ids, value, row); });
  return queue;
}
async function doWrite(op, ids, value, row) {
  state.busy = true;
  let res = null;
  try {
    // a reconciled row whose card changes is not reconciled any more (the database clears it): said, not hidden
    const wasRec = op === "tag" ? ids.filter(function (id) { const r = rowById(id); return r && r.reconciledAt && r.card !== value; }) : [];
    if (op === "tag") res = await repo.tagCosts(ids, value);
    else if (op === "reconcile") res = await repo.reconcileCosts(ids, value);
    else if (op === "employee") res = await repo.confirmEmployee(ids, value);
    state.picked = {};
    await load();
    const cleared = wasRec.filter(function (id) { const r = rowById(id); return r && !r.reconciledAt; }).length;
    if (res && res.refused && res.refused.length) {
      toast(plural(res.refused.length, "row") + " could not be changed: " + res.refused[0].reason, "error");
    } else if (res) {
      const many = ids.length > 1 ? " on " + plural(res.changed, "row") + (res.unchanged ? " (" + res.unchanged + " already so)" : "") : "";
      toast((op === "tag" ? "✓ “Paid with” saved" + many
        : op === "reconcile" ? (value ? "✓ Marked reconciled" : "Reconciled mark cleared") + many
          : "✓ Employee recorded") + (cleared ? " · " + plural(cleared, "reconciled mark") + " cleared: the card changed" : ""), "ok");
    }
  } catch (e) {
    toast(errorText(e), "error");
    await load();
  }
  state.busy = false;
}

/* ── looking at the paperwork ───────────────────────────────────────────
   One file becomes a URL at a time, on demand (a signed URL is a credential that expires): the table only
   carries ids and storage paths. Cached for a little less than the URL lives, so sweeping the mouse down a
   column does not ask again for the same picture. */
const urlCache = {};
function fileUrl(f, preview) {
  const key = f.id + (preview ? "p" : "");
  const hit = urlCache[key];
  if (hit && hit.until > Date.now()) return hit.p;
  const p = repo.receiptUrl(f, 120, preview).catch(function (e) { delete urlCache[key]; throw e; });
  urlCache[key] = { p: p, until: Date.now() + 100000 };
  return p;
}
function isImage(f) { return /^image\//.test(f.mime || "") || /\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name || ""); }
function isPdf(f) { return /pdf/.test(f.mime || "") || /\.pdf$/i.test(f.name || ""); }

let peekTimer = null, peekFor = null;
function peekHide() {
  clearTimeout(peekTimer);
  peekFor = null;
  el("lgPeek").hidden = true;
}
function peekShow(anchor, f) {
  const p = el("lgPeek");
  if (!f) return;
  peekFor = f.id;
  p.hidden = false;
  p.innerHTML = '<div class="nm">' + esc(f.name) + '</div><div class="bd">Loading…</div>';
  // to the left of the icon, flipped when it would fall off an edge
  const r = anchor.getBoundingClientRect();
  const w = Math.min(340, innerWidth - 24), h = 320;
  let left = r.left - w - 14;
  if (left < 12) left = Math.min(r.right + 14, innerWidth - w - 12);
  p.style.left = Math.max(12, left) + "px";
  p.style.top = Math.max(12, Math.min(r.top - 10, innerHeight - h - 12)) + "px";
  if (f.storage === "local") { p.querySelector(".bd").textContent = "On the office computers"; return; }
  if (!isImage(f)) { p.querySelector(".bd").innerHTML = '<div class="doc">' + (isPdf(f) ? "PDF" : "FILE") + "<span>click to open</span></div>"; return; }
  fileUrl(f, true).then(function (url) {
    if (peekFor !== f.id) return;                                  // she moved on before it arrived
    const bd = p.querySelector(".bd");
    if (!url) { bd.textContent = "No preview available."; return; }
    bd.innerHTML = "";
    const img = document.createElement("img");
    img.alt = "";
    img.src = url;
    bd.appendChild(img);
  }, function () { if (peekFor === f.id) p.querySelector(".bd").textContent = "Could not load it."; });
}

function wireReceipts() {
  document.querySelectorAll("[data-row]").forEach(function (a) {
    const r = rowById(a.getAttribute("data-row"));
    if (!r) return;
    a.addEventListener("click", function (e) { e.preventDefault(); peekHide(); viewShow(r.receipts, 0); });
    a.addEventListener("mouseenter", function () { clearTimeout(peekTimer); peekTimer = setTimeout(function () { peekShow(a, r.receipts[0]); }, 260); });
    a.addEventListener("mouseleave", peekHide);
    a.addEventListener("blur", peekHide);
  });
}

const view = { files: [], at: 0 };
function viewClose() { el("lgView").hidden = true; view.files = []; }
async function viewShow(files, at) {
  if (!files || !files.length) return;
  view.files = files;
  view.at = Math.max(0, Math.min(at || 0, files.length - 1));
  const f = files[view.at];
  el("lgView").hidden = false;
  el("lgViewName").textContent = f.name;
  el("lgViewN").textContent = files.length > 1 ? (view.at + 1) + " of " + files.length : "";
  el("lgViewPrev").hidden = files.length < 2;
  el("lgViewNext").hidden = files.length < 2;
  el("lgViewOpen").hidden = f.storage === "local";
  const box = el("lgViewBody");
  if (f.storage === "local") { box.innerHTML = '<div class="wait">This file is on the office computers: open it there.</div>'; return; }
  if (!isImage(f)) {
    box.innerHTML = '<div class="wait">' + (isPdf(f) ? "A PDF opens in its own tab." : "This kind of file opens in its own tab.") +
      '<br><button type="button" class="lg-b go" id="lgViewOpen2">Open ' + esc(f.name) + " &#8599;</button></div>";
    el("lgViewOpen2").addEventListener("click", function () { openTab(f); });
    return;
  }
  box.innerHTML = '<div class="wait">Loading…</div>';
  try {
    const url = await fileUrl(f, false);
    if (view.files[view.at] !== f) return;
    if (!url) throw new Error("No link for this file.");
    box.innerHTML = "";
    const img = document.createElement("img");
    img.alt = f.name;
    img.src = url;
    box.appendChild(img);
  } catch (e) {
    box.innerHTML = '<div class="wait">' + esc(errorText(e)) + "</div>";
  }
}
/* A new tab opened on the click itself (a pop-up blocker allows it), then sent to the signed URL. */
async function openTab(f) {
  if (!f || f.storage === "local") return;
  const w = window.open("", "_blank");
  try {
    const url = await repo.receiptUrl(f, 120, false);
    if (!url) throw new Error("No link for this file.");
    if (w) { try { w.opener = null; } catch (e) { /* */ } w.location.href = url; } else location.href = url;
  } catch (e) {
    if (w) w.close();
    toast(errorText(e), "error");
  }
}

/* ── the CSV: exactly the rows on screen ────────────────────────────── */
function exportCsv() {
  const rows = state.view ? state.view.rows : [];
  if (!rows.length) { toast("Nothing on screen to export.", "info"); return; }
  const blob = new Blob(["\ufeff" + csvText(ledgerCsvRows(rows))], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "dcr-expenses-" + state.today + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
}

/* ── load ───────────────────────────────────────────────────────────── */
function refresh() { state.picked = {}; render(); }

async function load() {
  try {
    state.data = await repo.loadLedger({ prices: seesPrices(state.me) });   // the lines' words (lineLabel)
    state.today = ymd(new Date());
    render();
  } catch (e) {
    el("lgBody").innerHTML = '<div class="lg-none" style="color:var(--err)">' + esc(errorText(e) || "Could not open the expense ledger.") + "</div>";
    el("lgTotals").innerHTML = "";
  }
}

let liveTimer = null;
async function startLive() {
  let live;
  try { live = await import("../live.js"); } catch (e) { return; }
  if (typeof live.watch !== "function") return;
  const again = function () {
    if (state.busy) return;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { if (!state.busy) load(); }, 700);
  };
  try {
    live.watch("costs", null, again);
    live.watch("files", "folder=eq.receipts", again);
  } catch (e) { /* the page reads again when opened */ }
}

async function init() {
  state.me = await boot("books");
  if (!seesLedger(state.me)) {
    el("lgDenied").hidden = false;
    el("lgDenied").innerHTML = "<b>The expense ledger shows money.</b><br>It is for people with the financials switch " +
      "(an admin turns it on in DCR Desktop 2, Users). Nothing was read.";
    return;
  }
  state.can.tag = canTag(state.me);
  const p = qs("period");
  if (p && PERIODS.some(function (x) { return x.id === p; })) state.period = p;
  const g = qs("group");
  if (g && DIMENSIONS.some(function (x) { return x.id === g; })) state.group = g;
  state.q = (qs("q") || "").slice(0, 200);
  el("lgQ").value = state.q;
  el("lgMain").hidden = false;

  el("lgBulkClear").addEventListener("click", function () { state.picked = {}; render(); });
  el("lgBulkApply").addEventListener("click", function () {
    const card = el("lgBulkCard").value;
    const ids = Object.keys(state.picked);
    if (!card || !ids.length) { toast("Choose the “Paid with” first.", "info"); return; }
    write("tag", ids, card);
  });
  el("lgBulkRec").addEventListener("click", function () {
    const ids = Object.keys(state.picked);
    if (ids.length) write("reconcile", ids, true);
  });
  el("lgViewClose").addEventListener("click", viewClose);
  el("lgViewOpen").addEventListener("click", function () { openTab(view.files[view.at]); });
  el("lgView").addEventListener("click", function (e) { if (e.target === el("lgView")) viewClose(); });
  el("lgViewPrev").addEventListener("click", function () { viewShow(view.files, view.at - 1); });
  el("lgViewNext").addEventListener("click", function () { viewShow(view.files, view.at + 1); });
  document.addEventListener("keydown", function (e) {
    if (el("lgView").hidden) return;
    if (e.key === "Escape") viewClose();
    else if (e.key === "ArrowLeft") viewShow(view.files, view.at - 1);
    else if (e.key === "ArrowRight") viewShow(view.files, view.at + 1);
  });
  el("lgGroup").addEventListener("change", function () { state.group = el("lgGroup").value; refresh(); });
  el("lgZero").addEventListener("change", function () { state.zero = el("lgZero").checked; refresh(); });
  let qTimer = null;
  el("lgQ").addEventListener("input", function () {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { state.q = el("lgQ").value.trim(); refresh(); }, 250);
  });
  el("lgCsv").addEventListener("click", exportCsv);
  await load();
  startLive();
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  const b = document.getElementById("lgBody");
  if (b) b.innerHTML = '<div class="lg-none">' + esc(errorText(e)) + "</div>";
});
