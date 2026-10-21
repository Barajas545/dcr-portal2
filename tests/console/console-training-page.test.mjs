/* The DCR Agents web console's Training tab (site/js/console/console-training.js),
   run in a small stand-in for the browser and the shell's ctx
   (lib/console-tab-stub.mjs) against answers shaped like the DCR server's
   (console-spec §6.1.11, console/handlers_training.py). Everything the
   server sends comes out escaped; a Coach card is applied by its answer's
   id and its place (never by sending the proposal); a person's facts send
   only what changed; every delete, the smart-wording switch, forgetting
   everything and an import go through the server's own question
   (ctx.act); an import too large for the relay is never sent. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EVIL, esc, loadTab, refusal, target } from "./console-tab-stub.mjs";

const SRC = readFileSync(new URL("../../site/js/console/console-training.js", import.meta.url), "utf8");
const LUIS = "employee:Luis Martinez";
const AGENT = "agent:ab12cd34";
const DRAFT = (s) => "dcr.console.training.draft.v1:" + s;
const plain = (v) => JSON.parse(JSON.stringify(v));   // out of the vm's realm

function tree(over = {}) {
  return {
    nodes: [
      { scope: "company", name: `The whole company ${EVIL}`, suffix: " · 3 rules", header: false, dim: false, tip: `Rules every agent ${EVIL}`, children: [] },
      { scope: "replies", name: "Reading replies", suffix: " · 1 rule · 2 examples", header: false, dim: false, tip: "", children: [] },
      { scope: null, name: "Agents", suffix: "  2", header: true, dim: false, tip: "", children: [
        { scope: AGENT, name: `Timesheet reminder ${EVIL}`, suffix: " · Claude writes · 1 rule", header: false, dim: false, tip: "", children: [] },
        { scope: "agent:zz", name: "Old agent", suffix: "", header: false, dim: true, tip: "Old agent — off", children: [] },
        { scope: "photo:playbook", name: "Photo & Video Playbook", suffix: " · on its own tab", header: false, dim: false, tip: "", children: [] },
      ] },
      { scope: "assistant", name: "Personal assistants", suffix: "", header: false, dim: false, tip: "", children: [] },
      { scope: null, name: "People", suffix: "  1", header: true, dim: false, tip: "", children: [
        { scope: LUIS, name: `Luis Martinez ${EVIL}`, suffix: " · Spanish · notes", header: false, dim: false, tip: "", children: [] },
      ] },
    ],
    smart_on: true, coach: { ok: true, words: `Claude Opus 5.5 ${EVIL}` },
    ...over,
  };
}

function card(n, over = {}) {
  return { n, type: "add_rule", summary: `Use first names ${EVIL}`, where: `For the whole company ${EVIL}`, kind_words: "New rule", tone: "purple",
    category_words: "Tone", why: `because ${EVIL}`, preview: { ok: true, before: "", after: "", problems: [] }, handled: "", said: "", state: "", already: false, ...over };
}

function scope(s = "company", over = {}) {
  const base = {
    scope: s, photo: false,
    describe: { title: `The whole company ${EVIL}`, subtitle: `Every agent ${EVIL}`, head_button: "", example: `e.g. “We're closed ${EVIL}”` },
    chips: [{ text: `On ${EVIL}`, tone: "green", tip: `tip ${EVIL}` }],
    intro: `Tell the coach how the company works ${EVIL}`, rule_hint: `One short instruction ${EVIL}`, rules_title: "Rules",
    rules_hint: `Every agent and assistant follows these. ${EVIL}`, examples_hint: `Examples ${EVIL}`, lessons_hint: `Everything taught lately ${EVIL}`,
    categories: ["tone", "language", "facts", "schedule", "wording", "watch", "privacy", "other"],
    rules: [
      { id: 1, scope: s, text: `Use first names only ${EVIL}`, category: "tone", active: true, source: "admin", created_at: "x",
        category_words: `Tone ${EVIL}`, source_words: `you ${EVIL}`, added_words: `Oct 1 ${EVIL}` },
      { id: 2, scope: s, text: "Closed the Friday after Thanksgiving", category: "schedule", active: false, source: "coach", created_at: "x",
        category_words: "Schedule", source_words: "the coach", added_words: "Oct 2" },
    ],
    facts: null, examples: null, wording: null,
    lessons: [{ at: "x", when: `Fri Oct 9 13:00 ${EVIL}`, scope: AGENT, scope_words: `Timesheet reminder ${EVIL}`, action: "add_rule",
      action_words: `Rule added ${EVIL}`, detail: `Use first names — by Ana Admin on the web ${EVIL}` }],
    coach: { ok: true, words: "Claude", note: "", history: [
      { id: 40, role: "user", content: `We use first names ${EVIL}`, created_at: "x", when: "Fri Oct 9 12:58", actions: [] },
      { id: 41, role: "assistant", content: `Here is a rule ${EVIL}`, created_at: "x", when: "Fri Oct 9 12:59", actions: [
        card(0),
        card(1, { type: "agent_setting", kind_words: "Agent setting", tone: "amber", where: "Timesheet reminder", summary: "schedule.at: 05:30",
          preview: { ok: true, before: `Daily at 06:00 ${EVIL}`, after: `Daily at 05:30 ${EVIL}`, problems: [] }, category_words: "" }),
        card(2, { handled: "applied", said: `Rule added ${EVIL}`, state: "Applied ✓", preview: { ok: false, before: "", after: "", problems: [] } }),
        card(3, { preview: { ok: false, before: "", after: "", problems: [`That rule is already here ${EVIL}`] }, state: "Nothing to apply", already: true }),
      ] },
    ] },
  };
  return { ...base, ...over };
}

function luis(over = {}) {
  return scope(LUIS, {
    describe: { title: "Luis Martinez", subtitle: "Every agent follows Luis's time away", head_button: "Open the Assistants tab", example: "e.g. “Luis is on vacation”" },
    rules_title: "Notes from the office about Luis",
    facts: { language: "es", away_from: "2026-10-12", away_to: "", quiet_days: [6, 5], notes: `Works nights ${EVIL}`, status: `Nothing holds today ${EVIL}` },
    ...over,
  });
}

function agent(over = {}) {
  return scope(AGENT, {
    describe: { title: "Timesheet reminder", subtitle: "Watches: Timesheets.", head_button: "Open in the agent editor…", example: "e.g. Start at 5:30" },
    examples: [{ id: 7, agent_id: "ab12cd34", input: `8 a081 ${EVIL}`, meaning: `8 hours on A081 ${EVIL}`, source: "coach", created_at: "x",
      source_words: "the coach", added_words: "Oct 3" }],
    wording: { status: `Claude rewrites ${EVIL}`, template: { subject: `Hours ${EVIL}`, body: "Hi {first}, log your hours.", sms: "Log hours" },
      rows: [
        { id: 31, at: "2026-10-09T15:00:00+00:00", person: "Luis Martinez", language: "es", language_words: "Spanish", subject: `Horas ${EVIL}`,
          body: `Hola Luis ${EVIL}`, sms: "Horas", uses: 3 },
        { id: 32, at: "2026-10-08T15:00:00+00:00", person: "", language: "", language_words: "English", subject: "Hours today", body: "Hi", sms: "", uses: 1 },
      ] },
    ...over,
  });
}

function world(over = {}) {
  return (method, args) => {
    if (over[method]) return over[method](args);
    if (method === "training.tree") return tree();
    if (method === "training.scope") return args.scope === LUIS ? luis() : args.scope === AGENT ? agent() : scope(args.scope);
    return {};
  };
}

async function open(parts = [], query = {}, opts = {}) {
  const page = loadTab("console-training.js", { answer: world(opts.over || {}), ...opts });
  await page.open(parts, query);
  return page;
}

function noRaw(html) {
  assert.ok(!/<img/i.test(html), "no raw <img anywhere");
  assert.ok(!/<script/i.test(html), "no raw <script");
  assert.ok(!/href="(?!#\/)/.test(html), "every link is a route of this page");
  assert.ok(!/\son[a-z]+="/i.test(html), "no inline handlers");
}

/* ── the tab, the top bar and the list ───────────────────────────────── */

