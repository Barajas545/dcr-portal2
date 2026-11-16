#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the photo files (the photographer screen program, P5, the OneDrive edition; DCR
   Desktop 2 migrations 20261111000100_photo_files and 20261114000100_photo_files_onedrive and the function photo-files;
   the contract DCR Desktop 2 docs/PHOTO-FILES-ONEDRIVE.md §8.4, §10), in the DEMO (development only). The phone's
   hand-in walk is section 3 below.

     node tools/e2e-p10-photo-files.mjs [--out <dir>] [--chrome <path>] [--shots all|some|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser demo database with tools/fake/p10-photo-files.js:
   the three tables, photo_drive_status, photo_ready_list, photo_marketing_act, the phone's hand-in RPCs, a photo-files
   stand-in whose upload addresses are tools/fake/p7-onedrive.js's demo ones; nothing goes to Supabase or Microsoft) and
   drives a local Chrome or Edge headless, PHONE FIRST (375x812, touch) then the desk (1440x900):

   1. Marketing (Taylor) on each: Home's 📷 card says how many shoots are ready for marketing and links to the Ready view;
      shoots.html opens on Ready for marketing (the first view of someone only on marketing); a card full screen on the
      phone (Back and Escape close it), on the right on the desk; I'm on it; Posted… - its keyboard kept inside, Escape
      closing it back to its button, a bad link said in the sheet, then where / link / note sent; the Done tab and Not
      posted yet; Take it over… asked first; a ?ready=<id> link opened cold (the push notice's).
   2. A shoot's Files section for marketing (waiting, Open in OneDrive, Check again drawn from its answer) and for the
      photographer (no access to the folders: the line in the link's place; a stopped copy: finish it in DCR Desktop; a
      skipped shoot with files brought back by Mark done…, which the demo's office computer applies: the shoot on the
      Ready list).
   3. The photographer's phone hand-in (OD §3.3), on the phone: a shoot with no files says so with [Add photos and
      videos]; the picker (Chrome's own, intercepted: made-up files of random bytes) takes three; sending shows this
      page's counts, the file in flight's progress and [Cancel it] - [Hand in what's there] once a file of it is in
      OneDrive (review round 3); the page frozen a moment (a
      lock), then hidden with no signal, goes on from where OneDrive was when it is back in front (each file started
      once); all in OneDrive ✓ on OneDrive's own hash of what landed. Then a reload while it sends: the stopped-on-this-
      phone line with [Pick the rest again] / [Hand in what's there] / [Cancel it]; Pick the rest again with the same
      files - the one already in OneDrive hashed and skipped, the rest sent - and the same hand-in sealed. Then (the
      OneDrive review's round 1, OD §3.3 step 8) Cancel it and Hand in what's there while it sends ASK first, Keep it
      focused: Enter and Escape keep the hand-in going; Cancel it from the question cancels it (nothing in OneDrive yet:
      no Hand in what's there); with a photo in, Hand in what's there asks with that one file and hands it in.
   4. The admin on a desk: a marketing member's Microsoft account changed on the Access tab is saved - the field's label
      and tip the contract's - and nothing is shared by itself (the office shares by hand, OD §8.1).
   Every screen audited: no sideways scroll at 375 px, tap targets (40 px phone, 24 px desk), WCAG AA contrast light and
   dark, the focus shown on every Tab stop; no Content-Security-Policy violation, no console error.
   Screenshots: files_<who>_<what>_<light|dark>_<phone|desktop>.png into --out. Made-up data only. Prints a JSON summary;
   exit code 1 when a check failed. */
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";
import { pageHelpers } from "./e2e-p10-photo.mjs";
import { WORDS } from "../site/js/map/photo-words.js";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p10-photo-files")));
const SHOTS = arg("--shots", "all");

/** The walk's helpers over one browser (the demo's or PGlite's sign-in is the caller's). */
export function walkHelpers(o) {
  const { check, shotPrefix } = o;
  let shots = 0;
  const text = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); return n ? n.textContent : ''; })()");
  const clickSel = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); if (n) n.click(); return !!n; })()");
  const focusSel = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); if (n) n.focus(); return !!n && document.activeElement === n; })()");
  const noSideways = (p) => p.eval("document.documentElement.scrollWidth <= innerWidth + 1");
  async function key(p, k, shift) {
    const codes = { Tab: 9, Enter: 13, Escape: 27 };
    const ev = { key: k, code: k, windowsVirtualKeyCode: codes[k], nativeVirtualKeyCode: codes[k], modifiers: shift ? 8 : 0 };
    await p.call("Input.dispatchKeyEvent", Object.assign({ type: k === "Enter" ? "keyDown" : "rawKeyDown" }, ev, k === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}));
    await p.call("Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, ev));
    await sleep(60);
  }
  async function tabWalk(p, scope, n, shift) {
    const stops = [];
    for (let i = 0; i < n; i++) { await key(p, "Tab", shift); stops.push(await p.eval("__focusNow(" + JSON.stringify(scope) + ")")); }
    return stops;
  }
  async function audit(p, label, scope, phone) {
    if (phone) check(label + ": no page scrolls sideways at 375 px", await noSideways(p), await p.eval("document.documentElement.scrollWidth + ' > ' + innerWidth"));
    const t = await p.eval("__targets(" + JSON.stringify(scope) + ", " + (phone ? 40 : 24) + ")");
    check(label + ": every control is a tap target of at least " + (phone ? "40" : "24") + " px (" + t.n + ")", t.n > 0 && !t.bad.length, t.bad.slice(0, 8));
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
  async function focusShown(p, label, scope, first, n) {
    if (first) await focusSel(p, first);
    const stops = await tabWalk(p, scope, n);
    const hidden = stops.filter((s) => !s.none && s.inside && !s.visible);
    check(label + ": the keyboard's focus shows on every stop (" + stops.filter((s) => s.inside).length + " stops)", stops.some((s) => s.inside) && !hidden.length,
      hidden.map((s) => s.el).slice(0, 6));
  }
  async function sheetKeys(p, label, opener) {
    const fwd = await tabWalk(p, "#shMo", 16);
    const back = await tabWalk(p, "#shMo", 5, true);
    const out = fwd.concat(back).filter((s) => !s.inside);
    check(label + ": Tab and Shift+Tab stay inside the sheet", !out.length, out.map((s) => s.el).slice(0, 4));
    const hidden = fwd.concat(back).filter((s) => s.inside && !s.visible);
    check(label + ": the focus shows on every stop of the sheet", !hidden.length, hidden.map((s) => s.el).slice(0, 6));
    await key(p, "Escape");
    await p.until("!document.getElementById('shMo')", 4000);
    const b = await p.eval("(() => { const a = document.activeElement; return a ? __describe(a) + '|' + (a.matches(" + JSON.stringify(opener) + ") ? 'y' : 'n') : 'none'; })()");
    check(label + ": Escape closes it and the focus is back on the button that opened it", /\|y$/.test(b), b);
  }
  async function shot(p, name, device, dark) {
    if (SHOTS === "none" || (SHOTS === "some" && dark)) return;
    await p.dark(dark);
    await sleep(250);
    await p.shot(shotPrefix + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png");
    shots += 1;
    await p.dark(false);
  }
  const shots2 = async (p, name, device) => { await shot(p, name, device, false); await shot(p, name, device, true); };
  return { text, clickSel, focusSel, key, audit, focusShown, sheetKeys, shot, shots2, noSideways, count: () => shots };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = startServer(0);
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const { cdp, proc } = await launch(arg("--chrome"));
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
  const H = walkHelpers({ check, shotPrefix: "files_" });
  const { text, clickSel, audit, focusShown, sheetKeys, shots2 } = H;
  async function tab(name) {
    const p = await newPage(cdp, name, OUT, true);
    await p.call("Page.addScriptToEvaluateOnNewDocument", { source: "(" + pageHelpers.toString() + ")();" });
    pages.push(p);
    return p;
  }
  const TOPBAR = "!!document.querySelector('.dcr2-topbar .p2-badge')";
  async function signIn(p, who, next) {
    await p.goto(base + "/manifest.json", 50);
    await p.eval("['dcr2-auth','dcr2-auth-profile'].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); }); sessionStorage.removeItem('dcr2-auth-mode'); true");
    await p.goto(base + "/index.html?next=" + encodeURIComponent(next || "dashboard.html"), 150);
    await p.until("!!document.getElementById('loginForm') && !!window.DCR2Demo && !document.getElementById('loginFields').disabled", 8000);
    await p.eval("document.getElementById('email').value=" + JSON.stringify(who + "@demo.test") + ";document.getElementById('password').value='demo-password-1';" +
      "document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname) && " + TOPBAR, 10000);
  }
  async function open(p, pathname, marker) {
    await p.goto(base + pathname, 150);
    await p.until(TOPBAR + (marker ? " && (" + marker + ")" : ""), 15000);
  }
  const db = (p, expr) => p.eval("(() => { const R = DCR2Demo.engine.rows; return " + expr + "; })()");
  const dev = (p, expr) => p.eval("(() => { const D = DCR2Demo.engine.exts.find((x) => x.name === 'p10-photo-files').__dev; return " + expr + "; })()");
  const shootId = (p, code, key) => db(p, "(() => { const pl = R.photo_plans.find((x) => x.project_code === " + JSON.stringify(code) + "); return R.photo_shoots.find((s) => s.plan_id === pl.id && s.key === " +
    JSON.stringify(key) + ").id; })()");
  const READY = "document.querySelectorAll('#shList .sh-rrow').length > 0";
  const FILES = "!!document.querySelector('#shDScroll .sh-flines')";
  const lines = (p) => p.eval("Array.from(document.querySelectorAll('#shDScroll .sh-fl')).map((n) => n.getAttribute('data-line')).join(',')");

  try {
    for (const phone of [true, false]) {
      const W = phone ? "phone" : "desk";
      const device = phone ? "phone" : "desktop";
      /* ── 1. marketing ── */
      const mk = await tab("marketing-" + W);
      await mk.size(phone ? 375 : 1440, phone ? 812 : 900, phone);
      await attempt(W + ": marketing - Home's card, the Ready view first, a card, I'm on it, Posted… (keys, a bad link, sent), the Done tab, Not posted yet, Take it over…", async () => {
        await signIn(mk, "viewer");
        await mk.until("!!document.querySelector('#hmShoots .hm-badge')", 8000);
        const badge = await text(mk, "#hmShoots .hm-badge");
        check(W + ": Home's card - '" + badge + "' and the link to the Ready view", badge === "1 ready for marketing" &&
          (await mk.eval("document.querySelector('#hmShoots a.hm-card-go').getAttribute('href')")) === "shoots.html?view=ready");
        await open(mk, "/shoots.html", READY);
        check(W + ": the first view of someone only on marketing is Ready for marketing",
          await mk.eval("document.querySelector('#shViews [data-view=ready]').getAttribute('aria-pressed') === 'true' && /view=ready/.test(location.search)"));
        const tabN = await text(mk, "#shList [data-act=ready-tab][data-tab=open] .sh-n");
        check(W + ": the Ready tab says Home's number (" + tabN + ") - never the card someone else is on", tabN === badge.split(" ")[0], tabN + " | " + badge);
        await audit(mk, W + " the Ready list", "#shRoot", phone);
        await focusShown(mk, W + " the Ready list", "#shRoot", "#shViews [data-view=agenda]", 8);
        await shots2(mk, "marketing_ready_list", device);
        const id = Number(await mk.eval("document.querySelector('#shList .sh-rrow').getAttribute('data-ready')"));
        await clickSel(mk, "#shList .sh-rrow");
        await mk.until("!!document.querySelector('#shDScroll [data-act=r-claim]')", 5000);
        await audit(mk, W + " a Ready card", "#shDetail", phone);
        // beside Open in OneDrive, how to open it - never sync the whole folder (ready.open_tip, OD §8.4; review round 1)
        check(W + ": the card's open tip under its buttons", (await text(mk, "#shDScroll .sh-acts + .sh-rtip[data-tip=open_tip]")) === WORDS.ready.open_tip,
          await text(mk, "#shDScroll .sh-rtip"));
        await shots2(mk, "marketing_ready_card", device);
        await clickSel(mk, "#shDScroll [data-act=r-claim]");
        await mk.until("/You're on it/.test(document.getElementById('shDScroll').textContent)", 5000);
        check(W + ": I'm on it - the database's row claimed by Taylor", (await db(mk, "R.photo_marketing.find((m) => m.id === " + id + ").state")) === "claimed");
        await clickSel(mk, "#shDScroll [data-act=r-posted]");
        await mk.until("!!document.getElementById('shMo')", 4000);
        await audit(mk, W + " the Posted… sheet", "#shMo", phone);
        const gaps = await mk.eval("Array.from(document.querySelectorAll('#shMo .mv-lab, #shMo legend')).map((l) => { const p = l.tagName === 'LEGEND' ? null : l.previousElementSibling;" +
          " return p ? Math.round(l.getBoundingClientRect().top - p.getBoundingClientRect().bottom) : null; }).filter((g) => g !== null)");
        check(W + ": the Posted… sheet - each label sits clear of the field above it (" + gaps.join(", ") + " px)", gaps.length >= 2 && gaps.every((g) => g >= 10), gaps);
        await shots2(mk, "marketing_posted_sheet", device);
        await sheetKeys(mk, W + " the Posted… sheet", "[data-act=r-posted]");
        await clickSel(mk, "#shDScroll [data-act=r-posted]");
        await mk.until("!!document.getElementById('shMo')", 4000);
        await mk.eval("(() => { document.querySelector('#shMo input[value=website]').click(); document.getElementById('rsLink').value = 'http://example.com/x'; document.getElementById('mvApply').click(); return true; })()");
        await mk.until("document.getElementById('mvMsg').textContent.length > 0", 4000);
        check(W + ": a link that is not https is said in the sheet - nothing sent", /must start with https/.test(await text(mk, "#mvMsg")) &&
          (await db(mk, "R.photo_marketing.find((m) => m.id === " + id + ").state")) === "claimed");
        // no signal as Posted is pressed: the sheet stays open with the words in it, the tick, the link and the note kept,
        // and Posted pressed again once the signal is back sends them (P5b review round 10); its words hint.no_answer -
        // press it again, never "ask an admin" (round 12, §45)
        await mk.eval("(() => { DCR2Demo.setOffline(true); document.getElementById('rsLink').value = 'https://www.example.com/p/9'; document.getElementById('rsNote').value = 'Reel of the lot'; document.getElementById('mvApply').click(); return true; })()");
        await mk.until("!!document.getElementById('mvMsg') && document.getElementById('mvMsg').textContent === " + JSON.stringify(WORDS.hint.no_answer) + " && !document.getElementById('mvApply').disabled", 8000);
        const kept = await mk.eval("(() => [!!document.getElementById('shMo'), document.querySelector('#shMo input[value=website]').checked, document.getElementById('rsLink').value, document.getElementById('rsNote').value])()");
        check(W + ": Posted with no signal - the sheet stays open, the words in it, the tick, the link and the note kept (round 10)",
          JSON.stringify(kept) === JSON.stringify([true, true, "https://www.example.com/p/9", "Reel of the lot"]) &&
          (await db(mk, "R.photo_marketing.find((m) => m.id === " + id + ").state")) === "claimed", JSON.stringify(kept));
        await shots2(mk, "marketing_posted_no_signal", device);
        await mk.eval("(() => { DCR2Demo.setOffline(false); window.dispatchEvent(new Event('online')); document.getElementById('mvApply').click(); return true; })()");
        await mk.until("!document.getElementById('shMo')", 5000);
        check(W + ": Posted - where, the link and the note in the database", JSON.stringify(await db(mk, "(() => { const m = R.photo_marketing.find((x) => x.id === " + id + "); return [m.state, m.posted_where, m.posted_link, m.posted_note]; })()")) ===
          JSON.stringify(["posted", ["website"], "https://www.example.com/p/9", "Reel of the lot"]));
        await clickSel(mk, "#shList [data-act=ready-tab][data-tab=done]");
        await mk.until("!!document.querySelector('#shList [data-ready=\"" + id + "\"]')", 5000);
        await clickSel(mk, "#shList [data-ready=\"" + id + "\"]");
        await mk.until("!!document.querySelector('#shDScroll [data-act=r-reopen]')", 5000);
        await audit(mk, W + " the Done tab's card", "#shRoot", phone);
        await shots2(mk, "marketing_done_card", device);
        // Not posted yet clears where it was posted, its link and the note: asked first, Keep it focused (v14, §37)
        await clickSel(mk, "#shDScroll [data-act=r-reopen]");
        await mk.until("!!document.getElementById('shMo')", 4000);
        const reAsk = await text(mk, "#shMo [data-ask=reopen_ask]");
        check(W + ": Not posted yet asks first - where it was posted, its link and the note are cleared", reAsk === WORDS.ready.reopen_ask, reAsk.slice(0, 200));
        const reFocus = await mk.eval("(() => { const a = document.activeElement; return !!a && a.matches('#shMo .sh-mo-ft [data-act=mv-close]') && a.textContent === " + JSON.stringify(WORDS.copy.cancel_keep) + "; })()");
        check(W + ": Keep it has the focus - Enter keeps it", reFocus === true);
        await audit(mk, W + " the Not posted yet question", "#shMo", phone);
        await shots2(mk, "marketing_reopen_ask", device);
        await sheetKeys(mk, W + " the Not posted yet question", "[data-act=r-reopen]");
        check(W + ": Escape keeps it - still posted", (await db(mk, "R.photo_marketing.find((m) => m.id === " + id + ").state")) === "posted");
        await clickSel(mk, "#shDScroll [data-act=r-reopen]");
        await mk.until("!!document.getElementById('mvApply')", 4000);
        await clickSel(mk, "#mvApply");
        await mk.until("DCR2Demo.engine.rows.photo_marketing.find((m) => m.id === " + id + ").state === 'claimed'", 5000);
        check(W + ": Not posted yet - claimed by Taylor again", true);
        // the row turns claimed inside the act; the sheet closes only after the list is read again, taking its own
        // history entry off (closeSheet's history.back()). The phone's Back is pressed once that is done - never racing
        // it (a Back landing first closes the sheet only, two at once lose one to skipPop; R5) - then waited for.
        await mk.until("!document.getElementById('shMo') && !(history.state && history.state.sheet)", 5000);
        if (phone) {
          await mk.eval("history.back(); true");
          let shut = "";
          try { await mk.until("!document.getElementById('shDetail').classList.contains('open')", 4000); shut = "closed"; } catch (e) { shut = String(e.message || e); }
          check(W + ": the phone's Back closes the card", shut === "closed", shut);
        }
        // Take it over…: asked first (the site's own dialog), then claimed with p_take_over
        await open(mk, "/shoots.html?view=ready", READY);
        const other = Number(await db(mk, "R.photo_marketing.find((m) => m.state === 'claimed' && R.profiles.find((p) => p.id === m.claimed_by).full_name === 'Avery Admin').id"));
        await clickSel(mk, "#shList [data-ready=\"" + other + "\"]");
        await mk.until("!!document.querySelector('#shDScroll [data-act=r-take-over]')", 5000);
        await clickSel(mk, "#shDScroll [data-act=r-take-over]");
        await mk.until("!!document.getElementById('shMo')", 4000);
        const ask = await text(mk, "#shMo [data-ask=take_over]");
        check(W + ": Take it over… asks first in a sheet, naming who and since when", /^Avery has been on it since .+\. Take it over\?$/.test(ask), ask.slice(0, 200));
        await audit(mk, W + " the Take it over sheet", "#shMo", phone);
        await sheetKeys(mk, W + " the Take it over sheet", "[data-act=r-take-over]");
        await clickSel(mk, "#shDScroll [data-act=r-take-over]");
        await mk.until("!!document.getElementById('mvApply')", 4000);
        await clickSel(mk, "#mvApply");
        await mk.until("DCR2Demo.engine.rows.photo_marketing.find((m) => m.id === " + other + ").claimed_by !== DCR2Demo.engine.rows.profiles.find((p) => p.full_name === 'Avery Admin').id", 5000);
        check(W + ": taken over", true);
        // a phone's sheet took its own history entry off as it closed (history.back() runs later): the next walk's
        // navigation must not race that Back onto this page's ?ready=<other>
        await mk.until("!document.getElementById('shMo') && !(history.state && history.state.sheet)", 4000);
      }, mk);

      await attempt(W + ": a ?ready=<id> link opened cold (the push notice's) shows that card", async () => {
        const posted = Number(await db(mk, "R.photo_marketing.find((m) => m.state === 'passed').id"));
        await open(mk, "/shoots.html?ready=" + posted, "location.search === '?ready=" + posted + "' && !!document.querySelector('#shDScroll .sh-dtitle')");
        const got = [await text(mk, "#shDScroll"), await mk.eval("(() => { const t = document.querySelector('#shList [data-tab=done]'); return t ? t.getAttribute('aria-selected') : 'none'; })()")];
        check(W + ": the card of the link, in its tab (Done)", /Not for posting/.test(got[0]) && got[1] === "true", got.join(" | ").slice(0, 300));
      }, mk);

      /* ── 2. a shoot's Files section ── */
      await attempt(W + ": marketing - a shoot's Files section (waiting, Open in OneDrive, Check again)", async () => {
        const s = await shootId(mk, "A000T9", "lot-before");
        await open(mk, "/shoots.html?shoot=" + s, FILES);
        check(W + ": waiting - its words and Open in OneDrive (the folder's link, a new tab)", (await lines(mk)) === "waiting" &&
          (await mk.eval("(() => { const a = document.querySelector('#shDScroll [data-act=open-folder]'); return !!a && a.target === '_blank' && /^https:\\/\\/example-my\\.sharepoint\\.com\\/personal\\/office_example_com\\//.test(a.href) && a.textContent === " +
            JSON.stringify(WORDS.files_buttons.open_onedrive) + "; })()")));
        await audit(mk, W + " the Files section (marketing)", "#shDetail", phone);
        await shots2(mk, "marketing_files_uploading", device);
        await clickSel(mk, "#shDScroll [data-act=files-check]");
        await mk.until("document.querySelector('#shDScroll .sh-fl') && document.querySelector('#shDScroll .sh-fl').getAttribute('data-line') === 'confirmed'", 8000);
        check(W + ": Check again - its answer drawn: all in OneDrive, mark the shoot done", /All 300 files are in OneDrive ✓/.test(await text(mk, "#shDScroll")) &&
          /mark the shoot done to send it to marketing/.test(await text(mk, "#shDScroll")));
        await shots2(mk, "marketing_files_confirmed", device);
      }, mk);

      const ph = await tab("photographer-" + W);
      await ph.size(phone ? 375 : 1440, phone ? 812 : 900, phone);
      await attempt(W + ": the photographer - no access to the folders, a stopped copy, a skipped shoot with files brought back by Mark done…", async () => {
        await signIn(ph, "field");
        const late = await shootId(ph, "A000T9", "delivery");
        await open(ph, "/shoots.html?shoot=" + late, FILES);
        check(W + ": no progress for 2 hours, the help chip, the access line in the link's place", (await lines(ph)) === "late,no_access" &&
          (await text(ph, "#shDScroll .sh-chip.need")) === "Upload not moving" && !(await ph.eval("!!document.querySelector('#shDScroll [data-act=open-folder]')")));
        await audit(ph, W + " the Files section (late)", "#shDetail", phone);
        await shots2(ph, "photographer_files_late", device);
        const stopped = await shootId(ph, "A000T9", "progress-2");
        await open(ph, "/shoots.html?shoot=" + stopped, FILES);
        check(W + ": a stopped copy: finish it in DCR Desktop", /^stopped,stopped_phone/.test(await lines(ph)));
        await shots2(ph, "photographer_files_stopped", device);
        const problem = await shootId(ph, "A000T9", "before-framing");
        await open(ph, "/shoots.html?shoot=" + problem, FILES);
        await audit(ph, W + " the Files section (problems)", "#shDetail", phone);
        await shots2(ph, "photographer_files_problem", device);
        const sk = await shootId(ph, "A000T8", "progress-2");
        await open(ph, "/shoots.html?shoot=" + sk, FILES + " && !!document.querySelector('#shDScroll [data-act=done]')");
        check(W + ": a skipped shoot with files: its line and Mark done…", /marked skipped, but its files are in OneDrive/.test(await text(ph, "#shDScroll")));
        await shots2(ph, "photographer_files_skipped", device);
        await clickSel(ph, "#shDScroll [data-act=done]");
        await ph.until("!!document.getElementById('shMo')", 4000);
        check(W + ": the Mark done sheet says what bringing it back does", /This marks the skipped shoot done and sends its files to marketing/.test(await text(ph, "#shMo")));
        await audit(ph, W + " the bring-back sheet", "#shMo", phone);
        // the office computer held for a moment: the Mark done waiting says so, and no second Mark done… (v14, §37)
        const officePc = "DCR2Demo.engine.exts.find((x) => x.name === 'p10-photo').__dev.pc";
        await ph.eval("(() => { " + officePc + ".state({ auto: false }); return true; })()");
        await clickSel(ph, "#mvApply");
        await ph.until("!!document.querySelector('#shDScroll [data-completion=done_sent]')", 8000);
        check(W + ": a Mark done waiting for the office computer says so - never 'mark it done' beside it, no second Mark done…",
          (await text(ph, "#shDScroll [data-completion=done_sent]")) === WORDS.completion.done_sent &&
          !(await ph.eval("!!document.querySelector('#shDScroll [data-act=done]')")) && !/mark it done to bring it back/.test(await text(ph, "#shDScroll")));
        await audit(ph, W + " the Files section (Mark done waiting)", "#shDetail", phone);
        await shots2(ph, "photographer_files_done_sent", device);
        await ph.eval("(() => { " + officePc + ".state({ auto: true }); " + officePc + ".run(); return true; })()");
        await ph.until("DCR2Demo.engine.rows.photo_shoots.find((s) => s.id === " + sk + ").status === 'done'", 15000);
        await ph.until("DCR2Demo.engine.rows.photo_marketing.some((m) => m.shoot_id === " + sk + " && m.state === 'ready')", 8000);
        check(W + ": the office computer brought it back - on the Ready list once", (await db(ph, "R.photo_marketing.filter((m) => m.shoot_id === " + sk + ").length")) === 1);
        await ph.until("/Sent to marketing/.test(document.getElementById('shDScroll').textContent)", 25000);
        check(W + ": the sheet reads it again: Sent to marketing", true);
      }, ph);
    }


    /* ── 3. the photographer's phone hand-in (OD §3.3; the build plan's P5 and P7): pick, send, a frozen page, a hidden
       page with no signal, resume, a reload, Pick the rest again ── */
    const pp = await tab("photographer-phone-send");
    await pp.size(375, 812, true);
    await pp.call("Page.setInterceptFileChooserDialog", { enabled: true });
    // made-up files on disk for the picker (random bytes: nothing real)
    const pickDir = join(OUT, "phone-files");
    mkdirSync(pickDir, { recursive: true });
    const made = (name, size) => { const f = join(pickDir, name); writeFileSync(f, randomBytes(size)); return f; };
    const VIDEO = 15 * 1024 * 1024;              // three 5 MiB chunks: the lock and the lost signal come while it goes up
    const walk1 = [made("IMG_0001.JPG", 900 * 1024), made("IMG_0002.HEIC", 1536 * 1024), made("C0001.MP4", VIDEO)];
    const walk2 = [made("IMG_0101.JPG", 1024 * 1024), made("C0101.MP4", 8 * 1024 * 1024), made("C0102.MP4", 6 * 1024 * 1024)];
    // the picker: Add photos and videos (or Pick the rest again) opens it; the files are handed to it as a phone would
    async function pick(p, sel, paths) {
      const opened = new Promise((resolve) => {
        const h = (m) => { if (m.sessionId === p.s && m.method === "Page.fileChooserOpened") { cdp.handlers.delete(h); resolve(m.params); } };
        cdp.handlers.add(h);
      });
      // (a tap: the picker opens only from a user's gesture)
      await p.call("Runtime.evaluate", { expression: "(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); if (n) n.click(); return !!n; })()",
        userGesture: true, awaitPromise: true, returnByValue: true });
      const ev = await Promise.race([opened, sleep(5000).then(() => null)]);
      if (!ev) throw new Error("the picker did not open from " + sel);
      await p.call("DOM.setFileInputFiles", { files: paths, backendNodeId: ev.backendNodeId });
      return ev;
    }
    // a leave-page question while it sends is answered "leave" (a reload of the walk)
    cdp.handlers.add((m) => { if (m.sessionId === pp.s && m.method === "Page.javascriptDialogOpening") pp.call("Page.handleJavaScriptDialog", { accept: true }).catch(() => {}); });
    const puts = (p) => p.eval("(window.__puts || []).slice()");
    const logPuts = (p) => p.eval("(() => { const x = DCR2Demo.engine.exts.find((e) => e.name === 'p7-onedrive'); if (x.__logged) return true; x.__logged = true; const h = x.http;" +
      " x.http = (m, u, hd, b) => { if (m === 'PUT') (window.__puts = window.__puts || []).push(hd['content-range'] || hd['Content-Range'] || ''); return h(m, u, hd, b); }; return true; })()");
    const bare = (p, n) => db(p, "R.photo_shoots.filter((s) => s.status === 'planned' && !R.photo_drive_folders.some((f) => f.shoot_id === s.id))[" + n + "].id");
    const acts = (p) => p.eval("Array.from(document.querySelectorAll('#shDScroll .sh-facts-b [data-act]')).map((n) => n.getAttribute('data-act')).join(',')");
    await attempt("phone: the photographer adds photos and videos - picked, sent with progress, a frozen page and a hidden page with no signal go on where they were, all in OneDrive ✓", async () => {
      await signIn(pp, "field");
      await pp.eval("localStorage.setItem('dcr2-demo-photo-phone', 'on'); true");
      const sid = await bare(pp, 0);
      await open(pp, "/shoots.html?shoot=" + sid, FILES);
      check("phone: a shoot with no files yet - add them from this phone (none_add_phone) and the button", (await lines(pp)) === "none_add_phone" &&
        (await text(pp, "#shDScroll [data-act=files-add-phone]")) === WORDS.files_buttons.add_phone, await lines(pp));
      await audit(pp, "phone the Files section (add from the phone)", "#shDetail", true);
      await shots2(pp, "photographer_phone_add", "phone");
      await logPuts(pp);
      const ev = await pick(pp, "#shDScroll [data-act=files-add-phone]", walk1);
      check("phone: the picker takes many photos and videos (HEIC named)", ev.mode === "selectMultiple" &&
        (await pp.eval("document.getElementById('shPick').getAttribute('accept')")) === "image/*,video/*,image/heic,image/heif", ev.mode);
      await pp.until("(document.querySelector('#shDScroll .sh-fl') || {}).getAttribute && document.querySelector('#shDScroll .sh-fl').getAttribute('data-line') === 'sending_this_phone' && !!document.querySelector('#shDScroll .sh-fprog')", 15000);
      // (the line and the buttons of one drawing: Hand in what's there once a file of it is in OneDrive - OD §3.3 step 8,
      // review round 3 -, Cancel it always)
      const sendingNow = await pp.eval("[(document.querySelector('#shDScroll [data-line=sending_this_phone]') || {}).textContent || '', " +
        "Array.from(document.querySelectorAll('#shDScroll .sh-facts-b [data-act]')).map((n) => n.getAttribute('data-act')).join(',')]");
      const inNow = (/^Sending (\d) of 3 /.exec(sendingNow[0]) || [])[1];
      check("phone: sending - this page's counts, keep the screen on, the file in flight and its progress, Cancel it - Hand in what's there once a file is in (no Stop)",
        /^Sending \d of 3 files to OneDrive - keep this screen on and this page open until it's done\.$/.test(sendingNow[0]) &&
        (inNow === "0" ? /^files-cancel/.test(sendingNow[1]) && !/files-hand-in/.test(sendingNow[1]) : /^files-hand-in,files-cancel/.test(sendingNow[1])), JSON.stringify(sendingNow));
      await audit(pp, "phone the Files section (sending)", "#shDetail", true);
      await shots2(pp, "photographer_phone_sending", "phone");
      // the video's first chunk in OneDrive: the phone locks for a moment - the page's JavaScript stops, then goes on
      await pp.until("(window.__puts || []).some((r) => r.endsWith('/" + VIDEO + "'))", 30000);
      await pp.call("Page.setWebLifecycleState", { state: "frozen" });
      await sleep(1500);
      await pp.call("Page.setWebLifecycleState", { state: "active" });
      // hidden, and no signal: the chunk in flight is lost, nothing else; back in front with signal it goes on by itself
      await pp.eval("(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); DCR2Demo.setOffline(true); return true; })()");
      await sleep(3500);
      const during = await lines(pp);
      const before = (await puts(pp)).filter((r) => r.endsWith("/" + VIDEO));
      check("phone: the video was still going up when the signal went (" + before.length + " of its 3 chunks in)", before.length >= 1 && before.length < 3, before.join(" "));
      await shots2(pp, "photographer_phone_no_signal", "phone");
      await pp.eval("(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); DCR2Demo.setOffline(false); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); return true; })()");
      await pp.until("(document.querySelector('#shDScroll .sh-fl') || {}).getAttribute && document.querySelector('#shDScroll .sh-fl').getAttribute('data-line') === 'confirmed'", 60000);
      check("phone: all 3 files are in OneDrive ✓ (said once), more can be added", /^All 3 files are in OneDrive ✓ \(checked /.test(await text(pp, "#shDScroll [data-line=confirmed]")) &&
        (await pp.eval("Array.from(document.querySelectorAll('#shDScroll .sh-fl')).filter((n) => /are in OneDrive ✓/.test(n.textContent)).length")) === 1 &&
        /files-add-phone/.test(await acts(pp)), during + " | " + await acts(pp));
      const log = await puts(pp);
      const starts = log.filter((r) => /^bytes 0-/.test(r)).map((r) => r.split("/")[1]);
      const video = log.filter((r) => r.endsWith("/" + VIDEO));
      check("phone: each file started once - the frozen and the hidden page went on from where OneDrive was (" + log.length + " chunks; the video's " + video.length + ")",
        starts.length === 3 && new Set(starts).size === 3 && video.length === 3, log.join(" "));
      const rows = await dev(pp, "D.files(" + sid + ").map((r) => [r.path, r.state, r.counted, r.md5])");
      const items = await dev(pp, "D.items(" + sid + ").map((x) => [x.path, x.qx])");
      check("phone: the rows are the phone's (Phone/<name>), confirmed on OneDrive's own hash of what landed",
        rows.length === 3 && rows.every((r) => /^Phone\//.test(r[0]) && r[1] === "confirmed" && r[2] === true && r[3] === (items.find((x) => x[0] === r[0]) || [])[1]),
        JSON.stringify(rows));
      await audit(pp, "phone the Files section (all in OneDrive)", "#shDetail", true);
      await shots2(pp, "photographer_phone_done", "phone");
    }, pp);

    let walked = null;                        // (the reload walk's shoot: the asks below add to it - the demo has two bare shoots)
    await attempt("phone: a reload while it sends - the stopped-on-this-phone choices; Pick the rest again with the same files: the one in OneDrive skipped, the rest sent, all in OneDrive ✓", async () => {
      const sid = await bare(pp, 0);
      walked = sid;
      await open(pp, "/shoots.html?shoot=" + sid, FILES);
      await logPuts(pp);
      await pick(pp, "#shDScroll [data-act=files-add-phone]", walk2);
      // the first file in OneDrive, the second on its way: the page is reloaded
      await pp.until("DCR2Demo.engine.exts.find((x) => x.name === 'p10-photo-files').__dev.files(" + sid + ").some((r) => r.state === 'confirmed') && (window.__puts || []).some((r) => /\\/" + (8 * 1024 * 1024) + "$/.test(r))", 30000);
      await open(pp, "/shoots.html?shoot=" + sid, FILES);
      await pp.until("/^stopped_this_phone/.test(Array.from(document.querySelectorAll('#shDScroll .sh-fl')).map((n) => n.getAttribute('data-line')).join(','))", 10000);
      check("phone: after the reload - your upload from this phone stopped, Pick the rest again, Hand in what's there, Cancel it",
        /^Your upload from this phone stopped at 1 of 3 files\.$/.test(await text(pp, "#shDScroll [data-line=stopped_this_phone]")) &&
        /^files-pick-rest,files-hand-in,files-cancel/.test(await acts(pp)), (await lines(pp)) + " | " + (await acts(pp)) + " | " + await text(pp, "#shDScroll [data-line=stopped_this_phone]"));
      await audit(pp, "phone the Files section (stopped on this phone)", "#shDetail", true);
      await shots2(pp, "photographer_phone_stopped", "phone");
      await logPuts(pp);
      await pick(pp, "#shDScroll [data-act=files-pick-rest]", walk2);
      await pp.until("(document.querySelector('#shDScroll .sh-fl') || {}).getAttribute && document.querySelector('#shDScroll .sh-fl').getAttribute('data-line') === 'confirmed'", 60000);
      const log = await puts(pp);
      const sent = new Set(log.map((r) => r.split("/")[1]));
      check("phone: Pick the rest again - the file already in OneDrive was hashed and skipped, the two others sent; all 3 files in OneDrive ✓",
        /^All 3 files are in OneDrive ✓/.test(await text(pp, "#shDScroll [data-line=confirmed]")) && !sent.has(String(1024 * 1024)) && sent.has(String(6 * 1024 * 1024)),
        Array.from(sent).join(", "));
      check("phone: one hand-in, opened again by its key after the reload", (await db(pp, "R.photo_shoot_uploads.filter((u) => u.shoot_id === " + sid + ").map((u) => u.state).join(',')")) === "sealed");
      await shots2(pp, "photographer_phone_rest_done", "phone");
    }, pp);

    await attempt("phone: while it sends, Cancel it and Hand in what's there ask first - Keep it focused, Enter and Escape keep it going; Cancel it from the question cancels it", async () => {
      // (more files for the shoot of the walk above, all of it in OneDrive: Add photos and videos begins a second hand-in)
      const sid = walked;
      await open(pp, "/shoots.html?shoot=" + sid, FILES + " && /files-add-phone/.test(Array.from(document.querySelectorAll('#shDScroll [data-act]')).map((n) => n.getAttribute('data-act')).join(','))");
      await logPuts(pp);
      await pick(pp, "#shDScroll [data-act=files-add-phone]", [made("C0901.MP4", 30 * 1024 * 1024)]);
      // the signal goes as its first chunk leaves: it keeps sending (waiting for the internet), nothing of it in yet
      try { await pp.until("(window.__puts || []).some((r) => /\\/" + (30 * 1024 * 1024) + "$/.test(r))", 60000); } catch (e) {
        throw new Error(e.message + " | lines " + (await lines(pp)) + " | " + (await text(pp, "#shDScroll .sh-flines")) + " | puts " + JSON.stringify(await puts(pp)).slice(0, 300));
      }
      await pp.eval("(() => { DCR2Demo.setOffline(true); return true; })()");
      const upState = () => db(pp, "(R.photo_shoot_uploads.filter((u) => u.shoot_id === " + sid + ").pop() || {}).state");
      await clickSel(pp, "#shDScroll [data-act=files-cancel]");
      await pp.until("!!document.getElementById('shMo')", 4000);
      const ask = await pp.eval("(() => { const k = document.querySelector('#shMo .sh-mo-ft [data-act=mv-close]'); const a = document.querySelector('#shMo [data-ask]');" +
        " return [a && a.getAttribute('data-ask'), a && a.textContent, k && k.textContent, document.activeElement === k, document.getElementById('mvApply').textContent]; })()");
      check("phone: Cancel it asks first - the phone's words, Keep it focused", JSON.stringify(ask) === JSON.stringify(["cancel_ask_phone", WORDS.copy.cancel_ask_phone,
        WORDS.copy.cancel_keep, true, WORDS.files_buttons.cancel_copy]), JSON.stringify(ask));
      await audit(pp, "phone the Cancel it question", "#shMo", true);
      await shots2(pp, "photographer_phone_cancel_ask", "phone");
      await H.key(pp, "Enter");
      await pp.until("!document.getElementById('shMo')", 4000);
      // nothing of it in OneDrive yet: Cancel it alone - never "Hand in the 0 files…" (OD §3.3 step 8, review round 3)
      check("phone: Enter keeps it - the question closed, the hand-in still open and sending; nothing in OneDrive yet, so no Hand in what's there",
        (await upState()) === "open" && /^files-cancel/.test(await acts(pp)) && !/files-hand-in/.test(await acts(pp)), (await upState()) + " | " + (await acts(pp)));
      await clickSel(pp, "#shDScroll [data-act=files-cancel]");
      await pp.until("!!document.getElementById('mvApply')", 4000);
      await clickSel(pp, "#mvApply");
      await pp.eval("(() => { DCR2Demo.setOffline(false); window.dispatchEvent(new Event('online')); return true; })()");
      await pp.until("DCR2Demo.engine.rows.photo_shoot_uploads.filter((u) => u.shoot_id === " + sid + ").pop().state === 'cancelled'", 15000);
      await pp.until("(document.querySelector('#shDScroll .sh-fl') || {}).getAttribute && document.querySelector('#shDScroll .sh-fl').getAttribute('data-line') === 'confirmed'", 10000);
      check("phone: Cancel it from the question - cancelled: the shoot's 3 files as they were, Add photos and videos back",
        /^All 3 files are in OneDrive ✓/.test(await text(pp, "#shDScroll [data-line=confirmed]")) && /files-add-phone/.test(await acts(pp)), await acts(pp));
      // a photo and a video: the photo in OneDrive, the signal gone as the video's first chunk leaves - Hand in what's there
      // asks first with the one file in, Escape keeps it, then it hands in that one
      await open(pp, "/shoots.html?shoot=" + sid, FILES + " && /files-add-phone/.test(Array.from(document.querySelectorAll('#shDScroll [data-act]')).map((n) => n.getAttribute('data-act')).join(','))");
      await logPuts(pp);
      await pick(pp, "#shDScroll [data-act=files-add-phone]", [made("IMG_0902.JPG", 700 * 1024), made("C0903.MP4", 30 * 1024 * 1024 + 7)]);
      await pp.until("(window.__puts || []).some((r) => /\\/" + (30 * 1024 * 1024 + 7) + "$/.test(r))", 60000);
      await pp.eval("(() => { DCR2Demo.setOffline(true); return true; })()");
      await pp.until("/^files-hand-in,files-cancel/.test(Array.from(document.querySelectorAll('#shDScroll .sh-facts-b [data-act]')).map((n) => n.getAttribute('data-act')).join(','))", 10000);
      await clickSel(pp, "#shDScroll [data-act=files-hand-in]");
      await pp.until("!!document.getElementById('shMo')", 4000);
      const ask2 = await pp.eval("(() => { const a = document.querySelector('#shMo [data-ask]'); const k = document.querySelector('#shMo .sh-mo-ft [data-act=mv-close]');" +
        " return [a && a.getAttribute('data-ask'), a && a.textContent, document.activeElement === k]; })()");
      check("phone: Hand in what's there asks first while files are not sent yet ({n}: the files already in OneDrive - the one photo)", ask2[0] === "hand_in_ask_phone" &&
        ask2[1] === WORDS.copy.hand_in_ask_phone_one && ask2[2] === true, JSON.stringify(ask2));
      await shots2(pp, "photographer_phone_hand_in_ask", "phone");
      await H.key(pp, "Escape");
      await pp.until("!document.getElementById('shMo')", 4000);
      check("phone: Escape keeps it too - neither handed in nor cancelled", (await upState()) === "open");
      await clickSel(pp, "#shDScroll [data-act=files-hand-in]");
      await pp.until("!!document.getElementById('mvApply')", 4000);
      await clickSel(pp, "#mvApply");
      await pp.eval("(() => { DCR2Demo.setOffline(false); window.dispatchEvent(new Event('online')); return true; })()");
      await pp.until("DCR2Demo.engine.rows.photo_shoot_uploads.filter((u) => u.shoot_id === " + sid + ").pop().state === 'sealed'", 15000);
      await pp.until("(document.querySelector('#shDScroll .sh-fl') || {}).getAttribute && document.querySelector('#shDScroll .sh-fl').getAttribute('data-line') === 'confirmed'", 10000);
      const handed = await dev(pp, "D.files(" + sid + ").filter((r) => /^Phone\\/(IMG_0902|C0903)/.test(r.path)).map((r) => [r.path, r.state, r.counted])");
      check("phone: Hand in what's there from the question - the photo in OneDrive handed in, the video not sent left out; all 4 files in OneDrive ✓",
        /^All 4 files are in OneDrive ✓/.test(await text(pp, "#shDScroll [data-line=confirmed]")) &&
        JSON.stringify(handed) === JSON.stringify([["Phone/IMG_0902.JPG", "confirmed", true], ["Phone/C0903.MP4", "removed", false]]), JSON.stringify(handed));
    }, pp);

    /* ── 4. the admin: the Access tab's Microsoft account (the office shares by hand, OD §8.1) ── */
    const dk = await tab("admin-desk");
    await dk.size(1440, 900, false);
    await attempt("desk: the admin changes a marketing member's Microsoft account - saved, the field the contract's, nothing shared by itself", async () => {
      await signIn(dk, "admin");
      await open(dk, "/admin.html?tab=access", "document.querySelectorAll('#adPhoto [data-person]').length > 2");
      const before = await dev(dk, "D.log().checks");
      const line = "Array.from(document.querySelectorAll('#adPhoto [data-person]')).find(r => r.querySelector('b').textContent.indexOf('Taylor Viewer') === 0)";
      const field = await dk.eval("(() => { const i = " + line + ".querySelector('[data-ph=googleEmail]'); return i ? [i.getAttribute('title'), i.getAttribute('placeholder')] : []; })()");
      check("the account field's tip and label are the contract's (share.field_tip, share.field_label)", field[0] === WORDS.share.field_tip && field[1] === WORDS.share.field_label,
        JSON.stringify(field));
      await dk.eval("(() => { const r = " + line + "; const i = r.querySelector('[data-ph=googleEmail]'); i.value = 'taylor.new.demo@example.com'; i.dispatchEvent(new Event('input', { bubbles: true })); r.querySelector('[data-phsave]').click(); return true; })()");
      await dk.until("DCR2Demo.engine.rows.photo_team.some(r => r.google_email === 'taylor.new.demo@example.com')", 8000);
      await sleep(400);
      check("nothing of photo-files asked by the save", (await dev(dk, "D.log().checks")) === before);
    }, dk);

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
  console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results: failed.length ? failed : undefined, shots: H.count(), out: OUT }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
