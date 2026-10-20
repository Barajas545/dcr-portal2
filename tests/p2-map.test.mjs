// P2 (timesheets): the pure module site/js/map/timesheets.js — kinds, clock times, the schedule
// auto-fill and the Entered-vs-Calculated bar, rows <-> entries, the project picker, the two-week
// calendar, the Team Sheets grid, the CSV guard, the sign-off marks of timesheet_weeks and the week
// fingerprint (the database's own formula, M2 app.timesheet_week_state), the PDF grouping.
// Made-up people only.
import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../site/js/map/timesheets.js";
import { saturdayOf } from "../site/js/common2.js";

test("kinds: the old words and back; leave days", () => {
  assert.deepEqual(m.KINDS, ["work", "holiday", "vacation", "sick", "day_off"]);
  assert.equal(m.kindOf("Day Off"), "day_off");
  assert.equal(m.kindOf("Vac."), "vacation");
  assert.equal(m.kindOf("Sick day"), "sick");
  assert.equal(m.kindOf("Worked"), "work");
  assert.equal(m.kindOf("anything"), "work");
  assert.equal(m.kindWord("day_off"), "Day Off");
  assert.equal(m.isLeave("holiday"), true);
  assert.equal(m.isLeave("work"), false);
  assert.equal(m.isLeave("nonsense"), false);
});

test("clock times are plain times: database <-> form <-> people", () => {
  assert.equal(m.hm("07:30:00"), "07:30");
  assert.equal(m.hm("7:30 PM"), "19:30");
  assert.equal(m.hm(""), "");
  assert.equal(m.hm("25:00"), "");
  assert.equal(m.dbTime("07:30"), "07:30:00");
  assert.equal(m.dbTime(""), null);
  assert.equal(m.clock12("13:05:00"), "1:05 PM");
  assert.equal(m.clock12("00:00"), "12:00 AM");
  assert.equal(m.clock12("12:00"), "12:00 PM");
  assert.equal(m.hoursText(7.5), "7.5");
  assert.equal(m.hoursText(10.25), "10.25");
  assert.equal(m.stepHours(7.75, 0.5), 8.5, "back onto the half-hour steps");
  assert.equal(m.stepHours(0, -0.5), 0);
  assert.equal(m.stepHours(23.5, 1), 24);
  assert.equal(m.cleanHours("8,5h"), 24, "digits and the point only, as the old field did (85 -> clamped)");
  assert.equal(m.cleanHours("7.5 h"), 7.5);
  assert.equal(m.cleanHours("30"), 24);
  assert.equal(m.cleanHours(""), null);
});

test("the schedule auto-fill (the old pages' rule) and the Entered-vs-Calculated bar", () => {
  const def = m.scheduleDefaults({ normal_start1: "07:00:00", normal_end1: "11:00:00", normal_start2: "12:00:00", normal_end2: "15:30:00", normal_lunch_hours: "1.00" });
  assert.deepEqual(def, { start1: "07:00", end1: "11:00", start2: "12:00", end2: "15:30", lunch: 1 });
  assert.deepEqual(m.autoSchedule(def, 3), { start1: "07:00", end1: "10:00", lunch: 0, start2: "", end2: "" }, "within the morning: no lunch");
  assert.deepEqual(m.autoSchedule(def, 9), { start1: "07:00", end1: "11:00", lunch: 1, start2: "12:00", end2: "17:00" });
  assert.equal(m.autoSchedule(def, 0), null);
  assert.equal(m.autoSchedule(m.scheduleDefaults({ normal_start1: null }), 8), null, "no normal hours: no schedule");
  assert.deepEqual(m.autoSchedule(m.scheduleDefaults({ normal_start1: "06:00" }), 10), { start1: "06:00", end1: "16:00", lunch: 0, start2: "", end2: "" });
  assert.equal(m.autoSchedule(def, 20).end2, "23:59", "clamped to the day");
  assert.equal(m.calcHours("07:00", "11:00", "12:00", "16:30"), 8.5);
  assert.equal(m.calcHours("07:00", "", "12:00", "16:00"), 4, "a session without an end counts 0");
  assert.equal(m.calcBar(0, 8), null);
  assert.deepEqual(m.calcBar(8, 8), { entered: 8, calculated: 8, match: true, diff: 0, diffText: "0.0h" });
  assert.equal(m.calcBar(8, 9).diffText, "+1.0h");
  assert.equal(m.lunchRange("11:00", 1), "11:00 AM – 12:00 PM");
  assert.equal(m.lunchRange("11:00", 0), "No lunch");
  const tl = m.timeline("07:00", "11:00", 1, "12:00", "16:00");
  assert.deepEqual(tl.blocks.map((b) => [b.kind, b.pct, b.label]), [["work", 44.4, "4h"], ["lunch", 11.1, "1h"], ["work", 44.4, "4h"]]);
  assert.deepEqual([tl.from, tl.to], ["7:00 AM", "4:00 PM"]);
});

