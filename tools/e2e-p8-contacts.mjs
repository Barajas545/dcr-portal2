#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the contact pictures and the contact card in the DEMO (the Books program,
   release A3; development only).

     node tools/e2e-p8-contacts.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with the rules of migration
   20261030000200: tools/fake/p8-contacts.js; nothing goes to Supabase) and drives a local Chrome or Edge headless:

   - The Books as the accountant: the payees' pictures on the check desk (the seed's for a sub, initials for a payee
     nobody linked), each a button for a contact editor; a click opens the contact card and never the check desk's row;
   - the card: a picture chosen (a made-up 900 x 600 PNG drawn in the page) becomes a 400 x 400 JPEG at
     "<contact id>/<uuid>.jpg", pointed at by the contact; a pasted picture (Ctrl+V on the card) replaces it, pasted text
     is left alone; [Remove the picture] gives initials back; the phone and e-mail: another contact's e-mail is refused
     in words, a new one saved with the phone tidied by the database; Esc closes; the desk shows the new picture;
   - [Add phone / e-mail] on a payee nobody can reach: the card, a phone saved, the tell panel offers "Call" at once;
   - Search: the contacts' pictures or initials; a contact editor's open the card, a field account's are not buttons;
   - phone (390 px: nothing scrolls sideways, the card fits) and desktop, light and dark; no Content-Security-Policy
     violation and no console error on any page.
   Screenshots (--shots all): contacts_<what>_<light|dark>_<desktop|phone>.png into --out.
   Prints a JSON summary; exit code 1 when a check failed. Made-up people, companies and pictures only. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p8-contacts")));
