/* Time Sheet, desk view (port of the old timesheet.html / timesheet.js; MODULES §4).

   The entry form (day type, employee, project, date, hours with the ± half-hour stepper, the work
   schedule laid over the employee's normal hours with the Entered-vs-Calculated bar, work completed)
   and the two-week calendar (last week and this week, Saturday first: the weekend on the left, the
   work week on the right). A click on a day sets the date; a card opens, edits or deletes its entry.
   Phones are sent to the phone page unless the desk view was asked for (?view=desktop).

   What changed from the old page: the employee is an employees row (not a typed name); a leave day
   is a kind, not a project; the project is picked from the projects (active jobs first); dates are
   calendar days and clock times plain times (no UTC week, no daylight-saving hour); every write is a
   timesheets row under the crew scope, an edit carries the version it read. */

import { boot, el, esc, errorText, toast, confirmBox, qs, D } from "./shell.js";
import { companyToday } from "../common2.js";
import * as tsRepo from "../repo/timesheets.js";
import { context, scopeNote, fillProjects, projectOptions, projectIdOf, projectBoxText, scheduleWidget, overlay } from "./ts-shared.js";
import {
  calendarBounds, twoWeeks, isLeave, scheduleText, problem, stepHours, cleanHours, hoursText, longDate, sourceWord,
  PICK_PROJECT,
} from "../map/timesheets.js";
import { openPdf } from "../timesheet-pdf.js";

const VIEW_KEY = "dcr2TsView";
function sessionGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
function sessionSet(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* */ } }

const narrow = Math.min(window.innerWidth, window.screen ? window.screen.width : 9999) < 700;
if (/[?&]view=desktop\b/.test(location.search)) sessionSet(VIEW_KEY, "desktop");
const phoneRedirect = narrow && sessionGet(VIEW_KEY) !== "desktop";
if (phoneRedirect) {
  const d = /[?&]date=(\d{4}-\d{2}-\d{2})\b/.exec(location.search);
  location.replace("timesheet-mobile.html" + (d ? "?date=" + d[1] : ""));
}

const state = { ctx: null, entries: [], editing: null, employeeId: null, opts: [], hi: -1, seq: 0 };
let sched = null;

/* ── the employee combo box ───────────────────────────────────────────── */

function employeeLocked() { return el("tsName").disabled; }

function setEmployee(row) {
  state.employeeId = row ? row.id : null;
  el("tsName").value = row ? row.full_name : "";
  el("empDropdown").classList.remove("open");
  el("tsName").setAttribute("aria-expanded", "false");
  state.hi = -1;
  buildCalendar();
  autoSchedule();
}

function filterEmployees() {
  const input = el("tsName");
  if (input.disabled) return;
  const dd = el("empDropdown");
  const q = input.value.trim().toLowerCase();
  const exact = state.ctx.writable.find(function (r) { return String(r.full_name).toLowerCase() === q; });
  state.employeeId = exact ? exact.id : null;
  const list = state.ctx.writable.filter(function (r) { return !q || String(r.full_name).toLowerCase().indexOf(q) !== -1 || String(r.employee_no || "").toLowerCase() === q; });
  dd.innerHTML = list.length ? list.map(function (r, i) {
    return '<div class="emp-option" role="option" data-i="' + i + '" data-id="' + esc(r.id) + '"><span>' + esc(r.full_name) + '</span><span class="no">' + esc(r.employee_no || "") + "</span></div>";
  }).join("") : '<div class="emp-no-match">No employees found</div>';
  dd.classList.add("open");
  input.setAttribute("aria-expanded", "true");
  state.hi = -1;
  buildCalendar();
}

function empKeydown(e) {
  const dd = el("empDropdown");
  const opts = dd.querySelectorAll(".emp-option");
  if (!dd.classList.contains("open") || !opts.length) return;
  if (e.key === "ArrowDown") { e.preventDefault(); state.hi = Math.min(state.hi + 1, opts.length - 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); state.hi = Math.max(state.hi - 1, 0); }
  else if (e.key === "Enter") {
    e.preventDefault();
    if (state.hi >= 0) setEmployee(state.ctx.byId(opts[state.hi].getAttribute("data-id")));
    return;
  } else if (e.key === "Escape") { dd.classList.remove("open"); state.hi = -1; return; }
  else return;
  opts.forEach(function (o, i) { o.classList.toggle("highlighted", i === state.hi); if (i === state.hi) o.scrollIntoView({ block: "nearest" }); });
}

/* ── day type, hours, schedule ─────────────────────────────────────────── */

function kind() { return el("tsDayType").value; }

