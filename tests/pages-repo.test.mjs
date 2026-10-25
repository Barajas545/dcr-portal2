// PROJECT-PAGES: the repository modules (site/js/repo/*.js) over an in-memory stub client
// (tests/pages-stub.mjs): what each call sends, versioned writes and their conflicts, the shapes
// handed to the pages. Made-up sandbox data only (A267 is the sandbox project).
import test from "node:test";
import assert from "node:assert/strict";

import { makeClient } from "./pages-stub.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as projects from "../site/js/repo/projects.js";
import * as activity from "../site/js/repo/activity.js";
import * as journal from "../site/js/repo/journal.js";
import * as files from "../site/js/repo/files.js";
import * as search from "../site/js/repo/search.js";
import { clearPeople } from "../site/js/repo/people.js";

function seed() {
  return {
    profiles: [
      { id: "u-me", full_name: "Morgan Admin", color: "#2f80d8", role: "admin", active: true },
      { id: "u-ana", full_name: "Ana Torres", color: "#2fa679", role: "lead", active: true },
    ],
    projects: [
      { id: 7, number: "A267", name: "Sandbox Residence", status: "approved", status_note: "keep this note", version: 3,
        created_at: "2026-02-03T18:00:00Z", updated_at: "2026-10-01T16:00:00Z", thumbnail_file_id: 31 },
      { id: 8, number: "A087", name: "Imported Remodel", status: "sent", version: 1, legacy_sp_id: 87,
        created_at: "2024-05-01T18:00:00Z", updated_at: "2024-05-01T18:00:00Z" },
      { id: 9, number: "A088", name: "Gone", status: "closed", version: 2, deleted_at: "2026-09-01T00:00:00Z" },
    ],
    project_prices: [{ project_id: 7, labor_rate: 90, rate_source: null, version: 1 }],
    activity: [
      { id: 1, project_id: 7, kind: "note", text: "Called about $1,200 extra", created_by: "u-ana", created_at: "2026-10-19T16:00:00Z" },
      { id: 2, project_id: 7, kind: "status", text: "Status: Sent → Approved", created_by: "u-me", created_at: "2026-10-18T16:00:00Z" },
      { id: 3, project_id: 8, kind: "note", text: "Old line", created_by: null, author_name: "Juan", created_at: "2024-05-02T16:00:00Z" },
    ],
    journal_entries: [
      { id: 20, project_id: 7, entry_date: "2026-10-18", category: "progress", title: "Walls", body: "Stood walls", created_by: "u-ana", version: 1 },
      { id: 21, project_id: 7, entry_date: "2026-10-19", category: "delivery", title: "Lumber", body: null, created_by: "u-me", version: 2 },
    ],
    files: [
      { id: 31, project_id: 7, folder: "thumbnail", name: "thumbnail.jpg", storage: "cloud", storage_path: "p/7/thumbnail/x/thumbnail.jpg", version: 1 },
      { id: 40, project_id: 7, folder: "journal", journal_entry_id: 20, name: "IMG 2026-10-18 09.00.00.jpg", storage: "cloud",
        storage_path: "p/7/journal/y/IMG_2026-10-18_09.00.00.jpg", description: "North wall", mime: "image/jpeg", version: 1, created_at: "2026-10-18T16:00:00Z" },
      { id: 41, project_id: 7, folder: "plans", name: "Set.pdf", storage: "local", rel_path: "A267 - x/Set.pdf", version: 1, created_at: "2026-10-01T16:00:00Z" },
    ],
  };
}

function fresh(handlers) {
  clearPeople();
  projects.forgetProjects();
  files.forgetThumbnails();
  const c = makeClient(seed(), handlers);
  useClient(c);
  return c;
}

test("loadProjects: pages with range(), drops deleted rows, maps to the old shape, shared per page", async () => {
  const c = fresh();
  const list = await projects.loadProjects();
  assert.deepEqual(list.map((p) => p.internalIDNumber), ["A267", "A087"]);
  assert.equal(list[1].dormant, true);
  const sel = c.calls.find((x) => x.table === "projects");
  assert.deepEqual(sel.range, [0, 999]);
  await projects.loadProjects();
  assert.equal(c.calls.filter((x) => x.table === "projects").length, 1, "one shared read");
});

test("getProject: the prices embed is read with the alias", async () => {
  const c = fresh();
  const p = await projects.getProject(7);
  assert.equal(p.projectLaborRate, 90);
  assert.equal(p.prices.version, 1);
  assert.match(c.calls[0].cols, /prices:project_prices\(\*\)/);
  await assert.rejects(projects.getProject(999), (e) => e.code === "PT404");
});

