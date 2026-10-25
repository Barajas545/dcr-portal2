// Part 3 over the DEMO database (tools/fake/engine.js + p5a-pm.js + p7-web.js: the rules of migration 20261028000100
// and of M5b's costs as far as Portal 2 meets them), by role: adding and correcting costs (money editors only; the
// database's labour amount, card stamp, un-reconcile; no stamp, reconciled or employee from a person), a receipt under
// f/ and its cost link, the project picture (Storage, the files row, the pointer: projects editors only, the project's
// own live picture), New Project's zone rule, the Access tab's admin_set_profile and its checks, the Estimator switch
// deciding estimate edits, and the OneDrive folder step while the function is not there. Made-up people and jobs only.
import test from "node:test";
import assert from "node:assert/strict";

import { available, freshEngine, person, clientAs, loadFake } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as ledger from "../site/js/repo/ledger.js";
import * as projects from "../site/js/repo/projects.js";
import * as files from "../site/js/repo/files.js";
import * as employees from "../site/js/repo/employees.js";
import * as onedrive from "../site/js/repo/onedrive.js";
import { clearPeople } from "../site/js/repo/people.js";
import { payload } from "../site/js/map/cost-form.js";
import { newProjectFields } from "../site/js/map/projects.js";
import { shapeProfile } from "../site/js/sb.js";
import { can } from "../site/js/pages/shell.js";
import { createQueue } from "../site/js/upload-queue2.js";

const skip = !available;

async function as(key, engine) {
  const e = engine || await freshEngine();
  const who = await person(key);
  clearPeople();
  projects.forgetProjects();
  files.forgetThumbnails();
  useClient(clientAs(e, who.id));
  return { e, uid: who.id, me: shapeProfile(e.rows.profiles.find((p) => p.id === who.id)) };
}
const sandbox = (e) => e.rows.projects.find((p) => p.number === "A267");
const other = (e) => e.rows.projects.find((p) => p.number !== "A267" && !p.deleted_at);
const COST = (pid, o) => payload(Object.assign({ kind: "material", cost_date: "2026-10-20", description: "Made-up lumber", vendor: "", hours: "", rate: "",
  amount: "120.00", estimate_item_id: "", card: "untagged" }, o), { projectId: pid });
const blob = (n, type) => new Blob([new Uint8Array(n || 1024)], { type: type || "image/jpeg" });

test("the demo people: Robin Estimator (a manager with the Estimator switch, no prices); the admin holds both new switches; the lead uploads to OneDrive", { skip }, async () => {
  const e = await freshEngine();
  const est = await person("estimator");
  assert.equal(est.id, "00000000-0000-4000-8000-000000000013");
  const row = e.rows.profiles.find((p) => p.id === est.id);
  assert.deepEqual([row.role, row.can_estimate, row.can_see_prices, row.can_upload_onedrive], ["manager", true, false, false]);
  const by = (k) => e.rows.profiles.find((p) => p.id === (e.rows.profiles.find((x) => x.email === k + "@demo.test") || {}).id);
  assert.deepEqual([by("admin").can_estimate, by("admin").can_upload_onedrive], [true, true]);
  assert.deepEqual([by("manager").can_estimate, by("manager2").can_estimate, by("manager2").can_upload_onedrive], [false, true, true]);
  assert.equal(by("lead").can_upload_onedrive, true);
  assert.ok(e.rows.profiles.every((p) => p.role === "admin" || p.role === "manager" || !p.can_estimate), "the check holds in the seed");
  assert.ok(e.rows.profiles.every((p) => p.role !== "viewer" || !p.can_upload_onedrive));
  const { me } = await as("estimator", e);
  assert.equal(can(me, "estimates"), true);
  assert.equal(can((await as("manager", e)).me, "estimates"), false);
});

