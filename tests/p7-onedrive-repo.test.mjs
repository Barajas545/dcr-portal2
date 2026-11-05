// Part 4: site/js/repo/onedrive.js over a stub of supabase-js functions.invoke: the exact bodies it sends to the
// broker (DCR Desktop 2 docs/ONEDRIVE.md §15), how it reads the answers (a malformed entry never drawn, a link on
// another host never used), and how errors become codes and sentences (the gateway's own 404 vs the broker's
// not_found, the 503s by name - never their setting names -, 401, 403 with the broker's fixed sentence, no answer).
import test from "node:test";
import assert from "node:assert/strict";
import { useClient } from "../site/js/repo/_db.js";
import * as onedrive from "../site/js/repo/onedrive.js";

const HOST = onedrive.ONEDRIVE_HOST;
function stub(answer) {
  const calls = [];
  useClient({ functions: { invoke: async (name, o) => { calls.push({ name, body: o && o.body }); return answer(o && o.body, name); } } });
  return calls;
}
const ok = (data) => ({ data, error: null });
const http = (status, body, headers) => ({ data: null, error: { name: "FunctionsHttpError",
  context: new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: Object.assign({ "content-type": "application/json" }, headers || {}) }) } });
async function refusal(p) {
  try { await p; } catch (e) { return e; }
  assert.fail("expected a refusal");
}

test("repo/onedrive: the broker's contract - the exact bodies, ops and fields (§15)", async () => {
  const calls = stub((b) => {
    if (b.op === "list") return ok({ folder_exists: true, path: b.path || "", entries: [], next: null, can_upload: true, can_make_folder: false });
    if (b.op === "download") return ok({ url: "https://" + HOST + "/personal/x/_layouts/15/download.aspx?UniqueId=1&tempauth=t", name: "A1.pdf", size: 5 });
    if (b.op === "upload_session") return ok({ upload_url: "https://" + HOST + "/personal/x/_api/v2.0/uploadSession?guid=1", expires_at: "2026-10-25T00:00:00Z",
      chunk_bytes: 10485760, chunk_multiple: 327680, max_chunk_bytes: 62586880, max_bytes: 2147483648, ticket: "tk", name: "A1.pdf" });
    if (b.op === "upload_done") return ok({ recorded: true, already: false, renamed: false, name: "A1.pdf", size: 5, file: { id: 77, version_no: 1 } });
    if (b.op === "ensure_folder") return ok({ made_project_folder: false, created: [], existed: ["Floor Plans", "Photos", "Documents"], blocked: [] });
    if (b.op === "status") return ok({ ok: true, grant: "folder", checks: [{ name: "token", ok: true }] });
    return http(400, { error: "invalid" });
  });
  await onedrive.list("299");
  await onedrive.list(299, ["Floor Plans", "Level 1"], "cur1");
  await onedrive.download(299, "01ABCDEFGH");
  await onedrive.uploadSession({ projectId: 299, folder: "Floor Plans", relDir: "Level 1", name: "A1.pdf", size: 5, modified: new Date(Date.UTC(2026, 9, 1, 12)) });
  await onedrive.uploadSession({ projectId: 299, folder: "Documents", name: "B.pdf", size: 7 });
  await onedrive.uploadDone(299, "01ABCDEFGH", "tk");
  await onedrive.ensureFolder("299");
  await onedrive.status();
  assert.ok(calls.every((c) => c.name === "onedrive"));
  assert.deepEqual(calls.map((c) => c.body), [
    { op: "list", project_id: 299 },
    { op: "list", project_id: 299, path: "Floor Plans/Level 1", cursor: "cur1" },
    { op: "download", project_id: 299, item_id: "01ABCDEFGH" },
    { op: "upload_session", project_id: 299, folder: "Floor Plans", name: "A1.pdf", size: 5, rel_dir: "Level 1", modified: "2026-10-01T12:00:00.000Z" },
    { op: "upload_session", project_id: 299, folder: "Documents", name: "B.pdf", size: 7 },
    { op: "upload_done", project_id: 299, item_id: "01ABCDEFGH", ticket: "tk" },
    { op: "ensure_folder", project_id: 299 },
    { op: "status" },
  ]);
  // nothing is sent for a project that is not one, or an item id that is not one
  assert.equal((await refusal(onedrive.list("x1"))).code, "invalid");
  assert.equal((await refusal(onedrive.download(299, "../etc"))).code, "not_found");
  assert.equal((await onedrive.ensureFolder("")).state, "failed");
  assert.equal(calls.length, 8);
});

