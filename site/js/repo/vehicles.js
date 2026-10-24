/* The vehicle board (BLUEPRINT 3.3.11 "Vehicles", Q18, Appendix A "vehicles"; migration M5c `vehicles`,
   `vehicle_maintenance`, `vehicle_maintenance_costs`).

   * loadFleet({costs})          every vehicle and every maintenance row (RLS: everyone signed in reads, not the agents
                                 account); with costs (the financials switch) each maintenance row embeds its cost row
                                 ('costs:vehicle_maintenance_costs(*)'). Without the switch the embed is not even asked
                                 for, so no answer carries the cost column;
   * scheduleService(vehicle, f) an INSERT of an open maintenance row (next date, what is needed) — admin, manager;
   * completeService(m, v, f)    rpc complete_vehicle_maintenance(p_id, p_version, p_service_performed, p_mileage,
                                 p_oil_change): the service done today (the company's day), what was done and the
                                 mileage, and — for an oil change — the vehicle's last oil date and mileage, in ONE
                                 database step (the vehicle's mileage only moves forward; a done service says so);
                                 then what the RPC does not take (the labour time, the recommendations) as a versioned
                                 PATCH, and the material cost, with financials, into the service's cost row (the
                                 database makes one with every service); a refused follow-up leaves the service done
                                 and is said;
   * updateMaintenance(m, f)     a versioned PATCH (the next date, what is needed, the recommendations);
   * addVehicle(f) / updateVehicle(v, f)  INSERT / versioned PATCH of the used fields (never a policy number);
   * setMaterialCost(m, value)   the cost row (financials), at its version. */

import { db, must, versioned, pageAll, idOf } from "./_db.js";
import { insertOne, savePrice } from "./_rows.js";
import {
  toVehicle, toMaintenance, toRow, completion, parseCost, VEHICLE_COLS, MAINT_COLS, COST_TABLE, COST_KEY, COST_COL, COMPLETE_RPC,
} from "../map/vehicles.js";

export const TABLES = Object.freeze({ vehicles: "vehicles", maintenance: "vehicle_maintenance", costs: COST_TABLE });
export const COST_EMBED = "*, costs:" + COST_TABLE + "(*)";
export const RPC = Object.freeze({
  complete: { name: COMPLETE_RPC, args: (m, f) => completion(m, f).args },
});

function bad(message) { return Object.assign(new Error(message), { code: "22023", status: 400 }); }

export async function loadFleet(opts) {
  const withCosts = !!(opts && opts.costs);
  const [vs, ms] = await Promise.all([
    pageAll(function (c) { return c.from(TABLES.vehicles).select("*").order("id", { ascending: true }); }),
    pageAll(function (c) { return c.from(TABLES.maintenance).select(withCosts ? COST_EMBED : "*").order("id", { ascending: true }); }),
  ]);
  return { vehicles: vs.map(toVehicle), maintenance: ms.map(toMaintenance) };
}

async function reMaint(row, withCosts) {
  if (!withCosts) return toMaintenance(row);
  const c = await db();
  const rows = must(await c.from(TABLES.maintenance).select(COST_EMBED).eq("id", row.id)) || [];
  return toMaintenance(rows[0] || row);
}

export async function scheduleService(vehicle, f) {
  if (!vehicle || vehicle.id === undefined || vehicle.id === null) throw bad("Pick the vehicle.");
  const row = toRow({ nextServiceDate: f && f.date, nextServiceRequirements: f && f.requirements }, MAINT_COLS);
  if (!row[MAINT_COLS.nextServiceRequirements] && !row[MAINT_COLS.nextServiceDate]) throw bad("Say what the service is, or when it is due.");
  row[MAINT_COLS.vehicleID] = idOf(vehicle.id);
  return toMaintenance(await insertOne(TABLES.maintenance, row));
}

/** f: {performed, mileage, oil, laborTime, recommendations, materialCost (financials only)}.
    -> {maintenance, vehicle (as the database left it), extraError (labour / recommendations refused), costError} */
export async function completeService(m, vehicle, f) {
  const plan = completion(m, f || {});
  const cost = f && f.materialCost !== undefined ? parseCost(f.materialCost) : undefined;
  const c = await db();
  let res;
  try {
    res = must(await c.rpc(COMPLETE_RPC, plan.args));
  } catch (e) {
    if (e && e.code === "PT409") {
      const cur = must(await c.from(TABLES.maintenance).select(m.costs !== undefined ? COST_EMBED : "*").eq("id", idOf(m.id))) || [];
      if (cur.length) e.current = toMaintenance(cur[0]);
    }
    throw e;
  }
  const got = Array.isArray(res) ? res[0] : res;
  let done = toMaintenance(got && got.maintenance);
  const out = { maintenance: done, vehicle: got && got.vehicle ? toVehicle(got.vehicle) : vehicle, extraError: null, costError: null };
  if (Object.keys(plan.extra).length) {
    try { done = toMaintenance(await versioned(TABLES.maintenance, idOf(m.id), done.version, plan.extra)); out.maintenance = done; }
    catch (e) { out.extraError = e; }
  }
  if (cost !== undefined && cost !== null) {
    try { await savePrice(COST_TABLE, COST_KEY, idOf(m.id), COST_COL, cost, m.costsVersion); }
    catch (e) { out.costError = e; }
  }
  if (cost !== undefined || m.costs !== undefined) out.maintenance = await reMaint(done, true).catch(function () { return done; });
  return out;
}

export async function updateMaintenance(m, f) {
  const patch = toRow(f, MAINT_COLS);
  delete patch[MAINT_COLS.vehicleID];
  if (!Object.keys(patch).length) return m;
  try {
    return toMaintenance(await versioned(TABLES.maintenance, idOf(m.id), m.version, patch));
  } catch (e) {
    if (e && e.current) e.current = toMaintenance(e.current);
    throw e;
  }
}

export async function setMaterialCost(m, value) {
  const n = parseCost(value);
  const row = await savePrice(COST_TABLE, COST_KEY, idOf(m.id), COST_COL, n, m.costsVersion);
  return Object.assign({}, m, { costs: row, materialCost: row[COST_COL] === null || row[COST_COL] === undefined ? null : Number(row[COST_COL]), costsVersion: row.version });
}

export async function addVehicle(f) {
  const row = toRow(f, VEHICLE_COLS);
  if (!row[VEHICLE_COLS.fleetNumber] && !row[VEHICLE_COLS.licensePlateNumber] && !row[VEHICLE_COLS.vehicleMake]) {
    throw bad("Give the vehicle a fleet number, a plate or a make.");
  }
  return toVehicle(await insertOne(TABLES.vehicles, row));
}

export async function updateVehicle(v, f) {
  const patch = toRow(f, VEHICLE_COLS);
  // only what moved
  Object.keys(VEHICLE_COLS).forEach(function (k) {
    const col = VEHICLE_COLS[k];
    if (!(col in patch)) return;
    const was = toRow({ [k]: v[k] === null || v[k] === undefined ? "" : v[k] }, VEHICLE_COLS)[col];
    if ((was === undefined ? null : was) === patch[col]) delete patch[col];
  });
  if (!Object.keys(patch).length) return v;
  try {
    return toVehicle(await versioned(TABLES.vehicles, idOf(v.id), v.version, patch));
  } catch (e) {
    if (e && e.current) e.current = toVehicle(e.current);
    throw e;
  }
}
