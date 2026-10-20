/* Time Sheet, phone view (port of the old timesheet-mobile.html / .js; MODULES §4).

   The same entry as the desk page in big targets (the segmented day type, the ± stepper), and the
   two-week calendar the crew asked for: last week and this week, Saturday first, each cell the
   hours in bold over the job's street address (that is how a foreman recognises the job). A tap on
   a day with one entry opens it (Edit, Delete); several open a list; an empty day points the form at
   that day. ?date=YYYY-MM-DD opens on that day (the link in DCR Agents 2's reminders). */

import { boot, el, esc, errorText, confirmBox, qs, D } from "./shell.js";
import { companyToday } from "../common2.js";
import * as tsRepo from "../repo/timesheets.js";
import { context, scopeNote, fillProjects, projectOptions, projectIdOf, projectBoxText, scheduleWidget } from "./ts-shared.js";
import {
  calendarBounds, twoWeeks, isLeave, scheduleText, problem, stepHours, cleanHours, hoursText, niceDay, sourceWord,
  PICK_PROJECT,
} from "../map/timesheets.js";
import { openPdf } from "../timesheet-pdf.js";
import { mountSwitch } from "../push2.js";

const state = { ctx: null, entries: [], editing: null, employeeId: null, opts: [], kind: "work", seq: 0, tok: 0, calDays: {} };
let sched = null;

/* ── day type, employee, hours ─────────────────────────────────────────── */

