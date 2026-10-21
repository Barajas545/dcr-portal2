/* The DCR Agents console's Agents tab (site/js/console/console-agents.js) against
   stub answers in the shapes of console-spec §6.1.3 (as the PC's
   agentgroups.tree and agent_form.describe build them), with an <img
   onerror> in every string: the grouped list and its buttons, the editor
   (every field in, the closed agent shape out, the server's problems as you
   type, save with rev, Preview), and the first-run review. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openConsole, onlineStatus, statusApi, scan, EVIL, esc, plain } from "./console-page-dom.mjs";

const METHODS = ["agents.list", "agents.form", "agents.get", "agents.new", "agents.check", "agents.save", "agents.toggle", "agents.duplicate",
  "agents.delete", "agents.preview", "agents.run_now", "dashboard.first_run", "dashboard.approve", "dashboard.status"];
const CHOICES = [{ feed: "checks", label: "Checks ready for pickup" }, { feed: "timesheets", label: "Missing timesheets" },
  { feed: "stale_tasks", label: "Tasks with no update" }];

function row(over = {}) {
  return { id: "4a93aa21d72a", name: EVIL, when: `daily at 17:00 ${EVIL}`, channels: ["app", "sms"], on: false, notes: [], waiting: false,
    pending_review: false, last: null, next: null, next_today: false, ...over };
}
function tree() {
  return {
    feeds: [
      { feed: "timesheets", label: `Missing ${EVIL}`, n: 3, on: 1, people: [
        { key: "", label: "Everyone", include: [], n: 2, on: 1, agents: [
          row({ on: true, notes: ["first run pending review"], pending_review: true, next: "2026-10-12T17:00-07:00" }),
          row({ id: "3230c0bc43ab", name: "Second nudge", notes: ["dry run", "review waiting on the Dashboard"], waiting: true }),
        ] },
        { key: "ana testa", label: `Ana ${EVIL}`, include: ["Ana Testa"], n: 1, on: 0, agents: [row({ id: "aaaabbbbcccc", name: "Ana only" })] },
      ] },
      { feed: "checks", label: "Checks ready for pickup", n: 1, on: 0, people: [
        { key: "", label: "Everyone", include: [], n: 1, on: 0, agents: [row({ id: "511c5d29063f", name: "Check ready" })] }] },
    ],
    feed_choices: CHOICES,
  };
}
function form(over = {}) {
  return {
    feed: "stale_tasks", who: `Open tasks ${EVIL}`, vars: ["firstName", "taskName"], global_vars: ["companyName"],
    roles: ["Admin", "Manager", "Accountant", "Lead", "Field", "ReadOnly"], days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    channel_kinds: [{ kind: "app", label: "DCR app on the phone" }, { kind: "sms", label: "Text message (SMS)" }, { kind: "whatsapp", label: "WhatsApp" },
      { kind: "email", label: "Email" }],
    params: [{ name: "stale_days", label: "Remind when a task has had no update for more than", kind: "int", lo: 1, hi: 365, default: 5, suffix: " days", placeholder: "" },
      { name: "watcher", label: `Send every stale task to ${EVIL}`, kind: "text", lo: null, hi: null, default: "", suffix: "", placeholder: EVIL }],
    min_confidence: [{ key: "certain", label: "certain" }, { key: "likely", label: "likely" }, { key: "guess", label: "guess" }],
    smart: { offered: true, note: `Claude follows the rules. ${EVIL}` }, note_channels: `Tick the channels ${EVIL}`,
    ...over,
  };
}
function agent(over = {}) {
  return {
    id: "0254698b3f0a", name: `Tasks ${EVIL}`, feed: "stale_tasks", enabled: false,
    schedule: { kind: "daily", at: "08:00", until: "10:00", days: "weekdays" },
    audience: { roles: ["Lead"], include: ["Ana Testa", EVIL], exclude: [] },
    channels: ["sms", "app"],
    template: { subject: `No update ${EVIL}`, body: `Hi {{firstName}}\n${EVIL}`, sms: "Short {{taskName}}", whatsapp_content_sid: "", whatsapp_vars: ["firstName"] },
    rules: { repeat_after_hours: 66, max_reminders: 3, min_confidence: "likely", escalate_to: "", escalate_after: 0, dry_run: false, max_per_run: 25,
      first_run_reviewed: false },
    feed_params: { stale_days: 5, watcher: "" },
    future_key: { kept: true },
    ...over,
  };
}

function stubs(answers) {
  const calls = [];
  const fn = async (method, args) => {
    calls.push(plain({ method, args }));
    const a = answers[method];
    if (a === undefined) throw Object.assign(new Error(`no stub for ${method}`), { code: "failed" });
    const v = typeof a === "function" ? a(plain(args), calls) : a;
    if (v instanceof Error) throw v;
    return JSON.parse(JSON.stringify(v));
  };
  return { calls, fn };
}
async function open(hash, answers, extra = {}) {
  const s = stubs({ "agents.list": tree(), ...answers });
  const h = await openConsole({ modules: ["console-agents.js"], api: statusApi(onlineStatus()), rpc: s.fn, methods: METHODS, hash, ...extra });
  await h.settle(10);
  return { h, calls: s.calls, of: (m) => s.calls.filter((c) => c.method === m) };
}
const refused = (msg) => Object.assign(new Error(msg), { code: "refused" });

/* ── the list ─────────────────────────────────────────────────────────── */

