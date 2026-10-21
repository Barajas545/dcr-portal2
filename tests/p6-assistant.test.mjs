// P6 (the personal assistants): site/js/map/assistant.js (the badge, company time, the refusal words, the
// office's item), site/js/repo/assistant.js over a stub client (migration M6's names and parameters, one place:
// RPC) and over the DEMO database (tools/fake/p6.js, M6's rules: the person's own assistant only; the old GET
// and POST answers; the office reads the chat only with office_reads on; the office's items only ticked by the
// person; the limits; a client id once). Made-up data only; tools/schema-check.mjs runs the same modules against
// the real migration.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { available, person, clientAs, loadFake } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as repo from "../site/js/repo/assistant.js";
import { assistantBadge, localStamp, refusalText, itemFields } from "../site/js/map/assistant.js";

const skip = !available && "the demo database (tools/fake) is not here";
const NOW = new Date("2026-10-21T17:30:00Z");        // 10:30 am in the company's zone

test("the home page's badge: answers not read yet (red), else what is due today (dim); nothing for an assistant that is off", () => {
  assert.deepEqual(assistantBadge({ linked: true, enabled: true, unread: 2, dueToday: 3 }), { text: "2 new", cls: "warn" });
  assert.deepEqual(assistantBadge({ enabled: true, unread: 0, dueToday: 3 }), { text: "3 today", cls: "dim" });
  assert.equal(assistantBadge({ enabled: true, unread: 0, dueToday: 0 }), null);
  assert.equal(assistantBadge({ enabled: false, unread: 4, dueToday: 1 }), null);
  assert.equal(assistantBadge(null), null);
  const dash = readFileSync(new URL("../site/js/shell/dashboard.js", import.meta.url), "utf8");
  assert.ok(dash.includes("try { b = assistantBadge(await assistantPage({ summary: true })); } catch (e) { return; }"), "the counts-only answer");
  assert.match(dash, /myTasksBadge\(\);\s*myAssistantBadge\(\);/);
});

test("company time, the refusal words, the office's item", () => {
  assert.equal(localStamp(NOW), "2026-10-21T10:30");
  assert.equal(localStamp(new Date("2026-01-15T01:05:00Z")), "2026-01-14T17:05", "winter, the day before in UTC terms");
  assert.equal(refusalText({ code: "PT409", status: 409, message: "Wait for your assistant to answer first." }), "Wait for your assistant to answer first.");
  assert.equal(refusalText({ code: "NETWORK", message: "No answer from the database." }), "");
  assert.equal(refusalText({ message: "TypeError: Failed to fetch", status: 0 }), "");
  assert.match(refusalText({ code: "PGRST202", status: 404, message: "Could not find the function" }), /phase 6/);
  assert.deepEqual(itemFields("event", { text: " Inspection ", day: "2026-10-22", time: "09:00", end: "10:00", location: "", remind: "30", notes: "" }),
    { kind: "event", text: "Inspection", at: "2026-10-22T09:00", end: "2026-10-22T10:00", location: "", remind: 30, notes: "" });
  assert.deepEqual(itemFields("todo", { text: "x", due: "" }), { kind: "todo", text: "x", due: "", notes: "" });
  assert.deepEqual(itemFields("reminder", { text: "y", day: "2026-10-22", time: "08:00" }, true), { text: "y", at: "2026-10-22T08:00" }, "a change: no kind");
  assert.equal(itemFields("event", { text: "z", day: "2026-10-22", time: "08:00", remind: "" }).remind, null);
});

