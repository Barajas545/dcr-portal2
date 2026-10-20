#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the P2 timesheet pages in the DEMO (development only).

     node tools/e2e-p2.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with its M2
   rules, made-up people; nothing goes to Supabase) and drives a local Chrome or Edge headless:

   - every role (admin, manager, accountant, lead, field, viewer): the home cards and the top bar,
     each P2 page it may open (Time Sheet desk and phone, Team Sheets, Batch Entry, Time Card,
     Employees & crews) and the refusal of the ones it may not; what each may change;
   - field on the phone: a day from the ?date= link (DCR Agents' reminder), a vacation day, the
     schedule laid over the normal hours, the calendar cell with the job's street;
   - lead: Batch Entry for three of the crew (one row each, a result per row); Team Sheets: the stale
     signature of the seeded week, a re-confirm, "someone else" changing an hour while the confirm
     dialog is open -> 409, nothing confirmed; live updates without a reload; the Time Card;
   - manager: Team Sheets Add Entry / edit / delete, the CSV (the formula guard), reorder kept;
   - accountant: Team Sheets read only (no Add Entry, no Confirm), the CSV;
   - viewer: Time Sheet read only, Team Sheets refused;
   - admin: Employees & crews (a new employee, the crew), Settings' employee section;
   - the review fixes: a change whose live event never arrived -> Confirm answers 409 (the screen's
     fingerprint), and after the on-focus refresh the signature carries what the screen shows; someone
     who has left (Finley) keeps a printable Time Card and correctable entries, and a Time Card link
     naming nobody in scope never shows one's own card; a lead without a crew gets no Batch Entry; the
     desk Time Sheet's card buttons stay inside the card at tablet widths; the top bar stays one row
     at every desk width (the office roles' links fold into the menu only when they do not fit);
   - the PDF from the phone (jsPDF 2.5.2 from jsDelivr, integrity checked): one file downloaded;
   - no Content-Security-Policy violation and no console error on any page;
   - screenshots (--shots all): p2_<page>_<role>_<light|dark>_<desktop|phone>.png into --out.
   Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p2")));
const SHOTS = arg("--shots", "all");
const DL = join(OUT, "downloads");

const ROLES = (arg("--roles", "admin,manager,accountant,lead,field,viewer")).split(",").filter(Boolean);
const TEAM = { admin: true, manager: true, accountant: true, lead: true };
const BATCH = { admin: true, manager: true, lead: true };
const PEOPLE_ADMIN = { admin: true, manager: true };

async function main() {
  mkdirSync(OUT, { recursive: true });
  rmSync(DL, { recursive: true, force: true });
  mkdirSync(DL, { recursive: true });
  const server = startServer(0);
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const { cdp, proc } = await launch(arg("--chrome"));
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL, eventsEnabled: true }).catch(() => null);
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
        try { where = " @ " + await page.eval("location.href + ' :: ' + (document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(-900) : '')"); }
        catch (x) { where = " @ (page not answering: " + x.message + ")"; }
      }
      check(name, false, String(e && e.message || e).slice(0, 400) + where);
    }
  };
  const TOPBAR = "!!document.querySelector('.dcr2-topbar .p2-badge')";
  async function open(p, path, marker, ms, bar) {
    await p.goto(base + path, 150);
    const here = "(location.pathname + location.search).indexOf(" + JSON.stringify(path.split("?")[0]) + ") === 0";
    await p.until(here + (bar === false ? "" : " && " + TOPBAR) + (marker ? " && (" + marker + ")" : ""), ms || 12000);
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
  const setVal = (p, id, value) => p.eval("(() => { const i = document.getElementById(" + JSON.stringify(id) + "); i.focus(); i.value = " + JSON.stringify(value) +
    "; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  const click = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); if (!n) throw new Error('no ' + " + JSON.stringify(sel) + "); n.click(); return true; })()");
  const text = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); return n ? n.innerText : ''; })()");
  const modalOk = (p) => p.eval("(() => { const b = document.getElementById('dcrMoYes'); if (b) b.click(); return !!b; })()");

  /** A whole-page screenshot at the device's width. */
  async function shoot(p, name, device, dark) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : device === "tablet" ? 768 : 1280;      // tablet: an iPad held upright
    await p.call("Page.bringToFront").catch(() => null);      // a background tab may never paint a frame
    await p.dark(dark);
    await sleep(250);
    const h = await p.eval("Math.max(844, Math.min(4200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(350);
    const file = "p2_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: device === "phone" ? 844 : 900, deviceScaleFactor: 1, mobile: device === "phone" });
    await p.dark(false);
  }
  async function bothThemes(p, name, device) { await shoot(p, name, device, false); await shoot(p, name, device, true); }

  try {
    /* ── 0. a clean demo database ──────────────────────────────────────── */
    const a = await newPage(cdp, "setup", OUT); pages.push(a);
    await a.size(1280, 900, false);
    await a.goto(base + "/manifest.json", 50);
    await a.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");
    await signIn(a, "admin", "dashboard.html");
    const today = await a.eval("DCR2.companyToday()");
    const thisSat = await a.eval("DCR2.saturdayOf(DCR2.companyToday())");
    const lastSat = await a.eval("DCR2.addDays(DCR2.saturdayOf(DCR2.companyToday()), -7)");
    const lastWed = await a.eval("DCR2.addDays(DCR2.addDays(DCR2.saturdayOf(DCR2.companyToday()), -7), 4)");
    const EMP = await db(a, "Object.fromEntries(R.employees.map(e => [e.full_name, e.id]))");
    const SANDBOX = await db(a, "R.projects.find(p => p.number === 'A267').id");
    check("demo: employees, crews and four weeks of hours", Object.keys(EMP).length === 11 && (await db(a, "R.timesheets.length")) > 100, Object.keys(EMP).length);

    /* ── 1. every role: home, top bar, every P2 page ───────────────────── */
    for (const role of ROLES) {
      const p = await newPage(cdp, role, OUT); pages.push(p);
      await p.size(1280, 900, false);
      await attempt(role + ": the P2 pages", async () => {
        await signIn(p, role, "dashboard.html");
        await p.until("document.querySelectorAll('.hm-card').length > 2" + (role === "lead" ? " && /Batch Entry/.test(document.getElementById('hmSections').innerText)" : ""), 8000);
        const cards = await p.eval("Array.from(document.querySelectorAll('.hm-card .tt')).map(n => n.textContent)");
        check(role + ": home cards (Time Sheet; Team Sheets " + (TEAM[role] ? "yes" : "no") + "; Batch Entry " + (BATCH[role] ? "yes" : "no") + "; Employees & crews " + (PEOPLE_ADMIN[role] ? "yes" : "no") + ")",
          cards.includes("Time Sheet") && cards.includes("Team Sheets") === !!TEAM[role] && cards.includes("Batch Entry") === !!BATCH[role] &&
          cards.includes("Employees & crews") === !!PEOPLE_ADMIN[role], cards.join("|"));
        const nav = await p.eval("Array.from(document.querySelectorAll('#dcr2Nav a')).map(a => a.textContent)");
        check(role + ": top bar has Time Sheet" + (TEAM[role] ? " and Team Sheets" : ""), nav.includes("Time Sheet") && nav.includes("Team Sheets") === !!TEAM[role], nav.join("|"));
        await bothThemes(p, "home_" + role, "desktop");
        const bars = [];
        for (const w of [1366, 1280, 1100, 900]) {
          await p.size(w, 900, false);
          await p.eval("window.dispatchEvent(new Event('resize')); true");
          await sleep(250);
          bars.push(await p.eval("(() => { const b = document.querySelector('.dcr2-topbar'); const links = Array.from(document.querySelectorAll('#dcr2Nav a')).filter(a => a.offsetParent !== null);" +
            " return { w: innerWidth, h: Math.round(b.getBoundingClientRect().height), links: links.length, rows: new Set(links.map(a => Math.round(a.getBoundingClientRect().top))).size," +
            " fold: b.classList.contains('dcr2-fold'), scrollX: document.documentElement.scrollWidth > innerWidth }; })()"));
        }
        await p.size(1280, 900, false);
        await p.eval("window.dispatchEvent(new Event('resize')); true");
        check(role + ": the top bar is one row at 1366, 1280, 1100 and 900 px (links shown at 1280 and up; folded into the menu only when they do not fit)",
          bars.every((b) => b.h <= 70 && !b.scrollX && (b.fold ? b.links === 0 : b.rows === 1)) && bars.slice(0, 2).every((b) => !b.fold && b.links === nav.length), JSON.stringify(bars));

        // Time Sheet, desk
        await open(p, "/timesheet.html", "document.querySelectorAll('.cal-day').length === 14");
        const ts = await p.eval("({ form: !document.getElementById('tsForm').hidden, ro: !document.getElementById('tsReadOnly').hidden, locked: document.getElementById('tsName').disabled," +
          " name: document.getElementById('tsName').value, cards: document.querySelectorAll('.cal-card').length, edits: document.querySelectorAll('[data-act=edit]').length, note: document.getElementById('empScopeNote').textContent })");
        const wantForm = role !== "viewer";
        check(role + ": Time Sheet " + (wantForm ? "form" : "read only") + ", " + (role === "field" || role === "accountant" ? "locked to self" : "employee free"),
          ts.form === wantForm && ts.ro === !wantForm && (role === "field" || role === "accountant" ? ts.locked : role === "viewer" || !ts.locked), JSON.stringify(ts));
        check(role + ": Time Sheet calendar shows hours" + (role === "viewer" ? " (own, nothing editable)" : ""), ts.cards > 0 && (role === "viewer" ? ts.edits === 0 : ts.edits > 0), JSON.stringify(ts));
        await bothThemes(p, "timesheet_" + role, "desktop");

        // Time Sheet, phone page (also at desk width)
        await open(p, "/timesheet-mobile.html?date=" + lastWed, "document.querySelectorAll('.m-cal-cell').length === 14");
        check(role + ": phone Time Sheet: 14 days, ?date= taken", (await p.eval("document.getElementById('tsDate').value")) === lastWed || role === "viewer");

        // Team Sheets
        await p.goto(base + "/timesheet-manager.html", 1500);
        if (TEAM[role]) {
          await p.until("document.querySelectorAll('#pmTableArea tbody tr').length > 0", 10000);
          const tm = await p.eval("({ rows: document.querySelectorAll('#pmTableArea tbody tr').length, add: !document.getElementById('pmAddBtn').hidden," +
            " conf: !document.getElementById('pmConfirmAllBtn').hidden, live: document.getElementById('pmLive').textContent })");
          const wantRows = role === "lead" ? 6 : 10;
          check(role + ": Team Sheets: " + wantRows + " rows; Add Entry and Confirm " + (role === "accountant" ? "hidden (read only)" : "offered") + "; live",
            tm.rows === wantRows && tm.add === (role !== "accountant") && tm.conf === (role !== "accountant") && /Live/.test(tm.live), JSON.stringify(tm));
          await open(p, "/timesheet-manager.html?week=" + lastSat, "document.querySelectorAll('#pmTableArea .pm-conf-tick').length > 0");
          await bothThemes(p, "teamsheets_" + role, "desktop");
        } else {
          await p.until("/not available for your role/.test(document.body.innerText)", 8000);
          check(role + ": Team Sheets refused", true);
          await modalOk(p);
          await sleep(600);
        }

        // Batch Entry
        await p.goto(base + "/timesheet-batch.html", 1500);
        if (BATCH[role]) {
          await p.until("document.querySelectorAll('.bt-emp-item').length > 0", 8000);
          const n = await p.eval("document.querySelectorAll('.bt-emp-item').length");
          check(role + ": Batch Entry lists " + (role === "lead" ? "self and crew (6)" : "everyone (10)"), n === (role === "lead" ? 6 : 10), n);
          await bothThemes(p, "batch_" + role, "desktop");
        } else {
          await p.until("/not available for your role/.test(document.body.innerText)", 8000);
          check(role + ": Batch Entry refused", true);
          await modalOk(p);
          await sleep(600);
        }

        // Time card
        await open(p, "/report-timecard.html?week=" + lastSat, "document.getElementById('tcEmp').options.length > 2 || /WEEK TOTAL/.test(document.getElementById('tcSheet').innerText)", 12000, false);
        const tc = await p.eval("({ n: document.getElementById('tcEmp').options.length - 1, sel: document.getElementById('tcEmp').value, sheet: document.getElementById('tcSheet').innerText })");
        const wantTc = { admin: 11, manager: 11, accountant: 11, lead: 6, field: 1, viewer: 1 }[role];
        const leftOpt = await p.eval("Array.from(document.getElementById('tcEmp').options).some(o => o.text === 'Finley Coyote (left)')");
        check(role + ": Time Card offers " + wantTc + (wantTc === 1 ? " (self, chosen)" : wantTc === 11 ? " (Finley, who has left, last)" : ""),
          tc.n === wantTc && (wantTc > 1 || (/WEEK TOTAL/.test(tc.sheet) && tc.sel)) && leftOpt === (wantTc === 11), JSON.stringify({ n: tc.n, sel: tc.sel, leftOpt }));
        if (wantTc === 1) await bothThemes(p, "timecard_" + role, "desktop");

        // Employees & crews
        await p.goto(base + "/admin.html", 1500);
        if (PEOPLE_ADMIN[role]) {
          await p.until("document.querySelectorAll('.ad-card').length >= 10", 8000);
          check(role + ": Employees & crews lists the employees", true);
          await bothThemes(p, "admin_" + role, "desktop");
        } else {
          await p.until("/not available for your role/.test(document.body.innerText)", 8000);
          check(role + ": Employees & crews refused", true);
          await modalOk(p);
          await sleep(600);
        }

        // the phone (390 px): Time Sheet (redirected to the phone page), Team Sheets, Batch, admin
        await p.size(390, 844, true);
        await p.goto(base + "/timesheet.html", 150);
        await p.until("/timesheet-mobile[.]html/.test(location.pathname) && " + TOPBAR + " && document.querySelectorAll('.m-cal-cell').length === 14", 12000);
        check(role + ": a phone opening timesheet.html lands on the phone page", true);
        await bothThemes(p, "timesheet_" + role, "phone");
        if (TEAM[role]) {
          await open(p, "/timesheet-manager.html?week=" + lastSat, "document.querySelectorAll('#pmTableArea tbody tr').length > 0");
          await bothThemes(p, "teamsheets_" + role, "phone");
        }
        if (BATCH[role]) {
          await open(p, "/timesheet-batch.html", "document.querySelectorAll('.bt-emp-item').length > 0");
          await bothThemes(p, "batch_" + role, "phone");
        }
        if (PEOPLE_ADMIN[role]) {
          await open(p, "/admin.html", "document.querySelectorAll('.ad-card').length >= 10");
          await bothThemes(p, "admin_" + role, "phone");
        }
        await open(p, "/report-timecard.html?week=" + lastSat + (role === "lead" ? "&emp=" + EMP["Alex Juniper"] : ""), "/WEEK TOTAL|Choose an employee/.test(document.getElementById('tcSheet').innerText)", 12000, false);
        await bothThemes(p, "timecard_" + role, "phone");
        await p.size(1280, 900, false);
      }, p);
    }

    /* ── 2. field, on the phone: a day from the reminder link, a vacation day ─ */
    const f = pages.find((x) => x.name === "field");
    if (f) await attempt("field: a work day and a vacation day from the phone", async () => {
      await f.size(390, 844, true);
      await open(f, "/timesheet-mobile.html?date=" + today, "document.querySelectorAll('.m-cal-cell').length === 14");
      const before = await db(f, "R.timesheets.length");
      await setVal(f, "tsProject", "A267");
      for (let i = 0; i < 16; i++) await click(f, "#hrsPlus");
      await sleep(200);
      const sched = await f.eval("({ shown: document.getElementById('tsScheduleSection').style.display !== 'none', s1: document.getElementById('tsStart1').value, e2: document.getElementById('tsEnd2').value, bar: document.getElementById('tsCalcBar').innerText })");
      check("field: 8 hours laid over the normal schedule (7:00–11:00, lunch, 12:00–16:00), calculated matches", sched.shown && sched.s1 === "07:00" && sched.e2 === "16:00" && /Matches 8h/.test(sched.bar), JSON.stringify(sched));
      await setVal(f, "tsWork", "Sheathing, north side");
      await click(f, "#submitBtn");
      await f.until("/Saved/.test(document.getElementById('formMsg').textContent)", 8000);
      const row = await db(f, "R.timesheets[R.timesheets.length - 1]");
      check("field: one row — Jordan, today, A267, 8 h, 07:00–16:00, source portal", (await db(f, "R.timesheets.length")) === before + 1 && row.employee_id === EMP["Jordan Field"] &&
        row.work_date === today && row.project_id === SANDBOX && Number(row.hours) === 8 && row.start1 === "07:00:00" && row.end2 === "16:00:00" && row.source === "portal", JSON.stringify(row));
      await f.until("Array.from(document.querySelectorAll('.m-cal-cell.today .m-cal-a')).some(n => /Test Way/.test(n.textContent))", 6000);
      check("field: the calendar shows the hours over the job's street", true);
      await f.eval("document.querySelector('#daySeg [data-kind=vacation]').click(); true");
      check("field: a leave day hides the project", (await f.eval("document.getElementById('projField').style.display")) === "none");
      await setVal(f, "tsDate", addDaysTxt(today, 1));
      for (let i = 0; i < 16; i++) await click(f, "#hrsPlus");
      await click(f, "#submitBtn");
      await f.until("/Saved/.test(document.getElementById('formMsg').textContent)", 8000);
      const vac = await db(f, "R.timesheets[R.timesheets.length - 1]");
      check("field: the vacation day is kind vacation, no project, no clock", vac.kind === "vacation" && vac.project_id === null && vac.start1 === null, JSON.stringify(vac));
      // the PDF of the week (jsPDF from jsDelivr, integrity checked) — downloaded in a headless browser
      await click(f, "#tsPdfBtn");
      await f.until("!!document.querySelector('.tp-overlay')", 4000);
      await bothThemes(f, "pdf_chooser_field", "phone");
      await f.eval("document.querySelector('#tpScope [data-scope=week]').click(); document.getElementById('tpDate').value = " + JSON.stringify(today) + "; document.getElementById('tpGo').click(); true");
      await f.until("/Downloaded|Shared|No hours|Could not/.test(document.getElementById('tpMsg').textContent)", 30000);
      const msg = await f.eval("document.getElementById('tpMsg').textContent");
      await sleep(2500);
      const pdfs = readdirSync(DL).filter((n) => /\.pdf$/.test(n));
      const head = pdfs.length ? readFileSync(join(DL, pdfs[0])).subarray(0, 5).toString() : "";
      check("PDF: one file in the paper form, downloaded (" + (pdfs[0] || "none") + ")", /Downloaded 1 PDF/.test(msg) && pdfs.length === 1 && head === "%PDF-" &&
        /^Timesheet-Jordan-Field-Week-\d{4}-\d{2}-\d{2}\.pdf$/.test(pdfs[0]), msg + " " + pdfs.join(","));
      await f.size(1280, 900, false);
    }, f);

    /* ── 3. lead: Batch Entry, sign-off, live, 409, time card ──────────── */
    const l = pages.find((x) => x.name === "lead");
    if (l) await attempt("lead: Batch Entry for three of the crew", async () => {
      await open(l, "/timesheet-batch.html", "document.querySelectorAll('.bt-emp-item').length === 6");
      for (const n of ["Alex Juniper", "Blair Sycamore", "Devon Madrone"]) await click(l, ".bt-emp-item[data-id='" + EMP[n] + "']");
      await setVal(l, "btProject", "A267");
      await setVal(l, "btDate", addDaysTxt(thisSat, 0));
      for (let i = 0; i < 12; i++) await click(l, "#btPlus");
      await sleep(200);
      check("lead: Batch preview: 3 entries × 6 hrs, the schedule from the first one's normal hours",
        /3 entries × 6 hrs/.test(await text(l, "#btPreviewList")) && /Alex Juniper/.test(await text(l, "#btSchedNote")), await text(l, "#btPreviewList"));
      const before = await db(l, "R.timesheets.length");
      await click(l, "#btSubmitBtn");
      await l.until("!!document.getElementById('btOk') || !!document.getElementById('btFail') || /Pick|Choose|Set the|Hours/.test(document.getElementById('btMsg').innerText)", 10000);
      check("lead: three rows created, a line per employee", (await db(l, "R.timesheets.length")) === before + 3 && /3 entries created/.test(await text(l, "#btOk")), await text(l, "#btResult"));
      await bothThemes(l, "batch_result_lead", "desktop");
    }, l);

    if (l) await attempt("lead: Team Sheets sign-off — a stale mark, re-confirm, a change while the dialog is open -> 409, live updates", async () => {
      await open(l, "/timesheet-manager.html?week=" + lastSat, "document.querySelectorAll('#pmTableArea .pm-conf-tick').length > 0");
      const alex = EMP["Alex Juniper"], jordan = EMP["Jordan Field"];
      check("lead: Alex's week carries Riley's signature drawn stale (hours changed after it)", await l.eval("!!document.querySelector('tr[data-emp=\"" + alex + "\"] .pm-conf-tick.stale') && !!document.querySelector('tr[data-emp=\"" + alex + "\"].pm-row-stale')"),
        await l.eval("location.search + ' ' + document.getElementById('pmWeekLabel').textContent + ' :: ' + Array.from(document.querySelectorAll('#pmTableArea tbody tr')).map(t => t.getAttribute('data-emp') + ':' + t.className + ':' + t.querySelectorAll('.pm-conf-tick').length).join(' | ')"));
      await click(l, "[data-conf='" + alex + "']");
      await l.until("!!document.getElementById('pmConfBtn')", 4000);
      await shoot(l, "confirm_dialog_lead", "desktop", false);
      await click(l, "#pmConfBtn");
      await l.until("!document.querySelector('.pm-detail-overlay') && !!document.querySelector('tr[data-emp=\"" + alex + "\"].pm-row-confirmed')", 8000);
      check("lead: re-confirmed: Alex's row is confirmed", true);
      // the confirm dialog of Devon, then someone else changes one of Devon's hours meanwhile
      const devon = EMP["Devon Madrone"];
      await click(l, "[data-conf='" + devon + "']");
      await l.until("!!document.getElementById('pmConfBtn')", 4000);
      const rowId = await db(l, "R.timesheets.find(t => t.employee_id === " + devon + " && t.work_date >= '" + lastSat + "' && t.work_date <= '" + addDaysTxt(lastSat, 6) + "' && t.kind === 'work').id");
      const totalBefore = await text(l, "tr[data-emp='" + devon + "'] .pm-cell-total");
      await l.eval("DCR2Demo.remoteEdit('timesheets', " + rowId + ", { hours: 10 }, 'manager'); true");
      await l.until("document.querySelector(\"tr[data-emp='" + devon + "'] .pm-cell-total\").innerText !== " + JSON.stringify(totalBefore), 8000);
      check("live: the grid shows someone else's change by itself (no reload)", true, totalBefore + " -> " + await text(l, "tr[data-emp='" + devon + "'] .pm-cell-total"));
      await click(l, "#pmConfBtn");
      await l.until("/Nothing was confirmed/.test(document.body.innerText)", 8000);
      const devonMarks = await db(l, "R.timesheet_confirmations.filter(c => c.employee_id === " + devon + ").length");
      check("409: the hours changed while the dialog was open — nothing confirmed, the week read again", devonMarks === 0, devonMarks);
      await shoot(l, "confirm_409_lead", "desktop", false);
      await modalOk(l);
      // Jordan's signature by the manager may not be withdrawn by the lead
      await click(l, "[data-conf='" + jordan + "']");
      await l.until("!!document.querySelector('.pm-conf-list')", 4000);
      const undo = await l.eval("document.querySelectorAll('.pm-conf-list [data-undo]').length");
      check("lead: may withdraw only their own signature (one × of two)", undo === 1, undo);
      await l.eval("document.querySelector('[data-close]').click(); true");
      // the time card of Alex for that week
      await open(l, "/report-timecard.html?emp=" + alex + "&week=" + lastSat, "/WEEK TOTAL/.test(document.getElementById('tcSheet').innerText)", 12000, false);
      const tot = await l.eval("document.querySelector('.tc tr.tot .num').textContent");
      const want = await db(l, "R.timesheets.filter(t => t.employee_id === " + alex + " && t.work_date >= '" + lastSat + "' && t.work_date <= '" + addDaysTxt(lastSat, 6) + "').reduce((s, t) => s + Number(t.hours), 0)");
      check("Time Card: Alex's week total matches the rows (" + want + ")", Number(tot) === Number(want), tot);
      await bothThemes(l, "timecard_alex_lead", "desktop");
    }, l);

    /* ── 4. manager: Add Entry / edit / delete; CSV; order kept ───────── */
    const m = pages.find((x) => x.name === "manager");
    if (m) await attempt("manager: Team Sheets entries and the CSV", async () => {
      await open(m, "/timesheet-manager.html", "document.querySelectorAll('#pmTableArea tbody tr').length === 10");
      await click(m, "#pmAddBtn");
      await m.until("!!document.getElementById('pmForm')", 4000);
      await m.eval("document.getElementById('pmFormEmp').value = '" + EMP["Emery Chaparral"] + "'; document.getElementById('pmFormEmp').dispatchEvent(new Event('change')); true");
      await setVal(m, "pmFormProject", "A267");
      await setVal(m, "pmFormDate", thisSat);
      await setVal(m, "pmFormHours", "9");
      await m.eval("document.getElementById('pmFormHours').dispatchEvent(new Event('blur')); true");
      await sleep(200);
      check("manager: Add Entry lays 9 h over Emery's own normal hours (6:30 start)", (await m.eval("document.getElementById('pmFormStart1').value")) === "06:30", await m.eval("document.getElementById('pmFormStart1').value"));
      await shoot(m, "add_entry_manager", "desktop", false);
      await m.eval("document.getElementById('pmForm').requestSubmit(); true");
      // the Saturday cell itself (Emery has other overtime days already): the page has read the new row
      await m.until("!document.getElementById('pmForm') && document.querySelector(\"tr[data-emp='" + EMP["Emery Chaparral"] + "'] .pm-cell-hrs.overtime[data-day='" + thisSat + "']\")", 8000);
      check("manager: the new entry shows as overtime (over 8 h) on Saturday", true);
      await click(m, "tr[data-emp='" + EMP["Emery Chaparral"] + "'] [data-day='" + thisSat + "']");
      await m.until("!!document.querySelector('[data-edit]')", 4000);
      await click(m, "[data-edit]");
      await m.until("!!document.getElementById('pmForm')", 4000);
      await setVal(m, "pmFormHours", "7");
      await m.eval("document.getElementById('pmForm').requestSubmit(); true");
      await m.until("!document.getElementById('pmForm') && document.querySelector(\"tr[data-emp='" + EMP["Emery Chaparral"] + "'] [data-day='" + thisSat + "']\").textContent.trim() === '7'", 8000);
      const row = await db(m, "R.timesheets.filter(t => t.employee_id === " + EMP["Emery Chaparral"] + " && t.work_date === '" + thisSat + "')[0]");
      check("manager: edited at its version (7 h, version 2)", row && Number(row.hours) === 7 && row.version === 2, JSON.stringify(row));
      await click(m, "tr[data-emp='" + EMP["Emery Chaparral"] + "'] [data-day='" + thisSat + "']");
      await m.until("!!document.querySelector('[data-del]')", 4000);
      await click(m, "[data-del]");
      await m.until("!!document.getElementById('dcrMoYes')", 4000);
      await modalOk(m);
      await m.until("(" + "!DCR2Demo.engine.rows.timesheets.some(t => t.id === " + row.id + "))", 6000);
      check("manager: deleted (a hard delete)", true);
      await m.eval("document.querySelectorAll('.pm-detail-overlay [data-close]').forEach(b => b.click()); true");
      // the CSV of last week, with a name a spreadsheet would run
      await m.eval("DCR2Demo.remoteEdit('employees', " + EMP["Harper Alder"] + ", { full_name: '=HYPERLINK(\"x\")' }, 'admin'); true");
      await open(m, "/timesheet-manager.html?week=" + lastSat, "document.querySelectorAll('#pmTableArea tbody tr').length === 10");
      const n0 = readdirSync(DL).filter((x) => /\.csv$/.test(x)).length;
      await click(m, "#pmCsvBtn");
      await sleep(1500);
      const csvs = readdirSync(DL).filter((x) => /\.csv$/.test(x));
      const csv = csvs.length > n0 ? readFileSync(join(DL, csvs.find((x) => x === "timesheets_" + lastSat + ".csv") || csvs[0]), "utf8") : "";
      check("CSV: the week with the formula guard (a name starting with = is kept as text)", /"Employee","Employee no\."/.test(csv) && csv.includes("\"'=HYPERLINK(\"\"x\"\")\""), csv.slice(0, 200));
      await m.eval("DCR2Demo.remoteEdit('employees', " + EMP["Harper Alder"] + ", { full_name: 'Harper Alder' }, 'admin'); true");
    }, m);

    /* ── 5. accountant and viewer ──────────────────────────────────────── */
    const ac = pages.find((x) => x.name === "accountant");
    if (ac) await attempt("accountant: Team Sheets read only", async () => {
      await open(ac, "/timesheet-manager.html?week=" + lastSat, "document.querySelectorAll('#pmTableArea tbody tr').length === 10");
      await click(ac, "tr[data-emp='" + EMP["Jordan Field"] + "'] [data-day='" + addDaysTxt(lastSat, 2) + "']");
      await ac.until("!!document.querySelector('.pm-detail-overlay')", 4000);
      check("accountant: a day opens without Edit / Delete / Add", await ac.eval("!document.querySelector('[data-edit],[data-del],[data-add]')"));
      await ac.eval("document.querySelector('.pm-detail-overlay [data-close]').click(); true");
      await click(ac, "[data-conf='" + EMP["Jordan Field"] + "']");
      await ac.until("!!document.querySelector('.pm-conf-week')", 4000);
      check("accountant: sees the signatures, cannot confirm or withdraw", await ac.eval("!document.getElementById('pmConfBtn') && !document.querySelector('.pm-detail-overlay [data-undo]')"));
    }, ac);
    const v = pages.find((x) => x.name === "viewer");
    if (v) await attempt("viewer: own hours, read only", async () => {
      await open(v, "/timesheet.html", "document.querySelectorAll('.cal-day').length === 14");
      check("viewer: no form, a read-only notice", await v.eval("document.getElementById('tsForm').hidden && /View only/.test(document.getElementById('tsReadOnly').textContent)"));
    }, v);

    /* ── 6. admin: Employees & crews, Settings ─────────────────────────── */
    if (pages.find((x) => x.name === "admin")) await attempt("admin: a new employee and their crew", async () => {
      await open(a, "/admin.html", "document.querySelectorAll('.ad-card').length >= 10");
      await click(a, "#adNew");
      await a.until("!!document.getElementById('adForm')", 4000);
      await setVal(a, "fName", "Quinn Example");
      await setVal(a, "fNo", "E-150");
      await setVal(a, "fPhone", "(805) 555-0150");
      await setVal(a, "fS1", "07:00");
      await setVal(a, "fE1", "11:00");
      check("admin: the notes are labelled as the database has them (the person and their lead can read them)",
        (await a.eval("document.querySelector('label[for=fNotes]').textContent")) === "Notes (the person and their lead can read them)");
      await shoot(a, "employee_editor_admin", "desktop", false);
      await a.eval("document.getElementById('adForm').requestSubmit(); true");
      await a.until("!document.getElementById('adForm') && /Quinn Example/.test(document.getElementById('adList').innerText)", 6000);
      const q = await db(a, "R.employees.find(e => e.full_name === 'Quinn Example')");
      check("admin: Quinn added, the texting number derived (+18055550150)", q && q.phone_e164 === "+18055550150" && q.normal_start1 === "07:00:00", JSON.stringify(q));
      await click(a, "#tabCrew");
      await a.until("document.querySelectorAll('.ad-crew').length >= 1", 4000);
      await a.eval("(() => { const box = document.querySelector('.ad-crew'); const s = box.querySelector('[data-pick]'); s.value = '" + "' + Array.from(s.options).find(o => /Quinn/.test(o.text)).value; box.querySelector('[data-addcrew]').click(); return true; })()");
      await a.until("/Quinn Example/.test(document.querySelector('.ad-crew .ad-chips').innerText)", 6000);
      check("admin: Quinn is in Riley's crew", (await db(a, "R.crew_members.filter(c => c.employee_id === " + q.id + ").length")) === 1);
      await bothThemes(a, "crews_admin", "desktop");
      await a.size(390, 844, true);
      await bothThemes(a, "crews_admin", "phone");
      await a.size(1280, 900, false);
    }, a);
    if (f) await attempt("field: Settings keeps the employee phone and address (update_my_contact)", async () => {
      await open(f, "/settings.html", "!document.getElementById('stEmpSec').hidden");
      await setVal(f, "stEmpPhone", "(805) 555-0166");
      await setVal(f, "stEmpAddress", "12 Sample St, Sandbox");
      await click(f, "#stEmpSave");
      await f.until("/Saved/.test(document.getElementById('stEmpMsg').textContent)", 6000);
      const me = await db(f, "R.employees.find(e => e.full_name === 'Jordan Field')");
      check("field: phone and address saved, the texting number follows", me.phone === "(805) 555-0166" && me.phone_e164 === "+18055550166" && me.address === "12 Sample St, Sandbox", JSON.stringify(me));
      await bothThemes(f, "settings_field", "desktop");
    }, f);

    /* ── 7. the review fixes ────────────────────────────────────────────── */
    if (l) await attempt("lead: a change whose live event never arrived — Confirm sends the screen's fingerprint (409); after the on-focus refresh rows and sign-offs agree and the signature carries what the screen shows", async () => {
      await open(l, "/timesheet-manager.html?week=" + lastSat, "document.querySelectorAll('#pmTableArea tbody tr[data-emp]').length > 0 && document.getElementById('pmLive').textContent === 'Live'");
      await sleep(900);
      const fri = addDaysTxt(lastSat, 6);
      const silent = (emp, hours) => l.eval("(() => { const R = DCR2Demo.engine.rows; const t = R.timesheets.find(x => x.employee_id === " + emp + " && x.work_date >= '" + lastSat +
        "' && x.work_date <= '" + fri + "' && x.kind === 'work'); DCR2Demo.engine.applyOps([{ k: 'row', t: 'timesheets', row: Object.assign({}, t, { hours: " + hours +
        ", version: (t.version || 1) + 1 }) }]); return t.id; })()");
      // (1) no refresh at all: the grid still shows the old hours -> the database refuses the screen's fingerprint
      const blair = EMP["Blair Sycamore"];
      const shown = await text(l, "tr[data-emp='" + blair + "'] .pm-cell-total");
      await silent(blair, 12);
      await sleep(400);
      check("silent change: the grid still shows the old total (" + shown + ")", (await text(l, "tr[data-emp='" + blair + "'] .pm-cell-total")) === shown);
      await click(l, "[data-conf='" + blair + "']");
      await l.until("!!document.getElementById('pmConfBtn')", 4000);
      const dialogHrs = await text(l, ".pm-conf-week");
      await click(l, "#pmConfBtn");
      await l.until("/Nothing was confirmed/.test(document.body.innerText)", 8000);
      const signed = await db(l, "R.timesheet_confirmations.filter(c => c.employee_id === " + blair + " && c.week_start === '" + lastSat + "').length");
      check("409: the hours the dialog showed (" + dialogHrs.replace(/\s+/g, " ") + ") are not what the database holds — nothing confirmed", signed === 0 && new RegExp(shown.replace(".", "\\.") + " hrs").test(dialogHrs), signed + " " + dialogHrs);
      await modalOk(l);
      await l.until("document.querySelector(\"tr[data-emp='" + blair + "'] .pm-cell-total\").innerText !== " + JSON.stringify(shown), 8000);
      // (2) the on-focus refresh (the same as the 90-second timer): rows AND sign-offs are read again
      const pat = EMP["Pat Newhire"];
      const before = await text(l, "tr[data-emp='" + pat + "'] .pm-cell-total");
      await silent(pat, 11);
      await l.call("Page.bringToFront").catch(() => null);          // a background tab is "hidden": the page refreshes only when seen
      await sleep(300);
      await l.eval("document.dispatchEvent(new Event('visibilitychange')); true");
      await l.until("document.querySelector(\"tr[data-emp='" + pat + "'] .pm-cell-total\").innerText !== " + JSON.stringify(before), 8000);
      const gridNow = await text(l, "tr[data-emp='" + pat + "'] .pm-cell-total");
      await click(l, "[data-conf='" + pat + "']");
      await l.until("!!document.getElementById('pmConfBtn')", 4000);
      const dlg = await text(l, ".pm-conf-week");
      await click(l, "#pmConfBtn");
      await l.until("!document.querySelector('.pm-detail-overlay') && !!document.querySelector(\"tr[data-emp='" + pat + "'].pm-row-confirmed\")", 8000);
      const mark = await db(l, "R.timesheet_confirmations.find(c => c.employee_id === " + pat + " && c.week_start === '" + lastSat + "')");
      check("after the refresh the grid shows " + gridNow + " h, the dialog the same, and the signature carries " + (mark && mark.hours_at_confirm) + " h",
        mark && Number(mark.hours_at_confirm) === Number(gridNow) && dlg.indexOf(gridNow + " hrs") !== -1 && gridNow !== before, JSON.stringify({ before, gridNow, dlg, mark }));
    }, l);

    if (m) await attempt("someone who has left (Finley): Team Sheets row, the Time Card link prints HIS card, his entry opens with him in the form; a lead's link to him shows no card", async () => {
      const finley = EMP["Finley Coyote"];
      const adminId = await db(m, "R.profiles.find(x => x.email === 'admin@demo.test').id");
      await m.eval("DCR2Demo.engine.insert({ uid: " + JSON.stringify(adminId) + " }, 'timesheets', { employee_id: " + finley + ", work_date: '" + lastWed + "', kind: 'work', project_id: " + SANDBOX +
        ", hours: 8, work_completed: 'Final week: cleanup.', source: 'portal' }); true");
      await open(m, "/timesheet-manager.html?week=" + lastSat, "!!document.querySelector(\"tr[data-emp='" + finley + "']\")");
      const link = await m.eval("document.querySelector(\"tr[data-emp='" + finley + "'] .pm-emp-tc\").getAttribute('href')");
      await shoot(m, "teamsheets_left_manager", "desktop", false);
      await open(m, "/" + link, "/WEEK TOTAL/.test(document.getElementById('tcSheet').innerText)", 12000, false);
      const tcs = await m.eval("({ who: document.querySelector('#tcSheet .who').innerText, sel: document.getElementById('tcEmp').value, url: location.search, total: document.querySelector('.tc tr.tot .num').textContent })");
      check("Time Card of Finley (left): his name, '(left)', his 8 h; the address keeps his id",
        /Finley Coyote/.test(tcs.who) && /\(left\)/.test(tcs.who) && tcs.sel === String(finley) && Number(tcs.total) === 8 && new RegExp("emp=" + finley + "\\b").test(tcs.url), JSON.stringify(tcs));
      await bothThemes(m, "timecard_left_manager", "desktop");
      await open(m, "/timesheet-manager.html?week=" + lastSat, "!!document.querySelector(\"tr[data-emp='" + finley + "']\")");
      await click(m, "tr[data-emp='" + finley + "'] [data-day='" + lastWed + "']");
      await m.until("!!document.querySelector('[data-edit]')", 4000);
      await click(m, "[data-edit]");
      await m.until("!!document.getElementById('pmForm')", 4000);
      const sel = await m.eval("({ v: document.getElementById('pmFormEmp').value, t: document.getElementById('pmFormEmp').selectedOptions[0].text })");
      check("his entry opens with him chosen ('Finley Coyote (left)')", sel.v === String(finley) && sel.t === "Finley Coyote (left)", JSON.stringify(sel));
      await shoot(m, "edit_left_manager", "desktop", false);
      await setVal(m, "pmFormHours", "7");
      await m.eval("document.getElementById('pmForm').requestSubmit(); true");
      await m.until("!document.getElementById('pmForm')", 8000);
      check("his entry corrected (7 h)", Number(await db(m, "R.timesheets.find(t => t.employee_id === " + finley + " && t.work_date === '" + lastWed + "').hours")) === 7);
      await click(m, "tr[data-emp='" + finley + "'] [data-day='" + lastWed + "']");
      await m.until("!!document.querySelector('[data-add]')", 4000);
      await click(m, "[data-add]");
      await m.until("!!document.getElementById('pmForm')", 4000);
      check("'+ Add entry for this day' on his row presets him", (await m.eval("document.getElementById('pmFormEmp').value")) === String(finley));
      await m.eval("document.querySelectorAll('.pm-detail-overlay [data-close]').forEach(b => b.click()); true");
      // the PDF chooser opened on his entry offers him, ticked (his final week can still be sent)
      const picks = await m.eval("(async () => { const sh = await import('/js/pages/ts-shared.js'); const sb = await import('/js/sb.js'); const ctx = await sh.context(await sb.me());" +
        " const P = await import('/js/timesheet-pdf.js'); const o = P.openPdf({ ctx, anchor: '" + lastWed + "', employeeId: " + finley + ", list: async () => [], company: 'DCR' });" +
        " const on = Array.from(o.el.querySelectorAll('.tp-pick')).filter(x => x.querySelector('input').checked).map(x => x.textContent.trim()); o.close(); return on; })()");
      check("the PDF chooser opened on his entry offers him, ticked ('Finley Coyote (left)')", picks.length === 1 && /^Finley Coyote \(left\)/.test(picks[0]), JSON.stringify(picks));
      // the new-entry form never offers someone who has left
      await click(m, "#pmAddBtn");
      await m.until("!!document.getElementById('pmForm')", 4000);
      check("Add Entry (no one chosen) does not offer Finley", await m.eval("!Array.from(document.getElementById('pmFormEmp').options).some(o => o.value === '" + finley + "')"));
      await m.eval("document.querySelectorAll('.pm-detail-overlay [data-close]').forEach(b => b.click()); true");
      if (l) {
        await open(l, "/report-timecard.html?emp=" + finley + "&week=" + lastSat, "/Choose an employee/.test(document.getElementById('tcSheet').innerText) || /WEEK TOTAL/.test(document.getElementById('tcSheet').innerText)", 12000, false);
        const lc = await l.eval("({ sheet: document.getElementById('tcSheet').innerText.slice(0, 120), sel: document.getElementById('tcEmp').value })");
        check("lead: a Time Card link naming someone outside the crew shows 'Choose an employee', never the lead's own card", /Choose an employee/.test(lc.sheet) && lc.sel === "", JSON.stringify(lc));
      }
    }, m);

    if (pages.find((x) => x.name === "admin")) await attempt("a lead without a crew: no Batch Entry card, no Batch link on Team Sheets, the batch page points to the Time Sheet", async () => {
      const quinn = await db(a, "R.profiles.find(x => x.email === 'manager2@demo.test').id");
      await a.eval("DCR2Demo.remoteEdit('profiles', " + JSON.stringify(quinn) + ", { role: 'lead', can_see_prices: false }, 'admin'); true");
      const q = await newPage(cdp, "lead_nocrew", OUT); pages.push(q);
      await q.size(1280, 900, false);
      await signIn(q, "manager2", "dashboard.html");
      await q.until("document.querySelectorAll('.hm-card').length > 2", 8000);
      await sleep(1200);                                              // the crew read has answered
      const cards = await q.eval("Array.from(document.querySelectorAll('.hm-card .tt')).map(n => n.textContent)");
      check("crew-less lead: Team Sheets yes, Batch Entry no", cards.includes("Team Sheets") && !cards.includes("Batch Entry"), cards.join("|"));
      await open(q, "/timesheet-manager.html", "!!document.getElementById('pmScopeNote').textContent");
      check("crew-less lead: no Batch Entry link on Team Sheets", await q.eval("document.getElementById('pmBatchLink').hidden"));
      await open(q, "/timesheet-batch.html", "!!document.getElementById('btNoCrew')");
      check("crew-less lead: the batch page says why and links the Time Sheet", await q.eval("/leads with a crew/.test(document.getElementById('btNoCrew').innerText) && document.getElementById('btToTimesheet').getAttribute('href') === 'timesheet.html' && !document.getElementById('btEmpList')"));
      await bothThemes(q, "batch_nocrew_lead", "desktop");
    }, a);

    if (l) await attempt("desk Time Sheet at tablet widths: every card's buttons stay inside the card", async () => {
      const out = [];
      for (const w of [1280, 1024, 900, 820, 768, 720]) {
        await l.size(w, 1000, false);
        await open(l, "/timesheet.html?view=desktop", "document.querySelectorAll('.cal-card').length > 0");
        await sleep(300);
        out.push(await l.eval("(() => { let n = 0, over = 0, worst = 0; document.querySelectorAll('.cal-card').forEach(c => { const r = c.getBoundingClientRect(); c.querySelectorAll('.card-action').forEach(a => { const x = a.getBoundingClientRect(); n++; const d = x.right - r.right; if (d > 0.5) { over++; worst = Math.max(worst, d); } }); }); return { w: innerWidth, buttons: n, over, worst: Math.round(worst), page: location.pathname }; })()"));
        if (w === 768) await bothThemes(l, "timesheet_lead", "tablet");
      }
      await l.size(1280, 900, false);
      check("no card button past its card's edge at 1280, 1024, 900, 820, 768, 720 px", out.every((o) => o.buttons > 0 && o.over === 0 && /timesheet\.html$/.test(o.page)), JSON.stringify(out));
    }, l);

    /* ── 8. no security-policy violation, no console error ─────────────── */
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

function addDaysTxt(ymd, n) {
  const [y, mo, d] = ymd.split("-").map(Number);
  const x = new Date(Date.UTC(y, mo - 1, d + n));
  return x.getUTCFullYear() + "-" + String(x.getUTCMonth() + 1).padStart(2, "0") + "-" + String(x.getUTCDate()).padStart(2, "0");
}

main().catch((e) => { console.error(e); process.exit(2); });
