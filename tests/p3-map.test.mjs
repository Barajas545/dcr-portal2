// P3 (tasks): the pure task mapper site/js/map/tasks.js — rows of rpc my_tasks and of the tables to what
// My Tasks, the tasks map and the project's Tasks tab draw; the clock (app.task_clock's rule, the 5-day
// edge in Pacific days, a shoot's day); the brief, the footers, the words; who may do what; the
// new-task row; the home badge. Made-up people and sandbox data only.
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../site/js/map/tasks.js";

const ME = "00000000-0000-4000-8000-000000000006";
const OTHER = "00000000-0000-4000-8000-000000000005";
const names = { [ME]: "Jordan Field", [OTHER]: "Riley Lead" };
const nameOf = (id) => names[id] || "";
const mask = (t) => String(t).replace(/\$[\d,]+/g, "(amount hidden)");

test("an imported author reads as DCR Desktop 2 shows it: 'Ana · old portal'; the import itself 'Old portal'", () => {
  assert.equal(M.oldAuthor("Ana"), "Ana · old portal");
  assert.equal(M.oldAuthor("  old   portal "), "Old portal");
  assert.equal(M.oldAuthor(""), "");
  assert.equal(M.toNote({ id: 1, text: "x", created_by: null, author_name: "Old portal", via: "import" }, { nameOf }).who, "Old portal");
  assert.equal(M.toNote({ id: 2, text: "x", created_by: null, author_name: "Ana", via: "import" }, { nameOf }).who, "Ana · old portal");
});

/** A row as rpc my_tasks answers it: the columns of migration M3 (20261022000100_tasks_push.sql), the
    notes as its jsonb (author, on_behalf_of_name), the clock of app.task_clock. */
function row(extra) {
  return Object.assign({
    id: 12, project_id: 268, estimate_item_id: null, title: "Measure the deck ledger", description: "North and south sides.", category: "General Task",
    sub_category: "Follow up", priority: "high", assigned_to: ME, due_date: "2026-10-22", due_time: "07:30:00", status: "open",
    created_at: "2026-10-11T16:05:00Z", created_by: OTHER, updated_at: "2026-10-11T16:05:00Z", updated_by: null, version: 3,
    agent_kind: null, agent_ref: null, agent_date: null, author_name: null,
    project_number: "A267", project_name: "Sandbox Residence", project_address: "1 Test Way\nUnit B", project_city: "Sandbox",
    project_lat: 35.5, project_lng: -120.7, assignee_name: "Jordan Field", created_by_name: "Riley Lead", mine: true,
    notes: [
      { id: 2, text: "South side next", created_at: "2026-10-14T18:00:00Z", created_by: ME, author: "Jordan Field", via: "portal", on_behalf_of: null, on_behalf_of_name: null, version: 1 },
      { id: 1, text: "Measured the north side", created_at: "2026-10-13T18:00:00Z", created_by: null, author: "Ana Crew", via: "import", on_behalf_of: null, on_behalf_of_name: null, version: 1 },
    ],
    last_update: "2026-10-14T18:00:00Z", last_update_source: "note", days_since_update: 6, last_note: "South side next", needs_update: true,
  }, extra || {});
}

test("toTask: a my_tasks row -> the page's task (project, place, assignee, notes oldest first, the database's clock)", () => {
  const t = M.toTask(row(), { me: ME, nameOf, today: "2026-10-20" });
  assert.deepEqual([t.id, t.version, t.title, t.priority, t.priorityLabel, t.priKey], [12, 3, "Measure the deck ledger", "high", "High", "urgent"]);
  assert.deepEqual([t.projectId, t.projectNumber, t.projectName, t.address, t.city, t.lat, t.lng], [268, "A267", "Sandbox Residence", "1 Test Way, Unit B", "Sandbox", 35.5, -120.7]);
  assert.deepEqual([t.assignedTo, t.assigneeName, t.mine, t.createdByMe, t.requestedBy], [ME, "Jordan Field", true, false, "Riley Lead"]);
  assert.equal(M.toTask(row(), { me: ME }).requestedBy, "Riley Lead", "created_by_name when no name book");
  assert.equal(M.toTask(row({ assigned_to: null, mine: true, created_by: ME }), { me: ME }).mine, true, "my_tasks' mine: unassigned and made by me");
  assert.equal(M.toTask(row({ last_update_source: "created", needs_update: false, days_since_update: 2 }), {}).lastUpdateSource, "requested", "'created' reads as requested");
  assert.deepEqual([t.dueDate, t.dueTime, t.requested, t.subCategory], ["2026-10-22", "07:30", "2026-10-11", "Follow up"]);
  assert.deepEqual(t.notes.map((n) => n.text), ["Measured the north side", "South side next"], "oldest first");
  assert.deepEqual([t.notes[0].who, t.notes[0].imported, t.notes[0].viaLabel], ["Ana Crew · old portal", true, "old portal"]);
  assert.deepEqual([t.notes[1].who, t.notes[1].day], ["Jordan Field", "2026-10-14"]);
  assert.deepEqual([t.daysSinceUpdate, t.lastUpdateSource, t.needsUpdate, t.lastNote], [6, "note", true, "South side next"], "the clock is the database's");
  assert.equal(M.toTask(row({ status: "done" }), { me: ME }).needsUpdate, false, "a done task never needs an update");
});

