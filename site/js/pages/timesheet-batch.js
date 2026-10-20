/* Batch Time Entry (port of the old timesheet-batch.html / .js; MODULES §4): one entry for many
   employees. Pick the people who worked together (or are off), fill the details once; one row is
   inserted per employee and each gets its own result line — one refusal never stops the others.

   For admin and manager (everyone) and leads with a crew (self and crew; the database enforces it);
   a lead without a crew is pointed to the Time Sheet. The schedule is laid over the FIRST selected
   employee's normal hours and applies to everyone selected. */

import { boot, el, esc, errorText } from "./shell.js";
import * as tsRepo from "../repo/timesheets.js";
import { context, scopeNote, fillProjects, projectOptions, projectIdOf, scheduleWidget, avatarInitials } from "./ts-shared.js";
import { isLeave, kindWord, problem, stepHours, cleanHours, hoursText, niceDay, clock12, PICK_PROJECT } from "../map/timesheets.js";

const state = { ctx: null, selected: [], opts: [], busy: false };
let sched = null;

function kind() { return el("btDayType").value; }
function people() { return state.ctx ? state.ctx.writable : []; }
function isSel(id) { return state.selected.indexOf(String(id)) !== -1; }

function renderList() {
  const q = el("btEmpSearch").value.trim().toLowerCase();
  const list = people().filter(function (r) { return !q || String(r.full_name).toLowerCase().indexOf(q) !== -1; });
  el("btEmpList").innerHTML = list.length ? list.map(function (r) {
    return '<button type="button" class="bt-emp-item' + (isSel(r.id) ? " selected" : "") + '" data-id="' + esc(r.id) + '" aria-pressed="' + isSel(r.id) + '">' +
      '<span class="bt-emp-checkbox"><span class="bt-emp-checkmark">✓</span></span>' +
      '<span class="bt-emp-avatar">' + esc(avatarInitials(r.full_name)) + "</span>" +
      '<span class="bt-emp-name-text">' + esc(r.full_name) + "</span>" +
      (r.employee_no ? '<span class="bt-emp-no">' + esc(r.employee_no) + "</span>" : "") + "</button>";
  }).join("") : '<div style="padding:12px;color:var(--text-muted);font-size:13px;font-style:italic;">No employees found</div>';
}

function renderSelected() {
  const bar = el("btSelectedBar");
  if (!state.selected.length) {
    bar.innerHTML = '<span style="font-size:12px;color:var(--text-muted);font-style:italic;">No employees selected</span>';
  } else {
    bar.innerHTML = '<span class="bt-selected-count">' + state.selected.length + " selected:</span> " + state.selected.map(function (id) {
      const r = state.ctx.byId(id);
      return '<span class="bt-selected-chip">' + esc(r ? r.full_name : id) + '<button type="button" data-unpick="' + esc(id) + '" aria-label="Remove ' + esc(r ? r.full_name : "") + '">&times;</button></span>';
    }).join("");
  }
  autoSchedule();
  preview();
}

function toggle(id) {
  const k = String(id);
  if (isSel(k)) state.selected = state.selected.filter(function (x) { return x !== k; });
  else state.selected.push(k);
  renderList();
  renderSelected();
}

function autoSchedule() {
  if (isLeave(kind()) || !state.selected.length) { sched.show(false); el("btSchedNote").textContent = ""; preview(); return; }
  const first = state.ctx.byId(state.selected[0]);
  const ok = sched.fill(first, Number(el("btHours").value) || 0);
  el("btSchedNote").textContent = ok && first ? "(from " + first.full_name + "’s schedule — applies to everyone selected)" : "";
  preview();
}

function onDayType() {
  const leave = isLeave(kind());
  el("btProjField").style.display = leave ? "none" : "";
  autoSchedule();
}

function forms() {
  const leave = isLeave(kind());
  const shown = !leave && el("btScheduleSection").style.display !== "none";
  const v = sched.values();
  const projectId = leave ? null : projectIdOf(el("btProject").value, state.opts);
  return state.selected.map(function (id) {
    return { employeeId: id, date: el("btDate").value, kind: kind(), projectId: projectId, hours: cleanHours(el("btHours").value),
      work: el("btWork").value, start1: shown ? v.start1 : "", end1: shown ? v.end1 : "", start2: shown ? v.start2 : "", end2: shown ? v.end2 : "",
      lunch: shown ? v.lunch : null };
  });
}

