// P5c: the office lists' pure helpers — site/js/map/leads.js, map/vehicles.js, map/marketing.js. The rows of M5c mapped
// to the old pages' shapes and back, the old pages' rules (contacted badges, the oil / service / papers due lists,
// Done / Invoiced / Paid and the totals) in company days, and who sees what (UI only; the database decides).
// Fixed days only, so the results are the same in Los Angeles and on a UTC runner. Made-up people and vehicles only.
import test from "node:test";
import assert from "node:assert/strict";

import * as L from "../site/js/map/leads.js";
import * as V from "../site/js/map/vehicles.js";
import * as M from "../site/js/map/marketing.js";
import * as F from "../site/js/map/masked-form.js";
import { maskAmounts } from "../site/js/money-mask.js";

const ROLES = ["admin", "manager", "accountant", "lead", "field", "viewer", "agents"];
const me = (role, extra) => Object.assign({ role, active: true }, extra || {});

/* ── leads ── */
test("leads: who reads and writes (admin, manager, accountant, view-only read; admin and manager write; never a lead or field)", () => {
  assert.deepEqual(ROLES.filter((r) => L.readsLeads(me(r))), ["admin", "manager", "accountant", "viewer"]);
  assert.deepEqual(ROLES.filter((r) => L.writesLeads(me(r))), ["admin", "manager"]);
  assert.equal(L.readsLeads(me("admin", { active: false })), false, "a turned-off account");
  assert.equal(L.readsLeads(null), false);
});

test("leads: a row to the old shape and back (trimmed, empty is NULL, the date a company day, notes as typed)", () => {
  const row = { id: 7, version: 3, client_name: "Rowan Thistlewood", client_phone: "(805) 555-0141", client_address: "120 Juniper Ln",
    project_name: null, category: "ADU", source: "Website", lead_date: "2026-10-18", last_contacted: "2026-10-20", notes: "Line one\nline two",
    converted_project_id: 12, legacy_sp_id: 4 };
  const l = L.toLead(row, { 12: { internalIDNumber: "A306", projectName: "Thistlewood ADU" } });
  assert.deepEqual([l.leadClientName, l.leadProjectName, l.leadDate, l.leadLastcontactedDate, l.leadCreateEstimate, l.projectID, l.convertedProjectId, l.version],
    ["Rowan Thistlewood", "", "2026-10-18", "2026-10-20", true, "A306", 12, 3]);
  assert.equal(L.toLead(Object.assign({}, row, { converted_project_id: null }), {}).leadCreateEstimate, false);
  assert.equal(L.toLead(Object.assign({}, row, { last_contacted: "2026-10-20T07:00:00+00:00" }), {}).leadLastcontactedDate, "2026-10-20", "a stamp read as its day");
  assert.deepEqual(L.toLeadRow({ leadClientName: "  Rowan   T.  ", leadClientPhone: "", leadNotes: "  keep\n  my spacing  \n", leadDate: "2026-10-01", nope: "x" }),
    { client_name: "Rowan T.", client_phone: null, notes: "  keep\n  my spacing", lead_date: "2026-10-01" });
  assert.deepEqual(L.toLeadRow({ leadDate: "not a date", leadNotes: "   " }), { notes: null }, "an empty or bad date box is not sent (NOT NULL)");
  assert.deepEqual(L.toLeadRow({ leadDate: "" }), {});
  assert.deepEqual(L.changedFields(l, { leadClientName: "Rowan Thistlewood ", leadCategory: "Addition", leadProjectName: "" }), { leadCategory: "Addition" },
    "an edit sends only what moved");
  assert.equal(L.checkLead({ leadClientName: " " }), "Client name is required.");
  assert.equal(L.checkLead({ leadClientName: "A", leadDate: "10/12/2026" }), "The lead date is not a date.");
  assert.match(L.checkLead({ leadClientName: "A", leadNotes: "x".repeat(20001) }), /limited to 20,000/, "leads.notes: 20,000 (M5c)");
  assert.equal(L.checkLead({ leadClientName: "A" }), "");
});

