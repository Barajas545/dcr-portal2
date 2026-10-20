#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the P3 task pages in the DEMO (development only).

     node tools/e2e-p3.mjs [--out <dir>] [--chrome <path>] [--shots all|none] [--roles a,b,c]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with M3's rules,
   made-up people; nothing goes to Supabase, the map tiles and the address search are answered in the
   page) and drives a local Chrome or Edge headless:

   - every role (admin, manager, accountant, lead, field, viewer): the home cards (My Tasks with its
     badge, Tasks on Map) and the top bar; My Tasks (the lists the role has: mine, a lead's crew,
     everyone's), a task opened, read-only for a viewer; the tasks map (Leaflet 1.9.4 from jsDelivr, the
     pins, the All Tasks sheet, "New task here" for those who may create); the project's Tasks tab;
     phone (390 px) and desktop, light and dark;
   - field on the phone: the reminder link (?task=) opens the shoot with its brief and shot list; a quick
     phrase sent (via portal, the client key); no signal: the words stay on the phone and the resend
     with the same key adds ONE note; Mark complete with a closing note (one transaction); a task
     finished elsewhere while it is open (Realtime) -> the notice shows the words typed; a task
     finished with no live event -> the database refuses the update ("already complete") and the words
     come back; a task handed to someone else -> "isn't on your list any more"; a new task from the
     office arrives without a reload;
   - lead: the crew's list grouped by person; a new task for Jordan from My Tasks -> one outbox row in
     the Access wording, taken by the push function's drain; the project tab's tick (complete_task) and
     untick (reopen), a note from the tab;
   - manager: the map's filters and person picker, a pin's sheet, "New task here", moving a pin by hand
     (set_project_location, manual);
   - Q3 in the pages: a field person and a viewer see on the project's Tasks tab (All) exactly the tasks given
     to them or made by them, the office every one; an amount typed into a task is masked for a field
     person (Q28, on screen);
   - the reminder link through the sign-in: signed out, my-tasks.html?task=<id> goes to the sign-in with
     ?next= and, signed in, opens that task;
   - phone reminders (Settings, an Android phone): off -> on (one push_subscriptions row, this person's),
     "Send me a test notice" -> "Sent to 1 device", the home page's switch says on, a new task from the lead
     -> the drain reaches this phone, off -> the row is gone; an iPhone in Safari gets "Add to Home Screen
     first" with the steps and no switch;
   - no Content-Security-Policy violation and no console error on any page.
   Screenshots (--shots all): p3_<page>_<role>_<light|dark>_<desktop|phone>.png into --out.
   Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p3")));
const SHOTS = arg("--shots", "all");
const ROLES = (arg("--roles", "admin,manager,accountant,lead,field,viewer")).split(",").filter(Boolean);
const VIEWS = { admin: ["Mine", "Everyone"], manager: ["Mine", "Everyone"], accountant: ["Mine", "Everyone"],
  lead: ["Mine", "My crew", "Everyone"], field: [], viewer: [] };
const CREATES = { admin: true, manager: true, accountant: true, lead: true, field: true, viewer: false };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = startServer(0);
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const { cdp, proc } = await launch(arg("--chrome"));
  const results = [];
  const shots = [];
  const pages = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail: detail === undefined ? "" : detail });
    process.stderr.write((ok ? "  ok   " : "  FAIL ") + name + (ok ? "" : " :: " + String(detail).slice(0, 300)) + "\n");
  };
  const attempt = async (name, fn, page) => {
    try { await fn(); } catch (e) {
      let where = "";
      if (page) {
        try { where = " @ " + await page.eval("location.href + ' :: ' + (document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(-700) : '')"); }
        catch (x) { where = " @ (page not answering: " + x.message + ")"; }
      }
      check(name, false, String(e && e.message || e).slice(0, 400) + where);
    }
  };
  const TOPBAR = "!!document.querySelector('.dcr2-topbar .p2-badge')";
  async function open(p, path, marker, ms) {
    await p.goto(base + path, 150);
    const here = "(location.pathname).indexOf(" + JSON.stringify(path.split("?")[0]) + ") === 0";
    await p.until(here + " && " + TOPBAR + (marker ? " && (" + marker + ")" : ""), ms || 12000);
  }
  async function signIn(p, key, next) {
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
    await p.goto(base + "/index.html" + (next ? "?next=" + encodeURIComponent(next) : ""), 150);
    await p.until("!!document.getElementById('loginForm') && !!window.DCR2Demo && !document.getElementById('loginFields').disabled", 8000);
    await p.eval("document.getElementById('email').value=" + JSON.stringify(key + "@demo.test") + ";document.getElementById('password').value='demo-password-1';" +
      "document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname) && " + TOPBAR, 10000);
  }
  const db = (p, expr) => p.eval("(() => { const R = DCR2Demo.engine.rows; return " + expr + "; })()");
  const click = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); if (!n) throw new Error('no ' + " + JSON.stringify(sel) + "); n.click(); return true; })()");
  const text = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); return n ? n.innerText : ''; })()");
  const setVal = (p, id, value) => p.eval("(() => { const i = document.getElementById(" + JSON.stringify(id) + "); i.focus(); i.value = " + JSON.stringify(value) +
    "; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  const modalOk = (p) => p.eval("(() => { const b = document.getElementById('dcrMoYes'); if (b) b.click(); return !!b; })()");

  /** A whole-page screenshot at the device's width (the map: the screen). */
  async function shoot(p, name, device, dark, full) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1280;
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    await sleep(300);
    const h = full === false ? (device === "phone" ? 844 : 900) : await p.eval("Math.max(" + (device === "phone" ? 844 : 900) + ", Math.min(4200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(450);
    const file = "p3_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: device === "phone" ? 844 : 900, deviceScaleFactor: 1, mobile: device === "phone" });
    await p.dark(false);
  }
  async function bothThemes(p, name, device, full) { await shoot(p, name, device, false, full); await shoot(p, name, device, true, full); }

  try {
    /* ── 0. a clean demo database ──────────────────────────────────────── */
    const a = await newPage(cdp, "setup", OUT); pages.push(a);
    await a.size(1280, 900, false);
    await a.goto(base + "/manifest.json", 50);
    await a.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");
    await signIn(a, "admin", "dashboard.html");
    const SANDBOX = await db(a, "R.projects.find(p => p.number === 'A267').id");
    const TASK = await db(a, "Object.fromEntries(R.tasks.map(t => [t.title, t.id]))");
    const PEOPLE = await a.eval("Object.fromEntries(DCR2Demo.people.map(p => [p.key, p.id]))");
    check("demo: tasks, notes, a shoot, a recurring task, an imported task", Object.keys(TASK).length >= 20 &&
      (await db(a, "R.tasks.some(t => t.agent_kind === 'photo') && R.tasks.some(t => t.agent_kind === 'recurring') && R.tasks.some(t => t.legacy_sp_id) && R.task_notes.length >= 8")));

    /* ── 1. every role: home, top bar, My Tasks, the map, the project's tab ── */
    for (const role of ROLES) {
      const p = await newPage(cdp, role, OUT); pages.push(p);
      await p.size(1280, 900, false);
      await attempt(role + ": the P3 pages", async () => {
        await signIn(p, role, "dashboard.html");
        await p.until("document.querySelectorAll('.hm-card').length > 2", 8000);
        await sleep(600);
        const cards = await p.eval("Array.from(document.querySelectorAll('.hm-card .tt')).map(n => n.childNodes[0].textContent)");
        const badge = await text(p, "#hmMyTasks .hm-badge");
        const sum = await p.eval("(async () => { const m = await import('/js/repo/tasks.js'); const t = await import('/js/map/tasks.js'); return t.badgeOf(t.summaryOf(await m.summary())); })()");
        check(role + ": home has My Tasks (badge '" + badge + "') and Tasks on Map", cards.includes("My Tasks") && cards.includes("Tasks on Map") &&
          (sum ? badge === sum.text : badge === ""), cards.join("|") + " / " + JSON.stringify(sum));
        const nav = await p.eval("Array.from(document.querySelectorAll('#dcr2Nav a')).map(a => a.textContent)");
        check(role + ": the top bar has My Tasks", nav.includes("My Tasks"), nav.join("|"));
        await bothThemes(p, "home_" + role, "desktop");

        // My Tasks, desk
        await open(p, "/my-tasks.html", "!document.getElementById('mtList').hasAttribute('aria-busy')");
        await sleep(400);
        const seg = await p.eval("Array.from(document.querySelectorAll('#mtSeg button')).map(b => b.textContent.replace(/ \\(\\d+\\)$/, ''))");
        check(role + ": My Tasks lists " + (VIEWS[role].length ? VIEWS[role].join(" / ") : "their own only"), JSON.stringify(seg) === JSON.stringify(VIEWS[role]), JSON.stringify(seg));
        const cardsN = await p.eval("document.querySelectorAll('.mt-card').length");
        const mineN = await p.eval("(async () => { const m = await import('/js/repo/tasks.js'); return (await m.list('mine')).length; })()");
        check(role + ": My Tasks shows the open tasks of its list (" + cardsN + ")", cardsN > 0 || mineN === 0, cardsN + " cards, mine " + mineN);
        await bothThemes(p, "mytasks_" + role, "desktop");
        if (cardsN > 0) {
          await click(p, ".mt-card .mt-open");
          await p.until("document.getElementById('mtDetail').classList.contains('open') && !!document.getElementById('mtDTitle')", 6000);
          const ro = await p.eval("({ compose: !!document.getElementById('mtCompose'), ro: !!document.getElementById('mtReadOnly'), complete: !!document.getElementById('mtComplete') })");
          check(role + ": a task opens beside the list" + (role === "viewer" ? ", read only (no update box, no Mark complete)" : ""),
            role === "viewer" ? (!ro.compose && ro.ro && !ro.complete) : true, JSON.stringify(ro));
          await bothThemes(p, "mytask_open_" + role, "desktop");
          await p.eval("document.getElementById('mtClose').click(); true");
        }

        // the tasks map, desk
        await open(p, "/tasks-map.html", "!!window.L && document.getElementById('tmCount').textContent !== '…'", 20000);
        await sleep(1500);
        const map = await p.eval("({ pins: document.querySelectorAll('.tm-pin').length, count: document.getElementById('tmCount').textContent, person: !document.getElementById('tmPerson').hidden," +
          " tiles: document.querySelectorAll('.leaflet-tile').length })");
        check(role + ": the map: Leaflet, demo tiles, pins by project (" + map.pins + "), the count", map.tiles > 0 && (map.pins > 0 || role === "viewer") && /^\d+$/.test(map.count), JSON.stringify(map));
        check(role + ": the person picker " + (VIEWS[role].length ? "offered" : "hidden (one's own list)"), map.person === !!VIEWS[role].length, JSON.stringify(map));
        await shoot(p, "map_" + role, "desktop", false, false);
        await shoot(p, "map_" + role, "desktop", true, false);
        if (map.pins > 0) {
          await p.eval("document.querySelector('#tmAddrList [data-act=pin]').click(); true");
          await p.until("document.getElementById('tmOver1').classList.contains('open')", 4000);
          const newHere = await p.eval("!document.getElementById('tmD1New').hidden");
          check(role + ": a pin's sheet; 'New task here' " + (CREATES[role] ? "offered" : "not offered"), newHere === CREATES[role], newHere);
          await shoot(p, "map_pin_" + role, "desktop", false, false);
          await p.eval("document.querySelector('#tmScroll [data-act=details]').click(); true");
          await p.until("document.getElementById('tmOver2').classList.contains('open')", 4000);
          await shoot(p, "map_task_" + role, "desktop", true, false);
          await p.eval("document.getElementById('tmD2Back').click(); document.getElementById('tmD1Close').click(); true");
        }

        // the project's Tasks tab, desk
        await open(p, "/project.html?id=" + SANDBOX + "&tab=tasks", "!!document.querySelector('#pane-tasks #tkBar') && document.querySelector('#pane-tasks #tkBar').children.length > 0");
        await sleep(400);
        const tab = await p.eval("({ add: !!document.getElementById('tkAddBtn'), rows: document.querySelectorAll('#pane-tasks tr.pt-row').length, ticks: document.querySelectorAll('#pane-tasks [data-tk]').length })");
        check(role + ": the project's Tasks tab (" + tab.rows + " open); New task " + (CREATES[role] ? "offered" : "not offered") + (role === "viewer" ? "; no tick" : ""),
          tab.add === CREATES[role] && (role !== "viewer" || tab.ticks === 0), JSON.stringify(tab));
        await bothThemes(p, "project_tasks_" + role, "desktop");

        // phone
        await p.size(390, 844, true);
        await open(p, "/my-tasks.html", "!document.getElementById('mtList').hasAttribute('aria-busy')");
        await sleep(300);
        await bothThemes(p, "mytasks_" + role, "phone");
        if (cardsN > 0 || (await p.eval("document.querySelectorAll('.mt-card').length")) > 0) {
          await click(p, ".mt-card .mt-open");
          await p.until("document.getElementById('mtDetail').classList.contains('open')", 6000);
          await sleep(300);
          const full = await p.eval("(() => { const r = document.getElementById('mtDetail').getBoundingClientRect(); return { w: Math.round(r.width), x: Math.round(r.left), inert: document.getElementById('mtListCol').hasAttribute('inert') }; })()");
          check(role + ": on the phone a task is the whole screen (the list inert behind it)", full.w === 390 && full.x === 0 && full.inert, JSON.stringify(full));
          await shoot(p, "mytask_open_" + role, "phone", false, false);
          await shoot(p, "mytask_open_" + role, "phone", true, false);
          await p.eval("document.getElementById('mtBack').click(); true");
          await sleep(400);
        }
        await open(p, "/tasks-map.html", "!!window.L && document.getElementById('tmCount').textContent !== '…'", 20000);
        await sleep(1200);
        await shoot(p, "map_" + role, "phone", false, false);
        await p.eval("document.getElementById('tmNavTasks').click(); true");
        await p.until("document.getElementById('tmOver1').classList.contains('open')", 4000);
        await sleep(400);
        await shoot(p, "map_all_" + role, "phone", false, false);
        await shoot(p, "map_all_" + role, "phone", true, false);
        await p.eval("document.getElementById('tmD1Close').click(); document.getElementById('tmNavProjects').click(); true");
        await sleep(500);
        await shoot(p, "map_projects_" + role, "phone", true, false);
        await open(p, "/project.html?id=" + SANDBOX + "&tab=tasks", "!!document.querySelector('#pane-tasks #tkBar') && document.querySelector('#pane-tasks #tkBar').children.length > 0");
        await sleep(300);
        await bothThemes(p, "project_tasks_" + role, "phone");
        await p.size(1280, 900, false);
      }, p);
    }

    /* ── 2. field on the phone: the reminder link, an update, no signal, complete ── */
    const f = pages.find((x) => x.name === "field");
    if (f) await attempt("field: the reminder link opens the shoot; a phrase sent; no signal keeps the words; one note per key; Mark complete", async () => {
      await f.size(390, 844, true);
      const shoot1 = TASK["Shoot the framing progress"];
      await open(f, "/my-tasks.html?task=" + shoot1, "document.getElementById('mtDetail').classList.contains('open') && !!document.getElementById('mtText')");
      const brief = await f.eval("({ heads: Array.from(document.querySelectorAll('.mt-bh')).map(h => h.textContent), shots: document.querySelectorAll('.mt-shot input').length, foot: /PV-A267-03/.test(document.getElementById('mtDScroll').innerText), chip: document.querySelector('.mt-dtop').innerText })");
      check("field: ?task= opens the shoot: its brief (WHEN, WHERE, SHOT LIST, TIPS), 4 shots to tick, no footer, the shoot chip", JSON.stringify(brief.heads) === JSON.stringify(["WHEN", "WHERE", "SHOT LIST", "TIPS"]) &&
        brief.shots === 4 && !brief.foot && /Shoot:/.test(brief.chip), JSON.stringify(brief));
      await f.eval("document.querySelectorAll('.mt-shot input')[1].click(); true");
      check("field: a ticked shot is kept on this phone (dcr2:taskShots:<profile>:<task>)", (await f.eval("localStorage.getItem('dcr2:taskShots:" + PEOPLE.field + ":" + shoot1 + "')")) !== null);
      await bothThemes(f, "shoot_brief_field", "phone", false);
      const n0 = await db(f, "R.task_notes.length");
      await f.eval("document.querySelector('[data-phrase=\"On site now\"]').click(); true");
      await click(f, "#mtSend");
      await f.until("/Saved/.test(document.getElementById('mtStatus').textContent)", 6000);
      const note = await db(f, "R.task_notes[R.task_notes.length - 1]");
      check("field: 'On site now' sent: one note, via portal, the client key kept as source_key", (await db(f, "R.task_notes.length")) === n0 + 1 && note.text === "On site now" &&
        note.via === "portal" && /^portal:p2-/.test(note.source_key || "") && note.created_by === PEOPLE.field, JSON.stringify(note));
      await shoot(f, "saved_field", "phone", false, false);
      // no signal: the words stay; the resend with the same key adds one note only
      await f.eval("DCR2Demo.setOffline(true); true");
      await setVal(f, "mtText", "Framing photos half done, the rest after lunch");
      await click(f, "#mtSend");
      await f.until("/No signal/.test(document.getElementById('mtStatus').textContent)", 6000);
      const kept = await f.eval("JSON.parse(localStorage.getItem('dcr2:taskDraft:" + PEOPLE.field + ":" + shoot1 + "'))");
      check("field: no signal — 'kept on this phone', the draft holds the words and the send's key", kept && kept.t === "Framing photos half done, the rest after lunch" && /^p2-/.test(kept.key || ""), JSON.stringify(kept));
      await shoot(f, "nosignal_field", "phone", false, false);
      await f.eval("DCR2Demo.setOffline(false); true");
      await sleep(600);
      await f.eval("(async () => { const m = await import('/js/repo/tasks.js'); await m.addNote({ id: " + shoot1 + " }, 'Framing photos half done, the rest after lunch', " + JSON.stringify(kept.key) + "); return true; })()");
      await click(f, "#mtSend");
      await f.until("/Saved/.test(document.getElementById('mtStatus').textContent)", 6000);
      const same = await db(f, "R.task_notes.filter(n => n.task_id === " + shoot1 + " && n.text === 'Framing photos half done, the rest after lunch').length");
      check("field: the answer was lost, the phone sends again with the same key: ONE note", same === 1, same);
      // Mark complete with a closing note: status and note together
      await f.eval("document.querySelector('[data-phrase=\"" + "Shoot done — photos uploaded" + "\"]').click(); true");
      await f.until("!!document.getElementById('dcrMoYes')", 4000);
      await shoot(f, "complete_dialog_field", "phone", false, false);
      await modalOk(f);
      await f.until("/is marked complete/.test(document.getElementById('mtNotice').innerText)", 6000);
      const t = await db(f, "R.tasks.find(t => t.id === " + shoot1 + ")");
      const last = await db(f, "R.task_notes.filter(n => n.task_id === " + shoot1 + ").pop()");
      check("field: Mark complete — done, with the closing note in the same step", t.status === "done" && t.completed_by === PEOPLE.field && last.text === "Shoot done — photos uploaded", JSON.stringify([t.status, last.text]));
      await bothThemes(f, "completed_field", "phone");
    }, f);

    if (f) await attempt("field: finished elsewhere (live) shows the words typed; refused by the database without a live event shows them too; handed away; a new task arrives live", async () => {
      await f.size(390, 844, true);
      const quiet = TASK["Measure the deck ledger"];
      await open(f, "/my-tasks.html?task=" + quiet, "document.getElementById('mtDetail').classList.contains('open') && !!document.getElementById('mtText')");
      await sleep(900);
      await setVal(f, "mtText", "South side measured too");
      await f.eval("DCR2Demo.engine.rpc({ uid: " + JSON.stringify(PEOPLE.manager) + " }, 'complete_task', { p_id: " + quiet + ", p_note: 'Finished from the office.' }); true");
      await f.until("/already complete/.test(document.getElementById('mtNotice').innerText)", 8000);
      const n1 = await text(f, "#mtNotice");
      check("live: finished elsewhere while open — closed, 'already complete', the words typed shown", /South side measured too/.test(n1) && !(await f.eval("document.getElementById('mtDetail').classList.contains('open')")), n1);
      await bothThemes(f, "finished_elsewhere_field", "phone");
      // no live event at all: the database refuses the update, the words come back
      const garage = TASK["Sheathing on the garage"];
      await open(f, "/my-tasks.html?task=" + garage, "document.getElementById('mtDetail').classList.contains('open') && !!document.getElementById('mtText')");
      await f.eval("(() => { const R = DCR2Demo.engine.rows; const t = R.tasks.find(x => x.id === " + garage + "); DCR2Demo.engine.applyOps([{ k: 'row', t: 'tasks', row: Object.assign({}, t, { status: 'done', version: t.version + 1 }) }]); return true; })()");
      await setVal(f, "mtText", "Garage sheathing finished");
      await click(f, "#mtSend");
      await f.until("/already complete/.test(document.getElementById('mtNotice').innerText)", 8000);
      const n2 = await text(f, "#mtNotice");
      check("refused: a note on a task done meanwhile (23514 'already complete') — nothing added, the words shown back", /Garage sheathing finished/.test(n2) &&
        (await db(f, "R.task_notes.filter(n => n.task_id === " + garage + " && /Garage sheathing finished/.test(n.text)).length")) === 0, n2);
      await shoot(f, "refused_field", "phone", false, false);
      // handed to someone else while open
      const permit = TASK["Pick up the permit card"];
      await open(f, "/my-tasks.html?task=" + permit, "document.getElementById('mtDetail').classList.contains('open')");
      await sleep(900);
      await f.eval("DCR2Demo.remoteEdit('tasks', " + permit + ", { assigned_to: " + JSON.stringify(PEOPLE.lead) + " }, 'manager'); true");
      await f.until("/isn't on your list/.test(document.getElementById('mtNotice').innerText)", 8000);
      check("live: handed to someone else (the 'no longer yours' tombstone) — closed, said kindly", true);
      // a new task from the office arrives without a reload
      const before = await f.eval("document.querySelectorAll('.mt-card').length");
      await f.eval("DCR2Demo.engine.insert({ uid: " + JSON.stringify(PEOPLE.manager) + " }, 'tasks', { project_id: " + SANDBOX + ", title: 'Demo: check the north wall blocking', priority: 'high', category: 'General Task', assigned_to: " + JSON.stringify(PEOPLE.field) + " }); true");
      await f.until("document.querySelectorAll('.mt-card').length === " + (before + 1) + " && /north wall blocking/.test(document.getElementById('mtList').innerText)", 8000);
      check("live: a new task from the office shows up by itself", true);
      await f.size(1280, 900, false);
    }, f);

    /* ── 3. lead: crew list, a new task for Jordan, the project tab ───────── */
    const l = pages.find((x) => x.name === "lead");
    if (l) await attempt("lead: the crew's list; a new task for Jordan (one outbox row, drained to phones); the project tab's tick, untick and a note", async () => {
      await open(l, "/my-tasks.html", "!document.getElementById('mtList').hasAttribute('aria-busy')");
      await l.eval("document.querySelector('#mtSeg [data-view=crew]').click(); true");
      await sleep(300);
      const groups = await l.eval("Array.from(document.querySelectorAll('.mt-grp .who')).map(n => n.textContent)");
      check("lead: My crew's tasks grouped by person, the lead first", /^You \(Riley Lead\)$/.test(groups[0] || "") && groups.includes("Jordan Field") && groups.includes("Pat Newhire"), groups.join("|"));
      await bothThemes(l, "mytasks_crew_lead", "desktop");
      const out0 = await db(l, "R.notifications_outbox.length");
      await click(l, "#mtNew");
      await l.until("!!document.getElementById('tkForm') && document.querySelectorAll('#tkAssign option').length > 2", 6000);
      await l.eval("(() => { const s = document.getElementById('tkAssign'); s.value = " + JSON.stringify(PEOPLE.field) + "; return true; })()");
      await setVal(l, "tkName", "Photograph the hold-downs");
      await setVal(l, "tkProject", await l.eval("(async () => { const m = await import('/js/repo/projects.js'); const P = await import('/js/map/projects.js'); const x = (await m.loadProjects()).find(p => p.internalIDNumber === 'A267'); return P.switcherLabel(x); })()"));
      await l.eval("document.getElementById('tkPri').value = 'urgent'; document.getElementById('tkCat').value = 'Photos & Video'; true");
      await shoot(l, "newtask_lead", "desktop", false);
      await click(l, "#tkGo");
      await l.until("!document.getElementById('tkOverlay')", 6000);
      const made = await db(l, "R.tasks.find(t => t.title === 'Photograph the hold-downs')");
      await sleep(800);
      const ob = await db(l, "R.notifications_outbox.slice(" + out0 + ")");
      check("lead: the new task for Jordan — on A267, urgent; ONE notice 'New Request - Photos & Video -  - Photograph the hold-downs' with the my-tasks.html?task= link",
        made && made.assigned_to === PEOPLE.field && made.project_id === SANDBOX && made.priority === "urgent" && ob.length === 1 &&
        ob[0].subject === "New Request - Photos & Video -  - Photograph the hold-downs" && ob[0].body.includes("my-tasks.html?task=" + made.id), JSON.stringify(ob));
      check("lead: the push function's drain took the notice (push_sent_at)", !!(ob[0] && ob[0].push_sent_at), JSON.stringify(ob[0] && ob[0].push_sent_at));
      // the project's tab: tick, untick, a note
      await open(l, "/project.html?id=" + SANDBOX + "&tab=tasks", "document.querySelectorAll('#pane-tasks tr.pt-row').length > 0");
      const insp = TASK["Schedule the framing inspection"];
      await l.eval("document.querySelector('#pane-tasks [data-tk=\"" + insp + "\"]').click(); true");
      await l.until("/Marked complete/.test(document.getElementById('tkMsg').textContent)", 6000);
      check("project tab: the tick completes it (complete_task)", (await db(l, "R.tasks.find(t => t.id === " + insp + ").status")) === "done");
      await l.eval("document.querySelector('#pane-tasks [data-tf=all]').click(); true");
      await l.until("!!document.querySelector('#pane-tasks [data-tk=\"" + insp + "\"]') && document.querySelector('#pane-tasks [data-tk=\"" + insp + "\"]').checked", 6000);
      await l.eval("document.querySelector('#pane-tasks [data-tk=\"" + insp + "\"]').click(); true");
      await l.until("/Open again/.test(document.getElementById('tkMsg').textContent)", 6000);
      check("project tab: unticking opens it again (a versioned PATCH)", (await db(l, "R.tasks.find(t => t.id === " + insp + ").status")) === "open");
      await l.eval("document.querySelector('#pane-tasks [data-open=\"" + insp + "\"]').click(); true");
      await l.until("!!document.querySelector('#pane-tasks [data-note]')", 4000);
      await setVal(l, "tkNote" + insp, "Inspector booked for 7:30");
      await l.eval("document.querySelector('#pane-tasks [data-send]').click(); true");
      await l.until("(DCR2Demo.engine.rows.task_notes.some(n => n.task_id === " + insp + " && n.text === 'Inspector booked for 7:30'))", 6000);
      check("project tab: a note from the open row (add_task_note)", true);
      await l.until("/Inspector booked/.test(document.getElementById('pane-tasks').innerText)", 6000);
      await bothThemes(l, "project_tasks_note_lead", "desktop");
    }, l);

    /* ── 4. manager: the map's filters, a pin's sheet, New task here, a pin moved by hand ── */
    const m = pages.find((x) => x.name === "manager");
    if (m) await attempt("manager: the map — filters and the person picker, New task here, a pin moved by hand (manual)", async () => {
      await open(m, "/tasks-map.html", "!!window.L && document.querySelectorAll('.tm-pin').length > 0", 20000);
      await sleep(1200);
      const all = Number(await text(m, "#tmCount"));
      await m.eval("document.querySelector('#tmChips [data-f=urgent]').click(); true");
      await sleep(400);
      const urgent = Number(await text(m, "#tmCount"));
      const dim = await m.eval("document.querySelectorAll('.tm-pin.dim').length");
      check("map: Urgent shows the urgent ones (" + urgent + " of " + all + "), other pins dimmed", urgent > 0 && urgent < all && dim > 0, urgent + "/" + all + " dim " + dim);
      await m.eval("document.querySelector('#tmChips [data-f=all]').click(); true");
      await m.eval("(() => { const s = document.getElementById('tmPerson'); s.value = " + JSON.stringify(PEOPLE.field) + "; s.dispatchEvent(new Event('change')); return true; })()");
      await sleep(400);
      const jordan = Number(await text(m, "#tmCount"));
      check("map: the person picker shows one person's tasks (" + jordan + ")", jordan > 0 && jordan < all, jordan);
      await m.eval("(() => { const s = document.getElementById('tmPerson'); s.value = 'all'; s.dispatchEvent(new Event('change')); return true; })()");
      await m.eval("Array.from(document.querySelectorAll('#tmAddrList [data-act=pin]')).find(b => /Test Way/.test(b.textContent)).click(); true");
      await m.until("document.getElementById('tmOver1').classList.contains('open') && !document.getElementById('tmD1New').hidden", 4000);
      await click(m, "#tmD1New");
      await m.until("!!document.getElementById('tkForm') && document.querySelectorAll('#tkAssign option').length > 2", 6000);
      check("map: New task here knows the project", /A267/.test(await text(m, "#tkWhere")), await text(m, "#tkWhere"));
      await m.eval("document.getElementById('tkAssign').value = " + JSON.stringify(PEOPLE.newhire) + "; true");
      await setVal(m, "tkName", "Stack the trusses by the north gate");
      await shoot(m, "map_newtask_manager", "desktop", false, false);
      await click(m, "#tkGo");
      await m.until("!document.getElementById('tkOverlay')", 6000);
      const t = await db(m, "R.tasks.find(x => x.title === 'Stack the trusses by the north gate')");
      check("map: the task is on A267 for Pat", t && t.project_id === SANDBOX && t.assigned_to === PEOPLE.newhire, JSON.stringify(t));
      // move the sandbox's pin by hand: drag it, then Save
      await m.until("document.getElementById('tmOver1').classList.contains('open')", 4000);
      const before = await db(m, "R.projects.find(p => p.id === " + SANDBOX + ")");
      await click(m, "#tmD1Move");
      await m.until("document.getElementById('tmPinCtl').style.display === 'flex'", 4000);
      await sleep(800);
      const at = await m.eval("(() => { const r = document.querySelector('.tm-pin[data-pin=\"" + SANDBOX + "\"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
      await m.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
      await m.call("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount: 1 });
      for (let i = 1; i <= 8; i++) await m.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x + i * 12, y: at.y + i * 6, button: "left", buttons: 1 });
      await m.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x + 96, y: at.y + 48, button: "left", clickCount: 1 });
      await sleep(300);
      await shoot(m, "map_movepin_manager", "desktop", false, false);
      await click(m, "#tmPinSave");
      await m.until("/Pin location saved/.test(document.getElementById('tmToast').textContent)", 6000);
      const after = await db(m, "R.projects.find(p => p.id === " + SANDBOX + ")");
      check("map: the pin moved by hand is the project's point now (set_project_location, manual; version up)",
        after.location_source === "manual" && (after.lat !== before.lat || after.lng !== before.lng) && after.version === before.version + 1, JSON.stringify([before.lat, before.lng, after.lat, after.lng, after.location_source]));
    }, m);

    /* ── 5. field may not move pins; a field person's new task is theirs ─── */
    if (f) await attempt("field: no Move Pin; New task here for themself or nobody", async () => {
      await f.size(1280, 900, false);
      await open(f, "/tasks-map.html", "!!window.L && document.querySelectorAll('.tm-pin').length > 0", 20000);
      await f.eval("document.querySelector('#tmAddrList [data-act=pin]').click(); true");
      await f.until("document.getElementById('tmOver1').classList.contains('open')", 4000);
      check("field: no Move Pin (only managers and admins place a project by hand)", await f.eval("document.getElementById('tmD1Move').hidden"));
      await click(f, "#tmD1New");
      await f.until("!!document.getElementById('tkForm') && document.querySelectorAll('#tkAssign option').length >= 2", 6000);
      const opts = await f.eval("Array.from(document.querySelectorAll('#tkAssign option')).map(o => o.textContent)");
      check("field: the form offers themself and 'Nobody yet' only (Q8)", opts.length === 2 && /\(you\)/.test(opts[0]) && /Nobody yet/.test(opts[1]), opts.join("|"));
      await shoot(f, "map_newtask_field", "desktop", true, false);
      await f.eval("document.getElementById('tkCancel').click(); true");
    }, f);

    /* ── 6. Q3 in the pages: the project's Tasks tab shows what the database lets each person read ── */
    for (const role of ["field", "viewer", "manager"]) {
      const p = pages.find((x) => x.name === role);
      if (!p) continue;
      await attempt(role + ": the project's Tasks tab (All) shows exactly the tasks this person reads (Q3)", async () => {
        await p.size(1280, 900, false);
        await open(p, "/project.html?id=" + SANDBOX + "&tab=tasks", "!!document.querySelector('#pane-tasks #tkBar') && document.querySelector('#pane-tasks #tkBar').children.length > 0");
        await p.eval("document.querySelector('#pane-tasks [data-tf=all]').click(); true");
        await sleep(400);
        const shown = await p.eval("Array.from(document.querySelectorAll('#pane-tasks [data-open]')).map(b => Number(b.getAttribute('data-open'))).sort((a, b) => a - b)");
        const me = PEOPLE[role];
        const want = await db(p, "R.tasks.filter(t => t.project_id === " + SANDBOX + (role === "manager" ? "" : " && (t.assigned_to === " + JSON.stringify(me) + " || t.created_by === " + JSON.stringify(me) + ")") +
          ").map(t => t.id).sort((a, b) => a - b)");
        const all = await db(p, "R.tasks.filter(t => t.project_id === " + SANDBOX + ").length");
        check(role + ": the project's Tasks tab (All) shows " + shown.length + " of the project's " + all + " tasks — " + (role === "manager" ? "every one" : "only theirs and the ones they made") + " (Q3)",
          JSON.stringify(shown) === JSON.stringify(want) && (role === "manager" ? shown.length === all : shown.length < all), JSON.stringify({ shown, want, all }));
      }, p);
    }
    if (f) await attempt("field: an amount typed into a task is masked on screen (Q28)", async () => {
      const hold = TASK["Order hold-downs ($1,240 at the yard)"];
      await open(f, "/my-tasks.html?task=" + hold, "document.getElementById('mtDetail').classList.contains('open') && !!document.getElementById('mtDTitle')");
      const shown = await text(f, "#mtDetail");
      check("field: the imported task's amount is masked on screen (Q28: no prices)", !/1,240/.test(shown) && /hold-downs/i.test(shown), shown.slice(0, 160));
    }, f);

    /* ── 7. the reminder link through the sign-in ─────────────────────────── */
    await attempt("deep link: signed out, my-tasks.html?task=<id> -> the sign-in with ?next= -> that task", async () => {
      const d = await newPage(cdp, "deeplink", OUT); pages.push(d);
      await d.size(390, 844, true);
      const id = TASK["Send this week's site photos to the office"];
      await d.goto(base + "/manifest.json", 50);
      await d.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
      await d.goto(base + "/my-tasks.html?task=" + id, 150);
      await d.until("/index\\.html/.test(location.pathname) && !!document.getElementById('loginForm') && !document.getElementById('loginFields').disabled", 10000);
      const next = await d.eval("new URLSearchParams(location.search).get('next')");
      check("deep link: signed out, the task link goes to the sign-in with ?next=my-tasks.html?task=" + id, next === "my-tasks.html?task=" + id, next);
      await d.eval("document.getElementById('email').value='field@demo.test';document.getElementById('password').value='demo-password-1';" +
        "document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
      await d.until("/my-tasks\\.html/.test(location.pathname) && document.getElementById('mtDetail').classList.contains('open') && !!document.getElementById('mtDTitle')", 12000);
      const t = await text(d, "#mtDTitle");
      check("deep link: signed in, the task opens by itself", /site photos/i.test(t) && (await d.eval("location.search")) === "?task=" + id, t);
      await shoot(d, "deeplink_field", "phone", false, false);
    });

    /* ── 7b. the P3 review's fixes (2026-10-20), as people meet them ─────── */
    if (f) await attempt("review: Mark complete on a task the office finished with no live event — 'already complete', the closing words kept once, the draft cleared", async () => {
      await f.size(390, 844, true);
      const made = await f.eval("DCR2Demo.engine.insert({ uid: " + JSON.stringify(PEOPLE.manager) + " }, 'tasks', { project_id: " + SANDBOX +
        ", title: 'Review: sheathing on the shed', category: 'General Task', assigned_to: " + JSON.stringify(PEOPLE.field) + " })");
      const id = Array.isArray(made) ? made[0].id : (made && made.data ? made.data[0].id : made.id);
      await open(f, "/my-tasks.html?task=" + id, "document.getElementById('mtDetail').classList.contains('open') && !!document.getElementById('mtText')");
      await sleep(700);
      // the office completes it; no live event reaches this phone
      await f.eval("(() => { const R = DCR2Demo.engine.rows; const t = R.tasks.find(x => x.id === " + id + "); DCR2Demo.engine.applyOps([{ k: 'row', t: 'tasks', row: Object.assign({}, t, { status: 'done', version: t.version + 1, completed_by: " +
        JSON.stringify(PEOPLE.manager) + ", completed_at: new Date().toISOString() }) }]); return true; })()");
      const words = "Shed sheathing finished, nails short by one box";
      await setVal(f, "mtText", words);
      await click(f, "#mtComplete");
      await f.until("!!document.getElementById('dcrMoYes')", 4000);
      await modalOk(f);
      await f.until("/already complete/.test(document.getElementById('mtNotice').innerText)", 8000);
      const n = await text(f, "#mtNotice");
      const kept = await db(f, "R.task_notes.filter(x => x.task_id === " + id + " && x.text === " + JSON.stringify(words) + ").map(x => [x.created_by, x.via])");
      const draft = await f.eval("localStorage.getItem('dcr2:taskDraft:" + PEOPLE.field + ":" + id + "')");
      check("review: completed elsewhere first — the page says 'already complete' (not 'is marked complete') and that the closing note was still added; ONE note, the field person's, via portal; no draft left",
        /was already complete/.test(n) && !/is marked complete/.test(n) && /closing note was still added/.test(n) && n.indexOf(words) !== -1 &&
        JSON.stringify(kept) === JSON.stringify([[PEOPLE.field, "portal"]]) && draft === null, JSON.stringify({ n, kept, draft }));
      await shoot(f, "final_complete_after_done_elsewhere_field", "phone", false, false);
      await f.size(1280, 900, false);
    }, f);

    const ad = pages.find((x) => x.name === "admin");
    if (ad) await attempt("review: the project's Tasks tab — an opened task's description wraps, the Updates heading and its count are styled, the panel spans the row; 44 px targets on a phone", async () => {
      const hold = TASK["Order hold-downs ($1,240 at the yard)"];
      const pid = await db(ad, "R.tasks.find(t => t.id === " + hold + ").project_id");
      const measure = "(() => { const d = document.querySelector('#pane-tasks .mt-desc'), h = document.querySelector('#pane-tasks .tk-notes .mt-h3'), n = h && h.querySelector('.mt-n');" +
        " const td = document.querySelector('#pane-tasks tr.pt-more td:last-child'), tbl = document.querySelector('#pane-tasks table.pt-tbl'), cs = (x) => x ? getComputedStyle(x) : {};" +
        " const lh = parseFloat(cs(d).lineHeight) || 20; const box = (x) => x ? (r => ({ w: Math.round(r.width), h: Math.round(r.height) }))(x.getBoundingClientRect()) : null;" +
        " return { ws: cs(d).whiteSpace, lines: d ? Math.round(d.getBoundingClientRect().height / lh) : 0, cut: d ? d.scrollWidth > d.clientWidth + 1 : true," +
        " tt: cs(h).textTransform, pill: cs(n).backgroundColor, cell: cs(td).backgroundColor, tdw: td ? Math.round(td.getBoundingClientRect().width) : 0, tblw: tbl ? Math.round(tbl.getBoundingClientRect().width) : 0," +
        " open: box(document.querySelector('#pane-tasks .pt-open')), tick: box(document.querySelector('#pane-tasks .pt-tick')), send: box(document.querySelector('#pane-tasks [data-send]'))," +
        " more: box(document.querySelector('#pane-tasks .pj-more')), add: box(document.getElementById('tkAddBtn')), hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth }; })()";
      for (const [w, phone] of [[390, true], [1280, false]]) {
        await ad.size(w, phone ? 844 : 900, phone);
        await open(ad, "/project.html?id=" + pid + "&tab=tasks", "document.querySelectorAll('#pane-tasks tr.pt-row').length > 0");
        await ad.eval("document.querySelector('#pane-tasks [data-open=\"" + hold + "\"]').click(); true");
        await ad.until("!!document.querySelector('#pane-tasks .mt-desc')", 4000);
        await sleep(300);
        const m = await ad.eval(measure);
        check("review: project tab at " + w + " px — the description wraps (pre-wrap, " + m.lines + " lines, nothing cut), UPDATES uppercase, the count pill visible, the panel spans the table",
          m.ws === "pre-wrap" && m.lines >= 2 && !m.cut && m.tt === "uppercase" && m.pill !== m.cell && m.tdw >= m.tblw - (phone ? 4 : 60) && !m.hscroll, JSON.stringify(m));
        if (phone) {
          const big = (b) => b && b.h >= 44;
          check("review: project tab on a 390 px phone — the task's title, the tick, Send update, Open in My Tasks and ＋ New task are 44 px tall at least",
            big(m.open) && big(m.tick) && m.tick.w >= 44 && big(m.send) && big(m.more) && big(m.add), JSON.stringify([m.open, m.tick, m.send, m.more, m.add]));
          await ad.eval("document.querySelector('#pane-tasks tr.pt-more').scrollIntoView({ block: 'center' }); true");
          await shoot(ad, "final_project_tab_imported_admin", "phone", false, false);
          await shoot(ad, "final_project_tab_imported_admin", "phone", true, false);
        } else {
          await shoot(ad, "final_project_tab_imported_admin", "desktop", false, false);
        }
      }
      // the shoot's brief (a long description with line breaks) on the phone, where it was one clipped line
      const shootT = TASK["Shoot the framing progress"];
      const spid = await db(ad, "R.tasks.find(t => t.id === " + shootT + ").project_id");
      await ad.size(390, 844, true);
      await open(ad, "/project.html?id=" + spid + "&tab=tasks", "document.querySelectorAll('#pane-tasks tr.pt-row').length > 0");
      await ad.eval("document.querySelector('#pane-tasks [data-tf=all]').click(); true");
      await ad.until("!!document.querySelector('#pane-tasks [data-open=\"" + shootT + "\"]')", 4000);
      await ad.eval("document.querySelector('#pane-tasks [data-open=\"" + shootT + "\"]').click(); true");
      await ad.until("!!document.querySelector('#pane-tasks .mt-desc')", 4000);
      const sd = await ad.eval(measure);
      check("review: the shoot's brief on the project tab (phone) is all there (" + sd.lines + " lines)", sd.ws === "pre-wrap" && sd.lines >= 3 && !sd.cut, JSON.stringify(sd));
      await ad.eval("document.querySelector('#pane-tasks tr.pt-more').scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); true");
      await shoot(ad, "final_project_tab_shoot_desc_admin", "phone", false, false);
      await ad.size(1280, 900, false);
    }, ad);

    if (f) await attempt("review: the new-task form on a phone does not open the keyboard by itself; with a mouse the name has the focus", async () => {
      await f.size(390, 844, true);
      await open(f, "/my-tasks.html", "!document.getElementById('mtList').hasAttribute('aria-busy')");
      await f.call("Page.bringToFront").catch(() => null);          // a background tab's timers run late
      await click(f, "#mtNew");
      await f.until("!!document.getElementById('tkForm')", 6000);
      await f.until("document.activeElement && document.activeElement !== document.body", 4000).catch(() => null);
      const ph = await f.eval("({ fine: matchMedia('(pointer: fine)').matches, active: document.activeElement && (document.activeElement.id || document.activeElement.tagName) })");
      check("review: phone (coarse pointer) — the sheet's title has the focus, not the Task name field", !ph.fine && ph.active === "tkTitle", JSON.stringify(ph));
      await shoot(f, "final_newtask_field", "phone", true, false);
      await f.eval("document.getElementById('tkCancel').click(); true");
      await f.size(1280, 900, false);
      await open(f, "/my-tasks.html", "!document.getElementById('mtList').hasAttribute('aria-busy')");
      await f.call("Page.bringToFront").catch(() => null);
      await click(f, "#mtNew");
      await f.until("!!document.getElementById('tkForm')", 6000);
      await f.until("document.activeElement && document.activeElement !== document.body", 4000).catch(() => null);
      const desk = await f.eval("({ fine: matchMedia('(pointer: fine)').matches, active: document.activeElement && document.activeElement.id })");
      check("review: desk (fine pointer) — straight into the Task name", desk.fine && desk.active === "tkName", JSON.stringify(desk));
      await f.eval("document.getElementById('tkCancel').click(); true");
    }, f);

    const ld = pages.find((x) => x.name === "lead");
    if (ld) await attempt("review: a lead with no open tasks of their own opens My Tasks on the crew's list (what the home badge counted), not everyone's", async () => {
      await ld.size(390, 844, true);
      const own = await db(ld, "R.tasks.filter(t => t.status === 'open' && t.assigned_to === " + JSON.stringify(PEOPLE.lead) + ").map(t => t.id)");
      for (const id of own) await ld.eval("DCR2Demo.remoteEdit('tasks', " + id + ", { assigned_to: " + JSON.stringify(PEOPLE.admin) + " }, 'manager'); true");
      await ld.eval("(() => { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (/^dcr2:myTasksView:/.test(k)) localStorage.removeItem(k); } return true; })()");
      await open(ld, "/dashboard.html", "document.querySelectorAll('.hm-card').length > 2");
      await sleep(700);
      const badge = await text(ld, "#hmMyTasks .hm-badge");
      await open(ld, "/my-tasks.html", "!document.getElementById('mtList').hasAttribute('aria-busy')");
      await sleep(300);
      const v = await ld.eval("({ on: (document.querySelector('#mtSeg [aria-pressed=true], #mtSeg .on') || {}).textContent || '', title: (document.getElementById('mtTitle') || {}).textContent || '' })");
      check("review: home badge '" + badge + "' (the crew's, or none) — My Tasks opens on My crew (" + v.on.trim() + "), not everyone's",
        (badge === "" || /crew/i.test(badge)) && /crew/i.test(v.on) && /crew/i.test(v.title) && !/Everyone/i.test(v.on + v.title), JSON.stringify({ badge, v }));
      await shoot(ld, "final_lead_no_own_tasks_default_view", "phone", false, false);
      for (const id of own) await ld.eval("DCR2Demo.remoteEdit('tasks', " + id + ", { assigned_to: " + JSON.stringify(PEOPLE.lead) + " }, 'manager'); true");
      await ld.size(1280, 900, false);
    }, ld);

    /* ── 8. phone reminders (Settings) against the demo's push function ──── */
    await attempt("phone reminders: on, a test notice, the home switch, a new task reaches the phone, off; iPhone in Safari", async () => {
      const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
      const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
      const ph = await newPage(cdp, "reminders", OUT); pages.push(ph);
      await ph.call("Emulation.setUserAgentOverride", { userAgent: ANDROID, platform: "Linux armv8l" });
      await ph.size(390, 844, true);
      await ph.goto(base + "/manifest.json", 50);
      await ph.eval("['dcr2-demo-push','dcr2-demo-push-permission'].forEach(k => localStorage.removeItem(k)); sessionStorage.removeItem('dcr2-push-key'); true");
      await signIn(ph, "field", "settings.html");
      const state = () => ph.eval("(document.getElementById('stPushBox') || { dataset: {} }).dataset.state || ''");
      await ph.until("['on','off','blocked','install','unsupported','not_configured','unknown'].includes((document.getElementById('stPushBox') || { dataset: {} }).dataset.state)", 15000);
      check("reminders: Settings shows the switch off at first", (await state()) === "off", await state());
      await ph.eval("document.querySelector('#stPushBox .pr-switch').click(); true");
      await ph.until("document.getElementById('stPushBox').dataset.state === 'on'", 10000);
      const rows = await db(ph, "R.push_subscriptions.filter(s => s.profile_id === " + JSON.stringify(PEOPLE.field) + ").map(s => s.device)");
      check("reminders: on — one push_subscriptions row, the field person's, named by device only", JSON.stringify(rows) === JSON.stringify(["Android (browser)"]) &&
        (await ph.eval("document.querySelector('#stPushBox .pr-switch').getAttribute('aria-checked')")) === "true", JSON.stringify(rows));
      await ph.until("!document.getElementById('prTest').disabled", 5000);
      await ph.eval("document.getElementById('prTest').click(); true");
      await ph.until("/Sent to|None of|did not/.test(document.getElementById('prMsg').textContent)", 8000);
      const msg = await text(ph, "#prMsg");
      check("reminders: 'Send me a test notice' — 'Sent to 1 device'", /^Sent to 1 device\./.test(msg), msg);
      await ph.eval("document.getElementById('stPushH').scrollIntoView({ block: 'start' }); window.scrollBy(0, -84); true");
      await shoot(ph, "reminders_on_field", "phone", false, false);
      await shoot(ph, "reminders_on_field", "phone", true, false);
      await open(ph, "/dashboard.html", "!!document.querySelector('#pushSlot .dcr2-push b')");
      check("reminders: the home page's switch says on", (await text(ph, "#pushSlot .dcr2-push b")) === "on", await text(ph, "#pushSlot"));
      // a new task from the lead reaches this phone (the demo's push function counts the devices it reaches)
      const lp = pages.find((x) => x.name === "lead");
      if (lp) {
        const ok0 = await db(ph, "(R.push_subscriptions.find(s => s.profile_id === " + JSON.stringify(PEOPLE.field) + ") || {}).last_ok_at || ''");
        const out0 = await db(lp, "R.notifications_outbox.length");
        await sleep(20);
        await lp.eval("(async () => { const m = await import('/js/repo/tasks.js'); const sb = await import('/js/sb.js'); const me = await sb.me(); await m.create({ title: 'Bring the chalk line', assignedTo: " + JSON.stringify(PEOPLE.field) + ", projectId: " + SANDBOX + " }, me); return true; })()");
        await lp.until("DCR2Demo.engine.rows.notifications_outbox.length === " + (out0 + 1) + " && !!DCR2Demo.engine.rows.notifications_outbox[" + out0 + "].push_sent_at", 8000);
        const pushed = await db(lp, "(() => { const o = R.notifications_outbox[" + out0 + "]; const t = R.tasks.find(x => x.id === o.task_id); return { to: o.to_profile_id, result: o.push_result, title: t && t.title, link: o.body.includes('https://portal.dcrframing.com/my-tasks.html?task=' + o.task_id) }; })()");
        await ph.until("((DCR2Demo.engine.rows.push_subscriptions.find(s => s.profile_id === " + JSON.stringify(PEOPLE.field) + ") || {}).last_ok_at || '') !== " + JSON.stringify(ok0), 8000);
        check("reminders: a new task from the lead — its notice (with the my-tasks.html?task= link) taken once by the page's drain and pushed to the field person's phone",
          pushed.to === PEOPLE.field && pushed.result === "claimed" && pushed.title === "Bring the chalk line" && pushed.link, JSON.stringify(pushed));
      }
      await open(ph, "/settings.html", "document.getElementById('stPushBox').dataset.state === 'on'");
      await ph.eval("document.querySelector('#stPushBox .pr-switch').click(); true");
      await ph.until("document.getElementById('stPushBox').dataset.state === 'off'", 10000);
      check("reminders: off — the row is gone", (await db(ph, "R.push_subscriptions.filter(s => s.profile_id === " + JSON.stringify(PEOPLE.field) + ").length")) === 0);
      // on again, then SIGN OUT: a shared phone must not keep showing this person's task titles (P3 review)
      await ph.eval("document.querySelector('#stPushBox .pr-switch').click(); true");
      await ph.until("document.getElementById('stPushBox').dataset.state === 'on'", 10000);
      const onAgain = await db(ph, "R.push_subscriptions.filter(s => s.profile_id === " + JSON.stringify(PEOPLE.field) + ").length");
      await ph.eval("document.getElementById('stSignOut').click(); true");
      await ph.until("/index\\.html/.test(location.pathname) && !!window.DCR2Demo", 10000);
      const afterOut = await db(ph, "R.push_subscriptions.filter(s => s.profile_id === " + JSON.stringify(PEOPLE.field) + ").length");
      const browserSub = await ph.eval("localStorage.getItem('dcr2-demo-push')");
      check("reminders: Sign out turns this phone off for the person — their row and the browser's subscription are gone", onAgain === 1 && afterOut === 0 && browserSub === null,
        JSON.stringify({ onAgain, afterOut, browserSub }));
      if (lp) {
        await lp.eval("DCR2Demo.engine.insert({ uid: " + JSON.stringify(PEOPLE.lead) + " }, 'tasks', { project_id: " + SANDBOX + ", title: 'After sign-out: sweep the slab', assigned_to: " + JSON.stringify(PEOPLE.field) + " }); true");
        const dr = await lp.eval("(async () => { const sb = await import('/js/sb.js'); return (await sb.sb().functions.invoke('push', { body: { op: 'drain' } })).data; })()");
        check("reminders: a new task for the signed-out person reaches no phone (drain: none)", dr && dr.notices >= 1 && dr.sent === 0 && dr.none >= 1, JSON.stringify(dr));
      }
      await ph.eval("window.DCR2DemoPush && DCR2DemoPush.reset(); true");
      // an iPhone in Safari: the Home Screen steps, no switch
      const ip = await newPage(cdp, "iphone", OUT); pages.push(ip);
      await ip.call("Emulation.setUserAgentOverride", { userAgent: IPHONE, platform: "iPhone" });
      await ip.size(390, 844, true);
      await signIn(ip, "lead", "settings.html");
      await ip.until("(document.getElementById('stPushBox') || { dataset: {} }).dataset.state === 'install'", 15000);
      const guide = await ip.eval("({ steps: document.querySelectorAll('#stPushBox .pr-guide li').length, guide: !document.querySelector('#stPushBox .pr-guide').hidden, sw: document.querySelector('#stPushBox .pr-switch').hidden })");
      check("reminders: an iPhone in Safari — 'Add to Home Screen first', 4 steps, no switch", guide.steps === 4 && guide.guide && guide.sw, JSON.stringify(guide));
      await ip.until("!document.getElementById('prTest').disabled", 5000);
      await ip.eval("document.getElementById('prTest').click(); true");
      await ip.until("/Sent to|None of|did not/.test(document.getElementById('prMsg').textContent)", 8000);
      const ipMsg = await text(ip, "#prMsg");
      check("reminders: an iPhone in Safari — the test notice's answer points to the Home Screen app, not to a switch 'above'",
        /Home Screen first/.test(ipMsg) && !/Turn them on above/.test(ipMsg), ipMsg);
      await ip.eval("document.getElementById('stPushH').scrollIntoView({ block: 'start' }); window.scrollBy(0, -84); true");
      await shoot(ip, "final_iphone_safari_test_notice_lead", "phone", false, false);
      await ip.eval("document.getElementById('stPushH').scrollIntoView({ block: 'start' }); window.scrollBy(0, -84); true");
      await shoot(ip, "reminders_iphone_lead", "phone", false, false);
    });

    /* ── 9. no security-policy violation, no console error ─────────────── */
    for (const p of pages) {
      const bad = p.log.filter((x) => /CSP-VIOLATION|Content Security Policy/i.test(x.text) || x.level === "exception" ||
        (x.level === "error" && !/favicon\.ico|net::ERR_ABORTED/.test(x.text + " " + (x.url || ""))));
      check(p.name + ": no CSP violation, no console error", !bad.length, bad.slice(0, 5).map((x) => x.level + " " + x.text.slice(0, 200) + " @ " + x.url).join(" | "));
    }
  } finally {
    try { proc.kill(); } catch (e) { /* */ }
    server.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results, shots: shots.length, out: OUT }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
