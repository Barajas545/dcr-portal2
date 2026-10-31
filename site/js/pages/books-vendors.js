/* Vendors - books-vendors.html (the Books program, release B part 2b; design-portal §6.2 with the build plan's I6, I25,
   S3, S4, S12 and S17; DCR Desktop 2 migrations 20261030000500_books_reports and 20261030000200's vendor_profiles).

   * One line per vendor (the database's books_vendor_balances: every vendor of a live bill - its contact, else its
     name, "not linked to a contact" -, every subcontractor, supplier and service contact, every contact with vendor
     details): the picture or initials, what we owe and how much of it is past due, paid this year and last year, and
     the facts - 1099, W-9 on file or missing, insurance (COI) and workers' comp: red once run out, gold within 30 days.
   * Filters: All · We owe them · 1099 · W-9 missing · Insurance to renew; a search; the CSV (every cell quoted, the
     formula guard, a BOM, CRLF) and Print (a header, no buttons).
   * [Details] (money editors, a vendor with a contact): 1099 or not, the W-9's legal name and day, insurance and
     workers' comp (a day, or exempt), the license number, notes - an upsert of vendor_profiles at the version shown
     (repo/vendors.js saveProfile: PT409 shows theirs). Dates and flags only: never a tax id (S12). The contact card
     (pages/contact-card.js, through the avatar or [Phone, e-mail & picture]) for their reach and picture.
   * The 1099 worksheet (books_1099): the year, the threshold the database uses - shown, and editable for this view
     only (never stored) -, what counts (check, cash, transfer, other) and what does not (card, materials), reportable
     and "needs a W-9". A worksheet, not a filing: confirm with the CPA. The rows carry the year they were read for
     (state.wYear): the sentence and the CSV's name use it; the CSV is off while a read runs, and only the latest
     Show's answer is drawn.
   WITHOUT the prices switch (S4) no amount is read or shown: the vendors' facts only, and no 1099 worksheet - and the
   same, said so, while the database has no books_vendor_balances yet (release B part 2a on its own). Only with the
   financials switch: anyone else is told so and sent home before anything is read. Every database word is escaped (h)
   or set as text. Nothing here approves or pays. */

import { boot, esc, toast, errorText, D, can, seesPrices } from "./shell.js";
import { avatarHtml, paintAvatars, openCard } from "./avatar.js";
import { openSheet, ensureSheetStyle } from "./books-nav.js";
import * as repo from "../repo/vendors.js";
import * as reports from "../repo/books-reports.js";
import { FILTERS, filterVendors, vendorCounts, vendorColumns, insuranceText, wcText, w9Text, threshold1099, thresholdWords, parseThreshold,
  years1099, to1099, COLUMNS_1099, LIMITS } from "../map/vendors.js";
import { seesBooks, fmtMoney, toCsv, plural, shortDay } from "../map/books.js";
import { printLine, csvFile } from "../map/books-reports.js";

const h = esc;
const state = { me: null, d: null, show: "", q: "", year: null, threshold: null, w: null, wYear: null, wBusy: false, wError: "", wSeq: 0 };
// amounts only with the prices switch AND the database's sums read (a database without books_vendor_balances yet: none)
const prices = () => seesPrices(state.me) && !(state.d && state.d.noSums);
const NO_SUMS = "What we owe and paid, and the 1099 worksheet, come with the next database update (the Books reports): " +
  "until then the list shows each vendor's facts.";
const money = () => can(state.me, "money");
const amt = (v) => (prices() ? h(fmtMoney(v)) : "");

/* ── one vendor ── */

function contactOf(v) {
  return v && v.contactId !== null && state.d ? state.d.contacts.get(String(v.contactId)) || null : null;
}