test("registers the training tab once at its place; the top bar and the list of everything that can be taught", async () => {
  const page = await open();
  assert.equal(page.def.id, "training");
  assert.equal(page.def.order, 70);
  assert.equal(page.def.title, "Training");
  assert.deepEqual(page.calls.map((c) => c.method), ["training.tree"], "a phone opens on the list alone");
  const top = page.el("ctTop").innerHTML;
  assert.match(top, /id="ctSmart" data-ct="smart" data-act data-method="training.smart" checked/);
  assert.match(top, /data-ct="export" data-method="training.export">Export…/);
  assert.match(top, /data-ct="import" data-act data-method="training.import">Import…/);
  const t = page.el("ctTree").innerHTML;
  assert.match(t, /href="#\/training\/employee%3ALuis%20Martinez"/);
  assert.match(t, /href="#\/training\/photo%3Aplaybook"/);
  assert.match(t, /class="ct-node dim"/);
  assert.match(t, /<span class="ct-nsuf">Claude writes · 1 rule<\/span>/, "the leading dot goes; the rest is the server's");
  const wide = await open([], {}, { wide: true });
  assert.deepEqual(wide.calls.map((c) => c.method).sort(), ["training.scope", "training.tree"], "a wide screen opens on the whole company");
  assert.deepEqual(wide.last("training.scope").args, { scope: "company" });
  assert.match(wide.el("ctTree").innerHTML, /class="ct-node sel" href="#\/training\/company"/);
});

