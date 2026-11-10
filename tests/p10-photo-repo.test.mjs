// The photographer screen program, P3: site/js/repo/photo.js over the demo database (tools/fake/p10-photo.js: the rules of
// DCR Desktop 2 migration 20261110000100_photo_schedule, docs/DATABASE.md §39) as each role - who reads the mirror, who may
// preview / request / cancel / undo, the photo team written only through set_photo_team (a "changed" refusal surfaced, never
// written over), the client key stable per device and per attempt (a retry after a dropped connection is the same request),
// the refusals as typed errors (code, hint, reason, detail), the new -> taken -> applied | refused lifecycle driven by the
// demo's DCR server, the Realtime watch that reads again on every join, a database without the migration. The demo's port
// of THE SHIFT RULE is held to the shared case file (DCR Desktop 2's tools/pglite_check/photo_shift_cases.json) when it is on
// this PC. tools/schema-check-p10-photo.mjs runs the same module against the REAL migration in PGlite. Made-up people only.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { available, loadFake, freshEngine, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as photo from "../site/js/repo/photo.js";
import * as M from "../site/js/map/photo.js";
import { ymd, addDays } from "../site/js/map/pacific.js";

const skip = !available && "the demo database (tools/fake) is not here";
const D2 = path.resolve(process.env.DCR_DESKTOP2_DIR || fileURLToPath(new URL("../../DCR Desktop 2/", import.meta.url)));
const CASES = path.join(D2, "tools", "pglite_check", "photo_shift_cases.json");
let F, E, DEV;
const today = () => ymd(new Date());
async function setup() {
  F = await loadFake();
  E = await freshEngine(new Date());
  DEV = E.exts.find((x) => x.name === "p10-photo").__dev;
  photo.useKeyStore(memoryStore());
}
function memoryStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}
const uid = (key) => F.PEOPLE.find((p) => p.key === key).id;
/** as `key`; every table / rpc asked for and every select's columns recorded; o.drop: the RPC names whose answer is lost
    once (the database did the work, the page hears a dropped connection) */
function as(key, o) {
  const opt = o || {};
  const c = clientAs(E, uid(key));
  const asked = [];
  const drop = new Set(opt.drop || []);
  useClient({
    from: (t) => {
      asked.push(t);
      const q = c.from(t);
      const sel = q.select.bind(q);
      q.select = (cols) => { asked.push(t + ":" + (cols || "*")); return sel(cols); };
      return q;
    },
    rpc: async (n, a) => {
      asked.push("rpc:" + n);
      const r = await c.rpc(n, a);
      if (drop.has(n)) { drop.delete(n); return { data: null, error: { message: "TypeError: Failed to fetch", code: "" }, status: 0 }; }
      return r;
    },
  });
  return asked;
}
async function refused(fn, code, hint) {
  try { await fn(); } catch (e) {
    assert.ok(e instanceof photo.PhotoError, "a PhotoError: " + e.message);
    assert.equal(e.code, code, e.message);
    if (hint !== undefined) assert.equal(e.hint, hint, e.message);
    return e;
  }
  assert.fail("expected " + code + " " + (hint || ""));
}
const planNamed = (s, code) => s.plans.find((p) => p.projectCode === code);
const shootNamed = (s, planId, key) => s.shoots.find((x) => x.planId === planId && x.key === key);

