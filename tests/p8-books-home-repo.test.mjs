// The Books program, release B part 2a (P4): the money messages' repository (site/js/repo/money-messages.js) and the
// Accounting page's (site/js/repo/books-home.js) - exactly the RPC argument names of migration
// 20261030000400_money_messages (and of the demo database: tools/fake/p8-books.js SIGS), nothing read without the
// financials switch, an older database without the messages (42P01 / PGRST202) said, never a crash. Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { makeClient } from "./pages-stub.mjs";
import { available, loadFake, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import { clearPeople } from "../site/js/repo/people.js";
import * as mm from "../site/js/repo/money-messages.js";
import * as home from "../site/js/repo/books-home.js";

const skip = !available && "the demo database (tools/fake) is not here";
const ACC = { id: "u-acc", role: "accountant", active: true, can_see_financials: true, can_see_prices: true, name: "Casey Accounts" };
const LEAD = { id: "u-lead", role: "lead", active: true, can_see_financials: false };

test("the RPCs are sent with the migration's argument names, every one of them (an optional one as null)", async () => {
  const c = makeClient({}, {
    money_approvers: () => ({ data: [{ profileId: "p1", name: "Avery Admin", firstName: "Avery", role: "admin", hasEmail: true, phone: "+18055550101", usual: true, usualFor: ["A1"] }], error: null }),
    ask_for_approval: () => ({ data: { groupId: "g", messages: [{ id: 5, channel: "sms", phone: "+18055550101", body: "Hi", status: "draft", billIds: [3] }] }, error: null }),
    tell_payee: () => ({ data: { groupId: "g", messages: [] }, error: null }),
    money_text_sent: () => ({ data: { id: 5, channel: "sms", status: "sent" }, error: null }),
    save_message_template: () => ({ data: { key: "check_ready", channel: "sms", body: "x", version: 2 }, error: null }),
    reset_message_template: () => ({ data: { key: "check_ready", channel: "sms", body: "y", version: 3 }, error: null }),
    preview_message_template: () => ({ data: { subject: null, body: "Hi Sam", problem: null }, error: null }),
    reminder_pc_status: () => ({ data: { seenMinutesAgo: 3, paused: false, notTaking: false }, error: null }),
  });
  useClient(c);
  const ap = await mm.approvers(["3", 4]);
  assert.deepEqual(ap[0], { profileId: "p1", name: "Avery Admin", firstName: "Avery", role: "admin", hasEmail: true, phone: "+18055550101", usual: true, usualFor: ["A1"] });
  const r = await mm.ask(["3"], [{ profile: "p1", channel: "sms" }, { profile: "p2", channel: "anything" }], { subject: "S" });
  assert.equal(r.messages[0].phone, "+18055550101");
  await mm.tell([7, "8"], "email", { contactId: "12", body: "B" });
  await mm.tell([9], "sms", {});
  await mm.textSent("5", true);
  await mm.saveTemplate({ key: "check_ready", channel: "sms", version: 1 }, "ignored", "x");
  await mm.resetTemplate({ key: "check_ready", channel: "email", version: 4 });
  await mm.preview("check_ready", "email", "S", "B", { paymentIds: [9] });
  await mm.preview("approval_request", "sms", "dropped", "B", { billIds: [3], toProfileId: "p1" });
  assert.deepEqual(await mm.pcStatus(), { seenMinutesAgo: 3, paused: false, notTaking: false });
  const rpc = c.calls.filter((x) => x.rpc).map((x) => [x.rpc, x.args]);
  assert.deepEqual(rpc, [
    ["money_approvers", { p_bill_ids: [3, 4] }],
    ["ask_for_approval", { p_bill_ids: [3], p_to: [{ profile: "p1", channel: "sms" }, { profile: "p2", channel: "email" }], p_subject: "S", p_body: null, p_sms_body: null }],
    ["tell_payee", { p_payment_ids: [7, 8], p_channel: "email", p_contact_id: 12, p_subject: null, p_body: "B" }],
    ["tell_payee", { p_payment_ids: [9], p_channel: "sms", p_contact_id: null, p_subject: null, p_body: null }],
    ["money_text_sent", { p_message_id: 5, p_sent: true }],
    ["save_message_template", { p_key: "check_ready", p_channel: "sms", p_subject: null, p_body: "x", p_version: 1 }],
    ["reset_message_template", { p_key: "check_ready", p_channel: "email", p_version: 4 }],
    ["preview_message_template", { p_key: "check_ready", p_channel: "email", p_subject: "S", p_body: "B", p_bill_ids: null, p_payment_ids: [9], p_to_profile_id: null }],
    ["preview_message_template", { p_key: "approval_request", p_channel: "sms", p_subject: null, p_body: "B", p_bill_ids: [3], p_payment_ids: null, p_to_profile_id: "p1" }],
    ["reminder_pc_status", {}],
  ]);
  // the demo database takes exactly these (tools/fake/p8-books.js: the migration's arguments; loaded in its order)
  const F = await loadFake();
  if (!F) return;
  const SIGS = F.p8BooksSigs;
  for (const [name, args] of rpc) {
    assert.ok(Object.keys(args).every((k) => SIGS[name].includes(k)), name + ": every argument is the migration's");
  }
  assert.deepEqual(SIGS.ask_for_approval, ["p_bill_ids", "p_to", "p_subject", "p_body", "p_sms_body"]);
  assert.deepEqual(SIGS.tell_payee, ["p_payment_ids", "p_channel", "p_contact_id", "p_subject", "p_body"]);
  useClient(null);
});

test("nothing is read without the financials switch: messages() refuses, drafts() is empty, loadHome refuses, loadCounts / askedBy answer nothing - before any read", async () => {
  const c = makeClient({ money_messages: [{ id: 1 }] }, {});
  useClient(c);
  await assert.rejects(() => mm.messages(LEAD), (e) => e.code === "42501");
  assert.deepEqual(await mm.drafts(LEAD), []);
  await assert.rejects(() => home.loadHome(LEAD), (e) => e.code === "42501" && /financials switch/.test(e.message));
  assert.equal(await home.loadCounts(LEAD), null);
  assert.equal((await home.askedBy(LEAD, [1])).size, 0);
  assert.deepEqual(c.calls, [], "nothing asked");
  useClient(null);
});

test("an older database (no money_messages / templates / reminder_pc_status yet): null, said by the page - never a crash", async () => {
  const missing = { code: "42P01", message: 'relation "public.money_messages" does not exist' };
  const c = { from: () => { const q = { select: () => q, gte: () => q, eq: () => q, order: () => q, range: () => Promise.resolve({ data: null, error: missing }),
    then: (ok) => Promise.resolve({ data: null, error: missing }).then(ok) }; return q; },
  rpc: () => Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function public.reminder_pc_status" } }) };
  useClient(c);
  assert.equal(await mm.messages(ACC), null);
  assert.deepEqual(await mm.drafts(ACC), []);
  assert.equal(await mm.templates(), null);
  assert.equal(await mm.pcStatus(), null);
  useClient(null);
});

test("drafts are MY texts only (created_by = me, status draft), with the number and body as stored", async () => {
  const c = makeClient({ money_messages: [
    { id: 1, channel: "sms", status: "draft", created_by: "u-acc", to_address: "+18055550101", body: "Hi", bill_ids: [3], created_at: "2026-10-28T17:00:00Z" },
    { id: 2, channel: "sms", status: "draft", created_by: "u-other", to_address: "+18055550102", body: "Hi", bill_ids: [3], created_at: "2026-10-28T17:00:00Z" },
    { id: 3, channel: "sms", status: "sent", created_by: "u-acc", to_address: "+18055550101", body: "Hi", bill_ids: [3], created_at: "2026-10-28T17:00:00Z" }] }, {});
  useClient(c);
  const d = await mm.drafts(ACC);
  assert.deepEqual(d.map((m) => [m.id, m.phone, m.body]), [[1, "+18055550101", "Hi"]]);
  const sel = c.calls.find((x) => x.table === "money_messages");
  assert.ok(/to_address, body$/.test(sel.cols) && sel.filters.some((f) => f[1] === "created_by" && f[2] === "u-acc"), JSON.stringify(sel));
  useClient(null);
});

test("over the demo database: loadHome as the accountant (the piles, the last ask, the templates, the PC); loadCounts equals the page's counts; askedBy", { skip }, async () => {
  const e = await freshEngine();
  const acc = await person("accountant");
  useClient(clientAs(e, acc.id));
  clearPeople();
  const me = { id: acc.id, name: acc.name, role: "accountant", active: true, can_see_financials: true, can_see_prices: true };
  const d = await home.loadHome(me);
  assert.ok(d.ready && d.templates.length === 6 && d.pc && d.pc.seenMinutesAgo !== null, "messages, templates, the PC");
  assert.ok(d.waiting.length >= 3 && d.toDecide.length >= 1 && d.blocked.length >= 1 && d.subs.count >= 1, "the made-up piles");
  const quarry = d.waiting.find((b) => b.vendor === "Quarryman Concrete");
  assert.equal(quarry.lastAsked.entries[0].status, "sent", "the earlier ask by e-mail");
  assert.deepEqual(await home.loadCounts(me), d.counts, "the home page's counts are the page's");
  const asked = await home.askedBy(me, [quarry.id]);
  assert.equal(asked.get(String(quarry.id)).byName, "Casey Accounts");
  assert.deepEqual(Object.keys(d.can).sort(), ["approve", "mark", "money", "pay", "review"]);
  assert.equal(d.can.approve, false, "an accountant never approves");
  useClient(null);
});
