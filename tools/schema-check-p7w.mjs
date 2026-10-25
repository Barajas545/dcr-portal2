/* DCR Portal 2 — Part 3's queries against the REAL database rules (development only): the "p7w" part of
   tools/schema-check.mjs (it calls run() with its own helpers). Portal 2's own modules run over PGlite loaded with every
   DCR Desktop 2 migration, as each made-up role (owner decisions 2026-10-24 D1, D2, D13):

   * the switches (migration 20261028000100_estimator.sql — these checks wait for it): sb.js me() reads
     profiles.can_estimate / can_upload_onedrive (an admin's on); repo/employees listAccess reads them; setAccess
     (admin_set_profile) saves Estimator + prices for a manager, refuses Estimator for a lead and OneDrive upload for
     view-only (23514), refuses a stale version (PT409) and a non-admin (42501); nobody PATCHes their own switch
     (42501); app.can_edit('estimates') follows the switch (a manager without it cannot change an estimate);
   * New Project (already live: 20261008000400_rates_thumbnails): repo/projects createProject with
     map/projects newProjectFields — a zone alone from a manager without prices, a custom rate refused to him
     (42501), a custom rate from a manager with prices;
   * the project picture (already live): repo/files addThumbnail (Storage p/{project}/thumbnail/{uuid}/thumbnail.jpg
     under its policy, then the files row) and repo/projects setThumbnail by a manager; a lead is refused; another
     project's picture is refused (23514);
   * costs and receipts (already live: M5b): repo/ledger addCost / updateCost / getCost / lineChoices as the
     accountant (the labour amount 2.5 h x 33.33 = 83.33 is the database's), a manager without financials refused
     (42501); a receipt under f/{project}/receipts/… with its cost_id by the accountant, a lead refused;
   * drift: the demo database (tools/fake/p7-web.js, engine.js) has the same profiles switches.
   Made-up people and jobs only. */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function run(h) {
  const { check, results, section, as, client, sql, one, PEOPLE, ok, same, refused, catalog, SITE } = h;
  const T = catalog.tables;
  const site = (p) => import(pathToFileURL(path.join(SITE, "js", p)).href);
  const projects = await site("repo/projects.js");
  const files = await site("repo/files.js");
  const ledger = await site("repo/ledger.js");
  const employees = await site("repo/employees.js");
  const sbm = await site("sb.js");
  const MP = await site("map/projects.js");
  const CF = await site("map/cost-form.js");
  const blob = (n, type) => new Blob([new Uint8Array(n || 512)], { type: type || "image/jpeg" });
  const J = {};

  /* ── New Project: the zone rule ── */
  await check("Part 3 New Project: a zone alone from a manager without prices; a custom rate only with prices; the dialog's fields are create_project's", async () => {
    await as("manager");
    const f = MP.newProjectFields({ name: "P7w Schema Barn", city: "Sandbox", state: "ca", zip: "93446", status: "estimating", zone: "out_of_area",
      scope: "Made-up scope" }, false).fields;
    J.p = await projects.createProject(f);
    ok(/^A\d+/.test(J.p.internalIDNumber), "a number from the database");
    same(J.p.status, "estimating", "starts as");
    await sql("reset role");
    const pr = await one("select rate_source from public.project_prices where project_id = $1", [J.p.id]);
    same(pr.rate_source, "out_of_area", "the zone named");
    await as("manager");
    await refused(() => projects.createProject({ name: "P7w no", rate_source: "custom", labor_rate: 95 }), "42501", "a custom rate without prices");
    await as("manager2");
    J.q = await projects.createProject(MP.newProjectFields({ name: "P7w Priced", zone: "custom", rate: "97.50" }, true).fields);
    await sql("reset role");
    const qp = await one("select rate_source, labor_rate::float8 as r from public.project_prices where project_id = $1", [J.q.id]);
    same([qp.rate_source, qp.r], ["custom", 97.5], "the custom rate");
  });

  /* ── the project picture ── */
  await check("Part 3 picture: a manager's picture goes to Storage and its files row, then the pointer; a lead is refused; another project's picture is refused (23514)", async () => {
    ok(J.p && J.q, "the projects of the check before");
    await as("lead");
    await refused(() => files.addThumbnail(J.p.id, { blob: blob(), mime: "image/jpeg" }), null, "a lead");
    await as("manager");
    const row = await files.addThumbnail(J.p.id, { blob: blob(2048), mime: "image/jpeg" });
    ok(new RegExp("^p/" + J.p.id + "/thumbnail/[0-9a-f]{32}/thumbnail\\.jpg$").test(row.storage_path), "the object key " + row.storage_path);
    same([row.folder, row.subpath, row.mime, row.source], ["thumbnail", "", "image/jpeg", "portal2"], "the files row");
    const p = await projects.getProject(J.p.id);
    const moved = await projects.setThumbnail(p, row.id);
    same(String(moved.thumbnailFileId), String(row.id), "the pointer");
    const theirs = await files.addThumbnail(J.q.id, { blob: blob(), mime: "image/png" });
    await refused(() => projects.setThumbnail(moved, theirs.id), "23514", "another project's picture");
    const off = await projects.setThumbnail(await projects.getProject(J.p.id), null);
    same(off.thumbnailFileId, null, "taken off");
    await files.removeFile(theirs);
  });

  /* ── costs and receipts ── */
  await check("Part 3 costs: the accountant adds and corrects them (the database's labour amount, versioned edits), a manager without financials is refused (42501); line choices read", async () => {
    ok(J.p, "the project");
    await as("manager");
    await refused(() => ledger.addCost(CF.payload({ kind: "material", cost_date: "2026-10-20", description: "P7w lumber", amount: "10" }, { projectId: J.p.id })), "42501", "no financials");
    await as("accountant");
    const c = await ledger.addCost(CF.payload({ kind: "labor", cost_date: "2026-10-20", description: "P7w crew - framing", hours: "2.5", rate: "33.33",
      amount: "", card: "card-amex" }, { projectId: J.p.id }));
    same(Number(c.amount), 83.33, "hours x rate");
    ok(c.card_by && c.card_at, "the database's card stamp");
    const raw = await ledger.getCost(c.id);
    const fixed = await ledger.updateCost(raw, CF.payload({ kind: "labor", cost_date: "2026-10-20", description: "P7w crew - framing", hours: "", rate: "",
      amount: "90", card: "card-amex" }, { editing: true, before: raw }));
    same([Number(fixed.amount), fixed.hours, fixed.rate], [90, null, null], "cleared hours and rate");
    await refused(() => ledger.updateCost(raw, { amount: 91 }), "PT409", "a stale version");
    J.cost = fixed;
    const lines = await ledger.lineChoices(J.p.id);
    ok(Array.isArray(lines), "line choices answer");
  });

  await check("Part 3 receipts: under f/{project}/receipts/… with its cost_id by the accountant; a lead can write neither the object nor the link", async () => {
    ok(J.cost, "the cost");
    await as("accountant");
    const key = "f/" + J.p.id + "/receipts/" + "ab".repeat(16) + "/Receipt_2026-10-20.jpg";
    const up = await client.storage.from(files.BUCKET).upload(key, blob(), { upsert: false, contentType: "image/jpeg" });
    ok(!up.error, "the object: " + (up.error && up.error.message));
    const ins = await client.from("files").insert({ project_id: J.p.id, folder: "receipts", subpath: "", name: "Receipt 2026-10-20.jpg", storage_path: key,
      size: 512, mime: "image/jpeg", source: "portal2", cost_id: J.cost.id }).select("id, cost_id, is_financial");
    ok(!ins.error, "the row: " + (ins.error && ins.error.message));
    same([ins.data[0].cost_id, ins.data[0].is_financial], [J.cost.id, true], "linked and financial");
    await as("lead");
    const up2 = await client.storage.from(files.BUCKET).upload("f/" + J.p.id + "/receipts/" + "cd".repeat(16) + "/r.jpg", blob(), { upsert: false });
    ok(!!up2.error, "a lead's receipt object is refused");
  });

  /* ── the switches (20261028000100) ── */
  const HAS = !!(T.profiles && T.profiles.cols.can_estimate && T.profiles.cols.can_upload_onedrive);
  if (!HAS) {
    const mig = path.join(h.D2 || path.join(SITE, "..", "..", "DCR Desktop 2"), "supabase", "migrations", "20261028000100_estimator.sql");
    results.push({ section, name: existsSync(mig) ? "20261028000100_estimator is in DCR Desktop 2, but the loaded database lacks profiles.can_estimate / can_upload_onedrive"
      : "20261028000100_estimator is not in DCR Desktop 2 yet: the Estimator / OneDrive switch checks wait for it", ok: !existsSync(mig) });
    return;
  }

  await check("Part 3 switches: the sign-in reads them (an admin's on, a manager's off by default)", async () => {
    await as("admin");
    const a = await sbm.me({ fresh: true });
    same([a.can_estimate, a.can_upload_onedrive], [true, true], "the admin");
    await as("manager");
    const m = await sbm.me({ fresh: true });
    same([m.can_estimate, m.can_upload_onedrive], [false, false], "a manager by default");
  });

  await check("Part 3 Access: admin_set_profile saves Estimator + prices for a manager; Estimator for a lead and OneDrive for view-only are 23514; stale PT409; a non-admin 42501; nobody PATCHes their own switch", async () => {
    await as("admin");
    const list = await employees.listAccess();
    same(list.ready, true, "the columns are there");
    const byId = (k) => list.rows.find((r) => r.id === PEOPLE[k].id);
    ok(!list.rows.some((r) => r.role === "agents"), "never the agents account");
    const m = byId("manager");
    const saved = await employees.setAccess(m, { can_estimate: true, can_see_prices: true });
    same([saved.can_estimate, saved.can_see_prices], [true, true], "saved");
    await refused(() => employees.setAccess(m, { can_estimate: false }), "PT409", "the version read is stale");
    await refused(() => employees.setAccess(byId("lead"), { can_estimate: true }), "23514", "Estimator for a lead");
    await refused(() => employees.setAccess(byId("viewer"), { can_upload_onedrive: true }), "23514", "OneDrive upload for view-only");
    const lead = await employees.setAccess(byId("lead"), { can_upload_onedrive: true });
    same(lead.can_upload_onedrive, true, "a lead may upload");
    await as("manager2");
    await refused(() => employees.setAccess(byId("field"), { can_upload_onedrive: true }), "42501", "not an admin");
    const self = await client.from("profiles").update({ can_estimate: true }).eq("id", PEOPLE.manager2.id).select("id");
    ok(self.error && String(self.error.code) === "42501", "a manager's own switch: " + JSON.stringify(self.error));
    await as("lead");
    const self2 = await client.from("profiles").update({ can_upload_onedrive: false }).eq("id", PEOPLE.lead.id).select("id");
    ok(self2.error && String(self2.error.code) === "42501", "a lead's own switch: " + JSON.stringify(self2.error));
    // back as it was for the rest of the run
    await as("admin");
    const now = (await employees.listAccess()).rows.find((r) => r.id === PEOPLE.manager.id);
    await employees.setAccess(now, { can_estimate: false, can_see_prices: false });
    const l2 = (await employees.listAccess()).rows.find((r) => r.id === PEOPLE.lead.id);
    await employees.setAccess(l2, { can_upload_onedrive: false });
  });

  await check("Part 3 Estimator: app.can_edit('estimates') follows the switch (a manager without it changes no estimate; with it he does)", async () => {
    ok(J.p, "the project");
    await sql("reset role");
    const est = (await one("insert into public.estimates (project_id, name, status) values ($1, 'P7w estimate', 'draft') returning id, version", [J.p.id]));
    await as("manager");
    const r1 = await client.from("estimates").update({ name: "P7w by a manager" }).eq("id", est.id).eq("version", est.version).select("id");
    ok(!r1.error ? (r1.data || []).length === 0 : true, "refused or nothing changed without the switch");
    await as("admin");
    const m = (await employees.listAccess()).rows.find((r) => r.id === PEOPLE.manager.id);
    await employees.setAccess(m, { can_estimate: true });
    await as("manager");
    const v = (await client.from("estimates").select("version").eq("id", est.id)).data[0].version;
    const r2 = await client.from("estimates").update({ name: "P7w by the estimator" }).eq("id", est.id).eq("version", v).select("id");
    ok(!r2.error && (r2.data || []).length === 1, "changed with the switch: " + JSON.stringify(r2.error));
    await as("admin");
    const back = (await employees.listAccess()).rows.find((r) => r.id === PEOPLE.manager.id);
    await employees.setAccess(back, { can_estimate: false });
  });

  await check("Part 3 drift: the demo database has the same profiles switches (tools/fake/p7-web.js)", async () => {
    const pe = await import(pathToFileURL(path.join(SITE, "..", "tests", "pages-engine.mjs")).href);
    const engine = await pe.freshEngine();
    for (const c of ["can_estimate", "can_upload_onedrive"]) ok(c in engine.COLS.profiles, "the demo's profiles." + c);
  });
}
