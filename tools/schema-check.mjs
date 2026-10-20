#!/usr/bin/env node
/* DCR Portal 2 — Portal 2's queries against the REAL database rules (development only).

     PGLITE_DIR=<folder with node_modules/@electric-sql/pglite> node tools/schema-check.mjs [--verbose]

   Loads every DCR Desktop 2 migration (supabase/migrations, including M1 20261020000100_portal2_foundation)
   into PGlite with Desktop 2's own loader (tools/pglite_check/lib.mjs), makes made-up people for every
   role, then runs PORTAL 2'S OWN CODE — site/js/sb.js (sign-in, me(), password change),
   site/js/repo/*.js, the upload queue (site/js/upload-queue2.js createQueue + filesDb, over a Storage
   stand-in that writes storage.objects under its RLS) and site/js/live.js (private channels) — over
   tools/pglite-rest.mjs, which turns each supabase-js call into the SQL the Data API would run, as that
   person. So every table, column, embed, RPC parameter name and policy the pages rely on is the
   database's own, and the expected rows and refusals are asserted per role (admin, manager without
   prices — the owner's Q1 —, a manager with prices, accountant, lead, field, viewer, the agents
   account, an inactive account, a person with a temporary password).

   DCR Desktop 2 is looked for in DCR_DESKTOP2_DIR, else next to this repository ("../DCR Desktop 2").
   Nothing here talks to Supabase. Exit code 0 = every check passed. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadCatalog, makeClient } from "./pglite-rest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const SITE = path.join(REPO, "site");
const D2 = path.resolve(process.env.DCR_DESKTOP2_DIR || path.join(REPO, "..", "DCR Desktop 2"));
const VERBOSE = process.argv.includes("--verbose");
const LIB = path.join(D2, "tools", "pglite_check", "lib.mjs");
if (!existsSync(LIB)) {
  console.error("DCR Desktop 2 not found at " + D2 + " (set DCR_DESKTOP2_DIR)");
  process.exit(2);
}
const { freshDatabase } = await import(pathToFileURL(LIB).href);

/* ── the database ─────────────────────────────────────────────────────── */
const t0 = Date.now();
const { db, steps } = await freshDatabase();
const catalog = await loadCatalog(db);
const sql = async (text, params) => (await db.query(text, params || [])).rows;
const one = async (text, params) => (await sql(text, params))[0];

/* made-up people (no real names; passwords exist only in this run) */
const PEOPLE = {
  admin: { id: "c2000000-0000-4000-8000-000000000001", name: "Ada Admin", role: "admin" },
  manager: { id: "c2000000-0000-4000-8000-000000000002", name: "Max Manager", role: "manager" },
  manager2: { id: "c2000000-0000-4000-8000-000000000003", name: "Mia Pricer", role: "manager", prices: true },
  accountant: { id: "c2000000-0000-4000-8000-000000000004", name: "Ace Accountant", role: "accountant" },
  lead: { id: "c2000000-0000-4000-8000-000000000005", name: "Lee Lead", role: "lead" },
  field: { id: "c2000000-0000-4000-8000-000000000006", name: "Flo Field", role: "field" },
  field2: { id: "c2000000-0000-4000-8000-000000000007", name: "Fay Field", role: "field" },
  viewer: { id: "c2000000-0000-4000-8000-000000000008", name: "Vi Viewer", role: "viewer" },
  agents: { id: "c2000000-0000-4000-8000-000000000009", name: "Agents Pc", role: "agents" },
  inactive: { id: "c2000000-0000-4000-8000-00000000000a", name: "Ina Inactive", role: "lead", active: false },
  newhire: { id: "c2000000-0000-4000-8000-00000000000b", name: "Ned Newhire", role: "field", temp: true },
};
const email = (k) => k + "@schema-check.test";
const passwords = Object.fromEntries(Object.keys(PEOPLE).map((k) => [email(k), "check-" + k + "-2026"]));