export function rowHtml(v, today) {
  const k = contactOf(v);
  const w9 = w9Text(v, today), ins = insuranceText(v, today), wc = wcText(v, today);
  let s = '<div class="vd-row" data-vendor="' + h(v.key) + '">' +
    '<div class="vd-name"><span class="av-name">' + avatarHtml(k, { size: 32, name: v.name, edit: can(state.me, "contacts") }) +
      '<span class="av-t"><span class="who">' + h(v.name) + "</span>" +
      (v.kindLabel ? '<span class="vd-chip">' + h(v.kindLabel) + "</span>" : "") +
      (v.linked ? "" : '<span class="vd-chip nolink">not linked to a contact</span>') + "</span></span>" +
      ((v.legalName || v.license) ? '<div class="meta">' + (v.legalName ? "W-9 name: " + h(v.legalName) : "") + (v.legalName && v.license ? " · " : "") +
        (v.license ? "License " + h(v.license) : "") + "</div>" : "") + "</div>";
  if (v.hasMoney && prices()) {
    s += '<div class="vd-num"><span class="lab">We owe</span><b>' + amt(v.owed) + "</b>" +
      (v.pastDue > 0 ? '<span class="sub late">' + amt(v.pastDue) + " past due</span>" : v.openBills ? '<span class="sub">' + h(plural(v.openBills, "open bill", "open bills")) + "</span>" : "") + "</div>" +
      '<div class="vd-num"><span class="lab">Paid this year</span><b>' + amt(v.paidYtd) + "</b>" +
      '<span class="sub">last year ' + amt(v.paidLastYear) + "</span></div>";
  }
  s += '<div class="vd-facts">' +
    (v.tax1099 ? '<span class="vd-f t1099">1099</span>' : "") +
    (v.linked ? '<span class="vd-f ' + h(w9.cls) + '">W-9 ' + h(w9.text) + "</span>" : "") +
    (v.linked ? '<span class="vd-f ' + h(ins.cls) + '">Insurance ' + h(ins.text) + "</span>" : "") +
    (v.linked ? '<span class="vd-f ' + h(wc.cls) + '">Workers\' comp ' + h(wc.text) + "</span>" : "") +
    (v.hasMoney && prices() && v.lastPaidDate ? '<span class="vd-f">last paid ' + h(shortDay(v.lastPaidDate)) + "</span>" : "") + "</div>";
  s += '<div class="vd-acts">' + (money() && v.linked ? '<button type="button" class="ac-b" data-details="' + h(v.key) + '">Details</button>' : "") + "</div>";
  return s + "</div>";
}

function listHtml(rows, today) {
  const withMoney = prices();
  if (!rows.length) return '<div class="ac-none">' + (state.d.vendors.length ? "None of these." : "No vendors yet.") + "</div>";
  return '<div class="vd-list' + (withMoney ? "" : " facts") + '" id="vdList">' +
    '<div class="vd-head" aria-hidden="true"><span>Vendor</span>' + (withMoney ? '<span class="num">We owe</span><span class="num">Paid this year</span>' : "") +
    "<span>1099 · W-9 · insurance · workers' comp</span><span></span></div>" +
    rows.map((v) => rowHtml(v, today)).join("") + "</div>";
}

function shown() { return filterVendors(state.d.vendors, { show: state.show, q: state.q }, state.d.today); }

/* ── the 1099 worksheet ── */

