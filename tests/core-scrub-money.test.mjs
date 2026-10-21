// The scrub rule of text written for everybody (site/js/scrub-money.js) against the shared vectors: the old portal's
// scrubMoney, which DCR Desktop 2's database keeps as app.scrub_money (tests/vectors/scrub-money.json is DCR Desktop 2's
// own copy of the vectors, computed by the old code; see its "source" field).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scrubMoney } from "../site/js/scrub-money.js";

const vec = JSON.parse(readFileSync(new URL("./vectors/scrub-money.json", import.meta.url), "utf8"));

test("scrubMoney = app.scrub_money on every shared vector", () => {
  assert.ok(vec.cases.length >= 150, "the vectors: " + vec.cases.length);
  for (const c of vec.cases) assert.equal(scrubMoney(c.in), c.out, JSON.stringify(c.in));
});

test("scrubMoney: null and undefined read as an empty text; an item name keeps its words", () => {
  assert.equal(scrubMoney(null), "");
  assert.equal(scrubMoney(undefined), "");
  assert.equal(scrubMoney("Exterior walls 2x6 (credit asked $1,200)"), "Exterior walls 2x6 (credit asked [amount])");
  assert.equal(scrubMoney("Shear walls $1,250 extra"), "Shear walls [amount] extra");
});