test("leads: the contacted badge counts company days (today green; over 14 gold; over 30 red; never red)", () => {
  const b = (d) => L.contactedBadge({ leadLastcontactedDate: d }, "2026-10-21");
  assert.deepEqual(b("2026-10-21"), { cls: "ok", text: "contacted today" });
  assert.deepEqual(b("2026-10-07"), { cls: "ok", text: "contacted 14d ago" });
  assert.deepEqual(b("2026-10-06"), { cls: "warn", text: "contacted 15d ago" });
  assert.deepEqual(b("2026-09-21"), { cls: "warn", text: "contacted 30d ago" });
  assert.deepEqual(b("2026-09-20"), { cls: "over", text: "contacted 31d ago" });
  assert.deepEqual(b(""), { cls: "over", text: "never contacted" });
  assert.equal(L.daysBetween("2026-03-07", "2026-03-09"), 2, "across the spring clock change: two days, not 47 hours");
  assert.equal(L.daysBetween("2026-10-21", "2026-10-20"), -1);
});

test("leads: chips, suggestions, search (every word), Show open / converted / all, the newest lead first", () => {
  const leads = [
    { id: 1, leadClientName: "Rowan", leadCategory: "ADU", leadSource: "Website", leadDate: "2026-10-18", leadLastcontactedDate: "", leadCreateEstimate: false, leadNotes: "permit set" },
    { id: 2, leadClientName: "Marisol", leadCategory: "Deck", leadSource: "Referral", leadDate: "2026-10-09", leadLastcontactedDate: "2026-10-03", leadCreateEstimate: false, leadNotes: "" },
    { id: 3, leadClientName: "Ezra", leadCategory: "", leadSource: "Website", leadDate: "2026-10-18", leadLastcontactedDate: "2026-10-19", leadCreateEstimate: false, leadNotes: "" },
    { id: 4, leadClientName: "Hollis", leadCategory: "ADU", leadSource: "", leadDate: "2026-08-01", leadLastcontactedDate: "", leadCreateEstimate: true, projectID: "A306", leadNotes: "" },
  ];
  assert.deepEqual(L.categories(leads), [{ id: "ADU", n: 2 }, { id: "Deck", n: 1 }, { id: "Uncategorized", n: 1 }]);
  assert.deepEqual(L.suggestions(leads, "leadSource"), ["Referral", "Website"]);
  assert.deepEqual(L.visibleLeads(leads, {}).map((l) => l.id), [3, 1, 2, 4], "newest first; the same day: the latest contact first");
  assert.deepEqual(L.visibleLeads(leads, { show: "open" }).map((l) => l.id), [3, 1, 2]);
  assert.deepEqual(L.visibleLeads(leads, { show: "converted" }).map((l) => l.id), [4]);
  assert.deepEqual(L.visibleLeads(leads, { cat: "Uncategorized" }).map((l) => l.id), [3]);
  assert.deepEqual(L.visibleLeads(leads, { q: "website PERMIT" }).map((l) => l.id), [1], "every word, any case");
  assert.deepEqual(L.visibleLeads(leads, { q: "a306" }).map((l) => l.id), [4], "the converted project's number");
  assert.deepEqual(L.leadsSummary(leads, "2026-10-21"), { open: 3, stale: 2 }, "never contacted and 18 days count; 2 days does not");
});

