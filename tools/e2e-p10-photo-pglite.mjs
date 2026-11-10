#!/usr/bin/env node
/* DCR Portal 2 — the shoot schedule end to end on the REAL database rules (the photographer screen program, P3;
   development only).

     DCR_DESKTOP2_DIR=<DCR Desktop 2> PGLITE_DIR=<folder with node_modules/@electric-sql/pglite> \
       node tools/e2e-p10-photo-pglite.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/pglite-serve.mjs (the site, every page's supabase-js calls replayed on PGlite loaded with every DCR
   Desktop 2 migration - 20261110000100_photo_schedule included - as the signed-in person) and drives a local Chrome or
   Edge headless, whose resolver sends *.supabase.co nowhere. The made-up people are pglite-serve's; this walk adds the
   agents account, puts Flo Field on the photo team as the (default) photographer and Vi Viewer on marketing through
   set_photo_team as the admin, and mirrors a made-up schedule (the demo database's plans: tools/fake/p10-photo.js)
   through agents_photo_mirror as DCR Agents 2 does (the lease holder, one ledger, a rising rev). THE OFFICE COMPUTER'S
   PART IS PLAYED BY THIS SCRIPT with the agents RPCs: agents_photo_changes_feed, agents_photo_change_take, the plan
   mirrored again with the preview's days and a new rev, then agents_photo_change_done (applied, or suggested for a
   Firm job date moved by a photographer). The pages hear it by their own poll.

   One pass of the walk: the photographer on a phone (Home's card, the top bar, the Agenda; Move… - the three choices
   each previewed by the real photo_change_preview, every shoot that moves listed; "Only this shoot" applied - pending,
   then Applied, the mirror's days exactly the preview's; a Firm job date -> "Send to the office" -> "Sent to the office
   to approve"; a stale base rev -> PT409 changed -> the new preview, then the change cancelled while new; Undo; Mark
   done; the office computer off; a ?shoot= link); marketing reads only; a lead on no team is told no; the admin on a
   desk with the Access tab's Photo team (a photographer added and made the default, a marketing member's Google e-mail
   in lower case, a "changed" conflict). No console error, no page scrolling sideways at 375 px, tap targets and
   contrast as in tools/e2e-p10-photo.mjs. Screenshots: pglite_<what>_<light|dark>_<desktop|phone>.png into --out.
   Made-up people and jobs only. Prints a JSON summary; exit code 1 when a check failed. */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Cdp, CHROMES, newPage, sleep } from "./cdp.mjs";
import { startPgliteServer, emailOf, passwordOf } from "./pglite-serve.mjs";
import { pageHelpers } from "./e2e-p10-photo.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p10-photo-pglite")));
const SHOTS = arg("--shots", "all");
const HOST = "E2E-PHOTO-PC#agents2";
const LEDGER = "e2e10000-0000-4000-8000-0000000000a1";
const AGENTS = { id: "e5b00000-0000-4000-8000-0000000000a9", name: "Agents Pc", email: "agents@e2e.test" };
const HERE = fileURLToPath(new URL(".", import.meta.url));

