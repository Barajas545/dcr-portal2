// The money mask and money format against DCR Desktop 2's own answers (tests/vectors/*.json are
// computed by dcrdesk/domain/money.py; see the "source" field in each file).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { maskAmounts, fmtMoney, parseMoney, HIDDEN_AMOUNT } from "../site/js/money-mask.js";

const vec = (name) => JSON.parse(readFileSync(new URL("./vectors/" + name, import.meta.url), "utf8"));

test("maskAmounts matches Desktop 2's mask_amounts on every shared vector", () => {
  const { cases } = vec("money-mask.json");
  assert.ok(cases.length >= 40);
  for (const c of cases) assert.equal(maskAmounts(c.in), c.out, JSON.stringify(c.in));
});

test("maskAmounts: null and non-strings", () => {
  assert.equal(maskAmounts(null), "");
  assert.equal(maskAmounts(undefined), "");
  assert.equal(maskAmounts(12), "12");
  assert.equal(maskAmounts("$5"), HIDDEN_AMOUNT);
});

test("maskAmounts is stable when run twice (masked text has no amount left)", () => {
  for (const c of vec("money-mask.json").cases) assert.equal(maskAmounts(maskAmounts(c.in)), c.out);
});

test("fmtMoney matches Desktop 2's fmt (half-up on the decimal text)", () => {
  for (const c of vec("file-names.json").money_fmt) assert.equal(fmtMoney(c.in), c.out, JSON.stringify(c.in));
});

test("parseMoney reads display strings and refuses spreadsheet errors", () => {
  assert.equal(parseMoney("$1,234.50"), 1234.5);
  assert.equal(parseMoney("(12.50)"), -12.5);
  assert.equal(parseMoney("#DIV/0!"), null);
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney(true), null);
  assert.equal(fmtMoney(null, true), "—");
  assert.equal(fmtMoney(0, true), "—");
});
