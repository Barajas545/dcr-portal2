/* Project page (port of the old project.html / project.js; MODULES §3 "project.html").

   Header: number — name, address · city · client, the status (a menu for admin and manager: a
   versioned move, the trigger writes the log line), the picture through a signed URL, the project
   switcher (every project, searchable by number, name, client, address, phone, e-mail), the "Old
   portal" link of an imported project (its old estimates, money and documents stay there), and
   who else has this project open (presence — Desktop 2 sees Portal 2 users here and the other way
   round: view "project:<id>", project "<id>"). For admin and manager (D13, owner 2026-10-24): 📷 changes the
   picture (thumb-prep.js makes it in the browser: at most 800 px, re-drawn so no EXIF / GPS goes up, JPEG or PNG;
   repo/files addThumbnail, then the versioned pointer; ✕ takes it off) and "＋ New project" opens the Board's
   dialog (new-project.js). Owner decisions 2026-10-26: when the project's takeoff folder holds a .takeoff file, the
   header shows "📐 Plans ↗" (beside the progress chart, so it is there on every tab; js/pages/plan-buttons.js, one
   plans_for call) opening takeoff-web at its number - for everyone who sees the project; nothing when the broker does
   not answer. The Takeoffs tab keeps its own Plans Archive link either way.

   Tabs (P1): Overview (Desktop 2's fields, autosaved with versions; the labor rate only with the
   prices switch), Log, Journal, Mailing, Files (with the capture bar; Part 4: the project's OneDrive folder through
   the broker, js/repo/onedrive.js - its host is in this page's connect-src only); P3: Tasks (the project's
   tasks, the tick through complete_task, a new task, the updates); P5a: Estimate and Takeoffs (read only,
   Q12: the estimates, change orders and takeoffs as DCR Desktop 2 has them, the amounts only for people
   who see prices, Print to report-estimate.html / report-takeoff.html); P5b: Expenses (the project's cost rows,
   filtered, printed to report-expenses.html, as CSV) and Payments (vendor bills and their payments, invoices and
   the client's payments) — only for people with the financials switch (the database reads them nobody else):
   their buttons stay hidden, a ?tab= link to them opens the Overview, and their code and stylesheet are fetched
   only when one is opened (a crew phone never downloads them).

   Live: the project row, its activity, journal, files and tasks (and their notes) are watched; a
   change made elsewhere lands in place (an untouched field takes it, a field being edited meets the
   conflict rule). */

import { boot, el, esc, toast, confirmBox, errorText, can, maskFor, seesPrices, qs, setQs, D } from "./shell.js";
import { presenceColor } from "../common2.js";
import * as projectsRepo from "../repo/projects.js";
import * as filesRepo from "../repo/files.js";
import { nameBook } from "../repo/people.js";
import { STATUS_ORDER, statusLabel, statusColor } from "../map/status.js";
import { projectTitle, switcherLabel } from "../map/projects.js";
import { oldPortalUrl } from "../map/legacy.js";
import * as overview from "./project-overview.js";
import * as logTab from "./project-log.js";
import * as journalTab from "./project-journal.js";
import * as mailingTab from "./project-mailing.js";
import * as filesTab from "./project-files.js";
import * as tasksTab from "./project-tasks.js";
import * as estimateTab from "./project-estimate.js";
import * as takeoffsTab from "./project-takeoffs.js";
import { startSweeper } from "./journal-sync.js";
import { openNewProject, takeNotice } from "./new-project.js";
import { paintPlans } from "./plan-buttons.js";

const TABS = ["overview", "estimate", "takeoffs", "log", "journal", "mailing", "files", "tasks", "expenses", "payments"];
const MONEY_TABS = ["expenses", "payments"];
/** app.can_financials() for hiding the money tabs (map/ledger.js seesLedger; kept here so the page's static
    code stays what a crew phone keeps offline) */
function seesMoney(me) { return !!me && me.active !== false && me.role !== "agents" && (me.role === "admin" || !!me.can_see_financials); }
const ALIASES = { logs: "log", estimates: "estimate", takeoff: "takeoffs" };

