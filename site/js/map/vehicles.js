/* The vehicle board: Desktop 2 rows (M5c 20261027000100_office_lists.sql: `vehicles`, `vehicle_maintenance`,
   `vehicle_maintenance_costs`) <-> the shapes the old vehicles page consumes (BLUEPRINT 3.3.11 "Vehicles", Appendix A
   "vehicles", MODULES §5 "vehicles.html", Q18).

   Only the fields the office used are kept, and never an insurance policy number:
     fleetNumber <- fleet_number      licensePlateNumber <- license_plate      vehicleYear / Make / Model <- year / make / model
     vehicleVIN <- vin                vehicleDescription <- description        vehicleDriverInformation <- driver
     oilChangeIntervalMonths <- oil_interval_months   oilChangeIntervalMiles <- oil_interval_miles
     lastOilChangeDate <- last_oil_date   lastOilChangeMileage <- last_oil_mileage   currentMileage <- current_mileage
     registrationExpirationDate <- registration_due   emissionsDueDate <- emissions_due   dOTInspectionDueDate <- dot_due
     insuranceProvider <- insurance_provider   vehicleNotes <- notes   vehicleActive <- active (a retired vehicle: false)
   Maintenance:
     vehicleID <- vehicle_id   nextServiceDate <- next_service_date   nextServiceRequirements <- next_service_requirements
     serviceDescription <- service_description   nextServiceRecomendations <- recommendations
     serviceCompletionDate <- completed_date   servicePerformed <- service_performed   currentMileage <- mileage
     laborTime <- labor_time (text, as the old list kept it: "1.5 h")
     materialCost <- costs.material_cost (the financials switch: the embed is not even asked for without it; every service
     has its cost row — the database makes it — whose material_cost is NULL until someone with financials fills it)

   The due rules mirror the old board (and Access): an oil change is due when the last one plus its interval in months
   falls on or before the end of THIS month (company time), or when the miles since it reach the interval in miles; a
   service is due when an OPEN maintenance row (no completion date) has its next date on or before the end of this month.
   Registration, emissions and DOT dates are due the same way. A retired vehicle is due nothing. Every date is a company
   day ("YYYY-MM-DD"). Completing a service is the database's one step (rpc complete_vehicle_maintenance: done today in
   company time; an oil change stamps the vehicle; the vehicle's mileage only moves forward).
   Who: everyone signed in reads (not the agents account); admin and manager schedule and complete
   (app.can_edit('vehicles')); a maintenance cost needs the financials switch too. UI only — the database decides.
   Pure module (node tests import it). */

export const VEHICLE_COLS = Object.freeze({
  fleetNumber: "fleet_number", licensePlateNumber: "license_plate", vehicleYear: "year", vehicleMake: "make", vehicleModel: "model",
  vehicleVIN: "vin", vehicleDescription: "description", vehicleDriverInformation: "driver",
  oilChangeIntervalMonths: "oil_interval_months", oilChangeIntervalMiles: "oil_interval_miles",
  lastOilChangeDate: "last_oil_date", lastOilChangeMileage: "last_oil_mileage", currentMileage: "current_mileage",
  registrationExpirationDate: "registration_due", emissionsDueDate: "emissions_due", dOTInspectionDueDate: "dot_due",
  insuranceProvider: "insurance_provider", vehicleNotes: "notes", vehicleActive: "active",
});
export const MAINT_COLS = Object.freeze({
  vehicleID: "vehicle_id", nextServiceDate: "next_service_date", nextServiceRequirements: "next_service_requirements",
  serviceDescription: "service_description", nextServiceRecomendations: "recommendations",
  serviceCompletionDate: "completed_date", servicePerformed: "service_performed", currentMileage: "mileage", laborTime: "labor_time",
});
export const COST_TABLE = "vehicle_maintenance_costs";
export const COST_KEY = "maintenance_id";
export const COST_COL = "material_cost";
export const COMPLETE_RPC = "complete_vehicle_maintenance";

const INTS = new Set(["vehicleYear", "oilChangeIntervalMonths", "oilChangeIntervalMiles", "lastOilChangeMileage", "currentMileage"]);
const DATES = new Set(["lastOilChangeDate", "registrationExpirationDate", "emissionsDueDate", "dOTInspectionDueDate",
  "nextServiceDate", "serviceCompletionDate"]);
const BLOCKS = new Set(["vehicleNotes", "servicePerformed", "nextServiceRequirements", "nextServiceRecomendations", "serviceDescription"]);
const UPPER = new Set(["licensePlateNumber", "vehicleVIN"]);
const LIMITS = { oilChangeIntervalMonths: [1, 120], oilChangeIntervalMiles: [1, 100000], vehicleYear: [1900, 2100],
  lastOilChangeMileage: [0, 10000000], currentMileage: [0, 10000000] };

