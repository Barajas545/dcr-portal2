/* DCR Portal 2 — the office lists' queries against the REAL database rules (development only): P5c's Leads, Vehicle Board
   and Marketing Tasks part of tools/schema-check.mjs (it calls run() with its own helpers). Portal 2's own
   site/js/repo/leads.js, repo/vehicles.js and repo/marketing.js run over PGlite loaded with every DCR Desktop 2 migration,
   M5c 20261027000100_office_lists.sql included, as each role:

   * the names the pages read and write exist and answer (every column of the map modules, the embeds
     'costs:vehicle_maintenance_costs(*)' and 'prices:marketing_task_prices(*)', the RPC argument names);
   * leads: admin, manager (with and without prices), accountant and view-only read; a lead, field and the agents
     account read none; admin and manager add, edit (versioned: PT409), mark contacted and delete; everyone else is
     refused (42501); the database tidies the words and formats the phone; convert_lead(p_lead_id, p_project_fields) as
     Portal 2 calls it: the project (create_project: the next number, the client's name and phone), the lead linked,
     "Project … created" and "Created from a lead" logged, in one step; a second convert is 23514 "already converted";
   * vehicles: everyone reads the fleet (not the agents account); the cost row only with financials (the embed is NULL
     without it — even asked for); complete_vehicle_maintenance as Portal 2 calls it: done today (app.today()), an oil
     change stamps the vehicle, the mileage only forward, a done service 23514, a stale one PT409; the labour time
     follows as a versioned PATCH; the material cost into the database's cost row — a manager without financials is
     refused (42501), the service stays done; an admin's is kept;
   * marketing: the same readers as leads; the price embed only with financials; Done stamps the company day, undone
     clears it (the trigger); a price written by an admin into the database's price row; a manager without financials
     refused;
   * P5 check 5: none of these writes adds an activity row except convert_lead's two, and none carries an amount;
   * drift: the demo database (tools/fake/p5c-lists.js) has exactly the real columns of the six tables.
   Made-up people, leads and vehicles only. */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TABLES = ["leads", "vehicles", "vehicle_maintenance", "vehicle_maintenance_costs", "marketing_tasks", "marketing_task_prices"];
const AUDIT = ["created_at", "created_by", "updated_at", "updated_by", "version"];

