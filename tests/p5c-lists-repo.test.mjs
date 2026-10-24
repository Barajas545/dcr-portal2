// P5c: the office lists' data modules (site/js/repo/leads.js, repo/vehicles.js, repo/marketing.js) over the DEMO database
// (tools/fake/p5c-lists.js: M5c's leads + convert_lead, vehicles, vehicle_maintenance(+_costs), marketing_tasks(+_prices)).
// Per role: who is answered which rows (Appendix D: leads admin / manager / accountant / view-only; vehicles everyone; a
// service's cost and a marketing price only with financials — and no answer without the switch carries the column), who
// may write (admin, manager; the money rows with financials), the versioned writes (PT409, PT404, 42501), the convert in
// one step (the project's number from the database, a second convert refused), and P5 acceptance check 5 (no amount in
// any activity row). Made-up people, leads and vehicles only.
import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as leads from "../site/js/repo/leads.js";
import * as vehicles from "../site/js/repo/vehicles.js";
import * as marketing from "../site/js/repo/marketing.js";
import { forgetProjects } from "../site/js/repo/projects.js";
import { clearPeople } from "../site/js/repo/people.js";
import { seesCosts } from "../site/js/map/vehicles.js";
import { seesPrice } from "../site/js/map/marketing.js";

const skip = !available;
const AMOUNT = /\$\s?\d|\b\d{2,}\.\d{2}\b/;

async function as(key, engine) {
  const e = engine || await freshEngine();
  const who = await person(key);
  const me = e.rows.profiles.find((p) => p.id === who.id);
  if (!e._recording) {
    const orig = e.select;
    e.select = function (ctx, table, q) { const r = orig(ctx, table, q); (e._log || []).push({ table, columns: q && q.columns, rows: r.data }); return r; };
    e._recording = true;
  }
  e._log = [];
  clearPeople();
  forgetProjects();
  useClient(clientAs(e, who.id));
  return { e, me: Object.assign({}, me), uid: who.id };
}
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
async function refused(fn, code, msg) {
  try { await fn(); } catch (err) { if (code) assert.equal(String(err.code), code, msg + ": " + err.code + " " + err.message); return err; }
  assert.fail(msg + ": allowed");
}
const keysOf = (rows) => new Set((rows || []).flatMap((r) => Object.keys(r || {})));

test("leads: admin, manager, accountant and view-only read them; a lead and field are answered none", { skip }, async () => {
  const engine = await freshEngine();
  const all = engine.rows.leads.length;
  assert.ok(all >= 5, "the demo's leads");
  for (const key of ["admin", "manager", "accountant", "viewer"]) {
    await as(key, engine);
    const got = await leads.loadLeads();
    assert.equal(got.length, all, key);
    const conv = got.find((l) => l.leadCreateEstimate);
    assert.ok(conv && /^A\d{3}/.test(conv.projectID), key + ": the converted lead names its project");
  }
  for (const key of ["lead", "field"]) {
    await as(key, engine);
    assert.equal((await leads.loadLeads()).length, 0, key + ": no rows");
  }
  // the home page's badge (counts only): the same leads, and the projects are never paged through for their names
  const { e } = await as("admin", engine);
  const quick = await leads.loadLeads({ names: false });
  assert.equal(quick.length, all);
  assert.ok(quick.some((l) => l.leadCreateEstimate && l.convertedProjectId !== null && l.projectID === ""), "converted, without the name");
  assert.deepEqual(e._log.map((x) => x.table), ["leads"], "only the leads were read");
});

test("leads: the office adds, edits, touches and deletes; versions are checked; everyone else is refused", { skip }, async () => {
  const { e } = await as("manager");
  const n = await leads.addLead({ leadClientName: "Pippa Larchmont", leadClientPhone: "(805) 555-0190", leadCategory: "Deck", leadNotes: "Called twice." });
  assert.equal(n.leadDate, today(), "the lead date defaults to today (company day)");
  assert.equal(n.version, 1);
  const edited = await leads.updateLead(n, { leadClientName: "Pippa Larchmont", leadSource: "Website" });
  assert.deepEqual([edited.leadSource, edited.version], ["Website", 2]);
  const row = e.rows.leads.find((l) => l.id === n.id);
  assert.equal(row.updated_by, (await person("manager")).id);
  // someone else saved first: PT409 with the lead as it is now
  const stale = await refused(() => leads.updateLead(n, { leadCategory: "Pergola" }), "PT409", "a stale version");
  assert.equal(stale.current.leadSource, "Website");
  const touched = await leads.touchLead(edited);
  assert.equal(touched.leadLastcontactedDate, today());
  await refused(() => leads.addLead({ leadClientName: "  " }), "22023", "no client name");
  for (const key of ["accountant", "viewer", "lead", "field"]) {
    await as(key, e);
    await refused(() => leads.addLead({ leadClientName: "Not Allowed" }), "42501", key + " add");
    if (key === "accountant" || key === "viewer") {
      await refused(() => leads.updateLead(touched, { leadSource: "Nope" }), "42501", key + " edit");
      await refused(() => leads.touchLead(touched), "42501", key + " touch");
      await refused(() => leads.deleteLead(touched), "42501", key + " delete");
    } else {
      await refused(() => leads.touchLead(touched), "PT404", key + ": the lead is not even there");
    }
  }
  await as("admin", e);
  await refused(() => leads.deleteLead(n), "PT409", "a stale delete");
  assert.equal(await leads.deleteLead(touched), true);
  await refused(() => leads.deleteLead(touched), "PT404", "deleted already");
});