test("toTask: amounts in typed words are masked (Q28, on screen only); an imported task names its old author", () => {
  const t = M.toTask(row({ title: "Order hold-downs ($1,240 at the yard)", description: "Ask for $90 off", last_note: "Paid $1,240",
    created_by: null, author_name: "Lee Office", created_by_name: "Lee Office" }), { me: ME, nameOf, mask });
  assert.equal(t.title, "Order hold-downs ((amount hidden) at the yard)");
  assert.equal(t.rawTitle, "Order hold-downs ($1,240 at the yard)");
  assert.equal(t.description, "Ask for (amount hidden) off");
  assert.equal(t.lastNote, "Paid (amount hidden)");
  assert.equal(t.requestedBy, "Lee Office · old portal");
  assert.equal(t.legacy, true);
});

test("toTask: a note an agent filed for someone (on_behalf_of, via sms) is that person's words, 'by text'", () => {
  const t = M.toTask(row({ notes: [{ id: 9, text: "Got them", created_at: "2026-10-17T18:00:00Z", created_by: "agents-uid", author: null, on_behalf_of: ME,
    on_behalf_of_name: "Jordan Field", via: "sms" }] }), { me: ME });
  assert.deepEqual([t.notes[0].who, t.notes[0].viaLabel], ["Jordan Field", "by text"]);
  const fromTable = M.toTask(row({ notes: [{ id: 9, text: "Got them", created_at: "2026-10-17T18:00:00Z", created_by: "agents-uid", on_behalf_of: ME, via: "sms" }] }), { me: ME, nameOf });
  assert.equal(fromTable.notes[0].who, "Jordan Field", "a task_notes row: the name book");
});

test("toTask: a shoot (agent_kind photo) and a recurring task (agent_kind recurring) — no footers shown, the repeat words read from one", () => {
  const p = M.toTask(row({ agent_kind: "photo", agent_ref: "PV-A267-03", agent_date: "2026-10-22",
    description: "SHOT LIST\n• Wide shot\n\nShoot date: 2026-10-22 · Ref: PV-A267-03 · Planned by the DCR Photo & Video Agent" }), { me: ME });
  assert.deepEqual(p.photo, { shootDate: "2026-10-22", ref: "PV-A267-03" });
  assert.equal(p.recurring, null);
  assert.ok(!/Shoot date/.test(p.description), "the footer is bookkeeping");
  const r = M.toTask(row({ agent_kind: "recurring", agent_ref: "ag_3f9c", agent_date: "2026-10-19",
    description: "Upload the photos.<br>Recurring: ag_3f9c · 2026-10-19 · Weekly on Mondays · Made by the DCR Recurring Tasks agent" }), { me: ME });
  assert.deepEqual(r.recurring, { agentId: "ag_3f9c", date: "2026-10-19", every: "Weekly on Mondays" });
  assert.equal(r.description, "Upload the photos.");
  assert.equal(M.recurLabel(r), "↻ Weekly on Mondays");
  const bare = M.toTask(row({ agent_kind: "recurring", agent_ref: "ag_1", agent_date: "2026-10-19", description: "Do it." }), { me: ME });
  assert.equal(M.recurLabel(bare), "↻ Recurring", "no footer: the plain badge");
  assert.equal(M.toTask(row({ agent_kind: "other" }), {}).agentKind, "", "only photo | recurring");
});

