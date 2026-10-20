// PROJECT-PAGES: the pure mappers (site/js/map/*.js). Made-up sandbox data only.
import test from "node:test";
import assert from "node:assert/strict";

import { STATUS_ORDER, toOldStatus, toNewStatus, statusLabel, isStatus } from "../site/js/map/status.js";
import { toProject, toDbPatch, wireValue, sameValue, parseTags, canonicalTag, coordsText, projectTitle,
  addressLine, switcherLabel, numberSortKey, fieldValue, PROJECT_FIELDS } from "../site/js/map/projects.js";
import { dormant, oldPortalUrl, authorLabel, activityAuthor, legacyId } from "../site/js/map/legacy.js";
import { toLogLine, foldText, cleanNote, groupByProject } from "../site/js/map/activity.js";
import { toEntry, fromDraft, worthKeeping, categoryKey, categoryLabel, isVideo, factsLine } from "../site/js/map/journal.js";
import { listAt, crumbs, toFileItem, fmtSize, folderLabel } from "../site/js/map/files.js";
import { parseCoords, distanceMi, rank, fmtMi, eligible, pinRule, confidentTop, matches } from "../site/js/map/geo.js";
import { toGroups } from "../site/js/map/search.js";

test("status: the nine database words round-trip through the old spellings", () => {
  for (const s of STATUS_ORDER) {
    assert.equal(toNewStatus(toOldStatus(s)), s, s);
    assert.ok(isStatus(s));
  }
  assert.equal(toOldStatus("new_request"), "Recived");
  assert.equal(toOldStatus("approved"), "Aproved");
  assert.equal(toOldStatus("follow_up"), "Follow");
  assert.equal(toNewStatus("In Progress"), "in_progress");
});

test("status: old words with no equivalent follow the import's Q9 answer", () => {
  assert.equal(toNewStatus("Active"), "in_progress");
  assert.equal(toNewStatus("Not Started"), "approved");
  assert.equal(toNewStatus("To Do"), "new_request");
  assert.equal(toNewStatus(""), "new_request");
  assert.equal(toNewStatus("whatever"), "new_request");
  assert.equal(toNewStatus("Follow up"), "follow_up");     // a clean label
});

test("status: labels are Desktop 2's clean words", () => {
  assert.equal(statusLabel("new_request"), "New request");
  assert.equal(statusLabel("in_progress"), "In progress");
  assert.equal(statusLabel(""), "No status");
  assert.equal(statusLabel("some_new_word"), "Some new word");
});

const ROW = {
  id: 7, number: "A267", name: "Sandbox Residence", address: "100 Sample Rd", city: "Paso Robles", state: "CA",
  zip: "93446", status: "approved", status_note: "waiting on plans", client_name: "Pat Example",
  client_phone: "805-555-0100", client_email: "pat@example.test", created_at: "2026-02-03T18:00:00Z",
  updated_at: "2026-10-01T16:00:00Z", completed_date: null, start_date: "2026-03-01", lat: 35.62, lng: -120.69,
  location_source: "gps", tags: ["#adu", "Pergolla", "ADU", "Custom"], scope: "Frame the ADU", plans_url: null,
  version: 4, legacy_sp_id: null, thumbnail_file_id: 31, folder_name: "A267 - 100 Sample Rd - Paso Robles - Sandbox Residence",
};

test("projects: a row maps to the old shape with the new fields kept", () => {
  const p = toProject(ROW);
  assert.equal(p.internalIDNumber, "A267");
  assert.equal(p.projectName, "Sandbox Residence");
  assert.equal(p.estimateStatus, "Aproved");
  assert.equal(p.status, "approved");
  assert.equal(p.statusLabel, "Approved");
  assert.equal(p.estimateStatusDescription, "waiting on plans");
  assert.equal(p.projectDate, ROW.created_at);
  assert.equal(p.projectDateLastModified, ROW.updated_at);
  assert.equal(p.projectCoordinates, "35.620000,-120.690000|gps");
  assert.deepEqual(p.checkTagNames, ["ADU", "Pergola", "Custom"]);
  assert.equal(p.version, 4);
  assert.equal(p.dormant, false);
  assert.equal(p.thumbnailFileId, 31);
  assert.equal(p.prices, undefined, "not read");
  assert.equal(p.projectLaborRate, null);
});

