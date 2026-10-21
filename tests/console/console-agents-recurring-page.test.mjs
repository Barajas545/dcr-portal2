/* The DCR Agents console's Agents tab for a recurring task (dcr-portal/
   console-agents.js, feed "recurring") against stub answers in the shapes
   the PC's handlers build (agent_form.describe(...)["recurring"],
   recurring.history, recurring.projects, recurring.preview_info), with an
   <img onerror> in every string: the panes (What, Recurring task, Rules —
   no Who, no The message, no Schedule), every field in and the closed
   shape out, the project picker, the steps (add, remove, swap, the channels'
   tick order), the warnings, the useful-information preview, the history
   with Run this week's now and Mark this one done (the server asks first),
   the template in New agent, the list row, and a change to and from a
   recurring task. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openConsole, onlineStatus, statusApi, scan, EVIL, esc, plain } from "./console-page-dom.mjs";

const AID = "ab12cd34ef56";
const CRIS = "Corey Banks";
const A074 = { id: "301", code: "A074", label: "A074 — DCR Office" };
const RC_METHODS = ["recurring.history", "recurring.run_now", "recurring.mark_done", "recurring.preview_info", "recurring.projects"];
const METHODS = ["agents.list", "agents.form", "agents.get", "agents.new", "agents.check", "agents.save", "agents.toggle", "agents.duplicate",
  "agents.delete", "agents.preview", "agents.run_now", "dashboard.first_run", "dashboard.approve", "dashboard.status", ...RC_METHODS];
const SOURCES = [["projects", "Active projects and their status"], ["log", "What happened on them (project log)"], ["new_projects", "Projects added"],
  ["shoots", "Photo & video shoots (done and coming)"], ["milestones", "Deliveries and framing milestones (Photo plans)"],
  ["tasks", "Open tasks and tasks with no update"], ["hours", "Hours by project (totals only)"]];
const ASK = "A ready-to-forward draft project report for the marketing team.";

function steps() {
  return [
    { n: 1, at: "06:00", kind: "create", channels: ["email"], condition: "always", subject: `Task created: {{taskName}} ${EVIL}`,
      body: "Hi {{firstName}},\n\nToday's task is on My Tasks.\n\n{{usefulInfo}}\n\n{{link}}", sms: "" },
    { n: 2, at: "07:00", kind: "remind", channels: ["app"], condition: "always", subject: "Due now: {{taskName}}",
      body: "Hi {{firstName}} - \"{{taskName}}\" is due now.", sms: "{{companyName}}: \"{{taskName}}\" is due now. Open: {{link}}" },
    { n: 3, at: "07:30", kind: "remind", channels: ["wadesktop"], condition: "if_open", subject: "Not done yet: {{taskName}}",
      body: "Hi {{firstName}} - not marked done yet.", sms: "{{companyName}}: not marked done yet. {{link}}" },
    { n: 4, at: "09:00", kind: "remind", channels: ["email"], condition: "if_open", subject: "Still not done: {{taskName}}",
      body: "Hi {{firstName}},\n\nstill open.\n\n{{usefulInfo}}", sms: "" },
  ];
}
function rcfg(over = {}) {
  return {
    version: 1,
    task: { title: `Send the project report ${EVIL}`, description: `This week's report ({{weekText}}) ${EVIL}`, assignee: CRIS, project: { ...A074 },
      category: "Office Work", priority: "Medium", due: "07:00", early_ok: true, ...(over.task || {}) },
    repeat: { every: "weekly", interval: 1, weekdays: [0], month_day: 1, nth: 1, weekday: 0, start: "2026-10-05", skip_dates: ["2026-12-21"], ...(over.repeat || {}) },
    steps: over.steps || steps(),
    next_n: 5,
    info: { sources: SOURCES.map((s) => s[0]), days: 7, claude: true, ask: ASK, ...(over.info || {}) },
    catch_up: { create_until: "23:59" },
  };
}
function rform(over = {}) {
  return {
    feed: "recurring", who: `One recurring task per agent ${EVIL}`, vars: ["firstName", "headline", "details", "smsLine"], global_vars: ["companyName"],
    roles: ["Admin", "Manager", "Accountant", "Lead", "Field", "ReadOnly"], days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    channel_kinds: [{ kind: "app", label: "DCR app on the phone" }, { kind: "email", label: "Email" }], params: [],
    min_confidence: [{ key: "likely", label: "likely" }],
    smart: { offered: false, note: `The steps go in their own words; Claude writes the useful information (Recurring task tab). ${EVIL}` },
    note_channels: "x",
    recurring: {
      defaults: rcfg({ task: { title: "", description: "", assignee: "", project: { id: "", code: "", label: "" }, early_ok: false }, info: { ask: "" } }),
      kinds: [{ key: "create", label: "Create the task and send" }, { key: "remind", label: "Reminder" }],
      conditions: [{ key: "always", label: "Always" }, { key: "if_open", label: "Only if not done" }],
      every: [{ key: "weekly", label: "Weekly" }, { key: "daily", label: "Every day" }, { key: "weekdays", label: "Weekdays (Mon-Fri)" },
        { key: "monthly_day", label: "Monthly on a day" }, { key: "monthly_weekday", label: "Monthly on a weekday" }],
      info_sources: SOURCES.map(([key, label]) => ({ key, label })),
      categories: ["Office Work", "Marketing", "Sales"], priorities: ["Urgent", "Medium", "Low"],
      step_vars: ["firstName", "taskName", "dueText", "link", "usefulInfo", "companyName"], max_steps: 8,
      desc_vars: ["dateText", "weekText", "monthText", "companyName"],
      channels: [{ key: "app", label: "the DCR App" }, { key: "sms", label: "text" }, { key: "whatsapp", label: "WhatsApp (Twilio)" },
        { key: "wadesktop", label: "WhatsApp (this computer)" }, { key: "email", label: "email" }],
      new_step: { n: 1, at: "07:00", kind: "remind", channels: ["email"], condition: "if_open", subject: "Reminder: {{taskName}}",
        body: "Hi {{firstName}} - not marked done yet. {{link}}", sms: "{{companyName}}: not marked done yet. {{link}}" },
      default_ask: "A short, practical summary aimed at this task.",
      people: [CRIS, EVIL, "Luis Martinez"],
      claude: { ready: false, note: `Waiting on the DCR server computer: no Claude key ${EVIL}` },
      ...(over.recurring || {}),
    },
  };
}
function ragent(over = {}) {
  return {
    id: AID, name: `Monday ${EVIL}`, feed: "recurring", enabled: true,
    schedule: { kind: "interval", every_minutes: 5, between: ["00:00", "23:59"], at: "00:00", until: "23:59", days: "everyday" },
    audience: { roles: [], include: [CRIS], exclude: [] }, channels: ["email", "app", "wadesktop"],
    template: { subject: "{{headline}}", body: "{{details}}", sms: "{{smsLine}}", whatsapp_content_sid: "", whatsapp_vars: [] },
    rules: { repeat_after_hours: 0, max_reminders: 1, min_confidence: "likely", escalate_to: "", escalate_after: 0, max_per_run: 10,
      smart_wording: false, dry_run: false, first_run_reviewed: true },
    feed_params: {}, recurring: rcfg(), ...over,
  };
}
function stepView(n, at, kind, channels, condition, outcome, words) {
  return { n, at, kind, channels, condition, outcome, words, channel: outcome === "sent" ? channels[0] : "", when: "" };
}
function hist(over = {}) {
  return {
    agent_id: AID, next: { at: "2026-10-12T09:00-07:00", text: `Mon Oct 12, 9:00 am - Reminder by email, only if not done ${EVIL}` },
    can_run_now: false, run_now_words: `This week's task was already made on Mon Oct 12 — open it: https://portal.test/my-tasks.html?task=701 ${EVIL}`,
    occurrences: [
      { date: "2026-10-12", date_text: "Mon Oct 12", status: "created", outcome: "open", outcome_words: "open", task_id: "701",
        link: "https://portal.test/my-tasks.html?task=701", created_at: "2026-10-12T06:00-07:00", created_by: "schedule", completed_at: "",
        completed_by: "", completed_how: "", info_source: "digest", info_why: `no Claude key ${EVIL}`, note: "", can_mark_done: true,
        steps: [stepView(1, "06:00", "create", ["email"], "always", "sent", "sent by email at 6:00 am (handed to Outlook)"),
          stepView(2, "07:00", "remind", ["app"], "always", "sent", "sent by the DCR App at 7:00 am (delivered)"),
          stepView(3, "07:30", "remind", ["wadesktop"], "if_open", "waiting", `not sent yet: ${EVIL}`),
          stepView(4, "09:00", "remind", ["email"], "if_open", "future", "at 9:00 am")] },
      { date: "2026-10-05", date_text: "Mon Oct 5", status: "done", outcome: "on_time", outcome_words: "on time", task_id: "700",
        link: "javascript:alert(1)", created_at: "2026-10-05T06:00-07:00", created_by: "by hand", completed_at: "2026-10-05T06:52-07:00",
        completed_by: CRIS, completed_how: "reply", info_source: "claude", info_why: "", note: "", can_mark_done: false,
        steps: [stepView(1, "06:00", "create", ["email"], "always", "sent", "sent by email at 6:00 am (handed to Outlook)"),
          stepView(3, "07:30", "remind", ["wadesktop"], "if_open", "done_skip", "not needed - done at 6:52 am")] },
      { date: "2026-09-28", date_text: "Mon Sep 28", status: "missed", outcome: "missed", outcome_words: "missed", task_id: "", link: "",
        created_at: "", created_by: "", completed_at: "", completed_by: "", completed_how: "", info_source: "", info_why: "",
        note: `not made — the PC was off or asleep from 6:00 am until 11:59 pm ${EVIL}`, can_mark_done: false,
        steps: [stepView(1, "06:00", "create", ["email"], "always", "not_sent", "not sent - the task was not made")] },
    ],
    ...over,
  };
}
const PROJECTS = { projects: [{ ...A074, status: "Active", active: true }, { id: "11", code: "A081", label: `A081 — House ${EVIL}`, status: "In Progress", active: true },
  { id: "9", code: "A052", label: "A052 — Garage", status: "Completed", active: false }], default: "301" };

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
function base(over = {}) {
  return {
    "agents.get": { agent: ragent(), rev: "r1", form: rform() },
    "agents.check": (a) => ({ problems: [], segments: { text: "", warn: false }, agent: a.agent, warnings: [] }),
    "recurring.projects": PROJECTS,
    "recurring.history": hist(),
    ...over,
  };
}
async function open(hash, answers, extra = {}) {
  const s = stubs({ "agents.list": { feeds: [], feed_choices: [], templates: [] }, ...answers });
  const h = await openConsole({ modules: ["console-agents.js"], api: statusApi(onlineStatus()), rpc: s.fn, methods: METHODS, hash, ...extra });
  await h.settle(10);
  return { h, calls: s.calls, of: (m) => s.calls.filter((c) => c.method === m) };
}
const refused = (msg) => Object.assign(new Error(msg), { code: "refused" });
const texts = (els) => els.map((e) => e.textContent);

/* ── the panes and the fields ─────────────────────────────────────────── */