test("the list: grouped like the desktop (what it watches → whom for → the agents), every string escaped", async () => {
  const { h } = await open("#/agents", {});
  const v = h.view();
  assert.deepEqual(scan(v), []);
  assert.ok(h.html().includes(esc(EVIL)));
  assert.match(v.querySelector(".c-sub").textContent, /^4 agents, 1 on — grouped by what they watch, then whom they are for\.$/);
  const feeds = v.querySelectorAll(".ca-feed");
  assert.deepEqual(feeds.map((f) => f.querySelector(".ca-feedname").textContent), [`Missing ${EVIL}`, "Checks ready for pickup"]);
  assert.equal(feeds[0].querySelector(".ca-suffix").textContent, " — 3 agents, 1 on");
  assert.deepEqual(feeds[0].querySelectorAll(".ca-personname").map((p) => p.textContent), ["Everyone", `Ana ${EVIL}`]);
  const first = h.$("ca-a-4a93aa21d72a");
  assert.ok(first.classList.contains("on"), "an agent that is on reads green");
  assert.equal(first.querySelector('input[data-do="toggle"]').checked, true);
  assert.equal(first.querySelector(".ca-aname").getAttribute("href"), "#/agents/edit/4a93aa21d72a");
  assert.match(first.textContent, /Next run: Mon, Oct 12/);
  const second = h.$("ca-a-3230c0bc43ab");
  assert.deepEqual(second.querySelectorAll(".c-chip").filter((c) => !c.classList.contains("info")).map((c) => [c.textContent, c.className]),
    [["dry run", "c-chip dim"], ["review waiting on the Dashboard", "c-chip bad"]]);
  assert.equal(second.querySelector('a[href="#/agents/review/3230c0bc43ab"]').textContent, "Review the first run");
  assert.equal(first.querySelectorAll(".c-chip.warn")[0].textContent, "first run pending review");
  /* a feed with one group has its buttons once; one with several, per person too */
  assert.equal(feeds[1].querySelectorAll(".ca-gtools").length, 1);
  assert.deepEqual(feeds[0].querySelectorAll(".ca-gtools").map((g) => g.textContent),
    ["Turn all onNew agent here", "Turn all onNew agent for everyone", `Turn all onNew for Ana ${EVIL}`], "on while any agent under it is off");
  assert.ok(v.querySelectorAll('[data-do="del"]').every((b) => b.getAttribute("data-method") === "agents.delete" && b.hasAttribute("data-act")));
});

test("one agent's box flips it at once (agents.toggle, no question); a refusal puts the box back", async () => {
  const { h, of } = await open("#/agents", { "agents.toggle": { changed: 1, words: "'Check ready' is on." } });
  await h.click(h.$("ca-a-511c5d29063f").querySelector('input[data-do="toggle"]'));
  await h.settle(10);
  assert.deepEqual(of("agents.toggle").map((c) => c.args), [{ ids: ["511c5d29063f"], on: true }]);
  assert.ok(h.toasts().some((t) => t.text === "'Check ready' is on."));
  assert.equal(of("agents.list").length, 2, "redrawn");
  const no = await open("#/agents", { "agents.toggle": refused("Not now.") });
  const box = no.h.$("ca-a-511c5d29063f").querySelector('input[data-do="toggle"]');
  await no.h.click(box);
  await no.h.settle(10);
  assert.equal(box.checked, false);
  assert.equal(box.disabled, false);
});

