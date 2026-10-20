/* Project Board (port of the old board.html / board.js; MODULES §3 "board.html").

   Data: repo/projects (one shared projects read; status moves are versioned PATCHes and the
   status trigger writes the one activity line), repo/activity (the panel's last 30 lines and
   "Add log entry"), repo/files (the picture through a signed URL). Live: live.watch('projects')
   replaces the old 5-minute poll; after every (re)join the board is read again.

   Who may do what is the database's rule; the page only hides controls:
     move / create  admin, manager (can_edit projects)
     log entries    admin, manager, accountant, lead (can_edit activity)

   The old portal's ~300 imported projects nobody has changed since the import come after the own
   projects in every lane, marked "old portal". Unlike Desktop 2 (folded at first), Portal 2 SHOWS
   them at first: crews coming from the old portal find every job where its Board had it; the "Old
   portal" chip folds them away (remembered per device).

   Live changes land in place: a re-draw keeps where each lane (and the page) was scrolled, and a
   burst of changes is drawn once. */

import { boot, el, esc, toast, confirmBox, errorText, can, maskFor, qs, setQs, store } from "./shell.js";
import * as projectsRepo from "../repo/projects.js";
import * as activityRepo from "../repo/activity.js";
import * as filesRepo from "../repo/files.js";
import { nameBook } from "../repo/people.js";
import { VIEWS, viewOf, buildBoard, summaryText, mergeRow } from "./board-model.js";
import { STATUS_ORDER, statusLabel } from "../map/status.js";
import { projectTitle, addressLine } from "../map/projects.js";
import { ymd, fmtShort, fmtDay, fmtWhen } from "../map/pacific.js";
import { foldText } from "../map/activity.js";

const SHOW_OLD_KEY = "dcr2:board.showOld";

const state = {
  me: null, projects: [], view: viewOf(qs("view")), search: "", selectedId: null,
  canWrite: false, canLog: false, mask: function (t) { return t; },
  showOld: store.get(SHOW_OLD_KEY, "1") === "1",
  keep: new Set(),          // ids being moved: never folded as "old" mid-move
  dragging: false, loadSeq: 0, clickTimer: null, clickId: null, unwatch: [],
  thumbs: {}, logSeq: 0,
};

function findProject(id) {
  return state.projects.find(function (p) { return String(p.id) === String(id); }) || null;
}

/* ── render ─────────────────────────────────────────────────────────── */
/** Where each lane, the lanes row and the page are scrolled (a re-draw puts them back). */
function scrollState() {
  const wrap = el("bdCols");
  const lanes = {};
  wrap.querySelectorAll(".bd-col").forEach(function (col) {
    const body = col.querySelector(".bd-col-body");
    if (body && body.scrollTop) lanes[col.getAttribute("data-status")] = body.scrollTop;
  });
  return { lanes: lanes, left: wrap.scrollLeft, top: wrap.scrollTop, x: window.scrollX, y: window.scrollY };
}
function restoreScroll(s) {
  const wrap = el("bdCols");
  wrap.querySelectorAll(".bd-col").forEach(function (col) {
    const at = s.lanes[col.getAttribute("data-status")];
    const body = col.querySelector(".bd-col-body");
    if (at && body) body.scrollTop = at;
  });
  if (s.left) wrap.scrollLeft = s.left;
  if (s.top) wrap.scrollTop = s.top;
  if (s.x || s.y) window.scrollTo(s.x, s.y);
}

let renderTimer = null;
/** A live change: drawn once per burst (another person's moves, a field crew's pins). */
function renderSoon() {
  if (renderTimer) return;
  renderTimer = setTimeout(function () { renderTimer = null; render(); }, 250);
}

