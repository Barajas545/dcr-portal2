// The photographer screen program, P3: the shoot schedule's pure rules (site/js/map/photo.js) - the days in words, Late
// (open, dated, the company day past planned_date + window_days), the Agenda groups and the Month grid, the chips, the
// anchor in words, the Move sheet's choices and arguments, the preview in words (every shoot that moves from -> to, what
// stays and why, what will be skipped, the series re-planned, the office's approval), every refusal and change status,
// who may act. The shared shift cases (DCR Desktop 2's tools/pglite_check/photo_shift_cases.json) are run ONLY for their
// words: the shift rule is the database's (photo_change_preview), never worked out here. Made-up shoots and people only.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as M from "../site/js/map/photo.js";

const D2 = path.resolve(process.env.DCR_DESKTOP2_DIR || fileURLToPath(new URL("../../DCR Desktop 2/", import.meta.url)));
const CASES = path.join(D2, "tools", "pglite_check", "photo_shift_cases.json");
const TODAY = "2026-11-09";            // a Monday

const plan = (over) => M.toPlan(Object.assign({
  id: 7, rev: 120, milestones_rev: 110, status: "active", project_code: "A000T9", project_label: "A000T9 Sample house", city: "Sandbox", title: "Photo plan",
  photographer_name: "Pat Lens", photographer_profile_id: "u-pat", photographer_source: "team",
  milestones: { framing_start: { date: "2026-11-16", source: "admin", confirmed: true, firm: true }, delivery: { date: "2026-11-13", source: "estimate", confirmed: false, firm: false },
    framing_complete: { date: "2026-12-11", source: "estimate", confirmed: false, firm: false }, house_complete: { date: null, source: "estimate", confirmed: false, firm: false } },
  shoot_days: [0, 1, 2, 3, 4, 5], lead_days: 3, series: [{ key: "framing-progress", name: "Framing progress", phase: "framing_progress", anchor: "framing_start", every: 7 }],
  open_suggestions: 0, mirrored_at: "2026-11-09T17:00:00Z",
}, over || {}));
let nextId = 50;
const shoot = (over) => M.toShoot(Object.assign({ id: ++nextId, plan_id: 7, key: "s" + nextId, seq: 1000, phase: "special", name: "Shoot " + nextId,
  anchor: "framing_start", offset_days: 0, fixed_date: null, planned_date: "2026-11-16", window_days: 0, status: "planned", auto_skipped: false,
  pin_day: null, series: null, n: 0, announced_for: null, rev: 100, brief: {}, history: [] }, over || {}));

test("days in words: 'Thu Nov 19' (the year when it is not this year), weekdays, the shoot days as Python numbers", () => {
  assert.equal(M.dayText("2026-11-19", TODAY), "Thu Nov 19");
  assert.equal(M.dayText("2026-11-09"), "Mon Nov 9");
  assert.equal(M.dayText("2027-01-07", TODAY), "Thu Jan 7, 2027");
  assert.equal(M.dayText("not a day"), "");
  assert.equal(M.weekdayName("2026-11-15"), "Sunday");
  assert.deepEqual(["2026-11-09", "2026-11-14", "2026-11-15"].map(M.pyWeekday), [0, 5, 6], "Mon = 0 ... Sun = 6");
  assert.ok(M.isShootDay("2026-11-14", [0, 1, 2, 3, 4, 5]) && !M.isShootDay("2026-11-15", [0, 1, 2, 3, 4, 5]) && M.isShootDay("2026-11-15", []));
  assert.equal(M.shootDaysText([0, 1, 2, 3, 4, 5]), "Monday to Saturday");
  assert.equal(M.shootDaysText([]), "every day");
  assert.equal(M.shootDaysText([0, 2, 4]), "Mon, Wed, Fri");
  assert.equal(M.daysBetween("2026-11-09", "2026-12-01"), 22);
  assert.equal(M.daysBetween("2026-03-07", "2026-03-09"), 2, "across the DST change, calendar days");
});