function worksheetHtml() {
  if (!prices()) {
    return '<div class="ac-sec vd-1099" id="vd1099"><header><h3>1099 worksheet</h3></header><div class="ac-note">' +
      (state.d && state.d.noSums ? h(NO_SUMS) : "The 1099 worksheet carries amounts: it needs the prices switch. Ask an admin.") + "</div></div>";
  }
  const years = years1099(state.d.today);
  const y = state.year || years[0];
  const t = state.threshold;
  let s = '<div class="ac-sec vd-1099" id="vd1099"><header><h3>1099 worksheet</h3><span class="hint">Cash basis, by the date on the check. Card payments ' +
    "(on the card company's 1099-K) and materials suppliers' bills don't count. A worksheet, not a filing.</span><span class=\"grow\"></span>" +
    '<button type="button" class="ac-b rg-noprint" id="vd1099Csv"' + (state.w && state.w.length && !state.wBusy ? "" : " disabled") + ">&#8615; CSV</button></header>" +
    '<div class="rp-ctl rg-noprint"><label>Year<select id="vdYear">' + years.map((x) => '<option value="' + h(x) + '"' + (x === y ? " selected" : "") + ">" + h(x) + "</option>").join("") +
    '</select></label><label>Threshold<input id="vdThreshold" class="num" inputmode="decimal" placeholder="' + h(fmtMoney(threshold1099(y))) + '" value="' + h(t === null || t === undefined ? "" : t) + '"></label>' +
    '<button type="button" class="ac-b" id="vd1099Go">Show</button></div>' +
    '<div class="vd-words" id="vd1099Words"><b>' + h(thresholdWords(y, t)) + "</b> For this view only: it is never saved.</div>";
  if (state.wError) s += '<div class="ac-msg err" role="status">' + h(state.wError) + "</div>";
  if (state.wBusy) return s + '<div class="ac-none rp-busy" role="status">Working it out…</div></div>';
  if (!state.w) return s + "</div>";
  const ry = state.wYear || y;     // the year the rows were read for
  if (!state.w.length) return s + '<div class="ac-none">Nobody was paid in ' + h(ry) + ".</div></div>";
  const lines = state.w;
  const n = lines.filter((r) => r.reportable).length, need = lines.filter((r) => r.needsW9).length;
  s += '<div class="rp-sum"><b>' + h(plural(n, "vendor gets", "vendors get")) + " a 1099</b> for " + h(ry) +
    (need ? " · " + h(plural(need, "vendor needs", "vendors need")) + " a W-9 first" : "") + "</div>";
  s += '<div class="rp-scroll"><table class="ac-t rp-t" id="vd1099Table"><thead><tr><th>Vendor</th><th class="num">Check</th><th class="num">Cash</th><th class="num">Transfer</th>' +
    '<th class="num">Other</th><th class="num">Counts</th><th class="num">Card · materials</th><th>1099</th></tr></thead><tbody>' +
    lines.map((r) => "<tr>" +
      '<td><span class="who">' + h(r.name) + "</span>" + (r.legalName ? '<span class="sub">W-9: ' + h(r.legalName) + "</span>" : "") +
        (r.linked ? "" : '<span class="sub">not linked to a contact</span>') + "</td>" +
      '<td class="num">' + amt(r.check) + '</td><td class="num">' + amt(r.cash) + '</td><td class="num">' + amt(r.transfer) + '</td><td class="num">' + amt(r.other) + "</td>" +
      '<td class="num"><b>' + amt(r.total) + "</b></td>" +
      '<td class="num">' + amt(r.card) + '<span class="sub">' + amt(r.materials) + "</span></td>" +
      "<td>" + (r.reportable ? '<span class="vd-f t1099">reportable</span>' : r.total >= r.threshold ? '<span class="vd-f">over · not flagged 1099</span>' : '<span class="vd-f">under</span>') +
        (r.needsW9 ? ' <span class="vd-f missing">needs a W-9</span>' : "") + "</td></tr>").join("") +
    "</tbody></table></div>";
  return s + "</div>";
}

async function runWorksheet() {
  const sel = document.getElementById("vdYear"), inp = document.getElementById("vdThreshold");
  const y = sel ? Number(sel.value) : state.year;
  const t = inp ? parseThreshold(inp.value) : state.threshold;
  if (Number.isNaN(t)) { state.wError = "Type the threshold as dollars, e.g. 2000."; paintWorksheet(); return; }
  state.year = y; state.threshold = t; state.wError = ""; state.wBusy = true;
  const seq = ++state.wSeq;
  paintWorksheet();
  let rows = null, err = "";
  try {
    rows = (await reports.worksheet1099(state.me, y, t)).map(to1099);
  } catch (e) {
    err = errorText(e);
  }
  if (seq !== state.wSeq) return;      // a later Show is on its way: its answer is the one drawn
  state.w = rows;
  state.wYear = rows ? y : null;
  state.wError = err;
  state.wBusy = false;
  paintWorksheet();
}

