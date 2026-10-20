/* Log History (port of the old logs.html / logs.js; MODULES §3 "logs.html").

   Every project's log lines in a window — Today, Morning, Afternoon, Yesterday, This week (Sat to
   Fri), Last week, This month — computed in Pacific time (map/pacific.js), at most 800, grouped by
   project; or one project's whole history (the newest 300) through the project search. A group's
   heading opens that project's Log tab. Imported lines show "Juan · old portal"; long ones fold;
   amounts in notes are masked for people without the prices switch. Live: new lines appear in
   place — the list is swapped only once the new answer is there (no "Loading…" in between), the
   page stays where it was scrolled, lines opened with "more" stay open, and a burst of changes is
   read once (every 5 seconds at most while the page is scrolled down). */

import { boot, el, esc, errorText, maskFor } from "./shell.js";
import * as activityRepo from "../repo/activity.js";
import * as projectsRepo from "../repo/projects.js";
import { LOG_FILTERS, logWindow, fmtWhen } from "../map/pacific.js";
import { groupByProject, foldText } from "../map/activity.js";
import { switcherLabel, projectTitle } from "../map/projects.js";

const state = { projects: [], byId: {}, filter: "today", lines: [], projMode: null, seq: 0, mask: null, timer: null,
  open: new Set(), lastLive: 0 };

function lineKey(l) { return String(l.id != null ? l.id : (l.projectID + "|" + l.logDate + "|" + l.logDescription)); }

function title(pid, line) {
  const p = state.byId[String(pid)];
  if (p) return projectTitle(p);
  if (line && (line.projectNumber || line.projectName)) return [line.projectNumber, line.projectName].filter(Boolean).join(" — ");
  return "Project " + pid;
}

function render() {
  el("lgChips").innerHTML = LOG_FILTERS.map(function (f) {
    const on = !state.projMode && state.filter === f[0];
    return '<button type="button" class="lg-chip' + (on ? " on" : "") + '" data-f="' + f[0] + '" aria-pressed="' + on + '">' + esc(f[1]) + "</button>";
  }).join("");
  const lines = state.lines;
  if (!lines.length) {
    el("lgList").innerHTML = '<div class="lg-empty">No log entries ' + (state.projMode ? "for this project." : "in this period.") + "</div>";
    return;
  }
  el("lgList").innerHTML = groupByProject(lines).map(function (g) {
    const p = state.byId[g.pid] || {};
    const sub = [p.projectAddress, p.projectCity, p.projectClientName].filter(Boolean).join(" · ");
    return '<div class="lg-proj">' +
      '<a class="lg-proj-head" href="project.html?id=' + encodeURIComponent(g.pid) + '&tab=log" title="Open the project\'s log">' +
        '<span class="lg-proj-name">' + esc(title(g.pid, g.rows[0])) + "</span>" +
        '<span class="lg-proj-sub">' + esc(sub) + "</span>" +
        '<span class="lg-count">' + g.rows.length + "</span></a>" +
      g.rows.map(function (l) {
        const f = foldText(l.logDescription);
        const key = lineKey(l);
        const opened = f.more && state.open.has(key);
        return '<div class="lg-entry' + (l.kind !== "note" ? " sys" : "") + '"><div class="lg-when">' + esc(fmtWhen(l.logDate)) + "</div>" +
          '<div class="lg-text" data-key="' + esc(key) + '" data-full="' + (f.more && !opened ? esc(l.logDescription) : "") + '">' +
            esc(opened ? l.logDescription : f.short) + "</div>" +
          (f.more && !opened ? '<button type="button" class="lg-more" data-more="1">more</button>' : "") +
          (l.logUserName ? '<div class="lg-user">— ' + esc(l.logUserName) + "</div>" : "") + "</div>";
      }).join("") + "</div>";
  }).join("");
}

/** Read the lines again. quiet (a live change): what is on screen stays until the answer is there,
    and the page keeps its place. */
