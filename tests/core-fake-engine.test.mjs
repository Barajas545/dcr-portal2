// The demo database (tools/fake): made-up seed, PostgREST semantics the pages rely on, and the
// rules of Appendix D as far as P1 needs them (prices, agents, field, viewer, versions, RPCs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../tools/fake/engine.js";
import "../tools/fake/seed.js";

const F = globalThis.DCR2Fake;
const D2_CASES = fileURLToPath(new URL("../../DCR Desktop 2/tools/pglite_check/project_location_cases.json", import.meta.url));
const NOW = new Date("2026-10-19T18:00:00Z");
function db() {
  const e = F.createEngine({ clock: () => NOW });
  e.load(F.seed({ now: NOW }));
  return e;
}
const P = Object.fromEntries(F.PEOPLE.map((p) => [p.key, { uid: p.id }]));
const sel = (e, who, table, q) => e.select(who, table, Object.assign({ columns: "*", filters: [], orders: [] }, q || {})).data;
const eq = (col, val) => ({ col, op: "eq", val });

test("the seed: ~300 made-up projects with the real number shapes, imports and the A267 sandbox", () => {
  const s = F.seed({ now: NOW });
  assert.ok(s.projects.length >= 300 && s.projects.length <= 330, String(s.projects.length));
  const nums = new Set(s.projects.map((p) => p.number));
  for (const n of ["A000", "A024", "A024-B", "A024-G", "A056-AB", "A000T1", "A004-B", "A267", "A296", "A300", "A305"]) assert.ok(nums.has(n), n);
  assert.equal(nums.size, s.projects.length, "numbers are unique");
  const legacy = s.projects.filter((p) => p.legacy_sp_id);
  assert.ok(legacy.length >= 290);
  assert.equal(new Set(legacy.map((p) => p.legacy_sp_id)).size, legacy.length);
  assert.ok(s.projects.filter((p) => !p.legacy_sp_id).every((p) => /^A30[0-5]$/.test(p.number)));
  const imported = s.activity.filter((a) => a.author_name);
  assert.ok(imported.length > 300 && imported.every((a) => a.created_by === null && a.legacy_sp_id));
  assert.ok(imported.some((a) => a.text.startsWith("Notes from the old portal")));
  assert.ok(imported.some((a) => a.text.length > 4000), "a long imported line, to fold with \"more\"");
  assert.deepEqual(F.seed({ now: NOW }).projects.map((p) => p.number + p.name), s.projects.map((p) => p.number + p.name), "deterministic");
});

test("the seed holds no real people or clients", () => {
  const s = JSON.stringify(F.seed({ now: NOW }));
  const emails = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  assert.ok(emails.length > 10);
  assert.ok(emails.every((m) => /@(demo\.test|example\.com)$/.test(m)), emails.filter((m) => !/@(demo\.test|example\.com)$/.test(m)).join(","));
  const phones = s.match(/\(\d{3}\) \d{3}-\d{4}/g) || [];
  assert.ok(phones.every((p) => / 555-01\d\d$/.test(p)), "only the fictional 555-01xx numbers");
  assert.ok(!/dcrframing/i.test(s));
});

test("prices: an embed comes back null without the switch (managers off by default, Q1)", () => {
  const e = db();
  const q = { columns: "id,number,prices:project_prices(labor_rate)", filters: [eq("number", "A267")] };
  assert.equal(sel(e, P.admin, "projects", q)[0].prices.labor_rate, 90);
  assert.equal(sel(e, P.accountant, "projects", q)[0].prices.labor_rate, 90);
  assert.equal(sel(e, P.manager, "projects", q)[0].prices, null, "Q1: a manager sees no prices by default");
  assert.equal(sel(e, P.manager_prices, "projects", q)[0].prices.labor_rate, 90, "switched on per person");
  for (const who of [P.lead, P.field, P.viewer]) assert.equal(sel(e, who, "projects", q)[0].prices, null);
  assert.equal(sel(e, P.lead, "project_prices").length, 0, "no direct read either");
});