function onDayType() {
  const leave = isLeave(kind());
  el("tsProjField").style.display = leave ? "none" : "";
  if (leave) { sched.show(false); sched.clear(); } else autoSchedule();
}

function autoSchedule() {
  if (isLeave(kind())) { sched.show(false); return; }
  const hours = Number(el("tsHours").value) || 0;
  sched.fill(state.ctx.byId(state.employeeId), hours);
}

function adjust(delta) { el("tsHours").value = stepHours(el("tsHours").value, delta); autoSchedule(); }

/* ── the calendar ──────────────────────────────────────────────────────── */

function filterId() { return el("tsName").value.trim() ? state.employeeId : null; }

function cardHtml(e, showWho) {
  const w = e.work || "";
  const canW = state.ctx.canWrite(e.employeeId);
  return '<div class="cal-card' + (e.leave ? " leave" : "") + '" data-id="' + esc(e.id) + '">' +
    '<div class="cal-card-project">' + esc(e.leave ? e.dayType : e.projectLabel) + "</div>" +
    (showWho ? '<div class="cal-card-who">' + esc(e.employeeName) + "</div>" : "") +
    '<div class="cal-card-work">' + esc(w.slice(0, 45)) + (w.length > 45 ? "…" : "") + "</div>" +
    '<div class="cal-card-hrs"><span class="hrs-badge">' + hoursText(e.hours) + " hrs</span></div>" +
    '<div class="card-actions"><button type="button" class="card-action" data-act="view" data-id="' + esc(e.id) + '" title="View" aria-label="View">👁<span class="lbl"> View</span></button>' +
    (canW ? '<button type="button" class="card-action" data-act="edit" data-id="' + esc(e.id) + '" title="Edit" aria-label="Edit">✎<span class="lbl"> Edit</span></button>' +
      '<button type="button" class="card-action del" data-act="del" data-id="' + esc(e.id) + '" title="Delete" aria-label="Delete">🗑<span class="lbl"> Delete</span></button>' : "") +
    "</div></div>";
}

function buildCalendar() {
  const area = el("calArea");
  if (!state.ctx || !area) return;
  const who = filterId();
  const nameNote = el("tsName").value.trim();
  el("calFilterNote").textContent = who ? "Showing entries for: " + nameNote : "Showing all entries you can access.";
  area.classList.toggle("cal-one", !!who);
  const entryById = {};
  state.entries.forEach(function (e) { entryById[String(e.id)] = e; });
  const weeks = twoWeeks(state.entries, state.ctx.today, { employeeId: who });
  const sel = el("tsDate").value;
  const canAdd = !el("tsForm").hidden;
  el("calHint").textContent = canAdd ? "Click any day to pre-fill the date. Blue days have entries." : "Blue days have entries; click one to see it.";
  area.innerHTML = weeks.map(function (w, wi) {
    const cell = function (d) {
      const items = d.entries.map(function (x) { return entryById[String(x.id)]; }).filter(Boolean);
      return '<div class="cal-day' + (items.length ? " has-entry" : "") + (d.isToday ? " today" : "") + (d.isWeekend ? " weekend" : "") +
        (d.key === sel && canAdd ? " selected" : "") + '" data-day="' + d.key + '"' + (canAdd ? ' role="button" tabindex="0" title="Add entry for ' + esc(d.month + " " + d.dayNum) + '"' : "") + ">" +
        '<div class="cal-day-header">' + esc(d.month) + '</div><div class="cal-day-num">' + d.dayNum + "</div>" +
        items.map(function (e) { return cardHtml(e, !who); }).join("") +
        (canAdd ? '<div class="cal-add-btn">' + (items.length ? "+ Add another" : "+ Add entry") + "</div>" : "") + "</div>";
    };
    return (wi ? '<div class="week-sep"></div>' : "") +
      '<div class="ts-week-label"><span>' + esc(w.label + " · " + w.range) + '</span><span class="tot">' + hoursText(w.total) + " h</span></div>" +
      '<div class="cal-cols"><div class="cal-wkend"><div class="cal-g2"><div class="cal-day-name">Sat</div><div class="cal-day-name">Sun</div>' +
      w.days.slice(0, 2).map(cell).join("") + "</div></div>" +
      '<div class="cal-work"><div class="cal-ww">— Work week</div><div class="cal-g5">' +
      ["Mon", "Tue", "Wed", "Thu", "Fri"].map(function (n) { return '<div class="cal-day-name wd">' + n + "</div>"; }).join("") +
      w.days.slice(2).map(cell).join("") + "</div></div></div>";
  }).join("");
}