await sql("reset role");
for (const [k, p] of Object.entries(PEOPLE)) {
  await sql("insert into auth.users (id, email) values ($1, $2)", [p.id, email(k)]);
}
await sql("insert into public.profiles (id, full_name, email, role) values ($1, $2, $3, 'admin')", [PEOPLE.admin.id, PEOPLE.admin.name, email("admin")]);
await sql("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: PEOPLE.admin.id, role: "authenticated" })]);
await sql("set role authenticated");
for (const [k, p] of Object.entries(PEOPLE)) {
  if (k === "admin") continue;
  await sql(`insert into public.profiles (id, full_name, email, role, active, can_see_prices, must_change_password)
             values ($1, $2, $3, $4, $5, $6, $7)`,
    [p.id, p.name, email(k), p.role, p.active !== false, p.prices ? true : null, !!p.temp]);
}
await sql("reset role");
await sql("select set_config('request.jwt.claims', '', false)");

/* ── Portal 2's own modules over the database ─────────────────────────── */
const client = makeClient({ db, catalog, passwords });
globalThis.DCR2_CONFIG = { SUPABASE_URL: "https://pglite.invalid", SUPABASE_KEY: "sb_publishable_schema_check", SITE_URL: "https://portal.dcrframing.com", COMPANY_NAME: "DCR" };
globalThis.supabase = { createClient: () => client };
const site = (p) => import(pathToFileURL(path.join(SITE, "js", p)).href);
const sbm = await site("sb.js");
const projects = await site("repo/projects.js");
const activity = await site("repo/activity.js");
const journal = await site("repo/journal.js");
const files = await site("repo/files.js");
const search = await site("repo/search.js");
const people = await site("repo/people.js");
const uq = await site("upload-queue2.js");
const live = await site("live.js");
const geo = await site("map/geo.js");
const common2 = await site("common2.js");
const jsync = await site("pages/journal-sync.js");

/** Calls as `key` from here on (and forgets what the modules remembered for the last person). */
async function as(key) {
  client.as(key ? PEOPLE[key].id : null);
  people.clearPeople();
  projects.forgetProjects();
  files.forgetThumbnails();
  if (key) await sbm.me({ fresh: true }).catch(() => null);
}

/* ── checks ───────────────────────────────────────────────────────────── */
const results = [];
let section = "";
async function check(name, fn) {
  try {
    await fn();
    results.push({ section, name, ok: true });
  } catch (e) {
    results.push({ section, name, ok: false, error: (e && e.code ? e.code + " " : "") + (e && e.message ? e.message : String(e)) });
    if (VERBOSE) console.error(e);
  } finally {
    await as(null);
  }
}
class Fail extends Error {}
const ok = (c, m) => { if (!c) throw new Fail(m); };
const same = (a, b, m) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Fail(m + ": expected " + y + ", got " + x); };
async function refused(fn, code, m) {
  try { await fn(); } catch (e) {
    if (e instanceof Fail) throw e;
    if (code && String(e.code) !== code) throw new Fail(m + ": expected " + code + ", got " + e.code + " " + e.message);
    return e;
  }
  throw new Fail(m + ": expected a refusal " + (code || "") + ", but it was allowed");
}
const ROLES = ["admin", "manager", "manager2", "accountant", "lead", "field", "viewer"];
const ACTIVE_WRITERS = { notes: ["admin", "manager", "manager2", "accountant", "lead"], journal: ["admin", "manager", "manager2", "lead", "field"] };
const S = {};

// ===========================================================================================
section = "schema";
// ===========================================================================================
await check("every table, view and RPC named in site/js exists in the migrations (push_subscriptions: M3, unused until a VAPID key is set)", async () => {
  const src = [];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p); else if (/\.js$/.test(d.name)) src.push(readFileSync(p, "utf8"));
  });
  walk(path.join(SITE, "js"));
  const all = src.join("\n");
  const tables = new Set([...all.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]));
  const rpcs = new Set([...all.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]));
  const watched = new Set([...all.matchAll(/watch\("([a-z_]+)"/g)].map((m) => m[1]));
  const missingT = [...tables].filter((t) => !catalog.tables[t] && t !== "project-files");
  const missingF = [...rpcs].filter((f) => !catalog.functions[f]);
  same(missingT, ["push_subscriptions"], "tables / views not in the schema");
  same(missingF, [], "RPCs not in the schema");
  ok(tables.has("projects") && tables.has("current_files") && rpcs.has("set_project_location") && rpcs.has("password_changed"), "the scan found the calls");
  const pub = new Set((await sql("select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'")).map((r) => r.tablename));
  const notLive = [...watched, "deletions"].filter((t) => !pub.has(t));
  same(notLive, [], "watched tables missing from the supabase_realtime publication");
  for (const t of watched) ok(catalog.tables.deletions.cols.table_name && catalog.tables.deletions.cols.row_id, "tombstones: deletions(table_name, row_id) " + t);
});

await check("the M1 columns and RPC signatures the pages use", async () => {
  for (const [t, c] of [["profiles", "must_change_password"], ["projects", "location_source"], ["files", "description"],
    ["files", "preview_path"], ["files", "source"], ["current_files", "description"], ["current_files", "preview_path"], ["current_files", "source"]]) {
    ok(catalog.tables[t] && catalog.tables[t].cols[c], t + "." + c);
  }
  same(catalog.functions.set_project_location.map((f) => f.args.map((a) => a.name)), [["project_id", "lat", "lng", "accuracy_m", "source"]], "set_project_location(...)");
  same(catalog.functions.password_changed.map((f) => [f.args.length, f.rettype]), [[0, "boolean"]], "password_changed()");
  same(catalog.functions.soft_delete.map((f) => f.args.map((a) => a.name)), [["tbl", "id", "version"]], "soft_delete(...)");
  same(catalog.functions.create_project.map((f) => f.args.map((a) => a.name)), [["fields"]], "create_project(fields)");
  same(catalog.functions.search.map((f) => f.args.map((a) => a.name)), [["q"]], "search(q)");
});

await check("the stand-in answers as PostgREST would: an ambiguous embed is PGRST201, an unknown column 42703, an unknown RPC argument PGRST202", async () => {
  client.as(PEOPLE.admin.id);
  same((await client.from("projects").select("*, files(*)").limit(1)).error.code, "PGRST201", "projects <-> files has two foreign keys");
  ok(!(await client.from("activity").select("*, projects(number, name)").limit(1)).error, "activity -> projects is one relationship");
  same((await client.from("projects").select("nope").limit(1)).error.code, "42703", "unknown column");
  same((await client.rpc("set_project_location", { p_project_id: 1, p_lat: 1, p_lng: 1 })).error.code, "PGRST202", "the blueprint's p_ names are not the function's");
  client.as(null);
  same((await client.from("projects").select("id").limit(1)).error.code, "42501", "anonymous: refused");
});

// ===========================================================================================
section = "sign-in (site/js/sb.js)";
// ===========================================================================================
await check("every active role signs in; me() gives the page's shape with the switches as the database has them (Q1)", async () => {
  const want = { admin: [true, true, true], manager: [false, false, false], manager2: [true, false, false], accountant: [true, true, false],
    lead: [false, false, false], field: [false, false, false], viewer: [false, false, false] };
  for (const k of ROLES) {
    client.as(null);
    const p = await sbm.signIn(email(k), passwords[email(k)], true);
    same([p.role, p.name, p.can_see_prices, p.can_see_financials, p.can_approve_payments, p.must_change_password, p.active],
      [PEOPLE[k].role, PEOPLE[k].name, ...want[k], false, true], k);
    await sbm.signOut();
    ok(client.uid === null, k + " signed out");
  }
});

