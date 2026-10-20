// The journal drafts of a device and their entries (site/js/pages/journal-sync.js): offline, the app
// killed, "Finish" with no signal, someone else's change of the same entry. Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { createSync, draftKey, changes, needsSync, draftOfEntry, colsOfRow, closedDraft } from "../site/js/pages/journal-sync.js";

const ME = "u-field-1";
const PID = "268";

/** journal_entries in memory, versioned like t90_audit; repo calls recorded. */
function world(opts) {
  const o = opts || {};
  const rows = new Map();
  let next = 40;
  const calls = [];
  const net = { up: o.online !== false };
  const offline = () => Object.assign(new Error("TypeError: Failed to fetch"), { status: 0 });
  const repo = {
    async createRow(pid, cols) {
      calls.push({ op: "create", pid, cols });
      if (!net.up) throw offline();
      const row = Object.assign({ id: next++, project_id: Number(pid), version: 1 }, cols);
      rows.set(row.id, row);
      return Object.assign({}, row);
    },
    async patchRow(id, version, cols) {
      calls.push({ op: "patch", id, version, cols });
      if (!net.up) throw offline();
      if (o.refuse) throw Object.assign(new Error("permission"), { code: "42501", status: 403 });
      const r = rows.get(Number(id));
      if (!r) throw Object.assign(new Error("gone"), { code: "PT404", status: 404 });
      if (Number(r.version) !== Number(version)) throw Object.assign(new Error("changed"), { code: "PT409", status: 409, current: Object.assign({}, r) });
      if (o.duringPatch) o.duringPatch();
      Object.assign(r, cols, { version: r.version + 1 });
      return Object.assign({}, r);
    },
  };
  const mem = new Map();
  const storage = {
    get: (k) => (mem.has(k) ? mem.get(k) : null),
    set: (k, v) => { if (v == null) mem.delete(k); else mem.set(k, String(v)); },
    keys: () => Array.from(mem.keys()),
  };
  const bound = [];
  const sync = createSync({
    repo, storage, online: () => net.up, lock: (fn) => fn(),
    bindEntry: async (key, id) => { if (o.bindFails) throw new Error("idb"); bound.push([key, id]); },
  });
  const other = (id, patch) => { const r = rows.get(id); Object.assign(r, patch, { version: r.version + 1 }); };
  return { rows, calls, net, storage, sync, bound, other, mem };
}

test("journal draft: written with no signal, kept on the device, created with its photos once there is signal", async () => {
  const w = world({ online: false });
  w.sync.write(ME, PID, { date: "2026-10-19", cat: "progress", title: "Walls up on the north side", body: "", media: [{ qid: "q1", name: "", landed: false }], localKey: "jrn:268:abc" });
  let r = await w.sync.sync(ME, PID);
  assert.equal(r.state, "offline");
  assert.equal(w.sync.read(ME, PID).title, "Walls up on the north side", "nothing is lost");
  w.net.up = true;
  r = await w.sync.sync(ME, PID);
  assert.equal(r.state, "saved");
  assert.equal(r.created, true);
  const d = w.sync.read(ME, PID);
  assert.ok(d.id && d.version === 1 && d.base && d.base.title === "Walls up on the north side");
  assert.deepEqual(w.bound, [["jrn:268:abc", d.id]], "the photos waiting under the local key are released");
  assert.equal(d.bound, true);
  assert.equal(needsSync(d), false);
});

test("journal draft: the app killed with an unsaved entry -> the sweep of another page creates it", async () => {
  const w = world({ online: true });
  // what the Journal tab left behind before the kill (no row yet, a photo waiting for it)
  w.mem.set(draftKey(ME, PID), JSON.stringify({ title: "Rough plumbing inspection passed", body: "Inspector signed the card.", localKey: "jrn:268:k1",
    media: [{ qid: "q9", name: "IMG 2026-10-19 10.00.00.jpg", desc: "", landed: false }] }));
  w.mem.set(draftKey("someone-else", PID), JSON.stringify({ title: "Not mine to send" }));
  const out = await w.sync.sweep(ME);
  assert.equal(out.length, 1);
  assert.equal(out[0].result.state, "saved");
  assert.equal(w.calls.filter((c) => c.op === "create").length, 1, "only this person's drafts");
  assert.equal(w.bound[0][0], "jrn:268:k1");
  assert.deepEqual(await w.sync.sweep(ME), [], "nothing left to do");
});