test("a recurring task opens on its own pane: What, Recurring task, Rules — no Who, no message, no schedule; every string escaped", async () => {
  const { h, of } = await open(`#/agents/edit/${AID}`, base());
  const v = h.view();
  assert.deepEqual(scan(v), []);
  assert.deepEqual(texts(v.querySelectorAll(".ca-panes button")), ["What", "Recurring task", "Rules"]);
  assert.equal(h.$("ae-tab-rc").getAttribute("aria-selected"), "true");
  assert.equal(h.$("ae-pane-rc").hidden, false);
  assert.equal(h.$("ae-pane-what").hidden, true);
  for (const gone of ["ae-pane-who", "ae-pane-words", "ae-kind", "ae-at", "ae-repeat", "ae-maxrem", "ae-cap", "ae-smart", "ae-params"]) {
    assert.equal(h.$(gone) === null || (gone === "ae-params" && !h.$(gone)), true, `${gone} is not drawn`);
  }
  assert.ok(h.$("ae-dry") && h.$("ae-reviewed"), "Rules keeps dry run and first run reviewed");
  assert.match(h.$("ae-pane-rules").textContent, /The steps go in their own words/);
  assert.equal(h.$("ae-rc-title").value, `Send the project report ${EVIL}`);
  assert.equal(h.$("ae-rc-desc").value, `This week's report ({{weekText}}) ${EVIL}`);
  assert.equal(h.$("ae-rc-assignee").value, CRIS);
  assert.deepEqual(h.view().querySelectorAll("#ae-rc-people option").map((o) => o.getAttribute("value")), [CRIS, EVIL, "Luis Martinez"]);
  assert.equal(h.$("ae-rc-earlyword").textContent, `${CRIS} asked for these times — the phone may buzz from 5:00 am`);
  assert.equal(h.$("ae-rc-early").checked, true);
  assert.equal(h.$("ae-rc-category").value, "Office Work");
  assert.equal(h.$("ae-rc-due").value, "07:00");
  assert.equal(h.$("ae-rc-every").value, "weekly");
  assert.equal(h.$("ae-rc-wd0").checked, true);
  assert.equal(h.$("ae-rc-mday").hidden, true);
  assert.equal(h.$("ae-rc-start").value, "2026-10-05");
  assert.equal(h.$("ae-rc-skip").value, "2026-12-21");
  assert.equal(h.$("ae-rc-claudenote").textContent, `Waiting on the DCR server computer: no Claude key ${EVIL}`);
  assert.equal(h.$("ae-rc-ask").value, ASK);
  const cards = v.querySelectorAll(".ca-step");
  assert.equal(cards.length, 4);
  assert.ok(cards[0].classList.contains("create"));
  assert.equal(cards[0].querySelector('[data-do="rcrm"]'), null, "the create step cannot be removed or moved");
  assert.equal(h.$("ae-rc-s0-cond").disabled, true, "'Create the task' always goes");
  assert.equal(h.$("ae-rc-s0-subject").value, `Task created: {{taskName}} ${EVIL}`);
  assert.equal(h.$("ae-rc-s2-ch-wadesktop").checked, true);
  assert.equal(h.$("ae-rc-s2-cond").value, "if_open");
  assert.equal(cards[1].querySelector('[data-do="rcup"]').disabled, true, "nothing moves above the create step");
  assert.deepEqual(of("recurring.projects").map((c) => c.args), [{}], "the projects load when the pane first opens");
  assert.deepEqual(of("recurring.history").map((c) => c.args), [{ agent_id: AID, limit: 12 }]);
  assert.equal(h.$("ae-rc-project").value, "301", "the saved project stays picked");
  assert.match(h.$("ae-rc-projnote").textContent, /^3 projects from the portal, 2 active\.$/);
  assert.ok(h.view().querySelectorAll("#ae-rc-project option").map((o) => o.textContent).includes("A052 — Garage (Completed)"));
  assert.equal(h.C._agents.state().dirty, false, "opening is not an edit");
});

