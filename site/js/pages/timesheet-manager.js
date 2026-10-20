/* Team Time Sheets (port of the old timesheet-manager.html / .js; MODULES §4).

   One week (Saturday to Friday) of everyone in scope: a row per employee, the hours of each day
   (over 8 hours and weekend hours marked), the week's total against 40, and the sign-off column.
   Prev / next / today, a project filter and a name search; drag rows to reorder (kept on this
   device); a day cell opens that day's entries (edit, delete, add); Add Entry; Export CSV (with the
   formula guard); the printable Time card.

   Sign-off: a tick per person who confirmed the week, in that person's colour; a dashed tick when
   the hours changed since (stale). Confirming sends the fingerprint of the rows ON THIS SCREEN
   (map/timesheets.js weekFingerprint, never the value timesheet_weeks handed back): the database
   refuses (409) when what it holds differs — a change made while the dialog was open, or one whose
   live event never reached this page — nothing is confirmed, the week is read again and the person
   decides again. Rows and sign-offs are always read together (the 90-second and on-focus refreshes
   too). A signature is withdrawn by its owner, or by an admin.
   Live: changes made anywhere (a phone, Desktop 2, a texted timesheet) appear by themselves.

   admin and manager: everyone, edit and confirm; accountant: everyone, read only (Q7); lead: self
   and crew. Field and view-only people use the Time Sheet page. */

import { boot, el, esc, errorText, toast, confirmBox, qs, setQs, store, D } from "./shell.js";
import { companyToday } from "../common2.js";
import { watch } from "../live.js";
import * as tsRepo from "../repo/timesheets.js";
import { context, formPeople, fillProjects, projectOptions, projectIdOf, projectBoxText, scheduleWidget, download, avatarInitials } from "./ts-shared.js";
import {
  weekGrid, sortByOrder, cellClass, totalClass, weekStats, weekCsv, shortDay, DAY_NAMES, isLeave, kindWord, scheduleText,
  problem, cleanHours, hoursText, longDate, projectKey, safeColor, weekFingerprint, screenBehind, sourceWord, weeksOf,
  personLabel, PICK_PROJECT,
} from "../map/timesheets.js";
import { saturdayOfYmd, addDays } from "../map/pacific.js";

const ORDER_KEY = "dcr2_employee_order_v1";
const state = { ctx: null, sat: "", entries: [], weeks: {}, seq: 0, opts: [], live: null, liveTimer: null, dragFrom: null, confFor: null, confFp: null, weeksDown: "",
  recheckAt: 0 };
let sched = null;

const role = function () { return state.ctx ? state.ctx.me.role : ""; };
const canConfirmRole = function () { return ["admin", "manager", "lead"].indexOf(role()) !== -1; };
const readOnlyAll = function () { return state.ctx && (state.ctx.scope === "all-read" || state.ctx.readOnly); };

/* ── the week ──────────────────────────────────────────────────────────── */

function weekLabel() {
  const fri = addDays(state.sat, 6);
  return shortDay(state.sat) + " — " + shortDay(fri) + ", " + fri.slice(0, 4);
}

function setWeek(sat) {
  state.sat = saturdayOfYmd(sat);
  el("pmWeekLabel").textContent = weekLabel();
  el("pmCardLink").href = "report-timecard.html?week=" + state.sat;
  setQs("week", state.sat === saturdayOfYmd(companyToday()) ? null : state.sat);
  subscribe();
  return load();
}

function savedOrder() {
  try { const v = JSON.parse(store.get(ORDER_KEY, "null")); return Array.isArray(v) ? v.map(String) : null; } catch (e) { return null; }
}

function grid() {
  const g = weekGrid(state.entries, state.ctx.roster, state.sat, { project: el("pmFilterProject").value, search: el("pmFilterEmployee").value });
  g.employees = sortByOrder(g.employees, savedOrder());
  return g;
}

/* ── sign-off cells ────────────────────────────────────────────────────── */

function weekOf(id) { return state.weeks[String(id)] || null; }
function isMine(m) { return m.mine === true; }
function myMark(w) {
  return w ? w.marks.find(isMine) || null : null;
}
function canWithdraw(m) { return m.canWithdraw === true; }
function when(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" }) + " " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
}
function canConfirm(id) { return canConfirmRole() && state.ctx.canConfirm(id) && !state.weeksDown; }

