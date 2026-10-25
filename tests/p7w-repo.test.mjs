// Part 3: what the data modules send — the Access tab's admin_set_profile (site/js/repo/employees.js), New Project's
// create_project fields and the picture's pointer (repo/projects.js), the picture's Storage object and files row and
// soft_delete (repo/files.js), the cost writes and line choices (repo/ledger.js), the OneDrive function's one call
// (repo/onedrive.js) and the sign-in's column ladder (sb.js) — over a small recording stub client. Made-up rows only.
import test from "node:test";
import assert from "node:assert/strict";

import { useClient } from "../site/js/repo/_db.js";
import * as employees from "../site/js/repo/employees.js";
import * as projects from "../site/js/repo/projects.js";
import * as files from "../site/js/repo/files.js";
import * as ledger from "../site/js/repo/ledger.js";
import * as onedrive from "../site/js/repo/onedrive.js";
import { PROFILE_SELECTS, isMissingColumn, shapeProfile } from "../site/js/sb.js";

/** A recording client: every call in `calls`; answers from `on` ({table|rpc|storage|invoke: fn}) or the tables. */
function stub(tables, on) {
  const T = tables || {};
  const H = on || {};
  const calls = [];
  function Q(t) { this.t = t; this.op = "select"; this.cols = "*"; this.f = []; this.body = null; this.ret = false; }
  Q.prototype.select = function (c) { if (this.op === "select") this.cols = c; else { this.ret = true; this.cols = c; } return this; };
  Q.prototype.insert = function (b) { this.op = "insert"; this.body = b; return this; };
  Q.prototype.update = function (b) { this.op = "update"; this.body = b; return this; };
  ["eq", "in", "is", "gte", "lte"].forEach((op) => { Q.prototype[op] = function (c, v) { this.f.push([op, c, v]); return this; }; });
  Q.prototype.order = function () { return this; };
  Q.prototype.range = function (a, b) { this.range_ = [a, b]; return this; };
  Q.prototype.then = function (ok, bad) {
    const call = { table: this.t, op: this.op, cols: this.cols, filters: this.f, body: this.body };
    calls.push(call);
    let res;
    try {
      if (H[this.t]) res = H[this.t](call, T);
      else {
        const rows = (T[this.t] || []).filter((r) => this.f.every(([op, c, v]) => op !== "eq" || String(r[c]) === String(v)));
        if (this.op === "update") {
          const hit = rows.filter(() => true);
          hit.forEach((r) => { Object.assign(r, this.body); r.version = Number(r.version || 1) + 1; });
          res = { data: hit.map((r) => Object.assign({}, r)), error: null };
        } else if (this.op === "insert") {
          const r = Object.assign({ id: 900 + calls.length, version: 1 }, this.body);
          (T[this.t] = T[this.t] || []).push(r);
          res = { data: [Object.assign({}, r)], error: null };
        } else res = { data: (this.range_ && this.range_[0] > 0) ? [] : rows.map((r) => Object.assign({}, r)), error: null };
      }
    } catch (e) { return Promise.reject(e).then(ok, bad); }
    return Promise.resolve(res).then(ok, bad);
  };
  const c = {
    calls,
    from: (t) => new Q(t),
    rpc: (name, args) => {
      calls.push({ rpc: name, args });
      const h = H["rpc:" + name];
      return Promise.resolve(h ? h(args, T) : { data: null, error: { code: "PGRST202", message: "no such function " + name } });
    },
    storage: { from: (bucket) => ({ upload: (key, body, o) => { calls.push({ upload: key, bucket, size: body.size, opts: o }); return Promise.resolve(H.upload ? H.upload(key) : { data: { path: key }, error: null }); } }) },
    functions: { invoke: (name, o) => { calls.push({ invoke: name, body: o && o.body }); return Promise.resolve(H.invoke ? H.invoke(o && o.body) : { data: {}, error: null }); } },
  };
  useClient(c);
  return c;
}
const httpError = (status, body) => ({ data: null, error: { name: "FunctionsHttpError", context: new Response(JSON.stringify(body), { status }) } });

