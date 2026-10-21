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

   P3's phone reminders run the same way end to end: site/js/push2.js (on a stand-in browser with real
   P-256 subscription keys) -> supabase-js functions.invoke -> DCR Desktop 2's OWN push Edge Function
   logic (supabase/functions/push/handler.ts + sql.ts, its SQL run as the service role with no JWT, the
   way index.ts runs it) -> a stand-in push service that decrypts what it is sent (RFC 8291) and checks
   the VAPID token. The VAPID pair is made in memory for the run and never written anywhere.

   DCR Desktop 2 is looked for in DCR_DESKTOP2_DIR, else next to this repository ("../DCR Desktop 2").
   Nothing here talks to Supabase. Exit code 0 = every check passed. */
import crypto from "node:crypto";
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
await check("every table, view and RPC named in site/js exists in the migrations (before M3: push_subscriptions waits for it)", async () => {
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
  same(missingT, catalog.tables.push_subscriptions ? [] : ["push_subscriptions"], "tables / views not in the schema");
  same(missingF, [], "RPCs not in the schema");
  ok(tables.has("projects") && tables.has("current_files") && rpcs.has("set_project_location") && rpcs.has("password_changed"), "the scan found the calls");
  ok(tables.has("tasks") && tables.has("task_notes") && rpcs.has("my_tasks") && rpcs.has("add_task_note") && rpcs.has("complete_task") && rpcs.has("my_tasks_summary"), "the P3 calls");
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

// ===========================================================================================
section = "P2: employees and crews (repo/employees.js, migration M2)";
// ===========================================================================================
const HAS_M2 = !!(catalog.tables.timesheets && catalog.tables.employees && catalog.functions.my_roster);
const emp = await site("repo/employees.js");
const ts = await site("repo/timesheets.js");
const tsmap = await site("map/timesheets.js");
const tsShared = await site("pages/ts-shared.js");
const E = {};

if (!HAS_M2) {
  results.push({ section, name: "M2 (20261021000100_people_timesheets) is not in DCR Desktop 2 yet: the P2 checks wait for it", ok: true });
} else {
  await check("createEmployee() / updateEmployee(): admin and manager add and edit (versioned); phone_e164 by the database; one ACTIVE name; accountant, lead, field and viewer refused; nobody deletes", async () => {
    await as("admin");
    E.lead = await emp.createEmployee({ full_name: "Lee  Lead", employee_no: "C-1", phone: "Cell: (805) 555-0141", profile_id: PEOPLE.lead.id,
      normal_start1: "07:00", normal_end1: "11:00", normal_start2: "12:00", normal_end2: "15:30", normal_lunch_hours: 1 });
    same([E.lead.full_name, E.lead.phone_e164], ["Lee Lead", "+18055550141"], "name tidied, texting number derived");
    E.field = await emp.createEmployee({ full_name: "Flo Field", employee_no: "C-2", phone: "805 555 0142", profile_id: PEOPLE.field.id,
      normal_start1: "07:00", normal_end1: "11:00", normal_start2: "12:00", normal_end2: "15:30" });
    await as("manager");
    E.crew = await emp.createEmployee({ full_name: "Cy Crew", employee_no: "C-3", phone: "555-0143" });
    same(E.crew.phone_e164, null, "a 7-digit number cannot be texted");
    E.field2 = await emp.createEmployee({ full_name: "Fay Field", profile_id: PEOPLE.field2.id });
    E.viewer = await emp.createEmployee({ full_name: "Vi Viewer", profile_id: PEOPLE.viewer.id });
    E.acct = await emp.createEmployee({ full_name: "Ace Accountant", profile_id: PEOPLE.accountant.id });
    E.other = await emp.createEmployee({ full_name: "Otto Other" });
    await refused(() => emp.createEmployee({ full_name: "otto other" }), "23505", "a second active Otto Other");
    const v = E.crew.version;
    E.crew = await emp.updateEmployee(E.crew, { phone: "(805) 555-0143" });
    ok(E.crew.version === v + 1 && E.crew.phone_e164 === "+18055550143", "versioned edit, number derived again");
    await refused(() => emp.updateEmployee(Object.assign({}, E.crew, { version: v }), { notes: "stale" }), "PT409", "a stale version");
    await refused(() => emp.linkAccount(E.other, PEOPLE.lead.id), "23505", "one employee per account");
    await refused(() => emp.linkAccount(E.other, PEOPLE.agents.id), "23514", "never the DCR Agents 2 account");
    for (const k of ["accountant", "lead", "field", "viewer"]) {
      await as(k);
      await refused(() => emp.createEmployee({ full_name: "Nope " + k }), "42501", k + " adds");
    }
    await as("admin");
    const del = await client.from("employees").delete().eq("id", E.other.id).select();
    ok(del.error && del.error.code === "42501", "no DELETE on employees: " + JSON.stringify(del.error));
    same((await emp.setActive(E.other, false)).active, false, "turned off instead");
  });

  await check("crews: an admin sets the lead's crew (addToCrew / removeFromCrew); only a lead has a crew, never themself; who reads crew_members (office all, the lead their own, a member the rows naming them)", async () => {
    await as("admin");
    await emp.addToCrew(PEOPLE.lead.id, E.field.id);
    await emp.addToCrew(PEOPLE.lead.id, E.crew.id);
    await refused(() => emp.addToCrew(PEOPLE.lead.id, E.crew.id), "23505", "the same pair twice");
    await refused(() => emp.addToCrew(PEOPLE.field.id, E.crew.id), "23514", "a field person has no crew");
    await refused(() => emp.addToCrew(PEOPLE.lead.id, E.lead.id), "23514", "a lead is not in their own crew");
    await emp.addToCrew(PEOPLE.lead.id, E.field2.id);
    ok(await emp.removeFromCrew(PEOPLE.lead.id, E.field2.id), "removed");
    const want = { admin: 2, manager: 2, accountant: 2, lead: 2, field: 1, field2: 0, viewer: 0 };
    for (const [k, n] of Object.entries(want)) {
      await as(k);
      same((await emp.listCrews()).length, n, k + " reads crew rows");
    }
    await as("lead");
    same((await emp.crewOf(PEOPLE.lead.id)).map(Number).sort(), [E.field.id, E.crew.id].sort(), "crewOf(lead)");
    await refused(() => emp.addToCrew(PEOPLE.lead.id, E.field2.id), "42501", "a lead does not set crews");
  });

  await check("roster() (my_roster) by scope, never phone, e-mail, address, notes or pay; mine() is the own row; listEmployees() follows the same scope; the agents account is refused", async () => {
    const cols = catalog.functions.my_roster[0];
    const outCols = (await sql("select string_agg(a.attname, ',' order by a.attnum) as c from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(p.proargnames) with ordinality as a(attname, attnum) where n.nspname = 'public' and p.proname = 'my_roster'"))[0].c;
    ok(!/phone|email|address|notes|pay|rate/.test(String(outCols)), "my_roster's columns: " + outCols);
    ok(cols, "my_roster exists");
    const want = { admin: 6, manager: 6, accountant: 6, lead: 3, field: 1, field2: 1, viewer: 1 };
    for (const [k, n] of Object.entries(want)) {
      await as(k);
      const r = await emp.roster();
      same(r.length, n, k + " roster");
      ok(r.every((x) => !("phone" in x) && !("address" in x) && !("email" in x)), k + ": no contact columns");
      same((await emp.listEmployees()).length, Math.max(n, k === "admin" || k === "manager" || k === "accountant" ? 7 : n), k + " listEmployees (the office also sees the one turned off)");
    }
    await as("field");
    same((await emp.mine(PEOPLE.field.id)).id, E.field.id, "mine()");
    await as("manager2");
    same(await emp.mine(PEOPLE.manager2.id), null, "an account without an employee row");
    await as("agents");
    await refused(() => emp.roster(), "42501", "agents");
  });

  await check("mine() names its columns — never the office's notes (M2 lets the person and their lead read the whole row, so Portal 2 does not carry the notes to their phones); former() / get(): turned-off employees and one employee, in scope only", async () => {
    await as("admin");
    E.field = await emp.updateEmployee(E.field, { notes: "Made-up office remark" });
    await as("field");
    const me = await emp.mine(PEOPLE.field.id);
    ok(me && !("notes" in me) && ["phone", "phone_e164", "address", "full_name", "normal_start1", "active"].every((k) => k in me),
      "mine() columns: " + Object.keys(me || {}).join(","));
    const raw = await client.from("employees").select("notes").eq("id", E.field.id);
    same(raw.data && raw.data[0] && raw.data[0].notes, "Made-up office remark", "the database: the person reads their own row's notes (the editor's label says so)");
    await as("lead");
    const crewRaw = await client.from("employees").select("notes").eq("id", E.field.id);
    same(crewRaw.data && crewRaw.data[0] && crewRaw.data[0].notes, "Made-up office remark", "the database: their lead reads them too");
    const want = { admin: ["Otto Other"], manager: ["Otto Other"], accountant: ["Otto Other"], lead: [], field: [], viewer: [] };
    for (const [k, names] of Object.entries(want)) {
      await as(k);
      const f = await emp.former();
      same(f.map((x) => x.full_name), names, k + " former()");
      ok(f.every((x) => !("notes" in x) && !("phone" in x) && !("address" in x)), k + ": former() carries names and hours only");
    }
    await as("admin");
    same((await emp.get(E.other.id)).full_name, "Otto Other", "admin get(left)");
    same(await emp.get("1 or 1=1"), null, "get() takes an id only");
    await as("lead");
    same(await emp.get(E.other.id), null, "a lead cannot read someone outside the crew");
    same((await emp.get(String(E.crew.id))).full_name, "Cy Crew", "a lead reads their crew member");
    await as("admin");
    E.field = await emp.updateEmployee(E.field, { notes: "" });
  });

  await check("update_my_contact(): one's own phone and address only (blank clears it, the texting number follows); PT404 without an employee row", async () => {
    await as("field");
    await emp.updateMyContact("(805) 555-0199", "12 Sample St");
    let me = await emp.mine(PEOPLE.field.id);
    same([me.phone_e164, me.address], ["+18055550199", "12 Sample St"], "saved");
    await emp.updateMyContact("(805) 555-0199", "");
    me = await emp.mine(PEOPLE.field.id);
    same(me.address, null, "a blank clears the address");
    await as("manager2");
    await refused(() => emp.updateMyContact("805 555 0100", "x"), "PT404", "no employee row");
  });

  // ===========================================================================================
  section = "P2: timesheets (repo/timesheets.js, the crew scope)";
  // ===========================================================================================
  const today = (await sql("select app.today()::text as d"))[0].d;
  const thisSat = tsmap.weekDays(common2.saturdayOf(today))[0];
  const lastSat = common2.addDays(thisSat, -7);
  const day = (n) => common2.addDays(lastSat, n);
  const form = (empId, d, extra) => Object.assign({ employeeId: empId, date: d, kind: "work", projectId: S.p1.id, hours: 8, work: "Framing",
    start1: "07:00", end1: "11:00", start2: "12:00", end2: "16:00", lunch: 1 }, extra || {});
  const T = {};

  await check("create(): the writing scope (P2 check 1) — admin and manager anyone; a lead self and crew; field and the accountant themselves; a viewer nobody; source portal", async () => {
    const cases = [
      ["admin", "other", true], ["manager", "crew", true], ["lead", "lead", true], ["lead", "field", true], ["lead", "crew", true],
      ["lead", "field2", false], ["lead", "other", false], ["field", "field", true], ["field", "crew", false], ["field2", "field", false],
      ["accountant", "acct", true], ["accountant", "field", false], ["viewer", "viewer", false], ["manager2", "field2", true],
    ];
    for (let i = 0; i < cases.length; i++) {
      const [who, target, allowed] = cases[i];
      await as(who);
      const f = form(E[target].id, day(2 + (i % 4)));
      if (allowed) {
        const e = await ts.create(f);
        same([e.employeeId, e.source, e.kind, e.projectNumber, e.hours, e.calculated], [E[target].id, "portal", "work", S.p1.internalIDNumber, 8, 8], who + " -> " + target);
        T[who + ":" + target] = e;
      } else {
        await refused(() => ts.create(f), "42501", who + " -> " + target);
      }
    }
  });

  await check("list(): the reading scope — admin, manager, accountant everyone (Q7); a lead self and crew; field and viewer themselves; the agents account nothing; the embeds (employee, project with address)", async () => {
    await as("admin");
    T.viewerRow = await ts.create(form(E.viewer.id, day(3)));      // the office files the viewer's hours
    const from = lastSat, to = common2.addDays(lastSat, 6);
    const all = new Set((await ts.list(from, to)).map((e) => e.employeeId));
    const want = {
      admin: all.size, manager: all.size, accountant: all.size,
      lead: [E.lead.id, E.field.id, E.crew.id].filter((x) => all.has(x)).length,
      field: 1, field2: 1, viewer: 1,                            // field2: the row manager2 filed for them
    };
    for (const [k, n] of Object.entries(want)) {
      await as(k);
      const list = await ts.list(from, to);
      same(new Set(list.map((e) => e.employeeId)).size, n, k + " sees employees");
      ok(list.every((e) => e.employeeName && e.projectAddress === "100 Sample Rd"), k + ": embeds");
    }
    await as("agents");
    same((await ts.list(from, to)).length, 0, "agents: list() is empty");
    const r = await client.from("timesheets").select("id").limit(5);
    ok(!r.data || r.data.length === 0, "agents reads no timesheet rows");
  });

  await check("update() / remove(): versioned; a PATCH that moves a row to an out-of-scope employee is refused (WITH CHECK); the accountant and a viewer cannot change anything; a stale version is PT409", async () => {
    await as("lead");
    let e = T["lead:crew"];
    e = await ts.update(e, form(E.crew.id, e.date, { hours: 7.5, start2: "12:00", end2: "15:30" }));
    same([e.hours, e.calculated], [7.5, 7.5], "a lead edits the crew's row");
    await refused(() => ts.update(e, form(E.other.id, e.date)), "42501", "moving it to someone outside the crew");
    await refused(() => ts.update(Object.assign({}, e, { version: e.version - 1 }), form(E.crew.id, e.date, { hours: 6 })), "PT409", "stale version");
    T["lead:crew"] = e;
    for (const [k, row] of [["accountant", T["lead:field"]], ["viewer", T.viewerRow]]) {
      await as(k);
      await refused(() => ts.update(row, form(row.employeeId, row.date, { hours: 2 })), "42501", k + " edits (reads it, cannot change it)");
      await refused(() => ts.remove(row), "42501", k + " deletes");
    }
    await as("field");
    const mine = T["field:field"];
    ok(await ts.remove(mine), "field deletes their own (hard delete)");
    await as("admin");
    same((await sql("select count(*)::int as n from public.timesheets where id = $1", [mine.id]))[0].n, 0, "gone for real");
  });

  await check("the rules of a row (P2 check 2): a leave day needs no project (and takes none); a work day needs a project and hours > 0; hours 0 to 24; clock times are plain times", async () => {
    await as("field");
    const leave = await ts.create({ employeeId: E.field.id, date: day(5), kind: "vacation", hours: 8 });
    same([leave.kind, leave.projectId, leave.start1, leave.leave, leave.dayType], ["vacation", null, "", true, "Vacation"], "a vacation day");
    const sick = await ts.create({ employeeId: E.field.id, date: day(6), kind: "sick", hours: 0 });
    same(sick.hours, 0, "a sick day with 0 hours");
    await refused(() => ts.create(form(E.field.id, day(4), { projectId: null })), "23514", "work without a project");
    await refused(() => ts.create(form(E.field.id, day(4), { hours: 0 })), "23514", "work with 0 hours");
    await refused(() => ts.create(form(E.field.id, day(4), { hours: 24.5 })), "23514", "25 hours");
    const raw = await client.from("timesheets").insert({ employee_id: Number(E.field.id), work_date: day(4), kind: "holiday", project_id: S.p1.id, hours: 8, source: "portal" }).select();
    same(raw.error && raw.error.code, "23514", "a leave day with a project");
    const t = (await sql("select start1::text as s from public.timesheets where id = $1", [T["lead:field"].id]))[0];
    same(t.s, "07:00:00", "start1 is a time");
    same(tsmap.problem({ employeeId: 1, date: day(4), kind: "work", projectId: null, hours: 8 }), "Choose a project from the list.", "the page says it first");
  });

  await check("sign-off (P2 check 3): confirm with the fingerprint timesheet_weeks gave -> live; an hour changes elsewhere -> stale, and confirming with the old fingerprint is PT409; the page's own fingerprint equals the database's; withdraw: own, or any as an admin", async () => {
    await as("lead");
    let wk = tsmap.weeksOf(await ts.weeks(lastSat, common2.addDays(lastSat, 6)), lastSat);
    const w = wk[String(E.field.id)];
    ok(w && /^[0-9a-f]{32}-\d+$/.test(w.fingerprint), "a fingerprint for the field person's week");
    const rows = (await ts.list(lastSat, common2.addDays(lastSat, 6))).filter((e) => e.employeeId === E.field.id);
    same(tsmap.fingerprint(rows), w.fingerprint, "map/timesheets.js fingerprint() = app.timesheet_week_state");
    await ts.confirm(E.field.id, lastSat, w.fingerprint);
    wk = tsmap.weeksOf(await ts.weeks(lastSat, lastSat), lastSat);
    ok(wk[String(E.field.id)].confirmed && wk[String(E.field.id)].marks[0].mine === true, "live, mine");
    same([wk[String(E.field.id)].marks[0].role, wk[String(E.field.id)].marks[0].canWithdraw, /^#[0-9a-f]{6}$/i.test(wk[String(E.field.id)].marks[0].color)],
      ["lead", true, true], "the mark names the signer's role and colour (the confirm dialog shows them)");
    await as("manager");
    const seenByManager = tsmap.weeksOf(await ts.weeks(lastSat, lastSat), lastSat)[String(E.field.id)].fingerprint;
    await ts.confirm(E.field.id, lastSat, seenByManager);
    await as("field");                                           // an hour changes on the phone
    const one = (await ts.list(lastSat, common2.addDays(lastSat, 6))).find((e) => e.kind === "work");
    await ts.update(one, form(E.field.id, one.date, { hours: 9, end2: "17:00" }));
    await as("lead");
    wk = tsmap.weeksOf(await ts.weeks(lastSat, lastSat), lastSat);
    const now = wk[String(E.field.id)];
    same([now.confirmed, now.staleCount, now.marks.every((m) => m.stale)], [false, 2, true], "both signatures stale");
    await refused(() => ts.confirm(E.field.id, lastSat, w.fingerprint), "PT409", "the old fingerprint");
    await refused(() => ts.confirm(E.field.id, lastSat, ""), "22023", "no fingerprint");
    await refused(() => ts.confirm(E.field2.id, lastSat, now.fingerprint), "42501", "a lead outside the crew");
    await ts.confirm(E.field.id, lastSat, now.fingerprint);
    for (const k of ["field", "viewer", "accountant"]) {
      await as(k);
      await refused(() => ts.confirm(E.field.id, lastSat, now.fingerprint), "42501", k + " cannot confirm");
    }
    await as("lead");
    wk = tsmap.weeksOf(await ts.weeks(lastSat, lastSat), lastSat);
    const marks = wk[String(E.field.id)].marks;
    const mgr = marks.find((m) => m.mine === false);
    same(mgr.canWithdraw, false, "a lead may not withdraw the manager's");
    await refused(() => ts.unconfirm(mgr.id), "42501", "a lead withdraws the manager's");
    await ts.unconfirm(marks.find((m) => m.mine).id);
    await as("admin");
    wk = tsmap.weeksOf(await ts.weeks(lastSat, lastSat), lastSat);
    const left = wk[String(E.field.id)].marks;
    same(left.length, 1, "the manager's left");
    same(left[0].canWithdraw, true, "an admin may withdraw anyone's");
    await ts.unconfirm(left[0].id);
    const direct = await client.from("timesheet_confirmations").select("id").limit(1);
    ok(direct.error || !direct.data.length, "nobody reads timesheet_confirmations directly");
  });

  await check("a screen behind the database (a change whose live event never arrived): the fingerprint of the rows ON SCREEN (weekFingerprint) is refused with PT409 even though timesheet_weeks was read after the change — new hours or another project; screenBehind() names the week; a fresh read confirms", async () => {
    await as("lead");
    const fri = common2.addDays(lastSat, 6);
    for (const change of [{ hours: 7.5, end2: "15:30" }, { projectId: S.p2.id, end2: "15:30" }]) {
      const screen = await ts.list(lastSat, fri);                       // what the page drew
      await as("manager");                                               // the office changes a row; the page hears nothing
      const row = (await ts.list(lastSat, fri)).find((e) => e.employeeId === E.field.id && e.kind === "work");
      await ts.update(row, form(E.field.id, row.date, Object.assign({ hours: row.hours, projectId: row.projectId }, change)));
      await as("lead");
      const wk = tsmap.weeksOf(await ts.weeks(lastSat, fri), lastSat);  // the sign-offs read AFTER the change
      const fp = tsmap.weekFingerprint(screen, E.field.id, lastSat);
      ok(fp !== wk[String(E.field.id)].fingerprint && tsmap.screenBehind(wk, screen, lastSat).includes(String(E.field.id)),
        JSON.stringify(change) + ": the screen is behind");
      await refused(() => ts.confirm(E.field.id, lastSat, fp), "PT409", JSON.stringify(change) + ": the rows on screen");
      const fresh = await ts.list(lastSat, fri);
      same(tsmap.weekFingerprint(fresh, E.field.id, lastSat), wk[String(E.field.id)].fingerprint, "a fresh read agrees with the database");
      same(tsmap.screenBehind(wk, fresh, lastSat), [], "nobody behind after a fresh read");
      await ts.confirm(E.field.id, lastSat, tsmap.weekFingerprint(fresh, E.field.id, lastSat));
      const mine = tsmap.weeksOf(await ts.weeks(lastSat, fri), lastSat)[String(E.field.id)].marks.find((m) => m.mine);
      await ts.unconfirm(mine.id);
    }
  });

  await check("weeks run Saturday to Friday in company time (P2 check 4): timesheet_weeks' week_start is a Saturday; Friday 9 pm Pacific is still that week (app.week_start_at); the page's saturdayOf agrees", async () => {
    const r = (await sql("select app.week_start_at('2026-10-24T04:00:00Z')::text as a, app.week_start('2026-10-23')::text as b, app.week_start('2026-10-24')::text as c"))[0];
    same([r.a, r.b, r.c], ["2026-10-17", "2026-10-17", "2026-10-24"], "the database");
    same([common2.saturdayOf(new Date("2026-10-24T04:00:00Z")), common2.saturdayOf("2026-10-23"), common2.saturdayOf("2026-10-24")],
      ["2026-10-17", "2026-10-17", "2026-10-24"], "common2.saturdayOf");
    await as("admin");
    const rows = await client.rpc("timesheet_weeks", { p_from: lastSat, p_to: common2.addDays(lastSat, 6) });
    ok(!rows.error && rows.data.length && rows.data.every((x) => new Date(x.week_start + "T12:00:00Z").getUTCDay() === 6), "Saturdays");
  });

  await check("context() (pages/ts-shared.js) over the real roster: the scope words and who may be written for, per role", async () => {
    const want = { admin: ["all", 6], manager: ["all", 6], accountant: ["all-read", 1], lead: ["crew", 3], field: ["self", 1], viewer: ["view", 0], manager2: ["all", 6] };
    for (const [k, [scope, n]] of Object.entries(want)) {
      await as(k);
      const ctx = await tsShared.context(await sbm.me());
      same([ctx.scope, ctx.writable.length], [scope, n], k);
      // someone who has left: never offered for new hours; their entries stay correctable by the office
      const office = k === "admin" || k === "manager" || k === "manager2";
      ok(!ctx.writable.some((r) => r.id === E.other.id), k + ": Otto (left) not offered for new hours");
      same(!!ctx.byId(E.other.id), office || k === "accountant", k + ": byId(Otto, left)");
      same(tsShared.formPeople(ctx, E.other.id).some((r) => r.id === E.other.id), office, k + ": an entry of Otto's opens with Otto in the form");
      same(ctx.everyone.length, ctx.roster.length + ctx.former.length, k + ": everyone = roster + former");
    }
  });

  await check("watch('timesheets') — Team Sheets' live channel: every active role joins; the agents account cannot", async () => {
    const join = () => new Promise((res) => {
      let stop = null;
      const t = setTimeout(() => { if (stop) stop(); res("timeout"); }, 3000);
      stop = live.watch("timesheets", null, (evt) => {
        if (evt.type === "SUBSCRIBED") { clearTimeout(t); stop(); res("SUBSCRIBED"); }
      });
    });
    for (const k of ["admin", "accountant", "lead", "field", "viewer"]) {
      await as(k);
      same(await join(), "SUBSCRIBED", k);
    }
    await as("agents");
    same(await join(), "timeout", "agents never joins");
    for (const ch of client.channels) ch.unsubscribe();
  });

  await check("the agents account (P1 check 10, the new tables): zero rows from employees, crew_members, timesheets, timesheet_confirmations; refused by my_roster, timesheet_weeks, confirm, update_my_contact", async () => {
    await as("agents");
    for (const t of ["employees", "crew_members", "timesheets", "timesheet_confirmations"]) {
      const r = await client.from(t).select("id").limit(5);
      ok(r.error || (r.data && r.data.length === 0), t + ": " + JSON.stringify(r.error || r.data));
    }
    await refused(() => ts.weeks(lastSat, lastSat), "42501", "timesheet_weeks");
    await refused(() => ts.confirm(E.field.id, lastSat, "x"), "42501", "confirm");
    await refused(() => emp.updateMyContact("805 555 0100", ""), "42501", "update_my_contact");
  });
}

// ===========================================================================================
section = "P3: tasks, notes and notices (repo/tasks.js, migration M3)";
// ===========================================================================================
const HAS_M3 = !!(catalog.functions.my_tasks && catalog.functions.add_task_note && catalog.functions.complete_task &&
  catalog.tables.notifications_outbox && catalog.tables.tasks && catalog.tables.tasks.cols.agent_kind);
const tasksRepo = await site("repo/tasks.js");
const tmap = await site("map/tasks.js");
const T3 = {};
const PRICED = /qty|quantity|price|markup|invoice|paid|amount|cost/i;

if (!HAS_M3 || !HAS_M2) {
  results.push({ section, name: "M3 (20261022000100_tasks_push) is not in DCR Desktop 2 yet: the P3 checks wait for it", ok: true });
} else {
  const today3 = (await sql("select app.today()::text as d"))[0].d;
  const outCols = async (fn) => (await sql(`select coalesce(string_agg(a.n, ',' order by a.i), '') as c
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace,
           unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, i)
     where s.nspname = 'public' and p.proname = $1 and a.m = 't'`, [fn]))[0].c.split(",").filter(Boolean);

  await check("the M3 columns, RPC signatures and my_tasks' answer columns the pages read; no priced column in tasks (P3 check 6)", async () => {
    same(catalog.functions.add_task_note.map((f) => f.args.map((a) => a.name)), [["p_task_id", "p_text", "p_client_key"]], "add_task_note(...)");
    same(catalog.functions.complete_task.map((f) => f.args.map((a) => a.name)), [["p_id", "p_version", "p_note", "p_via"]], "complete_task(...)");
    same(catalog.functions.my_tasks.map((f) => f.args.map((a) => a.name)), [["p_view"]], "my_tasks(p_view)");
    same(catalog.functions.my_tasks_summary.map((f) => [f.args.length, f.rettype]), [[0, "jsonb"]], "my_tasks_summary() -> jsonb");
    const cols = await outCols("my_tasks");
    const READS = ["id", "version", "project_id", "title", "description", "category", "sub_category", "priority", "assigned_to", "due_date", "due_time",
      "status", "created_at", "created_by", "agent_kind", "agent_ref", "agent_date", "author_name", "project_number", "project_name", "project_address",
      "project_city", "project_lat", "project_lng", "assignee_name", "created_by_name", "mine", "notes", "last_update", "last_update_source",
      "days_since_update", "last_note", "needs_update"];
    same(READS.filter((c) => !cols.includes(c)), [], "columns map/tasks.js toTask reads from my_tasks");
    for (const c of ["sub_category", "due_time", "legacy_sp_id", "author_name", "agent_kind", "agent_ref", "agent_date"]) ok(catalog.tables.tasks.cols[c], "tasks." + c);
    for (const c of ["via", "on_behalf_of", "source_key", "author_name"]) ok(catalog.tables.task_notes.cols[c], "task_notes." + c);
    same(Object.keys(catalog.tables.tasks.cols).filter((c) => PRICED.test(c)), [], "no priced task column exists");
    same(cols.filter((c) => PRICED.test(c)), [], "my_tasks answers no priced column");
    for (const t of ["projects", "notifications_outbox", "push_subscriptions"]) ok(catalog.tables[t], t);
  });

  await check("create() (Q8): a lead for anyone — one outbox row in the Access wording with the Portal 2 link (P3 check 5); field and the accountant for themselves or nobody; a viewer nothing; nobody sets the agents' or the import's columns", async () => {
    let me = await as("lead");
    me = await sbm.me();
    T3.forField = await tasksRepo.create({ title: "Check the hold-downs", description: "North wall first", category: "General Task", subCategory: "Review",
      priority: "high", assignedTo: PEOPLE.field.id, projectId: S.p1.id, dueDate: today3, dueTime: "07:30" }, me);
    same([T3.forField.assigned_to, T3.forField.created_by, T3.forField.due_time, T3.forField.sub_category, T3.forField.status],
      [PEOPLE.field.id, PEOPLE.lead.id, "07:30:00", "Review", "open"], "created");
    const ob = await sql("select * from public.notifications_outbox where task_id = $1", [T3.forField.id]);
    same(ob.length, 1, "one notice");
    same(ob[0].subject, "New Request - General Task - Review - Check the hold-downs", "the Access subject");
    ok(ob[0].body.includes("https://portal.dcrframing.com/my-tasks.html?task=" + T3.forField.id) && ob[0].body.includes("=".repeat(39)) &&
      ob[0].body.includes("\r\n") && ob[0].body.includes("Project ID: #" + S.p1.internalIDNumber), "the body: the 39-character rules, CRLF, the project, the link");
    same([ob[0].to_profile_id, ob[0].kind, ob[0].email_wanted], [PEOPLE.field.id, "task_new", false], "to the field person; no e-mail until the owner turns it on");
    T3.forLead = await tasksRepo.create({ title: "Order the beams", assignedTo: PEOPLE.lead.id, projectId: S.p2.id }, me);
    same((await sql("select count(*)::int as n from public.notifications_outbox where task_id = $1", [T3.forLead.id]))[0].n, 0, "no notice to oneself");
    await as("field");
    const f = await sbm.me();
    T3.fieldOwn = await tasksRepo.create({ title: "Bring the long ladder", assignedTo: PEOPLE.field.id, projectId: S.p1.id }, f);
    T3.fieldNobody = await tasksRepo.create({ title: "Find the chalk line", projectId: S.p1.id }, f);
    same([T3.fieldOwn.assigned_to, T3.fieldNobody.assigned_to], [PEOPLE.field.id, null], "field: themself or nobody");
    const raw = await client.from("tasks").insert({ title: "For the lead", assigned_to: PEOPLE.lead.id, project_id: S.p1.id }).select("*");
    same(raw.error && raw.error.code, "42501", "field gives a task to someone else (the database refuses)");
    for (const extra of [{ agent_kind: "photo", agent_ref: "PV-X", agent_date: today3 }, { legacy_sp_id: 99 }, { author_name: "Someone" }]) {
      const r = await client.from("tasks").insert(Object.assign({ title: "x", assigned_to: PEOPLE.field.id, project_id: S.p1.id }, extra)).select("*");
      same(r.error && r.error.code, "42501", "a person sets " + Object.keys(extra)[0]);
    }
    await as("accountant");
    const a = await sbm.me();
    T3.acctOwn = await tasksRepo.create({ title: "Collect the receipts", assignedTo: PEOPLE.accountant.id }, a);
    same(T3.acctOwn.project_id, null, "a task without a project");
    same((await client.from("tasks").insert({ title: "For field", assigned_to: PEOPLE.field.id }).select("*")).error.code, "42501", "the accountant for someone else");
    await as("viewer");
    await refused(() => tasksRepo.create({ title: "Nope" }, { id: PEOPLE.viewer.id, role: "viewer" }), "42501", "a viewer creates nothing");
  });

  await check("who reads which task through REST (Q3, P3 check 1): the office and leads all; field their own and the ones they made; a viewer theirs; the agents account none", async () => {
    await as("admin");
    const all = (await client.from("tasks").select("id")).data.length;
    ok(all >= 5, "tasks made: " + all);
    // own or made: counted by the table's owner (earlier checks made tasks too, e.g. the search's)
    const ownOrMade = async (k) => (await sql("select count(*)::int as n from public.tasks where assigned_to = $1 or created_by = $1", [PEOPLE[k].id]))[0].n;
    const want = { admin: all, manager: all, manager2: all, accountant: all, lead: all,
      field: await ownOrMade("field"), field2: await ownOrMade("field2"), viewer: await ownOrMade("viewer") };
    ok(want.field >= 3 && want.field < all, "field's own and made: " + want.field + " of " + all);
    for (const [k, n] of Object.entries(want)) {
      await as(k);
      const r = await client.from("tasks").select("id, assigned_to, created_by");
      same(r.data.length, n, k + " reads tasks");
      if (k === "field") ok(r.data.every((t) => t.assigned_to === PEOPLE.field.id || t.created_by === PEOPLE.field.id), "field: own or made");
    }
    await as("agents");
    same(((await client.from("tasks").select("id")).data || []).length, 0, "agents");
  });

  await check("list(view) through my_tasks: mine for everyone; a lead's crew (crew_members -> employees.profile_id); everyone for the office and leads; a view the role does not have is 42501; mapped as the pages draw them", async () => {
    await as("field");
    const mine = await tasksRepo.list("mine", { me: PEOPLE.field.id });
    const wantMine = (await sql(`select id from public.tasks where status = 'open' and (assigned_to = $1 or (assigned_to is null and created_by = $1)) order by id`,
      [PEOPLE.field.id])).map((r) => Number(r.id));
    same(mine.map((t) => Number(t.id)).sort((a, b) => a - b), wantMine, "field: assigned, and made for nobody");
    ok([T3.forField.id, T3.fieldOwn.id, T3.fieldNobody.id].every((id) => wantMine.includes(Number(id))), "this phase's three");
    const t = mine.find((x) => x.id === T3.forField.id);
    same([t.projectNumber, t.address, t.city, t.assigneeName, t.requestedBy, t.mine, t.priority, t.dueTime, t.subCategory],
      [S.p1.internalIDNumber, "100 Sample Rd", "Paso Robles", "Flo Field", "Lee Lead", true, "high", "07:30", "Review"], "the task as My Tasks draws it");
    same([t.daysSinceUpdate, t.lastUpdateSource, t.needsUpdate], [0, "requested", false], "a new task's clock");
    await refused(() => tasksRepo.list("everyone"), "42501", "field: everyone's");
    await refused(() => tasksRepo.list("crew"), "42501", "field: a crew");
    await as("lead");
    const crew = await tasksRepo.list("crew", { me: PEOPLE.lead.id });
    ok(crew.some((x) => x.id === T3.forField.id) && crew.some((x) => x.id === T3.forLead.id), "a lead's crew list: their own and their crew's");
    ok(!crew.some((x) => x.id === T3.acctOwn.id), "not someone outside the crew");
    const every = await tasksRepo.list("everyone", { me: PEOPLE.lead.id });
    ok(every.some((x) => x.id === T3.acctOwn.id), "everyone's: a lead (Q3)");
    for (const k of ["accountant", "manager"]) {
      await as(k);
      ok((await tasksRepo.list("everyone")).length === every.length, k + " everyone");
      await refused(() => tasksRepo.list("crew"), "42501", k + ": crew is a lead's");
    }
    await as("viewer");
    same((await tasksRepo.list("mine")).length, 0, "a viewer with nothing given to them");
    await as("lead");
    const s = tmap.summaryOf(await tasksRepo.summary());
    const mineOf = async (k) => (await sql(`select count(*)::int as n from public.tasks where status = 'open' and (assigned_to = $1 or (assigned_to is null and created_by = $1))`,
      [PEOPLE[k].id]))[0].n;
    const leadMine = await mineOf("lead");
    ok(s.open === leadMine && s.open === (await tasksRepo.list("mine")).length && s.crew === crew.length && s.everyone === every.length,
      "summary for a lead (mine, crew, everyone as the lists): " + JSON.stringify(s));
    await as("field");
    const fs = tmap.summaryOf(await tasksRepo.summary());
    const fieldMine = await mineOf("field");
    same([fs.open, fs.crew, fs.everyone], [fieldMine, null, null], "summary for field");
    same(tmap.badgeOf(fs), { text: fieldMine + " open", cls: "dim" }, "field's badge");
  });

  await check("addNote() (P3 check 2): one line; the same client key adds ONE note; refused on a done task with 'already complete' (the page shows the words back); a viewer and a stranger refused", async () => {
    await as("field");
    const t = (await tasksRepo.list("mine", { me: PEOPLE.field.id })).find((x) => x.id === T3.forField.id);
    const key = tmap.clientKey();
    const a = await tasksRepo.addNote(t, "  Started\n the north wall  ", key);
    const b = await tasksRepo.addNote(t, "Started the north wall", key);
    same(a.id, b.id, "the resend answers the note already written");
    const rows = await sql("select text, via, source_key, created_by::text as by from public.task_notes where task_id = $1", [t.id]);
    same(rows.map((r) => [r.text, r.via, r.source_key, r.by]), [["Started the north wall", "portal", "portal:" + key, PEOPLE.field.id]], "one note, one line, via portal");
    await refused(() => tasksRepo.addNote(t, "x".repeat(2001), tmap.clientKey()), "22023", "more than 2,000 characters");
    const raw = await client.from("task_notes").insert({ task_id: t.id, text: "texted", via: "sms" }).select("*");
    same(raw.error && raw.error.code, "42501", "a person never files a channel's words");
    await as("field2");
    await refused(() => tasksRepo.addNote({ id: t.id }, "not mine", tmap.clientKey()), "PT404", "someone else's task: not on my list");
    await as("viewer");
    await refused(() => tasksRepo.addNote({ id: t.id }, "x"), "PT404", "a viewer does not read it");
    await as("lead");
    const own = (await tasksRepo.list("mine", { me: PEOPLE.lead.id })).find((x) => x.id === T3.forLead.id);
    await tasksRepo.complete(own, "");
    const e = await refused(() => tasksRepo.addNote(own, "Too late", tmap.clientKey()), "23514", "a done task");
    ok(e.complete === true && /already complete/i.test(e.message), "err.complete: " + e.message);
  });

  await check("complete() (one transaction): a moved version is PT409 and nothing is written; the status and the closing note together (via portal); done again writes nothing; reopen() is versioned", async () => {
    await as("field");
    let t = (await tasksRepo.list("mine", { me: PEOPLE.field.id })).find((x) => x.id === T3.fieldOwn.id);
    await as("manager");
    const bump = await client.from("tasks").update({ priority: "urgent" }).eq("id", t.id).select("version");
    ok(!bump.error && bump.data.length === 1, "someone else changed it");
    await as("field");
    const n0 = (await sql("select count(*)::int as n from public.task_notes where task_id = $1", [t.id]))[0].n;
    await refused(() => tasksRepo.complete(t, "All done"), "PT409", "the version the page read");
    same((await sql("select status from public.tasks where id = $1", [t.id]))[0].status, "open", "nothing written");
    t = (await tasksRepo.list("mine", { me: PEOPLE.field.id })).find((x) => x.id === T3.fieldOwn.id);
    const done = await tasksRepo.complete(t, "All done\nladder back on the truck");
    same(done.status, "done", "done");
    const notes = await sql("select text, via from public.task_notes where task_id = $1 order by id", [t.id]);
    same(notes.length, n0 + 1, "one closing note");
    same([notes[notes.length - 1].text, notes[notes.length - 1].via], ["All done ladder back on the truck", "portal"], "one line, via portal");
    const again = await tasksRepo.complete(t, "All done\nladder back on the truck", PEOPLE.field.id);
    same([again.status, again.already], ["done", undefined], "done again (a lost answer, mine)");
    same((await sql("select count(*)::int as n from public.task_notes where task_id = $1", [t.id]))[0].n, n0 + 1, "no second note");
    const row = (await client.from("tasks").select("*").eq("id", t.id)).data[0];
    const back = await tasksRepo.reopen({ id: t.id, version: row.version });
    same([back.status, back.completed_at], ["open", null], "open again");
    // completed elsewhere first (the office, no live event on the phone): the page is told, the words kept once
    await as("manager");
    const byOffice = await client.rpc("complete_task", { p_id: t.id, p_version: back.version, p_note: null });
    ok(!byOffice.error, "the office completed it: " + JSON.stringify(byOffice.error));
    await as("field");
    const words = "Garage sheathing finished, nails short by one box";
    const late = await tasksRepo.complete({ id: t.id, version: back.version, title: t.title }, words, PEOPLE.field.id);
    same([late.status, late.already, late.completed_by], ["done", true, PEOPLE.manager.id], "already: someone else completed it first");
    await tasksRepo.complete({ id: t.id, version: back.version, title: t.title }, words, PEOPLE.field.id);
    const kept = await sql("select text, via, created_by from public.task_notes where task_id = $1 and text = $2", [t.id, words]);
    same(kept.map((n) => [n.text, n.via, n.created_by]), [[words, "portal", PEOPLE.field.id]], "the closing words kept once, as the field person's");
    const now = (await client.from("tasks").select("version").eq("id", t.id)).data[0];
    same((await tasksRepo.reopen({ id: t.id, version: now.version })).status, "open", "open again for the checks below");
    await as("viewer");
    await refused(() => tasksRepo.complete({ id: t.id, version: back.version }, ""), "PT404", "a viewer does not read it");
  });

  await check("the clock (P3 check 3): app.task_clock and Portal 2's clockOf agree on DCR Desktop 2's shared cases (the 5-day edge at 11:30 pm Pacific, notes, shoots)", async () => {
    const file = path.join(D2, "tools", "pglite_check", "task_clock_cases.json");
    ok(existsSync(file), "tools/pglite_check/task_clock_cases.json");
    const spec = JSON.parse(readFileSync(file, "utf8"));
    await sql("alter table public.tasks disable trigger t90_audit");
    await sql("alter table public.task_notes disable trigger t90_audit");
    try {
      for (const c of spec.cases) {
        const t = (await sql(`insert into public.tasks (title, status, created_at, agent_kind, agent_ref, agent_date)
                              values ('clock case', 'open', $1::timestamptz, $2, $3, $4::date) returning *`,
          [c.task.created_at, c.task.agent_kind || null, c.task.agent_kind ? "case" : null, c.task.agent_date || null]))[0];
        const notes = [];
        for (const n of c.notes || []) {
          notes.push((await sql("insert into public.task_notes (task_id, text, via, created_at) values ($1, $2, 'import', $3::timestamptz) returning *",
            [t.id, n.text, n.created_at]))[0]);
        }
        const db = (await sql(`select c.last_update::text as last_update, c.last_update_source, c.days_since_update, c.last_note, c.needs_update
                                 from public.tasks t, app.task_clock(t, $2::timestamptz) c where t.id = $1`, [t.id, c.at]))[0];
        const js = tmap.clockOf(Object.assign({}, t, { created_at: new Date(t.created_at).toISOString(), agent_date: c.task.agent_date || null }),
          notes.map((n) => Object.assign({}, n, { created_at: new Date(n.created_at).toISOString() })), tmap.dayOf(c.at));
        same([js.last_update_source, js.days_since_update, js.last_note, js.needs_update], [db.last_update_source, db.days_since_update, db.last_note, db.needs_update], c.name);
        ok(Date.parse(js.last_update) === Date.parse(db.last_update), c.name + ": last_update");
        await sql("delete from public.tasks where id = $1", [t.id]);
      }
    } finally {
      await sql("alter table public.tasks enable trigger t90_audit");
      await sql("alter table public.task_notes enable trigger t90_audit");
    }
  });

  await check("a task handed AWAY from a field person leaves the 'no longer yours' tombstone only they read (M1 7b; live.js turns it into a DELETE); the new assignee gets a notice", async () => {
    await as("manager");
    const row = (await client.from("tasks").select("*").eq("id", T3.forField.id)).data[0];
    const moved = await client.from("tasks").update({ assigned_to: PEOPLE.field2.id }).eq("id", row.id).eq("version", row.version).select("*");
    ok(!moved.error && moved.data.length === 1, "reassigned " + JSON.stringify(moved.error));
    await as("field");
    const tomb = (await client.from("deletions").select("*").eq("table_name", "tasks").eq("row_id", row.id)).data;
    ok(tomb.length === 1 && tomb[0].for_user === PEOPLE.field.id, "the field person reads it: " + JSON.stringify(tomb));
    ok(!(await tasksRepo.list("mine", { me: PEOPLE.field.id })).some((t) => t.id === row.id), "it left their list");
    await as("lead");
    same((await client.from("deletions").select("*").eq("table_name", "tasks").eq("row_id", row.id)).data.length, 0, "nobody else reads it");
    same((await sql("select count(*)::int as n from public.notifications_outbox where task_id = $1 and to_profile_id = $2", [row.id, PEOPLE.field2.id]))[0].n, 1,
      "a notice for the new person");
  });

  await check("forProject() / getOne() name only real columns: a project's tasks open and done with notes; one task (done reads as done; not readable is null)", async () => {
    await as("lead");
    const list = await tasksRepo.forProject(S.p1.id, { me: PEOPLE.lead.id, project: S.p1 });
    ok(list.length >= 3 && list.every((t) => t.projectNumber === S.p1.internalIDNumber), "the project's tasks: " + list.length);
    const withNotes = list.find((t) => t.id === T3.forField.id);
    ok(withNotes && withNotes.notes.length === 1 && withNotes.notes[0].who === "Flo Field", "notes and their author");
    await as("field");
    const done = await tasksRepo.getOne(T3.forLead.id);
    same(done, null, "not readable by field: null");
    await as("lead");
    const d = await tasksRepo.getOne(T3.forLead.id, { me: PEOPLE.lead.id });
    same([d.done, d.projectNumber], [true, S.p2.internalIDNumber], "a done task, with its project");
  });

  await check("watch('tasks') / watch('task_notes') — My Tasks' and the map's live channels: every active role joins; the agents account cannot", async () => {
    const join = (table) => new Promise((res) => {
      let stop = null;
      const t = setTimeout(() => { if (stop) stop(); res("timeout"); }, 3000);
      stop = live.watch(table, null, (evt) => { if (evt.type === "SUBSCRIBED") { clearTimeout(t); stop(); res("SUBSCRIBED"); } });
    });
    for (const k of ["admin", "lead", "field", "viewer"]) {
      await as(k);
      same([await join("tasks"), await join("task_notes")], ["SUBSCRIBED", "SUBSCRIBED"], k);
    }
    await as("agents");
    same(await join("tasks"), "timeout", "agents never joins");
    for (const ch of client.channels) ch.unsubscribe();
  });

  await check("the agents account (P1 check 10, the M3 objects): zero rows from tasks, task_notes, notifications_outbox, push_subscriptions; refused by my_tasks, my_tasks_summary, add_task_note, complete_task", async () => {
    await as("agents");
    for (const t of ["tasks", "task_notes", "notifications_outbox", "push_subscriptions"]) {
      const r = await client.from(t).select("id").limit(5);
      ok(r.error || (r.data && r.data.length === 0), t + ": " + JSON.stringify(r.error || r.data));
    }
    await refused(() => tasksRepo.list("mine"), "42501", "my_tasks");
    await refused(() => tasksRepo.summary(), "42501", "my_tasks_summary");
    await refused(() => tasksRepo.addNote({ id: T3.fieldOwn.id }, "x", tmap.clientKey()), "42501", "add_task_note");
    await refused(() => tasksRepo.complete({ id: T3.fieldOwn.id, version: 1 }, ""), "42501", "complete_task");
    await as("admin");
    same((await client.from("notifications_outbox").insert({ subject: "x", body: "y" }).select()).error.code, "42501", "nobody writes the outbox, an admin neither");
    for (const k of ["lead", "field"]) {
      await as(k);
      same(((await client.from("notifications_outbox").select("id")).data || []).length, 0, k + " reads no notice (admins only)");
    }
    await as("agents");
    same(((await client.from("task_clocks").select("task_id")).data || []).length, 0, "agents: no task clock");
  });

  await check("no priced task column in any answer a lead gets (P3 check 6): tasks, task_notes, task_clocks, my_tasks (mine, crew, everyone), a project's tasks, one task", async () => {
    await as("lead");
    const keysOf = (rows) => Array.from(new Set((rows || []).flatMap((r) => Object.keys(r || {}))));
    const answers = {
      tasks: (await client.from("tasks").select("*")).data,
      task_notes: (await client.from("task_notes").select("*")).data,
      task_clocks: (await client.from("task_clocks").select("*")).data,
      my_tasks_mine: (await client.rpc("my_tasks", { p_view: "mine" })).data,
      my_tasks_crew: (await client.rpc("my_tasks", { p_view: "crew" })).data,
      my_tasks_everyone: (await client.rpc("my_tasks", { p_view: "everyone" })).data,
    };
    for (const [k, rows] of Object.entries(answers)) {
      ok(Array.isArray(rows) && rows.length > 0, k + ": the lead reads rows");
      same(keysOf(rows).filter((c) => PRICED.test(c)), [], k + ": priced keys");
      const notes = rows.flatMap((r) => (Array.isArray(r.notes) ? r.notes : []));
      same(keysOf(notes).filter((c) => PRICED.test(c)), [], k + ": priced keys in the notes");
    }
    const tab = await tasksRepo.forProject(S.p1.id, { me: PEOPLE.lead.id, project: S.p1 });
    const one = await tasksRepo.getOne(T3.fieldOwn.id, { me: PEOPLE.lead.id });
    ok(tab.length > 0 && one, "the tab and one task read");
    same(keysOf(tab.concat([one])).filter((c) => PRICED.test(c)), [], "the project's Tasks tab and one task (as the pages hold them)");
    same(keysOf(tab.concat([one]).flatMap((t) => t.notes || [])).filter((c) => PRICED.test(c)), [], "their notes");
  });

  await check("signed out (anon): every P3 table and view answers nothing, every P3 RPC is refused", async () => {
    await as(null);
    for (const t of ["tasks", "task_notes", "task_clocks", "notifications_outbox", "push_subscriptions"]) {
      const r = await client.from(t).select("*").limit(5);
      ok(r.error || (r.data && r.data.length === 0), "anon reads " + t + ": " + JSON.stringify(r.error || r.data).slice(0, 160));
    }
    for (const [fn, args] of [["my_tasks", { p_view: "mine" }], ["my_tasks_summary", {}], ["add_task_note", { p_task_id: T3.fieldOwn.id, p_text: "x", p_client_key: "anon-1" }],
      ["complete_task", { p_id: T3.fieldOwn.id, p_version: 1, p_note: null, p_via: "portal" }]]) {
      const r = await client.rpc(fn, args);
      same(r.error && r.error.code, "42501", "anon calls " + fn);
    }
    const w = await client.from("push_subscriptions").insert({ endpoint: "https://fcm.googleapis.com/fcm/send/anon", p256dh: "B" + "x".repeat(86), auth: "y".repeat(22) });
    ok(w.error, "anon adds no subscription");
    same((await sql("select count(*)::int as n from public.task_notes where source_key = 'portal:anon-1'"))[0].n, 0, "nothing written");
  });

  /* ── P3 check 4: phone reminders end to end over this database ─────────────────────────────── */
  const HANDLER = path.join(D2, "supabase", "functions", "push", "handler.ts");
  const SQLTS = path.join(D2, "supabase", "functions", "push", "sql.ts");
  const VAPIDMJS = path.join(D2, "tools", "push", "vapid.mjs");
  if (!existsSync(HANDLER) || !existsSync(SQLTS) || !existsSync(VAPIDMJS)) {
    results.push({ section, name: "the push function (DCR Desktop 2 supabase/functions/push) is not there: the phone-reminder checks wait for it", ok: true });
  } else {
    const fn = await import(pathToFileURL(HANDLER).href);
    const { SQL: PSQL, SERVICE_ROLE, jsonList } = await import(pathToFileURL(SQLTS).href);
    const { generateVapidKeys } = await import(pathToFileURL(VAPIDMJS).href);
    const push2 = await site("push2.js");
    const SITE_URL = "https://portal.dcrframing.com";
    const b64u = (b) => Buffer.from(b).toString("base64url");
    const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, len));

    /* the push service a browser hands its endpoint to: records what it is sent; a "dead" endpoint answers 410 */
    const pushSvc = { calls: [], dead: new Set() };
    /* the browsers: each subscription has its own P-256 key pair and auth secret, as a real one does */
    let device = null;
    const devices = [];
    function newDevice(label, ua) {
      const d = { label, ua, sub: null };
      const subObj = () => {
        const s = d.sub;
        return {
          endpoint: s.endpoint,
          options: { userVisibleOnly: true, applicationServerKey: Uint8Array.from(s.key).buffer },
          toJSON: () => ({ endpoint: s.endpoint, expirationTime: null, keys: { p256dh: b64u(s.pub), auth: b64u(s.auth) } }),
          unsubscribe: async () => { if (d.sub && d.sub.endpoint === s.endpoint) d.sub = null; return true; },
        };
      };
      const reg = {
        pushManager: {
          getSubscription: async () => (d.sub ? subObj() : null),
          subscribe: async (o) => {
            const key = Buffer.from(o.applicationServerKey);
            if (!o.userVisibleOnly || key.length !== 65 || key[0] !== 4) throw new Error("bad subscribe options");
            if (d.sub && !Buffer.from(d.sub.key).equals(key)) throw new Error("InvalidStateError: a subscription with another key exists");
            if (!d.sub) {
              const e = crypto.createECDH("prime256v1");
              e.generateKeys();
              d.sub = { endpoint: "https://fcm.googleapis.com/fcm/send/schema-check-" + crypto.randomBytes(12).toString("hex"),
                key, priv: e.getPrivateKey(), pub: e.getPublicKey(), auth: crypto.randomBytes(16) };
            }
            return subObj();
          },
        },
      };
      d.nav = { userAgent: ua, platform: /Android/.test(ua) ? "Linux armv8l" : "Win32", maxTouchPoints: /Android/.test(ua) ? 5 : 0,
        serviceWorker: { ready: Promise.resolve(reg) } };
      devices.push(d);
      return d;
    }
    const PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
    const DESK = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    const navBefore = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const winBefore = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "navigator", { configurable: true, get: () => (device ? device.nav : {}) });
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: {
      isSecureContext: true, PushManager: function PushManager() {}, matchMedia: () => ({ matches: false }),
      Notification: { permission: "granted", requestPermission: async () => "granted" } } });
    const use = (d) => { device = d; return d; };

    /** What a device's push service received, decrypted with that subscription's own keys (RFC 8291). */
    function decrypt(body, s) {
      const b = Buffer.from(body);
      const salt = b.subarray(0, 16), idlen = b[20], asPub = b.subarray(21, 21 + idlen), ct = b.subarray(21 + idlen);
      const e = crypto.createECDH("prime256v1");
      e.setPrivateKey(s.priv);
      const ikm = hkdf(s.auth, e.computeSecret(asPub), Buffer.concat([Buffer.from("WebPush: info\0"), s.pub, asPub]), 32);
      const d = crypto.createDecipheriv("aes-128-gcm", hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
        hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12));
      d.setAuthTag(ct.subarray(ct.length - 16));
      const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
      let end = pt.length - 1;
      while (end >= 0 && pt[end] === 0) end--;
      if (pt[end] !== 2) throw new Error("the record's padding delimiter is missing");
      return JSON.parse(pt.subarray(0, end).toString("utf8"));
    }
    /** The VAPID header: "vapid t=<ES256 JWT for the endpoint's origin>, k=<the public key>", the JWT verified with k alone. */
    function vapidOk(header, endpoint, publicKey) {
      const m = /^vapid t=([^,\s]+), k=([A-Za-z0-9_-]+)$/.exec(String(header || ""));
      if (!m || m[2] !== publicKey) return false;
      const [h, p, s] = m[1].split(".");
      const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
      const pub = Buffer.from(publicKey, "base64url");
      const key = crypto.createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
      return claims.aud === new URL(endpoint).origin && claims.sub === SITE_URL && claims.exp > Date.now() / 1000 &&
        crypto.verify("sha256", Buffer.from(h + "." + p), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
    }

    const vapid = await generateVapidKeys();                                   // this run only, in memory
    let vapidSet = true;
    /** index.ts's run(): its own transaction, `set local role service_role`, no JWT */
    const service = async (statement, param) => client.run(async () => {
      await db.exec("begin");
      try {
        await db.exec(SERVICE_ROLE);
        const rows = (await db.query(statement, [param])).rows;
        await db.exec("commit");
        return rows;
      } catch (e) { await db.exec("rollback"); throw e; }
    }, "owner");
    const deps = {
      vapid: () => (vapidSet ? { publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: SITE_URL } : null),
      // index.ts: Auth knows the token, then the caller's OWN profiles row read with the caller's token
      async caller(jwt) {
        const sub = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")).sub;
        const rows = await client.run(async () => (await db.query("select id::text as id, role, active from public.profiles where id = auth.uid()")).rows, sub);
        return rows[0] ? { id: rows[0].id, role: rows[0].role, active: !!rows[0].active } : { id: sub, role: "", active: false };
      },
      activeProfiles: async (ids) => (await service(PSQL.activeProfiles, jsonList(ids))).map((r) => String(r.id)),
      employeeProfile: async (id) => { const r = await service(PSQL.employeeProfile, String(id)); return r.length ? String(r[0].id) : null; },
      pushTargets: async (ids) => (await service(PSQL.pushTargets, jsonList(ids))).map((r) => ({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth, profile_id: r.profile_id })),
      pushPrune: async (eps) => { await service(PSQL.pushPrune, jsonList(eps)); },
      takeNewTaskNotices: async (n) => (await service(PSQL.takeNotices, String(n))).map((r) => ({ task_id: r.task_id, to_profile_id: r.to_profile_id, title: r.title })),
      markOk: async (eps) => { await service(PSQL.markOk, jsonList(eps)); },
      fetch: async (url, init) => {
        pushSvc.calls.push({ url, headers: init.headers, body: init.body });
        return new Response(null, { status: pushSvc.dead.has(url) ? 410 : 201 });
      },
      log: () => {},
    };
    /* supabase-js functions.invoke over the handler: the person's token (signed out: the publishable key, no person) */
    const inflight = new Set();
    const jwtOf = (uid) => b64u(JSON.stringify({ alg: "ES256", typ: "JWT" })) + "." + b64u(JSON.stringify(uid ? { sub: uid, role: "authenticated" } : { role: "anon" })) + ".sig";
    client.functions = {
      invoke(name, o) {
        const p = (async () => {
          if (name !== "push") return { data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: new Response("{}", { status: 404 }) }) };
          const res = await fn.handle(new Request("https://pglite.invalid/functions/v1/push", { method: "POST",
            headers: { "Content-Type": "application/json", Origin: SITE_URL, Authorization: "Bearer " + jwtOf(client.uid) },
            body: JSON.stringify((o && o.body) || {}) }), deps);
          if (res.ok) return { data: await res.json(), error: null };
          return { data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { name: "FunctionsHttpError", context: res }) };
        })();
        inflight.add(p);
        p.finally(() => inflight.delete(p)).catch(() => {});
        return p;
      },
    };
    /** Waits for the fire-and-forget calls a page made (they start a moment after the call that made them). */
    const settle = async () => {
      do {
        await new Promise((r) => setTimeout(r, 25));
        await Promise.allSettled(Array.from(inflight));
      } while (inflight.size);
    };
    const call = async (body) => {
      const r = await client.functions.invoke("push", { body });
      return { status: r.error ? r.error.context.status : 200, data: r.error ? await r.error.context.json().catch(() => null) : r.data };
    };
    const rowsOf = async (k) => (await sql("select endpoint, device from public.push_subscriptions where profile_id = $1 order by id", [PEOPLE[k].id]));
    const P = {};

    try {
      await check("phone reminders on and off (push2.js over the real push_subscriptions rules): every active role keeps its OWN row; nobody, an admin included, reads, changes or removes anyone else's; off removes it; the agents account cannot (P3 check 4)", async () => {
        for (const k of ROLES) {
          await as(k);
          P[k] = use(newDevice(k + " phone", PHONE));
          same((await push2.state()).status, "off", k + ": off at first");
          same(await push2.enable(), true, k + ": turned on");
          same((await push2.state()).status, "on", k + ": on");
          const mine = await rowsOf(k);
          same(mine.map((r) => [r.endpoint, r.device]), [[P[k].sub.endpoint, "Android (browser)"]], k + ": one row, this device's, nothing personal in its name");
        }
        for (const k of ROLES) {
          await as(k);
          const r = await client.from("push_subscriptions").select("*");
          same((r.data || []).map((x) => x.profile_id), [PEOPLE[k].id], k + " reads its own row only");
        }
        await as("admin");
        await client.from("push_subscriptions").delete().eq("endpoint", P.field.sub.endpoint);
        const ch = await client.from("push_subscriptions").update({ device: "taken" }).eq("endpoint", P.field.sub.endpoint).select("id");
        same([(await rowsOf("field")).length, ((ch.data) || []).length], [1, 0], "an admin can neither remove nor change the field person's row");
        const forged = await client.from("push_subscriptions").insert({ profile_id: PEOPLE.field.id, endpoint: "https://fcm.googleapis.com/fcm/send/forged", p256dh: "B" + "x".repeat(86), auth: "y".repeat(22) });
        same(forged.error && forged.error.code, "42501", "an admin subscribes nobody else");
        await as("agents");
        use(newDevice("agents pc", DESK));
        await refused(() => push2.enable(), null, "the agents account keeps no subscription");
        same((await rowsOf("agents")).length, 0, "agents: no row");
        await as("viewer");
        use(P.viewer);
        await push2.disable();
        same([(await rowsOf("viewer")).length, P.viewer.sub], [0, null], "viewer: off removes the row and the browser's subscription");
      });

      await check("the push function over this database (DCR Desktop 2's handler.ts + sql.ts as the service role): the key for every active account (the agents account too), 403 inactive, 401 signed out, 503 without keys; send only by an admin or the agents account (403 for every other role); the test notice reaches the caller's OWN devices only; app.push_* not reachable through the Data API", async () => {
        for (const k of [...ROLES, "agents"]) {
          await as(k);
          const r = await call({ op: "public_key" });
          same([r.status, r.data && r.data.key], [200, vapid.publicKey], k + ": op public_key");
        }
        await as("inactive");
        same((await call({ op: "public_key" })).status, 403, "an inactive account");
        await as(null);
        same((await call({ op: "public_key" })).status, 401, "signed out");
        await as("field");
        vapidSet = false;
        same((await call({ op: "drain" })).status, 503, "no keys yet: 503 (nothing claimed)");
        vapidSet = true;
        for (const k of ["manager", "manager2", "accountant", "lead", "field", "viewer"]) {
          await as(k);
          const r = await call({ op: "send", profile_ids: [PEOPLE.field.id], title: "Not from you" });
          same([r.status, r.data && r.data.error], [403, "forbidden"], k + ": op send");
        }
        same(pushSvc.calls.length, 0, "nothing was sent so far");
        await as("admin");
        const sent = await call({ op: "send", employee_id: E.field.id, title: "From the office", body: "Gate code changed", url: SITE_URL + "/my-tasks.html", tag: "office" });
        same([sent.status, sent.data], [200, { sent: 1, gone: 0, failed: 0, none: false }], "an admin sends to the field person's employee");
        same(pushSvc.calls.map((c) => c.url), [P.field.sub.endpoint], "to the field person's phone only");
        const got = decrypt(pushSvc.calls[0].body, P.field.sub);
        same(got, { title: "From the office", body: "Gate code changed", url: SITE_URL + "/my-tasks.html", tag: "office" }, "what the phone decrypts");
        ok(vapidOk(pushSvc.calls[0].headers.Authorization, P.field.sub.endpoint, vapid.publicKey), "the VAPID token: this key, the push service's origin, verified with the public key");
        same([pushSvc.calls[0].headers.TTL, pushSvc.calls[0].headers["Content-Encoding"]], ["21600", "aes128gcm"], "TTL 6 h, aes128gcm");
        same((await call({ op: "send", profile_ids: [PEOPLE.field.id], title: "x", url: "https://evil.example/x" })).status, 400, "a link off Portal 2 is refused");
        await as("agents");
        same((await call({ op: "send", profile_ids: [PEOPLE.field.id, PEOPLE.inactive.id], title: "Reminder" })).data, { sent: 1, gone: 0, failed: 0, none: false }, "the agents account sends (an inactive person is skipped)");
        pushSvc.calls = [];
        await as("lead");
        same((await push2.sendTest()).message, "Sent to 1 device. It should arrive within a few seconds.", "the lead's test notice (push2.sendTest)");
        same(pushSvc.calls.map((c) => c.url), [P.lead.sub.endpoint], "to the lead's own device only");
        same(decrypt(pushSvc.calls[0].body, P.lead.sub).url, SITE_URL + "/settings.html", "the test notice opens Settings");
        await as("viewer");
        same((await push2.sendTest()).message, "None of your devices has reminders on yet. Turn them on above first.", "a person with reminders off");
        await as("admin");
        const api = await client.rpc("push_targets", { p_profile_ids: [PEOPLE.field.id] });
        same(api.error && api.error.code, "PGRST202", "push_targets is not in the Data API");
        const grants = await sql(`select r.rolname, bool_and(has_function_privilege(r.rolname, p.oid, 'execute')) as can
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'app'
            cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) r
           where p.proname in ('push_targets', 'push_prune', 'push_take_new_task_notices') group by r.rolname order by r.rolname`);
        same(grants.map((g) => [g.rolname, g.can]), [["anon", false], ["authenticated", false], ["service_role", true]], "app.push_*: service_role only");
      });

      await check("a new task for someone with reminders on reaches their phone: the lead's tasksRepo.create -> the page's drain -> 'New task' with my-tasks.html?task=<id> to each of their devices (decrypted); taken once; a dead device (410) is pruned (P3 check 4)", async () => {
        await as("admin");
        await call({ op: "drain" });                                       // the notices the earlier checks queued
        await as("field");
        P.fieldDesk = use(newDevice("field desk", DESK));
        same(await push2.enable(), true, "the field person's second device");
        same((await rowsOf("field")).map((r) => r.device), ["Android (browser)", "Windows (browser)"], "two devices");
        pushSvc.dead.add(P.fieldDesk.sub.endpoint);                         // that browser's data was cleared since
        pushSvc.calls = [];
        await as("lead");
        const me = await sbm.me();
        const t = await tasksRepo.create({ title: "Bring the moisture meter", assignedTo: PEOPLE.field.id, projectId: S.p1.id }, me);
        await settle();
        const byUrl = Object.fromEntries(pushSvc.calls.map((c) => [c.url, c]));
        ok(byUrl[P.field.sub.endpoint] && byUrl[P.fieldDesk.sub.endpoint] && pushSvc.calls.length === 2, "both of the field person's devices were tried: " + pushSvc.calls.length);
        same(decrypt(byUrl[P.field.sub.endpoint].body, P.field.sub),
          { title: "New task", body: "Bring the moisture meter", url: SITE_URL + "/my-tasks.html?task=" + t.id, tag: "task-" + t.id }, "the phone's notice opens the task");
        same((await rowsOf("field")).map((r) => r.endpoint), [P.field.sub.endpoint], "the dead device's row was pruned");
        const ob = await sql("select push_result, push_sent_at is not null as taken from public.notifications_outbox where task_id = $1", [t.id]);
        same(ob.map((r) => [r.push_result, r.taken]), [["claimed", true]], "the notice was taken");
        await as("field");
        same((await call({ op: "drain" })).data, { notices: 0, sent: 0, gone: 0, failed: 0, none: 0 }, "a second drain sends nothing again");
        // an amount typed in the title never reaches the lock screen (BLUEPRINT principle 8); the page masks it too
        pushSvc.calls = [];
        await as("lead");
        const money = await tasksRepo.create({ title: "Pick up the $4,500 deposit check from the client", assignedTo: PEOPLE.field.id, projectId: S.p1.id }, await sbm.me());
        await settle();
        const got = pushSvc.calls.filter((c) => c.url === P.field.sub.endpoint).map((c) => decrypt(c.body, P.field.sub));
        same(got.map((g) => g.body), ["Pick up the (amount hidden) deposit check from the client"], "the push body is masked");
        same(got[0] && got[0].url, SITE_URL + "/my-tasks.html?task=" + money.id, "and still opens the task");
        pushSvc.dead.clear();
      });

      await check("a shared device: another person signs in on the field person's phone — off for them ('set up for another account'); on takes the device over (the field person's row for it goes); at most 5 devices a person", async () => {
        await as("field2");
        use(P.field);
        const st = await push2.state();
        same([st.status, st.other], ["off", true], "the phone is someone else's");
        same(await push2.enable(), true, "turned on for field2");
        const owner = await sql("select profile_id::text as p from public.push_subscriptions where endpoint = $1", [P.field.sub.endpoint]);
        same(owner.map((r) => r.p), [PEOPLE.field2.id], "the endpoint is field2's now");
        same((await rowsOf("field")).filter((r) => r.endpoint === P.field.sub.endpoint).length, 0, "the field person's row for that phone is gone");
        await as("field");
        same((await push2.state()).status, "off", "and the field person's state says off there");
        await as("field2");
        for (let i = 0; i < 6; i++) { use(newDevice("field2 #" + i, DESK)); await push2.enable(); }
        same((await rowsOf("field2")).length, 5, "the newest 5 are kept");
      });
    } finally {
      delete client.functions;
      if (navBefore) Object.defineProperty(globalThis, "navigator", navBefore); else delete globalThis.navigator;
      if (winBefore) Object.defineProperty(globalThis, "window", winBefore); else delete globalThis.window;
    }
  }
}

