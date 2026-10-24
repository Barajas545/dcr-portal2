#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of P5c's sales estimating in the DEMO (development only).

     node tools/e2e-p5c-sales.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with M5c's sales rules —
   tools/fake/p5c-sales.js; nothing goes to Supabase) and drives a local Chrome or Edge headless through Sales Estimates
   (estimates.html), the deck wizard (estimate-deck.html), the Materials Library (materials-library.html) and the drawing
   tool (cme.html, the Construction Modeling Engine, in its overlay):

   - who (Q10): Morgan Manager, the lead, field and view-only have no Sales estimates switch — every sales page says so,
     asks for nothing and shows no amount (the drawing tool too); the accountant holds the switch without being a sales
     editor — reads everything with its amounts, writes nothing (no New, no Delete, the comps and the library open read
     only, an estimate opens read only); Sasha Seller (a manager with the switch, no prices) edits but never sees or
     sends an amount — the comps' prices, the benchmarks and ranges, the rates — and a typed amount in a note is masked
     and read only; the admin does everything;
   - the admin's deck estimate from scratch: step 1 with a photo dropped in (sales-media, a signed URL; the draft row
     auto-saved), the photo marked up (an arrow), a NEW drawing in CME (its PNG at estimates/<ref>/cme/cme-<id>.png, the
     gallery entry under "cme" and never "cad"), the drawing opened again and saved again (one drawing, one file,
     replaced in place), step 2's reference and "show client", step 3's primary line, a comparison and the product viewer,
     step 4's rates and a crew task, step 5's benchmark and comparable range, saved (the money only in
     sales_estimate_prices), the print view;
   - a save that meets someone else's newer save is refused (409) and said, never written over;
   - Sasha reopens her draft: the notes' "$9,500" masked and read only, no money step, saved without touching the
     estimate's prices; she adds a past project without a price (its price row stays empty);
   - the Materials Library: a new line with a photo and a color (admin), the accountant reads it only;
   - P5 check 5: no activity line and no outbox row from anything here;
   - phone (390 px: no page scrolls sideways) and desktop, light and dark; no Content-Security-Policy violation and no
     console error on any page, the drawing tool's frame included.
   Screenshots (--shots all): sales_<what>_<role>_<light|dark>_<desktop|phone>.png into --out.
   Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p5c-sales")));
