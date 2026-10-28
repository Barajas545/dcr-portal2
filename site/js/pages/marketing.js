/* Marketing Tasks (port of the old marketing.html / marketing.js — the billable part of the Access MarketingBoard;
   BLUEPRINT 3.3.11 "Marketing tasks", Q17, MODULES §5 "marketing.html").

   The same page: the Open / Completed / Not invoiced / Not paid / All chips, the totals line, the table grouped by
   project with the Done / Invoiced / Paid marks, and for the office New, Edit and Delete. What changed:
   * the data is M5c's `marketing_tasks` through repo/marketing.js; every edit is versioned;
   * Q17: the PRICE is money. It lives in `marketing_task_prices` under the financials switch: the price column, the
     totals line and the form's price box exist only for a person with financials (admin, the accountant, a manager
     given financials). Nobody else is sent a price — the page does not even ask for it — and its HTML holds none.
     In the old portal the view-only accounts and managers saw prices; that is the change the owner chose;
   * a phone shows each task as a card (no table to scroll sideways);
   * who: admin, manager, accountant and view-only read; admin and manager write. A lead or field account is told the
     list is the office's. */

import { boot, el, esc, toast, confirmBox, errorText, store, maskFor } from "./shell.js";
import * as repo from "../repo/marketing.js";
import {
  readsMarketing, writesMarketing, seesPrice, FILTERS, FLAGS, groups, totals, projectLabel, resolveProject, fmtMoney, GENERAL,
} from "../map/marketing.js";
import { ymd, fmtDay } from "../map/pacific.js";
import { fill, valueOf } from "../map/masked-form.js";

const TEXT = ["marketingTaskName", "marketingTaskCaterogy", "marketingTaskDescripiton", "marketingTaskCompletedWork"];
const MARK_LABEL = { marketingTaskMarkComplete: "✓ Done", marketingTaskCheckInvoiced: "Invoiced", marketingTaskCheckPaid: "Paid" };
const MARK_COL = { marketingTaskMarkComplete: "Done", marketingTaskCheckInvoiced: "Invoiced", marketingTaskCheckPaid: "Paid" };
const FILTER_KEY = "dcr2_marketing_filter";
const state = { me: null, tasks: [], projects: [], byId: {}, canWrite: false, prices: false, q: "", filter: "open", editing: null, busy: false,
  mask: function (t) { return t == null ? "" : String(t); } };

function today() { return ymd(new Date()); }
function taskById(id) { return state.tasks.find(function (t) { return String(t.id) === String(id); }) || null; }
function put(t) { const i = state.tasks.findIndex(function (x) { return String(x.id) === String(t.id); }); if (i === -1) state.tasks.push(t); else state.tasks[i] = t; }
function counts() {
  const out = {};
  FILTERS.forEach(function (f) { out[f[0]] = groups(state.tasks, { filter: f[0], byId: state.byId }).reduce(function (n, g) { return n + g.rows.length; }, 0); });
  return out;
}

function mark(t, key) {
  const on = !!t[key];
  if (!state.canWrite) return '<span class="mk-tgl ro" aria-pressed="' + (on ? "true" : "false") + '">' + esc(MARK_LABEL[key]) + "</span>";
  return '<button type="button" class="mk-tgl" aria-pressed="' + (on ? "true" : "false") + '" data-tgl="' + esc(t.id) + '" data-field="' + esc(key) + '">' +
    esc(MARK_LABEL[key]) + "</button>";
}