const ROW = {
  id: 41, version: 3, employee_id: 7, work_date: "2026-10-16", kind: "work", project_id: 267, legacy_project_text: null,
  hours: "8.50", work_completed: "Framed walls", start1: "07:00:00", end1: "11:00:00", start2: "12:00:00", end2: "16:30:00",
  lunch_hours: "1.00", calculated_hours: "8.50", source: "portal",
  employee: { id: 7, full_name: "Robin Example", employee_no: "E-7" },
  project: { id: 267, number: "A267", name: "Sandbox Residence", address: "1 Test Way, Sandbox", city: "Sandbox" },
};

test("toEntry: the embeds, the job's street for the phone calendar, numbers and times for the form", () => {
  const e = m.toEntry(ROW);
  assert.equal(e.employeeName, "Robin Example");
  assert.equal(e.projectLabel, "A267 — Sandbox Residence");
  assert.equal(e.place, "1 Test Way", "the street only");
  assert.deepEqual([e.hours, e.lunch, e.calculated, e.start1, e.end2], [8.5, 1, 8.5, "07:00", "16:30"]);
  assert.equal(m.scheduleText(e), "7:00 AM–11:00 AM · lunch 1h · 12:00 PM–4:30 PM");
  const leave = m.toEntry({ id: 42, employee_id: 7, work_date: "2026-10-17", kind: "vacation", hours: "8.00" });
  assert.deepEqual([leave.leave, leave.dayType, leave.projectLabel, leave.place, leave.start1], [true, "Vacation", "Vacation", "Vacation", ""]);
  const old = m.toEntry({ id: 43, employee_id: 7, work_date: "2026-09-01", kind: "work", hours: "7.5", legacy_project_text: "Hillside barn", source: "import" });
  assert.deepEqual([old.projectId, old.projectLabel, old.legacyProject, old.place], [null, "Hillside barn", "Hillside barn", "Hillside barn"]);
  assert.equal(m.sourceWord("agents_sms"), "a text message (DCR Agents)");
});