/* ── the sign-in ── */
test("sign-in: the switches are read when the database has them; without them (or before M1) the next list is asked, never an error", () => {
  assert.match(PROFILE_SELECTS[0], /,can_estimate,can_upload_onedrive,must_change_password$/);
  assert.ok(!/can_estimate/.test(PROFILE_SELECTS[1]) && /must_change_password/.test(PROFILE_SELECTS[1]));
  assert.ok(!/must_change_password|can_estimate/.test(PROFILE_SELECTS[2]));
  assert.ok(isMissingColumn({ code: "42703", message: "column profiles.can_estimate does not exist" }));
  assert.ok(isMissingColumn({ code: "", message: "Could not find the 'can_upload_onedrive' column" }));
  assert.ok(!isMissingColumn({ code: "42501", message: "permission denied" }));
  const m = shapeProfile({ id: "u", role: "manager", can_estimate: true });
  assert.deepEqual([m.can_estimate, m.can_upload_onedrive], [true, false]);
  const a = shapeProfile({ id: "a", role: "admin" });
  assert.deepEqual([a.can_estimate, a.can_upload_onedrive], [true, true], "an admin always");
});

/* ── the Access tab ── */
test("listAccess: everyone but the agents account, by name, with the switches; a database without them answers ready:false", async () => {
  const rows = [{ id: "b", full_name: "Bea Lead", role: "lead" }, { id: "z", full_name: "", role: "agents" }, { id: "a", full_name: "Avery Admin", role: "admin" }];
  let c = stub({ profiles: rows });
  let got = await employees.listAccess();
  assert.deepEqual([got.ready, got.rows.map((r) => r.id)], [true, ["a", "b"]]);
  assert.equal(c.calls[0].cols, employees.ACCESS_COLS);
  for (const k of ["can_see_prices", "can_estimate", "can_upload_onedrive", "version"]) assert.ok(employees.ACCESS_COLS.includes(k), k);
  let n = 0;
  c = stub({ profiles: rows }, { profiles: (call, T) => (++n === 1 ? { data: null, error: { code: "42703", message: "column profiles.can_estimate does not exist" } } : { data: T.profiles, error: null }) });
  got = await employees.listAccess();
  assert.equal(got.ready, false);
  assert.ok(!/can_estimate/.test(c.calls[1].cols), "asked again without the new columns");
  assert.equal(got.rows.length, 2);
});

test("setAccess: rpc admin_set_profile(p_id, p_switches, p_version) with only the Access tab's three switches", async () => {
  const c = stub({}, { "rpc:admin_set_profile": (a) => ({ data: { id: a.p_id, role: "manager", can_estimate: true, version: 5 }, error: null }) });
  const row = await employees.setAccess({ id: "u-m", version: 4 }, { can_estimate: true, can_see_prices: true });
  assert.deepEqual(c.calls[0], { rpc: "admin_set_profile", args: { p_id: "u-m", p_switches: { can_estimate: true, can_see_prices: true }, p_version: 4 } });
  assert.equal(row.version, 5);
  await assert.rejects(employees.setAccess({ id: "u-m", version: 4 }, { can_see_financials: true }), /not a switch/, "financials stay in Desktop 2");
  await assert.rejects(employees.setAccess({ id: "u-m", version: 4 }, { role: "admin" }), /not a switch/);
  const same = { id: "u-m", version: 4 };
  assert.equal(await employees.setAccess(same, {}), same, "nothing to send");
  assert.equal(c.calls.length, 1);
});

/* ── New Project and the picture ── */
test("createProject: the dialog's fields as they are (blank text left out), the old modal's keys still map, anything else throws", async () => {
  const c = stub({}, { "rpc:create_project": (a) => ({ data: Object.assign({ id: 31, number: "A306", status: "new_request", version: 1 }, a.fields), error: null }) });
  const p = await projects.createProject({ name: " Hillside ", city: "Oak Vista", state: "CA", zip: "", status: "estimating", rate_source: "local", scope: " Deck " });
  assert.deepEqual(c.calls[0].args, { fields: { name: "Hillside", city: "Oak Vista", state: "CA", status: "estimating", rate_source: "local", scope: "Deck" } });
  assert.equal(p.internalIDNumber, "A306");
  await projects.createProject({ projectName: "Old", projectAddress: "1 Sandbox Rd", projectCity: "" });
  assert.deepEqual(c.calls[1].args, { fields: { name: "Old", address: "1 Sandbox Rd" } });
  await projects.createProject({ name: "Rate", rate_source: "custom", labor_rate: "95.555" });
  assert.deepEqual(c.calls[2].args.fields, { name: "Rate", rate_source: "custom", labor_rate: 95.56 });
  await assert.rejects(projects.createProject({ name: "X", tags: ["ADU"] }), /unknown project field/);
  await assert.rejects(projects.createProject({ name: "X", lat: 35 }), /unknown project field/);
  await assert.rejects(projects.createProject({ name: " " }), (e) => e.code === "22023");
});