test("who reads: admins and the photo team read the mirror (archived plans only when asked); a lead, a manager, an accountant on no team read nothing; the agents account is refused", { skip }, async () => {
  await setup();
  for (const [k, flags] of [["admin", [true, false, false, true, true]], ["field", [false, true, false, true, true]], ["viewer", [false, false, true, false, true]]]) {
    const asked = as(k);
    const a = await photo.myAccess();
    assert.deepEqual([a.admin, a.photographer, a.marketing, a.canEdit, a.canRead], flags, k);
    const s = await photo.loadSchedule();
    assert.deepEqual(s.plans.map((p) => p.projectCode).sort(), ["A000T6", "A000T8", "A000T9"], k + ": archived hidden");
    assert.ok(s.shoots.length >= 19 && s.shoots.every((x) => s.plans.some((p) => p.id === x.planId)), k + ": the shoots of those plans");
    assert.ok(asked.includes("photo_plans:" + photo.PLAN_COLS) && asked.includes("photo_shoots:" + photo.SHOOT_COLS), k + ": the named columns");
    assert.equal((await photo.loadSchedule({ archived: true })).plans.length, 4, k + ": archived on request");
    assert.equal((await photo.team()).length, 2, k + ": the team");
    const pc = await photo.pcStatus();
    assert.deepEqual([pc.online, pc.paused, Object.keys(pc).sort()], [true, false, ["lastSeen", "minutesAgo", "mirroredAt", "online", "paused"]], k + ": no host name");
  }
  assert.equal((await photo.myAccess()).defaultPhotographer, false);
  as("field");
  assert.equal((await photo.myAccess()).defaultPhotographer, true, "Jordan is the default photographer");
  for (const k of ["lead", "manager", "accountant", "newhire"]) {
    as(k);
    const a = await photo.myAccess();
    assert.deepEqual([a.canRead, a.canEdit, a.ready], [false, false, true], k);
    const s = await photo.loadSchedule({ archived: true });
    assert.deepEqual([s.ready, s.plans.length, s.shoots.length], [true, 0, 0], k + ": nothing");
    assert.deepEqual(await photo.changes({ days: 0 }), [], k + ": no change");
    assert.deepEqual(await photo.team(), [], k + ": no team row");
    const e = await refused(() => photo.pcStatus(), "42501", "forbidden");
    assert.equal(e.reason, "forbidden");
  }
  as("agents");
  await refused(() => photo.myAccess(), "42501", "forbidden");
  assert.equal((await photo.loadSchedule()).plans.length, 0, "the agents account reads no mirror row");
});

test("preview: the database's own answer (ids and names, in-band refusals, resolved args); marketing and others refused; bad shapes as typed errors", { skip }, async () => {
  await setup();
  as("field");
  const s = await photo.loadSchedule();
  const a = planNamed(s, "A000T9");
  const dl = shootNamed(s, a.id, "delivery");
  const to = addDays(dl.plannedDate, 2);
  const pv = await photo.preview(a.id, "move_later", { shoot: "delivery", to });
  assert.deepEqual([pv.plan_id, pv.rev, pv.today, pv.kind, pv.refused], [a.id, a.rev, today(), "move_later", null]);
  assert.deepEqual(pv.moved[0], { key: "delivery", from: dl.plannedDate, to, notes: ["heads_up_sent"], id: dl.id, name: "Delivery day" });
  assert.ok(pv.stays.some((x) => x.key === "drone-check" && x.reason === "fixed") && pv.stays.some((x) => x.key === "house-complete" && x.reason === "undated"));
  const words = M.previewWords(pv, { plan: a, shoots: s.shoots.filter((x) => x.planId === a.id), today: today() });
  assert.deepEqual(words.unknown, []);
  assert.equal(words.moved[0].text, "Delivery day: " + M.dayText(dl.plannedDate, today()) + " → " + M.dayText(to, today()));
  assert.equal((await photo.preview(a.id, "move_one", { shoot: "delivery", to: addDays(today(), -1) })).refused, "past", "in-band");
  assert.equal((await photo.preview(a.id, "move_one", { shoot: "site-walk", to: addDays(today(), 3) })).refused, "not_open");
  const bf = shootNamed(s, a.id, "before-framing");
  const ms = await photo.preview(a.id, "milestone", { shoot: "before-framing", to: addDays(bf.plannedDate, 2), firm: true });
  assert.deepEqual([ms.args.milestone, ms.args.date, "firm" in ms.args, ms.needs_office, ms.replan],
    ["framing_start", addDays(addDays(bf.plannedDate, 2), 2), false, true, ["framing-progress"]], "through a shoot: resolved, a photographer's firm dropped, the office asked");
  as("admin");
  const adm = await photo.preview(a.id, "milestone", { milestone: "framing_start", date: addDays(a.milestones.framing_start.date, 3) });
  assert.deepEqual([adm.args.firm, adm.needs_office], [true, false], "an admin's firm defaults to the job date's current Firm flag");
  as("viewer");
  const e = await refused(() => photo.preview(a.id, "move_one", { shoot: "delivery", to }), "42501", "forbidden");
  assert.equal(M.refusalText(e.reason), "Only an admin or a photographer can change the shoot schedule.");
  as("field");
  const nf = await refused(() => photo.preview(999, "move_one", { shoot: "delivery", to }), "PT404", "no_plan");
  assert.deepEqual(nf.detail, { table: "photo_plans", id: 999 });
  await refused(() => photo.preview(a.id, "skip", { shoot: "delivery" }), "22023", "bad_kind");
  await refused(() => photo.preview(a.id, "move_one", { shoot: "delivery" }), "22023", "bad_args");
  await refused(() => photo.preview(a.id, "move_one", { shoot: "delivery", to, colour: "red" }), "22023", "bad_args");
});

