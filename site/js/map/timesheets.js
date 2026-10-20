/* Timesheets: DCR Desktop 2 rows (migration M2, BLUEPRINT 3.3.6) <-> what the timesheet pages draw.

   The old pages kept everything in SharePoint text: the employee was a typed name, a leave day was
   written into the project column, clock times were ISO instants built in the browser (and drifted
   an hour across daylight saving and a week across the UTC Friday evening). Here:

     employee  <- employee_id (+ the embedded employees row: full_name, employee_no)
     date      <- work_date  ("YYYY-MM-DD", a calendar day; never through toISOString)
     kind      <- kind       work | holiday | vacation | sick | day_off (the leave words left the
                             project column; dayType is the old word shown to people)
     project   <- project_id (+ the embedded projects row: number, name, address, city), or
                  legacy_project_text for an imported row whose job did not match a project
     hours, work_completed, start1/end1/start2/end2 ("HH:MM:SS" plain clock times),
     lunch_hours, calculated_hours, notes, source ("portal" for every row written here)

   Also here, all pure (node tests import this file):
   * the schedule helpers of the old pages (auto-fill from the roster's normal hours, the
     Entered-vs-Calculated bar), in plain minutes;
   * the two-week calendar model (last week + this week, Saturday first) and the Team Sheets grid
     (overtime over 8 h a day, weekend hours, totals against 40);
   * the CSV writer with the formula-injection guard (a cell starting = + - @ is kept as text);
   * the sign-off marks of rpc timesheet_weeks, and the week fingerprint the database computes
     (md5 over the employee-week's rows ordered by id of "id|date|hours|project", plus "-<count>"):
     a confirmation sends the fingerprint of the rows ON SCREEN, so the database refuses (409) to
     sign hours the person did not see;
   * the people offered for history (withFormer, personLabel): someone who has left stays printable
     and correctable;
   * the timesheet PDF's grouping (one page per day and job), as timesheet-pdf.js draws it. */

import { addDays, dayOfWeek, saturdayOfYmd } from "./pacific.js";

/* ── kinds (day types) ─────────────────────────────────────────────────── */

export const KINDS = Object.freeze(["work", "holiday", "vacation", "sick", "day_off"]);

// What people see: the old portal's words (the day-type menu, the phone's segmented control, the
// calendar and the PDF).
export const DAY_TYPES = Object.freeze([
  Object.freeze({ kind: "work", label: "Worked", short: "Worked", word: "Worked" }),
  Object.freeze({ kind: "holiday", label: "Holiday", short: "Holiday", word: "Holiday" }),
  Object.freeze({ kind: "vacation", label: "Vacation", short: "Vac.", word: "Vacation" }),
  Object.freeze({ kind: "sick", label: "Sick day", short: "Sick", word: "Sick" }),
  Object.freeze({ kind: "day_off", label: "Day off", short: "Off", word: "Day Off" }),
]);

export function isKind(k) { return KINDS.indexOf(String(k || "")) !== -1; }
export function isLeave(k) { return isKind(k) && k !== "work"; }

/** "vacation" -> "Vacation"; "day_off" -> "Day Off" (the word the calendar and the PDF print). */
export function kindWord(k) {
  const d = DAY_TYPES.find(function (x) { return x.kind === k; });
  return d ? d.word : "Worked";
}

/** An old word ("Day Off", "Sick", "vacation", "Vac.") or a kind -> the kind; anything else -> "work". */
export function kindOf(word) {
  const w = String(word == null ? "" : word).trim().toLowerCase().replace(/[.\s-]+/g, "_").replace(/_+$/, "");
  if (isKind(w)) return w;
  const m = { worked: "work", vac: "vacation", sick_day: "sick", off: "day_off", dayoff: "day_off" };
  return m[w] || "work";
}

/* ── clock times ───────────────────────────────────────────────────────── */

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/** Minutes after midnight of "07:30", "07:30:00" or "7:30 AM"; null when it is not a time. */
export function minutesOf(t) {
  if (t === null || t === undefined || t === "") return null;
  const s = String(t).trim().toUpperCase();
  const ap = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(s);
  if (ap) {
    let h = Number(ap[1]) % 12;
    if (ap[3] === "PM") h += 12;
    const mi = Number(ap[2]);
    return mi < 60 ? h * 60 + mi : null;
  }
  const m = TIME_RE.exec(s);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return h * 60 + mi;
}

const pad2 = function (n) { return String(n).padStart(2, "0"); };

/** minutes -> "07:30" (the value of an <input type=time>); clamped to the day. */
export function hmOf(min) {
  if (min === null || min === undefined || !Number.isFinite(Number(min))) return "";
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(Number(min))));
  return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60);
}

/** "07:30:00" (the database) -> "07:30" (the form); "" when empty or not a time. */
export function hm(t) {
  const m = minutesOf(t);
  return m === null ? "" : hmOf(m);
}

/** "07:30" (the form) -> "07:30:00" (the database's time); null when empty. */
export function dbTime(v) {
  const m = minutesOf(v);
  return m === null ? null : hmOf(m) + ":00";
}

