/* The DCR Agents web console's Assistants tab (site/js/console/console-assistants.js),
   run in a small stand-in for the browser and the shell's ctx
   (lib/console-tab-stub.mjs) against answers shaped like the DCR server's
   (console-spec §6.1.10, console/handlers_assistants.py). Everything the
   server sends comes out escaped; every change goes through the server's
   own question (ctx.act); a name, a note or an item is only ever what the
   page was given or what was typed; "Teach from this…" hands the message
   to the Training Coach's box without putting it in an address. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EVIL, esc, loadTab, refusal, target } from "./console-tab-stub.mjs";

const SRC = readFileSync(new URL("../../site/js/console/console-assistants.js", import.meta.url), "utf8");
const LUIS = "Luis Martinez";
const SCOPE = "employee:Luis Martinez";
const DRAFT = "dcr.console.training.draft.v1:" + SCOPE;

function list(over = {}) {
  return {
    agent_words: [`Briefings & reminders: on ${EVIL}`, "green"], poll_words: [`Chats checked 13:59:58 ${EVIL}`, "green"],
    on_here: true, office_reads: true, ai: { ok: true, words: `Claude Opus 5.5 ${EVIL}` }, dry_run: false, paused: false,
    counts: { on: 2, waiting: 1 }, can_turn_on_all: true,
    rows: [
      { name: LUIS, first: "Luis", role: "Field", has_account: true, on_roster: true, on: true, known: true, chip: ["On", "green"],
        subtitle: `3 open items ${EVIL}`, unread: 0, waiting: false, open_items: 3, office_reads: true, usage_words: "2 answers today", last_briefing: null },
      { name: `Ana ${EVIL}`, first: "Ana", role: "Lead", has_account: true, on_roster: true, on: true, known: true, chip: [`Waiting ${EVIL}`, "amber"],
        subtitle: "a message is waiting", unread: 1, waiting: true, open_items: 0, office_reads: true, usage_words: "", last_briefing: null },
      { name: "Sam Field", first: "Sam", role: "Field", has_account: true, on_roster: true, on: false, known: false, chip: ["Off", "grey"],
        subtitle: "Field", unread: 0, waiting: false, open_items: 0, office_reads: true, usage_words: "", last_briefing: null },
      { name: "Pat Gone", first: "Pat", role: "", has_account: false, on_roster: false, on: false, known: true, chip: ["No account", "grey"],
        subtitle: "No longer on the roster", unread: 0, waiting: false, open_items: 0, office_reads: true, usage_words: "", last_briefing: null },
    ],
    ...over,
  };
}

function employee(over = {}) {
  return {
    row: list().rows[0],
    subtitle: `Evening briefing 18:00 · weekly briefing Sunday 18:00 · English ${EVIL}`,
    notice: { text: `Dry run: chats are answered ${EVIL}`, tone: "blue" },
    conversation: [
      { id: "m_1", role: "user", text: `Remind me ${EVIL}`, at: "2026-10-09T16:10:00+00:00", status: "answered", meta: `Luis · Fri Oct 9 09:10 ${EVIL}`, cards_words: [] },
      { id: "m_2", role: "assistant", text: `Done ${EVIL}`, at: "2026-10-09T16:10:30+00:00", status: "", meta: "Assistant · Fri Oct 9 09:10",
        cards: [{ type: "item", itemId: "i_1" }], cards_words: [`Reminder — Call the yard ${EVIL}`] },
      { id: "m_3", role: "office", text: `From the office ${EVIL}`, at: "2026-10-09T17:00:00+00:00", status: "", meta: "The office · Fri Oct 9 10:00", cards_words: [] },
    ],
    hidden: null, empty: "",
    items: [
      { id: "i_1", kind: "reminder", text: `Call the yard ${EVIL}`, at: "2026-10-09T15:00", end: "", due: "", location: `Yard ${EVIL}`, notes: `Notes ${EVIL}`,
        remind: null, done: false, by: "assistant", when: `Fri Oct 9 15:00 ${EVIL}`, status: [`Coming up ${EVIL}`, "blue"], kind_words: "Reminder", by_words: `The assistant ${EVIL}` },
      { id: "i_2", kind: "todo", text: "Sign the safety sheet", at: "", end: "", due: "2026-10-01", location: "", notes: "", remind: null, done: true,
        by: "office", when: "due Thu Oct 1", status: ["Done", "green"], kind_words: "To-do", by_words: "The office" },
    ],
    items_note: `1 open, 1 done. ${EVIL}`,
    notes: [
      { id: 11, scope: SCOPE, text: `Foreman at A068 ${EVIL}`, category: "facts", active: true, source: "admin", created_at: "2026-10-01T16:00:00+00:00" },
      { id: 12, scope: SCOPE, text: "Keep answers short", category: "tone", active: false, source: "admin", created_at: "2026-10-02T16:00:00+00:00" },
    ],
    notes_scope: SCOPE,
    facts_words: `From Training: Luis speaks Spanish ${EVIL}`,
    briefings: [{ key: "k1", about: `Fri Oct 9 ${EVIL}`, kind: "evening", kind_words: "Evening", by: "claude", by_words: "Claude", made_at: "x",
      made_words: `Thu Oct 8 17:40 ${EVIL}`, text: `Tomorrow: A068 ${EVIL}` }],
    log: [{ at: "x", when: `Fri Oct 9 10:30 ${EVIL}`, kind: "answer", kind_words: `Answered ${EVIL}`, detail: `tools ${EVIL}`, tokens: 6520, seconds: 7.9 }],
    usage_words: `Today: 2 answers ${EVIL}`, dry_run: true, ai: { ok: true, words: "Claude" },
    can: { toggle: true, briefing: true, add: true, ask_as: true },
    ...over,
  };
}

function settings() {
  return { sections: { assistant: { rev: "0123456789abcdef", values: { "assistant.enabled": true, "assistant.evening_at": "18:00",
    "assistant.model": "claude-opus-5-5", "assistant.poll_seconds": 10, "assistant.office_reads": true },
  fields: [
    { key: "assistant.enabled", label: `Run the personal assistants on this PC ${EVIL}`, type: "bool" },
    { key: "assistant.evening_at", label: "Evening briefing (about tomorrow) at", type: "briefing" },
    { key: "assistant.model", label: "Model", type: "enum", choices: [{ key: "claude-opus-5-5", label: `Claude Opus 5.5 ${EVIL}` }, { key: `x${EVIL}`, label: "Other" }] },
    { key: "assistant.poll_seconds", label: "Check every (seconds)", type: "int", lo: 3, hi: 600, help: `help ${EVIL}` },
    { key: "assistant.office_reads", label: "The office can read the conversations", type: "bool" },
  ] } } };
}

function world(over = {}) {
  return (method, args) => {
    if (over[method]) return over[method](args);
    switch (method) {
      case "assistants.list": return list();
      case "assistants.employee": return employee();
      case "settings.get": return settings();
      default: return {};
    }
  };
}

async function open(parts = [], query = {}, opts = {}) {
  const page = loadTab("console-assistants.js", { answer: world(opts.over || {}), ...opts });
  await page.open(parts, query);
  return page;
}

function noRaw(html) {
  assert.ok(!/<img/i.test(html), "no raw <img anywhere");
  assert.ok(!/<script/i.test(html), "no raw <script");
  assert.ok(!/href="(?!#\/)/.test(html), "every link is a route of this page");
  assert.ok(!/\son[a-z]+="/i.test(html), "no inline handlers");
}

/* ── the tab ─────────────────────────────────────────────────────────── */