const ctx = {
  pid: null, project: null, me: null, mask: null,
  canWrite: false, canLog: false, canJournal: false, canFiles: false, prices: false, money: false,
  editing: false,
  live: null,
  refreshHeader: function () { renderHead(); },
  setProject: function (p) { setProject(p); },
  setEditing: function (on) { setEditing(on); },
  toast: toast, confirm: confirmBox, errorText: errorText, esc: esc, el: el,
};
const loaded = {};

function setProject(p) {
  if (!p) return;
  if (ctx.project && Number(p.version || 0) < Number(ctx.project.version || 0)) return;
  if (ctx.project && p.prices === undefined) { p.prices = ctx.project.prices; p.projectLaborRate = ctx.project.projectLaborRate; }
  const picture = !ctx.project || String(ctx.project.thumbnailFileId) !== String(p.thumbnailFileId);
  ctx.project = p;
  renderHead();
  overview.adopt(ctx, p);
  if (picture) loadThumb();                  // the picture changed here or elsewhere (live)
}

/* ── header ─────────────────────────────────────────────────────────── */
function renderHead() {
  const p = ctx.project;
  if (!p) return;
  document.title = "DCR — " + (p.internalIDNumber || "") + " " + (p.projectName || "");
  el("pjTitle").textContent = projectTitle(p);
  el("pjSub").textContent = [p.projectAddress, p.projectCity, p.projectClientName].filter(Boolean).join(" · ");
  const st = el("pjStatus");
  st.style.setProperty("--st", statusColor(p.status));
  if (ctx.canWrite) {
    st.innerHTML = '<select id="pjStatusSel" aria-label="Project status">' + STATUS_ORDER.map(function (s) {
      return '<option value="' + s + '"' + (s === p.status ? " selected" : "") + ">" + esc(statusLabel(s)) + "</option>";
    }).join("") + "</select>";
    el("pjStatusSel").addEventListener("change", changeStatus);
  } else {
    st.textContent = p.statusLabel;
  }
  const old = oldPortalUrl(p);
  const a = el("pjOldPortal");
  a.hidden = !old;
  if (old) a.href = old;
  const pm = el("pjPm");
  if (pm) pm.href = "pm.html?id=" + encodeURIComponent(p.id);
}

async function changeStatus() {
  const sel = el("pjStatusSel");
  const want = sel.value;
  const p = ctx.project;
  if (!p || want === p.status) return;
  sel.disabled = true;
  try {
    const moved = await projectsRepo.setStatus(p, want);
    setProject(moved);
    notice("ok", "✓ Status updated (logged)");
    logTab.reload(ctx);
  } catch (e) {
    if (e && e.code === "PT409" && e.current) {
      setProject(e.current);
      const nameOf = await nameBook();
      const who = (nameOf(e.current.updatedBy) || "Someone").split(/\s+/)[0];
      notice("err", who + " changed it first — it's in " + e.current.statusLabel + " now.");
    } else {
      renderHead();
      notice("err", errorText(e));
    }
  }
  const s2 = el("pjStatusSel");
  if (s2) s2.disabled = false;
}

function notice(kind, text) {
  const m = el("pjNotice");
  m.textContent = text;
  m.className = "pj-msg " + (kind || "");
  if (kind === "ok") setTimeout(function () { if (m.textContent === text) m.textContent = ""; }, 3500);
}

async function loadThumb() {
  const box = el("pjThumb");
  const p = ctx.project;
  const del = el("pjThumbDel");
  if (del) del.hidden = !ctx.canWrite || !p || p.thumbnailFileId == null;
  if (!p || p.thumbnailFileId == null) { box.textContent = "no preview"; return; }
  try {
    const urls = await filesRepo.thumbnailUrls([p]);
    const u = urls[String(p.id)];
    box.innerHTML = u ? '<img src="' + esc(u) + '" alt="">' : "no preview";
  } catch (e) { box.textContent = "no preview"; }
}

/* The picture: made in the browser (thumb-prep.js, fetched when needed), straight to Storage with its files row,
   then the project's pointer (one versioned column). A pointer that cannot be set takes its new file back (best
   effort, as DCR Desktop 2 does). */
