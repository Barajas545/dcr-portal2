// Part 4 (the Files tab's OneDrive part) over the demo database: tools/fake/p7-onedrive.js - the OneDrive broker's
// stand-in and the made-up OneDrive behind it - reached through site/js/repo/onedrive.js and site/js/onedrive-upload.js
// exactly as the page reaches them, as each role. The REAL broker and database rules: DCR Desktop 2
// supabase/functions/onedrive/*_test.ts and tools/schema-check-p7-onedrive.mjs. Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { available, loadFake, freshEngine, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as onedrive from "../site/js/repo/onedrive.js";
import * as filesRepo from "../site/js/repo/files.js";
import { createUploader } from "../site/js/onedrive-upload.js";
import { CHUNK_UNIT } from "../site/js/map/onedrive.js";

const skip = !available && "the demo database (tools/fake) is not here";
let F, E;
async function setup() {
  F = await loadFake();
  E = await freshEngine(new Date());
}
const id = (key) => F.PEOPLE.find((p) => p.key === key).id;
const ext = () => E.exts.find((x) => x.name === "p7-onedrive");
const project = (number) => E.rows.projects.find((p) => p.number === number);
function as(key) {
  const c = clientAs(E, key ? id(key) : null);
  const calls = [];
  useClient({ from: c.from, rpc: c.rpc, storage: c.storage,
    functions: { invoke: (name, o) => { calls.push([name, o && o.body]); return c.functions.invoke(name, o); } } });
  return calls;
}
async function refusal(p) {
  try { await p; } catch (e) { return e; }
  assert.fail("expected a refusal");
}
/** the page's uploader over the demo: the stub's upload URL answered by its own http() (no network) */
function uploader(sent) {
  return createUploader({
    send: async (req) => {
      const h = Object.assign({}, req.headers);
      if (sent) sent.push({ method: req.method, url: req.url, headers: h, size: req.body ? req.body.size : 0 });
      const r = ext().http(req.method, req.url, h, req.body);
      return { status: r.status, header: (n) => r.headers[String(n).toLowerCase()] || null, text: () => (typeof r.body === "string" ? r.body : "") };
    },
    broker: {
      session: (j) => onedrive.uploadSession({ projectId: j.projectId, folder: j.folder, relDir: j.relDir, name: j.name, size: j.size }),
      done: (j, itemId, ticket) => onedrive.uploadDone(j.projectId, itemId, ticket),
      find: (j) => onedrive.findFile(j.projectId, [j.folder].concat(j.relDir ? j.relDir.split("/") : []), j.target || j.name, j.size),
    },
    setTimeout: (fn) => setTimeout(fn, 0),
  });
}
function settle(up) {
  return new Promise((resolve) => {
    const check = () => (up.active() ? setTimeout(check, 5) : resolve(up.list()));
    check();
  });
}