function confirmCell(r) {
  if (state.weeksDown) return '<span class="pm-conf-none" title="' + esc(state.weeksDown) + '">?</span>';
  const w = weekOf(r.id);
  const marks = (w && w.marks) || [];
  const mine = myMark(w);
  let h = '<button type="button" class="pm-conf-cell" data-conf="' + esc(r.id) + '" title="' + (marks.length ? "Who has checked this week" : "Not checked yet") + '">';
  marks.forEach(function (m) {
    h += '<span class="pm-conf-tick' + (m.stale ? " stale" : "") + '" style="--tick:' + safeColor(m.color) + '" title="' +
      esc(m.name + (m.stale ? " — hours changed after this check" : " — checked " + when(m.at))) + '">' + esc(m.initials) + "</span>";
  });
  if (!marks.length) h += canConfirm(r.id) && r.total > 0 ? '<span class="pm-conf-add">Confirm</span>' : '<span class="pm-conf-none">—</span>';
  else if (canConfirm(r.id) && !mine) h += '<span class="pm-conf-plus" title="Add your confirmation">+</span>';
  return h + "</button>";
}

/* ── the table ─────────────────────────────────────────────────────────── */

function render() {
  const area = el("pmTableArea");
  const g = grid();
  updateStats(g);
  if (!g.employees.length) { area.innerHTML = '<div class="pm-no-data">No employees found for this week.</div>'; return; }
  let h = '<table class="pm-table"><thead><tr><th>Employee</th>';
  g.days.forEach(function (d, i) {
    h += '<th class="' + (i < 2 ? "weekend" : "") + '">' + DAY_NAMES[i] + '<br><span style="font-weight:400;font-size:10px;">' + esc(shortDay(d)) + "</span></th>";
  });
  h += '<th class="col-total">Total</th><th class="col-conf">Confirmed</th></tr></thead><tbody>';
  g.employees.forEach(function (r, idx) {
    const w = weekOf(r.id);
    const cls = w && w.confirmed ? "pm-row-confirmed" : w && w.staleCount ? "pm-row-stale" : "";
    h += '<tr class="' + cls + '" data-emp="' + esc(r.id) + '" data-idx="' + idx + '" draggable="true">' +
      '<td><div class="pm-emp-cell"><span class="pm-drag-handle" title="Drag to reorder" aria-hidden="true">☰</span><div class="pm-emp-name">' +
      '<div class="pm-emp-avatar">' + esc(avatarInitials(r.name)) + '</div><div class="pm-emp-details"><div>' + esc(r.name) + "</div>" +
      (r.no ? '<div class="pm-emp-id">ID: ' + esc(r.no) + "</div>" : "") +
      '<a class="pm-emp-tc" href="report-timecard.html?emp=' + encodeURIComponent(r.id) + "&week=" + state.sat + '">Time card</a>' +
      "</div></div></div></td>";
    g.days.forEach(function (d, i) {
      const hrs = r.days[d] || 0;
      h += '<td><button type="button" class="pm-cell-hrs ' + cellClass(hrs, i < 2) + '" data-day="' + d + '" aria-label="' +
        esc(r.name + ", " + DAY_NAMES[i] + " " + shortDay(d) + ": " + hoursText(hrs) + " hours") + '">' +
        (hrs > 0 ? hoursText(hrs) : '<span class="pm-missing-dot"></span>') + "</button></td>";
    });
    h += '<td><span class="pm-cell-total ' + totalClass(r.total) + '">' + hoursText(r.total) + "</span></td><td>" + confirmCell(r) + "</td></tr>";
  });
  const okCount = g.employees.filter(function (r) { const w = weekOf(r.id); return w && w.confirmed; }).length;
  const withHours = g.employees.filter(function (r) { return r.total > 0; }).length;
  h += '</tbody><tfoot><tr><td>All Employees</td>' + g.dayTotals.map(function (t) { return "<td>" + hoursText(t) + "</td>"; }).join("") +
    "<td>" + hoursText(g.grand) + "</td><td>" + okCount + " / " + withHours + "</td></tr></tfoot></table>";
  area.innerHTML = h;
}

function updateStats(g) {
  const s = weekStats(g, state.weeks);
  const c = el("pmStats").children;
  c[0].innerHTML = '<div class="pm-stat-value">' + hoursText(s.hours) + '</div><div class="pm-stat-label">Total Hours</div>';
  c[1].className = "pm-stat-card" + (s.reporting < s.employees ? " warn" : " success");
  c[1].innerHTML = '<div class="pm-stat-value">' + s.reporting + " / " + s.employees + '</div><div class="pm-stat-label">Employees Reporting</div>';
  c[2].innerHTML = '<div class="pm-stat-value">' + s.entries + '</div><div class="pm-stat-label">Time Entries</div>';
  c[3].innerHTML = '<div class="pm-stat-value">' + s.projects + '</div><div class="pm-stat-label">Active Projects</div>';
  c[4].className = "pm-stat-card" + (s.stale ? " warn" : s.withHours && s.confirmed === s.withHours ? " success" : "");
  c[4].innerHTML = '<div class="pm-stat-value">' + s.confirmed + " / " + s.withHours + '</div><div class="pm-stat-label">' +
    (s.stale ? "Confirmed · " + s.stale + " need re-check" : "Hours Confirmed") + "</div>";
}