test("a group's Turn all on / off sends every id with the group's label and asks the server's question first", async () => {
  const q = { title: "Turn on / off", question: `Turn ON 1 agent under Ana ${EVIL}?`, ok_text: "Turn on", danger: false, twice: null, extra: [] };
  const { h, of } = await open("#/agents", { "agents.toggle": (a) => (a.confirmed ? { changed: 1, words: "1 agents are on." } : { confirm: q }) }, { answers: [true] });
  const tools = h.view().querySelectorAll(".ca-feed")[0].querySelectorAll(".ca-gtools");
  await h.click(tools[2].querySelector('[data-do="gtoggle"]'));
  await h.settle(10);
  assert.deepEqual(of("agents.toggle").map((c) => c.args), [
    { ids: ["aaaabbbbcccc"], on: true, label: `Ana ${EVIL}` }, { ids: ["aaaabbbbcccc"], on: true, label: `Ana ${EVIL}`, confirmed: true }]);
  assert.equal(h.dialogs[0].opts.message, q.question);
  await h.click(h.view().querySelectorAll(".ca-feed")[0].querySelectorAll(".ca-gtools")[0].querySelector('[data-do="gtoggle"]'));
  await h.settle(10);
  assert.deepEqual(of("agents.toggle").at(-1).args.ids, ["4a93aa21d72a", "3230c0bc43ab", "aaaabbbbcccc"], "the whole feed");
  assert.equal(of("agents.toggle").at(-1).args.on, true, "some under it are off, so the feed turns ON");
});

test("Delete asks (danger) and deletes; Duplicate makes a copy; Run now says what happened", async () => {
  const { h, of } = await open("#/agents", {
    "agents.delete": (a) => (a.confirmed ? { words: `Deleted '${EVIL}'. Its history stays in Activity.` }
      : { confirm: { title: "Delete", question: `Delete '${EVIL}'? Its history stays in Activity.`, ok_text: "Delete", danger: true, twice: null, extra: [] } }),
    "agents.duplicate": { agent_id: "ffffeeeedddd", words: "Made 'Check ready (copy)' (off, with its own first-run review)." },
    "agents.run_now": (a) => (a.confirmed ? { summary: `Check ready: 2 found, 0 sent ${EVIL}` }
      : { confirm: { title: "Run now", question: "Run 'Check ready' now, outside its schedule? Dry-run and first-run rules still apply.", ok_text: "Run now", danger: false, twice: null, extra: [] } }),
  }, { answers: [true, true] });
  const card = () => h.$("ca-a-511c5d29063f");
  await h.click(card().querySelector('[data-do="del"]'));
  await h.settle(10);
  assert.equal(h.dialogs[0].opts.danger, true);
  assert.deepEqual(of("agents.delete").map((c) => c.args), [{ agent_id: "511c5d29063f" }, { agent_id: "511c5d29063f", confirmed: true }]);
  await h.click(card().querySelector('[data-do="dup"]'));
  await h.settle(10);
  assert.deepEqual(of("agents.duplicate").map((c) => c.args), [{ agent_id: "511c5d29063f" }]);
  assert.ok(h.toasts().some((t) => /Made 'Check ready \(copy\)'/.test(t.text)));
  await h.click(card().querySelector('[data-do="run"]'));
  await h.settle(10);
  assert.deepEqual(of("agents.run_now").map((c) => c.args), [{ agent_id: "511c5d29063f" }, { agent_id: "511c5d29063f", confirmed: true }]);
  assert.equal(h.$("caMsg").textContent, `Check ready: 2 found, 0 sent ${EVIL}`);
  assert.deepEqual(scan(h.view()), []);
});