test("collect gives back exactly the closed shape: the recurring settings, dry run and first run reviewed — no schedule, audience or template", async () => {
  const { h } = await open(`#/agents/edit/${AID}`, base());
  assert.deepEqual(plain(h.C._agents.collect()), {
    id: AID, name: `Monday ${EVIL}`, feed: "recurring", enabled: true, rules: { dry_run: false, first_run_reviewed: true },
    recurring: {
      version: 1,
      task: { title: `Send the project report ${EVIL}`, description: `This week's report ({{weekText}}) ${EVIL}`, assignee: CRIS, project: A074,
        category: "Office Work", priority: "Medium", due: "07:00", early_ok: true },
      repeat: { every: "weekly", interval: 1, weekdays: [0], month_day: 1, nth: 1, weekday: 0, start: "2026-10-05", skip_dates: ["2026-12-21"] },
      steps: steps(),
      next_n: 5,
      info: { sources: SOURCES.map((s) => s[0]), days: 7, claude: true, ask: ASK },
      catch_up: { create_until: "23:59" },
    },
  });
  await h.change("ae-rc-every", "monthly_weekday");
  assert.equal(h.$("ae-rc-weekly").hidden, true);
  assert.equal(h.$("ae-rc-mwd").hidden, false);
  await h.change("ae-rc-nth", "-1");
  await h.change("ae-rc-weekday", "4");
  await h.click("ae-rc-src-hours");
  await h.change("ae-rc-skip", "2026-12-25 2027-01-01,");
  await h.change("ae-rc-assignee", "Luis Martinez");
  assert.equal(h.$("ae-rc-earlyword").textContent, "Luis Martinez asked for these times — the phone may buzz from 5:00 am");
  assert.equal(h.$("ae-rc-early").checked, false, "ticked for Corey, so it is unticked for someone else");
  const r = plain(h.C._agents.collect()).recurring;
  assert.deepEqual([r.repeat.every, r.repeat.nth, r.repeat.weekday, r.repeat.skip_dates], ["monthly_weekday", -1, 4, ["2026-12-25", "2027-01-01"]]);
  assert.equal(r.info.sources.includes("hours"), false);
  assert.equal(r.task.assignee, "Luis Martinez");
  assert.equal(r.task.early_ok, false);
  await h.click("ae-rc-early");
  await h.change("ae-rc-assignee", "Luis Martinez");
  assert.equal(h.$("ae-rc-early").checked, true, "ticked again for Luis: it stays while the name stays");
  assert.equal(h.C._agents.state().dirty, true);
});

