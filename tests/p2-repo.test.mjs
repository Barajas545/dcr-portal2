// P2 (timesheets): repo/timesheets.js and repo/employees.js over the DEMO database (tools/fake: the
// rules of migration M2 imitated), as the demo accounts — so the demo pages behave as the real
// database does (tools/schema-check.mjs runs the same modules against the real migrations). Also the
// PDF drawing (timesheet-pdf.js renderSheet) with a stand-in document. Made-up people only.
import test from "node:test";
import assert from "node:assert/strict";
import { available, freshEngine, person, clientAs, loadFake } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as ts from "../site/js/repo/timesheets.js";
import * as emp from "../site/js/repo/employees.js";
import * as map from "../site/js/map/timesheets.js";
import { saturdayOf, addDays, companyToday } from "../site/js/common2.js";
import { renderSheet, renderToBlob, buildEmployeeFile, LIBS } from "../site/js/timesheet-pdf.js";

const skip = !available && "the demo database (tools/fake) is not here";

async function as(engine, key) {
  const p = await person(key);
  useClient(clientAs(engine, p.id));
  return p;
}
const today = companyToday();
const thisSat = saturdayOf(today);
const lastSat = addDays(thisSat, -7);

test("roster(): the demo's scope per role, never phone or address; mine(); the agents account refused", { skip }, async () => {
  const e = await freshEngine();
  const want = { admin: 10, manager: 10, accountant: 10, lead: 6, field: 1, viewer: 1, newhire: 1 };
  for (const [k, n] of Object.entries(want)) {
    await as(e, k);
    const r = await emp.roster();
    assert.equal(r.length, n, k);
    assert.ok(r.every((x) => !("phone" in x) && !("address" in x)), k);
    assert.deepEqual(r.map((x) => x.full_name), r.map((x) => x.full_name).slice().sort((a, b) => a.localeCompare(b)), "by name");
  }
  const lead = await as(e, "lead");
  assert.equal((await emp.mine(lead.id)).full_name, "Riley Lead");
  assert.equal((await emp.roster()).filter((x) => x.is_me).length, 1);
  assert.deepEqual((await emp.crewOf(lead.id)).length, 5);
  const admin = await as(e, "admin");
  assert.equal(await emp.mine(admin.id), null, "the demo admin logs no time of their own");
  await as(e, "agents");
  await assert.rejects(emp.roster(), (x) => x.code === "42501");
});

test("list(): the reading scope over four weeks of demo hours — everyone, crew, self; the embeds", { skip }, async () => {
  const e = await freshEngine();
  const from = addDays(thisSat, -21), to = addDays(thisSat, 6);
  const seen = {};
  for (const k of ["admin", "manager", "accountant", "lead", "field", "viewer"]) {
    await as(e, k);
    const list = await ts.list(from, to);
    seen[k] = new Set(list.map((x) => x.employeeName));
    assert.ok(list.every((x) => x.employeeName && (x.leave || x.projectNumber || x.legacyProject)), k + ": embeds");
  }
  assert.equal(seen.admin.size, 10);
  assert.deepEqual([...seen.accountant].sort(), [...seen.admin].sort(), "Q7: the accountant reads everyone");
  assert.deepEqual([...seen.lead].sort(), ["Alex Juniper", "Blair Sycamore", "Devon Madrone", "Jordan Field", "Pat Newhire", "Riley Lead"]);
  assert.deepEqual([...seen.field], ["Jordan Field"]);
  assert.deepEqual([...seen.viewer], ["Taylor Viewer"]);
  await as(e, "admin");
  const imported = (await ts.list(from, to)).find((x) => x.source === "import");
  assert.ok(imported && imported.projectId === null && imported.legacyProject === "Hillside barn (old portal)", "the unmatched imported row");
});