test("repo/assistant: every M6 call by name and parameter (RPC is the one list); an op the old page never sent is refused before the database", async () => {
  const calls = [];
  useClient({ rpc: async (name, args) => { calls.push([name, args]); return { data: { people: [{ profile_id: "p1" }, {}] }, error: null }; } });
  await repo.page({ agenda: true });
  await repo.page({ rev: "12" });
  await repo.page({ summary: true });
  await repo.op("item.add", { item: { kind: "todo", text: "x" } });
  await repo.op("read");
  await repo.say("Hi", "c1");
  await repo.pcStatus();
  assert.deepEqual(await repo.officeList(), [{ profile_id: "p1" }], "rows without a person are dropped");
  await repo.officeSet("p1", true);
  await repo.officeSet("p1", true, false);
  await repo.officeView("p1");
  await repo.officeItem("p1", "add", null, { kind: "todo", text: "z" });
  await repo.officeItem("p1", "delete", "i_abcdef12");
  await assert.rejects(repo.op("say", { text: "x" }), (e) => e.code === "22023", "a message goes through say()");
  await assert.rejects(repo.op("drop.table"), (e) => e.code === "22023");
  assert.deepEqual(calls, [
    ["my_assistant", { p_agenda: true, p_rev: null, p_summary: false }],
    ["my_assistant", { p_agenda: false, p_rev: 12, p_summary: false }],
    ["my_assistant", { p_agenda: false, p_rev: null, p_summary: true }],
    ["assistant_op", { p_op: "item.add", p_body: { item: { kind: "todo", text: "x" } } }],
    ["assistant_op", { p_op: "read", p_body: {} }],
    ["assistant_say", { p_text: "Hi", p_client_id: "c1" }],
    ["assistant_pc_status", {}],
    ["assistant_office_list", {}],
    ["assistant_set", { p_profile_id: "p1", p_on: true, p_office_reads: null }],
    ["assistant_set", { p_profile_id: "p1", p_on: true, p_office_reads: false }],
    ["assistant_office_view", { p_profile_id: "p1" }],
    ["assistant_office_item", { p_profile_id: "p1", p_do: "add", p_item_id: null, p_item: { kind: "todo", text: "z" } }],
    ["assistant_office_item", { p_profile_id: "p1", p_do: "delete", p_item_id: "i_abcdef12", p_item: null }],
  ]);
  assert.deepEqual(Object.values(repo.RPC).sort(), [...new Set(calls.map((c) => c[0]))].sort(), "RPC names every call");
  useClient(null);
});

test("the demo database: the old GET — off and 'ask the office', the badge's counts, 'unchanged' at the same revision, the whole state with the agenda", { skip }, async () => {
  const F = await loadFake();
  const e = F.createEngine({ clock: () => NOW });
  e.load(F.seed({ now: NOW }));
  const field = await person("field"), manager = await person("manager");
  useClient(clientAs(e, manager.id));
  assert.deepEqual(await repo.page({ agenda: true }), { linked: true, enabled: false, employeeName: "Morgan Manager",
    message: "Your assistant isn’t turned on yet — ask the office." });
  assert.deepEqual(await repo.page({ summary: true }), { linked: true, enabled: false, unread: 0, dueToday: 0 });
  useClient(clientAs(e, field.id));
  const d = await repo.page({ agenda: true });
  assert.deepEqual([d.enabled, d.firstName, d.officeReads, d.today, d.now, d.tz], [true, "Jordan", true, "2026-10-21", "2026-10-21T10:30", "America/Los_Angeles"]);
  for (const k of ["rev", "waiting", "chat", "items", "memory", "prefs", "unread", "dueToday", "pc", "generatedAt", "agenda"]) assert.ok(k in d, k);
  assert.deepEqual(Object.keys(d.agenda).sort(), ["hours", "projects", "sites", "tasks", "timesheets"]);
  assert.ok(d.agenda.tasks.some((t) => /\[amount\]/.test(t.name)), "a task with an amount in its words (the demo has one) comes scrubbed");
  assert.ok(!/\$\s?\d/.test(JSON.stringify(d.agenda)), "no amount anywhere in the agenda");
  assert.ok(d.items.every((i) => /^i_[a-z0-9]{6,24}$/.test(i.id) && "by" in i && "end" in i), "the old item JSON");
  assert.ok(d.chat.every((m) => /^m_/.test(m.id) && "at" in m), "the old message JSON");
  assert.deepEqual(Object.keys(d.pc).sort(), ["chatAt", "lastSeen", "minutesAgo", "paused"]);
  const same = await repo.page({ rev: d.rev });
  assert.equal(same.unchanged, true);
  assert.deepEqual(await repo.page({ summary: true }), { linked: true, enabled: true, unread: d.unread, dueToday: d.dueToday });
  useClient(null);
});