test("demo OneDrive: every active person lists the project's folder; hidden names never come, by switch", { skip }, async () => {
  await setup();
  const sandbox = project("A267");
  const names = async (key, path) => { as(key); return (await onedrive.list(sandbox.id, path)).entries.map((e) => e.name); };
  for (const key of ["admin", "manager", "manager_prices", "accountant", "lead", "field", "viewer"]) {
    const top = await names(key);
    assert.ok(["Floor Plans", "Photos", "Documents", "Old portal documents"].every((n) => top.includes(n)), key + ": " + top.join(", "));
  }
  const field = await names("field", "Floor Plans");
  assert.ok(field.includes("A1 - Floor plan.pdf") && !field.some((n) => /\.takeoff$|\.pdfnotes$/i.test(n)), "no takeoff without prices: " + field);
  assert.ok((await names("manager_prices", "Floor Plans")).some((n) => /\.takeoff$/.test(n)), "with prices the takeoff is there");
  const docs = await names("field", "Documents");
  assert.ok(!docs.some((n) => /estimate|invoice|\$|~\$|desktop\.ini/i.test(n)), "priced, money, amount and lock names hidden: " + docs);
  assert.ok((await names("manager_prices", "Documents")).some((n) => /Estimate \$/.test(n)), "a price person sees the estimate");
  assert.ok(!(await names("manager_prices", "Documents")).includes("Invoices"), "the money folder needs financials too");
  assert.ok((await names("accountant", "Documents")).includes("Invoices"), "the accountant (prices + financials) sees it");
  assert.ok(!(await names("field")).includes("Contract signed.pdf") && (await names("admin")).includes("Contract signed.pdf"));
  // a hidden folder answers as missing; children counts only with prices
  as("field");
  assert.equal((await refusal(onedrive.list(sandbox.id, "Documents/Invoices"))).code, "not_found");
  assert.ok((await onedrive.list(sandbox.id)).entries.every((e) => e.children === undefined));
  as("admin");
  assert.ok((await onedrive.list(sandbox.id)).entries.filter((e) => e.folder).every((e) => typeof e.children === "number"));
  // who may upload, who may make the folder
  const flags = async (key) => { as(key); const p = await onedrive.list(sandbox.id); return [p.canUpload, p.canMakeFolder]; };
  assert.deepEqual(await flags("admin"), [true, true]);
  assert.deepEqual(await flags("manager"), [false, true], "a manager edits projects: may make the folder, no switch");
  assert.deepEqual(await flags("manager_prices"), [true, true]);
  assert.deepEqual(await flags("lead"), [true, true]);
  assert.deepEqual(await flags("field"), [false, false]);
  assert.deepEqual(await flags("viewer"), [false, false]);
  // the agents account and a turned-off person: refused; signed out: 401
  for (const key of ["agents", "inactive"]) { as(key); assert.equal((await refusal(onedrive.list(sandbox.id))).code, "forbidden", key); }
  as(null);
  assert.equal((await refusal(onedrive.list(sandbox.id))).code, "auth");
});

test("demo OneDrive: paging with a cursor bound to the person and the folder; paths the broker refuses", { skip }, async () => {
  await setup();
  const sandbox = project("A267");
  as("field");
  const day = (await onedrive.list(sandbox.id, "Photos")).entries[0].name;
  const first = await onedrive.list(sandbox.id, ["Photos", day]);
  assert.equal(first.entries.length, 25);
  assert.ok(first.next, "a cursor for the next page");
  const second = await onedrive.list(sandbox.id, ["Photos", day], first.next);
  assert.equal(second.entries.length, 15);
  assert.equal(second.next, null);
  assert.equal(new Set(first.entries.concat(second.entries).map((e) => e.id)).size, 40);
  as("lead");
  const other = await refusal(onedrive.list(sandbox.id, ["Photos", day], first.next));
  assert.deepEqual([other.code, other.field], ["invalid", "cursor"], "another person's cursor");
  for (const bad of ["../x", "Floor Plans/", "a\\b", "con", "Floor Plans/ x"]) {
    const e = await refusal(onedrive.list(sandbox.id, bad));
    assert.deepEqual([e.code, e.status, e.field], ["invalid", 400, "path"], bad);
  }
  assert.equal((await refusal(onedrive.list(sandbox.id, "Nope"))).code, "not_found");
  // a deleted project's folder is never listed, an admin's ask too
  const gone = E.rows.projects.find((p) => p.number === "A150");
  gone.deleted_at = new Date().toISOString();
  as("admin");
  assert.equal((await refusal(onedrive.list(gone.id))).code, "not_found");
});

test("demo OneDrive: opening a file - a link per click; programs refused; hidden and missing alike", { skip }, async () => {
  await setup();
  const sandbox = project("A267");
  as("field");
  const docs = await onedrive.list(sandbox.id, "Documents");
  const permit = docs.entries.find((e) => e.name === "Permit application.pdf");
  const link = await onedrive.download(sandbox.id, permit.id);
  assert.ok(onedrive.linkOk(link.url) && new URL(link.url).hostname === onedrive.ONEDRIVE_HOST, link.url);
  assert.equal(link.name, "Permit application.pdf");
  const exe = docs.entries.find((e) => e.name === "Installer.exe");
  assert.equal((await refusal(onedrive.download(sandbox.id, exe.id))).code, "not_downloadable");
  as("admin");
  const est = (await onedrive.list(sandbox.id, "Documents")).entries.find((e) => /^Estimate/.test(e.name));
  as("field");
  assert.equal((await refusal(onedrive.download(sandbox.id, est.id))).code, "not_found", "hidden for a field person: as missing");
  assert.equal((await refusal(onedrive.download(project("A100").id, permit.id))).code, "not_found", "another project's item");
});