test("rows -> shapes: every free text through the money masks; Firm from the row (or date + confirmed + source admin)", () => {
  const p = plan({ title: "Plan for the $45,000 job", project_label: "A000T9 paid 12,500 deposit" });
  assert.ok(!/\$|12,500/.test(p.title + p.projectLabel), p.title + " / " + p.projectLabel);
  assert.equal(p.milestones.framing_start.firm, true);
  assert.equal(p.milestones.delivery.firm, false);
  assert.equal(p.milestones.house_complete.date, null);
  assert.equal(M.toPlan({ milestones: { delivery: { date: "2026-11-13", source: "admin", confirmed: true } } }).milestones.delivery.firm, true, "without the firm key");
  assert.equal(p.label, p.projectLabel, "the label is the project label");
  const s = shoot({ name: "Before framing $500 bid", done_note: "Client paid $1,200", history: [{ at: "x", from: "2026-11-01", to: "2026-11-02", reason: "owes us $300", manual: true, by: "Pat", change: 4 }] });
  assert.ok(!/\$\d|1,200/.test(s.name + s.doneNote + s.history[0].reason));
  assert.deepEqual([s.history[0].from, s.history[0].change, s.history[0].manual], ["2026-11-01", 4, true]);
  const c = M.toChange({ id: 3, plan_id: 7, kind: "move_one", args: { shoot: "a", to: "2026-11-20" }, status: "new", requested_at: "2026-11-01T17:00:00Z" }, new Date("2026-11-09T17:00:00Z"));
  assert.equal(c.state, "expired", "a new change older than 7 days reads as expired");
  assert.deepEqual(M.toAccess(null), { admin: false, photographer: false, marketing: false, defaultPhotographer: false, canEdit: false, canRead: false, ready: false });
  assert.deepEqual(M.toAccess({ admin: false, photographer: true, marketing: false, default_photographer: true, can_edit: true, can_read: true }),
    { admin: false, photographer: true, marketing: false, defaultPhotographer: true, canEdit: true, canRead: true, ready: true });
  assert.equal(M.toPcStatus(null), null);
  const t = M.toTeamMember({ profile_id: "u-1", photographer: true, marketing: false, default_photographer: true, google_email: null, version: 3, profile: { full_name: "Pat Lens", role: "field", active: true } });
  assert.deepEqual([t.name, t.role, t.defaultPhotographer, t.version], ["Pat Lens", "field", true, 3]);
});

test("Late: open, dated, and today past planned_date + window_days (the company day); closed and undated shoots are never late", () => {
  const s = shoot({ planned_date: "2026-11-06", window_days: 2 });
  assert.equal(M.isLate(s, "2026-11-08"), false, "the last day of its grace");
  assert.equal(M.isLate(s, "2026-11-09"), true);
  assert.equal(M.lateDays(s, "2026-11-11"), 3);
  assert.equal(M.isLate(shoot({ planned_date: "2026-11-01", status: "done" }), TODAY), false);
  assert.equal(M.isLate(shoot({ planned_date: null }), TODAY), false);
  assert.equal(M.isLate(shoot({ planned_date: "2026-11-01", status: "announced" }), TODAY), true);
  assert.equal(M.movedNotTold(shoot({ status: "announced", announced_for: "2026-11-12", planned_date: "2026-11-13" })), true);
  assert.equal(M.movedNotTold(shoot({ status: "announced", announced_for: "2026-11-13", planned_date: "2026-11-13" })), false);
  assert.equal(M.movedNotTold(shoot({ status: "planned", announced_for: "2026-11-12", planned_date: "2026-11-13" })), false);
});

test("the anchor in words", () => {
  const p = plan();
  assert.equal(M.anchorText(shoot({ anchor: "framing_start", offset_days: 2 }), p), "2 days after Framing start");
  assert.equal(M.anchorText(shoot({ anchor: "delivery", offset_days: -1 }), p), "1 day before Delivery");
  assert.equal(M.anchorText(shoot({ anchor: "delivery", offset_days: 0 }), p), "on Delivery");
  assert.equal(M.anchorText(shoot({ anchor: "fixed", fixed_date: "2026-11-18" }), p), "on a fixed day");
  assert.equal(M.anchorText(shoot({ anchor: "framing_start", fixed_date: "2026-11-18" }), p), "on a fixed day (it stopped following Framing start)");
  assert.equal(M.anchorText(shoot({ anchor: "house_complete", offset_days: 3 }), p), "3 days after House complete (House complete has no date yet)");
});

test("the Agenda: Late, Today (today, or earlier but within its grace), This week, Next week, Later, No date yet, Done & closed (folded); archived plans hidden; mine", () => {
  const p = plan();
  const other = plan({ id: 8, project_label: "A000T8 Made-up garage", photographer_profile_id: "u-kim" });
  const old = plan({ id: 9, status: "archived", project_label: "A000T7 Old deck" });
  const list = [
    shoot({ key: "late", planned_date: "2026-11-05", window_days: 1 }),
    shoot({ key: "grace", planned_date: "2026-11-07", window_days: 3 }),
    shoot({ key: "today", planned_date: TODAY }),
    shoot({ key: "sat", planned_date: "2026-11-14" }),
    shoot({ key: "sun", planned_date: "2026-11-15" }),
    shoot({ key: "next-sat", planned_date: "2026-11-21" }),
    shoot({ key: "later", planned_date: "2026-11-22" }),
    shoot({ key: "undated", planned_date: null }),
    shoot({ key: "done", planned_date: "2026-11-02", status: "done", done_at: "2026-11-02T18:00:00Z" }),
    shoot({ key: "skipped", planned_date: "2026-11-03", status: "skipped", auto_skipped: true }),
    shoot({ key: "garage", plan_id: 8, planned_date: "2026-11-14" }),
    shoot({ key: "archived", plan_id: 9, planned_date: "2026-11-10" }),
  ];
  const a = M.agenda([p, other, old], list, TODAY, {});
  const g = Object.fromEntries(a.groups.map((x) => [x.key, x.entries.map((e) => e.shoot.key)]));
  assert.deepEqual(a.groups.map((x) => x.key), ["late", "today", "this_week", "next_week", "later", "undated", "closed"]);
  assert.deepEqual(g, { late: ["late"], today: ["grace", "today"], this_week: ["garage", "sat"], next_week: ["sun", "next-sat"], later: ["later"], undated: ["undated"],
    closed: ["skipped", "done"] }, "weeks start on Sunday; the same day by plan label");
  assert.equal(a.groups.find((x) => x.key === "closed").folded, true);
  assert.equal(a.groups.find((x) => x.key === "late").folded, false);
  const monday = M.agenda([p], list, TODAY, { weekStart: 1 });
  assert.deepEqual(monday.groups.find((x) => x.key === "this_week").entries.map((e) => e.shoot.key), ["sat", "sun"], "weeks starting on Monday");
  const mine = M.agenda([p, other], list, TODAY, { mine: "u-kim" });
  assert.deepEqual(mine.groups.filter((x) => x.count).map((x) => x.key + ":" + x.count), ["this_week:1"], "my plans only");
  const arch = M.agenda([p, old], list, TODAY, { archived: true });
  assert.ok(arch.groups.some((x) => x.entries.some((e) => e.shoot.key === "archived")), "archived plans on request");
  assert.equal(M.agenda([p], [], TODAY).empty, true);
  assert.deepEqual(M.planShoots(p, list).slice(0, 3).map((s) => s.key), ["done", "skipped", "late"], "a plan's own order");
  assert.deepEqual(M.plansInOrder([other, p], list, TODAY).map((x) => x.id), [7, 8], "the plan with the next open shoot first");
});