function preview() {
  const box = el("btPreviewSection");
  if (!state.selected.length) { box.hidden = true; return; }
  box.hidden = false;
  const leave = isLeave(kind());
  const hours = cleanHours(el("btHours").value) || 0;
  const date = el("btDate").value;
  const proj = leave ? kindWord(kind()) : (el("btProject").value.trim() || "—");
  const v = sched.values();
  const shown = !leave && el("btScheduleSection").style.display !== "none";
  const range = shown && v.start1 ? clock12(v.start1) + " – " + clock12(v.end2 || v.end1) : "";
  el("btPreviewList").innerHTML = state.selected.map(function (id) {
    const r = state.ctx.byId(id);
    return '<div class="bt-preview-row"><span class="bt-preview-emp">' + esc(r ? r.full_name : id) + "</span>" +
      '<span class="bt-preview-detail">' + esc(proj) + "</span>" +
      '<span class="bt-preview-detail">' + esc(date ? niceDay(date) : "—") + "</span>" +
      (range ? '<span class="bt-preview-detail">' + esc(range) + "</span>" : "") +
      '<span class="bt-preview-badge">' + hoursText(hours) + " hrs</span></div>";
  }).join("") +
    '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
    '<span style="font-size:12px;color:var(--text-muted);font-weight:600;">' + state.selected.length + " entries × " + hoursText(hours) + " hrs</span>" +
    '<span style="font-size:14px;font-weight:700;color:var(--acc);">' + hoursText(state.selected.length * hours) + " total hours</span></div>";
}

function say(text, kind) {
  el("btMsg").innerHTML = text ? '<span style="color:' + (kind === "err" ? "var(--err)" : "var(--text-muted)") + '">' + esc(text) + "</span>" : "";
}

async function submit() {
  if (state.busy) return;
  el("btResult").innerHTML = "";
  if (!state.selected.length) { say("Please select at least one employee.", "err"); return; }
  try { state.opts = await projectOptions(); } catch (e) { /* said below: no project resolves */ }
  const list = forms();
  if (!isLeave(kind()) && el("btProject").value.trim() && list[0].projectId === null) { say(PICK_PROJECT, "err"); return; }
  const bad = problem(list[0]);
  if (bad) { say(bad, "err"); return; }
  state.busy = true;
  el("btSubmitBtn").disabled = true;
  say("Submitting " + list.length + " entries…");
  const results = await tsRepo.createMany(list, function (r, i, n) { say("Submitting… " + (i + 1) + " / " + n); });
  state.busy = false;
  el("btSubmitBtn").disabled = false;
  const ok = results.filter(function (r) { return r.ok; });
  const fail = results.filter(function (r) { return !r.ok; });
  const name = function (r) { const x = state.ctx.byId(r.form.employeeId); return x ? x.full_name : String(r.form.employeeId); };
  let h = "";
  if (ok.length) {
    h += '<div class="bt-result bt-result-success" id="btOk"><div style="font-weight:700;margin-bottom:6px;">✓ ' + ok.length + (ok.length === 1 ? " entry" : " entries") + " created</div>" +
      ok.map(function (r) { return '<div class="bt-result-item"><span>✓</span><span>' + esc(name(r)) + "</span></div>"; }).join("") + "</div>";
  }
  if (fail.length) {
    h += '<div class="bt-result bt-result-error" id="btFail" style="margin-top:8px;"><div style="font-weight:700;margin-bottom:6px;">✗ ' + fail.length + " failed</div>" +
      fail.map(function (r) { return '<div class="bt-result-item"><span>✗</span><span>' + esc(name(r)) + " — " + esc(errorText(r.error)) + "</span></div>"; }).join("") + "</div>";
  }
  el("btResult").innerHTML = h;
  say("");
  if (ok.length && !fail.length) {
    state.selected = [];
    el("btHours").value = "0";
    el("btWork").value = "";
    renderList();
    renderSelected();
  } else if (ok.length) {
    // keep only the ones that failed selected, so a second press retries just those
    state.selected = fail.map(function (r) { return String(r.form.employeeId); });
    renderList();
    renderSelected();
  }
}