test("the demo database: the old POST — the chat (1,500 characters, five waiting, a client id once), the office's items only ticked, the briefing window, read", { skip }, async () => {
  const F = await loadFake();
  const e = F.createEngine({ clock: () => NOW });
  e.load(F.seed({ now: NOW }));
  const field = await person("field");
  useClient(clientAs(e, field.id));
  const d = await repo.page({});
  const s1 = await repo.say("What's on my week?", "client-1");
  assert.equal(s1.message.status, "waiting");
  assert.equal((await repo.say("What's on my week?", "client-1")).already, true, "the same send twice: one message");
  await assert.rejects(repo.say("x".repeat(1501), "client-2"), (x) => x.code === "22023" && x.message === "Keep your message under 1,500 characters.");
  await assert.rejects(repo.say("   ", "client-3"), (x) => x.message === "Write a message first.");
  for (let i = 0; i < 4; i++) await repo.say("q" + i, "w" + i);
  await assert.rejects(repo.say("one more", "w9"), (x) => x.code === "PT409" && x.message === "Wait for your assistant to answer first.");
  assert.equal(e.p6.pc.answerChats(), 5, "the DCR server answers them");
  const office = d.items.find((i) => i.by === "office" && !i.done);
  await assert.rejects(repo.op("item.update", { id: office.id, patch: { text: "mine now" } }), (x) => x.message === "The office added this one.");
  await assert.rejects(repo.op("item.delete", { id: office.id }), (x) => x.message === "The office added this one.");
  assert.equal((await repo.op("item.complete", { id: office.id, done: true })).item.done, true, "ticked done: yes");
  const added = await repo.op("item.add", { item: { kind: "reminder", text: "Call the yard", at: "2026-10-22T08:00" } });
  assert.deepEqual([added.item.by, added.item.at, added.items.length > 1], ["employee", "2026-10-22T08:00", true]);
  const changed = await repo.op("item.update", { id: added.item.id, patch: { at: "2026-10-22T09:15" } });
  assert.equal(changed.item.at, "2026-10-22T09:15");
  await assert.rejects(repo.op("item.add", { item: { kind: "reminder", text: "No time" } }), (x) => x.code === "22023");
  await assert.rejects(repo.op("item.add", { item: { kind: "todo", text: "x", at: "2026-10-22T08:00" } }), (x) => /due day, not a time/.test(x.message));
  await assert.rejects(repo.op("prefs.set", { prefs: { eveningAt: "21:30" } }), (x) => x.message === "Pick a briefing time between 12:00 and 20:45.");
  assert.equal((await repo.op("prefs.set", { prefs: { eveningAt: "19:00", language: "es" } })).prefs.language, "es");
  const mem = await repo.op("memory.add", { text: "I park on the north side" });
  assert.ok(mem.memory.some((n) => n.text === "I park on the north side" && n.by === "employee"));
  assert.equal((await repo.op("memory.add", { text: "i park on the NORTH side" })).already, true, "once, any case");
  await repo.op("read");
  assert.equal((await repo.page({ summary: true })).unread, 0);
  // the agents account has no assistant and reads nothing directly
  const agents = await person("agents");
  useClient(clientAs(e, agents.id));
  await assert.rejects(repo.page({}), (x) => x.code === "42501");
  useClient(null);
});