test("projects: the prices embed — null means hidden, an object carries the rate", () => {
  assert.equal(toProject(Object.assign({}, ROW, { prices: null })).prices, null);
  const p = toProject(Object.assign({}, ROW, { prices: { project_id: 7, labor_rate: "95.00", version: 2 } }));
  assert.equal(p.projectLaborRate, "95.00");
  assert.equal(p.prices.version, 2);
  const q = toProject(Object.assign({}, ROW, { prices: [{ project_id: 7, labor_rate: 90, version: 1 }] }));
  assert.equal(q.projectLaborRate, 90);
});

test("projects: an imported point without a source is a geocoded guess; no point -> null", () => {
  assert.equal(coordsText({ lat: 35, lng: -120 }), "35.000000,-120.000000|geocode");
  assert.equal(coordsText({ lat: null, lng: -120 }), null);
});

test("legacy: dormant = imported and still version 1; the old portal link", () => {
  const imp = Object.assign({}, ROW, { legacy_sp_id: 212, version: 1 });
  assert.equal(dormant(imp), true);
  assert.equal(toProject(imp).dormant, true);
  assert.equal(dormant(Object.assign({}, imp, { version: 2 })), false);
  assert.equal(dormant(ROW), false);
  assert.equal(oldPortalUrl(imp), "https://barajas545.github.io/dcr-portal/project.html?id=212");
  assert.equal(oldPortalUrl(ROW), null);
  assert.equal(legacyId({ legacySpId: "87" }), 87);
  assert.equal(legacyId({ legacy_sp_id: -3 }), null);
});

test("projects: writes reverse-map, blank text is null, dates stay calendar dates", () => {
  const patch = toDbPatch({ projectName: "  New name ", projectCity: "", projectStartDate: "2026-04-05",
    projectLaborRate: "92.5", checkTagNames: ["adu", "Deck installation"] });
  assert.deepEqual(patch.row, { name: "New name", city: null, start_date: "2026-04-05", tags: ["ADU", "Deck Installation"] });
  assert.deepEqual(patch.prices, { labor_rate: 92.5 });
  assert.equal(wireValue("projectCompletedDate", "05/04/2026"), null);
  assert.throws(() => toDbPatch({ projectNotes: "x" }), /unknown project field/);
  assert.equal(sameValue("checkTagNames", ["ADU"], ["adu"]), true);
  assert.equal(sameValue("projectLaborRate", "90", 90.0), true);
  assert.equal(sameValue("projectName", " A ", "A"), true);
  assert.equal(fieldValue(toProject(ROW), "projectStartDate"), "2026-03-01");
  assert.ok(PROJECT_FIELDS.every((f) => f.key && f.col && f.label));
});

test("projects: tags, titles, natural number order", () => {
  assert.deepEqual(parseTags("#ADU, #Remodel; #adu"), ["ADU", "Remodel"]);
  assert.equal(canonicalTag(" #work   truck "), "Work Truck");
  const p = toProject(ROW);
  assert.equal(projectTitle(p), "A267 — Sandbox Residence");
  assert.equal(addressLine(p), "100 Sample Rd · Paso Robles");
  assert.match(switcherLabel(p), /A267 — Sandbox Residence · Pat Example · 100 Sample Rd, Paso Robles/);
  const nums = ["A1000", "A024-B", "A99", "A024", "A000T1", "A001", "A000"];
  nums.sort((a, b) => (numberSortKey(a) < numberSortKey(b) ? -1 : 1));
  assert.deepEqual(nums, ["A000", "A000T1", "A001", "A024", "A024-B", "A99", "A1000"]);
});

