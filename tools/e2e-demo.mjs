#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the DEMO site (development only).

     node tools/e2e-demo.mjs [--out <dir>] [--chrome <path>] [--shots none|final] [--p2 checks|shots|none] [--p3 checks|shots|none]
                             [--p6 checks|shots|none] [--p5pm checks|shots|none] [--p5est checks|shots|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database, made-up data,
   nothing sent to Supabase or OpenStreetMap) and drives a local Chrome or Edge headless through
   every P1 flow, checking what the demo database holds afterwards (window.DCR2Demo.engine):

   - every role (admin, manager, manager with prices, accountant, lead, field, viewer) opens every P1
     page; what each may see and change (cards, New Project, Overview editing, the labor rate,
     the capture bar, Site Photos);
   - Board: a manager drags a card to another lane -> the status and exactly one status log line;
   - Overview: a field saves by itself with the version; someone else changes the same field while
     typing -> "changed … while you were typing" with "Use mine"; amounts masked without prices;
   - Log: a note; Journal (field): an entry saved by itself, a photo with its caption, filed under
     journal/<day> with the entry id; Files: "Stored in DCR";
   - Site Photos (field, with a GPS fix): nearest project, the pin upgraded to GPS, three photos in
     the same second through the upload queue -> three rows, one log line; offline then online;
   - Search, Log History, the journal report; the offline overlay; the install prompt; presence;
   - no Content-Security-Policy violation and no console error on any page;
   - screenshots (--shots final): sign-in, home, Board, project Overview / Log / Journal / Files, Site
     Photos and search, light and dark, 390 px phone and desktop: final_<page>_<theme>_<device>.png.

   The tabs share one browser profile (one demo database in localStorage, presence between tabs) and
   each signs in WITHOUT "keep me signed in", so each tab is its own person (sessionStorage).
   Then (--p2 checks, the default) the P2 timesheet walk, tools/e2e-p2.mjs, in its own browser and demo
   database (--p2 shots: with its screenshots into <out>/p2; --p2 none: P1 only); its checks are part of
   this summary ("P2: ..."). Then (--p3 checks, the default) the P3 task walk, tools/e2e-p3.mjs, the same
   way (--p3 shots: screenshots into <out>/p3; --p3 none: without it): "P3: ...". Then (--p6 checks, the
   default) the P6 walk, tools/e2e-p6.mjs (the DCR Agents 2 console, My Assistant, Assistants), the same way
   (--p6 shots: screenshots into <out>/p6): "P6: ...". Then (--p5pm checks, the default) the P5a Progress Chart walk,
   tools/e2e-p5a-pm.mjs, the same way (--p5pm shots: screenshots into <out>/p5pm): "P5a PM: ...". Then (--p5est checks,
   the default) the P5a estimates walk (the Estimate and Takeoffs tabs, the printed estimate, change order, material list
   and quote), tools/e2e-p5a-est.mjs (--p5est shots: screenshots into <out>/p5est): "P5a estimates: ...".

   Prints a JSON summary; exit code 1 when a check failed. */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e")));
const SHOTS = arg("--shots", "final");
const P2 = arg("--p2", "checks");
const P3 = arg("--p3", "checks");
const P6 = arg("--p6", "checks");
const P5PM = arg("--p5pm", "checks");
const P5EST = arg("--p5est", "checks");

