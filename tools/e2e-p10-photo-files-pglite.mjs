#!/usr/bin/env node
/* DCR Portal 2 — the photo files end to end on the REAL database rules (the photographer screen program, P5, the OneDrive
   edition; development only).

     DCR_DESKTOP2_DIR=<DCR Desktop 2> PGLITE_DIR=<folder with node_modules/@electric-sql/pglite> \
       node tools/e2e-p10-photo-files-pglite.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/pglite-serve.mjs with {photoFiles: true}: the site, every page's supabase-js calls replayed on PGlite loaded
   with every DCR Desktop 2 migration - both photo files migrations in order, 20261111000100_photo_files and
   20261114000100_photo_files_onedrive - as the signed-in person, and the function "photo-files" ([Check again]) played by
   its own service-role SQL over that database with a made-up OneDrive (tools/pglite-p10-photo-files.mjs; nothing reaches
   Microsoft or Supabase: Chrome's resolver sends *.supabase.co and *.sharepoint.com nowhere). THIS SCRIPT PLAYS THE OTHER
   APPS: DCR Agents 2 (the lease, the mirror: the shoot marked done), photo-files' health (the root seen), DCR Desktop 2's
   setup card (uploads on, the company's e-mail domain, Mark as shared) and DCR Desktop 2 on the photographer's PC (a
   hand-in recorded with its hashes and sealed, its sessions and beat, its files landing in OneDrive).

   The walk, on a phone (375x812) as marketing (Vi Viewer), then a desk as the admin:
   * the shoot's Files section from the real status: sending from PHOTO-PC (with the time left), the access line in Open
     in OneDrive's place (the account not marked shared yet); every file in OneDrive with no hash yet: checking; [Check
     again] - the real gdrive_check_apply reads each item by id: all in OneDrive ✓, "mark the shoot done";
   * DCR Agents 2 mirrors the shoot done: the real ready check fires once - the page says "Sent to marketing"; the Ready
     card (?ready=<id>, the push notice's link) says why there is no Open in OneDrive yet; I'm on it, Posted… (where, an
     https link) in the database;
   * the admin changes the marketing member's Microsoft account on the Access tab (saved, nothing shared by itself), and
     marks it shared (DCR Desktop 2's Photo team line): the member's next read has Open in OneDrive;
   * every screen audited (no sideways scroll, tap targets, AA contrast light and dark); no CSP violation, no console error.
   The phone's own hand-in (pick, send, resume, reload) is walked in the demo (tools/e2e-p10-photo-files.mjs) and over
   these same migrations by tools/schema-check.mjs's P5 part (js/photo-send.js with the real RPCs). Made-up people, jobs,
   items and hashes only. Prints a JSON summary; exit code 1 when a check failed. */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Cdp, CHROMES, newPage, sleep } from "./cdp.mjs";
import { startPgliteServer, emailOf, passwordOf } from "./pglite-serve.mjs";
import { pageHelpers } from "./e2e-p10-photo.mjs";
import { walkHelpers } from "./e2e-p10-photo-files.mjs";
import { WORDS } from "../site/js/map/photo-words.js";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p10-photo-files-pglite")));
const HOST = "E2E-FILES-PC#agents2";
const LEDGER = "e2e50000-0000-4000-8000-0000000000a1";
const AGENTS = { id: "e5b00000-0000-4000-8000-0000000000a9", name: "Agents Pc", email: "agents@e2e.test" };