test("activity: authors — the person, the imported author '· old portal', the database", () => {
  const nameOf = (u) => ({ "u-1": "Ana Torres" }[u] || "");
  const mine = toLogLine({ id: 1, project_id: 7, kind: "note", text: "Called the client", created_by: "u-1", created_at: "2026-10-19T17:00:00Z" }, nameOf);
  assert.equal(mine.logUserName, "Ana Torres");
  assert.equal(mine.imported, false);
  const old = toLogLine({ id: 2, project_id: 7, kind: "note", text: "Sent the estimate", created_by: null, author_name: "Juan", created_at: "2024-05-01T12:00:00Z" }, nameOf);
  assert.equal(old.logUserName, "Juan · old portal");
  assert.equal(old.imported, true);
  assert.equal(old.logDate, "2024-05-01T12:00:00Z");
  const notes = toLogLine({ id: 3, project_id: 7, kind: "note", text: "Notes from the old portal:\nGate code", created_by: null, author_name: "Old portal" }, nameOf);
  assert.equal(notes.logUserName, "Old portal");
  const sys = toLogLine({ id: 4, project_id: 7, kind: "status", text: "Status: Sent → Approved", created_by: null }, nameOf);
  assert.equal(sys.logUserName, "");
  assert.equal(activityAuthor({ created_by: "u-9", author_name: "X" }, nameOf), "", "a person we cannot name is not the old portal");
});

test("activity: the mask is applied on screen; long imported lines fold", () => {
  const mask = (t) => t.replace(/\$\d[\d,]*/g, "(amount hidden)");
  const l = toLogLine({ id: 5, project_id: 7, text: "Quoted $1,250 for the beam", created_by: "u-1" }, () => "Ana", mask);
  assert.equal(l.logDescription, "Quoted (amount hidden) for the beam");
  const long = "word ".repeat(400);
  const f = foldText(long);
  assert.equal(f.more, true);
  assert.ok(f.short.length <= 601);
  assert.equal(foldText("short").more, false);
  assert.equal(cleanNote("  hi \r\n there "), "hi \n there");
  assert.equal(cleanNote("x".repeat(5000)).length, 4000);
  const g = groupByProject([{ projectID: 2 }, { projectID: 1 }, { projectID: 2 }]);
  assert.deepEqual(g.map((x) => [x.pid, x.rows.length]), [["2", 2], ["1", 1]]);
});

test("journal: the draft maps to columns; empty headline takes the first line", () => {
  const row = fromDraft({ date: "2026-10-19", cat: "Change order", wx: " Clear, 78F ", crew: "4", hrs: "7.5",
    title: "", body: "Set the beams on the north wall\nInspector came by", follow: true });
  assert.deepEqual(row, { category: "change_order", title: "Set the beams on the north wall",
    body: "Set the beams on the north wall\nInspector came by", weather: "Clear, 78F", crew_size: 4, hours: 7.5,
    follow_up: true, entry_date: "2026-10-19" });
  const bare = fromDraft({ cat: "nonsense", crew: "-2", hrs: "" });
  assert.equal(bare.category, "progress");
  assert.equal(bare.crew_size, null);
  assert.equal(bare.hours, null);
  assert.equal("entry_date" in bare, false, "the database fills the Pacific day");
  assert.equal(worthKeeping({ body: "ok" }, 0), false);
  assert.equal(worthKeeping({ body: "ok" }, 1), true);
  assert.equal(worthKeeping({ title: "Pour" }, 0), true);
  assert.equal(categoryKey("Change order"), "change_order");
  assert.equal(categoryLabel("change_order"), "Change order");
});

test("journal: an entry carries its media files and its author", () => {
  const files = [
    { id: 50, journal_entry_id: 9, name: "IMG 2026-10-19 10.00.00.jpg", description: "North wall", mime: "image/jpeg", storage_path: "p/7/journal/a/img.jpg", preview_path: "p/7/journal/a/img.preview.jpg", version: 1 },
    { id: 51, journal_entry_id: 9, name: "VID 2026-10-19 10.01.00.mov", mime: "video/quicktime", storage_path: "p/7/journal/b/vid.mov", version: 1 },
    { id: 52, journal_entry_id: 10, name: "other.jpg", mime: "image/jpeg" },
  ];
  const e = toEntry({ id: 9, project_id: 7, entry_date: "2026-10-19", category: "progress", title: "Beams", body: "Set", crew_size: 3, hours: "8.000", follow_up: false, created_by: "u-1", version: 2 }, () => "Ana Torres", files);
  assert.equal(e.journalAuthor, "Ana Torres");
  assert.equal(e.media.length, 2);
  assert.equal(e.media[0].desc, "North wall");
  assert.equal(e.media[1].video, true);
  assert.deepEqual(factsLine(e), ["3 on site", "8 hrs"]);
  assert.equal(isVideo({ name: "clip.MP4" }), true);
});

