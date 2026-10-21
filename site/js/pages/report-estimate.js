/* The printed estimate and change order (port of the old report-estimate.html / .js; MODULES §3
   "report-estimate.html"; BLUEPRINT 3.3.11 and P5 acceptance check 1).

   ?id=<project>[&est=<estimate id>|all]. The paper is DCR Desktop 2's (printing/estimates.py): letterhead,
   Prepared for / Project, the items by group, then — only with prices — the amounts, subtotals, the TOTAL
   (GRAND TOTAL for several), the terms (editable before printing, not saved) and the signature lines. One
   change order alone prints as a CHANGE ORDER with the contract figures (original contract, previous
   change orders, this one, the new total), the approval wording and three signature lines.

   A person without prices gets the worksite copy and nothing else: the database sends no money and scrubs
   typed amounts (rpc estimate_print), there is no switch to turn it back on, "WORKSITE COPY · NO PRICES" on the paper and every
   dollar amount typed into the words masked. A person with prices may tick "Hide prices (worksite copy)":
   the sheet is drawn again without money (never only hidden by a style). */

import { boot, el, esc, errorText, seesPrices, qs, D } from "./shell.js";
import * as projectsRepo from "../repo/projects.js";
import * as estRepo from "../repo/estimates.js";
import { estimateSheetHtml } from "./est-render.js";
import { pickForPrint, counts, moneyShown, wordsFor } from "../map/estimates.js";
import { companyToday, companyInfo } from "../common2.js";

const state = { project: null, all: [], which: "all", prices: false };   // prices: what the database decided

function co() {
  const c = D().companyInfo || companyInfo || ((window.DCR2_CONFIG || {}).COMPANY) || {};
  return Object.assign({ name: "DCR", legalName: "", logo: "icons/logo.jpg" }, c);
}

function render() {
  const list = pickForPrint(state.all, state.which);
  if (!list.length) {
    el("rpSheet").innerHTML = '<div class="rp-loading">' + (state.which === "all" ? "This project has no estimates yet. Estimates are written in DCR Desktop 2."
      : "That estimate is not there any more — it may have been deleted.") + "</div>";
    return;
  }
  const show = moneyShown(state.prices && !el("rpNoPrices").checked, list);
  const out = estimateSheetHtml(state.project, list, {
    show, detailed: !el("rpSimple").checked, notes: el("rpNotes").checked, company: co(), date: companyToday(),
  });
  el("rpSheet").innerHTML = out.html;
  document.title = "DCR " + out.title;
  el("rpNote").hidden = show;
  el("rpNote").textContent = state.prices
    ? "Worksite copy: no prices on this page."
    : "Worksite copy: prices are not shown for your account. The scope of work, quantities and crew are all here.";
}

function fillPicker() {
  const sel = el("rpEst");
  const w = wordsFor(state.prices);
  const live = state.all.filter(function (e) { return counts(e) || String(e.id) === String(state.which); });
  if (live.length < 2) { sel.hidden = true; return; }
  sel.hidden = false;
  sel.innerHTML = '<option value="all">All estimates (' + state.all.filter(counts).length + ")</option>" + live.map(function (e) {
    return '<option value="' + esc(e.id) + '"' + (String(e.id) === String(state.which) ? " selected" : "") + ">" +
      esc(w(e.displayName) + (e.archived ? " (archived)" : "")) + "</option>";
  }).join("");
  if (state.which === "all") sel.value = "all";
}

async function init() {
  const me = await boot(null);
  state.prices = seesPrices(me);          // the switches shown; the database decides what it sends
  el("rpPrint").addEventListener("click", function () { window.print(); });
  const pid = qs("id");
  if (!pid || !/^\d{1,18}$/.test(pid)) { el("rpSheet").innerHTML = '<div class="rp-loading">No project selected.</div>'; return; }
  el("rpBack").href = "project.html?id=" + encodeURIComponent(pid) + "&tab=estimate";
  const want = qs("est");
  state.which = want && /^\d{1,18}$/.test(want) ? want : "all";
  // the switches a person without prices never sees: their copy is the worksite copy, full stop
  el("rpNoPricesBox").hidden = !state.prices;
  el("rpNotesBox").hidden = !state.prices;
  try {
    const res = await Promise.all([projectsRepo.getProject(pid), estRepo.listEstimates(pid, { archived: true, flags: false })]);
    state.project = res[0];
    state.all = res[1].estimates;
    if (res[1].prices === false) {          // the database said no (a switch turned off since sign-in)
      state.prices = false;
      el("rpNoPricesBox").hidden = true;
      el("rpNotesBox").hidden = true;
    }
  } catch (e) {
    el("rpSheet").innerHTML = '<div class="rp-loading">' + esc(errorText(e)) + "</div>";
    return;
  }
  fillPicker();
  render();
  ["rpNoPrices", "rpSimple", "rpNotes"].forEach(function (id) { el(id).addEventListener("change", render); });
  el("rpEst").addEventListener("change", function () {
    state.which = el("rpEst").value || "all";
    try {
      const u = new URL(location.href);
      if (state.which === "all") u.searchParams.delete("est"); else u.searchParams.set("est", state.which);
      history.replaceState(null, "", u);
    } catch (e) { /* the address is a nicety */ }
    render();
  });
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  const s = document.getElementById("rpSheet");
  if (s) s.innerHTML = '<div class="rp-loading">' + esc(errorText(e)) + "</div>";
});