function fillProjectFilter() {
  const sel = el("pmFilterProject");
  const cur = sel.value;
  const seen = {};
  const list = [];
  state.entries.forEach(function (e) {
    const k = projectKey(e);
    if (seen[k]) return;
    seen[k] = 1;
    list.push({ k: k, t: e.leave ? kindWord(e.kind) : e.projectLabel });
  });
  list.sort(function (a, b) { return a.t.localeCompare(b.t, "en", { numeric: true }); });
  sel.innerHTML = '<option value="">All projects</option>' + list.map(function (x) {
    return '<option value="' + esc(x.k) + '">' + esc(x.t) + "</option>";
  }).join("");
  if (seen[cur]) sel.value = cur;
}

/* ── loading ───────────────────────────────────────────────────────────── */

async function load(quiet) {
  const seq = ++state.seq;
  if (!quiet) el("pmTableArea").innerHTML = '<div class="pm-no-data">Loading time sheets…</div>';
  const sat = state.sat, fri = addDays(state.sat, 6);
  try {
    const [entries, weeks] = await Promise.all([
      tsRepo.list(sat, fri),
      tsRepo.weeks(sat, fri).then(function (w) { return { ok: w }; }, function (e) { return { err: e }; }),
    ]);
    if (seq !== state.seq) return;          // a newer week was asked for meanwhile
    state.entries = entries;
    if (weeks.err) { state.weeks = {}; state.weeksDown = "Sign-off could not be read: " + errorText(weeks.err); }
    else { state.weeks = weeksOf(weeks.ok, sat); state.weeksDown = ""; }
    el("pmConfirmAllBtn").hidden = !canConfirmRole() || !!state.weeksDown;
    fillProjectFilter();
    render();
    // the two reads crossed a change (or its live event is still on the way): read again once, soon.
    // A confirmation meanwhile carries the screen's fingerprint, so the database refuses it (409).
    if (!weeks.err && screenBehind(state.weeks, state.entries, sat).length && Date.now() - state.recheckAt > 5000) {
      state.recheckAt = Date.now();
      soon();
    }
  } catch (e) {
    if (seq !== state.seq) return;
    el("pmTableArea").innerHTML = '<div class="pm-no-data" style="color:var(--err);">' + esc(errorText(e)) + "</div>";
  }
}

/** Other people's sign-offs have no live channel: the rows AND the sign-offs are read again together
    (never the sign-offs alone: a fresh fingerprint beside stale rows would sign hours not shown). */
function refresh() {
  if (state.sat) load(true);
}

function subscribe() {
  if (state.live) { state.live(); state.live = null; }
  const sat = state.sat, fri = addDays(state.sat, 6);
  const inWeek = function (r) { return r && r.work_date && String(r.work_date).slice(0, 10) >= sat && String(r.work_date).slice(0, 10) <= fri; };
  // no server filter: Realtime cannot filter deletions, and a day's hours are few (the page decides)
  state.live = watch("timesheets", null, function (evt) {
    if (evt.type === "SUBSCRIBED") {
      el("pmLive").textContent = "Live";
      el("pmLive").classList.add("on");
      soon();
      return;
    }
    if (inWeek(evt.new) || inWeek(evt.old) || !evt.old || !evt.old.work_date) soon();
  });
}

function soon() {
  clearTimeout(state.liveTimer);
  state.liveTimer = setTimeout(function () { load(true); }, 450);
}

/* ── modals ────────────────────────────────────────────────────────────── */

function modal(html, narrow) {
  const host = el("pmModalContainer");
  host.innerHTML = '<div class="pm-detail-overlay"><div class="pm-detail-box' + (narrow ? " narrow" : "") + '" role="dialog" aria-modal="true">' + html + "</div></div>";
  const ov = host.firstChild;
  ov.addEventListener("click", function (e) { if (e.target === ov || e.target.closest("[data-close]")) closeModal(); });
  return ov.firstChild;
}
function closeModal() { el("pmModalContainer").innerHTML = ""; }
document.addEventListener("keydown", function (e) { if (e.key === "Escape" && el("pmModalContainer").firstChild) closeModal(); });

function msgIn(box, text, busy) {
  const m = box.querySelector(".pm-form-msg");
  if (m) m.innerHTML = text ? '<span style="color:' + (busy ? "var(--text-muted)" : "var(--err)") + '">' + esc(text) + "</span>" : "";
}

/* ── sign-off ──────────────────────────────────────────────────────────── */