test("journal draft: Finish with no signal keeps everything and finishes by itself once saved", async () => {
  const w = world({ online: false });
  w.sync.write(ME, PID, { title: "Sheathing done", body: "x", finishing: true, localKey: "jrn:268:f1",
    media: [{ qid: "q1", name: "IMG a.jpg", desc: "East wall", landed: false }] });
  assert.equal((await w.sync.sync(ME, PID)).state, "offline");
  const kept = w.sync.read(ME, PID);
  assert.equal(kept.title, "Sheathing done");
  assert.equal(kept.localKey, "jrn:268:f1", "the photos' key stays until the entry exists");
  assert.equal(kept.finishing, true);
  w.net.up = true;
  const r = await w.sync.sync(ME, PID);
  assert.equal(r.closed, true);
  assert.deepEqual(w.sync.read(ME, PID), { captionsOnly: true, media: [{ qid: "q1", name: "IMG a.jpg", desc: "East wall" }] },
    "closed: only the caption of the photo still on its way stays");
  assert.equal(w.bound.length, 1, "released before closing");
});

test("journal draft: never closed while its photos could not be released", async () => {
  const w = world({ online: true, bindFails: true });
  w.sync.write(ME, PID, { title: "Deck framing", finishing: true, localKey: "jrn:268:z", media: [{ qid: "q1", landed: false }] });
  const r = await w.sync.sync(ME, PID);
  assert.equal(r.state, "saved");
  assert.ok(!r.closed);
  const d = w.sync.read(ME, PID);
  assert.equal(d.localKey, "jrn:268:z");
  assert.ok(needsSync(d), "tried again later");
});

test("journal draft: only the fields this person changed are sent; someone else's correction is kept", async () => {
  const w = world({ online: true });
  w.sync.write(ME, PID, { date: "2026-10-19", cat: "progress", title: "Shear walls", body: "Nailing at 6in edge, 12in field.", wx: "" });
  await w.sync.sync(ME, PID);
  const id = w.sync.read(ME, PID).id;
  // a lead fixes the body from the office
  w.other(id, { body: "Nailing at 4in edge, 12in field (lead: corrected spacing)." });
  // the phone (an old copy) only types the weather
  const d = w.sync.read(ME, PID);
  d.wx = "Clear, 78F";
  w.sync.write(ME, PID, d);
  assert.deepEqual(changes(d), { weather: "Clear, 78F" });
  const r = await w.sync.sync(ME, PID);
  assert.equal(r.state, "saved");
  const row = w.rows.get(id);
  assert.equal(row.body, "Nailing at 4in edge, 12in field (lead: corrected spacing).", "the lead's correction survives");
  assert.equal(row.weather, "Clear, 78F");
  assert.deepEqual(w.calls.filter((c) => c.op === "patch").map((c) => Object.keys(c.cols)), [["weather"], ["weather"]]);
  assert.equal(r.adopted.body, "Nailing at 4in edge, 12in field (lead: corrected spacing).");
  assert.equal(w.sync.read(ME, PID).body, row.body, "the form takes it");
  assert.deepEqual(r.conflicts, {});
});

test("journal draft: both changed the same field -> theirs is kept and this person's text is offered back", async () => {
  const w = world({ online: true });
  w.sync.write(ME, PID, { title: "Trusses", body: "Set 12 trusses." });
  await w.sync.sync(ME, PID);
  const id = w.sync.read(ME, PID).id;
  w.other(id, { body: "Set 14 trusses (office count)." });
  const d = w.sync.read(ME, PID);
  d.body = "Set 13 trusses.";
  w.sync.write(ME, PID, d);
  const r = await w.sync.sync(ME, PID);
  assert.equal(w.rows.get(id).body, "Set 14 trusses (office count).");
  assert.deepEqual(r.conflicts, { body: "Set 13 trusses." });
  const after = w.sync.read(ME, PID);
  assert.equal(after.body, "Set 14 trusses (office count).");
  assert.deepEqual(after.conflicts, { body: "Set 13 trusses." });
  assert.equal(needsSync(after), false, "nothing is sent over theirs until \"Use mine\"");
  // "Use mine"
  after.body = after.conflicts.body; delete after.conflicts.body;
  w.sync.write(ME, PID, after);
  await w.sync.sync(ME, PID);
  assert.equal(w.rows.get(id).body, "Set 13 trusses.");
});