test("'asked for these times' ticked with no name yet (the template) stays ticked when the first name is picked, and goes for the next", async () => {
  const { h } = await open(`#/agents/edit/${AID}`, base({
    "agents.get": { agent: ragent({ recurring: rcfg({ task: { assignee: "" } }) }), rev: "r1", form: rform() } }));
  assert.equal(h.$("ae-rc-early").checked, true);
  h.$("ae-rc-assignee").value = "Cris";
  h.$("ae-rc-assignee").dispatchEvent({ type: "input" });
  assert.equal(h.$("ae-rc-early").checked, true, "a keystroke is not a pick");
  await h.change("ae-rc-assignee", CRIS);
  assert.equal(h.$("ae-rc-early").checked, true);
  await h.change("ae-rc-assignee", "Luis Martinez");
  assert.equal(h.$("ae-rc-early").checked, false);
});

test("a new agent from no saved project gets A074 picked when the list loads; Load projects tries again after a failure", async () => {
  let fail = true;
  const { h, of } = await open(`#/agents/edit/${AID}`, base({
    "agents.get": { agent: ragent({ recurring: rcfg({ task: { project: { id: "", code: "", label: "" } } }) }), rev: "r1", form: rform() },
    "recurring.projects": () => (fail ? new Error("The portal did not answer.") : PROJECTS),
  }));
  assert.match(h.$("ae-rc-projnote").textContent, /^Could not load the projects \(The portal did not answer\.\) — Load projects tries again\.$/);
  assert.equal(h.$("ae-rc-project").value, "");
  fail = false;
  await h.click("ae-rc-loadproj");
  await h.settle(10);
  assert.equal(of("recurring.projects").length, 2);
  assert.equal(h.$("ae-rc-project").value, "301");
  assert.match(h.$("ae-rc-projnote").textContent, /A074 DCR Office is picked — office tasks live there\.$/);
  assert.deepEqual(plain(h.C._agents.collect()).recurring.task.project, A074);
  assert.equal(h.C._agents.state().dirty, true, "a pick the admin did not make is still a change to save");
  assert.deepEqual(scan(h.view()), []);
});

/* ── the steps ────────────────────────────────────────────────────────── */

