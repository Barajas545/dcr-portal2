#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the Files tab's OneDrive part in the DEMO (development only; Part 4, owner
   decisions 2026-10-24 D9 / D10).

     node tools/e2e-p7-onedrive.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the OneDrive part served switched on; the broker's stand-in and
   the made-up OneDrive behind it: tools/fake/p7-onedrive.js - nothing goes to Supabase or Microsoft) and drives a local
   Chrome or Edge headless:

   - every role on the sandbox project's Files tab (admin, manager, manager with prices, accountant, lead, field,
     view-only): the "OneDrive project folder" box with Floor Plans, Photos, Documents and the old portal's copy, the
     "Stored in DCR" box with the cloud rows; names about prices or money, amounts and .takeoff files only for people
     with prices (money names with financials too); the upload bar only for the people the broker says may upload
     (an admin, Quinn Manager and Riley Lead - the switch); no OneDrive camera button (photos keep the capture bar);
   - a lead on a phone: into Floor Plans, two files picked (one refused before anything is sent: a program), the PDF
     sent straight to the upload URL in chunks, "✓ Added", the folder read again with it, its row in the project's
     file list (storage local, source portal2, created by the lead) and the activity line;
   - a field person opens a file: one link, opened at once (a download: the page stays), a program never;
   - a manager on a project with no OneDrive folder yet: Make the folder; the three folders;
   - an admin on the test project A000T2: the OneDrive self-test - eight PASS lines;
   - phone (390 px, never sideways) and desktop, light and dark; no Content-Security-Policy violation and no console
     error on any page.
   Screenshots (--shots all): od_<what>_<light|dark>_<desktop|phone>.png into --out.
   Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p7-onedrive")));