function showConfirmDetail(empId) {
  state.confFor = String(empId);
  // what this dialog shows is what a confirmation vouches for: the fingerprint of the rows on screen
  // as it opens; a change made since (seen live or not) makes the database answer 409
  state.confFp = seenFingerprint(empId);
  const emp = state.ctx.byId(empId);
  const w = weekOf(empId);
  const name = emp ? emp.full_name : (w && w.employeeName) || (state.entries.find(function (e) { return String(e.employeeId) === String(empId); }) || {}).employeeName || "";
  const marks = (w && w.marks) || [];
  const mine = myMark(w);
  const hrs = screenHours(empId);
  let h = '<div class="pm-detail-header"><h3>' + esc(name) + ' — hours checked?</h3><button type="button" class="pm-detail-close" data-close="1" aria-label="Close">&times;</button></div>' +
    '<div class="pm-conf-week">' + esc(weekLabel()) + " · <b>" + hoursText(hrs) + " hrs</b></div>";
  if (!marks.length) h += '<div class="pm-conf-empty">Nobody has confirmed this week yet.</div>';
  else {
    h += '<div class="pm-conf-list">' + marks.map(function (m) {
      const undo = canWithdraw(m);
      return '<div class="pm-conf-row' + (m.stale ? " stale" : "") + '"><span class="pm-conf-tick' + (m.stale ? " stale" : "") + '" style="--tick:' + safeColor(m.color) + '">' + esc(m.initials) + "</span>" +
        '<div class="pm-conf-who"><div><b>' + esc(m.name || "Someone") + '</b><span class="pm-conf-role">' + esc(m.role) + "</span></div>" +
        '<div class="pm-conf-meta">' + (m.stale
          ? "Checked " + esc(m.hoursAtConfirm === null ? "" : hoursText(m.hoursAtConfirm)) + " hrs on " + esc(when(m.at)) + " — the hours have changed since"
          : "Confirmed " + esc(m.hoursAtConfirm === null ? "" : hoursText(m.hoursAtConfirm)) + " hrs on " + esc(when(m.at))) + "</div></div>" +
        (undo ? '<button type="button" class="pm-conf-undo" data-undo="' + esc(m.id) + '" title="Withdraw this confirmation" aria-label="Withdraw this confirmation">&times;</button>' : "") + "</div>";
    }).join("") + "</div>";
  }
  h += '<div class="pm-form-msg"></div><div class="pm-form-actions"><button type="button" class="pm-btn-cancel" data-close="1">Close</button>';
  if (canConfirm(empId)) {
    h += mine && !mine.stale
      ? '<button type="button" class="pm-btn-cancel" data-undo="' + esc(mine.id) + '">Withdraw my confirmation</button>'
      : '<button type="button" class="pm-btn-save" id="pmConfBtn">✓ ' + (mine ? "Re-confirm these hours" : "Confirm these hours") + "</button>";
  }
  h += "</div>";
  const box = modal(h, true);
  box.addEventListener("click", function (e) {
    const u = e.target.closest("[data-undo]");
    if (u) { doUnconfirm(box, u.getAttribute("data-undo")); return; }
    if (e.target.closest("#pmConfBtn")) doConfirm(box, state.confFor, state.confFp);
  });
}

/** The fingerprint to send: the rows of that week as THIS screen shows them (the database computes
    its own and refuses a difference with 409). */
function seenFingerprint(empId) {
  return weekFingerprint(state.entries, empId, state.sat);
}

/** The week's hours as this screen shows them (whatever the project filter). */
function screenHours(empId) {
  const fri = addDays(state.sat, 6);
  return Math.round(state.entries.filter(function (e) {
    return String(e.employeeId) === String(empId) && e.date >= state.sat && e.date <= fri;
  }).reduce(function (s, e) { return s + (Number(e.hours) || 0); }, 0) * 100) / 100;
}

async function doConfirm(box, empId, fp) {
  const btn = box.querySelector("#pmConfBtn");
  if (btn) btn.disabled = true;
  msgIn(box, "Saving your confirmation…", true);
  try {
    await tsRepo.confirm(empId, state.sat, fp || seenFingerprint(empId));
    closeModal();
    toast("Confirmed.", "ok");
    await load(true);
  } catch (e) {
    if (e && (e.code === "PT409" || e.status === 409)) {
      closeModal();
      await load(true);
      await D().alert("These hours changed while you were looking at them, so nothing was confirmed. The week has been read again: check it and confirm again.",
        { title: "Nothing was confirmed" });
      return;
    }
    msgIn(box, errorText(e));
    if (btn) btn.disabled = false;
  }
}

