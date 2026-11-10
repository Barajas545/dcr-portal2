#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the shoot schedule (the photographer screen program, P3; DCR Desktop 2 migration
   20261110000100_photo_schedule; the owner's decisions of 2026-11-09), in the DEMO (development only).

     node tools/e2e-p10-photo.mjs [--out <dir>] [--chrome <path>] [--shots all|some|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with the shoot schedule's rules -
   tools/fake/p10-photo.js: the mirror, the change queue, the photo team, and a made-up office computer that takes and
   applies each change a moment after it is asked; nothing goes to Supabase) and drives a local Chrome or Edge headless.

   0. Every person, on a phone (375x812, touch) and on a desk (1440x900), light and dark - each in a browser context of
      its own (a fresh demo database): the admin, the photographer, a marketing member and a lead who is on no team.
      Home's 📷 card and the top bar's entry for the first three, neither for the lead, whom shoots.html tells plainly
      that it is not for their account (no list, no action). On every screen of each - the Agenda, a shoot, Move… with
      its preview, Mark done…, Month, By job, the Access tab's Photo team - the page is audited:
      * no page scrolls sideways at 375 px;
      * every control is a tap target of at least 40 x 40 px on the phone (24 px on the desk: a mouse);
      * every text reaches WCAG AA contrast against what is behind it (4.5:1, 3:1 for large text), light and dark;
      * every control the keyboard reaches shows where the focus is (real Tab key presses);
      * the sheets keep the keyboard inside them (Tab and Shift+Tab go round), close with Escape and give the focus
        back to the button that opened them; a shoot open full screen on the phone closes with Escape back to its row.
   1. The photographer (Jordan) on a phone: the Agenda; a shoot full screen and the phone's Back closing it; Move… - the
      three choices with "Only this shoot" preselected; each choice applied in turn ("Only this shoot", "This shoot and
      the later ones", "The job date moved" on an estimate), the preview listing every shoot that moves, then "Waiting
      for the office computer", then Applied heard through the Realtime watch - and the shoots that moved in the database
      are exactly the preview's, on the preview's days; the job date moved on a Firm date: "Send to the office",
      answered "Sent to the office to approve"; PT409 (the office moved the same shoot meanwhile) -> "Someone changed
      this plan meanwhile - here is the new preview", then Apply with the new rev; Mark done; Undo; the office computer
      off (the header says so) and a change cancelled while new; My Tasks' "Open in shoot schedule"; a reminder's link
      (?shoot=) opened cold, and one to a shoot that is gone.
   2. Marketing reads only; a manager on no team is told no.
   3. The admin on a desk: the list on the left and the shoot on the right, Month and By job, a ?shoot= link; the
      Access tab's Photo team: a second photographer, the default moved to him, a marketing member's Google e-mail in
      lower case, and a "changed" conflict (another admin saved the same line meanwhile: nothing written over, the list
      read again and said so).
   4. No Content-Security-Policy violation and no console error on any page.
   Screenshots: shoots_<who>_<what>_<light|dark>_<desktop|phone>.png into --out (default: the system temp folder; --shots
   some: light only). Made-up data only. Prints a JSON summary; exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p10-photo")));
const SHOTS = arg("--shots", "all");
const NO_ACCESS = "The shoot schedule is for admins and the photo team.";

/* ── what runs inside each page (injected before its own scripts): the audits ─────────────────────────────── */
export function pageHelpers() {
  const W = window;
  function describe(el) {
    if (!el || el.nodeType !== 1) return String(el);
    const t = String(el.getAttribute("aria-label") || el.textContent || el.value || "").replace(/\s+/g, " ").trim().slice(0, 32);
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "";
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + cls + (el.getAttribute("data-act") ? "[" + el.getAttribute("data-act") + "]" : "") +
      (el.getAttribute("data-ph") ? "[" + el.getAttribute("data-ph") + "]" : "") + (t ? " '" + t + "'" : "");
  }
  function rgba(s) {
    const v = String(s || "").trim();
    let m = /^rgba?\(([^)]+)\)$/.exec(v);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
    m = /^color\(srgb ([^)]+)\)$/.exec(v);
    if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(parseFloat); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 }; }
    return null;
  }
  // "over" with transparency (Porter-Duff source-over)
  function over(f, b) {
    const a = f.a + b.a * (1 - f.a);
    if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    const mix = (x, y) => (x * f.a + y * b.a * (1 - f.a)) / a;
    return { r: mix(f.r, b.r), g: mix(f.g, b.g), b: mix(f.b, b.b), a };
  }
  function lum(c) { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
  const ratio = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const chain = (el) => { const out = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) out.unshift(n); return out; };
  const opacityOf = (n) => { const v = parseFloat(getComputedStyle(n).opacity); return isNaN(v) ? 1 : v; };
  /** {fg, bg} as painted: the backgrounds of the element's ancestors composited, an ancestor's opacity (the outermost
      one below 1) fading its whole layer into what is behind it. null: a picture behind (not measured). */
  function painted(el, color) {
    const nodes = chain(el);
    let i0 = nodes.findIndex((n) => opacityOf(n) < 1);
    if (i0 === -1) i0 = nodes.length;
    let back = { r: 255, g: 255, b: 255, a: 1 };
    let layer = { r: 0, g: 0, b: 0, a: 0 };
    let O = 1;
    for (let i = 0; i < nodes.length; i++) {
      const cs = getComputedStyle(nodes[i]);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
      const c = rgba(cs.backgroundColor);
      if (i < i0) { if (c && c.a > 0) back = over(c, back); } else {
        O *= opacityOf(nodes[i]);
        if (c && c.a > 0) layer = over(c, layer);
      }
    }
    const fgIn = over(color, layer);
    const fg = over({ r: fgIn.r, g: fgIn.g, b: fgIn.b, a: fgIn.a * O }, back);
    const bg = over({ r: layer.r, g: layer.g, b: layer.b, a: layer.a * O }, back);
    return { fg, bg };
  }
  /** A control that cannot be used now (its text need not reach the contrast; WCAG 1.4.3's exception). */
  function inert(el) {
    if (el.closest(":disabled, [aria-disabled='true'], .mv-choice.off")) return true;
    const lab = el.closest("label");
    const inp = lab ? lab.querySelector("input, select, textarea") : null;
    return !!(inp && inp.disabled);
  }
  W.__contrast = function (scopeSel) {
    const bad = [];
    let n = 0;
    const seen = new Set();
    for (const s of document.querySelectorAll(scopeSel)) {
      const tw = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      for (let t = tw.nextNode(); t; t = tw.nextNode()) {
        if (!t.nodeValue.trim()) continue;
        const el = t.parentElement;
        if (!el || seen.has(el)) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || inert(el)) continue;
        const fg = rgba(cs.color);
        if (!fg) continue;
        const p = painted(el, fg);
        if (!p) continue;
        const k = ratio(p.fg, p.bg);
        const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
        const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
        n++;
        if (k < need - 0.005) {
          bad.push({ el: describe(el), text: t.nodeValue.trim().slice(0, 40), ratio: Math.round(k * 100) / 100, need, color: cs.color,
            bg: "rgb(" + [p.bg.r, p.bg.g, p.bg.b].map(Math.round).join(",") + ")" });
        }
      }
    }
    return { n, bad };
  };
  W.__targets = function (scopeSel, min) {
    const sel = "button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]:not([tabindex='-1'])";
    const bad = [];
    let n = 0;
    const seen = new Set();
    for (const s of document.querySelectorAll(scopeSel)) {
      for (const el of s.querySelectorAll(sel)) {
        if (el.disabled) continue;
        let box = el;
        if ((el.type === "checkbox" || el.type === "radio") && el.closest("label")) box = el.closest("label");
        if (seen.has(box)) continue;
        seen.add(box);
        if (getComputedStyle(el).visibility === "hidden") continue;
        const r = box.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        n++;
        if (r.width < min - 0.5 || r.height < min - 0.5) bad.push({ el: describe(el), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 });
      }
    }
    return { n, bad };
  };
  /** Where the keyboard is now, and whether it shows (its look focused differs from its look blurred). */
  W.__focusNow = function (scopeSel) {
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement) return { none: true, el: "body" };
    const look = () => { const cs = getComputedStyle(a); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderTopColor, cs.backgroundColor].join("|"); };
    const on = look();
    const fv = a.matches(":focus-visible");
    a.blur();
    const off = look();
    a.focus({ preventScroll: true });
    return { el: describe(a), visible: on !== off, fv, inside: scopeSel ? !!a.closest(scopeSel) : true };
  };
  W.__describe = describe;
}

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
  async function tab(name, isolated) {
    const p = await newPage(cdp, name, OUT, isolated);
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
  const focusSel = (p, sel) => p.eval("(() => { const n = document.querySelector(" + JSON.stringify(sel) + "); if (n) n.focus(); return !!n && document.activeElement === n; })()");
  const row = (p, name, job) => p.eval("(() => { const r = Array.from(document.querySelectorAll('#shList .sh-row')).find((x) => x.querySelector('.sh-name') && " +
    "x.querySelector('.sh-name').textContent === " + JSON.stringify(name) + (job ? " && x.textContent.indexOf(" + JSON.stringify(job) + ") !== -1" : "") +
    "); if (r) r.click(); return r ? Number(r.getAttribute('data-shoot')) : 0; })()");
  const pickDay = (p, n) => p.eval("(() => { const d = Array.from(document.querySelectorAll('#mvDay [data-act=pick]')).filter((b) => !/\\b(off|cur)\\b/.test(b.className))[" + (n || 0) + "]; " +
    "if (d) d.click(); return d ? d.getAttribute('data-day') : null; })()");
  // a day after the one it has now (a shoot day when the strip marks them)
  const pickLater = (p, n) => p.eval("(() => { const all = Array.from(document.querySelectorAll('#mvDay [data-act=pick]')); const i = all.findIndex((b) => /\\bcur\\b/.test(b.className)); " +
    "const d = all.slice(i + 1).filter((b) => !/\\boff\\b/.test(b.className))[" + (n || 0) + "]; if (d) d.click(); return d ? d.getAttribute('data-day') : null; })()");
  const choose = (p, name, value) => p.eval("(() => { const r = Array.from(document.querySelectorAll('input[name=" + name + "]')).find((x) => x.value === " + JSON.stringify(value) + "); " +
    "if (r) r.click(); return !!r; })()");
  const PREVIEWED = "(() => { const b = document.getElementById('mvApply'); const t = document.getElementById('mvPreview').textContent; " +
    "return !!b && !/Checking|checking again/.test(t) && (/Will move|Goes back|No shoot moves|Stays/.test(t) || !!document.querySelector('#mvPreview .no')); })()";
  const noSideways = (p) => p.eval("document.documentElement.scrollWidth <= innerWidth + 1");
  const db = (p, expr) => p.eval("(() => { const R = DCR2Demo.engine.rows; return " + expr + "; })()");
  const SHEET_OPEN = "!!document.getElementById('shMo')";
  /** A key pressed for real (the browser's own keyboard path: :focus-visible, a button's Enter, Tab order). */
  async function key(p, k, shift) {
    const codes = { Tab: 9, Enter: 13, Escape: 27 };
    const ev = { key: k, code: k, windowsVirtualKeyCode: codes[k], nativeVirtualKeyCode: codes[k], modifiers: shift ? 8 : 0 };
    await p.call("Input.dispatchKeyEvent", Object.assign({ type: k === "Enter" ? "keyDown" : "rawKeyDown" }, ev, k === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}));
    await p.call("Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, ev));
    await sleep(60);
  }
  /** Tab n times; each stop: inside the scope? the focus shown? */
  async function tabWalk(p, scope, n, shift) {
    const stops = [];
    for (let i = 0; i < n; i++) {
      await key(p, "Tab", shift);
      stops.push(await p.eval("__focusNow(" + JSON.stringify(scope) + ")"));
    }
    return stops;
  }
  /** The audits of one screen: sideways scroll (phone), tap targets, contrast (the current colour scheme). */
  async function audit(p, label, scope, phone, o) {
    const opt = o || {};
    if (phone) check(label + ": no page scrolls sideways at 375 px", await noSideways(p), await p.eval("document.documentElement.scrollWidth + ' > ' + innerWidth"));
    if (!opt.noTargets) {
      const t = await p.eval("__targets(" + JSON.stringify(scope) + ", " + (phone ? 40 : 24) + ")");
      check(label + ": every control is a tap target of at least " + (phone ? "40" : "24") + " px (" + t.n + ")", t.n > 0 && !t.bad.length, t.bad.slice(0, 8));
    }
    // the colours as they settle (no transition half-way between the two schemes)
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
  /** Every Tab stop shows the focus. */
  async function focusShown(p, label, scope, first, n) {
    if (first) await focusSel(p, first);
    const stops = await tabWalk(p, scope, n);
    const hidden = stops.filter((s) => !s.none && s.inside && !s.visible);
    check(label + ": the keyboard's focus shows on every stop (" + stops.filter((s) => s.inside).length + " stops)", stops.some((s) => s.inside) && !hidden.length,
      hidden.map((s) => s.el).slice(0, 6));
  }
  async function shot(p, name, device, dark) {
    if (SHOTS === "none" || (SHOTS === "some" && dark)) return;
    await p.dark(dark);
    await sleep(300);
    await p.shot("shoots_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png");
    shots += 1;
    await p.dark(false);
  }
  async function shots2(p, name, device) { await shot(p, name, device, false); await shot(p, name, device, true); }
  /** The open sheet: Tab and Shift+Tab stay inside it, Escape closes it and the focus is back on its opener. */
  async function sheetKeys(p, label, opener) {
    const fwd = await tabWalk(p, "#shMo", 24);
    const back = await tabWalk(p, "#shMo", 6, true);
    const out = fwd.concat(back).filter((s) => !s.inside);
    check(label + ": Tab and Shift+Tab stay inside the sheet", !out.length, out.map((s) => s.el).slice(0, 4));
    const hidden = fwd.concat(back).filter((s) => s.inside && !s.visible);
    check(label + ": the focus shows on every stop of the sheet", !hidden.length, hidden.map((s) => s.el).slice(0, 6));
    await key(p, "Escape");
    await p.until("!(" + SHEET_OPEN + ")", 4000);
    const back2 = await p.eval("(() => { const a = document.activeElement; return a ? __describe(a) + '|' + (a.matches(" + JSON.stringify(opener) + ") ? 'y' : 'n') : 'none'; })()");
    check(label + ": Escape closes it and the focus is back on the button that opened it", /\|y$/.test(back2), back2);
  }
  /** The plan's shoots in the demo database now (key, name, day, status). */
  const planRows = (p, code) => db(p, "(() => { const pl = R.photo_plans.find((x) => x.project_code === " + JSON.stringify(code) + "); " +
    "return R.photo_shoots.filter((s) => s.plan_id === pl.id).map((s) => ({ key: s.key, name: s.name, d: s.planned_date, st: s.status })); })()");
  /** The preview the sheet shows: the database's answer it was drawn from, and the names listed under "Will move". */
  const sheetPreview = (p) => p.eval("import('/js/pages/shoots.js').then((m) => { const mv = m._test.state.mv; " +
    "const h = Array.from(document.querySelectorAll('#mvPreview h4')).find((x) => /^Will move/.test(x.textContent)); " +
    "const ul = h ? h.nextElementSibling : null; " +
    "return { pv: mv && mv.pv ? JSON.parse(JSON.stringify(mv.pv)) : null, listed: ul ? Array.from(ul.querySelectorAll('li > b')).map((b) => b.textContent) : [] }; })");
  /** After the office computer applied it: the shoots whose day changed are exactly the preview's, on its days. */
  function sameAsPreview(before, after, pv) {
    const moved = after.filter((a) => { const b = before.find((x) => x.key === a.key); return b && b.d !== a.d; });
    const want = pv.moved.map((m) => m.key + " → " + m.to).sort();
    const got = moved.map((m) => m.key + " → " + m.d).sort();
    const skipped = (pv.passed || []).map((x) => x.key).filter((k) => (after.find((a) => a.key === k) || {}).st !== "skipped");
    return { ok: JSON.stringify(want) === JSON.stringify(got) && !skipped.length, want, got, skipped };
  }
  /** Move… from the shoot's sheet with a choice and a day, Apply, and follow it to Applied. */
  async function moveAndApply(p, label, o) {
    await p.until("!!document.querySelector('#shDScroll [data-act=move]')", 5000);
    await clickSel(p, "#shDScroll [data-act=move]");
    await p.until("!!document.getElementById('mvChoices')", 5000);
    if (o.kind !== "move_one") { await choose(p, "mvKind", o.kind); await sleep(150); }
    if (o.milestone) { await choose(p, "mvMs", o.milestone); await sleep(150); }
    const day = o.later !== undefined ? await pickLater(p, o.later) : await pickDay(p, o.dayIndex || 0);
    await p.until(PREVIEWED, 8000);
    const sp = await sheetPreview(p);
    const pv = sp.pv;
    check(label + ": the preview lists every shoot that moves (" + (pv ? pv.moved.length : "?") + ")", pv && pv.moved.length >= 1 &&
      JSON.stringify(sp.listed.slice().sort()) === JSON.stringify(pv.moved.map((m) => m.name).sort()) && (await p.eval("(document.getElementById('mvPreview').textContent.match(/→/g) || []).length")) >= pv.moved.length,
      { listed: sp.listed, moved: pv && pv.moved.map((m) => m.name) });
    if (o.shot) await shot(p, o.shot, "phone", false);
    const before = await planRows(p, o.plan);
    const ms0 = o.kind === "milestone" ? await db(p, "R.photo_plans.find((x) => x.project_code === " + JSON.stringify(o.plan) + ").milestones[" + JSON.stringify(o.milestone) + "].date") : null;
    await clickSel(p, "#mvApply");
    await p.until("/Waiting for the office computer|The office computer is applying it/.test(document.getElementById('shDScroll').textContent)", 6000);
    check(label + ": sent - the shoot says it waits for the office computer", true);
    await p.until("/Your recent changes/.test(document.getElementById('shDScroll').textContent) && /Applied/.test(document.getElementById('shDScroll').textContent) && " +
      "!/Waiting for the office computer|applying it/.test(document.getElementById('shDScroll').textContent)", 20000);
    const after = await planRows(p, o.plan);
    const same = sameAsPreview(before, after, pv);
    check(label + ": applied by the office computer, heard through the watch - the shoots that moved are exactly the preview's, on its days", same.ok, same);
    if (o.kind === "milestone") {
      const ms1 = await db(p, "R.photo_plans.find((x) => x.project_code === " + JSON.stringify(o.plan) + ").milestones[" + JSON.stringify(o.milestone) + "].date");
      check(label + ": the job date itself moved to the day picked", ms1 === day && ms1 !== ms0, ms0 + " -> " + ms1 + " (picked " + day + ")");
    }
    return { day, pv };
  }

  try {
    /* ── 0. every person, phone and desk, light and dark: the audits ─────────────────────────────────────────── */
    const PEOPLE = [["admin", "admin", true], ["field", "photographer", true], ["viewer", "marketing", false], ["lead", "lead on no team", false]];
    for (const device of ["phone", "desktop"]) {
      const phone = device === "phone";
      for (const [role, who, edits] of PEOPLE) {
        const p = await tab(who + "-" + device, true);
        await p.size(phone ? 375 : 1440, phone ? 812 : 900, phone);
        const W = who.split(" ")[0] + " " + device;
        await attempt(W + ": Home, the top bar, the shoot schedule", async () => {
          await signIn(p, role);
          await p.until("!!document.getElementById('hmSections') && document.getElementById('hmSections').children.length > 0", 8000);
          if (role === "lead") {
            await sleep(1500);
            check(W + ": Home has no 📷 card, the top bar no Shoot schedule (on no team)", !(await p.eval("!!document.getElementById('hmShoots')")) &&
              !(await p.eval("Array.from(document.querySelectorAll('#dcr2Nav a')).some((a) => a.getAttribute('href') === 'shoots.html')")));
            await open(p, "/shoots.html", "/Not for your account/.test(document.getElementById('shList').textContent)");
            const t = await p.eval("document.getElementById('shRoot').innerText");
            check(W + ": shoots.html opened directly says plainly it is not for this account", t.indexOf("Not for your account") !== -1 && t.indexOf(NO_ACCESS) !== -1 &&
              (await p.eval("document.querySelectorAll('#shRoot .sh-row, #shRoot [data-act=move], #shRoot [data-act=done], #shRoot [data-act=undo]').length")) === 0 &&
              (await p.eval("document.getElementById('shBar').hidden")), t.slice(0, 300));
            check(W + ": the top bar has no Shoot schedule there either", !(await p.eval("Array.from(document.querySelectorAll('#dcr2Nav a')).some((a) => a.getAttribute('href') === 'shoots.html')")));
            check(W + ": no empty \"Pick a shoot\" panel beside it", await p.eval("getComputedStyle(document.getElementById('shDetail')).display === 'none'"));
            await audit(p, W + " (not for this account)", "#shRoot", phone);
            await focusShown(p, W + " (not for this account)", "#shRoot", "#shTitle", 2);
            await shots2(p, "lead_no_access", device);
            return;
          }
          await p.until("!!document.getElementById('hmShoots') && Array.from(document.querySelectorAll('#dcr2Nav a')).some((a) => a.getAttribute('href') === 'shoots.html')", 8000);
          check(W + ": Home's 📷 card and the top bar's Shoot schedule", true);
          await open(p, "/shoots.html", LIST);
          await audit(p, W + " Agenda", "#shRoot", phone);
          await focusShown(p, W + " Agenda", "#shRoot", "#shViews [data-view=agenda]", 14);
          await shots2(p, who.split(" ")[0] + "_agenda", device);
          const id = await row(p, "Before framing", "A000T9");
          await p.until("!!document.getElementById('shDTitle') && document.getElementById('shDetail').classList.contains('open')", 5000);
          const acts = await p.eval("Array.from(document.querySelectorAll('#shDScroll [data-act]')).map((b) => b.getAttribute('data-act')).filter((a) => /^(move|done|undo|cancel-change)$/.test(a)).join(',')");
          check(W + ": the shoot's actions - " + (edits ? "Move… and Mark done…" : "none (read only)"), edits ? /move/.test(acts) && /done/.test(acts) : acts === "", acts);
          const scope = phone ? "#shDetail" : "#shRoot";
          await audit(p, W + " a shoot", scope, phone);
          await focusShown(p, W + " a shoot", "#shDetail", phone ? "#shBack" : "#shClose", 8);
          await shots2(p, who.split(" ")[0] + "_shoot", device);
          if (edits) {
            // Move… opened from the keyboard: the focus on "Only this shoot"; the preview; Tab stays; Escape gives it back
            await focusSel(p, "#shDScroll [data-act=move]");
            await key(p, "Enter");
            await p.until(SHEET_OPEN + " && !!document.getElementById('mvChoices')", 5000);
            check(W + " Move…: opened from the keyboard, the focus on Only this shoot", await p.eval("document.activeElement && document.activeElement.value === 'move_one'"),
              await p.eval("__describe(document.activeElement)"));
            await pickDay(p, 1);
            await p.until(PREVIEWED, 8000);
            await audit(p, W + " Move…", "#shMo", phone);
            await shots2(p, who.split(" ")[0] + "_move", device);
            await focusSel(p, "#shMo input[value=move_one]");
            await sheetKeys(p, W + " Move…", "[data-act=move]");
            await focusSel(p, "#shDScroll [data-act=done]");
            await key(p, "Enter");
            await p.until(SHEET_OPEN + " && !!document.getElementById('dnNote')", 5000);
            check(W + " Mark done…: the focus in its note", await p.eval("document.activeElement && document.activeElement.id === 'dnNote'"));
            await audit(p, W + " Mark done…", "#shMo", phone);
            if (phone) await shot(p, who.split(" ")[0] + "_done", device, true);
            await sheetKeys(p, W + " Mark done…", "[data-act=done]");
          }
          if (phone) {
            await focusSel(p, "#shBack");
            await key(p, "Escape");
            await p.until("!document.getElementById('shDetail').classList.contains('open')", 5000);
            const f = await p.eval("(() => { const a = document.activeElement; return a && a.getAttribute('data-shoot') === " + JSON.stringify(String(id)) + "; })()");
            check(W + ": Escape closes the shoot back to the list, the focus on its row", f, await p.eval("__describe(document.activeElement)"));
          }
          await clickSel(p, "#shViews [data-view=month]");
          await p.until("document.querySelectorAll('#shList .sh-cell').length >= 28", 5000);
          await audit(p, W + " Month", phone ? "#shList, #shBar" : "#shRoot", phone);
          await focusShown(p, W + " Month", "#shList", "#shList [data-act=month-prev], #shList [data-act=month-next]", 10);
          await shots2(p, who.split(" ")[0] + "_month", device);
          await clickSel(p, "#shViews [data-view=job]");
          await p.until("document.querySelectorAll('#shList .sh-plan').length >= 2", 5000);
          await audit(p, W + " By job", phone ? "#shList" : "#shRoot", phone);
          await shot(p, who.split(" ")[0] + "_by_job", device, phone);
          if (role === "admin") {
            await open(p, "/admin.html?tab=access", "document.querySelectorAll('#adPhoto [data-person]').length > 2");
            await audit(p, W + " the Access tab's Photo team", "#adPhoto", phone);
            await focusShown(p, W + " the Photo team", "#adPhoto", "#adPhoto [data-person] input", 10);
            // a line changed: its Save and Cancel measured too, then Cancel puts it back
            const lead = "Array.from(document.querySelectorAll('#adPhoto [data-person]')).find((r) => r.querySelector('b').textContent.indexOf('Riley Lead') === 0)";
            await p.eval("(() => { " + lead + ".querySelector('[data-ph=photographer]').click(); return true; })()");
            await p.until("!" + lead + ".querySelector('[data-phacts]').hidden", 4000);
            const t = await p.eval("__targets('#adPhoto [data-phacts]', " + (phone ? 40 : 24) + ")");
            check(W + " the Photo team: a changed line's Save and Cancel are tap targets of at least " + (phone ? 40 : 24) + " px", t.n === 2 && !t.bad.length, t.bad);
            await p.eval("(() => { " + lead + ".querySelector('[data-phcancel]').click(); return true; })()");
            await p.until(lead + ".querySelector('[data-phacts]').hidden && !" + lead + ".querySelector('[data-ph=photographer]').checked", 4000);
            await p.eval("document.getElementById('adPhoto').scrollIntoView({ block: 'start' }); true");
            await shots2(p, "admin_photo_team", device);
          }
        }, p);
      }
    }

    /* ── 1. the photographer on a phone: the walk ──────────────────────────────────────────────────────────── */
    const ph = await tab("photographer", false);
    await ph.size(375, 812, true);
    await attempt("the photographer's way in: Home's card, the top bar's entry", async () => {
      await signIn(ph, "field");
      await ph.until("!!document.getElementById('hmShoots')", 8000);
      check("Home: 📷 Shoot schedule for the photographer", /📷\s*Shoot schedule/.test(await text(ph, "#hmShoots")), await text(ph, "#hmShoots"));
      await open(ph, "/shoots.html", LIST);
      check("the top bar's Shoot schedule entry (current)", await ph.eval("Array.from(document.querySelectorAll('#dcr2Nav a')).some(a => a.getAttribute('href') === 'shoots.html' && a.getAttribute('aria-current') === 'page')"));
    }, ph);

    await attempt("a shoot full screen; the phone's Back closes it", async () => {
      const id = await row(ph, "Before framing", "A000T9");
      await ph.until("document.getElementById('shDetail').classList.contains('open') && !!document.getElementById('shDTitle')", 5000);
      check("a shoot opens full screen with its address", /\?shoot=\d+/.test(await ph.eval("location.search")) && id > 0, await ph.eval("location.search"));
      await ph.eval("history.back(); true");
      await ph.until("!document.getElementById('shDetail').classList.contains('open')", 5000);
      check("the phone's Back closes it (the list again)", !/shoot=/.test(await ph.eval("location.search")));
    }, ph);

    await attempt("Move… only this shoot: the preview, Apply, waiting, Applied - exactly the preview's shoots", async () => {
      await row(ph, "Framing progress #1", "A000T9");
      await ph.until("!!document.querySelector('#shDScroll [data-act=move]')", 5000);
      await clickSel(ph, "#shDScroll [data-act=move]");
      await ph.until("!!document.getElementById('mvChoices')", 5000);
      const kinds = await ph.eval("Array.from(document.querySelectorAll('input[name=mvKind]')).map(r => r.value + (r.checked ? '*' : '')).join('|')");
      check("Move… always asks the three choices, Only this shoot preselected", kinds === "move_one*|move_later|milestone", kinds);
      await clickSel(ph, "#shMo [data-act=mv-close]");
      await ph.until("!(" + SHEET_OPEN + ")", 4000);
      await moveAndApply(ph, "Only this shoot", { kind: "move_one", plan: "A000T9", dayIndex: 1, shot: "move_one" });
    }, ph);

    await attempt("Move… this shoot and the later ones: every shoot that moves, Applied through the watch", async () => {
      await ph.eval("document.getElementById('shBack').click(); true");
      await sleep(300);
      await row(ph, "Before framing", "A000T9");
      const r = await moveAndApply(ph, "This shoot and the later ones", { kind: "move_later", plan: "A000T9", dayIndex: 1, shot: "move_later" });
      check("the preview moved more than one shoot (the later ones by the same number of days)", r.pv.moved.length > 1, r.pv.moved.map((m) => m.key));
      const t = await text(ph, "#shDScroll");
      check("the shoot's history says who moved it, from where", t.indexOf("by Jordan on the shoot schedule") !== -1, t.slice(0, 300));
    }, ph);

    await attempt("Move… the job date moved (an estimate): which job date, its day, every shoot that follows it", async () => {
      await ph.eval("document.getElementById('shBack').click(); true");
      await sleep(300);
      await row(ph, "Delivery day", "A000T9");
      await moveAndApply(ph, "The job date moved (Delivery, an estimate)", { kind: "milestone", milestone: "delivery", plan: "A000T9", later: 1, shot: "milestone_estimate" });
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
      await audit(ph, "photographer phone the Firm job date's preview", "#shMo", true);
      await shot(ph, "milestone_firm", "phone", true);
      const fs0 = await db(ph, "R.photo_plans.find((x) => x.project_code === 'A000T9').milestones.framing_start.date");
      // the office computer off for a moment: its answer arrives while another sheet is open
      await ph.eval("sessionStorage.setItem('dcr2-demo-pc-off', '1'); true");
      await clickSel(ph, "#mvApply");
      await ph.until("!(" + SHEET_OPEN + ") && /Waiting for the office computer/.test(document.getElementById('shDScroll').textContent)", 8000);
      await ph.eval("document.getElementById('shBack').click(); true");
      await sleep(300);
      await row(ph, "Drone airspace check", "A000T9");
      await ph.until("!!document.querySelector('#shDScroll [data-act=move]')", 5000);
      await clickSel(ph, "#shDScroll [data-act=move]");
      await ph.until(SHEET_OPEN + " && !!document.getElementById('mvChoices')", 5000);
      await ph.eval("sessionStorage.removeItem('dcr2-demo-pc-off'); (() => { const d = DCR2Demo.engine.exts.find((x) => x.name === 'p10-photo').__dev; for (let i = 0; i < 4 && d.pc.step(); i++); return true; })()");
      await ph.until("DCR2Demo.engine.rows.photo_changes.filter((c) => c.kind === 'milestone').slice(-1)[0].status === 'applied'", 6000);
      const FINISHED = "Array.from(document.querySelectorAll('.dcr2-toast')).some((t) => /^Sent to the office to approve/.test(t.textContent))";
      await ph.until("(() => { const c = DCR2Demo.engine.rows.photo_changes.filter((c) => c.kind === 'milestone').slice(-1)[0]; " +
        "return import('/js/pages/shoots.js').then((m) => m._test.state.changes.some((x) => x.id === c.id && x.state === 'applied')); })()", 25000);
      check("the office computer's answer while another sheet is open: no toast over the sheet", !(await ph.eval(FINISHED)));
      await key(ph, "Escape");
      await ph.until(FINISHED, 4000);
      const said = await ph.eval("Array.from(document.querySelectorAll('.dcr2-toast')).map((t) => t.textContent).find((t) => /^Sent to the office to approve/.test(t))");
      check("... it is said once the sheet closes, in plain words (Sent to the office to approve: Framing start is Firm)", said === "Sent to the office to approve: Framing start is Firm", said);
      await ph.eval("document.getElementById('shBack').click(); true");
      await sleep(300);
      await row(ph, "Framing progress #2", "A000T9");
      await ph.until("/Sent to the office to approve/.test(document.getElementById('shDScroll').textContent)", 8000);
      check("answered: Sent to the office to approve - the Firm date itself unchanged", (await db(ph, "R.photo_plans.find((x) => x.project_code === 'A000T9').milestones.framing_start.date")) === fs0);
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
      await audit(ph, "photographer phone the changed-meanwhile preview", "#shMo", true);
      await shot(ph, "changed_meanwhile", "phone", false);
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
      await audit(ph, "photographer phone Undo…", "#shMo", true);
      await shot(ph, "undo", "phone", false);
      await clickSel(ph, "#mvApply");
      await ph.until("(() => { const c = DCR2Demo.engine.rows.photo_changes.find(x => x.id === 1); return c && c.undone_by; })()", 20000);
      check("undone by the office computer", true);
      // the office computer off: a change waits, and is cancelled while new
      await ph.eval("sessionStorage.setItem('dcr2-demo-pc-off', '1'); true");
      await open(ph, "/shoots.html", LIST);
      check("the header: the office computer is off, in plain words", /^The office computer is off - changes wait until it is back on/.test(await text(ph, "#shPc")), await text(ph, "#shPc"));
      await shots2(ph, "pc_off", "phone");
      await row(ph, "House complete", "A000T8");
      await ph.until("!!document.querySelector('#shDScroll [data-act=move]')", 5000);
      await clickSel(ph, "#shDScroll [data-act=move]");
      await ph.until("!!document.getElementById('mvDay')", 5000);
      await pickDay(ph, 2);
      await ph.until(PREVIEWED, 8000);
      await clickSel(ph, "#mvApply");
      await ph.until("!!document.querySelector('#shDScroll [data-act=cancel-change]')", 8000);
      check("waiting while the office computer is off: the shoot says so", /The office computer is off - changes wait until it is back on/.test(await text(ph, "#shDScroll")));
      await audit(ph, "photographer phone a change waiting, the office computer off", "#shDetail", true);
      await shot(ph, "waiting_pc_off", "phone", false);
      // the confirm of the site's own: Escape keeps the change, the focus back on Cancel this change
      await focusSel(ph, "#shDScroll [data-act=cancel-change]");
      await key(ph, "Enter");
      await ph.until("!!document.querySelector('.dcr-mo.open #dcrMoYes')", 5000);
      await key(ph, "Escape");
      await ph.until("!document.querySelector('.dcr-mo.open')", 4000);
      check("Cancel this change…: Escape keeps it, the focus back on its button", (await ph.eval("document.activeElement && document.activeElement.getAttribute('data-act')")) === "cancel-change" &&
        (await db(ph, "R.photo_changes.filter(c => c.target_key === 'house-complete').slice(-1)[0].status")) === "new");
      await clickSel(ph, "#shDScroll [data-act=cancel-change]");
      await ph.until("!!document.querySelector('.dcr-mo.open #dcrMoYes')", 5000);
      await ph.eval("document.querySelector('.dcr-mo.open #dcrMoYes').click(); true");
      await ph.until("!document.querySelector('#shDScroll [data-act=cancel-change]')", 8000);
      check("Cancel while new: cancelled", (await db(ph, "R.photo_changes.filter(c => c.target_key === 'house-complete').slice(-1)[0].status")) === "cancelled");
      await ph.eval("sessionStorage.removeItem('dcr2-demo-pc-off'); true");
    }, ph);

    await attempt("My Tasks' Open in shoot schedule; a reminder's link opened cold; a link to a shoot that is gone", async () => {
      await open(ph, "/my-tasks.html", "document.querySelectorAll('.mt-card').length > 0");
      await ph.eval("(() => { const c = Array.from(document.querySelectorAll('.mt-card')).find(x => /Shoot the framing progress/.test(x.textContent)); c.querySelector('.mt-open').click(); return true; })()");
      await ph.until("!!document.querySelector('#mtShootLink a')", 8000);
      const href = await ph.eval("document.querySelector('#mtShootLink a').getAttribute('href')");
      check("a Photo & Video task: Open in shoot schedule (its shoot)", /^shoots\.html\?shoot=\d+$/.test(href), href);
      await open(ph, "/" + href, "!!document.getElementById('shDTitle')");
      check("the link opens that shoot", (await text(ph, "#shDTitle")) === "Lot before work", await text(ph, "#shDTitle"));
      const drone = await db(ph, "R.photo_shoots.find((s) => s.key === 'drone-check').id");
      await open(ph, "/shoots.html?shoot=" + drone, "!!document.getElementById('shDTitle')");
      check("a reminder's link (?shoot=) opened cold: that shoot, full screen, the keyboard on its title",
        (await text(ph, "#shDTitle")) === "Drone airspace check" && (await ph.eval("document.getElementById('shDetail').classList.contains('open') && document.activeElement && document.activeElement.id === 'shDTitle'")),
        await text(ph, "#shDTitle"));
      await open(ph, "/shoots.html?shoot=987654", LIST);
      check("a link to a shoot that is gone says so, the list under it", /That shoot is not on the shoot schedule any more\./.test(await text(ph, "#shList")) &&
        !(await ph.eval("document.getElementById('shDetail').classList.contains('open')")));
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
    const dk = await tab("admin-desk", false);
    await dk.size(1440, 900, false);
    await attempt("the desk: the list left, the shoot right; Month and By job; a ?shoot= link", async () => {
      await signIn(dk, "admin");
      await open(dk, "/shoots.html", LIST);
      await row(dk, "Delivery day", "A000T9");
      await dk.until("!!document.getElementById('shDTitle')", 5000);
      check("desk: the shoot beside the list", await dk.eval("document.getElementById('shDetail').getBoundingClientRect().left > document.getElementById('shList').getBoundingClientRect().right - 1"));
      await clickSel(dk, "#shViews [data-view=month]");
      await dk.until("document.querySelectorAll('#shList .sh-cell').length >= 28", 5000);
      check("Month: the grid takes the wide side", await dk.eval("document.getElementById('shList').getBoundingClientRect().width > document.getElementById('shDetail').getBoundingClientRect().width"));
      await clickSel(dk, "#shViews [data-view=job]");
      await dk.until("document.querySelectorAll('#shList .sh-plan').length >= 3", 5000);
      check("By job: each plan with its job dates (Firm)", /Framing start .* · Firm/.test(await text(dk, "#shList")));
      const hc = await db(dk, "R.photo_shoots.find((s) => s.key === 'house-complete' && R.photo_plans.find((p) => p.id === s.plan_id).project_code === 'A000T8').id");
      await open(dk, "/shoots.html?shoot=" + hc, "!!document.getElementById('shDTitle')");
      check("desk: a ?shoot= link opens the shoot on the right, its row marked in the list and in view",
        (await text(dk, "#shDTitle")) === "House complete" && (await dk.eval("(() => { const r = document.querySelector('#shList [data-shoot=\"" + hc + "\"]'); " +
          "if (!r || r.getAttribute('aria-current') !== 'true') return false; const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; })()")));
    }, dk);

    await attempt("the Access tab's Photo team: a second photographer, the default moved to him, a Google e-mail in lower case, a changed conflict", async () => {
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
      await dk.until(line("Casey Accounts") + ".querySelector('[data-phacts]').hidden", 5000);
      // another admin saves Casey's line meanwhile (the demo database, as Avery); this card still shows the old version
      await dk.eval("(() => { const E = DCR2Demo.engine, R = E.rows; const c = R.profiles.find((p) => p.full_name === 'Casey Accounts'); const t = R.photo_team.find((r) => r.profile_id === c.id); " +
        "E.rpc({ uid: R.profiles.find((p) => p.full_name === 'Avery Admin').id }, 'set_photo_team', { p_profile: c.id, p_photographer: false, p_marketing: true, p_default: null, " +
        "p_google_email: 'casey.office@example.com', p_version: t.version }); return true; })()");
      await dk.eval("(() => { const r = " + line("Casey Accounts") + "; const i = r.querySelector('[data-ph=googleEmail]'); i.value = 'casey.photos@example.com'; i.dispatchEvent(new Event('input', { bubbles: true })); r.querySelector('[data-phsave]').click(); return true; })()");
      await dk.until("/Someone changed the photo team meanwhile/.test(document.getElementById('adPhoto').textContent)", 8000);
      check("a changed conflict: nothing written over, the list read again (the other admin's e-mail on the line) and said so",
        (await db(dk, "R.photo_team.find((r) => R.profiles.find((p) => p.id === r.profile_id).full_name === 'Casey Accounts').google_email")) === "casey.office@example.com" &&
        (await dk.eval("(() => { const r = " + line("Casey Accounts") + "; return r.querySelector('[data-ph=googleEmail]').value === 'casey.office@example.com' && r.querySelector('[data-phacts]').hidden; })()")),
        await text(dk, "#adPhoto .ad-ph-say"));
      // the card as it is now: its warning lines (the default's, the conflict's) read in both schemes
      await audit(dk, "desk the Photo team after a conflict", "#adPhoto", false);
      await dk.eval("document.getElementById('adPhoto').scrollIntoView({ block: 'start' }); true");
      await shots2(dk, "admin_photo_team_changed", "desktop");
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