test("leads: convert_lead makes the project (the database's number, the client's name and phone) and links the lead in one step", { skip }, async () => {
  const { e } = await as("manager");
  const list = await leads.loadLeads();
  const open = list.find((l) => !l.leadCreateEstimate && l.leadClientPhone);
  const before = e.rows.projects.length;
  const nextNo = "A" + e.rows.settings[0].next_project_number;
  const got = await leads.convertLead(open, { name: "  Thistle   ADU ", address: "120 Juniper Ln", city: "Pine Hollow" });
  assert.equal(e.rows.projects.length, before + 1);
  const p = e.rows.projects.find((x) => x.id === got.project.id);
  assert.deepEqual([p.name, p.address, p.city, p.status, p.client_name, p.client_phone], ["Thistle ADU", "120 Juniper Ln", "Pine Hollow", "new_request",
    open.leadClientName, open.leadClientPhone]);
  assert.equal(p.number, got.project.number);
  assert.ok(/^A\d{3,}$/.test(p.number) && p.number >= nextNo.slice(0, 1), "a number from the database: " + p.number);
  assert.deepEqual([got.lead.leadCreateEstimate, got.lead.convertedProjectId, got.lead.projectID], [true, p.id, p.number]);
  const second = await refused(() => leads.convertLead(got.lead, { name: "Again" }), "23514", "a second convert");
  assert.match(second.message, /^already converted: this lead became project A\d+/);
  const log = e.rows.activity.filter((a) => a.project_id === p.id).map((a) => a.text);
  assert.deepEqual(log, ["Project " + p.number + " created", "Created from a lead"], "the project's first two lines, amount-free");
  assert.equal(e.rows.projects.length, before + 1, "no second project");
  await refused(() => leads.convertLead(open, {}), "22023", "a project needs a name (the page asks before anything is sent)");
  const other = list.find((l) => !l.leadCreateEstimate && l.id !== open.id && l.leadProjectName);
  for (const key of ["accountant", "viewer", "lead", "field"]) {
    await as(key, e);
    await refused(() => leads.convertLead(other, { name: "Nope" }), "42501", key);
  }
  assert.equal(e.rows.projects.length, before + 1, "nobody else made a project");
  // the lead's own words when nothing overrides them: its project name, its address line, the client (convert_lead's defaults)
  await as("admin", e);
  const raw = await (await import("../site/js/repo/_db.js")).db();
  const direct = await raw.rpc("convert_lead", { p_lead_id: other.id });
  const dp = e.rows.projects.find((x) => x.id === direct.data.project.id);
  assert.deepEqual([dp.name, dp.address, dp.client_name], [other.leadProjectName, other.leadClientAddress, other.leadClientName], "convert_lead's own defaults");
});

test("vehicles: everyone reads the board; the cost column only reaches the financials switch (not even asked for without it)", { skip }, async () => {
  const engine = await freshEngine();
  const nv = engine.rows.vehicles.length, nm = engine.rows.vehicle_maintenance.length;
  for (const key of ["admin", "manager", "approver", "accountant", "lead", "field", "viewer"]) {
    const { e, me } = await as(key, engine);
    const costs = seesCosts(me);
    const got = await vehicles.loadFleet({ costs });
    assert.deepEqual([got.vehicles.length, got.maintenance.length], [nv, nm], key);
    const priced = got.maintenance.filter((m) => m.materialCost !== null).length;
    if (costs) assert.ok(priced >= 2, key + ": the costs");
    else {
      assert.equal(priced, 0, key + ": no cost");
      for (const x of e._log) {
        assert.notEqual(x.table, "vehicle_maintenance_costs", key);
        assert.ok(!/costs/.test(String(x.columns)), key + ": the embed is not asked for");
        assert.ok(!keysOf(x.rows).has("material_cost"), key + ": no cost column");
      }
    }
    assert.ok(!got.vehicles.some((v) => Object.keys(v).some((k) => /polic/i.test(k))), key + ": no policy number");
  }
  // even asked for, the database answers no cost without financials
  await as("manager", engine);
  const asked = await vehicles.loadFleet({ costs: true });
  assert.equal(asked.maintenance.filter((m) => m.materialCost !== null).length, 0, "RLS: the embed is empty");
  await as("agents", engine);
  assert.equal((await vehicles.loadFleet({ costs: false }).catch(() => ({ vehicles: [] }))).vehicles.length, 0, "the agents account reads none");
});