test("registers the assistants tab once, at its place, and draws the list beside the employee", async () => {
  const page = await open([LUIS]);
  assert.equal(page.def.id, "assistants");
  assert.equal(page.def.order, 60);
  assert.equal(page.def.title, "Assistants");
  assert.equal(typeof page.def.leave, "function");
  assert.deepEqual(page.calls.map((c) => c.method).sort(), ["assistants.employee", "assistants.list"]);
  assert.deepEqual(page.last("assistants.employee").args, { name: LUIS });
  assert.ok(page.calls.every((c) => c.opts.quiet), "the page says what went wrong itself");
  assert.match(page.root.innerHTML, /class="cas-grid has-detail"/);
  const side = page.el("casSide").innerHTML;
  assert.match(side, /2 assistants on/);
  assert.match(side, /1 waiting for an answer/);
  assert.match(side, /class="cas-row sel" href="#\/assistants\/Luis%20Martinez" aria-current="page"/);
  assert.match(side, /href="#\/assistants\?view=settings"/);
  assert.match(page.el("casTitle").innerHTML, /^Luis Martinez$/);
});

test("everything the server sends is escaped — the list, every page of an employee, the settings — and no link leaves the console", async () => {
  for (const view of ["conversation", "items", "notes", "briefings", "log", "ask"]) {
    const page = await open([LUIS], { view });
    const html = page.html();
    noRaw(html);
    assert.ok(html.includes(esc(EVIL)), `${view}: the words are still there, as text`);
  }
  const s = await open([], { view: "settings" });
  noRaw(s.html());
  assert.ok(s.html().includes(esc(`Claude Opus 5.5 ${EVIL}`)));
  assert.ok(s.html().includes(`value="${esc(`x${EVIL}`)}"`), "a choice's key is escaped in its attribute");
  assert.ok(!/\sstyle="/.test(SRC), "no inline styles built from data");
  assert.ok(!/innerHTML\s*=\s*[^;]*\+\s*(d|r|m|it|n|x)\.[a-z_]+\s*[;+]/.test(SRC.replace(/esc\([^)]*\)/g, "")), "no server value goes into markup unescaped");
});

