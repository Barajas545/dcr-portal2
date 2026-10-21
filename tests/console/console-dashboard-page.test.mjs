/* The DCR Agents console's Dashboard tab (site/js/console/console-dashboard.js)
   against stub answers in the dashboard.status shape (console-spec §6.1.2,
   as the PC's dashboard.py builds it), with an <img onerror> in every
   string: Needs you with the first-run buttons, the numbers, the health
   rows, Coming up and Recent runs, Pause / Resume and Check now. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openConsole, onlineStatus, statusApi, scan, EVIL, esc, plain } from "./console-page-dom.mjs";

const METHODS = ["dashboard.status", "dashboard.health", "dashboard.first_run", "dashboard.approve", "dashboard.pause", "agents.list"];

function status(over = {}) {
  return {
    host: `SRV${EVIL}`, version: EVIL, paused: false, dry_run_all: false, last_tick: "2026-10-10T10:10:11-07:00", tick_error: "", zone_warning: "",
    heartbeat_error: "", cards: { sent: 7, failed: 2, replies: 1, agents_on: 3, agents_total: 8 },
    needs: [
      { level: "warn", text: `Set up: ${EVIL}`, firstrun: null },
      { level: "warn", text: `'${EVIL}' ran for the first time: 4 found, 3 would be sent. Review it before anything goes.`,
        firstrun: { agent_id: "4a93aa21d72a", name: EVIL, found: 4, would_send: 3 } },
      { level: "bad", text: `Sat Oct 10 10:00  ${EVIL}`, firstrun: null },
    ],
    coming_up: [
      { group: `Timesheets · ${EVIL}`, agent_id: "4a93aa21d72a", name: EVIL, watches: EVIL, on: true, next: "2026-10-12T17:00-07:00", last: null },
      { group: "Checks · Everyone", agent_id: "511c5d29063f", name: "Check ready", watches: "Checks ready for pickup", on: false, next: null, last: "2026-10-09T09:00-07:00" },
    ],
    recent_runs: [{ at: "2026-10-10T16:00:00+00:00", agent: EVIL, found: 4, sent: 0, skipped: 1, failed: 0, dry: true, note: `dry run${EVIL}` }],
    health: { checked_at: "2026-10-10T16:50:00Z", rows: [{ key: EVIL, ok: true, detail: EVIL }, { key: "email", ok: false, detail: `Outlook ${EVIL}` }] },
    extras: [{ key: "scheduled task", ok: true, detail: "registered correctly" }, { key: "last tick", ok: true, detail: EVIL },
      { key: "heartbeat to portal", ok: false, detail: `PROBLEM — ${EVIL}` }],
    lease: { host: `SRV${EVIL}`, since: "2026-10-10T17:00:11.093Z", by: EVIL },
    console: { workers_busy: 3, fast_until: null },
    ...over,
  };
}

function stubs(answers) {
  const calls = [];
  const fn = async (method, args) => {
    calls.push(plain({ method, args }));
    const a = answers[method];
    if (a === undefined) throw Object.assign(new Error(`no stub for ${method}`), { code: "failed" });
    const v = typeof a === "function" ? a(args, calls) : a;
    if (v instanceof Error) throw v;
    return JSON.parse(JSON.stringify(v));
  };
  return { calls, fn };
}

async function open(answers, extra = {}) {
  const s = stubs(answers);
  const h = await openConsole({ modules: ["console-dashboard.js"], api: statusApi(onlineStatus()), rpc: s.fn, methods: METHODS, hash: "#/dashboard", ...extra });
  await h.settle(10);
  return { h, calls: s.calls };
}

test("the dashboard draws every server string escaped: Needs you, the numbers, health, Coming up, Recent runs", async () => {
  const { h } = await open({ "dashboard.status": status() });
  const v = h.view();
  assert.deepEqual(scan(v), [], "no element or handler from the server's words");
  assert.ok(h.html().includes(esc(EVIL)));
  assert.match(v.querySelector(".c-sub").textContent, /^DCR server SRV<img src=x onerror=alert\(1\)> · DCR Agents <img/);
  const needs = v.querySelectorAll(".cd-need");
  assert.deepEqual(needs.map((n) => n.className), ["cd-need warn", "cd-need warn", "cd-need bad"]);
  const fr = needs[1];
  assert.equal(fr.querySelector("a").getAttribute("href"), "#/agents/review/4a93aa21d72a", "Show me opens the review");
  assert.deepEqual(fr.querySelectorAll("button").map((b) => b.textContent),
    ["Mark these as already handled, then start", "Send them, and start"]);
  assert.ok(fr.querySelectorAll("button").every((b) => b.hasAttribute("data-act") && b.getAttribute("data-method") === "dashboard.approve"));
  assert.equal(needs[0].querySelectorAll("button").length, 0);
  const stats = v.querySelectorAll(".c-stat").map((s) => [s.querySelector(".c-stat-l").textContent, s.querySelector(".c-stat-n").textContent, s.classList.contains("bad")]);
  assert.deepEqual(stats, [["Sent today", "7", false], ["Failed today", "2", true], ["Replies today", "1", false], ["Agents on", "3 / 8", false]]);
  const health = h.$("cdHealth");
  assert.match(health.textContent, /OK <img src=x onerror=alert\(1\)>/);
  assert.match(health.textContent, /PROBLEM Outlook <img/);
  assert.match(h.$("cdChecked").textContent, /^Channels checked/);
  const links = v.querySelectorAll('a[href^="#/agents/edit/"]').map((a) => a.getAttribute("href"));
  assert.deepEqual(links, ["#/agents/edit/4a93aa21d72a", "#/agents/edit/511c5d29063f"], "Coming up opens each agent's editor");
  assert.match(v.textContent, /2 other remote actions running now\./, "the request itself is not counted");
  assert.equal(h.$("cdPause").textContent, "Pause everything");
});

test("the server's first-run buttons: Send them asks the server's question, then approves confirmed and redraws", async () => {
  const q = { title: "First run", question: `Send them, and start '${EVIL}'? 3 messages would go.`, ok_text: "Send them and start", danger: true, twice: null, extra: [] };
  const { h, calls } = await open({
    "dashboard.status": status(),
    "dashboard.approve": (a) => (a.confirmed ? { words: `'${EVIL}' will send from its next scheduled run.`, marked: 0 } : { confirm: q }),
  }, { answers: [true] });
  const send = h.view().querySelectorAll(".cd-need")[1].querySelectorAll("button")[1];
  await h.click(send);
  await h.settle(10);
  assert.deepEqual(calls.filter((c) => c.method === "dashboard.approve"), [
    { method: "dashboard.approve", args: { agent_id: "4a93aa21d72a", mark_handled: false } },
    { method: "dashboard.approve", args: { agent_id: "4a93aa21d72a", mark_handled: false, confirmed: true } },
  ]);
  assert.equal(h.dialogs[0].opts.message, q.question, "the question is the server's own, as text");
  assert.equal(h.dialogs[0].opts.danger, true);
  assert.ok(h.toasts().some((t) => t.text === `'${EVIL}' will send from its next scheduled run.`));
  assert.equal(calls.filter((c) => c.method === "dashboard.status").length, 2, "redrawn");
});

test("Mark these as already handled sends mark_handled:true; declining the question changes nothing", async () => {
  const q = { title: "First run", question: "Mark these 4 as already handled, then start 'x'?", ok_text: "Mark them and start", danger: false, twice: null, extra: [] };
  const { h, calls } = await open({ "dashboard.status": status(), "dashboard.approve": (a) => (a.confirmed ? { words: "ok", marked: 4 } : { confirm: q }) },
    { answers: [null] });
  await h.click(h.view().querySelectorAll(".cd-need")[1].querySelectorAll("button")[0]);
  await h.settle(10);
  assert.deepEqual(calls.filter((c) => c.method === "dashboard.approve"), [
    { method: "dashboard.approve", args: { agent_id: "4a93aa21d72a", mark_handled: true } }]);
  assert.equal(calls.filter((c) => c.method === "dashboard.status").length, 1, "nothing to redraw");
});

test("Pause everything / Resume everything go through the server's question", async () => {
  for (const paused of [false, true]) {
    const { h, calls } = await open({
      "dashboard.status": status({ paused }),
      "dashboard.pause": (a) => (a.confirmed ? { paused: a.paused } : { confirm: { title: "x", question: "Pause everything?", ok_text: "Pause everything", danger: false, twice: null, extra: [] } }),
    }, { answers: [true] });
    assert.equal(h.$("cdPause").textContent, paused ? "Resume everything" : "Pause everything");
    await h.click("cdPause");
    await h.settle(10);
    assert.deepEqual(calls.filter((c) => c.method === "dashboard.pause").map((c) => c.args), [{ paused: !paused }, { paused: !paused, confirmed: true }]);
    assert.ok(h.toasts().some((t) => (paused ? /Resumed/ : /paused/).test(t.text)));
  }
});

test("Check now asks the portal and every channel (dashboard.health), then redraws with the answer", async () => {
  let checked = false;
  const { h, calls } = await open({
    "dashboard.status": () => status(checked ? { health: { checked_at: "2026-10-10T17:00:05Z", rows: [{ key: "app", ok: true, detail: "fresh" }] } } : {}),
    "dashboard.health": () => { checked = true; return { checked_at: "2026-10-10T17:00:05Z", rows: [{ key: "app", ok: true, detail: "fresh" }] }; },
  });
  await h.click("cdCheck");
  await h.settle(10);
  assert.deepEqual(calls.map((c) => c.method), ["dashboard.status", "dashboard.health", "dashboard.status"]);
  assert.match(h.$("cdHealth").textContent, /app\s*OK fresh/);
});

test("a dashboard that cannot load says why, with Try again; the tab redraws by itself every minute", async () => {
  let n = 0;
  const { h, calls } = await open({ "dashboard.status": () => (++n === 1 ? Object.assign(new Error(`Refused ${EVIL}`), { code: "refused" }) : status()) });
  assert.match(h.view().textContent, /That did not work\.Refused <img src=x onerror=alert\(1\)>/);
  assert.deepEqual(scan(h.view()), []);
  await h.click(h.view().querySelector("[data-c-retry]"));
  await h.settle(10);
  assert.ok(h.$("cdPause"), "drawn on the second try");
  await h.settle(60000);
  assert.equal(calls.filter((c) => c.method === "dashboard.status").length, 3, "autoRefresh: 60 s");
});

/* ── review fixes ──────────────────────────────────────────────────────── */