function render() {
  clearTimeout(renderTimer); renderTimer = null;
  const b = buildBoard(state.projects, state.view, {
    today: ymd(new Date()), search: state.search, showOld: state.showOld, keep: state.keep, mask: state.mask,
  });
  const wrap = el("bdCols");
  const scrolled = scrollState();
  wrap.innerHTML = b.columns.map(function (c) {
    const cards = c.rows.map(function (p) { return cardHtml(p, c.col); }).join("");
    const foot = c.hiddenCompleted && c.col.months
      ? '<div class="bd-empty-col">' + c.hiddenCompleted + " older (last " + c.col.months + " months shown)</div>" : "";
    return '<div class="bd-col" data-status="' + esc(c.col.status) + '" style="--col-acc:' + c.col.acc + '">' +
      '<div class="bd-col-head"><span>' + esc(c.col.label) + '</span><span class="bd-col-count">' + c.rows.length + "</span></div>" +
      '<div class="bd-col-body">' + (cards || '<div class="bd-empty-col">No projects</div>') + foot + "</div></div>";
  }).join("");
  restoreScroll(scrolled);
  el("bdNote").textContent = summaryText(b, !!state.search.trim()) +
    (state.canWrite ? " · drag projects between stages" : " · read-only view");
  const chip = el("bdOldChip");
  chip.hidden = !b.oldCount && !state.showOld;
  chip.classList.toggle("on", state.showOld);
  chip.setAttribute("aria-pressed", state.showOld ? "true" : "false");
  chip.title = b.oldCount + " project" + (b.oldCount === 1 ? "" : "s") + " imported from the old portal that nobody has changed here yet — " +
    (state.showOld ? "shown (marked “old portal”); tap to fold them away" : "folded away; tap to show them");
  el("bdOldCount").textContent = String(b.oldCount);
}

function cardHtml(p, col) {
  const sel = String(p.id) === String(state.selectedId) ? " selected" : "";
  const flag = p.checkScopeAndProjectFeatures ? ' <span class="bd-flag" title="Has a scope">⚑</span>' : "";
  const old = p.dormant && !state.keep.has(String(p.id)) ? ' <span class="bd-old" title="Imported from the old portal; not changed since">old portal</span>' : "";
  const addr = addressLine(p);
  const note = p.estimateStatusDescription ? state.mask(p.estimateStatusDescription) : "";
  return '<div class="bd-card' + sel + (p.dormant ? " dormant" : "") + '" data-id="' + esc(p.id) + '"' +
    (state.canWrite ? ' draggable="true"' : "") + ' tabindex="0">' +
    '<div class="bd-card-top"><span class="bd-card-id">' + esc(p.internalIDNumber || "—") + flag + old + "</span>" +
    '<span class="bd-card-date">' + esc(fmtShort(col.sortField === "completed" ? (p.projectCompletedDate || p.projectDate) : p.projectDate)) + "</span></div>" +
    '<div class="bd-card-name">' + esc(p.projectName || "(no name)") + "</div>" +
    (addr ? '<div class="bd-card-addr">' + esc(addr) + "</div>" : "") +
    (note ? '<div class="bd-card-desc">' + esc(note) + "</div>" : "") +
    "</div>";
}

/* ── the side panel ─────────────────────────────────────────────────── */
function selectProject(id) {
  const p = findProject(id);
  if (!p) return;
  state.selectedId = String(id);
  render();
  el("bdPanel").classList.add("open");
  paintPanel(p);
  loadThumb(p);
  loadLogs(p.id);
}

function paintPanel(p) {
  el("bdOpenProject").href = "project.html?id=" + encodeURIComponent(p.id);
  el("bdPTitle").textContent = projectTitle(p);
  el("bdPSub").textContent = addressLine(p, ", ");
  el("bdPClient").textContent = p.projectClientName || "—";
  el("bdPDate").textContent = fmtDay(p.projectDate);
  el("bdPStatus").textContent = p.statusLabel;
  el("bdPDesc").textContent = p.estimateStatusDescription ? state.mask(p.estimateStatusDescription) : "—";
  el("bdPOld").hidden = !p.legacySpId;
  if (state.canWrite) {
    el("bdStatusRow").hidden = false;
    el("bdStatusSel").innerHTML = STATUS_ORDER.map(function (s) {
      return '<option value="' + s + '"' + (s === p.status ? " selected" : "") + ">" + esc(statusLabel(s)) + "</option>";
    }).join("");
  } else {
    el("bdStatusRow").hidden = true;
  }
  el("bdAddLogWrap").hidden = !state.canLog;
}

function closePanel() {
  el("bdPanel").classList.remove("open");
  state.selectedId = null;
  render();
}

async function loadThumb(p) {
  const box = el("bdThumb");
  if (p.thumbnailFileId == null) { box.textContent = "No preview available"; return; }
  if (state.thumbs[p.id]) { box.innerHTML = '<img src="' + esc(state.thumbs[p.id]) + '" alt="">'; return; }
  box.textContent = "Loading preview…";
  try {
    const urls = await filesRepo.thumbnailUrls([p]);
    if (urls[String(p.id)]) state.thumbs[p.id] = urls[String(p.id)];
  } catch (e) { /* no picture is not an error */ }
  if (String(state.selectedId) !== String(p.id)) return;
  box.innerHTML = state.thumbs[p.id] ? '<img src="' + esc(state.thumbs[p.id]) + '" alt="">' : "No preview available";
}

