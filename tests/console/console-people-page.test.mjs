/* The DCR Agents console's Activity, Replies and People tabs
   (site/js/console/console-people.js), rendered in a stand-in browser
   (console-wp-harness.mjs) against stub answers in the shapes the DCR
   server's console handlers return (console-spec §6.1.6–§6.1.8) — with
   "<img src=x onerror=…>" in every string. Everything drawn must come out
   escaped; a hand reply and a test text go through ctx.act (the PC's own
   question) and never carry an address; the CSV is built in the browser
   from the PC's pages; opt-outs are never cleared from here. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVIL, esc, openTab, loadModule } from "./console-wp-harness.mjs";
import { openConsole, onlineStatus, statusApi, fakeClock } from "./console-page-dom.mjs";

const FILE = "console-people.js";
const plain = (v) => JSON.parse(JSON.stringify(v));

/* ── fixtures in the PC's shapes ─────────────────────────────────────── */

function send(id, over = {}) {
  return { id, at: "2026-10-10T17:02:04+00:00", agent: `Timesheet — 7 pm ${EVIL}`, channel: "sms", person: `Ana ${EVIL}`,
    to: "+18055550102", status: "sent", dry: false, delivery: `delivered ${EVIL}`, note: `note ${EVIL}`, key: `seed:ts:${EVIL}`, ...over };
}
function sends(offset = 0, total = 3, limit = 50) {
  const rows = [send(1, { dry: true, status: "dry-run" }), send(2, { status: "failed", note: `21610 — opted out ${EVIL}` }), send(3, { note: "" })];
  const next = offset + limit < total ? offset + limit : null;
  return { rows, page: { offset, limit, total, next } };
}
const EVENTS = { rows: [
  { at: "2026-10-10T17:02:04+00:00", level: "error", area: `sms ${EVIL}`, message: `Twilio refused ${EVIL}`, detail: `To +1805 ${EVIL}` },
  { at: "2026-10-10T17:01:04+00:00", level: "warn", area: "portal", message: "slow", detail: "" }],
  page: { offset: 0, limit: 50, total: 2, next: null } };
const RUNS = { rows: [{ at: "2026-10-10T17:02:04+00:00", agent: `Tasks ${EVIL}`, found: 3, sent: 2, skipped: 1, failed: 1, dry: true,
  note: `1 already filed ${EVIL}` }], page: { offset: 0, limit: 50, total: 1, next: null } };
const REMOTE = { rows: [
  { at: "2026-10-10T17:02:04+00:00", admin: `Admin Fake admin@dcr.test ${EVIL}`, method: "timesheets.remind", summary: `{"pairs":[…]} ${EVIL}`,
    kind: "W", ok: false, code: "refused", ms: 1234, late: true },
  { at: "2026-10-10T17:01:04+00:00", admin: "Admin Two", method: "people.list", summary: "", kind: "R", ok: true, code: "", ms: 80, late: false }],
  page: { offset: 0, limit: 50, total: 2, next: null } };
const REPLIES = { rows: [
  { sid: "EMfake0003", at: "2026-10-10T16:42:04+00:00", from: `sam@dcr.test ${EVIL}`, person: `Sam ${EVIL}`, channel: "email",
    body: `Can you send me the address? ${EVIL}`, result: "", reply: "", subject: `Re: No timesheet ${EVIL}` },
  { sid: "SMfake0001", at: "2026-10-10T14:02:04+00:00", from: "+18055550101", person: "", channel: "sms",
    body: `8 hrs A901 today ${EVIL}`, result: `filed a timesheet ${EVIL}`, reply: `Got it ${EVIL}`, subject: "" }],
  page: { offset: 0, limit: 50, total: 2, next: null } };
