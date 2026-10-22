// P5b: js/expense-filter.js — the ONE place the project's Expenses tab and the printed expense report filter,
// sort, group and total (port of the old expense-filter.js). Periods are company days handed in as text, so
// the answers are the same in any time zone (run with TZ=UTC as GitHub does, and in Los Angeles). Made-up rows.
import test from "node:test";
import assert from "node:assert/strict";

import * as EF from "../site/js/expense-filter.js";

const row = (id, date, f) => Object.assign({ id, date, group: "", description: "", vendor: "", kindLabel: "Materials", kind: "material",
  materials: 0, contractors: 0, labor: 0, other: 0, cost: 0 }, f || {});

test("periods resolve to company days from the day handed in (no local Date, no UTC slip)", () => {
  const T = "2026-01-15";
  const f = (range, extra) => Object.assign(EF.defaults(), { range }, extra || {});
  assert.equal(EF.period(f("all"), T), null);
  assert.deepEqual(EF.period(f("thisMonth"), T), { a: "2026-01-01", b: "2026-01-31" });
  assert.deepEqual(EF.period(f("lastMonth"), T), { a: "2025-12-01", b: "2025-12-31" }, "across the new year");
  assert.deepEqual(EF.period(f("last30"), T), { a: "2025-12-17", b: "2026-01-15" });
  assert.deepEqual(EF.period(f("last90"), T), { a: "2025-10-18", b: "2026-01-15" });
  assert.deepEqual(EF.period(f("thisQuarter"), "2026-05-20"), { a: "2026-04-01", b: "2026-06-30" });
  assert.deepEqual(EF.period(f("thisYear"), T), { a: "2026-01-01", b: "2026-12-31" });
  assert.deepEqual(EF.period(f("lastYear"), T), { a: "2025-01-01", b: "2025-12-31" });
  assert.deepEqual(EF.period(f("lastMonth"), "2024-03-31"), { a: "2024-02-01", b: "2024-02-29" }, "a leap February");
  assert.deepEqual(EF.period(f("custom", { from: "2026-01-05" }), T), { a: "2026-01-05", b: "2999-12-31" });
  assert.equal(EF.period(f("custom"), T), null, "an empty custom range filters nothing");
  // a print link's resolved window wins over re-resolving a relative period
  assert.deepEqual(EF.period(f("thisMonth", { pa: "2025-11-01", pb: "2025-11-30" }), T), { a: "2025-11-01", b: "2025-11-30" });
});

test("norm() clamps what arrives from a URL or storage, and never rewrites intent", () => {
  const n = EF.norm({ range: "custom", from: "", to: "", sort: "constructor", dir: "5", q: "x".repeat(500), group: "Walls", pa: "nope" });
  assert.equal(n.range, "custom", "an empty custom range stays custom");
  assert.equal(n.sort, "date", "an unknown sort key falls back");
  assert.equal(n.dir, 1);
  assert.equal(n.q.length, 200);
  assert.equal(n.pa, "");
  assert.equal(EF.norm({ range: "everything" }).range, "all");
  assert.deepEqual(EF.norm(null), EF.defaults());
});

test("filter: by line, by window, by words (vendor and kind included; absent fields never match)", () => {
  const rows = [row(1, "2026-01-10", { group: "Walls — Exterior", description: "studs", vendor: "Made-up Lumber" }),
    row(2, "2025-12-20", { group: "", description: "Pump", kindLabel: "Subcontractor" }),
    row(3, "2025-06-01", { group: "Walls — Exterior", description: "nails" })];
  const T = "2026-01-15";
  const f = (o) => Object.assign(EF.defaults(), o);
  assert.deepEqual(EF.filter(rows, f({ group: "Walls — Exterior" }), T).map((r) => r.id), [1, 3]);
  assert.deepEqual(EF.filter(rows, f({ group: EF.NO_GROUP }), T).map((r) => r.id), [2]);
  assert.deepEqual(EF.filter(rows, f({ range: "last30" }), T).map((r) => r.id), [1, 2]);
  assert.deepEqual(EF.filter(rows, f({ q: "made-up" }), T).map((r) => r.id), [1]);
  assert.deepEqual(EF.filter(rows, f({ q: "subcontr" }), T).map((r) => r.id), [2]);
  assert.deepEqual(EF.filter(rows, f({ q: "und" }), T).map((r) => r.id), [], "never the literal 'undefined'");
});

