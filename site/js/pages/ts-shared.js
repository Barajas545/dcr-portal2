/* What the timesheet pages share (P2): who may log time for whom, the project picker, the work
   schedule widget and a few drawing helpers. Browser module; the rules themselves are pure
   (map/timesheets.js) and the database decides every write — this only hides controls.

   context(me) -> {
     me, roster,            my_roster(): the employees in the caller's scope (names, numbers, normal
                            hours; never phone, address or pay)
     mine,                  the caller's own employee row (or null: not linked yet)
     crew,                  a lead's crew (employee ids)
     scope,                 "all" (admin, manager), "all-read" (accountant: reads everyone, writes own),
                            "crew" (a lead with a crew), "self", "view" (view-only account), "none"
     canWrite(employeeId),  may this person write that employee's hours (UI only)
     canConfirm(employeeId) admin, manager, or a lead for self and crew
     writable,              the roster rows this person may log time for
     former,                turned-off employees in scope (never offered for new hours)
     everyone,              roster then former: whose history may be read and printed
     byId(id)               a roster row, or one of former
   } */

import { companyToday } from "../common2.js";
import * as employees from "../repo/employees.js";
import * as projectsRepo from "../repo/projects.js";
import {
  scheduleDefaults, autoSchedule, calcHours, calcBar, lunchRange, timeline, pickerOptions, resolveProject, withFormer,
} from "../map/timesheets.js";
import { esc } from "./shell.js";

export async function context(me) {
  const [roster, mine, crew, former] = await Promise.all([
    employees.roster(),
    employees.mine(me.id).catch(function () { return null; }),
    me.role === "lead" ? employees.crewOf(me.id).catch(function () { return []; }) : Promise.resolve([]),
    employees.former().catch(function () { return []; }),
  ]);
  const role = me.role;
  const mineId = mine ? String(mine.id) : null;
  const crewIds = new Set(crew.map(String));
  let scope;
  if (role === "admin" || role === "manager") scope = "all";
  else if (role === "accountant") scope = "all-read";
  else if (role === "viewer") scope = mineId ? "view" : "none";
  else if (role === "lead" && crewIds.size) scope = "crew";
  else scope = mineId ? "self" : "none";
  function canWrite(id) {
    if (id === null || id === undefined || id === "") return false;
    const k = String(id);
    if (scope === "all") return true;
    if (scope === "view" || scope === "none") return false;
    return k === mineId || crewIds.has(k);
  }
  function canConfirm(id) {
    if (role === "admin" || role === "manager") return true;
    if (role !== "lead") return false;
    const k = String(id);
    return k === mineId || crewIds.has(k);
  }
  const byIdMap = {};
  roster.forEach(function (r) { byIdMap[String(r.id)] = r; });
  if (mine && !byIdMap[mineId]) {
    byIdMap[mineId] = mine;
    roster.push(mine);
  }
  // people who have left: never offered for new hours, but their history is read, printed and
  // corrected by whoever has them in scope (the database decides; RLS returned only those)
  const left = former.filter(function (r) { return r && r.id != null && !byIdMap[String(r.id)]; });
  left.forEach(function (r) { byIdMap[String(r.id)] = r; });
  return {
    me: me, roster: roster, mine: mine, crew: Array.from(crewIds), scope: scope, today: companyToday(),
    canWrite: canWrite, canConfirm: canConfirm,
    writable: roster.filter(function (r) { return canWrite(r.id); }),
    former: left,
    /** the active people, then those who have left (labelled with personLabel) */
    everyone: withFormer(roster, left),
    byId: function (id) { return id === null || id === undefined ? null : byIdMap[String(id)] || null; },
    readOnly: scope === "view" || scope === "none",
  };
}

/** The people a form offers for an existing entry or a preset employee: who may be written for,
    plus that one employee when they have left (or are otherwise not offered) and may still be
    corrected — "(left)" after the name. */
