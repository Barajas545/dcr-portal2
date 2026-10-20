// The error mapping of BLUEPRINT 2.2.3 (DCR Desktop 2's backend/errors.py), ?next= and money display.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapError, errorText, sentence, safeNext, money, shownText, DCR2 } from "../site/js/common2.js";
import { isNetworkError } from "../site/js/sb.js";

const cases = [
  // [error, status, kind, message (or regex)]
  [{ code: "42501", message: 'new row violates row-level security policy for table "projects"' }, 403, "forbidden", "You don't have permission to do that."],
  [{ code: "42501", message: "permission denied for table projects" }, 403, "forbidden", "You don't have permission to do that."],
  [{ code: "42501", message: "only an admin can change a project number" }, 403, "forbidden", "Only an admin can change a project number."],
  [{ code: "PT404", message: "record not found" }, 404, "notfound", "That record no longer exists."],
  [{ code: "PT404", message: "project not found" }, 404, "notfound", "Project not found."],
  [{ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, 404, "notfound", "That record no longer exists."],
  [{ code: "PT409", message: "the record was changed by someone else", details: '{"table":"projects","id":4,"version":7}' }, 409, "conflict", "The record was changed by someone else."],
  [{ code: "23505", message: 'duplicate key value violates unique constraint "projects_number_key"' }, 409, "validation", "That value is already used by another record."],
  [{ code: "23514", message: 'new row for relation "projects" violates check constraint "projects_name_check"' }, 400, "validation", "One of the values is not allowed."],
  [{ code: "23514", message: "the journal entry belongs to another project" }, 400, "validation", "The journal entry belongs to another project."],
  [{ code: "P0001", message: "the bill is void" }, 400, "validation", "The bill is void."],
  [{ code: "22023", message: "unknown field: colour" }, 400, "validation", "Unknown field: colour."],
  [{ code: "23503", message: 'insert or update on table "activity" violates foreign key constraint' }, 400, "validation", /still in use/],
  [{ code: "23502", message: 'null value in column "project_id" violates not-null constraint' }, 400, "validation", "A required value is missing."],
  [{ code: "PGRST301", message: "JWT expired" }, 401, "auth", "Your sign-in has expired. Please sign in again."],
  [{ code: "PGRST202", message: "Could not find the function public.password_changed" }, 500, "schema", /do not match/],
  [{ code: "42703", message: "column profiles.must_change_password does not exist" }, 500, "schema", /do not match/],
  [{ code: "PGRST002", message: "Could not query the database for the schema cache", status: 503 }, 503, "offline", /not answering/],
  [{ code: "", message: "TypeError: Failed to fetch", details: "", hint: "", status: 0 }, 0, "offline", /Can't reach the server/],
  [new TypeError("Failed to fetch"), 0, "offline", /Can't reach the server/],
  [{ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }, 0, "offline", /Can't reach the server/],
  [{ name: "AuthApiError", code: "invalid_credentials", status: 400, message: "Invalid login credentials" }, 400, "auth", "Wrong e-mail address or password."],
  [{ name: "AuthApiError", code: "user_banned", status: 400, message: "User is banned" }, 400, "auth", "This account has been turned off. Ask an admin."],
  [{ name: "AuthApiError", code: "over_request_rate_limit", status: 429, message: "rate limit" }, 429, "busy", /Too many attempts/],
  [{ name: "AuthWeakPasswordError", code: "weak_password", status: 422, message: "Password should be at least 10 characters" }, 422, "validation", /too weak|Password should/],
  [{ code: "account_inactive", message: "This account is not active. Ask the office.", status: 403 }, 403, "auth", "This account is not active. Ask the office."],
  [{ statusCode: "409", status: 400, message: "The resource already exists", name: "StorageApiError" }, 400, "validation", "The resource already exists."],
  [{ status: 413, message: "Payload too large" }, 413, "validation", /larger than the DCR file storage/],
  [{ status: 540, message: "" }, 540, "offline", /paused/],
  [{ status: 429, message: "" }, 429, "busy", /busy/],
  [null, 500, "error", "The server could not do that."],
];

test("every database, auth, storage and network error becomes a sentence for people", () => {
  for (const [err, status, kind, msg] of cases) {
    const m = mapError(err);
    const label = JSON.stringify(err && (err.code || err.name || err.status));
    assert.equal(m.kind, kind, label + " kind");
    assert.equal(m.status, status, label + " status");
    if (msg instanceof RegExp) assert.match(m.message, msg, label);
    else assert.equal(m.message, msg, label);
    assert.equal(m.retryable, kind === "offline" || kind === "busy");
  }
  assert.equal(errorText({ code: "PT404" }), "That record no longer exists.");
});

test("network errors are recognised (they never sign anyone out)", () => {
  assert.ok(isNetworkError(new TypeError("Failed to fetch")));
  assert.ok(isNetworkError({ message: "NetworkError when attempting to fetch resource." }));
  assert.ok(isNetworkError({ message: "Load failed" }));
  assert.ok(isNetworkError({ name: "AuthRetryableFetchError" }));
  assert.ok(isNetworkError({ status: 503 }));
  assert.ok(!isNetworkError({ status: 400, code: "invalid_credentials" }));
  assert.ok(!isNetworkError({ code: "42501", message: "permission denied" }));
  assert.ok(!isNetworkError(null));
});

test("sentence", () => {
  assert.equal(sentence("the bill is void"), "The bill is void.");
  assert.equal(sentence("  two   spaces!  "), "Two spaces!");
  assert.equal(sentence(""), "");
});

test("?next= accepts only a bare page of this site", () => {
  assert.equal(safeNext("my-tasks.html%3Ftask%3D12"), "my-tasks.html?task=12");
  assert.equal(safeNext("timesheet-mobile.html%3Fdate%3D2026-10-19"), "timesheet-mobile.html?date=2026-10-19");
  assert.equal(safeNext("project.html%3Fid%3D268%26tab%3Dlog"), "project.html?id=268&tab=log");
  assert.equal(safeNext("board.html"), "board.html");
  for (const bad of ["https%3A%2F%2Fevil.example%2F", "//evil.example/x.html", "index.html", "change-password.html",
    "javascript:alert(1)", "../x.html", "x.html#frag", "%E0%A4%A", "", null, "Board.html", "a/b.html", "x.html?<script>"]) {
    assert.equal(safeNext(bad), "dashboard.html", String(bad));
  }
  assert.equal(safeNext("nope", "board.html"), "board.html");
});

test("money: a dash without the prices switch or for a hidden (null) price", () => {
  const keep = DCR2.profile;
  try {
    DCR2.profile = { role: "lead", can_see_prices: false };
    assert.equal(money(1234.5), "—");
    assert.equal(shownText("Quoted $1,250 to the client"), "Quoted (amount hidden) to the client");
    DCR2.profile = { role: "manager", can_see_prices: true };
    assert.equal(money(1234.5), "$1,234.50");
    assert.equal(money(null), "—");
    assert.equal(money(0), "$0.00");
    assert.equal(shownText("Quoted $1,250"), "Quoted $1,250");
    DCR2.profile = { role: "admin", can_see_prices: false };
    assert.equal(money(90), "$90.00", "an admin always sees prices");
    DCR2.profile = null;
    assert.equal(money(90), "—", "nobody known: hidden");
    assert.equal(money(90, { prices: true }), "$90.00");
  } finally {
    DCR2.profile = keep;
  }
});