export const WRITERS = Object.freeze(["admin", "manager"]);
const active = (me) => !!me && me.active !== false && !!me.role && me.role !== "agents";
export function readsVehicles(me) { return active(me); }
export function writesVehicles(me) { return active(me) && WRITERS.indexOf(me.role) !== -1; }
export function seesCosts(me) { return active(me) && (me.role === "admin" || !!me.can_see_financials); }

function txt(v) { return v === null || v === undefined ? "" : String(v); }
function day(v) { const s = txt(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; }
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** A vehicles row -> the old page's shape (vehicleName: "2019 Ford F-250"). */
export function toVehicle(row) {
  if (!row) return null;
  const v = { id: row.id, version: row.version, legacySpId: row.legacy_sp_id === undefined ? null : row.legacy_sp_id };
  Object.keys(VEHICLE_COLS).forEach(function (k) {
    const c = row[VEHICLE_COLS[k]];
    v[k] = k === "vehicleActive" ? c !== false : DATES.has(k) ? day(c) : INTS.has(k) ? num(c) : txt(c);
  });
  v.vehicleName = [v.vehicleYear, v.vehicleMake, v.vehicleModel].filter(Boolean).join(" ");
  return v;
}

/** A vehicle_maintenance row (with its costs embed, or without) -> the old shape. costs: undefined = not asked
    (no financials), null = asked and not readable. */
export function toMaintenance(row) {
  if (!row) return null;
  const m = { id: row.id, version: row.version, legacySpId: row.legacy_sp_id === undefined ? null : row.legacy_sp_id };
  Object.keys(MAINT_COLS).forEach(function (k) {
    const c = row[MAINT_COLS[k]];
    m[k] = DATES.has(k) ? day(c) : INTS.has(k) ? num(c) : txt(c);
  });
  m.vehicleID = row.vehicle_id === undefined ? null : row.vehicle_id;
  const costs = Array.isArray(row.costs) ? row.costs[0] || null : row.costs;
  m.costs = costs === undefined ? undefined : costs || null;
  m.materialCost = costs ? num(costs[COST_COL]) : null;
  m.costsVersion = costs && costs.version !== undefined ? costs.version : null;
  return m;
}

/** {oldKey: text} -> a row patch for `cols` (VEHICLE_COLS or MAINT_COLS): trimmed, "" -> NULL, whole numbers within the
    database's limits for years, intervals and miles, a company day for dates; plates and VINs in capitals; the "in
    service" box as true / false. Throws {code: "22023", field} on a value the database would refuse. */
export function toRow(fields, cols) {
  const out = {};
  Object.keys(fields || {}).forEach(function (k) {
    const col = cols[k];
    if (!col) return;
    const raw = fields[k];
    if (k === "vehicleActive") { out[col] = raw !== false && raw !== "false"; return; }
    if (DATES.has(k)) {
      const d = day(raw);
      if (txt(raw).trim() && !d) throw Object.assign(new Error("That is not a date."), { code: "22023", field: k });
      out[col] = d || null;
      return;
    }
    if (INTS.has(k)) {
      if (!txt(raw).trim()) { out[col] = null; return; }
      const n = num(raw);
      const lim = LIMITS[k] || [0, 10000000];
      if (n === null || !Number.isInteger(n)) {
        throw Object.assign(new Error((k === "vehicleYear" ? "The year" : /Interval/.test(k) ? "An oil interval" : "A mileage") + " must be a whole number."),
          { code: "22023", field: k });
      }
      if (n < lim[0] || n > lim[1]) {
        throw Object.assign(new Error((k === "vehicleYear" ? "The year" : /Months/.test(k) ? "The oil interval in months" : /Miles$/.test(k) && /Interval/.test(k)
          ? "The oil interval in miles" : "A mileage") + " must be between " + lim[0].toLocaleString("en-US") + " and " + lim[1].toLocaleString("en-US") + "."),
          { code: "22023", field: k });
      }
      out[col] = n;
      return;
    }
    let v = BLOCKS.has(k) ? txt(raw).replace(/\s+$/, "") : txt(raw).replace(/\s+/g, " ").trim();
    if (UPPER.has(k)) v = v.toUpperCase();
    out[col] = v.trim() ? v : null;
  });
  return out;
}

/* ── company-day arithmetic ── */
function parts(ymdText) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(ymdText));
  return m ? [+m[1], +m[2], +m[3]] : null;
}
const pad = (n) => String(n).padStart(2, "0");
/** The last day of the month `today` is in. */
export function endOfMonth(today) {
  const p = parts(today);
  if (!p) return "";
  const d = new Date(Date.UTC(p[0], p[1], 0));
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}
/** "2026-01-31" + 1 month -> "2026-02-28" (the month's last day when it is shorter, as a person would count). */
export function addMonths(ymdText, months) {
  const p = parts(ymdText);
  const n = Number(months);
  if (!p || !Number.isFinite(n)) return "";
  const first = new Date(Date.UTC(p[0], p[1] - 1 + Math.trunc(n), 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return first.getUTCFullYear() + "-" + pad(first.getUTCMonth() + 1) + "-" + pad(Math.min(p[2], last));
}

/** "Fleet# - Lic# PLATE - Description" (the old Access label; the description falls back to "2019 Ford F-250");
    "Vehicle <id>" when it has none of them. */
export function vLabel(v) {
  if (!v) return "";
  const out = [];
  if (v.fleetNumber) out.push(String(v.fleetNumber));
  if (v.licensePlateNumber) out.push("Lic# " + v.licensePlateNumber);
  const d = v.vehicleDescription || v.vehicleName;
  if (d) out.push(d);
  return out.join(" - ") || "Vehicle " + v.id;
}

/** The next oil change by date (last + months), or "" when the vehicle has no last date or interval. */
export function nextOilDate(v) {
  if (!v || !v.lastOilChangeDate || !v.oilChangeIntervalMonths) return "";
  return addMonths(v.lastOilChangeDate, v.oilChangeIntervalMonths);
}
/** Miles left before the next oil change by miles (negative when past it), or null when unknown. */
export function oilMilesLeft(v) {
  if (!v || !v.oilChangeIntervalMiles) return null;
  if (v.currentMileage === null || v.currentMileage === undefined || v.lastOilChangeMileage === null || v.lastOilChangeMileage === undefined) return null;
  return v.lastOilChangeMileage + v.oilChangeIntervalMiles - v.currentMileage;
}

/** Is the oil change due? -> null, or {due: date or "", over: bool, by: "date" | "miles", milesLeft} */
export function oilDue(v, today) {
  if (!v || v.vehicleActive === false) return null;
  const next = nextOilDate(v);
  const eom = endOfMonth(today);
  const left = oilMilesLeft(v);
  if (next && eom && next <= eom) return { due: next, over: next < today, by: "date", milesLeft: left };
  if (left !== null && left <= 0) return { due: "", over: true, by: "miles", milesLeft: left };
  return null;
}

export const PAPERS = Object.freeze([
  ["registrationExpirationDate", "Registration"], ["emissionsDueDate", "Emissions"], ["dOTInspectionDueDate", "DOT inspection"],
]);
/** Registration, emissions and DOT dates on or before the end of this month. -> [{key, what, due, over}] */
export function papersDue(v, today) {
  const eom = endOfMonth(today);
  if (!v || v.vehicleActive === false) return [];
  return PAPERS.filter(function (p) { return v[p[0]] && eom && v[p[0]] <= eom; })
    .map(function (p) { return { key: p[0], what: p[1], due: v[p[0]], over: v[p[0]] < today }; });
}

export function isOpen(m) { return !!m && !m.serviceCompletionDate; }
export function serviceText(m) {
  return (m && (m.nextServiceRequirements || m.serviceDescription || m.servicePerformed)) || "Service";
}

// the label, the driver and the insurer as the page shows them (its mask): watching which vehicles stay can't spell out
// an amount hidden from a person without prices
function matches(v, q, mask) {
  const words = txt(q).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const m = typeof mask === "function" ? function (t) { return txt(mask(txt(t))); } : txt;
  const hay = [m(vLabel(v)), v.vehicleName, m(v.vehicleDriverInformation), v.vehicleVIN, m(v.insuranceProvider)].join(" ").toLowerCase();
  return words.every(function (w) { return hay.indexOf(w) !== -1; });
}

/** Everything the board shows, in its order:
    {oil: [{v, due}], svc: [{v, m, over}], papers: [{v, p}], all: [{v, open}], retired, dueCount}
    q: the search words (on the label, the driver, the VIN and the insurer); opts.retired: list retired vehicles too;
    opts.mask: the page's mask (the words are searched as shown). */
export function board(vehicles, maintenance, today, q, opts) {
  const mask = opts && opts.mask;
  const vs = (vehicles || []).filter(function (v) { return matches(v, q, mask); });
  const live = vs.filter(function (v) { return v.vehicleActive !== false; });
  const byId = {};
  (vehicles || []).forEach(function (v) { byId[String(v.id)] = v; });
  const eom = endOfMonth(today);
  const oil = live.map(function (v) { return { v, due: oilDue(v, today) }; }).filter(function (x) { return x.due; })
    .sort(function (a, b) { return (a.due.due || "0000").localeCompare(b.due.due || "0000") || vLabel(a.v).localeCompare(vLabel(b.v)); });
  const svc = (maintenance || []).filter(function (m) {
    const v = byId[String(m.vehicleID)];
    return isOpen(m) && m.nextServiceDate && eom && m.nextServiceDate <= eom && v && v.vehicleActive !== false && matches(v, q, mask);
  }).map(function (m) { return { v: byId[String(m.vehicleID)], m, over: m.nextServiceDate < today }; })
    .sort(function (a, b) { return a.m.nextServiceDate.localeCompare(b.m.nextServiceDate) || Number(a.m.id) - Number(b.m.id); });
  const papers = [];
  live.forEach(function (v) { papersDue(v, today).forEach(function (p) { papers.push({ v, p }); }); });
  papers.sort(function (a, b) { return a.p.due.localeCompare(b.p.due) || vLabel(a.v).localeCompare(vLabel(b.v)); });
  const listed = opts && opts.retired ? vs : live;
  const all = listed.slice().sort(function (a, b) {
    return (a.vehicleActive === false) - (b.vehicleActive === false) || vLabel(a).localeCompare(vLabel(b), "en", { numeric: true });
  }).map(function (v) { return { v, open: openFor(maintenance, v.id).length }; });
  return { oil, svc, papers, all, retired: vs.length - live.length, dueCount: oil.length + svc.length + papers.length };
}

/** The open maintenance of one vehicle, the soonest first (undated last). */
export function openFor(maintenance, vehicleId) {
  return (maintenance || []).filter(function (m) { return isOpen(m) && String(m.vehicleID) === String(vehicleId); })
    .sort(function (a, b) { return (a.nextServiceDate || "9999").localeCompare(b.nextServiceDate || "9999") || Number(a.id) - Number(b.id); });
}
/** The completed services of one vehicle, the newest first, at most `max` (10). */
export function historyFor(maintenance, vehicleId, max) {
  return (maintenance || []).filter(function (m) { return !isOpen(m) && String(m.vehicleID) === String(vehicleId); })
    .sort(function (a, b) { return (b.serviceCompletionDate || "").localeCompare(a.serviceCompletionDate || "") || Number(b.id) - Number(a.id); })
    .slice(0, max || 10);
}

/** The complete-service form -> rpc complete_vehicle_maintenance's arguments (what was done, the mileage, the oil
    change: done today and the vehicle stamped by the database in one step) and the patch of what the RPC does not take
    (the labour time and the next recommendations), written after it at the service's new version. Throws
    {code: "22023", field: "mileage"} for a mileage that is not a whole number of miles. */
export function completion(m, f) {
  const miles = txt(f && f.mileage).replace(/[, ]/g, "").trim();
  let n = null;
  if (miles) {
    n = Number(miles);
    if (!Number.isInteger(n) || n < 0 || n > 10000000) throw Object.assign(new Error("The mileage must be a whole number of miles."), { code: "22023", field: "mileage" });
  }
  const performed = txt(f && f.performed).replace(/\s+$/, "");
  const args = { p_id: m ? m.id : null, p_version: m ? m.version : null, p_service_performed: performed.trim() ? performed : null,
    p_mileage: n, p_oil_change: !!(f && f.oil) };
  const extra = {};
  if (f && txt(f.laborTime).trim()) Object.assign(extra, toRow({ laborTime: f.laborTime }, MAINT_COLS));
  if (f && txt(f.recommendations).trim()) Object.assign(extra, toRow({ nextServiceRecomendations: f.recommendations }, MAINT_COLS));
  return { args, extra };
}

/** A cost typed into the form: "" -> null (no cost), "$1,250.50" -> 1250.5; throws {code: "22023"} for anything else
    or a negative amount. */
export function parseCost(v) {
  const s = txt(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  // numeric(12,2): at most 9,999,999,999.99 (10,000,000,000 would overflow in the database: 22003)
  if (!Number.isFinite(n) || n < 0 || Math.round(n * 100) / 100 >= 1e10) throw Object.assign(new Error("The material cost must be an amount of dollars."), { code: "22023", field: "materialCost" });
  return Math.round(n * 100) / 100;
}

export function fmtMiles(n) { return n === null || n === undefined || n === "" ? "" : Number(n).toLocaleString("en-US") + " mi"; }
export function fmtMoney(n) {
  return n === null || n === undefined ? "" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