async function load(quiet) {
  const my = ++state.seq;
  if (quiet !== true) { el("lgList").innerHTML = '<div class="lg-empty">Loading…</div>'; state.open.clear(); }
  const at = { x: window.scrollX, y: window.scrollY };
  try {
    if (state.projMode) {
      const lines = await activityRepo.forProject(state.projMode.id, { limit: activityRepo.HISTORY_LIMIT, mask: state.mask });
      if (my !== state.seq) return;
      state.lines = lines;
      el("lgSub").textContent = "Full log history — " + title(state.projMode.id) + " (" + lines.length + " entr" + (lines.length === 1 ? "y" : "ies") + ")";
    } else {
      const w = logWindow(state.filter, new Date());
      const lines = await activityRepo.inWindow(w[0], w[1], { mask: state.mask });
      if (my !== state.seq) return;
      state.lines = lines;
      const label = LOG_FILTERS.filter(function (f) { return f[0] === state.filter; })[0][1];
      const n = new Set(lines.map(function (l) { return String(l.projectID); })).size;
      el("lgSub").textContent = label + " — " + lines.length + " entr" + (lines.length === 1 ? "y" : "ies") +
        " across " + n + " project" + (n === 1 ? "" : "s") + (lines.length >= activityRepo.WINDOW_LIMIT ? " (the newest " + activityRepo.WINDOW_LIMIT + ")" : "");
    }
    render();
    if (quiet === true && (at.x || at.y)) window.scrollTo(at.x, at.y);
  } catch (e) {
    if (my !== state.seq) return;
    if (quiet === true && state.lines.length) return;        // a failed live re-read keeps what is shown
    el("lgList").innerHTML = '<div class="lg-empty">' + esc(errorText(e)) + "</div>";
  }
}

/** A live change: one quiet read per burst; at most every 5 s while the reader is scrolled down. */
function liveChange() {
  if (state.timer) return;
  const wait = window.scrollY > 0 ? Math.max(600, 5000 - (Date.now() - state.lastLive)) : 600;
  state.timer = setTimeout(function () { state.timer = null; state.lastLive = Date.now(); load(true); }, wait);
}

function trySearch() {
  const v = el("lgSearch").value.trim().toLowerCase();
  if (!v) { if (state.projMode) { state.projMode = null; load(); } return; }
  const hit = state.projects.find(function (p) { return switcherLabel(p).toLowerCase() === v; }) ||
    state.projects.find(function (p) { return String(p.internalIDNumber || "").toLowerCase() === v; }) ||
    state.projects.find(function (p) { return switcherLabel(p).toLowerCase().indexOf(v) !== -1; });
  if (hit) { state.projMode = { id: hit.id }; load(); }
}

async function init() {
  const me = await boot("logs");
  state.mask = maskFor(me);
  el("lgRefresh").addEventListener("click", function () { load(); });
  el("lgSearch").addEventListener("change", trySearch);
  el("lgSearch").addEventListener("keydown", function (e) { if (e.key === "Enter") trySearch(); });
  el("lgSearch").addEventListener("input", function () { if (!this.value.trim() && state.projMode) { state.projMode = null; load(); } });
  el("lgChips").addEventListener("click", function (e) {
    const c = e.target.closest && e.target.closest("[data-f]");
    if (!c) return;
    state.projMode = null;
    el("lgSearch").value = "";
    state.filter = c.getAttribute("data-f");
    load();
  });
  el("lgList").addEventListener("click", function (e) {
    const b = e.target.closest && e.target.closest("[data-more]");
    if (!b) return;
    const t = b.previousElementSibling;
    if (t && t.getAttribute("data-full")) {
      t.textContent = t.getAttribute("data-full");
      if (t.getAttribute("data-key")) state.open.add(t.getAttribute("data-key"));
      b.remove();
    }
  });
  render();
  try {
    state.projects = await projectsRepo.loadProjects();
    state.projects.forEach(function (p) { state.byId[String(p.id)] = p; });
    el("lgProjects").innerHTML = state.projects.map(function (p) { return '<option value="' + esc(switcherLabel(p)) + '"></option>'; }).join("");
  } catch (e) { /* names degrade gracefully: the embed carries number and name */ }
  load();
  try {
    const live = await import("../live.js");
    live.watch("activity", null, function (evt) {
      if (!evt || evt.type === "SUBSCRIBED") return;           // the first read is load() above
      liveChange();
    });
  } catch (e) { /* no live updates: ↻ reads again */ }
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  const l = document.getElementById("lgList");
  if (l) l.innerHTML = '<div class="lg-empty">' + esc(errorText(e)) + "</div>";
});
