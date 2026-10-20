// Company time (America/Los_Angeles): the day, the week (Saturday to Friday), Log History windows
// and the formats. Daylight saving changes are where "a local midnight sent through toISOString"
// used to bite, so the cases sit on them.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  companyDay, companyToday, addDays, weekday, saturdayOf, weekOf, pacificToUtc, logWindow,
  fmtDate, fmtDateTime, fmtTime, ago,
} from "../site/js/common2.js";

test("companyDay is the Pacific calendar day of a moment", () => {
  assert.equal(companyDay("2026-10-20T06:59:59Z"), "2026-10-19");   // 11:59 pm PDT
  assert.equal(companyDay("2026-10-20T07:00:00Z"), "2026-10-20");   // midnight PDT
  assert.equal(companyDay("2026-01-15T07:59:00Z"), "2026-01-14");   // 11:59 pm PST
  assert.equal(companyDay("2026-01-15T08:00:00Z"), "2026-01-15");
  assert.equal(companyDay("2026-10-19"), "2026-10-19", "a calendar day stays as it is");
  assert.equal(companyDay(""), "");
  assert.equal(companyDay("not a date"), "");
  assert.equal(companyToday(new Date("2026-03-08T09:30:00Z")), "2026-03-08");   // the spring-forward morning
});

test("addDays and weekday work on calendar days, across daylight saving", () => {
  assert.equal(addDays("2026-03-07", 1), "2026-03-08");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
  assert.equal(addDays("2026-11-01", -1), "2026-10-31");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(weekday("2026-10-19"), 1);   // Monday
  assert.equal(weekday("2026-10-17"), 6);   // Saturday
});

test("saturdayOf: the company week runs Saturday to Friday", () => {
  assert.equal(saturdayOf("2026-10-17"), "2026-10-17");
  assert.equal(saturdayOf("2026-10-18"), "2026-10-17");
  assert.equal(saturdayOf("2026-10-23"), "2026-10-17");   // Friday
  assert.equal(saturdayOf("2026-10-24"), "2026-10-24");
  assert.equal(saturdayOf("2026-03-09"), "2026-03-07");   // across spring forward
  assert.equal(saturdayOf(new Date("2026-10-18T06:30:00Z")), "2026-10-17", "a moment counts by its Pacific day");
});

test("weekOf: week #01 holds January 1 (the old portal's week folders)", () => {
  assert.deepEqual(weekOf("2026-01-02"), { saturday: "2025-12-27", friday: "2026-01-02", year: 2026, week: 1, label: "2026-Week #01" });
  assert.equal(weekOf("2026-01-03").label, "2026-Week #02");
  assert.equal(weekOf("2026-12-31").label, "2027-Week #01");
  assert.equal(weekOf("2026-10-19").week, 43);
});

test("pacificToUtc gives the UTC moment of a Pacific wall-clock time", () => {
  assert.equal(pacificToUtc("2026-10-19"), "2026-10-19T07:00:00.000Z");
  assert.equal(pacificToUtc("2026-01-15", "12:00:00"), "2026-01-15T20:00:00.000Z");
  assert.equal(pacificToUtc("2026-03-08"), "2026-03-08T08:00:00.000Z");          // still PST at midnight
  assert.equal(pacificToUtc("2026-03-09"), "2026-03-09T07:00:00.000Z");          // PDT
  assert.equal(pacificToUtc("2026-11-01"), "2026-11-01T07:00:00.000Z");          // PDT until 2 am
  assert.equal(pacificToUtc("2026-11-02"), "2026-11-02T08:00:00.000Z");
});

test("logWindow: the Log History periods in company time", () => {
  const now = new Date("2026-10-19T20:00:00Z");          // Monday 1 pm PDT
  assert.deepEqual(logWindow("today", now), { from: "2026-10-19T07:00:00.000Z", to: "2026-10-20T07:00:00.000Z" });
  assert.deepEqual(logWindow("morning", now), { from: "2026-10-19T07:00:00.000Z", to: "2026-10-19T19:00:00.000Z" });
  assert.deepEqual(logWindow("afternoon", now), { from: "2026-10-19T19:00:00.000Z", to: "2026-10-20T07:00:00.000Z" });
  assert.deepEqual(logWindow("yesterday", now), { from: "2026-10-18T07:00:00.000Z", to: "2026-10-19T07:00:00.000Z" });
  assert.deepEqual(logWindow("week", now), { from: "2026-10-17T07:00:00.000Z", to: "2026-10-20T07:00:00.000Z" });
  assert.deepEqual(logWindow("lastweek", now), { from: "2026-10-10T07:00:00.000Z", to: "2026-10-17T07:00:00.000Z" });
  assert.deepEqual(logWindow("month", now), { from: "2026-10-01T07:00:00.000Z", to: "2026-10-20T07:00:00.000Z" });
  // late evening Pacific is already tomorrow in UTC: still "today" here
  const late = new Date("2026-10-20T06:30:00Z");
  assert.equal(logWindow("today", late).from, "2026-10-19T07:00:00.000Z");
});

test("formats: a calendar day never shifts; moments show in company time", () => {
  assert.equal(fmtDate("2026-10-19"), "Oct 19, 2026");
  assert.equal(fmtDate("2026-10-19", { weekday: true }), "Mon, Oct 19, 2026");
  assert.equal(fmtDate("2026-10-19", { short: true }), "10/19/2026");
  assert.equal(fmtDate("2026-10-19", { noYear: true }), "Oct 19");
  assert.equal(fmtDate("2026-10-20T03:00:00Z"), "Oct 19, 2026", "8 pm PDT on the 19th");
  assert.match(fmtTime("2026-10-19T21:30:00Z"), /^2:30\sPM$/);   // ICU may use a narrow no-break space
  assert.match(fmtDateTime("2026-10-19T21:30:00Z"), /^Oct 19, 2026, 2:30\sPM$/);
  assert.equal(fmtDate(null), "");
  assert.equal(fmtDate("garbage"), "");
});

test("ago: minutes, hours, yesterday, then the date", () => {
  const now = new Date("2026-10-19T20:00:00Z");
  assert.equal(ago("2026-10-19T19:59:40Z", now), "just now");
  assert.equal(ago("2026-10-19T19:45:00Z", now), "15 min ago");
  assert.equal(ago("2026-10-19T16:00:00Z", now), "4 h ago");
  assert.match(ago("2026-10-18T20:00:00Z", now), /^Yesterday 1:00\sPM$/);
  assert.equal(ago("2026-09-01T20:00:00Z", now), "Sep 1");
});
