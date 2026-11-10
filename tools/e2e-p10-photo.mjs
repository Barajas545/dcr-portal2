#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the shoot schedule (the photographer screen program, P3; DCR Desktop 2 migration
   20261110000100_photo_schedule; the owner's decisions of 2026-11-09), in the DEMO (development only).

     node tools/e2e-p10-photo.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with the shoot schedule's rules -
   tools/fake/p10-photo.js: the mirror, the change queue, the photo team, and a made-up office computer that takes and
   applies each change a moment after it is asked; nothing goes to Supabase) and drives a local Chrome or Edge headless:

   - the photographer (Jordan) on a phone: Home's 📷 card and the top bar's entry; the Agenda; a shoot full screen and the
     phone's Back closing it; Move… - the three choices with "Only this shoot" preselected, "This shoot and the later
     ones" with a day from the strip, the preview listing every shoot that moves; Apply -> "Waiting for the office
     computer" -> Applied, heard through the Realtime watch with no reload; the job date moved (Firm: "Send to the
     office", answered "Sent to the office to approve"); Mark done; Undo; Cancel while new (the office computer off);
   - PT409: the office moves the same shoot meanwhile -> "Someone changed this plan meanwhile - here is the new preview";
   - a reminder's link (?shoot=) and My Tasks' "Open in shoot schedule"; marketing reads only; a manager is told no;
   - the admin on a desk: the list on the left and the shoot on the right, Month and By job; the Access tab's Photo team:
     a second photographer, the default moved to him, a marketing member's Google e-mail in lower case;
   - phone (375 px: no page scrolls sideways) and desk, light and dark; no Content-Security-Policy violation and no
     console error on any page.
   Screenshots (--shots all): shoots_<what>_<light|dark>_<desktop|phone>.png into --out (default: the system temp folder).
   Made-up data only. Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p10-photo")));