test("repo/onedrive: the answers as the page draws them - a malformed entry is left out; links only on the OneDrive host", async () => {
  stub((b) => {
    if (b.op === "list") {
      return ok({ folder_exists: true, path: "Floor Plans", next: "c2", can_upload: false, can_make_folder: true, entries: [
        { id: "01AAAAAAAA", name: "Level 1", folder: true, size: null, modified: null, children: 3 },
        { id: "01BBBBBBBB", name: "A1.pdf", folder: false, size: 2400000, modified: "2026-10-01T10:00:00Z", webUrl: "https://x", createdBy: { user: { email: "x@y" } } },
        { id: "bad id", name: "x.pdf" }, { id: "01CCCCCCCC", name: "" }, { id: "01DDDDDDDD", name: "a/b" }, null, "x",
      ] });
    }
    if (b.op === "download") {
      const urls = { "01EEEEEEEE": "https://evil.example.com/x", "01FFFFFFFF": "http://" + HOST + "/x", "01GGGGGGGG": "https://user:pw@" + HOST + "/x",
        "01HHHHHHHH": "https://" + HOST + ".evil.example/x", "01IIIIIIII": "javascript:alert(1)", "01JJJJJJJJ": "blob:https://evil.example/1" };
      return ok({ url: urls[b.item_id], name: "x", size: 1 });
    }
    if (b.op === "upload_session") return ok({ upload_url: "https://other-my.sharepoint.com/up", ticket: "t" });
    return ok({});
  });
  const page = await onedrive.list(9, "Floor Plans");
  assert.deepEqual(page.entries, [
    { id: "01AAAAAAAA", name: "Level 1", folder: true, size: null, modified: null, children: 3 },
    { id: "01BBBBBBBB", name: "A1.pdf", folder: false, size: 2400000, modified: "2026-10-01T10:00:00Z" },
  ], "only the contract's fields; no web link, no creator");
  assert.deepEqual([page.folderExists, page.next, page.canUpload, page.canMakeFolder], [true, "c2", false, true]);
  for (const id of ["01EEEEEEEE", "01FFFFFFFF", "01GGGGGGGG", "01HHHHHHHH", "01IIIIIIII", "01JJJJJJJJ"]) {
    assert.equal((await refusal(onedrive.download(9, id))).code, "bad_link", id);
  }
  assert.equal((await refusal(onedrive.uploadSession({ projectId: 9, folder: "Documents", name: "a.pdf", size: 1 }))).code, "bad_link");
  assert.ok(onedrive.linkOk("https://" + HOST + "/personal/x/download.aspx?x=1"));
  assert.ok(!onedrive.linkOk("https://" + HOST + ":8443/x"));
});