test("the demo seed: Part 3 never resets a switch an earlier extension set (p5a-est.js may add Robin Estimator first, D11); an admin's and the agents account's are forced", { skip }, async () => {
  const F = await loadFake();
  const seedP7 = F.extSeed.find((f) => f.name === "seedP7");
  assert.equal(typeof seedP7, "function");
  const ROBIN = "00000000-0000-4000-8000-000000000013";
  const out = { profiles: [
    { id: "a", role: "admin", can_estimate: false },
    { id: "m", role: "manager", can_estimate: true },
    { id: "q", role: "manager" }, { id: "l", role: "lead" }, { id: "f", role: "field" },
    { id: ROBIN, role: "manager", full_name: "Robin Estimator", can_see_prices: false, can_estimate: true },
    { id: "g", role: "agents", can_estimate: true, can_upload_onedrive: true },
  ] };
  seedP7(out, { P: { admin: "a", manager_prices: "q", lead: "l" }, now: new Date("2026-10-24T16:00:00Z") });
  const by = (id) => out.profiles.find((p) => p.id === id);
  const sw = (id) => [by(id).can_estimate, by(id).can_upload_onedrive];
  assert.deepEqual(sw(ROBIN), [true, false], "set first by p5a-est: kept; the missing switch takes the role's default");
  assert.equal(out.profiles.filter((p) => p.id === ROBIN).length, 1, "never added twice");
  assert.deepEqual(sw("m"), [true, false], "a switch set earlier is kept");
  assert.deepEqual(sw("a"), [true, true], "an admin: forced on");
  assert.deepEqual(sw("g"), [false, false], "the agents account: forced off");
  assert.deepEqual(sw("q"), [true, true], "Quinn Manager");
  assert.deepEqual(sw("l"), [false, true], "Riley Lead uploads");
  assert.deepEqual(sw("f"), [false, false], "the role's default");
});

test("costs: the accountant and the admin add and correct them; a manager without financials, a lead and field are refused (42501) before anything", { skip }, async () => {
  const engine = await freshEngine();
  const pid = sandbox(engine).id;
  for (const key of ["manager", "manager_prices", "lead", "field", "viewer"]) {
    await as(key, engine);
    await assert.rejects(ledger.addCost(COST(pid)), (x) => x.code === "42501", key);
  }
  const n0 = engine.rows.activity.length;
  await as("accountant", engine);
  const labor = await ledger.addCost(COST(pid, { kind: "labor", description: "Made-up crew - framing", hours: "2.5", rate: "33.33", amount: "", card: "card-amex" }));
  assert.equal(Number(labor.amount), 83.33, "the database's hours x rate");
  assert.equal(labor.card, "card-amex");
  const raw = engine.rows.costs.find((c) => c.id === labor.id);
  assert.ok(raw.card_by && raw.card_at, "the stamp is the database's");
  const credit = await ledger.addCost(COST(pid, { amount: "-45.10", description: "Made-up return" }));
  assert.equal(Number(credit.amount), -45.1, "a credit");
  // a correction: versioned, only what changed; a reconciled cost whose amount changes is not reconciled any more
  Object.assign(engine.rows.costs.find((c) => c.id === credit.id), { reconciled_at: "2026-10-21T16:00:00Z", reconciled_by: (await person("accountant")).id });
  const before = await ledger.getCost(credit.id);
  const fixed = await ledger.updateCost(before, { amount: -40 });
  assert.equal(Number(fixed.amount), -40);
  assert.equal(fixed.reconciled_at, null, "not what was reconciled");
  await assert.rejects(ledger.updateCost(before, { amount: -41 }), (x) => x.code === "PT409" && x.current && x.current.version === fixed.version, "a stale version");
  await assert.rejects(ledger.updateCost(fixed, { project_id: other(engine).id }), /not a cost column/);
  // never from a person: the reconciled mark, the employee
  const { e } = await as("admin", engine);
  const P = clientAs(e, (await person("admin")).id);
  const r1 = await P.from("costs").update({ reconciled_at: "2026-10-22T16:00:00Z" }).eq("id", labor.id).select("id");
  assert.equal(r1.error && r1.error.code, "42501");
  const r2 = await P.from("costs").insert({ project_id: pid, kind: "other", amount: 1, employee_id: 1, employee_source: "confirmed" }).select("id");
  assert.equal(r2.error && r2.error.code, "42501");
  await as("admin", engine);
  const mine = await ledger.addCost(COST(pid, { kind: "equipment", description: "Made-up lift rental", amount: "300" }));
  assert.ok(mine.id);
  assert.equal(engine.rows.activity.length, n0, "no activity line names an amount");
});