// ===========================================================================================
section = "P4: DCR Agents 2's PC on the home page (repo/agents.js, migration M4)";
// ===========================================================================================
const HAS_M4 = !!(catalog.functions.agents_server_status && catalog.functions.agents_heartbeat);
const agentsRepo = await site("repo/agents.js");
const amap = await site("map/agents.js");

if (!HAS_M4) {
  results.push({ section, name: "M4 (20261023000100_agents_core) is not in DCR Desktop 2 yet: the P4 checks wait for it", ok: true });
} else {
  await check("agents_server_status() takes nothing and answers jsonb; the agents_* RPCs Portal 2 never calls are there for DCR Agents 2", async () => {
    same(catalog.functions.agents_server_status.map((f) => [f.args.length, f.rettype]), [[0, "jsonb"]], "agents_server_status() -> jsonb");
    same(catalog.functions.agents_heartbeat.map((f) => f.args.map((a) => a.name)), [["p_body"]], "agents_heartbeat(p_body)");
  });

  await check("an admin's home page: 'DCR Agents 2 PC - not seen yet' before any beat, 'last seen just now' after the agents account's heartbeat, the lease holder; every other role and the agents account itself refused (42501)", async () => {
    await sql("delete from app.agents_hosts");
    await sql("update app.agents_lease set host_id = null, since = null, lease_by = null");
    await as("admin");
    let s = await agentsRepo.serverStatus();
    same(Object.keys(s).sort(), ["generatedAt", "lease", "minutesAgo", "others", "ready", "server", "status"], "the answer's keys");
    same(amap.serverLine(s, new Date()), { text: "DCR Agents 2 PC - not seen yet", cls: "off", title: "No computer running DCR Agents 2 has reported yet." }, "no PC yet");
    client.as(PEOPLE.agents.id);
    const beat = await client.rpc("agents_heartbeat", { p_body: { host: "CHECK-PC#agents2", proto: 1, wants: true, version: "2.0.0", sentToday: 2 } });
    ok(!beat.error, "the agents account beats: " + JSON.stringify(beat.error));
    same([beat.data.you, beat.data.lease && beat.data.lease.host], ["server", "CHECK-PC#agents2"], "and takes the lease");
    await as("admin");
    s = await agentsRepo.serverStatus();
    same([s.server.host, s.server.online, s.server.minutesAgo, s.server.sentToday], ["CHECK-PC#agents2", true, 0, 2], "the server");
    same(amap.serverLine(s, new Date()), { text: "DCR Agents 2 PC - last seen just now", cls: "ok", title: "CHECK-PC#agents2 · DCR Agents 2.0.0" }, "the line");
    await sql("update app.agents_hosts set at = now() - interval '7 minutes'");
    s = await agentsRepo.serverStatus();
    same(amap.serverLine(s, new Date()), { text: "DCR Agents 2 PC - last seen 7 min ago", cls: "warn", title: "CHECK-PC#agents2 · DCR Agents 2.0.0" }, "gone quiet");
    for (const key of ["manager", "manager2", "accountant", "lead", "field", "viewer"]) {
      await as(key);
      await refused(() => agentsRepo.serverStatus(), "42501", key);
    }
    client.as(PEOPLE.agents.id);
    same((await client.rpc("agents_server_status")).error.code, "42501", "the agents account reads no status (an admin's)");
    client.as(PEOPLE.inactive.id);
    same((await client.rpc("agents_server_status")).error.code, "42501", "an inactive account");
    client.as(null);
    same((await client.rpc("agents_server_status")).error.code, "42501", "anonymous");
    await sql("delete from app.agents_hosts");
    await sql("delete from app.agents_beats");
    await sql("update app.agents_lease set host_id = null, since = null, lease_by = null");
  });

  await check("the agents account (P1 check 10, re-run for M4): reads no table and calls none of the people's RPCs; its own agents_* feeds answer it; nobody else reaches them", async () => {
    client.as(PEOPLE.agents.id);
    for (const t of ["projects", "tasks", "timesheets", "employees", "payments", "notifications_outbox"]) {
      const r = await client.from(t).select("*").limit(5);
      ok(!r.error ? r.data.length === 0 : r.error.code === "42501", t + ": nothing");
    }
    same((await client.rpc("my_tasks", { p_view: "mine" })).error.code, "42501", "my_tasks");
    const people = await client.rpc("agents_people");
    ok(!people.error && Array.isArray(people.data.people), "agents_people answers it");
    ok(people.data.people.some((p) => p.name === "Flo Field" && p.role === "Field" && p.hasAccount), "the roster, in the old words");
    for (const key of ["admin", "field", "lead"]) {
      await as(key);
      const w = await client.rpc("agents_task_note", { p_task_id: "1", p_text: "x x", p_from_profile: "Nobody", p_via: "sms" });
      same(w.error && w.error.code, "42501", key + ": a write is the agents account's only");
    }
  });
}