/** "07:30:00" -> "7:30 AM". */
export function clock12(t) {
  const m = minutesOf(t);
  if (m === null) return "";
  const h = Math.floor(m / 60) % 24, mi = m % 60;
  return (h % 12 || 12) + ":" + pad2(mi) + " " + (h >= 12 ? "PM" : "AM");
}

/** A number for the screen: 8 -> "8", 7.5 -> "7.5", 10.25 -> "10.25". */
export function hoursText(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return String(v);
}

/** Round to the pages' half-hour steps, within 0..24. */
export function stepHours(current, delta) {
  const n = Math.round(((Number(current) || 0) + (Number(delta) || 0)) * 2) / 2;
  return Math.max(0, Math.min(24, n));
}

/** A typed hours value -> a number 0..24 (or null when it is not a number). */
export function cleanHours(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^0-9.]/g, "");
  if (s === "" || s === ".") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(24, Math.round(n * 100) / 100));
}

/* ── the work schedule (auto-fill and the Entered-vs-Calculated bar) ──── */

/** A roster row's normal hours -> {start1, end1, start2, end2: "HH:MM", lunch: number}; null when
    the roster has no morning start (the schedule section then stays hidden, as in the old pages). */
export function scheduleDefaults(emp) {
  if (!emp) return null;
  const s1 = hm(emp.normal_start1 !== undefined ? emp.normal_start1 : emp.start1);
  if (!s1) return null;
  const lunchRaw = emp.normal_lunch_hours !== undefined ? emp.normal_lunch_hours : emp.lunch;
  const lunch = lunchRaw === null || lunchRaw === undefined || lunchRaw === "" ? 1 : Number(lunchRaw);
  return {
    start1: s1,
    end1: hm(emp.normal_end1 !== undefined ? emp.normal_end1 : emp.end1),
    start2: hm(emp.normal_start2 !== undefined ? emp.normal_start2 : emp.start2),
    end2: hm(emp.normal_end2 !== undefined ? emp.normal_end2 : emp.end2),
    lunch: Number.isFinite(lunch) ? lunch : 1,
  };
}

/** The old pages' auto-fill: `hours` laid over the normal schedule. Up to the morning's length,
    the morning alone (no lunch); beyond it the whole morning, lunch, and the rest after the
    afternoon start. -> {start1, end1, lunch, start2, end2} or null (no defaults, no hours). */
export function autoSchedule(def, hours) {
  const h = Number(hours) || 0;
  if (!def || !def.start1 || h <= 0) return null;
  const s1 = minutesOf(def.start1), e1 = minutesOf(def.end1), s2 = minutesOf(def.start2);
  const total = Math.round(h * 60);
  const cap = e1 !== null && e1 > s1 ? e1 - s1 : null;
  if (cap === null || total <= cap || s2 === null) {
    return { start1: hmOf(s1), end1: hmOf(s1 + total), lunch: 0, start2: "", end2: "" };
  }
  return { start1: hmOf(s1), end1: hmOf(e1), lunch: Number(def.lunch) || 0, start2: hmOf(s2), end2: hmOf(s2 + (total - cap)) };
}

/** Hours worked by the clock: (end1 - start1) + (end2 - start2); a session missing an end counts 0. */
export function calcHours(start1, end1, start2, end2) {
  let mins = 0;
  const a = minutesOf(start1), b = minutesOf(end1), c = minutesOf(start2), d = minutesOf(end2);
  if (a !== null && b !== null && b > a) mins += b - a;
  if (c !== null && d !== null && d > c) mins += d - c;
  return Math.round(mins / 60 * 100) / 100;
}

/** The Entered-vs-Calculated bar: null when nothing was entered. */
export function calcBar(entered, calculated) {
  const e = Number(entered) || 0, c = Number(calculated) || 0;
  if (e <= 0) return null;
  const diff = Math.round((c - e) * 100) / 100;
  return { entered: e, calculated: c, match: Math.abs(diff) < 0.01, diff: diff,
    diffText: (diff > 0 ? "+" : "") + diff.toFixed(1) + "h" };
}

/** "12:00 PM – 1:00 PM" after the morning, "No lunch", or "". */
export function lunchRange(end1, lunch) {
  const e = minutesOf(end1), l = Number(lunch) || 0;
  if (e === null) return l > 0 ? "" : "No lunch";
  if (l <= 0) return "No lunch";
  return clock12(hmOf(e)) + " – " + clock12(hmOf(e + Math.round(l * 60)));
}