test("repo/onedrive: errors - the gateway's 404 is 'not deployed', the broker's 404 is not_found; 503s by name, never their words", async () => {
  const cases = [
    [http(404, { code: "NOT_FOUND", message: "Requested function was not found" }), "not_deployed", 404],
    [http(404, { error: "not_found", message: "That file or folder was not found." }), "not_found", 404],
    [http(503, { error: "onedrive_not_configured", message: "The OneDrive connection is not set up yet (missing: ONE_SETTING_NAME)." }), "not_configured", 503],
    [http(503, { error: "onedrive_not_authorized", message: "x" }), "not_authorized", 503],
    [http(503, { error: "busy", message: "x" }, { "Retry-After": "7" }), "busy", 503],
    [http(503, { error: "projects_root_missing", message: "x" }), "projects_root_missing", 503],
    [http(503, {}), "unavailable", 503],
    [http(401, { error: "unauthorized", message: "Sign in first." }), "auth", 401],
    [http(403, { error: "forbidden", message: "Uploading to OneDrive needs the \"Can upload to OneDrive\" switch (an admin turns it on)." }), "forbidden", 403],
    [http(403, { error: "not_downloadable", message: "Programs and shortcuts are not opened from the portal." }), "not_downloadable", 403],
    [http(409, { error: "other_folder", message: "m", count: 1 }), "other_folder", 409],
    [http(409, { error: "not_this_upload", message: "That file is not the one this upload made." }), "not_this_upload", 409],
    [http(413, { error: "too_large", message: "That file is too large to upload here.", max_bytes: 10 }), "too_large", 413],
    [http(415, { error: "file_type", message: "That kind of file cannot be uploaded here (PDFs, pictures, videos, Office files, text and CAD files can)." }), "file_type", 415],
    [http(400, { error: "invalid", message: "path has a name that ends with a space or a dot", field: "path" }), "invalid", 400],
    [http(500, { error: "server_error", message: "Something went wrong on our side. Try again in a few minutes." }), "server_error", 500],
    [http(502, "<html>bad gateway</html>"), "failed", 502],
    [{ data: null, error: { name: "FunctionsFetchError", context: new TypeError("Failed to fetch") } }, "offline", 0],
  ];
  for (const [answer, code, status] of cases) {
    stub(() => answer);
    const e = await refusal(onedrive.list(9));
    assert.deepEqual([e.code, e.status], [code, status], code);
    assert.ok(e.message && !/ONE_SETTING_NAME|missing:/.test(e.message), code + ": " + e.message);
  }
  stub(() => http(503, { error: "busy", message: "x" }, { "Retry-After": "7" }));
  assert.equal((await refusal(onedrive.list(9))).retryAfter, 7);
  stub(() => http(403, { error: "forbidden", message: "Uploading to OneDrive needs the \"Can upload to OneDrive\" switch (an admin turns it on)." }));
  assert.match((await refusal(onedrive.list(9))).message, /Can upload to OneDrive/, "the broker's fixed sentence");
  stub(() => http(400, { error: "invalid", message: "x", field: "cursor" }));
  assert.equal((await refusal(onedrive.list(9, "", "c"))).field, "cursor");
  stub(() => { throw new TypeError("network"); });
  assert.equal((await refusal(onedrive.list(9))).code, "offline");
});

test("repo/onedrive: ensureFolder never throws - each answer a state (New Project and the Files tab read it)", async () => {
  const states = [
    [ok({ made_project_folder: true, created: ["Floor Plans", "Photos", "Documents"], existed: [], blocked: [] }), "made"],
    [ok({ made_project_folder: false, created: ["Photos"], existed: ["Floor Plans", "Documents"], blocked: [] }), "made"],
    [ok({ made_project_folder: false, created: [], existed: ["Floor Plans", "Photos", "Documents"], blocked: [] }), "exists"],
    [http(409, { error: "other_folder", message: "m", count: 2, folders: ["A304 - one", "A304-x"] }), "other_folder"],
    [http(404, { code: "NOT_FOUND" }), "not_deployed"],
    [http(503, { error: "onedrive_not_configured" }), "not_configured"],
    [http(503, { error: "busy" }), "busy"],
    [http(403, { error: "forbidden", message: "no" }), "forbidden"],
    [{ data: null, error: { name: "FunctionsFetchError" } }, "offline"],
    [http(502, { error: "onedrive_failed", message: "OneDrive did not answer as expected. Try again in a few minutes." }), "failed"],
  ];
  for (const [answer, state] of states) {
    stub(() => answer);
    const r = await onedrive.ensureFolder(5);
    assert.equal(r.state, state, JSON.stringify(answer.data || state));
    if (state === "other_folder") assert.deepEqual([r.count, r.folders], [2, ["A304 - one", "A304-x"]]);
    if (state !== "made" && state !== "exists" && state !== "not_deployed") assert.ok(r.message, state + " says why");
  }
});