export async function run(h) {
  const { check, results, section, as, client, sql, one, PEOPLE, ok, same, refused, catalog, SITE } = h;
  const HAS = !!(catalog.tables.leads && catalog.tables.vehicles && catalog.tables.marketing_tasks &&
    catalog.functions.convert_lead && catalog.functions.complete_vehicle_maintenance);
  if (!HAS) {
    // only while M5c is not written yet: once its file is in DCR Desktop 2, a missing table or RPC is drift, never a pass
    const m5c = path.join(h.D2 || path.join(SITE, "..", "..", "DCR Desktop 2"), "supabase", "migrations", "20261027000100_office_lists.sql");
    results.push({ section, name: existsSync(m5c) ? "M5c (20261027000100_office_lists) is in DCR Desktop 2, but the loaded database lacks its lists tables or RPCs"
      : "M5c (20261027000100_office_lists) is not in DCR Desktop 2 yet: the P5c lists checks wait for it", ok: !existsSync(m5c) });
    return;
  }
  const site = (p) => import(pathToFileURL(path.join(SITE, "js", p)).href);
  const leads = await site("repo/leads.js");
  const vehicles = await site("repo/vehicles.js");
  const marketing = await site("repo/marketing.js");
  const LM = await site("map/leads.js");
  const VM = await site("map/vehicles.js");
  const MM = await site("map/marketing.js");
  const today = (await one("select app.today()::text as d")).d;
  const AMOUNT = /\$\s?\d/;

  /* every answer a module received: [{table, data}] */
  const rec = [];
  const origFrom = client.from.bind(client);
  client.from = function (t) {
    const b = origFrom(t);
    const then0 = b.then.bind(b);
    b.then = function (res, rej) { return then0(function (r) { rec.push({ table: t, data: r && r.data }); return res ? res(r) : r; }, rej); };
    return b;
  };
  const keysIn = (rows) => new Set((rows || []).flatMap((r) => Object.keys(r || {}).concat(r && r.costs ? Object.keys(r.costs) : [], r && r.prices ? Object.keys(r.prices) : [])));

  /* ── made-up rows ── */
  await sql("reset role");
  const J = {};
  J.project = await one("insert into public.projects (name, city, status) values ('Lists Schema Barn', 'Sandbox', 'in_progress') returning id, number");
  J.lead1 = (await one(`insert into public.leads (client_name, client_phone, client_address, project_name, category, source, lead_date, notes)
     values ('Quinby Marsh', '805.555.0177', '5 Wren Way, Pine Hollow, CA 93401', 'Marsh ADU', 'ADU', 'Website', $1, 'Wants a quote.') returning id`, [today])).id;
  J.lead2 = (await one(`insert into public.leads (client_name, client_address, category) values ('Tamsin Holloway', '9 Elm Ct, Oak Vista', 'Deck') returning id`)).id;
  J.v1 = (await one(`insert into public.vehicles (fleet_number, license_plate, year, make, model, driver, oil_interval_months, oil_interval_miles,
     last_oil_date, last_oil_mileage, current_mileage) values ('S-1', '1ABC234', 2020, 'Ford', 'F-150', 'Made-up Driver', 6, 5000, $1::date - 200, 40000, 44000)
     returning id`, [today])).id;
  J.m1 = (await one("insert into public.vehicle_maintenance (vehicle_id, next_service_date, next_service_requirements) values ($1, $2, 'Oil change') returning id", [J.v1, today])).id;
  J.m2 = (await one("insert into public.vehicle_maintenance (vehicle_id, next_service_requirements) values ($1, 'Wipers') returning id", [J.v1])).id;
  await sql("update public.vehicle_maintenance_costs set material_cost = 61.25 where maintenance_id = $1", [J.m2]);
  J.t1 = (await one("insert into public.marketing_tasks (project_id, name, category, description) values ($1, 'Drone pass', 'Video', 'Booth said $900.') returning id", [J.project.id])).id;
  J.t2 = (await one("insert into public.marketing_tasks (name, category) values ('Yard signs', 'Print') returning id")).id;
  await sql("update public.marketing_task_prices set price = 450 where task_id = $1", [J.t1]);
  const actCount = async () => Number((await one("select count(*) as n from public.activity")).n);

  await check("P5c lists: the map modules' columns, the embeds and the RPC arguments are the database's own", async () => {
    for (const [cols, t] of [[LM.LEAD_COLS, "leads"], [VM.VEHICLE_COLS, "vehicles"], [VM.MAINT_COLS, "vehicle_maintenance"], [MM.TASK_COLS, "marketing_tasks"]]) {
      for (const c of Object.values(cols)) ok(c in catalog.tables[t].cols, t + "." + c);
    }
    ok(LM.CONTACTED_COL in catalog.tables.leads.cols, "leads." + LM.CONTACTED_COL);
    ok(VM.COST_COL in catalog.tables[VM.COST_TABLE].cols && VM.COST_KEY in catalog.tables[VM.COST_TABLE].cols, "the cost row");
    ok(MM.PRICE_COL in catalog.tables[MM.PRICE_TABLE].cols && MM.PRICE_KEY in catalog.tables[MM.PRICE_TABLE].cols, "the price row");
    ok(!Object.keys(catalog.tables.vehicles.cols).some((c) => /polic/i.test(c)), "Q18: no policy number column");
    const args = (n) => (catalog.functions[n] || [])[0].args.map((a) => a.name);
    same(args("convert_lead"), Object.keys(leads.RPC.convert.args(1, {})), "convert_lead");
    same(args("complete_vehicle_maintenance"), Object.keys(vehicles.RPC.complete.args({ id: 1, version: 1 }, {})), "complete_vehicle_maintenance");
  });

  await check("P5c leads: admin, manager (with and without prices), accountant and view-only read; a lead, field and the agents account read none", async () => {
    for (const k of ["admin", "manager", "manager2", "accountant", "viewer"]) {
      await as(k);
      const got = await leads.loadLeads();
      ok(got.some((l) => l.id === J.lead1) && got.some((l) => l.id === J.lead2), k);
      same(got.find((l) => l.id === J.lead1).leadClientPhone, "(805) 555-0177", k + ": the phone formatted by the database");
    }
    for (const k of ["lead", "field", "agents"]) {
      await as(k);
      same((await leads.loadLeads().catch(() => [])).length, 0, k);
    }
  });

  await check("P5c leads: admin and manager add, edit (versioned), mark contacted and delete; everyone else is refused", async () => {
    await as("manager");
    const n = await leads.addLead({ leadClientName: "  Odile   Fenwick ", leadClientPhone: "805-555-0178 ext 4", leadNotes: "Line one\r\nLine two  ", leadDate: "" }, today);
    same([n.leadClientName, n.leadClientPhone, n.leadNotes, n.leadDate, n.version], ["Odile Fenwick", "(805) 555-0178 ext. 4", "Line one\nLine two", today, 1],
      "tidied by the database; the lead date today");
    const e = await leads.updateLead(n, { leadSource: "Home show", leadDate: "" });
    same([e.leadSource, e.leadDate, e.version], ["Home show", today, 2], "an emptied date box keeps the date (NOT NULL)");
    const stale = await refused(() => leads.updateLead(n, { leadCategory: "Pergola" }), "PT409", "a stale edit");
    same(stale.current.leadSource, "Home show", "the lead as it is now");
    const t = await leads.touchLead(e, today);
    same([t.leadLastcontactedDate, t.version], [today, 3], "contacted today");
    for (const k of ["accountant", "viewer", "manager2"]) {
      await as(k);
      if (k === "manager2") continue;
      await refused(() => leads.addLead({ leadClientName: "Not Allowed" }, today), "42501", k + " add");
      await refused(() => leads.updateLead(t, { leadSource: "x" }), "42501", k + " edit");
      await refused(() => leads.deleteLead(t), "42501", k + " delete");
    }
    for (const k of ["lead", "field"]) {
      await as(k);
      await refused(() => leads.addLead({ leadClientName: "Not Allowed" }, today), "42501", k + " add");
      await refused(() => leads.touchLead(t, today), "PT404", k + ": not even readable");
    }
    await as("admin");
    same(await leads.deleteLead(t), true, "deleted");
    await refused(() => leads.deleteLead(t), "PT404", "gone");
    // the conversion columns are convert_lead's only
    const direct = await client.from("leads").update({ converted_project_id: J.project.id }).eq("id", J.lead2).select("*");
    same(direct.error && direct.error.code, "42501", "a lead becomes a project with convert_lead()");
  });

  await check("P5c leads: convert_lead in one step — the next number, the client's name and phone, the lead linked, two amount-free lines; a second convert says so", async () => {
    await as("manager");
    const before = Number((await one("select count(*) as n from public.projects")).n);
    const a0 = await actCount();
    const list = await leads.loadLeads();
    const l1 = list.find((l) => l.id === J.lead1);
    const got = await leads.convertLead(l1, { name: "Marsh ADU", address: "5 Wren Way", city: "Pine Hollow" });
    const p = await one("select id, number, name, address, city, status, client_name, client_phone from public.projects where id = $1", [got.project.id]);
    same([p.name, p.address, p.city, p.status, p.client_name, p.client_phone], ["Marsh ADU", "5 Wren Way", "Pine Hollow", "new_request", "Quinby Marsh", "(805) 555-0177"]);
    same([got.project.number, got.lead.convertedProjectId, got.lead.projectID, got.lead.leadCreateEstimate], [p.number, p.id, p.number, true]);
    const row = await one("select converted_by, converted_at from public.leads where id = $1", [J.lead1]);
    ok(row.converted_by === PEOPLE.manager.id && row.converted_at, "stamped by the caller");
    same(Number((await one("select count(*) as n from public.projects")).n), before + 1, "one project");
    const lines = (await sql("select text from public.activity order by id")).slice(a0).map((r) => r.text);
    same(lines, ["Project " + p.number + " created", "Created from a lead"], "the two lines");
    const second = await refused(() => leads.convertLead(got.lead, { name: "Again" }), "23514", "a second convert");
    ok(/already converted/.test(second.message), second.message);
    // an emptied address box is NULL on the project (not the lead's whole address line)
    const l2 = list.find((l) => l.id === J.lead2);
    for (const k of ["accountant", "viewer", "lead", "field", "manager2"]) {
      if (k === "manager2") continue;
      await as(k);
      await refused(() => leads.convertLead(l2, { name: "Nope" }), "42501", k);
    }
    await as("admin");
    const got2 = await leads.convertLead(l2, { name: "Holloway deck", address: "", city: "Oak Vista" });
    const p2 = await one("select address, city, client_name, client_phone from public.projects where id = $1", [got2.project.id]);
    same([p2.address, p2.city, p2.client_name, p2.client_phone], [null, "Oak Vista", "Tamsin Holloway", null]);
  });

  await check("P5c vehicles: everyone reads the fleet (not the agents account); a service's cost only with financials — even asked for, NULL without it", async () => {
    for (const k of ["admin", "manager", "manager2", "accountant", "lead", "field", "viewer"]) {
      await as(k);
      rec.length = 0;
      const fin = k === "admin" || k === "accountant";
      const got = await vehicles.loadFleet({ costs: fin });
      ok(got.vehicles.some((v) => v.id === J.v1) && got.maintenance.some((m) => m.id === J.m2), k);
      const m2 = got.maintenance.find((m) => m.id === J.m2);
      same(m2.materialCost, fin ? 61.25 : null, k + ": the cost");
      if (!fin) ok(!rec.some((x) => keysIn(x.data).has("material_cost")), k + ": no cost column in any answer");
      const asked = await vehicles.loadFleet({ costs: true });
      if (!fin) same(asked.maintenance.find((m) => m.id === J.m2).materialCost, null, k + ": the embed is empty without financials");
    }
    await as("agents");
    same((await vehicles.loadFleet({ costs: false }).catch(() => ({ vehicles: [] }))).vehicles.length, 0, "the agents account");
  });

  await check("P5c vehicles: complete_vehicle_maintenance as Portal 2 calls it — today, the oil stamp, the mileage forward; labour after it; the cost needs financials", async () => {
    await as("manager");
    const a0 = await actCount();
    let f = await vehicles.loadFleet({ costs: false });
    const v = f.vehicles.find((x) => x.id === J.v1);
    const m = f.maintenance.find((x) => x.id === J.m1);
    const got = await vehicles.completeService(m, v, { performed: "Oil and filter", mileage: "44,250", oil: true, laborTime: "1 h", materialCost: "70" });
    same([got.maintenance.serviceCompletionDate, got.maintenance.currentMileage, got.maintenance.laborTime], [today, 44250, "1 h"], "done today, labour kept");
    same([got.vehicle.lastOilChangeDate, got.vehicle.lastOilChangeMileage, got.vehicle.currentMileage], [today, 44250, 44250], "the vehicle stamped");
    same([got.extraError, got.costError && got.costError.code], [null, "42501"], "a manager without financials: the cost refused, the service done");
    same((await one("select material_cost from public.vehicle_maintenance_costs where maintenance_id = $1", [J.m1])).material_cost, null, "no cost");
    await refused(() => vehicles.completeService(got.maintenance, got.vehicle, { performed: "again" }), "23514", "a done service");
    f = await vehicles.loadFleet({ costs: false });
    const m2 = f.maintenance.find((x) => x.id === J.m2);
    await refused(() => vehicles.completeService(Object.assign({}, m2, { version: m2.version + 5 }), v, { performed: "x" }), "PT409", "a stale service");
    const d2 = await vehicles.completeService(m2, f.vehicles.find((x) => x.id === J.v1), { performed: "Wipers", mileage: "100" });
    same([d2.maintenance.currentMileage, d2.vehicle.currentMileage], [100, 44250], "a lower reading stays on the service; the vehicle's mileage only forward");
    for (const k of ["accountant", "lead", "field", "viewer"]) {
      await as(k);
      await refused(() => vehicles.scheduleService({ id: J.v1 }, { requirements: "x" }), "42501", k + " schedule");
      const now = (await vehicles.loadFleet({ costs: false })).vehicles.find((x) => x.id === J.v1);
      await refused(() => vehicles.updateVehicle(now, { vehicleDriverInformation: "Someone" }), "42501", k + " edit");
      const open = (await vehicles.loadFleet({ costs: false })).maintenance.find((x) => x.vehicleID === J.v1 && !x.serviceCompletionDate);
      if (open) await refused(() => vehicles.completeService(open, now, { performed: "x" }), "42501", k + " complete");
    }
    await as("admin");
    f = await vehicles.loadFleet({ costs: true });
    const s3 = await vehicles.scheduleService(f.vehicles.find((x) => x.id === J.v1), { date: today, requirements: "Brake fluid" });
    f = await vehicles.loadFleet({ costs: true });
    const m3 = f.maintenance.find((x) => x.id === s3.id);
    ok(m3.costs && m3.costsVersion === 1 && m3.materialCost === null, "the database made the cost row");
    const d3 = await vehicles.completeService(m3, f.vehicles.find((x) => x.id === J.v1), { performed: "Flushed", materialCost: "$42.50" });
    same([d3.costError, d3.maintenance.materialCost], [null, 42.5], "an admin's cost kept");
    const ch = await vehicles.setMaterialCost(d3.maintenance, "45");
    same(ch.materialCost, 45, "changed at its version");
    await refused(() => vehicles.setMaterialCost(d3.maintenance, "50"), "PT409", "a stale cost");
    const ed = await vehicles.updateVehicle(f.vehicles.find((x) => x.id === J.v1), { vehicleDriverInformation: "Another Driver", vehicleActive: false, licensePlateNumber: "9xyz999" });
    same([ed.vehicleDriverInformation, ed.vehicleActive, ed.licensePlateNumber], ["Another Driver", false, "9XYZ999"], "edited and retired");
    const nv = await vehicles.addVehicle({ fleetNumber: "S-2", vehicleMake: "Ram", vehicleYear: "2022" });
    ok(nv.id && nv.vehicleActive === true, "added");
    await refused(() => vehicles.addVehicle({ fleetNumber: "S-3", oilChangeIntervalMonths: "0" }), "22023", "the page's check of the database's range");
    same(await actCount(), a0, "P5 check 5: no activity row");
  });

  await check("P5c marketing: readers and the price embed (financials only); Done stamps the company day, undone clears it; prices by financials editors", async () => {
    for (const k of ["admin", "manager", "manager2", "accountant", "viewer"]) {
      await as(k);
      rec.length = 0;
      const fin = k === "admin" || k === "accountant";
      const got = await marketing.loadMarketing({ prices: fin });
      const t1 = got.tasks.find((t) => t.id === J.t1);
      ok(t1 && got.tasks.some((t) => t.id === J.t2), k);
      same(t1.marketingTaskPrice, fin ? 450 : null, k + ": the price");
      if (!fin) ok(!rec.some((x) => x.table === "marketing_tasks" && keysIn(x.data).has("price")), k + ": no price in any answer");
    }
    for (const k of ["lead", "field", "agents"]) {
      await as(k);
      same((await marketing.loadMarketing({ prices: false }).catch(() => ({ tasks: [] }))).tasks.length, 0, k);
    }
    await as("manager");
    const a0 = await actCount();
    let got = await marketing.loadMarketing({ prices: false });
    let t = got.tasks.find((x) => x.id === J.t2);
    t = await marketing.toggleMark(t, "marketingTaskMarkComplete");
    same([t.marketingTaskMarkComplete, t.marketingTaskCompletedDate], [true, today], "done: today");
    t = await marketing.toggleMark(t, "marketingTaskMarkComplete");
    same([t.marketingTaskMarkComplete, t.marketingTaskCompletedDate], [false, ""], "undone: cleared");
    t = await marketing.toggleMark(t, "marketingTaskCheckInvoiced");
    same(t.marketingTaskCheckInvoiced, true);
    const add = await marketing.addTask({ marketingTaskName: "Flyers", projectID: null }, "120", today);
    same([add.task.marketingTaskDate, add.priceError && add.priceError.code], [today, "42501"], "a manager without financials: the task saved, its price refused");
    same((await one("select price from public.marketing_task_prices where task_id = $1", [add.task.id])).price, null, "the database's price row, unfilled");
    await refused(() => marketing.toggleMark(Object.assign({}, t, { version: t.version - 1 }), "marketingTaskCheckPaid"), "PT409", "a stale mark");
    await as("admin");
    got = await marketing.loadMarketing({ prices: true });
    const fl = got.tasks.find((x) => x.id === add.task.id);
    const pr = await marketing.updateTask(fl, {}, "$120");
    same([pr.priceError, pr.task.marketingTaskPrice], [null, 120], "priced");
    const st = await marketing.updateTask(fl, {}, "99");
    same(st.priceError && st.priceError.code, "PT409", "a stale price");
    for (const k of ["accountant", "viewer"]) {
      await as(k);
      const x = (await marketing.loadMarketing({ prices: k === "accountant" })).tasks.find((y) => y.id === J.t1);
      await refused(() => marketing.toggleMark(x, "marketingTaskCheckPaid"), "42501", k + " mark");
      await refused(() => marketing.deleteTask(x), "42501", k + " delete");
    }
    await as("manager");
    const fresh = (await marketing.loadMarketing({ prices: false })).tasks.find((y) => y.id === add.task.id);
    same(await marketing.deleteTask(fresh), true, "deleted");
    same(await actCount(), a0, "P5 check 5: no activity row");
    const any = (await sql("select text from public.activity")).filter((r) => /lead|vehicle|marketing/i.test(r.text || "") && AMOUNT.test(r.text || ""));
    same(any.length, 0, "no amount in a list's line");
  });

  await check("P5c lists: drift — the demo database (tools/fake/p5c-lists.js) has exactly the real columns of the six tables", async () => {
    const harness = path.join(SITE, "..", "tests", "pages-engine.mjs");
    if (!existsSync(harness)) return;
    const H = await import(pathToFileURL(harness).href);
    const engine = await H.freshEngine(new Date());
    for (const t of TABLES) {
      ok(engine.COLS[t], "the demo has " + t);
      const demo = Object.keys(engine.COLS[t]).sort();
      const real = Object.keys(catalog.tables[t].cols).sort();
      same(demo, real, t);
      ok(AUDIT.every((c) => c in catalog.tables[t].cols), t + ": audited");
    }
  });
}