test("setThumbnail: one column, versioned; someone else's change meanwhile -> sent once more at their version", async () => {
  const T = { projects: [{ id: 7, number: "A267", name: "Sandbox", version: 5, thumbnail_file_id: null }] };
  let c = stub(T);
  let p = await projects.setThumbnail({ id: 7, version: 5 }, 41);
  assert.deepEqual(c.calls[0].body, { thumbnail_file_id: 41 });
  assert.deepEqual(c.calls[0].filters, [["eq", "id", 7], ["eq", "version", 5]]);
  assert.equal(p.thumbnailFileId, 41);
  // stale: the first PATCH matches nothing, the re-read says version 6 -> once more at 6
  T.projects[0].version = 6;
  c = stub(T, { projects: (call, t) => {
    if (call.op === "update" && call.filters.some((f) => f[1] === "version" && Number(f[2]) !== t.projects[0].version)) return { data: [], error: null };
    if (call.op === "update") { Object.assign(t.projects[0], call.body); t.projects[0].version += 1; return { data: [Object.assign({}, t.projects[0])], error: null }; }
    return { data: [Object.assign({}, t.projects[0])], error: null };
  } });
  p = await projects.setThumbnail({ id: 7, version: 5 }, null);
  const ups = c.calls.filter((x) => x.op === "update");
  assert.equal(ups.length, 2);
  assert.deepEqual(ups[1].filters, [["eq", "id", 7], ["eq", "version", 6]]);
  assert.deepEqual(ups[1].body, { thumbnail_file_id: null });
  assert.equal(p.thumbnailFileId, null);
});

test("addThumbnail: straight to Storage at p/{project}/thumbnail/{uuid}/thumbnail.jpg (never overwriting), then its files row; removeFile: soft_delete", async () => {
  const c = stub({}, { "rpc:soft_delete": () => ({ data: null, error: null }) });
  const blob = new Blob([new Uint8Array(2048)], { type: "image/jpeg" });
  const row = await files.addThumbnail(7, { blob, mime: "image/jpeg", ext: ".jpg" });
  const up = c.calls[0];
  assert.match(up.upload, /^p\/7\/thumbnail\/[0-9a-f]{32}\/thumbnail\.jpg$/);
  assert.deepEqual(up.opts, { upsert: false, contentType: "image/jpeg", cacheControl: "3600" });
  assert.deepEqual(c.calls[1].body, { project_id: 7, folder: "thumbnail", subpath: "", name: "thumbnail.jpg", storage_path: up.upload, size: 2048,
    mime: "image/jpeg", source: "portal2" });
  await files.addThumbnail("7", { blob: new Blob([new Uint8Array(10)], { type: "image/png" }), mime: "image/png", ext: ".png" });
  assert.match(c.calls[2].upload, /\/thumbnail\.png$/);
  assert.equal(c.calls[3].body.mime, "image/png");
  await files.removeFile({ id: row.id, version: 1 });
  assert.deepEqual(c.calls[4], { rpc: "soft_delete", args: { tbl: "files", id: row.id, version: 1 } });
  stub({}, { upload: () => ({ data: null, error: { statusCode: "403", message: "new row violates row-level security policy" } }) });
  await assert.rejects(files.addThumbnail(7, { blob, mime: "image/jpeg" }), (e) => e.code === "42501" && /permission/.test(e.message));
  await assert.rejects(files.addThumbnail(7, { blob: new Blob([]), mime: "image/jpeg" }), (e) => e.code === "22023");
});

/* ── costs ── */
test("costs: addCost inserts only COST_WRITE columns (never a stamp, reconciled or employee); updateCost is versioned and never moves a cost", async () => {
  const c = stub({ costs: [{ id: 5, project_id: 268, kind: "material", amount: 10, version: 2 }] });
  await ledger.addCost({ project_id: "268", kind: "labor", cost_date: "2026-10-20", amount: 83.33, hours: 2.5, rate: 33.33, estimate_item_id: "77", card: "card-amex", description: "Felipe - framing" });
  const ins = c.calls[0];
  assert.equal(ins.op, "insert");
  assert.equal(ins.body.project_id, 268);
  assert.equal(ins.body.estimate_item_id, 77);
  for (const k of Object.keys(ins.body)) assert.ok(ledger.COST_WRITE.includes(k), k);
  assert.equal(ins.cols, ledger.COST_COLS);
  await assert.rejects(ledger.addCost({ project_id: 268, kind: "other", amount: 1, card_by: "u" }), /not a cost column/);
  await assert.rejects(ledger.addCost({ project_id: 268, kind: "other", amount: 1, reconciled_at: "now" }), /not a cost column/);
  await assert.rejects(ledger.addCost({ kind: "other", amount: 1 }), (e) => e.code === "22023");
  await ledger.updateCost({ id: 5, version: 2 }, { amount: -12.5, hours: null });
  const up = c.calls.find((x) => x.op === "update");
  assert.deepEqual(up.body, { amount: -12.5, hours: null });
  assert.deepEqual(up.filters, [["eq", "id", 5], ["eq", "version", 2]]);
  await assert.rejects(ledger.updateCost({ id: 5, version: 3 }, { project_id: 300 }), /not a cost column/);
  const same = { id: 5, version: 3 };
  assert.equal(await ledger.updateCost(same, {}), same);
  const raw = await ledger.getCost(5);
  assert.equal(raw.id, 5);
});