test("repo/onedrive: findFile pages through a folder for an upload whose last answer was lost (its name or OneDrive's rename, its size)", async () => {
  const pages = {
    "": { entries: [{ id: "01A0000001", name: "plan.pdf", folder: false, size: 10, modified: "2026-10-01T00:00:00Z" },
      { id: "01A0000002", name: "plan.pdf", folder: true, size: null, modified: null }], next: "p2" },
    p2: { entries: [{ id: "01A0000003", name: "plan 1.pdf", folder: false, size: 10, modified: "2026-10-02T00:00:00Z" },
      { id: "01A0000004", name: "plan 2.pdf", folder: false, size: 11, modified: "2026-10-03T00:00:00Z" },
      { id: "01A0000005", name: "plan copy.pdf", folder: false, size: 10, modified: "2026-10-04T00:00:00Z" }], next: null },
  };
  const calls = stub((b) => ok(Object.assign({ folder_exists: true, can_upload: true, can_make_folder: true }, pages[b.cursor || ""])));
  const found = await onedrive.findFile(9, ["Floor Plans"], "plan.pdf", 10);
  assert.deepEqual(found.map((e) => e.id), ["01A0000003", "01A0000001"], "newest first, only the name (or its rename) and the size");
  assert.deepEqual(calls.map((c) => c.body.cursor || null), [null, "p2"]);
});

test("repo/onedrive: LIVE is on since the go-live (2026-10-25); the self-test project still shows the self-test to an admin only", () => {
  assert.equal(onedrive.LIVE, true, "the Files tab's OneDrive part went live after the probe and the self-test (README)");
  assert.equal(onedrive.SELF_TEST_PROJECT, "A000T2");
  const admin = { role: "admin", active: true }, manager = { role: "manager", active: true };
  // live: every active person sees the project's OneDrive folder on every project (the database's rules decide the rest)
  assert.equal(onedrive.shownFor(admin, { internalIDNumber: "A000T2" }), true);
  assert.equal(onedrive.shownFor(admin, { internalIDNumber: "A267" }), true);
  assert.equal(onedrive.shownFor(manager, { internalIDNumber: "A000T2" }), true);
  assert.equal(onedrive.shownFor({ role: "field", active: false }, { internalIDNumber: "A253" }), false, "a turned-off account: never");
  // the self-test stays the admin's, on the test project only
  assert.equal(onedrive.selfTestFor(admin, { number: "A000T2" }), true);
  assert.equal(onedrive.selfTestFor(manager, { number: "A000T2" }), false);
  assert.equal(onedrive.selfTestFor(admin, { number: "A267" }), false);
  assert.equal(onedrive.selfTestFor({ role: "admin", active: false }, { number: "A000T2" }), false);
  assert.equal(onedrive.selfTestFor(admin, { number: "A000T2-B" }), false);
  assert.equal(onedrive.shownFor({ role: "agents", active: true }, { number: "A000T2" }), false);
});

/* ── the iPad's save back (owner decisions Q1-Q3, 2026-11-04; contract C1): plan_save_session / plan_save_done ── */

const PLAN = "01FAKEPLAN0001";
const UP = "https://" + HOST + "/personal/x/_api/v2.0/drives/d/items/i/uploadSession?guid=1";
const SESSION = { mode: "replace", upload_url: UP, expires_at: "2026-11-05T00:00:00Z", chunk_bytes: 10485760, chunk_multiple: 327680,
  max_chunk_bytes: 62586880, max_bytes: 4294967296, ticket: "v1.plan.sealed", name: "A900 Bid.takeoff" };
const DONE = { saved: true, mode: "replace", id: PLAN, name: "A900 Bid.takeoff", size: 2000, modified: "2026-11-04T18:30:00Z", version: "sm:2000:2026-11-04T18:30:00.000Z" };

