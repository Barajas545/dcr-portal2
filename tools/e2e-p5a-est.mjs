#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the P5a estimates pages in the DEMO (development only).

     node tools/e2e-p5a-est.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with M5a's
   estimate_print / takeoff_print rules — tools/fake/p5a-est.js; nothing goes to Supabase) and drives a local
   Chrome or Edge headless, as the admin (prices), a manager (no prices: Q1), a manager with prices, the accountant
   (prices), a lead, a field person and a view-only person, on a phone (390 px) and a desk, light and dark:

   - project.html, tab Estimate: one card per estimate and change order in the office's order, the groups,
     the crew lines, the item flags; with prices the Labor / Material / Total columns and the contract strip,
     without prices not ONE amount on the page (typed ones arrive scrubbed) and "prices hidden"; the picker
     shows one estimate; "Show archived (1)"; a change made in the office arrives live;
   - tab Takeoffs: the fold-out takeoffs (the first with rows open), rows by level / category / sub-category,
     the unit price and line total with prices only, "Material list" for everybody, "Material quote" with prices;
   - report-estimate.html: the full copy (GRAND TOTAL, terms, signatures) with prices, the worksite copy for
     everybody else (no switch to undo it); a person with prices ticks "Hide prices" and the sheet is drawn
     again without money; one change order prints its contract figures - a one-item change order on ONE Letter page
     (Chrome's printToPDF with the page's own rules: the approval and the signature lines stay with the figures);
     the print preview (print media);
   - report-takeoff.html: the Material List (no price, typed amounts masked), the Material Quote with tax for
     people with prices only (?kind=quote prints the List for anybody else); its totals block never splits over
     two pages (break-inside: avoid);
   - search.html: an estimate item whose name quotes an amount is found by everybody, masked for people without
     prices, and opens the project's Estimate tab;
   - acceptance check 1 by figures: every amount the admin's pages show (Estimate tab, Takeoffs tab, printed
     estimate) is looked for in the HTML of the pages a person without prices gets, with or without a "$";
   - no horizontal scroll on a phone; no Content-Security-Policy violation and no console error anywhere.
   Screenshots (--shots all): est_<page>_<role>_<light|dark>_<desktop|phone>.png and est_printpreview_*.png into --out.
   Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p5a-est")));