await check("the agents account and an inactive account are refused (\"This account is not active\") and left signed out", async () => {
  for (const k of ["agents", "inactive"]) {
    client.as(null);
    const e = await refused(() => sbm.signIn(email(k), passwords[email(k)], false), "account_inactive", k);
    ok(/not active/.test(e.message), k + ": " + e.message);
    ok(client.uid === null, k + " is signed out again");
  }
  await refused(() => sbm.signIn(email("lead"), "wrong-password-1", false), "invalid_credentials", "a wrong password");
});

await check("a temporary password: me() says so; changePassword() clears the flag through password_changed() (true once)", async () => {
  client.as(null);
  const p = await sbm.signIn(email("newhire"), passwords[email("newhire")], false);
  ok(p.must_change_password === true, "flag read from profiles.must_change_password");
  await refused(() => sbm.changePassword("short1"), "weak_password", "Desktop 2's password rule");
  await sbm.changePassword("framing2026x", passwords[email("newhire")]);
  const again = await sbm.me({ fresh: true });
  ok(again.must_change_password === false, "flag cleared");
  same((await client.rpc("password_changed")).data, false, "a second call clears nothing");
  await refused(async () => {
    const r = await client.from("profiles").update({ must_change_password: true }).eq("id", PEOPLE.newhire.id).select();
    if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
  }, "42501", "people cannot set the flag on themselves");
});

await check("settings: a versioned PATCH of the own name / phone / colour; role and switches refused; stale version matches nothing", async () => {
  await as("lead");
  const p = await sbm.me({ fresh: true });
  const r = await client.from("profiles").update({ phone: "(805) 555-0142", color: "#059669" }).eq("id", p.id).eq("version", p.version).select();
  ok(!r.error && r.data.length === 1 && r.data[0].version === p.version + 1, "saved with the version " + JSON.stringify(r.error));
  const stale = await client.from("profiles").update({ phone: "(805) 555-0143" }).eq("id", p.id).eq("version", p.version).select();
  ok(!stale.error && stale.data.length === 0, "the old version matches nothing (\"changed somewhere else\")");
  const bad = await client.from("profiles").update({ role: "admin" }).eq("id", p.id).select();
  same(bad.error && bad.error.code, "42501", "role change");
  const sw = await client.from("profiles").update({ can_see_prices: true }).eq("id", p.id).select();
  same(sw.error && sw.error.code, "42501", "switch change");
});

await check("colleagues (Q29 = yes): every active person reads every colleague's name, e-mail and phone; the agents account only itself", async () => {
  for (const k of ["field", "viewer", "lead"]) {
    await as(k);
    const list = await people.listPeople();
    ok(list.size === Object.keys(PEOPLE).length, k + " reads everyone: " + list.size);
    const r = await client.from("profiles").select("id, email, phone").eq("id", PEOPLE.lead.id);
    ok(r.data.length === 1 && r.data[0].email === email("lead"), k + " reads a colleague's e-mail");
  }
  await as("agents");
  const own = await client.from("profiles").select("id, role");
  same(own.data.map((r) => r.role), ["agents"], "agents: its own row only");
});

// ===========================================================================================
section = "projects (repo/projects.js)";
// ===========================================================================================
await check("create_project: admin and manager get a database number; lead, field, viewer refused", async () => {
  await as("admin");
  S.p1 = await projects.createProject({ projectName: "Sandbox Residence", projectAddress: "100 Sample Rd", projectCity: "Paso Robles" });
  ok(/^A\d{3,}$/.test(S.p1.internalIDNumber) && S.p1.estimateStatus === "Recived", "number and status: " + S.p1.internalIDNumber + " " + S.p1.estimateStatus);
  await as("manager");
  S.p2 = await projects.createProject({ projectName: "Hillside Barn", projectCity: "Templeton" });
  ok(S.p2.id !== S.p1.id, "a second project");
  for (const k of ["lead", "field", "viewer", "accountant"]) {
    await as(k);
    await refused(() => projects.createProject({ projectName: "Nope" }), "42501", k);
  }
});

await check("loadProjects(): every active role reads every live project; the agents account and an inactive one read none", async () => {
  for (const k of ROLES) {
    await as(k);
    const list = await projects.loadProjects({ fresh: true });
    ok(list.length === 2 && list.every((p) => p.internalIDNumber && p.estimateStatus), k + ": " + list.length);
  }
  for (const k of ["agents", "inactive"]) {
    await as(k);
    same((await projects.loadProjects({ fresh: true })).length, 0, k);
  }
});

await check("getProject(): the prices embed is an object only with the prices switch — admin, accountant, a manager given prices; null for a manager by default (Q1), lead, field, viewer", async () => {
  const want = { admin: true, manager: false, manager2: true, accountant: true, lead: false, field: false, viewer: false };
  for (const k of ROLES) {
    await as(k);
    const p = await projects.getProject(S.p1.id);
    ok((p.prices !== null && typeof p.prices === "object") === want[k], k + ": prices " + JSON.stringify(p.prices));
    if (!want[k]) ok(p.projectLaborRate === null, k + ": no rate");
    const direct = await client.from("project_prices").select("*").eq("project_id", S.p1.id);
    same(direct.data.length, want[k] ? 1 : 0, k + ": project_prices through REST");
  }
});

