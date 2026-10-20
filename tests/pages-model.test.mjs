// PROJECT-PAGES: the Board's rules (site/js/pages/board-model.js) and company time
// (site/js/map/pacific.js). Made-up sandbox data only.
import test from "node:test";
import assert from "node:assert/strict";

import { VIEWS, buildBoard, columnProjects, summaryText, mergeRow, viewOf, completionDay, matches }
  from "../site/js/pages/board-model.js";
import { toProject } from "../site/js/map/projects.js";
import { ymd, pacificToUtc, logWindow, saturdayOfYmd, addDays, monthsBefore, stamp, fmtShort, longDay, fmtDay }
  from "../site/js/map/pacific.js";

function P(id, status, extra) {
  return toProject(Object.assign({ id: id, number: "A" + String(id).padStart(3, "0"), name: "Job " + id,
    status: status, created_at: "2026-0" + ((id % 9) + 1) + "-10T18:00:00Z", updated_at: "2026-10-01T18:00:00Z",
    version: 3 }, extra || {}));
}

test("board: the four views keep the old lane lists, mapped to Desktop 2 statuses", () => {
  assert.deepEqual(VIEWS.main.cols.map((c) => c.status),
    ["on_hold", "new_request", "estimating", "sent", "approved", "in_progress", "completed"]);
  assert.deepEqual(VIEWS.sales.cols.map((c) => c.status), ["estimating", "sent", "approved", "in_progress", "completed"]);
  assert.deepEqual(VIEWS.marketing.cols.map((c) => c.status), ["approved", "in_progress", "completed"]);
  assert.deepEqual(VIEWS.accounting.cols.map((c) => c.status), ["approved", "in_progress", "completed"]);
  assert.equal(VIEWS.main.cols[1].label, "New request");
  assert.equal(viewOf("nope"), "main");
});

test("board: lanes sort oldest first, Sent newest first, ties by natural number", () => {
  const list = [P(3, "estimating"), P(1, "estimating"), P(2, "estimating", { created_at: "2026-02-10T18:00:00Z" }),
    P(5, "sent"), P(4, "sent")];
  const est = columnProjects(list, VIEWS.main.cols[2], { today: "2026-10-19" });
  assert.deepEqual(est.rows.map((p) => p.id), [1, 2, 3]);
  const sent = columnProjects(list, VIEWS.main.cols[3], { today: "2026-10-19" });
  assert.deepEqual(sent.rows.map((p) => p.id), [5, 4]);
});

test("board: Completed shows the last N months by completed_date", () => {
  const list = [P(1, "completed", { completed_date: "2026-10-01" }), P(2, "completed", { completed_date: "2026-06-01" }),
    P(3, "completed", { completed_date: null, updated_at: "2026-09-30T18:00:00Z" })];
  const main = columnProjects(list, VIEWS.main.cols[6], { today: "2026-10-19" });
  assert.deepEqual(main.rows.map((p) => p.id), [1, 3]);
  assert.equal(main.hiddenCompleted, 1);
  const sales = columnProjects(list, VIEWS.sales.cols[4], { today: "2026-10-19" });
  assert.equal(sales.rows.length, 3);
  assert.equal(completionDay(list[2]), "2026-09-30");
  assert.equal(monthsBefore("2026-10-19", 2), "2026-08-19");
});

test("board: untouched old-portal imports fold behind the chip, and come after the own projects", () => {
  const list = [P(10, "approved", { legacy_sp_id: 110, version: 1, created_at: "2024-01-01T18:00:00Z" }),
    P(11, "approved"), P(12, "approved", { legacy_sp_id: 112, version: 2 })];
  const folded = buildBoard(list, "main", { today: "2026-10-19", showOld: false });
  const lane = folded.columns.find((c) => c.col.status === "approved");
  assert.deepEqual(lane.rows.map((p) => p.id), [11, 12], "a moved import is an ordinary project");
  assert.equal(folded.oldHidden, 1);
  assert.equal(folded.oldCount, 1);
  const shown = buildBoard(list, "main", { today: "2026-10-19", showOld: true });
  assert.deepEqual(shown.columns.find((c) => c.col.status === "approved").rows.map((p) => p.id), [11, 12, 10]);
  const kept = buildBoard(list, "main", { today: "2026-10-19", showOld: false, keep: new Set(["10"]) });
  assert.equal(kept.oldHidden, 0, "a card being moved never counts as old");
});