/** The visual timeline's blocks: [{kind: "work"|"lunch", pct, label}], from/to labels; null. */
export function timeline(start1, end1, lunch, start2, end2) {
  const s1 = minutesOf(start1), e1 = minutesOf(end1), s2 = minutesOf(start2), e2 = minutesOf(end2);
  if (s1 === null || e1 === null || e1 <= s1) return null;
  const lm = Math.round((Number(lunch) || 0) * 60);
  const second = s2 !== null && e2 !== null && e2 > s2;
  const endAt = second ? e2 : (lm > 0 ? e1 + lm : e1);
  const span = endAt - s1;
  if (span <= 0) return null;
  const blocks = [{ kind: "work", pct: Math.round((e1 - s1) / span * 1000) / 10, label: hoursText((e1 - s1) / 60) + "h" }];
  if (lm > 0) blocks.push({ kind: "lunch", pct: Math.round(lm / span * 1000) / 10, label: hoursText(lm / 60) + "h" });
  if (second) blocks.push({ kind: "work", pct: Math.round((e2 - s2) / span * 1000) / 10, label: hoursText((e2 - s2) / 60) + "h" });
  return { blocks: blocks, from: clock12(hmOf(s1)), to: clock12(hmOf(second ? e2 : e1)) };
}

/* ── rows <-> entries ──────────────────────────────────────────────────── */

