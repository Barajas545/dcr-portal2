/* The printable project Expense Report (port of the old report-expenses.html / .js — itself the web port of
   ProjectExpenseAnalisisPrint; BLUEPRINT 3.3.11 "Printed expense report", MODULES §6).

   Prints the same view the project's Expenses tab shows: the tab's Print link carries its filter on the query
   string (group, range, from, to, q, sort, dir, plus the already resolved pa / pb window, so a relative period
   cannot shift on the way here), and ALL of the filter semantics live in js/expense-filter.js — never
   re-implemented here, or the sheet would stop matching the screen. Opened without those keys (a bookmark) it
   prints everything; it never takes another tab's saved filter.

   The rows are the project's DCR Desktop 2 cost rows (repo/ledger.js projectExpenses); Cost = materials +
   subcontractors + labour, equipment and other in their own column and not in Cost, billed-out money not on
   this sheet. Financials only: anyone else is told so and nothing is read. */

import { boot, el, esc, errorText, qs, seesPrices, D } from "./shell.js";
import * as EF from "../expense-filter.js";
import * as repo from "../repo/ledger.js";
import { getProject } from "../repo/projects.js";
import { seesLedger } from "../map/ledger.js";
import { ymd, fmtDay } from "../map/pacific.js";

let F = null;   // the filter: resolved in init, never at parse time

function co() {
  const c = (D().companyInfo) || ((window.DCR2_CONFIG || {}).COMPANY) || {};
  return Object.assign({ name: "DCR", legalName: "", logo: "icons/logo.jpg", address: "", phone: "", fax: "", license: "", website: "" }, c);
}
function coBlock(c) {
  const lines = ["<b>" + esc(c.legalName || c.name) + "</b>"];
  if (c.address) lines.push(esc(c.address));
  const pf = [c.phone ? "Ph " + c.phone : "", c.fax ? "Fax " + c.fax : ""].filter(Boolean).join(" · ");
  if (pf) lines.push(esc(pf));
  if (c.license) lines.push(esc(c.license));
  if (c.website) lines.push(esc(c.website));
  return lines.join("<br>");
}
function escML(v) { return esc(EF.stripML(v)).split(/\r\n|\r|\n/).join("<br>"); }
function amt(v, cls) { return '<td class="amt' + (cls ? " " + cls : "") + '">' + (EF.num(v) ? esc(EF.money(v)) : "") + "</td>"; }

