#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the P6 pages in the DEMO (development only).

     node tools/e2e-p6.mjs [--out <dir>] [--chrome <path>] [--shots all|none] [--roles a,b,c]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with M6's rules and a
   made-up DCR server computer that answers the console and the chats - tools/fake/p6.js, pc-demo.js; nothing
   goes to Supabase) and drives a local Chrome or Edge headless:

   - every role (admin, manager, accountant, lead, field, viewer): the home cards (My Assistant with its badge
     for everyone; DCR Agents 2 with the server's dot and Assistants for an admin only); the console
     (agents-console.html: an admin's status bar and eleven tabs, anybody else only "Only an Admin can manage
     DCR Agents 2."); My Assistant (on for the admin, the lead and the field person, "ask the office" for the
     others); Assistants (assistant-admin.html: an admin's, refused for anybody else); phone (390 px) and
     desktop, light and dark;
   - admin, the console: every tab drawn from the made-up DCR server through the relay (console_request ->
     the PC takes it -> its answer read back with console_get, woken by Realtime on the admin's own rows);
     Pause everything asks the PC's own question, then the banner with Resume; nothing outside the page's
     own requests is read;
   - field, My Assistant on the phone: the six panels; a question answered live with a reminder card; a
     to-do added, ticked and deleted; the office's item only ticked; the briefing time and Spanish; a note
     the assistant keeps; no signal: the words stay with their client id and the resend is ONE message; a note
     from the office arrives live with the "1 new" badge, read when the chat is opened;
   - admin, Assistants: the list; a person whose chat the office may not read ("does not read"), turned on
     -> the chat shows; the office's to-do for the field person -> it reaches their open page live, "Added
     by the office", no Edit or Delete there; the manager's assistant turned on -> their open page changes
     from "ask the office" to their assistant without a reload;
   - no Content-Security-Policy violation and no console error on any page.
   Screenshots (--shots all): p6_<page>_<role>_<light|dark>_<desktop|phone>.png into --out.
   Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p6")));
const SHOTS = arg("--shots", "all");
const ROLES = (arg("--roles", "admin,manager,accountant,lead,field,viewer")).split(",").filter(Boolean);
const SHOT_ROLES = ["admin", "manager", "field", "viewer"];
const ASSISTANT_ON = { admin: true, lead: true, field: true };
const TABS = ["Dashboard", "Agents", "Timesheets", "Tasks", "Photo & Video", "Assistants", "Training", "Activity", "Replies", "People", "Settings"];

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
    const here = "(location.pathname).indexOf(" + JSON.stringify(path.split("?")[0].split("#")[0]) + ") === 0";
    await p.until(here + " && " + TOPBAR + (marker ? " && (" + marker + ")" : ""), ms || 15000);
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
  const modalOpen = (p) => p.eval("!!document.querySelector('.dcr-mo.open')");

  /** A whole-page screenshot at the device's width. */
  async function shoot(p, name, device, dark, full) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1280;
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    await sleep(350);
    const h = full === false ? (device === "phone" ? 844 : 900) : await p.eval("Math.max(" + (device === "phone" ? 844 : 900) + ", Math.min(4200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(450);
    const file = "p6_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: device === "phone" ? 844 : 900, deviceScaleFactor: 1, mobile: device === "phone" });
    await p.dark(false);
  }
  async function bothThemes(p, name, device, full) { await shoot(p, name, device, false, full); await shoot(p, name, device, true, full); }
  const consoleReady = "document.getElementById('cTabs').children.length > 0 && !document.querySelector('#cView .c-skel') && !document.querySelector('#cView .c-busy')";
  const gateShown = "!!document.querySelector('#cView .c-gate')";

  try {
    /* ── 0. a clean demo database ──────────────────────────────────────── */
    const a = await newPage(cdp, "setup", OUT); pages.push(a);
    await a.size(1280, 900, false);
    await a.goto(base + "/manifest.json", 50);
    await a.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");
    await signIn(a, "admin", "dashboard.html");
    const PEOPLE = await a.eval("Object.fromEntries(DCR2Demo.people.map(p => [p.key, p.id]))");
    check("demo: four made-up assistants (three on), their chats, items and notes; the made-up DCR server reports",
      (await db(a, "R.assistant_profiles.length === 4 && R.assistant_profiles.filter(p => p.is_on).length === 3 && R.assistant_messages.length >= 10 && R.assistant_items.length >= 8")) &&
      (await a.eval("(async () => { const m = await import('/js/repo/agents.js'); const s = await m.serverStatus(); return s.ready === true && s.server.consoleOn === true; })()")));

    /* ── 1. every role: home, the console, My Assistant, Assistants ────── */
    for (const role of ROLES) {
      const p = await newPage(cdp, role, OUT); pages.push(p);
      await p.size(1280, 900, false);
      const shots4 = SHOT_ROLES.includes(role);
      await attempt(role + ": the P6 pages", async () => {
        await signIn(p, role, "dashboard.html");
        await p.until("document.querySelectorAll('.hm-card').length > 2", 8000);
        await sleep(900);
        const cards = await p.eval("Array.from(document.querySelectorAll('.hm-card .tt')).map(n => n.childNodes[0].textContent)");
        const badge = await text(p, "#hmMyAssistant .hm-badge");
        const want = await p.eval("(async () => { const r = await import('/js/repo/assistant.js'); const m = await import('/js/map/assistant.js'); return m.assistantBadge(await r.page({ summary: true })); })()");
        const admin = role === "admin";
        check(role + ": home has My Assistant (badge '" + badge + "')" + (admin ? ", DCR Agents 2 and Assistants" : ", not DCR Agents 2 nor Assistants"),
          cards.includes("My Assistant") && cards.includes("DCR Agents 2") === admin && cards.includes("Assistants") === admin &&
          (want ? badge === want.text : badge === ""), cards.join("|") + " / " + JSON.stringify(want));
        if (admin) {
          await p.until("!!document.querySelector('#hmAgentsConsole .hm-dot')", 6000);
          check("admin: the DCR Agents 2 card's dot is the server's pulse (green)", await p.eval("document.querySelector('#hmAgentsConsole .hm-dot').classList.contains('ok')"));
        }
        if (shots4) { await bothThemes(p, "home_" + role, "desktop"); }

        // the console
        await open(p, "/agents-console.html", admin ? consoleReady : gateShown, 20000);
        await sleep(admin ? 1200 : 400);
        if (admin) {
          const st = await p.eval("({ status: document.getElementById('cStatusText').textContent, dot: document.getElementById('cDot').className, tabs: Array.from(document.querySelectorAll('#cTabs .c-tab')).map(t => t.textContent), banners: document.getElementById('cBanners').textContent })");
          check("admin: the console's status bar (the DCR server, online) and its eleven tabs", /DCR server DCR-OFFICE-PC#agents2/.test(st.status) && /good/.test(st.dot) &&
            JSON.stringify(st.tabs) === JSON.stringify(TABS) && st.banners === "", JSON.stringify(st));
        } else {
          const gate = await text(p, "#cView .c-gate");
          const calls = await db(p, "R.agents_console.filter(r => r.admin_id === " + JSON.stringify(PEOPLE[role]) + ").length");
          check(role + ": the console says 'Only an Admin can manage DCR Agents 2.' and asks the DCR server nothing", /Only an Admin can manage DCR Agents 2\./.test(gate) && calls === 0 &&
            (await p.eval("document.getElementById('cTabs').hidden && document.getElementById('cStatus').hidden")), gate);
        }
        if (shots4) await bothThemes(p, "console_" + role, "desktop", !admin ? false : undefined);

        // My Assistant
        await open(p, "/my-assistant.html", "!!document.getElementById('maTitle') && document.getElementById('maSub').textContent !== 'Loading your assistant…' && document.getElementById('maTitle').textContent !== 'My assistant' || !!document.querySelector('#maBanner .ma-empty')", 15000);
        await sleep(900);
        if (ASSISTANT_ON[role]) {
          const tabs = await p.eval("Array.from(document.querySelectorAll('#maTabs [data-tab]')).map(b => b.dataset.tab)");
          check(role + ": My Assistant is on: the six panels", JSON.stringify(tabs) === JSON.stringify(["today", "tomorrow", "week", "chat", "items", "me"]), JSON.stringify(tabs));
        } else {
          const off = await text(p, "#maBanner");
          check(role + ": My Assistant says it is not turned on yet (ask the office)", /isn’t turned on yet — ask the office/.test(off), off);
        }
        if (shots4) await bothThemes(p, "myassistant_" + role, "desktop");

        // Assistants (the office's page)
        await p.goto(base + "/assistant-admin.html", 150);
        if (admin) {
          await p.until(TOPBAR + " && document.querySelectorAll('#aaList .aa-row').length > 0", 15000);
          const n = await p.eval("document.querySelectorAll('#aaList .aa-row').length");
          const people = await db(p, "R.profiles.filter(x => x.role !== 'agents' && x.active).length");
          check("admin: Assistants lists everyone who could have one (" + n + "), never the agents account", n === people, n + " / " + people);
        } else {
          await p.until("!!document.querySelector('.dcr-mo.open')", 10000);
          const refusal = await text(p, ".dcr-mo.open");
          check(role + ": Assistants is refused ('not available for your role')", /not available for your role/.test(refusal), refusal);
          if (shots4) await shoot(p, "assistants_refused_" + role, "desktop", false, false);
          await modalOk(p);
          await p.until("/dashboard\\.html/.test(location.pathname)", 8000);
        }
        if (shots4 && admin) await bothThemes(p, "assistants_" + role, "desktop");

        // phone
        if (shots4) {
          await p.size(390, 844, true);
          await open(p, "/dashboard.html", "document.querySelectorAll('.hm-card').length > 2");
          await sleep(700);
          await bothThemes(p, "home_" + role, "phone");
          await open(p, "/agents-console.html", admin ? consoleReady : gateShown, 20000);
          await sleep(admin ? 1200 : 300);
          await bothThemes(p, "console_" + role, "phone");
          await open(p, "/my-assistant.html", "document.getElementById('maSub').textContent !== 'Loading your assistant…' || !!document.querySelector('#maBanner .ma-empty')", 15000);
          await sleep(900);
          await bothThemes(p, "myassistant_" + role, "phone");
          if (admin) {
            await open(p, "/assistant-admin.html", "document.querySelectorAll('#aaList .aa-row').length > 0", 15000);
            await sleep(400);
            await bothThemes(p, "assistants_" + role, "phone");
          }
          await p.size(1280, 900, false);
        }
      }, p);
    }

    /* ── 2. admin, the console: every tab through the relay; Pause asks first ── */
    const ad = pages.find((x) => x.name === "admin");
    if (ad) await attempt("admin: the console", async () => {
      await ad.size(1280, 900, false);
      await open(ad, "/agents-console.html#/dashboard", consoleReady, 20000);
      const before = await db(ad, "R.agents_console.length");
      const drawn = {};
      for (const [i, t] of TABS.entries()) {
        const id = ["dashboard", "agents", "timesheets", "tasks", "photo", "assistants", "training", "activity", "replies", "people", "settings"][i];
        await ad.eval("location.hash = '#/" + id + "'; true");
        await ad.until("!!document.querySelector('#cTab-" + id + "[aria-selected=true]') && !document.querySelector('#cView .c-skel') && (document.getElementById('cView').innerText.length > 40)", 20000);
        await sleep(1500);
        const err = await ad.eval("(() => { const e = document.querySelector('#cView .c-error'); return e ? e.innerText : ''; })()");
        drawn[t] = err ? "ERROR " + err.slice(0, 120) : "ok";
        if (SHOTS !== "none") {
          await shoot(ad, "console_tab_" + id + "_admin", "desktop", false);
          if (["dashboard", "agents", "photo", "assistants", "settings"].includes(id)) await shoot(ad, "console_tab_" + id + "_admin", "desktop", true);
        }
      }
      check("admin: all eleven tabs drawn from the made-up DCR server, none failed", Object.values(drawn).every((v) => v === "ok"), JSON.stringify(drawn));
      const rel = await db(ad, "({ n: R.agents_console.length, mine: R.agents_console.every(r => r.admin_id === " + JSON.stringify(PEOPLE.admin) + "), done: R.agents_console.filter(r => r.status === 'done').length })");
      check("admin: every tab went through the relay (" + (rel.n - before) + " requests, all this admin's, answered)", rel.n > before && rel.mine && rel.done >= rel.n - 2, JSON.stringify(rel));
      check("admin: the console listens on Realtime (its own rows) and polls only as the fallback", await ad.eval("window.DCRConsoleBridge.live()"));
      // Pause everything: the DCR server's own question, then the banner with Resume
      await ad.eval("location.hash = '#/dashboard'; true");
      await ad.until("!!document.getElementById('cdPause') && !document.getElementById('cdPause').disabled", 20000);
      // the made-up DCR server answers from whichever demo tab takes the request: a background tab's timers are
      // throttled, so the admin's tab is brought to the front first and the question gets the console's own wait
      await ad.call("Page.bringToFront");
      await click(ad, "#cdPause");
      await ad.until("!!document.querySelector('.dcr-mo.open')", 25000);
      const q = await text(ad, ".dcr-mo.open");
      check("admin: Pause everything shows the DCR server's own question first", /Pause every agent and assistant on the DCR server\?/.test(q), q);
      await shoot(ad, "console_pause_question_admin", "desktop", false, false);
      await modalOk(ad);
      await ad.until("/Everything is paused on the DCR server/.test(document.getElementById('cBanners').textContent) && !!document.getElementById('cResume')", 15000);
      const confirmed = await db(ad, "R.agents_console.filter(r => r.method === 'dashboard.pause').map(r => r.args.confirmed === true)");
      check("admin: yes calls dashboard.pause again with confirmed:true; the amber banner with Resume", JSON.stringify(confirmed) === JSON.stringify([false, true]), JSON.stringify(confirmed));
      await bothThemes(ad, "console_paused_admin", "desktop", false);
      await click(ad, "#cResume");
      await ad.until("!!document.querySelector('.dcr-mo.open')", 10000);
      await modalOk(ad);
      await ad.until("!/Everything is paused/.test(document.getElementById('cBanners').textContent)", 15000);
      check("admin: Resume, asked too, takes the banner away", true);
      // phone: the agents and the photo plans
      await ad.size(390, 844, true);
      for (const id of ["agents", "photo"]) {
        await ad.eval("location.hash = '#/" + id + "'; true");
        await ad.until("!!document.querySelector('#cTab-" + id + "[aria-selected=true]') && !document.querySelector('#cView .c-skel') && document.getElementById('cView').innerText.length > 40", 20000);
        await sleep(1500);
        await bothThemes(ad, "console_tab_" + id + "_admin", "phone");
      }
      await ad.size(1280, 900, false);
    }, ad);

    /* ── 3. field, My Assistant on the phone ───────────────────────────── */
    const f = pages.find((x) => x.name === "field");
    if (f) await attempt("field: My Assistant on the phone", async () => {
      // the phone in the person's hand: the tab in front (the page marks answers read only while it is seen)
      await f.call("Page.bringToFront");
      await f.size(390, 844, true);
      await open(f, "/my-assistant.html#today", "!document.getElementById('maTabs').hidden && /Work hours/.test(document.getElementById('maToday').innerText)", 15000);
      await sleep(600);
      const today = await text(f, "#maToday");
      check("field: Today: the work hours, the reminders and to-dos, the open tasks and the jobs from the agenda (no amount in it)",
        /Work hours/.test(today) && /YOUR OPEN TASKS|Your open tasks/i.test(today) && /YOUR JOBS|Your jobs/i.test(today) && !/\$\s?\d/.test(today), today.slice(0, 300));
      for (const tab of ["today", "tomorrow", "week", "chat", "items", "me"]) {
        await f.eval("document.querySelector('[data-tab=" + tab + "]').click(); window.scrollTo(0, 0); true");
        await sleep(500);
        await shoot(f, "myassistant_" + tab + "_field", "phone", false);
        if (["today", "chat", "items"].includes(tab)) await shoot(f, "myassistant_" + tab + "_field", "phone", true);
      }
      // a question, answered live with a reminder card
      await f.eval("document.querySelector('[data-tab=chat]').click(); true");
      await setVal(f, "maText", "Remind me at 5 pm to load the trailer");
      await click(f, "#maSend");
      await f.until("/Sent ✓/.test(document.getElementById('maStatus').textContent)", 8000);
      const waiting = await db(f, "R.assistant_messages.filter(m => m.profile_id === " + JSON.stringify(PEOPLE.field) + " && m.status === 'waiting').length");
      await f.until("Array.from(document.querySelectorAll('.ma-msg.assistant')).some(m => /Load the trailer/.test(m.innerText))", 15000);
      const card = await f.eval("(() => { const m = Array.from(document.querySelectorAll('.ma-msg.assistant')).pop(); return { text: m.innerText, card: !!m.querySelector('.ma-card') }; })()");
      check("field: a question waits, then the answer arrives live (Realtime) with the reminder as a card", waiting === 1 && card.card && /5:00 pm/.test(card.text), JSON.stringify({ waiting, card }));
      await shoot(f, "myassistant_answer_field", "phone", false, false);
      // the same send twice is one message: no signal keeps the words and the client id
      await DCR2demoOffline(f, true);
      await setVal(f, "maText", "What's on my week?");
      await click(f, "#maSend");
      await f.until("/No signal/.test(document.getElementById('maStatus').textContent)", 8000);
      const kept = await f.eval("(() => { const k = Object.keys(localStorage).find(k => k.indexOf('dcr2:myAssistant.draft.v1:') === 0); const d = k ? JSON.parse(localStorage.getItem(k)) : null; return d && { t: d.t, id: d.clientId }; })()");
      await shoot(f, "myassistant_nosignal_field", "phone", false, false);
      await DCR2demoOffline(f, false);
      await sleep(400);
      await click(f, "#maSend");
      await f.until("/Sent ✓/.test(document.getElementById('maStatus').textContent)", 8000);
      await click(f, "#maSend").catch(() => null);
      await sleep(1200);
      const sent = await db(f, "R.assistant_messages.filter(m => m.profile_id === " + JSON.stringify(PEOPLE.field) + " && m.text === \"What's on my week?\").map(m => m.client_id)");
      check("field: no signal: the words and their client id stay on the phone; the resend is ONE message", kept && kept.t === "What's on my week?" && kept.id && sent.length === 1 && sent[0] === kept.id,
        JSON.stringify({ kept, sent }));
      // the office's item can only be ticked; a to-do of one's own: added, ticked, deleted
      await f.eval("document.querySelector('[data-tab=items]').click(); true");
      await sleep(400);
      const officeItem = await db(f, "R.assistant_items.find(i => i.profile_id === " + JSON.stringify(PEOPLE.field) + " && i.added_by === 'office' && !i.done).id");
      const officeTools = await f.eval("({ edit: !!document.querySelector('[data-act=edit][data-id=" + JSON.stringify(officeItem) + "]'), del: !!document.querySelector('[data-act=delete][data-id=" + JSON.stringify(officeItem) + "]'), tick: !!document.querySelector('[data-act=done][data-id=" + JSON.stringify(officeItem) + "]') })");
      check("field: an item from the office has a tick box, no Edit and no Delete", officeTools.tick && !officeTools.edit && !officeTools.del, JSON.stringify(officeTools));
      await f.eval("document.querySelector('[data-act=add][data-kind=todo]').click(); true");
      await f.until("!!document.querySelector('.dcr-mo.open')", 5000);
      await setVal(f, "dcrMoF0", "Pick up the new chalk line");
      await shoot(f, "myassistant_add_todo_field", "phone", false, false);
      await modalOk(f);
      await f.until("Array.from(document.querySelectorAll('#maItems .ma-item')).some(li => /Pick up the new chalk line/.test(li.innerText))", 8000);
      const mine = await db(f, "R.assistant_items.find(i => i.text === 'Pick up the new chalk line')");
      check("field: a to-do of one's own is added (assistant_op item.add: an i_ id, by the employee)", mine && /^i_/.test(mine.id) && mine.added_by === "employee", JSON.stringify(mine));
      await f.eval("document.querySelector('[data-act=done][data-id=" + JSON.stringify(mine.id) + "]').click(); true");
      await f.until("(DCR2Demo.engine.rows.assistant_items.find(i => i.id === " + JSON.stringify(mine.id) + ") || {}).done === true", 8000);
      await f.eval("document.querySelector('.ma-done') && (document.querySelector('.ma-done').open = true); true");
      await sleep(300);
      await f.eval("document.querySelector('[data-act=delete][data-id=" + JSON.stringify(mine.id) + "]').click(); true");
      await f.until("!!document.querySelector('.dcr-mo.open')", 5000);
      await modalOk(f);
      await f.until("!DCR2Demo.engine.rows.assistant_items.some(i => i.id === " + JSON.stringify(mine.id) + ")", 8000);
      check("field: ticked done, then deleted (asked first)", true);
      // the settings: a briefing time and Spanish; a note the assistant keeps
      await f.eval("document.querySelector('[data-tab=me]').click(); true");
      await sleep(400);
      await setVal(f, "maEveningAt", "19:15");
      await f.eval("document.getElementById('maLang').value = 'es'; true");
      await f.eval("document.querySelector('#maPrefs button[type=submit]').click(); true");
      await f.until("document.documentElement.lang === 'es' && /Hoy|Mañana/.test(document.getElementById('maTabs').innerText)", 8000);
      const prefs = await db(f, "R.assistant_profiles.find(p => p.profile_id === " + JSON.stringify(PEOPLE.field) + ").prefs");
      check("field: the evening briefing at 19:15 and Spanish are kept (prefs.set); the page speaks Spanish", prefs.eveningAt === "19:15" && prefs.language === "es", JSON.stringify(prefs));
      await shoot(f, "myassistant_me_es_field", "phone", false, false);
      await setVal(f, "maMemText", "I park on the north side");
      await f.eval("document.querySelector('#maMemForm button[type=submit]').click(); true");
      await f.until("/I park on the north side/.test(document.getElementById('maMe').innerText)", 8000);
      await f.eval("document.getElementById('maLang').value = 'en'; document.querySelector('#maPrefs button[type=submit]').click(); true");
      await f.until("document.documentElement.lang === 'en'", 8000);
      check("field: a note the assistant keeps (memory.add); back to English", true);
      // a note from the office arrives live: "1 new", read when the chat is opened. First everything before it is
      // settled - no question waiting (the earlier "What's on my week?" answered), the chat opened and read (unread 0,
      // no "new" on the tabs) - so "1 new" can only be the office's note arriving live (review fix: the badge already
      // said "1 new" for an earlier answer, so the check passed without proving anything, or saw "2 new" and timed out)
      const FIELD = JSON.stringify(PEOPLE.field);
      await f.call("Page.bringToFront");
      await f.until("!DCR2Demo.engine.rows.assistant_messages.some(m => m.profile_id === " + FIELD + " && m.role === 'user' && m.status === 'waiting')", 20000);
      await f.eval("document.querySelector('[data-tab=chat]').click(); true");
      await f.until("!/new/.test(document.getElementById('maTabs').innerText) && (DCR2Demo.engine.rows.assistant_profiles.find(p => p.profile_id === " + FIELD + ") || {}).unread === 0", 15000);
      await f.eval("document.querySelector('[data-tab=today]').click(); true");
      await sleep(300);
      const settled = await f.eval("document.getElementById('maTabs').innerText");
      // written by the demo's PC in the person's own tab: the tabs share the demo database through localStorage, and a
      // write from another (background) tab can race this tab's own writes - the real PC writes on the server
      await f.eval("DCR2Demo.engine.p6.pc.officeSays(" + FIELD + ", 'From the office: the crew meeting moved to 7:30 tomorrow.'); true");
      await f.until("/(^|\\D)1 new/.test(document.getElementById('maTabs').innerText)", 12000);
      const badge = await f.eval("document.getElementById('maTabs').innerText");
      await shoot(f, "myassistant_unread_field", "phone", false, false);
      await f.call("Page.bringToFront");
      await f.eval("document.querySelector('[data-tab=chat]').click(); true");
      await f.until("!/new/.test(document.getElementById('maTabs').innerText) && (DCR2Demo.engine.rows.assistant_profiles.find(p => p.profile_id === " + FIELD + ") || {}).unread === 0", 10000);
      const shown = await f.eval("Array.from(document.querySelectorAll('.ma-msg')).some(m => /the crew meeting moved to 7:30/.test(m.innerText))");
      check("field: a note from the office arrives without a reload ('1 new' - nothing else unread before it), and opening the chat reads it",
        !/new/.test(settled) && /1 new/.test(badge) && shown, JSON.stringify({ settled, badge, shown }));
      await f.size(1280, 900, false);
    }, f);

    /* ── 4. admin, Assistants: office reads, the office's item, turning one on ── */
    if (ad) await attempt("admin: Assistants", async () => {
      await ad.size(1280, 900, false);
      await open(ad, "/assistant-admin.html?person=" + PEOPLE.lead, "!!document.getElementById('aaOn') && /Chat/.test(document.getElementById('aaDetail').innerText)", 15000);
      await sleep(500);
      const hidden = await text(ad, "#aaDetail");
      check("admin: Riley's chat is private: 'The office does not read Riley's conversations', no chat drawn", /The office does not read Riley/.test(hidden) && !/Chat \(read only\)/.test(hidden), hidden.slice(-300));
      await bothThemes(ad, "assistants_private_admin", "desktop");
      await ad.eval("document.getElementById('aaReads').click(); true");
      await ad.until("/Chat \\(read only\\)/.test(document.getElementById('aaDetail').innerText)", 10000);
      // from now on only (M6 office_reads_since - review fix): the note that tells Riley, never what Riley wrote before
      await ad.until("/from this message on/.test(document.getElementById('aaDetail').innerText)", 10000);
      const detail = await text(ad, "#aaDetail");
      check("admin: the office reads turned on -> the chat is shown (read only) from now on only: Riley's earlier words stay private, Riley is told",
        (await db(ad, "R.assistant_profiles.find(p => p.profile_id === " + JSON.stringify(PEOPLE.lead) + ").office_reads")) === true &&
        !/How is my job going/.test(detail) && /from this message on/.test(detail), detail.slice(-300));
      await shoot(ad, "assistants_reads_admin", "desktop", false);
      // the office's to-do for the field person reaches their open page live
      if (f) {
        await f.size(390, 844, true);
        await open(f, "/my-assistant.html#items", "!document.getElementById('maTabs').hidden", 15000);
        await f.eval("document.querySelector('[data-tab=items]').click(); true");
      }
      await open(ad, "/assistant-admin.html?person=" + PEOPLE.field, "/From the office/.test(document.getElementById('aaDetail').innerText)", 15000);
      await ad.eval("Array.from(document.querySelectorAll('#aaDetail button')).find(b => b.textContent === '+ To-do').click(); true");
      await ad.until("!!document.querySelector('.dcr-mo.open')", 5000);
      await setVal(ad, "dcrMoF0", "Bring the signed time card to the office");
      await shoot(ad, "assistants_add_admin", "desktop", false, false);
      await modalOk(ad);
      await ad.until("/Bring the signed time card/.test(document.getElementById('aaDetail').innerText)", 10000);
      const it = await db(ad, "R.assistant_items.find(i => i.text === 'Bring the signed time card to the office')");
      check("admin: the office's to-do for Jordan (assistant_office_item add: by the office)", it && it.added_by === "office" && it.profile_id === PEOPLE.field, JSON.stringify(it));
      await bothThemes(ad, "assistants_person_admin", "desktop");
      if (f) {
        await f.until("Array.from(document.querySelectorAll('#maItems .ma-item')).some(li => /Bring the signed time card/.test(li.innerText))", 15000);
        const row = await f.eval("(() => { const li = Array.from(document.querySelectorAll('#maItems .ma-item')).find(li => /Bring the signed time card/.test(li.innerText)); return { text: li.innerText, edit: !!li.querySelector('[data-act=edit]'), del: !!li.querySelector('[data-act=delete]') }; })()");
        check("field: the office's to-do arrives on the open page live, 'Added by the office', without Edit or Delete", /Added by the office/.test(row.text) && !row.edit && !row.del, JSON.stringify(row));
        await shoot(f, "myassistant_office_item_field", "phone", false, false);
        await f.size(1280, 900, false);
      }
      // the manager's assistant turned on: their open page changes without a reload
      const m = pages.find((x) => x.name === "manager");
      if (m) {
        await open(m, "/my-assistant.html", "!!document.querySelector('#maBanner .ma-empty')", 15000);
        await open(ad, "/assistant-admin.html?person=" + PEOPLE.manager, "!!document.getElementById('aaOn')", 15000);
        await ad.eval("document.getElementById('aaOn').click(); true");
        await ad.until("(DCR2Demo.engine.rows.assistant_profiles.find(p => p.profile_id === " + JSON.stringify(PEOPLE.manager) + ") || {}).is_on === true", 10000);
        await m.until("!document.getElementById('maTabs').hidden && /Hi Morgan/.test(document.getElementById('maTitle').textContent)", 15000);
        check("manager: turned on by the office -> 'Hi Morgan' and the six panels, without a reload", true);
        await shoot(m, "myassistant_turned_on_manager", "desktop", false, false);
      }
      // phone: the person's view
      await ad.size(390, 844, true);
      await open(ad, "/assistant-admin.html?person=" + PEOPLE.field, "/From the office/.test(document.getElementById('aaDetail').innerText)", 15000);
      await sleep(400);
      await bothThemes(ad, "assistants_person_admin", "phone");
      await ad.size(1280, 900, false);
    }, ad);

    /* ── 5. no security-policy violation, no console error ─────────────── */
    for (const p of pages) {
      const bad = p.log.filter((x) => /CSP-VIOLATION|Content Security Policy/i.test(x.text) || x.level === "exception" ||
        (x.level === "error" && !/favicon\.ico|net::ERR_ABORTED|ERR_INTERNET_DISCONNECTED|Failed to fetch|demo: offline/.test(x.text + " " + (x.url || ""))));
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

/* the demo's "no signal" (navigator.onLine false, every call fails) for one tab */
async function DCR2demoOffline(p, on) {
  await p.eval("DCR2Demo.setOffline(" + (on ? "true" : "false") + "); true");
  await sleep(300);
}

main().catch((e) => { console.error(e); process.exit(2); });