export function formPeople(ctx, employeeId, name) {
  const list = ctx.writable.slice();
  if (employeeId === null || employeeId === undefined || employeeId === "") return list;
  if (list.some(function (r) { return String(r.id) === String(employeeId); })) return list;
  if (!ctx.canWrite(employeeId)) return list;
  const r = ctx.byId(employeeId);
  return list.concat([r || { id: employeeId, full_name: name || "Employee " + employeeId, active: false }]);
}

/** The sentence under the employee field. */
export function scopeNote(ctx) {
  switch (ctx.scope) {
    case "all": return "You can log time for any employee.";
    case "all-read": return ctx.mine ? "You see everyone's hours (read only) and log your own." : "You see everyone's hours (read only).";
    case "crew": return "You can log time for yourself and your crew (" + (ctx.writable.length - (ctx.mine ? 1 : 0)) + ").";
    case "self": return "Logging time for yourself.";
    case "view": return "View only: you can see your hours; the office enters them.";
    default: return "Your account isn’t linked to an employee yet. Ask the office to link it (Employees & crews).";
  }
}

/* ── the project picker (a projects query, active jobs first) ──────────── */

let pickerP = null;
export function projectOptions() {
  if (!pickerP) {
    pickerP = projectsRepo.loadProjects().then(pickerOptions).catch(function (e) { pickerP = null; throw e; });
  }
  return pickerP;
}

/** Fill a <datalist> with the projects; -> the options. */
export async function fillProjects(datalist) {
  const opts = await projectOptions();
  if (datalist) {
    datalist.innerHTML = opts.map(function (o) { return '<option value="' + esc(o.value) + '"></option>'; }).join("");
  }
  return opts;
}

export function projectIdOf(text, opts) { return resolveProject(text, opts); }

/** The text the project box shows for an entry. */
export function projectBoxText(entry, opts) {
  if (!entry || entry.leave) return "";
  if (entry.projectId != null) {
    const o = (opts || []).find(function (x) { return String(x.id) === String(entry.projectId); });
    return o ? o.value : entry.projectLabel;
  }
  return entry.legacyProject || "";
}

/* ── the work schedule widget ──────────────────────────────────────────── */

/** ids: {section, start1, end1, lunch, start2, end2, lunchRange, timeline, calcBar, hours, note?};
    cls: the page's class prefix for the bar and the timeline ("ts" desktop, "m" phone, "bt" batch, "pm").
    -> {fill(defaultsRow, hours), recalc(), values(), show(on), set(entry)} */