test("steps: Add a step (the server's words, an hour after the last), swap two (the times stay), remove; eight at most", async () => {
  const { h } = await open(`#/agents/edit/${AID}`, base());
  await h.change("ae-rc-s1-subject", "Typed, not saved yet");
  await h.click("ae-rc-add");
  let s = plain(h.C._agents.collect()).recurring.steps;
  assert.equal(s.length, 5);
  assert.deepEqual([s[4].n, s[4].at, s[4].kind, s[4].channels, s[4].condition, s[4].subject], [5, "10:00", "remind", ["email"], "if_open", "Reminder: {{taskName}}"]);
  assert.equal(s[1].subject, "Typed, not saved yet", "what was typed survives the redraw");
  assert.equal(h.view().querySelectorAll(".ca-step").length, 5);
  await h.click(h.view().querySelector('[data-do="rcdown"][data-i="2"]'));
  s = plain(h.C._agents.collect()).recurring.steps;
  assert.deepEqual(s.slice(2, 4).map((x) => [x.n, x.at, x.channels, x.condition]), [[4, "07:30", ["email"], "if_open"], [3, "09:00", ["wadesktop"], "if_open"]]);
  await h.click(h.view().querySelector('[data-do="rcup"][data-i="3"]'));
  s = plain(h.C._agents.collect()).recurring.steps;
  assert.deepEqual(s.slice(2, 4).map((x) => [x.n, x.at]), [[3, "07:30"], [4, "09:00"]], "and back");
  await h.click(h.view().querySelector('[data-do="rcrm"][data-i="4"]'));
  assert.equal(plain(h.C._agents.collect()).recurring.steps.length, 4);
  for (let i = 0; i < 4; i++) await h.click("ae-rc-add");
  assert.equal(h.view().querySelectorAll(".ca-step").length, 8);
  assert.equal(h.$("ae-rc-add").disabled, true);
  assert.deepEqual(plain(h.C._agents.collect()).recurring.steps.map((x) => x.at), ["06:00", "07:00", "07:30", "09:00", "10:00", "11:00", "12:00", "13:00"]);
  assert.deepEqual(plain(h.C._agents.collect()).recurring.steps.map((x) => x.n), [1, 2, 3, 4, 6, 7, 8, 9],
    "the removed step's number 5 is never given out again (its day's sends would come with it)");
  assert.equal(plain(h.C._agents.collect()).recurring.next_n, 10);
  assert.equal(h.C._agents.state().dirty, true);
  assert.deepEqual(scan(h.view()), []);
});

test("a step's channels keep the order they were ticked in, said under them; Insert puts a placeholder in the box last focused", async () => {
  const { h } = await open(`#/agents/edit/${AID}`, base());
  await h.click("ae-rc-s3-ch-app");
  assert.deepEqual(plain(h.C._agents.collect()).recurring.steps[3].channels, ["email", "app"]);
  assert.equal(h.$("ae-rc-s3-order").textContent, "Tried in this order: email, then the DCR App — the first one that can reach them goes.");
  await h.click("ae-rc-s3-ch-email");
  await h.click("ae-rc-s3-ch-email");
  assert.deepEqual(plain(h.C._agents.collect()).recurring.steps[3].channels, ["app", "email"]);
  await h.click("ae-rc-s3-ch-app");
  assert.equal(h.$("ae-rc-s3-order").textContent, "", "one channel has no order to explain");
  h.$("ae-rc-s1-sms").value = "Short ";
  h.$("ae-rc-s1-sms").focus();
  await h.click(h.view().querySelector('[data-do="rcvar"][data-var="dueText"]'));
  assert.equal(h.$("ae-rc-s1-sms").value, "Short {{dueText}}");
  h.$("ae-rc-desc").value = "Due ";
  await h.click(h.view().querySelector('[data-do="rcdvar"][data-var="dateText"]'));
  assert.equal(h.$("ae-rc-desc").value, "Due {{dateText}}");
});

test("the server's problems and warnings show as you type (agents.check); a recurring check sends the recurring shape", async () => {
  const { h, of } = await open(`#/agents/edit/${AID}`, base({
    "agents.check": (a) => ({ problems: a.agent.recurring.task.title ? [] : ["give the task a title"], segments: { text: "", warn: false }, agent: a.agent,
      warnings: [`step 2 at 07:00 goes by the DCR App: phones are quiet until 08:00 ${EVIL}`, "WhatsApp (this computer) waits in the outbox until someone presses Send on the DCR server"] }),
  }));
  await h.settle(100);
  assert.equal(of("agents.check").length, 1);
  assert.deepEqual(Object.keys(of("agents.check")[0].args.agent).sort(), ["enabled", "feed", "id", "name", "recurring", "rules"]);
  assert.deepEqual(texts(h.$("ae-rc-warnings").querySelectorAll("li")), [`step 2 at 07:00 goes by the DCR App: phones are quiet until 08:00 ${EVIL}`,
    "WhatsApp (this computer) waits in the outbox until someone presses Send on the DCR server"]);
  assert.match(h.$("ae-rc-warnings").className, /warn/);
  await h.change("ae-rc-title", "");
  await h.settle(7000);
  assert.equal(h.$("ae-problems").textContent, "give the task a title");
  assert.deepEqual(scan(h.view()), []);
});

test("Save sends the recurring shape with the rev it was opened at; the server's refusal is shown as its list", async () => {
  let answer = refused("Not saved: pick the project the task goes on; step 3: pick at least one channel");
  const { h, of } = await open(`#/agents/edit/${AID}`, base({ "agents.save": () => answer }));
  await h.change("ae-rc-title", "Send the weekly report");
  await h.click("ae-save");
  await h.settle(10);
  assert.equal(of("agents.save")[0].args.rev, "r1");
  assert.equal(of("agents.save")[0].args.agent.recurring.task.title, "Send the weekly report");
  assert.equal(of("agents.save")[0].args.agent.schedule, undefined);
  assert.deepEqual(texts(h.$("ae-problems").querySelectorAll("li")), ["pick the project the task goes on", "step 3: pick at least one channel"]);
  answer = { agent: ragent(), rev: "r2", words: "Saved 'Monday'." };
  await h.click("ae-save");
  await h.settle(10);
  assert.equal(h.ctx.location.hash, "#/agents");
});