test("the agents account and a deactivated account read nothing but their own profile", () => {
  const e = db();
  for (const who of [P.agents, P.inactive]) {
    for (const t of ["projects", "activity", "journal_entries", "files", "current_files", "contacts", "tasks", "settings", "project_prices"]) {
      assert.equal(sel(e, who, t).length, 0, t);
    }
    const profiles = sel(e, who, "profiles");
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].id, who.uid);
    if (who === P.agents) assert.throws(() => e.rpc(who, "search", { q: "A267" }), (x) => x.code === "42501", "search refuses the agents account (M1)");
    else assert.deepEqual(e.rpc(who, "search", { q: "A267" }).projects, []);
    assert.throws(() => e.rpc(who, "create_project", { fields: { name: "X" } }), (x) => x.code === "42501");
    assert.throws(() => e.rpc(who, "set_project_location", { project_id: 1, lat: 35, lng: -120, source: "gps", accuracy_m: 5 }), (x) => x.code === "42501");
    assert.throws(() => e.rpc(who, "soft_delete", { tbl: "projects", id: 1 }), (x) => x.code === "42501");
  }
  assert.throws(() => sel(e, { uid: null }, "projects"), (x) => x.code === "42501" && x.status === 401, "anonymous: refused");
  assert.equal(sel(e, P.field, "profiles").length, F.PEOPLE.length, "Q29: every signed-in person reads colleagues' profiles");
});

test("embeds: many-to-one objects, one-to-many arrays, hints, !inner, and the ambiguity PostgREST refuses", () => {
  const e = db();
  const a = sel(e, P.lead, "activity", { columns: "id,text,projects(number,name)", filters: [eq("project_id", 268)], limit: 3 });
  assert.equal(a[0].projects.number, "A267");
  const p = sel(e, P.lead, "projects", { columns: "id,journal_entries(id,title)", filters: [eq("id", 268)] })[0];
  assert.ok(Array.isArray(p.journal_entries) && p.journal_entries.length >= 5);
  assert.throws(() => sel(e, P.lead, "projects", { columns: "id,files(id)" }), (x) => x.code === "PGRST201", "projects -> files is ambiguous");
  const t = sel(e, P.lead, "projects", { columns: "id,thumb:files!thumbnail_file_id(storage_path)", filters: [eq("id", 268)] })[0];
  assert.ok(t.thumb === null || /\/thumbnail\//.test(t.thumb.storage_path));
  const cf = sel(e, P.lead, "projects", { columns: "id,current_files(id,folder)", filters: [eq("id", 268)] })[0];
  assert.ok(cf.current_files.length > 5);
  assert.ok(!cf.current_files.some((f) => f.folder === "receipts" || f.folder === "estimates"), "money files are not readable by a lead");
  const inner = sel(e, P.lead, "activity", { columns: "id,projects!inner(number)", filters: [eq("projects.number", "A267")] });
  assert.ok(inner.length > 5 && inner.every((r) => r.projects.number === "A267"));
  assert.throws(() => sel(e, P.lead, "projects", { columns: "id,nonsense" }), (x) => x.code === "42703");
});

test("filters, order (nulls last ascending), range and count", () => {
  const e = db();
  const r = e.select(P.lead, "projects", { columns: "id,number,lat", filters: [{ col: "status", op: "in", val: ["in_progress", "approved"] }],
    orders: [{ col: "lat", asc: true }], offset: 0, limit: 5 });
  assert.ok(r.count > 5 && r.data.length === 5);
  assert.ok(r.data.every((x, i, all) => i === 0 || x.lat === null || all[i - 1].lat <= x.lat));
  const all = e.select(P.lead, "projects", { columns: "lat", orders: [{ col: "lat", asc: true }] }).data;
  assert.equal(all[all.length - 1].lat, null, "nulls last when ascending");
  const desc = e.select(P.lead, "projects", { columns: "lat", orders: [{ col: "lat", asc: false }] }).data;
  assert.equal(desc[0].lat, null, "nulls first when descending (PostgREST's default)");
  const or = sel(e, P.lead, "projects", { columns: "number", filters: [{ col: "or", op: "or", val: "number.eq.A024,number.eq.A056-AB" }] });
  assert.deepEqual(or.map((x) => x.number).sort(), ["A024", "A056-AB"]);
  const like = sel(e, P.lead, "projects", { columns: "number", filters: [{ col: "number", op: "ilike", val: "a024-%" }] });
  assert.equal(like.length, 6);
  const nulls = sel(e, P.lead, "projects", { columns: "id", filters: [{ col: "legacy_sp_id", op: "is", val: "null" }] });
  assert.equal(nulls.length, 6);
  const nots = sel(e, P.lead, "projects", { columns: "id", filters: [{ col: "legacy_sp_id", op: "is", val: "null", neg: true }] });
  assert.equal(nots.length + nulls.length, sel(e, P.lead, "projects").length);
});

test("versioned writes: the stale version matches nothing; the policy refuses by matching nothing", () => {
  const e = db();
  const before = sel(e, P.manager, "projects", { filters: [eq("id", 268)] })[0];
  const stale = e.update(P.manager, "projects", { status_note: "x" }, { filters: [eq("id", 268), eq("version", before.version - 1)] });
  assert.deepEqual(stale, []);
  const ok = e.update(P.manager, "projects", { status_note: "x" }, { filters: [eq("id", 268), eq("version", before.version)] });
  assert.equal(ok[0].version, before.version + 1);
  assert.equal(ok[0].updated_by, P.manager.uid);
  assert.deepEqual(e.update(P.field, "projects", { status_note: "y" }, { filters: [eq("id", 268)] }), [], "field cannot update projects");
  assert.deepEqual(e.update(P.lead, "projects", { status_note: "y" }, { filters: [eq("id", 268)] }), [], "nor a lead");
  assert.throws(() => e.update(P.admin, "projects", { legacy_sp_id: 5 }, { filters: [eq("id", 268)] }), (x) => x.code === "42501");
  assert.throws(() => e.update(P.field, "profiles", { role: "admin" }, { filters: [eq("id", P.field.uid)] }), (x) => x.code === "42501");
  const me = e.update(P.field, "profiles", { phone: "(805) 555-0199" }, { filters: [eq("id", P.field.uid)] });
  assert.equal(me[0].phone, "(805) 555-0199");
});

test("a Board move writes the status and one activity line", () => {
  const e = db();
  const p = sel(e, P.manager, "projects", { filters: [{ col: "status", op: "eq", val: "approved" }] })[0];
  const n = e.rows.activity.length;
  e.update(P.manager, "projects", { status: "in_progress" }, { filters: [eq("id", p.id), eq("version", p.version)] });
  const lines = e.rows.activity.slice(n);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, "status");
  assert.equal(lines[0].text, "Status: Approved → In Progress");
  assert.equal(lines[0].created_by, P.manager.uid);
});