test("demo OneDrive: a lead uploads a floor plan straight to the upload URL in chunks; the broker records its row", { skip }, async () => {
  await setup();
  const sandbox = project("A267");
  as("lead");
  const sent = [];
  const up = uploader(sent);
  const size = 2 * CHUNK_UNIT + 1234;
  const file = new File([new Uint8Array(size)], "Level 2 framing.pdf", { type: "application/pdf" });
  up.add({ projectId: sandbox.id, file, folder: "Floor Plans", relDir: "Level 2", name: file.name, label: "Floor Plans / Level 2" });
  const [job] = await settle(up);
  assert.equal(job.state, "done", job.error);
  assert.deepEqual([job.result.recorded, job.result.renamed, job.result.name], [true, false, "Level 2 framing.pdf"]);
  const puts = sent.filter((s) => s.method === "PUT");
  assert.ok(puts.length >= 1 && puts.every((s) => !Object.keys(s.headers).some((k) => /authorization|apikey/i.test(k))), "no sign-in on the chunks");
  assert.ok(puts.slice(0, -1).every((s) => s.size % CHUNK_UNIT === 0));
  assert.equal(puts.map((s) => s.size).reduce((a, b) => a + b, 0), size);
  const row = E.rows.files.find((f) => f.id === job.result.file.id);
  assert.deepEqual([row.storage, row.source, row.folder, row.subpath, row.name, row.created_by, Number(row.size)],
    ["local", "portal2", "plans", "Floor Plans/Level 2", "Level 2 framing.pdf", id("lead"), size]);
  assert.equal(row.rel_path, sandbox.folder_name + "/Floor Plans/Level 2/Level 2 framing.pdf");
  assert.ok(E.rows.activity.some((a) => a.project_id === sandbox.id && /Floor Plans/.test(a.text) && a.created_by === id("lead")), "the activity line");
  // the Files tab's list and the folder agree
  const listed = await onedrive.list(sandbox.id, "Floor Plans/Level 2");
  assert.deepEqual(listed.entries.map((e) => e.name), ["Level 2 framing.pdf"]);
  const items = await filesRepo.listCurrent(sandbox.id);
  assert.ok(items.some((f) => f.relPath === row.rel_path && !f.cloud));
  // the same name again: OneDrive renames it - its own row, never a version of the first
  up.add({ projectId: sandbox.id, file, folder: "Floor Plans", relDir: "Level 2", name: file.name, label: "x" });
  const again = (await settle(up))[1];
  assert.deepEqual([again.state, again.result.renamed, again.result.name], ["done", true, "Level 2 framing 1.pdf"]);
  // upload_done asked again: the same row (already)
  const s = await onedrive.uploadSession({ projectId: sandbox.id, folder: "Documents", name: "Note.txt", size: 5 });
  const put = ext().http("PUT", s.uploadUrl, { "Content-Range": "bytes 0-4/5" }, new Blob(["hello"]));
  assert.equal(put.status, 201);
  const item = JSON.parse(put.body);
  const d1 = await onedrive.uploadDone(sandbox.id, item.id, s.ticket);
  const d2 = await onedrive.uploadDone(sandbox.id, item.id, s.ticket);
  assert.deepEqual([d1.recorded, d1.already, d2.recorded, d2.already, d2.file.id], [true, false, true, true, d1.file.id]);
  // the upload URL refuses a sign-in header, a wrong range, a chunk that is not a multiple of 320 KiB
  const s2 = await onedrive.uploadSession({ projectId: sandbox.id, folder: "Documents", name: "Big.pdf", size: CHUNK_UNIT * 2 });
  assert.equal(ext().http("PUT", s2.uploadUrl, { "Content-Range": "bytes 0-9/" + CHUNK_UNIT * 2, Authorization: "Bearer x" }, new Blob(["0123456789"])).status, 401);
  assert.equal(ext().http("PUT", s2.uploadUrl, { "Content-Range": "bytes 10-19/" + CHUNK_UNIT * 2 }, new Blob(["0123456789"])).status, 416);
  assert.equal(ext().http("PUT", s2.uploadUrl, { "Content-Range": "bytes 0-9/" + CHUNK_UNIT * 2 }, new Blob(["0123456789"])).status, 400);
  // another person's ticket, a made-up item: refused
  as("admin");
  assert.equal((await refusal(onedrive.uploadDone(sandbox.id, item.id, s.ticket))).field, "ticket");
});