test("the demo database: an admin turns assistants on and off, reads the chat and notes ONLY with office reads on, and keeps the office's items; nobody else may", { skip }, async () => {
  const F = await loadFake();
  const e = F.createEngine({ clock: () => NOW });
  e.load(F.seed({ now: NOW }));
  const admin = await person("admin"), field = await person("field"), lead = await person("lead"), manager = await person("manager");
  useClient(clientAs(e, admin.id));
  const list = await repo.officeList();
  assert.ok(list.every((p) => p.role !== "Agents"), "never the agents account");
  const jordan = list.find((p) => p.profile_id === field.id), riley = list.find((p) => p.profile_id === lead.id);
  assert.deepEqual([jordan.on, jordan.officeReads, riley.on, riley.officeReads, riley.role], [true, true, true, false, "Lead"]);
  assert.ok((await repo.officeView(field.id)).chat.length > 0, "office reads on: the chat");
  const hidden = await repo.officeView(lead.id);
  assert.deepEqual([hidden.chatHidden, hidden.chat, hidden.memory], [true, [], []], "office reads off: nothing of it");
  assert.ok(hidden.items.length > 0, "the items: always (the office keeps its own there)");
  await assert.rejects(repo.officeView(manager.id), (x) => x.code === "PT404", "no assistant: no row");
  assert.equal((await repo.officeSet(lead.id, true, true)).profile.officeReads, true);
  // turned on: readable from now on only (M6 office_reads_since - review fix), starting with the note that tells Riley
  const now = await repo.officeView(lead.id);
  assert.deepEqual(now.chat.map((m) => m.role), ["office"], "what Riley wrote while it was off stays private");
  assert.ok(now.officeReadsSince, "and from when");
  useClient(clientAs(e, lead.id));
  const rileyPage = await repo.page({});
  assert.match(rileyPage.chat[rileyPage.chat.length - 1].text, /from this message on/, "Riley is told in the chat");
  useClient(clientAs(e, admin.id));
  const add = await repo.officeItem(lead.id, "add", null, itemFields("todo", { text: "Bring the crew's hours by Friday", due: "2026-10-23" }));
  const id = add.ids[0];
  assert.equal((await repo.officeView(lead.id)).items.find((i) => i.id === id).by, "office");
  await repo.officeItem(lead.id, "update", id, itemFields("todo", { text: "Bring the hours by Friday noon", due: "2026-10-23" }, true));
  const own = (await repo.officeView(lead.id)).items.find((i) => i.by === "employee");
  await assert.rejects(repo.officeItem(lead.id, "update", own.id, { text: "x" }), (x) => x.code === "42501", "only the office's own");
  await repo.officeItem(lead.id, "delete", id);
  assert.ok(!(await repo.officeView(lead.id)).items.some((i) => i.id === id));
  const off = await repo.officeSet(field.id, false);
  assert.equal(off.profile.on, false);
  await repo.officeSet(manager.id, true);
  assert.equal((await repo.officeList()).find((p) => p.profile_id === manager.id).on, true, "turned on: a row is made");
  useClient(clientAs(e, field.id));
  assert.equal((await repo.page({})).enabled, false, "turned off: 'ask the office'");
  for (const key of ["manager", "accountant", "lead", "field", "viewer"]) {
    const p = await person(key);
    useClient(clientAs(e, p.id));
    await assert.rejects(repo.officeList(), (x) => x.code === "42501", key);
    await assert.rejects(repo.officeSet(field.id, true), (x) => x.code === "42501", key);
    await assert.rejects(repo.officeItem(field.id, "add", null, { kind: "todo", text: "x" }), (x) => x.code === "42501", key);
    await assert.rejects(repo.officeView(field.id), (x) => x.code === "42501", key);
  }
  useClient(null);
});

test("live.js: a page that asks ({lost: true}) hears its channel go (LOST) and come back (SUBSCRIBED); a page that does not, never hears LOST (review fix: My Assistant kept the 30-second live pace on a dead channel)", async () => {
  const channels = [];
  const fake = {
    channel(topic, opts) {
      const ch = { topic, opts, binds: [], on(type, filter, cb) { this.binds.push({ type, filter, cb }); return this; },
        subscribe(cb) { this.status = cb; return this; } };
      channels.push(ch);
      return ch;
    },
    removeChannel() { return "ok"; },
  };
  globalThis.DCR2_CONFIG = { SUPABASE_URL: "https://x.invalid", SUPABASE_KEY: "sb_publishable_test" };
  globalThis.supabase = { createClient: () => fake };
  const live = await import("../site/js/live.js");
  const got = [], quiet = [];
  const stop = live.watch("assistant_messages", "profile_id=eq.u1", (e) => got.push(e.type + ":" + e.table), { lost: true });
  const stop2 = live.watch("assistant_items", "profile_id=eq.u1", (e) => quiet.push(e.type));
  const [a, b] = channels.slice(-2);
  a.status("SUBSCRIBED");
  b.status("SUBSCRIBED");
  a.status("CHANNEL_ERROR");
  b.status("CHANNEL_ERROR");
  assert.deepEqual(got, ["SUBSCRIBED:assistant_messages", "LOST:assistant_messages"]);
  assert.deepEqual(quiet, ["SUBSCRIBED"], "no LOST without asking: every other page as before");
  stop();
  stop2();
});

test("My Assistant: live only while the answers' channel (assistant_messages) is joined; its loss puts the thinking poll back on its own pace at once", () => {
  const js = readFileSync(new URL("../site/js/pages/my-assistant.js", import.meta.url), "utf8");
  assert.match(js, /if \(evt\.type === "SUBSCRIBED"\) \{ joined\[evt\.table\] = true; S\.live = !!joined\.assistant_messages; \}/);
  assert.match(js, /else if \(evt\.type === "LOST"\) \{/);
  assert.match(js, /if \(was && !S\.live && S\.pollTimer\) \{ clearTimeout\(S\.pollTimer\); S\.pollTimer = null; poll\(\); \}/);
  const repoSrc = readFileSync(new URL("../site/js/repo/assistant.js", import.meta.url), "utf8");
  assert.match(repoSrc, /live\.watch\(t, "profile_id=eq\." \+ uid, cb, \{ lost: true \}\)/);
});