function paintWorksheet() {
  const box = document.getElementById("vd1099");
  if (!box) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = worksheetHtml();
  box.parentNode.replaceChild(tmp.firstChild, box);
  wireWorksheet();
}

function wireWorksheet() {
  const go = document.getElementById("vd1099Go");
  if (go) go.addEventListener("click", runWorksheet);
  const sel = document.getElementById("vdYear");
  if (sel) sel.addEventListener("change", () => { const inp = document.getElementById("vdThreshold"); if (inp) inp.placeholder = fmtMoney(threshold1099(Number(sel.value))); });
  const inp = document.getElementById("vdThreshold");
  if (inp) inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runWorksheet(); } });
  const csv = document.getElementById("vd1099Csv");
  if (csv) csv.addEventListener("click", () => {
    // the rows shown, named for the year they were read for - never while another year is being read
    if (state.w && state.w.length && !state.wBusy) download(toCsv(state.w, COLUMNS_1099), csvFile("1099-" + (state.wYear || state.year), state.d.today), state.w.length);
  });
}

/* ── the page ── */

export function bodyHtml(d) {
  const counts = vendorCounts(d.vendors, d.today);
  let s = '<div class="ac-sec" id="vdSec"><div class="vd-bar">' +
    '<div class="vd-chips" role="group" aria-label="Show">' + FILTERS.filter((f) => !f.money || prices()).map((f) =>
      '<button type="button" data-show="' + h(f.id) + '" aria-pressed="' + (state.show === f.id) + '">' + h(f.label) + "<b>" + h(String(counts[f.id] || 0)) + "</b></button>").join("") + "</div>" +
    '<span class="grow"></span><input type="search" id="vdQ" placeholder="Search a vendor, license or W-9 name" aria-label="Search the vendors" value="' + h(state.q) + '">' +
    '<button type="button" class="ac-b" id="vdCsv">&#8615; CSV</button><button type="button" class="ac-b" id="vdPrint">Print</button></div>' +
    (prices() ? "" : d.noSums ? '<div class="ac-note" id="vdNoSums" style="margin:0 0 8px">' + h(NO_SUMS) + "</div>"
      : '<div class="ac-note" style="margin:0 0 8px">Without the prices switch the list shows each vendor\'s facts, never an amount.</div>') +
    '<div id="vdListBox">' + listHtml(shown(), d.today) + "</div></div>";
  return s + worksheetHtml() +
    '<div class="ac-note rg-noprint">Insurance and workers\' comp turn <b>gold</b> 30 days before they run out and red once they have. ' +
    "The W-9, the certificates and the tax id stay in the office file or QuickBooks: Portal 2 keeps their dates only.</div>";
}

function paintList() {
  const box = document.getElementById("vdListBox");
  if (box) box.innerHTML = listHtml(shown(), state.d.today);
  document.querySelectorAll("[data-show]").forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute("data-show") === state.show)));
  wireList(box);
}

function wireList(box) {
  if (!box) return;
  box.querySelectorAll("[data-details]").forEach((b) => b.addEventListener("click", () => {
    const v = state.d.vendors.find((x) => x.key === b.getAttribute("data-details"));
    if (v) details(v);
  }));
  paintAvatars(box, { me: state.me, onSaved: () => load() });
}

function render() {
  const box = document.getElementById("vdBody");
  if (!box || !state.d) return;
  box.innerHTML = bodyHtml(state.d);
  box.querySelectorAll("[data-show]").forEach((b) => b.addEventListener("click", () => { state.show = b.getAttribute("data-show"); paintList(); }));
  const q = document.getElementById("vdQ");
  if (q) q.addEventListener("input", () => { state.q = q.value; paintList(); });
  const csv = document.getElementById("vdCsv");
  if (csv) csv.addEventListener("click", () => { const rows = shown(); if (rows.length) download(toCsv(rows, vendorColumns(prices())), csvFile("vendors", state.d.today), rows.length); });
  const pr = document.getElementById("vdPrint");
  if (pr) pr.addEventListener("click", () => { printHead(); window.print(); });
  wireList(document.getElementById("vdListBox"));
  wireWorksheet();
}