function people() {
  return {
    rows: [
      { name: "Luis Fakeman", role: "Field", phone: "+18055550101", phone_override: "", email: "luis@dcr.test", email_override: "",
        app: true, active: true, channel_pref: "", muted: false, always_nudge: false, flags: [] },
      { name: `Sam ${EVIL}`, role: `Field ${EVIL}`, phone: "+18055550103", phone_override: "+18055559999", email: "sam@dcr.test",
        email_override: `sam2@dcr.test ${EVIL}`, app: false, active: false, channel_pref: "sms", muted: true, always_nudge: true,
        flags: ["opted out", "muted", "always nudge", "prefers sms", `away through Thu Oct 20 ${EVIL}`] },
    ],
    prefs: [{ key: "", label: "agent's order" }, { key: "sms", label: `text only ${EVIL}` }, { key: "none", label: "nothing — do not contact" }],
    note: `Names, roles, phones and emails come from the portal ${EVIL}`,
  };
}
function rpcError(code, message) { return Object.assign(new Error(message), { code }); }
function noRawHtml(page) {
  const all = page.html();
  assert.ok(!/<img/i.test(all), "no raw <img anywhere");
  assert.ok(!/<script/i.test(all), "no raw <script anywhere");
  assert.ok(!/href="javascript:/i.test(all), "no javascript: link");
  assert.ok(all.includes(esc(EVIL)), "the words are still there, as text");
}

/* ── registration and helpers ─────────────────────────────────────────── */

test("registers Activity (80), Replies (90) and People (100) once each; the CSV is the desktop's columns, safe for a spreadsheet", () => {
  const mod = loadModule(FILE);
  assert.deepEqual(Object.keys(mod.defs).sort(), ["activity", "people", "replies"]);
  assert.deepEqual([mod.defs.activity.order, mod.defs.replies.order, mod.defs.people.order], [80, 90, 100]);
  const P = mod.context.DCRConsolePeople;
  assert.equal(P.csvField('say "hi", then'), '"say ""hi"", then"');
  assert.equal(P.csvField("line\nbreak"), '"line\nbreak"');
  assert.equal(P.csvField("=HYPERLINK(1)"), "'=HYPERLINK(1)", "a formula is kept as text");
  assert.equal(P.csvField("@SUM(1)"), "'@SUM(1)");
  assert.equal(P.csvField("+18055550101"), "+18055550101", "a phone number stays a phone number");
  assert.equal(P.csvField("-cmd"), "'-cmd");
  const text = P.csvText([send(7, { dry: true, status: "dry-run", at: "2026-10-10T17:02:04Z" })]);
  const [head, row] = text.split("\r\n");
  assert.equal(head, "when,agent,channel,person,to,status,delivery,note,key");
  assert.match(row, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2},/);
  assert.match(row, /,dry-run \(dry\),/, "the desktop's status words");
  assert.match(P.when("2026-10-10T17:02:04+00:00"), /^Oct 10, /);
  assert.equal(P.when("not a date"), "not a date");
});

/* ── Activity ─────────────────────────────────────────────────────────── */

test("Messages: the PC's page drawn escaped through the shell's table, a dry run marked, a tap opens the words", async () => {
  const page = await openTab(FILE, "activity", { answers: { "activity.sends": sends(0, 230),
    "activity.send": { subject: `Timesheet ${EVIL}`, body: `Hi Ana ${EVIL}` } } });
  assert.deepEqual(plain(page.rpcs("activity.sends")[0].args), { offset: 0, limit: 50, q: "" });
  noRawHtml(page);
  const list = page.byId("cpAcList").innerHTML;
  assert.match(list, /class="c-table c-click"/, "the shell's table, rows that open");
  assert.match(list, /data-label="Agent">Timesheet — 7 pm &lt;img/);
  assert.match(list, /<span class="c-chip warn">dry run<\/span>/);
  assert.ok(!/>dry-run</.test(list), "a dry run is one chip, not the ledger's status and a chip");
  assert.match(list, /<span class="c-chip bad">failed<\/span>/);
  assert.match(list, /data-label="Note"><\/td>/, "an empty note is an empty cell (left out of a phone card)");
  assert.match(page.byId("cpAcPager").innerHTML, /1–50 of 230/);
  await page.tapRow(1);
  assert.deepEqual(plain(page.rpcs("activity.send")[0].args), { id: 2 });
  const m = page.modals.at(-1);
  assert.equal(m.title, `Timesheet ${EVIL}`, "DCR.modal escapes its own title and message");
  assert.match(m.message, /Hi Ana <img/);
  assert.match(m.message, /21610 — opted out/);
  assert.equal(m.cancel, false);
});

test("the filter waits half a second and starts again at the first page; the pager asks for the next one", async () => {
  const page = await openTab(FILE, "activity", { answers: { "activity.sends": (a) => sends(a.offset, 230) } });
  await page.pageTo(50);
  assert.deepEqual(plain(page.rpcs("activity.sends").at(-1).args), { offset: 50, limit: 50, q: "" });
  await page.fire("input", { "data-cp": "ac-q" }, { value: "Ana Testa" });
  assert.equal(page.rpcs("activity.sends").length, 2, "not on every key");
  await page.runTimers(500);
  assert.deepEqual(plain(page.rpcs("activity.sends").at(-1).args), { offset: 0, limit: 50, q: "Ana Testa" });
});