async function doUnconfirm(box, id) {
  msgIn(box, "Withdrawing…", true);
  try {
    await tsRepo.unconfirm(id);
    closeModal();
    toast("Confirmation withdrawn.", "ok");
    await load(true);
  } catch (e) {
    msgIn(box, errorText(e));
  }
}

/* Every row on screen with hours that does not carry this person's live signature. */
async function confirmAll() {
  if (!canConfirmRole()) return;
  const rows = grid().employees.filter(function (r) {
    if (!(r.total > 0) || !canConfirm(r.id)) return false;
    const m = myMark(weekOf(r.id));
    return !m || m.stale;
  });
  if (!rows.length) { await D().alert("Every week on screen with hours already carries your confirmation."); return; }
  const ok = await confirmBox("Confirm the hours of " + rows.length + " employee" + (rows.length === 1 ? "" : "s") + " for " + weekLabel() + "?", { title: "Confirm hours", okText: "Confirm all" });
  if (!ok) return;
  const btn = el("pmConfirmAllBtn"), label = btn.innerHTML;
  btn.disabled = true;
  const changed = [], failed = [];
  for (let i = 0; i < rows.length; i++) {
    btn.textContent = "Confirming " + (i + 1) + " of " + rows.length + "…";
    try { await tsRepo.confirm(rows[i].id, state.sat, seenFingerprint(rows[i].id)); }
    catch (e) { (e && (e.code === "PT409" || e.status === 409) ? changed : failed).push(rows[i].name + (e && e.code !== "PT409" ? " (" + errorText(e) + ")" : "")); }
  }
  btn.innerHTML = label;
  btn.disabled = false;
  await load(true);
  if (changed.length) await D().alert("The hours changed while this screen was open, so these were not confirmed: " + changed.join(", ") + ". The week has been read again — please check them.", { title: "Some weeks changed" });
  if (failed.length) await D().alert("Could not confirm: " + failed.join(", "), { title: "Some rows were not confirmed" });
  if (!changed.length && !failed.length) toast(rows.length + " confirmed.", "ok");
}

/* ── day detail, add, edit, delete ─────────────────────────────────────── */

function showDayDetail(empId, day) {
  const list = state.entries.filter(function (e) { return String(e.employeeId) === String(empId) && e.date === day; });
  const emp = state.ctx.byId(empId);
  const name = emp ? emp.full_name : (list[0] && list[0].employeeName) || "";
  const canW = state.ctx.canWrite(empId);
  let total = 0;
  let h = '<div class="pm-detail-header"><h3>' + esc(name) + " — " + esc(longDate(day)) + '</h3><button type="button" class="pm-detail-close" data-close="1" aria-label="Close">&times;</button></div>';
  if (!list.length) h += '<div class="pm-no-data" style="padding:1rem;">No entries for this day.</div>';
  else {
    list.forEach(function (e) {
      total += e.hours;
      const sch = scheduleText(e);
      h += '<div class="pm-entry-row"><div class="pm-entry-info"><div class="pm-entry-project">' + esc(e.leave ? e.dayType : e.projectLabel || "No project") + "</div>" +
        '<div class="pm-entry-work">' + esc(e.work || "No description") + "</div>" +
        (sch ? '<div class="pm-entry-schedule">🕓 ' + esc(sch) + "</div>" : "") +
        (e.source && e.source !== "portal" ? '<div class="pm-entry-schedule">From ' + esc(sourceWord(e.source)) + "</div>" : "") +
        '</div><div><span class="hrs-badge">' + hoursText(e.hours) + " hrs</span></div>" +
        (canW ? '<div class="pm-entry-actions"><button type="button" class="pm-btn-edit" data-edit="' + esc(e.id) + '">✎ Edit</button>' +
          '<button type="button" class="pm-btn-delete" data-del="' + esc(e.id) + '" aria-label="Delete">🗑</button></div>' : "") + "</div>";
    });
    h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0 4px;border-top:1px solid var(--border);margin-top:4px;">' +
      '<span style="font-weight:700;color:var(--text-muted);font-size:13px;">Day Total</span><span style="font-weight:700;color:var(--acc);font-size:15px;">' + hoursText(total) + " hrs</span></div>";
  }
  if (canW) h += '<div style="margin-top:1rem;padding-top:.75rem;border-top:1px solid var(--border);"><button type="button" class="pm-btn-add" data-add="1">+ Add entry for this day</button></div>';
  const box = modal(h);
  box.addEventListener("click", function (ev) {
    const ed = ev.target.closest("[data-edit]"), dl = ev.target.closest("[data-del]");
    if (ed) openForm(entryById(ed.getAttribute("data-edit")));
    else if (dl) deleteEntry(entryById(dl.getAttribute("data-del")), empId, day);
    else if (ev.target.closest("[data-add]")) openForm(null, { employeeId: empId, date: day });
  });
}