test("vehicles: the office schedules and completes; an oil change stamps the vehicle; the mileage only moves forward; the cost needs financials", { skip }, async () => {
  const { e, me } = await as("manager");
  let fleet = await vehicles.loadFleet({ costs: seesCosts(me) });
  const v = fleet.vehicles.find((x) => x.fleetNumber === "T-01");
  const s = await vehicles.scheduleService(v, { date: today(), requirements: "Oil change and rotate" });
  assert.deepEqual([s.vehicleID, s.nextServiceDate, s.serviceCompletionDate], [v.id, today(), ""]);
  await refused(() => vehicles.scheduleService(v, {}), "22023", "nothing to schedule");
  const done = await vehicles.completeService(s, v, { performed: "Oil and filter", mileage: String(v.currentMileage + 30), oil: true, materialCost: "88.10",
    laborTime: "1 h", recommendations: "Rotate tires next time" });
  assert.equal(done.maintenance.serviceCompletionDate, today(), "done today (the database's company day)");
  assert.deepEqual([done.vehicle.lastOilChangeDate, done.vehicle.lastOilChangeMileage, done.vehicle.currentMileage], [today(), v.currentMileage + 30, v.currentMileage + 30]);
  assert.deepEqual([done.extraError, done.maintenance.laborTime, done.maintenance.nextServiceRecomendations], [null, "1 h", "Rotate tires next time"]);
  assert.equal(done.costError && done.costError.code, "42501", "a manager without financials: the cost is refused, the service still done");
  assert.equal(e.rows.vehicle_maintenance_costs.find((c) => c.maintenance_id === s.id).material_cost, null, "the database's cost row, unfilled");
  await refused(() => vehicles.completeService(done.maintenance, done.vehicle, { performed: "again" }), "23514", "a done service says so");
  await refused(() => vehicles.completeService(s, v, { performed: "stale" }), "PT409", "the service as shown");
  // a lower odometer reading stays on the service row
  fleet = await vehicles.loadFleet({ costs: false });
  const v2 = fleet.vehicles.find((x) => x.id === v.id);
  const s2 = await vehicles.scheduleService(v2, { requirements: "Wipers" });
  const d2 = await vehicles.completeService(s2, v2, { performed: "Wipers", mileage: "100" });
  assert.equal(d2.maintenance.currentMileage, 100);
  assert.equal(e.rows.vehicles.find((x) => x.id === v.id).current_mileage, v.currentMileage + 30, "the vehicle's mileage did not go back");
  // the demo approver (a manager with financials): the cost is saved, and read back
  await as("approver", e);
  fleet = await vehicles.loadFleet({ costs: true });
  const v3 = fleet.vehicles.find((x) => x.id === v.id);
  const s3 = await vehicles.scheduleService(v3, { requirements: "Brake fluid" });
  const d3 = await vehicles.completeService(s3, v3, { performed: "Flushed", materialCost: "$42.50" });
  assert.deepEqual([d3.costError, d3.maintenance.materialCost], [null, 42.5]);
  const changed = await vehicles.setMaterialCost(d3.maintenance, "45");
  assert.equal(changed.materialCost, 45);
  await refused(() => vehicles.setMaterialCost(d3.maintenance, "50"), "PT409", "a stale cost version");
  // everyone else reads only
  for (const key of ["accountant", "lead", "field", "viewer"]) {
    await as(key, e);
    const f = await vehicles.loadFleet({ costs: false });
    const open = f.maintenance.find((m) => !m.serviceCompletionDate);
    await refused(() => vehicles.scheduleService(f.vehicles[0], { requirements: "x" }), "42501", key + " schedule");
    await refused(() => vehicles.completeService(open, f.vehicles.find((x) => x.id === open.vehicleID), { performed: "x" }), "42501", key + " complete");
    await refused(() => vehicles.updateVehicle(f.vehicles[0], { vehicleDriverInformation: "Someone" }), "42501", key + " edit");
  }
  // the office edits and adds vehicles (never a policy number)
  await as("admin", e);
  const f = await vehicles.loadFleet({ costs: true });
  const ed = await vehicles.updateVehicle(f.vehicles[0], { vehicleDriverInformation: "Alex Juniper", insuranceProvider: "Made-up Mutual", insurancePolicyNumber: "PN-1" });
  assert.equal(ed.vehicleDriverInformation, "Alex Juniper");
  assert.ok(!Object.keys(e.rows.vehicles[0]).some((k) => /polic/i.test(k)), "no such column");
  const nv = await vehicles.addVehicle({ fleetNumber: "T-09", licensePlateNumber: "9xyz999", vehicleYear: "2024", vehicleMake: "Ford" });
  assert.deepEqual([nv.licensePlateNumber, nv.vehicleYear], ["9XYZ999", 2024]);
  await refused(() => vehicles.addVehicle({ vehicleNotes: "nothing else" }), "22023", "a vehicle needs a number, a plate or a make");
});