test("Events, Runs and Remote actions: each its own method and columns; a level filter; what an admin did, never what they typed", async () => {
  const page = await openTab(FILE, "activity", { answers: { "activity.sends": sends(), "activity.events": EVENTS,
    "activity.runs": RUNS, "activity.remote": REMOTE } });
  await page.click({ "data-cp": "ac-view", "data-v": "events" });
  assert.deepEqual(plain(page.rpcs("activity.events")[0].args), { offset: 0, limit: 50, level: "" });
  assert.match(page.byId("cpAcSeg").innerHTML, /data-v="events" aria-selected="true"/);
  assert.match(page.byId("cpAcList").innerHTML, /<span class="c-chip bad">error<\/span>/);
  assert.match(page.byId("cpAcTools").innerHTML, /<select id="cpAcLevel"/);
  await page.fire("change", { "data-cp": "ac-level" }, { value: "error" });
  assert.deepEqual(plain(page.rpcs("activity.events")[1].args), { offset: 0, limit: 50, level: "error" });
  await page.tapRow(0);
  assert.match(page.modals.at(-1).message, /Twilio refused <img/);
  await page.click({ "data-cp": "ac-view", "data-v": "runs" });
  assert.match(page.byId("cpAcList").innerHTML, /data-label="Failed" class="c-num"><span class="cp-bad">1<\/span>/);
  await page.click({ "data-cp": "ac-view", "data-v": "remote" });
  const list = page.byId("cpAcList").innerHTML;
  assert.match(list, /problem — refused \(late\)/);
  assert.match(list, /data-label="Kind" class="c-nowrap">change</);
  assert.match(list, /data-label="Kind" class="c-nowrap">look</);
  assert.match(list, /data-label="Took" class="c-num">1\.2 s</);
  assert.match(list, /<span class="c-chip good">OK<\/span>/);
  /* the remote actions and the runs filter too (the desktop's box works on both its views) */
  assert.match(page.byId("cpAcTools").innerHTML, /<input type="search" id="cpAcQ" data-cp="ac-q"[^>]*placeholder="filter by admin, action or how it went"/);
  assert.ok(!/ac-csv/.test(page.byId("cpAcTools").innerHTML), "Export CSV is for the messages only");
  await page.fire("input", { "data-cp": "ac-q" }, { value: "agents.save" });
  await page.runTimers(500);
  assert.deepEqual(plain(page.rpcs("activity.remote").at(-1).args), { offset: 0, limit: 50, q: "agents.save" });
  await page.click({ "data-cp": "ac-view", "data-v": "runs" });
  assert.deepEqual(plain(page.rpcs("activity.runs").at(-1).args), { offset: 0, limit: 50 }, "no q while the box is empty (an older server lacks it)");
  await page.fire("input", { "data-cp": "ac-q" }, { value: "Timesheet" });
  await page.runTimers(500);
  assert.deepEqual(plain(page.rpcs("activity.runs").at(-1).args), { offset: 0, limit: 50, q: "Timesheet" });
  noRawHtml(page);
});

test("Export CSV reads every page of the filtered messages from the PC and saves the file in the browser", async () => {
  const page = await openTab(FILE, "activity", { answers: { "activity.sends": (a) => {
    const total = 450;
    const rows = Array.from({ length: Math.min(a.limit, total - a.offset) }, (_, i) => send(a.offset + i + 1, { person: `P${a.offset + i}` }));
    return { rows, page: { offset: a.offset, limit: a.limit, total, next: a.offset + a.limit < total ? a.offset + a.limit : null } };
  } } });
  page.mod.context.DCRConsolePeople._ac.qs.sends = "ana";
  await page.click({ "data-cp": "ac-csv" });
  const asked = page.rpcs("activity.sends").slice(1).map((c) => plain(c.args));
  assert.deepEqual(asked, [{ q: "ana", offset: 0, limit: 200 }, { q: "ana", offset: 200, limit: 200 }, { q: "ana", offset: 400, limit: 200 }]);
  const blob = page.mod.downloads.find((d) => d && typeof d.text === "function");
  const anchor = page.mod.downloads.find((d) => d && d.tag === "a");
  assert.equal(anchor.download, "dcr-agents-activity.csv");
  assert.equal(anchor.clicked, true);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "a BOM, so a spreadsheet reads the dashes right");
  const text = await blob.text();
  assert.equal(text.trim().split("\r\n").length, 451, "the header and every row");
  assert.match(page.byId("cpAcMsg").textContent, /^Exported 450 messages to dcr-agents-activity\.csv\.$/);
});