test("everything the server sends is escaped on every page of a scope, in the list and in the Coach's cards", async () => {
  for (const [parts, view] of [[["company"], "knows"], [["company"], "lessons"], [["company"], "coach"], [[LUIS], "knows"],
    [[AGENT], "examples"], [[AGENT], "wording"]]) {
    const page = await open(parts, { view });
    const html = page.html();
    noRaw(html);
    assert.ok(html.includes(esc(EVIL)), `${parts[0]} ${view}: the words are still there, as text`);
  }
  const photo = await open(["photo:playbook"], {}, { over: { "training.scope": () => ({ scope: "photo:playbook", photo: true,
    describe: { title: `Photo & Video Playbook ${EVIL}`, subtitle: "", head_button: "" }, photo_count: `The Playbook has 4 rules ${EVIL}.` }) } });
  noRaw(photo.html());
  assert.match(photo.el("ctMain").innerHTML, /href="#\/photo\/playbook"/);
  assert.match(photo.el("ctMain").innerHTML, /The Playbook has 4 rules &lt;img/);
});

test("the search asks the server once the typing stops", async () => {
  const page = await open();
  const box = page.el("ctSearch");
  box.value = "lu";
  await page.input(box);
  box.value = "luis";
  await page.input(box);
  assert.equal(page.count("training.tree"), 1, "nothing asked while typing");
  const waits = [...page.timers.values()];
  assert.equal(waits.length, 1, "each key starts the wait again");
  assert.ok(waits[0].ms >= 500, "it waits for the typing to stop");
  page.runTimers(600);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(page.last("training.tree").args, { q: "luis" });
  assert.equal(page.count("training.tree"), 2, "once, for the last words");
});

/* ── a scope's page ──────────────────────────────────────────────────── */

test("a scope's tabs follow what it has; an agent links to its editor, a person to their assistant", async () => {
  const co = await open(["company"]);
  const main = co.el("ctMain").innerHTML;
  assert.ok(!/view=examples/.test(main) && !/view=wording/.test(main), "the whole company has neither examples nor Claude's messages");
  assert.match(main, /href="#\/training\/company\?view=lessons"/);
  assert.match(main, /class="ct-tab coach" href="#\/training\/company\?view=coach"/);
  const ag = await open([AGENT]);
  assert.match(ag.el("ctMain").innerHTML, /view=examples/);
  assert.match(ag.el("ctMain").innerHTML, /view=wording/);
  assert.match(ag.el("ctMain").innerHTML, /href="#\/agents\/edit\/ab12cd34">Open in the agent editor<\/a>/);
  const lu = await open([LUIS]);
  assert.match(lu.el("ctMain").innerHTML, /href="#\/assistants\/Luis%20Martinez">Open the Assistants tab<\/a>/);
  assert.match(lu.el("ctMain").innerHTML, /<h3>Notes from the office about Luis<\/h3>/);
});