function one(v) { return Array.isArray(v) ? (v[0] || null) : (v && typeof v === "object" ? v : null); }
function nz(v) { return v === undefined ? null : v; }
function num(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

/** "1234 Juniper Ln" (the street) — how a foreman recognises the job on a phone. */
export function shortAddress(address) {
  const s = String(address == null ? "" : address).trim();
  if (!s) return "";
  return s.split(/\s*[,\n]\s*/)[0];
}

/** "A267 — Sandbox Residence" for a project shape ({number, name}). */
export function projectText(p) {
  if (!p) return "";
  const n = p.number || p.internalIDNumber || "", nm = p.name || p.projectName || "";
  return n && nm ? n + " — " + nm : (n || nm);
}

/** A timesheets row (with the embeds employee:employees(...) and project:projects(...)) -> the
    entry the pages draw. */
export function toEntry(row) {
  if (!row) return null;
  const emp = one(row.employee) || one(row.employees);
  const prj = one(row.project) || one(row.projects);
  const kind = isKind(row.kind) ? row.kind : "work";
  const leave = kind !== "work";
  const legacy = row.legacy_project_text ? String(row.legacy_project_text) : "";
  const projectLabel = leave ? kindWord(kind) : prj ? projectText(prj) : legacy;
  const street = prj ? shortAddress(prj.address) : "";
  return {
    id: row.id,
    version: row.version == null ? 1 : Number(row.version),
    employeeId: row.employee_id,
    employeeName: emp ? String(emp.full_name || "").trim() : "",
    employeeNo: emp ? nz(emp.employee_no) : null,
    date: row.work_date ? String(row.work_date).slice(0, 10) : "",
    kind: kind,
    leave: leave,
    dayType: kindWord(kind),
    projectId: row.project_id == null ? null : row.project_id,
    projectNumber: prj ? prj.number || "" : "",
    projectName: prj ? prj.name || "" : "",
    projectAddress: prj ? nz(prj.address) : null,
    projectCity: prj ? nz(prj.city) : null,
    projectLabel: projectLabel || (leave ? kindWord(kind) : "No project"),
    legacyProject: legacy,
    // the calendar's second line: the job's street (the phone page), the leave word, or the old text
    place: leave ? kindWord(kind) : (street || (prj ? projectText(prj) : legacy) || "—"),
    hours: num(row.hours) || 0,
    work: row.work_completed ? String(row.work_completed) : "",
    start1: hm(row.start1), end1: hm(row.end1), start2: hm(row.start2), end2: hm(row.end2),
    lunch: num(row.lunch_hours),
    calculated: num(row.calculated_hours),
    notes: row.notes ? String(row.notes) : "",
    source: row.source || "",
    createdBy: nz(row.created_by),
    updatedAt: nz(row.updated_at),
  };
}

/** "7:00 AM–11:00 AM · lunch 1h · 12:00 PM–4:00 PM" (the View sheet, Team Sheets and the time card). */
export function scheduleText(e, opts) {
  if (!e || e.leave || !e.start1) return "";
  const o = opts || {};
  const sep = o.sep || "–";
  let s = clock12(e.start1) + (e.end1 ? sep + clock12(e.end1) : "");
  if (Number(e.lunch) > 0) s += " · lunch " + hoursText(e.lunch) + "h";
  if (e.start2) s += " · " + clock12(e.start2) + (e.end2 ? sep + clock12(e.end2) : "");
  return s;
}

/** Where a row came from, for people ("a text message (DCR Agents)"). */
export function sourceWord(s) {
  return { desktop: "DCR Desktop 2", agents_sms: "a text message (DCR Agents)", agents_email: "an e-mail (DCR Agents)",
    agents_whatsapp: "WhatsApp (DCR Agents)", agents_app: "the DCR app (DCR Agents)", import: "the old portal", portal: "Portal 2" }[s] || String(s || "");
}

/** What the four entry pages say when the project box holds text no project matches (one sentence,
    the same everywhere; no example number: the old portal's sandbox is not in this database). */
export const PICK_PROJECT = "Pick the project from the list: type its number or part of its name and choose it.";

/** Why the database would refuse this entry (a sentence), or "" — the M2 checks, said first. */
export function problem(f) {
  if (!f) return "Nothing to save.";
  if (f.employeeId === null || f.employeeId === undefined || f.employeeId === "") return "Choose an employee.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.date || ""))) return "Choose a date.";
  const kind = f.kind || "work";
  if (!isKind(kind)) return "Choose a day type.";
  const h = Number(f.hours);
  if (f.hours === null || f.hours === undefined || f.hours === "" || !Number.isFinite(h) || h < 0 || h > 24) {
    return "Hours must be between 0 and 24.";
  }
  if (kind === "work") {
    if ((f.projectId === null || f.projectId === undefined || f.projectId === "") && !f.legacyProject) return "Choose a project from the list.";
    if (!(h > 0)) return "Set the hours above 0.";
  }
  if (String(f.work || "").length > 2000) return "The work description is too long (2,000 characters at most).";
  return "";
}

/** A form (the pages' fields) -> the timesheets columns to write. A leave day carries no project
    and no clock times; an unmatched imported job keeps its old text while the project is not
    changed. source is "portal" for a new row and left alone on an edit. */
export function toRow(f, isNew) {
  const kind = isKind(f.kind) ? f.kind : "work";
  const leave = kind !== "work";
  const row = {
    employee_id: f.employeeId === null || f.employeeId === undefined ? null : Number(f.employeeId),
    work_date: String(f.date || "").slice(0, 10),
    kind: kind,
    project_id: leave || f.projectId === null || f.projectId === undefined || f.projectId === "" ? null : Number(f.projectId),
    hours: Math.round((Number(f.hours) || 0) * 100) / 100,
    work_completed: String(f.work || "").trim() || null,
    start1: leave ? null : dbTime(f.start1),
    end1: leave ? null : dbTime(f.end1),
    start2: leave ? null : dbTime(f.start2),
    end2: leave ? null : dbTime(f.end2),
    lunch_hours: leave ? null : (f.lunch === null || f.lunch === undefined || f.lunch === "" ? null : Math.round(Number(f.lunch) * 100) / 100),
    calculated_hours: null,
  };
  if (!leave && row.start1) row.calculated_hours = calcHours(f.start1, f.end1, f.start2, f.end2);
  if (!leave && row.project_id === null && f.legacyProject) row.legacy_project_text = String(f.legacyProject);
  else if (leave || row.project_id !== null) row.legacy_project_text = null;
  if (isNew) row.source = "portal";
  return row;
}

/** The changed columns only (an edit sends what moved; the version decides the rest). */
export function diffRow(before, after) {
  const out = {};
  Object.keys(after).forEach(function (k) {
    if (k === "source") return;
    const a = before ? before[k] : undefined;
    const b = after[k];
    const same = (a === null || a === undefined ? null : String(a)) === (b === null || b === undefined ? null : String(b));
    if (!same) out[k] = b;
  });
  return out;
}

/** An entry -> the columns as the database holds them now (for diffRow). */
export function rowOf(e) {
  return toRow({ employeeId: e.employeeId, date: e.date, kind: e.kind, projectId: e.projectId, legacyProject: e.legacyProject,
    hours: e.hours, work: e.work, start1: e.start1, end1: e.end1, start2: e.start2, end2: e.end2, lunch: e.lunch }, false);
}

/* ── the project picker ────────────────────────────────────────────────── */

// Active statuses first (BLUEPRINT 3.3.6: "a projects query, active statuses first").
const ACTIVE_ORDER = { in_progress: 0, approved: 1, on_hold: 2, sent: 3, estimating: 4, new_request: 5, follow_up: 6, completed: 7, closed: 8 };

/** Mapped projects -> the picker's options, active jobs first, newest number first inside a group:
    [{id, value: "A267 — Sandbox · 1 Test Way", number, active}]. */
export function pickerOptions(projects) {
  return (projects || []).filter(function (p) { return p && !p.deletedAt; }).map(function (p) {
    const status = p.status || "";
    const addr = [p.projectAddress, p.projectCity].filter(Boolean).join(", ");
    return {
      id: p.id, number: p.internalIDNumber || "", status: status,
      active: ["in_progress", "approved", "on_hold", "sent", "estimating", "new_request"].indexOf(status) !== -1,
      rank: ACTIVE_ORDER[status] === undefined ? 9 : ACTIVE_ORDER[status],
      value: projectText(p) + (addr ? " · " + addr : ""),
    };
  }).sort(function (a, b) {
    const ga = a.active ? 0 : 1, gb = b.active ? 0 : 1;
    if (ga !== gb) return ga - gb;
    return String(b.number).localeCompare(String(a.number), "en", { numeric: true });
  });
}

const NUMBER_AT_START = /^\s*([A-Za-z][0-9]{3,}(?:-[A-Za-z]{1,2}|[Tt][0-9])?)\b/;

/** What was typed or picked in the project box -> the project's id, or null. An exact option; else
    the number at the start ("A267 — …", "a267"); else the only option holding the text. */
export function resolveProject(text, options) {
  const t = String(text == null ? "" : text).trim();
  if (!t) return null;
  const list = options || [];
  const exact = list.find(function (o) { return o.value === t; });
  if (exact) return exact.id;
  const m = NUMBER_AT_START.exec(t);
  if (m) {
    const n = m[1].toUpperCase();
    const hit = list.find(function (o) { return String(o.number).toUpperCase() === n; });
    if (hit) return hit.id;
  }
  // otherwise the one option that holds the text (a name or an address typed instead of picked)
  const low = t.toLowerCase();
  const hits = list.filter(function (o) { return o.value.toLowerCase().indexOf(low) !== -1; });
  return hits.length === 1 ? hits[0].id : null;
}

/* ── weeks and the two-week calendar ───────────────────────────────────── */

export const DAY_NAMES = Object.freeze(["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function weekDays(saturday) {
  const out = [];
  for (let i = 0; i < 7; i++) out.push(addDays(saturday, i));
  return out;
}

/** "Oct 17" */
export function shortDay(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  return m ? MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) : "";
}

/** "Oct 17–23" / "Oct 31–Nov 6" */
export function shortRange(a, b) {
  const x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a), y = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b);
  if (!x || !y) return "";
  const mx = MONTHS[Number(x[2]) - 1], my = MONTHS[Number(y[2]) - 1];
  return mx + " " + Number(x[3]) + "–" + (mx === my ? "" : my + " ") + Number(y[3]);
}