function entryById(id) { return state.entries.find(function (e) { return String(e.id) === String(id); }) || null; }

function openForm(entry, preset) {
  const p = preset || {};
  const empSel = entry ? entry.employeeId : p.employeeId;
  // someone who has left is not offered for new hours, but their own entries stay correctable
  const people = formPeople(state.ctx, empSel, entry ? entry.employeeName : "");
  const kindNow = entry ? entry.kind : "work";
  let h = '<div class="pm-detail-header"><h3>' + (entry ? "Edit Time Entry" : "Add Time Entry") + '</h3><button type="button" class="pm-detail-close" data-close="1" aria-label="Close">&times;</button></div>' +
    '<form id="pmForm" novalidate autocomplete="off"><div class="pm-form-grid">' +
    '<div><label class="pm-form-label" for="pmFormEmp">Employee *</label><select class="pm-form-input" id="pmFormEmp"><option value="">— Select employee —</option>' +
    people.map(function (r) { return '<option value="' + esc(r.id) + '"' + (String(r.id) === String(empSel) ? " selected" : "") + ">" + esc(personLabel(r)) + "</option>"; }).join("") + "</select></div>" +
    '<div><label class="pm-form-label" for="pmFormKind">Day type *</label><select class="pm-form-input" id="pmFormKind">' +
    [["work", "Worked"], ["holiday", "Holiday"], ["vacation", "Vacation"], ["sick", "Sick day"], ["day_off", "Day off"]].map(function (k) {
      return '<option value="' + k[0] + '"' + (k[0] === kindNow ? " selected" : "") + ">" + k[1] + "</option>";
    }).join("") + "</select></div>" +
    '<div class="pm-form-full" id="pmFormProjWrap"><label class="pm-form-label" for="pmFormProject">Project *</label><input class="pm-form-input" id="pmFormProject" list="pmProjList" placeholder="Pick a project (number or name)" value="' +
    esc(entry ? projectBoxText(entry, state.opts) : "") + '"><datalist id="pmProjList">' + state.opts.map(function (o) { return '<option value="' + esc(o.value) + '"></option>'; }).join("") + "</datalist>" +
    (entry && !entry.leave && entry.projectId == null && entry.legacyProject ? '<div class="pm-order-hint" style="margin:4px 0 0">From the old portal: this job did not match a project.</div>' : "") + "</div>" +
    '<div><label class="pm-form-label" for="pmFormDate">Date *</label><input type="date" class="pm-form-input" id="pmFormDate" value="' + esc(entry ? entry.date : p.date || "") + '"></div>' +
    '<div><label class="pm-form-label" for="pmFormHours">Hours *</label><input type="text" class="pm-form-input" id="pmFormHours" inputmode="decimal" placeholder="0" value="' + esc(entry ? hoursText(entry.hours) : "") + '"></div>' +
    '<div class="pm-form-full"><div class="pm-schedule" id="pmFormSchedWrap" style="display:none"><div class="pm-schedule-title">Work Schedule</div><div class="pm-schedule-grid">' +
      '<div class="pm-schedule-session"><div class="pm-schedule-session-title">Morning</div><div class="pm-sched-row"><label class="pm-sched-label" for="pmFormStart1">Start</label><input type="time" class="pm-sched-time" id="pmFormStart1"></div>' +
      '<div class="pm-sched-row"><label class="pm-sched-label" for="pmFormEnd1">End</label><input type="time" class="pm-sched-time" id="pmFormEnd1"></div></div>' +
      '<div class="pm-schedule-session"><div class="pm-schedule-session-title" style="color:var(--gold);">Lunch</div><div class="pm-sched-row"><label class="pm-sched-label" for="pmFormLunch">Hours</label><input type="text" class="pm-sched-lunch" id="pmFormLunch" value="1" inputmode="decimal"></div>' +
      '<div style="font-size:9.5px;color:var(--text-muted);margin-top:3px;" id="pmFormLunchRange"></div></div>' +
      '<div class="pm-schedule-session"><div class="pm-schedule-session-title">Afternoon</div><div class="pm-sched-row"><label class="pm-sched-label" for="pmFormStart2">Start</label><input type="time" class="pm-sched-time" id="pmFormStart2"></div>' +
      '<div class="pm-sched-row"><label class="pm-sched-label" for="pmFormEnd2">End</label><input type="time" class="pm-sched-time" id="pmFormEnd2"></div></div>' +
    '</div><div id="pmFormCalcBar"></div></div></div>' +
    '<div class="pm-form-full"><label class="pm-form-label" for="pmFormWork">Work completed</label><textarea class="pm-form-input" id="pmFormWork" rows="3" maxlength="2000" placeholder="Describe the work…">' + esc(entry ? entry.work : "") + "</textarea></div>" +
    '</div><div class="pm-form-msg"></div><div class="pm-form-actions">' +
    (entry ? '<button type="button" class="pm-btn-danger" data-del="' + esc(entry.id) + '">🗑 Delete</button><div style="flex:1;"></div>' : "") +
    '<button type="button" class="pm-btn-cancel" data-close="1">Cancel</button><button type="submit" class="pm-btn-save" id="pmFormSave">✓ ' + (entry ? "Save changes" : "Save entry") + "</button></div></form>";
  const box = modal(h);
  sched = scheduleWidget({ section: "pmFormSchedWrap", start1: "pmFormStart1", end1: "pmFormEnd1", lunch: "pmFormLunch", start2: "pmFormStart2",
    end2: "pmFormEnd2", lunchRange: "pmFormLunchRange", calcBar: "pmFormCalcBar", hours: "pmFormHours" }, "pm");
  const kindNode = el("pmFormKind");
  function auto() {
    const leave = isLeave(kindNode.value);
    el("pmFormProjWrap").style.display = leave ? "none" : "";
    if (leave) { sched.show(false); return; }
    sched.fill(state.ctx.byId(el("pmFormEmp").value), cleanHours(el("pmFormHours").value) || 0);
  }
  kindNode.addEventListener("change", auto);
  el("pmFormEmp").addEventListener("change", auto);
  el("pmFormHours").addEventListener("change", auto);
  el("pmFormHours").addEventListener("blur", auto);
  if (entry && !entry.leave && entry.start1) sched.set(entry); else auto();
  el("pmFormProjWrap").style.display = isLeave(kindNode.value) ? "none" : "";
  box.addEventListener("click", function (ev) {
    const dl = ev.target.closest("[data-del]");
    if (dl && entry) deleteEntry(entry, entry.employeeId, entry.date);
  });
  el("pmForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    try { state.opts = await projectOptions(); } catch (e) { /* said below: no project resolves */ }
    const k = kindNode.value;
    const leave = isLeave(k);
    const text = el("pmFormProject").value.trim();
    const keepLegacy = !!(entry && !leave && entry.projectId == null && entry.legacyProject && text === entry.legacyProject);
    const shown = !leave && el("pmFormSchedWrap").style.display !== "none";
    const v = sched.values();
    const f = { employeeId: el("pmFormEmp").value || null, date: el("pmFormDate").value, kind: k,
      projectId: leave || keepLegacy ? null : projectIdOf(text, state.opts), legacyProject: keepLegacy ? entry.legacyProject : "",
      hours: cleanHours(el("pmFormHours").value), work: el("pmFormWork").value,
      start1: shown ? v.start1 : "", end1: shown ? v.end1 : "", start2: shown ? v.start2 : "", end2: shown ? v.end2 : "", lunch: shown ? v.lunch : null };
    if (!leave && text && f.projectId === null && !f.legacyProject) { msgIn(box, PICK_PROJECT); return; }
    const bad = problem(f);
    if (bad) { msgIn(box, bad); return; }
    el("pmFormSave").disabled = true;
    msgIn(box, "Saving…", true);
    try {
      if (entry) await tsRepo.update(entry, f); else await tsRepo.create(f);
      closeModal();
      toast(entry ? "Saved." : "Entry added.", "ok");
      await load(true);
    } catch (e) {
      if (entry && e && (e.code === "PT409" || e.status === 409)) {
        msgIn(box, "Someone else changed this entry meanwhile. Close and open it again to see the latest.");
        await load(true);
      } else msgIn(box, errorText(e));
      el("pmFormSave").disabled = false;
    }
  });
}

