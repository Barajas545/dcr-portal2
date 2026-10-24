/* DCR Portal 2 — sales estimating's queries against the REAL database rules (development only): P5c's sales part of
   tools/schema-check.mjs (it calls run() with its own helpers). Portal 2's own site/js/repo/sales.js and map/sales.js
   run over PGlite loaded with every DCR Desktop 2 migration, M5c 20261027000100_office_lists.sql included, as each role:

   * the names the pages read exist and answer: every column of map/sales.js COLS on sales_reference_projects,
     sales_reference_prices, sales_estimates, sales_estimate_prices and sales_materials, the price embeds
     ("prices:sales_reference_prices(…)", "prices:sales_estimate_prices(…)"), profiles.can_sales_estimates;
   * who (Q10): the switch reads (an admin always — M5c's profiles trigger); without it (a lead, field, view-only, the
     agents account, a manager it was not given to) every sales answer is empty; the amounts come back only with the
     prices switch too — no answer a person without prices receives carries a price, a benchmark, a range, the
     output or the pricing lines (P5 acceptance check 1 for the sales tables);
   * writing is app.can_edit('sales') — an admin, or a manager with the switch: an accountant with the switch is
     refused every write (42501); a sales manager without prices saves comps and estimates, and his saves never
     touch a price row (the price write itself is refused); the price rows exist with every comp and estimate (t20)
     and are written with a versioned PATCH (409 on a stale version), as saveRef / saveEstimate do;
   * versioned writes: a stale version is 409 (PT409), a delete takes the price row with it;
   * the gallery rule: a person never writes a NEW "cad" value (23514); an old one is kept as it is;
   * sales-media: repo/sales.js object names pass app.sales_media_path_ok; a sales editor adds, a reader with the
     switch opens (signed URL), anybody else is refused; a drawing's own name (…/cme/cme-<id>.png) is replaced in
     place, any other existing name is not (the repo then makes a fresh object);
   * P5 check 5: nothing here writes an activity row or an outbox row;
   * drift: the demo database (tools/fake/p5c-sales.js) has the same sales columns as the real one.
   Made-up people, comps and clients only. */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function run(h) {
  const { check, results, section, as, client, sql, one, PEOPLE, ok, same, refused, catalog, SITE } = h;
  const T = catalog.tables;
  const HAS = !!(T.sales_reference_projects && T.sales_estimates && T.sales_materials && T.profiles && T.profiles.cols.can_sales_estimates);
  if (!HAS) {
    // only while M5c is not written yet: once its file is in DCR Desktop 2, a missing table or column is drift, never a pass
    const m5c = path.join(h.D2 || path.join(SITE, "..", "..", "DCR Desktop 2"), "supabase", "migrations", "20261027000100_office_lists.sql");
    results.push({ section, name: existsSync(m5c) ? "M5c (20261027000100_office_lists) is in DCR Desktop 2, but the loaded database lacks its sales tables or the switch"
      : "M5c (20261027000100_office_lists) is not in DCR Desktop 2 yet: the P5c sales checks wait for it", ok: !existsSync(m5c) });
    return;
  }
  const site = (p) => import(pathToFileURL(path.join(SITE, "js", p)).href);
  const repo = await site("repo/sales.js");
  const M = await site("map/sales.js");
  const E = await site("sales/deck-engine.js");

  /* every answer the module received: [{table, data}] */
  const rec = [];
  const origFrom = client.from.bind(client);
  client.from = function (t) {
    const b = origFrom(t);
    const then0 = b.then.bind(b);
    b.then = function (res, rej) {
      return then0(function (r) { rec.push({ table: t, data: r && r.data }); return res ? res(r) : r; }, rej);
    };
    return b;
  };
  const MONEY_KEYS = ["reference_price", "cost_per_primary_unit", "benchmark_total", "range_low_total", "range_high_total", "output", "pricing"];
  const moneyIn = (v) => {
    const found = [];
    const walk = (x) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") Object.keys(x).forEach((k) => { if (MONEY_KEYS.includes(k) && x[k] !== null) found.push(k); walk(x[k]); });
    };
    walk(v);
    return found;
  };

  /* the switch: the manager without prices (a sales manager), the manager with prices and the accountant get it */
  await sql("reset role");
  for (const k of ["manager", "manager2", "accountant"]) await sql("update public.profiles set can_sales_estimates = true where id = $1", [PEOPLE[k].id]);
  const acts0 = Number((await one("select count(*) as n from public.activity")).n);
  const out0 = Number((await one("select count(*) as n from public.notifications_outbox")).n);
  const S = {};

  await check("P5c sales: every column the pages read is the database's; the switch's role defaults (an admin always, the agents account never)", async () => {
    for (const [key, table] of Object.entries({ refs: "sales_reference_projects", refPrices: "sales_reference_prices", estimates: "sales_estimates",
      estimatesLite: "sales_estimates", estPrices: "sales_estimate_prices", estPricesLite: "sales_estimate_prices", materials: "sales_materials" })) {
      for (const c of M.COLS[key].split(",").map((s) => s.trim())) ok(c in T[table].cols, table + "." + c + " (map/sales.js COLS." + key + ")");
    }
    same(M.TABLES, { refs: "sales_reference_projects", refPrices: "sales_reference_prices", estimates: "sales_estimates", estPrices: "sales_estimate_prices",
      materials: "sales_materials" }, "the table names");
    const sw = await sql("select role, can_sales_estimates from public.profiles where id = any($1::uuid[]) order by role",
      [[PEOPLE.admin.id, PEOPLE.lead.id, PEOPLE.field.id, PEOPLE.viewer.id, PEOPLE.agents.id]]);
    ok(sw.every((r) => r.can_sales_estimates === (r.role === "admin")), "an admin has it; the lead, field, view-only and the agents account do not");
    await as("admin");
    same(await repo.salesAccess({ id: PEOPLE.admin.id, role: "admin" }), { sales: true, missing: false }, "the admin");
    await as("lead");
    same(await repo.salesAccess({ id: PEOPLE.lead.id, role: "lead" }), { sales: false, missing: false }, "the lead");
  });

  await check("P5c sales: a sales manager without prices saves a comp; its price row (made with it) stays empty and his price write is refused", async () => {
    await as("manager");
    ok((await repo.salesAccess({ id: PEOPLE.manager.id, role: "manager" })).sales, "the switch reads");
    const f = M.refFields({ projectRef: "SCHEMA-DECK-1", projectName: "Schema Ridge Deck", city: "Sandbox", projectType: "new-deck", complexity: "moderate",
      primaryAreaSF: 400, secondaryAreaSF: 400, railingLF: 50, stairs: 1, totalManHours: 150, activeAsReference: true, pictures: [], notes: "Made up." });
    same(moneyIn(f), [], "the comp's row carries no money");
    const r = await repo.saveRef(null, null, f, null, null);
    S.ref = r.id;
    const p = await one("select reference_price, cost_per_primary_unit, version from public.sales_reference_prices where reference_id = $1", [r.id]);
    same([p.reference_price, p.cost_per_primary_unit, p.version], [null, null, 1], "the price row exists, empty");
    await refused(() => repo.saveRef(r.id, r.version, f, M.refPriceFields({ referencePrice: 47000, primaryAreaSF: 400 }), 1), "42501", "his price write");
    same((await one("select reference_price from public.sales_reference_prices where reference_id = $1", [r.id])).reference_price, null, "still empty");
  });

  await check("P5c sales: an editor with prices — the comp's price as a versioned PATCH (cost per SF with it); a stale version is 409", async () => {
    await as("manager2");
    const cur = (await repo.listRefs({ all: true })).find((x) => x.id === S.ref);
    same([cur.referencePrice, cur.pricesVersion], [null, 1], "read with its (empty) price row");
    const saved = await repo.saveRef(cur.id, cur.version, M.refFields({ projectRef: "SCHEMA-DECK-1", projectName: "Schema Ridge Deck", primaryAreaSF: 400,
      activeAsReference: true, pictures: [] }, cur), M.refPriceFields({ referencePrice: 47000, primaryAreaSF: 400 }), cur.pricesVersion);
    const p = await one("select reference_price::float as price, cost_per_primary_unit::float as cps, version from public.sales_reference_prices where reference_id = $1", [S.ref]);
    same([p.price, p.cps, p.version, saved.pricesVersion], [47000, 117.5, 2, 2], "the price, its cost per SF, the next version");
    await refused(() => repo.saveRef(cur.id, cur.version, { notes: "stale" }, null, null), "PT409", "the comp at a stale version");
    await refused(() => repo.saveRef(cur.id, saved.version, { notes: "x" }, M.refPriceFields({ referencePrice: 1, primaryAreaSF: 400 }), 1), "PT409", "the price at a stale version");
  });

  await check("P5c sales: who reads (Q10) — every sales answer empty without the switch; no amount in any answer without prices", async () => {
    // an estimate with its money, written by the admin
    await as("admin");
    const refs = await repo.listRefs({ all: true });
    const ref = refs.find((r) => r.id === S.ref);
    const st = { estimateRef: M.newEstimateRef(Date.UTC(2026, 9, 21), 7), estStatus: "preliminary", estVersion: 1, referenceId: ref.projectRef,
      project: { clientName: "Pell Mockridge", clientPhone: "805 555 0190", clientEmail: "Pell@Example.com", address: "1 Made-up Way", city: "Sandbox",
        projectType: "new-deck", deckingArea: 400, framingArea: 400, railing: 50, stairs: 1, complexity: "moderate", notes: "Made up." },
      sel: { primary: null, alternative: null, options: [] }, showRefs: [], media: { photos: [], audioNotes: [] }, output: null };
    const ranked = E.rankRefs(st.project, refs);
    st.output = E.buildOutput({ project: st.project, ranked, referenceId: ref.projectRef, sel: st.sel, catalog: { products: [] },
      pricing: { rates: { framingSF: "18" }, items: [] } });
    const fields = M.estimateFields(st, { refs, withSelection: true, isNew: true });
    same(moneyIn(fields), [], "the estimate's row carries no money");
    const saved = await repo.saveEstimate(null, null, fields, M.estimatePriceFields(st.output, { rates: { framingSF: "18" }, items: [] }), null);
    S.est = saved.id;
    const row = await one("select client_phone, client_email, reference_project_id, revision, status from public.sales_estimates where id = $1", [S.est]);
    same([row.client_phone, row.client_email, Number(row.reference_project_id), row.revision, row.status],
      ["(805) 555-0190", "pell@example.com", Number(S.ref), 1, "preliminary"], "the database tidied the phone and e-mail; the reference by id");
    const p = await one("select benchmark_total::float as b, output, pricing from public.sales_estimate_prices where estimate_id = $1", [S.est]);
    same([p.b, p.output.benchmark.present, p.pricing.rates.framingSF, saved.pricesVersion], [47000, true, "18", 2], "the money only in sales_estimate_prices");
    const full = await repo.getEstimate(S.est);
    same([full.referenceRef, full.pricing.rates.framingSF, full.benchmarkTotal], ["SCHEMA-DECK-1", "18", 47000], "read back whole");
    for (const k of ["admin", "manager2", "accountant", "manager", "lead", "field", "viewer", "agents"]) {
      await as(k);
      rec.length = 0;
      const refs2 = await repo.listRefs({ all: true }).catch(() => []);
      const ests = await repo.listEstimates().catch(() => []);
      const one2 = await repo.getEstimate(S.est).catch(() => null);
      const mats = await repo.listMaterials().catch(() => []);
      const sales = ["admin", "manager2", "accountant", "manager"].includes(k);
      const prices = ["admin", "manager2", "accountant"].includes(k);
      same([refs2.length > 0, ests.length > 0, !!one2], [sales, sales, sales], k + ": the sales rows " + (sales ? "read" : "not read"));
      if (!sales) {
        for (const x of rec.filter((r) => /^sales_/.test(r.table))) same((x.data || []).length, 0, k + ": " + x.table + " answered nothing");
      }
      const money = rec.filter((r) => /^sales_/.test(r.table)).flatMap((r) => moneyIn(r.data));
      if (prices) ok(money.length > 0 && one2.benchmarkTotal === 47000, k + ": the amounts come with prices");
      else same(money, [], k + ": no amount in any sales answer");
      if (k === "manager") same([one2.pricing, one2.benchmarkTotal, refs2.find((r) => r.id === S.ref).referencePrice], [null, null, null], "the sales manager: hidden");
      void mats;
    }
  });

  await check("P5c sales: writing is app.can_edit('sales') — the accountant with the switch is refused every write; a sales manager's save never touches the prices", async () => {
    await as("accountant");
    const cur = await repo.getEstimate(S.est);
    await refused(() => repo.saveEstimate(S.est, cur.version, { notes: "x" }, null, null), "42501", "the accountant: an estimate");
    await refused(() => repo.saveRef(null, null, M.refFields({ projectName: "Nope", pictures: [] }), null, null), "42501", "the accountant: a comp");
    await refused(() => repo.saveMaterial(null, null, M.materialFields({ itemKind: "product", itemName: "Nope", itemId: "nope", pictures: [] }, null)), "42501", "the accountant: a material");
    await refused(() => repo.deleteEstimate(S.est, cur.version), "42501", "the accountant: a delete");
    await as("manager");
    const before = await one("select benchmark_total::float as b, version from public.sales_estimate_prices where estimate_id = $1", [S.est]);
    const e = await repo.getEstimate(S.est);
    const st = { estimateRef: e.estimateRef, estStatus: "sent", estVersion: 2, referenceId: e.referenceRef, project: e.scope, sel: e.selection.sel,
      showRefs: [], media: e.media, output: null };
    const s2 = await repo.saveEstimate(S.est, e.version, M.estimateFields(st, { refs: await repo.listRefs({ all: true }), withSelection: true }), null, null);
    const after = await one("select benchmark_total::float as b, version from public.sales_estimate_prices where estimate_id = $1", [S.est]);
    same([after.b, after.version], [before.b, before.version], "the prices untouched");
    const es = await one("select status, revision, reference_project_id from public.sales_estimates where id = $1", [S.est]);
    same([es.status, Number(es.revision), Number(es.reference_project_id)], ["sent", 2, Number(S.ref)], "the estimate saved");
    await refused(() => repo.saveEstimate(S.est, e.version, { notes: "stale" }, null, null), "PT409", "a stale version: 409");
    S.estVersion = s2.version;
  });

  await check("P5c sales: the gallery rule — a person never writes a NEW 'cad' value (23514); an old one is kept as it is; 'cme' is the drawing's key", async () => {
    await sql("reset role");
    await sql("update public.sales_estimates set media = $2::jsonb where id = $1",
      [S.est, JSON.stringify({ photos: [{ path: "estimates/OLD/x/old.png", name: "old.png", cad: { v: 1, lines: [] } }], audioNotes: [] })]);
    await as("admin");
    let e = await repo.getEstimate(S.est);
    const keep = Object.assign({}, e.media, { photos: e.media.photos.concat([{ path: "estimates/" + e.estimateRef + "/cme/cme-abcdef12.png", name: "cme-abcdef12.png", cme: { version: 1, project: { id: "abcdef12" } } }]) });
    const s = await repo.saveEstimate(S.est, e.version, { media: keep }, null, null);
    ok(s.version > e.version, "the old drawing kept, a CME drawing added");
    e = await repo.getEstimate(S.est);
    const bad = Object.assign({}, e.media, { photos: e.media.photos.concat([{ path: "estimates/x/y/z.png", name: "z.png", cad: { v: 2 } }]) });
    await refused(() => repo.saveEstimate(S.est, e.version, { media: bad }, null, null), "23514", "a new 'cad' value");
    const changed = Object.assign({}, e.media, { photos: e.media.photos.map((p) => (p.cad ? Object.assign({}, p, { cad: { v: 1, lines: [1] } }) : p)) });
    await refused(() => repo.saveEstimate(S.est, e.version, { media: changed }, null, null), "23514", "an old 'cad' value rewritten");
    const removed = Object.assign({}, e.media, { photos: e.media.photos.filter((p) => !p.cad) });
    ok((await repo.saveEstimate(S.est, e.version, { media: removed }, null, null)).version > e.version, "an old drawing may be removed");
    const rv = (await repo.listRefs({ all: true })).find((r) => r.id === S.ref).version;
    await refused(() => repo.saveRef(S.ref, rv, { pictures: [{ path: "references/a/b/c.png", name: "c.png", cad: {} }] }, null, null), "23514", "a comp's pictures too");
  });

  await check("P5c sales: the Materials Library — a product and its color (item_key set once), a stale version 409, a delete", async () => {
    await as("manager2");
    const p = await repo.saveMaterial(null, null, M.materialFields({ itemKind: "product", itemName: "Schema Composite", brandName: "Made-up", materialId: "schema-composite",
      itemId: "schema-composite", marketTier: "Mid", description: "Made up.", pictures: [] }, null));
    const c = await repo.saveMaterial(null, null, M.materialFields({ itemKind: "color", itemName: "Slate", materialId: "schema-composite", itemId: "schema-composite-slate", pictures: [] }, null));
    const rows = await repo.listMaterials();
    const pr = rows.find((r) => r.id === p.id), co = rows.find((r) => r.id === c.id);
    same([pr.itemId, pr.itemKind, pr.materialId, co.itemKind, co.materialId], ["schema-composite", "product", "schema-composite", "color", "schema-composite"], "read back");
    const cat = M.catalogFromRows(rows);
    ok(cat.products.some((x) => x.materialId === "schema-composite" && x.colors.some((k) => k.colorId === "schema-composite-slate")), "the wizard's catalog");
    const upd = M.materialFields(Object.assign({}, pr, { itemName: "Schema Composite Plus" }), pr);
    ok(!("item_key" in upd), "an edit never sends item_key");
    const s = await repo.saveMaterial(pr.id, pr.version, upd);
    await refused(() => repo.saveMaterial(pr.id, pr.version, upd), "PT409", "a stale version");
    await repo.deleteMaterial(co.id, co.version);
    await repo.deleteMaterial(pr.id, s.version);
    same((await sql("select count(*)::int as n from public.sales_materials where material_key = 'schema-composite'"))[0].n, 0, "both gone");
  });

  await check("P5c sales: sales-media — the repo's names pass M5c's path rule; an editor adds, a reader opens, anybody else is refused; only a drawing's own name is replaced in place", async () => {
    for (const k of [M.mediaKey("estimates", "EST-AB12", "Back yard (1).jpg", "0123456789abcdef0123456789abcdef"),
      M.mediaKey("references", "library", "x.png", "u1"), M.mediaKey("materials", "library", "Slate sample.jpg", "u2"),
      M.mediaKey("estimates", "EST-AB12", "cme-abcdef12-3456.png", null, "cme")]) {
      same((await one("select app.sales_media_path_ok($1) as ok", [k])).ok, true, k);
    }
    same((await one("select app.sales_media_drawing($1) as ok", [M.mediaKey("estimates", "EST-AB12", "cme-abcdef12-3456.png", null, "cme")])).ok, true, "a drawing's name");
    const blob = { type: "image/png", size: 10 };
    await as("manager");
    const a = await repo.uploadMedia("estimates", "EST-SCHEMA1", blob, "Back yard.jpg");
    ok(/^estimates\/EST-SCHEMA1\/[0-9a-f]{32}\/Back_yard\.jpg$/.test(a.path), "an editor adds: " + a.path);
    const d1 = await repo.uploadMedia("estimates", "EST-SCHEMA1", blob, "cme-abcdef12-3456.png", { stable: true });
    const d2 = await repo.uploadMedia("estimates", "EST-SCHEMA1", blob, "cme-abcdef12-3456.png", { stable: true });
    same([d1.path, d2.path], ["estimates/EST-SCHEMA1/cme/cme-abcdef12-3456.png", "estimates/EST-SCHEMA1/cme/cme-abcdef12-3456.png"], "a drawing re-saved: the same object");
    const again = await client.storage.from("sales-media").upload(a.path, blob, { upsert: true, contentType: "image/jpeg" });
    ok(again.error, "any other existing name is not replaced");
    const odd = await repo.uploadMedia("estimates", "EST-SCHEMA1", blob, "notes.txt", { stable: true });
    ok(/^estimates\/EST-SCHEMA1\/cme\/notes\.txt$/.test(odd.path) || /^estimates\/EST-SCHEMA1\/[0-9a-f]{32}\/notes\.txt$/.test(odd.path), "a stable name that is no drawing: added, never over another");
    await as("accountant");
    ok(!!(await repo.mediaUrl(a.path)), "a reader with the switch opens it (signed URL)");
    const ro = await client.storage.from("sales-media").upload("estimates/EST-SCHEMA1/x/y.jpg", blob, { contentType: "image/jpeg" });
    ok(ro.error, "a reader adds nothing");
    for (const k of ["lead", "viewer", "agents"]) {
      await as(k);
      const u = await client.storage.from("sales-media").createSignedUrl(a.path, 60);
      ok(u.error || !u.data, k + ": cannot open it");
    }
    const legal = await sql("select count(*)::int as n from storage.objects where bucket_id = 'sales-media' and not app.sales_media_path_ok(name)");
    same(legal[0].n, 0, "every object a person put there passes the path rule");
  });

  await check("P5c sales: a delete takes the price row with it; a stale delete is 409; nothing here wrote an activity or outbox row (P5 check 5)", async () => {
    await as("admin");
    const e = await repo.getEstimate(S.est);
    await refused(() => repo.deleteEstimate(S.est, e.version - 1), "PT409", "a stale delete");
    await repo.deleteEstimate(S.est, e.version);
    same((await sql("select count(*)::int as n from public.sales_estimate_prices where estimate_id = $1", [S.est]))[0].n, 0, "the price row went with it");
    const r = (await repo.listRefs({ all: true })).find((x) => x.id === S.ref);
    await repo.deleteRef(S.ref, r.version);
    same((await sql("select count(*)::int as n from public.sales_reference_prices where reference_id = $1", [S.ref]))[0].n, 0, "the comp's price row too");
    same(Number((await one("select count(*) as n from public.activity")).n), acts0, "no activity row");
    same(Number((await one("select count(*) as n from public.notifications_outbox")).n), out0, "no outbox row");
  });

  await check("P5c sales: the demo database's sales columns are the real ones (tools/fake/p5c-sales.js)", async () => {
    const harness = path.join(SITE, "..", "tests", "pages-engine.mjs");
    if (!existsSync(harness)) return;
    const H = await import(pathToFileURL(harness).href);
    const engine = await H.freshEngine(new Date());
    for (const t of ["sales_reference_projects", "sales_reference_prices", "sales_estimates", "sales_estimate_prices", "sales_materials"]) {
      same(Object.keys(engine.COLS[t] || {}).sort(), Object.keys(T[t].cols).sort(), "the demo's " + t + " columns");
    }
    ok("can_sales_estimates" in engine.COLS.profiles, "the demo's profiles.can_sales_estimates");
  });

  // the switches back as the other checks found them
  await sql("reset role");
  for (const k of ["manager", "manager2", "accountant"]) await sql("update public.profiles set can_sales_estimates = false where id = $1", [PEOPLE[k].id]);
}