test("board: the filter needs every word; the summary counts other statuses", () => {
  const list = [P(1, "approved", { client_name: "Pat Example", city: "Paso Robles" }), P(2, "follow_up"), P(3, "closed")];
  assert.equal(matches(list[0], "paso pat"), true);
  assert.equal(matches(list[0], "paso zed"), false);
  assert.equal(matches(list[0], "approved"), true, "the status label is searched");
  const b = buildBoard(list, "main", { today: "2026-10-19", showOld: false });
  assert.equal(b.other, 2);
  assert.equal(summaryText(b, false), "1 project on the board · 2 in other statuses");
  const f = buildBoard(list, "main", { today: "2026-10-19", search: "nothing-like-this" });
  assert.equal(summaryText(f, true), "No projects match the filter");
});

test("board: the status-note filter sees the masked text only", () => {
  const p = P(1, "sent", { status_note: "quoted $12,500" });
  const mask = (t) => t.replace(/\$[\d,]+/g, "(amount hidden)");
  assert.equal(matches(p, "12,500", mask), false);
  assert.equal(matches(p, "12,500"), true);
});

test("board: a live row never steps back over a newer one", () => {
  const a = P(1, "sent", { version: 5 });
  let list = [a];
  list = mergeRow(list, P(1, "approved", { version: 4 }));
  assert.equal(list[0].status, "sent");
  list = mergeRow(list, P(1, "approved", { version: 6 }));
  assert.equal(list[0].status, "approved");
  list = mergeRow(list, P(2, "estimating"));
  assert.equal(list.length, 2);
  list = mergeRow(list, Object.assign(P(2, "estimating"), { deletedAt: "2026-10-19T00:00:00Z" }));
  assert.equal(list.length, 1);
});

test("pacific: the company day, whatever the phone's zone", () => {
  assert.equal(ymd(new Date("2026-10-20T03:30:00Z")), "2026-10-19");    // 8:30 pm PDT
  assert.equal(ymd(new Date("2026-10-20T07:30:00Z")), "2026-10-20");
  assert.equal(pacificToUtc(2026, 10, 19, 0, 0).toISOString(), "2026-10-19T07:00:00.000Z");   // PDT
  assert.equal(pacificToUtc(2026, 12, 1, 0, 0).toISOString(), "2026-12-01T08:00:00.000Z");    // PST
  assert.equal(saturdayOfYmd("2026-10-19"), "2026-10-17");     // a Monday
  assert.equal(saturdayOfYmd("2026-10-17"), "2026-10-17");     // a Saturday
  assert.equal(saturdayOfYmd("2026-10-23"), "2026-10-17");     // a Friday
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("pacific: Log History windows are Pacific, across the DST change", () => {
  const now = new Date("2026-10-19T20:00:00Z");          // Monday 1 pm PDT
  assert.deepEqual(logWindow("today", now), ["2026-10-19T07:00:00.000Z", "2026-10-20T07:00:00.000Z"]);
  assert.deepEqual(logWindow("morning", now), ["2026-10-19T07:00:00.000Z", "2026-10-19T19:00:00.000Z"]);
  assert.deepEqual(logWindow("afternoon", now), ["2026-10-19T19:00:00.000Z", "2026-10-20T07:00:00.000Z"]);
  assert.deepEqual(logWindow("yesterday", now), ["2026-10-18T07:00:00.000Z", "2026-10-19T07:00:00.000Z"]);
  assert.deepEqual(logWindow("week", now), ["2026-10-17T07:00:00.000Z", "2026-10-20T07:00:00.000Z"]);
  assert.deepEqual(logWindow("lastweek", now), ["2026-10-10T07:00:00.000Z", "2026-10-17T07:00:00.000Z"]);
  assert.deepEqual(logWindow("month", now), ["2026-10-01T07:00:00.000Z", "2026-10-20T07:00:00.000Z"]);
  // the Monday after the clocks go back (Nov 1, 2026): last week straddles the change
  const nov = new Date("2026-11-02T20:00:00Z");
  assert.deepEqual(logWindow("lastweek", nov), ["2026-10-24T07:00:00.000Z", "2026-10-31T07:00:00.000Z"]);
  assert.deepEqual(logWindow("week", nov), ["2026-10-31T07:00:00.000Z", "2026-11-03T08:00:00.000Z"]);
});

test("pacific: names and labels", () => {
  assert.equal(stamp(new Date("2026-10-19T21:30:12Z")), "2026-10-19 14.30.12");
  assert.equal(fmtShort("2026-10-19"), "Oct-19");
  assert.equal(fmtShort("2026-10-20T03:00:00Z"), "Oct-19");
  assert.equal(longDay("2026-10-19"), "Monday, October 19, 2026");
  assert.equal(fmtDay("2026-10-19"), "Oct 19, 2026");
});