test("create_project: the database numbers it, with its prices row and its first log line", () => {
  const e = db();
  const p = e.rpc(P.manager, "create_project", { fields: { name: "Brightwater Deck", city: "Oak Vista", status: "new_request" } });
  assert.equal(p.number, "A306");
  assert.match(p.folder_name, /^A306 - /);
  assert.equal(e.rows.project_prices.find((r) => r.project_id === p.id).labor_rate, 90);
  assert.ok(e.rows.activity.some((a) => a.project_id === p.id && a.text === "Project A306 created"));
  assert.equal(e.rpc(P.admin, "create_project", { fields: { name: "Next" } }).number, "A307");
  assert.throws(() => e.rpc(P.lead, "create_project", { fields: { name: "No" } }), (x) => x.code === "42501");
  assert.throws(() => e.rpc(P.manager, "create_project", { fields: { name: "Y", colour: "red" } }), (x) => x.code === "22023");
  assert.throws(() => e.rpc(P.manager, "create_project", { fields: { name: "Y", labor_rate: 100 } }), (x) => x.code === "42501", "the rate needs prices");
  assert.throws(() => e.rpc(P.manager, "create_project", { fields: { name: " " } }), (x) => x.code === "23514");
});

test("soft_delete: version checked, a tombstone written, gone for everyone but admins", () => {
  const e = db();
  const j = sel(e, P.field, "journal_entries", { filters: [eq("project_id", 268), eq("created_by", P.field.uid)] })[0];
  const other = sel(e, P.field, "journal_entries", { filters: [eq("project_id", 268), { col: "created_by", op: "neq", val: P.field.uid }] })[0];
  assert.throws(() => e.rpc(P.field, "soft_delete", { tbl: "journal_entries", id: j.id, version: j.version + 1 }), (x) => x.code === "PT409");
  if (other) assert.throws(() => e.rpc(P.field, "soft_delete", { tbl: "journal_entries", id: other.id, version: other.version }), (x) => x.code === "42501", "field deletes only their own");
  e.rpc(P.field, "soft_delete", { tbl: "journal_entries", id: j.id, version: j.version });
  assert.equal(sel(e, P.field, "journal_entries", { filters: [eq("id", j.id)] }).length, 0);
  assert.equal(sel(e, P.admin, "journal_entries", { filters: [eq("id", j.id)] }).length, 1, "an admin still sees it");
  assert.ok(e.rows.deletions.some((d) => d.table_name === "journal_entries" && d.row_id === j.id));
  assert.throws(() => e.rpc(P.field, "soft_delete", { tbl: "journal_entries", id: j.id }), (x) => x.code === "PT404");
  assert.throws(() => e.rpc(P.admin, "soft_delete", { tbl: "activity", id: 1 }), (x) => x.code === "22023");
});

