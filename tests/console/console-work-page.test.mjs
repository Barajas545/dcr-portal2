/* The DCR Agents console's Timesheets and Tasks tabs (site/js/console/console-work.js),
   rendered in a stand-in browser (console-wp-harness.mjs) against stub
   answers in the shapes the DCR server's console handlers return
   (console-spec §6.1.4, §6.1.5) — with "<img src=x onerror=…>" in every
   string. Everything drawn must come out escaped; the page must send back
   only what the admin picked (the PC checks it again); every write goes
   through ctx.act (the PC's own question) and carries data-act and
   data-method for the shell's gates. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVIL, esc, openTab, loadModule, settle } from "./console-wp-harness.mjs";

const FILE = "console-work.js";
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* ── fixtures in the PC's shapes (hours.grid_json, taskboard.row_json …) ── */

function weekDays(sat, today) {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.parse(sat + "T12:00:00Z") + i * 864e5);
    const day = d.toISOString().slice(0, 10);
    out.push({ day, header: `${WD[d.getUTCDay()]} ${d.getUTCDate()}`, weekend: [0, 6].includes(d.getUTCDay()), ahead: day > today });
  }
  return out;
}
function cell(day, e) {
  if (!e) return { day, top: "", bottom: "", hours: 0, filed: false, leave: "", entries: [] };
  const top = e.leave ? (e.hours ? `${e.leave} ${e.hours}h` : e.leave) : `${e.hours}h`;
  return { day, top, bottom: e.address || "", hours: e.hours || 0, filed: true, leave: e.leave || "",
    entries: [{ hours: e.hours || 0, leave: e.leave || "", project: e.project || "", address: e.address || "", work: e.work || "" }] };
}
function grid() {
  const today = "2026-10-07";
  const last = weekDays("2026-09-26", today), cur = weekDays("2026-10-03", today);
  const filedMon = { hours: 8, project: `A901 ${EVIL}`, address: `1 Fake St ${EVIL}`, work: `framed ${EVIL}` };
  return {
    today, rows_count: 3, people_count: 2,
    weeks: [
      { label: `Last week · Sep 26 – Oct 2 ${EVIL}`, days: last, rows: [
        { name: "Luis Fakeman", cells: last.map((d, i) => cell(d.day, i === 2 ? filedMon : null)), total: 8 },
        { name: `Ana ${EVIL}`, cells: last.map((d, i) => cell(d.day, i === 3 ? { leave: "Vac.", hours: 0 } : null)), total: 0 },
      ] },
      { label: "This week · Oct 3–9", days: cur.map((d) => ({ ...d, header: d.header + (d.day === today ? "" : "") })), rows: [
        { name: "Luis Fakeman", cells: cur.map((d, i) => cell(d.day, i === 2 ? { hours: 6, project: "A902", address: "2 Sample Ave" } : null)), total: 6 },
        { name: `Ana ${EVIL}`, cells: cur.map((d) => cell(d.day, null)), total: 0 },
      ] },
    ],
  };
}