test("costs: the estimate line must be the same project's; a labour cost's crew member is inferred, never typed", { skip }, async () => {
  const engine = await freshEngine();
  const pid = sandbox(engine).id;
  await as("accountant", engine);
  const lines = await ledger.lineChoices(pid);
  assert.ok(lines.length > 0, "the sandbox has estimate lines");
  const ok = await ledger.addCost(COST(pid, { estimate_item_id: String(lines[0].id) }));
  assert.equal(ok.estimate_item_id, lines[0].id);
  const elsewhere = (engine.rows.estimate_items || []).find((i) => i.project_id !== pid && !i.deleted_at);
  if (elsewhere) await assert.rejects(ledger.addCost(COST(pid, { estimate_item_id: String(elsewhere.id) })), (x) => x.code === "23514");
  // its estimate archived later: the line is no longer offered for a new cost, but correcting this cost keeps it
  const est = engine.rows.estimates.find((x) => x.id === engine.rows.estimate_items.find((i) => i.id === lines[0].id).estimate_id);
  est.archived_at = "2026-10-22T16:00:00Z";
  assert.ok(!(await ledger.lineChoices(pid)).some((l) => l.id === lines[0].id));
  assert.match((await ledger.lineChoices(pid, ok.estimate_item_id)).find((l) => l.id === lines[0].id).label, /\(archived estimate\)$/);
  const before = await ledger.getCost(ok.id);
  const patch = payload({ kind: before.kind, cost_date: before.cost_date, description: "Made-up lumber (typo fixed)", vendor: before.vendor || "", hours: "", rate: "",
    amount: String(before.amount), estimate_item_id: undefined, card: before.card }, { editing: true, before });
  assert.deepEqual(patch, { description: "Made-up lumber (typo fixed)" }, "no line select: the line is not sent");
  assert.equal((await ledger.updateCost(before, patch)).estimate_item_id, lines[0].id, "still booked to its line");
  const emp = engine.rows.employees.find((x) => x.active !== false);
  const first = String(emp.full_name).split(" ")[0];
  const guess = engine.rows.employees.filter((x) => x.active !== false && String(x.full_name).split(" ")[0].toLowerCase() === first.toLowerCase()).length === 1;
  const c = await ledger.addCost(COST(pid, { kind: "labor", description: first + " - made-up framing", hours: "8", rate: "40", amount: "" }));
  if (guess) assert.deepEqual([c.employee_id, c.employee_source], [emp.id, "inferred"]);
});

test("a receipt: under f/ and linked to its cost by a money editor only; another project's cost or a non-receipt folder is refused (23514)", { skip }, async () => {
  const engine = await freshEngine();
  const pid = sandbox(engine).id;
  const acct = await as("accountant", engine);
  const cost = await ledger.addCost(COST(pid));
  const key = "f/" + pid + "/receipts/" + "ab".repeat(16) + "/Receipt_2026-10-20.jpg";
  engine.storage.upload({ uid: acct.uid }, key, 2048, "image/jpeg", null, false);
  const c = clientAs(engine, acct.uid);
  const row = await c.from("files").insert({ project_id: pid, folder: "receipts", subpath: "", name: "Receipt 2026-10-20.jpg", storage_path: key, size: 2048,
    mime: "image/jpeg", source: "portal2", cost_id: cost.id }).select("*");
  assert.equal(row.error, null);
  assert.equal(row.data[0].is_financial, true);
  assert.equal(row.data[0].cost_id, cost.id);
  // the lead: neither the object nor the row
  const lead = await person("lead");
  assert.throws(() => engine.storage.upload({ uid: lead.id }, "f/" + pid + "/receipts/" + "cd".repeat(16) + "/r.jpg", 10, "image/jpeg", null, false), /row-level security/);
  assert.throws(() => engine.storage.upload({ uid: acct.uid }, "p/" + pid + "/receipts/" + "ef".repeat(16) + "/r.jpg", 10, "image/jpeg", null, false), /row-level security/,
    "a receipt is never under p/");
  const otherCost = await ledger.addCost(COST(other(engine).id));
  const key2 = "f/" + pid + "/receipts/" + "12".repeat(16) + "/r2.jpg";
  engine.storage.upload({ uid: acct.uid }, key2, 10, "image/jpeg", null, false);
  const bad = await c.from("files").insert({ project_id: pid, folder: "receipts", subpath: "", name: "r2.jpg", storage_path: key2, size: 10, mime: "image/jpeg",
    source: "portal2", cost_id: otherCost.id }).select("*");
  assert.equal(bad.error && bad.error.code, "23514", "another project's cost");
  const key3 = "p/" + pid + "/photos/" + "34".repeat(16) + "/p.jpg";
  engine.storage.upload({ uid: acct.uid }, key3, 10, "image/jpeg", null, false);
  const notReceipt = await c.from("files").insert({ project_id: pid, folder: "photos", subpath: "2026-10-20", name: "p.jpg", storage_path: key3, size: 10,
    mime: "image/jpeg", source: "portal2", cost_id: cost.id }).select("*");
  assert.equal(notReceipt.error && notReceipt.error.code, "23514", "files_cost_receipt");
  // the same name for two costs is two receipts, never one receipt's versions
  const cost2 = await ledger.addCost(COST(pid, { description: "Made-up nails" }));
  const key4 = "f/" + pid + "/receipts/" + "56".repeat(16) + "/Receipt_2026-10-20.jpg";
  engine.storage.upload({ uid: acct.uid }, key4, 10, "image/jpeg", null, false);
  const twin = await c.from("files").insert({ project_id: pid, folder: "receipts", subpath: "", name: "Receipt 2026-10-20.jpg", storage_path: key4, size: 10,
    mime: "image/jpeg", source: "portal2", cost_id: cost2.id }).select("*");
  assert.deepEqual([twin.data[0].version_no, twin.data[0].previous_id], [1, null]);
});