async function loadLogs(id) {
  const my = ++state.logSeq;
  const box = el("bdLogs");
  box.innerHTML = '<div class="bd-note">Loading…</div>';
  try {
    const lines = await activityRepo.forProject(id, { limit: activityRepo.PANEL_LIMIT, mask: state.mask });
    if (my !== state.logSeq || String(state.selectedId) !== String(id)) return;
    if (!lines.length) { box.innerHTML = '<div class="bd-note">No log entries yet.</div>'; return; }
    box.innerHTML = lines.map(function (l) {
      const f = foldText(l.logDescription);
      return '<div class="bd-log' + (l.kind !== "note" ? " sys" : "") + '"><div class="bd-log-date">' + esc(fmtWhen(l.logDate)) + "</div>" +
        '<div class="bd-log-text" data-full="' + (f.more ? esc(l.logDescription) : "") + '">' + esc(f.short) + "</div>" +
        (f.more ? '<button type="button" class="bd-more" data-more="1">more</button>' : "") +
        (l.logUserName ? '<div class="bd-log-user">— ' + esc(l.logUserName) + "</div>" : "") + "</div>";
    }).join("");
  } catch (e) {
    if (my !== state.logSeq) return;
    box.innerHTML = '<div class="bd-note">' + esc(errorText(e)) + "</div>";
  }
}

function msg(kind, text) {
  const m = el("bdPMsg");
  m.textContent = text || "";
  m.className = "bd-msg" + (kind ? " " + kind : "");
}

/* ── actions ────────────────────────────────────────────────────────── */
async function changeStatus(id, newStatus, opts) {
  const p = findProject(id);
  if (!p || p.status === newStatus) return false;
  const before = p;
  state.keep.add(String(id));
  // optimistic: the card moves at once
  state.projects = mergeRow(state.projects, Object.assign({}, p, { status: newStatus, statusLabel: statusLabel(newStatus) }));
  render();
  try {
    const moved = await projectsRepo.setStatus(before, newStatus);
    state.projects = mergeRow(state.projects, moved);
    state.keep.delete(String(id));
    render();
    if (String(state.selectedId) === String(id)) { paintPanel(moved); loadLogs(id); }
    if (opts && opts.panel) msg("ok", "✓ Status updated (logged)");
    return true;
  } catch (e) {
    state.keep.delete(String(id));
    if (e && e.code === "PT409" && e.current) {
      // someone saved it first: show their version, never a silent overwrite
      const now = e.current;
      state.projects = state.projects.map(function (x) { return String(x.id) === String(id) ? now : x; });
      render();
      if (String(state.selectedId) === String(id)) paintPanel(now);
      const nameOf = await nameBook();
      const who = (nameOf(now.updatedBy) || "Someone").split(/\s+/)[0];
      const again = await confirmBox(who + " changed " + (now.internalIDNumber || "this project") + " first — it's in " +
        now.statusLabel + " now. Move it to " + statusLabel(newStatus) + " anyway?",
        { title: "Changed by someone else", okText: "Move anyway" });
      if (again && now.status !== newStatus) return changeStatus(id, newStatus, opts);
      return false;
    }
    state.projects = state.projects.map(function (x) { return String(x.id) === String(id) ? before : x; });
    render();
    toast("Could not move the project: " + errorText(e), "error");
    if (opts && opts.panel) msg("err", errorText(e));
    return false;
  }
}

async function addLogEntry() {
  const id = state.selectedId;
  const text = el("bdAddLog").value.trim();
  if (!id || !text) { msg("err", "Write something first."); return; }
  msg("", "Saving…");
  el("bdAddLogGo").disabled = true;
  try {
    await activityRepo.addNote(id, text);
    el("bdAddLog").value = "";
    msg("ok", "✓ Log entry saved");
    loadLogs(id);
  } catch (e) {
    msg("err", errorText(e));
  }
  el("bdAddLogGo").disabled = false;
}

function openNew() {
  ["npName", "npAddr", "npCity"].forEach(function (i) { el(i).value = ""; });
  el("npMsg").textContent = "";
  el("bdNewModal").classList.add("open");
  el("npName").focus();
}

