#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of P5c's subcontractor form and its review in the DEMO (development only).

     node tools/e2e-p5c-sub.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with M5c's sub_submissions rules
   and the public "subform" function's stand-in - tools/fake/p5c-sub.js; nothing goes to Supabase) and drives a local
   Chrome or Edge headless:

   - the PUBLIC form (submit.html) on a phone, signed out, in a browser that never signed in: no sign-in page, no top
     bar; a search of fewer than 3 characters asks nothing; a job is found by its number (open jobs only - a closed one is
     not offered; the five public fields, never the client); every problem at once; the honeypot refused in the generic
     words with nothing stored; the amount limits; then a real submission: the drawn signature, the paperwork (one signed
     upload under f/{job}/receipts/), "attached", the reference on screen - and in the database a PENDING submission
     (never a bill) whose notices to the office carry no amount;
   - every staff role on the review page (submissions.html) and the home page's card: the money editors (admin,
     accountant, a manager with financials - the demo approver) see the queue and the card; a manager without financials,
     a lead, a field account and a view-only account are refused before anything is read and see no card;
   - the review (P5 acceptance check 4): the e-mail's link (?ref=) opens the submission; the accountant accepts the
     invoice - a bill that is NOT approved, with the paperwork as its document (the bill page says "awaiting approval");
     a second accept from a page opened before is "already done"; an invoice without its paperwork cannot be accepted;
     a reject with a note; the change order accepted onto the job;
   - P5 acceptance check 5: no activity row and no outbox body written during the walk carries an amount;
   - phone (390 px: the pages never scroll sideways) and desktop, light and dark; no Content-Security-Policy
     violation and no console error on any page.
   Screenshots (--shots all): sub_<what>_<light|dark>_<desktop|phone>.png into --out.
   Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p5c-sub")));