test("leads: converting — the address split into street and city, the project name, create_project's own keys", () => {
  assert.deepEqual(L.splitAddress("120 Juniper Ln, Pine Hollow, CA 93401"), { address: "120 Juniper Ln", city: "Pine Hollow" });
  assert.deepEqual(L.splitAddress("48 Sage Valley Rd, Sage Valley"), { address: "48 Sage Valley Rd", city: "Sage Valley" });
  assert.deepEqual(L.splitAddress("9 Oak Vista Blvd, Suite B, Oak Vista CA 93422"), { address: "9 Oak Vista Blvd, Suite B", city: "Oak Vista" });
  assert.deepEqual(L.splitAddress("Cedar Flats"), { address: "Cedar Flats", city: "" }, "one part: not split");
  assert.deepEqual(L.splitAddress("12 Elm, 93401"), { address: "12 Elm", city: "" });
  assert.deepEqual(L.splitAddress(""), { address: "", city: "" });
  assert.deepEqual(L.convertDefaults({ leadProjectName: "", leadClientName: "Marisol Quarry", leadClientAddress: "48 Sage Valley Rd, Sage Valley" }),
    { name: "Marisol Quarry Residence", address: "48 Sage Valley Rd", city: "Sage Valley" }, "the old page's naming rule");
  assert.deepEqual(L.projectFields({ name: "  Barn   conversion ", address: "", city: " Cedar Flats " }), { name: "Barn conversion", address: null, city: "Cedar Flats" },
    "an emptied address is sent as NULL, or convert_lead would put the lead's whole address line on the project");
  assert.deepEqual(Object.keys(L.projectFields({ name: "x", address: "y", city: "z", number: "A999", status: "approved" })), ["name", "address", "city"],
    "no number (the database gives it) and nothing else");
  assert.equal(L.telHref("(805) 555-0144 ext 12"), "tel:+18055550144");
  assert.equal(L.telHref("1-805-555-0101"), "tel:+18055550101");
  assert.equal(L.telHref("call the office"), "");
});

/* ── vehicles ── */
test("vehicles: who reads, writes and sees a service's material cost", () => {
  assert.deepEqual(ROLES.filter((r) => V.readsVehicles(me(r))), ["admin", "manager", "accountant", "lead", "field", "viewer"], "everyone but the agents account");
  assert.deepEqual(ROLES.filter((r) => V.writesVehicles(me(r))), ["admin", "manager"]);
  assert.deepEqual(ROLES.filter((r) => V.seesCosts(me(r))), ["admin"], "by role alone only an admin");
  assert.equal(V.seesCosts(me("accountant", { can_see_financials: true })), true);
  assert.equal(V.seesCosts(me("manager", { can_see_financials: true })), true);
  assert.equal(V.seesCosts(me("manager", { can_see_prices: true })), false, "prices are not financials");
});