test("New agent asks what it should watch (the server's feed list) and opens the editor; a person's New starts with their name", async () => {
  const { h } = await open("#/agents", {}, { answers: [{ feed: "timesheets" }] });
  await h.click("caNew");
  await h.settle(10);
  const d = h.dialogs[0].opts;
  assert.equal(d.message, "What should it watch?");
  assert.deepEqual(plain(d.fields[0].options), CHOICES.map((c) => ({ value: c.feed, label: c.label })));
  assert.equal(h.ctx.location.hash, "#/agents/new/timesheets");
  const two = await open("#/agents", { "agents.new": { agent: agent({ id: "10353bf6d33d", feed: "timesheets" }), rev: "", form: form({ feed: "timesheets" }) } });
  await two.h.click(two.h.view().querySelectorAll(".ca-feed")[0].querySelectorAll(".ca-gtools")[2].querySelector('[data-do="gnew"]'));
  await two.h.settle(10);
  assert.equal(two.h.ctx.location.hash, "#/agents/new/timesheets?include=Ana%20Testa");
  assert.deepEqual(two.of("agents.new").map((c) => c.args), [{ feed: "timesheets", include: ["Ana Testa"] }]);
});

/* ── the editor ───────────────────────────────────────────────────────── */

function editorAnswers(over = {}) {
  return {
    "agents.get": { agent: agent(), rev: "bea3676c32a49484", form: form() },
    "agents.check": { problems: [], segments: { text: "Text length 32 → 1 SMS segment (GSM-7)", warn: false }, agent: agent() },
    ...over,
  };
}

test("the editor shows every field of the agent, escaped, and gives back exactly the closed agent shape", async () => {
  const { h, of } = await open("#/agents/edit/0254698b3f0a", editorAnswers());
  assert.deepEqual(of("agents.get").map((c) => c.args), [{ agent_id: "0254698b3f0a" }]);
  assert.deepEqual(scan(h.view()), []);
  assert.equal(h.$("ae-name").value, `Tasks ${EVIL}`);
  assert.equal(h.$("ae-title").textContent, `Tasks ${EVIL}`);
  assert.equal(h.$("ae-feed").value, "stale_tasks");
  assert.equal(h.$("ae-feednote").textContent, `Open tasks ${EVIL}`);
  assert.equal(h.$("ae-body").value, `Hi {{firstName}}\n${EVIL}`);
  assert.equal(h.$("ae-p-watcher").getAttribute("placeholder"), EVIL);
  assert.deepEqual(h.view().querySelectorAll("#ae-channels li").map((l) => l.textContent.replace(/[↑↓]/g, "").trim()),
    ["Text message (SMS)", "DCR app on the phone", "WhatsApp", "Email"], "the agent's order first, the unticked after");
  assert.equal(h.$("ae-smartnote").textContent, `Claude follows the rules. ${EVIL}`);
  assert.equal(h.$("ae-daily").hidden, false);
  assert.equal(h.$("ae-interval").hidden, true);
  assert.equal(h.$("ae-train").getAttribute("href"), "#/training/agent%3A0254698b3f0a", "Train this agent… opens its training");
  const a = plain(h.C._agents.collect());
  assert.deepEqual(a, {
    id: "0254698b3f0a", name: `Tasks ${EVIL}`, feed: "stale_tasks", enabled: false,
    schedule: { kind: "daily", at: "08:00", until: "10:00", every_minutes: 30, between: ["08:00", "18:00"], days: [0, 1, 2, 3, 4] },
    audience: { roles: ["Lead"], include: ["Ana Testa", EVIL], exclude: [] },
    channels: ["sms", "app"],
    template: { subject: `No update ${EVIL}`, body: `Hi {{firstName}}\n${EVIL}`, sms: "Short {{taskName}}", whatsapp_content_sid: "", whatsapp_vars: ["firstName"] },
    rules: { repeat_after_hours: 66, max_reminders: 3, min_confidence: "likely", escalate_to: "", escalate_after: 0, max_per_run: 25, dry_run: false,
      first_run_reviewed: false, smart_wording: false },
    feed_params: { stale_days: 5, watcher: "" },
  }, "every field, typed, and nothing the server does not take (future_key stays on the server)");
});

