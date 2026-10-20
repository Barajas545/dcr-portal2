// P3 check 3 ("needs_update agrees in Portal 2, DCR Desktop 2 and SQL for tasks around the 5-day edge at
// 11:30 pm Pacific"): Portal 2's clock (site/js/map/tasks.js clockOf — used for rows read straight from the
// tables; the lists carry the database's own clock) against the cases DCR Desktop 2 pins for the SQL
// (app.task_clock) and for its own Python (tools/pglite_check/task_clock_cases.json). Skipped when DCR
// Desktop 2 is not next to this repository (the published site's CI); tools/schema-check.mjs runs the
// same cases against app.task_clock itself.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clockOf, dayOf, NEEDS_UPDATE_DAYS } from "../site/js/map/tasks.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const D2 = path.resolve(process.env.DCR_DESKTOP2_DIR || path.join(HERE, "..", "..", "DCR Desktop 2"));
const FILE = path.join(D2, "tools", "pglite_check", "task_clock_cases.json");
const skip = !existsSync(FILE) && "DCR Desktop 2's task_clock_cases.json is not here";

test("clockOf() answers every shared task-clock case as app.task_clock does (the 5-day edge at 11:30 pm Pacific, notes, shoots)", { skip }, () => {
  const spec = JSON.parse(readFileSync(FILE, "utf8"));
  assert.equal(spec.zone, "America/Los_Angeles");
  assert.equal(spec.stale_days, NEEDS_UPDATE_DAYS);
  assert.ok(spec.cases.length >= 5);
  for (const c of spec.cases) {
    const notes = (c.notes || []).map((n, i) => Object.assign({ id: i + 1 }, n));
    const got = clockOf(Object.assign({ status: "open" }, c.task), notes, dayOf(c.at));
    const want = c.want;
    const same = (a, b) => (a === null || b === null ? a === b : Date.parse(a) === Date.parse(b));
    assert.ok(same(got.last_update, want.last_update), c.name + ": last_update " + got.last_update + " vs " + want.last_update);
    assert.deepEqual([got.last_update_source, got.days_since_update, got.last_note, got.needs_update],
      [want.last_update_source, want.days_since_update, want.last_note, want.needs_update], c.name);
  }
});