await check("setStatus(): a manager's Board move writes the status and exactly one status line; lead, field, viewer refused (42501)", async () => {
  await as("manager");
  const before = Number((await one("select count(*) as n from public.activity where project_id = $1 and kind = 'status'", [S.p1.id])).n);
  const p = await projects.getProject(S.p1.id);
  const moved = await projects.setStatus(p, "Estimating");
  same([moved.status, moved.estimateStatus, moved.version], ["estimating", "Estimating", p.version + 1], "moved");
  const after = Number((await one("select count(*) as n from public.activity where project_id = $1 and kind = 'status'", [S.p1.id])).n);
  same(after - before, 1, "one status line");
  for (const k of ["lead", "field", "viewer", "accountant"]) {
    await as(k);
    const q = await projects.getProject(S.p1.id);
    await refused(() => projects.setStatus(q, "in_progress"), "42501", k);
  }
  await as("manager");
  await refused(() => projects.setStatus(p, "approved"), "PT409", "a stale version is \"changed by someone else\"");
});

await check("updateProject(): Overview autosave is versioned; a stale version gives PT409 with the row now; the labor rate needs prices", async () => {
  await as("manager");
  let p = await projects.getProject(S.p1.id);
  p = await projects.updateProject(p, { projectClientName: "Pat Example", checkTagNames: ["ADU", "Remodel"], projectStartDate: "2026-10-26" });
  same([p.projectClientName, p.checkTagNames, p.projectStartDate], ["Pat Example", ["ADU", "Remodel"], "2026-10-26"], "saved");
  const e = await refused(() => projects.updateProject(Object.assign({}, p, { version: p.version - 1 }), { projectCity: "Atascadero" }), "PT409", "stale");
  ok(e.current && e.current.version === p.version, "the conflict carries the row as it is now");
  await refused(() => projects.updateProject(p, { projectLaborRate: 95 }), "42501", "manager without prices: the rate");
  await as("manager2");
  p = await projects.getProject(S.p1.id);
  const q = await projects.updateProject(p, { projectLaborRate: 97.5 });
  same([q.projectLaborRate, q.prices.rate_source], [97.5, "custom"], "manager with prices sets the rate");
  await as("lead");
  p = await projects.getProject(S.p1.id);
  await refused(() => projects.updateProject(p, { projectName: "Lead edit" }), "42501", "lead");
  await as("field");
  same((await client.from("projects").update({ name: "x" }).eq("id", S.p1.id).select()).data, [], "field cannot update projects (P1 check 3)");
});

await check("the live default writer (DCR2.live versionedWriter) PATCHes projects with the version and re-reads", async () => {
  await as("admin");
  const p = await projects.getProject(S.p2.id);
  const w = common2.versionedWriter("projects", p.id);
  const row = await w.save({ status_note: "Waiting on plans" }, p.version);
  same([row.status_note, row.version], ["Waiting on plans", p.version + 1], "saved");
  same(await w.save({ status_note: "x" }, p.version), null, "a stale version matches nothing");
  same((await w.reread()).version, p.version + 1, "re-read");
});

// ===========================================================================================
section = "project location (rpc set_project_location)";
// ===========================================================================================
const LOC_FILE = path.join(D2, "tools", "pglite_check", "project_location_cases.json");
const LOC = JSON.parse(readFileSync(LOC_FILE, "utf8"));
await check(`repo setLocation() answers the shared cases (${LOC.cases.length}, Desktop 2's project_location_cases.json) and map/geo.js pinRule() agrees with every stored / refused answer`, async () => {
  const bad = [];
  let legacyN = 0;
  for (const c of LOC.cases) {
    let p;
    if (c.legacy) {
      // an untouched import from the old portal: written by the import (the owner), still version 1
      legacyN++;
      const f = { number: "A8" + String(200 + legacyN), name: "Pin case " + c.name.slice(0, 40), legacy_sp_id: 87000 + legacyN };
      if (c.start) Object.assign(f, { lat: LOC.start_point[0], lng: LOC.start_point[1], location_source: c.start });
      const cols = Object.keys(f);
      p = await one("insert into public.projects (" + cols.join(", ") + ") values (" + cols.map((_c, i) => "$" + (i + 1)).join(", ") + ") returning *",
        cols.map((k) => f[k]));
    } else {
      await as("admin");
      p = await projects.createProject({ projectName: "Pin case " + c.name.slice(0, 40) });
    }
    if (c.start && !c.legacy) {
      await sql("update public.projects set lat = $2, lng = $3, location_source = $4 where id = $1",
        [p.id, LOC.start_point[0], LOC.start_point[1], c.start === "unknown" ? null : c.start]);
    }
    await as(c.who);
    const [lat, lng, acc, src] = c.call;
    let got;
    try {
      const r = await projects.setLocation(p.id, lat, lng, acc, src);
      const now = await one("select location_source from public.projects where id = $1", [p.id]);
      got = { stored: r.stored, reason: r.reason, source: now.location_source };
    } catch (e) { got = { error: String(e.code) }; }
    if (JSON.stringify(got) !== JSON.stringify(c.want)) bad.push(c.name + ": " + JSON.stringify(got));
    if (!c.want.error && c.who !== "viewer") {
      const cur = c.start ? { src: c.start === "unknown" ? null : c.start } : null;
      const rule = geo.pinRule(cur, { lat, lng, src: String(src).trim().toLowerCase(), accuracy: acc }, PEOPLE[c.who].role, !!c.legacy);
      const want = c.want.stored ? "store" : c.want.reason;
      if (rule !== want) bad.push("pinRule " + c.name + ": " + rule + " (database: " + want + ")");
    }
    await sql("delete from public.projects where id = $1", [p.id]).catch(() => {});
  }
  same(bad, [], "cases that differ");
  await as("agents");
  await refused(() => projects.setLocation(S.p1.id, 35.5, -120.7, 8, "gps"), "42501", "agents");
});