test("demo OneDrive: who may upload what, where (the switch, the allowlist, prices, Documents/Items)", { skip }, async () => {
  await setup();
  const sandbox = project("A267");
  const ask = (o) => onedrive.uploadSession(Object.assign({ projectId: sandbox.id, folder: "Documents", name: "Permit.pdf", size: 10 }, o));
  for (const key of ["field", "viewer", "manager"]) {
    as(key);
    const e = await refusal(ask({}));
    assert.deepEqual([e.code, e.status], ["forbidden", 403], key);
    assert.match(e.message, /Can upload to OneDrive/, key + ": the broker's own sentence");
  }
  as("lead");
  assert.equal((await refusal(ask({ name: "tool.exe" }))).code, "file_type");
  assert.equal((await refusal(ask({ name: "Macro.xlsm" }))).code, "file_type");
  assert.equal((await refusal(ask({ name: "Bid.takeoff" }))).code, "file_type", "a takeoff needs prices");
  assert.equal((await refusal(ask({ name: "Quote 3.pdf" }))).field, "name", "a priced name without prices");
  assert.equal((await refusal(ask({ name: "Deck $4,500.pdf" }))).field, "name", "an amount without prices");
  assert.equal((await refusal(ask({ name: "~$lock.docx" }))).field, "name");
  assert.equal((await refusal(ask({ relDir: "Items/12 - Beam" }))).field, "rel_dir");
  assert.equal((await refusal(ask({ relDir: "Change Orders" }))).field, "rel_dir");
  assert.equal((await refusal(ask({ folder: "Photos" }))).field, "folder", "photos keep the capture bar");
  assert.equal((await refusal(ask({ size: 0 }))).field, "size");
  assert.equal((await refusal(ask({ size: 3 * 1024 * 1024 * 1024 }))).code, "too_large");
  as("manager_prices");
  const s = await ask({ name: "Bid.takeoff", folder: "Floor Plans" });
  assert.ok(onedrive.linkOk(s.uploadUrl) && s.ticket);
});

test("demo OneDrive: no folder yet - Make the folder; never beside another folder with the number (other_folder)", { skip }, async () => {
  await setup();
  const a305 = project("A305"), a304 = project("A304");
  as("field");
  const none = await onedrive.list(a305.id);
  assert.deepEqual([none.folderExists, none.entries.length, none.canMakeFolder], [false, 0, false]);
  assert.equal((await onedrive.ensureFolder(a305.id)).state, "forbidden", "field: no switch, no projects editing");
  as("manager");
  const made = await onedrive.ensureFolder(a305.id);
  assert.deepEqual([made.state, made.madeProjectFolder, made.created], ["made", true, ["Floor Plans", "Photos", "Documents"]]);
  assert.equal((await onedrive.ensureFolder(a305.id)).state, "exists");
  assert.deepEqual((await onedrive.list(a305.id)).entries.map((e) => e.name), ["Documents", "Floor Plans", "Photos"]);
  const other = await onedrive.ensureFolder(a304.id);
  assert.deepEqual([other.state, other.count, other.folders], ["other_folder", 1, []], "names for an admin only");
  as("admin");
  assert.deepEqual((await onedrive.ensureFolder(a304.id)).folders, ["A304 - Old name of the job"]);
  // an upload into a project without a folder makes it (and is refused beside another one)
  as("lead");
  const test2 = project("A000T2");
  assert.equal((await onedrive.list(test2.id)).folderExists, false);
  const s = await onedrive.uploadSession({ projectId: test2.id, folder: "Documents", relDir: "DCR self-test", name: "a.txt", size: 3 });
  assert.ok(s.uploadUrl);
  assert.deepEqual((await onedrive.list(test2.id, "Documents")).entries.map((e) => e.name), ["DCR self-test"]);
  assert.equal((await refusal(onedrive.uploadSession({ projectId: a304.id, folder: "Documents", name: "a.txt", size: 3 }))).code, "other_folder");
});