test("files: the virtual folder tree, date folders newest first", () => {
  const items = [
    { id: 1, folder: "photos", subpath: "2026-10-18", name: "a.jpg", created_at: "2026-10-18T10:00:00Z" },
    { id: 2, folder: "photos", subpath: "2026-10-19", name: "b.jpg", created_at: "2026-10-19T10:00:00Z" },
    { id: 3, folder: "plans", subpath: "", name: "set.pdf", storage: "local", created_at: "2026-10-01T10:00:00Z" },
    { id: 4, folder: "documents", subpath: "Site Notes", name: "NOTE.txt", created_at: "2026-10-19T11:00:00Z" },
    { id: 5, folder: "thumbnail", subpath: "", name: "thumbnail.jpg" },
    { id: 6, folder: "plans", subpath: "Floor Plans/Level 1", name: "l1.pdf", storage: "local" },
  ].map(toFileItem);
  const root = listAt(items, []);
  assert.deepEqual(root.folders.map((f) => [f.key, f.count]), [["plans", 2], ["photos", 2], ["documents", 1]]);
  const photos = listAt(items, ["photos"]);
  assert.deepEqual(photos.folders.map((f) => f.name), ["2026-10-19", "2026-10-18"]);
  const plans = listAt(items, ["plans"]);
  assert.deepEqual(plans.files.map((f) => f.name), ["set.pdf"]);
  assert.equal(plans.files[0].cloud, false);
  assert.deepEqual(listAt(items, ["plans", "floor plans"]).folders.map((f) => f.name), ["Level 1"]);
  assert.deepEqual(crumbs(["photos", "2026-10-19"]).map((c) => c.name), ["Project files", "Photos", "2026-10-19"]);
  assert.equal(fmtSize(2 * 1048576), "2.0 MB");
  assert.equal(folderLabel("plans"), "Floor Plans");
});

test("geo: coordinates, distance, ranking, the spotlight", () => {
  assert.deepEqual(parseCoords("35.5,-120.6|geocode"), { lat: 35.5, lng: -120.6, src: "geocode" });
  assert.equal(parseCoords("200,1"), null);
  const here = { lat: 35.6, lng: -120.7 };
  const near = { id: 1, lat: 35.6005, lng: -120.7005, projectDateLastModified: "2026-01-01" };
  const far = { id: 2, lat: 36.0, lng: -121.0 };
  const none = { id: 3, projectDateLastModified: "2026-09-01" };
  const none2 = { id: 4, projectDateLastModified: "2026-10-01" };
  assert.deepEqual(rank([far, none, near, none2], here).map((p) => p.id), [1, 2, 4, 3]);
  assert.equal(fmtMi(0.05), "you're here");
  assert.equal(fmtMi(2.44), "2.4 mi");
  assert.equal(fmtMi(37.4), "37 mi");
  assert.ok(Math.abs(distanceMi(here, { lat: 36.6, lng: -120.7 }) - 69.1) < 0.5);
  assert.equal(confidentTop([near, far], here, ""), true);
  assert.equal(confidentTop([near, far], here, "smith"), false);
  assert.equal(eligible({ status: "completed" }), false);
  assert.equal(eligible({ status: "in_progress" }), true);
  assert.equal(matches({ projectName: "Sandbox Residence", projectCity: "Paso Robles" }, "paso sand"), true);
});