/** "Sat, Oct 17" */
export function niceDay(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!m) return "";
  return DAY_NAMES[(dayOfWeek(key) + 1) % 7] + ", " + MONTHS[Number(m[2]) - 1] + " " + Number(m[3]);
}

/** The window the calendar draws: last week's Saturday to this week's Friday (company days). */
export function calendarBounds(today) {
  const sat = saturdayOfYmd(today);
  return { from: addDays(sat, -7), to: addDays(sat, 6) };
}

/** Entries in, the two weeks out (last week, this week; Saturday first). Several entries on one day
    are stacked, each with its own hours and place (the address is the point on a phone).
    opts.employeeId: only that employee's entries. */
export function twoWeeks(entries, today, opts) {
  const o = opts || {};
  const sat = saturdayOfYmd(today);
  const byDay = {};
  (entries || []).forEach(function (e) {
    if (o.employeeId != null && String(e.employeeId) !== String(o.employeeId)) return;
    (byDay[e.date] = byDay[e.date] || []).push(e);
  });
  return [{ label: "Last week", start: addDays(sat, -7) }, { label: "This week", start: sat }].map(function (w) {
    let total = 0;
    const days = weekDays(w.start).map(function (key, i) {
      let hours = 0;
      const list = (byDay[key] || []).slice().sort(function (a, b) { return Number(a.id) - Number(b.id); }).map(function (e) {
        hours += Number(e.hours) || 0;
        return { id: e.id, hours: Number(e.hours) || 0, leave: !!e.leave, text: e.place, project: e.projectLabel, employee: e.employeeName };
      });
      total += hours;
      return { key: key, dow: DAY_NAMES[i], dayNum: Number(key.slice(8, 10)), month: MONTHS[Number(key.slice(5, 7)) - 1],
        isToday: key === today, isWeekend: i < 2, hours: Math.round(hours * 100) / 100, entries: list };
    });
    const end = addDays(w.start, 6);
    return { label: w.label, from: w.start, to: end, range: shortRange(w.start, end), total: Math.round(total * 100) / 100, days: days };
  });
}

/* ── Team Sheets ───────────────────────────────────────────────────────── */

/** The grid of one week: every roster employee (and anyone with hours that week), the hours per
    day, the entries, the total. opts: {project: "<projectId>"|"legacy:<text>"|"kind:<kind>",
    search: text}. Sorted by name; sortByOrder() applies a saved order. */
export function weekGrid(entries, roster, saturday, opts) {
  const o = opts || {};
  const days = weekDays(saturday);
  const inWeek = {};
  days.forEach(function (d) { inWeek[d] = true; });
  const map = {};
  function row(id, name, no) {
    const k = String(id);
    if (!map[k]) map[k] = { id: id, name: name || "Unknown", no: no == null ? "" : String(no), days: {}, entries: [], total: 0 };
    return map[k];
  }
  (entries || []).forEach(function (e) {
    if (!inWeek[e.date]) return;
    if (o.project && projectKey(e) !== o.project) return;
    const r = row(e.employeeId, e.employeeName, e.employeeNo);
    const h = Number(e.hours) || 0;
    r.days[e.date] = Math.round(((r.days[e.date] || 0) + h) * 100) / 100;
    r.total = Math.round((r.total + h) * 100) / 100;
    r.entries.push(e);
  });
  (roster || []).forEach(function (emp) {
    if (emp && emp.id != null && emp.active !== false) row(emp.id, emp.full_name || emp.name, emp.employee_no);
  });
  let list = Object.keys(map).map(function (k) { return map[k]; });
  const q = String(o.search || "").trim().toLowerCase();
  if (q) list = list.filter(function (r) { return r.name.toLowerCase().indexOf(q) !== -1 || String(r.no).toLowerCase() === q; });
  list.sort(function (a, b) { return a.name.localeCompare(b.name); });
  const dayTotals = days.map(function (d) {
    return Math.round(list.reduce(function (s, r) { return s + (r.days[d] || 0); }, 0) * 100) / 100;
  });
  const grand = Math.round(dayTotals.reduce(function (s, v) { return s + v; }, 0) * 100) / 100;
  return { days: days, employees: list, dayTotals: dayTotals, grand: grand };
}