test("the server's problems show as you type (agents.check, debounced, quiet); what the schema would refuse is said here first", async () => {
  const { h, of } = await open("#/agents/edit/0254698b3f0a", editorAnswers({
    "agents.check": (a) => ({ problems: a.agent.name.includes("bad") ? [`'send every stale task to' ${EVIL}`, "pick at least one channel"] : [],
      segments: { text: `Text length 40 → 2 SMS segments (UCS-2) ${EVIL}`, warn: true }, agent: a.agent }) }));
  await h.settle(100);
  assert.equal(of("agents.check").length, 1, "checked once on opening");
  await h.change("ae-name", "a bad name");
  await h.settle(400);
  await h.change("ae-name", "a bad name!");
  await h.settle(900);
  assert.equal(of("agents.check").length, 1, "not while typing: the form must be still for two seconds");
  await h.settle(6000);
  assert.equal(of("agents.check").length, 2, "one check for a burst of typing (at most one every five seconds)");
  assert.equal(of("agents.check")[1].args.agent.name, "a bad name!");
  assert.deepEqual(h.$("ae-problems").querySelectorAll("li").map((l) => l.textContent), [`'send every stale task to' ${EVIL}`, "pick at least one channel"]);
  assert.equal(h.$("ae-seg").textContent, `Text length 40 → 2 SMS segments (UCS-2) ${EVIL}`);
  assert.equal(h.$("ae-seg").className, "ca-seg warn");
  assert.deepEqual(scan(h.view()), []);
  await h.change("ae-name", "");
  await h.change("ae-repeat", "2000");
  await h.settle(5000);
  assert.equal(of("agents.check").length, 2, "nothing sent while a field is plainly wrong");
  assert.deepEqual(h.$("ae-problems").querySelectorAll("li").map((l) => l.textContent), ["Give the agent a name.", "Repeat after must be 0 to 1440 hours."]);
});

test("Save sends the agent with the rev it was opened at, then goes back to the list; the server's refusal is shown as its list", async () => {
  const saved = [];
  let answer = { agent: agent(), rev: "1111222233334444", words: `Saved '${EVIL}'.` };
  const { h, of } = await open("#/agents/edit/0254698b3f0a", editorAnswers({ "agents.save": (a) => { saved.push(a); return answer; } }));
  answer = refused("Not saved: the message is empty; no channel is ticked");
  await h.change("ae-subject", "Changed subject");
  await h.click("ae-save");
  await h.settle(10);
  assert.equal(saved[0].rev, "bea3676c32a49484");
  assert.equal(saved[0].agent.template.subject, "Changed subject");
  assert.deepEqual(h.$("ae-problems").querySelectorAll("li").map((l) => l.textContent), ["the message is empty", "no channel is ticked"]);
  assert.equal(h.ctx.location.hash, "#/agents/edit/0254698b3f0a", "still in the editor, nothing lost");
  answer = Object.assign(new Error("Someone changed this since you opened it — reload and try again."), { code: "changed" });
  await h.click("ae-save");
  await h.settle(10);
  assert.match(h.$("ae-problems").textContent, /^Someone changed this since you opened it — reload and try again\. \(Your changes are still on this screen\.\)$/);
  await h.settle(5000);
  assert.match(h.$("ae-problems").textContent, /^Someone changed this/, "a live check that answers afterwards does not wipe the refusal");
  answer = { agent: agent(), rev: "1111222233334444", words: `Saved '${EVIL}'.` };
  await h.click("ae-save");
  await h.settle(10);
  assert.ok(h.toasts().some((t) => t.text === `Saved '${EVIL}'.`));
  assert.equal(h.ctx.location.hash, "#/agents", "back to the list, no 'unsaved changes' question");
  assert.equal(h.dialogs.length, 0);
  assert.equal(of("agents.list").length >= 1, true);
});