const SHOTS = arg("--shots", "all");
const PID = 268;            // A267, the sandbox project
const DOLLARS = "/\\$\\s?\\d/";
const PRICES = { admin: true, manager: false, manager2: true, accountant: true, lead: false, field: false, viewer: false };
const ROLES = (arg("--roles", "admin,manager,manager2,accountant,lead,field,viewer")).split(",").filter(Boolean);
// an item name that quotes an amount (set through the demo's office edit, as DCR Desktop 2 would write it)
const AMOUNT_NAME = "Exterior walls 2x6 (credit asked $1,200)";

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
        try { where = " @ " + await page.eval("location.href + ' :: ' + (document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(0, 500) : '')"); }
        catch (x) { where = " @ (page not answering: " + x.message + ")"; }
      }
      check(name, false, String(e && e.message || e).slice(0, 400) + where);
    }
  };
  async function signIn(p, key) {
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
    await p.goto(base + "/index.html?next=dashboard.html", 150);
    await p.until("!!document.getElementById('loginForm') && !!window.DCR2Demo && !document.getElementById('loginFields').disabled", 8000);
    await p.eval("document.getElementById('email').value=" + JSON.stringify(key + "@demo.test") + ";document.getElementById('password').value='demo-password-1';" +
      "document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname)", 10000);
  }
  const text = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); return n ? n.innerText : ''; })()");
  const noScroll = (p) => p.eval("document.documentElement.scrollWidth <= innerWidth + 1");

  async function shoot(p, name, device, dark, opt) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1280;
    const o = opt || {};
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    if (o.print) await p.call("Emulation.setEmulatedMedia", { media: "print", features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
    await sleep(400);
    const base0 = device === "phone" ? 844 : 900;
    const h = o.full === false ? base0 : await p.eval("Math.max(" + base0 + ", Math.min(5200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(450);
    const file = "est_" + name + (o.print ? "" : "_" + (dark ? "dark" : "light") + "_" + device) + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: base0, deviceScaleFactor: 1, mobile: device === "phone" });
    if (o.print) await p.call("Emulation.setEmulatedMedia", { media: "" });
    await p.dark(false);
  }
  const estReady = "!!document.querySelector('#pane-estimate.active .es-card') || /No estimates/.test((document.getElementById('pane-estimate') || {}).innerText || '')";
  const tkReady = "!!document.querySelector('#pane-takeoffs.active .tk-card')";
  const sheetReady = "!!document.querySelector('#rpSheet .lh, #rpSheet .ml-top')";

  try {
    const a = await newPage(cdp, "setup", OUT); pages.push(a);
    await a.size(1280, 900, false);
    await a.goto(base + "/manifest.json", 50);
    await a.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");

    const FIGS = new Set();        // the amounts the admin's pages show ("12,345.67"), looked for in the no-prices pages
    const figsIn = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); const t = n ? n.innerText : ''; " +
      "return Array.from(t.matchAll(/\\$\\s?([0-9]{1,3}(?:,[0-9]{3})*\\.[0-9]{2})/g)).map(m => m[1]); })()");
    const leaked = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); const h = n ? n.innerHTML : ''; " +
      "return (window.__figs || []).filter(f => h.indexOf(f) !== -1); })()");
    const armFigs = (p) => p.eval("window.__figs = " + JSON.stringify(Array.from(FIGS)) + "; true");
    const keepFigs = (list) => (list || []).forEach((f) => { if (Number(f.replace(/,/g, "")) >= 10) FIGS.add(f); });
    for (const role of ROLES) {
      const key = role;
      const prices = PRICES[role];
      const d = await newPage(cdp, role + "-desk", OUT); pages.push(d);
      await d.size(1280, 900, false);
      await signIn(d, key);
      if (role === ROLES[0]) {
        await attempt("the office names an item with an amount in it (for search)", async () => {
          await d.goto(base + "/dashboard.html", 200);
          await d.until("!!window.DCR2Demo", 8000);
          await d.eval("DCR2Demo.remoteEdit('estimate_items', 2, { name: " + JSON.stringify(AMOUNT_NAME) + " }, 'manager_prices'); true");
        }, d);
      }

      /* ── the Estimate tab ───────────────────────────────────────────── */
      await attempt(role + ": Estimate tab", async () => {
        await d.goto(base + "/project.html?id=" + PID + "&tab=estimate", 300);
        await d.until(estReady, 15000);
        const st = await d.eval("(() => { const p = document.getElementById('pane-estimate'); return { cards: p.querySelectorAll('.es-card').length, " +
          "money: " + DOLLARS + ".test(p.innerText), strip: (p.querySelector('.es-contract') || {}).innerText || '', cols: p.querySelectorAll('th.num').length, " +
          "scrubbed: /\\[amount\\]/.test(p.innerText), flags: p.querySelectorAll('.es-flag').length, groups: Array.from(p.querySelector('.es-card').querySelectorAll('.pj-grp td')).map(t => t.innerText.trim()) }; })()");
        check(role + ": Estimate tab — four estimates and change orders (archived and deleted left out)", st.cards === 4, JSON.stringify(st));
        check(role + ": the office's group order", JSON.stringify(st.groups) === JSON.stringify(["Floor system 06.11.00", "Walls 06.11.00", "Roof 06.17.00", "(no group)"]), JSON.stringify(st.groups));
        if (prices) {
          check(role + ": with prices — Labor / Material / Total and the contract strip", st.money && st.cols >= 3 && /contract/i.test(st.strip) && /\$71,680\.58/.test(st.strip), st.strip);
          if (role === "admin") keepFigs(await figsIn(d, "#pane-estimate"));
        } else {
          check(role + ": without prices — not one amount on the page, the typed ones scrubbed, prices hidden", !st.money && st.cols === 0 && st.scrubbed && /Hidden/.test(st.strip), JSON.stringify(st));
          await armFigs(d);
          const lk = await leaked(d, "#pane-estimate");
          check(role + ": without prices — none of the admin's " + FIGS.size + " figures in the Estimate tab's HTML", (ROLES.includes("admin") ? FIGS.size > 20 : true) && lk.length === 0, lk.join(" ") || String(FIGS.size));
        }
        check(role + ": the item flags (blocked, important, complete)", st.flags >= 3, String(st.flags));
        // one estimate at a time, then the archived one
        await d.eval("(() => { const s = document.getElementById('esFilter'); s.value = s.options[3].value; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
        await sleep(300);
        const one = await d.eval("document.querySelectorAll('#pane-estimate .es-card').length + '|' + document.getElementById('esPrint').getAttribute('href')");
        check(role + ": the picker shows one change order and Print follows it", /^1\|report-estimate\.html\?id=268&est=\d+$/.test(one), one);
        await d.eval("(() => { const s = document.getElementById('esFilter'); s.value = '*'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
        await d.eval("document.getElementById('esArchived').click(); true");
        await d.until("document.querySelectorAll('#pane-estimate .es-card').length === 5", 8000);
        check(role + ": Show archived (1) adds the archived estimate", await d.eval("!!document.querySelector('#pane-estimate .es-archived')"));
        await d.eval("document.getElementById('esArchived').click(); true");
        await d.until("document.querySelectorAll('#pane-estimate .es-card').length === 4", 8000);
      }, d);
      if (role === "admin" || role === "manager" || role === "lead" || role === "field") {
        await shoot(d, "tab_" + role, "desktop", false);
        if (role === "admin") await shoot(d, "tab_" + role, "desktop", true);
      }

      /* live: the office changes an item (as the manager with prices, DCR Desktop 2's rules) */
      if (role === "admin" || role === "lead") {
        await attempt(role + ": a change made in the office lands live", async () => {
          const name = "Floor joists and subfloor (rev D, " + role + ")";
          await d.eval("DCR2Demo.remoteEdit('estimate_items', 1, { name: " + JSON.stringify(name) + " }, 'manager_prices'); true");
          await d.until("document.getElementById('pane-estimate').innerText.indexOf(" + JSON.stringify(name) + ") !== -1", 8000);
          check(role + ": the renamed item arrived without a reload", true);
        }, d);
      }

      /* ── the Takeoffs tab ───────────────────────────────────────────── */
      await attempt(role + ": Takeoffs tab", async () => {
        await d.eval("document.querySelector('.pj-tab[data-tab=takeoffs]').click(); true");
        await d.until(tkReady, 15000);
        const st = await d.eval("(() => { const p = document.getElementById('pane-takeoffs'); const open = p.querySelector('details[open]'); return { cards: p.querySelectorAll('.tk-card').length, " +
          "open: open ? open.querySelector('.es-name').innerText : '', money: " + DOLLARS + ".test(p.innerText), quote: !!p.querySelector('a[href*=\"kind=quote\"]'), " +
          "lvls: Array.from(p.querySelectorAll('details[open] .tk-lvl td')).map(t => t.innerText) }; })()");
        check(role + ": three takeoffs, the newest with rows open", st.cards === 3 && /Deck framing/.test(st.open), JSON.stringify(st));
        check(role + ": prices and the Material quote " + (prices ? "shown" : "never shown"), prices ? st.money && st.quote : !st.money && !st.quote, JSON.stringify(st));
        if (role === "admin") {
          await d.eval("document.querySelectorAll('#pane-takeoffs details').forEach(x => { x.open = true; }); true");
          await sleep(200);
          keepFigs(await figsIn(d, "#pane-takeoffs"));
        } else if (!prices) {
          await d.eval("document.querySelectorAll('#pane-takeoffs details').forEach(x => { x.open = true; }); true");
          await sleep(200);
          await armFigs(d);
          const lk = await leaked(d, "#pane-takeoffs");
          check(role + ": without prices — none of the admin's figures in the Takeoffs tab's HTML", lk.length === 0, lk.join(" "));
        }
        await d.eval("(() => { const m = Array.from(document.querySelectorAll('#pane-takeoffs details')).find(x => /Main house/.test(x.innerText)); m.open = true; return true; })()");
        await sleep(250);
        const lv = await d.eval("Array.from(document.querySelectorAll('#pane-takeoffs details[open] .tk-lvl td')).map(t => t.innerText).join('|')");
        check(role + ": rows by level, in the order their first row comes", /Main Level\|Second Level\|Roof\|\(no level\)/.test(lv), lv);
      }, d);
      if (role === "admin" || role === "lead") await shoot(d, "takeoffs_" + role, "desktop", false);

      /* ── the printed estimate ───────────────────────────────────────── */
      await attempt(role + ": printed estimate", async () => {
        await d.goto(base + "/report-estimate.html?id=" + PID, 300);
        await d.until(sheetReady, 15000);
        const st = await d.eval("(() => { const s = document.getElementById('rpSheet'); return { money: " + DOLLARS + ".test(s.innerText), grand: /GRAND TOTAL/.test(s.innerText), " +
          "tag: /WORKSITE COPY/.test(s.innerText), sw: !document.getElementById('rpNoPricesBox').hidden, terms: !!s.querySelector('.terms[contenteditable]') }; })()");
        if (prices) {
          check(role + ": the full copy — amounts, GRAND TOTAL, the editable terms, the worksite switch", st.money && st.grand && st.terms && st.sw && !st.tag, JSON.stringify(st));
          if (role === "admin") keepFigs(await figsIn(d, "#rpSheet"));
          if (role === "admin") await shoot(d, "print_estimate_" + role, "desktop", false);
          if (role === "admin") await shoot(d, "printpreview_estimate_" + role, "desktop", false, { print: true });
          await d.eval("document.getElementById('rpNoPrices').click(); true");
          await sleep(300);
          const w = await d.eval("(() => { const s = document.getElementById('rpSheet'); return { money: " + DOLLARS + ".test(s.innerText), tag: /WORKSITE COPY/.test(s.innerText), masked: /amount hidden/.test(s.innerText), html: " + DOLLARS + ".test(s.innerHTML) }; })()");
          check(role + ": 'Hide prices' draws the sheet again without money (not hidden by a style)", !w.money && !w.html && w.tag && w.masked, JSON.stringify(w));
          await d.eval("document.getElementById('rpNoPrices').click(); true");     // back to the full copy
          await sleep(200);
        } else {
          const html = await d.eval(DOLLARS + ".test(document.body.innerHTML)");
          check(role + ": the worksite copy — no amount anywhere in the page, no total, no switch to undo it", !st.money && !html && !st.grand && st.tag && !st.sw && !st.terms, JSON.stringify(st));
          await armFigs(d);
          const lk = await leaked(d, "body");
          check(role + ": the worksite copy — none of the admin's figures anywhere in the page's HTML", lk.length === 0, lk.join(" "));
          if (role === "manager") await shoot(d, "print_estimate_" + role, "desktop", false);
          if (role === "lead") await shoot(d, "printpreview_estimate_" + role, "desktop", false, { print: true });
        }
        const co = await d.eval("Array.from(document.querySelectorAll('#rpEst option')).find(o => /CO #1/.test(o.textContent)).value");
        await d.eval("(() => { const s = document.getElementById('rpEst'); s.value = " + JSON.stringify(co) + "; s.dispatchEvent(new Event('change')); return true; })()");
        await sleep(300);
        const c = await d.eval("(() => { const s = document.getElementById('rpSheet'); return { title: /CHANGE ORDER/.test(s.innerText), contract: /NEW CONTRACT TOTAL/.test(s.innerText), money: " + DOLLARS + ".test(s.innerText), url: location.search }; })()");
        check(role + ": one change order prints as a CHANGE ORDER" + (prices ? " with its contract figures" : " (worksite copy)"), c.title && (prices ? c.contract : !c.contract && !c.money) && /est=\d+/.test(c.url), JSON.stringify(c));
        if (role === "admin" || role === "lead") {
          await shoot(d, "print_co_" + role, "desktop", false);
        }
        if (prices && role === "admin") {
          // a one-item change order fits ONE Letter page (the review: its signature lines printed alone on page 2)
          const items = await d.eval("document.querySelectorAll('#rpSheet table.est tbody tr:not(.grp):not(.sub):not(.estb)').length");
          await d.eval("document.querySelectorAll('[class*=dcr2demo]').forEach(n => n.remove()); true");
          const pdf = await d.call("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, paperWidth: 8.5, paperHeight: 11 });
          const raw = Buffer.from(pdf.data, "base64").toString("latin1");
          const pagesN = (raw.match(/\/Type\s*\/Page(?![a-z])/g) || []).length;
          const keep = await d.eval("(() => { const g = document.querySelector('#rpSheet .co-sign'); return g ? getComputedStyle(g).breakInside + ' ' + g.querySelectorAll('.sig').length : 'none'; })()");
          check(role + ": a one-item change order prints on ONE Letter page, its approval and three signature lines together", items === 1 && pagesN === 1 && keep === "avoid 3",
            JSON.stringify({ items, pagesN, keep }));
        }
      }, d);

      /* ── the printed takeoff ────────────────────────────────────────── */
      await attempt(role + ": printed takeoff", async () => {
        await d.goto(base + "/report-takeoff.html?id=" + PID + "&tk=1&kind=quote", 300);
        await d.until(sheetReady, 15000);
        const st = await d.eval("(() => { const s = document.getElementById('rpSheet'); return { head: s.querySelector('.ml-h1').innerText, money: " + DOLLARS + ".test(s.innerHTML), " +
          "grand: /GRAND TOTAL/.test(s.innerText), tax: /Sales tax \\(8%\\)/.test(s.innerText), lines: s.querySelectorAll('td.c-ln').length, sw: !document.getElementById('rpQuoteBox').hidden }; })()");
        if (prices) check(role + ": ?kind=quote — the Material Quote with sales tax and GRAND TOTAL", st.head === "Material Quote" && st.money && st.grand && st.tax && st.lines === 10 && st.sw, JSON.stringify(st));
        else check(role + ": ?kind=quote prints the Material List — no price, no switch", st.head === "Material List" && !st.money && !st.grand && st.lines === 10 && !st.sw, JSON.stringify(st));
        if (role === "admin") { await shoot(d, "print_takeoff_" + role, "desktop", false); await shoot(d, "printpreview_takeoff_" + role, "desktop", false, { print: true }); }
        if (prices) {
          const bi = await d.eval("(() => { const t = document.querySelector('#rpSheet table.tot'); return t ? getComputedStyle(t).breakInside : 'none'; })()");
          check(role + ": the Material Quote's totals (Subtotal, Sales tax, GRAND TOTAL) never split over two pages", bi === "avoid", bi);
        }
        if (prices) {
          await d.eval("document.getElementById('rpQuote').click(); true");
          await sleep(300);
          const l = await d.eval("(() => { const s = document.getElementById('rpSheet'); return { head: s.querySelector('.ml-h1').innerText, money: " + DOLLARS + ".test(s.innerHTML), masked: /amount hidden/.test(s.innerText) }; })()");
          check(role + ": the Material List never prices, typed amounts masked even for the office", l.head === "Material List" && !l.money && l.masked, JSON.stringify(l));
        }
      }, d);

      /* ── search (acceptance check 1): an item whose name quotes an amount ── */
      await attempt(role + ": search", async () => {
        await d.goto(base + "/search.html?q=" + encodeURIComponent("credit asked"), 300);
        await d.until("!!document.querySelector('#seResults .se-grp') || /No results/.test(document.getElementById('seResults').innerText)", 10000);
        const st = await d.eval("(() => { const r = document.getElementById('seResults'); const g = Array.from(r.querySelectorAll('.se-grp')).find(x => /Estimate items/i.test(x.innerText)); " +
          "const a = g ? g.querySelector('a[href]') : null; return { found: !!g, text: g ? g.innerText.replace(/\\s+/g, ' ') : r.innerText.slice(0, 200), href: a ? a.getAttribute('href') : '', " +
          "money: " + DOLLARS + ".test(r.innerHTML) }; })()");
        if (prices) check(role + ": search — the estimate item, as typed", st.found && /\$1,200/.test(st.text) && /tab=estimate/.test(st.href), JSON.stringify(st));
        else check(role + ": search — the estimate item, its amount masked (no amount in the HTML), opens the Estimate tab",
          st.found && /amount hidden/.test(st.text) && !st.money && /^project\.html\?id=268&tab=estimate$/.test(st.href), JSON.stringify(st));
        if (role === "lead" || role === "admin") await shoot(d, "search_" + role, "desktop", false, { full: false });
      }, d);

      /* ── a phone ────────────────────────────────────────────────────── */
      if (role === "admin" || role === "manager" || role === "lead" || role === "field") {
        const m = await newPage(cdp, role + "-phone", OUT); pages.push(m);
        await m.size(390, 844, true);
        await signIn(m, key);
        await attempt(role + ": phone", async () => {
          await m.goto(base + "/project.html?id=" + PID + "&tab=estimate", 300);
          await m.until(estReady, 15000);
          check(role + ": phone — the Estimate tab has no horizontal scroll", await noScroll(m), await m.eval("document.documentElement.scrollWidth"));
          await shoot(m, "tab_" + role, "phone", true);
          if (role === "admin" || role === "field") await shoot(m, "tab_" + role, "phone", false);
          await m.eval("document.querySelector('.pj-tab[data-tab=takeoffs]').click(); true");
          await m.until(tkReady, 15000);
          check(role + ": phone — the Takeoffs tab has no horizontal scroll", await noScroll(m), await m.eval("document.documentElement.scrollWidth"));
          if (role === "field") await shoot(m, "takeoffs_" + role, "phone", false);
          await m.goto(base + "/report-estimate.html?id=" + PID, 300);
          await m.until(sheetReady, 15000);
          check(role + ": phone — the printed estimate has no horizontal scroll", await noScroll(m), await m.eval("document.documentElement.scrollWidth"));
          if (role === "lead") await shoot(m, "print_estimate_" + role, "phone", false);
          if (role === "admin") await shoot(m, "print_estimate_" + role, "phone", true);
          await m.goto(base + "/report-takeoff.html?id=" + PID + "&tk=1", 300);
          await m.until(sheetReady, 15000);
          check(role + ": phone — the material list has no horizontal scroll", await noScroll(m), await m.eval("document.documentElement.scrollWidth"));
          if (role === "field") await shoot(m, "print_takeoff_" + role, "phone", false);
        }, m);
      }
    }
  } finally {
    const all = pages.flatMap((p) => p.log.map((e) => Object.assign({ page: p.name }, e)));
    const csp = all.filter((e) => /CSP-VIOLATION|Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(e.text));
    const errors = all.filter((e) => e.level === "exception" ||
      (e.level === "error" && !/CSP-VIOLATION/.test(e.text) && !/favicon\.ico|net::ERR_ABORTED/.test(e.text + " " + (e.url || ""))));
    results.push({ name: "no Content-Security-Policy violation on any page", ok: csp.length === 0, detail: csp.slice(0, 10) });
    results.push({ name: "no console error on any page", ok: errors.length === 0, detail: errors.slice(0, 10) });
    const failed = results.filter((x) => !x.ok);
    // the same summary as the other walks (tools/e2e-demo.mjs --p5est reads it)
    console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results, shots: shots.length,
      screenshots: shots, out: OUT }, null, 2));
    try { await cdp.send("Browser.close"); } catch (e) { /* */ }
    try { proc.kill(); } catch (e) { /* */ }
    server.close();
    process.exitCode = failed.length ? 1 : 0;
  }
}

main().catch((e) => { console.error(e); process.exit(2); });