function printHead() {
  const head = document.getElementById("vdPrintHead");
  const f = FILTERS.find((x) => x.id === state.show);
  if (head && state.d) head.textContent = printLine("Vendors", (f && f.id ? f.label : "every vendor") + (state.q ? " · “" + state.q + "”" : ""), state.d.today, state.me && state.me.name, shown().length);
}

function download(text, name, n) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast("The CSV is downloading: " + plural(n, "line", "lines") + ".", "ok");
}

/* ── the details sheet (money editors) ── */

function formHtml(v) {
  return '<div class="vd-form" id="vdForm">' +
    '<label class="ck"><input type="checkbox" id="vdF1099"' + (v.tax1099 ? " checked" : "") + "> Gets a 1099-NEC (not a corporation)</label>" +
    '<label for="vdFLegal">Legal name on the W-9 (when it is not the name above)</label><input type="text" id="vdFLegal" maxlength="' + LIMITS.legalName + '" value="' + h(v.legalName) + '">' +
    '<div class="two"><div><label for="vdFW9">W-9 received on</label><input type="date" id="vdFW9" value="' + h(v.w9On) + '"></div>' +
    '<div><label for="vdFIns">Insurance (COI) expires on</label><input type="date" id="vdFIns" value="' + h(v.insuranceOn) + '"></div></div>' +
    '<div class="two"><div><label for="vdFWc">Workers\' comp expires on</label><input type="date" id="vdFWc" value="' + h(v.wcExempt ? "" : v.wcOn) + '"' + (v.wcExempt ? " disabled" : "") + "></div>" +
    '<div><label class="ck" style="margin-top:28px"><input type="checkbox" id="vdFWcEx"' + (v.wcExempt ? " checked" : "") + "> Exempt from workers' comp</label></div></div>" +
    '<label for="vdFLic">Contractor\'s license number</label><input type="text" id="vdFLic" maxlength="' + LIMITS.license + '" value="' + h(v.license) + '">' +
    '<label for="vdFNotes">Notes</label><textarea id="vdFNotes" rows="3" maxlength="' + LIMITS.notes + '">' + h(v.notes || "") + "</textarea>" +
    '<div class="ac-note">Dates and flags only. Never type a tax id (an SSN or EIN) here: the W-9 itself stays in the office file or QuickBooks.</div>' +
    '<div class="ac-msg" id="vdFMsg" role="status"></div>' +
    '<div class="bh-foot">' + (can(state.me, "contacts") ? '<button type="button" class="ac-b" id="vdFCard">Phone, e-mail &amp; picture</button><span class="grow" style="flex:1"></span>' : "") +
    '<button type="button" class="ac-b" id="vdFCancel">Cancel</button><button type="button" class="btn-accept" id="vdFSave">Save</button></div></div>';
}

function fill(root, row) {
  const set = (id, val) => { const n = root.querySelector("#" + id); if (n) { if (n.type === "checkbox") n.checked = !!val; else n.value = val == null ? "" : String(val); } };
  set("vdF1099", row.tax_1099);
  set("vdFLegal", row.legal_name);
  set("vdFW9", row.w9_received_on ? String(row.w9_received_on).slice(0, 10) : "");
  set("vdFIns", row.insurance_expires_on ? String(row.insurance_expires_on).slice(0, 10) : "");
  set("vdFWc", row.workers_comp_expires_on ? String(row.workers_comp_expires_on).slice(0, 10) : "");
  set("vdFWcEx", row.workers_comp_exempt);
  set("vdFLic", row.license_number);
  set("vdFNotes", row.notes);
  const wc = root.querySelector("#vdFWc");
  if (wc) wc.disabled = !!row.workers_comp_exempt;
}

