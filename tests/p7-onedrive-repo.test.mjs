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