test("a receipt through the upload queue: f/{project}/receipts/…, folder receipts, its cost_id, 'Receipt <time>'; the same receipt name for two costs stays two receipts", { skip }, async () => {
  const engine = await freshEngine();
  const pid = sandbox(engine).id;
  const acct = await as("accountant", engine);
  const cost = await ledger.addCost(COST(pid));
  const cost2 = await ledger.addCost(COST(pid, { description: "Made-up screws" }));
  const store = new Map();
  const ctx = () => ({ uid: acct.uid });
  const q = createQueue({
    store: { put: async (v) => { store.set(v.id, v); }, del: async (id) => { store.delete(id); }, all: async () => Array.from(store.values()) },
    send: async (req) => {
      const r = engine.storage.request(req.method, new URL(req.url).pathname, req.headers, req.body);
      return { status: r.status, header: (n) => (r.headers[n.toLowerCase()] ?? null), text: () => r.text };
    },
    auth: async () => ({ url: "https://demo-ref.supabase.co", apikey: "publishable", token: acct.uid }),
    owner: () => acct.uid,
    db: {
      findByPath: async (key) => engine.select(ctx(), "files", { columns: "*", filters: [{ col: "storage_path", op: "eq", val: key }] }).data[0] || null,
      nameTaken: async () => false,
      insert: async (row) => engine.insert(ctx(), "files", row)[0],
    },
    setTimeout: (fn) => 0, clearTimeout: () => {},
  });
  const when = "2026-10-20T16:15:00Z";
  await q.enqueue({ projectId: pid, file: blob(3000, "application/pdf"), kind: "receipt", costId: cost.id, name: "Made-up supplier 10-20.pdf", takenAt: when });
  await q.enqueue({ projectId: pid, file: blob(3000, "image/jpeg"), kind: "receipt", costId: cost.id, takenAt: when });
  await q.enqueue({ projectId: pid, file: blob(3000, "image/jpeg"), kind: "receipt", costId: cost2.id, takenAt: when });
  await q.drain();
  const got = engine.rows.files.filter((f) => f.cost_id === cost.id || f.cost_id === cost2.id).sort((a, b) => a.id - b.id);
  assert.equal(got.length, 3);
  for (const f of got) {
    assert.match(f.storage_path, new RegExp("^f/" + pid + "/receipts/[0-9a-f]{32}/"));
    assert.deepEqual([f.folder, f.subpath, f.is_financial, f.source], ["receipts", "", true, "portal2"]);
  }
  assert.equal(got[0].name, "Made-up supplier 10-20.pdf");
  assert.equal(got[1].name, "Receipt 2026-10-20 09.15.00.jpg");
  assert.match(got[2].name, /^Receipt 2026-10-20 09\.15\.00(-2)?\.jpg$/, "the queue keeps the names it holds apart");
  assert.deepEqual([got[2].version_no, got[2].previous_id], [1, null], "another cost's receipt is never a version");
  // the cost's receipts as the Expenses tab reads them
  const rows = await ledger.projectExpenses(pid);
  assert.equal(rows.find((r) => r.id === cost.id).receipts.length, 2);
});