test("lineChoices: the project's live lines of live, unarchived estimates, estimates first then change orders, Desktop 2's label", async () => {
  const P = (o) => Object.assign({ project_id: 268 }, o);
  stub({
    estimates: [P({ id: 1, kind: "estimate", number: 1, name: "Main" }), P({ id: 2, kind: "change_order", number: 2, co_number: 1 }),
      P({ id: 3, kind: "estimate", number: 3, archived_at: "2026-10-01T00:00:00Z" }), P({ id: 4, kind: "estimate", number: 4, deleted_at: "x" }),
      { id: 5, project_id: 300, kind: "estimate", number: 1 }],
    estimate_items: [P({ id: 12, estimate_id: 2, name: "Extra beam", group_name: "Framing", sort: 1 }), P({ id: 11, estimate_id: 1, name: "Walls", group_name: "Framing", sort: 2 }),
      P({ id: 10, estimate_id: 1, name: "Layout", group_name: "Framing", sort: 1 }), P({ id: 13, estimate_id: 3, name: "Old" }), P({ id: 14, estimate_id: 4, name: "Gone" }),
      P({ id: 15, estimate_id: 1, name: "Dropped", deleted_at: "x" }), { id: 16, project_id: 300, estimate_id: 5, name: "Another job's" }],
  });
  const got = await ledger.lineChoices(268);
  assert.deepEqual(got, [{ id: 10, label: "Framing — Layout" }, { id: 11, label: "Framing — Walls" }, { id: 12, label: "CO #1 · Framing — Extra beam" }]);
});

/* ── OneDrive (the folder step) ── */
test("onedrive.ensureFolder: op ensure_folder with the project's id; made / exists / not deployed / not configured / another folder / offline", async () => {
  let c = stub({}, { invoke: () => ({ data: { created: ["A306 - x"], existed: [] }, error: null }) });
  assert.deepEqual(await onedrive.ensureFolder("31"), { state: "made", message: "" });
  assert.deepEqual(c.calls[0], { invoke: "onedrive", body: { op: "ensure_folder", project_id: 31 } });
  stub({}, { invoke: () => ({ data: { created: [], existed: ["A306 - x"] }, error: null }) });
  assert.equal((await onedrive.ensureFolder(31)).state, "exists");
  stub({}, { invoke: () => httpError(404, { code: "NOT_FOUND", message: "Requested function was not found" }) });
  assert.deepEqual(await onedrive.ensureFolder(31), { state: "not_deployed", message: "" }, "the gateway's 404: quiet");
  stub({}, { invoke: () => httpError(404, { error: "not_found", message: "no such project" }) });
  assert.equal((await onedrive.ensureFolder(31)).state, "failed", "the broker's own 404 is not 'not deployed'");
  stub({}, { invoke: () => httpError(503, { error: "onedrive_not_configured", message: "ONEDRIVE_CLIENT_ID missing" }) });
  assert.equal((await onedrive.ensureFolder(31)).state, "not_configured");
  stub({}, { invoke: () => httpError(409, { error: "other_folder", message: "x" }) });
  const other = await onedrive.ensureFolder(31);
  assert.equal(other.state, "other_folder");
  assert.match(other.message, /Desktop 2/);
  stub({}, { invoke: () => ({ data: null, error: { name: "FunctionsFetchError", context: new TypeError("Failed to fetch") } }) });
  assert.equal((await onedrive.ensureFolder(31)).state, "offline");
  stub({}, { invoke: () => httpError(403, { error: "forbidden", message: "x" }) });
  assert.equal((await onedrive.ensureFolder(31)).state, "forbidden");
  c = stub({});
  assert.equal((await onedrive.ensureFolder("A306")).state, "failed");
  assert.equal(c.calls.length, 0, "a project id only");
});