const SHOTS = arg("--shots", "all");
const KEY = /^\d+\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

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
        try { where = " @ " + await page.eval("location.href + ' :: ' + (document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(-400) : '')"); }
        catch (x) { where = " @ (page not answering: " + x.message + ")"; }
      }
      check(name, false, String(e && e.message || e).slice(0, 400) + where);
    }
  };
  const TOPBAR = "!!document.querySelector('.dcr2-topbar .p2-badge')";
  async function open(p, path, marker, ms) {
    await p.goto(base + path, 150);
    await p.until("(location.pathname).indexOf(" + JSON.stringify(path.split("?")[0]) + ") === 0 && " + TOPBAR + (marker ? " && (" + marker + ")" : ""), ms || 15000);
  }
  async function signIn(p, key) {
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
    await p.goto(base + "/index.html", 150);
    await p.until("!!document.getElementById('loginForm') && !!window.DCR2Demo && !document.getElementById('loginFields').disabled", 8000);
    await p.eval("document.getElementById('email').value=" + JSON.stringify(key + "@demo.test") + ";document.getElementById('password').value='demo-password-1';" +
      "document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname) && " + TOPBAR, 10000);
  }
  const db = (p, expr) => p.eval("(() => { const R = DCR2Demo.engine.rows; return " + expr + "; })()");
  const CARD = "!!document.querySelector('#ccModal.open #ccPhone')";
  const msg = (p) => p.eval("(document.getElementById('ccMsg') || {}).textContent || ''");
  // a made-up picture drawn in the page (a 900 x 600 PNG: a blue field, a white disc)
  const PICTURE = "(async () => { const c = document.createElement('canvas'); c.width = 900; c.height = 600; const g = c.getContext('2d');" +
    " g.fillStyle = '#2563eb'; g.fillRect(0, 0, 900, 600); g.fillStyle = '#ffffff'; g.beginPath(); g.arc(450, 300, 180, 0, 7); g.fill();" +
    " const b = await new Promise((r) => c.toBlob(r, 'image/png')); return new File([b], 'IMG_0001.png', { type: 'image/png' }); })()";
  async function shoot(p, name, device, dark) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 390 : 1440, hgt = device === "phone" ? 844 : 900;
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: hgt, deviceScaleFactor: 1, mobile: device === "phone" });
    await sleep(500);
    const file = "contacts_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.dark(false);
  }
  async function four(p, name) {
    await shoot(p, name, "desktop", false); await shoot(p, name, "desktop", true);
    await shoot(p, name, "phone", false); await shoot(p, name, "phone", true);
    await p.size(1440, 900, false);
  }
  const J = {};
  try {
    const ac = await newPage(cdp, "accountant", OUT); pages.push(ac);
    await ac.size(1440, 900, false);
    await signIn(ac, "accountant");

    /* ── 1. The Books: the payees' pictures ── */
    await attempt("The Books: the payees' pictures and initials on the check desk", async () => {
      await open(ac, "/accounting.html", "!!document.getElementById('secPay') && !!document.querySelector('#secPay .ck-payee .av')");
      J.rose = await db(ac, "(() => { const c = R.contacts.find(x => x.company === 'Rosewell Concrete'); return { id: c.id, path: c.picture_path, email: c.email, version: c.version }; })()");
      await ac.until("!!document.querySelector('#secPay button.av[data-av-contact=\"" + J.rose.id + "\"] img')", 8000);
      const desk = await ac.eval("Array.from(document.querySelectorAll('#secPay .ck-payee .av')).map(a => ({ tag: a.tagName, id: a.getAttribute('data-av-id'), img: !!a.querySelector('img'), text: a.textContent }))");
      check("the seeded sub's picture is drawn (a signed address in an <img>), as a button for a contact editor",
        desk.some((a) => a.tag === "BUTTON" && a.id === String(J.rose.id) && a.img), JSON.stringify(desk));
      check("a payee nobody linked: its initials, not a button", desk.some((a) => a.tag === "SPAN" && !a.id && /^[A-Z]{1,2}$/.test(a.text)), JSON.stringify(desk));
      if (SHOTS !== "none") {
        // the check desk and the tell list in view (the shots are one screen high)
        for (const [dev, dark] of [["desktop", false], ["desktop", true], ["phone", false], ["phone", true]]) {
          await ac.call("Emulation.setDeviceMetricsOverride", { width: dev === "phone" ? 390 : 1440, height: dev === "phone" ? 844 : 900, deviceScaleFactor: 1, mobile: dev === "phone" });
          await ac.eval("document.getElementById('secPay').scrollIntoView(); true");
          await shoot(ac, "books_payees", dev, dark);
        }
        await ac.size(1440, 900, false);
      }
    }, ac);

    /* ── 2. the card from a payee's picture ── */
    await attempt("the card: opened from the picture, never the row; a chosen picture, a pasted one, removed; the reach", async () => {
      await ac.eval("document.querySelector('#secPay button.av[data-av-contact=\"" + J.rose.id + "\"]').click(); true");
      await ac.until(CARD, 8000);
      check("a click on the picture opens the card, not the check desk", !(await ac.eval("!!document.querySelector('#secPay .ck-open')")));
      check("the card shows the contact as text", /Rosewell/.test(await ac.eval("document.getElementById('ccSub').textContent + document.getElementById('ccName').textContent")));
      // choose a picture
      await ac.eval("(async () => { const f = await " + PICTURE + "; const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('ccFile'); i.files = dt.files; i.dispatchEvent(new Event('change')); return true; })()");
      await ac.until("/Picture saved/.test(document.getElementById('ccMsg').textContent)", 10000);
      const one = await db(ac, "R.contacts.find(x => x.id === " + J.rose.id + ").picture_path");
      check("the picture is stored at <contact id>/<uuid>.jpg and the contact points at it", KEY.test(one) && one.startsWith(J.rose.id + "/") && one !== J.rose.path, one);
      const made = await ac.eval("(async () => { const b = DCR2Demo.engine.storage.blob(" + JSON.stringify(one) + "); if (!b) return null; const i = await createImageBitmap(b); " +
        "const c = new OffscreenCanvas(1, 1); const g = c.getContext('2d'); g.drawImage(i, 0, 0, 1, 1, 0, 0, 1, 1); const px = g.getImageData(0, 0, 1, 1).data; " +
        "return { type: b.type, w: i.width, h: i.height, size: b.size, corner: Array.from(px).slice(0, 3) }; })()");
      check("made in the browser: a 400 x 400 JPEG, the centre square (the blue field at its corner)",
        made && made.type === "image/jpeg" && made.w === 400 && made.h === 400 && made.size < 2097152 && made.corner[2] > 180 && made.corner[0] < 90, JSON.stringify(made));
      await ac.until("!!document.querySelector('#ccPic .av img')", 6000);
      if (SHOTS !== "none") await four(ac, "card_picture");
      // paste text: nothing happens; paste a picture: a new one
      const before = one;
      await ac.eval("(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'just words'); document.getElementById('ccPhone').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()");
      await sleep(600);
      check("pasted text is left alone", (await db(ac, "R.contacts.find(x => x.id === " + J.rose.id + ").picture_path")) === before);
      await ac.eval("(async () => { const f = await " + PICTURE + "; const dt = new DataTransfer(); dt.items.add(f); document.querySelector('#ccModal .cc-card').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()");
      await ac.until("/Picture saved/.test(document.getElementById('ccMsg').textContent) && DCR2Demo.engine.rows.contacts.find(x => x.id === " + J.rose.id + ").picture_path !== " + JSON.stringify(before), 10000);
      check("Ctrl+V of a picture on the card replaces it (a new key)", KEY.test(await db(ac, "R.contacts.find(x => x.id === " + J.rose.id + ").picture_path")));
      // remove it (the app's own confirm), then one more picture for the desk
      await ac.eval("document.getElementById('ccRemove').click(); true");
      await ac.until("!!document.querySelector('.dcr-mo.open #dcrMoYes')", 5000);
      await ac.eval("document.getElementById('dcrMoYes').click(); true");
      await ac.until("/Picture removed/.test(document.getElementById('ccMsg').textContent)", 8000);
      check("[Remove the picture]: initials again", (await db(ac, "R.contacts.find(x => x.id === " + J.rose.id + ").picture_path")) === null &&
        !(await ac.eval("!!document.querySelector('#ccPic .av img')")));
      await ac.eval("(async () => { const f = await " + PICTURE + "; const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('ccFile'); i.files = dt.files; i.dispatchEvent(new Event('change')); return true; })()");
      await ac.until("/Picture saved/.test(document.getElementById('ccMsg').textContent)", 10000);
      J.rosePath = await db(ac, "R.contacts.find(x => x.id === " + J.rose.id + ").picture_path");
      // the reach: another contact's e-mail is refused in words; a new one saved, the phone tidied
      const taken = await db(ac, "R.contacts.find(x => x.company === 'Brightwater Concrete').email");
      await ac.eval("document.getElementById('ccEmail').value = " + JSON.stringify(taken.toUpperCase()) + "; document.getElementById('ccSave').click(); true");
      await ac.until("/Another contact already has this e-mail/.test(document.getElementById('ccMsg').textContent)", 8000);
      check("another contact's e-mail: refused, in words", true);
      await ac.eval("document.getElementById('ccPhone').value = '805 555 0166'; document.getElementById('ccEmail').value = ' rosewell.office@example.com '; document.getElementById('ccSave').click(); true");
      await ac.until("!document.querySelector('#ccModal.open')", 8000);
      const saved = await db(ac, "(() => { const c = R.contacts.find(x => x.id === " + J.rose.id + "); return [c.phone, c.email]; })()");
      check("phone and e-mail saved, as the database tidies them; the card closes", saved[0] === "(805) 555-0166" && saved[1] === "rosewell.office@example.com", JSON.stringify(saved));
      await ac.until("!!document.querySelector('#secPay button.av[data-av-contact=\"" + J.rose.id + "\"] img[src^=\"blob:\"]')", 8000);
      check("the desk is read again and shows the new picture", true);
    }, ac);

    /* ── 3. [Add phone / e-mail] on a payee nobody can reach ── */
    await attempt("[Add phone / e-mail]: the card from the tell panel, the phone offered at once", async () => {
      J.bw = await db(ac, "R.contacts.find(x => x.company === 'Brightwater Concrete').id");
      await ac.eval("(() => { const E = DCR2Demo.engine; const admin = DCR2Demo.people.find(p => p.key === 'admin').id; " +
        "E.update({ uid: admin }, 'contacts', { phone: null, email: null }, { filters: [{ col: 'id', op: 'eq', val: " + J.bw + ", neg: false }], orders: [], foreignLimits: {} }); return true; })()");
      await open(ac, "/accounting.html", "!!document.getElementById('secTell') && !!document.querySelector('#secTell [data-load]')");
      const pid = await db(ac, "R.payments.find(p => p.payee === 'Brightwater Concrete' && !p.pickup_told_at).id");
      await ac.eval("document.querySelector('#secTell [data-load=\"" + pid + "\"]').click(); true");
      await ac.until("!!document.querySelector('#secTell [data-reach=\"" + J.bw + "\"]')", 6000);
      check("nobody to reach: [Add phone / e-mail] for a contact editor", true);
      await ac.eval("document.querySelector('#secTell [data-reach=\"" + J.bw + "\"]').click(); true");
      await ac.until(CARD, 8000);
      await ac.eval("document.getElementById('ccPhone').value = '(805) 555-0177'; document.getElementById('ccSave').click(); true");
      await ac.until("!document.querySelector('#ccModal.open') && /Call \\(805\\) 555-0177/.test(document.getElementById('secTell').innerText)", 10000);
      check("saved: the tell panel offers the call at once (the desk read again)", true);
    }, ac);

    /* ── 4. Search ── */
    await attempt("Search: pictures or initials; the card only from a contact editor's", async () => {
      await open(ac, "/search.html?q=Concrete", "!!document.querySelector('#seResults .se-contact .av')");
      await ac.until("!!document.querySelector('#seResults .se-contact button.av[data-av-contact=\"" + J.rose.id + "\"] img')", 8000);
      const rows = await ac.eval("Array.from(document.querySelectorAll('#seResults .se-contact .av')).map(a => a.tagName)");
      check("the accountant: every contact's avatar is a button", rows.length > 3 && rows.every((t) => t === "BUTTON"), JSON.stringify(rows));
      await ac.eval("document.querySelector('#seResults .se-contact button.av[data-av-contact=\"" + J.rose.id + "\"]').click(); true");
      await ac.until(CARD, 8000);
      if (SHOTS !== "none") await four(ac, "search_card");
      await ac.eval("document.getElementById('ccPhone').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
      await ac.until("!document.querySelector('#ccModal.open')", 5000);
      check("Esc closes the card", true);
    }, ac);

    /* ── 5. the phone: the card fits ── */
    await attempt("390 px: the card fits, nothing scrolls sideways", async () => {
      await ac.size(390, 844, true);
      await open(ac, "/accounting.html", "!!document.querySelector('#secPay button.av')");
      await ac.eval("document.querySelector('#secPay button.av').click(); true");
      await ac.until(CARD, 8000);
      const fit = await ac.eval("(() => { const r = document.querySelector('#ccModal .cc-card').getBoundingClientRect(); return { l: r.left, r: r.right, w: window.innerWidth, wide: document.documentElement.scrollWidth > window.innerWidth + 1 }; })()");
      check("the card inside the screen, no sideways scroll", fit.l >= 0 && fit.r <= fit.w && !fit.wide, JSON.stringify(fit));
      if (SHOTS !== "none") { await shoot(ac, "card_phone", "phone", false); await shoot(ac, "card_phone", "phone", true); }
      await ac.size(1440, 900, false);
    }, ac);

    /* ── 6. a field account (the same browser, so the same demo database): pictures, never a button ── */
    await attempt("Search as a field account: the pictures, none of them a button", async () => {
      const fd = await newPage(cdp, "field", OUT); pages.push(fd);
      await fd.size(390, 844, true);
      await signIn(fd, "field");
      await open(fd, "/search.html?q=Concrete", "!!document.querySelector('#seResults .se-contact .av')");
      await fd.until("!!document.querySelector('#seResults .se-contact .av img')", 8000);
      const f = await fd.eval("({ buttons: document.querySelectorAll('#seResults .se-contact button.av').length, spans: document.querySelectorAll('#seResults .se-contact span.av').length, " +
        "wide: document.documentElement.scrollWidth > window.innerWidth + 1 })");
      check("a field account sees the pictures, none of them a button; nothing scrolls sideways at 390 px", f.buttons === 0 && f.spans > 3 && !f.wide, JSON.stringify(f));
      if (SHOTS !== "none") await four(fd, "search_field");
    });

    /* ── 7. no security-policy violation, no console error ── */
    for (const p of pages) {
      const bad = p.log.filter((x) => /CSP-VIOLATION|Content Security Policy/i.test(x.text) || x.level === "exception" ||
        (x.level === "error" && !/favicon\.ico|net::ERR_ABORTED|ERR_INTERNET_DISCONNECTED|Failed to fetch|demo: offline|status of 4\d\d/.test(x.text + " " + (x.url || ""))));
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