let thumbBusy = false;
function thumbState(on) {
  thumbBusy = on;
  el("pjThumb").classList.toggle("busy", on);
  ["pjThumbEdit", "pjThumbDel"].forEach(function (id) { const b = el(id); if (b) b.disabled = on; });
}
async function changeThumb(file) {
  if (!file || thumbBusy || !ctx.project) return;
  thumbState(true);
  notice("", "Making the picture…");
  let row = null;
  try {
    const pic = await (await import("../thumb-prep.js")).prepare(file);
    row = await filesRepo.addThumbnail(ctx.project.id, pic);
    const moved = await projectsRepo.setThumbnail(ctx.project, row.id);
    filesRepo.forgetThumbnails();
    setProject(moved);                            // draws the new picture
    notice("ok", "✓ Picture changed");
  } catch (e) {
    if (row) { try { await filesRepo.removeFile(row); } catch (x) { /* it stays an unused older picture */ } }
    notice("err", e && e.code === "23514" ? "That file is not a live picture of this project." : errorText(e));
  }
  thumbState(false);
}
async function dropThumb() {
  if (thumbBusy || !ctx.project || ctx.project.thumbnailFileId == null) return;
  if (!(await confirmBox("Take this project's picture off? The picture file stays in the project's history.", { title: "Take the picture off", okText: "Take it off" }))) return;
  thumbState(true);
  try {
    const moved = await projectsRepo.setThumbnail(ctx.project, null);
    filesRepo.forgetThumbnails();
    setProject(moved);
    notice("ok", "✓ Picture taken off");
  } catch (e) { notice("err", errorText(e)); }
  thumbState(false);
}

/* ── switcher ───────────────────────────────────────────────────────── */
async function loadSwitcher() {
  let list = [];
  try { list = await projectsRepo.loadProjects(); } catch (e) { return; }
  el("pjJumpList").innerHTML = list.map(function (p) { return '<option value="' + esc(switcherLabel(p)) + '"></option>'; }).join("");
  function jump() {
    const v = el("pjJump").value.trim().toLowerCase();
    if (!v) return;
    const hit = list.find(function (p) { return switcherLabel(p).toLowerCase() === v; }) ||
      list.find(function (p) { return String(p.internalIDNumber || "").toLowerCase() === v; }) ||
      list.find(function (p) { return switcherLabel(p).toLowerCase().indexOf(v) !== -1; });
    if (hit && String(hit.id) !== String(ctx.pid)) location.href = "project.html?id=" + encodeURIComponent(hit.id);
  }
  el("pjJump").addEventListener("change", jump);
  el("pjJump").addEventListener("keydown", function (e) { if (e.key === "Enter") jump(); });
}

/* ── tabs ───────────────────────────────────────────────────────────── */
function activeTab() {
  const t = document.querySelector(".pj-tab.active");
  return t ? t.getAttribute("data-tab") : "overview";
}

function switchTab(name) {
  name = ALIASES[name] || name;
  if (TABS.indexOf(name) === -1 || (MONEY_TABS.indexOf(name) !== -1 && !ctx.money)) name = "overview";
  document.querySelectorAll(".pj-tab").forEach(function (t) {
    const on = t.getAttribute("data-tab") === name;
    t.classList.toggle("active", on);
    // a phone's tab strip scrolls: the open tab (Tasks, from a link) is brought into view
    if (on && t.scrollIntoView) { try { t.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) { /* */ } }
  });
  document.querySelectorAll(".pj-pane").forEach(function (p) { p.classList.toggle("active", p.id === "pane-" + name); });
  setQs("tab", name === "overview" ? "" : name);
  loadTab(name);
}

function loadTab(name) {
  if (loaded[name]) return;
  loaded[name] = true;
  if (name === "overview") overview.render(ctx, el("pane-overview"));
  else if (name === "log") logTab.render(ctx, el("pane-log"));
  else if (name === "journal") journalTab.render(ctx, el("pane-journal"));
  else if (name === "mailing") mailingTab.render(ctx, el("pane-mailing"));
  else if (name === "files") filesTab.render(ctx, el("pane-files"));
  else if (name === "tasks") { tasksTab.render(ctx, el("pane-tasks")); watchTasks(); }
  else if (name === "estimate") { estimateTab.render(ctx, el("pane-estimate")); watchEstimates(); }
  else if (name === "takeoffs") { takeoffsTab.render(ctx, el("pane-takeoffs")); watchTakeoffs(); }
  else if (MONEY_TABS.indexOf(name) !== -1) openMoneyTab(name);
}