async function launch(chrome) {
  const exe = [chrome].concat(CHROMES).find((p) => p && existsSync(p));
  if (!exe) throw new Error("no Chrome or Edge found (use --chrome <path>)");
  const profile = mkdtempSync(join(tmpdir(), "dcr2-chrome-"));
  const proc = spawn(exe, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile, "--no-first-run",
    "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--disable-default-apps", "--disable-extensions", "--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication",
    "--host-resolver-rules=MAP *.supabase.co ~NOTFOUND, MAP *.supabase.in ~NOTFOUND, MAP nominatim.openstreetmap.org ~NOTFOUND, MAP cdn.jsdelivr.net ~NOTFOUND, MAP *.sharepoint.com ~NOTFOUND, MAP *.microsoftonline.com ~NOTFOUND, MAP graph.microsoft.com ~NOTFOUND",
    "--metrics-recording-only", "--mute-audio", "--password-store=basic", "about:blank"], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const [port, path] = readFileSync(portFile, "utf8").trim().split(/\r?\n/);
  const cdp = new Cdp("ws://127.0.0.1:" + port + path);
  await cdp.ready;
  return { cdp, proc };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const S = await startPgliteServer({ photoFiles: true });
  const { base, sql, asPerson, people: P, photoFiles: G } = S;
  const results = [];
  const pages = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail: detail === undefined ? "" : detail });
    process.stderr.write((ok ? "  ok   " : "  FAIL ") + name + (ok ? "" : " :: " + String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 600)) + "\n");
  };
  const attempt = async (name, fn, page) => {
    try { await fn(); } catch (e) {
      let where = "";
      if (page) {
        try { where = " @ " + await page.eval("location.href + ' :: ' + (document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300) : '')"); }
        catch (x) { where = " @ (page not answering: " + x.message + ")"; }
      }
      check(name, false, String(e && e.message || e).slice(0, 400) + where);
    }
  };
  const H = walkHelpers({ check, shotPrefix: "pglite_files_" });
  const { text, clickSel, audit, shots2 } = H;

  /* ── the other apps: DCR Agents 2's lease and mirror, the photo team, Desktop 2 on the photographer's PC ── */
  const rpc = async (uid, name, a) => {
    const keys = Object.keys(a);
    const rows = await asPerson(uid, "select public." + name + "(" + keys.map((k, i) => k + " => $" + (i + 1)).join(", ") + ") as r",
      keys.map((k) => (a[k] !== null && typeof a[k] === "object" ? JSON.stringify(a[k]) : a[k])));
    return rows[0].r;
  };
  await sql("insert into auth.users (id, email) values ($1, $2)", [AGENTS.id, AGENTS.email]);
  await asPerson(P.admin.id, "insert into public.profiles (id, full_name, email, role) values ($1, $2, $3, 'agents')", [AGENTS.id, AGENTS.name, AGENTS.email]);
  await sql("update app.agents_lease set host_id = $1, since = now(), lease_by = 'e2e-p10-photo-files' where id = 1", [HOST]);
  await sql("delete from app.agents_hosts where host_id = $1", [HOST]);
  await sql("insert into app.agents_hosts (host_id, at, version, proto, standby, payload) values ($1, now(), '2.2.0', 1, false, '{\"paused\": false}')", [HOST]);
  await rpc(P.admin.id, "set_photo_team", { p_profile: P.field.id, p_photographer: true, p_marketing: false });
  await rpc(P.admin.id, "set_photo_team", { p_profile: P.viewer.id, p_photographer: false, p_marketing: true, p_default: false, p_google_email: "vi.viewer.e2e@example.com" });
  const today = (await sql("select app.today()::text as d"))[0].d;
  const day = (n) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  let REV = 800;
  const shoots = [{ local_id: 1, key: "delivery", seq: 100, phase: "delivery", name: "Delivery day", anchor: "fixed", offset_days: 0, fixed_date: day(-1),
    planned_date: day(-1), window_days: 0, status: "planned", brief: { purpose: "The trusses going up." } }];
  const plan = { local_id: 1, status: "active", project_code: "A000T4", project_label: "A000T4 Sample barn", city: "Sandbox", title: "Barn photo plan",
    photographer: P.field.name, photographer_source: "plan",
    milestones: { framing_start: { date: day(-10), source: "admin", confirmed: true }, delivery: { date: day(-1), source: "admin", confirmed: true },
      framing_complete: { date: day(20), source: "estimate", confirmed: false }, house_complete: { date: null, source: "estimate", confirmed: false } },
    shoot_days: [0, 1, 2, 3, 4, 5], lead_days: 3, series: [], open_suggestions: 0, activated_at: new Date(Date.now() - 20 * 86400e3).toISOString() };
  const mirror = () => rpc(AGENTS.id, "agents_photo_mirror", { p_host: HOST, p_ledger: LEDGER, p_plan: plan, p_shoots: shoots, p_rev: ++REV });
  const m = await mirror();
  const shootId = Number(m.shoots[0].id);
  await G.world.connect(P.admin.id);
  await G.world.domains(P.admin.id, "example.com");
  const hi = await G.world.handIn(P.field.id, shootId, ["IMG_0001.JPG", "IMG_0002.JPG", "C0001.MP4"]);

  const { cdp, proc } = await launch(arg("--chrome"));
  const TOPBAR = "!!document.querySelector('.dcr2-topbar .p2-badge')";
  async function tab(name) {
    const p = await newPage(cdp, name, OUT, true);
    await p.call("Page.addScriptToEvaluateOnNewDocument", { source: "(" + pageHelpers.toString() + ")();" });
    pages.push(p);
    return p;
  }
  async function signIn(p, key, next) {
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
    await p.goto(base + "/index.html?next=" + encodeURIComponent(next || "dashboard.html"), 150);
    await p.until("!!document.getElementById('loginForm') && !!window.DCR2PGlite && !document.getElementById('loginFields').disabled", 10000);
    await p.eval("document.getElementById('email').value=" + JSON.stringify(emailOf(key)) + ";document.getElementById('password').value=" + JSON.stringify(passwordOf(key)) + ";" +
      "document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname) && " + TOPBAR, 15000);
  }
  async function open(p, pathname, marker) {
    await p.goto(base + pathname, 150);
    await p.until(TOPBAR + (marker ? " && (" + marker + ")" : ""), 20000);
  }
  const FILES = "!!document.querySelector('#shDScroll .sh-flines')";
  const lines = (p) => p.eval("Array.from(document.querySelectorAll('#shDScroll .sh-fl')).map((n) => n.getAttribute('data-line')).join(',')");
  const marketingRow = async () => (await sql("select id, state, posted_where, posted_link from public.photo_marketing where shoot_id = $1", [shootId]))[0];

  try {
    const ph = await tab("marketing-phone");
    await ph.size(375, 812, true);
    await attempt("PGlite phone: the Files section from the real status - sending from the PC, then in OneDrive and checking; Check again through photo-files' own SQL - all in OneDrive", async () => {
      await signIn(ph, "viewer");
      await open(ph, "/shoots.html?shoot=" + shootId, FILES);
      check("PGlite: sending from PHOTO-PC with the time left; the account not marked shared yet - the access line in Open in OneDrive's place (the real photo_drive_status)",
        (await lines(ph)) === "sending,access_waiting" && /^Sending to OneDrive from PHOTO-PC: 0 of 3 files \(256 KB of 6 MB\) - about \d+ min left\.$/.test(await text(ph, "#shDScroll [data-line=sending]")),
        (await lines(ph)) + " | " + await text(ph, "#shDScroll [data-line=sending]"));
      check("PGlite: no Open in OneDrive yet", !(await ph.eval("!!document.querySelector('#shDScroll [data-act=open-folder]')")));
      await audit(ph, "PGlite phone the Files section (sending)", "#shDetail", true);
      await shots2(ph, "sending", "phone");
      // every file's last chunk in, read by id by its done before OneDrive has its hash
      const seen = await G.world.landed(hi.upload);
      check("PGlite: the real gdrive_items_seen - in OneDrive, no hash yet: checking", (seen.items || []).every((x) => x.state === "checking"), JSON.stringify(seen).slice(0, 300));
      await open(ph, "/shoots.html?shoot=" + shootId, FILES);
      check("PGlite: all the files are in OneDrive - checking the last 3", (await lines(ph)) === "checking,access_waiting" &&
        (await text(ph, "#shDScroll [data-line=checking]")) === "All the files are in OneDrive - checking the last 3…", await lines(ph));
      await shots2(ph, "checking", "phone");
      G.world.hashed();                      // OneDrive has made its hashes
      await sleep(21000);                    // the 20 s per shoot (the folder's checked_at, the database's clock)
      await clickSel(ph, "#shDScroll [data-act=files-check]");
      await ph.until("document.querySelector('#shDScroll .sh-fl') && document.querySelector('#shDScroll .sh-fl').getAttribute('data-line') === 'confirmed'", 30000);
      check("PGlite: the real check read each item by id - all in OneDrive ✓, and mark the shoot done", /All 3 files are in OneDrive ✓/.test(await text(ph, "#shDScroll")) &&
        /mark the shoot done to send it to marketing/.test(await text(ph, "#shDScroll")));
      await audit(ph, "PGlite phone the Files section (all in OneDrive)", "#shDetail", true);
      await shots2(ph, "confirmed", "phone");
    }, ph);

    await attempt("PGlite phone: DCR Agents 2 marks it done - the real ready check fires once; the Ready card (?ready=), I'm on it, Posted…", async () => {
      shoots[0].status = "done";
      shoots[0].done_at = new Date().toISOString();
      shoots[0].done_source = "shoot page";
      await mirror();
      const row = await marketingRow();
      check("PGlite: on the Ready list once", row && row.state === "ready");
      await open(ph, "/shoots.html?shoot=" + shootId, FILES + " && /Sent to marketing/.test(document.getElementById('shDScroll').textContent)");
      check("PGlite: the sheet says Sent to marketing", true);
      await open(ph, "/shoots.html?ready=" + row.id, "!!document.querySelector('#shDScroll [data-act=r-claim]')");
      check("PGlite: no Open in OneDrive until the account is marked shared", !(await ph.eval("!!document.querySelector('#shDScroll [data-act=r-open]')")));
      check("PGlite: the card says why in its place - the office hasn't given the account access yet (the real photo_ready_list's me.drive_access)",
        await ph.eval("(() => { const b = document.querySelector('#shDScroll [data-warning=access_waiting]'); return !!b && b.textContent === " + JSON.stringify(WORDS.ready.access_waiting) + "; })()"),
        await text(ph, "#shDScroll"));
      await audit(ph, "PGlite phone a Ready card", "#shDetail", true);
      await shots2(ph, "ready_card", "phone");
      await clickSel(ph, "#shDScroll [data-act=r-claim]");
      await ph.until("/You're on it/.test(document.getElementById('shDScroll').textContent)", 15000);
      await clickSel(ph, "#shDScroll [data-act=r-posted]");
      await ph.until("!!document.getElementById('shMo')", 5000);
      await ph.eval("(() => { document.querySelector('#shMo input[value=instagram]').click(); document.getElementById('rsLink').value = 'https://www.example.com/p/barn'; document.getElementById('mvApply').click(); return true; })()");
      await ph.until("!document.getElementById('shMo')", 15000);
      const after = await marketingRow();
      check("PGlite: Posted - where and the link in the database", after.state === "posted" && JSON.stringify(after.posted_where) === JSON.stringify(["instagram"]) &&
        after.posted_link === "https://www.example.com/p/barn", JSON.stringify(after));
    }, ph);

    const dk = await tab("admin-desk");
    await dk.size(1440, 900, false);
    await attempt("PGlite desk: the admin changes the marketing member's Microsoft account - saved, nothing shared by itself; marked shared (DCR Desktop 2's Photo team line): the member gets Open in OneDrive", async () => {
      await signIn(dk, "admin");
      await open(dk, "/admin.html?tab=access", "document.querySelectorAll('#adPhoto [data-person]').length > 2");
      const line = "Array.from(document.querySelectorAll('#adPhoto [data-person]')).find(r => r.querySelector('b').textContent.indexOf(" + JSON.stringify(P.viewer.name) + ") === 0)";
      await dk.eval("(() => { const r = " + line + "; const i = r.querySelector('[data-ph=googleEmail]'); i.value = 'vi.photos.e2e@example.com'; i.dispatchEvent(new Event('input', { bubbles: true })); r.querySelector('[data-phsave]').click(); return true; })()");
      const saved = async () => ((await sql("select google_email from public.photo_team where profile_id = $1", [P.viewer.id]))[0] || {}).google_email;
      for (let i = 0; i < 60 && (await saved()) !== "vi.photos.e2e@example.com"; i++) await sleep(250);
      check("PGlite: the Microsoft account saved (set_photo_team)", (await saved()) === "vi.photos.e2e@example.com", await saved());
      check("PGlite: nothing marked shared by itself (the office shares by hand, OD §8.1)",
        !(await sql("select 1 from app.photo_share_marks where profile_id = $1", [P.viewer.id])).length);
      await shots2(dk, "access_tab", "desktop");
      await G.world.markShared(P.admin.id, P.viewer.id);
      await open(ph, "/shoots.html?shoot=" + shootId, FILES);
      check("PGlite: the member's Open in OneDrive (can.open_folder), the folder's OneDrive link",
        await ph.eval("(() => { const a = document.querySelector('#shDScroll [data-act=open-folder]'); return !!a && /^https:\\/\\/example-my\\.sharepoint\\.com\\/personal\\/office_example_com\\//.test(a.href); })()"));
      await shots2(ph, "shared", "phone");
    }, dk);

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
  console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results: failed.length ? failed : undefined,
    shots: H.count(), drains: G.drains.length, out: OUT }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