test("the Month grid: whole weeks from the week start, days out of the month flagged, entries per day, today, prev / next", () => {
  const p = plan();
  const g = M.monthGrid("2026-11", [p], [shoot({ key: "a", planned_date: "2026-11-16" }), shoot({ key: "b", planned_date: "2026-11-16", seq: 10 }),
    shoot({ key: "c", planned_date: null }), shoot({ key: "d", planned_date: "2026-11-05", window_days: 0 })], TODAY);
  assert.equal(g.label, "November 2026");
  assert.deepEqual([g.prev, g.next], ["2026-10", "2026-12"]);
  assert.deepEqual(g.weekdays, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  assert.equal(g.weeks[0][0].day, "2026-11-01", "Nov 1 2026 is a Sunday");
  assert.equal(g.weeks.length, 5);
  const cell = g.weeks.flat().find((c) => c.day === "2026-11-16");
  assert.deepEqual(cell.entries.map((e) => e.shoot.key), ["b", "a"], "by seq");
  assert.equal(g.weeks.flat().find((c) => c.day === TODAY).isToday, true);
  assert.equal(g.weeks.flat().find((c) => c.day === "2026-11-05").entries[0].late, true);
  assert.deepEqual(g.undated.map((e) => e.shoot.key), ["c"]);
  const feb = M.monthGrid("2028-02", [p], [], "2028-02-10", { weekStart: 1 });
  assert.equal(feb.weekdays[0], "Mon");
  assert.ok(feb.weeks.flat().some((c) => c.day === "2028-02-29" && c.inMonth), "a leap day");
  assert.ok(feb.weeks.flat().every((c, i) => i % 7 !== 0 || M.weekdayShort(c.day) === "Mon"));
  assert.deepEqual([M.monthGrid("2026-12", [p], [], TODAY).next, M.monthGrid("2026-01", [p], [], TODAY).prev], ["2027-01", "2025-12"]);
});

test("the chips: status, Late with its days, the grace, Moved - not told yet, the Firm job date it follows, a change waiting, a day picked by hand", () => {
  const p = plan();
  const keys = (s, o) => M.shootChips(s, p, TODAY, o).map((c) => c.key + (c.key === "late" || c.key === "status" ? "=" + c.text : ""));
  assert.deepEqual(keys(shoot({ planned_date: "2026-11-04", window_days: 1 })), ["status=Planned", "late=Late - 4 days", "firm"]);
  assert.deepEqual(keys(shoot({ planned_date: "2026-11-08", window_days: 2, anchor: "delivery" })), ["status=Planned", "grace"]);
  assert.deepEqual(keys(shoot({ planned_date: TODAY, anchor: "delivery" })), ["status=Planned", "today"]);
  assert.deepEqual(keys(shoot({ status: "announced", announced_for: "2026-11-12", planned_date: "2026-11-13", anchor: "delivery" })),
    ["status=Heads-up sent", "not_told"]);
  assert.deepEqual(keys(shoot({ status: "skipped", auto_skipped: true, planned_date: "2026-11-01" })), ["status=Skipped - its day had passed", "firm"]);
  assert.deepEqual(keys(shoot({ anchor: "framing_start", fixed_date: "2026-11-18", planned_date: "2026-11-18" })), ["status=Planned"], "a fixed day follows no job date");
  const pending = M.toChange({ id: 9, plan_id: 7, kind: "move_one", target_key: "x", status: "new", requested_at: new Date().toISOString() });
  assert.deepEqual(keys(shoot({ key: "x", planned_date: "2026-11-20", pin_day: "2026-11-20", anchor: "delivery" }), { pending }), ["status=Planned", "pending", "pinned"]);
  assert.equal(M.shootChips(shoot({ key: "x" }), p, TODAY, { pending: Object.assign({}, pending, { needsOffice: true }) }).find((c) => c.key === "pending").text,
    "Waiting for the office to approve");
  const m = M.milestoneChips(p, TODAY);
  assert.deepEqual(m.map((x) => x.text), ["Framing start Mon Nov 16 · Firm", "Delivery Fri Nov 13 · estimate", "Framing complete Fri Dec 11 · estimate",
    "House complete: no date yet"]);
});

test("changes: the pending change of a shoot (its own, or a job-date change of the date it follows); the title and status of every kind and state", () => {
  const now = new Date("2026-11-09T18:00:00Z");
  const p = plan();
  const shoots = [shoot({ key: "delivery", name: "Delivery day", anchor: "delivery", planned_date: "2026-11-13" }),
    shoot({ key: "progress-1", name: "Framing progress #1", anchor: "framing_start", offset_days: 7, planned_date: "2026-11-23" })];
  const ch = (o) => M.toChange(Object.assign({ id: 1, plan_id: 7, status: "new", requested_at: "2026-11-09T17:00:00Z", args: {} }, o), now);
  const ms = ch({ kind: "milestone", args: { milestone: "framing_start", date: "2026-11-18" } });
  assert.equal(M.pendingFor([ms], shoots[1]), ms);
  assert.equal(M.pendingFor([ms], shoots[0]), null);
  assert.equal(M.pendingFor([ch({ kind: "done", target_key: "delivery", status: "applied" })], shoots[0]), null, "a finished change waits for nothing");
  const ctx = { shoots, plan: p, today: TODAY };
  assert.equal(M.changeTitle(ch({ kind: "move_one", args: { shoot: "delivery", to: "2026-11-16" } }), ctx), "Move Delivery day to Mon Nov 16 - only this shoot");
  assert.equal(M.changeTitle(ch({ kind: "move_later", args: { shoot: "delivery", to: "2026-11-16" } }), ctx), "Move Delivery day to Mon Nov 16 - and the later ones");
  assert.equal(M.changeTitle(ms, ctx), "Framing start moved to Wed Nov 18");
  assert.equal(M.changeTitle(ch({ kind: "milestone", args: { shoot: "progress-1", to: "2026-11-25" } }), ctx), "Framing start moved to Wed Nov 18", "through a shoot");
  assert.equal(M.changeTitle(ch({ kind: "done", args: { shoot: "delivery" } }), ctx), "Mark Delivery day done");
  assert.equal(M.changeTitle(ch({ kind: "undo", args: { change: 4 } }), ctx), "Undo change #4");
  const st = (o, opt) => M.changeStatusText(ch(o), Object.assign({ now }, opt || {}));
  assert.equal(st({}).text, "Waiting for the office computer");
  assert.equal(st({}, { pc: { online: false, lastSeen: "2026-11-09T16:00:00Z", minutesAgo: 120, paused: false } }).text, "The office computer is off - changes wait until it is back on (last seen 2 h ago)");
  assert.equal(st({ needs_office: true }).text, "Waiting for the office computer - then the office approves");
  assert.equal(st({ status: "taken" }).text, "The office computer is applying it");
  const ap = st({ status: "applied", result: { outcome: "applied", words: "4 shoots moved - the $250 fee stays" } });
  assert.deepEqual([ap.text, /\$/.test(ap.words)], ["Applied", false]);
  assert.equal(st({ status: "applied", result: { outcome: "applied", differs_from_preview: true } }).text, "Applied - it came out a little differently from the preview");
  assert.equal(st({ status: "applied", result: { outcome: "suggested", words: "Sent to the office: Framing start is Firm" } }).text, "Sent to the office to approve");
  assert.equal(st({ status: "applied", result: { outcome: "suggested", words: "Sent to the office: Framing start is Firm" } }).words, "Framing start is Firm",
    "the PC's own \"Sent to the office:\" not said twice");
  assert.equal(st({ status: "refused", error: { code: "changed", message: "x" } }).text, "Not done: The shoot changed meanwhile - look again.");
  const odd = st({ status: "refused", error: { code: "weird_one", message: "Something odd ($90 more)" } }).text;
  assert.ok(odd.startsWith("Not done: Something odd (") && !odd.includes("$") && !odd.includes("90"), "an unknown code keeps its sentence, masked: " + odd);
  assert.equal(st({ status: "cancelled" }).text, "Cancelled");
  assert.equal(st({ status: "expired" }).text, "Expired - the office computer did not take it within 7 days");
  assert.equal(st({ requested_at: "2026-11-01T17:00:00Z" }).state, "expired", "7 days untaken");
});

test("refusals: every code the database (photo_change_* , set_photo_team) and DCR Agents 2 answer has its own words; an unknown one keeps the sentence it came with", () => {
  const request = ["forbidden", "bad_key", "key_reused", "no_plan", "plan_not_active", "bad_kind", "bad_args", "bad_rev", "rate", "too_many", "no_shoot",
    "changed", "pending", "no_original", "not_undoable", "past", "firm", "too_far", "no_change", "not_open", "undated", "not_anchored", "bad_milestone",
    "unknown_shoot", "too_big", "no_request"];
  const team = ["forbidden", "bad_args", "agents", "inactive", "default_needs_photographer", "pick_default_first", "bad_email", "no_person", "changed"];
  const pc = ["changed", "past", "too_far", "not_open", "undated", "not_anchored", "no_change", "gone", "not_active", "not_undoable", "firm", "forbidden", "failed",
    "expired", "cancelled"];
  const generic = "The shoot schedule cannot make that change.";
  for (const c of request) assert.notEqual(M.refusalText(c, { where: "request" }), generic, c);
  for (const c of team) assert.notEqual(M.refusalText(c, { where: "team" }), generic, "team " + c);
  for (const c of pc) assert.notEqual(M.refusalText(c, { where: "pc" }), generic, "pc " + c);
  for (const c of request.concat(team, pc)) assert.ok(M.REFUSAL_CODES.includes(c), c + " is in REFUSAL_CODES");
  assert.equal(M.refusalText("changed", { where: "team" }), "Someone changed the photo team meanwhile - look again.");
  assert.equal(M.refusalText("forbidden", { where: "team" }), "Only an admin can change the photo team.");
  assert.equal(M.refusalText("firm", { milestone: "framing_start" }), "Framing start is Firm - only the office can set it back (move it instead and the office is asked).");
  assert.equal(M.refusalText("rate", { retryAfter: 1750 }), "That is a lot of changes in a short time - try again in 30 minutes.");
  assert.equal(M.refusalText("too_far", { milestone: "delivery" }), "That job date is more than a year away or more than 60 days back.");
  assert.equal(M.refusalText("brand_new", { message: "the DCR server said no" }), "the DCR server said no.");
  assert.equal(M.refusalText("brand_new"), generic);
});

test("the Move sheet always asks the three choices (Only this shoot preselected), and the arguments each sends", () => {
  const p = plan();
  const s = shoot({ key: "progress-1", anchor: "framing_start", offset_days: 7, planned_date: "2026-11-23" });
  const c = M.moveChoices(s, p);
  assert.deepEqual(c.map((x) => [x.kind, x.label, !!x.preselected, x.ok]),
    [["move_one", "Only this shoot", true, true], ["move_later", "This shoot and the later ones", false, true], ["milestone", "The job date moved", false, true]]);
  assert.deepEqual(c[2].milestones.map((m) => m.key), ["framing_start", "delivery", "framing_complete", "house_complete"], "the job date it follows first");
  assert.deepEqual(c[2].milestones.map((m) => m.firm), [true, false, false, false]);
  assert.deepEqual(M.moveChoices(shoot({ anchor: "delivery" }), p)[2].milestones.map((m) => m.key)[0], "delivery");
  const undated = M.moveChoices(shoot({ planned_date: null }), p);
  assert.deepEqual([undated[0].ok, undated[1].ok, undated[1].why], [true, false, "That shoot has no date to move from yet."]);
  assert.equal(M.moveChoices(shoot({ status: "done" }), p)[0].ok, false, "a closed shoot does not move");
  assert.deepEqual(M.moveArgs({ kind: "move_one", shoot: "a", to: "2026-11-20", reason: "  Rain \n delay " }), { kind: "move_one", args: { shoot: "a", to: "2026-11-20", reason: "Rain delay" } });
  assert.deepEqual(M.moveArgs({ kind: "move_later", shoot: "a", to: "2026-11-20" }), { kind: "move_later", args: { shoot: "a", to: "2026-11-20" } });
  assert.deepEqual(M.moveArgs({ kind: "milestone", milestone: "delivery", date: "2026-11-14" }), { kind: "milestone", args: { milestone: "delivery", date: "2026-11-14" } });
  assert.deepEqual(M.moveArgs({ kind: "milestone", shoot: "a", to: "2026-11-20", firm: true }), { kind: "milestone", args: { shoot: "a", to: "2026-11-20", firm: true } });
  assert.deepEqual(M.moveArgs({ kind: "done", shoot: "a", note: " All shot " }), { kind: "done", args: { shoot: "a", note: "All shot" } });
  assert.deepEqual(M.moveArgs({ kind: "undo", change: "12" }), { kind: "undo", args: { change: 12 } });
});

test("the preview in words: every shoot that moves (from -> to), its notes (the roll worked from the database's own answer), what stays and why, what will be skipped, the series, the office", () => {
  const p = plan();
  const shoots = [
    shoot({ key: "delivery", name: "Delivery day", anchor: "delivery", planned_date: "2026-11-13", status: "announced" }),
    shoot({ key: "truss-set", name: "Truss set day", anchor: "delivery", offset_days: 1, planned_date: "2026-11-14" }),
    shoot({ key: "drone-check", name: "Drone airspace check", anchor: "fixed", fixed_date: "2026-11-18", planned_date: "2026-11-18" }),
    shoot({ key: "house-complete", name: "House complete", anchor: "house_complete", planned_date: null }),
    shoot({ key: "before-framing", name: "Before framing", anchor: "framing_start", offset_days: -2, planned_date: "2026-11-14" }),
  ];
  const later = M.previewWords({ plan_id: 7, rev: 120, today: TODAY, kind: "move_later", args: { shoot: "delivery", to: "2026-11-14" },
    moved: [{ key: "delivery", id: 1, name: "Delivery day", from: "2026-11-13", to: "2026-11-14", notes: ["heads_up_sent"] },
      { key: "truss-set", id: 2, name: "Truss set day", from: "2026-11-14", to: "2026-11-16", notes: ["rolled"] }],
    stays: [{ key: "drone-check", reason: "fixed" }, { key: "house-complete", reason: "undated" }], passed: [], replan: [], needs_office: false, refused: null },
  { plan: p, shoots, today: TODAY });
  assert.deepEqual(later.moved.map((m) => m.text), ["Delivery day: Fri Nov 13 → Sat Nov 14", "Truss set day: Sat Nov 14 → Mon Nov 16"]);
  assert.deepEqual(later.moved.map((m) => m.notes.map((n) => n.text)), [["Heads-up already sent - the task on My Tasks will update"], ["Sun → Mon: not a shoot day"]]);
  assert.deepEqual(later.stays.map((s) => s.text), ["Drone airspace check: Set to its own day - stays", "House complete: No date yet - waits for House complete"]);
  assert.deepEqual([later.summary, later.ok, later.unknown], ["2 shoots move, 2 stay", true, []]);
  const ms = M.previewWords({ kind: "milestone", today: TODAY, args: { milestone: "framing_start", date: "2026-11-21", shoot: "before-framing", to: "2026-11-19" },
    moved: [{ key: "before-framing", id: 5, name: "Before framing", from: "2026-11-14", to: "2026-11-20", notes: ["not_shoot_day", "stops_following", "gets_date", "comes_back", "rolled"] }],
    stays: [{ key: "truss-set", reason: "same_day" }, { key: "x-done", reason: "done", name: "Old shoot" }],
    passed: [{ key: "site-walk", name: "Site walk", from: "2026-11-02", to: "2026-11-03" }], replan: ["framing-progress"], needs_office: true, refused: null },
  { plan: p, shoots, today: TODAY });
  assert.deepEqual(ms.moved[0].notes.map((n) => n.code), ["not_shoot_day", "stops_following", "gets_date", "comes_back", "rolled"], "the contract's order");
  assert.deepEqual(ms.moved[0].notes.map((n) => n.text), ["Friday is not a shoot day - kept on the day you picked", "Gets its own day - it stops following Framing start",
    "Gets its first date", "Planned again - it was skipped because its day had passed", "Thu → Fri: not a shoot day"]);
  assert.deepEqual(ms.stays.map((s) => s.text), ["Truss set day: Stays on Sat Nov 14 (the nearest shoot day)", "Old shoot: Done - stays"]);
  assert.deepEqual(ms.passed.map((s) => s.text), ["Site walk: will be skipped - its day (Tue Nov 3) would be behind us"]);
  assert.deepEqual(ms.replan.map((s) => s.text), ["Framing progress visits will be re-planned - some may be added or cancelled"]);
  assert.equal(ms.office, "Framing start is Firm - the office will be asked to approve");
  assert.match(ms.summary, /the office approves first$/);
  const refused = M.previewWords({ kind: "move_one", args: { shoot: "delivery", to: "2026-11-01" }, moved: [], stays: [], passed: [], replan: [], needs_office: false, refused: "past" },
    { plan: p, shoots, today: TODAY });
  assert.deepEqual([refused.ok, refused.refused, refused.summary], [false, { code: "past", text: "That day has passed." }, "That day has passed."]);
  const done = M.previewWords({ kind: "done", args: { shoot: "delivery" }, moved: [], stays: [], passed: [], replan: [], needs_office: false, refused: null,
    done: { key: "delivery", id: 1, name: "Delivery day" } }, { plan: p, shoots, today: TODAY });
  assert.equal(done.summary, "Delivery day will be marked done");
  const firm = M.previewWords({ kind: "undo", args: { change: 3 }, moved: [], stays: [], passed: [], replan: [], needs_office: false, refused: "firm" }, { plan: p, today: TODAY });
  assert.match(firm.refused.text, /Firm/);
  const odd = M.previewWords({ kind: "move_one", moved: [{ key: "delivery", from: "2026-11-13", to: "2026-11-14", notes: ["brand_new_note"] }], stays: [{ key: "y", reason: "odd" }] },
    { plan: p, shoots, today: TODAY });
  assert.deepEqual(odd.unknown, ["brand_new_note", "odd"], "codes this page has no words for are reported, never dropped");
});

test("who may act: can_photo may request (an admin, a photographer), marketing reads only, closed shoots never move, a waiting change holds the shoot; undo within 7 days by the requester or an admin, never of done; cancel while new", () => {
  const p = plan();
  const open = shoot({});
  const admin = M.toAccess({ admin: true, can_edit: true, can_read: true });
  const ph = M.toAccess({ photographer: true, can_edit: true, can_read: true });
  const mk = M.toAccess({ marketing: true, can_edit: false, can_read: true });
  assert.deepEqual(M.shootActions(open, p, ph).move, { ok: true, why: "" });
  assert.deepEqual(M.shootActions(open, p, admin).done, { ok: true, why: "" });
  assert.equal(M.shootActions(open, p, mk).move.why, "Marketing reads the shoot schedule only.");
  assert.equal(M.shootActions(open, p, M.toAccess({ can_read: false })).move.ok, false);
  assert.equal(M.shootActions(shoot({ status: "done" }), p, ph).move.why, "A shoot that is done is not moved.");
  assert.equal(M.shootActions(shoot({ status: "missed" }), p, ph).move.ok, false);
  assert.equal(M.shootActions(open, plan({ status: "review" }), admin).move.ok, false, "a plan in review");
  assert.equal(M.shootActions(open, plan({ status: "paused" }), ph).move.ok, true, "a paused plan takes changes");
  assert.equal(M.shootActions(open, p, ph, { pending: {} }).move.ok, false);
  const now = new Date("2026-11-09T18:00:00Z");
  const applied = (o) => M.toChange(Object.assign({ id: 4, plan_id: 7, kind: "move_one", status: "applied", requested_by: "u-pat", requested_at: "2026-11-07T17:00:00Z",
    done_at: "2026-11-07T17:05:00Z", result: { outcome: "applied", moved: [] } }, o), now);
  assert.equal(M.canUndo(applied(), "u-pat", ph, now).ok, true, "the requester within 7 days");
  assert.equal(M.canUndo(applied(), "u-kim", ph, now).ok, false, "another photographer");
  assert.equal(M.canUndo(applied(), "u-kim", admin, now).ok, true, "an admin");
  assert.equal(M.canUndo(applied({ done_at: "2026-11-01T17:00:00Z" }), "u-pat", ph, now).ok, false, "older than 7 days");
  assert.equal(M.canUndo(applied({ kind: "done" }), "u-pat", admin, now).why, "A shoot marked done is not undone here.");
  assert.equal(M.canUndo(applied({ kind: "undo" }), "u-pat", admin, now).ok, false);
  assert.equal(M.canUndo(applied({ undone_by: 9 }), "u-pat", ph, now).ok, false);
  assert.equal(M.canUndo(applied({ result: { outcome: "suggested" } }), "u-pat", ph, now).ok, false, "a suggestion");
  assert.equal(M.canUndo(applied({ status: "refused", result: null }), "u-pat", ph, now).ok, false);
  assert.equal(M.canUndo(applied(), "u-pat", mk, now).ok, false, "marketing");
  const fresh = (o) => M.toChange(Object.assign({ id: 5, plan_id: 7, kind: "move_one", status: "new", requested_by: "u-pat", requested_at: "2026-11-09T17:00:00Z" }, o), now);
  assert.equal(M.canCancel(fresh(), "u-pat", ph, now).ok, true);
  assert.equal(M.canCancel(fresh(), "u-kim", ph, now).ok, false);
  assert.equal(M.canCancel(fresh(), "u-kim", admin, now).ok, true);
  assert.equal(M.canCancel(fresh({ status: "taken" }), "u-pat", ph, now).why, "The office computer is applying it already.");
  assert.equal(M.canCancel(fresh({ requested_at: "2026-11-01T17:00:00Z" }), "u-pat", ph, now).ok, false, "expired by time");
});

test("the team: the Google e-mail as the database keeps it (white space of every kind trimmed, lower case, none inside); one default photographer", () => {
  assert.deepEqual(M.googleEmailProblem("\t Pat.Lens@Example.TEST \n\u00a0"), { value: "pat.lens@example.test", problem: "" });
  assert.deepEqual(M.googleEmailProblem(""), { value: null, problem: "" });
  for (const bad of ["not-an-email", "@x", "pat @x.io", "pat\n@x.io", "pat@x\u00a0io", "pat@x.io\u0001", "a".repeat(250) + "@x.io"]) {
    assert.equal(M.googleEmailProblem(bad).problem, "That is not an e-mail address.", JSON.stringify(bad));
  }
  const team = [M.toTeamMember({ profile_id: "a", photographer: true, default_photographer: true, profile: { full_name: "Pat Lens" } }),
    M.toTeamMember({ profile_id: "b", photographer: true, profile: { full_name: "Kim Shutter" } }),
    M.toTeamMember({ profile_id: "c", marketing: true, profile: { full_name: "Mo Market", active: false } })];
  assert.deepEqual(M.teamSummary(team), { photographers: 2, marketing: 1, defaultId: "a",
    problems: ["Mo Market has no Google e-mail yet.", "Mo Market is turned off but still on the list."] });
  assert.deepEqual(M.teamSummary(team.slice(1)).problems[0], "Pick one default photographer.");
});

test("the office computer's line (the DCR server)", () => {
  assert.equal(M.pcLine({ online: true, paused: false, minutesAgo: 0, lastSeen: "x" }).text, "The office computer is on - a change is applied in a minute or two");
  assert.equal(M.pcLine({ online: true, paused: true, minutesAgo: 0, lastSeen: "x" }).state, "paused");
  assert.equal(M.pcLine({ online: false, paused: false, minutesAgo: 125, lastSeen: "x" }).text, "The office computer is off - changes wait until it is back on (last seen 2 h ago)");
  assert.equal(M.pcLine({ online: false, paused: true, minutesAgo: 4, lastSeen: "x" }).text, "The office computer is off - changes wait until it is back on (last seen 4 min ago, paused)");
  assert.equal(M.pcLine({ online: false, paused: false, minutesAgo: null, lastSeen: null }).text, "The office computer has not been seen yet - changes wait until it is on");
  assert.equal(M.pcLine(null).state, "unknown");
  assert.deepEqual([0, 59, 60, 2879, 2880].map(M.agoText), ["just now", "59 min ago", "1 h ago", "47 h ago", "2 days ago"]);
  assert.equal(M.EMPTY_TEXT, "No shoot schedule yet - the DCR server publishes it", "the contract's §2 words");
});

test("the shared shift cases (DCR Desktop 2 photo_shift_cases.json) - ONLY their words: each expected answer, as the database would send it, is worded whole", { skip: !existsSync(CASES) && "the shared case file is not on this PC (DCR_DESKTOP2_DIR)" }, () => {
  const file = JSON.parse(readFileSync(CASES, "utf8"));
  assert.ok(file.cases.length >= 20, "the cases");
  assert.deepEqual(file.notes_order, M.NOTE_ORDER.slice(), "the notes' order is the contract's");
  assert.deepEqual(file.stay_reasons, M.STAY_REASONS.slice(), "the stay reasons");
  for (const code of file.refusals) assert.ok(M.REFUSAL_CODES.includes(code), "a refusal with words: " + code);
  let worded = 0;
  for (const c of file.cases) {
    const inp = c.input;
    const rows = inp.shoots.map((s, i) => Object.assign({ id: i + 1, plan_id: 7, rev: 1 }, s));
    const shoots = rows.map(M.toShoot);
    const p = plan({ milestones: inp.milestones, shoot_days: inp.shoot_days, series: inp.series });
    const enrich = (list) => list.map((x) => { const r = rows.find((s) => s.key === x.key); return Object.assign({}, x, { id: r ? r.id : null, name: r ? r.name : null }); });
    const { kind, ...change } = inp.change;
    const args = Object.assign({}, change);
    if (kind === "milestone" && change.shoot) {
      const t = rows.find((s) => s.key === change.shoot);
      if (t && !t.fixed_date && M.MILESTONES.includes(t.anchor)) Object.assign(args, { milestone: t.anchor, date: addDay(change.to, -(t.offset_days || 0)) });
    }
    const pv = Object.assign({ plan_id: 7, rev: 1, today: inp.today, kind, args }, c.expected,
      { moved: enrich(c.expected.moved), stays: enrich(c.expected.stays), passed: enrich(c.expected.passed) });
    const w = M.previewWords(pv, { plan: p, shoots, today: inp.today });
    const where = c.name;
    assert.deepEqual(w.unknown, [], where + ": every code has words");
    assert.equal(w.ok, c.expected.refused === null, where);
    if (c.expected.refused) {
      assert.ok(w.refused.text && w.refused.text !== "The shoot schedule cannot make that change.", where + ": " + w.refused.text);
      continue;
    }
    assert.equal(w.moved.length, c.expected.moved.length, where);
    c.expected.moved.forEach((m, i) => {
      const x = w.moved[i];
      assert.equal(x.key, m.key, where);
      assert.ok(x.text.includes(m.from ? M.dayText(m.from, inp.today) : "no date") && x.text.includes(M.dayText(m.to, inp.today)), where + ": " + x.text);
      assert.deepEqual(x.notes.map((n) => n.code), m.notes, where + ": notes in the contract's order");
      for (const n of x.notes) assert.ok(n.text.length > 8 && !/_/.test(n.text), where + ": " + n.code + " -> " + n.text);
      const roll = x.notes.find((n) => n.code === "rolled");
      if (roll) assert.match(roll.text, /^[A-Z][a-z]{2} → [A-Z][a-z]{2}: not a shoot day$/, where + ": the roll from the day before it (" + roll.text + ")");
    });
    assert.deepEqual(w.stays.map((s) => s.reason), c.expected.stays.map((s) => s.reason), where);
    for (const s of w.stays) assert.ok(/ - stays$|^.+: Stays on |waits for /.test(s.text), where + ": " + s.text);
    assert.deepEqual(w.passed.map((s) => s.key), c.expected.passed.map((s) => s.key), where);
    for (const s of w.passed) assert.match(s.text, /will be skipped - its day \([A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}(, \d{4})?\) would be behind us$/, where);
    assert.equal(w.replan.length, c.expected.replan.length, where);
    for (const r of w.replan) assert.match(r.text, / visits will be re-planned/, where);
    assert.equal(!!w.office, c.expected.needs_office === true, where + ": the office");
    if (w.office) assert.match(w.office, /^(Framing start|Delivery|Framing complete|House complete) is Firm - the office will be asked to approve$/, where);
    worded += 1;
  }
  assert.ok(worded >= 10, worded + " cases worded");
});

function addDay(d, n) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