function task(id, name, over = {}) {
  return { task_id: id, name, person: "Luis Fakeman", assignee: "Luis Fakeman", reachable: true, unreachable: "", stale: true,
    days_since: 9, days_text: "9 days ago", last_update_text: `Thu Oct 1 · note ${EVIL}`, last_note: `called the yard ${EVIL}`,
    project: `A901 - Fake Street ADU ${EVIL}`, city: "Atascadero", category: "Framing", priority: `Normal ${EVIL}`,
    requested_text: "Sat Sep 26", reminders: [], reminders_short: "", nagged: false, link: "https://portal.test/my-tasks.html?task=" + id,
    why_not: "", ...over };
}
function board(over = {}) {
  return {
    stale_days: 5, threshold_words: `the setting of 'Tasks — no update for 5 days' ${EVIL}`, generated: "10:02",
    status: { text: `5 open tasks, 4 with no update, 3 people — loaded 10:02 ${EVIL}`, bad: false },
    lender: { id: "b7bc3717b0bd", name: "Tasks — no update for 5 days" }, dry: true, cap: 25,
    groups: [
      { person: `Luis ${EVIL}`, label: `Luis ${EVIL}`, key: "person:luis", kind: "person", suffix: ` — 2 of 2 open with no update ${EVIL}`,
        n_tasks: 2, n_stale: 2, tasks: [
          task("401", `[FAKE] Order lumber ${EVIL}`, { reminders: [`2 days ago by 'Tasks' by text ${EVIL}`, "1 day ago by 'Tasks' by email"],
            reminders_short: `2 · 1 day ago by email ${EVIL}`, nagged: true }),
          task("404", "[FAKE] Measure the garage door", { days_since: 8 }),
        ] },
      { person: "Nobody (unassigned)", label: "Nobody (unassigned)", key: "nobody", kind: "nobody", suffix: " — 1 open with no update",
        n_tasks: 1, n_stale: 1, tasks: [task("405", "[FAKE] Sweep the yard", { person: "Nobody (unassigned)", reachable: false,
          unreachable: "assigned to nobody", why_not: `assigned to nobody ${EVIL}` })] },
    ],
    ...over,
  };
}
function followup(over = {}) {
  return {
    title: `Follow up on 2 tasks ${EVIL}`, to: `To: Luis Fakeman (2 tasks) ${EVIL}`, about: `About: “[FAKE] Order lumber ${EVIL}” and “x”`,
    summary: `Dry run — nothing will be sent. Record a follow-up about 2 tasks to 1 person? ${EVIL}`, account_note: `No portal account ${EVIL}`,
    radios: [
      { kind: "", text: `Automatic — DCR App, then Text message to …0101 ${EVIL}`, enabled: true },
      { kind: "app", text: "DCR App — on their phone", enabled: true },
      { kind: "sms", text: "Text message (SMS) — …0101", enabled: true },
      { kind: "whatsapp", text: `WhatsApp — Twilio isn't set up on this PC ${EVIL}`, enabled: false },
      { kind: "email", text: "Email — luis@dcr.test", enabled: true },
    ],
    preview: { label: `Preview — the message about “x” by DCR App ${EVIL}`, text: `No update for 9 days ${EVIL}\nline two` },
    problems: [], warnings: [`Text: up to 1 part (GSM-7) ${EVIL}`], can_send: true, send_label: "Record (dry run)",
    skipped: [`Nobody (unassigned) · Sweep the yard: assigned to nobody — nothing sent ${EVIL}`],
    ...over,
  };
}

function rpcError(code, message) { return Object.assign(new Error(message), { code }); }
const plainPairs = (pairs) => pairs.map((p) => [p.name, p.day]);

