/* The printed Material List / Material Quote of a takeoff (port of the old report-takeoff.html / .js — the
   Access "Material List" — on DCR Desktop 2's data and printing/takeoffs.py rules; MODULES §3
   "report-takeoff.html"; BLUEPRINT 3.3.11).

   ?id=<project>[&tk=<takeoff id>|all][&kind=quote]. The Material List (everybody): letterhead, the project,
   the takeoff band, then one table per level (the level band and the column labels repeat on a new
   page), category and sub-category bands, rows L# | Qty | Unit | Item | Purpose; L# counts 1..N over the
   sheet; a blank or zero quantity prints blank; amounts typed into the words are masked (it goes to the
   yard and the crew). The Material Quote (people with prices only, every row priced): Unit price and Total
   columns, a subtotal per level, Subtotal, Sales tax at the company's rate and GRAND TOTAL.

   A person without prices is never sent a price (rpc takeoff_print) and never sees the quote switch;
   ?kind=quote then prints the Material List. */

import { boot, el, esc, errorText, seesPrices, qs, D } from "./shell.js";
import * as projectsRepo from "../repo/projects.js";
import * as estRepo from "../repo/estimates.js";
import { takeoffSheetHtml } from "./est-render.js";
import { rowsPriced } from "../map/takeoffs.js";
import { wordsFor } from "../map/estimates.js";
import { companyToday, companyInfo } from "../common2.js";

const state = { project: null, list: [], which: null, prices: false, rate: null };

function co() {
  const c = D().companyInfo || companyInfo || ((window.DCR2_CONFIG || {}).COMPANY) || {};
  return Object.assign({ name: "DCR", legalName: "", logo: "icons/logo.jpg" }, c);
}

/** The old footer's stamp: "Wednesday, August 12 - 2026  ( 8:41 PM )", company time. */
export function printedStamp(d) {
  const day = d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric" });
  const year = d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });
  return day + " - " + year + "  ( " + time + " )";
}

function picked() {
  if (state.which === "all") return state.list;
  const hit = state.list.find(function (t) { return String(t.id) === String(state.which); });
  return hit ? [hit] : [];
}

async function render() {
  const list = picked();
  if (!list.length) {
    el("rpSheet").innerHTML = '<div class="rp-loading">' + (state.list.length ? "That takeoff is not there any more — it may have been deleted."
      : "This project has no takeoffs yet. Takeoffs are made in DCR Desktop 2.") + "</div>";
    return;
  }
  const rows = [];
  list.forEach(function (t) { t.rows.forEach(function (r) { rows.push(r); }); });
  const quote = state.prices && el("rpQuote").checked && rows.length > 0 && rowsPriced(rows);
  const out = takeoffSheetHtml(state.project, list, { quote, rate: state.rate || 0, company: co(), date: companyToday(), stamp: printedStamp(new Date()) });
  el("rpSheet").innerHTML = out.html;
  document.title = "DCR " + out.title;
  const quoteRefused = state.prices && el("rpQuote").checked && !quote;
  const note = !state.prices ? "Material List: prices are not shown for your account."
    : quoteRefused ? "A row here has no price yet, so this prints as the Material List (never a misleading $0.00)." : "";
  el("rpNote").hidden = !note;
  el("rpNote").textContent = note;
}

function fillPicker() {
  const sel = el("rpTk");
  if (state.list.length < 2) { sel.hidden = true; return; }
  const w = wordsFor(state.prices);
  sel.hidden = false;
  sel.innerHTML = state.list.map(function (t) {
    return '<option value="' + esc(t.id) + '">' + esc((w(t.name) || "(unnamed takeoff)") + " · " + t.lines + " line" + (t.lines === 1 ? "" : "s")) + "</option>";
  }).join("") + '<option value="all">All takeoffs (' + state.list.length + ")</option>";
  sel.value = String(state.which);
}

function setQuery() {
  try {
    const u = new URL(location.href);
    u.searchParams.set("tk", String(state.which));
    if (state.prices && el("rpQuote").checked) u.searchParams.set("kind", "quote"); else u.searchParams.delete("kind");
    history.replaceState(null, "", u);
  } catch (e) { /* the address is a nicety */ }
}

async function init() {
  const me = await boot(null);
  state.prices = seesPrices(me);
  el("rpPrint").addEventListener("click", function () { window.print(); });
  const pid = qs("id");
  if (!pid || !/^\d{1,18}$/.test(pid)) { el("rpSheet").innerHTML = '<div class="rp-loading">No project selected.</div>'; return; }
  el("rpBack").href = "project.html?id=" + encodeURIComponent(pid) + "&tab=takeoffs";
  el("rpQuoteBox").hidden = !state.prices;
  el("rpQuote").checked = state.prices && qs("kind") === "quote";
  try {
    const res = await Promise.all([projectsRepo.getProject(pid), estRepo.listTakeoffs(pid)]);
    state.project = res[0];
    state.list = res[1].takeoffs;
    state.rate = res[1].taxRate;
    if (!res[1].prices) { state.prices = false; el("rpQuoteBox").hidden = true; el("rpQuote").checked = false; }
  } catch (e) {
    el("rpSheet").innerHTML = '<div class="rp-loading">' + esc(errorText(e)) + "</div>";
    return;
  }
  // no ?tk=: the newest takeoff that has rows (else the newest)
  const want = qs("tk");
  const full = state.list.find(function (t) { return t.lines > 0; }) || state.list[0];
  state.which = want === "all" ? "all" : want && /^\d{1,18}$/.test(want) ? want : (full ? String(full.id) : "all");
  fillPicker();
  await render();
  el("rpQuote").addEventListener("change", function () { setQuery(); render(); });
  el("rpTk").addEventListener("change", function () { state.which = el("rpTk").value; setQuery(); render(); });
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  const s = document.getElementById("rpSheet");
  if (s) s.innerHTML = '<div class="rp-loading">' + esc(errorText(e)) + "</div>";
});