test("repo/onedrive: planSaveSession / planSaveDone - the exact bodies (mode only when a copy is asked), upload_session's answer plus the mode, plans_list's file", async () => {
  const calls = stub((b) => (b.op === "plan_save_session" ? ok(SESSION) : b.op === "plan_save_done" ? ok(DONE) : http(400, { error: "invalid" })));
  const s = await onedrive.planSaveSession({ projectId: "7", itemId: PLAN, version: "qx:AAA", size: 2000, modified: new Date(Date.UTC(2026, 10, 4, 18)) });
  assert.deepEqual(s, { mode: "replace", uploadUrl: UP, ticket: "v1.plan.sealed", name: "A900 Bid.takeoff", chunkBytes: 10485760, chunkMultiple: 327680,
    maxChunkBytes: 62586880, maxBytes: 4294967296, expiresAt: "2026-11-05T00:00:00Z" });
  await onedrive.planSaveSession({ projectId: 7, itemId: PLAN, version: "sm:9:2026-11-04T18:00:00.000Z", size: 9, mode: "copy" });
  await onedrive.planSaveSession({ projectId: 7, itemId: PLAN, version: "qx:AAA", size: 9, modified: "not a time", mode: "replace" });
  const d = await onedrive.planSaveDone(7, PLAN, "v1.plan.sealed");
  assert.deepEqual(d, { saved: true, mode: "replace", id: PLAN, name: "A900 Bid.takeoff", size: 2000, modified: "2026-11-04T18:30:00Z",
    version: "sm:2000:2026-11-04T18:30:00.000Z" });
  assert.deepEqual(calls.map((c) => c.body), [
    { op: "plan_save_session", project_id: 7, item_id: PLAN, version: "qx:AAA", size: 2000, modified: "2026-11-04T18:00:00.000Z" },
    { op: "plan_save_session", project_id: 7, item_id: PLAN, version: "sm:9:2026-11-04T18:00:00.000Z", size: 9, mode: "copy" },
    { op: "plan_save_session", project_id: 7, item_id: PLAN, version: "qx:AAA", size: 9 },
    { op: "plan_save_done", project_id: 7, item_id: PLAN, ticket: "v1.plan.sealed" },
  ]);
  // nothing is sent for an item id that is not one, or a project that is not one
  assert.equal((await refusal(onedrive.planSaveSession({ projectId: 7, itemId: "../x", version: "qx:A", size: 1 }))).code, "not_found");
  assert.equal((await refusal(onedrive.planSaveSession({ projectId: "x", itemId: PLAN, version: "qx:A", size: 1 }))).code, "invalid");
  assert.equal((await refusal(onedrive.planSaveDone(7, "short", "t"))).code, "failed");
  assert.equal(calls.length, 4);
});

test("repo/onedrive: the save's upload address must be https on the owner's OneDrive host (linkOk), its ticket and mode the broker's; plan_save_done's answer must be a plan file", async () => {
  for (const url of ["https://evil.example.com/up", "http://" + HOST + "/up", "https://user:pw@" + HOST + "/up", "https://" + HOST + ".evil.example/up",
    "blob:http://localhost/1", "javascript:alert(1)", ""]) {
    stub(() => ok(Object.assign({}, SESSION, { upload_url: url })));
    assert.equal((await refusal(onedrive.planSaveSession({ projectId: 7, itemId: PLAN, version: "qx:A", size: 1 }))).code, "bad_link", url);
  }
  for (const bad of [{ ticket: "" }, { ticket: null }, { mode: "overwrite" }, { mode: undefined }]) {
    stub(() => ok(Object.assign({}, SESSION, bad)));
    assert.equal((await refusal(onedrive.planSaveSession({ projectId: 7, itemId: PLAN, version: "qx:A", size: 1 }))).code, "failed", JSON.stringify(bad));
  }
  for (const bad of [{ saved: false }, { mode: "x" }, { name: "A900 Bid.pdf" }, { id: "bad id" }, { version: "" }, { size: "2000" }, null]) {
    stub(() => ok(bad === null ? null : Object.assign({}, DONE, bad)));
    assert.equal((await refusal(onedrive.planSaveDone(7, PLAN, "t"))).code, "failed", JSON.stringify(bad));
  }
  stub(() => ok(Object.assign({}, DONE, { mode: "copy", id: "01FAKECOPY0001", name: "A900 Bid - iPad 2026-11-04 1030.takeoff", webUrl: "https://x" })));
  assert.deepEqual(await onedrive.planSaveDone(7, "01FAKECOPY0001", "t"), { saved: true, mode: "copy", id: "01FAKECOPY0001",
    name: "A900 Bid - iPad 2026-11-04 1030.takeoff", size: 2000, modified: "2026-11-04T18:30:00Z", version: "sm:2000:2026-11-04T18:30:00.000Z" }, "nothing more");
});