test("set_project_location answers Desktop 2's shared cases exactly (stored / reason / source, or the SQLSTATE)", () => {
  const LOC = JSON.parse(readFileSync(new URL("./vectors/project-location-cases.json", import.meta.url), "utf8"));
  assert.ok(LOC.cases.length >= 25);
  const e = db();
  const blank = e.rows.projects.filter((p) => p.lat === null && !p.deleted_at);
  assert.ok(blank.length >= LOC.cases.length, "enough projects without a point");
  LOC.cases.forEach((c, i) => {
    const p = blank[i];
    // "legacy": an untouched import (legacy_sp_id, the import's version 1); otherwise a project of our own
    if (c.legacy) { p.legacy_sp_id = p.legacy_sp_id || 88000 + i; p.version = 1; } else p.legacy_sp_id = null;
    if (c.start) { p.lat = LOC.start_point[0]; p.lng = LOC.start_point[1]; p.location_source = c.start === "unknown" ? null : c.start; }
    const [lat, lng, acc, src] = c.call;
    let got;
    try {
      const r = e.rpc(P[c.who === "manager" ? "manager" : c.who], "set_project_location", { project_id: p.id, lat, lng, accuracy_m: acc, source: src });
      got = { stored: r.stored, reason: r.reason, source: e.rows.projects.find((x) => x.id === p.id).location_source };
      assert.deepEqual(Object.keys(r).sort(), ["id", "lat", "lng", "location_source", "reason", "stored", "version"], "the answer's shape");
    } catch (x) { got = { error: String(x.code) }; }
    assert.deepEqual(got, c.want, c.name);
  });
});

test("set_project_location: PostgREST names only (p_project_id is PGRST202), a missing project is PT404, a plain update by field changes nothing", () => {
  const e = db();
  const empty = e.rows.projects.find((p) => p.lat === null && !p.deleted_at);
  empty.legacy_sp_id = null;                       // one of our own (an untouched import takes no automatic point)
  assert.throws(() => e.rpc(P.field, "set_project_location", { p_project_id: empty.id, p_lat: 35, p_lng: -120, p_source: "gps", p_accuracy_m: 5 }), (x) => x.code === "PGRST202");
  assert.throws(() => e.rpc(P.field, "set_project_location", { project_id: 999999, lat: 35, lng: -120, source: "geocode" }), (x) => x.code === "PT404");
  assert.deepEqual(e.update(P.field, "projects", { lat: 1 }, { filters: [eq("id", empty.id)] }), [], "and not by a plain update");
  const r = e.rpc(P.manager, "set_project_location", { project_id: empty.id, lat: 35.5, lng: -120.7 });
  assert.deepEqual([r.stored, r.reason], [false, "accuracy"], "source defaults to gps, which needs an accuracy");
  e.update(P.admin, "projects", { lat: 35.6, lng: -120.6 }, { filters: [eq("id", empty.id)] });
  assert.equal(e.rows.projects.find((x) => x.id === empty.id).location_source, "manual", "a point moved by hand is manual (t14)");
});