test("toRow / problem / diffRow: the M2 rules said first; a leave day carries no project or clock; an edit sends what moved", () => {
  const f = { employeeId: "7", date: "2026-10-16", kind: "work", projectId: 267, hours: 8, work: " Framed ", start1: "07:00", end1: "11:00", start2: "12:00", end2: "16:00", lunch: 1 };
  assert.equal(m.problem(f), "");
  assert.deepEqual(m.toRow(f, true), { employee_id: 7, work_date: "2026-10-16", kind: "work", project_id: 267, hours: 8, work_completed: "Framed",
    start1: "07:00:00", end1: "11:00:00", start2: "12:00:00", end2: "16:00:00", lunch_hours: 1, calculated_hours: 8, legacy_project_text: null, source: "portal" });
  assert.equal(m.problem(Object.assign({}, f, { projectId: null })), "Choose a project from the list.");
  assert.equal(m.problem(Object.assign({}, f, { hours: 0 })), "Set the hours above 0.");
  assert.equal(m.problem(Object.assign({}, f, { hours: 25 })), "Hours must be between 0 and 24.");
  assert.equal(m.problem(Object.assign({}, f, { employeeId: null })), "Choose an employee.");
  assert.equal(m.problem(Object.assign({}, f, { work: "x".repeat(2001) })), "The work description is too long (2,000 characters at most).");
  const leave = Object.assign({}, f, { kind: "sick", projectId: 267, hours: 0 });
  assert.equal(m.problem(leave), "", "a sick day: no project, 0 hours");
  const lr = m.toRow(leave, true);
  assert.deepEqual([lr.project_id, lr.start1, lr.lunch_hours, lr.calculated_hours, lr.legacy_project_text], [null, null, null, null, null]);
  // an imported row keeps its old text until a project is picked
  const imp = m.toEntry({ id: 43, version: 1, employee_id: 7, work_date: "2026-09-01", kind: "work", hours: "7.5", legacy_project_text: "Hillside barn" });
  assert.deepEqual(m.diffRow(m.rowOf(imp), m.toRow(Object.assign({}, m.rowOf(imp), { employeeId: 7, date: "2026-09-01", kind: "work", hours: 7.5, legacyProject: "Hillside barn" }), false)), {});
  const picked = m.diffRow(m.rowOf(imp), m.toRow({ employeeId: 7, date: "2026-09-01", kind: "work", projectId: 267, hours: 7.5 }, false));
  assert.deepEqual(picked, { project_id: 267, legacy_project_text: null }, "picking the project clears the old text (the one change M2 lets a person make to it)");
  const e = m.toEntry(ROW);
  assert.deepEqual(m.diffRow(m.rowOf(e), m.toRow(Object.assign({}, { employeeId: 7, date: e.date, kind: "work", projectId: 267, hours: 9, work: e.work,
    start1: "07:00", end1: "11:00", start2: "12:00", end2: "17:00", lunch: 1 }), false)), { hours: 9, end2: "17:00:00", calculated_hours: 9 });
});

test("the project picker: active jobs first, then the rest newest first; resolved by number, exact text or a unique start", () => {
  const P = (id, number, name, status, addr) => ({ id, internalIDNumber: number, projectName: name, status, projectAddress: addr || null, projectCity: null });
  const opts = m.pickerOptions([P(1, "A100", "Old Barn", "completed"), P(2, "A267", "Sandbox Residence", "in_progress", "1 Test Way"),
    P(3, "A301", "Hill ADU", "approved"), P(4, "A024-B", "Deck", "closed"), Object.assign(P(5, "A999", "Gone", "in_progress"), { deletedAt: "x" })]);
  assert.deepEqual(opts.map((o) => o.number), ["A301", "A267", "A100", "A024-B"]);
  assert.equal(opts[1].value, "A267 — Sandbox Residence · 1 Test Way");
  assert.equal(m.resolveProject("A267 — Sandbox Residence · 1 Test Way", opts), 2);
  assert.equal(m.resolveProject("a267", opts), 2);
  assert.equal(m.resolveProject("A024-B whatever", opts), 4);
  assert.equal(m.resolveProject("hill", opts), 3, "the one option holding the text");
  assert.equal(m.resolveProject("1 test way", opts), 2, "an address");
  assert.equal(m.resolveProject("A", opts), null, "ambiguous");
  assert.equal(m.resolveProject("", opts), null);
});

