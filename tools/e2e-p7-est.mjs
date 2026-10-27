#!/usr/bin/env node
/* DCR Portal 2 — the end-to-end walk of the web estimate and change-order editor in the DEMO (development only;
   owner 2026-10-24: Q12 reversed - an Estimator edits estimates on the web too).

     node tools/e2e-p7-est.mjs [--out <dir>] [--chrome <path>] [--shots all|none]

   Starts tools/devserve.mjs on a free 127.0.0.1 port (the in-browser stand-in database with migration
   20261028000100's rules - tools/fake/p5a-est.js; nothing goes to Supabase) and drives a local Chrome or Edge
   headless:
   - Robin Estimator (a manager with the Estimator switch, WITHOUT prices) on a phone (375 px) and a desk: the editor
     (＋ Estimate, ＋ Change order, the hooks), not one amount on the page or in a sheet, no price box; an item sheet
     is the whole screen with Save in view and 44 px controls; a quantity saved; words that quote an amount refused
     before anything is sent; the approved estimate's type, quantities and Delete kept; a locked word shown amount-free
     and read only; a new change order (the next number), a new group - a name only, "Empty" on its card (owner
     2026-10-27) -, an item of two lines in it, the group renamed, a second empty group deleted; a group row reads as
     its name (no group code); leaving a changed sheet asks "Save changes?" (owner 2026-10-27: Cancel stays, Save
     closes only once the save went through - one the database would refuse stays open -, Don't save closes); someone
     else rearranging the groups while a sheet is open (the gids are per read): the new item and Move to group still go
     into the group named, a deleted group refuses the new item; no horizontal scroll;
   - Quinn Manager (an Estimator WITH prices) on a desk: the price boxes and the live total, Approved offered, and
     someone else's save while the sheet is open (the notice, then the conflict panel: Use mine);
   - Morgan Manager (no Estimator switch) and Riley Lead: the read-only tab ("view only"), no edit control;
   - no Content-Security-Policy violation and no console error anywhere.
   Screenshots (--shots all): est7_<scene>_<role>_<light|dark>_<desktop|phone>.png into --out. Prints a JSON summary;
   exit code 1 when a check failed. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "./devserve.mjs";
import { launch, newPage, sleep } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const OUT = resolve(arg("--out", join(tmpdir(), "dcr2-e2e-p7-est")));
const SHOTS = arg("--shots", "all");
const PID = 268;            // A267, the sandbox project
const J = JSON.stringify;

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
    await p.eval("document.getElementById('email').value=" + J(key + "@demo.test") + ";document.getElementById('password').value='demo-password-1';" +
      "document.getElementById('remember').checked=false;document.getElementById('loginForm').requestSubmit();true");
    await p.until("!/index\\.html/.test(location.pathname)", 10000);
  }
  async function shoot(p, name, device, dark) {
    if (SHOTS === "none") return;
    const w = device === "phone" ? 375 : 1280, h = device === "phone" ? 812 : 900;
    await p.call("Page.bringToFront").catch(() => null);
    await p.dark(dark);
    await sleep(400);
    const file = "est7_" + name + "_" + (dark ? "dark" : "light") + "_" + device + ".png";
    const took = await Promise.race([p.shot(file), sleep(25000).then(() => null)]);
    if (took) shots.push(took); else check("screenshot " + file, false, "no frame in 25 s");
    await p.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: device === "phone" });
    await p.dark(false);
  }
  const noScroll = (p) => p.eval("document.documentElement.scrollWidth <= innerWidth + 1");
  const editorReady = "!!document.querySelector('#pane-estimate.active.es-editor .es-card') && !!document.getElementById('esNewEst')";
  const readOnlyReady = "!!document.querySelector('#pane-estimate.active .es-card') && /view only/.test((document.querySelector('#pane-estimate .es-count') || {}).innerText || '')";
  const sheetOpen = "!!document.querySelector('#esSheet:not([hidden]) .es-sheet-card')";
  // closed, and the write and its read finished (the tab is not busy)
  const sheetClosed = "!!document.getElementById('esSheet') && document.getElementById('esSheet').hidden && document.getElementById('pane-estimate').getAttribute('aria-busy') !== 'true'";
  const click = (p, sel) => p.eval("(() => { const n = document.querySelector(" + J(sel) + "); if (!n) throw new Error('no ' + " + J(sel) + "); n.click(); return true; })()");
  const openItem = (p, words) => p.eval("(() => { const r = Array.from(document.querySelectorAll('#pane-estimate tr[data-act=item]')).find(t => t.innerText.indexOf(" + J(words) + ") !== -1); " +
    "if (!r) throw new Error('no item ' + " + J(words) + "); r.click(); return true; })()");
  const type = (p, sel, value) => p.eval("(() => { const n = document.querySelector(" + J(sel) + "); if (!n) throw new Error('no ' + " + J(sel) + "); n.value = " + J(value) +
    "; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  const modalYes = (p) => p.until("(() => { const h = document.getElementById('dcrModalHost'); if (!h || !h.classList.contains('open')) return false; document.getElementById('dcrMoYes').click(); return true; })()", 5000);
  // a changed sheet's close asks Save changes? (owner 2026-10-27), its Save focused
  const saveAsked = "(() => { const h = document.getElementById('dcrModalHost'); return !!h && h.classList.contains('open') && /Save changes\\?/.test(h.innerText) && " +
    "!!document.getElementById('dcrMoAlt') && document.activeElement === document.getElementById('dcrMoYes'); })()";
  const DOLLARS = "/\\$\\s?\\d/";

  try {
    const a = await newPage(cdp, "setup", OUT); pages.push(a);
    await a.size(1280, 900, false);
    await a.goto(base + "/manifest.json", 50);
    await a.eval("localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase('dcr2-demo-objects'); indexedDB.deleteDatabase('dcr2Uploads'); true");

    /* ── Robin Estimator, no prices, on a phone ─────────────────────────── */
    const m = await newPage(cdp, "estimator-phone", OUT); pages.push(m);
    await m.size(375, 812, true);
    await signIn(m, "estimator");
    await attempt("estimator (no prices), phone: the editor, not one amount", async () => {
      await m.goto(base + "/project.html?id=" + PID + "&tab=estimate", 300);
      await m.until(editorReady, 15000);
      const st = await m.eval("(() => { const p = document.getElementById('pane-estimate'); return { money: " + DOLLARS + ".test(p.innerHTML), " +
        "count: p.querySelector('.es-count').innerText, edits: p.querySelectorAll('[data-act=est]').length, addMain: !!p.querySelector('[data-act=add][data-est=\"1\"]'), " +
        "scrubbed: /\\[amount\\]/.test(p.innerText), groups: Array.from(p.querySelector('.es-card').querySelectorAll('.pj-grp td')).map(t => t.innerText.trim()) }; })()");
      check("estimator, phone: the editor's controls, quantities only, no amount in the page", !st.money && /quantities only/.test(st.count) && st.edits === 4 && st.scrubbed, J(st));
      check("estimator, phone: nothing added to the approved estimate", !st.addMain, J(st));
      check("estimator, phone: a group row reads as its name (owner 2026-10-27: no group code)", J(st.groups) === J(["Floor system", "Walls", "Roof", "(no group)"]), J(st.groups));
      check("estimator, phone: no horizontal scroll", await noScroll(m), await m.eval("document.documentElement.scrollWidth"));
      await shoot(m, "tab_estimator", "phone", false);
    }, m);
    await attempt("estimator, phone: an item sheet is the whole screen, Save in view, no price box", async () => {
      await openItem(m, "Deck framing 12x16");
      await m.until(sheetOpen, 5000);
      const st = await m.eval("(() => { const c = document.querySelector('#esSheet .es-sheet-card').getBoundingClientRect(); const s = document.getElementById('esSave').getBoundingClientRect(); " +
        "const f = document.getElementById('esItemForm'); return { w: Math.round(c.width), vw: innerWidth, top: Math.round(c.top), saveBottom: Math.round(s.bottom), vh: innerHeight, saveH: Math.round(s.height), " +
        "prices: !!f.querySelector('[name=labor_rate],[name=labor_unit_price],[name=material_unit_price],[name=labor_markup_pct],[name=material_markup_pct],[name=notes]'), " +
        "decimal: f.querySelectorAll('input[inputmode=decimal]').length, money: " + DOLLARS + ".test(document.getElementById('esSheet').innerHTML), " +
        "small: Array.from(document.querySelectorAll('#esSheet .es-act, #esSheet input, #esSheet select')).filter(n => n.offsetParent && n.getBoundingClientRect().height < 43.5).map(n => n.id || n.getAttribute('data-act')) }; })()");
      check("estimator, phone: the sheet fills the screen", st.w === st.vw && st.top === 0, J(st));
      check("estimator, phone: Save is in view", st.saveBottom <= st.vh && st.saveH >= 44, J(st));
      check("estimator, phone: no price box, no notes, no amount; number pads", !st.prices && !st.money && st.decimal >= 4, J(st));
      check("estimator, phone: every control at least 44 px high", st.small.length === 0, J(st.small));
      await shoot(m, "item_sheet_estimator", "phone", false);
      await shoot(m, "item_sheet_estimator", "phone", true);
    }, m);
    await attempt("estimator, phone: a quantity saved", async () => {
      await type(m, "#ef_labor_days", "4");
      await click(m, "#esSave");
      await m.until(sheetClosed, 8000);
      await m.until("document.getElementById('pane-estimate').innerText.indexOf('2 guys × 4 days') !== -1", 8000);
      check("estimator, phone: saved, and the card says 2 guys × 4 days", true);
    }, m);
    await attempt("estimator, phone: words that quote an amount are refused before anything is sent; leaving asks Save changes? first", async () => {
      await openItem(m, "Deck framing 12x16");
      await m.until(sheetOpen, 5000);
      const before = await m.eval("DCR2Demo.engine.rows.estimate_items.find(i => i.name === 'Deck framing 12x16').version");
      await type(m, "#ef_material_description", "PT 2x8, about $18 each");
      await click(m, "#esSave");
      await m.until("/price boxes/.test(document.getElementById('esSheetErr').textContent)", 4000);
      const after = await m.eval("DCR2Demo.engine.rows.estimate_items.find(i => i.name === 'Deck framing 12x16').version");
      check("estimator, phone: Rule C before sending - nothing written", before === after, before + " / " + after);
      // owner 2026-10-27 (E): Save changes? - Cancel | Don't save | Save (DCR Desktop 2's question)
      await click(m, ".es-sheet-ft [data-act=close]");
      await m.until(saveAsked, 4000);
      const q = await m.eval("(() => { const h = document.getElementById('dcrModalHost'); return { text: h.innerText, buttons: Array.from(h.querySelectorAll('.dcr-mo-ft button')).map(b => b.innerText.trim()), " +
        "focus: document.activeElement && document.activeElement.id, off: Array.from(h.querySelectorAll('.dcr-mo-ft button')).filter(b => b.getBoundingClientRect().right > innerWidth).length }; })()");
      check("estimator, phone: closing a changed item asks Save changes? - Cancel | Don't save | Save, Save the default, all in view",
        /This item has changes that are not saved yet/.test(q.text) && J(q.buttons) === J(["Cancel", "Don't save", "Save"]) && q.focus === "dcrMoYes" && q.off === 0, J(q));
      await shoot(m, "save_changes_estimator", "phone", false);
      await shoot(m, "save_changes_estimator", "phone", true);
      await click(m, "#dcrMoNo");
      await m.until("!document.getElementById('dcrModalHost').classList.contains('open')", 4000);
      check("estimator, phone: Cancel stays on the sheet, what was typed kept", await m.eval(sheetOpen + " && /\\$18/.test(document.getElementById('ef_material_description').value)"));
      await click(m, ".es-x");
      await m.until(saveAsked, 4000);
      await click(m, "#dcrMoYes");
      await m.until("!document.getElementById('dcrModalHost').classList.contains('open') && /price boxes/.test(document.getElementById('esSheetErr').textContent)", 4000);
      const still = await m.eval("DCR2Demo.engine.rows.estimate_items.find(i => i.name === 'Deck framing 12x16').version");
      check("estimator, phone: Save that the database would refuse keeps the sheet open, saying why; nothing written", (await m.eval(sheetOpen)) && still === before, still + " / " + before);
      await click(m, ".es-sheet-bg");
      await m.until(saveAsked, 4000);
      await click(m, "#dcrMoAlt");
      await m.until(sheetClosed, 4000);
      const end = await m.eval("DCR2Demo.engine.rows.estimate_items.find(i => i.name === 'Deck framing 12x16')");
      check("estimator, phone: Don't save closes, nothing written", end.version === before && !/\$18/.test(end.material_description || ""), J([end.version, end.material_description]));
    }, m);
    await attempt("estimator, phone: the approved estimate keeps its type, quantities and items; a word that quotes an amount is shown amount-free, read only", async () => {
      await openItem(m, "Floor joists and subfloor");
      await m.until(sheetOpen, 5000);
      const st = await m.eval("(() => ({ type: document.getElementById('ef_item_type').disabled, guys: document.getElementById('ef_labor_guys').disabled, " +
        "del: document.querySelector('.es-sheet-ft [data-act=deleteItem]').disabled, name: document.getElementById('ef_name').disabled }))()");
      check("estimator, phone: approved - type, quantities and Delete kept; the name still editable", st.type && st.guys && st.del && !st.name, J(st));
      await click(m, ".es-x");
      await m.until(sheetClosed, 4000);
      await openItem(m, "Exterior walls 2x6");
      await m.until(sheetOpen, 5000);
      const lk = await m.eval("(() => { const n = document.getElementById('ef_description'); return { disabled: n.disabled, masked: n.dataset.masked, words: n.value, title: n.title }; })()");
      check("estimator, phone: the locked description - amount-free, read only, its reason", lk.disabled && lk.masked === "1" && /\[amount\]/.test(lk.words) && /Contains an amount/.test(lk.title), J(lk));
      await click(m, ".es-x");
      await m.until(sheetClosed, 4000);
    }, m);
    await attempt("estimator, phone: a new change order, a new group (a name only: Empty), an item of two lines in it, the group renamed, an empty group deleted", async () => {
      await click(m, "#esNewCo");
      await m.until("document.getElementById('dcrModalHost') && document.getElementById('dcrModalHost').classList.contains('open')", 4000);
      await m.eval("(() => { const i = document.getElementById('dcrMoF0'); i.value = 'Web blocking at the stairs'; return true; })()");
      await modalYes(m);
      await m.until("document.getElementById('pane-estimate').innerText.indexOf('CO #3 — Web blocking at the stairs') !== -1", 8000);
      check("estimator, phone: the new change order got the next number (CO #3)", true);
      const eid = await m.eval("DCR2Demo.engine.rows.estimates.find(e => e.name === 'Web blocking at the stairs').id");
      const card = "document.querySelector('.es-card[data-est=\"" + eid + "\"]')";
      const groupRows = "Array.from(" + card + ".querySelectorAll('.pj-grp td')).map(t => t.innerText.replace(/\\s+/g, ' ').trim().toLowerCase())";
      // ＋ New group: the name only - the group starts empty
      await click(m, "[data-act=addgrp][data-est=\"" + eid + "\"]");
      await m.until(sheetOpen, 5000);
      const ng = await m.eval("(() => ({ boxes: Array.from(document.querySelectorAll('#esNewGrpForm [data-key]')).map(n => n.getAttribute('data-key')) }))()");
      check("estimator, phone: New group asks a name only (no code, no first item)", J(ng.boxes) === J(["group_name"]), J(ng));
      await type(m, "#ef_group_name", "Stairs");
      await click(m, "#esSave");
      await m.until(sheetClosed, 8000);
      await m.until(groupRows + ".indexOf('stairs empty') !== -1", 8000);
      const g1 = await m.eval("(() => { const e = DCR2Demo.engine.rows.estimates.find(x => x.name === 'Web blocking at the stairs'); return [e.group_order, DCR2Demo.engine.rows.estimate_items.filter(i => i.estimate_id === e.id && !i.deleted_at).length]; })()");
      check("estimator, phone: the empty group is a name in the group order, no item written", J(g1) === J([["Stairs"], 0]), J(g1));
      await shoot(m, "empty_group_estimator", "phone", false);
      // ＋ Item into it: a name of two lines (the name is a text area)
      await click(m, ".es-card[data-est=\"" + eid + "\"] [data-act=add]");
      await m.until(sheetOpen, 5000);
      await type(m, "#ef_name", "Blocking at the stair stringers\nboth sides, 16\" o.c.");
      const nb = await m.eval("(() => { const n = document.getElementById('ef_name'); return { tag: n.tagName, rows: n.rows, h: Math.round(n.getBoundingClientRect().height) }; })()");
      check("estimator, phone: the item name is a text area that grew to its two lines", nb.tag === "TEXTAREA" && nb.rows === 2 && nb.h >= 44, J(nb));
      await m.eval("(() => { const s = document.getElementById('ef_item_type'); s.value = 'labor'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
      await type(m, "#ef_labor_guys", "2");
      await type(m, "#ef_labor_days", "1");
      await shoot(m, "item_name_two_lines_estimator", "phone", false);
      await click(m, "#esSave");
      await m.until(sheetClosed, 8000);
      await m.until("document.getElementById('pane-estimate').innerText.indexOf('Blocking at the stair stringers') !== -1", 8000);
      const row = await m.eval("(() => { const i = DCR2Demo.engine.rows.estimate_items.find(x => /^Blocking at the stair stringers/.test(x.name)); const p = DCR2Demo.engine.rows.estimate_item_prices.find(x => x.item_id === i.id); return [i.group_name, i.name, i.item_type, p.labor_rate]; })()");
      check("estimator, phone: the item in the new group, its two lines kept, a labor item, the project's rate on its price row",
        J(row) === J(["Stairs", "Blocking at the stair stringers\nboth sides, 16\" o.c.", "labor", 90]), J(row));
      // opened and saved as it is: the two lines are not rewritten
      const v0 = await m.eval("DCR2Demo.engine.rows.estimate_items.find(x => /^Blocking at the stair stringers/.test(x.name)).version");
      await openItem(m, "Blocking at the stair stringers");
      await m.until(sheetOpen, 5000);
      await click(m, "#esSave");
      await m.until(sheetClosed, 8000);
      const v1 = await m.eval("DCR2Demo.engine.rows.estimate_items.find(x => /^Blocking at the stair stringers/.test(x.name)).version");
      check("estimator, phone: a two-line name opened and saved as it was sends nothing", v0 === v1, v0 + " / " + v1);
      await click(m, "[data-act=grp][data-est=\"" + eid + "\"]");
      await m.until(sheetOpen, 5000);
      await type(m, "#ef_group_name", "Stair blocking");
      await click(m, "#esSheet [data-act=rename]");
      await m.until(sheetClosed, 8000);
      await m.until("Array.from(document.querySelectorAll('#pane-estimate .pj-grp td')).some(t => t.innerText.trim() === 'Stair blocking')", 8000);
      check("estimator, phone: the group renamed", true);
      // a second group, left empty, deleted from its sheet
      await click(m, "[data-act=addgrp][data-est=\"" + eid + "\"]");
      await m.until(sheetOpen, 5000);
      await type(m, "#ef_group_name", "Rail");
      await click(m, "#esSave");
      await m.until(sheetClosed, 8000);
      await m.until(groupRows + ".indexOf('rail empty') !== -1", 8000);
      await m.eval("(() => { const r = Array.from(" + card + ".querySelectorAll('.pj-grp')).find(x => /^Rail/.test(x.innerText.trim())); r.querySelector('[data-act=grp]').click(); return true; })()");
      await m.until(sheetOpen, 5000);
      const dl = await m.eval("(() => { const b = document.querySelector('#esSheet [data-act=gdelete]'); return { there: !!b, disabled: b ? b.disabled : null }; })()");
      check("estimator, phone: an empty group's sheet offers Delete group", dl.there && dl.disabled === false, J(dl));
      await shoot(m, "empty_group_sheet_estimator", "phone", false);
      await click(m, "#esSheet [data-act=gdelete]");
      await m.until(sheetClosed, 8000);
      await m.until(groupRows + ".indexOf('rail empty') === -1", 8000);
      const g2 = await m.eval("DCR2Demo.engine.rows.estimates.find(x => x.name === 'Web blocking at the stairs').group_order");
      check("estimator, phone: the empty group deleted (the order without it)", J(g2) === J(["Stair blocking"]), J(g2));
      await click(m, "[data-act=grp][data-est=\"" + eid + "\"]");
      await m.until(sheetOpen, 5000);
      const full = await m.eval("(() => { const b = document.querySelector('#esSheet [data-act=gdelete]'); return { disabled: b.disabled, title: b.title }; })()");
      check("estimator, phone: a group with items is not deleted (move or delete its items first)", full.disabled && /Move or delete its items first/.test(full.title), J(full));
      await click(m, ".es-x");
      await m.until(sheetClosed, 4000);
      check("estimator, phone: still no horizontal scroll", await noScroll(m), await m.eval("document.documentElement.scrollWidth"));
    }, m);
    await attempt("estimator, phone: someone else rearranges the groups while a sheet is open (the gids are per read) - a new item and Move to group go into the group named, never another or General", async () => {
      const eid = await m.eval("DCR2Demo.engine.rows.estimates.find(e => e.name === 'Web blocking at the stairs').id");
      const card = "document.querySelector('.es-card[data-est=\"" + eid + "\"]')";
      const groupRows = "Array.from(" + card + ".querySelectorAll('.pj-grp td')).map(t => t.innerText.replace(/\\s+/g, ' ').trim().toLowerCase()).join('|')";
      const order = (names) => m.eval("DCR2Demo.remoteEdit('estimates', " + eid + ", { group_order: " + J(names) + " }, 'admin'); true");
      const shows = (rows) => m.until(groupRows + " === " + J(rows.join("|")), 8000);
      const gidOf = (title) => m.eval("(() => { const r = Array.from(" + card + ".querySelectorAll('.pj-grp')).find(x => x.innerText.trim().replace(/\\s+empty$/i, '') === " + J(title) + "); " +
        "return r ? r.querySelector('[data-act=grp]').getAttribute('data-grp') : null; })()");
      const groupOf = (name) => m.eval("(() => { const i = DCR2Demo.engine.rows.estimate_items.find(x => x.name === " + J(name) + " && !x.deleted_at); return i ? i.group_name : '(none)'; })()");
      const fillLabor = async (name) => {
        await type(m, "#ef_name", name);
        await m.eval("(() => { const s = document.getElementById('ef_item_type'); s.value = 'labor'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
        await type(m, "#ef_labor_guys", "1");
        await type(m, "#ef_labor_days", "1");
      };
      await order(["Stair blocking", "Alpha", "Beta"]);
      await shows(["stair blocking", "alpha empty", "beta empty"]);
      // ＋ Item under Beta (g3), then Beta moved up elsewhere: g3 is Alpha now
      const beta = await gidOf("Beta");
      await click(m, ".es-card[data-est=\"" + eid + "\"] [data-act=add][data-grp=\"" + beta + "\"]");
      await m.until(sheetOpen, 5000);
      await order(["Stair blocking", "Beta", "Alpha"]);
      await shows(["stair blocking", "beta empty", "alpha empty"]);
      check("estimator, phone: the live read gave Beta's old gid to Alpha", (await gidOf("Alpha")) === beta, beta);
      await fillLabor("Rail posts");
      await click(m, "#esSave");
      await m.until(sheetClosed, 8000);
      const g1 = await groupOf("Rail posts");
      check("estimator, phone: the new item went into Beta, the group its sheet named", g1 === "Beta", g1);
      // ＋ Item under Alpha, then Alpha deleted elsewhere: said, refused, never General
      await shows(["stair blocking", "beta", "alpha empty"]);
      await click(m, ".es-card[data-est=\"" + eid + "\"] [data-act=add][data-grp=\"" + (await gidOf("Alpha")) + "\"]");
      await m.until(sheetOpen, 5000);
      await order(["Stair blocking", "Beta"]);
      await m.until("/renamed or deleted by someone else/.test(document.getElementById('esSheetNotice').textContent)", 8000);
      await fillLabor("Alpha posts");
      await click(m, "#esSave");
      await m.until("/renamed or deleted by someone else/.test(document.getElementById('esSheetErr').textContent)", 4000);
      const g2 = await groupOf("Alpha posts");
      check("estimator, phone: its group deleted meanwhile - the new item is refused with the reason, nothing added", g2 === "(none)" && (await m.eval(sheetOpen)), g2);
      await click(m, ".es-x");
      await m.until(saveAsked, 4000);
      await click(m, "#dcrMoAlt");
      await m.until(sheetClosed, 4000);
      // an item sheet open, a group added ahead elsewhere: Move to group's choice is still the group picked
      await openItem(m, "Rail posts");
      await m.until(sheetOpen, 5000);
      await order(["Zeta", "Stair blocking", "Beta"]);
      await shows(["zeta empty", "stair blocking", "beta"]);
      await m.eval("(() => { const s = document.getElementById('efToGroup'); s.value = Array.from(s.options).find(o => o.text === 'Stair blocking').value; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
      await click(m, "#esSheet [data-act=toGroup]");
      await m.until("(() => { const i = DCR2Demo.engine.rows.estimate_items.find(x => x.name === 'Rail posts' && !x.deleted_at); return i.group_name !== 'Beta'; })()", 8000);
      const g3 = await groupOf("Rail posts");
      check("estimator, phone: Move to group - into Stair blocking, the group picked (its old gid is Zeta's now)", g3 === "Stair blocking", g3);
      await m.until(sheetOpen + " && document.getElementById('pane-estimate').getAttribute('aria-busy') !== 'true'", 8000);
      await click(m, ".es-x");
      await m.until(sheetClosed, 4000);
    }, m);

    /* ── Robin Estimator on a desk ──────────────────────────────────────── */
    const d = await newPage(cdp, "estimator-desk", OUT); pages.push(d);
    await d.size(1280, 900, false);
    await signIn(d, "estimator");
    await attempt("estimator, desk: a centred sheet; the estimate sheet without Approved, Duplicate or terms", async () => {
      await d.goto(base + "/project.html?id=" + PID + "&tab=estimate", 300);
      await d.until(editorReady, 15000);
      await shoot(d, "tab_estimator", "desktop", false);
      await click(d, "[data-act=est][data-est=\"2\"]");
      await d.until(sheetOpen, 5000);
      const st = await d.eval("(() => { const c = document.querySelector('#esSheet .es-sheet-card').getBoundingClientRect(); const s = document.getElementById('ef_status'); " +
        "return { w: Math.round(c.width), approved: Array.from(s.options).some(o => o.value === 'approved'), dup: !!document.querySelector('#esSheet [data-act=duplicate]'), terms: !!document.getElementById('ef_client_notes') }; })()");
      check("estimator, desk: the sheet is 640 px wide at most", st.w <= 640 && st.w > 400, J(st));
      check("estimator, desk: no Approved, no Duplicate, no terms", !st.approved && !st.dup && !st.terms, J(st));
      await shoot(d, "estimate_sheet_estimator", "desktop", false);
      await click(d, ".es-x");
      await d.until(sheetClosed, 4000);
    }, d);
    await attempt("estimator, desk: Save changes? - Save saves, then the sheet closes; the New group sheet asks too (Esc)", async () => {
      await openItem(d, "Deck framing 12x16");
      await d.until(sheetOpen, 5000);
      await type(d, "#ef_labor_days", "5");
      await click(d, ".es-x");
      await d.until(saveAsked, 4000);
      await shoot(d, "save_changes_estimator", "desktop", false);
      await shoot(d, "save_changes_estimator", "desktop", true);
      await click(d, "#dcrMoYes");
      await d.until(sheetClosed, 8000);
      const days = await d.eval("Number(DCR2Demo.engine.rows.estimate_items.find(i => i.name === 'Deck framing 12x16').labor_days)");
      check("estimator, desk: Save changes? → Save - saved, then closed", days === 5, days);
      await click(d, "[data-act=addgrp][data-est=\"2\"]");
      await d.until(sheetOpen, 5000);
      await type(d, "#ef_group_name", "Porch");
      await d.eval("(() => { document.getElementById('ef_group_name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()");
      await d.until(saveAsked + " && /This new group is not added yet/.test(document.getElementById('dcrModalHost').innerText)", 4000);
      await click(d, "#dcrMoYes");
      await d.until(sheetClosed, 8000);
      const go = await d.eval("DCR2Demo.engine.rows.estimates.find(e => e.id === 2).group_order");
      check("estimator, desk: the New group sheet asks Save changes? too; Save adds the group", J(go) === J(["Deck", "Porch"]), J(go));
    }, d);

    /* ── Quinn Manager: an Estimator with prices ────────────────────────── */
    const q = await newPage(cdp, "manager2-desk", OUT); pages.push(q);
    await q.size(1280, 900, false);
    await signIn(q, "manager2");
    await attempt("estimator with prices: the price boxes and the live total; Approved offered", async () => {
      await q.goto(base + "/project.html?id=" + PID + "&tab=estimate", 300);
      await q.until(editorReady, 15000);
      check("estimator with prices: the money on the cards", await q.eval(DOLLARS + ".test(document.getElementById('pane-estimate').innerText)"));
      await openItem(q, "Deck framing 12x16");
      await q.until(sheetOpen, 5000);
      const boxes = await q.eval("['labor_rate','labor_unit_price','labor_markup_pct','material_unit_price','material_markup_pct','notes'].every(k => !!document.querySelector('#esItemForm [name=' + k + ']'))");
      check("estimator with prices: every price box and the notes", boxes);
      const t0 = await q.eval("document.getElementById('esLive').innerText");
      await type(q, "#ef_material_unit_price", "20");
      const t1 = await q.eval("document.getElementById('esLive').innerText");
      check("estimator with prices: the live total follows the boxes", t0 !== t1 && /Total \$/.test(t1), t0 + " -> " + t1);
      await shoot(q, "item_sheet_prices", "desktop", false);
      await shoot(q, "item_sheet_prices", "desktop", true);
      // someone else saves this item while the sheet is open and changed
      await type(q, "#ef_material_qty", "30");
      const id = await q.eval("DCR2Demo.engine.rows.estimate_items.find(i => i.name === 'Deck framing 12x16').id");
      await q.eval("DCR2Demo.remoteEdit('estimate_items', " + id + ", { material_qty: 25 }, 'admin'); true");
      await q.until("/your Save checks for clashes/.test(document.getElementById('esSheetNotice').textContent)", 8000);
      check("estimator with prices: someone else's save is said, what was typed kept", await q.eval("document.getElementById('ef_material_qty').value === '30'"));
      await click(q, "#esSave");
      await q.until("!!document.getElementById('esClash') && /Material qty: theirs/.test(document.getElementById('esClash').innerText)", 8000);
      check("estimator with prices: the conflict panel names the field both changed", true);
      await shoot(q, "conflict_prices", "desktop", false);
      await click(q, "#esClash [data-act=useMine]");
      await q.until(sheetClosed, 8000);
      const saved = await q.eval("(() => { const i = DCR2Demo.engine.rows.estimate_items.find(x => x.id === " + id + "); const p = DCR2Demo.engine.rows.estimate_item_prices.find(x => x.item_id === i.id); return [i.material_qty, p.material_unit_price]; })()");
      check("estimator with prices: Use mine - the quantity and the price, on the current versions", J(saved) === J([30, 20]), J(saved));
      await click(q, "[data-act=est][data-est=\"2\"]");
      await q.until(sheetOpen, 5000);
      check("estimator with prices: Approved and Duplicate offered", await q.eval("Array.from(document.getElementById('ef_status').options).some(o => o.value === 'approved') && !!document.querySelector('#esSheet [data-act=duplicate]')"));
      await click(q, ".es-x");
    }, q);

    /* ── no Estimator switch: the read-only tab ─────────────────────────── */
    for (const key of ["manager", "lead"]) {
      const r = await newPage(cdp, key + "-desk", OUT); pages.push(r);
      await r.size(1280, 900, false);
      await signIn(r, key);
      await attempt(key + ": the read-only tab", async () => {
        await r.goto(base + "/project.html?id=" + PID + "&tab=estimate", 300);
        await r.until(readOnlyReady, 15000);
        const st = await r.eval("(() => { const p = document.getElementById('pane-estimate'); return { acts: p.querySelectorAll('[data-act]').length, add: !!document.getElementById('esNewEst'), " +
          "editor: p.classList.contains('es-editor'), money: " + DOLLARS + ".test(p.innerHTML) }; })()");
        check(key + ": view only - no edit control, the editor never loaded", st.acts === 0 && !st.add && !st.editor && !st.money, J(st));
        const loaded = await r.eval("performance.getEntriesByType('resource').some(e => /project-estimate-edit\\.js|estimate-edit\\.js|est-sheet\\.js/.test(e.name))");
        check(key + ": the editor's code was not downloaded", !loaded);
      }, r);
    }
  } finally {
    const all = pages.flatMap((p) => p.log.map((e) => Object.assign({ page: p.name }, e)));
    const csp = all.filter((e) => /CSP-VIOLATION|Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(e.text));
    const errors = all.filter((e) => e.level === "exception" ||
      (e.level === "error" && !/CSP-VIOLATION/.test(e.text) && !/favicon\.ico|net::ERR_ABORTED/.test(e.text + " " + (e.url || ""))));
    results.push({ name: "no Content-Security-Policy violation on any page", ok: csp.length === 0, detail: csp.slice(0, 10) });
    results.push({ name: "no console error on any page", ok: errors.length === 0, detail: errors.slice(0, 10) });
    const failed = results.filter((x) => !x.ok);
    console.log(JSON.stringify({ ok: !failed.length, passed: results.length - failed.length, failed: failed.length, results, shots: shots.length,
      screenshots: shots, out: OUT }, null, 2));
    try { await cdp.send("Browser.close"); } catch (e) { /* */ }
    try { proc.kill(); } catch (e) { /* */ }
    server.close();
    process.exitCode = failed.length ? 1 : 0;
  }
}

main().catch((e) => { console.error(e); process.exit(2); });