test("rules: add one in a single line, edit only what changed, a refusal opens the rule again, turn one off, delete after the question", async () => {
  let refuse = true;
  const page = await open(["company"], {}, {
    over: {
      "training.rule.add": () => { if (refuse) { refuse = false; throw refusal("refused", "No phone numbers in a rule."); } return { id: 3, words: "Rule added." }; },
      "training.rule.delete": (a) => (a.confirmed ? { words: "Rule deleted." } : { confirm: { title: "Delete the rule", question: "Delete this rule?", danger: true } }),
    },
    modal: [{ text: "Call 555-0100\nfirst", category: "tone" }, { text: "Call the office first", category: "tone" }],
  });
  assert.match(page.el("ctLeft").innerHTML, /data-ct="rule-on" data-id="1" data-act data-method="training.rule.update" checked/);
  assert.match(page.el("ctLeft").innerHTML, /class="ct-rule off"/);
  await page.click({ "data-ct": "rule-add" });
  assert.deepEqual(page.calls.filter((c) => c.method === "training.rule.add").map((c) => c.args), [
    { scope: "company", text: "Call 555-0100 first", category: "tone" },
    { scope: "company", text: "Call the office first", category: "tone" },
  ]);
  assert.equal(page.modals[0].title, "Add a rule");
  assert.match(page.modals[0].message, /One short instruction/);
  assert.match(page.modals[1].message, /^No phone numbers in a rule\.\n\n/);
  assert.equal(page.text("ctSay"), "Rule added.");
  page.modalAnswers.push({ text: `Use first names only ${EVIL}`, category: "language" });
  await page.click({ "data-ct": "rule-edit", "data-id": "1" });
  assert.deepEqual(page.last("training.rule.update").args, { id: 1, category: "language" }, "only the kind changed");
  page.modalAnswers.push({ text: `Use first names only ${EVIL}`, category: "tone" });
  const before = page.count("training.rule.update");
  await page.click({ "data-ct": "rule-edit", "data-id": "1" });
  assert.equal(page.count("training.rule.update"), before, "nothing changed: nothing sent");
  await page.change(target({ "data-ct": "rule-on", "data-id": "2" }, { checked: true }));
  assert.deepEqual(page.last("training.rule.update").args, { id: 2, active: true });
  await page.click({ "data-ct": "rule-del", "data-id": "1" });
  assert.deepEqual(page.calls.filter((c) => c.method === "training.rule.delete").map((c) => c.args), [{ id: 1 }, { id: 1, confirmed: true }]);
  assert.equal(page.text("ctSay"), "Rule deleted.");
  assert.ok(page.count("training.tree") >= 2, "the list's counts are read again");
  page.modalAnswers.push({ text: "x".repeat(501), category: "tone" });
  await page.click({ "data-ct": "rule-add" });
  assert.match(page.modals.at(-1).problem, /Keep it under 500 characters/);
});