async function deleteEntry(entry, empId, day) {
  if (!entry) return;
  const ok = await confirmBox("This time entry will be permanently deleted.", { title: "Delete this entry?", danger: true, okText: "Yes, delete" });
  if (!ok) return;
  try {
    await tsRepo.remove(entry);
    toast("Entry deleted.", "ok");
    await load(true);
    closeModal();
    if (empId && day) showDayDetail(empId, day);
  } catch (e) {
    toast("Could not delete: " + errorText(e), "error");
  }
}

/* ── drag to reorder (per device) ──────────────────────────────────────── */

function wireDrag(area) {
  area.addEventListener("dragstart", function (e) {
    const tr = e.target.closest && e.target.closest("tr[data-emp]");
    if (!tr) return;
    state.dragFrom = Number(tr.getAttribute("data-idx"));
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", String(state.dragFrom)); } catch (x) { /* */ }
    setTimeout(function () { tr.classList.add("dragging"); }, 0);
  });
  area.addEventListener("dragover", function (e) {
    const tr = e.target.closest && e.target.closest("tr[data-emp]");
    if (!tr || state.dragFrom === null) return;
    e.preventDefault();
    area.querySelectorAll("tbody tr").forEach(function (r) { r.classList.remove("drag-over-top", "drag-over-bottom"); });
    const idx = Number(tr.getAttribute("data-idx"));
    if (idx < state.dragFrom) tr.classList.add("drag-over-top"); else if (idx > state.dragFrom) tr.classList.add("drag-over-bottom");
  });
  area.addEventListener("drop", function (e) {
    const tr = e.target.closest && e.target.closest("tr[data-emp]");
    if (!tr || state.dragFrom === null) return;
    e.preventDefault();
    const to = Number(tr.getAttribute("data-idx"));
    const ids = Array.from(area.querySelectorAll("tbody tr[data-emp]")).map(function (r) { return r.getAttribute("data-emp"); });
    const moved = ids.splice(state.dragFrom, 1)[0];
    ids.splice(to, 0, moved);
    store.set(ORDER_KEY, JSON.stringify(ids));
    state.dragFrom = null;
    render();
  });
  area.addEventListener("dragend", function () {
    state.dragFrom = null;
    area.querySelectorAll("tbody tr").forEach(function (r) { r.classList.remove("drag-over-top", "drag-over-bottom", "dragging"); });
  });
}