// ===========================================================================================
section = "P6: the console relay and the personal assistants (repo/console.js, repo/assistant.js, migration M6)";
// ===========================================================================================
const HAS_M6 = !!(catalog.functions.console_request && catalog.functions.console_get && catalog.functions.my_assistant &&
  catalog.functions.assistant_op && catalog.functions.assistant_office_view);
const consoleRepo = await site("repo/console.js");
const cmap = await site("map/console.js");
const asstRepo = await site("repo/assistant.js");
const asmap = await site("map/assistant.js");

if (!HAS_M6) {
  results.push({ section, name: "M6 (20261024000100_agents_phase6) is not in DCR Desktop 2 yet: the P6 checks wait for it", ok: true });
} else {
  const ADMIN2 = "c2000000-0000-4000-8000-00000000000c";       // a second, made-up admin: someone else's request
  const PC = "CHECK-PC#agents2";
  const beat = async (extra) => {
    client.as(PEOPLE.agents.id);
    const r = await client.rpc("agents_heartbeat", { p_body: Object.assign({ host: PC, proto: 1, wants: true, version: "2.1.0",
      consoleOn: true, consoleAt: new Date().toISOString(), assistantAt: new Date().toISOString() }, extra || {}) });
    ok(!r.error, "the agents account beats: " + JSON.stringify(r.error));
  };
  const pcCall = async (name, args) => {
    client.as(PEOPLE.agents.id);
    const r = await client.rpc(name, args);
    if (r.error) throw Object.assign(new Error(r.error.message), r.error);
    return r.data;
  };

  await check("every name and parameter Portal 2 calls is M6's (console_request / _get / _cancel, my_assistant, assistant_op / _say / _pc_status, the office's four)", async () => {
    const args = (n) => (catalog.functions[n] || []).map((f) => f.args.map((a) => a.name));
    same(args("console_request"), [["p_method", "p_args"]], "console_request");
    same(args("console_get"), [["p_id"]], "console_get");
    same(args("console_cancel"), [["p_id"]], "console_cancel");
    same(args("my_assistant"), [["p_agenda", "p_rev", "p_summary"]], "my_assistant");
    same(args("assistant_op"), [["p_op", "p_body"]], "assistant_op");
    same(args("assistant_say"), [["p_text", "p_client_id"]], "assistant_say");
    same(args("assistant_pc_status"), [[]], "assistant_pc_status");
    same(args("assistant_office_list"), [[]], "assistant_office_list");
    same(args("assistant_set"), [["p_profile_id", "p_on", "p_office_reads"]], "assistant_set");
    same(args("assistant_office_view"), [["p_profile_id"]], "assistant_office_view");
    same(args("assistant_office_item"), [["p_profile_id", "p_do", "p_item_id", "p_item"]], "assistant_office_item");
    for (const n of Object.values(asstRepo.RPC)) ok(catalog.functions[n], n + " exists");
    await sql("reset role");
    await sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [ADMIN2, "admin2@schema-check.test"]);
    await sql("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: PEOPLE.admin.id, role: "authenticated" })]);
    await sql("set role authenticated");
    await sql("insert into public.profiles (id, full_name, email, role) values ($1, 'Ada Second', 'admin2@schema-check.test', 'admin') on conflict do nothing", [ADMIN2]);
    await sql("reset role");
    await sql("select set_config('request.jwt.claims', '', false)");
  });

  await check("the console: an admin's request, read back with console_get (the old ?id= answer); someone else's id is the same PT404 as an unknown one; nobody but an admin asks or reads", async () => {
    await beat();
    await as("admin");
    const st = cmap.consoleServer(await consoleRepo.status());
    same([st.ready, st.server.host, st.server.consoleOn, st.server.online], [true, PC, true, true], "M6's status: ready, the console on");
    const r = cmap.requestOf(await consoleRepo.request("agents.list", { all: true }));
    ok(/^[0-9a-f-]{36}$/.test(r.id) && r.at, "{id, at}");
    const g = await consoleRepo.get(r.id);
    same(Object.keys(g).sort(), ["at", "doneAt", "error", "host", "id", "method", "result", "status", "takenAt"], "the old answer's keys");
    same([g.status, g.method, g.result, g.error], ["new", "agents.list", null, null], "new");
    const own = await client.from("agents_console").select("id, admin_id, status").eq("id", r.id);
    same((own.data || []).length, 1, "the admin's own row is readable (Realtime on it)");
    client.as(ADMIN2);
    const e2 = await refused(() => consoleRepo.get(r.id), "PT404", "another admin's id");
    same([e2.message, e2.hint], ["No such request.", "not_found"], "the same words as an unknown id");
    await refused(() => consoleRepo.get("00000000-0000-4000-8000-000000000000"), "PT404", "an unknown id");
    await refused(() => consoleRepo.get("junk"), "PT404", "junk");
    await refused(() => consoleRepo.cancel(r.id), "PT404", "cancel someone else's");
    same(((await client.from("agents_console").select("id").eq("id", r.id)).data || []).length, 0, "RLS: another admin reads nothing");
    for (const k of ["manager", "manager2", "accountant", "lead", "field", "viewer", "inactive"]) {
      await as(k);
      await refused(() => consoleRepo.request("agents.list", {}), "42501", k + " asks");
      await refused(() => consoleRepo.get(r.id), "42501", k + " reads");
      same(((await client.from("agents_console").select("id")).data || []).length, 0, k + ": no row through the table");
    }
    client.as(PEOPLE.agents.id);
    same((await client.rpc("console_request", { p_method: "agents.list", p_args: {} })).error.code, "42501", "the agents account never asks");
    await as("admin");
    same(await consoleRepo.cancel(r.id), { ok: true, status: "cancelled" }, "cancel while new");
    same(await consoleRepo.cancel(r.id), { ok: false, status: "cancelled" }, "only once");
    same((await consoleRepo.get(r.id)).error.code, "cancelled", "the old cancelled words");
  });

  await check("the console: the lease holder takes a request (atomically), answers it, and the admin reads the PC's data; expired and lost are worked out on read; the purge stores and then deletes them", async () => {
    await beat();
    await as("admin");
    const r = await consoleRepo.request("dashboard.status", {});
    const t = await pcCall("agents_console_take", { p_id: r.id, p_host: PC, p_timeout: 15 });
    same([t.ok, t.request && t.request.id, t.request && t.request.method], [true, r.id, "dashboard.status"], "taken");
    const again = await pcCall("agents_console_take", { p_id: r.id, p_host: PC, p_timeout: 15 });
    same(again.again, true, "the same host asking again is answered again");
    await as("admin");
    same(await consoleRepo.cancel(r.id), { ok: false, status: "taken" }, "taken: too late to cancel");
    await pcCall("agents_console_done", { p_id: r.id, p_result: { v: 1, ok: true, data: { cards: { sent: 3 } }, ms: 40, host: PC }, p_host: PC });
    await as("admin");
    const done = await consoleRepo.get(r.id);
    same([done.status, done.result, done.host], ["done", { cards: { sent: 3 } }, PC], "the envelope's data");
    // expired: new for more than 15 minutes; a read never writes; the purge stores it
    const x = await consoleRepo.request("agents.list", {});
    await sql("reset role");
    await sql("update public.agents_console set at = now() - interval '16 minutes' where id = $1", [x.id]);
    await as("admin");
    const ex = await consoleRepo.get(x.id);
    same([ex.status, ex.error && ex.error.code], ["expired", "expired"], "expired on read");
    same((await one("select status from public.agents_console where id = $1", [x.id])).status, "new", "a read writes nothing");
    // lost: taken past its timeout + 2 minutes
    const y = await consoleRepo.request("agents.list", {});
    await pcCall("agents_console_take", { p_id: y.id, p_host: PC, p_timeout: 15 });
    await sql("reset role");
    await sql("update public.agents_console set taken_at = now() - interval '140 seconds' where id = $1", [y.id]);
    await as("admin");
    const lost = await consoleRepo.get(y.id);
    same([lost.status, lost.error && lost.error.code], ["error", "lost"], "lost on read");
    await pcCall("agents_console_purge", { p_host: PC });
    same((await one("select status from public.agents_console where id = $1", [x.id])).status, "expired", "the purge stores expired");
    await sql("reset role");
    await sql("update public.agents_console set done_at = now() - interval '11 minutes' where id = $1", [x.id]);
    await pcCall("agents_console_purge", { p_host: PC });
    await as("admin");
    await refused(() => consoleRepo.get(x.id), "PT404", "deleted 10 minutes after it finished");
    // nobody but the agents account runs the PC's side
    for (const k of ["admin", "manager", "field"]) {
      await as(k);
      same((await client.rpc("agents_console_take", { p_id: null, p_host: PC, p_timeout: 15 })).error.code, "42501", k + " takes nothing");
    }
    await sql("reset role");
    await sql("delete from public.agents_console");
  });

  await check("the console's limits through the bridge's words: 20 open (too_many), 60 a minute (rate, the wait in details), 20,000 characters (too_big), a method's shape", async () => {
    await as("admin");
    for (let i = 0; i < 20; i++) await consoleRepo.request("agents.list", { i });
    const many = await refused(() => consoleRepo.request("agents.list", {}), "PT429", "21st open");
    same([cmap.httpError(many).status, cmap.httpError(many).data.code], [429, "too_many"], "the shell's too_many");
    await sql("reset role");
    await sql("delete from public.agents_console");
    await sql("delete from app.console_rates");
    await sql("insert into app.console_rates (admin_id, at) select $1, now() from generate_series(1, 60)", [PEOPLE.admin.id]);
    await as("admin");
    const rate = await refused(() => consoleRepo.request("agents.list", {}), "PT429", "61st this minute");
    const he = cmap.httpError(rate);
    same([he.status, he.data.code], [429, "rate"], "the shell's rate");
    ok(he.data.retryAfter > 0 && he.data.retryAfter <= 60, "how long to wait: " + he.data.retryAfter);
    await sql("reset role");
    await sql("delete from app.console_rates");
    await as("admin");
    same(cmap.httpError(await refused(() => consoleRepo.request("agents.list", { blob: "x".repeat(20001) }), "PT413", "too big")).data.code, "too_big", "too_big");
    same(cmap.httpError(await refused(() => consoleRepo.request("Not A Method", {}), "22023", "a bad name")).status, 400, "400");
    await sql("reset role");
    await sql("delete from public.agents_console");
    await sql("delete from app.console_rates");
  });

  await check("Realtime: an admin joins the change channel on their own requests; the agents account joins ONLY agents2-console and agents2-assistant", async () => {
    const join = (topic) => new Promise((res) => client.channel(topic, { config: { private: true } }).subscribe((s) => res(s)));
    await as("admin");
    same(await new Promise((res) => {
      let stop = null;
      const t = setTimeout(() => { if (stop) stop(); res("timeout"); }, 3000);
      consoleRepo.watchMine(PEOPLE.admin.id, (evt) => { if (evt.type === "SUBSCRIBED") { clearTimeout(t); if (stop) stop(); res("SUBSCRIBED"); } }).then((s) => { stop = s; });
    }), "SUBSCRIBED", "the admin's own rows");
    await as("field");
    same(await new Promise((res) => {
      let stop = null;
      const t = setTimeout(() => { if (stop) stop(); res("timeout"); }, 3000);
      asstRepo.watchMine(PEOPLE.field.id, (evt) => { if (evt.type === "SUBSCRIBED") { clearTimeout(t); if (stop) stop(); res("SUBSCRIBED"); } }).then((s) => { stop = s; });
    }), "SUBSCRIBED", "a person's own assistant rows");
    client.as(PEOPLE.agents.id);
    same(await join("agents2-console"), "SUBSCRIBED", "agents2-console");
    same(await join("agents2-assistant"), "SUBSCRIBED", "agents2-assistant");
    for (const topic of ["agents2-other", "presence:dcr", "dcr-agents_console-9", "dcr-assistant_messages-9"]) same(await join(topic), "CHANNEL_ERROR", topic);
    await as("field");
    same(await join("agents2-console"), "CHANNEL_ERROR", "a person never joins the PC's channel");
    for (const ch of client.channels) ch.unsubscribe();
  });

  await check("My Assistant: 'ask the office' until it is on; the old GET (the state, the agenda scrubbed of amounts, 'unchanged' at the same revision, the badge's counts); the old POST ops as the page sends them", async () => {
    await beat();
    await as("field");
    const off = await asstRepo.page({ agenda: true });
    same([off.enabled, off.message], [false, "Your assistant isn’t turned on yet — ask the office."], "off");
    const none = await asstRepo.page({ summary: true });
    same([none.enabled, none.unread, none.dueToday, asmap.assistantBadge(none)], [false, 0, 0, null], "the badge: nothing");
    await refused(() => asstRepo.say("Hello", "c-1"), "42501", "not on: nothing is said");
    await as("admin");
    same((await asstRepo.officeSet(PEOPLE.field.id, true, true)).created, true, "the office turns it on");
    // a task of the field person's with an amount in its words: the agenda carries it scrubbed
    await sql("reset role");
    await sql(`insert into public.tasks (title, assigned_to, status, created_by) values ('Order hold-downs $1,240 at the yard', $1, 'open', $2)`,
      [PEOPLE.field.id, PEOPLE.admin.id]);
    await as("field");
    const d = await asstRepo.page({ agenda: true });
    same([d.enabled, d.firstName, d.officeReads, d.tz], [true, "Flo", true, "America/Los_Angeles"], "on");
    for (const k of ["rev", "waiting", "chat", "items", "memory", "prefs", "unread", "dueToday", "pc", "today", "now", "generatedAt", "agenda"]) ok(k in d, k);
    same(Object.keys(d.agenda).sort(), ["hours", "projects", "sites", "tasks", "timesheets"], "the agenda");
    const task = d.agenda.tasks.find((t) => /hold-downs/.test(t.name));
    ok(task && !/\$\s?\d|1,240/.test(task.name), "the task's words without the amount: " + (task && task.name));
    same(Object.keys(d.pc).sort(), ["chatAt", "lastSeen", "minutesAgo", "paused"], "the PC, nothing else");
    same((await asstRepo.page({ rev: d.rev })).unchanged, true, "unchanged at the same revision");
    // the old POST, exactly as my-assistant.js sends each op
    const s1 = await asstRepo.say("What do I have tomorrow?", "c-1");
    same([s1.ok, s1.message.status, /^m_/.test(s1.message.id)], [true, "waiting", true], "say");
    same((await asstRepo.say("What do I have tomorrow?", "c-1")).already, true, "the same client id: once");
    await refused(() => asstRepo.say("x".repeat(1501), "c-2"), "22023", "1,500 characters");
    for (let i = 0; i < 4; i++) await asstRepo.say("q" + i, "w" + i);
    const five = await refused(() => asstRepo.say("one more", "w9"), "PT409", "five waiting");
    same(five.message, "Wait for your assistant to answer first.", "the old words");
    const todo = await asstRepo.op("item.add", { item: { kind: "todo", text: "Sign the safety sheet", due: "", notes: "" } });
    same([todo.ok, todo.item.kind, todo.item.by, /^i_/.test(todo.item.id)], [true, "todo", "employee", true], "item.add (a to-do)");
    const rem = await asstRepo.op("item.add", { item: { kind: "reminder", text: "Call the yard", at: d.today + "T15:00" } });
    same(rem.item.at, d.today + "T15:00", "a reminder keeps the wall clock");
    const ev = await asstRepo.op("item.add", { item: { kind: "event", text: "Inspection", at: d.today + "T09:00", end: "", location: "", remind: 30, notes: "" } });
    same([ev.item.kind, ev.item.remind], ["event", 30], "an event");
    const up = await asstRepo.op("item.update", { id: rem.item.id, patch: { text: "Call the lumber yard", at: d.today + "T15:30" } });
    same([up.item.text, up.item.at], ["Call the lumber yard", d.today + "T15:30"], "item.update");
    same((await asstRepo.op("item.complete", { id: todo.item.id, done: true })).item.done, true, "item.complete");
    same((await asstRepo.op("item.delete", { id: ev.item.id })).ok, true, "item.delete");
    await refused(() => asstRepo.op("prefs.set", { prefs: { eveningAt: "21:30" } }), "22023", "a briefing after 20:45");
    same((await asstRepo.op("prefs.set", { prefs: { eveningAt: "19:00", language: "es" } })).prefs.language, "es", "prefs.set");
    const mem = await asstRepo.op("memory.add", { text: "I start at 7" });
    ok(mem.memory.some((n) => n.text === "I start at 7" && n.by === "employee"), "memory.add");
    same((await asstRepo.op("memory.delete", { id: mem.memory[0].id })).ok, true, "memory.delete");
    same((await asstRepo.op("read")).ok, true, "read");
    const sum = await asstRepo.page({ summary: true });
    same([sum.enabled, sum.unread, sum.dueToday >= 1], [true, 0, true], "the badge's counts: read, and today's reminder");
    same(asmap.assistantBadge(sum), { text: sum.dueToday + " today", cls: "dim" }, "the home page's badge");
  });

  await check("the office: the list (never the agents account), the view with the chat ONLY while office_reads is on (chatHidden otherwise), the office's own items read-only for the person; only an admin", async () => {
    await as("admin");
    const list = await asstRepo.officeList();
    ok(list.length > 0 && list.every((p) => p.profile_id !== PEOPLE.agents.id), "everyone but the agents account");
    const flo = list.find((p) => p.profile_id === PEOPLE.field.id);
    same([flo.on, flo.officeReads, flo.role], [true, true, "Field"], "Flo's row");
    ok((await asstRepo.officeView(PEOPLE.field.id)).chat.length > 0, "office reads on: the chat");
    await asstRepo.officeSet(PEOPLE.field.id, true, false);
    const hid = await asstRepo.officeView(PEOPLE.field.id);
    same([hid.chatHidden, hid.chat, hid.memory], [true, [], []], "office reads off: none of it");
    ok(hid.items.length > 0, "the items: always");
    same(((await client.from("assistant_messages").select("id").eq("profile_id", PEOPLE.field.id)).data || []).length, 0, "RLS agrees: no message through the table");
    await asstRepo.officeSet(PEOPLE.field.id, true, true);
    // on again: only what is written from now on (M6 office_reads_since - review fix), starting with the note that tells Flo
    const again = (await client.from("assistant_messages").select("role, text").eq("profile_id", PEOPLE.field.id)).data || [];
    same(again.map((m) => m.role), ["office"], "on again: only from now on - nothing written while it was off");
    ok(/from this message on|desde este mensaje/.test(again[0].text), "the note that tells Flo: " + again[0].text);
    const view = await asstRepo.officeView(PEOPLE.field.id);
    same([view.chat.map((m) => m.role), !!view.officeReadsSince], [["office"], true], "the office view says the same, and from when");
    const add = await asstRepo.officeItem(PEOPLE.field.id, "add", null, asmap.itemFields("todo", { text: "Bring the hours by Friday", due: "" }));
    ok(add.ok && add.ids && add.ids.length === 1, "the office's item: " + JSON.stringify(add));
    const id = add.ids[0];
    await asstRepo.officeItem(PEOPLE.field.id, "update", id, asmap.itemFields("todo", { text: "Bring the hours by Friday noon", due: "" }, true));
    await as("field");
    const mine = await asstRepo.page({});
    const it = mine.items.find((i) => i.id === id);
    same([it.by, it.text], ["office", "Bring the hours by Friday noon"], "the person sees it");
    const ro = await refused(() => asstRepo.op("item.update", { id, patch: { text: "mine now" } }), "42501", "the person may not change it");
    same(ro.message, "The office added this one.", "the old words");
    await refused(() => asstRepo.op("item.delete", { id }), "42501", "nor delete it");
    same((await asstRepo.op("item.complete", { id, done: true })).item.done, true, "only tick it done");
    same(((await client.from("assistant_messages").select("profile_id")).data || []).every((m) => m.profile_id === PEOPLE.field.id), true, "a person reads only their own messages");
    const ins = await client.from("assistant_messages").insert({ id: "m_zzzzzzzz", profile_id: PEOPLE.field.id, role: "user", text: "x", status: "waiting" });
    ok(ins.error && ins.error.code === "42501", "nobody writes a row directly");
    for (const k of ["manager", "manager2", "accountant", "lead", "viewer"]) {
      await as(k);
      await refused(() => asstRepo.officeList(), "42501", k + " list");
      await refused(() => asstRepo.officeView(PEOPLE.field.id), "42501", k + " view");
      await refused(() => asstRepo.officeSet(PEOPLE.field.id, false), "42501", k + " set");
      await refused(() => asstRepo.officeItem(PEOPLE.field.id, "add", null, { kind: "todo", text: "x" }), "42501", k + " item");
      same(((await client.from("assistant_messages").select("id").eq("profile_id", PEOPLE.field.id)).data || []).length, 0, k + ": nobody else's chat");
    }
    await as("admin");
    await refused(() => asstRepo.officeSet(PEOPLE.agents.id, true), "PT404", "never the agents account");
    client.as(PEOPLE.agents.id);
    same(((await client.from("assistant_profiles").select("profile_id")).data || []).length, 0, "the agents account reads no profile row");
    same(((await client.from("assistant_messages").select("id")).data || []).length, 0, "it reads NO row of the chat (review fix: no words, no amounts)");
    const waiting = (await client.from("assistant_waiting").select("*")).data || [];
    ok(waiting.length > 0 && waiting.every((w) => !("text" in w) && w.id && w.profile_id), "the questions waiting reach it as ids (assistant_waiting, its Realtime)");
    same((await client.rpc("my_assistant", { p_agenda: false, p_rev: null, p_summary: false })).error.code, "42501", "and has no assistant");
    await as("admin");
    await asstRepo.officeSet(PEOPLE.field.id, false);
    await as("field");
    same((await asstRepo.page({})).enabled, false, "turned off: 'ask the office' again");
  });
}

/* ── summary ──────────────────────────────────────────────────────────── */
const failed = results.filter((r) => !r.ok);
let last = "";
for (const r of results) {
  if (r.section !== last) { console.log("\n" + r.section); last = r.section; }
  console.log((r.ok ? "  ok   " : "  FAIL ") + r.name + (r.ok ? "" : "\n         " + r.error));
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed (${steps.length} SQL files from ${D2}, ${Date.now() - t0} ms)`);
process.exit(failed.length ? 1 : 0);