test("a failed load shows the shell's error box; a server without the method says to update it", async () => {
  const bad = await openTab(FILE, "activity", { answers: { "activity.sends": rpcError("standby", `The DCR server computer is in Standby. ${EVIL}`) } });
  assert.match(bad.byId("cpAcList").innerHTML, /class="c-error"/);
  noRawHtml(bad);
  const old = await openTab(FILE, "activity", { answers: {}, has: (m) => m !== "activity.sends" });
  assert.equal(old.rpcs("activity.sends").length, 0);
  assert.match(old.byId("cpAcList").innerHTML, /Update DCR Agents on the server computer to use this/);
});

/* ── Replies ──────────────────────────────────────────────────────────── */

test("Replies: each reply with what happened and what we replied, escaped; the right way to answer it; Poll now", async () => {
  let lists = 0;
  const page = await openTab(FILE, "replies", { answers: { "replies.list": () => { lists++; return REPLIES; },
    "replies.poll": { new: 2, words: `2 new ${EVIL}` } } });
  noRawHtml(page);
  const html = page.byId("cpRpList").innerHTML;
  assert.match(html, /<span class="cp-rwho">Sam &lt;img/);
  assert.match(html, /<span class="cp-rwho">\(unknown\)<\/span>/);
  assert.match(html, /<b>Subject:<\/b> Re: No timesheet &lt;img/);
  assert.match(html, /<b>What happened:<\/b> filed a timesheet &lt;img/);
  assert.match(html, /<b>We replied:<\/b> Got it &lt;img/);
  assert.match(html, /data-cp="rp-reply" data-i="0" data-act data-method="replies.reply">Send an email…/);
  assert.match(html, /data-cp="rp-reply" data-i="1" data-act data-method="replies.reply">Send a text…/);
  assert.match(html, /data-cp="rp-teach"[^>]*data-act data-method="replies.teach"/);
  assert.equal(page.byId("cpRpPager").innerHTML, "", "one page: no pager");
  await page.click({ "data-cp": "rp-poll" });
  assert.equal(page.rpcs("replies.poll").length, 1);
  assert.equal(page.byId("cpRpMsg").textContent, `2 new ${EVIL}`);
  assert.equal(lists, 2, "the list is read again after the poll");
});

test("a hand reply: the words first, then the PC's own question; the address is never the page's to give", async () => {
  const page = await openTab(FILE, "replies", { answers: { "replies.list": REPLIES, "replies.reply": { words: `Sent. ${EVIL}` } },
    modal: (o) => ({ text: "  On my way  " }), has: (m) => m !== "replies.check" });
  await page.click({ "data-cp": "rp-reply", "data-i": "1" });
  const m = page.modals[0];
  assert.equal(m.title, "Send a text");
  assert.equal(m.message, "To +18055550101:", "the number when the person is unknown");
  assert.equal(m.validate({ text: "   " }), "There is nothing to send.");
  assert.match(m.validate({ text: "x".repeat(1601) }), /^At most 1600 characters/);
  assert.equal(m.validate({ text: "ok" }), "");
  const act = page.calls.filter((c) => c.kind === "act");
  assert.equal(act.length, 1);
  assert.equal(act[0].method, "replies.reply");
  assert.deepEqual(plain(act[0].args), { sid: "SMfake0001", text: "On my way" }, "the reply's id and the words — no address");
  assert.equal(page.byId("cpRpMsg").textContent, `Sent. ${EVIL}`);
  assert.equal(page.rpcs("replies.list").length, 2, "read again after the reply");

  const no = await openTab(FILE, "replies", { answers: { "replies.list": REPLIES }, modal: () => null, has: (m) => m !== "replies.check" });
  await no.click({ "data-cp": "rp-reply", "data-i": "0" });
  assert.equal(no.modals[0].title, "Send an email");
  assert.equal(no.calls.filter((c) => c.kind === "act").length, 0, "cancelled at the words: nothing asked of the PC");

  let tries = 0;
  const refused = await openTab(FILE, "replies", { answers: { "replies.list": REPLIES,
    "replies.reply": rpcError("refused", `Email is not configured (Settings → Email). ${EVIL}`) },
    modal: () => (++tries === 1 ? { text: "hi there" } : null), has: (m) => m !== "replies.check" });
  await refused.click({ "data-cp": "rp-reply", "data-i": "0" });
  assert.equal(refused.byId("cpRpMsg").textContent, `Email is not configured (Settings → Email). ${EVIL}`);
  assert.match(refused.byId("cpRpMsg").className, /bad/);
  /* the typed words are not thrown away: the box opens again with them and the reason */
  assert.equal(refused.modals.length, 2);
  assert.equal(refused.modals[1].fields[0].value, "hi there");
  assert.match(refused.modals[1].message, /Not sent: Email is not configured/);
});