const SHOTS = arg("--shots", "all");
const UPLOADERS = ["admin", "manager_prices", "lead"];
const PRICES = ["admin", "manager_prices", "accountant"];

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
  async function signIn(p, key, next) {
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
    await p.goto(base + "/index.html" + (next ? "?next=" + encodeURIComponent(next) : ""), 150);
    await p.until("!!document.getElementById('loginForm') && !!window.DCR2Demo && !document.getElementById('loginFields').disabled", 8000);
    await p.eval("document.getElementById('email').value=" + JSON.stringify(key + "@demo.test") + ";document.getElementById('password').value='demo-password-1';" +
      "document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname) && " + TOPBAR, 10000);
  }
  const emailOf = { admin: "admin", manager: "manager", manager_prices: "manager2", accountant: "accountant", lead: "lead", field: "field", viewer: "viewer" };
  const db = (p, expr) => p.eval("(() => { const R = DCR2Demo.engine.rows; return " + expr + "; })()");
  const sideways = (p) => p.eval("document.documentElement.scrollWidth - window.innerWidth");
  const listText = (p) => p.eval("(document.getElementById('odList') || {}).innerText || ''");
  const rows = (p) => p.eval("Array.from(document.querySelectorAll('#odList .od-row .pj-fname')).map(e => e.firstChild ? e.firstChild.textContent : e.textContent)");
  const ready = "!!document.querySelector('#odList .od-row') || /No OneDrive folder|could not|not set up/.test((document.getElementById('odList') || {}).innerText || '')";

  async function shoot(p, name, device, dark) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1440;
    const base0 = device === "phone" ? 844 : 900;
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: base0, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(500);
    const h = await p.eval("Math.max(" + base0 + ", Math.min(5200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(450);
    const file = "od_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: base0, deviceScaleFactor: 1, mobile: device === "phone" });
    await p.dark(false);
  }
  /** files chosen in the OneDrive picker (made-up bytes) */
  const pick = (p, list) => p.eval(`(() => {
    const input = document.getElementById('odIn'); const dt = new DataTransfer();
    ${JSON.stringify(list)}.forEach((f) => dt.items.add(new File([new Uint8Array(f.size).fill(37)], f.name, { type: f.type })));
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return input.files.length; })()`);
  const filesTab = (p, pid) => p.goto(base + "/project.html?id=" + pid + "&tab=files", 400).then(() => p.until(ready, 10000));

  let A = null, J = null;
  try {
    /* ── 0. a clean demo database; the projects the walk uses ─────────────── */
    A = await newPage(cdp, "setup", OUT); pages.push(A);
    await A.size(1440, 900, false);
    await A.goto(base + "/manifest.json", 50);
    await A.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");
    await signIn(A, "admin", "dashboard.html");
    J = await db(A, `({ sandbox: R.projects.find(p => p.number === "A267").id, empty: R.projects.find(p => p.number === "A305").id,
      test2: R.projects.find(p => p.number === "A000T2").id, files: R.files.length, maxAct: R.activity.reduce((m, x) => Math.max(m, x.id), 0) })`);
    check("demo: the sandbox, a project without a OneDrive folder (A305) and the test project A000T2 are there", J.sandbox && J.empty && J.test2, JSON.stringify(J));

    /* ── 1. every role on the sandbox's Files tab ────────────────────────── */
    for (const key of ["admin", "manager", "manager_prices", "accountant", "lead", "field", "viewer"]) {
      const p = await newPage(cdp, "files-" + key, OUT); pages.push(p);
      await attempt(key + ": the Files tab's two boxes, what is hidden, who may upload", async () => {
        await p.size(1440, 900, false);
        await signIn(p, emailOf[key], "dashboard.html");
        await filesTab(p, J.sandbox);
        const top = await rows(p);
        check(key + ": the OneDrive project folder lists Floor Plans, Photos, Documents and the old portal's copy",
          ["Floor Plans", "Photos", "Documents", "Old portal documents"].every((n) => top.includes(n)), top.join(", "));
        const contract = top.includes("Contract signed.pdf");
        check(key + ": a contract (a priced name) " + (PRICES.includes(key) ? "is listed" : "is not listed"), contract === PRICES.includes(key), top.join(", "));
        const cloud = await p.eval("({ box: !!document.getElementById('flBox'), head: (document.querySelector('#flBox .od-title') || {}).textContent || '', text: document.getElementById('flList').innerText })");
        check(key + ": the Stored in DCR box lists the cloud rows (and no OneDrive row twice)", cloud.box && /Stored in DCR/.test(cloud.head) && !/On the office computers/.test(cloud.text), JSON.stringify(cloud).slice(0, 300));
        const bar = await p.eval("({ add: !!document.getElementById('odAdd'), to: Array.from((document.getElementById('odTo') || { options: [] }).options).map(o => o.value), cam: !!document.querySelector('#odBox [capture]') })");
        check(key + ": the upload bar " + (UPLOADERS.includes(key) ? "is there (to Documents or Floor Plans)" : "is not there"),
          bar.add === UPLOADERS.includes(key) && (!bar.add || bar.to.join() === "Documents,Floor Plans") && !bar.cam, JSON.stringify(bar));
        // into Documents: the estimate quoting an amount and the money folder by switch; a lock file for nobody
        await p.eval("Array.from(document.querySelectorAll('#odList .od-row')).find(r => /Documents/.test(r.textContent)).click(); true");
        await p.until("/Project folder/.test(document.querySelector('#odList .pj-crumb').textContent) && /Documents/.test(document.querySelector('#odList .pj-crumb').textContent) && !!document.querySelector('#odList .od-row')", 8000);
        const docs = await rows(p);
        check(key + ": Documents - the estimate with an amount " + (PRICES.includes(key) ? "listed" : "hidden") + ", Invoices " +
          (["admin", "accountant"].includes(key) ? "listed" : "hidden") + ", never a lock or system file",
          docs.some((n) => /^Estimate/.test(n)) === PRICES.includes(key) && docs.includes("Invoices") === ["admin", "accountant"].includes(key) &&
          !docs.some((n) => /^~\$|desktop\.ini/i.test(n)) && docs.includes("Permit application.pdf"), docs.join(", "));
        if (key === "field" || key === "manager_prices") {
          if (SHOTS !== "none") { await shoot(p, "documents_" + key, "desktop", false); await shoot(p, "documents_" + key, "phone", true); await p.size(1440, 900, false); }
        }
        if (key === "field") {
          // opening a file: one link, opened at once; a program never
          await p.eval("window.__odClicks = []; HTMLAnchorElement.prototype.click = function () { window.__odClicks.push({ href: this.href, download: this.download }); }; true");
          await p.eval("Array.from(document.querySelectorAll('#odList .od-row')).find(r => /Permit application\\.pdf/.test(r.textContent)).click(); true");
          await p.until("window.__odClicks.length === 1", 6000);
          const c = await p.eval("window.__odClicks[0]");
          check("field: a file opens through one link made for the click (the demo's own blob, saved under its name; the page stays)",
            /^blob:/.test(c.href) && c.download === "Permit application.pdf" && /project\.html/.test(await p.eval("location.pathname")), JSON.stringify(c));
          const exe = await p.eval("(() => { const r = Array.from(document.querySelectorAll('#odList .od-row')).find(x => /Installer\\.exe/.test(x.textContent)); return r ? { dl: !!r.querySelector('[data-oddl]'), local: r.classList.contains('local') } : null; })()");
          check("field: a program is listed but never opened from the portal", exe && !exe.dl && exe.local, JSON.stringify(exe));
        }
        if (key === "viewer" && SHOTS !== "none") { await p.eval("document.querySelector('[data-odcrumb=\"0\"]').click(); true"); await sleep(600); await shoot(p, "files_viewer", "phone", false); }
        check(key + ": the Files tab never scrolls sideways on a phone", await (async () => { await p.size(390, 844, true); await sleep(400); const s = await sideways(p); await p.size(1440, 900, false); return s <= 0; })());
      }, p);
    }

    /* ── 2. a lead uploads from a phone ──────────────────────────────────── */
    const L = await newPage(cdp, "lead-upload", OUT); pages.push(L);
    await attempt("lead: two files into Floor Plans from a phone - one refused before anything is sent, one straight to OneDrive", async () => {
      await L.size(390, 844, true);
      await signIn(L, "lead", "dashboard.html");
      await filesTab(L, J.sandbox);
      await L.eval("Array.from(document.querySelectorAll('#odList .od-row')).find(r => /Floor Plans/.test(r.textContent)).click(); true");
      await L.until("/Floor Plans/.test(document.querySelector('#odList .pj-crumb').textContent) && !!document.querySelector('#odList .od-row')", 8000);
      check("lead: inside Floor Plans the files go there by default", (await L.eval("document.getElementById('odTo').value")) === "Floor Plans");
      const before = await db(A, "R.files.length");
      await pick(L, [{ name: "Level 3 framing.pdf", type: "application/pdf", size: 900000 }, { name: "setup.exe", type: "application/octet-stream", size: 2000 }]);
      await L.until("/Added/.test(document.getElementById('odJobs').innerText)", 20000);
      const jobs = await L.eval("document.getElementById('odJobs').innerText");
      check("lead: the program is refused on the page with the broker's words; the PDF is added", /cannot be uploaded here/.test(jobs) && /Level 3 framing\.pdf[\s\S]*Added/.test(jobs), jobs);
      await L.until("Array.from(document.querySelectorAll('#odList .od-row')).some(r => /Level 3 framing\\.pdf/.test(r.textContent))", 8000);
      check("lead: the folder is read again with the new file", true);
      if (SHOTS !== "none") { await shoot(L, "upload_lead", "phone", false); await shoot(L, "upload_lead", "phone", true); await L.size(390, 844, true); }
      const row = await db(A, "(() => { const f = R.files.find(x => x.name === 'Level 3 framing.pdf'); return f && { storage: f.storage, source: f.source, folder: f.folder, subpath: f.subpath, by: f.created_by, rel: f.rel_path, size: f.size }; })()");
      const leadId = await db(A, "R.profiles.find(p => p.email === 'lead@demo.test').id");
      check("lead: its row in the project's file list (storage local, source portal2, Floor Plans, the lead's)",
        row && row.storage === "local" && row.source === "portal2" && row.folder === "plans" && row.subpath === "Floor Plans" && row.by === leadId &&
        /\/Floor Plans\/Level 3 framing\.pdf$/.test(row.rel) && row.size === 900000 && (await db(A, "R.files.length")) === before + 1, JSON.stringify(row));
      const act = await db(A, "R.activity.filter(a => a.id > " + J.maxAct + " && a.project_id === " + J.sandbox + ").map(a => a.text)");
      check("lead: the activity line of the upload", act.some((t) => /Floor Plans/.test(t)), act.join(" | "));
      check("lead: the phone page never scrolls sideways with the uploads listed", (await sideways(L)) <= 0);
    }, L);

    /* ── 3. a project without a OneDrive folder: Make the folder ────────────── */
    const M = await newPage(cdp, "manager-folder", OUT); pages.push(M);
    await attempt("manager: a project without a OneDrive folder - Make the folder", async () => {
      await M.size(1440, 900, false);
      await signIn(M, "manager", "dashboard.html");
      await filesTab(M, J.empty);
      check("manager: 'No OneDrive folder for this project yet' with Make the folder", /No OneDrive folder for this project yet/.test(await listText(M)) &&
        (await M.eval("!!document.getElementById('odMake')")));
      if (SHOTS !== "none") await shoot(M, "no_folder", "desktop", false);
      await M.eval("document.getElementById('odMake').click(); true");
      await M.until("document.querySelectorAll('#odList .od-row').length === 3", 8000);
      check("manager: the three folders are there", (await rows(M)).join(",") === "Documents,Floor Plans,Photos", (await rows(M)).join(","));
    }, M);

    /* ── 4. the admin's self-test on A000T2 ──────────────────────────────── */
    const T = await newPage(cdp, "admin-selftest", OUT); pages.push(T);
    await attempt("admin: the OneDrive self-test on A000T2 - eight steps PASS", async () => {
      await T.size(1440, 900, false);
      await signIn(T, "admin", "dashboard.html");
      await filesTab(T, J.test2);
      check("admin: the self-test button on the test project", await T.eval("!!document.getElementById('odSelfTest')"));
      await T.eval("document.getElementById('odSelfTest').click(); true");
      await T.until("/Afterwards/.test((document.getElementById('odTest') || {}).innerText || '')", 30000);
      const steps = await T.eval("Array.from(document.querySelectorAll('#odTest .od-step')).map(s => s.innerText)");
      check("admin: eight steps, every one PASS", steps.length === 8 && steps.every((s) => /^PASS/.test(s)), steps.join(" | "));
      if (SHOTS !== "none") { await shoot(T, "selftest", "desktop", false); await shoot(T, "selftest", "desktop", true); }
      // never on another project
      await filesTab(T, J.sandbox);
      check("admin: no self-test on a real project", !(await T.eval("!!document.getElementById('odSelfTest')")));
    }, T);

    /* ── 5. no security-policy violation, no console error ─────────────── */
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
  console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results: failed, shots: shots.length, out: OUT }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