test("a health row the server already words as a PROBLEM says it once, beside its chip", async () => {
  const { h } = await open({ "dashboard.status": status() });
  const text = h.$("cdHealth").textContent;
  assert.match(text, /heartbeat to portal\s*PROBLEM <img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(text, /PROBLEM PROBLEM/);
});

test("the minute's refresh keeps the page on screen and swaps it only when the answer changed", async () => {
  let version = "2.0.0";
  const { h, calls } = await open({ "dashboard.status": () => status({ version }) });
  const before = h.$("cdPause");
  await h.settle(60000);
  assert.equal(calls.filter((c) => c.method === "dashboard.status").length, 2, "asked again");
  assert.equal(h.$("cdPause"), before, "the same answer: nothing redrawn, no skeletons");
  assert.equal(h.view().querySelectorAll(".c-skel").length, 0);
  version = "2.0.1";
  await h.settle(60000);
  assert.notEqual(h.$("cdPause"), before, "a new answer is drawn in place");
  assert.match(h.view().querySelector(".c-sub").textContent, /DCR Agents 2\.0\.1/);
  assert.equal(h.view().querySelectorAll(".c-skel").length, 0);
});

test("a page left untouched for ten minutes stops refreshing until someone touches it", async () => {
  const { h, calls } = await open({ "dashboard.status": status() });
  await h.settle(11 * 60000);
  const n = calls.filter((c) => c.method === "dashboard.status").length;
  await h.settle(5 * 60000);
  assert.equal(calls.filter((c) => c.method === "dashboard.status").length, n, "nobody is looking: no requests");
  (h.doc.listeners.pointerdown || []).forEach((fn) => fn({ type: "pointerdown" }));
  await h.settle(61000);
  assert.equal(calls.filter((c) => c.method === "dashboard.status").length, n + 1, "back as soon as someone is");
});

test("channels never checked (or over ten minutes ago) are checked once in the background, quietly", async () => {
  let checked = false;
  const { h, calls } = await open({
    "dashboard.status": () => status({ health: checked ? { checked_at: "2026-10-10T17:00:02Z", rows: [{ key: "app", ok: true, detail: "fresh" }] }
      : { checked_at: null, rows: [] } }),
    "dashboard.health": () => { checked = true; return { checked_at: "2026-10-10T17:00:02Z", rows: [{ key: "app", ok: true, detail: "fresh" }] }; },
  });
  await h.settle(10);
  assert.deepEqual(calls.map((c) => c.method), ["dashboard.status", "dashboard.health", "dashboard.status"]);
  assert.match(h.$("cdHealth").textContent, /app\s*OK fresh/);
  assert.equal(h.toasts().length, 0, "quietly");
  await h.settle(60000);
  assert.equal(calls.filter((c) => c.method === "dashboard.health").length, 1, "once, not every minute");
});

/* ── WhatsApp on the DCR server computer ──────────────────────────────── */

function waCard(over = {}) {
  return {
    enabled: true, mode: "assisted", mode_label: "Wait for a person to press Send (safe — recommended)", mode_words: `waits for someone to press Send ${EVIL}`,
    waiting: 3, state: "off", state_words: "", today: 0, this_hour: 0, per_day: 60, per_hour: 20, next_at: null, last_read: null, read_error: "",
    read_words: "", read_ok: true, expire_hours: 12, more: 1,
    items: [
      { id: 1, person: `Luis ${EVIL}`, agent: `Timesheet ${EVIL}`, phone_masked: "…0142", text: `No timesheet for Mon ${EVIL}`, created_at: "2026-10-12T16:00:00Z",
        status: "waiting", opened: false, note: "" },
      { id: 2, person: "", agent: "", phone_masked: "…0199", text: "Got it, thanks", created_at: "2026-10-12T16:05:00Z", status: "opened", opened: true, note: "" },
    ],
    where: `Sent from the DCR server computer: someone at it opens each message in WhatsApp and presses Send ${EVIL}`,
    ...over,
  };
}

test("the WhatsApp outbox card: read-only, escaped, numbers masked; Needs you's line scrolls to it", async () => {
  const needs = [{ level: "warn", text: "3 WhatsApp messages are waiting for you to press Send", firstrun: null, outbox: 3 }];
  const { h, calls } = await open({ "dashboard.status": status({ needs, wadesktop: waCard() }) });
  const v = h.view();
  assert.deepEqual(scan(v), []);
  const card = h.$("cdWa");
  assert.ok(card, "the card is drawn");
  assert.equal(card.querySelector("h3").textContent, "WhatsApp outbox");
  assert.match(card.textContent, /3 messages waiting · dropped after 12 h if nobody sends them/);
  assert.match(card.textContent, /Luis <img src=x onerror=alert\(1\)>/);
  assert.match(card.textContent, /…0142/);
  assert.match(card.textContent, /\(not on the roster\)/);
  assert.match(card.textContent, /opened in WhatsApp/);
  assert.match(card.textContent, /… and 1 more message\./);
  assert.match(card.textContent, /someone at it opens each message in WhatsApp/);
  assert.match(card.querySelector(".cd-wa-chips").textContent, /waits for someone to press Send <img/);
  assert.equal(card.querySelectorAll("button").length, 0, "nothing to press: it is sent from the server");
  assert.ok(!/\+1805|18055550142/.test(h.html()), "never a whole number");
  const line = v.querySelectorAll(".cd-need")[0];
  const show = line.querySelector('[data-do="wa"]');
  assert.equal(show.textContent, "Show the messages");
  assert.ok(!show.hasAttribute("data-act"), "looking is not a write");
  await h.click(show);
  await h.settle(10);
  assert.equal(calls.length, 1, "scrolling asks the server nothing");
});

test("the WhatsApp card says what holds the automatic sender back and when replies cannot be read; no card when the server has none", async () => {
  const { h } = await open({ "dashboard.status": status({ wadesktop: waCard({ mode: "automatic", mode_words: "sent automatically",
    state_words: `the screen is locked ${EVIL}`, read_ok: false, read_words: "Windows notifications are turned off for WhatsApp", more: 0 }) }) });
  const card = h.$("cdWa");
  assert.match(card.textContent, /the screen is locked <img/);
  assert.match(card.textContent, /Reading replies: Windows notifications are turned off for WhatsApp/);
  assert.match(card.querySelector(".cd-wa-chips").innerHTML, /c-chip warn">sent automatically/);
  assert.match(card.querySelector(".cd-wa-chips").innerHTML, /c-chip bad">replies not read/);
  assert.ok(!/and \d+ more/.test(card.textContent));
  const none = await open({ "dashboard.status": status({ wadesktop: null }) });
  assert.equal(none.h.$("cdWa"), null);
  const empty = await open({ "dashboard.status": status({ wadesktop: waCard({ waiting: 0, items: [], more: 0 }) }) });
  assert.match(empty.h.$("cdWa").textContent, /Nothing is waiting in the WhatsApp outbox\./);
});