test("create / update / remove: the writing scope (P2 check 1) and the row rules (check 2) in the demo, as in M2", { skip }, async () => {
  const e = await freshEngine();
  const sandbox = e.rows.projects.find((p) => p.number === "A267").id;
  const id = (name) => e.rows.employees.find((x) => x.full_name === name).id;
  const f = (who, extra) => Object.assign({ employeeId: id(who), date: today, kind: "work", projectId: sandbox, hours: 8, start1: "07:00", end1: "11:00",
    start2: "12:00", end2: "16:00", lunch: 1, work: "Test" }, extra || {});
  await as(e, "lead");
  const crewRow = await ts.create(f("Alex Juniper"));
  assert.deepEqual([crewRow.source, crewRow.calculated, crewRow.start1], ["portal", 8, "07:00"]);
  await assert.rejects(ts.create(f("Emery Chaparral")), (x) => x.code === "42501", "outside the crew");
  await assert.rejects(ts.update(crewRow, f("Emery Chaparral")), (x) => x.code === "42501", "moving a row out of scope (WITH CHECK)");
  const moved = await ts.update(crewRow, f("Blair Sycamore", { hours: 7, end2: "15:00" }));
  assert.deepEqual([moved.employeeName, moved.hours, moved.version], ["Blair Sycamore", 7, 2], "inside the crew it may move");
  await assert.rejects(ts.update(crewRow, f("Blair Sycamore", { hours: 6 })), (x) => x.code === "PT409" && x.current && x.current.hours === 7, "a stale version");
  await as(e, "field");
  await assert.rejects(ts.create(f("Alex Juniper")), (x) => x.code === "42501");
  const own = await ts.create(f("Jordan Field", { kind: "holiday", projectId: sandbox, hours: 8 }));
  assert.deepEqual([own.kind, own.projectId, own.start1], ["holiday", null, ""], "a leave day drops the project and the clock");
  await assert.rejects(ts.create(f("Jordan Field", { projectId: null })), (x) => x.code === "23514", "work without a project");
  await assert.rejects(ts.create(f("Jordan Field", { hours: 0 })), (x) => x.code === "23514", "work with no hours");
  await assert.rejects(ts.create(f("Jordan Field", { hours: 30 })), (x) => x.code === "23514", "over 24");
  await as(e, "accountant");
  await ts.create(f("Casey Accounts"));
  await assert.rejects(ts.create(f("Jordan Field")), (x) => x.code === "42501", "the accountant writes only their own");
  await assert.rejects(ts.remove(own), (x) => x.code === "42501", "...and deletes nobody else's");
  await as(e, "viewer");
  await assert.rejects(ts.create(f("Taylor Viewer")), (x) => x.code === "42501", "a viewer writes nothing");
  await as(e, "field");
  assert.equal(await ts.remove(own), true);
  assert.equal(e.rows.timesheets.some((r) => r.id === own.id), false, "a hard delete");
  assert.equal(await ts.remove(own), true, "gone already counts as done");
});

test("createMany (Batch Entry): one insert per employee, a result per row; one refusal never stops the others", { skip }, async () => {
  const e = await freshEngine();
  const sandbox = e.rows.projects.find((p) => p.number === "A267").id;
  const id = (name) => e.rows.employees.find((x) => x.full_name === name).id;
  await as(e, "lead");
  const forms = ["Alex Juniper", "Emery Chaparral", "Blair Sycamore"].map((n) => ({ employeeId: id(n), date: today, kind: "work", projectId: sandbox, hours: 8 }));
  const seen = [];
  const res = await ts.createMany(forms, (r, i, n) => seen.push(i + "/" + n));
  assert.deepEqual(res.map((r) => r.ok), [true, false, true]);
  assert.equal(res[1].error.code, "42501");
  assert.deepEqual(seen, ["0/3", "1/3", "2/3"]);
});

test("sign-off in the demo: weeks() with the seeded marks (one stale), confirm with the fingerprint, PT409 after a change, withdraw rules; the page's fingerprint = the demo's", { skip }, async () => {
  const e = await freshEngine();
  const id = (name) => e.rows.employees.find((x) => x.full_name === name).id;
  const lead = await as(e, "lead");
  let wk = map.weeksOf(await ts.weeks(lastSat, addDays(lastSat, 6)), lastSat);
  const alex = wk[String(id("Alex Juniper"))];
  assert.deepEqual([alex.confirmed, alex.staleCount, alex.marks[0].name, alex.marks[0].mine], [false, 1, "Riley Lead", true], "Alex's week changed after Riley signed");
  const jordan = wk[String(id("Jordan Field"))];
  assert.deepEqual([jordan.confirmed, jordan.liveCount], [true, 2]);
  const rows = (await ts.list(lastSat, addDays(lastSat, 6))).filter((x) => x.employeeId === id("Alex Juniper"));
  assert.equal(map.fingerprint(rows), alex.fingerprint, "map fingerprint() = the demo's (= M2's formula)");
  await ts.confirm(id("Alex Juniper"), lastSat, alex.fingerprint);
  wk = map.weeksOf(await ts.weeks(lastSat, lastSat), lastSat);
  assert.equal(wk[String(id("Alex Juniper"))].confirmed, true, "re-confirmed: live again");
  await as(e, "manager");
  const one = (await ts.list(lastSat, addDays(lastSat, 6))).find((x) => x.employeeId === id("Alex Juniper") && x.kind === "work");
  await ts.update(one, { employeeId: one.employeeId, date: one.date, kind: "work", projectId: one.projectId, hours: one.hours + 0.5 });
  await as(e, "lead");
  await assert.rejects(ts.confirm(id("Alex Juniper"), lastSat, alex.fingerprint), (x) => x.code === "PT409");
  await assert.rejects(ts.confirm(id("Emery Chaparral"), lastSat, "x-1"), (x) => x.code === "42501", "not in the crew");
  await assert.rejects(ts.confirm(id("Alex Juniper"), addDays(thisSat, 7), "x-1"), (x) => x.code === "22023", "a week that has not started");
  await assert.rejects(ts.confirm(id("Alex Juniper"), addDays(lastSat, 1), "x-1"), (x) => x.code === "22023", "not a Saturday");
  wk = map.weeksOf(await ts.weeks(lastSat, lastSat), lastSat);
  const mgr = wk[String(id("Jordan Field"))].marks.find((x) => !x.mine);
  assert.equal(mgr.canWithdraw, false);
  await assert.rejects(ts.unconfirm(mgr.id), (x) => x.code === "42501", "a lead cannot withdraw the manager's");
  await as(e, "admin");
  await ts.unconfirm(mgr.id);
  for (const k of ["field", "accountant", "viewer"]) {
    await as(e, k);
    await assert.rejects(ts.confirm(id("Jordan Field"), lastSat, jordan.fingerprint), (x) => x.code === "42501", k);
  }
  await as(e, "field");
  const own = map.weeksOf(await ts.weeks(lastSat, lastSat), lastSat);
  assert.deepEqual(Object.keys(own), [String(id("Jordan Field"))], "field sees only their own week");
  void lead;
});