test("toTask: a row read from the tables (the Tasks tab, a link) — project embed, notes, and the clock computed by clockOf", () => {
  const r = row({ project_number: undefined, project_name: undefined, project_address: undefined, project_city: undefined, project_lat: undefined, project_lng: undefined,
    assignee_name: undefined, created_by_name: undefined, mine: undefined, last_update: undefined, last_update_source: undefined, days_since_update: undefined,
    last_note: undefined, needs_update: undefined, legacy_sp_id: null,
    notes: [{ id: 2, task_id: 12, text: "South side next", created_at: "2026-10-14T18:00:00Z", created_by: ME, via: "portal" }],
    project: { number: "A267", name: "Sandbox Residence", address: "1 Test Way", city: "Sandbox", lat: 35.1, lng: -120.1 } });
  const t = M.toTask(r, { me: ME, nameOf, today: "2026-10-20" });
  assert.deepEqual([t.projectNumber, t.address, t.lat, t.assigneeName], ["A267", "1 Test Way", 35.1, "Jordan Field"]);
  assert.deepEqual([t.daysSinceUpdate, t.lastUpdateSource, t.needsUpdate], [6, "note", true], "6 days after the newest note (Oct 14 Pacific)");
});

test("clockOf = app.task_clock: newest of note and request; Pacific days; needs an update after MORE than 5 days; a shoot never before its day is over", () => {
  const task = { created_at: "2026-10-14T20:00:00Z", status: "open" };
  assert.deepEqual(M.clockOf(task, [], "2026-10-19"), { last_update: "2026-10-14T20:00:00Z", last_update_source: "created", days_since_update: 5,
    last_note: null, needs_update: false }, "exactly 5 days: not yet");
  assert.equal(M.clockOf(task, [], "2026-10-20").needs_update, true, "6 days: needs an update");
  // 11:30 pm Pacific on Oct 14 is already Oct 15 in UTC: the day is the Pacific one
  const late = { created_at: "2026-10-15T06:30:00Z", status: "open" };
  assert.equal(M.dayOf(late.created_at), "2026-10-14");
  assert.equal(M.clockOf(late, [], "2026-10-19").days_since_update, 5);
  assert.equal(M.clockOf(late, [], "2026-10-20").needs_update, true, "the 5-day edge at 11:30 pm Pacific");
  const noted = M.clockOf(task, [{ text: "a", created_at: "2026-10-16T17:00:00Z" }, { text: "b", created_at: "2026-10-18T17:00:00Z" }], "2026-10-20");
  assert.deepEqual([noted.last_update_source, noted.days_since_update, noted.last_note, noted.needs_update], ["note", 2, "b", false]);
  const shoot = { created_at: "2026-10-01T17:00:00Z", status: "open", agent_kind: "photo", agent_date: "2026-10-20" };
  assert.equal(M.clockOf(shoot, [], "2026-10-20").needs_update, false, "through the shoot day");
  assert.equal(M.clockOf(shoot, [], "2026-10-21").needs_update, true, "the day after, the normal rule");
  assert.equal(M.clockOf(Object.assign({}, task, { status: "done" }), [], "2026-11-30").needs_update, false);
});

test("whenText / previewText: the crew's words (new, no update yet, updated today / yesterday / N days, no update for N days)", () => {
  const base = { notes: [], lastUpdateSource: "requested" };
  assert.equal(M.whenText(Object.assign({}, base, { daysSinceUpdate: 2, needsUpdate: false })), "New · requested 2 days ago");
  assert.equal(M.whenText(Object.assign({}, base, { daysSinceUpdate: 9, needsUpdate: true })), "No update yet · requested 9 days ago");
  assert.equal(M.whenText({ notes: [{}], lastUpdateSource: "requested", daysSinceUpdate: 9, needsUpdate: true }), "No update for 9 days");
  assert.equal(M.whenText({ lastUpdateSource: "note", daysSinceUpdate: 0, needsUpdate: false }), "Updated today");
  assert.equal(M.whenText({ lastUpdateSource: "note", daysSinceUpdate: 1, needsUpdate: false }), "Updated yesterday");
  assert.equal(M.whenText({ lastUpdateSource: "note", daysSinceUpdate: 7, needsUpdate: true }), "No update for 7 days");
  assert.equal(M.whenText({ daysSinceUpdate: null }), "");
  assert.equal(M.previewText({ lastNote: "x" }), "Last: x");
  assert.equal(M.previewText({ lastNote: "" }), "No updates yet");
});