test("a person's facts: the form shows them, Save sends only what changed, Revert puts them back, leaving asks first", async () => {
  const page = await open([LUIS], {}, { over: { "training.facts.save": () => ({ words: "Saved what the agents know about Luis Martinez." }) } });
  assert.equal(page.el("ctLang").value, "es");
  assert.equal(page.el("ctAway").checked, true);
  assert.equal(page.el("ctAwayFrom").value, "2026-10-12");
  assert.equal(page.el("ctOpenEnd").checked, true, "no return date yet");
  assert.equal(page.el("ctAwayTo").disabled, true);
  assert.equal(page.el("ctDay5").checked && page.el("ctDay6").checked && !page.el("ctDay0").checked, true);
  assert.equal(page.el("ctNotes").value, `Works nights ${EVIL}`);
  assert.equal(page.el("ctFactsSave").disabled, true, "nothing changed yet");
  assert.equal(page.ctx.guardFn(), "");
  page.el("ctOpenEnd").checked = false;
  page.el("ctAwayTo").value = "2026-10-20";
  page.el("ctDay0").checked = true;
  await page.change(page.el("ctDay0"));
  assert.equal(page.el("ctFactsSave").disabled, false);
  assert.match(page.ctx.guardFn(), /has changes that are not saved/);
  assert.deepEqual(plain(page.win.DCRConsoleTraining.factsChanges()), { away_to: "2026-10-20", quiet_days: [0, 5, 6] });
  await page.submit("ctFacts");
  assert.deepEqual(page.last("training.facts.save").args, { name: "Luis Martinez", away_to: "2026-10-20", quiet_days: [0, 5, 6] });
  assert.equal(page.text("ctSay"), "Saved what the agents know about Luis Martinez.");
  page.el("ctAway").checked = false;
  await page.change(page.el("ctAway"));
  assert.deepEqual(plain(page.win.DCRConsoleTraining.factsChanges()), { away_from: "" }, "not away any more (the reloaded facts had no return day)");
  await page.click({ "data-ct": "facts-revert" });
  assert.equal(page.el("ctAway").checked, true);
  assert.deepEqual(plain(page.win.DCRConsoleTraining.factsChanges()), {});
  page.el("ctAwayTo").value = "2026-10-01";
  page.el("ctOpenEnd").checked = false;
  const n = page.count("training.facts.save");
  await page.submit("ctFacts");
  assert.equal(page.el("ctFactsErr").textContent, "The last day away is before the first.");
  assert.equal(page.count("training.facts.save"), n);
});

test("facts changed here and not saved stay as typed when the page is drawn again with a newer answer", async () => {
  let notes = "Works nights";
  const page = await open([LUIS], {}, { over: { "training.scope": () => luis({ facts: { ...luis().facts, notes } }) } });
  page.el("ctDay0").checked = true;
  await page.change(page.el("ctDay0"));
  page.win.DCRConsoleTraining.state.pageAt = 0;
  notes = "Works nights and weekends";
  await page.open([LUIS], {});
  assert.equal(page.el("ctDay0").checked, true, "the unsaved tick is still there");
  assert.deepEqual(plain(page.win.DCRConsoleTraining.factsChanges()), { quiet_days: [0, 5, 6] }, "only what was changed here");
  assert.equal(page.el("ctNotes").value, "Works nights and weekends", "the rest is the server's newer answer — never sent back over it");
  assert.equal(page.el("ctFactsSave").disabled, false);
});

test("reply examples: add one (said and meant), delete after the question", async () => {
  const page = await open([AGENT], { view: "examples" }, {
    over: { "training.example.add": () => ({ id: 8, words: "Example added." }),
      "training.example.delete": (a) => (a.confirmed ? { words: "Example deleted." } : { confirm: { title: "Delete the example", question: "Delete this example?" } }) },
    modal: [{ said: " 8  a081 ", meant: "8 hours on A081 today" }],
  });
  assert.match(page.el("ctLeft").innerHTML, /«8 a081 &lt;img/);
  await page.click({ "data-ct": "ex-add" });
  assert.deepEqual(page.last("training.example.add").args, { scope: AGENT, said: "8 a081", meant: "8 hours on A081 today" });
  await page.click({ "data-ct": "ex-del", "data-id": "7" });
  assert.deepEqual(page.calls.filter((c) => c.method === "training.example.delete").map((c) => c.args), [{ id: 7 }, { id: 7, confirmed: true }]);
  page.modalAnswers.push({ said: "x", meant: "" });
  await page.click({ "data-ct": "ex-add" });
  assert.match(page.modals.at(-1).problem, /Fill in both/);
});