/** The filter key of an entry's job: the project id, "legacy:<text>" or "kind:<kind>". */
export function projectKey(e) {
  if (e.leave) return "kind:" + e.kind;
  if (e.projectId !== null && e.projectId !== undefined) return String(e.projectId);
  return "legacy:" + String(e.legacyProject || "").toLowerCase();
}

/** A saved order (employee ids) applied: saved ones first in that order, the rest by name. */
export function sortByOrder(rows, saved) {
  if (!saved || !saved.length) return rows.slice();
  const at = {};
  saved.forEach(function (id, i) { at[String(id)] = i; });
  const a = [], b = [];
  rows.forEach(function (r) { if (Object.prototype.hasOwnProperty.call(at, String(r.id))) a.push(r); else b.push(r); });
  a.sort(function (x, y) { return at[String(x.id)] - at[String(y.id)]; });
  return a.concat(b);
}

/** A day cell's class: more than 8 hours -> overtime; weekend hours; hours; none. */
export function cellClass(hours, weekend) {
  const h = Number(hours) || 0;
  if (h > 8) return "overtime";
  if (h > 0 && weekend) return "weekend-hrs";
  if (h > 0) return "has-hours";
  return "zero";
}

/** A week total's class against 40: over (more than 40), good (39.5 to 40), low (under), "". */
export function totalClass(total) {
  const t = Number(total) || 0;
  if (t > 40) return "over";
  if (t >= 39.5) return "good";
  if (t > 0) return "low";
  return "";
}

/** The stat cards of the week. */
export function weekStats(grid, weeks) {
  const emps = grid.employees;
  let entries = 0, reporting = 0;
  const jobs = {};
  emps.forEach(function (r) {
    entries += r.entries.length;
    if (r.total > 0) reporting++;
    r.entries.forEach(function (e) { if (!e.leave) jobs[projectKey(e)] = 1; });
  });
  const withHours = emps.filter(function (r) { return r.total > 0; });
  let confirmed = 0, stale = 0;
  withHours.forEach(function (r) {
    const w = weeks && weeks[String(r.id)];
    if (w && w.confirmed) confirmed++;
    else if (w && w.staleCount) stale++;
  });
  return { hours: grid.grand, employees: emps.length, reporting: reporting, entries: entries, projects: Object.keys(jobs).length,
    withHours: withHours.length, confirmed: confirmed, stale: stale };
}

/* ── CSV (with the formula-injection guard) ────────────────────────────── */

/** One cell: text a spreadsheet would run as a formula (= + - @, tab, return) is kept as text with
    a leading apostrophe; numbers stay numbers; quotes are doubled. */