test("the project picture: a manager uploads it and points the project at it; a lead is refused; another project's file and a picture with a sub-folder are refused (23514)", { skip }, async () => {
  const engine = await freshEngine();
  const p0 = sandbox(engine);
  await as("lead", engine);
  await assert.rejects(files.addThumbnail(p0.id, { blob: blob(), mime: "image/jpeg" }), (x) => x.code === "42501");
  await as("manager", engine);
  const row = await files.addThumbnail(p0.id, { blob: blob(4096), mime: "image/jpeg" });
  assert.match(row.storage_path, new RegExp("^p/" + p0.id + "/thumbnail/[0-9a-f]{32}/thumbnail\\.jpg$"));
  assert.deepEqual([row.folder, row.subpath, row.mime, row.source], ["thumbnail", "", "image/jpeg", "portal2"]);
  const n0 = engine.rows.activity.length;
  const project = await projects.getProject(p0.id);
  const moved = await projects.setThumbnail(project, row.id);
  assert.equal(moved.thumbnailFileId, row.id);
  assert.equal(engine.rows.activity.length, n0, "a new picture is not news");
  // a second picture: a new version of the first (the same name in the same place)
  const row2 = await files.addThumbnail(p0.id, { blob: blob(2048), mime: "image/jpeg" });
  assert.deepEqual([row2.version_no, row2.previous_id], [2, row.id]);
  // the pointer must be this project's live picture
  const elsewhere = other(engine);
  const theirs = await files.addThumbnail(elsewhere.id, { blob: blob(), mime: "image/png" });
  await assert.rejects(projects.setThumbnail(moved, theirs.id), (x) => x.code === "23514");
  const c = clientAs(engine, (await person("manager")).id);
  const k = "p/" + p0.id + "/thumbnail/" + "78".repeat(16) + "/thumbnail.jpg";
  engine.storage.upload({ uid: (await person("manager")).id }, k, 10, "image/jpeg", null, false);
  const sub = await c.from("files").insert({ project_id: p0.id, folder: "thumbnail", subpath: "2026", name: "thumbnail.jpg", storage_path: k, size: 10, mime: "image/jpeg" }).select("*");
  assert.equal(sub.error && sub.error.code, "23514", "files_thumbnail_no_subpath");
  const k2 = "p/" + p0.id + "/thumbnail/" + "9a".repeat(16) + "/thumbnail.gif";
  engine.storage.upload({ uid: (await person("manager")).id }, k2, 10, "image/gif", null, false);
  const gif = await c.from("files").insert({ project_id: p0.id, folder: "thumbnail", subpath: "", name: "thumbnail.gif", storage_path: k2, size: 10, mime: "image/gif" }).select("*");
  assert.equal(gif.error && gif.error.code, "23514", "files_thumbnail_picture: JPEG or PNG");
  // taken off, and the file it was is taken back by its uploader (the best-effort clean-up)
  const off = await projects.setThumbnail(await projects.getProject(p0.id), null);
  assert.equal(off.thumbnailFileId, null);
  await files.removeFile(row2);
  assert.ok(engine.rows.files.find((f) => f.id === row2.id).deleted_at);
});

test("New Project: a zone alone from a manager without prices (priced by the database); a custom rate needs prices; the answer is the project", { skip }, async () => {
  const engine = await freshEngine();
  await as("manager", engine);
  const p = await projects.createProject(newProjectFields({ name: "Made-up Barn", city: "Pine Hollow", state: "CA", zone: "out_of_area", status: "estimating" }, false).fields);
  assert.equal(p.status, "estimating");
  const pr = engine.rows.project_prices.find((r) => r.project_id === p.id);
  assert.deepEqual([pr.rate_source, pr.labor_rate], ["out_of_area", 110]);
  await assert.rejects(projects.createProject({ name: "Made-up", rate_source: "custom", labor_rate: 95 }), (x) => x.code === "42501");
  await as("manager_prices", engine);
  const q = await projects.createProject(newProjectFields({ name: "Made-up Deck", zone: "custom", rate: "97.5" }, true).fields);
  const qp = engine.rows.project_prices.find((r) => r.project_id === q.id);
  assert.deepEqual([qp.rate_source, qp.labor_rate], ["custom", 97.5]);
  await as("lead", engine);
  await assert.rejects(projects.createProject({ name: "Made-up" }), (x) => x.code === "42501");
});