test("geo: the write-once pin rule mirrors set_project_location", () => {
  assert.equal(pinRule(null, { lat: 35, lng: -120, src: "gps", accuracy: 12 }, "field"), "store");
  assert.equal(pinRule(null, { lat: 35, lng: -120, src: "gps", accuracy: 250 }, "field"), "accuracy");
  assert.equal(pinRule(null, { lat: 35, lng: -120, src: "gps" }, "field"), "accuracy");
  assert.equal(pinRule(null, { lat: 35, lng: -120, src: "gps", accuracy: 0 }, "field"), "accuracy");
  assert.equal(pinRule({ src: "manual" }, { lat: 35, lng: -120, src: "gps", accuracy: 8 }, "admin"), "store");
  assert.equal(pinRule({ src: "manual" }, { lat: 35, lng: -120, src: "gps", accuracy: 8 }, "lead"), "exists");
  assert.equal(pinRule({ src: null }, { lat: 35, lng: -120, src: "gps", accuracy: 8 }, "field"), "store",
    "a point from before Portal 2 counts as a guess");
  assert.equal(pinRule({ src: "gps" }, { lat: 35, lng: -120, src: "geocode" }, "admin"), "exists");
  assert.equal(pinRule({ src: "geocode" }, { lat: 35, lng: -120, src: "gps", accuracy: 8 }, "field"), "store");
  assert.equal(pinRule({ src: "gps" }, { lat: 35, lng: -120, src: "gps", accuracy: 8 }, "field"), "exists");
  assert.equal(pinRule({ src: "gps" }, { lat: 35, lng: -120, src: "gps", accuracy: 8 }, "manager"), "store");
  assert.equal(pinRule({ src: "geocode" }, { lat: 35, lng: -120, src: "geocode" }, "lead"), "exists");
  assert.equal(pinRule(null, { lat: 95, lng: -120, src: "geocode" }, "lead"), "range");
  // an untouched import from the old portal takes no automatic point (it would stop being untouched)
  assert.equal(pinRule(null, { lat: 35, lng: -120, src: "gps", accuracy: 8 }, "field", true), "old_portal");
  assert.equal(pinRule(null, { lat: 35, lng: -120, src: "geocode" }, "admin", true), "old_portal");
  assert.equal(pinRule(null, { lat: 35, lng: -120, src: "manual" }, "manager", true), "store", "placed by hand: a change");
});

test("search: the RPC's lists become the old page's groups", () => {
  const groups = toGroups({
    projects: [{ id: 7, number: "A267", name: "Sandbox Residence", address: "100 Sample Rd", city: "Paso Robles", client_name: "Pat Example", status: "in_progress" }],
    contacts: [{ id: 3, name: "Pat Example", company: "Example Builders", trade: "Framing", email: "pat@example.test", phone: "805-555-0100" }],
    items: [], tasks: [{ id: 1, project_id: 7, title: "Order the beams", status: "open", due_date: "2026-10-22" }],
    files: [{ id: 9, project_id: 7, folder: "photos", name: "IMG.jpg", version_no: 2 }],
  }, { numberOf: (id) => (id === 7 ? "A267" : "") });
  assert.deepEqual(groups.map((g) => g.label), ["Projects", "Contacts", "Tasks", "Files"]);
  assert.equal(groups[0].items[0].title, "A267 — Sandbox Residence");
  assert.match(groups[0].items[0].sub, /In progress/);
  assert.equal(groups[0].items[0].href, "project.html?id=7");
  assert.equal(groups[1].items[0].email, "pat@example.test");
  assert.equal(groups[2].items[0].sub, "A267 · Open · due 2026-10-22");
  assert.equal(groups[3].items[0].href, "project.html?id=7&tab=files");
  assert.equal(groups[3].items[0].sub, "A267 · Photos · v2");
});

test("search: file names and task titles people typed are masked for people without prices (Q28)", async () => {
  const { maskAmounts } = await import("../site/js/money-mask.js");
  const groups = toGroups({
    tasks: [{ id: 1, project_id: 7, title: "Pay the yard $1,240 on Friday", status: "open" }],
    files: [{ id: 9, project_id: 7, folder: "documents", name: "Framing bid $48,500 rev2.pdf", version_no: 1 }],
  }, { mask: maskAmounts });
  assert.equal(groups[0].items[0].title, "Pay the yard (amount hidden) on Friday");
  assert.equal(groups[1].items[0].title, "Framing bid (amount hidden) rev2.pdf");
  const shown = toGroups({ files: [{ id: 9, project_id: 7, folder: "documents", name: "Framing bid $48,500 rev2.pdf" }] });
  assert.equal(shown[0].items[0].title, "Framing bid $48,500 rev2.pdf", "no mask given: as typed");
});