test("sort and group: rows keep their global order inside each line; a line named __proto__ keeps its rows", () => {
  const rows = [row(1, "2026-01-02", { group: "B", cost: 5 }), row(2, "2026-01-03", { group: "__proto__", cost: 9 }),
    row(3, "2026-01-01", { group: "B", cost: 7 }), row(4, "2026-01-04", { group: "", cost: 1 })];
  const byDate = EF.sort(rows, EF.defaults());
  assert.deepEqual(byDate.map((r) => r.id), [4, 2, 1, 3], "newest first");
  assert.deepEqual(EF.sort(rows, Object.assign(EF.defaults(), { sort: "cost", dir: 1 })).map((r) => r.id), [4, 1, 3, 2]);
  const g = EF.group(byDate);
  assert.deepEqual(g.map((x) => x.name), ["B", "__proto__", EF.NO_GROUP], "named lines sorted, the unlined last");
  assert.deepEqual(g[0].rows.map((r) => r.id), [1, 3]);
  assert.equal(g[1].rows.length, 1);
});

test("totals are one pass in cents (0.1 + 0.2 is 0.3), and the subtotals add up to the grand total", () => {
  const rows = [row(1, "2026-01-01", { materials: 0.1, cost: 0.1, group: "A" }), row(2, "2026-01-01", { materials: 0.2, cost: 0.2, group: "B" }),
    row(3, "2026-01-01", { other: 86.4, group: "B" }), row(4, "2026-01-01", { labor: 135, cost: 135, group: "A" })];
  const t = EF.totals(rows);
  assert.deepEqual(t, { mat: 0.3, con: 0, lab: 135, oth: 86.4, cost: 135.3, count: 4 });
  const sub = EF.group(rows).map((g) => EF.totals(g.rows).cost);
  assert.equal(Math.round(sub.reduce((s, x) => s + x * 100, 0)) / 100, t.cost);
});

test("the Print link carries the filter and the resolved window; the report reads it back exactly; a bare link prints everything", () => {
  const T = "2026-10-21";
  const f = Object.assign(EF.defaults(), { group: "R&D / Misc", range: "thisMonth", q: "studs", sort: "cost", dir: 1 });
  const href = EF.hrefWith("report-expenses.html", { id: 268 }, f, true, T);
  assert.match(href, /^report-expenses\.html\?/);
  const qs = new URLSearchParams(href.split("?")[1]);
  assert.equal(qs.get("id"), "268");
  assert.equal(qs.get("group"), "R&D / Misc");
  assert.equal(qs.get("pa"), "2026-10-01");
  assert.equal(qs.get("pb"), "2026-10-31");
  const back = EF.fromQuery(qs);
  assert.deepEqual(EF.period(back, "2026-12-25"), { a: "2026-10-01", b: "2026-10-31" }, "printed later, still October");
  assert.equal(back.sort, "cost");
  assert.equal(EF.fromQuery(new URLSearchParams("id=268")), null);
  assert.equal(EF.label(back, T), 'Line: R&D / Misc · This month (Oct 1, 2026 – Oct 31, 2026) · Search: "studs" · Sorted by Cost, ascending');
  assert.equal(EF.isActive(EF.defaults(), T), false);
  const plain = EF.hrefWith("project.html", { id: 268, tab: "expenses" }, f, false, T);
  assert.ok(!/pa=|pb=/.test(plain), "the screen's own address never pins a window");
});

test("days and money read the same in any time zone", () => {
  assert.equal(EF.dayOf("2026-07-05"), "2026-07-05");
  assert.equal(EF.dayOf("2026-07-05T03:00:00Z"), "2026-07-04", "an instant is its Pacific day");
  assert.equal(EF.fmtDay("2026-07-05"), "Jul 5, 2026");
  assert.equal(EF.money(-64.25), "-$64.25");
  assert.equal(EF.money(1234.5), "$1,234.50");
  assert.equal(EF.stripML("a<br>b</div>c<b>d</b>&nbsp;e"), "a\nb\ncd e");
});