test("sign-off in the demo: a screen behind (rows read before a change it never heard of) confirms with ITS fingerprint -> PT409, though timesheet_weeks was read after the change; a fresh read confirms", { skip }, async () => {
  const e = await freshEngine();
  const id = (name) => e.rows.employees.find((x) => x.full_name === name).id;
  const fri = addDays(lastSat, 6);
  const devon = id("Devon Madrone");
  for (const how of ["hours", "project"]) {
    await as(e, "lead");
    const screen = await ts.list(lastSat, fri);
    await as(e, "manager");
    const row = (await ts.list(lastSat, fri)).find((x) => x.employeeId === devon && x.kind === "work");
    const moved = how === "hours" ? { hours: 12 } : { projectId: e.rows.projects.find((p) => !p.deleted_at && p.id !== row.projectId).id };
    await ts.update(row, Object.assign({ employeeId: row.employeeId, date: row.date, kind: "work", projectId: row.projectId, hours: row.hours }, moved));
    await as(e, "lead");
    const wk = map.weeksOf(await ts.weeks(lastSat, fri), lastSat);
    assert.deepEqual(map.screenBehind(wk, screen, lastSat), [String(devon)], JSON.stringify(moved));
    await assert.rejects(ts.confirm(devon, lastSat, map.weekFingerprint(screen, devon, lastSat)), (x) => x.code === "PT409", JSON.stringify(moved));
    const fresh = await ts.list(lastSat, fri);
    await ts.confirm(devon, lastSat, map.weekFingerprint(fresh, devon, lastSat));
    const mark = map.weeksOf(await ts.weeks(lastSat, fri), lastSat)[String(devon)].marks.find((x) => x.mine);
    await ts.unconfirm(mark.id);
  }
});

test("employees in the demo: mine() never carries the office's notes; former() and get() follow the scope (a turned-off employee's history stays readable by the office)", { skip }, async () => {
  const e = await freshEngine();
  const finley = e.rows.employees.find((x) => x.full_name === "Finley Coyote");
  assert.ok(finley.notes && finley.active === false, "the seed: Finley has left, with an office note");
  const field = await as(e, "field");
  const me = await emp.mine(field.id);
  assert.ok(!("notes" in me) && "phone" in me && "address" in me && "phone_e164" in me, Object.keys(me).join(","));
  for (const [k, names] of Object.entries({ admin: ["Finley Coyote"], manager: ["Finley Coyote"], accountant: ["Finley Coyote"], lead: [], field: [], viewer: [] })) {
    await as(e, k);
    const f = await emp.former();
    assert.deepEqual(f.map((x) => x.full_name), names, k);
    assert.ok(f.every((x) => !("notes" in x) && !("phone" in x)), k);
  }
  await as(e, "admin");
  assert.equal((await emp.get(finley.id)).full_name, "Finley Coyote");
  assert.equal(await emp.get("x"), null);
  await as(e, "lead");
  assert.equal(await emp.get(finley.id), null, "not in Riley's crew");
});