/** Chrome or Edge, headless, a throw-away profile; Supabase's hosts resolve nowhere (nothing can reach the real project). */
async function launch(chrome) {
  const exe = [chrome].concat(CHROMES).find((p) => p && existsSync(p));
  if (!exe) throw new Error("no Chrome or Edge found (use --chrome <path>)");
  const profile = mkdtempSync(join(tmpdir(), "dcr2-chrome-"));
  const proc = spawn(exe, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile, "--no-first-run",
    "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--disable-default-apps", "--disable-extensions", "--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication",
    "--host-resolver-rules=MAP *.supabase.co ~NOTFOUND, MAP *.supabase.in ~NOTFOUND, MAP nominatim.openstreetmap.org ~NOTFOUND, MAP cdn.jsdelivr.net ~NOTFOUND",
    "--metrics-recording-only", "--mute-audio", "--password-store=basic", "about:blank"], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const [port, path] = readFileSync(portFile, "utf8").trim().split(/\r?\n/);
  const cdp = new Cdp("ws://127.0.0.1:" + port + path);
  await cdp.ready;
  return { cdp, proc, profile };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const S = await startPgliteServer({});
  const { base, sql, asPerson, people: P } = S;
  const results = [];
  const pages = [];
  let shots = 0;
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail: detail === undefined ? "" : detail });
    process.stderr.write((ok ? "  ok   " : "  FAIL ") + name + (ok ? "" : " :: " + String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 600)) + "\n");
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

  /* ── the database: the agents account, the lease, the team, the mirror ─────────────────────────────────── */
  /** An RPC as that person, through SQL with the person given explicitly (never the shared client's "who"). */
  const rpc = async (uid, name, a) => {
    const keys = Object.keys(a);
    const rows = await asPerson(uid, "select public." + name + "(" + keys.map((k, i) => k + " => $" + (i + 1)).join(", ") + ") as r",
      keys.map((k) => (a[k] !== null && typeof a[k] === "object" ? JSON.stringify(a[k]) : a[k])));
    return rows[0].r;
  };
  const beat = () => sql("update app.agents_hosts set at = now() where host_id = $1", [HOST]);
  await sql("insert into auth.users (id, email) values ($1, $2)", [AGENTS.id, AGENTS.email]);
  await asPerson(P.admin.id, "insert into public.profiles (id, full_name, email, role) values ($1, $2, $3, 'agents')", [AGENTS.id, AGENTS.name, AGENTS.email]);
  await sql("update app.agents_lease set host_id = $1, since = now(), lease_by = 'e2e-p10-photo-pglite' where id = 1", [HOST]);
  await sql("delete from app.agents_hosts where host_id = $1", [HOST]);
  await sql("insert into app.agents_hosts (host_id, at, version, proto, standby, payload) values ($1, now(), '2.2.0', 1, false, '{\"paused\": false}')", [HOST]);
  await rpc(P.admin.id, "set_photo_team", { p_profile: P.field.id, p_photographer: true, p_marketing: false });
  await rpc(P.admin.id, "set_photo_team", { p_profile: P.viewer.id, p_photographer: false, p_marketing: true, p_default: false, p_google_email: "vi.viewer.e2e@example.com" });

  // the made-up plans: the demo database's own (tools/fake/p10-photo.js), its photographer named as Flo Field
  const H = await import(pathToFileURL(join(HERE, "..", "tests", "pages-engine.mjs")).href);
  const engine = await H.freshEngine(new Date());
  const planJson = (p) => ({ local_id: p.local_id, status: p.status, project_code: p.project_code, project_label: p.project_label, city: p.city, title: p.title,
    photographer: p.photographer_name ? P.field.name : "", photographer_source: p.photographer_source,
    milestones: Object.fromEntries(Object.entries(p.milestones).map(([k, m]) => [k, { date: m.date, source: m.source, confirmed: m.confirmed }])),
    shoot_days: p.shoot_days, lead_days: p.lead_days, series: p.series, open_suggestions: p.open_suggestions, activated_at: p.activated_at });
  const shootJson = (s) => ({ local_id: s.local_id, key: s.key, seq: s.seq, phase: s.phase, name: s.name, anchor: s.anchor, offset_days: s.offset_days,
    fixed_date: s.fixed_date, planned_date: s.planned_date, window_days: s.window_days, status: s.status, auto_skipped: s.auto_skipped, pin_day: s.pin_day,
    series: s.series, n: s.n, announced_for: s.announced_for, done_at: s.done_at, done_source: s.done_source, done_note: s.done_note, task_id: null,
    brief: s.brief, history: (s.history || []).map((h) => Object.assign({}, h, { change: null })) });
  // the office computer's ledger, as this script keeps it: each plan's JSON and its shoots by local id
  const ledger = new Map();
  for (const p of engine.rows.photo_plans) {
    ledger.set(p.local_id, { plan: planJson(p), shoots: engine.rows.photo_shoots.filter((s) => s.plan_id === p.id).map(shootJson) });
  }
  let REV = 500;
  const mirror = async (local) => {
    const L = ledger.get(local);
    const r = await rpc(AGENTS.id, "agents_photo_mirror", { p_host: HOST, p_ledger: LEDGER, p_plan: L.plan, p_shoots: L.shoots, p_rev: ++REV });
    L.id = r.plan_id;
    return r;
  };
  for (const local of [...ledger.keys()].sort((a, b) => a - b)) await mirror(local);
  const T9 = [...ledger.values()].find((L) => L.plan.project_code === "A000T9");
  const shootRow = async (key) => (await sql("select id, planned_date::text as d, status, rev from public.photo_shoots where plan_id = $1 and key = $2", [T9.id, key]))[0];
  const planShoots = async (planId) => sql("select key, name, planned_date::text as d, status from public.photo_shoots where plan_id = $1", [planId]);
  const lastChange = async () => (await sql("select id, kind, status, base_rev, args, needs_office, undone_by, result from public.photo_changes order by id desc limit 1"))[0];

  /** The office computer, once: the oldest change of the feed taken, applied in this script's ledger as the preview it
      was asked with says, the plan mirrored again with a new rev, and the answer sent. */
  async function pcStep() {
    await beat();
    const feed = await rpc(AGENTS.id, "agents_photo_changes_feed", { p_ledger: LEDGER });
    const item = feed.changes[0];
    if (!item) return null;
    const taken = await rpc(AGENTS.id, "agents_photo_change_take", { p_id: item.id, p_host: HOST, p_ledger: LEDGER });
    const c = taken.change;
    const L = ledger.get(c.plan.local_id);
    const at = new Date().toISOString();
    const byKey = (k) => L.shoots.find((s) => s.key === k);
    if (c.needs_office) {
      const m = c.args.milestone;
      const before = Object.assign({ key: m }, L.plan.milestones[m]);
      await rpc(AGENTS.id, "agents_photo_change_done", { p_id: c.id, p_host: HOST, p_result: { outcome: "suggested", moved: [], passed: [], added: [], cancelled: [],
        milestone_before: before, suggestion: { local_id: 900 + c.id }, differs_from_preview: false, words: "Sent to the office: " + ({ framing_start: "Framing start",
          delivery: "Delivery", framing_complete: "Framing complete", house_complete: "House complete" })[m] + " is Firm", rev: REV } });
      return { c, outcome: "suggested" };
    }
    if (c.kind === "done") {
      const s = byKey(c.args.shoot);
      Object.assign(s, { status: "done", done_at: at, done_source: "shoot page", done_note: c.args.note || null });
      const r = await mirror(c.plan.local_id);
      await rpc(AGENTS.id, "agents_photo_change_done", { p_id: c.id, p_host: HOST, p_result: { outcome: "applied", moved: [], passed: [], added: [], cancelled: [],
        suggestion: null, differs_from_preview: false, words: s.name + " marked done", rev: r.rev } });
      return { c, outcome: "applied" };
    }
    const pv = c.preview || { moved: [], passed: [] };
    let before = null;
    if (c.kind === "milestone") {
      const m = c.args.milestone;
      before = Object.assign({ key: m }, L.plan.milestones[m]);
      L.plan.milestones[m] = { date: c.args.date, source: "photographer", confirmed: true };
    }
    for (const m of pv.moved || []) {
      const s = byKey(m.key);
      const pinned = c.kind === "move_one" || c.kind === "move_later";
      s.planned_date = m.to;
      if (s.anchor === "fixed") s.fixed_date = m.to;
      if (pinned) s.pin_day = m.to;
      if (c.kind === "undo") s.pin_day = null;
      s.history = (s.history || []).concat([{ at, from: m.from, to: m.to, reason: (c.args && c.args.reason) || "", source: "shoot page", manual: c.kind !== "milestone",
        by: c.requester.first_name, change: c.id }]).slice(-10);
    }
    for (const x of pv.passed || []) { const s = byKey(x.key); if (s) Object.assign(s, { status: "skipped", auto_skipped: true, done_source: "schedule" }); }
    const r = await mirror(c.plan.local_id);
    const moved = (pv.moved || []).map((m) => ({ key: m.key, local_id: byKey(m.key).local_id, name: byKey(m.key).name, from: m.from, to: m.to }));
    await rpc(AGENTS.id, "agents_photo_change_done", { p_id: c.id, p_host: HOST, p_result: { outcome: "applied", moved, passed: [], added: [], cancelled: [],
      milestone_before: before, milestone_after: before ? Object.assign({ key: before.key }, L.plan.milestones[before.key]) : null, suggestion: null,
      differs_from_preview: false, words: c.kind === "undo" ? "Undone" : moved.length + (moved.length === 1 ? " shoot moved" : " shoots moved"), rev: r.rev } });
    return { c, outcome: "applied", moved };
  }

  /* ── the browser ──────────────────────────────────────────────────────────────────────────────────────── */
  const { cdp, proc } = await launch(arg("--chrome"));
  async function tab(name) {
    const p = await newPage(cdp, name, OUT, true);
    await p.call("Page.addScriptToEvaluateOnNewDocument", { source: "(" + pageHelpers.toString() + ")();" });
    pages.push(p);
    return p;
  }
  const TOPBAR = "!!document.querySelector('.dcr2-topbar .p2-badge')";
  const LIST = "document.querySelectorAll('#shList .sh-row').length > 3";
  async function signIn(p, key, next) {
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
    await p.goto(base + "/index.html?next=" + encodeURIComponent(next || "dashboard.html"), 150);
    await p.until("!!document.getElementById('loginForm') && !!window.DCR2PGlite && !document.getElementById('loginFields').disabled", 10000);
    await p.eval("document.getElementById('email').value=" + JSON.stringify(emailOf(key)) + ";document.getElementById('password').value=" + JSON.stringify(passwordOf(key)) + ";" +
      "document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname) && " + TOPBAR, 15000);
  }
  async function open(p, path, marker) {
    await p.goto(base + path, 150);
    await p.until(TOPBAR + (marker ? " && (" + marker + ")" : ""), 20000);
  }
  const text = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); return n ? n.textContent : ''; })()");
  const clickSel = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); if (n) n.click(); return !!n; })()");
  const row = (p, name, job) => p.eval("(() => { const r = Array.from(document.querySelectorAll('#shList .sh-row')).find((x) => x.querySelector('.sh-name') && " +
    "x.querySelector('.sh-name').textContent === " + JSON.stringify(name) + (job ? " && x.textContent.indexOf(" + JSON.stringify(job) + ") !== -1" : "") +
    "); if (r) r.click(); return r ? Number(r.getAttribute('data-shoot')) : 0; })()");
  const pickLater = (p, n) => p.eval("(() => { const all = Array.from(document.querySelectorAll('#mvDay [data-act=pick]')); const i = all.findIndex((b) => /\\bcur\\b/.test(b.className)); " +
    "const d = all.slice(i + 1).filter((b) => !/\\boff\\b/.test(b.className))[" + (n || 0) + "]; if (d) d.click(); return d ? d.getAttribute('data-day') : null; })()");
  const choose = (p, name, value) => p.eval("(() => { const r = Array.from(document.querySelectorAll('input[name=" + name + "]')).find((x) => x.value === " + JSON.stringify(value) + "); " +
    "if (r) r.click(); return !!r; })()");
  const PREVIEWED = "(() => { const b = document.getElementById('mvApply'); const t = document.getElementById('mvPreview').textContent; " +
    "return !!b && !/Checking|checking again/.test(t) && (/Will move|Goes back|No shoot moves|Stays/.test(t) || !!document.querySelector('#mvPreview .no')); })()";
  const SHEET_OPEN = "!!document.getElementById('shMo')";
  const sheetPreview = (p) => p.eval("import('/js/pages/shoots.js').then((m) => { const mv = m._test.state.mv; const want = m._test.argsNow(false); " +
    "const h = Array.from(document.querySelectorAll('#mvPreview h4')).find((x) => /^Will move/.test(x.textContent)); const ul = h ? h.nextElementSibling : null; " +
    "return { pv: mv && mv.pv ? JSON.parse(JSON.stringify(mv.pv)) : null, want, planId: mv ? mv.planId : null, " +
    "listed: ul ? Array.from(ul.querySelectorAll('li > b')).map((b) => b.textContent) : [] }; })");
  const waitDetail = (p, re, ms) => p.until("(" + re.toString() + ").test(document.getElementById('shDScroll').textContent)", ms || 35000);
  async function shot(p, name, device, dark) {
    if (SHOTS === "none") return;
    await p.dark(dark);
    await sleep(300);
    await p.shot("pglite_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png");
    shots += 1;
    await p.dark(false);
  }
  async function audit(p, label, scope, phone) {
    if (phone) check(label + ": no page scrolls sideways at 375 px", await p.eval("document.documentElement.scrollWidth <= innerWidth + 1"));
    const t = await p.eval("__targets(" + JSON.stringify(scope) + ", " + (phone ? 40 : 24) + ")");
    check(label + ": every control is a tap target of at least " + (phone ? 40 : 24) + " px (" + t.n + ")", t.n > 0 && !t.bad.length, t.bad.slice(0, 8));
    await p.eval("(() => { const s = document.createElement('style'); s.id = '__e2eStill'; s.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'; document.head.appendChild(s); return true; })()");
    for (const dark of [false, true]) {
      await p.dark(dark);
      await sleep(150);
      const c = await p.eval("__contrast(" + JSON.stringify(scope) + ")");
      check(label + ": the text reaches AA contrast, " + (dark ? "dark" : "light") + " (" + c.n + " texts)", c.n > 0 && !c.bad.length, c.bad.slice(0, 8));
    }
    await p.dark(false);
    await p.eval("(() => { const s = document.getElementById('__e2eStill'); if (s) s.remove(); return true; })()");
  }

  try {
    /* ── the photographer on a phone ──────────────────────────────────────────────────────────────────── */
    const ph = await tab("pglite-photographer");
    await ph.size(375, 812, true);
    let bfId = 0;
    let moveOneId = 0;
    await attempt("PGlite photographer: Home's card and the top bar from the real photo_my_access; the Agenda from the mirror", async () => {
      await signIn(ph, "field");
      await ph.until("!!document.getElementById('hmShoots') && Array.from(document.querySelectorAll('#dcr2Nav a')).some((a) => a.getAttribute('href') === 'shoots.html')", 15000);
      check("PGlite: Home's 📷 Shoot schedule card and the top bar's entry for the photographer", true);
      await open(ph, "/shoots.html", LIST);
      check("PGlite: the Agenda reads the mirror (A000T9's shoots)", /Permit board photo/.test(await text(ph, "#shList")) && /You: photographer \(the default photographer\)/.test(await text(ph, "#shWho")),
        await text(ph, "#shWho"));
      await audit(ph, "PGlite photographer phone Agenda", "#shRoot", true);
      await shot(ph, "agenda", "phone", false);
      await shot(ph, "agenda", "phone", true);
    }, ph);

    await attempt("PGlite: Move… - the three choices, each previewed by the real photo_change_preview, every shoot that moves listed", async () => {
      bfId = await row(ph, "Before framing", "A000T9");
      await ph.until("!!document.querySelector('#shDScroll [data-act=move]')", 8000);
      await clickSel(ph, "#shDScroll [data-act=move]");
      await ph.until(SHEET_OPEN + " && !!document.getElementById('mvChoices')", 8000);
      const kinds = await ph.eval("Array.from(document.querySelectorAll('input[name=mvKind]')).map(r => r.value + (r.checked ? '*' : '')).join('|')");
      check("PGlite: Move… asks the three choices, Only this shoot preselected", kinds === "move_one*|move_later|milestone", kinds);
      for (const kind of ["move_later", "milestone", "move_one"]) {
        await choose(ph, "mvKind", kind);
        await ph.until("!!document.querySelector('#mvDay [data-act=pick]')", 5000);
        await pickLater(ph, 1);
        await ph.until(PREVIEWED, 15000);
        const sp = await sheetPreview(ph);
        const real = await rpc(P.field.id, "photo_change_preview", { p_plan: sp.planId, p_kind: sp.want.kind, p_args: sp.want.args });
        const keys = (x) => (x || []).map((m) => m.key + ">" + m.to).sort().join(",");
        check("PGlite " + kind + ": the sheet lists every shoot the database's preview moves (" + real.moved.length + "), as it answered",
          keys(sp.pv.moved) === keys(real.moved) && JSON.stringify(sp.listed.slice().sort()) === JSON.stringify(real.moved.map((m) => m.name).sort()) &&
          (kind === "move_one" || real.moved.length >= 1), { listed: sp.listed, real: real.moved.map((m) => m.name), refused: real.refused });
        if (kind === "move_later") await shot(ph, "move_later", "phone", false);
      }
      await audit(ph, "PGlite photographer phone Move…", "#shMo", true);
    }, ph);

    await attempt("PGlite: Only this shoot applied - waiting, the office computer (agents RPCs: take, mirror, done), Applied; the mirror's days the preview's", async () => {
      const sp = await sheetPreview(ph);
      const plan = (await sql("select rev from public.photo_plans where id = $1", [sp.planId]))[0];
      await clickSel(ph, "#mvApply");
      await waitDetail(ph, /Waiting for the office computer/, 10000);
      const c = await lastChange();
      moveOneId = Number(c.id);
      check("PGlite: queued as new with the rev the screen read", c.status === "new" && c.kind === "move_one" && Number(c.base_rev) === Number(plan.rev), c);
      await shot(ph, "waiting", "phone", false);
      const before = await planShoots(sp.planId);
      const r = await pcStep();
      check("PGlite: the office computer took it and applied it", r && r.outcome === "applied" && r.moved.length === sp.pv.moved.length, r && r.moved);
      await waitDetail(ph, /Your recent changes[\s\S]*Applied/);
      const after = await planShoots(sp.planId);
      const changed = after.filter((a) => (before.find((b) => b.key === a.key) || {}).d !== a.d).map((a) => a.key + ">" + a.d).sort().join(",");
      check("PGlite: Applied on the page (its poll); the mirror's moved shoots are exactly the preview's, on its days",
        changed === sp.pv.moved.map((m) => m.key + ">" + m.to).sort().join(","), changed);
      await shot(ph, "applied", "phone", false);
    }, ph);

    await attempt("PGlite: a Firm job date as the photographer - Send to the office, answered Sent to the office to approve", async () => {
      await ph.eval("document.getElementById('shBack').click(); true");
      await sleep(400);
      await row(ph, "Framing progress #2", "A000T9");
      await ph.until("!!document.querySelector('#shDScroll [data-act=move]')", 8000);
      await clickSel(ph, "#shDScroll [data-act=move]");
      await ph.until(SHEET_OPEN, 8000);
      await choose(ph, "mvKind", "milestone");
      await sleep(200);
      check("PGlite: the Firm job date said before Apply", (await text(ph, "#mvNote")) === "This job date (Framing start) is Firm - your change goes to the office to approve", await text(ph, "#mvNote"));
      await pickLater(ph, 1);
      await ph.until(PREVIEWED, 15000);
      check("PGlite: Apply reads Send to the office", (await text(ph, "#mvApply")) === "Send to the office", await text(ph, "#mvApply"));
      await shot(ph, "milestone_firm", "phone", true);
      await clickSel(ph, "#mvApply");
      await ph.until("!(" + SHEET_OPEN + ")", 10000);
      const c = await lastChange();
      check("PGlite: the database marked it for the office (needs_office)", c.kind === "milestone" && c.needs_office === true, c);
      const r = await pcStep();
      check("PGlite: the office computer answered suggested", r && r.outcome === "suggested");
      await waitDetail(ph, /Sent to the office to approve/);
      check("PGlite: the shoot says Sent to the office to approve: Framing start is Firm", /Sent to the office to approve\s*Framing start is Firm/.test(await text(ph, "#shDScroll")), await text(ph, "#shDScroll"));
    }, ph);

    await attempt("PGlite: a stale base rev - PT409 changed, the new preview, Apply with the new rev; then Cancel while new", async () => {
      await ph.eval("document.getElementById('shBack').click(); true");
      await sleep(400);
      await row(ph, "Drone airspace check", "A000T9");
      await ph.until("!!document.querySelector('#shDScroll [data-act=move]')", 8000);
      await clickSel(ph, "#shDScroll [data-act=move]");
      await ph.until(SHEET_OPEN, 8000);
      await pickLater(ph, 2);
      await ph.until(PREVIEWED, 15000);
      // the office moves the same shoot in DCR Agents 2 meanwhile: mirrored with a higher rev
      const dc = T9.shoots.find((s) => s.key === "drone-check");
      const d2 = new Date(Date.parse(dc.planned_date + "T12:00:00Z") + 2 * 86400000).toISOString().slice(0, 10);
      Object.assign(dc, { planned_date: d2, fixed_date: d2 });
      await beat();
      await mirror(T9.plan.local_id);
      const n0 = Number((await sql("select count(*)::int as n from public.photo_changes"))[0].n);
      await clickSel(ph, "#mvApply");
      await ph.until("document.getElementById('mvMsg').textContent === 'Someone changed this plan meanwhile - here is the new preview.'", 15000);
      await ph.until(PREVIEWED, 15000);
      check("PGlite: PT409 from the real photo_change_request - said in plain words, the new preview, nothing queued",
        Number((await sql("select count(*)::int as n from public.photo_changes"))[0].n) === n0 && /→/.test(await text(ph, "#mvPreview")));
      await audit(ph, "PGlite photographer phone the changed-meanwhile preview", "#shMo", true);
      await clickSel(ph, "#mvApply");
      await ph.until("!(" + SHEET_OPEN + ")", 10000);
      const c = await lastChange();
      const rev = (await sql("select rev from public.photo_plans where id = $1", [T9.id]))[0].rev;
      check("PGlite: then Apply goes with the new rev", c.status === "new" && Number(c.base_rev) === Number(rev), [c.base_rev, rev]);
      await ph.until("!!document.querySelector('#shDScroll [data-act=cancel-change]')", 10000);
      await clickSel(ph, "#shDScroll [data-act=cancel-change]");
      await ph.until("!!document.querySelector('.dcr-mo.open #dcrMoYes')", 5000);
      await ph.eval("document.querySelector('.dcr-mo.open #dcrMoYes').click(); true");
      await ph.until("!document.querySelector('#shDScroll [data-act=cancel-change]')", 15000);
      check("PGlite: Cancel while new - the real photo_change_cancel, cancelled", (await sql("select status from public.photo_changes where id = $1", [c.id]))[0].status === "cancelled");
    }, ph);

    await attempt("PGlite: Undo my last change (the move of Before framing); Mark done", async () => {
      await ph.eval("document.getElementById('shBack').click(); true");
      await sleep(400);
      await row(ph, "Before framing", "A000T9");
      await ph.until("!!document.querySelector('#shDScroll [data-act=undo]')", 10000);
      await clickSel(ph, "#shDScroll [data-act=undo]");
      await ph.until(PREVIEWED, 15000);
      check("PGlite Undo: the database's preview sets the move back", /Goes back \(1\)/.test(await text(ph, "#mvPreview")), await text(ph, "#mvPreview"));
      await clickSel(ph, "#mvApply");
      await ph.until("!(" + SHEET_OPEN + ")", 10000);
      const r = await pcStep();
      check("PGlite Undo: taken and applied by the office computer", r && r.c.kind === "undo" && r.outcome === "applied");
      const orig = (await sql("select undone_by from public.photo_changes where id = $1", [moveOneId]))[0];
      check("PGlite Undo: the original change is undone (undone_by)", Number(orig.undone_by) === Number(r.c.id), orig);
      await ph.eval("document.getElementById('shBack').click(); true");
      await sleep(400);
      await row(ph, "Lot before work", "A000T9");
      await ph.until("!!document.querySelector('#shDScroll [data-act=done]')", 10000);
      await clickSel(ph, "#shDScroll [data-act=done]");
      await ph.until("!!document.getElementById('dnNote')", 5000);
      await ph.eval("document.getElementById('dnNote').value = 'All shots taken'; document.getElementById('mvApply').click(); true");
      await ph.until("!(" + SHEET_OPEN + ")", 10000);
      const d = await pcStep();
      check("PGlite Mark done: taken and applied", d && d.c.kind === "done" && d.outcome === "applied");
      await waitDetail(ph, /Lot before work marked done/);
      const s = await shootRow("lot-before");
      await ph.until("/^Done/.test(document.querySelector('#shDScroll .sh-dtop').textContent)", 10000).catch(() => null);
      const t = await text(ph, "#shDScroll");
      check("PGlite Mark done: the mirror says done, the page too", s.status === "done" && /^Done/.test(await text(ph, "#shDScroll .sh-dtop")), { s, t: t.slice(0, 400) });
    }, ph);

    await attempt("PGlite: the office computer off - the header says so; a ?shoot= link opened cold", async () => {
      await sql("update app.agents_hosts set at = now() - interval '2 hours' where host_id = $1", [HOST]);
      await open(ph, "/shoots.html", LIST);
      check("PGlite: the header from the real photo_pc_status", /^The office computer is off - changes wait until it is back on \(last seen 2 h ago\)/.test(await text(ph, "#shPc")), await text(ph, "#shPc"));
      await shot(ph, "pc_off", "phone", true);
      await beat();
      const dc = await shootRow("drone-check");
      await open(ph, "/shoots.html?shoot=" + dc.id, "!!document.getElementById('shDTitle')");
      check("PGlite: ?shoot= opens that shoot full screen", (await text(ph, "#shDTitle")) === "Drone airspace check" && (await ph.eval("document.getElementById('shDetail').classList.contains('open')")));
    }, ph);

    /* ── marketing, a lead on no team ─────────────────────────────────────────────────────────────────── */
    const mk = await tab("pglite-marketing");
    await mk.size(375, 812, true);
    await attempt("PGlite: marketing reads only; a lead on no team is told no", async () => {
      await signIn(mk, "viewer", "shoots.html");
      await mk.until(LIST, 15000);
      await row(mk, "Framing complete", "A000T8");
      await mk.until("!!document.getElementById('shDTitle')", 8000);
      check("PGlite marketing: the mirror read, no action button", await mk.eval("!document.querySelector('#shRoot [data-act=move], #shRoot [data-act=done], #shRoot [data-act=undo], #shRoot [data-act=cancel-change]')") &&
        /You: marketing - read only/.test(await text(mk, "#shWho")));
      await signIn(mk, "lead");
      await sleep(1500);
      check("PGlite lead: no Home card, no top bar entry", !(await mk.eval("!!document.getElementById('hmShoots')")) &&
        !(await mk.eval("Array.from(document.querySelectorAll('#dcr2Nav a')).some((a) => a.getAttribute('href') === 'shoots.html')")));
      await open(mk, "/shoots.html", "/Not for your account/.test(document.getElementById('shList').textContent)");
      check("PGlite lead: shoots.html says plainly it is not for this account; nothing of the mirror shown", (await mk.eval("document.querySelectorAll('#shRoot .sh-row').length")) === 0);
      await shot(mk, "lead_no_access", "phone", false);
    }, mk);

    /* ── the admin on a desk ──────────────────────────────────────────────────────────────────────────── */
    const dk = await tab("pglite-admin-desk");
    await dk.size(1440, 900, false);
    await attempt("PGlite admin: the desk; the Access tab's Photo team through the real set_photo_team", async () => {
      await signIn(dk, "admin");
      await open(dk, "/shoots.html", LIST);
      await row(dk, "Delivery day", "A000T9");
      await dk.until("!!document.getElementById('shDTitle')", 8000);
      check("PGlite admin desk: the shoot beside the list", await dk.eval("document.getElementById('shDetail').getBoundingClientRect().left > document.getElementById('shList').getBoundingClientRect().right - 1"));
      await audit(dk, "PGlite admin desk Agenda", "#shRoot", false);
      await shot(dk, "agenda", "desktop", false);
      await open(dk, "/admin.html?tab=access", "document.querySelectorAll('#adPhoto [data-person]').length > 2");
      const line = (name) => "Array.from(document.querySelectorAll('#adPhoto [data-person]')).find(r => r.querySelector('b').textContent.indexOf(" + JSON.stringify(name) + ") === 0)";
      const team = async (id) => (await sql("select photographer, marketing, default_photographer, google_email, version from public.photo_team where profile_id = $1", [id]))[0] || null;
      await dk.eval("(() => { " + line(P.lead.name) + ".querySelector('[data-ph=photographer]').click(); " + line(P.lead.name) + ".querySelector('[data-phsave]').click(); return true; })()");
      await dk.until(line(P.lead.name) + ".classList.contains('on') && " + line(P.lead.name) + ".querySelector('[data-phacts]').hidden", 15000);
      const t1 = await team(P.lead.id);
      check("PGlite Photo team: a second photographer (not the default by himself)", t1 && t1.photographer && !t1.default_photographer, t1);
      await dk.until("!" + line(P.lead.name) + ".querySelector('[data-ph=isDefault]').disabled", 5000);
      await dk.eval("(() => { " + line(P.lead.name) + ".querySelector('[data-ph=isDefault]').click(); " + line(P.lead.name) + ".querySelector('[data-phsave]').click(); return true; })()");
      await dk.until("/default photographer: " + P.lead.name + "/.test(document.getElementById('adPhoto').textContent)", 15000);
      check("PGlite Photo team: the default moved (one default; Flo keeps the Photographer tick)", (await team(P.lead.id)).default_photographer === true &&
        (await team(P.field.id)).default_photographer === false && (await team(P.field.id)).photographer === true &&
        Number((await sql("select count(*)::int as n from public.photo_team where default_photographer"))[0].n) === 1);
      await dk.eval("(() => { const r = " + line(P.accountant.name) + "; r.querySelector('[data-ph=marketing]').click(); return true; })()");
      await sleep(250);
      await dk.eval("(() => { const r = " + line(P.accountant.name) + "; const i = r.querySelector('[data-ph=googleEmail]'); i.value = ' Ace.Accountant@Example.COM '; i.dispatchEvent(new Event('input', { bubbles: true })); r.querySelector('[data-phsave]').click(); return true; })()");
      await dk.until(line(P.accountant.name) + ".classList.contains('on') && " + line(P.accountant.name) + ".querySelector('[data-phacts]').hidden", 15000);
      check("PGlite Photo team: a marketing member's Google e-mail, in lower case by the database", (await team(P.accountant.id)).google_email === "ace.accountant@example.com");
      // another admin saves the accountant's line meanwhile: the card still shows the old version
      const v = (await team(P.accountant.id)).version;
      await rpc(P.admin.id, "set_photo_team", { p_profile: P.accountant.id, p_photographer: false, p_marketing: true, p_default: false, p_google_email: "ace.office@example.com", p_version: v });
      await dk.eval("(() => { const r = " + line(P.accountant.name) + "; const i = r.querySelector('[data-ph=googleEmail]'); i.value = 'ace.photos@example.com'; i.dispatchEvent(new Event('input', { bubbles: true })); r.querySelector('[data-phsave]').click(); return true; })()");
      await dk.until("/Someone changed the photo team meanwhile/.test(document.getElementById('adPhoto').textContent)", 15000);
      check("PGlite Photo team: the real PT409 changed - nothing written over, the list read again and said so",
        (await team(P.accountant.id)).google_email === "ace.office@example.com" &&
        (await dk.eval("(() => { const r = " + line(P.accountant.name) + "; return r.querySelector('[data-ph=googleEmail]').value === 'ace.office@example.com'; })()")));
      check("PGlite Photo team: the admin was never listed by itself", !(await team(P.admin.id)));
      await audit(dk, "PGlite admin desk the Photo team", "#adPhoto", false);
      await dk.eval("document.getElementById('adPhoto').scrollIntoView({ block: 'start' }); true");
      await shot(dk, "photo_team", "desktop", false);
    }, dk);

    /* ── no security-policy violation, no console error ────────────────────────────────────────────────── */
    for (const p of pages) {
      const bad = p.log.filter((x) => /CSP-VIOLATION|Content Security Policy/i.test(x.text) || x.level === "exception" ||
        (x.level === "error" && !/favicon\.ico|net::ERR_ABORTED|ERR_NAME_NOT_RESOLVED/.test(x.text + " " + (x.url || ""))));
      check(p.name + ": no CSP violation, no console error", !bad.length, bad.slice(0, 5).map((x) => x.level + " " + x.text.slice(0, 200) + " @ " + x.url).join(" | "));
    }
  } finally {
    try { proc.kill(); } catch (e) { /* */ }
    await S.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results, shots, out: OUT }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
