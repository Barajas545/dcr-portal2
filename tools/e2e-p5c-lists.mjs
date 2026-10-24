#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the P5c office lists in the DEMO (development only).

     node tools/e2e-p5c-lists.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with M5c's rules —
   tools/fake/p5c-lists.js; nothing goes to Supabase) and drives a local Chrome or Edge headless through Leads
   (leads.html), the Vehicle Board (vehicles.html) and Marketing Tasks (marketing.html), one role after another (the
   reads first, then the writes, so every role reads the same made-up rows):

   - who: Leads and Marketing for admin, manager, accountant and view-only (a lead and field are told the list is the
     office's and are sent none of it — no client's name in the page); Vehicles for everyone; New / Edit / Convert /
     Schedule / Complete only for admin and manager; the home page's cards and their counts-only badges per role;
   - money: a service's material cost and a marketing price, their totals and the form boxes, only with the financials
     switch (admin, the accountant, the demo approver — a manager with financials); nobody else is sent a cost or a price
     and no amount is in their page's HTML (an amount typed into a task's words shows "(amount hidden)" without prices);
   - the writes: a lead added with a name full of HTML (shown as typed, never run), edited (versioned), "contacted today",
     converted to a project in one step (the Board's next number, the lead linked, a second convert refused), deleted; a
     service scheduled and completed as an oil change (the vehicle stamped, the material cost kept for financials); a
     vehicle edited and retired; a marketing task marked Done (the database's day) and given a price;
   - phone (390 px: no page scrolls sideways) and desktop, light and dark;
   - no Content-Security-Policy violation and no console error on any page.
   Screenshots (--shots all): lists_<page>_<role>_<light|dark>_<desktop|phone>.png into --out.
   Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p5c-lists")));
const SHOTS = arg("--shots", "all");
const AMOUNT = /\$\s?\d/;
const ROLES = ["admin", "manager", "accountant", "lead", "field", "viewer"];
const OFFICE = ["admin", "manager", "accountant", "viewer"];
const WRITERS = ["admin", "manager"];
const FIN = ["admin", "accountant", "approver"];

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
  async function open(p, path, marker, ms) {
    await p.goto(base + path, 150);
    const here = "(location.pathname).indexOf(" + JSON.stringify(path.split("?")[0]) + ") === 0";
    await p.until(here + " && " + TOPBAR + (marker ? " && (" + marker + ")" : ""), ms || 15000);
  }
  async function signIn(p, key, next) {
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
    await p.goto(base + "/index.html" + (next ? "?next=" + encodeURIComponent(next) : ""), 150);
    await p.until("!!document.getElementById('loginForm') && !!window.DCR2Demo && !document.getElementById('loginFields').disabled", 8000);
    await p.eval("document.getElementById('email').value=" + JSON.stringify((key === "manager_prices" ? "manager2" : key) + "@demo.test") +
      ";document.getElementById('password').value='demo-password-1';document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname) && " + TOPBAR, 10000);
  }
  const db = (p, expr) => p.eval("(() => { const R = DCR2Demo.engine.rows; return " + expr + "; })()");
  const text = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); return n ? n.innerText : ''; })()");
  const html = (p) => p.eval("document.documentElement.outerHTML");
  const setVal = (p, id, value, ev) => p.eval("(() => { const i = document.getElementById(" + JSON.stringify(id) + "); i.focus(); i.value = " + JSON.stringify(value) +
    "; i.dispatchEvent(new Event(" + JSON.stringify(ev || "input") + ", { bubbles: true })); return true; })()");
  const click = (p, sel) => p.eval("(() => { const b = document.querySelector(" + JSON.stringify(sel) + "); if (!b) return false; b.click(); return true; })()");
  const fits = (p) => p.eval("({ page: document.documentElement.scrollWidth, win: innerWidth })");

  async function shoot(p, name, device, dark) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1440;
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    await sleep(300);
    const h = await p.eval("Math.max(" + (device === "phone" ? 844 : 900) + ", Math.min(4200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(400);
    const file = "lists_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: device === "phone" ? 844 : 900, deviceScaleFactor: 1, mobile: device === "phone" });
    await p.dark(false);
  }
  /** desktop light + dark, then a phone at 390 px (light + dark), and the phone does not scroll sideways */
  async function fourShots(p, name, marker) {
    await shoot(p, name, "desktop", false);
    await shoot(p, name, "desktop", true);
    await p.size(390, 844, true);
    await sleep(300);
    if (marker) await p.until(marker, 8000).catch(() => null);
    const f = await fits(p);
    check(name + ": a phone (390 px) - the page does not scroll sideways", f.page <= f.win + 1, JSON.stringify(f));
    await shoot(p, name, "phone", false);
    await shoot(p, name, "phone", true);
    await p.size(1440, 900, false);
  }

  const LEADS = "!document.getElementById('ldMain').hidden && !!document.querySelector('#ldList .ld-card')";
  const LEADS_DENIED = "!document.getElementById('ldDenied').hidden";
  const VEH = "!!document.querySelector('#vbAllList .vb-row')";
  const MK = "!document.getElementById('mkMain').hidden && !!document.querySelector('#mkList table.mk-tbl')";
  const MK_DENIED = "!document.getElementById('mkDenied').hidden";

  try {
    /* ── 0. the made-up data ───────────────────────────────────────────── */
    const setup = await newPage(cdp, "setup", OUT); pages.push(setup);
    await setup.size(1440, 900, false);
    await setup.goto(base + "/manifest.json", 50);
    await setup.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");
    await signIn(setup, "admin", "dashboard.html");
    const J = await db(setup, `({
      leads: R.leads.length, open: R.leads.filter((l) => !l.converted_project_id).length, names: R.leads.map((l) => l.client_name),
      vehicles: R.vehicles.length, live: R.vehicles.filter((v) => v.active !== false).length,
      costs: R.vehicle_maintenance_costs.filter((c) => c.material_cost !== null).map((c) => c.material_cost),
      tasks: R.marketing_tasks.length, prices: R.marketing_task_prices.filter((p) => p.price !== null).map((p) => p.price),
      t01: (R.vehicles.find((v) => v.fleet_number === "T-01") || {}).id,
    })`);
    check("demo: leads, a fleet with maintenance costs, marketing tasks with prices (tools/fake/p5c-lists.js)",
      J.leads >= 5 && J.open >= 4 && J.vehicles >= 5 && J.costs.length >= 2 && J.tasks >= 6 && J.prices.length >= 5, JSON.stringify(J));
    await setup.call("Page.navigate", { url: "about:blank" }).catch(() => null);
    const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    /* ── 1. every role: the home page, the three lists, who sees what ─── */
    for (const role of ROLES.concat(["approver"])) {
      const p = await newPage(cdp, role, OUT); pages.push(p);
      await p.size(1440, 900, false);
      await attempt(role + ": the office lists", async () => {
        await signIn(p, role, "dashboard.html");
        const office = OFFICE.includes(role) || role === "approver";
        const writer = WRITERS.includes(role) || role === "approver";
        const fin = FIN.includes(role);
        // the home page
        await p.until("!!document.querySelector('#hmSections .hm-card')", 8000);
        await p.until("!!document.querySelector('#hmVehicles .hm-badge')", 6000).catch(() => null);
        const cards = await p.eval("Array.from(document.querySelectorAll('#hmSections .hm-card .tt')).map(t => t.firstChild.textContent.trim())");
        check(role + ": home - Leads and Marketing Tasks " + (office ? "shown" : "not shown") + ", Vehicles shown",
          cards.includes("Leads") === office && cards.includes("Marketing Tasks") === office && cards.includes("Vehicles"), cards.join(", "));
        const vb = await text(p, "#hmVehicles .hm-badge");
        check(role + ": home - the Vehicles badge counts what is due this month", /^\d+ due$/.test(vb), vb);
        if (office) {
          await p.until("!!document.querySelector('#hmLeads .hm-badge')", 6000).catch(() => null);
          const lb = await text(p, "#hmLeads .hm-badge");
          check(role + ": home - the Leads badge (counts only)", /^\d+ (to call|open)$/.test(lb), lb);
        }
        if (role === "admin" || role === "field") await fourShots(p, "home_" + role, "!!document.querySelector('#hmVehicles')");

        // Leads
        if (office) {
          await open(p, "/leads.html", LEADS);
          const n = await p.eval("document.querySelectorAll('#ldList .ld-card').length");
          check(role + ": Leads - the open leads (Show: open)", n === J.open, n + " vs " + J.open);
          const acts = await p.eval("({ newBtn: !document.getElementById('ldNewBtn').hidden, conv: document.querySelectorAll('[data-conv]').length, touch: document.querySelectorAll('[data-touch]').length })");
          check(role + ": Leads - New / Convert / Contacted " + (writer ? "offered" : "not offered"),
            writer ? acts.newBtn && acts.conv === J.open && acts.touch === J.open : !acts.newBtn && !acts.conv && !acts.touch, JSON.stringify(acts));
          await setVal(p, "ldShow", "all", "change");
          await p.until("document.querySelectorAll('#ldList .ld-card').length === " + J.leads, 5000);
          check(role + ": Leads - Show all: the converted lead links its project", /project A\d+/.test(await text(p, "#ldList")));
          await setVal(p, "ldShow", "open", "change");
          if (role !== "approver") await fourShots(p, "leads_" + role, LEADS);
        } else {
          await open(p, "/leads.html", LEADS_DENIED);
          const h = await html(p);
          const leaked = J.names.filter((nm) => h.indexOf(nm.replace(/&/g, "&amp;")) !== -1 || h.indexOf(nm) !== -1);
          check(role + ": Leads - told the list is the office's; no client's name in the page", /kept by the office/.test(await text(p, "#ldDenied")) && !leaked.length, leaked.join(", "));
          const asked = await db(p, "DCR2Demo.engine.rows.leads.length").catch(() => -1);
          check(role + ": Leads - the page asked the database for nothing it could not have", asked >= 0);
          await fourShots(p, "leads_" + role, LEADS_DENIED);
        }

        // Vehicles
        await open(p, "/vehicles.html?id=" + J.t01, VEH + " && !document.getElementById('vbPanel').hidden && !!document.querySelector('#vpHistory .vb-maint')");
        const vh = await html(p);
        const shownCosts = J.costs.filter((c) => vh.indexOf(money(c)) !== -1);
        check(role + ": Vehicles - the board and the T-01 panel; material costs " + (fin ? "shown" : "never sent"),
          fin ? shownCosts.length >= 1 : !shownCosts.length && !/material/.test(await text(p, "#vpHistory")), shownCosts.join(", "));
        const vAll = await p.eval("document.querySelectorAll('#vbAllList .vb-row').length");
        check(role + ": Vehicles - every vehicle in service listed (the retired one only when asked)", vAll === J.live, vAll + " vs " + J.live);
        const vActs = await p.eval("({ sched: !document.getElementById('vbSchedBtn').hidden, done: document.querySelectorAll('[data-done]').length, editv: document.querySelectorAll('[data-editv]').length })");
        check(role + ": Vehicles - Schedule / Complete / Edit " + (writer ? "offered" : "not offered"),
          writer ? vActs.sched && vActs.done >= 1 && vActs.editv === 1 : !vActs.sched && !vActs.done && !vActs.editv, JSON.stringify(vActs));
        const due = await p.eval("['vbOilCount','vbSvcCount','vbPaperCount'].map(i => Number(document.getElementById(i).textContent))");
        check(role + ": Vehicles - oil, services and papers due this month", due[0] >= 1 && due[1] >= 1 && due[2] >= 1, due.join(","));
        if (role !== "approver") await fourShots(p, "vehicles_" + role, VEH);

        // Marketing
        if (office) {
          await open(p, "/marketing.html", MK);
          await click(p, "[data-f=all]");
          await p.until("document.querySelectorAll('#mkList tr.mk-row').length === " + J.tasks, 5000);
          const mh = await html(p);
          const priceCol = await p.eval("Array.from(document.querySelectorAll('#mkList th')).some(t => /price/i.test(t.textContent))");
          const shownPrices = J.prices.filter((x) => mh.indexOf(money(x)) !== -1);
          if (fin) {
            check(role + ": Marketing - the price column and the totals (financials)", priceCol && shownPrices.length === J.prices.length &&
              !document_hidden(await p.eval("document.getElementById('mkTotals').hidden")), shownPrices.length + "/" + J.prices.length);
          } else {
            check(role + ": Marketing - no price column, no totals, no price and no amount in the page (Q17)",
              !priceCol && !shownPrices.length && (await p.eval("document.getElementById('mkTotals').hidden")) && !AMOUNT.test(mh),
              (mh.match(/.{40}\$\s?\d.{20}/) || [""])[0]);
            check(role + ": Marketing - an amount typed into a task's words shows (amount hidden)", /\(amount hidden\)/.test(await text(p, "#mkList")));
          }
          const mActs = await p.eval("({ newBtn: !document.getElementById('mkNewBtn').hidden, tgl: document.querySelectorAll('button[data-tgl]').length, ro: document.querySelectorAll('.mk-tgl.ro').length })");
          check(role + ": Marketing - the marks " + (writer ? "can be flipped" : "are read only"), writer ? mActs.newBtn && mActs.tgl > 0 && !mActs.ro : !mActs.newBtn && !mActs.tgl && mActs.ro > 0,
            JSON.stringify(mActs));
          if (role !== "approver") await fourShots(p, "marketing_" + role, MK);
        } else {
          await open(p, "/marketing.html", MK_DENIED);
          check(role + ": Marketing - told the list is the office's; no task in the page", /kept by the office/.test(await text(p, "#mkDenied")) &&
            !/Drone flyover/.test(await html(p)));
          await fourShots(p, "marketing_" + role, MK_DENIED);
        }
      }, p);
    }

    /* ── 2. the manager writes leads (no financials) ──────────────────── */
    const mg = await newPage(cdp, "manager-writes", OUT); pages.push(mg);
    await mg.size(1440, 900, false);
    await attempt("manager: leads written, converted and deleted", async () => {
      await signIn(mg, "manager", "leads.html");
      await open(mg, "/leads.html", LEADS);
      await click(mg, "#ldNewBtn");
      await mg.until("document.getElementById('ldModal').classList.contains('open')", 3000);
      const nasty = "<img src=x id=pwned> Pippa & \"Co\"";
      await setVal(mg, "lf_leadClientName", nasty);
      await setVal(mg, "lf_leadClientPhone", "805.555.0190");
      await setVal(mg, "lf_leadClientAddress", "14 Larkspur Ct, Oak Vista, CA 93422");
      await setVal(mg, "lf_leadCategory", "Pergola");
      await setVal(mg, "lf_leadNotes", "Wants a quote by Friday.");
      await click(mg, "#ldSave");
      await mg.until("!document.getElementById('ldModal').classList.contains('open')", 5000);
      const added = await db(mg, "R.leads[R.leads.length - 1]");
      check("manager: a new lead - stored as typed (the phone formatted by the database), dated today",
        added.client_name === nasty.replace(/\s+/g, " ").trim() && added.client_phone === "(805) 555-0190" && /^\d{4}-\d{2}-\d{2}$/.test(added.lead_date), JSON.stringify(added));
      check("manager: the lead's name is shown as text, never run", (await mg.eval("!document.getElementById('pwned') && document.getElementById('ldList').innerText.indexOf('<img src=x') !== -1")));
      // edit, contacted
      await click(mg, "[data-edit='" + added.id + "']");
      await mg.until("document.getElementById('ldModal').classList.contains('open')", 3000);
      await setVal(mg, "lf_leadSource", "Home show");
      await click(mg, "#ldSave");
      await mg.until("!document.getElementById('ldModal').classList.contains('open')", 5000);
      const edited = await db(mg, "R.leads.find((l) => l.id === " + added.id + ")");
      check("manager: the lead edited - versioned", edited.source === "Home show" && edited.version === 2, JSON.stringify({ s: edited.source, v: edited.version }));
      await click(mg, "[data-touch='" + added.id + "']");
      await mg.until("(DCR2Demo.engine.rows.leads.find((l) => l.id === " + added.id + ") || {}).version === 3", 5000);
      check("manager: Contacted today", /contacted today/.test(await mg.eval("document.querySelector('[data-lead=\"" + added.id + "\"]').innerText")));
      // convert
      const nextNo = await db(mg, "'A' + R.settings[0].next_project_number");
      await click(mg, "[data-conv='" + added.id + "']");
      await mg.until("document.getElementById('cvModal').classList.contains('open')", 3000);
      const pre = await mg.eval("({ name: document.getElementById('cvName').value, addr: document.getElementById('cvAddr').value, city: document.getElementById('cvCity').value })");
      check("manager: convert - the form starts from the lead (its name rule, the street and the city apart)",
        pre.name === nasty.replace(/\s+/g, " ").trim() + " Residence" && pre.addr === "14 Larkspur Ct" && pre.city === "Oak Vista", JSON.stringify(pre));
      await setVal(mg, "cvName", "Larkspur pergola");
      await shoot(mg, "leads_convert_manager", "desktop", false);
      await click(mg, "#cvGo");
      await mg.until("!document.getElementById('cvModal').classList.contains('open')", 5000);
      const conv = await db(mg, "(() => { const l = R.leads.find((x) => x.id === " + added.id + "); const p = R.projects.find((x) => x.id === l.converted_project_id); return { l, p, log: R.activity.filter((a) => p && a.project_id === p.id).map((a) => a.text) }; })()");
      check("manager: convert - one step: the project (the next number, the client's name and phone) and the lead linked",
        conv.p && conv.p.number === nextNo && conv.p.name === "Larkspur pergola" && conv.p.city === "Oak Vista" && conv.p.client_phone === "(805) 555-0190" &&
        conv.l.converted_by && conv.log.join("|") === "Project " + nextNo + " created|Created from a lead", JSON.stringify({ p: conv.p && conv.p.number, log: conv.log }));
      await setVal(mg, "ldShow", "converted", "change");
      await mg.until("!!document.querySelector('[data-lead=\"" + added.id + "\"] .ld-flag a')", 5000);
      const link = await mg.eval("document.querySelector('[data-lead=\"" + added.id + "\"] .ld-flag a').getAttribute('href')");
      check("manager: the converted lead links to its project", link === "project.html?id=" + conv.p.id, link);
      check("manager: a converted lead offers no second convert", !(await mg.eval("!!document.querySelector('[data-conv=\"" + added.id + "\"]')")));
      // delete (the confirm box)
      await click(mg, "[data-del='" + added.id + "']");
      await mg.until("!!document.getElementById('dcrMoYes')", 3000);
      await click(mg, "#dcrMoYes");
      await mg.until("!DCR2Demo.engine.rows.leads.some((l) => l.id === " + added.id + ")", 5000);
      check("manager: the lead deleted", true);

      // words quoting an amount (no prices): the edit form shows them masked and read only, and a save keeps them
      await open(mg, "/marketing.html", MK);
      await click(mg, "[data-f=all]");
      const booth = await db(mg, "R.marketing_tasks.find((t) => /\\$\\d/.test(t.description || ''))");
      await mg.until("!!document.querySelector('[data-edit=\"" + booth.id + "\"]')", 5000);
      await click(mg, "[data-edit='" + booth.id + "']");
      await mg.until("document.getElementById('mkModal').classList.contains('open')", 3000);
      const box = await mg.eval("(() => { const d = document.getElementById('mf_marketingTaskDescripiton'); return { v: d.value, off: d.disabled, name: document.getElementById('mf_marketingTaskName').disabled }; })()");
      check("manager (no prices): an edit form shows words quoting an amount masked and read only; the other boxes stay open",
        /\(amount hidden\)/.test(box.v) && !AMOUNT.test(box.v) && box.off && !box.name, JSON.stringify(box));
      await setVal(mg, "mf_marketingTaskCaterogy", "Events and shows");
      await shoot(mg, "marketing_edit_manager", "desktop", false);
      await click(mg, "#mkSave");
      await mg.until("!document.getElementById('mkModal').classList.contains('open')", 5000);
      const kept = await db(mg, "R.marketing_tasks.find((t) => t.id === " + booth.id + ")");
      check("manager (no prices): the save changed the category only - the masked words were never sent over the real ones",
        kept.category === "Events and shows" && kept.description === booth.description && kept.version === booth.version + 1,
        JSON.stringify({ c: kept.category, same: kept.description === booth.description, v: kept.version }));
    }, mg);

    /* ── 3. the demo approver (a manager with financials): a service, its cost, a vehicle; a marketing price ─── */
    const ap = await newPage(cdp, "approver-writes", OUT); pages.push(ap);
    await ap.size(1440, 900, false);
    await attempt("approver: a service completed with its cost; a vehicle edited and retired; a task done and priced", async () => {
      await signIn(ap, "approver", "vehicles.html");
      await open(ap, "/vehicles.html?id=" + J.t01, VEH + " && !document.getElementById('vbPanel').hidden");
      await click(ap, "[data-sched='" + J.t01 + "']");
      await ap.until("document.getElementById('schedModal').classList.contains('open')", 3000);
      await setVal(ap, "smReq", "Oil change and filter");
      await click(ap, "#smSave");
      await ap.until("!document.getElementById('schedModal').classList.contains('open')", 5000);
      const sid = await db(ap, "R.vehicle_maintenance[R.vehicle_maintenance.length - 1].id");
      await click(ap, "[data-done='" + sid + "']");
      await ap.until("document.getElementById('doneModal').classList.contains('open')", 3000);
      const pre = await ap.eval("({ oil: document.getElementById('dmOil').checked, cost: !document.getElementById('dmCostRow').hidden })");
      check("approver: complete - an oil change is ticked from its words; the cost box (financials)", pre.oil && pre.cost, JSON.stringify(pre));
      const v0 = await db(ap, "R.vehicles.find((v) => v.id === " + J.t01 + ")");
      await setVal(ap, "dmWork", "Oil and filter, 10 qt");
      await setVal(ap, "dmMiles", String(v0.current_mileage + 120));
      await setVal(ap, "dmLabor", "1 h");
      await setVal(ap, "dmCost", "$84.20");
      await shoot(ap, "vehicles_complete_approver", "desktop", false);
      await click(ap, "#dmSave");
      await ap.until("!document.getElementById('doneModal').classList.contains('open')", 5000);
      const st = await db(ap, "({ m: R.vehicle_maintenance.find((m) => m.id === " + sid + "), c: R.vehicle_maintenance_costs.find((c) => c.maintenance_id === " + sid + "), v: R.vehicles.find((v) => v.id === " + J.t01 + "), act: R.activity.length })");
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
      check("approver: the service done today (company day) in one step; the vehicle's oil record and mileage stamped; labour and cost kept",
        st.m.completed_date === today && st.m.labor_time === "1 h" && st.v.last_oil_date === today && st.v.last_oil_mileage === v0.current_mileage + 120 &&
        st.v.current_mileage === v0.current_mileage + 120 && Number(st.c.material_cost) === 84.2, JSON.stringify(st));
      check("approver: the history shows the cost", /\$84\.20/.test(await text(ap, "#vpHistory")));
      // edit and retire a vehicle
      const spare = await db(ap, "R.vehicles.find((v) => v.fleet_number === 'TR-1').id");
      await open(ap, "/vehicles.html?id=" + spare, VEH + " && !document.getElementById('vbPanel').hidden");
      await click(ap, "[data-editv='" + spare + "']");
      await ap.until("document.getElementById('vehModal').classList.contains('open')", 3000);
      await setVal(ap, "vf_vehicleDriverInformation", "Shop yard");
      await ap.eval("document.getElementById('vf_vehicleActive').checked = false; true");
      await click(ap, "#vfSave");
      await ap.until("!document.getElementById('vehModal').classList.contains('open')", 5000);
      const r = await db(ap, "R.vehicles.find((v) => v.id === " + spare + ")");
      check("approver: a vehicle edited and retired (versioned)", r.driver === "Shop yard" && r.active === false && r.version === 2, JSON.stringify({ d: r.driver, a: r.active, v: r.version }));
      const listed = await ap.eval("Array.from(document.querySelectorAll('#vbAllList .vb-row')).some(b => b.dataset.vid === '" + spare + "')");
      check("approver: a retired vehicle leaves the list (and its due papers)", !listed);
      await ap.eval("(() => { const c = document.getElementById('vbRetired'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
      check("approver: 'show retired' lists it again", await ap.eval("Array.from(document.querySelectorAll('#vbAllList .vb-row')).some(b => b.dataset.vid === '" + spare + "' && /retired/.test(b.innerText))"));
      // marketing: done, then priced
      await open(ap, "/marketing.html", MK);
      const tid = await db(ap, "R.marketing_tasks.find((t) => t.name === 'Client testimonial interview').id");
      await click(ap, "button[data-tgl='" + tid + "'][data-field=marketingTaskMarkComplete]");
      await ap.until("(DCR2Demo.engine.rows.marketing_tasks.find((t) => t.id === " + tid + ") || {}).done === true", 5000);
      const t1 = await db(ap, "R.marketing_tasks.find((t) => t.id === " + tid + ")");
      check("approver: Done - the database stamps today", t1.completed_date === today, JSON.stringify(t1));
      await click(ap, "[data-f=all]");
      await ap.until("!!document.querySelector('[data-edit=\"" + tid + "\"]')", 5000);
      await click(ap, "[data-edit='" + tid + "']");
      await ap.until("document.getElementById('mkModal').classList.contains('open') && !document.getElementById('mfPriceRow').hidden", 3000);
      await setVal(ap, "mf_marketingTaskPrice", "275");
      await click(ap, "#mkSave");
      await ap.until("!document.getElementById('mkModal').classList.contains('open')", 5000);
      const pr = await db(ap, "R.marketing_task_prices.find((p) => p.task_id === " + tid + ")");
      check("approver: the price kept in its own row (financials, Q17)", Number(pr.price) === 275 && pr.version === 2, JSON.stringify(pr));
      const after = await db(ap, "R.activity.slice(" + st.act + ").map((a) => a.text)");
      check("P5 check 5: the service, its cost, the vehicle and the price wrote no activity line", after.length === 0, after.join(" | "));
    }, ap);

    /* ── 4. no security-policy violation, no console error ─────────────── */
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

function document_hidden(v) { return v === true; }

main().catch((e) => { console.error(e); process.exit(2); });