test("the messages Claude wrote: pick one to see it beside the agent's words; forget one, forget them all (asked), ask again", async () => {
  const page = await open([AGENT], { view: "wording" }, {
    over: {
      "training.wording.forget": (a) => (a.id === null && !a.confirmed ? { confirm: { title: "Forget Claude's wording", question: "Forget every version?", danger: true } }
        : { forgot: a.id === null ? 2 : 1, words: "Forgot 1 version — Claude writes it afresh next time." }),
      "training.wording.retry": () => ({ words: "The next message asks Claude again." }),
    },
  });
  let left = page.el("ctLeft").innerHTML;
  assert.match(left, /class="ct-wrow sel" data-ct="w-pick" data-id="31"/, "the newest is shown first");
  assert.match(left, /<pre class="ct-pre">Subject: Hours &lt;img[^<]*\n\nHi \{first\}, log your hours\.\n\nShort text: Log hours<\/pre>/);
  assert.match(left, /<pre class="ct-pre">Subject: Horas &lt;img/);
  await page.click({ "data-ct": "w-pick", "data-id": "32" });
  left = page.el("ctLeft").innerHTML;
  assert.match(left, /class="ct-wrow sel" data-ct="w-pick" data-id="32"/);
  assert.match(left, /<pre class="ct-pre">Subject: Hours today\n\nHi<\/pre>/);
  await page.click({ "data-ct": "w-forget" });
  assert.deepEqual(page.last("training.wording.forget").args, { agent_id: "ab12cd34", id: 32 }, "one version: no question");
  await page.click({ "data-ct": "w-forget-all" });
  assert.deepEqual(page.calls.filter((c) => c.method === "training.wording.forget").slice(1).map((c) => c.args),
    [{ agent_id: "ab12cd34", id: null }, { agent_id: "ab12cd34", id: null, confirmed: true }]);
  await page.click({ "data-ct": "w-retry" });
  assert.equal(page.text("ctSay"), "The next message asks Claude again.");
});

test("recent lessons say where they were taught only on the whole company", async () => {
  const co = await open(["company"], { view: "lessons" });
  assert.match(co.el("ctLeft").innerHTML, /Fri Oct 9 13:00 &lt;img[^<]* · Timesheet reminder &lt;img/);
  const ag = await open([AGENT], { view: "lessons" });
  assert.ok(!ag.el("ctLeft").innerHTML.includes("· Timesheet reminder"));
});

/* ── the Coach ───────────────────────────────────────────────────────── */

test("the Coach's cards: a setting shows before → after; applied and already-there cards say so; buttons only where they can act", async () => {
  const page = await open(["company"], { view: "coach" });
  const c = page.el("ctCoach").innerHTML;
  assert.match(c, /class="ct-diff before"><b>Before<\/b>Daily at 06:00 &lt;img/);
  assert.match(c, /class="ct-diff after"><b>After<\/b>Daily at 05:30 &lt;img/);
  assert.match(c, /<span class="c-chip good">Applied ✓<\/span>/);
  assert.match(c, /class="ct-csaid">Rule added &lt;img/);
  assert.match(c, /class="ct-cprob">That rule is already here &lt;img/, "already there: said quietly, not as an error");
  assert.match(c, /Kind: Tone   ·   Why: because &lt;img/);
  assert.equal((c.match(/data-ct="apply"/g) || []).length, 3, "not on the applied card");
  assert.match(c, /data-ct="apply" data-chat="41" data-n="3" data-act data-method="training.coach.apply" disabled/, "can't apply: shown, greyed (the newest answer)");
  assert.match(c, /data-ct="dismiss" data-chat="41" data-n="0" data-act data-method="training.coach.dismiss"/);
  assert.match(c, /<span class="c-chip purple">New rule<\/span>/);
});

test("Apply and Dismiss send the answer's id and the card's place — never the proposal", async () => {
  const page = await open(["company"], { view: "coach" }, { over: { "training.coach.apply": () => ({ words: "Rule added." }), "training.coach.dismiss": () => ({}) } });
  await page.click({ "data-ct": "apply", "data-chat": "41", "data-n": "1" });
  assert.deepEqual(page.last("training.coach.apply").args, { scope: "company", chat_id: 41, n: 1 });
  assert.equal(page.text("ctSay"), "Rule added.");
  await page.click({ "data-ct": "dismiss", "data-chat": "41", "data-n": "0" });
  assert.deepEqual(page.last("training.coach.dismiss").args, { scope: "company", chat_id: 41, n: 0 });
  assert.equal(page.text("ctSay"), "Done.");
  assert.ok(page.count("training.scope") >= 3, "the page is read again after each");
});