test("Preview shows who would get it now, with the words, escaped — nothing is sent; Fix first is the problems list", async () => {
  let answer = { found: 2, would_send: 1, held: 1, skipped: 0, headers: ["Person", "Would", "Because", "Route", "Message"],
    rows: [[EVIL, "send", "6 days", `app ${EVIL}`, `Hi ${EVIL}`], ["Ana Testa", "hold", "a guess", "", ""]], error: "",
    words: "2 found; 1 would be sent, 1 held for you, 0 skipped. Nothing was sent." };
  const { h, of } = await open("#/agents/edit/0254698b3f0a", editorAnswers({ "agents.preview": () => answer }));
  await h.click("ae-previewbtn");
  await h.settle(10);
  assert.equal(of("agents.preview")[0].args.agent.id, "0254698b3f0a");
  const box = h.$("ae-preview");
  assert.match(box.textContent, /2 found; 1 would be sent, 1 held for you, 0 skipped\. Nothing was sent\./);
  assert.deepEqual(box.querySelectorAll("th").map((t) => t.textContent), ["Person", "Would", "Because", "Route", "Message"]);
  assert.equal(box.querySelectorAll("tbody tr")[0].querySelectorAll("td")[0].textContent, EVIL);
  assert.deepEqual(scan(box), []);
  answer = refused("Fix first: pick at least one channel");
  await h.click("ae-previewbtn");
  await h.settle(10);
  assert.equal(h.$("ae-problems").textContent, "pick at least one channel");
});

test("changing what it watches reloads the feed's own settings (agents.form); ↑↓ reorder the channels; Insert puts a placeholder in", async () => {
  const { h, of } = await open("#/agents/edit/0254698b3f0a", editorAnswers({
    "agents.form": form({ feed: "timesheets", who: "Employees", vars: ["date"], smart: { offered: false, note: "Not for money." },
      params: [{ name: "recent_days", label: "Only people who logged time in the last", kind: "int", lo: 0, hi: 365, default: 14, suffix: " days (0 = everyone)", placeholder: "" }] }),
  }));
  await h.change("ae-feed", "timesheets");
  await h.settle(10);
  assert.deepEqual(of("agents.form").map((c) => c.args), [{ feed: "timesheets" }]);
  assert.equal(h.$("ae-p-recent_days").value, "14");
  assert.equal(h.$("ae-p-stale_days"), null);
  assert.equal(h.$("ae-smart").disabled, true);
  assert.equal(h.$("ae-feednote").textContent, "Employees");
  let a = plain(h.C._agents.collect());
  assert.deepEqual([a.feed, a.feed_params, a.rules.smart_wording], ["timesheets", { recent_days: 14 }, false]);
  await h.click(h.view().querySelector('#ae-channels [data-do="chdown"][data-i="0"]'));
  assert.deepEqual(plain(h.C._agents.collect()).channels, ["app", "sms"]);
  h.$("ae-body").value = "Hello ";
  h.$("ae-body").focus();
  await h.click(h.view().querySelector('[data-do="insert"][data-var="date"]'));
  assert.equal(h.$("ae-body").value, "Hello {{date}}");
});

test("an interval agent: the interval row shows, and the daily half stays valid for the server", async () => {
  const { h } = await open("#/agents/edit/0254698b3f0a", editorAnswers({
    "agents.get": { agent: agent({ schedule: { kind: "interval", every_minutes: 45, between: ["07:00", "17:30"], days: [0, 2, 4] } }), rev: "r", form: form() } }));
  assert.equal(h.$("ae-interval").hidden, false);
  assert.equal(h.$("ae-daily").hidden, true);
  const a = plain(h.C._agents.collect());
  /* no end time stored: 23:59, as the desktop editor shows and saves it */
  assert.deepEqual(a.schedule, { kind: "interval", at: "09:00", until: "23:59", every_minutes: 45, between: ["07:00", "17:30"], days: [0, 2, 4] });
  await h.change("ae-kind", "daily");
  assert.equal(h.$("ae-daily").hidden, false);
});