/* P5b: the money tabs, fetched on demand with their stylesheet (financials only) */
const moneyTabs = {};
function ledgerCss() {
  return new Promise(function (done) {
    if (document.getElementById("pjLedgerCss")) { done(); return; }
    const l = document.createElement("link");
    l.id = "pjLedgerCss"; l.rel = "stylesheet"; l.href = "css/ledger.css";
    l.addEventListener("load", function () { done(); });
    l.addEventListener("error", function () { done(); });
    document.head.appendChild(l);
  });
}
async function openMoneyTab(name) {
  const pane = el("pane-" + name);
  if (!ctx.money) { pane.innerHTML = '<div class="pj-empty">This tab shows money: it needs the financials switch.</div>'; return; }
  try {
    const [m] = await Promise.all([name === "expenses" ? import("./project-expenses.js") : import("./project-payments.js"), ledgerCss()]);
    moneyTabs[name] = m;
    m.render(ctx, pane);
    watchMoney();
  } catch (e) {
    loaded[name] = false;
    pane.innerHTML = '<div class="pj-empty">' + esc(errorText(e)) + "</div>";
  }
}
let moneyWatched = false;
function watchMoney() {
  const live = ctx.live;
  if (moneyWatched || !live || typeof live.watch !== "function" || !ctx.money) return;
  moneyWatched = true;
  const f = "project_id=eq." + ctx.pid;
  const again = function (which) { return function () { const m = moneyTabs[which]; if (m && typeof m.reload === "function") m.reload(ctx); }; };
  try {
    live.watch("costs", f, again("expenses"));               // (a receipt linked or replaced: the files watch below)
    live.watch("bills", f, again("payments"));
    live.watch("payments", f, again("payments"));
    live.watch("invoices", f, again("payments"));
  } catch (e) { /* the tabs read again when opened */ }
}

/* the Estimate and Takeoffs tabs' live channels, only once each tab has been opened: the project's rows,
   and the price rows only for a person who sees prices (they carry the item / row id alone) */
let estWatched = false, tkWatched = false;
function watchEstimates() {
  const live = ctx.live;
  if (estWatched || !live || typeof live.watch !== "function") return;
  estWatched = true;
  const f = "project_id=eq." + ctx.pid;
  try {
    live.watch("estimates", f, function () { estimateTab.reload(ctx); });
    live.watch("estimate_items", f, function () { estimateTab.reload(ctx); });
    live.watch("estimate_item_flags", f, function () { estimateTab.reload(ctx); });   // M5a: a flag set on the progress chart
    if (ctx.prices) {
      live.watch("estimate_item_prices", null, function (evt) {
        const row = evt && (evt.new || evt.old);
        if (!row || evt.type === "SUBSCRIBED" || estimateTab.hasItem(row.item_id)) estimateTab.reload(ctx);
      });
    }
  } catch (e) { /* the tab reads again when opened */ }
}
function watchTakeoffs() {
  const live = ctx.live;
  if (tkWatched || !live || typeof live.watch !== "function") return;
  tkWatched = true;
  const f = "project_id=eq." + ctx.pid;
  try {
    live.watch("takeoffs", f, function () { takeoffsTab.reload(ctx); });
    live.watch("takeoff_rows", f, function () { takeoffsTab.reload(ctx); });
    if (ctx.prices) {
      live.watch("takeoff_row_prices", null, function (evt) {
        const row = evt && (evt.new || evt.old);
        if (!row || evt.type === "SUBSCRIBED" || takeoffsTab.hasRow(row.row_id)) takeoffsTab.reload(ctx);
      });
    }
  } catch (e) { /* the tab reads again when opened */ }
}

/* the Tasks tab's live channels, only once the tab has been opened (a phone holds no channel it does
   not need): the project's tasks, and notes of the tasks the tab shows */
let tasksWatched = false;
function watchTasks() {
  const live = ctx.live;
  if (tasksWatched || !live || typeof live.watch !== "function") return;
  tasksWatched = true;
  try {
    live.watch("tasks", "project_id=eq." + ctx.pid, function () { tasksTab.reload(ctx); });
    live.watch("task_notes", null, function (evt) {
      const row = evt && (evt.new || evt.old);
      if (!row || evt.type === "SUBSCRIBED" || tasksTab.hasTask(row.task_id)) tasksTab.reload(ctx);
    });
  } catch (e) { /* the tab reads again when opened */ }
}