test("brief(): sections as headings, the shot list as checkboxes (ticks kept by their words), the Maps line a link, the footer hidden", () => {
  const desc = "WHEN: 2026-10-22, morning light\nWHERE: 1 Test Way\n• Map: https://www.google.com/maps/search/?api=1&query=1+Test+Way\n\nSHOT LIST\n" +
    "• Wide shot\n• Hold-downs close up\n\nTIPS\n• Keep it level\nAnything else\nShoot date: 2026-10-22 · Ref: PV-A267-03 · Planned by the DCR Photo & Video Agent";
  const b = M.brief(desc, { "Hold-downs close up": true });
  assert.deepEqual(b.shots, ["Wide shot", "Hold-downs close up"]);
  assert.deepEqual(b.blocks.filter((x) => x.kind === "head").map((x) => [x.text, x.rest]), [["WHEN", "2026-10-22, morning light"], ["WHERE", "1 Test Way"], ["SHOT LIST", ""], ["TIPS", ""]]);
  const lists = b.blocks.filter((x) => x.kind === "list");
  assert.deepEqual(lists[0].items, [{ map: "https://www.google.com/maps/search/?api=1&query=1+Test+Way" }]);
  assert.deepEqual(lists[1], { kind: "list", shots: true, items: [{ shot: 0, text: "Wide shot", done: false }, { shot: 1, text: "Hold-downs close up", done: true }] });
  assert.deepEqual(lists[2].items, [{ text: "Keep it level" }]);
  assert.ok(b.blocks.some((x) => x.kind === "p" && x.text === "Anything else"));
  assert.ok(!JSON.stringify(b).includes("PV-A267-03"), "no footer");
  // a Maps line that is not Google's search address stays words
  assert.deepEqual(M.brief("WHERE\n• Map: https://evil.example/x").blocks[1].items, [{ text: "Map: https://evil.example/x" }]);
});

test("plain(): Access rich text as plain words (line breaks kept); &lt; stays as typed", () => {
  assert.equal(M.plain("Pick up<br>at the yard &amp; bring<div>receipt</div>"), "Pick up\nat the yard & bring\nreceipt");
  assert.equal(M.plain("&lt;script&gt; &middot; ok"), "&lt;script&gt; · ok");
  assert.equal(M.cleanNote("  one\nline \u2028 two\r\n"), "one line two");
});

test("leftAfterSend / withPhrase: words typed while sending stay; a phrase is added, never in place", () => {
  assert.equal(M.leftAfterSend("Framed walls", "Framed walls"), "");
  assert.equal(M.leftAfterSend("Framed walls. Rain tomorrow", "Framed walls"), "Rain tomorrow");
  assert.equal(M.leftAfterSend("Framed wallsx", "Framed walls"), "Framed wallsx", "a changed word keeps the whole box");
  assert.equal(M.leftAfterSend("Framed the walls", "Framed walls"), "Framed the walls");
  assert.equal(M.withPhrase("", "Started today"), "Started today");
  assert.equal(M.withPhrase("Walls up", "Waiting on materials"), "Walls up. Waiting on materials");
  assert.equal(M.withPhrase("Walls up!", "Waiting on materials"), "Walls up! Waiting on materials");
});

test("order: needs-an-update first (longest quiet first), shoots first and soonest; by person with the caller first and Unassigned last; pins per project", () => {
  const mk = (id, o) => Object.assign({ id, priority: "normal", requested: "2026-10-10", daysSinceUpdate: 1, needsUpdate: false, photo: null, mine: false,
    assignedTo: OTHER, assigneeName: "Riley Lead", projectId: 268, projectNumber: "A267", projectName: "Sandbox", address: "1 Test Way", city: "Sandbox", lat: 1, lng: 2 }, o);
  const list = [mk(1, { needsUpdate: true, daysSinceUpdate: 7 }), mk(2, { needsUpdate: true, daysSinceUpdate: 12 }), mk(3, { priority: "low" }),
    mk(4, { priority: "urgent" }), mk(5, { photo: { shootDate: "2026-10-25" } }), mk(6, { photo: { shootDate: "2026-10-21" } }),
    mk(7, { assignedTo: ME, assigneeName: "Jordan Field", mine: true, projectId: null, projectNumber: "", address: "", lat: null, lng: null }),
    mk(8, { assignedTo: null, assigneeName: "", projectId: 300, address: "9 Oak Ln" })];
  const g = M.needsFirst(list);
  assert.deepEqual(g.needs.map((t) => t.id), [2, 1]);
  assert.deepEqual(g.fine.map((t) => t.id), [6, 5, 4, 7, 8, 3]);
  assert.deepEqual(M.byPerson(list).map((x) => x.name), ["Jordan Field", "Riley Lead", "Unassigned"]);
  const pins = M.groupByProject(list);
  assert.deepEqual(pins.map((p) => [p.key, p.tasks.length]), [["268", 6], ["none", 1], ["300", 1]]);
  assert.deepEqual([M.pinLabel(pins[0]), M.pinLabel(pins[1]), M.pinLabel(pins[2])], ["1 Test Way", "No project", "9 Oak Ln"]);
});

