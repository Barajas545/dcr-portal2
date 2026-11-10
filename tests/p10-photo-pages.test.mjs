// The shoot schedule's pages (the photographer screen program, P3; DCR Desktop 2 migration 20261110000100, the contract
// DCR Desktop 2 docs/PHOTO-SCHEDULE.md; the owner's decisions of 2026-11-09), read from their source and run as pure
// rules: shoots.html (the policy, the module, its own styles, the views), the service worker (v6: the page and its rules
// kept for a cold start), the top bar's "Shoot schedule" (admins and the photo team - a hint kept per account), the Home
// card (📷, a dynamic import), My Tasks' "Open in shoot schedule", the Access tab's Photo team (set_photo_team only, the
// one default photographer, the Google e-mail), map/shoots.js (the office computer's line, the address, the sheet's words,
// the Move sheet's days and the office's approval) and map/access.js's photo rules. Made-up people and shoots only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { navItems, showsShoots, photoHint, rememberPhotoAccess } from "../site/js/common2.js";
import * as V from "../site/js/map/shoots.js";
import * as M from "../site/js/map/photo.js";
import * as A from "../site/js/map/access.js";
import { addDays } from "../site/js/map/pacific.js";

const read = (rel) => readFileSync(new URL("../site/" + rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const csp = (x) => (/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(x) || [])[1];
const TODAY = "2026-11-09";              // a Monday

/* ── the page, read from its source ── */

test("shoots.html: My Tasks' policy word for word, its module and styles, the top bar, the three views, the list / shoot / sheet slots, no inline script", () => {
  const h = read("shoots.html");
  assert.equal(csp(h), csp(read("my-tasks.html")), "the same policy as My Tasks");
  assert.ok(h.includes('<script type="module" src="js/pages/shoots.js"></script>') && h.includes('id="dcr2Topbar"'));
  assert.ok(h.includes('<link rel="stylesheet" href="css/styles.css" />') && h.includes('<link rel="stylesheet" href="css/shoots.css" />'));
  assert.ok(!/<script>(?!\s*<\/script>)/.test(h.replace(/<script[^>]*src=[^>]*><\/script>/g, "")), "no inline script");
  assert.ok(!/\son[a-z]+=/i.test(h), "no inline handler");
  assert.match(h, /<title>DCR Portal 2 — Shoot schedule<\/title>/);
  assert.deepEqual(Array.from(h.matchAll(/data-view="([a-z]+)"/g)).map((m) => m[1]), ["agenda", "job", "month"]);
  assert.match(h, /data-view="agenda" aria-pressed="true">Agenda</);
  for (const id of ["shList", "shDetail", "shDScroll", "shSheet", "shPc", "shLead", "shMine", "shArchived", "shBack", "shClose"]) assert.ok(h.includes('id="' + id + '"'), id);
  const css = read("css/shoots.css");
  for (const rule of ["@media (min-width:1024px)", ".sh-layout.month", '@media (prefers-color-scheme: dark)', ':root[data-theme="dark"] .sh', ".sh-detail.open", ".mv-d.off"]) {
    assert.ok(css.includes(rule), rule);
  }
});

test("shoots.js: reads only through repo/photo.js (never a table write), the gates before any read, the three choices with Only this shoot preselected, the rev the screen read, the PT409 re-preview, no innerHTML from raw data", () => {
  const s = code(read("js/pages/shoots.js"));
  assert.ok(!/\.from\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(s), "no table read or write of its own");
  assert.match(s, /import \* as repo from "\.\.\/repo\/photo\.js";/);
  const gate = s.indexOf("if (!access || !access.ready || !access.canRead) { render(); return; }");
  assert.ok(gate > 0 && s.indexOf("await load();", gate) > gate, "the gates come before the first read");
  assert.match(s, /kind: "move_one", day: null/, "Only this shoot is preselected");
  assert.match(s, /repo\.request\(mv\.planId, want\.kind, want\.args, mv\.baseRev\)/, "the request carries the rev the screen read");
  assert.match(s, /baseRev: plan\.rev/);
  assert.match(s, /e\.reason === "changed"[\s\S]{0,200}await load\(\{ quiet: true, forceSheet: true \}\)/, "changed: read again and draw the sheet from it");
  assert.match(s, /function sheetReread\(force\) \{[\s\S]*?mv\.baseRev = plan\.rev;[\s\S]*?if \(force\) setMsg\(mv\.type === "done" \? V\.CHANGED_DONE_TEXT : V\.CHANGED_TEXT, "info"\);[\s\S]*?runPreview\(/,
    "the sheet drawn again: new rev, say so, preview again");
  assert.match(s, /if \(ok\) sheetReread\(!!opt\.forceSheet\);/, "every read of the mirror while a sheet is open draws it again when its plan moved on");
  assert.match(s, /mv\.timer = setTimeout\(runPreview, 300\)/, "the preview is debounced");
  assert.match(s, /seq !== mv\.seq\) return;/, "an older preview's answer is dropped");
  for (const m of s.matchAll(/\.innerHTML = ([^;]+);/g)) {
    const x = m[1].trim();
    assert.ok(/^(note \+ )?(emptyHtml|sheetShell|previewHtml|detailHtml|nowInner)\(|^note \+ \(state\.view|^'<|^"|^esc\(|^""$|^head \+|^html$/.test(x) || /^'<legend>/.test(x), "innerHTML = " + x.slice(0, 90));
  }
  assert.ok(!/insertAdjacentHTML|document\.write|outerHTML =/.test(s));
  // marketing and anyone who may not change the schedule get no action button (the database decides; this hides)
  assert.match(s, /function actionsHtml\(s, plan\) \{[\s\S]*?if \(editor\(\)\) \{/);
  assert.match(s, /T = \(v\) => esc\(safeText\(v\)\)/, "free text through the money masks, then escaped");
});

test("the service worker v6: the page, its styles and rules are kept for a cold start; the cache name is new", () => {
  const sw = read("sw.js");
  assert.match(sw, /^const CACHE = "dcr-portal2-v6";$/m);
  const shell = JSON.parse("[" + /const SHELL = \[([\s\S]*?)\];/.exec(sw)[1].replace(/\/\/[^\n]*/g, "").replace(/,\s*$/, "") + "]");
  for (const f of ["shoots.html", "css/shoots.css", "js/pages/shoots.js", "js/repo/photo.js", "js/map/photo.js", "js/map/shoots.js"]) assert.ok(shell.includes(f), f);
  assert.match(sw, /v6 \(the shoot schedule/);
});

test("the top bar: Shoot schedule for admins (until the database said no) and the photo team (once it said yes); never the agents account", () => {
  const has = (p) => navItems(p).some((i) => i.key === "shoots" && i.href === "shoots.html" && i.text === "Shoot schedule");
  for (const role of ["manager", "accountant", "lead", "field", "viewer"]) assert.equal(has({ role }), false, role + " (nothing heard yet)");
  assert.equal(has({ role: "admin" }), true, "an admin");
  assert.equal(has({ role: "agents" }), false);
  // the hint kept on this device (a stand-in localStorage)
  const box = new Map();
  globalThis.localStorage = { getItem: (k) => (box.has(k) ? box.get(k) : null), setItem: (k, v) => box.set(k, String(v)), removeItem: (k) => box.delete(k) };
  try {
    const field = { id: "u-field", role: "field", active: true };
    const admin = { id: "u-admin", role: "admin", active: true };
    assert.equal(photoHint(field), null);
    assert.equal(rememberPhotoAccess(field, { ready: true, canRead: true }), true, "the bar changes");
    assert.equal(box.get("dcr2:photoTeam:u-field"), "1");
    assert.equal(has(field), true, "on the team: the entry");
    assert.equal(rememberPhotoAccess(field, { ready: true, canRead: true }), false, "nothing new");
    assert.equal(rememberPhotoAccess(admin, { ready: false, canRead: false }), true, "a database without the schedule");
    assert.equal(has(admin), false, "an admin: no entry once the database said it has no schedule");
    rememberPhotoAccess(field, { ready: true, canRead: false });
    assert.equal(has(field), false, "off the team");
    assert.equal(showsShoots(Object.assign({}, field, { active: false })), false, "a turned-off account");
    const items = navItems(Object.assign({}, admin, { id: "u-admin-2" })).map((i) => i.key);
    assert.ok(items.indexOf("shoots") === items.indexOf("capture") + 1, "after Site Photos");
  } finally { delete globalThis.localStorage; }
  const c2 = read("js/common2.js");
  assert.match(c2, /const PHOTO_HINT = "dcr2:photoTeam:";/);
});

test("Home: the 📷 Shoot schedule card for admins and the photo team (photo_my_access through a dynamic import), its late / today badge; My Tasks: Open in shoot schedule", () => {
  const dash = code(read("js/shell/dashboard.js"));
  assert.match(dash, /\{ href: "shoots\.html", ic: "📷", tt: "Shoot schedule", id: "hmShoots", show: !!\(opts && opts\.photo\),/);
  assert.ok(!/^import [^\n]*(repo|map)\/(photo|shoots)\.js/m.test(dash), "no static import of the photo code on Home");
  assert.match(dash, /repo = await import\("\.\.\/repo\/photo\.js"\);\s*a = await repo\.myAccess\(\);/);
  assert.match(dash, /if \(rememberPhotoAccess\(p, a\)\)/);
  assert.match(dash, /if \(!a\.ready \|\| !a\.canRead\) return;\s*homeOpts\.photo = true;/);
  assert.match(dash, /photoCard\(p, homeOpts\);/);
  const tasks = code(read("js/pages/my-tasks.js"));
  assert.match(tasks, /import\("\.\.\/repo\/photo\.js"\)\.then\(function \(m\) \{ return m\.shootForTask\(t\.id\); \}\)/);
  assert.match(tasks, /'<a class="mt-photo" href="shoots\.html\?shoot=' \+ encodeURIComponent\(hit\.id\) \+ '">📷 Open in shoot schedule<\/a>'/);
  assert.match(tasks, /return !!\(t && t\.photo && S\.me && \(showsShoots\(S\.me\) \|\| photoHint\(S\.me\) === null\)\);/);
  assert.ok(read("my-tasks.html").includes(".mt-shootslot:not([hidden]){display:contents;}"));
});

test("the Access tab: the Photo team card writes ONLY through set_photo_team at the row's version; nothing in the site writes a photo table", () => {
  const ad = code(read("js/pages/admin.js"));
  assert.match(ad, /import \* as photo from "\.\.\/repo\/photo\.js";/);
  assert.match(ad, /await photo\.setTeam\(x\.id, pay\.next, pay\.version\)/);
  assert.match(ad, /e\.reason === "changed"[\s\S]{0,120}P\.say = PHOTO_CHANGED;\s*await loadPhoto\(\);/, "changed: read again and say so");
  assert.ok(!/photo_team/.test(ad), "no table named");
  const html = read("admin.html");
  assert.ok(html.includes('<div id="adPhoto" class="ad-photo" hidden></div>'));
  for (const f of ["js/pages/shoots.js", "js/pages/admin.js", "js/pages/my-tasks.js", "js/shell/dashboard.js", "js/repo/photo.js", "js/map/shoots.js", "js/map/access.js"]) {
    const s = code(read(f));
    assert.ok(!/from\("photo_(team|plans|shoots|changes)"\)\s*\.(insert|update|upsert|delete)/.test(s), f + ": no direct write");
  }
});

/* ── map/shoots.js ── */

test("the office computer's line: nothing while it runs; off, paused and not seen in plain words", () => {
  assert.equal(V.pcHeader(null), null);
  assert.equal(V.pcHeader({ online: true, paused: false, minutesAgo: 0, lastSeen: "x" }), null, "on: no line");
  assert.deepEqual(V.pcHeader({ online: false, paused: false, minutesAgo: 125, lastSeen: "x" }),
    { state: "off", text: "The office computer is off - changes wait until it is back on (last seen 2 h ago)", cls: "warn" });
  assert.equal(V.pcHeader({ online: true, paused: true, minutesAgo: 0, lastSeen: "x" }).text, "DCR Agents 2 is paused on the office computer - changes wait until it runs again");
  assert.equal(V.pcHeader({ online: false, paused: false, minutesAgo: null, lastSeen: null }).text, "The office computer has not been seen yet - changes wait until it is on");
  assert.equal(M.pcLine({ online: true, paused: true, minutesAgo: 1, lastSeen: "x" }).text, "DCR Agents 2 is paused on the office computer - changes wait until it runs again");
});

test("the address: ?shoot=, ?plan=, ?task=, ?view=, ?month= (anything else ignored); the page's own links", () => {
  assert.deepEqual(V.parseLink("?shoot=12"), { shoot: 12, plan: null, task: null, view: null, month: null, mine: false });
  assert.deepEqual(V.parseLink("?plan=3&view=month&month=2026-12"), { shoot: null, plan: 3, task: null, view: "month", month: "2026-12", mine: false });
  assert.deepEqual(V.parseLink("?task=88"), { shoot: null, plan: null, task: 88, view: null, month: null, mine: false });
  assert.deepEqual(V.parseLink("?shoot=0&plan=-1&task=x&view=evil&month=2026-13"), { shoot: null, plan: null, task: null, view: null, month: null, mine: false });
  assert.deepEqual(V.parseLink("?shoot=1e3"), { shoot: null, plan: null, task: null, view: null, month: null, mine: false });
  assert.equal(V.linkFor({ shoot: 12 }), "shoots.html?shoot=12");
  assert.equal(V.linkFor({ plan: 3, view: "job" }), "shoots.html?plan=3&view=job");
  assert.equal(V.linkFor({ view: "month", month: "2026-11" }), "shoots.html?view=month&month=2026-11");
  assert.equal(V.linkFor({}), "shoots.html");
});

const PLAN = M.toPlan({ id: 1, rev: 120, status: "active", project_code: "A000T9", project_label: "A000T9 Sample house", city: "Sandbox",
  photographer_name: "Jordan Field", photographer_source: "team", shoot_days: [0, 1, 2, 3, 4, 5], lead_days: 3,
  milestones: { framing_start: { date: "2026-11-19", source: "admin", confirmed: true }, delivery: { date: "2026-11-16", source: "estimate", confirmed: false },
    framing_complete: { date: null }, house_complete: { date: null } },
  series: [{ key: "framing-progress", name: "Framing progress", phase: "framing_progress", anchor: "framing_start", every: 7 }] });
const shoot = (o) => M.toShoot(Object.assign({ id: 5, plan_id: 1, key: "delivery", seq: 400, phase: "delivery", name: "Delivery day", anchor: "delivery",
  offset_days: 0, planned_date: "2026-11-16", window_days: 2, status: "planned", brief: {}, history: [] }, o));

test("a shoot's sheet: its day and grace, the history newest first, a closed shoot, the brief's safe fields", () => {
  assert.deepEqual(V.dayLine(shoot(), PLAN, TODAY), { day: "Mon Nov 16", window: "Up to 2 days later - until Wed Nov 18", late: false });
  assert.deepEqual(V.dayLine(shoot({ window_days: 0 }), PLAN, TODAY).window, "On the day");
  assert.deepEqual(V.dayLine(shoot({ planned_date: "2026-11-02" }), PLAN, TODAY).late, true);
  assert.deepEqual(V.dayLine(shoot({ planned_date: null, anchor: "house_complete" }), PLAN, TODAY), { day: "No date yet", window: "It waits for House complete to get a date", late: false });
  const s = shoot({ history: [
    { at: "2026-11-02T18:00:00Z", from: "2026-11-12", to: "2026-11-13", reason: "Crew asked", source: "shoot page", manual: true, by: "Jordan", change: 4 },
    { at: "2026-11-05T18:00:00Z", from: "2026-11-13", to: "2026-11-16", reason: "Rain $1,200 deposit", source: "admin", manual: true, by: "Avery" }] });
  const h = V.historyLines(s, TODAY);
  assert.deepEqual(h.map((x) => [x.when, x.text, x.meta]), [["Thu Nov 5", "Moved Fri Nov 13 → Mon Nov 16", "by Avery in the office"],
    ["Mon Nov 2", "Moved Thu Nov 12 → Fri Nov 13", "by Jordan on the shoot schedule"]]);
  assert.ok(!/\$|1,200/.test(h[0].reason), "the reason through the money masks: " + h[0].reason);
  assert.equal(V.doneLine(shoot({ status: "done", done_at: "2026-11-06T20:00:00Z", done_source: "shoot page", done_note: "All shots" }), TODAY), "Done Fri Nov 6 on the shoot schedule - All shots");
  assert.equal(V.doneLine(shoot({ status: "skipped", auto_skipped: true }), TODAY), "Skipped - its day had passed");
  assert.equal(V.doneLine(shoot(), TODAY), "");
  const b = V.briefSections(M.toShoot({ brief: { purpose: "The lot", time_of_day: "Morning", shots: [{ title: "Street", description: "From the curb", kind: "drone", priority: "must" }],
    tips: ["Level"], equipment: ["Wide lens"], safety: ["Hard hat"], caption_ideas: ["Day one"], drone: { needed: true, notes: "Check airspace" }, sample_shot: "A wide one" } }).brief);
  assert.deepEqual(b.map((x) => x.key), ["purpose", "time", "shots", "sample", "tips", "equipment", "safety", "captionIdeas", "drone"]);
  assert.deepEqual(b[2].lines[0], { title: "Street", text: "From the curb", tags: ["drone", "must have"] });
  assert.deepEqual(b[8].items, ["A drone is needed - Check airspace"]);
  assert.deepEqual(V.briefSections(M.toShoot({}).brief), []);
});

const ch = (o) => M.toChange(Object.assign({ id: 7, plan_id: 1, kind: "move_one", args: { shoot: "delivery", to: "2026-11-17" }, target_key: "delivery", status: "applied",
  requested_by: "u-pat", requested_at: "2026-11-08T17:00:00Z", done_at: "2026-11-08T17:02:00Z",
  result: { outcome: "applied", moved: [{ key: "delivery", from: "2026-11-16", to: "2026-11-17" }], words: "1 shoot moved" } }, o), new Date("2026-11-09T18:00:00Z"));
const PH = { admin: false, photographer: true, marketing: false, canEdit: true, canRead: true, ready: true };

test("the changes of a shoot: mine waiting, my recent ones, the Undo offered (mine within 7 days; an admin's anyone's; never done; never twice)", () => {
  const now = new Date("2026-11-09T18:00:00Z");
  const s = shoot();
  const later = ch({ id: 8, kind: "move_later", args: { shoot: "before-framing", to: "2026-11-20" }, target_key: "before-framing",
    result: { outcome: "applied", moved: [{ key: "before-framing" }, { key: "delivery" }] }, done_at: "2026-11-08T19:00:00Z" });
  const job = ch({ id: 9, kind: "milestone", args: { milestone: "delivery", date: "2026-11-20" }, target_key: null, status: "new", done_at: null, result: null, requested_at: "2026-11-09T17:00:00Z" });
  const other = ch({ id: 10, plan_id: 2 });
  assert.ok(V.touches(later, s) && V.touches(job, s) && V.touches(ch(), s) && !V.touches(other, s));
  assert.deepEqual(V.shootChanges([ch(), later, job, other], s).map((c) => c.id), [9, 8, 7]);
  assert.deepEqual(V.myOpen([ch(), later, job], s, "u-pat").map((c) => c.id), [9]);
  assert.deepEqual(V.recentMine([ch(), later, job], s, "u-pat", now).map((c) => c.id), [8, 7]);
  assert.equal(V.undoFor([ch(), later], s, "u-pat", PH, now).id, 8, "the newest undoable");
  assert.equal(V.undoFor([ch()], s, "u-sam", PH, now), null, "someone else's: not for a photographer");
  assert.equal(V.undoFor([ch()], s, "u-sam", Object.assign({}, PH, { admin: true }), now).id, 7, "an admin: anyone's");
  assert.equal(V.undoFor([ch({ kind: "done", args: { shoot: "delivery" } })], s, "u-pat", PH, now), null, "never done");
  assert.equal(V.undoFor([ch({ done_at: "2026-11-01T17:00:00Z" })], s, "u-pat", PH, now), null, "within 7 days");
  const waiting = ch({ id: 11, kind: "undo", args: { change: 7 }, status: "new", target_key: null, result: null, requested_at: "2026-11-09T17:30:00Z" });
  assert.equal(V.undoFor([ch(), waiting], s, "u-pat", PH, now), null, "an undo of it already waiting");
  assert.equal(V.undoFor([ch()], s, "u-pat", Object.assign({}, PH, { canEdit: false, photographer: false, marketing: true }), now), null, "marketing reads only");
});

test("the Move sheet: the days the database takes, the two weeks to pick from (non-shoot days marked), the notes, the office's approval, Apply's words", () => {
  assert.deepEqual(V.bounds("move_one", TODAY), { min: TODAY, max: addDays(TODAY, 365) });
  assert.deepEqual(V.bounds("milestone", TODAY), { min: addDays(TODAY, -60), max: addDays(TODAY, 365) });
  assert.equal(V.inBounds("move_later", "2026-11-08", TODAY), false, "yesterday");
  assert.equal(V.inBounds("milestone", "2026-11-08", TODAY), true, "a job date may be in the past");
  const strip = V.dayStrip("2026-11-16", { today: TODAY, kind: "move_one", shootDays: PLAN.shootDays, current: "2026-11-16", picked: "2026-11-18" });
  assert.equal(strip.length, 14);
  assert.deepEqual(strip.slice(0, 8).map((d) => d.wd + d.date + (d.shootDay ? "" : "*") + (d.current ? "=" : "") + (d.picked ? "!" : "")),
    ["Fri13", "Sat14", "Sun15*", "Mon16=", "Tue17", "Wed18!", "Thu19", "Fri20"]);
  assert.equal(V.dayStrip("2026-11-10", { today: TODAY, kind: "move_one", shootDays: [] })[0].day, TODAY, "never before today");
  assert.equal(V.dayStrip("2026-11-10", { today: TODAY, kind: "milestone", shootDays: [0] }).every((d) => d.shootDay), true, "a job date can be any day");
  assert.equal(V.dayStrip("x", { today: "bad", kind: "move_one" }).length, 0);
  assert.equal(V.nonShootNote("move_one", "2026-11-15", PLAN), "Sunday is not a shoot day (Monday to Saturday) - the shoot is kept on the day you pick");
  assert.equal(V.nonShootNote("move_one", "2026-11-16", PLAN), "");
  assert.equal(V.nonShootNote("milestone", "2026-11-15", PLAN), "");
  assert.equal(V.officeLine("framing_start"), "This job date (Framing start) is Firm - your change goes to the office to approve");
  assert.equal(V.needsOffice(PLAN, "framing_start", PH), true);
  assert.equal(V.needsOffice(PLAN, "framing_start", Object.assign({}, PH, { admin: true })), false, "an admin's applies");
  assert.equal(V.needsOffice(PLAN, "delivery", PH), false, "an estimate");
  assert.equal(V.applyLabel({ office: "x", refused: null }), "Send to the office");
  assert.equal(V.applyLabel({ office: null }), "Apply");
  // the three choices the sheet always asks (owner decision 2), the first preselected; the job dates, the shoot's own first
  const c = M.moveChoices(shoot(), PLAN);
  assert.deepEqual(c.map((x) => [x.kind, x.label, !!x.preselected]), [["move_one", "Only this shoot", true], ["move_later", "This shoot and the later ones", false],
    ["milestone", "The job date moved", false]]);
  assert.deepEqual(c[2].milestones.map((m) => m.key), ["delivery", "framing_start", "framing_complete", "house_complete"]);
});

test("after Apply, and when the office computer answered: the words", () => {
  assert.deepEqual(V.sentText({ id: 1, status: "new" }, { online: true, paused: false }), { text: "Sent - the office computer applies it in a minute or two.", kind: "ok" });
  assert.deepEqual(V.sentText({ id: 1, status: "new" }, { online: false, paused: false, minutesAgo: 90, lastSeen: "x" }), { text: "Sent - it waits until the office computer is back on.", kind: "info" });
  assert.equal(V.sentText({ needsOffice: true }, null).text, "Sent - the office computer passes it to the office to approve.");
  assert.equal(V.sentText({ again: true, status: "new", state: "new" }, null).text, "That change was sent already - it waits for the office computer.");
  assert.deepEqual(V.finishedText(ch()), { text: "Applied - 1 shoot moved", kind: "ok" });
  assert.deepEqual(V.finishedText(ch({ result: { outcome: "suggested", words: "Sent to the office: Framing start is Firm" } })),
    { text: "Sent to the office to approve: Framing start is Firm", kind: "info" }, "said once, not \"Sent to the office to approve: Sent to the office: …\"");
  assert.deepEqual(V.finishedText(ch({ status: "refused", result: null, error: { code: "past", message: "x" } })), { text: "Not done: That day has passed.", kind: "error" });
  assert.equal(V.finishedText(ch({ status: "new", result: null, requested_at: "2026-11-09T17:00:00Z" })), null, "still waiting");
  assert.equal(V.requestProblem({ reason: "changed" }), V.CHANGED_TEXT);
  assert.equal(V.CHANGED_TEXT, "Someone changed this job's shoots meanwhile - here is the new preview.");
  assert.equal(V.requestProblem({ reason: "pending" }), "A change of that shoot is already waiting for the office computer.");
  assert.equal(V.requestProblem({ reason: "firm" }, { milestone: "framing_start" }), "Framing start is Firm - only the office can set it back (move it instead and the office is asked).");
});

test("the lists: a row's facts, a plan's header, Home's badge (late first, a photographer's own plans when they have any)", () => {
  assert.deepEqual(V.rowFacts(shoot(), PLAN, TODAY), { day: "Mon Nov 16", wd: "Mon", date: 16, name: "Delivery day", job: "A000T9 Sample house", city: "Sandbox" });
  assert.equal(V.rowFacts(shoot({ planned_date: null }), PLAN, TODAY).day, "No date yet");
  const f = V.planFacts(PLAN);
  assert.equal(f.photographer, "Jordan Field (the photo team's default)");
  assert.equal(f.shootDays, "Shoots Monday to Saturday");
  assert.equal(f.statusText, "");
  assert.equal(V.planFacts(M.toPlan({ status: "review", open_suggestions: 2 })).statusText, "In review");
  assert.equal(V.planFacts(M.toPlan({ status: "active", open_suggestions: 2 })).suggestions, "2 suggestions waiting for the office");
  const plans = [Object.assign({}, PLAN, { photographerProfileId: "u-pat" }), M.toPlan({ id: 2, status: "active" }), M.toPlan({ id: 3, status: "archived" })];
  const shoots = [shoot({ id: 1, planned_date: "2026-11-02" }), shoot({ id: 2, plan_id: 2, planned_date: "2026-11-01" }), shoot({ id: 3, plan_id: 2, planned_date: TODAY }),
    shoot({ id: 4, plan_id: 3, planned_date: "2026-10-01" })];
  assert.deepEqual(V.homeBadge(plans, shoots, TODAY), { cls: "warn", text: "2 late", title: "2 shoots past their day and grace on every job", mine: false });
  assert.equal(V.homeBadge(plans, shoots, TODAY, { mine: "u-pat" }).text, "1 late", "the photographer's own plan");
  assert.deepEqual(V.homeBadge(plans, shoots.slice(2), TODAY), { cls: "", text: "1 today", title: "1 shoot today on every job", mine: false });
  assert.equal(V.homeBadge(plans, [], TODAY), null);
  assert.equal(V.monthInRange("2027-12", TODAY), true);
  assert.equal(V.monthInRange("2028-01", TODAY), false);
});

/* ── map/access.js: the Photo team ── */

const people = [
  { id: "u-ad", full_name: "Avery Admin", role: "admin", active: true },
  { id: "u-jo", full_name: "Jordan Field", role: "field", active: true },
  { id: "u-ri", full_name: "Riley Lead", role: "lead", active: true },
  { id: "u-ta", full_name: "Taylor Viewer", role: "viewer", active: true },
  { id: "u-sam", full_name: "Sam Former", role: "field", active: false },
  { id: "u-ag", full_name: "", role: "agents", active: true },
];
const member = (o) => M.toTeamMember(Object.assign({ photographer: false, marketing: false, default_photographer: false, google_email: null, version: 3 }, o));

test("the Photo team list: every active person (never the agents account), a turned-off member kept, the default first; admins never listed by themselves", () => {
  const team = [member({ profile_id: "u-ta", marketing: true, google_email: "taylor@example.com", profile: { full_name: "Taylor Viewer" } }),
    member({ profile_id: "u-jo", photographer: true, default_photographer: true, profile: { full_name: "Jordan Field" } })];
  const rows = A.photoPeople(people, team);
  assert.deepEqual(rows.map((x) => x.name), ["Jordan Field", "Taylor Viewer", "Avery Admin", "Riley Lead"]);
  assert.equal(rows.find((x) => x.id === "u-ad").row, null, "the admin is not on the list unless ticked");
  assert.equal(A.photoSummary(rows), "1 photographer · 1 on marketing · default photographer: Jordan Field");
  const kept = A.photoPeople(people, team.concat([member({ profile_id: "u-sam", photographer: true, profile: { full_name: "Sam Former", active: false } })]));
  assert.ok(kept.some((x) => x.id === "u-sam" && !x.active), "a turned-off member stays (to be taken off)");
});

test("the Photo team's gates: the first photographer is the default; the default stays until another is made it; its tick cannot go while others remain; the e-mail for marketing only", () => {
  const empty = [];
  const riley = { id: "u-ri", name: "Riley Lead", active: true, row: null };
  let ed = A.photoTick(A.photoStateOf(null), "photographer", true, { id: "u-ri", team: empty });
  assert.equal(ed.isDefault, true, "the first photographer");
  let g = A.photoGate(riley, ed, empty);
  assert.deepEqual(g.def, { on: true, disabled: true, note: A.FIRST_DEFAULT });
  assert.equal(g.dirty, true);
  const team = [member({ profile_id: "u-jo", photographer: true, default_photographer: true, name: "Jordan Field" })];
  ed = A.photoTick(A.photoStateOf(null), "photographer", true, { id: "u-ri", team });
  assert.equal(ed.isDefault, false, "a second photographer is not the default by himself");
  g = A.photoGate(riley, ed, team, { "u-jo": "Jordan Field" });
  assert.deepEqual(g.def, { on: false, disabled: false, note: "Now: Jordan Field - ticking it moves the default here." });
  const jordan = { id: "u-jo", name: "Jordan Field", active: true, row: team[0] };
  const two = team.concat([member({ profile_id: "u-ri", photographer: true })]);
  g = A.photoGate(jordan, A.photoStateOf(team[0]), two);
  assert.deepEqual(g.photographer, { on: true, disabled: true, note: A.PICK_DEFAULT_FIRST });
  assert.deepEqual(g.def, { on: true, disabled: true, note: A.KEEP_DEFAULT });
  assert.equal(A.photoPayload(jordan, Object.assign(A.photoStateOf(team[0]), { photographer: false }), two).problem, A.PICK_DEFAULT_FIRST);
  // alone, the default may go (the last photographer leaves none)
  const off = A.photoPayload(jordan, Object.assign(A.photoStateOf(team[0]), { photographer: false }), team);
  assert.deepEqual([off.problem, off.removing, off.version], [null, true, 3]);
  // the e-mail: marketing only, trimmed of every white space, lower case, Desktop 2's rule
  const taylor = { id: "u-ta", name: "Taylor Viewer", active: true, row: null };
  ed = A.photoTick(A.photoTick(A.photoStateOf(null), "marketing", true, { id: "u-ta", team }), "googleEmail", " Taylor.V@Example.COM\t", { id: "u-ta", team });
  const pay = A.photoPayload(taylor, ed, team);
  assert.deepEqual(pay, { next: { photographer: false, marketing: true, isDefault: false, googleEmail: "taylor.v@example.com" }, version: null, removing: false, problem: null });
  for (const bad of ["taylor@example", "tay lor@example.com", "a@b@c.com", "@example.com", "x".repeat(250) + "@e.co"]) {
    assert.equal(A.photoEmailProblem(bad), A.PHOTO_BAD_EMAIL, bad);
  }
  assert.equal(A.photoEmailProblem(""), null, "none yet is fine");
  assert.equal(A.photoGate(taylor, A.photoStateOf(null), team).email.disabled, true, "no Marketing tick: no e-mail");
  assert.equal(A.photoGate(taylor, ed, team).email.note, "");
  assert.equal(A.photoGate(taylor, A.photoTick(ed, "googleEmail", "", {}), team).email.note, "No Google e-mail yet");
  const mk = A.photoPayload(taylor, Object.assign({}, ed, { marketing: false, photographer: true }), team);
  assert.equal(mk.next.googleEmail, null, "Marketing off forgets the e-mail at the save");
  assert.equal(A.photoPayload(taylor, A.photoStateOf(null), team).problem, A.PHOTO_NO_TICK);
  // a turned-off person not on the team cannot be ticked
  g = A.photoGate({ id: "u-sam", name: "Sam Former", active: false, row: null }, A.photoStateOf(null), team);
  assert.ok(g.photographer.disabled && g.marketing.disabled && g.email.disabled);
  assert.equal(A.photoChanged(team[0], A.photoStateOf(team[0])), false);
  assert.equal(A.photoChanged(null, A.photoStateOf(null)), false);
});

test("the Photo team's refusals in words", () => {
  assert.equal(A.photoSaveProblem({ reason: "changed", code: "PT409" }), A.PHOTO_CHANGED);
  assert.equal(A.PHOTO_CHANGED, "Someone changed the photo team meanwhile, so nothing was saved. The list is read again - look and try again.");
  assert.equal(A.photoSaveProblem({ reason: "pick_default_first" }), A.PICK_DEFAULT_FIRST);
  assert.equal(A.photoSaveProblem({ reason: "bad_email" }), A.PHOTO_BAD_EMAIL);
  assert.equal(A.photoSaveProblem({ reason: "inactive" }), "A turned-off person cannot be added to the photo team.");
  assert.equal(A.photoSaveProblem({ missing: true, reason: "not_ready" }), "Not in the database yet. " + A.PHOTO_NOT_READY_TEXT);
  assert.equal(A.photoSaveProblem({ reason: "offline", retryable: true }), "No connection - nothing was saved. Try again when the connection is back.");
});