test("a new agent (agents.new) is saved with rev \"\"; leaving with unsaved changes asks first", async () => {
  const { h, of } = await open("#/agents/new/timesheets?include=Ana%20Testa", {
    "agents.new": { agent: agent({ id: "10353bf6d33d", name: "Missing timesheets", feed: "timesheets", feed_params: { recent_days: 14 } }), rev: "",
      form: form({ feed: "timesheets", params: [] }) },
    "agents.check": { problems: [], segments: { text: "", warn: false }, agent: {} },
    "agents.save": { agent: agent(), rev: "aaaa111122223333", words: "Saved 'Missing timesheets'." },
  }, { answers: [false] });
  assert.deepEqual(of("agents.new").map((c) => c.args), [{ feed: "timesheets", include: ["Ana Testa"] }]);
  assert.equal(h.$("ae-run"), null, "no Run now before it exists");
  await h.change("ae-name", "Ana's check");
  await h.go("dashboard");
  await h.settle(10);
  assert.equal(h.dialogs[0].opts.message, "Leave without saving your changes to this agent?");
  assert.match(h.ctx.location.hash, /^#\/agents\/new\/timesheets/, "stayed in the editor");
  await h.click("ae-save");
  await h.settle(10);
  assert.equal(of("agents.save")[0].args.rev, "");
  assert.equal(of("agents.save")[0].args.agent.name, "Ana's check");
});

test("Run now in the editor runs the saved agent: with changes on the screen it says to save first", async () => {
  const { h, of } = await open("#/agents/edit/0254698b3f0a", editorAnswers({ "agents.run_now": { summary: "ran" } }));
  await h.change("ae-name", "changed");
  await h.click("ae-run");
  await h.settle(10);
  assert.equal(of("agents.run_now").length, 0);
  assert.ok(h.toasts().some((t) => t.text === "Save your changes first — Run now runs the saved agent."));
});

test("an agent that is gone says so, without a Try again", async () => {
  const { h } = await open("#/agents/edit/0254698b3f0a", { "agents.get": Object.assign(new Error("That agent is gone — it was deleted."), { code: "not_found" }) });
  assert.match(h.view().textContent, /Not found\.That agent is gone — it was deleted\./);
  assert.equal(h.view().querySelector("[data-c-retry]"), null);
});

/* ── the first-run review ─────────────────────────────────────────────── */

test("the first-run review lists who would get what, escaped, and starts the agent through the server's question", async () => {
  const { h, of } = await open("#/agents/review/4a93aa21d72a", {
    "dashboard.first_run": { agent: { id: "4a93aa21d72a", name: EVIL }, headers: ["Person", "Would", "Because", "Route", "Message"],
      rows: [[EVIL, "send", EVIL, "app", EVIL]], smart: false, found: 4, would_send: 3 },
    "dashboard.approve": (a) => (a.confirmed ? { words: "Started.", marked: 4 }
      : { confirm: { title: "First run", question: "Mark these 4 as already handled, then start 'x'?", ok_text: "Mark them and start", danger: false, twice: null, extra: [] } }),
  }, { answers: [true] });
  assert.deepEqual(of("dashboard.first_run").map((c) => c.args), [{ agent_id: "4a93aa21d72a" }]);
  assert.equal(h.view().querySelector("h2").textContent, `First run of '${EVIL}'`);
  assert.match(h.view().textContent, /4 items found, 3 would be sent\. Nothing has gone yet/);
  assert.deepEqual(scan(h.view()), []);
  await h.click("caMark");
  await h.settle(10);
  assert.deepEqual(of("dashboard.approve").map((c) => c.args), [{ agent_id: "4a93aa21d72a", mark_handled: true },
    { agent_id: "4a93aa21d72a", mark_handled: true, confirmed: true }]);
  assert.equal(h.ctx.location.hash, "#/agents");
  const gone = await open("#/agents/review/4a93aa21d72a", {
    "dashboard.first_run": Object.assign(new Error("No first-run review is waiting for that agent — it may have been answered already."), { code: "not_found" }) });
  assert.match(gone.h.view().textContent, /No first-run review is waiting/);
});

test("an agent stored with no end time (until null) opens with 23:59, as the desktop shows it, and saves without a complaint", async () => {
  const saved = [];
  const { h } = await open("#/agents/edit/0254698b3f0a", editorAnswers({
    "agents.get": { agent: agent({ schedule: { kind: "daily", at: "17:00", until: null, days: "weekdays" } }), rev: "r", form: form() },
    "agents.save": (a) => { saved.push(a); return { agent: a.agent, rev: "1111222233334444", words: "Saved." }; } }));
  assert.equal(h.$("ae-until").value, "23:59");
  await h.change("ae-subject", "Changed");
  await h.click("ae-save");
  await h.settle(10);
  assert.equal(saved.length, 1, "no “Pick the no later than time” refusal");
  assert.equal(saved[0].agent.schedule.until, "23:59");
});

/* "Also e-mail every message" (rules.also_email) came with DCR Agents 2 2.1.1. The PC
   says so in its agents.form (also_email: label + note); a 2.1.0 PC's closed agent
   schema refuses the key ("agent.rules.also_email is not something this takes"),
   so the box and the key follow the PC's form. */
const ALSO_FORM = { also_email: { label: `Also e-mail ${EVIL}`, note: `Once per reminder ${EVIL}` } };
const closedSchema = (a) => {
  if (a.agent && a.agent.rules && "also_email" in a.agent.rules) throw refused("agent.rules.also_email is not something this takes");
};

test("“Also e-mail every message”, on a PC that describes it: a box under the channels in the PC's words; it opens as stored, ticks, and is checked and saved in the rules", async () => {
  const saved = [];
  const { h, of } = await open("#/agents/edit/0254698b3f0a", editorAnswers({
    "agents.get": { agent: agent({ rules: { ...agent().rules, also_email: true } }), rev: "r", form: form(ALSO_FORM) },
    "agents.save": (a) => { saved.push(a); return { agent: a.agent, rev: "1111222233334444", words: "Saved." }; } }));
  assert.deepEqual(scan(h.view()), []);
  const box = h.$("ae-alsoemail");
  assert.equal(box.checked, true, "opens as stored");
  assert.ok(box.closest("#ae-pane-who"), "on Who and how, with the channels");
  assert.equal(box.closest("label").textContent.trim(), `Also e-mail ${EVIL}`);
  assert.equal(h.$("ae-alsonote").textContent, `Once per reminder ${EVIL}`);
  assert.equal(plain(h.C._agents.collect()).rules.also_email, true);
  await h.click(box);
  assert.equal(plain(h.C._agents.collect()).rules.also_email, false);
  await h.settle(6000);
  assert.equal(of("agents.check").at(-1).args.agent.rules.also_email, false, "the live check has it");
  await h.click("ae-save");
  await h.settle(10);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].agent.rules.also_email, false, "saved in the rules");
  /* an agent stored before 2.1.1 (no field) on such a PC: the box opens clear */
  const fresh = await open("#/agents/edit/0254698b3f0a", editorAnswers({ "agents.get": { agent: agent(), rev: "r", form: form(ALSO_FORM) } }));
  assert.equal(fresh.h.$("ae-alsoemail").checked, false);
  assert.equal(plain(fresh.h.C._agents.collect()).rules.also_email, false);
});