test("priorities: low | normal | high | urgent; the old colours (urgent+high red, normal amber, low green)", () => {
  assert.deepEqual(["urgent", "high", "normal", "low", "", "Medium", "URGENT"].map(M.priorityOf), ["urgent", "high", "normal", "low", "normal", "normal", "urgent"]);
  assert.deepEqual(["urgent", "high", "normal", "low"].map(M.priKey), ["urgent", "urgent", "medium", "low"]);
});

test("who may do what (the database decides; the pages hide): create (Q8), assign anyone, work on a task, the lists (Q3)", () => {
  const p = (role, id) => ({ id: id || ME, role, active: true });
  assert.deepEqual(["admin", "manager", "lead", "accountant", "field", "viewer"].map((r) => M.canCreate(p(r))), [true, true, true, true, true, false]);
  assert.deepEqual(["admin", "manager", "lead", "accountant", "field"].map((r) => M.canAssignAnyone(p(r))), [true, true, true, false, false]);
  const people = [{ id: ME, name: "Jordan Field", role: "field", active: true }, { id: OTHER, name: "Riley Lead", role: "lead", active: true },
    { id: "a", name: "", role: "agents", active: true }, { id: "x", name: "Sam Former", role: "field", active: false }];
  assert.deepEqual(M.assigneeChoices(p("field"), people).map((x) => x.name), ["Jordan Field"], "field: themself only");
  assert.deepEqual(M.assigneeChoices(p("lead", OTHER), people).map((x) => x.name), ["Riley Lead", "Jordan Field"], "a lead: anyone active, themself first, never the agents account");
  const theirs = { mine: false, createdByMe: false }, mine = { mine: true }, made = { createdByMe: true };
  assert.deepEqual([M.canWork(p("field"), theirs), M.canWork(p("field"), mine), M.canWork(p("field"), made), M.canWork(p("lead"), theirs),
    M.canWork(p("viewer"), mine), M.canWork(p("accountant"), mine)], [false, true, true, true, false, true]);
  assert.deepEqual(M.viewsFor(p("lead")), ["mine", "crew", "everyone"]);
  assert.deepEqual(M.viewsFor(p("accountant")), ["mine", "everyone"]);
  assert.deepEqual(M.viewsFor(p("field")), ["mine"]);
  assert.deepEqual(M.viewsFor(p("viewer")), ["mine"]);
});

test("newTaskRow: the INSERT a form makes; a field user only for themself or nobody; times and days as the columns want them", () => {
  const field = { id: ME, role: "field" }, lead = { id: OTHER, role: "lead" };
  const ok = M.newTaskRow({ title: "  Order   the posts ", description: " Before Friday ", category: "Sales", subCategory: "", priority: "urgent",
    assignedTo: ME, dueDate: "2026-10-22", dueTime: "07:30", projectId: "268" }, lead);
  assert.deepEqual(ok.row, { title: "Order the posts", description: "Before Friday", category: "Sales", sub_category: null, priority: "urgent",
    assigned_to: ME, due_date: "2026-10-22", due_time: "07:30:00", project_id: 268 });
  assert.equal(M.newTaskRow({ title: "x", assignedTo: OTHER }, field).error, "You can give a task to yourself or leave it unassigned.");
  assert.ok(M.newTaskRow({ title: "x", assignedTo: null }, field).row, "nobody: allowed");
  assert.equal(M.newTaskRow({ title: " " }, lead).error, "Give the task a name.");
  assert.equal(M.newTaskRow({ title: "x", priority: "whatever" }, lead).row.priority, "normal");
  assert.equal(M.newTaskRow({ title: "x", dueTime: "7:30" }, lead).error, "The time is not a time of day.");
  assert.ok(!("project_id" in M.newTaskRow({ title: "x", projectId: "" }, lead).row), "no project");
  assert.equal(M.newTaskRow({ title: "x", dueTime: "07:30" }, lead).error, "A time needs a day — pick the due day too.", "M3: due_time goes with due_date");
});