function render() {
  const n = counts();
  el("mkChips").innerHTML = FILTERS.map(function (f) {
    return '<button type="button" class="ls-chip" data-f="' + esc(f[0]) + '" aria-pressed="' + (state.filter === f[0] ? "true" : "false") + '">' +
      esc(f[1]) + '<span class="n">' + n[f[0]] + "</span></button>";
  }).join("");

  // totals across ALL tasks (not the filter) — only for a person who sees prices
  if (state.prices) {
    const t = totals(state.tasks);
    el("mkTotals").innerHTML = "<span>Open: <b>" + esc(fmtMoney(t.open)) + "</b></span><span>Done, not invoiced: <b>" + esc(fmtMoney(t.uninv)) +
      "</b></span><span>Invoiced, not paid: <b>" + esc(fmtMoney(t.unpaid)) + '</b></span><span class="paid">Paid: <b>' + esc(fmtMoney(t.paid)) + "</b></span>" +
      (t.unpriced ? "<span>" + t.unpriced + " without a price</span>" : "");
    el("mkTotals").hidden = false;
  } else {
    el("mkTotals").hidden = true;
    el("mkTotals").innerHTML = "";
  }

  const gs = groups(state.tasks, { filter: state.filter, q: state.q, byId: state.byId, mask: state.mask });
  if (!gs.length) { el("mkList").innerHTML = '<div class="ls-empty">No tasks match.</div>'; return; }
  const cols = 6 + (state.prices ? 1 : 0) + (state.canWrite ? 1 : 0);
  let body = "";
  gs.forEach(function (g) {
    const head = g.label === GENERAL || !state.byId[String(g.pid)]
      ? esc(g.label)
      : '<a href="project.html?id=' + encodeURIComponent(g.pid) + '">' + esc(g.label) + "</a>";
    body += '<tr class="mk-grp"><td colspan="' + cols + '">' + head + "</td></tr>";
    g.rows.forEach(function (x) {
      body += '<tr class="mk-row" data-task="' + esc(x.id) + '"><td class="mk-first">' + "<b>" + esc(state.mask(x.marketingTaskName) || "—") + "</b>" +
        (x.marketingTaskDescripiton ? '<br><span class="desc">' + esc(state.mask(x.marketingTaskDescripiton)) + "</span>" : "") +
        (x.marketingTaskCompletedWork ? '<br><span class="desc">Done: ' + esc(state.mask(x.marketingTaskCompletedWork)) + "</span>" : "") + "</td>" +
        '<td data-l="Category">' + esc(state.mask(x.marketingTaskCaterogy)) + "</td>" +
        '<td data-l="Date">' + esc(x.marketingTaskDate ? fmtDay(x.marketingTaskDate) : "—") +
          (x.marketingTaskMarkComplete
            // an old task the import brought done without its day keeps none (M5c): never a made-up date
            ? '<br><span class="desc">' + (x.marketingTaskCompletedDate ? "done " + esc(fmtDay(x.marketingTaskCompletedDate)) : "done (date not recorded)") + "</span>"
            : "") + "</td>" +
        (state.prices ? '<td class="num" data-l="Price">' + (x.marketingTaskPrice !== null ? esc(fmtMoney(x.marketingTaskPrice)) : '<span class="desc">—</span>') + "</td>" : "") +
        FLAGS.map(function (k) { return '<td class="mk-mark" data-l="' + esc(MARK_COL[k]) + '">' + mark(x, k) + "</td>"; }).join("") +
        (state.canWrite ? '<td><div class="mk-acts"><button class="ls-btn ls-btn-sm" type="button" data-edit="' + esc(x.id) + '" aria-label="Edit this task" title="Edit">&#9998;</button>' +
          '<button class="ls-btn ls-btn-sm ls-btn-danger" type="button" data-del="' + esc(x.id) + '" aria-label="Delete this task" title="Delete">&#128465;</button></div></td>' : "") +
        "</tr>";
    });
  });
  el("mkList").innerHTML = '<div class="mk-tblwrap"><table class="mk-tbl"><thead><tr>' +
    "<th>Task</th><th>Category</th><th>Date</th>" + (state.prices ? '<th class="num">Price</th>' : "") +
    "<th>Done</th><th>Invoiced</th><th>Paid</th>" + (state.canWrite ? "<th></th>" : "") + "</tr></thead><tbody>" + body + "</tbody></table></div>";
}

/* ── writes ── */
async function failed(e, t) {
  toast(errorText(e), "error");
  if (e && e.current) { put(e.current); render(); }
  else if (e && (e.code === "PT404" || e.status === 404) && t) { state.tasks = state.tasks.filter(function (x) { return x !== t; }); render(); }
}