async function start() {
  const me = await boot("teamsheets", { roles: ["admin", "manager", "lead"] });
  sched = scheduleWidget({ section: "btScheduleSection", start1: "btStart1", end1: "btEnd1", lunch: "btLunch", start2: "btStart2", end2: "btEnd2",
    lunchRange: "btLunchRange", timeline: "btTimeline", calcBar: "btCalcBar", hours: "btHours" }, "bt");
  try {
    state.ctx = await context(me);
  } catch (e) {
    el("btEmpList").innerHTML = '<div style="padding:12px;color:var(--err);font-size:13px;">' + esc(errorText(e)) + "</div>";
    return;
  }
  if (state.ctx.scope !== "all" && state.ctx.scope !== "crew") {
    // Batch Entry is for the office and for leads with a crew (MODULES §4, the old portal's rule):
    // a lead without a crew is sent to the Time Sheet instead of a one-person batch
    el("btApp").innerHTML = '<div class="bt-section" id="btNoCrew"><div class="bt-header"><h2>Batch Time Entry</h2></div>' +
      '<p style="font-size:14px;margin:0 0 1rem;">Batch Entry is for leads with a crew. You have no crew yet: ask the office to set it ' +
      "(Employees &amp; crews). Your own hours go on the Time Sheet.</p>" +
      '<a class="bt-btn-primary" id="btToTimesheet" href="timesheet.html" style="display:inline-block;text-decoration:none;text-align:center;">🕐 Open the Time Sheet</a></div>';
    return;
  }
  el("btScopeNote").textContent = state.ctx.scope === "crew" ? scopeNote(state.ctx) : "Everyone is in your scope.";
  el("btDate").value = state.ctx.today;
  renderList();
  renderSelected();
  el("btEmpSearch").addEventListener("input", renderList);
  el("btEmpList").addEventListener("click", function (e) { const b = e.target.closest("[data-id]"); if (b) toggle(b.getAttribute("data-id")); });
  el("btSelectedBar").addEventListener("click", function (e) { const b = e.target.closest("[data-unpick]"); if (b) toggle(b.getAttribute("data-unpick")); });
  el("btSelectAll").addEventListener("click", function () {
    const q = el("btEmpSearch").value.trim().toLowerCase();
    people().forEach(function (r) { if ((!q || String(r.full_name).toLowerCase().indexOf(q) !== -1) && !isSel(r.id)) state.selected.push(String(r.id)); });
    renderList(); renderSelected();
  });
  el("btDeselectAll").addEventListener("click", function () { state.selected = []; renderList(); renderSelected(); });
  el("btDayType").addEventListener("change", onDayType);
  el("btMinus").addEventListener("click", function () { el("btHours").value = stepHours(el("btHours").value, -0.5); autoSchedule(); });
  el("btPlus").addEventListener("click", function () { el("btHours").value = stepHours(el("btHours").value, 0.5); autoSchedule(); });
  el("btHours").addEventListener("input", function () {
    const v = el("btHours").value.replace(/[^0-9.]/g, "");
    if (v !== el("btHours").value) el("btHours").value = v;
    autoSchedule();
  });
  el("btHours").addEventListener("blur", function () { const x = cleanHours(el("btHours").value); el("btHours").value = x === null ? "0" : String(x); autoSchedule(); });
  ["btProject", "btDate", "btWork", "btStart1", "btEnd1", "btStart2", "btEnd2", "btLunch"].forEach(function (id) {
    el(id).addEventListener("input", preview);
    el(id).addEventListener("change", preview);
  });
  el("btSubmitBtn").addEventListener("click", submit);
  fillProjects(el("btProjList")).then(function (o) { state.opts = o; }).catch(function () { say("The project list could not be read; reload the page.", "err"); });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