test("defaultView: remembered, else mine when there is any, else the list the badge counted (a lead: the crew, as the old portal)", async () => {
  const { defaultView, viewsFor, badgeOf } = await import("../site/js/map/tasks.js");
  const lead = viewsFor({ role: "lead" });
  assert.equal(defaultView(lead, 0, ""), "crew", "a lead with no tasks of their own: their crew's, not everyone's");
  assert.equal(badgeOf({ open: 0, needUpdate: 0, crewNeedUpdate: 3, everyoneNeedUpdate: 6 }).text, "3 crew tasks need an update", "what the badge counted");
  assert.equal(defaultView(lead, 2, ""), "mine");
  assert.equal(defaultView(lead, 0, "everyone"), "everyone", "a remembered choice wins");
  assert.equal(defaultView(viewsFor({ role: "admin" }), 0, ""), "everyone");
  assert.equal(defaultView(viewsFor({ role: "field" }), 0, "everyone"), "mine", "a list the role does not have is not remembered");
  assert.equal(defaultView([], 0, ""), "mine");
});

test("the home badge (my_tasks_summary, M3's jsonb): own tasks needing an update in red, else own open, else a lead's crew's / the office's dimmed", () => {
  const lead = { mine: 4, mine_needs_update: 2, mine_overdue: 1, mine_due_today: 0, crew: 13, crew_needs_update: 5, everyone: 21, everyone_needs_update: 6, today: "2026-10-20" };
  assert.deepEqual(M.summaryOf(lead), { open: 4, needUpdate: 2, overdue: 1, dueToday: 0, crew: 13, crewNeedUpdate: 5, everyone: 21, everyoneNeedUpdate: 6 });
  assert.deepEqual(M.badgeOf(M.summaryOf(lead)), { text: "2 need an update", cls: "warn" });
  assert.deepEqual(M.badgeOf(M.summaryOf({ mine: 1, mine_needs_update: 1 })), { text: "1 needs an update", cls: "warn" });
  assert.deepEqual(M.badgeOf(M.summaryOf({ mine: 4, mine_needs_update: 0, crew: null, everyone: null })), { text: "4 open", cls: "dim" });
  assert.deepEqual(M.badgeOf(M.summaryOf({ mine: 0, mine_needs_update: 0, crew: 3, crew_needs_update: 1, everyone: 9, everyone_needs_update: 4 })),
    { text: "1 crew task needs an update", cls: "dim" }, "a lead with nothing of their own: the crew's");
  assert.deepEqual(M.badgeOf(M.summaryOf({ mine: 0, mine_needs_update: 0, crew: null, crew_needs_update: null, everyone: 21, everyone_needs_update: 6 })),
    { text: "6 tasks need an update", cls: "dim" }, "the office with nothing of their own: everyone's");
  assert.equal(M.summaryOf({ mine: 0, crew: null }).crew, null, "no such list for this role");
  assert.equal(M.badgeOf(M.summaryOf({})), null);
});

test("small words: due, a shoot's day, note labels, times, a fresh client key every time", () => {
  assert.equal(M.dueText({ dueDate: "2026-10-21", dueTime: "07:30" }, "2026-10-20"), "Due tomorrow · 7:30 AM");
  assert.equal(M.dueText({ dueDate: "2026-10-20", dueTime: "" }, "2026-10-20"), "Due today");
  assert.equal(M.dueText({ dueDate: "2026-10-24" }, "2026-10-20"), "Due Sat Oct 24");
  assert.deepEqual(M.shootLabel({ photo: { shootDate: "2026-10-20" } }, "2026-10-20"), { label: "Shoot: Today", cls: "today" });
  assert.deepEqual(M.shootLabel({ photo: { shootDate: "2026-10-18" } }, "2026-10-20"), { label: "Shoot was Sun Oct 18", cls: "late" });
  assert.equal(M.noteLabel({ day: "2026-10-19" }, "2026-10-20"), "Mon Oct 19 · yesterday");
  assert.equal(M.noteLabel({ day: "2025-12-01" }, "2026-10-20"), "Mon Dec 1, 2025");
  assert.equal(M.timeText("13:05:00"), "1:05 PM");
  const a = M.clientKey(), b = M.clientKey();
  assert.ok(/^p2-/.test(a) && a !== b);
});