test("repo/onedrive: the save's errors - not_saved (send it again), too_large with its limit, forbidden naming the switch, the takeoff folder's grant still read-only; plan_changed is in the contract (plan_save_commit)", async () => {
  assert.ok(onedrive.CONTRACT.includes("not_saved") && onedrive.CONTRACT.includes("plan_changed"));
  const cases = [
    [http(409, { error: "not_saved", message: "OneDrive did not get the whole file - send it again." }), "not_saved", 409, /send it again/],
    [http(413, { error: "too_large", message: "That file is too large to upload here.", max_bytes: 4294967296 }), "too_large", 413, /too large/],
    [http(403, { error: "forbidden", message: "Saving a plan back needs the \"Can upload to OneDrive\" switch (an admin turns it on)." }), "forbidden", 403, /Can upload to OneDrive/],
    [http(404, { error: "not_found", message: "That file or folder was not found." }), "not_found", 404, /not found/],
    [http(503, { error: "onedrive_not_authorized", message: "Graph said: read only (ONEDRIVE_SECRET)" }), "not_authorized", 503, /not allowed in just now/],
    [http(503, { error: "takeoff_not_configured", message: "x" }), "takeoff_not_configured", 503, /takeoff folder is not set up/],
    [http(503, { error: "busy", message: "x" }, { "Retry-After": "60" }), "busy", 503, /busy/],
  ];
  for (const [answer, code, status, words] of cases) {
    stub(() => answer);
    const e = await refusal(onedrive.planSaveSession({ projectId: 7, itemId: PLAN, version: "qx:A", size: 1 }));
    assert.deepEqual([e.code, e.status], [code, status], code);
    assert.match(e.message, words, code);
    assert.ok(!/ONEDRIVE_SECRET|Graph said/.test(e.message), "a 503's own words never shown");
    const d = await refusal(onedrive.planSaveDone(7, PLAN, "t"));
    assert.equal(d.code, code, "done: " + code);
  }
  stub(() => http(413, { error: "too_large", message: "x", max_bytes: 4294967296 }));
  assert.equal((await refusal(onedrive.planSaveSession({ projectId: 7, itemId: PLAN, version: "qx:A", size: 1 }))).info.max_bytes, 4294967296);
});