test("asking the Coach: the words wait in a bubble, the answer and its cards join the chat, the draft goes; a failure keeps it", async () => {
  let release;
  const page = await open(["company"], { view: "coach" }, {
    over: { "training.coach.ask": () => new Promise((r) => { release = r; }) },
    storage: new Map([[DRAFT("company"), "We close at noon on Fridays"]]),
  });
  assert.equal(page.el("ctCoachText").value, "We close at noon on Fridays", "the draft kept for this scope");
  assert.match(page.el("ctCoachText").getAttribute("placeholder"), /^e\.g\. “We're closed &lt;img|^e\.g\. “We're closed <img/);
  await page.submit("ctCoachForm");
  assert.deepEqual(page.last("training.coach.ask").args, { scope: "company", words: "We close at noon on Fridays" });
  assert.match(page.el("ctCoach").innerHTML, /Thinking… this can take a minute\./);
  assert.match(page.el("ctCoach").innerHTML, /id="ctSend" data-act data-method="training.coach.ask" disabled/, "one question at a time");
  release({ reply: `Noted ${EVIL}`, chat_id: 42, actions: [card(0, { summary: "Close at noon on Fridays" })], words: "The coach answered with 1 proposal — apply the ones you want." });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const c = page.el("ctCoach").innerHTML;
  assert.match(c, /Noted &lt;img/);
  assert.match(c, /data-ct="apply" data-chat="42" data-n="0"/);
  assert.ok(!page.store.has(DRAFT("company")), "the draft goes once the coach has it");
  assert.equal(page.text("ctSay"), "The coach answered with 1 proposal — apply the ones you want.");
  const bad = await open(["company"], { view: "coach" }, { over: { "training.coach.ask": () => { throw refusal("refused", "Claude is busy"); } } });
  bad.el("ctCoachText").value = "keep me";
  await bad.key(bad.el("ctCoachText"), { key: "Enter", ctrlKey: true });
  assert.equal(bad.count("training.coach.ask"), 1, "Ctrl+Enter sends");
  assert.equal(bad.store.get(DRAFT("company")), "keep me");
  assert.equal(bad.el("ctCoachText").value, "keep me");
  assert.equal(bad.text("ctSay"), "Claude is busy");
});

test("typing in the Coach box keeps a draft per scope; the Coach off says why and sends nothing", async () => {
  const page = await open(["company"], { view: "coach" });
  const box = page.el("ctCoachText");
  box.value = "half a thought";
  await page.input(box);
  assert.equal(page.store.get(DRAFT("company")), "half a thought");
  const empty = await open([LUIS], { view: "coach" }, { over: { "training.scope": () => luis({ coach: { ok: false, words: "No key", note: `No key. Everything else works ${EVIL}`, history: [] } }) } });
  const c = empty.el("ctCoach").innerHTML;
  assert.match(c, /Tell the coach how the company works &lt;img/, "an empty chat shows the intro");
  assert.match(c, /No key\. Everything else works &lt;img/);
  assert.match(c, /<textarea id="ctCoachText"[^>]* disabled>/);
});

/* ── the switch, export and import ───────────────────────────────────── */

test("smart wording goes through the server's question; a no puts the switch back", async () => {
  const page = await open([], {}, { over: { "training.smart": (a) => (a.confirmed ? { on: false, words: "Smart wording is off on this PC." } : { confirm: { title: "Smart wording", question: "Turn smart wording off?" } }) } });
  const sw = target({ "data-ct": "smart" }, { checked: false });
  await page.change(sw);
  assert.deepEqual(page.calls.filter((c) => c.method === "training.smart").map((c) => c.args), [{ on: false }, { on: false, confirmed: true }]);
  assert.equal(sw.checked, false);
  assert.equal(page.toasts.at(-1).text, "Smart wording is off on this PC.");
  const no = await open([], {}, { over: { "training.smart": () => ({ confirm: { title: "Smart wording", question: "?" } }) }, confirm: () => false });
  const sw2 = target({ "data-ct": "smart" }, { checked: false });
  await no.change(sw2);
  assert.equal(sw2.checked, true, "declined: back as it was");
});