test("password_changed: true when a flag was cleared, false after; the agents account is refused", () => {
  const e = db();
  assert.equal(e.rpc(P.newhire, "password_changed"), true);
  assert.equal(e.rpc(P.newhire, "password_changed"), false);
  assert.throws(() => e.rpc(P.agents, "password_changed"), (x) => x.code === "42501");
});

test("the demo's copy of the location cases is Desktop 2's (when Desktop 2 sits next to this repository)", { skip: !existsSync(D2_CASES) && "DCR Desktop 2 is not next to this repository" }, () => {
  const ours = JSON.parse(readFileSync(new URL("./vectors/project-location-cases.json", import.meta.url), "utf8"));
  const theirs = JSON.parse(readFileSync(D2_CASES, "utf8"));
  assert.deepEqual(ours.cases, theirs.cases);
  assert.deepEqual(ours.start_point, theirs.start_point);
});

test("search: the exact number first, short numbers find their suffixes, phones by digits", () => {
  const e = db();
  const r = e.rpc(P.lead, "search", { q: "A24" });
  assert.deepEqual(r.projects.slice(0, 7).map((p) => p.number), ["A024", "A024-B", "A024-C", "A024-D", "A024-E", "A024-F", "A024-G"]);
  assert.equal(e.rpc(P.lead, "search", { q: "A267" }).projects[0].number, "A267");
  const c = e.rpc(P.lead, "search", { q: "555-0110" }).contacts;
  assert.ok(c.length >= 1);
  assert.deepEqual(e.rpc(P.lead, "search", { q: "x" }), { projects: [], contacts: [], items: [], tasks: [], files: [] });
  assert.ok(!("labor_rate" in r.projects[0]), "no prices in search");
});

test("files: the same name in the same place becomes a version; current_files shows the newest", () => {
  const e = db();
  const mk = (uid) => ({ project_id: 268, folder: "photos", subpath: "2026-10-19", name: "image.jpg",
    storage_path: "p/268/photos/" + uid.repeat(32).slice(0, 32) + "/image.jpg", size: 10, mime: "image/jpeg", source: "portal2" });
  const a = e.insert(P.field, "files", mk("a"))[0];
  const b = e.insert(P.field, "files", mk("b"))[0];
  assert.equal(b.version_no, 2);
  assert.equal(b.previous_id, a.id);
  const cur = sel(e, P.field, "current_files", { filters: [eq("name", "image.jpg")] });
  assert.deepEqual(cur.map((f) => f.id), [b.id]);
  assert.throws(() => e.insert(P.field, "files", mk("a")), (x) => x.code === "23505");
  assert.throws(() => e.insert(P.viewer, "files", mk("c")), (x) => x.code === "42501");
  assert.throws(() => e.insert(P.field, "files", Object.assign(mk("d"), { storage_path: "p/1/photos/x/image.jpg" })), (x) => x.code === "23514");
  assert.throws(() => e.insert(P.field, "files", Object.assign(mk("e"), { source: "elsewhere" })), (x) => x.code === "23514");
});

test("activity notes: leads write, field read; imported lines are refused to people", () => {
  const e = db();
  assert.equal(e.insert(P.lead, "activity", { project_id: 268, kind: "note", text: "Checked the shear walls." })[0].created_by, P.lead.uid);
  assert.throws(() => e.insert(P.field, "activity", { project_id: 268, kind: "note", text: "x" }), (x) => x.code === "42501");
  assert.throws(() => e.insert(P.admin, "activity", { project_id: 268, kind: "system", text: "x" }), (x) => x.code === "42501");
  assert.throws(() => e.insert(P.admin, "activity", { project_id: 268, kind: "note", text: "x", author_name: "Someone" }), (x) => x.code === "42501");
  assert.throws(() => e.insert(P.lead, "activity", { project_id: 268, kind: "note", text: "" }), (x) => x.code === "23514");
  assert.throws(() => e.insert(P.lead, "activity", { project_id: 268, kind: "note", text: "x", colour: 1 }), (x) => x.code === "PGRST204");
});