const QXH = "PbG6uWfEwQF5DpbKoNh7NwBgQ+0=";
test("repo/onedrive (contract addendum 2): the plan's name to the session, commit 'broker' read for a replace only; plan_save_commit's exact body; the hash in its form only, to done and commit", async () => {
  const deferred = Object.assign({}, SESSION, { commit: "broker" });
  const calls = stub((b) => (b.op === "plan_save_session" ? ok(b.mode === "copy" ? Object.assign({}, deferred, { mode: "copy", name: "A900 Bid - iPad 2026-11-04 1030.takeoff" }) : deferred)
    : b.op === "plan_save_commit" || b.op === "plan_save_done" ? ok(DONE) : http(400, { error: "invalid" })));
  const s = await onedrive.planSaveSession({ projectId: 7, itemId: PLAN, version: "qx:AAA", size: 2000, name: "A900 Bid.takeoff" });
  assert.deepEqual(s, { mode: "replace", commit: "broker", uploadUrl: UP, ticket: "v1.plan.sealed", name: "A900 Bid.takeoff", chunkBytes: 10485760,
    chunkMultiple: 327680, maxChunkBytes: 62586880, maxBytes: 4294967296, expiresAt: "2026-11-05T00:00:00Z" });
  // a copy never carries commit "broker" (its last chunk commits it), whatever an answer says
  const c = await onedrive.planSaveSession({ projectId: 7, itemId: PLAN, version: "qx:AAA", size: 2000, mode: "copy", name: "A900 Bid.takeoff" });
  assert.equal(c.mode, "copy");
  assert.ok(!("commit" in c), "a copy is committed by its last chunk");
  // a name out of the broker's shape is not sent (the session goes on without it)
  await onedrive.planSaveSession({ projectId: 7, itemId: PLAN, version: "qx:AAA", size: 9, name: "x".repeat(256) });
  await onedrive.planSaveSession({ projectId: 7, itemId: PLAN, version: "qx:AAA", size: 9, name: "" });
  const m = await onedrive.planSaveCommit({ projectId: "7", itemId: PLAN, ticket: "v1.plan.sealed", uploadUrl: UP, hash: QXH });
  assert.deepEqual(m, { saved: true, mode: "replace", id: PLAN, name: "A900 Bid.takeoff", size: 2000, modified: "2026-11-04T18:30:00Z",
    version: "sm:2000:2026-11-04T18:30:00.000Z" });
  await onedrive.planSaveCommit({ projectId: 7, itemId: PLAN, ticket: "t", uploadUrl: UP, hash: "not a hash" });
  await onedrive.planSaveDone(7, PLAN, "t", QXH);
  await onedrive.planSaveDone(7, PLAN, "t", "AAAA");
  assert.deepEqual(calls.map((x) => x.body), [
    { op: "plan_save_session", project_id: 7, item_id: PLAN, version: "qx:AAA", size: 2000, name: "A900 Bid.takeoff" },
    { op: "plan_save_session", project_id: 7, item_id: PLAN, version: "qx:AAA", size: 2000, mode: "copy", name: "A900 Bid.takeoff" },
    { op: "plan_save_session", project_id: 7, item_id: PLAN, version: "qx:AAA", size: 9 },
    { op: "plan_save_session", project_id: 7, item_id: PLAN, version: "qx:AAA", size: 9 },
    { op: "plan_save_commit", project_id: 7, item_id: PLAN, ticket: "v1.plan.sealed", upload_url: UP, hash: QXH },
    { op: "plan_save_commit", project_id: 7, item_id: PLAN, ticket: "t", upload_url: UP },
    { op: "plan_save_done", project_id: 7, item_id: PLAN, ticket: "t", hash: QXH },
    { op: "plan_save_done", project_id: 7, item_id: PLAN, ticket: "t" },
  ]);
  // the upload address goes to the broker only when it is one this page uses (https on the owner's host)
  for (const url of ["https://evil.example.com/up", "http://" + HOST + "/up", "", null]) {
    assert.equal((await refusal(onedrive.planSaveCommit({ projectId: 7, itemId: PLAN, ticket: "t", uploadUrl: url }))).code, "bad_link", String(url));
  }
  assert.equal((await refusal(onedrive.planSaveCommit({ projectId: 7, itemId: "../x", ticket: "t", uploadUrl: UP }))).code, "not_found");
  assert.equal(calls.length, 8, "nothing sent for those");
  // the commit's answer is read as plan_save_done's (a copy of the same upload: its own id and name)
  stub(() => ok(Object.assign({}, DONE, { mode: "copy", id: "01FAKECOPY0001", name: "A900 Bid - iPad 2026-11-04 1030.takeoff" })));
  assert.deepEqual((await onedrive.planSaveCommit({ projectId: 7, itemId: PLAN, ticket: "t", uploadUrl: UP })).id, "01FAKECOPY0001");
  for (const bad of [{ saved: false }, { mode: "x" }, null]) {
    stub(() => ok(bad === null ? null : Object.assign({}, DONE, bad)));
    assert.equal((await refusal(onedrive.planSaveCommit({ projectId: 7, itemId: PLAN, ticket: "t", uploadUrl: UP }))).code, "failed", JSON.stringify(bad));
  }
});

test("repo/onedrive: plan_save_commit's errors - plan_changed with {retry: 'copy'} (send it again as a copy), not_saved, the ticket or the address refused (invalid, its field)", async () => {
  const cases = [
    [http(409, { error: "plan_changed", message: "OneDrive's plan changed while the save was sent: it is sent again as a separate file.", retry: "copy" }), "plan_changed", 409, /sent again as a separate file/],
    [http(409, { error: "not_saved", message: "OneDrive did not get the whole file - send it again." }), "not_saved", 409, /send it again/],
    [http(400, { error: "invalid", message: "That is not the upload URL of this save's session.", field: "upload_url" }), "invalid", 400, /upload URL/],
    [http(400, { error: "invalid", message: "This save's ticket is not valid or has run out: save the plan again.", field: "ticket" }), "invalid", 400, /ticket/],
  ];
  for (const [answer, code, status, words] of cases) {
    stub(() => answer);
    const e = await refusal(onedrive.planSaveCommit({ projectId: 7, itemId: PLAN, ticket: "t", uploadUrl: UP, hash: QXH }));
    assert.deepEqual([e.code, e.status], [code, status], code);
    assert.match(e.message, words, code);
    if (code === "plan_changed") assert.equal(e.info.retry, "copy", "the broker's word to send it again as a copy");
    if (code === "invalid") assert.ok(e.field === "upload_url" || e.field === "ticket", "its field");
  }
});