/* ── the useful information ───────────────────────────────────────────── */

test("Preview the useful information writes it from the settings on the screen, escaped — nothing is saved or sent", async () => {
  let answer = { text: `Projects in progress (2):\n- A081 House ${EVIL}`, source: "digest", why: `no Claude key on the DCR server computer ${EVIL}`,
    notes: [], sources: ["Active projects and their status"], day: "2026-10-12" };
  const { h, of } = await open(`#/agents/edit/${AID}`, base({ "recurring.preview_info": () => answer }));
  await h.click("ae-rc-src-hours");
  await h.click("ae-rc-preview");
  await h.settle(10);
  const args = of("recurring.preview_info")[0].args;
  assert.deepEqual(args, { agent: plain(h.C._agents.collect()) }, "the unsaved editor state");
  assert.equal(args.agent.recurring.info.sources.includes("hours"), false);
  const box = h.$("ae-rc-info");
  assert.equal(box.querySelector(".ca-rc-text").textContent, `Projects in progress (2):\n- A081 House ${EVIL}`);
  assert.match(box.querySelector(".ca-rc-prevnote").textContent, /^The plain summary, as it would go on Mon, Oct 12 — Claude did not write it: no Claude key/);
  assert.match(box.textContent, /From: Active projects and their status/);
  assert.deepEqual(scan(box), []);
  answer = { text: "Draft report", source: "claude", why: "", notes: [`A090 is new ${EVIL}`], sources: [], day: "2026-10-12" };
  await h.click("ae-rc-preview");
  await h.settle(10);
  assert.match(box.textContent, /^Written by Claude, as it would go on Mon, Oct 12\. Nothing was saved or sent\./);
  assert.match(box.textContent, /Claude's notes: A090 is new/);
  assert.equal(of("agents.save").length, 0);
  answer = refused("Fix first: give the task a title");
  await h.click("ae-rc-preview");
  await h.settle(10);
  assert.equal(h.$("ae-problems").textContent, "give the task a title");
});

/* ── the history ──────────────────────────────────────────────────────── */

test("the history: the next step, each day with its outcome and steps, escaped; a link only when it is https", async () => {
  const { h } = await open(`#/agents/edit/${AID}`, base());
  const box = h.$("ae-rc-history");
  assert.deepEqual(scan(box), []);
  assert.equal(box.querySelector(".ca-rc-nextline").textContent, `Next: Mon Oct 12, 9:00 am - Reminder by email, only if not done ${EVIL}`);
  const run = h.$("ae-rc-runnow");
  assert.equal(run.textContent, "Run this week's now");
  assert.equal(run.disabled, true, "this week's task was already made");
  assert.equal(h.$("ae-rc-runwhy").textContent, `This week's task was already made on Mon Oct 12 — open it: https://portal.test/my-tasks.html?task=701 ${EVIL}`);
  const days = box.querySelectorAll(".ca-occ");
  assert.deepEqual(days.map((d) => d.querySelector(".ca-occ-day").textContent), ["Mon Oct 12", "Mon Oct 5", "Mon Sep 28"]);
  assert.deepEqual(days.map((d) => d.querySelector(".c-chip").className), ["c-chip info", "c-chip good", "c-chip bad"]);
  assert.deepEqual(days[0].querySelectorAll(".ca-occ-step").map((s) => [s.querySelector(".ca-occ-at").textContent, s.querySelector(".ca-occ-label").textContent,
    s.querySelector(".ca-occ-words").textContent]), [
    ["6:00 am", "Create the task", "sent by email at 6:00 am (handed to Outlook)"],
    ["7:00 am", "Reminder by the DCR App", "sent by the DCR App at 7:00 am (delivered)"],
    ["7:30 am", "Reminder by WhatsApp (this computer), only if not done", `not sent yet: ${EVIL}`],
    ["9:00 am", "Reminder by email, only if not done", "at 9:00 am"]]);
  assert.equal(days[0].querySelector(".ca-occ-link").getAttribute("href"), "https://portal.test/my-tasks.html?task=701");
  assert.equal(days[1].querySelector(".ca-occ-link"), null, "a javascript: link is never drawn");
  /* the DCR server's clock, as the stamp carries it, not this browser's */
  const meta = (d) => d.querySelector(".ca-meta");
  assert.equal(meta(days[0]).textContent, "made 6:00 am · useful information: the plain summary");
  assert.equal(meta(days[0]).getAttribute("title"), `Claude did not write it: no Claude key ${EVIL}`);
  assert.equal(meta(days[1]).textContent, `made 6:00 am by hand · done 6:52 am by ${CRIS} (reply) · useful information by Claude`);
  assert.match(days[2].textContent, /not made — the PC was off or asleep/);
  assert.equal(days[2].querySelectorAll(".ca-occ-step").length, 0, "a day never made: its note says it once, not per step");
  assert.equal(h.C._agents.rcTimeWords("12:05"), "12:05 pm");
  assert.equal(h.C._agents.rcTimeWords("00:30"), "12:30 am");
  assert.equal(days[0].querySelectorAll('[data-do="rcdone"]').length, 1);
  assert.equal(days[1].querySelectorAll('[data-do="rcdone"]').length, 0, "a done day has no Mark this one done");
});

test("Mark this one done goes through the server's question (recurring.mark_done), then the history is read again", async () => {
  const q = { title: "Mark done", question: `Mark 'Send the project report - Mon Oct 12 ${EVIL}' done on My Tasks? Its 'only if not done' reminders stop.`,
    ok_text: "Mark done", danger: false, twice: null, extra: [] };
  const { h, of } = await open(`#/agents/edit/${AID}`, base({
    "recurring.mark_done": (a) => (a.confirmed ? { words: "Marked it done on My Tasks." } : { confirm: q }),
  }), { answers: [true] });
  await h.click(h.$("ae-rc-history").querySelector('[data-do="rcdone"]'));
  await h.settle(10);
  assert.deepEqual(of("recurring.mark_done").map((c) => c.args), [{ agent_id: AID, date: "2026-10-12" },
    { agent_id: AID, date: "2026-10-12", confirmed: true }]);
  assert.equal(h.dialogs[0].opts.message, q.question);
  assert.ok(h.toasts().some((t) => t.text === "Marked it done on My Tasks."));
  assert.equal(of("recurring.history").length, 2, "read again");
});

test("Run this week's now asks first (recurring.run_now) and refuses while there are unsaved changes", async () => {
  const q = { title: "Make it now", question: "Make 'Send the project report' for Mon Oct 12 on My Tasks now and email Corey that it was made?",
    ok_text: "Make it now", danger: false, twice: null, extra: [] };
  const { h, of } = await open(`#/agents/edit/${AID}`, base({
    "recurring.history": hist({ can_run_now: true, run_now_words: q.question }),
    "recurring.run_now": (a) => (a.confirmed ? { words: `Made 'Send the project report - Mon Oct 12' on My Tasks — email sent ${EVIL}` } : { confirm: q }),
  }), { answers: [true] });
  assert.equal(h.$("ae-rc-runnow").disabled, false);
  assert.equal(h.$("ae-rc-runwhy"), null, "the question is the server's, asked on the click");
  await h.click("ae-rc-runnow");
  await h.settle(10);
  assert.deepEqual(of("recurring.run_now").map((c) => c.args), [{ agent_id: AID }, { agent_id: AID, confirmed: true }]);
  assert.equal(h.dialogs[0].opts.message, q.question);
  assert.ok(h.toasts().some((t) => t.text === `Made 'Send the project report - Mon Oct 12' on My Tasks — email sent ${EVIL}`));
  assert.equal(of("recurring.history").length, 2);
  await h.change("ae-rc-title", "Changed");
  await h.click("ae-rc-runnow");
  await h.settle(10);
  assert.equal(of("recurring.run_now").length, 2, "not sent");
  assert.ok(h.toasts().some((t) => t.text === "Save your changes first — this makes the task from the saved agent."));
  await h.change("ae-rc-every", "daily");
  assert.equal(h.$("ae-rc-runnow").textContent, "Run today's now");
});

test("a history that cannot be read says so with its own Try again (the editor is not redrawn)", async () => {
  let fail = true;
  const { h, of } = await open(`#/agents/edit/${AID}`, base({ "recurring.history": () => (fail ? new Error(`Not now ${EVIL}`) : hist()) }));
  await h.change("ae-rc-title", "Typed");
  assert.match(h.$("ae-rc-history").textContent, /The history could not be read\.Not now/);
  assert.deepEqual(scan(h.view()), []);
  fail = false;
  await h.click(h.$("ae-rc-history").querySelector('[data-do="rchist"]'));
  await h.settle(10);
  assert.equal(of("recurring.history").length, 2);
  assert.equal(h.$("ae-rc-title").value, "Typed", "what was typed stays");
  assert.equal(h.$("ae-rc-history").querySelectorAll(".ca-occ").length, 3);
});

/* ── new agents, the list, the feed ───────────────────────────────────── */

test("New agent lists the templates after the feeds; a template opens through agents.new {template}, with no history yet", async () => {
  const tpl = { template: "recurring_weekly_report", label: `Recurring task — weekly report (example) ${EVIL}`, feed: "recurring" };
  const list = { feeds: [], feed_choices: [{ feed: "checks", label: "Checks ready for pickup" }, { feed: "recurring", label: "Recurring tasks" }], templates: [tpl] };
  const { h } = await open("#/agents", { "agents.list": list }, { answers: [{ feed: "tpl:recurring_weekly_report" }] });
  await h.click("caNew");
  await h.settle(10);
  assert.deepEqual(plain(h.dialogs[0].opts.fields[0].options), [{ value: "checks", label: "Checks ready for pickup" },
    { value: "recurring", label: "Recurring tasks" }, { value: "tpl:recurring_weekly_report", label: tpl.label }]);
  assert.equal(h.ctx.location.hash, "#/agents/template/recurring_weekly_report");
  const fresh = ragent({ id: "f00dfeed0001", name: "Monday — project report to marketing", enabled: false,
    recurring: rcfg({ task: { assignee: "", project: { id: "", code: "", label: "" } } }) });
  const two = await open("#/agents/template/recurring_weekly_report", base({ "agents.new": { agent: fresh, rev: "", form: rform() } }));
  assert.deepEqual(two.of("agents.new").map((c) => c.args), [{ template: "recurring_weekly_report" }]);
  assert.equal(two.of("recurring.history").length, 0, "nothing to read before it is saved");
  assert.match(two.h.$("ae-rc-history").textContent, /Save the agent first/);
  assert.equal(two.h.$("ae-run"), null);
  assert.equal(two.h.$("ae-rc-project").value, "301", "A074 picked once the list loads");
  assert.equal(two.h.$("ae-rc-earlyword").textContent, "The assignee asked for these times — the phone may buzz from 5:00 am");
});

test("the list: a recurring task shows its next step and its last days under its name, escaped", async () => {
  const row = { id: AID, name: `Monday ${EVIL}`, when: "Weekly on Mondays, 6:00 am", channels: ["email", "app", "wadesktop"], on: true, notes: [],
    waiting: false, pending_review: false, last: null, next: "2026-10-12T09:00-07:00", next_today: true,
    recurring: { next_text: `Mon Oct 12, 9:00 am - Reminder by email, only if not done ${EVIL}`,
      recent: [{ date_text: "Mon Oct 12", outcome_words: "open" }, { date_text: "Mon Oct 5", outcome_words: "late — done at 7:12 am" },
        { date_text: "Mon Sep 28", outcome_words: "missed" }] } };
  const list = { feeds: [{ feed: "recurring", label: "Recurring tasks", n: 1, on: 1, people: [{ key: "corey banks", label: CRIS, include: [CRIS], n: 1, on: 1, agents: [row] }] }],
    feed_choices: [{ feed: "recurring", label: "Recurring tasks" }], templates: [] };
  const { h } = await open("#/agents", { "agents.list": list });
  const card = h.$(`ca-a-${AID}`);
  assert.deepEqual(scan(h.view()), []);
  assert.equal(card.querySelector(".ca-rc-next").textContent, `Next: Mon Oct 12, 9:00 am - Reminder by email, only if not done ${EVIL}`);
  assert.deepEqual(card.querySelectorAll(".ca-rc-day").map((d) => [d.textContent, d.querySelector(".c-chip").className]), [
    ["Mon Oct 12 open", "c-chip info"], ["Mon Oct 5 late — done at 7:12 am", "c-chip warn"], ["Mon Sep 28 missed", "c-chip bad"]]);
  assert.match(card.textContent, /Weekly on Mondays, 6:00 am/);
});

test("changing what it watches to or from a recurring task draws the editor again with the name kept; the old buttons stay quiet", async () => {
  const generic = { feed: "checks", who: "Checks", vars: ["firstName"], global_vars: ["companyName"], roles: ["Field"], days: ["Mon"],
    channel_kinds: [{ kind: "email", label: "Email" }], params: [], min_confidence: [{ key: "likely", label: "likely" }],
    smart: { offered: false, note: "Not for money." }, note_channels: "x" };
  const feeds = { feeds: [], feed_choices: [{ feed: "checks", label: "Checks ready for pickup" }, { feed: "recurring", label: "Recurring tasks" }], templates: [] };
  const { h, of } = await open(`#/agents/edit/${AID}`, base({ "agents.list": feeds, "agents.form": (a) => (a.feed === "recurring" ? rform() : generic),
    "agents.save": (a) => ({ agent: a.agent, rev: "r2", words: "Saved." }) }));
  await h.change("ae-name", "Renamed");
  await h.change("ae-feed", "checks");
  await h.settle(10);
  assert.deepEqual(texts(h.view().querySelectorAll(".ca-panes button")), ["What and when", "Who and how", "The message", "Rules"]);
  assert.equal(h.$("ae-pane-rc"), null);
  assert.equal(h.$("ae-name").value, "Renamed");
  assert.equal(h.$("ae-feed").value, "checks");
  assert.equal(h.C._agents.state().dirty, true);
  await h.click("ae-tab-who");
  assert.equal(h.$("ae-pane-who").hidden, false);
  await h.change("ae-feed", "recurring");
  await h.settle(10);
  assert.deepEqual(texts(h.view().querySelectorAll(".ca-panes button")), ["What", "Recurring task", "Rules"]);
  assert.equal(h.$("ae-rc-title").value, `Send the project report ${EVIL}`, "its own settings come back");
  await h.click("ae-rc-add");
  assert.equal(h.view().querySelectorAll(".ca-step").length, 5, "one step added, not one per drawing of the editor");
  await h.click("ae-save");
  await h.settle(10);
  assert.equal(of("agents.save").length, 1, "one save, not one per drawing of the editor");
  assert.equal(of("agents.save")[0].args.agent.name, "Renamed");
});