async function toggle(id, key) {
  const t = taskById(id);
  if (!t || state.busy) return;
  state.busy = true;
  try { put(await repo.toggleMark(t, key)); render(); }
  catch (e) { await failed(e, t); }
  state.busy = false;
}

function openForm(id) {
  state.editing = id ? taskById(id) : null;
  el("mkModalTitle").textContent = id ? "Edit marketing task" : "New marketing task";
  el("mkModalMsg").textContent = "";
  TEXT.forEach(function (f) { fill(el("mf_" + f), state.editing ? state.editing[f] || "" : "", state.mask); });
  el("mf_marketingTaskDate").value = state.editing ? state.editing.marketingTaskDate || "" : today();
  el("mfPriceRow").hidden = !state.prices;
  el("mf_marketingTaskPrice").value = state.prices && state.editing && state.editing.marketingTaskPrice !== null ? String(state.editing.marketingTaskPrice) : "";
  el("mf_project").value = state.editing && state.editing.projectID !== null ? projectLabel(state.editing.projectID, state.byId) : "";
  el("mkProjects").innerHTML = state.projects.map(function (p) {
    return '<option value="' + esc((p.internalIDNumber || "") + " — " + (p.projectName || "")) + '"></option>';
  }).join("");
  const cats = {};
  state.tasks.forEach(function (x) { if (x.marketingTaskCaterogy) cats[x.marketingTaskCaterogy] = 1; });
  el("mkCats").innerHTML = Object.keys(cats).sort().map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join("");
  el("mkModal").classList.add("open");
  el("mf_marketingTaskName").focus();
}

async function save(e) {
  e.preventDefault();
  if (state.busy) return;
  const f = {};
  TEXT.forEach(function (k) { f[k] = valueOf(el("mf_" + k), state.editing ? state.editing[k] : ""); });
  f.marketingTaskDate = el("mf_marketingTaskDate").value;
  if (!f.marketingTaskName.trim()) { el("mkModalMsg").textContent = "Task name is required."; el("mf_marketingTaskName").focus(); return; }
  const pid = resolveProject(el("mf_project").value, state.projects);
  if (pid === undefined) {
    // a project the box does not know: kept when it is the one already linked (a project the person cannot read now)
    if (state.editing && el("mf_project").value === projectLabel(state.editing.projectID, state.byId)) f.projectID = state.editing.projectID;
    else { el("mkModalMsg").textContent = "Pick the project from the list, or leave it empty for general marketing."; el("mf_project").focus(); return; }
  } else f.projectID = pid;
  const price = state.prices ? el("mf_marketingTaskPrice").value : undefined;
  state.busy = true;
  el("mkSave").disabled = true;
  el("mkModalMsg").textContent = "";
  try {
    const got = state.editing ? await repo.updateTask(state.editing, f, price) : await repo.addTask(f, price, today());
    put(got.task);
    render();
    if (got.priceError) {
      state.editing = got.task;
      el("mkModalTitle").textContent = "Edit marketing task";
      el("mkModalMsg").textContent = "The task was saved, but not its price: " + errorText(got.priceError);
    } else {
      el("mkModal").classList.remove("open");
      toast(state.editing ? "Task saved." : "Task added.", "ok");
    }
  } catch (err) {
    el("mkModalMsg").textContent = errorText(err);
    if (err && err.current) { put(err.current); state.editing = err.current; render(); }
  }
  el("mkSave").disabled = false;
  state.busy = false;
}

async function del(id) {
  const t = taskById(id);
  if (!t) return;
  const ok = await confirmBox("This cannot be undone.", { title: "Delete “" + (state.mask(t.marketingTaskName) || "this task") + "”?", danger: true, okText: "Delete" });
  if (!ok) return;
  try {
    await repo.deleteTask(t);
    state.tasks = state.tasks.filter(function (x) { return x !== t; });
    render();
    toast("Task deleted.", "ok");
  } catch (e) { await failed(e, t); }
}