test("OneDrive folder step: the published module ships with LIVE off (the pages do not call it); the demo's broker stand-in (Part 4) answers ensureFolder", { skip }, async () => {
  assert.equal(onedrive.LIVE, false);
  const engine = await freshEngine();
  await as("manager", engine);
  const r = await onedrive.ensureFolder(sandbox(engine).id);
  assert.ok(["made", "exists"].includes(r.state), r.state);
  assert.equal(r.message, "");
});

test("the Access tab: admin_set_profile — an admin's only; Estimator for managers (a lead: 23514); OneDrive not for view-only; stale versions PT409; nobody changes their own switch", { skip }, async () => {
  const engine = await freshEngine();
  const admin = await as("admin", engine);
  const list = await employees.listAccess();
  assert.equal(list.ready, true);
  assert.ok(list.rows.some((r) => r.full_name === "Robin Estimator"));
  assert.ok(!list.rows.some((r) => r.role === "agents"));
  const morgan = list.rows.find((r) => r.full_name === "Morgan Manager");
  const saved = await employees.setAccess(morgan, { can_estimate: true, can_see_prices: true });
  assert.deepEqual([saved.can_estimate, saved.can_see_prices], [true, true]);
  assert.ok(saved.version > morgan.version);
  await assert.rejects(employees.setAccess(morgan, { can_estimate: false }), (x) => x.code === "PT409", "the version read is stale");
  const riley = list.rows.find((r) => r.full_name === "Riley Lead");
  await assert.rejects(employees.setAccess(riley, { can_estimate: true }), (x) => x.code === "23514" && /estimate/.test(x.message));
  const taylor = list.rows.find((r) => r.role === "viewer");
  await assert.rejects(employees.setAccess(taylor, { can_upload_onedrive: true }), (x) => x.code === "23514" && /onedrive/.test(x.message));
  const ok = await employees.setAccess(taylor, { can_see_prices: true });
  assert.equal(ok.can_see_prices, true);
  // an admin's own switches are always on (nothing to set)
  const me = list.rows.find((r) => r.id === admin.uid);
  const same = await employees.setAccess(me, { can_estimate: false });
  assert.equal(same.can_estimate, true);
  // not an admin: refused; a manager PATCHing his own row: refused too
  const q = await as("manager_prices", engine);
  await assert.rejects(employees.setAccess(riley, { can_upload_onedrive: false }), (x) => x.code === "42501");
  const c = clientAs(engine, q.uid);
  const self = await c.from("profiles").update({ can_estimate: false }).eq("id", q.uid).select("id");
  assert.equal(self.error && self.error.code, "42501", "a switch is an admin's to change");
  const lead = await as("lead", engine);
  const self2 = await clientAs(engine, lead.uid).from("profiles").update({ can_upload_onedrive: false }).eq("id", lead.uid).select("id");
  assert.equal(self2.error && self2.error.code, "42501");
  // a role change takes the new role's defaults (an admin's: every switch)
  await as("admin", engine);
  const out = await clientAs(engine, admin.uid).rpc("admin_set_profile", { p_id: riley.id, p_role: "field", p_version: riley.version });
  assert.equal(out.error, null);
  assert.deepEqual([out.data.role, out.data.can_upload_onedrive], ["field", false], "the role's default: off");
  const bad = await clientAs(engine, admin.uid).rpc("admin_set_profile", { p_id: riley.id, p_switches: { can_fly: true } });
  assert.equal(bad.error && bad.error.code, "22023");
});

test("Estimator decides estimate edits (app.can_edit('estimates')): Robin Estimator and Quinn Manager may, Morgan Manager may not", { skip }, async () => {
  const engine = await freshEngine();
  const est = (engine.rows.estimates || []).find((x) => !x.deleted_at && x.project_id === sandbox(engine).id);
  assert.ok(est, "the sandbox has an estimate");
  const tryName = async (key) => {
    const { uid } = await as(key, engine);
    const now = engine.rows.estimates.find((x) => x.id === est.id);
    const r = await clientAs(engine, uid).from("estimates").update({ description: "Made-up note by " + key }).eq("id", est.id).eq("version", now.version).select("id");
    return !r.error && r.data && r.data.length === 1;
  };
  assert.equal(await tryName("manager"), false);
  assert.equal(await tryName("estimator"), true);
  assert.equal(await tryName("manager_prices"), true);
  assert.equal(await tryName("admin"), true);
  assert.equal(await tryName("lead"), false);
});