test("request: new -> taken -> applied by the demo's DCR server; the mirror moves with a new rev and the history keeps who and which change; a stale rev is PT409 changed {table, id, rev}", { skip }, async () => {
  await setup();
  as("field");
  let s = await photo.loadSchedule();
  const a = planNamed(s, "A000T9");
  const dc = shootNamed(s, a.id, "drone-check");
  const to = addDays(dc.plannedDate, 1);
  const r = await photo.request(a.id, "move_one", { shoot: "drone-check", to, reason: "Wind" }, a.rev);
  assert.deepEqual([r.status, r.state, r.again, r.needsOffice], ["new", "new", false, false]);
  assert.match(r.key, /^p2[a-z0-9]{12}-[a-z0-9]{10}$/, "the client key");
  assert.deepEqual(photo.openAttempts(), [], "answered: the attempt is settled");
  assert.equal(DEV.pc.step().did, "taken");
  assert.equal((await photo.changes({ open: true })).find((c) => c.id === r.id).state, "taken");
  assert.equal(DEV.pc.step().did, "applied");
  const c = (await photo.myChanges(uid("field"))).find((x) => x.id === r.id);
  assert.deepEqual([c.state, c.result.outcome, c.result.words, c.result.moved.map((m) => [m.key, m.from, m.to])],
    ["applied", "applied", "1 shoot moved", [["drone-check", dc.plannedDate, to]]]);
  assert.equal(M.changeStatusText(c).text, "Applied");
  s = await photo.loadSchedule();
  const after = shootNamed(s, a.id, "drone-check");
  const plan = planNamed(s, "A000T9");
  assert.ok(plan.rev > a.rev, "a new rev");
  assert.deepEqual([after.plannedDate, after.pinDay, after.rev], [to, to, plan.rev], "moved, pinned, its rev");
  assert.deepEqual(after.history.slice(-1).map((h) => [h.from, h.to, h.reason, h.by, h.change, h.manual]), [[dc.plannedDate, to, "Wind", "Jordan", r.id, true]]);
  const e = await refused(() => photo.request(a.id, "move_one", { shoot: "drone-check", to: addDays(to, 1) }, a.rev), "PT409", "changed");
  assert.deepEqual([e.reason, e.detail], ["changed", { table: "photo_shoots", id: dc.id, rev: plan.rev }]);
  assert.equal(M.refusalText(e.reason), "The schedule changed meanwhile - look again.");
  assert.equal(e.retryable, false);
  // the demo's server refuses what it may not do: a refusal reaches the requester with the PC's code
  const r2 = await photo.request(a.id, "move_one", { shoot: "progress-1", to: addDays(shootNamed(s, a.id, "progress-1").plannedDate, 1) }, plan.rev);
  DEV.pc.refuse(r2.id, "changed", "The shoot changed meanwhile - look again");
  const c2 = (await photo.changes()).find((x) => x.id === r2.id);
  assert.deepEqual([c2.state, c2.error.code, M.changeStatusText(c2).text], ["refused", "changed", "Not done: The shoot changed meanwhile - look again."]);
});