test("demo OneDrive: status is an admin's; the test project A000T2 is in the demo, its folder not yet", { skip }, async () => {
  await setup();
  as("admin");
  const s = await onedrive.status();
  assert.deepEqual([s.ok, s.grant], [true, "folder"]);
  as("manager_prices");
  assert.equal((await refusal(onedrive.status())).code, "forbidden");
  const t2 = project("A000T2");
  assert.ok(t2 && t2.folder_name.startsWith("A000T2 - "), "the test project");
  assert.ok(onedrive.selfTestFor({ role: "admin", active: true }, { number: "A000T2" }));
});

test("demo OneDrive: the admin's self-test on A000T2 passes every step (two chunks, recorded, already, renamed, listed, a ranged GET, 415)", { skip }, async () => {
  await setup();
  const { run } = await import("../site/js/pages/onedrive-selftest.js");
  const t2 = project("A000T2");
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
  const sent = [];
  const parts = {
    send: async (req) => {
      sent.push({ method: req.method, headers: Object.assign({}, req.headers), size: req.body ? req.body.size : 0 });
      const r = ext().http(req.method, req.url, Object.assign({}, req.headers), req.body);
      return { status: r.status, header: (n) => r.headers[String(n).toLowerCase()] || null, text: () => (typeof r.body === "string" ? r.body : "") };
    },
    fetch: async (url, o) => {
      const r = ext().http("GET", url, (o && o.headers) || {}, null);
      return { status: r.status, text: async () => (typeof r.body === "string" ? r.body : await r.body.text()) };
    },
  };
  // anybody else, or another project: it refuses before asking anything
  as("manager_prices");
  const box = { innerHTML: "" };
  assert.deepEqual(await run({ me: { role: "manager", active: true }, project: { number: "A000T2" }, pid: t2.id, esc }, box, parts), []);
  assert.match(box.innerHTML, /admin on the test project A000T2 only/);
  as("admin");
  assert.deepEqual(await run({ me: { role: "admin", active: true }, project: { number: "A267" }, pid: project("A267").id, esc }, box, parts), []);
  const out = await run({ me: { role: "admin", active: true }, project: { internalIDNumber: "A000T2" }, pid: t2.id, esc }, box, parts);
  assert.deepEqual(out.map((r) => r.step + (r.ok ? " PASS" : " FAIL " + r.code)), ["1 PASS", "2 PASS", "3 PASS", "4 PASS", "5 PASS", "6 PASS", "7 PASS", "8 PASS"]);
  const puts = sent.filter((s) => s.method === "PUT");
  assert.equal(puts.length, 4, "two chunks, twice");
  assert.ok(puts.every((p) => !Object.keys(p.headers).some((k) => /authorization/i.test(k))));
  assert.deepEqual(puts.map((p) => p.size), [327680, 409600 - 327680, 327680, 409600 - 327680]);
  assert.match(box.innerHTML, /PASS/);
  assert.ok(!/upload_url|tempauth|__demo|ticket/i.test(box.innerHTML), "no link or ticket is shown");
  const rows = E.rows.files.filter((f) => f.project_id === t2.id && f.source === "portal2");
  assert.deepEqual(rows.map((f) => f.subpath).sort(), ["Documents/DCR self-test", "Documents/DCR self-test"]);
  assert.ok(rows.some((f) => / 1\.txt$/.test(f.name)), "the renamed copy has its own row");
});