test("export saves the file from this browser with a safe name; too large says to export on the server computer", async () => {
  const page = await open(["company"], {}, { over: { "training.export": () => ({ file_name: "../dcr agents<training>.json", data: { kind: "dcr-agents-training", rules: [] }, counts: { rules: 1, examples: 0, people: 2 } }) } });
  await page.click({ "data-ct": "export" });
  assert.equal(page.downloads.length, 1);
  assert.match(page.downloads[0].blob.parts[0], /"kind": "dcr-agents-training"/);
  const a = page.dom.document.body.children.at(-1);
  assert.equal(a.download, "..dcragentstraining.json", "no folders, no spaces, no markup in the file name");
  assert.equal(a.clicks, 1);
  assert.equal(page.text("ctSay"), "Saved 1 rule, 0 examples and what the agents know about 2 people to ..dcragentstraining.json.");
  const big = await open(["company"], {}, { over: { "training.export": () => { throw refusal("too_big", "The training is too large to export from the web — export it on the DCR server computer (Training → Export…)."); } } });
  await big.click({ "data-ct": "export" });
  assert.match(big.text("ctSay"), /export it on the DCR server computer/);
});

test("import: a file too large for the relay or not JSON is never sent; a good one asks twice through the server's question", async () => {
  const twice = [];
  const page = await open(["company"], {}, {
    over: { "training.import": (a) => (a.confirmed ? { counts: { rules: 1, examples: 0, people: 0, skipped: 0 }, words: "Added 1 rule(s), 0 example(s) and facts about 0 person(s)." }
      : { confirm: { title: "Import training", question: "Add the training from this file?", twice: "Are you sure?" } }) },
    confirm: (c) => { twice.push(c.twice); return true; },
  });
  const file = (text) => ({ files: [{ size: text.length, text: () => Promise.resolve(text) }], value: "C:\\fakepath\\t.json" });
  const bigInput = target({ "data-ct": "import-file" }, file(JSON.stringify({ rules: ["x".repeat(20000)] })));
  await page.change(bigInput);
  assert.equal(page.count("training.import"), 0);
  assert.match(page.text("ctSay"), /too large for the web — import it on the DCR server computer/);
  assert.equal(bigInput.value, "", "the file box is cleared for the next try");
  await page.change(target({ "data-ct": "import-file" }, file("not json {")));
  assert.match(page.text("ctSay"), /not a training export/);
  await page.change(target({ "data-ct": "import-file" }, file("[1,2]")));
  assert.equal(page.text("ctSay"), "That file is not a training export.");
  const data = { kind: "dcr-agents-training", rules: [{ scope: "company", text: "Use first names", category: "tone" }] };
  await page.change(target({ "data-ct": "import-file" }, file("\uFEFF" + JSON.stringify(data))));
  assert.deepEqual(page.calls.filter((c) => c.method === "training.import").map((c) => c.args), [{ data }, { data, confirmed: true }]);
  assert.deepEqual(twice, ["Are you sure?"], "the second question comes from the server too");
  assert.equal(page.text("ctSay"), "Added 1 rule(s), 0 example(s) and facts about 0 person(s).");
  await page.click({ "data-ct": "import" });
  assert.equal(page.el("ctImportFile").clicks, 1, "Import… opens the file picker");
});

/* ── when things go wrong ───────────────────────────────────────────── */

test("a scope or the list that cannot be read shows the shell's error; the page source draws nothing unescaped", async () => {
  const page = await open([LUIS], {}, { over: { "training.scope": () => { throw refusal("not_found", `Luis is not on People yet ${EVIL}`); },
    "training.tree": () => { throw refusal("offline", "The DCR server is offline"); } } });
  assert.match(page.el("ctMain").innerHTML, /class="c-error"[\s\S]*Luis is not on People yet &lt;img[\s\S]*data-c-retry/);
  assert.match(page.el("ctTree").innerHTML, /class="c-error"/);
  assert.ok(!/\son[a-z]+=/i.test(SRC.replace(/\/\*[\s\S]*?\*\//g, "")));
  assert.ok(!/javascript:/i.test(SRC));
  assert.ok(!/\sstyle="/.test(SRC), "no inline styles");
});