test("a hand reply asks the DCR server first whether it can go — a refusal comes before anything is typed", async () => {
  const page = await openTab(FILE, "replies", { answers: { "replies.list": REPLIES,
    "replies.check": { kind: "sms", to: "Ana Testa", dry: true, words: `A text to Ana Testa. Dry run is on for every agent: it is recorded in Activity, not sent. ${EVIL}` },
    "replies.reply": { words: "Dry run: recorded in Activity, not sent." } }, modal: () => ({ text: "On my way" }) });
  await page.click({ "data-cp": "rp-reply", "data-i": "1" });
  assert.deepEqual(plain(page.rpcs("replies.check")[0].args), { sid: "SMfake0001" });
  assert.equal(page.modals[0].title, "Send a text");
  assert.match(page.modals[0].message, /^A text to Ana Testa\. Dry run is on/);
  assert.equal(page.byId("cpRpMsg").textContent, "Dry run: recorded in Activity, not sent.");

  const quiet = await openTab(FILE, "replies", { answers: { "replies.list": REPLIES,
    "replies.check": rpcError("refused", `Not sent: it is quiet hours on the DCR server (21:00–08:00) ${EVIL}`) }, modal: () => ({ text: "x" }) });
  await quiet.click({ "data-cp": "rp-reply", "data-i": "1" });
  assert.equal(quiet.modals.length, 0, "nothing to type: it could not go anyway");
  assert.match(quiet.byId("cpRpMsg").textContent, /quiet hours on the DCR server/);
  assert.equal(quiet.calls.filter((c) => c.kind === "act").length, 0);
});

test("a person: Save sends the rev it was shown; another admin's save in between answers changed, and the edits stay", async () => {
  let saved = null;
  const page = await openTab(FILE, "people", { route: { parts: ["Luis Fakeman"] }, answers: {
    "people.list": { rows: [{ name: "Luis Fakeman", role: "Field", phone: "+18055550100", phone_override: "", email: "", email_override: "",
      app: false, active: true, channel_pref: "", muted: false, always_nudge: false, flags: [], rev: "0123456789abcdef" }],
      prefs: [{ key: "", label: "agent's order" }], note: "" },
    "people.save": (a) => { saved = a; return Promise.reject(Object.assign(new Error("Someone changed this since you opened it — reload and try again."), { code: "changed" })); },
  } });
  await page.click({ "data-cp": "pe-save" });
  assert.equal(saved.rev, "0123456789abcdef");
  assert.match(page.byId("cpPeMsg").textContent, /Someone changed this since you opened it — reload and try again\. \(Your changes are still on this screen\.\)/);
});