test("weeks run Saturday to Friday in company time (P2 check 4): Friday 9 pm Pacific is still Friday's week", () => {
  // 2026-10-24 04:00 UTC = Friday Oct 23, 9 pm in Los Angeles (daylight time)
  assert.equal(saturdayOf(new Date("2026-10-24T04:00:00Z")), "2026-10-17");
  assert.equal(saturdayOf(new Date("2026-10-24T07:30:00Z")), "2026-10-24", "after midnight Pacific it is Saturday");
  // standard time: 2026-12-19 05:00 UTC = Friday Dec 18, 9 pm PST
  assert.equal(saturdayOf(new Date("2026-12-19T05:00:00Z")), "2026-12-12");
  assert.deepEqual(m.calendarBounds("2026-10-23"), { from: "2026-10-10", to: "2026-10-23" });
  assert.deepEqual(m.calendarBounds("2026-10-24"), { from: "2026-10-17", to: "2026-10-30" });
  assert.deepEqual(m.weekDays("2026-10-17"), ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
  assert.equal(m.shortRange("2026-10-31", "2026-11-06"), "Oct 31–Nov 6");
  assert.equal(m.niceDay("2026-10-17"), "Sat, Oct 17");
  assert.equal(m.longDate("2026-10-19"), "Monday, October 19, 2026");
});

test("the two-week calendar: Saturday first, entries stacked with their place, totals; one employee or all", () => {
  const E = (id, emp, date, hours, kind, place) => ({ id, employeeId: emp, employeeName: emp === 1 ? "Robin Example" : "Sam Sample", date, hours,
    kind: kind || "work", leave: !!kind && kind !== "work", place: place || "1 Test Way", projectLabel: "A267 — Sandbox" });
  const list = [E(1, 1, "2026-10-12", 8), E(2, 1, "2026-10-16", 4), E(3, 1, "2026-10-16", 4, "work", "9 Oak Ln"), E(4, 2, "2026-10-19", 8),
    E(5, 1, "2026-10-20", 8, "vacation", "Vacation"), E(6, 1, "2026-10-01", 8)];
  const weeks = m.twoWeeks(list, "2026-10-20", { employeeId: 1 });
  assert.deepEqual(weeks.map((w) => [w.label, w.from, w.to, w.range, w.total]), [["Last week", "2026-10-10", "2026-10-16", "Oct 10–16", 16], ["This week", "2026-10-17", "2026-10-23", "Oct 17–23", 8]]);
  assert.deepEqual(weeks[0].days.map((d) => d.dow), ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"]);
  assert.deepEqual(weeks[0].days[6].entries.map((e) => [e.hours, e.text]), [[4, "1 Test Way"], [4, "9 Oak Ln"]]);
  assert.equal(weeks[1].days[3].isToday, true);
  assert.equal(weeks[1].days[3].entries[0].leave, true);
  assert.equal(weeks[1].days[0].isWeekend, true);
  assert.equal(m.twoWeeks(list, "2026-10-20")[1].total, 16, "everyone");
});

test("Team Sheets: the week grid (roster rows without hours too), filters, saved order, the marks of over 8 h / weekend / 40", () => {
  const E = (id, emp, name, date, hours, extra) => Object.assign({ id, employeeId: emp, employeeName: name, employeeNo: "E-" + emp, date, hours, kind: "work", leave: false,
    projectId: 267, legacyProject: "" }, extra || {});
  const entries = [E(1, 1, "Robin Example", "2026-10-17", 6), E(2, 1, "Robin Example", "2026-10-19", 9), E(3, 2, "Sam Sample", "2026-10-19", 8, { projectId: 300 }),
    E(4, 2, "Sam Sample", "2026-10-20", 8, { kind: "holiday", leave: true, projectId: null }), E(5, 1, "Robin Example", "2026-10-26", 8)];
  const roster = [{ id: 1, full_name: "Robin Example", employee_no: "E-1" }, { id: 2, full_name: "Sam Sample" }, { id: 3, full_name: "Ann Absent", employee_no: "E-3" },
    { id: 4, full_name: "Left Already", active: false }];
  const g = m.weekGrid(entries, roster, "2026-10-17", {});
  assert.deepEqual(g.employees.map((r) => [r.name, r.total]), [["Ann Absent", 0], ["Robin Example", 15], ["Sam Sample", 16]]);
  assert.deepEqual(g.dayTotals, [6, 0, 17, 8, 0, 0, 0]);
  assert.equal(g.grand, 31);
  assert.deepEqual(m.weekGrid(entries, roster, "2026-10-17", { project: "300" }).employees.map((r) => [r.name, r.total]), [["Ann Absent", 0], ["Robin Example", 0], ["Sam Sample", 8]]);
  assert.deepEqual(m.weekGrid(entries, roster, "2026-10-17", { project: "kind:holiday" }).employees.find((r) => r.id === 2).total, 8);
  assert.deepEqual(m.weekGrid(entries, roster, "2026-10-17", { search: "sam" }).employees.map((r) => r.id), [2]);
  assert.deepEqual(m.sortByOrder(g.employees, ["2", "1"]).map((r) => r.id), [2, 1, 3]);
  assert.equal(m.cellClass(9, false), "overtime");
  assert.equal(m.cellClass(6, true), "weekend-hrs");
  assert.equal(m.cellClass(8, false), "has-hours");
  assert.equal(m.cellClass(0, false), "zero");
  assert.deepEqual([m.totalClass(40), m.totalClass(39.5), m.totalClass(40.5), m.totalClass(24), m.totalClass(0)], ["good", "good", "over", "low", ""],
    "exactly 40 is a full week (the old page drew it as over)");
  const weeks = { 1: { confirmed: true, staleCount: 0 }, 2: { confirmed: false, staleCount: 1 } };
  assert.deepEqual(m.weekStats(g, weeks), { hours: 31, employees: 3, reporting: 2, entries: 4, projects: 2, withHours: 2, confirmed: 1, stale: 1 });
});

test("CSV: the formula guard (= + - @ tab return kept as text), quotes doubled, numbers stay numbers", () => {
  assert.equal(m.csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(m.csvCell("+1 555"), "\"'+1 555\"");
  assert.equal(m.csvCell("-x"), "\"'-x\"");
  assert.equal(m.csvCell("@SUM(A1)"), "\"'@SUM(A1)\"");
  assert.equal(m.csvCell("\tcmd"), "\"'\tcmd\"");
  assert.equal(m.csvCell(8.5), "8.5");
  assert.equal(m.csvCell(null), "\"\"");
  const g = m.weekGrid([{ id: 1, employeeId: 1, employeeName: "=cmd|' /C calc'!A0", employeeNo: "E-1", date: "2026-10-19", hours: 8, kind: "work", leave: false, projectId: 1 }],
    [], "2026-10-17", {});
  const csv = m.weekCsv(g);
  assert.match(csv, /^"Employee","Employee no.","Sat Oct 17","Sun Oct 18","Mon Oct 19","Tue Oct 20","Wed Oct 21","Thu Oct 22","Fri Oct 23","Total"\r\n/);
  assert.ok(csv.includes("\"'=cmd|' /C calc'!A0\",\"E-1\",0,0,8,0,0,0,0,8\r\n"), csv);
  assert.ok(csv.endsWith("\"All employees\",\"\",0,0,8,0,0,0,0,8\r\n"));
});

test("md5 (RFC 1321 vectors, UTF-8) and the week fingerprint as M2 computes it", () => {
  assert.equal(m.md5(""), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(m.md5("abc"), "900150983cd24fb0d6963f7d28e17f72");
  assert.equal(m.md5("The quick brown fox jumps over the lazy dog"), "9e107d9d372bb6826bd81d3542a419d6");
  assert.equal(m.md5("é ✓ 𝄞"), "ee384700433472192f3b9d2b7525b1d0");
  assert.equal(m.md5("a".repeat(1000)), "cabe45dcc9ae5b66ba86600cca6b8ba8");
  const rows = [{ id: 12, date: "2026-10-19", hours: 8, projectId: 267, kind: "work" }, { id: 9, date: "2026-10-17", hours: 0, projectId: null, kind: "sick" },
    { id: 15, date: "2026-10-20", hours: 10.25, projectId: 300, kind: "work" }];
  assert.equal(m.fingerprintLine(rows[1]), "9|2026-10-17|0.00|sick", "the kind stands in for a missing project");
  assert.equal(m.fingerprint(rows), m.md5("9|2026-10-17|0.00|sick\n12|2026-10-19|8.00|267\n15|2026-10-20|10.25|300") + "-3", "ordered by id, joined by a line feed");
  assert.equal(m.fingerprint([]), "d41d8cd98f00b204e9800998ecf8427e-0");
});

test("the fingerprint a confirmation sends is the one of the rows ON SCREEN (weekFingerprint): one employee, one Saturday-to-Friday week; screenBehind() names a week the database fingerprinted differently", () => {
  const E = (id, emp, date, hours, projectId) => ({ id, employeeId: emp, date, hours, projectId, kind: "work" });
  const screen = [E(1, 7, "2026-10-10", 8, 267), E(2, 7, "2026-10-16", 8, 267), E(3, 7, "2026-10-17", 8, 267), E(4, 8, "2026-10-12", 9, 300),
    E(5, 7, "2026-10-09", 4, 267)];
  assert.equal(m.weekFingerprint(screen, 7, "2026-10-10"), m.fingerprint([screen[0], screen[1]]), "Saturday to Friday, that employee only");
  assert.equal(m.weekFingerprint(screen, "8", "2026-10-10"), m.fingerprint([screen[3]]), "ids as text (data- attributes) too");
  assert.equal(m.weekFingerprint(screen, 9, "2026-10-10"), m.fingerprint([]), "nobody's rows: the empty week");
  const db = { 7: { fingerprint: m.weekFingerprint(screen, 7, "2026-10-10") }, 8: { fingerprint: m.weekFingerprint(screen, 8, "2026-10-10") }, 9: { fingerprint: null } };
  assert.deepEqual(m.screenBehind(db, screen, "2026-10-10"), [], "the screen agrees");
  // the office moved Robin's Friday to 12 h, or to another job, and the event never arrived: the
  // database's fingerprint moved, the screen's did not -> the confirmation is refused (409)
  for (const moved of [{ hours: 12 }, { projectId: 301 }]) {
    const now = screen.map((x) => (x.id === 2 ? Object.assign({}, x, moved) : x));
    const dbNow = Object.assign({}, db, { 7: { fingerprint: m.weekFingerprint(now, 7, "2026-10-10") } });
    assert.notEqual(m.weekFingerprint(screen, 7, "2026-10-10"), dbNow[7].fingerprint, JSON.stringify(moved));
    assert.deepEqual(m.screenBehind(dbNow, screen, "2026-10-10"), ["7"], JSON.stringify(moved));
  }
});

test("people who have left: personLabel and withFormer (the active list as it is, then the others by name, each once; an entry's employee counts)", () => {
  assert.equal(m.personLabel({ full_name: "Finley Example", active: false }), "Finley Example (left)");
  assert.equal(m.personLabel({ full_name: "Robin Example" }), "Robin Example");
  assert.equal(m.personLabel(null), "");
  const active = [{ id: 2, full_name: "Robin Example" }, { id: 1, full_name: "Ada Example" }];
  const out = m.withFormer(active, [{ id: 9, full_name: "Zed Former", active: false }, { id: 2, full_name: "Robin Example" },
    { id: 31, employeeId: 5, employeeName: "Bo Former", employeeNo: "E-5" }, { id: 32, employeeId: 5, employeeName: "Bo Former" }, null]);
  assert.deepEqual(out.map((r) => [r.id, r.full_name, r.active === false]), [[2, "Robin Example", false], [1, "Ada Example", false],
    [5, "Bo Former", true], [9, "Zed Former", true]]);
  assert.equal(out[2].employee_no, "E-5");
  assert.deepEqual(m.withFormer(null, null), []);
});

test("the 'pick the project' sentence: one for the four entry pages, no example number (the old portal's sandbox is not in this database)", () => {
  assert.ok(/^Pick the project from the list/.test(m.PICK_PROJECT));
  assert.ok(!/A\d{3}/.test(m.PICK_PROJECT), m.PICK_PROJECT);
});

test("timesheet_weeks rows (M2's shape) -> marks: live / stale, mine, may withdraw, the signer's role, the colour made safe; other names are not guessed", () => {
  const rows = [{ employee_id: 7, employee_name: "Robin Example", week_start: "2026-10-10", week_end: "2026-10-16", fingerprint: "f-5", hours: "40.00", entries: 5,
    confirmed: true, live_count: 1, stale_count: 1, marks: [
      { id: 3, confirmed_by: "u-mgr", name: "Morgan Example", role: "manager", color: "#2f80d8", confirmed_at: "2026-10-17T17:05:00Z", hours_at_confirm: "40.00", stale: false, mine: false, can_withdraw: false },
      { id: 1, confirmed_by: "u-lead", name: "Riley Example", role: "lead", color: "red;position:fixed", confirmed_at: "2026-10-16T23:40:00Z", hours_at_confirm: "38.00", stale: true, mine: true, can_withdraw: true }] },
  { employee_id: 8, employee_name: "Sam Sample", week_start: "2026-10-10", fingerprint: "g-0", hours: 0, entries: 0, marks: [] }];
  const all = m.toWeeks(rows);
  const w = all["7|2026-10-10"];
  assert.deepEqual([w.employeeName, w.hours, w.entries, w.fingerprint, w.count, w.liveCount, w.staleCount, w.confirmed], ["Robin Example", 40, 5, "f-5", 2, 1, 1, true]);
  assert.deepEqual(w.marks.map((x) => [x.id, x.initials, x.role, x.color, x.stale, x.mine, x.canWithdraw, x.hoursAtConfirm]),
    [[1, "RE", "lead", "#6b7a8c", true, true, true, 38], [3, "ME", "manager", "#2f80d8", false, false, false, 40]], "oldest first; a colour that is not #rrggbb is drawn grey");
  assert.equal(all["8|2026-10-10"].confirmed, false);
  assert.deepEqual(Object.keys(m.weeksOf(all, "2026-10-10")).sort(), ["7", "8"]);
  // a key M2 does not answer is not guessed at: no tick is drawn from it, and a missing stale / mine / can_withdraw is false
  const odd = m.toWeeks([{ confirmation_id: 5, employee_id: 7, week_start: "2026-10-10", confirmed_by: "u-x", confirmer_name: "Ada X", current_fingerprint: "h-2", fingerprint: "h-1" },
    { employee_id: 8, week_start: "2026-10-10", fingerprint: "h-3", marks: [{ id: 6, confirmed_by: "u-y", name: "Bo Y" }] }]);
  assert.deepEqual([odd["7|2026-10-10"].fingerprint, odd["7|2026-10-10"].marks.length], ["h-1", 0]);
  assert.deepEqual([odd["8|2026-10-10"].marks[0].stale, odd["8|2026-10-10"].marks[0].mine, odd["8|2026-10-10"].marks[0].canWithdraw, odd["8|2026-10-10"].marks[0].role], [false, false, false, ""]);
});

test("the PDF: one sheet per day and job, the week of any date, the file name, the table body padded to ten rows", () => {
  const E = (id, date, hours, kind, label, extra) => Object.assign({ id, employeeId: 7, employeeName: "Robin Example", date, hours, kind: kind || "work",
    leave: !!kind && kind !== "work", dayType: kind === "vacation" ? "Vacation" : "Worked", projectLabel: label || "A267 — Sandbox", work: "", start1: "07:00", end1: "11:00",
    start2: "12:00", end2: "16:00" }, extra || {});
  const list = [E(1, "2026-10-19", 8), E(2, "2026-10-19", 2, "work", "A300 — Barn"), E(3, "2026-10-20", 8, "vacation", "Vacation"), E(4, "2026-10-26", 8)];
  const day = m.pdfSheets(list, "day", "2026-10-19");
  assert.deepEqual(day.map((s) => [s.dateKey, s.job, s.rows.length]), [["2026-10-19", "A267 — Sandbox", 1], ["2026-10-19", "A300 — Barn", 1]]);
  const week = m.pdfSheets(list, "week", "2026-10-21");
  assert.deepEqual(week.map((s) => s.job), ["A267 — Sandbox", "A300 — Barn", "Vacation"], "Saturday to Friday around the date");
  assert.equal(m.pdfFileName("Robin O'Example", "week", "2026-10-21"), "Timesheet-Robin-O-Example-Week-2026-10-17.pdf");
  assert.equal(m.pdfFileName("Robin Example", "day", "2026-10-19"), "Timesheet-Robin-Example-2026-10-19.pdf");
  const b = m.pdfBody({ dateKey: "2026-10-19", rows: [E(1, "2026-10-19", 8, "work", null, { work: "Walls" })] });
  assert.equal(b.body.length, 10);
  assert.deepEqual(b.body[0], ["Robin Example", "7:00 AM", "4:00 PM", "8"]);
  assert.equal(b.total, 8);
  assert.equal(b.workText, "Monday, October 19, 2026\nWalls");
});