/** A later phase's walk (tools/e2e-p2.mjs, e2e-p3.mjs, e2e-p6.mjs) as a child: -> its JSON summary, or {ok: false, error}. */
function runWalk(file, mode, sub) {
  return new Promise((done) => {
    const argv = [join(dirname(fileURLToPath(import.meta.url)), file), "--out", join(OUT, sub), "--shots", mode === "shots" ? "all" : "none"];
    if (arg("--chrome")) argv.push("--chrome", arg("--chrome"));
    const child = spawn(process.execPath, argv, { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("error", (e) => done({ ok: false, error: String(e && e.message || e) }));
    child.on("close", (code) => {
      try { done(JSON.parse(out.slice(out.indexOf("{")))); } catch (e) { done({ ok: false, error: "exit " + code + ": " + out.slice(-400) }); }
    });
  });
}

const ROLES = ["admin", "manager", "manager2", "accountant", "lead", "field", "viewer"];
const PRICES = { admin: true, manager: false, manager2: true, accountant: true, lead: false, field: false, viewer: false };
const WRITES_PROJECTS = { admin: true, manager: true, manager2: true };
const FILES = { admin: true, manager: true, manager2: true, accountant: true, lead: true, field: true, viewer: false };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = startServer(0);
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const { cdp, proc } = await launch(arg("--chrome"));
  const results = [];
  const shots = [];
  const pages = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail === undefined ? "" : detail }); };
  const attempt = async (name, fn, page) => {
    try { await fn(); } catch (e) {
      let where = "";
      if (page) {
        try { where = " @ " + await page.eval("location.href + ' :: ' + (document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(0, 240) : '')"); }
        catch (x) { where = " @ (page not answering: " + x.message + ")"; }
      }
      check(name, false, String(e && e.message || e).slice(0, 400) + where);
    }
  };
  const TOPBAR = "!!document.querySelector('.dcr2-topbar .p2-badge')";
  /** Navigate and wait until the page has booted (the top bar) and `marker` holds. */
  async function open(p, path, marker, ms) {
    await p.goto(base + path, 150);
    const here = "(location.pathname + location.search).indexOf(" + JSON.stringify(path.split("&")[0]) + ") === 0";
    await p.until(here + " && " + TOPBAR + (marker ? " && (" + marker + ")" : ""), ms || 12000);
  }
  // Every tab signs in WITHOUT "keep me signed in": its session lives in that tab's sessionStorage.
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
  const type = (p, id, value) => p.eval("(() => { const i = document.getElementById(" + JSON.stringify(id) + "); i.focus(); i.value = " + JSON.stringify(value) +
    "; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  const page = (name) => pages.find((x) => x.name === name);

  try {
    /* ── 0. a clean demo database ────────────────────────────────────── */
    const a = await newPage(cdp, "setup", OUT); pages.push(a);
    await a.size(1280, 860, false);
    await a.goto(base + "/manifest.json", 50);
    await a.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");
    await signIn(a, "admin", "dashboard.html");
    const PID = (await db(a, "R.projects.find(p => p.number === 'A267')")).id;
    check("demo: the sandbox project A267 is there", !!PID, PID);

    /* ── 1. every role, every P1 page ────────────────────────────────── */
    for (const role of ROLES) {
      const p = await newPage(cdp, role, OUT); pages.push(p);
      await p.size(1280, 860, false);
      await attempt(role + ": every P1 page", async () => {
        await signIn(p, role, "dashboard.html");
        await p.until("document.querySelectorAll('.hm-card').length > 2", 8000);
        const cards = await p.eval("Array.from(document.querySelectorAll('.hm-card .tt')).map(n => n.textContent)");
        check(role + ": home cards (Site Photos " + (FILES[role] ? "shown" : "hidden") + ")", cards.includes("Site Photos") === FILES[role] && cards.includes("Project Board"), cards.join("|"));
        await open(p, "/board.html", "document.querySelectorAll('.bd-card').length >= 3");
        check(role + ": Board (every job; the untouched imports shown at first, marked, after the own projects)",
          (await p.eval("Number(document.getElementById('bdOldCount').textContent)")) > 50 &&
          (await p.eval("document.getElementById('bdOldChip').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('.bd-card.dormant').length > 20")),
          await p.eval("document.getElementById('bdNote').textContent"));
        check(role + ": New Project " + (WRITES_PROJECTS[role] ? "offered" : "not offered"), (await p.eval("!document.getElementById('bdNewBtn').hidden")) === !!WRITES_PROJECTS[role]);
        check(role + ": cards " + (WRITES_PROJECTS[role] ? "drag" : "do not drag"), (await p.eval("!!document.querySelector('.bd-card[draggable=\"true\"]')")) === !!WRITES_PROJECTS[role]);
        await open(p, "/project.html?id=" + PID, "!!document.getElementById('ov_projectName')");
        check(role + ": Overview " + (WRITES_PROJECTS[role] ? "editable" : "read only"), (await p.eval("!document.getElementById('ov_projectName').disabled")) === !!WRITES_PROJECTS[role]);
        check(role + ": labor rate " + (PRICES[role] ? "shown (prices switch)" : "hidden (Q1: also a manager without the switch)"),
          (await p.eval("!!document.querySelector('[data-pkey=\"projectLaborRate\"], [data-key=\"projectLaborRate\"]')")) === PRICES[role]);
        await open(p, "/project.html?id=" + PID + "&tab=files", "!!document.querySelector('#pane-files .pj-crumb')");
        check(role + ": capture bar " + (FILES[role] ? "offered" : "not offered (view only)"), (await p.eval("!!document.getElementById('capPhoto')")) === FILES[role]);
        await open(p, "/search.html?q=A24", "!!document.querySelector('#seResults .se-item .se-title')");
        check(role + ": search A24 -> A024 first", /^A024/.test(await p.eval("document.querySelector('#seResults .se-item .se-title').textContent")));
        await open(p, "/logs.html", "document.querySelectorAll('#lgChips .lg-chip').length >= 5");
        await p.goto(base + "/report-journal.html?id=" + PID, 150);
        await p.until("!!document.getElementById('rpSheet') && document.getElementById('rpSheet').innerText.length > 20", 10000);
        await open(p, "/settings.html", "document.getElementById('stName').value.length > 0");
        await p.goto(base + "/capture.html", 2500);
        const cap = await p.eval("({ path: location.pathname, pick: !!document.querySelector('#pickBest [data-pick], #pickList [data-pick]'), refused: /not available for your role/.test(document.body.innerText) })");
        check(role + ": Site Photos " + (FILES[role] ? "opens" : "not for a view-only account"), FILES[role] ? cap.pick && !cap.refused : cap.refused && !cap.pick, JSON.stringify(cap));
      }, p);
    }

    /* ── 2. Board: a manager drags a card to another lane ─────────────── */
    const m = page("manager");
    await attempt("Board drag", async () => {
      await open(m, "/board.html", "document.querySelectorAll('.bd-card').length >= 3");
      const pick = await m.eval(`(() => {
        const cols = Array.from(document.querySelectorAll('.bd-col'));
        const from = cols.find(c => c.querySelector('.bd-card'));
        const to = cols.find(c => c !== from && c.getAttribute('data-status') !== from.getAttribute('data-status'));
        return { id: Number(from.querySelector('.bd-card').getAttribute('data-id')), from: from.getAttribute('data-status'), to: to.getAttribute('data-status') };
      })()`);
      const q = "R.projects.find(p => p.id === " + pick.id + ")";
      const before = await db(m, "({ v: " + q + ".version, n: R.activity.filter(a => a.project_id === " + pick.id + " && a.kind === 'status').length })");
      await m.eval(`(() => {
        const card = document.querySelector('.bd-card[data-id="${pick.id}"]');
        const col = document.querySelector('.bd-col[data-status="${pick.to}"] .bd-col-body') || document.querySelector('.bd-col[data-status="${pick.to}"]');
        const dt = new DataTransfer();
        card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        col.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        col.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
        return true; })()`);
      await m.until("DCR2Demo.engine.rows.projects.find(p => p.id === " + pick.id + ").status === " + JSON.stringify(pick.to), 6000);
      await sleep(400);
      const after = await db(m, "({ s: " + q + ".status, v: " + q + ".version, n: R.activity.filter(a => a.project_id === " + pick.id + " && a.kind === 'status').length })");
      check("Board drag (manager): the status written with the version, exactly one status log line", after.s === pick.to && after.v === before.v + 1 && after.n === before.n + 1,
        JSON.stringify({ pick, before, after }));
      check("Board drag: the card sits in its new lane", await m.eval(`!!document.querySelector('.bd-col[data-status="${pick.to}"] .bd-card[data-id="${pick.id}"]')`));
      const l = page("lead");
      await open(l, "/board.html", "document.querySelectorAll('.bd-card').length >= 3");
      await m.eval(`DCR2Demo.remoteEdit('projects', ${pick.id}, { status: ${JSON.stringify(pick.from)} }, 'admin'); true`);
      await l.until(`!!document.querySelector('.bd-col[data-status="${pick.from}"] .bd-card[data-id="${pick.id}"]')`, 8000);
      check("Board: another person's move shows up live in the lead's Board (no reload)", true);
    }, m);

    /* ── 3. Overview autosave and "changed by someone else" ───────────── */
    await attempt("Overview", async () => {
      await open(m, "/project.html?id=" + PID, "!!document.getElementById('ov_projectClientName') && !document.getElementById('ov_projectClientName').disabled");
      const q = "R.projects.find(p => p.id === " + PID + ")";
      const v0 = await db(m, q + ".version");
      await type(m, "ov_projectClientName", "Sandbox client (e2e)");
      await m.until("/Saved/.test(document.getElementById('pjMsg').textContent)", 6000);
      const row = await db(m, q);
      check("Overview: a field saves by itself, with the version (800 ms after the last key)", row.client_name === "Sandbox client (e2e)" && row.version === v0 + 1, row.client_name + " v" + row.version);
      await type(m, "ov_projectClientName", "Mine while typing");
      await m.eval("DCR2Demo.remoteEdit('projects', " + PID + ", { client_name: 'Theirs (admin)' }, 'admin'); true");
      await m.until("Array.from(document.querySelectorAll('[data-clash=\"projectClientName\"]')).some(n => !n.hidden)", 8000);
      const clash = await m.eval("document.querySelector('[data-clash=\"projectClientName\"]').textContent");
      check("Overview: the same field changed by someone else while typing -> theirs shown, \"Use mine\" offered", /while you were typing/.test(clash) && /Use mine/.test(clash), clash);
      check("Overview: nothing overwritten silently", (await db(m, q + ".client_name")) === "Theirs (admin)");
      await m.eval("document.querySelector('[data-clash=\"projectClientName\"] [data-mine]').click(); true");
      await m.until("DCR2Demo.engine.rows.projects.find(p => p.id === " + PID + ").client_name === 'Mine while typing'", 8000);
      check("Overview: \"Use mine\" saves mine on top of their version", true);
      await m.eval("DCR2Demo.remoteEdit('projects', " + PID + ", { status_note: 'Quoted $12,400 to the client' }, 'admin'); true");
      await open(m, "/project.html?id=" + PID, "!!document.getElementById('ov_estimateStatusDescription')");
      const note = await m.eval("({ v: document.getElementById('ov_estimateStatusDescription').value, d: document.getElementById('ov_estimateStatusDescription').disabled })");
      check("Overview: an amount in a note is masked for a manager without prices (Q28, display only)", /amount hidden/.test(note.v) && !/12,400/.test(note.v) && note.d, JSON.stringify(note));
      const p2 = page("manager2");
      await open(p2, "/project.html?id=" + PID, "!!document.getElementById('ov_estimateStatusDescription')");
      check("Overview: a manager given prices sees the amount", /12,400/.test(await p2.eval("document.getElementById('ov_estimateStatusDescription').value")));
      // live (no reload): a field drawn without an amount gains one from someone else -> masked at once,
      // read-only; it turns editable again when the amount is gone
      await m.eval("DCR2Demo.remoteEdit('projects', " + PID + ", { status_note: 'Waiting on plans', scope: 'Framing only' }, 'admin'); true");
      await open(m, "/project.html?id=" + PID, "document.getElementById('ov_estimateStatusDescription') && !document.getElementById('ov_estimateStatusDescription').disabled");
      await m.eval("DCR2Demo.remoteEdit('projects', " + PID + ", { status_note: 'Deposit $12,500 received from client', scope: 'Framing $8,900 + deck' }, 'admin'); true");
      await m.until("/amount hidden/.test(document.getElementById('ov_estimateStatusDescription').value)", 8000).catch(() => null);
      const live = await m.eval("(() => { const a = document.getElementById('ov_estimateStatusDescription'), b = document.querySelector('[data-key=\"checkScopeAndProjectFeatures\"]');" +
        " return { note: a.value, noteOff: a.disabled, scope: b ? b.value : '', scopeOff: b ? b.disabled : null }; })()");
      check("Overview: a live change that brings an amount is masked and read-only at once (no reload; Q28)",
        /amount hidden/.test(live.note) && live.noteOff && !/12,500|8,900/.test(live.note + live.scope) && (live.scopeOff !== false), JSON.stringify(live));
      await m.eval("DCR2Demo.remoteEdit('projects', " + PID + ", { status_note: 'Deposit received', scope: 'Framing + deck' }, 'admin'); true");
      await m.until("document.getElementById('ov_estimateStatusDescription').value === 'Deposit received' && !document.getElementById('ov_estimateStatusDescription').disabled", 8000).catch(() => null);
      check("Overview: the amount gone, the field is editable again", await m.eval("document.getElementById('ov_estimateStatusDescription').value === 'Deposit received' && !document.getElementById('ov_estimateStatusDescription').disabled"));
    }, m);

    /* ── 3b. presence: what a device says about itself is a label, never style or markup ─── */
    await attempt("Presence", async () => {
      await open(m, "/project.html?id=" + PID, "!!document.getElementById('pjHere')");
      const f = page("field");
      await f.eval("DCR2.sb().channel('presence:dcr', { config: { private: true } }).track({ user_id: DCR2Demo.people.find(x => x.key === 'field').id," +
        " name: 'Ada Admin', color: '#fff;position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647', view: 'project:" + PID + "', project: '" + PID + "', editing: true," +
        " since: new Date().toISOString() }); true");
      await m.until("document.querySelectorAll('#pjHere .pj-av').length > 0", 8000).catch(() => null);
      const av = await m.eval("(() => { const a = document.querySelector('#pjHere .pj-av'); if (!a) return null; const cs = getComputedStyle(a);" +
        " return { pos: cs.position, w: a.getBoundingClientRect().width, bg: a.style.background, title: a.title, top: document.elementFromPoint(innerWidth / 2, innerHeight / 2) === a }; })()");
      check("Presence: a colour that is not #rrggbb is never drawn (no full-screen overlay)", !!av && av.pos !== "fixed" && av.w < 80 && !av.top && !/fixed/.test(av.bg), JSON.stringify(av));
      check("Presence: a known person is named from profiles, not from what the device claims", !!av && !/Ada Admin/.test(av.title), av && av.title);
    }, m);

    /* ── 4. Log, Journal (field), Files ───────────────────────────────── */
    await attempt("Log", async () => {
      const l = page("lead");
      await open(l, "/project.html?id=" + PID + "&tab=log", "!!document.getElementById('lgText')");
      await l.eval("document.getElementById('lgText').value = 'Walk-through with the client (e2e)'; document.getElementById('lgSave').click(); true");
      await l.until("DCR2Demo.engine.rows.activity.some(a => a.project_id === " + PID + " && a.text === 'Walk-through with the client (e2e)' && a.kind === 'note')", 6000);
      await l.until("/Walk-through with the client \\(e2e\\)/.test(document.getElementById('pane-log').innerText)", 6000);
      check("Log: a lead adds a note; it is listed with the author", /Riley/.test(await l.eval("document.getElementById('pane-log').innerText")));
      const f = page("field");
      await open(f, "/project.html?id=" + PID + "&tab=log", "/Walk-through with the client/.test(document.getElementById('pane-log').innerText)");
      check("Log: field reads the log and is not offered the note box (database rule)", !(await f.eval("!!document.getElementById('lgText')")));
    }, page("lead"));

    let entryId = null;
    await attempt("Journal", async () => {
      const f = page("field");
      await open(f, "/project.html?id=" + PID + "&tab=journal", "!!document.getElementById('jrTitle')");
      await type(f, "jrTitle", "Walls up on the north side (e2e)");
      await type(f, "jrBody", "Framed the north wall; trusses tomorrow. Lumber was $1,240.");
      await f.until("(DCR2Demo.engine.rows.journal_entries || []).some(e => e.title === 'Walls up on the north side (e2e)')", 8000);
      const entry = await db(f, "R.journal_entries.find(e => e.title === 'Walls up on the north side (e2e)')");
      entryId = entry.id;
      check("Journal: field's entry saves by itself (Q4: own entries)", entry.project_id === PID && entry.created_by === (await f.eval("DCR2Demo.people.find(x => x.key === 'field').id")));
      check("Journal: \"Journal entry: <title>\" in the log", await db(f, "R.activity.some(a => a.project_id === " + PID + " && a.text === 'Journal entry: Walls up on the north side (e2e)')"));
      await f.eval(`(async () => {
        const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
        const g = c.getContext('2d'); g.fillStyle = '#8a6b3d'; g.fillRect(0, 0, 1200, 900); g.fillStyle = '#e8dcc4'; g.fillRect(100, 200, 1000, 80);
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
        const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.jpg', { type: 'image/jpeg' }));
        const i = document.getElementById('jrInput'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true }));
        return true; })()`);
      await f.until("DCR2Demo.engine.rows.files.some(r => r.folder === 'journal' && r.journal_entry_id === " + entryId + ")", 15000);
      const media = await db(f, "R.files.find(r => r.folder === 'journal' && r.journal_entry_id === " + entryId + ")");
      check("Journal: the photo goes up through the queue into journal/<entry day> with the entry id, a preview and source portal2",
        media.subpath === entry.entry_date && media.source === "portal2" && !!media.preview_path && /^IMG \d{4}-\d{2}-\d{2} /.test(media.name), JSON.stringify({ s: media.subpath, src: media.source, n: media.name }));
      const capBox = await f.eval("(() => { const n = document.querySelector('#jrPending .pj-jrn-cap'); return n ? (n.id || n.className || 'yes') : ''; })()");
      if (capBox) {
        await f.eval("(() => { const n = document.querySelector('#jrPending .pj-jrn-cap'); n.value = 'North wall, before sheathing'; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
      }
      await f.eval("document.getElementById('jrDone').click(); true");
      if (capBox) {
        await f.until("(DCR2Demo.engine.rows.files.find(r => r.folder === 'journal' && r.journal_entry_id === " + entryId + ") || {}).description === 'North wall, before sheathing'", 8000);
        check("Journal: the caption is kept as files.description", true);
      } else check("Journal: a caption box is offered for the photo", false, "no caption input in #jrPending");
      await f.until("/Walls up on the north side \\(e2e\\)/.test(document.getElementById('pane-journal').innerText)", 6000);
      check("Journal: the entry is listed", true);
      const l = page("lead");
      await open(l, "/project.html?id=" + PID + "&tab=journal", "/Walls up on the north side \\(e2e\\)/.test(document.getElementById('pane-journal').innerText)");
      const lt = await l.eval("document.getElementById('pane-journal').innerText");
      check("Journal: a lead (no prices) reads it with the amount masked", /amount hidden/.test(lt) && !/1,240/.test(lt), lt.slice(0, 200));
      check("Journal: a lead (no prices) cannot open an entry with an amount in the form (✎ refused)",
        await l.eval("(() => { const b = document.querySelector('[data-jrn-row=\"" + entryId + "\"] button[title*=\"amount hidden\"]'); return !!b && b.disabled; })()") &&
        !(await l.eval("!!document.querySelector('[data-jrn-edit=\"" + entryId + "\"]')")));
    }, page("field"));

    await attempt("Journal caption (manager)", async () => {
      // a caption with an amount, written by the field person: a manager without prices gets it as masked text, not an input
      const fid = await db(m, "R.files.find(x => x.folder === 'journal' && x.journal_entry_id === " + entryId + ").id");
      await m.eval("DCR2Demo.remoteEdit('files', " + fid + ", { description: 'Hold-downs from the yard, $1,240 cash' }, 'field'); true");
      await m.call("Page.bringToFront");
      await open(m, "/project.html?id=" + PID + "&tab=journal", "!!document.querySelector('[data-jrn-row=\"" + entryId + "\"]')");
      const capShown = await m.eval("(() => { const row = document.querySelector('[data-jrn-row=\"" + entryId + "\"]'); return { inputs: Array.from(row.querySelectorAll('.pj-jrn-cap')).map(i => i.value), text: row.innerText }; })()");
      check("Journal: a caption with an amount is masked text for a manager without prices (no editable box)",
        capShown.inputs.length === 0 && /amount hidden/.test(capShown.text) && !/1,240/.test(JSON.stringify(capShown)), JSON.stringify(capShown).slice(0, 200));
    }, m);

    /* ── 4b. Journal with no signal, and someone else's correction ─────── */
    await attempt("Journal offline", async () => {
      const f = page("field");
      await open(f, "/project.html?id=" + PID + "&tab=journal", "!!document.getElementById('jrTitle')");
      const before = await db(f, "R.journal_entries.filter(e => e.project_id === " + PID + " && !e.deleted_at).length");
      await f.eval("DCR2Demo.setOffline(true); true");
      await type(f, "jrTitle", "Offline entry (e2e)");
      await type(f, "jrBody", "Written with no signal.");
      await sleep(1200);
      await f.eval("document.getElementById('jrDone').click(); true");
      await sleep(1200);
      const kept = await f.eval("({ title: (document.getElementById('jrTitle') || {}).value, label: document.getElementById('jrAuto').textContent, msg: document.getElementById('jrMsg').textContent })");
      check("Journal: \"Finish\" with no signal keeps the entry on the phone (nothing cleared, nothing lost)",
        kept.title === "Offline entry (e2e)" && /kept on this device/.test(kept.label + kept.msg), JSON.stringify(kept));
      await f.eval("DCR2Demo.setOffline(false); window.dispatchEvent(new Event('online')); true");
      await f.until("DCR2Demo.engine.rows.journal_entries.some(e => e.title === 'Offline entry (e2e)')", 10000).catch(() => null);
      const after = await db(f, "R.journal_entries.filter(e => e.project_id === " + PID + " && !e.deleted_at).length");
      await f.until("!document.getElementById('jrTitle') || document.getElementById('jrTitle').value === ''", 6000).catch(() => null);
      check("Journal: back online it is saved and finished by itself (a fresh form)", after === before + 1 &&
        (await f.eval("document.getElementById('jrTitle').value === ''")), before + " -> " + after);
      // the phone keeps writing an entry; a lead corrects its write-up from the office; the phone types the weather
      await type(f, "jrTitle", "Shear walls (e2e)");
      await type(f, "jrBody", "Nailing at 6in edge, 12in field.");
      await f.until("DCR2Demo.engine.rows.journal_entries.some(e => e.title === 'Shear walls (e2e)')", 8000);
      const sid = await db(f, "R.journal_entries.find(e => e.title === 'Shear walls (e2e)').id");
      await f.eval("DCR2Demo.remoteEdit('journal_entries', " + sid + ", { body: 'Nailing at 4in edge, 12in field (lead: corrected spacing).' }, 'lead'); true");
      await type(f, "jrWx", "Clear, 78F");
      await f.until("(DCR2Demo.engine.rows.journal_entries.find(e => e.id === " + sid + ") || {}).weather === 'Clear, 78F'", 8000).catch(() => null);
      const row = await db(f, "R.journal_entries.find(e => e.id === " + sid + ")");
      check("Journal: someone else's correction of the same entry is kept (only the changed field is sent)",
        row.body === "Nailing at 4in edge, 12in field (lead: corrected spacing)." && row.weather === "Clear, 78F", JSON.stringify({ body: row.body, wx: row.weather }));
      await f.until("document.getElementById('jrBody').value.indexOf('lead: corrected') !== -1", 6000).catch(() => null);
      check("Journal: the form shows their correction", /lead: corrected/.test(await f.eval("document.getElementById('jrBody').value")));
      await f.eval("document.getElementById('jrDone').click(); true");
      await sleep(800);
    }, page("field"));

    await attempt("Files", async () => {
      const f = page("field");
      await open(f, "/project.html?id=" + PID + "&tab=files", "!!document.querySelector('#pane-files .pj-crumb')");
      const text = await f.eval("document.getElementById('pane-files').innerText");
      check("Files: the folders are listed", /Journal|Photos/.test(text), text.slice(0, 160));
      for (let k = 0; k < 2; k++) {
        await f.eval("(() => { const r = document.querySelector('#pane-files .pj-file[data-path]'); if (r) r.click(); return true; })()");
        await sleep(400);
      }
      const inner = await f.eval("document.getElementById('pane-files').innerText");
      check("Files: cloud rows say \"Stored in DCR\"", /Stored in DCR/.test(inner), inner.slice(0, 200));
    }, page("field"));

    /* ── 5. Site Photos with a GPS fix ─────────────────────────────────── */
    await attempt("Site Photos", async () => {
      const f = page("field");
      // a job of our own (an untouched old-portal import takes no automatic pin: checked below)
      const target = await db(f, "(() => { const ok = (x) => x.number !== 'A267' && x.lat !== null && x.location_source === 'geocode' && ['in_progress', 'approved'].includes(x.status) && !x.deleted_at;" +
        " const p = R.projects.find(x => ok(x) && (!x.legacy_sp_id || x.version > 1));" +
        " return { id: p.id, number: p.number, lat: p.lat, lng: p.lng }; })()");
      const dormantBefore = await db(f, "R.projects.filter(p => p.legacy_sp_id && p.version <= 1 && !p.deleted_at).length");
      await f.call("Page.bringToFront");            // a background tab never gets a position
      await cdp.send("Browser.grantPermissions", { origin: base, permissions: ["geolocation"] });
      await f.call("Emulation.setGeolocationOverride", { latitude: target.lat + 0.0002, longitude: target.lng - 0.0002, accuracy: 9 });
      await open(f, "/capture.html", "!!document.querySelector('#pickBest [data-pick]') && /Located/.test(document.getElementById('pickMsg').textContent)", 15000);
      const best = await f.eval("document.querySelector('#pickBest [data-pick]').getAttribute('data-pick')");
      check("Site Photos: the nearest open project comes first from the GPS fix", String(best) === String(target.id), best + " vs " + target.id + " " + target.number +
        " :: " + await f.eval("document.getElementById('pickMsg').textContent"));
      if (SHOTS === "final") shots.push(await f.shot("e2e_capture_pick.png"));
      await f.eval("document.querySelector('#pickBest [data-pick]').click(); true");
      await f.until("document.getElementById('stepConfirm').classList.contains('on') || document.getElementById('stepShoot').classList.contains('on')", 6000);
      if (await f.eval("document.getElementById('stepConfirm').classList.contains('on')")) await f.eval("document.getElementById('confirmYes').click(); true");
      await f.until("document.getElementById('stepShoot').classList.contains('on')", 6000);
      await f.until("DCR2Demo.engine.rows.projects.find(p => p.id === " + target.id + ").location_source === 'gps'", 6000).catch(() => null);
      const pin = await db(f, "R.projects.find(p => p.id === " + target.id + ")");
      check("Site Photos: standing on the site upgrades a guessed pin to GPS (write-once rule)", pin.location_source === "gps", pin.location_source);
      await sleep(4000);                            // the background geocoding of the visit has run by now
      const dormantAfter = await db(f, "R.projects.filter(p => p.legacy_sp_id && p.version <= 1 && !p.deleted_at).length");
      check("Site Photos: no untouched old-portal import is pinned (their version stays 1: Board fold, Desktop 2's dormant rule)",
        dormantAfter === dormantBefore, dormantBefore + " -> " + dormantAfter);
      const count = "DCR2Demo.engine.rows.files.filter(r => r.project_id === " + target.id + " && r.source === 'portal2').length";
      const n0 = await f.eval(count);
      await f.eval(`(async () => {
        const out = new DataTransfer();
        for (let k = 0; k < 3; k++) {
          const c = document.createElement('canvas'); c.width = 1000; c.height = 750;
          const g = c.getContext('2d'); g.fillStyle = ['#355e3b', '#5b7fa6', '#a0522d'][k]; g.fillRect(0, 0, 1000, 750);
          const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
          out.items.add(new File([blob], 'image.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
        }
        const i = document.getElementById('inPhoto'); i.files = out.files; i.dispatchEvent(new Event('change', { bubbles: true }));
        return true; })()`);
      await f.until(count + " >= " + (n0 + 3), 20000);
      const rows = await db(f, "R.files.filter(r => r.project_id === " + target.id + " && r.source === 'portal2').slice(-3)");
      check("Site Photos: three photos at once -> three rows in photos/<day>, distinct names, no versions, previews",
        rows.length === 3 && new Set(rows.map((r) => r.name)).size === 3 && rows.every((r) => r.folder === "photos" && /^\d{4}-\d{2}-\d{2}$/.test(r.subpath) && r.version_no === 1 && r.preview_path),
        JSON.stringify(rows.map((r) => [r.name, r.subpath, r.version_no])));
      const lines = await db(f, "R.activity.filter(a => a.project_id === " + target.id + " && /^Files uploaded to /.test(a.text)).length");
      check("Site Photos: one \"Files uploaded to <day>\" log line for them", lines === 1, lines);
      if (SHOTS === "final") shots.push(await f.shot("e2e_capture_done.png"));
      await f.eval("DCR2Demo.setOffline(true); true");
      await f.eval(`(async () => {
        const c = document.createElement('canvas'); c.width = 400; c.height = 300; c.getContext('2d').fillRect(0, 0, 400, 300);
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
        const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.jpg', { type: 'image/jpeg' }));
        const i = document.getElementById('inPhoto'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true }));
        return true; })()`);
      await sleep(1800);
      check("Site Photos offline: nothing reaches the database, the photo waits in IndexedDB dcr2Uploads",
        (await f.eval(count)) === n0 + 3 && await f.eval("import('/js/upload-queue2.js').then(q => q.list()).then(l => l.length >= 1)"));
      await f.eval("DCR2Demo.setOffline(false); true");
      await f.until(count + " >= " + (n0 + 4), 25000);
      check("Site Photos: back online, the waiting photo goes up by itself", true);
    }, page("field"));

    /* ── 6. Search, Log History, journal report ───────────────────────── */
    await attempt("Search / Log History / report", async () => {
      const l = page("lead");
      await open(l, "/search.html", "!!document.getElementById('seInput')");
      await sleep(300);
      await type(l, "seInput", "A267");
      await l.until("/A267/.test(document.getElementById('seResults').innerText)", 6000);
      check("Search: typing a number finds the project", true);
      await open(l, "/logs.html", "document.querySelectorAll('#lgChips .lg-chip').length >= 5");
      const chips = await l.eval("Array.from(document.querySelectorAll('#lgChips .lg-chip')).map(b => b.textContent.trim())");
      check("Log History: the Pacific-time windows", ["Today", "Yesterday", "This week"].every((w) => chips.some((c) => c.indexOf(w) === 0)), chips.join("|"));
      await l.until("/Walk-through with the client \\(e2e\\)/.test(document.getElementById('lgList').innerText)", 8000);
      check("Log History: today's lines with their project numbers", /A267/.test(await l.eval("document.getElementById('lgList').innerText")));
      await l.goto(base + "/report-journal.html?id=" + PID, 150);
      await l.until("/Walls up on the north side \\(e2e\\)/.test(document.getElementById('rpSheet').innerText)", 10000);
      check("Journal report: today's entry on the sheet", true);
    }, page("lead"));

    /* ── 7. offline overlay, install prompt ───────────────────────────── */
    await attempt("Offline / install", async () => {
      const v = page("viewer");
      await v.call("Page.bringToFront");
      await v.eval("DCR2Demo.setOffline(true); true");
      await v.goto(base + "/dashboard.html", 300);
      await v.until("!!document.getElementById('dcrOffline')", 15000);
      check("Offline: the overlay holds the page and the sign-in stays", await v.eval("!!document.getElementById('dcrOffline') && !!sessionStorage.getItem('dcr2-auth')"));
      await v.eval("DCR2Demo.setOffline(false); true");
      await open(v, "/dashboard.html", "document.querySelectorAll('.hm-card').length > 2");
      await v.eval(`(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = () => { window.__prompted = true; };
        e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); return true; })()`);
      await v.until("!!document.getElementById('dcr2InstallBtn') && getComputedStyle(document.getElementById('dcr2InstallBtn')).display !== 'none'", 3000);
      await v.eval("document.getElementById('dcr2InstallBtn').click(); true");
      check("Install: the browser's install prompt is offered and run from the button", await v.eval("!!window.__prompted"));
    }, page("viewer"));

    /* ── 8. presence: the colleagues and the Portal 2 label ───────────── */
    await attempt("Presence", async () => {
      const f = page("field");
      await open(f, "/project.html?id=" + PID, "!!document.getElementById('ov_projectName')");
      await open(m, "/project.html?id=" + PID, "!!document.getElementById('ov_projectName')");
      await m.until("Array.from(document.querySelectorAll('#dcr2Presence .dcr2-av')).some(n => /^Jordan/.test(n.title))", 8000);
      const t = await m.eval("Array.from(document.querySelectorAll('#dcr2Presence .dcr2-av')).map(n => n.title + (n.classList.contains('here') ? ' [here]' : '')).join(' | ')");
      check("Presence: a Portal 2 colleague on the same project is drawn ringed and named as Portal 2", /Jordan[^|]*in a project \(Portal 2\) \[here\]/.test(t), t);
    }, m);

    /* ── 9. screenshots: light and dark, phone and desktop ───────────── */
    if (SHOTS === "final") {
      await attempt("screenshots", async () => {
        const plan = [
          ["signin", null, "/index.html"], ["dashboard", "manager", "/dashboard.html"], ["board", "manager", "/board.html"],
          ["project-overview", "manager", "/project.html?id=" + PID], ["project-log", "manager", "/project.html?id=" + PID + "&tab=log"],
          ["project-journal", "field", "/project.html?id=" + PID + "&tab=journal"], ["project-files", "field", "/project.html?id=" + PID + "&tab=files"],
          ["capture", "field", "/capture.html"], ["search", "lead", "/search.html?q=A24"],
        ];
        for (const device of ["desktop", "phone"]) {
          const s = await newPage(cdp, "shots-" + device, OUT); pages.push(s);
          if (device === "phone") await s.size(390, 844, true); else await s.size(1366, 900, false);
          let who;
          for (const [name, role, path] of plan) {
            if (role !== who) {
              if (role) await signIn(s, role, "dashboard.html");
              else {
                await s.goto(base + "/manifest.json", 50);
                await s.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); true");
              }
              who = role;
            }
            for (const theme of ["light", "dark"]) {
              await s.dark(theme === "dark");
              await s.goto(base + path, 1800);
              if (name === "board") await s.until("document.querySelectorAll('.bd-card').length >= 3", 8000).catch(() => null);
              if (name === "capture") await s.until("!!document.querySelector('#pickBest [data-pick], #pickList [data-pick]')", 8000).catch(() => null);
              await sleep(500);
              shots.push(await s.shot("final_" + name + "_" + theme + "_" + device + ".png"));
              if (device === "phone") {
                const w = await s.eval("document.documentElement.scrollWidth");
                if (w > 391) check("phone: no horizontal scroll on " + name, false, w);
              }
            }
          }
        }
        check("screenshots taken", shots.length >= 36, shots.length);
      });
    }
  } finally {
    const all = pages.flatMap((p) => p.log.map((e) => Object.assign({ page: p.name }, e)));
    const csp = all.filter((e) => /CSP-VIOLATION|Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(e.text));
    const errors = all.filter((e) => (e.level === "error" || e.level === "exception") && !/CSP-VIOLATION/.test(e.text) &&
      !/ERR_INTERNET_DISCONNECTED|demo: offline|Failed to fetch|favicon\.ico/i.test(e.text));
    results.push({ name: "no Content-Security-Policy violation on any page", ok: csp.length === 0, detail: csp.slice(0, 20) });
    results.push({ name: "no console error or uncaught exception on any page", ok: errors.length === 0, detail: errors.slice(0, 20) });
    try { await cdp.send("Browser.close"); } catch (e) { /* */ }
    try { proc.kill(); } catch (e) { /* */ }
    server.close();
    await sleep(500);
    let p2shots = 0;
    if (P2 !== "none") {
      const p2 = await runWalk("e2e-p2.mjs", P2, "p2");
      if (Array.isArray(p2.results)) {
        p2.results.forEach((r) => results.push({ name: "P2: " + r.name, ok: !!r.ok, detail: r.detail }));
        p2shots = p2.shots || 0;
      } else {
        results.push({ name: "P2: the timesheet walk (tools/e2e-p2.mjs) ran", ok: false, detail: p2.error || "" });
      }
    }
    let p3shots = 0;
    if (P3 !== "none") {
      const p3 = await runWalk("e2e-p3.mjs", P3, "p3");
      if (Array.isArray(p3.results)) {
        p3.results.forEach((r) => results.push({ name: "P3: " + r.name, ok: !!r.ok, detail: r.detail }));
        p3shots = p3.shots || 0;
      } else {
        results.push({ name: "P3: the task walk (tools/e2e-p3.mjs) ran", ok: false, detail: p3.error || "" });
      }
    }
    let p6shots = 0;
    if (P6 !== "none") {
      const p6 = await runWalk("e2e-p6.mjs", P6, "p6");
      if (Array.isArray(p6.results)) {
        p6.results.forEach((r) => results.push({ name: "P6: " + r.name, ok: !!r.ok, detail: r.detail }));
        p6shots = p6.shots || 0;
      } else {
        results.push({ name: "P6: the console and assistants walk (tools/e2e-p6.mjs) ran", ok: false, detail: p6.error || "" });
      }
    }
    let p5pmShots = 0;
    if (P5PM !== "none") {
      const pm = await runWalk("e2e-p5a-pm.mjs", P5PM, "p5pm");
      if (Array.isArray(pm.results)) {
        pm.results.forEach((r) => results.push({ name: "P5a PM: " + r.name, ok: !!r.ok, detail: r.detail }));
        p5pmShots = pm.shots || 0;
      } else {
        results.push({ name: "P5a PM: the Progress Chart walk (tools/e2e-p5a-pm.mjs) ran", ok: false, detail: pm.error || "" });
      }
    }
    let p5estShots = 0;
    if (P5EST !== "none") {
      const es = await runWalk("e2e-p5a-est.mjs", P5EST, "p5est");
      if (Array.isArray(es.results)) {
        es.results.forEach((r) => results.push({ name: "P5a estimates: " + r.name, ok: !!r.ok, detail: r.detail }));
        p5estShots = es.shots || 0;
      } else {
        results.push({ name: "P5a estimates: the estimates walk (tools/e2e-p5a-est.mjs) ran", ok: false, detail: es.error || "" });
      }
    }
    const summary = { base, out: OUT, passed: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length,
      failures: results.filter((x) => !x.ok), results: results.map((r) => (r.ok ? "ok   " : "FAIL ") + r.name),
      screenshots: shots.length + p2shots + p3shots + p6shots + p5pmShots + p5estShots };
    console.log(JSON.stringify(summary, null, 1));
    process.exitCode = summary.failed ? 1 : 0;
  }
}

main().catch((e) => { console.error(e); process.exit(2); });