const SHOTS = arg("--shots", "all");
const AMOUNT = /\$\s?\d|\b\d{1,3}(,\d{3})+(\.\d{2})?\b|\b\d+\.\d{2}\b/;
const REVIEWERS = { admin: true, accountant: true, approver: true };

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
  const db = (p, expr) => p.eval("(() => { const R = DCR2Demo.engine.rows; return " + expr + "; })()");
  const modalOpen = "!!document.querySelector('.dcr-mo.open')";
  const modalOk = (p) => p.eval("(() => { const b = document.getElementById('dcrMoYes'); if (b) b.click(); return !!b; })()");
  const sideways = (p) => p.eval("document.documentElement.scrollWidth - window.innerWidth");

  async function shoot(p, name, device, dark, full) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1440;
    const base0 = device === "phone" ? 844 : 900;
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: base0, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(500);
    const h = full === false ? base0 : await p.eval("Math.max(" + base0 + ", Math.min(5200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(450);
    const file = "sub_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: base0, deviceScaleFactor: 1, mobile: device === "phone" });
    await p.dark(false);
  }

  /* the public form's own fields, typed as a person would (values only; the page's script reads them on Submit) */
  const fill = (p, f) => p.eval("(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; " +
    Object.entries(f).map(([k, v]) => "set(" + JSON.stringify(k) + ", " + JSON.stringify(v) + ");").join(" ") + " return true; })()");
  /* a signature drawn with pointer events across the pad */
  const sign = (p) => p.eval(`(() => {
    const cv = document.getElementById('sfSig'); const r = cv.getBoundingClientRect();
    const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true,
      clientX: r.left + x * r.width, clientY: r.top + y * r.height }));
    ev('pointerdown', 0.08, 0.6);
    for (let i = 1; i <= 40; i++) ev('pointermove', 0.08 + i * 0.018, 0.6 - Math.sin(i / 3) * 0.18);
    ev('pointerup', 0.8, 0.55);
    return document.getElementById('sfSigState').textContent; })()`);
  /* a file chosen in the file picker */
  const attach = (p, name, type, size) => p.eval(`(() => {
    const input = document.getElementById('sfFile'); const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(${size}).fill(37)], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    return document.getElementById('sfDocName').textContent; })()`);
  const msg = (p) => p.eval("document.getElementById('sfMsg').textContent");

  let J = null, A = null;
  try {
    /* ── 0. a clean demo database; what the walk will look for ──────────── */
    A = await newPage(cdp, "setup", OUT); pages.push(A);
    await A.size(1440, 900, false);
    await A.goto(base + "/manifest.json", 50);
    await A.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");
    await signIn(A, "admin", "dashboard.html");
    J = await db(A, `(() => {
      const open = R.projects.filter((p) => !p.deleted_at && !p.completed_date && p.status === "in_progress" && p.number !== "A267").sort((a, b) => b.id - a.id)[0];
      const shut = R.projects.find((p) => !p.deleted_at && (p.status === "closed" || p.status === "completed"));
      return { open: { id: open.id, number: open.number, client: open.client_name, name: open.name }, shut: { id: shut.id, number: shut.number },
        subs: R.sub_submissions.length, bills: R.bills.length, maxAct: R.activity.reduce((m, x) => Math.max(m, x.id), 0), outbox: R.notifications_outbox.length };
    })()`);
    check("demo: the made-up submissions (tools/fake/p5c-sub.js): three waiting, one rejected",
      J.subs === 4 && (await db(A, "R.sub_submissions.filter(s => s.state === 'pending').length")) === 3, JSON.stringify(J));

    /* ── 1. the public form, signed out, on a phone ────────────────────── */
    const P = await newPage(cdp, "public", OUT); pages.push(P);
    await attempt("the public form: no sign-in, the search, the refusals, a real submission with its paperwork", async () => {
      await P.size(390, 844, true);
      await P.goto(base + "/submit.html", 600);
      await P.until("!!document.getElementById('sfForm') && !!window.DCR2Demo", 8000);
      const where = await P.eval("({ path: location.pathname, bar: !!document.querySelector('.dcr2-topbar'), auth: Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter(k => k.indexOf('dcr2-auth') === 0) })");
      check("public form: opens with no sign-in (no bounce, no top bar, no session kept)", where.path === "/submit.html" && !where.bar && where.auth.length === 0, JSON.stringify(where));
      check("public form: never scrolls sideways on a phone", (await sideways(P)) <= 0, String(await sideways(P)));
      if (SHOTS !== "none") { await shoot(P, "form", "phone", false, true); await shoot(P, "form", "phone", true, true); await P.size(390, 844, true); }
      // fewer than 3 characters: nothing asked
      await fill(P, { sfSearch: J.open.number.slice(0, 2) });
      await sleep(600);
      check("search: fewer than 3 characters shows and asks nothing", await P.eval("document.getElementById('sfHits').hidden"));
      // a closed job is not offered
      await fill(P, { sfSearch: J.shut.number });
      await P.until("!document.getElementById('sfHits').hidden", 5000);
      check("search: a closed or completed job is not offered", /No open job matches/.test(await P.eval("document.getElementById('sfHits').textContent")));
      // the open job, by its number: the public fields only
      await fill(P, { sfSearch: J.open.number });
      await P.until("document.querySelectorAll('#sfHits .hit').length > 0", 5000);
      const hits = await P.eval("({ text: document.getElementById('sfHits').innerText, n: document.querySelectorAll('#sfHits .hit').length })");
      check("search: the job by its number - number, name, street and town; never the client", hits.n === 1 && hits.text.includes(J.open.number) &&
        !hits.text.includes(J.open.client), JSON.stringify(hits));
      if (SHOTS !== "none") { await shoot(P, "search", "phone", false, false); await P.size(390, 844, true); }
      await P.eval("document.querySelector('#sfHits .hit').click(); true");
      check("search: picking it shows the job chosen", (await P.eval("document.getElementById('sfPickedText').textContent")).includes(J.open.number));
      // every problem at once (the function's words)
      await sign(P);
      await attach(P, "invoice-1042.pdf", "application/pdf", 48000);
      await P.eval("document.getElementById('sfGo').click(); true");
      await P.until("/Enter your company name/.test(document.getElementById('sfMsg').textContent)", 5000);
      const all = await msg(P);
      check("submit: every problem at once (company, name, e-mail, amount, description, typed name, declaration)",
        ["company", "your name", "email", "amount", "Describe", "full name", "declaration"].every((w) => all.toLowerCase().includes(w.toLowerCase())), all);
      // the shot shows the list of problems under Submit (where the finger is), not the top of the form
      if (SHOTS !== "none") {
        await P.eval("document.getElementById('sfMsg').scrollIntoView({ block: 'end' }); true");
        await shoot(P, "errors", "phone", false, false);
        await P.size(390, 844, true);
      }
      // the honeypot: the generic refusal, nothing stored
      const good = { sfCompany: "Juniper Glass", sfContact: "Jun Iper", sfEmail: "jun@juniper-glass.example", sfPhone: "(805) 555-0190", sfAmount: "1,375.50",
        sfNumber: "G-12", sfDesc: "Shower glass, first fitting at the main bath.", sfSigName: "Jun Iper" };
      await fill(P, Object.assign({}, good, { sfWebsite: "http://spam.example" }));
      await P.eval("document.getElementById('sfAgree').checked = true; document.getElementById('sfGo').click(); true");
      await P.until("/could not be accepted/.test(document.getElementById('sfMsg').textContent)", 5000);
      check("submit: a filled honeypot gets the generic refusal - nothing stored", (await msg(P)).trim() === "That submission could not be accepted." &&
        (await db(A, "R.sub_submissions.length")) === J.subs);
      // the amount limits
      await fill(P, Object.assign({}, good, { sfWebsite: "", sfAmount: "5000000.01" }));
      await P.eval("document.getElementById('sfGo').click(); true");
      await P.until("/up to 5,000,000/.test(document.getElementById('sfMsg').textContent)", 5000);
      check("submit: an amount over 5,000,000 is refused", true);
      // the real one
      await fill(P, good);
      await P.eval("document.getElementById('sfGo').click(); true");
      await P.until("!document.getElementById('sfDone').hidden", 10000);
      const done = await P.eval("({ ref: (document.getElementById('sfRef') || {}).textContent, text: document.getElementById('sfDone').innerText })");
      check("submit: the reference on screen and the paperwork received", /^SUB-[23456789CDFGHJKMNPQRTVWXY]{4}-[23456789CDFGHJKMNPQRTVWXY]{4}$/.test(done.ref || "") &&
        /document was received/.test(done.text), JSON.stringify(done));
      J.ref = done.ref;
      const s = await db(A, "(() => { const s = R.sub_submissions.find(x => x.reference === " + JSON.stringify(done.ref) + "); return s && { state: s.state, kind: s.kind, amount: s.amount, project: s.project_id, attached: !!s.document_attached_at, doc: s.document_path, sig: s.signature_path, size: s.document_size, mime: s.document_mime }; })()");
      check("in the database: a PENDING submission on that job with its paperwork attached under f/" + J.open.id + "/receipts/ (never a bill)",
        s && s.state === "pending" && s.kind === "invoice" && s.amount === 1375.5 && s.project === J.open.id && s.attached && s.size === 48000 && s.mime === "application/pdf" &&
        new RegExp("^f/" + J.open.id + "/receipts/[0-9a-f]{32}/SUB INVOICE " + done.ref + "\\.pdf$").test(s.doc) &&
        new RegExp("^f/" + J.open.id + "/receipts/[0-9a-f]{32}/SUB INVOICE " + done.ref + " signature\\.png$").test(s.sig) &&
        (await db(A, "R.bills.length")) === J.bills, JSON.stringify(s));
      // one waiting e-mail per reviewer: a new one, or this submission folded into the one still waiting for them (the demo
      // has one waiting for the admin and the accountant)
      const notes = await db(A, "(() => { const s = R.sub_submissions.find(x => x.reference === " + JSON.stringify(done.ref) + "); return R.notifications_outbox" +
        ".filter(o => (o.submission_ids || [o.submission_id]).indexOf(s.id) !== -1).map(o => ({ kind: o.kind, to: o.to_email, text: o.subject + ' ' + o.body, n: (o.submission_ids || []).length })); })()");
      check("the office is told by e-mail (admins, accountants with financials, approvers; through DCR Agents 2) - one waiting e-mail each (this one folded into a waiting one), no amount, no description, the sender as typed and NOT VERIFIED",
        notes.length >= 3 && notes.every((n) => n.kind === "sub_submission" && !AMOUNT.test(n.text) && !/Shower glass/.test(n.text) && n.text.includes(done.ref) && /not verified/.test(n.text)) &&
        notes.some((n) => n.to === "accountant@demo.test") && notes.some((n) => n.to === "approver@demo.test") && !notes.some((n) => /manager@|lead@|field@|viewer@/.test(n.to)) &&
        notes.some((n) => n.n > 1) && new Set(notes.map((n) => n.to)).size === notes.length,
        JSON.stringify(notes.map((n) => [n.to, n.n])));
      if (SHOTS !== "none") { await shoot(P, "done", "phone", false, false); await shoot(P, "done", "phone", true, false); await shoot(P, "done", "desktop", false, false); }
    }, P);

    /* ── 2. every staff role: the card and the review page ─────────────── */
    for (const role of ["admin", "accountant", "approver", "manager", "lead", "field", "viewer"]) {
      const p = await newPage(cdp, "role-" + role, OUT); pages.push(p);
      await attempt(role + ": the home page's card and the review page", async () => {
        await p.size(1440, 900, false);
        await signIn(p, role, "dashboard.html");
        await p.until("!!document.querySelector('.hm-card')", 8000);
        const card = await p.eval("!!document.getElementById('hmSubs')");
        check(role + ": the Sub submissions card " + (REVIEWERS[role] ? "is there" : "is not there"), card === !!REVIEWERS[role]);
        if (REVIEWERS[role]) {
          await p.until("!!document.querySelector('#hmSubs .hm-badge')", 6000).catch(() => null);
          const badge = await p.eval("(document.querySelector('#hmSubs .hm-badge') || {}).textContent || ''");
          check(role + ": its badge says how many wait", /^4 waiting$/.test(badge), badge);
        }
        await p.goto(base + "/submissions.html", 400);
        if (REVIEWERS[role]) {
          await p.until("document.querySelectorAll('.sb-card').length > 0", 8000);
          const v = await p.eval("({ n: document.querySelectorAll('.sb-card').length, count: document.getElementById('sbCount').textContent, amounts: /\\$4,250\\.00/.test(document.body.innerText) })");
          check(role + ": the queue (4 waiting, the amounts)", v.n === 4 && v.count === "4 waiting" && v.amounts, JSON.stringify(v));
        } else {
          await p.until("/dashboard\\.html/.test(location.pathname) || !!document.querySelector('.dcr-mo.open')", 8000);
          if (await p.eval(modalOpen)) { await modalOk(p); await p.until("/dashboard\\.html/.test(location.pathname)", 6000); }
          check(role + ": refused and sent home", /dashboard\.html/.test(await p.eval("location.pathname")));
        }
      }, p);
    }

    /* ── 3. the review: the e-mail's link, accept, already done, reject, the change order ── */
    const ac = await newPage(cdp, "accountant-review", OUT); pages.push(ac);
    const stale = await newPage(cdp, "admin-stale", OUT); pages.push(stale);
    await attempt("the review (acceptance check 4): accept is not approve; a second accept is already done; no paperwork, no accept; reject; the change order", async () => {
      await ac.size(1440, 900, false);
      await signIn(ac, "accountant", "submissions.html?ref=" + J.ref);
      await ac.until("!!document.querySelector('.sb-card.focus')", 8000);
      const top = await ac.eval("document.querySelector('.sb-card').id");
      check("the e-mail's link (?ref=) shows that submission first", top === "sub-" + J.ref, top);
      // the stale page: the admin opens the queue before the accountant acts
      await stale.size(1440, 900, false);
      await signIn(stale, "admin", "submissions.html");
      await stale.until("!!document.querySelector('.sb-card [data-accept]')", 8000);
      if (SHOTS !== "none") { await shoot(ac, "queue", "desktop", false, true); await shoot(ac, "queue", "desktop", true, true); await shoot(ac, "queue", "phone", false, true); await shoot(ac, "queue", "phone", true, true); }
      await ac.size(390, 844, true); await sleep(300);
      check("the review page never scrolls sideways on a phone", (await sideways(ac)) <= 0, String(await sideways(ac)));
      await ac.size(1440, 900, false); await sleep(300);
      // the invoice without its paperwork cannot be accepted
      const noDoc = await ac.eval("(() => { const c = document.getElementById('sub-SUB-C9TX-2PWF'); return { disabled: c.querySelector('[data-accept]').disabled, why: (c.querySelector('.sb-warn') || {}).textContent || '' }; })()");
      check("an invoice without its paperwork cannot be accepted, and the page says why", noDoc.disabled && /No document is attached/.test(noDoc.why), JSON.stringify(noDoc));
      // the old page's "Nobody was emailed about this": what became of each waiting submission's e-mail (sub_submission_notices)
      const told = await ac.eval("(() => { const t = (id) => { const c = document.getElementById(id); const n = c && c.querySelector('.sb-notice'); return n ? { warn: n.classList.contains('sb-warn'), text: n.textContent } : null; };" +
        " return { failed: t('sub-SUB-C9TX-2PWF'), waiting: t('sub-SUB-RM6G-8JKV'), sent: t('sub-SUB-7KQ4-HM3D') }; })()");
      check("the queue says what became of each waiting submission's e-mail: a failed one warns 'Nobody was e-mailed about this' (as the old page did), one still waiting after a while says so quietly, a sent one says nothing",
        told.failed && told.failed.warn && /Nobody was e-mailed about this: the e-mail could not be sent/.test(told.failed.text) &&
        told.waiting && !told.waiting.warn && /has not gone out yet/.test(told.waiting.text) && told.sent === null, JSON.stringify(told));
      // accept the new invoice
      const sid = await db(ac, "R.sub_submissions.find(s => s.reference === " + JSON.stringify(J.ref) + ").id");
      await ac.eval("document.querySelector('#sub-" + J.ref + " [data-accept]').click(); true");
      await ac.until(modalOpen, 5000);
      if (SHOTS !== "none") await shoot(ac, "accept_confirm", "desktop", false, false);
      await modalOk(ac);
      await ac.until("DCR2Demo.engine.rows.sub_submissions.find(s => s.id === " + sid + ").state === 'accepted'", 8000);
      const b = await db(ac, "(() => { const s = R.sub_submissions.find(x => x.id === " + sid + "); const b = R.bills.find(x => x.id === s.bill_id); const f = b && R.files.find(x => x.id === b.document_file_id); return b && { amount: b.amount, approved: b.approved_at, kind: b.kind, doc: f && f.storage_path, sdoc: s.document_path, by: s.reviewed_by }; })()");
      check("accepted: a bill that is NOT approved, its document the uploaded paperwork", b && b.amount === 1375.5 && b.approved === null && b.kind === "Subcontractor" && b.doc === b.sdoc, JSON.stringify(b));
      // the stale page's accept: already done
      await stale.until("DCR2Demo.engine.rows.sub_submissions.find(s => s.id === " + sid + ").state === 'accepted'", 8000);
      await stale.eval("document.querySelector('#sub-" + J.ref + " [data-accept]').click(); true");
      await stale.until(modalOpen, 5000);
      await modalOk(stale);
      await stale.until("/Already done/.test(document.body.innerText)", 6000);
      const bills = await db(stale, "R.bills.filter(b => String(b.description || '').includes(" + JSON.stringify(J.ref) + ")).length");
      check("a second accept (a page opened before) says 'already done' and files nothing more", bills === 1, String(bills));
      // the bill page: awaiting approval
      await ac.eval("document.getElementById('sbTab-accepted').click(); true");
      await ac.until("!!document.querySelector('#sub-" + J.ref + " .sb-done a')", 6000);
      if (SHOTS !== "none") await shoot(ac, "accepted", "desktop", false, true);
      await ac.eval("document.querySelector('#sub-" + J.ref + " .sb-done a').click(); true");
      await ac.until("/bill\\.html/.test(location.pathname) && !!document.getElementById('blState')", 8000);
      check("the bill page: AWAITING APPROVAL (accepting is not approving)", (await ac.eval("document.getElementById('blState').textContent")) === "AWAITING APPROVAL");
      // reject the invoice without paperwork, with a note
      await ac.goto(base + "/submissions.html", 400);
      await ac.until("!!document.getElementById('sub-SUB-C9TX-2PWF')", 8000);
      await ac.eval("document.querySelector('#sub-SUB-C9TX-2PWF [data-reject]').click(); true");
      await ac.until(modalOpen, 5000);
      await ac.eval("document.getElementById('dcrMoF0').value = 'Sent to the wrong company'; true");
      if (SHOTS !== "none") await shoot(ac, "reject", "phone", false, false);
      await ac.size(1440, 900, false);
      await modalOk(ac);
      await ac.until("(DCR2Demo.engine.rows.sub_submissions.find(s => s.reference === 'SUB-C9TX-2PWF') || {}).state === 'rejected'", 8000);
      check("rejected with its note", (await db(ac, "R.sub_submissions.find(s => s.reference === 'SUB-C9TX-2PWF').review_note")) === "Sent to the wrong company");
      // the change order onto the job
      await ac.until("!!document.querySelector('#sub-SUB-RM6G-8JKV [data-accept]')", 6000);
      await ac.eval("document.querySelector('#sub-SUB-RM6G-8JKV [data-accept]').click(); true");
      await ac.until(modalOpen, 5000);
      await modalOk(ac);
      await ac.until("(DCR2Demo.engine.rows.sub_submissions.find(s => s.reference === 'SUB-RM6G-8JKV') || {}).state === 'accepted'", 8000);
      const q = await db(ac, "(() => { const s = R.sub_submissions.find(x => x.reference === 'SUB-RM6G-8JKV'); const q = R.quotes.find(x => x.id === s.quote_id); const pr = R.quote_prices.find(x => x.quote_id === s.quote_id); return q && { kind: q.kind, status: q.status, amount: pr && pr.amount }; })()");
      check("the change order is the job's own change order (awarded, its amount under prices)", q && q.kind === "change_order" && q.status === "awarded" && q.amount === 860, JSON.stringify(q));
      await ac.eval("document.getElementById('sbTab-rejected').click(); true");
      await sleep(400);
      if (SHOTS !== "none") { await shoot(ac, "rejected", "desktop", false, true); await shoot(ac, "rejected", "phone", true, true); }
    }, ac);

    /* ── 4. acceptance check 5: no amount in an activity row or an outbox body ── */
    await attempt("no amount in any activity row or outbox body written during the walk", async () => {
      const rows = await db(A, "R.activity.filter(x => x.id > " + J.maxAct + ").map(x => x.text).concat(R.notifications_outbox.slice(" + J.outbox + ").map(o => (o.subject || '') + ' ' + (o.body || '')))");
      const bad = rows.filter((t) => AMOUNT.test(t));
      check("acceptance check 5: no activity row and no outbox body carries an amount (" + rows.length + " written)", bad.length === 0, bad.slice(0, 5).join(" | "));
    }, A);

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
  console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results, shots: shots.length, out: OUT }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
