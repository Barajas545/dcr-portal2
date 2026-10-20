// PROJECT-PAGES: the repo modules over the demo database (tools/fake: the made-up data and the rules
// the demo pages run on), as each role — what each one may read and change, versioned moves, the
// write-once project pin, imported projects. Skipped when the demo engine is not there.
import test from "node:test";
import assert from "node:assert/strict";

import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as projects from "../site/js/repo/projects.js";
import * as activity from "../site/js/repo/activity.js";
import * as journal from "../site/js/repo/journal.js";
import * as files from "../site/js/repo/files.js";
import * as search from "../site/js/repo/search.js";
import { clearPeople } from "../site/js/repo/people.js";
import { buildBoard } from "../site/js/pages/board-model.js";
import { logWindow, ymd } from "../site/js/map/pacific.js";

const skip = !available && "the demo engine (tools/fake) is not there";
let engine = null;

async function as(key) {
  if (!engine) engine = await freshEngine();
  const p = await person(key);
  clearPeople();
  projects.forgetProjects();
  files.forgetThumbnails();
  useClient(clientAs(engine, p.id));
  return p;
}

test("demo: ~300 projects, imports untouched and folded, suffix numbers, the sandbox", { skip }, async () => {
  engine = await freshEngine();
  await as("admin");
  const list = await projects.loadProjects();
  assert.ok(list.length >= 280, "about 300 projects, got " + list.length);
  assert.ok(list.some((p) => /^A\d{3}-[A-Z]{1,2}$/.test(p.internalIDNumber)), "suffixed numbers");
  assert.ok(list.some((p) => p.internalIDNumber === "A267"), "the sandbox project");
  const imported = list.filter((p) => p.legacySpId);
  assert.ok(imported.length > 100);
  assert.ok(list.some((p) => p.dormant), "untouched imports");
  const b = buildBoard(list, "main", { today: ymd(new Date()), showOld: false });
  assert.ok(b.oldHidden > 0, "the board folds untouched imports");
  const shown = buildBoard(list, "main", { today: ymd(new Date()), showOld: true });
  assert.ok(shown.shown > b.shown);
});

test("demo: prices — admin reads the rate, a lead and a plain manager get null (hidden)", { skip }, async () => {
  await as("admin");
  const pa = await projects.getProject((await projects.loadProjects()).find((p) => p.internalIDNumber === "A267").id);
  assert.ok(pa.prices && typeof pa.prices === "object");
  await as("lead");
  const pl = await projects.getProject(pa.id);
  assert.equal(pl.prices, null);
  assert.equal(pl.projectLaborRate, null);
  await as("manager");
  assert.equal((await projects.getProject(pa.id)).prices, null, "Q1: managers do not see prices by default");
  await as("manager_prices");
  assert.ok((await projects.getProject(pa.id)).prices, "switched on per person");
});

test("demo: a manager's move is versioned and writes one status line; a stale copy conflicts", { skip }, async () => {
  await as("manager");
  const list = await projects.loadProjects();
  const p = await projects.getProject(list.find((x) => x.internalIDNumber === "A267").id);
  const target = p.status === "in_progress" ? "on_hold" : "in_progress";
  const before = (await activity.forProject(p.id, { limit: 300 })).length;
  const moved = await projects.setStatus(p, target);
  assert.equal(moved.status, target);
  assert.equal(moved.version, p.version + 1);
  const lines = await activity.forProject(p.id, { limit: 300 });
  assert.equal(lines.length, before + 1, "one activity line");
  assert.equal(lines[0].kind, "status");
  assert.match(lines[0].logDescription, /Status:/);
  await assert.rejects(projects.setStatus(p, "sent"), (e) => {
    assert.equal(e.code, "PT409");
    assert.equal(e.current.status, target);
    return true;
  });
});

test("demo: field, lead and viewer cannot move projects (refused, not a conflict)", { skip }, async () => {
  for (const key of ["field", "lead", "viewer"]) {
    await as(key);
    const p = (await projects.loadProjects()).find((x) => x.internalIDNumber === "A267");
    await assert.rejects(projects.setStatus(p, p.status === "sent" ? "approved" : "sent"), (e) => e.code === "42501", key);
  }
});