// ===========================================================================================
section = "project log (repo/activity.js)";
// ===========================================================================================
await check("addNote(): admin, managers, accountant and lead write notes; field and viewer refused", async () => {
  for (const k of ROLES) {
    await as(k);
    if (ACTIVE_WRITERS.notes.includes(k)) {
      const line = await activity.addNote(S.p1.id, "Note from " + k);
      same([line.logDescription, line.logUserName, line.kind], ["Note from " + k, PEOPLE[k].name, "note"], k);
    } else {
      await refused(() => activity.addNote(S.p1.id, "Note from " + k), "42501", k);
    }
  }
});

await check("forProject() and inWindow() (embed projects(number, name)) read for every active role, nothing for the agents account", async () => {
  const from = new Date(Date.now() - 3600e3).toISOString(), to = new Date(Date.now() + 3600e3).toISOString();
  for (const k of ROLES) {
    await as(k);
    const lines = await activity.forProject(S.p1.id, { limit: 300 });
    ok(lines.length >= 6 && lines.some((l) => l.kind === "status"), k + ": " + lines.length);
    const win = await activity.inWindow(from, to);
    ok(win.length >= lines.length && win.every((l) => l.projectNumber), k + ": the window carries the project numbers");
  }
  await as("agents");
  same((await activity.forProject(S.p1.id)).length, 0, "agents");
  same((await activity.inWindow(from, to)).length, 0, "agents window");
});

// ===========================================================================================
section = "journal (repo/journal.js)";
// ===========================================================================================
await check("create(): admin, managers, lead and field write entries (Q4); accountant and viewer refused; each new entry logs \"Journal entry: <title>\"", async () => {
  for (const k of ROLES) {
    await as(k);
    if (ACTIVE_WRITERS.journal.includes(k)) {
      const e = await journal.create(S.p1.id, { date: "2026-10-19", cat: "progress", title: "Walls up " + k, body: "North wall framed.", crew: "4", hrs: "8", wx: "Clear" });
      same([e.title, e.journalAuthor], ["Walls up " + k, PEOPLE[k].name], k);
      S["j_" + k] = e;
    } else {
      await refused(() => journal.create(S.p1.id, { title: "Nope " + k, body: "x" }), "42501", k);
    }
  }
  const log = await sql("select count(*)::int as n from public.activity where project_id = $1 and text like 'Journal entry: Walls up %'", [S.p1.id]);
  same(log[0].n, ACTIVE_WRITERS.journal.length, "one log line per entry");
});

await check("the journal drafts (pages/journal-sync.js) over the real rules: an entry kept offline is created by field, only changed columns are sent, a lead's correction of the same entry survives (PT409 -> merged), a field both changed keeps theirs", async () => {
  const mem = new Map();
  const bound = [];
  const eng = jsync.createSync({
    storage: { get: (k) => (mem.has(k) ? mem.get(k) : null), set: (k, v) => { if (v == null) mem.delete(k); else mem.set(k, v); }, keys: () => Array.from(mem.keys()) },
    bindEntry: async (key, id) => { bound.push([key, id]); }, lock: (fn) => fn(), online: () => true,
  });
  const me = PEOPLE.field.id, pid = String(S.p1.id);
  await as("field");
  eng.write(me, pid, { date: "2026-10-19", cat: "progress", title: "Shear walls (sync)", body: "Nailing at 6in edge, 12in field.", localKey: "jrn:sync:1",
    media: [{ qid: "q1", landed: false }] });
  const swept = await eng.sweep(me);
  same(swept.map((x) => x.result.state), ["saved"], "the sweep created it");
  const d = eng.read(me, pid);
  ok(d.id && d.base && d.base.title === "Shear walls (sync)", "row + base");
  same(bound, [["jrn:sync:1", d.id]], "its photos released");
  await as("lead");
  const lead = (await journal.list(S.p1.id)).find((e) => e.id === d.id);
  await journal.patchRow(lead.id, lead.version, { body: "Nailing at 4in edge, 12in field (lead)." });
  await as("field");
  const d2 = eng.read(me, pid); d2.wx = "Clear, 78F"; eng.write(me, pid, d2);
  const r = await eng.sync(me, pid);
  same([r.state, r.adopted.body], ["saved", "Nailing at 4in edge, 12in field (lead)."], "theirs adopted");
  const row = await one("select body, weather, version from public.journal_entries where id = $1", [d.id]);
  same([row.body, row.weather], ["Nailing at 4in edge, 12in field (lead).", "Clear, 78F"], "both kept");
  await as("lead");
  const again = (await journal.list(S.p1.id)).find((e) => e.id === d.id);
  await journal.patchRow(again.id, again.version, { title: "Shear walls (lead)" });
  await as("field");
  const d3 = eng.read(me, pid); d3.title = "Shear walls (field)"; eng.write(me, pid, d3);
  const r2 = await eng.sync(me, pid);
  same(r2.conflicts, { title: "Shear walls (field)" }, "both changed the title: theirs kept, mine offered");
  same((await one("select title from public.journal_entries where id = $1", [d.id])).title, "Shear walls (lead)", "not overwritten");
  await as("field2");
  const other = jsync.createSync({ storage: { get: () => JSON.stringify(Object.assign(jsync.draftOfEntry(Object.assign({}, again, { version: 99 })), { body: "x" })), set: () => {}, keys: () => [] },
    bindEntry: async () => {}, lock: (fn) => fn(), online: () => true });
  same((await other.sync(PEOPLE.field2.id, pid)).state, "refused", "another field person's change of it is refused (Q4)");
  await sql("delete from public.journal_entries where id = $1", [d.id]);        // the owner: gone for the counts below
});