test("marketing: admin, manager, accountant and view-only read the tasks; the price only with financials (Q17), never in another's answer", { skip }, async () => {
  const engine = await freshEngine();
  const n = engine.rows.marketing_tasks.length;
  for (const key of ["admin", "manager", "approver", "accountant", "viewer", "manager_prices"]) {
    const { e, me } = await as(key, engine);
    const prices = seesPrice(me);
    const got = await marketing.loadMarketing({ prices });
    assert.equal(got.tasks.length, n, key);
    const priced = got.tasks.filter((t) => t.marketingTaskPrice !== null).length;
    if (prices) assert.ok(priced >= 5, key + ": prices");
    else {
      assert.equal(priced, 0, key);
      for (const x of e._log) {
        assert.notEqual(x.table, "marketing_task_prices", key);
        assert.ok(!keysOf(x.rows).has("price") && !/prices/.test(String(x.columns)), key + ": no price column, no embed");
      }
    }
  }
  for (const key of ["lead", "field"]) {
    await as(key, engine);
    assert.equal((await marketing.loadMarketing({ prices: false })).tasks.length, 0, key);
  }
  await as("viewer", engine);
  const asked = await marketing.loadMarketing({ prices: true });
  assert.equal(asked.tasks.filter((t) => t.marketingTaskPrice !== null).length, 0, "even asked for, RLS answers no price");
});