test("on a PC whose form does not describe it (2.1.0): no box, and rules.also_email is never sent — Check, Save and Preview keep working against its closed schema", async () => {
  const saved = [];
  const { h, of } = await open("#/agents/edit/0254698b3f0a", editorAnswers({
    /* stored on the PC with the field (say a 2.1.1 that was rolled back): it stays there */
    "agents.get": { agent: agent({ rules: { ...agent().rules, also_email: true } }), rev: "r", form: form() },
    "agents.check": (a) => { closedSchema(a); return { problems: [], segments: { text: "", warn: false }, agent: a.agent }; },
    "agents.save": (a) => { closedSchema(a); saved.push(a); return { agent: a.agent, rev: "1111222233334444", words: "Saved." }; },
    "agents.preview": (a) => { closedSchema(a); return { found: 0, would_send: 0, held: 0, skipped: 0, headers: [], rows: [], error: "", words: "0 found." }; } }));
  assert.equal(h.$("ae-alsoemail"), null, "no box");
  assert.equal(h.$("ae-alsonote"), null);
  assert.doesNotMatch(h.$("ae-pane-who").textContent, /Also e-mail/);
  assert.equal("also_email" in plain(h.C._agents.collect()).rules, false, "no key");
  await h.change("ae-subject", "Changed subject");
  await h.settle(6000);
  await h.click("ae-previewbtn");
  await h.settle(10);
  await h.click("ae-save");
  await h.settle(10);
  assert.ok(of("agents.check").length >= 1);
  for (const c of [...of("agents.check"), ...of("agents.preview"), ...of("agents.save")]) {
    assert.equal("also_email" in c.args.agent.rules, false, c.method + " sent no also_email");
  }
  assert.equal(of("agents.preview").length, 1);
  assert.equal(saved.length, 1, "saved — not refused");
  assert.equal(h.ctx.location.hash, "#/agents", "and back to the list");
});