test("journal draft: a newer row from the list is merged before anything is sent", async () => {
  const w = world({ online: true });
  w.sync.write(ME, PID, { title: "Hold-downs", body: "Installed." });
  await w.sync.sync(ME, PID);
  const id = w.sync.read(ME, PID).id;
  w.other(id, { title: "Hold-downs (HDU8)" });
  const r = await w.sync.sync(ME, PID, { current: Object.assign({}, w.rows.get(id)) });
  assert.equal(r.adopted.title, "Hold-downs (HDU8)");
  assert.equal(w.sync.read(ME, PID).title, "Hold-downs (HDU8)");
  assert.equal(w.sync.read(ME, PID).version, w.rows.get(id).version);
  assert.equal(w.calls.filter((c) => c.op === "patch").length, 0);
});

test("journal draft: typing while a save is on its way is never overwritten by it", async () => {
  let w;
  w = world({ online: true, duringPatch: () => { const d = w.sync.read(ME, PID); d.body = "Typed meanwhile"; w.sync.write(ME, PID, d); } });
  w.sync.write(ME, PID, { title: "Blocking", body: "First" });
  await w.sync.sync(ME, PID);
  const d = w.sync.read(ME, PID);
  d.title = "Blocking done";
  w.sync.write(ME, PID, d);
  await w.sync.sync(ME, PID);
  const after = w.sync.read(ME, PID);
  assert.equal(after.body, "Typed meanwhile");
  assert.deepEqual(changes(after), { body: "Typed meanwhile" }, "sent with the next save");
});

test("journal draft: deleted elsewhere -> the text is kept and becomes a new entry; refused drafts are not retried by the sweep", async () => {
  const w = world({ online: true });
  w.sync.write(ME, PID, { title: "Siding", body: "Started." });
  await w.sync.sync(ME, PID);
  const id = w.sync.read(ME, PID).id;
  w.rows.delete(id);
  const d = w.sync.read(ME, PID); d.body = "Started west side."; w.sync.write(ME, PID, d);
  assert.equal((await w.sync.sync(ME, PID)).state, "gone");
  assert.equal(w.sync.read(ME, PID).id, undefined);
  assert.equal(w.sync.read(ME, PID).body, "Started west side.");
  const r = await w.sync.sync(ME, PID);
  assert.equal(r.created, true);

  const v = world({ online: true, refuse: true });
  v.mem.set(draftKey(ME, PID), JSON.stringify(Object.assign(draftOfEntry({ id: 5, version: 1, title: "x", body: "y", entry_date: "2026-10-01" }), { body: "changed" })));
  const s1 = await v.sync.sweep(ME);
  assert.equal(s1[0].result.state, "refused");
  assert.deepEqual(await v.sync.sweep(ME), [], "marked: not retried on every page");
});

test("journal draft helpers: entry and row columns agree; a closed draft keeps only captions", () => {
  const fromList = { id: 3, version: 2, journalDate: "2026-10-18", category: "issue", title: "Rain", journalEntry: "Stopped at noon",
    journalWeather: "Rain", journalCrewSize: 4, journalHours: 3.5, journalFollowUp: true };
  assert.deepEqual(colsOfRow(fromList), { entry_date: "2026-10-18", category: "issue", title: "Rain", body: "Stopped at noon",
    weather: "Rain", crew_size: 4, hours: 3.5, follow_up: true });
  const d = draftOfEntry(fromList);
  assert.deepEqual(changes(d), {}, "an entry opened for editing has nothing to send");
  d.hrs = "3.50";
  assert.deepEqual(changes(d), {}, "3.50 hours is 3.5 hours");
  d.hrs = "4";
  assert.deepEqual(changes(d), { hours: 4 });
  assert.equal(closedDraft({ media: [{ qid: 1, desc: "", landed: false }, { qid: 2, desc: "x", landed: true }] }), null);
});

test("journal draft: captions handed on from an earlier entry survive the next one's close", () => {
  const d = { title: "x", media: [{ qid: "a", name: "IMG 1.jpg", desc: "Mine", landed: false }],
    carried: [{ qid: "b", name: "IMG 0.jpg", desc: "From the last entry" }] };
  assert.deepEqual(closedDraft(d), { captionsOnly: true, media: [{ qid: "a", name: "IMG 1.jpg", desc: "Mine" },
    { qid: "b", name: "IMG 0.jpg", desc: "From the last entry" }] });
});
