#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the P5a Progress Chart in the DEMO (development only).

     node tools/e2e-p5a-pm.mjs [--out <dir>] [--chrome <path>] [--shots all|none] [--roles a,b,c]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with M5a's rules - tools/fake/
   p5a-est.js and p5a-pm.js; nothing goes to Supabase) and drives a local Chrome or Edge headless:

   - every role (admin, manager without prices - Q1 -, a manager with prices, accountant, lead, field, viewer): the
     home card; the chart of the sandbox job (a lane per live estimate item, the quotes and change orders listed, the
     flags); the money cards only with prices, the money band only with prices AND financials; for anyone without
     prices NO amount anywhere in the page's HTML - the chart, the drawer, the printed report (P5 acceptance check 1);
     the drawer's controls by role (flags: admin, manager, lead; a follow-up: quote editors);
   - the printed status report: the worksite copy (no money column at all) for people without prices, the full copy
     with its totals for the others, and their "Hide prices" switch taking every amount out of the page;
   - typed amounts (the M5a review): the office names items with amounts, flags one with a "$" in its note and names
     an item document with one - the price person's "Hide prices" copy prints no "$" (the words masked again), the
     drawer of a manager without prices shows none (the document's name masked), a quick note lands in the log as
     "[name with [amount]] …" for the admin AND the lead (the database's scrub rule, never a display mask), the vendor
     follow-up e-mail carries no amount, and "N of M items priced" / the bidding % read the same for the admin, a
     manager without prices and a lead (estimate_item_totals.priced); report-pm on a phone: the page never scrolls
     sideways (the item table scrolls in its sheet);
   - a lead flags an item blocked and clears it (the chart's badge, the flag row with by / at, one amount-free log line
     each); a manager with prices records a follow-up on the overdue quote (counted, stamped today, the warning
     quiets); an admin advances a project's stage from a milestone (the status row in the log);
   - the picker (search, Resume) and the bidding view of a job still being estimated;
   - phone (390 px: no sideways scroll of the page) and desktop, light and dark;
   - no Content-Security-Policy violation and no console error on any page.
   Screenshots (--shots all): pm_<what>_<role>_<light|dark>_<desktop|phone>.png into --out.
   Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p5a-pm")));
const SHOTS = arg("--shots", "all");
const ROLES = (arg("--roles", "admin,manager,manager2,accountant,lead,field,viewer")).split(",").filter(Boolean);
const SHOT_ROLES = ["admin", "manager", "lead", "viewer"];
const PRICES = { admin: true, manager: false, manager2: true, accountant: true, lead: false, field: false, viewer: false };
const MONEY = { admin: true, accountant: true };
const FLAGS = { admin: true, manager: true, manager2: true, lead: true };
const CHASE = { admin: true, manager2: true, accountant: true };
const AMOUNT = /\$\s?\d/;

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
        try { where = " @ " + await page.eval("location.href + ' :: ' + (document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(-500) : '')"); }
        catch (x) { where = " @ (page not answering: " + x.message + ")"; }
      }
      check(name, false, String(e && e.message || e).slice(0, 400) + where);
    }
  };
  const TOPBAR = "!!document.querySelector('.dcr2-topbar .p2-badge')";
  async function open(p, path, marker, ms, noBar) {
    await p.goto(base + path, 150);
    const here = "(location.pathname).indexOf(" + JSON.stringify(path.split("?")[0].split("#")[0]) + ") === 0";
    await p.until(here + (noBar ? "" : " && " + TOPBAR) + (marker ? " && (" + marker + ")" : ""), ms || 15000);
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
  const text = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); return n ? n.innerText : ''; })()");
  const html = (p) => p.eval("document.documentElement.outerHTML");
  const svgClick = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); if (!n) throw new Error('no ' + " + JSON.stringify(sel) +
    "); n.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()");
  const setVal = (p, id, value) => p.eval("(() => { const i = document.getElementById(" + JSON.stringify(id) + "); i.focus(); i.value = " + JSON.stringify(value) +
    "; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
  const modalOk = (p) => p.eval("(() => { const b = document.getElementById('dcrMoYes'); if (b) b.click(); return !!b; })()");
  const CHART = "!!document.querySelector('#pmRoot svg') && !document.querySelector('#pmRoot .pm-empty:only-child')";

  async function shoot(p, name, device, dark, full) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1440;
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    await sleep(350);
    const h = full === false ? (device === "phone" ? 844 : 900) : await p.eval("Math.max(" + (device === "phone" ? 844 : 900) + ", Math.min(4200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(450);
    const file = "pm_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: device === "phone" ? 844 : 900, deviceScaleFactor: 1, mobile: device === "phone" });
    await p.dark(false);
  }
  async function bothThemes(p, name, device, full) { await shoot(p, name, device, false, full); await shoot(p, name, device, true, full); }

  try {
    /* ── 0. a clean demo database ──────────────────────────────────────── */
    const a = await newPage(cdp, "setup", OUT); pages.push(a);
    await a.size(1440, 900, false);
    await a.goto(base + "/manifest.json", 50);
    await a.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");
    await signIn(a, "admin", "dashboard.html");
    const J = await db(a, `(() => {
      const num = (n) => R.projects.find((p) => p.number === n);
      const sb = num("A267");
      const live = R.estimates.filter((e) => e.project_id === sb.id && !e.deleted_at && !e.archived_at && e.status !== "declined").map((e) => e.id);
      const items = R.estimate_items.filter((i) => live.includes(i.estimate_id) && !i.deleted_at);
      const byName = (n) => (items.find((i) => i.name === n) || {}).id;
      return { sb: sb.id, bid: num("A301").id, sent: num("A302").id, lanes: items.length, quotes: R.quotes.filter((q) => q.project_id === sb.id).length,
        floor: byName("Floor joists and subfloor"), inner: byName("Interior walls 2x4"), roof: byName("Set trusses and sheath the roof"),
        overdue: (R.quotes.find((q) => q.project_id === sb.id && q.status === "requested" && q.follow_ups === 1) || {}).id };
    })()`);
    check("demo: the sandbox job's estimates, quotes and change orders, flags and money (tools/fake/p5a-est.js + p5a-pm.js)",
      J.lanes >= 10 && J.quotes >= 8 && J.floor && J.inner && J.roof && J.overdue &&
      (await db(a, "R.estimate_item_flags.length >= 4 && R.bills.length >= 4 && R.invoices.length >= 2")), JSON.stringify(J));

    /* ── 1. every role: home card, chart, drawer, report ───────────────── */
    for (const role of ROLES) {
      const p = await newPage(cdp, role, OUT); pages.push(p);
      await p.size(1440, 900, false);
      const shots4 = SHOT_ROLES.includes(role);
      await attempt(role + ": the Progress Chart", async () => {
        await signIn(p, role, "dashboard.html");
        await p.until("document.querySelectorAll('.hm-card').length > 2", 8000);
        const cards = await p.eval("Array.from(document.querySelectorAll('.hm-card .tt')).map(n => n.childNodes[0].textContent)");
        check(role + ": home has the Progress Chart card", cards.includes("Progress Chart"), cards.join("|"));
        await open(p, "/pm.html?id=" + J.sb, CHART);
        const lanes = await p.eval("document.querySelectorAll('[data-pm$=\":label\"]').length");
        const expanded = await p.eval("document.querySelectorAll('[data-pm^=\"band:\"]').length");
        // in progress: the execution region is open; open bidding too, to see the quote tiles
        if (await p.eval("!!document.querySelector('[data-band=A][aria-expanded=false]')")) {
          await p.eval("document.querySelector('[data-band=A]').click(); true");
          await p.until("!!document.querySelector('[data-band=A][aria-expanded=true]')", 5000);
        }
        const labels = await p.eval("document.querySelectorAll('[data-pm$=\":label\"]').length");
        check(role + ": a lane per live estimate item (" + J.lanes + "), labels in both regions", labels === J.lanes * 2 && lanes >= J.lanes && expanded >= 0, labels + " / " + lanes);
        const cardsTxt = await text(p, ".pm-cards");
        check(role + ": money cards " + (PRICES[role] ? "shown" : "not shown"), PRICES[role] ? /estimate/i.test(cardsTxt) && AMOUNT.test(cardsTxt) : cardsTxt === "", cardsTxt.slice(0, 200));
        const band = await p.eval("!!document.querySelector('.pm-money-band')");
        check(role + ": the money band " + (MONEY[role] ? "shown (prices and financials)" : "not drawn"), band === !!MONEY[role]);
        const tiles = await p.eval("Array.from(new Set(Array.from(document.querySelectorAll('[data-pm^=\"lane:\"]')).map(g => g.getAttribute('data-pm').split(':').pop()))).filter(k => k !== 'label').sort().join(',')");
        check(role + ": tiles " + (MONEY[role] ? "A0..B6" : "A0..A2 and Awarded only"), tiles === (MONEY[role] ? "A0,A1,A2,B1,B2,B3,B4,B5,B6" : "A0,A1,A2,B1"), tiles);
        if (!PRICES[role]) {
          const h = await html(p);
          check(role + ": no amount anywhere in the chart page's HTML (P5 check 1)", !AMOUNT.test(h), (h.match(/.{40}\$\s?\d.{20}/) || [""])[0]);
        }
        // the drawer of the floor lane: its quotes (both vendors, an awarded one), the controls by role
        await svgClick(p, '[data-pm="lane:i' + J.floor + ':label"]');
        await p.until("document.getElementById('pmDrawer').classList.contains('open') && !!document.querySelector('#pmDrawer .pm-qt')", 6000);
        const dr = await p.eval("({ t: document.getElementById('pmDrawer').innerText, flags: document.querySelectorAll('#pmDrawer [data-flag]').length, note: !!document.getElementById('pmNote'), h: document.getElementById('pmDrawer').innerHTML })");
        check(role + ": the drawer lists the item's quotes (awarded and declined) " + (PRICES[role] ? "with amounts" : "without an amount"),
          /Awarded/.test(dr.t) && /Declined/.test(dr.t) && (PRICES[role] ? AMOUNT.test(dr.t) : !AMOUNT.test(dr.h)), dr.t.slice(0, 300));
        check(role + ": flag buttons " + (FLAGS[role] ? "offered" : "not offered"), (dr.flags > 0) === !!FLAGS[role], dr.flags);
        check(role + ": the quick note " + (["admin", "manager", "manager2", "accountant", "lead"].includes(role) ? "offered" : "not offered"),
          dr.note === ["admin", "manager", "manager2", "accountant", "lead"].includes(role));
        if (shots4) await bothThemes(p, "drawer_" + role, "desktop", false);
        await p.eval("document.getElementById('pmDrawerX').click(); true");
        // the inner-walls drawer: the overdue quote's follow-up for quote editors only
        await svgClick(p, '[data-pm="lane:i' + J.inner + ':A0"]');
        await p.until("document.getElementById('pmDrawer').classList.contains('open')", 6000);
        const chase = await p.eval("!!document.querySelector('#pmDrawer [data-chase]')");
        check(role + ": 'Record a follow-up' " + (CHASE[role] ? "offered" : "not offered") + " on the open quote", chase === !!CHASE[role]);
        await p.eval("document.getElementById('pmDrawerX').click(); true");
        if (shots4) {
          await bothThemes(p, "chart_" + role, "desktop");
          await p.size(390, 844, true);
          await open(p, "/pm.html?id=" + J.sb, CHART);
          const sw = await p.eval("document.documentElement.scrollWidth");
          check(role + ": phone - the page does not scroll sideways (the chart scrolls in its own box)", sw <= 391, sw);
          await bothThemes(p, "chart_" + role, "phone");
          await svgClick(p, '[data-pm="lane:i' + J.roof + ':label"]');
          await p.until("document.getElementById('pmDrawer').classList.contains('open')", 6000);
          await shoot(p, "drawer_" + role, "phone", false, false);
          await p.size(1440, 900, false);
        }
        // the printed report
        await open(p, "/report-pm.html?id=" + J.sb, "!!document.querySelector('#rpSheet table')", 15000, true);
        const rp = await p.eval("({ th: Array.from(document.querySelectorAll('#rpSheet th')).map(n => n.textContent), wk: /WORKSITE COPY/.test(document.getElementById('rpSheet').innerText), hide: !document.getElementById('rpHideWrap').hidden, h: document.documentElement.outerHTML })");
        const fit = await p.eval("({ sheet: document.getElementById('rpSheet').getBoundingClientRect().right, table: document.querySelector('#rpSheet table').getBoundingClientRect().right, page: document.documentElement.scrollWidth, win: window.innerWidth })");
        check(role + ": report - the item table fits its sheet, the page does not scroll sideways", fit.table <= fit.sheet + 1 && fit.page <= fit.win + 1, JSON.stringify(fit));
        if (PRICES[role]) {
          check(role + ": report - the full copy (Estimate and Awarded" + (MONEY[role] ? ", Billed and Paid" : "") + " columns, totals) and a 'Hide prices' switch",
            rp.th.includes("Estimate") && rp.th.includes("Awarded") && rp.th.includes("Billed to us") === !!MONEY[role] && rp.hide && !rp.wk && AMOUNT.test(rp.h), rp.th.join("|"));
          if (role === "admin" || role === "manager2") await shoot(p, "report_" + role, "desktop", false);
          await p.eval("document.getElementById('rpHideMoney').click(); true");
          await p.until("/WORKSITE COPY/.test(document.getElementById('rpSheet').innerText)", 5000);
          const h2 = await html(p);
          check(role + ": report - 'Hide prices' takes every amount out of the page", !AMOUNT.test(h2) && !(await p.eval("Array.from(document.querySelectorAll('#rpSheet th')).some(n => n.textContent === 'Awarded')")),
            (h2.match(/.{40}\$\s?\d.{20}/) || [""])[0]);
        } else {
          check(role + ": report - the worksite copy only: no money column, no switch, no amount in the page",
            rp.wk && !rp.hide && !rp.th.includes("Estimate") && !rp.th.includes("Awarded") && !AMOUNT.test(rp.h), rp.th.join("|") + " " + (rp.h.match(/.{40}\$\s?\d.{20}/) || [""])[0]);
          if (role === "lead" || role === "manager") await shoot(p, "report_" + role, "desktop", false);
        }
      }, p);
    }

    /* ── 2. a lead flags an item, then clears it ──────────────────────── */
    const lead = pages.find((x) => x.name === "lead");
    if (lead) await attempt("lead: flag an item blocked and clear it", async () => {
      await open(lead, "/pm.html?id=" + J.sb + "&item=i" + J.inner, CHART + " && document.getElementById('pmDrawer').classList.contains('open')");
      const n0 = await db(lead, "R.activity.filter(a => a.project_id === " + J.sb + ").length");
      await lead.eval("document.querySelector('#pmDrawer [data-flag=blocked]').click(); true");
      await lead.until("!!document.querySelector('.dcr-mo.open')", 5000);
      await setVal(lead, "dcrMoF0", "Waiting on the engineer's letter");
      await shoot(lead, "flag_dialog_lead", "desktop", false, false);
      await modalOk(lead);
      await lead.until("(DCR2Demo.engine.rows.estimate_item_flags.find(f => f.item_id === " + J.inner + ") || {}).state === 'blocked'", 6000);
      await lead.until("/BLOCKED/.test(document.getElementById('pmDrawer').innerText)", 6000);
      const f = await db(lead, "R.estimate_item_flags.find(f => f.item_id === " + J.inner + ")");
      const who = await lead.eval("DCR2Demo.people.find(p => p.key === 'lead').id");
      const lines = await db(lead, "R.activity.filter(a => a.project_id === " + J.sb + ").slice(" + n0 + ").map(a => a.kind + ' ' + a.text)");
      check("lead: the flag is set (by the lead, at now), the chart's lane reads BLOCKED, one amount-free log line",
        f.by === who && !!f.at && f.note === "Waiting on the engineer's letter" && lines.length === 1 && /^system Item ".+" flagged blocked$/.test(lines[0]) &&
        (await lead.eval("/BLOCKED/.test(document.querySelector('[data-pm=\"lane:i" + J.inner + ":label\"]').textContent)")), JSON.stringify({ f, lines }));
      await shoot(lead, "flagged_lead", "desktop", false, false);
      await lead.eval("document.querySelector('#pmDrawer [data-flag=clear]').click(); true");
      await lead.until("!DCR2Demo.engine.rows.estimate_item_flags.some(f => f.item_id === " + J.inner + ")", 6000);
      const last = await db(lead, "R.activity.filter(a => a.project_id === " + J.sb + ").slice(-1)[0].text");
      check("lead: the flag cleared ('… flag cleared' in the log)", /flag cleared$/.test(last), last);
    }, lead);

    /* ── 3. a manager with prices records a follow-up on the overdue quote ── */
    const m2 = pages.find((x) => x.name === "manager2");
    if (m2) await attempt("manager2: record a follow-up", async () => {
      await open(m2, "/pm.html?id=" + J.sb, CHART);
      const before = await m2.eval("document.querySelector('[data-pm=\"lane:i" + J.inner + ":A0\"]').textContent");
      await svgClick(m2, '[data-pm="lane:i' + J.inner + ':A0"]');
      await m2.until("!!document.querySelector('#pmDrawer [data-chase]')", 6000);
      await m2.eval("document.querySelector('#pmDrawer [data-chase]').click(); true");
      await m2.until("(DCR2Demo.engine.rows.quotes.find(q => q.id === " + J.overdue + ") || {}).follow_ups === 2", 6000);
      const q = await db(m2, "R.quotes.find(q => q.id === " + J.overdue + ")");
      const today = await m2.eval("new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())");
      await m2.until("!/⚠/.test(document.querySelector('[data-pm=\"lane:i" + J.inner + ":A0\"]').textContent)", 6000);
      const after = await m2.eval("document.querySelector('[data-pm=\"lane:i" + J.inner + ":A0\"]').textContent");
      check("manager2: the follow-up is counted and stamped today; the overdue warning quiets", q.last_follow_up === today && /⚠/.test(before) && /✓/.test(after) && !/⚠/.test(after),
        before + " -> " + after + " " + q.last_follow_up);
    }, m2);

    /* ── 4. an admin advances a job from a milestone; the picker; bidding ── */
    const ad = pages.find((x) => x.name === "admin");
    if (ad) await attempt("admin: the stage from a milestone, the picker, the bidding view", async () => {
      await open(ad, "/pm.html?id=" + J.sent, CHART);
      await svgClick(ad, '[data-pm="ms:4"]');
      await ad.until("document.getElementById('pmPop').classList.contains('open') && !!document.getElementById('ppAdvance')", 5000);
      await shoot(ad, "milestone_admin", "desktop", false, false);
      await ad.eval("document.getElementById('ppAdvance').click(); true");
      await ad.until("!!document.querySelector('.dcr-mo.open')", 5000);
      await modalOk(ad);
      await ad.until("(DCR2Demo.engine.rows.projects.find(p => p.id === " + J.sent + ") || {}).status === 'approved'", 6000);
      const st = await db(ad, "R.activity.filter(a => a.project_id === " + J.sent + " && a.kind === 'status').slice(-1)[0]");
      check("admin: Advance to Approved - the project moved, the database wrote the status line", st && st.to_status === "approved" && st.from_status === "sent", JSON.stringify(st));
      await ad.until("/Approved/.test(document.querySelector('.pm-pill').textContent)", 6000);
      await open(ad, "/pm.html?id=" + J.bid, CHART);
      check("admin: a job being estimated opens on the bidding region", await ad.eval("!!document.querySelector('[data-band=A][aria-expanded=true]') && !!document.querySelector('[data-band=B][aria-expanded=false]')"));
      await bothThemes(ad, "bidding_admin", "desktop");
      await open(ad, "/pm.html", "!!document.getElementById('pkSearch') && document.querySelectorAll('.pk-card').length > 20");
      const resume = await text(ad, ".pm-banner");
      await setVal(ad, "pkSearch", "A267");
      const shown = await ad.eval("Array.from(document.querySelectorAll('.pk-card')).filter(c => !c.hidden).map(c => c.querySelector('.k').textContent)");
      check("admin: the picker - Resume the last chart, the search finds the job", /Resume/.test(resume) && shown.length === 1 && shown[0] === "A267", resume + " / " + shown.join(","));
      await setVal(ad, "pkSearch", "");
      await shoot(ad, "picker_admin", "desktop", false, false);
      await ad.size(390, 844, true);
      await open(ad, "/pm.html", "document.querySelectorAll('.pk-card').length > 20");
      check("admin: phone - the picker does not scroll sideways", (await ad.eval("document.documentElement.scrollWidth")) <= 391);
      await shoot(ad, "picker_admin", "phone", false, false);
      await ad.size(1440, 900, false);
      // the project page links to the chart
      await open(ad, "/project.html?id=" + J.sb, "!!document.getElementById('pjPm') && /pm\\.html\\?id=/.test(document.getElementById('pjPm').getAttribute('href'))");
      check("admin: the project page links to its Progress Chart", (await ad.eval("document.getElementById('pjPm').getAttribute('href')")) === "pm.html?id=" + J.sb);
    }, ad);

    /* ── 6. typed amounts in the words (the M5a review) ───────────────── */
    const mgr = pages.find((x) => x.name === "manager");
    if (ad) await attempt("typed amounts: the worksite copy, the drawer, the quick note, the follow-up e-mail, the same 'priced'", async () => {
      await open(ad, "/pm.html?id=" + J.sb, CHART);
      const uid = await ad.eval("DCR2Demo.people.find(p => p.key === 'admin').id");
      const fileId = await db(ad, "(R.files.find(f => f.project_id === " + J.sb + " && f.estimate_item_id !== null && f.estimate_item_id !== undefined && f.folder === 'item' && !f.deleted_at) || {}).id");
      const fileItem = await db(ad, "R.files.find(f => f.id === " + fileId + ").estimate_item_id");
      const edits = await ad.eval(`(() => {
        const E = DCR2Demo.engine, ctx = { uid: ${JSON.stringify(uid)} }, out = [];
        const ok = (r, what) => { if (r && r.error) out.push(what + ": " + r.error.code + " " + r.error.message); };
        ok(DCR2Demo.remoteEdit('estimate_items', ${J.inner}, { name: 'Interior walls 2x4 (yard said $4.10 a stud)' }, 'manager_prices'), 'inner');
        ok(DCR2Demo.remoteEdit('estimate_items', ${J.roof}, { name: 'Set trusses (credit asked $1,200)' }, 'manager_prices'), 'roof');
        const has = E.rows.estimate_item_flags.some((x) => x.item_id === ${J.roof});
        ok(has ? E.update(ctx, 'estimate_item_flags', { state: 'important', note: 'client deposit $1,500 first', due_date: null }, { filters: [{ col: 'item_id', op: 'eq', val: ${J.roof} }] })
               : E.insert(ctx, 'estimate_item_flags', { item_id: ${J.roof}, state: 'important', note: 'client deposit $1,500 first' }, {}), 'flag');
        ok(E.update(ctx, 'files', { name: 'Valley Truss quote $4,850.pdf' }, { filters: [{ col: 'id', op: 'eq', val: ${fileId} }] }), 'file');
        return out;
      })()`);
      check("typed amounts: the office's edits (item names, a flag note, a document name)", edits.length === 0 && !!fileId, JSON.stringify(edits));
      // the admin's own worksite copy: no "$" on the sheet, the words masked
      await open(ad, "/report-pm.html?id=" + J.sb + "&copy=worksite", "/WORKSITE COPY/.test((document.getElementById('rpSheet') || {}).innerText || '')", 15000, true);
      const wk = await ad.eval("({ h: document.getElementById('rpSheet').innerHTML, t: document.getElementById('rpSheet').innerText, box: document.getElementById('rpHideMoney').checked })");
      check("admin: report-pm 'Hide prices' with amounts typed into item names and a flag note - no \"$\" on the sheet, the words masked",
        wk.box && !AMOUNT.test(wk.h) && /yard said \(?amount hidden/.test(wk.t) && /client deposit \(amount hidden\) first/.test(wk.t) && /credit asked/.test(wk.t),
        (wk.h.match(/.{40}\$\s?\d.{20}/) || [""])[0] + " | " + wk.t.slice(0, 200));
      if (SHOTS !== "none") await shoot(ad, "report_worksite_typed_admin", "desktop", false);
      await ad.eval("document.getElementById('rpHideMoney').click(); true");
      await ad.until("!/WORKSITE COPY/.test(document.getElementById('rpSheet').innerText)", 5000);
      check("admin: the full copy prints the words as typed (Q28)", /credit asked \$1,200/.test(await text(ad, "#rpSheet")));
      // report-pm on a phone: the page never scrolls sideways; the item table scrolls inside its sheet
      await ad.size(390, 844, true);
      await open(ad, "/report-pm.html?id=" + J.sb, "!!document.querySelector('#rpSheet table')", 15000, true);
      const ph = await ad.eval("(() => { const w = document.querySelector('#rpSheet .tblwrap'); const s = document.getElementById('rpSheet').getBoundingClientRect(); return { page: document.documentElement.scrollWidth, win: innerWidth, wrapRight: w.getBoundingClientRect().right, sheetRight: s.right, scrolls: w.scrollWidth > w.clientWidth }; })()");
      check("admin: report-pm on a phone (390 px) - no sideways scroll of the page, the item table scrolls inside its sheet",
        ph.page <= ph.win + 1 && ph.wrapRight <= ph.sheetRight + 1 && ph.scrolls, JSON.stringify(ph));
      await shoot(ad, "report_admin", "phone", false);
      await ad.size(1440, 900, false);
      // the same "priced" for every role: N of M items priced and the bidding %
      const head = async (pg) => {
        await open(pg, "/pm.html?id=" + J.sb, CHART);
        return pg.eval("(() => { const t = Array.from(document.querySelectorAll('.pm-bandtitle')).map(b => b.textContent).join(' | '); const a = /(\\d+) of (\\d+) items priced/.exec(t); const b = /BIDDING\\s+(\\d+)%/i.exec(t); return (a ? a[0] : '?') + ' | ' + (b ? b[0] : '?'); })()");
      };
      const hAdmin = await head(ad);
      for (const pg of [mgr, lead].filter(Boolean)) {
        const h = await head(pg);
        check(pg.name + ": the same 'items priced' and bidding % as the admin (estimate_item_totals.priced)", h === hAdmin && !/\?/.test(h), h + " vs " + hAdmin);
      }
      // a manager without prices: the drawer of the item with the document - no amount in its HTML, the name masked
      if (mgr) {
        await open(mgr, "/pm.html?id=" + J.sb + "&item=i" + fileItem, CHART + " && document.getElementById('pmDrawer').classList.contains('open')");
        await mgr.eval("document.querySelectorAll('#pmDrawer .pm-sec').forEach(s => s.classList.add('open')); true");
        const dh = await mgr.eval("document.getElementById('pmDrawer').innerHTML");
        check("manager (no prices): the drawer's Documents show the file's name masked - no amount in the drawer's HTML",
          !AMOUNT.test(dh) && /Valley Truss quote \(amount hidden\)\.pdf/.test(dh), (dh.match(/.{40}\$\s?\d.{20}/) || [""])[0]);
        if (SHOTS !== "none") await shoot(mgr, "drawer_typed_manager", "desktop", false, false);
      }
      // the quick note: the same stored words for the admin and the lead, "[amount]" for the typed amount
      const noteAs = async (pg, words) => {
        await open(pg, "/pm.html?id=" + J.sb + "&item=i" + J.roof, CHART + " && document.getElementById('pmDrawer').classList.contains('open') && !!document.getElementById('pmNote')");
        await setVal(pg, "pmNote", words);
        await pg.eval("document.getElementById('pmNoteSave').click(); true");
        await pg.until("/Added to the project log/.test((document.getElementById('pmNoteMsg') || {}).textContent || '')", 6000);
        return db(pg, "R.activity.filter(a => a.project_id === " + J.sb + " && a.kind === 'note').slice(-1)[0].text");
      };
      const nAdmin = await noteAs(ad, "inspection passed");
      const nLead = lead ? await noteAs(lead, "inspection passed") : nAdmin;
      check("the quick note names the item by the database's scrub rule for every role: no amount, no display mask in the shared log",
        nAdmin === "[Set trusses (credit asked [amount])] inspection passed" && nLead === nAdmin, nAdmin + " | " + nLead);
      // the vendor follow-up e-mail: no amount typed into the item's name goes to the vendor
      await open(ad, "/pm.html?id=" + J.sb + "&item=i" + J.inner, CHART + " && document.getElementById('pmDrawer').classList.contains('open')");
      await ad.eval("window.__mail = []; const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (/^mailto:/.test(this.href)) { window.__mail.push(this.href); return; } return o.call(this); }; true");
      await ad.until("!!document.querySelector('#pmDrawer [data-chase]')", 6000);
      await ad.eval("document.querySelector('#pmDrawer [data-chase]').click(); true");
      await ad.until("window.__mail.length > 0", 6000);
      const mail = decodeURIComponent(await ad.eval("window.__mail[0]"));
      check("the vendor follow-up e-mail carries no amount typed into the item's name", !/\$\s?\d|4\.10/.test(mail) && /yard said \(amount hidden\) a stud/.test(mail), mail.slice(0, 300));
    }, ad);

    /* ── 5. no security-policy violation, no console error ─────────────── */
    for (const p of pages) {
      const bad = p.log.filter((x) => /CSP-VIOLATION|Content Security Policy/i.test(x.text) || x.level === "exception" ||
        (x.level === "error" && !/favicon\.ico|net::ERR_ABORTED|ERR_INTERNET_DISCONNECTED|Failed to fetch|demo: offline|mailto:/.test(x.text + " " + (x.url || ""))));
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
