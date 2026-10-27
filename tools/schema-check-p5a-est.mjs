/* DCR Portal 2 — tools/schema-check.mjs's P5a section for the estimates pages (development only): Portal 2's own
   site/js/repo/estimates.js, map/estimates.js, map/takeoffs.js and pages/est-render.js against the REAL migration
   M5a (20261025000100_office_pm.sql: rpc estimate_print, rpc takeoff_print, estimate_item_flags) as each made-up
   person, through tools/pglite-rest.mjs. The P5 acceptance check 1 for the Estimate and Takeoffs tabs and the
   printed pages: a person without prices is sent no money key and no typed amount (the database scrubs it), and
   a person with prices gets the database's own figures; once DCR Desktop 2 has 20261029000200_takeoff_groups, the
   takeoffs' groups in their group order (owner 2026-10-27). Made-up data only. */
import path from "node:path";
import { pathToFileURL } from "node:url";

const DOLLARS = /\$\s?\d/;
const MONEY_KEYS = ["labor", "material", "total", "labor_total", "material_total", "labor_per_area", "material_per_area", "contract",
  "client_notes", "unit_price", "line_total", "subtotal", "amount", "labor_rate", "labor_unit_price", "material_unit_price", "quoted_price",
  "tax", "tax_rate"];

function keysDeep(v, out) {
  out = out || new Set();
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") Object.keys(v).forEach((k) => { out.add(k); keysDeep(v[k], out); });
  return out;
}