test("the list filters on and off, and an empty list says why", async () => {
  const page = await open();
  assert.match(page.el("casMain").innerHTML, /Pick an employee/);
  await page.change(target({ "data-cas": "filter" }, { value: "off" }));
  const off = page.el("casSide").innerHTML;
  assert.ok(off.includes("Sam Field") && off.includes("Pat Gone") && !off.includes("Luis Martinez"));
  await page.change(target({ "data-cas": "filter" }, { value: "on" }));
  assert.ok(!page.el("casSide").innerHTML.includes("Sam Field"));
  const none = await open([], {}, { over: { "assistants.list": () => list({ rows: [], counts: { on: 0, waiting: 0 }, can_turn_on_all: false }) } });
  assert.match(none.el("casSide").innerHTML, /Nobody here — employees with a portal account show up once People has been read/);
  assert.match(none.el("casSide").innerHTML, /data-cas="all-on" data-act data-method="assistants.set_on" disabled/);
});

test("“Turn on for everyone” asks the server's question, with its checkbox, and sends only those with an account who are off", async () => {
  const seen = [];
  const page = await open([], {}, {
    over: { "assistants.set_on": (a) => { seen.push(a); return a.confirmed ? { words: "2 turned on.", sentences: ["on", "on"] }
      : { confirm: { title: "Turn on the assistant", question: "Turn on the personal assistant for 1 people?", ok_text: "Turn on", danger: false,
        twice: null, extra: [{ name: "also_enable_here", label: "Also run the assistants on the DCR server computer", type: "checkbox", value: true }] } }; } },
    confirm: (c) => ({ also_enable_here: c.extra[0].value }),
  });
  await page.click({ "data-cas": "all-on" });
  assert.deepEqual(seen[0], { names: ["Sam Field"], on: true }, "not Pat (no account), not those already on");
  assert.deepEqual(seen[1], { names: ["Sam Field"], on: true, also_enable_here: true, confirmed: true });
  assert.equal(page.confirms.length, 1);
  assert.ok(page.count("assistants.list") >= 2, "the list is read again after the change");
  const declined = await open([], {}, { over: { "assistants.set_on": () => ({ confirm: { title: "t", question: "q" } }) }, confirm: () => false });
  await declined.click({ "data-cas": "all-on" });
  assert.equal(declined.count("assistants.set_on"), 1, "a no changes nothing");
});

/* ── one employee ────────────────────────────────────────────────────── */