/* ── live: another person's change is read again (Realtime, M5c publishes these tables), once per burst, never while a
   form is open or a write is on its way (it waits for that) ── */
let liveTimer = null;
function liveChange(modals) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(function again() {
    if (state.busy || modals.some(function (id) { return el(id).classList.contains("open"); })) { liveTimer = setTimeout(again, 1500); return; }
    load(true);
  }, 700);
}
async function goLive(tables, modals) {
  try {
    const live = await import("../live.js");
    tables.forEach(function (t) {
      let joined = false;
      live.watch(t, null, function (evt) {
        if (!evt || evt.type === "LOST") return;
        if (evt.type === "SUBSCRIBED" && !joined) { joined = true; return; }   // the first read is load()
        liveChange(modals);
      });
    });
  } catch (e) { /* no live updates: the refresh button reads again */ }
}

/* ── data ── */
/** quiet (a live change): what is on screen stays when the read fails */
async function load(quiet) {
  try {
    const d = await repo.loadMarketing({ prices: state.prices });
    state.tasks = d.tasks;
    state.projects = (d.projects || []).slice().sort(function (a, b) { return String(b.internalIDNumber || "").localeCompare(String(a.internalIDNumber || ""), "en", { numeric: true }); });
    state.byId = {};
    (d.projects || []).forEach(function (p) { state.byId[String(p.id)] = p; });
    render();
  } catch (e) {
    if (quiet === true && state.tasks.length) return;
    el("mkList").innerHTML = '<div class="ls-empty">' + esc(errorText(e)) + "</div>";
  }
}

async function init() {
  const me = await boot("marketing");
  state.me = me;
  if (!readsMarketing(me)) {
    el("mkDenied").innerHTML = "<b>Marketing tasks are kept by the office.</b> The list is open to admins, managers, the accountant " +
      "and view-only accounts.";
    el("mkDenied").hidden = false;
    el("mkRefresh").hidden = true;
    el("mkSearch").hidden = true;
    return;
  }
  state.canWrite = writesMarketing(me);
  state.prices = seesPrice(me);
  state.mask = maskFor(me);              // amounts typed into the words: "(amount hidden)" without the prices switch (display only, Q28)
  const f = store.get(FILTER_KEY, "open");
  state.filter = FILTERS.some(function (x) { return x[0] === f; }) ? f : "open";
  el("mkMain").hidden = false;
  el("mkNewBtn").hidden = !state.canWrite;
  el("mkNoPrices").hidden = state.prices;
  el("mkSearch").addEventListener("input", function () { state.q = this.value; render(); });
  el("mkRefresh").addEventListener("click", function () { load(); });
  el("mkNewBtn").addEventListener("click", function () { openForm(null); });
  el("mkCancel").addEventListener("click", function () { el("mkModal").classList.remove("open"); });
  el("mkForm").addEventListener("submit", save);
  el("mkModal").addEventListener("click", function (e) { if (e.target === el("mkModal")) el("mkModal").classList.remove("open"); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") el("mkModal").classList.remove("open"); });
  el("mkChips").addEventListener("click", function (e) {
    const c = e.target.closest && e.target.closest("[data-f]");
    if (!c) return;
    state.filter = c.getAttribute("data-f");
    store.set(FILTER_KEY, state.filter);
    render();
  });
  el("mkList").addEventListener("click", function (e) {
    const b = e.target.closest && e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-tgl")) toggle(b.getAttribute("data-tgl"), b.getAttribute("data-field"));
    else if (b.hasAttribute("data-edit")) openForm(b.getAttribute("data-edit"));
    else if (b.hasAttribute("data-del")) del(b.getAttribute("data-del"));
  });
  goLive(["marketing_tasks"].concat(state.prices ? ["marketing_task_prices"] : []), ["mkModal"]);
  await load();
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  const l = document.getElementById("mkList");
  if (l) { l.innerHTML = '<div class="ls-empty">' + esc(errorText(e)) + "</div>"; document.getElementById("mkMain").hidden = false; }
});