/* ── start ─────────────────────────────────────────────────────────────── */

async function start() {
  const me = await boot("teamsheets", { roles: ["admin", "manager", "accountant", "lead"] });
  try {
    state.ctx = await context(me);
  } catch (e) {
    el("pmTableArea").innerHTML = '<div class="pm-no-data" style="color:var(--err);">' + esc(errorText(e)) + "</div>";
    return;
  }
  const ctx = state.ctx;
  const note = el("pmScopeNote");
  if (ctx.scope === "all") note.textContent = "Viewing all employees.";
  else if (ctx.scope === "all-read") note.textContent = "Viewing all employees — read only (payroll). Entries are made on the Time Sheet, by the crews and the office.";
  else if (ctx.scope === "crew") note.textContent = "Viewing your crew: " + ctx.roster.map(function (r) { return r.full_name; }).join(", ") + ".";
  else note.innerHTML = '<span style="color:var(--gold)">You only manage your own timesheets: ask the office to set your crew (Employees & crews). Use the Time Sheet page for your own entries.</span>';
  el("pmAddBtn").hidden = readOnlyAll() || !ctx.writable.length;
  // Batch Entry is for the office and for leads with a crew (MODULES §4; the old isLeadOrMgr)
  el("pmBatchLink").hidden = readOnlyAll() || !(ctx.scope === "all" || ctx.scope === "crew");
  const want = qs("week");
  wireDrag(el("pmTableArea"));
  el("pmTableArea").addEventListener("click", function (e) {
    const c = e.target.closest("[data-conf]");
    if (c) { showConfirmDetail(c.getAttribute("data-conf")); return; }
    const d = e.target.closest("[data-day]");
    if (d) { const tr = d.closest("tr[data-emp]"); if (tr) showDayDetail(tr.getAttribute("data-emp"), d.getAttribute("data-day")); }
  });
  el("pmPrev").addEventListener("click", function () { setWeek(addDays(state.sat, -7)); });
  el("pmNext").addEventListener("click", function () { setWeek(addDays(state.sat, 7)); });
  el("pmToday").addEventListener("click", function () { setWeek(companyToday()); });
  el("pmRefresh").addEventListener("click", function () { load(); });
  el("pmFilterProject").addEventListener("change", render);
  el("pmFilterEmployee").addEventListener("input", render);
  el("pmResetOrder").addEventListener("click", function () { store.set(ORDER_KEY, null); render(); });
  el("pmCsvBtn").addEventListener("click", function () {
    const g = grid();
    if (!g.employees.length) { D().alert("No data to export."); return; }
    download("timesheets_" + state.sat + ".csv", weekCsv(g));
  });
  el("pmConfirmAllBtn").addEventListener("click", confirmAll);
  el("pmAddBtn").addEventListener("click", function () { openForm(null, { date: companyToday() >= state.sat && companyToday() <= addDays(state.sat, 6) ? companyToday() : state.sat }); });
  fillProjects(null).then(function (o) { state.opts = o; }).catch(function () { /* the form says it */ });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") refresh(); });
  // other people's sign-offs: the signatures are read only through timesheet_weeks (no live channel)
  setInterval(function () { if (document.visibilityState === "visible" && !el("pmModalContainer").firstChild) refresh(); }, 90000);
  await setWeek(/^\d{4}-\d{2}-\d{2}$/.test(String(want || "")) ? want : companyToday());
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();