async function createProject() {
  const m = el("npMsg");
  m.textContent = "";
  const f = { projectName: el("npName").value.trim(), projectAddress: el("npAddr").value.trim(), projectCity: el("npCity").value.trim() };
  if (!f.projectName) { m.textContent = "The project needs a name."; return; }
  el("npCreate").disabled = true;
  try {
    const p = await projectsRepo.createProject(f);
    el("bdNewModal").classList.remove("open");
    state.projects = mergeRow(state.projects, p);
    if (state.view !== "main" && !VIEWS[state.view].cols.some(function (c) { return c.status === p.status; })) setView("main");
    render();
    toast("Created " + projectTitle(p), "ok");
    selectProject(p.id);
  } catch (e) {
    m.textContent = errorText(e);
  }
  el("npCreate").disabled = false;
}

function setView(v) {
  state.view = viewOf(v);
  el("bdView").value = state.view;
  setQs("view", state.view === "main" ? "" : state.view);
  render();
}

/* ── data ───────────────────────────────────────────────────────────── */
async function load(fresh) {
  const my = ++state.loadSeq;
  try {
    const list = await projectsRepo.loadProjects({ fresh: !!fresh });
    if (my !== state.loadSeq) return;
    // a live change that came in while this was being read wins (versions decide); a card
    // being moved keeps its place until its own answer lands
    const mine = new Map(state.projects.map(function (p) { return [String(p.id), p]; }));
    state.projects = list.map(function (p) {
      const m = mine.get(String(p.id));
      if (m && (state.keep.has(String(p.id)) || Number(m.version || 0) > Number(p.version || 0))) return m;
      return p;
    });
    render();
    if (state.selectedId) {
      const p = findProject(state.selectedId);
      if (p) paintPanel(p); else closePanel();
    }
  } catch (e) {
    if (my !== state.loadSeq) return;
    el("bdCols").innerHTML = '<div class="bd-empty-col" style="margin:auto">' + esc(errorText(e)) + "</div>";
  }
}

function onProjectsChange(evt) {
  if (evt && evt.type === "DELETE" && evt.old && evt.old.id != null) {          // soft delete (a tombstone)
    state.projects = state.projects.filter(function (x) { return String(x.id) !== String(evt.old.id); });
    render();
    if (String(state.selectedId) === String(evt.old.id)) closePanel();
    return;
  }
  const row = evt && (evt.new || evt.record || (evt.payload && (evt.payload.new || evt.payload.record)));
  if (!row || row.id == null) { load(true); return; }          // a (re)join: read everything again
  if (state.dragging) { setTimeout(function () { onProjectsChange(evt); }, 600); return; }
  const before = findProject(row.id);
  const p = projectsRepo.fromLive(row, before);
  if (row.deleted_at) state.projects = state.projects.filter(function (x) { return String(x.id) !== String(row.id); });
  else state.projects = mergeRow(state.projects, p);
  renderSoon();
  if (String(state.selectedId) === String(row.id)) {
    const now = findProject(row.id);
    if (now) { paintPanel(now); if (!before || before.status !== now.status) loadLogs(row.id); } else closePanel();
  }
}

async function startLive() {
  try {
    const live = await import("../live.js");
    if (typeof live.watch === "function") {
      state.unwatch.push(live.watch("projects", null, onProjectsChange));
      state.unwatch.push(live.watch("activity", null, function (evt) {
        const row = evt && (evt.new || evt.record);
        if (state.selectedId && (!row || String(row.project_id) === String(state.selectedId))) loadLogs(state.selectedId);
      }));
    }
  } catch (e) {
    // no live updates: fall back to the old five-minute read
    setInterval(function () { if (!state.dragging && !el("bdNewModal").classList.contains("open")) load(true); }, 300000);
  }
}