function onCalendarClick(e) {
  const act = e.target.closest("[data-act]");
  if (act) {
    e.stopPropagation();
    const entry = state.entries.find(function (x) { return String(x.id) === act.getAttribute("data-id"); });
    if (!entry) return;
    if (act.getAttribute("data-act") === "view") viewEntry(entry);
    else if (act.getAttribute("data-act") === "edit") editEntry(entry);
    else deleteEntry(entry);
    return;
  }
  const card = e.target.closest(".cal-card");
  if (card) {
    const entry = state.entries.find(function (x) { return String(x.id) === card.getAttribute("data-id"); });
    if (entry) viewEntry(entry);
    return;
  }
  const day = e.target.closest("[data-day]");
  if (day) selectDate(day.getAttribute("data-day"));
}

function selectDate(key) {
  if (el("tsForm").hidden) return;
  el("tsDate").value = key;
  document.querySelectorAll(".cal-day").forEach(function (d) { d.classList.toggle("selected", d.getAttribute("data-day") === key); });
  if (!el("tsName").disabled && !el("tsForm").hidden) el("tsName").focus();
  el("timesheetApp").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ── view / edit / delete ──────────────────────────────────────────────── */

function viewEntry(e) {
  const canW = state.ctx.canWrite(e.employeeId);
  const sch = scheduleText(e);
  const box = overlay(
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;"><h3>Time Entry</h3>' +
    '<button type="button" class="btn-secondary" data-x="close" style="padding:4px 12px;font-size:15px;" aria-label="Close">&times;</button></div>' +
    '<table class="modal-table">' +
    "<tr><td>Employee</td><td>" + esc(e.employeeName || "—") + "</td></tr>" +
    "<tr><td>" + (e.leave ? "Day type" : "Project") + "</td><td>" + esc(e.leave ? e.dayType : e.projectLabel || "—") +
      (!e.leave && e.projectAddress ? "<br><span style=\"font-weight:400;color:var(--text-muted)\">" + esc([e.projectAddress, e.projectCity].filter(Boolean).join(", ")) + "</span>" : "") + "</td></tr>" +
    "<tr><td>Date</td><td>" + esc(longDate(e.date)) + "</td></tr>" +
    '<tr><td>Hours</td><td><span class="hrs-badge" style="font-size:13px;padding:3px 8px;">' + hoursText(e.hours) + " hrs</span></td></tr>" +
    (sch ? "<tr><td>Schedule</td><td>" + esc(sch) + "</td></tr>" : "") +
    "<tr><td>Work completed</td><td>" + esc(e.work || "—") + "</td></tr>" +
    (e.source && e.source !== "portal" ? "<tr><td>Came from</td><td>" + esc(sourceWord(e.source)) + "</td></tr>" : "") +
    "</table><div class=\"modal-actions\">" +
    (canW ? '<button type="button" class="btn-danger" data-x="del">🗑 Delete</button><button type="button" class="btn-secondary" data-x="edit">✎ Edit</button>' : "") +
    '<button type="button" class="btn-primary" data-x="close">Close</button></div>');
  box.addEventListener("click", function (ev) {
    const b = ev.target.closest("[data-x]");
    if (!b) return;
    box.close();
    if (b.getAttribute("data-x") === "edit") editEntry(e);
    if (b.getAttribute("data-x") === "del") deleteEntry(e);
  });
}

function editEntry(e) {
  state.editing = e;
  if (!employeeLocked()) {
    const row = state.ctx.byId(e.employeeId);
    state.employeeId = e.employeeId;
    el("tsName").value = row ? row.full_name : e.employeeName;
  }
  el("tsDayType").value = e.kind;
  el("tsProjField").style.display = e.leave ? "none" : "";
  el("tsProject").value = projectBoxText(e, state.opts);
  el("tsProjNote").textContent = !e.leave && e.projectId == null && e.legacyProject
    ? "From the old portal: this job did not match a project. Leave it, or pick the project." : "";
  el("tsDate").value = e.date;
  el("tsHours").value = hoursText(e.hours);
  el("tsWork").value = e.work || "";
  if (!e.leave && e.start1) sched.set(e); else onDayType();
  el("submitBtn").textContent = "✓ Save changes";
  el("cancelBtn").hidden = false;
  el("timesheetApp").scrollIntoView({ behavior: "smooth", block: "start" });
  buildCalendar();
}

async function deleteEntry(e) {
  const ok = await confirmBox("This time entry will be permanently deleted and cannot be recovered.", { title: "Delete this entry?", danger: true, okText: "Yes, delete" });
  if (!ok) return;
  try {
    await tsRepo.remove(e);
    if (state.editing && String(state.editing.id) === String(e.id)) clearForm(true);
    toast("Entry deleted.", "ok");
  } catch (err) {
    toast("Could not delete: " + errorText(err), "error");
  }
  await loadData();
}

/* ── the form ──────────────────────────────────────────────────────────── */

function showMsg(kind, text) {
  el("formMsg").innerHTML = text ? '<span class="' + (kind === "ok" ? "msg-success" : kind === "err" ? "msg-error" : "") + '">' + esc(text) + "</span>" : "";
}

function clearForm(keepEmployee) {
  state.editing = null;
  if (!keepEmployee && !employeeLocked()) { el("tsName").value = ""; state.employeeId = null; }
  el("tsDayType").value = "work";
  el("tsProjField").style.display = "";
  el("tsProject").value = "";
  el("tsProjNote").textContent = "";
  el("tsDate").value = "";
  el("tsHours").value = "0";
  el("tsWork").value = "";
  sched.show(false); sched.clear();
  el("submitBtn").textContent = "✓ Submit time sheet";
  el("cancelBtn").hidden = true;
  document.querySelectorAll(".cal-day.selected").forEach(function (d) { d.classList.remove("selected"); });
}

function formValues() {
  const k = kind();
  const leave = isLeave(k);
  if (!state.employeeId && el("tsName").value.trim()) {
    const hit = state.ctx.writable.find(function (r) { return String(r.full_name).toLowerCase() === el("tsName").value.trim().toLowerCase(); });
    if (hit) state.employeeId = hit.id;
  }
  const text = el("tsProject").value.trim();
  const ed = state.editing;
  const keepLegacy = !!(ed && !leave && ed.projectId == null && ed.legacyProject && text === ed.legacyProject);
  const v = sched.values();
  return {
    employeeId: state.employeeId, date: el("tsDate").value, kind: k,
    projectId: leave || keepLegacy ? null : projectIdOf(text, state.opts),
    legacyProject: keepLegacy ? ed.legacyProject : "",
    hours: cleanHours(el("tsHours").value), work: el("tsWork").value,
    start1: leave || el("tsScheduleSection").style.display === "none" ? "" : v.start1,
    end1: leave || el("tsScheduleSection").style.display === "none" ? "" : v.end1,
    start2: leave || el("tsScheduleSection").style.display === "none" ? "" : v.start2,
    end2: leave || el("tsScheduleSection").style.display === "none" ? "" : v.end2,
    lunch: leave || el("tsScheduleSection").style.display === "none" ? null : v.lunch,
  };
}

async function submit(ev) {
  ev.preventDefault();
  try { state.opts = await projectOptions(); } catch (e) { /* said below: no project resolves */ }
  const f = formValues();
  if (!isLeave(f.kind) && el("tsProject").value.trim() && f.projectId === null && !f.legacyProject) {
    showMsg("err", PICK_PROJECT);
    return;
  }
  const bad = problem(f);
  if (bad) { showMsg("err", bad); return; }
  if (!state.ctx.canWrite(f.employeeId)) { showMsg("err", "You can only log time for " + (state.ctx.scope === "crew" ? "yourself and your crew." : "yourself.")); return; }
  showMsg("", "Saving…");
  el("submitBtn").disabled = true;
  try {
    if (state.editing) await tsRepo.update(state.editing, f);
    else await tsRepo.create(f);
    showMsg("ok", "✓ Time sheet saved.");
    clearForm(true);
    setTimeout(function () { if (/saved/.test(el("formMsg").textContent)) showMsg("", ""); }, 4000);
  } catch (e) {
    if (e && (e.code === "PT409" || e.status === 409) && state.editing) {
      showMsg("err", "Someone else changed this entry while you were editing it. The latest is shown; make your change again.");
      const cur = e.current;
      await loadData();
      if (cur) editEntry(cur); else clearForm(true);
      el("submitBtn").disabled = false;
      return;
    }
    showMsg("err", errorText(e));
  }
  el("submitBtn").disabled = false;
  await loadData();
}

/* ── data ──────────────────────────────────────────────────────────────── */

async function loadData() {
  const seq = ++state.seq;
  if (!state.entries.length) el("calArea").innerHTML = '<div style="color:var(--text-muted);font-size:14px;">Loading…</div>';
  try {
    const b = calendarBounds(state.ctx.today = companyToday());
    const list = await tsRepo.list(b.from, b.to);
    if (seq !== state.seq) return;
    state.entries = list;
    buildCalendar();
  } catch (e) {
    if (seq !== state.seq) return;
    el("calArea").innerHTML = '<span class="msg-error">' + esc(errorText(e)) + "</span>";
  }
}

function applyScope() {
  const ctx = state.ctx;
  const note = el("empScopeNote");
  note.textContent = scopeNote(ctx);
  note.classList.toggle("warn", ctx.scope === "none");
  if (ctx.readOnly) {
    el("tsForm").hidden = true;
    el("tsReadOnly").hidden = false;
    el("tsReadOnly").textContent = scopeNote(ctx);
    if (ctx.mine) { state.employeeId = ctx.mine.id; el("tsName").value = ctx.mine.full_name; }
    return;
  }
  const input = el("tsName");
  if (ctx.scope === "self" || ctx.scope === "all-read") {
    input.disabled = true;
    if (ctx.mine) { input.value = ctx.mine.full_name; state.employeeId = ctx.mine.id; }
  } else if (ctx.mine) {
    input.value = ctx.mine.full_name;
    state.employeeId = ctx.mine.id;
  }
  if (ctx.scope === "all-read" && !ctx.mine) {
    el("tsForm").hidden = true;
    el("tsReadOnly").hidden = false;
    el("tsReadOnly").textContent = "You see everyone's hours here and in Team Sheets (read only). Your account is not linked to an employee, so there is nothing of your own to log.";
  }
}

async function start() {
  if (phoneRedirect) return;
  const me = await boot("timesheet");
  if (narrow) {
    const link = el("tsPhoneLink");
    link.hidden = false;
    link.addEventListener("click", function () { sessionSet(VIEW_KEY, null); });
  }
  sched = scheduleWidget({ section: "tsScheduleSection", start1: "tsStart1", end1: "tsEnd1", lunch: "tsLunch", start2: "tsStart2",
    end2: "tsEnd2", lunchRange: "tsLunchRange", timeline: "tsTimeline", calcBar: "tsCalcBar", hours: "tsHours" }, "ts");
  try {
    state.ctx = await context(me);
  } catch (e) {
    el("calArea").innerHTML = '<span class="msg-error">' + esc(errorText(e)) + "</span>";
    el("tsForm").hidden = true;
    return;
  }
  applyScope();
  const want = qs("date");
  el("tsDate").value = /^\d{4}-\d{2}-\d{2}$/.test(String(want || "")) ? want : state.ctx.today;
  // the form
  el("tsName").addEventListener("input", filterEmployees);
  el("tsName").addEventListener("focus", filterEmployees);
  el("tsName").addEventListener("keydown", empKeydown);
  el("empDropdown").addEventListener("mousedown", function (e) {
    const o = e.target.closest(".emp-option");
    if (o) { e.preventDefault(); setEmployee(state.ctx.byId(o.getAttribute("data-id"))); }
  });
  document.addEventListener("click", function (e) { if (!el("empCombo").contains(e.target)) el("empDropdown").classList.remove("open"); });
  el("tsDayType").addEventListener("change", onDayType);
  el("hrsMinus").addEventListener("click", function () { adjust(-0.5); });
  el("hrsPlus").addEventListener("click", function () { adjust(0.5); });
  el("tsHours").addEventListener("input", function () {
    const v = el("tsHours").value.replace(/[^0-9.]/g, "");
    if (v !== el("tsHours").value) el("tsHours").value = v;
    autoSchedule();
  });
  el("tsHours").addEventListener("blur", function () {
    const n = cleanHours(el("tsHours").value);
    el("tsHours").value = n === null ? "0" : String(n);
    autoSchedule();
  });
  el("tsForm").addEventListener("submit", submit);
  el("cancelBtn").addEventListener("click", function () { clearForm(false); showMsg("", ""); el("tsDate").value = state.ctx.today; });
  el("calArea").addEventListener("click", onCalendarClick);
  el("calArea").addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("cal-day")) { e.preventDefault(); selectDate(e.target.getAttribute("data-day")); }
  });
  el("calRefresh").addEventListener("click", loadData);
  el("tsPdfBtn").addEventListener("click", function () {
    openPdf({ ctx: state.ctx, anchor: el("tsDate").value || state.ctx.today, employeeId: state.employeeId, list: tsRepo.list, company: D().company });
  });
  fillProjects(el("tsProjList")).then(function (o) { state.opts = o; }).catch(function () { el("tsProjNote").textContent = "The project list could not be read; reload the page."; });
  await loadData();
  // a refresh when the person comes back to the tab (another device may have filed hours)
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") loadData(); });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();