test("an employee's header: chip, notice, and the buttons the server allows — every write marked for the shell", async () => {
  const page = await open([LUIS]);
  const main = page.el("casMain").innerHTML;
  assert.match(main, /class="c-banner info"/, "a blue notice is the shell's info banner");
  assert.match(main, /data-cas="briefing" data-kind="evening" data-act data-method="assistants.briefing.send">Send tomorrow's briefing now/);
  assert.match(main, /data-cas="briefing" data-kind="weekly" data-act data-method="assistants.briefing.send">Send next week's briefing now/);
  assert.match(main, /data-cas="toggle" data-act data-method="assistants.set_on">Turn off/);
  assert.match(main, /href="#\/assistants\/Luis%20Martinez\?view=ask"/);
  for (const v of ["conversation", "items", "notes", "briefings", "log", "ask"]) assert.match(main, new RegExp(`\\?view=${v}"`));
  const off = await open([LUIS], {}, { over: { "assistants.employee": () => employee({ can: { toggle: false, briefing: false, add: false, ask_as: false } }) } });
  assert.match(off.el("casMain").innerHTML, /data-kind="evening" data-act data-method="assistants.briefing.send" disabled/);
  assert.match(off.el("casMain").innerHTML, /data-cas="toggle" data-act data-method="assistants.set_on" disabled/);
});

test("turning one assistant off and sending a briefing go through the server's question; the answer is said under the header", async () => {
  const seen = [];
  const page = await open([LUIS], {}, {
    over: {
      "assistants.set_on": (a) => { seen.push(["set_on", a]); return a.confirmed ? { words: "Luis's assistant is off.", sentences: ["off"] } : { confirm: { title: "Turn off", question: "Turn off Luis's assistant?", danger: true } }; },
      "assistants.briefing.send": (a) => { seen.push(["briefing", a]); return a.confirmed ? { words: "Luis: recorded (dry run)." } : { confirm: { title: "Send a briefing now", question: "Send Luis next week's briefing now?" } }; },
    },
  });
  await page.click({ "data-cas": "toggle" });
  assert.deepEqual(seen.slice(0, 2), [["set_on", { names: [LUIS], on: false }], ["set_on", { names: [LUIS], on: false, confirmed: true }]]);
  assert.equal(page.text("casSay"), "Luis's assistant is off.");
  await page.click({ "data-cas": "briefing", "data-kind": "weekly" });
  assert.deepEqual(seen.slice(2), [["briefing", { name: LUIS, kind: "weekly" }], ["briefing", { name: LUIS, kind: "weekly", confirmed: true }]]);
  assert.match(page.last("assistants.briefing.send").opts.text, /Writing Luis's briefing and sending it… \(Claude can take a minute\)/);
  assert.equal(page.text("casSay"), "Luis: recorded (dry run).");
});

test("the conversation is read only; a private one says why and offers nothing to teach from", async () => {
  const page = await open([LUIS]);
  const v = page.el("casView").innerHTML;
  assert.match(v, /class="cas-msg user"/);
  assert.match(v, /class="cas-msg office"/);
  assert.equal((v.match(/data-cas="teach"/g) || []).length, 3, "one “Teach from this…” per message");
  assert.match(v, /data-method="training.coach.ask"/);
  assert.ok(!/<textarea|<input/.test(v), "nothing to type into: read only");
  const hidden = await open([LUIS], {}, { over: { "assistants.employee": () => employee({ conversation: null, hidden: `Luis's conversation is private ${EVIL}` }) } });
  assert.match(hidden.el("casView").innerHTML, /^<div class="c-empty">Luis&#39;s conversation is private &lt;img/);
  assert.ok(!/data-cas="teach"/.test(hidden.el("casView").innerHTML));
  const none = await open([LUIS], {}, { over: { "assistants.employee": () => employee({ conversation: [], empty: "No messages yet. When Luis writes…" }) } });
  assert.match(none.el("casView").innerHTML, /No messages yet\. When Luis writes…/);
});

test("“Teach from this…” puts the message in the Coach's box for this employee and opens Training there — never in the address", async () => {
  const page = await open([LUIS]);
  await page.click({ "data-cas": "teach", "data-i": "0" });
  const want = `In Luis's chat, Luis wrote: «Remind me ${EVIL}» — `;
  assert.equal(page.store.get(DRAFT), want, "the desktop's teach_text, kept for the Training tab");
  assert.deepEqual(page.clipboard, [want], "and on the clipboard, like the desktop");
  assert.deepEqual(page.gone, ["training/employee%3ALuis%20Martinez?view=coach"]);
  assert.ok(!page.gone[0].includes("Remind"), "the words are not in the address");
  assert.match(page.toasts.at(-1).text, /with the message in the Coach's box/);
  /* a draft already there is kept; the message is only on the clipboard */
  await page.click({ "data-cas": "teach", "data-i": "1" });
  assert.equal(page.store.get(DRAFT), want);
  assert.match(page.toasts.at(-1).text, /and the message is on the clipboard: paste it to the Coach/);
  const H = page.win.DCRConsoleAssistants;
  assert.equal(H.teachText({ role: "assistant", text: "  a\n\n b  " }, "Luis"), "In Luis's chat, the assistant wrote: «a b» — ");
  const long = H.teachText({ role: "user", text: "x".repeat(700) }, "Luis");
  assert.equal(long, "In Luis's chat, Luis wrote: «" + "x".repeat(599) + "…» — ");
});

/* ── reminders, to-dos and events ────────────────────────────────────── */

test("the items list, and “Add for them…” checked by the server before it is added — an event with its end and reminder", async () => {
  const page = await open([LUIS], { view: "items" });
  const v = page.el("casView").innerHTML;
  assert.match(v, /class="cas-item done"/);
  assert.match(v, /data-cas="item-open" data-act data-method="assistants.item.add">Add for them…/);
  await page.click({ "data-cas": "item-open" });
  assert.ok(page.el("casItemForm"), "the form opens in place");
  assert.equal(page.el("casItDueRow").hidden, true, "no due day for an event");
  page.el("casItText").value = "  Truss   delivery ";
  page.el("casItAt").value = "2026-10-12T07:00";
  page.el("casItHasEnd").checked = true;
  page.el("casItEnd").value = "2026-10-12T09:30";
  page.el("casItRemind").value = "60";
  page.el("casItLoc").value = "A068";
  await page.submit("casItemForm");
  const item = { kind: "event", text: "Truss delivery", location: "A068", notes: "", at: "2026-10-12T07:00", end: "2026-10-12T09:30", remind: 60 };
  assert.deepEqual(page.last("assistants.item.check").args, { name: LUIS, item });
  assert.deepEqual(page.last("assistants.item.add").args, { name: LUIS, item });
  assert.ok(page.count("assistants.employee") >= 2, "the page is read again");
});

test("a reminder and a to-do send only their own fields; a refusal stays in the form and nothing is added", async () => {
  const page = await open([LUIS], { view: "items" }, { over: { "assistants.item.check": () => { throw refusal("refused", `The time must be ahead ${EVIL}`); } } });
  await page.click({ "data-cas": "item-open" });
  await page.change(target({ "data-cas": "kind" }, { value: "reminder" }));
  assert.equal(page.el("casItEndRow").hidden, true);
  assert.equal(page.el("casItAtLabel").textContent, "When");
  page.el("casItText").value = "Call the yard";
  page.el("casItAt").value = "2026-10-12T15:00";
  await page.submit("casItemForm");
  assert.deepEqual(page.last("assistants.item.check").args.item, { kind: "reminder", text: "Call the yard", location: "", notes: "", at: "2026-10-12T15:00" });
  assert.equal(page.count("assistants.item.add"), 0);
  assert.equal(page.el("casItErr").textContent, `The time must be ahead ${EVIL}`, "set as text");
  await page.change(target({ "data-cas": "kind" }, { value: "todo" }));
  assert.equal(page.el("casItTimed").hidden, true);
  assert.equal(page.el("casItDueRow").hidden, false);
  page.el("casItHasDue").checked = true;
  page.el("casItDue").value = "2026-10-20";
  await page.submit("casItemForm");
  assert.deepEqual(page.last("assistants.item.check").args.item, { kind: "todo", text: "Call the yard", location: "", notes: "", due: "2026-10-20" });
  page.el("casItText").value = "";
  const before = page.count("assistants.item.check");
  await page.submit("casItemForm");
  assert.equal(page.el("casItErr").textContent, "Say what it is.");
  assert.equal(page.count("assistants.item.check"), before, "nothing asked without words");
  assert.match(page.ctx.guardFn() || "", /^$/, "nothing typed: nothing to lose");
  page.el("casItText").value = "half typed";
  assert.match(page.ctx.guardFn(), /has not been added yet/, "leaving asks first while words are typed");
});

/* ── the office's notes ──────────────────────────────────────────────── */

test("office notes: add one as a Training rule on this employee, edit, turn off, delete — a refusal opens the note again", async () => {
  let refuse = true;
  const page = await open([LUIS], { view: "notes" }, {
    over: {
      "training.rule.add": () => { if (refuse) { refuse = false; throw refusal("refused", "Leave out phone numbers."); } return { id: 13, words: "Rule added." }; },
      "training.rule.delete": (a) => (a.confirmed ? { words: "Rule deleted." } : { confirm: { title: "Delete the rule", question: "Delete this rule?", danger: true } }),
    },
    modal: [{ text: "  Call   him at 555-0100 " }, (o) => ({ text: o.fields[0].value.replace(/ at 555-0100/, "") })],
  });
  const v = page.el("casView").innerHTML;
  assert.match(v, /data-cas="note-on" data-id="11" data-act data-method="training.rule.update" checked/);
  assert.match(v, /class="cas-noterow off"/);
  assert.match(v, /href="#\/training\/employee%3ALuis%20Martinez"/);
  await page.click({ "data-cas": "note-add" });
  assert.deepEqual(page.calls.filter((c) => c.method === "training.rule.add").map((c) => c.args), [
    { scope: SCOPE, text: "Call him at 555-0100", category: "facts" },
    { scope: SCOPE, text: "Call him", category: "facts" },
  ]);
  assert.equal(page.modals[0].title, "A note about Luis");
  assert.match(page.modals[1].message, /^Leave out phone numbers\.\n\n/, "the reason, then the dialog again");
  assert.equal(page.modals[1].title, "A note about Luis", "still a new note");
  assert.equal(page.text("casSay"), "Luis's assistant reads that from the next answer on.");
  page.modalAnswers.push({ text: "Foreman at A071" });
  await page.click({ "data-cas": "note-edit", "data-id": "11" });
  assert.deepEqual(page.last("training.rule.update").args, { id: 11, text: "Foreman at A071" });
  const box = target({ "data-cas": "note-on", "data-id": "11" }, { checked: false });
  await page.change(box);
  assert.deepEqual(page.last("training.rule.update").args, { id: 11, active: false });
  assert.match(page.text("casSay"), /no longer uses that note/);
  await page.click({ "data-cas": "note-del", "data-id": "11" });
  assert.deepEqual(page.calls.filter((c) => c.method === "training.rule.delete").map((c) => c.args), [{ id: 11 }, { id: 11, confirmed: true }]);
  page.modalAnswers.push({ text: "x".repeat(501) });
  await page.click({ "data-cas": "note-add" });
  assert.match(page.modals.at(-1).problem, /Keep it under 500 characters/);
});

test("a note that cannot be turned off is ticked again", async () => {
  const page = await open([LUIS], { view: "notes" }, { over: { "training.rule.update": () => { throw refusal("not_found", "That rule is no longer here."); } } });
  const box = target({ "data-cas": "note-on", "data-id": "11" }, { checked: false });
  await page.change(box);
  assert.equal(box.checked, true);
  assert.equal(page.text("casSay"), "That rule is no longer here.");
});

/* ── briefings, log, the private test ───────────────────────────────── */

test("briefings open to read as they went, and the log shows today's use", async () => {
  const b = await open([LUIS], { view: "briefings" });
  assert.match(b.el("casView").innerHTML, /<details class="cas-brief" open><summary>Fri Oct 9 &lt;img/);
  assert.match(b.el("casView").innerHTML, /<pre>Tomorrow: A068 &lt;img/);
  const l = await open([LUIS], { view: "log" });
  assert.match(l.el("casView").innerHTML, /6,520/);
  assert.match(l.el("casView").innerHTML, /Today: 2 answers &lt;img/);
  const none = await open([LUIS], { view: "briefings" }, { over: { "assistants.employee": () => employee({ briefings: [] }) } });
  assert.match(none.el("casView").innerHTML, /No briefing prepared yet/);
});

test("“Ask as this employee” keeps the test on this page and lists what it would do, without repeating item cards", async () => {
  const page = await open([LUIS], { view: "ask" }, {
    over: { "assistants.ask_as": () => ({ ok: true, text: `Sure ${EVIL}`, cards: [{ type: "item", itemId: "i_9" }, { type: "email", to: "a@b.test" }],
      items: [{ op: "add" }], cards_words: ["An item on their list", `Email draft to a@b.test ${EVIL}`], items_words: [`would add a reminder ${EVIL}`],
      note: "A private test" }) },
  });
  assert.match(page.el("casView").innerHTML, /\(Nothing asked yet\.\)/);
  page.el("casAskText").value = "What do I have tomorrow?";
  await page.submit("casAskForm");
  assert.deepEqual(page.last("assistants.ask_as").args, { name: LUIS, text: "What do I have tomorrow?" });
  const v = page.el("casView").innerHTML;
  assert.match(v, /Luis \(test\)/);
  assert.match(v, /would add a reminder &lt;img/);
  assert.match(v, /Email draft to a@b\.test &lt;img/);
  assert.ok(!v.includes("An item on their list"), "the item op already says it");
  assert.deepEqual(page.busy, ["Luis's assistant is thinking… (up to a minute)"]);
  await page.open([LUIS], { view: "conversation" });
  await page.open([LUIS], { view: "ask" });
  assert.match(page.el("casView").innerHTML, /Luis \(test\)/, "still there when the page is drawn again");
  assert.equal(page.count("assistants.employee"), 1, "a page a moment old is not asked for again");
  const noAi = await open(["Sam Field"], { view: "ask" }, { over: { "assistants.employee": () => employee({ row: list().rows[2], ai: { ok: false, words: `no key ${EVIL}` } }) } });
  assert.match(noAi.el("casView").innerHTML, /The assistant needs Claude for this \(no key &lt;img/);
  assert.match(noAi.el("casView").innerHTML, /id="casAskBtn" data-method="assistants.ask_as" disabled/);
  const failed = await open([LUIS], { view: "ask" }, { over: { "assistants.ask_as": () => { throw refusal("refused", "Claude said no"); } } });
  failed.el("casAskText").value = "hi";
  await failed.submit("casAskForm");
  assert.match(failed.el("casView").innerHTML, /No answer<\/div><div class="cas-bubble">Claude said no/);
});

test("a page a minute old is drawn at once and asked for again: drawn again only if it changed, and what was typed stays", async () => {
  let version = 1;
  const page = await open([LUIS], { view: "ask" }, { over: { "assistants.employee": () => employee({ subtitle: `v${version}` }) } });
  page.win.DCRConsoleAssistants.state.empAt = 0;                 // a minute and more ago
  let release;
  page.ctx.rpc = ((orig) => (m, a, o) => (m === "assistants.employee" ? new Promise((r) => { release = () => r(orig(m, a, o)); }) : orig(m, a, o)))(page.ctx.rpc);
  const p = page.open([LUIS], { view: "ask" });
  await new Promise((r) => setImmediate(r));
  const box = page.el("casAskText");
  assert.ok(box, "drawn at once from what was here");
  box.value = "half a question";
  release();
  await p;
  await new Promise((r) => setImmediate(r));
  assert.equal(page.el("casAskText"), box, "the same answer: not drawn again");
  page.win.DCRConsoleAssistants.state.empAt = 0;
  version = 2;
  const q = page.open([LUIS], { view: "ask" });
  await new Promise((r) => setImmediate(r));
  page.el("casAskText").value = "typed while it loaded";
  release();
  await q;
  await new Promise((r) => setImmediate(r));
  assert.match(page.el("casMain").innerHTML, /v2/, "a changed answer is drawn");
  assert.equal(page.el("casAskText").value, "typed while it loaded", "and the words typed meanwhile stay");
});

/* ── settings for every assistant ───────────────────────────────────── */

test("settings for every assistant: only what changed is saved, with the change check, and the pages are offered the news", async () => {
  const seen = [];
  const page = await open([], { view: "settings" }, {
    over: {
      "settings.save": (a) => { seen.push(a); return { rev: "fedcba9876543210", words: "Saved.", effects: ["offer_tell_pages"] }; },
      "assistants.tell_pages": (a) => (a.confirmed ? { words: "2 pages updated." } : { confirm: { title: "Tell the employees' pages", question: "Tell the 2 assistants?" } }),
    },
  });
  assert.equal(page.el("casSet_assistant_evening_at").getAttribute("min"), "12:00");
  assert.equal(page.el("casSet_assistant_evening_at").getAttribute("max"), "20:45");
  await page.submit("casSetForm");
  assert.equal(page.count("settings.save"), 0, "nothing changed: nothing sent");
  assert.equal(page.text("casSay"), "Nothing changed.");
  page.el("casSet_assistant_office_reads").checked = false;
  page.el("casSet_assistant_poll_seconds").value = "15";
  await page.submit("casSetForm");
  assert.deepEqual(seen[0], { section: "assistant", values: { "assistant.poll_seconds": 15, "assistant.office_reads": false }, rev: "0123456789abcdef" });
  assert.deepEqual(page.calls.filter((c) => c.method === "assistants.tell_pages").map((c) => c.args), [{ reads: false }, { reads: false, confirmed: true }]);
  assert.equal(page.text("casSay"), "Saved. 2 pages updated.");
  page.el("casSet_assistant_poll_seconds").value = "1.5";
  await page.submit("casSetForm");
  assert.equal(page.el("casSetErr").textContent, "Check every (seconds) must be a whole number.");
});

test("a stale save says so in the form", async () => {
  const page = await open([], { view: "settings" }, { over: { "settings.save": () => { throw refusal("changed", "Someone changed this since you opened it — reload and try again."); } } });
  page.el("casSet_assistant_enabled").checked = false;
  await page.submit("casSetForm");
  assert.match(page.el("casSetErr").textContent, /Someone changed this since you opened it/);
});

/* ── when things go wrong ───────────────────────────────────────────── */

test("a list or a page that cannot be read shows the shell's error with Try again; a late answer for a page that is gone is dropped", async () => {
  const page = await open([LUIS], {}, { over: { "assistants.employee": () => { throw refusal("offline", `The DCR server is offline ${EVIL}`); },
    "assistants.list": () => { throw refusal("offline", "The DCR server is offline"); } } });
  assert.match(page.el("casMain").innerHTML, /class="c-error"[\s\S]*The DCR server is offline &lt;img[\s\S]*data-c-retry/);
  assert.match(page.el("casSide").innerHTML, /class="c-error"/);
  let release;
  const slow = loadTab("console-assistants.js", { answer: (m) => (m === "assistants.employee" ? new Promise((r) => { release = r; }) : list()) });
  const p = slow.open([LUIS]);
  await new Promise((r) => setImmediate(r));
  const firstMain = slow.el("casMain");
  slow.def.leave();
  release(employee());
  await p;
  assert.match(firstMain.innerHTML, /c-skel/, "the old page is left alone");
});

test("the page source: no inline handlers, links only from encodeURIComponent, the draft key the Training tab reads", () => {
  assert.ok(!/\son[a-z]+=/i.test(SRC.replace(/\/\*[\s\S]*?\*\//g, "")));
  assert.ok(!/javascript:/i.test(SRC));
  assert.match(SRC, /var DRAFT_PREFIX = "dcr\.console\.training\.draft\.v1:";/);
  const training = readFileSync(new URL("../../site/js/console/console-training.js", import.meta.url), "utf8");
  assert.match(training, /var DRAFT_PREFIX = "dcr\.console\.training\.draft\.v1:";/, "the same key on both tabs");
  const html = readFileSync(new URL("../../site/agents-console.html", import.meta.url), "utf8");
  assert.ok(html.indexOf("console-assistants.js") < html.indexOf("console-training.js"), "loaded in the tab order");
});