test("demo: create_project is for admin and manager; the number is the database's", { skip }, async () => {
  await as("field");
  await assert.rejects(projects.createProject({ projectName: "Field try" }), (e) => e.code === "42501");
  await as("manager");
  const p = await projects.createProject({ projectName: "Hillside Test", projectAddress: "1 Test Way", projectCity: "Sandbox" });
  assert.match(p.internalIDNumber, /^A\d{3,}$/);
  assert.equal(p.status, "new_request");
  assert.equal(p.estimateStatus, "Recived");
});

test("demo: log notes — a lead writes, field and viewer are refused; imported authors read '· old portal'", { skip }, async () => {
  await as("lead");
  const p = (await projects.loadProjects()).find((x) => x.internalIDNumber === "A267");
  const l = await activity.addNote(String(p.id), "Framing inspection passed");   // an id from a data- attribute
  assert.equal(l.logUserName, "Riley Lead");
  for (const key of ["field", "viewer"]) {
    await as(key);
    await assert.rejects(activity.addNote(p.id, "nope"), (e) => e.code === "42501", key);
  }
  await as("admin");
  const w = logWindow("month", new Date());
  const month = await activity.inWindow(new Date(Date.now() - 400 * 86400000).toISOString(), w[1]);
  assert.ok(month.length > 0);
  assert.ok(month.every((x) => x.projectNumber), "the projects(number, name) embed");
  const oldOnes = month.filter((x) => x.imported);
  if (oldOnes.length) assert.ok(oldOnes.every((x) => /· old portal$|^Old portal$/.test(x.logUserName)));
});

test("demo: journal — field writes their own entries only (Q4), a viewer none", { skip }, async () => {
  await as("field");
  const p = (await projects.loadProjects()).find((x) => x.internalIDNumber === "A267");
  const mine = await journal.create(p.id, { cat: "progress", title: "Walls up", body: "North and east walls stood" });
  const again = await journal.update(mine, { cat: "progress", title: "Walls up (2)", body: "North and east walls stood" });
  assert.equal(again.title, "Walls up (2)");
  await as("lead");
  const theirs = await journal.create(p.id, { cat: "delivery", title: "Lumber came", body: "" });
  await as("field");
  await assert.rejects(journal.update(theirs, { cat: "delivery", title: "changed by field" }), (e) => e.code === "42501");
  await as("viewer");
  await assert.rejects(journal.create(p.id, { title: "viewer try" }), (e) => e.code === "42501");
  await as("lead");
  const list = await journal.list(p.id);
  assert.ok(list.some((e) => e.title === "Walls up (2)" && e.journalAuthor === "Jordan Field"));
  await journal.remove(list.find((e) => e.id === theirs.id));
  assert.ok(!(await journal.list(p.id)).some((e) => e.id === theirs.id));
});

test("demo: the project pin is write-once (set_project_location)", { skip }, async () => {
  await as("admin");
  const list = await projects.loadProjects();
  const empty = list.find((p) => p.lat == null && !p.dormant) || list.find((p) => p.lat == null);
  await as("field");
  const r1 = await projects.setLocation(empty.id, 35.5, -120.6, 12, "gps");
  assert.deepEqual([r1.stored, r1.reason, r1.location_source], [true, null, "gps"], "an empty pin is filled");
  const r2 = await projects.setLocation(empty.id, 35.6, -120.7, 8, "gps");
  assert.deepEqual([r2.stored, r2.reason], [false, "exists"], "a GPS pin is not overwritten by field");
  // a +-250 m fix is no evidence: the database answers {stored: false, reason: "accuracy"}, not an error
  const r3 = await projects.setLocation(empty.id, 35.5, -120.6, 250, "gps");
  assert.deepEqual([r3.stored, r3.reason], [false, "accuracy"]);
  await as("viewer");
  await assert.rejects(projects.setLocation(empty.id, 35.5, -120.6, 12, "gps"), (e) => e.code === "42501");
});

test("demo: search finds a short project number first; files and pictures sign", { skip }, async () => {
  await as("lead");
  const g = await search.search("A24");
  assert.equal(g[0].label, "Projects");
  assert.match(g[0].items[0].title, /^A024/);
  const list = await projects.loadProjects();
  const withPic = list.filter((p) => p.thumbnailFileId != null).slice(0, 5);
  if (withPic.length) {
    const urls = await files.thumbnailUrls(withPic);
    assert.ok(Object.keys(urls).length > 0, "pictures sign through their files rows");
  }
  const sandbox = list.find((p) => p.internalIDNumber === "A267");
  const items = await files.listCurrent(sandbox.id);
  assert.ok(Array.isArray(items));
});