function details(v0) {
  if (!money()) return;
  const v = Object.assign({}, v0);
  let saved = false;
  const sh = openSheet({ title: "Vendor details — " + v.name, html: formHtml(v), onClose: () => { if (saved) load(); } });
  const $ = (id) => sh.body.querySelector("#" + id);
  const say = (t, bad) => { const n = $("vdFMsg"); if (n) { n.textContent = t || ""; n.className = "ac-msg" + (bad ? " err" : " ok"); } };
  const ex = $("vdFWcEx");
  if (ex) ex.addEventListener("change", () => { const wc = $("vdFWc"); if (wc) { wc.disabled = ex.checked; if (ex.checked) wc.value = ""; } });
  const cancel = $("vdFCancel");
  if (cancel) cancel.addEventListener("click", () => sh.close());
  const card = $("vdFCard");
  if (card) card.addEventListener("click", () => {
    sh.close();
    openCard(v.contactId, { me: state.me, onSaved: () => load() }).catch((e) => toast(errorText(e), "error"));
  });
  const save = $("vdFSave");
  if (save) save.addEventListener("click", async () => {
    const f = { tax1099: $("vdF1099").checked, legalName: $("vdFLegal").value, w9On: $("vdFW9").value, insuranceOn: $("vdFIns").value,
      wcOn: $("vdFWc").value, wcExempt: $("vdFWcEx").checked, license: $("vdFLic").value, notes: $("vdFNotes").value };
    save.disabled = true;
    sh.setBusy(true);
    say("Saving…");
    try {
      await repo.saveProfile(v, f);
    } catch (e) {
      sh.setBusy(false);
      save.disabled = false;
      if ((e.code === "PT409" || e.status === 409) && e.current) {
        // someone else saved meanwhile: theirs is shown, at its version - check it and save again
        v.profileVersion = Number(e.current.version);
        fill(sh.body, e.current);
        saved = true;
        say("Someone else changed these details meanwhile: theirs are shown. Check them, then save again.", true);
        return;
      }
      say(dbWords(e), true);
      return;
    }
    saved = true;
    sh.setBusy(false);
    toast("Vendor details saved: " + v.name + ".", "ok");
    sh.close();
  });
}

/* a refusal in the database's own words when it gave a sentence (22023 / 23514), else the shared mapping */
function dbWords(e) {
  if (e && (e.code === "22023" || e.code === "23514") && e.message) return e.message[0].toUpperCase() + e.message.slice(1);
  return errorText(e);
}

export async function load() {
  try {
    state.d = await repo.loadVendors(state.me);
    render();
    if (prices() && !state.w && !state.wBusy && !state.wError) runWorksheet();
  } catch (e) {
    /* nothing from before a failed read is drawn again */
    state.d = null;
    const box = document.getElementById("vdBody");
    if (box) box.innerHTML = '<div class="ac-sec" style="color:var(--err)">' + h(errorText(e)) + "</div>";
  }
}

async function start() {
  let me;
  try { me = await boot("books"); } catch (e) { return; }
  state.me = me;
  if (!seesBooks(me)) {
    document.getElementById("vdBody").innerHTML = '<div class="ac-none">The vendor list is not available for your account.</div>';
    const al = D().alert;
    if (typeof al === "function") await al("The vendor list is not available for your role: it needs the financials switch. Ask an admin.", { title: "Not available" });
    location.replace("dashboard.html");
    return;
  }
  document.title = "DCR Portal 2 — Vendors";
  ensureSheetStyle();
  const first = String(me.name || "").split(" ")[0].split("@")[0];
  document.getElementById("vdGreeting").textContent = first ? "— " + first : "";
  window.addEventListener("beforeprint", printHead);
  await load();
}

if (typeof document !== "undefined" && typeof window !== "undefined" && document.getElementById && !(window && window.__VD_TEST__)) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}

export const _test = { state, render: () => render(), bodyHtml, rowHtml, worksheetHtml, load };