export function csvCell(v) {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  let s = String(v === null || v === undefined ? "" : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function csvText(rows) {
  return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
}

/** The Team Sheets export: Employee, Employee no., the seven days, Total. */
export function weekCsv(grid) {
  const head = ["Employee", "Employee no."].concat(grid.days.map(function (d, i) { return DAY_NAMES[i] + " " + shortDay(d); }), ["Total"]);
  const rows = [head];
  grid.employees.forEach(function (r) {
    rows.push([r.name, r.no].concat(grid.days.map(function (d) { return r.days[d] || 0; }), [r.total]));
  });
  rows.push(["All employees", ""].concat(grid.dayTotals, [grid.grand]));
  return csvText(rows);
}

/* ── sign-off (rpc timesheet_weeks) ───────────────────────────────────── */

/** "#2fa679" only (the colour goes into a style attribute); anything else -> a neutral grey. */
export function safeColor(c) {
  return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim() : "#6b7a8c";
}

/** Initials for a tick ("Riley Lead" -> "RL"); never blank. */
export function initials(name, fallback) {
  const n = String(name || "").trim();
  if (n) {
    const p = n.split(/\s+/);
    return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : n.slice(0, 2)).toUpperCase();
  }
  const f = String(fallback || "").trim();
  return f ? f.slice(0, 2).toUpperCase() : "?";
}

const given = function (v) { return v === undefined || v === null ? null : v; };

/* One signature of timesheet_weeks' marks, by M2's own names (no guessing: schema-check runs this
   against the real migration, so a renamed key fails there instead of drawing a blank tick). */
function markOf(m) {
  const name = String(given(m.name) || "");
  return {
    id: given(m.id),
    by: given(m.confirmed_by),
    name: name,
    role: String(given(m.role) || ""),
    initials: initials(name),
    color: safeColor(m.color),
    at: given(m.confirmed_at),
    hoursAtConfirm: num(m.hours_at_confirm),
    stale: m.stale === true,                      // the database compares the fingerprints
    mine: m.mine === true,
    canWithdraw: m.can_withdraw === true,         // one's own, or any as an admin
  };
}

/** rpc timesheet_weeks rows (M2: employee_id, employee_name, week_start, week_end, fingerprint,
    hours, entries, confirmed, live_count, stale_count, marks [{id, confirmed_by, name, role, color,
    confirmed_at, hours_at_confirm, stale, mine, can_withdraw}]) -> {"<employee_id>|<week_start>": week}
    with week = {employeeId, employeeName, weekStart, hours, entries, fingerprint, marks: [{id, by,
    name, role, initials, color, at, hoursAtConfirm, stale, mine, canWithdraw}], count, liveCount,
    staleCount, confirmed}. */
export function toWeeks(rows) {
  const out = {};
  (rows || []).forEach(function (r) {
    if (!r) return;
    const emp = given(r.employee_id);
    const wk = String(given(r.week_start) || "").slice(0, 10);
    if (emp === null || !wk) return;
    const key = String(emp) + "|" + wk;
    const w = out[key] || (out[key] = { employeeId: emp, employeeName: "", weekStart: wk, hours: null, entries: null, fingerprint: null, marks: [] });
    const h = num(r.hours);
    if (h !== null) w.hours = h;
    const n = num(r.entries);
    if (n !== null) w.entries = n;
    if (given(r.employee_name)) w.employeeName = String(r.employee_name);
    if (given(r.fingerprint)) w.fingerprint = String(r.fingerprint);
    (Array.isArray(r.marks) ? r.marks : []).forEach(function (m) { if (m) w.marks.push(markOf(m)); });
  });
  Object.keys(out).forEach(function (k) {
    const w = out[k];
    w.marks.sort(function (a, b) { return String(a.at || "").localeCompare(String(b.at || "")); });
    w.count = w.marks.length;
    w.liveCount = w.marks.filter(function (m) { return !m.stale; }).length;
    w.staleCount = w.count - w.liveCount;
    w.confirmed = w.liveCount > 0;
  });
  return out;
}

/** The weeks of one Saturday, by employee id. */
export function weeksOf(all, saturday) {
  const out = {};
  Object.keys(all || {}).forEach(function (k) {
    const w = all[k];
    if (w.weekStart === saturday) out[String(w.employeeId)] = w;
  });
  return out;
}

/* ── the week fingerprint (of the rows on screen; the database compares) ─ */

/** md5 of a string's UTF-8 bytes, as hex (RFC 1321). */
export function md5(str) {
  const bytes = utf8(String(str));
  const n = bytes.length;
  const words = new Array(((n + 8) >>> 6 << 4) + 16).fill(0);
  for (let i = 0; i < n; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  words[n >> 2] |= 0x80 << ((n % 4) * 8);
  words[words.length - 2] = (n * 8) >>> 0;
  words[words.length - 1] = Math.floor(n / 0x20000000) >>> 0;
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  for (let i = 0; i < words.length; i += 16) {
    const aa = a, bb = b, cc = c, dd = d;
    for (let j = 0; j < 64; j++) {
      let f, g;
      if (j < 16) { f = (b & c) | (~b & d); g = j; }
      else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
      else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * j) % 16; }
      const tmp = d;
      d = c;
      c = b;
      const x = (a + f + K[j] + words[i + g]) | 0;
      b = (b + ((x << S[j]) | (x >>> (32 - S[j])))) | 0;
      a = tmp;
    }
    a = (a + aa) | 0; b = (b + bb) | 0; c = (c + cc) | 0; d = (d + dd) | 0;
  }
  return [a, b, c, d].map(function (v) {
    let s = "";
    for (let i = 0; i < 4; i++) s += ((v >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
    return s;
  }).join("");
}
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = (function () {
  const k = [];
  for (let i = 0; i < 64; i++) k.push((Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0);
  return k;
})();
function utf8(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** The text of one row in the fingerprint (app.timesheet_week_state, M2):
    "id|YYYY-MM-DD|hours with 2 decimals|project id — or the kind when there is no project". */
export function fingerprintLine(e) {
  const h = Number(e.hours) || 0;
  const p = e.projectId === null || e.projectId === undefined ? String(e.kind || "work") : String(e.projectId);
  return String(e.id) + "|" + e.date + "|" + h.toFixed(2) + "|" + p;
}

/** md5 over the employee-week's rows ordered by id, joined by a line feed, plus "-<count>"
    (no rows: md5("") + "-0") — what the database computes (app.timesheet_week_state; schema-check
    holds the two together), here over the rows a screen shows. */
export function fingerprint(entries) {
  const list = (entries || []).slice().sort(function (a, b) { return Number(a.id) - Number(b.id); });
  return md5(list.map(fingerprintLine).join("\n")) + "-" + list.length;
}

/** The fingerprint of what a screen shows of one employee's Saturday-to-Friday week: their entries
    dated in that week, whatever else the list holds. A confirmation sends THIS (never the value
    timesheet_weeks handed back), so the database answers 409 whenever the screen is behind. */
export function weekFingerprint(entries, employeeId, saturday) {
  const fri = addDays(saturday, 6);
  return fingerprint((entries || []).filter(function (e) {
    return e && String(e.employeeId) === String(employeeId) && e.date >= saturday && e.date <= fri;
  }));
}

/** The employees whose week, as the database fingerprinted it (timesheet_weeks), differs from the
    rows on screen — a change whose live event never arrived, or one that landed between the two
    reads. -> [employee id as text]. */
export function screenBehind(weeks, entries, saturday) {
  return Object.keys(weeks || {}).filter(function (k) {
    const w = weeks[k];
    return w && w.fingerprint && w.fingerprint !== weekFingerprint(entries, k, saturday);
  });
}

/* ── people who have left (employees.active = false) ───────────────────── */

/** "Finley Coyote (left)" for a turned-off employee, the plain name otherwise. */
export function personLabel(r) {
  if (!r) return "";
  const n = String(r.full_name || r.name || "").trim();
  return r.active === false ? n + " (left)" : n;
}

/** The people a page offers for reading or correcting history: the active list as it is, then each
    extra row (turned-off employees in scope, the employees found in the loaded entries) whose id is
    not there yet, by name. Rows: {id, full_name, employee_no?, active?}; an entry-only person
    ({employeeId, employeeName, employeeNo}) is taken as {id, full_name, employee_no, active: false}. */
export function withFormer(active, extra) {
  const out = (active || []).slice();
  const seen = {};
  out.forEach(function (r) { if (r && r.id != null) seen[String(r.id)] = true; });
  const more = [];
  (extra || []).forEach(function (x) {
    if (!x) return;
    const r = x.employeeId !== undefined                          // an entry (toEntry), not an employees row
      ? { id: x.employeeId, full_name: x.employeeName || "", employee_no: x.employeeNo || null, active: false }
      : x;
    if (r.id == null || seen[String(r.id)]) return;
    seen[String(r.id)] = true;
    more.push(r);
  });
  more.sort(function (a, b) { return String(a.full_name || "").localeCompare(String(b.full_name || "")); });
  return out.concat(more);
}

/* ── the PDF (one page per day and job) ───────────────────────────────── */

/** Entries of ONE employee -> the sheets of a day or of its Saturday-to-Friday week:
    [{dateKey, job, rows: [entry]}], by date then job. */
export function pdfSheets(entries, mode, anchor) {
  const days = mode === "week" ? weekDays(saturdayOfYmd(anchor)) : [anchor];
  const groups = {}, order = [];
  (entries || []).forEach(function (e) {
    if (days.indexOf(e.date) === -1) return;
    const job = e.leave ? e.dayType : (e.projectLabel || "");
    const k = e.date + "||" + job;
    if (!groups[k]) { groups[k] = { dateKey: e.date, job: job, rows: [] }; order.push(k); }
    groups[k].rows.push(e);
  });
  order.sort();
  return order.map(function (k) { return groups[k]; });
}

/** "Timesheet-Riley-Lead-2026-10-19.pdf" / "Timesheet-Riley-Lead-Week-2026-10-17.pdf" */
export function pdfFileName(name, mode, anchor) {
  const who = String(name || "").trim().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "") || "employee";
  return "Timesheet-" + who + "-" + (mode === "week" ? "Week-" + saturdayOfYmd(anchor) : anchor) + ".pdf";
}

/** "Monday, October 19, 2026" for "YYYY-MM-DD" (calendar arithmetic, no time zone). */
export function longDate(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!m) return String(key || "");
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const full = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return names[dayOfWeek(key)] + ", " + full[Number(m[2]) - 1] + " " + Number(m[3]) + ", " + m[1];
}

/** The table body of one sheet: [name, start, end, hours] rows padded to 10, the work text, the total. */
export function pdfBody(sheet) {
  const body = [];
  let total = 0;
  const work = [];
  sheet.rows.forEach(function (e) {
    total += Number(e.hours) || 0;
    body.push([e.employeeName || "", e.start1 ? clock12(e.start1) : "", (e.end2 || e.end1) ? clock12(e.end2 || e.end1) : "",
      Number(e.hours) ? hoursText(e.hours) : ""]);
    if (e.work) work.push((sheet.rows.length > 1 ? e.employeeName + ": " : "") + e.work);
  });
  while (body.length < 10) body.push(["", "", "", ""]);
  return { body: body, total: Math.round(total * 100) / 100, workText: longDate(sheet.dateKey) + (work.length ? "\n" + work.join("\n") : "") };
}