await check("update(): field edits only their own entry; another field person refused; a lead edits anyone's; remove() soft-deletes", async () => {
  await as("field");
  const mine = (await journal.list(S.p1.id)).find((e) => e.id === S.j_field.id);
  const upd = await journal.update(mine, { date: "2026-10-19", cat: "issue", title: "Walls up (2)", body: "Fixed.", crew: "4", hrs: "8" });
  same(upd.title, "Walls up (2)", "own entry");
  const leads = (await journal.list(S.p1.id)).find((e) => e.id === S.j_lead.id);
  await refused(() => journal.update(leads, { title: "Field edits lead" }), "42501", "field on the lead's entry");
  await as("field2");
  const flos = (await journal.list(S.p1.id)).find((e) => e.id === S.j_field.id);
  await refused(() => journal.update(flos, { title: "Not mine" }), "42501", "another field person");
  await as("lead");
  const theirs = (await journal.list(S.p1.id)).find((e) => e.id === S.j_field.id);
  const byLead = await journal.update(theirs, { title: "Walls up (3)" });
  same(byLead.title, "Walls up (3)", "lead edits field's entry");
  await as("field");
  await refused(() => journal.update(mine, { title: "stale" }), "PT409", "a stale version");
  await as("viewer");
  ok((await journal.list(S.p1.id)).length === ACTIVE_WRITERS.journal.length, "viewer reads them");
  await as("manager");
  const m = (await journal.list(S.p1.id)).find((e) => e.id === S.j_manager.id);
  await journal.remove(m);
  ok(!(await journal.list(S.p1.id)).some((e) => e.id === m.id), "removed (soft delete)");
  await as("agents");
  same((await journal.list(S.p1.id)).length, 0, "agents read no journal");
});