/* ── presence ───────────────────────────────────────────────────────── */
function setEditing(on) {
  on = !!on;
  if (on === ctx.editing) return;
  ctx.editing = on;
  announce();
}

function announce() {
  if (!ctx.live || typeof ctx.live.presence !== "function") return;
  try { ctx.live.presence("project:" + ctx.pid, { editing: ctx.editing, project: String(ctx.pid) }); } catch (e) { /* presence is a nicety */ }
}

function people(raw) {
  // live.onPresence may hand a list of states or a map {user_id: state | [metas]}
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object") {
    Object.keys(raw).forEach(function (k) {
      const v = raw[k];
      if (Array.isArray(v)) v.forEach(function (m) { list.push(Object.assign({ user_id: k }, m)); });
      else if (v && typeof v === "object") list.push(Object.assign({ user_id: k }, v));
    });
  }
  const here = {};
  list.forEach(function (s) {
    if (!s || !s.user_id || (ctx.me && String(s.user_id) === String(ctx.me.id))) return;
    const onIt = String(s.project || "") === String(ctx.pid) || String(s.view || "") === "project:" + ctx.pid ||
      (Array.isArray(s.projects) && s.projects.map(String).indexOf(String(ctx.pid)) !== -1);
    if (!onIt) return;
    const uid = String(s.user_id);
    const prev = here[uid];
    // every field of a presence payload is what that device says about itself: a label, never markup
    // or style (a colour that is not "#rrggbb" is not drawn; the name of a known person is the one
    // the profiles table has)
    here[uid] = { id: uid, name: presenceName(uid, s.name), color: presenceColor(s.color),
      editing: !!(s.editing || (prev && prev.editing)) };
  });
  return Object.keys(here).map(function (k) { return here[k]; });
}

let nameOfPerson = null;
function presenceName(uid, said) {
  let known = "";
  try { known = nameOfPerson ? String(nameOfPerson(uid) || "") : ""; } catch (e) { known = ""; }
  const text = known || (typeof said === "string" ? said : "");
  return text.replace(/\s+/g, " ").trim().slice(0, 60) || "Someone";
}

let lastPresence = null;
function paintPresence(raw) {
  lastPresence = raw;
  const ps = people(raw);
  const box = el("pjHere");
  box.textContent = "";
  if (!ps.length) { box.hidden = true; el("pjEditing").hidden = true; return; }
  box.hidden = false;
  ps.slice(0, 5).forEach(function (s) {
    const ini = s.name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase();
    const av = document.createElement("span");
    av.className = "pj-av";
    av.style.background = s.color;
    av.title = s.name + (s.editing ? " is editing" : " has this project open");
    av.textContent = ini || "?";
    if (s.editing) {
      const pen = document.createElement("i");
      pen.className = "pj-av-pen";
      pen.textContent = "✎";
      av.appendChild(pen);
    }
    box.appendChild(av);
  });
  if (ps.length > 5) {
    const more = document.createElement("span");
    more.className = "pj-av more";
    more.textContent = "+" + (ps.length - 5);
    box.appendChild(more);
  }
  const editors = ps.filter(function (s) { return s.editing; });
  const ban = el("pjEditing");
  if (editors.length) {
    ban.hidden = false;
    ban.textContent = editors.map(function (s) { return s.name.split(/\s+/)[0]; }).join(", ") +
      (editors.length === 1 ? " is" : " are") + " editing this project right now.";
  } else ban.hidden = true;
}