test("a person: leaving with unsaved edits asks first (the real shell's guard)", async () => {
  const people = { rows: [{ name: "Luis Fakeman", role: "Field", phone: "+18055550100", phone_override: "", email: "", email_override: "",
    app: false, active: true, channel_pref: "", muted: false, always_nudge: false, flags: [], rev: "0123456789abcdef" }],
    prefs: [{ key: "", label: "agent's order" }], note: "" };
  const h = await openConsole({ modules: ["console-people.js"], api: statusApi(onlineStatus()), methods: ["people.list", "people.save"],
    rpc: async (method) => { if (method === "people.list") return JSON.parse(JSON.stringify(people)); throw new Error("no stub"); },
    hash: "#/people/Luis%20Fakeman", answers: [false] });
  await h.settle(10);
  assert.ok(h.$("cpPeP"));
  await h.go("activity");
  await h.settle(10);
  assert.equal(h.dialogs.length, 0, "nothing changed: no question");
  await h.go("people/Luis%20Fakeman");
  await h.settle(10);
  await h.change("cpPeP", "805 555 0199");
  await h.go("activity");
  await h.settle(10);
  assert.equal(h.dialogs[0].opts.message, "Leave without saving your changes to this person?");
  assert.match(h.ctx.location.hash, /^#\/people\/Luis/, "stayed on the person");
});


test("Teach the agents what this meant: the reply's words to trim, what it means, kept as a reading example", async () => {
  const page = await openTab(FILE, "replies", { answers: { "replies.list": REPLIES,
    "replies.teach": { words: `Taught. Claude reads the next replies with this example in mind ${EVIL}` } },
    modal: () => ({ said: "  8 hrs A901 today ", meant: " 8 hours on A901 today " }) });
  await page.click({ "data-cp": "rp-teach", "data-i": "1" });
  const m = page.modals[0];
  assert.equal(m.title, "Teach the agents what this meant");
  assert.equal(m.fields[0].label, "Someone wrote");
  assert.equal(m.fields[0].value, `8 hrs A901 today ${EVIL}`, "the reply's own words, to trim");
  assert.equal(m.fields[1].label, "It means");
  assert.match(m.validate({ said: "x".repeat(1001), meant: "a" }), /at most 1000 characters/);
  assert.match(m.validate({ said: "x", meant: "y".repeat(501) }), /at most 500 characters/);
  assert.equal(m.validate({ said: "x", meant: "" }), "Write what it means.");
  assert.deepEqual(plain(page.rpcs("replies.teach")[0].args), { sid: "SMfake0001", said: "8 hrs A901 today", meant: "8 hours on A901 today" });
  assert.equal(page.calls.filter((c) => c.kind === "act").length, 0, "teaching asks nothing (not a C method)");
  assert.match(page.byId("cpRpMsg").textContent, /^Taught\./);
  const bad = await openTab(FILE, "replies", { answers: { "replies.list": REPLIES, "replies.teach": rpcError("refused", "Training is not part of this build.") },
    modal: () => ({ said: "a", meant: "b" }) });
  await bad.click({ "data-cp": "rp-teach", "data-i": "0" });
  assert.equal(bad.byId("cpRpMsg").textContent, "Not saved: Training is not part of this build.");
});

/* ── People ───────────────────────────────────────────────────────────── */

test("People: the roster with overrides and taught flags, escaped; the find box filters here; a tap opens the person", async () => {
  const page = await openTab(FILE, "people", { answers: { "people.list": people() } });
  noRawHtml(page);
  const list = page.byId("cpPpList").innerHTML;
  assert.match(list, /data-label="Phone">\+18055559999 <span class="c-muted c-small">\(override\)<\/span>/);
  assert.match(list, /data-label="Email">sam2@dcr\.test &lt;img[^<]*<span class="c-muted c-small">\(override\)/);
  assert.match(list, /<span class="c-chip warn">opted out<\/span>/);
  assert.match(list, /<span class="c-chip info">away through Thu Oct 20 &lt;img/);
  assert.match(list, /data-label="Active">no</);
  assert.match(list, /2 of 2 people/);
  assert.equal(page.byId("cpPpNote").textContent, `Names, roles, phones and emails come from the portal ${EVIL}`);
  assert.ok(!/clear/i.test(list.replace(/class="[^"]*"/g, "")), "nothing offers to clear an opt-out");
  await page.fire("input", { "data-cp": "pp-q" }, { value: "luis" });
  assert.match(page.byId("cpPpList").innerHTML, /1 of 2 people/);
  assert.equal(page.rpcs("people.list").length, 1, "the find box asks nothing");
  await page.tapRow(0);
  assert.deepEqual(page.gone, ["people/Luis%20Fakeman"]);
});

test("Refresh from portal asks the PC, then reads the roster again", async () => {
  let lists = 0;
  const page = await openTab(FILE, "people", { answers: { "people.list": () => { lists++; return people(); },
    "people.refresh": { count: 7, words: `7 people on the list, fresh from the portal. ${EVIL}` } } });
  const btn = page.find({ "data-cp": "pp-refresh" });
  assert.ok("data-act" in btn.attrs && btn.attrs["data-method"] === "people.refresh");
  await page.click({ "data-cp": "pp-refresh" });
  assert.equal(page.rpcs("people.refresh").length, 1);
  assert.equal(page.byId("cpPpMsg").textContent, `7 people on the list, fresh from the portal. ${EVIL}`);
  assert.equal(lists, 2);
});

test("a person: the office's settings filled from the PC, Save sends every field, a test text asks the PC first", async () => {
  const saved = [];
  const page = await openTab(FILE, "people", { route: { parts: [`Sam ${EVIL}`] }, answers: {
    "people.list": people(),
    "people.save": (a) => { saved.push(a); return { words: `Saved ${a.name}.` }; },
    "people.test_text": { words: "Sent." },
  } });
  noRawHtml(page);
  assert.equal(page.byId("cpPeP").value, "+18055559999");
  assert.equal(page.byId("cpPeE").value, `sam2@dcr.test ${EVIL}`);
  assert.equal(page.byId("cpPePref").value, "sms");
  assert.equal(page.byId("cpPeMute").checked, true);
  assert.equal(page.byId("cpPeAlways").checked, true);
  assert.match(page.byId("cpPeBody").innerHTML, /href="#\/training\/employee%3ASam%20%3Cimg%20src%3Dx%20onerror%3Dalert\(1\)%3E"/,
    "Teach the agents about this person… opens Training on them");
  page.byId("cpPeP").value = "  805-555-0177 ";
  page.byId("cpPePref").value = "none";
  page.byId("cpPeMute").checked = false;
  await page.click({ "data-cp": "pe-save" });
  assert.deepEqual(plain(saved[0]), { name: `Sam ${EVIL}`, phone_override: "805-555-0177", email_override: `sam2@dcr.test ${EVIL}`,
    channel_pref: "none", muted: false, always_nudge: true });
  assert.equal(page.byId("cpPeMsg").textContent, `Saved Sam ${EVIL}.`);
  assert.equal(page.rpcs("people.list").length, 2, "the roster is read again: the flags follow");
  await page.click({ "data-cp": "pe-test" });
  const act = page.calls.filter((c) => c.kind === "act");
  assert.equal(act.length, 1);
  assert.deepEqual(plain(act[0]), { kind: "act", method: "people.test_text", args: { name: `Sam ${EVIL}` }, opts: plain(act[0].opts) },
    "only the name: the PC uses the number on file");
  assert.equal(page.byId("cpPeMsg").textContent, "Sent.");
  for (const b of ["pe-save", "pe-test"]) {
    const el = page.find({ "data-cp": b });
    assert.ok("data-act" in el.attrs, b + " is a write");
  }
});

test("a person: the PC's refusal is said; too long is stopped here; a no sends nothing; someone not on the list says so", async () => {
  const page = await openTab(FILE, "people", { route: { parts: ["Luis Fakeman"] }, answers: { "people.list": people(),
    "people.save": rpcError("refused", `That phone number does not look usable. ${EVIL}`) } });
  page.byId("cpPeP").value = "12";
  await page.click({ "data-cp": "pe-save" });
  assert.equal(page.byId("cpPeMsg").textContent, `That phone number does not look usable. ${EVIL}`);
  page.byId("cpPeE").value = "x".repeat(121);
  await page.click({ "data-cp": "pe-save" });
  assert.equal(page.byId("cpPeMsg").textContent, "The email override can be at most 120 characters.");
  assert.equal(page.rpcs("people.save").length, 1);
  page.ctx.confirmAnswer = false;
  await page.click({ "data-cp": "pe-test" });
  assert.equal(page.byId("cpPeMsg").textContent, "The email override can be at most 120 characters.", "a no changes nothing");
  await page.click({ "data-cp": "pp-back" });
  assert.deepEqual(page.gone, ["people"]);
  const nobody = await openTab(FILE, "people", { route: { parts: ["Nobody Here"] }, answers: { "people.list": people() } });
  assert.match(nobody.byId("cpPeBody").innerHTML, /That person is not on the list/);
});

test("switching the Activity view while one is loading leaves no working line behind (found in the screenshots)", async () => {
  const clock = fakeClock();
  const h = await openConsole({ clock, modules: ["console-people.js"], api: statusApi(onlineStatus()), methods: ["activity.sends", "activity.remote"],
    rpc: (method) => new Promise((r) => clock.setTimeout(() => r(method === "activity.sends"
      ? { rows: [], page: { offset: 0, limit: 50, total: 0, next: null } }
      : { rows: [], page: { offset: 0, limit: 50, total: 0, next: null } }), method === "activity.sends" ? 3000 : 500)),
    hash: "#/activity" });
  await h.settle(100);
  assert.equal(h.$("cpAcBusy").children.length, 1, "the messages are loading");
  await h.click(h.view().querySelector('[data-v="remote"]'));
  await h.settle(5000);
  assert.equal(h.$("cpAcBusy").children.length, 0, "neither load's line is left counting");
});

/* ── WhatsApp on the DCR server computer ──────────────────────────────── */

const WA_REPLIES = { rows: [
  { sid: "wa:7:1", at: "2026-10-12T16:42:04+00:00", from: `Ana T ${EVIL}`, person: "", channel: "wadesktop", body: `8 hrs A081 ${EVIL}`,
    result: "unknown WhatsApp name — not answered", reply: "", subject: "", learn: true, suggest: "Luis Fakeman" },
  { sid: "wa:8:1", at: "2026-10-12T16:40:04+00:00", from: "+18055550101", person: "Luis Fakeman", channel: "wadesktop", body: "ok", result: "", reply: "",
    subject: "", learn: false }],
  page: { offset: 0, limit: 50, total: 2, next: null } };

test("Replies: a WhatsApp row says which WhatsApp; an unknown name offers This is… instead of a reply", async () => {
  const page = await openTab(FILE, "replies", { answers: { "replies.list": WA_REPLIES } });
  noRawHtml(page);
  const list = page.byId("cpRpList").innerHTML;
  assert.match(list, /WhatsApp on the DCR server/);
  const thisIs = page.find({ "data-cp": "rp-thisis", "data-i": "0" });
  assert.ok(thisIs, "This is… on the unknown name");
  assert.ok("data-act" in thisIs.attrs && thisIs.attrs["data-method"] === "replies.this_is");
  assert.equal(page.find({ "data-cp": "rp-reply", "data-i": "0" }), null, "no number to answer on");
  assert.equal(page.find({ "data-cp": "rp-thisis", "data-i": "1" }), null);
  assert.match(list, /Send a WhatsApp message…/);
});

test("This is…: people with a phone, the server's likely one picked, then the server's own question; the name and the handling are the server's", async () => {
  const page = await openTab(FILE, "replies", { answers: { "replies.list": WA_REPLIES, "people.list": people(),
    "replies.this_is": (a) => ({ words: `Saved: ${a.name} is “Ana T” on WhatsApp. 1 message from it handled now.` }) },
    modal: (o) => ({ name: o.fields[0].value }) });
  await page.click({ "data-cp": "rp-thisis", "data-i": "0" });
  const m = page.modals[0];
  assert.equal(m.title, "This is…");
  assert.match(m.message, /A WhatsApp message came from “Ana T <img src=x onerror=alert\(1\)>”/);
  assert.match(m.message, /They wrote: 8 hrs A081/);
  assert.equal(m.fields[0].type, "select");
  assert.equal(m.fields[0].value, "Luis Fakeman", "the server's suggestion first");
  assert.deepEqual(plain(m.fields[0].options.map((o) => o.value)), ["", "Luis Fakeman", `Sam ${EVIL}`]);
  assert.equal(m.validate({ name: "" }), "Pick the person first.");
  const act = page.calls.filter((c) => c.kind === "act");
  assert.deepEqual(plain(act.map((c) => [c.method, c.args])), [["replies.this_is", { sid: "wa:7:1", name: "Luis Fakeman" }]]);
  assert.equal(page.byId("cpRpMsg").textContent, "Saved: Luis Fakeman is “Ana T” on WhatsApp. 1 message from it handled now.");
  assert.equal(page.rpcs("replies.list").length, 2, "the list is read again");
});

test("This is…: the server's refusal is said; a no to its question saves nothing", async () => {
  const page = await openTab(FILE, "replies", { answers: { "replies.list": WA_REPLIES, "people.list": people(),
    "replies.this_is": rpcError("refused", `Sam has no phone number on file. ${EVIL}`) }, modal: () => ({ name: "Luis Fakeman" }) });
  await page.click({ "data-cp": "rp-thisis", "data-i": "0" });
  assert.equal(page.byId("cpRpMsg").textContent, `Sam has no phone number on file. ${EVIL}`);
  const no = await openTab(FILE, "replies", { answers: { "replies.list": WA_REPLIES, "people.list": people(), "replies.this_is": { words: "x" } },
    modal: () => ({ name: "Luis Fakeman" }), confirmAnswer: false });
  await no.click({ "data-cp": "rp-thisis", "data-i": "0" });
  assert.equal(no.byId("cpRpMsg").textContent, "");
  assert.equal(no.rpcs("replies.list").length, 1, "nothing to read again");
});

test("a person: the WhatsApp name is shown and saved when the server knows it, and never sent to one that does not", async () => {
  const withName = people();
  withName.rows[0].wa_name = `Luis F ${EVIL}`;
  withName.rows[1].wa_name = "";
  const saved = [];
  const page = await openTab(FILE, "people", { route: { parts: ["Luis Fakeman"] }, answers: { "people.list": withName,
    "people.save": (a) => { saved.push(a); return { words: "Saved Luis Fakeman." }; } } });
  noRawHtml(page);
  assert.equal(page.byId("cpPeW").value, `Luis F ${EVIL}`);
  assert.match(page.byId("cpPeBody").innerHTML, /How WhatsApp on the DCR server computer shows them/);
  page.byId("cpPeW").value = "  Luis F. ";
  await page.click({ "data-cp": "pe-save" });
  assert.equal(saved[0].wa_name, "Luis F.");
  page.byId("cpPeW").value = "x".repeat(81);
  await page.click({ "data-cp": "pe-save" });
  assert.equal(page.byId("cpPeMsg").textContent, "A WhatsApp name can be at most 80 characters.");
  assert.equal(saved.length, 1);
  const old = await openTab(FILE, "people", { route: { parts: ["Luis Fakeman"] }, answers: { "people.list": people(),
    "people.save": (a) => { saved.push(a); return { words: "Saved." }; } } });
  assert.equal(old.byId("cpPeW"), null, "an older server has no WhatsApp name");
  await old.click({ "data-cp": "pe-save" });
  assert.ok(!("wa_name" in saved[1]), "and is never sent one");
});