function render(p, rows, allCount, today) {
  document.title = "DCR Expenses — " + (p.internalIDNumber || "") + " " + (p.projectName || "");
  const c = co();
  const filtered = EF.isActive(F, today);
  const body = EF.group(rows).map(function (b) {
    const t = EF.totals(b.rows);
    const lines = b.rows.map(function (r) {
      return '<tr><td class="dt">' + esc(EF.fmtDay(r.date)) + "</td><td>" + escML(EF.descOf(r)) +
        (r.kind !== "material" ? ' <span class="vd" style="display:inline">(' + esc(r.kindLabel) + ")</span>" : "") +
        (r.vendor && r.description ? '<span class="vd">' + esc(r.vendor) + "</span>" : "") + "</td>" +
        amt(r.materials) + amt(r.contractors) + amt(r.labor) + amt(r.other, "oth") + amt(r.cost) + "</tr>";
    }).join("");
    return '<tbody class="group-block"><tr class="grp"><td colspan="7">' + esc(b.name) + "</td></tr>" + lines +
      '<tr class="sub"><td colspan="2">Subtotal — ' + esc(b.name) + "</td>" +
      '<td class="amt">' + esc(EF.money(t.mat)) + '</td><td class="amt">' + esc(EF.money(t.con)) + '</td><td class="amt">' + esc(EF.money(t.lab)) +
      '</td><td class="amt oth">' + esc(EF.money(t.oth)) + '</td><td class="amt">' + esc(EF.money(t.cost)) + "</td></tr></tbody>";
  }).join("");
  // one pass over the printed rows, not a fold of the subtotals, so this matches the tab's total to the cent
  const g = EF.totals(rows);
  const when = fmtDay(today);
  el("rpSheet").innerHTML =
    '<div class="lh">' + (c.logo ? '<img src="' + esc(c.logo) + '" alt="">' : "") + '<div class="co">' + coBlock(c) + "</div><h1>EXPENSE REPORT</h1></div>" +
    '<div class="who"><div>Project: <b>' + esc([p.internalIDNumber, p.projectName].filter(Boolean).join(" — ")) + "</b><br>" +
      esc([p.projectAddress, p.projectCity].filter(Boolean).join(", ")) + "</div>" +
      '<div style="text-align:right">Client: <b>' + esc(p.projectClientName || "—") + "</b><br>Date: " + esc(when) + "</div></div>" +
    (filtered ? '<div class="filt"><b>Filtered:</b> ' + esc(EF.label(F, today)) + "<br>Showing " + rows.length + " of " + allCount + " expense records</div>" : "") +
    '<div class="tblwrap"><table class="ex"><thead><tr><th>Date</th><th>Description</th><th class="amt">Materials</th><th class="amt">Subs</th>' +
      '<th class="amt">Labour</th><th class="amt">Equip. / other</th><th class="amt">Cost</th></tr></thead>' + body +
      '<tbody><tr class="grand"><td colspan="2">' + (filtered ? "FILTERED TOTAL" : "GRAND TOTAL") + "</td>" +
      '<td class="amt">' + esc(EF.money(g.mat)) + '</td><td class="amt">' + esc(EF.money(g.con)) + '</td><td class="amt">' + esc(EF.money(g.lab)) +
      '</td><td class="amt oth">' + esc(EF.money(g.oth)) + '</td><td class="amt">' + esc(EF.money(g.cost)) + "</td></tr></tbody></table></div>" +
    '<div class="note">Cost is materials, subcontractors and labour. Equipment and other rows are listed in their own column and are not in Cost. ' +
      "Money billed to the client is not an expense and is not on this sheet.</div>" +
    '<div class="foot">Generated ' + esc(when) + " · " + esc(c.name) + " · " + rows.length + (rows.length !== allCount ? " of " + allCount : "") + " expense records</div>";
}

async function init() {
  const me = await boot(null);
  const pid = qs("id");
  el("rpPrint").addEventListener("click", function () { window.print(); });
  if (!pid || !/^\d{1,15}$/.test(pid)) { el("rpSheet").innerHTML = '<div class="rp-loading">No project selected.</div>'; return; }
  // the filter comes from the query string ONLY: a bookmark never inherits another tab's saved filter
  F = EF.fromQuery(new URLSearchParams(location.search)) || EF.defaults();
  const today = ymd(new Date());
  // Back is set before the read: the empty, no-match and error paths all lead back to the same view
  el("rpBack").href = EF.hrefWith("project.html", { id: pid, tab: "expenses" }, F, false, today);
  if (!seesLedger(me)) {
    el("rpSheet").innerHTML = '<div class="rp-loading">This report shows money: it needs the financials switch. Nothing was read.</div>';
    return;
  }
  try {
    // the line's words as the Expenses tab shows them (its group filter is the line's label)
    const [p, all] = await Promise.all([getProject(pid), repo.projectExpenses(pid, { prices: seesPrices(me) })]);
    if (!all.length) { el("rpSheet").innerHTML = '<div class="rp-loading">This project has no expense records.</div>'; return; }
    const rows = EF.sort(EF.filter(all, F, today), F);
    if (!rows.length) {
      el("rpSheet").innerHTML = '<div class="rp-loading">No expense records match these filters.<div style="margin-top:8px;font-size:12px">' +
        esc(EF.label(F, today)) + "</div></div>";
      return;
    }
    render(p, rows, all.length, today);
  } catch (e) {
    el("rpSheet").innerHTML = '<div class="rp-loading">' + esc(errorText(e) || "Could not load the expenses.") + "</div>";
  }
}

if (typeof document !== "undefined") {
  init().catch(function (e) {
    if (e && /not signed in|not for this role/.test(e.message || "")) return;
    const s = document.getElementById("rpSheet");
    if (s) s.innerHTML = '<div class="rp-loading">' + esc(errorText(e)) + "</div>";
  });
}