function noRawHtml(page) {
  const all = page.html();
  assert.ok(!/<img/i.test(all), "no raw <img anywhere");
  assert.ok(!/<script/i.test(all), "no raw <script anywhere");
  assert.ok(!/href="javascript:/i.test(all), "no javascript: link");
  assert.ok(all.includes(esc(EVIL)), "the words are still there, as text");
}

/* ── registration and the pure helpers ─────────────────────────────────── */

test("registers the Timesheets (30) and Tasks (40) tabs once each, and its helpers say what the desktop says", () => {
  const mod = loadModule(FILE);
  assert.deepEqual(Object.keys(mod.defs).sort(), ["tasks", "timesheets"]);
  assert.equal(mod.defs.timesheets.order, 30);
  assert.equal(mod.defs.tasks.order, 40);
  assert.equal(typeof mod.defs.tasks.leave, "function");
  const W = mod.context.DCRConsoleWork;
  assert.equal(W.dayWord("2026-09-21"), "Mon Sep 21", "hours.day_word");
  assert.equal(W.dayWord("2026-10-05"), "Mon Oct 5");
  assert.equal(W.hoursText(8), "8h");
  assert.equal(W.hoursText(7.5), "7.5h");
  assert.equal(W.hoursText(0), "");
  assert.equal(W.safeHref("https://x.test/a?b=1"), "https://x.test/a?b=1");
  assert.equal(W.safeHref("my-tasks.html?task=4"), "https://portal.test/my-tasks.html?task=4", "a page of this site");
  assert.equal(W.safeHref("javascript:alert(1)"), "");
  assert.equal(W.safeHref("data:text/html,<b>"), "");
  assert.equal(W.safeHref("http://evil.test/x"), "", "another site over plain http");
});

/* ── Timesheets ───────────────────────────────────────────────────────── */

test("the timesheet grid: two weeks, every string escaped, filed days with hours and address, days ahead not tappable", async () => {
  const page = await openTab(FILE, "timesheets", { answers: { "timesheets.grid": grid() } });
  assert.equal(page.rpcs("timesheets.grid").length, 1);
  noRawHtml(page);
  const g = page.byId("cwTsGrid").innerHTML;
  assert.match(g, /Last week · Sep 26 – Oct 2 &lt;img/, "the week's label from the PC");
  assert.match(g, /<span class="cw-top">8h<\/span><span class="cw-bot">1 Fake St &lt;img/, "hours on top, the address under");
  assert.match(g, /class="cw-cell leave filed|class="cw-cell filed leave/, "a day off is marked as leave");
  assert.match(g, /<th scope="col" class="today" title="today">Wed 7<\/th>/, "today's column stands out");
  assert.match(g, /class="cw-cell wkend/, "weekends are shaded");
  assert.ok(!/data-cw="ts-cell"[^>]*data-w="1"[^>]*data-c="5"/.test(g), "Thursday, still ahead, is not a button");
  assert.match(g, /still ahead — nobody could have filed it yet/);
  assert.equal(page.byId("cwTsSub").textContent, "3 timesheet rows · 2 people · select empty day cells and press Remind");
  const remind = page.find({ "data-cw": "ts-remind" });
  assert.ok("data-act" in remind.attrs && remind.attrs["data-method"] === "timesheets.remind", "a write: data-act and data-method");
  assert.equal(page.find({ "data-cw": "ts-refresh" }).attrs["data-method"], "timesheets.grid");
});

test("tapping empty days and names picks exactly who would be reminded; Remind sends those pairs through the PC's question", async () => {
  let n = 0;
  const page = await openTab(FILE, "timesheets", { answers: {
    "timesheets.grid": () => { n++; return grid(); },
    "timesheets.remind": (a) => ({ lines: a.pairs.map((p) => `${p.name} · x: dry run — recorded ${EVIL}`), left_out: "" }),
  } });
  await page.click({ "data-cw": "ts-cell", "data-w": "0", "data-r": "0", "data-c": "4" });     // Luis, Wed Sep 30
  assert.match(page.byId("cwTsPicks").innerHTML, /Would remind 1 person about 1 day:/);
  assert.match(page.byId("cwTsPicks").innerHTML, /Luis Fakeman · Wed Sep 30/);
  assert.equal(page.find({ "data-cw": "ts-cell", "data-w": "0", "data-r": "0", "data-c": "4" }).attrs["aria-pressed"], "true");
  await page.click({ "data-cw": "ts-cell", "data-w": "0", "data-r": "0", "data-c": "4" });     // and off again
  assert.match(page.byId("cwTsPicks").innerHTML, /Tap empty day cells/);
  // a filed day is never picked: it shows what was filed
  await page.click({ "data-cw": "ts-cell", "data-w": "0", "data-r": "0", "data-c": "2" });
  assert.match(page.byId("cwTsPicks").innerHTML, /Tap empty day cells/);
  assert.equal(page.modals.length, 1);
  assert.equal(page.modals[0].title, "Luis Fakeman — Mon Sep 28");
  assert.match(page.modals[0].message, /^8h · A901 <img src=x onerror=alert\(1\)> · 1 Fake St/, "DCR.modal escapes it itself");
  // a name: every missing weekday of that person that week — not the weekend, not the filed one, not the days ahead
  await page.click({ "data-cw": "ts-person", "data-w": "1", "data-r": "1" });                // Ana, this week
  const picks = page.byId("cwTsPicks").innerHTML;
  assert.match(picks, /Would remind 1 person about 3 days:/, "Mon to Wed; the weekend is left to a tap, Thu and Fri are ahead");
  assert.ok(!/Sat Oct 3/.test(picks) && !/Thu Oct 8/.test(picks) && !/Fri Oct 9/.test(picks));
  await page.click({ "data-cw": "ts-person", "data-w": "1", "data-r": "0" });                // Luis: Mon Oct 5 is filed
  assert.match(page.byId("cwTsPicks").innerHTML, /Would remind 2 people about 3 days:/);
  await page.click({ "data-cw": "ts-cell", "data-w": "1", "data-r": "1", "data-c": "0" });     // and Ana's Saturday by hand
  assert.match(page.byId("cwTsPicks").innerHTML, /Would remind 2 people about 4 days:/);
  await page.click({ "data-cw": "ts-unsel", "data-i": "0" });                                  // leave Ana's Monday out
  await page.click({ "data-cw": "ts-remind" });
  const acts = page.calls.filter((c) => c.kind === "act");
  assert.equal(acts.length, 1);
  assert.equal(acts[0].method, "timesheets.remind");
  assert.equal(acts[0].args.pairs.length, 5);
  assert.deepEqual(plainPairs(acts[0].args.pairs), [[`Ana ${EVIL}`, "2026-10-06"], [`Ana ${EVIL}`, "2026-10-07"],
    ["Luis Fakeman", "2026-10-06"], ["Luis Fakeman", "2026-10-07"], [`Ana ${EVIL}`, "2026-10-03"]], "names and ISO days, in the order picked");
  assert.ok(!acts[0].args.pairs.some((p) => p.name === "Luis Fakeman" && p.day === "2026-10-05"), "a filed day is never sent");
  assert.ok(!acts[0].args.pairs.some((p) => p.day > "2026-10-07"), "a day ahead is never sent");
  const res = page.byId("cwTsResults").innerHTML;
  assert.match(res, /What happened/);
  assert.match(res, /dry run — recorded &lt;img/);
  assert.equal(n, 2, "the grid is read again after the reminders");
  assert.match(page.byId("cwTsPicks").innerHTML, /Tap empty day cells/, "the selection is cleared");
  noRawHtml(page);
});

test("Remind with nothing picked, too much picked, a no, and the PC's refusal", async () => {
  const page = await openTab(FILE, "timesheets", { answers: {
    "timesheets.grid": grid(),
    "timesheets.remind": rpcError("refused", `Select one or more empty day cells first. (1 selected day was already filed) ${EVIL}`),
  } });
  await page.click({ "data-cw": "ts-remind" });
  assert.equal(page.calls.filter((c) => c.kind === "act").length, 0, "nothing is asked of the PC");
  assert.match(page.byId("cwTsResults").innerHTML, /Select one or more empty day cells first\./);
  const TS = page.mod.context.DCRConsoleWork._ts;
  TS.selected = Array.from({ length: 61 }, (_, i) => ({ name: "Luis Fakeman", day: "2026-09-" + String(i % 9 + 10) }));
  await page.click({ "data-cw": "ts-remind" });
  assert.match(page.byId("cwTsResults").innerHTML, /Select at most 60 days at a time\./);
  assert.equal(page.calls.filter((c) => c.kind === "act").length, 0);
  TS.selected = [{ name: "Luis Fakeman", day: "2026-09-30" }];
  page.ctx.confirmAnswer = false;
  await page.click({ "data-cw": "ts-remind" });
  assert.equal(page.calls.filter((c) => c.kind === "act").length, 1, "asked");
  assert.equal(page.rpcs("timesheets.grid").length, 1, "a no changes nothing and reads nothing");
  assert.equal(TS.selected.length, 1, "the pick is kept after a no");
  page.ctx.confirmAnswer = true;
  await page.click({ "data-cw": "ts-remind" });
  assert.match(page.byId("cwTsResults").innerHTML, /Select one or more empty day cells first\. \(1 selected day was already filed\) &lt;img/);
  noRawHtml(page);
});

test("after a reload a picked day that was filed meanwhile is dropped; a failed reload keeps the grid and says so", async () => {
  let g = grid();
  const page = await openTab(FILE, "timesheets", { answers: { "timesheets.grid": () => g } });
  await page.click({ "data-cw": "ts-cell", "data-w": "0", "data-r": "0", "data-c": "4" });
  await page.click({ "data-cw": "ts-cell", "data-w": "0", "data-r": "0", "data-c": "5" });
  g = grid();
  g.weeks[0].rows[0].cells[4] = cell("2026-09-30", { hours: 4, project: "A901", address: "1 Fake St" });
  await page.click({ "data-cw": "ts-refresh" });
  assert.deepEqual(JSON.parse(JSON.stringify(page.mod.context.DCRConsoleWork._ts.selected.map((p) => p.day))), ["2026-10-01"]);
  g = rpcError("network", `Can't reach the portal ${EVIL}`);
  page.ctx.rpc = ((orig) => (m, a, o) => (m === "timesheets.grid" ? Promise.reject(g) : orig(m, a, o)))(page.ctx.rpc);
  await page.click({ "data-cw": "ts-refresh" });
  assert.equal(page.byId("cwTsSub").textContent, `Could not load timesheets: Can't reach the portal ${EVIL}`);
  assert.match(page.byId("cwTsSub").className, /cw-bad/);
  assert.match(page.byId("cwTsGrid").innerHTML, /cw-grid/, "the last grid stays on screen");
});

test("a first load that fails shows the shell's error box; a server without the method says to update it", async () => {
  const bad = await openTab(FILE, "timesheets", { answers: { "timesheets.grid": rpcError("offline", `The DCR server is offline ${EVIL}`) } });
  assert.match(bad.byId("cwTsGrid").innerHTML, /class="c-error"/);
  assert.match(bad.byId("cwTsGrid").innerHTML, /The DCR server is offline &lt;img/);
  noRawHtml(bad);
  const old = await openTab(FILE, "timesheets", { answers: {}, has: (m) => m !== "timesheets.grid" });
  assert.equal(old.rpcs("timesheets.grid").length, 0);
  assert.match(old.byId("cwTsGrid").innerHTML, /Update DCR Agents on the server computer to use this/);
});

/* ── Tasks: the board ─────────────────────────────────────────────────── */

test("the task board: people, counts, silence, reminders and reasons, all escaped; the status line and the threshold are the PC's", async () => {
  const page = await openTab(FILE, "tasks", { answers: { "tasks.board": board() } });
  assert.deepEqual(page.rpcs("tasks.board")[0].args, { all: false });
  noRawHtml(page);
  const b = page.byId("cwTkBoard").innerHTML;
  assert.match(b, /class="cw-gname"[^>]*>Luis &lt;img/);
  assert.match(b, /2 of 2 open with no update &lt;img/, "the PC's own counts, without the leading dash");
  assert.match(b, /cw-group unreach/, "a heading for tasks nobody can be sent to");
  assert.match(b, /cw-task nagged/, "reminded about this stretch and nothing changed");
  assert.match(b, /cw-tname red/, "reminded twice: the owner has to take it up");
  assert.match(b, /<span class="cw-days stale">9 days silent<\/span>/);
  assert.match(b, /<span class="cw-days stale">8 days silent<\/span>/);
  assert.match(b, /reminded 2 · 1 day ago by email &lt;img/);
  assert.match(b, /title="2 days ago by &#39;Tasks&#39; by text &lt;img[^"]*&#10;|title="2 days ago by &#39;Tasks&#39; by text &lt;img/);
  assert.match(b, /<span class="c-chip warn">assigned to nobody &lt;img/, "why no follow-up can go");
  assert.match(b, /Send a follow-up about all 2 tasks…/);
  assert.equal(page.byId("cwTkSub").textContent, `5 open tasks, 4 with no update, 3 people — loaded 10:02 ${EVIL}`);
  assert.equal(page.byId("cwTkDays").textContent, "no update for more than 5 days");
  assert.equal(page.byId("cwTkDays").getAttribute("title"), `the setting of 'Tasks — no update for 5 days' ${EVIL}`);
  const send = page.byId("cwTkSend");
  assert.ok("data-act" in send.attrs && send.attrs["data-method"] === "tasks.followup");
  assert.match(page.html(), /href="tasks-map\.html"/, "the portal's own tasks map");
});

test("picking tasks — one, or a person's whole list — and starting a follow-up asks the PC first, then opens the follow-up page", async () => {
  const page = await openTab(FILE, "tasks", { answers: { "tasks.board": board(), "tasks.followup": followup() } });
  await page.fire("change", { "data-cw": "tk-sel", "data-id": "404" }, { checked: true });
  assert.equal(page.byId("cwTkSend").textContent, "Send a follow-up about the selected task(s)… (1)");
  await page.fire("change", { "data-cw": "tk-gsel", "data-g": "0" }, { checked: true });
  assert.equal(page.byId("cwTkSend").textContent, "Send a follow-up about the selected task(s)… (2)");
  assert.ok(page.byId("cwTkC401").checked && page.byId("cwTkC404").checked, "the group box ticks its tasks");
  await page.click({ "data-cw": "tk-send" });
  const f = page.rpcs("tasks.followup");
  assert.equal(f.length, 1);
  assert.deepEqual(f[0].args, { task_ids: ["401", "404"], include_fresh: false, channel: "", note: "" },
    "the toolbar's follow-up leaves fresh tasks out, like the desktop button");
  assert.deepEqual(page.gone, ["tasks/followup?ids=401%2C404&fresh=0"]);
  // a person's heading: every task of theirs, fresh ones too (the desktop's menu)
  await page.rerender({ parts: [], query: {} });
  await page.click({ "data-cw": "tk-gsend", "data-g": "0" });
  assert.deepEqual(page.rpcs("tasks.followup")[1].args.include_fresh, true);
});

test("a follow-up the PC refuses is said on the board; no lending agent turns every send off with the reason", async () => {
  const page = await openTab(FILE, "tasks", { answers: { "tasks.board": board(),
    "tasks.followup": rpcError("refused", `select at most 25 tasks per press ${EVIL}`) } });
  await page.click({ "data-cw": "tk-send" });
  assert.equal(page.rpcs("tasks.followup").length, 0, "nothing picked: the page says so itself");
  assert.match(page.byId("cwTkResults").innerHTML, /Select one or more tasks first\./);
  await page.fire("change", { "data-cw": "tk-sel", "data-id": "401" }, { checked: true });
  await page.click({ "data-cw": "tk-send" });
  assert.match(page.byId("cwTkResults").innerHTML, /select at most 25 tasks per press &lt;img/);
  assert.deepEqual(page.gone, []);
  const none = await openTab(FILE, "tasks", { answers: { "tasks.board": board({ lender: null,
    status: { text: `there is no “Tasks with no update” agent yet — add one ${EVIL}`, bad: true } }) } });
  assert.equal(none.byId("cwTkSend").disabled, true);
  assert.equal(none.byId("cwTkSend").getAttribute("title"), `there is no “Tasks with no update” agent yet — add one ${EVIL}`);
  assert.match(none.byId("cwTkSub").className, /cw-bad/);
  assert.equal(none.find({ "data-cw": "tk-gsend", "data-g": "0" }).attrs.title, "no “Tasks with no update” agent yet — add one on the Agents tab",
    "the agent kind in quotes, and what to do — never \"no Tasks with no update agent\"");
  assert.ok("disabled" in none.find({ "data-cw": "tk-gsend", "data-g": "0" }).attrs);
});

test("Show every open task asks for the whole board; a heading folds; a failed reload keeps the board and says when it was from", async () => {
  let fail = false;
  const page = await openTab(FILE, "tasks", { answers: { "tasks.board": (a) => {
    if (fail) throw rpcError("network", "Can't reach the portal");
    return board({ __asked: a.all });
  } } });
  await page.fire("change", { "data-cw": "tk-all" }, { checked: true });
  assert.deepEqual(page.rpcs("tasks.board")[1].args, { all: true });
  await page.click({ "data-cw": "tk-fold", "data-g": "0" });
  assert.match(page.byId("cwTkBoard").innerHTML, /aria-expanded="false"/);
  assert.match(page.byId("cwTkBoard").innerHTML, /<ul class="cw-tasks" hidden>/);
  fail = true;
  await page.click({ "data-cw": "tk-refresh" });
  assert.equal(page.byId("cwTkSub").textContent, "showing the list from 10:02 — the portal did not answer: Can't reach the portal");
  assert.match(page.byId("cwTkBoard").innerHTML, /cw-task/);
});

/* ── Tasks: one task ──────────────────────────────────────────────────── */

test("a task's page: the desktop's rows, the notes, a safe link only, and Send a follow-up with the reason when it cannot", async () => {
  const detail = { rows: [{ label: `Assigned to ${EVIL}`, text: `Luis ${EVIL}` }, { label: "Task id", text: "401" }],
    notes: `[Thu Oct 01, 2026] --- called the yard ${EVIL}`, can_follow_up: true, why_not: "",
    link: "https://portal.test/my-tasks.html?task=401", name: `[FAKE] Order lumber ${EVIL}`, person: "Luis Fakeman" };
  const page = await openTab(FILE, "tasks", { route: { parts: ["task", "401"] }, answers: { "tasks.task": detail, "tasks.followup": followup() } });
  assert.deepEqual(page.rpcs("tasks.task")[0].args, { task_id: "401" });
  noRawHtml(page);
  const body = page.byId("cwTdBody").innerHTML;
  assert.match(body, /<dt>Assigned to &lt;img[^<]*<\/dt><dd>Luis &lt;img/, "the rows through the shell's kv");
  assert.match(body, /called the yard &lt;img/);
  assert.match(body, /href="https:\/\/portal\.test\/my-tasks\.html\?task=401"/);
  assert.equal(page.byId("cwTdTitle").textContent, `[FAKE] Order lumber ${EVIL}`);
  await page.click({ "data-cw": "td-send" });
  assert.deepEqual(page.rpcs("tasks.followup")[0].args, { task_ids: ["401"], include_fresh: true, channel: "", note: "" });
  assert.deepEqual(page.gone, ["tasks/followup?ids=401&fresh=1"]);

  const blocked = await openTab(FILE, "tasks", { route: { parts: ["task", "405"] }, answers: { "tasks.task": { ...detail,
    can_follow_up: false, why_not: `assigned to nobody ${EVIL}`, link: "javascript:alert(1)" } } });
  const btn = blocked.find({ "data-cw": "td-send" });
  assert.ok("disabled" in btn.attrs);
  assert.match(blocked.byId("cwTdBody").innerHTML, /Send a follow-up… \(assigned to nobody &lt;img/);
  assert.ok(!/javascript:/.test(blocked.html()), "an unsafe link is never drawn");
  assert.ok(!/Open this task in the portal/.test(blocked.html()));
  const other = await openTab(FILE, "tasks", { route: { parts: ["task", "401"] }, answers: { "tasks.task": { ...detail, link: "http://evil.test/x" } } });
  assert.ok(!/evil\.test/.test(other.html()), "another site over plain http is dropped");

  const gone = await openTab(FILE, "tasks", { route: { parts: ["task", "401"] }, answers: { "tasks.task": rpcError("not_found", "Reload the board first.") } });
  assert.match(gone.byId("cwTdBody").innerHTML, /Reload the board first\./);
  await gone.click({ "data-cw": "tk-reload" });
  assert.deepEqual(gone.gone, ["tasks"]);
});

/* ── Tasks: the follow-up ─────────────────────────────────────────────── */

async function followupPage(answers = {}) {
  const mod = loadModule(FILE);
  const page = await openTab(FILE, "tasks", { mod, answers: { "tasks.board": board(), "tasks.followup": followup(), ...answers } });
  await page.fire("change", { "data-cw": "tk-gsel", "data-g": "0" }, { checked: true });
  await page.click({ "data-cw": "tk-send" });
  await page.rerender({ parts: ["followup"], query: { ids: "401,404", fresh: "0" } });
  return page;
}

test("the follow-up page shows the PC's words: who, about what, the safety line, the ways, the preview, what is left out", async () => {
  const page = await followupPage();
  assert.equal(page.rpcs("tasks.followup").length, 1, "drawn from the answer the board already had");
  noRawHtml(page);
  const body = page.byId("cwFuBody").innerHTML;
  assert.match(body, /<h2>Follow up on 2 tasks &lt;img/);
  assert.match(body, /To: Luis Fakeman \(2 tasks\) &lt;img/);
  assert.match(body, /class="cw-sum cw-bad">Dry run — nothing will be sent\./, "a dry run in red, like the desktop");
  assert.match(body, /No portal account &lt;img/);
  assert.match(body, /<input type="radio" name="cwFuCh" value="" data-cw="fu-ch" checked>/, "Automatic is chosen");
  assert.match(body, /value="whatsapp" data-cw="fu-ch" disabled>/, "a way that cannot be used now is off");
  assert.match(body, /maxlength="200"/);
  assert.match(body, /Left out<\/h3>.*Sweep the yard: assigned to nobody — nothing sent &lt;img/s);
  const prev = page.byId("cwFuPreview").innerHTML;
  assert.match(prev, /Preview — the message about “x” by DCR App &lt;img/);
  assert.match(prev, /No update for 9 days &lt;img/);
  assert.match(prev, /class="cw-warns"><li>Text: up to 1 part \(GSM-7\) &lt;img/);
  const send = page.byId("cwFuSend");
  assert.equal(send.textContent, "Record (dry run)");
  assert.equal(send.disabled, false);
  assert.ok("data-act" in send.attrs && send.attrs["data-method"] === "tasks.followup_send");
});

test("every choice asks the PC again; the note waits 600 ms after the last key; Enter never sends; problems turn Send off", async () => {
  let n = 0;
  const page = await followupPage({ "tasks.followup": (a) => {
    n++;
    return followup(a.note === "long" ? { problems: [`This text would be 7 parts (limit 5) ${EVIL}`], can_send: false }
      : { preview: { label: `Preview by ${a.channel || "auto"}`, text: `note=${a.note}` } });
  } });
  await page.fire("change", { "data-cw": "fu-ch" }, { value: "email", checked: true });
  const last = () => page.rpcs("tasks.followup").at(-1).args;
  assert.deepEqual(last(), { task_ids: ["401", "404"], include_fresh: false, channel: "email", note: "" });
  assert.match(page.byId("cwFuPreview").innerHTML, /Preview by email/);
  const before = page.rpcs("tasks.followup").length;
  await page.fire("input", { "data-cw": "fu-note" }, { value: "Please call the office" });
  assert.equal(page.byId("cwFuCount").textContent, "22 / 200");
  assert.equal(page.rpcs("tasks.followup").length, before, "not on every key");
  const ev = await page.fire("keydown", { "data-cw": "fu-note" }, { key: "Enter" });
  assert.equal(ev.prevented, true, "Enter in the note is swallowed");
  assert.equal(page.calls.filter((c) => c.kind === "act").length, 0);
  await page.runTimers(600);
  assert.deepEqual(last(), { task_ids: ["401", "404"], include_fresh: false, channel: "email", note: "Please call the office" });
  assert.match(page.byId("cwFuPreview").innerHTML, /note=Please call the office/);
  await page.fire("input", { "data-cw": "fu-note" }, { value: "long" });
  await page.runTimers(600);
  assert.match(page.byId("cwFuPreview").innerHTML, /class="cw-probs"><li>This text would be 7 parts \(limit 5\) &lt;img/);
  assert.equal(page.byId("cwFuSend").disabled, true, "Send is off while there is a problem");
  page.byId("cwFuSend").disabled = false;              // as if something turned it back on (the shell's gate coming back)
  await page.click({ "data-cw": "fu-send" });
  assert.equal(page.calls.filter((c) => c.kind === "act").length, 0, "nothing is sent while the PC says it cannot");
  assert.ok(n >= 4);
});

test("an older answer that lands after a newer choice is not drawn", async () => {
  const held = [];
  const page = await followupPage();
  page.ctx.rpc = (m, a) => {
    page.calls.push({ kind: "rpc", method: m, args: structuredClone(a) });
    return new Promise((resolve) => held.push({ a, resolve }));
  };
  await page.fire("change", { "data-cw": "fu-ch" }, { value: "sms", checked: true });
  await page.fire("change", { "data-cw": "fu-ch" }, { value: "email", checked: true });
  held[1].resolve(followup({ preview: { label: "EMAIL", text: "e" } }));
  await settle();
  held[0].resolve(followup({ preview: { label: "SMS", text: "s" } }));
  await settle();
  assert.match(page.byId("cwFuPreview").innerHTML, /EMAIL/);
  assert.ok(!/SMS/.test(page.byId("cwFuPreview").innerHTML));
});

test("Send asks the PC's question with exactly what is on screen (the last keys too), then shows one line per task over the board read again", async () => {
  let boards = 0;
  const page = await followupPage({
    "tasks.board": () => { boards++; return board(); },
    "tasks.followup_send": (a) => ({ lines: [`Luis Fakeman · Order lumber: email recorded (dry run) — ${a.note} ${EVIL}`] }),
  });
  await page.fire("change", { "data-cw": "fu-ch" }, { value: "email", checked: true });
  await page.fire("input", { "data-cw": "fu-note" }, { value: "Call me" });
  await page.click({ "data-cw": "fu-send" });          // the note's timer had not run yet
  const act = page.calls.filter((c) => c.kind === "act");
  assert.equal(act.length, 1);
  assert.equal(act[0].method, "tasks.followup_send");
  assert.deepEqual(act[0].args, { task_ids: ["401", "404"], include_fresh: false, channel: "email", note: "Call me" });
  assert.equal(act[0].opts.text, "Sending 2 follow-ups — this can take a few minutes…", "how many, and that it takes a while");
  assert.deepEqual(page.rpcs("tasks.followup").at(-1).args.note, "Call me", "the preview was asked for the last keys first");
  assert.deepEqual(page.gone.at(-1), "tasks");
  await page.rerender({ parts: [], query: {} });
  assert.equal(boards, 2, "the board is read again after the send");
  assert.match(page.byId("cwTkResults").innerHTML, /email recorded \(dry run\) — Call me &lt;img/);
  assert.equal(page.byId("cwTkSend").textContent, "Send a follow-up about the selected task(s)…", "the selection is cleared");
  noRawHtml(page);
});

test("a no keeps the follow-up open; the PC's refusal is said under the buttons; a reload of the page asks the PC again", async () => {
  const page = await followupPage({ "tasks.followup_send": rpcError("refused", `Not sent: quiet hours ${EVIL}`) });
  page.ctx.confirmAnswer = false;
  await page.click({ "data-cw": "fu-send" });
  assert.equal(page.gone.at(-1), "tasks/followup?ids=401%2C404&fresh=0", "still here");
  page.ctx.confirmAnswer = true;
  await page.click({ "data-cw": "fu-send" });
  assert.equal(page.byId("cwFuMsg").textContent, `Not sent: quiet hours ${EVIL}`);
  assert.match(page.byId("cwFuMsg").className, /cw-bad/);

  const fresh = await openTab(FILE, "tasks", { route: { parts: ["followup"], query: { ids: "401,abc,404,", fresh: "1" } },
    answers: { "tasks.followup": followup() } });
  assert.deepEqual(fresh.rpcs("tasks.followup")[0].args, { task_ids: ["401", "404"], include_fresh: true, channel: "", note: "" },
    "ids from the address, only digits");
  const none = await openTab(FILE, "tasks", { route: { parts: ["followup"], query: {} }, answers: {} });
  assert.match(none.byId("cwFuBody").innerHTML, /Select one or more tasks first\./);
  const gone = await openTab(FILE, "tasks", { route: { parts: ["followup"], query: { ids: "401" } },
    answers: { "tasks.followup": rpcError("not_found", "Reload the board first.") } });
  assert.match(gone.byId("cwFuBody").innerHTML, /Reload the board first\./);
  assert.match(gone.byId("cwFuBody").innerHTML, /data-cw="tk-back"/);
});

test("the Timesheets tab says when it is in dry run (the PC's grid answers dry)", async () => {
  const dry = await openTab(FILE, "timesheets", { answers: { "timesheets.grid": { ...grid(), dry: true } } });
  assert.match(dry.byId("cwTsDry").innerHTML, /class="c-banner info"[^>]*><span>Dry run: a reminder from here is only recorded in Activity — nothing is sent\.<\/span>/);
  const real = await openTab(FILE, "timesheets", { answers: { "timesheets.grid": grid() } });
  assert.equal(real.byId("cwTsDry").innerHTML, "");
});