function setKind(k) {
  state.kind = k;
  document.querySelectorAll("#daySeg button").forEach(function (b) {
    const on = b.getAttribute("data-kind") === k;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const leave = isLeave(k);
  el("projField").style.display = leave ? "none" : "";
  if (leave) { sched.show(false); sched.clear(); } else autoSchedule();
}

function autoSchedule() {
  if (isLeave(state.kind)) { sched.show(false); return; }
  sched.fill(state.ctx.byId(state.employeeId), Number(el("tsHours").value) || 0);
}

function onEmpChange() {
  const v = el("tsEmpSelect").value;
  state.employeeId = v ? v : null;
  renderEntries();
  autoSchedule();
}

function applyScope() {
  const ctx = state.ctx;
  const note = el("empScopeNote");
  note.textContent = scopeNote(ctx);
  note.classList.toggle("warn", ctx.scope === "none");
  if (ctx.readOnly || (ctx.scope === "all-read" && !ctx.mine)) {
    el("mForm").hidden = true;
    el("mReadOnly").hidden = false;
    el("mReadOnly").textContent = ctx.scope === "all-read"
      ? "You see everyone's hours in Team Sheets (read only). Your account is not linked to an employee, so there is nothing of your own to log."
      : scopeNote(ctx);
    el("formTitle").textContent = "Your hours";
    if (ctx.mine) state.employeeId = ctx.mine.id;
    return;
  }
  const sel = el("tsEmpSelect"), ro = el("empReadonly");
  const list = ctx.writable;
  if (ctx.scope === "self" || ctx.scope === "all-read" || list.length <= 1) {
    const only = ctx.mine || list[0] || null;
    state.employeeId = only ? only.id : null;
    ro.textContent = only ? only.full_name : "—";
    ro.hidden = false;
    sel.hidden = true;
    if (!only) el("submitBtn").disabled = true;
  } else {
    sel.innerHTML = '<option value="">Select employee…</option>' + list.map(function (r) {
      return '<option value="' + esc(r.id) + '">' + esc(r.full_name) + "</option>";
    }).join("");
    ro.hidden = true;
    sel.hidden = false;
    if (ctx.mine) { sel.value = String(ctx.mine.id); state.employeeId = ctx.mine.id; }
  }
}

/* ── the calendar ──────────────────────────────────────────────────────── */

function renderEntries() {
  const area = el("listArea");
  const cur = state.employeeId;
  const curRow = state.ctx.byId(cur);
  el("listNote").textContent = cur ? "Showing: " + (curRow ? curRow.full_name : "") : "Showing all entries you can access.";
  const weeks = twoWeeks(state.entries, state.ctx.today, { employeeId: cur });
  state.calDays = {};
  weeks.forEach(function (w) { w.days.forEach(function (d) { state.calDays[d.key] = d.entries.map(function (e) { return String(e.id); }); }); });
  area.innerHTML = weeks.map(function (w) {
    return '<div class="m-cal-week"><div class="m-cal-label"><span>' + esc(w.label + " · " + w.range) + '</span><span class="tot">' + hoursText(w.total) + 'h</span></div><div class="m-cal-grid">' +
      w.days.map(function (d) {
        return '<div class="m-cal-head' + (d.isWeekend ? " weekend" : "") + (d.isToday ? " today" : "") + '">' + d.dow + '<span class="dn">' + d.dayNum + "</span></div>";
      }).join("") +
      w.days.map(function (d) {
        const n = d.entries.length;
        const label = niceDay(d.key) + (n ? ": " + hoursText(d.hours) + "h, " + n + (n === 1 ? " entry" : " entries") : ": no entry, tap to log this day");
        return '<button type="button" class="m-cal-cell' + (d.isWeekend ? " weekend" : "") + (d.isToday ? " today" : "") + (n ? " has" : "") +
          '" data-day="' + d.key + '" aria-label="' + esc(label) + '">' +
          (n ? "" : '<span class="m-cal-dot">·</span>') +
          d.entries.map(function (e) {
            const hs = hoursText(e.hours) + "h";
            return '<span class="m-cal-ent' + (e.leave ? " leave" : "") + '"><span class="m-cal-h' + (hs.length > 4 ? " long" : "") + '">' + esc(hs) +
              '</span><span class="m-cal-a">' + esc(cur ? e.text : (e.employee ? e.employee.split(" ")[0] + " · " : "") + e.text) + "</span></span>";
          }).join("") + "</button>";
      }).join("") + "</div></div>";
  }).join("");
}

function entryById(id) { return state.entries.find(function (x) { return String(x.id) === String(id); }); }

function onCalendarDay(key) {
  const ids = state.calDays[key] || [];
  if (ids.length === 1) { viewEntry(entryById(ids[0])); return; }
  if (ids.length > 1) {
    const rows = ids.map(entryById).filter(Boolean);
    const box = sheet("<h3>" + esc(niceDay(key)) + '</h3><div class="m-daylist">' + rows.map(function (e) {
      return '<button type="button" class="' + (e.leave ? "leave" : "") + '" data-view="' + esc(e.id) + '"><span>' +
        esc((state.employeeId ? "" : e.employeeName + " · ") + (e.leave ? e.dayType : e.place)) + '</span><span class="hrs">' + hoursText(e.hours) + "h</span></button>";
    }).join("") + '</div><div class="m-sheet-actions"><button type="button" data-close="1">Close</button></div>');
    box.addEventListener("click", function (ev) {
      const b = ev.target.closest("[data-view]");
      if (b) { closeSheet(); viewEntry(entryById(b.getAttribute("data-view"))); }
    });
    return;
  }
  if (!state.editing && !el("mForm").hidden) {
    el("tsDate").value = key;
    autoSchedule();
    showMsg("", "Date set to " + niceDay(key) + ".");
    // fades on its own, but only while it is still THE notice (Saving… or an error must stay)
    const tok = ++state.tok;
    setTimeout(function () { if (tok === state.tok && /^Date set to/.test(el("formMsg").textContent)) el("formMsg").className = "m-msg"; }, 2500);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ── the bottom sheet ──────────────────────────────────────────────────── */

function sheet(html) {
  const host = el("modalContainer");
  host.innerHTML = '<div class="m-overlay"><div class="m-sheet" role="dialog" aria-modal="true">' + html + "</div></div>";
  const ov = host.firstChild, box = ov.firstChild;
  ov.addEventListener("click", function (e) { if (e.target === ov || e.target.closest("[data-close]")) closeSheet(); });
  return box;
}
function closeSheet() { el("modalContainer").innerHTML = ""; }

function viewEntry(e) {
  if (!e) return;
  const sch = scheduleText(e);
  const rows = [["Employee", e.employeeName], [e.leave ? "Day type" : "Project", e.leave ? e.dayType : e.projectLabel]];
  if (!e.leave && e.projectAddress) rows.push(["Address", [e.projectAddress, e.projectCity].filter(Boolean).join(", ")]);
  rows.push(["Date", niceDay(e.date)], ["Hours", hoursText(e.hours) + " hrs"]);
  if (sch) rows.push(["Schedule", sch]);
  if (e.work) rows.push(["Work", e.work]);
  if (e.source && e.source !== "portal") rows.push(["Came from", sourceWord(e.source)]);
  const canW = state.ctx.canWrite(e.employeeId);
  const box = sheet("<h3>Time entry</h3>" + rows.map(function (r) {
    return '<div class="m-krow"><span>' + esc(r[0]) + "</span><span>" + esc(r[1] || "—") + "</span></div>";
  }).join("") + '<div class="m-sheet-actions">' +
    (canW ? '<button type="button" data-act="edit">Edit</button><button type="button" class="del" data-act="del">Delete</button>' : "") +
    '<button type="button" data-close="1">Close</button></div>');
  box.addEventListener("click", function (ev) {
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    closeSheet();
    if (b.getAttribute("data-act") === "edit") editEntry(e); else deleteEntry(e);
  });
}

function editEntry(e) {
  state.editing = e;
  if (!el("tsEmpSelect").hidden) { el("tsEmpSelect").value = String(e.employeeId); state.employeeId = e.employeeId; }
  setKind(e.kind);
  el("tsProject").value = projectBoxText(e, state.opts);
  el("tsProjNote").textContent = !e.leave && e.projectId == null && e.legacyProject
    ? "From the old portal: this job did not match a project. Leave it, or pick the project." : "";
  el("tsDate").value = e.date;
  el("tsHours").value = hoursText(e.hours);
  el("tsWork").value = e.work || "";
  if (!e.leave && e.start1) sched.set(e); else autoSchedule();
  el("formTitle").textContent = "Edit entry";
  el("submitBtn").textContent = "✓ Save changes";
  el("cancelBtn").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderEntries();
}

async function deleteEntry(e) {
  const ok = await confirmBox("This cannot be undone.", { title: "Delete this entry?", danger: true, okText: "Delete" });
  if (!ok) return;
  try {
    await tsRepo.remove(e);
    if (state.editing && String(state.editing.id) === String(e.id)) clearForm();
    showMsg("ok", "✓ Deleted.");
  } catch (err) {
    showMsg("err", "Could not delete: " + errorText(err));
  }
  await loadData();
}

/* ── the form ──────────────────────────────────────────────────────────── */

function showMsg(kind, text) {
  const m = el("formMsg");
  m.textContent = text || "";
  m.className = "m-msg" + (text ? " show" : "") + (kind ? " " + kind : "");
}

function clearForm() {
  state.editing = null;
  setKind("work");
  el("tsProject").value = "";
  el("tsProjNote").textContent = "";
  el("tsDate").value = state.ctx.today;
  el("tsHours").value = "0";
  el("tsWork").value = "";
  sched.show(false); sched.clear();
  el("formTitle").textContent = "New entry";
  el("submitBtn").textContent = "✓ Submit time sheet";
  el("cancelBtn").hidden = true;
}

function formValues() {
  const leave = isLeave(state.kind);
  const text = el("tsProject").value.trim();
  const ed = state.editing;
  const keepLegacy = !!(ed && !leave && ed.projectId == null && ed.legacyProject && text === ed.legacyProject);
  const shown = el("tsScheduleSection").style.display !== "none" && !leave;
  const v = sched.values();
  return {
    employeeId: state.employeeId, date: el("tsDate").value, kind: state.kind,
    projectId: leave || keepLegacy ? null : projectIdOf(text, state.opts), legacyProject: keepLegacy ? ed.legacyProject : "",
    hours: cleanHours(el("tsHours").value), work: el("tsWork").value,
    start1: shown ? v.start1 : "", end1: shown ? v.end1 : "", start2: shown ? v.start2 : "", end2: shown ? v.end2 : "",
    lunch: shown ? v.lunch : null,
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
  showMsg("", "Saving…");
  el("submitBtn").disabled = true;
  try {
    if (state.editing) await tsRepo.update(state.editing, f); else await tsRepo.create(f);
    showMsg("ok", "✓ Saved.");
    clearForm();
    setTimeout(function () { if (/Saved/.test(el("formMsg").textContent)) el("formMsg").className = "m-msg"; }, 3500);
  } catch (e) {
    if (e && (e.code === "PT409" || e.status === 409) && state.editing) {
      showMsg("err", "Someone else changed this entry meanwhile. The latest is shown; make your change again.");
      const cur = e.current;
      el("submitBtn").disabled = false;
      await loadData();
      if (cur) editEntry(cur); else clearForm();
      return;
    }
    showMsg("err", errorText(e));
  }
  el("submitBtn").disabled = false;
  await loadData();
}

async function loadData() {
  const seq = ++state.seq;
  if (!state.entries.length) el("listArea").innerHTML = '<div class="m-empty">Loading…</div>';
  try {
    const b = calendarBounds(state.ctx.today = companyToday());
    const list = await tsRepo.list(b.from, b.to);
    if (seq !== state.seq) return;
    state.entries = list;
    renderEntries();
  } catch (e) {
    if (seq !== state.seq) return;
    el("listArea").innerHTML = '<div class="m-empty">' + esc(errorText(e)) + "</div>";
  }
}

async function start() {
  const me = await boot("timesheet");
  sched = scheduleWidget({ section: "tsScheduleSection", start1: "tsStart1", end1: "tsEnd1", lunch: "tsLunch", start2: "tsStart2",
    end2: "tsEnd2", lunchRange: "tsLunchRange", calcBar: "tsCalcBar", hours: "tsHours" }, "m");
  try {
    state.ctx = await context(me);
  } catch (e) {
    el("listArea").innerHTML = '<div class="m-empty">' + esc(errorText(e)) + "</div>";
    el("mForm").hidden = true;
    return;
  }
  applyScope();
  const want = qs("date");
  el("tsDate").value = /^\d{4}-\d{2}-\d{2}$/.test(String(want || "")) ? want : state.ctx.today;
  document.querySelectorAll("#daySeg button").forEach(function (b) { b.addEventListener("click", function () { setKind(b.getAttribute("data-kind")); }); });
  el("tsEmpSelect").addEventListener("change", onEmpChange);
  el("tsDate").addEventListener("change", autoSchedule);
  el("hrsMinus").addEventListener("click", function () { el("tsHours").value = stepHours(el("tsHours").value, -0.5); autoSchedule(); });
  el("hrsPlus").addEventListener("click", function () { el("tsHours").value = stepHours(el("tsHours").value, 0.5); autoSchedule(); });
  el("tsHours").addEventListener("input", function () {
    const v = el("tsHours").value.replace(/[^0-9.]/g, "");
    if (v !== el("tsHours").value) el("tsHours").value = v;
    autoSchedule();
  });
  el("tsHours").addEventListener("blur", function () { const n = cleanHours(el("tsHours").value); el("tsHours").value = n === null ? "0" : String(n); autoSchedule(); });
  el("mForm").addEventListener("submit", submit);
  el("cancelBtn").addEventListener("click", function () { clearForm(); showMsg("", ""); });
  el("listArea").addEventListener("click", function (e) { const c = e.target.closest("[data-day]"); if (c) onCalendarDay(c.getAttribute("data-day")); });
  el("listRefresh").addEventListener("click", loadData);
  el("deskLink").addEventListener("click", function () { try { sessionStorage.setItem("dcr2TsView", "desktop"); } catch (x) { /* */ } });
  el("tsPdfBtn").addEventListener("click", function () {
    openPdf({ ctx: state.ctx, anchor: el("tsDate").value || state.ctx.today, employeeId: state.employeeId, list: tsRepo.list, company: D().company });
  });
  fillProjects(el("tsProjList")).then(function (o) { state.opts = o; }).catch(function () { el("tsProjNote").textContent = "The project list could not be read; reload the page."; });
  mountSwitch("pushSlot");
  await loadData();
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") loadData(); });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