test("setStatus: a versioned PATCH of status only (the note stays), version goes up", async () => {
  const c = fresh();
  const p = await projects.getProject(7);
  const moved = await projects.setStatus(p, "in_progress");
  const upd = c.calls.find((x) => x.op === "update");
  assert.deepEqual(upd.payload, { status: "in_progress" });
  assert.deepEqual(upd.filters, [["eq", "id", 7], ["eq", "version", 3]]);
  assert.equal(moved.status, "in_progress");
  assert.equal(moved.version, 4);
  assert.equal(moved.estimateStatusDescription, "keep this note");
  assert.equal(moved.projectLaborRate, 90, "the price embed survives a move");
});

test("setStatus: someone saved first -> PT409 with the project as it is now", async () => {
  const c = fresh();
  const p = await projects.getProject(7);
  c.tables.projects[0].version = 5;
  c.tables.projects[0].status = "on_hold";
  await assert.rejects(projects.setStatus(p, "sent"), (e) => {
    assert.equal(e.code, "PT409");
    assert.equal(e.current.status, "on_hold");
    assert.equal(e.current.version, 5);
    return true;
  });
  await assert.rejects(projects.setStatus({ id: 999, version: 1 }, "sent"), (e) => e.code === "PT404");
});

test("setStatus: an old spelling is written as the database word", async () => {
  const c = fresh();
  await projects.setStatus({ id: 7, version: 3 }, "Aproved");
  assert.deepEqual(c.calls.find((x) => x.op === "update").payload, { status: "approved" });
});

test("updateProject: row fields versioned, the labor rate on project_prices with its own version", async () => {
  const c = fresh();
  const p = await projects.getProject(7);
  const out = await projects.updateProject(p, { projectName: "Sandbox Residence 2", projectLaborRate: "95" });
  const ups = c.calls.filter((x) => x.op === "update");
  assert.equal(ups[0].table, "projects");
  assert.deepEqual(ups[0].payload, { name: "Sandbox Residence 2" });
  assert.equal(ups[1].table, "project_prices");
  assert.deepEqual(ups[1].payload, { labor_rate: 95, rate_source: "custom" });
  assert.deepEqual(ups[1].filters, [["eq", "project_id", 7], ["eq", "version", 1]]);
  assert.equal(out.projectName, "Sandbox Residence 2");
  assert.equal(out.projectLaborRate, 95);
  assert.equal(out.version, 4);
});

test("updateProject: no price row read (prices hidden) -> a rate change is refused before any write", async () => {
  const c = fresh();
  const p = Object.assign(await projects.getProject(7), { prices: null });
  await assert.rejects(projects.updateProject(p, { projectLaborRate: 99 }), (e) => e.code === "42501");
  assert.equal(c.calls.filter((x) => x.op === "update").length, 0);
});

test("createProject: rpc create_project; the old modal's keys still map to name, address and city (blank ones left out)", async () => {
  const c = fresh({
    create_project: (args, t) => {
      const r = { id: 30, number: "A301", name: args.fields.name, address: args.fields.address, city: args.fields.city, status: "new_request", version: 1 };
      t.projects.push(r);
      return { data: r, error: null };
    },
  });
  const p = await projects.createProject({ projectName: " Hillside ", projectAddress: "1 Test Way", projectCity: "" });
  assert.deepEqual(c.calls[0].args, { fields: { name: "Hillside", address: "1 Test Way" } });
  assert.equal(p.internalIDNumber, "A301");
  assert.equal(p.estimateStatus, "Recived");
  await assert.rejects(projects.createProject({ projectName: "  " }), (e) => e.code === "22023");
});

test("setLocation: the shared-contract argument names", async () => {
  const c = fresh({ set_project_location: () => ({ data: { stored: true }, error: null }) });
  await projects.setLocation(7, 35.1, -120.2, 12.34, "gps");
  assert.deepEqual(c.calls[0], { rpc: "set_project_location", args: { project_id: 7, lat: 35.1, lng: -120.2, accuracy_m: 12.3, source: "gps" } });
});