test("marketing: the marks, add / edit / delete with versions, the price with financials only (a refused price leaves the task)", { skip }, async () => {
  const { e } = await as("manager");
  let got = await marketing.loadMarketing({ prices: false });
  const open = got.tasks.find((t) => !t.marketingTaskMarkComplete && !t.marketingTaskCompletedDate);
  const done = await marketing.toggleMark(open, "marketingTaskMarkComplete");
  assert.deepEqual([done.marketingTaskMarkComplete, done.marketingTaskCompletedDate, done.version], [true, today(), open.version + 1], "the database stamps today");
  const undone = await marketing.toggleMark(done, "marketingTaskMarkComplete");
  assert.deepEqual([undone.marketingTaskMarkComplete, undone.marketingTaskCompletedDate], [false, ""], "undone clears it (M5c's trigger)");
  const redone = await marketing.toggleMark(undone, "marketingTaskMarkComplete");
  await refused(() => marketing.toggleMark(open, "marketingTaskCheckInvoiced"), "PT409", "a stale mark");
  const inv = await marketing.toggleMark(redone, "marketingTaskCheckInvoiced");
  assert.equal(inv.marketingTaskCheckInvoiced, true);
  const add = await marketing.addTask({ marketingTaskName: "Banner reprint", marketingTaskCaterogy: "Print", projectID: null }, undefined, today());
  assert.deepEqual([add.task.marketingTaskDate, add.priceError], [today(), null]);
  const withPrice = await marketing.addTask({ marketingTaskName: "Flyers" }, "120", today());
  assert.equal(withPrice.priceError && withPrice.priceError.code, "42501", "a manager without financials: the task is saved, its price refused");
  assert.ok(e.rows.marketing_tasks.some((t) => t.name === "Flyers"));
  assert.equal(e.rows.marketing_task_prices.find((p) => p.task_id === withPrice.task.id).price, null, "the database's price row, unfilled");
  const ed = await marketing.updateTask(add.task, { marketingTaskDescripiton: "3 x 6 ft" });
  assert.equal(ed.task.marketingTaskDescripiton, "3 x 6 ft");
  await refused(() => marketing.updateTask(add.task, { marketingTaskName: "x" }), "PT409", "stale edit");
  await refused(() => marketing.addTask({ marketingTaskName: "" }), "22023", "no name");
  await refused(() => marketing.addTask({ marketingTaskName: "Bad" }, "a lot"), "22023", "a bad price stops the form before anything is sent");
  assert.ok(!e.rows.marketing_tasks.some((t) => t.name === "Bad"));
  // the approver (financials): prices saved and changed at their own version
  await as("approver", e);
  got = await marketing.loadMarketing({ prices: true });
  const flyers = got.tasks.find((t) => t.marketingTaskName === "Flyers");
  const priced = await marketing.updateTask(flyers, {}, "$120");
  assert.deepEqual([priced.priceError, priced.task.marketingTaskPrice], [null, 120]);
  const repriced = await marketing.updateTask(priced.task, {}, "135.5");
  assert.equal(repriced.task.marketingTaskPrice, 135.5);
  const stale = await marketing.updateTask(priced.task, {}, "99");
  assert.equal(stale.priceError && stale.priceError.code, "PT409", "a stale price version");
  const cleared = await marketing.updateTask(repriced.task, {}, "");
  assert.equal(cleared.task.marketingTaskPrice, null, "cleared");
  // read-only roles
  for (const key of ["accountant", "viewer"]) {
    await as(key, e);
    const t = (await marketing.loadMarketing({ prices: key === "accountant" })).tasks[0];
    await refused(() => marketing.toggleMark(t, "marketingTaskCheckPaid"), "42501", key + " mark");
    await refused(() => marketing.addTask({ marketingTaskName: "x" }), "42501", key + " add");
    await refused(() => marketing.deleteTask(t), "42501", key + " delete");
  }
  await as("manager", e);
  const fresh = (await marketing.loadMarketing({ prices: false })).tasks.find((t) => t.marketingTaskName === "Banner reprint");
  assert.equal(await marketing.deleteTask(fresh), true);
  await refused(() => marketing.deleteTask(fresh), "PT404", "gone");
});

test("marketing: an old-portal task the import brought done without its days keeps none - a later mark writes no made-up day (M5c); the page says 'done (date not recorded)' and '—'", { skip }, async () => {
  await as("manager");
  const got = await marketing.loadMarketing({ prices: false });
  const old = got.tasks.find((t) => t.marketingTaskName === "Truck door decals");
  assert.deepEqual([old.marketingTaskMarkComplete, old.marketingTaskCompletedDate, old.marketingTaskDate], [true, "", ""], "the import's unknown days");
  const inv = await marketing.toggleMark(old, "marketingTaskCheckInvoiced");
  assert.deepEqual([inv.marketingTaskCheckInvoiced, inv.marketingTaskMarkComplete, inv.marketingTaskCompletedDate], [true, true, ""], "no made-up day");
  const page = readFileSync(new URL("../site/js/pages/marketing.js", import.meta.url), "utf8");
  assert.ok(page.includes('"done (date not recorded)"') && page.includes('fmtDay(x.marketingTaskDate) : "—"'), "the page's words");
});

test("P5 acceptance check 5: after every list write (convert, services and costs, marks and prices) no activity row carries an amount", { skip }, async () => {
  const { e } = await as("admin");
  const a0 = e.rows.activity.length;
  const list = await leads.loadLeads();
  await leads.convertLead(list.find((l) => !l.leadCreateEstimate), { name: "Check five ADU" });
  const f = await vehicles.loadFleet({ costs: true });
  const open = f.maintenance.find((m) => !m.serviceCompletionDate);
  await vehicles.completeService(open, f.vehicles.find((v) => v.id === open.vehicleID), { performed: "Done", materialCost: "1,234.56", oil: true }, today());
  const m = await marketing.loadMarketing({ prices: true });
  await marketing.updateTask(m.tasks[0], { marketingTaskName: m.tasks[0].marketingTaskName }, "2,500");
  await marketing.toggleMark(m.tasks[1], "marketingTaskCheckPaid", today());
  const added = e.rows.activity.slice(a0);
  assert.equal(added.length, 2, "convert_lead's two lines, nothing else");
  assert.match(added[0].text, /^Project A\d+ created$/);
  assert.equal(added[1].text, "Created from a lead");
  // (the seed's own notes typed by people may quote amounts — those are masked on screen, BLUEPRINT 2.1 principle 8)
  for (const a of added) assert.ok(!AMOUNT.test(String(a.text || "")), "no amount: " + a.text);
});