test("employees in the demo: admin and manager add / edit / link; one active name; one employee per account; crews only for leads; update_my_contact", { skip }, async () => {
  const e = await freshEngine();
  await as(e, "manager");
  const n = await emp.createEmployee({ full_name: "Morgan  New", phone: "(805) 555-0177 / fax (805) 555-0178", normal_start1: "07:00", normal_lunch_hours: "0.5" });
  assert.deepEqual([n.full_name, n.phone_e164, n.normal_start1, n.normal_lunch_hours], ["Morgan New", "+18055550177", "07:00:00", 0.5]);
  await assert.rejects(emp.createEmployee({ full_name: "jordan field" }), (x) => x.code === "23505");
  const lead = await person("lead");
  await assert.rejects(emp.linkAccount(n, lead.id), (x) => x.code === "23505", "Riley's account is linked already");
  await assert.rejects(emp.addToCrew((await person("field")).id, n.id), (x) => x.code === "23514", "only a lead has a crew");
  await emp.addToCrew(lead.id, n.id);
  assert.equal(await emp.removeFromCrew(lead.id, n.id), true);
  const off = await emp.setActive(n, false);
  assert.equal(off.active, false);
  await as(e, "lead");
  await assert.rejects(emp.createEmployee({ full_name: "Nope" }), (x) => x.code === "42501");
  const field = await as(e, "field");
  await emp.updateMyContact("805-555-0166", "");
  const me = await emp.mine(field.id);
  assert.deepEqual([me.phone, me.phone_e164, me.address], ["805-555-0166", "+18055550166", null], "a blank clears the address");
  await as(e, "admin");
  await assert.rejects(emp.updateMyContact("x", "y"), (x) => x.code === "PT404", "the demo admin has no employee row");
});

test("timesheet-pdf.js: the sheet is drawn as the paper form (title, job, date, the table with ten rows, work completed, TOTAL DIARIO); pinned libraries with integrity", async () => {
  const calls = [];
  const doc = {
    setFont: (...a) => calls.push(["font", ...a]), setFontSize: (s) => calls.push(["size", s]), setTextColor: () => {},
    text: (t, x, y) => calls.push(["text", t, x, y]), getTextWidth: (t) => t.length * 6, addPage: () => calls.push(["page"]),
    autoTable: (o) => calls.push(["table", o]), output: (kind) => ({ kind, calls }),
  };
  const E = { id: 1, employeeId: 7, employeeName: "Robin Example", date: "2026-10-19", hours: 8, kind: "work", leave: false, dayType: "Worked",
    projectLabel: "A267 — Sandbox", work: "Walls", start1: "07:00", end1: "11:00", start2: "12:00", end2: "16:00" };
  const out = renderToBlob(map.pdfSheets([E, Object.assign({}, E, { id: 2, date: "2026-10-20" })], "week", "2026-10-19"), "DCR", () => doc);
  assert.equal(out.kind, "blob");
  const texts = calls.filter((c) => c[0] === "text").map((c) => c[1]);
  assert.deepEqual(texts.slice(0, 5), ["DCR TIMESHEET", "Job Name / Nombre del trabajo:", "A267 — Sandbox", "Today's date / Fecha:", "Monday, October 19, 2026"]);
  assert.equal(calls.filter((c) => c[0] === "page").length, 1, "two days, two pages");
  const table = calls.find((c) => c[0] === "table")[1];
  assert.deepEqual(table.head, [["Nombre", "Hora de Inicio", "Hora de finalización", "Horas trabajadas"]]);
  assert.equal(table.body.length, 13, "ten rows, the work label, the work, the total");
  assert.deepEqual(table.body[0], ["Robin Example", "7:00 AM", "4:00 PM", "8"]);
  assert.equal(table.body[12][1].content, "8");
  const file = buildEmployeeFile([E], { id: 7, full_name: "Robin Example" }, "day", "2026-10-19", "DCR", () => doc);
  assert.equal(file.name, "Timesheet-Robin-Example-2026-10-19.pdf");
  assert.equal(buildEmployeeFile([E], { id: 8, full_name: "Nobody" }, "day", "2026-10-19", "DCR", () => doc), null);
  assert.deepEqual(LIBS.map((l) => /@\d+\.\d+\.\d+\//.test(l.src) && /^sha384-/.test(l.integrity)), [true, true]);
  void renderSheet;
});

test("the demo seed: made-up people only, crews and sign-offs as described, the imported row", { skip }, async () => {
  const F = await loadFake();
  const s = F.seed({ now: new Date() });
  assert.equal(s.employees.length, 11);
  assert.ok(s.employees.every((x) => !x.email || /@demo\.test$/.test(x.email)));
  assert.ok(s.employees.every((x) => !x.phone || x.phone.split(/\s*\/\s*/).every((ph) => /555[-.\s]01\d\d$/.test(ph))), "555-01xx numbers only");
  assert.equal(s.crew_members.length, 5);
  assert.equal(s.timesheet_confirmations.length, 4);
  assert.equal(s.timesheets.filter((x) => x.source === "import").length, 1);
});