async function startLive() {
  let live;
  try { live = await import("../live.js"); } catch (e) { return; }
  ctx.live = live;
  // names of known people for the avatars (never waited for: presence starts at once)
  nameBook().then(function (fn) { nameOfPerson = fn; if (lastPresence) paintPresence(lastPresence); }, function () {});
  const f = "project_id=eq." + ctx.pid;
  try {
    if (typeof live.watch === "function") {
      live.watch("projects", "id=eq." + ctx.pid, function (evt) {
        const row = evt && (evt.new || evt.record);
        if (!row || row.id == null) {                       // (re)joined: read again
          projectsRepo.getProject(ctx.pid).then(setProject, function () {});
          return;
        }
        if (String(row.id) !== String(ctx.pid)) return;
        if (row.deleted_at) { notice("err", "This project was deleted."); return; }
        setProject(projectsRepo.fromLive(row, ctx.project));
      });
      live.watch("activity", f, function () { logTab.reload(ctx); });
      live.watch("journal_entries", f, function () { journalTab.reload(ctx); });
      live.watch("files", f, function (evt) {
        filesTab.reload(ctx, evt); journalTab.reload(ctx, { media: true });     // (evt: the OneDrive box reads again for a OneDrive row only)
        if (moneyTabs.expenses && typeof moneyTabs.expenses.reload === "function") moneyTabs.expenses.reload(ctx);   // a receipt (files.cost_id)
      });
      if (loaded.tasks) watchTasks();
      if (loaded.estimate) watchEstimates();
      if (loaded.takeoffs) watchTakeoffs();
      if (loaded.expenses || loaded.payments) watchMoney();
    }
    if (typeof live.onPresence === "function") live.onPresence(paintPresence);
  } catch (e) { /* live updates are a nicety; the page works without them */ }
  announce();
}

/* ── init ───────────────────────────────────────────────────────────── */
async function init() {
  ctx.pid = qs("id");
  ctx.me = await boot("board");
  ctx.mask = maskFor(ctx.me);
  ctx.canWrite = can(ctx.me, "projects");
  ctx.canLog = can(ctx.me, "activity");
  ctx.canJournal = can(ctx.me, "journal");
  ctx.canFiles = can(ctx.me, "files");
  ctx.prices = seesPrices(ctx.me);
  ctx.money = seesMoney(ctx.me);
  MONEY_TABS.forEach(function (t) {
    const b = document.querySelector('.pj-tab[data-tab="' + t + '"]');
    if (b) b.hidden = !ctx.money;
  });
  if (!ctx.pid || !/^\d{1,18}$/.test(ctx.pid)) {
    el("pjTitle").textContent = "No project selected";
    el("pane-overview").innerHTML = '<div class="pj-empty">Open a project from the <a href="board.html">Board</a> or <a href="search.html">Search</a>.</div>';
    return;
  }
  document.querySelectorAll(".pj-tab").forEach(function (t) {
    t.addEventListener("click", function () { switchTab(t.getAttribute("data-tab")); });
  });
  el("pjSave").hidden = !ctx.canWrite;            // only the office edits project details
  el("pjSave").addEventListener("click", function () { overview.flush(ctx); });
  el("pjNew").hidden = !ctx.canWrite;             // create_project: admin, manager (the database decides)
  el("pjNew").addEventListener("click", function () { openNewProject(ctx.me); });
  el("pjThumbEdit").hidden = !ctx.canWrite;       // the picture: can_edit('projects') (rows, Storage, the pointer)
  el("pjThumbEdit").addEventListener("click", function () { el("pjThumbIn").click(); });
  el("pjThumbIn").addEventListener("change", function () {
    const f = this.files && this.files[0];
    this.value = "";
    changeThumb(f);
  });
  el("pjThumbDel").addEventListener("click", dropThumb);
  try {
    ctx.project = await projectsRepo.getProject(ctx.pid);
  } catch (e) {
    el("pjTitle").textContent = e && e.code === "PT404" ? "Project not found" : "Could not open the project";
    el("pane-overview").innerHTML = '<div class="pj-empty">' + esc(errorText(e)) + "</div>";
    return;
  }
  renderHead();
  loadThumb();
  el("pjPlans").setAttribute("data-plans", String(ctx.project.id));
  paintPlans(document.querySelector(".pj-head"), ctx.me);
  const left = takeNotice(ctx.pid);               // said by the New Project dialog before it opened this page
  if (left) toast(left, "info");
  startSweeper(ctx.me, { skip: ctx.pid });        // other projects' journal entries written with no signal
  const want = ALIASES[qs("tab")] || qs("tab");
  switchTab(TABS.indexOf(want) !== -1 ? want : "overview");
  loadSwitcher();
  startLive();
  // unsaved edits: common2's DCR2.live guards leaving the page and flushes on hide / back online
  if (D().live && typeof D().live.mountBadge === "function") D().live.mountBadge("pjMsg");
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  const t = document.getElementById("pjTitle");
  if (t) t.textContent = errorText(e);
});

export { activeTab };