/** h: {check, results, section, as, client, sql, one, SITE, PEOPLE, ok, same, refused, catalog} */
export async function run(h) {
  const { check, results, as, client, sql, one, PEOPLE, ok, same, catalog } = h;
  const site = (p) => import(pathToFileURL(path.join(h.SITE, "js", p)).href);
  if (!(catalog.functions.estimate_print && catalog.functions.takeoff_print && catalog.tables.estimate_item_flags)) {
    results.push({ section: h.section, name: "M5a (20261025000100_office_pm) is not in DCR Desktop 2 yet: the P5a estimates checks wait for it", ok: true });
    return;
  }
  const repo = await site("repo/estimates.js");
  const est = await site("map/estimates.js");
  const tko = await site("map/takeoffs.js");
  const render = await site("pages/est-render.js");
  const S = {};

  await check("set-up (made-up): a project with two estimates, two change orders, an archived and a deleted one, typed amounts in the words, two takeoffs", async () => {
    client.as(PEOPLE.admin.id);
    const made = await client.rpc("create_project", { fields: { name: "Estimates Check Job", address: "5 Sample Ln", city: "Templeton" } });
    ok(!made.error, "create_project: " + JSON.stringify(made.error));
    const p = Array.isArray(made.data) ? made.data[0] : made.data;
    S.pid = p.id;
    await sql("reset role");
    await sql("update public.project_prices set labor_rate = 90 where project_id = $1", [S.pid]);
    const est1 = await one(`insert into public.estimates (project_id, name, description, status, client_notes, group_order)
      values ($1, 'Main framing', 'Per plan set rev C.', 'approved', 'Includes a $2,500 hardware allowance.', array['Walls', 'Floor']) returning *`, [S.pid]);
    const est2 = await one("insert into public.estimates (project_id, name, status) values ($1, 'Deck option', 'sent') returning *", [S.pid]);
    const co1 = await one("insert into public.estimates (project_id, kind, name, status) values ($1, 'change_order', 'Extra window', 'approved') returning *", [S.pid]);
    const co2 = await one("insert into public.estimates (project_id, kind, name, description, status) values ($1, 'change_order', 'Porch', 'Budget of $9,000 mentioned', 'draft') returning *", [S.pid]);
    const arch = await one("insert into public.estimates (project_id, name, status) values ($1, 'Old layout', 'declined') returning *", [S.pid]);
    await sql("update public.estimates set archived_at = now() where id = $1", [arch.id]);
    const gone = await one("insert into public.estimates (project_id, name) values ($1, 'Deleted draft') returning *", [S.pid]);
    const item = async (e, f, pr) => {
      const r = await one(`insert into public.estimate_items (estimate_id, group_name, group_code, name, description, labor_guys, labor_days, labor_qty,
          material_description, material_qty, notes) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
        [e.id, f.group || null, f.code || null, f.name, f.desc || null, f.guys || null, f.days || null, f.lqty === undefined ? 1 : f.lqty,
          f.mat || null, f.mqty === undefined ? 1 : f.mqty, f.notes || null]);
      if (pr) await sql(`update public.estimate_item_prices set labor_rate = coalesce($2, labor_rate), labor_unit_price = $3, labor_markup_pct = $4,
          material_unit_price = $5, material_markup_pct = $6 where item_id = $1`, [r.id, pr.rate === undefined ? null : pr.rate, pr.lup || null, pr.lm || 0, pr.mup || null, pr.mm || 0]);
      return r;
    };
    S.floor = await item(est1, { group: "Floor", code: "06.11.00", name: "Floor joists", guys: 4, days: 3, mat: "3/4 T&G OSB", mqty: 64 }, { lm: 10, mup: 48.75, mm: 15 });
    S.walls = await item(est1, { group: "Walls", code: "06.11.00", name: "Exterior walls", desc: "Client asked about a $1,200 credit.", guys: 5, days: 6,
      mat: "2x6 studs", mqty: 420, notes: "Yard quoted $6.85 a stud." }, { lm: 10, mup: 6.85, mm: 12 });
    await item(est1, { group: "  walls ", name: "Interior walls", guys: 3, days: 4, mat: "2x4 studs", mqty: 260 }, { lm: 10, mup: 4.1, mm: 12 });
    await item(est1, { name: "Cleanup", lqty: 1, mqty: 0 }, { rate: null, lup: 650 });
    S.deck = await item(est2, { group: "Deck", name: "Deck framing", guys: 2, days: 3, mat: "PT 2x8", mqty: 22 }, { mup: 18.4 });
    await item(co1, { name: "Frame the opening", guys: 2, days: 1, mat: "Header 4x12", mqty: 1 }, { mup: 86 });
    await item(co2, { group: "Porch", name: "Posts and beam", guys: 3, days: 2 }, {});
    await item(arch, { name: "First layout", guys: 4, days: 10 }, {});
    await item(gone, { name: "Never priced" }, {});
    await sql("update public.estimates set deleted_at = now() where id = $1", [gone.id]);
    const t1 = await one("insert into public.takeoffs (project_id, name, description, takeoff_date) values ($1, 'Main framing', 'Rev C, about $12k of lumber', current_date - 20) returning *", [S.pid]);
    const t2 = await one("insert into public.takeoffs (project_id, estimate_item_id, name, takeoff_date) values ($1, $2, 'Deck framing', current_date - 5) returning *", [S.pid, S.deck.id]);
    const row = async (t, f, price) => {
      const r = await one(`insert into public.takeoff_rows (takeoff_id, level, category, subcategory, item_name, purpose, qty, unit, notes)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`, [t.id, f.level || null, f.cat || null, f.sub || null, f.item, f.purpose || null, f.qty, f.unit || "ea", f.notes || null]);
      if (price !== undefined) await sql("update public.takeoff_row_prices set unit_price = $2 where row_id = $1", [r.id, price]);
      return r;
    };
    await row(t1, { level: "Main Level", cat: "Walls", sub: "Exterior", item: "2x6x8 stud", purpose: "Exterior walls", qty: 180 }, 6.85);
    await row(t1, { level: "Main Level", cat: "Walls", sub: "Exterior", item: "Hold-down HDU5", purpose: "Shear walls", qty: 12, notes: "about $38 each" }, 38.4);
    await row(t1, { level: "Roof", item: "1/2 CDX", purpose: "Sheathing", qty: 96, unit: "sheet" }, 32.5);
    await row(t1, { item: "Truss package", qty: 0, unit: "ls" }, null);
    await row(t2, { level: "Deck", item: "PT 2x8x12", purpose: "Joists", qty: 22 }, 18.4);
    S.t1 = t1.id;
    // the view's own figures (security invoker: read as the admin, who sees prices)
    client.as(PEOPLE.admin.id);
    const exp = await client.from("estimate_item_totals").select("total").eq("estimate_id", est1.id);
    ok(!exp.error && exp.data.length === 4, "the view: " + JSON.stringify(exp.error));
    S.est1Total = exp.data.reduce((s, r) => s + est.toCents(r.total), 0);
    same(S.est1Total, 5142216, "13,092 + 26,982.24 + 10,697.92 + 650");
    S.ids = { est1: est1.id, co1: co1.id, arch: arch.id, gone: gone.id };
  });

  await check("set-up: two item flags (estimate_item_flags, as DCR Desktop 2 2.18 or a lead's progress chart writes them)", async () => {
    await sql("reset role");
    await sql("insert into public.estimate_item_flags (item_id, state, note, due_date) values ($1, 'blocked', 'Trusses late, about $400 extra freight', current_date + 3)", [S.walls.id]);
    await sql("insert into public.estimate_item_flags (item_id, state) values ($1, 'complete')", [S.floor.id]);
    S.flags = true;
  });

  await check("without prices (manager - Q1 -, lead, field, viewer): estimate_print and takeoff_print send no money key, no item notes, no terms; typed amounts arrive as [amount]", async () => {
    for (const k of ["manager", "lead", "field", "viewer"]) {
      await as(k);
      for (const [name, args] of [["estimate_print", { p_estimate_id: S.ids.est1 }], ["estimate_print", { p_estimate_id: S.ids.co1 }],
        ["takeoff_print", { p_takeoff_id: null, p_project_id: S.pid }]]) {
        const r = await client.rpc(name, args);
        ok(!r.error, k + " " + name + ": " + JSON.stringify(r.error));
        same(r.data.prices, false, k + " " + name + ": prices");
        const keys = keysDeep(r.data);
        same(MONEY_KEYS.filter((x) => keys.has(x)), [], k + " " + name + ": money keys");
        same(Object.keys(r.data.totals || {}).filter((x) => x !== "men_hours"), [], k + " " + name + ": totals");
        ok(!DOLLARS.test(JSON.stringify(r.data)), k + " " + name + ": a typed amount reached the browser: " + (JSON.stringify(r.data).match(/.{30}\$\s?\d.{10}/) || [""])[0]);
        if (name === "estimate_print") ok(!keys.has("notes"), k + ": an item's internal notes");
      }
      const res = await repo.listEstimates(S.pid, { archived: true });
      same(res.prices, false, k + ": the repo reads 'no prices'");
      ok(res.estimates.every((x) => x.total === null && x.items.every((i) => i.money === null)), k + ": no money in the shaped estimates");
      ok(JSON.stringify(res.estimates).includes("[amount]"), k + ": the scrubbed words");
      const flagsOf = res.estimates[0].items.map((i) => i.flags.map((f) => f.state).join("")).join(",");
      if (S.flags) ok(/blocked/.test(flagsOf) && /complete/.test(flagsOf), k + ": the item flags (whoever reads the item): " + flagsOf);
      const tk = await repo.listTakeoffs(S.pid);
      same(tk.prices, false, k + " takeoffs");
      ok(tk.takeoffs.every((t) => t.rows.every((r) => r.prices === undefined)), k + ": no row price");
      const project = { internalIDNumber: "A999", projectName: "Estimates Check Job" };
      const sheet = render.estimateSheetHtml(project, est.pickForPrint(res.estimates, "all"), { show: est.moneyShown(false, res.estimates), company: { name: "DCR" }, date: "2026-10-21" });
      ok(!DOLLARS.test(sheet.html) && sheet.html.includes(est.WORKSITE_TAG), k + ": the printed worksite copy carries no amount");
      const ml = render.takeoffSheetHtml(project, tk.takeoffs, { quote: false, company: { name: "DCR" }, date: "2026-10-21" });
      ok(!DOLLARS.test(ml.html), k + ": the material list carries no amount");
    }
  });

  await check("with prices (admin, a manager with prices, accountant): the database's money, the change order's contract, the tax rate; the repo adds up to the view", async () => {
    for (const k of ["admin", "manager2", "accountant"]) {
      await as(k);
      const res = await repo.listEstimates(S.pid);
      same(res.prices, true, k);
      same(res.estimates.map((x) => x.label), ["Estimate #1", "Estimate #2", "Change order #1", "Change order #2"], k + ": archived and deleted left out, list order");
      const e1 = res.estimates[0];
      same(e1.groups.map((g) => g.title), ["Walls", "Floor", "General"], k + ": the office's group order (group_order), the unnamed group last");
      same(e1.groups[0].items.length, 2, k + ": 'Walls' and '  walls ' are one group");
      same(e1.total.total, S.est1Total, k + ": the estimate's total = the view's");
      same(e1.items.find((i) => i.id === S.floor.id).money, { labor: 950400, material: 358800, total: 1309200 }, k + ": 4 x 3 x 8 x $90 x 1.10 + 64 x $48.75 x 1.15");
      ok(e1.items.find((i) => i.id === S.walls.id).notes === "Yard quoted $6.85 a stud.", k + ": the internal notes, as typed");
      ok(DOLLARS.test(e1.client_notes || ""), k + ": the terms, as typed");
      const co = res.estimates[2];
      ok(co.contract && co.contract.original === e1.total.total && co.contract.newTotal === co.contract.original + co.contract.previous + co.contract.self,
        k + ": contract " + JSON.stringify(co.contract));
      const tk = await repo.listTakeoffs(S.pid);
      same(tk.prices, true, k + " takeoffs");
      ok(Number(tk.taxRate) >= 0, k + ": the tax rate");
      const t1 = tk.takeoffs.find((t) => t.id === S.t1);
      same(t1.lines, 4, k);
      same(tko.quoteTotals(t1.rows, 0).subtotal, 123300 + 46080 + 312000, k + ": 180 x 6.85 + 12 x 38.40 + 96 x 32.50");
      ok(t1.priced, k + ": every row came with its price row (one of them blank)");
      const deck = tk.takeoffs.find((t) => t.name === "Deck framing");
      ok(deck.item && deck.item.name === "Deck framing" && deck.item.estimate_label === "Estimate #2", k + ": the item it is for");
    }
  });

  // the takeoff groups (owner 2026-10-27; migration 20261029000200_takeoff_groups: takeoffs.group_order, takeoff_print sends it)
  const tkCols = (catalog.tables.takeoffs && catalog.tables.takeoffs.cols) || {};
  if (!("group_order" in tkCols)) {
    results.push({ section: h.section, name: "20261029000200_takeoff_groups is not in DCR Desktop 2 yet: the takeoff group-order check waits for it", ok: true });
  } else {
    await check("takeoff groups (20261029000200): takeoff_print sends each takeoff's group_order - as stored with prices, each name scrubbed without; the tab and the paper draw the groups in it", async () => {
      await sql("reset role");
      await sql("update public.takeoffs set group_order = array['Roof', '', 'Main Level', 'Extras $50'] where id = $1", [S.t1]);
      try {
        for (const k of ["admin", "lead"]) {
          await as(k);
          const prices = k === "admin";
          const raw = await client.rpc("takeoff_print", { p_takeoff_id: S.t1, p_project_id: null });
          ok(!raw.error, k + " takeoff_print: " + JSON.stringify(raw.error));
          same(raw.data.takeoffs[0].takeoff.group_order, prices ? ["Roof", "", "Main Level", "Extras $50"] : ["Roof", "", "Main Level", "Extras [amount]"],
            k + ": the order as the database sends it");
          const tk = await repo.listTakeoffs(S.pid);
          const t1 = tk.takeoffs.find((t) => t.id === S.t1);
          same(t1.levels.map((l) => tko.levelName(l.name)), ["Roof", "(no group)", "Main Level"], k + ": the groups in that order; a listed group with no line is not drawn");
          const ml = render.takeoffSheetHtml({ internalIDNumber: "A999" }, [t1], { quote: false, company: { name: "DCR" }, date: "2026-10-27" });
          const bands = Array.from(ml.html.matchAll(/<tr class="ml-lvl"><td colspan="\d">([^<]*)<\/td>/g)).map((m) => m[1]);
          same(bands, ["Roof", "(no group)", "Main Level"], k + ": the Material List's bands");
          ok(!DOLLARS.test(ml.html), k + ": the material list carries no amount");
        }
      } finally {
        await sql("reset role");
        await sql("update public.takeoffs set group_order = '{}' where id = $1", [S.t1]);
      }
    });
  }

  await check("the agents account, an inactive account: refused (42501); a deleted estimate: PT404; the archived one only when asked", async () => {
    for (const k of ["agents", "inactive"]) {
      client.as(PEOPLE[k].id);
      same((await client.rpc("estimate_print", { p_estimate_id: S.ids.est1 })).error.code, "42501", k + " estimate_print");
      same((await client.rpc("takeoff_print", { p_takeoff_id: null, p_project_id: S.pid })).error.code, "42501", k + " takeoff_print");
      same(((await client.from("estimates").select("id").eq("project_id", S.pid)).data || []).length, 0, k + ": no estimate row");
    }
    await as("admin");
    same((await client.rpc("estimate_print", { p_estimate_id: S.ids.gone })).error.code, "PT404", "deleted");
    same(await repo.printEstimate(S.ids.gone), null, "the repo skips a deleted one");
    const a = await repo.listEstimates(S.pid);
    same(a.archived, 1, "counted");
    ok(!a.estimates.some((x) => x.archived), "left out");
    const b = await repo.listEstimates(S.pid, { archived: true });
    ok(b.estimates.some((x) => x.id === S.ids.arch && x.archived), "shown when asked");
  });
}