test("vehicles: company-day months (the end of this month; a month later on the 31st is the shorter month's last day)", () => {
  assert.equal(V.endOfMonth("2026-10-21"), "2026-10-31");
  assert.equal(V.endOfMonth("2028-02-03"), "2028-02-29");
  assert.equal(V.addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(V.addMonths("2026-08-31", 6), "2027-02-28");
  assert.equal(V.addMonths("2026-11-15", 4), "2027-03-15");
  assert.equal(V.addMonths("bad", 4), "");
});

test("vehicles: a row to the old shape and back — never a policy number; plates and VINs in capitals; numbers checked", () => {
  const v = V.toVehicle({ id: 3, version: 2, fleet_number: "T-01", license_plate: "8ABC123", year: 2019, make: "Ford", model: "F-250", vin: "1FT7",
    description: null, driver: "Riley", oil_interval_months: 4, oil_interval_miles: 5000, last_oil_date: "2026-06-03", last_oil_mileage: "61200",
    current_mileage: 64980, registration_due: "2026-12-15", emissions_due: null, dot_due: null, insurance_provider: "Made-up Mutual", notes: null, active: true,
    insurance_policy_number: "SHOULD-NOT-MAP" });
  assert.equal(V.vLabel(v), "T-01 - Lic# 8ABC123 - 2019 Ford F-250", "no description: year, make and model");
  assert.equal(V.vLabel(Object.assign({}, v, { vehicleDescription: "White F-250, ladder rack" })), "T-01 - Lic# 8ABC123 - White F-250, ladder rack");
  assert.equal(v.lastOilChangeMileage, 61200);
  assert.equal(v.vehicleActive, true);
  assert.equal(V.toVehicle({ id: 4, active: false }).vehicleActive, false, "retired");
  assert.ok(!Object.values(v).includes("SHOULD-NOT-MAP") && !Object.keys(V.VEHICLE_COLS).some((k) => /polic/i.test(k + V.VEHICLE_COLS[k])), "no policy number, read or written");
  assert.deepEqual(V.toRow({ licensePlateNumber: " 8abc 123 ", vehicleVIN: "1ft7w", vehicleYear: "2019", currentMileage: "64,980", vehicleNotes: "",
    vehicleActive: false, insurancePolicyNumber: "X" }, V.VEHICLE_COLS),
    { license_plate: "8ABC 123", vin: "1FT7W", year: 2019, current_mileage: 64980, notes: null, active: false });
  assert.throws(() => V.toRow({ vehicleYear: "1850" }, V.VEHICLE_COLS), /between 1,900 and 2,100/);
  assert.throws(() => V.toRow({ currentMileage: "-4" }, V.VEHICLE_COLS), (e) => e.code === "22023");
  assert.throws(() => V.toRow({ oilChangeIntervalMonths: "4.5" }, V.VEHICLE_COLS), (e) => e.code === "22023");
  assert.throws(() => V.toRow({ oilChangeIntervalMonths: "0" }, V.VEHICLE_COLS), /between 1 and 120/, "the database's range (1 .. 120)");
  assert.throws(() => V.toRow({ oilChangeIntervalMiles: "150000" }, V.VEHICLE_COLS), /between 1 and 100,000/);
  assert.throws(() => V.toRow({ lastOilChangeDate: "June 3" }, V.VEHICLE_COLS), /not a date/);
  assert.equal(V.vLabel({ id: 9, fleetNumber: "", licensePlateNumber: "", vehicleDescription: "" }), "Vehicle 9");
});

test("vehicles: a maintenance row's cost — undefined when not asked (no financials), null when hidden or none, the amount otherwise", () => {
  const base = { id: 4, version: 1, vehicle_id: 3, next_service_date: null, next_service_requirements: "Oil change", service_description: null,
    completed_date: "2026-06-03", service_performed: "Oil and filter", mileage: 61200, labor_time: "1 h", recommendations: null };
  assert.equal(V.toMaintenance(base).costs, undefined);
  assert.equal(V.toMaintenance(base).materialCost, null);
  assert.equal(V.toMaintenance(Object.assign({ costs: null }, base)).costs, null);
  const m = V.toMaintenance(Object.assign({ costs: { maintenance_id: 4, material_cost: "96.40", version: 2 } }, base));
  assert.deepEqual([m.materialCost, m.costsVersion, m.vehicleID, m.laborTime, m.servicePerformed], [96.4, 2, 3, "1 h", "Oil and filter"]);
  assert.equal(V.toMaintenance(Object.assign({ costs: { maintenance_id: 4, material_cost: null, version: 1 } }, base)).materialCost, null,
    "the database made the cost row; nobody filled it");
  assert.equal(V.parseCost(""), null);
  assert.equal(V.parseCost("$1,250.505"), 1250.51);
  assert.throws(() => V.parseCost("-3"), (e) => e.code === "22023");
  assert.throws(() => V.parseCost("ten"), (e) => e.code === "22023");
  // numeric(12,2): the largest amount the database keeps, and the first one it would overflow on (22003)
  assert.equal(V.parseCost("9,999,999,999.99"), 9999999999.99);
  assert.throws(() => V.parseCost("10000000000"), (e) => e.code === "22023");
  assert.throws(() => V.parseCost("9999999999.999"), (e) => e.code === "22023", "rounds up to 10,000,000,000.00");
});

test("vehicles: the board — oil due by date (this month) or by miles, services due, papers due, all vehicles; the search", () => {
  const today = "2026-10-21";
  const vs = [
    { id: 1, fleetNumber: "T-01", licensePlateNumber: "A1", vehicleDescription: "Ford", lastOilChangeDate: "2026-06-03", oilChangeIntervalMonths: 4,
      oilChangeIntervalMiles: 5000, lastOilChangeMileage: 61200, currentMileage: 64980, registrationExpirationDate: "2026-12-15" },
    { id: 2, fleetNumber: "T-02", licensePlateNumber: "B2", vehicleDescription: "Chevy", lastOilChangeDate: "2026-08-10", oilChangeIntervalMonths: 6,
      oilChangeIntervalMiles: 5000, lastOilChangeMileage: 102300, currentMileage: 107850, registrationExpirationDate: "2026-10-28", emissionsDueDate: "2026-10-28",
      vehicleDriverInformation: "Jordan Field" },
    { id: 3, fleetNumber: "T-10", licensePlateNumber: "C3", vehicleDescription: "Ram", lastOilChangeDate: "2026-09-20", oilChangeIntervalMonths: 1,
      oilChangeIntervalMiles: null, lastOilChangeMileage: null, currentMileage: null, dOTInspectionDueDate: "2026-09-30" },
    { id: 4, fleetNumber: "TR-1", licensePlateNumber: "", vehicleDescription: "Trailer" },
  ];
  const ms = [
    { id: 10, vehicleID: 2, nextServiceDate: "2026-10-24", nextServiceRequirements: "Brakes", serviceCompletionDate: "" },
    { id: 11, vehicleID: 3, nextServiceDate: "2026-10-17", nextServiceRequirements: "Hinge pins", serviceCompletionDate: "" },
    { id: 12, vehicleID: 3, nextServiceDate: "2026-12-10", nextServiceRequirements: "Timing belt", serviceCompletionDate: "" },
    { id: 13, vehicleID: 1, nextServiceDate: "", nextServiceRequirements: "Mirror", serviceCompletionDate: "" },
    { id: 14, vehicleID: 1, nextServiceDate: "2026-06-01", nextServiceRequirements: "Oil", serviceCompletionDate: "2026-06-03", servicePerformed: "Oil and filter" },
    { id: 15, vehicleID: 1, nextServiceDate: "2026-08-20", serviceCompletionDate: "2026-08-23", servicePerformed: "Tires" },
  ];
  const b = V.board(vs, ms, today, "");
  assert.deepEqual(b.oil.map((x) => [x.v.id, x.due.by, x.due.due, x.due.over]), [[2, "miles", "", true], [1, "date", "2026-10-03", true], [3, "date", "2026-10-20", true]],
    "T-02 past its interval in miles (5,550 since its last change: no date, first), then T-01 (Oct 3) and T-10 by date");
  assert.equal(V.oilDue(vs[1], today).milesLeft, -550);
  assert.equal(V.oilDue(vs[0], "2026-09-15"), null, "next month's change is not due in September");
  assert.deepEqual(b.svc.map((x) => [x.m.id, x.over]), [[11, true], [10, false]], "open, dated this month or earlier; the soonest first");
  assert.deepEqual(b.papers.map((x) => [x.v.id, x.p.what, x.p.over]), [[3, "DOT inspection", true], [2, "Registration", false], [2, "Emissions", false]]);
  assert.deepEqual(b.all.map((x) => [x.v.fleetNumber, x.open]), [["T-01", 1], ["T-02", 1], ["T-10", 2], ["TR-1", 0]], "numbers in order (T-02 before T-10)");
  assert.equal(b.dueCount, 3 + 2 + 3);
  assert.deepEqual(V.board(vs, ms, today, "jordan").all.map((x) => x.v.id), [2], "the driver is searched");
  assert.deepEqual(V.openFor(ms, 3).map((m) => m.id), [11, 12]);
  assert.deepEqual(V.openFor(ms, 1).map((m) => m.id), [13], "undated last");
  assert.deepEqual(V.historyFor(ms, 1).map((m) => m.id), [15, 14], "newest first");
});

test("vehicles: completing a service — rpc complete_vehicle_maintenance's arguments, and the follow-up patch of what it does not take", () => {
  const m = { id: 41, version: 3 };
  const a = V.completion(m, { performed: " Oil and filter ", mileage: "65,010", oil: true, laborTime: " 45 min ", recommendations: "Tires soon " });
  assert.deepEqual(a.args, { p_id: 41, p_version: 3, p_service_performed: " Oil and filter", p_mileage: 65010, p_oil_change: true },
    "the database's names, the version shown, done today by the database (no day sent)");
  assert.deepEqual(a.extra, { labor_time: "45 min", recommendations: "Tires soon" });
  const b = V.completion(m, { performed: "", mileage: "" });
  assert.deepEqual(b.args, { p_id: 41, p_version: 3, p_service_performed: null, p_mileage: null, p_oil_change: false });
  assert.deepEqual(b.extra, {});
  assert.throws(() => V.completion(m, { mileage: "65k" }), (e) => e.code === "22023" && e.field === "mileage");
  assert.throws(() => V.completion(m, { mileage: "20000000" }), (e) => e.code === "22023", "the database's range");
});

/* ── marketing ── */
test("marketing: who reads, writes and sees the price (Q17: the financials switch — not view-only, not a manager by role)", () => {
  assert.deepEqual(ROLES.filter((r) => M.readsMarketing(me(r))), ["admin", "manager", "accountant", "viewer"]);
  assert.deepEqual(ROLES.filter((r) => M.writesMarketing(me(r))), ["admin", "manager"]);
  assert.deepEqual(ROLES.filter((r) => M.seesPrice(me(r))), ["admin"]);
  assert.equal(M.seesPrice(me("accountant", { can_see_financials: true })), true);
  assert.equal(M.seesPrice(me("manager", { can_see_prices: true })), false, "the prices switch is not enough");
  assert.equal(M.seesPrice(me("viewer", { can_see_prices: true })), false);
});

test("marketing: a row with and without its price; the marks (the database stamps Done's day)", () => {
  const row = { id: 5, version: 2, project_id: 9, name: "Drone flyover", category: "Video", description: "Two passes", task_date: "2026-10-19",
    completed_date: null, completed_work: null, done: false, invoiced: false, paid: false };
  const t = M.toTask(row);
  assert.deepEqual([t.prices, t.marketingTaskPrice, t.marketingTaskMarkComplete, t.projectID], [undefined, null, false, 9]);
  const p = M.toTask(Object.assign({ prices: { task_id: 5, price: "450.00", version: 3 } }, row));
  assert.deepEqual([p.marketingTaskPrice, p.priceVersion], [450, 3]);
  assert.equal(M.toTask(Object.assign({ prices: null }, row)).prices, null, "hidden");
  assert.deepEqual(M.togglePatch(t, "marketingTaskMarkComplete"), { done: true }, "the mark only: the database stamps the completed day");
  const doneT = Object.assign({}, t, { marketingTaskMarkComplete: true, marketingTaskCompletedDate: "2026-10-20" });
  assert.deepEqual(M.togglePatch(doneT, "marketingTaskMarkComplete"), { done: false });
  assert.deepEqual(M.togglePatch(t, "marketingTaskCheckPaid"), { paid: true });
  assert.throws(() => M.togglePatch(t, "marketingTaskPrice"), (e) => e.code === "22023", "a price is not a mark");
  assert.deepEqual(M.toTaskRow({ marketingTaskName: "  Signs ", projectID: "", marketingTaskCheckInvoiced: "true", marketingTaskDate: "x", marketingTaskPrice: 5 }),
    { name: "Signs", project_id: null, invoiced: true }, "the price is never in the task row; an empty or bad date is not sent (NOT NULL)");
  assert.equal(M.parsePrice("$1,250"), 1250);
  assert.equal(M.parsePrice(" "), null);
  assert.throws(() => M.parsePrice("about 300"), (e) => e.code === "22023");
  assert.equal(M.checkTask({ marketingTaskName: "" }), "Task name is required.");
});

test("marketing: the chips, the totals over all tasks, the groups (General last), the project box", () => {
  const tasks = [
    { id: 1, marketingTaskName: "Drone", projectID: 9, marketingTaskDate: "2026-10-19", marketingTaskPrice: 450, marketingTaskMarkComplete: false },
    { id: 2, marketingTaskName: "Photos", projectID: 9, marketingTaskDate: "2026-10-12", marketingTaskPrice: 300, marketingTaskMarkComplete: true },
    { id: 3, marketingTaskName: "Time-lapse", projectID: 10, marketingTaskDate: "2026-09-21", marketingTaskPrice: 1200, marketingTaskMarkComplete: true, marketingTaskCheckInvoiced: true },
    { id: 4, marketingTaskName: "Case study", projectID: 11, marketingTaskDate: "2026-08-22", marketingTaskPrice: 650.25, marketingTaskMarkComplete: true, marketingTaskCheckInvoiced: true, marketingTaskCheckPaid: true },
    { id: 5, marketingTaskName: "Yard signs", projectID: null, marketingTaskDate: "2026-10-06", marketingTaskPrice: null, marketingTaskMarkComplete: false },
  ];
  const byId = { 9: { internalIDNumber: "A267", projectName: "Sandbox" }, 10: { internalIDNumber: "A304", projectName: "Kitchen" }, 11: { internalIDNumber: "A1000", projectName: "Big" } };
  assert.deepEqual(M.totals(tasks), { open: 450, uninv: 300, unpaid: 1200, paid: 650.25, priced: 4, unpriced: 1 });
  assert.deepEqual(M.FILTERS.map((f) => tasks.filter((t) => M.passes(t, f[0])).length), [2, 3, 1, 1, 5]);
  const g = M.groups(tasks, { filter: "all", byId });
  assert.deepEqual(g.map((x) => x.label), ["A267 — Sandbox", "A304 — Kitchen", "A1000 — Big", M.GENERAL], "numbers in order; General last");
  assert.deepEqual(g[0].rows.map((t) => t.id), [1, 2], "newest first");
  assert.deepEqual(M.groups(tasks, { filter: "all", byId, q: "kitchen" }).map((x) => x.label), ["A304 — Kitchen"], "the project's name is searched");
  assert.equal(M.projectLabel(99, byId), "Project 99", "a project the person cannot read");
  const projects = [{ id: 9, internalIDNumber: "A267", projectName: "Sandbox" }];
  assert.equal(M.resolveProject("a267", projects), 9);
  assert.equal(M.resolveProject("A267 — Sandbox", projects), 9);
  assert.equal(M.resolveProject("", projects), null);
  assert.equal(M.resolveProject("Somewhere", projects), undefined);
  assert.deepEqual(M.marketingSummary(tasks), { open: 2, uninvoiced: 1 });
});

/* ── edit forms over words people typed (map/masked-form.js) ── */
test("edit forms: words quoting an amount are masked and read-only without prices, and the ORIGINAL words are sent back", () => {
  const plain = (t) => (t == null ? "" : String(t));          // a person with prices: the identity
  const words = "Booth fee and banner. The quote said $1,800 for the booth.";
  assert.deepEqual(F.boxOf(words, plain), { value: words, locked: false }, "with prices: as typed, editable");
  assert.deepEqual(F.boxOf(words, maskAmounts), { value: "Booth fee and banner. The quote said (amount hidden) for the booth.", locked: true });
  assert.deepEqual(F.boxOf("(805) 555-0141 ext. 12", maskAmounts), { value: "(805) 555-0141 ext. 12", locked: false }, "a phone is no amount");
  assert.deepEqual(F.boxOf("", maskAmounts), { value: "", locked: false });
  assert.deepEqual(F.boxOf(null, maskAmounts), { value: "", locked: false });

  // a box as the pages use it (a plain object stands in for the element)
  const box = () => ({ value: "x", disabled: true, title: "old", dataset: {} });
  const b1 = box();
  assert.equal(F.fill(b1, words, maskAmounts), true);
  assert.deepEqual([b1.value, b1.disabled, b1.dataset.masked, b1.title], ["Booth fee and banner. The quote said (amount hidden) for the booth.", true, "1", F.LOCKED_TITLE]);
  b1.value = "(amount hidden) typed over";                    // whatever the box holds now, the record's own words go back
  assert.equal(F.valueOf(b1, words), words);
  assert.equal(F.valueOf(b1, null), "");
  const b2 = box();
  assert.equal(F.fill(b2, "Two passes at 120 ft", maskAmounts), false);
  assert.deepEqual([b2.value, b2.disabled, b2.dataset.masked, b2.title], ["Two passes at 120 ft", false, "", ""], "a reused box is unlocked again");
  b2.value = "Two passes at 150 ft";
  assert.equal(F.valueOf(b2, "Two passes at 120 ft"), "Two passes at 150 ft", "an open box sends what is in it");
  // the writers then leave an unchanged (locked) box out of the patch: nothing masked is ever saved over the words
  const lead = L.toLead({ id: 1, version: 2, client_name: "Hollis Brightwater", notes: words, lead_date: "2026-10-01" }, {});
  assert.deepEqual(L.changedFields(lead, { leadClientName: "Hollis Brightwater", leadNotes: F.valueOf(b1, lead.leadNotes) }), {});
});