// ===========================================================================================
section = "files and the upload queue (upload-queue2.js, repo/files.js)";
// ===========================================================================================
function queueFor(key, preview) {
  const store = new Map();
  const timers = [];
  const q = uq.createQueue({
    store: {
      put: async (v) => { store.set(v.id, Object.assign({}, v)); },
      del: async (id) => { store.delete(id); },
      all: async () => Array.from(store.values()).map((v) => Object.assign({}, v)),
    },
    send: async (req) => {
      const u = new URL(req.url);
      const r = await client.storageHttp(req.method, u.pathname, req.headers, req.body);
      if (req.onProgress && r.status < 300 && req.body) req.onProgress(req.body.size);
      return { status: r.status, header: (n) => (r.headers[n.toLowerCase()] ?? null), text: () => r.text };
    },
    auth: async () => ({ url: "https://pglite.invalid", apikey: "sb_publishable_schema_check", token: "pglite-" + PEOPLE[key].id }),
    owner: () => PEOPLE[key].id,
    db: uq.filesDb(() => client),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    makePreview: preview ? async (_f, mime) => (/^image\//.test(mime) ? new Blob([new Uint8Array(900)], { type: "image/jpeg" }) : null) : async () => null,
  });
  return { q, store };
}
const jpeg = (n) => new File([new Uint8Array(n || 2048)], "image.jpg", { type: "image/jpeg" });
const TAKEN = "2026-10-19T17:30:12Z";      // 10:30:12 am in Paso Robles

await check("a photo from Site Photos (field): object + preview uploaded under Storage's rules, then the files row (photos/<day>, caption, preview_path, source portal2)", async () => {
  await as("field");
  const { q, store } = queueFor("field", true);
  await q.enqueue({ projectId: S.p1.id, file: jpeg(), kind: "photo", caption: "North wall", takenAt: TAKEN });
  await q.drain();
  same([...store.values()].map((r) => r.error), [], "nothing left in the queue");
  const f = await one("select * from public.files where project_id = $1 and source = 'portal2' order by id desc limit 1", [S.p1.id]);
  same([f.folder, f.subpath, f.name, f.description, f.storage, f.version_no, f.created_by],
    ["photos", "2026-10-19", "IMG 2026-10-19 10.30.12.jpg", "North wall", "cloud", 1, PEOPLE.field.id], "the row");
  ok(/^p\/\d+\/photos\/[0-9a-f]{32}\/IMG 2026-10-19 10\.30\.12\.jpg$/.test(f.storage_path), "object key " + f.storage_path);
  same(f.preview_path, f.storage_path.replace(/[^/]+$/, "preview-320.jpg"), "the preview sits next to the photo");
  same(Number((await one("select count(*) as n from storage.objects where name in ($1, $2)", [f.storage_path, f.preview_path])).n), 2, "both objects stored");
  S.photo = f;
});

await check("20 photos in one minute: 20 rows, none a version of another, and one \"Files uploaded to <day>\" line (P1 check 12)", async () => {
  await as("field2");
  const before = Number((await one("select count(*) as n from public.activity where project_id = $1 and created_by = $2 and text = 'Files uploaded to 2026-10-19'", [S.p1.id, PEOPLE.field2.id])).n);
  const { q } = queueFor("field2", false);
  for (let i = 0; i < 20; i++) await q.enqueue({ projectId: S.p1.id, file: jpeg(1000 + i), kind: "photo", takenAt: TAKEN });
  await q.drain();
  const rows = await sql("select name, version_no, previous_id from public.files where project_id = $1 and created_by = $2 and folder = 'photos'", [S.p1.id, PEOPLE.field2.id]);
  same(rows.length, 20, "rows");
  same(new Set(rows.map((r) => r.name)).size, 20, "twenty names");
  ok(rows.every((r) => r.version_no === 1 && r.previous_id === null), "no versions");
  ok(rows.some((r) => r.name === "IMG 2026-10-19 10.30.12-2.jpg"), "the second name is bumped (field's own photo has the first)");
  const after = Number((await one("select count(*) as n from public.activity where project_id = $1 and created_by = $2 and text = 'Files uploaded to 2026-10-19'", [S.p1.id, PEOPLE.field2.id])).n);
  same(after - before, 1, "one log line");
});

await check("a video over 6 MiB goes by TUS in 6 MiB chunks; a voice note lands in documents/Site Notes", async () => {
  await as("lead");
  const { q } = queueFor("lead", false);
  await q.enqueue({ projectId: S.p1.id, file: new File([new Uint8Array(13 * 1024 * 1024)], "clip.mov", { type: "video/quicktime" }), kind: "video", takenAt: TAKEN });
  await q.enqueue({ projectId: S.p1.id, file: new File([new Uint8Array(4000)], "voice.m4a", { type: "audio/mp4" }), kind: "voice", takenAt: TAKEN });
  await q.drain();
  const rows = await sql("select folder, subpath, name, size from public.files where project_id = $1 and created_by = $2 order by id", [S.p1.id, PEOPLE.lead.id]);
  same(rows.map((r) => [r.folder, r.subpath, r.name.slice(0, 4)]), [["photos", "2026-10-19", "VID "], ["documents", "Site Notes", "Voic"]], "places");
  same(Number(rows[0].size), 13 * 1024 * 1024, "the whole video");
});

await check("a journal photo: folder journal, the entry's day, the entry id; journalMedia() and the journal list show it with its caption", async () => {
  await as("field");
  const { q } = queueFor("field", true);
  await q.enqueue({ projectId: S.p1.id, file: jpeg(), kind: "journal", journalEntryId: S.j_field.id, entryDate: "2026-10-19", caption: "Header detail", takenAt: TAKEN });
  await q.drain();
  const media = await files.journalMedia(S.p1.id);
  ok(media.some((m) => m.journal_entry_id === S.j_field.id && m.description === "Header detail" && m.subpath === "2026-10-19"), "journal media");
  await as("viewer");
  const e = (await journal.list(S.p1.id)).find((x) => x.id === S.j_field.id);
  ok(e && e.media && e.media.length === 1, "the viewer's journal shows the photo: " + JSON.stringify(e && e.media));
});

await check("viewer and the agents account cannot upload (Storage refuses the object; the queue keeps it as failed, nothing in files)", async () => {
  for (const k of ["viewer", "agents"]) {
    await as(k);
    const { q, store } = queueFor(k, false);
    await q.enqueue({ projectId: S.p1.id, file: jpeg(), kind: "photo", takenAt: TAKEN });
    await q.drain();
    const left = [...store.values()].filter((r) => r.kind);
    ok(left.length === 1 && left[0].state === "failed", k + ": " + JSON.stringify(left.map((r) => [r.state, r.error])));
  }
  same(Number((await one("select count(*) as n from public.files where created_by in ($1, $2)", [PEOPLE.viewer.id, PEOPLE.agents.id])).n), 0, "no rows");
});

await check("listCurrent() / signed URLs: everyone active reads the cloud rows, the preview signs through files.preview_path (M1 storage_can_read); the agents account reads nothing", async () => {
  for (const k of ROLES) {
    await as(k);
    const list = await files.listCurrent(S.p1.id);
    const photo = list.find((x) => (x.fileId || x.id) === S.photo.id);
    ok(photo, k + " sees the photo");
    ok(await files.signedUrl(S.photo.preview_path), k + ": the preview signs");
    ok(await files.signedUrl(S.photo.storage_path), k + ": the photo signs");
  }
  await as("agents");
  same((await files.listCurrent(S.p1.id)).length, 0, "agents: no rows");
  await refused(() => files.signedUrl(S.photo.preview_path), null, "agents: no preview");
});

await check("setCaption(): the uploader, a manager and an admin change a caption (versioned); another field person and a viewer cannot", async () => {
  await as("field");
  let item = (await files.listCurrent(S.p1.id)).find((x) => (x.fileId || x.id) === S.photo.id);
  const row = await files.setCaption(item, "North wall, after the rain");
  same(row.description, "North wall, after the rain", "uploader");
  for (const k of ["field2", "viewer", "lead"]) {
    await as(k);
    item = (await files.listCurrent(S.p1.id)).find((x) => (x.fileId || x.id) === S.photo.id);
    await refused(() => files.setCaption(item, k + " was here"), "42501", k);
  }
  await as("manager");
  item = (await files.listCurrent(S.p1.id)).find((x) => (x.fileId || x.id) === S.photo.id);
  same((await files.setCaption(item, "Checked")).description, "Checked", "manager");
});

await check("the database keeps the queue's promises: a preview in another folder, or reused, is refused; the source cannot change; nameTaken() sees the live name", async () => {
  await as("field");
  const fdb = uq.filesDb(() => client);
  ok(await fdb.nameTaken({ project_id: S.p1.id, folder: "photos", subpath: "2026-10-19", journal_entry_id: null }, "IMG 2026-10-19 10.30.12.jpg"), "the first photo's name is taken");
  ok(!(await fdb.nameTaken({ project_id: S.p1.id, folder: "photos", subpath: "2026-10-19", journal_entry_id: null }, "IMG 2026-10-19 10.30.13.jpg")), "a new name is free");
  same((await fdb.findByPath(S.photo.storage_path)).id, S.photo.id, "findByPath");
  const key = uq.objectKey(S.p1.id, "photos", "IMG check.jpg");
  const other = uq.objectKey(S.p1.id, "photos", "preview-320.jpg");
  await refused(() => fdb.insert({ project_id: S.p1.id, folder: "photos", subpath: "2026-10-19", name: "IMG check.jpg", storage_path: key, size: 10, mime: "image/jpeg", preview_path: other, source: "portal2" }), "23514", "a preview in another uuid folder");
  await refused(() => fdb.insert({ project_id: S.p1.id, folder: "photos", subpath: "2026-10-19", name: "IMG check2.jpg", storage_path: key, size: 10, mime: "image/jpeg", preview_path: S.photo.preview_path, source: "portal2" }), null, "another row's preview");
  const r = await client.from("files").update({ source: "desktop" }).eq("id", S.photo.id).select();
  same(r.error && r.error.code, "42501", "the source is fixed");
});

await check("thumbnailUrls(): a project picture (thumbnail folder, set by an admin) signs for every active role", async () => {
  await as("admin");
  const key = uq.objectKey(S.p1.id, "thumbnail", "front.jpg");
  const up = await client.storage.from("project-files").upload(key, new Blob([new Uint8Array(10)]), { contentType: "image/jpeg" });
  ok(!up.error, "admin uploads the picture " + JSON.stringify(up.error));
  const row = (await client.from("files").insert({ project_id: S.p1.id, folder: "thumbnail", subpath: "", name: "front.jpg", storage_path: key, size: 10, mime: "image/jpeg", source: "portal2" }).select().single()).data;
  ok(row && row.id, "thumbnail row");
  await client.from("projects").update({ thumbnail_file_id: row.id }).eq("id", S.p1.id).select();
  for (const k of ["field", "viewer", "accountant"]) {
    await as(k);
    const list = await projects.loadProjects({ fresh: true });
    const urls = await files.thumbnailUrls(list);
    ok(urls[String(S.p1.id)], k + " gets the picture");
  }
  await as("lead");
  const bad = await client.storage.from("project-files").upload(uq.objectKey(S.p1.id, "thumbnail", "x.jpg"), new Blob([]), {});
  ok(bad.error, "a lead cannot add a project picture (projects editors only)");
});

// ===========================================================================================
section = "search (repo/search.js)";
// ===========================================================================================
await check("search(): projects by number and name for every active role; tasks follow Q3 (field and viewer: own and created); the agents account is refused", async () => {
  await as("admin");
  await sql("reset role");
  await sql("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: PEOPLE.admin.id, role: "authenticated" })]);
  await sql("set role authenticated");
  await sql("insert into public.tasks (project_id, title, assigned_to) values ($1, 'Order the beams', $2), ($1, 'Order the windows', $3)", [S.p1.id, PEOPLE.field.id, PEOPLE.lead.id]);
  await sql("reset role");
  for (const k of ROLES) {
    await as(k);
    const g = await search.search(S.p1.internalIDNumber);
    ok(g.length && /Projects/.test(g[0].label) && g[0].items.length >= 1, k + ": " + JSON.stringify(g).slice(0, 200));
    const raw = await search.raw("Order the");
    const want = ["field"].includes(k) ? 1 : k === "viewer" ? 0 : 2;
    same(raw.tasks.length, want, k + ": tasks");
  }
  await as("agents");
  await refused(() => search.search("Sandbox"), "42501", "agents");
});

// ===========================================================================================
section = "live (site/js/live.js)";
// ===========================================================================================
await check("watch(): every active role joins the private change channels the pages open (projects, activity, journal_entries, files); the agents account cannot", async () => {
  const join = (table) => new Promise((res) => {
    let stop = null;
    const t = setTimeout(() => { if (stop) stop(); res("timeout"); }, 3000);
    stop = live.watch(table, table === "projects" ? null : "project_id=eq." + S.p1.id, (evt) => {
      if (evt.type === "SUBSCRIBED") { clearTimeout(t); stop(); res("SUBSCRIBED"); }
    });
  });
  for (const k of ["admin", "lead", "field", "viewer"]) {
    await as(k);
    for (const t of ["projects", "activity", "journal_entries", "files"]) same(await join(t), "SUBSCRIBED", k + " " + t);
  }
  await as("agents");
  same(await join("projects"), "timeout", "agents never joins");
  for (const ch of client.channels) ch.unsubscribe();
});

await check("presence: the topic presence:dcr is open to active people only", async () => {
  const can = async (k) => {
    await as(k);
    return new Promise((res) => client.channel(live.PRESENCE_TOPIC, { config: { private: true, presence: { key: "x" } } }).subscribe((s) => res(s)));
  };
  same(await can("field"), "SUBSCRIBED", "field");
  same(await can("viewer"), "SUBSCRIBED", "viewer");
  same(await can("agents"), "CHANNEL_ERROR", "agents");
  same(await can("inactive"), "CHANNEL_ERROR", "inactive");
});

/* ── summary ──────────────────────────────────────────────────────────── */
const failed = results.filter((r) => !r.ok);
let last = "";
for (const r of results) {
  if (r.section !== last) { console.log("\n" + r.section); last = r.section; }
  console.log((r.ok ? "  ok   " : "  FAIL ") + r.name + (r.ok ? "" : "\n         " + r.error));
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed (${steps.length} SQL files from ${D2}, ${Date.now() - t0} ms)`);
process.exit(failed.length ? 1 : 0);