test("repo/onedrive (contract addendum 3): plan_save_commit's landed (only its true), verified on a replace's answer, plan_changed's why, not_saved's need, 503 save_back_off by name, and a broker without the op (400 invalid for the field op) is 'not deployed'", async () => {
  const calls = stub((b) => ok(Object.assign({}, DONE, { verified: b.landed === true })));
  const a = await onedrive.planSaveCommit({ projectId: 7, itemId: PLAN, ticket: "t", uploadUrl: UP, hash: QXH, landed: true });
  assert.equal(a.verified, true, "a replace's verified comes through");
  await onedrive.planSaveCommit({ projectId: 7, itemId: PLAN, ticket: "t", uploadUrl: UP, landed: "yes" });
  await onedrive.planSaveCommit({ projectId: 7, itemId: PLAN, ticket: "t", uploadUrl: UP });
  assert.deepEqual(calls.map((x) => x.body.landed), [true, undefined, undefined], "landed only when it is true (else the broker's default, false)");
  stub(() => ok(Object.assign({}, DONE, { mode: "copy", id: "01FAKECOPY0001", name: "A900 Bid - iPad 2026-11-04 1030.takeoff", verified: true })));
  assert.ok(!("verified" in (await onedrive.planSaveCommit({ projectId: 7, itemId: PLAN, ticket: "t", uploadUrl: UP }))), "a copy carries none");
  stub(() => ok(Object.assign({}, DONE, { verified: "yes" })));
  assert.ok(!("verified" in (await onedrive.planSaveCommit({ projectId: 7, itemId: PLAN, ticket: "t", uploadUrl: UP }))), "only a boolean");
  // the errors
  stub(() => http(409, { error: "plan_changed", message: "OneDrive would not replace the plan: the save is sent again as a separate file.", retry: "copy", why: "refused" }));
  const r = await refusal(onedrive.planSaveCommit({ projectId: 7, itemId: PLAN, ticket: "t", uploadUrl: UP }));
  assert.deepEqual([r.code, r.info.why, r.info.retry], ["plan_changed", "refused", "copy"]);
  stub(() => http(409, { error: "not_saved", message: "This save can be checked now only with the file's hash - send it again with the hash.", need: "hash" }));
  const n = await refusal(onedrive.planSaveDone(7, PLAN, "t"));
  assert.deepEqual([n.code, n.info.need], ["not_saved", "hash"]);
  assert.ok(onedrive.CONTRACT.includes("save_back_off"), "the broker's code since addendum 3 (D1)");
  stub(() => http(503, { error: "save_back_off", message: "Saving plans back to OneDrive is not on yet - your save waits on this device." }));
  const off = await refusal(onedrive.planSaveSession({ projectId: 7, itemId: PLAN, version: "qx:AAA", size: 9 }));
  assert.deepEqual([off.code, off.status], ["save_back_off", 503], "by name (never 'unavailable': the uploader would ask again in a minute)");
  stub(() => http(400, { error: "invalid", message: "op must be one of list, download, upload_session", field: "op" }));
  const old = await refusal(onedrive.planSaveSession({ projectId: 7, itemId: PLAN, version: "qx:AAA", size: 9 }));
  assert.deepEqual([old.code, old.status, old.field], ["not_deployed", 400, "op"], "a broker older than this page (D6)");
  assert.ok(!/list, download/.test(old.message), "never the broker's list of ops");
  stub(() => http(400, { error: "invalid", message: "name must be the plan's file name (at most 255 characters)", field: "name" }));
  assert.equal((await refusal(onedrive.planSaveSession({ projectId: 7, itemId: PLAN, version: "qx:AAA", size: 9 }))).code, "invalid", "any other field: invalid, as before");
});