test("journal: field write their own entries (Q4), each writes its log line", () => {
  const e = db();
  const n = e.rows.activity.length;
  const j = e.insert(P.field, "journal_entries", { project_id: 268, title: "Rain", category: "weather" })[0];
  assert.equal(j.entry_date, "2026-10-19", "the Pacific day by default");
  assert.equal(e.rows.activity.slice(n)[0].text, "Journal entry: Rain");
  assert.equal(e.update(P.field, "journal_entries", { body: "mine" }, { filters: [eq("id", j.id)] }).length, 1);
  const theirs = sel(e, P.field, "journal_entries", { filters: [eq("project_id", 268), { col: "created_by", op: "neq", val: P.field.uid }] })[0];
  if (theirs) assert.deepEqual(e.update(P.field, "journal_entries", { body: "not mine" }, { filters: [eq("id", theirs.id)] }), []);
  assert.throws(() => e.insert(P.viewer, "journal_entries", { project_id: 268, title: "x" }), (x) => x.code === "42501");
});

test("tasks: field and view-only see their own and the ones they created (Q3)", () => {
  const e = db();
  const all = sel(e, P.manager, "tasks");
  const mine = sel(e, P.field, "tasks");
  assert.ok(all.length > mine.length && mine.length > 0);
  assert.ok(mine.every((t) => t.assigned_to === P.field.uid || t.created_by === P.field.uid));
  assert.equal(sel(e, P.lead, "tasks").length, all.length);
});

test("storage: path rules, no overwrite, readable only through a readable files row", () => {
  const e = db();
  const key = "p/268/photos/" + "f".repeat(32) + "/a.jpg";
  e.storage.upload(P.field, key, 10, "image/jpeg", null, false);
  assert.throws(() => e.storage.upload(P.field, key, 10, "image/jpeg", null, false), (x) => x.statusCode === "409");
  assert.throws(() => e.storage.upload(P.viewer, "p/268/photos/" + "e".repeat(32) + "/a.jpg", 10, "image/jpeg"), (x) => x.statusCode === "403");
  assert.throws(() => e.storage.upload(P.field, "p/268/receipts/" + "e".repeat(32) + "/a.jpg", 10, "image/jpeg"), (x) => x.statusCode === "403");
  assert.throws(() => e.storage.upload(P.field, "p/268/estimates/" + "e".repeat(32) + "/a.pdf", 10, "application/pdf"), (x) => x.statusCode === "403");
  assert.throws(() => e.storage.sign(P.field, key), (x) => x.statusCode === "404", "no row yet: not readable");
  const receipt = e.rows.files.find((f) => f.folder === "receipts");
  assert.throws(() => e.storage.sign(P.lead, receipt.storage_path));
  assert.ok(e.storage.sign(P.admin, receipt.storage_path));
  const withPreview = e.rows.files.find((f) => f.preview_path && f.project_id === 268);
  assert.ok(e.storage.sign(P.field, withPreview.preview_path), "a preview is readable whenever its file row is");
  assert.throws(() => e.storage.sign(P.agents, withPreview.storage_path));
});

test("set_project_location: the demo's untouched imports keep version 1 (Board fold, Desktop 2's dormant) whatever a phone reports", () => {
  const e = db();
  const imports = e.rows.projects.filter((p) => p.legacy_sp_id && Number(p.version) === 1 && p.lat === null && !p.deleted_at);
  assert.ok(imports.length >= 3, "the seed has untouched imports without a point");
  const [a, b, c] = imports;
  const r1 = e.rpc(P.field, "set_project_location", { project_id: a.id, lat: 35.5, lng: -120.7, accuracy_m: 8, source: "gps" });
  const r2 = e.rpc(P.lead, "set_project_location", { project_id: b.id, lat: 35.5, lng: -120.7, source: "geocode" });
  assert.deepEqual([r1.stored, r1.reason, r2.stored, r2.reason], [false, "old_portal", false, "old_portal"]);
  assert.deepEqual([a.version, b.version, a.lat, b.lat], [1, 1, null, null], "nothing written");
  const r3 = e.rpc(P.manager, "set_project_location", { project_id: c.id, lat: 35.5, lng: -120.7, source: "manual" });
  assert.equal(r3.stored, true, "placed by hand: a change like any other");
  assert.equal(e.rows.projects.find((x) => x.id === c.id).version, 2);
});