/* ── wiring ─────────────────────────────────────────────────────────── */
function wire() {
  const vs = el("bdView");
  vs.innerHTML = Object.keys(VIEWS).map(function (k) {
    return '<option value="' + k + '"' + (k === state.view ? " selected" : "") + ">" + esc(VIEWS[k].label) + "</option>";
  }).join("");
  vs.addEventListener("change", function () { setView(vs.value); });
  el("bdSearch").addEventListener("input", function () { state.search = this.value; render(); });
  el("bdRefreshBtn").addEventListener("click", function () {
    projectsRepo.forgetProjects();
    load(true);
    if (state.selectedId) loadLogs(state.selectedId);
  });
  el("bdOldChip").addEventListener("click", function () {
    state.showOld = !state.showOld;
    store.set(SHOW_OLD_KEY, state.showOld ? "1" : "0");
    render();
  });
  el("bdPClose").addEventListener("click", closePanel);
  el("bdStatusGo").addEventListener("click", async function () {
    if (!state.selectedId) return;
    msg("", "Updating…");
    const ok = await changeStatus(state.selectedId, el("bdStatusSel").value, { panel: true });
    if (!ok && el("bdPMsg").textContent === "Updating…") msg("", "");
  });
  el("bdAddLogGo").addEventListener("click", addLogEntry);
  el("bdNewBtn").addEventListener("click", openNew);
  el("npCancel").addEventListener("click", function () { el("bdNewModal").classList.remove("open"); });
  el("npCreate").addEventListener("click", createProject);
  el("bdNewModal").addEventListener("click", function (e) { if (e.target === this) this.classList.remove("open"); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (el("bdNewModal").classList.contains("open")) el("bdNewModal").classList.remove("open");
      else if (el("bdPanel").classList.contains("open")) closePanel();
    }
  });
  el("bdThumb").addEventListener("dblclick", function () {
    if (state.selectedId) location.href = "project.html?id=" + encodeURIComponent(state.selectedId);
  });
  el("bdLogs").addEventListener("click", function (e) {
    const b = e.target.closest && e.target.closest("[data-more]");
    if (!b) return;
    const t = b.previousElementSibling;
    if (t && t.getAttribute("data-full")) { t.textContent = t.getAttribute("data-full"); b.remove(); }
  });

  // cards: one click opens the panel, two open the project (timed: the first click re-renders)
  const cols = el("bdCols");
  cols.addEventListener("click", function (e) {
    const c = e.target.closest && e.target.closest(".bd-card");
    if (!c) return;
    const id = c.getAttribute("data-id");
    if (state.clickTimer && state.clickId === id) {
      clearTimeout(state.clickTimer); state.clickTimer = null; state.clickId = null;
      location.href = "project.html?id=" + encodeURIComponent(id);
      return;
    }
    clearTimeout(state.clickTimer);
    state.clickId = id;
    state.clickTimer = setTimeout(function () { state.clickTimer = null; state.clickId = null; selectProject(id); }, 230);
  });
  cols.addEventListener("keydown", function (e) {
    const c = e.target.closest && e.target.closest(".bd-card");
    if (!c) return;
    if (e.key === "Enter") location.href = "project.html?id=" + encodeURIComponent(c.getAttribute("data-id"));
    else if (e.key === " ") { e.preventDefault(); selectProject(c.getAttribute("data-id")); }
  });
  if (state.canWrite) {
    cols.addEventListener("dragstart", function (e) {
      const c = e.target.closest && e.target.closest(".bd-card");
      if (!c) return;
      state.dragging = true;
      c.classList.add("dragging");
      e.dataTransfer.setData("text/plain", c.getAttribute("data-id"));
      e.dataTransfer.effectAllowed = "move";
    });
    cols.addEventListener("dragend", function (e) {
      state.dragging = false;
      const c = e.target.closest && e.target.closest(".bd-card");
      if (c) c.classList.remove("dragging");
      cols.querySelectorAll(".bd-col").forEach(function (x) { x.classList.remove("drag-over"); });
    });
    cols.addEventListener("dragover", function (e) {
      const col = e.target.closest && e.target.closest(".bd-col");
      if (!col) return;
      e.preventDefault();
      cols.querySelectorAll(".bd-col.drag-over").forEach(function (x) { if (x !== col) x.classList.remove("drag-over"); });
      col.classList.add("drag-over");
    });
    cols.addEventListener("drop", function (e) {
      const col = e.target.closest && e.target.closest(".bd-col");
      if (!col) return;
      e.preventDefault();
      col.classList.remove("drag-over");
      state.dragging = false;
      const id = e.dataTransfer.getData("text/plain");
      if (id) changeStatus(id, col.getAttribute("data-status"));
    });
  }
}

async function init() {
  state.me = await boot("board");
  state.canWrite = can(state.me, "projects");
  state.canLog = can(state.me, "activity");
  state.mask = maskFor(state.me);
  el("bdNewBtn").hidden = !state.canWrite;
  wire();
  await load(false);
  startLive();
  const open = qs("open");
  if (open && findProject(open)) selectProject(open);
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  const cols = document.getElementById("bdCols");
  if (cols) cols.innerHTML = '<div class="bd-empty-col" style="margin:auto">' + esc(errorText(e)) + "</div>";
});