test("the client key: the same change asked again after a dropped connection is the SAME request (again: true); a settled attempt starts a new key; another change with a used key is PT409 key_reused", { skip }, async () => {
  await setup();
  as("field", { drop: ["photo_change_request"] });
  const s = await photo.loadSchedule();
  const a = planNamed(s, "A000T9");
  const p1 = shootNamed(s, a.id, "progress-1");
  const args = { shoot: "progress-1", to: addDays(p1.plannedDate, 1) };
  const lost = await refused(() => photo.request(a.id, "move_one", args, a.rev), "");
  assert.deepEqual([lost.retryable, lost.reason], [true, "offline"], "no answer: send it again");
  assert.deepEqual(photo.openAttempts().map((x) => x.key), [lost.key], "the attempt waits on this device");
  const again = await photo.request(a.id, "move_one", { to: args.to, shoot: "progress-1" }, a.rev);
  assert.deepEqual([again.again, again.key, again.status], [true, lost.key, "new"], "the database answers the row it has");
  assert.equal(E.rows.photo_changes.filter((c) => c.plan_id === a.id && c.target_key === "progress-1").length, 1, "ONE change");
  assert.deepEqual(photo.openAttempts(), []);
  const pend = await refused(() => photo.request(a.id, "move_one", args, a.rev), "PT409", "pending");
  assert.deepEqual(pend.detail, { id: again.id }, "a new attempt (a new key): the change already waiting");
  const reused = await refused(() => photo.request(a.id, "move_one", { shoot: "progress-2", to: addDays(p1.plannedDate, 9) }, a.rev, { key: lost.key }), "PT409", "key_reused");
  assert.deepEqual(reused.detail, { table: "photo_changes", id: again.id });
  // the key: this device's id + a random part; the same fingerprint (argument order aside) keeps its key until settled
  const k1 = photo.attemptKey(a.id, "move_one", { shoot: "x", to: "2026-12-01" }, 5);
  assert.equal(photo.attemptKey(a.id, "move_one", { to: "2026-12-01", shoot: "x" }, 5), k1);
  assert.notEqual(photo.attemptKey(a.id, "move_one", { shoot: "x", to: "2026-12-01" }, 6), k1, "another rev: another attempt");
  assert.equal(k1.slice(2, 14), photo.deviceId(), "the device's id");
  photo.settleAttempt(a.id, "move_one", { shoot: "x", to: "2026-12-01" }, 5);
  assert.notEqual(photo.attemptKey(a.id, "move_one", { shoot: "x", to: "2026-12-01" }, 5), k1, "settled: a new key");
  // a blocked storage still works (the page's memory)
  photo.useKeyStore({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
  const k2 = photo.attemptKey(a.id, "done", { shoot: "y" }, 5);
  assert.match(k2, /^[A-Za-z0-9_-]{8,64}$/);
  assert.equal(photo.attemptKey(a.id, "done", { shoot: "y" }, 5), k2);
});

test("the request's refusals in the contract's order, as typed errors the page switches on (past, no_change, not_open, undated, plan_not_active, bad_rev, no_shoot, bad_key, too_many)", { skip }, async () => {
  await setup();
  as("field");
  const s = await photo.loadSchedule();
  const a = planNamed(s, "A000T9");
  const d = planNamed(s, "A000T6");
  const dl = shootNamed(s, a.id, "delivery");
  for (const [kind, args, hint] of [["move_one", { shoot: "delivery", to: addDays(today(), -1) }, "past"],
    ["move_one", { shoot: "delivery", to: addDays(today(), 400) }, "too_far"],
    ["move_one", { shoot: "delivery", to: dl.plannedDate }, "no_change"],
    ["move_one", { shoot: "site-walk", to: addDays(today(), 3) }, "not_open"],
    ["move_later", { shoot: "house-complete", to: addDays(today(), 60) }, "undated"],
    ["milestone", { milestone: "roof_on", date: addDays(today(), 3) }, "bad_milestone"],
    ["done", { shoot: "site-walk" }, "not_open"]]) {
    const e = await refused(() => photo.request(a.id, kind, args, a.rev), "22023", hint);
    assert.notEqual(M.refusalText(e.reason), "The shoot schedule cannot make that change.", hint);
  }
  await refused(() => photo.request(d.id, "move_one", { shoot: "delivery", to: addDays(today(), 30) }, d.rev), "22023", "plan_not_active");
  for (const rev of [null, 0, a.rev + 1000]) await refused(() => photo.request(a.id, "move_one", { shoot: "delivery", to: addDays(dl.plannedDate, 1) }, rev), "22023", "bad_rev");
  const ns = await refused(() => photo.request(a.id, "move_one", { shoot: "nope", to: addDays(today(), 3) }, a.rev), "PT404", "no_shoot");
  assert.deepEqual(ns.detail, { table: "photo_shoots", plan_id: a.id, key: "nope" });
  await refused(() => photo.request(a.id, "move_one", { shoot: "delivery", to: addDays(dl.plannedDate, 1) }, a.rev, { key: "short" }), "22023", "bad_key");
  assert.equal(E.rows.photo_changes.filter((c) => c.plan_id === a.id).length, 0, "nothing written by a refusal");
  // 20 open per person
  for (let i = 0; i < 20; i++) {
    E.rows.photo_changes.push(Object.assign({}, E.rows.photo_changes[0], { id: 500 + i, plan_id: a.id, target_key: "zz" + i, client_key: "fill-key-" + i, status: "new",
      requested_by: uid("field"), requested_at: new Date(Date.now() - 2 * 3600000).toISOString(), result: null, error: null }));
  }
  const many = await refused(() => photo.request(a.id, "move_one", { shoot: "delivery", to: addDays(dl.plannedDate, 1) }, a.rev), "PT429", "too_many");
  assert.equal(M.refusalText(many.reason), "You have 20 changes waiting for the office computer - wait for them first.");
});

test("cancel: the requester while new, an admin anyone's; another photographer 42501, marketing PT404; once taken or finished {ok: false, status}; a new change older than 7 days reads expired", { skip }, async () => {
  await setup();
  as("admin");
  await photo.setTeam(uid("lead"), { photographer: true, marketing: false }, null);      // a second photographer
  as("field");
  const s = await photo.loadSchedule();
  const a = planNamed(s, "A000T9");
  const mk = (key, n) => photo.request(a.id, "move_one", { shoot: key, to: addDays(shootNamed(s, a.id, key).plannedDate, n || 1) }, a.rev);
  const r1 = await mk("progress-1");
  as("lead");
  await refused(() => photo.cancel(r1.id), "42501", "forbidden");
  as("viewer");
  await refused(() => photo.cancel(r1.id), "PT404", "no_request");
  as("field");
  assert.deepEqual(await photo.cancel(r1.id), { ok: true, status: "cancelled" });
  assert.deepEqual(await photo.cancel(r1.id), { ok: false, status: "cancelled" }, "once");
  await refused(() => photo.cancel(99999), "PT404", "no_request");
  const r2 = await mk("progress-2");
  as("admin");
  assert.deepEqual(await photo.cancel(r2.id), { ok: true, status: "cancelled" }, "an admin cancels anyone's");
  as("field");
  const r3 = await mk("progress-3");
  DEV.pc.step();
  assert.deepEqual(await photo.cancel(r3.id), { ok: false, status: "taken" });
  const r4 = await mk("before-framing");
  E.rows.photo_changes.find((c) => c.id === r4.id).requested_at = new Date(Date.now() - 8 * 86400000).toISOString();
  assert.equal((await photo.changes({ days: 0 })).find((c) => c.id === r4.id).state, "expired");
  assert.deepEqual(await photo.cancel(r4.id), { ok: false, status: "expired" });
  assert.equal((await photo.changes({ open: true, days: 0 })).some((c) => c.id === r4.id), false, "not open");
});

test("undo within 7 days by the requester: the preview reverses the move, the PC sets it back and the original is undone; another photographer is refused; a Firm job date by a photographer goes to the office (suggested), an admin's applies", { skip }, async () => {
  await setup();
  as("admin");
  await photo.setTeam(uid("lead"), { photographer: true, marketing: false }, null);
  as("field");
  let s = await photo.loadSchedule();
  const b = planNamed(s, "A000T8");
  const fc = shootNamed(s, b.id, "framing-complete");
  const original = (await photo.planChanges(b.id)).find((c) => c.kind === "move_one" && c.state === "applied");
  assert.equal(M.canUndo(original, uid("field"), await photo.myAccess()).ok, true);
  const pv = await photo.preview(b.id, "undo", { change: original.id });
  assert.deepEqual(pv.moved.map((m) => [m.key, m.from, m.to]), [["framing-complete", fc.plannedDate, addDays(fc.plannedDate, -1)]], "reversed");
  as("lead");
  await refused(() => photo.preview(b.id, "undo", { change: original.id }), "42501", "forbidden");
  assert.equal(M.canUndo(original, uid("lead"), await photo.myAccess()).ok, false);
  as("field");
  const u = await photo.request(b.id, "undo", { change: original.id }, b.rev);
  assert.equal(u.status, "new");
  assert.equal(DEV.pc.run(), 1);
  assert.equal((await photo.changes()).find((c) => c.id === u.id).state, "applied", "the undo applied");
  s = await photo.loadSchedule();
  assert.equal(shootNamed(s, b.id, "framing-complete").plannedDate, addDays(fc.plannedDate, -1), "set back");
  const was = (await photo.planChanges(b.id)).find((c) => c.id === original.id);
  assert.equal(was.undoneBy, u.id);
  assert.equal(M.canUndo(was, uid("field"), await photo.myAccess()).why, "It was undone already.");
  // a Firm job date: the photographer's move is sent to the office; the admin's is applied
  const b2 = planNamed(s, "A000T8");
  const hc = await photo.request(b2.id, "milestone", { milestone: "house_complete", date: addDays(b2.milestones.house_complete.date, 2) }, b2.rev);
  assert.equal(hc.needsOffice, false, "house complete is an estimate");
  DEV.pc.run();
  s = await photo.loadSchedule();
  const a = planNamed(s, "A000T9");
  const firm = await photo.request(a.id, "milestone", { milestone: "framing_start", date: addDays(a.milestones.framing_start.date, 2) }, a.rev);
  assert.equal(firm.needsOffice, true);
  DEV.pc.run();
  const sug = (await photo.changes()).find((c) => c.id === firm.id);
  assert.deepEqual([sug.state, sug.result.outcome, M.changeStatusText(sug).text, sug.result.words], ["applied", "suggested", "Sent to the office to approve",
    "Sent to the office: Framing start is Firm"]);
  assert.equal(planNamed(await photo.loadSchedule(), "A000T9").milestones.framing_start.date, a.milestones.framing_start.date, "the job date stays until the office approves");
  as("admin");
  s = await photo.loadSchedule();
  const a2 = planNamed(s, "A000T9");
  const adm = await photo.request(a2.id, "milestone", { milestone: "framing_start", date: addDays(a2.milestones.framing_start.date, 2) }, a2.rev);
  DEV.pc.run();
  const done = (await photo.changes()).find((c) => c.id === adm.id);
  assert.deepEqual([done.result.outcome, done.result.milestone_after.date, done.result.milestone_after.source], ["applied", addDays(a2.milestones.framing_start.date, 2), "admin"]);
  const a3 = planNamed(await photo.loadSchedule(), "A000T9");
  assert.deepEqual([a3.milestones.framing_start.date, a3.milestones.framing_start.firm, a3.milestonesRev], [addDays(a2.milestones.framing_start.date, 2), true, a3.rev]);
});

test("the photo team: written ONLY through set_photo_team at the row's version - the one default photographer, the Google e-mail tidied, a 'changed' refusal surfaced and never written over", { skip }, async () => {
  await setup();
  const asked = as("admin");
  const add = await photo.setTeam(uid("lead"), { photographer: true, marketing: false }, null);
  assert.deepEqual([add.photographer, add.defaultPhotographer, add.version, add.defaultProfileId], [true, false, 1, uid("field")], "the second photographer is not the default");
  assert.deepEqual(asked, ["rpc:set_photo_team"], "one RPC, no table touched");
  const moved = await photo.setTeam(uid("lead"), { photographer: true, marketing: false, isDefault: true }, add.version);
  assert.deepEqual([moved.defaultPhotographer, moved.version, moved.defaultProfileId], [true, 2, uid("lead")], "the default moves");
  let team = await photo.team();
  const jordan = team.find((m) => m.profileId === uid("field"));
  assert.deepEqual([jordan.defaultPhotographer, jordan.version], [false, 2], "the old default lost it (its version moved)");
  const stale = await refused(() => photo.setTeam(uid("field"), { photographer: true, marketing: true }, 1), "PT409", "changed");
  assert.deepEqual([stale.reason, stale.detail], ["changed", { table: "photo_team", id: uid("field"), version: 2 }]);
  assert.equal(M.refusalText(stale.reason, { where: "team" }), "Someone changed the photo team meanwhile - look again.");
  team = await photo.team();
  assert.equal(team.find((m) => m.profileId === uid("field")).marketing, false, "nothing written over");
  await refused(() => photo.setTeam(uid("lead"), { photographer: false, marketing: false }, 2), "22023", "pick_default_first");
  await refused(() => photo.setTeam(uid("manager"), { photographer: false, marketing: true }, 1), "PT409", "changed");
  await refused(() => photo.setTeam(uid("manager"), { photographer: false, marketing: true, isDefault: true }, null), "22023", "default_needs_photographer");
  await refused(() => photo.setTeam(uid("manager"), { photographer: false, marketing: true, googleEmail: "mo market@example.com" }, null), "22023", "bad_email");
  await refused(() => photo.setTeam(uid("agents"), { photographer: true, marketing: false }, null), "22023", "agents");
  await refused(() => photo.setTeam(uid("inactive"), { photographer: true, marketing: false }, null), "22023", "inactive");
  await refused(() => photo.setTeam("00000000-0000-4000-8000-0000000000ff", { photographer: true, marketing: false }, null), "PT404", "no_person");
  const m = await photo.setTeam(uid("manager"), { photographer: false, marketing: true, googleEmail: "\t Mo.Market@Example.COM \n" }, null);
  assert.equal(m.googleEmail, "mo.market@example.com", "tidied as the database keeps it");
  as("manager");
  assert.equal((await photo.myAccess()).canRead, true, "on marketing: reads the schedule");
  as("admin");
  const gone = await photo.setTeam(uid("viewer"), { photographer: false, marketing: false }, 1);
  assert.deepEqual([gone.removed, gone.version], [true, null], "both ticks off removes the row");
  as("viewer");
  assert.equal((await photo.myAccess()).canRead, false, "off the team: reads nothing");
  as("field");
  await refused(() => photo.setTeam(uid("lead"), { photographer: true, marketing: true }, 2), "42501", "forbidden");
  assert.ok(E.rows.photo_team.every((t) => t.version >= 1));
  assert.equal(E.rows.photo_team.filter((t) => t.default_photographer).length, 1, "exactly one default photographer");
});

test("the Realtime watch: the four tables on their private channels, a read after every join and after changes (coalesced, never two at a time), LOST handed on, stop()", { skip }, async () => {
  const subs = [];
  const live = { watch(table, filter, cb, opts) { const s = { table, filter, cb, opts, off: false }; subs.push(s); return () => { s.off = true; }; } };
  const reads = [];
  let release = null;
  const lost = [];
  const stop = await photo.watchSchedule(async (what) => { reads.push(what); if (reads.length === 2) await new Promise((r) => { release = r; }); },
    { live, wait: 5, onLost: (e) => lost.push(e.table) });
  assert.deepEqual(subs.map((s) => [s.table, s.filter, s.opts.lost]), [["photo_plans", "", true], ["photo_shoots", "", true], ["photo_changes", "", true], ["photo_team", "", true]]);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  for (const s of subs) s.cb({ type: "SUBSCRIBED", table: s.table });
  await tick();
  assert.equal(reads.length, 1, "one read for the four joins");
  assert.deepEqual([reads[0].join, reads[0].tables.sort()], [true, ["photo_changes", "photo_plans", "photo_shoots", "photo_team"]]);
  subs[1].cb({ type: "UPDATE", table: "photo_shoots", new: {}, old: {} });
  await tick();
  assert.equal(reads.length, 2);
  subs[2].cb({ type: "INSERT", table: "photo_changes", new: {} });
  await tick();
  assert.equal(reads.length, 2, "never two at a time");
  release();
  await tick();
  await tick();
  assert.equal(reads.length, 3, "the change that came meanwhile is read after");
  assert.deepEqual([reads[2].join, reads[2].tables], [false, ["photo_changes"]]);
  subs[0].cb({ type: "LOST", table: "photo_plans", status: "CHANNEL_ERROR" });
  assert.deepEqual(lost, ["photo_plans"]);
  stop();
  assert.ok(subs.every((s) => s.off), "unsubscribed");
  subs[0].cb({ type: "UPDATE" });
  await tick();
  assert.equal(reads.length, 3, "nothing after stop()");
});

test("a database without the photo schedule yet (42883 / PGRST202 / PGRST205): nothing is read, nobody may act, nothing breaks", async () => {
  const miss = { code: "PGRST205", message: "Could not find the table 'public.photo_plans' in the schema cache" };
  const q = { select() { return q; }, neq() { return q; }, eq() { return q; }, in() { return q; }, gte() { return q; }, order() { return q; }, range() { return q; },
    then(ok) { return Promise.resolve({ data: null, error: miss }).then(ok); } };
  useClient({ from: () => q, rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.photo_my_access" } }) });
  assert.equal((await photo.myAccess()).ready, false);
  assert.equal(await photo.pcStatus(), null);
  assert.deepEqual(await photo.loadSchedule(), { ready: false, plans: [], shoots: [] });
  assert.equal(await photo.loadPlan(3), null);
  assert.deepEqual(await photo.changes(), []);
  assert.deepEqual(await photo.team(), []);
  const e = await photo.preview(1, "move_one", { shoot: "a", to: "2026-12-01" }).catch((x) => x);
  assert.deepEqual([e instanceof photo.PhotoError, e.missing, e.reason], [true, true, "not_ready"]);
});

test("which errors are a dropped connection (send the same request again) and which are the database's answer", () => {
  assert.equal(photo.isRetryable({ message: "TypeError: Failed to fetch", code: "", status: 0 }), true);
  assert.equal(photo.isRetryable({ code: "NETWORK", status: 0 }), true);
  assert.equal(photo.isRetryable({ code: "", status: 503, message: "Service Unavailable" }), true);
  assert.equal(photo.isRetryable({ code: "", status: 544 }), true);
  assert.equal(photo.isRetryable({ code: "PT409", status: 409, message: "changed" }), false);
  assert.equal(photo.isRetryable({ code: "22023", status: 400, message: "network of shoots" }), false, "the database answered");
  assert.equal(photo.isRetryable({ code: "08006", status: 503 }), true, "the connection to the database failed");
  const e = new photo.PhotoError({ code: "PT429", hint: "rate", message: "x", details: '{"retryAfter": 120}', status: 429 });
  assert.deepEqual([e.reason, e.retryAfter, e.detail], ["rate", 120, { retryAfter: 120 }]);
  assert.equal(new photo.PhotoError({ code: "42501", message: "x" }).reason, "forbidden");
  assert.equal(new photo.PhotoError({ code: "PT404", message: "x" }).reason, "not_found");
});

test("the demo's port of THE SHIFT RULE answers every shared case as app.photo_shift does (DCR Desktop 2's photo_shift_cases.json)", { skip: (skip || (!existsSync(CASES) && "the shared case file is not on this PC (DCR_DESKTOP2_DIR)")) }, async () => {
  F = await loadFake();
  const file = JSON.parse(readFileSync(CASES, "utf8"));
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {}) : v);
  const failed = [];
  for (const c of file.cases) {
    const got = F.p10PhotoShift(c.input);
    if (JSON.stringify(canon(got)) !== JSON.stringify(canon(c.expected))) failed.push(c.name + ": " + JSON.stringify(got));
  }
  assert.deepEqual(failed, [], "cases the demo answers otherwise");
  assert.throws(() => F.p10PhotoShift({ change: { kind: "move_one" } }), /today/, "no today: 22023 bad_args");
});