test("activity: a project's lines newest first with names; the window embeds the project", async () => {
  const c = fresh();
  const mask = (t) => t.replace(/\$[\d,]+/g, "(amount hidden)");
  const lines = await activity.forProject(7, { limit: 30, mask: mask });
  assert.deepEqual(lines.map((l) => l.id), [1, 2]);
  assert.equal(lines[0].logUserName, "Ana Torres");
  assert.equal(lines[0].logDescription, "Called about (amount hidden) extra");
  const q = c.calls.find((x) => x.table === "activity");
  assert.deepEqual(q.range, [0, 29]);
  const win = await activity.inWindow("2024-01-01T00:00:00Z", "2026-12-31T00:00:00Z");
  assert.equal(win.length, 3);
  assert.equal(win[2].logUserName, "Juan · old portal");
  assert.equal(win[0].projectNumber, "A267");
  const wq = c.calls.filter((x) => x.table === "activity")[1];
  assert.match(wq.cols, /projects\(number, name\)/);
  assert.deepEqual(wq.range, [0, 799]);
});

test("activity: addNote inserts a note row (the trigger-only kinds are never sent)", async () => {
  const c = fresh();
  const l = await activity.addNote(7, "  Delivered the trusses  ");
  const ins = c.calls.find((x) => x.op === "insert");
  assert.deepEqual(ins.payload, { project_id: 7, kind: "note", text: "Delivered the trusses" });
  assert.equal(l.logDescription, "Delivered the trusses");
  await assert.rejects(activity.addNote(7, "   "), (e) => e.code === "22023");
});

test("journal: entries newest first with media and authors; create / update / remove", async () => {
  const c = fresh({ soft_delete: (args) => ({ data: null, error: args.version === 2 ? null : { code: "PT409", message: "changed" } }) });
  const list = await journal.list(7);
  assert.deepEqual(list.map((e) => e.id), [21, 20]);
  assert.equal(list[1].media.length, 1);
  assert.equal(list[1].media[0].desc, "North wall");
  assert.equal(list[1].journalAuthor, "Ana Torres");
  const made = await journal.create(7, { cat: "Issue", title: "", body: "Rain\nStopped work" });
  assert.equal(made.category, "issue");
  assert.equal(made.title, "Rain");
  const ins = c.calls.find((x) => x.op === "insert" && x.table === "journal_entries");
  assert.equal(ins.payload.project_id, 7);
  const upd = await journal.update(made, { cat: "Issue", title: "Rain day", body: "Rain" });
  assert.equal(upd.title, "Rain day");
  assert.equal(upd.version, 2);
  await journal.remove({ id: 21, version: 2 });
  assert.deepEqual(c.calls.find((x) => x.rpc === "soft_delete").args, { tbl: "journal_entries", id: 21, version: 2 });
  await assert.rejects(journal.remove({ id: 21, version: 1 }), (e) => e.code === "PT409");
});

test("files: current files mapped; thumbnails signed once per file; documents for 120 s", async () => {
  const c = fresh();
  const items = await files.listCurrent(7);
  assert.equal(items.length, 3);
  const local = items.find((f) => f.name === "Set.pdf");
  assert.equal(local.cloud, false);
  const urls = await files.thumbnailUrls([{ id: 7, thumbnailFileId: 31 }, { id: 8, thumbnailFileId: null }]);
  assert.deepEqual(Object.keys(urls), ["7"]);
  assert.match(urls["7"], /p\/7\/thumbnail\/x\/thumbnail\.jpg\?s=3600$/);
  await files.thumbnailUrls([{ id: 7, thumbnailFileId: 31 }]);
  assert.equal(c.calls.filter((x) => x.signMany).length, 1, "remembered for the page");
  const u = await files.signedUrl("p/7/documents/z/a.pdf");
  assert.match(u, /\?s=120$/);
});

test("files: a caption is a versioned update of description", async () => {
  const c = fresh();
  await files.setCaption({ fileId: 40, version: 1 }, "  South wall ");
  const upd = c.calls.find((x) => x.op === "update");
  assert.deepEqual(upd.payload, { description: "South wall" });
  assert.deepEqual(upd.filters, [["eq", "id", 40], ["eq", "version", 1]]);
});

test("search: under two characters nothing is asked", async () => {
  const c = fresh({ search: (args) => ({ data: { projects: [{ id: 7, number: "A267", name: "Sandbox Residence", status: "approved" }], contacts: [], items: [], tasks: [], files: [] }, error: null }) });
  assert.deepEqual(await search.search("a"), []);
  assert.equal(c.calls.length, 0);
  const g = await search.search("A267");
  assert.equal(g[0].items[0].title, "A267 — Sandbox Residence");
  assert.deepEqual(c.calls[0], { rpc: "search", args: { q: "A267" } });
});