export function scheduleWidget(ids, cls) {
  const $ = function (k) { return ids[k] ? document.getElementById(ids[k]) : null; };
  function values() {
    return { start1: $("start1").value, end1: $("end1").value, start2: $("start2").value, end2: $("end2").value,
      lunch: $("lunch").value === "" ? null : Number($("lunch").value) };
  }
  function show(on) { if ($("section")) $("section").style.display = on ? "" : "none"; }
  function clear() {
    ["start1", "end1", "start2", "end2"].forEach(function (k) { $(k).value = ""; });
    $("lunch").value = "1";
    if ($("timeline")) $("timeline").innerHTML = "";
    if ($("calcBar")) $("calcBar").innerHTML = "";
    if ($("lunchRange")) $("lunchRange").textContent = "";
  }
  function recalc() {
    const v = values();
    const entered = Number(String($("hours").value).replace(/[^0-9.]/g, "")) || 0;
    const calc = calcHours(v.start1, v.end1, v.start2, v.end2);
    if ($("lunchRange")) $("lunchRange").textContent = (cls === "m" && v.end1 && Number(v.lunch) > 0 ? "Lunch " : "") + lunchRange(v.end1, v.lunch);
    if ($("timeline")) {
      const tl = timeline(v.start1, v.end1, v.lunch, v.start2, v.end2);
      $("timeline").innerHTML = !tl ? "" :
        '<div class="' + cls + '-timeline">' + tl.blocks.map(function (b) {
          return '<div class="' + cls + "-timeline-block " + cls + "-timeline-" + b.kind + '" style="width:' + b.pct + '%">' + esc(b.label) + "</div>";
        }).join("") + '</div><div class="' + cls + '-timeline-labels"><span>' + esc(tl.from) + "</span><span>" + esc(tl.to) + "</span></div>";
    }
    const bar = calcBar(entered, calc);
    const box = $("calcBar");
    if (!box) return calc;
    if (!bar) { box.innerHTML = ""; return calc; }
    if (cls === "m") {
      box.innerHTML = '<div class="m-calc ' + (bar.match ? "match" : "mismatch") + '"><span>Calculated: ' + bar.calculated.toFixed(1) + "h</span><span>" +
        (bar.match ? "✓ Matches " + bar.entered + "h" : "⚠ Entered " + bar.entered + "h") + "</span></div>";
    } else {
      box.innerHTML = '<div class="' + cls + "-calc-bar " + cls + "-calc-" + (bar.match ? "match" : "mismatch") + '">' +
        '<div><span class="' + cls + '-calc-label">Entered:</span> <span class="' + cls + '-calc-value">' + bar.entered + " hrs</span></div>" +
        '<div><span class="' + cls + '-calc-label">Calculated:</span> <span class="' + cls + '-calc-value">' + bar.calculated.toFixed(1) + " hrs</span></div>" +
        '<div style="font-weight:700;">' + (bar.match ? "✓ Match" : "⚠ Diff: " + bar.diffText) + "</div></div>";
    }
    return calc;
  }
  /** Lay the hours over the employee's normal schedule (the old auto-fill); hides the section when
      there is nothing to lay out. */
  function fill(empRow, hours) {
    const def = scheduleDefaults(empRow);
    const s = autoSchedule(def, hours);
    if (!s) { show(false); clear(); return false; }
    show(true);
    $("start1").value = s.start1; $("end1").value = s.end1; $("lunch").value = String(s.lunch);
    $("start2").value = s.start2; $("end2").value = s.end2;
    if (ids.note && $("note") && empRow) $("note").textContent = "(from " + (empRow.full_name || "the") + "’s schedule)";
    recalc();
    return true;
  }
  function set(e) {
    if (!e || e.leave || !e.start1) { show(false); clear(); return false; }
    show(true);
    $("start1").value = e.start1 || ""; $("end1").value = e.end1 || "";
    $("lunch").value = e.lunch === null || e.lunch === undefined ? "0" : String(e.lunch);
    $("start2").value = e.start2 || ""; $("end2").value = e.end2 || "";
    recalc();
    return true;
  }
  ["start1", "end1", "start2", "end2", "lunch"].forEach(function (k) {
    const n = $(k);
    if (!n) return;
    n.addEventListener("change", recalc);
    if (k === "lunch") n.addEventListener("blur", recalc);
  });
  return { fill: fill, recalc: recalc, values: values, show: show, set: set, clear: clear };
}

/** The bottom-sheet / centre modal of the timesheet pages (their own look): -> close(). The HTML is
    built by the caller with esc(); handlers are attached by the caller on the returned box. */
export function overlay(html, opts) {
  const o = opts || {};
  const host = document.getElementById(o.host || "modalContainer") || document.body;
  host.innerHTML = "";
  const ov = document.createElement("div");
  ov.className = o.overlayClass || "modal-overlay";
  const box = document.createElement("div");
  box.className = o.boxClass || "modal-box";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.innerHTML = html;
  ov.appendChild(box);
  host.appendChild(ov);
  function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); document.removeEventListener("keydown", onKey); }
  function onKey(e) { if (e.key === "Escape") close(); }
  ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
  document.addEventListener("keydown", onKey);
  box.close = close;
  return box;
}

/** Download text as a file (CSV with a BOM so Excel reads UTF-8). */
export function download(name, text, type) {
  const blob = new Blob(["﻿" + text], { type: type || "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}

/** "AB" for an avatar. */
export function avatarInitials(name) {
  const p = String(name || "?").trim().split(/\s+/);
  return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : String(name || "?").slice(0, 2)).toUpperCase();
}