const SHOTS = arg("--shots", "all");

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = startServer(0);
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const { cdp, proc } = await launch(arg("--chrome"));
  const results = [];
  const pages = [];
  let shots = 0;
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail: detail === undefined ? "" : detail });
    process.stderr.write((ok ? "  ok   " : "  FAIL ") + name + (ok ? "" : " :: " + String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300)) + "\n");
  };
  const attempt = async (name, fn, page) => {
    try { await fn(); } catch (e) {
      let where = "";
      if (page) {
        try { where = " @ " + await page.eval("location.href + ' :: ' + (document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400) : '')"); }
        catch (x) { where = " @ (page not answering: " + x.message + ")"; }
      }
      check(name, false, String(e && e.message || e).slice(0, 400) + where);
    }
  };
  const TOPBAR = "!!document.querySelector('.dcr2-topbar .p2-badge')";
  const LIST = "document.querySelectorAll('#shList .sh-row').length > 3";
  async function signIn(p, key, next) {
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
    await p.goto(base + "/index.html?next=" + encodeURIComponent(next || "dashboard.html"), 150);
    await p.until("!!document.getElementById('loginForm') && !!window.DCR2Demo && !document.getElementById('loginFields').disabled", 8000);
    await p.eval("document.getElementById('email').value=" + JSON.stringify(key + "@demo.test") + ";document.getElementById('password').value='demo-password-1';" +
      "document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname) && " + TOPBAR, 10000);
  }
  async function open(p, path, marker) {
    await p.goto(base + path, 150);
    await p.until(TOPBAR + (marker ? " && (" + marker + ")" : ""), 15000);
  }
  const text = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); return n ? n.textContent : ''; })()");
  const clickSel = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); if (n) n.click(); return !!n; })()");
  const row = (p, name, job) => p.eval("(() => { const r = Array.from(document.querySelectorAll('#shList .sh-row')).find((x) => x.querySelector('.sh-name') && " +
    "x.querySelector('.sh-name').textContent === " + JSON.stringify(name) + (job ? " && x.textContent.indexOf(" + JSON.stringify(job) + ") !== -1" : "") +
    "); if (r) r.click(); return r ? Number(r.getAttribute('data-shoot')) : 0; })()");
  const pickDay = (p, n) => p.eval("(() => { const d = Array.from(document.querySelectorAll('#mvDay [data-act=pick]')).filter((b) => !/\\b(off|cur)\\b/.test(b.className))[" + (n || 0) + "]; " +
    "if (d) d.click(); return d ? d.getAttribute('data-day') : null; })()");
  const choose = (p, name, value) => p.eval("(() => { const r = Array.from(document.querySelectorAll('input[name=" + name + "]')).find((x) => x.value === " + JSON.stringify(value) + "); " +
    "if (r) r.click(); return !!r; })()");
  const PREVIEWED = "(() => { const b = document.getElementById('mvApply'); const t = document.getElementById('mvPreview').textContent; " +
    "return !!b && !/Checking|checking again/.test(t) && (/Will move|Goes back|No shoot moves|Stays/.test(t) || !!document.querySelector('#mvPreview .no')); })()";
  const noSideways = (p) => p.eval("document.documentElement.scrollWidth <= innerWidth + 1");
  const db = (p, expr) => p.eval("(() => { const R = DCR2Demo.engine.rows; return " + expr + "; })()");
  async function shoot(p, name, device, dark) {
    if (SHOTS === "none") return;
    await p.dark(dark);
    await sleep(350);
    await p.shot("shoots_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png");
    shots += 1;
    await p.dark(false);
  }

  try {
    /* ── 1. the photographer on a phone ─────────────────────────────────── */
    const ph = await newPage(cdp, "photographer", OUT); pages.push(ph);
    await ph.size(375, 812, true);
    await attempt("the photographer's way in: Home's card, the top bar's entry", async () => {
      await signIn(ph, "field");
      await ph.until("!!document.getElementById('hmShoots')", 8000);
      check("Home: 📷 Shoot schedule for the photographer", /📷\s*Shoot schedule/.test(await text(ph, "#hmShoots")), await text(ph, "#hmShoots"));
      await open(ph, "/shoots.html", LIST);
      check("the top bar's Shoot schedule entry (current)", await ph.eval("Array.from(document.querySelectorAll('#dcr2Nav a')).some(a => a.getAttribute('href') === 'shoots.html' && a.getAttribute('aria-current') === 'page')"));
      check("phone: no page scrolls sideways (the Agenda)", await noSideways(ph));
      await shoot(ph, "agenda", "phone", false);
      await shoot(ph, "agenda", "phone", true);
    }, ph);

    await attempt("a shoot full screen; the phone's Back closes it", async () => {
      const id = await row(ph, "Before framing", "A000T9");
      await ph.until("document.getElementById('shDetail').classList.contains('open') && !!document.getElementById('shDTitle')", 5000);
      check("a shoot opens full screen with its address", /\?shoot=\d+/.test(await ph.eval("location.search")) && id > 0, await ph.eval("location.search"));
      await ph.eval("history.back(); true");
      await ph.until("!document.getElementById('shDetail').classList.contains('open')", 5000);
      check("the phone's Back closes it (the list again)", !/shoot=/.test(await ph.eval("location.search")));
    }, ph);

    await attempt("Move… this shoot and the later ones: the preview of every shoot, Apply, waiting, then Applied through the watch", async () => {
      await row(ph, "Before framing", "A000T9");
      await ph.until("!!document.querySelector('#shDScroll [data-act=move]')", 5000);
      await clickSel(ph, "#shDScroll [data-act=move]");
      await ph.until("!!document.getElementById('mvChoices')", 5000);
      const kinds = await ph.eval("Array.from(document.querySelectorAll('input[name=mvKind]')).map(r => r.value + (r.checked ? '*' : '')).join('|')");
      check("Move… always asks the three choices, Only this shoot preselected", kinds === "move_one*|move_later|milestone", kinds);
      await choose(ph, "mvKind", "move_later");
      await sleep(150);
      const day = await pickDay(ph, 1);
      await ph.until(PREVIEWED, 8000);
      const pv = await text(ph, "#mvPreview");
      const n = Number((/Will move \((\d+)\)/.exec(pv) || [])[1] || 0);
      check("the preview lists every shoot that moves (from → to) and what stays", n > 1 && (pv.match(/→/g) || []).length >= n && /Stays \(\d+\)/.test(pv), pv.slice(0, 300));
      check("phone: no page scrolls sideways (the Move sheet)", await noSideways(ph));
      await shoot(ph, "move_later", "phone", false);
      await clickSel(ph, "#mvApply");
      await ph.until("/Waiting for the office computer|The office computer is applying it/.test(document.getElementById('shDScroll').textContent)", 6000);
      check("sent: the shoot says it waits for the office computer", true);
      await ph.until("/Your recent changes/.test(document.getElementById('shDScroll').textContent) && /Applied/.test(document.getElementById('shDScroll').textContent)", 20000);
      const t = await text(ph, "#shDScroll");
      check("applied by the office computer, heard through the watch (no reload): the new day, the history", t.indexOf("by Jordan on the shoot schedule") !== -1 &&
        (await db(ph, "R.photo_shoots.find(s => s.key === 'before-framing' && R.photo_plans.find(p => p.id === s.plan_id).project_code === 'A000T9').planned_date")) === day, t.slice(0, 300));
    }, ph);

    await attempt("the job date moved (Firm): Send to the office, answered Sent to the office to approve", async () => {
      await ph.eval("document.getElementById('shBack').click(); true");
      await sleep(300);
      await row(ph, "Framing progress #2", "A000T9");
      await ph.until("!!document.querySelector('#shDScroll [data-act=move]')", 5000);
      await clickSel(ph, "#shDScroll [data-act=move]");
      await ph.until("!!document.getElementById('mvChoices')", 5000);
      await choose(ph, "mvKind", "milestone");
      await sleep(150);
      check("which job date: the one the shoot follows, first; the office's approval said before Apply",
        (await ph.eval("document.querySelector('input[name=mvMs]:checked').value")) === "framing_start" &&
        (await text(ph, "#mvNote")) === "This job date (Framing start) is Firm - your change goes to the office to approve", await text(ph, "#mvNote"));
      await pickDay(ph, 2);
      await ph.until(PREVIEWED, 8000);
      check("Apply reads Send to the office", (await text(ph, "#mvApply")) === "Send to the office", await text(ph, "#mvApply"));
      await shoot(ph, "milestone_firm", "phone", true);
      await clickSel(ph, "#mvApply");
      await ph.until("/Sent to the office to approve/.test(document.getElementById('shDScroll').textContent)", 20000);
      check("answered: Sent to the office to approve", true);
    }, ph);

    await attempt("PT409: the office moved the same shoot meanwhile - the new preview, then Apply goes", async () => {
      await ph.eval("document.getElementById('shBack').click(); true");
      await sleep(300);
      const id = await row(ph, "Drone airspace check", "A000T9");
      await ph.until("!!document.querySelector('#shDScroll [data-act=move]')", 5000);
      await clickSel(ph, "#shDScroll [data-act=move]");
      await ph.until("!!document.getElementById('mvDay')", 5000);
      await pickDay(ph, 3);
      await ph.until(PREVIEWED, 8000);
      // the office (the demo's admin) moves it meanwhile; the demo's office computer applies it
      await ph.eval("(() => { const R = DCR2Demo.engine.rows; const s = R.photo_shoots.find(x => x.id === " + id + "); const p = R.photo_plans.find(x => x.id === s.plan_id); " +
        "p.rev += 7; s.rev = p.rev; const d = new Date(Date.parse(s.planned_date + 'T12:00:00Z') + 9 * 86400000).toISOString().slice(0, 10); s.planned_date = d; s.fixed_date = d; return true; })()");
      await clickSel(ph, "#mvApply");
      await ph.until("document.getElementById('mvMsg').textContent === 'Someone changed this plan meanwhile - here is the new preview.'", 8000);
      await ph.until(PREVIEWED, 8000);
      check("PT409: said in plain words, the new preview shown, nothing queued", /→/.test(await text(ph, "#mvPreview")) &&
        (await db(ph, "R.photo_changes.filter(c => c.target_key === 'drone-check' && c.status === 'new').length")) === 0);
      const rev2 = await db(ph, "R.photo_plans.find(p => p.project_code === 'A000T9').rev");
      await clickSel(ph, "#mvApply");
      await ph.until("!document.getElementById('mvApply')", 8000);
      const baseRev = await db(ph, "R.photo_changes.filter(c => c.target_key === 'drone-check').slice(-1)[0].base_rev");
      check("then Apply goes with the new rev the screen read", baseRev === rev2, baseRev + " / " + rev2);
    }, ph);

    await attempt("Mark done; Undo my last change; Cancel while new (the office computer off)", async () => {
      await ph.until("/Applied|Waiting|applying/.test(document.getElementById('shDScroll').textContent)", 20000);
      await ph.eval("document.getElementById('shBack').click(); true");
      await sleep(300);
      await row(ph, "Lot before work", "A000T9");
      await ph.until("!!document.querySelector('#shDScroll [data-act=done]')", 5000);
      await clickSel(ph, "#shDScroll [data-act=done]");
      await ph.until("!!document.getElementById('dnNote')", 5000);
      await ph.eval("document.getElementById('dnNote').value = 'All shots taken'; document.getElementById('mvApply').click(); true");
      await ph.until("(() => { const s = DCR2Demo.engine.rows.photo_shoots.find(x => x.key === 'lot-before'); return s && s.status === 'done'; })()", 20000);
      check("Mark done with a note: done by the office computer", (await db(ph, "R.photo_shoots.find(x => x.key === 'lot-before').done_note")) === "All shots taken");
      await ph.eval("document.getElementById('shBack').click(); true");
      await sleep(300);
      await row(ph, "Framing complete", "A000T8");
      await ph.until("!!document.querySelector('#shDScroll [data-act=undo]')", 5000);
      await clickSel(ph, "#shDScroll [data-act=undo]");
      await ph.until(PREVIEWED, 8000);
      check("Undo: the preview sets the move back", /Goes back \(1\)/.test(await text(ph, "#mvPreview")), await text(ph, "#mvPreview"));
      await clickSel(ph, "#mvApply");
      await ph.until("(() => { const c = DCR2Demo.engine.rows.photo_changes.find(x => x.id === 1); return c && c.undone_by; })()", 20000);
      check("undone by the office computer", true);
      // the office computer off: a change waits, and is cancelled while new
      await ph.eval("sessionStorage.setItem('dcr2-demo-pc-off', '1'); true");
      await open(ph, "/shoots.html", LIST);
      check("the header: the office computer is off, in plain words", /^The office computer is off - changes wait until it is back on/.test(await text(ph, "#shPc")), await text(ph, "#shPc"));
      await row(ph, "House complete", "A000T8");
      await ph.until("!!document.querySelector('#shDScroll [data-act=move]')", 5000);
      await clickSel(ph, "#shDScroll [data-act=move]");
      await ph.until("!!document.getElementById('mvDay')", 5000);
      await pickDay(ph, 2);
      await ph.until(PREVIEWED, 8000);
      await clickSel(ph, "#mvApply");
      await ph.until("!!document.querySelector('#shDScroll [data-act=cancel-change]')", 8000);
      await shoot(ph, "waiting_pc_off", "phone", false);
      await clickSel(ph, "#shDScroll [data-act=cancel-change]");
      await ph.until("!!document.querySelector('.dcr-mo.open #dcrMoYes')", 5000);
      await ph.eval("document.querySelector('.dcr-mo.open #dcrMoYes').click(); true");
      await ph.until("!document.querySelector('#shDScroll [data-act=cancel-change]')", 8000);
      check("Cancel while new: cancelled", (await db(ph, "R.photo_changes.filter(c => c.target_key === 'house-complete').slice(-1)[0].status")) === "cancelled");
      await ph.eval("sessionStorage.removeItem('dcr2-demo-pc-off'); true");
    }, ph);

    await attempt("My Tasks' Open in shoot schedule; a reminder's link", async () => {
      await open(ph, "/my-tasks.html", "document.querySelectorAll('.mt-card').length > 0");
      await ph.eval("(() => { const c = Array.from(document.querySelectorAll('.mt-card')).find(x => /Shoot the framing progress/.test(x.textContent)); c.querySelector('.mt-open').click(); return true; })()");
      await ph.until("!!document.querySelector('#mtShootLink a')", 8000);
      const href = await ph.eval("document.querySelector('#mtShootLink a').getAttribute('href')");
      check("a Photo & Video task: Open in shoot schedule (its shoot)", /^shoots\.html\?shoot=\d+$/.test(href), href);
      await open(ph, "/" + href, "!!document.getElementById('shDTitle')");
      check("the link opens that shoot", (await text(ph, "#shDTitle")) === "Lot before work", await text(ph, "#shDTitle"));
    }, ph);

    /* ── 2. marketing and someone not on the team ───────────────────────── */
    await attempt("marketing reads only; a manager is told no", async () => {
      await signIn(ph, "viewer", "shoots.html");
      await ph.until(LIST, 8000);
      await row(ph, "Framing complete", "A000T8");
      await ph.until("!!document.getElementById('shDTitle')", 5000);
      check("marketing: no action button anywhere", await ph.eval("!document.querySelector('#shRoot [data-act=move], #shRoot [data-act=done], #shRoot [data-act=undo], #shRoot [data-act=cancel-change]')"));
      await signIn(ph, "manager", "shoots.html");
      await ph.until("/Not for your account/.test(document.getElementById('shList').textContent)", 8000);
      check("a manager (on no team): told so; no top bar entry", !(await ph.eval("Array.from(document.querySelectorAll('#dcr2Nav a')).some(a => a.getAttribute('href') === 'shoots.html')")));
    }, ph);

    /* ── 3. the admin on a desk ─────────────────────────────────────────── */
    const dk = await newPage(cdp, "admin-desk", OUT); pages.push(dk);
    await dk.size(1440, 900, false);
    await attempt("the desk: the list left, the shoot right; Month and By job", async () => {
      await signIn(dk, "admin");
      await open(dk, "/shoots.html", LIST);
      await row(dk, "Delivery day", "A000T9");
      await dk.until("!!document.getElementById('shDTitle')", 5000);
      check("desk: the shoot beside the list", await dk.eval("document.getElementById('shDetail').getBoundingClientRect().left > document.getElementById('shList').getBoundingClientRect().right - 1"));
      await shoot(dk, "agenda", "desktop", false);
      await clickSel(dk, "#shViews [data-view=month]");
      await dk.until("document.querySelectorAll('#shList .sh-cell').length >= 28", 5000);
      check("Month: the grid takes the wide side", await dk.eval("document.getElementById('shList').getBoundingClientRect().width > document.getElementById('shDetail').getBoundingClientRect().width"));
      await shoot(dk, "month", "desktop", true);
      await clickSel(dk, "#shViews [data-view=job]");
      await dk.until("document.querySelectorAll('#shList .sh-plan').length >= 3", 5000);
      check("By job: each plan with its job dates (Firm)", /Framing start .* · Firm/.test(await text(dk, "#shList")));
      await shoot(dk, "by_job", "desktop", false);
    }, dk);

    await attempt("the Access tab's Photo team: a second photographer, the default moved to him, a Google e-mail in lower case", async () => {
      await open(dk, "/admin.html?tab=access", "document.querySelectorAll('#adPhoto [data-person]').length > 2");
      const line = (name) => "Array.from(document.querySelectorAll('#adPhoto [data-person]')).find(r => r.querySelector('b').textContent.indexOf(" + JSON.stringify(name) + ") === 0)";
      await dk.eval("(() => { " + line("Riley Lead") + ".querySelector('[data-ph=photographer]').click(); return true; })()");
      await dk.eval("(() => { " + line("Riley Lead") + ".querySelector('[data-phsave]').click(); return true; })()");
      await dk.until("(() => { const t = DCR2Demo.engine.rows.photo_team; return t.some(r => r.photographer && !r.default_photographer && DCR2Demo.engine.rows.profiles.find(p => p.id === r.profile_id).full_name === 'Riley Lead'); })()", 8000);
      check("a second photographer (not the default by himself)", true);
      await dk.until(line("Riley Lead") + ".querySelector('[data-ph=isDefault]') && !" + line("Riley Lead") + ".querySelector('[data-ph=isDefault]').disabled", 5000);
      await dk.eval("(() => { " + line("Riley Lead") + ".querySelector('[data-ph=isDefault]').click(); " + line("Riley Lead") + ".querySelector('[data-phsave]').click(); return true; })()");
      await dk.until("/default photographer: Riley Lead/.test(document.getElementById('adPhoto').textContent)", 8000);
      check("the default moved to him (the old one keeps the Photographer tick)", (await db(dk, "R.photo_team.filter(r => r.default_photographer).length")) === 1 &&
        (await db(dk, "R.photo_team.find(r => R.profiles.find(p => p.id === r.profile_id).full_name === 'Jordan Field').photographer")) === true);
      check("the old default's line shows its new state (no stale Save)", await dk.eval("(() => { const r = " + line("Jordan Field") + "; return r.querySelector('[data-phacts]').hidden && !r.querySelector('[data-ph=isDefault]').checked; })()"));
      await dk.eval("(() => { const r = " + line("Casey Accounts") + "; r.querySelector('[data-ph=marketing]').click(); return true; })()");
      await sleep(200);
      await dk.eval("(() => { const r = " + line("Casey Accounts") + "; const i = r.querySelector('[data-ph=googleEmail]'); i.value = ' Casey.Accounts@Example.COM '; i.dispatchEvent(new Event('input', { bubbles: true })); r.querySelector('[data-phsave]').click(); return true; })()");
      await dk.until("DCR2Demo.engine.rows.photo_team.some(r => r.google_email === 'casey.accounts@example.com')", 8000);
      check("a marketing member's Google e-mail, in lower case", true);
      await shoot(dk, "access_photo_team", "desktop", true);
    }, dk);

    /* ── 4. no security-policy violation, no console error ─────────────── */
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
  console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results, shots, out: OUT }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