const SHOTS = arg("--shots", "all");
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
  const click = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); if (!n) throw new Error('no ' + " + JSON.stringify(sel) + "); n.click(); return true; })()");
  const setVal = (p, id, value, ev) => p.eval("(() => { const i = document.getElementById(" + JSON.stringify(id) + "); i.focus(); i.value = " + JSON.stringify(value) +
    "; i.dispatchEvent(new Event(" + JSON.stringify(ev || "input") + ", { bubbles: true })); return true; })()");
  const noSideways = (p) => p.eval("({ page: document.documentElement.scrollWidth, win: innerWidth })");
  // a made-up photo, dropped on a gallery (the drop path of js/sales/gallery.js)
  const dropPhoto = (p, sel, name, hue) => p.eval(`(async () => {
    const c = document.createElement('canvas'); c.width = 960; c.height = 640;
    const x = c.getContext('2d'); x.fillStyle = 'hsl(${hue || 30}, 45%, 55%)'; x.fillRect(0, 0, 960, 640);
    x.fillStyle = '#fff'; x.fillRect(120, 380, 720, 60); x.fillStyle = '#333'; x.font = '48px Arial'; x.fillText(${JSON.stringify(name)}, 140, 300);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const dt = new DataTransfer(); dt.items.add(new File([blob], ${JSON.stringify(name)}, { type: 'image/jpeg' }));
    document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return true; })()`);

  async function shoot(p, name, device, dark, full) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1440;
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    await sleep(350);
    const h = full === false ? (device === "phone" ? 844 : 900) : await p.eval("Math.max(" + (device === "phone" ? 844 : 900) + ", Math.min(4200, document.documentElement.scrollHeight))");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(500);
    const file = "sales_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: device === "phone" ? 844 : 900, deviceScaleFactor: 1, mobile: device === "phone" });
    await p.dark(false);
  }
  async function bothThemes(p, name, device, full) { await shoot(p, name, device, false, full); await shoot(p, name, device, true, full); }

  const HUB = "!document.getElementById('seMain').hidden && document.querySelectorAll('#seList tr.row').length > 0 && document.querySelectorAll('#refList tr.row').length > 0";
  const LIB = "document.querySelectorAll('.ml-card').length > 0";

  try {
    /* ── 0. a clean demo database ──────────────────────────────────────── */
    const setup = await newPage(cdp, "setup", OUT); pages.push(setup);
    await setup.size(1440, 900, false);
    await setup.goto(base + "/manifest.json", 50);
    await setup.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");
    await signIn(setup, "admin", "dashboard.html");
    const J = await db(setup, `({
      refs: R.sales_reference_projects.length, ests: R.sales_estimates.length, mats: R.sales_materials.length,
      draft: (R.sales_estimates.find((e) => e.estimate_ref === 'EST-DEMO2') || {}).id,
      sent: (R.sales_estimates.find((e) => e.estimate_ref === 'EST-DEMO1') || {}).id,
      sales: !!R.profiles.find((p) => p.email === 'sales@demo.test' && p.can_sales_estimates && !p.can_see_prices),
      acts: R.activity.length, outbox: (R.notifications_outbox || []).length })`);
    check("demo: made-up comps, saved estimates, a materials library and Sasha Seller (the switch, no prices) — tools/fake/p5c-sales.js",
      J.refs >= 6 && J.ests >= 3 && J.mats >= 10 && J.draft && J.sent && J.sales, JSON.stringify(J));
    await setup.call("Page.navigate", { url: "about:blank" }).catch(() => null);

    /* ── 1. who may open the sales pages (Q10) ─────────────────────────── */
    for (const role of ["manager", "lead", "field", "viewer"]) {
      const p = await newPage(cdp, role, OUT); pages.push(p);
      await p.size(1440, 900, false);
      await attempt(role + ": no Sales estimates switch", async () => {
        await signIn(p, role, "dashboard.html");
        const cards = await p.eval("Array.from(document.querySelectorAll('.hm-card .tt')).map(n => n.childNodes[0].textContent)");
        check(role + ": the home page has no Sales Estimates card", !cards.includes("Sales Estimates"), cards.join("|"));
        await open(p, "/estimates.html", "!document.getElementById('seDenied').hidden");
        const h = await html(p);
        check(role + ": Sales Estimates says it needs the switch, shows nothing and no amount",
          /Sales estimates switch/.test(await text(p, "#seDenied")) && (await p.eval("document.getElementById('seMain').hidden")) && !AMOUNT.test(h));
        if (role === "manager") await shoot(p, "denied_manager", "desktop", false, false);
        await open(p, "/estimate-deck.html?id=" + J.sent, "/Sales estimates switch/.test(document.getElementById('edApp').innerText)");
        check(role + ": the deck wizard says so too, no client and no amount", !/Rowena|Fairbanks/.test(await html(p)) && !AMOUNT.test(await html(p)));
        await open(p, "/materials-library.html", "/Sales estimates switch/.test(document.getElementById('mlGroups').innerText)");
        check(role + ": the Materials Library says so", (await p.eval("document.getElementById('mlAdd').hidden")) === true);
        await open(p, "/cme.html", "getComputedStyle(document.getElementById('cmeBootError')).display === 'block'", 15000, true);
        check(role + ": the drawing tool does not start (the switch)", /Sales estimates switch/.test(await text(p, "#cmeBootWhy")) &&
          !(await p.eval("!!document.querySelector('.model-canvas')")));
      }, p);
    }

    /* ── 2. the admin: the hub ────────────────────────────────────────── */
    const ad = await newPage(cdp, "admin", OUT); pages.push(ad);
    await ad.size(1440, 900, false);
    await attempt("admin: Sales Estimates", async () => {
      await signIn(ad, "admin", "dashboard.html");
      const cards = await ad.eval("Array.from(document.querySelectorAll('.hm-card .tt')).map(n => n.childNodes[0].textContent)");
      check("admin: the home page has the Sales Estimates card", cards.includes("Sales Estimates"), cards.join("|"));
      await open(ad, "/estimates.html", HUB);
      const head = await ad.eval("Array.from(document.querySelectorAll('#seList th')).map(t => t.textContent).join('|')");
      const refHead = await ad.eval("Array.from(document.querySelectorAll('#refList th')).map(t => t.textContent).join('|')");
      check("admin: estimates with Benchmark and Range, comps with Price and $/SF", /Benchmark\|Range/.test(head) && /Price\|\$\/SF/.test(refHead) &&
        /\$46,600/.test(await text(ad, "#seList")) && /\$47,800/.test(await text(ad, "#refList")), head + " / " + refHead);
      check("admin: New estimate, Add past project and Delete offered", !(await ad.eval("document.getElementById('seNew').hidden")) &&
        (await ad.eval("document.querySelectorAll('.delEst').length")) === J.ests);
      await ad.until("Array.from(document.querySelectorAll('img[data-refpic]')).some(i => i.complete && i.naturalWidth > 0)", 8000);
      check("admin: the comps' cover photos load (signed URLs from sales-media)", true);
      await bothThemes(ad, "hub_admin", "desktop");
      await click(ad, "#refList tr.row");
      await ad.until("document.getElementById('refModal').classList.contains('open') && document.querySelectorAll('#refGallery .dg-tile img').length > 0", 6000);
      check("admin: a comp opens with its photos, the price and cost per SF", (await ad.eval("document.getElementById('r_price').value")) === "47800" &&
        /116\.59/.test(await ad.eval("document.getElementById('r_cps').value")));
      await shoot(ad, "comp_admin", "desktop", false, false);
      await click(ad, "#refCancel");
      await ad.size(390, 844, true);
      await open(ad, "/estimates.html", HUB);
      const sw = await noSideways(ad);
      check("admin: phone — Sales Estimates does not scroll sideways", sw.page <= sw.win + 1, JSON.stringify(sw));
      await bothThemes(ad, "hub_admin", "phone");
      await ad.size(1440, 900, false);
    }, ad);

    /* ── 3. the admin's deck estimate from scratch ─────────────────────── */
    let ref = null;
    await attempt("admin: a new deck estimate, step 1 — photos, markup, a drawing", async () => {
      await open(ad, "/estimate-deck.html?new=1", "!!document.getElementById('f_client')");
      await setVal(ad, "f_client", "Gwendolyn Ashby");
      await setVal(ad, "f_addr", "44 Willow Creek Rd");
      await setVal(ad, "f_phone", "(805) 555-0170");
      await setVal(ad, "f_city", "Willow Creek");
      await click(ad, ".ed-pick-card.pt[data-id='new-deck']");
      await setVal(ad, "f_deck", "400");
      await setVal(ad, "f_rail", "50");
      await setVal(ad, "f_stairs", "1");
      await click(ad, ".ed-pick-card.cx[data-id='moderate']");
      check("admin: a new deck mirrors its framing area", (await ad.eval("document.getElementById('f_frame').value")) === "400");
      const acts0 = await db(ad, "R.activity.length");
      await dropPhoto(ad, "#edGallery .dg-wrap", "Back yard.jpg", 30);
      await ad.until("document.querySelectorAll('#edGallery .dg-tile img').length === 1", 8000);
      await ad.until("/auto-saved/.test(document.getElementById('autoSaveMsg').textContent)", 8000);
      const st = await ad.eval("({ id: DCR2DeckEstimate.state.estimateId, ref: DCR2DeckEstimate.state.estimateRef, photo: DCR2DeckEstimate.state.media.photos[0] })");
      ref = st.ref;
      const row = await db(ad, "R.sales_estimates.find(e => e.id === " + st.id + ")");
      check("admin: the photo is in sales-media under the estimate's folder, and the draft row is auto-saved with it",
        /^estimates\/EST-[A-Z0-9]+\/[0-9a-f]{32}\/Back_yard\.jpg$/.test(st.photo.path) && row && row.status === "draft" &&
        row.client_name === "Gwendolyn Ashby" && row.media.photos.length === 1 && row.media.photos[0].path === st.photo.path &&
        (await db(ad, "DCR2Demo.engine.objects.has(" + JSON.stringify(st.photo.path) + ")")), JSON.stringify({ path: st.photo.path, row: row && row.status }));
      // the photo marked up: an arrow
      await click(ad, "#edGallery .dg-act");
      await ad.until("document.querySelector('.pa-overlay.open') && /Arrow|arrow/.test(document.getElementById('paHint').textContent)", 8000);
      await ad.eval(`(() => { const ov = document.getElementById('paOv'); const r = ov.getBoundingClientRect();
        const ev = (t, x, y) => ov.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 1, button: 0, clientX: r.left + x, clientY: r.top + y }));
        ev('pointerdown', r.width * 0.2, r.height * 0.3); ev('pointermove', r.width * 0.5, r.height * 0.5); ev('pointermove', r.width * 0.6, r.height * 0.6); ev('pointerup', r.width * 0.6, r.height * 0.6); return true; })()`);
      await shoot(ad, "markup_admin", "desktop", false, false);
      await click(ad, "#paSave");
      await ad.until("(DCR2DeckEstimate.state.media.photos[0].ann || { items: [] }).items.length === 1", 4000);
      await ad.until("((DCR2Demo.engine.rows.sales_estimates.find(e => e.id === " + st.id + ").media.photos[0] || {}).ann || { items: [] }).items.length === 1", 8000);
      check("admin: the markup (an arrow) is saved on the photo's entry, the photo itself untouched", true);
      // a NEW drawing in CME, saved back to the estimate
      await click(ad, "#edNewDrawing");
      await ad.until("document.getElementById('cmeShell').classList.contains('open') && !!(document.getElementById('cmeFrame').contentDocument || {}).querySelector && !!document.getElementById('cmeFrame').contentDocument.querySelector('.model-canvas')", 20000);
      const scope = await ad.eval("document.getElementById('cmeFrame').contentWindow.CME_STORAGE_SCOPE || ''");
      const me = await ad.eval("DCR2Demo.people.find(p => p.key === 'admin').id");
      await shoot(ad, "cme_admin", "desktop", false, false);
      await ad.eval("document.getElementById('cmeFrame').contentDocument.querySelector('[data-action=\"save-step-one\"]').click(); true");
      await ad.until("!document.getElementById('cmeShell').classList.contains('open') && DCR2DeckEstimate.state.media.photos.some(p => p.cme)", 20000);
      const dr = await ad.eval("DCR2DeckEstimate.state.media.photos.find(p => p.cme)");
      check("admin: the drawing is saved under the entry's 'cme' key (never 'cad'), its PNG at estimates/<ref>/cme/cme-<id>.png",
        !("cad" in dr) && dr.cme.version === 1 && !!dr.cme.project && new RegExp("^estimates/" + ref + "/cme/cme-[0-9a-z-]{8,64}\\.(png|jpg)$", "i").test(dr.path) &&
        (await db(ad, "DCR2Demo.engine.objects.has(" + JSON.stringify(dr.path) + ")")), dr.path);
      const keys = await ad.eval("Object.keys(localStorage).filter(k => /^cme\\./.test(k))");
      check("admin: CME keeps its drawings on this device under Portal 2's own, per-person, per-estimate key (Appendix C)",
        scope === "dcr2-" + me + "-estimate-" + ref && keys.every((k) => k.indexOf("dcr2-" + me + "-") !== -1), JSON.stringify({ scope, keys }));
      await ad.until("(DCR2Demo.engine.rows.sales_estimates.find(e => e.id === " + st.id + ").media.photos || []).some(p => p.cme)", 8000);
      // opened again (the hand-over) and saved again: the same file, replaced in place; still one entry
      await ad.eval("(() => { const tiles = Array.from(document.querySelectorAll('#edGallery .dg-act')); const t = tiles.find(b => /model/.test(b.textContent)); t.click(); return true; })()");
      await ad.until("!!(document.getElementById('cmeFrame').contentDocument || {}).querySelector && !!document.getElementById('cmeFrame').contentDocument.querySelector('.model-canvas')", 20000);
      const handoff = await ad.eval("new URL(document.getElementById('cmeFrame').src).searchParams.get('cmeHandoff') || ''");
      const frameSrc = await ad.eval("document.getElementById('cmeFrame').src");
      const client = await ad.eval("DCR2DeckEstimate.state.project.clientName || ''");
      const inFrame = await ad.eval("(document.getElementById('cmeFrame').contentWindow.CME_PORTAL || {}).clientName || ''");
      check("admin: the client's name never travels in the drawing frame's URL (the static host logs URLs; Referer) - it is handed over in sessionStorage and reaches the drawing",
        !!client && !/clientName=/.test(frameSrc) && frameSrc.indexOf(encodeURIComponent(client)) === -1 && frameSrc.indexOf(client) === -1 && inFrame === client &&
        /[?&]cmeContext=dcr2%3AcmeHandoff%3Actx-/.test(frameSrc), JSON.stringify({ hasClient: !!client, same: inFrame === client }));
      await ad.eval("document.getElementById('cmeFrame').contentDocument.querySelector('[data-action=\"save-step-one\"]').click(); true");
      await ad.until("!document.getElementById('cmeShell').classList.contains('open')", 20000);
      const dr2 = await ad.eval("DCR2DeckEstimate.state.media.photos.filter(p => p.cme)");
      check("admin: the drawing reopens from the estimate (a dcr2: hand-over) and its re-save replaces the same object (one drawing, one file)",
        /^dcr2:cmeHandoff:/.test(handoff) && dr2.length === 1 && dr2[0].path === dr.path, JSON.stringify({ handoff, n: dr2.length }));
      const acts = await db(ad, "R.activity.slice(" + acts0 + ").map(a => a.text)");
      check("admin: photos, markup and drawings wrote no activity line", acts.length === 0, JSON.stringify(acts));
      await bothThemes(ad, "step1_admin", "desktop");
    }, ad);

    await attempt("admin: steps 2 to 5, saved with its money apart", async () => {
      await click(ad, "#s1next");
      await ad.until("document.querySelectorAll('.ed-match').length >= 5", 8000);
      const first = await ad.eval("document.querySelector('.ed-match .nm').textContent");
      check("admin: step 2 ranks the comps by match, with their prices", /Juniper Lane Deck/.test(first) && /Final price/.test(await text(ad, "#edApp")), first);
      await click(ad, ".pickRef[data-ref='DEMO-DECK-101']");
      await ad.until("!!document.querySelector('.ed-match.sel')", 4000);
      await click(ad, ".showRef[data-ref='DEMO-DECK-102']");
      await ad.until("/Showing the client 1 project/.test(document.getElementById('s2msg').textContent)", 4000);
      await bothThemes(ad, "step2_admin", "desktop");
      await click(ad, "#s2next");
      await ad.until("document.querySelectorAll('.ed-mat').length >= 3", 8000);
      await click(ad, ".ed-mat[data-mat='brightwood-ridge'] .hd");
      await ad.until("!!document.querySelector('.ed-mat.sel[data-mat=\"brightwood-ridge\"]')", 4000);
      await click(ad, ".altBtn[data-mat='harborline-coastal']");
      await ad.until("!!document.querySelector('.ed-mat.alt[data-mat=\"harborline-coastal\"]')", 4000);
      await click(ad, ".detBtn[data-mat='brightwood-ridge']");
      await ad.until("!document.getElementById('matModal').hidden && document.querySelectorAll('#mvBody img[data-shot]').length === 2", 6000);
      await ad.until("Array.from(document.querySelectorAll('#mvBody img[data-shot]')).every(i => i.complete && i.naturalWidth > 0)", 8000);
      check("admin: the product viewer shows the color's two photos (board and sample)", true);
      await bothThemes(ad, "viewer_admin", "desktop", false);
      await ad.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true");
      await ad.until("document.getElementById('matModal').hidden", 3000);
      await click(ad, "#s3next");
      await ad.until("document.querySelectorAll('.rateIn').length === 5", 6000);
      await setVal(ad, "pc_labor", "75");
      await ad.eval("(() => { const i = document.querySelector('.rateIn[data-rate=\"framingSF\"]'); i.value = '18'; i.dispatchEvent(new Event('input', { bubbles: true })); const j = document.querySelector('.rateIn[data-rate=\"railingLF\"]'); j.value = '65'; j.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
      await click(ad, "#addCrew");
      await ad.until("document.querySelectorAll('.ed-item').length === 1", 4000);
      await ad.eval("(() => { const r = document.querySelector('.ed-item'); const set = (f, v) => { const i = r.querySelector('[data-f=\"' + f + '\"]'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }; set('name', 'Demo old deck'); set('guys', '2'); set('days', '1'); return true; })()");
      await ad.until("/\\$11,650/.test(document.getElementById('edPriceTot').innerText)", 4000);
      check("admin: step 4 — your rates (framing 400 SF × $18, railing 50 LF × $65) and a crew task (2 × 1 day × 8 h × $75) = $11,650", true);
      await bothThemes(ad, "step4_admin", "desktop");
      await click(ad, "#s4next");
      await ad.until("/Benchmark total/.test(document.getElementById('edApp').innerText)", 8000);
      const s5 = await text(ad, "#edApp");
      check("admin: step 5 — the benchmark (Juniper Lane Deck's $116.59/SF × 400 SF = $46,636), the comparable range and the priced scope",
        /\$46,636/.test(s5) && /Comparable range|Single comparable value|No comparable range/.test(s5) && /Priced scope total/.test(s5), s5.slice(0, 400));
      await setVal(ad, "s5status", "preliminary", "change");
      await click(ad, "#s5save");
      await ad.until("/Saved \\(/.test(document.getElementById('s5msg').textContent)", 8000);
      const id = await ad.eval("DCR2DeckEstimate.state.estimateId");
      const saved = await db(ad, "({ e: R.sales_estimates.find(x => x.id === " + id + "), p: R.sales_estimate_prices.find(x => x.estimate_id === " + id + ") })");
      // the row people without prices read: no rate, no benchmark, no range, no priced line (the media's drawings and markup
      // carry quantities and arrows, not money)
      const noMoney = (o) => { const x = Object.assign({}, o); delete x.media;
        return !/"(rates|laborRate|benchmark|range|sourceRows|costPerSF|loTotal|hiTotal|benchmark_total|range_low_total|range_high_total|reference_price|cost_per_primary_unit|pricing|output)"/.test(JSON.stringify(x)) &&
          !/"(rates|laborRate|pricing)"/.test(JSON.stringify(o.media)); };
      check("admin: saved — the estimate (preliminary, its reference, its selection) and its money only in sales_estimate_prices",
        saved.e.status === "preliminary" && saved.e.reference_project_id === 1 && saved.e.selection.sel.primary.materialId === "brightwood-ridge" &&
        noMoney(saved.e) && Number(saved.p.benchmark_total) === 46636 && saved.p.pricing.rates.framingSF === "18" && saved.p.output.benchmark.present === true,
        JSON.stringify({ status: saved.e.status, ref: saved.e.reference_project_id, bench: saved.p && saved.p.benchmark_total }));
      await bothThemes(ad, "step5_admin", "desktop");
      await ad.call("Emulation.setEmulatedMedia", { media: "print" });
      await sleep(300);
      check("admin: the print view — the letterhead, no steps, no buttons", await ad.eval("getComputedStyle(document.getElementById('printHead')).display === 'flex' && getComputedStyle(document.getElementById('edSteps')).display === 'none' && getComputedStyle(document.querySelector('.ed-nav')).display === 'none'"));
      if (SHOTS !== "none") {
        // the print view itself (shoot() would set the screen media back for its themes)
        const ph = await ad.eval("Math.min(4200, document.documentElement.scrollHeight)");
        await ad.call("Emulation.setDeviceMetricsOverride", { width: 900, height: ph, deviceScaleFactor: 1, mobile: false });
        await sleep(400);
        shots.push(await ad.shot("sales_print_admin_light_desktop.png"));
        await ad.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      }
      await ad.call("Emulation.setEmulatedMedia", { media: "" });
      await ad.size(390, 844, true);
      await open(ad, "/estimate-deck.html?id=" + id, "!!document.getElementById('f_client')");
      const sw = await noSideways(ad);
      check("admin: phone — the wizard does not scroll sideways", sw.page <= sw.win + 1, JSON.stringify(sw));
      await bothThemes(ad, "step1_admin", "phone");
      await ad.eval("document.querySelector('.ed-step[data-step=\"5\"]').click(); true");
      await ad.until("/Benchmark total/.test(document.getElementById('edApp').innerText)", 8000);
      const sw5 = await noSideways(ad);
      check("admin: phone — step 5 does not scroll sideways (the comparables table scrolls in its box)", sw5.page <= sw5.win + 1, JSON.stringify(sw5));
      await shoot(ad, "step5_admin", "phone", false);
      await ad.size(1440, 900, false);
    }, ad);

    /* ── 4. a save that meets someone else's newer one ─────────────────── */
    await attempt("admin: two copies of one estimate — the second save is refused (409), never written over", async () => {
      const a = await newPage(cdp, "admin-tab-a", OUT); pages.push(a);
      const b = await newPage(cdp, "admin-tab-b", OUT); pages.push(b);
      for (const p of [a, b]) { await p.size(1440, 900, false); await signIn(p, "admin", "dashboard.html"); }
      for (const p of [a, b]) {
        await open(p, "/estimate-deck.html?id=" + J.sent, "!!document.getElementById('f_client')");
        await p.eval("document.querySelector('.ed-step[data-step=\"5\"]').click(); true");
        await p.until("!!document.getElementById('s5save')", 8000);
      }
      await click(a, "#s5save");
      await a.until("/Saved \\(/.test(document.getElementById('s5msg').textContent)", 8000);
      await sleep(600);
      await click(b, "#s5save");
      await b.until("document.getElementById('s5msg').textContent.length > 8 && !/Saving/.test(document.getElementById('s5msg').textContent)", 8000);
      const msg = await text(b, "#s5msg");
      check("admin: the second tab is told someone else saved meanwhile", /Someone else saved this estimate/.test(msg), msg);
      // the refusal in view (it sits under step 5's buttons)
      await b.eval("document.getElementById('s5msg').scrollIntoView({ block: 'center' }); true");
      await shoot(b, "conflict_admin", "desktop", false, false);
    }, ad);

    /* ── 5. Sasha Seller: the switch, no prices ────────────────────────── */
    const sa = await newPage(cdp, "sales", OUT); pages.push(sa);
    await sa.size(1440, 900, false);
    await attempt("sales (no prices): the hub, her draft, a comp without a price", async () => {
      await signIn(sa, "sales", "dashboard.html");
      await sa.until("!!document.getElementById('hmSales')", 8000).catch(() => null);
      const cards = await sa.eval("Array.from(document.querySelectorAll('.hm-card .tt')).map(n => n.childNodes[0].textContent)");
      check("sales: the home page has the Sales Estimates card", cards.includes("Sales Estimates"), cards.join("|"));
      await open(sa, "/estimates.html", HUB);
      const h = await html(sa);
      const head = await sa.eval("Array.from(document.querySelectorAll('#seList th, #refList th')).map(t => t.textContent).join('|')");
      check("sales: no Benchmark, Range, Price or $/SF column and no amount anywhere in the page; the note says why",
        !/Benchmark|Range|Price|\$\/SF/.test(head) && !AMOUNT.test(h) && !(await sa.eval("document.getElementById('seNoPrices').hidden")), (h.match(/.{40}\$\s?\d.{20}/) || [head])[0]);
      check("sales: an editor — New estimate and Add past project offered", !(await sa.eval("document.getElementById('seNew').hidden")) && !(await sa.eval("document.getElementById('refAdd').hidden")));
      await bothThemes(sa, "hub_sales", "desktop");
      // a past project without its price: saved; its price row stays empty
      await click(sa, "#refAdd");
      await sa.until("document.getElementById('refModal').classList.contains('open')", 4000);
      check("sales: the comp editor has no price field and says who adds it", (await sa.eval("document.querySelector('#refModal .se-money').hidden")) && !(await sa.eval("document.getElementById('r_noPrice').hidden")));
      await setVal(sa, "r_ref", "DEMO-DECK-201");
      await setVal(sa, "r_name", "Sage Valley Deck");
      await setVal(sa, "r_city", "Sage Valley");
      await setVal(sa, "r_sf", "330");
      await setVal(sa, "r_rail", "30");
      await click(sa, "#refSave");
      await sa.until("!document.getElementById('refModal').classList.contains('open') && /Sage Valley Deck/.test(document.getElementById('refList').innerText)", 8000);
      const made = await db(sa, "(() => { const r = R.sales_reference_projects.find(x => x.project_ref === 'DEMO-DECK-201'); const p = R.sales_reference_prices.find(x => x.reference_id === r.id); return { r: !!r, price: p ? p.reference_price : 'none', cps: p ? p.cost_per_primary_unit : 'none' }; })()");
      check("sales: the comp is saved, and its price row (made with it) stays empty", made.r && made.price === null && made.cps === null, JSON.stringify(made));
      // her draft: the notes' typed amount masked and read only; no money step
      await open(sa, "/estimate-deck.html?id=" + J.draft, "!!document.getElementById('f_notes')");
      const notes = await sa.eval("({ v: document.getElementById('f_notes').value, d: document.getElementById('f_notes').disabled })");
      check("sales: the notes' typed amount is masked and read only (a masked copy is never saved over the words)", /amount hidden/.test(notes.v) && notes.d && !AMOUNT.test(await html(sa)), JSON.stringify(notes));
      await sa.until("document.querySelectorAll('#edGallery .dg-tile img').length === 2", 8000);
      await bothThemes(sa, "draft_sales", "desktop");
      await sa.eval("document.querySelector('.ed-step[data-step=\"3\"]').click(); true");
      await sa.until("document.querySelectorAll('.ed-mat').length >= 3", 8000);
      await click(sa, ".ed-mat[data-mat='brightwood-trailhead'] .hd");
      await sa.until("!!document.querySelector('.ed-mat.sel')", 4000);
      await click(sa, "#s3next");
      await sa.until("/need the <b>prices<\\/b> switch|need the prices switch/.test(document.getElementById('edApp').innerHTML)", 6000);
      check("sales: step 4 has no rate editor (your rates need the prices switch)", (await sa.eval("document.querySelectorAll('.rateIn').length")) === 0);
      await click(sa, "#s4next");
      await sa.until("!!document.getElementById('s5save')", 8000);
      const s5h = await html(sa);
      check("sales: step 5 shows no benchmark, no range and no amount", !/Benchmark total|Comparable range/.test(await text(sa, "#edApp")) && !AMOUNT.test(s5h));
      const before = await db(sa, "JSON.stringify(R.sales_estimate_prices.find(p => p.estimate_id === " + J.draft + "))");
      await click(sa, "#s5save");
      await sa.until("/Saved \\(/.test(document.getElementById('s5msg').textContent)", 8000);
      const after = await db(sa, "({ p: JSON.stringify(R.sales_estimate_prices.find(p => p.estimate_id === " + J.draft + ")), e: R.sales_estimates.find(e => e.id === " + J.draft + ") })");
      check("sales: saved — the selection kept, the notes' words untouched, the estimate's prices untouched",
        after.p === before && after.e.notes === "Asked whether $9,500 is realistic." && after.e.selection.sel.primary.materialId === "brightwood-trailhead", JSON.stringify({ notes: after.e.notes }));
      await bothThemes(sa, "step5_sales", "desktop");
      await sa.size(390, 844, true);
      await open(sa, "/estimates.html", HUB);
      const sw = await noSideways(sa);
      check("sales: phone — Sales Estimates does not scroll sideways", sw.page <= sw.win + 1, JSON.stringify(sw));
      await shoot(sa, "hub_sales", "phone", false);
      await sa.size(1440, 900, false);
    }, sa);

    /* ── 6. the accountant: the switch, reads only ─────────────────────── */
    const ac = await newPage(cdp, "accountant", OUT); pages.push(ac);
    await ac.size(1440, 900, false);
    await attempt("accountant (the switch, not a sales editor): reads only", async () => {
      await signIn(ac, "accountant", "dashboard.html");
      await open(ac, "/estimates.html", HUB);
      check("accountant: amounts shown (prices), but no New, no Add, no Delete; the note says who changes them",
        /\$46,600|\$46,636/.test(await text(ac, "#seList")) && (await ac.eval("document.getElementById('seNew').hidden && document.getElementById('refAdd').hidden && document.querySelectorAll('.delEst').length === 0")) &&
        !(await ac.eval("document.getElementById('seReadOnly').hidden")));
      await click(ac, "#refList tr.row");
      await ac.until("document.getElementById('refModal').classList.contains('open')", 4000);
      check("accountant: a comp opens read only", await ac.eval("document.getElementById('r_name').disabled && document.getElementById('refSave').style.display === 'none' && !document.querySelector('#refGallery .dg-add')"));
      await click(ac, "#refCancel");
      await shoot(ac, "hub_accountant", "desktop", false);
      await open(ac, "/estimate-deck.html?id=" + J.sent, "!!document.getElementById('f_client')");
      check("accountant: an estimate opens read only — no drawing, no recorder, no upload", /Read only/.test(await text(ac, "#edApp")) &&
        (await ac.eval("document.getElementById('edNewDrawing').hidden && document.getElementById('edRecBox').hidden && !document.querySelector('#edGallery .dg-add')")));
      await ac.eval("document.querySelector('.ed-step[data-step=\"5\"]').click(); true");
      await ac.until("/Benchmark total/.test(document.getElementById('edApp').innerText)", 8000);
      check("accountant: step 5 shows the amounts and no Save", !(await ac.eval("!!document.getElementById('s5save')")));
      await open(ac, "/materials-library.html", LIB);
      check("accountant: the library reads only (no Add, no + color)", await ac.eval("document.getElementById('mlAdd').hidden && !document.querySelector('[data-addcolor]')"));
    }, ac);

    /* ── 7. the Materials Library (admin) ──────────────────────────────── */
    await attempt("admin: the Materials Library — a new line with a photo and a color", async () => {
      await open(ad, "/materials-library.html", LIB);
      await bothThemes(ad, "library_admin", "desktop");
      await click(ad, "#mlAdd");
      await ad.until("document.getElementById('mlModal').classList.contains('open')", 4000);
      await setVal(ad, "mName", "Kestrel Ridge Hardwood");
      await setVal(ad, "mBrand", "Kestrel");
      await setVal(ad, "mSubCat", "Hardwood Decking");
      await setVal(ad, "mDesc", "Ipe-look hardwood boards (made up).");
      await dropPhoto(ad, "#mGallery .dg-wrap", "Kestrel board.jpg", 20);
      await ad.until("document.querySelectorAll('#mGallery .dg-tile img').length === 1", 8000);
      await shoot(ad, "library_editor_admin", "desktop", false, false);
      await click(ad, "#mSave");
      await ad.until("!document.getElementById('mlModal').classList.contains('open') && /Kestrel Ridge Hardwood/.test(document.getElementById('mlGroups').innerText)", 8000);
      const row = await db(ad, "R.sales_materials.find(m => m.item_name === 'Kestrel Ridge Hardwood')");
      check("admin: the line is saved (item_key kestrel-ridge-hardwood, its photo in sales-media/materials/…)", row && row.item_key === "kestrel-ridge-hardwood" &&
        row.item_kind === "product" && /^materials\//.test(row.pictures[0].path), JSON.stringify(row && { key: row.item_key, pic: row.pictures[0] }));
      await ad.eval("(() => { const n = Array.from(document.querySelectorAll('[data-addcolor]')).find(x => x.dataset.addcolor === 'kestrel-ridge-hardwood'); n.click(); return true; })()");
      await ad.until("document.getElementById('mlModal').classList.contains('open') && /Add color/.test(document.getElementById('mTitle').textContent)", 4000);
      await setVal(ad, "mName", "Amber");
      await click(ad, "#mSave");
      await ad.until("!document.getElementById('mlModal').classList.contains('open')", 8000);
      const col = await db(ad, "R.sales_materials.find(m => m.item_kind === 'color' && m.material_key === 'kestrel-ridge-hardwood')");
      check("admin: its color is saved (kestrel-ridge-hardwood-amber)", col && col.item_key === "kestrel-ridge-hardwood-amber" && col.item_name === "Amber");
      await ad.size(390, 844, true);
      await open(ad, "/materials-library.html", LIB);
      const sw = await noSideways(ad);
      check("admin: phone — the library does not scroll sideways", sw.page <= sw.win + 1, JSON.stringify(sw));
      await bothThemes(ad, "library_admin", "phone");
      await ad.size(1440, 900, false);
      // the new line is offered in the wizard (the library first, the shipped file only as a fallback)
      await open(ad, "/estimate-deck.html?id=" + J.sent, "!!document.getElementById('f_client')");
      await ad.eval("document.querySelector('.ed-step[data-step=\"3\"]').click(); true");
      await ad.until("document.querySelectorAll('.ed-mat').length >= 4", 8000);
      check("admin: the wizard's materials come from the library (the new line is there)", /Kestrel Ridge Hardwood/.test(await text(ad, "#edApp")));
    }, ad);

    /* ── 8. P5 acceptance check 5 ──────────────────────────────────────── */
    await attempt("no activity line and no outbox row from the sales pages", async () => {
      const now = await db(ad, "({ acts: R.activity.length, outbox: (R.notifications_outbox || []).length, money: R.activity.filter(a => a.kind !== 'note' && /\\$\\s?\\d/.test(a.text || '')).length })");
      check("P5 check 5: the sales pages wrote no activity line and no outbox row; no system line carries an amount",
        now.acts === J.acts && now.outbox === J.outbox && now.money === 0, JSON.stringify({ before: J, now }));
    }, ad);

    /* ── 9. no security-policy violation, no console error ─────────────── */
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
